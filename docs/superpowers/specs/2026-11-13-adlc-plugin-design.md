# ADLC — Agentic Development Lifecycle plugin for Claude Code

Status: approved design (2026-11-13). Target: Claude Code ≥ 2.1.311, Node ≥ 18.

## 1. Goal

A Claude Code plugin that takes a change from idea to a tested, reviewed,
release-ready state through eight stages, with focused agents, durable
on-disk state that survives sessions, and human approval gates enforced by
supported platform controls (hooks, agent tool allowlists, user-only skills)
rather than prompts alone.

Audience: solo developers and small teams. Language-agnostic: the plugin
discovers the project's own test/lint/format/typecheck commands.

## 2. Documentation basis (verified 2026-11-13)

| Fact | Source |
|---|---|
| Layout: `.claude-plugin/plugin.json`, `skills/<n>/SKILL.md`, `agents/*.md`, `hooks/hooks.json`, `bin/` | code.claude.com/docs/en/plugins-reference, /plugins/components |
| `bin/` is on the Bash tool's PATH; `${CLAUDE_PLUGIN_ROOT}` is NOT in Bash env, only substituted in skill/agent bodies and hook commands | plugins-reference § Environment variables |
| `userConfig` options exported to hooks as `CLAUDE_PLUGIN_OPTION_<KEY>`; shell-form hooks reject `${user_config.*}` | plugins-reference § User configuration |
| Plugin agents support `name, description, model, effort, maxTurns, tools, disallowedTools, skills, memory, background, isolation, color`; ignore `permissionMode, hooks, mcpServers, initialPrompt` | /plugins/components § Agents |
| Skill frontmatter: `description, argument-hint, disable-model-invocation, user-invocable, allowed-tools, context, agent` …; `$ARGUMENTS`; `` !`cmd` `` injection | /skills |
| PreToolUse JSON: `hookSpecificOutput.permissionDecision` ∈ allow/deny/ask/defer; precedence deny > defer > ask > allow; deny/ask rules still evaluated regardless | /hooks |
| SessionStart `hookSpecificOutput.additionalContext`, ≤10k chars | /hooks |
| Stop/SubagentStop input has `stop_hook_active`; SubagentStop has `agent_type` = agent frontmatter name | /hooks |
| Subagents nest up to 3 levels; run in background concurrently (default cap 20); background permission prompts surface in the main session | /sub-agents |
| PreToolUse/PostToolUse fire inside subagents with `agent_id`, `agent_type` common fields | /hooks § hooks in subagents, common input fields |
| SubagentStop input: `agent_id`, `agent_type`, `stop_hook_active`, `last_assistant_message` | /hooks § SubagentStop |
| Subagent worktrees: under `.claude/worktrees/`, tracked files only, kept if changed; base = remote default branch unless `worktree.baseRef: "head"` (settings only; can't name a branch) | /worktrees § Choose the base branch |
| A WorktreeCreate hook replaces worktree creation for every worktree in the session (not used here) | /hooks § WorktreeCreate |
| Marketplace: `.claude-plugin/marketplace.json` with `name`, `owner`, `plugins[{name, source:"./plugins/adlc"}]` | /plugins/marketplace-reference |
| Validation: `claude plugin validate [--strict] <path>` | plugins-reference |

**Not supported by the platform (documented limitations):**
- A plugin cannot ship permission rules (`permissions.allow/ask/deny`). We ship a
  template the user copies into `.claude/settings.json`.
- `permissionMode` in plugin agents is ignored; agents inherit the session mode.
- The documented value of `agent_type` in PreToolUse for plugin subagents is not
  specified. Role-based hook enforcement is implemented defensively (matches
  `adlc:<role>` and `<role>`) and verified empirically; tool allowlists in agent
  frontmatter are the primary role boundary.
- `bin/` prevents install on claude.ai / Cowork (Claude Code CLI/desktop only).
- `defer` only works with `-p`; not used.
- A plugin cannot set `worktree.baseRef`; worktree mode requires the user to
  set it in `.claude/settings.json` (template provided). Without it, `auto`
  never selects worktree mode.
- Bash-tool file writes by a worker cannot be attributed at write time; they
  are detected after the fact by `integrate check`.

## 3. Architecture

```
user ──/adlc:* skills──▶ main session (coordinator skill rules)
                              │  Agent tool (sequential by default)
             ┌────────┬───────┼────────┬────────┐
          analyst  architect developer tester  reviewer   (plugin subagents)
                              │
                  adlc CLI (bin/adlc, Node, zero deps)
                              │  atomic writes, revision check, lock
                     .agent-lifecycle/  (project state)
hooks: SessionStart(context) · PreToolUse(guard) · PostToolUse(audit log)
```

- **Coordinator** is a skill (`coordinator`, model-invocable, not user-invocable)
  loaded by every lifecycle skill, not a subagent: only the main session can
  prompt the user and own approval flow.
- **Deterministic logic lives in the CLI**: stage transitions, gate checks,
  dependency resolution, budget counters, artifact hashing. Skills call it via
  Bash (`adlc <subcommand>`). AI does judgment work; the CLI refuses illegal
  transitions.
- **Hooks** enforce boundaries the model cannot talk its way past.

## 4. Lifecycle state machine

Stages (in order): `discover → specify → plan → design → build → verify → review → release → done`.

Each stage has status: `pending | in_progress | completed | skipped | blocked`.

Rules (enforced by `adlc`):
1. A stage may start only when all prior stages are `completed` or `skipped`.
2. `skipped` requires a non-empty reason; recorded in `state.json` and
   `approvals.jsonl` as `{type:"skip"}`. `discover`, `specify`, `design`, and
   `release` are skippable; `plan`, `build`, `verify`, `review` are not (a small
   change still needs one task, evidence, and a review).
3. Gates (configurable via `userConfig.approval_gates`, default
   `plan,release`; an empty list disables gates but never platform prompts):
   - `plan` gate: required before `build` starts. Covers the SHA-256 of
     `requirements.md` + `plan.md` + `decisions.md` + the canonical JSON of
     the task list, the contracts, every build packet, and the execution
     plan (mode, waves, integration order). Adding a task, changing a
     packet, or changing the execution plan after approval makes the
     approval stale. This approval is what covers platform worktree
     creation in worktree mode (§6.7), since that path bypasses the Bash
     guard.
   - `release` gate: required before `release` stage is marked `completed`.
     Covers `release.md` + the latest review file.
   An approval is valid only if the recorded hash equals the current hash of
   the covered artifacts. Changed scope ⇒ stale approval ⇒ `adlc gate check`
   fails.
4. `--small` on start marks `discover`, `design` skipped with reason
   "small change" (user can override).
5. `blocked` is set when a budget limit is hit or a repair limit is exhausted;
   it carries `blocker` text. Cleared by `adlc unblock` (user-only skill path).

Tasks:
`{id, title, status: todo|dispatched|returned|integrated|blocked, deps:[ids], contracts:{provides:[C ids], consumes:[C ids]}, files:[globs], reads:[globs], resources:[tags], size: S|M|L, checks:[cmds], ac:[AC ids], attempts:int, max_attempts:int, timing:{dispatched_at, returned_at, integrated_at}}`.

A task is *ready* when every dep is `integrated` and every consumed contract's
providing task is `integrated`. `adlc task next` returns the first ready task
(sequential mode). Dispatch for parallel mode is specified in §6.7.
A task that becomes `blocked` marks all transitive dependents
`blocked` with `blocker: "prerequisite T<n> blocked"`; none are dispatched.

## 5. State format (`.agent-lifecycle/`, schema version 1)

| Path | VCS | Writer | Purpose |
|---|---|---|---|
| `state.json` | commit | CLI only | stage machine, tasks, budget counters, `revision` |
| `requirements.md` | commit | analyst / human | problem, users, constraints, success criteria, ACs `AC-1…`, traceability table |
| `plan.md` | commit | coordinator / human | affected files, task list mirror (human-readable) |
| `decisions.md` | commit | architect / human | ADR-style decision records `D-1…` |
| `approvals.jsonl` | commit | CLI only (append) | approvals, skips, approved risky actions |
| `packets/<T>.md` | commit | CLI `adlc packet render` from state | execution-ready build packet per task (§6.7) |
| `handoffs/<T>.json` | commit | worker (validated by CLI) | structured worker handoff (§6.7) |
| `test-results/<ts>-<stage>[-<T>].md` | commit | CLI `adlc run` only | command, cwd, exit code, duration, truncated redacted output |
| `reviews/<ts>.md` | commit | reviewer | findings: blocking vs optional |
| `handoff.md` | commit | coordinator (append) | per-session notes for resume |
| `release.md` | commit | coordinator | summary, migration, deploy, rollback |
| `.lock`, `.check.lock`, `tmp/`, `runs/` | ignore | CLI/hooks | state lock, check-run mutex, temp writes, audit log, agent bindings (`runs/bindings.json`), write log (`runs/writes.jsonl`) |

`adlc init` writes `.agent-lifecycle/.gitignore` containing `.lock`,
`.check.lock`, `tmp/`, `runs/`. In worktree mode the user's repo `.gitignore`
must also contain `.claude/worktrees/` (the readiness check verifies it).

**Single writer:** only the main session (coordinator / integration owner)
runs state-mutating `adlc` subcommands. Workers may run only `adlc worker
claim|handoff`, `adlc run`, and `adlc status`; the guard denies other `adlc`
subcommands from a bound worker. `worker claim` and `worker handoff` write
only `runs/bindings.json` and `handoffs/<T>.json` (never `state.json`), so
parallel workers do not contend for the state revision. Hooks write only
under `runs/`.

`state.json` shape (JSON Schema shipped at `schemas/state.schema.json`):

```json
{
  "schema": 1,
  "revision": 7,
  "change": {"id": "chg-20261113-slugify", "title": "Add slugify", "type": "feature", "created": "ISO"},
  "stage": "build",
  "stages": {"discover": {"status": "skipped", "reason": "small change"}, "...": {}},
  "contracts": [{"id": "C-1", "title": "slugify(input, opts) signature", "provided_by": "T1"}],
  "tasks": [{"id": "T1", "title": "...", "status": "integrated", "deps": [], "contracts": {"provides": ["C-1"], "consumes": []},
             "files": ["src/slugify.js"], "reads": [], "resources": [], "size": "S", "checks": ["node --test test/slugify.test.js"],
             "ac": ["AC-1"], "attempts": 1, "max_attempts": 3, "timing": {"dispatched_at": "ISO", "returned_at": "ISO", "integrated_at": "ISO"}}],
  "execution": {"mode": "sequential", "resolved_from": "auto", "max_parallel": 2, "waves": [["T1"], ["T2", "T3"]], "integration_order": ["T1", "T2", "T3"]},
  "leases": [{"task": "T2", "lease": "L-7f3a", "session": "sess-id", "agent_id": "a4d2…", "workspace": "/abs/path", "status": "active|returned|stopped|lost", "started": "ISO", "ended": null}],
  "metrics": {"retries": 0, "integration_failures": 0, "tokens": "not observable", "cost": "not observable"},
  "budget": {"max_repair_attempts": 3, "max_tasks_per_run": 5, "tasks_this_run": 2},
  "blocker": null,
  "updated": "ISO"
}
```

**Resilience:**
- Writes: read → mutate → check `revision` unchanged on disk → write `tmp/state.json.<pid>` → `fsync` → `rename`. Mismatch ⇒ exit 3 "state changed concurrently; re-run".
- Lock: `O_EXCL` create of `.lock` with pid + timestamp; stale after 10 min.
- Markdown: CLI never rewrites human-edited markdown. It only appends, or replaces content between `<!-- adlc:begin <key> -->` / `<!-- adlc:end <key> -->` markers.
- Unknown `schema` version ⇒ refuse with a clear message.

## 6. Components

### 6.1 Skills (`/adlc:<name>`)

| Skill | Invocation | Behavior |
|---|---|---|
| `start` | user | `adlc init` + `adlc start`; run Discover via analyst (unless `--small`) |
| `plan` | user | Specify (analyst) → Plan (coordinator inspects repo, writes tasks via `adlc task add`) → Design (architect); then asks the user to run `/adlc:approve plan` |
| `approve` | user only (`disable-model-invocation: true`) | `adlc approve <gate>`; records hash + actor `user` |
| `next` | user | `adlc next` → runs the stage it returns (build: dispatch per §6.7, then tester; verify; review; release) |
| `status` | user + model | `adlc status` rendered |
| `verify` | user | discovers commands, runs each through `adlc run` (which executes and records evidence) |
| `review` | user | reviewer subagent → `reviews/<ts>.md`; blocking findings ⇒ build reopens (counts toward repair limit) |
| `resume` | user | `adlc status --json` + `handoff.md` tail → summary + next step |
| `release` | user | writes `release.md`; requires release gate |
| `skip` | user only | `adlc skip <stage> <reason>` |
| `unblock` | user only | `adlc unblock <note>` |
| `coordinator` | model only (`user-invocable: false`) | shared orchestration rules, safety rules, budget rules, dispatch/integration procedure |
| `worker-contract` | model only (`user-invocable: false`) | preloaded into worker agents via agent `skills:`; the worker contract (§6.7) |

### 6.2 Agents (`agents/*.md`)

| Agent | tools | maxTurns | Notes |
|---|---|---|---|
| analyst | Read, Grep, Glob, Write, Edit | 20 | writes only `.agent-lifecycle/requirements.md` (hook-enforced where `agent_type` is available) |
| architect | Read, Grep, Glob, Write, Edit | 20 | writes only `.agent-lifecycle/decisions.md` |
| developer | Read, Grep, Glob, Write, Edit, Bash | 40 | one packet per invocation, in the main checkout (sequential / shared mode); `skills: [worker-contract]` |
| developer-worktree | same as developer | 40 | identical prompt, plus `isolation: worktree`; used only in worktree mode |
| tester | Read, Grep, Glob, Write, Edit, Bash | 30 | writes tests, runs them through `adlc run`; `skills: [worker-contract]` when dispatched as a worker |
| reviewer | Read, Grep, Glob, Bash | 20 | read-only; Bash for `git diff`/tests only; no Write/Edit |

No agent gets the `Agent` tool (no nesting). All prompts include the
untrusted-input rule.

### 6.3 CLI (`bin/adlc` → `lib/*.js`, Node ≥ 18, no dependencies)

Subcommands: `init`, `start <title> [--type] [--small]`, `status [--json]`,
`next`, `stage complete|start <stage>`, `skip <stage> <reason>`,
`task add|block|list|next` (sequential mode uses the same
`dispatch start` → `worker handoff` → `integrate check|done` path with
`max_parallel` 1, so one code path serves all modes), `approve <gate> [--note]`,
`gate check <gate>`, `run --stage <s> [--task <T>] [--exclusive] -- <cmd…>`
(executes the command itself, records exit code/duration/redacted output;
the only way evidence is created), `repair <taskId>` (increments attempts;
blocks at limit), `unblock <note>`, `handoff <text>`, `hash <gate>`,
`contract add`, `packet render [<T>]`, `exec plan` (compute mode + waves +
integration order), `dispatch check <T>`, `dispatch start <T>`,
`dispatch ready` (list dispatchable tasks now), `worker claim <T> --lease <L>`,
`worker handoff <T> --file <json>`, `integrate check <T>` (prints the exact
git commands for the coordinator to run), `integrate done <T>`,
`lease release|lost <L>`.

Exit codes: 0 ok, 1 usage, 2 rule violation (illegal transition / stale gate /
limit / readiness failure), 3 concurrent modification, 4 not initialised.

### 6.4 Hooks (`hooks/hooks.json` → `node "${CLAUDE_PLUGIN_ROOT}/hooks/<x>.js"`)

All hooks: exit 0 with no output unless `$CLAUDE_PROJECT_DIR/.agent-lifecycle/state.json` exists. Never emit `allow`.

- `session-start.js` (SessionStart): `additionalContext` with change id, stage, stage statuses, ready task ids, blocker flag, gate validity. Structured fields only, ≤2k chars.
- `guard.js` (PreToolUse, matcher `Bash|Write|Edit|NotebookEdit`):
  - `deny`: Write/Edit/NotebookEdit targeting `.agent-lifecycle/approvals.jsonl` or `.agent-lifecycle/state.json`; Bash commands that reference either file other than through the `adlc` CLI (redirects, `tee`, `sed -i`, `rm`, `mv`, `cp`).
  - `ask`: Bash running `adlc approve|skip|unblock` (see note below).
  - `deny`: edits that disable tests/checks (adding `.skip(`, `xit(`, `@pytest.mark.skip`, `--no-verify`, `|| true` after a test command) — reason explains; user can still do it themselves.
  - `ask`: `git commit|push|tag|reset --hard|clean`, `gh pr|release`, `npm|pnpm|yarn|pip|uv|cargo|go|brew install/add`, `curl|wget|ssh|scp`, `rm -rf`, `npm publish`, `docker push`, `kubectl|terraform apply`, deploy scripts. Reason names the exact command.
  - Role check: if `agent_type` matches `analyst|architect|reviewer` (bare or `adlc:`-prefixed) and the target path is outside that role's allowed file, `deny`.
  - Worker binding: on Bash `adlc worker claim <T> --lease <L>` from a subagent, record `agent_id → {task, lease, cwd}` in `runs/bindings.json`. For Write/Edit/NotebookEdit from a developer/tester subagent while `execution.mode` is `shared` or `worktree`: unbound ⇒ `deny` ("claim your task first"); bound and path outside the task's `files` (resolved against the bound workspace) ⇒ `deny`. Bound worker running git, or a state-mutating `adlc` subcommand ⇒ `deny`.
- `subagent-stop.js` (SubagentStop): if `agent_id` is bound, append `{agent_id, lease, ts, last_message_excerpt(redacted, 500 chars)}` to `runs/stops.jsonl`. The coordinator's `lease release` requires this record (or an explicit `lease lost` after inspection).
- `audit.js` (PostToolUse, matcher `Bash|Write|Edit|NotebookEdit`): Bash commands matching an `ask` pattern ⇒ `runs/audit.jsonl`; Write/Edit paths with `agent_id` ⇒ `runs/writes.jsonl` (used by `integrate check`).
  - Controlled by `userConfig.guard_level`: `strict` (default) | `standard` (ask only for push/publish/deploy/install/destructive). Never weaker than platform permissions, since the hook can only add `ask`/`deny`.

**Note on user-only actions:** `approve`, `skip`, `unblock` skills set
`disable-model-invocation: true`, so only the user can trigger them. Inside
such a skill the model runs `adlc approve`; the guard cannot tell user-
triggered from model-triggered Bash. Mitigation: the guard returns `ask` (not
`deny`) for `adlc approve|skip|unblock`, so the platform prompt shows the exact
command to the user every time. This is a documented workaround.

### 6.5 Secret redaction

`lib/redact.js`: masks values matching common token patterns (AWS keys,
`ghp_`, `sk-`, `xox[bp]-`, JWTs, `-----BEGIN … PRIVATE KEY-----`,
`password=`/`token=` assignments) in every evidence and audit write. Evidence
output truncated to 200 lines.

### 6.6 userConfig

| key | type | default |
|---|---|---|
| `approval_gates` | string | `plan,release` |
| `guard_level` | string, options `strict`/`standard` | `strict` |
| `max_repair_attempts` | number 1–10 | 3 |
| `max_tasks_per_run` | number 1–50 | 5 |
| `parallel_mode` | string, options `auto`/`worktree`/`shared`/`sequential` | `auto` |
| `max_parallel` | number 1–8 | 2 |
| `serial_globs` | string (comma-separated) | `package.json,*lock*,*.lock,go.mod,go.sum,Cargo.toml,pyproject.toml,requirements*.txt,Gemfile*,*.config.*,.github/**,migrations/**,**/generated/**` |

Hooks read `CLAUDE_PLUGIN_OPTION_*`. Skills receive values via
`${user_config.KEY}` substitution, which the skill passes to `adlc` as flags
when budget values are first written into `state.json` at `start`.

### 6.7 Parallel Build

**Assumption (user may correct):** the requirement refers to a "build packet
as specified above" that the original brief does not define. This spec
defines it as follows.

**Build packet** (`packets/<T>.md`, rendered from state, hash covered by the
plan gate): task id, goal, ACs covered, prerequisites (task + contract ids),
writable files (`files`), read-only context (`reads`), interfaces provided /
consumed (contract text from `decisions.md`), task-level checks (`checks`),
resource tags, size, max attempts, workspace instructions, done criteria,
handoff schema. A packet is *execution-ready* when every field is non-empty
or explicitly `none`, its checks are concrete commands, and every consumed
contract exists.

**Planning (Plan + Design stages):**
1. Coordinator/architect define shared contracts `C-n` in `decisions.md`.
   Tasks providing a contract are scheduled before all consumers.
2. Any task whose `files` match `serial_globs` is *serial*: it runs alone.
3. `adlc exec plan` computes waves: topological levels by deps/contracts,
   each level split so tasks in a wave have pairwise-disjoint `files`,
   disjoint `resources`, and no serial task shares a wave. Integration order
   = topological order, ties by task id.
4. Mode resolution for `auto`:
   - `worktree` if: git repo; working tree clean (except `.agent-lifecycle/`);
     project or local settings contain `"worktree": {"baseRef": "head"}`;
     `.claude/worktrees/` is git-ignored.
   - else `shared` if the binding probe (below) has confirmed `agent_id` is
     present in plugin-subagent PreToolUse input (`runs/probe.json`).
   - else `sequential`.
   The resolved mode and its reasons are written to `plan.md` and covered by
   the plan gate.
5. Throughput heuristic: run in parallel only when ≥2 dispatchable tasks have
   size M or L; tasks of size S, or flagged `coupled: true`, run
   sequentially. This is a heuristic, not a measured prediction.

**Readiness gate (`adlc dispatch check <T>`, deterministic, exit 2 on failure
with every failing reason):**
- plan gate approval is valid (hash matches, including this packet);
- packet is execution-ready;
- all deps and consumed contracts' providers are `integrated`;
- task has no lease with status `active`;
- `files` disjoint from every active lease's task `files`; not serial while
  any lease is active;
- `resources` disjoint from active leases;
- active leases < `max_parallel`;
- budget: `tasks_this_run < max_tasks_per_run`; change not `blocked`;
- mode preconditions still hold (worktree mode re-checks clean tree and
  baseRef setting).
On failure the coordinator runs the task sequentially after active work ends,
or returns to Plan to fix the packet. It never bypasses the gate.

**Dispatch (coordinator, rolling):** `adlc dispatch ready` lists tasks that
pass the gate now. For each, `adlc dispatch start <T>` creates lease
`L-<rand>` (records session id from `${CLAUDE_SESSION_ID}`), then the
coordinator launches `developer` (shared) or `developer-worktree` (worktree)
as a **background** subagent with the packet path and lease id as its prompt.
When any worker returns, the coordinator integrates it, then re-runs
`dispatch ready`. The CLI is the source of truth; a missed notification is
recovered by `status`/`resume`. Fallback when background agents are not
used: several Agent calls in one message per wave (foreground), integrating
after the wave.

**Worker contract (`worker-contract` skill):**
1. Run `adlc worker claim <T> --lease <L>`; read the packet; confirm scope,
   prerequisites, writable files. If anything is inconsistent, return
   status `blocked` without editing.
2. Edit only packet `files`. Never run git. Never edit `.agent-lifecycle/`
   except via `adlc worker handoff`.
3. Run each packet check via `adlc run --stage build --task <T> -- <cmd>`
   (in shared mode the CLI serializes these through `.check.lock`).
4. Write handoff JSON and submit with `adlc worker handoff <T> --file`:
   `{task, status: done|blocked|partial, workspace, branch|null,
   files_changed[], summary, checks:[{cmd, exit, evidence}],
   interface_changes[], blockers[], integration_notes, out_of_scope[]}`.
5. Out-of-scope problems go in `out_of_scope`; never fix another task's files.

**Integration (coordinator is the sole integration owner), in
`integration_order` as tasks return:**
1. `adlc integrate check <T>` validates: handoff schema; every claimed check
   has a matching evidence record with that exit code; changed files (from
   `git status` in the worktree, or `runs/writes.jsonl` by `agent_id` in
   shared mode) ⊆ task `files`; SubagentStop record present.
   In shared mode it also flags any changed file in the repo not covered by
   the union of active/returned tasks' `files` (catches Bash writes, which
   cannot be attributed at write time — known gap).
2. Worktree mode: it prints the exact commands (`git -C <wt> add <files>`,
   `git -C <wt> commit -m "adlc(<T>): …"`, `git merge --no-ff <branch>`);
   the coordinator runs them, each passing through the guard's `ask`.
   Shared mode: no git operations.
3. Run cross-task checks: the checks of every integrated task, via
   `adlc run --stage build`. Failure ⇒ `metrics.integration_failures++`,
   task `blocked`, dependents blocked, no further dependent dispatch.
4. `adlc integrate done <T>` marks the task `integrated` and releases the
   lease. Worktree cleanup (`git worktree remove`) is offered, approval-gated.
After the last task, the Verify stage runs the full suite. Worker-level
passes alone never complete Build.

**Interruption / resume:** on `resume`, leases with a different session id
are treated as possibly-running until inspected: the coordinator inspects
the workspace (worktree diff or `writes.jsonl`), then marks the lease `lost`
(task back to `todo`, attempts +1, its partial edits kept for review) or
integrates a valid handoff. A task is never re-dispatched while its lease is
`active`. Ownership moves only after `returned`, `stopped`, or `lost`.

**Binding probe (first step of shared-mode implementation; also runnable
as `adlc probe`):** a throwaway run under `claude -p --plugin-dir` that logs
one PreToolUse and one SubagentStop payload from a plugin subagent to
`runs/probe.json`, confirming `agent_id` presence and the exact `agent_type`
string. If `agent_id` is absent, `shared` mode is disabled (auto resolves to
worktree or sequential).

**Metrics:** per task `timing` from timestamps; `metrics.retries`,
`metrics.integration_failures`. Token usage and cost are recorded as
`"not observable"`. Rate limits are not observable; `max_parallel` is the
control.

## 7. Error handling & stopping conditions

- Repair loop: verify/review failure ⇒ `adlc repair <task>`; at
  `max_repair_attempts` the task and change become `blocked`, coordinator stops
  and reports the blocker with evidence paths.
- `max_tasks_per_run` reached ⇒ stop, write handoff, report.
- Any CLI exit 2/3/4 ⇒ coordinator stops and reports the message verbatim.
- Agents capped by `maxTurns`; partial output ⇒ handoff status `partial`,
  task returns to `todo` with attempts +1 after integration check.
- Prerequisite failure ⇒ dependents blocked; dispatch of dependents stops;
  unrelated active workers are allowed to finish and integrate.
- Worktree merge conflict ⇒ stop, mark `integration_failures++`, task
  blocked, report conflict files; no automatic conflict resolution.
- Claims of "passed" must reference an evidence file; coordinator rules forbid
  claims without one.

## 8. Repository layout

```
adlc-plugin/
├── .claude-plugin/marketplace.json
├── plugins/adlc/
│   ├── .claude-plugin/plugin.json
│   ├── bin/adlc
│   ├── lib/{cli,state,stages,tasks,gates,evidence,redact,fsutil,exec,dispatch,integrate,packets}.js
│   ├── hooks/{hooks.json,session-start.js,guard.js,audit.js,subagent-stop.js,common.js}
│   ├── skills/{start,plan,approve,next,status,verify,review,resume,release,skip,unblock,coordinator,worker-contract}/SKILL.md
│   ├── agents/{analyst,architect,developer,developer-worktree,tester,reviewer}.md
│   ├── templates/{requirements,plan,decisions,handoff,release,review,packet}.md
│   ├── schemas/{state,handoff}.schema.json
│   └── settings-template.json        (permissions to copy into .claude/settings.json)
├── tests/{state,stages,tasks,gates,redact,guard,session-start,cli,exec,dispatch,integrate}.test.js + fixtures/
├── examples/slugify/                 (end-to-end transcript + resulting .agent-lifecycle/)
├── docs/superpowers/specs/…
├── README.md
└── package.json                      (scripts: test → node --test; no deps)
```

## 9. Testing

- `node --test tests/` — unit tests for the state machine (every legal and
  illegal transition), gate hash invalidation, dependency resolution, parallel
  disjointness, repair limit, atomic write + revision conflict, redaction.
- Hook tests: spawn each hook with JSON fixtures on stdin and
  `CLAUDE_PROJECT_DIR` set to a temp dir; assert stdout JSON and exit code;
  assert silence when no `.agent-lifecycle/`.
- `claude plugin validate --strict plugins/adlc` and `claude plugin validate .`
  (marketplace).
- End-to-end: scratch git repo in a temp dir; drive the CLI through a full
  `slugify` change (start → plan → approve → build → verify with a real
  `node --test` → review → release); script committed as
  `examples/slugify/run.sh`; produced artifacts committed under
  `examples/slugify/.agent-lifecycle/`.
- Parallel logic tests: wave computation (deps, contracts, file overlap,
  resources, serial globs, max_parallel), every readiness-gate failure
  reason, lease lifecycle (no duplicate dispatch, reassignment only after
  stop/lost), dependent blocking, mode resolution for `auto`, handoff schema
  validation, `integrate check` ownership violations, guard worker-binding
  decisions (unbound deny, out-of-scope deny, git deny).
- Worktree integration test: scratch git repo, two disjoint tasks, simulated
  worker edits in real `git worktree`s, `integrate check` + merge in order,
  cross-task check run.
- Live check: `claude -p --plugin-dir plugins/adlc` smoke run of
  `/adlc:status` and the binding probe if non-interactive auth is available;
  otherwise listed as unverified.

Implementation slices: (1) sequential end-to-end with packets + handoffs +
`adlc run`; (2) binding probe, then shared-checkout parallel; (3) worktree
mode. Each slice ends green before the next starts.

## 10. Out of scope (v1)

Blocking Stop hooks, MCP servers, workflow scripts, multi-change concurrency
(one active change per repo), CI integration, Windows-specific testing.
