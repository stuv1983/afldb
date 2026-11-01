#!/bin/bash
# Block M static delta check: proves the revision the owner pushes (R) is the QUALIFIED tree. Reads Git objects only; changes nothing.
#   bash m-static-check.sh <R>      (workstation or production checkout; R and the two anchors must exist locally)
# Rule A: nothing outside the allowlist may differ between the qualified candidate E (full Linux set) and R. The allowlist is the
#         documentation, the tracking files and the Block L label tool/test/driver (qualified separately: label rehearsal 34/34).
# Rule B: nothing outside docs/ and root *.md may differ between T (the head whose `tsc --noEmit` ran clean on Linux) and R, so the
#         off-host type-check evidence still describes every type-checked input.
# Rule C: migration 118 and the GAP-029 evidence file equal their approved hashes at R.
set -u -o pipefail
R=${1:-}
E=e0f6c7bcb0cac46be743031de049df0c1f27b2fb
T=933eb87effcd63c909a27454738656e7516c2e15
[[ $R =~ ^[0-9a-f]{40}$ ]] || { echo "usage: bash m-static-check.sh <40-hex R>"; exit 2; }
for c in "$R" "$E" "$T"; do git cat-file -e "$c^{commit}" 2> /dev/null || { echo "FAIL commit $c not present"; exit 1; }; done
git merge-base --is-ancestor "$E" "$R" && git merge-base --is-ancestor "$T" "$R" || { echo "FAIL R does not descend from E and T"; exit 1; }
bad=0
ALLOW='^(docs/|CHANGELOG\.md$|IssuesIndex\.md$|issues\.md$|tests/v2-gap029-label-checks\.test\.ts$|tools/v2/apply-gap029-match-events-production\.ts$|tools/v2/gap029-label-checks\.ts$|tools/v2/gap029-labels-isolated-e2e\.mts$)'
a=$(git diff --name-only "$E..$R" | grep -Ev "$ALLOW"); [ -z "$a" ] || { echo "FAIL rule A: files outside the allowlist changed since the qualified candidate:"; echo "$a"; bad=1; }
b=$(git diff --name-only "$T..$R" | grep -Ev '^docs/|^[A-Za-z0-9_.-]+\.md$'); [ -z "$b" ] || { echo "FAIL rule B: type-checked inputs changed since the type-checked head:"; echo "$b"; bad=1; }
m=$(git show "$R:src/db/migrations/118_fixtures_unconfirmed_participants.sql" | sha256sum | cut -c1-64)
[ "$m" = 49e59fcd96aa62142fb2da8141f926997582ef86502b37e22c4796f004498401 ] || { echo "FAIL rule C: migration 118 sha256 $m"; bad=1; }
v=$(git show "$R:docs/v2/evidence/gap-029-match-event-correction-2026-11-01-r2.json" | tr -d '\r' | sha256sum | cut -c1-64)
[ "$v" = e3848807931cf255175c1642d9ded63590b2c7e2633b33a5e9f0fa5b96a4430f ] || { echo "FAIL rule C: GAP-029 evidence LF sha256 $v"; bad=1; }
n=$(git ls-tree -r --name-only "$R" -- src/db/migrations | tail -1)
[ "$n" = src/db/migrations/118_fixtures_unconfirmed_participants.sql ] || { echo "FAIL rule C: newest migration at R is $n"; bad=1; }
if [ "$bad" = 0 ]; then echo "STATIC CHECK PASS R=$R (A,B,C)"; exit 0; fi
exit 1
