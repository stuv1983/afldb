#!/usr/bin/env bash
# Before/after table for the R6 r6 token-boundary cases: the 624bf721 parser (before) and the working-tree parser (after) on the
# same fixture records the f1 suite's "r6" section builds (same line text, same R6-HANDOFF lines). Read-only; fixtures in mktemp.
# Usage: bash boundary-before-after.sh <repo root>
set -uo pipefail; export LC_ALL=C
ROOT=$1; B=$ROOT/docs/v2/evidence/backlog-20261121/r6-20261125
NEW=$B/r6-tuesday-handoff.sh OLD=$B/review-fixes-r6-20261128/orig-624bf721/r6-tuesday-handoff.sh
RD=$(mktemp -d "${TMPDIR:-/tmp}/f1-ba.XXXXXX") || exit 2; trap 'rm -rf -- "$RD"' EXIT
NEWB=fixtureBuild0123456789; CUR=17822b29e6de-$NEWB; PREV=7d92042fd110-XWruOm_9nLCSMY8nGPqYU
SUN=342040625f6d4012a35d598dfbf9afe6; INV_TUE=aaaaaaaaaaaaaaaaaaaaaaaaaaaa0001; INV_RB=bbbbbbbbbbbbbbbbbbbbbbbbbbbb0002
P3B="P3b RESULT BUILD PASS $CUR"
P4P="P4 RESULT PROMOTED 2026-11-24T00:12:03Z: OWNER NOW: RESTART block (runbook section 4.2), no later than 11:35 AEDT"
INV5="PASS running invocation = the owner's restart $INV_TUE"; P5A="P5 RESULT ACCEPT PASS (1-4)"
RBL="ROLLBACK RESULT LINKS SWITCHED 2026-11-24T01:05:10Z: OWNER NOW: RESTART block (runbook section 4.2)"
INVR="PASS running invocation = the owner's rollback restart $INV_RB"
RBV="ROLLBACK RESULT VERIFIED (1-3): now r1-rawhead.sh check and S9 with XWruOm_9nLCSMY8nGPqYU"
rec() { local f=$1; shift
  { echo "# Tuesday sitting record: REHEARSAL FIXTURE written by f1-handoff.sh (fixture IDs; not the real record)"
    echo "G0 PROD RESULT PASS: fixture"; echo "P1 RESULT PASS"; printf '%s\n' "$@"; } > "$RD/$f"; }
ho() { printf '%s\n' "R6-HANDOFF tuesday-outcome $1" "R6-HANDOFF current-id $2" "R6-HANDOFF attested-invocation $3"; }
mapfile -t HREL < <(ho released "$CUR" "$INV_TUE"); mapfile -t HRB < <(ho rolledback "$PREV" "$INV_RB"); mapfile -t HDEF < <(ho deferred "$PREV" "$SUN")
BASE=("$P3B" "$P4P" "$INV5" "$P5A")
bline() { case $1 in
  backtick)  printf '%s' "The interrupted wrapper had printed \`$2\` and nothing after it.";;
  dot)       printf '%s' "Last tool line seen: $2.";;
  comma)     printf '%s' "The tool printed $2, then the session dropped.";;
  semicolon) printf '%s' "The tool printed $2; then the session dropped.";;
  paren)     printf '%s' "(the tool printed $2)";;
  colon)     printf '%s' "Tool line $2: nothing after it.";;
  bracket)   printf '%s' "[$2]";;
  squote)    printf '%s' "Owner note: '$2'";;
  dquote)    printf '%s' "Owner note: \"$2\"";;
  star)      printf '%s' "**$2**";;
  ellipsis)  printf '%s' "$2"$'\xe2\x80\xa6'" (output cut)";;
  eol)       printf '%s' "Last tool line seen: $2";;
esac; }
summ() { local out rc; out=$(bash "$1" "$RD/$2" 2>&1 < /dev/null); rc=$?
  if [ "$rc" = 0 ]; then echo "exit 0 PASS $(grep '^R6-A2-TUESDAY' <<< "$out" | cut -d' ' -f2)"; else echo "exit $rc STOP($(grep -c '^STOP ' <<< "$out"))"; fi; }
row() { printf '| %-58s | %-30s | %-22s | %-22s |\n' "$1" "$3" "$(summ "$OLD" "$2")" "$(summ "$NEW" "$2")"; }
echo "== f1 r6 boundary before/after $(date -u +%FT%TZ) bash=$BASH_VERSION"
echo "   before = 624bf721 parser sha256=$(sha256sum < "$OLD" | cut -c1-64)"
echo "   after  = working-tree parser sha256=$(sha256sum < "$NEW" | cut -c1-64)"
printf '| %-58s | %-30s | %-22s | %-22s |\n' case expected before after
for v in backtick dot comma semicolon paren colon bracket squote dquote star ellipsis eol; do
  rec "rel-rb-$v.md" "${BASE[@]}" "$(bline "$v" 'release: ROLLED BACK')" "${HREL[@]}"; row "released, release: ROLLED BACK + $v" "rel-rb-$v.md" "STOP"
  rec "def-rb-$v.md" "$(bline "$v" 'release: ROLLED BACK')" "${HDEF[@]}";               row "deferred, release: ROLLED BACK + $v" "def-rb-$v.md" "STOP"
  rec "def-pr-$v.md" "$(bline "$v" 'release: PROMOTED')" "${HDEF[@]}";                  row "deferred, release: PROMOTED + $v" "def-pr-$v.md" "STOP"
done
rec rel-hdr-bt.md "${BASE[@]}" "The wrapper printed \`== R1 rollback links\` and stopped." "${HREL[@]}"; row "released, \`== R1 rollback links\`" rel-hdr-bt.md STOP
rec rel-hdr-colon.md "${BASE[@]}" "== R1 rollback verify: not reached" "${HREL[@]}";                   row "released, == R1 rollback verify:" rel-hdr-colon.md STOP
rec def-hdr-bt.md "Seen: \`== R1 rollback links\`." "${HDEF[@]}";                                       row "deferred, \`== R1 rollback links\`." def-hdr-bt.md STOP
rec def-hdr-dot.md "Seen: == R1 rollback verify." "${HDEF[@]}";                                         row "deferred, == R1 rollback verify." def-hdr-dot.md STOP
rec rel-us-left.md "${BASE[@]}" "log_release: ROLLED BACK." "${HREL[@]}";                               row "released, log_release: ROLLED BACK." rel-us-left.md STOP
rec rel-backup.md "${BASE[@]}" "release: ROLLED BACKUP of the previous tree was not taken" "${HREL[@]}"; row "released, release: ROLLED BACKUP (word)" rel-backup.md "PASS released (not token)"
rec rel-back-us.md "${BASE[@]}" "label release: ROLLED BACK_2 (not tool output)" "${HREL[@]}";          row "released, release: ROLLED BACK_2 (word)" rel-back-us.md "PASS released (not token)"
rec rel-back-digit.md "${BASE[@]}" "label release: ROLLED BACK9" "${HREL[@]}";                          row "released, release: ROLLED BACK9 (word)" rel-back-digit.md "PASS released (not token)"
rec def-promotedx.md "release: PROMOTEDX is not a release.mjs line" "${HDEF[@]}";                       row "deferred, release: PROMOTEDX (word)" def-promotedx.md "PASS deferred (not token)"
rec def-backup.md "release: ROLLED BACKUP" "${HDEF[@]}";                                                row "deferred, release: ROLLED BACKUP (word)" def-backup.md "PASS deferred (not token)"
rec rel-verifying.md "${BASE[@]}" "== R1 rollback verifying is a runbook heading, not a wrapper header" "${HREL[@]}"; row "released, == R1 rollback verifying (word)" rel-verifying.md "PASS released (not token)"
rec def-linksx.md "== R1 rollback linksX" "${HDEF[@]}";                                                 row "deferred, == R1 rollback linksX (word)" def-linksx.md "PASS deferred (not token)"
rec rel-prerelease.md "${BASE[@]}" "prerelease: ROLLED BACK is not a release.mjs line" "${HREL[@]}";    row "released, prerelease: ROLLED BACK (left)" rel-prerelease.md "PASS released (left rule)"
rec rb-keeps.md "$P3B" "$P4P" "$INV5" "$P5A" "$RBL" "Tool line: \`release: ROLLED BACK\`." "Header: \`== R1 rollback verify\`." "$INVR" "$RBV" "${HRB[@]}"; row "rolledback keeps boundary variants" rb-keeps.md "PASS rolledback"
rec def-prose.md "No release.mjs PROMOTED or ROLLED BACK line was printed; the rollback section of the runbook was not used." "PASS current -> $PREV" "${HDEF[@]}"; row "deferred, prose + bare PASS current" def-prose.md "PASS deferred"
REAL=$ROOT/docs/v2/evidence/release-17822b29-20261124/SITTING-20261124.md
o=$(bash "$OLD" "$REAL" < /dev/null | sed -E 's/^(== R6 Tuesday handoff )[0-9TZ:-]+ /\1<ts> /'); orc=${PIPESTATUS[0]}
n=$(bash "$NEW" "$REAL" < /dev/null | sed -E 's/^(== R6 Tuesday handoff )[0-9TZ:-]+ /\1<ts> /'); nrc=${PIPESTATUS[0]}
echo "-- real SITTING-20261124.md: before exit $orc, after exit $nrc; full output identical except the run timestamp: $([ "$o" = "$n" ] && echo YES || echo NO)"
diff <(echo "$o") <(echo "$n") && echo "   diff (timestamp masked): empty"
echo "$n" | sed 's/^/   after: /'
