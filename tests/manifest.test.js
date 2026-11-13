'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PLUGIN, lib } = require('./helpers');

const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

test('plugin manifest declares name, version and userConfig options', () => {
  const m = read(path.join(PLUGIN, '.claude-plugin', 'plugin.json'));
  assert.equal(m.name, 'adlc');
  assert.match(m.version, /^\d+\.\d+\.\d+$/);
  for (const key of ['approval_gates', 'guard_level', 'max_repair_attempts', 'max_tasks_per_run', 'parallel_mode', 'max_parallel', 'serial_globs']) {
    assert.ok(m.userConfig[key], `missing userConfig.${key}`);
    assert.ok(m.userConfig[key].title && m.userConfig[key].description, `${key} needs title and description`);
  }
});

test('marketplace lists the plugin by relative path', () => {
  const mk = read(path.join(__dirname, '..', '.claude-plugin', 'marketplace.json'));
  assert.equal(mk.name, 'adlc-marketplace');
  assert.deepEqual(mk.plugins.map((p) => [p.name, p.source]), [['adlc', './plugins/adlc']]);
});

test('errors carry exit codes', () => {
  const { EXIT, AdlcError, usage, rule } = lib('errors');
  assert.equal(usage('x').exitCode, EXIT.USAGE);
  assert.equal(rule('x').exitCode, EXIT.RULE);
  assert.ok(new AdlcError(EXIT.CONFLICT, 'c') instanceof Error);
});
