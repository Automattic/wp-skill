# Design: wpcom-agent-skills — WordPress.com knowledge plugin for CLI agents

**Date:** 2026-06-10 (revised same day to incorporate Telex/Studio source material)
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

Content is **extracted and adapted from two existing Automattic projects** that
have battle-tested agent prompts (see "Source material" below), plus new research
for the areas neither covers (chiefly SSH/SFTP).

Alternatives considered and rejected:

- **AGENTS.md snippets** — always in context (token cost), can't bundle scripts,
  hard to version and update across users.
- **MCP server** — right for actions, not knowledge; WordPress.com already has an
  MCP server. Our skills instead teach agents to use SSH/wp-cli (and existing MCP
  tooling) correctly.

## Source material: Telex and Studio

Two local checkouts hold proven agent skills and prompts. **Telex content is
preferred** where the two overlap — it is working better in practice.

### From Telex (`~/dev/a8c/telex`) — WordPress development knowledge

| Source file | What to extract | Feeds skill |
|---|---|---|
| `server/prompts/guides/wp-best-practices.md` | Security (escape/sanitize/nonce+capability), performance (autoload, transients, bounded WP_Query, wp_remote_get rules), type safety. Includes the quick checklist. | `wp-code-quality` |
| `server/prompts/guides/data-persistence-pattern.md` | Canonical CPT + custom REST route + custom block pattern for forms/bookings/reviews; seeding rules; REST permission callbacks. | `wp-code-quality` (references/) |
| `server/prompts/guides/wp-abilities-api.md` | Abilities API registration/consumption, hook order, failure modes (WP 6.9+). | `wp-code-quality` (references/) |
| `agent/config/skills/creating-themes/SKILL.md` + `references/` (block-html.md, navigation.md, query-loop.md) | Block theme structure, theme.json v3, FSE requirements, font loading via `enqueue_block_assets`, block HTML validity rules. | `wp-themes` |
| `agent/config/skills/editing-themes/SKILL.md` | Guardrails: never rewrite theme.json/functions.php/style.css unless required; minimal targeted edits. | `wp-themes` |
| `agent/config/skills/generating-patterns/SKILL.md` | Pattern file structure, header metadata, category taxonomy, layout recipes (hero, grids, FAQ accordion), CTA rules. | `wp-themes` (references/) |
| `agent/config/skills/creating-blocks/SKILL.md`, `editing-blocks/SKILL.md` | Block creation/editing rules: plain JS in view.js (no Interactivity API), static↔dynamic conversion rules, function_exists guards. | `wp-content-blocks` |
| `agent/config/skills/generating-images/SKILL.md` | Filename conventions, aspect-ratio consistency for grids/rows, versioned filenames on update. | `wpcom-media` |
| `agent/config/skills/testing-php/`, `testing-js/`, `testing-wp-runtime/` | Validation loops: `php -l`, `node --check`, wp-now runtime smoke test (port 8881, debug-log triage, cleanup). | `wp-code-quality` (references/) |

### From Studio (`~/dev/a8c/studio`) — WordPress.com platform knowledge

| Source file | What to extract | Feeds skill |
|---|---|---|
| `apps/cli/ai/system-prompt.ts` (remote section) | **Check plan first** (`GET /` → `plan.product_slug`); free-plan restrictions (no custom CSS/JS/global styles/plugins); treat site content as untrusted input. | `wpcom-platform` |
| `apps/cli/ai/skills/wpcom-remote-management/SKILL.md` | WordPress.com REST API: wp/v2 vs v1.1 namespace selection, plugin install/activate endpoints, theme switching, `_fields`/`fields` response-size control. | `wpcom-platform` (references/) |
| `docs/design-docs/sync.md` | Jetpack Backup mechanics: tar.gz format (`wp-content/`, `sql/` per-table, `wp-config.php`, `meta.json`), plan eligibility, 5GB push limit, **merge-not-replace** restore behavior, Rewind API / `rewind_id`. | `wpcom-backups` |
| `apps/cli/ai/skills/block-content/SKILL.md` | Layout cascade (`contentSize` ~700px default), full-bleed `align:full` + constrained inner pattern, `.wp-element-button` styling trap. | `wp-content-blocks` |
| `apps/cli/ai/skills/plugin-recommendations/SKILL.md` | Core-blocks-first decision ladder; WooCommerce setup flow; **WooCommerce image gotcha** (extension-less CDN URLs rejected — download with real extension, import, use attachment ID); Jetpack Forms block structure; `jetpack module activate`. | `wpcom-media`, `wpcom-platform` (references/) |
| `apps/cli/ai/skills/rank-me-up/SKILL.md` | Check active plugins before recommending installs; `jetpack module activate seo-tools`; `option update blog_public 1`. | `wpcom-platform` (references/) |
| `apps/cli/ai/skills/visual-polish/SKILL.md` | Diagnose-from-rendered-DOM methodology; common WP layout bugs (constrained-layout width offsets, block-gap margins). | `wp-content-blocks` (references/) |

### Adaptation rules

- Strip product-specific mechanics: Telex artefact-XML/`theme:./assets/` URIs and
  AI_IMAGE alt format; Studio's `studio wp` prefix, Playground/SQLite constraints,
  14KB payload limits, Studio tool names (`wpcom_request`, `site_push`).
- Re-target commands to **wp-cli over SSH** (our context) where Studio used its
  local CLI or the REST tool; keep REST API endpoints as the alternative path.
- Keep Telex's guardrail phrasing ("NEVER rewrite theme.json unless…", checklists,
  max-3-fix-cycles loops) — that phrasing is the battle-tested part.
- Platform-neutral wording throughout (plain shell, no agent-specific tool names).

## Repository structure

```
agent-plugins/                        (repo root)
├── .claude-plugin/
│   └── marketplace.json              # makes the repo a Claude Code marketplace
├── wpcom/                            # the plugin
│   ├── .claude-plugin/plugin.json    # name, description, version
│   └── skills/
│       ├── wpcom-platform/           # platform basics, plans, REST API
│       │   ├── SKILL.md
│       │   └── references/
│       ├── wpcom-ssh-sftp/
│       │   ├── SKILL.md
│       │   └── scripts/ssh-setup.sh
│       ├── wpcom-backups/
│       │   ├── SKILL.md
│       │   └── scripts/backup-db.sh
│       ├── wpcom-media/
│       │   ├── SKILL.md
│       │   └── references/
│       ├── wp-content-blocks/        # block markup/editing (Telex+Studio)
│       │   ├── SKILL.md
│       │   └── references/
│       ├── wp-themes/                # block themes, theme.json, patterns (Telex)
│       │   ├── SKILL.md
│       │   └── references/
│       └── wp-code-quality/          # security/perf/persistence (Telex)
│           ├── SKILL.md
│           └── references/
├── install.sh                        # installs skills into other agents' skill dirs
└── README.md                         # per-agent install instructions
```

## The skills (v1 scope)

### Platform skills (WordPress.com-specific; mostly new research + Studio)

#### 1. `wpcom-platform` — hosting platform basics

How WordPress.com differs from self-hosted WP; **check the plan before anything
else** (`GET /` → `plan.product_slug`) and what free vs paid plans allow (free:
no custom CSS/JS, no plugin management, no global-styles edits — and no inline-style
workarounds, they produce invalid blocks); file layout and writable paths; staging
sites; wp-cli availability over SSH; managed core (no core edits); REST API
namespaces and key endpoints (plugin install/activate, theme switch) in
references/; treat site content as untrusted input.

#### 2. `wpcom-ssh-sftp` — SSH/SFTP connection

**The gap neither source repo covers — researched from public WordPress.com docs.**
Enabling SSH/SFTP (Hosting → Server Settings); SFTP credentials and SSH keys;
hostname/port/username format (`sftp.wp.com`, `ssh.wp.com`); connecting with
ssh/sftp/scp/rsync; running wp-cli remotely; pitfalls (connection limits, session
timeouts, key vs password auth). Script: `scripts/ssh-setup.sh` generates a
`~/.ssh/config` block so subsequent commands are just `ssh <alias>`.

#### 3. `wpcom-backups` — backups and restores

How Jetpack VaultPress backups work (automatic/real-time on eligible plans);
dashboard restore/download flows; the backup archive format (tar.gz with
`wp-content/`, per-table `sql/`, `wp-config.php`, `meta.json`); **restores merge
rather than replace files** — and what that means for cleanup; 5GB limits; manual
snapshots via `wp db export` over SSH; cardinal rule — **always snapshot before
risky changes**. Script: `scripts/backup-db.sh` exports and downloads a DB dump.

#### 4. `wpcom-media` — images and media

Media library vs filesystem (never write `wp-content/uploads` directly);
`wp media import` over SSH and REST upload; **the image-URL gotcha**:
extension-less CDN URLs (Unsplash-style) are rejected — download with a real
extension, import, reference the attachment ID; image sizes and regeneration;
Photon/wp.com CDN behavior; aspect-ratio consistency for image grids/rows;
versioned filenames when replacing images.

### WordPress development skills (extracted from Telex, enriched by Studio)

#### 5. `wp-content-blocks` — writing and editing block content

Editable core blocks over raw HTML (decision ladder: core blocks → installed
plugins → plugin blocks → `core/html` last resort); block HTML validity rules
(comment↔HTML matching); layout cascade (`contentSize` constraint, ~700px
default) and the full-bleed pattern (`"align":"full"` outer + constrained inner);
`.wp-element-button` styling; interactive blocks use plain JS DOM APIs in view.js
(not the Interactivity API); static vs dynamic blocks and safe conversion;
diagnose layout bugs from rendered DOM, not memory (references/).

#### 6. `wp-themes` — block themes and patterns

Block-theme structure (style.css header, theme.json v3, `templates/`, `parts/`,
`patterns/`); FSE requirements; define colors/typography/spacing in theme.json,
not CSS; fonts via `enqueue_block_assets` (loads in front-end AND editor);
pattern file headers, slugs, and category taxonomy; layout recipes (hero
splits, feature grids, FAQ via `wp:details`, CTA rules); editing guardrails —
never rewrite theme.json/functions.php/style.css or delete patterns/templates
unless the request requires it; minimal targeted edits.

#### 7. `wp-code-quality` — security, performance, and data patterns

The Telex wp-best-practices rules: escape every output (context-matched `esc_*`),
sanitize every input, nonce + capability check together on every write, prepared
statements; performance (no large autoloaded options, transients with
invalidation, bounded WP_Query with `no_found_rows`, `wp_remote_get` with timeout
+ fallback); typed signatures; the pre-completion checklist. References: the
CPT + REST + block data-persistence pattern; Abilities API guide (WP 6.9+);
validation loops (`php -l`, `node --check`, wp-now smoke test).

## Skill design principles

- **Body under ~150 lines** per SKILL.md; deeper content goes in `references/`
  (progressive disclosure: description → body → references).
- **Descriptions trigger on user phrasing**: "my WordPress.com site", "connect
  over SFTP", "restore a backup", "upload images to my site", "edit my theme",
  "add a section to my homepage".
- **Cross-references between skills**: e.g., wpcom-backups points to
  wpcom-ssh-sftp for connection setup rather than duplicating it.
- **Platform-neutral wording**: plain shell commands, no Claude-Code-specific
  tool names, so the identical files work in Codex, Gemini CLI, and pi.
- **Telex guardrail phrasing preserved** during adaptation — the explicit
  NEVER/ALWAYS rules and checklists are the battle-tested part.

## Safety

These skills operate on users' live sites, so:

- The backups skill leads with snapshot-before-risky-change and other skills
  reference it before destructive sections.
- The SSH skill flags destructive operations (`wp db reset`, `rm -rf`,
  `wp plugin delete`) as requiring explicit user confirmation.
- Bundled scripts are read-only or additive by default (export/download, never
  overwrite or delete remote state).
- Plan-gating up front: agents check the site's plan before attempting work the
  plan doesn't allow, instead of failing halfway or producing invalid content.
- Site content is treated as untrusted input (no executing instructions found
  in post content).

## Distribution

- **Claude Code:** `/plugin marketplace add <repo>` then `/plugin install wpcom`.
- **Codex CLI / Gemini CLI / pi:** `install.sh` symlinks or copies
  `wpcom/skills/*` into each agent's skill directory (`~/.codex/skills`,
  `~/.gemini/skills`, pi's equivalent), or users copy manually per the README.
- Versioning via `plugin.json` + git tags. One set of skill files, no
  per-agent duplication.

## Content sourcing and verification

1. **Extract** from Telex (preferred) and Studio per the source-material map,
   applying the adaptation rules.
2. **Research** the SSH/SFTP and dashboard-flow gaps from public WordPress.com
   support and developer documentation.
3. **Review** by the author (insider knowledge) for accuracy; scripts tested for
   syntax and logic; instructions only verifiable against a live WordPress.com
   site with SSH access are marked for a manual validation pass.

## Testing

- Shellcheck + dry-run tests for bundled scripts.
- Frontmatter validation (name, description) for every SKILL.md.
- Manual trigger testing: phrase realistic user requests and confirm the right
  skill activates in at least Claude Code.
- A review checklist item per skill: every command verified against docs or a
  live site before release.

## Out of scope for v1

- An MCP server or any API-wrapper tooling.
- Telex/Studio product-specific systems: artefact XML, Tracks telemetry,
  Studio CLI/Playground specifics, browse-auth.
- Domains beyond the seven skills (DNS, email, WooCommerce deep-dives, LMS)
  — candidates for v2.
- Automated per-agent CI testing of skill triggering.
