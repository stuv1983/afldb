#!/usr/bin/env bash
# REHEARSAL ONLY (R6 r3, 24 Nov 2026): streamanator (DEV host), as arm, inside ONE ssh connection from run-printed-blocks.sh.
# Never contacts production. Everything it creates lives under the run's private directory RUN (made by the driver with mktemp)
# or is a container named r6reh-<RID>-<n> and labelled r6reh.run=<RID>; it removes only those containers, and the driver removes
# RUN. Every container: the pinned Ubuntu 24.04 image below, --network none, --rm.
#   RUN/src/archive.tar   the archive the printed transfer block delivered (a copy; the host /tmp file is the driver's)
#   RUN/blocks/block4.sh, block5.sh   the printed staging and re-check blocks, cut verbatim from the runbook at the review commit
#   RUN/fix/              a clean export of the tested commit: this harness and the real deploy/ and tools/ fixture blobs
# Cases: blocks-case.sh once per printed-block case (as arm's uid, the case's own RUN/case-<name> as /tmp); then in-container.sh
# (roles prod and wronghost) against the staged root that the clean block-4 case verified. Prints one CASE-RESULT line per case
# and exits nonzero if any case is UNEXPECTED, fails to run, or a container is left behind.
# Usage: bash rehearse-r3.sh <RUN> <RID>
set -uo pipefail; export LC_ALL=C
[ "$(hostname)" != afldb-prod ] || { echo "REFUSED: rehearsal never runs on production"; exit 2; }
RUN=${1:?run directory}; RID=${2:?run id}
[[ $RID =~ ^[A-Za-z0-9-]+$ ]] && [[ $RUN == /tmp/r6reh."$RID".* ]] && [ -d "$RUN" ] && [ ! -L "$RUN" ] && [ -O "$RUN" ] \
  || { echo "STOP not this run's private directory: $RUN ($RID)"; exit 2; }
IMG=sha256:d71c0b286c54a7cc48645aa8d4d9d0c57e4260128cb91a6fb18c29d7589205ba   # grafana/alloy:latest on streamanator, Ubuntu 24.04.4
NODED=/home/arm/.nvm/versions/node/v22.23.2
H=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r3-20261124
U=$(id -u):$(id -g); N=0; BAD=0; LBL="r6reh.run=$RID"
echo "== R6 r3 REHEARSAL $(date -u +%FT%TZ) host=$(hostname) user=$(id -un) run=$RUN"
echo "   image $IMG ($(docker image inspect -f '{{.Os}}/{{.Architecture}} created {{.Created}}' "$IMG"))"
echo "   archive $(sha256sum < "$RUN/src/archive.tar" | cut -c1-64); block4 $(sha256sum < "$RUN/blocks/block4.sh" | cut -c1-64); block5 $(sha256sum < "$RUN/blocks/block5.sh" | cut -c1-64)"
[ -n "${R6_REH_SABOTAGE:-}" ] && echo "   R6_REH_SABOTAGE=$R6_REH_SABOTAGE (driver self-test: one case is expected to come out UNEXPECTED)"
dock() { docker run --rm --network none --name "r6reh-$RID-$N" --label "$LBL" -e R6_REH_SABOTAGE "$@"; }   # caller increments N

echo "-- printed blocks, verbatim, one container per case (/tmp = the case's own directory under RUN)"
CASES=(b4-clean b4-changed-byte b4-missing-file b4-extra-file b4-nested-manifest b4-root-manifest b4-extra-symlink
  b4-symlink-identical b4-bad-archive b4-not-a-tar
  b5-unchanged b5-changed-byte b5-altered-manifest b5-extra-file b5-missing-file b5-nested-manifest b5-extra-symlink
  b5-symlink-identical b5-manifest-symlink-identical b5-hardlink-outside b5-group-writable b5-extra-empty-dir b5-stage-is-symlink)
for c in "${CASES[@]}"; do
  mkdir -m 700 "$RUN/case-$c" || { echo "CASE-RESULT $c UNEXPECTED (case directory)"; BAD=$((BAD+1)); continue; }
  N=$((N+1)); dock --user "$U" -v "$RUN/case-$c:/tmp" -v "$RUN/blocks:/in/blocks:ro" -v "$RUN/src:/in/src:ro" -v "$RUN/fix/$H/blocks-case.sh:/in/case.sh:ro" \
    --entrypoint bash "$IMG" /in/case.sh "$c" 2>&1 | tee "$RUN/case-$c.out" | sed 's/^/  /'
  rc=${PIPESTATUS[0]}
  grep -q "^CASE-RESULT $c OK" "$RUN/case-$c.out" && [ "$rc" = 0 ] || { BAD=$((BAD+1)); grep -q '^CASE-RESULT' "$RUN/case-$c.out" || echo "  CASE-RESULT $c UNEXPECTED (exit $rc, no result line)"; }
done

echo "-- A-2, handoff and F-4 suite (in-container.sh) against the staged root the clean block-4 case verified"
S=$(sed -n 's/^  *| R6 STAGE VERIFIED \(\/tmp\/afldb-r6-20261125-r3\.[A-Za-z0-9]*\) ([0-9]* files)$/\1/p' "$RUN/case-b4-clean.out" | head -1)
HS=$RUN/case-b4-clean${S#/tmp}
if [ -n "$S" ] && [ -d "$HS/docs" ]; then
  echo "   staged root $S (host $HS)"
  for role in prod:afldb-prod wronghost:afldb-dev; do
    N=$((N+1)); dock --hostname "${role#*:}" -v "$HS/docs:/in/stage/docs:ro" -v "$RUN/fix:/in/fix:ro" -v "$NODED:$NODED:ro" \
      --entrypoint bash "$IMG" "/in/fix/$H/in-container.sh" "${role%%:*}" 2>&1 | sed 's/^/  /'
    rc=${PIPESTATUS[0]}
    [ "$rc" = 0 ] && echo "  CASE-RESULT suite-${role%%:*} OK (exit 0)" || { echo "  CASE-RESULT suite-${role%%:*} UNEXPECTED (exit $rc)"; BAD=$((BAD+1)); }
  done
else echo "  CASE-RESULT suites UNEXPECTED (no verified staging root from b4-clean)"; BAD=$((BAD+1)); fi

left=$(docker ps -aq --filter "label=$LBL" | wc -l)
[ "$left" = 0 ] || { echo "   removing $left container(s) labelled $LBL"; docker ps -aq --filter "label=$LBL" | xargs -r docker rm -f >/dev/null; BAD=$((BAD+1)); }
echo "== containers run: $N; left with label $LBL: $(docker ps -aq --filter "label=$LBL" | wc -l); unexpected: $BAD"
[ "$BAD" = 0 ] && echo "R6 r3 REHEARSAL CONTAINERS PASS" || { echo "R6 r3 REHEARSAL CONTAINERS FAIL ($BAD)"; exit 1; }
