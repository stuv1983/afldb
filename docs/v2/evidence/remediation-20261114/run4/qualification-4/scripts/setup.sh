#!/usr/bin/env bash
# remediation run 4, scope `qual`: workspace setup at Q'' (clone, second checkout for the rebuild, cluster, snapshot template).
#   mkdir /mnt/ssd/afldb-rem4-qual-20261115 /mnt/ssd/afldb-rem4-qual-20261115/in      (plain mkdir: it must NOT exist yet)
#   scp common.sh setup.sh ... into $W/in/
#   bash $W/in/setup.sh clone rbclone cluster tmpl_snap
set -u -o pipefail
. "$(dirname "$0")/common.sh"

phase_clone() {
  [ "$(sha256sum "$BUNDLE" | cut -d' ' -f1)" = "$BUNDLE_SHA" ] || { echo "bundle sha256 mismatch"; return 1; }
  grep -F "$BUNDLE_SHA  base-Qpp.bundle" /mnt/ssd/afldb-rem4-base/SHA256SUMS >/dev/null || { echo "bundle sha not in SHA256SUMS"; return 1; }
  echo "bundle verified: sha256 $BUNDLE_SHA (and listed in /mnt/ssd/afldb-rem4-base/SHA256SUMS)"
  [ "$(stat -c %s "$SNAP")" = "$SNAP_BYTES" ] || { echo "snapshot size mismatch"; return 1; }
  [ "$(sha256sum "$SNAP" | cut -d' ' -f1)" = "$SNAP_SHA" ] || { echo "snapshot sha256 mismatch"; return 1; }
  echo "snapshot verified: $SNAP_BYTES bytes sha256 $SNAP_SHA"
  ( cd "$RB_DIR" && sha256sum -c SHA256SUMS ) || { echo "rebuilt dir SHA256SUMS check failed"; return 1; }
  [ "$(sha256sum "$RB_DUMP" | cut -d' ' -f1)" = "$RB_SHA" ] || { echo "run-3 rebuilt dump sha256 mismatch"; return 1; }
  [ "$(sha256sum "$BRIDGE" | cut -d' ' -f1)" = "$BRIDGE_SHA" ] || { echo "bridge child sha256 mismatch"; return 1; }
  echo "run-3 rebuilt dump and bridge child verified"
  if ss -ltnH 2>/dev/null | awk '{print $4}' | grep -E ":$PORT$"; then echo "port in use"; return 1; fi
  [ ! -e "$CAND" ] || { echo "checkout already exists: workspace is not fresh"; return 1; }
  git clone -q /mnt/ssd/afldb-review-20261114T0640Z/cand "$CAND" || return 1
  cd "$CAND" || return 1
  git bundle verify "$BUNDLE" 2>&1 | tail -2
  git fetch -q "$BUNDLE" claude/rem4-qual-20261115:refs/heads/base || return 1
  git checkout -q base || return 1
  echo "HEAD=$(git rev-parse HEAD) want=$QPP"
  [ "$(git rev-parse HEAD)" = "$QPP" ] || { echo "HEAD MISMATCH"; return 1; }
  [ ! -e "$CAND/.env" ] || { echo ".env present: refusing"; return 1; }
  git diff --quiet 6d5388ea5305e73b0420fbccfa7b0cea4fe75927 "$QPP" -- package.json package-lock.json && echo "package.json and package-lock.json unchanged since 6d5388ea" \
    || { echo "PACKAGE FILES DIFFER from 6d5388ea"; git diff --stat 6d5388ea5305e73b0420fbccfa7b0cea4fe75927 "$QPP" -- package.json package-lock.json; }
  timeout 900 npm ci --no-audit --no-fund 2>&1 | tail -4
  echo "node $(node --version) vitest $(node node_modules/vitest/vitest.mjs --version 2>/dev/null)"
  echo "porcelain lines: $(pc)"
  [ "$(pc)" = 0 ] || return 1
}

phase_rbclone() {
  [ ! -e "$RB" ] || { echo "rb checkout already exists"; return 1; }
  git clone -q "$CAND" "$RB" || return 1
  cd "$RB" || return 1
  git checkout -q --detach "$QPP" || return 1
  echo "RB HEAD=$(git rev-parse HEAD) want=$QPP"
  [ "$(git rev-parse HEAD)" = "$QPP" ] || { echo "HEAD MISMATCH"; return 1; }
  [ ! -e "$RB/.env" ] || { echo ".env present: refusing"; return 1; }
  timeout 900 npm ci --no-audit --no-fund 2>&1 | tail -4
  echo "RB porcelain lines: $(pc "$RB")"
  [ "$(pc "$RB")" = 0 ] || return 1
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
    Q "$TSNAP" "SELECT 'player_match_stats_authority_rows='||count(*) FROM data_overrides WHERE entity_type='player_match_stats'"
    Q "$TSNAP" "SELECT 'draft_picks='||(SELECT count(*) FROM draft_picks)||' draft_persons='||(SELECT count(*) FROM draft_persons)"
  } 2>&1 | tee "$E/snap-template-identity.txt"
  tcounts "$TSNAP" "$E/snap-template.table-counts.tsv"
}

phase_stop() {
  IR stop; sleep 2
  echo "listeners on $PORT: $(ss -ltnH | awk '{print $4}' | grep -cE ":$PORT$")"
  echo "processes under $W (excluding this check): $(pgrep -u arm -af "$W" | grep -v pgrep | grep -v "setup.sh" | wc -l)"
}

run_phases "$CAND" "$@"
