# WordPress Agent Skill — Plan (v3)

## Thesis

We may be overcomplicating things. Any capable CLI agent (Claude Code, Codex, Gemini CLI, pi) can
do what WordPress Studio and Telex do with **little more than a skill**: create, edit, test,
screenshot, prototype, and deploy WordPress sites — locally first (WordPress Playground) and on
WordPress.com (MCP, REST API, SSH/SFTP) — without the user installing any dedicated WordPress tool.

**The goal is NOT to reproduce Telex or improve Studio.** It is to guide the agent in the best way
possible around creating and modifying WordPress sites. Telex and Studio are quarries to mine for
what worked, not specs to match.

Guiding principles (from team discussion, 2026-06):

- **Bet on the model.** Describe goals, commands, and facts — not step-by-step procedures the
  agent can figure out. Content should leverage models getting better, not compensate for them.
- **One skill, modular parts.** Modularity to avoid polluting context: a thin SKILL.md router plus
  task-grouped references with good, brief descriptions. The agent loads the right parts.
- **Write content only for actual failure points.** A vanilla agent already knows theme.json,
  wp-cli, and REST basics. Discover what it gets wrong empirically; document only that.
- **Safety is the exception.** Backup/destructive-op discipline stays explicit and prescriptive.
  "The agent is smart enough" is the wrong bet for production data.

Source projects:

- Telex: `~/dev/a8c/telex` — skills in `agent/config/skills/`, prompts in `agent/config/prompts/`
- Studio: `~/dev/a8c/studio` — skills in `apps/cli/ai/skills/` and `wp-files/skills/`

---

## Phase 1 — Baseline eval + toolchain spike (day 1–2)

Run representative tasks with a **bare agent, no skill**, and record exactly where it fails.
Simultaneously verify the toolchain claims the skill will rely on. Output:
`exploration2/spike-notes.md` with a concrete failure-point list.

### Eval tasks (bare agent)

1. "Create a local WordPress site and show me it running" — does it find/choose
   `npx @wp-playground/cli` or wp-now on its own? Mount semantics? Cleanup?
2. "Build a landing-page block theme for a coffee shop" — block markup validity (the classic
   "invalid content" errors), theme.json correctness, design quality (AI-slop check).
3. "Screenshot the site on desktop and mobile and fix layout issues" — does it reach for
   Playwright? Can it diagnose from rendered DOM?
4. "Connect to my WordPress.com site over SSH and list installed plugins" — host/username
   conventions, htdocs path, wp-cli invocation.
5. "Replace the hero image on my live site" — media-library registration trap, CDN caching trap.
6. "Deploy this local theme to my WordPress.com site" — backup discipline, activation,
   URL search-replace, cache flush, verification.
7. "Set up the WordPress.com MCP and create a draft post through it."

### Toolchain spike (verify, don't assume)

- `npx @wp-playground/cli server`: exists? `--mount` for live-editing a theme dir?
  persistence? startup time/size?
- Local wp-cli (**partially verified 2026-06-11**): the CLI exposes no wp-cli command, and the
  blueprint `wp-cli` step swallows stdout (exit 0, no output). The working recipe is running the
  phar through Playground's `php` command against a host-persisted site:

  ```bash
  curl -sLO https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar
  npx @wp-playground/cli php \
    --mount-before-install=./site:/wordpress \
    --wordpress-install-mode=install-from-existing-files-if-needed \
    --mount=.:/host -- /host/wp-cli.phar <command>
  ```

  Verified: visible stdout, args pass through, state persists across invocations (~5s/run), and
  the same mounted site dir serves `server`. Faster fallback (~2s): `npx @php-wasm/cli
  wp-cli.phar <command>` from the site root — but only if the site dir is self-contained
  (`wp-content/db.php` SQLite drop-in present). Playground injects SQLite in the VFS only, so the
  drop-in must be installed manually, and the generated `db.php` hardcodes an absolute host path —
  never deploy it.
- **Open spike question**: concurrent access — a one-off wp-cli process and a running server share
  one `.ht.sqlite` through independent WASM filesystems. Test whether a concurrent write corrupts,
  errors, or works; until then the rule is "stop the server before one-off wp-cli writes".
- wp-now: still maintained? Good enough as the simpler fallback?
- `npx playwright`: minimal footprint for screenshots (browser download, headless flags).
- **Editor-side block validation recipe**: Studio's `validate_and_fix_blocks` is not backend
  magic — it opens `post-new.php` in a browser and runs `wp.blocks.parse()` +
  `wp.blocks.validateBlock()` via `page.evaluate` (see Studio
  `apps/cli/ai/block-validator.ts`; "the same save-function comparison the Gutenberg editor
  performs on load"), with auto-fix = the editor's own re-serialization. Spike: reproduce this
  as a Playwright snippet against a Playground site (auto-login makes wp-admin reachable).
  If it works, it closes the worst silent-failure gap — invalid blocks render fine on the
  frontend and only break in the editor, so screenshot-based verification alone cannot catch
  them.
- **Preview/share path**: Studio's WP.com preview sites are backend-tied and not replicable.
  Spike whether `build-snapshot` + a Playground blueprint URL is a good-enough shareable
  preview; otherwise "previews" = deploy to a real staging site.
- WP.com MCP (https://wordpress.com/support/mcp/): actual tool surface, auth flow, per-agent setup.
- WP.com SSH: confirm host names, username format, htdocs layout, what's writable, rsync
  availability, session limits. (Verify with a real test site — don't write these from memory.)
- Playground vs real hosting differences (PHP extensions, cron, mail) — note honestly.

### Expected failure points (hypotheses to confirm, based on Telex/Studio experience)

- Block markup validity: JSON ↔ class matching, one root element, no `<style>` tags.
- Layout cascade: `is-layout-constrained`, full-width sections, `.wp-element-button` padding.
- Design quality: generic "AI slop" output without direction.
- WP.com platform facts: `sftp.wp.com`, username format, read-only areas, plan gating,
  Photon/CDN caching, media files SFTP'd into uploads aren't in the media library.
- Server lifecycle hygiene: background processes left running, port conflicts.
- Local wp-cli: bare agent assumes a working `wp` binary locally; Playground has none — it must
  use the phar-over-`php` recipe (confirmed: blueprint `wp-cli` step exits 0 with no stdout —
  a silent failure the skill must preempt).
- Deployment safety: skipping backups, running search-replace without dry-run.

---

## Phase 2 — One skill: `wordpress/`

```
wordpress/
├── SKILL.md                        # Thin router + non-negotiable safety rules
└── references/                     # Written against Phase 1 failure list; candidates below
    ├── local-sites.md              # Playground/wp-now: bootstrap, mount, blueprints, lifecycle,
    │                               #   wp-cli via `php -- /host/wp-cli.phar` recipe (incl.
    │                               #   server-vs-one-off concurrency rule), runtime validation
    │                               #   loop, Playground-vs-production diffs
    ├── block-markup.md             # Block HTML validity + layout cascade (Telex block-html.md
    │                               #   merged with Studio block-content; the highest-value content)
    │                               #   + editor-validation loop: Playwright → post-new.php →
    │                               #   wp.blocks.validateBlock() (the Studio harness recipe —
    │                               #   mandatory before declaring theme/pattern work done)
    ├── themes-and-patterns.md      # Theme structure, theme.json v3, fonts, patterns, navigation,
    │                               #   query loops (Telex creating-themes + generating-patterns
    │                               #   + navigation.md + query-loop.md, filtered)
    ├── blocks-and-plugins.md       # Custom block/plugin dev: block.json, Interactivity API,
    │                               #   build with @wordpress/scripts (Telex blocks/plugins refs)
    ├── design.md                   # Design direction + anti-AI-slop rules (Telex
    │                               #   design-direction.md) + screenshot-diagnose-batch-fix loop
    │                               #   (Studio visual-polish, rebuilt on Playwright)
    ├── images-media.md             # Image conventions (Telex generating-images, de-Telexed),
    │                               #   wp media import, CDN cache / filename versioning
    ├── wordpress-com.md            # Channels (MCP / REST / SSH) + decision table, connection,
    │                               #   htdocs, platform limits, plan gating
    │                               #   (Studio wpcom-remote-management → curl; new SSH content)
    ├── backups-and-safety.md       # Jetpack backups, db-export + off-host tarball discipline,
    │                               #   guardrail sequence (Studio wp-wpcli-and-ops, retargeted)
    └── deploy.md                   # Local ↔ WP.com push/pull: backup → push → register media →
                                    #   search-replace (dry-run) → flush → screenshot-verify
```

Final reference list is decided by Phase 1 results — merge, drop, or add files based on what the
bare agent actually got wrong. The list above is the hypothesis.

### SKILL.md design

- Frontmatter `description` triggers on: WordPress site creation/editing, themes, blocks,
  Gutenberg, WordPress.com, wp-cli, Playground, deploying WordPress.
- Body (short): what the skill covers, the routing table (task → reference), and the safety rules:
  - Local sites are disposable; remote sites are not.
  - Backup (db export + changed files, copied off-host) before any destructive remote operation.
  - Never edit WordPress core. Confirm production writes. Dry-run search-replace first.
  - Always stop local servers you started.
- No wrapper scripts. Document raw commands; the agent composes them. Exception: if Phase 1 shows
  the backup sequence is error-prone, ship a single `scripts/wpcom-backup.sh` (determinism as a
  safety property). Nothing else.

### Content filter (applies to every extracted paragraph)

> Would a strong agent get this wrong without being told?

- **Keep — durable facts agents can't infer**: block JSON ↔ class matching, media registration
  over SFTP, Photon caching, `enqueue_block_assets` vs `wp_enqueue_scripts`, `sftp.wp.com`
  conventions, `is-layout-constrained` cascade, plan gating, pattern header format.
- **Drop — product policy / weak-model compensation**: Telex's "only index.html initially",
  fixed port 8881, one-project-type-only rules, output-style/narration rules, "never run builds"
  (our agent does run `npm run build`), subagent delegation, footer credit, `AI_IMAGE:` backend
  markers, `theme:./assets/` prefixes; Studio's `wpcom_request`/`take_screenshot`/
  `validate_and_fix_blocks`/`studio wp` tool references.
- **Rewrite as goals, not steps**: validation loops, polish methodology, deployment flow — state
  the sequence and the why; don't script every command.

### Extraction menu (mine on demand — not a porting backlog)

| Priority | Source | What it's for |
|---|---|---|
| High | Telex `creating-themes/references/block-html.md` + telex.md validity rules | block-markup.md |
| High | Studio `block-content` (layout cascade, `.wp-element-button`) | block-markup.md |
| High | Telex `creating-themes` + `references/design-direction.md` | themes-and-patterns.md, design.md |
| High | Studio `wp-files/skills/wp-wpcli-and-ops` + references/safety, search-replace | backups-and-safety.md, deploy.md |
| High | Telex `testing-wp-runtime` (server → curl → debug.log → cleanup loop) | local-sites.md |
| Med | Telex `generating-patterns`, `navigation.md`, `query-loop.md` | themes-and-patterns.md |
| Med | Telex blocks/plugins skills + inner-blocks, interactivity-api refs | blocks-and-plugins.md |
| Med | Studio `wpcom-remote-management` (API namespace map, `_fields` trimming) | wordpress-com.md |
| Med | Studio `visual-polish` (diagnose-all → batch-fix methodology) | design.md |
| Med | Telex `generating-images` (prompt/aspect conventions, `-v2` versioning) | images-media.md |
| Low | Studio `plugin-recommendations`, `rank-me-up`, `need-for-speed`, `taxonomist` | possible follow-up skills, post-v1 |
| Skip | Studio `annotate`, `site-spec`, `studio-cli`; Telex output-style/subagent/build rules | product behavior, not knowledge |

---

### Studio harness parity map (recreate as recipes, not tools)

The Studio CLI harness (`apps/cli/ai/tools/`) is the closest existing product to what this skill
targets. Principle: every harness tool the skill needs must collapse into a documented recipe
over stock npx tools — the user installs nothing. Current mapping:

| Studio tool | Skill equivalent | Status |
|---|---|---|
| site lifecycle, `studio wp` | `npx @wp-playground/cli` + wp-cli phar recipe | verified |
| `take_screenshot` | `npx playwright screenshot` | verified |
| `validate_and_fix_blocks` | Playwright → `wp.blocks.validateBlock()` in editor | spike (recipe identified) |
| `inspect_design` | Playwright `page.evaluate` (DOM + computed styles) | spike |
| `scaffold_theme` | agent writes files | trivial |
| import/export | `wp db export` + tar | recipe |
| `wpcom_request` / OAuth | REST + application password, or WP.com MCP | degrades; auth is user-driven — needs bootstrap docs |
| pull/push site | rsync over SSH + deploy.md sequence | degrades; Business+ plan only |
| preview sites | `build-snapshot` + Playground blueprint URL (spike) or real staging site | nearest miss |
| daemon-mediated wp-cli | rule: stop server before one-off wp-cli writes | workaround until concurrency spike |
| annotations, `studio_present`, `ask_user_question` | native agent interaction | skip — product UX, not knowledge |

Tools with no entry here (`need_for_speed`, `rank_me_up`, taxonomy scripts) are post-v1 skill
candidates, mirroring the Low-priority extraction row.

---

## Phase 3 — End-to-end test and iterate

1. Re-run the Phase 1 eval tasks **with the skill** on each agent (claude, codex, gemini, pi).
   Pass = the failure points from Phase 1 are fixed; bare-agent strengths are not degraded.
2. Full flow on a real WP.com test site: create local → polish → deploy → verify → roll back
   from backup (prove the safety discipline actually works).
3. Leak review: no Telex/Studio tool names, sandbox assumptions, or backend magic in any reference.
4. Trim pass: re-apply the content filter; cut anything the agents demonstrably didn't need.
5. Distribute: `npx skills add <org>/agent-plugins@wordpress`.

**Split into multiple skills only with evidence** (triggering misses, context bloat measured in
practice) — not preemptively.

---

## Risks / open questions

- **WP.com MCP surface** — if it's content-only, REST/SSH must carry site management; decision
  table must reflect reality, not the support page's marketing.
- **Playground fidelity** — PHP WASM quirks (extensions, cron, mail, performance) may break the
  local-first premise for some site types (e.g., WooCommerce). The honest "differences from
  production" section in local-sites.md is mandatory.
- **Image generation** — agents differ; most have no image tool. images-media.md needs a graceful
  degradation path (placeholders + structured prompts for later generation) rather than assuming
  a backend like Telex's.
- **Platform facts written from memory** — every WP.com claim (hosts, paths, limits) must be
  verified against a real site in Phase 1 before it lands in a reference.
- **Skill triggering variance across 4 agents** — mitigated by the single-skill design, but
  Phase 3 must test cold-start triggering ("build me a WordPress site") on each agent.
