'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmpdir, cli, ok, writeFile, toBuild, TASK, lib } = require('./helpers');

const fsu = lib('fsutil');

test('help and usage errors', () => {
  const root = tmpdir();
  assert.match(ok(cli(root, ['help'])), /usage: adlc/);
  assert.equal(cli(root, ['bogus']).status, 1);
  assert.equal(cli(root, ['start']).status, 1);
  assert.equal(cli(root, ['status']).status, 4);
});

test('start refuses a second active change and records skips', () => {
  const root = tmpdir();
  ok(cli(root, ['start', 'Add', 'thing', '--small']));
  assert.equal(cli(root, ['start', 'Other']).status, 2);
  const approvals = fs.readFileSync(path.join(root, '.agent-lifecycle/approvals.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(approvals.map((a) => [a.type, a.stage]), [['skip', 'discover'], ['skip', 'design']]);
  const s = JSON.parse(ok(cli(root, ['status', '--json'])));
  assert.equal(s.stage, 'specify');
  assert.equal(s.change.title, 'Add thing');
});

test('illegal transitions exit 2 with the reason', () => {
  const root = tmpdir();
  ok(cli(root, ['start', 'x']));
  const r = cli(root, ['stage', 'start', 'build']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /current stage is discover/);
  assert.equal(cli(root, ['skip', 'build', 'because']).status, 2);
  assert.equal(cli(root, ['skip', 'discover']).status, 1);
});

test('plan cannot complete without ACs, and build cannot start without approval', () => {
  const root = tmpdir();
  toBuild(root, [TASK()], { approve: false });
  const r = cli(root, ['stage', 'start', 'build']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /plan gate not approved/);
  const next = JSON.parse(ok(cli(root, ['next', '--json'])));
  assert.deepEqual([next.action, next.stage], ['start', 'build']);
  assert.match(next.problems[0], /not approved/);
});

test('run exits 5 when the command fails and records evidence either way', () => {
  const root = tmpdir();
  ok(cli(root, ['start', 'x']));
  const fail = cli(root, ['run', '--stage', 'verify', '--', 'exit 7']);
  assert.equal(fail.status, 5);
  assert.match(fail.stdout, /exit=7 \(FAILED\)/);
  const pass = JSON.parse(ok(cli(root, ['run', '--stage', 'verify', '--json', '--', 'echo', 'hi'])));
  assert.equal(pass.exit, 0);
  assert.equal(fs.readdirSync(path.join(root, '.agent-lifecycle/test-results')).length, 2);
  assert.equal(cli(root, ['run', '--stage', 'verify']).status, 1);
});

test('full sequential build through the CLI', () => {
  const root = tmpdir();
  toBuild(root, [TASK({ checks: ['test -f src/a.js'] })]);
  const lease = JSON.parse(ok(cli(root, ['dispatch', 'start', 'T1', '--session', 's1', '--json'])));
  assert.match(ok(cli(root, ['worker', 'claim', 'T1', '--lease', lease.lease])), /writable files \(relative to your working directory\): src\/a\.js/);
  assert.equal(cli(root, ['worker', 'claim', 'T1', '--lease', 'L-000000']).status, 2);
  writeFile(root, 'src/a.js', 'module.exports = 1;\n');
  const ev = JSON.parse(ok(cli(root, ['run', '--stage', 'build', '--task', 'T1', '--json', '--', 'test -f src/a.js'])));
  const hf = writeFile(root, '.agent-lifecycle/tmp/h.json', JSON.stringify({
    task: 'T1', status: 'done', workspace: root, branch: null, files_changed: ['src/a.js'], summary: 'added a.js',
    checks: [{ cmd: 'test -f src/a.js', exit: 0, evidence: ev.file }], interface_changes: [], blockers: [], integration_notes: '', out_of_scope: [],
  }));
  ok(cli(root, ['worker', 'handoff', 'T1', '--file', hf]));
  const blocked = cli(root, ['integrate', 'check', 'T1']);
  assert.equal(blocked.status, 2);
  assert.match(blocked.stdout, /no SubagentStop record/);
  ok(cli(root, ['lease', 'stopped', lease.lease, 'foreground worker returned']));
  assert.match(ok(cli(root, ['integrate', 'check', 'T1'])), /passed the integration check/);
  assert.equal(cli(root, ['integrate', 'done', 'T1']).status, 2);
  ok(cli(root, ['run', '--stage', 'build', '--', 'test -f src/a.js']));
  ok(cli(root, ['integrate', 'done', 'T1']));
  assert.match(ok(cli(root, ['stage', 'complete', 'build'])), /next: verify/);
  const s = JSON.parse(ok(cli(root, ['status', '--json'])));
  assert.equal(s.tasks[0].status, 'integrated');
  assert.equal(s.budget.tasks_this_run, 1);
});

test('repair enforces the attempt limit and blocks the change', () => {
  const root = tmpdir();
  toBuild(root, [TASK({ max_attempts: 2 })]);
  for (let i = 0; i < 2; i += 1) {
    const lease = JSON.parse(ok(cli(root, ['dispatch', 'start', 'T1', '--session', 's', '--json'])));
    assert.equal(cli(root, ['task', 'repair', 'T1', 'tests fail']).status, 2, 'worker must be confirmed stopped first');
    fsu.appendLine(path.join(root, '.agent-lifecycle/runs/stops.jsonl'), { lease: lease.lease });
    ok(cli(root, ['task', 'repair', 'T1', 'tests fail']));
  }
  const s = JSON.parse(ok(cli(root, ['status', '--json'])));
  assert.equal(s.tasks[0].status, 'blocked');
  assert.match(s.blocker, /T1 exhausted/);
  assert.equal(cli(root, ['dispatch', 'start', 'T1']).status, 2);
  ok(cli(root, ['unblock', 'retry with a new approach', '--task', 'T1']));
  const after = JSON.parse(ok(cli(root, ['status', '--json'])));
  assert.equal(after.blocker, null);
  assert.equal(after.tasks[0].status, 'todo');
});

test('gate check exits 2 when not approved and hash is stable', () => {
  const root = tmpdir();
  toBuild(root, [TASK()], { approve: false });
  assert.equal(cli(root, ['gate', 'check', 'plan']).status, 2);
  assert.equal(ok(cli(root, ['hash', 'plan'])), ok(cli(root, ['hash', 'plan'])));
});

test('handoff notes are appended with secrets redacted, and archive needs done or --force', () => {
  const root = tmpdir();
  ok(cli(root, ['start', 'x']));
  ok(cli(root, ['handoff', 'next: wire it up; token=abc123']));
  const text = fs.readFileSync(path.join(root, '.agent-lifecycle/handoff.md'), 'utf8');
  assert.match(text, /next: wire it up; token=\[REDACTED\]/);
  assert.equal(cli(root, ['archive']).status, 2);
  ok(cli(root, ['archive', '--force']));
  assert.ok(fs.existsSync(path.join(root, '.agent-lifecycle/archive')));
  assert.equal(cli(root, ['status']).status, 4);
  ok(cli(root, ['start', 'next change']));
});

test('start takes settings from the flag, then CLAUDE_PLUGIN_OPTION_*, ignoring unsubstituted placeholders', () => {
  const { spawnSync } = require('node:child_process');
  const bin = path.join(__dirname, '../plugins/adlc/bin/adlc');
  const { userPrompt } = require('./helpers');
  const run = (args, env) => {
    const root = tmpdir();
    // reduced gates need the user's own /adlc:start; the hook sees the same plugin settings
    userPrompt(root, `/adlc:start x ${args.join(' ')}`, env);
    const r = spawnSync('node', [bin, 'start', 'x', ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, ADLC_ROOT: root, ...env } });
    assert.equal(r.status, 0, r.stderr);
    const st = JSON.parse(fs.readFileSync(path.join(root, '.agent-lifecycle/state.json'), 'utf8'));
    return { ...st.config, max_repair_attempts: st.budget.max_repair_attempts, max_parallel: st.execution.max_parallel };
  };
  assert.deepEqual(run([], {}).approval_gates, ['plan', 'release']);
  assert.deepEqual(run([], { CLAUDE_PLUGIN_OPTION_APPROVAL_GATES: 'plan' }).approval_gates, ['plan']);
  assert.deepEqual(run(['--approval-gates', '${user_config.approval_gates}'], { CLAUDE_PLUGIN_OPTION_APPROVAL_GATES: 'release' }).approval_gates, ['release']);
  assert.deepEqual(run(['--approval-gates', 'plan'], { CLAUDE_PLUGIN_OPTION_APPROVAL_GATES: 'release' }).approval_gates, ['plan']);
  assert.equal(run(['--max-repair-attempts', '${user_config.max_repair_attempts}'], {}).max_repair_attempts, 3);
  assert.equal(run([], { CLAUDE_PLUGIN_OPTION_MAX_PARALLEL: '4' }).max_parallel, 4);
});

test('approve, skip and unblock need a user prompt: a command the model runs alone is refused', () => {
  const { userPrompt } = require('./helpers');
  const root = tmpdir();
  ok(cli(root, ['start', 'x', '--small']));
  const asModel = (args) => cli(root, args, { asModel: true });
  for (const args of [['approve', 'plan'], ['skip', 'specify', 'because'], ['unblock', 'note']]) {
    const r = asModel(args);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, /the user has not asked for this/);
  }
  // the user's prompt authorises exactly one matching command
  userPrompt(root, '/adlc:skip specify not needed');
  assert.equal(asModel(['approve', 'plan']).status, 2, 'a skip prompt does not authorise an approval');
  assert.equal(asModel(['skip', 'specify', 'not needed']).status, 0);
  assert.equal(asModel(['skip', 'specify', 'again']).status, 2, 'an intent is single use');
  // other prompts leave no intent
  userPrompt(root, 'please approve the plan');
  userPrompt(root, '/adlc:status');
  assert.equal(asModel(['approve', 'plan']).status, 2);
});

test('an intent expires after fifteen minutes and is ignored outside adlc projects', () => {
  const ui = lib('userintent');
  const root = tmpdir();
  ok(cli(root, ['start', 'x', '--small']));
  const rec = ui.record(root, { action: 'approve', arg: 'plan' });
  assert.ok(ui.pending(root, 'approve', 'plan'));
  assert.equal(ui.pending(root, 'approve', 'plan', Date.parse(rec.ts) + ui.TTL_MS + 1000), null);
  const bare = tmpdir();
  const { userPrompt } = require('./helpers');
  assert.equal(userPrompt(bare, '/adlc:approve plan').status, 0);
  assert.equal(fs.existsSync(path.join(bare, '.agent-lifecycle')), false);
});

test('reduced approval gates need the user\'s own /adlc:start', () => {
  const { userPrompt } = require('./helpers');
  const root = tmpdir();
  const r = cli(root, ['start', 'x', '--approval-gates', 'none']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /approval gates reduced to "none"/);
  assert.equal(fs.existsSync(path.join(root, '.agent-lifecycle/state.json')), false);
  // a prompt that asks for other gates does not cover it
  userPrompt(root, '/adlc:start x --approval-gates plan');
  assert.equal(cli(root, ['start', 'x', '--approval-gates', 'none']).status, 2);
  userPrompt(root, '/adlc:start x --approval-gates none');
  ok(cli(root, ['start', 'x', '--approval-gates', 'none']));
  // full gates never need an intent
  ok(cli(tmpdir(), ['start', 'y', '--approval-gates', 'release,plan']));
});

test('an approval covers what the user saw: edits after the prompt are refused and the prompt stays usable', () => {
  const { userPrompt } = require('./helpers');
  const root = tmpdir();
  toBuild(root, [TASK()], { approve: false });
  const asModel = (args) => cli(root, args, { asModel: true });
  userPrompt(root, '/adlc:approve plan');
  const plan = path.join(root, '.agent-lifecycle/plan.md');
  const before = fs.readFileSync(plan, 'utf8');
  fs.writeFileSync(plan, `${before}\nsneaked in after the prompt\n`);
  const r = asModel(['approve', 'plan']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /changed after the user typed/);
  // nothing was consumed: with the files back as the user saw them, the same prompt still approves once
  fs.writeFileSync(plan, before);
  assert.equal(asModel(['approve', 'plan']).status, 0);
  assert.equal(asModel(['approve', 'plan']).status, 2);
});

test('a refused action does not use up the user\'s prompt, and there is no terminal shortcut', () => {
  const { userPrompt } = require('./helpers');
  const root = tmpdir();
  ok(cli(root, ['start', 'x']));
  const asModel = (args) => cli(root, args, { asModel: true });
  userPrompt(root, '/adlc:skip build no');
  assert.equal(asModel(['skip', 'build', 'no']).status, 2, 'build cannot be skipped');
  assert.ok(lib('userintent').pending(root, 'skip', 'build'), 'intent still pending');
  assert.equal(asModel(['archive', '--force']).status, 2, 'archive is user-only');
  assert.equal(lib('userintent').humanAtTerminal, undefined);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../plugins/adlc/lib/userintent.js'), 'utf8'), /isTTY/);
});

test('hooks and the CLI agree on the root when the session starts in a subdirectory', () => {
  const { hook } = require('./helpers');
  const root = tmpdir();
  ok(cli(root, ['start', 'x']));
  const sub = path.join(root, 'packages/app');
  fs.mkdirSync(sub, { recursive: true });
  const input = { hook_event_name: 'PreToolUse', tool_name: 'Write', cwd: sub, tool_input: { file_path: path.join(root, '.agent-lifecycle/state.json'), content: '{}' } };
  const r = hook('guard', input, sub);
  assert.match(r.stdout, /"permissionDecision":"deny"/);
  const p = require('./helpers').userPrompt(sub, '/adlc:unblock go on');
  assert.equal(p.status, 0);
  assert.ok(lib('userintent').pending(root, 'unblock'));
});
