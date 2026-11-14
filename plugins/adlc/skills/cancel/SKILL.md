---
description: Cancel the active adlc change with a reason - end active worker leases, record why, and archive it so a new change can start. Only the user can invoke this.
argument-hint: "<reason>"
disable-model-invocation: true
---

The user asked to cancel the active change: $ARGUMENTS

1. If the reason is missing, ask for it and stop.
2. Run `adlc status` and show the change, its stage and any active workers. If workers are still running, tell the user they will be treated as lost; wait for them to return first if the user prefers.
3. Run `adlc cancel "<reason>"`. The CLI accepts it only because the user's own `/adlc:cancel` prompt was recorded (one prompt authorises one command). If it refuses, tell the user to type the command themselves.
4. Report where the change was archived and any worktrees it lists. Code changes already in the working tree stay as they are: tell the user to review them (`git status`) and keep or discard them themselves. The lifecycle hooks are inactive until the next `/adlc:start`.
