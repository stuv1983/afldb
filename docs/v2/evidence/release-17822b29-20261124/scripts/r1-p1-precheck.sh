#!/usr/bin/env bash
# Release 17822b29 (attended, Tue 24 Nov 2026), block P1: verify the ACTUAL serving release before any change. PRODUCTION, as arm,
# READ-ONLY (one read-only transaction through the backup role; nothing written; no sudo).
# Expected state = Sunday's accepted A1 (SITTING-A1-A2-20261122.md) plus nothing since:
#   current  -> releases/7d92042fd110-XWruOm_9nLCSMY8nGPqYU (revision 7d92042f, BUILD_ID XWruOm_9nLCSMY8nGPqYU) = the ROLLBACK TARGET
#   previous -> releases/c8d4202a4cb3-aATnIlFOIQjq2z5oDdoHC
#   service route: systemd runs `node deploy/server-cluster.mjs` with WorkingDirectory=/home/arm/afldb-releases/current (the
#     deploy/afldb.service.d/release-route.conf drop-in), so the supervisor bytes come from the RELEASE, never the checkout. The
#     primary runs in the real release directory; its deploy/server-cluster.mjs = Git blob 7d92042f (sha256 d82f24c4...).
#   restart InvocationID 342040625f6d4012a35d598dfbf9afe6 (Sun 22 Nov 14:42:40) unless the owner names a later, explained one;
#   two workers with AFLDB_WORKER_ID 1 and 2; revalidation names present and non-empty in the primary and both workers.
#   checkout /home/arm/projects/afldb on main, clean, HEAD 7d92042f (or 17822b29 when an earlier attempt already fast-forwarded it);
#   origin/main (ls-remote) = PREP, the tip the owner confirms at the start (17822b29 on 23 Nov 21:29 AEDT); PREP must descend from
#   CAND 17822b29 (checked in P2). The release builds CAND exactly, never PREP.
#   .env: beta gate on, AFLDB_WORKERS=2, PORT absent or 3100, both revalidation names once and non-empty (Sunday's E2), tracing off.
#   The backup DSN password contains neither "%" nor "\" (count-only): the 17822b29 backup.sh percent-decodes it, so this proves
#   the first scheduled backup under the fast-forwarded checkout (Wed 25 Nov 02:21) passes the same credential bytes as today.
#   ledger 118; 2026 Brownlow published revision 3 (183 rows, 1,242 votes, 14 ineligible); lists every season with votes that the
#   accepted-row rule hides (ISSUE-367 live controls for r1-rawhead.sh; "none" means only repository test evidence applies).
# Run (workstation Git Bash, one connection; never at minute :16-:18):
#   tr -d '\r' < r1-p1-precheck.sh | C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes afldb bash -s -- <PREP 40 hex> [<expected InvocationID>]
# Test seam: R1_LIB_ONLY=1 when sourced defines the functions and returns (rehearsal only; never set over ssh).

# The unit's effective route. Returns 0 only when systemd starts the relative supervisor inside <root>/current.
service_route() { # unit release-root node-path [route-conf-sha unit-file-sha]
  local unit=$1 root=$2 node=$3 rsha=${4:-} usha=${5:-} wd dp es fp d f=0 found=0
  wd=$(${SC:-systemctl} show "$unit" -p WorkingDirectory --value); fp=$(${SC:-systemctl} show "$unit" -p FragmentPath --value)
  dp=$(${SC:-systemctl} show "$unit" -p DropInPaths --value); es=$(${SC:-systemctl} show "$unit" -p ExecStart --value)
  echo "  FragmentPath $fp sha256 $(sha256sum < "$fp" 2>/dev/null | cut -c1-64)"
  [ -z "$usha" ] || { [ "$(sha256sum < "$fp" | cut -c1-64)" = "$usha" ] && echo "  unit file = repository deploy/afldb.service" || echo "  RECORD unit file differs from the repository file (effective properties decide)"; }
  echo "  DropInPaths $dp"
  for d in $dp; do
    case $d in */release-route.conf) found=1
      [ -z "$rsha" ] || { [ "$(sha256sum < "$d" | cut -c1-64)" = "$rsha" ] && echo "  release-route.conf = repository file" || echo "  RECORD release-route.conf differs from the repository file (effective properties decide)"; };;
    esac
  done
  [ "$found" = 1 ] || { echo "  route FAIL: no release-route.conf drop-in is loaded"; f=1; }
  echo "  WorkingDirectory $wd"
  [ "$wd" = "$root/current" ] || { echo "  route FAIL: WorkingDirectory is not $root/current; the service would run the CHECKOUT's supervisor and bundle, which promotion and rollback do not select"; f=1; }
  [[ $es == *"argv[]=$node deploy/server-cluster.mjs ;"* ]] && echo "  ExecStart argv: $node deploy/server-cluster.mjs (relative: resolved in WorkingDirectory)" \
    || { echo "  route FAIL: ExecStart is not '$node deploy/server-cluster.mjs': $es"; f=1; }
  return $f
}

# The running process tree. Returns 0 only when the primary runs the relative supervisor in <release-dir>, that file has the
# pinned SHA-256, there are exactly two workers in that release (or its standalone dir) with ordinals {1,2} and count 2, and both
# revalidation names are present and non-empty in all three processes (counts only; values are never read out).
serving_identity() { # unit release-dir supervisor-sha256 [proc-root]
  local unit=$1 rel=$2 sup=$3 proc=${4:-/proc} main cwd argv h w c o k u s n=0 seen=' ' f=0
  main=$(${SC:-systemctl} show "$unit" -p MainPID --value)
  [[ $main =~ ^[1-9][0-9]*$ ]] || { echo "  identity FAIL: $unit has no MainPID"; return 1; }
  cwd=$(readlink "$proc/$main/cwd") || { echo "  identity FAIL: cannot read the primary's cwd"; return 1; }
  argv=$(tr '\0' ' ' < "$proc/$main/cmdline" 2>/dev/null) || argv=unreadable
  echo "  primary pid $main cwd $cwd"; echo "  primary argv $argv"
  [ "$cwd" = "$rel" ] || { echo "  identity FAIL: the primary runs in $cwd, not $rel"; f=1; }
  [[ $argv == *" deploy/server-cluster.mjs "* ]] || { echo "  identity FAIL: argv is not '<node> deploy/server-cluster.mjs'"; f=1; }
  h=$(sha256sum < "$cwd/deploy/server-cluster.mjs" 2>/dev/null | cut -c1-64) || h=missing
  echo "  supervisor in the primary's cwd: sha256 $h"
  [ "$h" = "$sup" ] || { echo "  identity FAIL: supervisor sha256 is not the pinned $sup"; f=1; }
  envc() { tr '\0' '\n' < "$proc/$1/environ" 2>/dev/null | grep -c "$2" || true; }
  envv() { tr '\0' '\n' < "$proc/$1/environ" 2>/dev/null | sed -n "s/^$2=//p" || true; }
  u=$(envc "$main" '^AFLDB_REVALIDATE_URL=[^[:space:]]'); s=$(envc "$main" '^AFLDB_REVALIDATE_SECRET=[^[:space:]]')
  echo "  primary revalidation names (non-empty, counts only): URL $u SECRET $s"; [ "$u/$s" = 1/1 ] || { echo "  identity FAIL: primary names $u/$s"; f=1; }
  for w in $(pgrep -P "$main" || true); do
    n=$((n+1)); c=$(readlink "$proc/$w/cwd" 2>/dev/null || echo '?')
    o=$(envv "$w" AFLDB_WORKER_ID); k=$(envv "$w" AFLDB_WORKER_COUNT)
    u=$(envc "$w" '^AFLDB_REVALIDATE_URL=[^[:space:]]'); s=$(envc "$w" '^AFLDB_REVALIDATE_SECRET=[^[:space:]]')
    echo "  worker pid $w ordinal ${o:-none} count ${k:-none} cwd $c names $u/$s"
    { [ "$c" = "$rel" ] || [ "$c" = "$rel/.next/standalone" ]; } || { echo "  identity FAIL: worker $w runs in $c"; f=1; }
    [[ $o =~ ^[12]$ && $seen != *" $o "* && $k = 2 && $u/$s = 1/1 ]] || { echo "  identity FAIL: worker $w ordinal/count/names"; f=1; }
    seen="$seen$o "
  done
  [[ $n = 2 && ( $seen = ' 1 2 ' || $seen = ' 2 1 ' ) ]] || { echo "  identity FAIL: workers $n, ordinals '$seen' (need exactly 1 and 2)"; f=1; }
  return $f
}

main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node; export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH; SC=systemctl
CHK=/home/arm/projects/afldb; ROOT=/home/arm/afldb-releases; cd "$CHK"
SERVE=7d92042fd11010eaa20966e2f49ae7a93e286568; CAND=17822b29e6de2b6248cd7ada4221800fd81e0003
CUR=7d92042fd110-XWruOm_9nLCSMY8nGPqYU; CUR_BUILD=XWruOm_9nLCSMY8nGPqYU; PREV=c8d4202a4cb3-aATnIlFOIQjq2z5oDdoHC
SUP_OLD=d82f24c48e2bc310857826e8fecc2e5ad90381ec3267c0d1ddba5ae19a822865
ROUTE_SHA=14942fc53421ff60eddb738b338e7a3db38a22429839fb4eabd8978edea1f5ff; UNIT_SHA=a3444840e0bd5f94ea05ea4b01508e0e8209d65ae452be665c1049c6b34e149a
PREP=${1:?PREP}; [[ $PREP =~ ^[0-9a-f]{40}$ ]]
EXP_INV=${2:-342040625f6d4012a35d598dfbf9afe6}; [[ $EXP_INV =~ ^[0-9a-f]{32}$ ]]
echo "== R1 P1 $(date -u +%FT%TZ) host=$(hostname) user=$(id -un)"
{ [ "$(hostname)" = afldb-prod ] && [ "$(id -un)" = arm ]; } || { echo "STOP not afldb-prod as arm: refused"; exit 2; }; echo "PASS host afldb-prod, user arm"

echo "-- serving release (rollback target)"
[ "$(readlink "$ROOT/current")" = "releases/$CUR" ];   echo "PASS current -> $CUR"
[ "$(readlink "$ROOT/previous")" = "releases/$PREV" ]; echo "PASS previous -> $PREV"
REL=$(realpath "$ROOT/releases/$CUR")
RJ=$("$N" -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(`${j.id} ${j.revision} ${j.buildId}`)' "$REL/release.json")
[ "$RJ" = "$CUR $SERVE $CUR_BUILD" ]; echo "PASS release.json: id, revision $SERVE, buildId $CUR_BUILD"
[ "$(cat "$REL/.next/standalone/.next/BUILD_ID")" = "$CUR_BUILD" ]; echo "PASS bundle BUILD_ID $CUR_BUILD"
grep -qx "$SUP_OLD  deploy/server-cluster.mjs" "$REL/MANIFEST.sha256"; echo "PASS release MANIFEST pins deploy/server-cluster.mjs = Git blob 7d92042f ($SUP_OLD)"
"$N" deploy/release.mjs verify "$CUR"
echo "-- service route (where systemd loads deploy/server-cluster.mjs)"
service_route afldb "$ROOT" "$N" "$ROUTE_SHA" "$UNIT_SHA"; echo "PASS route: the supervisor is loaded from $ROOT/current, resolved once at start"
echo "-- running process"
INV=$(systemctl show afldb -p InvocationID --value); NR=$(systemctl show afldb -p NRestarts --value); AS=$(systemctl show afldb -p ActiveState --value)
echo "InvocationID $INV NRestarts $NR ActiveState $AS since $(systemctl show afldb -p ActiveEnterTimestamp --value)"
[ "$AS" = active ] && [ "$NR" = 0 ]; echo "PASS active, NRestarts 0"
[ "$INV" = "$EXP_INV" ] || { echo "STOP InvocationID $INV is not the expected $EXP_INV (an unrecorded restart since Sunday?): the owner explains it and names it as the second argument, or stop"; exit 1; }
echo "PASS InvocationID = expected $EXP_INV"
serving_identity afldb "$REL" "$SUP_OLD"; echo "PASS identity: primary in $REL, supervisor $SUP_OLD, workers 1 and 2, names 1/1 in all three"

echo "-- checkout and remote"
HEAD0=$(git rev-parse HEAD)
[ "$HEAD0" = "$SERVE" ] || [ "$HEAD0" = "$CAND" ] || { echo "STOP checkout HEAD $HEAD0 is neither 7d92042f nor 17822b29"; exit 1; }
echo "PASS checkout HEAD = $HEAD0 (the service does not run from it; see the route above)"
[ "$(git rev-parse --abbrev-ref HEAD)" = main ];             echo "PASS branch main"
[ -z "$(git status --porcelain)" ];                          echo "PASS porcelain empty"
[ "$(git ls-remote origin refs/heads/main | cut -f1)" = "$PREP" ]; echo "PASS origin/main = PREP $PREP (ls-remote)"
[ -z "$(ls "$ROOT"/*.lock 2>/dev/null || true)" ];            echo "PASS no release locks"
if ls -d "$ROOT"/releases/17822b29e6de-* >/dev/null 2>&1; then echo "RECORD an earlier 17822b29e6de-* release exists (never promoted): $(ls -d "$ROOT"/releases/17822b29e6de-* | xargs -n1 basename | tr '\n' ' ')"; fi
"$N" deploy/release.mjs status     # plain form: --expect would append a status line to events.log
"$N" deploy/release.mjs host-gate

echo "-- host quiet"
[ "$(systemctl is-active afldb-settle-afl-api.service || true)" = inactive ]; echo "PASS settle inactive"
echo "settle next: $(systemctl show afldb-settle-afl-api.timer -p NextElapseUSecRealtime --value)"
for u in apt-daily.service apt-daily-upgrade.service afldb-backup.service afldb-backup-verify.service; do [ "$(systemctl is-active $u || true)" = inactive ]; done; echo "PASS apt and backup services inactive"
for p in apt apt-get dpkg; do [ -z "$(pgrep -x $p || true)" ]; done; [ -z "$(pgrep -f "(^|/)(unattended-upgrade( |$)|apt.systemd.daily)" || true)" ]; echo "PASS no apt/dpkg/unattended-upgrade run (the always-on unattended-upgrade-shutdown handler is not a run)"
systemctl list-timers 'afldb*' apt-daily-upgrade.timer apt-daily.timer --all --no-pager
W=$(pgrep -af 'settle|import_|rebuild|pg_dump|pg_restore|brownlow-season-attach|prod-stage' | grep -v pgrep || true); [ -z "$W" ]; echo "PASS no writer, dump or attach processes"
avail=$(awk '/^MemAvailable:/{print int($2/1024)}' /proc/meminfo); echo "MemAvailable $avail MB"; [ "$avail" -ge 2100 ]
[ "$(df -BG --output=avail "$ROOT" | tail -1 | tr -dc 0-9)" -ge 6 ]; echo "PASS disk >= 6G ($(df -BG --output=avail "$ROOT" | tail -1 | tr -d ' '))"
[ "$(ss -ltn | grep -c ':3199 ' || true)" = 0 ];              echo "PASS port 3199 free (build smoke port)"

echo "-- .env (counts only; values never read out)"
[ "$(grep -c '^AFLDB_BETA_GATE=on$' .env || true)" = 1 ];    echo "PASS beta gate line"
[ "$(grep -c '^AFLDB_WORKERS=2$' .env || true)" = 1 ];       echo "PASS AFLDB_WORKERS=2"
PL=$(grep '^PORT=' .env || true); echo "PORT line: ${PL:-none (default 3100)}"; [ -z "$PL" ] || [ "$PL" = PORT=3100 ]; echo "PASS app port 3100"
U=$(grep -c '^AFLDB_REVALIDATE_URL=[^[:space:]]' .env || true); S=$(grep -c '^AFLDB_REVALIDATE_SECRET=[^[:space:]]' .env || true)
[ "$U/$S" = 1/1 ] || { echo "STOP .env revalidation names $U/$S (Sunday left 1/1): owner decides"; exit 1; }; echo "PASS .env revalidation names 1/1, non-empty (no env change in this release)"
T=$(grep -c '^AFLDB_TRACE_REQUESTS=on' .env || true); echo "RECORD AFLDB_TRACE_REQUESTS=on lines: $T (0 = the 17822b29 trace change is inert on production)"
[ "$(tail -c1 .env | wc -l)" = 1 ]; echo "PASS .env ends with a newline ($(wc -l < .env) lines)"
test -f node_modules/tsx/package.json; test -f node_modules/postgres/package.json; echo "PASS deps tsx+postgres"
[ "$(node --version)" = v22.23.2 ]; echo "PASS node v22.23.2"

echo "-- database (one read-only transaction, backup role)"
RO=$( ( set -a && . ./.env && set +a
  re='^(postgres(ql)?://)([^:/@]+):([^@]*)@(.*)$'; d=$AFLDB_BACKUP_DATABASE_URL; [[ $d =~ $re ]] || { echo "bad DSN shape" >&2; exit 1; }
  pw=${BASH_REMATCH[4]}; pc=0; bs=0; [[ $pw == *%* ]] && pc=1; [[ $pw == *\\* ]] && bs=1; echo "pwshape|$pc|$bs"; pw=
  printf -v PGPASSWORD '%b' "${BASH_REMATCH[4]//\%/\\x}"; export PGPASSWORD
  PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=20000' psql -X -q -v ON_ERROR_STOP=1 -At -d "${BASH_REMATCH[1]}${BASH_REMATCH[3]}@${BASH_REMATCH[5]}" <<'SQL'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT 'ledger|'||count(*)||'|'||max(name) FROM afldb_meta.schema_migrations;
SELECT 'maxseason|'||max(year) FROM seasons;
SELECT 'pub2026|'||coalesce(max(published_revision)::text,'none') FROM brownlow_season_authority WHERE season=2026;
SELECT 'bsv2026|'||count(*)||'|'||coalesce(sum(votes),0)||'|'||count(*) FILTER (WHERE is_ineligible) FROM brownlow_season_votes WHERE season=2026;
WITH y AS (SELECT DISTINCT v.season,
  (NOT EXISTS (SELECT 1 FROM stat_availability av WHERE av.stat_key='brownlow_season_total' AND av.season=v.season AND av.coverage='not_applicable')
   AND (EXISTS (SELECT 1 FROM stat_availability av WHERE av.stat_key='brownlow_season_total' AND av.season=v.season AND av.coverage='complete')
        OR EXISTS (SELECT 1 FROM brownlow_season_authority ba WHERE ba.season=v.season AND ba.published_revision IS NOT NULL))) AS accepted
  FROM brownlow_season_votes v WHERE v.votes > 0)
SELECT 'brownlow_years|'||count(*) FILTER (WHERE accepted)||'|'||coalesce(string_agg(season::text, ',' ORDER BY season) FILTER (WHERE NOT accepted),'none') FROM y;
ROLLBACK;
SQL
) )
echo "$RO"
grep -qx 'pwshape|0|0' <<< "$RO" || { echo "STOP the backup DSN password contains % or \\: the 17822b29 backup.sh would pass different bytes than 7d92042f's; owner decides"; exit 1; }
echo "PASS backup password has no % and no \\: the new percent-decoding is a no-op for this credential"
grep -qx 'ledger|118|118_fixtures_unconfirmed_participants.sql' <<< "$RO"; echo "PASS ledger head 118_fixtures_unconfirmed_participants.sql (118 rows)"
grep -qx 'pub2026|3' <<< "$RO";            echo "PASS 2026 Brownlow published revision 3"
grep -qx 'bsv2026|183|1242|14' <<< "$RO";  echo "PASS 2026 season votes 183 rows, 1242 votes, 14 ineligible"
UNACC=$(sed -n 's/^brownlow_years|[0-9]*|//p' <<< "$RO"); [[ $UNACC =~ ^(none|[0-9]{4}(,[0-9]{4})*)$ ]]
echo "UNACCEPTED_YEARS $UNACC (pass to r1-rawhead.sh; 'none' = no live ISSUE-367 example, repository tests apply)"
[ -s /home/arm/a1-rawhead-baseline.json ] && echo "RECORD Sunday's raw-head baseline /home/arm/a1-rawhead-baseline.json present (Wednesday R6 reuses it)" || echo "RECORD no Sunday raw-head baseline"
echo "previous BUILD_ID for the rollback record: $CUR_BUILD"
echo "P1 RESULT PASS"
}
if [ "${R1_LIB_ONLY:-0}" = 1 ]; then return 0 2>/dev/null || exit 0; fi
main "$@" < /dev/null
