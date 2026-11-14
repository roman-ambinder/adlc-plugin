# Public Release Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `adlc` ready for an open GitHub release: a tested first run, one-command setup (`/adlc:setup`), a newcomer-friendly README with a demo, public-project files, and release 0.7.0.

**Architecture:** A new dependency-free module `plugins/adlc/lib/setup.js` plans and applies a merge of `settings-template.json` into the project's `.claude/settings.json` and `.gitignore`; `adlc setup [--dry-run]` exposes it and a user-only `/adlc:setup` skill drives it. Everything else is documentation, moved out of the README into `docs/`, plus a first-run test run with real `claude -p` sessions whose findings feed fixes.

**Tech Stack:** Node ≥ 18 (no dependencies), `node:test`, Claude Code 2.1.325 CLI (`claude -p`, `claude plugin`), GitHub Actions (existing).

**Spec:** `docs/superpowers/specs/2026-11-14-public-release-readiness-design.md`

## Global Constraints

- Node ≥ 18, no runtime or dev dependencies added to `package.json`. Dev-time tools for the demo run through `npx` and are not committed as dependencies.
- Claude Code ≥ 2.1.311 stays the documented minimum.
- `npm test` and `npm run validate` stay green after every task.
- Plain, simple language in every user-facing text (README, docs, skill text, CLI messages).
- Never overstate safety: every safety claim keeps the limits in `docs/capabilities.md` (Bash guard is pattern-based and best-effort; not a sandbox).
- Setup never overwrites or removes a user's existing settings entry, and shows what it will change before writing.
- Owner/author value: `roman-ambinder`.
- First-run test: `claude -p` with `--model sonnet`; total spend across all runs ≤ **$10.00**. Keep a running total; stop and report to the owner before any run that could pass it.
- The builder never merges to `main` and never pushes to any branch except `claude/inspiring-brown-tdv947`. The release goes through a PR the owner merges.
- Commit messages end with the session attribution lines; no model names in commits, PRs or files.

## Review Focus

1. **Setup run from a subdirectory** — writes to the repository root (git top level), never creates `.claude/` in the subdirectory. Test in Task 2.
2. **Broken or unexpected `.claude/settings.json`** (invalid JSON, `permissions.allow` not an array) — refuses with exit 2 and a message naming the problem; nothing is written. Test in Task 2.
3. **`.gitignore` variants** — no trailing newline (append starts on a new line); entry already present as `.claude/worktrees`, `/.claude/worktrees/` or with CRLF line endings (counted as present). Test in Task 2.
4. **A rule clash across lists** — user has `Bash(git commit *)` in `allow`, template has it in `ask`: skipped and reported, user's `allow` unchanged; same for a template `deny` the user allows. Test in Task 2.
5. **`worktree.baseRef` already set to another value** (e.g. `"fresh"`) — left as is and reported as a note, so worktree mode's preflight explains it later. Test in Task 2.

---

## File map

| File | Responsibility |
|---|---|
| `plugins/adlc/lib/setup.js` (new) | Find project root, load template, plan the merge, apply it, report "is set up" |
| `plugins/adlc/lib/cli.js` | `setup` handler, `dry-run` flag, help line, setup tip after `start` |
| `plugins/adlc/skills/setup/SKILL.md` (new) | User-only skill: dry run, show, ask, apply |
| `tests/setup.test.js` (new) | Unit and CLI tests for setup |
| `tests/skills.test.js`, `tests/cli.test.js` | Setup skill is user-only; start tip |
| `tests/docs.test.js` (new) | README links resolve; moved sections exist in `docs/`; community files exist |
| `tests/manifest.test.js` | Owner/author is `roman-ambinder`; marketplace text not "Local" |
| `docs/first-run-test.md` (new) | Log of both first-run test runs, cost ledger, problems found |
| `docs/interactive-checklist.md` (new) | Steps for the owner to run in the Claude app |
| `docs/configuration.md`, `docs/how-it-works.md`, `docs/safety.md`, `docs/troubleshooting.md`, `docs/development.md` (new) | Reference content moved out of README |
| `docs/media/demo.svg` (new), `scripts/demo-cast.js` (new) | Scripted demo recording and the script that makes it |
| `README.md` | Rewritten short newcomer README |
| `SECURITY.md`, `CONTRIBUTING.md`, `.github/ISSUE_TEMPLATE/bug_report.md`, `.github/ISSUE_TEMPLATE/feature_request.md`, `.github/pull_request_template.md` (new) | Public-project basics |
| `.claude-plugin/marketplace.json`, `plugins/adlc/.claude-plugin/plugin.json`, `LICENSE` | Owner text |
| `CHANGELOG.md`, `package.json`, `plugin.json`, `docs/capabilities.md` | Release 0.7.0 |

---

### Task 1: Baseline first-run test (before any change)

Find what a stranger hits today. No code changes in this task.

**Files:**
- Create: `docs/first-run-test.md`

**Interfaces:**
- Produces: `docs/first-run-test.md` with sections `## Cost ledger` (a table: run, step, cost, running total), `## Run 1 (baseline, 0.6.0)` (one row per step: prompt, what happened, cost) and `## Problems found` (numbered `P1`, `P2`, … each tagged **stops a stranger** or **known issue**). Task 4 and Task 5 append to it.

- [ ] **Step 1: Make an isolated scratch setup**

```bash
W=/tmp/claude-0/-home-user-adlc-plugin/c7d52989-c990-506f-b48b-50ded1477e24/scratchpad/firstrun1
mkdir -p "$W/config" "$W/repo" && cd "$W/repo"
git init -q -b main && git config user.email t@example.invalid && git config user.name test
printf '{ "name": "demo", "version": "1.0.0", "private": true, "scripts": { "test": "node --test" } }\n' > package.json
git add . && git commit -qm init
export CLAUDE_CONFIG_DIR="$W/config"   # keeps the install out of the session's own config
```

Expected: a repo with one commit; `claude plugin marketplace list` (with that `CLAUDE_CONFIG_DIR`) shows no adlc marketplace. If `CLAUDE_CONFIG_DIR` breaks auth, drop it and instead remove the marketplace and plugin at the end of the task (`claude plugin uninstall adlc@adlc-marketplace`, `claude plugin marketplace remove adlc-marketplace`); note which in the log.

- [ ] **Step 2: Install from GitHub exactly as the README says, on `main`**

```bash
claude plugin marketplace add roman-ambinder/adlc-plugin
claude plugin install adlc@adlc-marketplace
```

Expected: both succeed. Record any warning or error verbatim as a problem.

- [ ] **Step 3: Follow the README by hand, as a stranger**

Copy `settings-template.json` entries into `.claude/settings.json` the way the README describes. Log every place the README was unclear.

- [ ] **Step 4: Run the 7-step flow with `claude -p`, one prompt per call**

For each prompt in order — `/adlc:start "Add slugify utility: lowercase, spaces to dashes, strip other characters" --small`, `/adlc:plan`, `/adlc:approve plan`, `/adlc:next`, `/adlc:next`, `/adlc:next`, `/adlc:release`, `/adlc:approve release`, `/adlc:release` — run:

```bash
claude -p "<prompt>" --model sonnet --output-format json --max-budget-usd 0.80 --continue
```

(omit `--continue` on the first call). Read `total_cost_usd` from the JSON and add it to the ledger before the next call. Expected: change reaches `done` (`node ~/.../bin/adlc status` or `/adlc:status`). **Stop if the running total reaches $3.50**, and log where it stopped.

- [ ] **Step 5: Write `docs/first-run-test.md`**

Fill the three sections. Tag each problem: **stops a stranger** (install fails, a step errors with no clear next action, a step needs undocumented setup) or **known issue** (everything else).

- [ ] **Step 6: Commit and push**

```bash
git add docs/first-run-test.md
git commit -m "docs: baseline first-run test of 0.6.0 installed from GitHub"
git push
```

---

### Task 2: `lib/setup.js` and `adlc setup`

**Files:**
- Create: `plugins/adlc/lib/setup.js`
- Modify: `plugins/adlc/lib/cli.js` (`BOOL` set line 19, `HELP` lines 21–40, `handlers` object, `start` handler near line 187)
- Test: `tests/setup.test.js`

**Interfaces:**
- Produces (from `lib/setup.js`):
  - `projectRoot(cwd: string, env = process.env) -> string` — `env.ADLC_ROOT` if set, else `git rev-parse --show-toplevel` from `cwd`, else `cwd`.
  - `loadTemplate() -> object` — parsed `plugins/adlc/settings-template.json`.
  - `planSetup(root: string, template: object) -> Plan` where `Plan = { settings: object, settingsChanged: boolean, settingsExisted: boolean, added: Array<{ list: 'allow'|'ask'|'deny', entry: string }>, skipped: Array<{ entry: string, templateList: string, userList: string }>, notes: string[], gitignore: { text: string, changed: boolean } }`. Throws `rule(...)` (exit 2) if settings JSON is invalid or `permissions`, or any of its lists, has the wrong type.
  - `applySetup(root: string, plan: Plan) -> void` — writes only changed files, with `atomicWrite` from `lib/fsutil.js`, 2-space JSON plus trailing newline; creates `.claude/` if needed.
  - `isSetUp(root: string, template: object) -> boolean` — true when `planSetup` would change nothing (skips count as done).
  - `formatPlan(plan: Plan, { dryRun: boolean }) -> string` — lines starting `would add`/`added`, `skipped`, `note`, or the single line `already set up: nothing to change`.
- Produces (CLI): `adlc setup [--dry-run]`, exit 0 on success, 2 on refused input.

- [ ] **Step 1: Write the failing tests in `tests/setup.test.js`**

Use `tmpdir`, `cli`, `ok`, `writeFile` from `tests/helpers.js`; run the CLI with `ADLC_ROOT` unset where a test checks root detection (pass `{ ADLC_ROOT: '' }` and set `cwd` via a small local `spawnSync` wrapper).

```js
test('setup: fresh repo gets settings and gitignore; second run changes nothing', ...)
  // after `adlc setup`: settings.permissions.allow includes 'Bash(adlc status)'; ask includes 'Bash(git commit *)';
  // deny includes 'Read(./.env)'; settings.worktree.baseRef === 'head'; .gitignore has a line '.claude/worktrees/'.
  // second run stdout === 'already set up: nothing to change\n'; file mtimes unchanged.
test('setup --dry-run writes nothing and lists what it would add', ...)
  // stdout matches /^would add to \.claude\/settings\.json: permissions\.allow Bash\(adlc status\)$/m; no .claude dir.
test('setup keeps existing entries and unrelated keys', ...)
  // pre: { "model": "sonnet", "permissions": { "allow": ["Bash(ls *)"] } } -> model kept, 'Bash(ls *)' still first in allow.
test('setup skips a template entry the user has in another list', ...)      // Review Focus 4
  // pre allow: ['Bash(git commit *)', 'Read(./.env)'] -> ask lacks 'Bash(git commit *)', deny lacks 'Read(./.env)',
  // allow unchanged; stdout matches /skipped Bash\(git commit \*\): you have it under allow/.
test('setup leaves a different worktree.baseRef and notes it', ...)         // Review Focus 5
  // pre worktree.baseRef 'fresh' -> still 'fresh'; stdout matches /note: worktree\.baseRef is "fresh"/.
test('setup refuses invalid settings JSON and wrong types', ...)            // Review Focus 2
  // '{ "permissions": ' -> exit 2, stderr /not valid JSON/; '{"permissions":{"allow":"x"}}' -> exit 2,
  // stderr /permissions\.allow must be a list/; file content byte-identical afterwards.
test('setup gitignore variants', ...)                                       // Review Focus 3
  // 'node_modules/' (no newline) -> 'node_modules/\n.claude/worktrees/\n';
  // '/.claude/worktrees/\r\n', '.claude/worktrees\n' -> unchanged.
test('setup from a subdirectory writes at the git top level', ...)          // Review Focus 1
  // git repo with src/; run with cwd=src and ADLC_ROOT unset -> <root>/.claude/settings.json exists, src/.claude does not.
test('start prints a setup tip only when the project is not set up', ...)
  // `adlc start "x"` stdout matches /run \/adlc:setup/; after `adlc setup` in a new repo, start output does not.
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/setup.test.js`
Expected: FAIL (`unknown command "setup"` / module not found).

- [ ] **Step 3: Implement `lib/setup.js` with the interfaces above**

Entry matching is exact string equality. Template order is kept when adding. A template entry already in the same list is a no-op; present in another list is a skip. `.gitignore` line match: trim, strip CR, strip one leading `/` and one trailing `/`, compare to `.claude/worktrees`.

- [ ] **Step 4: Wire the CLI**

Add `'dry-run'` to `BOOL`; add help line `setup [--dry-run]       add recommended settings to .claude/settings.json and .gitignore`; add `handlers.setup` that ignores the passed state root and uses `projectRoot(process.cwd())`. In `start`, after success, append `\nTip: this project is not set up for adlc yet. Run /adlc:setup to add the recommended permissions.` when `!isSetUp(projectRoot(root), loadTemplate())`.

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: all pass, including the 134 existing tests. If an existing start test matches the full start output exactly, update its expectation to allow the tip.

- [ ] **Step 6: Commit**

```bash
git add plugins/adlc/lib/setup.js plugins/adlc/lib/cli.js tests/setup.test.js tests/cli.test.js
git commit -m "feat: adlc setup merges recommended settings without overwriting yours"
```

---

### Task 3: `/adlc:setup` skill

**Files:**
- Create: `plugins/adlc/skills/setup/SKILL.md`
- Modify: `tests/skills.test.js` (user-only list near line 37), `plugins/adlc/settings-template.json` (only if Step 1 shows it allows setup)
- Modify: `README.md` Troubleshooting row "Too many permission prompts" and the "Recommended project permissions" paragraph, to point to `/adlc:setup` first (full README rewrite is Task 6)

**Interfaces:**
- Consumes: `adlc setup [--dry-run]` output format from Task 2.

- [ ] **Step 1: Write failing tests in `tests/skills.test.js`**

```js
// add 'setup' to the disable-model-invocation list in the existing user-only test
test('setup skill runs a dry run before writing, and the template does not pre-allow setup', () => {
  const text = read('skills/setup/SKILL.md');
  const dry = text.indexOf('adlc setup --dry-run');
  const apply = text.search(/adlc setup\s*$/m);          // the line that applies, without --dry-run
  assert.ok(dry >= 0 && apply > dry, 'dry run comes before applying');
  assert.match(text, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/adlc"/);
  const tpl = JSON.parse(read('settings-template.json'));
  assert.ok(!tpl.permissions.allow.some((e) => /adlc setup/.test(e)));
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test tests/skills.test.js`, expected FAIL (file missing).

- [ ] **Step 3: Write the skill**

Frontmatter: `description` ("Set up this project for adlc: add the recommended permissions and .gitignore entry"), `disable-model-invocation: true`. Body, in order: CLI fallback line as in `skills/start/SKILL.md`; run `adlc setup --dry-run`; if it says `already set up`, tell the user and stop; otherwise show the lines and ask the user to confirm; on yes run `adlc setup` (its own Bash call) and show the result; on exit 2 show the message and stop without editing the file by hand. Mention that `.claude/settings.local.json` is never touched.

- [ ] **Step 4: Update the two README spots** to say "Run `/adlc:setup`" with manual copying as the alternative.

- [ ] **Step 5: Run** `npm test` and `npm run validate`. Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add plugins/adlc/skills/setup tests/skills.test.js README.md
git commit -m "feat: /adlc:setup skill"
```

---

### Task 4: Fix what stops a stranger

**Files:** decided by `docs/first-run-test.md` → `## Problems found`, entries tagged **stops a stranger**.

- [ ] **Step 1: For each such problem, write a failing test that reproduces it** (in the existing suite that owns the code; doc-only problems need no test). Run it, see it fail.
- [ ] **Step 2: Fix it minimally.** Run `npm test`; expected all pass.
- [ ] **Step 3: Mark the problem `fixed in <commit>` in `docs/first-run-test.md`.** Known issues stay listed; Task 6 copies them into the README's limits section.
- [ ] **Step 4: Commit each fix separately** — `fix: <problem in plain words>`. Push after the last one.

If a problem needs a change to CLI rules or a new feature, stop and ask the owner (spec non-goal).

---

### Task 5: Re-run the first-run test with `/adlc:setup`

**Files:**
- Modify: `docs/first-run-test.md` (add `## Run 2 (branch, with /adlc:setup)`, extend the ledger)

- [ ] **Step 1: Fresh scratch dir as in Task 1 Step 1** (`firstrun2`), then install from the work branch:

```bash
claude plugin marketplace add 'roman-ambinder/adlc-plugin#claude/inspiring-brown-tdv947'
claude plugin install adlc@adlc-marketplace
```

- [ ] **Step 2: Run `/adlc:setup` with `claude -p`** and answer yes in a follow-up `--continue` prompt. Expected: `.claude/settings.json` and `.gitignore` match the template; second `/adlc:setup` says already set up.
- [ ] **Step 3: Run the same 9 prompts as Task 1 Step 4**, same flags and ledger. **Stop if the overall total reaches $7.00.** Expected: `done`, fewer permission problems than Run 1. Record cost per step; this is the cost figure for the README.
- [ ] **Step 4: Log new problems; fix any that stop a stranger as in Task 4.**
- [ ] **Step 5: Commit and push** — `docs: first-run test with /adlc:setup`.

---

### Task 6: README rewrite and docs split

**Files:**
- Create: `docs/configuration.md`, `docs/how-it-works.md`, `docs/safety.md`, `docs/troubleshooting.md`, `docs/development.md`
- Modify: `README.md`
- Test: `tests/docs.test.js`

**Interfaces:**
- Consumes: Run 2 cost per step and known issues from `docs/first-run-test.md`.
- Setup suggestion (spec: "SessionStart hook or adlc status"): done by the `start` tip in Task 2 instead, because hooks are silent outside an adlc change and a hook tip would add noise to every session. Builder's call, within "quiet otherwise".

- [ ] **Step 1: Write the failing test `tests/docs.test.js`**

```js
test('docs: every relative link in README.md and docs/*.md points to an existing file', ...)
  // parse ](path) and ](path#anchor) links not starting with http; fs.existsSync(resolved) for each.
test('docs: moved reference sections exist', ...)
  // configuration.md has '## Options' with each userConfig key from plugin.json and '## Worktree mode';
  // how-it-works.md has '## Architecture', '## Project state', '## Exit codes';
  // safety.md has '## Limits' and the phrase 'best-effort';
  // troubleshooting.md contains every symptom row present in the README before this task (copy the list into the test);
  // development.md has '## Releasing'.
test('docs: README leads with why, demo, quickstart, cost and limits', ...)
  // headings in this order: '## Why', '## Demo', '## Quickstart', '## Cost and limits', '## Commands';
  // README contains 'Version <current version>.' (kept for tests/release.test.js) and '/adlc:setup'.
```

- [ ] **Step 2: Run to verify it fails** — `node --test tests/docs.test.js`.
- [ ] **Step 3: Move content into the five docs pages** (cut from README, paste, adjust headings to the test's names). No sentence is dropped; anything shortened in the README stays in full in a docs page.
- [ ] **Step 4: Rewrite README** in the spec's order: pitch + why (3–4 sentences), demo (image link to `docs/media/demo.svg`, which Task 9 creates), quickstart (requirements, 2 install commands, `/adlc:setup`, 7-step flow), cost and limits (Run 2 total and per-step range with Sonnet; one change per repo; no Windows; Bash guard best-effort, not a sandbox; interactive status; known issues from the test log), commands (short table), links to docs pages, license.
- [ ] **Step 5: Run** `npm test`. Expected: pass.
- [ ] **Step 6: Commit** — `docs: short newcomer README; reference moved into docs/`.

Note for Step 1: until Task 9 lands, exclude `docs/media/demo.svg` from the link check with an explicit allowlist entry that Task 9 removes.

---

### Task 7: Public-project files and owner text

**Files:**
- Create: `SECURITY.md`, `CONTRIBUTING.md`, `.github/ISSUE_TEMPLATE/bug_report.md`, `.github/ISSUE_TEMPLATE/feature_request.md`, `.github/pull_request_template.md`
- Modify: `.claude-plugin/marketplace.json` (`owner.name`, `description`), `plugins/adlc/.claude-plugin/plugin.json` (`author.name`), `LICENSE` (copyright line)
- Test: `tests/manifest.test.js`, `tests/docs.test.js`

- [ ] **Step 1: Failing tests**

```js
// manifest.test.js
test('owner and author are roman-ambinder; marketplace text is not "Local"', ...)
  // marketplace.owner.name === 'roman-ambinder'; plugin.author.name === 'roman-ambinder';
  // marketplace.description does not match /local/i; LICENSE matches /Copyright \(c\) 2026 roman-ambinder/.
// docs.test.js
test('community files exist and SECURITY.md points to private vulnerability reporting', ...)
  // all five files exist; SECURITY.md matches /security\/advisories\/new/ and /best-effort/.
```

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Write the files.**
  - `SECURITY.md`: report privately at `https://github.com/roman-ambinder/adlc-plugin/security/advisories/new`; in scope: guard bypasses beyond the documented best-effort Bash limits, state or approval tampering, secrets leaking into evidence or logs; out of scope: the known limits listed in `docs/safety.md#limits`; supported version: latest release.
  - `CONTRIBUTING.md`: clone, Node ≥ 18, `npm test`, `npm run validate` (needs Claude Code), plain-language rule, add a `CHANGELOG.md` entry under `## Unreleased`, how releases work (link `docs/development.md#releasing`).
  - Bug template fields: Claude Code version, Node version, OS, what you ran, what happened, `adlc status` output, `ADLC_HOOK_LOG` output if hooks are involved.
  - Feature template: problem, proposed behaviour, alternatives. PR template: what and why, tests run, changelog entry.
  - Marketplace description: `"adlc plugin marketplace: agentic development lifecycle with approval gates"`.
- [ ] **Step 4: Run** `npm test` and `npm run validate`. Expected: pass.
- [ ] **Step 5: Commit** — `chore: security policy, contributing guide, issue templates, owner name`.
- [ ] **Step 6: Tell the owner** (in chat, not a file) to turn on private vulnerability reporting (Settings → Security → Private vulnerability reporting) and suggested repo description and topics: `claude-code`, `claude-code-plugin`, `ai-agents`, `developer-workflow`.

---

### Task 8: Interactive checklist for the owner

**Files:**
- Create: `docs/interactive-checklist.md`
- Modify: `docs/capabilities.md` ("Still not live-tested" section: link the checklist)

- [ ] **Step 1: Write the checklist.** Numbered rows with columns *Type this* / *You should see* / *Result (fill in)*: install (2 commands, from the work branch), new session, `/adlc:setup` (dry-run list, asks, writes), `/adlc:start "…" --small` (setup tip absent), `/adlc:plan`, a prose request "please approve the plan for me" (refused; told to type the slash command), `/adlc:approve plan`, `/adlc:next` ×3, `/adlc:release`, `/adlc:approve release`, `/adlc:release` (`done`), `/adlc:status`. A final row: "Anything confusing?". Note it doubles as the demo recording if they screen-record.
- [ ] **Step 2: Check every command and expected message against the code** (`lib/cli.js`, skills, `hooks/guard.js`). Expected: each "You should see" line quotes or paraphrases a message that exists.
- [ ] **Step 3: Run** `npm test` (docs link test covers it). Commit — `docs: interactive checklist for the owner`. Push.

---

### Task 9: Scripted demo

**Files:**
- Create: `scripts/demo-cast.js`, `docs/media/demo.svg`
- Modify: `tests/docs.test.js` (remove the Task 6 allowlist entry), `README.md` (demo caption)

**Interfaces:**
- Produces: `node scripts/demo-cast.js <out.cast>` — writes an asciicast v2 file (header line `{"version":2,"width":100,"height":30}` then `[time, "o", text]` events) showing the 7-step slash-command flow as typed prompts with real `adlc` CLI output, generated by running the same steps as `examples/slugify/run.sh` in a temp dir.

- [ ] **Step 1: Write `scripts/demo-cast.js`** — reuse `examples/slugify/run.sh` by running it in a temp dir and splitting its output on the `== <n>.` step markers; before each step emit a typed prompt (`> /adlc:start …`, matching the README quickstart) at ~30 ms per character, then the step's output, then a 1.5 s pause. Total play time 60–120 s.
- [ ] **Step 2: Render**

```bash
node scripts/demo-cast.js /tmp/claude-0/-home-user-adlc-plugin/c7d52989-c990-506f-b48b-50ded1477e24/scratchpad/demo.cast
npx --yes svg-term-cli --in /tmp/claude-0/-home-user-adlc-plugin/c7d52989-c990-506f-b48b-50ded1477e24/scratchpad/demo.cast --out docs/media/demo.svg --window --width 100 --height 30
```

Expected: `docs/media/demo.svg` under 5 MB. Check it by opening it in Playwright Chromium and taking a screenshot at 3 time points (deviceScaleFactor 1); text must be readable.
- [ ] **Step 3: README caption** under the image: "Scripted demo: real adlc commands with the model's work replaced by fixed content. See `examples/slugify/run.sh`." If the owner later sends a real recording, it replaces this one.
- [ ] **Step 4: Remove the allowlist entry from `tests/docs.test.js`; run** `npm test`. Expected: pass.
- [ ] **Step 5: Commit** — `docs: scripted demo recording`. Push.

---

### Task 10: Release 0.7.0 pull request

**Files:**
- Modify: `plugins/adlc/.claude-plugin/plugin.json` and `package.json` (`version` → `0.7.0`), `README.md` (`Version 0.7.0.`), `CHANGELOG.md` (move `## Unreleased` items into `## 0.7.0 — <date>`: Added `/adlc:setup`, `adlc setup`; Documentation: new README, docs pages, demo, security policy, contributing guide, templates; Fixed: Task 4 fixes), `docs/capabilities.md` (status line → 0.7.0; add a "First-run test (installed from GitHub)" section summarising both runs and costs)

- [ ] **Step 1: Make the changes; run** `npm test` and `npm run validate`. Expected: pass (`tests/release.test.js` checks the versions and changelog section).
- [ ] **Step 2: Commit** — `chore: release 0.7.0`. Push.
- [ ] **Step 3: Open the PR** from `claude/inspiring-brown-tdv947` to `main`, title `Release 0.7.0: ready for public use`, body: summary, test results, total first-run spend, and "Before merging: run `docs/interactive-checklist.md` and turn on private vulnerability reporting". Check for a PR template first (Task 7 adds one; follow its headings). Subscribe to PR activity.
- [ ] **Step 4: Hand off to the owner** with the PR link and the checklist. Do not merge.

---

### Task 11: After the owner merges — post-release check

- [ ] **Step 1: Confirm** the `v0.7.0` tag and GitHub release exist (`git ls-remote --tags origin`).
- [ ] **Step 2: Install check only** (no model calls): fresh `CLAUDE_CONFIG_DIR`, `claude plugin marketplace add 'roman-ambinder/adlc-plugin#v0.7.0'`, `claude plugin install adlc@adlc-marketplace`, `claude plugin details adlc@adlc-marketplace`. Expected: version 0.7.0, the `setup` skill listed.
- [ ] **Step 3: Record the result and the owner's checklist results in `docs/capabilities.md`** on a new branch from `main` (per branch rules) and offer a small follow-up PR.
