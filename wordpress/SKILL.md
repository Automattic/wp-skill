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
Run `scripts/playground.sh` from the project directory (its state lives in `./.playground/`).

## Routing

| Task | Read |
|---|---|
| Run/create a local site, any server lifecycle or wp-cli need, Playground facts | `references/local-sites.md` |
| Write or edit ANY block markup (templates, parts, patterns, post content) | `references/block-markup.md` |
| Build a theme: structure, theme.json, fonts, patterns, navigation, query loops | `references/themes-and-patterns.md` |
| New site / redesign (browser design previews + selection); polish rendered output | `references/design.md` |
| Images for a site: generate (AI via the user's Telex login), add, or remove | `references/images-media.md` |
| Anything destructive on a site the user calls production | `references/backups-and-safety.md` |

## Non-negotiable rules

1. **Local WordPress = Playground via `scripts/playground.sh`** (verbs:
   `bootstrap | ensure | wp | stop`). Docker is banned. Never hand-roll a MySQL/PHP stack,
   never wp-now.
2. **Local sites you created are disposable; production is not.** Before any destructive
   write to a user-designated production site, create and verify a backup manifest
   (`references/backups-and-safety.md`). If the user says to skip it, refuse — creating one
   takes ~30 seconds. File copies count as writes.
3. **Block work isn't done until both gates pass:** `validate-blocks.cjs` on the files,
   `editor-gate.mjs` against the live site. Invalid blocks render fine on the frontend and
   break only in the editor — screenshots can't catch them.
4. **Never edit WordPress core.** `wp search-replace` always dry-runs first.
5. **Leave the server running when you hand work back — the user needs it live to test.**
   Do NOT run `playground.sh stop` just because development is "done"; stopping a site the
   user is about to try is a defect, not cleanup. Stop ONLY when the user asks, or when you
   must restart to change the mount set. Whenever you stop — and when you finish — give the
   user the one-line `playground.sh ensure …` command to bring the site back. (`stop` still
   asserts clean teardown and must print "stopped clean" on the occasions you do run it.)
6. **End every rendered change by printing a clickable link the user can test.** Print the
   live URL from the recorded port — `http://127.0.0.1:$(cat .playground/server.port)/` —
   deep-linked to the part you changed: a section anchor (`…/#<anchor>`), a specific page
   (`…/sample-page/`), or the editor (`…/wp-admin/`) for editor-only work. Default to the
   home page for general or site-wide changes. Always resolve the real running port; never
   hardcode or assume one.
7. **For new sites/redesigns, users choose from rendered HTML previews in a browser**
   (`references/design.md`) — never from text directions, terminal option lists, or ASCII
   mockups.
8. **Image generation needs the user's consent before any markup is written.** Check
   `.playground/images.json` first and follow `references/images-media.md`: ask once —
   naming the local token and the browser login — respect a recorded "no" across sessions
   with a deliberately imageless design, and never let generation failures or a decline
   block site creation.
