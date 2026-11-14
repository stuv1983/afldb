#!/usr/bin/env bash
# (written on the host by heredoc during the run; reproduced verbatim) waits for the stray muts.sh rb started by the first final.sh, then runs the A evidence set
W=/mnt/ssd/afldb-rem4-gates-20261115
while kill -0 2918312 2>/dev/null; do sleep 5; done
echo "orphan muts rb finished $(date -u +%T)"
bash $W/in/final.sh fa it
bash $W/in/final.sh fa dbmuts-snap
bash $W/in/final.sh fa srcmuts
