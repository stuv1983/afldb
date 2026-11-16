#!/usr/bin/env bash
# Packet 6R sitting, block R1: read-only state determination. PRODUCTION, as arm. Writes nothing on the host except, with "probe",
# the acceptance-probe output file $A/accept-state-<UTC>.txt (packet 6R §4.2, for any B1a outcome other than COMMITTED or for B1a-0 failure).
# Prints: checkout HEAD and porcelain, release links and status, last events, unit state, tmux sessions; optionally the 2026 probe.
# Run: tr -d '\r' < r1-state.sh | ssh afldb bash -s -- <STAMP> [probe]
main() {
set -uo pipefail; export LC_ALL=C
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node; export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
CHK=/home/arm/projects/afldb; ROOT=/home/arm/afldb-releases; cd "$CHK" || exit 1
STAMP=${1:?STAMP}; [[ $STAMP =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || exit 1; A=/home/arm/b1a-r6r-$STAMP
echo "== R1 $(date -u +%FT%TZ)"
echo "HEAD $(git rev-parse HEAD) porcelain=$(git status --porcelain | wc -l)"; git status --porcelain | head -5
echo "current -> $(readlink "$ROOT/current")"; echo "previous -> $(readlink "$ROOT/previous")"
tail -n 4 "$ROOT/events.log"
"$N" deploy/release.mjs status
systemctl show afldb -p ActiveState -p SubState -p Result -p NRestarts -p InvocationID -p ActiveEnterTimestamp
tmux ls 2>/dev/null || echo "no tmux sessions"
# AMENDMENT A1: the persisted step records, so a lost P5/P6 session's own OUTCOME is read before any decision.
for f in "$A/p5-result.txt" "$A/dryrun.txt" "$A/commit.txt" "$A/p6-result.txt" "/home/arm/backups/afldb-b1a-$STAMP/before-check.txt"; do
  if [ -f "$f" ]; then echo "--- $f"; grep -E '^(OUTCOME|exit=|P5 RESULT|P6 RESULT|BEFORE-CHECK)' "$f"; else echo "--- $f absent"; fi; done
pgrep -af 'b1a-repair|release.mjs' || echo "no runner/release process"
if [ "${2:-}" = probe ]; then
  O="$A/accept-state-$(date -u +%Y%m%dT%H%M%SZ).txt"
  ( set -a && . ./.env && set +a
    pgconn() { local d="${!1}" re='^(postgres(ql)?://)([^:/@]+):([^@]*)@(.*)$'; [[ $d =~ $re ]] || { echo "bad DSN shape in $1" >&2; return 1; }
      printf -v PGPASSWORD '%b' "${BASH_REMATCH[4]//\%/\\x}"; export PGPASSWORD; DSN="${BASH_REMATCH[1]}${BASH_REMATCH[3]}@${BASH_REMATCH[5]}"; }
    pgconn AFLDB_BACKUP_DATABASE_URL &&
    PGOPTIONS='-c default_transaction_read_only=on' psql -X -v ON_ERROR_STOP=1 -At -v db=afldb_prod -v oid=66668 \
      -v sysid=7674454702926115004 -d "$DSN" -f "$A/b1a-accept-r6r.sql" ) > "$O"; echo "probe exit=$?"; chmod 600 "$O"; cat "$O"
fi
}
main "$@" < /dev/null
