#!/usr/bin/env bash
# caddy357: serve the production build of the checkout on 127.0.0.1:55663 against the scope's own database.
# usage: serve.sh start <open|gate> | stop
# open = no beta gate (as the routes scope measured); gate = AFLDB_BETA_GATE=on with a throwaway session secret.
# SCOPE-TAG: caddy357-afldb-rem2-20261114
set -u -o pipefail
source /mnt/ssd/afldb-rem2-caddy357-20261114/env.sh
DB=afldb_v2_rem2caddy357_app_test
PIDF=$EV/server.pid
if [ "${1:-}" = stop ]; then
  [ -f "$PIDF" ] && { pkill -TERM -P "$(cat "$PIDF")" 2>/dev/null; kill "$(cat "$PIDF")" 2>/dev/null; rm -f "$PIDF"; }
  sleep 2
  ss -ltn | awk '{print $4}' | grep -E ":$UP_PORT$" && echo "STILL LISTENING" || echo "stopped; no listener on $UP_PORT"
  exit 0
fi
MODE=${2:-open}
if ss -ltn | awk '{print $4}' | grep -E ":$UP_PORT$"; then echo "port $UP_PORT in use"; exit 1; fi
export AFLDB_INDEXING=on AFLDB_BASE_URL=https://aflcaddy357.test NEXT_TELEMETRY_DISABLED=1 HOSTNAME=127.0.0.1
export AFLDB_SESSION_SECRET="$(head -c 48 /dev/urandom | base64 | tr -d '\n=+/' | head -c 48)"
[ "$MODE" = gate ] && export AFLDB_BETA_GATE=on
nohup bash -c "cd '$CAND' && node --import tsx tools/v2/isolated-pg.ts run '$DB' -- bash -c \"cd '$CAND' && exec node node_modules/next/dist/bin/next start -H 127.0.0.1 -p $UP_PORT\"" > "$EV/server-$MODE.log" 2>&1 &
echo $! > "$PIDF"
for i in $(seq 1 60); do
  sleep 1
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$UP_PORT/api/health" 2>/dev/null || true)
  [ "$code" = 200 ] && break
done
echo "mode=$MODE health=$code BUILD_ID=$(cat "$CAND/.next/BUILD_ID") port=$UP_PORT"
