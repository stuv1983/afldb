#!/usr/bin/env bash
# AFLDB-ISSUE-371 DEV reproduction harness (streamanator, arm, no sudo, no production contact).
#   bash i371-repro.sh seed                 seed template: rebuild + synthetic 2026 round votes + one super admin
#   bash i371-repro.sh run <label>          fresh DB copy -> production build -> cluster (2 workers) -> driver -> stop
# Own workspace $W, own isolated cluster 127.0.0.1:61480, private app port $APP_PORT (default 3120).
# DEV's afldb.service (port 3100) is never used or touched. The server runs in its OWN process group (setsid);
# teardown signals only that group. A port this harness did not take is a STOP: nothing is killed by port.
set -uo pipefail; export LC_ALL=C
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
W=/mnt/ssd/afldb-i371-20261121; C=$W/cand; EV=$C/docs/v2/evidence/issue371-20261121
export AFLDB_V2_PG_ROOT=$W/pg AFLDB_V2_PG_PORT=61480 AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin NEXT_TELEMETRY_DISABLED=1
TPL=afldb_v2_i371tpl_test; SEED=afldb_v2_i371seed_test
APP_PORT=${APP_PORT:-3120}; WORKERS=${WORKERS:-2}
cd "$C"; IR() { node --import tsx tools/v2/isolated-pg.ts "$@"; }
strip() { sed -e 's/\x1b\[[0-9;]*m//g' -e 's#postgres\(ql\)\?://[^ ]*#<dsn>#g'; }
psqlf() { IR run "$1" -- bash -c '"$AFLDB_V2_PG_BIN/psql" "$AFLDB_TEST_DATABASE_URL" -X -q -A -F "|" -t -v ON_ERROR_STOP=1 -f "$0"' "$2" < /dev/null 2>&1 | grep -v '^isolated-pg'; }
fresh() { IR list 2>&1 | grep -qw "$1" && IR drop-db "$1" --acknowledge-destroy "$1" > /dev/null 2>&1; IR create-db "$1" --template "$2" 2>&1 | strip | tail -1; }
listening() { ss -ltnH "sport = :$1" | grep -q .; }

phase_seed() {
  fresh "$SEED" "$TPL"
  psqlf "$SEED" "$EV/i371-seed-2026.sql"
  mkdir -m 700 -p "$W/secrets"
  local pw; pw=$(head -c 24 /dev/urandom | base64 | tr -d '/+=\n')
  # create-admin prints the TOTP secret once; it goes to a 600 file in the workspace, never to evidence.
  ( umask 077; IR run "$SEED" -- env AFLDB_ADMIN_PASSWORD="$pw" node --import tsx tools/admin/create-admin.ts i371-admin@example.invalid super_admin \
      < /dev/null > "$W/secrets/create-admin.out" 2>&1 )
  echo "create-admin rc=$? $(grep -c 'is ready' "$W/secrets/create-admin.out") ready line(s)"
  ( umask 077; printf 'I371_EMAIL=i371-admin@example.invalid\nI371_PASSWORD=%s\nI371_TOTP=%s\n' "$pw" \
      "$(grep 'Secret (to paste)' "$W/secrets/create-admin.out" | awk '{print $NF}')" > "$W/secrets/admin.env" )
  rm -f "$W/secrets/create-admin.out"
}

phase_run() {
  local label=$1 db=afldb_v2_i371_${1}_test out=$W/evidence/$1 secret rsecret sp rc i
  mkdir -p "$out"; : > "$out/SUMMARY.txt"
  rec() { echo "$*" | tee -a "$out/SUMMARY.txt"; }
  listening "$APP_PORT" && { rec "STOP port $APP_PORT is held by a process this harness did not launch; nothing killed"; return 1; }
  rec "== run $label $(date -u +%FT%TZ) src-sha256(actions.ts)=$(sha256sum src/app/admin/brownlow/actions.ts | cut -c1-16) workers=$WORKERS port=$APP_PORT"
  rec "db: $(fresh "$db" "$SEED")"
  secret=$(head -c 32 /dev/urandom | base64 | tr -d '\n'); rsecret=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
  if [ -n "${SKIP_BUILD:-}" ]; then
    # Reuse the existing build of the SAME source; clear only rendered /brownlow/2026 output (never route modules).
    rec "build reused BUILD_ID $(cat .next/standalone/.next/BUILD_ID 2>/dev/null); cleared rendered: $(find .next/standalone/.next/server/app/brownlow -maxdepth 1 -name '2026.*' -print | wc -l) path(s)"
    rm -rf .next/standalone/.next/server/app/brownlow/2026.html .next/standalone/.next/server/app/brownlow/2026.meta \
      .next/standalone/.next/server/app/brownlow/2026.rsc .next/standalone/.next/server/app/brownlow/2026.segments
    [ -f ".next/standalone/.next/server/app/brownlow/[year]/page.js" ] || { rec "STOP route module missing"; return 1; }
  else
    rm -rf .next
    IR run "$db" -- env AFLDB_ENV=production AFLDB_BASE_URL=http://127.0.0.1:$APP_PORT AFLDB_SESSION_SECRET="$secret" \
      bash -c 'npm run build' < /dev/null > "$out/build.log" 2>&1; rc=$?
    rec "build rc=$rc BUILD_ID $(cat .next/standalone/.next/BUILD_ID 2>/dev/null)"
    [ "$rc" = 0 ] || return 1
  fi
  rec "rendered /brownlow/2026.html present before serving: $(ls .next/standalone/.next/server/app/brownlow/2026.html 2>/dev/null | wc -l); 2025.html (prerendered): $(ls .next/standalone/.next/server/app/brownlow/2025.html 2>/dev/null | wc -l)"
  # The cross-worker fan-out (AFLDB_REVALIDATE_URL/SECRET) is configured unless NO_FANOUT=1.
  local fan=(); [ -n "${NO_FANOUT:-}" ] || fan=(AFLDB_REVALIDATE_URL=http://127.0.0.1:$APP_PORT AFLDB_REVALIDATE_SECRET=$rsecret)
  rec "fan-out configured: $([ ${#fan[@]} -gt 0 ] && echo yes || echo no)"
  setsid node --import tsx tools/v2/isolated-pg.ts run "$db" -- env AFLDB_ENV=production AFLDB_BASE_URL=http://127.0.0.1:$APP_PORT \
    AFLDB_SESSION_SECRET="$secret" NODE_ENV=production HOSTNAME=127.0.0.1 PORT=$APP_PORT AFLDB_WORKERS=$WORKERS AFLDB_TRACE_REQUESTS=on \
    "${fan[@]}" node deploy/server-cluster.mjs > "$out/server.log" 2>&1 < /dev/null &
  sp=$!
  sleep 0.5
  [ "$(ps -o pgid= -p "$sp" | tr -d ' ')" = "$sp" ] || { kill "$sp"; rec "STOP server is not its own process group"; return 1; }
  for i in $(seq 1 90); do curl -sf -o /dev/null -m 5 "http://127.0.0.1:$APP_PORT/api/health" && break; sleep 1; done
  rec "server: own process group $sp, health $(curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:$APP_PORT/api/health), workers ready $(grep -c 'Ready in' "$out/server.log")"
  set -a; . "$W/secrets/admin.env"; set +a
  I371_BASE=http://127.0.0.1:$APP_PORT I371_OUT=$out I371_LABEL=$label I371_ISR=$C/.next/standalone/.next/server/app \
    node "$EV/i371-driver.mjs" > "$out/driver.log" 2>&1; rc=$?
  unset I371_PASSWORD I371_TOTP
  rec "driver rc=$rc"; grep -E '^(RESULT|SAMPLE|NAV|ISR|STEP|CHECK)' "$out/driver.log" | tee -a "$out/SUMMARY.txt" > /dev/null
  kill -TERM -- "-$sp" 2>/dev/null; for i in $(seq 1 30); do kill -0 -- "-$sp" 2>/dev/null || break; sleep 0.5; done
  kill -KILL -- "-$sp" 2>/dev/null; wait "$sp" 2>/dev/null
  listening "$APP_PORT" && rec "WARN port $APP_PORT still held after stopping group $sp; left untouched" || rec "server group $sp stopped"
  grep -E '\[trace\].*(brownlow|revalidate-season)' "$out/server.log" | sed -E 's/ rid=[^ ]+//' > "$out/trace-brownlow.log"
  grep -E 'revalidate-season\]|admin-brownlow\]' "$out/server.log" | tee -a "$out/SUMMARY.txt" > /dev/null
}
cmd=$1; shift; "phase_$cmd" "$@"
