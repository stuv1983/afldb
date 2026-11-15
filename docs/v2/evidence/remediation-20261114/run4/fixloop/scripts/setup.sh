#!/usr/bin/env bash
# remediation run 4, scope `fixloop`: workspace setup at the integration tip (clone, cluster, snapshot template, Q'' rebuild template).
# Adapted from run4/qualification-4/scripts/setup.sh. Run:
#   mkdir /mnt/ssd/afldb-rem4-fixloop-20261115 /mnt/ssd/afldb-rem4-fixloop-20261115/in     (plain mkdir: it must NOT exist yet)
#   scp the scripts into $W/in/ ; bash $W/in/setup.sh clone cluster tmpl_snap tmpl_rb
set -u -o pipefail
. "$(dirname "$0")/common.sh"

phase_clone() {
  [ "$(sha256sum "$BUNDLE" | cut -d' ' -f1)" = "$BUNDLE_SHA" ] || { echo "bundle sha256 mismatch"; return 1; }
  grep -F "$BUNDLE_SHA  base-Q3.bundle" /mnt/ssd/afldb-rem4-base/SHA256SUMS >/dev/null || { echo "bundle sha not in SHA256SUMS"; return 1; }
  echo "bundle verified: sha256 $BUNDLE_SHA (and listed in /mnt/ssd/afldb-rem4-base/SHA256SUMS)"
  [ "$(stat -c %s "$SNAP")" = "$SNAP_BYTES" ] || { echo "snapshot size mismatch"; return 1; }
  [ "$(sha256sum "$SNAP" | cut -d' ' -f1)" = "$SNAP_SHA" ] || { echo "snapshot sha256 mismatch"; return 1; }
  echo "snapshot verified: $SNAP_BYTES bytes sha256 $SNAP_SHA"
  [ "$(stat -c %s "$QDUMP")" = "$QDUMP_BYTES" ] || { echo "Q'' dump size mismatch"; return 1; }
  [ "$(sha256sum "$QDUMP" | cut -d' ' -f1)" = "$QDUMP_SHA" ] || { echo "Q'' dump sha256 mismatch"; return 1; }
  echo "Q'' rebuild dump verified: $QDUMP_BYTES bytes sha256 $QDUMP_SHA"
  if ss -ltnH 2>/dev/null | awk '{print $4}' | grep -E ":$PORT$"; then echo "port in use"; return 1; fi
  [ ! -e "$CAND" ] || { echo "checkout already exists: workspace is not fresh"; return 1; }
  git clone -q /mnt/ssd/afldb-review-20261114T0640Z/cand "$CAND" || return 1
  cd "$CAND" || return 1
  git bundle verify "$BUNDLE" 2>&1 | tail -2
  git fetch -q "$BUNDLE" "$BRANCH:refs/heads/base" || return 1
  git checkout -q base || return 1
  echo "HEAD=$(git rev-parse HEAD) want=$TIP"
  [ "$(git rev-parse HEAD)" = "$TIP" ] || { echo "HEAD MISMATCH"; return 1; }
  git merge-base --is-ancestor "$QTRI" HEAD && echo "Q''' $QTRI is an ancestor of HEAD" || { echo "Q''' is NOT an ancestor"; return 1; }
  [ ! -e "$CAND/.env" ] || { echo ".env present: refusing"; return 1; }
  timeout 900 npm ci --no-audit --no-fund 2>&1 | tail -4
  echo "node $(node --version) vitest $(node node_modules/vitest/vitest.mjs --version 2>/dev/null)"
  echo "porcelain lines: $(pc)"
  [ "$(pc)" = 0 ] || return 1
}

phase_cluster() {
  [ ! -e "$AFLDB_V2_PG_ROOT" ] || { echo "cluster root already exists: not fresh"; return 1; }
  IR init || return 1
  IR start > "$E/pg-start.out" 2>&1 < /dev/null
  sleep 3
  IR roles && IR status || return 1
  ss -ltnp 2>/dev/null | grep ":$PORT " | tee "$E/listener.txt"
  PM=$(head -1 "$AFLDB_V2_PG_ROOT/data/postmaster.pid")
  grep "pid=$PM," "$E/listener.txt" >/dev/null || { echo "the listener on $PORT is not this cluster's postmaster"; return 1; }
}

phase_tmpl_snap() {
  IR create-db "$TSNAP" || return 1
  H timeout 3000 bash -c "cd $CAND && node --import tsx tools/v2/isolated-pg.ts run $TSNAP -- node /mnt/ssd/afldb-review-20261114T0640Z/in/restore.mjs $SNAP $SNAP_SHA" 2>&1 | strip | tail -4
  RUNDB "$TSNAP" node --import tsx tools/db/migrate.ts --target test 2>&1 | strip | tail -6
  cp /mnt/ssd/afldb-review-20261114T0640Z/in/probe-dbs.mjs "$CAND/.probe-dbs.mjs"
  RUNDB "$TSNAP" node .probe-dbs.mjs "$TSNAP" | tee "$E/snap-tmpl-probe.txt"
  rm -f "$CAND/.probe-dbs.mjs"
  grep '"ledger":"118_fixtures_unconfirmed_participants.sql"' "$E/snap-tmpl-probe.txt" > /dev/null || { echo "ledger is not 118"; return 1; }
  IR verify "$TSNAP" 2>&1 | strip | tail -2
  {
    echo "identity of the snapshot template (aggregates only):"
    Q "$TSNAP" "SELECT 'ledger_max='||max(name)||' ledger_count='||count(*) FROM afldb_meta.schema_migrations"
    Q "$TSNAP" "SELECT 'matches='||count(*)||' seasons='||min(season)||'..'||max(season)||' players='||(SELECT count(*) FROM players)||' fixtures='||(SELECT count(*) FROM fixtures) FROM matches"
    Q "$TSNAP" "SELECT 'seasons_row_2026='||coalesce(max(status::text),'none') FROM seasons WHERE year=2026"
    Q "$TSNAP" "SELECT 'seasons_in_progress='||coalesce(string_agg(year::text, ',' ORDER BY year),'none') FROM seasons WHERE status::text='in_progress'"
  } 2>&1 | tee "$E/snap-template-identity.txt"
  tcounts "$TSNAP" "$E/snap-template.table-counts.tsv"
  # compare with qual's committed snapshot-template counts (same snapshot, same migrations)
  diff "$CAND/$REPO_EVD/run4/qualification-4/p1/snap-template.table-counts.tsv" "$E/snap-template.table-counts.tsv" > "$E/snap-template-vs-qual.diff" && say "snapshot template 83-table counts IDENTICAL to qual's" || { say "snapshot template counts DIFFER from qual's"; cat "$E/snap-template-vs-qual.diff"; }
}

phase_tmpl_rb() {  # the Q'' dump restored exactly like RESTORE.md (restore-dump.mjs), IR verify, 83-table counts vs qual's committed restored counts, ANALYZE
  IR create-db "$TRB" 2>&1 | strip | tail -1
  H timeout 3000 bash -c "cd $CAND && node --import tsx tools/v2/isolated-pg.ts run $TRB -- node $RB_DIR/restore-dump.mjs $QDUMP $QDUMP_SHA" 2>&1 | strip | tee "$E/rb-restore.log" | tail -6
  IR verify "$TRB" 2>&1 | strip | tee -a "$E/rb-restore.log" | tail -2
  tcounts "$TRB" "$E/rb-table-counts.restored.tsv" > /dev/null
  diff "$CAND/$REPO_EVD/run4/qualification-4/p1/rb-table-counts.restored.tsv" "$E/rb-table-counts.restored.tsv" > "$E/rb-table-counts-vs-qual.diff" && say "Q'' rebuild restore: 83-table exact counts IDENTICAL to qual's committed restored counts ($(wc -l < "$E/rb-table-counts.restored.tsv") tables)" || { say "Q'' rebuild restore counts DIFFER from qual's"; cat "$E/rb-table-counts-vs-qual.diff"; return 1; }
  RUNDB "$TRB" bash -c '"$AFLDB_V2_PG_BIN/psql" -X -q "$AFLDB_TEST_DATABASE_URL" -c ANALYZE' 2>&1 < /dev/null | strip > "$E/rb-analyze.log"
  say "rebuild template: ANALYZE (planner statistics only)"
  {
    echo "identity of the Q'' rebuild template (aggregates only):"
    Q "$TRB" "SELECT 'ledger_max='||max(name)||' ledger_count='||count(*) FROM afldb_meta.schema_migrations"
    Q "$TRB" "SELECT 'matches='||count(*)||' seasons='||min(season)||'..'||max(season)||' players='||(SELECT count(*) FROM players)||' fixtures='||(SELECT count(*) FROM fixtures) FROM matches"
    Q "$TRB" "SELECT 'seasons_row_2026='||coalesce(max(status::text),'none') FROM seasons WHERE year=2026"
    Q "$TRB" "SELECT 'seasons_in_progress='||coalesce(string_agg(year::text, ',' ORDER BY year),'none') FROM seasons WHERE status::text='in_progress'"
  } 2>&1 | tee "$E/rb-template-identity.txt"
}

phase_stop() {
  IR stop; sleep 2
  echo "listeners on $PORT: $(ss -ltnH | awk '{print $4}' | grep -cE ":$PORT$")"
  echo "processes under $W (excluding this check): $(pgrep -u arm -af "$W" | grep -v pgrep | grep -v "setup.sh" | wc -l)"
}

run_phases "$CAND" "$@"
