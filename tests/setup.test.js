'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PLUGIN, tmpdir, cli, ok, writeFile } = require('./helpers');

const settingsOf = (root) => JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'));
const gitignoreOf = (root) => fs.readFileSync(path.join(root, '.gitignore'), 'utf8');

function gitRepo() {
  const root = tmpdir();
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  return root;
}

// Runs the CLI from `cwd` without ADLC_ROOT, so the project root is found the way a user's session finds it.
function cliAt(cwd, args) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('CLAUDE_') || k.startsWith('ADLC_')) delete env[k];
  return spawnSync(process.execPath, [path.join(PLUGIN, 'bin', 'adlc'), ...args], { cwd, encoding: 'utf8', env });
}

test('setup: fresh repo gets settings and gitignore; second run changes nothing', () => {
  const root = tmpdir();
  ok(cli(root, ['setup']));
  const s = settingsOf(root);
  assert.ok(s.permissions.allow.includes('Bash(adlc status)'));
  assert.ok(s.permissions.allow.includes('Bash(adlc start *)'));
  assert.ok(s.permissions.ask.includes('Bash(git commit *)'));
  assert.ok(s.permissions.deny.includes('Read(./.env)'));
  assert.equal(s.worktree.baseRef, 'head');
  assert.ok(gitignoreOf(root).split('\n').includes('.claude/worktrees/'));
  const files = [path.join(root, '.claude', 'settings.json'), path.join(root, '.gitignore')];
  const before = files.map((f) => fs.readFileSync(f, 'utf8'));
  const r = cli(root, ['setup']);
  assert.equal(ok(r), 'already set up: nothing to change\n');
  assert.deepEqual(files.map((f) => fs.readFileSync(f, 'utf8')), before);
});

test('setup --dry-run writes nothing and lists what it would add', () => {
  const root = tmpdir();
  const out = ok(cli(root, ['setup', '--dry-run']));
  assert.match(out, /^would add to \.claude\/settings\.json: permissions\.allow Bash\(adlc status\)$/m);
  assert.match(out, /^would add to \.gitignore: \.claude\/worktrees\/$/m);
  assert.ok(!fs.existsSync(path.join(root, '.claude')));
  assert.ok(!fs.existsSync(path.join(root, '.gitignore')));
});

test('setup keeps existing entries and unrelated keys', () => {
  const root = tmpdir();
  writeFile(root, '.claude/settings.json', JSON.stringify({ model: 'sonnet', permissions: { allow: ['Bash(ls *)'] } }));
  ok(cli(root, ['setup']));
  const s = settingsOf(root);
  assert.equal(s.model, 'sonnet');
  assert.equal(s.permissions.allow[0], 'Bash(ls *)');
  assert.ok(s.permissions.allow.includes('Bash(adlc status)'));
});

test('setup skips a template entry the user has in another list', () => {
  const root = tmpdir();
  writeFile(root, '.claude/settings.json', JSON.stringify({ permissions: { allow: ['Bash(git commit *)', 'Read(./.env)'] } }));
  const out = ok(cli(root, ['setup']));
  const s = settingsOf(root);
  assert.ok(!s.permissions.ask.includes('Bash(git commit *)'));
  assert.ok(!s.permissions.deny.includes('Read(./.env)'));
  assert.deepEqual(s.permissions.allow.slice(0, 2), ['Bash(git commit *)', 'Read(./.env)']);
  assert.match(out, /skipped Bash\(git commit \*\): you have it under allow/);
  assert.match(out, /skipped Read\(\.\/\.env\): you have it under allow/);
});

test('setup leaves a different worktree.baseRef and notes it', () => {
  const root = tmpdir();
  writeFile(root, '.claude/settings.json', JSON.stringify({ worktree: { baseRef: 'fresh' } }));
  const out = ok(cli(root, ['setup']));
  assert.equal(settingsOf(root).worktree.baseRef, 'fresh');
  assert.match(out, /note: worktree\.baseRef is "fresh"/);
});

test('setup refuses invalid settings JSON and wrong types, writing nothing', () => {
  for (const [text, msg] of [['{ "permissions": ', /not valid JSON/], ['{"permissions":{"allow":"x"}}', /permissions\.allow must be a list/], ['[]', /must be a JSON object/]]) {
    const root = tmpdir();
    const f = writeFile(root, '.claude/settings.json', text);
    const r = cli(root, ['setup']);
    assert.equal(r.status, 2, text);
    assert.match(r.stderr, msg);
    assert.equal(fs.readFileSync(f, 'utf8'), text);
    assert.ok(!fs.existsSync(path.join(root, '.gitignore')));
  }
});

test('setup gitignore variants', () => {
  const root = tmpdir();
  writeFile(root, '.gitignore', 'node_modules/');
  ok(cli(root, ['setup']));
  assert.equal(gitignoreOf(root), 'node_modules/\n.claude/worktrees/\n');
  for (const text of ['/.claude/worktrees/\r\n', '.claude/worktrees\n', 'a\n  .claude/worktrees/  \n']) {
    const r2 = tmpdir();
    writeFile(r2, '.gitignore', text);
    ok(cli(r2, ['setup']));
    assert.equal(gitignoreOf(r2), text);
  }
});

test('setup from a subdirectory writes at the git top level', () => {
  const root = gitRepo();
  fs.mkdirSync(path.join(root, 'src'));
  ok(cliAt(path.join(root, 'src'), ['setup']));
  assert.ok(fs.existsSync(path.join(root, '.claude', 'settings.json')));
  assert.ok(!fs.existsSync(path.join(root, 'src', '.claude')));
});

test('start prints a setup tip only when the project is not set up', () => {
  const a = tmpdir();
  assert.match(ok(cli(a, ['start', 'x'])), /run \/adlc:setup/i);
  const b = tmpdir();
  ok(cli(b, ['setup']));
  assert.doesNotMatch(ok(cli(b, ['start', 'x'])), /adlc:setup/);
});
