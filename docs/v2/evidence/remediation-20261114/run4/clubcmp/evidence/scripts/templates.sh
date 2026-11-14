#!/usr/bin/env bash
# rem4-clubcmp: restore the two bases as templates on this cluster. Usage: templates.sh rb|snap
set -uo pipefail
source /mnt/ssd/afldb-rem4-clubcmp-20261115/in/common.sh
case "${1:-}" in
  rb)
    (cd "$RB_DIR" && sha256sum -c --quiet SHA256SUMS) || { say "rb SHA256SUMS fail"; exit 4; }
    [ "$(sha256sum "$RB_DUMP" | cut -d' ' -f1)" = "$RB_SHA" ] || { say "rb dump sha"; exit 4; }
    say "rebuild dump verified"
    IR create-db "$TMPL_RB" 2>&1 | strip | tail -1
    (cd "$CAND" && flock "$LOCK" timeout 3000 node --import tsx tools/v2/isolated-pg.ts run "$TMPL_RB" -- node "$RB_DIR/restore-dump.mjs" "$RB_DUMP" "$RB_SHA") 2>&1 | strip | tail -6
    IR verify "$TMPL_RB" 2>&1 | strip | tail -2
    TC=$RB_DIR/afldb_v2_rb_rem3-6d5388ea.table-counts.tsv
    SQLTXT=$(awk -F'\t' 'NF==2 { printf "%sSELECT '\''%s'\'' AS t, count(*)::text AS n FROM public.\"%s\"", (c++ ? " UNION ALL " : ""), $1, $1 }' "$TC")
    echo "$SQLTXT" > "$EV/tc.sql"
    Qf "$TMPL_RB" "$EV/tc.sql" | grep -v '^t|n$' | grep -v '^([0-9]* rows\?)$' | tr '|' '\t' | sort > "$EV/table-counts.restored.tsv"
    sort "$TC" > "$EV/table-counts.published.tsv"
    if diff "$EV/table-counts.published.tsv" "$EV/table-counts.restored.tsv" > "$EV/table-counts.diff"; then say "table counts IDENTICAL"; else say "table counts DIFFER"; fi
    ;;
  snap)
    DUMP_BYTES=30141895
    [ "$(stat -c %s "$SNAP_DUMP")" = "$DUMP_BYTES" ] || { say "snap size"; exit 4; }
    [ "$(sha256sum "$SNAP_DUMP" | cut -d' ' -f1)" = "$SNAP_SHA" ] || { say "snap sha"; exit 4; }
    say "snapshot dump verified"
    cp /mnt/ssd/afldb-review-20261114T0640Z/in/restore.mjs /mnt/ssd/afldb-review-20261114T0640Z/in/probe-dbs.mjs "$W/in/"
    IR create-db "$TMPL_SN" 2>&1 | strip | tail -1
    (cd "$CAND" && flock "$LOCK" timeout 1500 node --import tsx tools/v2/isolated-pg.ts run "$TMPL_SN" -- node "$W/in/restore.mjs" "$SNAP_DUMP" "$SNAP_SHA") 2>&1 | strip | tail -4
    (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$TMPL_SN" -- node --import tsx tools/db/migrate.ts --target test) 2>&1 | strip | tail -4
    cp "$W/in/probe-dbs.mjs" "$CAND/.probe-dbs.mjs"
    (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$TMPL_SN" -- node .probe-dbs.mjs "$TMPL_SN") | tee "$EV/snap-tmpl-probe.txt"
    rm -f "$CAND/.probe-dbs.mjs"
    grep '"ledger":"118_fixtures_unconfirmed_participants.sql"' "$EV/snap-tmpl-probe.txt" >/dev/null || { say "ledger not 118"; exit 4; }
    say "snapshot template ready"
    ;;
esac
