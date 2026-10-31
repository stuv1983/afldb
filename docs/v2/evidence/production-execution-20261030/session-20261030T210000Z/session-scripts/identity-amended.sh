{
# Amended build-identity gate (owner, 2026-10-31), read-only. x-afldb-build is absent (tracing disabled): not a PASS.
set -u
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
CO=/home/arm/projects/afldb; D=/home/arm/backups/afldb/release-v2-20261030T210000Z; W=QNEHXAtU53TzUjj0Mb7mv; OLD=vcxM_SyDxFCP0sj9n9W1t
cd "$CO" || exit 1
echo "1 checkout HEAD=$(git rev-parse HEAD) porcelain=$(git status --porcelain | wc -l)"
T=$(mktemp); node "$D/pinned/artifact-manifest.mjs" .next/standalone "$T" | sed 's/^/2 now: /'
echo "2 recorded=$(sha256sum < "$D/standalone-manifest.sha256" | cut -c1-64) now=$(sha256sum < "$T" | cut -c1-64)"
diff -q "$T" "$D/standalone-manifest.sha256" >/dev/null && echo "2 standalone matches the recorded manifest: yes" || { echo "2 standalone matches: NO"; diff "$D/standalone-manifest.sha256" "$T" | head -5; }
rm -f "$T"
for base in http://127.0.0.1:3100 https://beta.afldb.com; do
  echo "3 $base new=$(curl -s -o /dev/null -w '%{http_code}' "$base/_next/static/$W/_buildManifest.js") old=$(curl -s -o /dev/null -w '%{http_code}' "$base/_next/static/$OLD/_buildManifest.js") header_x_afldb_build=$(curl -s -D - -o /dev/null "$base/api/health" | grep -ci '^x-afldb-build')"
done
P=$(systemctl show -p MainPID --value afldb); echo "4 MainPID=$P cmd=$(tr '\0' ' ' < /proc/$P/cmdline) cwd=$(readlink /proc/$P/cwd) started=$(ps -o lstart= -p $P)"
for c in $(pgrep -P "$P"); do echo "4 worker pid=$c cmd=$(tr '\0' ' ' < /proc/$c/cmdline | cut -c1-160) cwd=$(readlink /proc/$c/cwd) started=$(ps -o lstart= -p $c)"; done
echo "4 BUILD_ID file $(cat .next/standalone/.next/BUILD_ID) written $(stat -c %y .next/standalone/.next/BUILD_ID); no other standalone bundle exists: $(find /home/arm -maxdepth 5 -path '*standalone/.next/BUILD_ID' 2>/dev/null | wc -l) BUILD_ID file(s)"
cat > /dev/null
}
