# adlc capabilities — implemented, tested, unsupported

Status as of version 0.4.0 (Slices 1–3 plus the 2026-11-13 review follow-up), 2026-11-13. "Tested" means covered by `npm test` (all passing at the time of writing; the count is not recorded here so it cannot drift) or by `claude plugin validate --strict`. "Not live-tested" means it has not been run inside a real Claude Code session with a model.

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
| Guard additions (2026-11-13 review): commands that mask an exit status (`\|\| true`, `; true`, `; exit 0`, `set +e`) are denied and `adlc run` refuses to record them; workers are denied inline interpreter code (`python -c`, `node -e`, …); edits that delete test cases ask first, and `.todo`/`@Disabled`/`xfail`-style skips are denied; package runners (`npm exec`, `pnpm dlx`, `yarn dlx`, `bunx`, `uvx`) and `find -delete` ask, `docker run` asks in strict; secret files (`.env`, `*.pem`, `*.key`, `id_*`) are denied in Bash and Read; `integrate check` fails on files outside every task's writable set that were modified after dispatch | `lib/masking.js`, `hooks/patterns.js`, `hooks/guard.js`, `lib/integrate.js` | `tests/hooks.test.js`, `tests/evidence.test.js`, `tests/workflow.test.js` |
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

**Live test of the remaining agents and skills (2026-11-13, Claude Code 2.1.325, `claude -p --plugin-dir --add-dir`, scoped `--allowedTools`, scratch repository with a `node --test` script).** The first attempt failed on test-harness permissions (plugin directory outside the project not readable, compound Bash commands not allowed); passing `--add-dir <plugin>` and a scoped allowlist fixed that.

| Exercised live | Observed |
|---|---|
| `/adlc:start` (with `--small`, and without) | Change created; the analyst ran discover and its blocking questions were passed to the user |
| `/adlc:plan` | Analyst wrote requirements with ACs; coordinator created tasks; architect wrote `D-1`/`C-1` in `decisions.md` |
| `/adlc:approve plan` | Run by the test script as the user; build then started. Re-verified with the intent check: prose request refused, slash command accepted (see the platform table) |
| `/adlc:next` (build, verify, review) | Developer built the task and `integrate check` passed; tester ran `npm test` through `adlc run`; reviewer returned 0 blocking and 4 optional findings |
| `/adlc:release` and `/adlc:approve release` | Release notes written, approval recorded, stage completed |
| `/adlc:resume` | Recorded the user's answers and completed discover |

**Findings and fixes from this run**
- `${user_config.*}` was passed to the model unsubstituted when no plugin settings were saved, and the model dropped the flags. `adlc start` now resolves each setting as flag, then `CLAUDE_PLUGIN_OPTION_<NAME>`, then the default, and ignores an unsubstituted placeholder.
- Build packets listed `AC-1 … AC-n` with no text, and the worker noted it had to guess from the goal. Packets now include each criterion's text from `requirements.md`.

**Not covered by this run:** interactive sessions.

**Parallel builds re-tested with the new guard and the settings template (2026-11-13, Claude Code 2.1.325, `claude -p --settings plugins/adlc/settings-template.json`).** Scratch repository with a committed `package-lock.json` and a `pretest` script that writes `coverage/lcov.info` and touches the lockfile, plus two independent M tasks, once in shared and once in worktree mode.
- Both modes ran two workers concurrently and both workers' checks passed.
- **Bug found and fixed:** the stray-file rule added in the review blocked both tasks over `coverage/lcov.info`, and worktree mode's existing writable-set rule did the same (and would have put the file in the printed `git add`). Files modified while an `adlc run` check was executing are now attributed to the check: they warn, are left out of the commit and do not block `integrate done`. The window is the evidence's recorded duration plus 100 ms, so a worker's own stray write outside a check still fails.
- Shared mode completed integration live. Worktree mode completed end to end with the user's commit and merge commands run by hand (`-p` cannot approve them): two `--no-ff` merges, `integrate done` accepted both.
- One earlier worktree run had both workers' first Bash call denied by the platform permission layer (their claims never ran). It did not reproduce on a rerun with the same flags and I did not find the cause.

**Still not live-tested**
- An interactive session, as opposed to `-p`, including typing `/adlc:approve` in the app so the `UserPromptSubmit` intent is recorded (verified only with `-p`).
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

## Worktree-isolated parallel build (Slice 3)

Implemented, tested (`tests/worktree.test.js`, which uses real `git worktree`s) and live-tested.

- `auto`/`worktree` resolve to `worktree` when the repository has commits, `worktree.baseRef` is `"head"`, `.claude/worktrees/` is ignored, and there are no uncommitted changes outside `.agent-lifecycle/`. Otherwise they fall back to `shared` and list every unmet precondition.
- The CLI and hooks resolve the main checkout from inside a linked worktree, by reading `.git` and `commondir` without spawning git. A worker never reads a stale committed copy of `state.json`.
- The guard limits a worker's writes to its own worktree and its task's files. The write log records paths relative to the worktree, plus the worktree path.
- `integrate check` validates the worktree's actual diff and prints the exact add, commit and merge commands. `integrate done` requires that the commit exists, that it is merged into `HEAD`, and that the cross-task checks ran after the merge.
- **Live test** (2026-11-13, Sonnet, $0.32), two independent tasks:
  - the platform created both worktrees from the approved commit, which confirms `baseRef: "head"`;
  - both `adlc:developer-worktree` workers were bound with their worktree as `cwd`;
  - all writes were attributed with worktree-relative paths;
  - both integration checks passed;
  - the merge command was held for approval; `-p` cannot prompt, so I ran the remaining commands as the user;
  - `integrate done` refused T1 before the merge and accepted it after;
  - the history shows two `--no-ff` merges.

**Bugs found by the live test and fixed**
- `git -C '<worktree>' commit …` was not recognised as a commit, because the patterns expected the subcommand straight after `git`. The guard patterns now skip `-C <dir>`, `-c k=v` and `--opt=value`.
- The coordinator appended a co-author trailer to the printed merge message. The rules now say to run the commands character for character.

**Known limits**
- In this environment, the commit in the worktree ran without a platform prompt even though it was not in `--allowedTools`. The guard bug above is fixed; the platform-side cause was not investigated and may be a user-level hook.
- Worktrees are left in place after integration (Claude Code keeps worktrees that had changes). The coordinator offers `git worktree remove`, which needs approval.

## Unsupported by the platform (limitations and workarounds)

| Limitation | Workaround in adlc |
|---|---|
| A plugin cannot ship permission rules | `settings-template.json` to copy into `.claude/settings.json`; guard hook `deny`/`ask` |
| `permissionMode`, `hooks`, `mcpServers` and `initialPrompt` are ignored in plugin agents | Plugin-level hooks plus per-agent `tools` allowlists |
| Hooks cannot tell whether a Bash command came from the user's request or the model | User-only skills use `disable-model-invocation: true`. The `UserPromptSubmit` hook, which sees only prompts the user submits, records an intent when the user types `/adlc:approve`, `/adlc:skip` or `/adlc:unblock`; the CLI and guard require a matching, unexpired, unused intent (or a terminal). Live-verified 2026-11-13: a prose request to run `adlc approve plan` was blocked, and the slash command approved once. A command written by a shell script to `runs/` is still the best-effort Bash limit |
| A plugin cannot set `worktree.baseRef` | Worktree mode (when implemented) requires the user to set it; `auto` will not select worktree mode without it |
| File writes made through the Bash tool cannot be attributed at write time | Detected afterwards by `integrate check`, using `git status` and the handoff's file list |
| Token use and cost are not observable from hooks | Recorded as `"not observable"`; the controls are `maxTurns`, the task budget and repair limits |
| `bin/` prevents installation on claude.ai and Cowork | Claude Code CLI and desktop only |
| Weakened assertions in tests are not detected by hooks | The reviewer agent |
| Bash guarding cannot stop scripts written with Write and run later, obfuscated commands (`eval`, variable indirection), or masking by pipes without `pipefail` | `integrate check` and the reviewer detect the effects afterwards |
| Hook timeouts or crashes fail open at the platform level | Guard internal errors return `ask`; platform permission prompts still apply |

## Departures from the design spec

- `guard_level: standard` still asks for commits, pushes, PRs, installs, network access, destructive commands, publishing and deploying, because the safety rules require approval for all of them. `strict` adds merge, rebase, worktree and other history edits.
- The reviewer agent has no Write or Edit tools. The coordinator saves the reviewer's report unchanged and records it with `adlc review add`.
- The spec's binding probe (`adlc probe`, §6.7) was not built; it is unnecessary given documented and live-confirmed `agent_id` (see above).
- Workers must run `adlc worker claim` before writing in every mode, not only in parallel modes, so every worker write is attributed.
- `adlc task update`, `adlc lease stopped`, `adlc trace` and `adlc archive` were added during implementation.
- Tests for Tasks 4–11 were written alongside the code rather than strictly before it.
