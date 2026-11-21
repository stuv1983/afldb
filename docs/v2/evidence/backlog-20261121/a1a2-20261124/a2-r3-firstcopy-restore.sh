#!/usr/bin/env bash
# Sitting A2, R3 acceptance on STREAMANATOR (not production): restore the first pulled off-host dump into a throwaway database
# on a NEW, private PostgreSQL 16 cluster (reviewer F-007). The cluster lives in a new 0700 workspace, listens on NO TCP port
# (unix socket inside the workspace only), is stopped at the end, and its workspace is deleted by the `cleanup` mode after the
# result is recorded. The workspace holds production data while it exists.
#   restore <dump>      sidecar check, initdb, start, createdb firstcopy_test, pg_restore --no-owner --no-acl, counts, stop
#   cleanup <workspace> rm -rf of exactly one /mnt/ssd/afldb-a2-firstcopy-<STAMP> directory whose cluster is stopped
# Tested 2026-11-22 (run c) on streamanator with the accepted source-only rebuild dump (no production data).
# Run (streamanator, as arm): bash a2-r3-firstcopy-restore.sh restore /mnt/ssd/afldb-offhost-prod/<afldb_prod-….dump>
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
PGB=/usr/lib/postgresql/16/bin; BASE=${AFLDB_FIRSTCOPY_BASE:-/mnt/ssd}
MODE=${1:?restore|cleanup}
case $MODE in
restore)
  DUMP=${2:?dump}; [ -f "$DUMP" ] && [ -f "$DUMP.sha256" ]
  ( cd "$(dirname "$DUMP")" && sha256sum -c "$(basename "$DUMP").sha256" ); echo "PASS sidecar verifies"
  WS=$BASE/afldb-a2-firstcopy-$(date -u +%Y%m%dT%H%M%SZ); [ ! -e "$WS" ]; mkdir -m 700 "$WS"; mkdir -m 700 "$WS/sock"
  echo "workspace $WS"
  "$PGB/initdb" -D "$WS/data" -A trust -U arm -E UTF8 --locale=C.UTF-8 --no-instructions > "$WS/initdb.log"
  "$PGB/pg_ctl" -D "$WS/data" -l "$WS/pg.log" -w -o "-c listen_addresses='' -k $WS/sock" start > /dev/null; echo "cluster started (socket only)"
  stopit() { "$PGB/pg_ctl" -D "$WS/data" -m fast -w stop > /dev/null && echo "cluster stopped"; }
  trap 'echo "STOP line $LINENO: $BASH_COMMAND"; stopit || true' ERR
  "$PGB/createdb" -h "$WS/sock" -U arm firstcopy_test
  rc=0; "$PGB/pg_restore" -h "$WS/sock" -U arm -d firstcopy_test --no-owner --no-acl "$DUMP" 2> "$WS/restore.err" || rc=$?
  echo "pg_restore exit=$rc, stderr lines $(wc -l < "$WS/restore.err")"; head -n 5 "$WS/restore.err"
  "$PGB/psql" -h "$WS/sock" -U arm -d firstcopy_test -X -At -v ON_ERROR_STOP=1 <<'SQL'
SELECT 'ledger|'||count(*)||'|'||max(name) FROM afldb_meta.schema_migrations;
SELECT 'seasons|'||count(*)||'|'||max(year) FROM seasons;
SELECT 'matches|'||count(*)||'|'||max(id) FROM matches;
SELECT 'players|'||count(*) FROM players;
SELECT 'player_match_stats|'||count(*) FROM player_match_stats;
SELECT 'brownlow_season_votes_2026|'||count(*)||'|'||coalesce(sum(votes),0) FROM brownlow_season_votes WHERE season=2026;
SQL
  stopit
  [ $rc = 0 ] && echo "FIRSTCOPY RESULT RESTORE PASS ($WS); record, then: bash $0 cleanup $WS" || { echo "FIRSTCOPY RESULT RESTORE FAIL rc=$rc ($WS)"; exit 1; };;
cleanup)
  WS=${2:?workspace}; [[ $WS =~ ^$BASE/afldb-a2-firstcopy-[0-9]{8}T[0-9]{6}Z$ ]] || { echo "STOP not a firstcopy workspace"; exit 1; }
  [ ! -e "$WS/data/postmaster.pid" ] || { echo "STOP cluster still running"; exit 1; }
  rm -rf -- "$WS"; echo "FIRSTCOPY RESULT CLEANUP DONE $WS";;
*) echo "usage: restore <dump> | cleanup <workspace>"; exit 2;;
esac
