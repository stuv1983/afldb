#!/usr/bin/env bash
# state-b mutation proofs (scratch copies, one temporary edit of the checkout each, restored), then typecheck + lint gate.
W=/mnt/ssd/afldb-rem4-fixup-20261115
LOCK=/mnt/ssd/afldb-rem4-base/heavy.lock
SB=tests/integration/settle-afl-api-state-b.test.ts
H="bash $W/in/h4.sh"
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
cd $W/cand || exit 1
echo "BATCH3 HEAD=$(git rev-parse HEAD) porcelain=$(git status --porcelain | wc -l) $(date -u +%FT%TZ)"
echo "=== M1: the actor is NOT removed by cleanup (the DELETE becomes a SELECT)"
sed -i 's/^    DELETE FROM auth_users$/    SELECT count(*) FROM auth_users/' $SB
echo "mutated: $(git diff --stat | tail -1) porcelain=$(git status --porcelain | wc -l)"
$H run m1rb rb shared $SB
$H run m1snap snap shared $SB
git checkout -q HEAD -- $SB; echo "restored porcelain=$(git status --porcelain | wc -l)"
echo "=== M2: the run changes a PRE-EXISTING user (snapshot has 4)"
sed -i 's/^  adminUserId = actor.id;$/  adminUserId = actor.id;\n  await sql`UPDATE auth_users SET totp_last_step = 1 WHERE id = (SELECT min(id) FROM auth_users WHERE lower(email) <> lower(${ACTOR_EMAIL}))`;/' $SB
echo "mutated: $(git diff --stat | tail -1) porcelain=$(git status --porcelain | wc -l)"
$H run m2snap snap shared $SB
git checkout -q HEAD -- $SB; echo "restored porcelain=$(git status --porcelain | wc -l)"
echo "=== typecheck (next typegen && tsc --noEmit) and lint gate at HEAD"
echo "HEAD=$(git rev-parse HEAD) porcelain-before=$(git status --porcelain | wc -l)"
flock $LOCK timeout 900 node node_modules/next/dist/bin/next typegen > $W/evidence/typegen.log 2>&1; echo "typegen rc=$?"
flock $LOCK timeout 900 node node_modules/typescript/bin/tsc --noEmit > $W/evidence/tsc.log 2>&1; echo "tsc rc=$?"; tail -5 $W/evidence/tsc.log
flock $LOCK timeout 1800 node_modules/.bin/tsx tools/dev/lint-gate.ts > $W/evidence/lint-gate.log 2>&1; echo "lint:gate rc=$?"; tail -3 $W/evidence/lint-gate.log
echo "porcelain-after=$(git status --porcelain | wc -l)"
git status --porcelain | head -5
echo "BATCH3 DONE $(date -u +%FT%TZ)"
