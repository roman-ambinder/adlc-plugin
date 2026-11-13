'use strict';
const { usage, rule } = require('./errors');

const SIZES = ['S', 'M', 'L'];
const UPDATABLE = ['title', 'goal', 'deps', 'contracts', 'files', 'reads', 'resources', 'size', 'coupled', 'checks', 'ac', 'max_attempts'];

function str(v, name) {
  if (typeof v !== 'string' || !v.trim()) throw usage(`${name} must be a non-empty string`);
  return v.trim();
}

function strList(v, name) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !x.trim())) throw usage(`${name} must be an array of non-empty strings`);
  return v.map((x) => x.trim());
}

function nextId(prefix, items) {
  const n = items.reduce((m, x) => Math.max(m, Number(String(x.id).slice(prefix.length)) || 0), 0);
  return `${prefix}${n + 1}`;
}

function getTask(s, id) {
  const t = s.tasks.find((x) => x.id === id);
  if (!t) throw rule(`unknown task ${id}`);
  return t;
}

function buildTask(s, input, id) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw usage('a task must be a JSON object');
  const contracts = input.contracts || {};
  const t = {
    id,
    title: str(input.title, 'title'),
    goal: str(input.goal, 'goal'),
    status: 'todo',
    deps: strList(input.deps, 'deps'),
    contracts: { provides: strList(contracts.provides, 'contracts.provides'), consumes: strList(contracts.consumes, 'contracts.consumes') },
    files: strList(input.files, 'files'),
    reads: strList(input.reads, 'reads'),
    resources: strList(input.resources, 'resources'),
    size: input.size === undefined ? 'M' : input.size,
    coupled: Boolean(input.coupled),
    checks: strList(input.checks, 'checks'),
    ac: strList(input.ac, 'ac'),
    attempts: 0,
    max_attempts: input.max_attempts === undefined ? s.budget.max_repair_attempts : input.max_attempts,
    timing: {},
  };
  if (!SIZES.includes(t.size)) throw usage(`size must be one of ${SIZES.join(', ')}`);
  if (!Number.isInteger(t.max_attempts) || t.max_attempts < 1) throw usage('max_attempts must be a positive integer');
  if (!t.files.length) throw usage('files must list at least one writable path');
  for (const d of t.deps) {
    if (d === id) throw rule(`${id} cannot depend on itself`);
    if (!s.tasks.some((x) => x.id === d)) throw rule(`unknown dependency ${d}`);
  }
  return t;
}

function addTask(s, input) {
  const id = input && input.id !== undefined ? input.id : nextId('T', s.tasks);
  if (!/^T\d+$/.test(id)) throw usage(`task id must look like T1 (got ${id})`);
  if (s.tasks.some((x) => x.id === id)) throw rule(`task ${id} already exists`);
  const t = buildTask(s, input, id);
  s.tasks.push(t);
  return t;
}

function updateTask(s, id, patch) {
  const t = getTask(s, id);
  if (t.status !== 'todo') throw rule(`only todo tasks can be updated (${id} is ${t.status})`);
  for (const k of Object.keys(patch || {})) if (!UPDATABLE.includes(k)) throw usage(`cannot update field "${k}" (updatable: ${UPDATABLE.join(', ')})`);
  const merged = { ...t, ...patch };
  const fresh = buildTask(s, merged, id);
  Object.assign(t, fresh, { status: t.status, attempts: t.attempts, timing: t.timing });
  return t;
}

function addContract(s, input) {
  if (!input || typeof input !== 'object') throw usage('a contract must be a JSON object');
  const c = {
    id: input.id !== undefined ? input.id : nextId('C-', s.contracts),
    title: str(input.title, 'title'),
    spec: str(input.spec, 'spec'),
    provided_by: str(input.provided_by, 'provided_by'),
  };
  if (!/^C-\d+$/.test(c.id)) throw usage(`contract id must look like C-1 (got ${c.id})`);
  if (s.contracts.some((x) => x.id === c.id)) throw rule(`contract ${c.id} already exists`);
  const provider = getTask(s, c.provided_by);
  s.contracts.push(c);
  if (!provider.contracts.provides.includes(c.id)) provider.contracts.provides.push(c.id);
  return c;
}

function prereqs(s, t) {
  const ids = new Set(t.deps);
  for (const cid of t.contracts.consumes) {
    const c = s.contracts.find((x) => x.id === cid);
    if (c && c.provided_by !== t.id) ids.add(c.provided_by);
  }
  return [...ids];
}

function isReady(s, t) {
  return t.status === 'todo' && prereqs(s, t).every((id) => getTask(s, id).status === 'integrated');
}

function readyTasks(s) {
  const order = s.execution && s.execution.integration_order ? s.execution.integration_order : [];
  const rank = (t) => (order.includes(t.id) ? order.indexOf(t.id) : order.length + Number(t.id.slice(1)));
  return s.tasks.filter((t) => isReady(s, t)).sort((a, b) => rank(a) - rank(b));
}

function dependentsOf(s, id) {
  const out = new Set();
  let frontier = [id];
  while (frontier.length) {
    const next = [];
    for (const t of s.tasks) {
      if (!out.has(t.id) && t.id !== id && prereqs(s, t).some((p) => frontier.includes(p))) {
        out.add(t.id);
        next.push(t.id);
      }
    }
    frontier = next;
  }
  return s.tasks.filter((t) => out.has(t.id));
}

function blockTask(s, id, reason) {
  if (typeof reason !== 'string' || !reason.trim()) throw usage('a block reason is required');
  const t = getTask(s, id);
  t.status = 'blocked';
  t.blocker = reason.trim();
  for (const d of dependentsOf(s, id)) {
    if (d.status !== 'integrated') {
      d.status = 'blocked';
      d.blocker = `prerequisite ${id} blocked`;
    }
  }
}

function unblockTask(s, id) {
  const t = getTask(s, id);
  if (t.status !== 'blocked') throw rule(`${id} is not blocked`);
  t.status = 'todo';
  t.attempts = 0;
  delete t.blocker;
  for (const d of dependentsOf(s, id)) {
    if (d.status === 'blocked' && d.blocker === `prerequisite ${id} blocked`) {
      d.status = 'todo';
      delete d.blocker;
    }
  }
}

// Records one failed attempt. Returns the task's new status ("todo" or "blocked").
function repairTask(s, id, note = '') {
  const t = getTask(s, id);
  if (!['dispatched', 'returned', 'integrated'].includes(t.status)) {
    throw rule(`${id} is ${t.status}; only dispatched, returned or integrated tasks can be repaired${t.status === 'blocked' ? ' (the user can reset it with /adlc:unblock)' : ''}`);
  }
  t.attempts += 1;
  s.metrics.retries += 1;
  if (t.attempts >= t.max_attempts) {
    blockTask(s, id, `repair limit reached (${t.attempts}/${t.max_attempts})${note ? `: ${note}` : ''}`);
    s.blocker = `task ${id} exhausted its repair attempts; see test-results/ and handoffs/${id}.json`;
    return 'blocked';
  }
  t.status = 'todo';
  if (note) t.last_failure = note;
  delete t.blocker;
  return 'todo';
}

// The approved shape of the plan: everything except run-time status.
function canonicalTasks(s) {
  return s.tasks.map((t) => ({
    id: t.id, title: t.title, goal: t.goal, deps: t.deps, contracts: t.contracts, files: t.files, reads: t.reads,
    resources: t.resources, size: t.size, coupled: t.coupled, checks: t.checks, ac: t.ac, max_attempts: t.max_attempts,
  }));
}

module.exports = {
  SIZES, getTask, addTask, updateTask, addContract, prereqs, isReady, readyTasks, dependentsOf, blockTask, unblockTask, repairTask, canonicalTasks,
};
