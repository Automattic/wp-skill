#!/usr/bin/env bash
# wpcom-backup.sh — backup manifest for destructive remote operations (minimal, round-4 draft).
#
# Channel split (PLAN.md, review-3 M3): SSH-channel ops (Business/Commerce) get a full backup;
# MCP/REST-channel ops (Free/Personal/Premium have no SSH/wp-cli) get a content-level backup of
# the posts the operation touches. Destructive recipes call `verify` and refuse to run unless
# every artifact the manifest points at is non-empty — a bare path satisfiable by `touch` is not
# a backup (review-3 M3).
#
#   wpcom-backup.sh ssh    <user@host> <remote-wp-path> <out-dir> [changed-path ...]
#   wpcom-backup.sh rest   <site-base-url> <out-dir> [post-id ...]     # default: all posts+pages
#   wpcom-backup.sh verify <manifest-path>
#
# AUTH for rest mode: set CURL_AUTH to extra curl args, e.g.
#   CURL_AUTH='--user admin:app-password'   (WP.com: an application password)
#   CURL_AUTH='-c jar -b jar'               (local Playground: session cookie)
#
# Status 2026-06-11: `rest` and `verify` dry-run against a local Playground site (this is the
# runnable local half). `ssh` mode is UNVERIFIED — requires a Business-plan site (Phase 1.5).
set -euo pipefail

die() { echo "wpcom-backup.sh: $*" >&2; exit 1; }
ts() { date -u +%Y%m%dT%H%M%SZ; }

write_manifest() { # $1=path $2=target $3=db/content export $4=files archive $5=copy location
  {
    echo "target=$2"
    echo "timestamp=$(ts)"
    echo "db_export=$3"
    echo "files_archive=$4"
    echo "copy_location=$5"
  } > "$1"
  echo "manifest: $1"
}

cmd_ssh() {
  local target="$1" wp_path="$2" out="$3"; shift 3
  mkdir -p "$out"
  local t; t=$(ts)
  local db="$out/db-$t.sql.gz" files="$out/files-$t.tar.gz"
  # UNVERIFIED below Business-plan SSH access exists; commands follow wp.com SSH conventions
  ssh "$target" "cd '$wp_path' && wp db export - | gzip" > "$db"
  if [ "$#" -gt 0 ]; then
    ssh "$target" "cd '$wp_path' && tar czf - $(printf "'%s' " "$@")" > "$files"
  else
    files="none"
  fi
  write_manifest "$out/manifest-$t.txt" "$target" "$db" "$files" "$out"
  cmd_verify "$out/manifest-$t.txt"
}

cmd_rest() {
  local base="$1" out="$2"; shift 2
  mkdir -p "$out"
  local t; t=$(ts)
  local db="$out/content-$t.json"
  # shellcheck disable=SC2086
  if [ "$#" -gt 0 ]; then
    local id; { echo '['; local first=1
    for id in "$@"; do
      [ "$first" = 1 ] || echo ','
      first=0
      curl -fsL ${CURL_AUTH:-} "$base/wp-json/wp/v2/posts/$id?context=edit" \
        || curl -fsL ${CURL_AUTH:-} "$base/wp-json/wp/v2/pages/$id?context=edit" \
        || die "could not export post/page $id"
    done; echo ']'; } > "$db"
  else
    # context=edit (raw content) needs real auth (WP.com: application password). Cookie-only
    # auth gets 401 on context=edit (verified locally 2026-06-11) — fall back to rendered
    # content with a loud warning rather than fail the backup entirely.
    if ! { curl -fsL ${CURL_AUTH:-} "$base/wp-json/wp/v2/posts?per_page=100&context=edit" \
        && curl -fsL ${CURL_AUTH:-} "$base/wp-json/wp/v2/pages?per_page=100&context=edit"; } > "$db" 2>/dev/null; then
      echo "WARNING: context=edit denied — exporting RENDERED content (no raw block markup)." >&2
      echo "WARNING: for a restorable backup, use an application password (context=edit)." >&2
      { curl -fsL ${CURL_AUTH:-} "$base/wp-json/wp/v2/posts?per_page=100" \
        && curl -fsL ${CURL_AUTH:-} "$base/wp-json/wp/v2/pages?per_page=100"; } > "$db" \
        || die "REST export failed (check CURL_AUTH and that $base/wp-json answers)"
    fi
  fi
  write_manifest "$out/manifest-$t.txt" "$base" "$db" "none" "$out"
  cmd_verify "$out/manifest-$t.txt"
}

cmd_verify() {
  local m="$1"
  [ -s "$m" ] || die "manifest missing or empty: $m"
  local k v missing=0
  for k in target timestamp db_export copy_location; do
    grep -q "^$k=" "$m" || die "manifest lacks field: $k"
  done
  while IFS='=' read -r k v; do
    case "$k" in
      db_export|files_archive)
        [ "$v" = "none" ] && continue
        if ! [ -s "$v" ]; then echo "EMPTY OR MISSING ARTIFACT: $k=$v" >&2; missing=1; fi;;
    esac
  done < "$m"
  [ "$missing" = 0 ] || die "verify FAILED — do not run destructive operations"
  echo "verify OK: all artifacts non-empty"
}

case "${1:-}" in
  ssh)    shift; cmd_ssh "$@";;
  rest)   shift; cmd_rest "$@";;
  verify) shift; cmd_verify "$@";;
  *) sed -n '2,18p' "$0"; exit 1;;
esac
