'use strict';
// Proof that the user, not the model, asked for approve / skip / unblock / archive / cancel (or a start with reduced gates).
// The UserPromptSubmit hook sees only prompts the user submits and records an intent here (hooks/prompt-submit.js).
// The CLI needs one matching, unexpired, unused intent per action. There is no terminal shortcut: a pseudo-terminal
// (`script -c ...`) is indistinguishable from a person, so a person at a terminal types the slash command too.
const path = require('node:path');
const crypto = require('node:crypto');
const { paths, normalizeConfig } = require('./state');
const { appendLine, readJsonLines } = require('./fsutil');
const { rule } = require('./errors');

const TTL_MS = 15 * 60 * 1000;
const ACTIONS = ['approve', 'skip', 'unblock', 'archive', 'cancel', 'start'];
const GATES = ['plan', 'release'];

const file = (root) => path.join(paths(root).runs, 'intents.jsonl');

// Canonical name of a set of approval gates: "plan,release", "plan", "none".
const gatesKey = (list) => [...new Set(list)].sort().join(',') || 'none';
const FULL_GATES = gatesKey(GATES);

// The gates a raw setting asks for, or null when it is absent, unsubstituted or invalid.
function gatesOf(raw) {
  if (typeof raw !== 'string' || !raw.trim() || raw.includes('${')) return null;
  try {
    return gatesKey(normalizeConfig({ approval_gates: raw.replace(/^['"]|['"]$/g, '') }).approval_gates);
  } catch {
    return null;
  }
}

// "/adlc:approve plan looks good" -> { action: 'approve', arg: 'plan' }; "/adlc:skip design reason" -> arg 'design'.
// "/adlc:start x" yields an intent only when the user's prompt or plugin setting reduces the approval gates.
function parsePrompt(prompt, env = process.env) {
  const m = /^\s*\/adlc:(approve|skip|unblock|archive|cancel|start)\b\s*(\S*)/.exec(String(prompt || ''));
  if (!m) return null;
  const [, action, first] = m;
  if (['unblock', 'archive', 'cancel'].includes(action)) return { action, arg: null };
  if (action === 'approve') return GATES.includes(first) ? { action, arg: first } : null;
  if (action === 'skip') return first ? { action, arg: first } : null;
  const flag = /--approval-gates(?:\s+|=)(\S+)/.exec(String(prompt));
  const key = (flag && gatesOf(flag[1])) || gatesOf(env.CLAUDE_PLUGIN_OPTION_APPROVAL_GATES);
  return key && key !== FULL_GATES ? { action, arg: key } : null;
}

function record(root, { action, arg = null, session, hash }) {
  const rec = { type: 'intent', id: crypto.randomBytes(6).toString('hex'), action, arg, session: session || null, ts: new Date().toISOString() };
  if (hash) rec.hash = hash;
  appendLine(file(root), rec);
  return rec;
}

function pending(root, action, arg = null, nowMs = Date.now()) {
  const lines = readJsonLines(file(root));
  const used = new Set(lines.filter((l) => l.type === 'consumed').map((l) => l.id));
  const want = arg === undefined ? null : arg;
  return lines.filter((l) => l.type === 'intent' && l.action === action && !used.has(l.id) && nowMs - Date.parse(l.ts) <= TTL_MS && (l.arg === undefined ? null : l.arg) === want).pop() || null;
}

// Returns the user's matching intent or throws. The caller validates the action, performs it, then calls consume().
function find(root, action, arg = null, hint = '') {
  const found = pending(root, action, arg);
  if (!found) {
    const what = `${action}${arg && action !== 'start' ? ` ${arg}` : ''}`;
    throw rule(`the user has not asked for this: only the user can run \`adlc ${what}\`${hint ? ` ${hint}` : ''}. Ask them to type /adlc:${what} themselves, then run it once`);
  }
  return found;
}

// One request authorises one command.
function consume(root, intent) {
  appendLine(file(root), { type: 'consumed', id: intent.id, ts: new Date().toISOString() });
}

module.exports = { TTL_MS, ACTIONS, GATES, FULL_GATES, gatesKey, parsePrompt, record, pending, find, consume };
