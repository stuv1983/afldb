#!/usr/bin/env bash
# AFLDB-ISSUE-336/337 follow-up preparation on streamanator (owner-authorised 2026-11-06: scoped local edits, isolated Linux
# verification; no live DEV change, no production, no sudo, no push, no cleanup).
# Candidate 8b024098 (ISSUE-337 fix + pinned sync-dev) in its own checkout, on the SAME isolated cluster as the first preview
# (port 55499). The first preview (ea9bddf8, app 127.0.0.1:33361) is left exactly as it is. DEV contact: read-only health probes
# and a read-only copy of one acquired AFL API snapshot directory.
set -u -o pipefail
umask 077
P1=/mnt/ssd/afldb/workspaces/i336-preview-20261106
PW=/mnt/ssd/afldb/workspaces/i336-preview2-20261106
IN=/mnt/ssd/afldb/workspaces/i336-preview-in-20261106
REV=8b024098a6771fc5e5be2f8bf006c9c3ca8ab55a
BASEREV=ea9bddf81284f68a8913fc258629fba3238b742a
PREVDB=afldb_v2_i336prev_test
APP_PORT=33362
DEVDIR=$HOME/projects/afldb
AFLLABEL=afl-api-2026-2026-11-05-180838
EV=$PW/evidence; CO=$PW/checkout
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export AFLDB_V2_PG_ROOT=$P1/pg-root AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55499
DEVDUMP=$(ls $P1/private/afldb_dev-*.dump); DEVSHA=$(sha256sum "$DEVDUMP" | cut -d' ' -f1)
PRODDUMP=/mnt/ssd/afldb/workspaces/afldb-issue333-o2-20261104/private/afldb_prod-20261104T021037Z.dump
say() { echo "== $(date -u +%FT%TZ) $*"; }
strip() { sed 's/\x1b\[[0-9;]*m//g' | grep -viE 'postgres(ql)?://|password='; }
IR() { (cd "$CO" && node --import tsx tools/v2/isolated-pg.ts "$@") 2>&1 | strip; return "${PIPESTATUS[0]}"; }
RUNDB() { local db="$1"; shift; (cd "$CO" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- "$@") 2>&1 | strip | grep -v '^isolated-pg:'; return "${PIPESTATUS[0]}"; }
die() { say "FAIL: $*"; echo PREVIEW2-FAIL; exit 1; }
devhealth() {
  echo "afldb=$(systemctl is-active afldb) mainpid=$(systemctl show afldb -p MainPID --value) health=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/api/health)"
  echo "checkout head=$(git -C "$DEVDIR" rev-parse HEAD) branch=$(git -C "$DEVDIR" branch --show-current) porcelain=$(git -C "$DEVDIR" status --porcelain | wc -l) stashes=$(git -C "$DEVDIR" stash list | wc -l) build_id=$(cat "$DEVDIR/.next/BUILD_ID")"
  echo "units: settle-afl-api=$(systemctl is-active afldb-settle-afl-api.timer) settle-brownlow=$(systemctl is-active afldb-settle-afl-api-brownlow.timer)"
  echo "first preview: pid=$(cat $P1/app.pid) alive=$(kill -0 "$(cat $P1/app.pid)" 2>/dev/null && echo yes || echo no) /draft=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:33361/draft)"
}
suites() { echo tests/integration/admin-draft.test.ts tests/integration/draft-linkage.test.ts tests/integration/draftguru-import.test.ts tests/integration/grid-solver.test.ts; }
restore_into() { # <db> <dump> <sha>
  IR create-db "$1" || return 1
  cp "$IN/restore.mjs" "$CO/.p2-restore.mjs"
  RUNDB "$1" node .p2-restore.mjs "$2" "$3" || return 1
  RUNDB "$1" node --import tsx tools/db/migrate.ts --target test | tail -2
}

mkdir -m 700 "$PW" "$EV" || die "workspace exists"
say "DEV health BEFORE"; devhealth | tee "$EV/dev-health-before.txt"

say "checkout: local clone of the first preview's published clone + the candidate bundle"
git bundle verify -q "$IN/cand.bundle" 2>&1 | tail -1
git clone -q --no-checkout "$P1/checkout" "$CO" || die clone
git -C "$CO" fetch -q "$IN/cand.bundle" refs/heads/claude/issue-336-draft-categories:refs/heads/cand || die fetch
git -C "$CO" checkout -q --detach "$REV" || die checkout
[ "$(git -C "$CO" rev-parse HEAD)" = "$REV" ] || die "HEAD mismatch"
git -C "$CO" merge-base --is-ancestor "$BASEREV" "$REV" || die "base not an ancestor"
{ echo "HEAD $(git -C "$CO" rev-parse HEAD) tree $(git -C "$CO" rev-parse 'HEAD^{tree}') porcelain $(git -C "$CO" status --porcelain | wc -l)"
  echo "commits since $BASEREV:"; git -C "$CO" log --format='  %H %s' "$BASEREV..$REV"
  echo "files changed since $BASEREV (code commit only):"; git -C "$CO" diff --stat "$REV~1" "$REV" | sed 's/^/  /'; } | tee "$EV/checkout.txt"
[ -e "$CO/.env" ] && die ".env present"
cp "$IN/facts.mjs" "$CO/.facts.mjs"

say "npm ci"
(cd "$CO" && npm ci --no-audit --no-fund --include=dev > "$EV/npm-ci.log" 2>&1) || die "npm ci"
tail -1 "$EV/npm-ci.log"

say "DraftGuru Stage A / B1 snapshots (gitignored public pages) for the two frozen-sample tests"
tar -xf "$IN/draftguru-snapshots.tar" -C "$CO" || die "snapshot tar"
(cd "$CO" && find data/sources/draftguru -type f | wc -l; sha256sum data/sources/draftguru/person-html-20260826/sample.json) | tee "$EV/snapshots.txt"

say "typecheck"
(cd "$CO" && npm run typecheck > "$EV/typecheck.log" 2>&1); echo "typecheck rc=$?" | tee -a "$EV/typecheck.log"
say "eslint (changed TypeScript files)"
(cd "$CO" && npx eslint src/lib/like.ts src/db/queries/draft.ts tests/like.test.ts tests/catalogue-lookups.test.ts tests/integration/admin-draft.test.ts > "$EV/eslint.log" 2>&1); echo "eslint rc=$?" | tee -a "$EV/eslint.log"; tail -5 "$EV/eslint.log"

say "focused unit tests (the first preview's list + like.test.ts; snapshots present)"
(cd "$CO" && node node_modules/vitest/vitest.mjs run tests/like.test.ts tests/catalogue-lookups.test.ts tests/grid-solver-spec.test.ts tests/draftguru-acquisition.test.ts tests/gap029-rookie-selections.test.ts tests/gap029-ops.test.ts tests/v2-season-seal.test.ts tests/coach-profile-route.test.ts > "$EV/unit-focused.log" 2>&1); echo "unit rc=$?" >> "$EV/unit-focused.log"
strip < "$EV/unit-focused.log" | grep -E '^ +(Test Files|Tests) |^ +× |unit rc='
say "sync-dev remote helper tests (Linux bash, real throwaway repositories)"
(cd "$CO" && bash tests/sync-dev-remote.test.sh > "$EV/sync-dev-remote.log" 2>&1); echo "sync-dev-remote rc=$?" | tee -a "$EV/sync-dev-remote.log"; tail -1 "$EV/sync-dev-remote.log"

say "RED: the ISSUE-337 cases against the unfixed draft.ts / like.ts (restored afterwards)"
git -C "$CO" show "$BASEREV:src/db/queries/draft.ts" > "$CO/src/db/queries/draft.ts"
(cd "$CO" && node node_modules/vitest/vitest.mjs run tests/catalogue-lookups.test.ts 2>&1 | strip | grep -E '^ +(Tests) |^ +× ') | tee "$EV/red-unit.txt"
git -C "$CO" checkout -q -- src/db/queries/draft.ts; [ -z "$(git -C "$CO" status --porcelain src)" ] || die "restore after RED"

say "integration A: DEV data (fresh restore of the same DEV dump, migrations 111-118), same four suites"
restore_into afldb_v2_i336c2dev_test "$DEVDUMP" "$DEVSHA" || die "restore dev"
(cd "$CO" && node --import tsx tools/v2/isolated-pg.ts run afldb_v2_i336c2dev_test -- node node_modules/vitest/vitest.mjs run $(suites) --reporter=verbose) > "$EV/int-devdata.log" 2>&1
strip < "$EV/int-devdata.log" | grep -E '^ +(Test Files|Tests) '
strip < "$EV/int-devdata.log" | grep -E '^ +× ' | sed -E 's/ [0-9]+ms$//' | sort > "$EV/int-devdata.fails"
strip < "$EV/int-devdata.log" | grep -E 'AFLDB-ISSUE-337' | sed -E 's/ [0-9]+ms$//' | tee "$EV/int-devdata-337.txt"
echo "same failures as the first preview's candidate run: $(cmp -s "$EV/int-devdata.fails" "$P1/evidence/cmp-cand.fails" && echo yes || echo NO)" | tee "$EV/int-devdata-vs-first.txt"
diff "$P1/evidence/cmp-cand.fails" "$EV/int-devdata.fails" | tee -a "$EV/int-devdata-vs-first.txt"
RUNDB afldb_v2_i336c2dev_test node .facts.mjs dev-copy > "$EV/facts-devdata.json" 2>&1 || true
IR drop-db afldb_v2_i336c2dev_test --acknowledge-destroy afldb_v2_i336c2dev_test

say "integration B: bridged production data (fresh restore of the 2026-11-04 production dump), same four suites"
PRODSHA=$(sha256sum "$PRODDUMP" | cut -d' ' -f1); echo "production dump $(basename "$PRODDUMP") sha256=$PRODSHA" | tee "$EV/proddump.txt"
restore_into afldb_v2_i336c2prod_test "$PRODDUMP" "$PRODSHA" | tee -a "$EV/proddump.txt" || die "restore prod"
(cd "$CO" && node --import tsx tools/v2/isolated-pg.ts run afldb_v2_i336c2prod_test -- node node_modules/vitest/vitest.mjs run $(suites) --reporter=verbose) > "$EV/int-proddata.log" 2>&1
strip < "$EV/int-proddata.log" | grep -E '^ +(Test Files|Tests) '
strip < "$EV/int-proddata.log" | grep -E '^ +× ' | sed -E 's/ [0-9]+ms$//' | sort > "$EV/int-proddata.fails"
echo "failures on production data: $(wc -l < "$EV/int-proddata.fails")"; cat "$EV/int-proddata.fails"
echo "the first preview's six DEV-data failures, as they run on production data:" | tee "$EV/int-proddata-six.txt"
while IFS= read -r line; do name=${line#*× }; strip < "$EV/int-proddata.log" | grep -F -- "$name" | sed -E 's/ [0-9]+ms$//' | head -1; done < "$P1/evidence/cmp-cand.fails" | tee -a "$EV/int-proddata-six.txt"
RUNDB afldb_v2_i336c2prod_test node .facts.mjs prod-copy > "$EV/facts-proddata.json" 2>&1 || true
IR drop-db afldb_v2_i336c2prod_test --acknowledge-destroy afldb_v2_i336c2prod_test
rm -f "$CO/.p2-restore.mjs"

say "facts on the preview database itself (DEV copy, migrated)"
RUNDB "$PREVDB" node .facts.mjs preview-db > "$EV/facts-previewdb.json" 2>&1 || true

say "timer behaviour at the candidate, offline (no provider request)"
{
  echo "-- seasons registry at $REV"; node -e 'const j=require(process.argv[1]);console.log("last_season",j.last_season,"in_progress",JSON.stringify(j.in_progress_seasons))' "$CO/data/reference/seasons.json"
  echo "-- sealed range at $REV"; (cd "$CO" && node --import tsx -e "import('./tools/current-season/settle-season-seal.ts').then(m=>{const s=m.loadSealedSeasonsFor(process.cwd());console.log(JSON.stringify(s), 'sealed2026', m.isSettleSeasonSealed(process.cwd(),2026), 'sealed2027', m.isSettleSeasonSealed(process.cwd(),2027))})")
  echo "-- Brownlow wrapper with DEV's gate state (AFLDB_AFL_API_BROWNLOW_ENABLED absent), outside systemd"
  (cd "$CO" && env -i HOME="$HOME" PATH="$PATH" AFLDB_PROJECT_ROOT="$CO" AFLDB_NODE="$(command -v node)" sh deploy/afldb-settle-afl-api-brownlow.sh); echo "brownlow wrapper rc=$?"
  echo "-- nightly settle tool on DEV's latest acquired 2026 snapshot (read-only copy), no DSN, no .env"
  mkdir -p "$CO/data/sources/afl_api/matches" && cp -a "$DEVDIR/data/sources/afl_api/matches/$AFLLABEL" "$CO/data/sources/afl_api/matches/"
  (cd "$CO" && env -i HOME="$HOME" PATH="$PATH" AFLDB_SKIP_DOTENV=1 node --import tsx tools/current-season/settle-afl-api.ts --label "$AFLLABEL" --validate-only 2>&1 | tail -4); echo "validate-only rc=${PIPESTATUS[0]}"
  (cd "$CO" && env -i HOME="$HOME" PATH="$PATH" AFLDB_SKIP_DOTENV=1 node --import tsx tools/current-season/settle-afl-api.ts --label "$AFLLABEL" --dry-run 2>&1 | tail -3); echo "dry-run rc=${PIPESTATUS[0]}"
  rm -rf "$CO/data/sources/afl_api/matches/$AFLLABEL"
} 2>&1 | strip | tee "$EV/timers-offline.txt"

say "build"
export NODE_ENV=production
RUNDB "$PREVDB" npm run build > "$EV/build.log" 2>&1; B=$?; echo "build rc=$B" >> "$EV/build.log"; tail -3 "$EV/build.log"; [ "$B" = 0 ] || die build
echo "BUILD_ID $(cat "$CO/.next/BUILD_ID")" | tee "$EV/build-id.txt"

say "start candidate app on 127.0.0.1:$APP_PORT (no SMTP, no provider identity, beta gate off, throwaway session secret, no timers)"
unset AFLDB_SMTP_HOST AFLDB_SMTP_USER AFLDB_SMTP_PASSWORD AFLDB_SMTP_FROM AFLDB_SMTP_PORT AFLDB_SMTP_SECURE AFLDB_EXTERNAL_API_USER_AGENT
export AFLDB_BETA_GATE=off AFLDB_SESSION_SECRET=$(openssl rand -hex 32)
(cd "$CO" && setsid nohup node --import tsx tools/v2/isolated-pg.ts run "$PREVDB" -- node node_modules/next/dist/bin/next start -H 127.0.0.1 -p $APP_PORT > "$EV/app.log" 2>&1 < /dev/null &)
unset AFLDB_SESSION_SECRET
for i in $(seq 1 40); do [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$APP_PORT/draft)" = 200 ] && break; sleep 3; done
APID=$(ss -ltnp 2>/dev/null | grep "127.0.0.1:$APP_PORT " | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)
echo "app pid=$APID /draft=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$APP_PORT/draft) /api/health=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$APP_PORT/api/health)" | tee "$EV/app-status.txt"
[ -n "$APID" ] && echo "app env names: $(tr '\0' '\n' < /proc/$APID/environ | cut -d= -f1 | grep -E '^AFLDB_' | sort | tr '\n' ' ')" | tee -a "$EV/app-status.txt"
echo "$APID" > "$PW/app.pid"

say "HTTP smoke: first preview (ea9bddf8, :33361) and candidate (:$APP_PORT), same DEV-data database"
bash "$IN/smoke.sh" 33361 > "$EV/smoke-33361.txt" 2>&1
bash "$IN/smoke.sh" $APP_PORT > "$EV/smoke-$APP_PORT.txt" 2>&1
paste -d'|' <(cut -d' ' -f1,3- "$EV/smoke-33361.txt") <(cut -d' ' -f1,3- "$EV/smoke-$APP_PORT.txt") | tee "$EV/smoke-compare.txt"

rm -f "$CO/.facts.mjs"
say "DEV health AFTER"; devhealth | tee "$EV/dev-health-after.txt"
echo PREVIEW2-DONE
