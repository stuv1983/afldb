#!/usr/bin/env bash
# FIXTURE SUITE f5 (R6 r4, 27 Nov 2026; review finding 5: rehearsal cleanup ownership). Plain user, no root, no network, no
# container needed: Linux bash + coreutils (arm on streamanator in a private directory, or the pinned container), and it also
# runs under Git Bash on the workstation (where the real driver's workstation half runs). It contacts no host: ssh, ssh.exe, git
# and docker are recording shims first on PATH, and every path it creates is under its own `mktemp -d` (below $TMPDIR, default
# /tmp), removed on exit. It never names a real /tmp/afldb-r6-* or /tmp/r6reh* path.
# What it executes, always the REAL bytes below <FIX>:
#   review-fixes-20261123/run-printed-blocks.sh, rehearse-r6-fixes.sh   the retired r2 entry points (must refuse, exit 2)
#   review-fixes-r3-20261124/run-printed-blocks.sh                       the r3/r4 driver, SOURCED with R6_REH_LIB_ONLY=1, so
#     the cases call its real set_tag, blk, ws_reserve, acquire_ws, run_block1, run_block2, ws_release, cleanup (with its real
#     remote cleanup text) and arm_trap. The fixture only (a) points TAR/RTAR at files inside its own directory, (b) replaces
#     the transport rsh with local execution (the "streamanator" side is a second directory), and (c) supplies stand-in printed
#     blocks with the same write semantics: block 1 truncates and rewrites the archive path in place (as `git archive
#     --output=` does), block 2 is the printed remote command `set -C; cat > <path>` fed the local archive.
#   review-fixes-r4-20261127/orig-aa33f0fc/r3-run-printed-blocks.sh      the ORIGINAL r3 driver (contrast; override with
#     F5_ORIG_DRIVER): its cleanup() and its two ownership lines are cut out of that file and evaluated unchanged.
# Cases: static + executed refusal of the r2 entry points; the lib seam and an unknown tag cannot produce a run; tag selection;
# the exact race (both runs pass the existence check before either creates) on the workstation side and on the streamanator
# side, new logic and original logic; a concurrent loop (F5_LOOPS, default 50, two background runs per iteration) per side;
# partial failures; TERM through the driver's own trap. In the loops and the race the losing run also runs cleanup (the driver
# exits 2 without it on the workstation side), which is the stronger test.
# Usage: bash cases/f5-cleanup-ownership.sh <FIX> [<STAGE>]     (<STAGE> is accepted and unused: no staged R6 script is involved)
# Output: one `CASE-RESULT f5-<case> OK|UNEXPECTED (<expected> ; got <actual>)` per case, then `SUITE f5 RESULT PASS (<n> cases)`
# exit 0, or `SUITE f5 RESULT FAIL (<k> unexpected)` exit 1. F5_VERBOSE=1 also prints each case's raw output.
set -uo pipefail; export LC_ALL=C
F5_FIX=$(cd "${1:?FIX: root of a clean export of the tested commit}" && pwd) || exit 2
F5_E=docs/v2/evidence/backlog-20261121/r6-20261125
F5_DRV=$F5_FIX/$F5_E/review-fixes-r3-20261124/run-printed-blocks.sh
F5_R2=$F5_FIX/$F5_E/review-fixes-20261123
F5_ORIG=${F5_ORIG_DRIVER:-$F5_FIX/$F5_E/review-fixes-r4-20261127/orig-aa33f0fc/r3-run-printed-blocks.sh}
F5_LOOPS=${F5_LOOPS:-50}; F5_AN=afldb-r6-20261125-r3.tar; F5_N=0
F5_T=$(mktemp -d "${TMPDIR:-/tmp}/f5-own.XXXXXX") || exit 2
trap 'rm -rf -- "$F5_T"' EXIT
mkdir "$F5_T/bin"; : > "$F5_T/calls"
for c in ssh ssh.exe git docker scp; do printf '#!/usr/bin/env bash\necho "%s $*" >> "%s"\nexit 0\n' "$c" "$F5_T/calls" > "$F5_T/bin/$c"; chmod +x "$F5_T/bin/$c"; done
head -c 262144 /dev/urandom > "$F5_T/src.bin"; F5_SUM=$(sha256sum < "$F5_T/src.bin" | cut -c1-64)

res() { # case cond(0=ok) expected got
  if [ "$2" = 0 ]; then echo "CASE-RESULT f5-$1 OK ($3 ; got $4)"; else echo "CASE-RESULT f5-$1 UNEXPECTED ($3 ; got $4)"; fi; }
case_run() { # case function: the function runs in a subshell; exactly one result line comes out whatever happens in it
  local out; F5_N=$((F5_N+1)); out=$("$2" 2>&1)
  if grep -q "^CASE-RESULT f5-$1 " <<< "$out"; then grep "^CASE-RESULT f5-$1 " <<< "$out" | head -1
  else echo "CASE-RESULT f5-$1 UNEXPECTED (one result line ; got none, last output: $(tail -3 <<< "$out" | tr '\n' ' '))"; fi
  [ -z "${F5_VERBOSE:-}" ] || sed 's/^/    | /' <<< "$out"; }
waitfile() { local n=0; while [ ! -e "$1" ] && [ "$n" -lt 400 ]; do sleep 0.05; n=$((n+1)); done; [ -e "$1" ]; }
mkhost() { # a directory standing for one host's /tmp, holding unrelated directories named like real roots and other runs' dirs
  local d; mkdir -p "$1"
  for d in afldb-r6-20261125-r3.Ab12Cd afldb-r6-20261125-r4.Ef34Gh afldb-r6-20261125-r2.Ij56Kl r6reh.20261127T000000Z-1-1.Mn78Op r6reh-ws.20261127T000000Z-1-1.Qr90St; do
    mkdir "$1/$d" && printf 'unrelated %s\n' "$d" > "$1/$d/keep.txt"; done; }
snapd() { # everything in a host directory except the archive path: names, types, inodes and file bytes
  (cd "$1" && find . -mindepth 1 ! -name "$F5_AN" -printf '%y %p %i\n' | sort && find . -type f ! -name "$F5_AN" -exec sha256sum {} + | sort) | sha256sum | cut -c1-16; }
mkblocks() { # dir suffix local-archive-path remote-archive-path : stand-in printed blocks 1 and 2 for those exact paths
  printf "cat '%s' > '%s' &&\n  sha256sum '%s'\n" "$F5_T/src.bin" "$3" "$3" > "$1/b1$2.sh"
  printf "bash -c 'set -C; cat > %s' < %s\n" "$4" "$3" > "$1/b2$2.sh"; }
state() { echo "$(stat -c '%d:%i' -- "$1" 2>/dev/null) $(sha256sum < "$1" 2>/dev/null | cut -c1-64)"; }
load() { # the REAL driver functions; then the three fixture substitutions (paths are set by each case)
  R6_REH_LIB_ONLY=1; . "$F5_DRV" || exit 97; set_tag r3 || exit 97; PATH=$F5_T/bin:$PATH
  rsh() { if [ "$1" = bash ]; then "$@"; else bash -c "$1"; fi; }; }
load_orig() { # the ORIGINAL driver's cleanup() and its two ownership lines, cut from the file and evaluated unchanged
  [ -r "$F5_ORIG" ] || return 1
  eval "$(sed -n '/^cleanup() {/,/^}/p' "$F5_ORIG")"
  O_CLAIM=$(grep -F '[ -f "$TAR" ] && MADE_TAR=1 && TARSUM=' "$F5_ORIG"); O_RCLAIM=$(grep -F '[ -n "$RSUM" ] && MADE_RTAR=1' "$F5_ORIG")
  [ "$(wc -l <<< "$O_CLAIM")" = 1 ] && [ -n "$O_CLAIM" ] && [ "$(wc -l <<< "$O_RCLAIM")" = 1 ] && [ -n "$O_RCLAIM" ] && declare -F cleanup >/dev/null || return 1
  f5ssh() { if [ "$1" = bash ]; then "$@"; else bash -c "$1"; fi; }; SSH=(f5ssh); PATH=$F5_T/bin:$PATH
  BAD=0; STEPS=0; WS=; RUN=; STAGE_WS=; TARSUM=; MADE_TAR=0; MADE_RTAR=0; RID=orig; TAR=; }
F5_VARS="RID OWN_TAR TRY_TAR TAR_STATE TAR_ID TARSUM TRY_RTAR OWN_RTAR RTAR_ID WS RUN STAGE_WS BAD STEPS TAR RTAR"
F5_OVARS="RID MADE_TAR MADE_RTAR TARSUM WS RUN STAGE_WS BAD STEPS TAR"
save() { local v; for v in ${3:-$F5_VARS}; do printf -v "CTX_$1_$v" %s "${!v}"; done; }   # one process, two runs: swap the run's variables
use() { local v n; for v in ${3:-$F5_VARS}; do n=CTX_$1_$v; printf -v "$v" %s "${!n}"; done; }

# ---- 5a: the retired r2 entry points
first2() { grep -v '^#' "$1" | grep -v '^[[:space:]]*$' | head -2; }
F5_RE='^echo "REFUSED: RETIRED 27 Nov 2026: [^"$`\\]*" >&2$'   # a constant string: no expansion can change what it prints
static_ok() { local l; l=$(first2 "$1"); [[ $(sed -n 1p <<< "$l") =~ $F5_RE ]] && [ "$(sed -n 2p <<< "$l")" = "exit 2" ]; }
c_r2_static() { local a=1 b=1
  static_ok "$F5_R2/run-printed-blocks.sh" && a=0; static_ok "$F5_R2/rehearse-r6-fixes.sh" && b=0
  res r2-static "$((a+b))" "the first two commands of both r2 scripts are the unconditional REFUSED echo and exit 2" "driver=$a container-runner=$b (0 = yes)"; }
scratch_run() { # dir script args... : run the real script in a scratch cwd/HOME/TMPDIR with recording shims; sets S_RC S_OUT S_SAME S_CALLS
  local d=$1 s0; shift; mkdir -p "$d/cwd" "$d/home" "$d/tmp"; mkhost "$d/tmp"; printf 'keep\n' > "$d/cwd/sentinel.txt"
  mkdir -p "$d/cwd/C:/Windows/System32/OpenSSH" 2>/dev/null && cp "$F5_T/bin/ssh.exe" "$d/cwd/C:/Windows/System32/OpenSSH/ssh.exe" 2>/dev/null
  s0=$(cd "$d" && find . -printf '%y %p %i\n' | sort | sha256sum); : > "$F5_T/calls"
  S_OUT=$(cd "$d/cwd" && HOME=$d/home TMPDIR=$d/tmp PATH=$F5_T/bin:$PATH "$@" 2>&1); S_RC=$?
  [ "$(cd "$d" && find . -printf '%y %p %i\n' | sort | sha256sum)" = "$s0" ] && S_SAME=yes || S_SAME=no
  S_CALLS=$(wc -l < "$F5_T/calls"); }
c_r2_refuse() { local d=$F5_T/r2
  static_ok "$F5_R2/run-printed-blocks.sh" || { res r2-refuse 1 "exit 2 with the RETIRED refusal" "not executed: the static check failed"; return; }
  scratch_run "$d" bash "$F5_R2/run-printed-blocks.sh" "$d/cwd/worktree" "$d/out"
  [ "$S_RC" = 2 ] && [[ $S_OUT == "REFUSED: RETIRED 27 Nov 2026: the r2 rehearsal driver must not be run again"* ]] && [ "$(wc -l <<< "$S_OUT")" = 1 ] \
    && [ ! -e "$d/out" ] && [ "$S_SAME" = yes ] && [ "$S_CALLS" = 0 ]
  res r2-refuse $? "exit 2, one line 'REFUSED: RETIRED 27 Nov 2026: the r2 rehearsal driver must not be run again...', output dir not created, scratch tree and sentinels unchanged, 0 ssh/git/docker calls" \
    "exit $S_RC, '${S_OUT:0:76}...', out dir $([ -e "$d/out" ] && echo created || echo absent), tree unchanged=$S_SAME, calls=$S_CALLS"; }
c_r2_remote_refuse() { local d=$F5_T/r2c
  static_ok "$F5_R2/rehearse-r6-fixes.sh" || { res r2-remote-refuse 1 "exit 2 with the RETIRED refusal" "not executed: the static check failed"; return; }
  scratch_run "$d" bash "$F5_R2/rehearse-r6-fixes.sh" "$d/tmp/afldb-r6-20261125-r2.Ij56Kl" "$d/cwd/fixture"
  [ "$S_RC" = 2 ] && [[ $S_OUT == "REFUSED: RETIRED 27 Nov 2026: the r2 container rehearsal must not be run again"* ]] && [ "$(wc -l <<< "$S_OUT")" = 1 ] \
    && [ "$S_SAME" = yes ] && [ "$S_CALLS" = 0 ]
  res r2-remote-refuse $? "exit 2, one line 'REFUSED: RETIRED 27 Nov 2026: the r2 container rehearsal must not be run again...', scratch tree unchanged, 0 docker calls" \
    "exit $S_RC, '${S_OUT:0:76}...', tree unchanged=$S_SAME, calls=$S_CALLS"; }

# ---- 5b: the seam and the tag
c_lib_exec_refused() { local d=$F5_T/libx
  scratch_run "$d" env R6_REH_LIB_ONLY=1 bash "$F5_DRV" cdeaf31f "$d/out"
  [ "$S_RC" = 2 ] && [[ $S_OUT == "REFUSED: R6_REH_LIB_ONLY=1 is for sourcing by a fixture"* ]] && [ ! -e "$d/out" ] && [ "$S_SAME" = yes ] && [ "$S_CALLS" = 0 ]
  res lib-exec-refused $? "an EXECUTED driver with R6_REH_LIB_ONLY=1: exit 2 'REFUSED: R6_REH_LIB_ONLY=1 is for sourcing...', no output dir, nothing created, 0 ssh/git calls" \
    "exit $S_RC, '${S_OUT:0:60}...', out dir $([ -e "$d/out" ] && echo created || echo absent), tree unchanged=$S_SAME, calls=$S_CALLS"; }
c_bad_tag_refused() { local d=$F5_T/tagx
  scratch_run "$d" bash "$F5_DRV" cdeaf31f "$d/out" r5
  [ "$S_RC" = 2 ] && [[ $S_OUT == "REFUSED: unknown tag 'r5' (r3 or r4); nothing was created" ]] && [ ! -e "$d/out" ] && [ "$S_SAME" = yes ] && [ "$S_CALLS" = 0 ]
  res bad-tag-refused $? "tag r5: exit 2 'REFUSED: unknown tag 'r5' (r3 or r4); nothing was created', no output dir, nothing created, 0 ssh/git calls" \
    "exit $S_RC, '$S_OUT', out dir $([ -e "$d/out" ] && echo created || echo absent), tree unchanged=$S_SAME, calls=$S_CALLS"; }
c_tag_select() { local d=$F5_T/tag rb b=docs/v2/evidence/backlog-20261121 e=docs/v2/evidence/release-17822b29-20261124 a3 a4 p miss= r5
  mkdir -p "$d"; rb=$d/runbook.md
  printf '%s\n' '# plan' '## Amendment — 23 November 2026 (r2), old' '```bash' 'r2-one' '```' '## Amendment — 24 November 2026 (r3), fixes' 'text' \
    '```bash' 'r3-one' '```' '```' 'not bash' '```' '```bash' 'r3-two' 'r3-two-b' '```' '## Amendment — 27 November 2026 (r4)' '```bash' 'r4-one' '```' \
    'text' '```bash' 'r4-two' '```' > "$rb"
  load
  a3="$TAG|$TAR|$RTAR|${H##*/}|$REH|$(blk 1 "$rb" | tr '\n' ,)|$(blk 2 "$rb" | tr '\n' ,)|${#FIXPATHS[@]}"
  set_tag r4
  a4="$TAG|$TAR|$RTAR|${H##*/}|$REH|$(blk 1 "$rb" | tr '\n' ,)|$(blk 2 "$rb" | tr '\n' ,)"
  for p in deploy tests/deploy-release.test.ts "$e/scripts" "$e/rehearsal" "$e/RUNBOOK.md" "$b/a1a2-20261124" "$b/r6-20261125/review-fixes-r3-20261124" "$b/r6-20261125/review-fixes-r4-20261127" \
    tools/build/env-in-standalone.mjs tools/maintenance/scheduled-backup.sh "$b/r6-20261125/review-fixes-20261123/orig-r6-pre-verify-58e35ce8.sh"; do
    [[ " ${FIXPATHS[*]} " == *" $p "* ]] || miss="$miss $p"; done
  set_tag r5; r5=$?
  [ "$a3" = "r3|/tmp/afldb-r6-20261125-r3.tar|/tmp/afldb-r6-20261125-r3.tar|review-fixes-r3-20261124|rehearse-r3.sh|r3-one,|r3-two,r3-two-b,|11" ] \
    && [ "$a4" = "r4|/tmp/afldb-r6-20261125-r4.tar|/tmp/afldb-r6-20261125-r4.tar|review-fixes-r4-20261127|rehearse-r4.sh|r4-one,|r4-two," ] && [ -z "$miss" ] && [ "$r5" = 1 ] && [ "$TAG" = r4 ]
  res tag-select $? "r3 and r4 each select their own heading, archive path, harness dir and runner; r4 export list complete; r5 rejected" "r3 [$a3] r4 [$a4] missing [$miss] r5 rc $r5"; }

# ---- 5b: the exact race, one process, the two runs' variables swapped between steps
c_ws_det_race() { local D=$F5_T/wsdet P s0 s1 s2 cA=no cB=no rA rA1 rB ownB own after oB oA rcA gone=no
  mkhost "$D/ws"; P=$D/ws/$F5_AN; mkblocks "$D" "" "$P" "$D/none"; s0=$(snapd "$D/ws")
  load; TAR=$P; RTAR=$D/none
  RID=runA; save A; RID=runB; save B
  [ ! -e "$P" ] && cA=yes; [ ! -e "$P" ] && cB=yes                                   # both runs pass the existence check first
  use A; ws_reserve "$P"; rA=$?; run_block1 "$D/b1.sh" "$P" >/dev/null 2>&1; rA1=$?; save A; own=$(state "$P")
  use B; ws_reserve "$P"; rB=$?; ownB=$OWN_TAR; oB=$(cleanup 2>&1); after=$(state "$P"); s1=$(snapd "$D/ws")   # the loser, then ITS cleanup
  use A; oA=$(cleanup 2>&1); rcA=$?; [ ! -e "$P" ] && gone=yes; s2=$(snapd "$D/ws")
  [ "$cA$cB" = yesyes ] && [ "$rA" = 0 ] && [ "$rA1" = 0 ] && [ "$rB" = 1 ] && [ "$ownB" = 0 ] && [ "$after" = "$own" ] && [ "${own#* }" = "$F5_SUM" ] \
    && [[ $oB == *"not removing $P (workstation): this run did not create it"* ]] && [ "$s1" = "$s0" ] && [ "$rcA" = 0 ] && [ "$gone" = yes ] && [ "$s2" = "$s0" ] \
    && [[ $oA == *"removed $P (workstation; this run reserved and wrote it"* ]]
  res ws-det-race $? "both pass the existence check; A's exclusive create succeeds, B's fails (no ownership); after B's cleanup A's archive is the same inode and bytes; unrelated dirs intact; A's cleanup then removes exactly its archive" \
    "checks A=$cA B=$cB; reserve A=$rA B=$rB (B owns=$ownB); archive after loser cleanup $([ "$after" = "$own" ] && echo "unchanged ($after)" || echo "CHANGED '$after' was '$own'"); unrelated dirs after loser $([ "$s1" = "$s0" ] && echo intact || echo CHANGED); winner cleanup rc $rcA, archive gone=$gone, unrelated dirs $([ "$s2" = "$s0" ] && echo intact || echo CHANGED)"; }
c_ws_det_race_orig() { local D=$F5_T/wsdeto P cA=no cB=no own after mB
  mkhost "$D/ws"; P=$D/ws/$F5_AN; mkblocks "$D" "" "$P" "$D/none"
  load_orig || { res ws-det-race-orig 1 "the original driver's cleanup() and ownership lines" "not found in $F5_ORIG"; return; }
  TAR=$P; RID=runA; save A "" "$F5_OVARS"; RID=runB; save B "" "$F5_OVARS"
  [ ! -e "$P" ] && cA=yes; [ ! -e "$P" ] && cB=yes
  use A "" "$F5_OVARS"; bash "$D/b1.sh" >/dev/null; eval "$O_CLAIM" >/dev/null; save A "" "$F5_OVARS"; own=$(state "$P")
  use B "" "$F5_OVARS"; bash "$D/b1.sh" >/dev/null; eval "$O_CLAIM" >/dev/null; mB=$MADE_TAR; cleanup >/dev/null 2>&1; after=$(state "$P")
  [ "$cA$cB" = yesyes ] && [ "$mB" = 1 ] && [ "${own#* }" = "$F5_SUM" ] && [ ! -e "$P" ]
  res ws-det-race-orig $? "CONTRAST, original r3 logic (aa33f0fc): the second run also claims the archive (MADE_TAR=1) and its cleanup REMOVES the first run's archive" \
    "checks A=$cA B=$cB; B MADE_TAR=$mB; first run's archive after B's cleanup: $([ -e "$P" ] && echo "still there ($after)" || echo REMOVED)"; }
c_rt_det_race() { local D=$F5_T/rtdet PA PB R s0 s1 s2 cA=no cB=no rA rB ownB own after oB oA rcB rcA
  mkhost "$D/wsA"; mkhost "$D/wsB"; mkhost "$D/rt"; PA=$D/wsA/$F5_AN; PB=$D/wsB/$F5_AN; R=$D/rt/$F5_AN
  mkblocks "$D" A "$PA" "$R"; mkblocks "$D" B "$PB" "$R"; s0=$(snapd "$D/rt")
  load; RTAR=$R
  RID=runA; TAR=$PA; ws_reserve "$PA" && run_block1 "$D/b1A.sh" "$PA" >/dev/null 2>&1; save A
  RID=runB; TAR=$PB; OWN_TAR=0; TRY_TAR=0; TAR_STATE=none; TAR_ID=; TARSUM=; ws_reserve "$PB" && run_block1 "$D/b1B.sh" "$PB" >/dev/null 2>&1; save B
  rsh "test ! -e $R" && cA=yes; rsh "test ! -e $R" && cB=yes                         # both runs pass the remote existence check first
  use A; run_block2 "$D/b2A.sh" "$R" >/dev/null 2>&1; rA=$?; save A; own=$(state "$R")
  use B; run_block2 "$D/b2B.sh" "$R" > "$D/o" 2>&1; rB=$?; ownB=$OWN_RTAR; oB=$(cat "$D/o")
  oB="$oB $(cleanup 2>&1)"; rcB=$?; after=$(state "$R"); s1=$(snapd "$D/rt")
  use A; oA=$(cleanup 2>&1); rcA=$?; s2=$(snapd "$D/rt")
  [ "$cA$cB" = yesyes ] && [ "$rA" = 0 ] && [ "$rB" = 1 ] && [ "$ownB" = 0 ] && [ "$after" = "$own" ] && [ "${own#* }" = "$F5_SUM" ] && [ "$s1" = "$s0" ] \
    && [[ $oB == *"STOP block 2 did not create $R on streamanator"*"collision"* ]] && [[ $oB == *"not removing $R on streamanator: this run did not create it"* ]] \
    && [ ! -e "$PB" ] && [ "$rcA" = 0 ] && [ ! -e "$R" ] && [ ! -e "$PA" ] && [ "$s2" = "$s0" ] && [[ $oA == *"removed $R on streamanator (created by this run's block 2"* ]]
  res rt-det-race $? "both pass the remote existence check; A's block 2 (set -C) creates, B's fails: B STOPs with the collision reason, owns nothing remote, its cleanup leaves A's archive (same inode, bytes) and removes its own workstation archive; A's cleanup removes exactly its archives" \
    "checks A=$cA B=$cB; block 2 A=$rA B=$rB (B owns=$ownB); remote archive after loser cleanup $([ "$after" = "$own" ] && echo "unchanged ($after)" || echo "CHANGED '$after' was '$own'"); loser's own workstation archive $([ -e "$PB" ] && echo LEFT || echo removed); unrelated remote dirs $([ "$s1$s2" = "$s0$s0" ] && echo intact || echo CHANGED); winner cleanup rc $rcA, remote archive $([ -e "$R" ] && echo LEFT || echo gone)"; }
c_rt_det_race_orig() { local D=$F5_T/rtdeto R cA=no cB=no own rA rB mB after
  mkhost "$D/rt"; R=$D/rt/$F5_AN; mkblocks "$D" "" "$F5_T/src.bin" "$R"; rm -f "$D/b1.sh"   # block 2 only, fed the same bytes
  load_orig || { res rt-det-race-orig 1 "the original driver's cleanup() and ownership lines" "not found in $F5_ORIG"; return; }
  TAR=$R; TARSUM=$F5_SUM; RID=runA; save A "" "$F5_OVARS"; RID=runB; save B "" "$F5_OVARS"   # MADE_TAR=0: only the remote half is under test
  f5ssh "test ! -e $R" && cA=yes; f5ssh "test ! -e $R" && cB=yes
  use A "" "$F5_OVARS"; bash "$D/b2.sh" 2>/dev/null; rA=$?; eval "$O_RCLAIM"; save A "" "$F5_OVARS"; own=$(state "$R")
  use B "" "$F5_OVARS"; bash "$D/b2.sh" 2>/dev/null; rB=$?; eval "$O_RCLAIM"; mB=$MADE_RTAR; cleanup >/dev/null 2>&1; after=$(state "$R")
  [ "$cA$cB" = yesyes ] && [ "$rA" = 0 ] && [ "$rB" != 0 ] && [ "$mB" = 1 ] && [ "${own#* }" = "$F5_SUM" ] && [ ! -e "$R" ]
  res rt-det-race-orig $? "CONTRAST, original r3 logic (aa33f0fc): B's block 2 fails on noclobber, yet B sets MADE_RTAR=1 from the winner's file and its cleanup REMOVES the winner's archive" \
    "checks A=$cA B=$cB; block 2 A=$rA B=$rB; B MADE_RTAR=$mB; winner's archive after B's cleanup: $([ -e "$R" ] && echo "still there ($after)" || echo REMOVED)"; }

# ---- 5b: genuinely concurrent runs (two background processes per iteration, released together)
ws_loop_run() { # me other dir path iteration
  ( load; RID=run$1-$5; TAR=$4; RTAR=$3/none; arm_trap; : > "$3/ready.$1"
    n=0; while [ ! -e "$3/go" ] && [ "$n" -lt 3000000 ]; do n=$((n+1)); done
    acquire_ws "$TAR"; rc=$?
    [ "$rc" = 0 ] || { cleanup; : > "$3/done.$1"; exit "$rc"; }
    run_block1 "$3/b1.sh" "$TAR" || { cleanup; : > "$3/done.$1"; exit 1; }
    state "$TAR" > "$3/own.$1"; waitfile "$3/done.$2"; state "$TAR" > "$3/after.$1"
    cleanup; rc=$?; : > "$3/done.$1"; exit "$rc" ) > "$3/out.$1" 2>&1; }
c_ws_loop() { local D=$F5_T/wsloop P s0 i good=0 wa=0 wb=0 excl=0 first= ra rb w l pa pb
  mkhost "$D/ws"; P=$D/ws/$F5_AN; mkblocks "$D" "" "$P" "$D/none"; s0=$(snapd "$D/ws")
  for ((i = 1; i <= F5_LOOPS; i++)); do
    rm -f "$D"/go "$D"/ready.* "$D"/done.* "$D"/own.* "$D"/after.* "$D"/out.*
    ws_loop_run A B "$D" "$P" "$i" & pa=$!; ws_loop_run B A "$D" "$P" "$i" & pb=$!
    waitfile "$D/ready.A"; waitfile "$D/ready.B"; : > "$D/go"
    wait "$pa"; ra=$?; wait "$pb"; rb=$?
    if [ "$ra" = 0 ] && [ "$rb" = 2 ]; then w=A; l=B; elif [ "$rb" = 0 ] && [ "$ra" = 2 ]; then w=B; l=A; else w=; fi
    if [ -n "$w" ] && [ -s "$D/own.$w" ] && [ ! -e "$D/own.$l" ] && [ "$(cat "$D/own.$w")" = "$(cat "$D/after.$w" 2>/dev/null)" ] && [ "$(cut -d' ' -f2 "$D/own.$w")" = "$F5_SUM" ] \
      && grep -Eq "^REFUSED: $P (already exists on the workstation|was created by another run or an operator first \(collision on the workstation\))" "$D/out.$l" \
      && grep -q "removed $P (workstation; this run reserved and wrote it" "$D/out.$w" && [ ! -e "$P" ] && [ "$(snapd "$D/ws")" = "$s0" ]; then
      good=$((good+1)); [ "$w" = A ] && wa=$((wa+1)) || wb=$((wb+1)); ! grep -q 'collision on the workstation' "$D/out.$l" || excl=$((excl+1))
    elif [ -z "$first" ]; then first="iteration $i: exits A=$ra B=$rb; A: $(tail -2 "$D/out.A" | tr '\n' ' '); B: $(tail -2 "$D/out.B" | tr '\n' ' ')"; rm -f -- "$P"; fi
  done
  [ "$good" = "$F5_LOOPS" ]
  res ws-loop $? "$F5_LOOPS/$F5_LOOPS iterations: exactly one run owns (exit 0), the other exits 2 with the collision reason and owns nothing; the winner's archive is the same inode and bytes after the loser's cleanup; unrelated dirs intact; after the winner's cleanup only its archive is gone" \
    "$good/$F5_LOOPS (A won $wa, B won $wb; loser stopped by the exclusive create itself in $excl, by the existence check in $((good-excl)))${first:+; first bad $first}"; }
rt_loop_run() { # me other dir remote-path iteration
  ( load; RID=run$1-$5; TAR=$3/ws$1/$F5_AN; RTAR=$4; arm_trap
    acquire_ws "$TAR" && run_block1 "$3/b1$1.sh" "$TAR" || { cleanup; : > "$3/ready.$1"; : > "$3/done.$1"; exit 90; }
    : > "$3/ready.$1"; n=0; while [ ! -e "$3/go" ] && [ "$n" -lt 3000000 ]; do n=$((n+1)); done
    run_block2 "$3/b2$1.sh" "$RTAR" || { cleanup; : > "$3/done.$1"; exit 1; }
    state "$RTAR" > "$3/own.$1"; waitfile "$3/done.$2"; state "$RTAR" > "$3/after.$1"
    cleanup; rc=$?; : > "$3/done.$1"; exit "$rc" ) > "$3/out.$1" 2>&1; }
c_rt_loop() { local D=$F5_T/rtloop R s0 sa sb i good=0 wa=0 wb=0 first= ra rb w l pa pb
  mkhost "$D/wsA"; mkhost "$D/wsB"; mkhost "$D/rt"; R=$D/rt/$F5_AN
  mkblocks "$D" A "$D/wsA/$F5_AN" "$R"; mkblocks "$D" B "$D/wsB/$F5_AN" "$R"; s0=$(snapd "$D/rt"); sa=$(snapd "$D/wsA"); sb=$(snapd "$D/wsB")
  for ((i = 1; i <= F5_LOOPS; i++)); do
    rm -f "$D"/go "$D"/ready.* "$D"/done.* "$D"/own.* "$D"/after.* "$D"/out.*
    rt_loop_run A B "$D" "$R" "$i" & pa=$!; rt_loop_run B A "$D" "$R" "$i" & pb=$!
    waitfile "$D/ready.A"; waitfile "$D/ready.B"; : > "$D/go"
    wait "$pa"; ra=$?; wait "$pb"; rb=$?
    if [ "$ra" = 0 ] && [ "$rb" = 1 ]; then w=A; l=B; elif [ "$rb" = 0 ] && [ "$ra" = 1 ]; then w=B; l=A; else w=; fi
    if [ -n "$w" ] && [ -s "$D/own.$w" ] && [ ! -e "$D/own.$l" ] && [ "$(cat "$D/own.$w")" = "$(cat "$D/after.$w" 2>/dev/null)" ] && [ "$(cut -d' ' -f2 "$D/own.$w")" = "$F5_SUM" ] \
      && grep -q "STOP block 2 did not create $R on streamanator .*collision" "$D/out.$l" && grep -q "not removing $R on streamanator: this run did not create it" "$D/out.$l" \
      && grep -q "removed $R on streamanator (created by this run's block 2" "$D/out.$w" \
      && [ ! -e "$R" ] && [ ! -e "$D/wsA/$F5_AN" ] && [ ! -e "$D/wsB/$F5_AN" ] && [ "$(snapd "$D/rt")$(snapd "$D/wsA")$(snapd "$D/wsB")" = "$s0$sa$sb" ]; then
      good=$((good+1)); [ "$w" = A ] && wa=$((wa+1)) || wb=$((wb+1))
    elif [ -z "$first" ]; then first="iteration $i: exits A=$ra B=$rb; A: $(tail -2 "$D/out.A" | tr '\n' ' '); B: $(tail -2 "$D/out.B" | tr '\n' ' ')"; rm -f -- "$R" "$D/wsA/$F5_AN" "$D/wsB/$F5_AN"; fi
  done
  [ "$good" = "$F5_LOOPS" ]
  res rt-loop $? "$F5_LOOPS/$F5_LOOPS iterations (two workstations, one streamanator path): exactly one block 2 creates (exit 0), the other run exits 1 with the collision reason, owns nothing remote and removes only its own workstation archive; the winner's remote archive is the same inode and bytes after the loser's cleanup; unrelated dirs intact on all three; after the winner's cleanup nothing of either run is left" \
    "$good/$F5_LOOPS (A won $wa, B won $wb)${first:+; first bad $first}"; }

# ---- 5b: partial failures (single run)
one() { # dir -> hosts ws and rt with sentinels, blocks, loaded driver, this run's paths
  D=$1; mkhost "$D/ws"; mkhost "$D/rt"; P=$D/ws/$F5_AN; R=$D/rt/$F5_AN; mkblocks "$D" "" "$P" "$R"; S0=$(snapd "$D/ws")$(snapd "$D/rt")
  load; RID=runP; TAR=$P; RTAR=$R; }
same() { [ "$(snapd "$D/ws")$(snapd "$D/rt")" = "$S0" ] && echo intact || echo CHANGED; }
c_p_block1_failed() { local D P R S0 r1 o rc
  one "$F5_T/p1"; acquire_ws "$P" >/dev/null; printf 'false\n' > "$D/b1.sh"; run_block1 "$D/b1.sh" "$P" > "$D/o" 2>&1; r1=$?; o=$(cat "$D/o")
  o="$o $(cleanup 2>&1)"; rc=$?
  [ "$r1" = 1 ] && [[ $o == *"STOP block 1 did not write the archive"* ]] && [[ $o == *"removed $P (workstation; the file this run reserved, as its own failed or interrupted block 1 left it)"* ]] && [ "$rc" = 0 ] && [ ! -e "$P" ] && [ "$(same)" = intact ]
  res p-block1-failed $? "reserved, block 1 fails without writing: the run STOPs; cleanup removes this run's reservation (rc 0); nothing else changes" "block 1 step rc $r1; cleanup rc $rc; path $([ -e "$P" ] && echo LEFT || echo gone); other entries $(same)"; }
c_p_block1_partial() { local D P R S0 r1 o rc
  one "$F5_T/p2"; acquire_ws "$P" >/dev/null; printf "head -c 1000 '%s' > '%s'; exit 1\n" "$F5_T/src.bin" "$P" > "$D/b1.sh"; run_block1 "$D/b1.sh" "$P" >/dev/null 2>&1; r1=$?
  o=$(cleanup 2>&1); rc=$?
  [ "$r1" = 1 ] && [[ $o == *"removed $P (workstation; the file this run reserved, as its own failed or interrupted block 1 left it)"* ]] && [ "$rc" = 0 ] && [ ! -e "$P" ] && [ "$(same)" = intact ]
  res p-block1-partial $? "reserved, block 1 writes part of the archive into the reserved file and fails: cleanup removes that file (same inode this run created), rc 0" "block 1 step rc $r1; cleanup rc $rc; path $([ -e "$P" ] && echo LEFT || echo gone); other entries $(same)"; }
c_p_reserved_foreign() { local D P R S0 r1 o rc st
  one "$F5_T/p3"; acquire_ws "$P" >/dev/null; rm -f "$P"; printf 'an operator archive\n' > "$D/ws/other"; printf 'an operator archive, not this run\n' > "$P"; rm -f "$D/ws/other"; st=$(state "$P")
  run_block1 "$D/b1.sh" "$P" > "$D/o" 2>&1; r1=$?; o=$(cat "$D/o"); o="$o $(cleanup 2>&1)"; rc=$?
  [ "$r1" = 1 ] && [[ $o == *"STOP $P no longer holds this run's reservation; block 1 not run"* ]] && [[ $o == *"LEFT $P on the workstation"* ]] && [ "$rc" != 0 ] && [ "$(state "$P")" = "$st" ] && [ "$(same)" = intact ]
  res p-reserved-foreign $? "the reserved path is replaced by someone else's file before block 1: block 1 is NOT run, cleanup leaves that file untouched, says so, and returns nonzero" "block 1 step rc $r1; cleanup rc $rc; foreign file $([ "$(state "$P")" = "$st" ] && echo untouched || echo CHANGED); other entries $(same)"; }
c_p_written_foreign() { local D P R S0 o rc st
  one "$F5_T/p4"; acquire_ws "$P" >/dev/null; run_block1 "$D/b1.sh" "$P" >/dev/null 2>&1; printf 'different bytes\n' > "$P"; st=$(state "$P"); o=$(cleanup 2>&1); rc=$?
  [[ $o == *"LEFT $P on the workstation: reserved by this run but no longer the file or bytes this run wrote"* ]] && [ "$rc" != 0 ] && [ "$(state "$P")" = "$st" ] && [ "$(same)" = intact ]
  res p-written-foreign $? "the archive this run wrote later holds other bytes: cleanup leaves it, says so, returns nonzero (the run fails)" "cleanup rc $rc; file $([ "$(state "$P")" = "$st" ] && echo untouched || echo CHANGED); other entries $(same)"; }
c_p_block2_collision() { local D P R S0 r2 o rc st
  one "$F5_T/p5"; acquire_ws "$P" >/dev/null; run_block1 "$D/b1.sh" "$P" >/dev/null 2>&1; cp "$F5_T/src.bin" "$R"; st=$(state "$R")     # an operator's identical archive is already there
  run_block2 "$D/b2.sh" "$R" > "$D/o" 2>&1; r2=$?; o=$(cat "$D/o"); o="$o $(cleanup 2>&1)"; rc=$?
  [ "$r2" = 1 ] && [ "$OWN_RTAR" = 0 ] && [[ $o == *"STOP block 2 did not create $R on streamanator"*"collision"* ]] && [[ $o == *"not removing $R on streamanator: this run did not create it"* ]] \
    && [ "$(state "$R")" = "$st" ] && [ ! -e "$P" ] && [ "$rc" = 0 ] && [ "$(same)" = intact ]
  res p-block2-collision $? "block 1 ok, block 2 fails because the remote path already holds IDENTICAL bytes: the run STOPs with the collision reason, never owns the remote file, leaves it (same inode, bytes), and removes its own workstation archive" \
    "block 2 step rc $r2, owns remote=$OWN_RTAR; remote file $([ "$(state "$R")" = "$st" ] && echo untouched || echo CHANGED); own workstation archive $([ -e "$P" ] && echo LEFT || echo removed); cleanup rc $rc; other entries $(same)"; }
c_p_block2_broken() { local D P R S0 r2 o rc st
  one "$F5_T/p6"; acquire_ws "$P" >/dev/null; run_block1 "$D/b1.sh" "$P" >/dev/null 2>&1
  printf "bash -c 'set -C; head -c 1000 > %s; exit 1' < %s\n" "$R" "$P" > "$D/b2.sh"; run_block2 "$D/b2.sh" "$R" >/dev/null 2>&1; r2=$?; st=$(state "$R"); o=$(cleanup 2>&1); rc=$?
  [ "$r2" = 1 ] && [ "$OWN_RTAR" = 0 ] && [[ $o == *"not removing $R on streamanator: this run did not create it"* ]] && [ "$(state "$R")" = "$st" ] && [ -e "$R" ] && [ ! -e "$P" ] && [ "$(same)" = intact ]
  res p-block2-broken $? "block 2 exits nonzero after a partial transfer: no ownership (a failed block 2 never confers it), the remote file is left and reported; the workstation archive is removed (documented limit: the operator removes the partial remote file)" \
    "block 2 step rc $r2, owns remote=$OWN_RTAR; remote partial file $([ "$(state "$R")" = "$st" ] && echo left untouched || echo CHANGED); own workstation archive $([ -e "$P" ] && echo LEFT || echo removed); cleanup rc $rc"; }
c_p_remote_changed() { local D P R S0 r2 o rc st
  one "$F5_T/p7"; acquire_ws "$P" >/dev/null; run_block1 "$D/b1.sh" "$P" >/dev/null 2>&1; run_block2 "$D/b2.sh" "$R" >/dev/null 2>&1; r2=$?
  printf 'different bytes\n' > "$R"; st=$(state "$R"); o=$(cleanup 2>&1); rc=$?
  [ "$r2" = 0 ] && [[ $o == *"LEFT $R on streamanator: created by this run but no longer the file or bytes this run sent"* ]] && [ "$rc" != 0 ] && [ "$(state "$R")" = "$st" ] && [ ! -e "$P" ] && [ "$(same)" = intact ]
  res p-remote-changed $? "the remote archive this run created later holds other bytes: cleanup leaves it, says so, returns nonzero; the workstation archive is still removed" "block 2 rc $r2; cleanup rc $rc; remote file $([ "$(state "$R")" = "$st" ] && echo untouched || echo CHANGED); own workstation archive $([ -e "$P" ] && echo LEFT || echo removed); other entries $(same)"; }
term_case() { # case dir stage(reserved|both)
  local D P R S0 pid rc had; one "$2"
  ( arm_trap; acquire_ws "$P" || exit 90
    if [ "$3" = both ]; then run_block1 "$D/b1.sh" "$P" && run_block2 "$D/b2.sh" "$R" || exit 91; fi
    : > "$D/ready"; while :; do sleep 0.1; done ) > "$D/out" 2>&1 & pid=$!
  waitfile "$D/ready"; had="ws=$([ -e "$P" ] && echo present || echo absent) remote=$([ -e "$R" ] && echo present || echo absent)"
  kill -TERM "$pid"; wait "$pid"; rc=$?
  [ "$rc" = 1 ] && [ "$had" = "ws=present remote=$([ "$3" = both ] && echo present || echo absent)" ] && [ ! -e "$P" ] && [ ! -e "$R" ] && [ "$(same)" = intact ] && grep -q -- "-- cleanup (only what run runP created)" "$D/out"
  res "$1" $? "TERM while the run holds $([ "$3" = both ] && echo "both archives" || echo "only its reservation"): the driver's own trap runs cleanup and exits 1; this run's path(s) are removed and nothing else" \
    "before TERM $had; exit $rc; after: ws $([ -e "$P" ] && echo LEFT || echo gone), remote $([ -e "$R" ] && echo LEFT || echo gone); other entries $(same)"; }
c_term_reserved() { term_case term-reserved "$F5_T/t1" reserved; }
c_term_both() { term_case term-both "$F5_T/t2" both; }

echo "== suite f5 (cleanup ownership) $(date -u +%FT%TZ) host=$(hostname) user=$(id -un) bash=${BASH_VERSION} fix=$F5_FIX"
echo "   r3/r4 driver sha256 $(sha256sum < "$F5_DRV" | cut -c1-64); original driver $([ -r "$F5_ORIG" ] && sha256sum < "$F5_ORIG" | cut -c1-64 || echo MISSING); loops $F5_LOOPS"
{ case_run r2-static c_r2_static; case_run r2-refuse c_r2_refuse; case_run r2-remote-refuse c_r2_remote_refuse
  case_run lib-exec-refused c_lib_exec_refused; case_run bad-tag-refused c_bad_tag_refused; case_run tag-select c_tag_select
  case_run ws-det-race c_ws_det_race; case_run ws-det-race-orig c_ws_det_race_orig; case_run rt-det-race c_rt_det_race; case_run rt-det-race-orig c_rt_det_race_orig
  case_run ws-loop c_ws_loop; case_run rt-loop c_rt_loop
  case_run p-block1-failed c_p_block1_failed; case_run p-block1-partial c_p_block1_partial; case_run p-reserved-foreign c_p_reserved_foreign
  case_run p-written-foreign c_p_written_foreign; case_run p-block2-collision c_p_block2_collision; case_run p-block2-broken c_p_block2_broken
  case_run p-remote-changed c_p_remote_changed; case_run term-reserved c_term_reserved; case_run term-both c_term_both
  echo "F5-CASES $F5_N" > "$F5_T/n"; } | tee "$F5_T/results"
F5_N=$(sed 's/^F5-CASES //' "$F5_T/n"); F5_OK=$(grep -c '^CASE-RESULT f5-[a-z0-9-]* OK ' "$F5_T/results"); F5_UN=$((F5_N - F5_OK))
[ "$F5_UN" = 0 ] && [ "$F5_N" = 21 ] && echo "SUITE f5 RESULT PASS ($F5_N cases)" || { echo "SUITE f5 RESULT FAIL ($F5_UN unexpected)"; exit 1; }
