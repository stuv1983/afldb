#!/usr/bin/env bash
W=/mnt/ssd/afldb-backlog-20261122-dg
cp /tmp/dg-provisional_dryrun.py "$W/drivers/provisional_dryrun.py"; rm -f /tmp/dg-provisional_dryrun.py
cd "$W/src"
export AFLDB_IMPORT_DATABASE_URL="postgresql://dgsuper@127.0.0.1:61522/afldb_prod_r0"
PSQL="/usr/lib/postgresql/16/bin/psql -h 127.0.0.1 -p 61522 -U dgsuper -d afldb_prod_r0 -At"
echo "before: import_batches=$($PSQL -c 'select count(*) from import_batches') draft_picks=$($PSQL -c 'select count(*) from draft_picks')"
"$W/venv/bin/python" -I "$W/drivers/provisional_dryrun.py" "$W" annual-html-20261122 --dry-run --label annual-html-20261122 --guard-report "$W/evidence/guard-report-provisional.json" > "$W/evidence/dryrun-provisional.txt" 2>&1
echo "rc=$?"
wc -c "$W/evidence/dryrun-provisional.txt" "$W/evidence/guard-report-provisional.json"
head -c 6000 "$W/evidence/dryrun-provisional.txt"
echo "after: import_batches=$($PSQL -c 'select count(*) from import_batches') draft_picks=$($PSQL -c 'select count(*) from draft_picks')"
