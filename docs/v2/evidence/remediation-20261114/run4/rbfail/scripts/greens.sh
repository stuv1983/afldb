#!/usr/bin/env bash
# rbfail: GREEN runs (fixed files in cand) on a base, one file per invocation (no multi-file group).
#   bash greens.sh <snap|rb> <pf|sh>
set -u -o pipefail
W=/mnt/ssd/afldb-rem4-rbfail-20261115
base=$1; mode=$2
T=tests/integration
for pair in rel:nl-answers-relationships xd:nl-answers-cross-domain fkg:nl-answers-first-kick-goal coach:nl-answers-coaching sl:admin-season-lists sup:special-records-public-suppression life:special-records-lifecycle col:v2-coleman-publication c7:afl-api-c7-observation; do
  tag=${pair%%:*}; n=${pair#*:}
  echo "######## GREEN $mode $base $n"; bash $W/in/rf.sh $mode g_${mode}_${base}_${tag} $base $T/$n.test.ts 2>&1 | cut -c1-330
done
echo "######## done"
