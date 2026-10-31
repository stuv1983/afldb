{
# Before service start: exit, production configuration, runtime files, BUILD_IDs, complete bundle, artifact manifest.
set -u
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
CO=/home/arm/projects/afldb; D=/home/arm/backups/afldb/release-v2-20261030T210000Z; S=$CO/.next/standalone
stop() { echo "STOP: $*"; exit 1; }
cd "$CO" || stop checkout
[ "$(cat "$D/build.attempt2.exit")" = 0 ] || stop "build exit"
grep -q 'prepare-standalone: AFLDB_ENV=production detected' "$D/build.attempt2.log" || stop "production configuration line missing"
grep -q 'prepare-standalone: standalone bundle ready' "$D/build.attempt2.log" || stop "bundle not ready"
a=$(cat .next/BUILD_ID); b=$(cat "$S/.next/BUILD_ID"); echo "BUILD_ID .next=$a standalone=$b"; [ -n "$a" ] && [ "$a" = "$b" ] || stop "BUILD_ID mismatch"
for f in server.js package.json .next/BUILD_ID .next/static .next/server .next/cache public node_modules; do [ -e "$S/$f" ] || stop "missing $S/$f"; done
n1=$(find .next/static -type f | wc -l); n2=$(find "$S/.next/static" -type f | wc -l); echo "static files root=$n1 standalone=$n2"; [ "$n1" = "$n2" ] && [ "$n1" -gt 0 ] || stop "static copy incomplete"
for f in data/reference/coleman-derivation.json data/reference/seasons.json data/reference/afl-api-identities.json data/reference/draftguru-event-kinds.json tools/rebuild/draftguru/draftguru-contract.json tools/rebuild/afltables/afltables-contract.json tools/rebuild/fitzroy/fitzroy-contract.json; do
  cmp -s "$f" "$S/$f" || stop "runtime file $f differs or is missing"; done; echo "runtime reference files: 7/7 byte-identical"
find "$S" -name '.env*' | grep -q . && stop ".env file in bundle"
echo "porcelain=$(git status --porcelain | wc -l) HEAD=$(git rev-parse HEAD)"; [ -z "$(git status --porcelain)" ] || stop "checkout dirty"
[ "$(sha256sum < "$D/pinned/artifact-manifest.mjs" | cut -c1-64)" = ea37a7e70087185c88815be39cb952e94bde2be624d6b848c6a2ca2324055b10 ] || stop "pinned artifact-manifest.mjs hash"
[ ! -e "$D/standalone-manifest.sha256" ] || stop "manifest exists"
node "$D/pinned/artifact-manifest.mjs" "$S" "$D/standalone-manifest.sha256" || stop "artifact manifest"
printf 'BUILD_ID=%s\nrevision=%s\nbuild_log=build.attempt2.log\n' "$a" "$(git rev-parse HEAD)" > "$D/build.identity.txt"
sha256sum "$D/build.attempt2.log" "$D/build.attempt2.exit" "$D/build.attempt2.mem.log" "$D/standalone-manifest.sha256" "$D/build.identity.txt"
echo "afldb.service=$(systemctl is-active afldb)"
echo "VERIFY PASS before start"
cat > /dev/null
}
