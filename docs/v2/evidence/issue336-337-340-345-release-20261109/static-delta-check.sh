#!/bin/bash
# AFLDB-ISSUE-336/337/340/345 application release: read-only static delta check. No network, writes nothing.
#   bash static-delta-check.sh <PKG>
#   PKG = the published commit that carries this package (this script and its file list). The checkout target and the
#         build revision are both R; PKG only supplies the enumerated list, so the list is read from PKG's own bytes.
# Run from the repository root (workstation W0, or production D1 via `git show "$PKG:<this file>" | bash -s -- "$PKG"`).
# Fails (exit 1) unless ALL hold; a missing object fails rather than passing.
#   - R (qualified and built revision), OUT (serving release's revision), PROD (operator checkout, last recorded
#     2026-11-05) and PKG exist; PROD and OUT are ancestors of R, and R of PKG (every move is a fast-forward)
#   - R and PKG have byte-identical application trees (src, packages, public, migrations, dependencies, build config)
#   - OUT to R and PROD to R are empty on migrations, dependencies, public assets, build configuration and maintenance
#     tools, and change exactly two deploy/ files, both DEV-only (sync-dev); deploy/release.mjs and the rest are unchanged
#   - OUT to R changes exactly the sixteen ISSUE-336/337/340/345 application source files
#   - PROD to R changes exactly the enumerated non-documentation files in prod-checkout-to-r-nondoc-files.txt (from PKG)
set -uo pipefail
PKG=${1:-}
R=c1c4b22ee15007111eab66f6d354e0b9ecbb2ade
OUT=0f251c2daa8d7c6c38eacd559376dde41e010fd9
PROD=f32d44f07b3f81129aad4cce2feef1629a37fef1
LIST=docs/v2/evidence/issue336-337-340-345-release-20261109/prod-checkout-to-r-nondoc-files.txt
DOCS='^(docs/|CHANGELOG\.md$|IssuesIndex\.md$|issues\.md$|blockers\.md$)'
fail() { echo "STATIC DELTA CHECK FAIL: $*"; exit 1; }
[[ $PKG =~ ^[0-9a-f]{40}$ ]] || fail "PKG must be 40 lowercase hex (got '$PKG')"
for c in "$R" "$OUT" "$PROD" "$PKG"; do git cat-file -e "$c^{commit}" 2>/dev/null || fail "commit $c is not present"; done
git merge-base --is-ancestor "$PROD" "$R" || fail "production checkout $PROD is not an ancestor of R"
git merge-base --is-ancestor "$OUT" "$R" || fail "serving revision $OUT is not an ancestor of R"
git merge-base --is-ancestor "$R" "$PKG" || fail "R is not an ancestor of PKG"
for t in src packages public package.json package-lock.json next.config.ts tsconfig.json; do
  [ "$(git rev-parse "$R:$t" 2>/dev/null)" = "$(git rev-parse "$PKG:$t" 2>/dev/null)" ] || fail "application tree $t differs between R and PKG"
done
PROT="src/db/migrations package.json package-lock.json public next.config.ts tsconfig.json tools/maintenance"
D1=$(git diff --name-only "$OUT" "$R" -- $PROT); [ -z "$D1" ] || fail "serving revision to R changes protected paths: $D1"
D2=$(git diff --name-only "$PROD" "$R" -- $PROT); [ -z "$D2" ] || fail "production checkout to R changes protected paths: $D2"
WANT_DEPLOY="deploy/sync-dev-remote.sh deploy/sync-dev.ps1 "
for base in "$OUT" "$PROD"; do
  DEP=$(git diff --name-only "$base" "$R" -- deploy | LC_ALL=C sort | tr '\n' ' ')
  [ "$DEP" = "$WANT_DEPLOY" ] || fail "$base to R changes unexpected deploy/ files: $DEP"
done
SRC=$(git diff --name-only "$OUT" "$R" -- src packages | LC_ALL=C sort | tr '\n' ' ')
WANT_SRC="src/app/admin/admins/password-actions.ts src/app/admin/login/actions.ts src/app/admin/password/actions.ts src/app/draft/[year]/page.tsx src/app/draft/page.tsx src/app/players/[slug]/page.tsx src/components/DraftCategoryNav.tsx src/db/queries/admin-credentials.ts src/db/queries/draft.ts src/lib/auth/audience.ts src/lib/auth/session.ts src/lib/draft-categories.ts src/lib/like.ts src/search/grid-solver-spec.ts src/search/list-filters.ts src/styles/globals.css "
[ "$SRC" = "$WANT_SRC" ] || fail "serving revision to R changes unexpected application source: $SRC"
GOT=$(git diff --name-only "$PROD" "$R" | grep -v -E "$DOCS" | grep -v '^issues/' | LC_ALL=C sort)
WANT=$(git show "$PKG:$LIST" 2>/dev/null) || fail "$LIST is not in PKG"
[ -n "$WANT" ] || fail "$LIST is empty"
[ "$GOT" = "$WANT" ] || fail "PROD to R non-documentation files differ from $LIST: $(diff <(echo "$WANT") <(echo "$GOT") | grep '^[<>]' | tr '\n' ' ')"
echo "STATIC DELTA CHECK PASS (R=$R PKG=$PKG; $(echo "$GOT" | wc -l) enumerated non-documentation files; 16 application source files; deploy/ = 2 DEV-only files)"
