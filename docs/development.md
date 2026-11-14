# Development

## Tests

```bash
npm test
```

```bash
npm run validate
```

`npm test` runs the `node:test` suites (state, stages, tasks, gates, evidence, dispatch, integration, CLI, hooks, skill and agent files, and the end-to-end example). CI (`.github/workflows/ci.yml`) runs them on Node 18, 20, 22 and 24 for pull requests and pushes to `main`, and validates the manifests with a pinned Claude Code version. `npm run validate` runs `claude plugin validate --strict` on the plugin and the marketplace.

## End-to-end example

[`examples/slugify/run.sh`](../examples/slugify/run.sh) takes a small feature (a `slugify` utility) through every stage. It uses the real CLI and the real hook scripts, with model work replaced by fixed content, so the run is deterministic.

```bash
examples/slugify/run.sh
```

The resulting artifacts are committed in [`examples/slugify/artifacts/`](../examples/slugify/artifacts/).

In an interactive session the same flow is the one in the [Quickstart](../README.md#quickstart).

## Demo recording

`docs/media/demo.svg` is made from the end-to-end example:

```bash
node scripts/demo-cast.js /tmp/demo.cast
```

```bash
npx --yes svg-term-cli --in /tmp/demo.cast --out docs/media/demo.svg --window --width 100 --height 30
```

## Releasing

Bump `version` in `plugins/adlc/.claude-plugin/plugin.json` and `package.json`, add a `## <version> — <date>` section to `CHANGELOG.md`, and merge to `main`. `.github/workflows/release.yml` runs the tests, tags the commit `v<version>` and publishes a GitHub release with that changelog section. It does nothing if the tag already exists, and can also be started by hand (workflow_dispatch).

## Documentation references (checked 2026-11-13, Claude Code 2.1.311)

| Topic | Page |
|---|---|
| Plugin manifest, layout, `userConfig`, `${CLAUDE_PLUGIN_ROOT}`, `bin/` | https://code.claude.com/docs/en/plugins-reference |
| Components, plugin agent frontmatter limits | https://code.claude.com/docs/en/plugins/components |
| Skills frontmatter, `$ARGUMENTS`, `disable-model-invocation` | https://code.claude.com/docs/en/skills |
| Subagents, tools, `maxTurns`, `isolation` | https://code.claude.com/docs/en/sub-agents |
| Hook events, PreToolUse decisions, SubagentStop, `agent_id` | https://code.claude.com/docs/en/hooks |
| Worktrees and `worktree.baseRef` | https://code.claude.com/docs/en/worktrees |
| Marketplace file | https://code.claude.com/docs/en/plugins/marketplace-reference |
