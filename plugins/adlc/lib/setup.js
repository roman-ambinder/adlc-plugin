'use strict';
// `adlc setup`: merges the recommended settings (settings-template.json) into the project's .claude/settings.json
// and adds .claude/worktrees/ to .gitignore. It only adds: existing entries and keys are never changed or removed,
// and a template entry the user already has in a different permission list is skipped and reported.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { atomicWrite } = require('./fsutil');
const { rule } = require('./errors');

const LISTS = ['allow', 'ask', 'deny'];
const SETTINGS = path.join('.claude', 'settings.json');
const WORKTREES = '.claude/worktrees/';

function projectRoot(cwd, env = process.env) {
  if (env.ADLC_ROOT) return path.resolve(env.ADLC_ROOT);
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : cwd;
}

function loadTemplate() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'settings-template.json'), 'utf8'));
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function readSettings(root) {
  const file = path.join(root, SETTINGS);
  if (!fs.existsSync(file)) return { settings: {}, existed: false };
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw rule(`.claude/settings.json is not valid JSON (${err.message}); fix it, then run adlc setup again. Nothing was changed`);
  }
  if (!isObject(settings)) throw rule('.claude/settings.json must be a JSON object; nothing was changed');
  if (settings.permissions !== undefined && !isObject(settings.permissions)) throw rule('.claude/settings.json: permissions must be an object; nothing was changed');
  for (const list of LISTS) {
    const v = settings.permissions && settings.permissions[list];
    if (v !== undefined && !Array.isArray(v)) throw rule(`.claude/settings.json: permissions.${list} must be a list; nothing was changed`);
  }
  if (settings.worktree !== undefined && !isObject(settings.worktree)) throw rule('.claude/settings.json: worktree must be an object; nothing was changed');
  return { settings, existed: true };
}

const ignoreKey = (line) => line.replace(/\r$/, '').trim().replace(/^\//, '').replace(/\/$/, '');

function planSetup(root, template) {
  const { settings: current, existed } = readSettings(root);
  const settings = JSON.parse(JSON.stringify(current));
  const added = [];
  const skipped = [];
  const notes = [];
  const tplPerms = template.permissions || {};
  for (const list of LISTS) {
    for (const entry of tplPerms[list] || []) {
      const perms = settings.permissions || {};
      if ((perms[list] || []).includes(entry)) continue;
      const other = LISTS.find((l) => l !== list && (perms[l] || []).includes(entry));
      if (other) {
        skipped.push({ entry, templateList: list, userList: other });
        continue;
      }
      settings.permissions = perms;
      settings.permissions[list] = [...(perms[list] || []), entry];
      added.push({ list, entry });
    }
  }
  const want = template.worktree && template.worktree.baseRef;
  let baseRefAdded = false;
  if (want) {
    const have = settings.worktree && settings.worktree.baseRef;
    if (have === undefined) {
      settings.worktree = { ...(settings.worktree || {}), baseRef: want };
      baseRefAdded = true;
    } else if (have !== want) {
      notes.push(`worktree.baseRef is "${have}"; worktree builds need "${want}" (left as is)`);
    }
  }
  const ignoreFile = path.join(root, '.gitignore');
  const ignoreText = fs.existsSync(ignoreFile) ? fs.readFileSync(ignoreFile, 'utf8') : '';
  const hasEntry = ignoreText.split('\n').some((l) => ignoreKey(l) === ignoreKey(WORKTREES));
  const gitignore = hasEntry
    ? { text: ignoreText, changed: false }
    : { text: `${ignoreText}${ignoreText && !ignoreText.endsWith('\n') ? '\n' : ''}${WORKTREES}\n`, changed: true };
  return { settings, settingsChanged: added.length > 0 || baseRefAdded, settingsExisted: existed, added, baseRefAdded, skipped, notes, gitignore };
}

function applySetup(root, plan) {
  if (plan.settingsChanged) atomicWrite(path.join(root, SETTINGS), `${JSON.stringify(plan.settings, null, 2)}\n`);
  if (plan.gitignore.changed) atomicWrite(path.join(root, '.gitignore'), plan.gitignore.text);
}

function isSetUp(root, template) {
  try {
    const p = planSetup(root, template);
    return !p.settingsChanged && !p.gitignore.changed;
  } catch {
    return false;
  }
}

function formatPlan(plan, { dryRun }) {
  const verb = dryRun ? 'would add to' : 'added to';
  const lines = [];
  for (const a of plan.added) lines.push(`${verb} .claude/settings.json: permissions.${a.list} ${a.entry}`);
  if (plan.baseRefAdded) lines.push(`${verb} .claude/settings.json: worktree.baseRef ${plan.settings.worktree.baseRef}`);
  if (plan.gitignore.changed) lines.push(`${verb} .gitignore: ${WORKTREES}`);
  for (const s of plan.skipped) lines.push(`skipped ${s.entry}: you have it under ${s.userList} (the template puts it under ${s.templateList}); left as you set it`);
  for (const n of plan.notes) lines.push(`note: ${n}`);
  if (!plan.settingsChanged && !plan.gitignore.changed) lines.unshift('already set up: nothing to change');
  return lines.join('\n');
}

module.exports = { projectRoot, loadTemplate, planSetup, applySetup, isSetUp, formatPlan };
