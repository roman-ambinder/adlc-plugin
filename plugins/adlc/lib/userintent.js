'use strict';
// Proof that the user, not the model, asked for approve / skip / unblock / archive / cancel (or a start with reduced gates).
// The UserPromptSubmit hook sees only prompts the user submits and records an intent here (hooks/prompt-submit.js).
// The CLI needs one matching, unexpired, unused intent per action. There is no terminal shortcut: a pseudo-terminal
// (`script -c ...`) is indistinguishable from a person, so a person at a terminal types the slash command too.
const fs = require('node:fs');
const os = require('node:os');
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

function record(root, { action, arg = null, session, hash, transcript }) {
  const rec = { type: 'intent', id: crypto.randomBytes(6).toString('hex'), action, arg, session: session || null, ts: new Date().toISOString() };
  if (hash) rec.hash = hash;
  if (transcript) rec.transcript = String(transcript);
  appendLine(file(root), rec);
  return rec;
}

function pending(root, action, arg = null, nowMs = Date.now()) {
  const lines = readJsonLines(file(root));
  const used = new Set(lines.filter((l) => l.type === 'consumed').map((l) => l.id));
  const want = arg === undefined ? null : arg;
  return lines.filter((l) => l.type === 'intent' && l.action === action && !used.has(l.id) && nowMs - Date.parse(l.ts) <= TTL_MS && (l.arg === undefined ? null : l.arg) === want).pop() || null;
}

// Claude Code keeps each session's transcript under <config dir>/projects/. Only Claude Code writes it, and a slash
// command the user typed appears there as a user entry with <command-name>/adlc:<action></command-name>.
const projectsDir = (env = process.env) => path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
const realOrNull = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
};

// The transcript entry that proves the user typed this command, not yet used by an earlier action. An intent recorded by
// running the hook script by hand (rather than by Claude Code on a real prompt) has no such entry.
function proof(intent, action, arg, usedEntries) {
  if (!intent.transcript) return { problem: 'no session transcript was recorded with the prompt' };
  const dir = realOrNull(projectsDir());
  const file = realOrNull(intent.transcript);
  if (!dir || !file || !file.startsWith(dir + path.sep)) return { problem: "the recorded session transcript is not in Claude Code's projects folder" };
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { problem: 'the session transcript cannot be read' };
  }
  const tag = `<command-name>/adlc:${action}</command-name>`;
  const since = Date.parse(intent.ts) - 2 * 60 * 1000;
  let found = null;
  for (const line of text.split('\n')) {
    if (!line.includes(tag)) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const c = e && e.message && e.message.content;
    const body = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x && typeof x.text === 'string' ? x.text : '')).join('\n') : '';
    if (e.type !== 'user' || e.isMeta || !body.includes(tag) || !(Date.parse(e.timestamp) >= since)) continue;
    const first = ((/<command-args>([\s\S]*?)<\/command-args>/.exec(body) || [])[1] || '').trim().split(/\s+/)[0] || null;
    if (arg && action !== 'start' && first !== arg) continue;
    const id = e.uuid || `${file}@${e.timestamp}`;
    if (!usedEntries.has(id)) found = id;
  }
  return found ? { entry: found } : { problem: `the session transcript has no unused /adlc:${action} typed by the user` };
}

// Returns the user's matching intent, with its transcript proof, or throws. The caller validates the action, performs it,
// then calls consume().
function find(root, action, arg = null, hint = '') {
  const what = `${action}${arg && action !== 'start' ? ` ${arg}` : ''}`;
  const refuse = (why) => rule(`the user has not asked for this: only the user can run \`adlc ${what}\`${hint ? ` ${hint}` : ''}${why ? ` (${why})` : ''}. Ask them to type /adlc:${what} themselves, then run it once`);
  const found = pending(root, action, arg);
  if (!found) throw refuse('');
  const used = new Set(readJsonLines(file(root)).filter((l) => l.type === 'consumed' && l.entry).map((l) => l.entry));
  const p = proof(found, action, arg, used);
  if (p.problem) throw refuse(p.problem);
  return { ...found, entry: p.entry };
}

// One request authorises one command; the transcript entry that proved it cannot be used again.
function consume(root, intent) {
  appendLine(file(root), { type: 'consumed', id: intent.id, entry: intent.entry || null, ts: new Date().toISOString() });
}

module.exports = { projectsDir, proof, TTL_MS, ACTIONS, GATES, FULL_GATES, gatesKey, parsePrompt, record, pending, find, consume };
