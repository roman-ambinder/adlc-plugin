# adlc — Agentic Development Lifecycle plugin for Claude Code

`adlc` takes a change from an idea to a tested, reviewed, release-ready state. It runs eight stages:

**discover → specify → plan → design → build → verify → review → release**

Focused subagents do the work: analyst, architect, developer, tester and reviewer. State lives in readable files under `.agent-lifecycle/`, so work survives across sessions. The plugin asks for your approval at configurable gates and before risky commands.

It is built for solo developers and small teams. It is language-agnostic: it uses the repository's own test, lint, format and type-check commands.

> **Version 0.1.0 (Slice 1).** Build runs **sequentially**. Parallel build is designed (spec §6.7) but not implemented yet: `parallel_mode: auto` resolves to `sequential` and records why. See [docs/capabilities.md](docs/capabilities.md).

## Architecture

```
you ──/adlc:* skills──▶ main session (coordinator rules)
                             │  Agent tool, one worker at a time
            ┌────────┬───────┼────────┬─────────┐
         analyst architect developer tester  reviewer     plugin subagents with tool allowlists
                             │
                  adlc CLI (bin/adlc, Node ≥ 18, no dependencies)
                             │  locked, revision-checked, atomic writes
                    .agent-lifecycle/                     project state
hooks: SessionStart (status) · PreToolUse (guard) · PostToolUse (audit) · SubagentStop (worker stopped)
```

- **Skills** are the user interface and orchestration. They call the CLI.
- **The CLI** holds every deterministic rule: stage order, gate hashes, task dependencies, leases, attempt limits, evidence. It refuses illegal transitions (exit code 2), so these rules hold however a request is phrased.
- **Hooks** enforce boundaries through Claude Code's supported controls:
  - deny edits to state and approval files;
  - deny edits that skip tests;
  - deny writes outside a role's or task's scope;
  - ask before commits, pushes, PRs, installs, network access, destructive commands, publishing and deploying.

  Hooks never return `allow`, so platform permission prompts always apply. Guarding of Bash commands is pattern-based and best-effort: scripts or indirection can get past it. File-tool writes, role scopes and the CLI rules are enforced reliably.
- **Evidence** comes only from `adlc run`, which executes the command itself and records the exit code, duration and redacted output.

The full design is in [docs/superpowers/specs/2026-11-13-adlc-plugin-design.md](docs/superpowers/specs/2026-11-13-adlc-plugin-design.md).

### Documentation references (checked 2026-11-13, Claude Code 2.1.311)

| Topic | Page |
|---|---|
| Plugin manifest, layout, `userConfig`, `${CLAUDE_PLUGIN_ROOT}`, `bin/` | https://code.claude.com/docs/en/plugins-reference |
| Components, plugin agent frontmatter limits | https://code.claude.com/docs/en/plugins/components |
| Skills frontmatter, `$ARGUMENTS`, `disable-model-invocation` | https://code.claude.com/docs/en/skills |
| Subagents, tools, `maxTurns`, `isolation` | https://code.claude.com/docs/en/sub-agents |
| Hook events, PreToolUse decisions, SubagentStop, `agent_id` | https://code.claude.com/docs/en/hooks |
| Worktrees and `worktree.baseRef` | https://code.claude.com/docs/en/worktrees |
| Marketplace file | https://code.claude.com/docs/en/plugins/marketplace-reference |

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
│   │                                    fsutil, glob, errors
│   ├── hooks/                           hooks.json, guard, audit, subagent-stop,
│   │                                    session-start, common, patterns
│   ├── skills/<name>/SKILL.md           start plan approve next status verify review
│   │                                    resume release skip unblock coordinator worker-contract
│   ├── agents/                          analyst architect developer tester reviewer
│   ├── templates/                       requirements plan decisions handoff release review
│   ├── schemas/                         state.schema.json, handoff.schema.json
│   └── settings-template.json           permissions to copy into .claude/settings.json
└── tests/                               node:test suites + helpers.js
```

## Installation

Requirements: Claude Code ≥ 2.1.311, Node ≥ 18, git (recommended).

**From this repository as a local marketplace:**

```bash
claude plugin marketplace add /path/to/adlc-plugin
```

```bash
claude plugin install adlc@adlc-marketplace
```

Or, inside a session: `/plugin marketplace add /path/to/adlc-plugin`, then `/plugin install adlc@adlc-marketplace`.

**For one session without installing (development):**

```bash
claude --plugin-dir /path/to/adlc-plugin/plugins/adlc
```

After changing plugin files, run `/reload-plugins` or start a new session.

**Recommended project permissions:** copy the entries from `plugins/adlc/settings-template.json` into your project's `.claude/settings.json`. A plugin cannot ship permission rules itself. The template:
- allows the routine `adlc` subcommands without a prompt;
- keeps commits, pushes, PRs, installs and publishing on `ask`;
- denies reading `.env`, keys and similar files.

`approve`, `skip`, `unblock` and `lease` are deliberately left out of the allow list.

## Commands

| Command | What it does |
|---|---|
| `/adlc:start "<title>" [--type feature\|bugfix] [--small]` | Start a change; run Discover with the analyst. `--small` skips discover and design and records the reason |
| `/adlc:plan` | Specify (acceptance criteria) → Plan (repository inspection, tasks, packets) → Design (architect). Ends by asking you to approve |
| `/adlc:approve plan\|release [note]` | **User-only.** Records your approval, tied to a hash of everything it covers |
| `/adlc:next` | Run the next approved stage: build, verify, review or release |
| `/adlc:status` | Stage, gates, tasks, blockers, budget, next step |
| `/adlc:verify` | Run the repository's tests, format check, lint, type check and security checks through `adlc run` |
| `/adlc:review` | Independent review by the reviewer agent; blocking findings reopen build |
| `/adlc:resume` | Rebuild context in a new session and recover workers from the previous session |
| `/adlc:release` | Traceability, release notes (changes, migration, deployment, rollback), then complete after approval |
| `/adlc:skip <stage> <reason>` | **User-only.** Skip discover, specify, design or release |
| `/adlc:unblock <note> [--task T]` | **User-only.** Clear a blocker, for example a task that hit its repair limit |

The underlying CLI is `adlc` (on the Bash tool's PATH while the plugin is enabled). Run `adlc help` for every subcommand. Exit codes:

| Code | Meaning |
|---|---|
| 0 | ok |
| 1 | usage error |
| 2 | rule violation (illegal transition, stale gate, limit reached, readiness failure) |
| 3 | concurrent modification; re-run the command |
| 4 | no active change |
| 5 | the command `adlc run` executed failed; evidence was recorded |
| 70 | internal error |

## Configuration

Set these when enabling the plugin, or later with `/plugin` → Installed → Configure (they also appear in `/config`).

| Option | Default | Meaning |
|---|---|---|
| `approval_gates` | `plan,release` | Gates that need your approval. `none` disables them; platform prompts and guard prompts still apply |
| `guard_level` | `strict` | `standard` asks before commit, push, PR, install, network, destructive, publish and deploy commands. `strict` also asks before merge, rebase, worktree and other history edits |
| `max_repair_attempts` | `3` | Failed attempts per task before it is blocked and work stops |
| `max_tasks_per_run` | `5` | Tasks dispatched per session before the coordinator stops and writes a handoff |
| `parallel_mode` | `auto` | `auto`, `worktree`, `shared` or `sequential`. In 0.1.0 all of them run sequentially |
| `max_parallel` | `2` | Upper bound on concurrent workers (used once parallel modes exist) |
| `serial_globs` | lockfiles, manifests, config, migrations, generated files | Tasks that touch these always run alone |

Values are captured into `state.json` when a change starts.

## Project state: `.agent-lifecycle/`

| Path | Commit? | Written by | Contents |
|---|---|---|---|
| `state.json` | yes | CLI only | Schema 1: stages, tasks, contracts, execution plan, leases, budget, metrics, `revision` |
| `requirements.md` | yes | analyst / you | Problem, users, constraints, success criteria, `- AC-n:` lines |
| `plan.md` | yes | coordinator / you | Context, affected files, risks; CLI-owned `tasks` and `execution` sections between markers |
| `decisions.md` | yes | architect / you | Decisions `D-n`, contracts `C-n` |
| `packets/T<n>.md` | yes | CLI | Execution-ready build packet per task |
| `handoffs/T<n>.json` | yes | worker (validated by CLI) | Structured worker handoff |
| `test-results/*.md` | yes | `adlc run` only | Command, exit code, duration, redacted output (last 200 lines) |
| `reviews/*.md` | yes | CLI from the reviewer's report | Blocking and optional findings |
| `approvals.jsonl` | yes | CLI only (append) | Approvals, skips, unblocks |
| `traceability.md` | yes | `adlc trace` | AC → tasks → passing evidence |
| `handoff.md` | yes | `adlc handoff` (append) | Session notes for resuming |
| `release.md` | yes | coordinator / you | Summary, migration, deployment, rollback, known issues |
| `.lock`, `.check.lock`, `tmp/`, `runs/` | **no** | CLI / hooks | Locks, scratch files, audit log, agent bindings, write and stop logs |

`adlc start` writes `.agent-lifecycle/.gitignore` for the last row.

**Interruption safety:**
- `state.json` is written to a temp file, fsynced and renamed, under a lock. A write is refused (exit 3) if the revision changed since it was read.
- JSONL appends tolerate a torn last line.
- Markdown you edit is never regenerated; the CLI only appends, or replaces content between `<!-- adlc:begin … -->` / `<!-- adlc:end … -->` markers.

## Safety model

- **Untrusted input.** Agent prompts and coordinator rules treat repository files, tool output and subagent reports as data. The SessionStart hook injects only structured, sanitised fields.
- **Approvals.**
  - Gate approvals hash the covered artifacts, so changing scope makes an approval stale.
  - Approve, skip and unblock skills use `disable-model-invocation: true`, so only you can start them.
  - The guard also asks before any `adlc approve|skip|unblock` command, so you see the exact command every time.
- **Least privilege.**
  - Each agent has a tool allowlist; the reviewer has no Write or Edit.
  - Hooks deny the analyst and architect writes outside their file.
  - A worker that has claimed a task may write only that task's files, and may not run git or state-changing `adlc` commands.
- **Honesty.**
  - Evidence comes only from executed commands.
  - `integrate check` rejects claimed checks without matching evidence, and changed files outside the task.
  - Edits that add `.skip`/`.only`, and `--no-verify` or `|| true` after checks, are denied.
- **Limits.**
  - Per-task repair attempts, a per-run task budget and agent `maxTurns`.
  - Hitting a limit blocks the change and the coordinator stops.
- **Secrets.** Evidence, audit logs, review files and handoff notes pass through redaction (common token formats and `password=`/`token=` assignments). Redaction is best-effort: keep secrets out of command output.

## End-to-end example

[`examples/slugify/run.sh`](examples/slugify/run.sh) takes a small feature (a `slugify` utility) through every stage. It uses the real CLI and the real hook scripts, with model work replaced by fixed content, so the run is deterministic.

```bash
examples/slugify/run.sh
```

The resulting artifacts are committed in [`examples/slugify/artifacts/`](examples/slugify/artifacts/).

In an interactive session the same flow is:

1. `/adlc:start "Add slugify utility" --small`
2. `/adlc:plan`
3. `/adlc:approve plan`
4. `/adlc:next` (build), then `/adlc:next` again (verify), then once more (review)
5. `/adlc:release`
6. `/adlc:approve release`
7. `/adlc:release` (completes the stage)

## Development

```bash
npm test
```

```bash
npm run validate
```

`npm test` runs 92 `node:test` tests: state, stages, tasks, gates, evidence, dispatch, integration, CLI, hooks, skill and agent files, and the end-to-end example. `npm run validate` runs `claude plugin validate --strict` on the plugin and the marketplace.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `adlc: command not found` in Bash | The plugin must be enabled. Skills fall back to `node "${CLAUDE_PLUGIN_ROOT}/bin/adlc"`; you can run `node plugins/adlc/bin/adlc` from a checkout |
| `no active change` (exit 4) | Run `/adlc:start` first. The CLI finds `.agent-lifecycle/` by walking up from the current directory, or uses `ADLC_ROOT` |
| `plan gate not approved` / `approval is stale` | Review the files, then run `/adlc:approve plan` again. Any edit to covered files, tasks or packets after approval needs a new approval |
| `state changed concurrently` (exit 3) | Another adlc process wrote state. Re-run the command |
| `no SubagentStop record for L-…` | The worker may still be running. Once it has returned, inspect its changes and run `adlc lease stopped <L> "<note>"` |
| Task blocked after repeated failures | Read its evidence and handoff, decide the approach, then `/adlc:unblock "<note>" --task T<n>` |
| Hooks seem inactive | Hooks only act in projects with `.agent-lifecycle/state.json`. Check `/plugin` → Errors, and `claude --debug` |
| Need to see what hooks receive | Start Claude Code with `ADLC_HOOK_LOG=/tmp/adlc-hooks.jsonl` to log hook metadata (never tool input) |
| Too many permission prompts | Copy `plugins/adlc/settings-template.json` entries into `.claude/settings.json`. Guard `ask` prompts for risky commands remain by design |

## License

MIT
