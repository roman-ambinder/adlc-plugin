---
description: Set up this project for adlc. Adds the recommended permissions to .claude/settings.json and .claude/worktrees/ to .gitignore, after showing what will change. Only the user can invoke this.
disable-model-invocation: true
---

The user asked to set up this project for adlc.

CLI fallback if `adlc` is not on PATH: `node "${CLAUDE_PLUGIN_ROOT}/bin/adlc"`. Run each `adlc` command as its own Bash call.

1. Run this to see what would change, without writing anything:

   ```
   adlc setup --dry-run
   ```

2. If it prints `already set up: nothing to change`, tell the user the project is already set up (show any `note:` or `skipped` lines) and stop.
3. Otherwise show the user every line it printed, in plain words:
   - `would add` lines are the permissions and the `.gitignore` entry that will be added. Existing settings are kept; nothing is removed.
   - `skipped` lines are rules the user already set differently; they stay as the user set them.
   - `note` lines need no action now.

   Ask the user whether to apply these changes. Stop if they say no.
4. If they say yes, run:

   ```
   adlc setup
   ```

   Show its output. Claude Code may ask the user to allow the command; that is expected.
5. If either command exits with code 2 (for example, `.claude/settings.json` is not valid JSON), show the message and stop. Do not edit `.claude/settings.json` yourself.
6. Tell the user: setup only changes `.claude/settings.json` and `.gitignore`, never `.claude/settings.local.json`. They should commit both files so teammates get the same settings. Next step: `/adlc:start "<title>"`.
