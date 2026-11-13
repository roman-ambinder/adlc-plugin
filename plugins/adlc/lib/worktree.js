'use strict';
// Git worktree helpers for worktree mode. Only reads repository state; never commits, merges or removes.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const WORKTREES_DIR = '.claude/worktrees';

function real(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

// If dir is inside a linked worktree, returns { worktreeRoot, mainRoot }. Pure filesystem reads, no git process.
function linkedWorktree(dir) {
  let cur = real(path.resolve(dir));
  for (;;) {
    const dotgit = path.join(cur, '.git');
    let st = null;
    try {
      st = fs.statSync(dotgit);
    } catch {
      // keep walking
    }
    if (st && st.isDirectory()) return null;
    if (st && st.isFile()) {
      const m = /^gitdir:\s*(.+)\s*$/m.exec(fs.readFileSync(dotgit, 'utf8'));
      if (!m) return null;
      const gitdir = path.resolve(cur, m[1].trim());
      let common;
      try {
        common = path.resolve(gitdir, fs.readFileSync(path.join(gitdir, 'commondir'), 'utf8').trim());
      } catch {
        return null; // a submodule, not a linked worktree
      }
      if (path.basename(common) !== '.git') return null;
      return { worktreeRoot: cur, mainRoot: real(path.dirname(common)) };
    }
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

function mainRootFor(dir) {
  const linked = linkedWorktree(dir);
  return linked ? linked.mainRoot : dir;
}

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

function isRepo(root) {
  return git(root, ['rev-parse', '--is-inside-work-tree']).out === 'true' && git(root, ['rev-parse', '--verify', 'HEAD']).ok;
}

// Paths with uncommitted changes (including untracked files), excluding .agent-lifecycle/.
function dirtyPaths(cwd) {
  // Raw stdout: porcelain lines start with a status column that may be a space, so never trim.
  const r = spawnSync('git', ['status', '--porcelain', '-uall'], { cwd, encoding: 'utf8' });
  if (r.status !== 0) return null;
  return r.stdout.split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, '').split(' -> ').pop()).filter((f) => !f.startsWith('.agent-lifecycle/'));
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// worktree.baseRef "head" makes subagent worktrees branch from local HEAD (docs: /worktrees "Choose the base branch").
function baseRefIsHead(root) {
  const files = [path.join(root, '.claude', 'settings.local.json'), path.join(root, '.claude', 'settings.json'), path.join(os.homedir(), '.claude', 'settings.json')];
  for (const f of files) {
    const s = readJson(f);
    if (s && s.worktree && s.worktree.baseRef !== undefined) return { ok: s.worktree.baseRef === 'head', file: f, value: s.worktree.baseRef };
  }
  return { ok: false, file: null, value: 'fresh (default)' };
}

function worktreesIgnored(root) {
  return git(root, ['check-ignore', '-q', `${WORKTREES_DIR}/probe`]).ok;
}

// Reasons worktree mode cannot be used right now (empty = usable).
function worktreeProblems(root) {
  const p = [];
  if (!isRepo(root)) return ['not a git repository with at least one commit'];
  const base = baseRefIsHead(root);
  if (!base.ok) p.push(`worktree.baseRef is ${JSON.stringify(base.value)}${base.file ? ` in ${base.file}` : ''}; set "worktree": {"baseRef": "head"} in .claude/settings.json so worker worktrees start from your current commit`);
  if (!worktreesIgnored(root)) p.push(`${WORKTREES_DIR}/ is not git-ignored; add it to .gitignore`);
  const dirty = dirtyPaths(root);
  if (dirty && dirty.length) p.push(`uncommitted changes outside .agent-lifecycle/ would be invisible to worktree workers: ${dirty.slice(0, 5).join(', ')}${dirty.length > 5 ? ', …' : ''}`);
  return p;
}

function branchOf(worktree) {
  const r = git(worktree, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return r.ok && r.out !== 'HEAD' ? r.out : null;
}

function isAncestor(root, ref) {
  return git(root, ['merge-base', '--is-ancestor', ref, 'HEAD']).ok;
}

module.exports = { WORKTREES_DIR, linkedWorktree, mainRootFor, git, isRepo, dirtyPaths, baseRefIsHead, worktreesIgnored, worktreeProblems, branchOf, isAncestor };
