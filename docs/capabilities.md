# adlc capabilities — implemented, tested, unsupported

Status as of version 0.1.0 (Slice 1), 2026-11-13. "Tested" means covered by `npm test` (84 tests, all passing at the time of writing) or by `claude plugin validate --strict`. "Not live-tested" means it has not been run inside a real Claude Code session with a model.

## Implemented and tested

| Capability | Where | Evidence |
|---|---|---|
| Plugin and marketplace manifests pass strict validation | `.claude-plugin/`, `plugins/adlc/.claude-plugin/` | `npm run validate` |
| Versioned state (schema 1), atomic writes, lock, revision conflict detection, torn-line tolerant JSONL | `lib/state.js`, `lib/fsutil.js` | `tests/state.test.js`, `tests/fsutil.test.js` |
| Eight-stage state machine; strict order; skip with recorded reason (discover, specify, design, release only); build reopens after a blocking review or failed verify | `lib/stages.js`, `lib/cli.js` | `tests/stages.test.js`, `tests/cli.test.js` |
| Tasks with dependencies, contracts, writable files, checks, ACs; block cascade; repair limit that blocks the change | `lib/tasks.js` | `tests/tasks.test.js`, `tests/cli.test.js` |
| Execution-ready build packets | `lib/packets.js` | `tests/tasks.test.js` |
| Plan and release gates bound to a hash of covered artifacts; stale approvals detected; gates configurable | `lib/gates.js` | `tests/workflow.test.js`, `tests/cli.test.js` |
| Stage completion rules: AC coverage, packet readiness, fresh execution plan, passing verify evidence, review without blocking findings, filled release sections, traceability | `lib/rules.js` | `tests/workflow.test.js` |
| Evidence only from executed commands (exit code, duration, redacted, last 200 lines) | `lib/evidence.js` | `tests/evidence.test.js` |
| Secret redaction in evidence, audit log, reviews, handoff notes, stop records | `lib/redact.js` | `tests/evidence.test.js`, `tests/hooks.test.js`, `tests/cli.test.js` |
| Wave computation (dependency levels, file and resource overlap, serial patterns, coupled tasks), cycle detection | `lib/exec.js` | `tests/workflow.test.js` |
| Readiness gate before dispatch, leases, no duplicate dispatch, per-session task budget | `lib/dispatch.js` | `tests/workflow.test.js` |
| Structured handoff validation; integration check (evidence matching, ownership, stop record); cross-task checks required before integration | `lib/integrate.js` | `tests/workflow.test.js`, `tests/cli.test.js` |
| Guard hook: protected state files, test-disabling edits, check bypasses, risky-command `ask`, user-only command `ask`, role write scopes, worker binding and scope, never `allow` | `hooks/guard.js` | `tests/hooks.test.js` |
| Audit, SubagentStop and SessionStart hooks; silence outside adlc projects | `hooks/*.js` | `tests/hooks.test.js` |
| End-to-end walkthrough of one feature through every stage, using real CLI and hook scripts | `examples/slugify/run.sh` | `tests/e2e.test.js` |

## Implemented, not live-tested

These are prompt files (skills and agents), or depend on runtime behaviour that unit tests cannot exercise.

- The 13 skills (`/adlc:*`) and 5 agents. Strict validation passes, but the model's behaviour in a live session has not been observed.
- Agent `skills: [adlc:worker-contract]` preload. The exact name format for a plugin skill in this field is not documented, so the agent prompts also tell the worker to read the file directly as a fallback.
- The exact `agent_type` string Claude Code sends for plugin subagents. The guard accepts both `developer` and `adlc:developer`.
- Hook `ask` precedence over a user's `allow` rule for the same command.
- `${user_config.*}` substitution in skill bodies. The CLI treats empty or unsubstituted values as defaults.

## Designed, not implemented yet (Slices 2–3)

- `shared` parallel mode: several background workers in one checkout with disjoint files, serialized check runs, and a binding probe confirming `agent_id`.
- `worktree` parallel mode: `developer-worktree` agent with `isolation: worktree`, `worktree.baseRef: "head"` precondition, coordinator-run commit and merge in integration order.
- Rolling background dispatch across waves.

Until then every `parallel_mode` value runs sequentially, and the reason is recorded in `state.json` and `plan.md`.

## Unsupported by the platform (limitations and workarounds)

| Limitation | Workaround in adlc |
|---|---|
| A plugin cannot ship permission rules | `settings-template.json` to copy into `.claude/settings.json`; guard hook `deny`/`ask` |
| `permissionMode`, `hooks`, `mcpServers` and `initialPrompt` are ignored in plugin agents | Plugin-level hooks plus per-agent `tools` allowlists |
| Hooks cannot tell whether a Bash command came from the user's request or the model | User-only skills use `disable-model-invocation: true`, and the guard asks before `adlc approve`, `skip` and `unblock` so the exact command is always shown |
| A plugin cannot set `worktree.baseRef` | Worktree mode (when implemented) requires the user to set it; `auto` will not select worktree mode without it |
| File writes made through the Bash tool cannot be attributed at write time | Detected afterwards by `integrate check`, using `git status` and the handoff's file list |
| Token use and cost are not observable from hooks | Recorded as `"not observable"`; the controls are `maxTurns`, the task budget and repair limits |
| `bin/` prevents installation on claude.ai and Cowork | Claude Code CLI and desktop only |
| Hook timeouts or crashes fail open at the platform level | Guard internal errors return `ask`; platform permission prompts still apply |
