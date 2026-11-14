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

// The directory whose .agent-lifecycle/state.json governs `start`: ADLC_ROOT, else the nearest ancestor that has one.
// Returns null when there is none. No git process, so hooks can call it on every tool use; the CLI and the hooks
// share it, so they always agree on which change is active.
function findStateRoot(start = process.cwd()) {
  try {
    if (process.env.ADLC_ROOT) {
      const fixed = fs.realpathSync(path.resolve(process.env.ADLC_ROOT));
      return fs.existsSync(path.join(fixed, DIR, 'state.json')) ? fixed : null;
    }
    // A worker in a linked git worktree uses the main checkout's state, never the worktree's committed copy.
    let dir = fs.realpathSync(require('./worktree').mainRootFor(path.resolve(start)));
    for (;;) {
      if (fs.existsSync(path.join(dir, DIR, 'state.json'))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  } catch {
    return null;
  }
}

function findRoot(start = process.cwd()) {
  if (process.env.ADLC_ROOT) return fs.realpathSync(path.resolve(process.env.ADLC_ROOT));
  const found = findStateRoot(start);
  if (found) return found;
  const begin = fs.realpathSync(require('./worktree').mainRootFor(path.resolve(start)));
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
  if (!s || typeof s !== 'object' || s.schema !== SCHEMA) throw rule(`unsupported state schema ${s && s.schema}; this adlc supports schema ${SCHEMA}`);
  // A hand-edited or damaged state file gets a clear rule error here instead of an internal error later.
  const problems = require('./schema').check('state', s);
  if (problems.length) {
    const shown = problems.slice(0, 10).map((x) => `- ${x}`).join('\n');
    throw rule(`state.json does not match schemas/state.schema.json:\n${shown}${problems.length > 10 ? `\n- … ${problems.length - 10} more` : ''}\nRestore it from version control`);
  }
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
  SCHEMA, DIR, STAGES, DEFAULT_SERIAL_GLOBS, paths, now, findStateRoot, findRoot, normalizeConfig, newState, init, exists, load, save, mutate, create,
};
