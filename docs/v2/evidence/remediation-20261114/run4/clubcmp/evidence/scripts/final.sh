#!/usr/bin/env bash
# final.sh <tag>: final qualification at the checked-out commit (HEAD must equal the commit under test, porcelain empty).
#   typecheck + lint:gate, then both changed files on both bases in both modes, under the heavy lock.
set -uo pipefail
source /mnt/ssd/afldb-rem4-clubcmp-20261115/in/common.sh
tag=$1
cd "$CAND"
say "final[$tag]: HEAD $(git rev-parse HEAD)"
git status --porcelain > "$EV/${tag}_porcelain.txt"
say "final[$tag]: porcelain lines $(wc -l < "$EV/${tag}_porcelain.txt")"
git ls-files -s tests/integration/club-comparison.test.ts tests/integration/database.test.ts | tee "$EV/${tag}_test-blobs.txt"
sha256sum tests/integration/club-comparison.test.ts tests/integration/database.test.ts | tee "$EV/${tag}_test-sha256.txt"
flock "$LOCK" timeout 1500 npm run typecheck > "$EV/${tag}_typecheck.log" 2>&1; say "final[$tag]: typecheck rc=$?"
flock "$LOCK" timeout 1500 npm run lint:gate > "$EV/${tag}_lint-gate.log" 2>&1; say "final[$tag]: lint:gate rc=$?"
for base in rb snap; do
  for mode in pf shared; do
    HEAVY=1 bash "$W/in/run.sh" "$base" "$mode" "${tag}_${base}_${mode}" 2400 tests/integration/database.test.ts tests/integration/club-comparison.test.ts
  done
done
say "final[$tag]: done"
touch "$EV/${tag}_done.flag"
