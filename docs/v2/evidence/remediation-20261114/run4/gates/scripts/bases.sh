#!/usr/bin/env bash
# rem4-gates: build the two template databases on this scope's cluster. Usage: bases.sh rebuild|snapshot
set -uo pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
W=/mnt/ssd/afldb-rem4-gates-20261115
PORT=55682
export AFLDB_V2_PG_ROOT="$W-pg" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=$PORT
EV="$W/evidence"; CAND="$W/cand"
say() { echo "$(date -u +%FT%TZ) $*" | tee -a "$EV/bases.log"; }
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
case "${1:-}" in
  rebuild)
    D=/mnt/ssd/afldb-rem3-base/rebuilt
    SHA=d8397aab92e3ce0cf2a640bb5daeac6594fb0e2c723dc410d82d8e718f165c63
    [ "$(sha256sum $D/afldb_v2_rb_rem3-6d5388ea.dump | cut -d' ' -f1)" = "$SHA" ] || { say "rebuild dump sha"; exit 4; }
    say "rebuild dump verified"
    DB=afldb_v2_rb_rem4gates_tmpl_test
    IR create-db $DB || exit 4
    flock /mnt/ssd/afldb-rem4-base/heavy.lock timeout 1500 bash -c "cd $CAND && node --import tsx tools/v2/isolated-pg.ts run $DB -- node $D/restore-dump.mjs $D/afldb_v2_rb_rem3-6d5388ea.dump $SHA" || exit 4
    IR verify $DB || exit 4
    say "rebuild template ready: $DB"
    ;;
  snapshot)
    DUMP=/mnt/ssd/afldb/workspaces/afldb-issue333-o2-20261104/private/afldb_prod-20261104T021037Z.dump
    DUMP_SHA=e77c307d3e0cddcb652e398a946e4c22c2063f13c70edadf96a975c92842826d
    DUMP_BYTES=30141895
    TMPL=afldb_v2_rem4gates_snap_tmpl_test
    [ "$(stat -c %s "$DUMP")" = "$DUMP_BYTES" ] || { say "dump size"; exit 4; }
    [ "$(sha256sum "$DUMP" | cut -d' ' -f1)" = "$DUMP_SHA" ] || { say "dump sha"; exit 4; }
    say "snapshot dump verified (size and sha256)"
    cp /mnt/ssd/afldb-review-20261114T0640Z/in/restore.mjs /mnt/ssd/afldb-review-20261114T0640Z/in/probe-dbs.mjs "$W/in/"
    IR create-db "$TMPL" || exit 4
    flock /mnt/ssd/afldb-rem4-base/heavy.lock timeout 1500 bash -c "cd $CAND && node --import tsx tools/v2/isolated-pg.ts run $TMPL -- node $W/in/restore.mjs $DUMP $DUMP_SHA" || exit 4
    (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$TMPL" -- node --import tsx tools/db/migrate.ts --target test 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | tail -4)
    cp "$W/in/probe-dbs.mjs" "$CAND/.probe-dbs.mjs"
    (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$TMPL" -- node .probe-dbs.mjs "$TMPL" | tee "$EV/snap-tmpl-probe.txt")
    rm -f "$CAND/.probe-dbs.mjs"
    grep '"ledger":"118_fixtures_unconfirmed_participants.sql"' "$EV/snap-tmpl-probe.txt" >/dev/null || { say "ledger not 118"; exit 4; }
    say "snapshot template ready: $TMPL"
    ;;
  *) echo "usage: bases.sh rebuild|snapshot"; exit 1;;
esac
