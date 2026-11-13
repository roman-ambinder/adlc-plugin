#!/usr/bin/env node
'use strict';
// PreToolUse guard. Emits only "deny" or "ask"; silence leaves the normal permission flow in charge.
const { WRITE_TOOLS, readStdin, lifecycle, preToolDecision, roleOf, locate, workspaceOf, readBindings, updateBindings } = require('./common');
const P = require('./patterns');
const { entriesOverlap } = require('../lib/glob');

const WORKER_ROLES = ['developer', 'developer-worktree', 'tester'];
const WORKER_ADLC = ['worker', 'run', 'status'];
const deny = (reason) => ({ decision: 'deny', reason });
const ask = (reason) => ({ decision: 'ask', reason });

function decideWrite(input, ctx, binding) {
  const ti = input.tool_input || {};
  const target = ti.file_path || ti.notebook_path;
  if (!target) return null;
  const { path: rel, workspace } = locate(ctx, input, target);
  if (P.PROTECTED_PATH.test(rel)) return deny(`${rel} is managed by the adlc CLI and hooks; change it only through adlc commands`);
  const edits = Array.isArray(ti.edits) ? ti.edits : [];
  const added = [ti.content, ti.new_string, ti.new_source, ...edits.map((e) => e && e.new_string)].filter(Boolean).join('\n');
  const removed = [ti.old_string, ...edits.map((e) => e && e.old_string)].filter(Boolean).join('\n');
  if (P.TEST_FILE.test(rel) && P.TEST_DISABLE.test(added) && !P.TEST_DISABLE.test(removed)) {
    return deny(`this edit skips or narrows tests in ${rel} (skip/only). Fix the behaviour instead; if a test truly must be skipped, ask the user to make that change`);
  }
  const role = roleOf(input.agent_type);
  if (role === 'reviewer') return deny('the reviewer role is read-only');
  if (role === 'analyst' && !/^\.agent-lifecycle\/(requirements\.md|tmp\/)/.test(rel)) return deny(`the analyst may only write .agent-lifecycle/requirements.md (attempted ${rel})`);
  if (role === 'architect' && !/^\.agent-lifecycle\/(decisions\.md|tmp\/)/.test(rel)) return deny(`the architect may only write .agent-lifecycle/decisions.md (attempted ${rel})`);
  if (WORKER_ROLES.includes(role)) {
    const mode = (ctx.state && ctx.state.execution && ctx.state.execution.mode) || 'sequential';
    if (binding) {
      if (mode === 'worktree') {
        if (!workspace) return deny(`worktree mode: write inside your own git worktree, not the main checkout (attempted ${rel})`);
        const own = workspaceOf(ctx, binding.cwd);
        if (own && own !== workspace) return deny(`worktree mode: ${binding.task} may write only inside its own worktree (${own})`);
      }
      const task = ((ctx.state && ctx.state.tasks) || []).find((t) => t.id === binding.task);
      const allowed = rel.startsWith('.agent-lifecycle/tmp/') || Boolean(task && task.files.some((g) => entriesOverlap(g, rel)));
      if (!allowed) return deny(`task ${binding.task} may only write its packet files (${task ? task.files.join(', ') : 'unknown task'}); ${rel} is outside. Report it under out_of_scope in your handoff`);
    } else {
      return deny(`claim your task before editing (${mode} mode): run \`adlc worker claim <T> --lease <L>\``);
    }
  }
  return null;
}

function decideBash(input, ctx, binding, level) {
  const cmd = String((input.tool_input || {}).command || '');
  if (P.PROTECTED_IN_CMD.test(cmd) && P.WRITE_OPS.test(cmd)) {
    return deny('state.json, approvals.jsonl and runs/ are managed by the adlc CLI and hooks; use adlc commands (read state with `adlc status`)');
  }
  if (P.MANAGED_NAME_IN_CMD.test(cmd) && P.WRITE_OPS.test(cmd)) {
    return ask(`this command may modify adlc-managed files (state.json, approvals.jsonl, runs/): \`${cmd}\`. Approve only if it targets a different file`);
  }
  for (const re of P.CHECK_BYPASS) if (re.test(cmd)) return deny('this command bypasses or masks checks (--no-verify, "|| true" after a check); run checks honestly and report failures');
  if (WORKER_ROLES.includes(roleOf(input.agent_type))) {
    const bad = P.shellWriteTargets(cmd).filter((x) => !P.SHELL_WRITE_OK(x));
    if (bad.length) return deny(`workers change files only with the Write or Edit tools, so every write is attributed and scoped (shell writes are allowed only into .agent-lifecycle/tmp/); blocked: ${bad.join(', ')}`);
  }
  if (binding) {
    if (/\bgit\b/.test(cmd)) return deny('workers never run git; the coordinator integrates your work');
    for (const m of cmd.matchAll(P.ADLC_SUBCOMMAND)) {
      if (!WORKER_ADLC.includes(m[1])) return deny(`workers may only run adlc ${WORKER_ADLC.join('|')} (attempted adlc ${m[1]})`);
    }
  }
  if (P.USER_ONLY.test(cmd)) return ask(`user-only adlc action: \`${cmd}\`. Approve only if you asked for this yourself.`);
  const kind = P.riskyKind(cmd, level);
  if (kind) return ask(`${kind} requires your approval: \`${cmd}\``);
  return null;
}

function decide(input, ctx, env = process.env) {
  const level = env.CLAUDE_PLUGIN_OPTION_GUARD_LEVEL === 'standard' ? 'standard' : 'strict';
  const binding = input.agent_id ? readBindings(ctx)[input.agent_id] || null : null;
  if (WRITE_TOOLS.includes(input.tool_name)) return decideWrite(input, ctx, binding);
  if (input.tool_name === 'Bash') return decideBash(input, ctx, binding, level);
  return null;
}

// `adlc worker claim <T> --lease <L>` from a subagent binds its agent_id to that lease (first claim wins).
function recordClaim(input, ctx) {
  if (input.tool_name !== 'Bash' || !input.agent_id || !ctx.state) return;
  const m = String((input.tool_input || {}).command || '').match(P.WORKER_CLAIM);
  if (!m) return;
  const lease = (ctx.state.leases || []).find((l) => l.lease === m[2] && l.task === m[1] && l.status === 'active');
  if (!lease) return;
  updateBindings(ctx, (b) => {
    if (Object.values(b).some((x) => x && x.lease === m[2])) return;
    b[input.agent_id] = { task: m[1], lease: m[2], agent_type: input.agent_type || null, cwd: input.cwd || null, ts: new Date().toISOString() };
  });
}

function main() {
  const input = readStdin();
  const ctx = lifecycle(input);
  if (!ctx) return;
  try {
    recordClaim(input, ctx);
    const d = decide(input, ctx);
    if (d) preToolDecision(d.decision, d.reason);
  } catch (err) {
    preToolDecision('ask', `adlc guard error (${err.message}); review this action yourself`);
  }
}

if (require.main === module) main();
module.exports = { decide, recordClaim };
