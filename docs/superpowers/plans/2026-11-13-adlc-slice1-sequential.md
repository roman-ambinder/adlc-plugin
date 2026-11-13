# ADLC Plugin — Slice 1 (Sequential Vertical Slice) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working Claude Code plugin `adlc` that takes one change from start → plan → approval → sequential build (packets, leases, handoffs, evidence, integration) → verify → review → release, with state on disk and guard hooks.

**Architecture:** Deterministic logic lives in a zero-dependency Node CLI (`plugins/adlc/bin/adlc` → `lib/*.js`) that owns `.agent-lifecycle/state.json` with locked, revision-checked atomic writes. Skills drive the workflow and call the CLI; plugin subagents do role work; hooks (`guard`, `audit`, `subagent-stop`, `session-start`) enforce boundaries and record evidence of who wrote what. Parallel modes are stubbed: `auto` resolves to `sequential` with a recorded reason (Slices 2–3 add them).

**Tech Stack:** Node ≥ 18 (CommonJS, `node:test`, `node:assert/strict`), no npm dependencies; Claude Code ≥ 2.1.311 plugin format; bash for the end-to-end script.

**Spec:** `docs/superpowers/specs/2026-11-13-adlc-plugin-design.md`

## Global Constraints

- Node ≥ 18 built-ins only; no npm dependencies (the plugin must never need an install approval).
- Plugin name `adlc`; marketplace name `adlc-marketplace`; no `claude-`/`anthropic-`/`cc-plugin-` prefixes.
- State schema version `1`; state dir `.agent-lifecycle/`.
- CLI exit codes: 0 ok, 1 usage, 2 rule violation, 3 concurrent modification, 4 not initialised, 5 command failed (evidence recorded), 70 internal error.
- Hooks: silent (exit 0, no stdout) unless `$CLAUDE_PROJECT_DIR/.agent-lifecycle/state.json` exists; never emit `permissionDecision: "allow"`; exec form `"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/<x>.js"]`.
- Plugin agents must not use `permissionMode`, `hooks`, `mcpServers`, `initialPrompt` (ignored for plugin agents).
- Only the CLI writes `state.json` and `approvals.jsonl`; only hooks write `runs/`.
- Evidence is created only by `adlc run`, which executes the command itself; output is redacted and truncated to the last 200 lines.
- Every component path in manifests starts with `./`.
- Commits in this plan are commits to the plugin repository itself (the user approved git use for this repo).

## File Structure

```
adlc-plugin/
├── package.json                         repo scripts (test, validate)
├── .gitignore
├── .claude-plugin/marketplace.json      local marketplace → ./plugins/adlc
├── plugins/adlc/
│   ├── .claude-plugin/plugin.json       manifest + userConfig
│   ├── bin/adlc                         CLI entry (on Bash PATH when enabled)
│   ├── lib/errors.js                    AdlcError + exit codes
│   ├── lib/fsutil.js                    atomic write, jsonl, locks, marked sections, sha256
│   ├── lib/glob.js                      path/glob matching and conservative overlap
│   ├── lib/state.js                     paths, config, newState, init/load/save/mutate/create, findRoot
│   ├── lib/stages.js                    stage machine (pure)
│   ├── lib/tasks.js                     tasks, contracts, readiness, block cascade, repair (pure)
│   ├── lib/packets.js                   build packet readiness + rendering
│   ├── lib/redact.js                    secret masking
│   ├── lib/evidence.js                  adlc run: execute + record evidence; list
│   ├── lib/gates.js                     gate hashing, approval, staleness
│   ├── lib/rules.js                     stage pre/post conditions, traceability
│   ├── lib/exec.js                      waves, serial detection, mode resolution, plan.md sections
│   ├── lib/dispatch.js                  readiness gate, leases, stop records
│   ├── lib/integrate.js                 handoff validation, integrate check/done
│   ├── lib/cli.js                       argument parsing + command handlers
│   ├── hooks/hooks.json
│   ├── hooks/common.js                  stdin, lifecycle detection, bindings, paths
│   ├── hooks/patterns.js                risky/protected/test-disabling patterns
│   ├── hooks/guard.js                   PreToolUse
│   ├── hooks/audit.js                   PostToolUse
│   ├── hooks/subagent-stop.js           SubagentStop
│   ├── hooks/session-start.js           SessionStart
│   ├── skills/<name>/SKILL.md           start plan approve next status verify review resume release skip unblock coordinator worker-contract
│   ├── agents/*.md                      analyst architect developer tester reviewer
│   ├── templates/*.md                   requirements plan decisions handoff release review
│   ├── schemas/state.schema.json, schemas/handoff.schema.json
│   └── settings-template.json
├── tests/helpers.js + tests/*.test.js
├── examples/slugify/run.sh + examples/slugify/artifacts/
├── docs/capabilities.md
└── README.md
```

---

### Task 1: Repository scaffold, manifests, errors module

**Files:**
- Create: `package.json`, `.gitignore`, `.claude-plugin/marketplace.json`, `plugins/adlc/.claude-plugin/plugin.json`, `plugins/adlc/lib/errors.js`, `tests/helpers.js`
- Test: `tests/manifest.test.js`

**Interfaces:**
- Produces: `errors.js` exports `{ EXIT, AdlcError, usage(msg), rule(msg) }` where `EXIT = { OK:0, USAGE:1, RULE:2, CONFLICT:3, NOINIT:4, CMD_FAILED:5 }` and `AdlcError` has `.exitCode`.
- Produces: `tests/helpers.js` exports `{ PLUGIN, lib, tmpdir, cli, hook, ok, writeFile, toBuild, TASK, REQUIREMENTS }` (used by every later test).

- [ ] **Step 1: Write the failing test** — `tests/manifest.test.js`

```js
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
```

- [ ] **Step 2: Create `tests/helpers.js`** (needed for the test to load)

```js
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test tests/manifest.test.js`
Expected: FAIL — `ENOENT ... plugin.json` / `Cannot find module .../lib/errors`.

- [ ] **Step 4: Write the implementation files**

`package.json`:
```json
{
  "name": "adlc-plugin-repo",
  "version": "0.1.0",
  "private": true,
  "description": "Repository for the adlc Claude Code plugin (agentic development lifecycle)",
  "license": "MIT",
  "engines": { "node": ">=18" },
  "scripts": {
    "test": "node --test tests/*.test.js",
    "validate": "claude plugin validate --strict plugins/adlc && claude plugin validate ."
  }
}
```

`.gitignore`:
```
node_modules/
.DS_Store
.claude/worktrees/
```

`.claude-plugin/marketplace.json`:
```json
{
  "name": "adlc-marketplace",
  "owner": { "name": "adlc contributors" },
  "description": "Local marketplace for the adlc agentic development lifecycle plugin",
  "plugins": [
    {
      "name": "adlc",
      "source": "./plugins/adlc",
      "description": "Agentic development lifecycle: discover, specify, plan, design, build, verify, review, release with approval gates"
    }
  ]
}
```

`plugins/adlc/.claude-plugin/plugin.json`:
```json
{
  "name": "adlc",
  "displayName": "ADLC — Agentic Development Lifecycle",
  "version": "0.1.0",
  "description": "Coordinates focused agents through discover → specify → plan → design → build → verify → review → release, with on-disk state, evidence, and approval gates.",
  "author": { "name": "adlc contributors" },
  "license": "MIT",
  "keywords": ["lifecycle", "workflow", "agents", "approvals", "testing", "review"],
  "userConfig": {
    "approval_gates": {
      "type": "string",
      "title": "Approval gates",
      "description": "Comma-separated gates that need your approval: plan, release. Use none to disable gates (platform permission prompts and guard prompts still apply).",
      "default": "plan,release"
    },
    "guard_level": {
      "type": "string",
      "title": "Guard level",
      "description": "standard asks before commits, pushes, PRs, installs, network access, destructive commands, publishing and deploying. strict also asks before merges, rebases, worktree changes and other git history edits.",
      "options": ["strict", "standard"],
      "default": "strict"
    },
    "max_repair_attempts": {
      "type": "number",
      "title": "Max repair attempts per task",
      "description": "Failed attempts allowed per task before it is blocked and the coordinator stops.",
      "default": 3,
      "min": 1,
      "max": 10
    },
    "max_tasks_per_run": {
      "type": "number",
      "title": "Max tasks per run",
      "description": "Tasks dispatched per session before the coordinator stops and writes a handoff.",
      "default": 5,
      "min": 1,
      "max": 50
    },
    "parallel_mode": {
      "type": "string",
      "title": "Parallel build mode",
      "description": "auto picks worktree, shared or sequential from repository conditions. This version always runs sequentially and records why.",
      "options": ["auto", "worktree", "shared", "sequential"],
      "default": "auto"
    },
    "max_parallel": {
      "type": "number",
      "title": "Max parallel workers",
      "description": "Upper bound on concurrently running build workers in parallel modes.",
      "default": 2,
      "min": 1,
      "max": 8
    },
    "serial_globs": {
      "type": "string",
      "title": "Serial file patterns",
      "description": "Comma-separated patterns for collision-prone files; tasks touching them always run alone.",
      "default": "package.json,*lock*,*.lock,go.mod,go.sum,Cargo.toml,pyproject.toml,requirements*.txt,Gemfile*,*.config.*,.github/**,migrations/**,**/generated/**"
    }
  }
}
```

`plugins/adlc/lib/errors.js`:
```js
'use strict';

const EXIT = { OK: 0, USAGE: 1, RULE: 2, CONFLICT: 3, NOINIT: 4, CMD_FAILED: 5 };

class AdlcError extends Error {
  constructor(exitCode, message) {
    super(message);
    this.exitCode = exitCode;
  }
}

const usage = (message) => new AdlcError(EXIT.USAGE, message);
const rule = (message) => new AdlcError(EXIT.RULE, message);

module.exports = { EXIT, AdlcError, usage, rule };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/manifest.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore .claude-plugin plugins/adlc/.claude-plugin plugins/adlc/lib/errors.js tests/helpers.js tests/manifest.test.js
git commit -m "feat: scaffold adlc plugin manifests and error codes"
```

---

### Task 2: File utilities and glob matching

**Files:**
- Create: `plugins/adlc/lib/fsutil.js`, `plugins/adlc/lib/glob.js`
- Test: `tests/fsutil.test.js`

**Interfaces:**
- Consumes: `errors.js`.
- Produces (`fsutil.js`): `sha256(text) → hex`, `atomicWrite(file, data, tmpDir?)`, `appendLine(file, valueOrString)`, `readJsonLines(file) → object[]` (skips torn lines), `readJson(file, fallback)`, `acquireLock(lockPath, {waitMs=0, staleMs=600000}) → releaseFn` (throws exit 3 when held), `withLock(lockPath, fn, opts) → fn()`, `replaceSection(text, key, content) → text`.
- Produces (`glob.js`): `norm(p)`, `isGlob(p)`, `globToRegExp(glob)`, `matches(pattern, file) → bool`, `entriesOverlap(a, b) → bool` (conservative), `setsOverlap(A, B) → bool`.

- [ ] **Step 1: Write the failing test** — `tests/fsutil.test.js`

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/fsutil.test.js`
Expected: FAIL — `Cannot find module .../lib/fsutil`.

- [ ] **Step 3: Write `plugins/adlc/lib/fsutil.js`**

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { AdlcError, EXIT } = require('./errors');

const STALE_MS = 10 * 60 * 1000;

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function atomicWrite(file, data, tmpDir) {
  const dir = tmpDir || path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(dir, `${path.basename(file)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

function appendLine(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let line = `${typeof value === 'string' ? value : JSON.stringify(value)}\n`;
  if (fs.existsSync(file)) {
    const size = fs.statSync(file).size;
    if (size > 0) {
      const last = Buffer.alloc(1);
      const rfd = fs.openSync(file, 'r');
      try { fs.readSync(rfd, last, 0, 1, size - 1); } finally { fs.closeSync(rfd); }
      if (last[0] !== 0x0a) line = `\n${line}`; // previous write was torn: start a fresh line
    }
  }
  const fd = fs.openSync(file, 'a');
  try {
    fs.writeSync(fd, line);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function readJsonLines(file) {
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // torn line from an interrupted write: ignore it
    }
  }
  return out;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireLock(lockPath, { waitMs = 0, staleMs = STALE_MS } = {}) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, ts: new Date().toISOString() }));
      fs.closeSync(fd);
      return () => {
        try { fs.unlinkSync(lockPath); } catch { /* already removed */ }
      };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let age;
      try {
        age = Date.now() - fs.statSync(lockPath).mtimeMs;
      } catch {
        continue; // released between open and stat
      }
      if (age > staleMs) {
        try { fs.unlinkSync(lockPath); } catch { /* another process reclaimed it */ }
        continue;
      }
      if (Date.now() >= deadline) {
        throw new AdlcError(EXIT.CONFLICT, `${path.basename(lockPath)} is held by another adlc process; retry shortly`);
      }
      sleep(50);
    }
  }
}

function withLock(lockPath, fn, opts) {
  const release = acquireLock(lockPath, opts);
  try {
    return fn();
  } finally {
    release();
  }
}

function replaceSection(text, key, content) {
  const begin = `<!-- adlc:begin ${key} -->`;
  const end = `<!-- adlc:end ${key} -->`;
  const block = `${begin}\n${String(content).replace(/\n+$/, '')}\n${end}`;
  const i = text.indexOf(begin);
  const j = text.indexOf(end);
  if (i !== -1 && j > i) return text.slice(0, i) + block + text.slice(j + end.length);
  return `${text ? text.replace(/\n*$/, '\n\n') : ''}${block}\n`;
}

module.exports = { sha256, atomicWrite, appendLine, readJsonLines, readJson, acquireLock, withLock, replaceSection, STALE_MS };
```

- [ ] **Step 4: Write `plugins/adlc/lib/glob.js`**

```js
'use strict';
const path = require('node:path');

function norm(p) {
  return String(p).trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

function isGlob(p) {
  return /[*?]/.test(p);
}

function staticPrefix(p) {
  const i = p.search(/[*?]/);
  return i === -1 ? p : p.slice(0, i);
}

function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i += 1;
        if (glob[i + 1] === '/') {
          i += 1;
          re += '(?:.*/)?';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

// pattern: literal path, directory prefix ending in "/", or glob. A glob without "/" matches basenames.
function matches(pattern, file) {
  const pat = norm(pattern);
  const f = norm(file);
  if (isGlob(pat)) return globToRegExp(pat).test(pat.includes('/') ? f : path.posix.basename(f));
  if (pat.endsWith('/')) return f.startsWith(pat);
  return f === pat;
}

function prefixRelated(p, q) {
  return p.startsWith(q) || q.startsWith(p);
}

// True when two writable-file entries could name the same file. Errs towards true.
function entriesOverlap(a, b) {
  const x = norm(a);
  const y = norm(b);
  const gx = isGlob(x);
  const gy = isGlob(y);
  if (!gx && !gy) return x === y || (x.endsWith('/') && y.startsWith(x)) || (y.endsWith('/') && x.startsWith(y));
  if (gx && !gy) return y.endsWith('/') ? prefixRelated(staticPrefix(x), y) : matches(x, y);
  if (!gx && gy) return entriesOverlap(y, x);
  return prefixRelated(staticPrefix(x), staticPrefix(y));
}

function setsOverlap(A, B) {
  return A.some((a) => B.some((b) => entriesOverlap(a, b)));
}

module.exports = { norm, isGlob, staticPrefix, globToRegExp, matches, entriesOverlap, setsOverlap };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/fsutil.test.js`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add plugins/adlc/lib/fsutil.js plugins/adlc/lib/glob.js tests/fsutil.test.js
git commit -m "feat: add atomic file, lock, section and glob utilities"
```

---

### Task 3: State store, configuration, templates

**Files:**
- Create: `plugins/adlc/lib/state.js`, `plugins/adlc/templates/{requirements,plan,decisions,handoff,release,review}.md`, `plugins/adlc/schemas/state.schema.json`
- Test: `tests/state.test.js`

**Interfaces:**
- Consumes: `fsutil.atomicWrite`, `fsutil.withLock`, `errors`.
- Produces: `SCHEMA=1`, `DIR`, `STAGES` (8 names in order), `DEFAULT_SERIAL_GLOBS`, `paths(root) → {root, dir, state, approvals, lock, checkLock, tmp, runs, packets, handoffs, results, reviews}`, `now() → ISO string`, `findRoot(start?) → abs path`, `normalizeConfig(obj) → {approval_gates[], parallel_mode, max_parallel, max_repair_attempts, max_tasks_per_run, serial_globs[]}`, `newState({title, type, small, config}) → state`, `init(root) → paths`, `exists(root)`, `load(root) → state`, `save(root, s, expectedRevision)`, `mutate(root, fn) → fn's result`, `create(root, s)`.

- [ ] **Step 1: Write the failing test** — `tests/state.test.js`

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/state.test.js`
Expected: FAIL — `Cannot find module .../lib/state`.

- [ ] **Step 3: Write `plugins/adlc/lib/state.js`**

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { atomicWrite, withLock } = require('./fsutil');
const { AdlcError, EXIT, usage, rule } = require('./errors');

const SCHEMA = 1;
const DIR = '.agent-lifecycle';
const STAGES = ['discover', 'specify', 'plan', 'design', 'build', 'verify', 'review', 'release'];
const TEMPLATE_DIR = path.join(__dirname, '..', 'templates');
const TEMPLATED = ['requirements.md', 'plan.md', 'decisions.md', 'handoff.md', 'release.md'];
const GITIGNORE = '.lock\n.check.lock\ntmp/\nruns/\n';
const MODES = ['auto', 'worktree', 'shared', 'sequential'];
const GATES = ['plan', 'release'];
const DEFAULT_SERIAL_GLOBS = 'package.json,*lock*,*.lock,go.mod,go.sum,Cargo.toml,pyproject.toml,requirements*.txt,Gemfile*,*.config.*,.github/**,migrations/**,**/generated/**';

function paths(root) {
  const dir = path.join(root, DIR);
  return {
    root,
    dir,
    state: path.join(dir, 'state.json'),
    approvals: path.join(dir, 'approvals.jsonl'),
    lock: path.join(dir, '.lock'),
    checkLock: path.join(dir, '.check.lock'),
    tmp: path.join(dir, 'tmp'),
    runs: path.join(dir, 'runs'),
    packets: path.join(dir, 'packets'),
    handoffs: path.join(dir, 'handoffs'),
    results: path.join(dir, 'test-results'),
    reviews: path.join(dir, 'reviews'),
  };
}

function now() {
  return new Date().toISOString();
}

function findRoot(start = process.cwd()) {
  if (process.env.ADLC_ROOT) return fs.realpathSync(path.resolve(process.env.ADLC_ROOT));
  const begin = fs.realpathSync(path.resolve(start));
  let dir = begin;
  for (;;) {
    if (fs.existsSync(path.join(dir, DIR, 'state.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const git = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: begin, encoding: 'utf8' });
  return git.status === 0 && git.stdout.trim() ? fs.realpathSync(git.stdout.trim()) : begin;
}

function clean(v) {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'string' && (v.trim() === '' || v.includes('${'))) return undefined;
  return v;
}

function list(v, fallback) {
  const raw = clean(v);
  if (raw === 'none') return [];
  return String(raw === undefined ? fallback : raw).split(',').map((x) => x.trim()).filter(Boolean);
}

function int(name, v, fallback, lo, hi) {
  const raw = clean(v);
  const n = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(n) || n < lo || n > hi) throw usage(`${name} must be an integer from ${lo} to ${hi} (got ${v})`);
  return n;
}

function normalizeConfig(c = {}) {
  const mode = clean(c.parallel_mode) || 'auto';
  if (!MODES.includes(mode)) throw usage(`parallel_mode must be one of ${MODES.join(', ')} (got ${mode})`);
  const gates = list(c.approval_gates, 'plan,release');
  for (const g of gates) if (!GATES.includes(g)) throw usage(`unknown approval gate "${g}" (known: ${GATES.join(', ')}, or none)`);
  return {
    approval_gates: gates,
    parallel_mode: mode,
    max_parallel: int('max_parallel', c.max_parallel, 2, 1, 8),
    max_repair_attempts: int('max_repair_attempts', c.max_repair_attempts, 3, 1, 10),
    max_tasks_per_run: int('max_tasks_per_run', c.max_tasks_per_run, 5, 1, 50),
    serial_globs: list(c.serial_globs, DEFAULT_SERIAL_GLOBS),
  };
}

function slug(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'change';
}

function newState({ title, type = 'feature', small = false, config = {} } = {}) {
  if (typeof title !== 'string' || !title.trim()) throw usage('a change title is required');
  if (!['feature', 'bugfix'].includes(type)) throw usage(`--type must be feature or bugfix (got ${type})`);
  const cfg = normalizeConfig(config);
  const ts = now();
  const stages = Object.fromEntries(STAGES.map((st) => [st, { status: 'pending' }]));
  if (small) for (const st of ['discover', 'design']) stages[st] = { status: 'skipped', reason: 'small change', ts };
  return {
    schema: SCHEMA,
    revision: 0,
    change: { id: `chg-${ts.slice(0, 10).replace(/-/g, '')}-${slug(title)}`, title: title.trim(), type, created: ts },
    stage: null,
    stages,
    contracts: [],
    tasks: [],
    execution: { mode: null, resolved_from: cfg.parallel_mode, max_parallel: cfg.max_parallel, reasons: [], waves: [], integration_order: [], plan_hash: null },
    leases: [],
    metrics: { retries: 0, integration_failures: 0, tokens: 'not observable', cost: 'not observable' },
    budget: { max_repair_attempts: cfg.max_repair_attempts, max_tasks_per_run: cfg.max_tasks_per_run, tasks_this_run: 0, session: null },
    config: { approval_gates: cfg.approval_gates, serial_globs: cfg.serial_globs },
    reviews: [],
    blocker: null,
    updated: ts,
  };
}

function init(root) {
  const p = paths(root);
  for (const d of [p.dir, p.tmp, p.runs, p.packets, p.handoffs, p.results, p.reviews]) fs.mkdirSync(d, { recursive: true });
  const gi = path.join(p.dir, '.gitignore');
  if (!fs.existsSync(gi)) atomicWrite(gi, GITIGNORE, p.tmp);
  for (const f of TEMPLATED) {
    const dest = path.join(p.dir, f);
    if (!fs.existsSync(dest)) atomicWrite(dest, fs.readFileSync(path.join(TEMPLATE_DIR, f), 'utf8'), p.tmp);
  }
  return p;
}

function exists(root) {
  return fs.existsSync(paths(root).state);
}

function load(root) {
  const p = paths(root);
  if (!fs.existsSync(p.state)) throw new AdlcError(EXIT.NOINIT, `no active change: ${p.state} not found (run: adlc start "<title>")`);
  let s;
  try {
    s = JSON.parse(fs.readFileSync(p.state, 'utf8'));
  } catch (err) {
    throw rule(`state.json is not valid JSON (${err.message}); restore it from version control`);
  }
  if (s.schema !== SCHEMA) throw rule(`unsupported state schema ${s.schema}; this adlc supports schema ${SCHEMA}`);
  return s;
}

function save(root, s, expectedRevision) {
  const p = paths(root);
  if (fs.existsSync(p.state)) {
    let disk;
    try {
      disk = JSON.parse(fs.readFileSync(p.state, 'utf8'));
    } catch {
      disk = {};
    }
    if (disk.revision !== expectedRevision) {
      throw new AdlcError(EXIT.CONFLICT, `state changed concurrently (revision ${disk.revision}, expected ${expectedRevision}); re-run the command`);
    }
  }
  s.revision = expectedRevision + 1;
  s.updated = now();
  atomicWrite(p.state, `${JSON.stringify(s, null, 2)}\n`, p.tmp);
}

function mutate(root, fn) {
  const p = paths(root);
  return withLock(p.lock, () => {
    const s = load(root);
    const rev = s.revision;
    const result = fn(s);
    save(root, s, rev);
    return result;
  }, { waitMs: 3000 });
}

function create(root, s) {
  const p = init(root);
  return withLock(p.lock, () => {
    if (fs.existsSync(p.state)) throw rule('a change already exists in .agent-lifecycle/; finish it or run `adlc archive`');
    atomicWrite(p.state, `${JSON.stringify(s, null, 2)}\n`, p.tmp);
    return s;
  }, { waitMs: 3000 });
}

module.exports = {
  SCHEMA, DIR, STAGES, DEFAULT_SERIAL_GLOBS, paths, now, findRoot, normalizeConfig, newState, init, exists, load, save, mutate, create,
};
```

- [ ] **Step 4: Write the templates**

`plugins/adlc/templates/requirements.md`:
```markdown
# Requirements

<!-- Written by the analyst and edited by humans. adlc reads acceptance criteria from lines that start with "- AC-<n>:". -->

## Problem

_What is wrong or missing, and why it matters._

## Users

_Who is affected and how they will use the change._

## Constraints

_Technical, compatibility, security, performance and time constraints._

## Success criteria

_How we will know the change worked._

## Acceptance criteria

_One line per criterion, measurable and testable: `- AC-1: <observable behaviour>; verified by <command or check>`._
```

`plugins/adlc/templates/plan.md`:
```markdown
# Plan

## Context

_Repository inspection notes: language, conventions, test/lint/format/type-check commands found._

## Affected files

_Files and modules this change touches, and why._

## Risks

_What could go wrong and how the plan reduces it._

<!-- adlc:begin tasks -->
## Tasks
_Generated by `adlc exec plan`._
<!-- adlc:end tasks -->

<!-- adlc:begin execution -->
## Execution plan
_Generated by `adlc exec plan`._
<!-- adlc:end execution -->
```

`plugins/adlc/templates/decisions.md`:
```markdown
# Design decisions

_Record each decision as `## D-<n>: <title>` with Context, Decision, Alternatives considered, Consequences._
_Record each shared interface as `## C-<n>: <title>` with the exact contract (signatures, data shapes, error behaviour). Register it with `adlc contract add`._
```

`plugins/adlc/templates/handoff.md`:
```markdown
# Handoff notes

_Append-only. Each entry records what was done, what is next, and open questions, so a new session can resume._
```

`plugins/adlc/templates/release.md`:
```markdown
# Release

## Summary of changes

_What changed and why, in a few bullets._

## Acceptance criteria status

_See traceability.md (generated by `adlc trace`)._

## Migration

_Data, configuration or API migrations. Write "None." if there are none._

## Deployment steps

_Derived from the repository's own scripts and docs. Write "No deployment process found in the repository." if none exists._

## Rollback steps

_How to undo this change safely._

## Known issues and unverified claims

_Anything not verified by recorded evidence._
```

`plugins/adlc/templates/review.md`:
```markdown
# Review: <change id>

Reviewer: adlc:reviewer · Scope: <files reviewed>

## Blocking findings

_Correctness, security, requirement gaps, missing or weakened tests. Each: `- [B<n>] <file>:<line> — <finding>. Why it blocks: <reason>. Related: <AC/task>`. Write "None." if there are none._

## Optional improvements

_Maintainability, style, minor performance. Each: `- [O<n>] <file>:<line> — <suggestion>`._

## Requirement coverage

_For each AC: covered / not covered, with the evidence file or code location._

## Verification notes

_What the reviewer checked by reading code or running read-only commands, and what could not be verified._
```

- [ ] **Step 5: Write `plugins/adlc/schemas/state.schema.json`** (documentation of the format; the CLI validates structurally in code)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "adlc/state.schema.json",
  "title": "adlc state (schema 1)",
  "type": "object",
  "required": ["schema", "revision", "change", "stages", "contracts", "tasks", "execution", "leases", "metrics", "budget", "config", "reviews", "blocker", "updated"],
  "properties": {
    "schema": { "const": 1 },
    "revision": { "type": "integer", "minimum": 0 },
    "change": {
      "type": "object",
      "required": ["id", "title", "type", "created"],
      "properties": {
        "id": { "type": "string", "pattern": "^chg-\\d{8}-[a-z0-9-]+$" },
        "title": { "type": "string" },
        "type": { "enum": ["feature", "bugfix"] },
        "created": { "type": "string" }
      }
    },
    "stage": { "type": ["string", "null"] },
    "stages": {
      "type": "object",
      "propertyNames": { "enum": ["discover", "specify", "plan", "design", "build", "verify", "review", "release"] },
      "additionalProperties": {
        "type": "object",
        "required": ["status"],
        "properties": {
          "status": { "enum": ["pending", "in_progress", "completed", "skipped", "blocked"] },
          "reason": { "type": "string" },
          "started": { "type": "string" },
          "ended": { "type": "string" },
          "ts": { "type": "string" }
        }
      }
    },
    "contracts": {
      "type": "array",
      "items": { "type": "object", "required": ["id", "title", "spec", "provided_by"], "properties": { "id": { "type": "string", "pattern": "^C-\\d+$" } } }
    },
    "tasks": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "title", "goal", "status", "deps", "contracts", "files", "reads", "resources", "size", "coupled", "checks", "ac", "attempts", "max_attempts", "timing"],
        "properties": {
          "id": { "type": "string", "pattern": "^T\\d+$" },
          "status": { "enum": ["todo", "dispatched", "returned", "integrated", "blocked"] },
          "size": { "enum": ["S", "M", "L"] },
          "deps": { "type": "array", "items": { "type": "string" } },
          "files": { "type": "array", "minItems": 1, "items": { "type": "string" } },
          "checks": { "type": "array", "items": { "type": "string" } },
          "ac": { "type": "array", "items": { "type": "string" } },
          "attempts": { "type": "integer", "minimum": 0 },
          "max_attempts": { "type": "integer", "minimum": 1 },
          "blocker": { "type": "string" }
        }
      }
    },
    "execution": {
      "type": "object",
      "required": ["mode", "resolved_from", "max_parallel", "reasons", "waves", "integration_order", "plan_hash"],
      "properties": {
        "mode": { "enum": [null, "sequential", "shared", "worktree"] },
        "resolved_from": { "enum": ["auto", "worktree", "shared", "sequential"] },
        "waves": { "type": "array", "items": { "type": "array", "items": { "type": "string" } } }
      }
    },
    "leases": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["task", "lease", "session", "status", "started"],
        "properties": {
          "lease": { "type": "string", "pattern": "^L-[0-9a-f]+$" },
          "status": { "enum": ["active", "returned", "stopped", "lost"] }
        }
      }
    },
    "metrics": { "type": "object", "required": ["retries", "integration_failures", "tokens", "cost"] },
    "budget": { "type": "object", "required": ["max_repair_attempts", "max_tasks_per_run", "tasks_this_run"] },
    "config": { "type": "object", "required": ["approval_gates", "serial_globs"] },
    "reviews": { "type": "array", "items": { "type": "object", "required": ["file", "blocking", "optional", "ts"] } },
    "blocker": { "type": ["string", "null"] },
    "updated": { "type": "string" }
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test tests/state.test.js`
Expected: PASS (7 tests).

- [ ] **Step 7: Commit**

```bash
git add plugins/adlc/lib/state.js plugins/adlc/templates plugins/adlc/schemas/state.schema.json tests/state.test.js
git commit -m "feat: add versioned state store with locked revision-checked writes"
```

---

## Remaining tasks (built directly, test-first; user chose to skip full plan code)

Each task: write failing `node:test` tests, implement, run `npm test`, commit.

- [ ] Task 4: `lib/stages.js` — current/start/complete/skip/reopenBuild/nextAction (pure; preconditions injected).
- [ ] Task 5: `lib/tasks.js` + `lib/packets.js` — add/update tasks, contracts, readiness, block cascade, repair limit, canonical task view; packet readiness + rendering.
- [ ] Task 6: `lib/redact.js` + `lib/evidence.js` — secret masking; `run` executes command, records exit/duration/redacted last-200-lines; `list`, `latestByCmd`.
- [ ] Task 7: `lib/gates.js` + `lib/rules.js` — gate hash over covered artifacts, approve/check/stale; stage pre/post conditions (AC coverage, evidence, review, release sections); traceability.
- [ ] Task 8: `lib/exec.js` + `lib/dispatch.js` — waves, serial detection, plan hash, mode resolution (auto → sequential in Slice 1 with reason), plan.md sections; readiness gate, leases, stop records, lost/stopped.
- [ ] Task 9: `lib/integrate.js` + `schemas/handoff.schema.json` — handoff validation/submission, integrate check (evidence matching, ownership, stop record), integrate done (cross-task checks after return).
- [ ] Task 10: `lib/cli.js` + `bin/adlc` — all Slice 1 subcommands, exit codes, `--json`.
- [ ] Task 11: hooks (`common`, `patterns`, `guard`, `audit`, `subagent-stop`, `session-start`, `hooks.json`) with stdin-fixture tests.
- [ ] Task 12: skills, agents, `settings-template.json`; `claude plugin validate --strict`.
- [ ] Task 13: `examples/slugify/run.sh` + artifacts, e2e test, README, `docs/capabilities.md`.
