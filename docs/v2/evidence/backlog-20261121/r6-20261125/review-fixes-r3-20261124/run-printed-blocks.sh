#!/usr/bin/env bash
# REHEARSAL ONLY (workstation Git Bash), R6 r3 (24 Nov 2026) and r4 (27 Nov 2026). Runs one amendment's printed blocks VERBATIM
# from the runbook as committed at <review-commit> (each block cut out by position: the Nth ```bash block after that amendment's
# heading), with the helper scripts that block 1 archives from the tested commit it pins:
#   block 1 archive (workstation)          -> run here, verbatim
#   block 2 transfer to streamanator       -> run here, verbatim
#   block 3 transfer to production         -> NOT run (production is out of scope)
#   block 4 staging, block 5 re-check      -> run here (Git Bash) verbatim, and on streamanator verbatim inside disposable
#                                             containers of the pinned Linux image with --network none (rehearse-<tag>.sh)
# Tag (third argument, default r3) selects the amendment heading, the archive path /tmp/afldb-r6-20261125-<tag>.tar, the staging
# root pattern /tmp/afldb-r6-20261125-<tag>.XXXXXX, the harness directory (review-fixes-r3-20261124 | review-fixes-r4-20261127),
# the container runner in it (rehearse-r3.sh | rehearse-r4.sh, same CLI and CASE-RESULT contract), the fixture export list and
# the result lines "R6 <tag> ...". See set_tag. For every tag the runbook as cut at the review commit is also shipped to the run
# directory as blocks/runbook.md; for r4 the release RUNBOOK.md at the review commit as blocks/release-runbook.md.
# Ownership: this run has its own id RID, a private workstation directory (mktemp) and a private streamanator directory
# /tmp/r6reh.<RID>.XXXXXX (mktemp). Containers are named r6reh-<RID>-<n> and labelled r6reh.run=<RID>; only those are removed.
# The staging root block 4 creates on the workstation is removed by its exact printed path. No wildcard.
# The only fixed paths it touches are the two the printed blocks name: the archive path on the workstation and on streamanator.
# Rule for both (review finding 5, 27 Nov 2026): this run may remove an archive path only if THIS RUN CREATED IT by an atomic
# exclusive create that succeeded; "the file exists" or "the bytes equal mine" never confers ownership (two runs of one revision
# write identical bytes).
#   workstation: ws_reserve creates the path itself under noclobber (O_EXCL) holding a one-line marker that names RID, BEFORE
#     block 1. Only the run whose create succeeded goes on; every other run is REFUSED (exit 2) and touches no archive, staging root or host (it has only made its own output directory). Printed block
#     1 then runs verbatim: `git archive --output=<path>` opens that path with O_TRUNC and writes the archive into the file this
#     run reserved (it never runs in a run that lost). ws_release removes the path only while it is still that same file
#     (device:inode) holding this run's marker, this run's archive bytes, or what this run's own failed or interrupted block 1
#     left in it; anything else is left and reported.
#   streamanator: printed block 2's own `set -C; cat > <path>` is the exclusive create. This run owns the remote path only if
#     block 2 exited 0; then the bytes must equal what this run sent. A block 2 that fails (the path existed: another run or an
#     operator; or the transfer broke) confers nothing: the run STOPs, leaves the remote path untouched and says so. Cleanup
#     removes the remote path only when owned, same file and same bytes.
# Exit: 0 only when every step and case has its expected result; 1 otherwise (any unexpected step, including a negative case that
# passes, a lost collision on streamanator, or anything this run created that survives cleanup); 2 = refused to start (including
# the losing side of a workstation collision). R6_REH_SABOTAGE=<case> is passed to the containers (driver self-test).
# R6_REH_LIB_ONLY=1 (fixtures only): when this file is SOURCED, define the functions and return without doing anything, so a
# fixture can call the real reservation, ownership and cleanup functions on paths inside its own directory (it then sets TAR,
# RTAR and rsh itself). When the file is EXECUTED with that variable set it refuses with exit 2: the seam cannot produce a run.
# Usage (from the tested commit): bash <(git -C /d/dev/afldb show <tested>:<this path>) <review-commit> <output dir> [r3|r4]
set -uo pipefail; export LC_ALL=C
REPO=/d/dev/afldb
RBP=docs/v2/evidence/backlog-20261121/ATTENDED-PLAN-R6-20261125.md
RELRB=docs/v2/evidence/release-17822b29-20261124/RUNBOOK.md
SSH=(C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes -i C:/Users/stuar/.ssh/afldb_dev arm@10.0.40.100)
RID=$(date -u +%Y%m%dT%H%M%SZ)-$$-$RANDOM
BAD=0; STEPS=0; WS=; RUN=; STAGE_WS=; TARSUM=
TRY_TAR=0; OWN_TAR=0; TAR_STATE=none; TAR_ID=; TRY_RTAR=0; OWN_RTAR=0; RTAR_ID=
TAG=; HEADING=; H=; REH=; TAR=; RTAR=; FIXPATHS=()

set_tag() { # r3|r4 -> everything that differs between the amendments; anything else is refused
  local e=docs/v2/evidence b=docs/v2/evidence/backlog-20261121
  case $1 in
    r3) HEADING='## Amendment — 24 November 2026 (r3)'; H=$b/r6-20261125/review-fixes-r3-20261124
        FIXPATHS=(deploy/release.mjs deploy/server-cluster.mjs deploy/afldb-settle-failure-status.sh deploy/host-policy
          deploy/Caddyfile.production tools/build/env-in-standalone.mjs tools/maintenance/scheduled-backup.sh
          $e/release-17822b29-20261124/rehearsal/stub-server.cjs $e/release-17822b29-20261124/rehearsal/make-release.mjs
          $b/r6-20261125/review-fixes-20261123/orig-r6-pre-verify-58e35ce8.sh "$H") ;;
    r4) HEADING='## Amendment — 27 November 2026 (r4)'; H=$b/r6-20261125/review-fixes-r4-20261127
        FIXPATHS=(deploy tools/build/env-in-standalone.mjs tools/maintenance/scheduled-backup.sh tests/deploy-release.test.ts
          $e/release-17822b29-20261124/scripts $e/release-17822b29-20261124/rehearsal $e/release-17822b29-20261124/RUNBOOK.md $e/release-17822b29-20261124/SITTING-20261124.md
          $b/a1a2-20261124 $b/r6-20261125/review-fixes-20261123/orig-r6-pre-verify-58e35ce8.sh $b/r6-20261125/review-fixes-20261123/run-printed-blocks.sh $b/r6-20261125/review-fixes-20261123/rehearse-r6-fixes.sh
          $b/r6-20261125/review-fixes-r3-20261124 $b/r6-20261125/review-fixes-r5-20261127 $b/r6-20261125/review-fixes-r6-20261128 "$H") ;;
    *) return 1 ;;
  esac
  TAG=$1; REH=rehearse-$TAG.sh; TAR=/tmp/afldb-r6-20261125-$TAG.tar; RTAR=$TAR
}
# One remote command on streamanator. MSYS_NO_PATHCONV: Git Bash rewrites a separate argument that starts with / (for example
# /tmp/...) into a Windows path before ssh.exe sees it; the first rehearsal of this driver lost its cleanup that way (README §5).
rsh() { MSYS_NO_PATHCONV=1 "${SSH[@]}" "$@"; }
step() { # label expected(0|nonzero) actual-rc
  STEPS=$((STEPS+1))
  if { [ "$2" = 0 ] && [ "$3" = 0 ]; } || { [ "$2" = nonzero ] && [ "$3" != 0 ]; }; then echo "   STEP OK $1 (expected exit $2, got $3)"
  else echo "   STEP UNEXPECTED $1 (expected exit $2, got $3)"; BAD=$((BAD+1)); fi; }
blk() { HEADING=$HEADING awk -v n="$1" 'index($0, ENVIRON["HEADING"]) == 1 {on=1} on && /^```bash$/ {k++; if (k == n) {p=1; next}} p && /^```$/ {exit} p' "$2"; }
snip() { awk '/\[ -d "\$STAGE" \] && \[ ! -L "\$STAGE" \]/ {p=1} p {sub(/^ +/, ""); print} p && /sha256sum -c R6-SHA256SUMS\)/ {exit}' "$1"; }

# ---- archive ownership (finding 5). Every function takes the path as an argument; state is this process's own variables.
arch_marker() { printf 'R6-REH-RESERVED by rehearsal run %s; not an archive\n' "$RID"; }
arch_ident() { stat -c '%d:%i' -- "$1" 2>/dev/null; }
arch_sum() { sha256sum < "$1" 2>/dev/null | cut -c1-64; }
ws_is_marker() { [ -f "$1" ] && [ ! -L "$1" ] && [ "$(arch_sum "$1")" = "$(arch_marker | sha256sum | cut -c1-64)" ]; }
ws_reserve() { # <path>: atomic exclusive create of the path itself. Ownership is set ONLY when this call's create succeeded.
  [ "$OWN_TAR" = 0 ] && [ "$TRY_TAR" = 0 ] || return 1
  TRY_TAR=1
  ( set -C; arch_marker > "$1" ) 2>/dev/null || return 1
  OWN_TAR=1; TAR_STATE=reserved; TAR_ID=$(arch_ident "$1"); }
acquire_ws() { # <path>: 0 = reserved by this run; 2 = refused, nothing touched
  [ ! -e "$1" ] && [ ! -L "$1" ] || { echo "REFUSED: $1 already exists on the workstation; this run cannot own it (left untouched)"; return 2; }
  ws_reserve "$1" || { echo "REFUSED: $1 was created by another run or an operator first (collision on the workstation); this run does not own it (left untouched)"; return 2; }
  echo "   reserved $1 for this run (exclusive create; marker names run $RID)"; }
run_block1() { # <block file> <path>: printed block 1 verbatim, into the file this run reserved
  local rc
  [ "$OWN_TAR" = 1 ] && [ "$(arch_ident "$2")" = "$TAR_ID" ] && ws_is_marker "$2" \
    || { echo "   STOP $2 no longer holds this run's reservation; block 1 not run"; BAD=$((BAD+1)); return 1; }
  TAR_STATE=writing
  bash "$1"; rc=$?; step "block 1 archive" 0 $rc
  [ "$rc" = 0 ] && [ -f "$2" ] && [ ! -L "$2" ] && ! ws_is_marker "$2" && TARSUM=$(arch_sum "$2") && [ -n "$TARSUM" ] \
    || { TARSUM=; echo "   STOP block 1 did not write the archive"; return 1; }
  TAR_ID=$(arch_ident "$2"); TAR_STATE=written; echo "   archive sha256 $TARSUM"; }
run_block2() { # <block file> <remote path>: printed block 2 verbatim; the remote path is this run's ONLY if block 2 exited 0
  local rc p
  TRY_RTAR=1
  bash "$1"; rc=$?; step "block 2 transfer" 0 $rc
  [ "$rc" = 0 ] || { echo "   STOP block 2 did not create $2 on streamanator (exit $rc): the path already existed (collision: another run or an operator) or the transfer failed; this run does not own it and leaves it untouched"; return 1; }
  OWN_RTAR=1
  p=$(rsh "stat -c %d:%i -- $2 && sha256sum < $2 | cut -c1-64")
  RTAR_ID=$(sed -n 1p <<< "$p"); p=$(sed -n 2p <<< "$p")
  [ "$p" = "$TARSUM" ] && echo "   streamanator $2 = $p (same bytes; created by this run's block 2)"
  step "transferred bytes equal" 0 "$([ -n "$p" ] && [ "$p" = "$TARSUM" ]; echo $?)"
  [ -n "$p" ] && [ "$p" = "$TARSUM" ]; }
ws_release() { # <path>: remove the workstation archive path only if this run created it and it is still this run's; 0 = nothing of this run left there
  if [ "$OWN_TAR" != 1 ]; then
    # interrupted inside ws_reserve after the create: a marker naming this run's RID can only be this run's
    if [ "$TRY_TAR" = 1 ] && ws_is_marker "$1"; then rm -f -- "$1" && echo "   removed $1 (workstation; this run's reservation marker)"; [ ! -e "$1" ]; return; fi
    [ "$TRY_TAR" != 1 ] || echo "   not removing $1 (workstation): this run did not create it"
    return 0
  fi
  if [ -e "$1" ] || [ -L "$1" ]; then
    if [ -f "$1" ] && [ ! -L "$1" ] && [ "$(arch_ident "$1")" = "$TAR_ID" ]; then
      case $TAR_STATE in
        reserved) ws_is_marker "$1" && rm -f -- "$1" && echo "   removed $1 (workstation; this run's reservation marker, block 1 never wrote it)" ;;
        writing) rm -f -- "$1" && echo "   removed $1 (workstation; the file this run reserved, as its own failed or interrupted block 1 left it)" ;;
        written) [ "$(arch_sum "$1")" = "$TARSUM" ] && rm -f -- "$1" && echo "   removed $1 (workstation; this run reserved and wrote it; same file, bytes unchanged)" ;;
      esac
    fi
  fi
  [ ! -e "$1" ] && [ ! -L "$1" ] || { echo "   LEFT $1 on the workstation: reserved by this run but no longer the file or bytes this run wrote"; return 1; }
  OWN_TAR=0; TAR_STATE=none; }
remote_cleanup_text() { cat <<'REMOTE'
set -u; R=$1; RID=$2; OWN=$3; SUM=$4; TAR=$5; ID=$6; TRIED=$7; bad=0
if [ "$R" != none ]; then
  if [[ $R == /tmp/r6reh."$RID".* ]] && [[ ${R#/tmp/r6reh."$RID".} =~ ^[A-Za-z0-9]+$ ]] && [ -d "$R" ] && [ ! -L "$R" ] && [ -O "$R" ]; then
    rm -rf -- "$R" && echo "   removed $R (this run's private directory)"
  fi
  [ ! -e "$R" ] || { echo "   LEFT $R on streamanator"; bad=1; }
fi
if [ "$OWN" = 1 ]; then
  if [ -f "$TAR" ] && [ ! -L "$TAR" ] && [ "$(sha256sum < "$TAR" 2>/dev/null | cut -c1-64)" = "$SUM" ] \
    && { [ "$ID" = none ] || [ "$(stat -c %d:%i -- "$TAR" 2>/dev/null)" = "$ID" ]; }; then
    rm -f -- "$TAR" && echo "   removed $TAR on streamanator (created by this run's block 2; same file, bytes unchanged)"
  fi
  if [ -e "$TAR" ] || [ -L "$TAR" ]; then echo "   LEFT $TAR on streamanator: created by this run but no longer the file or bytes this run sent"; bad=1; fi
elif [ "$TRIED" = 1 ]; then echo "   not removing $TAR on streamanator: this run did not create it (its block 2 failed)"; fi
ids=$(docker ps -aq --filter "label=r6reh.run=$RID"); [ -z "$ids" ] || docker rm -f $ids >/dev/null
n=$(docker ps -aq --filter "label=r6reh.run=$RID" | wc -l); echo "   containers labelled r6reh.run=$RID left: $n"; [ "$n" = 0 ] || bad=1
exit $bad
REMOTE
}
cleanup() { # returns nonzero if anything this run created is still there afterwards (then the run is a FAIL)
  local left=0
  echo "-- cleanup (only what run $RID created)"
  if [ -n "$RUN" ] || [ "$TRY_RTAR" = 1 ]; then
    rsh bash -s -- "${RUN:-none}" "$RID" "$OWN_RTAR" "${TARSUM:-none}" "$RTAR" "${RTAR_ID:-none}" "$TRY_RTAR" < <(remote_cleanup_text) || left=$((left+1))
  fi
  if [ -n "$STAGE_WS" ] && [[ $STAGE_WS =~ ^/tmp/afldb-r6-20261125-$TAG\.[A-Za-z0-9]{6}$ ]] && [ -d "$STAGE_WS" ]; then rm -rf -- "$STAGE_WS" && echo "   removed $STAGE_WS (workstation staging root printed by block 4 in this run)"; fi
  [ -z "$STAGE_WS" ] || [ ! -e "$STAGE_WS" ] || { echo "   LEFT $STAGE_WS"; left=$((left+1)); }
  ws_release "$TAR" || left=$((left+1))
  [ -n "$WS" ] && [ -d "$WS" ] && rm -rf -- "$WS" && echo "   removed $WS"
  [ -z "$WS" ] || [ ! -e "$WS" ] || { echo "   LEFT $WS"; left=$((left+1)); }
  RUN=; STAGE_WS=; WS=; TRY_TAR=0; TRY_RTAR=0; OWN_RTAR=0
  [ "$left" = 0 ]
}
arm_trap() { trap 'cleanup; exit 1' INT TERM; }

main() {
  local REVIEW=${1:?review commit} OUT=${2:?output dir} TESTED rc i
  set_tag "${3:-r3}" || { echo "REFUSED: unknown tag '${3:-}' (r3 or r4); nothing was created"; exit 2; }
  arm_trap
  mkdir -p "$OUT" || exit 2
  echo "== R6 $TAG printed blocks $(date -u +%FT%TZ) run=$RID workstation=$(hostname) review=$REVIEW"
  [ ! -e "$TAR" ] && [ ! -L "$TAR" ] || { echo "REFUSED: $TAR already exists on the workstation; this run cannot own it (left untouched)"; exit 2; }
  rsh "test ! -e $RTAR && test ! -L $RTAR" || { echo "REFUSED: $RTAR already exists on streamanator (or ssh failed); left untouched"; exit 2; }
  acquire_ws "$TAR" || exit 2
  WS=$(mktemp -d "/tmp/r6reh-ws.$RID.XXXXXX") || { WS=; cleanup; exit 2; }
  git -C "$REPO" show "$REVIEW:$RBP" > "$WS/runbook.md" || { echo "STOP no runbook at $REVIEW"; cleanup; exit 2; }
  echo "   runbook at $REVIEW: sha256 $(sha256sum < "$WS/runbook.md" | cut -c1-64)"
  for i in 1 2 3 4 5; do blk $i "$WS/runbook.md" > "$WS/block$i.sh"; cp "$WS/block$i.sh" "$OUT/block$i.sh"; echo "   block $i: $(wc -l < "$WS/block$i.sh") lines, sha256 $(sha256sum < "$WS/block$i.sh" | cut -c1-64)"; done
  TESTED=$(sed -n 's/^CODE=\([0-9a-f]\{40\}\)$/\1/p' "$WS/block1.sh")
  [ -n "$TESTED" ] && git -C "$REPO" merge-base --is-ancestor "$TESTED" "$REVIEW" || { echo "STOP block 1 pins no tested commit that $REVIEW contains"; cleanup; exit 2; }
  grep -qF -- "--output=$TAR " "$WS/block1.sh" && grep -qF -- "cat > $RTAR'" "$WS/block2.sh" \
    || { echo "STOP blocks 1 and 2 do not name $TAR, the path this run reserved"; cleanup; exit 2; }
  echo "   tested commit (block 1 CODE) $TESTED; review commit $(git -C "$REPO" rev-parse "$REVIEW")"
  echo "   tree difference tested..review (paths):"; git -C "$REPO" diff --stat=200 "$TESTED" "$REVIEW" | sed 's/^/     /'
  [ -s "$WS/block4.sh" ] && [ "$(snip "$WS/block4.sh")" = "$(snip "$WS/block5.sh")" ] && [ -n "$(snip "$WS/block5.sh")" ] \
    && { echo "   the verification lines of block 4 and block 5 are identical ($(snip "$WS/block5.sh" | wc -l) lines, sha256 $(snip "$WS/block5.sh" | sha256sum | cut -c1-64))"; STEPS=$((STEPS+1)); } \
    || { echo "   STEP UNEXPECTED blocks 4 and 5 do not share identical verification lines"; BAD=$((BAD+1)); }

  echo "-- block 1 (archive), verbatim, workstation"
  run_block1 "$WS/block1.sh" "$TAR" || { cleanup; echo "R6 $TAG REHEARSAL RESULT FAIL (block 1; stopped)"; exit 1; }
  echo "-- block 4 (staging), verbatim, workstation (Git Bash)"
  bash "$WS/block4.sh" > "$WS/stage-ws.out" 2>&1; rc=$?; sed 's/^/     | /' "$WS/stage-ws.out"; step "block 4 staging on the workstation" 0 $rc
  STAGE_WS=$(sed -n "s/^R6 STAGE VERIFIED \(\/tmp\/afldb-r6-20261125-$TAG\.[A-Za-z0-9]\{6\}\) ([0-9]* files)\$/\1/p" "$WS/stage-ws.out")
  echo "-- block 5 (re-check), verbatim, workstation, against that root"
  STAGE=$STAGE_WS bash "$WS/block5.sh" 2>&1 | sed 's/^/     | /'; step "block 5 re-check on the workstation" 0 "${PIPESTATUS[0]}"
  echo "-- block 2 (transfer to streamanator), verbatim"
  run_block2 "$WS/block2.sh" "$RTAR" || { cleanup; echo "R6 $TAG REHEARSAL RESULT FAIL (block 2; stopped)"; exit 1; }

  echo "-- streamanator: private run directory, the archive copy, the blocks and a clean export of $TESTED"
  RUN=$(rsh "umask 077; mktemp -d /tmp/r6reh.$RID.XXXXXX") && [[ $RUN =~ ^/tmp/r6reh\.$RID\.[A-Za-z0-9]+$ ]] || { echo "STOP no run directory"; RUN=; cleanup; exit 1; }
  echo "   run directory $RUN"
  git -C "$REPO" archive --format=tar --prefix=fix/ "$TESTED" "${FIXPATHS[@]}" > "$WS/fixture.tar" || { echo "STOP fixture export"; cleanup; exit 1; }
  echo "   fixture export of $TESTED: sha256 $(sha256sum < "$WS/fixture.tar" | cut -c1-64)"
  mkdir -p "$WS/blocks" && cp "$WS/block4.sh" "$WS/block5.sh" "$WS/runbook.md" "$WS/blocks/"
  if [ "$TAG" != r3 ]; then git -C "$REPO" show "$REVIEW:$RELRB" > "$WS/blocks/release-runbook.md" || { echo "STOP no release runbook at $REVIEW"; cleanup; exit 1; }
    echo "   release runbook at $REVIEW: sha256 $(sha256sum < "$WS/blocks/release-runbook.md" | cut -c1-64)"; fi
  tar -cf "$WS/blocks.tar" -C "$WS" blocks
  rsh "set -e; cd '$RUN'; mkdir -m 700 src; cp $RTAR src/archive.tar; tar -xf -" < "$WS/blocks.tar"; step "copy blocks and archive to the run directory" 0 $?
  rsh "set -e; cd '$RUN'; tar -xf -" < "$WS/fixture.tar"; step "fixture export to the run directory" 0 $?

  echo "-- streamanator: printed-block cases and the suites in disposable containers (one connection)"
  rsh "R6_REH_SABOTAGE='${R6_REH_SABOTAGE:-}' bash '$RUN/fix/$H/$REH' '$RUN' '$RID'" 2>&1 | tee "$OUT/containers.out"; rc=${PIPESTATUS[0]}
  step "container rehearsal (every case as expected)" 0 $rc
  echo "   case results: $(grep -c 'CASE-RESULT .* OK' "$OUT/containers.out") OK, $(grep -c 'CASE-RESULT .* UNEXPECTED' "$OUT/containers.out") UNEXPECTED"
  grep 'CASE-RESULT .* UNEXPECTED' "$OUT/containers.out" | sed 's/^ */   /'

  cleanup; step "cleanup removed everything this run created, and only that" 0 $?
  echo "== done $(date -u +%FT%TZ): $STEPS steps, $BAD unexpected"
  [ "$BAD" = 0 ] && echo "R6 $TAG REHEARSAL RESULT PASS" || { echo "R6 $TAG REHEARSAL RESULT FAIL ($BAD unexpected)"; exit 1; }
}
if [ "${R6_REH_LIB_ONLY:-}" = 1 ]; then
  if [ "${BASH_SOURCE[0]}" != "$0" ]; then return 0; fi
  echo "REFUSED: R6_REH_LIB_ONLY=1 is for sourcing by a fixture; an executed driver with it set does nothing"; exit 2
fi
main "$@"
