#!/usr/bin/env bash
# caddy357: why do 14 dynamic pages differ direct vs through Caddy while two direct fetches agree?
source /mnt/ssd/afldb-rem2-caddy357-20261114/env.sh
bash "$W/in/caddyapp.sh" start "$W/caddy-bin/caddy-2.11.4" "$W/in/cf/Caddyfile.production" diag || exit 1
mkdir -p "$EV/diag"
for u in /coaches/ross-lyon-14 /awards/bf-west-coast /aflw/matches/2024-6-ess-syd; do
  n=$(echo "$u" | tr '/' '_')
  curl -s -H 'Host: beta.afldb.com' "http://127.0.0.1:55663$u" > "$EV/diag/d1$n"
  curl -s -H 'Host: beta.afldb.com' "http://127.0.0.1:55663$u" > "$EV/diag/d2$n"
  curl -s -H 'Host: beta.afldb.com' "http://127.0.0.1:55653$u" > "$EV/diag/c1$n"
  curl -s -H 'Host: beta.afldb.com' "http://127.0.0.1:55653$u" > "$EV/diag/c2$n"
  echo "$u  direct1=$(sha256sum < "$EV/diag/d1$n" | cut -c1-10) direct2=$(sha256sum < "$EV/diag/d2$n" | cut -c1-10) caddy1=$(sha256sum < "$EV/diag/c1$n" | cut -c1-10) caddy2=$(sha256sum < "$EV/diag/c2$n" | cut -c1-10) sizes $(stat -c %s "$EV/diag/d1$n" "$EV/diag/c1$n" | tr '\n' ' ')"
  diff <(tr '>' '>\n' < "$EV/diag/d1$n") <(tr '>' '>\n' < "$EV/diag/c1$n") | head -6 | cut -c1-220
done
bash "$W/in/caddyapp.sh" stop
