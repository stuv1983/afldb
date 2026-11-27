#!/usr/bin/env bash
# Workstation-side transport for the R6 r6 real-systemd caller harness (REHEARSAL ONLY: streamanator, never production). Sends the
# listed worktree files to a private streamanator workspace, runs real-systemd-callers.sh, pulls the logs back, removes the workspace.
# Usage: bash r6h-run.sh <RID> [driver options and scenarios...]
set -uo pipefail
RID=${1:?rid}; shift
WT=/d/dev/afldb-closeout-20261127
H6=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r6-20261128
SSH=(ssh -o BatchMode=yes -i "$HOME/.ssh/afldb_dev" arm@10.0.40.100)
WS=$("${SSH[@]}" 'mktemp -d -p "$HOME" r6h-ws.XXXXXX') || exit 1
echo "workspace $WS"
tar -C "$WT" -cf - deploy/afldb-backup.service deploy/afldb-backup.timer deploy/afldb-backup-failed.service \
  tools/maintenance/scheduled-backup.sh docs/v2/evidence/release-17822b29-20261124/scripts/r1-g0-dump.sh \
  docs/v2/evidence/backlog-20261121/r6-20261125/r6-pre-verify.sh "$H6/attest" "$H6/orig-624bf721" \
  "$H6/real-systemd-callers.sh" "$H6/real-systemd-callers-container.sh" \
  | "${SSH[@]}" "mkdir -m 700 '$WS/fix' && tar -C '$WS/fix' -xf - && find '$WS/fix' -type f | wc -l"
"${SSH[@]}" "bash '$WS/fix/$H6/real-systemd-callers.sh' '$WS' '$RID' $*"; RC=$?
"${SSH[@]}" "tar -C '$WS/logs' -cf - ." | tar -C "$WT/$H6/logs" -xf -
"${SSH[@]}" "rm -rf '$WS'; ls -d \"\$HOME\"/r6h-ws.* 2>/dev/null; docker ps -a --filter label=r6h.run=$RID -q | wc -l; docker images --filter label=r6h.run=$RID -q | wc -l"
echo "driver exit $RC"
