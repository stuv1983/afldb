#!/usr/bin/env bash
#
# AFLDB — prepare the directory the apex coming-soon page publishes into.
#
#   Run as root:   sudo bash ~/projects/afldb/tools/maintenance/03_apex_dir.sh
#
# The apex page at afldb.com is PUBLISHED by the application and SERVED by
# Caddy (docs/apex-coming-soon.md §8). That splits ownership of one directory
# between two users, and getting it wrong is the single most common way a
# publish fails:
#
#   the service user  writes  index.html, style.css and img/u/*   -> needs rwx
#   caddy             reads   the same tree                        -> needs r-x
#
# Deploying with `chown -R caddy:caddy`, which this project's deployment guide
# used to say, satisfies the reader and locks out the writer. Every Save then
# reports
#
#   Saved, but the page could not be written:
#   EACCES: permission denied, mkdir '/var/www/afldb-soon/img/u'
#
# which is what this script exists to prevent and to repair. It is idempotent:
# run it on a fresh host, or on a broken one, or twice.
#
# It does NOT copy the page in. /var/www/afldb-soon is derived and disposable —
# everything in it comes from git or from PostgreSQL — so the way to fill it is
# to press Republish at /admin/content, which is also the way to prove the
# permissions are now right.
#
set -euo pipefail

APP_USER="${AFLDB_APP_USER:-arm}"
WEB_USER="${AFLDB_WEB_USER:-caddy}"
APEX_DIR="${AFLDB_APEX_DIR:-/var/www/afldb-soon}"
UNIT="/etc/systemd/system/afldb.service"

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: must be run as root (use sudo)." >&2
  exit 1
fi

for user in "$APP_USER" "$WEB_USER"; do
  if ! id "$user" >/dev/null 2>&1; then
    echo "ERROR: no such user '${user}'." >&2
    echo "       Override with AFLDB_APP_USER= / AFLDB_WEB_USER= if this host differs." >&2
    exit 1
  fi
done

echo "==> Preparing ${APEX_DIR}"
mkdir -p "${APEX_DIR}/img/u"

# Owner writes, group reads. 750 on the directories rather than 755: nothing
# outside the service and the web server has any business listing this tree.
chown -R "${APP_USER}:${WEB_USER}" "${APEX_DIR}"
find "${APEX_DIR}" -type d -exec chmod 750 {} +
find "${APEX_DIR}" -type f -exec chmod 640 {} +

echo "==> Ownership now:"
ls -ld "${APEX_DIR}" "${APEX_DIR}/img" "${APEX_DIR}/img/u"

# The second half of the problem. ProtectSystem=strict makes the whole of /var
# read-only for the service, so correct ownership alone still fails — with the
# same EACCES, from a different cause. Checked rather than edited: this script
# does not rewrite a unit file behind anyone's back.
echo "==> Checking the systemd unit grants the path"
if [[ -f "$UNIT" ]]; then
  if grep -qE "^ReadWritePaths=-?${APEX_DIR}\$" "$UNIT"; then
    echo "    OK: ReadWritePaths covers ${APEX_DIR}"
  else
    echo "    MISSING: ${UNIT} has no ReadWritePaths= line for ${APEX_DIR}." >&2
    echo "    ProtectSystem=strict will keep every publish failing until it does." >&2
    echo "    Copy the unit from the repository and reload:" >&2
    echo "      sudo cp ~/${APP_USER}/projects/afldb/deploy/afldb.service ${UNIT}" >&2
    echo "      sudo systemctl daemon-reload && sudo systemctl restart afldb" >&2
    exit 1
  fi
else
  echo "    ${UNIT} not installed on this host; skipping that check."
fi

# The application only publishes when it is told where to. Unset is legitimate
# (it is the correct state in development), but on the host that just had its
# apex directory prepared it is almost certainly an oversight.
echo "==> Checking AFLDB_APEX_DIR is set for the service"
ENV_FILE="/home/${APP_USER}/projects/afldb/.env"
if [[ -f "$ENV_FILE" ]] && grep -q '^AFLDB_APEX_DIR=' "$ENV_FILE"; then
  echo "    OK: set in ${ENV_FILE}"
else
  echo "    NOT SET in ${ENV_FILE}. Add it, then restart the service:"
  echo "      echo 'AFLDB_APEX_DIR=${APEX_DIR}' >> ${ENV_FILE}"
  echo "      sudo systemctl restart afldb"
fi

echo
echo "Done. Now open /admin/content and press Republish."
echo "The Publishing panel there reports the directory's state before you save."
