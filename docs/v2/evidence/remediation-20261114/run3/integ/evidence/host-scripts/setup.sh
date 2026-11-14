#!/usr/bin/env bash
# rem3-integ phase A setup: checkout at 6d5388ea, npm ci, isolated cluster on 55673, snapshot template (ledger 118).
set -uo pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
W=/mnt/ssd/afldb-rem3-integ-20261114
PORT=55673
export AFLDB_V2_PG_ROOT="$W-pg" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=$PORT
DUMP=/mnt/ssd/afldb/workspaces/afldb-issue333-o2-20261104/private/afldb_prod-20261104T021037Z.dump
DUMP_SHA=e77c307d3e0cddcb652e398a946e4c22c2063f13c70edadf96a975c92842826d
DUMP_BYTES=30141895
BUNDLE=/mnt/ssd/afldb-rem3-base/base-6d5388ea.bundle
BUNDLE_SHA=0a1b46d187a4173cef5bef0833fb8ad621d58116dcd5c4026b4dc494f9ccbf68
EV="$W/evidence"; CAND="$W/cand"; TMPL=afldb_v2_rem3integ_tmpl_test
say() { echo "$(date -u +%FT%TZ) $*" | tee -a "$EV/setup.log"; }
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
RUNDB() { local db="$1"; shift; (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- "$@"); }

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
    npm ci --no-audit --no-fund 2>&1 | tail -4
    git status --porcelain | wc -l
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
    ;;&
  template|all)
    [ "$(stat -c %s "$DUMP")" = "$DUMP_BYTES" ] || { say "dump size"; exit 4; }
    [ "$(sha256sum "$DUMP" | cut -d' ' -f1)" = "$DUMP_SHA" ] || { say "dump sha"; exit 4; }
    cp /mnt/ssd/afldb-review-20261114T0640Z/in/restore.mjs /mnt/ssd/afldb-review-20261114T0640Z/in/probe-dbs.mjs "$W/in/"
    IR create-db "$TMPL" || exit 4
    flock /mnt/ssd/afldb-rem3-base/heavy.lock timeout 1500 bash -c "cd $CAND && node --import tsx tools/v2/isolated-pg.ts run $TMPL -- node $W/in/restore.mjs $DUMP $DUMP_SHA" || exit 4
    RUNDB "$TMPL" node --import tsx tools/db/migrate.ts --target test 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | tail -4
    cp "$W/in/probe-dbs.mjs" "$CAND/.probe-dbs.mjs"
    RUNDB "$TMPL" node .probe-dbs.mjs "$TMPL" | tee "$EV/tmpl-probe.txt"
    rm -f "$CAND/.probe-dbs.mjs"
    grep '"ledger":"118_fixtures_unconfirmed_participants.sql"' "$EV/tmpl-probe.txt" >/dev/null || { say "ledger not 118"; exit 4; }
    say "template ready"
    ;;
esac
