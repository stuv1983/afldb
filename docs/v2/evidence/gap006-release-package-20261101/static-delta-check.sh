#!/bin/bash
# V2-GAP-006 editor protections: static delta check (read-only; no network, no writes).
#
#   bash static-delta-check.sh <R>
#
# R is the approved package commit (40 hex). The same check runs in two places, from the same pinned bytes:
#   workstation, before D0:   bash docs/v2/evidence/gap006-release-package-20261101/static-delta-check.sh "$R"
#   production, after fetch:  git show "$R:docs/v2/evidence/gap006-release-package-20261101/static-delta-check.sh" | bash -s -- "$R"
# Every check is enforced. A missing object is a FAIL (never an empty, passing diff). Exit status 0 only if
# every check passed; the last line says PASS or FAIL.
set -u
R=${1:-}
C=fd48ace0c2cb70296d723603aa397b5bd7a21a0d          # qualified build revision
C_TREE=01b3e6855516d22238013f58114e9f19d7ec75d7     # its tree
OLD_REV=ad245d602f6f0776c1fd86b66fef4f177fe63276    # revision of the running release (OLD_ID)
PROD_HEAD=65c02ecc29f93cec8410e01c91f4fc293002b774  # production checkout HEAD today
ORIGIN_MAIN=63c945ae4b492ec59dfd29c960783341fab96933 # origin/main before the push
GUARDED=(src/db/migrations package.json package-lock.json deploy data next.config.ts tsconfig.json tools/maintenance)
RUNTIME=(src packages tools deploy data package.json package-lock.json next.config.ts tsconfig.json)
fails=0
ok()  { echo "  ok    $*"; }
bad() { echo "  FAIL  $*"; fails=$((fails + 1)); }

[[ $R =~ ^[0-9a-f]{40}$ ]] || { echo "usage: bash static-delta-check.sh <R: 40 lowercase hex>"; echo "STATIC DELTA CHECK FAIL"; exit 2; }
git rev-parse --git-dir > /dev/null 2>&1 || { echo "not inside a git repository"; echo "STATIC DELTA CHECK FAIL"; exit 2; }
echo "static delta check: R=$R in $(pwd)"

for pair in "R:$R" "C:$C" "OLD_REV:$OLD_REV" "PROD_HEAD:$PROD_HEAD" "ORIGIN_MAIN:$ORIGIN_MAIN"; do
  if git cat-file -e "${pair#*:}^{commit}" 2> /dev/null; then ok "commit object ${pair%%:*} ${pair#*:}"; else bad "commit object ${pair%%:*} ${pair#*:} is absent"; fi
done
[ "$fails" -eq 0 ] || { echo "STATIC DELTA CHECK FAIL ($fails failed; objects missing, nothing further is meaningful)"; exit 1; }

[ "$(git rev-parse "$C^{tree}")" = "$C_TREE" ] && ok "C tree is $C_TREE" || bad "C tree differs from $C_TREE"
git merge-base --is-ancestor "$C" "$R" && ok "C is an ancestor of R" || bad "C is not an ancestor of R"
git merge-base --is-ancestor "$PROD_HEAD" "$R" && ok "production HEAD 65c02ecc is an ancestor of R (fast-forward)" || bad "production HEAD is not an ancestor of R"
git merge-base --is-ancestor "$ORIGIN_MAIN" "$R" && ok "origin/main 63c945ae is an ancestor of R (push is a fast-forward)" || bad "63c945ae is not an ancestor of R"

# empty(<label> <git diff args...>): passes only if git succeeds AND prints no path.
empty() {
  local label=$1 out; shift
  out=$(git diff --name-only "$@") || { bad "$label: git diff failed"; return; }
  if [ -z "$out" ]; then ok "$label: empty"; else bad "$label: not empty:"; echo "$out" | sed 's/^/          /'; fi
}
empty "C..R outside docs/CHANGELOG.md/IssuesIndex.md/issues.md" "$C" "$R" -- . ':!docs' ':!CHANGELOG.md' ':!IssuesIndex.md' ':!issues.md'
empty "running release ad245d60..C on migrations/deps/lockfile/deploy/data/config/tsconfig/maintenance" "$OLD_REV" "$C" -- "${GUARDED[@]}"
empty "production HEAD 65c02ecc..R on the same paths" "$PROD_HEAD" "$R" -- "${GUARDED[@]}"

for p in "${RUNTIME[@]}"; do
  git cat-file -e "$C:$p" 2> /dev/null || { ok "runtime path $p is absent from C (skipped)"; continue; }
  [ "$(git rev-parse "$C:$p")" = "$(git rev-parse "$R:$p" 2> /dev/null)" ] && ok "runtime tree $p identical in C and R" || bad "runtime tree $p differs between C and R"
done

if [ "$fails" -eq 0 ]; then echo "STATIC DELTA CHECK PASS (R=$R)"; exit 0; fi
echo "STATIC DELTA CHECK FAIL ($fails failed)"; exit 1
