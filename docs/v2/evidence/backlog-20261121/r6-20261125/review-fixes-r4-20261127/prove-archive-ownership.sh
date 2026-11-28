#!/usr/bin/env bash
# REHEARSAL ONLY (workstation Git Bash), R6 r4, 27 Nov 2026 (review finding 5). Runs the fixture suite cases/f5-cleanup-ownership.sh
# twice against the same exported bytes: under Git Bash on the workstation (where the driver's reservation of the archive path
# really runs) and as arm on streamanator (Linux, where printed block 2's `set -C` create and the remote cleanup really run).
# The suite is isolated: it never names a real /tmp/afldb-r6-* or /tmp/r6reh* path and contacts no host (see its header).
# Source: a commit (clean `git archive` of the five files the suite needs) or, for an uncommitted tree, a directory holding
# them at their repository paths. This wrapper creates only: <output dir> (two logs), one private workstation directory
# /tmp/r6own-ws.<RID>.XXXXXX and one private streamanator directory <parent>/r6own.<RID>.XXXXXX (mktemp; <parent> defaults to
# /tmp); it removes both by exact validated path and fails if either survives. No container, no wildcard, no production.
# Usage: bash prove-archive-ownership.sh <commit | directory> <output dir> [<existing directory on streamanator to work in>]
# Exit: 0 only when both suite runs end `SUITE f5 RESULT PASS` and nothing of this run is left; 1 otherwise; 2 = could not start.
set -uo pipefail; export LC_ALL=C
SRC=${1:?commit or directory}; OUT=${2:?output dir}; RPARENT=${3:-/tmp}
REPO=/d/dev/afldb; E=docs/v2/evidence/backlog-20261121/r6-20261125; SUITE=$E/review-fixes-r4-20261127/cases/f5-cleanup-ownership.sh
SSH=(C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes -i C:/Users/stuar/.ssh/afldb_dev arm@10.0.40.100)
PATHS=("$E/review-fixes-20261123/run-printed-blocks.sh" "$E/review-fixes-20261123/rehearse-r6-fixes.sh" "$E/review-fixes-r3-20261124/run-printed-blocks.sh"
  "$SUITE" "$E/review-fixes-r4-20261127/orig-aa33f0fc/r3-run-printed-blocks.sh")
RID=$(date -u +%Y%m%dT%H%M%SZ)-$$-$RANDOM; WS=; RUN=
rsh() { MSYS_NO_PATHCONV=1 "${SSH[@]}" "$@"; }   # Git Bash must not rewrite /tmp/... arguments (r3 README section 5)
cleanup() { local left=0
  echo "-- cleanup (only what run $RID created)"
  if [ -n "$RUN" ]; then
    rsh bash -s -- "$RUN" "$RPARENT" "$RID" <<'REMOTE' || left=$((left+1))
set -u; R=$1; P=$2; RID=$3
if [[ $R == "$P"/r6own."$RID".* ]] && [[ ${R#"$P"/r6own."$RID".} =~ ^[A-Za-z0-9]+$ ]] && [ -d "$R" ] && [ ! -L "$R" ] && [ -O "$R" ]; then rm -rf -- "$R" && echo "   removed $R (streamanator)"; fi
[ ! -e "$R" ] || { echo "   LEFT $R on streamanator"; exit 1; }
REMOTE
  fi
  [ -n "$WS" ] && [[ $WS =~ ^/tmp/r6own-ws\.$RID\.[A-Za-z0-9]+$ ]] && [ -d "$WS" ] && rm -rf -- "$WS" && echo "   removed $WS (workstation)"
  [ -z "$WS" ] || [ ! -e "$WS" ] || { echo "   LEFT $WS"; left=$((left+1)); }
  RUN=; WS=; [ "$left" = 0 ]; }
main() { local rc1 rc2 l1 l2 f
  [[ $RPARENT =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "REFUSED: not a plain absolute directory name: $RPARENT"; exit 2; }
  trap 'cleanup; exit 1' INT TERM
  mkdir -p "$OUT" || exit 2
  echo "== R6 r4 archive-ownership proof $(date -u +%FT%TZ) run=$RID workstation=$(hostname) source=$SRC"
  WS=$(mktemp -d "/tmp/r6own-ws.$RID.XXXXXX") || exit 2
  if [ -d "$SRC" ]; then tar -cf "$WS/fix.tar" -C "$SRC" "${PATHS[@]}"; else git -C "$REPO" archive --format=tar "$SRC" "${PATHS[@]}" > "$WS/fix.tar"; fi \
    || { echo "STOP the five files are not all at $SRC"; cleanup; exit 2; }
  mkdir "$WS/fix" "$WS/tmp" && tar -xf "$WS/fix.tar" -C "$WS/fix" || { echo "STOP export"; cleanup; exit 2; }
  for f in "${PATHS[@]}"; do echo "   $(sha256sum < "$WS/fix/$f" | cut -c1-64)  $f"; done
  echo "-- suite f5 on the workstation (Git Bash), private directory $WS"
  TMPDIR=$WS/tmp bash "$WS/fix/$SUITE" "$WS/fix" 2>&1 | tee "$OUT/f5-workstation.log"; rc1=${PIPESTATUS[0]}
  echo "-- suite f5 on streamanator (arm)"
  RUN=$(rsh "umask 077; mktemp -d $RPARENT/r6own.$RID.XXXXXX") && [[ $RUN == "$RPARENT"/r6own."$RID".* ]] || { echo "STOP no streamanator directory"; RUN=; cleanup; exit 1; }
  echo "   private directory $RUN"
  rsh "set -e; cd '$RUN'; mkdir fix tmp; tar -xf - -C fix; TMPDIR='$RUN/tmp' bash 'fix/$SUITE' '$RUN/fix'" < "$WS/fix.tar" 2>&1 | tee "$OUT/f5-streamanator.log"; rc2=${PIPESTATUS[0]}
  l1=$(tail -1 "$OUT/f5-workstation.log"); l2=$(tail -1 "$OUT/f5-streamanator.log")
  cleanup; f=$?
  echo "== proof: workstation exit $rc1 '$l1'; streamanator exit $rc2 '$l2'; cleanup $([ "$f" = 0 ] && echo complete || echo INCOMPLETE)"
  [ "$rc1" = 0 ] && [ "$rc2" = 0 ] && [[ $l1 == "SUITE f5 RESULT PASS ("*" cases)" ]] && [ "$l1" = "$l2" ] && [ "$f" = 0 ] \
    && echo "R6 r4 ARCHIVE OWNERSHIP PROOF PASS" || { echo "R6 r4 ARCHIVE OWNERSHIP PROOF FAIL"; exit 1; }
}
main "$@"
