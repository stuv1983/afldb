{
set -u
TIP=65c02ecc29f93cec8410e01c91f4fc293002b774
CAND=ad245d602f6f0776c1fd86b66fef4f177fe63276
PROD=61a95f7397dacc49fe919ca99cffa00379d612bf
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node
ROOT=/home/arm/afldb-releases
echo "D1 host $(hostname) user $(id -un) at $(date -u +%FT%TZ)"
cd /home/arm/projects/afldb || { echo "D1 STOP no checkout"; exit 1; }
echo "HEAD before $(git rev-parse HEAD); porcelain $(git status --porcelain | wc -l)"
[ "$(git rev-parse HEAD)" = "$PROD" ] || { echo "D1 STOP HEAD is not production $PROD"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "D1 STOP checkout not clean"; git status --porcelain | head; exit 1; }
git fetch origin 2>&1 | sed 's/^/  fetch: /'
echo "origin/main $(git rev-parse origin/main)"
[ "$(git rev-parse origin/main)" = "$TIP" ] || { echo "D1 STOP origin/main is not the package tip"; exit 1; }
git merge --ff-only "$TIP" 2>&1 | tail -3 | sed 's/^/  merge: /'
echo "HEAD after $(git rev-parse HEAD); porcelain $(git status --porcelain | wc -l)"
[ "$(git rev-parse HEAD)" = "$TIP" ] && [ -z "$(git status --porcelain)" ] || { echo "D1 STOP checkout not at clean tip"; exit 1; }
git cat-file -e "$CAND^{commit}" && echo "candidate $CAND present"
m=$(git diff --name-only "$PROD" "$CAND" -- src/db/migrations); echo "migrations PROD..CAND: ${m:-none}"
[ -z "$m" ] || { echo "D1 STOP migrations present"; exit 1; }
echo "--- release.mjs status"
"$N" deploy/release.mjs status 2>&1 | sed 's/^/  /'
echo "status exit ${PIPESTATUS[0]}"
echo "--- links, locks, port"
ls -l "$ROOT" | sed 's/^/  /'
ls "$ROOT"/*.lock 2>/dev/null && echo "D1 STOP lock present" || echo "  no lock"
(exec 3<>/dev/tcp/127.0.0.1/3199) 2>/dev/null && echo "D1 STOP port 3199 in use" || echo "  smoke port 3199 free"
grep -c '"op":"status-pass","id":"61a95f7397da-JYIBkYn8ynPgYMn1e5nK-"' "$ROOT/events.log" | sed 's/^/  status-pass records for rollback target: /'
echo "--- drop-in and service"
systemctl show afldb -p ActiveState -p MainPID -p NRestarts -p DropInPaths -p ActiveEnterTimestamp -p MemoryCurrent | sed 's/^/  /'
echo "  cwd $(readlink /proc/$(systemctl show afldb -p MainPID --value)/cwd)"
echo "--- capacity"
free -m | sed 's/^/  /'
df -h /home/arm | sed 's/^/  /'
avail=$(awk '/^MemAvailable:/ {print int($2/1024)}' /proc/meminfo)
free_gb=$(df -P -BG "$ROOT" | awk 'NR==2 {sub("G","",$4); print $4}')
echo "  MemAvailable ${avail} MB (floor 2100); free disk ${free_gb} GB (floor 6)"
[ "$avail" -ge 2100 ] && [ "$free_gb" -ge 6 ] && echo "D1 CAPACITY OK" || echo "D1 STOP capacity below floor"
which tmux screen 2>/dev/null | sed 's/^/  multiplexer: /'
echo "D1 END $(date -u +%FT%TZ)"
}
