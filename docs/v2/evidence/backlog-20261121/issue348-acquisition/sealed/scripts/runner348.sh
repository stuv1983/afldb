#!/usr/bin/env bash
# Rehearse the sealed production runner i348-load.sh end to end on a fresh isolated R0 restore (reh3).
set -uo pipefail; export LC_ALL=C PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
W=/mnt/ssd/afldb-backlog-20261122b-348; C=$W/co; RN=$W/runner; ROOT=$RN/root; DB=afldb_v2_b348_reh3_test
export AFLDB_V2_PG_ROOT=$W/pg AFLDB_V2_PG_PORT=61540 AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin
IR() { (cd "$C" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
ss -ltnH "sport = :61540" | grep -q . || { IR start > "$W/ev/pg-start2.out" 2>&1 < /dev/null; sleep 3; }
IR list 2>&1 | grep -q "^$DB	" && IR drop-db "$DB" --acknowledge-destroy "$DB" 2>&1 | tail -1
IR create-db "$DB" --template afldb_v2_b348_r0tpl_test 2>&1 | tail -1
rm -rf "$ROOT/cand" "$ROOT/stage" "$ROOT"/*.ok "$ROOT"/*.done "$ROOT"/digest-* "$ROOT"/load.log "$ROOT"/guard-load.json
tar -xf "$RN/cand-7b52c46c.tar" -C "$ROOT" && cp "$W/seal/i348-transfer.tar" "$ROOT/in/"
umask 077
IR run "$DB" -- bash -c 'printf "AFLDB_BACKUP_DATABASE_URL=\"%s\"\nAFLDB_IMPORT_DATABASE_URL=\"%s\"\nDATABASE_URL=\"%s\"\n" "$AFLDB_BACKUP_DATABASE_URL" "$AFLDB_IMPORT_DATABASE_URL" "$DATABASE_URL" > '"$RN"'/fake.env' 2>&1 | grep -v "^isolated-pg:"
export I348_ROOT=$ROOT I348_ENV_FILE=$RN/fake.env I348_EXPECT_DB=$DB I348_EXPECT_HOST=$(hostname) I348_PYTHON=$W/venv/bin/python
L="bash $RN/seal/i348-load.sh"
echo "### T1 load before pre digest (expect STOP 5)"; $L load 2>&1 | tail -1; echo "rc=${PIPESTATUS[0]}"
echo "### T2 verify";      $L verify 2>&1 | grep -v "^  " | tail -6; echo "rc=${PIPESTATUS[0]}"
echo "### T3 digest post before load (expect STOP 5)"; $L digest post 2>&1 | tail -1; echo "rc=${PIPESTATUS[0]}"
echo "### T4 digest pre";  $L digest pre 2>&1 | tail -1; echo "rc=${PIPESTATUS[0]}"
echo "### T5 load";        $L load 2>&1 | grep -E "snapshot|reload guard|authority: (bridge|unmatched)|rc=|STOP|DRY" ; echo "rc=${PIPESTATUS[0]}"
echo "### T6 digest post"; $L digest post 2>&1 | tail -1; echo "rc=${PIPESTATUS[0]}"
echo "### T7 load again (expect STOP 5)"; $L load 2>&1 | tail -1; echo "rc=${PIPESTATUS[0]}"
echo "### T8 tampered reconciliation (expect STOP 3)"; printf ' ' >> "$ROOT/stage/in/reconciliation-annual-html-20261122.json"; $L verify 2>&1 | tail -1; echo "rc=${PIPESTATUS[0]}"
echo "### T9 wrong host (expect STOP 3)"; I348_EXPECT_HOST=afldb-prod $L verify 2>&1 | tail -1; echo "rc=${PIPESTATUS[0]}"
grep -c "postgres" "$ROOT/load.log" "$ROOT"/digest-*.txt
shred -u "$RN/fake.env" 2>/dev/null || rm -f "$RN/fake.env"
IR stop 2>&1 | tail -1
