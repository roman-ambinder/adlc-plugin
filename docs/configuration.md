# Configuration

## Options

Set these when enabling the plugin, or later with `/plugin` → Installed → Configure (they also appear in `/config`).

| Option | Default | Meaning |
|---|---|---|
| `approval_gates` | `plan,release` | Gates that need your approval. `none` disables them; platform prompts and guard prompts still apply. Fewer gates than the default take effect only when you type `/adlc:start` yourself |
| `guard_level` | `strict` | `standard` asks before commit, push, PR, install, network, destructive, publish and deploy commands. `strict` also asks before merge, rebase, worktree and other history edits |
| `max_repair_attempts` | `3` | Failed attempts per task before it is blocked and work stops |
| `max_tasks_per_run` | `5` | Tasks dispatched per session before the coordinator stops and writes a handoff |
| `parallel_mode` | `auto` | `auto` picks `worktree` when the repository allows it (see below), otherwise `shared`, and `sequential` when no wave has two independent M/L tasks. `worktree` and `shared` request a mode, with the same fallbacks. `sequential` always runs one worker at a time |
| `max_parallel` | `2` | Upper bound on concurrent workers in parallel modes |
| `serial_globs` | lockfiles, manifests, config, migrations, generated files | Tasks that touch these always run alone |

Values are captured into `state.json` when a change starts.

## Worktree mode

Each parallel worker runs in its own git worktree (`adlc:developer-worktree`, `isolation: worktree`). Requirements, all checked before planning and before each dispatch:

- a git repository with at least one commit;
- `"worktree": {"baseRef": "head"}` in `.claude/settings.json` (included in `settings-template.json`), so worktrees start from your current commit instead of the remote default branch;
- `.claude/worktrees/` listed in `.gitignore`;
- no uncommitted changes outside `.agent-lifecycle/`, since worktrees only see committed files.

Workers never commit. After `adlc integrate done`, the CLI prints `git worktree remove` and `git branch -d` commands for the merged worktree; the coordinator runs them after build with your approval, and git refuses to remove anything unmerged or dirty. When a task passes `adlc integrate check`, the CLI prints the exact `git add`, `git commit` (in the worktree) and `git merge --no-ff` (into your current branch) commands. The coordinator shows them and runs them only through permission prompts. Files that a check run wrote in the worktree (coverage output, lockfile rewrites) are left out of the printed `git add` and only warn. `adlc integrate done` refuses a task until its commit is merged into `HEAD` and the cross-task checks have run after the merge. Merge conflicts are aborted and reported, never resolved automatically.
