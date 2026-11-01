#!/bin/bash
# V2-GAP-006 repair-tool rollout (7b4c609b): static delta check. Read-only: Git object reads only, no network, no writes.
#
#   bash static-delta-check.sh <R>
#
# R is the approved package commit (40 hex). The same check runs in two places from the same pinned bytes:
#   workstation, before the push:  bash docs/v2/evidence/gap006-repair-rollout-20261101/static-delta-check.sh "$R"
#   production, after the fetch:   git show "$R:docs/v2/evidence/gap006-repair-rollout-20261101/static-delta-check.sh" | bash -s -- "$R"
# Every check is enforced. A missing object is a FAIL (never an empty, passing diff). Exit status 0 only if every
# check passed; the last line says PASS or FAIL.
set -u
R=${1:-}
PROD_HEAD=9b9c6b2acda28e4d222c04a951275bdf654da74f   # last recorded production checkout
B=0596f0e054eb3ae714291efe535db4755b2de763           # candidate base (GAP-006 closure commit)
FIX=7b4c609bb07e0d5154d36bcae492263bb8b12d1b         # the repair-tool fix
ORIGIN_MAIN=2d1d0a834f62a0bb5dda4c08e109e5d1bfe72b51 # origin/main before the push
TOOL=tools/current-season/repair-match-rekeys.ts
BLOB_OLD=a2de99e0fb6c73cce00e409915871a66503f3c2b    # TOOL at PROD_HEAD
BLOB_NEW=dca00bd85d2eed909d0a042ebdba35e9602f6605    # TOOL at FIX, B and R
SHA_NEW=3eaf23c58fe38fab9375da86f669c564ca7544be3b50d079c9862046e93417db   # sha256 of TOOL at R (LF bytes)
T1=tests/afl-api-settle-cli-gate.test.ts
T2=tests/v2-season-seal.test.ts
DOCS_ONLY=(':!docs' ':!CHANGELOG.md' ':!IssuesIndex.md' ':!issues.md')
fails=0
ok()  { echo "  ok    $*"; }
bad() { echo "  FAIL  $*"; fails=$((fails + 1)); }

[[ $R =~ ^[0-9a-f]{40}$ ]] || { echo "usage: bash static-delta-check.sh <R: 40 lowercase hex>"; echo "STATIC DELTA CHECK FAIL"; exit 2; }
git rev-parse --git-dir > /dev/null 2>&1 || { echo "not inside a git repository"; echo "STATIC DELTA CHECK FAIL"; exit 2; }
echo "repair-tool rollout static delta check: R=$R in $(pwd)"

for pair in "R:$R" "B:$B" "FIX:$FIX" "PROD_HEAD:$PROD_HEAD" "ORIGIN_MAIN:$ORIGIN_MAIN"; do
  if git cat-file -e "${pair#*:}^{commit}" 2> /dev/null; then ok "commit object ${pair%%:*} ${pair#*:}"; else bad "commit object ${pair%%:*} ${pair#*:} is absent"; fi
done
[ "$fails" -eq 0 ] || { echo "STATIC DELTA CHECK FAIL ($fails failed; objects missing, nothing further is meaningful)"; exit 1; }

anc() { git merge-base --is-ancestor "$1" "$2" && ok "$3" || bad "$4"; }
anc "$PROD_HEAD" "$FIX" "production checkout 9b9c6b2a is an ancestor of the fix 7b4c609b" "production checkout is not an ancestor of the fix"
anc "$FIX" "$B" "fix 7b4c609b is an ancestor of the base 0596f0e0" "fix is not an ancestor of the base"
anc "$B" "$R" "base 0596f0e0 is an ancestor of R" "base is not an ancestor of R"
anc "$PROD_HEAD" "$R" "production checkout is an ancestor of R (the production update is a fast-forward)" "production checkout is not an ancestor of R"
anc "$ORIGIN_MAIN" "$R" "origin/main 2d1d0a83 is an ancestor of R (the push is a fast-forward)" "origin/main 2d1d0a83 is not an ancestor of R"

# empty(<label> <git diff args...>): passes only if git succeeds AND prints no path.
empty() {
  local label=$1 out; shift
  out=$(git diff --name-only --no-renames "$@") || { bad "$label: git diff failed"; return; }
  if [ -z "$out" ]; then ok "$label: empty"; else bad "$label: not empty:"; echo "$out" | sed 's/^/          /'; fi
}
# exactly(<label> <expected, newline-joined> <git diff args...>): the changed-path list must equal the expectation.
exactly() {
  local label=$1 want=$2 out; shift 2
  out=$(git diff --name-only --no-renames "$@") || { bad "$label: git diff failed"; return; }
  if [ "$out" = "$want" ]; then ok "$label: exactly as expected"; else bad "$label: differs; got:"; echo "$out" | sed 's/^/          /'; fi
}

empty "base 0596f0e0..R outside docs/CHANGELOG.md/IssuesIndex.md/issues.md" "$B" "$R" -- . "${DOCS_ONLY[@]}"
exactly "production checkout..R outside docs/CHANGELOG.md/IssuesIndex.md/issues.md/tests is ONLY the repair tool" "$TOOL" "$PROD_HEAD" "$R" -- . "${DOCS_ONLY[@]}" ':!tests'
exactly "production checkout..R inside tests is only the two accepted test files" "$T1
$T2" "$PROD_HEAD" "$R" -- tests
empty "production checkout..R on src, packages, deploy, data, dependencies, lockfile, framework and TypeScript config" "$PROD_HEAD" "$R" -- src packages deploy data package.json package-lock.json next.config.ts tsconfig.json
empty "production checkout..R on tools other than the repair tool" "$PROD_HEAD" "$R" -- tools ":!$TOOL"
empty "production checkout..R on migrations, scripts, public, .gitignore, .gitattributes" "$PROD_HEAD" "$R" -- src/db/migrations scripts public .gitignore .gitattributes

for p in "$TOOL"; do
  [ "$(git rev-parse "$PROD_HEAD:$p" 2> /dev/null)" = "$BLOB_OLD" ] && ok "TOOL blob at production checkout is $BLOB_OLD" || bad "TOOL blob at production checkout is not $BLOB_OLD"
  [ "$(git rev-parse "$R:$p" 2> /dev/null)" = "$BLOB_NEW" ] && ok "TOOL blob at R is $BLOB_NEW" || bad "TOOL blob at R is not $BLOB_NEW"
  [ "$(git rev-parse "$FIX:$p" 2> /dev/null)" = "$BLOB_NEW" ] && ok "TOOL blob at the fix 7b4c609b is the same blob" || bad "TOOL blob at the fix differs from R"
done
sha=$(git show "$R:$TOOL" 2> /dev/null | sha256sum | cut -d' ' -f1)
[ "$sha" = "$SHA_NEW" ] && ok "TOOL sha256 at R is $SHA_NEW" || bad "TOOL sha256 at R is $sha, expected $SHA_NEW"

# The accepted focused tests apply to the same bytes: identical blobs at the fix and at R.
for p in "$T1" "$T2" "$TOOL"; do
  [ "$(git rev-parse "$FIX:$p" 2> /dev/null)" = "$(git rev-parse "$R:$p" 2> /dev/null)" ] && ok "$p identical at the fix 7b4c609b and at R (accepted test evidence applies)" || bad "$p differs between the fix and R"
done

# The imported dependency of the guard is byte-identical at the production checkout and at R.
for p in tools/current-season/settle-season-seal.ts packages/domain/src/season-seal.ts packages/domain/src/index.ts data/reference/seasons.json; do
  a=$(git rev-parse "$PROD_HEAD:$p" 2> /dev/null); b=$(git rev-parse "$R:$p" 2> /dev/null)
  if [ -n "$a" ] && [ "$a" = "$b" ]; then ok "dependency $p unchanged ($a)"; else bad "dependency $p differs or is absent ($a vs $b)"; fi
done

# The executable change is exactly the import and one guarded call (6 added lines, 0 removed).
[ "$(git diff --numstat "$PROD_HEAD" "$R" -- "$TOOL" | tr '\t' ' ')" = "6 0 $TOOL" ] && ok "TOOL numstat is 6 added / 0 removed" || bad "TOOL numstat is not 6 added / 0 removed"
added=$(git diff -U0 "$PROD_HEAD" "$R" -- "$TOOL" | grep -E '^\+[^+]' || true)
echo "$added" | grep -Fxq "+import { refuseSealedSeasonForSettle } from './settle-season-seal';" && ok "added line: the import" || bad "the import line is absent from the added lines"
echo "$added" | grep -Fxq "+  if (args.apply) refuseSealedSeasonForSettle(projectRoot, args.season);" && ok "added line: the guarded call" || bad "the guarded call is absent from the added lines"
[ "$(echo "$added" | grep -vE '^\+\s*//' | wc -l | tr -d ' ')" = 2 ] && ok "the other 4 added lines are comments" || bad "added lines other than the import and the call are not all comments"

# The guard sits before any database client or DSN read (static order in the blob at R).
src=$(git show "$R:$TOOL" 2> /dev/null)
g=$(echo "$src" | grep -n 'if (args.apply) refuseSealedSeasonForSettle(projectRoot, args.season);' | head -n1 | cut -d: -f1)
d=$(echo "$src" | grep -n 'process.env.AFLDB_IMPORT_DATABASE_URL' | head -n1 | cut -d: -f1)
c=$(echo "$src" | grep -n 'postgres(dsn' | head -n1 | cut -d: -f1)
if [ -n "$g" ] && [ -n "$d" ] && [ -n "$c" ] && [ "$g" -lt "$d" ] && [ "$g" -lt "$c" ]; then ok "guard at line $g precedes the DSN read (line $d) and the client constructor (line $c)"; else bad "guard ($g) does not precede the DSN read ($d) and client constructor ($c)"; fi
[ "$(echo "$src" | grep -c 'refuseSealedSeasonForSettle(projectRoot')" = 1 ] && ok "exactly one guarded call" || bad "not exactly one guarded call"

if [ "$fails" -eq 0 ]; then echo "STATIC DELTA CHECK PASS (R=$R)"; exit 0; fi
echo "STATIC DELTA CHECK FAIL ($fails failed)"; exit 1
