#!/usr/bin/env bash
# Experiment batch 1 (serial; never two experiments on the checkout at once).
set -u -o pipefail
W=/mnt/ssd/afldb-rem4-coleman276-20261115
CAND=$W/cand
B4=7cfbe186e70ca91db67da1aa4e28325ccbc32a86
A=tests/integration/awards-reload-links.test.ts
I=tests/integration/settle-afl-api-issue276.test.ts
cd "$CAND" || exit 1
echo "##### exp1 start $(date -u +%T) HEAD=$(git rev-parse HEAD)"

echo "##### (a) B4 awards test, SHARED mode (sequential single-file invocations on one fresh copy), both bases"
git show "$B4:$A" > tests/integration/zz-b4-awards-reload-links.test.ts
bash "$W/seq.sh" b4awsh_rb rb tests/integration/zz-b4-awards-reload-links.test.ts
bash "$W/seq.sh" b4awsh_sn sn tests/integration/zz-b4-awards-reload-links.test.ts
rm -f tests/integration/zz-b4-awards-reload-links.test.ts

echo "##### (b) new tests, SHARED mode, both bases, both file orders"
bash "$W/seq.sh" newsh_rb rb $I $A
bash "$W/seq.sh" newsh_sn sn $A $I

echo "##### (c) mutations"
bash "$W/mutexp.sh" keep2026 rb
bash "$W/mutexp.sh" keep2026 sn
bash "$W/mutexp.sh" loader-no2026-old sn
bash "$W/mutexp.sh" loader-no2026 sn
bash "$W/mutexp.sh" loader-no2026-old rb
bash "$W/mutexp.sh" loader-no2026 rb
bash "$W/mutexp.sh" fin-code-old rb
bash "$W/mutexp.sh" fin-code rb
bash "$W/mutexp.sh" fin-played-old rb
bash "$W/mutexp.sh" fin-played rb
echo "##### exp1 done $(date -u +%T) porcelain=$(git status --porcelain | wc -l)"
git status --porcelain
