#!/bin/bash
# ISSUE-316 C4b gate fix: static delta check for the checkout-only rollout. Read-only: Git object reads only, no network, no writes.
#
#   bash static-delta-check.sh <N>
#
# N is the approved pinned package commit (40 hex). The same check runs in two places from the same pinned bytes:
#   workstation, before the push:  bash docs/v2/evidence/c4b-fix-r2-20261102/static-delta-check.sh "$N"
#   production, after the fetch:   git show "$N:docs/v2/evidence/c4b-fix-r2-20261102/static-delta-check.sh" | bash -s -- "$N"
# Every check is enforced. A missing object is a FAIL (never an empty, passing diff). Exit status 0 only if every
# check passed; the last line says PASS or FAIL.
set -u
N=${1:-}
PROD_HEAD=ea98a35f20610e75c18e698bc0d9fe084c3c783d   # the production checkout during the first C4b run (R of D-316-13); also origin/main today
FIX=b08c83070d4a08bdb3bd492983abf2acb1b10547         # the gate fix F (the only commit that changes executable or test files)
ORIGIN_MAIN=ea98a35f20610e75c18e698bc0d9fe084c3c783d # origin/main before the push (equal to PROD_HEAD)
REH=tools/current-season/afl-api-c4b-rehearsal.ts
SET=tools/current-season/settle-afl-api.ts
E2E=tools/v2/c4b-isolated-e2e.mts
TST=tests/afl-api-cutover.test.ts
REH_OLD=e3ac29268507b8db89ca99f125a58abd065e0ff2;  REH_NEW=cdf76a6744d9d6734fcfaf8bf93aba7ff258fa53
SET_OLD=c8d53c6ffbd4296f6dc7a3ffbbf2adc07a28d969;  SET_NEW=c97f0cdcd24865307c5d1b4b9786f201cf235ac2
E2E_OLD=4e73363da7c1f58e655af0a0b7988219ad3f7038;  E2E_NEW=61b3791ba6295506fc1aaf6ba7d98c084c21b197
TST_OLD=0513d8ca27dbc44e91ffcc6b2a4702d47eef1526;  TST_NEW=765c13c4c0a85a0e27ac780118f42075c45373dc
REH_SHA=e7464d5843e498863234fec9b7ad68acf886d1f8ea29a826e2f7177500036348   # sha256 of REH at N (LF bytes)
SET_SHA=06d6984848255763ebee054ed3bf7b3b832b25598029776e4b391c224a8ab77d   # sha256 of SET at N (LF bytes)
# Paths whose changes never reach an executable path: documentation, the issue ledgers, the changelog, blockers.
NONEXEC=(':!docs' ':!CHANGELOG.md' ':!IssuesIndex.md' ':!issues.md' ':!issues' ':!blockers.md')
fails=0
ok()  { echo "  ok    $*"; }
bad() { echo "  FAIL  $*"; fails=$((fails + 1)); }

[[ $N =~ ^[0-9a-f]{40}$ ]] || { echo "usage: bash static-delta-check.sh <N: 40 lowercase hex>"; echo "STATIC DELTA CHECK FAIL"; exit 2; }
git rev-parse --git-dir > /dev/null 2>&1 || { echo "not inside a git repository"; echo "STATIC DELTA CHECK FAIL"; exit 2; }
echo "C4b gate-fix rollout static delta check: N=$N in $(pwd)"

for pair in "N:$N" "FIX:$FIX" "PROD_HEAD:$PROD_HEAD" "ORIGIN_MAIN:$ORIGIN_MAIN"; do
  if git cat-file -e "${pair#*:}^{commit}" 2> /dev/null; then ok "commit object ${pair%%:*} ${pair#*:}"; else bad "commit object ${pair%%:*} ${pair#*:} is absent"; fi
done
[ "$fails" -eq 0 ] || { echo "STATIC DELTA CHECK FAIL ($fails failed; objects missing, nothing further is meaningful)"; exit 1; }

anc() { git merge-base --is-ancestor "$1" "$2" && ok "$3" || bad "$4"; }
anc "$PROD_HEAD" "$FIX" "production checkout ea98a35f is an ancestor of the fix b08c8307" "production checkout is not an ancestor of the fix"
anc "$FIX" "$N" "fix b08c8307 is an ancestor of N" "fix is not an ancestor of N"
anc "$PROD_HEAD" "$N" "production checkout is an ancestor of N (the production update is a fast-forward)" "production checkout is not an ancestor of N"
anc "$ORIGIN_MAIN" "$N" "origin/main ea98a35f is an ancestor of N (the push is a fast-forward)" "origin/main is not an ancestor of N"

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

empty "fix b08c8307..N outside documentation, ledgers, changelog (the package commits add records and scripts only)" "$FIX" "$N" -- . "${NONEXEC[@]}"
exactly "production checkout..N outside documentation/ledgers/tests is ONLY the three C4b tool files" "$REH
$SET
$E2E" "$PROD_HEAD" "$N" -- . "${NONEXEC[@]}" ':!tests'
exactly "production checkout..N inside tests is only the cutover suite" "$TST" "$PROD_HEAD" "$N" -- tests
empty "production checkout..N on src, packages, deploy, data, dependencies, lockfile, framework and TypeScript config" "$PROD_HEAD" "$N" -- src packages deploy data package.json package-lock.json next.config.ts tsconfig.json
empty "production checkout..N on tools other than the three C4b tool files" "$PROD_HEAD" "$N" -- tools ":!$REH" ":!$SET" ":!$E2E"
empty "production checkout..N on migrations, scripts, public, .gitignore, .gitattributes" "$PROD_HEAD" "$N" -- src/db/migrations scripts public .gitignore .gitattributes

blob() { # <ref> <path> <want> <label>
  [ "$(git rev-parse "$1:$2" 2> /dev/null)" = "$3" ] && ok "$4 blob is $3" || bad "$4 blob is not $3"
}
blob "$PROD_HEAD" "$REH" "$REH_OLD" "C4b tool at the production checkout"; blob "$N" "$REH" "$REH_NEW" "C4b tool at N"; blob "$FIX" "$REH" "$REH_NEW" "C4b tool at the fix"
blob "$PROD_HEAD" "$SET" "$SET_OLD" "settle tool at the production checkout"; blob "$N" "$SET" "$SET_NEW" "settle tool at N"; blob "$FIX" "$SET" "$SET_NEW" "settle tool at the fix"
blob "$PROD_HEAD" "$E2E" "$E2E_OLD" "e2e driver at the production checkout"; blob "$N" "$E2E" "$E2E_NEW" "e2e driver at N"; blob "$FIX" "$E2E" "$E2E_NEW" "e2e driver at the fix"
blob "$PROD_HEAD" "$TST" "$TST_OLD" "cutover suite at the production checkout"; blob "$N" "$TST" "$TST_NEW" "cutover suite at N"; blob "$FIX" "$TST" "$TST_NEW" "cutover suite at the fix"
for pair in "$REH:$REH_SHA" "$SET:$SET_SHA"; do
  sha=$(git show "$N:${pair%%:*}" 2> /dev/null | sha256sum | cut -d' ' -f1)
  [ "$sha" = "${pair#*:}" ] && ok "${pair%%:*} sha256 at N is ${pair#*:}" || bad "${pair%%:*} sha256 at N is $sha, expected ${pair#*:}"
done

# The runtime dependencies of the C4b tool and of the settle step are byte-identical at the production checkout and at N.
for p in src/lib/acquisition/afl-api-ingestion-control.ts src/lib/acquisition/afl-api-ingestion-safety.ts src/lib/acquisition/afltables-network.ts \
         src/lib/site-settings.ts src/lib/acquisition/settle-afl-api.ts src/lib/acquisition/settle-core.ts \
         tools/current-season/afl-api-cutover-readiness.ts tools/current-season/load-env.ts tools/current-season/acquire-afl-api.ts \
         data/reference/seasons.json data/reference/afltables-network.json; do
  a=$(git rev-parse "$PROD_HEAD:$p" 2> /dev/null); b=$(git rev-parse "$N:$p" 2> /dev/null)
  if [ -n "$a" ] && [ "$a" = "$b" ]; then ok "dependency $p unchanged ($a)"; else bad "dependency $p differs or is absent ($a vs $b)"; fi
done

# The settle tool changed by exactly one keyword and one comment line (the formatter is exported; behaviour is identical).
[ "$(git diff --numstat "$PROD_HEAD" "$N" -- "$SET" | tr '\t' ' ')" = "2 1 $SET" ] && ok "settle tool numstat is 2 added / 1 removed" || bad "settle tool numstat is not 2 added / 1 removed"
sdiff=$(git diff -U0 "$PROD_HEAD" "$N" -- "$SET" | grep -E '^[+-][^+-]' || true)
echo "$sdiff" | grep -Fxq -- "-function counterLines(counters: AflApiSettleCounters): string[] {" && ok "removed line: the unexported declaration" || bad "the unexported declaration is not the removed line"
echo "$sdiff" | grep -Fxq -- "+export function counterLines(counters: AflApiSettleCounters): string[] {" && ok "added line: the exported declaration" || bad "the exported declaration is not an added line"
[ "$(echo "$sdiff" | grep -cE '^\+/\*\* Exported so the C4b gate')" = 1 ] && ok "the other added line is the explanatory comment" || bad "the other added line is not the explanatory comment"

# The gate itself, in the blob at N: the numeric contract is consumed explicitly and the old comparison is gone.
src=$(git show "$N:$REH" 2> /dev/null)
echo "$src" | grep -Fq "else if (feed === '0') halts.push(" && ok "gate: '0' is incomplete" || bad "gate: no explicit '0' branch"
echo "$src" | grep -Fq "else if (feed !== '1') halts.push(" && ok "gate: anything other than '1' is malformed" || bad "gate: no explicit malformed branch"
echo "$src" | grep -Fq "if (feed === null) halts.push(" && ok "gate: absent evidence halts" || bad "gate: no absent-evidence branch"
echo "$src" | grep -Fq "feed !== 'true'" && bad "gate: the old comparison to the text 'true' is still present" || ok "gate: the old comparison to the text 'true' is gone"
echo "$src" | grep -Fq "value !== '0') halts.push(\`dry-run \${key} is \${value}, not 0\`)" && ok "gate: canonical inserts/updates still require exactly '0'" || bad "gate: the canonical-counter check changed"

# The real producer is numeric in the dependency we rely on (unchanged at N, checked above): complete is exactly 1.
git show "$N:src/lib/acquisition/settle-afl-api.ts" 2> /dev/null | grep -Fq "counters.seasonFeedComplete = bundle.seasonFeed.complete ? 1 : 0;" && ok "producer: seasonFeedComplete is bundle.seasonFeed.complete ? 1 : 0" || bad "producer: the numeric assignment is not found"

if [ "$fails" -eq 0 ]; then echo "STATIC DELTA CHECK PASS (N=$N)"; exit 0; fi
echo "STATIC DELTA CHECK FAIL ($fails failed)"; exit 1
