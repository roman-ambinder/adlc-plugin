---
description: Record the user's approval of an adlc gate (plan or release). Only the user can invoke this.
argument-hint: "plan|release [note]"
disable-model-invocation: true
---

The user is approving: $ARGUMENTS

1. Take the gate name (`plan` or `release`) from the first word and the optional note from the rest.
2. Run `adlc gate check <gate>` and `adlc status`. Show the user what this approval covers:
   - plan: requirements.md, plan.md, decisions.md, every task, contract and build packet, and the execution plan;
   - release: release.md, traceability.md and the latest review.
3. Run `adlc approve <gate> --note "<note, or 'approved via /adlc:approve'>"`. A permission prompt shows the exact command; the user's confirmation there is the approval.
4. Report the recorded hash. If any covered file changes later, the approval becomes stale and must be given again. Suggest `/adlc:next`.
