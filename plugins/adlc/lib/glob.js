'use strict';
const path = require('node:path');

function norm(p) {
  return String(p).trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

function isGlob(p) {
  return /[*?]/.test(p);
}

function staticPrefix(p) {
  const i = p.search(/[*?]/);
  return i === -1 ? p : p.slice(0, i);
}

function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i += 1;
        if (glob[i + 1] === '/') {
          i += 1;
          re += '(?:.*/)?';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

// pattern: literal path, directory prefix ending in "/", or glob. A glob without "/" matches basenames.
function matches(pattern, file) {
  const pat = norm(pattern);
  const f = norm(file);
  if (isGlob(pat)) return globToRegExp(pat).test(pat.includes('/') ? f : path.posix.basename(f));
  if (pat.endsWith('/')) return f.startsWith(pat);
  return f === pat;
}

function prefixRelated(p, q) {
  return p.startsWith(q) || q.startsWith(p);
}

// True when two writable-file entries could name the same file. Errs towards true.
function entriesOverlap(a, b) {
  const x = norm(a);
  const y = norm(b);
  const gx = isGlob(x);
  const gy = isGlob(y);
  if (!gx && !gy) return x === y || (x.endsWith('/') && y.startsWith(x)) || (y.endsWith('/') && x.startsWith(y));
  if (gx && !gy) return y.endsWith('/') ? prefixRelated(staticPrefix(x), y) : matches(x, y);
  if (!gx && gy) return entriesOverlap(y, x);
  return prefixRelated(staticPrefix(x), staticPrefix(y));
}

function setsOverlap(A, B) {
  return A.some((a) => B.some((b) => entriesOverlap(a, b)));
}

module.exports = { norm, isGlob, staticPrefix, globToRegExp, matches, entriesOverlap, setsOverlap };
