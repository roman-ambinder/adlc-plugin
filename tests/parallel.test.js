'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { tmpdir, cli, hook, ok, writeFile, toBuild, TASK } = require('./helpers');

const bash = (command, who) => ({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, ...who });
const writeEvent = (root, rel, who, event = 'PreToolUse') => ({ hook_event_name: event, tool_name: 'Write', tool_input: { file_path: path.join(root, rel), content: 'x' }, ...who });
const decision = (r) => (r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : null);

// Plays one worker: claim (through the guard hook), write its files (guarded + audited), run checks, hand off, stop.
function worker(root, task, lease, files, agentId) {
  const who = { agent_id: agentId, agent_type: 'adlc:developer', cwd: root };
  hook('guard', bash(`node "/x/bin/adlc" worker claim ${task} --lease ${lease}`, who), root);
  ok(cli(root, ['worker', 'claim', task, '--lease', lease]));
  for (const f of files) {
    assert.equal(decision(hook('guard', writeEvent(root, f, who), root)), null, `${task} may write ${f}`);
    writeFile(root, f, `// ${task}\n`);
    hook('audit', writeEvent(root, f, who, 'PostToolUse'), root);
  }
  const check = `test -f ${files[0]}`;
  const ev = JSON.parse(ok(cli(root, ['run', '--stage', 'build', '--task', task, '--json', '--', check])));
  const hf = writeFile(root, `.agent-lifecycle/tmp/handoff-${task}.json`, JSON.stringify({
    task, status: 'done', workspace: root, branch: null, files_changed: files, summary: `${task} done`,
    checks: [{ cmd: check, exit: 0, evidence: ev.file }], interface_changes: [], blockers: [], integration_notes: '', out_of_scope: [],
  }));
  ok(cli(root, ['worker', 'handoff', task, '--file', hf]));
  return who;
}

test('shared mode runs two independent tasks concurrently with scoped workers', () => {
  const root = tmpdir();
  toBuild(root, [
    TASK({ title: 'A', files: ['src/a.js'], checks: ['test -f src/a.js'] }),
    TASK({ title: 'B', files: ['src/b.js'], checks: ['test -f src/b.js'] }),
    TASK({ title: 'C', files: ['src/c.js'], checks: ['test -f src/c.js'], deps: ['T1', 'T2'] }),
  ], { mode: 'auto' });
  const status = JSON.parse(ok(cli(root, ['status', '--json'])));
  assert.equal(status.execution.mode, 'shared');
  assert.deepEqual(status.ready, ['T1', 'T2']);

  const l1 = JSON.parse(ok(cli(root, ['dispatch', 'start', 'T1', '--session', 's', '--json']))).lease;
  const l2 = JSON.parse(ok(cli(root, ['dispatch', 'start', 'T2', '--session', 's', '--json']))).lease;
  assert.equal(cli(root, ['dispatch', 'start', 'T3', '--session', 's']).status, 2, 'dependent task waits');

  const w1 = worker(root, 'T1', l1, ['src/a.js'], 'agent-1');
  const w2 = worker(root, 'T2', l2, ['src/b.js'], 'agent-2');
  assert.equal(decision(hook('guard', writeEvent(root, 'src/b.js', w1), root)), 'deny', "T1's worker cannot write T2's file");
  assert.equal(decision(hook('guard', writeEvent(root, 'src/c.js', w2), root)), 'deny', 'nor a file of a task not yet dispatched');

  hook('subagent-stop', { hook_event_name: 'SubagentStop', ...w2, last_assistant_message: 'T2 done' }, root);
  hook('subagent-stop', { hook_event_name: 'SubagentStop', ...w1, last_assistant_message: 'T1 done' }, root);

  for (const t of ['T1', 'T2']) {
    assert.match(ok(cli(root, ['integrate', 'check', t])), /passed the integration check/);
    for (const c of ['test -f src/a.js', 'test -f src/b.js']) ok(cli(root, ['run', '--stage', 'build', '--', c]));
    ok(cli(root, ['integrate', 'done', t]));
  }
  assert.deepEqual(JSON.parse(ok(cli(root, ['next', '--json']))).ready, ['T3']);
});

test('a worker that wrote outside its task fails integration and a blocked prerequisite stops its dependents', () => {
  const root = tmpdir();
  toBuild(root, [
    TASK({ title: 'A', files: ['src/a.js'], checks: ['test -f src/a.js'], max_attempts: 1 }),
    TASK({ title: 'B', files: ['src/b.js'], checks: ['test -f src/b.js'] }),
    TASK({ title: 'C', files: ['src/c.js'], checks: ['true'], deps: ['T1'] }),
  ], { mode: 'auto' });
  const l1 = JSON.parse(ok(cli(root, ['dispatch', 'start', 'T1', '--session', 's', '--json']))).lease;
  const w1 = worker(root, 'T1', l1, ['src/a.js'], 'agent-1');
  // Simulates an unattributed write that bypassed the guard; the audit log still attributes it to agent-1.
  hook('audit', writeEvent(root, 'src/b.js', w1, 'PostToolUse'), root);
  hook('subagent-stop', { hook_event_name: 'SubagentStop', ...w1 }, root);
  const r = cli(root, ['integrate', 'check', 'T1']);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /changed files outside T1's writable set: src\/b\.js/);
  ok(cli(root, ['task', 'repair', 'T1', 'wrote outside its files']));
  const s = JSON.parse(ok(cli(root, ['status', '--json'])));
  assert.deepEqual(s.tasks.map((t) => t.status), ['blocked', 'todo', 'blocked']);
  assert.equal(s.tasks[2].blocker, 'prerequisite T1 blocked');
  assert.match(s.blocker, /T1 exhausted/);
});
