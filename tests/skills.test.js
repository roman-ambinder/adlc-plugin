'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PLUGIN } = require('./helpers');

const read = (rel) => fs.readFileSync(path.join(PLUGIN, rel), 'utf8');
const frontmatter = (text) => {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(m, 'missing frontmatter');
  return m[1];
};

// Files the model reads raw (not loaded as a skill) are never substituted, so they must not rely on ${...}.
test('raw-read rule files contain no substitution variables', () => {
  for (const rel of ['skills/coordinator/SKILL.md', 'skills/worker-contract/SKILL.md']) {
    assert.doesNotMatch(read(rel), /\$\{(CLAUDE_|user_config)/, rel);
  }
});

test('skills that run adlc commands provide the runtime values the coordinator rules refer to', () => {
  for (const name of ['start', 'plan', 'next', 'verify', 'review', 'release', 'resume']) {
    const text = read(`skills/${name}/SKILL.md`);
    assert.match(text, /\$\{CLAUDE_SESSION_ID\}/, name);
    assert.match(text, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/adlc"/, name);
  }
});

test('user_config values reach the shell single-quoted', () => {
  const text = read('skills/start/SKILL.md');
  assert.doesNotMatch(text, /"\$\{user_config/);
  assert.match(text, /'\$\{user_config\.approval_gates\}'/);
});

test('approve, skip, unblock and archive are user-only; coordinator and worker-contract are model-only', () => {
  for (const name of ['approve', 'skip', 'unblock', 'archive']) assert.match(frontmatter(read(`skills/${name}/SKILL.md`)), /disable-model-invocation: true/, name);
  for (const name of ['coordinator', 'worker-contract']) assert.match(frontmatter(read(`skills/${name}/SKILL.md`)), /user-invocable: false/, name);
});

test('agents use only fields supported for plugin agents and least-privilege tools', () => {
  const ignored = /^(permissionMode|hooks|mcpServers|initialPrompt):/m;
  const tools = {};
  for (const f of fs.readdirSync(path.join(PLUGIN, 'agents'))) {
    const fm = frontmatter(read(`agents/${f}`));
    assert.doesNotMatch(fm, ignored, f);
    assert.match(fm, /^maxTurns: \d+$/m, f);
    tools[f] = /^tools: (.*)$/m.exec(fm)[1].split(/,\s*/);
    assert.ok(!tools[f].includes('Agent'), `${f} must not spawn subagents`);
  }
  assert.deepEqual(tools['reviewer.md'], ['Read', 'Grep', 'Glob', 'Bash']);
  assert.ok(!tools['analyst.md'].includes('Bash'));
  assert.ok(!tools['architect.md'].includes('Bash'));
});
