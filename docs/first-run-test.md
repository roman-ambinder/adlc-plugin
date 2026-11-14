# First-run test

How a stranger's first run goes: the plugin installed from GitHub into a fresh Claude Code config, set up in a new repository, and one small change taken through the stages with `claude -p` (Claude Code 2.1.325, `--model sonnet`). Each prompt is typed the way a user types it.

Test repository: `package.json` with `"test": "node --test"`, one commit. `CLAUDE_CONFIG_DIR` pointed at an empty folder so nothing from the tester's own setup leaked in.

## Cost ledger

| Run | Step | Cost (USD) | Running total |
|---|---|---|---|
| 1 | start (stopped: permissions) | 0.109 | 0.109 |
| 1 | start (continued) | 0.127 | 0.236 |
| 1 | plan (stopped: workspace not trusted) | 0.154 | 0.390 |
| 1 | settings check (haiku, ×2) | 0.009 | 0.399 |
| 1 | plan (stopped: plugin rules unreadable) | 0.110 | 0.509 |
| 1 | plan (stopped: edits need approval) | 0.242 | 0.751 |
| 1 | plan (completed) | 0.351 | 1.102 |
| 1 | approve plan ×3 (refused: permission click) | 1.223 | 2.325 |
| 1 | approve plan (fresh session) | 0.085 | 2.410 |
| 1 | next: build (fresh session) | 0.215 | 2.625 |
| 1 | next: verify (fresh session) | 0.146 | 2.771 |
| 1 | next: review (fresh session) | 0.234 | 3.005 |

| 2 | /adlc:setup (refused: first command needs a click) | 0.086 | 3.091 |
| 2 | /adlc:setup (dry run, asked) | 0.089 | 3.180 |
| 2 | /adlc:setup (applied) | 0.108 | 3.288 |
| 2 | /adlc:start | 0.110 | 3.398 |
| 2 | /adlc:plan | 0.272 | 3.670 |
| 2 | /adlc:approve plan | 0.085 | 3.755 |
| 2 | /adlc:next (build) | 0.206 | 3.961 |
| 2 | /adlc:next (verify) | 0.134 | 4.095 |
| 2 | /adlc:next (review) | 0.231 | 4.326 |
| 2 | /adlc:release (stopped: P7) | 0.125 | 4.451 |
| 2 | /adlc:approve release (nothing to approve yet) | 0.108 | 4.559 |
| 2 | /adlc:release (stopped: P7) | 0.124 | 4.683 |
| 2 | /adlc:release (after the P7 fix) | 0.165 | 4.848 |
| 2 | /adlc:approve release | 0.103 | 4.951 |
| 2 | /adlc:release (completed, `done`) | 0.132 | 5.083 |

Run 1 stopped after review to stay under its $3.50 share of the $10 budget. Release was live-tested in the 0.5.0 run (`docs/capabilities.md`).

## Run 1 (baseline, 0.6.0, installed from `main`)

| Step | What happened |
|---|---|
| `claude plugin marketplace add roman-ambinder/adlc-plugin` | Worked: cloned and validated |
| `claude plugin install adlc@adlc-marketplace` | Worked. Printed "7 userConfig options not yet set — run /plugin configure …", which reads like something is missing although the defaults apply (P5) |
| Settings, done by hand as the README says | Copied `settings-template.json` to `.claude/settings.json`, added `.claude/worktrees/` to `.gitignore` |
| `/adlc:start "…" --small` | The model was denied reading `coordinator/SKILL.md` in the plugin folder (P1), loaded it through the Skill tool instead, then saw the unfilled `${user_config.*}` values in the start command and stopped to ask instead of running it (P2). `adlc start` itself also needed a permission click (P3) |
| `/adlc:plan` | First stopped because project settings were ignored (P4). Then stopped because the coordinator rules could not be read (P1). After read access was granted it ran: analyst asked four good questions; with answers it wrote 9 criteria, one task, sequential plan |
| `/adlc:approve plan` | In `-p` the command `adlc approve plan` needs a permission click (by design, not in the allow list), which `-p` cannot give, so it was refused 3 times (P3). With the click simulated in a fresh session: approved, $0.09 |
| `/adlc:next` (build) | Worked: worker claimed T1, wrote code and tests, checks passed, integrated. $0.22 |
| `/adlc:next` (verify) | Worked: approved checks and `npm test` passed through `adlc run`. $0.15 |
| `/adlc:next` (review) | Worked: 0 blocking, 3 optional findings. $0.23 |

Per-step costs grow fast when one conversation is continued (`--continue`): $0.35–0.43 per step late in the run, against $0.09–0.23 for the same stages in fresh sessions (P6).

## Run 2 (branch `claude/inspiring-brown-tdv947`, with /adlc:setup)

Installed with `claude plugin marketplace add 'roman-ambinder/adlc-plugin#claude/inspiring-brown-tdv947'`. One fresh `claude -p` session per step. The workspace was marked trusted and edits accepted (what an interactive user does with two clicks); the permission click for `adlc setup` and `adlc approve` was simulated with `--allowedTools`. No `--add-dir`: the plugin folder was **not** readable, to check the P1 fix.

| Step | What happened |
|---|---|
| `/adlc:setup` | First command needs a permission click (nothing is allowed before setup). Then: dry run listed every entry in plain words, asked, applied. `.claude/settings.json` and `.gitignore` written |
| `/adlc:start "…" --small` | Ran the start command with unfilled options without asking (P2 fixed); no plugin-file reads (P1 fixed). No setup tip (project was set up) |
| `/adlc:plan` | 7 criteria, one task, sequential; listed its assumptions for the user |
| `/adlc:approve plan` | Approved |
| `/adlc:next` ×3 | Build, verify and review all passed; review 0 blocking, 4 optional |
| `/adlc:release` | Stopped: `adlc summary` not allowed (P7). Fixed on the branch, plugin reinstalled, `adlc setup` re-run: it added only the two new entries |
| `/adlc:release`, `/adlc:approve release`, `/adlc:release` | Release notes written, approved, change `done` |

**Cost of one small change** (Sonnet, a fresh session per step, clean path only): about **$1.45** for the 9 lifecycle steps, $0.08–0.27 per step, plus about $0.20 for `/adlc:setup` once per project.

Updating the plugin from a branch without a version change did nothing (`claude plugin update` said "already at the latest version"); a reinstall was needed. Releases bump the version, so users are not affected.

## Problems found

- **P1 — stops a stranger.** Every lifecycle skill starts with "Read `${CLAUDE_PLUGIN_ROOT}/skills/coordinator/SKILL.md`". The plugin lives in Claude Code's plugin cache, outside the project, so the Read needs permission: a prompt in every session, and a hard stop in `-p`. The coordinator skill can be loaded with the Skill tool (`adlc:coordinator`), which needs no permission. Earlier live tests passed `--add-dir <plugin>`, which hid this. **Fixed:** skills load other skills with the Skill tool (reading the file only as a fallback), and the reviewer's report format is in its own instructions instead of a template file.
- **P2 — stops a stranger.** With no plugin options saved, the start command still contains `${user_config.*}` text. `adlc start` ignores it (since 0.5.0), but the model does not know that and stops to ask the user what to do. **Fixed:** the start skill says to run the command as written.
- **P3 — known issue (by design), needs docs.** `adlc approve` and `adlc start` are not in the settings template's allow list, so Claude Code asks for a permission click after the user's slash command. For approve this is deliberate. The quickstart should say to expect the prompt and allow it. Adding `Bash(adlc start *)` to the template is safe (reduced gates still need the user's own `/adlc:start`). **Fixed** for start: added to the template (and so to `/adlc:setup`).
- **P4 — known issue (test setup), needs docs.** Claude Code ignores a project's `.claude/settings.json` permissions until the folder is trusted. Interactive users accept the trust dialog on first launch; `-p` users must run Claude Code interactively there once. Troubleshooting should mention it.
- **P5 — known issue, needs docs.** The install message about unset options looks like an error. The README should say the defaults apply and setting options is optional.
- **P6 — known issue, needs docs.** Long conversations make each stage cost more. State lives on disk, so `/clear` (or a new session) between stages is safe and cheaper. The cost section should say so.
- File edits ask for approval in Claude Code's default permission mode. This is normal Claude Code behaviour, not an adlc problem; not counted.
- **P7 — stops a stranger.** The release skill runs `adlc summary` (added in 0.6.0), but the settings template did not allow it, so release stopped for a permission prompt (refused in `-p`). **Fixed:** added to the template, with a test that every routine subcommand is allowed.
