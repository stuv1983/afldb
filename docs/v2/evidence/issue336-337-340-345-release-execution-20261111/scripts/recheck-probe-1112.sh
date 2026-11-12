( set -u; cd "$CHK"; NEW_ID=$(cat "$NEWFILE"); bash "$PKGG/state-probe.sh" "$OLD_ID" "$NEW_ID"
  echo "HEAD $(git rev-parse HEAD) dirty=$(git status --porcelain | wc -l)"
  systemctl show afldb -p NRestarts -p ActiveEnterTimestamp --value | tr '\n' ' '; echo
  echo "journal errors since start: $(journalctl -u afldb --since '2026-11-11 17:09:00' --no-pager -o cat 2>/dev/null | grep -ciE 'error|fatal|unhandled')"
  echo "-- nightly match settle since restart:"
  journalctl -u afldb-settle-afl-api.service --since '2026-11-11 17:09:00' --no-pager -o short-iso 2>/dev/null | grep -E 'AFLDB_SETTLE|Result|Started|Finished|Deactivated|exit' | cut -c1-200 | tail -8
  systemctl show afldb-settle-afl-api.service -p Result -p ExecMainStatus -p ExecMainExitTimestamp --value | tr '\n' ' '; echo
  systemctl list-timers afldb-settle-afl-api.timer --no-pager | sed -n 2p
  echo "beta gate lines: $(grep -c '^AFLDB_BETA_GATE=on$' .env)"
  for p in /draft /draft/2025 '/draft/2014?view=rookie'; do echo "GET $p -> $(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 30 "http://127.0.0.1:3100$p")"; done )
