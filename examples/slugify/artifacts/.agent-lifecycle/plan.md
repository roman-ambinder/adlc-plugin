# Plan

## Context

_Repository inspection notes: language, conventions, test/lint/format/type-check commands found._

## Affected files

_Files and modules this change touches, and why._

## Risks

_What could go wrong and how the plan reduces it._

<!-- adlc:begin tasks -->
## Tasks
- **T1** Implement slugify with tests — files: src/slugify.js, test/slugify.test.js; deps: none; contracts: none; AC: AC-1, AC-2, AC-3; checks: `node --test test/slugify.test.js`; size S
<!-- adlc:end tasks -->

<!-- adlc:begin execution -->
## Execution plan
- mode: sequential (requested: auto, max parallel: 2)
- reason: auto requested; fewer than two tasks, so sequential
- wave 1: T1
- integration order: T1
<!-- adlc:end execution -->
