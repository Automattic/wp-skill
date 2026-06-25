# Speeding up the wordpress skill without degrading design quality

**Implemented so far:** (1) the counter-markup bug in `motion.md`; (2) reduced-motion default in
`shot.mjs`/`visual-gate.mjs`; (3) **`scripts/checker/fix-blocks.cjs`** — a browser-free programmatic
block-validity fixer ported from Telex (`registerCoreBlocks` in jsdom → `parse` → rebuild each
block via `createBlock` → `serialize`). It auto-repairs the recurring INVALID cases (cover
img/span order + `has-background-dim` + `alt=""`, border-shorthand classes, element/attr order) in
milliseconds with no editor — directly removing the ~40% firefighting below. It only rewrites
files that actually contain an INVALID block (valid files are left untouched, so it doesn't churn
good markup to the pinned-package form). The block-markup loop and SKILL rule 3 now lead with it.
This **supersedes most of the "block-snippets" idea** (item 3 below): curing bad markup
automatically beats shipping snippets to copy.

**Items 4 and 5 are now also implemented.** (4) `boilerplate/theme.json` (rigor pre-filled, valid
WCAG-safe neutral palette) + `boilerplate/style-base.css` (loop utilities, equal-cards, footer
reset), with the section-margin-reset mandate added to `themes-and-patterns.md`. (5)
`scripts/scaffold-theme.sh` drops the skeleton + base CSS + motion runtime (enqueued frontend-only)
+ `boilerplate/content-loader.php` in one command; `content-loader.php` self-registers pages from
`content/pages/*.html` and promotes `home` to the static front page — **verified end-to-end in a
real Playground: the front page renders the designed home, not "Hello world"** (the eval's
front-page bug, fixed by boilerplate). `design.md` §5 now leads with the scaffold and SKILL rule 8
makes it the first build step, so the rigor and motion can't be skipped. All five analysis items
plus the two doc nudges (reduced-motion captures, batch visual-gate) are done.

Analysis of `sessions/tbilisi-tavern1-design-quality-port.md` (a full build on the
design-quality branch) + Telex's boilerplate strategy, against the four asks: simplify/remove
unnecessary agent work, port Telex's hardcoded spacing fixes, simplify the gates + make visual
feedback faster, and use more boilerplate instead of generating from scratch.

## Where the time actually went (session evidence)

The build worked and looked good, but ~40% of it was **rediscovering and hand-fixing known
WordPress block-validity gotchas** — not design. Mapped to the log:

| Phase | Lines | What happened |
|---|---|---|
| Previews (4 dirs + 4 AI heroes + gallery) | 137–319 | Fine — but 4 real image gens before any building |
| 5-step build (theme.json, patterns, templates) | 319–878 | The actual design work. ~12 patterns + templates |
| **Block-validity firefighting** | **878–1569** | **The big sink.** validate-blocks → editor-gate found **12 failures**; agent canonicalized + hand-fixed covers, counters, borders across ~10 files |
| Front-page wiring via temp `_setup.php` | 1097–1113 | Hand-rolled page creation + `show_on_front` |
| Screenshot verification (incl. a wasted "is it blank?" detour) | 1569–1708 | Good, but a motion artifact cost a diagnostic loop |

### The three recurring validity gotchas the agent rediscovered from scratch
All are **known, deterministic** WordPress canonical-form rules — the agent re-derived each via
`canonicalize.mjs` trial-and-error:

1. **Cover blocks (6 of them, the worst offender).** `has-background-dim-50` is invalid → canonical
   is `has-background-dim`; dim ratios round to nearest 10 (65→70); a cover background `<img>` with
   descriptive alt text needs a matching `alt` JSON attribute (canonical expects `alt=""`); class
   order (`className` before color classes); drop `focalPoint` when unused. (log 1122–1208)
2. **Counter motion pattern — a skill bug.** `data-counter-target` on `core/heading` breaks heading
   validity; the agent had to convert to `<!-- wp:html --><span class="counter" …>`. **This is
   exactly the markup `references/motion.md` tells the agent to write** (its effect-E example puts
   `data-counter-target` on a `core/heading`). The skill ships an invalid example. (log 1464–1542)
3. **Border shorthand** (color+width, no `style`) is INVALID → moved to CSS classes. (log 893–962)

## Ask 1 — agent work that can be removed/simplified

**Root cause:** the skill has the agent *generate* block markup, then *validate*, then *hand-fix*.
Telex's lesson (and AGENTS.md's): for deterministic things, **ship the known-good form, don't
regenerate it.** Concrete removals:

- **Ship canonical block snippets** (`references/block-snippets.md` or a `snippets/` dir of
  pre-validated markup) for the high-risk blocks the agent always gets wrong: cover-with-image+overlay,
  the count-up stat, a bordered card, the dish/price row, a full-bleed hero. The agent *copies and
  fills text* instead of generate→gate→fix. **This alone removes most of lines 878–1569.**
- **Fix the counter bug in `motion.md`** (use the `wp:html` span form) so the skill stops shipping
  markup that fails its own gate. *(quick, unambiguous — doing now)*
- **Stop hand-rolling front-page wiring.** The session wrote a temp `_setup.php` to create pages +
  set `show_on_front`; my earlier eval hit the same area as a bug. Trunk now ships
  `playground.sh front-page` — route the build to it explicitly, or ship a Telex-style
  `content-loader.php` boilerplate that self-registers pages on activation (no per-build PHP).

## Ask 2 — Telex's hardcoded spacing fixes to port

Telex never lets the model "figure out" spacing; it mandates these (Explore findings):

- **theme.json `blockGap` everywhere** — root `styles.spacing.blockGap` + per-block defaults for
  `core/navigation`, `core/buttons`, `core/post-template`, `core/query`, `core/columns` (flex/grid
  containers don't space children by default). *The skill already has these in
  `themes-and-patterns.md` (I added them) — keep, but move them into a **theme.json skeleton** so
  they're never omitted.*
- **Section margin reset — mandatory on every top-level group:**
  `"style":{"spacing":{"margin":{"top":"0"}}}`. Telex requires it on *every* section so WP's default
  child top-margin doesn't break rhythm. The skill mentions it; Telex *mandates* it.
- **Fixed CSS block every theme gets** (Telex puts this in `style.css` verbatim): the loop layout
  utilities (rail/list/zigzag/timeline/magazine), `.equal-cards` equal-height columns, and
  `.wp-site-blocks > footer { margin-block-start: 0 }`. **Ship this as a boilerplate `style.css`
  fragment the agent appends — don't have it re-author the CSS.**

## Ask 3 — gates: simplify + make visual feedback faster/more useful

Three gates today: `validate-blocks.cjs` (static, fast), `editor-gate.mjs` (live Chromium,
authority), `visual-gate.mjs` (batch screenshots, blank/404 check).

- **`validate-blocks` is low-yield here.** It passed while the *real* 12 failures were caught only
  by `editor-gate` (cover/counter). Keep it (cheap smoke), but recognize editor-gate is the
  authority — and once canonical snippets land, **editor-gate iterations drop from 3 to ~1.** The
  win is fewer gate *runs*, via boilerplate, not removing a gate.
- **Screenshots ARE useful but currently misleading on motion themes.** Both `shot.mjs` and
  `visual-gate.mjs` capture full-page **without** emulating reduced motion, so `reveal-on-scroll`
  sections render blank until scrolled — which cost the agent a real diagnostic detour ("is the
  menu blank or just pre-reveal?", log 1605–1630) and made my eval screenshots look broken.
  **Fix: default the screenshot tools to `page.emulateMedia({ reducedMotion: 'reduce' })`** (the
  documented static fallback = all content visible) and force `.reveal-on-scroll.is-visible`. This
  makes one full-page shot faithful, kills the blank-investigation loop, and lets `visual-gate`
  replace the several ad-hoc capture passes with one call. *(clear win — doing now)*
- **Batch, don't one-off.** The session took ~6 separate capture passes; `visual-gate <url> --paths
  /,/menu/,/our-story/,/visit/` does all pages × desktop+mobile in one call with a pass/fail.

## Ask 4 — more boilerplate (Telex one-shot style)

Telex injects deterministic files into *every* theme via `AddArbitraryFilesToArtefactTask` — the
model never writes `content-loader.php`, `styles.php`, `scrollytelling.php`, asset-rewrite, or the
motion JS/CSS. The skill already ships `assets/motion/*` (good). Extend that into a **scaffold**:

**Proposed `scripts/scaffold-theme.sh <theme-dir>`** that drops, in one shot:
1. `theme.json` **skeleton** with the rigor defaults pre-filled (root-padding clamp,
   `useRootPaddingAwareAlignments`, all `blockGap` defaults, paired button/link color *slots*) —
   agent fills palette + fonts only. *Also fixes the eval's "didn't apply the rigor" finding: it
   can't be skipped if it's the starting file.*
2. The boilerplate **`style.css` fragment** (loop utilities + equal-cards + footer reset).
3. **Motion assets** copied + the enqueue snippet appended to `functions.php`.
4. A **`content-loader.php`** (Telex-style) so pages self-register on activation — no temp PHP, no
   front-page bug.
5. A pointer to **`block-snippets.md`** for the canonical high-risk blocks.

This converts the slow "read N references → generate everything → gate → fix" loop into "scaffold
(seconds) → fill palette/fonts/copy → compose pages from snippets → one gate pass." It directly
attacks the ~40% validity-firefighting overhead **and** makes the design machinery reliable
(scaffolded = not skippable), which is the unresolved wiring-gap from the prior eval.

## Recommended order (impact ÷ effort)

1. **Fix `motion.md` counter bug** — trivial, stops the skill failing its own gate. *(now)*
2. **Reduced-motion default in `shot.mjs` + `visual-gate.mjs`** — small, kills the biggest
   screenshot confusion + speeds verification. *(now)*
3. **`references/block-snippets.md`** (canonical cover/counter/card/hero/price-row) — biggest single
   speedup; removes most of the firefighting.
4. **theme.json skeleton + `style.css` boilerplate fragment** — locks in spacing/rigor, less to
   generate.
5. **`scaffold-theme.sh` + `content-loader.php`** — ties 3–4 together into the one-shot scaffold;
   biggest structural change, do last.

Items 1–2 are unambiguous and applied in this pass. 3–5 are the larger boilerplate effort to
confirm scope before building.

---

## Session 2 (naturaleza-sabia, 36 min) — still too slow

A second full build (`sessions/naturaleza-sabia1-design-quality-port.md`) took 36 min. Three
structural causes, all now addressed:

1. **Built the entire site up front** — 4 pages, 9 patterns, **9 AI images**, a 360-line
   `style.css` — most of it unseen while the user waited. **Fix (primary): landing-page-first.**
   `design.md` §5 now builds only the home/front page + its chrome and hands it back live; the new
   §6 asks the user what else to build (other pages, templates, CPTs, forms) scoped to the site
   type. SKILL rule 8 updated. This is the big cut — roughly half the first-pass work and a
   fraction of the image generations.
2. **Scaffold bug — `functions.php` never enqueued `style.css`.** Block themes don't auto-load it,
   so the whole custom-CSS layer (header overlay, cards, menu, footer) silently did nothing while
   theme.json colors worked — the agent burned a long CSSOM/service-worker diagnostic detour
   (~log 1423–1513) to discover it. **Fixed:** the scaffold's `functions.php` now enqueues
   `get_stylesheet_uri()` on the front end and `add_editor_style('style.css')` for the editor.
3. **`fix-blocks` bug — it HTML-escaped `<?php`** inside a cover's `url`/`src` (patterns embed
   `<?php echo esc_url( get_theme_file_uri(...) ); ?>`), corrupting the hero → manual rewrite.
   **Fixed:** `fix-blocks` now skips pattern bodies containing `<?php` (parse/serialize can't
   round-trip embedded PHP); validate-blocks + a hand fix cover those rare files.

Remaining speed ideas (not yet done): adopt Telex's `theme:./` asset pseudo-URL + a render-time
rewrite boilerplate so patterns carry no inline PHP. (Superseded: fix-blocks now masks inline <?php?> spans with a URL-shaped sentinel, repairs the block, and restores the PHP byte-for-byte — so it auto-repairs covers in PHP patterns directly, no theme:./ change needed.)

**Done:** `editor-gate` is now a single final pass — `block-markup.md` "Final gate" + SKILL rule 3
frame it as run-once-per-hand-back (landing page, then §6 additions), never a per-file
fix-discovery loop; the instant inner loop (fix-blocks + validate-blocks) does the finding/fixing.
