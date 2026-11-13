'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { lib } = require('./helpers');

const st = lib('state');
const stages = lib('stages');
const fresh = (small = false) => st.newState({ title: 't', small });

test('stages advance strictly in order', () => {
  const s = fresh();
  assert.throws(() => stages.startStage(s, 'plan'), /current stage is discover/);
  assert.equal(stages.startStage(s, 'discover'), true);
  assert.equal(stages.startStage(s, 'discover'), false, 'starting twice is a no-op');
  assert.equal(stages.completeStage(s, 'discover'), 'specify');
  assert.throws(() => stages.completeStage(s, 'specify'), /it is pending/);
  assert.throws(() => stages.startStage(s, 'nope'), (e) => e.exitCode === 1);
});

test('skip needs a reason and a skippable stage, and is recorded', () => {
  const s = fresh();
  assert.throws(() => stages.skipStage(s, 'build', 'x'), /cannot be skipped/);
  assert.throws(() => stages.skipStage(s, 'discover', ' '), (e) => e.exitCode === 1);
  stages.skipStage(s, 'discover', 'tiny fix');
  assert.deepEqual([s.stages.discover.status, s.stages.discover.reason], ['skipped', 'tiny fix']);
  assert.equal(stages.current(s), 'specify');
  assert.throws(() => stages.skipStage(s, 'discover', 'again'), /already skipped/);
});

test('preconditions block start and completion with every reason', () => {
  const s = fresh();
  assert.throws(() => stages.startStage(s, 'discover', { preconditions: () => ['a', 'b'] }), /cannot start discover:\n- a\n- b/);
  stages.startStage(s, 'discover');
  assert.throws(() => stages.completeStage(s, 'discover', { preconditions: () => ['missing x'] }), /missing x/);
  assert.equal(s.stages.discover.status, 'in_progress');
});

test('a blocker stops progress', () => {
  const s = fresh();
  s.blocker = 'limit';
  assert.throws(() => stages.startStage(s, 'discover'), /blocked: limit/);
  assert.deepEqual(stages.nextAction(s), { action: 'blocked', stage: 'discover', blocker: 'limit' });
});

test('reopenBuild resets later stages but keeps skips', () => {
  const s = fresh(true);
  for (const x of ['specify', 'plan', 'build', 'verify', 'review']) s.stages[x] = { status: 'completed' };
  stages.skipStage(s, 'release', 'internal tool');
  stages.reopenBuild(s);
  assert.equal(s.stages.build.status, 'in_progress');
  assert.equal(s.stages.verify.status, 'pending');
  assert.equal(s.stages.review.status, 'pending');
  assert.equal(s.stages.release.status, 'skipped');
  assert.equal(stages.current(s), 'build');
});

test('nextAction reports start, continue and done', () => {
  const s = fresh();
  assert.deepEqual(stages.nextAction(s), { action: 'start', stage: 'discover' });
  stages.startStage(s, 'discover');
  assert.deepEqual(stages.nextAction(s), { action: 'continue', stage: 'discover' });
  for (const x of st.STAGES) s.stages[x] = { status: 'completed' };
  assert.deepEqual(stages.nextAction(s), { action: 'done', stage: 'done' });
});
