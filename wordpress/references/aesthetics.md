# Aesthetics & composition: making a theme look designed, not generated

Correctness (valid blocks, readable contrast, no touching elements) keeps a theme from breaking.
It does not make it *good*. This file is the judgment layer — read it when building or
redesigning a theme, after the site spec is set. (This repo's general `frontend-design` skill, if
available, is a useful companion; the rules below are the WordPress-specific distillation.)

## Commit to a direction

Vague briefs are creative latitude, not license to play it safe. Pick an extreme and execute it
with precision — "make a coffee shop theme" should produce a memorable identity, not a beige
default. Pick a tone and commit: brutally minimal, maximalist, retro-futuristic, organic,
luxury/refined, editorial/magazine, brutalist/raw, art-deco geometric, soft pastel, industrial.
Both bold maximalism and refined minimalism work — the failure mode is timid in-between.

**The test:** a viewer should be able to guess what the site is about from the visuals alone,
before reading a word. If the design could belong to any random site, it's too generic — rework
it. Ground the direction in the topic's real-world materials, spaces, and cultural references
(a Georgian restaurant → Caucasus earth tones and ornate pattern; a photojournalist → high-
contrast documentary editorial), not a generic style menu.

## Anti-AI-slop checklist

Models converge on "on-distribution" output. Actively avoid:

- **Generic fonts** — Inter, Roboto, Arial, Open Sans, system fonts. Pair a distinctive display
  font with a refined body font. Don't converge on the same trendy pick (e.g. Space Grotesk)
  across every build.
- **Cliché palettes** — purple gradients on white, safe blue-and-gray corporate. Commit to a
  cohesive palette: dominant colors with sharp accents, not a timid even distribution.
- **The default hero** — "text left, image right." Vary it: full-bleed background, centered
  stack, asymmetric/grid-breaking, split-diagonal, framed/inset, partial coverage.
- **Flat solid backgrounds** — build atmosphere with CSS: gradient meshes, noise/grain textures,
  geometric patterns, layered transparencies, dramatic shadows, decorative borders. For real
  parallax, use a `wp:cover` with `hasParallax:true` (or motion effect B), never
  `background-attachment: fixed`.
- **Emojis as icons** — never. Use inline SVG.

Match implementation effort to the vision: maximalist designs need elaborate CSS and motion;
minimalist designs need restraint and precise spacing/typography. Elegance is executing the
vision well, not intensity. (Type scale and line-height numbers live in
`references/themes-and-patterns.md`; motion in `references/motion.md`.)

## Composition discipline

A theme is only as good as its weakest page. The common failure is a strong hero followed by
thin, identical pages.

**The homepage is the centerpiece.** It carries the full vocabulary of the picked direction.
Minimum 3 unique content sections; agency-grade homepages run 6–8. Image-rich, with the strongest
typography and the boldest layout. Its first fold must descend recognizably from the selected
design preview / `heroComposition`.

**Plan each page before writing it.** Sketch one line per page: section count (home 5–8, About
3–5, Contact 2–3) and the archetypes each uses (full-bleed band, asymmetric two-column, card
grid, zigzag rows, edge-to-edge gallery strip, centered editorial, split-diagonal). Don't compose
every page from the same kit — **each page must have at least one section the others don't.** Two
near-identical pages mean information was lost.

**Auxiliary pages are sketches to riff on, not formulas.** Defaults to adapt to the site's voice:

- **About** — story + mission; optional team, timeline, manifesto, founder letter. A single bold
  editorial story works for a small studio.
- **Contact** — intro + details + form (wire per `references/themes-and-patterns.md` if it must
  persist); optional map, hours, transit.
- **Services** — intro + offerings (grid *or* editorial list *or* zigzag) + CTA; optional process,
  pricing teaser.
- **Menu** — categorized items with prices, shaped to the kitchen's voice (typographic vs photo-led).
- **Gallery / Portfolio** — the layout shape is part of the artistic statement; don't default to a
  uniform grid for a documentary or sculptural body of work.
- **Pricing** — tier cards + CTA; usage-based or single-tier products warrant other shapes.
- **Team / FAQ** — shape to count and length (4 founders → editorial spread; 24 staff → directory).

**Universal floor (every page):** heading + intro + at least one substantive content section +
a closing CTA or related link. A heading over a lorem-ipsum paragraph is a failure. Beyond the
floor, the page must read as designed *for this specific site*.
