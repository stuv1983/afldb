#!/usr/bin/env bash
# caddy357: final matrix on the FINAL deploy files, both binaries, sequential (ports are shared).
source /mnt/ssd/afldb-rem2-caddy357-20261114/env.sh
cd "$W"
C=corpus
for spec in "caddy-system:Caddyfile.production:prod-2.11.9" "caddy-2.11.4:Caddyfile.production:prod-2.11.4" "caddy-system:Caddyfile:dev-2.11.9" "caddy-2.11.4:Caddyfile:dev-2.11.4"; do
  IFS=: read -r bin cf label <<< "$spec"
  HOOK=$W/in/special.sh bash matrix.sh "$W/caddy-bin/$bin" "$W/in/cf/$cf" "$label" $C/legit.tsv $C/deny.tsv $C/legit-head.tsv $C/deny-head.tsv $C/legit-post.tsv $C/deny-post.tsv $C/boundary.tsv $C/open.tsv > "evidence/matrix-$label.txt" 2>&1
  echo "done $label rc=$?"
done
echo FINAL-MATRIX-DONE
