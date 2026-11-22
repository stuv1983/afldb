#!/usr/bin/env bash
# Sitting A1 (Tue 24 Nov 2026), block P1: pre-window read-only check. PRODUCTION, as arm, READ-ONLY (one read-only transaction
# through the backup role; nothing written). Expected state = R0 (2026-11-22 02:52 AEDT) plus nothing since:
#   current -> c8d4202a4cb3-aATnIlFOIQjq2z5oDdoHC, previous -> a2e6ea9995a4-aKAYwf0qC4go6JJWiHhv5;
#   checkout on main, clean, HEAD c8d4202a (or 7d92042f if a stopped A1 attempt already fast-forwarded it);
#   origin/main (ls-remote) = PREP, the origin/main tip the owner confirms at the start of the Tuesday session (da4cc0c4 on
#   2026-11-22; the owner names the final tip in the first message if anything is pushed before A1); PREP must descend from
#   7d92042f (W0 on the workstation and P2 check it). A1 builds the pinned CAND 7d92042f, never PREP;
#   .env holds NEITHER AFLDB_REVALIDATE_URL nor AFLDB_REVALIDATE_SECRET (counts only; values never read);
#   ledger head 118_fixtures_unconfirmed_participants.sql (118 rows); 2026 Brownlow published revision 3.
# Run (workstation, one connection):
#   tr -d '\r' < a1-p1-precheck.sh | C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes afldb bash -s -- <PREP, 40 hex>
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node; export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
CHK=/home/arm/projects/afldb; ROOT=/home/arm/afldb-releases; cd "$CHK"
H_SERVE=c8d4202a4cb3cf0ccdd1cad01e1227a1610c2d76; CAND=7d92042fd11010eaa20966e2f49ae7a93e286568
CUR=c8d4202a4cb3-aATnIlFOIQjq2z5oDdoHC; PREV=a2e6ea9995a4-aKAYwf0qC4go6JJWiHhv5
PREP=${1:?PREP}; [[ $PREP =~ ^[0-9a-f]{40}$ ]]
echo "== A1 P1 $(date -u +%FT%TZ) host=$(hostname) user=$(id -un)"
[ "$(hostname)" = afldb-prod ]; [ "$(id -un)" = arm ]; echo "PASS host afldb-prod, user arm"
[ "$(readlink "$ROOT/current")" = "releases/$CUR" ];   echo "PASS current -> $CUR"
[ "$(readlink "$ROOT/previous")" = "releases/$PREV" ]; echo "PASS previous -> $PREV"
HEAD0=$(git rev-parse HEAD)
[ "$HEAD0" = "$H_SERVE" ] || [ "$HEAD0" = "$CAND" ] || { echo "STOP checkout HEAD $HEAD0 is neither c8d4202a nor 7d92042f"; exit 1; }
echo "PASS checkout HEAD = $HEAD0"
[ "$(git rev-parse --abbrev-ref HEAD)" = main ];           echo "PASS branch main"
[ -z "$(git status --porcelain)" ];                        echo "PASS porcelain empty"
[ "$(git ls-remote origin refs/heads/main | cut -f1)" = "$PREP" ]; echo "PASS origin/main = PREP $PREP (ls-remote)"
[ -z "$(ls "$ROOT"/*.lock 2>/dev/null || true)" ];          echo "PASS no release locks"
if ls -d "$ROOT"/releases/7d92042fd110-* >/dev/null 2>&1; then echo "RECORD an earlier 7d92042fd110-* release exists (never promoted): $(ls -d "$ROOT"/releases/7d92042fd110-* | xargs -n1 basename | tr '\n' ' ')"; fi
"$N" deploy/release.mjs status
"$N" deploy/release.mjs verify "$CUR"
"$N" deploy/release.mjs host-gate
[ "$(systemctl is-active afldb-settle-afl-api.service || true)" = inactive ]; echo "PASS settle inactive"
echo "settle next: $(systemctl show afldb-settle-afl-api.timer -p NextElapseUSecRealtime --value)"
for u in apt-daily.service apt-daily-upgrade.service; do [ "$(systemctl is-active $u || true)" = inactive ]; done; echo "PASS apt services inactive"
for p in apt apt-get dpkg; do [ -z "$(pgrep -x $p || true)" ]; done; [ -z "$(pgrep -f "(^|/)(unattended-upgrade( |$)|apt.systemd.daily)" || true)" ]; echo "PASS no apt/dpkg/unattended-upgrade run (the always-on unattended-upgrade-shutdown handler is not a run)"
systemctl list-timers 'afldb*' apt-daily-upgrade.timer apt-daily.timer --all --no-pager
W=$(pgrep -af 'settle|import_|rebuild|pg_dump|pg_restore|brownlow-season-attach|prod-stage' | grep -v pgrep || true); [ -z "$W" ]; echo "PASS no writer, dump or attach processes"
avail=$(awk '/^MemAvailable:/{print int($2/1024)}' /proc/meminfo); echo "MemAvailable $avail MB"; [ "$avail" -ge 2100 ]
[ "$(df -BG --output=avail "$ROOT" | tail -1 | tr -dc 0-9)" -ge 6 ]; echo "PASS disk >= 6G ($(df -BG --output=avail "$ROOT" | tail -1 | tr -d ' '))"
[ "$(ss -ltn | grep -c ':3199 ' || true)" = 0 ];            echo "PASS port 3199 free (build smoke port)"
[ "$(grep -c '^AFLDB_BETA_GATE=on$' .env || true)" = 1 ];  echo "PASS beta gate line"
[ "$(grep -c '^AFLDB_WORKERS=2$' .env || true)" = 1 ];     echo "PASS AFLDB_WORKERS=2"
PL=$(grep '^PORT=' .env || true); echo "PORT line: ${PL:-none (default 3100)}"; [ -z "$PL" ] || [ "$PL" = PORT=3100 ]; echo "PASS app port 3100 (the revalidation URL target)"
U=$(grep -c '^AFLDB_REVALIDATE_URL=' .env || true); S=$(grep -c '^AFLDB_REVALIDATE_SECRET=' .env || true)
echo "env counts: AFLDB_REVALIDATE_URL=$U AFLDB_REVALIDATE_SECRET=$S (values never read)"
[ "$U" = 0 ] && [ "$S" = 0 ] || { echo "STOP .env already names a revalidation variable: not the R0 state; owner decides"; exit 1; }
echo "PASS .env has neither revalidation name (R0 state)"
[ "$(tail -c1 .env | wc -l)" = 1 ]; echo "PASS .env ends with a newline ($(wc -l < .env) lines)"
test -f node_modules/tsx/package.json; test -f node_modules/postgres/package.json; echo "PASS deps tsx+postgres"
[ "$(node --version)" = v22.23.2 ]; echo "PASS node v22.23.2"
RO=$( ( set -a && . ./.env && set +a
  re='^(postgres(ql)?://)([^:/@]+):([^@]*)@(.*)$'; d=$AFLDB_BACKUP_DATABASE_URL; [[ $d =~ $re ]] || { echo "bad DSN shape" >&2; exit 1; }
  printf -v PGPASSWORD '%b' "${BASH_REMATCH[4]//\%/\\x}"; export PGPASSWORD
  PGOPTIONS='-c default_transaction_read_only=on' psql -X -q -v ON_ERROR_STOP=1 -At -d "${BASH_REMATCH[1]}${BASH_REMATCH[3]}@${BASH_REMATCH[5]}" <<'SQL'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT 'ledger|'||count(*)||'|'||max(name) FROM afldb_meta.schema_migrations;
SELECT 'maxseason|'||max(year) FROM seasons;
SELECT 'pub2026|'||coalesce(max(published_revision)::text,'none') FROM brownlow_season_authority WHERE season=2026;
SELECT 'bsv2026|'||count(*)||'|'||coalesce(sum(votes),0)||'|'||count(*) FILTER (WHERE is_ineligible) FROM brownlow_season_votes WHERE season=2026;
SELECT 'invites_live|'||count(*) FROM admin_invites WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > now();
ROLLBACK;
SQL
) )
echo "$RO"
grep -qx 'ledger|118|118_fixtures_unconfirmed_participants.sql' <<< "$RO"; echo "PASS ledger head 118_fixtures_unconfirmed_participants.sql (118 rows)"
grep -qx 'pub2026|3' <<< "$RO";            echo "PASS 2026 Brownlow published revision 3"
grep -qx 'bsv2026|183|1242|14' <<< "$RO";  echo "PASS 2026 season votes 183 rows, 1242 votes, 14 ineligible"
systemctl show afldb -p ActiveState -p SubState -p NRestarts -p InvocationID -p ActiveEnterTimestamp -p MainPID
echo "previous BUILD_ID (rollback evidence): $(cat "$ROOT/releases/$CUR/.next/standalone/.next/BUILD_ID")"
echo "P1 RESULT PASS"
}
main "$@" < /dev/null
