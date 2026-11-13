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
| Subagents nest up to 3 levels; `isolation: worktree` branches from the default branch, not HEAD | /sub-agents |
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
     the task list (ids, titles, deps, files, ac). Adding a task or changing
     a task's declared files after approval makes the approval stale.
   - `release` gate: required before `release` stage is marked `completed`.
     Covers `release.md` + the latest review file.
   An approval is valid only if the recorded hash equals the current hash of
   the covered artifacts. Changed scope ⇒ stale approval ⇒ `adlc gate check`
   fails.
4. `--small` on start marks `discover`, `design` skipped with reason
   "small change" (user can override).
5. `blocked` is set when a budget limit is hit or a repair limit is exhausted;
   it carries `blocker` text. Cleared by `adlc unblock` (user-only skill path).

Tasks: `{id, title, status: todo|in_progress|done|blocked, deps:[ids], files:[globs], ac:[AC ids], attempts:int}`.
`adlc task next` returns the first `todo` task whose deps are all `done`.
Parallel candidates = ready tasks whose `files` sets are pairwise disjoint;
returned only when `userConfig.parallel` is true.

## 5. State format (`.agent-lifecycle/`, schema version 1)

| Path | VCS | Writer | Purpose |
|---|---|---|---|
| `state.json` | commit | CLI only | stage machine, tasks, budget counters, `revision` |
| `requirements.md` | commit | analyst / human | problem, users, constraints, success criteria, ACs `AC-1…`, traceability table |
| `plan.md` | commit | coordinator / human | affected files, task list mirror (human-readable) |
| `decisions.md` | commit | architect / human | ADR-style decision records `D-1…` |
| `approvals.jsonl` | commit | CLI only (append) | approvals, skips, approved risky actions |
| `test-results/<ts>-<stage>.md` | commit | CLI `adlc evidence` | command, exit code, truncated redacted output |
| `reviews/<ts>.md` | commit | reviewer | findings: blocking vs optional |
| `handoff.md` | commit | coordinator (append) | per-session notes for resume |
| `release.md` | commit | coordinator | summary, migration, deploy, rollback |
| `.lock`, `tmp/`, `runs/` | ignore | CLI/hooks | lock, temp writes, raw audit logs |

`adlc init` writes `.agent-lifecycle/.gitignore` containing `.lock`, `tmp/`, `runs/`.

`state.json` shape (JSON Schema shipped at `schemas/state.schema.json`):

```json
{
  "schema": 1,
  "revision": 7,
  "change": {"id": "chg-20261113-slugify", "title": "Add slugify", "type": "feature", "created": "ISO"},
  "stage": "build",
  "stages": {"discover": {"status": "skipped", "reason": "small change"}, "...": {}},
  "tasks": [{"id": "T1", "title": "...", "status": "done", "deps": [], "files": ["src/slugify.js"], "ac": ["AC-1"], "attempts": 1}],
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
| `next` | user | `adlc next` → runs the stage it returns (build: developer per task, then tester; verify; review; release) |
| `status` | user + model | `adlc status` rendered |
| `verify` | user | discovers commands, runs each, records evidence via `adlc evidence` |
| `review` | user | reviewer subagent → `reviews/<ts>.md`; blocking findings ⇒ build reopens (counts toward repair limit) |
| `resume` | user | `adlc status --json` + `handoff.md` tail → summary + next step |
| `release` | user | writes `release.md`; requires release gate |
| `skip` | user only | `adlc skip <stage> <reason>` |
| `unblock` | user only | `adlc unblock <note>` |
| `coordinator` | model only (`user-invocable: false`) | shared orchestration rules, safety rules, budget rules |

### 6.2 Agents (`agents/*.md`)

| Agent | tools | maxTurns | Notes |
|---|---|---|---|
| analyst | Read, Grep, Glob, Write, Edit | 20 | writes only `.agent-lifecycle/requirements.md` (hook-enforced where `agent_type` is available) |
| architect | Read, Grep, Glob, Write, Edit | 20 | writes only `.agent-lifecycle/decisions.md` |
| developer | Read, Grep, Glob, Write, Edit, Bash | 40 | one task per invocation; only that task's `files` |
| tester | Read, Grep, Glob, Write, Edit, Bash | 30 | writes tests, runs them, records evidence |
| reviewer | Read, Grep, Glob, Bash | 20 | read-only; Bash for `git diff`/tests only; no Write/Edit |

No agent gets the `Agent` tool (no nesting). All prompts include the
untrusted-input rule.

### 6.3 CLI (`bin/adlc` → `lib/*.js`, Node ≥ 18, no dependencies)

Subcommands: `init`, `start <title> [--type] [--small]`, `status [--json]`,
`next`, `stage complete|start <stage>`, `skip <stage> <reason>`,
`task add|start|done|block|list|next`, `approve <gate> [--note]`,
`gate check <gate>`, `evidence --stage <s> --cmd <c> --exit <n> --output-file <f>`,
`repair <taskId>` (increments attempts; blocks at limit), `unblock <note>`,
`handoff <text>`, `hash <gate>`.

Exit codes: 0 ok, 1 usage, 2 rule violation (illegal transition / stale gate /
limit), 3 concurrent modification, 4 not initialised.

### 6.4 Hooks (`hooks/hooks.json` → `node "${CLAUDE_PLUGIN_ROOT}/hooks/<x>.js"`)

All hooks: exit 0 with no output unless `$CLAUDE_PROJECT_DIR/.agent-lifecycle/state.json` exists. Never emit `allow`.

- `session-start.js` (SessionStart): `additionalContext` with change id, stage, stage statuses, ready task ids, blocker flag, gate validity. Structured fields only, ≤2k chars.
- `guard.js` (PreToolUse, matcher `Bash|Write|Edit|NotebookEdit`):
  - `deny`: Write/Edit/NotebookEdit targeting `.agent-lifecycle/approvals.jsonl` or `.agent-lifecycle/state.json`; Bash commands that reference either file other than through the `adlc` CLI (redirects, `tee`, `sed -i`, `rm`, `mv`, `cp`).
  - `ask`: Bash running `adlc approve|skip|unblock` (see note below).
  - `deny`: edits that disable tests/checks (adding `.skip(`, `xit(`, `@pytest.mark.skip`, `--no-verify`, `|| true` after a test command) — reason explains; user can still do it themselves.
  - `ask`: `git commit|push|tag|reset --hard|clean`, `gh pr|release`, `npm|pnpm|yarn|pip|uv|cargo|go|brew install/add`, `curl|wget|ssh|scp`, `rm -rf`, `npm publish`, `docker push`, `kubectl|terraform apply`, deploy scripts. Reason names the exact command.
  - Role check: if `agent_type` matches `analyst|architect|reviewer` and the target path is outside that role's allowed file, `deny`.
  - Controlled by `userConfig.guard_level`: `strict` (default) | `standard` (ask only for push/publish/deploy/install/destructive). Never weaker than platform permissions, since the hook can only add `ask`/`deny`.
- `audit.js` (PostToolUse, matcher `Bash`): when a command matched an `ask` pattern and ran, append `{type:"action", cmd(redacted), ts}` to `runs/audit.jsonl`.

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
| `parallel` | boolean | false |

Hooks read `CLAUDE_PLUGIN_OPTION_*`. Skills receive values via
`${user_config.KEY}` substitution, which the skill passes to `adlc` as flags
when budget values are first written into `state.json` at `start`.

## 7. Error handling & stopping conditions

- Repair loop: verify/review failure ⇒ `adlc repair <task>`; at
  `max_repair_attempts` the task and change become `blocked`, coordinator stops
  and reports the blocker with evidence paths.
- `max_tasks_per_run` reached ⇒ stop, write handoff, report.
- Any CLI exit 2/3/4 ⇒ coordinator stops and reports the message verbatim.
- Agents capped by `maxTurns`; partial output ⇒ task stays `in_progress`,
  handoff written.
- Claims of "passed" must reference an evidence file; coordinator rules forbid
  claims without one.

## 8. Repository layout

```
adlc-plugin/
├── .claude-plugin/marketplace.json
├── plugins/adlc/
│   ├── .claude-plugin/plugin.json
│   ├── bin/adlc
│   ├── lib/{cli,state,stages,tasks,gates,evidence,redact,fsutil}.js
│   ├── hooks/{hooks.json,session-start.js,guard.js,audit.js,common.js}
│   ├── skills/{start,plan,approve,next,status,verify,review,resume,release,skip,unblock,coordinator}/SKILL.md
│   ├── agents/{analyst,architect,developer,tester,reviewer}.md
│   ├── templates/{requirements,plan,decisions,handoff,release,review}.md
│   ├── schemas/state.schema.json
│   └── settings-template.json        (permissions to copy into .claude/settings.json)
├── tests/{state,stages,tasks,gates,redact,guard,session-start,cli}.test.js + fixtures/
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
- Live check: one `claude -p --plugin-dir plugins/adlc` smoke run of
  `/adlc:status` if non-interactive auth is available; otherwise listed as
  unverified.

## 10. Out of scope (v1)

Blocking Stop hooks, MCP servers, workflow scripts, multi-change concurrency
(one active change per repo), CI integration, Windows-specific testing.
