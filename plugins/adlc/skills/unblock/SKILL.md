---
description: Clear an adlc blocker (for example a task that reached its repair limit) after the user decides how to proceed. Only the user can invoke this.
argument-hint: "<note> [--task T]"
disable-model-invocation: true
---

The user asked to unblock: $ARGUMENTS

1. Run `adlc status` and show the blocker and the blocked tasks with their last failures.
2. Run `adlc unblock "<note>"`, adding `--task <T>` when the user named a task (this resets its attempts and the tasks blocked behind it). The CLI accepts it only because the user's own `/adlc:unblock` prompt was recorded; if it refuses, tell the user to type the command themselves.
3. Report the new status and suggest `/adlc:next`.
