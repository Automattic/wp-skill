# Local WordPress sites (Playground)

Local WordPress = **WordPress Playground**, driven through `scripts/playground.sh`. This is
the only sanctioned local server path:

- **Never Docker** (banned — too heavy and slow).
- **Never a hand-rolled MySQL/PHP stack** (`mysqld` + `wp server`, `php -S`, etc. — the URLs
  die with your session and daemons get orphaned).
- **Never wp-now** (second lifecycle, second port default, no unique capability).

One server tool, one lifecycle, four verbs. Run all commands from the **project directory**
(state lives in `./workdir/.playground/`); call the script by its absolute path under this skill's
`scripts/` directory.

## Project layout

```
<project>/
├── my-theme/            # the deliverable — authored here, mounted into Playground, git-trackable
├── (my-plugin/)         # a plugin deliverable, if you're building one — also at the root
└── workdir/             # agent scratch — persistent + browsable, but gitignored wholesale
    ├── .playground/     # Playground run-state: site-dir, mounts, server.{pid,pgid,port,log}, images.json
    ├── previews/        # design-preview gallery (see references/design.md)
    └── media/           # SOURCE/staging media (the user's own photos, raw fonts) before it's
        ├── images/      # copied/bundled into <theme>/assets/ — the theme never serves from here
        ├── videos/
        └── fonts/
```

Deliverables (theme, plugin) live at the **project root** so they're obvious and version-controllable;
everything the agent generates as working state goes under `workdir/`, which `bootstrap` marks
gitignored (`workdir/.gitignore` = `*`). Mount the theme from the root, e.g.
`./my-theme:/wordpress/wp-content/themes/my-theme`.

## The four verbs

| Verb | When to call it |
|---|---|
| `playground.sh bootstrap [dir]` | Once per project, before anything else. Creates a real Playground site and records its location in `workdir/.playground/site-dir`. Safe to re-run (no-ops if bootstrapped). |
| `playground.sh ensure [host:vfs ...]` | Whenever you need the server running. Convergent and safe to re-run blindly: reuses a healthy server, restarts if the mount set changed, starts fresh otherwise. Pass each directory the site must see (e.g. a theme you are writing) as `./my-theme:/wordpress/wp-content/themes/my-theme`. |
| `playground.sh wp -- <wp-cli args>` | Any wp-cli command. There is no local `wp` binary and no other working wp-cli path on Playground; this verb runs the pinned phar against the same site and the **same mount set** as the server. |
| `playground.sh stop` | Only when the user asks to shut down, or when you must restart to change mounts — **not** as a reflex when a build is "done" (the user needs the site live to test). Stops the server by process group and **asserts** nothing survives — treat a failed assertion as a real bug, not noise. |

Typical session:

```bash
playground.sh bootstrap
playground.sh ensure ./my-theme:/wordpress/wp-content/themes/my-theme
playground.sh wp -- theme activate my-theme
# ... work, verify ...
# Hand back LIVE: print the URL for the user to test, deep-linked to the change
# (substitute a real page path or section anchor — don't print the placeholder).
echo "Test it: http://127.0.0.1:$(cat workdir/.playground/server.port)/<path-or-#anchor>"
# Leave the server running. Only `playground.sh stop` when the user asks (it must
# print "stopped clean"); then give them the `ensure` line above to relaunch.
```

## Facts you must not violate

- **The local URL comes from `workdir/.playground/server.port`**:
  `http://127.0.0.1:$(cat workdir/.playground/server.port)`. **Never read `siteurl` from the
  Playground database** — it stores a junk ephemeral port. Ports are recorded, never fixed,
  never assumed; do not hardcode any port in commands or content.
- **Frontend checks need a cookie jar.** Playground answers a one-time 302 that sets a
  session cookie; cookie-less curl loops on 302→/ forever. Canonical form (also printed by
  `ensure`):
  ```bash
  curl -sL -c workdir/.playground/cookies -b workdir/.playground/cookies "http://127.0.0.1:$(cat workdir/.playground/server.port)/"
  ```
  Browsers and Playwright handle the cookie automatically; only raw curl needs the jar.
- **`wp db export` silently no-ops on Playground** (exit 0, no file — SQLite has no
  mysqldump). A local DB backup is a copy of
  `$(cat workdir/.playground/site-dir)/wp-content/database/.ht.sqlite`. Real `wp db export` exists
  only on real hosts.
- **Mount what you edit.** Files in your project are invisible to the site unless their
  directory is passed to `ensure`. List every mount on each `ensure` call; `wp` replays them
  automatically. Don't pass mounts to `ensure` once and assume a later, different `ensure`
  keeps them — the recorded set is whatever the last call specified.
- The Playground blueprint `wp-cli` step swallows stdout (exit 0, no output). Use the `wp`
  verb instead.

## Requirements and per-agent facts

- Node 18+ and a POSIX shell. `setsid` is required (Linux/WSL have it; macOS:
  `brew install util-linux`).
- **Codex**: run with `--sandbox danger-full-access`. The default workspace-write sandbox
  blocks the npm registry, so even cached `npx` fails at bootstrap.
- **Gemini CLI (headless)**: needs `GEMINI_CLI_TRUST_WORKSPACE=true` plus `--yolo`
  (untrusted folders refuse to run).

## Playground vs production (be honest about these)

Playground runs WordPress on PHP-WASM with an SQLite database. Differences that matter:
no real MySQL (some plugins' direct-SQL assumptions break), no background cron daemon
(cron fires on requests), no outbound mail, a reduced PHP extension set, and slower
execution than a real host. Heavy plugin stacks (e.g. WooCommerce) may hit these limits —
when something fails locally, consider whether it is a Playground limitation before
debugging the site, and say so to the user instead of thrashing.
