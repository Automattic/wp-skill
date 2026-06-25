# Telex design quality vs. the `wordpress` skill — gap analysis

**Question:** Telex generates better-looking WordPress sites than the same models do when
driven by this repo's `wordpress` skill. What design-quality machinery does Telex have that
the skill is missing — and what should we add?

**Status (2026-06-23):** Gaps A–F are implemented on branch `design-quality-telex-port`:
- **B (motion):** `assets/motion/{motion.css,motion.js}` + `references/motion.md`.
- **C (theme.json rigor):** expanded `references/themes-and-patterns.md`.
- **A (site spec):** `references/site-spec.md`.
- **D (composition) + E (aesthetics):** `references/aesthetics.md`.
- **F (layout-mode build contracts):** `references/layout-modes.md`.
- **G (reference-site inspiration):** `references/inspiration.md` — URL detection, capture via
  `shot.mjs` + `WebFetch`, visual/content briefs, and below-the-fold section-rhythm/component
  vocabulary.

All wired into `SKILL.md` (5 new routing rows) and `references/design.md`. The **before/after
evaluation** is not yet run. Everything below is the original analysis that motivated these
changes.

**Method:** Read Telex's prompt pipeline (`telex/server/prompts/**`, `telex/server/src/Assistant/Tasks/**`,
`telex/server/artefact-additions/**`) and compared it against the skill (`wordpress/SKILL.md`,
`wordpress/references/*.md`). All file references below are real and current as of 2026-06-23.

---

## 1. How Telex actually produces a theme (the pipeline)

Telex is **not** "one prompt that writes a theme." It is a staged pipeline where each stage
emits a structured artifact the next stage consumes. The design quality comes from the
*structure*, not from a single magic prompt. Order (from `docs/architecture/assistant.md` +
the task classes):

| # | Stage | Prompt / asset | Output it hands forward |
|---|---|---|---|
| 1 | **Style directions** | `style-directions.md` | 4 `{title, description}` directions — cinematic prose, topic-grounded, anti-AI-slop |
| 2 | **Design previews** | `design-previews.md` (×4 in parallel) | 4 first-fold HTML previews (header + hero), one per direction |
| 1–2′ | **Skip path** | `design-solo.md` | One bold direction + first-fold HTML, combined |
| 3 | *User picks one* | `design-selection.md` | the selected direction + preview HTML |
| 4 | **Expand design** | `ExpandDesignTask` | the first fold expanded into a **full-page** HTML reference |
| 5 | **Site spec** | `site-spec-generation.md` | **structured JSON `siteSpec`** (see §3) |
| 6 | **Page composition plan** | `plan-page-compositions.md` | per-page one-paragraph cinematic briefs |
| 7 | **Parallel theme build** | `parallel/foundation.md` (theme.json), `parallel/style-css.md`, `parallel/header.md`, `parallel/footer.md`, `parallel/template.md`, `parallel/content-page.md`, `parallel/functions.md`, `parallel/fonts.md` | the actual theme files, each reading `siteSpec` + selected design + `theme.json` as the source of truth |
| 8 | **Deterministic asset injection** | `artefact-additions/theme/**` | ships `scrollytelling.css` + 4 motion JS files + `content-loader.php` etc. into *every* theme |

The big design-quality multipliers live in stages **4, 5, 6, 7, and 8** — and **the skill has
essentially none of them.** The skill collapses the whole pipeline into: 4 lightweight text
directions → 4 preview HTMLs → user picks → "build the theme, make the first fold match the
preview." It keeps stages 1–3 (in thinner form) and drops 4–8.

---

## 2. What the skill already has (so we don't re-add it)

`references/design.md` covers stages 1–3 reasonably:
- 4 internal `{title, description}` directions, topic-grounded titles, divergence scaled to brief.
- First-fold-only HTML previews with the `--content-size: 800px` / `--wide-size: 1280px` width contract.
- A real-browser 2×2 gallery, served over HTTP, user picks 1–4.
- Carry the selected preview forward as "the first-fold contract."
- A screenshot → inspect-DOM → fix-in-one-batch polish loop.

`references/themes-and-patterns.md` + `references/block-markup.md` cover *correctness*
(theme.json v3 basics, the layout cascade, blockGap, navigation overlay colors, query-loop
nesting, the two validation gates). These are good but they are **structural**, not
**aesthetic** — they keep the theme from breaking, they don't make it beautiful.

**Confirmed absent from the entire skill** (grep for `animat|@keyframes|motion|scroll|reveal|
sitespec|heroComposition|layoutMode|prefers-reduced|WCAG`): no animation/motion anything, no
siteSpec, no heroComposition, no layoutMode, no per-page composition planning, no WCAG/contrast
discipline, no frontend anti-slop aesthetic guidance.

---

## 3. The missing pieces, ranked by likely design-quality impact

### GAP A — No `siteSpec` (the structured contract the whole build reads) ★★★ highest impact

Telex's `site-spec-generation.md` produces a JSON object that **every** downstream generator
reads verbatim. It is the connective tissue that keeps the theme coherent. Key fields:

- **`layoutMode`** — `vertical-stack | sidebar-left | sidebar-right | dual-sidebar | landing-page | magazine-grid | canvas-floating-chrome`. *Every* downstream prompt branches on this. This is why Telex can produce a real documentation layout, a magazine grid, or a full-bleed gallery instead of always defaulting to "header / stack of sections / footer."
- **`headerBehavior`** — `{position, overlayHero, scrolledBackground, shrinkOnScroll}`. Decides the header's positioning contract so `header.html`, `style.css`, and `functions.php` agree (overlay vs. sticky vs. static; opaque vs. translucent-blur scrolled state).
- **`contentMode`** — `homepage-and-pages | blog-first | index-only-no-homepage`. Decides whether there's a marketing homepage, a blog stream, or an index-as-landing.
- **`siteBrief.heroComposition`** — the "cinematic anchor": one paragraph of narrative prose copied near-verbatim from the picked direction, describing hero composition strategy. Downstream block prompts translate this spatial vocabulary into block compositions.
- **`typography`** — explicit primary/secondary font + Google Fonts import URL.
- **`blog`** — categories, tags, post formats, sample posts (only when blog-ish).

**Why the skill's output is worse without it:** the skill carries forward only "the chosen
preview HTML + its description text." That captures the first fold but loses (a) the *page
frame* decision — so the skill almost always builds a vertical stack even when the brief wanted
a sidebar/gallery/docs layout — and (b) the *header behavior* contract, so sticky/overlay/blur
headers are hit-or-miss. There's no single object the theme.json / style.css / templates all
read, so they drift.

**Recommendation:** add a `siteSpec` step to `references/design.md` (or a new
`references/site-spec.md`). After the user picks a direction, the agent writes a
`workdir/.playground/site-spec.json` from the chosen direction + brief, using the schema and
detection cues from `site-spec-generation.md`. Then make `themes-and-patterns.md` and the build
guidance read it. Port the `layoutMode` and `headerBehavior` detection cues and the worked
examples (Telex ships 12 — we can ship 3–4: vertical-stack, sidebar, landing-page, magazine).

### GAP B — No motion / scrollytelling system ★★★ (the one the user explicitly flagged)

Telex ships a **deterministic, taste-bounded animation layer** into every theme. It is two parts:

1. **Shipped asset files** (`telex/server/artefact-additions/theme/`), injected into every theme by `AddArbitraryFilesToArtefactTask` — the model never writes them, only enqueues them:
   - `assets/scrollytelling.css` — all motion CSS, wrapped end-to-end in `@media (prefers-reduced-motion: no-preference)`.
   - `assets/reveal-on-scroll.js` — IntersectionObserver fade/slide-up section reveal.
   - `assets/counter.js` — count-up stat numbers on enter-view.
   - `assets/header-scroll.js` — toggles `body.is-scrolled` / `body.header-hidden`.
   - `assets/active-anchor.js` — landing-page nav underline tracking the scrolled section.
   - `scrollytelling.php` — enqueues the CSS frontend-only (kept out of the editor iframe).
2. **A guide** (`guides/scrollytelling.md`) that tells the model *which* class hooks to put on
   which blocks and *which* JS to enqueue, with a **hard per-page budget** (homepage: 1–2 "rich"
   effects + always-on section reveal + at most 1 header variant; interior pages: section reveal
   only; CPT entries: none). Effect catalog: section reveal (A), hero scroll-fade (B), scroll
   progress bar (C), sticky narrative pin (D), counter (E), and 4 header-on-scroll variants.

The discipline that makes it *tasteful* rather than 2015-parallax-slop is encoded explicitly:
no libraries (GSAP/Lenis/AOS), no scroll-jacking, only animate `opacity`/`transform`/`filter`/
`background-color`, every effect gated on `prefers-reduced-motion`, and a budget cap so the model
doesn't kitchen-sink. There's also a subtle-but-critical reason the CSS ships separately from
`style.css`: `style.css` is loaded into the block-editor iframe via `add_editor_style()`, so a
`.reveal-on-scroll { opacity: 0 }` there blanks the editor canvas.

**Why the skill's output is worse without it:** the skill produces fully static pages. Telex
pages "feel alive" on load and scroll. This is probably the single most visible difference in a
side-by-side demo.

**Recommendation:** copy the 5 asset files + `scrollytelling.php` into the skill (e.g.
`wordpress/scripts/theme-assets/` or `wordpress/assets/`), and add a `references/motion.md` that
ports `guides/scrollytelling.md` (catalog + budget + enqueue table + "what NOT to do"). Add a
SKILL.md routing row and a build step: "copy these files into `assets/`, enqueue per the budget."
Because the assets are deterministic and zero-dependency, this fits the skill's
"exact behavior lives in scripts" convention perfectly. **Lowest-effort, highest-visible win.**

### GAP C — No theme.json design-token rigor ★★★

`parallel/foundation.md` is a 156-line spec for `theme.json` alone. The skill's
`themes-and-patterns.md` gives it ~8 lines. The high-value rules the skill is missing:

- **WCAG AA contrast as a hard rule** at palette-design time — body/bg ≥ 4.5:1, button label vs
  surface (both directions), muted-on-surface, accent-not-as-body-text, no near-matches. This
  single section prevents the "unreadable tinted card / invisible button label" failure that
  silently degrades AI themes.
- **`useRootPaddingAwareAlignments: true`** + the rule that every full-bleed section must declare
  `align:full` — the skill mentions the cascade in `block-markup.md` but doesn't mandate the token.
- **Grid/flex gap defaults** — `core/navigation`, `core/buttons`, `core/post-template`,
  `core/query`, `core/columns` blockGap defaults. WP doesn't space flex/grid children by default,
  so without these, nav items touch, buttons touch, cards collapse their borders into one stripe.
- **Paired-contrast rule for block defaults** — every `styles.blocks.<block>.color` must set
  `background` AND `text` together (and `:hover` too), or inheritance falls through to body white.
- **Per-`layoutMode` theme.json branches** — template-part registration + custom tokens
  (`sidebarWidth`, `rightSidebarWidth`, `scrollPaddingTop`) per layout mode.

**Recommendation:** expand `themes-and-patterns.md`'s theme.json section (or split out
`references/theme-json.md`) with the contrast rules, the mandatory gap defaults, the paired-
contrast rule, and the root-padding/alignment wiring. These are *correctness-adjacent* rules that
read as "polish" — easy to port, high payoff.

### GAP D — No "full-page reference" expansion + no per-page composition planning ★★

Telex carries the first fold forward in two refinements the skill lacks:
- **`ExpandDesignTask`** expands the picked first-fold preview into a *full-page* HTML reference
  (`{FULL_PAGE_DESIGN}`), so downstream prompts see a whole composed page, not just a hero.
- **`plan-page-compositions.md`** then writes a one-paragraph cinematic brief *per page* (homepage
  gets 5–8 sections and the richest treatment; About 3–5; Contact 2–3), explicitly defending
  against "every page composed identically" and forcing each page to have ≥1 distinctive section.

**Why the skill's output is worse:** the skill says "the rest of the site extends its visual
language" but gives no mechanism — so interior pages tend to be thin and homepages tend to stop
at the hero + a couple of generic sections.

**Recommendation:** add to `design.md` a lightweight step after selection: expand the chosen
preview into a full homepage composition, then sketch a one-line composition per planned page
before building. Port the "homepage is the centerpiece / minimum 3 unique sections / agency
homepages run 6–8 sections" floor and the per-page variety rule.

### GAP E — No frontend "anti-AI-slop" aesthetic guidance ★★

`create-project-theme.md` ("Frontend Aesthetics Guidelines") + the anti-pattern lists in
`style-directions.md`/`design-previews.md` repeatedly steer the model away from generic output:
no Inter/Roboto/Arial/system fonts, no purple-gradient-on-white, no "text left / image right"
default hero, no topic-agnostic styles, commit to dominant-color-with-sharp-accents palettes,
grounded font-size scale (cap display ~3.5rem, never >4rem), line-height rules, "design must be
guessable from visuals alone." The skill's `design.md` has a little of this for the *previews*
but nothing governs the *final built theme*.

Note this repo already ships a general `frontend-design` skill with similar DNA — worth checking
whether to lean on it or inline a WordPress-specific condensed version.

**Recommendation:** add a short "Aesthetics" section to `themes-and-patterns.md` (or a
`references/aesthetics.md`) with the anti-slop checklist and the typography scale / line-height
numbers, scoped to the built theme, not just the preview.

### GAP F — No layout-mode build guides ★★ (depends on adopting GAP A)

Telex backs each `layoutMode` with a build guide consumed by the parallel prompts:
`guides/fixed-sidebar.md`, `guides/landing-page.md`, `guides/magazine-grid.md`,
`guides/floating-chrome.md`, plus `guides/sticky-elements.md` (the canonical
`header.wp-block-template-part` sticky fix + overflow-ancestor gotcha) and `parallel/style-css.md`'s
header-positioning contract (overlay = `position:fixed`; the `::before` backdrop pseudo-element
trick that avoids breaking the mobile nav overlay's `position:fixed inset:0`).

**Recommendation:** only meaningful once `siteSpec.layoutMode` exists (GAP A). Port at least
`sticky-elements.md` (sticky header is common and the skill has no guidance on the
template-part wrapper quirk) and the header-positioning contract; add the other layout guides
incrementally.

### GAP G — minor: inspiration/reference-site composition ★

`create-project-theme.md` "Composing below the fold from inspiration" + `inspiration-brief.md`
let Telex mirror a reference site's section rhythm / component vocabulary / color blocking. Lower
priority for the skill unless we add URL/image inspiration input.

---

## 4. Recommended implementation order

Sequenced by impact-per-effort. Each is independently shippable and A/B-measurable
(see `exploration2/skill-fixes-ab-measurement.md`).

1. **Motion layer (GAP B).** Copy the 6 deterministic assets + write `references/motion.md`
   (catalog + budget + enqueue table). Self-contained, no dependency on other gaps, most visible.
2. **theme.json rigor (GAP C).** Expand the theme.json guidance with contrast + gap-defaults +
   paired-contrast + root-padding rules. Pure prose port, high payoff, low risk.
3. **siteSpec (GAP A).** Add the structured spec step + `layoutMode`/`headerBehavior` detection
   and have the build read it. Bigger change; unlocks F.
4. **Full-page expansion + per-page planning (GAP D)** and **aesthetics guidance (GAP E).**
5. **Layout-mode build guides (GAP F)** — port `sticky-elements.md` first, then the rest.

## 5. How to evaluate

Per `exploration2/skill-fixes-ab-measurement.md`: pick a fixed set of briefs (coffee shop, law
firm, photography portfolio, docs site, magazine), generate with the current skill vs. the
patched skill, screenshot both viewports, and compare against Telex output for the same briefs.
Watch specifically for: does the page move on scroll (B), are buttons/cards readable and spaced
(C), did the right page frame get chosen (A), are interior pages substantive (D), and does the
type/palette read as designed-for-topic rather than generic (E).

---

## Appendix — source map (Telex)

- Pipeline overview: `telex/docs/architecture/assistant.md`
- Directions / previews / skip: `server/prompts/style-directions.md`, `design-previews.md`, `design-solo.md`, `design-selection.md`
- Site spec: `server/prompts/site-spec-generation.md`; task `server/src/Assistant/Tasks/GenerateSiteSpecTask.php`
- Page planning: `server/prompts/plan-page-compositions.md`
- theme.json: `server/prompts/parallel/foundation.md`
- style.css contract: `server/prompts/parallel/style-css.md`
- Master theme prompt / aesthetics: `server/prompts/create-project-theme.md`
- Motion guide: `server/prompts/guides/scrollytelling.md`
- Deterministic motion assets: `server/artefact-additions/theme/assets/*.js`, `assets/scrollytelling.css`, `scrollytelling.php`
- Layout guides: `server/prompts/guides/{fixed-sidebar,landing-page,magazine-grid,floating-chrome,sticky-elements}.md`
