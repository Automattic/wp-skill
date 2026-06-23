# Block markup: validity, layout, and the two-gate loop

**Why this file exists:** invalid block markup renders fine on the frontend and breaks only
in the editor ("Block contains unexpected or invalid content"). Screenshots cannot catch it.
Defects also hide in server-rendered patterns and in rendered layout — places a file-level
check never sees. So validation is two gates, and the editor gate is the authority.

## The two-gate loop

**Inner loop — after writing any template/part markup, before declaring it done:**

```bash
node scripts/checker/validate-blocks.cjs <files...>
```

(One-time setup in `scripts/checker/`: `npm install`.) Three outcomes:

- `INVALID` — fix it. The markup doesn't match what the block's save function produces.
- `LINT` — fix it (`core/missing`, `core/freeform`, raw `<style>` tags, unknown block types).
- `NORMALIZE` — **warning only.** The markup parses valid but is a deprecated form. Do NOT
  "fix" it by hand-editing the HTML; if you want canonical markup, regenerate the block from
  its attributes — or run `validate-blocks.cjs --fix <files>` to rewrite NORMALIZE-only files to
  `serialize(parse())` automatically (it never touches INVALID/LINT files). Never treat a
  NORMALIZE warning as a failure.

The inner loop validates against pinned core packages only — plugin blocks, PHP patterns,
and the site's actual WP version are invisible to it.

**Final gate — before declaring any block work finished:**

```bash
node scripts/checker/editor-gate.mjs <site-url> <theme-dir>
```

This opens the live site's editor (Playwright). **Just run it** — it auto-uses Playwright's
bundled/cached Chromium, then falls back to your system-installed Chrome. Don't pre-run
`npx playwright install chromium`: that download is unsupported on some newer OSes (e.g. Ubuntu
26.04) and the gate doesn't need it — a bundled/cached build is usually already present, and a
failed *install* is not a failed *gate*. Only install a browser if the gate itself reports it
tried both and found none. It validates every template, part, and **server-rendered pattern**
against the site's full block registry. It must print `GATE PASS`. Then check rendered
layout with a screenshot (see `design.md`) — the gate catches invalid blocks, not a hero
rendering with gutters.

**When a block is `INVALID` (or you want the canonical form), ask the live editor — don't
hand-balance divs by trial and error:**

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
