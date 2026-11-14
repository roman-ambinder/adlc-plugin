---
description: Run the adlc Specify, Plan and Design stages and prepare the plan for the user's approval. Use after /adlc:start, or when the user asks to produce a plan for the active change.
---

Load the `adlc:coordinator` skill with the Skill tool first and follow it. If the Skill tool cannot load it, read `${CLAUDE_PLUGIN_ROOT}/skills/coordinator/SKILL.md` instead. Check `adlc next` before each step and skip steps for stages that are already completed or skipped.

Runtime values for this session (substituted by Claude Code when this skill loads; the coordinator rules refer to them):
- CLI fallback if `adlc` is not on PATH: `node "${CLAUDE_PLUGIN_ROOT}/bin/adlc"`
- Session id for `adlc dispatch start --session`: `${CLAUDE_SESSION_ID}`

1. **Specify.** `adlc stage start specify`. Delegate to `adlc:analyst`: "Write measurable acceptance criteria for change <id> under '## Acceptance criteria' in .agent-lifecycle/requirements.md, one per line as `- AC-<n>: <observable behaviour>; verified by <command or check>`." Then `adlc stage complete specify` (it fails if there are no criteria).
2. **Plan.** `adlc stage start plan`. Inspect the repository yourself: language, build, test, lint, format, type-check and security-check commands (package.json scripts, Makefile, pyproject.toml, CI config), conventions and the files the change affects. Write Context, Affected files and Risks in `.agent-lifecycle/plan.md`, outside the `adlc:begin/end` markers.
   - Split the work into small tasks, each one reviewable change. Write them as a JSON array to `.agent-lifecycle/tmp/tasks.json`. Fields: `title`, `goal`, `files` (explicit paths the task may write; avoid globs), `reads`, `deps` (task ids), `ac` (AC ids), `checks` (exact commands that prove the task, e.g. `node --test test/x.test.js`), `size` (`S`/`M`/`L`), `resources` (e.g. `"port:3000"`), `coupled` (true if it must run alone).
   - Add tasks that provide shared interfaces first. Register each shared interface with `adlc contract add --file <json>` (`{"title", "spec", "provided_by"}`), then add consumer tasks with `"contracts": {"consumes": ["C-1"]}`.
   - `adlc task add --file .agent-lifecycle/tmp/tasks.json`. Change a todo task with `adlc task update <T> --file <json>`.
   - `adlc exec plan`, then `adlc stage complete plan`. If it lists problems (uncovered criteria, incomplete packets), fix them and retry.
3. **Design** (unless skipped). `adlc stage start design`. Delegate to `adlc:architect`: "Review requirements.md, plan.md and .agent-lifecycle/packets/ for change <id>. Record decisions as D-n and shared contracts as C-n in .agent-lifecycle/decisions.md. Report risks and any task changes needed." Apply the task changes, re-run `adlc exec plan`, then `adlc stage complete design`.
4. Show the user: acceptance criteria, tasks with files and checks, waves and execution mode with reasons, contracts, risks. Ask them to review the files in `.agent-lifecycle/` and run `/adlc:approve plan`. Stop here.
