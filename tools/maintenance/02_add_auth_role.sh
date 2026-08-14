#!/usr/bin/env bash
#
# AFLDB — add the afldb_auth role to an EXISTING installation.
#
#   sudo bash ~/projects/afldb/tools/maintenance/02_add_auth_role.sh
#
# 00_install_postgres.sh regenerates every password and rewrites .env,
# which is exactly wrong for a live server. This script does only what
# migration 023 needs:
#
#   1. Creates the afldb_auth login role (if missing) with a new password
#   2. Grants USAGE on the public schema of afldb_dev and afldb_test
#   3. APPENDS AFLDB_AUTH_DATABASE_URL and AFLDB_SESSION_SECRET to .env,
#      touching nothing already there
#
# Table-level grants live in migration 023 itself, so the order is:
# run this, then `npm run db:migrate`. Idempotent; a re-run changes the
# afldb_auth password and updates .env in place.
set -euo pipefail

APP_USER="arm"
PROJECT_DIR="/home/${APP_USER}/projects/afldb"
ENV_FILE="${PROJECT_DIR}/.env"

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: must be run as root (use sudo)." >&2
  exit 1
fi
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERROR: ${ENV_FILE} not found; run 00_install_postgres.sh first." >&2
  exit 1
fi

gen_pw() { openssl rand -base64 24 | tr -d '/+=' | cut -c1-24; }
PW_AUTH="$(gen_pw)"
SESSION_SECRET="$(openssl rand -base64 48 | tr -d '/+=' | cut -c1-48)"

echo "==> Creating role afldb_auth"
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='afldb_auth') THEN
    CREATE ROLE afldb_auth LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB;
  END IF;
END \$\$;
ALTER ROLE afldb_auth WITH PASSWORD '${PW_AUTH}';
SQL

for DB in afldb_dev afldb_test; do
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DB}" \
    -c "GRANT USAGE ON SCHEMA public TO afldb_auth;"
  echo "    ${DB}: schema usage granted"

  # Migration 023 applies these same grants inside a DO block, but only
  # when the role already exists. If the migration ran first the grants
  # were skipped, so they are repeated here whenever the tables exist —
  # either order of "run this script" and "npm run db:migrate" works.
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DB}" <<'SQL'
DO $$
BEGIN
  IF to_regclass('public.auth_users') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE ON auth_users, auth_sessions,
      beta_access_codes, beta_allowed_emails, beta_login_tokens,
      data_submissions, data_submission_rows TO afldb_auth;
    GRANT INSERT, SELECT ON auth_audit_log TO afldb_auth;
    GRANT DELETE ON data_submission_rows TO afldb_auth;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO afldb_auth;
    GRANT SELECT ON players, player_clubs, clubs, club_aliases, seasons,
      awards, award_nominations, award_winners, import_batches TO afldb_auth;
    RAISE NOTICE 'table grants applied';
  ELSE
    RAISE NOTICE 'migration 023 not applied yet; table grants will come from it';
  END IF;
END $$;
SQL
done

echo "==> Updating ${ENV_FILE}"
# Replace the URL line if present (password rotation), else append both.
if grep -q '^AFLDB_AUTH_DATABASE_URL=' "${ENV_FILE}"; then
  sed -i "s|^AFLDB_AUTH_DATABASE_URL=.*|AFLDB_AUTH_DATABASE_URL=postgresql://afldb_auth:${PW_AUTH}@localhost:5432/afldb_dev|" "${ENV_FILE}"
else
  printf '\n# Auth role: writes only the operational auth/submission tables (migration 023).\nAFLDB_AUTH_DATABASE_URL=postgresql://afldb_auth:%s@localhost:5432/afldb_dev\n' "${PW_AUTH}" >> "${ENV_FILE}"
fi
# The session secret is never rotated silently: rotating it signs every
# visitor out. Created only when absent.
if ! grep -q '^AFLDB_SESSION_SECRET=' "${ENV_FILE}"; then
  printf 'AFLDB_SESSION_SECRET=%s\n' "${SESSION_SECRET}" >> "${ENV_FILE}"
fi
chown "${APP_USER}:${APP_USER}" "${ENV_FILE}"
chmod 600 "${ENV_FILE}"

echo "Done. Now run: npm run db:migrate && sudo systemctl restart afldb"
