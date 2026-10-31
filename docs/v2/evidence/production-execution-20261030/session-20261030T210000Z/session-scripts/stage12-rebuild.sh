{
# Incident recovery, owner Option 1: ONE controlled rebuild of 9ed9c9dd. Process-local settings only.
set -u
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
R=9ed9c9dd3e84682c43e96c46e98974b245eb54ed; CO=/home/arm/projects/afldb; D=/home/arm/backups/afldb/release-v2-20261030T210000Z
stop() { echo "STOP: $*"; exit 1; }
echo "== pre-checks $(date -u +%FT%TZ)"
st=$(systemctl is-active afldb); echo "afldb.service=$st"; [ "$st" = inactive ] || stop "afldb.service is not stopped"
pgrep -af 'next build|next-server|standalone/server.js' | grep -v pgrep && stop "a build or server process is running"
echo "postgresql: $(systemctl is-active postgresql) $(pg_isready -h localhost -p 5432 2>&1)"
pg_isready -h localhost -p 5432 -q || stop "postgres not ready"
cd "$CO" || stop checkout
[ "$(git rev-parse HEAD)" = "$R" ] || stop HEAD; [ -z "$(git status --porcelain)" ] || stop "checkout not clean"
echo "HEAD=$R clean; env AFLDB_ENV=production lines: $(grep -c '^AFLDB_ENV=production$' .env)"
free -m; awk '/MemAvailable/ {print "MemAvailable_kB="$2}' /proc/meminfo
ma=$(awk '/MemAvailable/ {print $2}' /proc/meminfo); [ "$ma" -ge 3000000 ] || stop "MemAvailable below 3.0 GB with the service stopped"
echo "== preserve the failed attempt's logs"
[ -e "$D/build.log" ] && [ ! -e "$D/build.attempt1-oom.log" ] && mv -n "$D/build.log" "$D/build.attempt1-oom.log" && mv -n "$D/build.exit" "$D/build.attempt1-oom.exit" || stop "preserving attempt 1 logs"
sha256sum "$D/build.attempt1-oom.log" "$D/build.attempt1-oom.exit"
[ ! -e "$D/build.attempt2.log" ] || stop "attempt 2 log exists"
echo "== start attempt 2 (detached): NODE_OPTIONS=--max-old-space-size=3072 AFLDB_BUILD_WORKERS=1 AFLDB_ENV=production"
setsid nohup bash -c "cd '$CO' && export PATH='$PATH' NODE_OPTIONS=--max-old-space-size=3072 AFLDB_BUILD_WORKERS=1 AFLDB_ENV=production && npm run build > '$D/build.attempt2.log' 2>&1; echo \$? > '$D/build.attempt2.exit'" < /dev/null > /dev/null 2>&1 &
BP=$!; sleep 1; PG=$(ps -o pgid= -p "$BP" | tr -d ' ')
# Memory guard: the heap limit is not a total RAM limit. If MemAvailable falls below 200 MB, stop the build's process
# group so the kernel OOM killer cannot pick PostgreSQL; the exit file then records the failure.
setsid nohup bash -c "while kill -0 $BP 2>/dev/null; do m=\$(awk '/MemAvailable/ {print \$2}' /proc/meminfo); echo \"\$(date -u +%T) MemAvailable_kB=\$m\" >> '$D/build.attempt2.mem.log'; if [ \"\$m\" -lt 204800 ]; then echo \"\$(date -u +%T) GUARD: MemAvailable below 200 MB, stopping build group $PG\" >> '$D/build.attempt2.mem.log'; kill -TERM -- -$PG; sleep 10; kill -KILL -- -$PG; fi; sleep 3; done" < /dev/null > /dev/null 2>&1 &
echo "build pid=$BP pgid=$PG started $(date -u +%T)"
cat > /dev/null
}
