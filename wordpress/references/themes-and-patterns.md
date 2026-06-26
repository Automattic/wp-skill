# Block themes, theme.json, patterns, navigation, query loops

Structure facts for building block (FSE) themes. For markup validity and the validation
loop, read `block-markup.md` — it applies to every template, part, and pattern here.

## Theme structure

```
style.css        # required: theme header comment
theme.json       # version 3 — central config (palette, typography, spacing, layout)
functions.php    # minimal: enqueue assets, theme support; guard with function_exists();
                 # never close the final PHP tag
templates/       # block templates; index.html is required (fallback)
parts/           # template parts (header.html, footer.html)
patterns/        # block patterns (PHP files, auto-registered)
assets/          # images, local fonts
```

Required `style.css` header fields: `Theme Name`, `Version`, `Text Domain` (matching the
theme slug); add `Description`, `Author`, `License`, `Requires at least`, `Requires PHP` for
anything distributable.

## theme.json (version 3)

theme.json is the single source of truth every other file reads. A theme looks "AI-generated"
mostly because of token sloppiness that surfaces here: unreadable contrast, children touching
in flex/grid containers, buttons inheriting invisible text. Get these right at token-design
time — there is no recovery downstream.

**Don't author theme.json from scratch — start from `boilerplate/theme.json`** (resolve against
the skill dir). It ships every rigor rule below already wired (root-padding clamp,
`useRootPaddingAwareAlignments`, all flex/grid `blockGap` defaults, paired button/link colors) and
a valid, WCAG-safe neutral palette. **Recolor the palette slugs and swap the two font families to
the design; keep the slug names** (`base`/`contrast`/`primary`/`secondary`/`accent`/`surface`/
`border`/`muted`) — every downstream file and the `styles.blocks` defaults reference them by name.
Add slugs if the design needs more; tune `contentSize`/`wideSize`/`blockGap` to the design's
rhythm. `scripts/scaffold-theme.sh` drops this for you (see `references/design.md` §5). The rest of
this section is what that skeleton already encodes — read it to tune, not to re-derive.

- `"version": 3`, `"$schema": "https://schemas.wp.org/trunk/theme.json"`.
- `settings.appearanceTools: true` enables border/spacing/typography/color controls in one
  line.
- Define the design in `settings`: `color.palette` (slugs are what block attributes and
  `has-*-color` classes reference), `typography.fontFamilies` + `fontSizes`,
  `spacing.spacingSizes`, `layout.contentSize` / `wideSize`.
- Set defaults in `styles`: global typography/color, `styles.spacing.blockGap`, and
  `styles.elements` (`heading`, `link`, `button`) before reaching for CSS.

### Color contrast (WCAG AA — a hard rule, not a nicety)
Downstream files reference your slugs by name and trust them to be readable. Verify every
pairing at palette-design time:

- **Body text vs page background** ≥ 4.5:1 (aim 7:1 where the design allows).
- **Button label vs button surface** ≥ 4.5:1 — check *both* directions (light-on-light and
  dark-on-dark are the common failures).
- **Muted/secondary text** ≥ 4.5:1 against *every* surface it renders on (page bg AND card/panel).
- **Saturated accents are usually not readable as body text** — reserve them for borders,
  icons, button surfaces, large display headings.
- **No near-matches:** two slugs under ~25 lightness steps apart fail on normal-weight text.
  Saturated mid-tones (mid-green/blue/orange) look fine as a swatch and routinely fail as a
  text or button background — push toward higher contrast when in doubt.

### Layout & alignment (wires WordPress's full-bleed behavior)
- `contentSize` 800–960px reads better than the ~640px default; reserve narrow widths for
  long-form text. `wideSize` 1200–1400px.
- **`settings.useRootPaddingAwareAlignments: true`** — without it, `align:wide`/`align:full`
  sections inherit body padding and never reach the viewport edge (the classic "full-bleed hero
  renders with gutters" bug — see the layout cascade in `block-markup.md`).
- **`styles.spacing.padding`**: set only horizontal (`left`/`right`) to a fluid value —
  `"clamp(1.5rem, 5vw, 4rem)"` — and `top`/`bottom` to `"0"`. A fixed token gives a cramped
  gutter on desktop and overflows on mobile. Vertical rhythm lives on sections, not the body.
- Once root padding is set, every edge-to-edge section MUST declare `"align":"full"`; content-
  width sections use `"align":"wide"`. A section with no `align` renders at the narrow column.
- **Section margin reset — on EVERY top-level group/section:** add
  `"style":{"spacing":{"margin":{"top":"0"}}}`. WordPress applies a default top margin to direct
  children of `.wp-site-blocks`; without the reset, sections inherit it and the page's vertical
  rhythm comes from stray margins instead of the section padding you control. Pair it with
  `align:full`/`wide` on the same wrapper. (`boilerplate/style-base.css` zeroes the footer's; the
  per-section reset still has to live in the markup.)

### Gap defaults (flex/grid containers don't space children — set these or they touch)
WordPress's flex (`navigation`, `buttons`) and grid (`post-template`) layouts apply **zero gap**
by default. Without theme-level defaults, nav items butt together, buttons touch, and bordered
cards collapse their borders into one stripe. All REQUIRED:

- `styles.spacing.blockGap` — the site-wide vertical rhythm between sibling blocks in any
  default-layout container (prose, post bodies). The single most-leveraged prose-rhythm setting.
- `styles.blocks.core/navigation.spacing.blockGap` (e.g. `var:preset|spacing|30`).
- `styles.blocks.core/buttons.spacing.blockGap` (e.g. `var:preset|spacing|30`).
- `styles.blocks.core/post-template.spacing.blockGap` (e.g. `var:preset|spacing|40`–`50`).
- `styles.blocks.core/columns.spacing.blockGap` — recommended for asymmetric two-column layouts.

### Block defaults (paired-contrast rule)
Blocks that don't override colors fall through to body defaults that may be invisible on tinted
surfaces. For **every** `styles.blocks.<block>.color` and `styles.elements.<el>.color`, set
`background` AND `text` **together** — never one alone — and do the same for `:hover`. Required
pairs: `core/button` (default + `:hover`), `elements.link` (default + `:hover`). A button or
link whose `:hover` pair equals its default pair has an invisible hover state.

### Typography scale
Keep sizes grounded: body 1rem; headings scale modestly (h1 ≤ 2.5–3rem); use `clamp()` for
display text but cap ~3.5rem — sizes above 4rem rarely improve a design. Line-height: body
1.5–1.65, headings 1.1–1.3, never below 1.0. Avoid Inter/Roboto/Arial/Open Sans/system fonts;
pair a distinctive display font with a refined body font.

**`defaultFontSizes: false` is mandatory once you define `fontSizes` — the typography twin of
`defaultPalette: false`.** WordPress core ships default font-size presets on the *standard slugs*
`small`/`medium`/`large`/`x-large` (13px / 20px / **36px** / 42px). With the default
`settings.typography.defaultFontSizes: true`, **core's values WIN over a theme `fontSizes` entry
that reuses those slugs** — so your `"large": "1.25rem"` silently renders as core's **36px**, and
only a non-core slug like `huge` survives. The result is body copy and headings far larger and more
uniform than your scale intends, with nothing in your own files to explain it. Always set
`settings.typography.defaultFontSizes: false` when you ship a `fontSizes` array (the
`boilerplate/theme.json` does). Verify after: `--wp--preset--font-size--large` in the rendered CSS
must equal *your* value, not 36px.

**`fluid` and hand-authored `clamp()` don't mix.** With `typography.fluid: true`, WordPress
re-wraps each preset `size` in its own generated `clamp()` — so a `clamp()` you wrote gets
re-fluidized into something you didn't. If you author your own responsive sizes with `clamp()`
(as the boilerplate does for `x-large`/`huge`), set `typography.fluid: false` so your values pass
through verbatim. If instead you want WP's fluid scaling, give plain `rem`/`px` sizes and let it
generate the clamps — never both.

When you change `theme.json` font sizes or palette and the rendered CSS doesn't update, it is a
**cache**, not your edit: Playground's persistent PHP process and a global-styles transient hold the
compiled stylesheet. Restart (`playground.sh stop` → `ensure …`) to force a clean re-read before
concluding a value is wrong.

## Fonts

Two options:

1. **Bundled font files (preferred — works offline, no consent issues):** declare
   `fontFace` entries in `theme.json` `settings.typography.fontFamilies` with
   `"src": ["file:./assets/fonts/your-font.woff2"]`. WordPress enqueues them in both
   frontend and editor automatically.
2. **Remote CSS (e.g. Google Fonts):** enqueue on the `enqueue_block_assets` hook — NOT
   `wp_enqueue_scripts`, or the editor renders with fallback fonts:

```php
function mytheme_fonts() {
    wp_enqueue_style( 'mytheme-fonts', 'https://fonts.googleapis.com/css2?family=Fraunces:wght@400;600&display=swap', array(), null );
}
add_action( 'enqueue_block_assets', 'mytheme_fonts' );
```

## Patterns

Files in `patterns/` are auto-registered. Each must start with this header (Title and Slug
are mandatory; Slug uses the theme's text domain):

```php
<?php
/**
 * Title: Hero
 * Slug: theme-slug/hero
 * Categories: banner, featured
 * Keywords: hero, cta
 */
?>
```

- Compose patterns into templates with `<!-- wp:pattern {"slug":"theme-slug/hero"} /-->`.
  Every pattern you create should be used in a template — orphan patterns are invisible.
- Patterns may contain PHP (`echo esc_url( get_theme_file_uri( 'assets/hero.jpg' ) )` for
  asset URLs). That PHP makes them invisible to the file-level checker — the editor gate
  validates them server-rendered, which is why it is mandatory.
- For landing pages, build one pattern per section (hero, features, testimonials, CTA…) and
  compose `templates/index.html` from them. Give every top-level section group
  `"style":{"spacing":{"margin":{"top":"0"}}}` and control rhythm with padding, and use
  `align: full`/`wide` for sections (see the layout cascade in `block-markup.md`).
- When the sections live in a page rendered through `core/post-content` (the
  `content/pages/home.html` + `front-page.html` flow the loader uses), the post-content block
  **must** be `<!-- wp:post-content {"align":"full","layout":{"type":"constrained"}} /-->`.
  Without `align:full` it stays at `contentSize` and silently caps every full-bleed section inside
  it — see the post-content rule in `block-markup.md`.

## Navigation

`core/navigation` handles the responsive overlay (hamburger) natively — never add custom
JavaScript for it. Facts that bite:

- `overlayMenu` defaults to `"mobile"` (collapses below ~600px). `"never"` never collapses.
- Always set `overlayBackgroundColor` AND `overlayTextColor` together (palette slugs), or
  the overlay can render invisible text.
- An empty `<!-- wp:navigation /-->` auto-populates from published pages — empty nav on a
  fresh site is normal. For landing pages with anchor sections, write explicit links:
  `<!-- wp:navigation-link {"label":"Menu","url":"#menu"} /-->` inside the navigation block.

Verified header part (site title left, nav right):

```html
<!-- wp:group {"align":"full","layout":{"type":"constrained"}} -->
<div class="wp-block-group alignfull"><!-- wp:group {"align":"wide","style":{"spacing":{"padding":{"top":"var:preset|spacing|30","bottom":"var:preset|spacing|30"}}},"layout":{"type":"flex","flexWrap":"nowrap","justifyContent":"space-between"}} -->
<div class="wp-block-group alignwide" style="padding-top:var(--wp--preset--spacing--30);padding-bottom:var(--wp--preset--spacing--30)"><!-- wp:site-title {"level":0} /-->

<!-- wp:navigation {"overlayBackgroundColor":"base","overlayTextColor":"contrast","layout":{"type":"flex","justifyContent":"right"}} /--></div>
<!-- /wp:group --></div>
<!-- /wp:group -->
```

## Query loops

Strict nesting: post blocks (`core/post-title`, `core/post-featured-image`,
`core/post-excerpt`, …) go inside `core/post-template`, never directly inside `core/query`.
`core/query-pagination` and `core/query-no-results` are siblings of `post-template`. Grid vs
list layout is set on `post-template`.

- `"inherit":true` uses the main query — for archive/search/blog templates, one per page.
  `"inherit":false` + explicit params for curated sections.
- `taxQuery` format is `{"category":[1,5]}` — not WP_Query's nested `tax_query`.
- `sticky` is a string: `""` / `"only"` / `"exclude"`.

Verified example:

```html
<!-- wp:query {"query":{"perPage":6,"postType":"post","order":"desc","orderBy":"date","inherit":false}} -->
<div class="wp-block-query"><!-- wp:post-template {"layout":{"type":"grid","columnCount":3}} -->
<!-- wp:post-featured-image {"isLink":true,"aspectRatio":"16/9"} /-->

<!-- wp:post-title {"isLink":true} /-->

<!-- wp:post-excerpt /-->
<!-- /wp:post-template -->

<!-- wp:query-pagination -->
<!-- wp:query-pagination-previous /-->

<!-- wp:query-pagination-numbers /-->

<!-- wp:query-pagination-next /-->
<!-- /wp:query-pagination -->

<!-- wp:query-no-results -->
<!-- wp:paragraph -->
<p>No posts found.</p>
<!-- /wp:paragraph -->
<!-- /wp:query-no-results --></div>
<!-- /wp:query -->
```
