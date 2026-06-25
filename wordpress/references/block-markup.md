# Block markup: validity, layout, and the two-gate loop

**Why this file exists:** invalid block markup renders fine on the frontend and breaks only
in the editor ("Block contains unexpected or invalid content"). Screenshots cannot catch it.
Defects also hide in server-rendered patterns and in rendered layout — places a file-level
check never sees. So validation is two gates, and the editor gate is the authority.

## The two-gate loop

**Inner loop — after writing OR editing any template / part / pattern / content markup, before
declaring it done. Two steps: auto-repair, then confirm.** (One-time setup in `scripts/checker/`:
`npm install`.)

**1. Auto-repair first — don't hand-fix validity, and don't open the editor to fix it:**

```bash
node scripts/checker/fix-blocks.cjs <files...>      # add --dry to preview
```

This re-creates every named block from its parsed attributes (`createBlock` → `serialize`),
regenerating the exact markup WordPress `save()` produces. It fixes the recurring INVALID cases
mechanically, in milliseconds, with **no browser and no live site**: cover `<img>`/`<span>` order
+ `has-background-dim` class + required `alt=""`, border-shorthand classes (`has-border-color`),
element/attribute/CSS-property order, and dropped unknown attributes. Freeform `wp:html` blocks
and pattern PHP headers are left untouched. Run it on every file you just wrote or changed — it is
the answer to "the editor would flag this," without paying for the editor.

**Run it on `patterns/*.php` too — that is where covers live and where the editor gate otherwise
finds failures.** fix-blocks masks inline `<?php … ?>` (e.g. `get_theme_file_uri()` in a cover
`url`/`src`) with a sentinel, repairs the block structure, and restores the PHP byte-for-byte — so
a PHP cover is auto-repaired exactly like an `.html` one. **Do not skip PHP patterns and let the
editor gate discover their cover/group failures** (then hand-fix via `canonicalize.mjs`) — that
trial-and-error loop is the slow path this script exists to replace. Glob it all:
`fix-blocks.cjs <theme>/patterns/*.php <theme>/templates/*.html <theme>/parts/*.html <theme>/content/pages/*.html`.

**2. Confirm what's left:**

```bash
node scripts/checker/validate-blocks.cjs <files...>
```

Three outcomes:

- `INVALID` — fix-blocks couldn't auto-repair it (rare: genuinely malformed nesting parse() can't
  recover, or a non-core block). This is the only case that needs hand work or the editor below.
- `LINT` — fix it (`core/missing`, `core/freeform`, raw `<style>` tags, unknown block types).
- `NORMALIZE` — **warning only.** Deprecated-but-valid form; fix-blocks already rewrites these to
  canonical. Never treat a NORMALIZE warning as a failure.

Run `validate-blocks.cjs` on the **`.html`** files (templates/parts/content). On a `.php` pattern
it lints the `<?php … ?>` header itself as `core/missing` — that's expected and harmless (it
doesn't strip the header the way fix-blocks does), so don't chase it; patterns are covered by
fix-blocks (above) plus the editor gate (below). The inner loop validates against pinned core
packages only — plugin blocks and the site's actual WP version are invisible to it.

**Final gate — ONE pass, after every file for the deliverable is inner-loop-clean:**

```bash
node scripts/checker/editor-gate.mjs <site-url> <theme-dir>
```

Run editor-gate **exactly once per hand-back** — once for the landing page (`design.md` §5), once
for any later additions (§6). It is slow (it launches Chromium and loads the live editor), so it is
**not** an inner-loop step and **not** a fix-discovery loop: the inner loop above (fix-blocks +
validate-blocks, both instant and free) is where you find and fix validity, and with fix-blocks
auto-repairing the recurring cover/border/order cases it should print `GATE PASS` on the first try.
Before running it, make sure every template/part/pattern has been through the inner loop.

It opens the live site's editor (Playwright). **Just run it** — it auto-uses Playwright's
bundled/cached Chromium, then falls back to your system-installed Chrome. Don't pre-run
`npx playwright install chromium`: that download is unsupported on some newer OSes (e.g. Ubuntu
26.04) and the gate doesn't need it — a bundled/cached build is usually already present, and a
failed *install* is not a failed *gate*. Only install a browser if the gate itself reports it
tried both and found none. It validates every template, part, and **server-rendered pattern**
against the site's full block registry. It must print `GATE PASS`.

**If it reports `INVALID`,** that means a file skipped the inner loop. The gate prints the
**canonical markup the editor expects** beneath the failure line — but rather than hand-diffing,
run `fix-blocks.cjs` then `validate-blocks.cjs` on the *named* file, fix anything they still flag,
and re-run the gate **once**. Don't iterate the editor gate to chip away at failures one at a time
— that is the slow path the inner loop exists to prevent. Then check rendered layout with a
screenshot (see `design.md`) — the gate catches invalid blocks, not a hero rendering with gutters.

**Only if `validate-blocks.cjs` still reports `INVALID` after `fix-blocks.cjs` (rare)** — the
block is beyond mechanical repair. Ask the live editor for the canonical form rather than
hand-balancing divs by trial and error:

```bash
node scripts/checker/canonicalize.mjs <site-url> patterns/hero.php            # canonicalize a file (or "-" for stdin)
node scripts/checker/canonicalize.mjs <site-url> --block core/cover --attrs '{"url":"x.png","alt":"...","dimRatio":50}'
```

It parses (or builds, in `--block` mode) against the running site's real registry and prints the
**canonical** serialization to copy, plus per-block `✓`/`✗`. This is the authoritative answer to
"the gate says INVALID — then what *is* the right markup?": the diff between your markup and the
canonical output is the fix. (Reuses the same browser discovery as the gate; no extra setup.)

## Validity rules

**One root element per block.** Each block owns exactly one root HTML element between its
comment delimiters. Merge all classes and styles onto that one element; never nest a second
element of the same type inside it.

**The comment JSON must match the HTML classes/styles exactly.** Verified mappings:

```html
<!-- wp:paragraph {"backgroundColor":"espresso","textColor":"cream"} -->
<p class="has-cream-color has-espresso-background-color has-text-color has-background">Text</p>
<!-- /wp:paragraph -->
```

- `"textColor":"X"` → `has-X-color has-text-color`; `"backgroundColor":"Y"` →
  `has-Y-background-color has-background`.
- `"align":"full"` on a container → `alignfull` class (`"wide"` → `alignwide`).
- Text alignment serializes as a style attribute now:

```html
<!-- wp:paragraph {"style":{"typography":{"textAlign":"center"}}} -->
<p class="has-text-align-center">Text</p>
<!-- /wp:paragraph -->
```

- `style` attributes → inline CSS; preset references use `var:preset|spacing|60` in JSON and
  `var(--wp--preset--spacing--60)` in the HTML:

```html
<!-- wp:group {"backgroundColor":"contrast","textColor":"base","align":"full","style":{"spacing":{"margin":{"top":"0"},"padding":{"top":"var:preset|spacing|60","bottom":"var:preset|spacing|60"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group alignfull has-base-color has-contrast-background-color has-text-color has-background" style="margin-top:0;padding-top:var(--wp--preset--spacing--60);padding-bottom:var(--wp--preset--spacing--60)"><!-- wp:heading {"style":{"typography":{"textAlign":"center"}}} -->
<h2 class="wp-block-heading has-text-align-center">Section title</h2>
<!-- /wp:heading --></div>
<!-- /wp:group -->
```

- Preset font size `"fontSize":"large"` → `has-large-font-size`; custom
  `{"style":{"typography":{"fontSize":"1.2rem"}}}` → `style="font-size:1.2rem"`.

**Cover block** — the structure that fails most often in the wild. Current canonical form
(`<img>` BEFORE the overlay `<span>`; older span-first markup and `has-background-dim-50`
classes are deprecated forms):

```html
<!-- wp:cover {"url":"https://example.com/hero.jpg","dimRatio":50,"customOverlayColor":"#1a1a1a","isUserOverlayColor":true,"align":"full"} -->
<div class="wp-block-cover alignfull"><img class="wp-block-cover__image-background" alt="" src="https://example.com/hero.jpg" data-object-fit="cover"/><span aria-hidden="true" class="wp-block-cover__background has-background-dim" style="background-color:#1a1a1a"></span><div class="wp-block-cover__inner-container"><!-- wp:paragraph -->
<p>Hero copy</p>
<!-- /wp:paragraph --></div></div>
<!-- /wp:cover -->
```

**Button block** — two nested elements; color classes go on the `<a>`, and
`wp-element-button` is always present on it:

```html
<!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"}} -->
<div class="wp-block-buttons"><!-- wp:button {"backgroundColor":"accent","textColor":"base"} -->
<div class="wp-block-button"><a class="wp-block-button__link has-base-color has-accent-background-color has-text-color has-background wp-element-button">Order Now</a></div>
<!-- /wp:button --></div>
<!-- /wp:buttons -->
```

**Image block** — `<figure>` is the root; `"sizeSlug":"large"` → `size-large` on the figure:

```html
<!-- wp:image {"sizeSlug":"large"} -->
<figure class="wp-block-image size-large"><img src="https://example.com/feature.jpg" alt="Feature illustration"/></figure>
<!-- /wp:image -->
```

**Social links** — a `<ul>` root; child `core/social-link` blocks are **self-closing**
(`/-->`, no inner HTML). `"iconColor":"x"` (a preset) emits both `"iconColorValue"` and a
`has-icon-color` class; `"size"` is a full class string (`has-normal-icon-size`); a style
variation like `is-style-logos-only` is a `className`. Class order on the `<ul>` is
size → color → variation:

```html
<!-- wp:social-links {"iconColor":"vivid-cyan-blue","iconColorValue":"#0693e3","size":"has-normal-icon-size","className":"is-style-logos-only","layout":{"type":"flex","justifyContent":"center"}} -->
<ul class="wp-block-social-links has-normal-icon-size has-icon-color is-style-logos-only"><!-- wp:social-link {"url":"https://instagram.com/example","service":"instagram"} /-->
<!-- wp:social-link {"url":"https://x.com/example","service":"x"} /--></ul>
<!-- /wp:social-links -->
```

**Columns** — `core/columns` wraps `core/column` children. A column's `"width"` becomes an
inline `style="flex-basis:…"` (a style, not a class); the wrapper carries only
`wp-block-columns` (+ `alignwide`/`alignfull` from `align`). Omit `width` on every column for
equal widths.

```html
<!-- wp:columns {"align":"wide"} -->
<div class="wp-block-columns alignwide"><!-- wp:column {"width":"66.66%"} -->
<div class="wp-block-column" style="flex-basis:66.66%"><!-- wp:paragraph -->
<p>Left</p>
<!-- /wp:paragraph --></div>
<!-- /wp:column -->
<!-- wp:column {"width":"33.33%"} -->
<div class="wp-block-column" style="flex-basis:33.33%"><!-- wp:paragraph -->
<p>Right</p>
<!-- /wp:paragraph --></div>
<!-- /wp:column --></div>
<!-- /wp:columns -->
```

**Query loop** — `core/query` holds a `core/post-template` whose self-closing children render
once per post; pagination lives in a sibling `core/query-pagination`. The `<div>` wrappers exist
only on `query` and `query-pagination` — `post-template` and every `post-*` child are
comment-only (no HTML between delimiters). Give each query loop a unique `queryId`.

```html
<!-- wp:query {"queryId":1,"query":{"perPage":6,"postType":"post","order":"desc","orderBy":"date"},"align":"wide"} -->
<div class="wp-block-query alignwide"><!-- wp:post-template {"layout":{"type":"grid","columnCount":3}} -->
<!-- wp:post-featured-image {"isLink":true,"aspectRatio":"3/2"} /-->
<!-- wp:post-title {"isLink":true} /-->
<!-- wp:post-excerpt /-->
<!-- /wp:post-template -->
<!-- wp:query-pagination -->
<!-- wp:query-pagination-previous /-->
<!-- wp:query-pagination-numbers /-->
<!-- wp:query-pagination-next /-->
<!-- /wp:query-pagination --></div>
<!-- /wp:query -->
```

**Navigation** — `core/navigation` is server-rendered: in markup it is **comment-only, with no
wrapper element** (the `<nav>`/`<ul>` are generated at render time). Its children are self-closing
`core/navigation-link` blocks (or a single `core/page-list /` to auto-list pages). Writing a
`<nav>…</nav>` between the delimiters is the usual cause of an INVALID navigation.

```html
<!-- wp:navigation {"layout":{"type":"flex","justifyContent":"right"}} -->
<!-- wp:navigation-link {"label":"Work","url":"/work","kind":"custom"} /-->
<!-- wp:navigation-link {"label":"About","url":"/about","kind":"custom"} /-->
<!-- /wp:navigation -->
```

**Never** put raw `<style>` tags in templates, parts, or patterns (lint failure; styles
belong in theme.json or style.css). **Never** use `<inner-blocks>` placeholders — write the
full expanded markup. Don't paste block examples from other codebases or old docs
unchecked: a meaningful fraction of published examples are stale deprecated forms. Run
everything through `validate-blocks.cjs`.

## Layout cascade (why full-width sections render narrow)

WordPress constrains children of any constrained-layout container to
`theme.json` `settings.layout.contentSize` via
`.is-layout-constrained > *:not(.alignwide):not(.alignfull)`. Custom CSS like
`width: 100%` cannot override that selector. Fix width problems **in markup**, not CSS:

- **Full-bleed section, centered inner content** (hero, banner, CTA): outer `core/group`
  with `{"align":"full","layout":{"type":"constrained"}}`, normal blocks inside.
- **Full-bleed section, full-bleed inner content** (edge-to-edge galleries): outer AND inner
  groups with `{"align":"full","layout":{"type":"default"}}`.
- **Standard reading content**: omit `align` entirely.

The observed failure: a hero meant to be full-width renders ~1248px at a 1280px viewport —
visible gutters. Verify the first content section's computed width equals the viewport
width; if not, the cause is `align`/`layout` on the block (or `useRootPaddingAwareAlignments`
/ root padding in theme.json), not missing CSS.

Vertical rhythm is owned by layout CSS, not your margins:
`:where(.is-layout-flow) > * + *` applies `margin-block-start: var(--wp--style--block-gap)`.
Set spacing through `theme.json` `styles.spacing.blockGap` or per-block spacing attributes
rather than fighting it with margins.

**Buttons:** WordPress applies the button's padding/background/border to the inner
`.wp-block-button__link` / `.wp-element-button`, never the `.wp-block-button` wrapper. A
custom `className` on a button block lands on the **wrapper**, so CSS like
`.your-class { padding: ... }` stacks a second padded box and doubles the button. Descend:
`.your-class .wp-element-button`. For site-wide button styling target `.wp-element-button`
(it covers buttons from all blocks). Exactly one hover rule, on the inner element.

## Styling default: attribute-serialized

Default to **block JSON attributes + theme.json** for styling. Use `style.css` only for what
attributes cannot express: hover/focus states, media queries, cross-block consistency
(e.g. equal-height card grids). Never style the same property in both layers — when an
attribute and a stylesheet rule fight, the result is unpredictable and invisible in the
editor. This is a default, not a law; follow explicit user preference.
