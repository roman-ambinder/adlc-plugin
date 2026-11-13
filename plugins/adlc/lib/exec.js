'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { paths } = require('./state');
const { sha256, atomicWrite, replaceSection } = require('./fsutil');
const { prereqs, canonicalTasks } = require('./tasks');
const { isGlob, globToRegExp, entriesOverlap, setsOverlap } = require('./glob');
const { rule } = require('./errors');
const { worktreeProblems } = require('./worktree');

// Serial patterns without "/" match basenames anywhere. Glob writable entries are treated as serial (conservative).
function serialMatch(pattern, file) {
  if (isGlob(file)) return true;
  if (!pattern.includes('/')) {
    const base = file.replace(/\/+$/, '').split('/').pop();
    return isGlob(pattern) ? globToRegExp(pattern).test(base) : base === pattern;
  }
  return entriesOverlap(pattern, file);
}

function isSerial(s, t) {
  return t.coupled || t.files.some((f) => s.config.serial_globs.some((g) => serialMatch(g, f)));
}

function conflicts(a, b) {
  return setsOverlap(a.files, b.files) || a.resources.some((r) => b.resources.includes(r));
}

function byId(a, b) {
  return Number(a.id.slice(1)) - Number(b.id.slice(1));
}

function computeWaves(s, max) {
  const remaining = new Map(s.tasks.map((t) => [t.id, t]));
  const done = new Set();
  const waves = [];
  const order = [];
  while (remaining.size) {
    const level = [...remaining.values()].filter((t) => prereqs(s, t).every((id) => done.has(id))).sort(byId);
    if (!level.length) throw rule(`dependency cycle among tasks: ${[...remaining.keys()].join(', ')}`);
    const buckets = [];
    for (const t of level) {
      const serial = isSerial(s, t);
      let b = serial ? null : buckets.find((x) => !x.serial && x.tasks.length < max && x.tasks.every((o) => !conflicts(t, o)));
      if (!b) {
        b = { serial, tasks: [] };
        buckets.push(b);
      }
      b.tasks.push(t);
    }
    for (const b of buckets) waves.push(b.tasks.map((t) => t.id));
    for (const t of level) {
      done.add(t.id);
      remaining.delete(t.id);
      order.push(t.id);
    }
  }
  return { waves, integration_order: order };
}

function planHash(s) {
  return sha256(JSON.stringify({
    tasks: canonicalTasks(s), contracts: s.contracts, requested: s.execution.resolved_from, max: s.execution.max_parallel, serial: s.config.serial_globs,
  }));
}

// Shared mode needs hooks to see each subagent's agent_id (documented, and confirmed live on Claude Code 2.1.311).
// If agent_id were missing, unbound workers are denied every write, so the failure is safe and visible.
function resolveMode(root, s, opts = {}) {
  const requested = s.execution.resolved_from;
  const seq = (reason) => ({ mode: 'sequential', reasons: [reason] });
  if (requested === 'sequential') return seq('sequential mode configured');
  if (s.tasks.length < 2) return seq(`${requested} requested; fewer than two tasks, so sequential`);
  if (s.execution.max_parallel < 2) return seq(`${requested} requested; max_parallel is 1, so sequential`);
  const { waves } = computeWaves(s, s.execution.max_parallel);
  const byId = new Map(s.tasks.map((t) => [t.id, t]));
  const useful = waves.findIndex((w) => w.filter((id) => byId.get(id).size !== 'S' && !byId.get(id).coupled).length >= 2);
  if (useful === -1) return seq(`${requested} requested; no wave has two independent tasks of size M or L, so parallelism would not pay off`);
  const reasons = [`independent tasks found (wave ${useful + 1}: ${waves[useful].join(', ')})`];
  if (requested === 'shared') return { mode: 'shared', reasons: [...reasons, 'shared checkout with disjoint writable files'] };
  const wt = opts.worktreeProblems ? opts.worktreeProblems : worktreeProblems(root);
  if (!wt.length) return { mode: 'worktree', reasons: [...reasons, 'each worker gets its own git worktree; the coordinator commits and merges them in integration order'] };
  return { mode: 'shared', reasons: [...reasons, `worktree mode unavailable (${wt.join('; ')}), so the shared checkout with disjoint writable files is used`] };
}

function writePlanSections(root, s) {
  const p = paths(root);
  const f = path.join(p.dir, 'plan.md');
  const text = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '# Plan\n';
  const tasksMd = s.tasks.map((t) => `- **${t.id}** ${t.title} — files: ${t.files.join(', ')}; deps: ${t.deps.join(', ') || 'none'}; contracts: ${[...t.contracts.provides.map((c) => `provides ${c}`), ...t.contracts.consumes.map((c) => `consumes ${c}`)].join(', ') || 'none'}; AC: ${t.ac.join(', ')}; checks: ${t.checks.map((c) => `\`${c}\``).join(', ')}; size ${t.size}`).join('\n') || '_No tasks yet._';
  const e = s.execution;
  const execMd = [
    `- mode: ${e.mode} (requested: ${e.resolved_from}, max parallel: ${e.max_parallel})`,
    ...e.reasons.map((r) => `- reason: ${r}`),
    ...e.waves.map((w, i) => `- wave ${i + 1}: ${w.join(', ')}`),
    `- integration order: ${e.integration_order.join(' → ') || 'none'}`,
  ].join('\n');
  atomicWrite(f, replaceSection(replaceSection(text, 'tasks', `## Tasks\n${tasksMd}`), 'execution', `## Execution plan\n${execMd}`), p.tmp);
}

function planExecution(root, s, opts = {}) {
  const resolved = opts.mode ? { mode: opts.mode, reasons: [`mode set to ${opts.mode} explicitly`] } : resolveMode(root, s);
  const max = resolved.mode === 'sequential' ? 1 : s.execution.max_parallel;
  const { waves, integration_order } = computeWaves(s, max);
  s.execution = { ...s.execution, mode: resolved.mode, reasons: resolved.reasons, waves, integration_order };
  s.execution.plan_hash = planHash(s);
  writePlanSections(root, s);
  return s.execution;
}

module.exports = { serialMatch, isSerial, conflicts, computeWaves, planHash, resolveMode, planExecution, writePlanSections };
