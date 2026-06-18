#!/usr/bin/env bash
# playground.sh — local WordPress Playground lifecycle, shipped as a script because three
# review cycles failed to keep the markdown version of this correct.
#
# Verbs:
#   playground.sh bootstrap [project-dir]          one-time: create site, record workdir/.playground/site-dir
#   playground.sh ensure   [host:vfs ...]          idempotent: converge to a running server (+ mounts)
#   playground.sh wp -- <wp-cli args>              run wp-cli against the SAME site + SAME mounts
#   playground.sh stop                             process-group stop + assert nothing survives
#
# State (all under workdir/.playground/): site-dir, mounts, server.{pid,pgid,port,log}. The whole
# of workdir/ is the agent's scratch area (previews, staging media, this run-state) and `bootstrap`
# drops a workdir/.gitignore ('*') so none of it pollutes git — the deliverable theme/plugin live
# at the project root, not in workdir.
# Mount consistency is enforced by construction: `ensure` records its extra mounts in
# workdir/.playground/mounts and `wp` replays them. If `ensure` is called with a DIFFERENT mount set
# than the live server was started with, the server is RESTARTED with the new set (review 4:
# the previous version recorded the new mounts but reused the old server — the exact
# divergence this script exists to prevent; reproduced as an HTTP 500 on 2026-06-11).
#
# Frontend checks: Playground answers a one-time 302 that sets a session cookie. Plain
# `curl <url>` loops on 302→/. Use the form printed by `ensure` (cookie jar) for any
# "frontend serves X" assertion.
#
# Verified end-to-end 2026-06-11 (reviews 3 and 4, Linux only): bootstrap → ensure (theme
# mount) → wp theme activate → frontend serves theme (cookie-jar curl) → blind ensure reuses →
# ensure with changed mounts restarts → stop passes both assertions. macOS is UNVERIFIED and
# requires util-linux setsid.
#
# Pinned versions (bump only after re-running the full chain above):
PLAYGROUND_VERSION="${PLAYGROUND_VERSION:-3.1.38}"   # @wp-playground/cli, verified 2026-06-11
WPCLI_PHAR_URL="https://github.com/wp-cli/wp-cli/releases/download/v2.12.0/wp-cli-2.12.0.phar"
set -euo pipefail

CLI=(npx -y "@wp-playground/cli@${PLAYGROUND_VERSION}")
WORKDIR=workdir
PG="$WORKDIR/.playground"
PHAR="$PG/wp-cli.phar"

die() { echo "playground.sh: $*" >&2; exit 1; }

command -v setsid >/dev/null 2>&1 || \
  die "setsid not found (Linux/WSL verified; on macOS: brew install util-linux)"

free_port() {
  # first free port at/after 9400 (Playground's default base)
  local p
  for p in $(seq 9400 9499); do
    if ! (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then echo "$p"; return 0; fi
    exec 3>&- 3<&- || true
  done
  die "no free port in 9400-9499"
}

site_dir() {
  # recorded site dir, validated: a recorded-but-deleted dir must fail loudly, not mount-error
  test -s "$PG/site-dir" || die "run 'bootstrap' first (no $PG/site-dir)"
  local d; d=$(cat "$PG/site-dir")
  [ -d "$d" ] || die "recorded site dir is gone ($d) — delete $PG/site-dir and re-run bootstrap"
  echo "$d"
}

mount_args() {
  # fill global array MOUNTS with --mount=... flags (array: spaces in paths survive)
  MOUNTS=()
  [ -f "$PG/mounts" ] || return 0
  while IFS= read -r m; do
    [ -n "$m" ] && MOUNTS+=("--mount=$m")
  done < "$PG/mounts"
}

pgid_is_ours() {
  # true iff the process group contains a wp-playground process — never group-kill a
  # recycled pgid that now belongs to someone else
  local g="$1"
  [ -n "$g" ] || return 1
  ps -eo pgid=,args= | awk -v g="$g" '$1 == g' | grep -q 'wp-playground\|@wp-playground/cli'
}

server_alive() {
  # alive = recorded pid exists AND its group is a playground group AND the port answers.
  # curl alone is not identity: a foreign process on the recorded port must read as dead
  # (review 4: a python http.server on the stale port was "reused" by the previous version).
  [ -f "$PG/server.port" ] && [ -f "$PG/server.pid" ] && [ -f "$PG/server.pgid" ] || return 1
  kill -0 "$(cat "$PG/server.pid")" 2>/dev/null || return 1
  pgid_is_ours "$(cat "$PG/server.pgid")" || return 1
  curl -fs -o /dev/null --max-time 2 "http://127.0.0.1:$(cat "$PG/server.port")/" 2>/dev/null
}

kill_recorded() {
  # TERM the recorded group iff it is still a playground group; fall back to the pid
  local pgid="" pid=""
  [ -f "$PG/server.pgid" ] && pgid=$(cat "$PG/server.pgid")
  [ -f "$PG/server.pid" ]  && pid=$(cat "$PG/server.pid")
  if [ -n "$pgid" ] && pgid_is_ours "$pgid"; then
    kill -TERM -- "-$pgid" 2>/dev/null || true
  elif [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null || true
  fi
}

cmd_bootstrap() {
  local path="${1:-.}"
  mkdir -p "$PG"
  # The whole scratch dir stays out of git (deliverables live at the project root, not here).
  [ -f "$WORKDIR/.gitignore" ] || printf '*\n' > "$WORKDIR/.gitignore"
  if [ -s "$PG/site-dir" ] && [ -d "$(cat "$PG/site-dir")" ]; then
    echo "already bootstrapped: $(cat "$PG/site-dir")"; return 0
  fi
  rm -f "$PG/site-dir"
  local port; port=$(free_port)
  setsid nohup "${CLI[@]}" start --path="$path" --skip-browser --port="$port" \
    > "$PG/bootstrap.log" 2>&1 &
  local pid=$!
  local pgid; pgid=$(ps -o pgid= -p "$pid" | tr -d ' ')
  local i
  for i in $(seq 1 60); do
    kill -0 "$pid" 2>/dev/null || break   # bootstrap process died: stop waiting, report below
    grep -q "Site files stored at:" "$PG/bootstrap.log" 2>/dev/null && \
      curl -fs -o /dev/null --max-time 2 "http://127.0.0.1:$port/" 2>/dev/null && break
    sleep 2
  done
  sed -n 's/.*Site files stored at: //p' "$PG/bootstrap.log" | head -1 > "$PG/site-dir"
  if ! [ -s "$PG/site-dir" ] || ! [ -d "$(cat "$PG/site-dir")" ]; then
    [ -n "$pgid" ] && kill -TERM -- "-$pgid" 2>/dev/null || true
    rm -f "$PG/site-dir"
    echo "--- last lines of $PG/bootstrap.log:" >&2; tail -5 "$PG/bootstrap.log" >&2 || true
    die "bootstrap failed; full log: $PG/bootstrap.log"
  fi
  kill -TERM -- "-$pgid" 2>/dev/null || kill "$pid" 2>/dev/null || true
  sleep 1
  echo "site-dir: $(cat "$PG/site-dir")"
}

cmd_ensure() {
  mkdir -p "$PG"
  local sdir; sdir=$(site_dir)
  # mount-change detection: ensure with a different mount set than the recorded one must
  # RESTART the server, or state and reality diverge (the silent-white-screen class)
  local want="" have=""
  [ -f "$PG/mounts" ] && have=$(cat "$PG/mounts")
  if [ "$#" -gt 0 ]; then want=$(printf '%s\n' "$@"); else want="$have"; fi
  if server_alive && [ "$want" = "$have" ]; then
    echo "reusing server on port $(cat "$PG/server.port")"
    print_curl_hint; return 0
  fi
  if server_alive; then
    echo "mounts changed — restarting server with the new mount set"
  fi
  # converge: kill whatever we recorded (verified ours), clean state, record new mounts
  kill_recorded
  rm -f "$PG"/server.{pid,pgid,port}
  if [ "$#" -gt 0 ]; then printf '%s\n' "$@" > "$PG/mounts"; fi
  local MOUNTS; mount_args
  local port; port=$(free_port)
  setsid nohup "${CLI[@]}" server --port="$port" --login \
    --mount-before-install="$sdir:/wordpress" \
    --wordpress-install-mode=install-from-existing-files-if-needed \
    ${MOUNTS[@]+"${MOUNTS[@]}"} \
    > "$PG/server.log" 2>&1 &
  local pid=$!
  echo "$pid" > "$PG/server.pid"
  ps -o pgid= -p "$pid" | tr -d ' ' > "$PG/server.pgid"
  echo "$port" > "$PG/server.port"
  local i
  for i in $(seq 1 60); do
    if ! kill -0 "$pid" 2>/dev/null; then
      # server died (bad mount, bad site dir, npx failure): fail NOW with evidence,
      # don't burn the whole readiness budget (review 4: 120s wasted per failure)
      kill_recorded
      rm -f "$PG"/server.{pid,pgid,port}
      echo "--- last lines of $PG/server.log:" >&2; tail -5 "$PG/server.log" >&2 || true
      die "server process died during startup; full log: $PG/server.log"
    fi
    # curl -fs, not -s: Playground serves 502s while booting and plain -s calls that ready
    if curl -fs -o /dev/null --max-time 2 "http://127.0.0.1:$port/"; then
      echo "server ready: http://127.0.0.1:$port (log: $PG/server.log)"
      print_curl_hint; return 0
    fi
    sleep 2
  done
  # timeout: do not leave a half-started group and stale state behind (review 4)
  kill_recorded
  rm -f "$PG"/server.{pid,pgid,port}
  die "server did not become ready in 120s; see $PG/server.log"
}

print_curl_hint() {
  # Playground sets a session cookie via a one-time 302; cookie-less curl loops on 302→/
  local p; p=$(cat "$PG/server.port")
  echo "frontend check: curl -sL -c $PG/cookies -b $PG/cookies http://127.0.0.1:$p/"
}

cmd_wp() {
  local sdir; sdir=$(site_dir)
  [ "${1:-}" = "--" ] && shift
  [ "$#" -gt 0 ] || die "usage: playground.sh wp -- <wp-cli args>"
  if [ ! -s "$PHAR" ]; then
    curl -fsL -o "$PHAR" "$WPCLI_PHAR_URL" || die "wp-cli phar download failed"
  fi
  # NOTE: never read siteurl from this site's DB — Playground stores a junk ephemeral port
  # and overrides the URL at serve time. Use $PG/server.port for the real local URL.
  local MOUNTS; mount_args
  "${CLI[@]}" php \
    --mount-before-install="$sdir:/wordpress" \
    --wordpress-install-mode=install-from-existing-files-if-needed \
    --mount="$PG:/host" \
    ${MOUNTS[@]+"${MOUNTS[@]}"} \
    -- /host/wp-cli.phar "$@"
}

cmd_stop() {
  [ -f "$PG/server.pgid" ] || { echo "no recorded server"; return 0; }
  local port=""; [ -f "$PG/server.port" ] && port=$(cat "$PG/server.port")
  local pgid; pgid=$(cat "$PG/server.pgid")
  kill_recorded
  # poll up to 10s for the group to exit (TERM is async; 2s flat was a flaky assert)
  local i
  for i in $(seq 1 10); do
    pgid_is_ours "$pgid" || break
    sleep 1
  done
  # assertions, not cleanup: stop fails loudly if anything survives
  if [ -n "$port" ] && curl -fs -o /dev/null --max-time 2 "http://127.0.0.1:$port/" 2>/dev/null; then
    die "ASSERT FAILED: server still answering on port $port"
  fi
  # scope assertions to THIS project's server: with no recorded port, a bare
  # "wp-playgroun[d].*" pattern matches other projects' servers (false positive, review 4)
  if [ -n "$port" ] && pgrep -f "wp-playgroun[d].*--port=$port" >/dev/null 2>&1; then
    die "ASSERT FAILED: playground process still owns port $port"
  fi
  if pgid_is_ours "$pgid"; then
    die "ASSERT FAILED: recorded process group $pgid still alive"
  fi
  rm -f "$PG"/server.{pid,pgid,port}
  echo "stopped clean (curl fails, no surviving process)"
}

case "${1:-}" in
  bootstrap) shift; cmd_bootstrap "$@";;
  ensure)    shift; cmd_ensure "$@";;
  wp)        shift; cmd_wp "$@";;
  stop)      shift; cmd_stop "$@";;
  *) sed -n '3,10p' "$0"; exit 1;;
esac
