#!/usr/bin/env bash
# Release 17822b29, block P2: fast-forward the production checkout from 7d92042f to CAND = 17822b29 EXACTLY (never to a later
# origin/main = PREP). PRODUCTION, as arm. Writes: the checkout only (git fetch + ff). The running site, the release links and the
# database are untouched; the service does not run from the checkout (P1 route check).
# Why the fast-forward: acceptance runs tools/maintenance/revalidate-season.ts (changed) and deploy/post-install-check.sh FROM THE
# CHECKOUT, and the checkout must match the serving release afterwards. Side effect, named here: the backup units, the settle units
# and Wednesday's R6 helpers run checkout files, so from now on they run the 17822b29 versions (printed at the end; P1 proved the
# backup password decoding is a no-op; R6's 14 pinned blobs are identical at 17822b29).
# STOP before any change when: origin/main != PREP; CAND not an ancestor of PREP; start HEAD not 7d92042f (or CAND on a re-run);
# not clean; the 7d92042f..CAND raw delta (206 paths, every blob) != the reviewed sha256; its non-records part (38 paths) != the
# reviewed sha256; any migration, dependency, Next config, unit or drop-in change; deploy/server-cluster.mjs at CAND != the pinned
# blob; TESTED 69538980 (Astra: READY FOR ATTENDED APPLICATION RELEASE) .. CAND touches anything but records and tests/python;
# the executable tree of CAND minus tests/python != TESTED's.
# Run: tr -d '\r' < r1-p2-ff.sh | C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes afldb bash -s -- <PREP 40 hex>
# Test seam: R1_LIB_ONLY=1 when sourced; p2_checks <checkout> <prep> runs every check and the ff in another clone.
p2_checks() { # checkout prep
  local chk=$1 PREP=$2 HEAD0 OM D TC TT
  local SERVE=7d92042fd11010eaa20966e2f49ae7a93e286568 CAND=17822b29e6de2b6248cd7ada4221800fd81e0003 TESTED=6953898083f184e9624996dc97b74884e5262250
  local DELTA=a5a86e972d9002681b8f4ae747819ec7509db42ad101b59c47cb591e5a50d628      # 7d92042f..CAND --raw, 206 paths
  local DELTA_EXEC=519f54c512bf3e2f900054fd530332e57f418a85801c03de97f4a7a61e110257 # its 38 non-records lines
  local TREE_APP=a8c3623f918ec01b913520329aa952d7e7d2b6409784ec6ed821c03af8c2ab7c   # ls-tree -r minus records and tests/python, CAND = TESTED
  local SUP_NEW=4e8ea9b5be9cda02a6d1e7251a68ab95887be9a2bf055e67ed03703d1ff81a17
  local REC='^(docs/|documentation/|issues/|[^/]+[.]md$)'
  cd "$chk"
  HEAD0=$(git rev-parse HEAD)
  [ "$HEAD0" = "$SERVE" ] || [ "$HEAD0" = "$CAND" ] || { echo "STOP start HEAD $HEAD0 is neither 7d92042f nor CAND"; return 1; }
  [ "$(git rev-parse --abbrev-ref HEAD)" = main ] || { echo "STOP not on main"; return 1; }
  [ -z "$(git status --porcelain)" ] || { echo "STOP checkout not clean"; return 1; }
  echo "PASS start state $HEAD0 on main, clean"
  git fetch origin
  OM=$(git rev-parse refs/remotes/origin/main); echo "origin/main = $OM"
  [ "$OM" = "$PREP" ] || { echo "STOP unexpected remote drift: origin/main is $OM, the approved pin is $PREP"; return 1; }
  git cat-file -e "$CAND^{commit}" && git cat-file -e "$TESTED^{commit}" || { echo "STOP CAND or TESTED missing"; return 1; }
  git merge-base --is-ancestor "$CAND" "$PREP" || { echo "STOP CAND is not an ancestor of PREP"; return 1; }; echo "PASS CAND is an ancestor of origin/main"
  git merge-base --is-ancestor "$HEAD0" "$CAND" || { echo "STOP no fast-forward"; return 1; }; echo "PASS start HEAD is an ancestor of (or equal to) CAND"
  git merge-base --is-ancestor "$TESTED" "$CAND" || { echo "STOP TESTED is not an ancestor of CAND"; return 1; }; echo "PASS tested 69538980 is an ancestor of CAND"
  D=$(git -c core.quotepath=true diff --raw --no-abbrev --no-renames "$SERVE" "$CAND")
  [ "$(printf '%s\n' "$D" | sha256sum | cut -c1-64)" = "$DELTA" ] || { echo "STOP 7d92042f..CAND raw delta differs from the reviewed $DELTA"; return 1; }
  echo "PASS 7d92042f..CAND raw delta = reviewed $DELTA ($(printf '%s\n' "$D" | wc -l) paths)"
  [ "$(printf '%s\n' "$D" | awk -F'\t' -v r="$REC" '$2 !~ r' | sha256sum | cut -c1-64)" = "$DELTA_EXEC" ] || { echo "STOP non-records delta differs"; return 1; }
  echo "PASS non-records part = reviewed $DELTA_EXEC:"; printf '%s\n' "$D" | awk -F'\t' -v r="$REC" '$2 !~ r {print "  " $2}'
  [ -z "$(git diff --name-only "$SERVE" "$CAND" -- src/db/migrations package.json package-lock.json next.config.ts deploy/afldb.service deploy/afldb.service.d)" ] \
    || { echo "STOP a migration, dependency, Next config, unit or drop-in changed"; return 1; }
  echo "PASS no migration, dependency, Next config, unit or drop-in change"
  [ "$(git cat-file blob "$CAND:deploy/server-cluster.mjs" | sha256sum | cut -c1-64)" = "$SUP_NEW" ] || { echo "STOP supervisor blob differs from $SUP_NEW"; return 1; }
  echo "PASS supervisor deploy/server-cluster.mjs at CAND = pinned $SUP_NEW (ISSUE-362 trace route class; inert while AFLDB_TRACE_REQUESTS is unset)"
  [ -z "$(git diff --name-only --no-renames "$TESTED" "$CAND" | awk -v r="$REC" '$0 !~ r && $0 !~ /^tests\/python\//')" ] || { echo "STOP TESTED..CAND touches application files"; return 1; }
  echo "PASS 69538980..CAND = records and tests/python only ($(git diff --name-only "$TESTED" "$CAND" | wc -l) paths)"
  TC=$(git ls-tree -r "$CAND" | awk -F'\t' -v r="$REC" '$2 !~ r && $2 !~ /^tests\/python\//' | sha256sum | cut -c1-64)
  TT=$(git ls-tree -r "$TESTED" | awk -F'\t' -v r="$REC" '$2 !~ r && $2 !~ /^tests\/python\//' | sha256sum | cut -c1-64)
  [ "$TC" = "$TT" ] && [ "$TC" = "$TREE_APP" ] || { echo "STOP application tree differs from the tested tree"; return 1; }
  echo "PASS application tree CAND = 69538980 = $TREE_APP"
  if [ "$HEAD0" != "$CAND" ]; then git merge --ff-only "$CAND"; else echo "NOTE start HEAD already CAND (re-run): no merge"; fi
  [ "$(git rev-parse HEAD)" = "$CAND" ] && [ -z "$(git status --porcelain)" ] || { echo "STOP HEAD or porcelain after the merge"; return 1; }
  echo "PASS HEAD = $(git rev-parse HEAD), porcelain empty"
  echo "-- checkout files run by units and acceptance (now the 17822b29 versions)"
  for f in tools/maintenance/scheduled-backup.sh tools/maintenance/backup.sh tools/maintenance/restore-test.sh tools/maintenance/revalidate-season.ts \
           src/lib/acquisition/season-revalidation.ts deploy/post-install-check.sh deploy/afldb-settle-afl-api.sh deploy/afldb-settle-failure-status.sh \
           deploy/Caddyfile.production deploy/host-policy/needrestart-afldb-hold.conf deploy/host-policy/apt-52-afldb-unattended.conf; do
    printf '  %s %s %s\n' "$(sha256sum < "$f" | cut -c1-64)" "$([ -z "$(git diff --name-only "$SERVE" "$CAND" -- "$f")" ] && echo same || echo CHANGED)" "$f"
  done
}
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node; export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
CHK=/home/arm/projects/afldb
PREP=${1:?PREP}; [[ $PREP =~ ^[0-9a-f]{40}$ ]]
echo "== R1 P2 $(date -u +%FT%TZ)"
{ [ "$(hostname)" = afldb-prod ] && [ "$(id -un)" = arm ]; } || { echo "STOP not afldb-prod as arm: refused"; exit 2; }
p2_checks "$CHK" "$PREP"
cd "$CHK"
"$N" deploy/release.mjs status
"$N" deploy/release.mjs check-node-modules --checkout "$CHK" || echo "RECORD check-node-modules exit=$? (record; not a stop: package-lock.json is unchanged)"
echo "P2 RESULT PASS"
}
if [ "${R1_LIB_ONLY:-0}" = 1 ]; then return 0 2>/dev/null || exit 0; fi
main "$@" < /dev/null
