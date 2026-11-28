#!/usr/bin/env bash
# r10q-wrapper-test.sh (R6 r10, 28 Nov 2026): r9's r9q-wrapper-test.sh with r10's three intended changes (T03 prints access-epoch=,
# T14's possession wording, T31 replaced by T31a/T31b: a rehearsal reads the pin LOCATION but only the fixture format) plus the
# candidate-mode cases T34-T43 (Astra case 2: candidate evidence before any pin, never an OWNER VERDICT, never exit 0).
#   bash r10q-wrapper-test.sh [<log file>]        default: ../evidence/local-r10q.log
# r9 text follows.
# r9q-wrapper-test.sh (R6 r9, Astra blocker 1, off-host qualification): LOCAL test of the decision logic of the ACTUAL wrapper
# review-fixes-r7-20261128/verify/afldb-verify-call.sh. Workstation (Git Bash) or Linux; needs bash, ssh-keygen, sha256sum.
#   bash r9q-wrapper-test.sh [<log file>]        default: ../evidence/local-r9q.log
# It never connects anywhere: AFLDB_VERIFY_SSH is a STUB that answers every call with a well-formed RESULT line for THIS call's nonce,
# the wrapper's pinned bundle digest and the current time (so every answer authenticates, and only the r9 decision logic decides).
# The wrapper is copied byte for byte (cmp-checked) into a scratch tree that mirrors its repository position, so a qualification pin
# can be placed at ../../review-fixes-r9-20261128/offhost/QUALIFIED-ENDPOINT relative to it without creating one in the repository.
# Host keys are fresh throwaway ed25519 keys made here; the stub logs every invocation and the known_hosts file the wrapper hands it.
# Because the client is always the stub, the wrapper must label production transport transport=production-stub (R9-F-3): every case
# asserts that the exact token transport=production never appears and that production-stub output opens with the STUB WARNING line.
# Output: one "TEST <id> PASS|FAIL <expected> | <actual>" line per case, then "R10Q LOCAL RESULT PASS|FAIL".
set -uo pipefail; export LC_ALL=C
HERE=$(cd "$(dirname "$0")" && pwd -P)
R=$(cd "$HERE/../../.." && pwd -P)
W=$R/review-fixes-r7-20261128/verify/afldb-verify-call.sh
LOG=${1:-$HERE/../evidence/local-r10q.log}; mkdir -p "$(dirname "$LOG")"; : > "$LOG"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/r/review-fixes-r7-20261128/verify" "$T/r/review-fixes-r9-20261128/offhost/records" "$T/home/.ssh" "$T/fix/records" "$T/tmpd"
TW=$T/r/review-fixes-r7-20261128/verify/afldb-verify-call.sh; cp "$W" "$TW"
PIN=$T/r/review-fixes-r9-20261128/offhost/QUALIFIED-ENDPOINT
say() { printf '%s\n' "$*" | tee -a "$LOG"; }
{ echo "== r9q local wrapper test $(date -u +%FT%TZ) on $(uname -s 2>/dev/null) bash $BASH_VERSION"
  echo "[HARNESS] wrapper under test: $(sha256sum < "$W" | cut -c1-64)  ${W#"$R"/}"
  cmp -s "$W" "$TW" && echo "[HARNESS] scratch copy is byte-identical" || echo "[HARNESS] COPY DIFFERS"
  echo "[HARNESS] its pinned BUNDLE_SHA: $(sed -n 's/^BUNDLE_SHA=\([0-9a-f]*\).*/\1/p' "$W")"; } >> "$LOG"
: > "$T/home/.ssh/afldb_verify"   # dummy verify key: the stub never uses it
for k in q s x; do ssh-keygen -q -t ed25519 -N '' -C "r9q-$k" -f "$T/hk-$k" > /dev/null || { echo "STOP ssh-keygen"; exit 2; }; done
fp() { ssh-keygen -lf "$T/hk-$1.pub" | awk '{print $2}'; }; FPQ=$(fp q); FPS=$(fp s); FPX=$(fp x)
kl() { cut -d' ' -f1,2 "$T/hk-$1.pub"; }
# The owner's known_hosts (stand-in): the candidate endpoint 203.0.113.20 (key q, plus a second key x that must NOT be accepted),
# streamanator 10.0.40.100 (key s), and the rehearsal alias r7v-offhost (key q).
printf '%s\n' "203.0.113.20 $(kl q)" "203.0.113.20 $(kl x)" "10.0.40.100 $(kl s)" "r7v-offhost $(kl q)" > "$T/known_hosts"
echo "[HARNESS] fingerprints: candidate q $FPQ, second key x $FPX, streamanator s $FPS" >> "$LOG"
BSHA=$(sed -n 's/^BUNDLE_SHA=\([0-9a-f]\{64\}\).*/\1/p' "$W")
SHA=5f2b9d0c3e4a1b6c7d8e9f00112233445566778899aabbccddeeff0011223344
cat > "$T/stub-ssh" <<EOF
#!/usr/bin/env bash
# STUB ssh (r9q): never connects. -G answers like ssh -G; a call answers with a RESULT line for this call's nonce.
echo "CALL \$*" >> "\$STUB_LOG"
isG=0; F=; prev=; KHF=
for a in "\$@"; do [ "\$a" = -G ] && isG=1; [ "\$prev" = -F ] && F=\$a; case \$a in UserKnownHostsFile=*) KHF=\${a#UserKnownHostsFile=};; esac; prev=\$a; done
last=\${!#}
if [ "\$isG" = 1 ]; then
  case \$last in afldb) echo "hostname 203.0.113.10";;
    *) h=\${last#*@}; echo "user afldb-verify"; echo "hostname \$h"; [ "\$F" = none ] || echo "hostkeyalias \$h"
       echo "userknownhostsfile $T/known_hosts $T/known_hosts2";; esac
  exit 0
fi
cmd=\$last; tgt=\${@: -2:1}; n=\${cmd##* }
[ -z "\$KHF" ] || { echo "PINNED-KNOWN-HOSTS \$tgt: \$(tr '\n' '|' < "\$KHF")"; } >> "\$STUB_LOG"
now=\$(date -u +%Y-%m-%dT%H:%M:%SZ); hex() { od -An -N16 -tx1 /dev/urandom | tr -d ' \n'; }; iso() { date -u -d "@\$1" +%Y-%m-%dT%H:%M:%SZ; }
read -r _ D _ <<< "\$cmd"; DUMP=afldb_prod-\${D//-/}-022003.dump; SHA=$SHA
case \$cmd in
  "g0 "*) echo "G0 PROD RESULT PASS (stub)"; echo "AFLDB-VERIFY RESULT G0 PASS nonce=\$n host=afldb-prod boot=\$(hex) bundle=$BSHA at=\$now exit=0 date=\$D invocation=\$(hex) dump=\$DUMP sha256=\$SHA dispatch=scheduled"; exit 0;;
  "g0b "*)
    W0=\$(( \$(date -u -d "\$D 03:10:00 UTC" +%s) - 39600 ))
    da=\$(iso \$((W0 + 2))) ra=\$(iso \$((W0 + 30))) ca=\$(iso \$((W0 + 31))) rs=\$SHA hs=\$SHA v=PASS rc=0
    case \${STUB_EV:-full} in full) ;; nodispatch) da=none;; nocomplete) ca=none;; noreceived) ra=none; rs=none;; norehash) hs=none;;
      badorder) ra=\$(iso \$((W0 - 60)));; late) ca=\$(iso \$((W0 + 2200)));; outwin) da=\$(iso \$((W0 + 120)));;
      wrongsha) rs=\$(printf '0%.0s' {1..64});; corestop) v=STOP; rc=10; ca=none; ra=none; rs=none;; esac
    echo "COPY VERIFIED (stub)"
    echo "AFLDB-VERIFY RESULT G0B \$v nonce=\$n host=\${STUB_OFFHOST:?} boot=\$(hex) bundle=$BSHA at=\$now exit=\$rc date=\$D dump=\$DUMP sha256=\$SHA dispatch-at=\$da received-at=\$ra complete-at=\$ca received-sha256=\$rs rehash-sha256=\$hs"
    exit \$rc;;
  "version "*) case \$tgt in afldb-verify@203.0.113.10|r7v-prod) h=afldb-prod; r=prod;; *) h=\${STUB_OFFHOST:-none}; r=offhost;; esac
    echo "AFLDB-VERIFY RESULT VERSION PASS nonce=\$n host=\$h boot=\$(hex) bundle=$BSHA at=\$now exit=0 role=\$r"; exit 0;;
esac
echo "stub: unknown command"; exit 255
EOF
chmod 755 "$T/stub-ssh"; : > "$T/cfg"

printf 'Owner qualification record (TEST FIXTURE, r9q): no real machine.\n' > "$T/r/review-fixes-r9-20261128/offhost/records/q-test.md"
printf 'FIXTURE qualification record (r9q): simulated independence.\n' > "$T/fix/records/fixture.md"
RSP=$(sha256sum < "$T/r/review-fixes-r9-20261128/offhost/records/q-test.md" | cut -c1-64); RSF=$(sha256sum < "$T/fix/records/fixture.md" | cut -c1-64)
mkq() { # file format host address hostkey record-sha [offset]
  { echo '# r9q test qualification'; echo "format=$2"; echo "host=$3"; echo "address=$4"; echo "hostkey=$5"
    case $2 in *fixture*) echo "record-file=records/fixture.md";; *) echo "record-file=records/q-test.md";; esac
    echo "record-sha256=$6"; echo "qualified-on=2026-11-28"; [ -z "${7:-}" ] || echo "rehearsal-utc-offset=$7"; } > "$1"; }
PF=afldb-offhost-qualification-v1; FF=afldb-offhost-qualification-fixture-v1
BAD=0; N=0
run() { # id expected-rc "pattern@@pattern..." env... -- wrapper args...   (pattern: ERE on the output; !ERE must not match; S:ERE / S!ERE on the stub log)
  local id=$1 want=$2 pats=$3 out rc ok=1 p v e=(); shift 3
  while [ "$1" != -- ]; do e+=("$1"); shift; done; shift
  : > "$T/stub.log"
  out=$(env TMPDIR="$T/tmpd" HOME="$T/home" AFLDB_VERIFY_SSH="$T/stub-ssh" STUB_LOG="$T/stub.log" "${e[@]}" bash "$TW" "$@" 2>&1); rc=$?
  { echo; echo "== TEST $id: env ${e[*]} -- afldb-verify-call.sh $*"; printf '%s\n' "$out" | sed 's/^/   | /'; echo "   [stub log]"; sed 's/^/   s /' "$T/stub.log"; echo "   [exit $rc]"; } >> "$LOG"
  [ "$rc" = "$want" ] || ok=0
  mapfile -t PS < <(printf '%s
' "${pats//@@/$'
'}")
  for p in "${PS[@]}"; do
    case $p in
      '!'*) grep -qE -- "${p#!}" <<< "$out" && ok=0;;
      'S:'*) grep -qE -- "${p#S:}" "$T/stub.log" || ok=0;;
      'S!'*) grep -qE -- "${p#S!}" "$T/stub.log" && ok=0;;
      *) grep -qE -- "$p" <<< "$out" || ok=0;;
    esac
  done
  # R9-F-3, in EVERY case: AFLDB_VERIFY_SSH is always the stub here, so the exact production token must never appear, and any
  # production-stub output must open with the STUB WARNING line.
  grep -qE -- 'transport=production( |$)' <<< "$out" && ok=0
  if grep -q -- 'transport=production-stub' <<< "$out"; then head -n 1 <<< "$out" | grep -q '^STUB WARNING: AFLDB_VERIFY_SSH=' || ok=0; fi
  v=$(grep '^OWNER VERDICT' <<< "$out" | cut -c1-260 | tr '\n' '~')
  N=$((N + 1)); if [ "$ok" = 1 ]; then say "TEST $id PASS exit=$rc | $v"; else BAD=$((BAD + 1)); say "TEST $id FAIL exit=$rc (want $want) | $v"; fi
}
D=2026-11-25
# ---- production transport, no pin (the repository default)
rm -f "$PIN"
run T01-unconfigured-info-stop 1 '^OWNER VERDICT G0 STOP transport=production-stub .*step=G0b .*offhost-info=STOP .*no qualified off-host endpoint.* qualification=none qual-sha256=none$@@!^OWNER VERDICT G0 PASS@@!^AFLDB-VERIFY RESULT G0B@@S:afldb-verify@10.0.40.100 g0b ' \
  STUB_OFFHOST=streamanator STUB_EV=corestop -- g0 $D
run T02-streamanator-full-pass-is-stop 1 '^OWNER VERDICT G0 STOP transport=production-stub .*offhost-info=PASS .*no qualified off-host endpoint.* qualification=none@@^\[unqualified endpoint, information only\] AFLDB-VERIFY RESULT G0B PASS @@^INFORMATION \(unqualified endpoint streamanator@@!^OWNER VERDICT G0 PASS@@!^AFLDB-VERIFY RESULT G0B@@S!PINNED-KNOWN-HOSTS' \
  STUB_OFFHOST=streamanator STUB_EV=full -- g0 $D
run T03-version-unconfigured 1 '^OWNER VERDICT VERSION PASS transport=production-stub host=afldb-prod role=prod nonce=[0-9a-f]{32} access-epoch=none qualification=none qual-sha256=none$@@^OWNER VERDICT VERSION STOP transport=production-stub host=none role=offhost reason="no qualified off-host endpoint" qualification=none qual-sha256=none$@@S!10\.0\.40\.100 version' \
  STUB_OFFHOST=streamanator -- version
# ---- production pins refused before any verifier call
mkq "$PIN" $PF streamanator 203.0.113.20 "$FPQ" "$RSP"
run T04-pin-host-streamanator 1 '^OWNER VERDICT G0 STOP .*step=qualification reason="qualification refused: refused: streamanator \(10.0.40.100\) cannot be qualified: its arm is in sudo, docker and lxd.* qualification=refused qual-sha256=[0-9a-f]{64}$@@S! g0 ' \
  STUB_OFFHOST=streamanator -- g0 $D
mkq "$PIN" $PF offhost-q 10.0.40.100 "$FPQ" "$RSP"
run T05-pin-address-10.0.40.100 1 '^OWNER VERDICT G0 STOP .*step=qualification .*root-equivalent@@S! g0 ' STUB_OFFHOST=offhost-q -- g0 $D
mkq "$PIN" $PF offhost-q 203.0.113.21 "$FPS" "$RSP"
run T06-pin-streamanators-host-key 1 '^OWNER VERDICT G0 STOP .*step=G0b .*the pinned host key SHA256:[A-Za-z0-9+/]{43} is one the owner.s known_hosts records for streamanator@@S! g0b ' STUB_OFFHOST=offhost-q -- g0 $D
mkq "$PIN" $PF offhost-q 203.0.113.20 "$FPQ" "$(printf 'a%.0s' {1..64})"
run T07-pin-record-digest-mismatch 1 '^OWNER VERDICT G0 STOP .*step=qualification .*does not hash to record-sha256@@S! g0 ' STUB_OFFHOST=offhost-q -- g0 $D
mkq "$PIN" $FF offhost-q 203.0.113.20 "$FPQ" "$RSP" 39600
run T08-fixture-format-as-pin 1 '^OWNER VERDICT G0 STOP .*step=qualification .*(rehearsal-utc-offset belongs to a fixture|format=)' STUB_OFFHOST=offhost-q -- g0 $D
mkq "$PIN" $PF offhost-q 203.0.113.20 "$FPX$FPX" "$RSP"
run T09-pin-malformed-hostkey 1 '^OWNER VERDICT G0 STOP .*step=qualification .*hostkey= is not' STUB_OFFHOST=offhost-q -- g0 $D
mkq "$PIN" $PF offhost-q 198.51.100.7 "$FPQ" "$RSP"
run T10-pin-key-not-in-known-hosts 1 '^OWNER VERDICT G0 STOP .*step=G0b .*is not among the owner.s known_hosts keys for 198.51.100.7@@S! g0b ' STUB_OFFHOST=offhost-q -- g0 $D
# ---- production pin, valid: the scheduled-transfer evidence decides
mkq "$PIN" $PF offhost-q 203.0.113.20 "$FPQ" "$RSP"
QS=$(sha256sum < "$PIN" | cut -c1-64)
run T11-pinned-full-evidence-pass 0 "^OWNER VERDICT G0 PASS transport=production-stub .*offhost=offhost-q .*dispatch-at=2026-11-24T16:10:02Z received-at=2026-11-24T16:10:30Z complete-at=2026-11-24T16:10:31Z received-sha256=$SHA rehash-sha256=$SHA qualification=pinned qual-sha256=$QS\$@@^G0 SCOPE: .*qualified off-host endpoint offhost-q@@S:PINNED-KNOWN-HOSTS afldb-verify@203.0.113.20: 203.0.113.20 ssh-ed25519 [A-Za-z0-9+/=]+\|\$@@S!afldb-verify@10.0.40.100" \
  STUB_OFFHOST=offhost-q STUB_EV=full -- g0 $D
run T12-pinned-no-dispatch 1 '^OWNER VERDICT G0 STOP .*step=G0b .*reason="possession only: .*no 03:10 root cron dispatch is linked to it \(dispatch-at missing\)" qualification=pinned' STUB_OFFHOST=offhost-q STUB_EV=nodispatch -- g0 $D
run T13-pinned-no-completion 1 '^OWNER VERDICT G0 STOP .*step=G0b .*reason="possession only: .*has no completion record \(complete-at missing\)" qualification=pinned' STUB_OFFHOST=offhost-q STUB_EV=nocomplete -- g0 $D
run T14-pinned-no-received 1 '^OWNER VERDICT G0 STOP .*reason="possession only: .*did not itself receive this file \(no RECEIVED record and per-dump RECEIPT' STUB_OFFHOST=offhost-q STUB_EV=noreceived -- g0 $D
run T15-pinned-no-rehash 1 '^OWNER VERDICT G0 STOP .*reason="no check-time root re-hash' STUB_OFFHOST=offhost-q STUB_EV=norehash -- g0 $D
run T16-pinned-received-before-dispatch 1 '^OWNER VERDICT G0 STOP .*reason="inconsistent: received-at=.* precedes dispatch-at' STUB_OFFHOST=offhost-q STUB_EV=badorder -- g0 $D
run T17-pinned-late-completion 1 '^OWNER VERDICT G0 STOP .*reason="inconsistent: complete-at=.* deadline' STUB_OFFHOST=offhost-q STUB_EV=late -- g0 $D
run T18-pinned-dispatch-outside-window 1 '^OWNER VERDICT G0 STOP .*reason="inconsistent: dispatch-at=.* outside the 03:10 window' STUB_OFFHOST=offhost-q STUB_EV=outwin -- g0 $D
run T19-pinned-received-sha-differs 1 '^OWNER VERDICT G0 STOP .*reason="received-sha256=0{64} differs' STUB_OFFHOST=offhost-q STUB_EV=wrongsha -- g0 $D
run T20-pinned-core-stop 1 '^OWNER VERDICT G0 STOP .*reason="the off-host verifier answered STOP; possession only: .*complete-at missing' STUB_OFFHOST=offhost-q STUB_EV=corestop -- g0 $D
run T21-pinned-wrong-result-host 1 '^OWNER VERDICT G0 STOP .*step=G0b .*reason="host streamanator, expected offhost-q"' STUB_OFFHOST=streamanator STUB_EV=full -- g0 $D
run T22-version-pinned 0 "^OWNER VERDICT VERSION PASS transport=production-stub host=afldb-prod role=prod .*qualification=pinned qual-sha256=$QS\$@@^OWNER VERDICT VERSION PASS transport=production-stub host=offhost-q role=offhost .*qualification=pinned qual-sha256=$QS\$" STUB_OFFHOST=offhost-q -- version
# ---- production transport refuses the fixture flag; rehearsal fixtures
rm -f "$PIN"
mkq "$T/fix/Q-ok" $FF offhost-q r7v-offhost "$FPQ" "$RSF" 39600
run T23-production-refuses-fixture-flag 2 '^STOP --qualification-fixture is accepted with --rehearsal only@@!^OWNER VERDICT@@S!.' STUB_OFFHOST=offhost-q -- --qualification-fixture "$T/fix/Q-ok" g0 $D
run T24-fixture-full-evidence-pass 0 '^OWNER VERDICT G0 PASS transport=rehearsal .*offhost=offhost-q .* qualification=FIXTURE qual-sha256=[0-9a-f]{64}$@@^G0 SCOPE: .*qualification=FIXTURE: the endpoint.s independence is SIMULATED' \
  STUB_OFFHOST=offhost-q STUB_EV=full -- --rehearsal "$T/cfg" --key "$T/home/.ssh/afldb_verify" --qualification-fixture "$T/fix/Q-ok" g0 $D
run T25-fixture-no-dispatch 1 '^OWNER VERDICT G0 STOP transport=rehearsal .*possession only: .*dispatch-at missing.* qualification=FIXTURE' \
  STUB_OFFHOST=offhost-q STUB_EV=nodispatch -- --rehearsal "$T/cfg" --key "$T/home/.ssh/afldb_verify" --qualification-fixture "$T/fix/Q-ok" g0 $D
run T26-fixture-no-completion 1 '^OWNER VERDICT G0 STOP transport=rehearsal .*possession only: .*complete-at missing.* qualification=FIXTURE' \
  STUB_OFFHOST=offhost-q STUB_EV=nocomplete -- --rehearsal "$T/cfg" --key "$T/home/.ssh/afldb_verify" --qualification-fixture "$T/fix/Q-ok" g0 $D
mkq "$T/fix/Q-stream" $FF streamanator r7v-offhost "$FPQ" "$RSF" 39600
run T27-fixture-naming-streamanator 1 '^OWNER VERDICT G0 STOP transport=rehearsal .*step=qualification .*root-equivalent.* qualification=refused@@S! g0 ' \
  STUB_OFFHOST=streamanator -- --rehearsal "$T/cfg" --key "$T/home/.ssh/afldb_verify" --qualification-fixture "$T/fix/Q-stream" g0 $D
mkq "$T/fix/Q-pinfmt" $PF offhost-q r7v-offhost "$FPQ" "$RSF"
run T28-pin-format-as-fixture 1 '^OWNER VERDICT G0 STOP transport=rehearsal .*step=qualification .*(rehearsal-utc-offset|format=)' \
  STUB_OFFHOST=offhost-q -- --rehearsal "$T/cfg" --key "$T/home/.ssh/afldb_verify" --qualification-fixture "$T/fix/Q-pinfmt" g0 $D
run T29-fixture-version 0 '^OWNER VERDICT VERSION PASS transport=rehearsal host=afldb-prod role=prod .*qualification=FIXTURE@@^OWNER VERDICT VERSION PASS transport=rehearsal host=offhost-q role=offhost .*qualification=FIXTURE' \
  STUB_OFFHOST=offhost-q -- --rehearsal "$T/cfg" --key "$T/home/.ssh/afldb_verify" --qualification-fixture "$T/fix/Q-ok" version
run T30-fixture-a2-labelled 1 '^OWNER VERDICT A2 STOP transport=rehearsal .* qualification=FIXTURE qual-sha256=[0-9a-f]{64}$' \
  STUB_OFFHOST=offhost-q -- --rehearsal "$T/cfg" --key "$T/home/.ssh/afldb_verify" --qualification-fixture "$T/fix/Q-ok" a2 accepted 17822b29e6de-abc r3:yes r4:no 10:00 tue:released inv:0123456789abcdef0123456789abcdef
# ---- r10: a rehearsal reads the repository pin LOCATION, but only the FIXTURE format there (r9's T31 said it never read it)
mkq "$PIN" $PF offhost-q 203.0.113.20 "$FPQ" "$RSP"
run T31a-rehearsal-refuses-production-pin 1 '^OWNER VERDICT G0 STOP transport=rehearsal .*step=qualification .*(rehearsal-utc-offset|format=).* qualification=refused@@S! g0 ' \
  STUB_OFFHOST=r7v-offhost STUB_EV=full -- --rehearsal "$T/cfg" --key "$T/home/.ssh/afldb_verify" g0 $D
printf 'FIXTURE qualification record (r10q): simulated independence, at the pin location.\n' > "$T/r/review-fixes-r9-20261128/offhost/records/fixture.md"
mkq "$PIN" $FF offhost-q r7v-offhost "$FPQ" "$(sha256sum < "$T/r/review-fixes-r9-20261128/offhost/records/fixture.md" | cut -c1-64)" 39600
QF31=$(sha256sum < "$PIN" | cut -c1-64)
run T31b-rehearsal-fixture-at-pin-location 0 "^OWNER VERDICT G0 PASS transport=rehearsal .*offhost=offhost-q .* qualification=FIXTURE qual-sha256=$QF31\$" \
  STUB_OFFHOST=offhost-q STUB_EV=full -- --rehearsal "$T/cfg" --key "$T/home/.ssh/afldb_verify" g0 $D
run T31c-production-refuses-fixture-at-pin-location 1 '^OWNER VERDICT G0 STOP transport=production-stub .*step=qualification .*(rehearsal-utc-offset belongs to a fixture|format=).* qualification=refused@@S! g0 ' \
  STUB_OFFHOST=offhost-q STUB_EV=full -- g0 $D
mkq "$PIN" $PF offhost-q 203.0.113.20 "$FPQ" "$RSP"
# ---- R9-F-3: a stubbed ssh client on production transport is labelled production-stub everywhere (header, every verdict)
run T32-stub-label-g0-pass 0 '^STUB WARNING: AFLDB_VERIFY_SSH=.* NOT a production verdict@@^== afldb-verify-call .* mode=g0 transport=production-stub @@^OWNER VERDICT G0 PASS transport=production-stub .* qualification=pinned@@!transport=production( |$)' \
  STUB_OFFHOST=offhost-q STUB_EV=full -- g0 $D
run T33-stub-label-a2-no-pin-needed 1 '^STUB WARNING: AFLDB_VERIFY_SSH=@@^== afldb-verify-call .* mode=a2 transport=production-stub @@^OWNER VERDICT A2 STOP transport=production-stub @@!^OWNER VERDICT A2 [A-Z]+ transport=production( |$)' \
  -- a2 accepted 17822b29e6de-abc r3:yes r4:no 10:00 tue:released inv:0123456789abcdef0123456789abcdef
# ---- r10 (Astra case 2): candidate evidence before any pin exists; never an OWNER VERDICT line, never exit 0
rm -f "$PIN"
CA=(--host offhost-q --address 203.0.113.20 --hostkey "$FPQ")
run T34-candidate-g0-unconfigured-complete 3 "^== afldb-verify-call .* mode=candidate-g0 transport=production-stub .*qualification=candidate qual-sha256=none\$@@^CANDIDATE MODE: @@^CANDIDATE SCOPE: the unpinned candidate offhost-q@@^CANDIDATE EVIDENCE G0 COMPLETE transport=production-stub .*offhost=offhost-q .*received-at=2026-11-24T16:10:30Z .*qualification=candidate qual-sha256=none candidate-hostkey=SHA256:[A-Za-z0-9+/]{43} \(NOT a gate verdict@@!^OWNER VERDICT@@!^G0 SCOPE@@S:PINNED-KNOWN-HOSTS afldb-verify@203.0.113.20: 203.0.113.20 ssh-ed25519 [A-Za-z0-9+/=]+\|\$@@S!10\.0\.40\.100" \
  STUB_OFFHOST=offhost-q STUB_EV=full -- candidate-g0 $D "${CA[@]}"
run T35-candidate-named-streamanator 1 '^CANDIDATE EVIDENCE G0 INCOMPLETE .*step=qualification .*root-equivalent@@!^OWNER VERDICT@@S! g0 ' \
  STUB_OFFHOST=streamanator -- candidate-g0 $D --host streamanator --address 203.0.113.20 --hostkey "$FPQ"
run T36-candidate-streamanators-key 1 '^CANDIDATE EVIDENCE G0 INCOMPLETE .*step=G0b .*one the owner.s known_hosts records for streamanator@@!^OWNER VERDICT@@S! g0b ' \
  STUB_OFFHOST=offhost-q -- candidate-g0 $D --host offhost-q --address 203.0.113.21 --hostkey "$FPS"
run T37-candidate-key-not-known 1 '^CANDIDATE EVIDENCE G0 INCOMPLETE .*is not among the owner.s known_hosts keys for 198.51.100.7@@!^OWNER VERDICT@@S! g0b ' \
  STUB_OFFHOST=offhost-q -- candidate-g0 $D --host offhost-q --address 198.51.100.7 --hostkey "$FPQ"
run T38-candidate-possession-only 1 '^CANDIDATE EVIDENCE G0 INCOMPLETE .*possession only: .*did not itself receive this file@@!^OWNER VERDICT' \
  STUB_OFFHOST=offhost-q STUB_EV=noreceived -- candidate-g0 $D "${CA[@]}"
run T39-candidate-version 3 '^CANDIDATE EVIDENCE VERSION COMPLETE transport=production-stub .*host=offhost-q role=offhost .*qualification=candidate qual-sha256=none@@!^OWNER VERDICT@@S!afldb-verify@203\.0\.113\.10' \
  STUB_OFFHOST=offhost-q -- candidate-version "${CA[@]}"
run T40-candidate-production-address 1 '^CANDIDATE EVIDENCE VERSION INCOMPLETE .*must not be production itself@@!^OWNER VERDICT@@S!version' \
  STUB_OFFHOST=offhost-q -- candidate-version --host offhost-q --address 203.0.113.10 --hostkey "$FPQ"
run T41-candidate-utc-offset-production 2 '^STOP --utc-offset is a rehearsal fixture@@!^OWNER VERDICT@@!^CANDIDATE EVIDENCE' \
  STUB_OFFHOST=offhost-q -- candidate-g0 $D "${CA[@]}" --utc-offset 39600
mkq "$PIN" $PF offhost-q 203.0.113.20 "$FPQ" "$RSP"
run T42-candidate-ignores-existing-pin 3 '^CANDIDATE EVIDENCE G0 COMPLETE .*qualification=candidate qual-sha256=none@@!^OWNER VERDICT@@!qualification=pinned' \
  STUB_OFFHOST=offhost-q STUB_EV=full -- candidate-g0 $D "${CA[@]}"
rm -f "$PIN"
run T43-candidate-rehearsal 3 '^CANDIDATE EVIDENCE G0 COMPLETE transport=rehearsal .*qualification=candidate qual-sha256=none@@!^OWNER VERDICT' \
  STUB_OFFHOST=offhost-q STUB_EV=full -- --rehearsal "$T/cfg" --key "$T/home/.ssh/afldb_verify" candidate-g0 $D --host offhost-q --address r7v-offhost --hostkey "$FPQ" --utc-offset 39600
rm -f "$PIN"
left=$(ls -A "$T/tmpd" | wc -l)
say "[HARNESS] wrapper temp files left in its TMPDIR after the tests: $left"
[ "$left" = 0 ] || BAD=$((BAD + 1))
[ "$BAD" = 0 ] && say "R10Q LOCAL RESULT PASS ($N tests)" || say "R10Q LOCAL RESULT FAIL ($BAD of $N)"
[ "$BAD" = 0 ]
