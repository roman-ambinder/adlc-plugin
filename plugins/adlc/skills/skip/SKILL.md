---
description: Skip an adlc stage (discover, specify, design or release) with a recorded reason. Only the user can invoke this.
argument-hint: "<stage> <reason>"
disable-model-invocation: true
---

The user asked to skip: $ARGUMENTS

1. The first word is the stage and the rest is the reason. If the reason is missing, ask for it and stop.
2. Run `adlc skip <stage> "<reason>"`. A permission prompt shows the exact command.
3. Report the result. Plan, build, verify and review cannot be skipped; if the CLI refuses, explain that.
