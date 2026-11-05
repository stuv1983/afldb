#!/usr/bin/env bash
# AFLDB-ISSUE-336 follow-up, part 3 (isolated only; DEV contact = read-only health probes).
#  (1) draft-linkage on bridged production data with the bridge child production actually carries (v2/v3 universal), not the
#      afldb_test default; (2) the operator-review determinism check repeated, to classify its failure; (3) rollback
#      compatibility: DEV's current code 242fa276 (from the off-host-verified preservation bundle) built and served on the 118
#      schema over DEV data, beside the candidate.
set -u -o pipefail
umask 077
P1=/mnt/ssd/afldb/workspaces/i336-preview-20261106
PW=/mnt/ssd/afldb/workspaces/i336-preview2-20261106
IN=/mnt/ssd/afldb/workspaces/i336-preview-in-20261106
PRESERVE=/mnt/ssd/afldb/workspaces/dev-preserve-20261106
OLDREV=242fa276b7b0fcb2613918984e82791faa1143d6
EV=$PW/evidence; CO=$PW/checkout; OLD=$PW/rollback-242fa276
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export AFLDB_V2_PG_ROOT=$P1/pg-root AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55499
DEVDUMP=$(ls $P1/private/afldb_dev-*.dump); DEVSHA=$(sha256sum "$DEVDUMP" | cut -d' ' -f1)
PRODDUMP=/mnt/ssd/afldb/workspaces/afldb-issue333-o2-20261104/private/afldb_prod-20261104T021037Z.dump; PRODSHA=$(sha256sum "$PRODDUMP" | cut -d' ' -f1)
say() { echo "== $(date -u +%FT%TZ) $*"; }
strip() { sed 's/\x1b\[[0-9;]*m//g' | grep -viE 'postgres(ql)?://|password='; }
IR() { (cd "$CO" && node --import tsx tools/v2/isolated-pg.ts "$@") 2>&1 | strip; return "${PIPESTATUS[0]}"; }
RUNDB() { local db="$1"; shift; (cd "$CO" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- "$@") 2>&1 | strip | grep -v '^isolated-pg:'; return "${PIPESTATUS[0]}"; }
die() { say "FAIL: $*"; echo PREVIEW3B-FAIL; exit 1; }
restore_into() { IR create-db "$1" || return 1; cp "$IN/restore.mjs" "$CO/.p3-restore.mjs"; RUNDB "$1" node .p3-restore.mjs "$2" "$3" || return 1; RUNDB "$1" node --import tsx tools/db/migrate.ts --target test | tail -1; rm -f "$CO/.p3-restore.mjs"; }
devhealth() {
  echo "afldb=$(systemctl is-active afldb) mainpid=$(systemctl show afldb -p MainPID --value) health=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/api/health) head=$(git -C $HOME/projects/afldb rev-parse HEAD) porcelain=$(git -C $HOME/projects/afldb status --porcelain | wc -l) build_id=$(cat $HOME/projects/afldb/.next/BUILD_ID) timers=$(systemctl is-active afldb-settle-afl-api.timer)/$(systemctl is-active afldb-settle-afl-api-brownlow.timer)"
}
say "DEV health BEFORE (part 3b)"; devhealth | tee "$EV/dev-health-before-p3b.txt"
OLD=$PW/rollback-242fa276-b
say "(3) rollback compatibility: $OLDREV from the preservation bundle, on the 118 schema over DEV data"
# The self-contained preservation bundle (sha256 7e286772…, verified off-host), never preserve.git (whose alternates borrow
# DEV's object store).
BUNDLE=$PRESERVE/dev-main-and-stashes-20261106.bundle
echo "bundle sha256 $(sha256sum "$BUNDLE" | cut -d' ' -f1)" | tee "$EV/rollback-source.txt"
git bundle list-heads "$BUNDLE" | grep -q "^$OLDREV refs/preserve/dev-main-242fa276$" || die "old revision not in the bundle"
git init -q "$OLD" && git -C "$OLD" fetch -q "$BUNDLE" "refs/preserve/dev-main-242fa276:refs/heads/rollback" || die "fetch old from bundle"
[ -e "$OLD/.git/objects/info/alternates" ] && die "unexpected alternates"
git -C "$OLD" checkout -q --detach "$OLDREV" || die "checkout old"
[ "$(git -C "$OLD" rev-parse HEAD)" = "$OLDREV" ] || die "old HEAD"
[ -e "$OLD/.env" ] && die ".env in old checkout"
(cd "$OLD" && npm ci --no-audit --no-fund --include=dev > "$EV/rollback-npm-ci.log" 2>&1) || die "old npm ci"
restore_into afldb_v2_i336c3rb_test "$DEVDUMP" "$DEVSHA" | tee "$EV/rollback-db.txt" || die "restore dev for rollback"
RUNDB afldb_v2_i336c3rb_test node --import tsx tools/db/privileges.ts --target test > "$EV/rollback-privileges.txt" 2>&1; echo "privileges (V2 tool) rc=$?" | tee -a "$EV/rollback-db.txt"
echo "-- the OLD migrator against the 118 ledger (status, then apply)" | tee -a "$EV/rollback-db.txt"
(cd "$OLD" && node --import tsx "$CO/tools/v2/isolated-pg.ts" run afldb_v2_i336c3rb_test -- node --import tsx tools/db/migrate.ts --target test --status 2>&1 | strip | tail -4) | tee -a "$EV/rollback-db.txt"
(cd "$OLD" && node --import tsx "$CO/tools/v2/isolated-pg.ts" run afldb_v2_i336c3rb_test -- node --import tsx tools/db/migrate.ts --target test 2>&1 | strip | tail -2) | tee -a "$EV/rollback-db.txt"
export NODE_ENV=production
(cd "$OLD" && node --import tsx "$CO/tools/v2/isolated-pg.ts" run afldb_v2_i336c3rb_test -- npm run build > "$EV/rollback-build.log" 2>&1); B=$?; echo "old build rc=$B BUILD_ID=$(cat "$OLD/.next/BUILD_ID" 2>/dev/null)" | tee -a "$EV/rollback-db.txt"
if [ "$B" = 0 ]; then
  unset AFLDB_SMTP_HOST AFLDB_SMTP_USER AFLDB_SMTP_PASSWORD AFLDB_SMTP_FROM AFLDB_EXTERNAL_API_USER_AGENT
  export AFLDB_BETA_GATE=off AFLDB_SESSION_SECRET=$(openssl rand -hex 32)
  (cd "$OLD" && setsid nohup node --import tsx "$CO/tools/v2/isolated-pg.ts" run afldb_v2_i336c3rb_test -- node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 33363 > "$EV/rollback-app.log" 2>&1 < /dev/null &)
  unset AFLDB_SESSION_SECRET
  for i in $(seq 1 40); do [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:33363/draft)" = 200 ] && break; sleep 3; done
  RPID=$(ss -ltnp 2>/dev/null | grep "127.0.0.1:33363 " | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)
  echo "old app pid=$RPID" | tee -a "$EV/rollback-db.txt"
  bash "$IN/smoke.sh" 33363 > "$EV/smoke-33363-rollback.txt" 2>&1
  paste -d'|' <(cut -d' ' -f1,3- "$EV/smoke-33362.txt") <(cut -d' ' -f1,3- "$EV/smoke-33363-rollback.txt") > "$EV/smoke-candidate-vs-rollback.txt"
  echo "routes with a non-2xx/3xx status or an error marker on the rolled-back code:"; grep -vE '^(200|307|308|404) .*error_markers=0' "$EV/smoke-33363-rollback.txt" || echo "  none"
  # The short-lived rollback app exists only for this check; stopping the process this script started.
  [ -n "$RPID" ] && kill "$RPID" && echo "old app stopped" | tee -a "$EV/rollback-db.txt"
fi
sleep 2
IR drop-db afldb_v2_i336c3rb_test --acknowledge-destroy afldb_v2_i336c3rb_test

say "DEV health AFTER (part 3b)"; devhealth | tee "$EV/dev-health-after-p3b.txt"
echo PREVIEW3B-DONE
