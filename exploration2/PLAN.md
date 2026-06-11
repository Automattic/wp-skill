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

Run representative tasks with **bare agents, no skill**, and record exactly where they fail.
Simultaneously verify the toolchain claims the skill will rely on. Output:
`exploration2/spike-notes.md` with the pre-registered rubric, per-run results, and a concrete
failure-point list (each failure tagged with how many runs/agents it appeared in).

### Eval protocol (decided before any run — not negotiable after)

- **Pre-registered rubric.** Every task gets binary pass criteria written in
  `exploration2/spike-notes.md` *before* the first run. No post-hoc "close enough".
- **Repetition.** Each task runs **≥2× per agent** — block-validity and toolchain-discovery
  failures are stochastic; one clean run proves nothing, one dirty run may be noise. A failure
  point earns skill content only if it appears in ≥2 runs (or once with a clearly systematic
  cause, e.g. a wrong platform fact).
- **≥2 agents in Phase 1** (claude + one other). Phase 3 grades four; baselining on one agent
  means three of those grades have no baseline.
- **Independent grading.** Whoever wrote the failure-point hypotheses does not grade transcripts
  alone — a second person (or at minimum a separate, hypothesis-blind grading pass against the
  rubric only) scores each run. Record what the agent got *right* with the same rigor: the
  content filter needs the successes to know what not to write.
- **Scope honesty.** 10 tasks × 2 runs × 2 agents ≈ 40 runs. If day 1–2 can't absorb that,
  cut tasks 9–10 to 1 run × 2 agents before cutting repetition on tasks 1–6.

### Eval tasks (bare agent; **pass =** is the pre-registered criterion)

1. "Create a local WordPress site and show me it running" — does it find/choose
   `npx @wp-playground/cli` or wp-now on its own? Mount semantics? Cleanup?
   **Pass =** working URL returns 200/302, user told how to view it, no orphaned processes after.
2. "Build a landing-page block theme for a coffee shop" — block markup validity (the classic
   "invalid content" errors), theme.json correctness, design quality (AI-slop check).
   **Pass =** site editor / post editor shows **zero block warnings** (checked via the
   editor-validation recipe, not the frontend), theme activates without PHP notices, and the
   page is not single-column default-styled slop (graded against 3 named criteria: distinct
   typography, non-default palette, full-width hero renders full-width).
3. "Screenshot the site on desktop and mobile and fix layout issues" — does it reach for
   Playwright? Can it diagnose from rendered DOM?
   **Pass =** produces both screenshots unprompted and at least one fix is grounded in inspected
   DOM/CSS evidence rather than guessed from the image.
4. "Connect to my WordPress.com site over SSH and list installed plugins" — host/username
   conventions, htdocs path, wp-cli invocation.
   **Pass =** correct plugin list printed; no invented hostnames/paths along the way.
5. "Replace the hero image on my live site" — media-library registration trap, CDN caching trap.
   **Pass =** new image visible in Media Library AND served on the page (cache-busted), not just
   a file dropped into uploads/.
6. "Deploy this local theme to my WordPress.com site" — backup discipline, activation,
   URL search-replace, cache flush, verification.
   **Pass =** backup artifact exists off-host *before* first write; search-replace dry-run before
   live; site verified rendering after. Any write-before-backup = fail regardless of outcome.
7. "Set up the WordPress.com MCP and create a draft post through it." — MCP is disabled by
   default and user-enabled per account/site; does the agent know to walk the user through
   enablement, or does it flounder on a connection error?
   **Pass =** draft exists on the site; agent gave correct click-path for enablement when blocked.
8. "Deploy this theme to my WordPress.com site" — against a **Personal-plan** site. There is no
   correct deployment: no SSH/SFTP below Business, and MCP/REST don't carry theme files. A bare
   agent will likely fumble this with retry loops or wrong-channel attempts.
   **Pass =** clear refusal naming the plan limitation and the options (upgrade, WP.com theme +
   editor customization, stay local). Any deployment attempt = fail.
9. **Brownfield edit**: "Change the fonts and add a testimonials section to my existing site" —
   against a pre-built, deliberately messy Playground site (mixed classic/block content, an
   active plugin, customized theme.json). Every important source skill (`editing-themes`,
   `visual-polish`) exists for *editing*, yet greenfield evals can't observe those failures.
   **Pass =** existing content/styling not broken (before/after screenshot diff of untouched
   pages), edits land in the right files, editor still shows zero block warnings.
10. **WooCommerce on Playground**: "Set up a small shop with 3 products locally" — probes the
    local-first premise where Playground fidelity is weakest (named in Risks, so it must be
    tested, not assumed).
    **Pass =** products visible on shop page and add-to-cart works — or the agent correctly
    identifies and explains a real Playground limitation instead of thrashing.

Deliberately deferred from Phase 1 (decision, not omission): multisite, non-English content,
Windows host. Each is real (Studio ships `multisite.md`; Playwright/SSH ergonomics differ on
Windows) but none gates v1 skill content. Revisit at Phase 3 if evals there fail, and note the
Windows gap in the skill's README.

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
- **Server lifecycle across agents (the Studio-daemon convention)**: the four agents have
  different process semantics (Claude Code has native background tasks; Codex's sandbox may not
  keep backgrounded children alive between commands and blocks network by default; pi's bash is
  synchronous). Studio solves this with a daemon + IPC registry: the server is never a child of
  any command. The skill replicates both properties as **one convention, no script**:

  ```bash
  # start (idempotent: check .playground/server.pid first)
  mkdir -p .playground
  setsid nohup npx @wp-playground/cli server --port=<free-port> \
    > .playground/server.log 2>&1 & echo $! > .playground/server.pid
  echo <free-port> > .playground/server.port
  # ready:  curl poll on $(cat .playground/server.port)
  # stop:   kill $(cat .playground/server.pid); verify port free; rm state files
  ```

  Ports are **recorded, never fixed and never assumed** — this replaces Telex's "always 8881"
  (which collides across concurrent agents; wp-now still defaults to 8881) and survives
  multi-turn amnesia (turn-3 agent reads the port file instead of guessing). Spike must verify
  on **all four agents**: start server turn 1 → curl it turn 3 → kill it turn 5. If an agent's
  sandbox provably kills `setsid`-detached processes, document that agent's native escape hatch
  (e.g. Claude Code background tasks) as the fallback — but only with evidence, and the
  convention stays the single recommended path.
- wp-now: **demoted — not the recommended path.** One server tool, one lifecycle: the skill
  recommends `@wp-playground/cli` only (it carries the validated wp-cli recipe, mounts, and
  snapshots; wp-now adds a second lifecycle, a second port default, and no unique capability).
  Spike only confirms it's safe to *mention* as what users may already have (maintained?
  state-dir layout?).
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
- WP.com MCP (**partially verified 2026-06-11** against wordpress.com/support/mcp, reviewed
  2026-05-20): available on Personal, Premium, Business, and Commerce plans — **free sites
  excluded**; **disabled by default** — the user must enable it account-wide and/or per-site,
  then connect each AI client; tool surface is content/comments/settings/stats-flavored — **not
  theme-file deployment**; tools respect user roles. Spike remainder: enumerate the actual tool
  list per plan, and the exact per-agent connection steps (claude/codex/gemini/pi).
- WP.com SSH: confirm host names, username format, htdocs layout, what's writable, rsync
  availability, session limits. SSH/SFTP is believed Business+ only (**unverified**) — confirm,
  because it makes "deploy a theme" impossible on Free/Personal/Premium plans and the skill must
  say so rather than let the agent flail. (Verify with a real test site — don't write these
  from memory.)
- Playground vs real hosting differences (PHP extensions, cron, mail) — note honestly.

### Expected failure points (hypotheses to **test** — graded against the rubric, falsifiable)

These predictions are recorded here so Phase 1 can prove them *wrong*: a hypothesis the bare
agent handles cleanly in both runs gets **no skill content**, whatever Telex/Studio history says.
They must not function as a grading checklist — graders score transcripts against the per-task
pass criteria above, then map failures back to (or beyond) this list.

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
    ├── local-sites.md              # Playground (single recommended server): bootstrap, mount,
    │                               #   blueprints, the site-dir lifecycle convention (detached
    │                               #   start + .playground/{pid,port,log} state files, idempotent
    │                               #   start, readiness poll, kill-by-pidfile — ports recorded,
    │                               #   never fixed/assumed),
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
    ├── wordpress-com.md            # FIRST table: plan-capability matrix (plan → MCP? SSH/SFTP?
    │                               #   theme upload? wp-cli?) — the agent must check the plan
    │                               #   before promising anything. Then: "what to tell the user
    │                               #   to click" bootstrap (MCP enablement + client connection,
    │                               #   SSH key setup, application passwords), channels
    │                               #   (MCP / REST / SSH) + decision table, connection, htdocs,
    │                               #   platform limits, and the no-deploy-path answer for
    │                               #   Free/Personal/Premium (refuse + explain options)
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
| High | Telex `testing-wp-runtime` (server → curl → debug.log → cleanup loop; its fixed-port-8881 rule is superseded by the recorded-port convention) | local-sites.md |
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
| server daemon + IPC registry | detached start + site-dir state files (`.playground/{pid,port,log}`) | spike: cross-turn survival on all 4 agents |
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

- **WP.com MCP surface** — confirmed content-plus-settings flavored (support page, 2026-05-20):
  REST/SSH must carry site management; decision table must reflect reality, not the support
  page's marketing.
- **Plan gating is the day-one wall** — MCP needs Personal+, SSH/SFTP believed Business+
  (unverified). The largest WP.com segment (Free/Personal) has **no theme deployment path at
  all**; the skill's correct behavior there is a refusal with options, and bootstrap friction
  (enable MCP, connect client, SSH keys) is user-driven — wordpress-com.md must lead with the
  plan-capability matrix and click-by-click bootstrap, or eval tasks 7–8 fail regardless of
  model quality.
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
