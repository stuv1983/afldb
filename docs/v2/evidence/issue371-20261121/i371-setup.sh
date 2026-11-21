#!/usr/bin/env bash
# AFLDB-ISSUE-371 DEV reproduction: workspace setup on streamanator (arm, no sudo, no production contact).
# Own workspace /mnt/ssd/afldb-i371-20261121, own isolated cluster (root $W/pg, 127.0.0.1:61480).
# Base data: the ACCEPTED source-only rebuild dump afldb_v2_rb_rem3-6d5388ea.dump (read-only; restored into OUR cluster).
#   bash i371-setup.sh deps|pg|template
set -uo pipefail; export LC_ALL=C
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
W=/mnt/ssd/afldb-i371-20261121; C=$W/cand; E=$W/evidence; mkdir -p "$E"
export AFLDB_V2_PG_ROOT=$W/pg AFLDB_V2_PG_PORT=61480 AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin NEXT_TELEMETRY_DISABLED=1
DUMP=/mnt/ssd/afldb-rem3-base/rebuilt/afldb_v2_rb_rem3-6d5388ea.dump
TPL=afldb_v2_i371tpl_test
cd "$C"; IR() { node --import tsx tools/v2/isolated-pg.ts "$@"; }
strip() { sed -e 's/\x1b\[[0-9;]*m//g' -e 's#postgres\(ql\)\?://[^ ]*#<dsn>#g'; }

phase_deps() { npm ci --no-audit --no-fund > "$E/npm-ci.log" 2>&1; echo "npm ci rc=$?"; }
phase_pg() {
  [ -d "$W/pg" ] || mkdir -m 700 "$W/pg"
  IR init 2>&1 | strip | tail -1
  IR start > "$W/pg-start.out" 2>&1 < /dev/null; echo "start rc=$?"
  IR roles 2>&1 | strip | tail -1
}
phase_template() {
  echo "dump sha256 $(sha256sum "$DUMP" | cut -c1-64) bytes $(stat -c %s "$DUMP")"
  IR create-db "$TPL" 2>&1 | strip | tail -1
  IR run "$TPL" -- bash -c '
    set -u; u=$AFLDB_TEST_DATABASE_URL
    PGPASSWORD=$(node -e "console.log(decodeURIComponent(new URL(process.argv[1]).password))" "$u") \
    "$AFLDB_V2_PG_BIN/pg_restore" --no-password --no-comments --no-owner -j 4 -h 127.0.0.1 -p "$AFLDB_V2_PG_PORT" \
      -U "$(node -e "console.log(decodeURIComponent(new URL(process.argv[1]).username))" "$u")" -d "$0" "$1" 2>&1
    echo "pg_restore exit=$?"' "$TPL" "$DUMP" 2>&1 | strip | grep -v '^isolated-pg:' | tail -5
}
for p in "$@"; do "phase_$p"; done
