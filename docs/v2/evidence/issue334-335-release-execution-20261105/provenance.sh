#!/usr/bin/env bash
# Read-only provenance collection after an unexpected NEW_SERVING state (ISSUE-334/335 cutover). Changes nothing.
ROOT=/home/arm/afldb-releases
LOGD=/home/arm/i334-335
echo "== provenance $(date -u +%FT%TZ) (AEDT $(TZ=Australia/Melbourne date '+%F %T'))"
echo "-- events.log (last 15)"; tail -n 15 "$ROOT/events.log"
echo "-- links"; ls -l --time-style=full-iso "$ROOT/current" "$ROOT/previous"
echo "-- work folder"; ls -la --time-style=full-iso "$LOGD"
for f in "$LOGD"/cutover.log "$LOGD"/restart-probe.log "$LOGD"/nocutover-probe.log; do
  [ -e "$f" ] && { echo "-- $f"; cat "$f"; }
done
echo "-- phase.sh hash"; sha256sum "$LOGD/phase.sh"
echo "-- unit"; systemctl show -p MainPID -p ActiveState -p SubState -p Result -p NRestarts -p ActiveEnterTimestamp -p ExecMainStartTimestamp afldb
echo "-- journal: unit start/stop and identity lines since 12:17 AEDT"
journalctl -u afldb --since '2026-11-05 12:17:00' --no-pager -o short-iso | grep -E 'Stopp|Started|Starting|serving build|primary|\[afldb\]' | tail -n 30
echo "-- journal: error count since the current start"
since=$(systemctl show -p ActiveEnterTimestamp --value afldb)
journalctl -u afldb --since "$since" -o cat --no-pager | grep -ciE 'error|fatal|unhandled' || true
echo "-- sudo entries for afldb since 12:17 (if readable)"
journalctl _COMM=sudo --since '2026-11-05 12:17:00' --no-pager -o short-iso 2>/dev/null | grep -i afldb | tail -n 10 || echo "(none or unreadable)"
echo "-- timers"; systemctl show -p NextElapseUSecRealtime -p LastTriggerUSec afldb-settle-afl-api.timer
echo "-- tmux"; tmux ls 2>/dev/null || echo "no tmux sessions"
echo "-- checkout"; cd /home/arm/projects/afldb && git rev-parse HEAD && git status --porcelain | head
