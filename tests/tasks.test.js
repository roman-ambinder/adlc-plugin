'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { lib, tmpdir, TASK } = require('./helpers');

const st = lib('state');
const tasks = lib('tasks');
const packets = lib('packets');

function chain() {
  const s = st.newState({ title: 't' });
  tasks.addTask(s, TASK({ title: 'A', files: ['a.js'] }));
  tasks.addTask(s, TASK({ title: 'B', files: ['b.js'], deps: ['T1'] }));
  tasks.addTask(s, TASK({ title: 'C', files: ['c.js'], deps: ['T2'] }));
  return s;
}

test('addTask assigns ids and validates input', () => {
  const s = chain();
  assert.deepEqual(s.tasks.map((t) => t.id), ['T1', 'T2', 'T3']);
  assert.equal(s.tasks[0].max_attempts, 3);
  assert.throws(() => tasks.addTask(s, TASK({ deps: ['T9'] })), /unknown dependency T9/);
  assert.throws(() => tasks.addTask(s, TASK({ files: [] })), (e) => e.exitCode === 1);
  assert.throws(() => tasks.addTask(s, TASK({ size: 'XL' })), (e) => e.exitCode === 1);
  assert.throws(() => tasks.addTask(s, TASK({ id: 'T1' })), /already exists/);
  assert.throws(() => tasks.addTask(s, TASK({ title: '' })), (e) => e.exitCode === 1);
});

test('updateTask only changes todo tasks and allowed fields', () => {
  const s = chain();
  tasks.updateTask(s, 'T3', { files: ['c.js', 'c.test.js'] });
  assert.deepEqual(s.tasks[2].files, ['c.js', 'c.test.js']);
  assert.throws(() => tasks.updateTask(s, 'T3', { status: 'integrated' }), /cannot update field/);
  s.tasks[0].status = 'dispatched';
  assert.throws(() => tasks.updateTask(s, 'T1', { goal: 'x' }), /only todo tasks/);
});

test('readiness requires integrated prerequisites', () => {
  const s = chain();
  assert.deepEqual(tasks.readyTasks(s).map((t) => t.id), ['T1']);
  s.tasks[0].status = 'integrated';
  assert.deepEqual(tasks.readyTasks(s).map((t) => t.id), ['T2']);
});

test('contract consumers wait for the provider', () => {
  const s = st.newState({ title: 't' });
  tasks.addTask(s, TASK({ files: ['api.js'] }));
  const c = tasks.addContract(s, { title: 'api', spec: 'fn(x) -> y', provided_by: 'T1' });
  assert.equal(c.id, 'C-1');
  assert.deepEqual(s.tasks[0].contracts.provides, ['C-1']);
  tasks.addTask(s, TASK({ files: ['ui.js'], contracts: { consumes: ['C-1'] } }));
  assert.deepEqual(tasks.prereqs(s, s.tasks[1]), ['T1']);
  assert.deepEqual(tasks.readyTasks(s).map((t) => t.id), ['T1']);
  assert.throws(() => tasks.addContract(s, { title: 'x', spec: 'y', provided_by: 'T7' }), /unknown task T7/);
});

test('blockTask cascades to transitive dependents and unblockTask restores them', () => {
  const s = chain();
  tasks.blockTask(s, 'T1', 'broken');
  assert.deepEqual(s.tasks.map((t) => [t.status, t.blocker]), [['blocked', 'broken'], ['blocked', 'prerequisite T1 blocked'], ['blocked', 'prerequisite T1 blocked']]);
  tasks.unblockTask(s, 'T1');
  assert.deepEqual(s.tasks.map((t) => t.status), ['todo', 'todo', 'todo']);
});

test('repairTask counts attempts and blocks the change at the limit', () => {
  const s = chain();
  const t = s.tasks[0];
  assert.throws(() => tasks.repairTask(s, 'T1'), /only dispatched/);
  for (let i = 1; i <= 2; i += 1) {
    t.status = 'dispatched';
    assert.equal(tasks.repairTask(s, 'T1', `fail ${i}`), 'todo');
  }
  t.status = 'dispatched';
  assert.equal(tasks.repairTask(s, 'T1', 'fail 3'), 'blocked');
  assert.equal(t.attempts, 3);
  assert.equal(s.metrics.retries, 3);
  assert.match(s.blocker, /T1 exhausted/);
  assert.equal(s.tasks[1].status, 'blocked');
});

test('canonicalTasks ignores run-time status', () => {
  const s = chain();
  const before = JSON.stringify(tasks.canonicalTasks(s));
  s.tasks[0].status = 'integrated';
  s.tasks[0].attempts = 2;
  assert.equal(JSON.stringify(tasks.canonicalTasks(s)), before);
});

test('packetProblems and renderPacket', () => {
  const root = tmpdir();
  st.init(root);
  const s = chain();
  s.execution.mode = 'sequential';
  assert.deepEqual(packets.packetProblems(s, s.tasks[0]), []);
  s.tasks[0].checks = [];
  s.tasks[0].contracts.consumes = ['C-9'];
  assert.deepEqual(packets.packetProblems(s, s.tasks[0]), ['no task-level checks', 'consumes unknown contract C-9']);
  const md = packets.renderPacket(s, s.tasks[1]);
  assert.match(md, /## Writable files \(only these\)\n- b\.js/);
  assert.match(md, /adlc run --stage build --task T2/);
  assert.match(md, /task T1 \(integrated\)/);
  const files = packets.writePackets(root, s, ['T2']);
  assert.equal(files.length, 1);
  assert.match(fs.readFileSync(files[0], 'utf8'), /# Build packet T2: B/);
});
