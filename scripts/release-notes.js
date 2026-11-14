#!/usr/bin/env node
'use strict';
// Prints the plugin version, or the CHANGELOG.md section for it. Used by .github/workflows/release.yml.
//   node scripts/release-notes.js version   -> 0.5.1 (fails if plugin.json and package.json disagree)
//   node scripts/release-notes.js notes     -> the "## 0.5.1 — <date>" section body
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function version() {
  const plugin = JSON.parse(read('plugins/adlc/.claude-plugin/plugin.json')).version;
  const pkg = JSON.parse(read('package.json')).version;
  if (plugin !== pkg) throw new Error(`plugin.json is ${plugin} but package.json is ${pkg}`);
  return plugin;
}

function notes(v) {
  const lines = read('CHANGELOG.md').split('\n');
  const start = lines.findIndex((l) => new RegExp(`^## ${v.replace(/\./g, '\\.')}(\\s|$)`).test(l));
  if (start === -1) throw new Error(`CHANGELOG.md has no "## ${v}" section`);
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  const body = lines.slice(start + 1, end === -1 ? lines.length : end).join('\n').trim();
  if (!body) throw new Error(`CHANGELOG.md section ${v} is empty`);
  return body;
}

if (require.main === module) {
  try {
    const v = version();
    process.stdout.write(`${process.argv[2] === 'notes' ? notes(v) : v}\n`);
  } catch (err) {
    process.stderr.write(`release-notes: ${err.message}\n`);
    process.exit(1);
  }
}
module.exports = { version, notes };
