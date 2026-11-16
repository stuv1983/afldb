#!/usr/bin/env bash
# P10 (page checks) and P11 (observation) cases. Extra substitution for P11 only: "sleep 600" -> "sleep 0" (tick spacing).
source "$(dirname "$0")/lib.sh"
SET=${1:?orig|a1}; B=$H/blocks-$SET; RAW=$H/raw-$SET; FX=$H/fixtures
ensure_origin
cp "$H/stubs/curl" "$H/stubs/curl.keep" 2>/dev/null || true
addstubs() { cp "$H/stubs/curl" "$HT/bin/curl"; chmod +x "$HT/bin/curl"; }
mkpaths() { printf '%s\n' "${@}" > "$HT/paths.txt"; }
# psql reads the P10 SQL from stdin (no -f): serve $STUB_P10_ROWS
sed -i 's|^f=$|f=; if ! printf "%s\\n" "$@" \| grep -qx -- -f; then cat > /dev/null; cat "$STUB_P10_ROWS"; exit 0; fi|' "$H/stubs/psql"
# node -e (cookie mint) -> fixed cookie text
grep -q 'STUB-COOKIE' "$H/stubs/node" || sed -i '4a if [ "${1:-}" = -e ]; then printf "afldb_beta=STUB-COOKIE.sig"; exit 0; fi' "$H/stubs/node"
NEWP='<td>Not yet awarded</td><span>The season is still in progress; the Brownlow Medal has not been awarded</span>'
OLDP='<td>No medal</td><span>No Brownlow Medal was awarded for this season</span>'
printf '%s\n' 'cand|scott-pendlebury-11724|pending|0' 'cand|a-b-9235|pending|0' 'cand|c-d-9910|pending|0' 'cand|e-f-10130|pending|0' 'debut|g-h-13001|pending|0' > "$FX/p10-rows4.txt"
printf '%s\n' 'cand|scott-pendlebury-11724|pending|0' 'cand|a-b-9235|pending|3' 'cand|c-d-9910|pending|1' 'debut|g-h-13001|pending|0' > "$FX/p10-rows-few.txt"
echo "$NEWP" > "$FX/page-new.html"; echo "$OLDP" > "$FX/page-old.html"

newcase p10-after-pass; addstubs; export STUB_P10_ROWS=$FX/p10-rows4.txt STUB_PAGE_BODY=$FX/page-new.html; run "$B/p10-s9b-pages.sh" after
expect "after: new text on all samples" 'P10 RESULT after PASS \(64 samples\)'
expect "selection order Pendlebury first + debutant last" 'selected: scott-pendlebury-11724 a-b-9235 c-d-9910 g-h-13001'
expect "cookie never printed" 'P10 RESULT' 'STUB-COOKIE'
newcase p10-after-stale; addstubs; export STUB_P10_ROWS=$FX/p10-rows4.txt STUB_PAGE_BODY=$FX/page-old.html; run "$B/p10-s9b-pages.sh" after
expect "after with old text: 64 not as expected" 'P10 RESULT after: 64 sample\(s\) not as expected'
newcase p10-baseline-pass; addstubs; export STUB_P10_ROWS=$FX/p10-rows4.txt STUB_PAGE_BODY=$FX/page-old.html; run "$B/p10-s9b-pages.sh" baseline
expect "baseline: old text" 'P10 RESULT baseline PASS'
newcase p10-few-eligible; addstubs; export STUB_P10_ROWS=$FX/p10-rows-few.txt STUB_PAGE_BODY=$FX/page-new.html; run "$B/p10-s9b-pages.sh" after
expect "fewer than 4 eligible: STOP before any request" 'STOP line' 'P10 RESULT'
newcase p10-http-500; addstubs; export STUB_P10_ROWS=$FX/p10-rows4.txt STUB_PAGE_BODY=$FX/page-new.html STUB_CODE=500; run "$B/p10-s9b-pages.sh" after
expect "HTTP 500 counted" 'P10 RESULT after: 64 sample' 'after PASS'
unset STUB_P10_ROWS STUB_PAGE_BODY STUB_CODE

NEW=a2e6ea9995a4-TESTid_01
p11run() { mkdir -p "$HT/src"; sed "s/sleep 600/sleep 0/" "$B/p11-s10-observe.sh" > "$HT/src/p11-s10-observe.sh"; run "$HT/src/p11-s10-observe.sh" "$@"; }
newcase p11-ok; addstubs; export STUB_PAGE_BODY=$FX/page-new.html; p11run "$NEW" scott-pendlebury-11724
expect "4 ticks OK" 'P11 RESULT OBSERVATION PASS \(4 ticks\)'
newcase p11-health-bad; addstubs; export STUB_PAGE_BODY=$FX/page-new.html STUB_HEALTH='{"status":"degraded","database":"down"}'; p11run "$NEW" scott-pendlebury-11724
expect "bad health: 4 ticks not OK" 'P11 RESULT 4 tick\(s\) not OK'
newcase p11-bad-player; addstubs; p11run "$NEW" '../etc'
expect "malformed player path refused" 'STOP line' 'tick 0'
unset STUB_PAGE_BODY STUB_HEALTH
echo "== p10/p11 totals: $(grep -cE '^PASS  p1[01]' "$RAW/SUMMARY.txt") PASS, $(grep -cE '^FAIL  p1[01]' "$RAW/SUMMARY.txt") FAIL" | tee -a "$RAW/SUMMARY.txt"
