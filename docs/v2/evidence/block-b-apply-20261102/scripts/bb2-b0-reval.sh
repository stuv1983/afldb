set -uo pipefail
. /home/arm/bb2-env.sh
S=b0; BKS=20261102T024137Z; BK=/home/arm/backups/afldb/blockb-$S-$BKS
echo "now $(date -u +%FT%TZ)"
run bash "$PKGD/b-prod.sh" snapshots b0
run bash "$PKGD/b-prod.sh" pre "$R" b0
run node "$PKGD/plan-summary.mjs" "$OPS/$S/plan.json"
ls -la $OPS/$S $OPS/$S/evidence
sha256sum $OPS/$S/*.json $OPS/$S/evidence/* $BK/*.dump
cat $OPS/$S/target.json; echo; cat $OPS/$S/evidence/backup-$S.json; echo; cat $OPS/$S/evidence/restore-evidence-$S.json; echo
node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log("plan keys",Object.keys(p).join(","));console.log("request",JSON.stringify(p.request));console.log("expires",p.expiresAt)' $OPS/$S/plan.json
