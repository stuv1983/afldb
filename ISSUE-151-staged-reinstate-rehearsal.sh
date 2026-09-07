#!/usr/bin/env bash
# AFLDB-ISSUE-151 — rehearsal of the STAGED reinstatement on two THROWAWAY databases.
#
# Reproduces the exact production case of stamp 20260907-234124 and proves the generated
# plan's 2b–2e sequence succeeds without violating referential integrity:
#
#   old:  external_grid_sources(id=1, ingest_source_id=57), sources(id=57, key='gridley')
#   cand: sources(id=7, key='gridley'); sources 57 does not exist; the migration-080 seed present
#
# Also shows the pre-fix plain restore refusing on the FK, and the promotion refusing when it
# is run BEFORE the remap. Never run against a live database: the script creates and drops
# afldb_i151_old_test / afldb_i151_cand_test on the server the DSN points at, and refuses to
# run on the production host. Requires psql, pg_dump and pg_restore (16+) and a tsx-capable
# checkout of this repository (for the two generated files it does not hand-write).
#
# Usage (DEV: streamanator, or a workstation cluster; NOT afldb-prod):
#   bash ISSUE-151-staged-reinstate-rehearsal.sh 'postgresql://<owner>@127.0.0.1:5432/postgres'
#
# The DSN must reach a maintenance database with CREATE DATABASE rights. It is never printed.
set -u
BASE_DSN="${1:?maintenance DSN required}"
case "$(hostname)" in afldb-prod*) echo "refusing to run on the production host"; exit 2;; esac
case "$BASE_DSN" in *afldb_prod*) echo "refusing a DSN that names afldb_prod"; exit 2;; esac

REPO="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
OLD_DB=afldb_i151_old_test
CAND_DB=afldb_i151_cand_test
with_db() { node -e 'const u=new URL(process.argv[1]);u.pathname="/"+process.argv[2];process.stdout.write(u.toString())' "$BASE_DSN" "$1"; }
OLD="$(with_db "$OLD_DB")"
CANDIDATE_DSN="$(with_db "$CAND_DB")"
DUMP="$WORK/pre.dump"
PLAN="$WORK/plan"

step() { echo; echo "### $*"; }
cleanup() {
  psql "$BASE_DSN" -q -c "DROP DATABASE IF EXISTS $OLD_DB;" -c "DROP DATABASE IF EXISTS $CAND_DB;" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

step "0. throwaway databases + generated plan files (real generator, production stamp)"
psql "$BASE_DSN" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $OLD_DB;" -c "CREATE DATABASE $CAND_DB;" || exit 1
cat > "$WORK/gen-plan.ts" <<EOF
import { writePlan } from '$REPO/tools/db/promotion-check';
writePlan({ environment: 'prod', plan: true, checklist: false, allowFixtureIdentities: false,
  dsnEnv: 'AFLDB_OWNER_DATABASE_URL', database: 'afldb_prod_candidate_20260907-234124', oldDatabase: 'afldb_prod',
  preCutoverDump: '/home/arm/backups/afldb/pre.dump', rebuiltDump: '/home/arm/rebuilt.dump', planDir: '$PLAN' } as never);
EOF
cat > "$WORK/gen-remap.ts" <<EOF
import { writeFileSync } from 'node:fs';
import { contractByName, lineageRemapSql, resolveLineageRemap } from '$REPO/tools/db/promotion-inventory';
// The exact production case, resolved by the same functions --phase restored uses.
const remap = resolveLineageRemap({ entity: 'sources', rule: 'source_key', referencedIds: [57],
  replacedIdentities: [{ id: 57, identity: 'gridley' }], candidateIdentities: [{ id: 7, identity: 'gridley' }] });
writeFileSync('$PLAN/promotion-lineage-20260907-234124.sql', lineageRemapSql({
  candidate: 'afldb_prod_candidate_20260907-234124', oldDatabase: 'afldb_prod', environment: 'prod',
  plans: [{ table: 'external_grid_sources', column: 'ingest_source_id', entity: 'sources', rule: 'source_key',
    remediation: contractByName('external_grid_sources')!.lineageRefs![0].remediation,
    rows: [{ rowId: 1, oldValue: 57 }], remap }] }));
EOF
(cd "$REPO" && npx tsx "$WORK/gen-plan.ts" && npx tsx "$WORK/gen-remap.ts") || { echo "plan/remap generation failed"; exit 1; }
ls "$PLAN"

SCHEMA='
CREATE TABLE sources (id smallint PRIMARY KEY GENERATED ALWAYS AS IDENTITY, key text NOT NULL UNIQUE, name text NOT NULL);
CREATE TABLE import_batches (id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY, label text);
CREATE TABLE external_grid_sources (
  id smallint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  code text NOT NULL UNIQUE, name text NOT NULL, base_url text,
  ingest_source_id smallint NOT NULL UNIQUE REFERENCES sources(id),
  notes text, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_grid_sources_code_ck CHECK (code ~ ''^[a-z][a-z0-9_]*$''));
CREATE TABLE external_grids (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  source_id smallint NOT NULL REFERENCES external_grid_sources(id),
  board_number integer NOT NULL, import_batch_id bigint NOT NULL REFERENCES import_batches(id));
CREATE TABLE external_grid_axes (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  grid_id bigint NOT NULL REFERENCES external_grids(id) ON DELETE CASCADE, position smallint NOT NULL);
'
step "1. old production shape (gridley = sources 57)"
psql "$OLD" -v ON_ERROR_STOP=1 -q -c "$SCHEMA" -c "
INSERT INTO sources (id, key, name) OVERRIDING SYSTEM VALUE VALUES (57, 'gridley', 'Gridley');
INSERT INTO import_batches (id, label) OVERRIDING SYSTEM VALUE VALUES (1, 'legacy capture');
INSERT INTO external_grid_sources (code, name, base_url, ingest_source_id, notes)
  SELECT 'gridley', 'Gridley', 'https://gridleygame.com/', s.id, 'seed' FROM sources s WHERE s.key = 'gridley';
INSERT INTO external_grids (source_id, board_number, import_batch_id) VALUES (1, 1, 1), (1, 2, 1);
INSERT INTO external_grid_axes (grid_id, position) VALUES (1, 1), (1, 2), (2, 1);" || exit 1
psql "$OLD" -Atc "SELECT 'old external_grid_sources: id=' || id || ' ingest_source_id=' || ingest_source_id FROM external_grid_sources;"

step "2. candidate shape (gridley = sources 7, id 57 absent, migration-080 seed present)"
psql "$CANDIDATE_DSN" -v ON_ERROR_STOP=1 -q -c "$SCHEMA" -c "
INSERT INTO sources (id, key, name) OVERRIDING SYSTEM VALUE VALUES (7, 'gridley', 'Gridley');
INSERT INTO import_batches (id, label) OVERRIDING SYSTEM VALUE VALUES (1, 'rebuild batch');
INSERT INTO external_grid_sources (code, name, base_url, ingest_source_id, notes)
  SELECT 'gridley', 'Gridley', 'https://gridleygame.com/', s.id, 'seed' FROM sources s WHERE s.key = 'gridley';" || exit 1
psql "$CANDIDATE_DSN" -Atc "SELECT 'candidate sources: ' || string_agg(id || '=' || key, ', ') FROM sources;" -Atc "SELECT 'candidate has sources 57: ' || EXISTS (SELECT 1 FROM sources WHERE id = 57);"

step "3. pre-cutover dump of old"
pg_dump -Fc -f "$DUMP" "$OLD" && echo "dump written"

step "4. plan step 1 — the corpus part of promotion-truncate.sql"
psql "$CANDIDATE_DSN" -v ON_ERROR_STOP=1 -q -c 'TRUNCATE TABLE "public"."external_grid_sources", "public"."external_grids", "public"."external_grid_axes" RESTART IDENTITY;'

step "5. THE DEFECT — the pre-fix plain restore of external_grid_sources (expected: FK refusal)"
pg_restore --dbname="$CANDIDATE_DSN" --data-only --no-owner --no-privileges --single-transaction --exit-on-error --table=external_grid_sources "$DUMP" 2>&1 | sed 's/^/    /'
echo "    pg_restore exit: ${PIPESTATUS[0]} (non-zero expected)"
psql "$CANDIDATE_DSN" -Atc "SELECT 'public.external_grid_sources rows after the failed plain restore: ' || count(*) FROM external_grid_sources;"

step "6. THE FIX — promotion-reinstate.sh 2b–2e, line for line"
cd "$PLAN" || exit 1
echo "-- 2b"
psql "$CANDIDATE_DSN" -v ON_ERROR_STOP=1 -f promotion-stage.sql || exit 1
pg_restore --data-only --no-owner --no-privileges --table=external_grid_sources -f - "$DUMP" \
  | sed -e 's/^COPY public\.external_grid_sources (/COPY promotion_staging.external_grid_sources (/' > promotion-stage-external_grid_sources.sql
grep -q '^COPY promotion_staging.external_grid_sources (' promotion-stage-external_grid_sources.sql && echo "grep guard: redirect applied"
echo "--- generated restore script, COPY lines:"; grep -n '^COPY\|^\\\.' promotion-stage-external_grid_sources.sql
psql "$CANDIDATE_DSN" -v ON_ERROR_STOP=1 --single-transaction -f promotion-stage-external_grid_sources.sql || exit 1
psql "$CANDIDATE_DSN" -Atc "SELECT 'staged: id=' || id || ' ingest_source_id=' || ingest_source_id FROM promotion_staging.external_grid_sources;"

echo "-- 2d run OUT OF ORDER (before the remap): expected to refuse, and to change nothing"
psql "$CANDIDATE_DSN" -v ON_ERROR_STOP=1 -f promotion-promote-staged.sql 2>&1 | sed 's/^/    /'
psql "$CANDIDATE_DSN" -Atc "SELECT 'staging still present after the refusal: ' || EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'promotion_staging');" -Atc "SELECT 'public rows after the refusal: ' || count(*) FROM external_grid_sources;"

echo "-- 2c"
LINEAGE_REMAP_SQL="$PLAN/promotion-lineage-20260907-234124.sql"
psql "$CANDIDATE_DSN" -v ON_ERROR_STOP=1 -f "$LINEAGE_REMAP_SQL" || exit 1
psql "$CANDIDATE_DSN" -Atc "SELECT 'staged after remap: id=' || id || ' ingest_source_id=' || ingest_source_id FROM promotion_staging.external_grid_sources;"

echo "-- 2d"
psql "$CANDIDATE_DSN" -v ON_ERROR_STOP=1 -f promotion-promote-staged.sql || exit 1

echo "-- 2e"
pg_restore --dbname="$CANDIDATE_DSN" --data-only --no-owner --no-privileges --single-transaction --exit-on-error --table=external_grids "$DUMP" && echo "external_grids restored"
pg_restore --dbname="$CANDIDATE_DSN" --data-only --no-owner --no-privileges --single-transaction --exit-on-error --table=external_grid_axes "$DUMP" && echo "external_grid_axes restored"

echo "-- 3 (generated resync file; only the corpus tables exist here)"
psql "$CANDIDATE_DSN" -v ON_ERROR_STOP=1 -q -f promotion-resync-identity.sql 2>&1 | grep -i "external_grid" | sed 's/^/    /'

step "7. verification"
psql "$CANDIDATE_DSN" -v ON_ERROR_STOP=1 -Atc "
SELECT 'public.external_grid_sources: id=' || id || ' code=' || code || ' ingest_source_id=' || ingest_source_id FROM external_grid_sources;
SELECT 'ingest_source_id resolves to sources.key=' || s.key FROM external_grid_sources e JOIN sources s ON s.id = e.ingest_source_id;
SELECT 'external_grids rows=' || count(*) || ', all on source_id 1: ' || bool_and(source_id = 1) FROM external_grids;
SELECT 'external_grid_axes rows=' || count(*) FROM external_grid_axes;
SELECT 'sources rows (no fabricated 57): ' || string_agg(id || '=' || key, ', ') FROM sources;
SELECT 'promotion_staging schema exists: ' || EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'promotion_staging');
SELECT 'FK ' || conname || ': validated=' || convalidated || ' deferrable=' || condeferrable FROM pg_constraint WHERE contype = 'f' AND conrelid IN ('external_grid_sources'::regclass, 'external_grids'::regclass, 'external_grid_axes'::regclass) ORDER BY conname;
SELECT 'disabled triggers on corpus tables: ' || count(*) FROM pg_trigger WHERE tgenabled = 'D' AND tgrelid IN ('external_grid_sources'::regclass, 'external_grids'::regclass);
SELECT 'next external_grid_sources id: ' || nextval(pg_get_serial_sequence('external_grid_sources', 'id'));
SELECT 'dangling ingest_source_id rows: ' || count(*) FROM external_grid_sources e WHERE NOT EXISTS (SELECT 1 FROM sources s WHERE s.id = e.ingest_source_id);
"
echo "REHEARSAL COMPLETE"
