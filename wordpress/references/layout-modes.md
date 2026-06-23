# Layout-mode build contracts

The CSS/markup contract for each `siteSpec.layoutMode` (`references/site-spec.md`). Read the
branch that matches the spec. theme.json deltas per mode live in `site-spec.md`; the page-frame
CSS lives here. All goes in `style.css` unless noted. `vertical-stack` needs none of this — it's
the conventional shape.

## Sticky elements (the rule every sticky chrome depends on)

Block themes have one quirk that breaks the obvious approach.
`<!-- wp:template-part {"slug":"header","tagName":"header"} /-->` renders
`<header class="wp-block-template-part">` whose only child is your inner `wp:group` — so the
`<header>` wrapper's height equals the inner group's. `position: sticky` on the inner group is
applied but visible for **0px** of scroll. **Target the wrapper, which is a direct child of the
page-height `.wp-site-blocks`:**

```css
.wp-site-blocks > header.wp-block-template-part { position: sticky; top: 0; z-index: 100; }
```

If sticky still fails, audit ancestors for non-`visible` `overflow` — any
`hidden|auto|scroll|clip` on `body`, `.wp-site-blocks`, or an intermediate group silently kills
it. Same rule for sticky sidebars, TOC rails, and CTA bars: the sticky element's parent must be
significantly taller than the element; if not, move the declaration up one ancestor.

## `sidebar-left` / `sidebar-right` / `dual-sidebar`

CSS Grid on `.wp-site-blocks` + `position: sticky` on the sidebar item. **Never** `display: flex`
+ `position: fixed` on the sidebar — that fights `useRootPaddingAwareAlignments` and produces a
theme that looks fine in isolation but breaks downstream. Both/all grid items need explicit
`grid-row: 1` (without it, `sidebar-right` drops the main column into a phantom row 2 and the
sidebar's `height: 100vh` leaves a viewport-tall empty band).

```css
.wp-site-blocks { display: grid; grid-template-columns: var(--wp--custom--sidebar-width, 280px) 1fr; }
/* sidebar-right: grid-template-columns: 1fr var(--wp--custom--sidebar-width); + aside { order: 2 } */
.wp-site-blocks > .site-sidebar { grid-column: 1; grid-row: 1; position: sticky; top: 0; align-self: start; height: 100vh; overflow-y: auto; }
.wp-site-blocks > main          { grid-column: 2; grid-row: 1; min-width: 0; }
```

`dual-sidebar` extends to three columns
(`var(--wp--custom--sidebar-width) 1fr var(--wp--custom--right-sidebar-width)`), all on
`grid-row: 1`; the right rail carries an uppercase "On this page" label, anchor links, a hairline
rule, then a small mono metadata block. In all sidebar modes the primary nav lives in the
sidebar, the header is a thin utility bar or omitted, and the header/footer are **never** sticky
or fixed (the sidebar is the only pinned chrome). Keep the sidebar element **first** in source
order even for `sidebar-right`; swap visually via the grid, not markup order.

## `landing-page`

Conventional vertical-stack chrome, but the nav uses anchor links (`#features`) and the hero
fills `100vh`. The one thing that *must* be right is the anchor-jump offset — without
`scroll-padding-top`, clicking a nav link scrolls the target's heading behind the sticky header.

```css
.wp-site-blocks > header.wp-block-template-part {
    position: sticky; top: 0; z-index: 50;
    backdrop-filter: blur(8px);
    background: var(--wp--preset--color--background);
}
html { scroll-behavior: smooth; scroll-padding-top: var(--wp--custom--scroll-padding-top, 80px); }
.wp-site-blocks .alignfull[id] { min-height: 100vh; display: flex; flex-direction: column; justify-content: center; }
.wp-site-blocks .alignfull[id="signup"] { min-height: auto; padding-block: var(--wp--preset--spacing--80); }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
```

Each section is a full-bleed group with a matching `id`. The active-anchor nav underline is a
motion effect — see `references/motion.md`.

## `magazine-grid`

Conventional chrome, but the first fold is the post grid under a thin masthead — no marketing
hero. Two query loops: a lead story, then a uniform card grid. Apply class hooks on the
`wp:query` blocks and style them:

```css
.wp-site-blocks > header.wp-block-template-part { border-bottom: 1px solid var(--wp--preset--color--rule); }
.wp-site-blocks > header.wp-block-template-part > .wp-block-group {
    display: flex; align-items: center; justify-content: space-between;
    padding-block: var(--wp--preset--spacing--30);
}
/* Lead story — single large post */
.is-style-lead-story .wp-block-post-template { display: block; }
.is-style-lead-story .wp-block-post-featured-image { aspect-ratio: 16/9; }
.is-style-lead-story .wp-block-post-title { font-size: clamp(2rem, 4vw, 3rem); line-height: 1.1; }
/* Uniform 3-col card grid */
.is-style-loop-magazine .wp-block-post-template { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--wp--preset--spacing--50); }
.is-style-loop-magazine .wp-block-post-template > li { display: flex; flex-direction: column; }
.is-style-loop-magazine .wp-block-post-featured-image { aspect-ratio: 4/3; }
.is-style-loop-magazine .wp-block-post-date { margin-top: auto; } /* pin byline to card bottom */
@media (max-width: 960px) { .is-style-loop-magazine .wp-block-post-template { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 600px) { .is-style-loop-magazine .wp-block-post-template { grid-template-columns: 1fr; } }
```

Bylines/datelines render in the mono family. The eye should land on the lead headline first.

## `canvas-floating-chrome`

No header band — the chrome floats over edge-to-edge imagery. Set theme.json root padding
`left`/`right` to `"0"` (see `site-spec.md`). The header is `position: fixed` with
`pointer-events: none` on the wrapper (so clicks pass through) and `pointer-events: auto` restored
on the actual chrome elements. `mix-blend-mode: difference` keeps the wordmark legible over any
image (pair with the mid-gray `core/site-title` color from `site-spec.md` — pure black/white
both reverse to invisible under `difference`).

```css
.wp-site-blocks > header.wp-block-template-part {
    position: fixed; inset: 0 0 auto 0; z-index: 100; pointer-events: none;
    padding: var(--wp--preset--spacing--40) var(--wp--preset--spacing--50);
}
.wp-site-blocks > header.wp-block-template-part > .wp-block-group {
    pointer-events: auto; display: flex; justify-content: space-between; align-items: flex-start;
    mix-blend-mode: difference; color: #fff;
}
.canvas-hero .wp-block-cover, .canvas-hero .wp-block-image { width: 100vw; height: 100vh; margin: 0; }
.canvas-hero .wp-block-cover img, .canvas-hero .wp-block-image img { width: 100%; height: 100%; object-fit: cover; }
```

Captions render in the vertical gap between images (small mono metadata strip), never overlaid.

## Header positioning vs `overlayHero` (vertical-stack)

When `headerBehavior.overlayHero` is `true`, sticky is wrong — `position: sticky` keeps the
header in flow, so it pushes the hero down and the body background shows as a band above it. Use
`position: fixed` so the `100vh` hero fills from y=0 and the header floats on top:

```css
.wp-site-blocks > header.wp-block-template-part { position: fixed; inset: 0 0 auto 0; z-index: 100; }
```

Paint the scrolled-state background on a `::before` pseudo-element, **never** on the header
itself — adding `backdrop-filter` (or `transform`/`filter`/`contain`) to the header makes it a
containing block, which collapses the mobile nav overlay's `position: fixed; inset: 0` to header
height (the menu opens but only covers the strip). Pick the scrolled-state color for contrast
against the *body content* that scrolls under it, not against the hero, and never
`var(--wp--preset--color--background)` (that equals the content color → invisible header).

```css
.wp-site-blocks > header.wp-block-template-part::before {
    content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none;
    transition: background 0.4s ease, backdrop-filter 0.4s ease;
}
body.is-scrolled .wp-site-blocks > header.wp-block-template-part::before {
    background: var(--wp--preset--color--<contrast-slug>);          /* opaque-surface */
    /* translucent-blur: background: color-mix(in srgb, var(--wp--preset--color--<contrast-slug>) 80%, transparent); backdrop-filter: blur(12px); */
}
```

`body.is-scrolled` is toggled by `motion.js` (`references/motion.md`). For `overlayHero: false`
+ `position: sticky`, use the plain sticky rule from "Sticky elements" above; for `static`, no
positioning rule at all.
