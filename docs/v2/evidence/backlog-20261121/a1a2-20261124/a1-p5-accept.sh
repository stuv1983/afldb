#!/usr/bin/env bash
# Sitting A1, block P5: acceptance after the owner's env change and restart. PRODUCTION, as arm. READ-ONLY except the one
# season refresh (loopback POST fan-out by tools/maintenance/revalidate-season.ts, which expires /seasons/2026 and
# /brownlow/2026 on every worker; no data write).
#   1. release.mjs status --expect NEW_ID --confirm-restart-invocation <the owner's restart InvocationID>   PASS
#   2. post-install-check.sh --confirm-restart-invocation <InvocationID> NEW_ID aATnIlFOIQjq2z5oDdoHC        PASS
#      (the previous BUILD_ID answers 404 at the origin)
#   3. process environment: both names present in the MainPID and in each worker (COUNTS ONLY, values never read)
#   4. revalidate-season.ts --season 2026: exit 0 and "2/2 worker(s)". Exit 1 or 2 = FAIL, recorded and taken to the owner;
#      NOT a rollback trigger by itself and never "fixed" by another restart (RC-371-372.md section 4)
# Then run a1-rawhead.sh check (separate connection) and start a1-p6-observe.sh.
# Run: tr -d '\r' < a1-p5-accept.sh | C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes afldb bash -s -- <NEW_ID> <InvocationID>
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node; export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
CHK=/home/arm/projects/afldb; ROOT=/home/arm/afldb-releases; cd "$CHK"
CUR_OLD=c8d4202a4cb3-aATnIlFOIQjq2z5oDdoHC; OLD_BUILD=aATnIlFOIQjq2z5oDdoHC
NEW_ID=${1:?NEW_ID}; [[ $NEW_ID =~ ^7d92042fd110-[A-Za-z0-9_-]{1,64}$ ]]
INV=${2:?InvocationID}; [[ $INV =~ ^[0-9a-f]{32}$ ]]
echo "== A1 P5 $(date -u +%FT%TZ)"
[ "$(readlink "$ROOT/current")" = "releases/$NEW_ID" ]; [ "$(readlink "$ROOT/previous")" = "releases/$CUR_OLD" ]; echo "PASS links"
[ "$(systemctl show afldb -p InvocationID --value)" = "$INV" ]; echo "PASS running invocation = the owner's restart $INV"
F=0
"$N" deploy/release.mjs status --expect "$NEW_ID" --confirm-restart-invocation "$INV" && echo "PASS 1 status --expect" || { echo "FAIL 1 status --expect (rollback trigger)"; F=1; }
bash deploy/post-install-check.sh --confirm-restart-invocation "$INV" "$NEW_ID" "$OLD_BUILD" && echo "PASS 2 post-install-check" || { echo "FAIL 2 post-install-check (rollback trigger)"; F=1; }
MAIN=$(systemctl show afldb -p MainPID --value); [[ $MAIN =~ ^[1-9][0-9]*$ ]]
PIDS="$MAIN $(pgrep -P "$MAIN" -x node | tr '\n' ' ' || true)"; echo "processes: $PIDS"
NW=$(pgrep -P "$MAIN" -x node | wc -l || true); echo "worker processes: $NW (expect 2)"
E=0
for p in $PIDS; do
  u=$(tr '\0' '\n' < "/proc/$p/environ" | grep -c '^AFLDB_REVALIDATE_URL=' || true)
  s=$(tr '\0' '\n' < "/proc/$p/environ" | grep -c '^AFLDB_REVALIDATE_SECRET=' || true)
  echo "  pid $p: URL count $u, SECRET count $s"; [ "$u" = 1 ] && [ "$s" = 1 ] || E=1
done
[ "$NW" = 2 ] && [ $E = 0 ] && echo "PASS 3 both names in MainPID and 2 workers (counts only)" || { echo "FAIL 3 environment (record; owner)"; F=1; }
OUT=$(npx tsx tools/maintenance/revalidate-season.ts --season 2026 2>&1) && RC=0 || RC=$?
printf '%s\n' "$OUT" | tail -n 5; echo "revalidate exit=$RC"
if [ $RC = 0 ] && grep -q '2/2 worker' <<< "$OUT"; then echo "PASS 4 season refresh 2/2"; else echo "FAIL 4 season refresh (NOT a rollback trigger; record, owner; never restart again)"; F=1; fi
systemctl show afldb -p ActiveState -p NRestarts -p InvocationID -p ActiveEnterTimestamp
[ $F = 0 ] && echo "P5 RESULT ACCEPT PASS (1-4)" || { echo "P5 RESULT FAIL: see the FAIL lines; rollback only on 1 or 2 (or unit/5xx/journal triggers)"; exit 1; }
}
main "$@" < /dev/null
