#!/usr/bin/env bash
# GAP-029 hardening: READ-ONLY production-host prerequisites probe (files and versions only; no database connection, no credential value read or printed,
# nothing created, no service touched). Stream it: cmd /c "ssh -o BatchMode=yes afldb bash -s < probe-prod-prereqs.sh > probe-prod-prereqs.out 2>&1"
{
set -u
export LC_ALL=C PYTHONDONTWRITEBYTECODE=1
R=/home/arm/projects/afldb
echo "== H $(date -u +%FT%TZ) host=$(hostname) user=$(id -un)"
echo "== checkout (read-only git)"; echo "HEAD=$(GIT_OPTIONAL_LOCKS=0 git -C "$R" rev-parse HEAD 2>&1) dirty_tracked=$(GIT_OPTIONAL_LOCKS=0 git -C "$R" status --porcelain --untracked-files=no 2>/dev/null | wc -l)"
echo "== node"; /home/arm/.nvm/versions/node/v22.23.2/bin/node -v 2>&1
echo "== node_modules: $(ls "$R/node_modules" 2>/dev/null | wc -l) entries; tsx: $(ls -d "$R/node_modules/tsx" 2>/dev/null | wc -l); postgres: $(ls -d "$R/node_modules/postgres" 2>/dev/null | wc -l)"
echo "== python"; for p in "$R/.venv/bin/python" /usr/bin/python3; do if [ -x "$p" ]; then printf '%s: ' "$p"; "$p" -c 'import sys;print(sys.version.split()[0], end=" ")' 2>&1; "$p" -c 'import psycopg;print("psycopg", psycopg.__version__)' 2>&1 | tail -1; else echo "$p: absent"; fi; done
echo "== env var NAMES present in the checkout .env (counts only)"; for n in AFLDB_BACKUP_DATABASE_URL AFLDB_IMPORT_DATABASE_URL AFLDB_DATABASE_URL; do echo "$n lines=$(grep -c "^$n=" "$R/.env" 2>/dev/null)"; done
echo "== disk"; df -h /home/arm | tail -1
echo "== backups dir"; ls -d /home/arm/backups/afldb 2>&1 | head -1; ls /home/arm/backups/afldb 2>/dev/null | tail -3
echo "== done"
}
