#!/usr/bin/env bash
# ISSUE-352: check or install the streamanator off-host helper PAIR (daily wrapper + scheduled-pull verifier) as ONE checked step.
# STREAMANATOR, as arm. Never run on production. Never executes the wrapper, never touches the crontab, the destination, the
# keys, the alarm settings, holds or state/offhost-pull.log (the crontab and log are fingerprinted before and after).
#   check                 read-only. Exit 0 only when BOTH installed helpers equal their pins and the core pull equals its pin.
#   install [KITS_DIR]    verify, then replace only the helpers that differ, the verifier first and the wrapper LAST (the
#                         wrapper is the activation switch: the scheduled path keeps the previous, working wrapper until the
#                         very last rename). Prior copies are kept as <name>.pre-352-<stamp>. Any failure after the first
#                         rename restores every changed file from those copies and re-verifies. Re-running after an
#                         interruption completes the pair idempotently.
#   KITS_DIR defaults to ../kits beside this script, i.e. the pinned git-archive extraction.
# Exit status: 0 ok (or already current) | 2 usage | 3 precondition failed, NOTHING changed | 4 failed, previous state restored
#   and verified | 5 failed AND the restore could not be verified (owner: copy <name>.pre-352-<stamp> back by hand) |
#   1 check found the pair not current.
# The scheduled window (03:00-03:55 Melbourne) and a running pull both refuse an install so a swap cannot meet a pull.
set -uo pipefail; export LC_ALL=C; umask 077
OPS=${AFLDB_OPS:-/home/arm/afldb-ops}
STATE=$OPS/state
CRONTAB_BIN=${CRONTAB_BIN:-/usr/bin/crontab}
EXPECT_HOST=${AFLDB_CRON_EXPECT_HOST:-streamanator}
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
MODE=${1:?check|install}; [[ $MODE =~ ^(check|install)$ ]] || { echo "STOP mode must be check or install"; exit 2; }
KITS=${2:-$HERE/../kits}
# Full SHA-256 pins of the raw repository bytes (see the runbook's blob-pin table).
PIN_WRAPPER=2ebac1c09b07e6b3bc1e060d7645efdbb1c2c7f169b5cfafd4e7f77508716e24
PIN_VERIFIER=d7574254997ba28dd1f750b7bcdc6f90c0a421b88ba6bb02aa104bd671b8572e
PIN_CORE=a3775aea879b1d9ce05d0e96482e66d24c69deb62cf38e8fc0407c0d2653dc2b
W_NAME=afldb-offhost-pull-daily.sh
V_NAME=scheduled-pull-evidence.sh
C_NAME=offhost-pull.sh
sha() { sha256sum < "$1" 2>/dev/null | cut -d' ' -f1; }
fail_pre() { echo "HELPER $MODE STOP (nothing changed): $*"; exit 3; }
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
echo "== helper pair $MODE $STAMP host=$(hostname) user=$(id -un) ops=$OPS"
[ "$(hostname)" = "$EXPECT_HOST" ] && [ "$(id -un)" = arm ] || { echo "STOP not arm@$EXPECT_HOST"; exit 3; }

state_of() {   # current | absent | different, for installed file $1 against pin $2
  [ -f "$OPS/$1" ] || { echo absent; return; }
  [ "$(sha "$OPS/$1")" = "$2" ] && echo current || echo different
}
core_ok() { [ "$(sha "$OPS/$C_NAME")" = "$PIN_CORE" ]; }

if [ "$MODE" = check ]; then
  ws=$(state_of "$W_NAME" "$PIN_WRAPPER"); vs=$(state_of "$V_NAME" "$PIN_VERIFIER")
  echo "wrapper $W_NAME: $ws (pin ${PIN_WRAPPER:0:8})"; echo "verifier $V_NAME: $vs (pin ${PIN_VERIFIER:0:8})"
  cs=FAIL; core_ok && cs=PASS; echo "$cs core $C_NAME (pin ${PIN_CORE:0:8})"
  if [ "$ws" = current ] && [ "$vs" = current ] && [ "$cs" = PASS ]; then echo "HELPER CHECK PASS: pair current"; exit 0; fi
  if [ "$ws" = current ] && [ "$vs" != current ]; then echo "HELPER PAIR PARTIAL: wrapper current, verifier not"; fi
  if [ "$ws" != current ] && [ "$vs" = current ]; then echo "HELPER PAIR PARTIAL: verifier current, wrapper not"; fi
  echo "HELPER CHECK FAIL"; exit 1
fi

# ---------------- install ----------------
[ -d "$KITS" ] || fail_pre "kits directory not found: $KITS"
KITS=$(cd "$KITS" && pwd)
for pair in "$W_NAME:$PIN_WRAPPER" "$V_NAME:$PIN_VERIFIER"; do
  n=${pair%%:*}; pin=${pair#*:}
  [ -f "$KITS/$n" ] || fail_pre "staged helper missing: $KITS/$n"
  [ "$(sha "$KITS/$n")" = "$pin" ] || fail_pre "staged $n differs from its pin ${pin:0:8} (got $(sha "$KITS/$n" | cut -c1-8)); re-extract the pinned archive"
  echo "PASS staged $n = pin ${pin:0:8}"
done
[ -d "$STATE" ] && [ -w "$STATE" ] || fail_pre "state directory missing or not writable: $STATE"
core_ok || fail_pre "installed core $C_NAME differs from its pin ${PIN_CORE:0:8}; the pair is only valid with that core"
echo "PASS installed core $C_NAME = pin ${PIN_CORE:0:8}"
now=${AFLDB_HELPER_NOW:-$(date +%s)}
hm=$(TZ=Australia/Melbourne date -d "@$now" +%H%M)
[ "$hm" -lt 0300 ] 2>/dev/null || [ "$hm" -ge 0355 ] || fail_pre "inside the scheduled pull window 03:00-03:55 Melbourne ($hm): install outside it"
if [ -e "$STATE/offhost-pull.lock" ]; then
  exec 8>>"$STATE/offhost-pull.lock"
  flock -n 8 || fail_pre "a pull is running (offhost-pull.lock held)"
  exec 8>&-
fi
ct0=$("$CRONTAB_BIN" -l 2>/dev/null | sha256sum | cut -d' ' -f1) || fail_pre "crontab unreadable"
log0=0; [ -f "$STATE/offhost-pull.log" ] && log0=$(wc -c < "$STATE/offhost-pull.log")
ws=$(state_of "$W_NAME" "$PIN_WRAPPER"); vs=$(state_of "$V_NAME" "$PIN_VERIFIER")
echo "installed state before: wrapper=$ws verifier=$vs"
if [ "$ws" = current ] && [ "$vs" = current ]; then echo "HELPER INSTALL ALREADY CURRENT (nothing changed)"; exit 0; fi
rm -f -- "$OPS"/."$W_NAME".new-* "$OPS"/."$V_NAME".new-* 2>/dev/null

# Stage both new copies and the prior copies first. Nothing live is touched until every staged copy has been verified.
changed=()
for pair in "$V_NAME:$PIN_VERIFIER:$vs" "$W_NAME:$PIN_WRAPPER:$ws"; do   # verifier first, wrapper last
  IFS=: read -r n pin st <<< "$pair"
  [ "$st" = current ] && continue
  tmp=$OPS/.$n.new-$STAMP
  cp "$KITS/$n" "$tmp" && chmod 0700 "$tmp" && [ "$(sha "$tmp")" = "$pin" ] || { rm -f -- "$OPS"/."$W_NAME".new-"$STAMP" "$OPS"/."$V_NAME".new-"$STAMP"; fail_pre "could not stage a verified copy of $n"; }
  if [ "$st" = different ]; then
    cp -p "$OPS/$n" "$OPS/$n.pre-352-$STAMP" && [ "$(sha "$OPS/$n.pre-352-$STAMP")" = "$(sha "$OPS/$n")" ] || { rm -f -- "$OPS"/."$W_NAME".new-"$STAMP" "$OPS"/."$V_NAME".new-"$STAMP"; fail_pre "could not keep a prior copy of $n"; }
  fi
  changed+=("$n:$pin:$st")
done

rollback() {
  local bad=0 n pin st
  for item in "${changed[@]}"; do
    IFS=: read -r n pin st <<< "$item"
    if [ "$st" = different ]; then
      cp -p "$OPS/$n.pre-352-$STAMP" "$OPS/.$n.restore-$STAMP" && mv -f "$OPS/.$n.restore-$STAMP" "$OPS/$n" || bad=1
      [ "$(sha "$OPS/$n.pre-352-$STAMP")" = "$(sha "$OPS/$n")" ] || bad=1
    else
      rm -f -- "$OPS/$n"
    fi
  done
  rm -f -- "$OPS"/."$W_NAME".new-"$STAMP" "$OPS"/."$V_NAME".new-"$STAMP" "$OPS"/."$W_NAME".restore-"$STAMP" "$OPS"/."$V_NAME".restore-"$STAMP"
  return $bad
}
abort() {
  echo "HELPER INSTALL FAILED: $*"
  if rollback; then echo "HELPER INSTALL RESTORED the previous helpers (verified)"; exit 4; fi
  echo "HELPER INSTALL RESTORE NOT VERIFIED: copy the *.pre-352-$STAMP files in $OPS back over their names by hand"; exit 5
}
for item in "${changed[@]}"; do
  IFS=: read -r n pin st <<< "$item"
  mv -f "$OPS/.$n.new-$STAMP" "$OPS/$n" || abort "rename of $n failed"
  echo "installed $n (${pin:0:8})"
done
[ "$(state_of "$W_NAME" "$PIN_WRAPPER")" = current ] && [ "$(state_of "$V_NAME" "$PIN_VERIFIER")" = current ] || abort 'final digests do not equal the pins'
core_ok || abort 'core pull changed unexpectedly'
ct1=$("$CRONTAB_BIN" -l 2>/dev/null | sha256sum | cut -d' ' -f1)
[ "$ct0" = "$ct1" ] || abort 'crontab changed during the install'
log1=0; [ -f "$STATE/offhost-pull.log" ] && log1=$(wc -c < "$STATE/offhost-pull.log")
[ "$log1" -ge "$log0" ] || abort 'offhost-pull.log shrank'
echo "PASS final digests: wrapper ${PIN_WRAPPER:0:8} verifier ${PIN_VERIFIER:0:8} core ${PIN_CORE:0:8}; crontab and log untouched"
echo "HELPER INSTALL PASS (cron not modified; prior copies *.pre-352-$STAMP kept)"
exit 0
