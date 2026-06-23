# Inspiration: building from a reference site

When the user points at an existing website, look at it before designing — a real screenshot and
the homepage text give you concrete palette, layout rhythm, and domain vocabulary instead of
guesses. Produce an **original** design that captures the *feel*; never copy the site's text,
logos, or imagery.

## 1. Is there a load-bearing reference URL?

A URL is load-bearing when seeing that site would inform the build. Four framings all count —
don't restrict to "make it look like":

- **Visual inspiration** — "make it like stripe.com", "I love nytimes.com's layout".
- **Subject identity** — the site is being built FOR that org — "build a site for lhab.org".
- **Content source** — "rebuild my portfolio at me.example.com".
- **Competitor / contrast** — "should feel different from substack.com".

**Does NOT count:** a bare brand name with no URL ("like Amazon" — you can't fetch "Amazon");
an asset/embed URL (CDN image, YouTube, Calendly, Maps embed — a destination, not a site to learn
from); an email or social handle used as contact; an incidental article URL; and **edit-in-place
wording on the user's own site** ("update my site at example.com to add a form" — that's editing,
not learning from a reference). When in doubt, ask the user whether the URL is a design reference.

## 2. Capture it

Screenshot the site (the agent reads the PNG directly — your vision is the briefing tool) and
pull its homepage text:

```bash
node <skill-dir>/scripts/checker/shot.mjs "https://example.com" workdir/inspiration/ref.png 1280 1200
```

Then Read `workdir/inspiration/ref.png`. For the text, use `WebFetch` on the same URL (or read
visible copy from the screenshot if fetch is blocked). If the screenshot is blank, an error page,
or a parked-domain placeholder, treat it as no reference and proceed from the brief alone — say so.

## 3. Write two compact briefs (≤180 words each)

Save to `workdir/inspiration/brief.md`. Describe style and structure for an *original* build,
never an instruction to copy.

**Visual brief:**
- **Palette** — dominant colors as hex (background, text, accent).
- **Typography** — serif / sans / display; any distinctive treatment.
- **Layout** — the archetype (centered hero + feature grid, fixed sidebar, magazine grid,
  full-bleed imagery) AND the section rhythm top to bottom.
- **Components** — notable patterns (nav style, cards, buttons, hero, footer, marquees).
- **Mood** — 3–5 adjectives.

**Content brief:**
- **Identity** — what the org is in 4–10 words.
- **Audience** — who the site serves.
- **What they do** — 2–4 concrete activities/offerings (name real things, not "various services").
- **Voice** — 3–5 adjectives for the copy's tone.
- **Anchor terms** — 4–8 proper nouns / domain words the new site should use.

## 4. Use it

- **The reference makes the brief "specific."** Per `references/design.md`, honor the reference's
  palette/typography/mood across all 4 design directions; vary only what the reference leaves
  open. Don't generate 4 contradictory interpretations of a clear reference.
- **The layout archetype seeds `layoutMode`** (`references/site-spec.md`) — a magazine reference
  → `magazine-grid`, a docs reference → `dual-sidebar`, full-bleed gallery → `canvas-floating-chrome`.
- **Drive composition below the fold, not just the hero.** Carry the reference's *section rhythm*
  (a 5-section reference doesn't collapse to 3 because the prompt was short), its *color blocking*
  (one dominant color with sharp accents? alternating bands?), and its *edge treatments*
  (full-bleed vs framed vs hairline rules vs overlap). See `references/aesthetics.md` for the
  composition discipline this feeds.
- **Match component vocabulary.** When the reference uses a specific move, reach for it via core
  blocks + a `className` hook defined in `style.css` (no custom block needed):
  - **Marquee/ticker** — `wp:group {"className":"marquee"}`; CSS animates `transform: translateX`
    (wrap in `@media (prefers-reduced-motion: no-preference)` — see `references/motion.md`).
  - **Horizontal scroll row** — `className:"scroll-row"`; `overflow-x:auto; scroll-snap-type:x mandatory`.
  - **Layered/rotated card stack** — `className:"stacked-cards"`; alternate `transform: rotate(±2deg)`.
  - **Asymmetric color blocks** — sequential full-bleed `wp:cover` sections with distinct bg
    colors and `align:full`, optional negative-margin overlap via a `className` hook.
  - **Sticker/pill overlays** — small absolutely-positioned groups over a `position:relative` parent.

  Apply these where the reference's rhythm calls for them — don't sprinkle them on every page.

**Always original.** Use the reference for palette, structure, rhythm, and vocabulary — write
fresh copy, generate fresh imagery, and never reproduce the reference's logo, photos, or text.
