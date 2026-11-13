#!/usr/bin/env bash
# Read-only production identity probe for the 2026-11-14 review. Writes nothing (release.mjs status WITHOUT --expect).
set -u
echo "host=$(hostname) user=$(id -un) utc=$(date -u +%FT%TZ) tz=$(cat /etc/timezone 2>/dev/null) $(timedatectl show -p Timezone 2>/dev/null)"
N=$(ls -d "$HOME"/.nvm/versions/node/v22.23.2/bin/node 2>/dev/null || command -v node)
echo "node=$N $($N -v 2>/dev/null)"
for d in "$HOME/afldb" "$HOME/afldb-checkout"; do [ -d "$d/.git" ] && echo "checkout $d HEAD=$(git -C "$d" rev-parse HEAD) branch=$(git -C "$d" rev-parse --abbrev-ref HEAD) dirty=$(git -C "$d" status --porcelain | wc -l)"; done
R=/home/arm/afldb-releases
echo "current -> $(readlink "$R/current")"; echo "previous -> $(readlink "$R/previous")"
ls "$R/releases" | tail -5
ls -l "$R"/*.lock 2>/dev/null || echo "no lock file at release root"
systemctl show afldb -p MainPID -p ActiveEnterTimestamp -p NRestarts -p WorkingDirectory --no-pager
pid=$(systemctl show afldb -p MainPID --value); [ -n "$pid" ] && [ "$pid" != 0 ] && echo "MainPID cwd=$(readlink /proc/$pid/cwd)"
systemctl list-timers --all --no-pager 'afldb*' 2>/dev/null
for u in afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.timer afldb-settle-afltables.timer afldb-email-intake.timer; do echo "$u enabled=$(systemctl is-enabled $u 2>&1) active=$(systemctl is-active $u 2>&1)"; done
cd "$HOME/afldb" 2>/dev/null && "$N" deploy/release.mjs status 2>&1 | tail -12
