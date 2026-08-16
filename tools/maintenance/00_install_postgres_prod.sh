#!/usr/bin/env bash
#
# AFLDB — one-time PostgreSQL bootstrap for the PRODUCTION droplet.
#
#   Run as root:   sudo bash ~/projects/afldb/tools/maintenance/00_install_postgres_prod.sh
#
# This is the production counterpart to 00_install_postgres.sh. Production
# runs on its own DigitalOcean droplet (2 vCPU / 4 GB, SYD1) rather than
# alongside development, so the two differ in what they create:
#
#                     development script        this script
#   Databases         afldb_dev, afldb_test     afldb_prod only
#   Roles             same five, same grants    same five, same grants
#   .env AFLDB_ENV    development               production (see below)
#   .env base URL     http://10.0.40.100:3100   https://afldb.com
#
# Role names carry no _prod suffix. The cutover plan proposed afldb_prod_*
# because production was going to share a cluster with development; on a
# dedicated host there is nothing to collide with, and matching names keep
# every DSN variable, grant and privileges test working unchanged.
#
# AFLDB_ENV IS WRITTEN AS production, because this host answers on public
# HTTPS and that flag is what puts Secure on the session cookie, sends HSTS
# and drops 'unsafe-eval' from the CSP.
#
# It used to be written as `development` here, to hold indexing off until
# cutover — which also shipped admin session cookies with no Secure attribute
# on a live HTTPS host. Indexing is now its own flag, AFLDB_INDEXING, left
# unset below and fail-closed: robots.txt returns Disallow: / and every page
# emits noindex until it is explicitly turned on. Flipping THAT is the last
# step of cutover. See src/lib/indexing.ts and docs/production-cutover.md §10.
#
# What it deliberately does NOT do:
#   - It does not change listen_addresses. PostgreSQL stays bound to localhost.
#   - It does not open port 5432 in any firewall.
#   - It does not create afldb_test. Tests do not run on the production host.
#   - It does not enable indexing (see above).
#   - It does not load any data. Restore a dump from development, or run the
#     import pipeline with AFLDB_MIGRATE_TARGET=prod.
#
# NOT freely re-runnable, unlike the development script. Re-running
# regenerates every password, which breaks the running service until it is
# restarted, so an existing .env must be confirmed with --force. The file is
# backed up either way.
#
set -euo pipefail

APP_USER="arm"
PROJECT_DIR="/home/${APP_USER}/projects/afldb"
ENV_FILE="${PROJECT_DIR}/.env"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_NAME="afldb_prod"
FORCE=0

for arg in "$@"; do
  case "${arg}" in
    --force) FORCE=1 ;;
    *) echo "ERROR: unknown argument '${arg}' (only --force is accepted)." >&2; exit 2 ;;
  esac
done

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: must be run as root (use sudo)." >&2
  exit 1
fi

# --- Guard: never run this on the development host --------------------
# Both scripts write the same .env path. Running this one on the
# development server would create afldb_prod there and overwrite the
# development credentials with production ones, taking that deployment
# down and losing the only copy of its passwords. An existing afldb_dev
# database is the reliable signal that this is the wrong machine.
if command -v psql >/dev/null 2>&1; then
  if sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='afldb_dev'" 2>/dev/null | grep -q 1; then
    echo "ERROR: this host has an afldb_dev database, so it is the development" >&2
    echo "       server. Refusing to run: this script would overwrite its .env." >&2
    exit 1
  fi
fi

# --- Guard: do not silently rotate live credentials -------------------
if [[ -f "${ENV_FILE}" && ${FORCE} -eq 0 ]]; then
  echo "ERROR: ${ENV_FILE} already exists." >&2
  echo "       Re-running regenerates every password, which will break the" >&2
  echo "       running service until it is restarted. Pass --force if that" >&2
  echo "       is genuinely what you want." >&2
  exit 1
fi

echo "==> [1/5] Installing PostgreSQL and contrib modules"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq postgresql postgresql-contrib
systemctl enable --now postgresql

PG_VERSION="$(psql --version | awk '{print $3}')"
echo "    PostgreSQL ${PG_VERSION} installed and running"

echo "==> [2/5] Generating role passwords"
gen_pw() { openssl rand -base64 24 | tr -d '/+=' | cut -c1-24; }
PW_OWNER="$(gen_pw)"
PW_APP="$(gen_pw)"
PW_IMPORT="$(gen_pw)"
PW_BACKUP="$(gen_pw)"
PW_AUTH="$(gen_pw)"

echo "==> [3/5] Creating roles and database"
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
-- Roles. NOSUPERUSER/NOCREATEROLE everywhere: the app never runs as superuser.
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='afldb_owner') THEN
    CREATE ROLE afldb_owner  LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='afldb_app') THEN
    CREATE ROLE afldb_app    LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='afldb_import') THEN
    CREATE ROLE afldb_import LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='afldb_backup') THEN
    CREATE ROLE afldb_backup LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB;
  END IF;
  -- Writes ONLY the operational auth/submission tables (migration 023).
  -- The public site role, afldb_app, stays read-only.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='afldb_auth') THEN
    CREATE ROLE afldb_auth   LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB;
  END IF;
END \$\$;

ALTER ROLE afldb_owner  WITH PASSWORD '${PW_OWNER}';
ALTER ROLE afldb_app    WITH PASSWORD '${PW_APP}';
ALTER ROLE afldb_import WITH PASSWORD '${PW_IMPORT}';
ALTER ROLE afldb_backup WITH PASSWORD '${PW_BACKUP}';
ALTER ROLE afldb_auth   WITH PASSWORD '${PW_AUTH}';

-- pg_read_all_data gives afldb_backup dump rights without write access.
GRANT pg_read_all_data TO afldb_backup;
SQL

# Databases must be created outside a transaction block.
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  sudo -u postgres createdb -O afldb_owner "${DB_NAME}"
  echo "    created database ${DB_NAME}"
else
  echo "    database ${DB_NAME} already exists"
fi

echo "==> [4/5] Enabling extensions and setting default privileges"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" <<SQL
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Schema ownership
ALTER SCHEMA public OWNER TO afldb_owner;

-- Nobody creates objects in public except the owner.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT  USAGE  ON SCHEMA public TO afldb_app, afldb_import, afldb_backup, afldb_auth;
GRANT  CREATE ON SCHEMA public TO afldb_owner;

-- Future objects created by afldb_owner. NEITHER application role gets a
-- default privilege here any more. Migration 039 inverted it for afldb_app
-- and migration 045 for afldb_import, so each now reads or writes only what
-- its registry lists — afldb_meta.app_readable_tables and
-- afldb_meta.import_writable_tables — and forgetting to think about a new
-- table denies access instead of granting it. Re-adding a blanket GRANT
-- here would undo migrations 031, 038 and 039 (afldb_app) or 045
-- (afldb_import) on a --force re-run, which is exactly what it used to do.
--
-- Revoked explicitly rather than merely omitted: this script is also run
-- against an existing cluster, where an older copy of itself will have
-- left the defaults behind.
ALTER DEFAULT PRIVILEGES FOR ROLE afldb_owner IN SCHEMA public
  REVOKE SELECT ON TABLES FROM afldb_app;
ALTER DEFAULT PRIVILEGES FOR ROLE afldb_owner IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM afldb_import;
ALTER DEFAULT PRIVILEGES FOR ROLE afldb_owner IN SCHEMA public
  REVOKE USAGE, SELECT, UPDATE ON SEQUENCES FROM afldb_import;
SQL
echo "    ${DB_NAME}: pg_trgm + unaccent enabled, default privileges set"

# Table-level grants come from the reconciler, which reads the registry
# rather than granting by the bucket. On a fresh database it finds no
# tables and says so; `npm run db:migrate && npm run db:privileges`
# finishes the job.
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -f "${SCRIPT_DIR}/privileges.sql"
echo "    ${DB_NAME}: role privileges reconciled"

echo "==> [5/5] Writing ${ENV_FILE}"
mkdir -p "${PROJECT_DIR}"
if [[ -f "${ENV_FILE}" ]]; then
  BACKUP="${ENV_FILE}.bak-$(date +%Y%m%d-%H%M%S)"
  cp -p "${ENV_FILE}" "${BACKUP}"
  chown "${APP_USER}:${APP_USER}" "${BACKUP}"
  echo "    previous .env backed up to ${BACKUP}"
fi

cat > "${ENV_FILE}" <<ENV
# AFLDB environment — PRODUCTION
# GENERATED by tools/maintenance/00_install_postgres_prod.sh
# Contains database credentials. Never commit this file (.gitignore covers it).

NODE_ENV=production

# TRANSPORT SECURITY. This host answers on public HTTPS, so this must say
# production: it is what puts Secure on the session cookie, sends HSTS and
# drops 'unsafe-eval' from the CSP. It does NOT enable indexing.
AFLDB_ENV=production

# INDEXING GATE, deliberately left unset. Fails closed: robots.txt returns
# Disallow: / and every page emits noindex until this says exactly `on`.
# Setting it is the FINAL step of cutover, once the site is publicly correct
# on its real domain — see docs/production-cutover.md §10. It is read at build
# time, so `npm run build` and a restart are both needed afterwards.
# AFLDB_INDEXING=on

AFLDB_BASE_URL=https://afldb.com
PORT=3100

# --- Database -------------------------------------------------------
# One database on this host. AFLDB_OWNER_DATABASE_URL and
# AFLDB_PROD_DATABASE_URL both point at it: the migration runner resolves
# target 'dev' through the former and 'prod' through the latter, and on a
# single-database host both should reach afldb_prod rather than one of
# them failing confusingly.
DATABASE_URL=postgresql://afldb_app:${PW_APP}@localhost:5432/${DB_NAME}
AFLDB_AUTH_DATABASE_URL=postgresql://afldb_auth:${PW_AUTH}@localhost:5432/${DB_NAME}
AFLDB_IMPORT_DATABASE_URL=postgresql://afldb_import:${PW_IMPORT}@localhost:5432/${DB_NAME}
AFLDB_OWNER_DATABASE_URL=postgresql://afldb_owner:${PW_OWNER}@localhost:5432/${DB_NAME}
AFLDB_PROD_DATABASE_URL=postgresql://afldb_owner:${PW_OWNER}@localhost:5432/${DB_NAME}
AFLDB_BACKUP_DATABASE_URL=postgresql://afldb_backup:${PW_BACKUP}@localhost:5432/${DB_NAME}

# AFLDB_TEST_DATABASE_URL is deliberately absent. The integration suite
# refuses to run without it, which is the correct behaviour here: tests
# issue real mutations and must never point at production.

# --- Authentication and beta access ---------------------------------
AFLDB_SESSION_SECRET=$(openssl rand -base64 48 | tr -d '/+=' | cut -c1-48)

# Gate is ON by default. A production host that accidentally serves the
# public before it is ready is a worse failure than one that asks for a
# code. Mint codes in /admin/access once an admin exists
# (tools/admin/create-admin.ts).
AFLDB_BETA_GATE=on
AFLDB_BETA_EPOCH=1

# --- Service --------------------------------------------------------
# Set here, not in deploy/afldb.service: the unit is shared with the
# 24-core development host, which runs 4. One worker per vCPU.
# Peak connections = workers x (AFLDB_POOL_MAX + 3) = 26.
AFLDB_WORKERS=2
AFLDB_POOL_MAX=10

AFLDB_BACKUP_DIR=/home/${APP_USER}/backups/afldb

# --- Query abuse protection -----------------------------------------
AFLDB_MAX_PAGE_SIZE=100
AFLDB_MAX_FILTERS=20
AFLDB_STATEMENT_TIMEOUT_MS=5000

# --- Not set on this host -------------------------------------------
# AFLDB_LEGACY_SQLITE — the legacy source lives on the development
#   server. Production receives data by restore or by an explicitly
#   targeted import, never by reading the legacy database directly.
# AFLDB_EMAIL_INTAKE_SECRET — leaving it unset disables the
#   /api/admin/email-intake route entirely. Set it, with the
#   AFLDB_INTAKE_IMAP_* values, only when that channel is wanted here.
ENV

chown "${APP_USER}:${APP_USER}" "${ENV_FILE}"
chmod 600 "${ENV_FILE}"

echo
echo "=========================================================="
echo " AFLDB PostgreSQL bootstrap complete — PRODUCTION host."
echo
echo "   PostgreSQL : ${PG_VERSION}"
echo "   Database   : ${DB_NAME}"
echo "   Roles      : afldb_owner, afldb_app, afldb_import, afldb_backup, afldb_auth"
echo "   Extensions : pg_trgm, unaccent"
echo "   Credentials: ${ENV_FILE} (mode 600, owner ${APP_USER})"
echo
echo "   Listening  : $(sudo -u postgres psql -tAc 'SHOW listen_addresses') (localhost only)"
echo "   Port 5432 is NOT exposed beyond this host."
echo
echo "   AFLDB_ENV  : production — Secure cookies, HSTS and the strict CSP."
echo "   AFLDB_INDEXING: unset — the site is noindex until you set it to"
echo "                'on'. That is the final cutover step, not this one."
echo
echo " Next: load the schema and data, either"
echo "   AFLDB_MIGRATE_TARGET=prod npm run db:migrate   (schema only), or"
echo "   pg_restore a dump taken from the development host."
echo
echo " Then, either way:"
echo "   npm run db:privileges"
echo
echo " Table-level grants are reconciled from afldb_meta.app_readable_tables,"
echo " which does not exist until the schema is loaded. A pg_restore is taken"
echo " with --no-privileges, so without this step afldb_app can read nothing."
echo "=========================================================="
