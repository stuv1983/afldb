#!/usr/bin/env bash
# ISSUE-363 G-1 PROTOTYPE ONLY: tier P step 2 on a KEPT isolated copy. rbbovr = rbbov (bridged rebuild + the 64 GAP-029 labels) + the
# eight reviewed Rookie selections, applied by the existing audited tool tools/v2/gap029-rookie-selections-production.ts in its
# --rehearsal mode (isolated clones only). Nothing here touches the templates, the shared afldb_test, DEV services or production.
set -uo pipefail; export LC_ALL=C
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
W=/mnt/ssd/afldb-i363-20261121; C=$W/cand; S=$W/scripts; E=$W/ev/ov_rookie; mkdir -p "$E"
export AFLDB_V2_PG_ROOT=$W/pg AFLDB_V2_PG_PORT=61490 AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin
IR() { (cd "$C" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
DB=afldb_v2_i363_rbbovr_test
strip() { sed -e 's/\x1b\[[0-9;]*[A-Za-z]//g' -e 's#postgres\(ql\)\?://[^ ]*#<dsn>#g'; }
echo "HEAD=$(git -C "$C" rev-parse HEAD) porcelain=$(git -C "$C" status --porcelain | wc -l)"
IR list 2>&1 | grep -q "^$DB	" && IR drop-db "$DB" --acknowledge-destroy "$DB" 2>&1 | strip | tail -1
IR create-db "$DB" --template afldb_v2_i363_rbbov_test 2>&1 | strip | tail -1
ACTOR=$(IR run "$DB" -- node "$S/overlay-rookie-prep.mjs" "$E/prep" 2>&1 | grep -v '^isolated-pg:' | tail -1)
echo "clone-local actor id=$ACTOR"
T='tools/v2/gap029-rookie-selections-production.ts'
IR run "$DB" -- bash -c "AFLDB_GAP029_DSN=\"\$AFLDB_TEST_DATABASE_URL\" AFLDB_GAP029_WRITE_DSN=\"\$AFLDB_IMPORT_DATABASE_URL\" node --import tsx --conditions=react-server $T plan --target $E/prep/target.json --actor-user-id $ACTOR --rehearsal --out $E/plan.json" 2>&1 | strip | grep -v '^isolated-pg:' | tail -5
echo "(expected: the tracked tool refuses on a rebuild because its evidence pins production player ids)"
IR run "$DB" -- node --import tsx --conditions=react-server "$S/overlay-rookie-rekeyed.mts" "$ACTOR" 2>&1 | strip | grep -v '^isolated-pg:' | tail -8
IR run "$DB" -- bash -c "$AFLDB_V2_PG_BIN/psql -X -q -At \"\$AFLDB_TEST_DATABASE_URL\" -c \"SELECT 'data_overrides ' || entity_type || '/' || field_group || '=' || count(*) FROM data_overrides GROUP BY entity_type, field_group ORDER BY 1\" -c \"SELECT 'draft_picks=' || count(*) || ' rookie_manual=' || count(*) FILTER (WHERE source_record_id IS NOT NULL AND id > 6810) FROM draft_picks\" -c \"SELECT 'data_edits=' || count(*) FROM data_edits\"" 2>&1 | strip | grep -v '^isolated-pg:'
psql_fp() { IR run "$DB" -- bash -c "$AFLDB_V2_PG_BIN/psql -X -q -v ON_ERROR_STOP=1 \"\$AFLDB_TEST_DATABASE_URL\" -f $S/fp.sql" 2>&1 | strip | grep -v '^isolated-pg:'; }
psql_fp > "$E/fp-rbbovr.txt"; sha256sum "$E/fp-rbbovr.txt" 2>&1 | sed "s#$W/##"
