---
description: Prepare the adlc release summary - changes, acceptance criteria status, migration, deployment and rollback steps - and complete the Release stage after approval. Use when review is complete.
---

Read `${CLAUDE_PLUGIN_ROOT}/skills/coordinator/SKILL.md` first and follow it.

Runtime values for this session (substituted by Claude Code when this skill loads; the coordinator rules refer to them):
- CLI fallback if `adlc` is not on PATH: `node "${CLAUDE_PLUGIN_ROOT}/bin/adlc"`
- Session id for `adlc dispatch start --session`: `${CLAUDE_SESSION_ID}`

1. `adlc stage start release` (if it is not already in progress).
2. `adlc trace` writes `.agent-lifecycle/traceability.md`. If any criterion has no evidence, stop and report it.
3. Run `adlc summary` and copy its output, unchanged, under "Delivery summary" in release.md. Fill `.agent-lifecycle/release.md`: Summary of changes; Acceptance criteria status (refer to traceability.md); Migration; Deployment steps; Rollback steps; Known issues and unverified claims. Write "None." where a section does not apply. Take deployment steps only from the repository's own scripts and docs; if there are none, write "No deployment process found in the repository." Never invent steps.
4. If `adlc gate check release` is not ok, ask the user to review release.md and run `/adlc:approve release`, then stop. The approval also covers the code as it is now: any later change to a project file makes it stale (committing the same content does not).
5. Once approved: `adlc stage complete release`.
6. Do not commit, tag, push, open pull requests, publish or deploy unless the user asks. Each of these needs the user's approval of the exact command.
