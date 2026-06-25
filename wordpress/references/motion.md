# Motion: tasteful scroll behavior for built themes

A static theme reads as "AI slop". One or two restrained scroll effects make a page feel alive
without becoming a 2015 parallax demo. This skill ships the runtime so you don't hand-write
motion JS — you copy two files, enqueue them, and add class hooks to the right blocks. Stay
inside the catalog below; never pull in a library (GSAP, Lenis, ScrollMagic, AOS).

Apply this when building a new theme or materially redesigning one. Skip it for tiny edits.

## Install (once per theme)

Copy the two shipped assets into the theme, then enqueue them **frontend-only**:

```bash
mkdir -p <theme>/assets
cp <skill-dir>/assets/motion/motion.css <theme>/assets/motion.css
cp <skill-dir>/assets/motion/motion.js  <theme>/assets/motion.js
```

In `functions.php` (resolve `<themeprefix>` to the theme's text domain):

```php
add_action( 'wp_enqueue_scripts', function () {
    wp_enqueue_style(
        '<themeprefix>-motion',
        get_theme_file_uri( 'assets/motion.css' ),
        array(),
        wp_get_theme()->get( 'Version' )
    );
    wp_enqueue_script(
        '<themeprefix>-motion',
        get_theme_file_uri( 'assets/motion.js' ),
        array(),
        wp_get_theme()->get( 'Version' ),
        true // footer
    );
} );
```

**Use `wp_enqueue_scripts`, never `add_editor_style()` and never `enqueue_block_assets`.**
`motion.css` carries `.reveal-on-scroll { opacity: 0 }`; if it loaded inside the block-editor
iframe, every reveal section would render blank and the editor canvas would read as empty.
Frontend-only is what keeps it out of the editor. (`motion.js` is self-wiring, idempotent, and
feature-detected — it no-ops for any hook the page doesn't use and bails entirely under
`prefers-reduced-motion: reduce`, so enqueueing it unconditionally is fine.)

## Effect catalog — add the hooks; the assets do the rest

### A. Section reveal on enter view — always on
Each top-level section fades in + slides up 24px as it enters the viewport. Add the
`reveal-on-scroll` class to every top-level section `wp:group` on the homepage and interior
pages. **Not on the hero** — it's already visible on load; a fade there looks broken.

```html
<!-- wp:group {"className":"reveal-on-scroll","align":"full","style":{"spacing":{"margin":{"top":"0"}}}} -->
```

### B. Hero scroll-fade — CSS-only
Hero content fades + lifts as the user scrolls past it. Add `hero-content` to the **inner
content group of the hero** (not the `wp:cover` itself — that would shrink the backdrop). Use
only on the first homepage hero. Good for landing/brand/immersive themes; skip on minimal or
document-heavy themes where the hero must stay readable.

### C. Scroll progress bar — CSS-only
A thin bar at the top of the viewport that fills as the page scrolls. Best for longform /
editorial reads. Emit one block at the very top of the page body:

```html
<!-- wp:html --><div class="scroll-progress" aria-hidden="true"></div><!-- /wp:html -->
```

### D. Sticky narrative pin — CSS-only
A two-column section where the left column pins while the right scrolls past (NYT-style). Build
with `<!-- wp:columns {"className":"narrative-pin"} -->`; first column = short heading/explainer
(must fit one viewport), second column = the longer scrolling content. Reserve for a case study
or founder story — not a generic features grid.

### E. Count-up stats — needs `motion.js`
Stat numbers count from 0 to their target on enter-view. Use only when the page has 2–4
genuine stat numbers. `data-counter-target` is required; `-suffix`/`-prefix` optional.

**Use a `wp:html` span, NOT a `core/heading`.** Custom `data-*` attributes on `core/heading`
(or any core block) fail the editor gate — the block's saved markup won't match and the editor
reports "invalid content." `wp:html` is freeform, so the `data-counter-target` attribute is
valid there, and `motion.js`'s `.counter[data-counter-target]` selector matches it the same.
Size/weight/color it from `style.css` (the `.counter` / a `.stat-num` class), not block attrs.

**Write the FINAL value as the span's text — not `0`.** `motion.js` counts from 0 when it runs,
but it bails under `prefers-reduced-motion: reduce` and does nothing with JS off/failed — in those
cases the span just keeps its HTML text. If that text is `0`, reduced-motion and no-JS visitors
read `0` (wrong), and a full-page screenshot (which emulates reduced motion) captures `0` and looks
broken. Author the formatted final value (matching `data-counter-target` + the suffix); `motion.js`
overwrites it from 0 and animates up when it does run, so you lose nothing:

```html
<!-- wp:html -->
<span class="counter stat-num" data-counter-target="600000" data-counter-suffix="+">600,000+</span>
<!-- /wp:html -->
```

### Header on-scroll variants — pick AT MOST one
`motion.js` toggles `body.is-scrolled` (past 60px) and `body.header-hidden` (while scrolling
down). The variants differ only in what keys off those classes:

- **Shrink on scroll** — set `headerBehavior.shrinkOnScroll`; the `body.is-scrolled .site-header`
  padding rule lives in `style.css` (see `references/themes-and-patterns.md`).
- **Hide on scroll down** — CSS ships in `motion.css` already (keys off `body.header-hidden`).
  No extra work; pick it for longform reading. Requires a sticky header.
- **Invert on scroll** — header transparent over the hero, solid past the fold. This one rule
  needs the theme's palette tokens, so write it in **`style.css`** (it keys off `body.is-scrolled`,
  which only toggles on the frontend, so it stays out of the editor):

  ```css
  @media (prefers-reduced-motion: no-preference) {
      .wp-site-blocks > header.wp-block-template-part > .wp-block-group {
          transition: background-color 0.3s ease, color 0.3s ease, backdrop-filter 0.3s ease;
      }
      body.is-scrolled .wp-site-blocks > header.wp-block-template-part > .wp-block-group {
          background-color: var(--wp--preset--color--background);
          color: var(--wp--preset--color--primary);
          backdrop-filter: blur(8px);
      }
  }
  ```
- **Active-anchor underline** (landing pages only) — CSS ships in `motion.css`; `motion.js`
  wires it automatically when the nav has `href="#..."` links pointing at `<section id="...">`.

## Per-page budget — do not exceed

- **Homepage** — section reveal (A, always on, free) + **1 or 2** of B / C / D / E + **at most
  one** header variant. Zero rich effects is also valid for a minimal/utilitarian theme.
- **Other pages** — section reveal (A) only.
- **CPT/archive entries** — none. Scroll effects there feel decorative.

## What NOT to do

- No libraries (GSAP, Lenis, ScrollMagic, AOS, Locomotive). The catalog covers it.
- No scroll-jacking — no `wheel` listeners that `preventDefault()`, no body-wide scroll-snap.
- Only animate `opacity` / `transform` / `filter` / `background-color`. Animating
  `width`/`height`/`top`/`left`/`padding` triggers layout and janks.
- No `background-attachment: fixed` parallax (kills mobile scroll perf). Use effect B instead.
- Never stack more than one rich page-section effect + one header variant on a page. Restraint
  is the line between "feels alive" and "feels like a 2015 startup landing page."
- Every hand-written motion rule you add to `style.css` MUST be wrapped in
  `@media (prefers-reduced-motion: no-preference)`.
