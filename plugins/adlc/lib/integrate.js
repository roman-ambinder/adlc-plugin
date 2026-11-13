'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { paths, now } = require('./state');
const { atomicWrite, readJson, readJsonLines } = require('./fsutil');
const evidence = require('./evidence');
const { getTask } = require('./tasks');
const { entriesOverlap } = require('./glob');
const { hasStopped, leaseFor, endLease } = require('./dispatch');
const { rule } = require('./errors');

const HANDOFF_STATUSES = ['done', 'blocked', 'partial'];

function validateHandoff(h) {
  if (!h || typeof h !== 'object' || Array.isArray(h)) return ['handoff must be a JSON object'];
  const p = [];
  const strList = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
  if (typeof h.task !== 'string') p.push('task must be a string');
  if (!HANDOFF_STATUSES.includes(h.status)) p.push(`status must be one of ${HANDOFF_STATUSES.join(', ')}`);
  if (typeof h.workspace !== 'string' || !h.workspace) p.push('workspace must be a non-empty string');
  if (!(h.branch === null || typeof h.branch === 'string')) p.push('branch must be a string or null');
  for (const k of ['files_changed', 'interface_changes', 'blockers', 'out_of_scope']) if (!strList(h[k])) p.push(`${k} must be an array of strings`);
  if (typeof h.summary !== 'string' || !h.summary.trim()) p.push('summary must be a non-empty string');
  if (typeof h.integration_notes !== 'string') p.push('integration_notes must be a string');
  if (!Array.isArray(h.checks) || h.checks.some((c) => !c || typeof c.cmd !== 'string' || !Number.isInteger(c.exit) || typeof c.evidence !== 'string')) {
    p.push('checks must be an array of {cmd: string, exit: integer, evidence: string}');
  }
  return p;
}

function handoffPath(root, id) {
  return path.join(paths(root).handoffs, `${id}.json`);
}

// Worker side: validates and stores the handoff. Never touches state.json.
function submitHandoff(root, s, id, h) {
  const t = getTask(s, id);
  const problems = validateHandoff(h);
  if (h && typeof h === 'object' && h.task !== id) problems.push(`handoff.task is ${h.task}, expected ${id}`);
  if (t.status !== 'dispatched') problems.push(`task ${id} is ${t.status}, not dispatched`);
  if (problems.length) throw rule(`handoff rejected:\n- ${problems.join('\n- ')}`);
  const f = handoffPath(root, id);
  atomicWrite(f, `${JSON.stringify(h, null, 2)}\n`, paths(root).tmp);
  return f;
}

function attributedWrites(root, lease) {
  const runs = paths(root).runs;
  const bindings = readJson(path.join(runs, 'bindings.json'), {});
  const agents = Object.entries(bindings).filter(([, b]) => b && b.lease === lease.lease).map(([a]) => a);
  return readJsonLines(path.join(runs, 'writes.jsonl')).filter((w) => agents.includes(w.agent_id)).map((w) => w.path);
}

function gitChanged(root) {
  const r = spawnSync('git', ['status', '--porcelain', '-uall'], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) return null;
  return r.stdout.split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, '').split(' -> ').pop()).filter((f) => !f.startsWith('.agent-lifecycle/'));
}

function crossChecks(s, id) {
  return [...new Set(s.tasks.filter((t) => t.status === 'integrated' || t.id === id).flatMap((t) => t.checks))];
}

function integrateCheck(root, s, id) {
  const t = getTask(s, id);
  const problems = [];
  const warnings = [];
  if (!['dispatched', 'returned'].includes(t.status)) problems.push(`task ${id} is ${t.status}; only dispatched tasks can be integrated`);
  const lease = leaseFor(s, id);
  if (!lease) problems.push(`task ${id} has no active lease`);
  else if (lease.status === 'active' && !hasStopped(root, lease)) {
    problems.push(`no SubagentStop record for ${lease.lease}: the worker may still be running. After confirming it stopped, run \`adlc lease stopped ${lease.lease} "<what you inspected>"\``);
  }
  const hf = handoffPath(root, id);
  let h = null;
  if (!fs.existsSync(hf)) problems.push(`no handoff at handoffs/${id}.json`);
  else {
    h = readJson(hf, null);
    const hp = validateHandoff(h);
    problems.push(...hp.map((x) => `handoff: ${x}`));
    if (!hp.length && h.status !== 'done') problems.push(`handoff status is ${h.status}${h.blockers.length ? `: ${h.blockers.join('; ')}` : ''}`);
  }
  const since = t.timing.dispatched_at || '';
  const ev = evidence.list(root).filter((e) => e.task === id && e.ts >= since);
  if (h && Array.isArray(h.checks)) {
    for (const c of h.checks) {
      const e = ev.find((x) => x.file === c.evidence || path.basename(x.file) === path.basename(String(c.evidence)));
      if (!e) problems.push(`claimed check "${c.cmd}" has no evidence record "${c.evidence}" for ${id}`);
      else if (e.cmd !== c.cmd || e.exit !== c.exit) problems.push(`claimed check "${c.cmd}" (exit ${c.exit}) does not match ${e.file} ("${e.cmd}", exit ${e.exit})`);
    }
  }
  for (const cmd of t.checks) {
    const last = ev.filter((e) => e.cmd === cmd).pop();
    if (!last) problems.push(`packet check "${cmd}" was not run through adlc run`);
    else if (last.exit !== 0) problems.push(`packet check "${cmd}" failed (exit ${last.exit}, ${last.file})`);
  }
  const changed = new Set([...(lease ? attributedWrites(root, lease) : []), ...(h && Array.isArray(h.files_changed) ? h.files_changed : [])]);
  const outside = [...changed].filter((f) => !f.startsWith('.agent-lifecycle/tmp/') && !t.files.some((g) => entriesOverlap(g, f)));
  if (outside.length) problems.push(`changed files outside ${id}'s writable set: ${outside.join(', ')}`);
  const git = gitChanged(root);
  if (git) {
    const owned = s.tasks.filter((x) => !['todo', 'blocked'].includes(x.status)).flatMap((x) => x.files);
    const stray = git.filter((f) => !owned.some((g) => entriesOverlap(g, f)));
    if (stray.length) warnings.push(`uncommitted changes not owned by any dispatched or integrated task: ${stray.join(', ')}`);
  }
  return { ok: problems.length === 0, problems, warnings, changed: [...changed], cross_checks: crossChecks(s, id) };
}

function recordReturned(s, id) {
  const t = getTask(s, id);
  const lease = leaseFor(s, id);
  t.status = 'returned';
  t.timing = { ...t.timing, returned_at: now() };
  if (lease && lease.status === 'active') endLease(lease, 'returned');
}

function integrateDone(root, s, id) {
  const t = getTask(s, id);
  if (t.status !== 'returned') throw rule(`task ${id} is ${t.status}; run \`adlc integrate check ${id}\` first`);
  const ev = evidence.list(root).filter((e) => e.ts >= t.timing.returned_at);
  const problems = [];
  for (const cmd of crossChecks(s, id)) {
    const last = ev.filter((e) => e.cmd === cmd).pop();
    if (!last) problems.push(`cross-task check "${cmd}" has not been run since ${id} returned (run: adlc run --stage build -- "${cmd}")`);
    else if (last.exit !== 0) problems.push(`cross-task check "${cmd}" failed (exit ${last.exit}, ${last.file})`);
  }
  if (problems.length) throw rule(`cannot integrate ${id}:\n- ${problems.join('\n- ')}\nIf a check failed, run \`adlc task repair ${id} "<reason>"\`.`);
  t.status = 'integrated';
  t.timing = { ...t.timing, integrated_at: now() };
}

module.exports = { validateHandoff, handoffPath, submitHandoff, attributedWrites, gitChanged, crossChecks, integrateCheck, recordReturned, integrateDone };
