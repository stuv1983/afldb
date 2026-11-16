#!/usr/bin/env bash
# Packet 6R sitting, block P2 = B1-RUNBOOK S2 (fast-forward the serving checkout to C') + creation of the empty artifact directory $A.
# PRODUCTION, as arm. Writes: the checkout (ff only), and mkdir $A (mode 700). Does not touch the running site or the database.
# Run: tr -d '\r' < p2-s2-ff.sh | ssh afldb bash -s -- <STAMP>      (STAMP = UTC yyyymmddThhmmssZ chosen at the sitting)
# AMENDMENT A1 (owner-approved 2026-11-16, sitting-a1/AMENDMENT-A1.md): origin/main must be EXACTLY the published preparation commit
# PREP; C' must be its ancestor; the C'..PREP delta must be the reviewed 52-path delta (sha256 of its raw listing) with no path outside
# docs/ and the three trackers; any other remote state is refused. The checkout is fast-forwarded to C' exactly, never to PREP.
# Re-runnable: a start HEAD of C' (an earlier P2 stopped after its fast-forward) and an existing EMPTY $A are accepted.
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node; export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
CHK=/home/arm/projects/afldb; ROOT=/home/arm/afldb-releases; cd "$CHK"
CP=a2e6ea9995a44b6d5b7de7e820d17bb2e14986b5; H0=c1c4b22ee15007111eab66f6d354e0b9ecbb2ade
PREP=611630e41f3f27391173615d961c0ab5e1ea7810; DELTA=f449aa04346731c1b74cd1d7ca21c3117c16acf83b1598385baaebf84dc30157
STAMP=${1:?STAMP}; [[ $STAMP =~ ^[0-9]{8}T[0-9]{6}Z$ ]]; A=/home/arm/b1a-r6r-$STAMP
echo "== P2/S2 $(date -u +%FT%TZ)"
HEAD0=$(git rev-parse HEAD)
[ "$HEAD0" = "$H0" ] || [ "$HEAD0" = "$CP" ] || { echo "STOP start HEAD $HEAD0 is neither c1c4b22e nor CP"; exit 1; }
[ "$(git rev-parse --abbrev-ref HEAD)" = main ]
[ -z "$(git status --porcelain)" ]; echo "PASS start state $HEAD0 on main, clean"
git fetch origin
OM=$(git rev-parse refs/remotes/origin/main); echo "origin/main = $OM"
[ "$OM" = "$PREP" ] || { echo "STOP unexpected remote drift: origin/main is $OM, the approved preparation pin is $PREP"; exit 1; }
echo "PASS origin/main = approved preparation pin $PREP"
git merge-base --is-ancestor "$CP" "$PREP"; echo "PASS CP is an ancestor of PREP"
[ "$(git rev-list --count "$CP..$PREP")" = 4 ]; echo "PASS CP..PREP is the 4 reviewed commits"
[ "$(git -c core.quotepath=true diff --raw --no-abbrev --no-renames "$CP" "$PREP" | sha256sum | cut -d' ' -f1)" = "$DELTA" ]
echo "PASS CP..PREP raw delta (52 paths, every blob) = reviewed sha256 $DELTA"
[ -z "$(git diff --name-only --no-renames "$CP" "$PREP" | grep -vE '^(docs/|CHANGELOG\.md$|IssuesIndex\.md$|issues\.md$)' || true)" ]
echo "PASS no CP..PREP path outside docs/ and the three trackers"
git merge-base --is-ancestor "$H0" "$CP"; echo "PASS c1c4b22e is an ancestor of CP"
if [ "$HEAD0" = "$H0" ]; then git merge --ff-only "$CP"; else echo "NOTE start HEAD already CP (re-run): no merge"; fi
[ "$(git rev-parse HEAD)" = "$CP" ]; [ -z "$(git status --porcelain)" ]; echo "PASS HEAD = CP, porcelain empty"
[ -z "$(git diff --name-only "$H0" "$CP" -- src/db/migrations package-lock.json)" ]; echo "PASS no migration, no lockfile change"
if [ -e "$A" ]; then [ -d "$A" ]; [ -z "$(ls -A "$A")" ]; chmod 700 "$A"; echo "PASS $A already exists, empty (re-run)"
else mkdir -m 700 "$A"; echo "PASS created $A (700, empty)"; fi
"$N" deploy/release.mjs status
"$N" deploy/release.mjs check-node-modules --checkout "$CHK" || echo "RECORD check-node-modules exit=$? (owner decides; settle only warns)"
echo "P2 RESULT PASS"
}
main "$@" < /dev/null
