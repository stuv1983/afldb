:
{
# ISSUE-333 post-apply visibility probe, production, READ-ONLY. Reads process, file-system and (for the gate) anonymous HTTP status only.
# It does NOT mint, forge or replay any session/beta cookie, restarts nothing, writes nothing. Output to stdout only.
#   bash visibility-probe-i333-o2.sh
set -u -o pipefail
export LC_ALL=C
step() { echo "== $* $(date -u +%FT%TZ)"; }
[ "$(hostname)" = afldb-prod ] && [ "$(id -un)" = arm ] || { echo "STOP: unexpected host/user"; exit 3; }
step "S service and workers"
systemctl is-active afldb.service
systemctl show -p MainPID,ActiveEnterTimestamp,WorkingDirectory,ExecStart afldb.service 2>/dev/null | cut -c1-240
MP=$(systemctl show -p MainPID --value afldb.service)
echo "primary pid=$MP children:"; ps -o pid,ppid,lstart,etimes,cmd --ppid "$MP" 2>/dev/null | cut -c1-200
echo "worker_count=$(ps -o pid= --ppid "$MP" 2>/dev/null | wc -l)"
step "G anonymous HTTP status on the loopback app (the beta gate)"
for p in /coaches /coaches/josh-carr-243 /clubs/port-adelaide /clubs/carlton; do
  printf '%s -> ' "$p"; curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' --max-time 10 "http://127.0.0.1:3100$p"
done
step "I ISR on-disk entries (the served standalone tree)"
WD=$(systemctl show -p WorkingDirectory --value afldb.service)
for base in "$WD/.next/standalone/.next/server/app" "$WD/.next/server/app"; do
  [ -d "$base" ] || { echo "no dir $base"; continue; }
  echo "-- $base"
  for f in coaches.html coaches.meta clubs/port-adelaide.html clubs/carlton.html clubs/port-adelaide.meta clubs/carlton.meta; do
    if [ -e "$base/$f" ]; then stat -c '%n mtime=%y size=%s' "$base/$f" | sed "s#$WD/##"; else echo "absent: $f"; fi
  done
done
step "C content in the on-disk coaches.html (Carr and Fraser rows as prerendered)"
for base in "$WD/.next/standalone/.next/server/app" "$WD/.next/server/app"; do
  f="$base/coaches.html"; [ -e "$f" ] || continue
  echo "-- $f"
  grep -o 'Josh Carr[^/]*</a></td><td[^>]*>[^<]*</td><td[^>]*>[^<]*</td><td[^>]*>[^<]*</td><td[^>]*>[^<]*</td>' "$f" | head -2 | cut -c1-300
  grep -o 'Josh Fraser[^/]*</a></td><td[^>]*>[^<]*</td><td[^>]*>[^<]*</td><td[^>]*>[^<]*</td><td[^>]*>[^<]*</td>' "$f" | head -2 | cut -c1-300
  echo "mentions of 2026 in file: $(grep -o '2026' "$f" | wc -l)"
done
step DONE
}
