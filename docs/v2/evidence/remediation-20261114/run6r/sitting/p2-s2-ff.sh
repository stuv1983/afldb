#!/usr/bin/env bash
# Packet 6R sitting, block P2 = B1-RUNBOOK S2 (fast-forward the serving checkout to C') + creation of the empty artifact directory $A.
# PRODUCTION, as arm. Writes: the checkout (ff only), and mkdir $A (mode 700). Does not touch the running site or the database.
# Run: tr -d '\r' < p2-s2-ff.sh | ssh afldb bash -s -- <STAMP>      (STAMP = UTC yyyymmddThhmmssZ chosen at the sitting)
# ADAPTATION (recorded in SITTING.md): origin/main is c34ae24d or later after the owner-approved records-only publication, so the
# runbook's "origin/main = CP" is replaced by "CP is an ancestor of origin/main and nothing executable differs between them"; the
# checkout is fast-forwarded to CP exactly, never to origin/main.
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node; export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
CHK=/home/arm/projects/afldb; ROOT=/home/arm/afldb-releases; cd "$CHK"
CP=a2e6ea9995a44b6d5b7de7e820d17bb2e14986b5; H0=c1c4b22ee15007111eab66f6d354e0b9ecbb2ade
STAMP=${1:?STAMP}; [[ $STAMP =~ ^[0-9]{8}T[0-9]{6}Z$ ]]; A=/home/arm/b1a-r6r-$STAMP
echo "== P2/S2 $(date -u +%FT%TZ)"
[ "$(git rev-parse HEAD)" = "$H0" ]; [ -z "$(git status --porcelain)" ]; echo "PASS start state c1c4b22e, clean"
git fetch origin
OM=$(git rev-parse refs/remotes/origin/main); echo "origin/main = $OM"
git merge-base --is-ancestor "$CP" "$OM"; echo "PASS CP is an ancestor of origin/main"
[ -z "$(git diff --name-only "$CP" "$OM" -- src tools deploy packages tests package.json package-lock.json next.config.ts)" ]
echo "PASS nothing executable differs CP..origin/main ($(git rev-list --count "$CP..$OM") records-only commits)"
git merge-base --is-ancestor "$H0" "$CP"; echo "PASS c1c4b22e is an ancestor of CP"
git merge --ff-only "$CP"
[ "$(git rev-parse HEAD)" = "$CP" ]; [ -z "$(git status --porcelain)" ]; echo "PASS HEAD = CP, porcelain empty"
[ -z "$(git diff --name-only "$H0" "$CP" -- src/db/migrations package-lock.json)" ]; echo "PASS no migration, no lockfile change"
"$N" deploy/release.mjs status
"$N" deploy/release.mjs check-node-modules --checkout "$CHK" || echo "RECORD check-node-modules exit=$? (owner decides; settle only warns)"
[ ! -e "$A" ]; mkdir -m 700 "$A"; echo "PASS created $A (700, empty)"
echo "P2 RESULT PASS"
}
main "$@" < /dev/null
