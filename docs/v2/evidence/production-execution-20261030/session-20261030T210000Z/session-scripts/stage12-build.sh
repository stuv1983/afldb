{
# Stage 12a: exact-revision production build on afldb-prod, detached; log and exit code in the release directory.
set -u
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
R=9ed9c9dd3e84682c43e96c46e98974b245eb54ed; CO=/home/arm/projects/afldb; D=/home/arm/backups/afldb/release-v2-20261030T210000Z
stop() { echo "STOP: $*"; exit 1; }
cd "$CO" || stop checkout
[ "$(git rev-parse HEAD)" = "$R" ] || stop "HEAD"
[ -z "$(git status --porcelain)" ] || stop "checkout not clean"
[ ! -e "$D/build.log" ] && [ ! -e "$D/build.exit" ] || stop "a build log already exists"
grep -c '^AFLDB_ENV=production$' .env | sed 's/^/env_AFLDB_ENV_production_lines=/'
echo "serving_build_before=$(cat .next/standalone/.next/BUILD_ID)"
setsid nohup bash -c "cd '$CO' && export PATH='$PATH' && npm run build > '$D/build.log' 2>&1; echo \$? > '$D/build.exit'" < /dev/null > /dev/null 2>&1 &
sleep 2; echo "build started $(date -u +%T)"; pgrep -f 'next build' | head -3
cat > /dev/null
}
