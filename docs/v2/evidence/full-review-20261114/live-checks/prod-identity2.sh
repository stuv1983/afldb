set -u
echo "uptime: $(uptime -s) / $(uptime -p)"
last -x reboot shutdown 2>/dev/null | head -3
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node
for d in /home/arm/*/; do [ -d "$d.git" ] && echo "git dir $d HEAD=$(git -C "$d" rev-parse HEAD 2>/dev/null) dirty=$(git -C "$d" status --porcelain 2>/dev/null | wc -l)"; done
cat /home/arm/afldb-releases/releases/c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x/RELEASE.json 2>/dev/null | head -20 || ls /home/arm/afldb-releases/releases/c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x | head
echo "--- afldb unit journal since 06:00 AEDT (lifecycle lines only)"
journalctl -u afldb --since "2026-11-14 06:00" --no-pager -o short-iso 2>&1 | grep -E -i "Started|Stopped|Stopping|Starting|Main process exited|Killed|oom|signal|Consumed|Deactivated|Scheduled restart" | head -20
echo "--- system journal around 06:34-06:36 (unit lifecycle, oom, sudo)"
journalctl --since "2026-11-14 06:33" --until "2026-11-14 06:37" --no-pager -o short-iso 2>&1 | grep -E -i "afldb|oom|sudo|systemctl|restart" | head -30
echo "--- release events tail"
tail -5 /home/arm/afldb-releases/events.log 2>/dev/null || ls /home/arm/afldb-releases
