# Handoff: implement image generation via Telex (skill side)

You are adding image generation to the existing `wordpress/` skill. Users with the skill
installed get real AI-generated images for their sites, authenticated as themselves via a
one-time Telex login (which is WordPress.com auth). The skill ships **no model API key**; a
Telex endpoint brokers to the WPCOM AI proxy with Telex's server-side credential.

The design phase is complete; this document is the contract. Where it conflicts with your
instincts, this document wins. The rationale for every rule is in
`exploration2/PLAN.md` § "Image generation via Telex" — read that section fully before
writing anything.

## Status of the world (verified 2026-06-12)

- **The server endpoint EXISTS.** Telex branch `feat/studio-images-endpoint` (commit
  `c2258e8d`) ships `POST /api/v1/images/generate`
  (`server/src/Controllers/Api/V1/ImageController.php`). It is deploying to staging:
  **`https://ai-w0.a8c.com/`**. WordPress Studio is its first consumer; this skill is the
  second — target the contract **as-is**, never propose a different one here.
- **The auth flow EXISTS.** Telex ships an RFC 8628 device authorization flow, in production
  use (`server/src/Controllers/DeviceAuthController.php`, SPA page
  `client/src/routes/device.tsx`, existing consumer
  `telex-plugin/assets/js/device-flow.js`). `BearerAuthMiddleware` accepts device-flow JWTs
  on all `/api/v1/*` routes. **Do not invent any auth mechanism.**
- The `wordpress/` skill exists (local-first scope, see `exploration2/HANDOFF.md` — completed).
  Its "no image-generation policy" rule is superseded by this handoff.

## Read first (in this order)

1. `exploration2/PLAN.md` § "Image generation via Telex" — the design: endpoint contract,
   consent & login UX, local state, spikes, gates. Also re-read the content filter and the
   "Four mandatory exceptions" scripts rule.
2. Telex source (read, never port wholesale): on branch `feat/studio-images-endpoint`,
   `server/src/Controllers/Api/V1/ImageController.php` (the contract);
   on trunk, `server/src/Controllers/DeviceAuthController.php` and
   `telex-plugin/assets/js/device-flow.js` (reference implementations for your auth client),
   `server/src/Middleware/BearerAuthMiddleware.php` (how tokens are validated),
   `agent/config/skills/generating-images/SKILL.md` (the placeholder contract to adapt).
3. `wordpress/SKILL.md` and `wordpress/references/` — match their voice and density; the
   content filter applies ("would a strong agent get this wrong without being told?").

## Deliverables

1. `wordpress/scripts/telex-images.mjs` — node 18+, **zero dependencies** (built-in `fetch`).
2. `wordpress/references/images-media.md` — gated on the spikes below passing.
3. `wordpress/SKILL.md` — one routing-table row + one safety-rule bullet (consent rule below).
4. `README.md` — update the skill summary and layout tree (it currently says local-first only).

## Order of work — spikes gate everything

Run these against staging **before** writing images-media.md. Record results in
`exploration2/spike-notes.md` (same pre-registered style as the rest of that file).

1. **Staging contract test** (`https://ai-w0.a8c.com/`): the device-flow endpoints
   (`POST /auth/device/code|token|authorize`) and the `/device` page answer on that host
   (first check — `auth` is impossible against staging otherwise); a device-flow JWT is
   accepted by `POST /api/v1/images/generate`; each of the five `aspect` values returns an
   image with the right dimensions; 400 on empty prompt; a moderation-bait prompt returns 502
   (confirms the script's error copy). If the deploy isn't live yet, wait or flag — do not
   stub.
2. **Headless device-flow pass**: `auth` → user authorizes in browser → token stored (assert:
   file at the XDG path, mode 600 inside a 700 dir, nothing token-shaped under the project
   tree, token absent from stdout/stderr) → authed call succeeds → revoke in Telex → next
   call 401s → re-auth works.
3. **Asset-reference model decision**: block templates (`.html`) cannot run PHP, and we have
   no Telex-style `theme:./assets/` rewrite step. Default hypothesis: image content lives in
   **PHP patterns** referencing `assets/` via `get_theme_file_uri()`. Alternative:
   `playground.sh wp media import` + absolute URLs (couples markup to the local URL; drags
   search-replace into deploys). Build a minimal theme both ways on a Playground site, pass
   the editor gate, pick, record the decision + evidence in spike-notes.md. images-media.md
   is not written until this is decided.

## The endpoint contract (verbatim — from the controller source)

- `POST {base}/api/v1/images/generate`, `Authorization: Bearer <telex-jwt>`.
- Request: `{"prompt": "<text>", "aspect"?: "1:1"|"4:3"|"3:4"|"9:16"|"16:9"}`; aspect
  defaults to `16:9`, unknown values silently fall back to `16:9`. **No `style` param** —
  fold the placeholder's style term into the prompt text.
- Response: `{"b64_json": "<base64 png>", "mime_type": "image/png"}` — **PNG**.
- Errors: 401 (middleware — token invalid/revoked), 400 (missing/empty prompt), 502 (any
  generation failure, moderation included, generic message). No 429 today (quota deferred by
  stakeholder decision); handle 429 anyway as forward-compat.
- Known endpoint gaps (attribution header, prompt cap, 422 split, jpg option) are the
  endpoint owner's follow-ups — **flag, never work around in ways that change the contract**.

## `telex-images.mjs` spec

Subcommands:

- `auth` — device flow: `POST /auth/device/code`, print `verification_uri_complete` for the
  user (the agent relays it in chat; never auto-open a browser), poll
  `POST /auth/device/token` at the server-specified `interval` honoring `slow_down`, store
  the token. Device code expires → offer one retry; second lapse = decline.
- `status` — cheap authed call; reports who is logged in (from stored `username`) and warns
  near `expires_at`. Tolerates quota fields (`limit/used/remaining/resets_at`) being absent;
  surfaces them if the server ever adds them.
- `generate --files <theme files…>` — scan for `AI_IMAGE: <description> | <style> | <aspect>`
  alt markers; for each: build prompt (description + style term), map aspect words
  `square→1:1`, `landscape→16:9`, `portrait→9:16` (pass ratio strings through for ad-hoc
  use), call the endpoint, write `assets/<name>.png`, rewrite the alt to human text (marker
  removed). **Idempotent**: skip markers whose target file exists; regeneration = `-v2`
  filename. Also `generate --prompt … --aspect … --out …` for single images.
- Error routing: 401 → print the exact re-auth command and stop (no retry loops). 502 →
  report plainly (could be moderation or outage — the endpoint doesn't distinguish), skip
  that image, continue the batch, list failures at the end. 429 (forward-compat) → stop the
  batch, report unfilled placeholders, print `Retry-After`/`resets_at` if present, never
  poll-retry.
- The client **never enforces quota** — display only.

### Local state (binding)

- **Token**: `${XDG_CONFIG_HOME:-~/.config}/wp-agent-skill/telex-auth.json` — resolve via
  `process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')` (no shell `~`). Dir
  `700`, file `600`, atomic write (temp + rename), perms **verified** on every read (WSL
  DrvFs ignores chmod — warn loudly if 600 doesn't stick). Contents:
  `{access_token, token_type, expires_at, telex_base_url, username}`. `telex_base_url` starts
  as `https://ai-w0.a8c.com/` (staging); production later is a config swap. **Never inside
  the project tree. Never printed; redact from all error output.**
- **Image decision**: `.playground/images.json` →
  `{"images": "yes"|"no", "decided_at": "<ISO>"}`. Written when the user answers the consent
  ask; read at session start; absence = never asked. "Add/remove images" overwrites it.
- **Nothing else.** Which images exist lives in the markup (markers) and `assets/` (files).

## Consent & login UX (binding — goes in images-media.md + one SKILL.md bullet)

1. The ask happens **before any theme markup is written** — the answer decides whether
   markers exist at all.
2. Already authed (`status` passes): no ceremony; mention images will be generated via the
   user's Telex login (usage never silent).
3. Not authed: ask once, naming what is stored (a local token) and where login happens (their
   browser, Telex/WordPress.com). Informed consent, not a toll gate.
4. Yes → `auth`, relay URL, then build with markers and generate after the editor gate.
5. **No → deliberately imageless design**: typography/color/pattern-driven; zero placeholder
   files, zero `AI_IMAGE:` markers, zero empty/broken `<img>`. Record in
   `.playground/images.json`; no re-asking across sessions; say once that "add images"
   re-opens the ask.
6. **Decline ≠ failure**: consented-then-failed generation keeps markers, backed by
   deterministic local placeholder images at the right aspect ratio; `generate` resumes
   idempotently. The no-placeholder rule applies only to declining.
7. Adding images to an imageless site = same ask, then a real design edit of the affected
   sections, not find-and-replace.

## Verification before you call it done (run, don't assume)

Against staging, on a real Playground site, using only commands your reference documents:

1. Happy path: theme with markers → `generate --files` → every marker replaced by a real
   `.png` at the requested aspect (inspect the files), alts human, images render on the local
   site (cookie-jar curl or screenshot), re-run is a no-op, token never appears in any output.
2. Decline path: consent ask precedes markup; "no" yields zero markers/placeholders/broken
   `<img>` (grep + frontend check); `.playground/images.json` records it; a **fresh session**
   does not re-ask.
3. Failure-after-consent: simulate endpoint down (bogus `telex_base_url`) → markers stay,
   placeholder images render, resume instructions printed.
4. Auth lifecycle: revoke the token in Telex → next call 401s → printed re-auth command works.
5. `wordpress/SKILL.md` still under its size budget; new reference one-line-routable.

## What you must NOT do

- No new auth flow, no OAuth client registration, no raw WP.com tokens — device flow only.
- No npm dependencies in `telex-images.mjs`; no image conversion (PNG stays PNG — never write
  PNG bytes under a `.jpg` name).
- No client-side quota enforcement; no retry loops against 401/429/502.
- No quota/attribution/422 fixes on the Telex side from here — flag to the endpoint owner.
- No edits to `playground.sh` / `wpcom-backup.sh` / `checker/` (flag issues instead).
- No `theme:./assets/` prefixes (Telex build-time rewrite — we have none). `AI_IMAGE:` markers
  ARE sanctioned now (our own contract, consumed by our own script) — the old leakage rule is
  amended exactly that far, nothing further.
- No hardcoded production URL; the base URL lives in the token file.
- Don't write wordpress-com.md / deploy.md — still out of scope.

Commit in small pieces (spike notes, then the script, then the reference, then SKILL.md +
README), with spike/verification transcript summaries in the commit messages.
