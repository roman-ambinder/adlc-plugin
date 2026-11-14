# Contributing

Thanks for helping. Bug reports, ideas and pull requests are all welcome.

## Set up

You need Node 18 or later and git. There are no dependencies to install.

```bash
git clone https://github.com/roman-ambinder/adlc-plugin.git
```

```bash
cd adlc-plugin && npm test
```

`npm run validate` checks the plugin and marketplace manifests. It needs Claude Code installed.

To try your changes in Claude Code without installing: `claude --plugin-dir ./plugins/adlc`. See [docs/development.md](docs/development.md) for the end-to-end example.

## Making a change

- Add or change a test with every behaviour change. Rules belong in the CLI (`plugins/adlc/lib/`), where they can be tested.
- Keep the plugin free of dependencies.
- Write docs and messages in plain, simple language.
- Add a line to `CHANGELOG.md` under `## Unreleased`.
- Keep pull requests small and focused, and fill in the pull request template.

## Releases

The maintainer releases by bumping the version on `main`; a workflow tags it and publishes the release. See [docs/development.md](docs/development.md#releasing).

## Security

Please report security problems privately: see [SECURITY.md](SECURITY.md).
