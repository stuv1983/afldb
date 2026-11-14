#!/usr/bin/env bash
# caddy357: ONE isolated Caddy (admin off, own XDG dirs, run --config only) on 55653 in front of the REAL app on 55663.
# usage: caddyapp.sh start <binary> <Caddyfile> <label> | stop
# SCOPE-TAG: caddy357-afldb-rem2-20261114
set -u
source /mnt/ssd/afldb-rem2-caddy357-20261114/env.sh
if [ "$1" = stop ]; then
  [ -f "$W/caddyapp.pid" ] && { kill "$(cat "$W/caddyapp.pid")" 2>/dev/null; sleep 2; rm -f "$W/caddyapp.pid"; }
  ss -ltnH | awk '{print $4}' | grep -E ":$CADDY_PORT$" && echo "STILL LISTENING" || echo "stopped: no listener on $CADDY_PORT"
  pgrep -af "$W/caddyapp" >/dev/null && echo "PROCESS LEFT" || echo "no caddyapp process left"
  exit 0
fi
BIN=$2; CF=$3; LABEL=$4
R=$W/caddyapp/$LABEL; rm -rf "$R"; mkdir -p "$R/logs" "$R/xdg/data" "$R/xdg/config" "$W/soon"
sed -e '0,/^{$/s//{\n\tadmin off\n\tauto_https off\n\tpersist_config off/' \
    -e "s#^beta\.afldb\.com {#http://beta.afldb.com:$CADDY_PORT {#" -e "s#^www\.afldb\.com {#http://www.afldb.com:$CADDY_PORT {#" \
    -e "s#^afldb\.com {#http://afldb.com:$CADDY_PORT {#" -e "s#^:8090 {#http://beta.afldb.com:$CADDY_PORT {#" \
    -e "s#127\.0\.0\.1:3100#127.0.0.1:$UP_PORT#g" -e "s#/var/log/caddy/#$R/logs/#g" -e "s#/var/www/afldb-soon#$W/soon#g" "$CF" > "$R/Caddyfile.test"
export XDG_DATA_HOME=$R/xdg/data XDG_CONFIG_HOME=$R/xdg/config
"$BIN" adapt --config "$R/Caddyfile.test" --adapter caddyfile > "$R/adapted.json" 2>/dev/null
grep -q '"admin":{"disabled":true' "$R/adapted.json" || { echo "ADMIN GUARD FAILED"; exit 3; }
echo "admin guard ok; binary $("$BIN" version | cut -d' ' -f1)"
ss -ltnH | awk '{print $4}' | grep -E ":$CADDY_PORT$" && { echo "port in use"; exit 1; }
nohup "$BIN" run --config "$R/Caddyfile.test" --adapter caddyfile > "$R/caddy-stderr.log" 2>&1 &
echo $! > "$W/caddyapp.pid"
sleep 3
echo "caddy pid $(cat "$W/caddyapp.pid"); health via caddy: $(curl -s -o /dev/null -w '%{http_code}' -H 'Host: beta.afldb.com' http://127.0.0.1:$CADDY_PORT/api/health)"
