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
#   2. Reconciles privileges on afldb_dev and afldb_test, which grants
#      afldb_auth the operational tables it owns
#   3. APPENDS AFLDB_AUTH_DATABASE_URL and AFLDB_SESSION_SECRET to .env,
#      touching nothing already there
#
# Either order of this script and `npm run db:migrate` works, because
# step 2 finishes by running tools/maintenance/privileges.sql, which
# applies every afldb_auth grant the migrations may have skipped.
# Idempotent; a re-run changes the afldb_auth password and updates .env
# in place.
set -euo pipefail

APP_USER="arm"
PROJECT_DIR="/home/${APP_USER}/projects/afldb"
ENV_FILE="${PROJECT_DIR}/.env"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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

  # Every afldb_auth grant in migrations 023/024/030/032/034/037 sits
  # inside an `IF EXISTS (afldb_auth)` guard, so all of them were skipped
  # if the migrations ran before this script. The reconciler applies the
  # whole set, which is what makes either order genuinely work.
  #
  # This used to be a hand-copied catch-up block listing migration 023's
  # tables only. It went stale three times over — site_settings (034),
  # beta_join_requests (024) and site_media (037) were all missing — and
  # after migration 038 revoked afldb_app's accidental read of site_media,
  # the migrate-first ordering left NO role able to read it, taking
  # /admin/content and Publish down with a permission error.
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DB}" -f "${SCRIPT_DIR}/privileges.sql"
  echo "    ${DB}: role privileges reconciled"
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
