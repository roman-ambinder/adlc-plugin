'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmpdir, cli, ok } = require('./helpers');

test('examples/slugify/run.sh drives one feature through every stage', () => {
  const work = tmpdir();
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('CLAUDE_') || k.startsWith('ADLC_') || k === 'EXPORT') delete env[k];
  const r = spawnSync('bash', [path.join(__dirname, '..', 'examples', 'slugify', 'run.sh'), work], { encoding: 'utf8', env, timeout: 120000 });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /build refused without approval, as expected/);
  assert.match(r.stdout, /guard denied out-of-scope write to README\.md, as expected/);
  assert.match(r.stdout, /guard denied git for the worker, as expected/);
  const s = JSON.parse(ok(cli(work, ['status', '--json'])));
  assert.equal(s.stage, 'done');
  assert.equal(s.tasks[0].status, 'integrated');
  const trace = fs.readFileSync(path.join(work, '.agent-lifecycle/traceability.md'), 'utf8');
  for (const ac of ['AC-1', 'AC-2', 'AC-3']) assert.match(trace, new RegExp(`\\| ${ac} \\| T1 \\(integrated\\) \\| test-results/`));
});
