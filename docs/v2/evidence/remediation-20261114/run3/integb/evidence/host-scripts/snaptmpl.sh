#!/usr/bin/env bash
# rem3-integb: snapshot template (4 Nov production snapshot restored + migrated, ledger 118) on this scope's cluster.
set -uo pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
W=/mnt/ssd/afldb-rem3-integb-20261114
PORT=55675
export AFLDB_V2_PG_ROOT="$W-pg" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=$PORT
DUMP=/mnt/ssd/afldb/workspaces/afldb-issue333-o2-20261104/private/afldb_prod-20261104T021037Z.dump
DUMP_SHA=e77c307d3e0cddcb652e398a946e4c22c2063f13c70edadf96a975c92842826d
DUMP_BYTES=30141895
EV="$W/evidence"; CAND="$W/cand"; TMPL=afldb_v2_rem3integb_snap_tmpl_test
say() { echo "$(date -u +%FT%TZ) $*" | tee -a "$EV/snaptmpl.log"; }
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
RUNDB() { local db="$1"; shift; (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- "$@"); }
[ "$(stat -c %s "$DUMP")" = "$DUMP_BYTES" ] || { say "dump size"; exit 4; }
[ "$(sha256sum "$DUMP" | cut -d' ' -f1)" = "$DUMP_SHA" ] || { say "dump sha"; exit 4; }
say "snapshot dump verified (size and sha256)"
cp /mnt/ssd/afldb-review-20261114T0640Z/in/restore.mjs /mnt/ssd/afldb-review-20261114T0640Z/in/probe-dbs.mjs "$W/in/"
IR create-db "$TMPL" || exit 4
flock /mnt/ssd/afldb-rem3-base/heavy.lock timeout 1500 bash -c "cd $CAND && node --import tsx tools/v2/isolated-pg.ts run $TMPL -- node $W/in/restore.mjs $DUMP $DUMP_SHA" || exit 4
RUNDB "$TMPL" node --import tsx tools/db/migrate.ts --target test 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | tail -4
cp "$W/in/probe-dbs.mjs" "$CAND/.probe-dbs.mjs"
RUNDB "$TMPL" node .probe-dbs.mjs "$TMPL" | tee "$EV/snap-tmpl-probe.txt"
rm -f "$CAND/.probe-dbs.mjs"
grep '"ledger":"118_fixtures_unconfirmed_participants.sql"' "$EV/snap-tmpl-probe.txt" >/dev/null || { say "ledger not 118"; exit 4; }
say "snapshot template ready"
