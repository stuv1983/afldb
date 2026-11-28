#!/usr/bin/env bash
# Workstation-side transport for the R6 r7 sealed-backup real-systemd harness (REHEARSAL ONLY: streamanator, never production). Sends
# the listed worktree files to a private streamanator workspace, runs r7b-host.sh there, pulls the logs back into
# backup-harness/logs/, removes the workspace (and, unless --image/--keep-image, the image it built).
# Usage (Git Bash on the workstation):
#   bash r7b-run.sh [--verify-rev <rev>] [--image <tag>] [--keep-image] [--log-dir <dir>] <RID> [scenario ...]
#   --log-dir DIR     r8: pull the logs into DIR (absolute, or relative to the worktree) instead of backup-harness/logs/, whose
#                     r7b-<scenario>.log files are the recorded r7 runs and must not be overwritten (r8 dev runs: R8/dev-logs/...).
#   --verify-rev REV  before sending, compare every worktree file sent with its blob at REV (git show REV:<path> | sha256sum); any
#                     difference refuses the run. The result is sent as presend.txt and printed in every scenario log.
#   --image TAG       reuse an existing harness image on streamanator instead of building r7b-sysd-<RID>:1 (kept afterwards).
# Exit 0 only when the host prints "R7 BACKUP HARNESS RESULT PASS".
set -uo pipefail
VREV=; HOSTOPT=(); LOGDIR=
while :; do case ${1:-} in --verify-rev) VREV=${2:?revision}; shift 2;; --image) HOSTOPT+=(--image "${2:?tag}"); shift 2;; --keep-image) HOSTOPT+=(--keep-image); shift;; --log-dir) LOGDIR=${2:?dir}; shift 2;; *) break;; esac; done
RID=${1:?rid}; shift
[[ $RID =~ ^[A-Za-z0-9-]+$ ]] || { echo "STOP the run id must be [A-Za-z0-9-]+"; exit 2; }
WT=/d/dev/afldb-closeout-20261127
R7=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r7-20261128
SSH=(ssh -o BatchMode=yes -i "$HOME/.ssh/afldb_dev" arm@10.0.40.100)
SENT=("$R7/backup/afldb-backup-run" "$R7/backup/afldb-backup-seal" "$R7/backup/70-afldb-backup-sealed.conf" "$R7/backup/sealed-origin.sh"
      "$R7/backup/install-backup.sh" "$R7/backup/verify-backup-install.sh" "$R7/backup/SHA256SUMS"
      "$R7/backup-harness/r7b-run.sh" "$R7/backup-harness/r7b-host.sh" "$R7/backup-harness/r7b-container.sh"
      tools/maintenance/backup.sh tools/maintenance/offhost-pull.sh tools/maintenance/scheduled-backup.sh
      deploy/afldb-backup.service deploy/afldb-backup.timer deploy/afldb-backup-failed.service)
STAGE=$(mktemp -d); trap 'rm -rf "$STAGE"' EXIT
{ echo "[TRANSPORT] workstation $(date -u +%FT%TZ): ${#SENT[@]} worktree files, CR stripped (none expected)"
  if [ -n "$VREV" ]; then
    REV=$(git -C "$WT" rev-parse --verify "$VREV^{commit}") || { echo "STOP unknown revision $VREV"; exit 2; }
    echo "[TRANSPORT] pre-send verification: every worktree file sent vs its blob at $REV (git show <rev>:<path> | sha256sum)"
    bad=0
    for f in "${SENT[@]}"; do
      w=$(sha256sum < "$WT/$f" | cut -c1-64); g=$(git -C "$WT" show "$REV:$f" 2>/dev/null | sha256sum | cut -c1-64)
      [ "$w" = "$g" ] && echo "   EQUAL $w  $f" || { echo "   DIFFERS worktree $w blob $g  $f"; bad=1; }
    done
    echo "   result: $([ $bad = 0 ] && echo "every sent file equals its blob at $REV" || echo MISMATCH)"
  else
    for f in "${SENT[@]}"; do echo "   WORKTREE $(sha256sum < "$WT/$f" | cut -c1-64)  $f"; done
    echo "   (no --verify-rev: worktree bytes, not a committed revision)"
  fi
} > "$STAGE/presend.txt"
cat "$STAGE/presend.txt"
[ -z "$VREV" ] || grep -q '^   result: every sent file' "$STAGE/presend.txt" || { echo "STOP the worktree does not equal $VREV"; exit 2; }
for f in "${SENT[@]}"; do grep -q $'\r' "$WT/$f" && { echo "STOP $f contains CR bytes"; exit 2; }; done
WS=$("${SSH[@]}" 'mktemp -d -p "$HOME" r7b-ws.XXXXXX') || exit 1
echo "workspace $WS"
tar -C "$WT" -cf - "${SENT[@]}" | "${SSH[@]}" "mkdir -m 700 '$WS/fix' && tar -C '$WS/fix' -xf - && find '$WS/fix' -type f | wc -l"
"${SSH[@]}" "cat > '$WS/presend.txt'" < "$STAGE/presend.txt"
"${SSH[@]}" "bash '$WS/fix/$R7/backup-harness/r7b-host.sh' '$WS' '$RID' ${HOSTOPT[*]} $*"; RC=$?
case $LOGDIR in "") LD=$WT/$R7/backup-harness/logs;; /*) LD=$LOGDIR;; *) LD=$WT/$LOGDIR;; esac
mkdir -p "$LD"; echo "logs -> $LD"
"${SSH[@]}" "tar -C '$WS/logs' -cf - ." | tar -C "$LD" -xf -
"${SSH[@]}" "rm -rf '$WS'; ls -d \"\$HOME\"/r7b-ws.* 2>/dev/null; echo containers left: \$(docker ps -a --filter label=r7b.run=$RID -q | wc -l) images left: \$(docker images --filter label=r7b.run=$RID -q | wc -l)"
echo "host driver exit $RC"
exit $RC
