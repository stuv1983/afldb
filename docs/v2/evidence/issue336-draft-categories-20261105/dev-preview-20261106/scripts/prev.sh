#!/usr/bin/env bash
# AFLDB-ISSUE-336 isolated preview on streamanator (owner-authorised 2026-11-06).
# Leaves the DEV application, database, services, timers and checkout unchanged: the only DEV contact is a READ-ONLY pg_dump as afldb_backup
# and read-only health probes. Own loopback cluster (port 55499), own checkout, own app on 127.0.0.1:33361. No sudo, no systemd unit, no timer.
set -u -o pipefail
umask 077
PW=/mnt/ssd/afldb/workspaces/i336-preview-20261106
REV=ea9bddf81284f68a8913fc258629fba3238b742a
DB=afldb_v2_i336prev_test
ITDB=afldb_v2_i336previt_test
APP_PORT=33361
DEVDIR=$HOME/projects/afldb
EV=$PW/evidence; PRIV=$PW/private; CO=$PW/checkout; IN=/mnt/ssd/afldb/workspaces/i336-preview-in-20261106
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export AFLDB_V2_PG_ROOT=$PW/pg-root AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55499
say() { echo "== $(date -u +%FT%TZ) $*"; }
strip() { sed 's/\x1b\[[0-9;]*m//g' | grep -viE 'postgres(ql)?://|password='; }
IR() { (cd "$CO" && node --import tsx tools/v2/isolated-pg.ts "$@") 2>&1 | strip; return "${PIPESTATUS[0]}"; }
RUNDB() { local db="$1"; shift; (cd "$CO" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- "$@") 2>&1 | strip | grep -v '^isolated-pg:'; return "${PIPESTATUS[0]}"; }
die() { say "FAIL: $*"; echo PREVIEW-FAIL; exit 1; }
devhealth() {
  echo "afldb=$(systemctl is-active afldb) mainpid=$(systemctl show afldb -p MainPID --value) health=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/api/health)"
  echo "checkout head=$(git -C "$DEVDIR" rev-parse HEAD) branch=$(git -C "$DEVDIR" branch --show-current) porcelain=$(git -C "$DEVDIR" status --porcelain | wc -l) stashes=$(git -C "$DEVDIR" stash list | wc -l) build_id=$(cat "$DEVDIR/.next/BUILD_ID")"
  echo "units: settle-afl-api=$(systemctl is-active afldb-settle-afl-api.timer) settle-brownlow=$(systemctl is-active afldb-settle-afl-api-brownlow.timer)"
  systemctl list-timers --all --no-pager | grep afldb | sed -E 's/ +/ /g'
}

mkdir -m 700 "$PW" "$EV" "$PRIV" || die "workspace exists"
say "DEV health BEFORE"; devhealth | tee "$EV/dev-health-before.txt"

say "checkout: clean clone of the published repository at $REV"
git clone -q git@github.com-afldb-deploy:stuv1983/afldb.git "$CO" || die clone
git -C "$CO" checkout -q --detach "$REV" || die checkout
[ "$(git -C "$CO" rev-parse HEAD)" = "$REV" ] || die "HEAD mismatch"
echo "HEAD $(git -C "$CO" rev-parse HEAD) tree $(git -C "$CO" rev-parse 'HEAD^{tree}') origin/main $(git -C "$CO" rev-parse origin/main) porcelain $(git -C "$CO" status --porcelain | wc -l)" | tee "$EV/checkout.txt"
[ -e "$CO/.env" ] && die ".env present in preview checkout"

say "npm ci"
(cd "$CO" && npm ci --no-audit --no-fund --include=dev > "$EV/npm-ci.log" 2>&1) || die "npm ci (see npm-ci.log)"
tail -2 "$EV/npm-ci.log"

say "isolated cluster (port 55499)"
IR init > "$EV/pg-init.log" || die init
(cd "$CO" && setsid nohup node --import tsx tools/v2/isolated-pg.ts start > "$EV/pg-start.log" 2>&1 < /dev/null &)
for i in $(seq 1 30); do IR status 2>/dev/null | grep -qi "running\|accepting\|up" && break; sleep 2; done
IR roles > "$EV/pg-roles.log" || die roles
IR status | tee "$EV/pg-status.txt"

say "DEV backup: one read-only pg_dump of afldb_dev as afldb_backup (DSN parsed into the child's PG* variables only)"
STAMP=$(date -u +%Y%m%dT%H%M%SZ); DUMP=$PRIV/afldb_dev-$STAMP.dump
( set -a; . "$DEVDIR/.env"; set +a; node "$IN/dump-dev.cjs" "$DUMP" ) | tee "$EV/dev-backup.json" || die "pg_dump"
DUMP_SHA=$(sha256sum "$DUMP" | cut -d' ' -f1)
echo "dump $(basename "$DUMP") bytes=$(stat -c %s "$DUMP") sha256=$DUMP_SHA" | tee "$EV/dev-backup.txt"
/usr/lib/postgresql/16/bin/pg_restore -l "$DUMP" | grep -E '^; (Archive created at|dbname|Dumped from|Dumped by)' | tee -a "$EV/dev-backup.txt"
echo "toc entries $(/usr/lib/postgresql/16/bin/pg_restore -l "$DUMP" | grep -vc '^;')" | tee -a "$EV/dev-backup.txt"

say "restore into $DB"
IR create-db "$DB" || die create-db
cp "$IN/restore.mjs" "$CO/.prev-restore.mjs"; cp "$IN/ledger.mjs" "$CO/.prev-ledger.mjs"
RUNDB "$DB" node .prev-restore.mjs "$DUMP" "$DUMP_SHA" | tee "$EV/restore.txt"; [ "${PIPESTATUS[0]}" = 0 ] || die restore
RUNDB "$DB" node .prev-ledger.mjs before-migrate | tee "$EV/ledger-before.json"

say "migrate (expect 111-118 pending)"
RUNDB "$DB" node --import tsx tools/db/migrate.ts --target test --status > "$EV/migrate-status-before.txt" 2>&1; tail -12 "$EV/migrate-status-before.txt"
RUNDB "$DB" node --import tsx tools/db/migrate.ts --target test | tee "$EV/migrate.txt"; MIG=${PIPESTATUS[0]}; echo "migrate rc=$MIG" | tee -a "$EV/migrate.txt"; [ "$MIG" = 0 ] || die migrate
RUNDB "$DB" node .prev-ledger.mjs after-migrate | tee "$EV/ledger-after.json"
say "privileges reconcile (the migrations' documented follow-up)"
RUNDB "$DB" node --import tsx tools/db/privileges.ts --target test > "$EV/privileges.txt" 2>&1; echo "privileges rc=$?" | tee -a "$EV/privileges.txt"; tail -6 "$EV/privileges.txt"
say "re-run migrate: expect nothing pending"
RUNDB "$DB" node --import tsx tools/db/migrate.ts --target test | tail -3 | tee "$EV/migrate-rerun.txt"

say "focused draft unit tests"
(cd "$CO" && node node_modules/vitest/vitest.mjs run tests/catalogue-lookups.test.ts tests/grid-solver-spec.test.ts tests/draftguru-acquisition.test.ts tests/gap029-rookie-selections.test.ts tests/gap029-ops.test.ts tests/v2-season-seal.test.ts tests/coach-profile-route.test.ts > "$EV/unit-focused.log" 2>&1); echo "unit rc=$?" >> "$EV/unit-focused.log"
strip < "$EV/unit-focused.log" | grep -E '^ +(Test Files|Tests) |^ +× |unit rc='
say "focused draft integration tests on a disposable copy $ITDB (the preview database is never a test target)"
IR create-db "$ITDB" --template "$DB" || die create-it
(cd "$CO" && node --import tsx tools/v2/isolated-pg.ts run "$ITDB" -- node node_modules/vitest/vitest.mjs run tests/integration/admin-draft.test.ts tests/integration/draft-linkage.test.ts tests/integration/draftguru-import.test.ts tests/integration/grid-solver.test.ts > "$EV/integration-focused.log" 2>&1); echo "integration rc=$?" >> "$EV/integration-focused.log"
strip < "$EV/integration-focused.log" | grep -E '^ +(Test Files|Tests) |^ +× |integration rc='
IR drop-db "$ITDB" --acknowledge-destroy "$ITDB"

say "build"
export NODE_ENV=production
RUNDB "$DB" npm run build > "$EV/build.log" 2>&1; B=$?; echo "build rc=$B" >> "$EV/build.log"; tail -4 "$EV/build.log"; [ "$B" = 0 ] || die build
echo "BUILD_ID $(cat "$CO/.next/BUILD_ID")" | tee "$EV/build-id.txt"

say "start preview app on 127.0.0.1:$APP_PORT (no SMTP, no provider identity, beta gate off, throwaway session secret, no timers)"
unset AFLDB_SMTP_HOST AFLDB_SMTP_USER AFLDB_SMTP_PASSWORD AFLDB_SMTP_FROM AFLDB_SMTP_PORT AFLDB_SMTP_SECURE AFLDB_EXTERNAL_API_USER_AGENT
export AFLDB_BETA_GATE=off AFLDB_SESSION_SECRET=$(openssl rand -hex 32)
(cd "$CO" && setsid nohup node --import tsx tools/v2/isolated-pg.ts run "$DB" -- node node_modules/next/dist/bin/next start -H 127.0.0.1 -p $APP_PORT > "$EV/app.log" 2>&1 < /dev/null &)
unset AFLDB_SESSION_SECRET
for i in $(seq 1 40); do [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$APP_PORT/draft)" = 200 ] && break; sleep 3; done
APID=$(ss -ltnp 2>/dev/null | grep "127.0.0.1:$APP_PORT " | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)
echo "app pid=$APID listen=$(ss -ltn | grep -c "127.0.0.1:$APP_PORT ") /draft=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$APP_PORT/draft) /api/health=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$APP_PORT/api/health)" | tee "$EV/app-status.txt"
[ -n "$APID" ] && echo "app env names: $(tr '\0' '\n' < /proc/$APID/environ | cut -d= -f1 | grep -E '^AFLDB_' | sort | tr '\n' ' ')" | tee -a "$EV/app-status.txt"
echo "$APID" > "$PW/app.pid"
rm -f "$CO/.prev-restore.mjs" "$CO/.prev-ledger.mjs"

say "DEV health AFTER"; devhealth | tee "$EV/dev-health-after.txt"
echo PREVIEW-DONE
