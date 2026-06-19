# Images: AI generation via WordPress.com, consent, markers, failure policy

Real AI-generated images (hero photos, section images) through the user's own **WordPress.com
login**, generated server-side by Google Gemini ("Nano Banana Pro"). The skill ships no API key;
`scripts/wpcom-images.mjs` does all endpoint work (Node 18+, zero dependencies). User-provided or
openly-licensed images remain an option at any point and need no login.

The endpoint is `POST https://public-api.wordpress.com/wpcom/v2/ai-image/v1/imagine`. It needs a
logged-in WordPress.com user (no site/blog required). Per-user quota is 200 images/month; usage is
charged only on a successful generation.

## Consent comes BEFORE design previews and any markup (this is a design fork)

How the site handles imagery is the user's choice, and it shapes the **design previews**
(`references/design.md`) — so resolve it *before* rendering previews and before writing any
theme markup, whenever the site you're about to build would include images or the user asks for
images.

**Always ask. Being logged in is not consent.** Authentication never decides whether to ask, and
is never a substitute for asking — it only decides whether a "generate" answer needs a login
step. The one thing that suppresses the question is an existing recorded answer.

1. **Check the record first**: read `workdir/.playground/images.json`. If it exists, respect it — no
   re-asking, ever, including in a fresh session. Absence = never asked → ask now.
2. **Ask, regardless of login state — present four options.** Phrase it for the specific site,
   e.g. *"A photo blog needs images to look right while we design it. How do you want to handle
   imagery for the build/previews? (You'll add your own real photos afterward either way.)"* Wait
   for the answer before continuing. **Present the options in this order — "Generate AI sample
   photos" is always first** — each with its `workdir/.playground/images.json` `images` value:
   - **Generate AI sample photos** (`"yes"`) — **always the first option shown** — real AI
     generation via the user's WordPress.com login. Resolve the mechanics from
     `wpcom-images.mjs status` (only now, after the user picked this — never run it as a reason to
     skip the question):
     - **Exit 0** (logged in): proceed; mention images are generated via their WordPress.com login
       (usage is never silent). `status` actually exercises access (it probes the endpoint with an
       empty prompt), so exit 0 means the token is valid — not merely that a token file exists.
     - **Exit 2** (needs login): offer the one-time login (see "Authenticating" below); frame a
       stale token as "your image login expired — want me to refresh it?". If the user would
       rather not log in, fall back to **Plain placeholders**.
     - **Exit 3** (unreachable): a network/TLS problem, not auth — say the service is unreachable
       and fall back to **Plain placeholders**.
   - **Plain placeholders** (`"placeholders"`) — the no-login fallback, and what to default to
     whenever the user isn't logged in or doesn't want to generate now. Build with `AI_IMAGE:`
     markers, then fill every slot with a solid-color image at the right aspect ratio
     (`placeholders --files …`, below). The layout looks right immediately, no login or generation
     needed, and the markers stay so anyone can generate the real images later with one command.
   - **Provide my own photos** (`"own"`) — the user has photos ready. Ask for a folder path, copy
     the files into the theme's `assets/` (keep the marker filenames so layout/aspect intent is
     preserved), and don't generate anything. No login needed.
   - **Imageless** (`"no"`) — deliberately image-free, not degraded: typography-, color-, and
     pattern-driven. Zero placeholder files, zero `AI_IMAGE:` markers, zero empty or broken
     `<img>` anywhere — in the previews and the theme. Pick this only when the user explicitly
     wants no stand-in imagery at all.
3. **Record the answer** in `workdir/.playground/images.json`:
   `{"images": "placeholders"|"yes"|"own"|"no", "decided_at": "<ISO timestamp>"}`. A later "add
   images" / "generate the images now" / "remove images" from the user overwrites it and re-works
   the affected sections as a real design edit, not a find-and-replace. ("generate the images
   now" on a `"placeholders"` site just runs `generate --files …`, which replaces the
   placeholders in place — see below.)

**Placeholders and AI generation are the same markers.** Both build the theme with `AI_IMAGE:`
markers; the only difference is whether the slots currently hold a solid-color placeholder or a
real generated image. `placeholders --files …` writes solids and **keeps** the markers;
`generate --files …` later detects those placeholders and replaces them with real images,
rewriting the alts to human text. So `"placeholders"` is a first-class state, not a failure mode
— and "generate them now" is always one command away.

**Decline ≠ failure.** The no-markers/no-placeholders rule applies only to the **Imageless**
choice. Under any of the other three, if generation later fails (outage, moderation, quota) the
markers and the gray placeholder images **stay** so the site renders — see the failure policy.

## Authenticating (OAuth2 implicit grant + manual token paste)

This is the same flow the WordPress Studio CLI uses, reusing Studio's WordPress.com OAuth client
(`client_id=95109`). There is no device-flow polling: the user opens a URL, approves, and pastes
the token back. Split it cleanly by what's secret:

- **The authorize URL is not secret — so print it yourself.** Run `auth-url` (a tool call is fine;
  it reads no stdin and makes no network call) and put the link straight in chat for the user to
  click. Don't make the user run a command just to *see* the URL.

  ```
  node <skill-dir>/scripts/wpcom-images.mjs auth-url
  ```

- **The token IS secret — so the user pastes it locally, never in chat.** After they approve and
  land on `developer.wordpress.com/copy-oauth-token` (which shows the access token), have the
  **user** run `auth` themselves in the session terminal (the `! <command>` prefix runs it
  locally), so the pasted token never routes through the transcript:

  ```
  ! node <skill-dir>/scripts/wpcom-images.mjs auth
  ```

`auth` also reprints the authorize URL, then reads the pasted token from the user's own stdin,
validates it against `/me`, and stores it. **Never echo or ask for the token in chat.** After the
user reports success, re-run `status` to confirm (exit 0). Never auto-open a browser.

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
  `flat-design`, `3d-render`, `abstract`, `watercolor`. (There is no style parameter on the
  endpoint; the script folds it into the prompt as "…, <style> style".)
- **aspect** — `square` (1:1), `landscape` (16:9 — heroes, banners), `portrait` (9:16);
  the endpoint's ratio strings `1:1 | 2:3 | 3:2 | 3:4 | 4:3 | 9:16 | 16:9 | 21:9` also pass
  through. Unknown values fall back to 16:9.
- **Filenames**: lowercase `a-z`, `0-9`, hyphens, **`.png`** (the script requests PNG output —
  never name it `.jpg`), descriptive (`hero-bakery-counter.png`). To regenerate or change an
  existing image, write a new marker with a `-v2` (then `-v3`…) filename — existing real images
  are never overwritten.
- **Grid/row consistency**: images displayed together in a row or grid (cards, team
  members, gallery items) MUST share one aspect — never mix.

## Filling the slots: after the editor gate, before "done"

Both filling commands run once the theme passes both block gates (the markers don't affect
validity — they're just alt text):

```bash
# Plain placeholders (the "placeholders" choice): solid-color images, no auth, no network.
node <skill-dir>/scripts/wpcom-images.mjs placeholders --files <theme>/patterns/*.php <theme>/templates/*.html

# Real AI generation (the "yes" choice, or "generate them now" later): needs login.
node <skill-dir>/scripts/wpcom-images.mjs generate --files <theme>/patterns/*.php <theme>/templates/*.html
node <skill-dir>/scripts/wpcom-images.mjs generate --prompt "..." --aspect 16:9 --out hero.png   # ad-hoc single image
```

`placeholders` writes a solid-color PNG at each marker's aspect ratio and **keeps** the
`AI_IMAGE:` marker (no auth, no network, never overwrites a real image) — the layout renders now
and the slots stay fillable. `generate` later replaces those placeholders with real images.

The endpoint takes `{ prompt, aspect_ratio, output_format }` with headers
`Authorization: Bearer <token>` and `X-WPCOM-AI-Feature: ai-image-cli`, and returns
`{ data: [ { b64_json, revised_prompt } ] }` (`b64_json` is the base64 PNG). For each marker the
script generates the image (style folded into the prompt), writes `<theme>/assets/<name>.png`,
and rewrites the alt to the human description. It is **idempotent**: re-running skips finished
images and replaces only its own placeholders — safe to resume anytime. Expect ~10 s and 1–2 MB
per image; plan a batch ≤ ~10 images per page, mind the 200/month quota, and confirm
with the user before generating dozens. After a batch, verify the images actually render
(cookie-jar curl of the image URLs or a screenshot).

`generate --files` runs **in batches of 4 concurrent requests** (override with `--concurrency N`;
`N=1` restores one-at-a-time), so a full page finishes in roughly a quarter of the wall-clock
time. Markers pointing at the same target file generate once and share the result; per-image
failures still placeholder-and-continue independently, and a `401`/`429` stops launching
new batches (in-flight requests finish) — re-run to resume.

## Failure policy (the script enforces it — don't fight it)

- **Upstream generation failure** (the endpoint passes through the Gemini/proxy status, e.g. a
  5xx, or a 4xx from content moderation): the script writes a gray placeholder at the right
  aspect, keeps the marker, continues the batch, and lists failures at the end. For repeated
  failures on one image, rephrase that description; for failures on everything, tell the user the
  service looks down and that re-running the same command later resumes.
- **401 / "Authentication required"** = the token no longer works (revoked or expired). The
  script stops the batch and prints the re-auth command. Don't retry; relay the auth flow again.
  (Unfilled markers keep their placeholders, so the site still renders.)
- **429 (quota exceeded)** = the user hit the monthly limit (200 images/month). The script
  stops the batch and reports that it resets at the start of next month. Never poll-retry.
- A service outage must never block site creation: the site renders with placeholders, and
  work continues — image generation is an enhancement, not a dependency.

## Local state and the token

- `workdir/.playground/images.json` — the consent record (see above). Per-project, not secret.
- The WordPress.com token lives at `${XDG_CONFIG_HOME:-~/.config}/wp-agent-skill/wpcom-auth.json`
  (per-user, all projects share it; dir 700, file 600 — the script verifies on every read).
  **Never** copy it into the project tree, print it, or commit it. `status` reports who is
  logged in and whether they can currently generate.
- **Revocation** (user asks to disconnect, or a token may have leaked): WordPress.com tokens are
  revoked by the user from their account at **wordpress.com/me/security/connected-applications**
  (revoke the "WordPress Studio" connection, since the skill reuses Studio's OAuth client). Then
  delete the local token file. Every later API call 401s; `auth` re-creates from scratch.
