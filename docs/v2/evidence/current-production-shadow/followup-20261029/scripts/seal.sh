#!/bin/bash
# D-V2-CURRENT-SHADOW-FOLLOWUP-1: take the follow-up evidence manifest only after the runner has ended and its
# outputs have stopped changing. Retains the runner's complete log inside the evidence first. Writes only under $O.
#   ssh arm@10.0.40.100 "bash $F/scripts/seal.sh"
set -uo pipefail
export LC_ALL=C
umask 077
R=/home/arm/afldb-v2-currentshadow-20261028T192336Z
F=$R/followup; O=$F/evidence
[ "$(hostname)" = streamanator ] || { echo "STOP: wrong host"; exit 2; }
[ -s "$O/followup.done" ] && [ -s "$O/followup.result" ] || { echo "STOP: runner has not completed"; exit 2; }
pgrep -u arm -f "$F/scripts/followup.sh" > /dev/null && { echo "STOP: runner still running"; exit 2; }
ss -H -ltn "( sport = :55467 )" | grep -q . && { echo "STOP: 55467 still listening"; exit 2; }
[ ! -e "$O/evidence-sha256.txt" ] || { echo "STOP: manifest already exists; never overwritten"; exit 2; }
# Outputs must be quiescent: two listings 5 s apart must be identical (size and mtime of every file).
A=$(cd "$O" && find . -type f -printf '%p %s %T@\n' | sort); sleep 5; B=$(cd "$O" && find . -type f -printf '%p %s %T@\n' | sort)
[ "$A" = "$B" ] || { echo "STOP: evidence still changing"; exit 3; }
cp "$F/run.log" "$O/followup.log"
( cd "$O" && find . -type f ! -name evidence-sha256.txt -print0 | sort -z | xargs -0 sha256sum ) > "$O/evidence-sha256.txt"
( cd "$O" && sha256sum --check --strict --quiet evidence-sha256.txt ) || { echo "STOP: manifest does not re-verify"; exit 4; }
cmp -s "$F/run.log" "$O/followup.log" || { echo "STOP: run.log changed while sealing"; exit 4; }
echo "follow-up evidence manifest $(sha256sum "$O/evidence-sha256.txt" | cut -c1-64) files $(wc -l < "$O/evidence-sha256.txt")"
echo "original manifest $(sha256sum "$R/evidence/evidence-sha256.txt" | cut -c1-64) (unchanged expected ea197fcf...)"
du -sb "$F" "$R"; df -B1 --output=avail /home/arm | tail -1
