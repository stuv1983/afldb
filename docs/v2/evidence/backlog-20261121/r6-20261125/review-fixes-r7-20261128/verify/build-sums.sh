#!/usr/bin/env bash
# build-sums.sh (R6 r7, MED-2): regenerates the digests after ANY bundle change (for example when the coordinator replaces the
# FIXTURE STUB bundle/sealed-origin.sh with R7/backup/sealed-origin.sh). Workstation or Linux; needs only bash and sha256sum.
#   bash build-sums.sh          -> bundle/SHA256SUMS, the wrapper's pinned BUNDLE_SHA, and the packet SHA256SUMS (every file here)
#   bash build-sums.sh --check  -> verifies all three without writing; exit 0 only when consistent
set -uo pipefail; export LC_ALL=C
cd "$(dirname "$0")" || exit 2
CHECK=0; [ "${1:-}" = --check ] && CHECK=1
crs=$(cat bundle/* afldb-verify-call.sh install-verify.sh verify-verify-install.sh 2>/dev/null | tr -cd '\r' | wc -c)
[ "$crs" = 0 ] || { echo "STOP carriage returns in the packet files ($crs): convert to LF first"; exit 1; }
sums_bundle() { (cd bundle && for f in $(ls -A | grep -vx SHA256SUMS | sort); do printf '%s  %s\n' "$(sha256sum < "$f" | cut -c1-64)" "$f"; done); }
B=$(sums_bundle)
if [ "$CHECK" = 1 ]; then
  [ "$B" = "$(cat bundle/SHA256SUMS)" ] || { echo "FAIL bundle/SHA256SUMS is stale"; exit 1; }
else printf '%s\n' "$B" > bundle/SHA256SUMS; fi
D=$(sha256sum < bundle/SHA256SUMS | cut -c1-64)
if [ "$CHECK" = 1 ]; then
  grep -q "^BUNDLE_SHA=$D " afldb-verify-call.sh || { echo "FAIL the wrapper does not pin $D"; exit 1; }
else sed -i "s/^BUNDLE_SHA=[^ ]* /BUNDLE_SHA=$D /" afldb-verify-call.sh; fi
P=$(for f in $(find . -type f ! -name SHA256SUMS -o -type f -path './bundle/SHA256SUMS' | sed 's#^\./##' | sort); do printf '%s  %s\n' "$(sha256sum < "$f" | cut -c1-64)" "$f"; done)
if [ "$CHECK" = 1 ]; then
  [ "$P" = "$(cat SHA256SUMS)" ] || { echo "FAIL the packet SHA256SUMS is stale"; exit 1; }
  echo "PASS bundle digest $D; bundle/SHA256SUMS, wrapper pin and packet SHA256SUMS consistent"
else printf '%s\n' "$P" > SHA256SUMS; echo "bundle digest $D (pinned in afldb-verify-call.sh); wrote bundle/SHA256SUMS and SHA256SUMS"; fi
