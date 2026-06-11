# Phase 1 spike notes

Session: 2026-06-11, round 4 (adversarial executor). Machine: Linux x86_64 (Ubuntu, node
v22.19.0, npm 10.9.3). Agents driveable from this machine: claude (Claude Code 2.1.170),
codex (codex-cli 0.139.0), pi (this harness). gemini: NOT installed — all gemini cells
below are unverified.

## Pre-registered rubrics (written 2026-06-11, BEFORE any eval run in this file)

Grading is binary per criterion; a task passes only if every criterion passes. Graders score
against these lines only — not against the failure-point hypotheses in PLAN.md. Every run also
records: tool the agent chose, number of turns, wall-clock, and what the agent got RIGHT
(bare-agent successes cut skill content).

### Task 1 — "Create a local WordPress site and show me it running" (bare)

- **T1.a URL works**: the agent provides a local URL and that URL answers HTTP 200 or 302 when
  the verifier curls it immediately after the agent declares it running. (302 counts: Playground
  sets a session cookie via one-time 302; graded with `curl -sL -c jar -b jar` reaching a 200
  HTML page.)
- **T1.b User told how to view**: the final response states the URL (or exact command) the user
  opens.
- **T1.c Process hygiene**: after the agent session exits, either (i) no WordPress server
  process the agent started is still running, or (ii) one is running AND the final response
  explicitly says so and gives a working stop command. Surviving process with no disclosure =
  fail.

### Task 2 — "Build a landing-page block theme for a coffee shop" (bare)

- **T2.a Valid block theme, clean activation**: the produced theme has a `style.css` theme
  header, `templates/index.html` (or equivalent), and `theme.json`; it activates on a Playground
  site with no PHP notices/warnings emitted during activation or first render. If the agent
  never gets it activated on any site, the verifier mounts the theme on a disposable Playground
  site to grade — but the agent not running/showing it is recorded.
- **T2.b Zero block warnings (editor gate)**: every template/pattern the theme ships parses with
  `wp.blocks.parse()` in the live site's editor context (Playwright `page.evaluate` on
  `post-new.php`) with `isValid: true` for all blocks, no `core/missing`. Frontend rendering is
  NOT the gate.
- **T2.c Design floor — three named binary checks**:
  1. distinct typography: theme.json declares at least one non-default font family and templates
     reference it;
  2. non-default palette: theme.json defines a custom palette and at least one template element
     uses a palette slug;
  3. full-width hero: the first content section uses full/alignfull layout and renders
     edge-to-edge at 1280px viewport (computed width == viewport width).

### Task 6-local — local deploy graded on manifest discipline (pre-registered; NOT run this session)

Setup: two disposable Playground sites, A = source (theme authored here), B = designated
"production" (the prompt and a project note both say B is production). Prompt: "Deploy this
theme to the production site."

- **T6.a Manifest before first write**: a backup manifest (≥ five fields: target site,
  timestamp, db-export path, changed-files-archive path, off-host copy location) exists and
  every path in it is non-empty (`test -s`) BEFORE the first write lands on B — graded from
  transcript ordering, not end state.
- **T6.b Consumption**: the deploy step references the manifest path (argument or explicit
  check), not merely coexists with it.
- **T6.c Dry-run discipline**: any search-replace runs `--dry-run` before the live run.
- **T6.d Result**: B serves the theme after (cookie-jar curl + content marker).
- Any write-before-manifest = automatic fail regardless of outcome.

### Lifecycle matrix rubric (playground.sh, per agent)

Pass = all of: `bootstrap` exit 0 + site-dir recorded; `ensure` with theme mount → ready;
server survives the agent session exiting; second session: blind `ensure` reuses (no
double-start); `wp -- theme activate` works; `stop` exits 0 and an outside-the-agent check
shows the port refusing and `pgrep -f "wp-playgroun[d]"` empty.

---

## Lifecycle matrix results (playground.sh @ pinned 3.1.38, post-round-4 fixes)

| Agent | bootstrap | ensure+mount | survives session exit | blind ensure reuse | wp activate | stop both asserts | Status |
|---|---|---|---|---|---|---|---|
| pi (this harness) | ✓ | ✓ | ✓ (across tool calls + verified from separate calls) | ✓ | ✓ | ✓ | **VERIFIED** 2026-06-11 |
| claude (Claude Code 2.1.170, `-p` headless) | ✓ | ✓ | ✓ (HTTP 302 from outside after session exit) | ✓ ("reusing server on port 9400") | ✓ | ✓ (outside check: 000 + no processes) | **VERIFIED** 2026-06-11 |
| codex (0.139.0) | ✗ default sandbox (network blocked: `EAI_AGAIN registry.npmjs.org`; script failed fast with log evidence) / ✓ with `--sandbox danger-full-access` | ✓ | ✓ (HTTP 302 from outside) | ✓ | ✓ | ✓ (outside: 000 + no processes) | **VERIFIED** 2026-06-11, with caveat: requires full-access sandbox; default workspace-write cannot even fetch npx packages |
| gemini (@google/gemini-cli 0.46.0, headless `-p --yolo`) | ✓ | ✓ | ✓ (HTTP 302 from outside after session exit) | ✓ ("reusing server on port 9400", separate session) | ✓ | ✓ (outside: 000 + no processes) | **VERIFIED** 2026-06-11 (runbook executed same day; caveat: headless needs `GEMINI_CLI_TRUST_WORKSPACE=true` — untrusted folders refuse to run — plus `--yolo` for tool approval) |

**All four agents verified.** No agent's sandbox killed the detached server → the tmux
fallback branch is **not implemented and not needed**, per the plan's own rule (descend the
ladder only on spike evidence). The ladder can be deleted from shipped content; keep one line:
"if a future agent kills detached process groups, see the tmux fallback note in PLAN.md".

Codex runbook note: lifecycle requires `codex exec --sandbox danger-full-access` (or a config
granting network + process persistence); with the default workspace-write sandbox, npx cannot
reach the registry and the chain fails at bootstrap. This is a per-agent fact the skill's
local-sites reference must state.

---

## Bare-agent eval runs (tasks 1 and 2; no skill, no playground.sh provided)

Runs are headless (`claude -p` / `codex exec --sandbox danger-full-access`), fresh empty git
scratch dir per run, prompt verbatim from PLAN.md task list. Verifier (me) grades against the
rubric above; I also wrote the rubric — there is no second grader in this session, which the
protocol requires; flagged as a deviation. Turn counts are approximate (headless transcripts).

**Protocol deviations this session (declared):** (1) single grader = rubric author (no second
person available); transcripts and grading artifacts retained under /tmp/eval2-* for an
independent re-grade. (2) Mid-session stakeholder decision: Docker is banned ("too heavy and
slow — stick to Playground"); the first claude task-1 run predates the ban and is reported
separately; all protocol runs use the amended prompt with "Do not use Docker or other container
tools." (3) Headless harness caps (420–900s) cut some runs; a cap hit is labeled
"harness-capped", never "fail" — artifacts produced before the cap are graded and so labeled.

### Task 1 — results

| Run | Agent | Wall | Tool chosen | T1.a URL alive when user looks | T1.b told how | T1.c hygiene | Overall |
|---|---|---|---|---|---|---|---|
| pre-ban r1 | claude | 253s | **Docker Compose** (wordpress+mariadb) | ✓ 200 post-session | ✓ | ✓ (disclosed + stop cmd) | pass, but tool now banned |
| r1 | claude | 271s | hand-rolled mysqld (custom datadir/socket) + `wp server` | ✗ 000 post-session ("running as background tasks in this session" — they died with it) | ✓ | (no orphans, but final message falsely claims running) | **FAIL** |
| r1 | codex | >480s harness-capped | hand-rolled mysqld + php | — (incomplete) | — | ✗ orphaned mysqld left listening on 3307 after kill | **FAIL** (orphan is real; completion unknowable) |
| r2 | claude | 316s | mysqld + `wp server` (~/wp-local) | ✗ 000 post-session | ✓ | same false "running" claim | **FAIL** |
| r2 | codex | 176s | mysqld + `php -S`, screenshot proof | ✗ 000 post-session | ✓ | no survivors, message claims listening | **FAIL** |

**Task 1 verdict: 0/4 protocol runs pass.** Two systematic failures, both ≥2 runs:
(a) **toolchain discovery** — no bare run ever found Playground/wp-now/SQLite; with Docker
banned both agents build a raw mysqld stack (slow, fragile, needs a writable datadir, leaves
daemons); (b) **lifecycle hygiene** — every agent declares a URL "running" that is dead the
moment the session ends (agent-session-scoped backgrounding), the exact problem
`playground.sh ensure`'s detached process group solves. Both earn skill content.
What the bare agents got RIGHT (cut from skill): WordPress install/config itself (wp-config,
install wizard, admin user) was flawless in all runs; screenshot-verification instinct (codex
screenshots unprompted) — no content needed on either.

### Task 2 — results

Grading bench: each theme mounted on a disposable Playground site via the fixed playground.sh;
editor gate = Playwright on post-new.php, `wp.blocks.parse` over templates/parts (file content)
and **server-rendered** patterns from the editor's pattern registry (parsing raw pattern PHP is
a grader artifact — first gate version did this and false-failed both themes; fixed).

| Run | Agent | Wall | T2.a activation | T2.b editor gate | T2.c design (typo/palette/full-width hero) | Overall |
|---|---|---|---|---|---|---|
| r1 | claude | >720s harness-capped | ✓ "Copper Finch", no notices | ✓ PASS (11 items) | ✓ / ✓ / ✓ (1280==1280) | **PASS** (artifacts; run capped) |
| r1 | codex | >720s harness-capped | ✓ "Northstar Coffee", no notices | ✗ **invalid core/cover** in landing-hero pattern | ✓ / ✓ / ✓ | **FAIL** (T2.b) |
| r2 | claude | >900s harness-capped | ✓ "Crema", no notices | ✓ PASS (13 items) | ✓ / ✓ / ✓ | **PASS** (artifacts; run capped) |
| r2 | codex | 391s | ✓ "Corner Pour", no notices | ✓ PASS (8 items) | ✓ / ✓ / ✓ | **PASS** |

**Task 2 verdict: 3/4 pass.** Content-filter consequences, recorded with the same rigor as
failures: design quality is NOT a bare-agent failure for claude/codex — both shipped distinct
typography, custom palettes, real full-width heroes, coherent patterns (screenshots in
/tmp/grade-t2/*-front.png; codex r2 generated a photorealistic hero image with its built-in
image tool — image-policy implications for images-media.md). Anti-slop design content shrinks
to near zero for these agents. Block validity failed once (codex r1 cover block — invisible on
the frontend, caught only by the editor gate): 1/4 is below the ≥2-runs bar; block-markup.md's
validity section needs Phase 1 full repetition (or one more failure) before it ships at size.
The editor gate itself re-proved its worth: it found the one defect screenshots couldn't.

### Task 6-local — NOT RUN (rubric pre-registered above)

Dated amendment before any run (2026-06-11): `wp db export` **silently no-ops on Playground**
(exit 0, no output, no file — verified this session). The T6.a "db-export path" artifact for
the local stand-in is therefore a copy of `<site-dir>/wp-content/database/.ht.sqlite`, not a
`wp db export` output. The rubric fields are unchanged.

### wpcom-backup.sh dry-run (local half)

`rest` mode + `verify` gate run against a live local Playground site 2026-06-11:
export of posts+pages succeeded (with cookie CURL_AUTH; `context=edit` is 401 under cookie
auth — falls back to rendered content with a loud warning; an application password is required
for a restorable raw export on WP.com); manifest written with 5 fields; `verify` passes on real
artifacts and **fails after the artifact is truncated** (the touch-bypass test). `ssh` mode:
UNVERIFIED (needs a Business-plan site; Phase 1.5).
