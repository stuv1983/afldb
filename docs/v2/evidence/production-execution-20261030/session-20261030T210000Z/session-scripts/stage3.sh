{
# Stage 3 (D-V2-PROD-EXEC-1): reviewed checkout on afldb-prod. The serving .next/standalone is not touched.
set -u
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
R=9ed9c9dd3e84682c43e96c46e98974b245eb54ed
stop() { echo "STOP: $*"; exit 1; }
cd /home/arm/projects/afldb || stop "checkout"
echo "== 3.0 before: HEAD=$(git rev-parse HEAD) branch=$(git rev-parse --abbrev-ref HEAD) standalone_build=$(cat .next/standalone/.next/BUILD_ID 2>/dev/null)"
[ -z "$(git status --porcelain)" ] || { git status --porcelain | head -20; stop "checkout is not clean before the fast-forward"; }
echo "== 3.1 git fetch origin"; git fetch origin || stop "git fetch"
echo "origin/main=$(git rev-parse origin/main)"
[ "$(git rev-parse origin/main)" = "$R" ] || stop "origin/main is not $R"
echo "== 3.2 git merge --ff-only $R"; git merge --ff-only "$R" || stop "fast-forward"
[ "$(git rev-parse HEAD)" = "$R" ] || stop "HEAD is not $R"
[ -z "$(git status --porcelain)" ] || { git status --porcelain | head -20; stop "checkout not clean after the fast-forward"; }
echo "HEAD=$(git rev-parse HEAD) status clean; standalone_build=$(cat .next/standalone/.next/BUILD_ID)"
echo "== 3.3 npm ci ($(date -u +%T))"; npm ci --no-audit --no-fund 2>&1 | tail -15; [ "${PIPESTATUS[0]}" = 0 ] || stop "npm ci"
echo "npm ci done $(date -u +%T)"
[ -z "$(git status --porcelain)" ] || { git status --porcelain | head -20; stop "checkout not clean after npm ci"; }
echo "== 3.4 deploy preflight (read-only)"
npm run preflight -- --mode deploy --environment prod --dsn-env AFLDB_OWNER_DATABASE_URL --expect-database afldb_prod; echo "preflight exit=$?"
echo "== 3.5 legacy-writers as arm (expected: units PASS, polkit cannot be listed)"
node --import tsx tools/v2/cutover-preflight.ts legacy-writers; echo "legacy-writers(arm) exit=$?"
echo "standalone_build_after=$(cat .next/standalone/.next/BUILD_ID)"
cat > /dev/null
}
