'use strict';
// A small JSON Schema validator for the subset used by schemas/*.json (no dependencies):
// type (incl. "integer", "null" and lists), const, enum, required, properties, additionalProperties (schema),
// propertyNames.enum, items, minItems, minLength, minimum, pattern.
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'schemas');
const cache = new Map();

function load(name) {
  if (!cache.has(name)) cache.set(name, JSON.parse(fs.readFileSync(path.join(DIR, `${name}.schema.json`), 'utf8')));
  return cache.get(name);
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
}

function typeMatches(v, t) {
  const actual = typeOf(v);
  return actual === t || (t === 'number' && actual === 'integer');
}

// Returns a list of problems, each prefixed with the JSON path ("tasks[0].status: ...").
function validate(schema, value, where = '', out = []) {
  const at = where || '(root)';
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatches(value, t))) {
      out.push(`${at}: must be ${types.join(' or ')} (got ${typeOf(value)})`);
      return out;
    }
  }
  if (schema.const !== undefined && value !== schema.const) out.push(`${at}: must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) out.push(`${at}: must be one of ${schema.enum.map((x) => JSON.stringify(x)).join(', ')} (got ${JSON.stringify(value)})`);
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) out.push(`${at}: must not be empty`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) out.push(`${at}: must match ${schema.pattern} (got ${JSON.stringify(value)})`);
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) out.push(`${at}: must be at least ${schema.minimum}`);
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) out.push(`${at}: needs at least ${schema.minItems} item(s)`);
    if (schema.items) value.forEach((x, i) => validate(schema.items, x, `${where}[${i}]`, out));
  }
  if (typeOf(value) === 'object') {
    for (const k of schema.required || []) if (!(k in value)) out.push(`${at}: missing "${k}"`);
    for (const [k, v] of Object.entries(value)) {
      const key = where ? `${where}.${k}` : k;
      if (schema.propertyNames && schema.propertyNames.enum && !schema.propertyNames.enum.includes(k)) out.push(`${key}: unknown key`);
      const sub = (schema.properties && schema.properties[k]) || (typeof schema.additionalProperties === 'object' ? schema.additionalProperties : null);
      if (sub) validate(sub, v, key, out);
    }
  }
  return out;
}

module.exports = { load, validate, check: (name, value) => validate(load(name), value) };
