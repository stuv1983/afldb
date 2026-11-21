#!/usr/bin/env bash
# ISSUE-363 tier P: expected-refusal controls against REAL isolated databases (the unit tests cover the same rules DB-free).
# Each control runs the tool with --apply on a fresh disposable copy; the tool must exit non-zero and write nothing (no --out directory).
#   bash negctl.sh   (needs the tier S template afldb_v2_rb_s_test and a built tier P database afldb_v2_rb_p1_overlay_test)
set -uo pipefail; export LC_ALL=C
W=/mnt/ssd/afldb-backlog-20261122b-363; T=$W/scripts/tier-p.sh
ST=afldb_v2_rb_s_test; P1=afldb_v2_rb_p1_overlay_test
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
export AFLDB_V2_PG_ROOT=$W/pg AFLDB_V2_PG_PORT=61530 AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin
IR() { (cd "$W/cand" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
ctl() { # <name> <source-db> <target-db> <template-name>
  local name=$1 src=$2 db=$3 tpl=$4
  IR create-db "$db" --template "$src" > /dev/null 2>&1
  echo "## control $name: target $db (copy of $src), --template-name $tpl"
  bash "$T" nc negctl "$db" "$tpl" "$name" 2>&1 | grep -v '^==' | cut -c1-420
  IR drop-db "$db" --acknowledge-destroy "$db" > /dev/null 2>&1
}
ctl wrong-database-name   "$ST" afldb_v2_rb_nc1_test          "$ST"
ctl preexisting-accounts  "$P1" afldb_v2_rb_nc2_overlay_test  "$ST"
ctl target-equals-template "$ST" afldb_v2_rb_nc3_overlay_test afldb_v2_rb_nc3_overlay_test
ctl template-does-not-exist "$ST" afldb_v2_rb_nc4_overlay_test afldb_v2_rb_missing_test
