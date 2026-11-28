#!/usr/bin/env bash
# afldb-verify-call.sh (R6 r7, MED-2; r9 off-host qualification): Stu's WORKSTATION entry point to the owner verifier (Git Bash). It
# never logs in as arm.
#   bash afldb-verify-call.sh g0 <YYYY-MM-DD>
#   bash afldb-verify-call.sh a2 accepted <CURRENT_ID> <r3:yes|no> <r4:yes|no> <10:00|14:00> <tue:released|tue:rolledback|tue:deferred> <inv:32hex>
#   bash afldb-verify-call.sh version
#   rehearsal only: bash afldb-verify-call.sh --rehearsal <ssh-config> --key <private key> [--qualification-fixture <file>] <g0|a2|version> ...
# For each call it generates a fresh 32-hex nonce, connects as afldb-verify with ONLY the verify key (IdentitiesOnly, no agent,
# BatchMode, StrictHostKeyChecking=yes, -F none in production so no ssh_config alias or ProxyCommand applies; the production address
# is taken from `ssh -G afldb`, the host key from Stu's known_hosts), and accepts the answer only when ALL hold:
#   exactly one line starts "AFLDB-VERIFY RESULT ", and it is the last line; its mode is the one requested; its nonce is this call's;
#   its bundle digest is the PINNED one below; its host is the expected host name; its at= is within 300 s of this workstation's
#   clock; its exit= equals the ssh exit status; PASS if and only if exit 0; and every argument field equals the request.
# Anything else is STOP (stale, replayed, mismatched, refused, unreachable). Prints the gate output, then one line:
#   OWNER VERDICT <G0|A2|VERSION> <PASS|STOP> transport=<production|rehearsal> ... [reason=...]
# g0 runs G0a (production) and then, only if G0a is an authenticated PASS, G0b (the off-host endpoint) with the dump and sha256 taken
# ONLY from the authenticated G0a RESULT line. NG-PRE consumes only "OWNER VERDICT A2 PASS"; release G0 only "OWNER VERDICT G0 PASS".
#
# r9 (Astra blocker 1): OFF-HOST QUALIFICATION, FAIL-CLOSED. By default NO off-host endpoint is qualified, and G0 cannot PASS.
#   * The qualified endpoint is named only by the owner's pin QUALIFIED-ENDPOINT in ../../review-fixes-r9-20261128/offhost/, located
#     relative to THIS file's own directory (so it resolves in the owner's clone and in a `git archive` export that keeps repository
#     paths and includes that directory; an export of verify/ alone has no pin, and G0 STOPs). It is absent in the repository; the
#     owner creates it by QUALIFY-OFFHOST.md. Format (LF only, key=value, each key once, '#' comments): format=afldb-offhost-
#     qualification-v1, host= (the RESULT host=), address= (IPv4 or DNS name), hostkey=SHA256:<43 base64> (ssh-keygen -lf form),
#     record-file=records/<name> (the owner's qualification record, relative to the pin's directory), record-sha256=<64 hex> (that
#     file's sha256; the wrapper re-hashes it), qualified-on=YYYY-MM-DD. The pin's own sha256 is printed in every G0 and VERSION
#     verdict (qual-sha256=), with qualification=none|pinned|FIXTURE|refused.
#   * REFUSED: a pin whose host or address is streamanator or 10.0.40.100, or whose host key is one the owner's known_hosts records
#     for either: streamanator's arm is in sudo, docker and lxd, so it is root-equivalent there (recorded 28 Nov 2026, R8
#     OWNER-PROCEDURE §8) and can forge G0B PASS. Re-qualifying streamanator needs a reviewed change of DENY_RE below. Also refused:
#     a pin naming production itself.
#   * Before a qualified call the pinned fingerprint must be among the owner's known_hosts keys for the address (ssh -G's
#     UserKnownHostsFile list), and ssh is then given a known_hosts holding ONLY the matching line(s): no other key is accepted.
#   * Without a qualified endpoint, g0 still asks the legacy endpoint (streamanator) and prints its answer with every line prefixed
#     "[unqualified endpoint, information only] "; the verdict is OWNER VERDICT G0 STOP ... reason="no qualified off-host endpoint
#     ..." even when that answer is an authenticated, fully matching PASS. version prints the production line (independent) and an
#     off-host OWNER VERDICT VERSION STOP ... reason="no qualified off-host endpoint", and exits 1.
#   * SCHEDULED-TRANSFER EVIDENCE: even from a qualified endpoint, G0B PASS counts only when its RESULT line carries dispatch-at= (the
#     root cron journal time of the 03:10 dispatch), complete-at= (the END of the invocation linked to it), received-at= and
#     received-sha256= (that invocation's VERIFIED record) and rehash-sha256= (root's check-time re-hash), each present, both sha256
#     fields equal to G0a's, dispatch-at inside [D 03:10, +60 s), received-at >= dispatch-at - 5 s (the core's journal-receipt
#     tolerance), received-at <= complete-at <= D 03:10 + 2100 s and <= the RESULT at=. A matching file without the dispatch or the
#     completion is POSSESSION ONLY, and G0 STOPs saying so.
#   * --qualification-fixture <file> (format=afldb-offhost-qualification-fixture-v1, plus rehearsal-utc-offset=<s>, the rehearsal
#     container's fixed Melbourne offset) is accepted ONLY with --rehearsal, and labels every verdict qualification=FIXTURE:
#     simulated independence is fixture evidence, never owner evidence. Production transport refuses the flag (exit 2). A rehearsal
#     never reads the repository pin.
#   * AFLDB_VERIFY_SSH (a test hook that replaces the ssh client) on production transport labels the header and every verdict
#     transport=production-stub and prints a STUB WARNING line first (R9-F-3). transport=production appears only when the variable is
#     unset, i.e. with the default client C:/Windows/System32/OpenSSH/ssh.exe; a stubbed answer is never a production verdict.
# r10 (Astra cases 1-3):
#   * RECEIPT: received-at/received-sha256 now come only from the off-host invocation's RECEIVED record and per-dump RECEIPT (the
#     invocation transferred the file itself, in full, verified it and ended rc=0); a copy it merely HELD is possession only.
#   * CANDIDATE mode (candidate-g0, candidate-version; see cand_load) collects qualification evidence from an UNPINNED endpoint before
#     any pin exists: one final "CANDIDATE EVIDENCE ..." line, exit 3 or 1, never an OWNER VERDICT line and never exit 0.
#   * A rehearsal without --qualification-fixture reads the repository pin location too, but only in the FIXTURE format; production
#     refuses that format there. So a fixture can never qualify a production call, and a rehearsal can exercise the pin's location.
#   * Production verdict lines show the RESULT's access-epoch= (A2, VERSION prod; G0 as g0a-access-epoch=), for the owner to read; the
#     acceptance check reads it from the authenticated RESULT lines.
# What a verdict establishes (r8, R8 DEPENDENCIES.md; printed as one SCOPE line before each A2/G0 verdict):
#   OWNER VERDICT A2 PASS: the pinned root-owned verifier on the authenticated production host, at at=, found every A-2 check passing
#     for THESE seven arguments (the live host matched them). It does NOT establish that the arguments are right: they come from the
#     Tuesday record, printed by arm-run scripts over arm's login. Lines marked ARM-PRODUCED report data arm's processes wrote (an
#     authentic reading of arm's data, not an independent fact). backup-origin=attributed alone rests on root/PID 1 evidence only.
#   OWNER VERDICT G0 PASS (r9): the sealed timer run (root seal, PID 1) produced the named dump with this sha256, and the QUALIFIED
#     off-host endpoint's root-owned verifier reports a 03:10 root cron dispatch linked to a transfer that received and verified those
#     bytes and completed in time, plus a root re-hash at check time; the pull-log lines linking them are written by the off-host pull
#     account. Its independence rests on the owner's qualification record.
#   A verdict is authentic (G2: this call's nonce, the pinned bundle, the host key, at= within 300 s, exit = ssh status) only while
#   root on both hosts is independent of arm (F1, an owner action); authentic is not the same as "every input is true".
# Exit: 0 PASS, 1 STOP, 2 usage. version: 0 only when BOTH lines are PASS (r8; r7 exited 0 even when a host answered STOP).
set -uo pipefail; export LC_ALL=C
BUNDLE_SHA=059f2ad445825757873d77b8329fd6be668d2da6bf5e816d599b55b396f20cba     # sha256 of verify/bundle/SHA256SUMS (= the installed /usr/local/lib/afldb-verify/SHA256SUMS); build-sums.sh sets it
PROD_NAME=afldb-prod; PROD_ALIAS=afldb
# r9: the legacy off-host endpoint, asked for INFORMATION ONLY when no endpoint is qualified; it can never give a G0 PASS (DENY_RE).
INFO_NAME=streamanator; INFO_ADDR=10.0.40.100
DENY_RE='^(streamanator(\..*)?|10\.0\.40\.100)$'
DENY_WHY="streamanator (10.0.40.100) cannot be qualified: its arm is in sudo, docker and lxd, so it is root-equivalent there (recorded 28 Nov 2026, R8 OWNER-PROCEDURE 8); re-qualifying it needs a reviewed wrapper change"
QPIN_REL=../../review-fixes-r9-20261128/offhost/QUALIFIED-ENDPOINT
AEDT=39600   # Australia/Melbourne's UTC offset (s) on every date g0 accepts (2026-11-24..29 are AEDT); Git Bash has no zoneinfo
SSHBIN=${AFLDB_VERIFY_SSH:-C:/Windows/System32/OpenSSH/ssh.exe}
KEYGEN=ssh-keygen
KEY=$HOME/.ssh/afldb_verify; TRANSPORT=production; CFG=; QFIX=
usage() { echo "usage: afldb-verify-call.sh [--rehearsal <ssh-config> --key <key> [--qualification-fixture <file>]] g0 <date> | a2 accepted <CURRENT_ID> <r3:..> <r4:..> <10:00|14:00> <tue:..> <inv:..> | version | candidate-g0 <date> --host H --address A --hostkey SHA256:.. [--utc-offset S] | candidate-version --host H --address A --hostkey SHA256:.."; exit 2; }
while :; do case ${1:-} in
  --rehearsal) CFG=${2:-}; TRANSPORT=rehearsal; shift 2 || usage;;
  --key) [ "$TRANSPORT" = rehearsal ] || usage; KEY=${2:-}; shift 2 || usage;;
  --qualification-fixture) QFIX=${2:-}; shift 2 || usage; [ -n "$QFIX" ] || usage;;
  *) break;; esac; done
# r9 (independent review R9-F-3): AFLDB_VERIFY_SSH replaces the ssh client (a test hook). On production transport its verdicts are
# labelled transport=production-stub, never transport=production, so a stub's answer can never pass for a production verdict.
# transport=production is printed only with the default client C:/Windows/System32/OpenSSH/ssh.exe.
if [ -n "${AFLDB_VERIFY_SSH:-}" ] && [ "$TRANSPORT" = production ]; then
  TRANSPORT=production-stub
  echo "STUB WARNING: AFLDB_VERIFY_SSH=$AFLDB_VERIFY_SSH replaces the ssh client; every verdict below is transport=production-stub and is NOT a production verdict (unset AFLDB_VERIFY_SSH for a real call)"
fi
if [ -n "$QFIX" ] && [ "$TRANSPORT" != rehearsal ]; then
  echo "STOP --qualification-fixture is accepted with --rehearsal only: production transport never takes a fixture qualification (simulated independence is not owner evidence)"; exit 2; fi
[[ $BUNDLE_SHA =~ ^[0-9a-f]{64}$ ]] || { echo "STOP the wrapper has no pinned bundle digest (run build-sums.sh)"; exit 2; }
[ -r "$KEY" ] || { echo "STOP no verify key at $KEY"; exit 2; }
SELF_DIR=$(cd "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P) || { echo "STOP cannot locate the wrapper's own directory"; exit 2; }
QPIN=$SELF_DIR/$QPIN_REL
TMPS=(); trap 'rm -f "${TMPS[@]}"' EXIT
OPTS=(-o BatchMode=yes -o IdentitiesOnly=yes -o "IdentityFile=$KEY" -o IdentityAgent=none -o StrictHostKeyChecking=yes
      -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no -o PubkeyAuthentication=yes -o ForwardAgent=no
      -o ForwardX11=no -o ClearAllForwardings=yes -o RequestTTY=no -o ConnectTimeout=30 -o ServerAliveInterval=30 -T)
if [ "$TRANSPORT" = rehearsal ]; then
  [ -r "$CFG" ] || usage
  OPTS=(-F "$CFG" "${OPTS[@]}"); GOPT=(-F "$CFG"); PROD_T=r7v-prod; PROD_ADDR=r7v-prod; INFO_T=r7v-offhost; INFO_NAME=r7v-offhost; QT_PFX=
else
  PIP=$("$SSHBIN" -G "$PROD_ALIAS" 2>/dev/null | sed -n 's/^hostname //p' | tr -d '\r')
  [[ $PIP =~ ^[0-9.]{7,15}$|^[A-Za-z0-9.-]{1,253}$ ]] || { echo "STOP cannot resolve the production address from ssh -G $PROD_ALIAS"; exit 2; }
  OPTS=(-F none "${OPTS[@]}"); GOPT=(-F none); PROD_T=afldb-verify@$PIP; PROD_ADDR=$PIP; INFO_T=afldb-verify@$INFO_ADDR; QT_PFX=afldb-verify@
fi
nonce() { od -An -N16 -tx1 /dev/urandom | tr -d ' \n'; }
upath() { if command -v cygpath > /dev/null 2>&1; then cygpath -u -- "$1"; else printf '%s' "$1"; fi; }
mpath() { if command -v cygpath > /dev/null 2>&1; then cygpath -m -- "$1"; else printf '%s' "$1"; fi; }
iso() { date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ; }

# ---- r9: the qualification pin (or, in rehearsal, the fixture). Sets Q_RC (0 accepted or none, 1 refused), Q_KIND, Q_SHA, Q_WHY,
# Q_HOST, Q_ADDR, Q_HK, Q_RECSHA, Q_OFF, Q_T.
declare -A P=()
# qual_endpoint: the endpoint checks shared by a pin, a fixture and a candidate (P[host], P[address], P[hostkey]); sets Q_WHY.
qual_endpoint() {
  [[ ${P[host]} =~ ^[A-Za-z0-9.-]{1,64}$ ]] || { Q_WHY="host= is not a host name"; return 1; }
  [[ ${P[address]} =~ ^[A-Za-z0-9.-]{1,253}$ ]] || { Q_WHY="address= is not an address or DNS name"; return 1; }
  [[ ${P[hostkey]} =~ ^SHA256:[A-Za-z0-9+/]{43}$ ]] || { Q_WHY="hostkey= is not a SHA256:<43 base64> fingerprint"; return 1; }
  if [[ ${P[host],,} =~ $DENY_RE || ${P[address],,} =~ $DENY_RE ]]; then Q_WHY="refused: $DENY_WHY"; return 1; fi
  if [ "${P[host]}" = "$PROD_NAME" ] || [ "${P[address],,}" = "${PROD_ADDR,,}" ] || [ "${P[address],,}" = "$PROD_ALIAS" ]; then
    Q_WHY="refused: the off-host endpoint must not be production itself"; return 1; fi
}
qual_load() {
  local f want k v line rf; P=()
  Q_KIND=none; Q_SHA=none; Q_WHY=; Q_HOST=; Q_ADDR=; Q_HK=; Q_RECSHA=none; Q_OFF=$AEDT; Q_T=
  if [ "$TRANSPORT" = rehearsal ]; then
    # r10: a rehearsal reads --qualification-fixture, or else the SAME pin location as production (so a rehearsal of the
    # candidate -> record -> pin commit -> export sequence exercises the real location), but accepts only the FIXTURE format there.
    if [ -n "$QFIX" ]; then f=$QFIX; else [ -e "$QPIN" ] || [ -L "$QPIN" ] || return 0; f=$QPIN; fi
    want=afldb-offhost-qualification-fixture-v1
  else
    [ -e "$QPIN" ] || [ -L "$QPIN" ] || return 0; f=$QPIN; want=afldb-offhost-qualification-v1
  fi
  Q_KIND=refused
  [ -f "$f" ] && [ ! -L "$f" ] && [ -r "$f" ] || { Q_WHY="the qualification file $f is not a readable regular file"; return 1; }
  Q_SHA=$(sha256sum < "$f" | cut -c1-64)
  [ "$(wc -c < "$f")" -le 4096 ] || { Q_WHY="the qualification file is larger than 4096 bytes"; return 1; }
  [ "$(tr -cd '\r' < "$f" | wc -c)" = 0 ] || { Q_WHY="the qualification file has carriage returns (LF only)"; return 1; }
  while IFS= read -r line || [ -n "$line" ]; do
    [[ -z $line || $line == '#'* ]] && continue
    [[ $line =~ ^([a-z0-9-]{1,40})=([!-~]{1,200})$ ]] || { Q_WHY="malformed line '$(printf '%s' "$line" | tr -c '\40-\176' '?' | cut -c1-80)'"; return 1; }
    k=${BASH_REMATCH[1]}; v=${BASH_REMATCH[2]}
    [ -z "${P[$k]+x}" ] || { Q_WHY="key $k appears twice"; return 1; }
    P[$k]=$v
  done < "$f"
  for k in "${!P[@]}"; do
    case $k in format|host|address|hostkey|record-file|record-sha256|qualified-on) ;;
      rehearsal-utc-offset) [ "$TRANSPORT" = rehearsal ] || { Q_WHY="key rehearsal-utc-offset belongs to a fixture, not to a pin"; return 1; };;
      *) Q_WHY="unknown key $k"; return 1;; esac
  done
  for k in format host address hostkey record-file record-sha256 qualified-on; do [ -n "${P[$k]:-}" ] || { Q_WHY="key $k is missing"; return 1; }; done
  [ "$TRANSPORT" != rehearsal ] || [ -n "${P[rehearsal-utc-offset]:-}" ] || { Q_WHY="a fixture needs rehearsal-utc-offset"; return 1; }
  [ "${P[format]}" = "$want" ] || { Q_WHY="format=${P[format]}, need $want ($TRANSPORT transport)"; return 1; }
  qual_endpoint || return 1
  [[ ${P[record-file]} =~ ^records/[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$ ]] || { Q_WHY="record-file= must be records/<plain name>"; return 1; }
  [[ ${P[record-sha256]} =~ ^[0-9a-f]{64}$ ]] || { Q_WHY="record-sha256= is not 64 hex"; return 1; }
  [[ ${P[qualified-on]} =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { Q_WHY="qualified-on= is not YYYY-MM-DD"; return 1; }
  [ "$TRANSPORT" != rehearsal ] || [[ ${P[rehearsal-utc-offset]} =~ ^-?[0-9]{1,6}$ ]] || { Q_WHY="rehearsal-utc-offset= is not an integer"; return 1; }
  rf=$(dirname -- "$f")/${P[record-file]}
  [ -f "$rf" ] && [ ! -L "$rf" ] || { Q_WHY="the qualification record ${P[record-file]} is missing next to the pin"; return 1; }
  [ "$(sha256sum < "$rf" | cut -c1-64)" = "${P[record-sha256]}" ] || { Q_WHY="the qualification record ${P[record-file]} does not hash to record-sha256"; return 1; }
  Q_HOST=${P[host]}; Q_ADDR=${P[address]}; Q_HK=${P[hostkey]}; Q_RECSHA=${P[record-sha256]}; Q_T=$QT_PFX$Q_ADDR
  if [ "$TRANSPORT" = rehearsal ]; then Q_KIND=FIXTURE; Q_OFF=${P[rehearsal-utc-offset]}; else Q_KIND=pinned; fi
  return 0
}
qf() { printf 'qualification=%s qual-sha256=%s' "$Q_KIND" "$Q_SHA"; }
# r10 (Astra case 2): CANDIDATE evidence collection, the step BEFORE any pin exists. `candidate-g0 <date> --host H --address A
# --hostkey SHA256:<fp> [--utc-offset S (rehearsal only)]` and `candidate-version --host H --address A --hostkey SHA256:<fp>`
# run the same authenticated calls as g0 / version against an UNPINNED candidate endpoint, with the same endpoint refusals as a pin
# (streamanator by name, address or known host key; production) and the same known_hosts binding. They print the evidence the
# qualification record needs (QUALIFY-OFFHOST.md section 3) and end with ONE line "CANDIDATE EVIDENCE <G0|VERSION> COMPLETE|INCOMPLETE
# ... qualification=candidate qual-sha256=none ...": never a line that begins "OWNER VERDICT", and exit 3 (complete) or 1, never 0.
# The repository pin, present or not, is not read in candidate mode.
CAND=
cand_load() { # args after the mode: <date>? and the flags; sets Q_* or exits 2
  local need_date=$1; shift; P=(); CDATE=
  if [ "$need_date" = 1 ]; then CDATE=${1:-}; shift || usage; fi
  while [ $# -gt 0 ]; do case $1 in
    --host) P[host]=${2:-}; shift 2 || usage;; --address) P[address]=${2:-}; shift 2 || usage;;
    --hostkey) P[hostkey]=${2:-}; shift 2 || usage;;
    --utc-offset) [ "$TRANSPORT" = rehearsal ] || { echo "STOP --utc-offset is a rehearsal fixture (the container's fixed Melbourne offset); production uses AEDT"; exit 2; }
                  P[off]=${2:-}; shift 2 || usage;;
    *) usage;; esac; done
  for k in host address hostkey; do [ -n "${P[$k]:-}" ] || usage; done
  Q_KIND=candidate; Q_SHA=none; Q_RECSHA=none; Q_WHY=; Q_OFF=$AEDT; Q_HOST=${P[host]}; Q_ADDR=${P[address]}; Q_HK=${P[hostkey]}; Q_T=
  if [ "$TRANSPORT" = rehearsal ]; then [[ ${P[off]:-} =~ ^-?[0-9]{1,6}$ ]] || { echo "STOP a rehearsal candidate needs --utc-offset <s>"; exit 2; }; Q_OFF=${P[off]}; fi
  qual_endpoint || { Q_KIND=refused; return 1; }
  Q_HOST=${P[host]}; Q_ADDR=${P[address]}; Q_HK=${P[hostkey]}; Q_T=$QT_PFX$Q_ADDR
}

# kh_fps <name> <file>...: prints "<fingerprint> <known_hosts line>" for every known_hosts line that names <name> (hashed included).
kh_fps() {
  local name=$1 f l fp t; shift
  t=$(mktemp)   # removed here: kh_fps also runs in subshells, where TMPS cannot record it
  for f in "$@"; do
    f=$(upath "$f"); [ -f "$f" ] || continue
    while IFS= read -r l; do
      [[ -z $l || $l == '#'* ]] && continue
      printf '%s\n' "$l" > "$t"; fp=$("$KEYGEN" -lf "$t" 2>/dev/null | tr -d '\r' | awk 'NR==1 {print $2}')
      [ -n "$fp" ] && printf '%s %s\n' "$fp" "$l"
    done < <("$KEYGEN" -F "$name" -f "$f" 2>/dev/null | tr -d '\r')
  done
  rm -f "$t"
}
# qual_hostkey: the pinned fingerprint must be among the owner's known_hosts keys for the endpoint (ssh -G's UserKnownHostsFile list
# and HostKeyAlias or HostName); sets CALL_XOPTS to a known_hosts file holding ONLY the matching lines. Q_WHY on refusal.
qual_hostkey() {
  local g name files kh lines n
  g=$("$SSHBIN" -G "${GOPT[@]}" "$Q_T" 2>/dev/null | tr -d '\r')
  name=$(sed -n 's/^hostkeyalias //p' <<< "$g" | head -1); [ -n "$name" ] && [ "$name" != none ] || name=$(sed -n 's/^hostname //p' <<< "$g" | head -1)
  files=$(sed -n 's/^userknownhostsfile //p' <<< "$g" | head -1)
  [ -n "$name" ] && [ -n "$files" ] || { Q_WHY="ssh -G gave no host name or known_hosts file for $Q_T"; return 1; }
  # shellcheck disable=SC2086
  # (the real streamanator's names, also in rehearsal, where INFO_NAME is the rehearsal container)
  if kh_fps 10.0.40.100 $files | cut -d' ' -f1 | grep -qxF "$Q_HK" || kh_fps streamanator $files | cut -d' ' -f1 | grep -qxF "$Q_HK"; then
    Q_WHY="refused: the pinned host key $Q_HK is one the owner's known_hosts records for streamanator; $DENY_WHY"; return 1; fi
  # shellcheck disable=SC2086
  lines=$(kh_fps "$name" $files | awk -v k="$Q_HK" '$1 == k {sub(/^[^ ]+ /, ""); print}')
  n=$(grep -c . <<< "$lines")
  [ "$n" -ge 1 ] || { Q_WHY="the pinned host key $Q_HK is not among the owner's known_hosts keys for $name (add it from the qualification record, then retry)"; return 1; }
  kh=$(mktemp); TMPS+=("$kh"); printf '%s\n' "$lines" > "$kh"
  CALL_XOPTS=(-o "UserKnownHostsFile=$(mpath "$kh")" -o "GlobalKnownHostsFile=$(mpath "$kh")")
  echo "-- host key: the owner's known_hosts holds the pinned $Q_HK for $name ($n line(s)); ssh accepts only that key for this call"
}

# show <relayed text> (review round 1, F2): prints what the host sent so that nothing in it can draw on Stu's terminal or pass for a
# verdict. Every byte outside printable ASCII (ESC, CR, every other control byte, every byte >= 0x80) becomes '?'. Every line that
# contains "OWNER VERDICT" or "AFLDB-VERIFY RESULT" is prefixed "[relayed, neutralised] ", except the last non-empty line when it
# begins "AFLDB-VERIFY RESULT " (the line call() authenticates). The wrapper's own OWNER VERDICT line is printed after this, so a
# transcript has exactly one line that begins "OWNER VERDICT" per verdict. Authentication below reads the unmodified answer.
# r9: while SHOW_PFX is set (the unqualified endpoint's information call), EVERY line is printed behind that prefix instead.
SHOW_PFX=
show() {
  local i last=-1; local -a SL
  mapfile -t SL < <(printf '%s\n' "$1" | tr -c '\n\40-\176' '?')
  for i in "${!SL[@]}"; do [ -n "${SL[i]}" ] && last=$i; done
  for i in "${!SL[@]}"; do
    if [ -n "$SHOW_PFX" ]; then printf '%s%s\n' "$SHOW_PFX" "${SL[i]}"
    elif [[ ${SL[i]} == *"OWNER VERDICT"* || ${SL[i]} == *"AFLDB-VERIFY RESULT"* ]] && ! { [ "$i" = "$last" ] && [[ ${SL[i]} == "AFLDB-VERIFY RESULT "* ]]; }; then
      printf '[relayed, neutralised] %s\n' "${SL[i]}"
    else printf '%s\n' "${SL[i]}"; fi
  done
}

# call <target> <MODE> <expected host> <command words...>: runs one verifier call; sets V_LINE, V_RC, V_WHY, and V[] (RESULT fields).
# r9: CALL_XOPTS (set by qual_hostkey for a qualified endpoint) adds the pinned known_hosts.
declare -A V
CALL_XOPTS=()
call() {
  local target=$1 mode=$2 ehost=$3 n out err rc line re now at kv k; shift 3
  n=$(nonce); V=(); V_WHY=; V_LINE=
  [[ $n =~ ^[0-9a-f]{32}$ ]] || { V_WHY="no nonce"; V_RC=1; return 1; }
  err=$(mktemp); out=$("$SSHBIN" "${OPTS[@]}" "${CALL_XOPTS[@]}" "$target" "$* $n" 2> "$err"); rc=$?
  out=${out//$'\r'/}
  show "$out"
  [ -s "$err" ] && tr -d '\r' < "$err" | tr -c '\n\40-\176' '?' | sed "s/^/${SHOW_PFX}[ssh stderr] /"; rm -f "$err"
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
verdict() { # MODE PASS|STOP fields...   (r9: G0 verdicts, and A2 verdicts of a fixture run, end with the qualification fields)
  local m=$1 v=$2 q=; shift 2
  case $m in G0) q=" $(qf)";; A2) [ -z "$QFIX" ] || q=" $(qf)";; esac
  [ -z "$CAND" ] || q=" $(qf)"
  if [ -n "$CAND" ]; then   # r10: candidate collection never prints an OWNER VERDICT line and never exits 0
    echo "CANDIDATE EVIDENCE $m $([ "$v" = PASS ] && echo COMPLETE || echo INCOMPLETE) transport=$TRANSPORT ssh=${SSHBIN##*/} $*$q candidate-hostkey=$Q_HK (NOT a gate verdict: evidence for the owner's qualification record of an UNPINNED candidate; no runbook step and no acceptance check accepts this line)"
    [ "$v" = PASS ] && exit 3; exit 1
  fi
  echo "OWNER VERDICT $m $v transport=$TRANSPORT ssh=${SSHBIN##*/} $*$q"
  [ "$v" = PASS ] && exit 0; exit 1
}
# r9: g0b_evidence: the scheduled-transfer evidence of the authenticated G0B RESULT (V[]) for date D and G0a's SHA. Sets E_WHY (empty
# when complete and consistent).
g0b_evidence() {
  local d=${V[f.dispatch-at]:-none} r=${V[f.received-at]:-none} c=${V[f.complete-at]:-none} rs=${V[f.received-sha256]:-none}
  local hs=${V[f.rehash-sha256]:-none} t w0 ds rv cp at
  E_WHY=
  [ "$hs" != none ] || { E_WHY="no check-time root re-hash of the copy (rehash-sha256 missing)"; return 1; }
  [ "$hs" = "$SHA" ] || { E_WHY="rehash-sha256=$hs differs from G0a's sha256"; return 1; }
  [ "$d" != none ] || { E_WHY="possession only: the copy re-hashes to G0a's sha256, but no 03:10 root cron dispatch is linked to it (dispatch-at missing)"; return 1; }
  [ "$c" != none ] || { E_WHY="possession only: the copy re-hashes to G0a's sha256, but the transfer dispatched at $d has no completion record (complete-at missing)"; return 1; }
  [ "$r" != none ] && [ "$rs" != none ] || { E_WHY="possession only: the invocation dispatched at $d did not itself receive this file (no RECEIVED record and per-dump RECEIPT: received-at or received-sha256 missing)"; return 1; }
  [ "$rs" = "$SHA" ] || { E_WHY="received-sha256=$rs differs from G0a's sha256"; return 1; }
  for t in "$d" "$r" "$c"; do [[ $t =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || { E_WHY="malformed evidence time $t"; return 1; }; done
  w0=$(( $(date -u -d "$D 03:10:00 UTC" +%s) - Q_OFF )); ds=$(date -u -d "$d" +%s); rv=$(date -u -d "$r" +%s); cp=$(date -u -d "$c" +%s)
  at=$(date -u -d "${V[at]}" +%s)
  (( ds >= w0 && ds < w0 + 60 )) || { E_WHY="inconsistent: dispatch-at=$d is outside the 03:10 window of $D ($(iso "$w0") to +60 s)"; return 1; }
  (( rv >= ds - 5 )) || { E_WHY="inconsistent: received-at=$r precedes dispatch-at=$d"; return 1; }
  (( cp >= rv )) || { E_WHY="inconsistent: complete-at=$c precedes received-at=$r"; return 1; }
  (( cp <= w0 + 2100 )) || { E_WHY="inconsistent: complete-at=$c is after the $(iso $((w0 + 2100))) deadline"; return 1; }
  (( cp <= at )) || { E_WHY="inconsistent: complete-at=$c is after the RESULT time ${V[at]}"; return 1; }
  return 0
}
evf() { printf 'dispatch-at=%s received-at=%s complete-at=%s received-sha256=%s rehash-sha256=%s' "${V[f.dispatch-at]:-none}" \
  "${V[f.received-at]:-none}" "${V[f.complete-at]:-none}" "${V[f.received-sha256]:-none}" "${V[f.rehash-sha256]:-none}"; }

MODE=${1:-}; shift || usage
HMODE=$MODE
case $MODE in
  candidate-g0) CAND=1; cand_load 1 "$@"; Q_RC=$?; set -- "$CDATE"; MODE=g0;;
  candidate-version) CAND=1; cand_load 0 "$@"; Q_RC=$?; set --; MODE=candidate-version;;
  *) qual_load; Q_RC=$?;;
esac
echo "== afldb-verify-call $(date -u +%FT%TZ) mode=$HMODE transport=$TRANSPORT pinned-bundle=$BUNDLE_SHA key=$KEY $(qf)"
[ -z "$CAND" ] || echo "CANDIDATE MODE: the endpoint below is NOT qualified; this call collects evidence for the owner's qualification record only and can never give a gate verdict (QUALIFY-OFFHOST.md section 3)"
case $MODE in
  candidate-version)
    if [ "$Q_RC" != 0 ]; then echo "-- candidate REFUSED ($Q_WHY)"; verdict VERSION STOP "host=${P[host]:-none} role=offhost step=candidate reason=\"candidate refused: $Q_WHY\""; fi
    qual_hostkey || verdict VERSION STOP "host=$Q_HOST role=offhost step=hostkey reason=\"$Q_WHY\""
    if call "$Q_T" VERSION "$Q_HOST" version && argfields "role=offhost" && { [ "${V[verdict]}" = PASS ] || { V_WHY="the verifier answered VERSION STOP"; false; }; }; then
      verdict VERSION PASS "host=$Q_HOST role=offhost nonce=${V[nonce]} at=${V[at]} boot=${V[boot]} bundle=${V[bundle]}"
    fi
    verdict VERSION STOP "host=$Q_HOST role=offhost nonce=${V[nonce]:-} reason=\"$V_WHY\"";;
  g0)
    [ $# = 1 ] && [[ $1 =~ ^2026-11-2[4-9]$ ]] || usage; D=$1
    if [ "$Q_RC" != 0 ]; then echo "-- qualification REFUSED ($Q_WHY)"; verdict G0 STOP "date=$D step=qualification reason=\"qualification refused: $Q_WHY\""; fi
    case $Q_KIND in
      none) echo "-- qualification: NONE (no qualified off-host endpoint; G0 cannot PASS)";;
      *) echo "-- qualification: $Q_KIND host=$Q_HOST address=$Q_ADDR hostkey=$Q_HK record-sha256=$Q_RECSHA pin-sha256=$Q_SHA";;
    esac
    echo "-- G0a: production, g0 $D"
    if ! call "$PROD_T" G0 "$PROD_NAME" g0 "$D" || ! argfields "date=$D"; then verdict G0 STOP "date=$D step=G0a nonce=${V[nonce]:-} reason=\"$V_WHY\""; fi
    A_N=${V[nonce]}; A_AT=${V[at]}; A_BOOT=${V[boot]}; A_AE=${V[f.access-epoch]:-none}
    [ "${V[verdict]}" = PASS ] || verdict G0 STOP "date=$D step=G0a nonce=$A_N at=$A_AT exit=${V[exit]} reason=\"the production verifier answered STOP\""
    DUMP=${V[f.dump]:-}; SHA=${V[f.sha256]:-}; INV=${V[f.invocation]:-}; DISP=${V[f.dispatch]:-}
    [[ $DUMP =~ ^afldb_prod-${D//-/}-02[0-9]{4}\.dump$ && $SHA =~ ^[0-9a-f]{64}$ && $INV =~ ^[0-9a-f]{32}$ && $DISP =~ ^(scheduled|catch-up)$ ]] \
      || verdict G0 STOP "date=$D step=G0a nonce=$A_N reason=\"the authenticated G0a PASS carries no valid dump/sha256/invocation/dispatch\""
    if [ "$Q_KIND" = none ]; then
      echo "-- G0b: NO QUALIFIED OFF-HOST ENDPOINT. The unqualified endpoint $INFO_NAME is asked for INFORMATION ONLY (possession at most; its arm is root-equivalent there): g0b $D $DUMP $SHA"
      SHOW_PFX='[unqualified endpoint, information only] '
      if call "$INFO_T" G0B "$INFO_NAME" g0b "$D" "$DUMP" "$SHA" && argfields "date=$D" "dump=$DUMP" "sha256=$SHA"; then INFO=${V[verdict]}; IWHY="authenticated answer, $(evf)"
      else INFO=unauthenticated; IWHY=$V_WHY; fi
      SHOW_PFX=
      echo "INFORMATION (unqualified endpoint $INFO_NAME, never GO evidence): answered $INFO; $IWHY"
      verdict G0 STOP "date=$D step=G0b g0a-nonce=$A_N dump=$DUMP sha256=$SHA offhost=none offhost-info=$INFO reason=\"no qualified off-host endpoint: an answer from $INFO_NAME, a PASS included, is information only (its arm is root-equivalent there, 28 Nov 2026); qualify an independent endpoint by QUALIFY-OFFHOST.md\""
    fi
    qual_hostkey || verdict G0 STOP "date=$D step=G0b g0a-nonce=$A_N dump=$DUMP sha256=$SHA offhost=$Q_HOST reason=\"$Q_WHY\""
    echo "-- G0b: $([ -n "$CAND" ] && echo "UNPINNED CANDIDATE endpoint" || echo "qualified off-host endpoint") $Q_HOST at $Q_ADDR (qualification=$Q_KIND), g0b $D $DUMP $SHA (values from the authenticated G0a RESULT line only)"
    if ! call "$Q_T" G0B "$Q_HOST" g0b "$D" "$DUMP" "$SHA" || ! argfields "date=$D" "dump=$DUMP" "sha256=$SHA"; then
      verdict G0 STOP "date=$D step=G0b g0a-nonce=$A_N g0b-nonce=${V[nonce]:-} dump=$DUMP sha256=$SHA offhost=$Q_HOST reason=\"$V_WHY\""; fi
    g0b_evidence
    [ "${V[verdict]}" = PASS ] || verdict G0 STOP "date=$D step=G0b g0a-nonce=$A_N g0b-nonce=${V[nonce]} exit=${V[exit]} dump=$DUMP sha256=$SHA offhost=$Q_HOST $(evf) reason=\"the off-host verifier answered STOP${E_WHY:+; $E_WHY}\""
    [ -z "$E_WHY" ] || verdict G0 STOP "date=$D step=G0b g0a-nonce=$A_N g0b-nonce=${V[nonce]} dump=$DUMP sha256=$SHA offhost=$Q_HOST $(evf) reason=\"$E_WHY\""
    FX=; [ "$Q_KIND" != FIXTURE ] || FX="; qualification=FIXTURE: the endpoint's independence is SIMULATED by a rehearsal fixture, which is fixture evidence and never owner evidence"
    [ -z "$CAND" ] || echo "CANDIDATE SCOPE: the unpinned candidate $Q_HOST at $Q_ADDR (host key $Q_HK) reports through its root-owned verifier a 03:10 root cron dispatch at ${V[f.dispatch-at]}, an invocation of it that RECEIVED $DUMP (sha256 $SHA) at ${V[f.received-at]} and completed at ${V[f.complete-at]} with a per-dump RECEIPT, and a root re-hash at check time. This is evidence for the qualification record (Q7) and nothing else: independence (Q1-Q5) is not established by it, and no gate accepts it"
    [ -n "$CAND" ] || echo "G0 SCOPE: a PASS establishes that the sealed timer run (root seal, PID 1) produced $DUMP with sha256 $SHA on production, and that the qualified off-host endpoint $Q_HOST (pin sha256 $Q_SHA, record sha256 $Q_RECSHA) reports through its root-owned verifier a 03:10 root cron dispatch at ${V[f.dispatch-at]}, a transfer by that dispatch that received and verified these bytes at ${V[f.received-at]} and completed at ${V[f.complete-at]}, and a root re-hash at check time; the pull-log lines linking dispatch, receipt and completion are written by the off-host pull account; the endpoint's independence rests on the owner's qualification record$FX"
    verdict G0 PASS "date=$D invocation=$INV dump=$DUMP sha256=$SHA dispatch=$DISP g0a-nonce=$A_N g0a-at=$A_AT g0a-boot=$A_BOOT g0a-access-epoch=$A_AE offhost=$Q_HOST g0b-nonce=${V[nonce]} g0b-at=${V[at]} $(evf)";;
  a2)
    [ $# = 7 ] && [ "$1" = accepted ] && [[ $2 =~ ^[0-9a-f]{12}-[A-Za-z0-9_-]{1,64}$ && $3 =~ ^r3:(yes|no)$ && $4 =~ ^r4:(yes|no)$ \
      && $5 =~ ^(10:00|14:00)$ && $6 =~ ^tue:(released|rolledback|deferred)$ && $7 =~ ^inv:[0-9a-f]{32}$ ]] || usage
    if ! call "$PROD_T" A2 "$PROD_NAME" a2 "$@" || ! argfields "outcome=$1" "current=$2" "r3=$3" "r4=$4" "window=$5" "tue=$6" "inv=${7#inv:}"; then
      verdict A2 STOP "current=$2 tue=$6 inv=${7#inv:} window=$5 nonce=${V[nonce]:-} reason=\"$V_WHY\""; fi
    echo "A2 SCOPE: a PASS establishes that the live production host matched these seven arguments ($*) at at=${V[at]}; the arguments themselves come from the Tuesday record, printed by arm-run scripts over arm's login, and nothing here checks them; ARM-PRODUCED lines are arm's data read authentically; backup-origin=${V[f.backup-origin]:-none} rests on root and PID 1 evidence only"
    verdict A2 "${V[verdict]}" "current=$2 tue=$6 inv=${7#inv:} window=$5 day=${V[f.day]:-none} backup-origin=${V[f.backup-origin]:-none} nonce=${V[nonce]} at=${V[at]} boot=${V[boot]} exit=${V[exit]} access-epoch=${V[f.access-epoch]:-none}";;
  version)
    [ $# = 0 ] || usage
    VSTOP=0
    # The production line is independent of the off-host qualification.
    if call "$PROD_T" VERSION "$PROD_NAME" version && argfields "role=prod" && { [ "${V[verdict]}" = PASS ] || { V_WHY="the verifier answered VERSION STOP"; false; }; }; then
      echo "OWNER VERDICT VERSION PASS transport=$TRANSPORT host=$PROD_NAME role=prod nonce=${V[nonce]} access-epoch=${V[f.access-epoch]:-none} $(qf)"
    else echo "OWNER VERDICT VERSION STOP transport=$TRANSPORT host=$PROD_NAME role=prod reason=\"$V_WHY\" $(qf)"; VSTOP=1; fi
    if [ "$Q_RC" != 0 ]; then echo "OWNER VERDICT VERSION STOP transport=$TRANSPORT host=none role=offhost reason=\"qualification refused: $Q_WHY\" $(qf)"; VSTOP=1
    elif [ "$Q_KIND" = none ]; then echo "OWNER VERDICT VERSION STOP transport=$TRANSPORT host=none role=offhost reason=\"no qualified off-host endpoint\" $(qf)"; VSTOP=1
    elif ! qual_hostkey; then echo "OWNER VERDICT VERSION STOP transport=$TRANSPORT host=$Q_HOST role=offhost reason=\"$Q_WHY\" $(qf)"; VSTOP=1
    elif call "$Q_T" VERSION "$Q_HOST" version && argfields "role=offhost" && { [ "${V[verdict]}" = PASS ] || { V_WHY="the verifier answered VERSION STOP"; false; }; }; then
      echo "OWNER VERDICT VERSION PASS transport=$TRANSPORT host=$Q_HOST role=offhost nonce=${V[nonce]} $(qf)"
    else echo "OWNER VERDICT VERSION STOP transport=$TRANSPORT host=$Q_HOST role=offhost reason=\"$V_WHY\" $(qf)"; VSTOP=1; fi
    [ "$VSTOP" = 0 ] && exit 0; exit 1;;
  *) usage;;
esac
