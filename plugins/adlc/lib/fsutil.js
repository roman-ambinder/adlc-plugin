'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { AdlcError, EXIT } = require('./errors');

const STALE_MS = 10 * 60 * 1000;

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function atomicWrite(file, data, tmpDir) {
  const dir = tmpDir || path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(dir, `${path.basename(file)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

function appendLine(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let line = `${typeof value === 'string' ? value : JSON.stringify(value)}\n`;
  if (fs.existsSync(file)) {
    const size = fs.statSync(file).size;
    if (size > 0) {
      const last = Buffer.alloc(1);
      const rfd = fs.openSync(file, 'r');
      try { fs.readSync(rfd, last, 0, 1, size - 1); } finally { fs.closeSync(rfd); }
      if (last[0] !== 0x0a) line = `\n${line}`; // previous write was torn: start a fresh line
    }
  }
  const fd = fs.openSync(file, 'a');
  try {
    fs.writeSync(fd, line);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function readJsonLines(file) {
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // torn line from an interrupted write: ignore it
    }
  }
  return out;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireLock(lockPath, { waitMs = 0, staleMs = STALE_MS } = {}) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, ts: new Date().toISOString() }));
      fs.closeSync(fd);
      return () => {
        try { fs.unlinkSync(lockPath); } catch { /* already removed */ }
      };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let age;
      try {
        age = Date.now() - fs.statSync(lockPath).mtimeMs;
      } catch {
        continue; // released between open and stat
      }
      if (age > staleMs) {
        try { fs.unlinkSync(lockPath); } catch { /* another process reclaimed it */ }
        continue;
      }
      if (Date.now() >= deadline) {
        throw new AdlcError(EXIT.CONFLICT, `${path.basename(lockPath)} is held by another adlc process; retry shortly`);
      }
      sleep(50);
    }
  }
}

function withLock(lockPath, fn, opts) {
  const release = acquireLock(lockPath, opts);
  try {
    return fn();
  } finally {
    release();
  }
}

function replaceSection(text, key, content) {
  const begin = `<!-- adlc:begin ${key} -->`;
  const end = `<!-- adlc:end ${key} -->`;
  const block = `${begin}\n${String(content).replace(/\n+$/, '')}\n${end}`;
  const i = text.indexOf(begin);
  const j = text.indexOf(end);
  if (i !== -1 && j > i) return text.slice(0, i) + block + text.slice(j + end.length);
  return `${text ? text.replace(/\n*$/, '\n\n') : ''}${block}\n`;
}

module.exports = { sha256, atomicWrite, appendLine, readJsonLines, readJson, acquireLock, withLock, replaceSection, STALE_MS };
