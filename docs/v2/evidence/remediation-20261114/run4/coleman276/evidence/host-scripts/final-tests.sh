#!/usr/bin/env bash
# FINAL test matrix from the committed checkout. Serial. Usage: bash final-tests.sh
set -u -o pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
W=/mnt/ssd/afldb-rem4-coleman276-20261115
CAND=$W/cand
B4=7cfbe186e70ca91db67da1aa4e28325ccbc32a86
A=tests/integration/awards-reload-links.test.ts
I=tests/integration/settle-afl-api-issue276.test.ts
cd "$CAND" || exit 1
echo "##### final start $(date -u +%T) HEAD=$(git rev-parse HEAD) porcelain=$(git status --porcelain | wc -l)"
echo "frozen diff vs B4 (bytes; 0 = byte-identical): $(git diff $B4 -- data/reference/coleman-derivation.json tests/coleman-derivation.test.ts | wc -c)"
for b in rb sn; do
  echo "##### per-file(all) $b: $A"; HEADN=40 bash "$W/run.sh" fin_aw_$b $b all $A 2>&1 | grep -E "^label=|vitest rc| Tests |Test Files|FAIL|Error:" | cut -c1-200
  echo "##### per-file(all) $b: $I"; HEADN=40 bash "$W/run.sh" fin_i276_$b $b all $I 2>&1 | grep -E "^label=|vitest rc| Tests |Test Files|FAIL|Error:" | cut -c1-200
done
echo "##### shared rb: $I then $A"; bash "$W/seq.sh" fin_sh_rb rb $I $A 2>&1 | cut -c1-220
echo "##### shared sn: $A then $I"; bash "$W/seq.sh" fin_sh_sn sn $A $I 2>&1 | cut -c1-220
echo "##### shared sn: $I alone (cleanup proof for the finals season)"; bash "$W/seq.sh" fin_leak_sn sn $I 2>&1 | cut -c1-220
echo "##### shared rb: $I alone (cleanup proof for the finals season)"; bash "$W/seq.sh" fin_leak_rb rb $I 2>&1 | cut -c1-220
echo "##### v2-coleman-publication on its schema-only base"
bash "$W/cole.sh" fin_cole_all all 2>&1 | cut -c1-200
bash "$W/cole.sh" fin_cole_sh shared 2>&1 | cut -c1-200
echo "##### final done $(date -u +%T) HEAD=$(git rev-parse HEAD) porcelain=$(git status --porcelain | wc -l)"
git status --porcelain
