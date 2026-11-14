---
description: Run the adlc Review stage - an independent review of the change against requirements, security and maintainability - and record findings. Use after verify or when the user asks for a review.
---

Load the `adlc:coordinator` skill with the Skill tool first and follow it. If the Skill tool cannot load it, read `${CLAUDE_PLUGIN_ROOT}/skills/coordinator/SKILL.md` instead.

Runtime values for this session (substituted by Claude Code when this skill loads; the coordinator rules refer to them):
- CLI fallback if `adlc` is not on PATH: `node "${CLAUDE_PLUGIN_ROOT}/bin/adlc"`
- Session id for `adlc dispatch start --session`: `${CLAUDE_SESSION_ID}`

1. `adlc stage start review`.
2. Collect the changed files (`git status --short` and `git diff --stat`), and paths to requirements.md, decisions.md, packets/ and test-results/.
3. Delegate to `adlc:reviewer`: "Review change <id> independently. Requirements: .agent-lifecycle/requirements.md. Decisions: .agent-lifecycle/decisions.md. Packets: .agent-lifecycle/packets/. Evidence: .agent-lifecycle/test-results/. Changed files: <list>. Use the report format in your instructions. Separate blocking findings (correctness, security, requirement gaps, missing or weakened tests) from optional improvements, each with file:line and reasoning."
4. Save the reviewer's report unchanged to `.agent-lifecycle/tmp/review.md`. Do not soften or drop findings. Run `adlc review add --file .agent-lifecycle/tmp/review.md`. The CLI counts the `[B<n>]` and `[O<n>]` findings in the report itself. If it cannot count them, ask the reviewer for a report in the template format; do not rewrite the report yourself.
5. If there are blocking findings: show them. If the user disputes one, let the user decide. For each accepted finding, run `adlc task repair <T> "<finding>"` on the responsible task (this reopens build), then stop. Otherwise run `adlc stage complete review`.
