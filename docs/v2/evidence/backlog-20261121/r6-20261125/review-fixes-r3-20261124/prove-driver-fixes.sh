#!/usr/bin/env bash
# REHEARSAL ONLY (workstation Git Bash), R6 r3 (24 Nov 2026) and r4 (27 Nov 2026). Proves the two repeat-driver fixes around the
# TESTED driver, which it runs unchanged from the tested commit (git show <tested>:<r3 harness>/run-printed-blocks.sh) with the
# tag given as the fourth argument (default r3; the driver lives in the r3 harness directory for every tag):
#   1. scoped cleanup: unrelated sentinels survive both driver runs. On the workstation and on streamanator: a directory named
#      like an operator's real staging root (/tmp/afldb-r6-20261125-r3.<id>, for tag r4 also /tmp/afldb-r6-20261125-r4.<id>, and
#      r2's /tmp/afldb-r6-20261125-r2.<id>, which the r2 driver's wildcard removed), one named like another run's private
#      directory (/tmp/r6reh.<id>, /tmp/r6reh-ws.<id>); and on streamanator a created-but-never-started container of the same
#      image labelled r6reh.run=<id>.
#      After each run, neither host may hold residue of any driver run (the tag's archive path, a staging root, a run directory
#      or an r6reh-* container) other than the sentinels.
#   2. nonzero exit: a second driver run with R6_REH_SABOTAGE=b5-symlink-identical, which skips that one negative fixture's
#      tampering, so its re-check passes unexpectedly; the top-level driver must exit nonzero AND report that case UNEXPECTED
#      (a refusal for another reason does not count).
# The wrapper removes only its own sentinels, by exact name, at the end. Production is never contacted. The archive-ownership
# rule (finding 5, 27 Nov 2026) has its own isolated proof: review-fixes-r4-20261127/prove-archive-ownership.sh.
# Usage: bash prove-driver-fixes.sh <tested-commit> <review-commit> <output dir> [r3|r4]
set -uo pipefail; export LC_ALL=C
TESTED=${1:?tested}; REVIEW=${2:?review}; OUT=${3:?output dir}; TAG=${4:-r3}
case $TAG in r3|r4) ;; *) echo "REFUSED: unknown tag '$TAG' (r3 or r4); nothing was created"; exit 2 ;; esac
REPO=/d/dev/afldb; H=docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r3-20261124
SSH=(C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes -i C:/Users/stuar/.ssh/afldb_dev arm@10.0.40.100)
IMG=sha256:d71c0b286c54a7cc48645aa8d4d9d0c57e4260128cb91a6fb18c29d7589205ba
SID=sentinel$(date -u +%H%M%S)$$
mkdir -p "$OUT"; DRV=$OUT/run-printed-blocks.tested.sh
git -C "$REPO" show "$TESTED:$H/run-printed-blocks.sh" > "$DRV" || { echo "STOP no driver at $TESTED"; exit 2; }
echo "== R6 $TAG driver proof $(date -u +%FT%TZ) tested=$TESTED review=$REVIEW sentinel id=$SID driver sha256 $(sha256sum < "$DRV" | cut -c1-64)"
PATHS="/tmp/afldb-r6-20261125-r3.$SID /tmp/afldb-r6-20261125-r2.$SID /tmp/r6reh.$SID /tmp/r6reh-ws.$SID"
[ "$TAG" = r3 ] || PATHS="/tmp/afldb-r6-20261125-$TAG.$SID $PATHS"
NP=$(wc -w <<< "$PATHS")
mk_sentinels='for d in '"$PATHS"'; do mkdir "$d" && printf "unrelated sentinel %s\n" "$d" > "$d/keep.txt" || exit 1; done'
snap='for d in '"$PATHS"'; do printf "%s %s\n" "$d" "$(cat "$d/keep.txt" 2>/dev/null | sha256sum | cut -c1-16)"; done'
bash -c "$mk_sentinels" || { echo "STOP workstation sentinels"; exit 2; }
"${SSH[@]}" "$mk_sentinels && docker create --network none --name r6reh-$SID --label r6reh.run=$SID $IMG true >/dev/null" \
  || { echo "STOP streamanator sentinels"; exit 2; }
W0=$(bash -c "$snap"); R0=$("${SSH[@]}" "$snap; docker ps -aq --filter name=^r6reh-$SID\$ --filter label=r6reh.run=$SID | wc -l")
echo "   sentinels made: workstation"; sed 's/^/     /' <<< "$W0"; echo "   streamanator (last line = sentinel containers)"; sed 's/^/     /' <<< "$R0"
residue='ls -d /tmp/afldb-r6-20261125-'"$TAG"'.tar /tmp/afldb-r6-20261125-'"$TAG"'.* /tmp/r6reh.* /tmp/r6reh-ws.* 2>/dev/null | grep -v "'"$SID"'"; docker ps -aq --filter name=^r6reh- --filter label=r6reh.run 2>/dev/null | while read -r i; do docker inspect -f "{{.Name}}" "$i"; done | grep -v "'"$SID"'"'
check() { local w r x y; w=$(bash -c "$snap"); r=$("${SSH[@]}" "$snap; docker ps -aq --filter name=^r6reh-$SID\$ --filter label=r6reh.run=$SID | wc -l")
  x=$(bash -c "$residue"); y=$("${SSH[@]}" "$residue")
  echo "   residue of any driver run after $1: workstation '${x//$'\n'/ }', streamanator '${y//$'\n'/ }'"
  if [ "$w" = "$W0" ] && [ "$r" = "$R0" ] && [ "$(tail -1 <<< "$r")" = 1 ] && [ -z "$x$y" ]; then
    echo "   SENTINELS INTACT after $1 ($NP workstation dirs, $NP streamanator dirs, 1 container); no run residue on either host"; return 0; fi
  echo "   SENTINELS CHANGED OR RESIDUE LEFT after $1"; diff <(echo "$W0") <(echo "$w"); diff <(echo "$R0") <(echo "$r"); return 1; }

echo "-- run 1: the tested driver, normal"
bash "$DRV" "$REVIEW" "$OUT/run1-normal" "$TAG" 2>&1 | tee "$OUT/run1-normal.log"; RC1=${PIPESTATUS[0]}
echo "   run 1 top-level exit $RC1 (expected 0)"; check "run 1"; S1=$?
echo "-- run 2: the tested driver with R6_REH_SABOTAGE=b5-symlink-identical (one negative fixture deliberately not tampered)"
R6_REH_SABOTAGE=b5-symlink-identical bash "$DRV" "$REVIEW" "$OUT/run2-sabotage" "$TAG" 2>&1 | tee "$OUT/run2-sabotage.log"; RC2=${PIPESTATUS[0]}
echo "   run 2 top-level exit $RC2 (expected nonzero)"; check "run 2"; S2=$?
U2=$(grep -c 'CASE-RESULT b5-symlink-identical UNEXPECTED' "$OUT/run2-sabotage.log")

echo "-- removing this wrapper's own sentinels (exact names)"
for d in $PATHS; do rm -rf -- "$d"; done
"${SSH[@]}" "for d in $PATHS; do rm -rf -- \"\$d\"; done; docker rm r6reh-$SID >/dev/null && echo '   removed container r6reh-$SID'"
echo "== proof: run1 exit $RC1, sentinels after run1 $([ $S1 = 0 ] && echo intact || echo CHANGED); run2 exit $RC2, the sabotaged case reported UNEXPECTED $U2 time(s), sentinels after run2 $([ $S2 = 0 ] && echo intact || echo CHANGED)"
[ "$RC1" = 0 ] && [ "$RC2" != 0 ] && [ "$U2" -ge 1 ] && [ "$S1" = 0 ] && [ "$S2" = 0 ] && echo "R6 $TAG DRIVER PROOF PASS" || { echo "R6 $TAG DRIVER PROOF FAIL"; exit 1; }
