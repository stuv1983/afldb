#!/usr/bin/env bash
# AFLDB-ISSUE-372 qualification harness (streamanator, arm, no sudo, no production contact).
# Adapted from the ISSUE-371 harness (i371-repro.sh). Own workspace $W, own isolated cluster 127.0.0.1:61530,
# private app port $APP_PORT (3140). DEV's afldb.service (3100) and every other agent's port are never used or touched.
#   bash i372-repro.sh seed
#   bash i372-repro.sh run <label> <cand|base> <awards|brownlow>     fresh DB copy -> production build -> cluster (2 workers) -> driver -> stop
# The server runs in its OWN process group (setsid); teardown signals only that group. A port this harness did not take
# is a STOP: nothing is killed by port.
# AFLDB_INDEXING=on at build and run: otherwise EVERY page carries a site-wide "noindex, nofollow" (src/lib/indexing.ts), which
# would hide the not-found "noindex" this harness uses as a discriminator.
set -uo pipefail; export LC_ALL=C
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
W=/mnt/ssd/afldb-backlog-20261122-q; C=$W/cand; H=$W/h
export AFLDB_V2_PG_ROOT=$W/pg AFLDB_V2_PG_PORT=61530 AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin NEXT_TELEMETRY_DISABLED=1
TPL=afldb_v2_i372tpl_test; SEED=afldb_v2_i372seed_test
APP_PORT=${APP_PORT:-3140}; WORKERS=${WORKERS:-2}
cd "$C"; IR() { node --import tsx tools/v2/isolated-pg.ts "$@"; }
strip() { sed -e 's/\x1b\[[0-9;]*m//g' -e 's#postgres\(ql\)\?://[^ ]*#<dsn>#g'; }
psqlf() { IR run "$1" -- bash -c '"$AFLDB_V2_PG_BIN/psql" "$AFLDB_TEST_DATABASE_URL" -X -q -A -F "|" -t -v ON_ERROR_STOP=1 -f "$0"' "$2" < /dev/null 2>&1 | grep -v '^isolated-pg'; }
fresh() { IR list 2>&1 | grep -qw "$1" && IR drop-db "$1" --acknowledge-destroy "$1" > /dev/null 2>&1; IR create-db "$1" --template "$2" 2>&1 | strip | tail -1; }
listening() { ss -ltnH "sport = :$1" | grep -q .; }

phase_seed() {
  fresh "$SEED" "$TPL"
  psqlf "$SEED" "$H/i372-seed-brownlow-2026.sql"
  mkdir -m 700 -p "$W/secrets"
  local pw; pw=$(head -c 24 /dev/urandom | base64 | tr -d '/+=\n')
  # create-admin prints the TOTP secret once; it goes to a 600 file in the workspace, never to evidence.
  ( umask 077; IR run "$SEED" -- env AFLDB_ADMIN_PASSWORD="$pw" node --import tsx tools/admin/create-admin.ts i372-admin@example.invalid super_admin \
      < /dev/null > "$W/secrets/create-admin.out" 2>&1 )
  echo "create-admin rc=$? $(grep -c 'is ready' "$W/secrets/create-admin.out") ready line(s)"
  ( umask 077; printf 'I372_EMAIL=i372-admin@example.invalid\nI372_PASSWORD=%s\nI372_TOTP=%s\n' "$pw" \
      "$(grep 'Secret (to paste)' "$W/secrets/create-admin.out" | awk '{print $NF}')" > "$W/secrets/admin.env" )
  rm -f "$W/secrets/create-admin.out"
}

phase_run() {
  local label=$1 src=$2 scen=$3 S=$W/$2
  local db=afldb_v2_i372_${1}_test out=$W/evidence/$1 secret rsecret sp rc i
  mkdir -p "$out"; : > "$out/SUMMARY.txt"
  rec() { echo "$*" | tee -a "$out/SUMMARY.txt"; }
  listening "$APP_PORT" && { rec "STOP port $APP_PORT is held by a process this harness did not launch; nothing killed"; return 1; }
  cd "$S"
  rec "== run $label src=$src scenario=$scen $(date -u +%FT%TZ) workers=$WORKERS port=$APP_PORT"
  rec "src fingerprint: revalidate-season/route.ts sha256 $(sha256sum src/app/api/internal/revalidate-season/route.ts | cut -c1-16), awards/revalidate/route.ts $(sha256sum src/app/admin/awards/revalidate/route.ts | cut -c1-16), award-season-fanout.ts $(sha256sum src/lib/admin/award-season-fanout.ts 2>/dev/null | cut -c1-16)"
  rec "db: $(fresh "$db" "$SEED")"
  secret=$(head -c 32 /dev/urandom | base64 | tr -d '\n'); rsecret=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
  if [ -n "${SKIP_BUILD:-}" ]; then
    # Reuse the existing build of the SAME source; clear only the rendered award/brownlow ISR output (never route modules).
    rec "build reused BUILD_ID $(cat .next/standalone/.next/BUILD_ID 2>/dev/null)"
    [ -f ".next/standalone/.next/server/app/awards/[slug]/[season]/page.js" ] || { rec "STOP route module missing"; return 1; }
    rm -rf .next/standalone/.next/server/app/awards/*/2026.* .next/standalone/.next/server/app/brownlow/2026.*
  else
    rm -rf .next
    IR run "$db" -- env AFLDB_ENV=production AFLDB_INDEXING=on AFLDB_BASE_URL=http://127.0.0.1:$APP_PORT AFLDB_SESSION_SECRET="$secret" \
      bash -c 'npm run build' < /dev/null > "$out/build.log" 2>&1; rc=$?
    rec "build rc=$rc BUILD_ID $(cat .next/standalone/.next/BUILD_ID 2>/dev/null)"
    [ "$rc" = 0 ] || return 1
  fi
  rec "rendered awards ISR entries present before serving: $(find .next/standalone/.next/server/app/awards -name '2026.*' 2>/dev/null | wc -l)"
  # The cross-worker fan-out (AFLDB_REVALIDATE_URL/SECRET) is configured unless NO_FANOUT=1. The secret value is never recorded.
  local fan=(); [ -n "${NO_FANOUT:-}" ] || fan=(AFLDB_REVALIDATE_URL=http://127.0.0.1:$APP_PORT AFLDB_REVALIDATE_SECRET=$rsecret)
  rec "fan-out configured: $([ ${#fan[@]} -gt 0 ] && echo yes || echo no)"
  ( umask 077; printf '%s\n' "$rsecret" > "$W/secrets/revalidate-$label.secret" )
  setsid node --import tsx tools/v2/isolated-pg.ts run "$db" -- env AFLDB_ENV=production AFLDB_INDEXING=on AFLDB_BASE_URL=http://127.0.0.1:$APP_PORT \
    AFLDB_SESSION_SECRET="$secret" NODE_ENV=production HOSTNAME=127.0.0.1 PORT=$APP_PORT AFLDB_WORKERS=$WORKERS AFLDB_TRACE_REQUESTS=on \
    "${fan[@]}" node deploy/server-cluster.mjs > "$out/server.log" 2>&1 < /dev/null &
  sp=$!
  sleep 0.5
  [ "$(ps -o pgid= -p "$sp" | tr -d ' ')" = "$sp" ] || { kill "$sp"; rec "STOP server is not its own process group"; return 1; }
  for i in $(seq 1 90); do curl -sf -o /dev/null -m 5 "http://127.0.0.1:$APP_PORT/api/health" && break; sleep 1; done
  rec "server: own process group $sp, health $(curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:$APP_PORT/api/health), workers ready $(grep -c 'Ready in' "$out/server.log")"
  set -a; . "$W/secrets/admin.env"; set +a
  I372_BASE=http://127.0.0.1:$APP_PORT I372_OUT=$out I372_LABEL=$label I372_SCEN=$scen I372_ISR=$S/.next/standalone/.next/server/app \
    node "$H/i372-driver.mjs" > "$out/driver.log" 2>&1; rc=$?
  unset I372_PASSWORD I372_TOTP
  rec "driver rc=$rc"; grep -E '^(RESULT|SAMPLE|SIDE|NAV|ISR|STEP|CHECK)' "$out/driver.log" | tee -a "$out/SUMMARY.txt" > /dev/null
  kill -TERM -- "-$sp" 2>/dev/null; for i in $(seq 1 30); do kill -0 -- "-$sp" 2>/dev/null || break; sleep 0.5; done
  kill -KILL -- "-$sp" 2>/dev/null; wait "$sp" 2>/dev/null
  listening "$APP_PORT" && rec "WARN port $APP_PORT still held after stopping group $sp; left untouched" || rec "server group $sp stopped"
  grep -E '\[trace\].*(awards|brownlow|revalidate)' "$out/server.log" | sed -E 's/ rid=[^ ]+//' > "$out/trace.log"
  grep -E 'revalidate-season\]|admin-brownlow\]|admin-awards\]' "$out/server.log" | tee -a "$out/SUMMARY.txt" > /dev/null
}
cmd=$1; shift; "phase_$cmd" "$@"
