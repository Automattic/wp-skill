# Site spec: the structured plan the whole build reads

Before writing any theme file for a new site or material redesign, commit the design decisions
to a small JSON artifact: `workdir/.playground/site-spec.json`. It is not ceremony — it's the
contract that keeps theme.json, style.css, the header part, and every page agreeing on the
*shape* of the site. The single biggest reason skill-built themes underperform is that they
default to a generic vertical stack and a guessed header; the spec forces those decisions up
front and then every file reads the same answer.

Write it right after the user picks a design direction (or after they skip — you pick one).
Derive its values from the chosen direction + the brief, then build against it.

## Schema

```json
{
  "layoutMode": "vertical-stack | sidebar-left | sidebar-right | dual-sidebar | landing-page | magazine-grid | canvas-floating-chrome",
  "headerBehavior": {
    "position": "static | sticky",
    "overlayHero": false,
    "scrolledBackground": "opaque-surface | translucent-blur | none",
    "shrinkOnScroll": false
  },
  "contentMode": "homepage-and-pages | blog-first | index-only-no-homepage",
  "siteBrief": {
    "siteName": "...", "siteType": "...", "primaryGoal": "...",
    "audience": "...", "tone": "...", "brandKeywords": "...",
    "heroComposition": "One paragraph of narrative prose — copy/near-copy the picked direction's hero language. Composition strategy (full-bleed / asymmetric / centered / split-diagonal), image placement, typographic dominance, visual rhythm. NOT bullets — the page prompts read this to translate spatial intent into block compositions."
  },
  "typography": { "primaryFont": "...", "secondaryFont": "...", "fontImport": "https://fonts.googleapis.com/css2?family=..." }
}
```

## `layoutMode` — the page-frame anchor (default `vertical-stack`)

This decides the overall shape of the page, not just the hero. **Every** file branches on it.
Pick `vertical-stack` unless the brief or the picked design explicitly forces another shape.

- **`vertical-stack`** (default) — header strip on top, main in the middle, footer at the
  bottom. Primary nav in the header.
- **`sidebar-left` / `sidebar-right`** — fixed side pane (wordmark + primary nav) flanking a
  scrolling main column. Cues: "fixed sidebar", "categories on the side", "right rail",
  "two-column page". The header reduces to a thin utility top-bar or is omitted.
- **`dual-sidebar`** — documentation chrome: left nav + scrolling main + right "On this page"
  rail. Cues: "docs site", "knowledge base", "wiki", "API reference", "TOC on the right".
- **`landing-page`** — one-pager. Nav uses anchor links (`#features`), hero fills `100vh`, then
  anchor-linked sections. No interior page system. Cues: "one pager", "link in bio",
  "product launch", "event site".
- **`magazine-grid`** — the homepage IS the post archive (tiled grid, no marketing hero). Cues:
  "magazine layout", "news site", "publication", "the homepage is the feed", Medium/Substack-style.
- **`canvas-floating-chrome`** — full-bleed gallery: edge-to-edge imagery, no header band, only
  a small `position:fixed` floating wordmark + menu. Cues: "photography portfolio", "gallery",
  "no chrome", "fullscreen", "edge-to-edge".

Each non-default mode changes theme.json template-part registration and the page-frame CSS — see
"How the spec changes the build" below.

## `headerBehavior` — read the picked design and set all four
- **`position`** — `sticky` only when the design shows nav persisting across the scroll range;
  else `static`. When unsure, `static`.
- **`overlayHero`** — `true` only when the header visually sits ON TOP of the hero (transparent
  header over a full-bleed image/colour band reaching the very top). A tall light-on-light header
  is NOT overlay. Most failures over-claim this.
- **`scrolledBackground`** — required when `position: sticky`. `opaque-surface` (crisp) or
  `translucent-blur` (glassy). `none` only for static headers or a header already solid at all
  scroll positions.
- **`shrinkOnScroll`** — `true` only when the design shows a reduced header height when scrolled.

In any `sidebar-*` mode the sidebar is the chrome — force `{position: static, overlayHero:
false, scrolledBackground: none, shrinkOnScroll: false}`.

## `contentMode` (default `homepage-and-pages`)
- **`homepage-and-pages`** — marketing homepage + interior pages. Front page is the home page.
- **`blog-first`** — the site IS a stream of posts; home page optional (only if the user wants a
  small intro). Cues: "blog", "essays", "newsletter archive", "personal blog".
- **`index-only-no-homepage`** — no marketing landing; the post index is the landing. Cues:
  "no homepage", "just take me to the writing", "the landing is the archive". Drop
  `front-page.html` and the home page; `index.html` carries a composed masthead + query loop.

## How the spec changes the build

**theme.json** (`references/themes-and-patterns.md`):
- `sidebar-*` / `dual-sidebar`: register a `sidebar` (and `right-sidebar`) template-part with
  `"area":"uncategorized"`, and pin widths via `settings.custom.sidebarWidth` (240–320px) /
  `rightSidebarWidth` (220–260px). `dual-sidebar`: tighten `contentSize` to 680–760px.
- `landing-page`: add `settings.custom.scrollPaddingTop` (e.g. `"80px"`) and apply
  `html { scroll-padding-top: var(--wp--custom--scroll-padding-top); }` so anchor jumps clear the
  sticky header.
- `magazine-grid`: tighten `contentSize` to 700–760px, generous `post-template` blockGap.
- `canvas-floating-chrome`: set root padding `left`/`right` to `"0"` (edge-to-edge), keep
  `useRootPaddingAwareAlignments: true`, and give `core/site-title` a mid-gray color so it
  survives `mix-blend-mode: difference` over varied imagery.

**Page-frame CSS** (`style.css`) — the full per-mode contracts (landing, magazine, gallery,
dual-sidebar, overlay-hero header) are in `references/layout-modes.md`. The two highest-value
patterns, repeated here for quick reference:

*Sidebar grid* — use CSS Grid + `position: sticky`, NOT flex + `position: fixed` (fixed fights
`useRootPaddingAwareAlignments` and breaks the theme). Both items need explicit `grid-row: 1`:

```css
.wp-site-blocks { display: grid; grid-template-columns: var(--wp--custom--sidebar-width, 280px) 1fr; }
/* sidebar-right: grid-template-columns: 1fr var(--wp--custom--sidebar-width); */
.wp-site-blocks > .site-sidebar { grid-column: 1; grid-row: 1; position: sticky; top: 0; align-self: start; height: 100vh; overflow-y: auto; }
.wp-site-blocks > main { grid-column: 2; grid-row: 1; min-width: 0; }
```

*Sticky header* — target the WP-generated `<header>` wrapper, not the inner group. The
template-part wrapper's height equals the inner group's, so `position: sticky` on the inner group
is visible for 0px of scroll:

```css
.wp-site-blocks > header.wp-block-template-part { position: sticky; top: 0; z-index: 100; }
```

If sticky still fails, audit ancestors for non-`visible` `overflow` (any
`hidden|auto|scroll|clip` on body/`.wp-site-blocks`/an intermediate group silently breaks it).
For `overlayHero: true`, use `position: fixed` instead so the `100vh` hero fills from y=0 and the
header floats over it; paint the scrolled-state background on a `::before` pseudo-element (never
add `backdrop-filter` to the header itself — it would make the header a containing block and
collapse the mobile nav overlay's `position:fixed; inset:0` to header height).

**Header/footer/nav** — in `sidebar-*` modes the primary nav lives in the sidebar; the header
is a thin utility bar or omitted. Don't duplicate the sidebar inside the page body.

## Heuristics
- When the brief gives no cue for a non-default mode, pick `vertical-stack` + `static` header.
- `heroComposition` is the cinematic anchor — keep it as prose, copy it near-verbatim from the
  chosen direction, and let the homepage's first fold descend recognizably from it.
