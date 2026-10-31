{
# Owner decision 2026-10-31: move (never delete) the untracked nightly settle manifests out of the production
# checkout into the release directory, hash-verified, so the checkout is clean for Stage 3 and A-REL.
set -u
export LC_ALL=C
stop() { echo "STOP: $*"; exit 1; }
CO=/home/arm/projects/afldb; SUB=docs/rebuild-manifests/afltables_fitzroy_core
DEST=/home/arm/backups/afldb/release-v2-20261030T210000Z/checkout-settle-manifests
cd "$CO" || stop checkout
[ "$(git rev-parse HEAD)" = ff100dc2b8da8523f550ef45a9eaa3ef96d9d840 ] || stop "HEAD changed"
LIST=$(git status --porcelain | sed 's/^?? //')
n=$(printf '%s\n' "$LIST" | grep -c .)
bad=$(git status --porcelain | grep -vE '^\?\? docs/rebuild-manifests/afltables_fitzroy_core/settle-[A-Za-z0-9][A-Za-z0-9._-]*\.json$')
[ -z "$bad" ] || { echo "$bad"; stop "unexpected status lines"; }
[ "$n" = 61 ] || stop "expected 61 untracked files, found $n"
[ ! -e "$DEST" ] || stop "$DEST exists"
mkdir -m 700 "$DEST" || stop mkdir
printf '%s\n' "$LIST" | sed "s#^$SUB/##" > "$DEST/.names"
( cd "$SUB" && xargs -d '\n' sha256sum -- < "$DEST/.names" ) > "$DEST/SHA256SUMS" || stop "hashing"
rm -f "$DEST/.names"
[ "$(wc -l < "$DEST/SHA256SUMS")" = 61 ] || stop "manifest count"
echo "manifest sha256=$(sha256sum < "$DEST/SHA256SUMS" | cut -c1-64) files=61 source_dir=$CO/$SUB"
while read -r h f; do mv -n -- "$SUB/$f" "$DEST/$f" || stop "mv $f"; done < "$DEST/SHA256SUMS"
( cd "$DEST" && sha256sum --check --strict --quiet SHA256SUMS ) || stop "hash check at destination"
while read -r h f; do [ ! -e "$SUB/$f" ] || stop "$f still in the checkout"; done < "$DEST/SHA256SUMS"
chmod 600 "$DEST"/*
echo "moved and verified: $(ls "$DEST" | grep -c '^settle-') files in $DEST"
echo "porcelain_lines=$(git status --porcelain | grep -c .)"
cat > /dev/null
}
