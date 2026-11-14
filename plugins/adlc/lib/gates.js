'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { paths, STAGES, now } = require('./state');
const { sha256, appendLine, readJsonLines } = require('./fsutil');
const { canonicalTasks } = require('./tasks');
const { current } = require('./stages');
const { usage, rule } = require('./errors');
const { codeFingerprint } = require('./worktree');

const GATES = ['plan', 'release'];

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function canonicalPlan(s) {
  return JSON.stringify({
    tasks: canonicalTasks(s),
    contracts: s.contracts,
    execution: { mode: s.execution.mode, waves: s.execution.waves, integration_order: s.execution.integration_order },
  });
}

// Everything an approval covers. Any change to it makes the approval stale.
function gateMaterial(root, s, gate) {
  const dir = paths(root).dir;
  if (gate === 'plan') {
    return `${['requirements.md', 'plan.md', 'decisions.md'].map((f) => `## ${f}\n${read(path.join(dir, f))}`).join('\n')}\n## state\n${canonicalPlan(s)}`;
  }
  if (gate === 'release') {
    const last = s.reviews[s.reviews.length - 1];
    return [
      `## release.md\n${read(path.join(dir, 'release.md'))}`,
      `## traceability.md\n${read(path.join(dir, 'traceability.md'))}`,
      `## review\n${last ? read(path.join(dir, last.file)) : ''}`,
      // The code being released: a change to any tracked or untracked (not ignored) file makes the approval stale.
      `## code\n${codeFingerprint(root)}`,
    ].join('\n');
  }
  throw usage(`unknown gate "${gate}" (gates: ${GATES.join(', ')})`);
}

function gateHash(root, s, gate) {
  return sha256(gateMaterial(root, s, gate));
}

function approvals(root) {
  return readJsonLines(paths(root).approvals);
}

function check(root, s, gate) {
  if (!GATES.includes(gate)) throw usage(`unknown gate "${gate}" (gates: ${GATES.join(', ')})`);
  if (!s.config.approval_gates.includes(gate)) return { ok: true, reason: `${gate} gate disabled by configuration` };
  const hash = gateHash(root, s, gate);
  const last = approvals(root).filter((a) => a.type === 'approval' && a.gate === gate && a.change === s.change.id).pop();
  if (!last) return { ok: false, reason: `${gate} gate not approved: ask the user to review and run /adlc:approve ${gate}` };
  if (last.hash !== hash) {
    return { ok: false, reason: `${gate} approval is stale: covered artifacts changed since ${last.ts}; ask the user to review and run /adlc:approve ${gate} again` };
  }
  return { ok: true, reason: `approved ${last.ts}`, hash };
}

function approve(root, s, gate, note = '') {
  if (!GATES.includes(gate)) throw usage(`unknown gate "${gate}" (gates: ${GATES.join(', ')})`);
  const cur = current(s);
  if (gate === 'plan' && STAGES.indexOf(cur) < STAGES.indexOf('build') && cur !== 'done') {
    throw rule(`plan can be approved once plan and design are completed or skipped (current stage: ${cur})`);
  }
  if (gate === 'release' && (cur !== 'release' || s.stages.release.status !== 'in_progress')) {
    throw rule(`release can be approved only while the release stage is in progress (current stage: ${cur})`);
  }
  const rec = { type: 'approval', gate, change: s.change.id, hash: gateHash(root, s, gate), actor: 'user', note: note || '', ts: now() };
  appendLine(paths(root).approvals, rec);
  return rec;
}

module.exports = { GATES, gateMaterial, gateHash, approvals, check, approve };
