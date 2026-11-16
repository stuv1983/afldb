#!/usr/bin/env bash
# Builds harness fixtures from the published rehearsal evidence (run6r/rehearsal/raw) with the production identity substituted.
set -euo pipefail
R=${1:?run6r dir}; F=${2:?fixtures dir}; mkdir -p "$F"
ID='identity|afldb_prod|66668|7674454702926115004'
sed "1s/.*/$ID/" "$R/rehearsal/raw/exact-accept-before.txt" > "$F/accept-before.txt"
sed "1s/.*/$ID/" "$R/rehearsal/raw/exact-accept-after.txt"  > "$F/accept-after.txt"
sed 's/^na_cov|0|12$/na_cov|1|12/' "$F/accept-before.txt" > "$F/accept-before-drift.txt"
grep -v '^fp_' "$F/accept-before.txt" > "$F/accept-before-noH.txt"
sed -n '33,36p' "$R/rehearsal/raw/rehearsal.txt" > "$F/dry-pass.txt"
sed 's/"fpOtherSeasons":"097fd0b35e770ad7aac79b678f582f16"/"fpOtherSeasons":"ffffffffffffffffffffffffffffffff"/' "$F/dry-pass.txt" > "$F/dry-fpdrift.txt"
sed -n '40,43p' "$R/rehearsal/raw/rehearsal.txt" > "$F/out-committed.txt"
head -n 3 "$F/out-committed.txt" > "$F/out-none.txt"
{ head -n 3 "$F/out-committed.txt"; echo 'OUTCOME COMMIT-UNKNOWN Connection terminated unexpectedly'; } > "$F/out-unknown.txt"
sed -n '55,57p' "$R/rehearsal/raw/rehearsal.txt" > "$F/out-already.txt"
echo 'OUTCOME REFUSED identity or session mismatch: {"db":"x"}' > "$F/out-refused.txt"
{ head -n 1 "$F/out-committed.txt"; echo 'OUTCOME ERROR canceling statement due to lock timeout'; } > "$F/out-error.txt"
printf '%s\n' 'release: admission ok' 'release: smoke /players 200' 'release: RELEASE READY a2e6ea9995a4-TESTid_01 (1234 files, manifest abcdef012345…) at /x/releases/a2e6ea9995a4-TESTid_01' > "$F/build-ready.txt"
grep -c . "$F"/*.txt
