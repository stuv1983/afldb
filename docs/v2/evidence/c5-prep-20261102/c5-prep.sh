#!/bin/bash
# ISSUE-316 C5 (D-316-4) PREPARATION: one READ-ONLY survey of afldb-prod, as `arm`, no sudo, nothing started/enabled/edited/restarted/written.
#   bash c5-prep.sh <N> <c4b-evidence-dir>
# It runs the packaged read-only phases (c-prod.sh c5-pre, c3-accept) and the offline readiness tool on the newest retained feed, then records the actual production state
# the C5 procedure assumes (checkout, serving release, switches, units, timers, trigger variable in .env and in the serving process, polkit, retired AFL Tables).
# Every query/phase is checked: a failed required read, or a value that differs from the C5 precondition, makes the survey NOT CONSISTENT (exit 1). Unexpected state is a FINDING, never auto-corrected.
set -u -o pipefail
export LC_ALL=C
umask 077
N=${1:?N (40 hex)}; EVD=${2:?c4b evidence dir}
[[ $N =~ ^[0-9a-f]{40}$ ]] || { echo "STOP: N must be 40 lowercase hex"; exit 2; }
CHK=/home/arm/projects/afldb
CPROD_REL=docs/v2/evidence/block-c-package-20261102/c-prod.sh
CPROD_SHA=ec839a47b645a61561ef885c1a5d1926be2e864fe3e557ec254553c6a031d496
P=$CHK/$CPROD_REL
NODE=/home/arm/.nvm/versions/node/v22.23.2/bin/node
ROOT=/home/arm/afldb-releases
SERVING_ID=ea98a35f2061--vY0EFS0DdR-TiPkxTZz6
ROLLBACK_ID=fd48ace0c2cb-pqAQwRIJWLjSYzR8LiTuy
FEED_SHA=21fd12e7704b7c7146cfbab414352352f3cfaa53e7ef5038f4411fa789e4c84d
[ "$(hostname)" = afldb-prod ] && [ "$(id -un)" = arm ] || { echo "STOP: unexpected host/user (afldb-prod, as arm)"; exit 3; }
[ "$(git -C "$CHK" rev-parse HEAD)" = "$N" ] || { echo "STOP: checkout HEAD is not $N"; exit 3; }
[ "$(sha256sum < "$P" | cut -c1-64)" = "$CPROD_SHA" ] || { echo "STOP: c-prod.sh is not the pinned bytes"; exit 3; }
set -- x
# shellcheck disable=SC1090
source <(sed -n '14,18p;20,75p' "$P")
type backup_identity > /dev/null 2>&1 && type q > /dev/null 2>&1 || { echo "STOP: the packaged reader definitions did not load"; exit 3; }
trap 'unset PGPASSWORD' EXIT

FAILS=0; MISMATCH=0; V=
sc() { local out s; out=$(q -c "$2" 2>&1); s=$?
  if [ $s -ne 0 ] || [[ $out == *"ERROR:"* ]]; then echo "QUERY FAILED [$1] exit=$s: $out"; FAILS=$((FAILS + 1)); V='<FAILED>'; return 0; fi; V=$out; }
show() { sc "$1" "$2"; echo "$1:"; printf '%s\n' "$V" | sed 's/^/    /'; }
expect() { sc "$1" "$2" ; echo "$1 = [$V] (expected [$3])"; [ "$V" = "$3" ] || { echo "UNEXPECTED [$1]: expected [$3], got [$V]"; MISMATCH=$((MISMATCH + 1)); }; }
eq() { echo "$1 = [$2] (expected [$3])"; [ "$2" = "$3" ] || { echo "UNEXPECTED [$1]: expected [$3], got [$2]"; MISMATCH=$((MISMATCH + 1)); }; }
phase() { # phase LABEL ENDMARK cmd... : run a packaged phase, require exit 0 and its end marker
  local label=$1 mark=$2 out s; shift 2; out=$("$@" 2>&1); s=$?; printf '%s\n' "$out" | sed 's/^/    /'
  # prefix match: c5-pre ends "C5-PRE PASS (the owner's steps follow ...)"; run 1 of this survey wrongly required the whole line
  if [ $s -ne 0 ] || ! grep -q "^$mark" <<<"$out"; then echo "PHASE FAILED [$label] exit=$s (no '$mark')"; FAILS=$((FAILS + 1)); else echo "phase [$label] ended '$mark'"; fi; }

echo "== c5-prep $(date -u +%FT%TZ) host=$(hostname) user=$(id -un) N=$N"
echo "host local time: $(date '+%F %T %Z'); timezone: $(timedatectl show -p Timezone --value 2>/dev/null || echo unknown)"

echo; echo "### 1. packaged read-only phases"
phase "c5-pre" "C5-PRE PASS" bash "$P" c5-pre "$N" "$EVD"
phase "c3-accept (twice, a minute apart: installed unit files equal the repository files, units loaded/inactive/disabled)" "C3-ACCEPT PASS" bash "$P" c3-accept "$N"

# c5-pre reads only result.json's verdict; pin the record itself (the 10 files hashed by step-c at 2026-11-02T08:37:49Z)
eq "C4b result.json sha256" "$(sha256sum < "$EVD/result.json" | cut -c1-64)" 1571892cc538ac3d51fba3cd595436658ee4bd35fd78f9b950dc1e96cdf9d04b
eq "C4b result.json run_id" "$(sed -n 's/.*"run_id": *"\([^"]*\)".*/\1/p' "$EVD/result.json")" c4b-2026-11-02T083721874Z-3296445
eq "C4b evidence directory file count" "$(find "$EVD" -type f | wc -l)" 10

echo; echo "### 2. readiness on the newest retained feed"
NEWEST=$(ls -1 "$CHK/data/sources/afl_api/matches" | sort | tail -1); FEED=$CHK/data/sources/afl_api/matches/$NEWEST/00-season-matches.json
echo "newest retained snapshot: $NEWEST"
eq "newest retained snapshot is the C4b r2 capture" "$NEWEST" "afl-api-2027-2026-11-02-083723"
eq "feed sha256" "$(sha256sum < "$FEED" | cut -c1-64)" "$FEED_SHA"
RD=$( cd "$CHK" && "$NODE" --import tsx tools/current-season/afl-api-cutover-readiness.ts --season 2027 --season-feed "$FEED" 2>&1 ); RS=$?
printf '%s\n' "$RD" | tail -17 | sed 's/^/    /'
if [ $RS -ne 0 ] || ! grep -q "REPOSITORY READY" <<<"$RD"; then echo "READINESS FAILED (exit $RS)"; FAILS=$((FAILS + 1)); else echo "readiness: REPOSITORY READY (exit 0)"; fi

echo; echo "### 3. checkout, ledger, register, retired AFL Tables"
eq "checkout HEAD" "$(git -C "$CHK" rev-parse HEAD)" "$N"
eq "checkout porcelain lines" "$(git -C "$CHK" status --porcelain | wc -l)" 0
eq "local origin/main ref (no fetch performed)" "$(git -C "$CHK" rev-parse origin/main)" "$N"
"$NODE" -e '
const fs = require("fs"); const r = process.argv[1];
const reg = JSON.parse(fs.readFileSync(r + "/data/reference/seasons.json", "utf8"));
const net = JSON.parse(fs.readFileSync(r + "/data/reference/afltables-network.json", "utf8"));
console.log("in_progress_seasons=" + JSON.stringify(reg.in_progress_seasons) + " afltables-network status=" + net.status);
process.exit(JSON.stringify(reg.in_progress_seasons) === "[2027]" && net.status === "retired" ? 0 : 1);' "$CHK" || { echo "UNEXPECTED: register is not exactly [2027] or AFL Tables switch is not retired"; MISMATCH=$((MISMATCH + 1)); }
backup_identity
expect "migration ledger rows" "SELECT count(*) FROM afldb_meta.schema_migrations" 118
expect "ledger last migration" "SELECT name FROM afldb_meta.schema_migrations ORDER BY name COLLATE \"C\" DESC LIMIT 1" 118_fixtures_unconfirmed_participants.sql

echo; echo "### 4. serving release and the web service"
eq "releases/current" "$(readlink "$ROOT/current")" "releases/$SERVING_ID"
eq "releases/previous" "$(readlink "$ROOT/previous")" "releases/$ROLLBACK_ID"
PID=$(systemctl show -p MainPID --value afldb)
echo "afldb MainPID=$PID NRestarts=$(systemctl show -p NRestarts --value afldb) ActiveEnterTimestamp=$(systemctl show -p ActiveEnterTimestamp --value afldb) ActiveEnterMonotonic=$(systemctl show -p ActiveEnterTimestampMonotonic --value afldb)"
eq "afldb ActiveState" "$(systemctl show -p ActiveState --value afldb)" active
eq "MainPID cwd is the serving release" "$(readlink "/proc/$PID/cwd")" "$ROOT/releases/$SERVING_ID"
echo "MainPID user: $(ps -o user= -p "$PID" 2>/dev/null | tr -d ' ')"
echo "unit EnvironmentFiles: $(systemctl show -p EnvironmentFiles --value afldb)"
eq "unit EnvironmentFiles names the checkout .env" "$(systemctl show -p EnvironmentFiles --value afldb | grep -c '/home/arm/projects/afldb/.env')" 1
eq "unit UnsetEnvironment mentions AFLDB_SETTLE_TRIGGER" "$(systemctl show -p UnsetEnvironment --value afldb | grep -c 'AFLDB_SETTLE_TRIGGER')" 0
echo "unit Environment names only: $(systemctl show -p Environment --value afldb | tr ' ' '\n' | sed 's/=.*//' | tr '\n' ' ')"
echo "health: $(curl -s -o /dev/null -m 10 -w '%{http_code}' http://127.0.0.1:3100/api/health)"
echo ".env stat (perm owner size mtime): $(stat -c '%a %U %s %Y' "$CHK/.env")"

echo; echo "### 5. the trigger variable: absent everywhere (counts only; no value is printed)"
eq "AFLDB_SETTLE_TRIGGER lines starting the line in .env" "$(grep -c '^AFLDB_SETTLE_TRIGGER' "$CHK/.env" || true)" 0
eq "any mention of AFLDB_SETTLE_TRIGGER in .env (comments included)" "$(grep -c 'AFLDB_SETTLE_TRIGGER' "$CHK/.env" || true)" 0
if [ -r "/proc/$PID/environ" ]; then eq "AFLDB_SETTLE_TRIGGER in the serving process environment" "$(tr '\0' '\n' < "/proc/$PID/environ" | grep -c '^AFLDB_SETTLE_TRIGGER' || true)" 0
else echo "serving process environment: NOT READABLE as arm (the owner's sudo read-back is then authoritative)"; fi

echo; echo "### 6. switches and audit trail (database, read-only session)"
expect "AFL API current-season switch (stored value)" "SELECT value::text FROM site_settings WHERE key = 'acquisition.afl_api_current_season_enabled'" false
show "Brownlow admin switch row (count, value or <absent>)" "SELECT count(*), COALESCE(string_agg(value::text, ','), '<absent>') FROM site_settings WHERE key = 'acquisition.afl_api_brownlow_enabled'"
expect "ingestion-switch audit rows after id 304" "SELECT count(*) FROM auth_audit_log WHERE action = 'current_season.afl_api_ingestion_set' AND id > 304" 0
show "latest 3 audit rows (id, at, action)" "SELECT id, at, action FROM auth_audit_log ORDER BY id DESC LIMIT 3"
show "latest 3 import batches (id, source, tool, started_at, status)" "SELECT b.id, COALESCE(s.key,'<NULL>'), b.tool, b.started_at, b.status FROM import_batches b LEFT JOIN sources s ON s.id=b.source_id ORDER BY b.id DESC LIMIT 3"

echo; echo "### 7. units, timers, polkit"
for u in afldb-settle-afl-api.service afldb-settle-afl-api-brownlow.service; do eq "$u load/active" "$(systemctl show -p LoadState --value "$u")/$(systemctl show -p ActiveState --value "$u")" "loaded/inactive"; done
for u in afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.timer afldb-settle-afltables.timer; do eq "$u enabled/active" "$(systemctl is-enabled "$u" 2>&1)/$(systemctl show -p ActiveState --value "$u")" "disabled/inactive"; done
echo "AFL-related timers known to systemd (all states):"; systemctl list-timers --all --no-pager 2>&1 | grep -i 'afldb' | sed 's/^/    /' || echo "    (none scheduled)"
for d in /etc/polkit-1/rules.d /usr/share/polkit-1/rules.d; do
  echo "polkit $d (as arm, no sudo):"; ls -la "$d" 2>&1 | sed 's/^/    /'
  n=$(grep -rIl 'afldb' "$d" 2>/dev/null | wc -l); eq "files under $d that mention afldb (0 if unreadable as arm)" "$n" 0
done
echo "polkit rule file names containing afldb anywhere under /etc/polkit-1 or /usr/share/polkit-1: $(find /etc/polkit-1 /usr/share/polkit-1 -iname '*afldb*' 2>/dev/null | wc -l)"
echo "repository polkit rule (the retired ISSUE-127 grant), for reference only: $(ls "$CHK"/deploy/*.rules 2>/dev/null | tr '\n' ' ')"

echo; echo "failed queries/phases: $FAILS; unexpected values: $MISMATCH"
if [ "$FAILS" -eq 0 ] && [ "$MISMATCH" -eq 0 ]; then echo "C5 PREP CONSISTENT (read-only survey; every precondition listed above held)"; exit 0; fi
echo "C5 PREP NOT CONSISTENT (a failed read or an unexpected value is a finding for review; nothing was changed)"; exit 1
