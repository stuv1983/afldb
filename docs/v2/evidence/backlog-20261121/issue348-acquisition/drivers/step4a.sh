#!/usr/bin/env bash
W=/mnt/ssd/afldb-backlog-20261122-dg
cd "$W/src"
export AFLDB_IMPORT_DATABASE_URL="postgresql://dgsuper@127.0.0.1:61522/afldb_prod_r0"
echo "== A. genuine, unpatched dry-run, label annual-html-20261122"
"$W/venv/bin/python" -I tools/rebuild/draftguru/import_draftguru.py --dry-run --label annual-html-20261122 --guard-report "$W/evidence/guard-report-unpatched.json" > "$W/evidence/dryrun-unpatched.txt" 2>&1
echo "rc=$?"; cat "$W/evidence/dryrun-unpatched.txt"
ls -l "$W/evidence/guard-report-unpatched.json" 2>&1 | head -2
