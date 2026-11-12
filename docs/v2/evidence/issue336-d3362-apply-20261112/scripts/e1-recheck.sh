echo "== E1 recheck"; [ ! -e "$RD/approval.json" ] && echo "no approval yet" || { echo "STOP approval exists"; exit 91; }
[ ! -e "$RD/apply.lock" ] || { echo "STOP apply.lock exists"; exit 91; }
[ "$(git -C $OPS/cand rev-parse HEAD)" = "$R" ] && [ "$(git -C $OPS/cand status --porcelain | wc -l)" = 0 ] && echo "ops checkout clean at R" || { echo "STOP ops checkout"; exit 91; }
sha256sum $RD/plan.json $RD/manifest.json $RD/backup.json $RD/restore-evidence.json $RD/target.json
bash $P preflight $R I336 || { echo "STOP preflight rc=$?"; exit 92; }
echo "== plan summary"; (cd $OPS/cand && $NODE --import tsx tools/v2/gap029-ops.ts plan-summary --stage I336 --run-dir $RD) | sed -n '1,12p'
echo "== state"; bash $P state $R I336 $RUN > /tmp/.e1state.$$ 2>&1; rc=$?; cat /tmp/.e1state.$$; grep -q '^STATE BASELINE' /tmp/.e1state.$$; b=$?; rm -f /tmp/.e1state.$$
[ $rc = 0 ] && [ $b = 0 ] && echo "E1_RECHECK_OK" || { echo "STOP state rc=$rc baseline=$b"; exit 93; }
