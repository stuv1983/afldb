# ISSUE-336 DEV deploy 2026-11-07, step 2b (artifact archive, read-only on the checkout) and step 3 (ref-only branch).
set -u -o pipefail
W=/mnt/ssd/afldb/workspaces/i336-deploy-20261107
D=$(cat "$W/D"); echo "D=$D"; echo "start $(date '+%F %T %Z')"
cd ~/projects/afldb
[ "$(cat .next/BUILD_ID)" = 8sFpWkolwF1yKuKbFkOir ] || { echo "STOP-step2b build changed"; exit 1; }
tar -cf "$D/dev-app-8sFpWkolwF1yKuKbFkOir.tar" .next/BUILD_ID .next/standalone || { echo STOP-step2b-tar; exit 1; }
( cd "$D" && sha256sum dev-app-8sFpWkolwF1yKuKbFkOir.tar > SHA256SUMS-app && sha256sum -c SHA256SUMS-app ) || { echo STOP-step2b-sum; exit 1; }
X1=$(tar -xOf "$D/dev-app-8sFpWkolwF1yKuKbFkOir.tar" .next/BUILD_ID); X2=$(tar -xOf "$D/dev-app-8sFpWkolwF1yKuKbFkOir.tar" .next/standalone/.next/BUILD_ID)
N=$(tar -tf "$D/dev-app-8sFpWkolwF1yKuKbFkOir.tar" | grep -c '/\.env'); C=$(tar -tf "$D/dev-app-8sFpWkolwF1yKuKbFkOir.tar" | wc -l)
echo "archive BUILD_IDs $X1 / $X2; .env entries $N; entries $C; size $(du -h "$D/dev-app-8sFpWkolwF1yKuKbFkOir.tar" | cut -f1)"
cat "$D/SHA256SUMS-app"
[ "$X1" = 8sFpWkolwF1yKuKbFkOir ] && [ "$X2" = 8sFpWkolwF1yKuKbFkOir ] && [ "$N" = 0 ] || { echo STOP-step2b; exit 1; }
echo STEP2B-OK
echo "-- step 3"
git fetch --prune origin || { echo STOP-step3-fetch; exit 1; }
git merge-base --is-ancestor 8b024098a6771fc5e5be2f8bf006c9c3ca8ab55a origin/main && echo published || { echo STOP-step3-unpublished; exit 1; }
echo "origin/main $(git rev-parse origin/main)"
git branch dev/v2-main 8b024098a6771fc5e5be2f8bf006c9c3ca8ab55a || { echo STOP-step3-branch; exit 1; }
git branch --set-upstream-to=origin/main dev/v2-main || { echo STOP-step3-upstream; exit 1; }
git branch -vv --list dev/v2-main main | cut -c1-120
echo "HEAD still $(git rev-parse --short HEAD) on $(git branch --show-current)"
echo "end $(date '+%F %T %Z')"; echo STEP3-OK
