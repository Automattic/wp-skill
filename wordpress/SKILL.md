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
5. **Always stop servers you started** — `playground.sh stop` asserts cleanup; it must
   print "stopped clean".
6. **For new sites/redesigns, users choose from rendered HTML previews in a browser**
   (`references/design.md`) — never from text directions, terminal option lists, or ASCII
   mockups.
