'use strict';

function slugify(text) {
  if (typeof text !== 'string') throw new TypeError('slugify expects a string');
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = { slugify };
