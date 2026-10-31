{
# Stage 0, isolated host, read only: the accepted a4641ca0 before set with its recorded hashes, disk, port, new root.
set -u
REF=/home/arm/afldb-v2-currentshadow-20261028T192336Z
printf '%s  %s\n%s  %s\n' a4641ca0d1533c30d6670dfa9b555552548a91b736054e941adba75cee0c46fc "$REF/archive/afldb_prod-20261028T192336Z.dump" \
  72f000462a2e7560afee97edf5598723a2ccfa45c9664e7d57ce7b62dddb57d4 "$REF/archive/afldb_prod-20261028T192336Z.provenance.json" | sha256sum --check --strict -
echo "manifest: $( [ "$(sha256sum < "$REF/evidence/evidence-sha256.txt" | cut -c1-64)" = ea197fcf40c1b27108bebb1cc9b0a6523e8d79804952f77610f5f4606ac8ac75 ] && echo OK || echo MISMATCH)"
for f in before.preservation.json before.manifest.json; do
  grep -E "^[0-9a-f]{64}  \./$f\$" "$REF/evidence/evidence-sha256.txt" | sed "s#  \./#  $REF/evidence/#" | sha256sum --check --strict -
done
echo "archive_bytes=$(stat -c %s "$REF/archive/afldb_prod-20261028T192336Z.dump") node_modules=$(du -sb /home/arm/afldb-v2-linuxverify-20261028T0310Z/src/node_modules | cut -f1)"
echo "free=$(df -B1 --output=avail /home/arm | tail -1 | tr -d ' ') port55491_listeners=$(ss -H -ltn '( sport = :55491 )' | wc -l)"
test ! -e /home/arm/afldb-v2-prodexec-20261030T210000Z && echo "new root absent: OK"
cat > /dev/null
}
