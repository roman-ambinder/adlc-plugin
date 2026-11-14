# How adlc works

## Architecture

```
you ──/adlc:* skills──▶ main session (coordinator rules)
                             │  Agent tool, one worker at a time
            ┌────────┬───────┼────────┬─────────┐       (shared mode: several developers at once, disjoint files)
         analyst architect developer tester  reviewer     plugin subagents with tool allowlists
                             │
                  adlc CLI (bin/adlc, Node ≥ 18, no dependencies)
                             │  locked, revision-checked, atomic writes
                    .agent-lifecycle/                     project state
hooks: SessionStart (status) · UserPromptSubmit (user intent) · PreToolUse (guard) · PostToolUse (audit) · SubagentStop (worker stopped)
```

- **Skills** are the user interface and orchestration. They call the CLI.
- **The CLI** holds every deterministic rule: stage order, gate hashes, task dependencies, leases, attempt limits, evidence. It refuses illegal transitions (exit code 2), so these rules hold however a request is phrased.
- **Hooks** enforce boundaries through Claude Code's supported controls:
  - deny edits to everything the CLI writes under `.agent-lifecycle/` (state, approvals, evidence, handoffs, packets, reviews, traceability), and commands that remove or move that directory;
  - deny edits that skip tests;
  - deny commands that mask a check's exit status (`|| true`, `; exit 0`, `set +e`), and `adlc run` refuses to record them;
  - deny reading `.env`, keys, certificates and credential files (`.npmrc`, `.netrc`, `.aws/credentials`, …) through Bash, Read or Grep, and ask before a Grep over a folder that holds such files (unless git ignores them or a glob or type filter excludes them);
  - deny writes outside a role's or task's scope;
  - ask before commits, pushes, PRs, installs, network access, destructive commands, publishing and deploying.

  Hooks never return `allow`, so platform permission prompts always apply. Guarding of Bash commands is pattern-based and best-effort: scripts or indirection can get past it. File-tool writes, role scopes and the CLI rules are enforced reliably.
- **Evidence** comes only from `adlc run`, which executes the command itself and records the exit code, duration and redacted output.

The full design is in [docs/superpowers/specs/2026-11-13-adlc-plugin-design.md](superpowers/specs/2026-11-13-adlc-plugin-design.md).

## The CLI

The underlying CLI is `adlc` (on the Bash tool's PATH while the plugin is enabled). Run `adlc help` for every subcommand.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | ok |
| 1 | usage error |
| 2 | rule violation (illegal transition, stale gate, limit reached, readiness failure) |
| 3 | concurrent modification; re-run the command |
| 4 | no active change |
| 5 | the command `adlc run` executed failed; evidence was recorded |
| 70 | internal error |

## Project state

Everything lives in `.agent-lifecycle/` in your repository.

| Path | Commit? | Written by | Contents |
|---|---|---|---|
| `state.json` | yes | CLI only | Schema 1: stages, tasks, contracts, execution plan, leases, budget, metrics, `revision` |
| `requirements.md` | yes | analyst / you | Problem, users, constraints, success criteria, `- AC-n:` lines |
| `plan.md` | yes | coordinator / you | Context, affected files, risks; CLI-owned `tasks` and `execution` sections between markers |
| `decisions.md` | yes | architect / you | Decisions `D-n`, contracts `C-n` |
| `packets/T<n>.md` | yes | CLI | Execution-ready build packet per task |
| `handoffs/T<n>.json` | yes | worker (validated by CLI) | Structured worker handoff |
| `test-results/*.md` | yes | `adlc run` only | Command, exit code, duration, redacted output (last 200 lines) |
| `reviews/*.md` | yes | CLI from the reviewer's report | Blocking and optional findings (counted by the CLI from `[B<n>]` / `[O<n>]` items) |
| `approvals.jsonl` | yes | CLI only (append) | Approvals, skips, unblocks |
| `traceability.md` | yes | `adlc trace` | AC → tasks → passing evidence |
| `handoff.md` | yes | `adlc handoff` (append) | Session notes for resuming |
| `release.md` | yes | coordinator / you | Summary, migration, deployment, rollback, known issues |
| `.lock`, `.check.lock`, `tmp/`, `runs/` | **no** | CLI / hooks | Locks, scratch files, audit log, agent bindings, write and stop logs |

`adlc start` writes `.agent-lifecycle/.gitignore` for the last row.

One change is active at a time per repository. Finish it, or archive it with `/adlc:archive`, before starting the next. `adlc` checks `state.json` against `schemas/state.schema.json` on every read, so a damaged or hand-edited file is reported with the exact fields at fault.

**Interruption safety:**
- `state.json` is written to a temp file, fsynced and renamed, under a lock. A write is refused (exit 3) if the revision changed since it was read.
- JSONL appends tolerate a torn last line.
- Markdown you edit is never regenerated; the CLI only appends, or replaces content between `<!-- adlc:begin … -->` / `<!-- adlc:end … -->` markers.

## Directory tree

```
adlc-plugin/
├── .claude-plugin/marketplace.json      local marketplace → ./plugins/adlc
├── package.json                         npm test / npm run validate
├── README.md
├── docs/
│   ├── capabilities.md                  implemented / tested / unsupported
│   └── superpowers/                     design spec and implementation plan
├── examples/slugify/
│   ├── run.sh                           end-to-end walkthrough
│   └── artifacts/                       .agent-lifecycle/ and code produced by run.sh
├── plugins/adlc/
│   ├── .claude-plugin/plugin.json       manifest + userConfig
│   ├── bin/adlc                         state CLI (on the Bash PATH while enabled)
│   ├── lib/                             cli, state, stages, tasks, packets, gates, rules,
│   │                                    evidence, redact, exec, dispatch, integrate,
│   │                                    worktree, fsutil, glob, errors, masking, userintent, schema
│   ├── hooks/                           hooks.json, guard, audit, subagent-stop,
│   │                                    session-start, prompt-submit, common, patterns
│   ├── skills/<name>/SKILL.md           start plan approve next status verify review
│   │                                    resume release skip unblock archive cancel coordinator worker-contract
│   ├── agents/                          analyst architect developer developer-worktree tester reviewer
│   ├── templates/                       requirements plan decisions handoff release review
│   ├── schemas/                         state.schema.json, handoff.schema.json (enforced by lib/schema.js)
│   └── settings-template.json           permissions to copy into .claude/settings.json
└── tests/                               node:test suites + helpers.js
```
