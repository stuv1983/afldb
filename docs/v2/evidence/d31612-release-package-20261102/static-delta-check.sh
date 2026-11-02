#!/bin/bash
# D-316-12 UI release: read-only static delta check. No network, writes nothing.
#   bash static-delta-check.sh <H>        H = the head the owner pushes (R itself, or a later docs-only descendant)
# Fails (exit 1) unless ALL hold. A missing object fails rather than passing.
#   - R (the qualified revision), OUT (the outgoing release's revision), PROD (the production checkout today) and H exist
#   - PROD is an ancestor of R, OUT is an ancestor of R, R is an ancestor of H (so the push and the fast-forward are fast-forwards)
#   - R to H touches only documentation: docs/, CHANGELOG.md, IssuesIndex.md, issues.md, blockers.md
#   - the code trees are byte-identical in R and H
#   - OUT to R, and PROD to R, are empty on migrations, dependencies, deploy, data, build configuration and maintenance tools
#   - PROD to R changes exactly the ten expected non-documentation files (nothing else is smuggled in)
set -uo pipefail
H=${1:-}
R=a0b1080f5b98aee7191894c138be27bb524c7b1b
OUT=ea98a35f20610e75c18e698bc0d9fe084c3c783d
PROD=924ff273261834e4112e3f41b61ceeab55427534
fail() { echo "STATIC DELTA CHECK FAIL: $*"; exit 1; }
[[ $H =~ ^[0-9a-f]{40}$ ]] || fail "H must be 40 lowercase hex (got '$H')"
for c in "$R" "$OUT" "$PROD" "$H"; do git cat-file -e "$c^{commit}" 2>/dev/null || fail "commit $c is not present"; done
git merge-base --is-ancestor "$PROD" "$R" || fail "production checkout $PROD is not an ancestor of R"
git merge-base --is-ancestor "$OUT" "$R" || fail "outgoing revision $OUT is not an ancestor of R"
git merge-base --is-ancestor "$R" "$H" || fail "R is not an ancestor of H"
BAD=$(git diff --name-only "$R" "$H" | grep -v -E '^(docs/|CHANGELOG\.md$|IssuesIndex\.md$|issues\.md$|blockers\.md$)' || true)
[ -z "$BAD" ] || fail "R to H touches non-documentation files: $(echo "$BAD" | tr '\n' ' ')"
for t in src packages tools deploy data tests package.json package-lock.json next.config.ts tsconfig.json; do
  [ "$(git rev-parse "$R:$t" 2>/dev/null)" = "$(git rev-parse "$H:$t" 2>/dev/null)" ] || fail "tree $t differs between R and H"
done
PROT="src/db/migrations package.json package-lock.json deploy data next.config.ts tsconfig.json tools/maintenance"
D1=$(git diff --name-only "$OUT" "$R" -- $PROT); [ -z "$D1" ] || fail "outgoing revision to R changes protected paths: $D1"
D2=$(git diff --name-only "$PROD" "$R" -- $PROT); [ -z "$D2" ] || fail "production checkout to R changes protected paths: $D2"
GOT=$(git diff --name-only "$PROD" "$R" | grep -v -E '^(docs/|CHANGELOG\.md$|IssuesIndex\.md$|issues\.md$|blockers\.md$)' | sort | tr '\n' ' ')
WANT="src/app/admin/current-season/AflApiSettleUnitsPanel.tsx src/app/admin/current-season/actions.ts src/app/admin/current-season/page.tsx src/lib/acquisition/afl-api-c7-observation.ts src/lib/acquisition/settle-status.ts src/lib/acquisition/settle-trigger.ts tests/admin-current-season-settle.test.ts tests/afl-api-c7-observation.test.ts tests/integration/afl-api-c7-observation.test.ts tools/v2/c7-observe.ts "
[ "$GOT" = "$WANT" ] || fail "PROD to R changes unexpected non-documentation files: $GOT"
echo "STATIC DELTA CHECK PASS (H=$H)"
