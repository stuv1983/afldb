#!/usr/bin/env bash
# Dry tests for a2-cron-install.sh / a2-cron-observe.sh (run d, 2026-11-22). STREAMANATOR, as arm, in a NEW scratch workspace.
# Never touches arm's real crontab: every call goes to a stub through CRONTAB_BIN (reviewer F-001); the real `crontab -l` hash
# is recorded before and after and must be equal. Never executes the real wrappers and never contacts production: the only
# wrapper run (T16, the cron-environment alarm path, reviewer F-005) is a SCRATCH COPY with AFLDB_PROD_SSH=*.invalid, a
# nonexistent key, a scratch state directory and a stub alarm sink (no email is sent).
# Usage: bash t-cron.sh <workspace> <dir holding a2-cron-install.sh and a2-cron-observe.sh>
set -uo pipefail; export LC_ALL=C
WS=${1:?workspace}; SRC=${2:?script dir}
[ -d "$WS" ] && [ -z "$(ls -A "$WS" | grep -v '^scripts$')" ] || { echo "workspace must exist and hold only scripts/"; exit 2; }
REAL0=$(/usr/bin/crontab -l 2>/dev/null | sha256sum | cut -c1-64); echo "real crontab sha256 before: $REAL0"
OPS=$WS/ops; DEST=$WS/offhost; mkdir -p -m 700 "$OPS/state" "$DEST" "$WS/bin"
cp -p /home/arm/afldb-ops/afldb-settle-check.sh /home/arm/afldb-ops/afldb-offhost-pull-daily.sh /home/arm/afldb-ops/offhost-pull.sh /home/arm/afldb-ops/alarm-email.sh "$OPS/"
printf 'SMTP_URL=CHANGE_ME\n' > "$OPS/alarm-smtp.env"; chmod 600 "$OPS/alarm-smtp.env"   # dummy: the real settings file is never copied or read
STUB=$WS/stub-crontab.txt; SLOG=$WS/stub-calls.log
cat > "$WS/bin/crontab" <<'EOF'
#!/bin/sh
echo "$(date -u +%T) $*" >> "$STUB_LOG"
[ "${STUB_FAIL_LIST:-}" = 1 ] && [ "$1" = -l ] && { echo "stub: forced failure" >&2; exit 1; }
if [ "$1" = -l ]; then [ -f "$STUB_FILE" ] || { echo "no crontab for arm" >&2; exit 1; }; cat "$STUB_FILE"; exit 0; fi
[ $# = 1 ] && [ -f "$1" ] || { echo "stub: unsupported $*" >&2; exit 2; }
cp "$1" "$STUB_FILE"; if [ -n "${STUB_CORRUPT_ONCE:-}" ] && [ -e "$STUB_CORRUPT_ONCE" ]; then rm -f "$STUB_CORRUPT_ONCE"; echo "# corrupted by stub" >> "$STUB_FILE"; fi; exit 0
EOF
chmod 700 "$WS/bin/crontab"
export CRONTAB_BIN=$WS/bin/crontab STUB_FILE=$STUB STUB_LOG=$SLOG AFLDB_OPS=$OPS AFLDB_OFFHOST_DEST=$DEST
I=$SRC/a2-cron-install.sh; O=$SRC/a2-cron-observe.sh
base() { : > "$STUB"; for i in $(seq 1 24); do echo "# baseline comment line $i" >> "$STUB"; done; }
pass=0; fail=0
t() { local name=$1 want=$2; shift 2; local out rc; out=$("$@" 2>&1); rc=$?
  if [ "$rc" = "$want" ]; then pass=$((pass+1)); echo "PASS $name (rc $rc)"; else fail=$((fail+1)); echo "FAIL $name (rc $rc, want $want)"; printf '%s\n' "$out" | sed 's/^/     /' | tail -n 12; fi
  printf '%s\n' "$out" > "$WS/out-$name.txt"; }
has() { if grep -q "$2" "$WS/out-$1.txt"; then pass=$((pass+1)); echo "PASS $1 says: $2"; else fail=$((fail+1)); echo "FAIL $1 lacks: $2"; fi; }
eqf() { if cmp -s "$1" "$2"; then pass=$((pass+1)); echo "PASS $3"; else fail=$((fail+1)); echo "FAIL $3"; diff "$1" "$2" | head -5; fi; }
okline() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) rc=0 AFLDB_SETTLE_STATUS OK" >> "$OPS/state/settle-check.log"; }

base; cp "$STUB" "$WS/baseline.txt"
t T01-check-r2-no-run 0 bash "$I" check r2;             has T01-check-r2-no-run "PRECONDITIONS FAIL"; has T01-check-r2-no-run "NOT INSTALLED"
t T02-install-r2-no-run 3 bash "$I" install r2;          eqf "$STUB" "$WS/baseline.txt" "T02 crontab unchanged after refused install"
echo "$(date -u -d '-7 hours' +%Y-%m-%dT%H:%M:%SZ) rc=0 AFLDB_SETTLE_STATUS OK" >> "$OPS/state/settle-check.log"
t T03-install-r2-stale-ok 3 bash "$I" install r2;        has T03-install-r2-stale-ok "not a successful run within 6 h"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) rc=255 ssh: connect refused" >> "$OPS/state/settle-check.log"
t T04-install-r2-last-fail 3 bash "$I" install r2
okline
t T05-dry-run 0 bash "$I" install r2 --dry-run;          has T05-dry-run "DRY RUN OK"; eqf "$STUB" "$WS/baseline.txt" "T05 dry run wrote nothing"
t T06-install-r2 0 bash "$I" install r2;                 has T06-install-r2 "CRON INSTALL r2 PASS: next due"
{ cat "$WS/baseline.txt"; echo "# AFLDB-A2-r2: ISSUE-332 hourly settle-status pull check (owner decision 3, 2026-11-22); installed by a2-cron-install.sh"
  echo "17 * * * * AFLDB_ALARM_CMD=/home/arm/afldb-ops/alarm-email.sh /bin/sh /home/arm/afldb-ops/afldb-settle-check.sh"; } > "$WS/expect-r2.txt"
eqf "$STUB" "$WS/expect-r2.txt" "T06 crontab = baseline + marker + job (exact bytes)"
[ -n "$(ls "$OPS/state"/crontab.pre-a2-r2-install-* 2>/dev/null)" ] && [ "$(stat -c %a "$OPS/state"/crontab.pre-a2-r2-install-*)" = 600 ] && { pass=$((pass+1)); echo "PASS T06 0600 pre-image backup kept"; } || { fail=$((fail+1)); echo "FAIL T06 backup"; }
t T07-reinstall-r2 0 bash "$I" install r2;               has T07-reinstall-r2 "ALREADY INSTALLED"; eqf "$STUB" "$WS/expect-r2.txt" "T07 idempotent: unchanged"
t T08-check-r2-installed 0 bash "$I" check r2;           has T08-check-r2-installed "CRON CHECK r2 INSTALLED (next due"
sed -i 's#^17 \* \* \* \*#47 * * * *#' "$STUB"
t T09-marker-other-line 3 bash "$I" install r2;          has T09-marker-other-line "partial, duplicate or different"
t T10-remove-mismatch 3 bash "$I" remove r2
cp "$WS/expect-r2.txt" "$STUB"
t T11-remove-r2 0 bash "$I" remove r2;                   eqf "$STUB" "$WS/baseline.txt" "T11 remove restores the baseline exactly"
t T12-remove-again 0 bash "$I" remove r2;                has T12-remove-again "NOT INSTALLED"
head -c -1 "$WS/baseline.txt" > "$STUB"   # baseline without its final newline
t T13-no-final-newline 0 bash "$I" install r2;           has T13-no-final-newline "added the missing final newline"; eqf "$STUB" "$WS/expect-r2.txt" "T13 lines not joined"
base; head -n 10 "$WS/baseline.txt" > "$STUB"
t T14-short-crontab 3 bash "$I" install r2;              has T14-short-crontab "fewer than the recorded baseline"
base; t T15-list-fails 3 env STUB_FAIL_LIST=1 bash "$I" install r2; has T15-list-fails "crontab -l failed"; eqf "$STUB" "$WS/baseline.txt" "T15 unchanged"
: > "$WS/corrupt-once"; t T16-corrupting-write 4 env STUB_CORRUPT_ONCE="$WS/corrupt-once" bash "$I" install r2; has T16-corrupting-write "restored: crontab equals the pre-image"
eqf "$STUB" "$WS/baseline.txt" "T16 pre-image restored after a corrupt write"
cp -p "$OPS/afldb-settle-check.sh" "$WS/wrapper.keep"; echo "# tampered" >> "$OPS/afldb-settle-check.sh"
t T17-wrapper-pin 3 bash "$I" install r2;                has T17-wrapper-pin "differs from its pin"; cp -p "$WS/wrapper.keep" "$OPS/afldb-settle-check.sh"
base
t T18-install-r3-nothing 3 bash "$I" install r3;         has T18-install-r3-nothing "no verified newest dump"
D=afldb_prod-20261124-120000.dump; head -c 4096 /dev/urandom > "$DEST/$D"; (cd "$DEST" && sha256sum "$D" > "$D.sha256"); : > "$DEST/.verified-$D"
t T19-install-r3-no-restore-log 3 bash "$I" install r3;  has T19-install-r3-no-restore-log "does not record a PASS restore"
printf 'DUMP %s\nPASS sidecar verifies\npg_restore exit=0, stderr lines 0\nFIRSTCOPY RESULT RESTORE PASS (x)\n' "$DEST/$D" > "$OPS/state/a2-firstcopy-restore.log"
echo corrupt >> "$DEST/$D"
t T20-install-r3-bad-sidecar 3 bash "$I" install r3
head -c 4096 /dev/urandom > "$DEST/$D"; (cd "$DEST" && sha256sum "$D" > "$D.sha256")
t T21-install-r3 0 bash "$I" install r3;                 has T21-install-r3 "CRON INSTALL r3 PASS: next due"
okline; t T22-install-r2-after-r3 0 bash "$I" install r2; [ "$(grep -c '^# AFLDB-A2-' "$STUB")" = 2 ] && [ "$(wc -l < "$STUB")" = 28 ] && { pass=$((pass+1)); echo "PASS T22 both jobs, 28 lines"; } || { fail=$((fail+1)); echo "FAIL T22"; }
t T23-observe 0 bash "$O" all;                           has T23-observe "OBSERVE DONE"
# T24: the wrapper's alarm path under cron's environment (scratch copy, .invalid host, stub sink; no production contact, no email)
SINK=$WS/sink.txt; printf '#!/bin/sh\ncat > %s\n' "$SINK" > "$WS/bin/sink"; chmod 700 "$WS/bin/sink"
rc=0; env -i HOME=/home/arm LOGNAME=arm SHELL=/bin/sh PATH=/usr/bin:/bin AFLDB_PROD_SSH=arm@afldb-nonexistent.invalid \
  AFLDB_SETTLE_KEY=$WS/no-such-key AFLDB_OPS_STATE=$WS/cronenv-state AFLDB_ALARM_CMD=$WS/bin/sink /bin/sh "$OPS/afldb-settle-check.sh" > "$WS/out-T24.txt" 2>&1 || rc=$?
if [ "$rc" = 1 ] && grep -q 'AFLDB settle check failed rc=255' "$SINK"; then pass=$((pass+1)); echo "PASS T24 cron-env alarm path: wrapper rc 1, sink received the alarm"; else fail=$((fail+1)); echo "FAIL T24 rc=$rc"; fi
grep -c 'stub' "$SLOG" >/dev/null; calls=$(wc -l < "$SLOG"); [ "$calls" -gt 0 ] && { pass=$((pass+1)); echo "PASS stub crontab received $calls calls"; } || { fail=$((fail+1)); echo "FAIL stub never called"; }
REAL1=$(/usr/bin/crontab -l 2>/dev/null | sha256sum | cut -c1-64); echo "real crontab sha256 after:  $REAL1"
[ "$REAL0" = "$REAL1" ] && { pass=$((pass+1)); echo "PASS real crontab unchanged"; } || { fail=$((fail+1)); echo "FAIL REAL CRONTAB CHANGED"; }
echo "T-CRON RESULT pass=$pass fail=$fail"
