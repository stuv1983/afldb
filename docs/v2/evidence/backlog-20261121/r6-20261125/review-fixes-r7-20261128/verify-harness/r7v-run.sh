#!/usr/bin/env bash
# r7v-run.sh (R6 r7, MED-2): END-TO-END REHEARSAL of the owner verifier from the WORKSTATION (Git Bash). REHEARSAL ONLY: streamanator
# containers, never production. The documented owner entry point verify/afldb-verify-call.sh runs with the workstation's real ssh
# client (Windows OpenSSH, as in the runbook), a FRESH test verify key, PINNED container host keys, and the rehearsal transport
# (ProxyCommand = ssh arm@streamanator `docker exec -i <container> nc 127.0.0.1 22`; the containers stay --network none).
# Usage: bash r7v-run.sh [--verify-rev <rev>] [--keep-image] <RID>
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
# Logs: verify-harness/logs/<RID>-*.log (workstation). Containers, image, workspace and test keys are removed at the end.
# Development only (never in a recorded run): R7V_IMAGE=<kept image> reuses an image; --keep-image keeps it; R7V_KEEP_CTRS=1 keeps
# the containers and workspace for inspection (the summary prints the `down` command).
set -uo pipefail; export LC_ALL=C
VREV=; KEEPIMG=
while :; do case ${1:-} in --verify-rev) VREV=${2:?rev}; shift 2;; --keep-image) KEEPIMG=--keep-image; shift;; *) break;; esac; done
RID=${1:?rid}; [[ $RID =~ ^[A-Za-z0-9-]{1,24}$ ]] || { echo "STOP bad RID"; exit 2; }
WT=/d/dev/afldb-closeout-20261127
R7=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r7-20261128
HV=$WT/$R7/verify-harness; LOGS=$HV/logs; mkdir -p "$LOGS"
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
      docs/v2/evidence/backlog-20261121/kits/afldb-offhost-pull-daily.sh "$OLDG0" "$OLDA2")
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
echo "[HARNESS] fresh keys: verify $(cut -d' ' -f2 "$KD/verify.pub" | cut -c1-24)... other $(cut -d' ' -f2 "$KD/other.pub" | cut -c1-24)... arm $(cut -d' ' -f2 "$KD/arm.pub" | cut -c1-24)..." >> "$HDR"

# ---- streamanator workspace, containers
WS=$("${DEVSSH[@]}" 'mktemp -d -p "$HOME" r7v-ws.XXXXXX') || exit 1
echo "workspace $WS" | tee -a "$HDR"
tar -C "$WT" -cf - "${SENT[@]}" -C "$KD/stage" r7v-keys | "${DEVSSH[@]}" "mkdir -m 700 '$WS/fix' && tar -C '$WS/fix' -xf - && find '$WS/fix' -type f | wc -l" >> "$HDR"
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
wcall "$LA" g0 "$DAY"; A_OUT=$WOUT; A_RC=$WRC; A_V=$(vline "$WOUT")
if [ "$A_RC" = 0 ] && [[ $A_V == "OWNER VERDICT G0 PASS transport=rehearsal"* ]] && grep -q '^-- G0b' <<< "$WOUT" && grep -q '^AFLDB-VERIFY RESULT G0B PASS' <<< "$WOUT"; then
  res a "PASS g0-success: exit 0; $(cut -c1-230 <<< "$A_V")"
else res a "FAIL g0-success: exit $A_RC; $(cut -c1-300 <<< "$A_V")"; fi

# ---- c: whole A-2 through the owner path
LC=$LOGS/$RID-c-a2-whole.log; hdr c "$LC"
wcall "$LC" a2 $A2ARGS; C_OUT=$WOUT; C_RC=$WRC; C_V=$(vline "$WOUT")
NF=$(grep -c '^FAIL ' <<< "$WOUT"); NP=$(grep -c '^PASS ' <<< "$WOUT")
{ echo "[HARNESS] the STOP is the verifier's own: its RESULT line (pinned bundle, this call's nonce) is:"; grep '^AFLDB-VERIFY RESULT' <<< "$WOUT" | sed 's/^/   /'
  echo "[HARNESS] FAIL lines ($NF):"; grep '^FAIL ' <<< "$WOUT" | sed 's/^/   /'
  echo "[HARNESS] PASS lines ($NP):"; grep '^PASS ' <<< "$WOUT" | sed 's/^/   /'; } >> "$LC"
if [ "$C_RC" = 1 ] && [[ $C_V == "OWNER VERDICT A2 STOP transport=rehearsal"* ]] && grep -q 'backup-origin=attributed' <<< "$C_V" \
   && grep -q '^AFLDB-VERIFY RESULT A2 STOP ' <<< "$WOUT" && grep -q '^R6 PRE RESULT STOP' <<< "$WOUT"; then
  res c "PASS a2-whole: the verifier's own STOP (exit 1, $NF FAIL / $NP PASS lines), backup-origin=attributed reported separately; FAILs: $(grep '^FAIL ' <<< "$WOUT" | cut -c6-60 | tr '\n' '|' | cut -c1-600)"
else res c "FAIL a2-whole: exit $C_RC; $(cut -c1-300 <<< "$C_V")"; fi

# ---- d: hostile arm login environment
LD=$LOGS/$RID-d-hostile-arm.log; hdr d "$LD"
"${DEVSSH[@]}" "$HOSTSH hostile" >> "$LD" 2>&1
wcall "$LD" g0 "$DAY"; D1_RC=$WRC; D1_V=$(vline "$WOUT"); D1_OUT=$WOUT
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
  out=$(R7V_FAKE=$m AFLDB_VERIFY_SSH="$KD/fakessh" bash "$CALL" --rehearsal "$CFG" --key "$KV" g0 "$DAY" 2>&1); rc=$?
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

# ---- b: refusal when a required check fails (root damages the published dump)
LB=$LOGS/$RID-b-g0-refusal.log; hdr b "$LB"
"${DEVSSH[@]}" "$HOSTSH tamper" >> "$LB" 2>&1
wcall "$LB" g0 "$DAY"; B_V=$(vline "$WOUT")
"${DEVSSH[@]}" "$HOSTSH untamper" >> "$LB" 2>&1
if [ "$WRC" = 1 ] && [[ $B_V == "OWNER VERDICT G0 STOP transport=rehearsal"*"step=G0a"* ]] && grep -q '^FAIL scheduled origin unproven' <<< "$WOUT" \
   && ! grep -q '^-- G0b' <<< "$WOUT" && ! grep -q '^OFFHOST-COMPARE' <<< "$WOUT"; then
  res b "PASS g0-refusal: exit 1, $(grep '^FAIL scheduled origin' <<< "$WOUT" | cut -c1-140); G0b not called, no OFFHOST-COMPARE"
else res b "FAIL g0-refusal: exit $WRC; $(cut -c1-200 <<< "$B_V")"; fi

say "logs: $(cd "$LOGS" && ls "$RID"-*.log | tr '\n' ' ')"
[ "$BAD" = 0 ] && say "R7 VERIFY HARNESS RESULT PASS" || say "R7 VERIFY HARNESS RESULT FAIL ($BAD scenario(s))"
[ "$BAD" = 0 ]
