'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { lib, tmpdir, writeFile, TASK, REQUIREMENTS } = require('./helpers');

const st = lib('state');
const tasks = lib('tasks');
const gates = lib('gates');
const rules = lib('rules');
const exec = lib('exec');
const dispatch = lib('dispatch');
const integrate = lib('integrate');
const evidence = lib('evidence');
const fsu = lib('fsutil');

// In-memory state with plan/design done and build in progress; files on disk under root.
function planned(taskList, { mode, approve = true, max } = {}) {
  const root = tmpdir();
  st.init(root);
  writeFile(root, '.agent-lifecycle/requirements.md', REQUIREMENTS);
  const s = st.newState({ title: 't', small: true });
  if (max) s.execution.max_parallel = max;
  for (const x of ['specify', 'plan']) s.stages[x] = { status: 'completed' };
  for (const t of taskList) tasks.addTask(s, t);
  exec.planExecution(root, s, mode ? { mode } : {});
  if (approve) gates.approve(root, s, 'plan', 'test');
  s.stages.build = { status: 'in_progress', started: st.now() };
  return { root, s };
}

test('gate check: missing, valid, stale and disabled', () => {
  const { root, s } = planned([TASK()], { approve: false });
  assert.match(gates.check(root, s, 'plan').reason, /not approved/);
  gates.approve(root, s, 'plan');
  assert.equal(gates.check(root, s, 'plan').ok, true);
  fs.appendFileSync(path.join(root, '.agent-lifecycle/plan.md'), '\nedited\n');
  assert.match(gates.check(root, s, 'plan').reason, /stale/);
  s.config.approval_gates = [];
  assert.equal(gates.check(root, s, 'plan').ok, true);
  assert.throws(() => gates.check(root, s, 'deploy'), (e) => e.exitCode === 1);
});

test('plan approval survives status changes but not packet changes', () => {
  const { root, s } = planned([TASK()]);
  s.tasks[0].status = 'integrated';
  s.tasks[0].attempts = 1;
  assert.equal(gates.check(root, s, 'plan').ok, true);
  s.tasks[0].files.push('src/extra.js');
  assert.match(gates.check(root, s, 'plan').reason, /stale/);
});

test('approvals are refused at the wrong stage', () => {
  const root = tmpdir();
  st.init(root);
  const s = st.newState({ title: 't' });
  assert.throws(() => gates.approve(root, s, 'plan'), /once plan and design are completed/);
  assert.throws(() => gates.approve(root, s, 'release'), /only while the release stage/);
});

test('plan completion checks AC coverage, packets and execution plan freshness', () => {
  const { root, s } = planned([TASK()], { approve: false });
  assert.deepEqual(rules.completeProblems(root, s, 'plan'), []);
  writeFile(root, '.agent-lifecycle/requirements.md', `${REQUIREMENTS}- AC-2: also this\n`);
  tasks.addTask(s, TASK({ files: ['src/b.js'], ac: ['AC-3'], checks: [] }));
  const p = rules.completeProblems(root, s, 'plan');
  assert.ok(p.includes('T2: no task-level checks'));
  assert.ok(p.includes('T2 references AC-3, which is not in requirements.md'));
  assert.ok(p.includes('AC-2 is not covered by any task'));
  assert.ok(p.includes('execution plan is out of date: run `adlc exec plan`'));
});

test('verify completion requires passing evidence recorded during verify', () => {
  const { root, s } = planned([TASK()]);
  s.stages.verify = { status: 'in_progress', started: st.now() };
  assert.match(rules.completeProblems(root, s, 'verify')[0], /no verification evidence/);
  evidence.run(root, { stage: 'verify', cmd: ['exit 1'], cwd: root });
  assert.match(rules.completeProblems(root, s, 'verify')[0], /failed \(exit 1/);
  evidence.run(root, { stage: 'verify', cmd: ['exit 1'], cwd: root, timeoutMs: 1000 });
  evidence.run(root, { stage: 'verify', cmd: ['true'], cwd: root });
  assert.equal(rules.completeProblems(root, s, 'verify').length, 1, 'the latest exit 1 run still fails');
});

test('release completion needs filled sections, trace evidence, traceability file and approval', () => {
  const { root, s } = planned([TASK({ checks: ['true'] })]);
  for (const x of ['build', 'verify', 'review']) s.stages[x] = { status: 'completed' };
  s.stages.release = { status: 'in_progress', started: st.now() };
  let p = rules.completeProblems(root, s, 'release');
  assert.ok(p.some((x) => /Rollback steps/.test(x)));
  assert.ok(p.includes('AC-1 has no passing task evidence'));
  evidence.run(root, { stage: 'build', task: 'T1', cmd: ['true'], cwd: root });
  writeFile(root, '.agent-lifecycle/release.md', '## Summary of changes\n- x\n## Migration\nNone.\n## Deployment steps\nNone.\n## Rollback steps\nRevert.\n');
  fs.writeFileSync(path.join(root, '.agent-lifecycle/traceability.md'), rules.renderTrace(rules.trace(root, s)));
  p = rules.completeProblems(root, s, 'release');
  assert.deepEqual(p.map((x) => x.split(':')[0]), ['release gate not approved']);
  gates.approve(root, s, 'release');
  assert.deepEqual(rules.completeProblems(root, s, 'release'), []);
});

test('trace links ACs to tasks and passing evidence', () => {
  const { root, s } = planned([TASK({ checks: ['true'] })]);
  const ev = evidence.run(root, { stage: 'build', task: 'T1', cmd: ['true'], cwd: root });
  const rows = rules.trace(root, s);
  assert.deepEqual(rows, [{ ac: 'AC-1', tasks: [{ id: 'T1', status: 'todo' }], evidence: [ev.file], verify: null }]);
  assert.match(rules.renderTrace(rows), /\| AC-1 \| T1 \(todo\) \|/);
});

test('sectionFilled ignores template hints', () => {
  assert.equal(rules.sectionFilled('## A\n_hint_\n## B\nreal', 'A'), false);
  assert.equal(rules.sectionFilled('## A\n_hint_\n## B\nreal', 'B'), true);
});

test('computeWaves groups by dependency level and splits overlaps, serial and coupled tasks', () => {
  const s = st.newState({ title: 't' });
  tasks.addTask(s, TASK({ files: ['a.js'] }));
  tasks.addTask(s, TASK({ files: ['b.js'] }));
  tasks.addTask(s, TASK({ files: ['a.js'] }));
  tasks.addTask(s, TASK({ files: ['package.json'] }));
  tasks.addTask(s, TASK({ files: ['e.js'], deps: ['T1'] }));
  tasks.addTask(s, TASK({ files: ['f.js'], coupled: true }));
  assert.deepEqual(exec.computeWaves(s, 2), { waves: [['T1', 'T2'], ['T3'], ['T4'], ['T6'], ['T5']], integration_order: ['T1', 'T2', 'T3', 'T4', 'T6', 'T5'] });
  assert.deepEqual(exec.computeWaves(s, 1).waves, [['T1'], ['T2'], ['T3'], ['T4'], ['T6'], ['T5']]);
});

test('serial detection matches basenames and treats glob entries as serial', () => {
  const s = st.newState({ title: 't' });
  assert.equal(exec.isSerial(s, { files: ['web/package-lock.json'], coupled: false }), true);
  assert.equal(exec.isSerial(s, { files: ['src/**'], coupled: false }), true);
  assert.equal(exec.isSerial(s, { files: ['src/app.js'], coupled: false }), false);
});

test('a dependency cycle through contracts is reported', () => {
  const s = st.newState({ title: 't' });
  tasks.addTask(s, TASK({ files: ['a.js'] }));
  tasks.addTask(s, TASK({ files: ['b.js'], deps: ['T1'] }));
  tasks.addContract(s, { title: 'c', spec: 'x', provided_by: 'T2' });
  s.tasks[0].contracts.consumes = ['C-1'];
  assert.throws(() => exec.computeWaves(s, 2), /dependency cycle among tasks: T1, T2/);
});

test('auto resolves to shared when a wave has two independent M/L tasks, and records why', () => {
  const { root, s } = planned([TASK(), TASK({ files: ['src/b.js'] })]);
  assert.equal(s.execution.mode, 'shared');
  assert.match(s.execution.reasons[0], /independent tasks found \(wave 1: T1, T2\)/);
  assert.match(s.execution.reasons[1], /worktree mode is not available/);
  assert.deepEqual(s.execution.waves, [['T1', 'T2']]);
  const plan = fs.readFileSync(path.join(root, '.agent-lifecycle/plan.md'), 'utf8');
  assert.match(plan, /- mode: shared \(requested: auto/);
  assert.match(plan, /\*\*T2\*\* Task — files: src\/b\.js/);
  assert.match(plan, /## Context/, 'human sections are preserved');
});

test('mode resolution falls back to sequential with a reason', () => {
  const cases = [
    [[TASK()], /fewer than two tasks/],
    [[TASK({ size: 'S' }), TASK({ size: 'S', files: ['src/b.js'] })], /no wave has two independent tasks/],
    [[TASK(), TASK({ files: ['src/b.js'], deps: ['T1'] })], /no wave has two independent tasks/],
    [[TASK(), TASK({ files: ['src/a.js'] })], /no wave has two independent tasks/],
  ];
  for (const [list, reason] of cases) {
    const { s } = planned(list);
    assert.equal(s.execution.mode, 'sequential');
    assert.match(s.execution.reasons[0], reason);
  }
  const one = planned([TASK(), TASK({ files: ['src/b.js'] })], { max: 1 });
  assert.match(one.s.execution.reasons[0], /max_parallel is 1/);
});

test('dispatch check lists every failing reason', () => {
  const { root, s } = planned([TASK()], { approve: false });
  s.stages.build = { status: 'pending' };
  const p = dispatch.checkDispatch(root, s, 'T1');
  assert.ok(p.some((x) => /build stage is not in progress/.test(x)));
  assert.ok(p.some((x) => /plan gate not approved/.test(x)));
  assert.deepEqual(dispatch.checkDispatch(root, s, 'T9'), ['unknown task T9']);
});

test('dispatch start creates one lease, renders the packet and prevents duplicates', () => {
  const { root, s } = planned([TASK(), TASK({ files: ['src/b.js'] })], { mode: 'sequential' });
  assert.deepEqual(dispatch.readyToDispatch(root, s).map((t) => t.id), ['T1']);
  const lease = dispatch.startDispatch(root, s, 'T1', { session: 'sess-1' });
  assert.match(lease.lease, /^L-[0-9a-f]{6}$/);
  assert.equal(s.tasks[0].status, 'dispatched');
  assert.equal(s.budget.tasks_this_run, 1);
  assert.ok(fs.existsSync(path.join(root, '.agent-lifecycle/packets/T1.md')));
  assert.throws(() => dispatch.startDispatch(root, s, 'T1', { session: 'sess-1' }), /task status is dispatched/);
  assert.ok(dispatch.checkDispatch(root, s, 'T2').some((x) => /active workers 1 >= limit 1 \(sequential mode\)/.test(x)));
});

test('dispatch rejects overlap, shared resources, serial tasks and exhausted budgets in parallel mode', () => {
  const { root, s } = planned([
    TASK({ files: ['a.js'], resources: ['db'] }),
    TASK({ files: ['a.js'] }),
    TASK({ files: ['b.js'], resources: ['db'] }),
    TASK({ files: ['package.json'] }),
    TASK({ files: ['c.js'] }),
  ], { mode: 'shared', max: 4 });
  dispatch.startDispatch(root, s, 'T1', { session: 's' });
  assert.ok(dispatch.checkDispatch(root, s, 'T2').some((x) => /overlap with active task T1/.test(x)));
  assert.ok(dispatch.checkDispatch(root, s, 'T3').some((x) => /overlap with active task T1/.test(x)));
  assert.ok(dispatch.checkDispatch(root, s, 'T4').includes('serial task cannot run alongside other tasks'));
  assert.deepEqual(dispatch.checkDispatch(root, s, 'T5'), []);
  s.budget.max_tasks_per_run = 1;
  assert.ok(dispatch.checkDispatch(root, s, 'T5').some((x) => /task budget for this run reached/.test(x)));
});

test('readyToDispatch only parallelises non-trivial tasks', () => {
  const small = planned([TASK({ size: 'S' }), TASK({ size: 'S', files: ['src/b.js'] })], { mode: 'shared' });
  assert.deepEqual(dispatch.readyToDispatch(small.root, small.s).map((t) => t.id), ['T1']);
  const big = planned([TASK(), TASK({ files: ['src/b.js'] })], { mode: 'shared' });
  assert.deepEqual(dispatch.readyToDispatch(big.root, big.s).map((t) => t.id), ['T1', 'T2']);
});

test('a new session resets the per-run task budget', () => {
  const { root, s } = planned([TASK(), TASK({ files: ['src/b.js'] })], { mode: 'sequential' });
  s.budget.max_tasks_per_run = 1;
  dispatch.startDispatch(root, s, 'T1', { session: 'a' });
  s.leases[0].status = 'returned';
  s.tasks[0].status = 'integrated';
  assert.throws(() => dispatch.startDispatch(root, s, 'T2', { session: 'a' }), /task budget/);
  dispatch.startDispatch(root, s, 'T2', { session: 'b' });
  assert.equal(s.budget.tasks_this_run, 1);
});

test('lease lost repairs the task; lease stopped needs a note', () => {
  const { root, s } = planned([TASK()]);
  const lease = dispatch.startDispatch(root, s, 'T1', { session: 's' });
  assert.throws(() => dispatch.confirmStopped(s, lease.lease, ''), (e) => e.exitCode === 1);
  assert.equal(dispatch.markLost(s, lease.lease, 'workspace empty'), 'todo');
  assert.equal(s.tasks[0].attempts, 1);
  assert.throws(() => dispatch.markLost(s, lease.lease, 'again'), /already lost/);
});

function workerRun(root, s, { files = ['src/a.js'], agent = 'agent-1', stop = true, claim = true, extraWrite } = {}) {
  const lease = dispatch.startDispatch(root, s, 'T1', { session: 's' });
  const runs = st.paths(root).runs;
  if (claim) fsu.atomicWrite(path.join(runs, 'bindings.json'), JSON.stringify({ [agent]: { task: 'T1', lease: lease.lease } }));
  for (const f of [...files, ...(extraWrite ? [extraWrite] : [])]) {
    writeFile(root, f, 'x');
    fsu.appendLine(path.join(runs, 'writes.jsonl'), { agent_id: agent, path: f });
  }
  const ev = evidence.run(root, { stage: 'build', task: 'T1', cmd: ['true'], cwd: root });
  integrate.submitHandoff(root, s, 'T1', {
    task: 'T1', status: 'done', workspace: root, branch: null, files_changed: files, summary: 'did it',
    checks: [{ cmd: 'true', exit: 0, evidence: ev.file }], interface_changes: [], blockers: [], integration_notes: '', out_of_scope: [],
  });
  if (stop) fsu.appendLine(path.join(runs, 'stops.jsonl'), { agent_id: agent, lease: lease.lease, task: 'T1' });
  return lease;
}

test('integrate check passes with evidence, a stop record and in-scope writes', () => {
  const { root, s } = planned([TASK()]);
  workerRun(root, s);
  const r = integrate.integrateCheck(root, s, 'T1');
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.cross_checks, ['true']);
  integrate.recordReturned(s, 'T1');
  assert.equal(s.tasks[0].status, 'returned');
  assert.equal(s.leases[0].status, 'returned');
});

test('integrate check reports missing stop record and out-of-scope writes', () => {
  const { root, s } = planned([TASK()]);
  workerRun(root, s, { stop: false, extraWrite: 'README.md' });
  const p = integrate.integrateCheck(root, s, 'T1').problems;
  assert.ok(p.some((x) => /no SubagentStop record/.test(x)));
  assert.ok(p.includes("changed files outside T1's writable set: README.md"));
  dispatch.confirmStopped(s, s.leases[0].lease, 'foreground worker returned');
  assert.ok(!integrate.integrateCheck(root, s, 'T1').problems.some((x) => /SubagentStop/.test(x)));
});

test('integrate check rejects claimed checks that do not match evidence', () => {
  const { root, s } = planned([TASK()]);
  workerRun(root, s);
  const hf = integrate.handoffPath(root, 'T1');
  const h = JSON.parse(fs.readFileSync(hf, 'utf8'));
  h.checks[0].exit = 1;
  h.checks.push({ cmd: 'npm test', exit: 0, evidence: 'test-results/E-made-up.md' });
  fs.writeFileSync(hf, JSON.stringify(h));
  const p = integrate.integrateCheck(root, s, 'T1').problems;
  assert.ok(p.some((x) => /claimed check "true" \(exit 1\) does not match/.test(x)));
  assert.ok(p.some((x) => /claimed check "npm test" has no evidence record/.test(x)));
});

test('integrate done requires cross-task checks after the task returned', () => {
  const { root, s } = planned([TASK()]);
  workerRun(root, s);
  integrate.recordReturned(s, 'T1');
  assert.throws(() => integrate.integrateDone(root, s, 'T1'), /cross-task check "true" has not been run/);
  evidence.run(root, { stage: 'build', cmd: ['true'], cwd: root });
  integrate.integrateDone(root, s, 'T1');
  assert.equal(s.tasks[0].status, 'integrated');
});

test('validateHandoff and submitHandoff reject malformed handoffs', () => {
  assert.deepEqual(integrate.validateHandoff([]), ['handoff must be a JSON object']);
  assert.ok(integrate.validateHandoff({ status: 'great' }).length >= 5);
  const { root, s } = planned([TASK()]);
  assert.throws(() => integrate.submitHandoff(root, s, 'T1', { task: 'T1' }), /handoff rejected/);
});
