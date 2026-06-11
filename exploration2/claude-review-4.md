# Adversarial review 4 — playground.sh under attack, the cross-agent matrix, and Phase 1 core

*2026-06-11, round 4. Stance: executor, not commenter. Every fix below is applied in this
session's artifacts (`playground.sh`, `wpcom-backup.sh`, `editor-gate.mjs`, PLAN.md edits,
spike-notes.md), not requested. Everything labeled verified is my own run today on this Linux
machine; "unverified" means I could not run it. Per ground rules, settled findings from
reviews 1–3 are not re-raised.*

Mid-session stakeholder decision (recorded): **Docker is banned** — too heavy and slow; local
WordPress is Playground, as in Studio. Eval prompts and PLAN.md now carry it.

---

## CRITICAL findings (all reproduced, all fixed in `playground.sh`, full chain re-run after)

### C1. `ensure` with changed mounts recorded the new mounts and reused the old server — the exact mount divergence the script's header claims "cannot happen through these verbs". Reproduced as a live HTTP 500.

Repro (old script): `ensure ./my-theme:...` → server live; `ensure ./theme-two:...` →
"reusing server on port 9400"; `.playground/mounts` now says theme-two, live server's cmdline
says my-theme; `wp -- theme activate theme-two` (wp replays the NEW mounts) → "Success." →
frontend: **HTTP 500**, `search_theme_directories(): /wordpress/.../attack-theme is not
readable`. The script's by-construction guarantee was false — state diverged from reality
through the verbs themselves.
**Fix applied:** `ensure` compares requested mounts to recorded; if they differ and a server is
alive, it restarts the server with the new set ("mounts changed — restarting"). Re-verified:
theme-two activate + frontend marker served after the restart.

### C2. `server_alive` was just a curl — a foreign process answering on the recorded port was "reused" as the WordPress site.

Repro: kill the server, leave state files (crashed session), `python3 -m http.server <port>` →
`ensure` → "reusing server on port 9400", exit 0. Every subsequent wp/curl step then fails
against a Python directory listing.
**Fix applied:** alive = recorded pid alive AND recorded pgid still contains a playground
process AND port answers. Re-verified: with the squatter on the stale port, `ensure` cleans
state and starts fresh on the next free port.

### C3. The script floated on `@latest` and downloaded an unpinned wp-cli phar from a moving gh-pages branch — the plan mandates pinning and both prior regressions (empty-dir bootstrap, start/server drift) entered through unpinned latest.

The script's own TODO admitted it. **Fix applied:** pinned `@wp-playground/cli@3.1.38`
(`PLAYGROUND_VERSION` env-overridable) and wp-cli phar `v2.12.0` from the GitHub release URL
(both verified today). Cold-npx-cache data point for the readiness budget: first run of the
pinned version added ~10s to bootstrap (19.1s cold vs 9.1s warm) — well inside the 120s loop.

## MAJOR findings (all reproduced, all fixed)

### M1. Mounts with spaces in the host path word-split into two arguments — `ensure`/`wp` are unusable in any project under a spaced path.

Repro: `ensure "./my theme:/wordpress/wp-content/themes/space-theme"` → Playground error
("If your path contains a colon…") — `$(mount_args)` is an unquoted command substitution.
**Fix applied:** mounts are built in a bash array and expanded quoted
(`${MOUNTS[@]+"${MOUNTS[@]}"}`). Re-verified: spaced mount → activate → frontend marker served.

### M2. Every startup failure burned the full 120s readiness budget and left stale state (and possibly a live half-started group) behind.

Repro: deleted site dir or bad mount → server process dies in ~2s; old loop slept the full 60
iterations, then `die` without killing or cleaning — the next `ensure`/`stop` inherited lies.
**Fix applied:** the readiness loop checks `kill -0 $pid` each iteration; on death it kills the
recorded group, removes state, prints the log tail, and dies (now fails in 2.1s, measured); on
timeout it also kills and cleans. Bootstrap loop got the same pid check.

### M3. `stop` assertions misfired across projects and on slow shutdowns: with a missing port file, `pgrep -f "wp-playgroun[d].*"` matched ANOTHER project's server (false "ASSERT FAILED"); the flat 2s sleep raced TERM; a recycled pgid could be group-killed blind.

Repro: two projects live; delete project A's `server.port` (crashed session); `stop` in A →
"ASSERT FAILED: playground process still owns port " — the empty-port pattern matched project
B's healthy server.
**Fix applied:** the pgrep assertion is scoped to `--port=<recorded port>` and skipped when no
port is recorded; a new pgid-scoped assertion covers the no-port case; stop polls up to 10s for
group exit; all group-kills go through `pgid_is_ours` (the group must still contain a
playground process — pgid recycling can never kill an innocent group). Re-verified: A stops
clean, B keeps serving.

### M4. Recorded-but-deleted site dir produced a 120s hang ending in a yargs stack trace.

**Fix applied:** `site_dir()` guard in `ensure` and `wp`: instant, named error ("recorded site
dir is gone (<path>) — delete .playground/site-dir and re-run bootstrap"). Verified both verbs.

### M5 (plan + protocol). "curl the frontend" as written in the plan's matrix protocol cannot work: Playground answers a one-time 302 that sets a session cookie; cookie-less curl loops 302→/ forever.

Found because the round-3-verified chain's "frontend serves the theme" check failed on a plain
curl. Not a server bug — with a cookie jar the theme serves.
**Fix applied:** `ensure` prints the correct form
(`curl -sL -c .playground/cookies -b .playground/cookies <url>`); PLAN.md's matrix step and
mount-model facts updated. Any future "site renders X" assertion that omits the jar is wrong.

### M6 (platform fact). `wp db export` on a Playground site silently no-ops: exit 0, no output, no file. The plan's task-6-local backup recipe and backups-and-safety.md were specified on top of a command that does nothing locally.

Verified today (`wp db tables` works; `db export` produces nothing — SQLite drop-in has no
mysqldump). **Fix applied:** PLAN.md re-scoped (local db artifact = copy of
`<site-dir>/wp-content/database/.ht.sqlite`; `wp db export` only over SSH against real hosts);
spike-notes T6 rubric carries a dated amendment (made before any T6 run).

## MINOR (fixed or labeled)

- `grep -oP` (GNU-only) in bootstrap → `sed -n 's/.*Site files stored at: //p'`. `setsid`
  absent on stock macOS → explicit early `die` with the brew hint; macOS remains **unverified**.
- Codex's default sandbox cannot even resolve npm packages (`EAI_AGAIN registry.npmjs.org`);
  the chain needs `--sandbox danger-full-access`. Recorded as a per-agent runbook fact (the
  fixed script failed fast with the log tail — M2's fix working as designed).
- First version of my own editor gate parsed raw pattern PHP and false-failed both themes
  (patterns legitimately contain `<?php esc_url(...)`); the committed `editor-gate.mjs` parses
  templates/parts from files and patterns **server-rendered** from the editor's registry.
  Grader bugs get logged like script bugs.

---

## Cross-agent lifecycle matrix (full protocol: ensure → survives session exit → blind ensure reuses → wp → stop, both stop assertions checked from OUTSIDE the agent)

| Cell | Status | Evidence |
|---|---|---|
| pi | **VERIFIED** | this session: every verb in separate tool invocations; stop asserted externally |
| Claude Code 2.1.170 (headless `-p`) | **VERIFIED** | server answered 302 from my shell after the agent process exited; second session: "reusing server on port 9400", activate, stop; external check: curl 000 + zero playground processes |
| Codex 0.139.0 | **VERIFIED with caveat** | identical protocol passes under `--sandbox danger-full-access`; default workspace-write sandbox fails at npx (network) — that configuration cannot run the chain at all |
| Gemini CLI 0.46.0 (headless `-p --yolo`) | **VERIFIED** (post-review addendum, same day) | runbook executed: survived session exit (302 from outside), blind ensure "reusing server on port 9400" in a separate session, stop asserted externally (000 + zero processes); caveat: headless requires `GEMINI_CLI_TRUST_WORKSPACE=true` + `--yolo` |

All four cells verified. No sandbox killed the detached server → the tmux branch stays
unimplemented and the fallback ladder is retired to a one-line note, per the plan's own
descend-only-on-evidence rule.

## Phase 1 core executed this session (details + tables in spike-notes.md)

- Rubrics for tasks 1, 2, 6-local pre-registered before any run.
- **Task 1 (bare, no-Docker prompt, 2×claude + 2×codex): 0/4 pass.** Nobody found Playground;
  both agents hand-rolled mysqld+`wp server`; every "it's running at <URL>" was false the
  moment the session ended (or a mysqld was orphaned). Two systematic failures
  (toolchain discovery, lifecycle hygiene) — both earn skill content under the plan's own rule.
- **Task 2 (bare, 2×2): 3/4 pass.** Both agents produce genuinely good block themes (custom
  fonts/palettes, real full-width heroes — screenshots retained). Bare-agent success recorded
  with equal rigor: **anti-slop design content gets cut** for these agents. The one failure —
  codex r1's invalid `core/cover` in its hero pattern — was invisible on the frontend and
  caught only by the editor gate; at 1/4 it is below the ≥2-runs bar, so block-markup.md's
  validity content is not yet fully earned.
- Task 6-local: NOT run (rubric registered; `wp db export` amendment dated before any run).
- No reference file written (per instruction).

## Round-3 fix-layer audit

- **Plan-vs-script contradictions found and edited out:** the plan still carried a prose copy
  of the lifecycle snippet that had already drifted from the script (no mount-restart, no
  identity check) — replaced with design facts + a pointer to the script, because prose copies
  of shipped scripts are where rounds 1–3's criticals came from. The parity map's "pin version
  + 4-agent re-run in Phase 1" row and the "enforced by construction" claim (false until C1's
  fix) were updated.
- **Backup-manifest channel split is runnable:** minimal `wpcom-backup.sh` written
  (ssh | rest | verify). Local half dry-run against a live Playground site: REST export of
  posts+pages works (cookie auth gets 401 on `context=edit` — loud fallback to rendered
  content; an application password is required for raw exports on WP.com), manifest written,
  and `verify` **fails after the artifact is truncated** — the `touch` bypass is structurally
  closed. `ssh` mode is UNVERIFIED until a Business-plan site exists.
- **Design-previews falsifier:** runnable, contrary to the worry — Claude Code has native
  subagents (ideal arm) and the sequential-pass variant runs on codex/pi as tested here. It
  remains correctly gated on Phase 1.5; nothing was written. One new input for it: codex
  generated a photorealistic hero image with its **built-in image tool** unprompted — the
  image-policy gap (review-3 m2) now has live evidence on one agent.

## Ledger — what the artifact loop fixed vs what prose still hides

**Fixed because it was runnable:** mount-divergence-by-verbs (C1), identity-less reuse (C2),
floating versions (C3), spaces (M1), slow-failure stale state (M2), cross-project stop
assertions (M3), deleted site-dir (M4), the cookie-302 frontend fact (M5), the `wp db export`
no-op (M6), the touch-able backup gate (verify), and the matrix itself (3 of 4 cells executed,
codex's sandbox constraint discovered only by running it).

**Still prose, still hiding:** `ssh` mode of
wpcom-backup.sh and every WP.com platform fact (no test site yet); task 6-local and the
manifest-bypass pressure transcript (rubrics exist, zero runs); the pinned node
validator's tested set (policy written, set still not committed as a lockfile); macOS;
the editor gate existed only as plan prose until this session — it is now
`exploration2/editor-gate.mjs`, but its Playwright/package pins are this session's, not a
maintained lockfile; the design-previews A/B; multisite/non-English (owned deferrals).

## Single highest-leverage next step

Provision the WP.com Business + Personal test sites **today**. It is the only remaining item
that is wall-clock-blocked rather than effort-blocked, and it gates everything still hiding in
prose: `wpcom-backup.sh ssh`, every platform fact in wordpress-com.md/deploy.md, tasks 4–8, and
the real task 6. (The gemini matrix cell was the runner-up; it was closed the same day — see
the matrix above.)

## Verdict: proceed — finish the two unrun Phase 1 core items, then Phase 1.5

For a non-participant: the local foundation is no longer the risk. `playground.sh` survived a
deliberate attack round (eight scenario classes, six fixed bug clusters, full chain re-verified
after each fix) and the lifecycle matrix passes on the three agents this machine can drive,
including survival across agent-session exit — the property everything else rests on. Phase 1
core's eval half ran: task 1 justifies local-sites.md empirically (0/4), task 2 cuts more
content than it adds (3/4). Do not "fix the script first" — that work is done and inherited
here. Do not re-scope — the plan's own gates were applied and held. What remains before Phase
1.5 is honest and small: task 6-local + the manifest pressure transcript (rubrics already
registered; the gemini cell is now closed). The hard untested surface is
now entirely on the WP.com side, which is exactly where the highest-leverage step points.

## One thing that must survive this round

The editor gate, again — this round it caught the only real block-validity defect in four
bare themes, a defect the frontend rendered without complaint. It is now a committed artifact
(`editor-gate.mjs`), not a recipe.

---

## Summary — one line per issue

- **C1** — `ensure` with changed mounts reused the stale server (live HTTP 500); now restarts on mount change.
- **C2** — `server_alive` was curl-only and "reused" a python http.server; now pid + pgid-identity + curl.
- **C3** — script floated `@latest` + unpinned phar against the plan's own mandate; now pinned 3.1.38 / wp-cli 2.12.0.
- **M1** — spaced mount paths word-split; mounts are now array-expanded.
- **M2** — startup failures burned 120s and left stale state; loop now pid-checks, cleans, fails in ~2s with the log tail.
- **M3** — `stop` pgrep matched other projects when the port file was missing and could group-kill recycled pgids; assertions now port/pgid-scoped with a 10s poll.
- **M4** — deleted site-dir gave a 120s hang + stack trace; now an instant named error in `ensure` and `wp`.
- **M5** — the plan's "curl the frontend" protocol can't work without a cookie jar (302 session cookie); `ensure` prints the correct form, plan updated.
- **M6** — `wp db export` silently no-ops on Playground; local backup re-scoped to copying `.ht.sqlite`, plan + T6 rubric amended.
- Matrix: all four agents verified (codex only under `danger-full-access`; gemini headless needs `GEMINI_CLI_TRUST_WORKSPACE=true` + `--yolo`); no sandbox killed the detached server, tmux branch correctly unimplemented.
- Phase 1 core: task 1 bare 0/4 (Playground never discovered; "running" URLs die with the session); task 2 bare 3/4 (design content gets cut; one editor-gate-only cover-block failure); task 6-local rubric registered, unrun.
- Backup gate: `wpcom-backup.sh` rest+verify dry-run green incl. the truncate-bypass test; ssh mode unverified pending a Business site.
