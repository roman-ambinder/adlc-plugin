'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { paths, now } = require('./state');
const { atomicWrite, withLock } = require('./fsutil');
const { redact } = require('./redact');
const { usage } = require('./errors');

const MAX_LINES = 200;
const HEADER = /^<!-- adlc-evidence (\{.*\}) -->/;

function truncate(text) {
  const lines = text.replace(/\n+$/, '').split('\n');
  if (lines.length <= MAX_LINES) return { text, truncated: false };
  return { text: `[... ${lines.length - MAX_LINES} earlier lines truncated ...]\n${lines.slice(-MAX_LINES).join('\n')}`, truncated: true };
}

function display(cmd) {
  return cmd.length === 1 ? cmd[0] : cmd.map((a) => (/[\s"'$\\()|&;<>*?`]/.test(a) ? JSON.stringify(a) : a)).join(' ');
}

function execute(cmd, cwd, timeout) {
  const opts = { cwd, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 };
  const started = Date.now();
  const r = cmd.length === 1 ? spawnSync('sh', ['-c', cmd[0]], opts) : spawnSync(cmd[0], cmd.slice(1), opts);
  const duration_ms = Date.now() - started;
  let exit;
  if (r.error && r.error.code === 'ENOENT') exit = 127;
  else if (r.status !== null) exit = r.status;
  else exit = 128;
  const output = [r.stdout, r.stderr, r.error ? String(r.error.message) : ''].filter(Boolean).join('\n');
  return { exit, duration_ms, output, timed_out: Boolean(r.error && r.error.code === 'ETIMEDOUT') };
}

// Executes the command itself and records what actually happened. This is the only way evidence is created.
function run(root, { stage, task = null, cmd, cwd = process.cwd(), exclusive = false, timeoutMs } = {}) {
  if (!stage || stage === true) throw usage('--stage is required');
  if (!cmd || !cmd.length) throw usage('give the command after --, e.g. adlc run --stage verify -- "npm test"');
  const timeout = timeoutMs || Number(process.env.ADLC_RUN_TIMEOUT_MS) || 15 * 60 * 1000;
  const p = paths(root);
  const go = () => execute(cmd, cwd, timeout);
  const r = exclusive ? withLock(p.checkLock, go, { waitMs: timeout, staleMs: timeout + 60000 }) : go();
  const { text, truncated } = truncate(redact(r.output));
  const ts = now();
  const id = `E-${ts.replace(/\D/g, '').slice(0, 17)}-${crypto.randomBytes(3).toString('hex')}`;
  const rel = path.relative(root, path.resolve(cwd)).split(path.sep).join('/') || '.';
  const meta = { id, stage, task, cmd: redact(display(cmd)), cwd: rel, exit: r.exit, duration_ms: r.duration_ms, timed_out: r.timed_out, truncated, ts };
  const name = `${id}-${stage}${task ? `-${task}` : ''}.md`;
  const body = [
    `<!-- adlc-evidence ${JSON.stringify(meta)} -->`,
    `# Evidence ${id}`,
    '',
    `- stage: ${stage}`,
    `- task: ${task || '-'}`,
    `- command: \`${meta.cmd}\``,
    `- cwd: ${meta.cwd}`,
    `- exit code: ${r.exit}${r.timed_out ? ' (timed out)' : ''}`,
    `- duration: ${r.duration_ms} ms`,
    `- recorded: ${ts}`,
    '',
    '```text',
    text.replace(/```/g, "'''"),
    '```',
    '',
  ].join('\n');
  atomicWrite(path.join(p.results, name), body, p.tmp);
  return { ...meta, file: `test-results/${name}` };
}

function list(root) {
  const dir = paths(root).results;
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.md')) continue;
    const first = fs.readFileSync(path.join(dir, name), 'utf8').split('\n', 1)[0];
    const m = HEADER.exec(first);
    if (!m) continue;
    try {
      out.push({ ...JSON.parse(m[1]), file: `test-results/${name}` });
    } catch {
      // ignore malformed headers
    }
  }
  return out.sort((a, b) => (a.ts === b.ts ? (a.id < b.id ? -1 : 1) : a.ts < b.ts ? -1 : 1));
}

function latestByCmd(entries) {
  const m = new Map();
  for (const e of entries) m.set(e.cmd, e);
  return m;
}

module.exports = { MAX_LINES, run, list, latestByCmd, display };
