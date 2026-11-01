#!/bin/bash
# Runs INSIDE isolated-pg `run` (the DSNs are in the environment). DISPOSABLE rehearsal database ONLY.
# Switch ON as the owner, the REAL settle CLI --apply on the pinned snapshot, switch OFF as an explicit boolean false, then two SYNTHETIC audit
# rows shaped like the window's (the window cannot run on the DEV host: enabled AFL API timers; it was rehearsed 46/46 with simulated host facts).
P=/usr/lib/postgresql/16/bin/psql
o() { "$P" "$AFLDB_OWNER_DATABASE_URL" -X -At -v ON_ERROR_STOP=1 "$@"; }
L=afl-api-2027-2026-11-01-012026
cd "$1" || exit 1
D=${2//\'/\'\'}
o -c "INSERT INTO site_settings(key, value) VALUES ('acquisition.afl_api_current_season_enabled', 'true'::jsonb) ON CONFLICT (key) DO UPDATE SET value='true'::jsonb" || exit 1
node --import tsx tools/current-season/settle-afl-api-fixture-schedule.ts --label $L --apply 2>&1 | tail -3; [ "${PIPESTATUS[0]}" = 0 ] || exit 1
o -c "UPDATE site_settings SET value='false'::jsonb WHERE key='acquisition.afl_api_current_season_enabled'" || exit 1
for v in true false; do
  o -c "INSERT INTO auth_audit_log(actor_user_id, actor_label, action, detail) VALUES (NULL, 'afl-api-fixture-window', 'current_season.afl_api_ingestion_set', jsonb_build_object('via','afl-api-fixture-window','decision','$D','run_id','rehearsal-run-1','value',$v))" || exit 1
done
echo "apply-inner done"
