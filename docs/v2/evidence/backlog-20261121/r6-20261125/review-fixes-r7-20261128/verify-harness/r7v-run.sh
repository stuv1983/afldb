#!/usr/bin/env bash
# r7v-run.sh (R6 r7, MED-2): END-TO-END REHEARSAL of the owner verifier from the WORKSTATION (Git Bash). REHEARSAL ONLY: streamanator
# containers, never production. The documented owner entry point verify/afldb-verify-call.sh runs with the workstation's real ssh
# client (Windows OpenSSH, as in the runbook), a FRESH test verify key, PINNED container host keys, and the rehearsal transport
# (ProxyCommand = ssh arm@streamanator `docker exec -i <container> nc 127.0.0.1 22`; the containers stay --network none).
# Usage: bash r7v-run.sh [--verify-rev <rev>] [--keep-image] [--log-dir <dir>] <RID>
#   --log-dir DIR     r8: write the logs to DIR (absolute, or relative to the worktree) instead of verify-harness/logs/ (r8 dev runs:
#                     R8/dev-logs/...).
#   --verify-rev REV  every worktree file sent must equal its blob at REV (git show REV:<path>), and no untracked file may sit in the
#                     verify/ or verify-harness/ directories (logs/ excepted); otherwise the run is refused. Recorded in every log.
# Scenarios (one summary line each, then "R7 VERIFY HARNESS RESULT PASS|FAIL"):
#   a  g0-success      wrapper g0: G0a (prod container) PASS, then G0b (off-host container) with the G0a RESULT's dump/sha256: PASS
#   c  a2-whole        wrapper a2 (seven arguments): the verifier's own STOP, FAIL lines listed, backup-origin reported separately
#   d  hostile-arm     arm's login files, shims, node, checkout and .env made hostile: owner-path verdicts and exits byte-for-byte equal
#                      to a and c (nonce/at removed); CONTRAST: the old path (ssh arm@ ... bash -s < old gate) prints a forged PASS
#   e  stale-replay    a replayed answer, a stale at=, a wrong bundle digest, an exit-status lie and a second RESULT line are refused;
#                      a fresh answer through the same fake transport is accepted (control)
#   f  keys            another key and arm's key cannot reach afldb-verify; the verify key cannot reach arm; the verify key gets no
#                      shell, no PTY, no forwarding, and an extra command word is a usage refusal
#   b  g0-refusal      root damages the published dump: G0 STOP at G0a ("scheduled origin unproven"), G0b never called
#   g  forged-comment  review round 1, F2: the reviewer's attack (a forged verdict and terminal escapes in the database comment arm's
#                      role writes) through the owner path: no control byte reaches the output, the forged text appears only on
#                      '[relayed, neutralised]' lines, and the genuine A-2 verdict and exit equal scenario c's (run right after c)
#   r8 additions (R8 DEPENDENCIES.md):
#   a, c also require the SCOPE line the wrapper prints before the verdict, and the ARM-PRODUCED labels on the arm-produced PASS lines
#   h  installer-guard  [FIXTURE] arm gets sudo inside the prod container only; the workstation logs in AS ARM by ssh and runs
#                      sudo install-verify.sh (plain, and with SUDO_* removed): REFUSED "root session descends from arm", and the
#                      verifier's state digest is unchanged
#   i  staging-libsh   [FIXTURE-ATTACK] a hostile bundle/lib.sh in an arm-owned, a group-writable and a tampered staging copy: r8's
#                      install-verify.sh refuses each before sourcing it (no marker); CONTRAST: r7's (the blob at the pinned r7 revision 7e2ef51a) ran it as root
#   j  version-exit    wrapper 'version': both hosts PASS -> exit 0 (control); the off-host answer replaced by an authenticated-
#                      looking VERSION STOP (HARNESS fake transport) -> exit 1; CONTRAST: r7's wrapper (blob at the pinned r7 revision 7e2ef51a) exited 0
#   r9 additions (Astra blocker 1, off-host qualification; R9 offhost/):
#   The off-host container is now --hostname r7v-offhost (r7v-host.sh), and the wrapper qualifies NO off-host endpoint by default.
#   a, d, e (fresh control) and j (control and fake STOP) pass a FIXTURE qualification of that container (--qualification-fixture,
#   simulated independence), and a also requires qualification=FIXTURE, the FIXTURE SCOPE wording and the five evidence fields.
#   k  offhost-qualification  unqualified g0: the off-host container answers an authenticated G0B PASS, printed only behind
#                      "[unqualified endpoint, information only]", and the verdict is G0 STOP qualification=none; a fixture naming
#                      streamanator is refused before any call; production transport refuses --qualification-fixture (exit 2, no
#                      ssh); a fixture whose host key is not in the rehearsal known_hosts STOPs before the G0b call
#   l  possession-only  (FIXTURE-ATTACK, off-host container, qualified by fixture) l1: root removes the pull log's END lines: the core
#                      answers STOP and the wrapper says "possession only ... complete-at missing"; restored. l2 (LAST, after b):
#                      the journal holding the 03:10 dispatch is vacuumed: "possession only ... dispatch-at missing"
#   j  also runs version unqualified: production PASS line, off-host "no qualified off-host endpoint" STOP, exit 1
# Logs: verify-harness/logs/<RID>-*.log (workstation), or --log-dir. Containers, image, workspace and test keys are removed at the end.
# Development only (never in a recorded run): R7V_IMAGE=<kept image> reuses an image; --keep-image keeps it; R7V_KEEP_CTRS=1 keeps
# the containers and workspace for inspection (the summary prints the `down` command).
set -uo pipefail; export LC_ALL=C
VREV=; KEEPIMG=; LOGDIR=
while :; do case ${1:-} in --verify-rev) VREV=${2:?rev}; shift 2;; --keep-image) KEEPIMG=--keep-image; shift;; --log-dir) LOGDIR=${2:?dir}; shift 2;; *) break;; esac; done
RID=${1:?rid}; [[ $RID =~ ^[A-Za-z0-9-]{1,24}$ ]] || { echo "STOP bad RID"; exit 2; }
WT=/d/dev/afldb-closeout-20261127
R7=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r7-20261128
HV=$WT/$R7/verify-harness; LOGS=$HV/logs
case $LOGDIR in "") ;; /*) LOGS=$LOGDIR;; *) LOGS=$WT/$LOGDIR;; esac; mkdir -p "$LOGS"
DEVSSH=(ssh -o BatchMode=yes -i "$HOME/.ssh/afldb_dev" arm@10.0.40.100)
WSSH=C:/Windows/System32/OpenSSH/ssh.exe; WKEYGEN=C:/Windows/System32/OpenSSH/ssh-keygen.exe
CALL=$WT/$R7/verify/afldb-verify-call.sh
OLDG0=docs/v2/evidence/release-17822b29-20261124/scripts/r1-g0-dump.sh; OLDA2=docs/v2/evidence/backlog-20261121/r6-20261125/r6-pre-verify.sh
SUM=$LOGS/$RID-summary.log; : > "$SUM"
say() { printf '%s\n' "$*" | tee -a "$SUM"; }
BAD=0; res() { local s=$1; shift; say "SCENARIO $s $*"; case $* in PASS*) ;; *) BAD=$((BAD + 1));; esac; }

# ---- what is sent, and the optional pre-send verification
SENT=($(cd "$WT" && find "$R7/verify" "$R7/verify-harness" -type f ! -path "$R7/verify-harness/logs/*" | sort)
      $(cd "$WT" && find "$R7/backup" -type f | sort) deploy/afldb-backup.service deploy/afldb-backup.timer
      deploy/afldb-backup-failed.service tools/maintenance/backup.sh
      deploy/release.mjs deploy/afldb-settle-failure-status.sh deploy/host-policy/needrestart-afldb-hold.conf
      deploy/host-policy/apt-52-afldb-unattended.conf tools/maintenance/scheduled-backup.sh
      docs/v2/evidence/backlog-20261121/kits/afldb-offhost-pull-daily.sh tools/maintenance/offhost-pull.sh
      docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r9-20261128/accept/afldb-gate-accept.sh "$OLDG0" "$OLDA2")
HDR=$LOGS/$RID-inputs.log
{ echo "== r7v-run $RID $(date -u +%FT%TZ) workstation $(hostname) user $(id -un); worktree HEAD $(git -C "$WT" rev-parse HEAD)"
  echo "[HARNESS] inputs sent (sha256, worktree):"; for f in "${SENT[@]}"; do echo "   $(sha256sum < "$WT/$f" | cut -c1-64)  $f"; done
  if [ -n "$VREV" ]; then
    REV=$(git -C "$WT" rev-parse --verify "$VREV^{commit}") || { echo "STOP unknown revision $VREV"; exit 2; }
    bad=0; echo "[TRANSPORT] pre-send verification against $REV:"
    for f in "${SENT[@]}"; do w=$(sha256sum < "$WT/$f" | cut -c1-64); g=$(git -C "$WT" show "$REV:$f" 2>/dev/null | sha256sum | cut -c1-64)
      [ "$w" = "$g" ] || { echo "   DIFFERS worktree $w blob $g  $f"; bad=1; }; done
    u=$(git -C "$WT" ls-files --others -- "$R7/verify" "$R7/verify-harness" | grep -v "/logs/" | wc -l); echo "   untracked files in the sent directories: $u"; [ "$u" = 0 ] || bad=1
    echo "   result: $([ $bad = 0 ] && echo "every sent file equals its blob at $REV" || echo MISMATCH)"
  else echo "[TRANSPORT] no --verify-rev: the worktree as it stands (uncommitted files included)"; fi
} > "$HDR"
cat "$HDR" | tail -4
grep -q 'MISMATCH' "$HDR" && { echo "STOP the worktree does not equal $VREV"; exit 2; }
grep -q '^STOP' "$HDR" && exit 2
bash "$WT/$R7/verify/build-sums.sh" --check | tee -a "$HDR" || { echo "STOP verify/ digests inconsistent (run build-sums.sh)"; exit 2; }

# ---- fresh test keys (Windows ssh-keygen: owner-only ACLs, as the Windows ssh client requires)
KD=$(mktemp -d); KDM=$(cygpath -m "$KD"); trap 'rm -rf "$KD"' EXIT
for k in verify other arm; do "$WKEYGEN" -q -t ed25519 -N '' -C "r7v-$RID-$k" -f "$KDM/$k" > /dev/null || { echo "STOP ssh-keygen"; exit 2; }; done
mkdir -p "$KD/stage/r7v-keys"; tr -d '\r' < "$KD/verify.pub" > "$KD/stage/r7v-keys/afldb_verify.pub"; tr -d '\r' < "$KD/arm.pub" > "$KD/stage/r7v-keys/arm_key.pub"
# r8 CONTRAST inputs (HARNESS): the r7 install-verify.sh and wrapper as committed at the r7 revision R7CONTRAST (scenarios i and j).
# Pinned, not HEAD: once r8 is committed HEAD holds the r8 blobs and the contrast would compare r8 with itself.
R7CONTRAST=7e2ef51aa1682f6fded60158242b58ac07e2047b
mkdir -p "$KD/stage/r8-contrast"; git -C "$WT" show "$R7CONTRAST:$R7/verify/install-verify.sh" > "$KD/stage/r8-contrast/install-verify-r7.sh" \
  && git -C "$WT" show "$R7CONTRAST:$R7/verify/afldb-verify-call.sh" > "$KD/call-r7.sh" || { echo "STOP cannot read the r7 contrast blobs at $R7CONTRAST"; exit 2; }
echo "[HARNESS] r8 contrast blobs (r7 revision ${R7CONTRAST:0:8}): install-verify-r7.sh $(sha256sum < "$KD/stage/r8-contrast/install-verify-r7.sh" | cut -c1-16)... call-r7.sh $(sha256sum < "$KD/call-r7.sh" | cut -c1-16)..." >> "$HDR"
echo "[HARNESS] fresh keys: verify $(cut -d' ' -f2 "$KD/verify.pub" | cut -c1-24)... other $(cut -d' ' -f2 "$KD/other.pub" | cut -c1-24)... arm $(cut -d' ' -f2 "$KD/arm.pub" | cut -c1-24)..." >> "$HDR"

# ---- streamanator workspace, containers
WS=$("${DEVSSH[@]}" 'mktemp -d -p "$HOME" r7v-ws.XXXXXX') || exit 1
echo "workspace $WS" | tee -a "$HDR"
tar -C "$WT" -cf - "${SENT[@]}" -C "$KD/stage" r7v-keys r8-contrast | "${DEVSSH[@]}" "mkdir -m 700 '$WS/fix' && tar -C '$WS/fix' -xf - && find '$WS/fix' -type f | wc -l" >> "$HDR"
HOSTSH="bash '$WS/fix/$R7/verify-harness/r7v-host.sh' '$WS' '$RID'"
cleanup() { # R7V_KEEP_CTRS=1 (development only): leave the containers and workspace for inspection; remove later with `... down`
  if [ "${R7V_KEEP_CTRS:-}" = 1 ]; then say "KEPT (development): containers and workspace $WS; remove with: $HOSTSH down"
  else "${DEVSSH[@]}" "${R7V_IMAGE:+R7V_IMAGE=$R7V_IMAGE }$HOSTSH down $KEEPIMG" 2>&1 | tee -a "$SUM"; fi; rm -rf "$KD"; }
trap cleanup EXIT
SETUP=$LOGS/$RID-setup.log
"${DEVSSH[@]}" "${R7V_IMAGE:+R7V_IMAGE=$R7V_IMAGE }$HOSTSH up" > "$SETUP" 2>&1
grep -q '^R7V READY' "$SETUP" || { tail -30 "$SETUP"; say "STOP setup failed (see $SETUP)"; say "R7 VERIFY HARNESS RESULT FAIL"; exit 1; }
CA=$(sed -n 's/^R7V CTR prod //p' "$SETUP"); CB=$(sed -n 's/^R7V CTR offhost //p' "$SETUP"); DAY=$(sed -n 's/^R7V DAY //p' "$SETUP")
A2ARGS=$(sed -n 's/^.*\[HARNESS\] A2ARGS //p' "$SETUP")
{ echo "r7v-prod $(sed -n 's/^R7V HOSTKEY prod //p' "$SETUP")"; echo "r7v-offhost $(sed -n 's/^R7V HOSTKEY offhost //p' "$SETUP")"; } > "$KD/known_hosts"
PX="C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes -i $(cygpath -m "$HOME/.ssh/afldb_dev") arm@10.0.40.100 docker exec -i"
cat > "$KD/cfg" <<EOF
# REHEARSAL transport (r7v-run.sh): the containers have no network; ProxyCommand reaches each one's sshd through docker exec.
Host r7v-prod r7v-prod-arm
  HostName r7v-prod
  HostKeyAlias r7v-prod
  ProxyCommand $PX $CA nc 127.0.0.1 22
Host r7v-offhost
  HostName r7v-offhost
  HostKeyAlias r7v-offhost
  ProxyCommand $PX $CB nc 127.0.0.1 22
Host r7v-prod r7v-offhost
  User afldb-verify
Host r7v-prod-arm
  User arm
Host *
  UserKnownHostsFile $KDM/known_hosts
  GlobalKnownHostsFile $KDM/known_hosts
EOF
CFG=$KDM/cfg; KV=$KDM/verify; KO=$KDM/other; KA=$KDM/arm
# ---- r9: FIXTURE qualifications of the off-host container (simulated independence; the wrapper takes them with --rehearsal only)
OFFOFF=$(sed -n 's/^R7V OFFHOST-UTC-OFFSET //p' "$SETUP")
OFP=$("$WKEYGEN" -lf "$KDM/known_hosts" | tr -d '\r' | awk '$3 == "r7v-offhost" {print $2}')
mkdir -p "$KD/qual/records"
printf '%s\n' "FIXTURE qualification record (r7v-run.sh $RID, $(date -u +%FT%TZ)): r7v-offhost is a disposable container on streamanator," \
  "inside streamanator arm's control. Its independence is SIMULATED for the rehearsal; this record establishes nothing about any machine." > "$KD/qual/records/r7v-fixture.txt"
RSF=$(sha256sum < "$KD/qual/records/r7v-fixture.txt" | cut -c1-64)
mkq() { printf '%s\n' "# FIXTURE qualification (r7v-run.sh $RID): rehearsal transport only" "format=afldb-offhost-qualification-fixture-v1" \
  "host=$2" "address=r7v-offhost" "hostkey=$3" "record-file=records/r7v-fixture.txt" "record-sha256=$RSF" "qualified-on=$DAY" \
  "rehearsal-utc-offset=$OFFOFF" > "$KD/qual/$1"; }
mkq Q-ok r7v-offhost "$OFP"; mkq Q-streamanator streamanator "$OFP"; mkq Q-wrongkey r7v-offhost "SHA256:$(printf 'A%.0s' {1..43})"
QF=(--qualification-fixture "$KDM/qual/Q-ok")
{ echo "[HARNESS] r9 FIXTURE qualification Q-ok (sha256 $(sha256sum < "$KD/qual/Q-ok" | cut -c1-64)), record sha256 $RSF:"; sed 's/^/   /' "$KD/qual/Q-ok"
  echo "[HARNESS] r9 also: Q-streamanator (host=streamanator), Q-wrongkey (a host key not in the rehearsal known_hosts)"; } >> "$HDR"
[[ $OFP =~ ^SHA256:[A-Za-z0-9+/]{43}$ && $OFFOFF =~ ^-?[0-9]+$ ]] || { say "STOP cannot build the fixture qualification (fingerprint '$OFP', offset '$OFFOFF')"; say "R7 VERIFY HARNESS RESULT FAIL"; exit 1; }
say "== r7v $RID day $DAY containers $CA $CB; transport ProxyCommand docker exec; client $WSSH ($("$WSSH" -V 2>&1 | tr -d '\r'))"
norm() { sed -E 's/ (nonce|at|g0a-nonce|g0a-at|g0b-nonce|g0b-at)=[^ ]+//g'; }
wcall() { # log args... : runs the documented wrapper (rehearsal transport) and logs it; sets WRC and WOUT
  local log=$1; shift
  WOUT=$(bash "$CALL" --rehearsal "$CFG" --key "$KV" "$@" 2>&1); WRC=$?
  { echo "\$ bash afldb-verify-call.sh --rehearsal <cfg> --key <fresh verify key> $*"; printf '%s\n' "$WOUT"; echo "[HARNESS] wrapper exit $WRC"; } >> "$log"
}
vline() { grep '^OWNER VERDICT' <<< "$1" | tail -1; }
hdr() { { cat "$HDR"; echo; echo "== scenario $1 ($(date -u +%FT%TZ))"; } > "$2"; }

# ---- a: G0 success
LA=$LOGS/$RID-a-g0-success.log; hdr a "$LA"
wcall "$LA" "${QF[@]}" g0 "$DAY"; A_OUT=$WOUT; A_RC=$WRC; A_V=$(vline "$WOUT")
A_LAB=$(grep -c '\[ARM-PRODUCED' <<< "$WOUT")
{ echo "[HARNESS] r8: SCOPE line: $(grep '^G0 SCOPE: ' <<< "$WOUT" | cut -c1-120)..."; echo "[HARNESS] r8: lines labelled ARM-PRODUCED ($A_LAB):"; grep '\[ARM-PRODUCED' <<< "$WOUT" | cut -c1-200 | sed 's/^/   /'
  echo "[HARNESS] r9: the G0B RESULT line's scheduled-transfer evidence: $(grep '^AFLDB-VERIFY RESULT G0B' <<< "$WOUT" | grep -o ' dispatch-at=.*')"; } >> "$LA"
A_EV=0; [[ $A_V == *" dispatch-at=20"*"Z received-at=20"*"Z complete-at=20"*"Z received-sha256="[0-9a-f]*" rehash-sha256="[0-9a-f]*" qualification=FIXTURE qual-sha256="* ]] && A_EV=1
if [ "$A_RC" = 0 ] && [[ $A_V == "OWNER VERDICT G0 PASS transport=rehearsal"* ]] && grep -q '^-- G0b: qualified' <<< "$WOUT" && grep -q '^AFLDB-VERIFY RESULT G0B PASS' <<< "$WOUT" \
   && grep -q '^G0 SCOPE: .*qualification=FIXTURE: the endpoint.s independence is SIMULATED' <<< "$WOUT" && [ "$A_EV" = 1 ] \
   && grep -q '^PASS scheduled pull .*\[ARM-PRODUCED' <<< "$WOUT" && grep -q '^INVOCATION linked .*\[ARM-PRODUCED' <<< "$WOUT"; then
  res a "PASS g0-success (FIXTURE qualification): exit 0, G0 SCOPE line (FIXTURE), five evidence fields, $A_LAB ARM-PRODUCED label(s); $(grep -o 'dispatch-at=[^ ]* received-at=[^ ]* complete-at=[^ ]*' <<< "$A_V") qualification=FIXTURE"
else res a "FAIL g0-success: exit $A_RC; $(cut -c1-300 <<< "$A_V")"; fi

# ---- c: whole A-2 through the owner path
LC=$LOGS/$RID-c-a2-whole.log; hdr c "$LC"
wcall "$LC" a2 $A2ARGS; C_OUT=$WOUT; C_RC=$WRC; C_V=$(vline "$WOUT")
NF=$(grep -c '^FAIL ' <<< "$WOUT"); NP=$(grep -c '^PASS ' <<< "$WOUT")
{ echo "[HARNESS] the STOP is the verifier's own: its RESULT line (pinned bundle, this call's nonce) is:"; grep '^AFLDB-VERIFY RESULT' <<< "$WOUT" | sed 's/^/   /'
  echo "[HARNESS] FAIL lines ($NF):"; grep '^FAIL ' <<< "$WOUT" | sed 's/^/   /'
  echo "[HARNESS] PASS lines ($NP):"; grep '^PASS ' <<< "$WOUT" | sed 's/^/   /'; } >> "$LC"
C_LAB=$(grep -c '^PASS .*\[ARM-PRODUCED' <<< "$WOUT")
{ echo "[HARNESS] r8: A-2 attribution and whole-A-2 exit, separately: backup-origin=$(sed -n 's/.* backup-origin=\([a-z]*\).*/\1/p' <<< "$C_V"); whole A-2: $(sed -n 's/^OWNER VERDICT A2 \([A-Z]*\).*/\1/p' <<< "$C_V"), wrapper exit $C_RC"
  echo "[HARNESS] r8: SCOPE line:"; grep '^A2 SCOPE: ' <<< "$WOUT" | sed 's/^/   /'
  echo "[HARNESS] r8: PASS lines labelled ARM-PRODUCED ($C_LAB):"; grep '^PASS .*\[ARM-PRODUCED' <<< "$WOUT" | sed 's/^/   /'; } >> "$LC"
if [ "$C_RC" = 1 ] && [[ $C_V == "OWNER VERDICT A2 STOP transport=rehearsal"* ]] && grep -q 'backup-origin=attributed' <<< "$C_V" \
   && grep -q '^AFLDB-VERIFY RESULT A2 STOP ' <<< "$WOUT" && grep -q '^R6 PRE RESULT STOP' <<< "$WOUT" \
   && grep -q '^A2 SCOPE: a PASS establishes that the live production host matched these seven arguments' <<< "$WOUT" && [ "$C_LAB" -ge 8 ]; then
  res c "PASS a2-whole: the verifier's own STOP (exit 1, $NF FAIL / $NP PASS lines), backup-origin=attributed reported separately; A2 SCOPE line; $C_LAB ARM-PRODUCED PASS lines; FAILs: $(grep '^FAIL ' <<< "$WOUT" | cut -c6-60 | tr '\n' '|' | cut -c1-600)"
else res c "FAIL a2-whole: exit $C_RC; $(cut -c1-300 <<< "$C_V")"; fi

# ---- g (review round 1, F2): the reviewer's forged database comment, replayed through the owner path
LG=$LOGS/$RID-g-forged-comment.log; hdr g "$LG"
"${DEVSSH[@]}" "$HOSTSH forge" >> "$LG" 2>&1
wcall "$LG" a2 $A2ARGS; G_OUT=$WOUT; G_RC=$WRC; G_V=$(vline "$WOUT")
"${DEVSSH[@]}" "$HOSTSH unforge" >> "$LG" 2>&1
G_ESC=$(printf '%s' "$G_OUT" | tr -dc '\033' | wc -c); G_CTL=$(printf '%s' "$G_OUT" | tr -d '\n' | tr -dc '\000-\037\177-\377' | wc -c)
G_NV=$(grep -c '^OWNER VERDICT' <<< "$G_OUT"); G_NR=$(grep -c '^AFLDB-VERIFY RESULT' <<< "$G_OUT")
G_FORGED=$(grep -c 'OWNER VERDICT A2 PASS transport=production' <<< "$G_OUT"); G_NEUT=$(grep -c '^\[relayed, neutralised\] .*OWNER VERDICT A2 PASS transport=production' <<< "$G_OUT")
{ echo "[HARNESS] wrapper output after the attack: ESC bytes $G_ESC, other control or non-ASCII bytes $G_CTL; lines beginning 'OWNER VERDICT' $G_NV, beginning 'AFLDB-VERIFY RESULT' $G_NR"
  echo "[HARNESS] lines carrying the forged verdict text ($G_FORGED; neutralised $G_NEUT):"; grep -n 'OWNER VERDICT A2 PASS transport=production\|R6 PRE RESULT PASS\|afldb.restore_test.v1' <<< "$G_OUT" | sed 's/^/   /'
  echo "[HARNESS] verdict comparison with scenario c (nonce= and at= removed):"; echo "   c: $(norm <<< "$C_V") exit $C_RC"; echo "   g: $(norm <<< "$G_V") exit $G_RC"; } >> "$LG"
if [ "$G_RC" = "$C_RC" ] && [ "$(norm <<< "$G_V")" = "$(norm <<< "$C_V")" ] && [ "$G_ESC" = 0 ] && [ "$G_CTL" = 0 ] && [ "$G_NV" = 1 ] && [ "$G_NR" = 1 ] \
   && [ "$G_FORGED" -ge 1 ] && [ "$G_FORGED" = "$G_NEUT" ] && ! grep -q '^R6 PRE RESULT PASS' <<< "$G_OUT"; then
  res g "PASS forged-comment: the forged text reached the wrapper only as data ($G_NEUT line(s) '[relayed, neutralised] ...', 0 ESC, 0 control bytes); genuine verdict and exit unchanged ($(norm <<< "$G_V" | cut -c1-60)... exit $G_RC)"
else res g "FAIL forged-comment: exit $G_RC (c: $C_RC) esc=$G_ESC ctl=$G_CTL verdict-lines=$G_NV result-lines=$G_NR forged=$G_FORGED neutralised=$G_NEUT; $(cut -c1-200 <<< "$G_V")"; fi

# ---- h (r8): the installer run as root THROUGH ARM'S SUDO, from a real ssh login as arm, is refused and changes nothing
LH=$LOGS/$RID-h-installer-guard.log; hdr h "$LH"
"${DEVSSH[@]}" "$HOSTSH r8-sudo-on" >> "$LH" 2>&1
HOK=1; HL=
for hc in plain stripped; do
  case $hc in
    plain) rcmd='id; sudo -n bash /root/r7v-staging/install-verify.sh --role prod --key /root/r7v-staging/afldb_verify.pub; exit $?'; want='test SUDO_USER: SUDO_USER=arm';;
    stripped) rcmd='id; sudo -n env -u SUDO_USER -u SUDO_UID -u SUDO_GID -u SUDO_COMMAND bash /root/r7v-staging/install-verify.sh --role prod --key /root/r7v-staging/afldb_verify.pub; exit $?'; want='test ancestor: pid [0-9]* (bash)';;
  esac
  sleep 3
  out=$(MSYS_NO_PATHCONV=1 "$WSSH" -F "$CFG" -o BatchMode=yes -o IdentitiesOnly=yes -i "$KA" -T r7v-prod-arm "$rcmd" < /dev/null 2>&1 | tr -d '\r'); rc=$?
  { echo "-- [FIXTURE-ATTACK] ssh as arm (real login, arm's key) -> $rcmd: exit $rc"; printf '%s\n' "$out" | sed 's/^/   /'; } >> "$LH"
  if [ "$rc" = 1 ] && grep -q "^REFUSED: root session descends from arm: .*$want" <<< "$out" && grep -qx 'INSTALL-VERIFY RESULT FAIL (nothing was changed)' <<< "$out" \
     && ! grep -q '^PASS staging bundle' <<< "$out" && grep -q '^uid=1000(arm)' <<< "$out"; then HL+="$hc:refused "; else HL+="$hc:UNEXPECTED($rc) "; HOK=0; fi
done
HS=$("${DEVSSH[@]}" "$HOSTSH r8-sudo-off" 2>&1); printf '%s\n' "$HS" >> "$LH"
grep -q '^R8 STATE UNCHANGED' <<< "$HS" || HOK=0
{ echo "[HARNESS] REFUSED lines:"; grep -h '^   REFUSED' "$LH" | sed 's/^   /   /'; } >> "$LH"
[ "$HOK" = 1 ] && res h "PASS installer-guard: install-verify.sh through arm's sudo over a real arm ssh login REFUSED ($HL), verifier state digest unchanged" \
  || res h "FAIL installer-guard ($HL; $(grep '^R8 STATE' <<< "$HS"))"

# ---- i (r8): a hostile bundle/lib.sh in untrusted or tampered staging is never sourced (contrast: r7 sourced it as root)
LI=$LOGS/$RID-i-staging-libsh.log; hdr i "$LI"
IS=$("${DEVSSH[@]}" "$HOSTSH r8-libsh" 2>&1); printf '%s\n' "$IS" >> "$LI"
il() { grep "^R8 LIBSH $1 " <<< "$IS"; }
IOK=1
for c in home-arm group-writable tampered; do [[ $(il $c) == "R8 LIBSH $c exit=1 marker=absent "*"INSTALL-VERIFY STOP"* ]] || IOK=0; done
[[ $(il home-arm) == *"must not be under /home"* ]] && [[ $(il group-writable) == *"group- or other-writable"* ]] && [[ $(il tampered) == *"does not match its bundle/SHA256SUMS line"* ]] || IOK=0
[[ $(il contrast-r7-home-arm) == "R8 LIBSH contrast-r7-home-arm exit="*" marker=present "* ]] || IOK=0
grep -q '^R8 STATE UNCHANGED' <<< "$IS" || IOK=0
{ echo "[HARNESS] summary:"; grep '^R8 ' <<< "$IS" | sed 's/^/   /'; } >> "$LI"
[ "$IOK" = 1 ] && res i "PASS staging-libsh: refused before sourcing (home-arm, group-writable, tampered: marker absent); CONTRAST r7 ran the hostile lib.sh as root (marker present); state unchanged" \
  || res i "FAIL staging-libsh: $(grep '^R8 ' <<< "$IS" | cut -c1-120 | tr '\n' '|')"

# ---- d: hostile arm login environment
LD=$LOGS/$RID-d-hostile-arm.log; hdr d "$LD"
"${DEVSSH[@]}" "$HOSTSH hostile" >> "$LD" 2>&1
wcall "$LD" "${QF[@]}" g0 "$DAY"; D1_RC=$WRC; D1_V=$(vline "$WOUT"); D1_OUT=$WOUT
wcall "$LD" a2 $A2ARGS; D2_RC=$WRC; D2_V=$(vline "$WOUT"); D2_OUT=$WOUT
pf() { grep -E '^(PASS|FAIL) ' <<< "$1" | grep -v ' next=' ; }
{ echo "[HARNESS] verdict comparison (nonce= and at= fields removed):"
  echo "   before g0: $(norm <<< "$A_V") exit $A_RC"; echo "   after  g0: $(norm <<< "$D1_V") exit $D1_RC"
  echo "   before a2: $(norm <<< "$C_V") exit $C_RC"; echo "   after  a2: $(norm <<< "$D2_V") exit $D2_RC"
  echo "[HARNESS] PASS/FAIL line diff, g0 (information):"; diff <(pf "$A_OUT") <(pf "$D1_OUT") | sed 's/^/   /'
  echo "[HARNESS] PASS/FAIL line diff, a2 (information; timer next= lines omitted):"; diff <(pf "$C_OUT") <(pf "$D2_OUT") | sed 's/^/   /'; } >> "$LD"
SAME=0; [ "$(norm <<< "$A_V")|$A_RC" = "$(norm <<< "$D1_V")|$D1_RC" ] && [ "$(norm <<< "$C_V")|$C_RC" = "$(norm <<< "$D2_V")|$D2_RC" ] && SAME=1
FORGE=0
{ echo "== CONTRAST: the OLD path, as the runbook ran it: tr -d '\\r' < <old gate> | ssh arm@<host> bash -s -- <args>"; } >> "$LD"
O1=$(tr -d '\r' < "$WT/$OLDG0" | "$WSSH" -F "$CFG" -o IdentitiesOnly=yes -i "$KA" r7v-prod-arm bash -s -- "$DAY" 2>&1); O1RC=$?
O2=$(tr -d '\r' < "$WT/$OLDA2" | "$WSSH" -F "$CFG" -o IdentitiesOnly=yes -i "$KA" r7v-prod-arm bash -s -- $A2ARGS 2>&1); O2RC=$?
{ echo "-- old G0 (exit $O1RC):"; printf '%s\n' "$O1" | sed 's/^/   /'; echo "-- old A-2 (exit $O2RC):"; printf '%s\n' "$O2" | sed 's/^/   /'; } >> "$LD"
[ "$O1RC" = 0 ] && grep -q 'G0 PROD RESULT PASS' <<< "$O1" && grep -q '^OFFHOST-COMPARE' <<< "$O1" && [ "$O2RC" = 0 ] && grep -q 'R6 PRE RESULT PASS' <<< "$O2" && FORGE=1
if [ "$SAME" = 1 ] && [ "$FORGE" = 1 ]; then
  res d "PASS hostile-arm: owner-path verdicts and exits unchanged (g0: $(norm <<< "$D1_V" | cut -c1-60)... exit $D1_RC; a2 STOP exit $D2_RC); CONTRAST old path forged 'G0 PROD RESULT PASS' + OFFHOST-COMPARE (exit 0) and 'R6 PRE RESULT PASS' (exit 0)"
else res d "FAIL hostile-arm: same=$SAME forged-contrast=$FORGE (g0 after: $(cut -c1-200 <<< "$D1_V"))"; fi

# ---- e: stale, replayed, mismatched answers through a fake transport (HARNESS)
LE=$LOGS/$RID-e-stale-replay.log; hdr e "$LE"
N1=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
RAW=$("$WSSH" -F "$CFG" -o BatchMode=yes -o IdentitiesOnly=yes -i "$KV" -T r7v-prod "g0 $DAY $N1" 2>/dev/null | tr -d '\r'); RAWRC=$?
printf '%s\n' "$RAW" > "$KD/raw"; echo "$RAWRC" > "$KD/rawrc"
{ echo "[HARNESS] captured one genuine G0a answer (nonce $N1, exit $RAWRC) as the replay source:"; tail -1 "$KD/raw" | sed 's/^/   /'; } >> "$LE"
cat > "$KD/fakessh" <<EOF
#!/usr/bin/env bash
# HARNESS fake transport for the wrapper (AFLDB_VERIFY_SSH): g0b and version calls go to the real client; a g0 call is answered from
# the captured genuine answer, altered per R7V_FAKE.
cmd=\${!#}; case \$cmd in g0\ *) ;; *) exec "$WSSH" "\$@";; esac
n=\${cmd##* }; raw=\$(cat "$KD/raw"); rc=\$(cat "$KD/rawrc")
case \$R7V_FAKE in
  replay) ;;
  fresh) raw=\$(sed -E "s/nonce=[0-9a-f]{32}/nonce=\$n/; s/ at=[^ ]+/ at=\$(date -u +%Y-%m-%dT%H:%M:%SZ)/" <<< "\$raw");;
  stale) raw=\$(sed -E "s/nonce=[0-9a-f]{32}/nonce=\$n/; s/ at=[^ ]+/ at=\$(date -u -d '-1 hour' +%Y-%m-%dT%H:%M:%SZ)/" <<< "\$raw");;
  bundle) raw=\$(sed -E "s/nonce=[0-9a-f]{32}/nonce=\$n/; s/ at=[^ ]+/ at=\$(date -u +%Y-%m-%dT%H:%M:%SZ)/; s/bundle=[0-9a-f]{64}/bundle=\$(printf 'a%.0s' {1..64})/" <<< "\$raw");;
  exitlie) raw=\$(sed -E "s/nonce=[0-9a-f]{32}/nonce=\$n/; s/ at=[^ ]+/ at=\$(date -u +%Y-%m-%dT%H:%M:%SZ)/" <<< "\$raw"); rc=1;;
  tworesults) raw=\$(sed -E "s/nonce=[0-9a-f]{32}/nonce=\$n/; s/ at=[^ ]+/ at=\$(date -u +%Y-%m-%dT%H:%M:%SZ)/" <<< "\$raw"); raw="\$(tail -1 <<< "\$raw")"\$'\n'"\$raw";;
esac
printf '%s\n' "\$raw"; exit "\$rc"
EOF
chmod 755 "$KD/fakessh"
EOK=1; ELINE=
for m in fresh replay stale bundle exitlie tworesults; do
  out=$(R7V_FAKE=$m AFLDB_VERIFY_SSH="$KD/fakessh" bash "$CALL" --rehearsal "$CFG" --key "$KV" "${QF[@]}" g0 "$DAY" 2>&1); rc=$?
  v=$(vline "$out"); { echo "-- fake transport mode $m: wrapper exit $rc"; echo "   $v"; } >> "$LE"
  case $m in
    fresh) [ "$rc" = 0 ] && [[ $v == "OWNER VERDICT G0 PASS"* ]] || EOK=0;;
    replay) [ "$rc" = 1 ] && [[ $v == *"step=G0a"*"is not this call's"* ]] || EOK=0;;
    stale) [ "$rc" = 1 ] && [[ $v == *"step=G0a"*"stale:"* ]] || EOK=0;;
    bundle) [ "$rc" = 1 ] && [[ $v == *"step=G0a"*"is not the pinned"* ]] || EOK=0;;
    exitlie) [ "$rc" = 1 ] && [[ $v == *"step=G0a"*"ssh exit status 1"* ]] || EOK=0;;
    tworesults) [ "$rc" = 1 ] && [[ $v == *"step=G0a"*"2 RESULT lines"* ]] || EOK=0;;
  esac
  ELINE+="$m:$rc "
done
[ "$EOK" = 1 ] && res e "PASS stale-replay: fresh control accepted, replay/stale/wrong-bundle/exit-lie/two-RESULT refused ($ELINE)" || res e "FAIL stale-replay ($ELINE)"

# ---- f: keys and session restrictions
LF=$LOGS/$RID-f-keys.log; hdr f "$LF"
FOK=1; FL=
fk() { # label expect-rc grep-pattern ssh-args...
  local lab=$1 want=$2 pat=$3 out rc; shift 3
  out=$("$WSSH" -F "$CFG" -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=30 "$@" < /dev/null 2>&1 | tr -d '\r'); rc=$?
  { echo "-- $lab: ssh $* -> exit $rc"; printf '%s\n' "$out" | sed 's/^/   /'; } >> "$LF"
  if { [ "$rc" = "$want" ] || { [ "$want" = nz ] && [ "$rc" != 0 ]; }; } && grep -qE "$pat" <<< "$out" \
     && ! grep -q '^AFLDB-VERIFY RESULT' <<< "$out" && ! grep -q 'afldb-verify)' <<< "$out"; then FL+="$lab:ok "; else FL+="$lab:UNEXPECTED($rc) "; FOK=0; fi
}
N2=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
fk other-key-as-verify 255 'Permission denied' -i "$KO" -T r7v-prod "version $N2"
fk arm-key-as-verify 255 'Permission denied' -i "$KA" -T r7v-prod "version $N2"
fk verify-key-as-arm 255 'Permission denied' -i "$KV" -T r7v-prod-arm id
fk verify-key-forced-tty nz 'PTY allocation request failed' -i "$KV" -tt r7v-prod
fk verify-key-no-command 2 'AFLDB-VERIFY USAGE refused' -i "$KV" -T r7v-prod
fk verify-key-shell-command 2 'AFLDB-VERIFY USAGE refused' -i "$KV" -T r7v-prod 'bash -i'
fk verify-key-extra-words 2 'AFLDB-VERIFY USAGE refused' -i "$KV" -T r7v-prod "g0 $DAY $N2; id"
fk verify-key-stdio-forward 255 'open failed|administratively prohibited|forwarding' -i "$KV" -W 127.0.0.1:22 r7v-prod
fk arm-key-as-arm-control 0 'uid=1000\(arm\)' -i "$KA" -T r7v-prod-arm 'command -p id'
[ "$FOK" = 1 ] && res f "PASS keys: $FL" || res f "FAIL keys: $FL"

# ---- j (r8): the wrapper's version mode exits 1 when a host answers STOP (r7 exited 0). r9: the control and the fake STOP pass the
# FIXTURE qualification (without one the off-host line is "no qualified off-host endpoint"); the r7 CONTRAST blob has no such flag.
LJ=$LOGS/$RID-j-version-exit.log; hdr j "$LJ"
JOK=1
wcall "$LJ" "${QF[@]}" version; J1=$WRC; J1P=$(grep -c '^OWNER VERDICT VERSION PASS .* qualification=FIXTURE qual-sha256=' <<< "$WOUT")
[ "$J1" = 0 ] && [ "$J1P" = 2 ] || JOK=0
BSHA=$(sed -n 's/^BUNDLE_SHA=\([0-9a-f]\{64\}\).*/\1/p' "$CALL")
cat > "$KD/fakever" <<EOF
#!/usr/bin/env bash
# HARNESS fake transport (r8 scenario j): every call goes to the real client except the off-host 'version' call, which is answered
# with a well-formed VERSION STOP for this call's nonce, the pinned bundle and the current time (what a verifier whose self-check
# failed answers: exit 3, role=none).
cmd=\${!#}; tgt=\${@: -2:1}
case \$tgt:\$cmd in r7v-offhost:version\ *) n=\${cmd##* }; echo "STOP verifier self-check: (harness)"; echo "AFLDB-VERIFY RESULT VERSION STOP nonce=\$n host=r7v-offhost boot=none bundle=$BSHA at=\$(date -u +%Y-%m-%dT%H:%M:%SZ) exit=3 role=none"; exit 3;; esac
exec "$WSSH" "\$@"
EOF
chmod 755 "$KD/fakever"
sleep 4
out=$(AFLDB_VERIFY_SSH="$KD/fakever" bash "$CALL" --rehearsal "$CFG" --key "$KV" "${QF[@]}" version 2>&1); J2=$?
{ echo "-- r8 wrapper, off-host answer replaced by a VERSION STOP (HARNESS fake transport): exit $J2"; grep '^OWNER VERDICT' <<< "$out" | sed 's/^/   /'; } >> "$LJ"
[ "$J2" = 1 ] && grep -q '^OWNER VERDICT VERSION STOP transport=rehearsal host=r7v-offhost role=offhost reason=' <<< "$out" || JOK=0
sleep 4
out=$(AFLDB_VERIFY_SSH="$KD/fakever" bash "$KD/call-r7.sh" --rehearsal "$CFG" --key "$KV" version 2>&1); J3=$?
{ echo "-- CONTRAST: r7 wrapper (r7 revision blob), same fake transport: exit $J3"; grep '^OWNER VERDICT' <<< "$out" | sed 's/^/   /'; } >> "$LJ"
[ "$J3" = 0 ] && grep -q '^OWNER VERDICT VERSION STOP' <<< "$out" || JOK=0
sleep 4
wcall "$LJ" version; J4=$WRC
{ echo "-- r9: version without a qualification: exit $J4"; grep '^OWNER VERDICT' <<< "$WOUT" | sed 's/^/   /'; } >> "$LJ"
[ "$J4" = 1 ] && grep -q '^OWNER VERDICT VERSION PASS transport=rehearsal host=afldb-prod role=prod .*qualification=none qual-sha256=none$' <<< "$WOUT" \
  && grep -q '^OWNER VERDICT VERSION STOP transport=rehearsal host=none role=offhost reason="no qualified off-host endpoint" qualification=none qual-sha256=none$' <<< "$WOUT" || JOK=0
[ "$JOK" = 1 ] && res j "PASS version-exit: both PASS (FIXTURE) -> exit 0 ($J1P PASS lines); off-host STOP -> exit $J2; CONTRAST r7 wrapper exited $J3 with a STOP line; unqualified: production PASS line + off-host 'no qualified off-host endpoint' STOP -> exit $J4" \
  || res j "FAIL version-exit: control $J1 ($J1P PASS), off-host STOP $J2, r7 contrast $J3, unqualified $J4"

# ---- k (r9): off-host qualification is fail-closed
LK=$LOGS/$RID-k-offhost-qualification.log; hdr k "$LK"
KOK=1; KL=
sleep 4; wcall "$LK" g0 "$DAY"; K1=$WRC; K1V=$(vline "$WOUT")
if [ "$K1" = 1 ] && [[ $K1V == "OWNER VERDICT G0 STOP transport=rehearsal"*"step=G0b"*"offhost-info=PASS"*"no qualified off-host endpoint"*" qualification=none qual-sha256=none" ]] \
   && grep -q '^\[unqualified endpoint, information only\] AFLDB-VERIFY RESULT G0B PASS ' <<< "$WOUT" && ! grep -q '^AFLDB-VERIFY RESULT G0B' <<< "$WOUT" \
   && [ "$(grep -c '^OWNER VERDICT' <<< "$WOUT")" = 1 ]; then KL+="unqualified:STOP(info=PASS) "; else KL+="unqualified:UNEXPECTED($K1) "; KOK=0; fi
sleep 4; wcall "$LK" --qualification-fixture "$KDM/qual/Q-streamanator" g0 "$DAY"; K2=$WRC; K2V=$(vline "$WOUT")
if [ "$K2" = 1 ] && [[ $K2V == *"step=qualification"*"root-equivalent"*"qualification=refused qual-sha256="* ]] && ! grep -q '^-- G0a' <<< "$WOUT"; then KL+="fixture-naming-streamanator:refused "
else KL+="fixture-naming-streamanator:UNEXPECTED($K2) "; KOK=0; fi
out=$(bash "$CALL" --qualification-fixture "$KDM/qual/Q-ok" g0 "$DAY" 2>&1); K3=$?
{ echo "\$ bash afldb-verify-call.sh --qualification-fixture <Q-ok> g0 $DAY   (production transport)"; printf '%s\n' "$out"; echo "[HARNESS] wrapper exit $K3"; } >> "$LK"
if [ "$K3" = 2 ] && grep -q '^STOP --qualification-fixture is accepted with --rehearsal only' <<< "$out" && ! grep -q '^OWNER VERDICT' <<< "$out"; then KL+="production-transport-fixture-flag:refused "
else KL+="production-transport-fixture-flag:UNEXPECTED($K3) "; KOK=0; fi
sleep 4; wcall "$LK" --qualification-fixture "$KDM/qual/Q-wrongkey" g0 "$DAY"; K4=$WRC; K4V=$(vline "$WOUT")
if [ "$K4" = 1 ] && [[ $K4V == *"step=G0b"*"is not among the owner's known_hosts keys for r7v-offhost"*"qualification=FIXTURE"* ]] && ! grep -q '^-- G0b: qualified' <<< "$WOUT"; then KL+="unknown-host-key:STOP "
else KL+="unknown-host-key:UNEXPECTED($K4) "; KOK=0; fi
[ "$KOK" = 1 ] && res k "PASS offhost-qualification: $KL" || res k "FAIL offhost-qualification: $KL"

# ---- n (r10, Astra case 2): the qualification sequence from an UNCONFIGURED checkout. Candidate evidence before any pin (never a
# verdict), the owner's pin commit, then the reviewed export containing that pin. A scratch repository stands in for the owner's
# clone: C0 holds the wrapper and the gate checker exactly as this worktree has them and no pin; C1 adds the owner's pin. Each export
# is `git archive <rev>` into its own directory, as the procedure stages bytes.
LN=$LOGS/$RID-n-candidate-sequence.log; hdr n "$LN"
NOK=1; NL=
GACC=$WT/docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r9-20261128/accept/afldb-gate-accept.sh
sleep 4; wcall "$LN" candidate-g0 "$DAY" --host r7v-offhost --address r7v-offhost --hostkey "$OFP" --utc-offset "$OFFOFF"; N1=$WRC; printf '%s\n' "$WOUT" > "$KD/n-cand-g0.txt"
if [ "$N1" = 3 ] && grep -q '^CANDIDATE EVIDENCE G0 COMPLETE transport=rehearsal .* qualification=candidate qual-sha256=none candidate-hostkey=' <<< "$WOUT" \
   && ! grep -q '^OWNER VERDICT' <<< "$WOUT" && grep -q 'AFLDB-VERIFY RESULT G0B PASS ' <<< "$WOUT" && grep -q '^CANDIDATE MODE: ' <<< "$WOUT"; then NL+="candidate-g0:exit3,no-verdict "
else NL+="candidate-g0:UNEXPECTED($N1) "; NOK=0; fi
sleep 4; wcall "$LN" candidate-version --host r7v-offhost --address r7v-offhost --hostkey "$OFP" --utc-offset "$OFFOFF"; N2=$WRC; printf '%s\n' "$WOUT" > "$KD/n-cand-ver.txt"
if [ "$N2" = 3 ] && grep -q '^CANDIDATE EVIDENCE VERSION COMPLETE transport=rehearsal .*host=r7v-offhost role=offhost' <<< "$WOUT" && ! grep -q '^OWNER VERDICT' <<< "$WOUT"; then NL+="candidate-version:exit3,no-verdict "
else NL+="candidate-version:UNEXPECTED($N2) "; NOK=0; fi
out=$(bash "$GACC" --rehearsal --gate release-g0 --owner-checks "$KD/n-cand-g0.txt" --reverify "$KD/n-cand-g0.txt" --version "$KD/n-cand-ver.txt" --verdict "$KD/n-cand-g0.txt" --verdict-exit 3 --confirm "$KD/n-cand-ver.txt" 2>&1); N3=$?
{ echo "\$ bash afldb-gate-accept.sh --rehearsal --gate release-g0 ... --version <candidate-version> --verdict <candidate-g0> --verdict-exit 3"; printf '%s\n' "$out"; echo "[HARNESS] exit $N3"; } >> "$LN"
if [ "$N3" = 1 ] && grep -qE '^GATE ACCEPT REHEARSAL RELEASE-G0 NO-GO failed=.*verdict' <<< "$out" && grep -q '^ACCEPT verdict FAIL ' <<< "$out" && ! grep -qE '^GATE ACCEPT .* GO( |$)' <<< "$out"; then NL+="gate-on-candidate:NO-GO "
else NL+="gate-on-candidate:UNEXPECTED($N3) "; NOK=0; fi
# the owner's clone (scratch): C0 unconfigured, C1 with the pin and its record
SR=$KD/owner-clone; R9P=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r9-20261128
mkdir -p "$SR/$R7" "$SR/$R9P/accept" "$SR/$R9P/offhost/records"
cp -r "$WT/$R7/verify" "$SR/$R7/"; cp "$GACC" "$SR/$R9P/accept/"
sg() { git -C "$SR" -c user.name=r7v-owner-clone -c user.email=r7v-owner-clone@invalid -c commit.gpgsign=false -c core.autocrlf=false "$@" > /dev/null; }
sg init -q; sg add -A; sg commit -q -m 'C0: unconfigured (no qualification pin)'; NC0=$(git -C "$SR" rev-parse HEAD)
cp "$KD/qual/records/r7v-fixture.txt" "$SR/$R9P/offhost/records/"; cp "$KD/qual/Q-ok" "$SR/$R9P/offhost/QUALIFIED-ENDPOINT"
sg add -A; sg commit -q -m 'C1: owner pin (FIXTURE format: rehearsal)'; NC1=$(git -C "$SR" rev-parse HEAD); NPS=$(git -C "$SR" cat-file blob "$NC1:$R9P/offhost/QUALIFIED-ENDPOINT" | sha256sum | cut -c1-64)
for c in 0 1; do r=$NC0; [ $c = 1 ] && r=$NC1; mkdir -p "$KD/exp$c"; git -C "$SR" -c core.autocrlf=false -c core.eol=lf archive --format=tar "$r" | tar -x -C "$KD/exp$c"; done
echo "[HARNESS] owner clone (scratch): C0 $NC0 (no pin), C1 $NC1 (pin sha256 $NPS); exports exp0 and exp1 by git archive" >> "$LN"
ecall() { # export log args...: the wrapper of that export, rehearsal transport, no --qualification-fixture
  local e=$1 log=$2; shift 2
  WOUT=$(bash "$KD/$e/$R7/verify/afldb-verify-call.sh" --rehearsal "$CFG" --key "$KV" "$@" 2>&1); WRC=$?
  { echo "\$ bash <$e>/afldb-verify-call.sh --rehearsal <cfg> --key <fresh verify key> $*"; printf '%s\n' "$WOUT"; echo "[HARNESS] wrapper exit $WRC"; } >> "$log"; }
sleep 4; ecall exp0 "$LN" g0 "$DAY"; N4=$WRC; N4V=$(vline "$WOUT")
if [ "$N4" = 1 ] && [[ $N4V == "OWNER VERDICT G0 STOP transport=rehearsal"*"no qualified off-host endpoint"*" qualification=none qual-sha256=none" ]]; then NL+="old-export:STOP(qualification=none) "
else NL+="old-export:UNEXPECTED($N4) "; NOK=0; fi
sleep 4; ecall exp1 "$LN" version; N5=$WRC; printf '%s\n' "$WOUT" > "$KD/n-ver-exp1.txt"
sleep 4; ecall exp1 "$LN" g0 "$DAY"; N6=$WRC; N6V=$(vline "$WOUT"); printf '%s\n' "$WOUT" > "$KD/n-g0-exp1.txt"
if [ "$N5" = 0 ] && [ "$N6" = 0 ] && [[ $N6V == "OWNER VERDICT G0 PASS transport=rehearsal"*" qualification=FIXTURE qual-sha256=$NPS" ]]; then NL+="pinned-export:G0-PASS(qual-sha256=pin) "
else NL+="pinned-export:UNEXPECTED($N5/$N6) "; NOK=0; fi
gpin() { # rev transport-flag...: the gate checker IN THE OWNER CLONE on exp1's transcripts (4.4/4.5 absent here: only (g) is judged)
  local r=$1; shift
  out=$(bash "$SR/$R9P/accept/afldb-gate-accept.sh" "$@" --gate release-g0 --owner-checks "$KD/n-cand-g0.txt" --reverify "$KD/n-cand-g0.txt" \
    --version "$KD/n-ver-exp1.txt" --verdict "$KD/n-g0-exp1.txt" --verdict-exit 0 --confirm "$KD/n-ver-exp1.txt" --pin-rev "$r" 2>&1)
  { echo "\$ bash <owner clone>/afldb-gate-accept.sh $* --gate release-g0 ... --pin-rev $r"; printf '%s\n' "$out"; } >> "$LN"; GP=$(grep '^ACCEPT pin ' <<< "$out"); }
gpin "$NC1" --rehearsal; [[ $GP == "ACCEPT pin PASS the pin committed at $NC1 (format=afldb-offhost-qualification-fixture-v1) hashes to $NPS"* ]] && NL+="checker-pin-C1:PASS " || { NL+="checker-pin-C1:UNEXPECTED "; NOK=0; }
gpin "$NC0" --rehearsal; [[ $GP == "ACCEPT pin FAIL revision $NC0 has no $R9P/offhost/QUALIFIED-ENDPOINT"* ]] && NL+="checker-pin-C0:FAIL " || { NL+="checker-pin-C0:UNEXPECTED "; NOK=0; }
gpin "$NC1"; [[ $GP == "ACCEPT pin FAIL the pin at $NC1 has format=afldb-offhost-qualification-fixture-v1; a production evaluation needs format=afldb-offhost-qualification-v1"* ]] && NL+="checker-production-fixture-pin:FAIL " || { NL+="checker-production-fixture-pin:UNEXPECTED "; NOK=0; }
# the stub answers only `-G <alias>` (configuration lookup: ssh -G resolves, it never connects) with a TEST-NET address, and logs
# and refuses every other invocation, so any connection attempt is counted
printf '#!/bin/sh\nif [ "$1" = -G ]; then echo "hostname 192.0.2.1"; exit 0; fi\necho "NEVER $*" >> "%s"\nexit 255\n' "$KDM/n-never.log" > "$KD/n-never"; chmod 755 "$KD/n-never"; : > "$KD/n-never.log"
mkdir -p "$KD/nhome/.ssh"; cp "$KD/verify" "$KD/nhome/.ssh/afldb_verify"   # production transport reads the key from \$HOME only
out=$(HOME="$KDM/nhome" AFLDB_VERIFY_SSH="$KD/n-never" bash "$KD/exp1/$R7/verify/afldb-verify-call.sh" g0 "$DAY" 2>&1); N7=$?
{ echo "\$ AFLDB_VERIFY_SSH=<never: logs and exits 255> bash <exp1>/afldb-verify-call.sh g0 $DAY   (production transport, fixture-format pin)"; printf '%s\n' "$out"; echo "[HARNESS] exit $N7; ssh client invocations: $(wc -l < "$KD/n-never.log")"; } >> "$LN"
if [ "$N7" = 1 ] && grep -q '^OWNER VERDICT G0 STOP transport=production-stub .*step=qualification .*qualification=refused' <<< "$out" && [ "$(wc -l < "$KD/n-never.log")" = 0 ]; then NL+="production-on-fixture-pin:refused(no-ssh) "
else NL+="production-on-fixture-pin:UNEXPECTED($N7) "; NOK=0; fi
[ "$NOK" = 1 ] && res n "PASS candidate-sequence: $NL" || res n "FAIL candidate-sequence: $NL"

# ---- l1 (r9): the copy is present and qualified (FIXTURE), but the pull log's END is missing: possession only
LL=$LOGS/$RID-l-possession-only.log; hdr l "$LL"
sleep 4; "${DEVSSH[@]}" "$HOSTSH r9-drop-end" >> "$LL" 2>&1
sleep 4; wcall "$LL" "${QF[@]}" g0 "$DAY"; L1=$WRC; L1V=$(vline "$WOUT"); L1O=$WOUT
sleep 4; "${DEVSSH[@]}" "$HOSTSH r9-restore-end" >> "$LL" 2>&1
L1OK=0
[ "$L1" = 1 ] && [[ $L1V == *"step=G0b"*"reason=\"the off-host verifier answered STOP; possession only: "*"complete-at missing"*"qualification=FIXTURE"* ]] \
  && grep -q '^AFLDB-VERIFY RESULT G0B STOP .* rehash-sha256=[0-9a-f]\{64\} access-epoch=none$' <<< "$L1O" && grep -q '^FAIL scheduled pull: scheduled invocation .* has no unique completion record' <<< "$L1O" && L1OK=1

# ---- b: refusal when a required check fails (root damages the published dump)
LB=$LOGS/$RID-b-g0-refusal.log; hdr b "$LB"
sleep 4; "${DEVSSH[@]}" "$HOSTSH tamper" >> "$LB" 2>&1
sleep 4; wcall "$LB" g0 "$DAY"; B_V=$(vline "$WOUT")
sleep 4; "${DEVSSH[@]}" "$HOSTSH untamper" >> "$LB" 2>&1
if [ "$WRC" = 1 ] && [[ $B_V == "OWNER VERDICT G0 STOP transport=rehearsal"*"step=G0a"* ]] && grep -q '^FAIL scheduled origin unproven' <<< "$WOUT" \
   && ! grep -q '^-- G0b' <<< "$WOUT" && ! grep -q '^OFFHOST-COMPARE' <<< "$WOUT"; then
  res b "PASS g0-refusal: exit 1, $(grep '^FAIL scheduled origin' <<< "$WOUT" | cut -c1-140); G0b not called, no OFFHOST-COMPARE"
else res b "FAIL g0-refusal: exit $WRC; $(cut -c1-200 <<< "$B_V")"; fi

# ---- l2 (r9, LAST: it cannot be undone): the journal holding the 03:10 dispatch is removed; copy and pull log intact: possession only
sleep 4; "${DEVSSH[@]}" "$HOSTSH r9-drop-dispatch" >> "$LL" 2>&1
sleep 4; wcall "$LL" "${QF[@]}" g0 "$DAY"; L2=$WRC; L2V=$(vline "$WOUT"); L2O=$WOUT
L2OK=0
[ "$L2" = 1 ] && [[ $L2V == *"step=G0b"*"reason=\"the off-host verifier answered STOP; possession only: "*"dispatch-at missing"*"qualification=FIXTURE"* ]] \
  && grep -q '^UNPROVEN scheduled origin: no 03:10 cron dispatch' <<< "$L2O" && grep -q '^COPY VERIFIED ' <<< "$L2O" && L2OK=1
{ echo "[HARNESS] l1 (END removed): exit $L1; $L1V"; echo "[HARNESS] l2 (dispatch journal removed): exit $L2; $L2V"; } >> "$LL"
[ "$L1OK$L2OK" = 11 ] && res l "PASS possession-only: END removed -> G0 STOP exit $L1 '...possession only ... complete-at missing'; dispatch journal removed -> G0 STOP exit $L2 '...possession only ... dispatch-at missing'; both qualification=FIXTURE" \
  || res l "FAIL possession-only: l1 ok=$L1OK exit $L1; l2 ok=$L2OK exit $L2 ($(cut -c1-200 <<< "$L2V"))"

# ---- m (r10, Astra case 1, LAST): receipt by the identified 03:10 invocation, never possession. Each sub-case stages the rsync
# source and the destination, moves the fake zone so that a NEW 03:10 cron run of the REAL wrapper and REAL offhost-pull.sh fires
# (real rsync over ssh, --ignore-existing), and then makes the documented G0 call. The G0a half is production's real answer for the
# published dump MD; the G0b half judges the new 03:10 invocation.
LM=$LOGS/$RID-m-receipt.log; hdr m "$LM"
MOK=1; ML=
MD=$(grep -o ' dump=afldb_prod-[0-9]*-[0-9]*\.dump' <<< "$A_V" | head -1 | cut -d= -f2); MS=$(grep -o ' sha256=[0-9a-f]\{64\}' <<< "$A_V" | head -1 | cut -d= -f2)
MX=afldb_prod-${DAY//-/}-022700.dump; MY=afldb_prod-${DAY//-/}-022800.dump
echo "[HARNESS] m: published dump $MD sha256 $MS; other dumps $MX (m3), $MY (m4)" >> "$LM"
mrun() { # case token...: stage, fire a new 03:10 run, wait for its END, then the documented G0 call; sets MP (this run's pull log), MRC, MV, MO
  local c=$1; shift
  MP=$("${DEVSSH[@]}" "$HOSTSH m-prep $c $*" 2>&1); { echo "== m-prep $c $*"; printf '%s\n' "$MP"; } >> "$LM"
  # the fake zone moved, so the FIXTURE qualification's rehearsal-utc-offset is renewed to the container's new offset (Q-m)
  OFFOFF=$(sed -n 's/^R7V M-OFFSET //p' <<< "$MP" | tail -1); mkq Q-m r7v-offhost "$OFP"; MQ=(--qualification-fixture "$KDM/qual/Q-m")
  echo "[HARNESS] m $c: Q-m rehearsal-utc-offset=$OFFOFF (sha256 $(sha256sum < "$KD/qual/Q-m" | cut -c1-64))" >> "$LM"
  sleep 4; wcall "$LM" "${MQ[@]}" g0 "$DAY"; MRC=$WRC; MV=$(vline "$WOUT"); MO=$WOUT; }
pl() { grep -c "^   pull-log | [0-9TZ:-]* $1" <<< "$MP"; }
# m2 (the decisive negative): the right dump and its sidecar are PRE-PLACED; the normal pull runs with --ignore-existing, moves
# nothing and ends rc=0
mrun m2 "rm:$MD" "dest:$MD"
if [ "$MRC" = 1 ] && [ "$(pl 'END run=[^ ]* rc=0')" = 1 ] && [ "$(pl RECEIVED)" = 0 ] && [ "$(pl RECEIPT)" = 0 ] && [ "$(pl "HELD run=[^ ]* dump=$MD sha256=$MS")" = 1 ] \
   && grep -q "^UNPROVEN scheduled origin: possession only: the scheduled invocation did not receive $MD .*HELD a copy: 1 time(s); it received: nothing" <<< "$MO" \
   && [[ $MV == "OWNER VERDICT G0 STOP "*"possession only"* ]] && ! grep -q '^OWNER VERDICT G0 PASS' <<< "$MO"; then ML+="m2-preplaced:END-rc0,HELD,no-RECEIVED->STOP "
else ML+="m2-preplaced:UNEXPECTED($MRC) "; MOK=0; fi
# m3: the same job transfers a DIFFERENT dump; the published one is only held
mrun m3 "src:$MX"
if [ "$MRC" = 1 ] && [ "$(pl "RECEIVED run=[^ ]* dump=$MX ")" = 1 ] && [ "$(pl "RECEIPT run=[^ ]* dump=$MX ")" = 1 ] && [ "$(pl "RECEIVED run=[^ ]* dump=$MD ")" = 0 ] \
   && grep -q "^UNPROVEN scheduled origin: possession only: the scheduled invocation did not receive $MD .*it received: $MX" <<< "$MO" && [[ $MV == "OWNER VERDICT G0 STOP "*"possession only"* ]]; then
  ML+="m3-other-dump:RECEIPT-for-$MX-only->STOP "
else ML+="m3-other-dump:UNEXPECTED($MRC) "; MOK=0; fi
# m4: partial failure: the job receives the published dump but a later source file is unreadable (rsync exit 23); then the owner
# retries by hand, which cannot replace the failed 03:10 invocation
mrun m4 "rm:$MD" "deny:$MY"
M4A=$MRC; M4V=$MV
if [ "$MRC" = 1 ] && [ "$(pl 'END run=[^ ]* rc=1')" = 1 ] && [ "$(pl RECEIPT)" = 0 ] && grep -q 'rsync failed (exit 23); no receipt is issued' <<< "$MP" \
   && grep -q '^FAIL scheduled pull: ' <<< "$MO" && ! grep -q '^OWNER VERDICT G0 PASS' <<< "$MO"; then ML+="m4-partial:END-rc1,no-RECEIPT->STOP($(grep -o '^FAIL scheduled pull: [^(;]*' <<< "$MO" | head -1 | cut -c21-70)) "
else ML+="m4-partial:UNEXPECTED($MRC) "; MOK=0; fi
MP=$("${DEVSSH[@]}" "$HOSTSH m-manual $MY" 2>&1); { echo "== m-manual $MY"; printf '%s\n' "$MP"; } >> "$LM"
sleep 4; wcall "$LM" "${MQ[@]}" g0 "$DAY"; MRC=$WRC; MO=$WOUT
if [ "$MRC" = 1 ] && grep -q '^R7V M-MANUAL exit 0' <<< "$MP" && grep -q "^FAIL scheduled pull: scheduled invocation failed (rc=1); a later retry cannot replace it" <<< "$MO" && ! grep -q '^OWNER VERDICT G0 PASS' <<< "$MO"; then
  ML+="m4-retry:manual-exit0,G0-STOP(failed-0310-run) "
else ML+="m4-retry:UNEXPECTED($MRC) "; MOK=0; fi
# m1: the genuine case: the 03:10 run transfers the published dump in full, verifies it and writes its RECEIPT after END rc=0
mrun m1 "rm:$MD"
if [ "$MRC" = 0 ] && [ "$(pl "RECEIVED run=[^ ]* dump=$MD sha256=$MS bytes=")" = 1 ] && [ "$(pl "RECEIPT run=[^ ]* dump=$MD sha256=$MS bytes=[0-9]* end=")" = 1 ] \
   && grep -q "^RECEIPT dump=$MD sha256=$MS " <<< "$MO" && [[ $MV == "OWNER VERDICT G0 PASS transport=rehearsal"*" received-at=20"*"Z complete-at=20"*"Z received-sha256=$MS"* ]]; then
  ML+="m1-genuine:RECEIVED+RECEIPT->PASS($(grep -o 'received-at=[^ ]*' <<< "$MV")) "
else ML+="m1-genuine:UNEXPECTED($MRC) "; MOK=0; fi
[ "$MOK" = 1 ] && res m "PASS receipt: $ML" || res m "FAIL receipt: $ML"

say "logs: $(cd "$LOGS" && ls "$RID"-*.log | tr '\n' ' ')"
[ "$BAD" = 0 ] && say "R7 VERIFY HARNESS RESULT PASS" || say "R7 VERIFY HARNESS RESULT FAIL ($BAD scenario(s))"
[ "$BAD" = 0 ]
