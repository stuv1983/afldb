# ISSUE-336 DEV deploy 2026-11-07, step 7a DEV-side checks (§7.1 items 1-4 and 7). Usage: bash accept.sh <step1 MainPID> <step1 .env sha256> "<step6 start, local>"
set -u -o pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
P0=${1:?}; E0=${2:?}; S6=${3:?}
cd ~/projects/afldb
bad=0; ok() { echo "PASS $1"; }; no() { echo "FAIL $1"; bad=$((bad+1)); }
chk() { if [ "$2" = "$3" ]; then ok "$1 = $2"; else no "$1: got [$2] want [$3]"; fi; }
echo "now $(date '+%F %T %Z')"
echo "== 1 identity"
chk HEAD "$(git rev-parse HEAD)" 8b024098a6771fc5e5be2f8bf006c9c3ca8ab55a
chk branch "$(git branch --show-current)" dev/v2-main
chk main "$(git rev-parse main)" 242fa276b7b0fcb2613918984e82791faa1143d6
chk stashes "$(git stash list | wc -l)" 2
chk untracked "$(git status --porcelain | wc -l)" 10
chk ".env sha256" "$(sha256sum .env | cut -d' ' -f1)" "$E0"
B1=$(cat .next/BUILD_ID); B2=$(cat .next/standalone/.next/BUILD_ID)
HB=$(curl -s -o /dev/null -D - --max-time 10 http://127.0.0.1:3100/api/health | tr -d '\r' | awk -F': ' 'tolower($1)=="x-afldb-build"{print $2}')
chk "standalone BUILD_ID" "$B2" "$B1"; chk "live x-afldb-build" "$HB" "$B1"
[ "$B1" != 8sFpWkolwF1yKuKbFkOir ] && ok "new build $B1 differs from 8sFp…" || no "build unchanged"
echo "== 2 schema"
L=$( ( set -a; . ./.env; set +a
  node -e 'const p=require("postgres");const s=p(process.env.AFLDB_BACKUP_DATABASE_URL,{max:1});s`SELECT count(*)::int n, max(name) last FROM afldb_meta.schema_migrations`.then(r=>{console.log(r[0].n+" "+r[0].last);return s.end()}).catch(e=>{console.log("ERR");process.exit(1)})' ) )
chk ledger "$L" "118 118_fixtures_unconfirmed_participants.sql"
M=$(npm run db:migrate 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -viE 'postgres(ql)?://|password=' | tail -3)
echo "$M" | sed 's/^/  migrate: /'
echo "$M" | grep -qi 'nothing to apply' && ok "db:migrate nothing to apply" || no "db:migrate did not report nothing to apply"
echo "== 3 health"
chk "afldb active" "$(systemctl is-active afldb)" active
P1=$(systemctl show afldb -p MainPID --value)
[ "$P1" != "$P0" ] && [ "$P1" != 0 ] && ok "MainPID $P1 differs from $P0" || no "MainPID $P1 (before $P0)"
HJ=$(curl -s --max-time 10 -w ' %{http_code}' http://127.0.0.1:3100/api/health); echo "  health: $HJ"
echo "$HJ" | grep -q '"database":"ok".* 200$' && ok "health 200 database ok" || no "health"
echo "== 4 workers"
chk "children of MainPID" "$(pgrep -P "$P1" | wc -l)" 4
W=$(for i in $(seq 1 40); do curl -s -o /dev/null -D - --max-time 5 http://127.0.0.1:3100/api/health | tr -d '\r' | awk -F': ' 'tolower($1)=="x-afldb-worker"{print $2}'; done | sort | uniq -c | tr -s ' ' | tr '\n' ';')
echo "  x-afldb-worker over 40 requests: $W"
chk "distinct workers" "$(echo "$W" | tr ';' '\n' | awk 'NF{print $2}' | sort -u | tr '\n' ' ')" "1 2 3 4 "
echo "== 7 timers"
chk "timers enabled" "$(systemctl is-enabled afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.timer | tr '\n' ' ')" "enabled enabled "
chk "timers active" "$(systemctl is-active afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.timer | tr '\n' ' ')" "active active "
systemctl list-timers afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.timer --no-pager | head -3
echo "unit definitions sha256 (compare with step 1):"
for u in afldb.service afldb-settle-afl-api.service afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.service afldb-settle-afl-api-brownlow.timer; do
  echo "  $u $(systemctl cat "$u" 2>/dev/null | sha256sum | cut -c1-16)"
done
echo "-- Brownlow firings since step 6 ($S6):"
journalctl -u afldb-settle-afl-api-brownlow.service --since "$S6" --no-pager -o short-iso | grep -vE '^\s*$' | cut -c1-200 | tail -15
journalctl -u afldb-settle-afl-api.service --since "$S6" --no-pager -o cat | tail -3 | sed 's/^/  nightly since step 6: /'
echo "DEV-SIDE FAILURES: $bad"
