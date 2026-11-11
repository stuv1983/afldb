#!/usr/bin/env bash
# AFLDB-ISSUE-336 D-336-2 after-state visual check (SIMULATION). Starts the simulated cluster (55494), copies the post-apply afldb_simprod to a
# marked _test database, serves R's existing production build from it on loopback 55581, captures, then stops the server and the cluster.
set -u -o pipefail
SIM=/mnt/ssd/afldb-i336-sim-20261111; C=/mnt/ssd/afldb-i336rel-qual-20261108T201140Z/cand; T=/mnt/ssd/afldb-i336-simtools-20261111
OUT=$T/vis; DB=afldb_v2_i336vis_test; SP=55581; PG=/usr/lib/postgresql/16/bin
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH" AFLDB_V2_PG_ROOT=$SIM/pg-sim AFLDB_V2_PG_BIN=$PG AFLDB_V2_PG_PORT=55494
exec > >(tee -a "$T/logs/vis.log") 2>&1
IR() { (cd "$C" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
[ "$(git -C "$C" rev-parse HEAD)" = c1c4b22ee15007111eab66f6d354e0b9ecbb2ade ] || { echo "STOP build checkout not at R"; exit 3; }
echo "BUILD_ID $(cat "$C/.next/BUILD_ID")"
ss -ltn | grep -qE ":$SP " && { echo "STOP port busy"; exit 3; }
ss -ltn | grep -qE ":55494 " || ( IR start > "$T/logs/vis-pg-start.out" 2>&1 < /dev/null & ); for i in $(seq 1 90); do $PG/pg_isready -q -h 127.0.0.1 -p 55494 && break; sleep 2; done; IR status || exit 4
su=$(cat "$SIM/pg-sim/secrets/superuser.pw")
SU() { PGPASSWORD="$su" "$PG/psql" -X -q -At -h 127.0.0.1 -p 55494 -U afldb_v2_super -v ON_ERROR_STOP=1 "$@"; }
got=$(SU -d postgres -c "SELECT current_setting('listen_addresses')||'|'||current_setting('data_directory')"); echo "cluster $got"
[[ "$got" == "127.0.0.1|$SIM/pg-sim/"* ]] || { echo "STOP cluster identity"; exit 9; }
SU -d postgres -c "DROP DATABASE IF EXISTS $DB" || exit 5; SU -d postgres -c "CREATE DATABASE $DB OWNER afldb_owner TEMPLATE afldb_simprod" && SU -d postgres -c "COMMENT ON DATABASE $DB IS 'afldb-v2-isolated-test'" || exit 5
unset su
IR run "$DB" -- bash -c 'psql "$AFLDB_TEST_DATABASE_URL" -X -At -c "SELECT current_database(), count(*) FROM draft_picks WHERE confidence_notes LIKE '"'"'AFLDB-ISSUE-336 bounded insert%'"'"'"' 2>&1 | grep -v "^isolated-pg"
cd "$C" && ( IR run "$DB" -- env AFLDB_SESSION_SECRET=$(head -c 48 /dev/urandom | od -An -tx1 | tr -d " 
") NODE_ENV=production HOSTNAME=127.0.0.1 PORT=$SP nice -n 10 node .next/standalone/server.js > "$T/logs/vis-server.log" 2>&1 & )
for i in $(seq 1 60); do curl -s -o /dev/null --max-time 5 "http://127.0.0.1:$SP/" && break; sleep 2; done
echo "server: $(curl -s -o /dev/null -w '%{http_code}' --max-time 30 http://127.0.0.1:$SP/draft)"
cp "$T/vis336.cjs" "$C/.vis336.cjs" && (cd "$C" && nice -n 10 node .vis336.cjs "http://127.0.0.1:$SP" "$OUT"); echo "vis exit=$?"; rm -f "$C/.vis336.cjs"
spid=$(ss -ltnp | grep ":$SP " | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)
[ -n "$spid" ] && tr '\0' ' ' < /proc/$spid/cmdline | grep -qF '.next/standalone/server.js' && kill "$spid" && echo "server $spid stopped"
for q in $(pgrep -f "next-server|standalone/server.js"); do [ "$(readlink -f /proc/$q/cwd)" = "$C/.next/standalone" ] && kill $q; done; sleep 3; $PG/pg_ctl -D "$SIM/pg-sim/data" stop -m fast -t 600 | tail -1
ss -ltn | grep -E ":(55494|$SP) " || echo "ports closed"
