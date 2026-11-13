---
description: Run the next approved adlc stage (build, verify, review or release) for the active change. Use when the user asks to continue or run the next stage.
---

Read `${CLAUDE_PLUGIN_ROOT}/skills/coordinator/SKILL.md` first and follow it.

1. Run `adlc next --json`.
   - `blocked`: report the blocker and stop.
   - `done`: report that the change is complete and suggest `adlc archive` when the user is ready.
   - `start` with `problems` (for example a plan gate that is not approved): report them and stop.
2. By stage:
   - `discover`, `specify`, `plan`, `design`: follow `${CLAUDE_PLUGIN_ROOT}/skills/start/SKILL.md` or `${CLAUDE_PLUGIN_ROOT}/skills/plan/SKILL.md`.
   - `build`: `adlc stage start build` if needed, then the Build procedure in the coordinator rules, then `adlc stage complete build`.
   - `verify`: follow `${CLAUDE_PLUGIN_ROOT}/skills/verify/SKILL.md`.
   - `review`: follow `${CLAUDE_PLUGIN_ROOT}/skills/review/SKILL.md`.
   - `release`: follow `${CLAUDE_PLUGIN_ROOT}/skills/release/SKILL.md`.
3. Finish with `adlc status` and a short report: what ran, evidence files, what is next, anything not verified.
