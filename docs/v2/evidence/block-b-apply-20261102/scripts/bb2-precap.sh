# usage: bb2-precap.sh <stage>   (S1 pre + tz probe + S2 backup)
set -uo pipefail
. /home/arm/bb2-env.sh
S=$1
echo "now $(date -u +%FT%TZ) stage=$S"
[ "$S" = b1 ] && run bash "$PKGD/b-prod.sh" snapshots b1
run bash "$PKGD/b-prod.sh" pre "$R" "$S"
run node /home/arm/bb2-tz.cjs
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
B_STAGE=$S B_APPROVAL_REFERENCE="Owner approval (received before 2026-11-02T03:09:01Z, valid 4h) of ordered Brownlow sequence b0,b1,b2,b3,e at ${R:0:8} on afldb_prod, D-B-ROLE afldb_owner; stage $S fresh backup" bash "$PKGD/capture-b.sh" 2>&1 | tee "/home/arm/blockb-$S-capture-$STAMP.log"
echo "CAPTURE EXIT ${PIPESTATUS[0]}"
