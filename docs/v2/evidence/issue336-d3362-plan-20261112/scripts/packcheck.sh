set -u
T=/mnt/ssd/afldb-i349-20261112/green-pack/pack-a25306f9/cand.tar.gz
R=a25306f930015acef602bcc60d76613bdcc3d466
sha256sum "$T"; stat -c '%s bytes mode %a' "$T"
D=$(mktemp -d /mnt/ssd/afldb-i349-packcheck-XXXXXX); chmod 700 "$D"
tar xzf "$T" -C "$D" && ls "$D"
echo "HEAD $(git -C "$D/cand" rev-parse HEAD)"; [ "$(git -C "$D/cand" rev-parse HEAD)" = "$R" ] && echo HEAD_OK
echo "dirty $(git -C "$D/cand" status --porcelain | wc -l) tracked $(git -C "$D/cand" ls-files | wc -l)"
grep -c "TimeZone: 'Etc/UTC'" "$D/cand/tools/v2/issue336-predraft-insert-production.ts"
rm -rf "$D"; echo "check dir removed"
