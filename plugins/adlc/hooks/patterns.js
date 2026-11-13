'use strict';

// Files only the adlc CLI (state.json, approvals.jsonl) or hooks (runs/) may write.
const PROTECTED_PATH = /^\.agent-lifecycle\/(state\.json|approvals\.jsonl|runs\/)/;
const PROTECTED_IN_CMD = /\.agent-lifecycle\/(state\.json|approvals\.jsonl|runs\/)/;
// Bare names (e.g. after `cd .agent-lifecycle`): may be another project file, so these only ask.
const MANAGED_NAME_IN_CMD = /(^|[\s/'"])(state\.json|approvals\.jsonl|bindings\.json|stops\.jsonl|writes\.jsonl|audit\.jsonl)\b|(^|[\s'"])runs\//;
const WRITE_OPS = /(>|\btee\b|\bsed\s+-i|\brm\b|\bmv\b|\bcp\b|\btruncate\b|\bdd\b|\bpython3?\b|\bnode\b|\bperl\b|\bruby\b|\bchmod\b|\bln\b)/;

// `adlc` may appear as a bare command or as a quoted path ending in bin/adlc, e.g. node "/x/bin/adlc" claim.
const ADLC = String.raw`\badlc['"]?\s+`;
const USER_ONLY = new RegExp(`${ADLC}(approve|skip|unblock)\\b`);
const ADLC_SUBCOMMAND = new RegExp(`${ADLC}([a-z-]+)`, 'g');
const WORKER_CLAIM = new RegExp(`${ADLC}worker\\s+claim\\s+['"]?(T\\d+)['"]?\\s+--lease\\s+['"]?(L-[0-9a-f]+)`);

// Files a shell command writes: redirect and tee targets, plus a marker for in-place or copying tools.
function shellWriteTargets(cmd) {
  const out = [];
  for (const m of cmd.matchAll(/(?<![<0-9&>])>>?\s*(['"]?)([^\s'";&|()]+)\1/g)) if (!m[2].startsWith('&')) out.push(m[2]);
  for (const m of cmd.matchAll(/\btee\s+(?:-a\s+)?(['"]?)([^\s'";&|()]+)\1/g)) out.push(m[2]);
  if (/\bsed\s+(-[a-zA-Z]*\s+)*-i/.test(cmd) || /(^|[\s;&|(])(cp|mv|install|dd|truncate|touch)\s/.test(cmd)) out.push('<cp/mv/sed -i/dd/truncate/touch>');
  return out;
}
const SHELL_WRITE_OK = (target) => target === '/dev/null' || target === '/dev/stdout' || target === '/dev/stderr' || /(^|\/)\.agent-lifecycle\/tmp\//.test(target);

const TEST_FILE = /(^|\/)(tests?|__tests__|spec|specs)\/|[._-](test|spec)\.[a-z0-9]+$|_test\.(go|py)$|(^|\/)test_[^/]*\.py$/i;
const TEST_DISABLE = /(\b(it|test|describe)\.(skip|only)\s*\(|\bx(it|describe|test)\s*\(|@pytest\.mark\.skip|@unittest\.skip|\bt\.Skip\(|#\[ignore\]|\{\s*skip:\s*true)/;

const CHECK_BYPASS = [
  /--no-verify\b/,
  /\b(test|tests|pytest|jest|vitest|mocha|tsc|eslint|ruff|mypy|--test)\b[^;&|\n]*\|\|\s*(true\b|:|exit\s+0\b)/,
];

// standard: the actions the safety rules always require approval for. strict adds other history-changing git commands.
const RISKY = [
  { kind: 'git commit/push/tag', standard: true, re: /\bgit\s+(commit|push|tag)\b/ },
  { kind: 'destructive git command', standard: true, re: /\bgit\s+(reset\s+--hard|clean\b|checkout\s+--\s|restore\b|stash\s+(drop|clear)|branch\s+-D)/ },
  { kind: 'git history or worktree change', standard: false, re: /\bgit\s+(merge|rebase|cherry-pick|am|revert|stash|worktree\s+(add|remove|prune)|branch\s+-d)\b/ },
  { kind: 'GitHub CLI action (pull requests, releases, API)', standard: true, re: /\bgh\s+(pr|release|repo|api|workflow|issue)\b/ },
  { kind: 'dependency installation', standard: true, re: /\b(npm|pnpm|yarn|bun)\s+(i|install|add|ci|update|upgrade)\b|\bnpx\s|\bpip3?\s+install\b|\buv\s+(add|sync|pip\s+install)\b|\bpoetry\s+(add|install)\b|\bcargo\s+(add|install)\b|\bgo\s+(get|install)\b|\bbrew\s+install\b|\bgem\s+install\b|\bapt(-get)?\s+install\b/ },
  { kind: 'network or external service access', standard: true, re: /\b(curl|wget|ssh|scp|rsync|telnet|ftp)\b|\bnc\s/ },
  { kind: 'destructive delete', standard: true, re: /\brm\s+-[a-zA-Z]*[rRf]/ },
  { kind: 'publishing', standard: true, re: /\b(npm|pnpm|yarn)\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b|\bgem\s+push\b/ },
  { kind: 'deployment', standard: true, re: /\bdocker\s+(push|login)\b|\bkubectl\s+(apply|delete|rollout|scale|patch)\b|\bterraform\s+(apply|destroy)\b|\bhelm\s+(install|upgrade|uninstall)\b|\b(npm|pnpm|yarn)\s+run\s+deploy\b|(^|[\s;&|/])deploy(\.sh)?(\s|$)/ },
];

function riskyKind(cmd, level = 'strict') {
  for (const r of RISKY) if ((level === 'strict' || r.standard) && r.re.test(cmd)) return r.kind;
  return null;
}

module.exports = { PROTECTED_PATH, PROTECTED_IN_CMD, MANAGED_NAME_IN_CMD, WRITE_OPS, USER_ONLY, ADLC_SUBCOMMAND, WORKER_CLAIM, shellWriteTargets, SHELL_WRITE_OK, TEST_FILE, TEST_DISABLE, CHECK_BYPASS, RISKY, riskyKind };
