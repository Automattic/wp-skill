# Images: AI generation via Telex, consent, markers, failure policy

Real AI-generated images (hero photos, section images) through the user's own Telex login
(Telex auth **is** WordPress.com auth). The skill ships no API key; `scripts/telex-images.mjs`
does all endpoint work (Node 18+, zero dependencies). User-provided or openly-licensed images
remain an option at any point and need no login.

## Consent comes BEFORE any markup (this is a design fork)

The answer decides whether `AI_IMAGE:` markers exist in the theme at all — ask **before
writing any theme markup**, whenever the site you're about to build would include images or
the user asks for images.

1. **Check the record first**: read `.playground/images.json`. If it exists, respect it — no
   re-asking, ever, including in a fresh session. Absence = never asked.
2. **Already authed** (`telex-images.mjs status` exits 0): no login ceremony. Mention in
   passing that images will be generated via the user's Telex login (usage is never silent),
   and build with markers.
3. **Not authed — ask once, plainly.** Name what is stored and where login happens, in
   substance: *"I can generate real images for this site. That needs a one-time login to
   Telex with your WordPress.com account — I'll give you a link to open in your browser; I
   never see your password, and a token is stored locally so you won't be asked again. Want
   images, or should I design the site without them?"*
4. **Yes** → run `telex-images.mjs auth`, relay the printed verification URL in chat (never
   auto-open a browser, never echo the token), wait for the poll to finish, then build with
   markers. If the device code expires, the script issues one fresh code; if that lapses
   too, treat it as a decline.
5. **No → deliberately imageless design, not a degraded one**: typography-, color-, and
   pattern-driven. Zero placeholder files, zero `AI_IMAGE:` markers, zero empty or broken
   `<img>` anywhere. Say once that "add images" later re-opens the ask.
6. Record the answer either way in `.playground/images.json`:
   `{"images": "yes"|"no", "decided_at": "<ISO timestamp>"}`. A later "add images" /
   "remove images" from the user overwrites it and re-works the affected sections as a real
   design edit, not a find-and-replace.

**Decline ≠ failure.** The no-markers/no-placeholders rule applies only when the user says
no. If the user consented and generation later fails (outage, moderation, rate limit), the
markers and the script's gray placeholder images **stay** so the site renders — see the
failure policy below.

## Where image markup lives: PHP patterns, never Media Library imports

Image-bearing sections go in **pattern PHP files** referencing theme assets via
`get_theme_file_uri()` — in both the block-comment `"url"` attribute and the `<img src>`
(pattern files are PHP throughout):

```php
<!-- wp:cover {"url":"<?php echo esc_url( get_theme_file_uri( 'assets/hero-bakery-counter.png' ) ); ?>","dimRatio":40,"align":"full"} -->
<div class="wp-block-cover alignfull">...<img class="wp-block-cover__image-background" alt="AI_IMAGE: A warm artisan bakery counter with fresh sourdough loaves, golden morning light | photorealistic | landscape" src="<?php echo esc_url( get_theme_file_uri( 'assets/hero-bakery-counter.png' ) ); ?>" data-object-fit="cover"/>...</div>
<!-- /wp:cover -->
```

Block templates (`.html`) cannot run PHP — compose them from patterns with
`<!-- wp:pattern {"slug":"..."} /-->`. Do **not** `wp media import` + absolute URLs instead:
the attachment guid bakes in Playground's junk ephemeral port, and any absolute local URL
breaks on the next port change and drags search-replace into every deploy (verified). The
theme stays self-contained: files in `assets/`, URLs resolved at render time.

## The marker contract

A marker is the `alt` of an `<img>`, with the target filename in the same tag's `src`:

```
alt="AI_IMAGE: <description> | <style> | <aspect>"
```

- **description** — the generation prompt: 1–3 sentences, specific about composition,
  colors, mood. It doubles as the human alt text after generation, so write it to work as
  both.
- **style** — one of: `photorealistic`, `digital-art`, `illustration`, `minimalist`,
  `flat-design`, `3d-render`, `abstract`, `watercolor`.
- **aspect** — `square` (1:1), `landscape` (16:9 — heroes, banners), `portrait` (9:16);
  the ratio strings `1:1 | 4:3 | 3:4 | 9:16 | 16:9` also pass through.
- **Filenames**: lowercase `a-z`, `0-9`, hyphens, **`.png`** (the endpoint returns PNG —
  never name it `.jpg`), descriptive (`hero-bakery-counter.png`). To regenerate or change
  an existing image, write a new marker with a `-v2` (then `-v3`…) filename — existing real
  images are never overwritten.
- **Grid/row consistency**: images displayed together in a row or grid (cards, team
  members, gallery items) MUST share one aspect — never mix.

## Generating: after the editor gate, before "done"

Generation runs once the theme passes both block gates (the markers don't affect validity —
they're just alt text):

```bash
node <skill-dir>/scripts/telex-images.mjs generate --files <theme>/patterns/*.php <theme>/templates/*.html
node <skill-dir>/scripts/telex-images.mjs generate --prompt "..." --aspect 16:9 --out hero.png   # ad-hoc single image
```

For each marker the script generates the image (style folded into the prompt), writes
`<theme>/assets/<name>.png`, and rewrites the alt to the human description. It is
**idempotent**: re-running skips finished images and replaces only its own placeholders —
safe to resume anytime. Expect ~10 s and 1–2 MB per image; plan a batch ≤ ~10 images per
page and confirm with the user before generating dozens. After a batch, verify the images
actually render (cookie-jar curl of the image URLs or a screenshot).

## Failure policy (the script enforces it — don't fight it)

- **502** = generation failed; could be content moderation or a temporary outage — the
  endpoint doesn't distinguish. The script writes a gray placeholder at the right aspect,
  keeps the marker, continues the batch, and lists failures at the end. For repeated 502s
  on one image, rephrase that description; for 502s on everything, tell the user the
  service looks down and that re-running the same command later resumes.
- **401** = token revoked/expired. The script stops and prints the exact re-auth command.
  Don't retry; relay the auth URL flow again.
- **429** (rate limit — forward-compat): the script stops the batch and prints
  `Retry-After`/`resets_at` when present. Never poll-retry; report and move on. Quota is
  display-only — never enforce it client-side.
- A Telex outage must never block site creation: the site renders with placeholders, and
  work continues — image generation is an enhancement, not a dependency.

## Local state and the token

- `.playground/images.json` — the consent record (see above). Per-project, not secret.
- The Telex token lives at `${XDG_CONFIG_HOME:-~/.config}/wp-agent-skill/telex-auth.json`
  (per-user, all projects share it; dir 700, file 600 — the script verifies on every read).
  **Never** copy it into the project tree, print it, or commit it. `status` reports who is
  logged in and warns before the 1-year token expires.
- **Revocation** (user asks to disconnect, or a token may have leaked): the token can be
  revoked server-side at any time —
  `curl -X POST <telex_base_url>auth/logout -H "Cookie: telex_auth_token=<token>"` (read
  `telex_base_url` and the token from the token file; don't echo the token), then delete
  the token file. Every later API call 401s; `auth` re-creates from scratch.
