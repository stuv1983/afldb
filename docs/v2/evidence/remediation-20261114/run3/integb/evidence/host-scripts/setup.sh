#!/usr/bin/env bash
# rem3-integb setup: checkout at 6d5388ea + bundle, npm ci, isolated cluster on 55675. Usage: setup.sh checkout|cluster|all
set -uo pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
W=/mnt/ssd/afldb-rem3-integb-20261114
PORT=55675
export AFLDB_V2_PG_ROOT="$W-pg" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=$PORT
BUNDLE=/mnt/ssd/afldb-rem3-base/base-6d5388ea.bundle
BUNDLE_SHA=0a1b46d187a4173cef5bef0833fb8ad621d58116dcd5c4026b4dc494f9ccbf68
EV="$W/evidence"; CAND="$W/cand"
say() { echo "$(date -u +%FT%TZ) $*" | tee -a "$EV/setup.log"; }
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
mkdir -p "$W/in" "$EV" || exit 1
case "${1:-all}" in
  checkout|all)
    [ "$(sha256sum "$BUNDLE" | cut -d' ' -f1)" = "$BUNDLE_SHA" ] || { say "bundle sha mismatch"; exit 2; }
    [ ! -e "$CAND" ] || { say "cand exists"; exit 2; }
    git clone -q /mnt/ssd/afldb-review-20261114T0640Z/cand "$CAND" || exit 2
    cd "$CAND" && git fetch -q "$BUNDLE" claude/remediation-20261114:refs/heads/base && git checkout -q base || exit 2
    HEAD=$(git rev-parse HEAD); say "HEAD $HEAD"
    [ "$HEAD" = 6d5388ea5305e73b0420fbccfa7b0cea4fe75927 ] || { say "wrong HEAD"; exit 2; }
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
