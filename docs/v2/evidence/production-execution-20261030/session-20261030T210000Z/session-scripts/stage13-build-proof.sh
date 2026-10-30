{
# Read-only proof that the live server serves BUILD_ID QNEHXAtU53TzUjj0Mb7mv without the opt-in trace header.
set -u
W=QNEHXAtU53TzUjj0Mb7mv; B=https://beta.afldb.com; CO=/home/arm/projects/afldb
grep -c '^AFLDB_TRACE_REQUESTS=on$' "$CO/.env" | sed 's/^/env_trace_on_lines=/'
for f in _buildManifest.js _ssgManifest.js; do curl -s -o /dev/null -w "live $B/_next/static/$W/$f %{http_code}\n" "$B/_next/static/$W/$f"; done
curl -s -o /dev/null -w "control: old build id path %{http_code}\n" "$B/_next/static/vcxM_SyDxFCP0sj9n9W1t/_buildManifest.js"
curl -s "$B/beta" | grep -oE "\"buildId\":\"[^\"]+\"|/_next/static/$W/" | sort -u | head -3
ls "$CO/.next/standalone/.next/static" | tr '\n' ' '; echo
p=$(systemctl show -p MainPID --value afldb); echo "MainPID=$p cwd=$(readlink /proc/$p/cwd) start=$(ps -o lstart= -p $p)"
echo "BUILD_ID file mtime: $(stat -c %y "$CO/.next/standalone/.next/BUILD_ID")"
cat > /dev/null
}
