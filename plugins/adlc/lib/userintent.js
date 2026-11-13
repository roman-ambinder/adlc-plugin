'use strict';
// Proof that the user, not the model, asked for approve / skip / unblock.
// The UserPromptSubmit hook sees only prompts the user submits and records an intent here (hooks/prompt-submit.js).
// The CLI consumes one matching, unexpired intent per action, or is being run by a person at a terminal.
const path = require('node:path');
const crypto = require('node:crypto');
const { paths } = require('./state');
const { appendLine, readJsonLines } = require('./fsutil');
const { rule } = require('./errors');

const TTL_MS = 15 * 60 * 1000;
const ACTIONS = ['approve', 'skip', 'unblock'];

const file = (root) => path.join(paths(root).runs, 'intents.jsonl');

// "/adlc:approve plan looks good" -> { action: 'approve', arg: 'plan' }; "/adlc:skip design reason" -> arg 'design'.
function parsePrompt(prompt) {
  const m = /^\s*\/adlc:(approve|skip|unblock)\b\s*(\S*)/.exec(String(prompt || ''));
  return m ? { action: m[1], arg: m[1] === 'unblock' ? null : m[2] || null } : null;
}

function record(root, { action, arg, session }) {
  const rec = { type: 'intent', id: crypto.randomBytes(6).toString('hex'), action, arg, session: session || null, ts: new Date().toISOString() };
  appendLine(file(root), rec);
  return rec;
}

function pending(root, action, arg, nowMs = Date.now()) {
  const lines = readJsonLines(file(root));
  const used = new Set(lines.filter((l) => l.type === 'consumed').map((l) => l.id));
  return lines.filter((l) => l.type === 'intent' && l.action === action && !used.has(l.id) && nowMs - Date.parse(l.ts) <= TTL_MS && (l.arg === null || l.arg === arg)).pop() || null;
}

const humanAtTerminal = () => Boolean(process.stdin.isTTY && process.stdout.isTTY);

// Throws unless the user asked for this action. Consumes the intent so one request authorises one command.
function require_(root, action, arg = null) {
  if (humanAtTerminal()) return 'terminal';
  const found = pending(root, action, arg);
  if (!found) {
    throw rule(`the user has not asked for this: only the user can run \`adlc ${action}${arg ? ` ${arg}` : ''}\`. Ask them to type /adlc:${action}${arg ? ` ${arg}` : ''} themselves (or run the command in a terminal), then run it once`);
  }
  appendLine(file(root), { type: 'consumed', id: found.id, ts: new Date().toISOString() });
  return 'prompt';
}

module.exports = { TTL_MS, ACTIONS, parsePrompt, record, pending, require: require_ };
