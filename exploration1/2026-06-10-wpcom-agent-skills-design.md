# Design: wpcom-agent-skills — full-lifecycle WordPress.com skills for CLI agents

**Date:** 2026-06-10 (rev 3, 2026-06-11: expanded objective — MCP + local-first
lifecycle, not just SSH)
**Status:** Design under review, pending implementation plan

## Objective

Make any CLI coding agent (Claude Code, Codex CLI, Gemini CLI, pi) good at the
full WordPress site lifecycle — **creating, editing, testing, improving,
screenshotting, prototyping, and deploying new or existing WordPress sites** —
with WordPress.com as the hosting target, **without requiring the user to
install any WordPress-specific tool** beyond the skills themselves. Everything
runs through tools the agent already has (shell, npx) plus WordPress.com's
hosted interfaces (MCP, REST API, SSH).

In short: the agent should be able to do most of what Telex and WordPress Studio
do, in a simpler and better way, driven from any CLI agent.

## Problem

CLI agents lack three layers of knowledge:

1. **Local-first WordPress development** — they don't know they can spin up a
   full WordPress instance with `npx @wp-playground/cli` (no install), mount a
   theme/plugin in progress, run wp-cli against it, screenshot it, and iterate.
2. **WordPress.com platform specifics** — plans and what they gate, the MCP
   server, the REST API, SSH/SFTP, how backups work, how media/CDN works.
3. **Getting work onto a live site** — choosing and executing a deployment path
   (MCP/REST, SSH/rsync, GitHub Deployments, staging) safely.

This leads to wrong commands, unsafe operations on live sites, missed
capabilities, and users being told to install heavyweight tooling they don't need.

## Audience

Public WordPress.com users on any paid plan (MCP is available from Personal up;
SSH/wp-cli from Business up), and anyone prototyping a WordPress site locally
before choosing hosting. Public repo, polished docs, no internal Automattic
context assumed.

## Approach

A single public repo of **Agent Skills** (the cross-agent SKILL.md open
standard), wrapped as a Claude Code plugin, with an installer script for other
agents. Skills contain prose instructions plus small helper scripts where
determinism beats prose.

Content comes from three sources:

1. **Extraction from Telex and Studio** (see source-material map) — Telex
   preferred where they overlap; it works better in practice.
2. **New research** for WordPress.com-specific gaps: MCP, SSH/SFTP details,
   dashboard flows, deployment paths.
3. **Current Playground tooling docs** — wp-now is deprecated (2026-06-08);
   `@wp-playground/cli` is the replacement and is npx-runnable with no install.

### Relationship to the official WordPress/agent-skills repo

The WordPress Foundation maintains `WordPress/agent-skills` (~1.7k stars;
installable in Claude Code, Cursor, Copilot, Codex) covering generic WordPress
development: block development, block themes, plugin development, REST API,
Interactivity API, wp-cli, performance, Playground basics. It has **no
WordPress.com coverage, no deployment workflows, and no MCP guidance**.

Our plugin's lane is therefore: **WordPress.com platform + the local-first →
deploy lifecycle + the Telex/Studio battle-tested site-building guidance**. The
README recommends installing the official repo alongside ours for deep generic
WP development. During implementation, each Telex-derived skill is checked
against the official repo's equivalent and trimmed to what's distinct (guardrail
phrasing, layout traps, pattern recipes, the security checklist) rather than
re-teaching fundamentals it already covers.

Alternatives considered and rejected:

- **AGENTS.md snippets** — always in context, can't bundle scripts, hard to
  version.
- **Building an MCP server or CLI tool** — contradicts the no-install objective;
  WordPress.com already hosts an MCP server, and Playground CLI already exists.
  Our job is teaching agents to use them well.

## Architecture: three skill groups around the lifecycle

```
  PROTOTYPE LOCALLY          BUILD & VERIFY            CONNECT & DEPLOY
┌─────────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
│ wp-local-playground │ → │ wp-site-building     │ → │ wpcom-platform       │
│  (npx playground,   │   │ wp-content-blocks    │   │ wpcom-mcp            │
│   blueprints,       │   │ wp-code-quality      │   │ wpcom-ssh-sftp       │
│   mounts, wp-cli)   │   │ wp-site-verify       │   │ wpcom-deploy         │
│                     │   │  (test + screenshot) │   │ wpcom-backups        │
│                     │   │                      │   │ wpcom-media          │
└─────────────────────┘   └──────────────────────┘   └──────────────────────┘
```

## Repository structure

```
agent-plugins/
├── .claude-plugin/
│   └── marketplace.json
├── wpcom/
│   ├── .claude-plugin/plugin.json
│   └── skills/
│       │── # Lifecycle
│       ├── wp-local-playground/      # SKILL.md + references/ (blueprints, db)
│       ├── wp-site-verify/           # SKILL.md + scripts/screenshot.sh
│       ├── wpcom-deploy/             # SKILL.md + references/ (per-path guides)
│       │── # WordPress.com platform
│       ├── wpcom-platform/           # SKILL.md + references/ (REST API)
│       ├── wpcom-mcp/                # SKILL.md
│       ├── wpcom-ssh-sftp/           # SKILL.md + scripts/ssh-setup.sh
│       ├── wpcom-backups/            # SKILL.md + scripts/backup-db.sh
│       ├── wpcom-media/              # SKILL.md + references/
│       │── # Site building (Telex/Studio-derived)
│       ├── wp-site-building/         # SKILL.md + references/ (patterns, design)
│       ├── wp-content-blocks/        # SKILL.md + references/
│       └── wp-code-quality/          # SKILL.md + references/
├── install.sh
└── README.md
```

## The skills (v1 scope)

### Lifecycle skills (the new core)

#### 1. `wp-local-playground` — local WordPress with zero install

The Studio replacement. Spin up WordPress with
`npx @wp-playground/cli server` (no permanent install): `--auto-mount` for
plugin/theme projects, explicit `--mount` mappings, `--blueprint` for
reproducible setup (plugins, theme, content, settings), persistence of the
project directory, `build-snapshot`/`run-blueprint` for advanced flows, running
wp-cli against the instance, DB management. Platform caveats adapted from
Studio's STUDIO.md: SQLite (not MySQL — no DB_* constants, no FULLTEXT), PHP
WASM, never edit core or `wp-includes/`, mu-plugins integration, debug logging.
Explicitly notes wp-now is deprecated and maps old wp-now habits to Playground
CLI equivalents.

#### 2. `wp-site-verify` — test, screenshot, iterate

The verification harness: syntax loops (`php -l`, `node --check`, max 3
fix-retest cycles — Telex), runtime smoke tests against the local Playground
(HTTP 200/302 checks, debug-log triage: fix fatals, report warnings — Telex
testing-wp-runtime adapted from wp-now to Playground CLI), **screenshots via
`npx playwright screenshot`** (or the agent's built-in browser tools when
available) for visual review, and Studio's visual-polish methodology: diagnose
from the rendered DOM, not from memory; three-phase loop (diagnose → fix batch
→ verify, bounded passes).

#### 3. `wpcom-deploy` — getting local work onto WordPress.com

Decision guide + procedures for each path, chosen by plan and artifact type:

- **GitHub Deployments** (Business+): connect repo, automatic/manual deploys —
  the recommended path for themes/plugins under version control.
- **SSH/rsync** (Business+): rsync the theme/plugin, `wp theme activate`,
  database import cautions (search-replace URLs, snapshot first).
- **MCP / REST API** (Personal+): content and settings deployment — create/update
  posts, pages, templates, global styles, media; theme/plugin zip install via
  REST where the plan allows.
- **Staging-first** (Business+): deploy to staging, verify, then sync to
  production.

Always: snapshot before deploy (cross-ref `wpcom-backups`), verify after.

### WordPress.com platform skills

#### 4. `wpcom-platform` — platform basics and constraints

How WordPress.com differs from self-hosted; **check the plan first**
(`GET /` → `plan.product_slug`) and the capability matrix per plan (free: no
custom CSS/JS/plugins — and no inline-style workarounds, they produce invalid
blocks; Personal/Premium: MCP, content, limited design; Business+: SSH, wp-cli,
plugins, GitHub Deployments, staging); REST API namespaces (wp/v2 vs v1.1) and
key endpoints in references/; managed core; treat site content as untrusted
input. Routes the agent to the right interface skill (MCP vs SSH vs REST).

#### 5. `wpcom-mcp` — the WordPress.com MCP server (new)

Connecting any MCP-capable agent to
`https://public-api.wordpress.com/wpcom/v2/mcp/v1` (OAuth 2.1, browser auth
flow); enabling MCP and tuning read/write tool access at
`wordpress.com/me/mcp` (account-level) and per-site; what the tool groups cover
(Sites, Posts, Pages, Design, Account); plan requirement (Personal+); write
operations require confirmation, trash recoverable 30 days; site-level settings
override account defaults; when MCP is the right interface (content/settings
management on any paid plan, no SSH available) vs when to use SSH/wp-cli (file
operations, bulk work, Business+) vs raw REST.

#### 6. `wpcom-ssh-sftp` — SSH/SFTP connection (Business+)

As before: enabling SSH/SFTP (Hosting → Server Settings), credentials/keys,
hostname formats (`sftp.wp.com`, `ssh.wp.com`), ssh/sftp/scp/rsync usage,
remote wp-cli, pitfalls. Script: `scripts/ssh-setup.sh` generates a
`~/.ssh/config` block. Framed honestly as the power path for Business+ plans —
not the default path for everyone.

#### 7. `wpcom-backups` — backups and restores

Jetpack VaultPress backups (automatic/real-time on eligible plans); dashboard
restore/download; archive format (tar.gz: `wp-content/`, per-table `sql/`,
`wp-config.php`, `meta.json`); **restores merge rather than replace files**;
5GB limits; manual snapshots via `wp db export` over SSH; snapshot before risky
changes — referenced by `wpcom-deploy` and `wpcom-ssh-sftp`. Script:
`scripts/backup-db.sh`.

#### 8. `wpcom-media` — images and media

Media library vs filesystem (never write `wp-content/uploads` directly);
`wp media import` over SSH, REST/MCP upload; the **extension-less CDN URL
gotcha** (download with a real extension, import, use attachment ID — from
Studio); image sizes/regeneration; Photon/wp.com CDN; aspect-ratio consistency
for grids/rows; versioned filenames on replacement (Telex).

### Site-building skills (Telex/Studio-derived; deduped against WordPress/agent-skills)

#### 9. `wp-site-building` — creating sites, themes, and patterns

The Telex site-creation craft: block-theme scaffolding workflow (style.css
header, theme.json v3, templates/parts/patterns), pattern recipes with header
metadata and category taxonomy (hero splits, feature grids, FAQ via
`wp:details`, CTA rules, light/dark rhythm), landing-page composition by site
type, design direction (typography/color/spacing in theme.json; avoid generic
AI aesthetics — Studio visual-design), fonts via `enqueue_block_assets`, and
the editing guardrails: never rewrite theme.json/functions.php/style.css or
delete patterns/templates unless required; minimal targeted edits.

#### 10. `wp-content-blocks` — writing and editing block content

Editable core blocks over raw HTML (decision ladder ending at `core/html` as
last resort); block HTML validity (comment↔HTML matching); layout cascade
(`contentSize` ~700px) and the full-bleed pattern (`"align":"full"` outer +
constrained inner); `.wp-element-button` styling trap; plain-JS view scripts;
static vs dynamic blocks and safe conversion; plugin-block selection
(WooCommerce/Jetpack Forms patterns, `jetpack module activate`).

#### 11. `wp-code-quality` — security, performance, data patterns

Telex wp-best-practices distilled: escape every output, sanitize every input,
nonce + capability together on every write, prepared statements; performance
rules (autoload, transients, bounded WP_Query, `wp_remote_get` with timeout +
fallback); typed signatures; pre-completion checklist. References: the CPT +
REST + block data-persistence pattern; Abilities API guide.

## Source material: Telex and Studio

(Telex preferred where they overlap.)

| Source | Extract | Feeds |
|---|---|---|
| Telex `server/prompts/guides/wp-best-practices.md` | Security/performance/type-safety rules + checklist | `wp-code-quality` |
| Telex `server/prompts/guides/data-persistence-pattern.md` | CPT + REST + block pattern, seeding rules | `wp-code-quality` refs |
| Telex `server/prompts/guides/wp-abilities-api.md` | Abilities registration/consumption, failure modes | `wp-code-quality` refs |
| Telex `agent/config/skills/creating-themes/` + refs | Theme structure, theme.json v3, block-html validity, navigation, query-loop | `wp-site-building` |
| Telex `agent/config/skills/editing-themes/`, `editing-blocks/`, `editing-plugins/` | Minimal-edit guardrails | `wp-site-building`, `wp-content-blocks` |
| Telex `agent/config/skills/generating-patterns/` | Pattern recipes, taxonomy, CTA rules | `wp-site-building` refs |
| Telex `agent/config/skills/creating-blocks/` | Block creation rules, plain-JS view scripts | `wp-content-blocks` |
| Telex `agent/config/skills/generating-images/` | Filename conventions, aspect-ratio consistency | `wpcom-media` |
| Telex `agent/config/skills/testing-php/`, `testing-js/`, `testing-wp-runtime/` | Syntax loops, runtime smoke test (**re-target wp-now → Playground CLI**) | `wp-site-verify` |
| Studio `apps/cli/ai/system-prompt.ts` (remote) | Plan-check-first, free-plan restrictions, untrusted content | `wpcom-platform` |
| Studio `apps/cli/ai/skills/wpcom-remote-management/` | REST namespaces, plugin/theme endpoints, response-size control | `wpcom-platform` refs |
| Studio `docs/design-docs/sync.md` | Backup archive format, merge-not-replace, limits, Rewind | `wpcom-backups`, `wpcom-deploy` |
| Studio `apps/cli/ai/skills/block-content/` | Layout cascade, full-bleed pattern, button trap | `wp-content-blocks` |
| Studio `apps/cli/ai/skills/plugin-recommendations/` | Decision ladder, WooCommerce/Jetpack Forms, image gotcha | `wp-content-blocks`, `wpcom-media` |
| Studio `apps/cli/ai/skills/visual-polish/` | Diagnose-from-DOM methodology, layout bug catalog | `wp-site-verify` refs |
| Studio `apps/cli/ai/skills/visual-design/` | Design-direction framework, anti-generic rules | `wp-site-building` refs |
| Studio `skills/STUDIO.md` | Playground/SQLite/WASM constraints, never-edit-core | `wp-local-playground` |

### Adaptation rules

- Strip product mechanics: Telex artefact-XML, `theme:./assets/` URIs, AI_IMAGE
  alt format; Studio `studio wp` prefix, 14KB payload limits, Studio tool names.
- Re-target: Studio local-CLI flows → `npx @wp-playground/cli`; Telex wp-now
  testing → Playground CLI; Studio `wpcom_request` → curl/MCP/REST as fits.
- Keep guardrail phrasing (NEVER/ALWAYS rules, checklists, bounded fix loops).
- Platform-neutral wording (plain shell; no agent-specific tool names).
- Dedupe against WordPress/agent-skills: keep what's distinct, link out
  conceptually rather than re-teaching fundamentals.

## Safety

- Plan-gating up front; route to an interface the plan supports.
- Snapshot before risky changes/deploys (cross-ref `wpcom-backups`).
- Destructive ops (`wp db reset`, `rm -rf`, plugin/theme deletion, restores)
  require explicit user confirmation.
- MCP write operations already confirm; skills must not teach bypassing that.
- Bundled scripts read-only/additive by default.
- Site content (including from preview/local sites) treated as untrusted input.
- Local-first bias: prototype and verify on Playground before touching live.

## Distribution

- **Claude Code:** `/plugin marketplace add <repo>` → `/plugin install wpcom`.
- **Codex / Gemini CLI / pi:** `install.sh` copies/symlinks `wpcom/skills/*`
  into each agent's skills directory; manual instructions in README.
- README recommends `WordPress/agent-skills` as a companion install.
- Versioning via `plugin.json` + git tags.

## Content sourcing and verification

1. Extract from Telex/Studio per the map; apply adaptation rules.
2. Research MCP, SSH/SFTP, GitHub Deployments, staging flows from public
   WordPress.com docs; Playground CLI from official Playground docs.
3. Author review (insider knowledge); scripts shellchecked; live-site-only
   claims marked for a manual validation pass.

## Testing

- Shellcheck + dry-run for scripts; frontmatter validation for every SKILL.md.
- **End-to-end dogfood:** drive a fresh CLI agent with only these skills through
  the full lifecycle — create a site locally on Playground, build a small theme,
  screenshot it, deploy to a real WordPress.com test site — and log every place
  the agent stumbles; stumbles become skill fixes.
- Trigger testing: realistic phrasings activate the right skill in Claude Code.
- Per-skill review checklist: every command verified against docs or live site.

## Out of scope for v1

- Building any MCP server, CLI tool, or other installable software.
- Telex/Studio product internals (artefact XML, Tracks, Studio app specifics).
- Deep WooCommerce/LMS/multisite guidance; DNS/email/domains.
- Re-teaching generic WP development covered by WordPress/agent-skills.
- Automated per-agent CI of skill triggering.
