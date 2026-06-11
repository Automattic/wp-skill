#!/usr/bin/env bash
# playground.sh — local WordPress Playground lifecycle, shipped as a script because three
# review cycles failed to keep the markdown version of this correct.
#
# Verbs:
#   playground.sh bootstrap [project-dir]          one-time: create site, record .playground/site-dir
#   playground.sh ensure   [host:vfs ...]          idempotent: converge to a running server (+ mounts)
#   playground.sh wp -- <wp-cli args>              run wp-cli against the SAME site + SAME mounts
#   playground.sh stop                             process-group stop + assert nothing survives
#
# State (all under .playground/): site-dir, mounts, server.{pid,pgid,port,log}
# Mount consistency is enforced by construction: `ensure` records its extra mounts in
# .playground/mounts and `wp` replays them — the divergence that silently white-screens a live
# site (observed 2026-06-11) cannot happen through these verbs.
#
# Verified end-to-end 2026-06-11 (review 3): bootstrap → ensure (theme mount) → wp theme
# activate → frontend serves theme → Playwright editor gate reachable (--login) → stop clean.
#
# TODO(Phase 1): pin the package version once the spike picks one (never float on latest).
set -euo pipefail

CLI="npx -y @wp-playground/cli@latest"
PG=.playground
PHAR="$PG/wp-cli.phar"

die() { echo "playground.sh: $*" >&2; exit 1; }

free_port() {
  # first free port at/after 9400 (Playground's default base)
  local p
  for p in $(seq 9400 9499); do
    if ! (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then echo "$p"; return 0; fi
    exec 3>&- 3<&- || true
  done
  die "no free port in 9400-9499"
}

mount_args() {
  # replay recorded extra mounts (one host:vfs per line in $PG/mounts)
  [ -f "$PG/mounts" ] || return 0
  while IFS= read -r m; do
    [ -n "$m" ] && printf -- '--mount=%s\n' "$m"
  done < "$PG/mounts"
}

server_alive() {
  [ -f "$PG/server.port" ] || return 1
  curl -fs -o /dev/null --max-time 2 "http://127.0.0.1:$(cat "$PG/server.port")/" 2>/dev/null
}

cmd_bootstrap() {
  local path="${1:-.}"
  mkdir -p "$PG"
  if [ -s "$PG/site-dir" ] && [ -d "$(cat "$PG/site-dir")" ]; then
    echo "already bootstrapped: $(cat "$PG/site-dir")"; return 0
  fi
  local port; port=$(free_port)
  setsid nohup $CLI start --path="$path" --skip-browser --port="$port" \
    > "$PG/bootstrap.log" 2>&1 &
  local pid=$!
  local pgid; pgid=$(ps -o pgid= -p "$pid" | tr -d ' ')
  local i
  for i in $(seq 1 60); do
    grep -q "Site files stored at:" "$PG/bootstrap.log" 2>/dev/null && \
      curl -fs -o /dev/null --max-time 2 "http://127.0.0.1:$port/" 2>/dev/null && break
    sleep 2
  done
  grep -oP 'Site files stored at: \K.*' "$PG/bootstrap.log" | head -1 > "$PG/site-dir"
  [ -s "$PG/site-dir" ] || { kill -TERM -- "-$pgid" 2>/dev/null || true; die "bootstrap failed; see $PG/bootstrap.log"; }
  kill -TERM -- "-$pgid" 2>/dev/null || kill "$pid" 2>/dev/null || true
  sleep 1
  echo "site-dir: $(cat "$PG/site-dir")"
}

cmd_ensure() {
  mkdir -p "$PG"
  test -s "$PG/site-dir" || die "run 'bootstrap' first (no $PG/site-dir)"
  # record requested extra mounts (host:vfs args); reuse previous if none given
  if [ "$#" -gt 0 ]; then printf '%s\n' "$@" > "$PG/mounts"; fi
  if server_alive; then echo "reusing server on port $(cat "$PG/server.port")"; return 0; fi
  # clean stale state
  if [ -f "$PG/server.pgid" ]; then kill -TERM -- "-$(cat "$PG/server.pgid")" 2>/dev/null || true; fi
  if [ -f "$PG/server.pid" ]; then kill "$(cat "$PG/server.pid")" 2>/dev/null || true; fi
  rm -f "$PG"/server.{pid,pgid,port}
  local port; port=$(free_port)
  # shellcheck disable=SC2046
  setsid nohup $CLI server --port="$port" --login \
    --mount-before-install="$(cat "$PG/site-dir"):/wordpress" \
    --wordpress-install-mode=install-from-existing-files-if-needed \
    $(mount_args) \
    > "$PG/server.log" 2>&1 &
  local pid=$!
  echo "$pid" > "$PG/server.pid"
  ps -o pgid= -p "$pid" | tr -d ' ' > "$PG/server.pgid"
  echo "$port" > "$PG/server.port"
  local i
  for i in $(seq 1 60); do
    # curl -fs, not -s: Playground serves 502s while booting and plain -s calls that ready
    if curl -fs -o /dev/null --max-time 2 "http://127.0.0.1:$port/"; then
      echo "server ready: http://127.0.0.1:$port (log: $PG/server.log)"; return 0
    fi
    sleep 2
  done
  die "server did not become ready; see $PG/server.log"
}

cmd_wp() {
  test -s "$PG/site-dir" || die "run 'bootstrap' first (no $PG/site-dir)"
  [ "${1:-}" = "--" ] && shift
  [ "$#" -gt 0 ] || die "usage: playground.sh wp -- <wp-cli args>"
  if [ ! -s "$PHAR" ]; then
    curl -sL -o "$PHAR" https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar
  fi
  # NOTE: never read siteurl from this site's DB — Playground stores a junk ephemeral port
  # and overrides the URL at serve time. Use $PG/server.port for the real local URL.
  # shellcheck disable=SC2046
  $CLI php \
    --mount-before-install="$(cat "$PG/site-dir"):/wordpress" \
    --wordpress-install-mode=install-from-existing-files-if-needed \
    --mount="$PG:/host" \
    $(mount_args) \
    -- /host/wp-cli.phar "$@"
}

cmd_stop() {
  [ -f "$PG/server.pgid" ] || { echo "no recorded server"; return 0; }
  local port=""; [ -f "$PG/server.port" ] && port=$(cat "$PG/server.port")
  kill -TERM -- "-$(cat "$PG/server.pgid")" 2>/dev/null || \
    kill "$(cat "$PG/server.pid")" 2>/dev/null || true
  sleep 2
  # assertions, not cleanup: stop fails loudly if anything survives
  if [ -n "$port" ] && curl -fs -o /dev/null --max-time 2 "http://127.0.0.1:$port/" 2>/dev/null; then
    die "ASSERT FAILED: server still answering on port $port"
  fi
  # [d] trick: pattern can't match this script's own process line
  if pgrep -f "wp-playgroun[d].*${port}" >/dev/null 2>&1; then
    die "ASSERT FAILED: playground process still owns port $port"
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
