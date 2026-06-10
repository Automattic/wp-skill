# Design: wpcom-agent-skills — WordPress.com knowledge plugin for CLI agents

**Date:** 2026-06-10
**Status:** Approved design, pending implementation plan

## Problem

CLI coding agents (Claude Code, Codex CLI, Gemini CLI, pi) lack specific knowledge
about the WordPress.com hosting platform. When users point an agent at their
WordPress.com site, the agent doesn't know: how the SSH/SFTP connection works and
how to enable it, what parts of the filesystem are writable, how WordPress.com
backups (Jetpack VaultPress) work, how media/images should be handled, or how the
platform differs from self-hosted WordPress. This leads to wrong commands, unsafe
operations on live sites, and wasted exploration.

## Audience

Public WordPress.com users — anyone with a site on a plan that includes SSH access
(Business/Commerce or current equivalents). The repo is public, docs are polished,
and no internal Automattic context is assumed.

## Approach

A single public repo of **Agent Skills** (the cross-agent SKILL.md open standard,
supported by Claude Code, Codex CLI, Gemini CLI, pi, Copilot, Cursor, and others),
wrapped as a Claude Code plugin for one-command install there, with an installer
script for the other agents. Skills contain prose instructions plus small
executable helper scripts where determinism beats prose.

Alternatives considered and rejected:

- **AGENTS.md snippets** — always in context (token cost), can't bundle scripts,
  hard to version and update across users.
- **MCP server** — right for actions, not knowledge; WordPress.com already has an
  MCP server. Our skills instead teach agents to use SSH/wp-cli (and existing MCP
  tooling) correctly.

## Repository structure

```
agent-plugins/                        (repo root)
├── .claude-plugin/
│   └── marketplace.json              # makes the repo a Claude Code marketplace
├── wpcom/                            # the plugin
│   ├── .claude-plugin/plugin.json    # name, description, version
│   └── skills/
│       ├── wpcom-platform/
│       │   └── SKILL.md
│       ├── wpcom-ssh-sftp/
│       │   ├── SKILL.md
│       │   └── scripts/ssh-setup.sh
│       ├── wpcom-backups/
│       │   ├── SKILL.md
│       │   └── scripts/backup-db.sh
│       └── wpcom-media/
│           ├── SKILL.md
│           └── references/           # deeper docs loaded on demand
├── install.sh                        # installs skills into other agents' skill dirs
└── README.md                         # per-agent install instructions
```

## The four skills (v1 scope)

### 1. `wpcom-platform` — hosting platform basics

The foundation skill. Covers: how WordPress.com hosting differs from self-hosted
WordPress; plan requirements for SSH/plugin access; file layout and which paths
are writable; staging sites and how to use them; wp-cli availability over SSH;
platform constraints (managed core updates, restricted plugins, no root access).

### 2. `wpcom-ssh-sftp` — SSH/SFTP connection

Covers: enabling SSH/SFTP in the dashboard (Hosting → Server Settings); creating
SFTP credentials and adding SSH keys; hostname/port/username format; connecting
with ssh/sftp/scp/rsync; running wp-cli remotely; common pitfalls (connection
limits, session timeouts, key vs password auth).

Script: `scripts/ssh-setup.sh` — given a site, generates a `~/.ssh/config` block
so subsequent commands are just `ssh <alias>`.

### 3. `wpcom-backups` — backups and restores

Covers: how Jetpack VaultPress backups work on WordPress.com (automatic, real-time
on eligible plans); viewing/downloading/restoring from the dashboard; manual
database and file snapshots via wp-cli over SSH; and the cardinal rule — **always
take a snapshot before any risky change**.

Script: `scripts/backup-db.sh` — runs `wp db export` over SSH and downloads the
dump locally.

### 4. `wpcom-media` — images and media

Covers: media library vs filesystem (why direct `wp-content/uploads` writes are
wrong); importing images with `wp media import` over SSH or the REST API; image
sizes and regeneration; the Photon/wp.com CDN and what it means for image URLs;
workflows for generating images for posts/pages and attaching them correctly.

Deeper material (size reference tables, CDN URL parameters) lives in
`references/` and is loaded only when needed.

## Skill design principles

- **Body under ~150 lines** per SKILL.md; deeper content goes in `references/`
  (progressive disclosure: description → body → references).
- **Descriptions trigger on user phrasing**: "my WordPress.com site", "connect
  over SFTP", "restore a backup", "upload images to my site".
- **Cross-references between skills**: e.g., wpcom-backups points to
  wpcom-ssh-sftp for connection setup rather than duplicating it.
- **Platform-neutral wording**: plain shell commands, no Claude-Code-specific
  tool names, so the identical files work in Codex, Gemini CLI, and pi.

## Safety

These skills operate on users' live sites, so:

- The backups skill leads with snapshot-before-risky-change and other skills
  reference it before destructive sections.
- The SSH skill flags destructive operations (`wp db reset`, `rm -rf`,
  `wp plugin delete`) as requiring explicit user confirmation.
- Bundled scripts are read-only or additive by default (export/download, never
  overwrite or delete remote state).

## Distribution

- **Claude Code:** `/plugin marketplace add <repo>` then `/plugin install wpcom`.
- **Codex CLI / Gemini CLI / pi:** `install.sh` symlinks or copies
  `wpcom/skills/*` into each agent's skill directory (`~/.codex/skills`,
  `~/.gemini/skills`, pi's equivalent), or users copy manually per the README.
- Versioning via `plugin.json` + git tags. One set of skill files, no
  per-agent duplication.

## Content sourcing and verification

Content is drafted from public WordPress.com support and developer documentation,
then reviewed by the author (who has insider knowledge) for accuracy. Scripts are
tested for syntax and logic; any instruction that can only be verified against a
live WordPress.com site with SSH access is marked for a manual validation pass.

## Testing

- Shellcheck + dry-run tests for bundled scripts.
- Frontmatter validation (name, description) for every SKILL.md.
- Manual trigger testing: phrase realistic user requests and confirm the right
  skill activates in at least Claude Code.
- A review checklist item per skill: every command verified against docs or a
  live site before release.

## Out of scope for v1

- An MCP server or any API-wrapper tooling.
- Domains beyond the four skills (DNS, email, themes/plugin development
  workflows) — candidates for v2.
- Automated per-agent CI testing of skill triggering.
