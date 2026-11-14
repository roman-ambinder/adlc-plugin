# Security policy

## Reporting a problem

Please report security problems **privately**, not in a public issue:

**https://github.com/roman-ambinder/adlc-plugin/security/advisories/new**

Include what you did, what happened, and the Claude Code, Node and adlc versions. You should get a first reply within a week.

## What counts

- A way for an agent to get past a guard that adlc says it enforces reliably: file-tool writes outside a role's or task's scope, edits to the files the CLI owns under `.agent-lifecycle/`, or reading secret files with the Read or Grep tool.
- A way to record an approval, skip, unblock, archive or cancel that the user did not type.
- Faked evidence: a check recorded as passing that did not pass.
- Secrets leaking into evidence, audit logs, reviews or handoff notes in a common token format that redaction should catch.

## What does not count

adlc is not a sandbox. Its guarding of shell commands is pattern-based and best-effort: a script, a variable or other indirection can get past it. Reports that only show this are known limits, not vulnerabilities. The full list of known limits is in [docs/safety.md](docs/safety.md#limits). A new bypass that is easy to fix is still welcome as a regular issue.

## Supported versions

Only the latest release gets fixes.
