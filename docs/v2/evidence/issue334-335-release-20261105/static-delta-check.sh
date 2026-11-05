#!/bin/bash
# AFLDB-ISSUE-334/335 application release: read-only static delta check. No network, writes nothing.
#   bash static-delta-check.sh <H>        H = the head the owner pushes (R itself, or a later docs-only descendant)
# Run from the repository root. Fails (exit 1) unless ALL hold; a missing object fails rather than passing.
#   - R (qualified revision), OUT (serving release's revision), PROD (operator checkout, last recorded 2026-11-04) and H exist
#   - PROD and OUT are ancestors of R, and R of H (the push and the checkout move are fast-forwards)
#   - R to H touches only documentation: docs/, CHANGELOG.md, IssuesIndex.md, issues.md, blockers.md
#   - the code trees are byte-identical in R and H
#   - OUT to R and PROD to R are empty on migrations, dependencies, deploy, build configuration, public assets and maintenance tools
#   - OUT to R changes exactly four application source files (the ISSUE-334/335 fixes and the GAP-029 admin-draft refactor)
#   - PROD to R changes exactly the enumerated non-documentation files in prod-checkout-to-r-nondoc-files.txt (taken from H)
set -uo pipefail
H=${1:-}
R=0f251c2daa8d7c6c38eacd559376dde41e010fd9
OUT=a0b1080f5b98aee7191894c138be27bb524c7b1b
PROD=d00e07e37566e92b35a34e62a1ff03e173715e87
LIST=docs/v2/evidence/issue334-335-release-20261105/prod-checkout-to-r-nondoc-files.txt
DOCS='^(docs/|CHANGELOG\.md$|IssuesIndex\.md$|issues\.md$|blockers\.md$)'
fail() { echo "STATIC DELTA CHECK FAIL: $*"; exit 1; }
[[ $H =~ ^[0-9a-f]{40}$ ]] || fail "H must be 40 lowercase hex (got '$H')"
for c in "$R" "$OUT" "$PROD" "$H"; do git cat-file -e "$c^{commit}" 2>/dev/null || fail "commit $c is not present"; done
git merge-base --is-ancestor "$PROD" "$R" || fail "production checkout $PROD is not an ancestor of R"
git merge-base --is-ancestor "$OUT" "$R" || fail "serving revision $OUT is not an ancestor of R"
git merge-base --is-ancestor "$R" "$H" || fail "R is not an ancestor of H"
BAD=$(git diff --name-only "$R" "$H" | grep -v -E "$DOCS" || true)
[ -z "$BAD" ] || fail "R to H touches non-documentation files: $(echo "$BAD" | tr '\n' ' ')"
for t in src packages tools deploy data tests public package.json package-lock.json next.config.ts tsconfig.json; do
  [ "$(git rev-parse "$R:$t" 2>/dev/null)" = "$(git rev-parse "$H:$t" 2>/dev/null)" ] || fail "tree $t differs between R and H"
done
PROT="src/db/migrations package.json package-lock.json deploy public next.config.ts tsconfig.json tools/maintenance"
D1=$(git diff --name-only "$OUT" "$R" -- $PROT); [ -z "$D1" ] || fail "serving revision to R changes protected paths: $D1"
D2=$(git diff --name-only "$PROD" "$R" -- $PROT); [ -z "$D2" ] || fail "production checkout to R changes protected paths: $D2"
SRC=$(git diff --name-only "$OUT" "$R" -- src packages | sort | tr '\n' ' ')
WANT_SRC="src/app/admin/content/media/route.ts src/db/queries/admin-coaches.ts src/db/queries/admin-draft.ts src/db/queries/match-admin.ts "
[ "$SRC" = "$WANT_SRC" ] || fail "serving revision to R changes unexpected application source: $SRC"
GOT=$(git diff --name-only "$PROD" "$R" | grep -v -E "$DOCS" | grep -v '^issues/' | sort)
WANT=$(git show "$H:$LIST" 2>/dev/null) || fail "$LIST is not in H"
[ -n "$WANT" ] || fail "$LIST is empty"
[ "$GOT" = "$WANT" ] || fail "PROD to R non-documentation files differ from $LIST: $(diff <(echo "$WANT") <(echo "$GOT") | grep '^[<>]' | tr '\n' ' ')"
echo "STATIC DELTA CHECK PASS (H=$H; $(echo "$GOT" | wc -l) enumerated non-documentation files; 4 application source files)"
