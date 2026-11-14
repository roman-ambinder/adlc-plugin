# Troubleshooting

| Symptom | Fix |
|---|---|
| `adlc: command not found` in Bash | The plugin must be enabled. Skills fall back to `node "${CLAUDE_PLUGIN_ROOT}/bin/adlc"`; you can run `node plugins/adlc/bin/adlc` from a checkout |
| `the user has not asked for this` | Type the slash command yourself (`/adlc:approve plan`, `/adlc:archive`, …). Scripts must submit the prompt to the `UserPromptSubmit` hook first, as `examples/slugify/run.sh` does |
| `no active change` (exit 4) | Run `/adlc:start` first. The CLI finds `.agent-lifecycle/` by walking up from the current directory, or uses `ADLC_ROOT` |
| `plan gate not approved` / `approval is stale` | Review the files, then run `/adlc:approve plan` again. Any edit to the covered files (requirements, plan, decisions) or to the tasks, contracts or execution plan after approval needs a new approval. Packets are rendered from the tasks, so they are covered through them; a hand edit to a packet is overwritten at the next dispatch |
| `state.json does not match schemas/state.schema.json` | The file was edited by hand or damaged. Restore it from version control (`git checkout -- .agent-lifecycle/state.json`) |
| `state changed concurrently` (exit 3) | Another adlc process wrote state. Re-run the command |
| `no SubagentStop record for L-…` | The worker may still be running. Once it has returned, inspect its changes and run `adlc lease stopped <L> "<note>"` |
| `approved task check … has not been run in this verify stage` | Run it with `adlc run --stage verify -- "<check>"`, using the exact text from the plan |
| `cannot count the findings` | The review report must keep the template headings, with `- [B<n>]` items or "None." under Blocking findings |
| `release approval is stale` right after approving | A project file changed after you approved. Review it and run `/adlc:approve release` again |
| Task blocked after repeated failures | Read its evidence and handoff, decide the approach, then `/adlc:unblock "<note>" --task T<n>` |
| Hooks seem inactive | Hooks act when `.agent-lifecycle/state.json` exists in the project directory or a parent of it (the same lookup as the CLI). Check `/plugin` → Errors, and `claude --debug` |
| Need to see what hooks receive | Start Claude Code with `ADLC_HOOK_LOG=/tmp/adlc-hooks.jsonl` to log hook metadata (never tool input) |
| Too many permission prompts | Run `/adlc:setup` (or copy `plugins/adlc/settings-template.json` entries into `.claude/settings.json` by hand). Guard `ask` prompts for risky commands remain by design |
| Project permissions seem ignored (`Ignoring … permissions.allow entries … this workspace has not been trusted`) | Claude Code ignores a project's `.claude/settings.json` permissions until you trust the folder. Open Claude Code in the project and accept the trust dialog once |
| `adlc` commands still ask for permission after `/adlc:setup` | Start a new session so Claude Code reloads the settings. `adlc approve`, `skip`, `unblock`, `archive`, `cancel`, `lease` and `setup` always ask, by design |
| `claude plugin install` says `userConfig options not yet set` | Nothing is wrong: the defaults apply. Set options only if you want to change them (see [configuration.md](configuration.md)) |
| A plugin update does nothing | `claude plugin update` only moves to a new version number. Run `claude plugin marketplace update adlc-marketplace` first, then update and start a new session |

