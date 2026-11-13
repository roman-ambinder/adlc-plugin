# adlc capabilities — implemented, tested, unsupported

Status as of version 0.2.0 (Slices 1–2), 2026-11-13. "Tested" means covered by `npm test` (95 tests, all passing at the time of writing) or by `claude plugin validate --strict`. "Not live-tested" means it has not been run inside a real Claude Code session with a model.

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
| Guard hook (Bash guarding is pattern-based and best-effort; scripts and indirection can bypass it): protected state files, test-disabling edits, check bypasses, risky-command `ask`, user-only command `ask`, role write scopes, workers must claim before writing, worker scope, never `allow` | `hooks/guard.js` | `tests/hooks.test.js` |
| Audit, SubagentStop and SessionStart hooks; silence outside adlc projects | `hooks/*.js` | `tests/hooks.test.js` |
| End-to-end walkthrough of one feature through every stage, using real CLI and hook scripts | `examples/slugify/run.sh` | `tests/e2e.test.js` |

## Live smoke test (2026-11-13, Claude Code 2.1.311, `claude -p --plugin-dir`, Sonnet)

Run against a scratch repository seeded at the build stage. Two `/adlc:next` runs cost $0.31 and $0.18.

| Question | Observed |
|---|---|
| Plugin loads; SessionStart hook runs | Yes. `CLAUDE_PROJECT_DIR` is set for hooks |
| `/adlc:status` works | Yes. The `adlc` CLI is on PATH in the main session |
| `/adlc:next` runs a sequential build end to end | Yes. The developer subagent claimed T1 and wrote the code and tests; the coordinator integrated it and completed build |
| `agent_type` / `agent_id` in subagent hook input | `agent_type` is `"adlc:developer"`; `agent_id` is present on PreToolUse, PostToolUse and SubagentStop |
| `skills: [adlc:worker-contract]` preload in plugin agents | Works. The contract text is in the subagent's initial context |
| `${CLAUDE_SESSION_ID}` substitution in skill bodies | Works. The lease recorded a real session id |
| Hook `ask` vs a user `allow` rule | The hook wins. With `Bash(git commit *)` allowed, the commit was still held for approval (denied in `-p`, which cannot prompt) |
| SubagentStop releases the lease without manual confirmation | Yes, after the fix below |

**Bugs found and fixed during the smoke test**
- The worker ran the CLI as `node "/…/bin/adlc" worker claim …`. The quote after `adlc` defeated the claim pattern, so the worker was never bound and the coordinator had to confirm the stop by hand. The claim, user-only and worker-subcommand patterns now accept a quoted CLI path.
- The worker wrote files with shell heredocs (`cat > src/x.js <<EOF`), which neither the Write/Edit scope check nor the write log saw. Worker roles are now denied shell writes outside `.agent-lifecycle/tmp/`, and the worker contract says to use Write and Edit. In the re-run, every worker write went through the Write tool and was attributed in `runs/writes.jsonl`.

**Still not live-tested**
- `${user_config.*}` substitution in `/adlc:start` (the smoke test seeded state with the CLI).
- The analyst, architect, reviewer and tester agents, and the plan, verify, review and release skills.
- An interactive session, as opposed to `-p`.
- SubagentStop's `last_assistant_message` was empty in `-p` (the subagent reported through its handback), so stop records have an empty excerpt.

Set `ADLC_HOOK_LOG=<file>` to record hook metadata (event, tool, `agent_id`, `agent_type`, session, cwd; never tool input) when diagnosing.

## Shared-checkout parallel build (Slice 2)

Implemented, tested (`tests/parallel.test.js`, `tests/workflow.test.js`) and live-tested.

- `auto` (and `shared`) resolve to `shared` when some wave has at least two independent tasks of size M or L with disjoint files and resources; otherwise `sequential`, with the reason recorded.
- The coordinator launches all ready workers in one message, so they run concurrently. Check runs are serialized through `.check.lock`.
- Each worker is bound to its lease by `agent_id`, may write only its own files, and is released by its SubagentStop record.
- **Live test** (2026-11-13, Sonnet, $0.28). Two independent tasks, `slugify` and `titleCase`:
  - two `adlc:developer` workers ran at the same time, with overlapping write timestamps;
  - both were bound and both stop records carried their lease;
  - both tasks were integrated with no manual stop confirmation;
  - the worker check runs did not overlap.
- No separate binding probe is needed. Hooks inside subagents receive `agent_id`; this is documented, and the live test confirmed it. If `agent_id` were ever missing, unbound workers are denied every write, so the failure is safe and visible.

## Designed, not implemented yet (Slice 3)

- `worktree` mode: `developer-worktree` agent with `isolation: worktree`, `worktree.baseRef: "head"` precondition, and coordinator-run commit and merge in integration order. Until then `worktree` falls back to `shared` with the reason recorded.

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

## Departures from the design spec

- `guard_level: standard` still asks for commits, pushes, PRs, installs, network access, destructive commands, publishing and deploying, because the safety rules require approval for all of them. `strict` adds merge, rebase, worktree and other history edits.
- The reviewer agent has no Write or Edit tools. The coordinator saves the reviewer's report unchanged and records it with `adlc review add`.
- `developer-worktree.md` (spec §6.2 and §8) is deferred to Slice 3, together with worktree mode.
- The spec's binding probe (`adlc probe`, §6.7) was not built; it is unnecessary given documented and live-confirmed `agent_id` (see above).
- Workers must run `adlc worker claim` before writing in every mode, not only in parallel modes, so every worker write is attributed.
- `adlc task update`, `adlc lease stopped`, `adlc trace` and `adlc archive` were added during implementation.
- Tests for Tasks 4–11 were written alongside the code rather than strictly before it.
