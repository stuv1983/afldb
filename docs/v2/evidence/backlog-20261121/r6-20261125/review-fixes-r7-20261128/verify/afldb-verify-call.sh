#!/usr/bin/env bash
# afldb-verify-call.sh (R6 r7, MED-2): Stu's WORKSTATION entry point to the owner verifier (Git Bash). It never logs in as arm.
#   bash afldb-verify-call.sh g0 <YYYY-MM-DD>
#   bash afldb-verify-call.sh a2 accepted <CURRENT_ID> <r3:yes|no> <r4:yes|no> <10:00|14:00> <tue:released|tue:rolledback|tue:deferred> <inv:32hex>
#   bash afldb-verify-call.sh version
#   rehearsal only: bash afldb-verify-call.sh --rehearsal <ssh-config> --key <private key> <g0|a2|version> ...
# For each call it generates a fresh 32-hex nonce, connects as afldb-verify with ONLY the verify key (IdentitiesOnly, no agent,
# BatchMode, StrictHostKeyChecking=yes, -F none in production so no ssh_config alias or ProxyCommand applies; the production address
# is taken from `ssh -G afldb`, the host key from Stu's known_hosts), and accepts the answer only when ALL hold:
#   exactly one line starts "AFLDB-VERIFY RESULT ", and it is the last line; its mode is the one requested; its nonce is this call's;
#   its bundle digest is the PINNED one below; its host is the expected host name; its at= is within 300 s of this workstation's
#   clock; its exit= equals the ssh exit status; PASS if and only if exit 0; and every argument field equals the request.
# Anything else is STOP (stale, replayed, mismatched, refused, unreachable). Prints the gate output, then one line:
#   OWNER VERDICT <G0|A2|VERSION> <PASS|STOP> transport=<production|rehearsal> ... [reason=...]
# g0 runs G0a (production) and then, only if G0a is an authenticated PASS, G0b (streamanator) with the dump and sha256 taken ONLY
# from the authenticated G0a RESULT line. NG-PRE consumes only "OWNER VERDICT A2 PASS"; release G0 only "OWNER VERDICT G0 PASS".
# What a verdict establishes (r8, R8 DEPENDENCIES.md; printed as one SCOPE line before each A2/G0 verdict):
#   OWNER VERDICT A2 PASS: the pinned root-owned verifier on the authenticated production host, at at=, found every A-2 check passing
#     for THESE seven arguments (the live host matched them). It does NOT establish that the arguments are right: they come from the
#     Tuesday record, printed by arm-run scripts over arm's login. Lines marked ARM-PRODUCED report data arm's processes wrote (an
#     authentic reading of arm's data, not an independent fact). backup-origin=attributed alone rests on root/PID 1 evidence only.
#   OWNER VERDICT G0 PASS: the sealed timer run (root seal, PID 1) produced the named dump with this sha256, and streamanator holds a
#     copy with those bytes (re-hashed by root) after a root cron dispatch at 03:10; the lines linking that dispatch to the copy (the
#     pull log) are ARM-PRODUCED.
#   A verdict is authentic (G2: this call's nonce, the pinned bundle, the host key, at= within 300 s, exit = ssh status) only while
#   root on both hosts is independent of arm (F1, an owner action); authentic is not the same as "every input is true".
# Exit: 0 PASS, 1 STOP, 2 usage. version: 0 only when BOTH hosts answer PASS (r8; r7 exited 0 even when a host answered STOP).
set -uo pipefail; export LC_ALL=C
BUNDLE_SHA=58fceba650dcd25ede0e55b25bfcb8a8236c3a4fe6ae6ebd94535832bbd506c8     # sha256 of verify/bundle/SHA256SUMS (= the installed /usr/local/lib/afldb-verify/SHA256SUMS); build-sums.sh sets it
PROD_NAME=afldb-prod; OFF_NAME=streamanator; OFF_ADDR=10.0.40.100; PROD_ALIAS=afldb
SSHBIN=${AFLDB_VERIFY_SSH:-C:/Windows/System32/OpenSSH/ssh.exe}
KEY=$HOME/.ssh/afldb_verify; TRANSPORT=production; CFG=
usage() { echo "usage: afldb-verify-call.sh [--rehearsal <ssh-config> --key <key>] g0 <date> | a2 accepted <CURRENT_ID> <r3:..> <r4:..> <10:00|14:00> <tue:..> <inv:..> | version"; exit 2; }
while :; do case ${1:-} in
  --rehearsal) CFG=${2:-}; TRANSPORT=rehearsal; shift 2 || usage;;
  --key) [ "$TRANSPORT" = rehearsal ] || usage; KEY=${2:-}; shift 2 || usage;;
  *) break;; esac; done
[[ $BUNDLE_SHA =~ ^[0-9a-f]{64}$ ]] || { echo "STOP the wrapper has no pinned bundle digest (run build-sums.sh)"; exit 2; }
[ -r "$KEY" ] || { echo "STOP no verify key at $KEY"; exit 2; }
OPTS=(-o BatchMode=yes -o IdentitiesOnly=yes -o "IdentityFile=$KEY" -o IdentityAgent=none -o StrictHostKeyChecking=yes
      -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no -o PubkeyAuthentication=yes -o ForwardAgent=no
      -o ForwardX11=no -o ClearAllForwardings=yes -o RequestTTY=no -o ConnectTimeout=30 -o ServerAliveInterval=30 -T)
if [ "$TRANSPORT" = rehearsal ]; then
  [ -r "$CFG" ] || usage
  OPTS=(-F "$CFG" "${OPTS[@]}"); PROD_T=r7v-prod; OFF_T=r7v-offhost
else
  PIP=$("$SSHBIN" -G "$PROD_ALIAS" 2>/dev/null | sed -n 's/^hostname //p' | tr -d '\r')
  [[ $PIP =~ ^[0-9.]{7,15}$|^[A-Za-z0-9.-]{1,253}$ ]] || { echo "STOP cannot resolve the production address from ssh -G $PROD_ALIAS"; exit 2; }
  OPTS=(-F none "${OPTS[@]}"); PROD_T=afldb-verify@$PIP; OFF_T=afldb-verify@$OFF_ADDR
fi
nonce() { od -An -N16 -tx1 /dev/urandom | tr -d ' \n'; }

# show <relayed text> (review round 1, F2): prints what the host sent so that nothing in it can draw on Stu's terminal or pass for a
# verdict. Every byte outside printable ASCII (ESC, CR, every other control byte, every byte >= 0x80) becomes '?'. Every line that
# contains "OWNER VERDICT" or "AFLDB-VERIFY RESULT" is prefixed "[relayed, neutralised] ", except the last non-empty line when it
# begins "AFLDB-VERIFY RESULT " (the line call() authenticates). The wrapper's own OWNER VERDICT line is printed after this, so a
# transcript has exactly one line that begins "OWNER VERDICT" per verdict. Authentication below reads the unmodified answer.
show() {
  local i last=-1; local -a SL
  mapfile -t SL < <(printf '%s\n' "$1" | tr -c '\n\40-\176' '?')
  for i in "${!SL[@]}"; do [ -n "${SL[i]}" ] && last=$i; done
  for i in "${!SL[@]}"; do
    if [[ ${SL[i]} == *"OWNER VERDICT"* || ${SL[i]} == *"AFLDB-VERIFY RESULT"* ]] && ! { [ "$i" = "$last" ] && [[ ${SL[i]} == "AFLDB-VERIFY RESULT "* ]]; }; then
      printf '[relayed, neutralised] %s\n' "${SL[i]}"
    else printf '%s\n' "${SL[i]}"; fi
  done
}

# call <target> <MODE> <expected host> <command words...>: runs one verifier call; sets V_LINE, V_RC, V_WHY, and V[] (RESULT fields).
declare -A V
call() {
  local target=$1 mode=$2 ehost=$3 n out err rc line re now at kv k; shift 3
  n=$(nonce); V=(); V_WHY=; V_LINE=
  [[ $n =~ ^[0-9a-f]{32}$ ]] || { V_WHY="no nonce"; V_RC=1; return 1; }
  err=$(mktemp); out=$("$SSHBIN" "${OPTS[@]}" "$target" "$* $n" 2> "$err"); rc=$?
  out=${out//$'\r'/}
  show "$out"
  [ -s "$err" ] && tr -d '\r' < "$err" | tr -c '\n\40-\176' '?' | sed 's/^/[ssh stderr] /'; rm -f "$err"
  V_RC=$rc; V[nonce]=$n
  [ "$(grep -c '^AFLDB-VERIFY RESULT ' <<< "$out")" = 1 ] || { V_WHY="$(grep -c '^AFLDB-VERIFY RESULT ' <<< "$out") RESULT lines (need exactly 1; ssh exit $rc)"; return 1; }
  line=$(printf '%s\n' "$out" | sed '/^$/d' | tail -n 1); V_LINE=$line
  [[ $line == "AFLDB-VERIFY RESULT "* ]] || { V_WHY="the RESULT line is not the last line"; return 1; }
  re='^AFLDB-VERIFY RESULT (G0|A2|G0B|VERSION) (PASS|STOP) nonce=([0-9a-f]{32}) host=([A-Za-z0-9.-]+) boot=([0-9a-f]{32}|none) bundle=([0-9a-f]{64}|none) at=([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z) exit=([0-9]{1,3})(( [a-z0-9-]+=[A-Za-z0-9:._-]+)*)$'
  [[ $line =~ $re ]] || { V_WHY="the RESULT line is malformed"; return 1; }
  V[mode]=${BASH_REMATCH[1]}; V[verdict]=${BASH_REMATCH[2]}; V[rnonce]=${BASH_REMATCH[3]}; V[host]=${BASH_REMATCH[4]}; V[boot]=${BASH_REMATCH[5]}
  V[bundle]=${BASH_REMATCH[6]}; V[at]=${BASH_REMATCH[7]}; V[exit]=${BASH_REMATCH[8]}
  for kv in ${BASH_REMATCH[9]}; do k=${kv%%=*}; V[f.$k]=${kv#*=}; done
  [ "${V[mode]}" = "$mode" ] || { V_WHY="mode ${V[mode]}, requested $mode"; return 1; }
  [ "${V[rnonce]}" = "$n" ] || { V_WHY="nonce ${V[rnonce]} is not this call's $n (replayed or crossed answer)"; return 1; }
  [ "${V[bundle]}" = "$BUNDLE_SHA" ] || { V_WHY="bundle ${V[bundle]} is not the pinned $BUNDLE_SHA"; return 1; }
  [ "${V[host]}" = "$ehost" ] || { V_WHY="host ${V[host]}, expected $ehost"; return 1; }
  now=$(date -u +%s); at=$(date -u -d "${V[at]}" +%s 2>/dev/null) || { V_WHY="unparsable at=${V[at]}"; return 1; }
  (( at - now <= 300 && now - at <= 300 )) || { V_WHY="stale: at=${V[at]} is $((now - at)) s from this workstation's clock (limit 300)"; return 1; }
  [ "${V[exit]}" = "$rc" ] || { V_WHY="RESULT exit=${V[exit]} but ssh exit status $rc"; return 1; }
  { [ "${V[verdict]}" = PASS ] && [ "$rc" = 0 ]; } || { [ "${V[verdict]}" = STOP ] && [ "$rc" != 0 ]; } || { V_WHY="verdict ${V[verdict]} with exit $rc"; return 1; }
  return 0
}
# argfields <name=value>...: every listed RESULT field must equal the request.
argfields() { local kv; for kv in "$@"; do [ "${V[f.${kv%%=*}]:-}" = "${kv#*=}" ] || { V_WHY="RESULT ${kv%%=*}=${V[f.${kv%%=*}]:-} differs from the request (${kv#*=})"; return 1; }; done; }
verdict() { # MODE PASS|STOP fields...
  local m=$1 v=$2; shift 2
  echo "OWNER VERDICT $m $v transport=$TRANSPORT ssh=${SSHBIN##*/} $*"
  [ "$v" = PASS ] && exit 0; exit 1
}

MODE=${1:-}; shift || usage
echo "== afldb-verify-call $(date -u +%FT%TZ) mode=$MODE transport=$TRANSPORT pinned-bundle=$BUNDLE_SHA key=$KEY"
case $MODE in
  g0)
    [ $# = 1 ] && [[ $1 =~ ^2026-11-2[4-9]$ ]] || usage; D=$1
    echo "-- G0a: production, g0 $D"
    if ! call "$PROD_T" G0 "$PROD_NAME" g0 "$D" || ! argfields "date=$D"; then verdict G0 STOP "date=$D step=G0a nonce=${V[nonce]:-} reason=\"$V_WHY\""; fi
    A_N=${V[nonce]}; A_AT=${V[at]}; A_BOOT=${V[boot]}
    [ "${V[verdict]}" = PASS ] || verdict G0 STOP "date=$D step=G0a nonce=$A_N at=$A_AT exit=${V[exit]} reason=\"the production verifier answered STOP\""
    DUMP=${V[f.dump]:-}; SHA=${V[f.sha256]:-}; INV=${V[f.invocation]:-}; DISP=${V[f.dispatch]:-}
    [[ $DUMP =~ ^afldb_prod-${D//-/}-02[0-9]{4}\.dump$ && $SHA =~ ^[0-9a-f]{64}$ && $INV =~ ^[0-9a-f]{32}$ && $DISP =~ ^(scheduled|catch-up)$ ]] \
      || verdict G0 STOP "date=$D step=G0a nonce=$A_N reason=\"the authenticated G0a PASS carries no valid dump/sha256/invocation/dispatch\""
    echo "-- G0b: streamanator, g0b $D $DUMP $SHA (values from the authenticated G0a RESULT line only)"
    if ! call "$OFF_T" G0B "$OFF_NAME" g0b "$D" "$DUMP" "$SHA" || ! argfields "date=$D" "dump=$DUMP" "sha256=$SHA"; then
      verdict G0 STOP "date=$D step=G0b g0a-nonce=$A_N g0b-nonce=${V[nonce]:-} dump=$DUMP sha256=$SHA reason=\"$V_WHY\""; fi
    [ "${V[verdict]}" = PASS ] || verdict G0 STOP "date=$D step=G0b g0a-nonce=$A_N g0b-nonce=${V[nonce]} exit=${V[exit]} dump=$DUMP sha256=$SHA reason=\"the off-host verifier answered STOP\""
    echo "G0 SCOPE: a PASS establishes that the sealed timer run (root seal, PID 1) produced $DUMP with sha256 $SHA on production and that streamanator holds a root-re-hashed copy with those bytes after a root cron dispatch; the pull-log lines linking dispatch and copy are ARM-PRODUCED"
    verdict G0 PASS "date=$D invocation=$INV dump=$DUMP sha256=$SHA dispatch=$DISP g0a-nonce=$A_N g0a-at=$A_AT g0a-boot=$A_BOOT g0b-nonce=${V[nonce]} g0b-at=${V[at]}";;
  a2)
    [ $# = 7 ] && [ "$1" = accepted ] && [[ $2 =~ ^[0-9a-f]{12}-[A-Za-z0-9_-]{1,64}$ && $3 =~ ^r3:(yes|no)$ && $4 =~ ^r4:(yes|no)$ \
      && $5 =~ ^(10:00|14:00)$ && $6 =~ ^tue:(released|rolledback|deferred)$ && $7 =~ ^inv:[0-9a-f]{32}$ ]] || usage
    if ! call "$PROD_T" A2 "$PROD_NAME" a2 "$@" || ! argfields "outcome=$1" "current=$2" "r3=$3" "r4=$4" "window=$5" "tue=$6" "inv=${7#inv:}"; then
      verdict A2 STOP "current=$2 tue=$6 inv=${7#inv:} window=$5 nonce=${V[nonce]:-} reason=\"$V_WHY\""; fi
    echo "A2 SCOPE: a PASS establishes that the live production host matched these seven arguments ($*) at at=${V[at]}; the arguments themselves come from the Tuesday record, printed by arm-run scripts over arm's login, and nothing here checks them; ARM-PRODUCED lines are arm's data read authentically; backup-origin=${V[f.backup-origin]:-none} rests on root and PID 1 evidence only"
    verdict A2 "${V[verdict]}" "current=$2 tue=$6 inv=${7#inv:} window=$5 day=${V[f.day]:-none} backup-origin=${V[f.backup-origin]:-none} nonce=${V[nonce]} at=${V[at]} boot=${V[boot]} exit=${V[exit]}";;
  version)
    [ $# = 0 ] || usage
    VSTOP=0
    for t in "$PROD_T:$PROD_NAME:prod" "$OFF_T:$OFF_NAME:offhost"; do
      IFS=: read -r tt hn rl <<< "$t"
      if call "$tt" VERSION "$hn" version && argfields "role=$rl" && { [ "${V[verdict]}" = PASS ] || { V_WHY="the verifier answered VERSION STOP"; false; }; }; then echo "OWNER VERDICT VERSION PASS transport=$TRANSPORT host=$hn role=$rl nonce=${V[nonce]}"
      else echo "OWNER VERDICT VERSION STOP transport=$TRANSPORT host=$hn reason=\"$V_WHY\""; VSTOP=1; fi
    done
    [ "$VSTOP" = 0 ] && exit 0; exit 1;;
  *) usage;;
esac
