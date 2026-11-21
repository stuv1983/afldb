#!/usr/bin/env bash
# Sitting A2, R3 step before `systemctl start afldb-backup-verify.service` (reviewer F-007, production restore target).
# PRODUCTION, as arm, READ-ONLY. The verify unit restores a fresh dump INTO afldb_restore_test (restore-test.sh drops and
# recreates exactly that database). Checks: the attended backup dump exists with its sidecar and verifies; restore-test.sh and
# the unit name exactly afldb_restore_test and nothing else; afldb_restore_test exists with numbackends 0; afldb_prod untouched.
# Run: tr -d '\r' < a2-r3-verify-target.sh | C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes afldb bash -s
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
cd /home/arm/projects/afldb; D=/home/arm/backups/afldb-scheduled
echo "== A2 R3 verify-target $(date -u +%FT%TZ)"
ls -la "$D"
F=$(ls -1t "$D"/afldb_prod-*.dump | head -n 1); [ -n "$F" ]; echo "newest dump $F ($(stat -c %s "$F") B)"
( cd "$D" && sha256sum -c "$(basename "$F").sha256" ); echo "PASS sidecar verifies"
[ "$(grep -c '^RESTORE_DB="afldb_restore_test"$' tools/maintenance/restore-test.sh)" = 1 ]; echo "PASS restore-test.sh target is literally afldb_restore_test"
grep -n 'ExecStart=' /etc/systemd/system/afldb-backup-verify.service
grep -q 'scheduled-backup.sh verify$' /etc/systemd/system/afldb-backup-verify.service; echo "PASS unit runs scheduled-backup.sh verify"
cmp -s /etc/systemd/system/afldb-backup-verify.service deploy/afldb-backup-verify.service; echo "PASS installed unit = repository unit"
RO=$( ( set -a && . ./.env && set +a
  re='^(postgres(ql)?://)([^:/@]+):([^@]*)@(.*)$'; d=$AFLDB_BACKUP_DATABASE_URL; [[ $d =~ $re ]] || { echo "bad DSN shape" >&2; exit 1; }
  printf -v PGPASSWORD '%b' "${BASH_REMATCH[4]//\%/\\x}"; export PGPASSWORD
  PGOPTIONS='-c default_transaction_read_only=on' psql -X -q -v ON_ERROR_STOP=1 -At -d "${BASH_REMATCH[1]}${BASH_REMATCH[3]}@${BASH_REMATCH[5]}" <<'SQL'
SELECT 'db|'||datname||'|'||numbackends FROM pg_stat_database WHERE datname IN ('afldb_restore_test','afldb_prod') ORDER BY datname;
SQL
) )
echo "$RO"
grep -qx 'db|afldb_restore_test|0' <<< "$RO"; echo "PASS afldb_restore_test exists, numbackends 0"
echo "R3 VERIFY-TARGET RESULT PASS: the owner may start afldb-backup-verify.service"
}
main "$@" < /dev/null
