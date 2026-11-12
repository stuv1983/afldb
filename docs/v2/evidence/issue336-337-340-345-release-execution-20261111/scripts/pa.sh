( set -euo pipefail; [[ $R =~ ^[0-9a-f]{40}$ ]]; cd "$CHK"
  [ "$(git rev-parse HEAD)" = "$PROD_HEAD" ]; [ -z "$(git status --porcelain)" ]
  [ -z "$(ls "$ROOT"/*.lock 2>/dev/null || true)" ]
  [ "$(readlink "$ROOT/current")"  = "releases/$OLD_ID" ]; [ "$(readlink "$ROOT/previous")" = "releases/$OLD_PREV" ]
  for id in "$OLD_ID" "$OLD_PREV"; do [ -d "$ROOT/releases/$id" ]; done
  "$N" deploy/release.mjs status                                              # exit 0 only on STATUS PASS (writes nothing)
  "$N" deploy/release.mjs verify "$OLD_ID"                                    # the pinned rollback target still matches its manifest
  bash "$PKGG/state-probe.sh" "$OLD_ID" - --expect OLD_SERVING
  avail=$(awk '/^MemAvailable:/ {print int($2/1024)}' /proc/meminfo); echo "MemAvailable ${avail} MB"; [ "$avail" -ge 2100 ]
  free_kb=$(df --output=avail -k /home/arm | tail -n 1 | tr -d ' '); echo "free ${free_kb} KB"; [ "$free_kb" -ge 6291456 ]
  [ -z "$(pgrep -f '[p]g_dump|[r]sync|[r]estore|[p]rod-stage' || true)" ]   # no backup, restore or I336 stage process
  now=$(date +%s); limit=$((now + 100 * 60))
  for t in $(systemctl list-timers --all --no-legend | awk '{for (i = 1; i <= NF; i++) if ($i ~ /^afldb.*\.timer$/) print $i}' | sort -u); do
    n=$(systemctl show -p NextElapseUSecRealtime --value "$t"); echo "timer $t next: ${n:-none}"
    [ -z "$n" ] || [ "$(date -d "$n" +%s)" -gt "$limit" ]
  done
  [ "$(grep -c '^AFLDB_SETTLE_TRIGGER=systemd$' .env)" = 1 ]                  # preserved input; count only, the value is never printed
  [ "$(systemctl is-enabled afldb-settle-afl-api.timer)" = enabled ]
  [ "$(systemctl is-enabled afldb-settle-afl-api-brownlow.timer 2>&1 || true)" = disabled ]
  [ "$(systemctl is-enabled afldb-settle-afltables.timer 2>&1 || true)" = disabled ]
  echo "P-A PASS (record the match timer's next-elapse time for the D3c comparison)"
)
echo "P-A exit=$?"
crontab -l 2>/dev/null | grep -i afldb || echo "no afldb cron entries"       # J1: JUDGEMENT; none may fire within 100 minutes
echo "--- read-only context: tmux $(command -v tmux || echo absent); NEWFILE $( [ -e "$NEWFILE" ] && echo EXISTS || echo absent )"
