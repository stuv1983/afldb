#!/usr/bin/env bash
# run-4 leaks scope: per-file residue attribution in SHARED mode (AFLDB_TEST_PER_FILE_DB unset; every file serially against ONE database of
# this scope's own isolated cluster, in the baseline's file order). Before and after every file: exact count(*) of every ordinary table in every
# non-system schema, plus the number of row versions written since the file started (xmin >= txid taken before the file).
#   bash $IN/leaks-attrib.sh <tag> <template db> <order file|-> [files...]
# <tag>: a name for the database afldb_v2_rem4leaks_<tag>_test (a fresh --template copy of <template db>) and the evidence files.
# With files given they run in the order given; otherwise every file of the order file.
set -u -o pipefail
source "$(dirname "$0")/leaks-lib.sh"
TAG=$1; TMPL=$2; ORDER=$3; shift 3
export TAG CAND E
DB=afldb_v2_rem4leaks_${TAG}_test
cell_guard_min() {
  [ -z "${AFLDB_TEST_PER_FILE_DB:-}" ] || { echo "AFLDB_TEST_PER_FILE_DB set: refused"; return 1; }
  [ -z "${AFLDB_TEST_PER_FILE_DB_PREFIX:-}${AFLDB_TEST_DATABASE_URL:-}${DATABASE_URL:-}" ] || { echo "ambient DSN/prefix set: refused"; return 1; }
  [ ! -e "$CAND/.env" ] || { echo ".env present"; return 1; }
  rm -rf "$CAND/node_modules/.vite/vitest" "$CAND/node_modules/.vitest"
}
cell_guard_min || exit 1
say "attrib $TAG: HEAD=$(git -C "$CAND" rev-parse HEAD) porcelain=$(pc) template=$TMPL"
MK=$(mkcopy "$DB" "$TMPL"); echo "$MK"; case "$MK" in *refused*|*rror*) echo "database copy not created: stopping"; exit 1;; esac
names=$(Q "$DB" "SELECT quote_ident(n.nspname)||'.'||quote_ident(c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' ORDER BY 1")
echo "$names" | awk 'NF{ t=$1; gsub(/\047/,"",t); printf "%sSELECT \047%s\047 AS t, count(*)::text AS n, (count(*) FILTER (WHERE xmin::text::bigint >= :x0))::text AS v FROM %s\n", (c++ ? "UNION ALL " : ""), t, t } END { print ";" }' > "$E/counts-$TAG.sql"
say "attrib $TAG: $(echo "$names" | grep -c .) tables in the count set"
: > "$E/attrib-$TAG.tsv"
if [ "$#" -gt 0 ]; then FILES=("$@"); else mapfile -t FILES < <(cut -f2 "$ORDER"); fi
for f in "${FILES[@]}"; do
  ${LOCKCMD:-flock "$LOCK"} nice -n 10 bash -c "cd '$CAND' && exec node --import tsx tools/v2/isolated-pg.ts run '$DB' -- bash '$IN/leaks-one.sh' '$f'" 2>&1 | strip | grep -a -v '^isolated-pg:' | tee -a "$E/attrib-$TAG.progress"
done
say "attrib $TAG: done ($(wc -l < "$E/attrib-$TAG.tsv") lines)"
# LOCKCMD=env (instead of the default `flock <heavy lock>`) runs each single-file vitest without the heavy lock: single-file focused runs
# may skip it (run-4 brief section 2); a full-order loop uses the lock per file.
