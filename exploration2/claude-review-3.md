# Adversarial review 3 — exploration2/PLAN.md

*Review date: 2026-06-11. Third pass. Per ground rules: no prior finding is re-raised without
new evidence; every claim labeled verified below is my own run, today, on this machine.*

Re-derived from scratch (three-plus, including post-review-2 additions): (1) the **full composed
chain** — bootstrap via `start --path` → `.playground/site-dir` → ensure-running `server` →
wp-cli phar → Playwright editor validation → process-group stop with assertions; (2) the
**pinned validator** policy added after review 2, executed with real `wp-6.9` dist-tag pins;
(3) the **M8 cost-rubric absence** and the other review-2 items the plan claims to have
absorbed; plus mining of Telex's actual design-previews implementation
(`GenerateDesignPreviewsTask.php`, `style-directions.md`, `design-previews.md`, `config.json`).

---

## CRITICAL findings

### C1. The composed chain breaks at the mount seam: an agent following the plan's snippets can bootstrap a site, start a server, and run wp-cli — and still cannot see, serve, or validate the theme it is building. The first real user task (build a theme) fails on the documented path.

**Claim attacked:** "Phase 1 must verify the composed chain against one site dir: bootstrap →
ensure server running → wp-cli read/write → editor validation → stop server" — presented as a
verification formality over snippets that individually work.

**Evidence (full transcript below; the short version):** I ran the chain exactly as the plan
writes it. Bootstrap, guard, pgid stop, wp-cli, and the editor gate each work *in isolation* —
but the seams between them are where the plan's actual workflow dies:

1. **The project is mounted nowhere.** `start --path=.` on an empty dir mounts only the
   Playground-managed site dir. The ensure-running `server` snippet mounts only
   `$(cat .playground/site-dir):/wordpress`. After I wrote a block theme into the project dir
   (the skill's core workflow), `wp theme list` showed only the three default themes. No snippet
   in the plan — server, wp-cli, or bootstrap — contains a project mount. Theme development,
   eval task 2, and the editor validation of authored templates are all impossible on the
   documented commands.
2. **Cross-mount wp-cli writes silently broke the live site.** I activated the theme via a
   one-off wp-cli call with an ad-hoc `--mount=./my-theme:...` while the server (which lacked
   that mount) was live. The server kept answering 200 — with an **empty body**. No error, no
   log line. This is worse than the SQLite-corruption scenario the concurrency rule guards
   against, and "stop the server first" would not have prevented it: the hazard is *mount
   divergence between the server and one-off wp-cli invocations*, which no rule in the plan
   addresses.
3. **`server` does not auto-login.** `server --help`: `--login ... [default: false]`, while
   `start` defaults it to true. The plan's editor-gate claim — "auto-login makes wp-admin
   reachable" — is true only for `start`, which the lifecycle never uses after bootstrap. The
   documented ensure-running snippet produces a wp-admin behind a login wall; Playwright editor
   validation fails until `--login` is added (after which it works — verified).
4. Two smaller seam cuts, both hit live: the readiness poll as described passes on a
   **502-during-boot** if written with plain `curl -s` (mine did exactly that); and the mandated
   stop assertion `pgrep -af "wp-playground..."` **self-matches the agent's own shell** when run
   inside a composite command — the exact way agents run commands — producing a false
   "server still running" failure.

With three fixes (explicit theme mount on both server and wp-cli, `--login`, `curl -fs`), the
whole chain passes, including the editor gate catching the invalid cover block and a clean
pgid stop verified by failing curl and empty pgrep. So the architecture is sound; the documented
commands are not.

**Fix:** Make the composed chain the spike's *pass condition*, not a checklist of parts — and
decide the mount model now, because it is a design decision, not a detail: either (a) keep
Playground-managed site dirs and document the mandatory project mount
(`--mount=./<theme>:/wordpress/wp-content/themes/<slug>`) on **every** server and wp-cli
command, with a hard rule that one-off wp-cli must carry the same mount set as the running
server; or (b) use `server --auto-mount` (the flag exists) and verify what it detects in a
mixed project dir. Add `--login` to the snippet. The cheapest robust form of all of this is one
shipped script — see "highest-leverage change".

### C2. The version-pinning policy added after review 2 is unimplementable as written: pinning `@wordpress/*` to a WordPress release makes the shipped validator crash, and the "narrowly verified" validator was never run under the policy it now ships with.

**Claim attacked:** "skill references pin a verified version (…the node checker's `@wordpress/*`
packages pinned to a stated WordPress release)" + "Ship a pinned CommonJS script verbatim with
pinned npm package versions."

**Evidence:** The mapping source exists — npm publishes per-release dist-tags:

```
$ npm view @wordpress/blocks dist-tags
{ 'wp-6.7': '13.8.6', 'wp-6.8': '14.8.2', 'wp-6.9': '15.6.3', latest: '15.21.0', ... }
```

But installing the policy-mandated pin breaks the verified artifact:

```
$ npm i @wordpress/blocks@wp-6.9 @wordpress/block-library@wp-6.9 jsdom
$ node check.cjs   # same CJS validator shape review 2 verified at latest
ReferenceError: MutationObserver is not defined        # new shim needed at this pin
# after adding the shim:
Store "core/blocks" is already registered.             # nested duplicate @wordpress/blocks
TypeError: Cannot read properties of undefined (reading 'align')
    at @wordpress/block-editor/build/hooks/utils.cjs   # cover save() crashes outright
```

`@wordpress/block-library@wp-6.9` drags in `@wordpress/block-editor`, which installs its *own*
nested `@wordpress/blocks`, double-registers the store, and dies inside block-editor hooks that
expect a configured editor store. The shim list, the dependency graph, and the failure modes are
all different at the pinned version than at `latest`, where all verification to date happened.
Telex knows this: its block-fixer pins `blocks: 15.15.0` — a version matching **no** `wp-*`
dist-tag, i.e. a hand-found working set, not a release mapping. The plan's policy names neither
a working set nor who finds one, nor what re-verification on bump means.

**Fix:** Replace "pinned to a stated WordPress release" with "pinned to a *tested set*": commit
`scripts/validate-blocks.cjs` together with a lockfile (or exact versions) that the spike has
actually run green, note which WP release it approximates, and accept review-2 M2's residual
drift risk explicitly (the editor gate, which validates against the site's real registry, is the
authority anyway — my chain re-confirmed it works). Add one maintenance test: the script must
pass its own three-sample self-check (`invalid / normalization / lint`) before any version bump
lands.

### C3. The design-previews workflow is Telex's product UX rebuilt on infrastructure the plan explicitly dropped, with a pass criterion that three of the four target agents cannot meet — it will fail Phase 3 by construction or force watered-down grading.

**Claim attacked:** design-previews.md, the SKILL.md ask-every-time rule, eval task 2's add-on,
and Phase 3 step 2 ("spawns or cleanly simulates four isolated preview agents").

**Evidence (from the Telex source the plan claims to replicate):**

1. **The previews depend on two backend stages the plan dropped.** Telex's
   `GenerateDesignPreviewsTask` loads a structured site spec first ("GenerateSiteSpecTask runs
   before this task, so layoutMode … shapes the preview's first-fold shell" — the prompt itself
   branches on `siteSpec.layoutMode` with prescribed HTML/CSS skeletons). And the previews
   contain **AI-generated hero images**: the task stream-detects
   `<img id="hero-image" alt="AI_IMAGE: …">` and fires parallel image generation mid-stream.
   The plan drops `AI_IMAGE:` markers as "product policy", has no image-generation design at
   all (still an unowned risk bullet — see m2), and mandates previews be "self-contained, no
   external dependencies". Result: previews with no photography, on briefs where Telex's own
   prompt makes image treatment a primary axis of distinctiveness. The "replication" silently
   assumed the backend it deleted.
2. **Isolation is physically unavailable on most target agents.** Telex sends each direction to
   a separate model call because its own prompt demands it ("Each direction must be completely
   self-contained. It will be sent to a separate model call in isolation"). Of the four target
   agents: pi's README states flatly "**No sub-agents.**" (line 495); Codex and Gemini CLI have
   no documented subagent spawn (unverified, but neither plan nor reviews claim otherwise);
   only Claude Code has them. The plan's fallback — "isolated sequential passes" — is a
   contradiction in terms inside one context window: pass 2 sees pass 1's preview, which is
   precisely the contamination Telex's architecture exists to prevent. The Phase 3 pass
   criterion ("no shared context between preview agents except the brief and assigned
   direction") is unverifiable and unsatisfiable on 3 of 4 agents.
3. **Cost was never confronted.** Telex burns four parallel premium-model calls
   (config.json: `gemini-3.1-pro-preview` + 3× `claude-opus-4-6`, 65k max tokens each) on this
   flow. Sequential replication in a CLI agent is minutes of wall-clock and 4× generation cost
   on every new-site request where the user says yes — and the rubric has no cost line (m1).
4. **It fails the plan's own content filter.** "Would a strong agent get this wrong without
   being told?" — generating design options and letting the user pick is not knowledge an agent
   lacks; it is a product interaction pattern. The plan's own extraction menu classifies
   Studio's `site-spec` and `annotate` as "product behavior, not knowledge — Skip." The only
   eval attached to this workflow (task 2 add-on, Phase 3 step 2) grades *compliance with the
   prescription*, not whether the prescription beats "single best direction" on output quality.
   No falsifier is registered for the largest block of pre-evidence content in the plan — the
   exact defect the post-review-2 plan claims to have eliminated.

**Fix:** Cut design-previews.md from v1. Keep one paragraph in design.md: "for a new site, offer
2–4 written design directions before implementing; if the user picks one, honor it" — that is
the durable part, costs nothing, and works identically on all four agents. If the team wants
the full gallery flow, make it a Phase 1.5 spike with a registered falsifier (A/B against
single-direction on final-output quality) and an agent-capability matrix, *before* a reference
file or SKILL.md rule exists.

---

## MAJOR findings

### M1. Phase 1 core contains a task its own text says cannot run in the core window, so the 2-day core either slips or quietly drops its only safety eval.

**Claim attacked:** "Phase 1 core (day 1–2): tasks 1, 2, 6 at full repetition on 2 agents."

**Evidence:** Task 6 is "Deploy this local theme to my WordPress.com site" — it needs a
provisioned Business-plan site with SSH enabled and verified platform facts. The same paragraph
says "WP.com tasks are wall-clock blocked on test-site provisioning anyway — start provisioning
during core." Both statements cannot hold: a task that is wall-clock blocked on provisioning
that *starts* during the core cannot also complete "at full repetition" (≥2 runs × 2 agents = 4
deploys, each mutating the site, each needing a reset between runs — reset procedure unbudgeted
and unmentioned) inside day 1–2. The blind grading pass for core also has no named grader or
hour in the core window. The split fixed the label (review-2 C2) and moved the contradiction
inside the core.

**Fix:** Swap task 6 out of core for the parts of it that don't need WP.com: a *local* deploy
dry-run graded on manifest discipline against a disposable second Playground site, with the real
WP.com task 6 as the first Phase 1.5 item once the site exists. Or: keep task 6 in core and say
the core is 3–4 days. Either is honest; the current text is not.

### M2. Three Phase 2 reference files depend on unrun Phase 1.5 items, violating the plan's own gate rule — and the plan never sequences Phase 1.5 before Phase 2.

**Claim attacked:** "No reference file ships content that depends on an unrun Phase 1.5 item."

**Evidence (line-by-line against the Phase 1.5 list — tasks 3–5, 7–10, preview spike, MCP
enumeration, mid-session transcript):**

- `wordpress-com.md` — its spec'd FIRST table (plan-capability matrix: plan → MCP? SSH? theme
  upload? wp-cli?) requires MCP tool enumeration per plan (1.5) and the real-site SSH
  verification fed by tasks 4/7/8 (all 1.5). The plan even still labels SSH gating "believed
  Business+ only (**unverified**)" — although review 2 verified it against the support page,
  an absorption miss in itself.
- `deploy.md` — its spec'd sequence includes "register media" (the trap tested only by task 5,
  which is 1.5) and the push/search-replace flow whose only behavioral safety test (the
  mid-session transcript) is 1.5.
- `images-media.md` — depends on task 5 and on an image-generation degradation design that is
  not scheduled anywhere (see m2 below).

Nothing in the plan says Phase 2 waits for Phase 1.5 — Phase 2 simply follows Phase 1. As
written, either the gate rule blocks 3 of 11 reference files indefinitely, or it gets waived in
practice. Both outcomes are unplanned.

**Fix:** One sentence in Phase 2: "local-sites, block-markup, themes-and-patterns, design ship
after Phase 1 core; wordpress-com, deploy, images-media, backups-and-safety ship only after
their Phase 1.5 dependencies run." That also gives Phase 1.5 a real deadline instead of
"scheduled, not silently cut."

### M3. The backup-manifest gate is satisfiable by `touch` and unimplementable on the plans where most destructive-but-possible operations live.

**Claim attacked:** "destructive remote recipes refuse to continue unless given a backup
manifest path" as a *structural* fix for review-2 C3.

**Evidence:** Walk the failure as an agent would. The recipes are markdown; "refuse unless
given a manifest path" compiles to: the agent checks that a path exists before running a
command it composes itself. (1) Nothing specifies the manifest format, so nothing distinguishes
a real manifest from `touch /tmp/manifest.json` — under user pressure ("just push it, I don't
care"), the gate is one shortcut away, and no Phase 1 core run tests that pressure (the
mid-session transcript is 1.5). (2) `wpcom-backup.sh` as spec'd — `wp db export` +
changed-files tar + off-host copy + command log — requires wp-cli over SSH, i.e. **Business+
only**. But destructive remote operations exist on Personal/Premium via MCP and REST (delete
posts, rewrite settings, bulk content changes). On those plans the mandated script *cannot
run*, so the agent must either refuse every destructive op on Personal (absurd — the user can't
delete a post?) or improvise around the gate (the gate teaches itself to be bypassed). The plan
never defines which operations are "destructive" or what backup means below Business.

**Fix:** Define the minimal manifest now (five lines: target, timestamp, db-export path,
files-archive path, off-host location) and make the consuming recipe verify the *artifacts the
manifest points at* (`test -s` each path), not the manifest file. Split the policy by channel:
SSH-channel destructive ops require the full script; MCP/REST-channel destructive ops require a
content-level backup (REST export of affected posts to a local file) — small, honest, and
runnable on Personal. Pull one manifest-bypass-pressure test into Phase 1 core; it is one
transcript.

### M4. The lifecycle "convention, no script" has now required five running-discovered corrections across three reviews — it is a script, and pretending otherwise keeps shipping bugs as prose.

**Claim attacked:** "The skill replicates both properties as one convention, no script."

**Evidence:** Cumulative corrections, each found only by execution: pgid-vs-pid kill (review 2),
`&&`/`&` precedence (review 2, the reviewer's own first attempt), and from today's run:
`--login` missing, `curl -s` readiness poll passing on 502, pgrep stop-assertion self-match
(C1 items 3–4). The snippet is ~15 lines of bash managing five state files with ordering
constraints, a guard, and post-conditions. The plan already concedes the principle twice
("determinism-as-safety" scripts for backup and validation); local-server lifecycle is the
third member of that class — it is the *most* re-run, most stateful command block in the skill.
Meanwhile the prose mass around it (fallback ladder, parity-map row, four spec comment-lines in
the file tree) keeps growing — review 2's M3 trim was answered by *adding* design-previews.md
(reference count: 8 → 10 + previews = 11 files).

**Fix:** Ship `scripts/playground.sh` with four verbs — `bootstrap`, `ensure`, `wp -- <args>`,
`stop` — embodying the corrected chain (mount model, `--login`, `curl -fs` poll, pgid stop with
self-match-proof assertions). This *reduces* total skill mass: local-sites.md shrinks to "run
these four verbs" plus the facts (state model, Playground-vs-prod diffs), and the fallback
ladder collapses into the script's one tmux branch. This resolves, rather than contradicts, the
trim direction: spend the determinism budget on the one mechanism three reviews have failed to
get right in markdown, and pay for it by cutting C3's reference file.

---

## MINOR findings

### m1. Review-2 M8 was never absorbed: the Phase 3 rubric still cannot see cost regressions — verified — and this version of the skill now has a concrete one.

`rg -n "wall-clock|turns|cost|token" PLAN.md` → only an unrelated hit (provisioning). Phase 3
still grades "bare-agent strengths are not degraded" on binary pass. Concrete regression: task
"spin up a quick local site to test this plugin." Bare agent: `npx @wp-playground/cli start
--path=.` — one command, auto-mount detects the plugin, auto-login, Ctrl-C cleanup. Skill
agent: bootstrap → parse → record site-dir → kill start → ensure-running `server` (no
auto-mount, no login by default) → five registry files → stop assertions — plus an "ask about
design directions" interruption if the request smells like a new site. Both pass task 1's
rubric (200/302, no orphans); the regression is invisible. **Fix:** add median turns +
wall-clock per task to the pre-registered rubric, compared bare vs skilled.

### m2. The plan's absorption ledger silently skipped four review-2 items; the "fixes absorbed" framing is itself overclaiming.

Verified against current text: **M7** — Windows is still only "note the Windows gap in the
skill's README" (review 2 asked for the one-line POSIX/WSL requirement in SKILL.md, where an
agent will actually read it). **M9 (image half)** — image generation is still an unowned risk
bullet; it is not in the Phase 1.5 item list, and C3 shows the previews feature quietly depends
on it. **M10** — "Revisit at Phase 3 if evals there fail" still points at a Phase 3 containing
zero multisite/non-English runs; the trigger still cannot fire. **M9 (facts half)** — the plan
still carries "SSH/SFTP is believed Business+ only (unverified)" after review 2 verified it.
**Fix:** one edit each; or state the deferrals as decisions in the plan's own voice.

### m3. The Playground DB's siteurl is a junk ephemeral port; deploy.md's search-replace step will inherit it.

Verified in the chain: `wp option get siteurl` → `http://127.0.0.1:38381` — neither the
bootstrap port (9461) nor the server port (9462); Playground overrides the URL per-process at
serve time. Any deploy/search-replace guidance phrased as "replace the local URL with the
production URL" and any agent that *reads* siteurl to find the OLD value gets garbage that
varies per session. **Fix:** deploy.md must state: never read siteurl from a Playground site;
derive the local URL from `.playground/server.port`, and prefer relative URLs in authored
content so search-replace has less to do.

### m4. The concurrency rule survived its exonerating data point, and today's run shows the spike is aimed at the wrong hazard anyway.

The plan keeps "stop the server before one-off wp-cli writes" pending the SQLite spike, despite
review-2 M6's clean concurrent write. New evidence from the chain (C1.2): the failure that
actually occurred under concurrent access was **mount divergence**, not database corruption —
and stopping the server first would not have prevented it. **Fix:** retarget the spike: the
rule worth testing is "one-off wp-cli must run with the same mount set as the server" (or only
through the `playground.sh wp` verb, which guarantees it); drop the stop-the-server rule unless
the SQLite spike produces an actual corruption.

---

## Fix-of-fixes ledger (review-2 items → what this round found)

| Review-2 item | Status now |
|---|---|
| C1 pgid stop + bootstrap mode | **Closed** — re-verified twice today (stop clean both times); but the same snippet has three *new* running-discovered gaps (C1 here). |
| C2 Phase 1 split | **Narrowed** — split exists on paper; the contradiction moved inside the core (task 6, M1 here). |
| C3 backup structure + mid-session test | **Narrowed** — manifest mandated and script unconditional; but the gate is paper-thin and plan-gated (M3 here), and its only behavioral test deferred to 1.5. |
| M1 styling DECIDED → default+falsifier | **Closed** — falsifier is registered and runnable as written. |
| M2 validator pinning | **Moved** — policy added, but the mandated pin crashes the artifact; verified-at-latest ≠ verified-at-pin (C2 here). |
| M3 complexity regrowth | **Moved** — ladder trimmed in tone, but reference count grew 8→11 incl. design-previews; SKILL.md safety section now carries product UX. |
| M4 stale Telex examples | **Closed** — extraction rule ("re-serialize, paste output") is executable; budget still implicit but bounded. |
| M5 start vs server | **Narrowed** — roles assigned (bootstrap=start, runtime=server) but the *composition* was never run; the seams are C1 here. |
| M6 concurrency exoneration | **Narrowed** — rule and spike kept; spike targets the wrong hazard (m4 here). |
| M7 Windows in SKILL.md | **Not addressed** — still a README note. |
| M8 cost rubric | **Not addressed** — verified absent (m1 here). |
| M9 facts + image design | **Half** — MCP facts absorbed; SSH still labeled unverified; image design still unowned (m2 here). |
| M10 revisit triggers | **Not addressed** — trigger still cannot fire. |

---

## Composed-chain transcript (commands trimmed to what proves each point)

```bash
# 1. bootstrap (plan's recipe) — WORKS
setsid nohup npx @wp-playground/cli@latest start --path=. --skip-browser --port=9461 > start.log 2>&1 &
grep -oP 'Site files stored at: \K.*' start.log > .playground/site-dir   # parsed OK
kill -TERM -$(ps -o pgid= -p $(cat start.pid))                            # stop OK, curl 000

# 2. agent writes a theme; ensure-running (plan's snippet verbatim) — PARTLY WORKS
mkdir -p my-theme/templates && ... style.css theme.json templates/index.html
test -f .playground/site-dir            # guard ok
setsid nohup npx @wp-playground/cli@latest server --port=9462 \
  --mount-before-install="$(cat .playground/site-dir):/wordpress" \
  --wordpress-install-mode=install-from-existing-files-if-needed > .playground/server.log 2>&1 &
# readiness poll with plain `curl -s` exited on a 502 during boot  ← SEAM (C1.4)
curl ... → server:502   # then 302 five seconds later

# 3. wp-cli phar recipe (plan verbatim) — WORKS, BUT:
wp option get siteurl  → http://127.0.0.1:38381    # junk ephemeral port ← m3
wp theme list          → twentytwentyfive/-four/-three   # my-theme INVISIBLE ← C1.1 (lead break)

# 3b. activate with ad-hoc mount while server live — SILENT BREAK
wp ... --mount=./my-theme:/wordpress/wp-content/themes/my-theme theme activate my-theme
→ "Success."  ;  curl :9462/ → HTTP 200, EMPTY BODY            ← C1.2

# 4. editor validation — FAILS as documented, WORKS with fixes
npx @wp-playground/cli server --help | grep login → "--login [default: false]"   ← C1.3
# restart with --login + theme mount → front page serves theme ("chain" present);
# playwright: post-new.php reachable, wp.blocks.parse(cover dimRatio:50) → valid:false  ✓

# 5. stop with mandated assertions — WORKS, with one footgun
kill -TERM -"$(cat .playground/server.pgid)" → curl fails ✓
pgrep -af "wp-playground.*9462"  → matched MY OWN shell (composite command)      ← C1.4
pgrep -f "wp-playgroun[d]"       → empty ✓
```

Break points: step 3 (theme invisible — fatal for the core workflow), 3b (silent white-screen),
4 (login wall), plus two assertion/poll footguns. Steps 1, 5, and the editor gate itself are
solid.

---

## The single highest-leverage change

Ship the local runtime as **one script with four verbs** (`scripts/playground.sh
bootstrap|ensure|wp|stop`) that embodies the corrected, mount-consistent, login-enabled,
pgid-stopped chain — and make "the composed chain passes end-to-end via these four verbs on a
clean machine" the single gate for everything local. Pay for the third script by deleting
design-previews.md from v1. One change fixes C1, M4, m4, shrinks local-sites.md, and removes
the largest block of unfalsified prescription in the plan.

## One thing that must survive this review

The editor-side Playwright validation gate. I ran it end-to-end today against a live Playground
server: it is real, it is cheap, it catches the invalid-block failures that screenshots and the
node tier cannot, and it validates against the site's actual registry. It is the single best
piece of engineering judgment in the plan.

## Final verdict: fix seams first

Do not start Phase 1 core on the current text. The plan's architecture survived its third
adversarial pass — bootstrap, lifecycle, wp-cli, editor gate, and stop all genuinely work — but
the *composition* the skill would actually teach fails on the first real task (the agent's theme
is invisible to its own site), the post-review-2 pinning policy crashes the artifact it governs,
and the newest reference file prescribes a workflow three of four target agents cannot execute.
This is one to two days of plan surgery: decide the mount model and fold the local runtime into
one verified script, replace release-pinning with tested-set-pinning, cut design-previews to a
paragraph, resequence task 6 and the three Phase-1.5-gated reference files, and absorb the four
review-2 items the ledger skipped. Then Phase 1 core is runnable in its stated window and worth
running.

---

## Summary — one line per issue

- **C1** — The composed chain breaks at the seams: no snippet mounts the project, so the agent's theme is invisible; cross-mount wp-cli silently white-screens the live site; `server` has no auto-login; poll and pgrep assertions misfire — fix the mount model and ship the chain as the spike's pass condition.
- **C2** — "Pin @wordpress/* to a WP release" is unimplementable: the wp-6.9 dist-tag combo crashes the validator (new shims, nested duplicate packages); pin a tested set with a lockfile and a self-check instead.
- **C3** — design-previews.md rebuilds Telex product UX minus the site-spec and hero-image backend it depends on, demands subagent isolation 3 of 4 agents don't have (pi: "No sub-agents"), and has no falsifier — cut to one paragraph in design.md, spike the rest later.
- **M1** — Phase 1 core includes task 6, which the plan's own text says is provisioning-blocked; swap in a local deploy dry-run or extend the core honestly.
- **M2** — wordpress-com.md, deploy.md, and images-media.md all depend on unrun Phase 1.5 items, violating the gate rule; sequence Phase 2 files explicitly after their dependencies.
- **M3** — The backup-manifest gate is satisfiable by `touch` and impossible on Personal-plan destructive ops; define the manifest, verify its artifacts, and split policy by channel.
- **M4** — The lifecycle "convention" has needed five run-discovered corrections across three reviews; it is a script — ship it as one and shrink the prose around it.
- **m1** — Review-2's cost-regression rubric (M8) was never added; the quick-local-site task is now concretely slower with the skill and no rubric line can see it.
- **m2** — Four review-2 items (M7 Windows, M8, M9-images, M10 triggers) were silently skipped by the absorption pass; one edit each.
- **m3** — Playground's stored siteurl is a junk ephemeral port; deploy.md must never source the OLD url from the database.
- **m4** — The concurrency spike targets SQLite corruption while the observed failure is mount divergence; retarget the rule to mount consistency.
