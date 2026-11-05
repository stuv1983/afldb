# Read-only: DEV's own last nightly outcome, for comparison with the isolated 242fa276 run (O).
journalctl -u afldb-settle-afl-api.service --since "2026-11-06 04:55" --until "2026-11-06 05:40" --no-pager -o cat 2>&1 \
  | grep -E 'Applied as import batch|Source completeness|Season feed CD_|AFLDB_SETTLE|records read|Started|Finished|Deactivated' | sed 's/postgres[^ ]*//g' | head -12
systemctl list-timers afldb-settle-afl-api.timer --no-pager | head -3
