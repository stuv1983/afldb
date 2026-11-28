#!/usr/bin/env bash
# afldb-gate-accept.sh (R6 r9, review blocker 2; R9-F-1 fix): the owner's WORKSTATION acceptance check for release G0 and R6
# NG-PRE. Read-only: it reads the saved outputs named below, writes nothing but stdout, and contacts no host.
#   bash afldb-gate-accept.sh --gate release-g0|ng-pre \
#     --owner-checks <saved 4.4 output> --reverify <saved 4.5 output> --version <saved 4.6 output> \
#     --verdict <saved wrapper output of the gate call> --verdict-exit <the wrapper's exit status> [--rehearsal [--now <UTC>]]
# GO needs ALL of:
#  (a) owner checks after Phase 4: first line "BOOT-ID <32 hex>" (printed by root in [ADM-ROOT] before the check), one header
#      "== afldb-owner-checks (R6 r8) <ts> host=afldb-prod as uid=0", every CHECK line PASS, each required id present (B1, B2, B3
#      among them), and exactly one "OWNER CHECKS RESULT" line, which is the last line and is exactly "OWNER CHECKS RESULT PASS";
#  (b) both installs re-verified: first line "BOOT-ID <32 hex>", then in this order verify-backup-install.sh (root) ending
#      "BACKUP INSTALL RESULT PASS", the same with --as-arm ending "BACKUP INSTALL RESULT PASS (as arm via setpriv, no login: <id>)"
#      with no sudo/admin/wheel group in <id>, and verify-verify-install.sh --role prod ending "VERIFY-INSTALL RESULT PASS";
#  (c) a wrapper "version" call made after (a) and (b): "OWNER VERDICT VERSION PASS ... host=afldb-prod role=prod nonce=N",
#      bound to the authenticated "AFLDB-VERIFY RESULT VERSION PASS nonce=N host=afldb-prod boot=K ... at=T" line; T is production's
#      clock, as are the (a) and (b) header times. Its bundle equals the one (b) re-verified, and its boot K equals the BOOT-ID of
#      (a) and of (b): that binds the self-printed (a) and (b) to the authenticated production host. release-g0 also needs exactly
#      one off-host "OWNER VERDICT VERSION PASS transport=... host=<H> role=offhost nonce=... qualification=pinned qual-sha256=<Q>"
#      (FIXTURE instead of pinned in a rehearsal); for ng-pre the off-host line is information only. A (c) whose own lines pass is
#      still FAIL when (a) or (b) failed, and says so;
#  (d) the gate verdict made after (c): its last line is "OWNER VERDICT G0 PASS transport=..." (release-g0) or
#      "OWNER VERDICT A2 PASS transport=..." (ng-pre), it is the only line that begins "OWNER VERDICT", the exit status is 0, and
#      the authenticated RESULT line of the same nonce (G0a for G0) has host=afldb-prod, the same at=, boot=K and the (b) bundle.
#      A G0 PASS must name the same off-host endpoint and qualification (offhost=<H> ... qualification=pinned qual-sha256=<Q>).
#      An A2 STOP is NO-GO whatever its backup-origin= says;
#  (e) fresh: the verdict's at= (g0a-at= for G0) is at most 3 h after the newer of (a) and (b), and this check runs at most 1 h
#      after that at=, by this workstation's clock (date -u; a verdict more than 5 min in its future is refused as clock skew).
# Only lines that BEGIN with the expected text count: the wrapper prefixes relayed text "[relayed, neutralised] ". Only the exact
# token "transport=production" (then a space or the end of the line) is production; "production-stub" and the like are refused.
# transport=rehearsal is NO-GO unless --rehearsal is given; with --rehearsal every input must be rehearsal and the final line
# begins "GATE ACCEPT REHEARSAL", which no runbook accepts. --now (a test clock) is refused without --rehearsal.
# An input with a line that begins "[FIXTURE r9]" (the marker of the committed test fixtures) is refused.
# Final line: GATE ACCEPT [REHEARSAL ]<RELEASE-G0|NG-PRE> GO|NO-GO ...   Exit: 0 GO, 1 NO-GO, 2 usage.
set -uo pipefail; export LC_ALL=C
usage() { echo "usage: afldb-gate-accept.sh --gate release-g0|ng-pre --owner-checks F --reverify F --version F --verdict F --verdict-exit N [--rehearsal [--now <YYYY-MM-DDTHH:MM:SSZ>]]"; [ -n "${1:-}" ] && echo "refused: $1"; exit 2; }
OC= RV= VS= VD= VX= GATE= TR=production NOWARG=
while [ $# -gt 0 ]; do case $1 in
  --owner-checks) OC=${2:-}; shift 2 || usage;;  --reverify) RV=${2:-}; shift 2 || usage;;
  --version) VS=${2:-}; shift 2 || usage;;       --verdict) VD=${2:-}; shift 2 || usage;;
  --verdict-exit) VX=${2:-}; shift 2 || usage;;  --gate) GATE=${2:-}; shift 2 || usage;;
  --now) NOWARG=${2:-}; shift 2 || usage;;
  --rehearsal) TR=rehearsal; shift;;             *) usage;; esac; done
case $GATE in release-g0) G=RELEASE-G0; VMODE=g0; VV=G0;; ng-pre) G=NG-PRE; VMODE=a2; VV=A2;; *) usage;; esac
for f in "$OC" "$RV" "$VS" "$VD"; do [ -n "$f" ] && [ -f "$f" ] && [ -r "$f" ] || usage; done
[[ $VX =~ ^[0-9]{1,3}$ ]] || usage
TS='[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z'
if [ -n "$NOWARG" ]; then
  [ "$TR" = rehearsal ] || usage "--now is a test clock, accepted only with --rehearsal; a production evaluation uses this workstation's clock"
  [[ $NOWARG =~ ^$TS$ ]] || usage "--now must be YYYY-MM-DDTHH:MM:SSZ"
  NOW=$NOWARG; CLOCK=test
else NOW=$(date -u +%FT%TZ); CLOCK=workstation; fi
PFX="GATE ACCEPT"; [ "$TR" = rehearsal ] && PFX="GATE ACCEPT REHEARSAL"
# the r9 wrapper names the QUALIFIED off-host endpoint and its qualification: pinned in production, FIXTURE in a rehearsal
QK=pinned; [ "$TR" = rehearsal ] && QK=FIXTURE; OH=; OQ=
MAXEV=10800    # (e) the verdict is at most 3 h after the newer of (a) and (b): 4.4-4.6 immediately before the gate call
MAXCHK=3600    # (e) this check runs at most 1 h after the verdict, by this workstation's clock
SKEW=300       # (e) a verdict more than 5 min ahead of this workstation's clock is refused
BID='^BOOT-ID ([0-9a-f]{32})$'
san() { printf '%s' "$*" | tr -c '\40-\176' '?' | tr '"' "'" | cut -c1-200; }
FAILED=(); WHY=
bad() { echo "ACCEPT $1 FAIL $(san "$2")"; FAILED+=("$1"); [ -n "$WHY" ] || WHY="$1: $(san "$2")"; }
good() { echo "ACCEPT $1 PASS $(san "$2")"; }
failed() { local p; for p in "${FAILED[@]}"; do [ "$p" = "$1" ] && return 0; done; return 1; }
rd() { sed 's/\r$//' -- "$1"; }                       # a saved Windows transcript may carry CRLF line ends
cnt() { grep -cE -- "$1" <<< "$2"; }                  # number of lines matching the anchored ERE $1
lastline() { sed '/^[[:space:]]*$/d' <<< "$1" | tail -n 1; }
lno() { grep -nE -- "$1" <<< "$2" | head -n 1 | cut -d: -f1; }
fixture() { [ "$(cnt '^\[FIXTURE r9\]' "$1")" != 0 ]; }   # a committed test fixture is never evidence
secs() { date -u -d "$1" +%s; }
echo "== afldb-gate-accept $(date -u +%FT%TZ) gate=$GATE transport=$TR (read-only; inputs by sha256)"
for f in "$OC" "$RV" "$VS" "$VD"; do echo "   $(sha256sum < "$f" | cut -c1-64)  $f"; done
[ "$TR" = rehearsal ] && echo "REHEARSAL: these inputs are rehearsal transcripts; whatever the result, it authorises no release and no reboot"
[ "$CLOCK" = test ] && echo "TEST CLOCK: --now $NOW stands in for this workstation's clock (rehearsal only)"
FXMSG="is a committed test fixture (a line begins '[FIXTURE r9]'); fixtures are never evidence"

# (a) owner checks after Phase 4 ----------------------------------------------------------------------------------------
A=$(rd "$OC"); A_TS=; A_BOOT=
HRE="^== afldb-owner-checks \(R6 r8\) ($TS) host=afldb-prod as uid=0$"
if fixture "$A"; then bad owner-checks "the input $FXMSG"
elif [ "$(cnt "$HRE" "$A")" != 1 ]; then bad owner-checks "need exactly one header '== afldb-owner-checks (R6 r8) <ts> host=afldb-prod as uid=0', found $(cnt "$HRE" "$A")"
else
  A_TS=$(grep -E "$HRE" <<< "$A" | sed -E "s/$HRE/\1/")
  NB=$(grep -E '^CHECK ' <<< "$A" | grep -vE '^CHECK [A-Za-z0-9]+ PASS( |$)' | head -n 1)
  MISS=; for id in A1 A0 A2 A3 B1 B2 B3 B4 B5 B6 C1 C2 C2b C3 C4 C5 C6 C7 C8 C9 D0 D1 D2 D3 D4 D5 E0 E1 E2 E3 F1 F2 F3 F4 F5 F6; do
    [ "$(cnt "^CHECK $id PASS( |$)" "$A")" -ge 1 ] || MISS="$MISS $id"; done
  NR=$(cnt '^OWNER CHECKS RESULT' "$A"); L=$(lastline "$A"); L1=$(head -n 1 <<< "$A")
  if [ "$NR" = 1 ] && [[ $L == "OWNER CHECKS RESULT BLOCKED"* ]]; then bad owner-checks "BLOCKED, not PASS (a Phase 3.12 output is pre-Phase-4 evidence): $L"
  elif [ "$NR" != 1 ] || [ "$L" != "OWNER CHECKS RESULT PASS" ]; then bad owner-checks "need exactly one result line, last, exactly 'OWNER CHECKS RESULT PASS'; found $NR, last line '$L'"
  elif [ -n "$NB" ]; then bad owner-checks "a CHECK line is not PASS: $NB"
  elif [ -n "$MISS" ]; then bad owner-checks "no PASS line for:$MISS"
  elif [ "$(lno '^CHECK ' "$A")" -lt "$(lno "$HRE" "$A")" ]; then bad owner-checks "a CHECK line precedes the header"
  elif ! [[ $L1 =~ $BID ]] || [ "$(cnt '^BOOT-ID ' "$A")" != 1 ]; then bad owner-checks "the first line is not the one 'BOOT-ID <32 hex>' line (4.4 is saved with the boot id first): '$L1'"
  else A_BOOT=${BASH_REMATCH[1]}; good owner-checks "post-Phase-4 PASS at $A_TS, boot $A_BOOT (B1, B2, B3 PASS; every CHECK line PASS)"; fi
fi

# (b) both installs re-verified -------------------------------------------------------------------------------------------
B=$(rd "$RV"); B_TS=; B_BUNDLE=; B_BOOT=
H1="^== verify-backup-install ($TS) as uid=0\(root\) "; H2="^== verify-backup-install --as-arm ($TS) as uid=0\(root\) "
H3="^== verify-verify-install ($TS) host=afldb-prod role=prod as root$"
R1='^BACKUP INSTALL RESULT PASS$'; R2='^BACKUP INSTALL RESULT PASS \(as arm via setpriv, no login: [^()]*(\([^()]*\)[^()]*)*\)$'
R3='^VERIFY-INSTALL RESULT PASS$'
n=$(cnt '^BACKUP INSTALL RESULT ' "$B"); m=$(cnt '^VERIFY-INSTALL RESULT ' "$B")
if fixture "$B"; then bad reverify "the input $FXMSG"
elif [ "$(cnt "$H1" "$B")" != 1 ] || [ "$(cnt "$H2" "$B")" != 1 ] || [ "$(cnt "$H3" "$B")" != 1 ]; then
  bad reverify "need each header once: root $(cnt "$H1" "$B"), --as-arm $(cnt "$H2" "$B"), verify-verify-install --role prod $(cnt "$H3" "$B")"
elif [ "$n" != 2 ] || [ "$m" != 1 ] || [ "$(cnt "$R1" "$B")" != 1 ] || [ "$(cnt "$R2" "$B")" != 1 ] || [ "$(cnt "$R3" "$B")" != 1 ]; then
  bad reverify "need exactly: 'BACKUP INSTALL RESULT PASS', 'BACKUP INSTALL RESULT PASS (as arm via setpriv, ...)', 'VERIFY-INSTALL RESULT PASS'; found $n backup and $m verify result lines"
else
  l1=$(lno "$H1" "$B"); l2=$(lno "$R1" "$B"); l3=$(lno "$H2" "$B"); l4=$(lno "$R2" "$B"); l5=$(lno "$H3" "$B"); l6=$(lno "$R3" "$B")
  t1=$(grep -E "$H1" <<< "$B" | sed -E "s/$H1.*/\1/"); t2=$(grep -E "$H2" <<< "$B" | sed -E "s/$H2.*/\1/"); t3=$(grep -E "$H3" <<< "$B" | sed -E "s/$H3/\1/")
  ARMID=$(grep -E "$R2" <<< "$B"); B_TS=$t3     # the order of (c) is judged against these times even when (b) fails
  B_BUNDLE=$(grep -E '^PASS bundle: [0-9]+ files match SHA256SUMS; bundle digest [0-9a-f]{64}$' <<< "$B" | sed -E 's/.* //')
  L1=$(head -n 1 <<< "$B")
  if ! { [ "$l1" -lt "$l2" ] && [ "$l2" -lt "$l3" ] && [ "$l3" -lt "$l4" ] && [ "$l4" -lt "$l5" ] && [ "$l5" -lt "$l6" ]; }; then
    bad reverify "out of order: root check, then --as-arm, then verify-verify-install, each header before its result"
  elif [[ $t2 < $t1 || $t3 < $t2 ]]; then bad reverify "header times out of order: $t1, $t2, $t3"
  elif [[ $ARMID == *"(sudo)"* || $ARMID == *"(admin)"* || $ARMID == *"(wheel)"* ]]; then
    bad reverify "the --as-arm process still carries an admin group, so this was saved before Phase 4: $ARMID"
  elif [ "$(wc -w <<< "$B_BUNDLE")" != 1 ]; then bad reverify "need exactly one 'PASS bundle: ... bundle digest <sha256>' line"
  elif ! [[ $L1 =~ $BID ]] || [ "$(cnt '^BOOT-ID ' "$B")" != 1 ]; then bad reverify "the first line is not the one 'BOOT-ID <32 hex>' line (4.5 is saved with the boot id first): '$L1'"
  else B_BOOT=${BASH_REMATCH[1]}; good reverify "root $t1, --as-arm $t2 (arm has no admin group), verify-install $t3, bundle $B_BUNDLE, boot $B_BOOT"; fi
fi

# common to (c) and (d): one wrapper header of the expected mode and EXACTLY the expected transport token ------------------
whdr() { # name text mode
  local re="^== afldb-verify-call ($TS) mode=$3 transport=([^ ]*)( |$)" t
  if fixture "$2"; then bad "$1" "the input $FXMSG"; return 1; fi
  [ "$(cnt "$re" "$2")" = 1 ] || { bad "$1" "need exactly one wrapper header '== afldb-verify-call <ts> mode=$3', found $(cnt "$re" "$2")"; return 1; }
  t=$(grep -E "$re" <<< "$2" | sed -E "s/$re.*/\2/")
  [ "$t" = "$TR" ] || { bad "$1" "transport=$t, but this evaluation is $TR (only the exact token transport=production is production; a rehearsal is evaluated only with --rehearsal and never accepted for a real gate)"; return 1; }
}

# (c) version check after (a) and (b) ---------------------------------------------------------------------------------------
C=$(rd "$VS"); C_AT=; C_BOOT=
PRE=; failed owner-checks && PRE="owner-checks"; failed reverify && PRE="${PRE:+$PRE,}reverify"
[ -n "$PRE" ] && PRE="[after FAILED $PRE] "
badc() { bad version "$PRE$1"; }
if whdr version "$C" version; then
  PL="^OWNER VERDICT VERSION (PASS|STOP) transport=[^ ]* host=afldb-prod( |$)"
  PP="^OWNER VERDICT VERSION PASS transport=$TR host=afldb-prod role=prod nonce=([0-9a-f]{32})( |$)"
  OL=$(grep -E '^OWNER VERDICT VERSION ' <<< "$C" | grep -vE "$PL")
  ORE="^OWNER VERDICT VERSION PASS transport=$TR host=([A-Za-z0-9.-]+) role=offhost nonce=[0-9a-f]{32} qualification=$QK qual-sha256=([0-9a-f]{64})( |$)"
  [ "$(wc -l <<< "$OL")" = 1 ] && [[ $OL =~ $ORE ]] && { OH=${BASH_REMATCH[1]}; OQ=${BASH_REMATCH[2]}; }
  if [ "$(cnt '^OWNER VERDICT ' "$C")" != "$(cnt '^OWNER VERDICT VERSION ' "$C")" ]; then badc "a non-VERSION verdict line is present"
  elif [ "$(cnt "$PL" "$C")" != 1 ] || [ "$(cnt "$PP" "$C")" != 1 ]; then badc "need exactly one production line 'OWNER VERDICT VERSION PASS transport=$TR host=afldb-prod role=prod nonce=...'; production lines: $(grep -E "$PL" <<< "$C" | head -n 1)"
  else
    N=$(grep -E "$PP" <<< "$C" | sed -E "s/$PP.*/\1/")
    RR="^AFLDB-VERIFY RESULT VERSION PASS nonce=$N host=afldb-prod boot=([0-9a-f]{32}) bundle=([0-9a-f]{64}) at=($TS) exit=0 role=prod$"
    if [ "$(cnt "$RR" "$C")" != 1 ]; then badc "no authenticated 'AFLDB-VERIFY RESULT VERSION PASS nonce=$N host=afldb-prod ...' line"
    else
      RL=$(grep -E "$RR" <<< "$C"); [[ $RL =~ $RR ]]; C_BOOT=${BASH_REMATCH[1]}; CB=${BASH_REMATCH[2]}; C_AT=${BASH_REMATCH[3]}
      if [ -z "$A_TS" ] || [ -z "$B_TS" ]; then badc "cannot be ordered after (a) and (b), which did not pass"
      elif ! [[ $C_AT > $A_TS && $C_AT > $B_TS ]]; then badc "made at $C_AT, not after the owner checks ($A_TS) and the re-verification ($B_TS): a Phase 3 version check is an installation diagnostic"
      elif [ "$CB" != "$B_BUNDLE" ]; then badc "bundle $CB is not the re-verified bundle $B_BUNDLE"
      elif [ -n "$A_BOOT" ] && [ "$C_BOOT" != "$A_BOOT" ]; then badc "production boot $C_BOOT is not the BOOT-ID $A_BOOT of the owner checks (a): (a) is not from this production boot"
      elif [ -n "$B_BOOT" ] && [ "$C_BOOT" != "$B_BOOT" ]; then badc "production boot $C_BOOT is not the BOOT-ID $B_BOOT of the re-verification (b): (b) is not from this production boot"
      elif [ "$GATE" = release-g0 ] && [ -z "$OH" ]; then
        badc "release-g0 needs exactly one off-host 'OWNER VERDICT VERSION PASS ... role=offhost ... qualification=$QK qual-sha256=...'; off-host: ${OL:-none}"
      elif [ -n "$PRE" ]; then badc "its own lines pass (nonce=$N at=$C_AT boot=$C_BOOT), but it is not accepted: (a) or (b) failed"
      else
        [ "$GATE" = ng-pre ] && echo "INFO version off-host line (not an NG-PRE criterion): ${OL:-none}"
        good version "production VERSION PASS nonce=$N at=$C_AT boot=$C_BOOT, after (a) and (b), same boot as both$([ "$GATE" = release-g0 ] && echo "; off-host VERSION PASS from $OH, qual-sha256 $OQ")"
      fi
    fi
  fi
fi

# (d) the gate verdict after (c) ----------------------------------------------------------------------------------------------
D=$(rd "$VD"); D_AT=
if whdr verdict "$D" "$VMODE"; then
  L=$(lastline "$D")
  if [ "$GATE" = release-g0 ]; then RE="^OWNER VERDICT G0 PASS transport=$TR ssh=[^ ]+ .* g0a-nonce=([0-9a-f]{32}) g0a-at=($TS) g0a-boot=([0-9a-f]{32})( |$)"; RK=G0
  else RE="^OWNER VERDICT A2 PASS transport=$TR ssh=[^ ]+ .* nonce=([0-9a-f]{32}) at=($TS) boot=([0-9a-f]{32}) exit=0( |$)"; RK=A2; fi
  if [ "$(cnt '^OWNER VERDICT ' "$D")" != 1 ]; then bad verdict "need exactly one line that begins 'OWNER VERDICT', found $(cnt '^OWNER VERDICT ' "$D")"
  elif ! [[ $L =~ $RE ]]; then
    [[ $L == "OWNER VERDICT A2 STOP"* && $L == *"backup-origin=attributed"* ]] && L="(an A2 STOP; backup-origin=attributed does not satisfy NG-PRE) $L"
    bad verdict "the last line is not 'OWNER VERDICT $VV PASS transport=$TR ...': $L"
  elif [ "$VX" != 0 ]; then bad verdict "the wrapper exited $VX, not 0"
  else
    DN=${BASH_REMATCH[1]}; D_AT=${BASH_REMATCH[2]}; DBOOT=${BASH_REMATCH[3]}
    DR="^AFLDB-VERIFY RESULT $RK PASS nonce=$DN host=afldb-prod boot=$DBOOT bundle=([0-9a-f]{64}) at=$D_AT exit=0( |$)"
    if [ "$(cnt "$DR" "$D")" != 1 ]; then bad verdict "no authenticated 'AFLDB-VERIFY RESULT $RK PASS nonce=$DN host=afldb-prod boot=$DBOOT ... at=$D_AT exit=0' line"
    elif [ -z "$C_AT" ]; then bad verdict "cannot be ordered after (c), which did not pass"
    elif ! [[ $D_AT > $C_AT ]]; then bad verdict "made at $D_AT, not after the version check ($C_AT)"
    elif [ "$DBOOT" != "$C_BOOT" ]; then bad verdict "boot $DBOOT is not the version check's production boot $C_BOOT"
    elif DB=$(grep -E "$DR" <<< "$D" | sed -E "s/^.* bundle=([0-9a-f]{64}) .*$/\1/"); [ "$DB" != "$B_BUNDLE" ]; then bad verdict "bundle $DB is not the re-verified bundle ${B_BUNDLE:-none}"
    elif [ "$GATE" = release-g0 ] && ! [[ -n $OH && $L == *" offhost=$OH "* && $L == *" qualification=$QK qual-sha256=$OQ" ]]; then
      bad verdict "the G0 PASS does not name the off-host endpoint and qualification the version check passed (offhost=${OH:-none} qualification=$QK qual-sha256=${OQ:-none})"
    else good verdict "OWNER VERDICT $VV PASS at=$D_AT boot=$DBOOT, exit 0, after the version check"; fi
  fi
fi

# (e) fresh: the verdict close to (a)/(b), and this check close to the verdict ------------------------------------------------
if [ -n "$D_AT" ]; then
  E=$A_TS; [[ -n $B_TS && ( -z $E || $B_TS > $E ) ]] && E=$B_TS
  DS=$(secs "$D_AT"); NS=$(secs "$NOW")
  if [ -z "$E" ]; then bad fresh "no (a) or (b) time to measure the verdict against"
  elif (( DS - $(secs "$E") > MAXEV )); then bad fresh "the verdict at $D_AT is more than $((MAXEV / 3600)) h after the newer Phase 4 evidence ($E): repeat 4.4-4.6 immediately before the gate call"
  elif (( NS - DS > MAXCHK )); then bad fresh "checked at $NOW ($CLOCK clock), more than $((MAXCHK / 3600)) h after the verdict at $D_AT: repeat 4.4-4.6 and the gate call"
  elif (( DS - NS > SKEW )); then bad fresh "the verdict at $D_AT is more than $((SKEW / 60)) min ahead of the $CLOCK clock ($NOW): check this workstation's clock"
  else good fresh "verdict $D_AT is $(( (DS - $(secs "$E")) / 60 )) min after the Phase 4 evidence ($E); checked $(( (NS - DS) / 60 )) min later at $NOW ($CLOCK clock)"; fi
fi

if [ ${#FAILED[@]} = 0 ]; then
  echo "$PFX $G GO transport=$TR boot=$C_BOOT owner-checks-at=$A_TS reverify-at=$B_TS version-at=$C_AT verdict-at=$D_AT checked-at=$NOW clock=$CLOCK"; exit 0
fi
echo "$PFX $G NO-GO failed=$(IFS=,; echo "${FAILED[*]}") reason=\"$WHY\""; exit 1
