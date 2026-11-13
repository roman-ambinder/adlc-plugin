'use strict';
const crypto = require('node:crypto');
const path = require('node:path');
const { paths, now } = require('./state');
const { readJsonLines } = require('./fsutil');
const gates = require('./gates');
const { packetProblems, writePackets } = require('./packets');
const { prereqs, getTask, repairTask } = require('./tasks');
const { isSerial, conflicts, planHash } = require('./exec');
const { usage, rule } = require('./errors');

function activeLeases(s) {
  return s.leases.filter((l) => l.status === 'active');
}

function effectiveMax(s) {
  return s.execution.mode === 'sequential' || !s.execution.mode ? 1 : s.execution.max_parallel;
}

function stops(root) {
  return readJsonLines(path.join(paths(root).runs, 'stops.jsonl'));
}

function hasStopped(root, lease) {
  return Boolean(lease.stop_confirmed) || stops(root).some((x) => x.lease === lease.lease);
}

function leaseFor(s, id) {
  return [...s.leases].reverse().find((l) => l.task === id && ['active', 'returned'].includes(l.status));
}

function endLease(lease, status) {
  lease.status = status;
  lease.ended = now();
}

// The parallel readiness gate. Returns every failing reason (empty = dispatchable).
function checkDispatch(root, s, id) {
  const t = s.tasks.find((x) => x.id === id);
  if (!t) return [`unknown task ${id}`];
  const problems = [];
  if (s.blocker) problems.push(`change is blocked: ${s.blocker}`);
  if (s.stages.build.status !== 'in_progress') problems.push('build stage is not in progress (run `adlc stage start build`)');
  if (!s.execution.mode) problems.push('execution plan missing: run `adlc exec plan`');
  else if (s.execution.plan_hash !== planHash(s)) problems.push('execution plan is out of date: run `adlc exec plan` and get the plan re-approved');
  const g = gates.check(root, s, 'plan');
  if (!g.ok) problems.push(g.reason);
  for (const x of packetProblems(s, t)) problems.push(`packet not execution-ready: ${x}`);
  if (t.status !== 'todo') problems.push(`task status is ${t.status}, expected todo`);
  const pending = prereqs(s, t).filter((pid) => (s.tasks.find((x) => x.id === pid) || {}).status !== 'integrated');
  if (pending.length) problems.push(`prerequisites not integrated: ${pending.join(', ')}`);
  const active = activeLeases(s);
  if (active.some((l) => l.task === id)) problems.push('task already has an active lease');
  if (active.length >= effectiveMax(s)) problems.push(`active workers ${active.length} >= limit ${effectiveMax(s)} (${s.execution.mode || 'unplanned'} mode)`);
  for (const l of active) {
    const o = s.tasks.find((x) => x.id === l.task);
    if (!o || o.id === id) continue;
    if (conflicts(t, o)) problems.push(`writable files or resources overlap with active task ${o.id}`);
  }
  if (active.length && (isSerial(s, t) || active.some((l) => isSerial(s, getTask(s, l.task))))) problems.push('serial task cannot run alongside other tasks');
  if (s.budget.tasks_this_run >= s.budget.max_tasks_per_run) problems.push(`task budget for this run reached (${s.budget.max_tasks_per_run}); stop and resume in a new session`);
  return problems;
}

function readyToDispatch(root, s) {
  const order = s.execution.integration_order || [];
  const candidates = s.tasks
    .filter((t) => t.status === 'todo' && checkDispatch(root, s, t.id).length === 0)
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  if (effectiveMax(s) === 1) return candidates.slice(0, 1);
  const active = activeLeases(s).map((l) => getTask(s, l.task));
  const capacity = effectiveMax(s) - active.length;
  const picked = [];
  for (const t of candidates) {
    if (picked.length >= capacity) break;
    if (picked.some((o) => conflicts(t, o) || isSerial(s, t) || isSerial(s, o))) continue;
    picked.push(t);
  }
  // Heuristic: parallelism only pays off with at least two non-trivial, independent tasks.
  const worthIt = [...active, ...picked].filter((t) => t.size !== 'S' && !t.coupled).length >= 2;
  if (!worthIt) return active.length ? [] : picked.slice(0, 1);
  return picked;
}

function startDispatch(root, s, id, { session = 'unknown' } = {}) {
  if (s.budget.session !== session) {
    s.budget.session = session;
    s.budget.tasks_this_run = 0;
  }
  const problems = checkDispatch(root, s, id);
  if (problems.length) throw rule(`cannot dispatch ${id}:\n- ${problems.join('\n- ')}`);
  const t = getTask(s, id);
  const lease = { task: id, lease: `L-${crypto.randomBytes(3).toString('hex')}`, session, agent_id: null, workspace: null, status: 'active', started: now(), ended: null };
  s.leases.push(lease);
  t.status = 'dispatched';
  t.timing = { ...t.timing, dispatched_at: lease.started };
  s.budget.tasks_this_run += 1;
  writePackets(root, s, [id]);
  return lease;
}

function findLease(s, leaseId) {
  const lease = s.leases.find((l) => l.lease === leaseId);
  if (!lease) throw rule(`unknown lease ${leaseId}`);
  return lease;
}

function requireNote(note, example) {
  if (typeof note !== 'string' || !note.trim()) throw usage(`describe what you inspected, e.g. ${example}`);
  return note.trim();
}

// Coordinator confirms, after inspection, that a worker without a SubagentStop record has stopped.
function confirmStopped(s, leaseId, note) {
  const lease = findLease(s, leaseId);
  if (lease.status !== 'active') throw rule(`lease ${leaseId} is ${lease.status}, not active`);
  lease.stop_confirmed = { note: requireNote(note, `adlc lease stopped ${leaseId} "foreground worker returned"`), ts: now() };
  return lease;
}

function markLost(s, leaseId, note) {
  const lease = findLease(s, leaseId);
  if (!['active', 'returned'].includes(lease.status)) throw rule(`lease ${leaseId} is already ${lease.status}`);
  const text = requireNote(note, `adlc lease lost ${leaseId} "no changes in workspace"`);
  endLease(lease, 'lost');
  lease.note = text;
  const t = getTask(s, lease.task);
  if (['dispatched', 'returned'].includes(t.status)) return repairTask(s, t.id, `lease ${leaseId} lost: ${text}`);
  return t.status;
}

module.exports = {
  activeLeases, effectiveMax, stops, hasStopped, leaseFor, endLease, checkDispatch, readyToDispatch, startDispatch, confirmStopped, markLost,
};
