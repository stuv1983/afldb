#!/usr/bin/env bash
#
# AFLDB — one-time PostgreSQL bootstrap for the development server.
#
#   Run as root:   sudo bash ~/projects/afldb/tools/maintenance/00_install_postgres.sh
#
# What it does:
#   1. Installs PostgreSQL + contrib (for pg_trgm) from the Ubuntu archive
#   2. Creates the afldb_dev and afldb_test databases
#   3. Creates four least-privilege roles with generated random passwords
#   4. Enables the pg_trgm and unaccent extensions
#   5. Writes credentials to /home/arm/projects/afldb/.env (mode 600, owned by arm)
#
# What it deliberately does NOT do:
#   - It does not change listen_addresses. PostgreSQL stays bound to localhost.
#   - It does not open port 5432 in any firewall.
#   - It does not create afldb_prod.
#   - It does not touch afldb.com, DNS, or any existing service on this host.
#
# Safe to re-run: every step is idempotent. Re-running regenerates passwords
# and rewrites .env.
#
set -euo pipefail

APP_USER="arm"
PROJECT_DIR="/home/${APP_USER}/projects/afldb"
ENV_FILE="${PROJECT_DIR}/.env"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: must be run as root (use sudo)." >&2
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

echo "==> [3/5] Creating roles and databases"
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
for DB in afldb_dev afldb_test; do
  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB}'" | grep -q 1; then
    sudo -u postgres createdb -O afldb_owner "${DB}"
    echo "    created database ${DB}"
  else
    echo "    database ${DB} already exists"
  fi
done

echo "==> [4/5] Enabling extensions and setting default privileges"
for DB in afldb_dev afldb_test; do
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DB}" <<SQL
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Schema ownership
ALTER SCHEMA public OWNER TO afldb_owner;

-- Nobody creates objects in public except the owner.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT  USAGE  ON SCHEMA public TO afldb_app, afldb_import, afldb_backup, afldb_auth;
GRANT  CREATE ON SCHEMA public TO afldb_owner;

-- Future objects created by afldb_owner. afldb_import keeps a default
-- privilege because every new statistical table is a reload target for
-- it; afldb_app deliberately has none. Migration 039 inverted that: the
-- public role reads only what afldb_meta.app_readable_tables lists, so
-- that forgetting to think about a new table denies access instead of
-- granting it. Re-adding a blanket GRANT here would undo migrations 031,
-- 038 and 039 on every re-run of this script, which is exactly what it
-- used to do.
ALTER DEFAULT PRIVILEGES FOR ROLE afldb_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO afldb_import;
ALTER DEFAULT PRIVILEGES FOR ROLE afldb_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO afldb_import;
SQL
  echo "    ${DB}: pg_trgm + unaccent enabled, default privileges set"

  # Table-level grants come from the reconciler, which reads the registry
  # rather than granting by the bucket. On a fresh database it finds no
  # tables and says so; the operator runs `npm run db:migrate` and then
  # `npm run db:privileges` to finish the job (step [5/5] prints this).
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DB}" -f "${SCRIPT_DIR}/privileges.sql"
  echo "    ${DB}: role privileges reconciled"
done

echo "==> [5/5] Writing ${ENV_FILE}"
mkdir -p "${PROJECT_DIR}"
cat > "${ENV_FILE}" <<ENV
# AFLDB environment — GENERATED by tools/maintenance/00_install_postgres.sh
# Contains database credentials. Never commit this file (.gitignore covers it).

NODE_ENV=development
AFLDB_ENV=development
AFLDB_BASE_URL=http://10.0.40.100:3100
PORT=3100

DATABASE_URL=postgresql://afldb_app:${PW_APP}@localhost:5432/afldb_dev
AFLDB_AUTH_DATABASE_URL=postgresql://afldb_auth:${PW_AUTH}@localhost:5432/afldb_dev
AFLDB_SESSION_SECRET=$(openssl rand -base64 48 | tr -d '/+=' | cut -c1-48)
AFLDB_IMPORT_DATABASE_URL=postgresql://afldb_import:${PW_IMPORT}@localhost:5432/afldb_dev
AFLDB_OWNER_DATABASE_URL=postgresql://afldb_owner:${PW_OWNER}@localhost:5432/afldb_dev
AFLDB_TEST_DATABASE_URL=postgresql://afldb_owner:${PW_OWNER}@localhost:5432/afldb_test
AFLDB_BACKUP_DATABASE_URL=postgresql://afldb_backup:${PW_BACKUP}@localhost:5432/afldb_dev

AFLDB_LEGACY_SQLITE=/home/${APP_USER}/projects/sports_data_lab/data/afl/afl.db

AFLDB_MAX_PAGE_SIZE=100
AFLDB_MAX_FILTERS=20
AFLDB_STATEMENT_TIMEOUT_MS=5000
ENV

chown "${APP_USER}:${APP_USER}" "${ENV_FILE}"
chmod 600 "${ENV_FILE}"

echo
echo "=========================================================="
echo " AFLDB PostgreSQL bootstrap complete."
echo
echo "   PostgreSQL : ${PG_VERSION}"
echo "   Databases  : afldb_dev, afldb_test"
echo "   Roles      : afldb_owner, afldb_app, afldb_import, afldb_backup"
echo "   Extensions : pg_trgm, unaccent"
echo "   Credentials: ${ENV_FILE} (mode 600, owner ${APP_USER})"
echo
echo "   Listening  : $(sudo -u postgres psql -tAc 'SHOW listen_addresses') (localhost only)"
echo "   Port 5432 is NOT exposed beyond this host."
echo
echo "   NEXT, as ${APP_USER}:"
echo "     npm run db:migrate     # creates the tables"
echo "     npm run db:privileges  # grants afldb_app the ones it may read"
echo
echo "   The second is not optional on a database that already had tables"
echo "   when this script ran: table-level grants are reconciled from"
echo "   afldb_meta.app_readable_tables, which only exists after migrating."
echo "=========================================================="
