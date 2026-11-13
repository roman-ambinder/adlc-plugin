'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { slugify } = require('../src/slugify');

test('AC-1: lowercases and joins words with single hyphens', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
  assert.equal(slugify('Many   spaces here'), 'many-spaces-here');
});

test('AC-2: removes other characters and trims hyphens', () => {
  assert.equal(slugify('  ¡Hola, Mundo! 2026 '), 'hola-mundo-2026');
  assert.equal(slugify('--a--'), 'a');
});

test('AC-3: rejects non-string input', () => {
  assert.throws(() => slugify(42), TypeError);
});
