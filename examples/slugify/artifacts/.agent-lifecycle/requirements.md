# Requirements

## Problem

Page titles need URL-safe identifiers; the project has no helper for this.

## Users

Developers building URLs from user-provided titles.

## Constraints

No new dependencies. Node 18+.

## Success criteria

Titles convert to stable, readable slugs.

## Acceptance criteria

- AC-1: slugify lowercases text and joins words with single hyphens; verified by node --test test/slugify.test.js
- AC-2: slugify removes characters other than a-z, 0-9 and hyphens, and trims leading and trailing hyphens; verified by node --test test/slugify.test.js
- AC-3: slugify throws a TypeError for non-string input; verified by node --test test/slugify.test.js
