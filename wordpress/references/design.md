# Design: previews-first selection + the screenshot–inspect–fix loop

## New site or material redesign: browser previews, not text options

Before building a new site/theme (or materially redesigning one), run this workflow. Skip it
entirely for small edits, or if the user says to skip — then proceed with your single best
direction and say which you chose.

**Never present design directions as terminal text, option lists, or ASCII mockups, and
never use a terminal select widget for a design choice.** Directions are internal working
artifacts. The only design artifact a user ever judges is rendered HTML in a real browser.

### 1. Generate 4 design directions (internal — do not show the user)

From the user's brief, write 4 directions, each `{title, description}`: a topic-grounded
title (2–4 words, e.g. "Neón de Medianoche", not "Bold Modern") and a vivid paragraph
covering hero composition, color world (specific hex codes), typography (specific font
names), spatial rhythm, and mood. Scale divergence to the brief: vague brief → 4 radically
different directions; specific brief → keep the user's constraints, vary only what they left
open. Each description must be self-contained (no "same as option 1"). Save them as
`directions.json` in the preview dir (step 3).

### 2. Render each direction as a first-fold HTML preview

For each direction, generate one complete, self-contained HTML document:

- **First fold only**: header/navigation + hero. Nothing below the fold, no footer.
- Inline CSS in `<head>`; no JavaScript; no external dependencies (a Google Fonts
  stylesheet link is the only exception, when the direction needs it).
- **Use the block-theme width constraints so the preview predicts the real theme**:
  `--content-size: 800px` for text content, `--wide-size: 1280px` for header/hero content;
  only backgrounds run full-viewport. A preview that ignores these renders wider than the
  theme ever will.
- Hero imagery: if you can generate or source a real image, use it; otherwise build the
  hero from CSS (gradients, patterns, type-as-image) — no broken `<img>` placeholders.
- Commit fully to the assigned direction. Generate each preview in isolation — a separate
  subagent per direction where the harness supports it, otherwise one at a time, never
  cross-referencing the others. The four must look like they came from different designers.

### 3. Present a 2×2 gallery in the browser

Write everything to `/tmp/wp-design-previews-<site-slug>-<timestamp>/`:
`directions.json`, `option-1/preview.html` … `option-4/preview.html`, and `index.html` — a
2×2 grid of `<iframe>`s, each labeled with its option number and title. Open it
(`xdg-open`/`open`) if a browser-open command is available and permitted; otherwise print
the absolute path and tell the user to open it. Then **stop and ask in chat** which option
to build on (1–4, or none) — do not write any theme files until the user answers or skips.

### 4. Carry the selection forward as the first-fold contract

The selected direction text + its `preview.html` are the contract for palette, typography,
spacing, chrome, and hero composition. Copy both into the project (e.g. `design/` notes)
before the temp dir is lost. The finished theme's first fold must be recognizably descended
from the selected preview; the rest of the site extends its visual language.

## Verify and polish from evidence, not pixels

The rendered page often differs from the markup you wrote (WordPress injects layout classes
and owns spacing). Diagnose from the rendered DOM, then fix in one batch:

1. **Screenshot both viewports** (server must be running; Playwright handles Playground's
   session cookie automatically). From `scripts/checker/` (after `npm install` and
   `npx playwright install chromium`):
   ```bash
   npx playwright screenshot --viewport-size=1280,900 "$URL" desktop.png
   npx playwright screenshot --viewport-size=390,844  "$URL" mobile.png
   ```
2. **Diagnose every section before fixing anything.** For each issue the screenshots show,
   inspect the live DOM and computed styles (Playwright `page.evaluate` with
   `getComputedStyle`, bounding boxes vs viewport width) to find the actual cause — the
   recurring causes are the layout cascade, doubled button padding, and block-gap, all
   documented in `block-markup.md`. Write the full issue list: section, root cause, exact
   fix.
3. **Fix the whole batch**, re-running `validate-blocks.cjs` on any file whose block markup
   changed, then take one verification screenshot pass. Don't screenshot between individual
   edits.
