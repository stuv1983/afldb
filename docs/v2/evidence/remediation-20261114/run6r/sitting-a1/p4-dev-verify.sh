#!/usr/bin/env bash
# Packet 6R sitting, block P4 = packet 6R §5.4 (B1a-0 option A) on the DEV host streamanator, as arm. Touches no production system.
# Precondition: $W was created 700 (with art/, art/b1a0/, art/b1a/) and filled by scp: the dump, its .sha256, parity-prod.txt,
# accept-before-prod.txt, and the 15aa89cb artifacts (art/b1a0/{b1a0-dev-restore-verify.sh,b1a0-parity.sql}, art/b1a/{runner,accept}).
# Run: tr -d '\r' < p4-dev-verify.sh | ssh -i ~/.ssh/afldb_dev arm@10.0.40.100 bash -s -- <STAMP> <dump sha256> <dump bytes>
main() {
set -euo pipefail; export LC_ALL=C
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
STAMP=${1:?STAMP}; SHA=${2:?sha256}; BYTES=${3:?bytes}; [[ $STAMP =~ ^[0-9]{8}T[0-9]{6}Z$ ]]; [[ $SHA =~ ^[0-9a-f]{64}$ ]]; [[ $BYTES =~ ^[0-9]+$ ]]
W=/mnt/ssd/afldb-b1a0-$STAMP
echo "== P4 $(date -u +%FT%TZ) host=$(hostname) W=$W"
chmod -R go-rwx "$W"; find "$W" -type f -exec chmod 600 {} +
[ "$(ls -1 "$W"/afldb_prod-*.dump | wc -l)" = 1 ]; DUMP=$(ls -1 "$W"/afldb_prod-*.dump)
[ "$(cut -d' ' -f1 "$DUMP.sha256")" = "$SHA" ]; (cd "$W" && sha256sum -c "$(basename "$DUMP").sha256")
[ "$(stat -c %s "$DUMP")" = "$BYTES" ]; echo "PASS DEV copy sha256 and size equal production's"
( cd "$W/art" && sha256sum -c - <<'EOF'
bcc4131171a08500cc3b4b64ee51d254a5f0608f450847f17e95a06f62f8c32c  b1a/b1a-repair-2026-r6r.mts
dc6211d7826d03712ab95a872889a562b86c5a86b72a4fc717431005b5033ec7  b1a/b1a-accept-r6r.sql
3ec8fd207117c560af8564e57e70c41381c119df02d3558ab0b58d0cf8c067cf  b1a0/b1a0-dev-restore-verify.sh
7c2a7be0eca0ed1f7024ccc6197b333818caadb7727f2f3be49ae97eb70fcf5d  b1a0/b1a0-parity.sql
EOF
)
echo "PASS artifacts at packet 6R §3 hashes"
set +e; trap - ERR
PORT=61432 bash "$W/art/b1a0/b1a0-dev-restore-verify.sh" "$DUMP" "$SHA" "$BYTES" "$W" e5ead8dbf3baf9a7b647b0f55b04c496 2>&1 | tee "$W/verify.txt"
rc=${PIPESTATUS[0]}; set -e; trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
chmod 600 "$W/verify.txt"; echo "verify exit=$rc"
grep -qx 'VERDICT PASS backup proven by a fresh disposable restore' "$W/verify.txt" && [ "$rc" = 0 ] && echo "P4 RESULT VERDICT PASS" || echo "P4 RESULT NOT PASS: B1a does not run"
S2=$(basename "$DUMP" .dump | tr -c 'A-Za-z0-9\n' '-' | tr 'A-Z' 'a-z')   # the verify script's own cluster-root naming
ls -ld "$W" "/mnt/ssd/afldb-b1a0-verify-$S2-pg" 2>/dev/null || true
}
main "$@" < /dev/null
