'use strict';
const { STAGES, now } = require('./state');
const { usage, rule } = require('./errors');

const SKIPPABLE = new Set(['discover', 'specify', 'design', 'release']);
const DONE = new Set(['completed', 'skipped']);

function current(s) {
  return STAGES.find((st) => !DONE.has(s.stages[st].status)) || 'done';
}

function assertStage(stage) {
  if (!STAGES.includes(stage)) throw usage(`unknown stage "${stage}"; stages: ${STAGES.join(', ')}`);
}

function fail(verb, stage, problems) {
  return rule(`cannot ${verb} ${stage}:\n- ${problems.join('\n- ')}`);
}

function startStage(s, stage, { preconditions = () => [] } = {}) {
  assertStage(stage);
  if (s.blocker) throw rule(`change is blocked: ${s.blocker}`);
  const cur = current(s);
  if (stage !== cur) throw rule(`cannot start ${stage}: current stage is ${cur}`);
  if (s.stages[stage].status === 'in_progress') return false;
  const problems = preconditions(stage);
  if (problems.length) throw fail('start', stage, problems);
  s.stages[stage] = { status: 'in_progress', started: now() };
  s.stage = stage;
  return true;
}

function completeStage(s, stage, { preconditions = () => [] } = {}) {
  assertStage(stage);
  if (s.blocker) throw rule(`change is blocked: ${s.blocker}`);
  if (s.stages[stage].status !== 'in_progress') throw rule(`cannot complete ${stage}: it is ${s.stages[stage].status}`);
  const problems = preconditions(stage);
  if (problems.length) throw fail('complete', stage, problems);
  s.stages[stage] = { ...s.stages[stage], status: 'completed', ended: now() };
  s.stage = current(s);
  return s.stage;
}

function skipStage(s, stage, reason) {
  assertStage(stage);
  if (!SKIPPABLE.has(stage)) throw rule(`${stage} cannot be skipped (skippable: ${[...SKIPPABLE].join(', ')})`);
  if (typeof reason !== 'string' || !reason.trim()) throw usage('a skip reason is required');
  const status = s.stages[stage].status;
  if (DONE.has(status)) throw rule(`${stage} is already ${status}`);
  s.stages[stage] = { status: 'skipped', reason: reason.trim(), ts: now() };
  s.stage = current(s);
}

// A blocking review or failed verification sends the change back to build.
function reopenBuild(s) {
  const { ended, ...rest } = s.stages.build;
  s.stages.build = { ...rest, status: 'in_progress', reopened: now() };
  for (const st of ['verify', 'review', 'release']) if (s.stages[st].status !== 'skipped') s.stages[st] = { status: 'pending' };
  s.stage = 'build';
}

function nextAction(s) {
  const cur = current(s);
  if (s.blocker) return { action: 'blocked', stage: cur, blocker: s.blocker };
  if (cur === 'done') return { action: 'done', stage: 'done' };
  return { action: s.stages[cur].status === 'in_progress' ? 'continue' : 'start', stage: cur };
}

module.exports = { SKIPPABLE, current, startStage, completeStage, skipStage, reopenBuild, nextAction };
