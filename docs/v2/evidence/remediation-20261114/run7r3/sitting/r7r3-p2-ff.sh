#!/usr/bin/env bash
# Release 7 revision 3 (R7R3), block P2 = S2: fast-forward the serving checkout to the candidate CAND exactly. PRODUCTION, as arm.
# Writes: the checkout (ff only). Does not touch the running site, the release links or the database.
# Start HEAD: a3c8c67c (left by 7R2 P2, held at P3), a2e6ea99, or CAND (re-run after a fast-forward).
# origin/main must be EXACTLY the approved pin PREP; CAND must be its ancestor and every CAND..PREP path must be under docs/, the ISSUE-370 runbook or its evidence folder, or one of
# the three trackers (records only). The a2e6ea99..CAND delta must be the reviewed 186-path delta (sha256 of its raw listing), and the
# a3c8c67c..CAND delta the reviewed 44-path delta (10 code/test paths, the rest records).
# Run: tr -d '\r' < r7r3-p2-ff.sh | ssh afldb bash -s -- <PREP>
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node; export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
CHK=/home/arm/projects/afldb; cd "$CHK"
H0=a2e6ea9995a44b6d5b7de7e820d17bb2e14986b5; H7R2=a3c8c67cc98fc35e963795e331e7217a24ccf1e0; CAND=c8d4202a4cb3cf0ccdd1cad01e1227a1610c2d76
DELTA=34987c85c84edb304a6f6335cfb6a81357f77a2ab5f1bc6a0d1a5efd2faae0dc; DELTA7R2=9778c156072d3580e41637552e9ea9c62d9d15c6659b2903eaa8d5850287c0bb
PREP=${1:?PREP}; [[ $PREP =~ ^[0-9a-f]{40}$ ]]
echo "== R7R3 P2/S2 $(date -u +%FT%TZ)"
HEAD0=$(git rev-parse HEAD)
[ "$HEAD0" = "$H7R2" ] || [ "$HEAD0" = "$H0" ] || [ "$HEAD0" = "$CAND" ] || { echo "STOP start HEAD $HEAD0 is not a3c8c67c, a2e6ea99 or CAND"; exit 1; }
[ "$(git rev-parse --abbrev-ref HEAD)" = main ]
[ -z "$(git status --porcelain)" ]; echo "PASS start state $HEAD0 on main, clean"
git fetch origin
OM=$(git rev-parse refs/remotes/origin/main); echo "origin/main = $OM"
[ "$OM" = "$PREP" ] || { echo "STOP unexpected remote drift: origin/main is $OM, the approved pin is $PREP"; exit 1; }
echo "PASS origin/main = approved pin $PREP"
git merge-base --is-ancestor "$CAND" "$PREP"; echo "PASS CAND is an ancestor of (or equal to) PREP"
[ -z "$(git diff --name-only --no-renames "$CAND" "$PREP" | grep -vE '^(docs/|CHANGELOG\.md$|IssuesIndex\.md$|issues\.md$|issues/open/AFLDB-ISSUE-370\.md$|issues/open/AFLDB-ISSUE-370-evidence/)' || true)" ]
echo "PASS no CAND..PREP path outside docs/, the three trackers and the ISSUE-370 runbook/evidence ($(git diff --name-only --no-renames "$CAND" "$PREP" | wc -l) paths)"
git merge-base --is-ancestor "$H0" "$H7R2"; git merge-base --is-ancestor "$H7R2" "$CAND"; echo "PASS a2e6ea99 -> a3c8c67c -> CAND ancestry"
[ "$(git -c core.quotepath=true diff --raw --no-abbrev --no-renames "$H0" "$CAND" | sha256sum | cut -d' ' -f1)" = "$DELTA" ]
echo "PASS a2e6ea99..CAND raw delta (186 paths, every blob) = reviewed sha256 $DELTA"
[ "$(git -c core.quotepath=true diff --raw --no-abbrev --no-renames "$H7R2" "$CAND" | sha256sum | cut -d' ' -f1)" = "$DELTA7R2" ]
echo "PASS a3c8c67c..CAND raw delta (44 paths) = reviewed sha256 $DELTA7R2"
[ -z "$(git diff --name-only "$H0" "$CAND" -- src/db/migrations package.json package-lock.json next.config.ts deploy/afldb.service deploy/server-cluster.mjs)" ]
echo "PASS no migration, dependency, Next config, unit or supervisor change"
if [ "$HEAD0" != "$CAND" ]; then git merge --ff-only "$CAND"; else echo "NOTE start HEAD already CAND (re-run): no merge"; fi
[ "$(git rev-parse HEAD)" = "$CAND" ]; [ -z "$(git status --porcelain)" ]; echo "PASS HEAD = CAND, porcelain empty"
"$N" deploy/release.mjs status
"$N" deploy/release.mjs check-node-modules --checkout "$CHK" || echo "RECORD check-node-modules exit=$? (owner decides; settle only warns)"
echo "P2 RESULT PASS"
}
main "$@" < /dev/null
