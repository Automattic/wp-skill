# Adversarial Review: PLAN.md v3

## Findings

### CRITICAL 1

1. The server stop recipe leaves WordPress running, so users and agents inherit orphaned local sites and port conflicts.

2. Claim attacked: the `ensure running` lifecycle in `exploration2/PLAN.md` says start with `setsid nohup ... & echo $! > .playground/server.pid`, then stop with `kill $(cat .playground/server.pid)`.

3. Evidence:

```bash
$ mkdir -p .playground
$ setsid nohup npx @wp-playground/cli@latest server --port=9851 \
  --mount-before-install=/home/matias/.wordpress-playground/sites/6fab09...:/wordpress \
  --wordpress-install-mode=install-from-existing-files-if-needed \
  --verbosity=quiet > .playground/server.log 2>&1 & echo $! > .playground/server.pid
$ cat .playground/server.pid && curl -I --max-time 5 http://127.0.0.1:9851
200271
HTTP/1.1 302 Found

$ kill $(cat .playground/server.pid)
$ sleep 1
$ if curl -fsI --max-time 3 http://127.0.0.1:9851 >/dev/null; then echo still-up; else echo stopped; fi
still-up

$ pgrep -af "wp-playground.*9851"
200302 node /home/matias/.npm/_npx/.../wp-playground-cli server --port=9851 ...

$ ps -o pid=,ppid=,pgid=,sid=,stat=,cmd= -p 200302
200302 11503 200271 200271 Sl node ... wp-playground-cli server --port=9851 ...

$ kill -TERM -200271
$ if curl -fsI --max-time 3 http://127.0.0.1:9851 >/dev/null; then echo still-up; else echo stopped; fi
stopped
```

The recipe records the `npm exec` wrapper PID. Killing it does not kill the child `node` server. Killing the process group works on this Linux host.

4. Concrete fix: change the lifecycle recipe before Phase 1 uses it. Record the process group ID and stop with `kill -TERM -$pgid`, or avoid `npx` at runtime by resolving the actual CLI binary once and recording the child PID. Add a stop assertion to the spike: after stop, `curl` must fail and `pgrep -af "wp-playground.*<port>"` must be empty. Run that assertion on all four agents.

### CRITICAL 2

1. Production safety is still advice, so a mid-session agent can pull production, prototype locally, push, and run search-replace without a verified backup artifact.

2. Claim attacked: the plan says safety is the exception and must be prescriptive, but the implementation still depends on the agent remembering prose.

3. Evidence:

```bash
$ rg -n "Safety is the exception|Any write-before-backup|Backup \\(db export|No wrapper scripts|Full flow|cold-start" exploration2/PLAN.md
22:- **Safety is the exception.** Backup/destructive-op discipline stays explicit and prescriptive.
80:   live; site verified rendering after. Any write-before-backup = fail regardless of outcome.
308:  - Backup (db export + changed files, copied off-host) before any destructive remote operation.
311:- No wrapper scripts. Document raw commands; the agent composes them. Two exceptions, both
382:2. Full flow on a real WP.com test site: create local -> polish -> deploy -> verify -> roll back
413:  Phase 3 must test cold-start triggering ("build me a WordPress site") on each agent.

$ rg -n "Prefer a backup|wp db export|dry-run|High-risk" \
  /home/matias/dev/a8c/studio/wp-files/skills/wp-wpcli-and-ops/references/safety.md \
  /home/matias/dev/a8c/studio/wp-files/skills/wp-wpcli-and-ops/references/search-replace.md
.../safety.md:11:- Prefer a backup (`wp db export`) before risky operations.
.../safety.md:12:- Prefer `--dry-run` where available (especially `search-replace`).
.../search-replace.md:8:   - `wp db export`
.../search-replace.md:10:   - `wp search-replace OLD NEW --dry-run`
```

The plan tests cold-start skill triggering in Phase 3, not mid-session safety triggering. It also makes the backup script conditional: "if Phase 1 shows the backup sequence is error-prone." That is backwards for production writes.

4. Concrete fix: make `scripts/wpcom-backup.sh` mandatory now, not conditional. Make every destructive remote recipe consume a backup manifest path produced by that script. The deploy/search-replace instructions should say: if there is no manifest with database export, changed-files archive, target site, timestamp, and local path, refuse to write. Add a Phase 1 safety test that starts with local work, then switches to a remote destructive request after several turns, with no explicit reminder to reload safety docs.

### MAJOR 1

1. The day-one local workflow fails from an empty project directory, so new users do not get a working first command.

2. Claim attacked: the local wp-cli recipe is marked partly verified and is treated as the basis for one server tool, one lifecycle, and one wp-cli path.

3. Evidence:

```bash
$ npx @wp-playground/cli@latest --help
Commands:
  wp-playground-cli start           Start a local WordPress server with automatic project detection (recommended)
  wp-playground-cli server          Start a local WordPress server (advanced, low-level)
  wp-playground-cli run-blueprint   Execute a Blueprint without starting a server
  wp-playground-cli build-snapshot  Build a ZIP snapshot of a WordPress site based on a Blueprint
  wp-playground-cli php             Run a PHP script

$ npx @wp-playground/cli@latest php \
  --mount-before-install=/tmp/wp-agent-review.r8d972/site:/wordpress \
  --wordpress-install-mode=install-from-existing-files-if-needed \
  --mount=/tmp/wp-agent-review.r8d972/host:/host -- /host/wp-cli.phar option get siteurl
Error: Error connecting to the SQLite database.

$ timeout 20s npx @wp-playground/cli@latest server --port=9841 \
  --mount-before-install=/tmp/wp-agent-review.r8d972/site:/wordpress \
  --wordpress-install-mode=install-from-existing-files-if-needed
Mount /tmp/wp-agent-review.r8d972/site -> /wordpress
Error: Error connecting to the SQLite database.

$ timeout 25s npx @wp-playground/cli@latest start \
  --path=/tmp/wp-agent-review.r8d972/site --skip-browser --port=9842 --reset
Site files stored at: /home/matias/.wordpress-playground/sites/6fab09...
Ready! WordPress is running on http://127.0.0.1:9842 (6 workers)

$ find /tmp/wp-agent-review.r8d972/site -maxdepth 3 -type f | sed -n '1,20p'
# no output

$ npx @wp-playground/cli@latest php \
  --mount-before-install=/home/matias/.wordpress-playground/sites/6fab09...:/wordpress \
  --wordpress-install-mode=install-from-existing-files-if-needed \
  --mount=/tmp/wp-agent-review.r8d972/host:/host -- /host/wp-cli.phar option get siteurl
http://127.0.0.1:37041
```

The phar recipe works only after `start` has initialized a Playground site under `~/.wordpress-playground/sites/...`. It did not work against a fresh empty project mount.

4. Concrete fix: Phase 1 must decide and document one state model before any eval: either a project-owned WordPress root that the skill can initialize from nothing, or the current Playground global site registry plus a recorded site path. Then rerun the composed workflow: start server, run wp-cli against the same site, run editor validation, stop server. Do not write `local-sites.md` until that exact chain passes.

### MAJOR 2

1. The node validator proves less than the plan says, so agents may either miss bad markup or rewrite valid markup without understanding the risk.

2. Claim attacked: "inner loop - node validator (verified)" and the claim that Telex examples can be re-verified through it.

3. Evidence:

```bash
$ node -v && npm -v
v22.19.0
10.9.3

$ npm i @wordpress/blocks@latest @wordpress/block-library@latest jsdom@latest
added 565 packages, and audited 566 packages in 34s
9 moderate severity vulnerabilities

$ npm ls @wordpress/blocks @wordpress/block-library jsdom --depth=0
@wordpress/block-library@9.48.0
@wordpress/blocks@15.21.0
jsdom@29.1.1

$ node --input-type=module validator.mjs
TypeError [ERR_IMPORT_ATTRIBUTE_MISSING]: Module ".../i18n-block.json" needs an import attribute of "type: json"

$ node validator.cjs
SAMPLE telexCover
core/cover:false:["Expected tag name `%s`, instead saw `%s`.", ...]

SAMPLE paragraphAlign
core/paragraph:true:[]
<!-- wp:paragraph {"style":{"typography":{"textAlign":"center"}}} -->
<p class="has-text-align-center">Hello</p>
<!-- /wp:paragraph -->

SAMPLE styleTag
core/paragraph:true:[]
core/missing:true:[]
<!-- wp:paragraph -->
<p>Hello</p>
<!-- /wp:paragraph -->

<style>.x{color:red}</style>
```

The validator did catch the stale Telex Cover example with current packages. It did not report the paragraph alignment sample as invalid; it only rewrote it during serialization. It also accepted a stray `<style>` as `core/missing`, even though the Telex rules ban `<style>` in templates.

4. Concrete fix: split the tool into three named checks: validator, normalizer, and lint. Pin a CommonJS script and package versions, because latest ESM failed on Node 22. Make "normalizer rewrote valid markup" a warning with a diff, not an invalid-block failure. Add a simple lint for `core/missing`, `core/freeform`, and raw `<style>` in templates. Keep the editor-side gate mandatory before deploy for all block content, not only when plugin blocks are present.

### MAJOR 3

1. Phase 1 is labeled as two days, but the plan now asks for roughly two work weeks.

2. Claim attacked: "Phase 1 - Baseline eval + toolchain spike (day 1-2)."

3. Evidence:

```bash
$ rg -n "day 1|10 tasks|40 runs|Business|Personal|concurrent|editor|preview|MCP|SSH|all four agents" exploration2/PLAN.md
32:## Phase 1 -- Baseline eval + toolchain spike (day 1-2)
53:- **Scope honesty.** 10 tasks x 2 runs x 2 agents ~= 40 runs.
85:8. "Deploy this theme to my WordPress.com site" -- against a **Personal-plan** site.
129:- **Open spike question**: concurrent access ...
158:  on **all four agents**: ensure-running turn 1 -> curl it turn 3 -> stop it turn 5 ...
197:    Playground site ... editor gate spike
205:- **Preview/share path** ...
214:- WP.com SSH: confirm host names, username format, htdocs layout, what's writable ...
```

Minimum honest budget:

| Line item | Estimated hours | Recommendation |
|---|---:|---|
| Pre-register rubrics for 10 tasks | 4 | Keep only for tasks kept in Phase 1 |
| Build and freeze brownfield fixture | 6 | Defer to Phase 1.5 |
| WooCommerce Playground fixture | 4 | Defer to Phase 1.5 |
| Bare eval runs: 40 runs | 24 | Cut to 16 core runs |
| Blind grading for 40 runs | 12 | Cut with the run count |
| Business-plan WP.com site: SSH, MCP, app password, backup path | 6 | Keep as one platform smoke |
| Personal-plan WP.com refusal test | 2 | Keep as one scripted platform check, not full eval |
| MCP tool surface and per-agent connection docs | 8 | Defer detailed enumeration |
| SSH host/path/writable/rsync verification | 4 | Keep only facts needed for the smoke |
| Four-agent server survival matrix | 10 | Keep Codex + one other now; defer all four |
| SQLite concurrency test | 4 | Defer unless server/wp-cli composition is kept |
| Editor-validation recipe spike | 8 | Keep |
| Preview substitute spike | 5 | Defer |
| Playground CLI drift and wp-cli bootstrap rewrite | 3 | Keep |
| Total as written | 100 | Not a two-day phase |

4. Concrete fix: rename the current scope to "Phase 1 + Phase 1.5". The actual two-day Phase 1 should be: 16 runs covering local site, block theme, screenshot loop, and one WP.com safety/refusal path; plus four spikes only: lifecycle start/stop, wp-cli bootstrap, node/editor validation, and one Business-plan SSH/MCP smoke. Move brownfield, WooCommerce, preview sharing, full MCP enumeration, all-four-agent lifecycle, and concurrency to Phase 1.5.

### MAJOR 4

1. The M5 styling decision is an unevaluated bet, so block-theme users may get a skill that fights the site editor or creates noisy rewrites.

2. Claim attacked: "DECIDED (M5): styling is attribute-serialized" and "the philosophy and the fixer reinforce each other."

3. Evidence:

```bash
$ rg -n "DECIDED|attribute-serialized|presumes the attribute-serialized" exploration2/PLAN.md
257:    #   content. DECIDED (M5 -- the two sources contradict, no
258:    #   merge possible): styling is **attribute-serialized**
272:    #   which presumes the attribute-serialized decision -- the

$ sed -n '1,45p' /home/matias/dev/a8c/studio/apps/cli/ai/skills/block-content/SKILL.md
- Use editable WordPress blocks for content and layout.
- No inline `style` attributes or block `style` attributes for styling.
- Use `className` plus the theme's `style.css`.

$ sed -n '55,78p' /home/matias/dev/a8c/telex/agent/config/skills/creating-themes/references/block-html.md
### Style attributes -> inline styles
<!-- wp:group {"style":{"spacing":{"padding":{"top":"2rem","bottom":"2rem"}}}} -->
<div class="wp-block-group" style="padding-top:2rem;padding-bottom:2rem">...</div>
```

The two sources really do conflict. The plan resolved the conflict by argument, not by comparing output in the editor, theme.json, and frontend across greenfield and brownfield tasks.

4. Concrete fix: convert M5 from a decision to a Phase 1 question. Run the coffee-shop and brownfield edit tasks in two variants: attribute-first and class/CSS-first. Grade editor validity, visual quality, diff size, ease of later edits in the site editor, and CSS selector stability. Lock the rule only after that comparison.

### MAJOR 5

1. The fix layer has re-grown the complexity the thesis was trying to avoid, so strong agents may spend more attention obeying caveats than building WordPress sites.

2. Claim attacked: "little more than a skill", "bet on the model", and "write content only for actual failure points."

3. Evidence:

```bash
$ rg -n "references/|Fallback ladder|two tiers|verbatim|plan-capability matrix|click-by-click|backup script|validate-blocks.mjs|parity map" exploration2/PLAN.md
161:  **Fallback ladder (pre-decided; descend only on spike evidence, never preemptively).**
179:- **Block validation -- two tiers, one validator**
193:    ... ship the snippet **verbatim** ...
245:wordpress/
246:  SKILL.md
247:  references/local-sites.md
256:  references/block-markup.md
275:  references/themes-and-patterns.md
278:  references/blocks-and-plugins.md
280:  references/design.md
282:  references/images-media.md
284:  references/wordpress-com.md
293:  references/backups-and-safety.md
295:  references/deploy.md
311:- No wrapper scripts. Document raw commands; the agent composes them. Two exceptions...
352:### Studio harness parity map (recreate as recipes, not tools)
```

This is now one router, eight reference files, two script exceptions, a two-tier validator, an ensure-running protocol, a fallback ladder, a plan-capability matrix, bootstrap click paths, and a parity map.

4. Concrete fix: do a trim pass before writing Phase 2 content, not after. Cap v1 at four references: local-sites, block-markup, wordpress-com, safety-deploy. Move images, custom blocks/plugins, broad design advice, preview sharing, WooCommerce, multisite, and parity notes out of v1 unless Phase 1 produces a repeated failure that needs them.

### MAJOR 6

1. Several "spikes" cannot change the plan, so Phase 1 is partly theater.

2. Claim attacked: Phase 1 is supposed to verify and falsify claims before content is written.

3. Evidence:

```bash
$ rg -n "pre-decided|Whatever the spike concludes|DECIDED|Final reference list is decided" exploration2/PLAN.md
161:  **Fallback ladder (pre-decided; descend only on spike evidence, never preemptively).**
171:  Whatever the spike concludes, the ensure-running convention stays the single recommended
257:    #   content. DECIDED (M5 -- the two sources contradict, no
299:Final reference list is decided by Phase 1 results -- merge, drop, or add files based on what the
```

The plan says the reference list is decided by Phase 1, but also says ensure-running remains the single path whatever the spike concludes and M5 is already decided. That is not falsifiable.

4. Concrete fix: add explicit invalidation rules. Example: if stop fails on any primary agent, the lifecycle recipe cannot ship until fixed; if `start` and `server` use different state models, local-sites cannot ship until one model wins; if class/CSS styling beats attribute styling on brownfield diff and editor ergonomics, M5 flips; if Codex cannot keep a detached server alive, the fallback is not pre-decided but becomes the primary Codex path.

### MINOR 1

1. Windows is deferred, so a public `npx skills add` user on Windows can hit broken SSH, process, and Playwright instructions on day one.

2. Claim attacked: Windows does not gate v1 skill content.

3. Evidence:

```bash
$ rg -n "Windows" exploration2/PLAN.md
102:Deliberately deferred from Phase 1 ... Windows host.
103:Windows) but none gates v1 skill content.
104:Windows gap in the skill's README.
```

Platform fact: the WordPress.com SSH support page has separate Windows guidance and uses PuTTY/OpenSSH details. URL checked: https://wordpress.com/support/ssh/

4. Concrete fix: either mark Windows unsupported in v1 before install, or run one Windows smoke for: `npx @wp-playground/cli start`, screenshot, SSH command shape, and stop lifecycle. Do not bury the gap in the README after users install the skill.

### MINOR 2

1. Image generation is named but not designed, so most agents will produce pages with missing or generic assets.

2. Claim attacked: `images-media.md` will provide graceful degradation.

3. Evidence:

```bash
$ rg -n "Image generation|images-media" exploration2/PLAN.md
282:    references/images-media.md      # Image conventions ...
407:- **Image generation** -- agents differ; most have no image tool. images-media.md needs a graceful
```

There is no fallback policy yet: media library search, placeholder generation, user-supplied assets, remote URLs, licensing, and later replacement are not specified.

4. Concrete fix: write a one-page asset policy before design evals: allowed asset sources, when to use placeholders, naming/versioning, alt text, and how to replace placeholders through Media Library registration. If that is too much for v1, cut `images-media.md` from v1 and make image tasks explicitly out of scope.

## Unverified Items

- Unverified: all-four-agent server survival. I tested the lifecycle only in this Codex shell. That was enough to find a stop bug, not enough to prove portability.
- Unverified: real WP.com Business and Personal test sites. I checked current public support docs for MCP and SSH/SFTP plan gating, but I did not log into real test sites or enumerate actual MCP tools.
- Unverified: Windows. I did not run PowerShell, Windows OpenSSH, PuTTY, Playwright, or Playground on a Windows host.

## Drift Table

| Founding principle | Where the plan honors it | Where the plan violates it |
|---|---|---|
| Bet on the model | It prefers raw commands and records hypotheses as falsifiable. | It now prescribes lifecycle internals, fallback ladders, validator shims, bootstrap click paths, and detailed extraction specs before agent failures prove they are needed. |
| One skill | It keeps one router and resists splitting by product surface. | The one skill contains eight references, two scripts, a parity map, a two-tier validator, per-agent lifecycle fallbacks, and WP.com plan matrices. That is one package, not one simple skill. |
| Empirical content only | The eval protocol requires repeated runs and blind grading. | M5 styling, fallback ordering, preview substitution, image degradation, and much of the extraction menu are already written as decisions or first-draft content. |
| No wrappers | It refuses to install Studio or Telex and uses `npx` where possible. | The lifecycle protocol is a homegrown supervisor. The validator is a script exception. The backup script should be mandatory for safety, which means the "no wrappers" principle already has a necessary exception. |
| Safety prescriptive | The eval marks any write-before-backup as failure. | The implementation still says raw commands unless Phase 1 proves a backup script is needed. There is no backup artifact dependency before destructive writes and no mid-session safety-trigger test. |

## Phase 1 Budget

| Line item | Estimated hours | Cut/keep/defer |
|---|---:|---|
| Pre-register rubrics for all 10 tasks | 4 | Keep only for kept tasks |
| Build/freeze brownfield fixture | 6 | Defer to Phase 1.5 |
| Build WooCommerce Playground fixture | 4 | Defer to Phase 1.5 |
| Bare-agent runs: 10 tasks x 2 runs x 2 agents | 24 | Cut to 16 core runs |
| Blind grading and transcript cleanup | 12 | Cut with run count |
| Business-plan WP.com bootstrap: MCP, SSH, app passwords, backup path | 6 | Keep one smoke |
| Personal-plan no-deploy test | 2 | Keep as platform check |
| MCP tool-surface enumeration per plan/client | 8 | Defer |
| SSH host/path/writable/rsync verification | 4 | Keep only load-bearing facts |
| Four-agent server survival matrix | 10 | Keep Codex + one other; defer all four |
| SQLite concurrency test | 4 | Defer unless composition remains unclear |
| Editor-validation recipe spike | 8 | Keep |
| Preview substitute spike | 5 | Defer |
| Playground CLI/wp-cli bootstrap drift fix | 3 | Keep |
| Total as designed | 100 | Not day 1-2 |

Minimum viable Phase 1: 16 bare-agent runs, four local/toolchain spikes, and one WP.com Business smoke plus one Personal-plan refusal check. Everything else is Phase 1.5.

## Single Highest-Leverage Change

Rewrite Phase 1 as a decision-gate document before running it. Each spike needs: the exact claim, the command, the pass/fail rule, and what changes if it fails. Start with the local lifecycle/wp-cli/editor-validation chain, because that is the foundation under most later claims and it already failed in two places.

## One Thing The Fix Layer Got Right

The plan is right to make editor-side block validation mandatory; frontend screenshots cannot catch the block warnings that hurt real WordPress users.

## Final Verdict

The plan needs a trim pass before any execution. It should not proceed with Phase 1 as designed. A non-participant would see a two-day phase that actually contains two weeks of evals and spikes, a local workflow whose stop command is wrong, a wp-cli recipe with hidden bootstrap state, and production safety that is still enforced by prose. Keep the empirical posture and the editor-validation insight, but re-scope Phase 1 around falsifiable gates and remove pre-decided content until the runs prove it is needed.

## One-Line Issue Summary

- CRITICAL 1: The proposed server stop command kills the `npx` wrapper, not the running Playground server.
- CRITICAL 2: Remote destructive operations still rely on prose safety rules instead of a required backup artifact.
- MAJOR 1: The local wp-cli recipe fails from an empty project and only works after hidden Playground bootstrap state exists.
- MAJOR 2: The node validator catches some stale markup but misses lint failures and rewrites valid markup without distinguishing that risk.
- MAJOR 3: Phase 1 is labeled as two days while the planned evals and spikes are closer to two work weeks.
- MAJOR 4: The M5 attribute-first styling rule is a decided hypothesis, not an evaluated result.
- MAJOR 5: The fix layer has grown into a large operating manual that violates the one-skill thesis.
- MAJOR 6: Some spikes cannot change the plan, so Phase 1 is not fully falsifiable.
- MINOR 1: Windows is deferred even though public skill users may hit Windows-specific failures immediately.
- MINOR 2: Image generation has no fallback design, so agents without image tools will produce weak or broken asset workflows.
