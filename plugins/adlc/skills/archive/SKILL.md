---
description: Archive the active adlc change so a new one can start. Only the user can invoke this.
argument-hint: "[--force]"
disable-model-invocation: true
---

The user asked to archive the active change: $ARGUMENTS

1. Run `adlc status` and show the change and its stage.
2. Run `adlc archive`, adding `--force` only if the user typed `--force` (it archives a change that is not done). The CLI accepts it only because the user's own `/adlc:archive` prompt was recorded (one prompt authorises one command). If it refuses because the change is not done, say so and stop; do not add `--force` yourself.
3. Report where the files went (`.agent-lifecycle/archive/<change id>/`). The lifecycle hooks are inactive until the next `/adlc:start`.
