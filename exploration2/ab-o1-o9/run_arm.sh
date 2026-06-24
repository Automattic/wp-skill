#!/usr/bin/env bash
# run_arm.sh <arm-name> <skill-src-dir> — one A/B arm: install the given skill version into an
# isolated CLAUDE_CONFIG_DIR, run the same build prompt headless, capture metrics, screenshot every
# page, then stop the server. The ONLY variable across arms is <skill-src-dir>.
set -uo pipefail

ARM="$1"; SKILL_SRC="$2"
ROOT=/home/matias/dev/a8c/ab
PROJ="$ROOT/run-$ARM"
CFG="$ROOT/config-$ARM"
SHOTTER=/home/matias/dev/a8c/wp-o1o9/wordpress/scripts/checker/visual-gate.mjs
PLAY="$CFG/skills/wordpress/scripts/playground.sh"

rm -rf "$PROJ" "$CFG"
mkdir -p "$PROJ/workdir/.playground" "$CFG/skills" "$PROJ/shots"

# isolated config: real creds + only the wordpress skill (this arm's version)
cp ~/.claude/.credentials.json "$CFG/"
cp -r "$SKILL_SRC" "$CFG/skills/wordpress"
# pre-decide image handling so the consent question can't block a headless run (same for both arms)
printf '{"images":"placeholders","decided_at":"2026-06-23T00:00:00Z"}\n' > "$PROJ/workdir/.playground/images.json"

PROMPT=$(cat <<'EOP'
Build a complete local WordPress site for this brief, autonomously and WITHOUT asking any
questions (this is a non-interactive run — there is no human to answer):

"Create a minimalist site for my photo-journalism website for my portfolio. I'm an Argentinean
photo-journalist based in Buenos Aires. I covered the most important social and political events
of the country in the last 20 years."

Run constraints:
- Use the `wordpress` skill. It is ALREADY INSTALLED — do NOT clone or download it.
- Work in the current directory. The deliverable theme goes at the project root; bring up the
  local site with the skill's scripts/playground.sh (bootstrap + ensure).
- Image handling is ALREADY DECIDED and recorded as "placeholders" in
  workdir/.playground/images.json — do not ask about images; build with AI_IMAGE markers and fill
  solid placeholders.
- Make all design/content decisions yourself and proceed to a finished site; never stop to ask.
- Build a real block theme: a home page and at least a portfolio/journal page, with
  templates/parts/patterns (header, hero, gallery/portfolio, footer).
- Block markup MUST pass BOTH gates: validate-blocks.cjs (static) and editor-gate.mjs (live).
- Set the static front page so the home route renders the home page.
- Leave the Playground server RUNNING at the end and print the live http://127.0.0.1:<port>/ URL.
Finish with a one-line summary of what you built and the URL.
EOP
)

echo "[$ARM] start $(date -Is)"
cd "$PROJ"
START=$(date +%s)
CLAUDE_CONFIG_DIR="$CFG" timeout 3600 claude -p "$PROMPT" \
  --output-format json --model sonnet --dangerously-skip-permissions --max-turns 200 \
  > "$PROJ/result.json" 2> "$PROJ/run.err"
RC=$?
END=$(date +%s)
echo "[$ARM] claude exit=$RC wall=$((END-START))s $(date -Is)"

# capture pages (server should be left running by the agent)
PORT=""
[ -f "$PROJ/workdir/.playground/server.port" ] && PORT=$(cat "$PROJ/workdir/.playground/server.port")
echo "[$ARM] port=$PORT"
if [ -n "$PORT" ] && curl -fs -o /dev/null --max-time 5 "http://127.0.0.1:$PORT/" 2>/dev/null; then
  # list published page+post permalinks as relative paths; always include '/'
  RAW=$(bash "$PLAY" wp -- eval 'foreach(get_posts(["post_type"=>["page","post"],"numberposts"=>-1,"post_status"=>"publish"]) as $p){echo wp_make_link_relative(get_permalink($p->ID)),"\n";}' 2>/dev/null | grep '^/')
  PATHS=$(printf '/\n%s\n' "$RAW" | awk 'NF && !seen[$0]++' | paste -sd,)
  echo "[$ARM] paths=$PATHS"
  node "$SHOTTER" "http://127.0.0.1:$PORT" --paths "$PATHS" --viewports desktop,mobile --out "$PROJ/shots" > "$PROJ/shots/visual-gate.log" 2>&1
  echo "[$ARM] shots: $(ls "$PROJ/shots"/*.png 2>/dev/null | wc -l)"
  # now stop the arm's server so arms don't pile up
  bash "$PLAY" stop > "$PROJ/stop.log" 2>&1 || true
else
  echo "[$ARM] WARNING: no live server to screenshot"
fi
echo "[$ARM] DONE $(date -Is)"
