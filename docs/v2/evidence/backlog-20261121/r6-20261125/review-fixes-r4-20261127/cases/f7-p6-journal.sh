#!/usr/bin/env bash
# R6 r4 fixture suite f7: the P6 journal check (review finding 7). Runs as a plain user, no root, no network, no sudo: on
# streamanator itself as arm (then the "real" cases run too) or inside the pinned container (shim cases only; it says so).
# Under test, REAL bytes: <FIX>/docs/v2/evidence/release-17822b29-20261124/scripts/r1-p6-observe.sh (sourced through its
# documented seam R1_LIB_ONLY=1: p6_owner_block, p6_journal_errs; main is never run) and the owner block of the release
# runbook section 4.2 ($R4_RELEASE_RUNBOOK if set, else <FIX>/docs/v2/evidence/release-17822b29-20261124/RUNBOOK.md).
# The owner command is cut verbatim from the runbook and from what the script prints; the two must be the same text once
# "<since>" is replaced, and that text is what the cases execute (bash, two lines, as pasted).
# What is real and what is a shim:
#   shim cases   `sudo` = a PATH shim that runs its arguments (or fails as sudo does without a password: one stderr line, exit 1);
#                `journalctl` = a PATH shim that REFUSES (exit 64) any query that is not for unit afldb with the expected
#                --since, and otherwise answers with behaviours recorded from the real journalctl 255.4-1ubuntu8.19 on
#                streamanator on 27 Nov 2026:
#                  no matching entry        exit 0; stdout empty with -o json or -o cat (with or without -q); "-- No entries --" (one
#                                           line) only in the default output mode without -q
#                  one matching entry       exit 0; one line (-o json: one JSON object per entry, also for a two-line MESSAGE,
#                                           which -o cat prints as two lines)
#                  invalid --since          exit 1; stdout empty; stderr "Failed to parse timestamp: <text>"
#                  journal not readable     exit 1; stdout empty; stderr "No journal files were opened due to insufficient
#                                           permissions." (a uid outside adm/systemd-journal reading /var/log/journal; -q does not
#                                           change it); a missing directory (-D): exit 1 "Failed to open <dir>: No such file ..."
#                  nothing readable, silent exit 0; stdout and stderr empty (-D on a directory whose only journal file is mode 000
#                                           or is not a journal)
#   real cases   (only where `systemctl --user` works and this is not a container) two transient user units named for this run
#                (systemd-run --user): one logs one "<6>" line, the other one "<3>" and one "<6>" line. `journalctl` = a shim
#                that changes ONLY the unit selection (-u afldb becomes --user -u <the run's unit>) and execs /usr/bin/journalctl
#                with every other argument as printed; `sudo` = the same pass-through shim (no sudo on DEV; arm reads its own
#                user journal). The journal entries those two units wrote stay in arm's user journal; nothing else is left.
# Contrast (the defect): the ORIGINAL owner line and tick line, cut from the original script ($F7_ORIG if set, else <FIX>/docs/
# v2/evidence/backlog-20261121/r6-20261125/review-fixes-r4-20261127/orig-aa33f0fc/r1-p6-observe.sh), give the expected "1"
# for one real error entry and exit 0 for a failed query; the original tick line never yields "unreadable" for a failed query.
# Usage: bash cases/f7-p6-journal.sh <FIX> [<STAGE>]      (<STAGE> is accepted and unused)
# Output: one "CASE-RESULT f7-<case> OK|UNEXPECTED (<expected> ; got <actual>)" line per case; last line
# "SUITE f7 RESULT PASS (<n> cases)" exit 0, or "SUITE f7 RESULT FAIL (<k> unexpected)" exit 1.
main() {
set -uo pipefail; export LC_ALL=C
local FIX=${1:-}
[ -n "$FIX" ] && [ -d "$FIX" ] || { echo "usage: f7-p6-journal.sh <FIX> [<STAGE>]"; exit 2; }
[ "$(hostname 2>/dev/null)" != afldb-prod ] || [ -f /.dockerenv ] || { echo "REFUSED: fixtures never run on production"; exit 2; }
local H=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r4-20261127 REL=docs/v2/evidence/release-17822b29-20261124
local P6=$FIX/$REL/scripts/r1-p6-observe.sh RB=${R4_RELEASE_RUNBOOK:-$FIX/$REL/RUNBOOK.md} ORIG=${F7_ORIG:-$FIX/$H/orig-aa33f0fc/r1-p6-observe.sh}
[ -f "$P6" ] && [ -f "$RB" ] || { echo "STOP missing $P6 or $RB"; exit 2; }
RD=$(mktemp -d "${TMPDIR:-/tmp}/f7-p6-journal.XXXXXX") || exit 2; trap 'rm -rf -- "$RD"' EXIT
local SD=$RD/shims; mkdir "$SD"
N=0; BADN=0
res() { N=$((N+1)); if [ "$2" = 0 ]; then echo "CASE-RESULT f7-$1 OK ($3 ; got $4)"; else echo "CASE-RESULT f7-$1 UNEXPECTED ($3 ; got $4)"; BADN=$((BADN+1)); fi; }
echo "== f7 $(date -u +%FT%TZ) host=$(hostname 2>/dev/null || cat /etc/hostname) user=$(id -un 2>/dev/null || id -u) container=$([ -f /.dockerenv ] && echo yes || echo no)"
echo "   under test: $(sha256sum < "$P6" | cut -c1-64) r1-p6-observe.sh; $(sha256sum < "$RB" | cut -c1-64) RUNBOOK.md ($RB)"

# ---------------------------------------------------------------- shims
cat > "$SD/sudo" <<'SH'
#!/bin/bash
echo "sudo $*" >> "$F7_DIR/calls"
case $(cat "$F7_DIR/smode" 2>/dev/null) in
  fail) echo "sudo: a password is required" >&2; exit 1;;
  *) exec "$@";;
esac
SH
cat > "$SD/journalctl" <<'SH'
#!/bin/bash
echo "journalctl $*" >> "$F7_DIR/calls"
mode=$(cat "$F7_DIR/jmode")
if [[ $mode == real* ]]; then
  # real journald: only the unit selection changes; everything else is passed on exactly as given
  args=(); while [ $# -gt 0 ]; do if [ "$1" = -u ] && [ "${2:-}" = afldb ]; then args+=(--user -u "$(cat "$F7_DIR/unit")"); shift 2; else args+=("$1"); shift; fi; done
  [ "$mode" = real-nodir ] && args=(-D "$F7_DIR/no-such-journal" "${args[@]}")
  exec /usr/bin/journalctl "${args[@]}"
fi
u=; pri=; since=; out=short; q=0; n=
while [ $# -gt 0 ]; do case $1 in
  -u) u=$2; shift 2;; -p) pri=$2; shift 2;; --since) since=$2; shift 2;; -o) out=$2; shift 2;; -n) n=$2; shift 2;; -q) q=1; shift;; --no-pager) shift;;
  *) echo "f7 journalctl shim: unexpected argument $1" >&2; exit 64;; esac; done
[ "$u" = afldb ] || { echo "f7 journalctl shim: unit '$u' is not afldb" >&2; exit 64; }
entry() { case $out in json) printf '{"PRIORITY":"%s","_SYSTEMD_UNIT":"afldb.service","MESSAGE":"%s"}\n' "$1" "$2";; cat) printf '%s\n' "$2";;
  *) printf 'Nov 24 11:40:0%s afldb-prod node[4242]: %s\n' "$3" "$2";; esac; }
case $mode in
  missing) echo "bash: journalctl: command not found" >&2; exit 127;;
  fail-perm) echo "No journal files were opened due to insufficient permissions." >&2; exit 1;;
  silent-empty) exit 0;;
esac
if [ -z "$pri" ]; then                                  # the control query: newest entry of the unit, any priority
  [ "$n" = 1 ] || { echo "f7 journalctl shim: a query without -p must be the -n 1 control" >&2; exit 64; }
  entry 6 "[afldb] serving build fixture" 0; exit 0
fi
[ "$pri" = err ] || { echo "f7 journalctl shim: priority '$pri' is not err" >&2; exit 64; }
case $mode in fail-since) echo "Failed to parse timestamp: $since" >&2; exit 1;; esac
[ "$since" = "$(cat "$F7_DIR/since")" ] || { echo "f7 journalctl shim: --since '$since' is not the expected interval" >&2; exit 64; }
case $mode in
  none) [ "$q" = 0 ] && [ "$out" = short ] && echo "-- No entries --"; exit 0;;
  one) entry 3 "TypeError: fixture error entry" 1;;
  three) entry 3 "fixture error one" 1; entry 2 "fixture critical two" 2; entry 3 "fixture error three" 3;;
  noise) echo "Hint: You are currently not seeing messages from other users and the system."; entry 3 "fixture error entry" 1;;
  *) echo "f7 journalctl shim: unknown mode $mode" >&2; exit 64;;
esac
SH
chmod 755 "$SD/sudo" "$SD/journalctl"
export F7_DIR=$RD
set_mode() { echo "$1" > "$RD/jmode"; echo "${2:-pass}" > "$RD/smode"; : > "$RD/calls"; }

# ---------------------------------------------------------------- the printed command: runbook = script
SINCE='Tue 2026-11-24 11:33:10 AEDT'; echo "$SINCE" > "$RD/since"
awk '/^At the end of P6/ { f = 1; next } f && /^```/ { c++; next } f && c == 1 { print } c == 2 { exit }' "$RB" > "$RD/rb-block"
( R1_LIB_ONLY=1 . "$P6"; p6_owner_block "$SINCE" ) > "$RD/script-block" 2>&1
sed "s/<since>/$SINCE/" "$RD/rb-block" > "$RD/owner.sh"
{ [ "$(wc -l < "$RD/rb-block")" = 2 ] && [ "$(grep -c '<since>' "$RD/rb-block")" = 1 ] && cmp -s "$RD/owner.sh" "$RD/script-block"; }
res printed-command-runbook-equals-script $? "the section 4.2 block is 2 lines and, with <since> filled in, byte-identical to what p6_owner_block prints" \
  "runbook $(wc -l < "$RD/rb-block") line(s) sha $(sha256sum < "$RD/owner.sh" | cut -c1-12), script sha $(sha256sum < "$RD/script-block" | cut -c1-12)"
{ grep -qxF '  J=$(p6_journal_errs "$SINCE")' "$P6" && grep -qxF 'p6_owner_block "$SINCE"' "$P6" && grep -qF '{ [ "$J" = 0 ] || [ "$J" = unreadable ]; }' "$P6" \
  && grep -qF 'SINCE=$(systemctl show afldb -p ActiveEnterTimestamp --value)' "$P6" && ! grep -q 'wc -l' "$P6"; }
res main-uses-the-tested-functions $? "main's tick calls p6_journal_errs, accepts only 0 or unreadable, prints p6_owner_block, since = ActiveEnterTimestamp, no 'wc -l' left (text check; main is not run)" "exit $?"
o=$( ( R1_LIB_ONLY=1 . "$P6"; p6_owner_block 'x"; echo JOURNAL PASS rc=0 entries=0 #' ) 2>&1 )
{ [[ $o == "NO JOURNAL COMMAND: "*"the journal check is NOT passed" ]] && [ "$(wc -l <<< "$o")" = 1 ]; }
res owner-block-refuses-a-non-timestamp $? "a since value that is not a timestamp prints no command, only 'NO JOURNAL COMMAND ... NOT passed'" "$(cut -c1-60 <<< "$o")"

owner() { ( PATH=$SD:$PATH; bash "${1:-$RD/owner.sh}" ) > "$RD/out" 2> "$RD/err"; echo $? > "$RD/rc"; }
verdict() { tail -n 1 "$RD/out"; }
tick() { ( PATH=$SD:$PATH; R1_LIB_ONLY=1 . "$P6"; p6_journal_errs "${1:-$SINCE}" ) 2>&1; }
WANTQ="journalctl -u afldb -p err --since $SINCE -q -o json --no-pager"

# ================================================================ shim cases: the owner command
echo "-- owner command (shim journalctl with recorded behaviours)"
set_mode none; owner
{ [ "$(verdict)" = 'JOURNAL PASS rc=0 entries=0' ] && [ "$(wc -l < "$RD/out")" = 1 ] && grep -qxF "$WANTQ" "$RD/calls" && grep -qxF "sudo $WANTQ" "$RD/calls"; }
res owner-no-entries-pass $? "successful query (through sudo: unit afldb, -p err, the given --since), no entry: 'JOURNAL PASS rc=0 entries=0'" "'$(verdict)'; query: $(grep -c '^journalctl' "$RD/calls") journalctl call(s)"
set_mode one; owner
[ "$(verdict)" = 'JOURNAL FAIL rc=0 entries=1' ]
res owner-one-error-entry-fail $? "one err entry: 'JOURNAL FAIL rc=0 entries=1'" "'$(verdict)'"
set_mode three; owner
[ "$(verdict)" = 'JOURNAL FAIL rc=0 entries=3' ]
res owner-three-entries-fail $? "three entries (err, crit, err): 'JOURNAL FAIL rc=0 entries=3'" "'$(verdict)'"
set_mode fail-perm; owner
{ [ "$(verdict)" = 'JOURNAL FAIL rc=1 entries=0' ] && grep -q 'insufficient permissions' "$RD/err"; }
res owner-journal-unreadable-fail $? "journalctl exits 1 (no permission): 'JOURNAL FAIL rc=1 entries=0'" "'$(verdict)'"
set_mode fail-since; owner
{ [ "$(verdict)" = 'JOURNAL FAIL rc=1 entries=0' ] && grep -q 'Failed to parse timestamp' "$RD/err"; }
res owner-bad-since-fail $? "journalctl exits 1 (bad --since): 'JOURNAL FAIL rc=1 entries=0'" "'$(verdict)'"
set_mode none fail; owner
{ [ "$(verdict)" = 'JOURNAL FAIL rc=1 entries=0' ] && ! grep -q '^journalctl' "$RD/calls"; }
res owner-sudo-fails-fail $? "sudo exits 1 before journalctl runs: 'JOURNAL FAIL rc=1 entries=0'" "'$(verdict)'; journalctl calls $(grep -c '^journalctl' "$RD/calls")"
set_mode missing; owner
[ "$(verdict)" = 'JOURNAL FAIL rc=127 entries=0' ]
res owner-journalctl-missing-fail $? "journalctl cannot be run (exit 127): 'JOURNAL FAIL rc=127 entries=0'" "'$(verdict)'"
set_mode noise; owner
[[ $(verdict) == 'JOURNAL FAIL rc=0 entries=1' ]]
res owner-notice-plus-entry-fail $? "a notice line and one entry on stdout: FAIL (any output fails), entries=1" "'$(verdict)'"

# ================================================================ shim cases: the tick classification
echo "-- tick classification p6_journal_errs (shim journalctl)"
tk() { # case mode expected description
  set_mode "$2"; local got; got=$(tick); [ "$got" = "$3" ]; res "$1" $? "$4: journal_err_lines=$3" "journal_err_lines=$got"; }
tk tick-no-entries none 0 "control and query succeed, no entry"
tk tick-one-entry one 1 "one err entry (tick not OK)"
tk tick-three-entries three 3 "three entries (tick not OK)"
tk tick-no-permission fail-perm unreadable "journalctl exits 1 (no permission)"
tk tick-bad-since fail-since unreadable "control succeeds, the err query exits 1"
tk tick-silent-empty silent-empty unreadable "exit 0 but the control returns nothing (cannot see the unit's journal)"
tk tick-journalctl-missing missing unreadable "journalctl cannot be run"
tk tick-non-json-output noise unreadable "a non-JSON line in the answer"

# ================================================================ contrast: the original lines
if [ -f "$ORIG" ]; then
  echo "-- contrast: the original owner line and tick line ($(sha256sum < "$ORIG" | cut -c1-12) r1-p6-observe.sh, aa33f0fc)"
  sed -n 's/^echo "OWNER NOW (one line, sudo): \(.*\)   (expect 1, .*$/\1/p' "$ORIG" | sed 's/\\"\$SINCE\\"/"'"$SINCE"'"/' > "$RD/orig-owner.sh"
  sed -n 's/^  J=\$(\(journalctl .*\))$/\1/p' "$ORIG" > "$RD/orig-tick"
  if [ "$(cat "$RD/orig-owner.sh")" = "sudo journalctl -u afldb -p err --since \"$SINCE\" --no-pager | wc -l" ] && [ -s "$RD/orig-tick" ]; then
    set_mode none; owner "$RD/orig-owner.sh"; a=$(verdict)
    set_mode one; owner "$RD/orig-owner.sh"; b=$(verdict); brc=$(cat "$RD/rc")
    { [ "$a" = 1 ] && [ "$b" = 1 ] && [ "$brc" = 0 ]; }
    res contrast-orig-owner-one-error-prints-1 $? "DEFECT shown: the original line prints the expected '1' both for no entries and for one real error entry" "no entries -> '$a'; one error entry -> '$b' (exit $brc)"
    set_mode fail-perm; owner "$RD/orig-owner.sh"; c=$(verdict); crc=$(cat "$RD/rc")
    set_mode none fail; owner "$RD/orig-owner.sh"; d=$(verdict); drc=$(cat "$RD/rc")
    { [ "$crc" = 0 ] && [ "$drc" = 0 ] && [ "$c" = 0 ] && [ "$d" = 0 ]; }
    res contrast-orig-owner-failed-query-exit-0 $? "DEFECT shown: a failed journalctl and a failed sudo both end with exit 0 (the pipe hides the status); the count printed is 0, with the error only on stderr" \
      "journalctl failed -> '$c' exit $crc; sudo failed -> '$d' exit $drc"
    # the original line is evaluated as its main ran it: under set -o pipefail (the first argument turns it off for comparison)
    otick() { local v; v=$( ( PATH=$SD:$PATH; SINCE=$2; set "$1" pipefail; eval "$(cat "$RD/orig-tick")" ) 2>&1 ); echo "${v//$'\n'/<newline>}"; }
    set_mode fail-perm; e=$(otick -o "$SINCE"); e2=$(otick +o "$SINCE"); set_mode missing; f=$(otick -o "$SINCE")
    { [ "$e" = '0<newline>unreadable' ] && [ "$f" = '0<newline>unreadable' ] && [ "$e2" = 0 ]; }
    res contrast-orig-tick-failed-query-never-unreadable $? "DEFECT shown: when journalctl fails or cannot be run the original tick line never yields 'unreadable': under the script's own pipefail it yields the two-line value '0<newline>unreadable' (neither accepted value: the tick is NOT OK and its line is split), without pipefail a plain 0"       "no permission -> '$e' (without pipefail '$e2'); missing -> '$f'"
  else res contrast-orig-lines-found 1 "the original owner line and tick line in $ORIG" "not found as expected: '$(cat "$RD/orig-owner.sh")'"; fi
else
  echo "NOTE original script not found ($ORIG): contrast skipped"; res contrast-original-present 1 "the aa33f0fc original for the contrast" "missing"
fi

# ================================================================ real journald (streamanator as arm only)
if [ ! -f /.dockerenv ] && [ -x /usr/bin/journalctl ] && command -v systemd-run > /dev/null 2>&1 && systemctl --user show-environment > /dev/null 2>&1; then
  echo "-- real journald $(/usr/bin/journalctl --version | head -n 1): transient user units, the printed command and the tick unchanged"
  local U=r4dev-f67-$$-$(date +%s) RS; RS=$(date -d '-2 seconds' '+%a %Y-%m-%d %H:%M:%S %Z')
  systemd-run --user --unit "$U-clean" --quiet --wait --collect sh -c 'echo "<6>f7 fixture info entry (clean unit)"; sleep 1' > "$RD/sr1" 2>&1; r1=$?
  systemd-run --user --unit "$U-err" --quiet --wait --collect sh -c 'echo "<3>f7 fixture error entry"; echo "<6>f7 fixture info entry"; sleep 1' > "$RD/sr2" 2>&1; r2=$?
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    [ "$(/usr/bin/journalctl --user -u "$U-clean" -o cat -q --no-pager 2>/dev/null | grep -c 'f7 fixture info entry')" = 1 ] \
      && [ "$(/usr/bin/journalctl --user -u "$U-err" -o cat -q --no-pager 2>/dev/null | grep -c 'f7 fixture')" = 2 ] && break; sleep 0.5; done
  echo "   units $U-clean (exit $r1), $U-err (exit $r2); since '$RS'"
  sed "s/<since>/$RS/" "$RD/rb-block" > "$RD/owner-real.sh"; echo "$RS" > "$RD/since"
  ( R1_LIB_ONLY=1 . "$P6"; p6_owner_block "$RS" ) | cmp -s - "$RD/owner-real.sh"
  res real-printed-command-identical $? "with the real since value the runbook block and the script's printed block are byte-identical" "cmp exit $?"
  echo "$U-clean" > "$RD/unit"; set_mode real; owner "$RD/owner-real.sh"; v=$(verdict); g=$(tick "$RS")
  { [ "$v" = 'JOURNAL PASS rc=0 entries=0' ] && [ "$g" = 0 ]; }
  res real-no-error-entries-pass $? "real journal, unit with one info entry: 'JOURNAL PASS rc=0 entries=0', tick 0" "'$v', tick $g"
  echo "$U-err" > "$RD/unit"; set_mode real; owner "$RD/owner-real.sh"; v=$(verdict); g=$(tick "$RS")
  { [ "$v" = 'JOURNAL FAIL rc=0 entries=1' ] && [ "$g" = 1 ]; }
  res real-one-error-entry-fail $? "real journal, unit with one <3> entry and one <6> entry: 'JOURNAL FAIL rc=0 entries=1', tick 1" "'$v', tick $g"
  sed "s/<since>/not-a-time/" "$RD/rb-block" > "$RD/owner-bad.sh"; set_mode real; owner "$RD/owner-bad.sh"; v=$(verdict); g=$(tick not-a-time)
  { [ "$v" = 'JOURNAL FAIL rc=1 entries=0' ] && grep -q 'Failed to parse timestamp' "$RD/err" && [ "$g" = unreadable ]; }
  res real-failed-query-bad-since-fail $? "real journalctl refuses the --since value (exit 1), same unit that has an error entry: 'JOURNAL FAIL rc=1 entries=0', tick unreadable" "'$v', tick $g, stderr '$(head -n 1 "$RD/err" | cut -c1-50)'"
  echo "$U-clean" > "$RD/unit"; set_mode real-nodir; owner "$RD/owner-real.sh"; v=$(verdict); g=$(tick "$RS")
  { [ "$v" = 'JOURNAL FAIL rc=1 entries=0' ] && grep -q 'Failed to open' "$RD/err" && [ "$g" = unreadable ]; }
  res real-failed-query-no-journal-fail $? "real journalctl cannot open the journal (-D on a missing directory, exit 1): 'JOURNAL FAIL rc=1 entries=0', tick unreadable" "'$v', tick $g, stderr '$(head -n 1 "$RD/err" | sed "s|$RD|<run>|" | cut -c1-60)'"
  echo "$U-never-ran" > "$RD/unit"; set_mode real; g=$(tick "$RS")
  [ "$g" = unreadable ]
  res real-tick-unit-with-no-visible-entry $? "real journal, a unit with no entry at all (what a user who cannot see the unit's journal gets, exit 0): tick unreadable, not 0" "tick $g"
  if [ -f "$RD/orig-owner.sh" ] && [ -s "$RD/orig-tick" ]; then
    sed "s/$SINCE/$RS/" "$RD/orig-owner.sh" > "$RD/orig-owner-real.sh"
    echo "$U-err" > "$RD/unit"; set_mode real; owner "$RD/orig-owner-real.sh"; v=$(verdict)
    set_mode real-nodir; g=$(otick -o "$RS")
    { [ "$v" = 1 ] && [ "$g" = '0<newline>unreadable' ]; }
    res real-contrast-orig-false-pass $? "DEFECT shown on the real journal: the original owner line prints the expected '1' for the unit with one error entry; the original tick line gives '0<newline>unreadable' when the real journalctl fails" "owner '$v', tick '$g'"
  fi
else
  echo "NOTE no usable systemd user session here (container=$([ -f /.dockerenv ] && echo yes || echo no)): the real-journald cases were not run; shim cases only"
fi

if [ "$BADN" = 0 ]; then echo "SUITE f7 RESULT PASS ($N cases)"; exit 0; else echo "SUITE f7 RESULT FAIL ($BADN unexpected)"; exit 1; fi
}
main "$@"
