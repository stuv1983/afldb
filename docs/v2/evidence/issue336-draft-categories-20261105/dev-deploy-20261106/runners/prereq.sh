# ISSUE-336 DEV deploy 2026-11-07: read-only prerequisite revalidation (no writes to DEV's checkout, database, services or timers).
set -u
cd ~/projects/afldb
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
echo "now $(date '+%F %T %Z')"
echo "== step0 quiescence"; systemctl is-active afldb-settle-afl-api.service afldb-settle-afl-api-brownlow.service
echo "== step1 before-state"
git rev-parse HEAD; git branch --show-current; git stash list | wc -l; git status --porcelain | wc -l
sha256sum .env | cut -d' ' -f1
cat .next/BUILD_ID; echo; cat .next/standalone/.next/BUILD_ID; echo
echo "MainPID $(systemctl show afldb -p MainPID --value) workers $(pgrep -P "$(systemctl show afldb -p MainPID --value)" | wc -l)"
systemctl is-enabled afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.timer
systemctl is-active afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.timer
systemctl list-timers afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.timer --no-pager | head -4
echo "dev/v2-main exists? [$(git branch --list dev/v2-main)]"
echo "== ledger (read-only role)"
( set -a; . ./.env; set +a
  node -e 'const p=require("postgres");const s=p(process.env.AFLDB_BACKUP_DATABASE_URL,{max:1});s`SELECT count(*)::int n, max(name) last FROM afldb_meta.schema_migrations`.then(r=>{console.log("ledger",r[0].n,r[0].last);return s.end()}).catch(e=>{console.log("ledger ERR",String(e.message).replace(/postgres(ql)?:\/\/\S+/g,"<dsn>"));process.exit(1)})' )
echo "== today's nightly"
journalctl -u afldb-settle-afl-api.service --since "2026-11-07 04:55" --no-pager -o cat \
  | grep -E 'Season feed CD_|Applied as import batch|Source completeness|AFLDB_SETTLE_(SUCCESS|FAILURE)' | cut -c1-200
echo "== health"
curl -s -o /dev/null -D - --max-time 10 http://127.0.0.1:3100/api/health | grep -iE '^HTTP|x-afldb-build'
echo "== disk"; df -h /mnt/ssd "$HOME" | awk '{print $1, $4, $5, $6}'
echo "== isolated cluster and pin checkout"
ls -d /mnt/ssd/afldb/workspaces/i336-preview-20261106/pg-root >/dev/null && echo "pg-root present"
ss -ltn | awk '{print $4}' | grep -E ':(55499|33361|33362)$'
CO=/mnt/ssd/afldb/workspaces/i336-preview2-20261106/checkout
echo "pin checkout $(git -C "$CO" rev-parse HEAD) dirty=$(git -C "$CO" status --porcelain | wc -l)"
ls /mnt/ssd/afldb/backups/ | tail -5
