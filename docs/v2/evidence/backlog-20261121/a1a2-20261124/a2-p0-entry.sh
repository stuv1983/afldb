#!/usr/bin/env bash
# Sitting A2, block P0: entry probe (packet section 3 common probe, re-pinned for the state A1 left). PRODUCTION, as arm,
# READ-ONLY (one read-only transaction through the backup role). Any difference from the expected values is a STOP for A2.
# OUTCOME (from A1):
#   accepted    HEAD 7d92042f; current = NEW_ID (7d92042fd110-…); previous = c8d4202a4cb3-aATnIlFOIQjq2z5oDdoHC; env counts 1/1
#   stopped     A1 stopped before promotion: HEAD c8d4202a or 7d92042f; current = c8d4202a…; previous = a2e6ea99…; env counts 0/0
#   rolledback  HEAD 7d92042f; current = c8d4202a…; env counts recorded (1/1 unless the owner removed them); previous recorded
# In every outcome the files A2 installs/executes are byte-equal at c8d4202a and 7d92042f, so the sha256 pins below hold.
# Run: tr -d '\r' < a2-p0-entry.sh | C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes afldb bash -s -- <accepted|stopped|rolledback> [NEW_ID]
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node; export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
CHK=/home/arm/projects/afldb; ROOT=/home/arm/afldb-releases; cd "$CHK"
H_SERVE=c8d4202a4cb3cf0ccdd1cad01e1227a1610c2d76; CAND=7d92042fd11010eaa20966e2f49ae7a93e286568
OLD=c8d4202a4cb3-aATnIlFOIQjq2z5oDdoHC; OLDPREV=a2e6ea9995a4-aKAYwf0qC4go6JJWiHhv5
OUTCOME=${1:?outcome}; NEW_ID=${2:-}
echo "== A2 P0 $(date -u +%FT%TZ) outcome=$OUTCOME"
HEAD=$(git rev-parse HEAD); CURL=$(readlink "$ROOT/current"); PREVL=$(readlink "$ROOT/previous")
echo "HEAD $HEAD; current $CURL; previous $PREVL"
[ -z "$(git status --porcelain)" ]; echo "PASS porcelain empty"
U=$(grep -c '^AFLDB_REVALIDATE_URL=' .env || true); S=$(grep -c '^AFLDB_REVALIDATE_SECRET=' .env || true); echo "env counts $U/$S"
case $OUTCOME in
  accepted)   [[ $NEW_ID =~ ^7d92042fd110-[A-Za-z0-9_-]{1,64}$ ]]; [ "$HEAD" = "$CAND" ]; [ "$CURL" = "releases/$NEW_ID" ]; [ "$PREVL" = "releases/$OLD" ]; [ "$U/$S" = 1/1 ];;
  stopped)    { [ "$HEAD" = "$H_SERVE" ] || [ "$HEAD" = "$CAND" ]; }; [ "$CURL" = "releases/$OLD" ]; [ "$PREVL" = "releases/$OLDPREV" ]; [ "$U/$S" = 0/0 ];;
  rolledback) [ "$HEAD" = "$CAND" ]; [ "$CURL" = "releases/$OLD" ];;
  *) echo "STOP unknown outcome"; exit 1;;
esac
echo "PASS state matches outcome $OUTCOME"
"$N" deploy/release.mjs status
"$N" deploy/release.mjs host-gate
echo "-- A2 file pins (must equal; byte-equal at c8d4202a and 7d92042f)"
sha256sum -c --quiet <<'SUMS' && echo "PASS 16 A2 file pins"
d80838cbb7162c3877ab9bf0c87d70a575b55fbc7f902bcc74d4bc6f9e65abd8  deploy/afldb-settle-failure-status.sh
183691d90ff3777ce199b8d3d154c812532aad6be4c195f324cc3141b506350e  deploy/host-policy/needrestart-afldb-hold.conf
4a277b8b6e7c7c8b8d2cb347f8949260941327cd24dbd5f3664b317611648810  deploy/host-policy/apt-52-afldb-unattended.conf
f00859d5c834be09f064d516ea4fa12612da379e377128e784b3523016a6086d  deploy/Caddyfile.production
ea48205a02e6383c2fe87a9e896afed422ff44834231270cbd22dc78c305de9b  tools/maintenance/offhost-pull.sh
c318c4a5c0a7b0e2398a6cfa55368efbc023d13c52c8bc2d671676cd52a26b21  tools/maintenance/scheduled-backup.sh
8a0ac676455523e484c78602cdb7a04197625348b55fa5950d9497e9a43955e8  tools/maintenance/restore-test.sh
edf002913282e7b1b0fe39970f652ab0120d9963a52b1696768cf928893bbdc8  deploy/afldb-backup.service
76a7ab3ad73377a543434f4174f7948859ac4f28978013a3fa98215fff0e9d84  deploy/afldb-backup.timer
797581e3a45a4344930b23724c31b748c95c18a6855129fbba36449cc5c212ea  deploy/afldb-backup-verify.service
377cf2ec1720cab7fd4f1cdc8b2b875b8af64b4a32ea17a709eb73253378836b  deploy/afldb-backup-verify.timer
c6a5b5fe573c000a908ef6dd0d7c28fc16878e1eada8fdaf3bed034c823f8b61  deploy/afldb-backup-failed.service
4463e1e046e34c1729675d7cf45a213fdbb8128cb667d5479adfe69360c2d3fb  deploy/afldb-settle-failure@.service
63d6271883879028e8ea945323c79da2f225cc74a83d29f4a33d17b5652df26a  deploy/afldb-settle-afl-api.service.d/on-failure.conf
776d066e9525f6a5bbb02fcb16f2b1099ce104814bb7797875f1dcdf3fa31311  tools/maintenance/backup.sh
3d0bb2a995bb93403994dc3f6d99ab64be46c372ac15be16807e3f2187bb5419  deploy/post-install-check.sh
SUMS
uname -r; uptime -s; ls -l /var/run/reboot-required* 2>&1 || true; cat /var/run/reboot-required.pkgs 2>/dev/null || true
dpkg -l 'linux-image-*' | awk '/^(ii|rc)/{print $1,$2}'
grep -hE '^GRUB_(TIMEOUT|TIMEOUT_STYLE|RECORDFAIL_TIMEOUT|DEFAULT)' /etc/default/grub /etc/default/grub.d/*.cfg 2>/dev/null || true
ls -l /etc/needrestart/conf.d/ /etc/apt/apt.conf.d/52-afldb-unattended 2>&1 || true
systemctl list-timers 'afldb*' 'apt-daily*' --all --no-pager
systemctl is-active afldb postgresql@16-main caddy; systemctl show -p InvocationID,NRestarts,ActiveEnterTimestamp afldb
sh deploy/afldb-settle-failure-status.sh && echo "status_rc=0" || echo "status_rc=$?"
df -h /; ls -la /home/arm/backups/; ls /home/arm/backups/afldb | wc -l
test ! -e /home/arm/backups/afldb-scheduled && echo "PASS afldb-scheduled absent (R3 not installed)" || ls -la /home/arm/backups/afldb-scheduled
ls -l /etc/systemd/system/afldb-backup* 2>&1 || true
echo "authorized_keys lines: settle-status $(grep -c 'afldb-settle-status$' ~/.ssh/authorized_keys || true), backup-pull $(grep -c 'afldb-backup-pull$' ~/.ssh/authorized_keys || true), total $(wc -l < ~/.ssh/authorized_keys)"
sha256sum /etc/caddy/Caddyfile; caddy version; ls -la /var/log/caddy/
command -v rrsync || ls -l /usr/bin/rrsync 2>&1 || true
grep -c '^RESTORE_DB="afldb_restore_test"$' tools/maintenance/restore-test.sh
RO=$( ( set -a && . ./.env && set +a
  re='^(postgres(ql)?://)([^:/@]+):([^@]*)@(.*)$'; d=$AFLDB_BACKUP_DATABASE_URL; [[ $d =~ $re ]] || { echo "bad DSN shape" >&2; exit 1; }
  printf -v PGPASSWORD '%b' "${BASH_REMATCH[4]//\%/\\x}"; export PGPASSWORD
  PGOPTIONS='-c default_transaction_read_only=on' psql -X -q -v ON_ERROR_STOP=1 -At -d "${BASH_REMATCH[1]}${BASH_REMATCH[3]}@${BASH_REMATCH[5]}" <<'SQL'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT 'ledger|'||count(*)||'|'||max(name) FROM afldb_meta.schema_migrations;
SELECT 'maxseason|'||max(year) FROM seasons;
SELECT 'maxmatch|'||max(id) FROM matches;
SELECT 'badslugs|'||(SELECT count(*) FROM players WHERE slug !~ '^[a-z0-9-]{1,100}$')||'|'||(SELECT count(*) FROM clubs WHERE slug !~ '^[a-z0-9-]{1,80}$')||'|'||(SELECT count(*) FROM venues WHERE slug !~ '^[a-z0-9-]{1,80}$');
SELECT 'invites_live|'||count(*) FROM admin_invites WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > now();
SELECT 'db|'||datname||'|'||pg_database_size(datname)||'|'||numbackends FROM pg_stat_database WHERE datname LIKE 'afldb_prod%' OR datname = 'afldb_restore_test' ORDER BY datname;
ROLLBACK;
SQL
) )
echo "$RO"
grep -qx 'ledger|118|118_fixtures_unconfirmed_participants.sql' <<< "$RO"; echo "PASS ledger"
grep -qx 'badslugs|0|0|0' <<< "$RO"; echo "PASS slugs"
[ "$(sed -n 's/^maxmatch|//p' <<< "$RO")" -lt 20000 ]; echo "PASS max(matches.id) < 20000"
grep -qE '^db\|afldb_restore_test\|[0-9]+\|0$' <<< "$RO"; echo "PASS afldb_restore_test exists, numbackends 0 (R3 verify target)"
echo "P0 RESULT PASS ($OUTCOME)"
}
main "$@" < /dev/null
