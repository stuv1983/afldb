#!/usr/bin/env bash
# Sitting A2, R2/R3: append ONE restricted key line to arm's ~/.ssh/authorized_keys. PRODUCTION, as arm (no sudo).
#   settle  R2 (ISSUE-332): forced command = the read-only settle status script (sha256 d80838cb…, checked first)
#   backup  R3 (ISSUE-352): forced command = rrsync -ro of /home/arm/backups/afldb-scheduled (must exist first)
# Public keys only (the private halves stay on streamanator: kits/KITS-20261122.md). Refuses a second append.
# Backup copy ~/.ssh/authorized_keys.pre-a2-<kind>-<STAMP> (0600). Recovery: restore that copy (or delete the one line).
# Run: tr -d '\r' < a2-keyline.sh | C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes afldb bash -s -- settle|backup
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
cd /home/arm/projects/afldb; AK=/home/arm/.ssh/authorized_keys
KIND=${1:?kind}
case $KIND in
  settle)
    [ "$(sha256sum deploy/afldb-settle-failure-status.sh | cut -d' ' -f1)" = d80838cbb7162c3877ab9bf0c87d70a575b55fbc7f902bcc74d4bc6f9e65abd8 ]; echo "PASS forced-command script sha256 d80838cb…"
    TAG=afldb-settle-status
    LINE='command="/bin/sh /home/arm/projects/afldb/deploy/afldb-settle-failure-status.sh",restrict ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGDD6oB3TM4l4z3w39J3QEK2CoqQ3a2DSKBcwC8+sjeH afldb-settle-status';;
  backup)
    [ -d /home/arm/backups/afldb-scheduled ] && [ "$(stat -c %a /home/arm/backups/afldb-scheduled)" = 700 ]; echo "PASS /home/arm/backups/afldb-scheduled exists, 0700"
    [ -x /usr/bin/rrsync ]; echo "PASS /usr/bin/rrsync present"
    TAG=afldb-backup-pull
    LINE='command="/usr/bin/rrsync -ro /home/arm/backups/afldb-scheduled",restrict ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKG9ZwqtHj22g9FDvh8XZhXlNU8k/req/anxCgwIvhyo afldb-backup-pull';;
  *) echo "usage: settle|backup"; exit 2;;
esac
echo "== A2 keyline $KIND $(date -u +%FT%TZ)"
[ "$(grep -c " $TAG\$" "$AK" || true)" = 0 ] || { echo "STOP a $TAG line already exists"; exit 1; }
[ "$(tail -c1 "$AK" | wc -l)" = 1 ]; echo "PASS authorized_keys ends with a newline"
echo "authorized_keys mode $(stat -c %a "$AK") (recorded; unchanged by the append)"
B=$AK.pre-a2-$KIND-$(date -u +%Y%m%dT%H%M%SZ); cp -p "$AK" "$B"; chmod 600 "$B"; echo "backup $B"
L0=$(wc -l < "$AK")
printf '%s\n' "$LINE" >> "$AK"
[ "$(wc -l < "$AK")" = $((L0 + 1)) ]; [ "$(grep -c " $TAG\$" "$AK")" = 1 ]
echo "PASS one $TAG line appended ($L0 -> $((L0 + 1)) lines)"
ssh-keygen -lf <(grep " $TAG\$" "$AK")
echo "KEYLINE RESULT PASS $KIND"
}
main "$@" < /dev/null
