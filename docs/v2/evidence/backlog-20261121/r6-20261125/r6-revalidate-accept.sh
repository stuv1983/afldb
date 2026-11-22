#!/usr/bin/env bash
# ISSUE-351 (independent review, 22 Nov 2026): the R6 acceptance step "functional 2/2 revalidation" was only prose. This runs the
# season revalidation CLI and PASSES only on exit 0 with exactly one line
#   REVALIDATED season <Y>: 2/2 worker(s) reached (<a>,<b>) in <n> request(s).
# naming two DISTINCT worker ordinals. Failure, an INCOMPLETE line, 1/2, a repeated ordinal, "single", missing output or any other
# worker count is STOP: acceptance is not recorded and nothing is restarted as a fallback. PRODUCTION, as arm, one connection,
# from the checkout, AFTER the reboot checks. Writes nothing to files or the database; the CLI posts the existing authenticated
# loopback fan-out (the URL and secret come from .env; they are never printed and never in argv).
#   bash r6-revalidate-accept.sh [season (default 2026)] [expected worker count (default 2)]
# Test hooks (never needed in production): R6_CHECKOUT, R6_REVALIDATE_CMD (default `npx tsx tools/maintenance/revalidate-season.ts`).
set -uo pipefail; export LC_ALL=C
SEASON=${1:-2026}; EXPECT=${2:-2}
[[ $SEASON =~ ^[0-9]{4}$ && $EXPECT =~ ^[1-9]$ ]] || { echo "STOP usage: [season YYYY] [expected workers 1-9]"; exit 2; }
CHK=${R6_CHECKOUT:-/home/arm/projects/afldb}
cd "$CHK" 2>/dev/null || { echo "STOP no checkout $CHK"; exit 2; }
CMD=${R6_REVALIDATE_CMD:-npx tsx tools/maintenance/revalidate-season.ts}
out=$($CMD --season "$SEASON" 2>&1); rc=$?
printf '%s\n' "$out" | sed 's/^/     /'
echo "revalidate exit=$rc"
fail() { echo "R6 REVALIDATE RESULT STOP: $*"; exit 1; }
[ "$rc" = 0 ] || fail "the CLI exited $rc (only 0 means every worker answered)"
grep -q '^.*INCOMPLETE' <<< "$out" && fail 'an INCOMPLETE line was printed'
mapfile -t L < <(sed -n "s/^.*REVALIDATED season $SEASON: \([0-9]*\)\/\([0-9]*\) worker(s) reached (\([^)]*\)) in [0-9]* request(s)\.\$/\1 \2 \3/p" <<< "$out")
[ "${#L[@]}" = 1 ] || fail "expected exactly one REVALIDATED line for season $SEASON, found ${#L[@]}"
read -r reached total ords <<< "${L[0]}"
[ "$reached" = "$EXPECT" ] && [ "$total" = "$EXPECT" ] || fail "reached $reached of $total workers; $EXPECT of $EXPECT required"
IFS=, read -r -a O <<< "$ords"
[ "${#O[@]}" = "$EXPECT" ] || fail "worker ordinals '$ords' do not name $EXPECT workers"
for o in "${O[@]}"; do [[ $o =~ ^[1-9]$ ]] || fail "worker ordinal '$o' is not a number (a single-process answer is not 2/2)"; done
[ "$(printf '%s\n' "${O[@]}" | sort -u | wc -l)" = "$EXPECT" ] || fail "worker ordinals '$ords' are not distinct"
echo "R6 REVALIDATE RESULT PASS season $SEASON workers $ords"
