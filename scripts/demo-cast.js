#!/usr/bin/env node
'use strict';
// Makes the README demo: runs examples/slugify/run.sh (real adlc CLI and hooks, model work replaced by fixed
// content) and writes an asciicast v2 file that shows each step as the slash command a user types, followed by
// the real CLI output. Render it with: npx svg-term-cli --in demo.cast --out docs/media/demo.svg --window
//
// Usage: node scripts/demo-cast.js <out.cast>
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// run.sh step number -> what the user types for it (null: shown without a prompt).
const PROMPTS = {
  1: '/adlc:start "Add slugify utility" --small',
  2: '/adlc:plan',
  4: '/adlc:approve plan',
  5: '/adlc:next            # build',
  7: '/adlc:next            # verify',
  8: '/adlc:next            # review',
  9: '/adlc:release   →   /adlc:approve release   →   /adlc:release',
  10: '/adlc:status',
};
const SKIP = new Set([0]); // repository setup is not part of the demo

const WIDTH = 100;
const HEIGHT = 30;
const TYPE_MS = 0.05;
const LINE_MS = 0.15;
const PAUSE = 3;

function steps(output) {
  const out = [];
  let cur = null;
  for (const line of output.split('\n')) {
    const m = /^== (\d+)\. (.*)$/.exec(line);
    if (m) {
      cur = { n: Number(m[1]), title: m[2], lines: [] };
      out.push(cur);
    } else if (cur && line.trim()) {
      cur.lines.push(line.length > WIDTH - 2 ? `${line.slice(0, WIDTH - 3)}…` : line);
    }
  }
  return out;
}

function main() {
  const outFile = process.argv[2];
  if (!outFile) {
    process.stderr.write('usage: node scripts/demo-cast.js <out.cast>\n');
    process.exit(1);
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'adlc-demo-'));
  const r = spawnSync(path.join(__dirname, '..', 'examples', 'slugify', 'run.sh'), [work], { encoding: 'utf8' });
  if (r.status !== 0) {
    process.stderr.write(r.stdout + r.stderr);
    process.exit(1);
  }
  const events = [];
  let t = 0.5;
  const emit = (text) => events.push([Number(t.toFixed(3)), 'o', text]);
  emit('\x1b[2m# Scripted demo: real adlc CLI and hooks; the model\'s work is replaced by fixed content.\x1b[0m\r\n');
  t += PAUSE;
  const all = steps(r.stdout);
  for (const s of all) {
    if (SKIP.has(s.n)) continue;
    const prompt = PROMPTS[s.n];
    if (prompt) {
      emit('\r\n\x1b[1;32m>\x1b[0m ');
      for (const ch of prompt) {
        t += TYPE_MS;
        emit(ch);
      }
      t += 0.4;
      emit('\r\n');
    }
    emit(`\x1b[2m  ${s.title}\x1b[0m\r\n`);
    for (const line of s.lines.slice(0, 12)) {
      t += LINE_MS;
      emit(`  ${line}\r\n`);
    }
    t += PAUSE;
  }
  const header = { version: 2, width: WIDTH, height: HEIGHT, title: 'adlc demo' };
  fs.writeFileSync(outFile, [JSON.stringify(header), ...events.map((e) => JSON.stringify(e))].join('\n') + '\n');
  fs.rmSync(work, { recursive: true, force: true });
  process.stdout.write(`wrote ${outFile} (${events.length} events, ${t.toFixed(1)} s)\n`);
}

main();
