#!/usr/bin/env bash
# AFLDB-ISSUE-336 DEV deployment, step 2: a backup of afldb_dev that is PROVED restorable before anything changes.
#
#   dump   <outdir>          on streamanator, as arm: ONE read-only pg_dump -Fc of afldb_dev as afldb_backup (DSN from DEV's
#                            .env, exported into this process only, parsed into the child's PG* variables, never printed), the
#                            live row counts and ledger read in the same minute (READ ONLY transaction), SHA256SUMS. Writes
#                            nothing to DEV's database, checkout, services or timers.
#   verify <outdir> <co>     on the isolated cluster only: restore the dump into a fresh marked afldb_v2_*_test database with the
#                            pin checkout <co>'s tools/v2/isolated-pg.ts, require pg_restore exit 0 with no stderr, require every
#                            row count and the ledger to equal the live read, then rehearse the deployment's schema step on that
#                            exact copy (migrate 111-118, privileges, re-run = nothing to apply). Prints BACKUP-VERIFIED.
#
# Needs AFLDB_V2_PG_ROOT / AFLDB_V2_PG_BIN / AFLDB_V2_PG_PORT for `verify` (the isolated cluster), and restore.mjs, counts.mjs and
# dump-dev.cjs beside this script. The verify database is left in place for inspection (no cleanup is implied).
set -u -o pipefail
umask 077
HERE=$(cd "$(dirname "$0")" && pwd)
DEVDIR=${AFLDB_DEV_CHECKOUT:-$HOME/projects/afldb}
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
strip() { sed 's/\x1b\[[0-9;]*m//g' | grep -viE 'postgres(ql)?://|password='; }
die() { echo "BACKUP-FAIL: $*" >&2; exit 1; }

case "${1:-}" in
dump)
  OUT=${2:?outdir}; [ -e "$OUT" ] && die "$OUT exists"; install -d -m 700 "$OUT" || die mkdir
  STAMP=$(date -u +%Y%m%dT%H%M%SZ); DUMP=$OUT/afldb_dev-$STAMP.dump
  # The DEV checkout's node_modules supplies `postgres` for counts.mjs; nothing is written there.
  ( set -a; . "$DEVDIR/.env"; set +a
    node "$HERE/dump-dev.cjs" "$DUMP" > "$OUT/dump.json" || exit 1
    cd "$DEVDIR" && node "$HERE/counts.mjs" AFLDB_BACKUP_DATABASE_URL live > "$OUT/live-counts.json" ) || die "dump or live counts"
  cat "$OUT/dump.json"
  (cd "$OUT" && sha256sum "$(basename "$DUMP")" live-counts.json dump.json > SHA256SUMS && chmod 600 ./*) || die sha
  /usr/lib/postgresql/16/bin/pg_restore -l "$DUMP" | grep -E '^; (Archive created at|dbname|Dumped from)' | tee "$OUT/toc.txt"
  echo "ledger $(node -e 'const j=require(process.argv[1]);console.log(j.ledger.n, j.ledger.last)' "$OUT/live-counts.json")"
  cat "$OUT/SHA256SUMS"; echo BACKUP-DUMPED
  ;;
verify)
  OUT=${2:?outdir}; CO=${3:?pin checkout}
  [ -n "${AFLDB_V2_PG_ROOT:-}" ] && [ -n "${AFLDB_V2_PG_PORT:-}" ] || die "isolated cluster variables required"
  (cd "$OUT" && sha256sum -c --quiet SHA256SUMS) || die "checksums"
  DUMP=$(ls "$OUT"/afldb_dev-*.dump); SHA=$(sha256sum "$DUMP" | cut -d' ' -f1)
  DB=afldb_v2_devbk$(basename "$DUMP" .dump | tr -dc '0-9' | cut -c1-14)_test
  IR() { (cd "$CO" && node --import tsx tools/v2/isolated-pg.ts "$@") 2>&1 | strip; return "${PIPESTATUS[0]}"; }
  RUNDB() { (cd "$CO" && node --import tsx tools/v2/isolated-pg.ts run "$DB" -- "$@") 2>&1 | strip | grep -v '^isolated-pg:'; return "${PIPESTATUS[0]}"; }
  IR create-db "$DB" || die "create $DB"
  cp "$HERE/restore.mjs" "$CO/.bk-restore.mjs"; cp "$HERE/counts.mjs" "$CO/.bk-counts.mjs"
  trap 'rm -f "$CO/.bk-restore.mjs" "$CO/.bk-counts.mjs"' EXIT
  RUNDB node .bk-restore.mjs "$DUMP" "$SHA" | tee "$OUT/verify-restore.txt"; [ "${PIPESTATUS[0]}" = 0 ] || die restore
  grep -q 'exit=0 .*stderrLines=0' "$OUT/verify-restore.txt" || die "pg_restore not clean"
  RUNDB node .bk-counts.mjs AFLDB_TEST_DATABASE_URL restored > "$OUT/restored-counts.json" || die "restored counts"
  node -e '
    const [a,b]=process.argv.slice(1).map(f=>require(f)); let bad=0;
    for (const t of Object.keys(a.counts)) { const ok=a.counts[t]===b.counts[t]; if(!ok) bad++; console.log(`${ok?"same":"DIFF"} ${t} live=${a.counts[t]} restored=${b.counts[t]}`); }
    const lok=a.ledger.n===b.ledger.n && a.ledger.last===b.ledger.last; if(!lok) bad++;
    console.log(`${lok?"same":"DIFF"} ledger live=${a.ledger.n}/${a.ledger.last} restored=${b.ledger.n}/${b.ledger.last}`);
    process.exit(bad?1:0);' "$OUT/live-counts.json" "$OUT/restored-counts.json" | tee "$OUT/verify-counts.txt"
  [ "${PIPESTATUS[0]}" = 0 ] || die "restored content differs from the live read"
  echo "-- schema step rehearsed on the backup copy" | tee "$OUT/verify-migrate.txt"
  RUNDB node --import tsx tools/db/migrate.ts --target test --status 2>&1 | tail -10 | tee -a "$OUT/verify-migrate.txt"
  RUNDB node --import tsx tools/db/migrate.ts --target test 2>&1 | tee -a "$OUT/verify-migrate.txt"; [ "${PIPESTATUS[0]}" = 0 ] || die migrate
  RUNDB node --import tsx tools/db/privileges.ts --target test > "$OUT/verify-privileges.txt" 2>&1 || die privileges
  echo "privileges rc=0" | tee -a "$OUT/verify-migrate.txt"
  RUNDB node --import tsx tools/db/migrate.ts --target test 2>&1 | tail -1 | tee -a "$OUT/verify-migrate.txt"
  RUNDB node .bk-counts.mjs AFLDB_TEST_DATABASE_URL migrated > "$OUT/migrated-counts.json" || die "migrated counts"
  node -e 'const j=require(process.argv[1]);console.log("after migrate: ledger",j.ledger.n,j.ledger.last)' "$OUT/migrated-counts.json" | tee -a "$OUT/verify-migrate.txt"
  echo "verify database: $DB (left for inspection)"; echo BACKUP-VERIFIED
  ;;
*) echo "usage: $0 dump <outdir> | verify <outdir> <pin-checkout>" >&2; exit 2 ;;
esac
