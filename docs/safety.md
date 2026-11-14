# Safety model

adlc adds guard rails around the agents. It is not a sandbox. Read the limits at the end before you rely on it.

- **Untrusted input.** Agent prompts and coordinator rules treat repository files, tool output and subagent reports as data. The SessionStart hook injects only structured, sanitised fields.
- **Approvals.**
  - Gate approvals hash the covered artifacts, so changing scope makes an approval stale. The release approval also covers the code (a git tree id of the working tree), so a file changed after approval makes it stale; committing unchanged content does not.
  - Approve, skip and unblock skills use `disable-model-invocation: true`, so only you can start them.
  - The CLI refuses `adlc approve`, `skip`, `unblock` and `archive` unless you typed the matching slash command yourself. A `UserPromptSubmit` hook records each of your slash commands as a single-use intent that expires after 15 minutes; a command the model runs on its own, or after you only asked in prose, is refused. There is no terminal shortcut: at a terminal, type the slash command in Claude Code too. The guard denies such commands early with the same explanation. Intents live in `.agent-lifecycle/runs/`, which hooks and the guard protect.
  - An approval intent stores the gate hash from the moment you typed `/adlc:approve`. If a covered file changes before the approval is recorded, the CLI refuses and you approve again.
  - A refused action does not use up your prompt.
  - `adlc start` with fewer gates than `plan,release` needs your own `/adlc:start` (the gates come from your prompt or your plugin setting).
- **Least privilege.**
  - Each agent has a tool allowlist; the reviewer has no Write or Edit, and no adlc subagent may write files through the shell.
  - Hooks deny the analyst and architect writes outside their file.
  - A worker that has claimed a task may write only that task's files, and may not run git or state-changing `adlc` commands.
- **Honesty.**
  - Evidence comes only from executed commands.
  - Verify completes only when every task check from the approved plan has passed in that stage.
  - Review findings are counted from the reviewer's report, not reported by the coordinator.
  - A lease can be confirmed stopped only with the worker's handoff; the task budget resets only in a session the hooks recorded.
  - `integrate check` rejects claimed checks without matching evidence, and changed files outside the task.
  - Edits that add `.skip`/`.only`, and `--no-verify` or `|| true` after checks, are denied.
- **Run limits.**
  - Per-task repair attempts, a per-run task budget and agent `maxTurns`.
  - Hitting a limit blocks the change and the coordinator stops.
- **Secrets.** Evidence, audit logs, review files and handoff notes pass through redaction (common token formats and `password=`/`token=` assignments). Redaction is best-effort: keep secrets out of command output.

## Limits

What adlc does **not** protect against:

- **Shell commands are guarded by pattern matching, which is best-effort.** A script, a variable or other indirection can get past the Bash guard. File-tool writes, role write scopes and the CLI's rules are enforced reliably; shell commands are not. adlc is not a sandbox: run it only in repositories and on machines where you would let Claude Code run commands.
- **Hooks never return `allow`.** Claude Code's own permission prompts always apply, and your allow rules decide what runs without a prompt.
- **The reviewer's report is trusted.** The coordinator passes the reviewer's report to the CLI, and the CLI counts its findings; it cannot check that the review was thorough.
- **Outside git, the release approval does not cover your code**, only the lifecycle files.
- **The Grep folder check needs git.** Outside a repository it does not look for secret files.
- **Secret redaction is best-effort.** Keep secrets out of command output.
- **One active change per repository**, and no Windows support (WSL is untested).

The detailed record of what is implemented, tested and live-tested is in [capabilities.md](capabilities.md).
