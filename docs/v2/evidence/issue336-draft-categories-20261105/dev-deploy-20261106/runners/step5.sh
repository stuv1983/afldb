# ISSUE-336 DEV deploy 2026-11-07, step 5: privileges (idempotent). Prints STEP5-OK rc=0 or STOP-step5.
set -u -o pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
cd ~/projects/afldb
echo "start $(date '+%F %T %Z') HEAD $(git rev-parse --short HEAD) branch $(git branch --show-current)"
npm run db:privileges 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -viE 'postgres(ql)?://|password=' | tail -25
rc=${PIPESTATUS[0]}
echo "rc=$rc"; [ "$rc" = 0 ] && echo STEP5-OK || echo STOP-step5
