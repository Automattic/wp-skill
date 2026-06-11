# Adversarial review — exploration2/PLAN.md (v3)

*Review date: 2026-06-11. Reviewer stance: adversarial, with re-derivation of "verified" claims.*

Re-derived from scratch: the wp-cli phar recipe, the ensure-running/stop lifecycle, the node
block validator (written blind, no peeking at Telex's), bulk re-serialization of Telex examples,
the WP.com MCP and SSH plan-gating facts, and the live Playground CLI flag surface. Everything
below marked "verified" is my run, today, on this machine; "unverified" means I couldn't test it.

---

## CRITICAL findings

### C1. The plan's "verified" local recipe fails on day one and its stop command leaks a server — the two commands every other task depends on are both wrong as written.

**Claim attacked:** "Local wp-cli (partially verified 2026-06-11)… verified: state persists… the
same mounted site dir serves `server`" and the ensure-running snippet's
`stop: kill $(cat .playground/server.pid)`.

**Evidence (all re-run today):**

1. The recipe on a *fresh* site dir fails — both for `php` and `server`:

```
$ npx @wp-playground/cli php --mount-before-install=./site:/wordpress \
    --wordpress-install-mode=install-from-existing-files-if-needed ... -- /host/wp-cli.phar option get blogname
Error: Error connecting to the SQLite database.
```

`install-from-existing-files-if-needed` does not bootstrap into an empty mounted dir. The
working first run is the **default** install mode with `--mount-before-install`; only then does
the plan's recipe work (4.1s, correct output). The recipe was verified against an
already-populated dir and generalized. The day-one user's first command, as the plan would
document it, produces a cryptic SQLite error.

2. The stop recipe orphans the server. `$!` records the npx wrapper pid, not the node server:

```
$ kill $(cat .playground/server.pid); curl :9411 → 200   # still serving
$ ss -tlnp | grep 9411 → node pid=195171                 # ≠ recorded pid 195157
$ kill -- -$(cat .playground/server.pid)                 # process-group kill
$ curl :9411 → 000; pgrep wp-playground → none
```

The skill's own eval task 1 fails any agent that leaves orphaned processes — and the skill's
recommended snippet guarantees orphans. (Bonus data point: my own first attempt at the snippet
also failed on `&&`/`&` precedence, the exact class of shell mistake agents make; this is an
argument for shipping the corrected snippet verbatim.)

**Fix:** Tomorrow morning: rewrite the recipe as a two-state convention — bootstrap (default
install mode) vs reuse (`if-needed` mode), or just always use default mode with
`--mount-before-install`, which handles both. Change stop to `kill -- -$(cat server.pid)` (the
`setsid` already makes it a group leader, so this is one character of fix). Re-run the
turn-1/turn-3/turn-5 protocol with the corrected snippet before it appears anywhere else in the
plan.

### C2. Phase 1 is labeled "day 1–2" but owes roughly a week of work; the label will cause either silent scope-cutting or silently broken verification.

**Claim attacked:** "Phase 1 — Baseline eval + toolchain spike (day 1–2)" and "if day 1–2 can't
absorb that, cut tasks 9–10."

**Evidence:** Counted from the plan's own text (budget table below): ~40 eval runs with
pre-registered rubrics and a blind second grading pass, a brownfield fixture built and frozen,
two paid WP.com test sites bootstrapped (Business + Personal, with MCP and SSH enablement
click-paths recorded), a 4-agent × 3-turn server-survival matrix plus blind re-run, SQLite
concurrency test, editor-validation Playwright spike, preview spike, MCP tool enumeration per
plan, SSH fact verification. My estimate: **~45 hours** for one person — 3× over a 2-day budget
even before anything goes wrong. The plan's escape hatch (cut tasks 9–10) recovers ~4 hours.

**Fix:** Rename what's real. Phase 1 core (2 days): tasks 1, 2, 6 at full repetition on 2 agents
+ the lifecycle and validator spikes (they gate everything). Phase 1.5 (explicitly scheduled,
not silent): WP.com tasks 4–8 (blocked on site provisioning anyway), brownfield, Woo, preview
spike, MCP enumeration. The budget table below marks each line.

### C3. The catastrophic safety path (pull production → prototype → push → search-replace) is still guarded by advice, not structure, and the one scenario where advice fails — mid-session, skill out of context — is explicitly not tested.

**Claim attacked:** "Safety is the exception… stays explicit and prescriptive" as a fix for the
prior review's C2.

**Evidence:** In the current text, backup-before-destructive is: a bullet in SKILL.md's body, a
sequence comment in deploy.md's spec, and a *conditional* script ("if Phase 1 shows the backup
sequence is error-prone, ship `wpcom-backup.sh`"). None of these create a data dependency —
nothing in the deploy recipe *requires* a backup artifact to exist before the push command is
runnable. And the plan's own risk section commits Phase 3 to test "**cold-start** triggering"
only. A 40-turn session that drifts from local prototyping into "now push it live" — with
SKILL.md long out of the attention window — is precisely the scenario the earlier review raised,
and no eval task or Phase 3 step exercises it. Task 6 tests the discipline cold-start, once, per
agent.

**Fix:** Two concrete changes. (1) Make the backup structural: the documented push command takes
the backup tarball path as an argument and the recipe's first step verifies it exists and is
non-empty off-host (`test -s "$BACKUP" || abort`) — determinism-as-safety, the exception class
the plan already accepts. (2) Add one Phase 3 scenario: a long mixed-task session that ends in a
production write, graded on whether backup discipline survived. Cheap to add; it's the only test
of the failure mode the safety rules exist for.

---

## MAJOR findings

### M1. The M5 styling decision is an untested hypothesis wearing a decision's costume, and Phase 1 contains no run that could overturn it.

**Claim attacked:** "DECIDED (M5 — the two sources contradict, no merge possible): styling is
attribute-serialized."

**Evidence:** Studio's block-content skill says the opposite ("No inline `style` attributes or
block `style` attributes for styling. Use `className` plus the theme's `style.css`" —
`apps/cli/ai/skills/block-content/SKILL.md:20`). Both products ship their rule; neither was
evaluated against the other. The plan's eval task 2 grades *bare* agents on design quality — it
cannot distinguish the two philosophies because no run pits them against each other. Worse, the
plan itself notes the circularity ("the philosophy and the fixer reinforce each other") and
keeps it. What Phase 1 result would invalidate M5? None can, as designed.

**Fix:** Downgrade "DECIDED" to "default, falsifier registered": in Phase 3 (where the skill
exists), run task 2 once with an attribute-styled variant and once with a stylesheet-styled
variant of block-markup.md on one agent, grade against the same three design criteria plus
editor warnings. Two extra runs. If you won't run them, say the decision is taste and stop
citing M5 as resolved.

### M2. The inner-tier validator judges markup against *latest npm packages*, not the site's WordPress — wired into "after every template write," it can push agents to "fix" markup that the actual site considers valid.

**Claim attacked:** "Inner loop — node validator (verified 2026-06-11)" + block-markup.md spec:
"node validator (verbatim snippet) after every template write."

**Evidence:** I rebuilt the validator blind (~25 lines; first attempt died on an ESM JSON-import
error, second worked — the "ship verbatim" rationale holds, mildly). It confirmed the stale
cover fact. But the same run shows the trap: it flags `{"align":"center"}` paragraphs as
deprecated against today's serializer — markup that is perfectly valid on the slightly older WP
a real site runs. Telex pins exact `@wordpress/*` versions (`blocks: 15.15.0` in
block-fixer/package.json) for exactly this reason; the plan's snippet floats on latest. An agent
told to validate after every write will chase serializer drift the site never sees, burning
turns and possibly committing markup that's *ahead* of the deploy target.

**Fix:** Pin the snippet's package versions and document the mapping rule ("match the
`@wordpress/blocks` major to the site's WP version; `wp core version` tells you"). Demote the
inner tier from "after every template write" to "before declaring a template done"; the editor
gate remains the authority.

### M3. The fix layer has quietly re-grown v2's complexity: the lifecycle section alone is now a 4-step protocol plus a 3-tier pre-decided fallback ladder, contradicting both "bet on the model" and "one convention, no per-agent logic."

**Claim attacked:** "One skill, modular parts" / "Describe goals, commands, and facts — not
step-by-step procedures."

**Evidence:** Count the prescriptive mass added by the fix commits (e69b9db, 46401aa, 5afb187):
ensure-running 4-step procedure, fallback ladder tier 2 of which is *per-agent docs* — which the
plan itself calls "strictly worse for a portable skill" — a two-tier validator, two script
exceptions, a 13-row parity map, a plan-capability matrix, and file-tree spec comments long
enough to be the references' first draft. The ladder was pre-decided on zero Codex evidence (the
plan admits Codex "may not" keep children alive — untested), then declared immovable ("the
ensure-running convention stays the single recommended path"). That's a decision written too
firmly to be changed by the spike it claims to await. And per C1, the protocol being prescribed
is currently *wrong* — prescriptive mass without prescriptive correctness is the worst quadrant.

**Fix:** Spend the prescription budget where mechanism is fragile (corrected lifecycle snippet,
pinned validator) and reclaim it elsewhere: delete the fallback ladder from the plan (one
sentence: "if the spike shows an agent kills detached processes, document the cheapest
workaround for that agent, with evidence"), move the parity map to an appendix labeled
non-normative. Note: this finding and C1's "ship the corrected snippet verbatim" pull opposite
directions — resolved by holding total mass constant: add precision to the two fragile spots,
cut the speculative scaffolding.

### M4. The extraction sources are staler than the plan believes: 4 of 11 Telex block-html examples fail current validation, not the 2 the plan banked.

**Claim attacked:** "two stale facts already proven: cover dimRatio-50 class, paragraph align."

**Evidence:** I extracted all 11 `wp:`-bearing examples from Telex
`creating-themes/references/block-html.md` and ran them through the validator:

```
INVALID core/paragraph   (attribute value mismatch)
INVALID core/group ×2    (token-type mismatch — layout serialization drift)
INVALID core/cover       (tag-name mismatch)
4 invalid / 11
```

The two *group* failures are new — and groups are the markup the skill will generate most. A
~36% staleness rate means "re-verify every example" isn't a checkbox, it's a half-day of
extraction work per reference file, unbudgeted.

**Fix:** Budget it (see table), and make the rule executable: extraction = run the example
through the pinned validator, paste the *re-serialized* output into the reference, never the
Telex original.

### M5. The skill will tell agents to use `server` while the tool itself tells them to use `start` — a guaranteed instruction conflict.

**Claim attacked:** The plan's exclusive use of `npx @wp-playground/cli server`.

**Evidence:** `npx @wp-playground/cli@latest --help` today:

```
start   Start a local WordPress server with automatic project detection (recommended)
server  Start a local WordPress server (advanced, low-level)
```

`start` did not exist when the recipe was written. An agent that runs `--help` (they do) sees
the tool recommending a command the skill never mentions, with auto-mount semantics that may
collide with the skill's explicit `--mount-before-install` recipe. Version drift has already
happened once between "verified 2026-06-11" and today; the skill ships unpinned
`npx @wp-playground/cli`.

**Fix:** Spike `start` vs `server` for the mount/persistence semantics the skill needs; pick one
and say why; pin the package version in the documented commands (`@wp-playground/cli@X`) and add
"re-verify on version bump" to the skill's maintenance note.

---

## MINOR findings

- **M6 — Concurrency rule has its first data point and it's exonerating.** I ran
  `wp option update` via the phar recipe *while the server was live*: write succeeded, no
  corruption, and the running server served the new value on the next request. One simple write
  isn't proof under load, but "stop the server before one-off wp-cli writes" (30–60s cost per
  stop/start, every loop iteration) may be the plan's most expensive unnecessary rule. Keep the
  spike; be ready to delete the rule.
- **M7 — The lifecycle convention is POSIX-only by construction** (`setsid`, `nohup`, group
  kill) while distribution is `npx skills add`, which works fine on Windows. Deferring Windows
  is defensible; shipping a convention that fails *silently* there is not. One line in SKILL.md
  ("local workflows require a POSIX shell; Windows: use WSL") converts a silent failure into an
  explicit one.
- **M8 — The regression rubric can't see the regression it claims to test.** Phase 3's
  "bare-agent strengths are not degraded" is graded on binary task pass — but the realistic
  skill-induced regression is *cost* (validator runs, npm installs, lifecycle ceremony on a task
  that needed none). Add turns/wall-clock to the rubric or the regression test passes vacuously.
- **M9 — WP.com facts mostly check out** (re-verified today: MCP = Personal+ / disabled by
  default / role-scoped, support page reviewed 2026-05-20; SSH = "Business and Commerce plans",
  support page 2026-02-11 — the plan's "believed Business+ (unverified)" can be upgraded to
  verified). Image generation "graceful degradation" remains a phrase, not a design — fine to
  defer, but it should be a named Phase 1.5 item, not a risk bullet.
- **M10 — Multisite / non-English revisit triggers are rhetorical.** "Revisit at Phase 3 if
  evals there fail" — Phase 3 contains no multisite or non-English eval, so nothing can fail.
  Either add one non-English run to task 2 (cheap, real) or delete the revisit clause and own
  the deferral.

---

## Drift table

| Founding principle | Honored | Violated |
|---|---|---|
| Bet on the model | Content filter; "rewrite as goals"; hypotheses falsifiable | 4-step lifecycle protocol; "after every template write" validator mandate; fallback ladder pre-deciding agent behavior nobody tested |
| One skill, modular parts | Single skill, router + references; split only on evidence | Ladder tier 2 = per-agent docs inside the "portable" skill; parity map functioning as a second spec |
| Empirical content only | Pre-registered rubric, blind grading, "successes get no content" | M5 styling DECIDED with no eval that can falsify it; ladder decided on zero Codex evidence; "two stale facts" undercount (it's ≥4) |
| No wrappers | Raw commands documented | Two script exceptions are defensible — but the lifecycle snippet is a script in markdown clothing, and it's currently buggy (C1) |
| Safety prescriptive | Rules in SKILL.md body; task 6 pass criterion | No structural enforcement (data dependency); mid-session triggering explicitly untested (C3) |

---

## Phase 1 budget table

| Line item | Hours | Recommendation |
|---|---|---|
| Rubric pre-registration (10 tasks) | 2 | Keep |
| Tasks 1, 2, 6 × 2 runs × 2 agents (incl. grading) | 12 | **Keep — this is the core** |
| Tasks 3, 5, 9 × 2 runs × 2 agents | 10 | Defer to Phase 1.5 (9 needs the fixture anyway) |
| Brownfield fixture build + freeze | 3 | Defer with task 9 |
| Tasks 4, 7, 8 (WP.com; needs sites first) | 6 | Defer to Phase 1.5 |
| WP.com Business + Personal site provisioning/bootstrap | 3 | Start now (wall-clock blocked), counts as 1.5 |
| Task 10 WooCommerce | 3 | Defer; cut to 1 run × 1 agent |
| Blind second grading pass | 4 | Keep for core tasks only (1.5h) |
| Lifecycle matrix: 4 agents × 3-turn + blind re-run (with **corrected** snippet) | 4 | **Keep — gates everything** |
| SQLite concurrency test | 1 | Keep (already half-done in this review) |
| Editor-validation Playwright spike | 3 | Keep — sole authority tier per M2 |
| Preview-substitute spike | 2 | Defer |
| MCP tool enumeration per plan | 2 | Defer to Phase 1.5 |
| SSH platform-fact verification | 1.5 | Mostly done (support pages); 0.5 against a real site |
| `start` vs `server` spike (new, M5) | 1.5 | Add |
| **Total as written ≈ 45h; core ≈ 21h** | | Core fits 2 days only if Phase 1.5 is named in the plan |

---

## The single highest-leverage change

Replace "Phase 1 (day 1–2)" with the explicit core/1.5 split above, and attach a registered
falsifier to every line currently labeled DECIDED (M5 styling, fallback ladder, wp-now demotion,
concurrency rule): one sentence each — "this decision flips if Phase 1/3 shows X." That one edit
fixes C2, M1, and M3's firmness problem simultaneously, and it costs an hour.

## One thing the fix layer got right that must survive

The eval protocol's epistemics — pre-registered binary rubrics, ≥2 runs, hypothesis-blind
grading, and "a success gets no skill content" — is genuinely better than how either Telex or
Studio decided what to write, and it's the mechanism by which every other error in this plan
gets caught.

---

## Verdict: re-scope Phase 1 first

The thesis survives this review — every Studio/Telex capability I tested really does collapse
into npx commands, and the plan's verification habit caught real stale facts. But the plan's two
most-trusted artifacts are broken in ways only re-running them reveals: the verified wp-cli
recipe fails on a fresh machine, and the server-lifecycle snippet — the spine of every local
task — leaks the process it claims to manage. Meanwhile Phase 1 promises a week of work in two
days, which means either the evals get silently cut or the "verified" labels keep being written
by under-budgeted runs, which is how the two broken artifacts got their labels in the first
place. Fix the two snippets, split Phase 1 honestly, register falsifiers on the DECIDED items —
then execute. None of that is more than a day of plan surgery, and skipping it would ship the
same class of error this review exists to catch.

---

## Appendix — re-derivation log (commands run 2026-06-11)

- `npx -y @wp-playground/cli@latest --help` / `server --help` / `php --help` — flag surface,
  `start` command discovery, default port 9400.
- Fresh-dir recipe failure: `php --wordpress-install-mode=install-from-existing-files-if-needed`
  against empty `./site` → "Error connecting to the SQLite database" (same for `server`).
- Working bootstrap: `server --mount-before-install=./site:/wordpress` (default install mode) →
  302, WP files persisted to host.
- Phar recipe on populated dir: `option get blogname` → 4.1s, correct output.
- Concurrent write: `option update blogname` while server live → success, live server served
  new title immediately, no corruption observed.
- Stop bug: `kill $(cat server.pid)` → server still answers (wrapper pid ≠ server pid);
  `kill -- -$PID` → clean shutdown, no survivors.
- Node validator rebuilt blind: attempt 1 failed (ESM `ERR_IMPORT_ATTRIBUTE_MISSING`), attempt 2
  (CJS, 8 globals + matchMedia/rAF shims) worked; confirmed cover `has-background-dim-50`
  invalid; paragraph `align` parses as deprecated-but-migrated.
- Bulk Telex check: 11 examples extracted from `creating-themes/references/block-html.md`,
  4 invalid (paragraph, group ×2, cover).
- WP.com support pages fetched live: MCP (reviewed 2026-05-20, Personal+ confirmed), SSH
  (reviewed 2026-02-11, Business + Commerce confirmed).
- Not re-tested (unverified): `@php-wasm/cli` 2s fallback; wp-now maintenance status; Codex /
  Gemini CLI process semantics; `build-snapshot` preview path; MCP tool list per plan.

---

## Summary — one line per issue

- **C1** — The verified wp-cli/server recipe fails on a fresh dir and the stop command orphans the server; fix install-mode bootstrap and use process-group kill.
- **C2** — Phase 1 owes ~45h, not "day 1–2"; split into a 2-day core (tasks 1/2/6 + lifecycle/validator spikes) and a named Phase 1.5.
- **C3** — Backup-before-destructive is still advice, not structure, and mid-session skill triggering is never tested; require a backup artifact as a push precondition and add one long-session Phase 3 scenario.
- **M1** — The M5 attribute-styling "decision" has no eval that could falsify it; downgrade to a default with a registered Phase 3 A/B falsifier.
- **M2** — The node validator floats on latest npm packages, so it can "fix" markup the real site considers valid; pin versions and demote it from per-write to pre-done.
- **M3** — The fix layer re-grew v2's complexity (4-step protocol, 3-tier ladder, parity map); cut the speculative scaffolding, keep precision only where mechanism is fragile.
- **M4** — 4 of 11 Telex block-html examples are stale, not 2; budget extraction-time re-serialization of every example.
- **M5** — The CLI now recommends `start` while the plan documents only `server`; spike both, pick one, pin the package version.
- **M6** — First concurrency data point: a wp-cli write alongside a live server worked fine; the stop-server-first rule may be unnecessary cost.
- **M7** — The lifecycle convention is POSIX-only; declare the Windows/WSL requirement explicitly in SKILL.md.
- **M8** — The Phase 3 regression check can't see cost regressions; add turns/wall-clock to the rubric.
- **M9** — WP.com plan-gating facts verified (MCP Personal+, SSH Business/Commerce); image-generation degradation still has no design — make it a named Phase 1.5 item.
- **M10** — Multisite/non-English "revisit triggers" can never fire as written; add one non-English run or own the deferral.
