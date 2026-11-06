# ISSUE-336 DEV deploy 2026-11-07, step 3 AMENDED by the owner: branch dev-v2-main (refs/heads/dev blocks dev/v2-main). Ref-only.
set -u
cd ~/projects/afldb
echo "now $(date '+%F %T %Z')"
git merge-base --is-ancestor 8b024098a6771fc5e5be2f8bf006c9c3ca8ab55a origin/main && echo published || { echo STOP-step3-unpublished; exit 1; }
git branch dev-v2-main 8b024098a6771fc5e5be2f8bf006c9c3ca8ab55a || { echo STOP-step3-branch; exit 1; }
git branch --set-upstream-to=origin/main dev-v2-main || { echo STOP-step3-upstream; exit 1; }
git branch -vv --list dev-v2-main main dev | cut -c1-120
echo "HEAD still $(git rev-parse --short HEAD) on $(git branch --show-current)"
echo STEP3-OK
