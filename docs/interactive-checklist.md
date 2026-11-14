# Interactive checklist (for the maintainer)

adlc has been tested end to end with `claude -p` ([first-run-test.md](first-run-test.md)), but not in a normal interactive session in the Claude app or terminal. Please run these steps once before a release and fill in the last column. If you record your screen while doing it, the recording can replace the scripted demo.

Use an empty test repository with one commit and a `package.json` containing `"scripts": { "test": "node --test" }`. It takes about 15 minutes and costs about $1.50 with Sonnet.

| # | Type this | You should see | Result |
|---|---|---|---|
| 1 | In a terminal: `claude plugin marketplace add 'roman-ambinder/adlc-plugin#claude/inspiring-brown-tdv947'` then `claude plugin install adlc@adlc-marketplace` (after the release: `#v0.7.0`) | "Successfully added marketplace" and "Successfully installed plugin". A note that options are not yet set is fine | |
| 2 | Open `claude` in the test repository | A "trust this folder" prompt the first time. Accept it | |
| 3 | `/adlc:setup` | A permission prompt for `adlc setup --dry-run` (allow it), then a plain list of what will be added to `.claude/settings.json` and `.gitignore`, and a question whether to apply | |
| 4 | Answer `yes` | A permission prompt for `adlc setup`, then "Setup is done" (or similar), and a reminder to commit both files | |
| 5 | Run `/adlc:setup` again | "already set up: nothing to change" | |
| 6 | Commit the two files, then `/clear` | — | |
| 7 | `/adlc:start "Add slugify utility" --small` | No permission prompt for `adlc start`. The change starts; discover and design are skipped; next step is `/adlc:plan`. No "not set up" tip | |
| 8 | `/adlc:plan` | Edit prompts for `.agent-lifecycle/requirements.md` and `plan.md` (unless you allow edits). Acceptance criteria `AC-1…`, one task, a request to run `/adlc:approve plan`. **No** prompt to read files in the plugin folder | |
| 9 | Type in plain words: `Please approve the plan for me.` | The model refuses and tells you to type `/adlc:approve plan` yourself (the guard says "only the user can run `adlc approve`") | |
| 10 | `/adlc:approve plan` | A permission prompt for `adlc approve plan` (allow it, this is deliberate), then "approved plan (hash …)" | |
| 11 | `/clear`, then `/adlc:next` | Build: a developer worker writes `src/` and `test/` files and runs the checks; "build stage is complete" or similar | |
| 12 | `/clear`, then `/adlc:next` | Verify: checks run through `adlc run`, all passing | |
| 13 | `/clear`, then `/adlc:next` | Review: a reviewer report with 0 blocking findings (or reasons if not) | |
| 14 | `/clear`, then `/adlc:release` | No permission prompt for `adlc summary`. `release.md` filled in; a request to run `/adlc:approve release` | |
| 15 | `/adlc:approve release` | A permission prompt (allow it), then "approved release (hash …)" | |
| 16 | `/adlc:release` | The release stage completes; the change is `done` | |
| 17 | `/adlc:status` | All stages completed or skipped | |
| 18 | Anything confusing, slow or surprising? | Notes | |

Send the filled-in table back (or paste it into a pull request). A failure in steps 1–8, 10 or 14–16 that a new user could not get past blocks the release; anything else becomes a known issue.
