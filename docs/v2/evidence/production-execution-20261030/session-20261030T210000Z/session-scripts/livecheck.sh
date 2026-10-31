{
# Read-only: the live service and the build directories after the failed Stage 12 build.
cd /home/arm/projects/afldb || exit 1
ls -ld .next .next/standalone .next/standalone/.next 2>&1
echo "standalone BUILD_ID=$(cat .next/standalone/.next/BUILD_ID 2>&1)"
echo "top-level .next BUILD_ID=$(cat .next/BUILD_ID 2>&1)"
ls .next | tr '\n' ' '; echo
echo "afldb.service $(systemctl is-active afldb) since $(systemctl show -p ActiveEnterTimestamp --value afldb)"
curl -s -o /dev/null -D - http://127.0.0.1:3100/api/health | grep -iE '^(HTTP|x-afldb-build)'
curl -s http://127.0.0.1:3100/api/health; echo
for u in / /players /matches /seasons/2025 /admin/operations; do curl -s -o /dev/null -w "$u %{http_code}\n" "http://127.0.0.1:3100$u"; done
curl -s -o /dev/null -D - https://beta.afldb.com/api/health | grep -iE '^(HTTP|x-afldb-build)'
free -m; nproc
echo "porcelain=$(git status --porcelain | wc -l) HEAD=$(git rev-parse HEAD)"
grep -nE 'max-old-space|NODE_OPTIONS' package.json .env 2>/dev/null | sed 's/=.*/=<set>/' | head
cat > /dev/null
}
