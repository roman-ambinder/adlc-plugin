'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const headings = (text) => [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());

test('docs: every relative link in README.md and docs/*.md points to an existing file', () => {
  const files = ['README.md', 'SECURITY.md', 'CONTRIBUTING.md', ...fs.readdirSync(path.join(REPO, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`)];
  for (const rel of files) {
    if (!fs.existsSync(path.join(REPO, rel))) continue;
    for (const m of read(rel).matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1].split('#')[0];
      if (!target || /^[a-z]+:/i.test(target)) continue;
      assert.ok(fs.existsSync(path.resolve(REPO, path.dirname(rel), target)), `${rel} links to missing ${m[1]}`);
    }
  }
});

test('docs: moved reference sections exist', () => {
  const config = read('docs/configuration.md');
  assert.ok(headings(config).includes('Options') && headings(config).includes('Worktree mode'));
  for (const key of Object.keys(JSON.parse(read('plugins/adlc/.claude-plugin/plugin.json')).userConfig)) assert.ok(config.includes(`\`${key}\``), key);
  const how = headings(read('docs/how-it-works.md'));
  for (const h of ['Architecture', 'Project state', 'Exit codes']) assert.ok(how.includes(h), h);
  const safety = read('docs/safety.md');
  assert.ok(headings(safety).includes('Limits'));
  assert.match(safety, /best-effort/);
  const trouble = read('docs/troubleshooting.md');
  for (const symptom of [
    '`adlc: command not found` in Bash', '`the user has not asked for this`', '`no active change` (exit 4)',
    '`plan gate not approved` / `approval is stale`', '`state.json does not match schemas/state.schema.json`',
    '`state changed concurrently` (exit 3)', '`no SubagentStop record for L-…`',
    '`approved task check … has not been run in this verify stage`', '`cannot count the findings`',
    '`release approval is stale` right after approving', 'Task blocked after repeated failures', 'Hooks seem inactive',
    'Need to see what hooks receive', 'Too many permission prompts',
  ]) assert.ok(trouble.includes(symptom), symptom);
  assert.ok(headings(read('docs/development.md')).includes('Releasing'));
});

test('docs: README leads with why, demo, quickstart, cost and limits', () => {
  const readme = read('README.md');
  const h = headings(readme);
  const order = ['Why', 'Demo', 'Quickstart', 'Cost and limits', 'Commands'].map((x) => h.indexOf(x));
  assert.ok(order.every((i) => i >= 0), `missing heading: ${h.join(', ')}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'headings out of order');
  const { version } = require('../scripts/release-notes');
  assert.ok(readme.includes(`Version ${version()}.`));
  assert.ok(readme.includes('/adlc:setup'));
  assert.match(readme, /best-effort/);
});
