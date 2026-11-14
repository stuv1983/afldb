#!/usr/bin/env bash
# caddy357 LOW-7 RED on the previous files (checkout final/ at 70e9a736) for the other binary/file combinations.
source /mnt/ssd/afldb-rem2-caddy357-20261114/env.sh
cd "$W"
echo "previous files (commit 70e9a736): $(git -C final rev-parse HEAD)  prod $(sha256sum final/deploy/Caddyfile.production | cut -c1-12) dev $(sha256sum final/deploy/Caddyfile | cut -c1-12)"
for spec in caddy-system:Caddyfile.production:red-prod-2.11.9 caddy-2.11.4:Caddyfile.production:red-prod-2.11.4 caddy-system:Caddyfile:red-dev-2.11.9 caddy-2.11.4:Caddyfile:red-dev-2.11.4; do
  IFS=: read -r bin cf label <<< "$spec"
  [ -d "matrix/$label" ] && [ "$label" = red-prod-2.11.9 ] || HOOK=$W/in/redact.sh bash matrix.sh "$W/caddy-bin/$bin" "$W/final/deploy/$cf" "$label" > "evidence/$label.txt" 2>&1
  echo "RED   $label: token in access log = $(grep -c PROBE-INVITE "matrix/$label/logs/afldb-access.log")"
done
for spec in r2-prod-2.11.9 r2-prod-2.11.4 r2-dev-2.11.9 r2-dev-2.11.4; do
  echo "GREEN $spec: token in access log = $(grep -c PROBE-INVITE "matrix/$spec/logs/afldb-access.log"), in stderr = $(grep -c PROBE-INVITE "matrix/$spec/caddy-stderr.log")"
done
