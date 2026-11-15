#!/usr/bin/env bash
# Packet 6R sitting, block P1 = B1-RUNBOOK S1 + B1A-RUNBOOK §0 (pre-S2 items). PRODUCTION, as arm, READ-ONLY: writes nothing.
# Run (workstation): tr -d '\r' < p1-s1-precheck.sh | C:\Windows\System32\OpenSSH\ssh.exe afldb bash -s
# The whole body is one function, so bash parses every line before running any and no command can read the script from stdin.
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node; export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
CHK=/home/arm/projects/afldb; ROOT=/home/arm/afldb-releases; cd "$CHK"
CP=a2e6ea9995a44b6d5b7de7e820d17bb2e14986b5; H0=c1c4b22ee15007111eab66f6d354e0b9ecbb2ade
OLD_ID=c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x; OLD_PREV=0f251c2daa8d-3t0xWKI76Jgna2tB8a9oN
echo "== P1/S1 $(date -u +%FT%TZ) host=$(hostname) user=$(id -un)"
[ "$(readlink "$ROOT/current")" = "releases/$OLD_ID" ];   echo "PASS current -> $OLD_ID"
[ "$(readlink "$ROOT/previous")" = "releases/$OLD_PREV" ]; echo "PASS previous -> $OLD_PREV"
[ "$(git rev-parse HEAD)" = "$H0" ];                        echo "PASS checkout HEAD = c1c4b22e"
[ "$(git rev-parse --abbrev-ref HEAD)" = main ];           echo "PASS branch main"
[ -z "$(git status --porcelain)" ];                        echo "PASS porcelain empty"
[ -z "$(ls "$ROOT"/*.lock 2>/dev/null || true)" ];          echo "PASS no release locks"
"$N" deploy/release.mjs status
"$N" deploy/release.mjs verify "$OLD_ID"
[ "$(systemctl is-active afldb-settle-afl-api.service || true)" = inactive ]; echo "PASS settle inactive"
echo "settle next: $(systemctl show afldb-settle-afl-api.timer -p NextElapseUSecRealtime --value)"
for u in apt-daily.service apt-daily-upgrade.service; do [ "$(systemctl is-active $u || true)" = inactive ]; done; echo "PASS apt services inactive"
for p in apt apt-get dpkg; do [ -z "$(pgrep -x $p || true)" ]; done; echo "PASS no apt/dpkg process"
systemctl list-timers afldb-settle-afl-api.timer apt-daily-upgrade.timer apt-daily.timer --all --no-pager
W=$(pgrep -af 'settle|import_|rebuild|pg_dump|pg_restore' | grep -v "pgrep" || true); [ -z "$W" ]; echo "PASS no writer processes"
avail=$(awk '/^MemAvailable:/{print int($2/1024)}' /proc/meminfo); echo "MemAvailable $avail MB"; [ "$avail" -ge 2100 ]
df -BG --output=avail "$ROOT" | tail -1
[ "$(df -BG --output=avail "$ROOT" | tail -1 | tr -dc 0-9)" -ge 6 ]; echo "PASS disk >= 6G"
[ "$(ss -ltn | grep -c ':3199 ' || true)" = 0 ];            echo "PASS port 3199 free"
[ "$(grep -c '^AFLDB_BETA_GATE=on$' .env || true)" = 1 ];  echo "PASS beta gate line"
[ "$(grep -c '^AFLDB_BETA_EPOCH=1$' .env || true)" = 1 ];  echo "PASS beta epoch 1"
echo "workers/port: $(grep -E '^(AFLDB_WORKERS|PORT)=' .env | tr '\n' ' ')"
test -f node_modules/tsx/package.json && test -f node_modules/postgres/package.json; echo "PASS deps tsx+postgres"
[ "$(node --version)" = v22.23.2 ]; echo "PASS node v22.23.2"
df -h /home/arm | tail -1
systemctl show afldb -p ActiveState -p SubState -p NRestarts -p InvocationID -p ActiveEnterTimestamp
echo "P1 RESULT PASS"
}
main "$@" < /dev/null
