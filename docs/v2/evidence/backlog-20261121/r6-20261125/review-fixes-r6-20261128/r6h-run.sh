#!/usr/bin/env bash
# Workstation-side transport for the R6 r6 real-systemd caller harness (REHEARSAL ONLY: streamanator, never production). Sends the
# listed worktree files to a private streamanator workspace, runs real-systemd-callers.sh, pulls the logs back, removes the workspace.
# Also sends contrast-bda102aa/{r1-g0-dump.sh,r6-pre-verify.sh} = `git show bda102aa:<path>` (read-only git), the gates before the
# review MED-1 fix, for the arm-node-swap CONTRAST.
# Usage: bash r6h-run.sh [--verify-rev <rev>] [--bundle-rev <rev>] <RID> [driver options and scenarios...]
#   --verify-rev REV  before sending, compare every worktree file sent with its blob at REV (git show REV:<path> | sha256sum); any
#                     difference or untracked file in a sent directory refuses the run. The result is sent as presend.txt and printed
#                     in every scenario header by the driver.
#   --bundle-rev REV  send the attest bundle (attest/*) as committed at REV (git show) instead of the worktree copy, e.g. to smoke-test
#                     against a committed bundle while the worktree bundle is being edited. Recorded in presend.txt.
set -uo pipefail
VREV=; BREV=
while :; do case ${1:-} in --verify-rev) VREV=${2:?revision}; shift 2;; --bundle-rev) BREV=${2:?revision}; shift 2;; *) break;; esac; done
RID=${1:?rid}; shift
WT=/d/dev/afldb-closeout-20261127
H6=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r6-20261128
G0P=docs/v2/evidence/release-17822b29-20261124/scripts/r1-g0-dump.sh; A2P=docs/v2/evidence/backlog-20261121/r6-20261125/r6-pre-verify.sh
SSH=(ssh -o BatchMode=yes -i "$HOME/.ssh/afldb_dev" arm@10.0.40.100)
STAGE=$(mktemp -d); trap 'rm -rf "$STAGE"' EXIT
mkdir "$STAGE/contrast-bda102aa"
git -C "$WT" show "bda102aa:$G0P" > "$STAGE/contrast-bda102aa/r1-g0-dump.sh" && git -C "$WT" show "bda102aa:$A2P" > "$STAGE/contrast-bda102aa/r6-pre-verify.sh" \
  || { echo "STOP cannot read the bda102aa gates"; exit 2; }
EXTRA=(contrast-bda102aa)
if [ -n "$BREV" ]; then
  mkdir -p "$STAGE/$H6/attest"
  for f in $(git -C "$WT" ls-tree --name-only "$BREV" "$H6/attest/"); do git -C "$WT" show "$BREV:$f" > "$STAGE/$f" || { echo "STOP cannot read $BREV:$f"; exit 2; }; done
  chmod 755 "$STAGE/$H6/attest/"*.sh "$STAGE/$H6/attest/afldb-backup-attest"
  ATT=(); EXTRA+=("$H6/attest")
else ATT=($(cd "$WT" && ls -1 "$H6"/attest/*)); fi
SENT=(deploy/afldb-backup.service deploy/afldb-backup.timer deploy/afldb-backup-failed.service tools/maintenance/scheduled-backup.sh "$G0P" "$A2P"
      "${ATT[@]}" $(cd "$WT" && ls -1 "$H6"/orig-624bf721/*) "$H6/real-systemd-callers.sh" "$H6/real-systemd-callers-container.sh" "$H6/r6h-run.sh")
{ echo "[TRANSPORT] workstation $(date -u +%FT%TZ): attest bundle source: $([ -n "$BREV" ] && echo "git show $BREV (NOT the worktree)" || echo worktree)"
  [ -n "$BREV" ] && for f in "$STAGE/$H6"/attest/*; do echo "   BUNDLE ${f#$STAGE/} = git show $BREV: $(sha256sum < "$f" | cut -c1-64)"; done
  for f in r1-g0-dump.sh r6-pre-verify.sh; do echo "   CONTRAST contrast-bda102aa/$f = git show bda102aa: $(sha256sum < "$STAGE/contrast-bda102aa/$f" | cut -c1-64)"; done
} > "$STAGE/presend.txt"
if [ -n "$VREV" ]; then
  REV=$(git -C "$WT" rev-parse --verify "$VREV^{commit}") || { echo "STOP unknown revision $VREV"; exit 2; }
  { echo "[TRANSPORT] pre-send verification: every worktree file sent vs its blob at $REV (git show <rev>:<path> | sha256sum)"
    bad=0
    for f in "${SENT[@]}"; do
      w=$(sha256sum < "$WT/$f" | cut -c1-64); g=$(git -C "$WT" show "$REV:$f" 2>/dev/null | sha256sum | cut -c1-64)
      [ "$w" = "$g" ] && echo "   EQUAL $w  $f" || { echo "   DIFFERS worktree $w blob $g  $f"; bad=1; }
    done
    u=$(git -C "$WT" ls-files --others -- $([ -z "$BREV" ] && echo "$H6/attest") "$H6/orig-624bf721" | wc -l); echo "   untracked files in the sent directories: $u"; [ "$u" = 0 ] || bad=1
    echo "   result: $([ $bad = 0 ] && echo "every sent file equals its blob at $REV" || echo MISMATCH)"
  } >> "$STAGE/presend.txt"
  grep -q '^   result: every sent file' "$STAGE/presend.txt" || { cat "$STAGE/presend.txt"; echo "STOP the worktree does not equal $REV"; exit 2; }
fi
cat "$STAGE/presend.txt"
WS=$("${SSH[@]}" 'mktemp -d -p "$HOME" r6h-ws.XXXXXX') || exit 1
echo "workspace $WS"
tar -C "$WT" -cf - "${SENT[@]}" -C "$STAGE" "${EXTRA[@]}" \
  | "${SSH[@]}" "mkdir -m 700 '$WS/fix' && tar -C '$WS/fix' -xf - && find '$WS/fix' -type f | wc -l"
"${SSH[@]}" "cat > '$WS/presend.txt'" < "$STAGE/presend.txt"
"${SSH[@]}" "bash '$WS/fix/$H6/real-systemd-callers.sh' '$WS' '$RID' $*"; RC=$?
"${SSH[@]}" "tar -C '$WS/logs' -cf - ." | tar -C "$WT/$H6/logs" -xf -
"${SSH[@]}" "rm -rf '$WS'; ls -d \"\$HOME\"/r6h-ws.* 2>/dev/null; docker ps -a --filter label=r6h.run=$RID -q | wc -l; docker images --filter label=r6h.run=$RID -q | wc -l"
echo "driver exit $RC"
