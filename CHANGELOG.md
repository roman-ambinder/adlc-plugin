# Changelog

## Unreleased

### Documentation
- README: a Quick start section with install, project setup and the nine commands of one change.
- README: install from GitHub (`claude plugin marketplace add roman-ambinder/adlc-plugin`), pin a release with `#<tag>`, update, and set options with `/plugin configure` or `--config`.

## 0.6.0 — 2026-11-14

### Added
- **`/adlc:cancel <reason>`** (user-only): stop an unfinished change. Active workers' leases end as lost, the reason is recorded in `approvals.jsonl` and `handoff.md`, and the change is archived. Code already written stays in place for you to review.
- **`adlc summary`**: time per stage and task, failed attempts, check runs and review findings. The release notes now include it under "Delivery summary". Tokens and cost are still not observable from hooks.
- **Worktree cleanup commands**: after `adlc integrate done` in worktree mode, the CLI prints `git worktree remove` and `git branch -d` for the task. The coordinator runs them once build is complete, each with your approval; git refuses to remove anything that is not merged and clean.
- **Grep over a folder with secret files** now asks first when the folder holds secret-looking files that git does not ignore. A `glob` or `type` filter that excludes them passes without a prompt.
- Releases are automatic: when the version on `main` changes, a workflow runs the tests, tags `v<version>` and publishes a GitHub release with the changelog section.

### Fixed
- Archiving a change whose id is already in `archive/` no longer fails; it goes to `archive/<id>-2`.

## 0.5.1 — 2026-11-14

Fixes found by a live parallel-build test (2026-11-14).

### Fixed
- **Worktree builds stalled after the merge.** Once the user had run the printed commit and merge commands, a second `adlc integrate check` failed with "no uncommitted changes to integrate", and the coordinator stopped. The check now accepts a returned task whose branch is committed and merged, and points at the cross-task checks and `adlc integrate done`. `adlc next` lists each task in flight with its next step.
- **Typed `/adlc:start` flags were ignored.** The start skill put your arguments before the plugin-settings flags, so `--parallel-mode shared` or `--approval-gates plan` was overridden by the saved setting, or by an unsubstituted placeholder. Your arguments now come last and win.
- **Worktree workers could be denied their first command.** Workers chained their claim (`pwd && (adlc … || node …)`), which no allow rule matches. The worker contract and coordinator rules now ask for each `adlc` command as its own Bash call, with one plain retry after a denial. This is the likely cause of the unexplained worktree denial in the 0.4.0 live test.

## 0.5.0 — 2026-11-14

Hardening from the 2026-11-14 review. All covered by `npm test` and CI; not yet live-tested in a Claude Code session.

### Changed (read before upgrading)
- **No terminal shortcut for user-only commands.** `adlc approve`, `skip`, `unblock` and now `archive` always need your own slash command; a pseudo-terminal could pass as a person. New skill: `/adlc:archive [--force]`.
- **An approval covers what you saw.** The intent stores the gate hash when you type `/adlc:approve`; if a covered file changes before the approval is recorded, the CLI refuses. `/adlc:approve` without a valid gate records nothing.
- **Fewer approval gates need your own `/adlc:start`.** `adlc start --approval-gates none` (or any set smaller than `plan,release`) run by the model alone is refused.
- **More of `.agent-lifecycle/` is protected.** The file tools and shell writes are denied for evidence, handoffs, packets, reviews, traceability, `handoff.md` and the archive. Only `requirements.md`, `plan.md`, `decisions.md`, `release.md` and `tmp/` stay editable. Commands that remove, move or relink the directory are denied.

- **Verify needs the approved task checks.** Each check from the plan must pass through `adlc run --stage verify` before the stage completes.
- **Review counts come from the report.** `adlc review add --file <md>` counts `[B<n>]` and `[O<n>]` items; `--blocking`/`--optional` are optional and must agree. A report without the template headings is refused.
- **The release approval covers the code.** A project file changed after `/adlc:approve release` makes the approval stale. Release approvals recorded by 0.4.0 are stale after upgrading.
- **`adlc lease stopped` needs the worker's handoff**; without one use `adlc lease lost`.
- The per-run task budget resets only in a session the hooks recorded, not for any `--session` value.
- The guard also covers the Grep tool and more credential files (`.envrc`, `.npmrc`, `.netrc`, `.pypirc`, `.aws/credentials`, `*.p12`, `*.pfx`).

- `state.json` and worker handoffs are validated against `schemas/*.json`. A damaged state file now gives a clear error (exit 2) naming the fields, instead of an internal error.

### Fixed
- The guard no longer denies commands that only mention a user-only command (`grep "adlc approve" docs/`) or that ignore a failure of a non-check command with a check word in it (`mkdir -p build || true`).
- CI runs once per pull request (pushes trigger it only on `main`), adds Node 24, uses `actions/checkout@v6` and `actions/setup-node@v6`, and pins Claude Code for manifest validation.
- README: Windows is documented as unsupported; one active change per repository is documented.
- Hooks now find the active change the same way the CLI does. A session opened in a subdirectory of the repository was unguarded and could not record approvals.
- The reviewer, analyst and architect could write files through the shell; they are now denied like workers.
- A refused `approve`, `skip` or `unblock` no longer uses up your prompt.
- The guard recognises a quoted subcommand (`adlc "approve" plan`) and matches protected paths case-insensitively.

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
