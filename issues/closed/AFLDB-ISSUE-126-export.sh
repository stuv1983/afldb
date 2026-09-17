#!/usr/bin/env bash
# AFLDB-ISSUE-126 T0 — export the rows to be restored FROM afldb_prod_auth_recovery (read-only).
#
# Run on afldb-prod:  bash issues/open/AFLDB-ISSUE-126-export.sh
# Writes /home/arm/i126/{audit,settings,media,join}.csv (mode 600). Delete the directory at
# close-out. Reads only: the session is forced read-only. Prints no DSN and no secret.
set -euo pipefail
echo "host: $(hostname)"
cd /home/arm/projects/afldb
set -a; . ./.env; set +a
OWNER_DSN="${AFLDB_OWNER_DATABASE_URL:?AFLDB_OWNER_DATABASE_URL unset}"
BASE="${OWNER_DSN%%\?*}"; QS=""; case "$OWNER_DSN" in *\?*) QS="?${OWNER_DSN#*\?}";; esac
RECV_DSN="${BASE%/*}/afldb_prod_auth_recovery${QS}"
OUT=/home/arm/i126
mkdir -p "$OUT"; chmod 700 "$OUT"
export PGOPTIONS='-c default_transaction_read_only=on'
psql -X -v ON_ERROR_STOP=1 -P pager=off "$RECV_DSN" <<'SQL'
SELECT current_database() AS db, current_setting('default_transaction_read_only') AS ro;
\copy (SELECT id, at, actor_user_id, actor_label, action, detail, ip FROM auth_audit_log ORDER BY id) TO '/home/arm/i126/audit.csv' WITH (FORMAT csv, HEADER)
\copy (SELECT key, value, updated_at, updated_by FROM site_settings WHERE key IN ('apex.content','early_access.intro','early_access.notify','early_access.questions','home.aflw_leaders','home.record_of_the_week','site.footer') ORDER BY key) TO '/home/arm/i126/settings.csv' WITH (FORMAT csv, HEADER)
\copy (SELECT name, mime, bytes, byte_size, width, height, alt, uploaded_at, uploaded_by FROM site_media ORDER BY name) TO '/home/arm/i126/media.csv' WITH (FORMAT csv, HEADER)
\copy (SELECT id, email, name, message, status, requested_at, reviewed_by, reviewed_at, ip, answers FROM beta_join_requests ORDER BY id) TO '/home/arm/i126/join.csv' WITH (FORMAT csv, HEADER)
SQL
chmod 600 "$OUT"/*.csv
wc -l "$OUT"/*.csv
sha256sum "$OUT"/*.csv
echo "EXPORT: OK"
