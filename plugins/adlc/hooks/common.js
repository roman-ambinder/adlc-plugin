'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { atomicWrite, readJson, withLock } = require('../lib/fsutil');
const { linkedWorktree, mainRootFor } = require('../lib/worktree');

const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];

function readStdin() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function real(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

// Opt-in diagnostics: ADLC_HOOK_LOG=<file> appends hook metadata (never tool input or messages).
function probeLog(input) {
  const file = process.env.ADLC_HOOK_LOG;
  if (!file) return;
  try {
    const pick = ['hook_event_name', 'tool_name', 'agent_id', 'agent_type', 'session_id', 'cwd', 'permission_mode', 'source', 'stop_hook_active'];
    const entry = { ts: new Date().toISOString(), env_project_dir: process.env.CLAUDE_PROJECT_DIR || null };
    for (const k of pick) if (input[k] !== undefined) entry[k] = input[k];
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
  } catch {
    // diagnostics must never affect the hook
  }
}

// Returns null outside adlc projects so every hook stays silent there.
function lifecycle(input) {
  probeLog(input);
  // Hooks fired inside a worker's git worktree still use the main checkout's state.
  const root = mainRootFor(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
  const dir = path.join(root, '.agent-lifecycle');
  const stateFile = path.join(dir, 'state.json');
  if (!fs.existsSync(stateFile)) return null;
  return { root, realRoot: real(root), dir, runs: path.join(dir, 'runs'), state: readJson(stateFile, null) };
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
}

// Only "deny" or "ask": the plugin never short-circuits the platform permission flow with "allow".
function preToolDecision(permissionDecision, reason) {
  if (!['deny', 'ask'].includes(permissionDecision)) throw new Error(`refusing to emit ${permissionDecision}`);
  emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason: reason } });
}

function roleOf(agentType) {
  return agentType ? String(agentType).split(':').pop() : null;
}

// Project-relative POSIX path; tolerates symlinked roots (e.g. /var vs /private/var on macOS).
function relPath(ctx, input, p) {
  const abs = path.resolve(input.cwd || ctx.root, String(p));
  for (const base of [ctx.root, ctx.realRoot]) {
    const rel = path.relative(base, abs);
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) return rel.split(path.sep).join('/');
  }
  const viaReal = path.relative(ctx.realRoot, real(path.dirname(abs)));
  if (!viaReal.startsWith('..')) return path.join(viaReal, path.basename(abs)).split(path.sep).join('/');
  return path.relative(ctx.root, abs).split(path.sep).join('/');
}

// Where a file lives: inside a linked worktree of this repository, the path is relative to that worktree.
function locate(ctx, input, p) {
  const abs = path.resolve(input.cwd || ctx.root, String(p));
  const linked = linkedWorktree(path.dirname(abs));
  if (linked && linked.mainRoot === ctx.realRoot) {
    const rel = path.relative(linked.worktreeRoot, real(path.dirname(abs)));
    return { path: path.join(rel, path.basename(abs)).split(path.sep).join('/'), workspace: linked.worktreeRoot };
  }
  return { path: relPath(ctx, input, p), workspace: null };
}

function workspaceOf(ctx, dir) {
  if (!dir) return null;
  const linked = linkedWorktree(dir);
  return linked && linked.mainRoot === ctx.realRoot ? linked.worktreeRoot : null;
}

function bindingsFile(ctx) {
  return path.join(ctx.runs, 'bindings.json');
}

function readBindings(ctx) {
  return readJson(bindingsFile(ctx), {});
}

function updateBindings(ctx, fn) {
  withLock(path.join(ctx.runs, '.bindings.lock'), () => {
    const b = readBindings(ctx);
    fn(b);
    atomicWrite(bindingsFile(ctx), `${JSON.stringify(b, null, 2)}\n`);
  }, { waitMs: 2000 });
}

module.exports = { WRITE_TOOLS, readStdin, lifecycle, emit, preToolDecision, roleOf, relPath, locate, workspaceOf, readBindings, updateBindings };
