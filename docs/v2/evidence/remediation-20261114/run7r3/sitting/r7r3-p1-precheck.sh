#!/usr/bin/env bash
# Release 7 revision 3 (R7R3) (AFLDB-ISSUE-370 + D-370-W), block P1 = S1 pre-check. PRODUCTION, as arm, READ-ONLY: writes nothing (one
# read-only transaction through the backup role).
# Establishes the serving state at the start of the window against the state recorded when the owner held 7R2 at P3 (21 Nov 2026):
#   current -> a2e6ea9995a4-aKAYwf0qC4go6JJWiHhv5, previous -> c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x;
#   checkout on main, clean, at a3c8c67c (7R2 P2 fast-forward) or a2e6ea99 (if the owner reset it since); origin/main = PREP;
#   the built, never-promoted 7R2 release a3c8c67cc98f-JFf9-hXYa6xoigu5Tw4Hg present or pruned (recorded, never used);
#   2026 player-season Brownlow rows all `pending` with NULL votes; 2026 round grain unattached (9,522 rows, 1,242 votes,
#   match_id NULL); 2026 not published; no 2026 season-vote rows.
# Run (workstation): tr -d '\r' < r7r3-p1-precheck.sh | C:/Windows/System32/OpenSSH/ssh.exe afldb bash -s -- <PREP>
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node; export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
CHK=/home/arm/projects/afldb; ROOT=/home/arm/afldb-releases; cd "$CHK"
H0=a2e6ea9995a44b6d5b7de7e820d17bb2e14986b5; H7R2=a3c8c67cc98fc35e963795e331e7217a24ccf1e0
OLD_ID=a2e6ea9995a4-aKAYwf0qC4go6JJWiHhv5; OLD_PREV=c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x; R7R2_ID=a3c8c67cc98f-JFf9-hXYa6xoigu5Tw4Hg
PREP=${1:?PREP}; [[ $PREP =~ ^[0-9a-f]{40}$ ]]
echo "== R7R3 P1/S1 $(date -u +%FT%TZ) host=$(hostname) user=$(id -un)"
[ "$(readlink "$ROOT/current")" = "releases/$OLD_ID" ];   echo "PASS current -> $OLD_ID"
[ "$(readlink "$ROOT/previous")" = "releases/$OLD_PREV" ]; echo "PASS previous -> $OLD_PREV"
HEAD0=$(git rev-parse HEAD)
[ "$HEAD0" = "$H7R2" ] || [ "$HEAD0" = "$H0" ] || { echo "STOP checkout HEAD $HEAD0 is neither a3c8c67c (7R2 P2) nor a2e6ea99"; exit 1; }
echo "PASS checkout HEAD = $HEAD0"
[ "$(git rev-parse --abbrev-ref HEAD)" = main ];           echo "PASS branch main"
[ -z "$(git status --porcelain)" ];                        echo "PASS porcelain empty"
[ "$(git ls-remote origin refs/heads/main | cut -f1)" = "$PREP" ]; echo "PASS origin/main = PREP $PREP (ls-remote)"
[ -z "$(ls "$ROOT"/*.lock 2>/dev/null || true)" ];          echo "PASS no release locks"
if [ -d "$ROOT/releases/$R7R2_ID" ]; then echo "RECORD 7R2 artefact $R7R2_ID present, unpromoted (never promoted in 7R3)"; else echo "RECORD 7R2 artefact $R7R2_ID absent (pruned)"; fi
"$N" deploy/release.mjs status
"$N" deploy/release.mjs verify "$OLD_ID"
[ "$(systemctl is-active afldb-settle-afl-api.service || true)" = inactive ]; echo "PASS settle inactive"
echo "settle next: $(systemctl show afldb-settle-afl-api.timer -p NextElapseUSecRealtime --value)"
for u in apt-daily.service apt-daily-upgrade.service; do [ "$(systemctl is-active $u || true)" = inactive ]; done; echo "PASS apt services inactive"
for p in apt apt-get dpkg; do [ -z "$(pgrep -x $p || true)" ]; done; echo "PASS no apt/dpkg process"
systemctl list-timers afldb-settle-afl-api.timer apt-daily-upgrade.timer apt-daily.timer --all --no-pager
W=$(pgrep -af 'settle|import_|rebuild|pg_dump|pg_restore|b1a|brownlow-season-attach' | grep -v "pgrep" || true); [ -z "$W" ]; echo "PASS no writer, dump or attach processes"
avail=$(awk '/^MemAvailable:/{print int($2/1024)}' /proc/meminfo); echo "MemAvailable $avail MB"; [ "$avail" -ge 2100 ]
[ "$(df -BG --output=avail "$ROOT" | tail -1 | tr -dc 0-9)" -ge 6 ]; echo "PASS disk >= 6G ($(df -BG --output=avail "$ROOT" | tail -1 | tr -d ' '))"
[ "$(ss -ltn | grep -c ':3199 ' || true)" = 0 ];            echo "PASS port 3199 free"
[ "$(grep -c '^AFLDB_BETA_GATE=on$' .env || true)" = 1 ];  echo "PASS beta gate line"
[ "$(grep -c '^AFLDB_BETA_EPOCH=1$' .env || true)" = 1 ];  echo "PASS beta epoch 1"
echo "workers/port: $(grep -E '^(AFLDB_WORKERS|PORT)=' .env | tr '\n' ' ')"
[ "$(grep -c '^AFLDB_IMPORT_DATABASE_URL=' .env || true)" = 1 ]; echo "PASS import-role DSN line present (value not read)"
test -f node_modules/tsx/package.json; test -f node_modules/postgres/package.json; echo "PASS deps tsx+postgres"
[ "$(node --version)" = v22.23.2 ]; echo "PASS node v22.23.2"
# The 2026 state 7R3 is written for (re-read; never written here).
PSS=$( ( set -a && . ./.env && set +a
  re='^(postgres(ql)?://)([^:/@]+):([^@]*)@(.*)$'; d=$AFLDB_BACKUP_DATABASE_URL; [[ $d =~ $re ]] || { echo "bad DSN shape" >&2; exit 1; }
  printf -v PGPASSWORD '%b' "${BASH_REMATCH[4]//\%/\\x}"; export PGPASSWORD
  PGOPTIONS='-c default_transaction_read_only=on' psql -X -q -v ON_ERROR_STOP=1 -At -d "${BASH_REMATCH[1]}${BASH_REMATCH[3]}@${BASH_REMATCH[5]}" <<'SQL'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT 'pss2026|'||brownlow_status||'|'||count(*)||'|'||count(brownlow_votes) FROM player_season_stats WHERE season=2026 GROUP BY brownlow_status ORDER BY 1;
SELECT 'season2026|'||status FROM seasons WHERE year=2026;
SELECT 'brv2026|'||count(*)||'|'||count(*) FILTER (WHERE votes>0)||'|'||coalesce(sum(votes),0)||'|'||count(match_id) FROM brownlow_round_votes WHERE season=2026;
SELECT 'bsv2026|'||count(*) FROM brownlow_season_votes WHERE season=2026;
SELECT 'pub2026|'||count(*) FILTER (WHERE published_revision IS NOT NULL) FROM brownlow_season_authority WHERE season=2026;
SELECT 'pms2026|'||count(s.brownlow_votes) FROM player_match_stats s JOIN matches m ON m.id=s.match_id WHERE m.season=2026;
ROLLBACK;
SQL
) )
echo "$PSS"
# Separate statements: inside an && list, set -e would ignore a failing first test.
[ "$(echo "$PSS" | grep -c '^pss2026|')" = 1 ]
grep -qE '^pss2026\|pending\|669\|0$' <<< "$PSS"
grep -qx 'season2026|complete' <<< "$PSS"
grep -qx 'brv2026|9522|621|1242|0' <<< "$PSS"
grep -qx 'bsv2026|0' <<< "$PSS"
grep -qx 'pub2026|0' <<< "$PSS"
grep -qx 'pms2026|0' <<< "$PSS"
echo "PASS 2026: 669 rows pending with NULL votes, season complete, 9522 round rows (621 positive, 1242 votes) unattached, unpublished, no match mirror"
systemctl show afldb -p ActiveState -p SubState -p NRestarts -p InvocationID -p ActiveEnterTimestamp
echo "P1 RESULT PASS"
}
main "$@" < /dev/null
