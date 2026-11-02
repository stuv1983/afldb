# usage: bb2-apply.sh <stage> <BKS> <planDigest> <approvalExpiryISO>
set -uo pipefail
. /home/arm/bb2-env.sh
S=$1; BKS=$2; DIG=$3; EXP=$4; BK=/home/arm/backups/afldb/blockb-$S-$BKS
echo "now $(date -u +%FT%TZ) stage=$S"
PD=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).digest)' $OPS/$S/plan.json)
[ "$PD" = "$DIG" ] || { echo "STOP plan digest $PD != expected $DIG"; exit 20; }
REF="Owner approval (received before 2026-11-02T03:09:01Z, valid 4h) of ordered Brownlow sequence b0,b1,b2,b3,e at ${R:0:8} on afldb_prod, D-B-ROLE afldb_owner; stage $S plan digest $DIG"
run node "$PKGD/make-approval.mjs" --plan "$OPS/$S/plan.json" --revision "$R" --reference "$REF" --expires "$EXP" --out "$OPS/$S/approval.json"
sha256sum "$OPS/$S/approval.json"
bash "$PKGD/b-prod.sh" apply "$R" "$S" "$OPS/$S/plan.json" "$OPS/$S/approval.json" "$BK/afldb_prod-$BKS.dump" "$OPS/$S/evidence/restore-evidence-$S.json"
X=$?; echo "##### APPLY EXIT $X"
bash "$PKGD/b-prod.sh" accept "$R" "$S"; A=$?; echo "##### ACCEPT EXIT $A"
[ $X = 0 ] && [ $A = 0 ] && echo "STAGE $S COMPLETE" || echo "STAGE $S NOT CLEAN: apply=$X accept=$A"
ls -la $OPS/$S; [ -f $OPS/$S/receipt.json ] && sha256sum $OPS/$S/receipt.json
exit $(( X != 0 ? X : A ))
