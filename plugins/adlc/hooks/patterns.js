'use strict';

// Everything under .agent-lifecycle/ is written only by the adlc CLI or hooks, except the four documents people and
// agents edit and the tmp/ scratch area. Evidence, handoffs, packets, reviews and traceability are therefore not forgeable
// with the file tools. Case-insensitive, because macOS and Windows file systems usually are.
const PROTECTED_PATH = /^\.agent-lifecycle(\/(?!(requirements|plan|decisions|release)\.md$|tmp\/)|$)/i;
const PROTECTED_IN_CMD = /\.agent-lifecycle\/(state\.json|approvals\.jsonl|runs\/)/;
// Bare names (e.g. after `cd .agent-lifecycle`): may be another project file, so these only ask.
const MANAGED_NAME_IN_CMD = /(^|[\s/'"])(state\.json|approvals\.jsonl|bindings\.json|stops\.jsonl|writes\.jsonl|audit\.jsonl)\b|(^|[\s'"])runs\//;
const WRITE_OPS = /(>|\btee\b|\bsed\s+-i|\brm\b|\bmv\b|\bcp\b|\btruncate\b|\bdd\b|\bpython3?\b|\bnode\b|\bperl\b|\bruby\b|\bchmod\b|\bln\b)/;

// CLI-written records (evidence, handoffs, packets, reviews, ...) named in a shell command.
const CLI_OWNED = /\.agent-lifecycle\/((test-results|handoffs|packets|reviews|archive)\/|(traceability|handoff)\.md)/i;
const MUTATING = /(^|[\s;&|(])(tee|rm|mv|cp|truncate|dd|chmod|ln|touch|install)\s|\bsed\s+(-[a-zA-Z]*\s+)*-i/;
// The lifecycle directory itself: removing, renaming or replacing it switches every hook off.
const LIFECYCLE_DIR = /(^|[\s'"=\/])\.agent-lifecycle\/?(?=$|[\s'";&|)])/i;
const DIR_MUTATING = /(^|[\s;&|(])(rm|mv|rmdir|ln|chmod)\s/;

function writesCliOwned(cmd) {
  if (shellWriteTargets(cmd).some((t) => CLI_OWNED.test(t))) return true;
  return CLI_OWNED.test(cmd) && MUTATING.test(cmd);
}
const removesLifecycleDir = (cmd) => LIFECYCLE_DIR.test(cmd) && DIR_MUTATING.test(cmd);

// `adlc` may appear as a bare command or as a quoted path ending in bin/adlc, e.g. node "/x/bin/adlc" claim.
// The subcommand may be quoted too (adlc "approve" plan).
const ADLC = String.raw`\badlc['"]?\s+['"]?`;
// User-only commands are matched only where adlc is the command being run (start of the command, after ; & | ( $(,
// after env/exec/xargs-style wrappers or inside sh -c "..."), so `grep "adlc approve" docs/` is not denied. Missing an
// unusual form is safe: the CLI itself refuses these actions without the user's intent; the guard only explains early.
const CMD_POS = String.raw`(?:^|[;&|(\n]|\$\(|\b(?:exec|command|env|sudo|xargs|time|nohup|timeout\s+\S+)\s|\b(?:ba|z|da)?sh\s+-c\s+['"])\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:node\s+)?(?:['"]?[^\s'";&|()]*\/)?`;
const USER_ONLY = new RegExp(`${CMD_POS}${ADLC}(approve|skip|unblock|archive|cancel)\\b`);
// Same as USER_ONLY, capturing the action and its first argument (gate or stage).
const USER_ONLY_ARG = new RegExp(`${CMD_POS}${ADLC}(approve|skip|unblock|archive|cancel)\\b['"]?\\s*['"]?([^\\s'"]*)`);
const ADLC_SUBCOMMAND = new RegExp(`${ADLC}([a-z-]+)`, 'g');
const WORKER_CLAIM = new RegExp(`${ADLC}worker\\s+claim\\s+['"]?(T\\d+)['"]?\\s+--lease\\s+['"]?(L-[0-9a-f]+)`);

// Secret-bearing files (the settings template denies the same set for the Read tool).
const SECRET_FILE = /(^|\/)(\.env(\.(?!example\b|sample\b|template\b|dist\b)[\w.-]+)?|\.envrc|\.npmrc|\.netrc|\.pypirc|\.aws\/credentials|[^\/\s'"]+\.(pem|key|p12|pfx)|id_(rsa|dsa|ecdsa|ed25519)[\w.-]*)$/;
const SECRET_IN_CMD = /(^|[\s'"=<\/])(\.env(\.(?!example\b|sample\b|template\b|dist\b)[\w.-]+)?|\.envrc|\.npmrc|\.netrc|\.pypirc|\.aws\/credentials|[^\s'"\/]+\.(pem|key|p12|pfx)|id_(rsa|dsa|ecdsa|ed25519)[\w.-]*)(?=$|[\s'";&|)])/;
// A Grep glob such as ".env*" or "*.pem" that selects secret files.
const secretGlob = (glob) => [String(glob).replace(/[*?]/g, ''), String(glob).replace(/\*+|\?/g, 'x')].some((g) => SECRET_FILE.test(g));
const READ_VERBS = /(^|[\s;&|(])(cat|less|more|head|tail|grep|egrep|rg|ag|sed|awk|cp|source|\.|xxd|od|strings|base64|bat|nl|tac|sort|diff|cut|tr|openssl)\s/;

// Inline interpreter code (`python -c`, `node -e`, ...) can write any file without a visible target.
const INLINE_CODE = /(^|[\s;&|(])(python[0-9.]*|node|nodejs|deno|bun|perl|ruby|php)\s+(-[A-Za-z]*\s+)*(-c|-e|-E|--eval|-p|--print)(\s|=|['"])/;

// Files a shell command writes: redirect and tee targets, plus a marker for in-place or copying tools.
function shellWriteTargets(cmd) {
  const out = [];
  for (const m of cmd.matchAll(/(?<![<0-9&>])>>?\s*(['"]?)([^\s'";&|()]+)\1/g)) if (!m[2].startsWith('&')) out.push(m[2]);
  for (const m of cmd.matchAll(/\btee\s+(?:-a\s+)?(['"]?)([^\s'";&|()]+)\1/g)) out.push(m[2]);
  if (INLINE_CODE.test(cmd)) out.push('<inline interpreter code>');
  if (/\bsed\s+(-[a-zA-Z]*\s+)*-i/.test(cmd) || /(^|[\s;&|(])(cp|mv|install|dd|truncate|touch)\s/.test(cmd)) out.push('<cp/mv/sed -i/dd/truncate/touch>');
  return out;
}
const SHELL_WRITE_OK = (target) => target === '/dev/null' || target === '/dev/stdout' || target === '/dev/stderr' || /(^|\/)\.agent-lifecycle\/tmp\//.test(target);

const TEST_FILE = /(^|\/)(tests?|__tests__|spec|specs)\/|[._-](test|spec)\.[a-z0-9]+$|_test\.(go|py)$|(^|\/)test_[^/]*\.py$/i;
const TEST_DISABLE = /(\b(it|test|describe)\.(skip|only|todo)\s*\(|\bx(it|describe|test)\s*\(|@pytest\.mark\.(skip|xfail)|@unittest\.skip|\bpytest\.skip\(|\bt\.Skip\(|\bt\.skip\(|#\[ignore\]|@Disabled\b|@Ignore\b|\{\s*(skip|todo):\s*true)/;
// Test-case declarations, counted to notice an edit that deletes tests.
const TEST_DECL = /(\b(it|test)(\.\w+)?\s*\(|\bdef test_\w+|\bfunc Test\w+|@Test\b|#\[test\])/g;
const countTests = (text) => (String(text || '').match(TEST_DECL) || []).length;

const { masksExitStatus } = require('../lib/masking');

const CHECK_WORDS = String.raw`\b(test|tests|pytest|jest|vitest|mocha|tsc|eslint|ruff|mypy|lint|check|build|verify|make|cargo|phpunit|rspec|gradle|mvn|--test)\b`;
// Commands whose failure is routinely ignored and that are never checks, even with a check word as an argument
// (`mkdir -p build || true`, `rm -rf coverage; true`).
const NOT_CHECKS = new Set(['mkdir', 'rm', 'rmdir', 'cp', 'mv', 'ln', 'touch', 'cd', 'pushd', 'popd', 'echo', 'printf', 'cat', 'ls', 'grep', 'rg', 'kill', 'pkill', 'killall', 'which', 'type', 'command', 'chmod', 'chown', 'docker', 'git', 'diff', 'find', 'wait', 'sleep', 'unset', 'export']);

// True when a failing check's status is masked: `npm test || true`, `pytest; exit 0`, or `set +e` before a check.
function masksCheck(cmd) {
  const s = String(cmd);
  if (!masksExitStatus(s)) return false;
  if (/(^|[\s;&|(])set\s+\+e\b/.test(s)) return new RegExp(CHECK_WORDS).test(s);
  const ops = [/\|\|\s*(true\b|:(\s|$|[;&|)])|exit\s+0\b|echo\b|printf\b)/g, /;\s*(true|:|exit\s+0)\s*($|[;&|)\n'"])/g];
  for (const re of ops) {
    for (const m of s.matchAll(re)) {
      const segment = s.slice(0, m.index).split(/&&|\|\||[;|\n]/).pop().trim();
      const words = segment.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*/, '').split(/\s+/);
      if (NOT_CHECKS.has(words[0])) continue;
      if (new RegExp(CHECK_WORDS).test(segment)) return true;
    }
  }
  return false;
}

const CHECK_BYPASS = [
  /--no-verify\b/,
  // masking after a known check command, or anywhere in a command handed to `adlc run` (which would record a false exit 0)
  { test: masksCheck },
  { test: (cmd) => /\badlc['"]?\s+run\b/.test(cmd) && masksExitStatus(cmd) },
];

// `git` followed by global options such as -C <dir>, -c k=v or --git-dir=..., then the subcommand.
const GIT = String.raw`\bgit(?:\s+(?:-C\s+(?:'[^']*'|"[^"]*"|\S+)|-c\s+\S+|--[a-z-]+(?:=\S+)?))*\s+`;
const git = (rest) => new RegExp(GIT + rest);

// standard: the actions the safety rules always require approval for. strict adds other history-changing git commands.
const RISKY = [
  { kind: 'git commit/push/tag', standard: true, re: git(String.raw`(commit|push|tag)\b`) },
  { kind: 'destructive git command', standard: true, re: git(String.raw`(reset\s+--hard|clean\b|checkout\s+--\s|restore\b|stash\s+(drop|clear)|branch\s+-D)`) },
  { kind: 'git history or worktree change', standard: false, re: git(String.raw`(merge|rebase|cherry-pick|am|revert|stash|worktree\s+(add|remove|prune)|branch\s+-d)\b`) },
  { kind: 'GitHub CLI action (pull requests, releases, API)', standard: true, re: /\bgh\s+(pr|release|repo|api|workflow|issue)\b/ },
  { kind: 'dependency installation', standard: true, re: /\b(npm|pnpm|yarn|bun)\s+(i|install|add|ci|update|upgrade)\b|\bnpx\s|\bpip3?\s+install\b|\buv\s+(add|sync|pip\s+install)\b|\bpoetry\s+(add|install)\b|\bcargo\s+(add|install)\b|\bgo\s+(get|install)\b|\bbrew\s+install\b|\bgem\s+install\b|\bapt(-get)?\s+install\b/ },
  { kind: 'package runner (downloads and runs code)', standard: true, re: /\b(npm\s+exec|pnpm\s+(dlx|exec)|yarn\s+dlx|bunx|pipx\s+run|uvx)\b/ },
  { kind: 'container execution', standard: false, re: /\bdocker\s+(run|exec|compose\s+(up|run))\b/ },
  { kind: 'network or external service access', standard: true, re: /\b(curl|wget|ssh|scp|rsync|telnet|ftp)\b|\bnc\s/ },
  { kind: 'destructive delete', standard: true, re: /\brm\s+-[a-zA-Z]*[rRf]|\bfind\b[^;&|\n]*(-delete\b|-exec\s+rm\b)/ },
  { kind: 'publishing', standard: true, re: /\b(npm|pnpm|yarn)\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b|\bgem\s+push\b/ },
  { kind: 'deployment', standard: true, re: /\bdocker\s+(push|login)\b|\bkubectl\s+(apply|delete|rollout|scale|patch)\b|\bterraform\s+(apply|destroy)\b|\bhelm\s+(install|upgrade|uninstall)\b|\b(npm|pnpm|yarn)\s+run\s+deploy\b|(^|[\s;&|/])deploy(\.sh)?(\s|$)/ },
];

function riskyKind(cmd, level = 'strict') {
  for (const r of RISKY) if ((level === 'strict' || r.standard) && r.re.test(cmd)) return r.kind;
  return null;
}

module.exports = { masksCheck, secretGlob, writesCliOwned, removesLifecycleDir, USER_ONLY_ARG, countTests, SECRET_FILE, SECRET_IN_CMD, READ_VERBS, INLINE_CODE, PROTECTED_PATH, PROTECTED_IN_CMD, MANAGED_NAME_IN_CMD, WRITE_OPS, USER_ONLY, ADLC_SUBCOMMAND, WORKER_CLAIM, shellWriteTargets, SHELL_WRITE_OK, TEST_FILE, TEST_DISABLE, CHECK_BYPASS, RISKY, riskyKind };
