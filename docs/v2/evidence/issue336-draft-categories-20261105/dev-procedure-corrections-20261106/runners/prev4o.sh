#!/usr/bin/env bash
# Part 4-O: recovery compatibility of the OLD nightly. 242fa276's settle (its wrapper's step 2, verbatim) on a fresh restore of today's
# DEV backup migrated to 118, fed a read-only copy of DEV's latest acquired 2026 label. Isolated only; no provider contact.
set -u -o pipefail
umask 077
W=/mnt/ssd/afldb/workspaces/i336-prep4-20261106
P1=/mnt/ssd/afldb/workspaces/i336-preview-20261106
OLD=/mnt/ssd/afldb/workspaces/i336-preview2-20261106/rollback-242fa276-b
BK=/mnt/ssd/afldb/workspaces/i336-backup-rehearsal-20261106
BKDUMP=$BK/out/dev-pre-v2-rehearsal/afldb_dev-20261105T191426Z.dump
NCO=$W/nightly-co; DB=afldb_v2_i336oldnight_test; L=afl-api-2026-2026-11-05-180838
OLDREV=242fa276b7b0fcb2613918984e82791faa1143d6
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export AFLDB_V2_PG_ROOT=$P1/pg-root AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55499
EV=$W/evidence
say() { echo "== $(date -u +%FT%TZ) $*"; }
strip() { sed 's/\x1b\[[0-9;]*m//g' | grep -viE 'postgres(ql)?://|password='; }
RUN() { (cd "$NCO" && AFLDB_SKIP_DOTENV=1 node --import tsx tools/v2/isolated-pg.ts run "$DB" -- "$@") 2>&1 | strip | grep -v '^isolated-pg:'; return "${PIPESTATUS[0]}"; }
[ "$(git -C "$OLD" rev-parse HEAD)" = "$OLDREV" ] || { echo "old HEAD"; exit 1; }
say "O  old (242fa276) nightly settle on the 118 schema"
(cd "$NCO" && node --import tsx tools/v2/isolated-pg.ts create-db "$DB") 2>&1 | strip
RUN node .restore.mjs "$BKDUMP" "$(head -1 "$BK/out/dev-pre-v2-rehearsal/SHA256SUMS" | cut -d' ' -f1)" | tee "$EV/O-db.txt"
RUN node --import tsx tools/db/migrate.ts --target test | tail -1 | tee -a "$EV/O-db.txt"
RUN node --import tsx tools/db/privileges.ts --target test > /dev/null 2>&1; echo "privileges (pin tool) rc=$?" | tee -a "$EV/O-db.txt"
mkdir -p "$OLD/data/sources/afl_api/matches"
cp -a "$HOME/projects/afldb/data/sources/afl_api/matches/$L" "$OLD/data/sources/afl_api/matches/"   # read-only copy from DEV
echo "copied DEV label $L ($(du -sh "$OLD/data/sources/afl_api/matches/$L" | cut -f1))" | tee -a "$EV/O-db.txt"
RUN node .nightly-facts.mjs "old-before" > "$EV/O-facts-before.json"
echo "-- 242fa276 settle --validate-only" | tee "$EV/O-settle.txt"
RUN bash -c "cd '$OLD' && node node_modules/tsx/dist/cli.mjs tools/current-season/settle-afl-api.ts --label $L --validate-only" 2>&1 | tail -3 | tee -a "$EV/O-settle.txt"
echo "-- 242fa276 settle --apply --auto-apply --require-complete-source" | tee -a "$EV/O-settle.txt"
RUN bash -c "cd '$OLD' && node node_modules/tsx/dist/cli.mjs tools/current-season/settle-afl-api.ts --label $L --apply --auto-apply --require-complete-source" > "$EV/O-settle-apply.log" 2>&1
echo "old settle rc=$?" | tee -a "$EV/O-settle.txt"
grep -E 'Season feed|Applied as import batch|Source complet|^Refused|ERROR|Error:|records read' "$EV/O-settle-apply.log" | head -10 | tee -a "$EV/O-settle.txt"
RUN node .nightly-facts.mjs "old-after" > "$EV/O-facts-after.json"
node -e 'const [a,b]=process.argv.slice(1).map(f=>require(f)); for (const k of ["importBatches","matchesBySeason","fixtures","playerMatchStats","dataIssuesOpen","stagingAflApiMatch"]) console.log(k, JSON.stringify(a[k]), "->", JSON.stringify(b[k])); console.log("lastBatch", JSON.stringify(b.lastBatch.row))' "$EV/O-facts-before.json" "$EV/O-facts-after.json" | tee -a "$EV/O-settle.txt"
(cd "$NCO" && node --import tsx tools/v2/isolated-pg.ts drop-db "$DB" --acknowledge-destroy "$DB") 2>&1 | strip
rm -rf "$OLD/data/sources/afl_api/matches/$L"   # this script's own copy in the isolated checkout
echo PREP4O-DONE
