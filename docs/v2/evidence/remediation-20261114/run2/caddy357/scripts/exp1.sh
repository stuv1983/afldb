#!/usr/bin/env bash
# caddy357 experiment 1: how does Caddy see the path? admin off, run/validate/adapt --config only.
# usage: exp1.sh <binary> <label>
set -u
source /mnt/ssd/afldb-rem2-caddy357-20261114/env.sh
BIN=$1; LABEL=$2
R=$W/exp1/$LABEL; rm -rf "$R"; mkdir -p "$R/xdg/data" "$R/xdg/config"
export XDG_DATA_HOME=$R/xdg/data XDG_CONFIG_HOME=$R/xdg/config
CF=$W/in/exp1.Caddyfile
"$BIN" adapt --config "$CF" --adapter caddyfile > "$R/adapted.json" 2> "$R/adapt.err"
grep -q '"admin":{"disabled":true' "$R/adapted.json" || { echo "ADMIN GUARD FAILED"; exit 3; }
echo "== $("$BIN" version) admin disabled (guard ok)"
"$BIN" validate --config "$CF" --adapter caddyfile > "$R/validate.out" 2>&1; echo "validate rc=$?"
"$BIN" run --config "$CF" --adapter caddyfile > "$R/caddy.stderr" 2>&1 & CPID=$!
echo "$CPID" > "$R/caddy.pid"
sleep 2
while IFS= read -r p; do
  [ -z "$p" ] && continue
  out=$(curl -s --path-as-is --max-time 5 -D "$R/h" "http://127.0.0.1:$CADDY_PORT$p")
  m=$(grep -i '^x-m-' "$R/h" | tr -d '\r' | sed 's/^X-M-//I; s/: yes//I' | tr '\n' ',')
  printf '%-34s | %s | matched=[%s]\n' "$p" "$out" "$m"
done < "$W/in/exp1.paths"
kill $CPID; wait $CPID 2>/dev/null
sleep 1
ss -ltnH | awk '{print $4}' | grep -E ":$CADDY_PORT$" && echo "STILL LISTENING" || echo "stopped: no listener on $CADDY_PORT"
