---
description: Run the next approved adlc stage (build, verify, review or release) for the active change. Use when the user asks to continue or run the next stage.
---

Load the `adlc:coordinator` skill with the Skill tool first and follow it. If the Skill tool cannot load it, read `${CLAUDE_PLUGIN_ROOT}/skills/coordinator/SKILL.md` instead.

Runtime values for this session (substituted by Claude Code when this skill loads; the coordinator rules refer to them):
- CLI fallback if `adlc` is not on PATH: `node "${CLAUDE_PLUGIN_ROOT}/bin/adlc"`
- Session id for `adlc dispatch start --session`: `${CLAUDE_SESSION_ID}`

1. Run `adlc next --json`.
   - `blocked`: report the blocker and stop.
   - `done`: report that the change is complete and suggest `/adlc:archive` when the user is ready (only the user can archive).
   - `start` with `problems` (for example a plan gate that is not approved): report them and stop.
2. By stage:
   - `discover`, `specify`, `plan`, `design`: follow the `adlc:start` or `adlc:plan` skill (load it with the Skill tool).
   - `build`: `adlc stage start build` if needed, then the Build procedure in the coordinator rules, then `adlc stage complete build`.
   - `verify`: follow the `adlc:verify` skill (load it with the Skill tool).
   - `review`: follow the `adlc:review` skill (load it with the Skill tool).
   - `release`: follow the `adlc:release` skill (load it with the Skill tool).
3. Finish with `adlc status` and a short report: what ran, evidence files, what is next, anything not verified.
