'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { version, notes } = require('../scripts/release-notes');

test('release: versions agree and the changelog has a section for the current version', () => {
  const v = version();
  assert.match(v, /^\d+\.\d+\.\d+$/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8'), new RegExp(`Version ${v.replace(/\./g, '\\.')}\\.`));
  const body = notes(v);
  assert.ok(body.length > 20);
  assert.doesNotMatch(body, /^## /m, 'only this version\'s section');
});
