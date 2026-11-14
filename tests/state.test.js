'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmpdir, lib } = require('./helpers');

const st = lib('state');

test('newState applies defaults and --small skips discover and design', () => {
  const s = st.newState({ title: 'Add Slugify!', small: true });
  assert.equal(s.schema, 1);
  assert.equal(s.revision, 0);
  assert.match(s.change.id, /^chg-\d{8}-add-slugify$/);
  assert.equal(s.stages.discover.status, 'skipped');
  assert.equal(s.stages.design.status, 'skipped');
  assert.equal(s.stages.specify.status, 'pending');
  assert.deepEqual(s.config.approval_gates, ['plan', 'release']);
  assert.equal(s.execution.resolved_from, 'auto');
  assert.equal(s.budget.max_repair_attempts, 3);
  assert.deepEqual(s.metrics, { retries: 0, integration_failures: 0, tokens: 'not observable', cost: 'not observable' });
  assert.throws(() => st.newState({ title: ' ' }), (e) => e.exitCode === 1);
  assert.throws(() => st.newState({ title: 'x', type: 'chore' }), (e) => e.exitCode === 1);
});

test('normalizeConfig: empty and unsubstituted values fall back to defaults; none disables gates', () => {
  const c = st.normalizeConfig({ approval_gates: '${user_config.approval_gates}', max_parallel: '' });
  assert.deepEqual(c.approval_gates, ['plan', 'release']);
  assert.equal(c.max_parallel, 2);
  assert.deepEqual(st.normalizeConfig({ approval_gates: 'none' }).approval_gates, []);
  assert.equal(st.normalizeConfig({ max_parallel: '4' }).max_parallel, 4);
  assert.throws(() => st.normalizeConfig({ max_parallel: 99 }), (e) => e.exitCode === 1);
  assert.throws(() => st.normalizeConfig({ approval_gates: 'plan,deploy' }), (e) => e.exitCode === 1);
  assert.throws(() => st.normalizeConfig({ parallel_mode: 'turbo' }), (e) => e.exitCode === 1);
});

test('init creates the layout, gitignore and templates without overwriting edits', () => {
  const root = tmpdir();
  const p = st.init(root);
  for (const d of ['tmp', 'runs', 'packets', 'handoffs', 'test-results', 'reviews']) assert.ok(fs.existsSync(path.join(p.dir, d)), d);
  assert.equal(fs.readFileSync(path.join(p.dir, '.gitignore'), 'utf8'), '.lock\n.check.lock\ntmp/\nruns/\n');
  fs.writeFileSync(path.join(p.dir, 'requirements.md'), 'mine');
  st.init(root);
  assert.equal(fs.readFileSync(path.join(p.dir, 'requirements.md'), 'utf8'), 'mine');
  assert.match(fs.readFileSync(path.join(p.dir, 'release.md'), 'utf8'), /## Rollback steps/);
});

test('create refuses a second change; load reports missing state with exit 4', () => {
  const root = tmpdir();
  assert.throws(() => st.load(root), (e) => e.exitCode === 4);
  st.create(root, st.newState({ title: 'one' }));
  assert.throws(() => st.create(root, st.newState({ title: 'two' })), (e) => e.exitCode === 2);
});

test('mutate increments revision and rejects concurrent modification', () => {
  const root = tmpdir();
  st.create(root, st.newState({ title: 't' }));
  st.mutate(root, (s) => { s.blocker = 'x'; });
  assert.equal(st.load(root).revision, 1);
  assert.equal(st.load(root).blocker, 'x');
  const file = st.paths(root).state;
  assert.throws(() => st.mutate(root, () => {
    const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
    disk.revision = 99;
    fs.writeFileSync(file, JSON.stringify(disk));
  }), (e) => e.exitCode === 3);
  assert.equal(st.load(root).revision, 99, 'the conflicting write is not overwritten');
});

test('load rejects unknown schema versions and invalid JSON', () => {
  const root = tmpdir();
  st.create(root, st.newState({ title: 't' }));
  const file = st.paths(root).state;
  fs.writeFileSync(file, JSON.stringify({ schema: 2 }));
  assert.throws(() => st.load(root), /unsupported state schema 2/);
  fs.writeFileSync(file, '{');
  assert.throws(() => st.load(root), /not valid JSON/);
});

test('findRoot walks up to the directory holding state.json', () => {
  const root = tmpdir();
  st.create(root, st.newState({ title: 't' }));
  const nested = path.join(root, 'a', 'b');
  fs.mkdirSync(nested, { recursive: true });
  assert.equal(st.findRoot(nested), root);
});

test('load reports a damaged state file against the schema, and handoffs use their schema', () => {
  const { tmpdir, lib } = require('./helpers');
  const schema = lib('schema');
  const st2 = lib('state');
  const root = tmpdir();
  st2.create(root, st2.newState({ title: 'x' }));
  const file = st2.paths(root).state;
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  s.tasks = [{ ...lib('tasks').addTask(st2.newState({ title: 'y' }), { title: 't', goal: 'g', files: ['a.js'] }), id: 'X1', status: 'weird' }];
  delete s.leases;
  fs.writeFileSync(file, JSON.stringify(s));
  assert.throws(() => st2.load(root), (e) => e.exitCode === 2 && /missing "leases"/.test(e.message) && /tasks\[0\]\.id: must match/.test(e.message) && /tasks\[0\]\.status: must be one of/.test(e.message));
  assert.deepEqual(schema.check('state', st2.newState({ title: 'ok' })), []);
  assert.match(lib('integrate').validateHandoff({ task: 'T1', status: 'done' }).join('\n'), /missing "workspace"/);
});
