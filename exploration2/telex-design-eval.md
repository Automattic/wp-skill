# Before/after build evaluation — trunk skill vs. design-quality branch

Empirical test of whether the ported Telex design machinery (branch
`design-quality-telex-port`) produces better WordPress sites than `trunk`, using a real
headless Claude Code agent driving the skill end-to-end.

## Method

- **Prompt (identical both sides, verbatim):** *"Create a wordpress website of my classic
  Georgian restautant called "Tbilisi Tavern" it's a traditional resutaurant located in Tbilisi
  Old Town and it serves classic gerorgian and caucasus dishes."*
- **Runner:** `claude -p … --model sonnet --output-format json --dangerously-skip-permissions`,
  each in an isolated project dir with its own skill copy (`trunk` vs. branch) and its own
  Playground server. JSON output gives turns / duration / cost / tokens.
- **Image handling** pre-seeded identically (`workdir/.playground/images.json = placeholders`)
  so neither run stalls on the consent question (no WordPress.com login available headless).
- **Screenshots** captured at desktop (1280×900) and mobile (390×844), full-page, with
  `prefers-reduced-motion: reduce` emulated so scroll-reveal content is fully visible (see
  "Screenshot caveat"). In `exploration2/eval-shots/{before,after}/`.

## Headline result

The branch's design machinery is **real and substantial at the file level** — when applied, the
theme gains a motion layer, a structured site spec, theme.json rigor, and richer CSS. **But two
findings complicate the "it's just better" story**, and both are more useful than a clean win:

1. **The new guidance does not auto-apply.** A headless sonnet agent given the natural prompt
   read the *same* references as trunk and skipped every new one — no motion, no site spec, no
   `useRootPaddingAwareAlignments`. It only applied them when the prompt *explicitly* named the
   build sequence. The wiring is the bottleneck, not the content.
2. **For this site (a vertical-stack restaurant), the static visual difference is modest.** Both
   sites are competent and content-rich. The branch's most visible feature — scroll motion — is
   invisible in a screenshot by definition.

## Metrics

| Run | Skill | Procedure | Applied new refs? | Turns | Agent time | Cost | Out tokens |
|---|---|---|---|---|---|---|---|
| **BEFORE** | trunk | 2-phase¹ | n/a | 82 | 21.6 min | $3.01 | 84k |
| AFTER v1 | branch | 2-phase¹ natural | **no** | 71 | 27.4 min | $3.42 | 96k |
| AFTER v2 | branch² | 2-phase¹ natural | **no** | 113 | 31.5 min | $4.71 | 84k |
| AFTER v3 | branch² | skip, single | no (rate-limited³) | 46 | 15.9 min | $1.73 | 60k |
| **AFTER (applied)** | branch² | skip, explicit⁴ | **yes** | 105 | 37.3 min | $5.39 | 136k |

¹ The design preview gallery is an interactive gate (the agent stops to ask "pick 1–4"); headless
`-p` can't answer, so phase 1 = run prompt → gallery, phase 2 = resume with the selection to
build. ² Branch after committing the "make references load-bearing" fix (SKILL.md rule + design.md
§5 required sequence). ³ Hit the session usage limit mid-build, not a skill failure. ⁴ Prompt
explicitly directs the agent to read & apply each new reference (the only way it actually did).

**Reading the metrics:** the applied-guidance build costs ~80% more ($5.39 vs $3.01), ~70% longer
(37 vs 22 min), and ~60% more output tokens (136k vs 84k) than trunk — it reads 4 extra reference
files and does a 5-step build (site spec → theme.json rigor → layout CSS → composition → motion).
Better design is not free.

## What the applied-guidance build actually produced (vs trunk)

Verified in the generated files:

| Capability | trunk (BEFORE) | branch, applied (AFTER) |
|---|---|---|
| `workdir/.playground/site-spec.json` | — | ✅ written (layoutMode/header/contentMode/heroComposition) |
| Motion layer | none | ✅ `assets/motion/{motion.css,motion.js}` copied + enqueued frontend-only; reveal-on-scroll on sections |
| `useRootPaddingAwareAlignments` | ✅ | ✅ |
| flex/grid `blockGap` defaults (nav/buttons/post-template) | partial | ✅ all three |
| `style.css` | 101 lines | 96 lines + separate `motion.css` |
| New references read | 0 | site-spec ×7, layout-modes ×7, aesthetics ×6, motion ×4 |

The two non-applied after runs (v1, v2) produced a **10-line** `style.css`, no motion, no site
spec — i.e. *less* than trunk on some axes. That's the wiring gap, not the content.

## Visual comparison (`exploration2/eval-shots/`)

Both sites are genuine, well-composed Georgian restaurant sites with real domain content:

- **BEFORE (trunk):** dark, moody single palette (burgundy/brown/gold). Home = hero → "Where
  Every Meal Tells a Story" → stats (30+ dishes, 20+ wines) → Signature Dishes (3 cards) → soul/CTA
  bands → footer. Menu = Starters / Khinkali / Main Courses / Georgian Wines with GEL prices.
- **AFTER (applied):** lighter cream body with dark chrome, more inter-section color contrast,
  anchor-nav menu (Cold Starters / Mains / Wines), reservation CTA with phone+address. Home hero
  "Established 1994 · Tbilisi Old Town", "Tastes of the Caucasus" dish cards (Khinkali, Adjarian
  Khachapuri, Chakapuli). Menu has two-column dishes with ₾ prices and a Qvevri wine list.

Static, the two are comparably strong. The after edges ahead on section-to-section color variety
and the reservation CTA; trunk's single dark palette is more consistently moody. **Neither is
dramatically better in a still image** — and the after's signature improvement (scroll-reveal,
hero fade) only exists in motion.

### Screenshot caveat (a real finding, not just an artifact)

The after build put `reveal-on-scroll` (opacity:0 until scrolled into view) on page sections. A
full-page screenshot — and any client where `motion.js` doesn't run — sees **blank bands** below
the fold until reveal fires. We captured with `prefers-reduced-motion: reduce` (the documented
static fallback, content fully visible) to show the real content. This is worth flagging in the
skill: the motion's no-JS/headless-capture degradation should lean more on the reduced-motion
fallback being the *default* paint, with JS only animating — currently the static paint of a
non-reduced-motion, JS-disabled client is invisible content.

### Front-page wiring bug (after)

The after build left `show_on_front=page` with `page_on_front=0`, so `/` rendered the default
"Hello world!" post instead of the designed `front-page.html`. The designed homepage composition
existed (hero + 5 patterns); only the option was wrong. We corrected it
(`show_on_front=posts` + server restart) to screenshot the real homepage. Likely a Playground
quirk (wp-cli option writes during the build hit a separate boot from the live server) compounded
by the heavier build — but it shipped a broken front page, which trunk did not.

## Conclusions

1. **The content port is sound.** When the references are applied, the theme is materially
   richer (motion, site spec, token rigor) — the Telex machinery transfers.
2. **The wiring is the real work left.** Docs alone — even an explicit "required" 5-step sequence
   plus a non-negotiable SKILL.md rule — did **not** make a headless sonnet agent pull in the new
   references. This matches AGENTS.md's own lesson ("the markdown version kept regressing… encode
   it in a script"). The reliable fix is mechanical: a `scaffold` script that drops the motion
   assets + a `theme.json` skeleton with the rigor defaults + a `site-spec.json` stub, and/or a
   **build-gate script** (like `validate-blocks`/`editor-gate`) that fails unless site-spec exists,
   motion is enqueued, and `useRootPaddingAwareAlignments` is set. That's the recommended next step.
3. **Motion needs a no-JS-safe default paint** so headless captures and JS-off clients aren't blank.
4. **Cost:** the richer build is ~80% more expensive in tokens/time. Worth it for a flagship build;
   should be skippable for quick edits (the skill already gates the whole flow behind "new
   site/material redesign").

For this single restaurant brief the static before/after is closer than the file-level diff
suggests; the win is in motion + structural correctness + the layout-mode machinery that a
vertical-stack restaurant doesn't exercise. A sidebar/magazine/gallery brief would show the
`layoutMode` divergence far more — a better next test.
