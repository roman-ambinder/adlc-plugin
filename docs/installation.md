# Installation

Requirements: Claude Code ≥ 2.1.311, Node ≥ 18, git (recommended), macOS or Linux. Windows is not supported: `adlc run` executes checks with `sh -c`, and the guard's patterns assume a POSIX shell. WSL should work but is untested.

**From GitHub (recommended):**

```bash
claude plugin marketplace add roman-ambinder/adlc-plugin
```

```bash
claude plugin install adlc@adlc-marketplace
```

Or, inside a session: `/plugin marketplace add roman-ambinder/adlc-plugin`, then `/plugin install adlc@adlc-marketplace`. Start a new session afterwards so the hooks load.

**Pin a release.** Add `#<tag>` to the source to stay on one version (see [Releases](https://github.com/roman-ambinder/adlc-plugin/releases)):

```bash
claude plugin marketplace add 'roman-ambinder/adlc-plugin#v0.7.0'
```

**Update.** Refresh the marketplace, update the plugin, then start a new session. A pinned marketplace stays on its tag; remove it and add it again with the new tag to move.

```bash
claude plugin marketplace update adlc-marketplace
```

```bash
claude plugin update adlc@adlc-marketplace
```

Read [CHANGELOG.md](../CHANGELOG.md) before updating: entries under "Changed (read before upgrading)" can need action.

**Settings.** The options under [Configuration](configuration.md) start unset (the defaults apply). Set them in a session with `/plugin configure adlc@adlc-marketplace`, or when installing with `--config KEY=VALUE`, for example:

```bash
claude plugin install adlc@adlc-marketplace --config guard_level=standard
```

**From a local clone (development):**

```bash
claude plugin marketplace add /path/to/adlc-plugin
```

```bash
claude plugin install adlc@adlc-marketplace
```

**For one session without installing (development):**

```bash
claude --plugin-dir /path/to/adlc-plugin/plugins/adlc
```

After changing plugin files, run `/reload-plugins` or start a new session.

**Recommended project permissions:** run `/adlc:setup` in your project. It shows what it will add to `.claude/settings.json` and `.gitignore`, asks you, and never removes your own settings. A plugin cannot ship permission rules itself. You can also copy the entries from [`plugins/adlc/settings-template.json`](https://github.com/roman-ambinder/adlc-plugin/blob/main/plugins/adlc/settings-template.json) by hand. The template:
- allows the routine `adlc` subcommands without a prompt;
- keeps commits, pushes, PRs, installs and publishing on `ask`;
- denies the Read tool on `.env`, keys and similar files (the guard hook also blocks them in Bash commands and Read calls).

`approve`, `skip`, `unblock`, `archive`, `cancel` and `lease` are deliberately left out of the allow list; your own slash command is what authorises the first five.
