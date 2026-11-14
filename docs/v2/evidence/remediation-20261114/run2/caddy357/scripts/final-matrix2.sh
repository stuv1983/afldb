#!/usr/bin/env bash
# caddy357 round 2 (review LOW-7): the full matrix on the files with the widened invite redaction; both binaries, both files.
source /mnt/ssd/afldb-rem2-caddy357-20261114/env.sh
cd "$W"
C=corpus
sha256sum in/cf/Caddyfile.production in/cf/Caddyfile | tee evidence/r2-caddyfile-sha256.txt
for spec in "caddy-system:Caddyfile.production:r2-prod-2.11.9" "caddy-2.11.4:Caddyfile.production:r2-prod-2.11.4" "caddy-system:Caddyfile:r2-dev-2.11.9" "caddy-2.11.4:Caddyfile:r2-dev-2.11.4"; do
  IFS=: read -r bin cf label <<< "$spec"
  HOOK=$W/in/hooks-all.sh bash matrix.sh "$W/caddy-bin/$bin" "$W/in/cf/$cf" "$label" $C/legit.tsv $C/deny.tsv $C/legit-head.tsv $C/deny-head.tsv $C/legit-post.tsv $C/deny-post.tsv $C/boundary.tsv $C/open.tsv > "evidence/matrix-$label.txt" 2>&1
  echo "done $label rc=$?"
done
echo FINAL-MATRIX2-DONE
