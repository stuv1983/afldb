{
set -u
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin LC_ALL=C
CO=/home/arm/projects/afldb; D=/home/arm/backups/afldb/release-v2-20261030T210000Z
cd "$CO" || exit 1
T=$(mktemp); node "$D/pinned/artifact-manifest.mjs" .next/standalone "$T" > /dev/null
R=$D/standalone-manifest.sha256
echo "recorded lines=$(wc -l < "$R") now=$(wc -l < "$T")"
echo "recorded entries absent or changed now: $(comm -23 <(sort "$R") <(sort "$T") | wc -l)"
comm -23 <(sort "$R") <(sort "$T") | head -5
echo "entries only now: $(comm -13 <(sort "$R") <(sort "$T") | wc -l), by area:"
comm -13 <(sort "$R") <(sort "$T") | awk '{print $2}' | sed -E 's#^(\.next/server/app/[^/]+)/.*#\1/*#; s#^(\.next/cache)/.*#\1/*#' | sort | uniq -c
echo "newest added file mtime: $(comm -13 <(sort "$R") <(sort "$T") | awk '{print ".next/standalone/"$2}' | xargs -r stat -c %y | sort | tail -1)"
rm -f "$T"
find /home/arm -maxdepth 7 -path '*standalone/.next/BUILD_ID' 2>/dev/null | while read -r f; do echo "BUILD_ID $f = $(cat "$f")"; done
cat > /dev/null
}
