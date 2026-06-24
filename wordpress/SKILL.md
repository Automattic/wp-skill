---
name: wordpress
description: Create, edit, and test WordPress sites locally. Use for any WordPress work - creating or editing sites, block themes, templates, patterns, Gutenberg block markup, theme.json, wp-cli, WordPress Playground, or local WordPress development and testing.
---

# WordPress (local-first)

Build and edit WordPress sites locally on WordPress Playground: site lifecycle, block
themes and patterns, block-markup validation, design polish, and backup discipline.
Deploying to WordPress.com is **not yet supported** by this skill — stay local or point the
user to the WordPress.com UI.

Requirements: Node 18+ and a POSIX shell (macOS/Linux/WSL — native Windows is unsupported).
Script paths below are relative to this skill directory; resolve them to absolute paths.
Run `scripts/playground.sh` from the project directory (its state lives in `./workdir/.playground/`).

## Routing

| Task | Read |
|---|---|
| Run/create a local site, any server lifecycle or wp-cli need, Playground facts | `references/local-sites.md` |
| Write or edit ANY block markup (templates, parts, patterns, post content) | `references/block-markup.md` |
| Build a theme: structure, theme.json, fonts, patterns, navigation, query loops | `references/themes-and-patterns.md` |
| New site / redesign (browser design previews + selection); polish rendered output | `references/design.md` |
| User points at a reference website (inspiration, "build for", rebuild, "unlike X") | `references/inspiration.md` |
| Decide the site's page-frame shape + header behavior before building (site spec) | `references/site-spec.md` |
| Build the page-frame CSS for a non-default layoutMode (sidebar, landing, magazine, gallery) | `references/layout-modes.md` |
| Make a theme look designed, not generated: aesthetic direction + per-page composition | `references/aesthetics.md` |
| Add tasteful scroll motion to a built theme (reveal, hero-fade, sticky header) | `references/motion.md` |
| Images for a site: generate (AI via the user's WordPress.com login), add, or remove | `references/images-media.md` |
| Anything destructive on a site the user calls production | `references/backups-and-safety.md` |

## Non-negotiable rules

1. **Local WordPress = Playground via `scripts/playground.sh`** (verbs:
   `bootstrap | ensure | wp | front-page | status | stop`). Docker is banned. Never hand-roll a
   MySQL/PHP stack, never wp-now.
2. **Local sites you created are disposable; production is not.** Before any destructive
   write to a user-designated production site, create and verify a backup manifest
   (`references/backups-and-safety.md`). If the user says to skip it, refuse — creating one
   takes ~30 seconds. File copies count as writes.
3. **Block work isn't done until both gates pass.** After writing or editing any markup, FIRST
   auto-repair it — `fix-blocks.cjs` on the files (mechanical, no browser; fixes the recurring
   cover/border/order INVALID cases) — then `validate-blocks.cjs`, then `editor-gate.mjs` against
   the live site. Do not hand-fix block validity or open the editor to fix it; run the fixer.
   Invalid blocks render fine on the frontend and break only in the editor — screenshots can't
   catch them. (`references/block-markup.md`.)
4. **Never edit WordPress core.** `wp search-replace` always dry-runs first.
5. **Leave the server running when you hand work back — the user needs it live to test.**
   Do NOT run `playground.sh stop` just because development is "done"; stopping a site the
   user is about to try is a defect, not cleanup. Stop ONLY when the user asks, or when you
   must restart to change the mount set. Whenever you stop — and when you finish — give the
   user the one-line `playground.sh ensure …` command to bring the site back. (`stop` still
   asserts clean teardown and must print "stopped clean" on the occasions you do run it.)
6. **End every rendered change by printing a clickable link the user can test.** Print the
   live URL from the recorded port — `http://127.0.0.1:$(cat workdir/.playground/server.port)/` —
   deep-linked to the part you changed: a section anchor (`…/#<anchor>`), a specific page
   (`…/sample-page/`), or the editor (`…/wp-admin/`) for editor-only work. Default to the
   home page for general or site-wide changes. Always resolve the real running port; never
   hardcode or assume one.
7. **For new sites/redesigns, users choose from rendered HTML previews in a browser**
   (`references/design.md`) — never from text directions, terminal option lists, or ASCII
   mockups. The number of previews scales to the brief: an open brief or material redesign gets
   the 4-direction gallery; a tightly-specified brief gets a **single** first-fold preview built
   to that brief (still shown and approved in the browser — not silently skipped). Build what the
   user asked for; previews confirm the execution, they don't reopen a decision the brief already
   made.
8. **A new theme isn't built until the build sequence runs** (`references/design.md` §5):
   **scaffold** (`scripts/scaffold-theme.sh` — drops theme.json rigor, base CSS, motion runtime,
   content-loader) → site spec (`site-spec.md`) → recolor theme.json (`themes-and-patterns.md`) →
   page-frame CSS for the layoutMode (`layout-modes.md`) → page composition (`aesthetics.md`) →
   scroll-motion hooks (`motion.md`). Scaffold first so the rigor and motion can't be skipped; do
   not hand-write theme.json/style.css boilerplate or hand-roll page creation / front-page wiring
   (`content-loader.php` does it). A theme that renders pages but skips the site spec or ships zero
   motion is an incomplete build — these are the steps that separate a designed site from AI slop.
9. **Image handling needs an explicit choice — always ask, before design previews and any
   markup. Being logged in is not consent.** Check `workdir/.playground/images.json` first (a recorded
   answer is the only thing that skips the question), then follow `references/images-media.md`:
   present four options, **"generate real AI photos" always listed first**, then plain
   placeholders (solid-color images + `AI_IMAGE:` markers, no login needed), provide their own
   photos, or imageless. The answer also decides what the design previews contain. Fall back to
   placeholders whenever the user isn't logged in or doesn't want to generate; respect a recorded
   answer across sessions; and never let generation failures or the choice block site creation.
