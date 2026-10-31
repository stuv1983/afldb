#!/bin/bash
# AFLDB-ISSUE-329 post-restart identity, asset and health check. Read-only apart from two things:
# one POST, to the retired email-intake route, which must answer 410; and the `status-pass` line that
# `release.mjs status --expect` appends to <root>/events.log on a pass (Part B's preflight needs it).
#
#   bash post-install-check.sh <release-id> [<previous-BUILD_ID>]
#
# Run as arm from the serving checkout after every restart in the package (§3, §5, §6). It runs
# `release.mjs status --expect`, then checks the BUILD_ID through loopback and the public origin,
# every CSS/JS asset the key pages reference, served bytes against the release's own files, and the
# journal since the service started. Ends with POST-INSTALL CHECK PASS or FAIL. Environment
# overrides exist only so it can be rehearsed off-host.
set -u
ID=${1:-}; PREV_BUILD=${2:-}
CHECKOUT=${CHECKOUT:-/home/arm/projects/afldb}
ROOT=${ROOT:-/home/arm/afldb-releases}
UNIT=${UNIT:-afldb}
NODE=${NODE:-/home/arm/.nvm/versions/node/v22.23.2/bin/node}
LOCAL=${LOCAL:-http://127.0.0.1:3100}
PUBLIC=${PUBLIC:-https://beta.afldb.com}
PAGES=${PAGES:-/ /beta /players /matches /seasons /clubs /records /search /admin/operations}
[ -n "$ID" ] || { echo "usage: bash post-install-check.sh <release-id> [<previous-BUILD_ID>]"; exit 2; }
fails=0
ok()   { echo "  ok    $*"; }
fail() { echo "  FAIL  $*"; fails=$((fails + 1)); }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
REL=$ROOT/releases/$ID
BUILD=$(cat "$REL/.next/standalone/.next/BUILD_ID" 2>/dev/null)
echo "AFLDB-ISSUE-329 post-install check $(date -u +%FT%TZ): expect $ID (BUILD_ID ${BUILD:-?})"
[ -n "$BUILD" ] || { echo "  FAIL  no release $REL"; echo "POST-INSTALL CHECK FAIL"; exit 1; }

for i in $(seq 1 120); do
  [ "$(curl -s -o /dev/null -m 2 -w '%{http_code}' "$LOCAL/api/health")" = 200 ] && break; sleep 0.5
done
state=$(systemctl show "$UNIT" -p ActiveState --value); result=$(systemctl show "$UNIT" -p Result --value)
if [ "$state" != active ]; then
  echo "  FAIL  $UNIT is $state (Result=$result)"
  [ "$result" = start-limit-hit ] && echo "        start limit hit (5 starts in 120 s): sudo systemctl reset-failed $UNIT && sudo systemctl start $UNIT, then re-run this check"
  echo "POST-INSTALL CHECK FAIL"; exit 1
fi
echo "release route status"
(cd "$CHECKOUT" && "$NODE" deploy/release.mjs status --expect "$ID" --root "$ROOT" --unit "$UNIT" --url "$LOCAL") 2>&1 | sed 's/^/        /'
[ "${PIPESTATUS[0]}" = 0 ] && ok "status --expect $ID PASS" || fail "status --expect $ID"

echo "identity through both origins"
for base in "$LOCAL" "$PUBLIC"; do
  h=$(curl -s -m 10 "$base/api/health"); c=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$base/_next/static/$BUILD/_buildManifest.js")
  [[ $h == *'"status":"ok"'* && $h == *'"database":"ok"'* ]] && ok "$base/api/health $h" || fail "$base/api/health: $h"
  [ "$c" = 200 ] && ok "$base _buildManifest.js for $BUILD 200" || fail "$base _buildManifest.js for $BUILD answered $c"
  if [ -n "$PREV_BUILD" ] && [ "$PREV_BUILD" != "$BUILD" ]; then
    p=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$base/_next/static/$PREV_BUILD/_buildManifest.js")
    [ "$p" = 404 ] && ok "$base previous $PREV_BUILD 404" || fail "$base previous $PREV_BUILD answered $p"
  fi
done

echo "pages and every referenced asset (public origin, redirects followed)"
: > "$T/assets"
for u in $PAGES; do
  r=$(curl -s -L -m 20 -o "$T/p.html" -w '%{http_code} %{url_effective}' "$PUBLIC$u")
  [ "${r%% *}" = 200 ] && ok "page $u -> $r" || fail "page $u -> $r"
  grep -oE '/_next/static/[^"?]+\.(js|css)' "$T/p.html" >> "$T/assets"
done
sort -u "$T/assets" -o "$T/assets"; n=$(wc -l < "$T/assets"); bad=0; same=0
while read -r s; do
  r=$(curl -s -m 10 -o "$T/x" -w '%{http_code} %{content_type}' "$PUBLIC$s"); sz=$(stat -c %s "$T/x")
  case $s in *.css) want=text/css;; *) want=javascript;; esac
  if [ "${r%% *}" != 200 ] || [[ $r != *"$want"* ]] || [ "$sz" -lt 100 ]; then bad=$((bad + 1)); echo "        bad asset: $r size=$sz $s"; continue; fi
  f=$REL/.next/standalone/.next/${s#/_next/}
  [ -f "$f" ] && [ "$(sha256sum < "$f")" = "$(sha256sum < "$T/x")" ] && same=$((same + 1))
done < "$T/assets"
[ "$n" -gt 0 ] && [ "$bad" = 0 ] && ok "$n assets 200 with the right type" || fail "$n assets, $bad bad"
[ "$same" = "$n" ] && ok "all $n served assets are byte-identical to $ID's files" || fail "only $same of $n served assets match $ID's files"
e=$(curl -s -o /dev/null -m 10 -w '%{http_code}' -X POST "$PUBLIC/api/admin/email-intake")
[ "$e" = 410 ] && ok "POST /api/admin/email-intake 410 (retired)" || fail "POST /api/admin/email-intake answered $e"

echo "journal since the service started"
since=$(systemctl show "$UNIT" -p ActiveEnterTimestamp --value)
j=$(journalctl -u "$UNIT" --since "$since" -o cat --no-pager 2>/dev/null)
journal_unverified=0
if ! grep -q '\[afldb\] primary' <<< "$j"; then
  # Not an application failure: arm may lack journal access. The owner counts the lines with sudo instead.
  journal_unverified=1
  echo "  UNVERIFIED  journal unreadable for $(id -un), or no primary start line since $since. Owner, run:"
  echo "        sudo journalctl -u $UNIT --since \"$since\" -o cat | grep -E '\\[afldb\\] (primary|serving build)'"
  echo "        sudo journalctl -u $UNIT --since \"$since\" -o cat | grep -ciE 'error|fatal|unhandled'   # must print 0"
else
  ok "primary start line present since $since"
  line=$(grep '\[afldb\] serving build' <<< "$j" | tail -1)
  [ -n "$line" ] && echo "        $line" || echo "        (no identity line: this release's supervisor predates it, as expected for the adopted 9ed9c9dd)"
  [ -z "$line" ] || [[ $line == *"serving build $BUILD release $ID "* ]] || fail "identity line names another build"
  errs=$(grep -ciE 'error|fatal|unhandled' <<< "$j")
  [ "$errs" = 0 ] && ok "0 error/fatal/unhandled lines" || { fail "$errs error/fatal/unhandled lines"; grep -iE 'error|fatal|unhandled' <<< "$j" | head -5 | sed 's/^/        /'; }
fi
mem=$(systemctl show "$UNIT" -p MemoryCurrent --value); [[ $mem =~ ^[0-9]+$ ]] && mem="$((mem / 1048576)) MB"
echo "  info  NRestarts $(systemctl show "$UNIT" -p NRestarts --value), MemoryCurrent $mem"
[ $fails -eq 0 ] && [ $journal_unverified = 1 ] && { echo "POST-INSTALL CHECK PASS $ID (journal unverified: run the two sudo commands above)"; exit 0; }
[ $fails -eq 0 ] && { echo "POST-INSTALL CHECK PASS $ID"; exit 0; }
echo "POST-INSTALL CHECK FAIL ($fails)"; exit 1
