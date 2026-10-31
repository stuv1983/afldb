{
# Stage 14, read-only: the host release directory's backup sets and moved manifests still verify.
set -u
D=/home/arm/backups/afldb/release-v2-20261030T210000Z
cd "$D" || exit 1
for s in frozen postschema restore-test; do [ -f "$s.SHA256SUMS" ] && { sha256sum --check --strict --quiet "$s.SHA256SUMS" && echo "host $s.SHA256SUMS OK ($(wc -l < "$s.SHA256SUMS") files)" || echo "host $s.SHA256SUMS FAILED"; }; done
( cd checkout-settle-manifests && sha256sum --check --strict --quiet SHA256SUMS && echo "host checkout-settle-manifests OK ($(wc -l < SHA256SUMS) files)" || echo "host checkout-settle-manifests FAILED" )
ls -la "$D" | head -40
cat > /dev/null
}
