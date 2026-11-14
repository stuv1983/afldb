#!/usr/bin/env bash
# rbfail: RED runs at B4 (pristine checkout cand-red) on the accepted rebuild, one file per invocation; the one 2-file group takes the heavy lock.
set -u -o pipefail
W=/mnt/ssd/afldb-rem4-rbfail-20261115
export CAND_OVERRIDE=$W/cand-red
T=tests/integration
for n in nl-answers-relationships nl-answers-cross-domain nl-answers-first-kick-goal nl-answers-coaching admin-season-lists special-records-public-suppression special-records-lifecycle; do
  echo "######## RED pf rb $n"; bash $W/in/rf.sh pf red_pf_${n//-/_} rb $T/$n.test.ts 2>&1 | cut -c1-330
done
echo "######## RED sh rb v2-coleman-publication (table counts)"; bash $W/in/rf.sh sh red_sh_coleman rb $T/v2-coleman-publication.test.ts 2>&1 | cut -c1-330
echo "######## RED sh rb afl-api-c7-observation alone"; bash $W/in/rf.sh sh red_sh_c7alone rb $T/afl-api-c7-observation.test.ts 2>&1 | cut -c1-330
echo "######## RED sh rb admin-season-lists alone (shared)"; bash $W/in/rf.sh sh red_sh_sl rb $T/admin-season-lists.test.ts 2>&1 | cut -c1-330
echo "######## RED sh rb match-admin-delete + afl-api-c7-observation (shared, 2 files, heavy lock)"
flock /mnt/ssd/afldb-rem4-base/heavy.lock bash $W/in/rf.sh sh red_sh_c7pair rb $T/match-admin-delete.test.ts $T/afl-api-c7-observation.test.ts 2>&1 | cut -c1-330
echo "######## done"
