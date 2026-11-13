'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmpdir, lib } = require('./helpers');

const fsu = lib('fsutil');
const glob = lib('glob');

test('atomicWrite writes the full content and leaves no temp files', () => {
  const d = tmpdir();
  const f = path.join(d, 'a', 'x.json');
  fsu.atomicWrite(f, '{"a":1}');
  assert.equal(fs.readFileSync(f, 'utf8'), '{"a":1}');
  assert.deepEqual(fs.readdirSync(path.dirname(f)), ['x.json']);
});

test('readJsonLines skips a torn trailing line', () => {
  const f = path.join(tmpdir(), 'l.jsonl');
  fs.writeFileSync(f, '{"a":1}\n{"b":');
  assert.deepEqual(fsu.readJsonLines(f), [{ a: 1 }]);
  fsu.appendLine(f, { c: 2 });
  assert.deepEqual(fsu.readJsonLines(f), [{ a: 1 }, { c: 2 }], 'a record appended after a torn line starts on its own line');
  assert.deepEqual(fsu.readJsonLines(path.join(tmpdir(), 'missing.jsonl')), []);
});

test('acquireLock is exclusive and reclaims stale locks', () => {
  const l = path.join(tmpdir(), '.lock');
  const release = fsu.acquireLock(l);
  assert.throws(() => fsu.acquireLock(l), (e) => e.exitCode === 3);
  release();
  fsu.acquireLock(l)();
  fs.writeFileSync(l, '{}');
  const old = new Date(Date.now() - 11 * 60 * 1000);
  fs.utimesSync(l, old, old);
  fsu.acquireLock(l)();
  assert.equal(fs.existsSync(l), false);
});

test('withLock releases the lock when fn throws', () => {
  const l = path.join(tmpdir(), '.lock');
  assert.throws(() => fsu.withLock(l, () => { throw new Error('boom'); }), /boom/);
  assert.equal(fs.existsSync(l), false);
});

test('replaceSection replaces only the marked block or appends one', () => {
  const t = 'intro\n<!-- adlc:begin k -->\nold\n<!-- adlc:end k -->\noutro\n';
  assert.equal(fsu.replaceSection(t, 'k', 'new'), 'intro\n<!-- adlc:begin k -->\nnew\n<!-- adlc:end k -->\noutro\n');
  assert.equal(fsu.replaceSection('hi\n', 'k', 'v'), 'hi\n\n<!-- adlc:begin k -->\nv\n<!-- adlc:end k -->\n');
  assert.equal(fsu.replaceSection('', 'k', 'v'), '<!-- adlc:begin k -->\nv\n<!-- adlc:end k -->\n');
});

test('sha256 is stable', () => {
  assert.equal(fsu.sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('glob matching', () => {
  assert.ok(glob.matches('src/**/*.js', 'src/a/b.js'));
  assert.ok(glob.matches('src/**/*.js', 'src/b.js'));
  assert.ok(!glob.matches('src/*.js', 'src/a/b.js'));
  assert.ok(glob.matches('*lock*', 'web/package-lock.json'));
  assert.ok(glob.matches('src/', 'src/x/y.ts'));
  assert.ok(glob.matches('a.js', './a.js'));
  assert.ok(!glob.matches('a.js', 'src/a.js'));
});

test('entriesOverlap is conservative', () => {
  assert.ok(glob.entriesOverlap('src/a.js', 'src/a.js'));
  assert.ok(!glob.entriesOverlap('src/a.js', 'src/b.js'));
  assert.ok(glob.entriesOverlap('src/', 'src/b.js'));
  assert.ok(glob.entriesOverlap('src/**', 'src/x/*.ts'));
  assert.ok(!glob.entriesOverlap('src/**', 'test/**'));
  assert.ok(glob.entriesOverlap('src/*.js', 'src/a.js'));
  assert.ok(glob.setsOverlap(['a.js', 'b.js'], ['c.js', 'b.js']));
  assert.ok(!glob.setsOverlap(['a.js'], ['c.js']));
});
