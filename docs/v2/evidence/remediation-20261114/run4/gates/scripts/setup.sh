#!/usr/bin/env bash
# rem4-gates setup: checkout at B4 + npm ci, isolated cluster on 55682. Usage: setup.sh checkout|cluster|all
set -uo pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
W=/mnt/ssd/afldb-rem4-gates-20261115
PORT=55682
export AFLDB_V2_PG_ROOT="$W-pg" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=$PORT
BUNDLE=/mnt/ssd/afldb-rem4-base/base-B4.bundle
BUNDLE_SHA=b1e2491b9739703c2ea3484300e9f7db9b051cba5e1d44fb595e4badb13b7a74
B4=7cfbe186e70ca91db67da1aa4e28325ccbc32a86
EV="$W/evidence"; CAND="$W/cand"
mkdir -p "$W/in" "$EV" || exit 1
say() { echo "$(date -u +%FT%TZ) $*" | tee -a "$EV/setup.log"; }
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
case "${1:-all}" in
  checkout|all)
    [ "$(sha256sum "$BUNDLE" | cut -d' ' -f1)" = "$BUNDLE_SHA" ] || { say "bundle sha mismatch"; exit 2; }
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
