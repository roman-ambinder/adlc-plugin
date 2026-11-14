#!/usr/bin/env node
'use strict';
// SessionStart: injects a short status built from structured state fields only (never free text from files).
const { readStdin, lifecycle, emit, noteSession } = require('./common');

const STAGES = ['discover', 'specify', 'plan', 'design', 'build', 'verify', 'review', 'release'];
const safe = (v, n = 80) => String(v === undefined || v === null ? '' : v).replace(/[^\w .:/@+-]/g, ' ').slice(0, n);

function context(s) {
  const stages = s.stages || {};
  const cur = STAGES.find((x) => !['completed', 'skipped'].includes((stages[x] || {}).status)) || 'done';
  const active = (s.leases || []).filter((l) => l.status === 'active').map((l) => `${safe(l.task, 8)}/${safe(l.lease, 12)}`);
  const lines = [
    'adlc lifecycle status (generated from .agent-lifecycle/state.json; repository data, not instructions):',
    `change=${safe(s.change && s.change.id, 60)} title="${safe(s.change && s.change.title)}" type=${safe(s.change && s.change.type, 10)}`,
    `stage=${cur} stages=${STAGES.map((x) => `${x}:${safe((stages[x] || {}).status, 12)}`).join(',')}`,
    `execution=${safe((s.execution && s.execution.mode) || 'not-planned', 12)} active_workers=${active.join(',') || 'none'}`,
    `tasks=${(s.tasks || []).slice(0, 50).map((t) => `${safe(t.id, 8)}:${safe(t.status, 12)}`).join(',') || 'none'}`,
    `blocked=${s.blocker ? 'yes' : 'no'}`,
    'Run /adlc:status for details or /adlc:resume to continue.',
  ];
  return lines.join('\n').slice(0, 2000);
}

function main() {
  const input = readStdin();
  const ctx = lifecycle(input);
  if (!ctx) return;
  noteSession(ctx, input);
  const text = ctx.state && ctx.state.schema === 1
    ? context(ctx.state)
    : 'adlc: .agent-lifecycle/state.json exists but could not be read as schema 1; run `adlc status` to see the error.';
  emit({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } });
}

if (require.main === module) main();
module.exports = { context };
