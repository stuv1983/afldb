#!/bin/bash
set -u
# Reuse the packaged read-only reader definitions (lines 14-75 minus the phase arg), no phase is run.
P=/home/arm/blockc-pkg-ea98a35f2061/docs/v2/evidence/block-c-package-20261102/c-prod.sh
sha256sum $P | cut -c1-64
set -- x
source <(sed -n '14,18p;20,75p' "$P")
backup_identity
echo "setting=[$(setting_raw)]"
echo "--- audit rows by the rehearsal tool"
q -c "SELECT id, at, actor_label, action, detail::text FROM auth_audit_log WHERE actor_label='afl-api-c4b-rehearsal' ORDER BY id" 2>&1
echo "--- other audit rows today for the setting"
q -c "SELECT count(*) FROM auth_audit_log WHERE action='current_season.afl_api_ingestion_set'" 2>&1
echo "--- canonical counts"
q -c "SELECT (SELECT count(*) FROM matches WHERE season=2027), (SELECT count(*) FROM matches m JOIN sources s ON s.id=m.source_id WHERE s.key='afl_api')" 2>&1
q -c "SELECT count(*), max(created_at) FROM import_batches WHERE created_at > now() - interval '1 hour'" 2>&1
unset PGPASSWORD
