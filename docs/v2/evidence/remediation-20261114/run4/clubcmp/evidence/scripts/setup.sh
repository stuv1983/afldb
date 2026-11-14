#!/usr/bin/env bash
# rem4-clubcmp setup: checkout at B4, npm ci, isolated cluster on 55683. Usage: setup.sh checkout|cluster|all
set -uo pipefail
source /mnt/ssd/afldb-rem4-clubcmp-20261115/in/common.sh
BUNDLE=/mnt/ssd/afldb-rem4-base/base-B4.bundle
B4=7cfbe186e70ca91db67da1aa4e28325ccbc32a86
case "${1:-all}" in
  checkout|all)
    (cd /mnt/ssd/afldb-rem4-base && sha256sum -c SHA256SUMS) || { say "bundle sha mismatch"; exit 2; }
    [ ! -e "$CAND" ] || { say "cand exists"; exit 2; }
    git clone -q /mnt/ssd/afldb-review-20261114T0640Z/cand "$CAND" || exit 2
    cd "$CAND" && git fetch -q "$BUNDLE" claude/remediation-20261114:refs/heads/base && git checkout -q base || exit 2
    HEAD=$(git rev-parse HEAD); say "HEAD $HEAD"
    [ "$HEAD" = "$B4" ] || { say "wrong HEAD"; exit 2; }
    [ ! -e "$CAND/.env" ] || { say ".env present"; exit 2; }
    timeout 900 npm ci --no-audit --no-fund 2>&1 | tail -4
    echo "porcelain $(git status --porcelain | wc -l)"
    ;;&
  cluster|all)
    ss -H -ltn "sport = :$PORT" | grep . >/dev/null && { say "port $PORT in use"; exit 3; }
    IR init || exit 3
    IR start > "$EV/pg-start.out" 2>&1 < /dev/null
    sleep 3
    IR roles && IR status || exit 3
    pm=$(head -1 "$AFLDB_V2_PG_ROOT/data/postmaster.pid")
    ss -ltnp 2>/dev/null | grep ":$PORT " | tee "$EV/listener.txt"
    grep "pid=$pm," "$EV/listener.txt" >/dev/null || { say "listener not ours"; exit 3; }
    say "cluster ready pid $pm"
    ;;
esac
