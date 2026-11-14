#!/usr/bin/env bash
# state-b proofs. Run on checkout HEAD = fix commit. Sequential (no parallel use of the checkout).
W=/mnt/ssd/afldb-rem4-fixup-20261115
LOCK=/mnt/ssd/afldb-rem4-base/heavy.lock
SB=tests/integration/settle-afl-api-state-b.test.ts
SA=tests/integration/settle-afl-api.test.ts
H="bash $W/in/h4.sh"
LEFT="INSERT INTO auth_users (email, role, password_hash, totp_secret, disabled_at) VALUES ('CD_I4080-stateb-2071-actor@example.invalid', 'admin', NULL, NULL, now())"
cd $W/cand || exit 1
echo "BATCH1 HEAD=$(git rev-parse HEAD) porcelain=$(git status --porcelain | wc -l) $(date -u +%FT%TZ)"
$H run g2rb   rb   all    $SB
$H run g1snap snap shared $SB
$H run g2snap snap all    $SB
# own leftover refused, never adopted; rebuild (0 users) and snapshot (4 users)
PRESEED="$LEFT" $H run leftrb   rb   shared $SB
PRESEED="$LEFT" $H run leftsnap snap shared $SB
# order with settle-afl-api (separate vitest processes, one fresh copy, order verified by start times)
SEQ=1 flock $LOCK $H run ordsbfirstrb   rb   shared $SB $SA
SEQ=1 flock $LOCK $H run ordsafirstrb   rb   shared $SA $SB
SEQ=1 flock $LOCK $H run ordsbfirstsnap snap shared $SB $SA
SEQ=1 flock $LOCK $H run ordsafirstsnap snap shared $SA $SB
echo "BATCH1 DONE $(date -u +%FT%TZ)"
