#!/usr/bin/env bash
# REHEARSAL ONLY (R6 r4, 27 Nov 2026; the r3 case set, unchanged, on the r4 blocks). Runs ONE printed-block case INSIDE a disposable container started by rehearse-r4.sh:
# docker run --rm --network none --user <arm uid> with this case's own private directory mounted as /tmp, the printed blocks
# read-only at /in/blocks (block4.sh = staging, block5.sh = re-check, cut verbatim from the runbook) and the clean archive
# read-only at /in/src/archive.tar. The blocks run VERBATIM (bash <block file>); only the fixture around them is built here.
# Exit: 0 = the case behaved as expected, 1 = UNEXPECTED (a negative case passed or a clean case stopped), 3 = setup failed.
# R6_REH_SABOTAGE=<case> (driver self-test only): that case's tampering is skipped, so a negative case must pass unexpectedly.
set -uo pipefail; export LC_ALL=C
CASE=${1:?case}; SAB=${R6_REH_SABOTAGE:-}
[ -f /.dockerenv ] || { echo "REFUSED: container only"; exit 2; }
B=docs/v2/evidence/backlog-20261121; TAR=/tmp/afldb-r6-20261125-r4.tar
PV=$B/r6-20261125/r6-pre-verify.sh; RH=$B/a1a2-20261124/a1-rawhead.sh; RC=$B/r6-20261125/r6-rawhead-check.sh
umask 0002                                           # production's PAM umask for arm (streamanator shows the same); the block sets its own
setup_fail() { echo "CASE $CASE SETUP FAILED: $*"; exit 3; }
tamper() { if [ -n "$SAB" ] && [ "$SAB" = "$CASE" ]; then echo "   SABOTAGE: tampering for $CASE skipped (driver self-test)"; else eval "$1"; fi; }
run_block() { # n -> OUTB, RCB
  OUTB=$(bash "/in/blocks/block$1.sh" 2>&1); RCB=$?
  sed 's/^/     | /' <<< "$OUTB"
}
stage_clean() { # stage the clean archive with block 4 itself; sets S to the verified root
  cp /in/src/archive.tar "$TAR" || setup_fail "copy archive"
  run_block 4; S=$(sed -n 's/^R6 STAGE VERIFIED \(\/tmp\/afldb-r6-20261125-r4\.[A-Za-z0-9]*\) ([0-9]* files)$/\1/p' <<< "$OUTB")
  [ "$RCB" = 0 ] && [ -n "$S" ] && [ -d "$S" ] || setup_fail "clean staging did not verify (rc $RCB)"
}
rebuild() { # shell commands run inside an extracted copy of the clean archive, which is then re-tarred to $TAR
  local w=/tmp/build; rm -rf "$w"; mkdir -p "$w" && tar -xf /in/src/archive.tar -C "$w" || setup_fail "extract"
  (cd "$w" && tamper "$1") || setup_fail "tamper"
  (cd "$w" && tar -cf "$TAR" $(ls -A)) || setup_fail "re-tar"
}
OUTB=; RCB=; S=; want=
echo "== CASE $CASE $(date -u +%FT%TZ) uid=$(id -u)($(id -un)) umask=$(umask) image-os=$(. /etc/os-release; echo "$PRETTY_NAME")"
case $CASE in
  # ---------------- block 4 (staging) from an archive
  b4-clean)             want=pass; cp /in/src/archive.tar "$TAR"; run_block 4
                        echo "   OK lines: $(grep -c ': OK$' <<< "$OUTB"); staged modes: $(S=$(sed -n 's/^R6 STAGE VERIFIED \([^ ]*\) .*/\1/p' <<< "$OUTB"); [ -n "$S" ] && find "$S" -printf '%m ' | tr ' ' '\n' | sort | uniq -c | tr '\n' ' ')";;
  b4-changed-byte)      want=stop; rebuild "printf '#' >> $PV"; run_block 4;;
  b4-missing-file)      want=stop; rebuild "rm $RC"; run_block 4;;
  b4-extra-file)        want=stop; rebuild "printf x > docs/extra.txt"; run_block 4;;
  b4-nested-manifest)   want=stop; rebuild "cp /dev/null docs/R6-SHA256SUMS"; run_block 4;;
  b4-root-manifest)     want=stop; rebuild "printf 'planted\n' > R6-SHA256SUMS"; run_block 4;;
  b4-extra-symlink)     want=stop; rebuild "ln -s r6-pre-verify.sh $B/r6-20261125/extra-link.sh"; run_block 4;;
  b4-symlink-identical) want=stop; mkdir -p /tmp/outside
                        rebuild "cp $PV /tmp/outside/r6-pre-verify.sh && rm $PV && ln -s /tmp/outside/r6-pre-verify.sh $PV"; run_block 4;;
  b4-bad-archive)       want=stop; tamper "head -c 20000 /in/src/archive.tar > $TAR"; [ -s "$TAR" ] || cp /in/src/archive.tar "$TAR"; run_block 4;;
  b4-not-a-tar)         want=stop; tamper "printf 'not an archive\n' > $TAR"; [ -s "$TAR" ] || cp /in/src/archive.tar "$TAR"; run_block 4;;
  # ---------------- block 5 (re-check) on a staged root (staged by block 4 itself, then changed)
  b5-unchanged)         want=pass; stage_clean; STAGE=$S; export STAGE; run_block 5;;
  b5-changed-byte)      want=stop; stage_clean; tamper "printf '#' >> '$S/$PV'"; STAGE=$S; export STAGE; run_block 5;;
  b5-altered-manifest)  want=stop; stage_clean
                        tamper "chmod u+w '$S/R6-SHA256SUMS' && printf '#' >> '$S/$RH' && h=\$(sha256sum < '$S/$RH' | cut -c1-64) && sed -i \"s|^[0-9a-f]\\{64\\}  $RH\$|\$h  $RH|\" '$S/R6-SHA256SUMS'"
                        STAGE=$S; export STAGE; run_block 5;;
  b5-extra-file)        want=stop; stage_clean; tamper "printf x > '$S/docs/extra.txt'"; STAGE=$S; export STAGE; run_block 5;;
  b5-missing-file)      want=stop; stage_clean; tamper "rm '$S/$RC'"; STAGE=$S; export STAGE; run_block 5;;
  b5-nested-manifest)   want=stop; stage_clean; tamper "cp '$S/R6-SHA256SUMS' '$S/docs/R6-SHA256SUMS'"; STAGE=$S; export STAGE; run_block 5;;
  b5-extra-symlink)     want=stop; stage_clean; tamper "ln -s r6-pre-verify.sh '$S/$B/r6-20261125/extra-link.sh'"; STAGE=$S; export STAGE; run_block 5;;
  b5-symlink-identical) want=stop; stage_clean; mkdir -p /tmp/outside
                        tamper "cp '$S/$PV' /tmp/outside/pv.sh && rm '$S/$PV' && ln -s /tmp/outside/pv.sh '$S/$PV'"; STAGE=$S; export STAGE; run_block 5;;
  b5-manifest-symlink-identical) want=stop; stage_clean; mkdir -p /tmp/outside
                        tamper "cp '$S/R6-SHA256SUMS' /tmp/outside/sums && rm '$S/R6-SHA256SUMS' && ln -s /tmp/outside/sums '$S/R6-SHA256SUMS'"; STAGE=$S; export STAGE; run_block 5;;
  b5-hardlink-outside)  want=stop; stage_clean; mkdir -p /tmp/outside
                        tamper "cp '$S/$PV' /tmp/outside/pv-hard.sh && rm '$S/$PV' && ln /tmp/outside/pv-hard.sh '$S/$PV'"; STAGE=$S; export STAGE; run_block 5;;
  b5-group-writable)    want=stop; stage_clean; tamper "chmod g+w '$S/$PV'"; STAGE=$S; export STAGE; run_block 5;;
  b5-extra-empty-dir)   want=stop; stage_clean; tamper "mkdir '$S/docs/v2/empty'"; STAGE=$S; export STAGE; run_block 5;;
  b5-stage-is-symlink)  want=stop; stage_clean; L=$S; tamper "ln -s '$S' /tmp/afldb-r6-stage-link"; [ -L /tmp/afldb-r6-stage-link ] && L=/tmp/afldb-r6-stage-link
                        STAGE=$L; export STAGE; run_block 5;;
  *) setup_fail "unknown case";;
esac
verdict=$(grep -E '^R6 STAGE (VERIFIED|STOP|OK)' <<< "$OUTB" | tail -1)
# Diagnostics only (not part of any decision): on the root the block judged, would the hashes alone, or r2's file-count rule,
# have caught this case? Shows which of the r3 rules (types and paths, ownership and links, manifest pin) did.
R=${STAGE:-$(ls -d /tmp/afldb-r6-20261125-r4.?????? 2>/dev/null | head -1)}
if [ -n "$R" ] && [ -d "$R" ] && [ -e "$R/R6-SHA256SUMS" ]; then
  h=$( (cd "$R" && sha256sum -c --quiet R6-SHA256SUMS) >/dev/null 2>&1; echo $?)
  c=$( (cd "$R" && find . -type f ! -name R6-SHA256SUMS | wc -l) )
  echo "   diagnostics on $R: hashes alone rc=$h; r2 count rule (find -type f != manifest) = $c (r2 wanted 15; r3 and r4 have 16 pinned)"
fi
got=stop; [ "$RCB" = 0 ] && got=pass
echo "   [$CASE] expected=$want got=$got rc=$RCB verdict='$verdict'"
if [ "$want" = pass ] && [ "$got" = pass ] && [[ $verdict =~ ^R6\ STAGE\ (VERIFIED|OK)\  ]]; then echo "CASE-RESULT $CASE OK (passes, exit 0)"; exit 0; fi
if [ "$want" = stop ] && [ "$got" = stop ] && [[ $verdict == "R6 STAGE STOP"* ]]; then echo "CASE-RESULT $CASE OK (STOP, exit $RCB)"; exit 0; fi
echo "CASE-RESULT $CASE UNEXPECTED (expected $want, got $got with exit $RCB)"; exit 1
