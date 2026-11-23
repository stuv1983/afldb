#!/usr/bin/env bash
# REHEARSAL ONLY: streamanator (DEV host), as arm, ONE ssh connection. Never contacts production. Runs two disposable containers
# (docker run --rm --network none: loopback only, nothing published, removed on exit) of a pinned Ubuntu 24.04 image, with
#   * the VERIFIED R6 staging root mounted read-only at /in/stage (only its docs/ tree, so a second user can read it),
#   * a fixture export of the same script revision (real 17822b29 deploy/ and tools/ blobs, the rehearsal stub server and this
#     harness) mounted read-only at /in/fix,
#   * the production Node build v22.23.2 mounted read-only at its production path.
# Docker sets the container hostname (afldb-prod, then afldb-dev); users arm and ops exist only inside. See in-container.sh.
# Usage: bash rehearse-r6-fixes.sh <verified STAGE> <fixture root>
set -uo pipefail; export LC_ALL=C
[ "$(hostname)" != afldb-prod ] || { echo "REFUSED: rehearsal never runs on production"; exit 2; }
STAGE=${1:?verified staging root}; FIX=${2:?fixture root}
IMG=sha256:d71c0b286c54a7cc48645aa8d4d9d0c57e4260128cb91a6fb18c29d7589205ba   # grafana/alloy:latest on streamanator, Ubuntu 24.04.4
NODED=/home/arm/.nvm/versions/node/v22.23.2
H=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-20261123
echo "== R6 FIX REHEARSAL $(date -u +%FT%TZ) host=$(hostname) user=$(id -un) stage=$STAGE fixture=$FIX"
echo "   image $IMG ($(docker image inspect -f '{{.Os}}/{{.Architecture}} created {{.Created}}' "$IMG"))"
run() { docker run --rm --network none --hostname "$1" -v "$STAGE/docs:/in/stage/docs:ro" -v "$FIX:/in/fix:ro" -v "$NODED:$NODED:ro" \
  --entrypoint bash "$IMG" "/in/fix/$H/in-container.sh" "$2"; }
run afldb-prod prod; r1=$?
run afldb-dev wronghost; r2=$?
echo "== containers: prod rc=$r1, wronghost rc=$r2; left behind: $(docker ps -aq --filter ancestor="$IMG" | wc -l) container(s)"
[ "$r1" = 0 ] && [ "$r2" = 0 ] && echo "R6 FIX REHEARSAL RESULT PASS" || { echo "R6 FIX REHEARSAL RESULT FAIL"; exit 1; }
