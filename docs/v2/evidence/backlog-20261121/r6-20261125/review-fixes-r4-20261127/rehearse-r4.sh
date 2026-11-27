#!/usr/bin/env bash
# REHEARSAL ONLY (R6 r4, 27 Nov 2026): streamanator (DEV host), as arm, inside ONE ssh connection from the repeat driver
# (review-fixes-r3-20261124/run-printed-blocks.sh <review> <out> r4). Never contacts production. Everything it creates lives under
# the run's private directory RUN (made by the driver with mktemp) or is a container named r6reh-<RID>-<n> and labelled
# r6reh.run=<RID>; it removes only those containers, and the driver removes RUN. Every container: the pinned Ubuntu 24.04 image
# below, --network none, --rm.
#   RUN/src/archive.tar            the archive the printed transfer block delivered (a copy; the host /tmp file is the driver's)
#   RUN/blocks/block4.sh, block5.sh  the printed staging and re-check blocks, cut verbatim from the R6 runbook at the review commit
#   RUN/blocks/runbook.md, release-runbook.md  the R6 runbook and the release runbook as committed at the review commit
#   RUN/fix/                       a clean export of the tested commit: the harness, deploy/, the release packet's scripts
# Order:
#   1. the release packet's pinned scripts in RUN/fix are checked against their own scripts/SHA256SUMS (sha256sum -c);
#   2. blocks-case.sh once per printed-block case (the r3 case set on the r4 blocks; as arm's uid, the case's own RUN/case-<name>
#      as /tmp);
#   3. in-container.sh (roles prod and wronghost) against the staged root that the clean block-4 case verified (the r3 A-2 and F-4
#      sections, ported to the r4 scripts);
#   4. one container per finding suite (cases/f*.sh): the staged R6 scripts from that same verified root, the release scripts and
#      deploy/release.mjs from RUN/fix. Suites marked `host` need what a network-less container cannot give (a real journald);
#      they run on streamanator itself as arm, in their own mktemp directory, and remove it.
# Prints one CASE-RESULT line per case and exits nonzero if any case is UNEXPECTED, a suite fails or does not print its PASS
# line, or a container is left behind.
# Usage: bash rehearse-r4.sh <RUN> <RID>
set -uo pipefail; export LC_ALL=C
[ "$(hostname)" != afldb-prod ] || { echo "REFUSED: rehearsal never runs on production"; exit 2; }
RUN=${1:?run directory}; RID=${2:?run id}
[[ $RID =~ ^[A-Za-z0-9-]+$ ]] && [[ $RUN == /tmp/r6reh."$RID".* ]] && [ -d "$RUN" ] && [ ! -L "$RUN" ] && [ -O "$RUN" ] \
  || { echo "STOP not this run's private directory: $RUN ($RID)"; exit 2; }
IMG=sha256:d71c0b286c54a7cc48645aa8d4d9d0c57e4260128cb91a6fb18c29d7589205ba   # grafana/alloy:latest on streamanator, Ubuntu 24.04.4
NODED=/home/arm/.nvm/versions/node/v22.23.2
H=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r4-20261127
REL=docs/v2/evidence/release-17822b29-20261124
U=$(id -u):$(id -g); N=0; BAD=0; LBL="r6reh.run=$RID"
echo "== R6 r4 REHEARSAL $(date -u +%FT%TZ) host=$(hostname) user=$(id -un) run=$RUN"
echo "   image $IMG ($(docker image inspect -f '{{.Os}}/{{.Architecture}} created {{.Created}}' "$IMG"))"
echo "   archive $(sha256sum < "$RUN/src/archive.tar" | cut -c1-64); block4 $(sha256sum < "$RUN/blocks/block4.sh" | cut -c1-64); block5 $(sha256sum < "$RUN/blocks/block5.sh" | cut -c1-64)"
echo "   runbooks at the review commit: R6 $(sha256sum < "$RUN/blocks/runbook.md" | cut -c1-64); release $(sha256sum < "$RUN/blocks/release-runbook.md" | cut -c1-64)"
[ -n "${R6_REH_SABOTAGE:-}" ] && echo "   R6_REH_SABOTAGE=$R6_REH_SABOTAGE (driver self-test: one case is expected to come out UNEXPECTED)"
dock() { docker run --rm --network none --name "r6reh-$RID-$N" --label "$LBL" -e R6_REH_SABOTAGE "$@"; }   # caller increments N

echo "-- release packet: the exported scripts against their own manifest"
if (cd "$RUN/fix/$REL/scripts" && sha256sum -c SHA256SUMS) 2>&1 | sed 's/^/  /' && [ "${PIPESTATUS[0]}" = 0 ]; then
  echo "  CASE-RESULT release-scripts-manifest OK (sha256sum -c exit 0; SHA256SUMS digest $(sha256sum < "$RUN/fix/$REL/scripts/SHA256SUMS" | cut -c1-64))"
else echo "  CASE-RESULT release-scripts-manifest UNEXPECTED (the exported release scripts do not match scripts/SHA256SUMS)"; BAD=$((BAD+1)); fi

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

S=$(sed -n 's/^  *| R6 STAGE VERIFIED \(\/tmp\/afldb-r6-20261125-r4\.[A-Za-z0-9]*\) ([0-9]* files)$/\1/p' "$RUN/case-b4-clean.out" | head -1)
HS=$RUN/case-b4-clean${S#/tmp}
if [ -n "$S" ] && [ -d "$HS/docs" ]; then
  echo "-- A-2 and F-4 suite (in-container.sh) against the staged root the clean block-4 case verified: $S (host $HS)"
  for role in prod:afldb-prod wronghost:afldb-dev; do
    N=$((N+1)); dock --hostname "${role#*:}" -v "$HS/docs:/in/stage/docs:ro" -v "$RUN/fix:/in/fix:ro" -v "$NODED:$NODED:ro" \
      --entrypoint bash "$IMG" "/in/fix/$H/in-container.sh" "${role%%:*}" 2>&1 | sed 's/^/  /'
    rc=${PIPESTATUS[0]}
    [ "$rc" = 0 ] && echo "  CASE-RESULT suite-${role%%:*} OK (exit 0)" || { echo "  CASE-RESULT suite-${role%%:*} UNEXPECTED (exit $rc)"; BAD=$((BAD+1)); }
  done

  echo "-- finding suites (cases/), one container or one host run each"
  # name|file|where: root = root inside a container whose hostname is afldb-prod (the suite creates arm and its shims);
  #                  arm  = arm's uid inside a container; host = streamanator itself as arm (no container)
  SUITES=(
    "f1|f1-handoff.sh|arm" "f2|f2-backup-attribution.sh|root" "f3|f3-identity.sh|root" "f4|f4-f1-manifest.sh|arm"
    "f5|f5-cleanup-ownership.sh|arm" "f6|f6-p4-deadline.sh|root" "f7|f7-p6-journal.sh|host"
  )
  for s in "${SUITES[@]}"; do
    IFS='|' read -r name file where <<< "$s"; out=$RUN/suite-$name.out
    args=(-v "$HS/docs:/in/stage/docs:ro" -v "$RUN/fix:/in/fix:ro" -v "$RUN/blocks:/in/blocks:ro" -v "$NODED:$NODED:ro"
      -e R4_RUNBOOK=/in/blocks/runbook.md -e R4_RELEASE_RUNBOOK=/in/blocks/release-runbook.md --entrypoint bash "$IMG" "/in/fix/$H/cases/$file" /in/fix /in/stage)
    case $where in
      root) N=$((N+1)); dock --hostname afldb-prod "${args[@]}" > "$out" 2>&1; rc=$?;;
      arm)  N=$((N+1)); dock --user "$U" "${args[@]}" > "$out" 2>&1; rc=$?;;
      host) R4_RUNBOOK=$RUN/blocks/runbook.md R4_RELEASE_RUNBOOK=$RUN/blocks/release-runbook.md bash "$RUN/fix/$H/cases/$file" "$RUN/fix" "$HS" > "$out" 2>&1 < /dev/null; rc=$?;;
      *) echo "unknown suite location $where" > "$out"; rc=99;;
    esac
    sed 's/^/  /' "$out"
    n=$(grep -c '^CASE-RESULT .* OK' "$out"); u=$(grep -c '^CASE-RESULT .* UNEXPECTED' "$out")
    if [ "$rc" = 0 ] && [ "$u" = 0 ] && [ "$n" -ge 1 ] && [ "$(tail -n 1 "$out")" = "SUITE $name RESULT PASS ($n cases)" ]; then
      echo "  CASE-RESULT suite-$name OK (exit 0, $n cases, 0 unexpected, $where)"
    else echo "  CASE-RESULT suite-$name UNEXPECTED (exit $rc, $n OK, $u unexpected, last line '$(tail -n 1 "$out" | cut -c1-120)')"; BAD=$((BAD+1)); fi
  done
else echo "  CASE-RESULT suites UNEXPECTED (no verified staging root from b4-clean)"; BAD=$((BAD+1)); fi

left=$(docker ps -aq --filter "label=$LBL" | wc -l)
[ "$left" = 0 ] || { echo "   removing $left container(s) labelled $LBL"; docker ps -aq --filter "label=$LBL" | xargs -r docker rm -f >/dev/null; BAD=$((BAD+1)); }
echo "== containers run: $N; left with label $LBL: $(docker ps -aq --filter "label=$LBL" | wc -l); unexpected: $BAD"
[ "$BAD" = 0 ] && echo "R6 r4 REHEARSAL CONTAINERS PASS" || { echo "R6 r4 REHEARSAL CONTAINERS FAIL ($BAD)"; exit 1; }
