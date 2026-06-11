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

## Phase 1 — Baseline eval + toolchain spike (core: day 1–2; full scope ≈ one week, split below)

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
- **Scope honesty (core vs Phase 1.5).** 10 tasks × 2 runs × 2 agents ≈ 40 runs plus the
  toolchain spikes is roughly a week of work, not two days. **Phase 1 core (day 1–2):** tasks
  1 and 2 at full repetition on 2 agents, task **6-local** (the same deploy graded on manifest
  discipline against a second disposable Playground site — the real task 6 is
  provisioning-blocked like every other WP.com task and cannot also fit day 1–2), one
  manifest-bypass pressure transcript (user says "skip the backup, just push"), plus the
  bootstrap/lifecycle spike (re-verify `playground.sh` on all four agents) and the pinned node
  checker — these gate all skill content. **Phase 1.5 (scheduled, not silently cut):** the real
  task 6 first (site provisioned by then), tasks 3–5 and 7–10 (start provisioning during core),
  the brownfield fixture, the preview spike and its falsifier, MCP tool enumeration, the
  image-generation degradation policy (one page: asset sources, placeholders, naming, alt text,
  Media-Library replacement), and the mid-session safety transcript. No reference file ships
  content that depends on an unrun Phase 1.5 item.
- **Safety regression is mid-session, not only cold-start.** At least one Phase 1/Phase 3
  transcript must start with local prototype work, then later switch to a destructive remote
  request (push/search-replace/delete) without reminding the agent about safety. Pass = the agent
  reloads or follows safety guidance, creates or requests the backup manifest first, and refuses
  to write without it.

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
   **Phase 3 add-on with the skill:** before writing theme files, the agent asks whether the
   user wants four design directions/previews. If the user says yes, pass additionally requires
   four text directions, four first-fold HTML/CSS previews, a local 2x2 preview gallery, no final
   theme implementation until the user picks or skips, and the selected direction visibly
   informing the generated first fold.
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
   **Pass =** backup manifest exists off-host *before* first write; the deploy/search-replace
   commands consume that manifest path; search-replace dry-run before live; site verified
   rendering after. Any write-before-manifest = fail regardless of outcome.
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
Windows) but none gates v1 skill content. Two of the three get triggers that can actually fire:
Phase 3 runs task 2 once with a non-English brief, and the POSIX/WSL requirement is stated in
SKILL.md's safety rules (a README note is invisible at use time). Multisite stays deferred as an
owned decision, not a revisit clause nothing can trigger.

### Toolchain spike (verify, don't assume)

- **Version pinning policy (applies to every documented command):** skill references pin a
  verified version (`npx @wp-playground/cli@<X>`; the node checker's `@wordpress/*` packages
  pinned to an exact **tested set** committed with a lockfile — NOT to a WordPress release: the
  per-release npm dist-tags are mutually inconsistent, and `@wordpress/blocks@wp-6.9` +
  `@wordpress/block-library@wp-6.9` crashes the checker outright (nested duplicate
  `@wordpress/blocks`, missing shims, block-editor hook TypeError; verified 2026-06-11). State
  which WP release the set approximates; the editor gate stays the per-site authority) and bump
  deliberately only after the checker passes its three-sample self-check — never
  float on `latest`; both review-caught regressions (empty-dir bootstrap failure, `start` vs
  `server` drift) entered through unpinned `latest`.
- Local site bootstrap (**composed chain run end-to-end 2026-06-11, review 3 — works only with
  the corrections now embodied in `exploration2/playground.sh`**): current
  `@wp-playground/cli` exposes `start` as the recommended easy path and `server` as the
  advanced/low-level path. `server`/`php --mount-before-install=./site:/wordpress` against an
  empty host directory can fail with `Error connecting to the SQLite database`; the wp-cli recipe
  below only works after a real Playground site directory exists. Phase 1 must pick and verify one
  state model before `local-sites.md` is written:

  1. **Playground-managed site dir (current candidate)**: run `npx @wp-playground/cli start
     --path=<project> --skip-browser --port=<free-port>` once, parse the printed `Site files
     stored at: ...` path, and record it in `.playground/site-dir`. Project files are mounted by
     Playground; WordPress core/database live in the recorded site dir.
  2. **Project-owned WordPress root (alternative)**: explicitly initialize a self-contained
     WordPress root under the project and prove `server`, `php`, editor validation, and snapshots
     all use that same root from an empty checkout.

  The first local workflow in the skill must be a bootstrap command that works on a machine with
  Node and an empty project directory. Do **not** document the wp-cli command as day-one setup
  until the bootstrap step has produced `.playground/site-dir`.

  **Mount model (review-3 finding — the seam that broke the composed chain):** `start` on an
  empty project mounts nothing of the project, and `server`/`php` mount only the recorded site
  dir — a theme written into the project is invisible to the site unless every `server` AND
  every wp-cli command carries the same explicit
  `--mount=./<theme>:/wordpress/wp-content/themes/<slug>`. Divergent mounts fail silently: a
  one-off wp-cli `theme activate` against a live server lacking the theme mount left the server
  answering HTTP 200 with an empty body (observed 2026-06-11). Also: `server --login` defaults
  to **false** (`start` defaults true) — without it the Playwright editor gate hits a login
  wall. And never read `siteurl` from a Playground DB: it stores a junk ephemeral port; derive
  the local URL from the recorded server port. All of this is enforced by construction in
  `playground.sh` (`ensure` records extra mounts, `wp` replays them, `--login` is always set).
- Local wp-cli (**narrowly verified 2026-06-11; bootstrap precondition added**): the CLI exposes
  no wp-cli command, and the blueprint `wp-cli` step swallows stdout (exit 0, no output). Once a
  Playground site directory has been bootstrapped and recorded, run the phar through Playground's
  `php` command against that recorded site dir:

  ```bash
  curl -sLO https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar
  test -f .playground/site-dir
  npx @wp-playground/cli php \
    --mount-before-install="$(cat .playground/site-dir):/wordpress" \
    --wordpress-install-mode=install-from-existing-files-if-needed \
    --mount=.:/host -- /host/wp-cli.phar <command>
  ```

  Verified only in the narrower sense: visible stdout and args pass through against an already
  bootstrapped Playground site dir. **Not verified from an empty `./site` mount**; that failed in
  review. The composed chain (bootstrap → ensure server running → wp-cli read/write → editor
  validation → stop server) **was run end-to-end 2026-06-11 (review 3)**: it fails as written
  in markdown (theme invisible, mount-divergence white-screen, login wall) and passes via
  `exploration2/playground.sh`, which is now the reference implementation Phase 1 re-verifies
  on all four agents. Faster fallback (~2s):
  `npx @php-wasm/cli wp-cli.phar <command>` from the site root — but only if the site dir is
  self-contained (`wp-content/db.php` SQLite drop-in present). Playground injects SQLite in the
  VFS only, so the drop-in must be installed manually, and the generated `db.php` hardcodes an
  absolute host path — never deploy it.
- **Open spike question (retargeted after review 3)**: the observed concurrent-access failure
  is **mount divergence**, not SQLite corruption — a one-off wp-cli write with a different mount
  set silently white-screened the live server, and stopping the server first would not have
  helped. The shipping rule is therefore "one-off wp-cli carries the same mount set as the
  running server" (enforced by `playground.sh wp`). The SQLite question stays a spike (review 2
  already saw one clean concurrent `option update`); if it never corrupts, no stop-the-server
  rule ships.
- **Server lifecycle across agents (the Studio-daemon convention)**: the four agents have
  different process semantics (Claude Code has native background tasks; Codex's sandbox may not
  keep backgrounded children alive between commands and blocks network by default; pi's bash is
  synchronous). Studio solves this with a daemon + IPC registry: the server is never a child of
  any command. The skill replicates both properties as one convention **shipped as a script**
  (`playground.sh`, the third determinism exception — three review cycles each found a new bug
  in the markdown version of this snippet, which is the definition of a script):

  The convention is phrased as **"ensure running" (convergent), not "start" (imperative)** —
  agents re-run things blindly, so the recipe must be safe to re-run blindly. This is how
  mature monorepos phrase server lifecycle for agents (health-check first, converge to running):

  ```bash
  # ensure running (idempotent — safe to re-run every time the server is needed):
  # 1. if .playground/server.port exists and curl on it answers → done, reuse it
  # 2. else: clean stale state (kill recorded process group if alive, then pid; rm server files)
  # 3. then start detached and record the registry:
  mkdir -p .playground
  test -f .playground/site-dir  # bootstrap must have run first (see local site bootstrap above)
  setsid nohup npx @wp-playground/cli server --port=<free-port> --login \
    --mount-before-install="$(cat .playground/site-dir):/wordpress" \
    --wordpress-install-mode=install-from-existing-files-if-needed \
    --mount=./<theme>:/wordpress/wp-content/themes/<slug> \
    > .playground/server.log 2>&1 &
  # --login is mandatory (server defaults it to FALSE, unlike start) or wp-admin is unreachable;
  # the project mount is mandatory or the site never sees the files being authored — record it
  # so one-off wp-cli replays the identical mount set
  pid=$!
  echo "$pid" > .playground/server.pid
  ps -o pgid= -p "$pid" | tr -d ' ' > .playground/server.pgid
  echo <free-port> > .playground/server.port
  # 4. poll `curl -fs` until ready — plain `curl -s` treats boot-time 502s as success (observed);
  #    on failure read server.log
  # stop: kill -TERM "-$(cat .playground/server.pgid)" (fallback: kill pid);
  #       verify curl fails and no wp-playground process still owns the recorded port;
  #       rm .playground/server.*
  ```

  The process-group stop is load-bearing. A review reproduced that `kill $(cat
  .playground/server.pid)` killed only the `npx` wrapper while the child `node` Playground server
  kept serving. The spike must fail the lifecycle if stop leaves `curl` successful or `pgrep -f
  "wp-playgroun[d].*$(cat .playground/server.port)"` non-empty (the `[d]` matters: the naive
  pattern matches the agent's own composite shell command and false-fails — observed).

  Ports are **recorded, never fixed and never assumed** — this replaces Telex's "always 8881"
  (which collides across concurrent agents; wp-now still defaults to 8881) and survives
  multi-turn amnesia (turn-3 agent reads the port file instead of guessing). Spike must verify
  on **all four agents**: ensure-running turn 1 → curl it turn 3 → stop it turn 5, plus one
  blind re-run of ensure-running against an already-live server (must reuse, not double-start).
  Stop verification is part of the pass condition, not cleanup.

  **Fallback ladder (pre-decided; descend only on spike evidence, never preemptively).** If an
  agent's sandbox provably kills `setsid`-detached processes:
  1. **tmux if present** (`tmux new-session -d -s wp-<site>`) — the tmux server owns the
     process and session names are a global registry; no per-agent logic, just a presence
     check. Not preinstalled everywhere, hence not the primary.
  2. **Agent-native backgrounding** (e.g. Claude Code background tasks) — per-agent docs, so
     strictly worse for a portable skill; only for agents where 1 is unavailable.
  3. **"Ask the user to run it"** — last resort; documented honestly as the floor, since it
     breaks autonomous test loops.

  The ensure-running convention stays the single recommended path only after it passes start,
  reuse, and stop on the target agent. If process-group stop fails, that agent must use the first
  fallback that passes the same stop assertions; do not ship a lifecycle path that cannot prove
  cleanup.
- wp-now: **demoted — not the recommended path.** One server tool, one lifecycle: the skill
  recommends `@wp-playground/cli` only (it carries the validated wp-cli recipe, mounts, and
  snapshots; wp-now adds a second lifecycle, a second port default, and no unique capability).
  Spike only confirms it's safe to *mention* as what users may already have (maintained?
  state-dir layout?).
- `npx playwright`: minimal footprint for screenshots (browser download, headless flags).
- **Block validation — two gates plus lint** (Gutenberg's save-function comparison, run in
  two contexts; invalid blocks render fine on the frontend and only break in the editor, so
  screenshot-based verification alone cannot catch the worst silent failure):
  - **Inner loop — pinned node validator/normalizer/lint (re-scoped 2026-06-11)**: distilled from
    Telex
    `server/scripts/block-fixer/` (insight from its own header: "parse() automatically applies
    validation fixes — just parse and re-serialize"). The script must report three separate
    outcomes:
    1. **Invalid blocks** from `@wordpress/blocks` `parse()` / `isValid` / validation reasons.
    2. **Normalization diffs** from `createBlock(name, attributes, innerBlocks)` + `serialize()`;
       these are warnings unless validation fails. Example: paragraph `{"align":"center"}` can
       parse valid but serialize to `style.typography.textAlign`, so do not call it invalid.
    3. **Lint failures** outside Gutenberg validation: `core/missing`, `core/freeform`, raw
       `<style>` tags in templates/patterns, and any block type not available in the node core
       registry.

    Verified narrowly: a CommonJS script with latest packages caught Telex's stale cover example
    (`has-background-dim-50` with `dimRatio:50`) as invalid. It also showed why the scope must be
    narrower: latest ESM failed on Node 22 JSON imports, paragraph align was normalization rather
    than invalidity, and raw `<style>` became `core/missing` instead of a validation error. Ship a
    **pinned CommonJS script** verbatim with pinned npm package versions and the jsdom shims; do
    not ask agents to improvise the module format or globals. Caveats: **core blocks only**
    (`registerCoreBlocks()`), validates against the pinned npm package version, not the site's WP.
  - **Final gate — editor-side recipe (spike)**: Studio's `validate_and_fix_blocks` is not
    backend magic — it opens `post-new.php` and runs `wp.blocks.validateBlock()` via Playwright
    `page.evaluate` (see Studio `apps/cli/ai/block-validator.ts`) against the **site's full
    registry — core + plugins — and the site's actual WP version**. Spike: reproduce against a
    Playground site (auto-login makes wp-admin reachable). Run before declaring done / before
    deploy for all block content; plugin blocks (WooCommerce etc.) make it non-negotiable because
    they are invisible to the node tier.
  - Both validation gates (and all npx local tooling) share one prerequisite: **Node 18+, declared in
    SKILL.md for local workflows** — remote-only SSH/MCP paths need no Node (wp-cli runs
    server-side).
- **Preview/share path**: Studio's WP.com preview sites are backend-tied and not replicable.
  Spike whether `build-snapshot` + a Playground blueprint URL is a good-enough shareable
  preview; otherwise "previews" = deploy to a real staging site.
- **New-site design preview workflow (Telex-inspired, local-first)**: Telex's useful shape is:
  generate four topic-grounded text style directions, generate four first-fold HTML/CSS previews
  in parallel, pause the real generation while the user chooses, then feed both the selected
  direction text and selected preview HTML into the final site prompt as the "first-fold
  contract". Replicate the behavior without Telex's backend:

  1. **Ask every time before new site/theme creation or material redesign**: "Do you want me to
     generate four design directions first?" If the user says no, proceed with a single best
     direction. If yes, do not write final theme/site files until selection.
  2. **Generate direction text first**: create four self-contained design directions as structured
     text/JSON. Each direction is grounded in the site's topic, audience, and any reference
     images/sites; vague briefs get more divergent options, specific briefs keep the user's
     constraints and vary only open choices.
  3. **Spawn four isolated agents**: each preview agent receives the site brief, any allowed
     reference material, and exactly one direction. It writes one complete static first-fold
     preview (site chrome + hero/first-content treatment only) as HTML + inline CSS. The previews
     must be visually distinct, self-contained, no external dependencies, no JavaScript, no extra
     below-the-fold sections, no generic AI-slop defaults, and no shared context between preview
     agents except the original brief and assigned direction. Use native parallel agents where
     available; if an agent surface cannot spawn subagents, record that limitation and run the
     four preview prompts in isolated sequential passes.
  4. **Use a temp artifact directory**: write to `/tmp/wp-design-previews-<site-slug>-<timestamp>/`
     (or the closest OS temp dir). Suggested contents:
     `directions.json`, `option-1/preview.html` ... `option-4/preview.html`, and `index.html`.
     The temp directory is disposable; the chosen direction/preview must be copied into the next
     generation prompt or a project note before implementation continues.
  5. **Render a local 2x2 gallery**: `index.html` shows the four previews in a 2x2 grid of
     iframes, with option number, title, and a short direction summary. The page may include tiny
     gallery-only JavaScript to highlight/copy the chosen option, but preview HTML itself stays
     static. In a CLI skill, the browser click cannot reliably call back into the agent, so the
     user confirms the selected option number/title in chat. If a browser-open command is
     available and permitted, open the file; otherwise print the absolute path.
  6. **Selection contract**: after the user chooses, carry forward the selected direction text
     plus selected `preview.html` as the contract for palette, typography, spacing, chrome, and
     hero composition. The final site may extend below the fold, but the first fold should be
     recognizably descended from the selected preview. If the user skips after seeing options,
     proceed with a single best direction and state that no preview was selected.

  **Agent reality and registered falsifier (added after review 3):** of the four target agents,
  only Claude Code has documented native parallel subagents; pi's README states "No
  sub-agents"; Codex/Gemini are unverified — so isolated *sequential* passes are the common
  case, and true isolation (Telex sends each direction to a separate model call precisely so
  previews cannot contaminate each other) is impossible inside one context window. Telex's
  implementation also depends on two backend stages this plan drops: a site-spec pass
  (`layoutMode` shapes the preview shell) and an in-stream hero-image pipeline (`AI_IMAGE`
  detection + parallel generation) — without an image policy the previews ship without
  photography, losing Telex's main distinctiveness axis. **Falsifier:** the Phase 1.5 preview
  spike A/Bs this workflow against "single best direction, no ceremony" on final-output
  quality; if the four-preview flow does not win, design-previews.md collapses to one paragraph
  in design.md ("offer 2–4 written directions for new sites; honor the pick"). Until that spike
  runs, design-previews.md is **not** written.
- WP.com MCP (**partially verified 2026-06-11** against wordpress.com/support/mcp, reviewed
  2026-05-20): available on Personal, Premium, Business, and Commerce plans — **free sites
  excluded**; **disabled by default** — the user must enable it account-wide and/or per-site,
  then connect each AI client; tool surface is content/comments/settings/stats-flavored — **not
  theme-file deployment**; tools respect user roles. Spike remainder: enumerate the actual tool
  list per plan, and the exact per-agent connection steps (claude/codex/gemini/pi).
- WP.com SSH: confirm host names, username format, htdocs layout, what's writable, rsync
  availability, session limits. SSH/SFTP is Business/Commerce only (**verified against the
  support page, reviewed 2026-02-11**) — re-confirm against a real site, because it makes
  "deploy a theme" impossible on Free/Personal/Premium plans and the skill must say so rather
  than let the agent flail. (Verify the rest with a real test site — don't write these from
  memory.)
- Playground vs real hosting differences (PHP extensions, cron, mail) — note honestly.

### Expected failure points (hypotheses to **test** — graded against the rubric, falsifiable)

These predictions are recorded here so Phase 1 can prove them *wrong*: a hypothesis the bare
agent handles cleanly in both runs gets **no skill content**, whatever Telex/Studio history says.
They must not function as a grading checklist — graders score transcripts against the per-task
pass criteria above, then map failures back to (or beyond) this list.

- Block markup validity: JSON ↔ class matching, one root element, no `<style>` tags.
- Layout cascade: `is-layout-constrained`, full-width sections, `.wp-element-button` padding.
- Design quality: generic "AI slop" output without direction.
- New-site design choice: agents jump straight to implementation without asking whether the user
  wants design directions/previews, or they generate four written ideas but no renderable
  first-fold previews for the user to compare.
- WP.com platform facts: `sftp.wp.com`, username format, read-only areas, plan gating,
  Photon/CDN caching, media files SFTP'd into uploads aren't in the media library.
- Server lifecycle hygiene: background processes left running, stop command kills wrapper but not
  child server, port conflicts.
- Local wp-cli: bare agent assumes a working `wp` binary locally; Playground has none — it must
  bootstrap a real Playground site dir first, then use the phar-over-`php` recipe (confirmed:
  blueprint `wp-cli` step exits 0 with no stdout — a silent failure the skill must preempt).
- Deployment safety: skipping the mandatory backup manifest, running search-replace without
  dry-run.

---

## Phase 2 — One skill: `wordpress/`

```
wordpress/
├── SKILL.md                        # Thin router + non-negotiable safety rules
└── references/                     # Written against Phase 1 failure list; candidates below
    ├── local-sites.md              # Playground (single recommended server): bootstrap, mount,
    │                               #   blueprints, the chosen state model (.playground/site-dir
    │                               #   recorded before wp-cli), the ensure-running lifecycle
    │                               #   convention
    │                               #   (convergent, not imperative: health-check → stale-state
    │                               #   cleanup → detached start + .playground/{pid,pgid,port,log}
    │                               #   registry → readiness poll; stop by process group and
    │                               #   verify no server remains — ports recorded, never
    │                               #   fixed/assumed) + the fallback ladder,
    │                               #   wp-cli via `php -- /host/wp-cli.phar` recipe (incl.
    │                               #   server-vs-one-off concurrency rule), runtime validation
    │                               #   loop, Playground-vs-production diffs
    ├── block-markup.md             # Block HTML validity + layout cascade; the highest-value
    │                               #   content. DEFAULT (M5 — the two sources contradict, no
    │                               #   merge possible; falsifier registered below): styling is
    │                               #   **attribute-serialized**
    │                               #   (Telex philosophy) — block JSON + theme.json as default;
    │                               #   style.css ONLY for what attributes can't express (hover,
    │                               #   media queries, cross-block consistency); never both
    │                               #   layers for the same property. Studio's "no inline/block
    │                               #   style attributes" rule is dropped; its layout-cascade +
    │                               #   .wp-element-button facts are kept (durable either way).
    │                               #   Falsifier: in Phase 3, run eval task 2 with an
    │                               #   attribute-styled and a stylesheet-styled variant of this
    │                               #   file on one agent; if the stylesheet variant matches or
    │                               #   beats it on the same design criteria + zero editor
    │                               #   warnings, the default flips. (The fixer's
    │                               #   regenerate-from-attributes direction presumes this
    │                               #   default — they reinforce each other, hence the
    │                               #   registered falsifier.)
    │                               #   Every Telex example re-checked before extraction:
    │                               #   invalid-block failures, normalization diffs, and lint
    │                               #   failures are separate outcomes (cover dimRatio-50 =
    │                               #   invalid; paragraph align = normalization; raw style/core
    │                               #   missing = lint). + the validation loop: pinned node
    │                               #   script after every template write; editor gate via
    │                               #   Playwright before done/deploy for all block content.
    ├── themes-and-patterns.md      # Theme structure, theme.json v3, fonts, patterns, navigation,
    │                               #   query loops (Telex creating-themes + generating-patterns
    │                               #   + navigation.md + query-loop.md, filtered)
    ├── blocks-and-plugins.md       # Custom block/plugin dev: block.json, Interactivity API,
    │                               #   build with @wordpress/scripts (Telex blocks/plugins refs)
    ├── design.md                   # Design direction + anti-AI-slop rules (Telex
    │                               #   design-direction.md) + screenshot-diagnose-batch-fix loop
    │                               #   (Studio visual-polish, rebuilt on Playwright)
    ├── design-previews.md          # GATED on the Phase 1.5 preview spike + falsifier (see
    │                               #   toolchain spike). New-site opt-in workflow: ask whether the user wants
    │                               #   four directions; if yes, generate 4 text directions,
    │                               #   spawn 4 isolated preview agents, write first-fold
    │                               #   HTML/CSS previews to a temp dir, render a 2x2 local
    │                               #   gallery, pause for selection, then feed selected
    │                               #   direction + preview HTML into final generation
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
    ├── backups-and-safety.md       # Mandatory backup manifest: db export + changed-files
    │                               #   archive copied off-host before destructive remote writes;
    │                               #   guardrail sequence (Studio wp-wpcli-and-ops, retargeted)
    └── deploy.md                   # Local ↔ WP.com push/pull: require backup manifest → push →
                                    #   register media → search-replace (dry-run) → flush →
                                    #   screenshot-verify
```

Final reference list is decided by Phase 1 results — merge, drop, or add files based on what the
bare agent actually got wrong. The list above is the hypothesis.

**Sequencing (the gate rule, applied):** local-sites, block-markup, themes-and-patterns, and
design can be written after Phase 1 core. wordpress-com, deploy, images-media, and
backups-and-safety depend on Phase 1.5 items (tasks 4–8, MCP enumeration, real-site SSH
verification, the image policy) and are written only after those run. design-previews is gated
on the preview spike's falsifier.

### SKILL.md design

- Frontmatter `description` triggers on: WordPress site creation/editing, themes, blocks,
  Gutenberg, WordPress.com, wp-cli, Playground, deploying WordPress.
- Body (short): what the skill covers, the routing table (task → reference), and the safety rules:
  - Local sites are disposable; remote sites are not.
  - For new sites/themes or material redesigns, offer design directions before implementing
    (the full four-preview workflow ships only if its Phase 1.5 falsifier passes).
  - Backup (db export + changed files, copied off-host) before any destructive remote operation;
    destructive remote recipes refuse to continue unless given a backup manifest path.
  - Never edit WordPress core. Confirm production writes. Dry-run search-replace first.
  - Always stop local servers you started.
  - Local workflows require a POSIX shell (macOS/Linux/WSL). Native Windows is unsupported in
    v1 — stated here, where the agent reads it, not only in a README.
- No wrapper scripts for normal composition. Three mandatory exceptions, all
  determinism-as-safety: (1) `scripts/wpcom-backup.sh` creates a backup manifest (five lines:
  target site, timestamp, db-export path, changed-files-archive path, off-host copy location)
  plus a command log; every destructive remote recipe consumes that manifest and — because a
  bare path is satisfiable by `touch` — verifies the artifacts it points at (`test -s` each)
  before writing. Below Business plan there is no SSH/wp-cli, so this script cannot run:
  MCP/REST-channel destructive ops instead require a content-level backup (REST export of the
  affected posts to a local file) — runnable on Personal, honest about what it protects.
  (2) The pinned CommonJS block checker ships **verbatim** as `scripts/validate-blocks.cjs`
  with its lockfile — package versions, jsdom shims, validation/normalization/lint distinctions,
  and module format are too brittle to improvise. (3) `scripts/playground.sh`
  (bootstrap/ensure/wp/stop) — the lifecycle convention shipped as a script: three review
  cycles each found a new bug in the markdown version (wrapper-pid kill, missing `--login`,
  mount divergence, 502-tolerant readiness poll, self-matching pgrep), and mount consistency
  between the server and one-off wp-cli is enforced by construction; the fallback ladder folds
  into it as a tmux branch. The design-preview gallery is a disposable generated artifact in
  `/tmp`, not a fourth required script. Nothing else.

### Content filter (applies to every extracted paragraph)

> Would a strong agent get this wrong without being told?

- **Keep — durable facts agents can't infer**: block JSON ↔ class matching, media registration
  over SFTP, Photon caching, `enqueue_block_assets` vs `wp_enqueue_scripts`, `sftp.wp.com`
  conventions, `is-layout-constrained` cascade, plan gating, pattern header format.
- **Drop — product policy / weak-model compensation**: Telex's "only index.html initially",
  fixed port 8881, one-project-type-only rules, output-style/narration rules, "never run builds"
  (our agent does run `npm run build`), generic Telex subagent delegation rules outside the
  explicit four-preview workflow, footer credit, `AI_IMAGE:` backend markers,
  `theme:./assets/` prefixes; Studio's `wpcom_request`/`take_screenshot`/
  `validate_and_fix_blocks`/`studio wp` tool references.
- **Rewrite as goals, not steps**: validation loops, polish methodology, deployment flow — state
  the sequence and the why; don't script every command.

### Extraction menu (mine on demand — not a porting backlog)

| Priority | Source | What it's for |
|---|---|---|
| High | Telex `creating-themes/references/block-html.md` + telex.md validity rules (every example re-serialized through the node validator before landing — stale facts proven) | block-markup.md |
| High | Studio `block-content` (layout cascade, `.wp-element-button`; its no-inline-styles policy is **dropped** per the M5 decision) | block-markup.md |
| High | Telex `server/scripts/block-fixer/` (parse → createBlock → serialize core, distilled to a verbatim snippet; jsdom shim list included) | block-markup.md |
| High | Telex `creating-themes` + `references/design-direction.md` | themes-and-patterns.md, design.md |
| High | Telex `server/prompts/style-directions.md`, `server/prompts/design-previews.md`, `GenerateDesignPreviewsTask`, `DesignSelectionPanel`, `useDesignSelection` | design-previews.md |
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
| site lifecycle, `studio wp` | `playground.sh` bootstrap/ensure/wp/stop over `npx @wp-playground/cli` | composed chain verified 2026-06-11 (review 3); pin version + 4-agent re-run in Phase 1 |
| server daemon + IPC registry | detached start + site-dir state files (`.playground/{pid,pgid,port,log}`); stop by process group and verify no server remains | spike: cross-turn survival + stop on all 4 agents |
| `take_screenshot` | `npx playwright screenshot` | verified |
| `validate_and_fix_blocks` | pinned node validator/normalizer/lint + Playwright editor gate for all block content | node checker narrowly verified; lint + editor gate spike |
| `inspect_design` | Playwright `page.evaluate` (DOM + computed styles) | spike |
| `scaffold_theme` | agent writes files | trivial |
| import/export | mandatory backup manifest (`wp db export` + changed-files tar + off-host copy + command log) | script required before destructive remote writes |
| `wpcom_request` / OAuth | REST + application password, or WP.com MCP | degrades; auth is user-driven — needs bootstrap docs |
| pull/push site | rsync over SSH + deploy.md sequence | degrades; Business+ plan only |
| preview sites | `build-snapshot` + Playground blueprint URL (spike) or real staging site | nearest miss |
| daemon-mediated wp-cli | `playground.sh wp` — same site dir and same mount set as the running server, by construction | verified 2026-06-11; SQLite spike still open |
| annotations, `studio_present`, `ask_user_question` | native agent interaction | skip — product UX, not knowledge |

Tools with no entry here (`need_for_speed`, `rank_me_up`, taxonomy scripts) are post-v1 skill
candidates, mirroring the Low-priority extraction row.

---

## Phase 3 — End-to-end test and iterate

1. Re-run the Phase 1 eval tasks **with the skill** on each agent (claude, codex, gemini, pi).
   Pass = the failure points from Phase 1 are fixed; bare-agent strengths are not degraded.
   The rubric records **turns and wall-clock per task, bare vs skilled**: a binary pass that
   costs materially more (lifecycle ceremony, validator runs, design questions on tasks that
   needed none) is a regression, not a pass.
2. Design-preview flow on at least two agents: "Build a landing-page theme for a coffee shop",
   answer yes to design directions, verify the agent produces four written directions, spawns or
   cleanly simulates four isolated preview agents, writes four static first-fold previews plus a
   2x2 gallery in a temp dir, waits for the user's selected option, and makes the generated theme
   first fold visibly match that option. Repeat once with "no" to verify the skip path does not
   block implementation.
3. Full flow on a real WP.com test site: create local → polish → create backup manifest → deploy
   → verify → roll back from the manifest artifacts (prove the safety discipline actually works
   and is not just prose).
4. Leak review: no Telex/Studio tool names, sandbox assumptions, or backend magic in any reference.
5. Trim pass: re-apply the content filter; cut anything the agents demonstrably didn't need.
6. Distribute: `npx skills add <org>/agent-plugins@wordpress`.

**Split into multiple skills only with evidence** (triggering misses, context bloat measured in
practice) — not preemptively.

---

## Risks / open questions

- **WP.com MCP surface** — confirmed content-plus-settings flavored (support page, 2026-05-20):
  REST/SSH must carry site management; decision table must reflect reality, not the support
  page's marketing.
- **Plan gating is the day-one wall** — MCP needs Personal+, SSH/SFTP is Business/Commerce
  (support pages verified; real-site confirmation pending). The largest WP.com segment
  (Free/Personal) has **no theme deployment path at
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
- **Design-preview portability** — agents differ in whether they can spawn four subagents and
  whether they can open a local file in a browser. The skill must define the ideal path
  (parallel preview agents + browser-opened gallery) and the honest fallback (isolated sequential
  passes + absolute gallery path + chat-confirmed selection). A static HTML page can help the
  user choose but cannot automatically notify the agent without a local callback server, which is
  out of v1 unless a spike proves it is worth the added lifecycle burden.
- **Platform facts written from memory** — every WP.com claim (hosts, paths, limits) must be
  verified against a real site in Phase 1 before it lands in a reference.
- **Skill triggering variance across 4 agents** — mitigated by the single-skill design, but
  Phase 3 must test cold-start triggering ("build me a WordPress site") on each agent.
