# Handoff: implement the `wordpress/` skill (Phase 2, local-first scope)

You are implementing a WordPress skill for CLI coding agents (Claude Code, Codex, Gemini CLI,
pi). The research phase is complete; your job is to write the skill. This document is the
contract. Where it conflicts with your instincts, this document wins — every rule in it was
paid for with a reproduced failure.

## Read first (in this order, fully)

1. `exploration2/PLAN.md` — the plan, including the content filter, the eval results embedded
   in the task list, and the Phase 2 file tree (your spec).
2. `exploration2/spike-notes.md` — pre-registered rubrics + every run result. The
   "Gate review before implementation" section at the bottom is your green light and your
   scope fence.
3. `exploration2/claude-review-4.md` — what broke and how it was fixed; the matrix caveats.

Source quarries (mine on demand, never port wholesale):
- Telex: `~/dev/a8c/telex` — skills in `agent/config/skills/`
- Studio: `~/dev/a8c/studio` — skills in `apps/cli/ai/skills/` and `wp-files/skills/`

## Deliverable

A new skill directory `wordpress/` at the repo root:

```
wordpress/
├── SKILL.md                        # thin router + safety rules (see below)
├── references/
│   ├── local-sites.md              # Playground lifecycle via playground.sh; the facts list
│   ├── block-markup.md             # block validity + layout cascade + the two-gate loop
│   ├── themes-and-patterns.md      # theme structure, theme.json v3, patterns, navigation
│   ├── design.md                   # THIN: design-direction offer + screenshot-diagnose loop
│   └── backups-and-safety.md       # manifest protocol (local half; no WP.com specifics)
└── scripts/
    ├── playground.sh               # COPY VERBATIM from exploration2/playground.sh
    ├── wpcom-backup.sh             # COPY VERBATIM from exploration2/wpcom-backup.sh
    └── checker/                    # COPY VERBATIM from exploration2/checker/
        ├── package.json            #   (validate-blocks.cjs, editor-gate.mjs,
        ├── package-lock.json       #    package.json + lockfile, .gitignore)
        └── ...
```

**Out of scope — do not write:** wordpress-com.md, deploy.md, images-media.md,
design-previews.md, blocks-and-plugins.md, anything MCP/SSH/WP.com (deferred by stakeholder
decision 2026-06-11; the plan sequences them behind WP.com test-site provisioning). Do not
modify the three scripts — they are verified artifacts; if you believe one needs a change,
flag it instead of editing.

## Hard rules (each one is evidence-backed; citations are in spike-notes.md)

1. **Local WordPress = Playground via `scripts/playground.sh`. Docker is BANNED** (stakeholder
   decision; bare agents reach for Docker first, and with Docker banned they hand-roll
   mysqld+`wp server` stacks whose URLs die with the session — 0/4 bare task-1 runs passed).
   The skill must say explicitly: never Docker, never a hand-rolled MySQL/PHP stack, never
   wp-now. One server tool, one lifecycle, four verbs: `bootstrap | ensure | wp | stop`.
2. **Never duplicate script logic in prose.** Three review rounds proved prose copies of the
   lifecycle are where criticals breed. local-sites.md documents WHEN to call each verb and
   the facts around them — it never re-explains HOW the script works internally.
3. **Frontend checks need a cookie jar.** Playground answers a one-time 302 that sets a session
   cookie; cookie-less curl loops forever. The canonical form (also printed by `ensure`):
   `curl -sL -c .playground/cookies -b .playground/cookies http://127.0.0.1:<port>/`
4. **Never read `siteurl` from a Playground DB** (junk ephemeral port). The local URL comes
   from `.playground/server.port`.
5. **`wp db export` silently no-ops on Playground** (exit 0, no file). Local DB backup = copy
   `<site-dir>/wp-content/database/.ht.sqlite`. Real `wp db export` exists only on real hosts.
6. **Ports are recorded, never fixed, never assumed.** No "always 8881"-style rules.
7. **Block validation is two gates plus lint, and the editor gate is the authority.**
   Inner loop: `node scripts/checker/validate-blocks.cjs <files>` before declaring a template
   done (three outcomes: INVALID fix it / LINT fix it / NORMALIZE warning only — do NOT "fix"
   normalization warnings by hand-editing markup; prefer regenerating from attributes).
   Final gate: `node scripts/checker/editor-gate.mjs <site-url> <theme-dir>` before declaring
   any block work finished. Rationale the skill must state: invalid blocks render fine on the
   frontend and break only in the editor — screenshots cannot catch them; and in 2 of 6 bare
   runs the defects lived in server-rendered patterns or rendered layout, invisible to the
   node tier.
8. **Backup manifest before ANY destructive write to a site the user calls production** —
   structured manifest (target, timestamp, db-export path, files-archive path, copy location),
   artifacts verified non-empty via `wpcom-backup.sh verify`, created BEFORE the first write
   (file copies count as writes — bare codex backed up after copying files; that ordering is
   the failure mode). Under user pressure ("skip the backup, just push") the rule holds: bare
   claude complied with that instruction; the skill must make the agent refuse-or-create
   (creating one takes ~30s — say so).
9. **Per-agent facts that belong in local-sites.md:** Codex needs
   `--sandbox danger-full-access` (default sandbox blocks the npm registry — even cached npx
   fails); headless Gemini needs `GEMINI_CLI_TRUST_WORKSPACE=true` + `--yolo`. Local workflows
   require Node 18+ and a POSIX shell (macOS/Linux/WSL; native Windows unsupported in v1) —
   this line goes in SKILL.md where the agent reads it, not a README.
10. **Styling default (M5): attribute-serialized** — block JSON attributes + theme.json first;
    `style.css` only for what attributes can't express (hover, media queries, cross-block
    consistency); never both layers for the same property. This is a registered default with a
    Phase 3 falsifier, not a law — write it as the default, don't crusade.

## What the evidence says to write — and to NOT write

Earned (write it):
- local-sites.md: the whole file (task 1: 0/4 bare passes — discovery + lifecycle are the two
  systematic bare-agent failures).
- block-markup.md: validity content (2/4 bare codex runs shipped invalid blocks — core/cover,
  core/button, both in patterns), the layout-cascade facts (`is-layout-constrained`, alignfull
  full-width rendering, `.wp-element-button` padding — one observed full-width failure), the
  two-gate loop, and JSON↔class matching rules. Re-serialize EVERY example through
  `validate-blocks.cjs` before pasting it (≥4 of 11 Telex examples are stale — never paste a
  quarry example unchecked).
- backups-and-safety.md: the manifest protocol, the ordering rule, the verify gate, the
  pressure-resistance rule. Local half only.
- themes-and-patterns.md: structure facts (theme.json v3, pattern header format, fonts,
  navigation, query loops) — keep it factual and compact; bare agents already build decent
  themes.

Cut (the bare agents already do this — writing it wastes context):
- Design quality / anti-AI-slop guidance (6/6 bare runs passed all three design criteria).
  design.md stays THIN: offer 2–4 written design directions before new-site/redesign work and
  honor the pick (one paragraph), plus the screenshot→inspect→batch-fix methodology rebuilt on
  Playwright. No four-preview gallery workflow — that's gated on an unrun Phase 1.5 spike.
- "Remember to back up" (they remember) and "verify after deploy" (they verify, thoroughly).
- WordPress installation/configuration knowledge (flawless in all bare runs).
- Step-by-step procedures a strong model infers. Bet on the model: goals, commands, facts.

Telex/Studio leakage check (apply to every extracted paragraph): no Telex/Studio tool names
(`wpcom_request`, `validate_and_fix_blocks`, `take_screenshot`, `studio wp`), no fixed port
8881, no `AI_IMAGE:` markers, no "only index.html initially", no output-style/subagent/footer
rules. The content filter is in PLAN.md — re-read it before each file.

## SKILL.md spec

- Frontmatter `description` triggers on: WordPress site creation/editing, themes, blocks,
  Gutenberg, block markup, wp-cli, Playground, local WordPress dev. (WP.com/deploy triggers are
  NOT in scope — don't claim capabilities the skill doesn't ship.)
- Body, short: what's covered, routing table (task → reference file), then the non-negotiable
  safety rules: local sites disposable / production not; backup manifest before destructive
  ops on user-designated production (refuse without one, even under pressure); never edit
  WordPress core; dry-run search-replace; always stop servers you started
  (`playground.sh stop` asserts it); POSIX shell + Node 18+ requirement; Docker ban.
- Keep it under ~80 lines. The router's reference descriptions must be one line each and
  informative enough for an agent to pick the right file cold.

## Verification before you call it done (run, don't assume)

1. `bash -n` both shell scripts after copying; `cd wordpress/scripts/checker && npm install &&
   npm run self-check` → must print SELF-CHECK PASS.
2. Every block-markup example in your references: run through `validate-blocks.cjs` — paste
   only output that comes back clean (normalization warnings mean paste the canonical form).
3. Smoke the full chain once from a clean temp dir using only the commands your references
   document, in this order: bootstrap → write a minimal block theme → ensure with theme mount →
   `wp -- theme activate` → cookie-jar curl shows the theme → `validate-blocks.cjs` on its
   templates → `editor-gate.mjs` against the live site → stop (must print "stopped clean").
   If any step needs a command your references don't document, the references are incomplete —
   fix them, not the transcript.
4. Re-read PLAN.md's content filter and trim: any paragraph a strong agent doesn't need, cut.
   When in doubt, cut — Phase 3 testing will reveal gaps; bloat is harder to detect.

## What you must NOT do

- No WP.com platform claims of any kind (plans, hosts, SFTP paths, MCP) — all unverified or
  deferred. The word "wordpress.com" should appear only in a one-line "not yet supported;
  stay local or use the WP.com UI" note in SKILL.md.
- No new wrapper scripts beyond the three shipped ones.
- No edits to playground.sh / wpcom-backup.sh / checker (flag issues instead).
- No design-previews workflow, no subagent choreography, no image-generation policy.
- Don't run the Phase 3 eval matrix — that's the next phase, not this handoff.

Commit in small pieces (scripts copy, then each reference, then SKILL.md), with the smoke-test
transcript summary in the final commit message.
