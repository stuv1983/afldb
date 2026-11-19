#!/usr/bin/env bash
# Release 7, block P2 = S2: fast-forward the serving checkout from a2e6ea99 to the candidate CAND exactly. PRODUCTION, as arm.
# Writes: the checkout (ff only). Does not touch the running site, the release links or the database.
# origin/main must be EXACTLY the approved pin PREP; CAND must be its ancestor and every CAND..PREP path must be under docs/ or one of
# the three trackers (records only). The a2e6ea99..CAND delta must be the reviewed 114-path delta (sha256 of its raw listing).
# Re-runnable: a start HEAD of CAND (an earlier P2 stopped after its fast-forward) is accepted.
# Run: tr -d '\r' < r7-p2-ff.sh | ssh afldb bash -s -- <PREP>
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node; export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
CHK=/home/arm/projects/afldb; cd "$CHK"
H0=a2e6ea9995a44b6d5b7de7e820d17bb2e14986b5; CAND=0a308e2a046b85b376f362ec18098a3eb9a31086
DELTA=d106757c44e75206c24b88ae1f949b495e1edf03a8afd118f914c91ac74183b5
PREP=${1:?PREP}; [[ $PREP =~ ^[0-9a-f]{40}$ ]]
echo "== R7 P2/S2 $(date -u +%FT%TZ)"
HEAD0=$(git rev-parse HEAD)
[ "$HEAD0" = "$H0" ] || [ "$HEAD0" = "$CAND" ] || { echo "STOP start HEAD $HEAD0 is neither a2e6ea99 nor CAND"; exit 1; }
[ "$(git rev-parse --abbrev-ref HEAD)" = main ]
[ -z "$(git status --porcelain)" ]; echo "PASS start state $HEAD0 on main, clean"
git fetch origin
OM=$(git rev-parse refs/remotes/origin/main); echo "origin/main = $OM"
[ "$OM" = "$PREP" ] || { echo "STOP unexpected remote drift: origin/main is $OM, the approved pin is $PREP"; exit 1; }
echo "PASS origin/main = approved pin $PREP"
git merge-base --is-ancestor "$CAND" "$PREP"; echo "PASS CAND is an ancestor of (or equal to) PREP"
[ -z "$(git diff --name-only --no-renames "$CAND" "$PREP" | grep -vE '^(docs/|CHANGELOG\.md$|IssuesIndex\.md$|issues\.md$)' || true)" ]
echo "PASS no CAND..PREP path outside docs/ and the three trackers ($(git diff --name-only --no-renames "$CAND" "$PREP" | wc -l) paths)"
git merge-base --is-ancestor "$H0" "$CAND"; echo "PASS a2e6ea99 is an ancestor of CAND"
[ "$(git -c core.quotepath=true diff --raw --no-abbrev --no-renames "$H0" "$CAND" | sha256sum | cut -d' ' -f1)" = "$DELTA" ]
echo "PASS a2e6ea99..CAND raw delta (114 paths, every blob) = reviewed sha256 $DELTA"
[ -z "$(git diff --name-only "$H0" "$CAND" -- src/db/migrations package.json package-lock.json next.config.ts deploy/afldb.service deploy/server-cluster.mjs)" ]
echo "PASS no migration, dependency, Next config, unit or supervisor change"
if [ "$HEAD0" = "$H0" ]; then git merge --ff-only "$CAND"; else echo "NOTE start HEAD already CAND (re-run): no merge"; fi
[ "$(git rev-parse HEAD)" = "$CAND" ]; [ -z "$(git status --porcelain)" ]; echo "PASS HEAD = CAND, porcelain empty"
"$N" deploy/release.mjs status
"$N" deploy/release.mjs check-node-modules --checkout "$CHK" || echo "RECORD check-node-modules exit=$? (owner decides; settle only warns)"
echo "P2 RESULT PASS"
}
main "$@" < /dev/null
