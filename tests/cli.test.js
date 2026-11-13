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
