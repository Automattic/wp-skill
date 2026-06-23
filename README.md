# WordPress Skill

An [agent skill](https://agentskills.io) that teaches coding agents (Claude Code, Codex, etc.) how to build and edit WordPress sites **locally, safely, and with valid block markup**.

The skill lives in [`wordpress/`](wordpress/) and covers:

- **Local site lifecycle** — run disposable WordPress sites on [WordPress Playground](https://wordpress.org/playground/) via `scripts/playground.sh` (bootstrap, ensure, wp-cli, stop). No Docker, no hand-rolled stacks.
- **Block markup** — rules for writing valid Gutenberg block markup, plus two verification gates: `validate-blocks.cjs` (static file check) and `editor-gate.mjs` (live-editor check), since invalid blocks render fine on the frontend and only break in the editor.
- **Block themes and patterns** — theme structure, `theme.json`, fonts, patterns, navigation, query loops.
- **Design workflow** — for new sites or redesigns, users pick from rendered HTML previews in a browser, never from text descriptions or ASCII mockups.
- **Backup discipline** — destructive operations on production sites require a verified backup manifest first.
- **Image generation** — real AI-generated images through the user's own WordPress.com login (OAuth2 token paste, generated server-side by Gemini) via `scripts/wpcom-images.mjs`: informed consent before any image markup, deliberately imageless designs on decline, placeholder-based resume on failure. Limited to Automatticians during launch.

Deploying to WordPress.com is not yet supported — the skill is otherwise local-first; image generation is the one feature that calls out (to the WordPress.com AI image endpoint, as the user).

## Layout

```
wordpress/
├── SKILL.md                 # Entry point: routing table + non-negotiable rules
├── references/              # Detail docs loaded on demand by the agent
│   ├── local-sites.md
│   ├── block-markup.md
│   ├── themes-and-patterns.md
│   ├── design.md
│   ├── backups-and-safety.md
│   └── images-media.md
└── scripts/
    ├── playground.sh        # Local WordPress Playground lifecycle + wp-cli
    ├── wpcom-images.mjs     # AI image generation via WordPress.com (OAuth token-paste auth)
    ├── wpcom-backup.sh      # Backup helper
    └── checker/             # Block validation tooling
        ├── validate-blocks.cjs
        └── editor-gate.mjs
```

Requirements: Node 18+ and a POSIX shell (macOS/Linux/WSL).

## Testing the skill

To test changes, symlink the `wordpress/` directory into the skills folder of a test project, then start your agent in that project and give it WordPress tasks (e.g. "create a local WordPress site with a custom block theme").

> **Clone to a persistent location, not `/tmp`.** The agent runs the skill's scripts (`playground.sh ensure`, the two gates, `wpcom-images.mjs`) throughout a build *and* in later sessions to relaunch the site. If the clone (and the symlink target) live in `/tmp`, they get wiped between sessions — and a later "restart my site" then fails with `playground.sh: No such file or directory` even though the Playground **data** survives (only the scripts are gone). Clone into your home or project tree (e.g. `~/src/wp-skill`) and symlink from there.

### Claude Code

```bash
mkdir -p /path/to/test-project/.claude/skills
ln -s "$(pwd)/wordpress" /path/to/test-project/.claude/skills/wordpress
```

### Codex

```bash
mkdir -p /path/to/test-project/.codex/skills
ln -s "$(pwd)/wordpress" /path/to/test-project/.codex/skills/wordpress
```

(Or globally: `ln -s "$(pwd)/wordpress" ~/.codex/skills/wordpress`.)

### Other agents

Any agent that follows the skills convention works the same way — symlink `wordpress/` into its skills directory, e.g. `.agents/skills/` (shared convention), `.pi/skills/` (pi), or `~/.claude/skills/` for a global Claude Code install.

Because it's a symlink, edits in this repo are picked up immediately — just start a new agent session and verify the skill triggers (the agent should read `wordpress/SKILL.md` and route to the relevant reference file).

### What to check

- The skill triggers on WordPress-related prompts.
- The agent uses `scripts/playground.sh` for local sites (never Docker/wp-now).
- Block edits pass both gates: `validate-blocks.cjs` and `editor-gate.mjs`.
- Servers it started are stopped cleanly (`playground.sh stop` prints "stopped clean").
