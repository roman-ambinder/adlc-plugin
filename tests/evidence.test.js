'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { lib, tmpdir } = require('./helpers');

const st = lib('state');
const evidence = lib('evidence');
const { redact } = lib('redact');

test('redact masks common secret shapes', () => {
  const gh = `ghp_${'a'.repeat(30)}`;
  const out = redact(`AKIAABCDEFGHIJKLMNOP token=abc123 ${gh} password: "hunter2" Bearer ${'x'.repeat(20)}`);
  for (const secret of ['AKIAABCDEFGHIJKLMNOP', 'abc123', gh, 'hunter2', 'x'.repeat(20)]) assert.ok(!out.includes(secret), secret);
  assert.match(out, /token=\[REDACTED\]/);
  assert.equal(redact('plain text 42'), 'plain text 42');
});

test('run records exit code, duration and redacted output', () => {
  const root = tmpdir();
  st.init(root);
  const r = evidence.run(root, { stage: 'verify', cmd: ['echo secret=shh; echo visible; exit 3'], cwd: root });
  assert.equal(r.exit, 3);
  assert.match(r.file, /^test-results\/E-\d+-[0-9a-f]+-verify\.md$/);
  const body = fs.readFileSync(path.join(st.paths(root).dir, r.file), 'utf8');
  assert.match(body, /exit code: 3/);
  assert.match(body, /visible/);
  assert.ok(!body.includes('shh'));
  const listed = evidence.list(root);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].cmd, 'echo secret=[REDACTED]; echo visible; exit 3');
});

test('run with argv form records the joined command and the task', () => {
  const root = tmpdir();
  st.init(root);
  const r = evidence.run(root, { stage: 'build', task: 'T1', cmd: ['node', '-e', 'process.exit(0)'], cwd: root });
  assert.equal(r.exit, 0);
  assert.equal(r.task, 'T1');
  assert.equal(r.cmd, 'node -e "process.exit(0)"');
});

test('run truncates long output to the last 200 lines', () => {
  const root = tmpdir();
  st.init(root);
  const r = evidence.run(root, { stage: 'verify', cmd: ['seq 1 500'], cwd: root });
  assert.equal(r.truncated, true);
  const body = fs.readFileSync(path.join(st.paths(root).dir, r.file), 'utf8');
  assert.match(body, /300 earlier lines truncated/);
  assert.ok(body.includes('\n500\n'));
  assert.ok(!body.includes('\n300\n'));
});

test('run reports a missing executable as exit 127', () => {
  const root = tmpdir();
  st.init(root);
  assert.equal(evidence.run(root, { stage: 'verify', cmd: ['definitely-not-a-command-xyz', 'a'], cwd: root }).exit, 127);
  assert.throws(() => evidence.run(root, { stage: 'verify', cmd: [] }), (e) => e.exitCode === 1);
  assert.throws(() => evidence.run(root, { cmd: ['true'] }), (e) => e.exitCode === 1);
});

test('exclusive runs take and release the check lock', () => {
  const root = tmpdir();
  st.init(root);
  evidence.run(root, { stage: 'build', cmd: ['true'], cwd: root, exclusive: true });
  assert.equal(fs.existsSync(st.paths(root).checkLock), false);
});

test('latestByCmd keeps the newest run per command', () => {
  const m = evidence.latestByCmd([{ cmd: 'a', exit: 1 }, { cmd: 'b', exit: 0 }, { cmd: 'a', exit: 0 }]);
  assert.equal(m.get('a').exit, 0);
  assert.equal(m.size, 2);
});
