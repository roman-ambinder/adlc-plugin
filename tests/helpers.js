'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'adlc');
const lib = (name) => require(path.join(PLUGIN, 'lib', name));

function tmpdir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'adlc-test-')));
}

function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('CLAUDE_') || k.startsWith('ADLC_')) delete env[k];
  return { ...env, ...extra };
}

function cli(root, args, extraEnv = {}) {
  return spawnSync(process.execPath, [path.join(PLUGIN, 'bin', 'adlc'), ...args], {
    cwd: root, encoding: 'utf8', env: cleanEnv({ ADLC_ROOT: root, ...extraEnv }),
  });
}

function hook(name, input, root, extraEnv = {}) {
  return spawnSync(process.execPath, [path.join(PLUGIN, 'hooks', `${name}.js`)], {
    input: JSON.stringify(input), encoding: 'utf8', env: cleanEnv({ CLAUDE_PROJECT_DIR: root, ...extraEnv }),
  });
}

function ok(r) {
  if (r.status !== 0) throw new Error(`exit ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  return r.stdout;
}

function writeFile(root, rel, text) {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
  return f;
}

const REQUIREMENTS = '# Requirements\n\n## Acceptance criteria\n- AC-1: the demo behaviour works\n';
const TASK = (over = {}) => ({ title: 'Task', goal: 'Do it', files: ['src/a.js'], checks: ['true'], ac: ['AC-1'], size: 'M', ...over });

// Drives a change through the CLI to an in-progress build stage.
function toBuild(root, taskList, { mode = 'sequential', approve = true } = {}) {
  ok(cli(root, ['start', 'Demo change', '--small', '--parallel-mode', mode]));
  ok(cli(root, ['stage', 'start', 'specify']));
  writeFile(root, '.agent-lifecycle/requirements.md', REQUIREMENTS);
  ok(cli(root, ['stage', 'complete', 'specify']));
  ok(cli(root, ['stage', 'start', 'plan']));
  const f = writeFile(root, '.agent-lifecycle/tmp/tasks.json', JSON.stringify(taskList));
  ok(cli(root, ['task', 'add', '--file', f]));
  ok(cli(root, ['exec', 'plan']));
  ok(cli(root, ['stage', 'complete', 'plan']));
  if (approve) {
    ok(cli(root, ['approve', 'plan', '--note', 'test']));
    ok(cli(root, ['stage', 'start', 'build']));
  }
}

module.exports = { PLUGIN, lib, tmpdir, cli, hook, ok, writeFile, toBuild, TASK, REQUIREMENTS };
