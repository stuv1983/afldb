#!/usr/bin/env bash
# R6 r4 fixture suite f4: the PRINTED F-1 command (R6 runbook, r4 amendment, section "Wednesday F-1 (r4)"), cut verbatim from
# the runbook and run for the three Tuesday outcomes. Plain user (no root); no network: `curl` is a fixture shim first on PATH
# that answers as beta.afldb.com would for ONE serving build and logs every URL asked for. Fixture records and IDs exist only
# under this suite's mktemp directory (removed on exit). Executes the REAL staged bytes of r6-tuesday-handoff.sh,
# r6-public-smoke.sh and a1a2-20261124/a1-s9-public-smoke.sh from <STAGE>.
# The runbook is $R4_RUNBOOK (the R6 runbook as committed at the review commit; the repeat driver ships it), else
# <FIX>/docs/v2/evidence/backlog-20261121/ATTENDED-PLAN-R6-20261125.md; it must contain the r4 F-1 block (else exit 2).
# Cases: released (a BUILD_ID with embedded hyphens must be probed whole), rolledback (must probe the RETAINED build, not the
# P3b build), early deferral (a record with no P3b line at all), and the STOPs: CURRENT_ID not the handoff's, a handoff STOP,
# a missing record, the serving build not answering its manifest. Contrast: the r3 F-1 row's command with BUILD_ID "from P3b"
# fails after a rollback and has no BUILD_ID after an early deferral.
# Usage: bash cases/f4-f1-manifest.sh <FIX> [<STAGE>]
main() {
  set -uo pipefail; export LC_ALL=C
  local FIX=${1:-} STAGE=${2:-${1:-}} B=docs/v2/evidence/backlog-20261121
  [ -n "$FIX" ] && [ -d "$FIX" ] && [ -d "$STAGE" ] || { echo "usage: f4-f1-manifest.sh <FIX> [<STAGE>]"; exit 2; }
  FIX=$(cd "$FIX" && pwd); STAGE=$(cd "$STAGE" && pwd)
  local RB=${R4_RUNBOOK:-$FIX/$B/ATTENDED-PLAN-R6-20261125.md}
  D=$(mktemp -d "${TMPDIR:-/tmp}/f4-f1.XXXXXX") || exit 2; trap 'rm -rf -- "$D"' EXIT
  awk '/^### Wednesday F-1 \(r4\)/ {on=1} on && /^```bash$/ {p=1; next} p && /^```$/ {exit} p' "$RB" > "$D/f1-block.sh"
  [ -s "$D/f1-block.sh" ] || { echo "STOP no r4 F-1 block in $RB"; exit 2; }
  echo "== f4 F-1 suite $(date -u +%FT%TZ) runbook sha256=$(sha256sum < "$RB" | cut -c1-64) F-1 block: $(wc -l < "$D/f1-block.sh") lines, sha256 $(sha256sum < "$D/f1-block.sh" | cut -c1-64)"
  sed 's/^/   | /' "$D/f1-block.sh"
  mkdir "$D/bin"
  cat > "$D/bin/curl" <<'SH'
#!/bin/bash
# Fixture curl: beta.afldb.com as ONE serving build ($F4_STATE/serving). Logs each URL to $F4_STATE/urls.
out=; fmt=; hdr=0; url=
while [ $# -gt 0 ]; do case $1 in
  -o) out=$2; shift 2;; -w) fmt=$2; shift 2;; -m) shift 2;; -D) hdr=1; shift 2;; -s) shift;; -*) shift;; *) url=$1; shift;; esac; done
echo "$url" >> "$F4_STATE/urls"
path=${url#https://beta.afldb.com}; code=404; loc=; body='not found'; xr=
case $path in
  /api/health) code=200; body='{"status":"ok","database":"ok"}';;
  /) code=307; loc=https://beta.afldb.com/beta; body=;;
  /players) code=307; loc='https://beta.afldb.com/beta?from=%2Fplayers'; body=;;
  /admin/operations) code=307; loc=https://beta.afldb.com/admin/login; body=;;
  /beta) code=200; body='<html>beta</html>'; xr='x-robots-tag: noindex, nofollow';;
  /_next/static/*/_buildManifest.js) b=${path#/_next/static/}; b=${b%/_buildManifest.js}
    if [ "$b" = "$(cat "$F4_STATE/serving")" ]; then code=200; body='self.__BUILD_MANIFEST={};'; fi;;
esac
[ "$hdr" = 1 ] && { printf 'HTTP/2 %s\r\n' "$code"; [ -n "$xr" ] && printf '%s\r\n' "$xr"; printf '\r\n'; }
case $out in '') printf '%s' "$body";; /dev/null) :;; *) printf '%s' "$body" > "$out";; esac
fmt=${fmt//'%{http_code}'/$code}; fmt=${fmt//'%{redirect_url}'/$loc}; printf '%s' "$fmt"
SH
  chmod 755 "$D/bin/curl"; export F4_STATE=$D/state; mkdir "$F4_STATE"
  local OLDB=XWruOm_9nLCSMY8nGPqYU OLD=7d92042fd110-XWruOm_9nLCSMY8nGPqYU NEWB=r4-fix_Build-01-x NEW SUN=342040625f6d4012a35d598dfbf9afe6
  NEW=17822b29e6de-$NEWB
  local IT=aaaaaaaaaaaaaaaaaaaaaaaaaaaa0001 IR=bbbbbbbbbbbbbbbbbbbbbbbbbbbb0002
  local P3B="P3b RESULT BUILD PASS $NEW"
  local P4P="P4 RESULT PROMOTED 2026-11-24T00:12:03Z: OWNER NOW: RESTART block (runbook section 4.2), no later than 11:35 AEDT"
  local INV5="PASS running invocation = the owner's restart $IT" P5A="P5 RESULT ACCEPT PASS (1-4)"
  local RBL="ROLLBACK RESULT LINKS SWITCHED 2026-11-24T01:05:10Z: OWNER NOW: RESTART block (runbook section 4.2)"
  local INVR="PASS running invocation = the owner's rollback restart $IR"
  local RBV="ROLLBACK RESULT VERIFIED (1-3): now r1-rawhead.sh check and S9 with XWruOm_9nLCSMY8nGPqYU"
  ho() { printf '%s\n' "R6-HANDOFF tuesday-outcome $1" "R6-HANDOFF current-id $2" "R6-HANDOFF attested-invocation $3"; }
  { echo "# REHEARSAL FIXTURE (f4): released"; printf '%s\n' "$P3B" "$P4P" "$INV5" "$P5A"; ho released "$NEW" "$IT"; } > "$D/released.md"
  { echo "# REHEARSAL FIXTURE (f4): rolled back"; printf '%s\n' "$P3B" "$P4P" "$INV5" "$P5A" "$RBL" "$INVR" "$RBV"; ho rolledback "$OLD" "$IR"; } > "$D/rolledback.md"
  { echo "# REHEARSAL FIXTURE (f4): deferred at G0, before P2: no build, so no P3b line"; echo "G0 PROD RESULT FAIL: STOP, the release is deferred, production unchanged"; ho deferred "$OLD" "$SUN"; } > "$D/deferred.md"
  { echo "# REHEARSAL FIXTURE (f4): inconsistent"; printf '%s\n' "$P5A"; ho deferred "$OLD" "$SUN"; } > "$D/bad.md"
  local N=0 BADN=0 OUT RC
  res() { N=$((N + 1)); [ "$1" = OK ] || BADN=$((BADN + 1)); echo "CASE-RESULT f4-$2 $1 ($3 ; got $4)"; }
  f1() { # serving-build record CURRENT_ID : runs the printed block verbatim in a fresh shell with the operator's variables set
    printf '%s' "$1" > "$F4_STATE/serving"; : > "$F4_STATE/urls"
    OUT=$(cd / && PATH=$D/bin:$PATH STAGE=$STAGE B=$B TUESDAY_RECORD=$2 CURRENT_ID=$3 bash "$D/f1-block.sh" 2>&1 < /dev/null); RC=$?
  }
  manifests() { grep -c '/_buildManifest\.js$' "$F4_STATE/urls"; }
  got() { echo "rc=$RC; $(grep -E '^(R6 F-1|S9 RESULT|R6 PUBLIC RESULT|STOP)' <<< "$OUT" | cut -c1-110 | tr '\n' '|'); manifest URLs: $(grep '/_buildManifest\.js$' "$F4_STATE/urls" | tr '\n' ' ')"; }
  pass() { # case serving record CURRENT_ID expected-build
    f1 "$2" "$3" "$4"
    if [ "$RC" = 0 ] && grep -Fxq "R6 F-1 RESULT PASS build $5" <<< "$OUT" && grep -Fxq 'R6 PUBLIC RESULT PASS' <<< "$OUT" && grep -Fxq 'S9 RESULT PASS' <<< "$OUT" \
      && [ "$(manifests)" = 1 ] && grep -Fxq "https://beta.afldb.com/_next/static/$5/_buildManifest.js" "$F4_STATE/urls"
    then res OK "$1" "exit 0, both smokes PASS, exactly one manifest probe, of build $5" "$(got)"; else res UNEXPECTED "$1" "exit 0, one manifest probe of $5" "$(got)"; fi
  }
  stop() { # case serving record CURRENT_ID expected-request-count(0|any)
    f1 "$2" "$3" "$4"
    if [ "$RC" != 0 ] && grep -Fxq 'R6 F-1 RESULT STOP: do not continue to F-2' <<< "$OUT" && ! grep -q '^R6 F-1 RESULT PASS' <<< "$OUT" \
      && { if [ "$5" = 0 ]; then [ ! -s "$F4_STATE/urls" ]; else [ "$(manifests)" = 1 ] && grep -q 'FAIL  build-manifest: 404' <<< "$OUT"; fi; }
    then res OK "$1" "nonzero, R6 F-1 RESULT STOP$([ "$5" = 0 ] && echo ', no request made' || echo ', after the handoff build manifest answered 404')" "rc=$RC, requests $(wc -l < "$F4_STATE/urls"), manifest probes $(manifests)"
    else res UNEXPECTED "$1" "nonzero, R6 F-1 RESULT STOP" "$(got)"; fi
  }
  pass released-build-with-hyphens "$NEWB" "$D/released.md" "$NEW" "$NEWB"
  pass rolledback-probes-the-retained-build "$OLDB" "$D/rolledback.md" "$OLD" "$OLDB"
  pass early-deferral-without-p3b "$OLDB" "$D/deferred.md" "$OLD" "$OLDB"
  stop current-id-differs-from-the-handoff "$NEWB" "$D/released.md" "$OLD" 0
  stop current-id-truncated-at-a-hyphen "$NEWB" "$D/released.md" "17822b29e6de-r4" 0
  stop handoff-stops-on-an-inconsistent-record "$OLDB" "$D/bad.md" "$OLD" 0
  stop no-tuesday-record "$OLDB" "$D/absent.md" "$OLD" 0
  stop serving-build-is-not-the-handoff-build "$OLDB" "$D/released.md" "$NEW" any
  stop rollback-record-but-the-new-build-still-serves "$NEWB" "$D/rolledback.md" "$OLD" any
  # the derived value is the whole suffix after the 12-hex revision (deploy/release.mjs releaseId: <rev12>-<BUILD_ID>)
  f1 "$NEWB" "$D/released.md" "$NEW"
  if grep -Fxq "R6 F-1 BUILD_ID $NEWB (from the handoff CURRENT_ID $NEW)" <<< "$OUT"; then res OK derived-build-id-line "R6 F-1 BUILD_ID $NEWB printed" "printed"
  else res UNEXPECTED derived-build-id-line "R6 F-1 BUILD_ID $NEWB printed" "$(got)"; fi
  # contrast: the r3 row ("a1-s9-public-smoke.sh \"$BUILD_ID\"" with BUILD_ID from P3b)
  old() { printf '%s' "$1" > "$F4_STATE/serving"; : > "$F4_STATE/urls"
    OUT=$(cd / && PATH=$D/bin:$PATH BUILD_ID=$2 bash -c 'bash "$0/r6-20261125/r6-public-smoke.sh"; bash "$0/a1a2-20261124/a1-s9-public-smoke.sh" "$BUILD_ID"' "$STAGE/$B" 2>&1 < /dev/null); RC=$?; }
  old "$OLDB" "$NEWB"
  if [ "$RC" != 0 ] && grep -q 'FAIL  build-manifest: 404' <<< "$OUT"; then res OK contrast-r3-row-after-rollback "the r3 row with the P3b BUILD_ID fails after a rollback (manifest 404)" "rc=$RC, build-manifest 404"
  else res UNEXPECTED contrast-r3-row-after-rollback "the r3 row fails after a rollback" "$(got)"; fi
  old "$OLDB" ""
  if [ "$RC" != 0 ] && [ "$(manifests)" = 0 ] && grep -q 'BUILD_ID' <<< "$OUT" && grep -Fxq 'R6 PUBLIC RESULT PASS' <<< "$OUT"; then res OK contrast-r3-row-early-deferral "the r3 row has no BUILD_ID after an early deferral: no manifest probe, nonzero" "rc=$RC, manifest probes 0"
  else res UNEXPECTED contrast-r3-row-early-deferral "the r3 row cannot probe without P3b" "$(got)"; fi
  if [ "$BADN" = 0 ]; then echo "SUITE f4 RESULT PASS ($N cases)"; else echo "SUITE f4 RESULT FAIL ($BADN unexpected)"; exit 1; fi
}
main "$@" < /dev/null
