#!/usr/bin/env bash
#
# AFLDB — development-server deployment (systemd + Caddy).
#
#   Run as root:   sudo bash ~/projects/afldb/tools/maintenance/01_setup_service.sh
#
# What it does:
#   1. Installs Caddy from the official repository (if not present)
#   2. Installs the afldb systemd unit and enables it at boot
#   3. Installs the development Caddyfile on port 8090
#   4. Creates the afldb_restore_test database used to prove backups
#   5. Starts both services and reports status
#
# What it deliberately does NOT do:
#   - It does not reference, resolve or configure afldb.com.
#   - It does not bind port 80 or 443, so existing services on this host
#     are untouched.
#   - It does not expose PostgreSQL.
#   - It does not create afldb_prod.
#
# Safe to re-run.
#
set -euo pipefail

APP_USER="arm"
PROJECT_DIR="/home/${APP_USER}/projects/afldb"

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: must be run as root (use sudo)." >&2
  exit 1
fi

if [[ ! -d "$PROJECT_DIR" ]]; then
  echo "ERROR: ${PROJECT_DIR} not found." >&2
  exit 1
fi

echo "==> [1/5] Installing Caddy"
if ! command -v caddy > /dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    | tee /etc/apt/sources.list.d/caddy-stable.list > /dev/null
  apt-get update -qq
  apt-get install -y -qq caddy
  echo "    installed $(caddy version | head -1)"
else
  echo "    already installed: $(caddy version | head -1)"
fi

echo "==> [2/5] Installing the afldb systemd unit"
# Pin the actual nvm node path rather than trusting the default.
NODE_BIN="$(sudo -u "$APP_USER" bash -lc 'export NVM_DIR=$HOME/.nvm; . $NVM_DIR/nvm.sh >/dev/null 2>&1; command -v node')"
if [[ -z "$NODE_BIN" ]]; then
  echo "ERROR: could not locate node for user ${APP_USER}." >&2
  exit 1
fi
echo "    node: ${NODE_BIN}"

sed "s|^ExecStart=.*|ExecStart=${NODE_BIN} deploy/server-cluster.mjs|" \
  "${PROJECT_DIR}/deploy/afldb.service" > /etc/systemd/system/afldb.service
chmod 644 /etc/systemd/system/afldb.service
systemctl daemon-reload
systemctl enable afldb > /dev/null
echo "    unit installed and enabled at boot"

echo "==> [3/5] Installing the development Caddyfile"
mkdir -p /etc/caddy /var/log/caddy
chown -R caddy:caddy /var/log/caddy 2>/dev/null || true

# The system Caddyfile may serve sites that have nothing to do with AFLDB.
# One .pre-afldb copy is not a safety net: a second run would overwrite an
# already-replaced file and leave the original unrecoverable. Every
# replacement is kept, and a Caddyfile this script did not write is only
# replaced when the operator says so.
if [[ -f /etc/caddy/Caddyfile ]]; then
  if ! grep -q 'AFLDB' /etc/caddy/Caddyfile && [[ "${AFLDB_REPLACE_CADDYFILE:-}" != "1" ]]; then
    echo "ERROR: /etc/caddy/Caddyfile exists and was not written by AFLDB." >&2
    echo "       It may serve other sites. Merge deploy/Caddyfile into it by hand," >&2
    echo "       or re-run with AFLDB_REPLACE_CADDYFILE=1 to replace it." >&2
    echo "       A timestamped copy is kept either way." >&2
    exit 1
  fi
  BACKUP="/etc/caddy/Caddyfile.pre-afldb.$(date +%Y%m%d-%H%M%S)"
  cp /etc/caddy/Caddyfile "$BACKUP"
  echo "    existing Caddyfile preserved as ${BACKUP}"
fi
cp "${PROJECT_DIR}/deploy/Caddyfile" /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile > /dev/null 2>&1 \
  && echo "    Caddyfile valid" \
  || { echo "ERROR: Caddyfile failed validation" >&2; exit 1; }

echo "==> [4/5] Creating afldb_restore_test"
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='afldb_restore_test'" | grep -q 1; then
  sudo -u postgres createdb -O afldb_owner afldb_restore_test
  sudo -u postgres psql -q -d afldb_restore_test <<'SQL'
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
ALTER SCHEMA public OWNER TO afldb_owner;
SQL
  echo "    created (restore target only; never used by the application)"
else
  echo "    already exists"
fi

echo "==> [5/5] Starting services"
systemctl restart afldb
systemctl restart caddy
sleep 4

echo
echo "=========================================================="
printf ' afldb  : %s\n' "$(systemctl is-active afldb)"
printf ' caddy  : %s\n' "$(systemctl is-active caddy)"
echo
echo ' Direct : http://127.0.0.1:3100/api/health'
echo ' Proxied: http://10.0.40.100:8090/api/health'
echo
echo ' Logs   : journalctl -u afldb -f'
echo
echo ' afldb.com is NOT configured and NOT referenced anywhere.'
echo "=========================================================="
