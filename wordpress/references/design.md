# Design: previews-first selection + the screenshot–inspect–fix loop

## New site or material redesign: browser previews, not text options

Before building a new site/theme (or materially redesigning one), pick the preview path that
matches how constrained the brief is — there are **three**, not two:

- **Vague or open brief, or a material redesign → full 4-preview gallery.** The default workflow
  below (steps 1–4): four divergent directions judged side by side in the browser. Use this
  whenever the brief leaves the aesthetic genuinely open.
- **Tightly-specified brief → one preview ("single best direction").** When the brief already
  pins palette/genre/mood (e.g. *"minimalist photojournalism portfolio, Buenos Aires"* — it
  names the aesthetic, not just the topic), don't manufacture four directions to discard three.
  Commit to the single direction the brief implies, render **one** first-fold preview, show it
  in the browser, and record it as a 1-element `directions.json`. Proceed once the user approves
  (or asks for tweaks). This is a real preview the user judges — **not** a silent skip, and not
  four-preview ceremony the brief doesn't warrant.
- **Small edit, or the user says skip → no preview.** Proceed with your single best direction
  and say which you chose.

The single-direction path **is** the previews workflow below — image handling first, render
first-fold HTML, serve over HTTP, show in the browser, carry the choice forward as the contract
— just with one option instead of four. Everything else in this file applies unchanged.

**First, resolve image handling** (`references/images-media.md`): ask the user — always, even
when already logged in — how to handle imagery, presenting the four options (generate AI photos
first, then plain placeholders, provide their own, or imageless). The answer changes what the
previews contain (real images, solid placeholder blocks, or CSS-only heroes), so it must be
settled *before* you render previews, not after a direction is picked.

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
`directions.json` in the preview dir (step 3). (**Single-direction path:** write just the one
direction the brief implies, as a 1-element array — same shape, one entry.)

### 2. Render each direction as a first-fold HTML preview

For each direction, generate one complete, self-contained HTML document:

- **First fold only**: header/navigation + hero. Nothing below the fold, no footer.
- Inline CSS in `<head>`; no JavaScript; no external dependencies (a Google Fonts
  stylesheet link is the only exception, when the direction needs it).
- **Use the block-theme width constraints so the preview predicts the real theme**:
  `--content-size: 800px` for text content, `--wide-size: 1280px` for header/hero content;
  only backgrounds run full-viewport. A preview that ignores these renders wider than the
  theme ever will.
- Hero imagery follows the image-handling choice (resolved above, recorded in
  `workdir/.playground/images.json` — see `references/images-media.md`):
  - **`yes`** (generate AI): generate a real hero image for *each* direction and use it — a
    preview that says "yes to images" but renders a CSS gradient misrepresents the design. Derive
    a prompt from the direction's hero composition + mood and write it into that option's preview
    dir, e.g. `node <skill-dir>/scripts/wpcom-images.mjs generate --prompt "<hero composition>, <style> style" --aspect 16:9 --out workdir/previews/option-N/hero.png`, then reference it with a
    relative `<img src="hero.png">` (the gallery is served over HTTP, so relative paths resolve).
    This is ~4 generations (one per direction), counts against quota, and the chosen direction's
    hero can be reused. If a generation fails or the endpoint is unavailable, fall back to a
    placeholder block (next case) for that one preview rather than shipping a gray box.
  - **`placeholders`** (the default): show a plain solid-color block at the hero's aspect ratio
    (a CSS block tinted from the direction's palette is fine — no need to write a PNG for the
    throwaway preview), clearly reading as "photo goes here". The layout, proportions, and
    chrome are what the user is judging; the real photos land later.
  - **`own`** (user's photos): if the user already pointed you at a folder, drop a representative
    image in; otherwise treat it like `placeholders` for the preview.
  - **`no`** (imageless): build every hero from CSS (gradients, patterns, type-as-image) — no
    `<img>`, no placeholder blocks, consistent with the imageless contract.
- Commit fully to the assigned direction. Generate each preview in isolation — a separate
  subagent per direction where the harness supports it, otherwise one at a time, never
  cross-referencing the others. The four must look like they came from different designers.

### 3. Present a 2×2 gallery in the browser

Write everything to `workdir/previews/` in the project (clear it first if a prior redesign
left option dirs there): `directions.json`, `option-1/preview.html` … `option-4/preview.html`,
and `index.html` — a 2×2 grid of `<iframe>`s, each labeled with its option number and title.
(**Single-direction path:** write the one `option-1/preview.html` and serve it directly — same
HTTP-serve rule below; show that single preview full-cell instead of a 2×2 grid.)
(`workdir/` is the project's gitignored scratch area — persistent across reboots, so generated
preview images aren't silently wiped from `/tmp` and don't have to be re-generated.)

**Each preview must fill its cell exactly — no dead whitespace beside or below it.** Render
every iframe at a real desktop viewport (1280×800) and scale it to fit with a *measured*
transform — never a hardcoded factor like `scale(0.5)`, which only fits one monitor width.
Give the cell the same aspect ratio so width-fitting fills both dimensions. (The
no-JavaScript rule binds the previews, not this shell.) Use this pattern in `index.html`:

```html
<style>
  .cell { position: relative; aspect-ratio: 1280 / 800; overflow: hidden; }
  .cell iframe { position: absolute; width: 1280px; height: 800px; border: 0; transform-origin: 0 0; }
</style>
<script>
  const fit = () => document.querySelectorAll('.cell iframe').forEach(f =>
    f.style.transform = `scale(${f.parentElement.clientWidth / 1280})`);
  addEventListener('load', fit); addEventListener('resize', fit);
</script>
```

**Serve the gallery over a local HTTP server — never hand the user a `file://` path.** The
`index.html` loads each preview through a relative `<iframe src>`, and a sandboxed browser
(Flatpak/Snap Chrome/Firefox, the common Linux default) opens `file://` URLs through a
document portal that rewrites the path to something like
`file:///run/user/1000/doc/<hash>/index.html`. The siblings aren't exposed there, so every
iframe 404s and the user sees an empty grid of labels. A local HTTP origin sidesteps the
portal completely and serves the relative links correctly. Serve the gallery with this
skill's `scripts/serve-dir.mjs` (Node, zero dependencies; resolve the path against the
skill directory). It binds loopback on an ephemeral port, prints the real URL, and records
its PID — never hardcode or guess a port, and don't substitute `python3 -m http.server`,
`npx serve`, or `php -S`: Node is the only runtime this skill guarantees (and the npm
registry may be sandboxed off).

```bash
cd workdir/previews
setsid nohup node <skill-dir>/scripts/serve-dir.mjs . > server.log 2>&1 &
sleep 1
URL=$(grep -m1 -o 'http://[0-9.:]*/' server.log)   # e.g. http://127.0.0.1:53412/
curl -s -o /dev/null -w '%{http_code}\n' "${URL}option-1/preview.html"  # expect 200; on failure read server.log
```

(`setsid nohup` keeps the server alive while you stop and wait for the user's answer — same
pattern `playground.sh` uses for its own server.) Optionally also `xdg-open`/`open` the
URL, but always print it so the user can open it themselves. Then **stop and ask in chat**
which option to build on (1–4, or none) — do not write any theme files until the user
answers or skips. Once a direction is chosen, **stop the preview server** with
`kill "$(cat server.pid)"` from the preview dir (it's a disposable helper, not part of the
Playground lifecycle).

### 4. Carry the selection forward as the first-fold contract

The selected direction text + its `preview.html` are the contract for palette, typography,
spacing, chrome, and hero composition. They persist in `workdir/previews/` (no need to rescue
them before a temp dir vanishes), so just note which option won — keep the whole gallery around
for reference. The finished theme's first fold must be recognizably descended from the selected
preview; the rest of the site extends its visual language.

## Verify and polish from evidence, not pixels

The rendered page often differs from the markup you wrote (WordPress injects layout classes
and owns spacing). Diagnose from the rendered DOM, then fix in one batch:

1. **Screenshot both viewports** (server must be running; Playwright handles Playground's
   session cookie automatically). After `npm install` in `scripts/checker/`, just run `shot.mjs` —
   it auto-uses Playwright's bundled/cached Chromium, then your system Chrome. Don't pre-run
   `npx playwright install chromium` (unsupported on some newer OSes, e.g. Ubuntu 26.04, and not
   needed). Each shot is full-page at the given width:
   ```bash
   node <skill-dir>/scripts/checker/shot.mjs "$URL" desktop.png 1280 900
   node <skill-dir>/scripts/checker/shot.mjs "$URL" mobile.png  390  844
   ```
   For a multi-page site, capture **every page across both viewports in one call** with
   `visual-gate.mjs` — it also fails loudly on any blank or 404 route, which a desktop-only,
   home-page-only pass silently misses:
   ```bash
   node <skill-dir>/scripts/checker/visual-gate.mjs "$URL" --paths /,/journal/,/about/ --viewports desktop,mobile
   ```
   It writes `visual-<page>-<viewport>.png` for each page and exits non-zero if any page 404s or
   renders blank. Always do the mobile pass, not just desktop.
2. **Diagnose every section before fixing anything.** For each issue the screenshots show,
   inspect the live DOM and computed styles (Playwright `page.evaluate` with
   `getComputedStyle`, bounding boxes vs viewport width) to find the actual cause — the
   recurring causes are the layout cascade, doubled button padding, and block-gap, all
   documented in `block-markup.md`. Write the full issue list: section, root cause, exact
   fix.
3. **Fix the whole batch**, re-running `validate-blocks.cjs` on any file whose block markup
   changed, then take one verification screenshot pass. Don't screenshot between individual
   edits.
4. **Hand back live.** Leave the server running and print a clickable URL deep-linked to what
   you changed — `http://127.0.0.1:$(cat workdir/.playground/server.port)/#<anchor>` for a section,
   `/…/` for a page, the home page for site-wide work (SKILL.md's hand-back-live rules). The
   user tests by clicking; don't stop the server unless they ask.
