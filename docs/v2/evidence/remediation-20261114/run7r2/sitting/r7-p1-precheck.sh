#!/usr/bin/env bash
# Release 7 revision 2 (R7R2) (D-365-W + AFLDB-ISSUE-366), block P1 = S1 pre-check. PRODUCTION, as arm, READ-ONLY: writes nothing (one read-only
# transaction through the backup role).
# Establishes the actual serving state at the start of the window against the recorded state after packet 6R A1 (18 Nov 2026):
#   current -> a2e6ea9995a4-aKAYwf0qC4go6JJWiHhv5, previous -> c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x, checkout HEAD a2e6ea99 on main,
#   clean; origin/main = PREP (the approved published pin); 2026 player-season Brownlow rows all `pending` with NULL votes.
# Run (workstation): tr -d '\r' < r7-p1-precheck.sh | C:/Windows/System32/OpenSSH/ssh.exe afldb bash -s -- <PREP>
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node; export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
CHK=/home/arm/projects/afldb; ROOT=/home/arm/afldb-releases; cd "$CHK"
H0=a2e6ea9995a44b6d5b7de7e820d17bb2e14986b5
OLD_ID=a2e6ea9995a4-aKAYwf0qC4go6JJWiHhv5; OLD_PREV=c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x
PREP=${1:?PREP}; [[ $PREP =~ ^[0-9a-f]{40}$ ]]
echo "== R7 P1/S1 $(date -u +%FT%TZ) host=$(hostname) user=$(id -un)"
[ "$(readlink "$ROOT/current")" = "releases/$OLD_ID" ];   echo "PASS current -> $OLD_ID"
[ "$(readlink "$ROOT/previous")" = "releases/$OLD_PREV" ]; echo "PASS previous -> $OLD_PREV"
[ "$(git rev-parse HEAD)" = "$H0" ];                        echo "PASS checkout HEAD = a2e6ea99"
[ "$(git rev-parse --abbrev-ref HEAD)" = main ];           echo "PASS branch main"
[ -z "$(git status --porcelain)" ];                        echo "PASS porcelain empty"
[ "$(git ls-remote origin refs/heads/main | cut -f1)" = "$PREP" ]; echo "PASS origin/main = PREP $PREP (ls-remote)"
[ -z "$(ls "$ROOT"/*.lock 2>/dev/null || true)" ];          echo "PASS no release locks"
"$N" deploy/release.mjs status
"$N" deploy/release.mjs verify "$OLD_ID"
[ "$(systemctl is-active afldb-settle-afl-api.service || true)" = inactive ]; echo "PASS settle inactive"
echo "settle next: $(systemctl show afldb-settle-afl-api.timer -p NextElapseUSecRealtime --value)"
for u in apt-daily.service apt-daily-upgrade.service; do [ "$(systemctl is-active $u || true)" = inactive ]; done; echo "PASS apt services inactive"
for p in apt apt-get dpkg; do [ -z "$(pgrep -x $p || true)" ]; done; echo "PASS no apt/dpkg process"
systemctl list-timers afldb-settle-afl-api.timer apt-daily-upgrade.timer apt-daily.timer --all --no-pager
W=$(pgrep -af 'settle|import_|rebuild|pg_dump|pg_restore|b1a' | grep -v "pgrep" || true); [ -z "$W" ]; echo "PASS no writer or B1a processes"
avail=$(awk '/^MemAvailable:/{print int($2/1024)}' /proc/meminfo); echo "MemAvailable $avail MB"; [ "$avail" -ge 2100 ]
[ "$(df -BG --output=avail "$ROOT" | tail -1 | tr -dc 0-9)" -ge 6 ]; echo "PASS disk >= 6G ($(df -BG --output=avail "$ROOT" | tail -1 | tr -d ' '))"
[ "$(ss -ltn | grep -c ':3199 ' || true)" = 0 ];            echo "PASS port 3199 free"
[ "$(grep -c '^AFLDB_BETA_GATE=on$' .env || true)" = 1 ];  echo "PASS beta gate line"
[ "$(grep -c '^AFLDB_BETA_EPOCH=1$' .env || true)" = 1 ];  echo "PASS beta epoch 1"
echo "workers/port: $(grep -E '^(AFLDB_WORKERS|PORT)=' .env | tr '\n' ' ')"
test -f node_modules/tsx/package.json; test -f node_modules/postgres/package.json; echo "PASS deps tsx+postgres"
[ "$(node --version)" = v22.23.2 ]; echo "PASS node v22.23.2"
# The data D-365-W renders: every 2026 player-season Brownlow row pending with NULL votes (B1a outcome, re-read; never written here).
PSS=$( ( set -a && . ./.env && set +a
  re='^(postgres(ql)?://)([^:/@]+):([^@]*)@(.*)$'; d=$AFLDB_BACKUP_DATABASE_URL; [[ $d =~ $re ]] || { echo "bad DSN shape" >&2; exit 1; }
  printf -v PGPASSWORD '%b' "${BASH_REMATCH[4]//\%/\\x}"; export PGPASSWORD
  PGOPTIONS='-c default_transaction_read_only=on' psql -X -q -v ON_ERROR_STOP=1 -At -d "${BASH_REMATCH[1]}${BASH_REMATCH[3]}@${BASH_REMATCH[5]}" -c \
    "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT 'pss2026|'||brownlow_status||'|'||count(*)||'|'||count(brownlow_votes) FROM player_season_stats WHERE season=2026 GROUP BY brownlow_status ORDER BY 1; SELECT 'season2026|'||status FROM seasons WHERE year=2026; ROLLBACK;" ) )
echo "$PSS"
# Two separate statements: inside an && list, set -e would ignore a failing first test.
[ "$(echo "$PSS" | grep -c '^pss2026|')" = 1 ]
echo "$PSS" | grep -qE '^pss2026\|pending\|[0-9]+\|0$'
echo "PASS 2026 rows all pending, votes NULL ($(echo "$PSS" | grep '^pss2026' | cut -d'|' -f3) rows)"
systemctl show afldb -p ActiveState -p SubState -p NRestarts -p InvocationID -p ActiveEnterTimestamp
echo "P1 RESULT PASS"
}
main "$@" < /dev/null
