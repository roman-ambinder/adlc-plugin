# Changelog

## 0.4.0 — 2026-11-13

Hardening from a review of the plugin, plus fixes from live runs.

### Changed (read before upgrading)
- **`adlc approve`, `adlc skip` and `adlc unblock` now require your own slash command.** A new `UserPromptSubmit` hook records `/adlc:approve`, `/adlc:skip` and `/adlc:unblock` that you type as a single-use intent (15-minute expiry); the CLI and guard refuse these actions without a matching one. A request in prose, or a command the model runs by itself, no longer works. A person running `adlc` at a terminal is accepted. Scripts that call these commands without a terminal must submit the prompt to the hook first (see `examples/slugify/run.sh`). Reload plugins or start a new session so the new hook is registered.
- The guard no longer asks before these commands; your slash command is the approval.
- `integrate check` now fails, instead of warning, on files outside every task's writable set that were modified after dispatch. Files written while an `adlc run` check was executing (coverage output, lockfile rewrites) only warn, are left out of the printed `git add`, and do not block `integrate done`.
- `adlc run` refuses commands that mask their own exit status (`|| true`, `; true`, `; exit 0`, `set +e`).

### Added
- Guard: denies masked checks (including inside `adlc run`), inline interpreter code for workers (`python -c`, `node -e`, …), reading `.env`, keys and certificates in Bash and the Read tool, and more skip forms (`.todo`, `@Disabled`, `xfail`, …). It asks before test cases are deleted, package runners (`npm exec`, `pnpm dlx`, `yarn dlx`, `bunx`, `uvx`), `find -delete`, and (strict) `docker run`.
- `adlc start` takes each setting from the flag, then `CLAUDE_PLUGIN_OPTION_<NAME>`, then the default, and ignores an unsubstituted `${user_config.*}` placeholder.
- Build packets include the text of each acceptance criterion.
- CI: `npm test` on Node 18, 20 and 22, plus manifest validation.

### Fixed
- The README claimed packet edits make a plan approval stale; packets are re-rendered at dispatch, and the README now says so.

### Verified live (Claude Code 2.1.325, `claude -p`)
The analyst, architect, tester and reviewer agents, the start, plan, next, verify, review, release and resume skills, shared and worktree parallel builds with the settings template, and the new approval flow. Not verified: interactive sessions. See `docs/capabilities.md`.

## 0.3.0
Worktree-isolated parallel build mode.

## 0.2.0
Shared-checkout parallel build mode.

## Before 0.2.0
Sequential lifecycle: state store, stage machine, gates, evidence, dispatch, hooks, skills and role agents.
