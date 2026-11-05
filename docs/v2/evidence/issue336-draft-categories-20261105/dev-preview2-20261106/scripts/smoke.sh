#!/usr/bin/env bash
# HTTP smoke of public routes on a loopback AFLDB app. Usage: smoke.sh <port>
# Prints: status, bytes, and whether the body carries Next's client error marker, for each route (plus Jake Long row counts for
# the AFLDB-ISSUE-337 queries). The preview ran with the beta gate off. For DEV acceptance (gate on), set BETA_COOKIE to the value
# of an `afldb_beta` cookie the owner already holds: it goes into a mode-600 cookie jar, never into argv or output.
set -u -o pipefail
umask 077
B="http://127.0.0.1:$1"
JAR=$(mktemp); trap 'rm -f "$JAR"' EXIT
[ -n "${BETA_COOKIE:-}" ] && printf '127.0.0.1\tFALSE\t/\tFALSE\t0\tafldb_beta\t%s\n' "$BETA_COOKIE" > "$JAR"
get() { curl -s -b "$JAR" "$@"; }
first() { get "$B$1" | grep -oE "href=\"$2[^\"#?]+\"" | head -1 | cut -d'"' -f2; }
P=$(first '/draft/2025?view=rookie' '/players/'); C=$(first '/clubs' '/clubs/[a-z]'); M=$(first '/seasons/2026' '/matches/')
V=$(first '/venues' '/venues/[a-z]'); R=$(first '/records' '/records/[a-z]'); CO=$(first '/coaches' '/coaches/[a-z]')
for path in /api/health / /players "$P" /clubs "$C" /clubs/compare /seasons /seasons/2026 /seasons/2027 "$M" /venues "$V" \
  /records "$R" /records/father-son /coaches "$CO" /brownlow /awards /hall-of-fame /honour-teams /grid-solver \
  /search?q=ablett /advanced-search /match-search /aflw /about /privacy /draft /draft/2014?q=Jake+Long \
  '/draft/2014?view=rookie&q=Jake+Long' '/draft/2014?view=rookie&q=Jake%C2%A0Long' /sitemap.xml /robots.txt /admin; do
  [ -z "$path" ] && { echo "SKIP (no link discovered)"; continue; }
  body=$(mktemp)
  code=$(get -o "$body" -w '%{http_code}' --max-time 60 "$B$path")
  err=$(grep -c -E 'Application error|Internal Server Error|NEXT_HTTP_ERROR_FALLBACK;500' "$body")
  jake=''; case "$path" in *Jake*) jake=" jake_rows=$(grep -o 'Pick 47' "$body" | wc -l) empty_state=$(grep -ciE 'no (selections|picks|rows|results)' "$body")";; esac
  echo "$code bytes=$(stat -c %s "$body") error_markers=$err$jake $path"
  rm -f "$body"
done
