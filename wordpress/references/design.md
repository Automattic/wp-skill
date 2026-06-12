# Design: direction offer + the screenshot–inspect–fix loop

## Offer design directions first

Before creating a new site/theme or starting a material redesign, offer the user 2–4
**written** design directions (a few lines each: name, mood, palette, typography pairing,
layout idea) and honor the pick. If the user declines or doesn't care, proceed with your
single best direction and say which you chose. Skip this entirely for small edits.

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
