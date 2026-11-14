---
description: Run the adlc Verify stage - the repository's tests, formatting, linting, type checks and security checks - and record evidence. Use after build completes or when the user asks to verify.
---

Read `${CLAUDE_PLUGIN_ROOT}/skills/coordinator/SKILL.md` first and follow it.

Runtime values for this session (substituted by Claude Code when this skill loads; the coordinator rules refer to them):
- CLI fallback if `adlc` is not on PATH: `node "${CLAUDE_PLUGIN_ROOT}/bin/adlc"`
- Session id for `adlc dispatch start --session`: `${CLAUDE_SESSION_ID}`

1. `adlc stage start verify` (build must be completed).
2. Find the checks the repository already defines: the full test suite, format check (check mode only, never auto-fix here), lint, type check, and security checks that run locally. Look at package.json scripts, Makefile, pyproject.toml, tox.ini, CI workflows. Do not install tools; installing needs the user's approval.
3. Run each one: `adlc run --stage verify -- "<command>"`. Also run every task check from the approved plan the same way, with the exact command text (`adlc next --json` lists the ones still missing under `complete_problems`); the stage cannot complete without them. Exit code 5 means the command failed and the evidence was recorded.
4. If any check fails, do not complete the stage. Find the responsible task and run `adlc task repair <T> "<failure and evidence file>"` (this reopens build). Report and stop.
5. If all pass: `adlc stage complete verify`. Report each check with its evidence file. List checks the repository does not have as "not available", never as passed.
