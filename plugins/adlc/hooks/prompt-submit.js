#!/usr/bin/env node
'use strict';
// UserPromptSubmit: only text the user submits reaches this hook, never model-generated commands.
// A user-typed /adlc:approve, /adlc:skip, /adlc:unblock or /adlc:archive leaves an intent the CLI requires before it acts.
// An approval intent carries the hash of what the user was looking at, so edits made after the prompt are not approved.
// /adlc:start leaves one only when the user's prompt or plugin setting reduces the approval gates.
const { readStdin, lifecycle, startDirs, noteSession } = require('./common');
const { parsePrompt, record } = require('../lib/userintent');
const st = require('../lib/state');

function main() {
  const input = readStdin();
  const ctx = lifecycle(input);
  if (ctx) noteSession(ctx, input);
  const parsed = parsePrompt(input.prompt);
  if (!parsed) return;
  try {
    let root = ctx && ctx.root;
    // No change exists yet when the user starts one: use the directory `adlc start` will pick.
    if (!root && parsed.action === 'start') root = st.findRoot(startDirs(input)[0]);
    if (!root) return;
    let hash;
    if (parsed.action === 'approve') {
      try {
        hash = require('../lib/gates').gateHash(root, st.load(root), parsed.arg);
      } catch {
        hash = undefined; // the CLI refuses an approval whose intent has no hash
      }
    }
    record(root, { ...parsed, session: input.session_id, hash });
  } catch (err) {
    process.stderr.write(`adlc prompt-submit: ${err.message}\n`);
  }
}

if (require.main === module) main();
