# Public release readiness — design

Date: 2026-11-14. Plugin version at start: 0.6.0.

## Intent and why

The owner wants to share `adlc` publicly through an open GitHub release. Public users install it themselves, with no one to help them. They give up at three points: install, first setup, and the first real run. Today the plugin's rules and tests are solid (134 passing tests, several live `-p` runs), but those three points have never been tried the way a stranger would try them. The README also reads like a design spec, not an invitation.

Success: a developer who has never heard of `adlc` can read the top of the README, understand what it does and what it costs, install it from GitHub, set up a project with one command, and finish a small change in an interactive session without hitting an undocumented problem.

## Goals

1. **First run is tested as a stranger would do it.** Install from GitHub (not `--plugin-dir`), set up a fresh project, and take one small change from start to release.
2. **Setup is one command.** A new `/adlc:setup` skill replaces copying `settings-template.json` by hand.
3. **The README welcomes a newcomer.** Why, quickstart, cost and limits come first; reference material moves into `docs/`.
4. **A demo shows the flow.** A short recording of a change going through the stages.
5. **Public-project basics exist.** SECURITY.md, CONTRIBUTING.md, issue and PR templates, correct owner and marketplace text.
6. **A release** (0.7.0) ships all of the above.

## Non-goals

- New lifecycle features, new stages, or changes to the CLI rules (beyond what the first-run test shows is broken).
- Windows support.
- Publishing to any marketplace other than this repository's own.
- A separate documentation website. Docs stay as Markdown in the repo.

## Anti-goals (would count as failure even if the work is done)

- **Overstating safety.** The Bash guard is pattern-based and best-effort. Public docs must not imply it is a sandbox. Every safety claim in the new README keeps the limits already stated in `docs/capabilities.md`.
- **Setup that changes files silently.** `/adlc:setup` must show what it will change and ask first. It must never overwrite or drop the user's existing settings.
- **A quickstart that only works on the author's machine.** Every quickstart step must have been run in the first-run test.
- **Losing reference content.** Splitting the README must not delete information; it moves.

## Constraints

- Node ≥ 18, no dependencies (keep it that way).
- Claude Code ≥ 2.1.311. Plugins cannot ship permission rules, so setup must write the project's `.claude/settings.json`.
- Existing hooks protect parts of `.agent-lifecycle/`; setup writes only `.claude/settings.json` and `.gitignore`, which are not protected.
- `npm test` and `npm run validate` must stay green; CI runs Node 18–24.
- Releases happen by bumping the version on `main` (`release.yml`).
- The cloud session that builds this cannot type into the Claude app. The interactive part of the test must be done by the owner.
- User preference: plain, simple language in all user-facing text.

## Approaches considered

| Approach | What it covers | Trade-off |
|---|---|---|
| A. Docs and cleanup only | README quickstart, owner text, SECURITY/CONTRIBUTING, templates | Fast, but the untested first run stays the biggest risk |
| B. A + `/adlc:setup` + real install test | Removes the two main first-run risks | Medium effort; README still long, no demo |
| **C. B + presentation (chosen)** | Adds a demo, a split README, and a cost and limits section | Most work; demo and interactive check need the owner |

The owner chose **C**.

## Design

### 1. First-run test (do this first; its findings feed everything else)

- In a fresh scratch repository (a tiny Node project with `"test": "node --test"`, one commit), install from GitHub exactly as the README says: `claude plugin marketplace add roman-ambinder/adlc-plugin`, then `claude plugin install adlc@adlc-marketplace`. Test against the branch being built (marketplace `#<branch>`) and, after release, against the new tag.
- Run `/adlc:setup`, then a small change through every stage with `claude -p`, one prompt per step, as the 0.5.0 smoke test did. Record cost per step.
- Log every problem: errors, unclear messages, extra permission prompts, missing docs. Fix the ones that would stop a stranger; list the rest as known issues.
- Write an **interactive checklist** (`docs/interactive-checklist.md`) for the owner: the exact steps to type in the Claude app (start, plan, approve, next ×3, release, approve, release, plus one refused prose approval), and what each should show. The owner runs it before the release and reports back; results go into `docs/capabilities.md`.

### 2. `/adlc:setup` skill

- New skill `plugins/adlc/skills/setup/SKILL.md`, model may suggest it but the user runs it (`disable-model-invocation: true`, since it changes project settings).
- Backed by a CLI subcommand `adlc setup [--dry-run]` so the merge logic is deterministic and tested.
- What it does:
  - Merges the entries from `settings-template.json` into `.claude/settings.json`: adds missing `allow`/`ask`/`deny` entries, keeps every existing entry, never removes anything, keeps other keys untouched. Sets `worktree.baseRef` to `head` only if it is not already set; if set to something else, reports it and leaves it.
  - Adds `.claude/worktrees/` to `.gitignore` if missing.
  - Creates files that do not exist. Refuses (and explains) if `.claude/settings.json` is not valid JSON.
  - Running it twice changes nothing the second time.
  - **Clashes** (builder's call): if a template entry clashes with a user rule in a different list (for example the user allows `Bash(git commit *)` and the template asks), setup skips that entry and reports it, so it never changes how the user's own rules behave.
- Flow: the skill runs `adlc setup --dry-run`, shows the planned changes, asks the user, then runs `adlc setup`. File writes go through normal permission prompts.
- The SessionStart hook (or `adlc status` outside a change) suggests `/adlc:setup` once when `.claude/settings.json` lacks the adlc entries. Exact trigger is the builder's call; it must stay quiet otherwise.
- README and Troubleshooting point to `/adlc:setup` instead of manual copying; manual copying stays documented as an alternative.

### 3. README and docs split

New README order, short:
1. One-line pitch and a 3–4 sentence "why" (structured stages, approval gates, evidence-backed checks, state that survives sessions).
2. Demo (GIF or recording link).
3. Quickstart: requirements, install (2 commands), `/adlc:setup`, the 7-step flow. Every step verified in the first-run test.
4. Cost and limits: typical cost of a small change (from the test runs: about $1.70 for 11 steps with Sonnet in the 0.5.0 run; update from the new test), model note, one change per repo, no Windows, Bash guard is best-effort, interactive-session status.
5. Commands table (short form).
6. Links to the docs pages below.

Move into `docs/` (content moved, not deleted):
- `docs/configuration.md` — options table, worktree mode.
- `docs/how-it-works.md` — architecture diagram, skills/CLI/hooks, project state table, interruption safety, exit codes.
- `docs/safety.md` — safety model, with its limits stated plainly.
- `docs/troubleshooting.md` — the troubleshooting table.
- `docs/development.md` — tests, validation, releasing, documentation references.
- `docs/capabilities.md` — stays; add the new test results.

### 4. Demo

- A short terminal recording (about 1–2 minutes when played) of one small change from `/adlc:start` to release.
- Preferred: the owner records a real interactive session (it doubles as the interactive check). Fallback the builder can produce alone: a scripted recording of the deterministic `examples/slugify/run.sh` flow, clearly labelled as scripted.
- Stored in the repo (`docs/media/`) if small (aim under 5 MB), shown at the top of the README.

### 5. Public-project basics

- `SECURITY.md`: how to report a vulnerability privately (GitHub private vulnerability reporting), what counts (guard bypasses, state tampering, secret leaks in evidence), and the known best-effort limits so reports focus on real gaps.
- `CONTRIBUTING.md`: setup, `npm test`, `npm run validate`, plain-language docs rule, changelog entry, how releases happen.
- `.github/ISSUE_TEMPLATE/` (bug report asking for Claude Code version, Node version, OS, `adlc status`, and `ADLC_HOOK_LOG` output; feature request) and `.github/pull_request_template.md`.
- Fix `marketplace.json` description ("Local marketplace…") and set real owner/author in `marketplace.json`, `plugin.json` and `LICENSE` (`roman-ambinder`, the owner's GitHub handle).
- Optional: GitHub repo description and topics (owner sets them in GitHub settings; list suggested values).

### 6. Release

- Version 0.7.0 and its changelog entry go in a pull request from the work branch. The builder never merges to `main`; the owner merges, and `release.yml` then tags and publishes. A release cannot be undone, so the PR is merged only after the owner's interactive checklist.
- Release blockers (builder's call): an interactive-checklist failure that would stop a stranger blocks the release; anything else is listed as a known issue. If the owner's recording is not ready, the scripted demo ships, labelled as scripted.
- After release, repeat the install step of the first-run test against `#v0.7.0`.

## Order of work

1. First-run test (finds what to fix).
2. Fixes from the test, and `/adlc:setup`.
3. Re-run the first-run test with `/adlc:setup`.
4. Docs split and new README; community files; owner text.
5. Interactive checklist handed to the owner; demo.
6. Release 0.7.0 and post-release install check.

## Decided by the owner

- Audience: public, through an open GitHub release.
- Scope: approach C (docs and cleanup, `/adlc:setup`, real install test, interactive checklist, demo, README split, cost and limits section).
- Owner and author: GitHub handle `roman-ambinder` in `LICENSE`, `plugin.json` and `marketplace.json`.
- First-run test: run with `claude -p` in the cloud session, Sonnet, total spend capped at $10 across all runs. Stop and report if the cap would be passed.
- The repository is public (or will be before release).
- SECURITY.md points to GitHub private vulnerability reporting; the owner turns it on in Settings → Security before release.

## Left to the builder

- Exact wording of all docs (plain language).
- The recording tool and format for the demo fallback.
- Whether `adlc setup` lives in `lib/cli.js` or a new `lib/setup.js`.
- The exact setup-suggestion trigger, within the "quiet otherwise" rule.
- Which first-run problems are fixed now versus listed as known issues, within "fix what would stop a stranger".
