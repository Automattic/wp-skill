# AGENTS.md — working on this skill

This repo **is** a coding-agent skill (`wordpress/`), not an app. README.md says what it does;
`wordpress/SKILL.md` is the skill's own entry point and routing table — read it first. This file
is only the non-obvious stuff about *developing* the skill.

## Mental model

- **You are editing a skill that runs elsewhere.** Users run an *installed copy* (e.g.
  `~/.claude/skills/wordpress/`, or test clones like `…/tests/skillN/.claude/skills/wordpress/`).
  Editing `wordpress/` here does **not** change an installed copy — re-sync to test a change in a
  real run. A bug report from a transcript usually came from an installed copy, not this tree.
- **Audience of the docs is an agent mid-task, not a human reader.** Keep `SKILL.md`/references
  terse, imperative, and decision-shaped. Don't restate what the model already knows (what a block
  theme is, how OAuth works); document only this skill's particularities and the gotchas.

## Conventions that are load-bearing (don't quietly break them)

- **Exact behavior lives in scripts, prose is for judgment.** `playground.sh` is a shipped script
  precisely because the markdown version kept regressing across reviews. When you discover a
  fragile invariant, encode it in a script + a comment explaining *why*, rather than as a doc rule.
- **Scripts are zero-dependency, Node 18+ / POSIX bash only.** The npm registry may be sandboxed
  off and Node is the only guaranteed runtime — that's why e.g. `serve-dir.mjs` exists instead of
  `python -m http.server`. Don't add dependencies or reach for other runtimes.
- **Project layout the skill assumes:** deliverables (theme/plugin) live at the **project root**;
  everything the agent generates is scratch under a gitignored **`workdir/`** (`workdir/.playground`
  run-state, `workdir/previews`, `workdir/media` staging). `playground.sh bootstrap` writes
  `workdir/.gitignore` (`*`).
- **Block markup is "done" only after both gates pass** (`validate-blocks.cjs` static +
  `editor-gate.mjs` live) — invalid blocks render fine on the frontend and only break in the editor.
- **Verify against reality before claiming done.** This skill is built by actually running things
  (live endpoints, stub servers, real Playground), not by reasoning about them.

## Image generation (current active area)

- `scripts/wpcom-images.mjs` → WordPress.com `wpcom/v2/ai-image/v1/imagine` (Gemini, server-side).
  Auth is **OAuth2 implicit-grant + manual token paste**, reusing WordPress Studio's
  `client_id=95109`; the **user runs `auth` themselves** so the token never transits the chat.
  See `references/images-media.md` for the consent flow (4 options, "Generate AI" shown first,
  plain placeholders as the no-login fallback) and failure policy.
- **You usually cannot run the happy path.** The endpoint is **Automatticians-only during launch**
  (403 otherwise); even as an Automattician, your wpcom **sandbox must not be in read-only mode**
  (otherwise HTTP 500 `…is in read-only mode`). So test orchestration (batching, dedup, failure
  policy) against a **stub**: point `WPCOM_API_BASE` at a local server returning
  `{data:[{b64_json}]}`. Use the live API only for cheap checks (auth rejection, route existence).
- **GA blockers live in the backing wpcom PR** ([Automattic/wpcom#223791](https://github.a8c.com/Automattic/wpcom/pull/223791)):
  remove the `// TODO: REMOVE BEFORE PROD` Automatticians gate, and confirm `MAX_MONTHLY_REGULAR`
  (200 is a placeholder). The skill must keep working (placeholders) for non-a8c users regardless.

## Backing endpoint code

The image endpoint is served from a **different repo** — `Automattic/wpcom` on the internal
`github.a8c.com` ([backing PR #223791](https://github.a8c.com/Automattic/wpcom/pull/223791)).
That host is Automattic-internal and firewalled; reaching it needs internal network access and the
mechanics are environment-specific (keep them in your own local notes, not here). The runtime
endpoint `public-api.wordpress.com` is **not** firewalled — reachable directly.

## Repo / PRs

This repo is `Automattic/wp-skill` on **github.com** (default branch `trunk`); branch + PR per
change. The *backing image endpoint* lives in a different repo (`Automattic/wpcom` on
github.a8c.com) — don't confuse the two.
