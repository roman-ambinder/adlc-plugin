'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'adlc');
const lib = (name) => require(path.join(PLUGIN, 'lib', name));

function tmpdir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'adlc-test-')));
}

// A private Claude Code config dir for the tests: session transcripts live in <it>/projects/.
const CONFIG = tmpdir();
process.env.CLAUDE_CONFIG_DIR = CONFIG;

function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('CLAUDE_') || k.startsWith('ADLC_')) delete env[k];
  return { ...env, CLAUDE_CONFIG_DIR: CONFIG, ...extra };
}

function transcriptFor(root) {
  const dir = path.join(CONFIG, 'projects', 'tests');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${crypto.createHash('sha1').update(root).digest('hex')}.jsonl`);
}

// Plays Claude Code recording a slash command the user typed, the way it appears in a real session transcript.
function typed(root, prompt) {
  const t = transcriptFor(root);
  const m = /^\s*\/(adlc:[a-z]+)\b\s*([\s\S]*)$/.exec(prompt);
  if (m) {
    const content = `<command-message>${m[1]}</command-message>\n<command-name>/${m[1]}</command-name>\n<command-args>${m[2].trim()}</command-args>`;
    fs.appendFileSync(t, `${JSON.stringify({ type: 'user', uuid: crypto.randomUUID(), timestamp: new Date().toISOString(), message: { role: 'user', content } })}\n`);
  }
  return t;
}

const USER_ONLY = ['approve', 'skip', 'unblock', 'archive', 'cancel'];

// Plays the user: submits the prompt the user would type, which the UserPromptSubmit hook turns into an intent.
function userPrompt(root, prompt, extraEnv = {}) {
  const transcript = typed(root, prompt);
  return spawnSync(process.execPath, [path.join(PLUGIN, 'hooks', 'prompt-submit.js')], {
    input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt, session_id: 's-test', transcript_path: transcript }), encoding: 'utf8', env: cleanEnv({ CLAUDE_PROJECT_DIR: root, ...extraEnv }),
  });
}

// For user-only commands the user's prompt is simulated first, unless `asModel` is set (a model-run command, no user prompt).
function cli(root, args, extraEnv = {}) {
  if (USER_ONLY.includes(args[0]) && !extraEnv.asModel) userPrompt(root, `/adlc:${args[0]} ${args.slice(1).join(' ')}`);
  delete extraEnv.asModel;
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

module.exports = { CONFIG, transcriptFor, typed, userPrompt, PLUGIN, lib, tmpdir, cli, hook, ok, writeFile, toBuild, TASK, REQUIREMENTS };
