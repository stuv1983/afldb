echo "== E2 statement + approval"
[ ! -e "$RD/approval-statement.txt" ] || { echo "STOP statement exists"; exit 94; }
(cd $OPS/cand && $NODE --import tsx tools/v2/gap029-ops.ts statement --stage I336 --run-dir $RD --window "from $NB until $EXP (16:00-17:30 AEDT, 12 November 2026)") > $RD/approval-statement.txt || { echo "STOP statement"; exit 94; }
cat $RD/approval-statement.txt
bash $P approve $R I336 $RUN $PD $RD/approval-statement.txt $EXP $NB; echo "APPROVE-EXIT=$?"
