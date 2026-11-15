#!/usr/bin/env bash
# remediation run 4, scope `qual`, P1: rebuild at Q'' from the RUN-3 REBUILD WORKSPACE's verified input copies (read-only), then dump, restore and prove
# equivalence with the accepted run-3 dump. RB-1 is never read: the inputs come only from /mnt/ssd/afldb-rem3-rebuild-20261114 (run-3 copies).
#   bash $W/in/rebuild.sh inputs plan            (foreground, short)
#   setsid nohup bash $W/in/rebuild.sh run ...   (detached: `run` holds the heavy lock for the whole rebuild)
#   bash $W/in/rebuild.sh post_dump post_restore post_ref post_equiv
set -u -o pipefail
. "$(dirname "$0")/common.sh"
SRC=/mnt/ssd/afldb-rem3-rebuild-20261114/cand/data        # run-3 rebuild workspace: READ ONLY (copy only)
V=$RB/$REPO_EVD/run3/rebuild/scripts/verify-inputs.mjs
REB=$W/rebuilt; DUMPQ=$REB/afldb_v2_rb_rem4q-${QPP:0:8}.dump
REF=afldb_v2_rem4qual_rb3ref_test                          # the accepted run-3 dump restored once, as the equivalence reference
export AFLDB_REBUILD_CAPTURE_ROOT=$W/capture-root

phase_inputs() {
  [ ! -e "$RB/.env" ] || { echo ".env present"; return 1; }
  node "$V" "$RB" "$SRC" --detail > "$E/inputs-precopy-run3ws.txt" 2>&1; cat "$E/inputs-precopy-run3ws.txt" | cut -c1-240
  local n; n=$(grep -c -P '^[a-z0-9-]+\tVERIFIED\t' "$E/inputs-precopy-run3ws.txt")
  grep -P '^[a-z0-9-]+\tFAILED\t' "$E/inputs-precopy-run3ws.txt" && { echo "a pre-copy input FAILED against the tracked pins"; return 1; }
  [ "$n" = 8 ] || { echo "expected 8 VERIFIED inputs, got $n"; return 1; }
  say "inputs: 8/8 VERIFIED at the source (run-3 rebuild workspace) against the tracked pins of Q''"
  local S=$RB/data/sources T=$SRC/sources
  mkdir -p "$S/afl_api/rosters" "$S/afltables/club_lists" "$S/afltables/coaches/coaches-20260905" "$S/afltables/fitzroy_core" "$S/draftguru" "$RB/data/records"
  for d in afl_api/rosters/rosters-20260905 afltables/club_lists/club-lists-20260905 afltables/fitzroy_core/c2-2026-final-core-v1 afltables/fitzroy_core/c2-2026-final-ladder-v1 draftguru/annual-html-20260826; do
    [ ! -e "$S/$d" ] || { echo "REFUSE: $S/$d exists"; return 1; }
    cp -a "$T/$d" "$S/$d" || return 1
  done
  [ ! -e "$S/afltables/coaches/coaches-20260905/raw" ] || { echo "REFUSE: coaches raw exists"; return 1; }
  cp -a "$T/afltables/coaches/coaches-20260905/raw" "$S/afltables/coaches/coaches-20260905/raw" || return 1
  cp -a "$T/afltables/coaches/coaches-20260905/coaches-20260905-raw.tar" "$S/afltables/coaches/coaches-20260905/coaches-20260905-raw.tar" || return 1
  [ ! -e "$RB/data/records/first-kick-goal.csv" ] || { echo "REFUSE: first-kick-goal.csv exists"; return 1; }
  cp -a "$SRC/records/first-kick-goal.csv" "$RB/data/records/first-kick-goal.csv" || return 1
  chmod -R a-w "$S/afl_api/rosters/rosters-20260905" "$S/afltables/club_lists/club-lists-20260905" "$S/afltables/fitzroy_core/c2-2026-final-core-v1" \
    "$S/afltables/fitzroy_core/c2-2026-final-ladder-v1" "$S/draftguru/annual-html-20260826" "$S/afltables/coaches/coaches-20260905/raw" \
    "$S/afltables/coaches/coaches-20260905/coaches-20260905-raw.tar" "$RB/data/records/first-kick-goal.csv"
  node "$V" "$RB" "$RB/data" --detail --list "$E/inputs-files-q.sha256" > "$E/inputs-postcopy.txt" 2>&1; cut -c1-240 "$E/inputs-postcopy.txt"
  [ "$(grep -c -P '^[a-z0-9-]+\tVERIFIED\t' "$E/inputs-postcopy.txt")" = 8 ] || { echo "post-copy verification is not 8/8"; return 1; }
  sort "$E/inputs-files-q.sha256" > "$E/.q"; sort "$RB/$REPO_EVD/run3/rebuild/inputs-files.sha256" > "$E/.r3"
  if diff "$E/.q" "$E/.r3" > "$E/inputs-files-vs-run3.diff"; then say "inputs: per-file list IDENTICAL to run3/rebuild/inputs-files.sha256 ($(wc -l < "$E/.q") lines)"; else say "inputs: per-file list DIFFERS from run 3 (inputs-files-vs-run3.diff)"; head "$E/inputs-files-vs-run3.diff"; return 1; fi
  rm -f "$E/.q" "$E/.r3"
  echo "RB porcelain=$(pc "$RB")"
}

phase_plan() {
  mkdir -p "$AFLDB_REBUILD_CAPTURE_ROOT"
  IRB create-db "$RBDB" 2>&1 | strip | tail -1
  (cd "$RB" && echo "HEAD=$(git rev-parse HEAD) porcelain=$(git status --porcelain | wc -l)" && timeout 480 node --import tsx tools/v2/isolated-pg.ts run "$RBDB" -- node node_modules/tsx/dist/cli.mjs tools/db/rebuild-test.ts --target isolated --acknowledge-destroy "$RBDB" --plan) > "$E/plan.out" 2>&1
  local rc=$?; echo "plan rc=$rc lines=$(wc -l < "$E/plan.out")"; strip < "$E/plan.out" | grep -a -c -i -E 'stage|PRECHECK' | sed 's/^/stage-ish lines: /'; tail -5 "$E/plan.out" | strip
  return $rc
}

phase_run() {  # intended to be launched with setsid nohup; holds the heavy lock for the whole rebuild
  cd "$RB" || return 1
  echo "start_utc=$(date -u +%FT%TZ) HEAD=$(git rev-parse HEAD) porcelain=$(git status --porcelain | wc -l) bashpid=$$"
  exec 9>"$LOCK"; flock 9
  echo "lock_acquired_utc=$(date -u +%FT%TZ)"
  local S0; S0=$(date +%s)
  node --import tsx tools/v2/isolated-pg.ts run "$RBDB" -- node node_modules/tsx/dist/cli.mjs tools/db/rebuild-test.ts --target isolated --acknowledge-destroy "$RBDB"
  local rc=$?
  echo "end_utc=$(date -u +%FT%TZ) elapsed_s=$(( $(date +%s) - S0 )) rc=$rc"
  echo "$rc" > "$E/rebuild.exit"
  return 0
}

phase_post_dump() {
  [ "$(cat "$E/rebuild.exit")" = 0 ] || { echo "rebuild did not exit 0"; return 1; }
  mkdir -p "$REB"; cp "$RB/$REPO_EVD/run3/rebuild/scripts/dump-db.mjs" "$IN/dump-db.mjs"
  IRB verify "$RBDB" 2>&1 | strip | tail -1
  tcounts "$RBDB" "$E/rebuilt-table-counts.tsv" > /dev/null; echo "rebuilt tables: $(wc -l < "$E/rebuilt-table-counts.tsv")"
  (cd "$RB" && node --import tsx tools/v2/isolated-pg.ts run "$RBDB" -- node "$IN/dump-db.mjs" "$DUMPQ") 2>&1 | strip | tee "$E/dump.out"
  ls -l "$DUMPQ"; sha256sum "$DUMPQ" | tee "$E/dump.sha256"
  "$AFLDB_V2_PG_BIN/pg_restore" -l "$DUMPQ" > "$E/dump.toc.txt" 2>&1; grep -c . "$E/dump.toc.txt"
  chmod a-w "$DUMPQ"
}

phase_post_restore() {  # restore the Q'' dump into TRB exactly like RESTORE.md, count diff vs the published run-3 counts
  local SHA; SHA=$(cut -d' ' -f1 "$E/dump.sha256")
  IR create-db "$TRB" 2>&1 | strip | tail -1
  H timeout 3000 bash -c "cd $CAND && node --import tsx tools/v2/isolated-pg.ts run $TRB -- node $RB_DIR/restore-dump.mjs $DUMPQ $SHA" 2>&1 | strip | tee "$E/rb-restore.log" | tail -6
  IR verify "$TRB" 2>&1 | strip | tee -a "$E/rb-restore.log" | tail -2
  IR list 2>&1 | strip | grep -F "$TRB" | tee -a "$E/rb-restore.log" || true
  local TC=$RB_DIR/afldb_v2_rb_rem3-6d5388ea.table-counts.tsv
  tcounts "$TRB" "$E/rb-table-counts.restored.tsv" > /dev/null
  sort "$TC" > "$E/rb-table-counts.published-run3.tsv"
  if diff "$E/rb-table-counts.published-run3.tsv" "$E/rb-table-counts.restored.tsv" > "$E/rb-table-counts.diff"; then say "Q'' rebuild (restored from its own dump): 83-table exact counts IDENTICAL to the published run-3 table-counts.tsv ($(wc -l < "$E/rb-table-counts.restored.tsv") tables)"; else say "Q'' rebuild counts DIFFER from run 3 (rb-table-counts.diff)"; cat "$E/rb-table-counts.diff"; fi
  if diff "$E/rebuilt-table-counts.tsv" "$E/rb-table-counts.restored.tsv" > "$E/rb-table-counts.rebuilt-vs-restored.diff"; then say "counts of the rebuilt DB == counts of the DB restored from its dump"; else say "rebuilt vs restored counts DIFFER"; fi
}

phase_post_ref() {  # the accepted run-3 dump restored into a reference database (equivalence reference only; never used by a cell)
  IR create-db "$REF" 2>&1 | strip | tail -1
  H timeout 3000 bash -c "cd $CAND && node --import tsx tools/v2/isolated-pg.ts run $REF -- node $RB_DIR/restore-dump.mjs $RB_DUMP $RB_SHA" 2>&1 | strip | tee "$E/ref-restore.log" | tail -4
  IR verify "$REF" 2>&1 | strip | tail -1
}

BL="'brownlow_season_total','brownlow_round_votes','brownlow_match_votes'"
phase_post_equiv() {
  local SQL="SELECT to_jsonb(s)::text FROM stat_availability s WHERE stat_key IN ($BL) ORDER BY season, stat_key"
  for pair in "q:$RBDB" "q2:$TRB" "r3:$REF"; do
    local tag=${pair%%:*} db=${pair#*:}
    Q "$db" "$SQL" > "$E/brownlow-stat-availability.$tag.txt"
    Q "$db" "SELECT stat_key||' rows='||count(*)||' seasons='||min(season)||'..'||max(season)||' coverage='||string_agg(DISTINCT coverage::text, ',') FROM stat_availability WHERE stat_key IN ($BL) GROUP BY stat_key ORDER BY 1" > "$E/brownlow-stat-availability.$tag.summary.txt"
    echo "$tag ($db): $(wc -l < "$E/brownlow-stat-availability.$tag.txt") rows, md5 $(md5sum < "$E/brownlow-stat-availability.$tag.txt" | cut -d' ' -f1)"
    cat "$E/brownlow-stat-availability.$tag.summary.txt"
  done
  for t in q q2; do
    if diff "$E/brownlow-stat-availability.r3.txt" "$E/brownlow-stat-availability.$t.txt" > "$E/brownlow-stat-availability.r3-vs-$t.diff"; then say "Brownlow stat_availability (3 keys, every season): Q'' ($t) IDENTICAL to the run-3 dump"; else say "Brownlow stat_availability DIFFERS ($t vs r3)"; head -20 "$E/brownlow-stat-availability.r3-vs-$t.diff"; fi
  done
  # informational, beyond the brief: per-table content digest with every timestamp column removed
  (cd "$RB" && node --import tsx tools/v2/isolated-pg.ts run "$RBDB" -- node "$IN/digest.mjs" "$E/digest.q.tsv") 2>&1 | strip | tail -1
  (cd "$RB" && node --import tsx tools/v2/isolated-pg.ts run "$REF" -- node "$IN/digest.mjs" "$E/digest.r3.tsv") 2>&1 | strip | tail -1
  if diff "$E/digest.r3.tsv" "$E/digest.q.tsv" > "$E/digest.r3-vs-q.diff"; then say "per-table content digest (timestamps excluded): all $(wc -l < "$E/digest.q.tsv") tables IDENTICAL, Q'' vs run-3 dump"; else say "per-table content digest DIFFERS in $(grep -c '^<' "$E/digest.r3-vs-q.diff") table(s) (digest.r3-vs-q.diff)"; cat "$E/digest.r3-vs-q.diff" | cut -c1-200; fi
  { echo "identity of the Q'' rebuild (aggregates only):"
    Q "$RBDB" "SELECT 'ledger_max='||max(name)||' ledger_count='||count(*) FROM afldb_meta.schema_migrations"
    Q "$RBDB" "SELECT 'matches='||count(*)||' seasons='||min(season)||'..'||max(season)||' players='||(SELECT count(*) FROM players)||' fixtures='||(SELECT count(*) FROM fixtures) FROM matches"
    Q "$RBDB" "SELECT 'season2026='||coalesce(max(status::text),'none') FROM seasons WHERE year=2026"
    Q "$RBDB" "SELECT 'seasons_in_progress='||coalesce(string_agg(year::text, ',' ORDER BY year),'none') FROM seasons WHERE status::text='in_progress'"
    Q "$RBDB" "SELECT 'player_match_stats_authority_rows='||count(*) FROM data_overrides WHERE entity_type='player_match_stats'"
    Q "$RBDB" "SELECT 'draft_picks='||(SELECT count(*) FROM draft_picks)||' draft_persons='||(SELECT count(*) FROM draft_persons)"
  } 2>&1 | tee "$E/rb-template-identity.txt"
}

phase_post_inputs_again() {
  node "$V" "$RB" "$RB/data" --detail --list "$E/inputs-files-q-after-rebuild.sha256" > "$E/inputs-after-rebuild.txt" 2>&1; cut -c1-200 "$E/inputs-after-rebuild.txt"
  [ "$(grep -c -P '^[a-z0-9-]+\tVERIFIED\t' "$E/inputs-after-rebuild.txt")" = 8 ] || { echo "after-rebuild verification is not 8/8"; return 1; }
  cmp -s <(sort "$E/inputs-files-q.sha256") <(sort "$E/inputs-files-q-after-rebuild.sha256") && say "inputs unchanged by the rebuild (per-file list identical before/after)" || { say "INPUTS CHANGED"; return 1; }
}

run_phases "$RB" "$@"
