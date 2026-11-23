#!/usr/bin/env bash
# REHEARSAL ONLY (workstation Git Bash), R6 r3, 24 Nov 2026. Runs the r3 amendment's printed blocks VERBATIM from the runbook as
# committed at <review-commit> (each block cut out by position: the Nth ```bash block after the r3 heading), with the helper
# scripts that block 1 archives from the tested commit it pins:
#   block 1 archive (workstation)          -> run here, verbatim
#   block 2 transfer to streamanator       -> run here, verbatim
#   block 3 transfer to production         -> NOT run (production is out of scope)
#   block 4 staging, block 5 re-check      -> run here (Git Bash) verbatim, and on streamanator verbatim inside disposable
#                                             containers of the pinned Linux image with --network none (rehearse-r3.sh)
# Ownership (R6 r3 repeat-driver fix): this run has its own id RID, a private workstation directory (mktemp) and a private
# streamanator directory /tmp/r6reh.<RID>.XXXXXX (mktemp). The only fixed paths it touches are the two the printed blocks name,
# /tmp/afldb-r6-20261125-r3.tar on the workstation and on streamanator: it refuses to start if either exists, and at the end
# removes each only if it still holds the bytes this run wrote. The staging root block 4 creates on the workstation is removed by
# its exact printed path. Containers are named r6reh-<RID>-<n> and labelled r6reh.run=<RID>; only those are removed. No wildcard.
# Exit: 0 only when every step and case has its expected result; 1 otherwise (any unexpected step, including a negative case that
# passes); 2 = refused to start. R6_REH_SABOTAGE=<case> is passed to the containers (driver self-test).
# Usage (from the tested commit): bash <(git -C /d/dev/afldb show <tested>:<this path>) <review-commit> <output dir>
set -uo pipefail; export LC_ALL=C
REVIEW=${1:?review commit}; OUT=${2:?output dir}
REPO=/d/dev/afldb
RBP=docs/v2/evidence/backlog-20261121/ATTENDED-PLAN-R6-20261125.md
H=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r3-20261124
TAR=/tmp/afldb-r6-20261125-r3.tar
SSH=(C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes -i C:/Users/stuar/.ssh/afldb_dev arm@10.0.40.100)
RID=$(date -u +%Y%m%dT%H%M%SZ)-$$-$RANDOM
BAD=0; STEPS=0; WS=; RUN=; STAGE_WS=; TARSUM=; MADE_TAR=0; MADE_RTAR=0
step() { # label expected(0|nonzero) actual-rc
  STEPS=$((STEPS+1))
  if { [ "$2" = 0 ] && [ "$3" = 0 ]; } || { [ "$2" = nonzero ] && [ "$3" != 0 ]; }; then echo "   STEP OK $1 (expected exit $2, got $3)"
  else echo "   STEP UNEXPECTED $1 (expected exit $2, got $3)"; BAD=$((BAD+1)); fi; }
cleanup() {
  echo "-- cleanup (only what run $RID created)"
  if [ -n "$RUN" ] || [ "$MADE_RTAR" = 1 ]; then
    "${SSH[@]}" bash -s -- "${RUN:-none}" "$RID" "$MADE_RTAR" "${TARSUM:-none}" "$TAR" <<'REMOTE'
set -u; R=$1; RID=$2; MADE=$3; SUM=$4; TAR=$5
if [ "$R" != none ] && [[ $R == /tmp/r6reh."$RID".* ]] && [[ ${R#/tmp/r6reh."$RID".} =~ ^[A-Za-z0-9]+$ ]] && [ -d "$R" ] && [ ! -L "$R" ] && [ -O "$R" ]; then
  rm -rf -- "$R" && echo "   removed $R (this run's private directory)"
fi
if [ "$MADE" = 1 ] && [ "$(sha256sum < "$TAR" 2>/dev/null | cut -c1-64)" = "$SUM" ]; then rm -f -- "$TAR" && echo "   removed $TAR on streamanator (absent before this run; bytes unchanged)"
elif [ -e "$TAR" ]; then echo "   LEFT $TAR on streamanator: not provably this run's bytes"; fi
ids=$(docker ps -aq --filter "label=r6reh.run=$RID"); [ -z "$ids" ] || docker rm -f $ids >/dev/null
echo "   containers labelled r6reh.run=$RID left: $(docker ps -aq --filter "label=r6reh.run=$RID" | wc -l)"
REMOTE
  fi
  if [ -n "$STAGE_WS" ] && [[ $STAGE_WS =~ ^/tmp/afldb-r6-20261125-r3\.[A-Za-z0-9]{6}$ ]] && [ -d "$STAGE_WS" ]; then rm -rf -- "$STAGE_WS" && echo "   removed $STAGE_WS (workstation staging root printed by block 4 in this run)"; fi
  if [ "$MADE_TAR" = 1 ] && [ "$(sha256sum < "$TAR" 2>/dev/null | cut -c1-64)" = "$TARSUM" ]; then rm -f -- "$TAR" && echo "   removed $TAR (workstation; this run wrote it)"; fi
  [ -n "$WS" ] && [ -d "$WS" ] && rm -rf -- "$WS" && echo "   removed $WS"
  RUN=; STAGE_WS=; WS=; MADE_TAR=0; MADE_RTAR=0
}
trap 'cleanup; exit 1' INT TERM
mkdir -p "$OUT" || exit 2
echo "== R6 r3 printed blocks $(date -u +%FT%TZ) run=$RID workstation=$(hostname) review=$REVIEW"
[ ! -e "$TAR" ] || { echo "REFUSED: $TAR already exists on the workstation; this run cannot own it (left untouched)"; exit 2; }
"${SSH[@]}" "test ! -e $TAR" || { echo "REFUSED: $TAR already exists on streamanator (or ssh failed); left untouched"; exit 2; }
WS=$(mktemp -d "/tmp/r6reh-ws.$RID.XXXXXX") || exit 2
git -C "$REPO" show "$REVIEW:$RBP" > "$WS/runbook.md" || { echo "STOP no runbook at $REVIEW"; cleanup; exit 2; }
echo "   runbook at $REVIEW: sha256 $(sha256sum < "$WS/runbook.md" | cut -c1-64)"
blk() { awk -v n="$1" '/^## Amendment — 24 November 2026 \(r3\)/ {on=1} on && /^```bash$/ {k++; if (k == n) {p=1; next}} p && /^```$/ {exit} p' "$WS/runbook.md"; }
for i in 1 2 3 4 5; do blk $i > "$WS/block$i.sh"; cp "$WS/block$i.sh" "$OUT/block$i.sh"; echo "   block $i: $(wc -l < "$WS/block$i.sh") lines, sha256 $(sha256sum < "$WS/block$i.sh" | cut -c1-64)"; done
TESTED=$(sed -n 's/^CODE=\([0-9a-f]\{40\}\)$/\1/p' "$WS/block1.sh")
[ -n "$TESTED" ] && git -C "$REPO" merge-base --is-ancestor "$TESTED" "$REVIEW" || { echo "STOP block 1 pins no tested commit that $REVIEW contains"; cleanup; exit 2; }
echo "   tested commit (block 1 CODE) $TESTED; review commit $(git -C "$REPO" rev-parse "$REVIEW")"
echo "   tree difference tested..review (paths):"; git -C "$REPO" diff --stat=200 "$TESTED" "$REVIEW" | sed 's/^/     /'
snip() { awk '/\[ -d "\$STAGE" \] && \[ ! -L "\$STAGE" \]/ {p=1} p {sub(/^ +/, ""); print} p && /sha256sum -c R6-SHA256SUMS\)/ {exit}' "$1"; }
[ -s "$WS/block4.sh" ] && [ "$(snip "$WS/block4.sh")" = "$(snip "$WS/block5.sh")" ] && [ -n "$(snip "$WS/block5.sh")" ] \
  && { echo "   the verification lines of block 4 and block 5 are identical ($(snip "$WS/block5.sh" | wc -l) lines, sha256 $(snip "$WS/block5.sh" | sha256sum | cut -c1-64))"; STEPS=$((STEPS+1)); } \
  || { echo "   STEP UNEXPECTED blocks 4 and 5 do not share identical verification lines"; BAD=$((BAD+1)); }

echo "-- block 1 (archive), verbatim, workstation"
bash "$WS/block1.sh"; rc=$?; step "block 1 archive" 0 $rc
[ -f "$TAR" ] && MADE_TAR=1 && TARSUM=$(sha256sum < "$TAR" | cut -c1-64) && echo "   archive sha256 $TARSUM"
echo "-- block 4 (staging), verbatim, workstation (Git Bash)"
bash "$WS/block4.sh" > "$WS/stage-ws.out" 2>&1; rc=$?; sed 's/^/     | /' "$WS/stage-ws.out"; step "block 4 staging on the workstation" 0 $rc
STAGE_WS=$(sed -n 's/^R6 STAGE VERIFIED \(\/tmp\/afldb-r6-20261125-r3\.[A-Za-z0-9]\{6\}\) ([0-9]* files)$/\1/p' "$WS/stage-ws.out")
echo "-- block 5 (re-check), verbatim, workstation, against that root"
STAGE=$STAGE_WS bash "$WS/block5.sh" 2>&1 | sed 's/^/     | /'; step "block 5 re-check on the workstation" 0 "${PIPESTATUS[0]}"
echo "-- block 2 (transfer to streamanator), verbatim"
bash "$WS/block2.sh"; rc=$?; step "block 2 transfer" 0 $rc
RSUM=$("${SSH[@]}" "sha256sum < $TAR | cut -c1-64"); [ -n "$RSUM" ] && MADE_RTAR=1     # it did not exist before this run
[ "$RSUM" = "$TARSUM" ] && echo "   streamanator $TAR = $RSUM (same bytes)"; step "transferred bytes equal" 0 "$([ "$RSUM" = "$TARSUM" ]; echo $?)"

echo "-- streamanator: private run directory, the archive copy, the blocks and a clean export of $TESTED"
RUN=$("${SSH[@]}" "umask 077; mktemp -d /tmp/r6reh.$RID.XXXXXX") && [[ $RUN =~ ^/tmp/r6reh\.$RID\.[A-Za-z0-9]+$ ]] || { echo "STOP no run directory"; RUN=; cleanup; exit 1; }
echo "   run directory $RUN"
git -C "$REPO" archive --format=tar --prefix=fix/ "$TESTED" deploy/release.mjs deploy/server-cluster.mjs deploy/afldb-settle-failure-status.sh \
  deploy/host-policy deploy/Caddyfile.production tools/build/env-in-standalone.mjs tools/maintenance/scheduled-backup.sh \
  docs/v2/evidence/release-17822b29-20261124/rehearsal/stub-server.cjs docs/v2/evidence/release-17822b29-20261124/rehearsal/make-release.mjs \
  docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-20261123/orig-r6-pre-verify-58e35ce8.sh "$H" > "$WS/fixture.tar" \
  || { echo "STOP fixture export"; cleanup; exit 1; }
echo "   fixture export of $TESTED: sha256 $(sha256sum < "$WS/fixture.tar" | cut -c1-64)"
mkdir -p "$WS/blocks" && cp "$WS/block4.sh" "$WS/block5.sh" "$WS/blocks/"
tar -cf "$WS/blocks.tar" -C "$WS" blocks
"${SSH[@]}" "set -e; cd '$RUN'; mkdir -m 700 src; cp $TAR src/archive.tar; tar -xf -" < "$WS/blocks.tar"; step "copy blocks and archive to the run directory" 0 $?
"${SSH[@]}" "set -e; cd '$RUN'; tar -xf -" < "$WS/fixture.tar"; step "fixture export to the run directory" 0 $?

echo "-- streamanator: printed-block cases and the A-2/handoff/F-4 suite in disposable containers (one connection)"
"${SSH[@]}" "R6_REH_SABOTAGE='${R6_REH_SABOTAGE:-}' bash '$RUN/fix/$H/rehearse-r3.sh' '$RUN' '$RID'" 2>&1 | tee "$OUT/containers.out"; rc=${PIPESTATUS[0]}
step "container rehearsal (every case as expected)" 0 $rc
echo "   case results: $(grep -c 'CASE-RESULT .* OK' "$OUT/containers.out") OK, $(grep -c 'CASE-RESULT .* UNEXPECTED' "$OUT/containers.out") UNEXPECTED"
grep 'CASE-RESULT .* UNEXPECTED' "$OUT/containers.out" | sed 's/^ */   /'

cleanup
echo "== done $(date -u +%FT%TZ): $STEPS steps, $BAD unexpected"
[ "$BAD" = 0 ] && echo "R6 r3 REHEARSAL RESULT PASS" || { echo "R6 r3 REHEARSAL RESULT FAIL ($BAD unexpected)"; exit 1; }
