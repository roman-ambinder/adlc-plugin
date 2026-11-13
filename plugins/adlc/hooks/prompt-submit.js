#!/usr/bin/env node
'use strict';
// UserPromptSubmit: only text the user submits reaches this hook, never model-generated commands.
// A user-typed /adlc:approve, /adlc:skip or /adlc:unblock leaves an intent the CLI requires before it acts.
const { readStdin, lifecycle } = require('./common');
const { parsePrompt, record } = require('../lib/userintent');

function main() {
  const input = readStdin();
  const ctx = lifecycle(input);
  if (!ctx) return;
  const parsed = parsePrompt(input.prompt);
  if (!parsed) return;
  try {
    record(ctx.root, { ...parsed, session: input.session_id });
  } catch (err) {
    process.stderr.write(`adlc prompt-submit: ${err.message}\n`);
  }
}

if (require.main === module) main();
