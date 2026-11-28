#!/usr/bin/env bash
# r8p-run.sh (R6 r8, 28 Nov 2026): REHEARSAL of OWNER-PROCEDURE.md from the WORKSTATION (Git Bash). REHEARSAL ONLY: one disposable
# streamanator container, never production (209.38.87.252 / alias afldb is never contacted). Production today's shape is the FIXTURE:
# arm with sudo. `docker exec` as root stands in for the provider console [HARNESS]. The admin account gets its own fresh test key;
# the workstation's real Windows OpenSSH reaches the container's real sshd through a ProxyCommand transport
# (ssh arm@streamanator docker exec -i <ctr> nc 127.0.0.1 22; the container stays --network none) [HARNESS transport].
# Every byte installed reaches the container ONLY through the admin SSH path, as one tar the workstation built and hashed; the
# admin root session re-verifies it against the workstation's digests, passed as arguments.
# Usage: bash r8p-run.sh [--verify-rev <rev>] <RID>
#   --verify-rev REV  the stage tar is `git archive REV` of the bundle paths (plus the workstation's verify public key), and every
#                     harness file sent equals its blob at REV; otherwise the worktree bytes are used (development evidence only).
# Scenarios print `SCENARIO <name> PASS|FAIL|PENDING expect=... got=...`; the run ends `R8 PROCEDURE HARNESS RESULT PASS|FAIL`.
# A PENDING scenario (an interface agent B owns that is not in the bytes under test) makes the result FAIL, never PASS.
set -uo pipefail; export LC_ALL=C
VREV=
while :; do case ${1:-} in --verify-rev) VREV=${2:?rev}; shift 2;; *) break;; esac; done
RID=${1:?rid}; [[ $RID =~ ^[A-Za-z0-9-]{1,24}$ ]] || { echo "STOP bad RID"; exit 2; }
WT=/d/dev/afldb-closeout-20261127
R7=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r7-20261128
R8=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r8-20261128
HD=$WT/$R8/procedure-harness; LOGS=$HD/logs; mkdir -p "$LOGS"
DEVSSH=(ssh -o BatchMode=yes -i "$HOME/.ssh/afldb_dev" arm@10.0.40.100)
WSSH=C:/Windows/System32/OpenSSH/ssh.exe; WKEYGEN=C:/Windows/System32/OpenSSH/ssh-keygen.exe
LOG=$LOGS/$RID-run.log; SUM=$LOGS/$RID-summary.log; : > "$LOG"; : > "$SUM"
say() { printf '%s\n' "$*" | tee -a "$SUM" >> "$LOG"; printf '%s\n' "$*"; }
log() { printf '%s\n' "$*" >> "$LOG"; }
BAD=0; PEND=0
res() { local n=$1 s=$2; shift 2; say "SCENARIO $n $s $*"; case $s in PASS) ;; PENDING) PEND=$((PEND + 1));; *) BAD=$((BAD + 1));; esac; }
pace() { sleep 4; }   # the owner's home firewall IPS blocks bursts of SSH connections: keep them few and spaced

# ------------------------------------------------------------------------------------------ inputs and their verification
STAGE_PATHS=("$R7/backup" "$R7/verify" "$R8/owner-checks" tools/maintenance/backup.sh)
SENT=("$R8/procedure-harness/r8p-host.sh" "$R8/procedure-harness/r8p-container.sh" "$R8/procedure-harness/r8p-admin.sh"
      deploy/afldb-backup.service deploy/afldb-backup.timer deploy/afldb-backup-failed.service)
KD=$(mktemp -d); KDM=$(cygpath -m "$KD"); chmod 700 "$KD"
WS=
cleanup() {
  if [ -n "$WS" ]; then log "== cleanup"; "${DEVSSH[@]}" "bash '$WS/fix/r8p-host.sh' '$WS' '$RID' down" 2>&1 | tee -a "$LOG" | tee -a "$SUM"; fi
  rm -rf "$KD"
}
trap cleanup EXIT
{ echo "== r8p-run $RID $(date -u +%FT%TZ) workstation $(hostname) id=[$(id)]; worktree HEAD $(git -C "$WT" rev-parse HEAD)"
  echo "[HARNESS] client $WSSH ($("$WSSH" -V 2>&1 | tr -d '\r'))"; } | tee -a "$LOG"
for f in "${SENT[@]}" "$R8/owner-checks/afldb-owner-checks.sh"; do grep -q $'\r' "$WT/$f" && { echo "STOP $f contains CR bytes"; exit 2; }; done
if [ -n "$VREV" ]; then
  REV=$(git -C "$WT" rev-parse --verify "$VREV^{commit}") || { echo "STOP unknown revision $VREV"; exit 2; }
  bad=0; log "[TRANSPORT] pre-send verification against $REV:"
  for f in "${SENT[@]}"; do w=$(sha256sum < "$WT/$f" | cut -c1-64); g=$(git -C "$WT" show "$REV:$f" 2>/dev/null | sha256sum | cut -c1-64)
    [ "$w" = "$g" ] && log "   EQUAL $w  $f" || { log "   DIFFERS worktree $w blob $g  $f"; bad=1; }; done
  [ $bad = 0 ] || { echo "STOP the harness files differ from $REV"; exit 2; }
  git -C "$WT" archive --format=tar --output="$KDM/stage.tar" "$REV" "${STAGE_PATHS[@]}" || { echo "STOP git archive"; exit 2; }
  log "[TRANSPORT] stage tar = git archive $REV ${STAGE_PATHS[*]} (+ keys/afldb_verify.pub below)"
  BYTES="git archive $REV"
else
  for f in "${SENT[@]}"; do log "   WORKTREE $(sha256sum < "$WT/$f" | cut -c1-64)  $f"; done
  tar -C "$WT" -cf "$KD/stage.tar" "${STAGE_PATHS[@]}" || { echo "STOP tar"; exit 2; }
  log "[TRANSPORT] no --verify-rev: the stage tar holds WORKTREE bytes of ${STAGE_PATHS[*]} (development evidence, not a committed revision)"
  BYTES="worktree"
fi
# the bundle digests as the WORKSTATION computes them from the bytes it sends (the procedure's <R8-PIN:...> values)
BSUMS=$(tar -xOf "$KD/stage.tar" "$R7/backup/SHA256SUMS" | sha256sum | cut -c1-64)
VSUMS=$(tar -xOf "$KD/stage.tar" "$R7/verify/SHA256SUMS" | sha256sum | cut -c1-64)
CSUMS=$(tar -xOf "$KD/stage.tar" "$R8/owner-checks/SHA256SUMS" | sha256sum | cut -c1-64)
GUARD_B=0; GUARD_V=0; ASARM=0
tar -xOf "$KD/stage.tar" "$R7/backup/install-backup.sh" | grep -q 'REFUSED: root session descends from arm' && GUARD_B=1
tar -xOf "$KD/stage.tar" "$R7/verify/install-verify.sh" | grep -q 'REFUSED: root session descends from arm' && GUARD_V=1
tar -xOf "$KD/stage.tar" "$R7/backup/verify-backup-install.sh" | grep -q -- '--as-arm' && ASARM=1
log "[HARNESS] in the bytes under test: install-backup.sh guard=$GUARD_B install-verify.sh guard=$GUARD_V verify-backup-install.sh --as-arm=$ASARM"

# fresh test keys (Windows ssh-keygen: owner-only ACLs, as the Windows client requires) and passwords (never printed)
for k in admin arm verify swap; do "$WKEYGEN" -q -t ed25519 -N '' -C "r8p-$RID-$k" -f "$KDM/$k" > /dev/null || { echo "STOP ssh-keygen"; exit 2; }; tr -d '\r' < "$KD/$k.pub" > "$KD/$k.pub.lf"; done
fpw() { "$WKEYGEN" -lf "$KDM/$1.pub" | tr -d '\r' | awk '{print $2}'; }
AFP=$(fpw admin); VFP=$(fpw verify)
(umask 077; od -An -N12 -tx1 /dev/urandom | tr -d ' \n' > "$KD/apw"; echo >> "$KD/apw"; od -An -N12 -tx1 /dev/urandom | tr -d ' \n' > "$KD/armpw"; echo >> "$KD/armpw")
mkdir -p "$KD/stagekeys/keys"; cp "$KD/verify.pub.lf" "$KD/stagekeys/keys/afldb_verify.pub"
tar -C "$KD/stagekeys" -rf "$KD/stage.tar" keys/afldb_verify.pub || { echo "STOP append key"; exit 2; }
TAR_SHA=$(sha256sum < "$KD/stage.tar" | cut -c1-64)
mkdir -p "$KD/fix/keys" "$KD/fix/deploy"
cp "$WT/$R8/procedure-harness/r8p-host.sh" "$WT/$R8/procedure-harness/r8p-container.sh" "$KD/fix/"
for u in afldb-backup.service afldb-backup.timer afldb-backup-failed.service; do cp "$WT/deploy/$u" "$KD/fix/deploy/"; done
cp "$KD/arm.pub.lf" "$KD/fix/keys/arm.pub"; cp "$KD/swap.pub.lf" "$KD/fix/keys/swap.pub"
{ echo "[HARNESS] workstation values: stage tar ($BYTES) $TAR_SHA; backup SHA256SUMS $BSUMS; verify SHA256SUMS $VSUMS; owner-checks SHA256SUMS $CSUMS"
  echo "[HARNESS] fresh test keys: admin $AFP, verify $VFP, arm $(fpw arm), swap (arm's substitute) $(fpw swap); admin and arm passwords random, never printed"; } | tee -a "$LOG"

# ------------------------------------------------------------------------------------------ streamanator workspace, container (console stand-in)
WS=$("${DEVSSH[@]}" 'mktemp -d -p "$HOME" r8p-ws.XXXXXX') || { echo "STOP workspace"; WS=; exit 1; }
log "workspace $WS"; pace
tar -C "$KD/fix" -cf - . | "${DEVSSH[@]}" "mkdir -m 700 '$WS/fix' && tar -C '$WS/fix' -xf - && find '$WS/fix' -type f | wc -l" >> "$LOG"; pace
HX() { "${DEVSSH[@]}" "bash '$WS/fix/r8p-host.sh' '$WS' '$RID' $*"; }
SETUP=$(HX up < "$KD/armpw" 2>&1); printf '%s\n' "$SETUP" >> "$LOG"
grep -q '^R8P SETUP DONE' <<< "$SETUP" || { tail -20 <<< "$SETUP"; say "STOP setup failed"; say "R8 PROCEDURE HARNESS RESULT FAIL"; exit 1; }
C=$(sed -n 's/^R8P CTR //p' <<< "$SETUP"); HK=$(sed -n 's/^R8P HOSTKEY //p' <<< "$SETUP")
res setup PASS "expect=arm-with-sudo got=$(grep -m1 'arm as on production today' <<< "$SETUP" | cut -c1-160)"
echo "r8p-host $HK" > "$KD/known_hosts"
PX="C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes -i $(cygpath -m "$HOME/.ssh/afldb_dev") arm@10.0.40.100 docker exec -i $C nc 127.0.0.1 22"
cat > "$KD/cfg" <<EOF
# REHEARSAL transport (r8p-run.sh): the container has no network; ProxyCommand reaches its sshd through docker exec. Production uses
# -F none with the same options and the pinned production host key instead.
Host r8p-admin r8p-arm r7v-prod
  HostName r8p-host
  HostKeyAlias r8p-host
  ProxyCommand $PX
Host r8p-admin
  User afldb-admin
Host r8p-arm
  User arm
Host r7v-prod
  User afldb-verify
Host r7v-offhost
  HostName 127.0.0.1
  Port 9
  User afldb-verify
Host *
  UserKnownHostsFile $KDM/known_hosts
  GlobalKnownHostsFile $KDM/known_hosts
  StrictHostKeyChecking yes
  IdentitiesOnly yes
  IdentityAgent none
  BatchMode yes
  PasswordAuthentication no
  KbdInteractiveAuthentication no
  ConnectTimeout 30
EOF
S() { local key=$1 host=$2; shift 2; "$WSSH" -F "$KDM/cfg" -o "IdentityFile=$KDM/$key" -T "$host" "$@"; }
# admin root step: the password line, then r8p-admin.sh, into sudo -S in the admin session
AS() { { cat "$KD/apw"; cat "$HD/r8p-admin.sh"; } | S admin r8p-admin "sudo -S -p '' -k /usr/bin/bash --noprofile --norc -s -- $*" 2>&1 | tr -d '\r'; }
L() { local f=$LOGS/$RID-$1.log; shift; { echo "== $RID $(date -u +%FT%TZ) $*"; cat; } > "$f"; cat "$f" >> "$LOG"; }

# ------------------------------------------------------------------------------------------ Phase 0 and 1 at the console stand-in
pace
O=$(S arm r8p-arm 'umask 077; cat > ~/afldb_admin.pub; echo "carried by arm: $(wc -c < ~/afldb_admin.pub) bytes"; id' < "$KD/admin.pub.lf" 2>&1 | tr -d '\r'); printf '%s\n' "$O" | L arm-carries-pub "arm carries the admin .pub as data (arm's own login, arm's key)"
pace
O=$(HX exec console "$AFP" < "$KD/apw" 2>&1); printf '%s\n' "$O" | L console "Phase 0 facts, pubkey swap, Phase 1 at the console stand-in"
grep -q 'R8P PHASE0 root-console=yes' <<< "$O" && res console-phase0 PASS "expect=root-console-session got=$(grep -m1 'loginuid' <<< "$O" | tr -s ' ') (docker exec stands in for the provider console; production's is UNKNOWN)" \
  || res console-phase0 FAIL "expect=root-console-session got=none"
grep -q 'R8P PHASE1 REFUSED (swap)' <<< "$O" && grep -q 'R8P PUBKEY-SWAP exit 1' <<< "$O" && ! grep -q 'UNEXPECTED' <<< "$O" \
  && res pubkey-swap PASS "expect=refused got=refused (a key arm substituted for the carried .pub was not installed; nothing created)" || res pubkey-swap FAIL "expect=refused got=$(grep 'R8P PHASE1\|PUBKEY' <<< "$O" | tr '\n' ' ')"
grep -q 'R8P PHASE1 DONE (real)' <<< "$O" && grep -q "authorized_keys afldb-admin:afldb-admin 600 $AFP" <<< "$O" \
  && res admin-bootstrap PASS "expect=afldb-admin-with-workstation-key got=$(grep -m1 '   afldb-admin:' <<< "$O" | cut -c1-200)" || res admin-bootstrap FAIL "expect=afldb-admin-with-workstation-key got=$(grep 'R8P PHASE1' <<< "$O" | tr '\n' ' ')"

# ------------------------------------------------------------------------------------------ Phase 1 verification from the workstation
pace
O=$({ cat "$KD/apw" "$KD/apw"; } | S admin r8p-admin 'id; sudo -k; sudo -S -p "" -v && echo "R8P SUDO-V ok"; sudo -S -p "" -l | sed -n "/may run/,\$p"' 2>&1 | tr -d '\r')
printf '%s\n' "$O" | L admin-login-1 "admin login 1: -F <cfg>, IdentitiesOnly, the admin key only, StrictHostKeyChecking=yes against the pinned host key"
grep -q '(afldb-admin)' <<< "$O" && grep -q 'R8P SUDO-V ok' <<< "$O" && grep -qE '\(ALL : ALL\) ALL' <<< "$O" \
  && res admin-login-1 PASS "expect=id+sudo-v+sudo-l got=$(head -1 <<< "$O" | cut -c1-120); sudo -v ok; (ALL : ALL) ALL" || res admin-login-1 FAIL "expect=id+sudo-v+sudo-l got=$(tr '\n' ' ' <<< "$O" | cut -c1-200)"
pace
O=$(S arm r8p-admin 'id' 2>&1 | tr -d '\r'); RC=$?; printf '%s\nexit %s\n' "$O" "$RC" | L admin-keys "arm's key offered for afldb-admin"
grep -q 'Permission denied' <<< "$O" && ! grep -q 'uid=' <<< "$O" && res admin-keys PASS "expect=arm-key-refused-for-admin got=$(grep -m1 'Permission denied' <<< "$O" | cut -c1-100)" \
  || res admin-keys FAIL "expect=arm-key-refused-for-admin got=$(tr '\n' ' ' <<< "$O" | cut -c1-160)"

# ------------------------------------------------------------------------------------------ staging over the admin path, Phase 2 before any change
pace
O=$(S admin r8p-admin 'umask 077; set -C; cat > ~/afldb-r8-stage.tar && echo "received $(wc -c < ~/afldb-r8-stage.tar) bytes"' < "$KD/stage.tar" 2>&1 | tr -d '\r'); printf '%s\n' "$O" | L stage-transfer "stage tar over the admin path"
pace
O=$(AS stage "$TAR_SHA" "$BSUMS" "$VSUMS" "$CSUMS" "$VFP" "$AFP"); printf '%s\n' "$O" | L stage-and-checks-pre "admin root session: re-verify the tar, stage, Phase 2 checks before any change"
grep -q 'R8P STAGE OK' <<< "$O" && res stage PASS "expect=workstation-digests-match got=tar $TAR_SHA, three SHA256SUMS and the verify key equal the workstation values" || res stage FAIL "expect=workstation-digests-match got=$(grep 'STOP' <<< "$O" | head -2 | tr '\n' ' ')"
V=$(grep '^OWNER CHECKS RESULT' <<< "$O"); A2=$(grep '^CHECK A2 ' <<< "$O" | cut -c1-14)
[[ $V == "OWNER CHECKS RESULT BLOCKED"* ]] && grep -q '^CHECK B1 FAIL' <<< "$O" && grep -q '^CHECK B2 FAIL' <<< "$O" && [ "$A2" = "CHECK A2 PASS " ] \
  && res checks-pre PASS "expect=BLOCKED(arm-can-sudo) got=$V; $(grep '^CHECK B2 ' <<< "$O" | cut -c1-90); session independent ($A2)" || res checks-pre FAIL "expect=BLOCKED(arm-can-sudo) got=$V $A2"

# ------------------------------------------------------------------------------------------ the same through arm's login and arm's sudo
pace
ARMCMD='read -r PW; echo "-- as: $(id)"; printf "%s\n" "$PW" | sudo -S -p "" -k env -i PATH=/usr/sbin:/usr/bin /usr/bin/bash --noprofile --norc /opt/afldb-r8-armtest/checks/afldb-owner-checks.sh --admin afldb-admin; echo "R8P ARM-CHECKS exit $?"'
[ "$GUARD_B" = 1 ] && ARMCMD="$ARMCMD"'; printf "%s\n" "$PW" | sudo -S -p "" -k bash /opt/afldb-r8-armtest/backup/install-backup.sh /opt/afldb-r8-armtest/backup; echo "R8P ARM-INSTALL exit $?"'
O=$(S arm r8p-arm "$ARMCMD" < "$KD/armpw" 2>&1 | tr -d '\r'); printf '%s\n' "$O" | L arm-sudo "arm's login + arm's sudo: the owner checks, and (if guarded) install-backup.sh"
V=$(grep '^OWNER CHECKS RESULT' <<< "$O")
grep -q '^CHECK A2 FAIL' <<< "$O" && [[ $V == *BLOCKED*"session not independent"* ]] && res arm-sudo-checks PASS "expect=BLOCKED(A2) got=$V" || res arm-sudo-checks FAIL "expect=BLOCKED(A2) got=$V"
if [ "$GUARD_B" = 1 ]; then
  grep -q '^REFUSED: root session descends from arm' <<< "$O" && ! grep -q 'R8P ARM-INSTALL exit 0' <<< "$O" \
    && res arm-sudo-installer PASS "expect=REFUSED got=$(grep -m1 '^REFUSED' <<< "$O" | cut -c1-160)" || res arm-sudo-installer FAIL "expect=REFUSED got=$(grep 'ARM-INSTALL\|REFUSED\|INSTALL REFUSED' <<< "$O" | tr '\n' ' ' | cut -c1-200)"
else res arm-sudo-installer PENDING "expect=REFUSED got=guard-not-in-the-bytes-under-test (install-backup.sh has no 'REFUSED: root session descends from arm'); not run, so nothing was installed through arm"; fi
pace
O=$(HX exec nothing-installed 2>&1); printf '%s\n' "$O" | L nothing-installed "console: nothing installed after arm's attempt"
grep -q 'R8P NOTHING-INSTALLED yes' <<< "$O" && res nothing-installed-via-arm PASS "expect=nothing got=nothing (no account, group, drop-in or code directory)" || res nothing-installed-via-arm FAIL "expect=nothing got=$O"

# ------------------------------------------------------------------------------------------ Phase 3: installs through the admin path
pace
O=$(AS install "$AFP"); printf '%s\n' "$O" | L install "admin root session: Phase 3 installs, both checks, owner checks before the access change"
ex() { sed -n "s/^R8P $1 exit \\([0-9]*\\).*/\\1/p" <<< "$O" | tail -1; }
[ "$(ex INSTALL-BACKUP)" = 0 ] && [ "$(ex VBI-ROOT)" = 0 ] && grep -q '^BACKUP INSTALL RESULT PASS' <<< "$O" && res install-backup PASS "expect=install+BACKUP-INSTALL-PASS(root) got=install exit 0, verify-backup-install root exit 0" \
  || res install-backup FAIL "expect=install+PASS got=install $(ex INSTALL-BACKUP) vbi-root $(ex VBI-ROOT)"
M=$(sed -n 's/^R8P VBI-ARM exit [0-9]* mode=//p' <<< "$O")
[ "$(ex VBI-ARM)" = 0 ] && res verify-backup-as-arm PASS "expect=BACKUP-INSTALL-PASS(arm,no-startup-files) got=exit 0 mode=$M" || res verify-backup-as-arm FAIL "expect=PASS got=exit $(ex VBI-ARM) mode=$M"
[ "$ASARM" = 1 ] || res as-arm-mode PENDING "expect=verify-backup-install.sh --as-arm got=not-in-the-bytes-under-test (the explicit setpriv form ran instead)"
[ "$(ex INSTALL-VERIFY)" = 0 ] && [ "$(ex VVI)" = 0 ] && res install-verify PASS "expect=INSTALL-VERIFY+VERIFY-INSTALL-PASS got=install-verify exit 0, verify-verify-install exit 0" \
  || res install-verify FAIL "expect=PASS got=install-verify $(ex INSTALL-VERIFY) vvi $(ex VVI)"
V=$(grep '^OWNER CHECKS RESULT' <<< "$O" | tail -1)
[[ $V == "OWNER CHECKS RESULT BLOCKED"* ]] && grep -q '^CHECK B2 FAIL' <<< "$O" && res checks-post-install PASS "expect=BLOCKED(installs-alone-do-not-close-F1) got=$V" || res checks-post-install FAIL "expect=BLOCKED got=$V"

pace
O=$(bash "$WT/$R7/verify/afldb-verify-call.sh" --rehearsal "$KDM/cfg" --key "$KDM/verify" version 2>&1 | tr -d '\r'); printf '%s\n' "$O" | L wrapper-version "workstation: afldb-verify-call.sh version (verify key; one host in this harness)"
grep -q '^OWNER VERDICT VERSION PASS transport=rehearsal host=afldb-prod role=prod' <<< "$O" \
  && res wrapper-version PASS "expect=VERSION-PASS(afldb-prod) got=$(grep -m1 '^OWNER VERDICT VERSION PASS' <<< "$O" | cut -c1-120); offhost: STOP (no off-host container in this harness, expected)" \
  || res wrapper-version FAIL "expect=VERSION-PASS(afldb-prod) got=$(grep '^OWNER VERDICT' <<< "$O" | tr '\n' ' ' | cut -c1-240)"

# ------------------------------------------------------------------------------------------ Phase 4 (proposed; owner approval): change existing access
pace
O=$(AS phase4); printf '%s\n' "$O" | L phase4 "admin root session: Phase 4, arm removed from sudo"
grep -q 'R8P PHASE4 done' <<< "$O" && grep -q 'not allowed to run sudo' <<< "$O" && res phase4 PASS "expect=arm-not-allowed-sudo got=$(grep 'sudo -l -U arm' <<< "$O" | cut -c1-120)" || res phase4 FAIL "expect=arm-not-allowed got=$(tr '\n' ' ' <<< "$O" | cut -c1-200)"
pace
O=$(AS reverify "$AFP"); printf '%s\n' "$O" | L login-2-reverify "admin login 2 (new connection) after Phase 4: both install checks again, owner checks"
grep -q '^== admin root session step reverify' <<< "$O" && grep -q 'SUDO_USER=afldb-admin' <<< "$O" && res admin-login-2 PASS "expect=admin-login+sudo-after-phase4 got=$(grep -m1 'SUDO_USER' <<< "$O" | cut -c1-120)" || res admin-login-2 FAIL "expect=admin-login got=$(head -3 <<< "$O" | tr '\n' ' ')"
[ "$(ex VBI-ROOT)" = 0 ] && [ "$(ex VBI-ARM)" = 0 ] && [ "$(ex VVI)" = 0 ] && res reverify PASS "expect=both-install-checks-PASS got=vbi-root 0, vbi-arm 0, vvi 0" || res reverify FAIL "expect=PASS got=vbi-root $(ex VBI-ROOT) vbi-arm $(ex VBI-ARM) vvi $(ex VVI)"
V=$(grep '^OWNER CHECKS RESULT' <<< "$O" | tail -1)
[ "$V" = "OWNER CHECKS RESULT PASS" ] && res checks-post-access PASS "expect=PASS got=$V" || res checks-post-access FAIL "expect=PASS got=$V; $(grep -E '^CHECK [A-Z0-9]+ (FAIL|UNKNOWN)' <<< "$O" | cut -c1-200 | tr '\n' '|')"

# ------------------------------------------------------------------------------------------ fail-closed cases (console stand-in)
pace
O=$(HX exec fc "$AFP" 2>&1); printf '%s\n' "$O" | L fail-closed "console: fail-closed cases, each reverted"
blk() { awk -v c="$1" '$0 ~ "^---- owner checks from the console stand-in \\(case " c "\\)" {on=1; next} on && /^---- owner checks from the console/ {on=0} on' <<< "$O"; }
B=$(blk pg-superuser)
grep -q '^OWNER CHECKS RESULT BLOCKED' <<< "$B" && grep -q '^CHECK D1 FAIL.*afldb_owner' <<< "$B" && grep -q '^CHECK D4 FAIL.*afldb_owner' <<< "$B" \
  && res fc-pg-superuser PASS "expect=BLOCKED(D1,D4 name afldb_owner) got=$(grep '^OWNER CHECKS RESULT' <<< "$B")" || res fc-pg-superuser FAIL "expect=BLOCKED(D1,D4) got=$(grep -E '^CHECK D[14] |^OWNER CHECKS' <<< "$B" | cut -c1-120 | tr '\n' '|')"
B=$(blk group-writable)
grep -q '^OWNER CHECKS RESULT BLOCKED' <<< "$B" && grep -q '^CHECK E2 FAIL.*/usr/local/lib/afldb-verify' <<< "$B" \
  && res fc-group-writable PASS "expect=BLOCKED(E2 names /usr/local/lib/afldb-verify) got=$(grep '^OWNER CHECKS RESULT' <<< "$B")" || res fc-group-writable FAIL "expect=BLOCKED(E2) got=$(grep -E '^CHECK E2 |^OWNER CHECKS' <<< "$B" | cut -c1-160 | tr '\n' '|')"
B=$(blk no-admin)
grep -q '^OWNER CHECKS RESULT BLOCKED' <<< "$B" && grep -q '^CHECK F5 FAIL.*no authorised key' <<< "$B" && grep -q '^CHECK F1 FAIL.*does not exist' <<< "$B" && grep -q 'R8P FC no-admin-nosuch checks-exit 1' <<< "$O" \
  && res fc-no-admin PASS "expect=BLOCKED(F5 no key; F1 no account) got=both BLOCKED" || res fc-no-admin FAIL "expect=BLOCKED(F1,F5) got=$(grep -E '^CHECK F[15] |^OWNER CHECKS' <<< "$B" | cut -c1-120 | tr '\n' '|')"
B=$(blk control)
grep -qx 'OWNER CHECKS RESULT PASS' <<< "$B" && res control-after-revert PASS "expect=PASS got=OWNER CHECKS RESULT PASS (console session; every mutation reverted)" || res control-after-revert FAIL "expect=PASS got=$(grep -E '^CHECK [A-Z0-9]+ (FAIL|UNKNOWN)|^OWNER CHECKS' <<< "$B" | cut -c1-160 | tr '\n' '|')"

# ------------------------------------------------------------------------------------------ identities and secret hygiene
pace
O=$(cat "$LOGS/$RID"-*.log | HX exec final 2>&1); printf '%s\n' "$O" | L identities "console: id of every identity, fixture-password scan of every log"
n1=$(grep -c "R8P SECRET-SCAN fixture-password-occurrences 0" <<< "$O")
n2=$(cat "$LOGS/$RID"-*.log | grep -c -F -f <(cat "$KD/apw" "$KD/armpw"))
n3=$(cat "$LOGS/$RID"-*.log | grep -c 'PRIVATE KEY')
[ "$n1" = 1 ] && [ "$n2" = 0 ] && [ "$n3" = 0 ] && res no-secrets PASS "expect=0 got=fixture DSN password 0, admin/arm passwords 0, private key blocks 0 in every log" || res no-secrets FAIL "expect=0 got=fixture-scan-ok=$n1 passwords=$n2 private-keys=$n3"

# ------------------------------------------------------------------------------------------ result (cleanup runs on exit)
if [ "$BAD" = 0 ] && [ "$PEND" = 0 ]; then say "R8 PROCEDURE HARNESS RESULT PASS"
else say "R8 PROCEDURE HARNESS RESULT FAIL ($BAD failed, $PEND pending)"; fi
[ "$BAD" = 0 ] && [ "$PEND" = 0 ]
