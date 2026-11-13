---
description: Start a new adlc change (feature or bug fix) and run the Discover stage. Use when the user wants to begin tracked work on a feature or bug.
argument-hint: "\"<title>\" [--type feature|bugfix] [--small]"
---

Read `${CLAUDE_PLUGIN_ROOT}/skills/coordinator/SKILL.md` first and follow it throughout.

1. Start the change (the configuration values come from the plugin's settings):

   ```
   adlc start $ARGUMENTS --approval-gates "${user_config.approval_gates}" --parallel-mode "${user_config.parallel_mode}" --max-parallel "${user_config.max_parallel}" --max-repair-attempts "${user_config.max_repair_attempts}" --max-tasks-per-run "${user_config.max_tasks_per_run}" --serial-globs "${user_config.serial_globs}"
   ```

   If it exits 2 because a change already exists, show `adlc status` and stop.
2. If the next stage is `discover`: run `adlc stage start discover`, then delegate to the `adlc:analyst` subagent:
   "Discover stage for change <id>: <title>. Clarify the problem, users, constraints and success criteria. Read the repository as needed. Write the Problem, Users, Constraints and Success criteria sections of .agent-lifecycle/requirements.md. End your reply with at most five open questions that block specification."
3. Show the user the analyst's summary and open questions. Ask only the questions that block. Record the answers in requirements.md.
4. `adlc stage complete discover`.
5. Tell the user the next step is `/adlc:plan`. With `--small`, discover and design were skipped and recorded; say so.
