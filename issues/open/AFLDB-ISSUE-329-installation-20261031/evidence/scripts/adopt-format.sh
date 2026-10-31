#!/bin/bash
# Run as rehearsal. F8: adopt from a manifest written by production's pinned artifact-manifest.mjs.
set -u
R=/home/rehearsal/afldb-329-proof-20261030T233836Z
C=$R/candidate-6790983a
E=$R/final-proof-20261031
A=$R/adopt-format-root
export PATH=/opt/node-v22.21.0-linux-x64/bin:/usr/bin:/bin
exec > >(tee "$E/adopt-format.log") 2>&1
echo "=== F8 adopt from a production-format manifest ($(date -u +%FT%TZ))"
[ -e "$A" ] && { echo "exists $A"; exit 1; }
P=$C/docs/v2/evidence/lock-build-20261029/artifact-manifest.mjs
echo "pinned script $(sha256sum < "$P" | cut -c1-64) (expect ea37a7e70087185c88815be39cb952e94bde2be624d6b848c6a2ca2324055b10)"
node "$P" "$R/tools-checkout/.next/standalone" "$E/inplace-manifest.artifact-format.sha256"
cmp "$E/inplace-manifest.artifact-format.sha256" <(sed -E 's#^([0-9a-f]{64}) [ *](\./)?#\1  #' "$R/systemd-proof/inplace-manifest.sha256" | LC_ALL=C sort -k2) \
  && echo "same entries as the sha256sum manifest A (normalised, byte-order sorted)" || echo "entries differ from manifest A (format comparison only)"
mkdir -p "$A"
node "$C/deploy/release.mjs" adopt --root "$A" --checkout "$R/tools-checkout" --revision 5bf6942f475d0ef1f0d867fe9076727b32102514 \
  --afldb-env production --expect-build-id gC9Y3ew1t8MqKAeq01-8D --from-manifest "$E/inplace-manifest.artifact-format.sha256"; rc=$?
echo "adopt exit $rc"
node "$C/deploy/release.mjs" verify 5bf6942f475d-gC9Y3ew1t8MqKAeq01-8D --root "$A"; echo "verify exit $?"
node "$C/deploy/release.mjs" status --root "$A" --no-live; echo "status --no-live exit $?"
echo "--- refusal: wrong expected BUILD_ID sets no link"
B=$R/adopt-refusal-root; mkdir -p "$B"
node "$C/deploy/release.mjs" adopt --root "$B" --checkout "$R/tools-checkout" --revision 5bf6942f475d0ef1f0d867fe9076727b32102514 \
  --afldb-env production --expect-build-id QNEHXAtU53TzUjj0Mb7mv --from-manifest "$E/inplace-manifest.artifact-format.sha256"; echo "adopt exit $?"
ls -A "$B"; [ -e "$B/current" ] && echo "current set!" || echo "no current link"
