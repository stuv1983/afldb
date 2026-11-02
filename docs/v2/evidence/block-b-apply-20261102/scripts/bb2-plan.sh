# prod: usage bb2-plan.sh <stage> <BKS> : S4 target+baseline, S5 assemble, S6 plan + summary
set -uo pipefail
. /home/arm/bb2-env.sh
S=$1; BKS=$2; BK=/home/arm/backups/afldb/blockb-$S-$BKS
echo "now $(date -u +%FT%TZ) stage=$S"
run bash "$PKGD/b-prod.sh" target "$R" $S
run bash "$PKGD/b-prod.sh" baseline "$R" $S
run node "$PKGD/assemble-backup-evidence.mjs" --stage $S --revision $R --target $OPS/$S/target.json --live-baseline $OPS/$S/baseline-live.json \
  --restored-baseline $OPS/$S-in/baseline-restored.json --sidecar $BK/afldb_prod-$BKS.provenance.json --dump $BK/afldb_prod-$BKS.dump \
  --restore-facts $OPS/$S-in/restore-facts.json --expect-ledger-digest 573594e9365b642ec518c252b17de11d3a423872c53c3020ab525db5904aaf57 --out-dir $OPS/$S/evidence
run bash "$PKGD/b-prod.sh" plan "$R" $S "$OPS/$S/evidence/backup-$S.json" "$BK/afldb_prod-$BKS.dump" "$OPS/$S/evidence/restore-evidence-$S.json"
run node "$PKGD/plan-summary.mjs" "$OPS/$S/plan.json"
node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log("REQUEST",JSON.stringify(p.request).slice(0,3000));console.log("PAYLOAD",JSON.stringify(p.payload).slice(0,3000))' $OPS/$S/plan.json
sha256sum $OPS/$S/*.json $OPS/$S/evidence/*
