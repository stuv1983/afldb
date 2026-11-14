#!/usr/bin/env bash
# ISSUE-363 run 3, scope `integb` (phase B), runner: the integration suites that are pinned to a rebuilt `afldb_test`, run on the
# sibling scope's rebuilt database (published under /mnt/ssd/afldb-rem3-base/rebuilt/) instead of the 4 Nov production snapshot.
#
#   run-rebuilt.sh --dump <rebuilt.dump> --sha256 <64 hex> --bridge <child.json> [options]
#
# Required
#   --dump <path>       the sibling's `pg_dump -Fc` (afldb_v2_rb_rem3-<rev>.dump). Its directory must also hold RESTORE.md,
#                       SHA256SUMS, restore-dump.mjs and the table-counts.tsv, as published; the restore follows that RESTORE.md
#                       exactly (create-db, `isolated-pg run <db> -- node restore-dump.mjs <dump> <sha>`, verify, count diff).
#   --sha256 <hex>      the dump's sha256 (checked against SHA256SUMS, against the file, and again inside restore-dump.mjs)
#   --bridge <path>     the DraftGuru bridge child the rebuild exported (AFLDB_DRAFTGURU_BRIDGE; imported into the template the
#                       `oracle6` group uses, as RESTORE.md "DraftGuru bridge child" prescribes)
# Options
#   --restore-md <path> override RESTORE.md (default: <dump dir>/RESTORE.md); copied into the evidence with its sha256
#   --workspace <dir>   default /mnt/ssd/afldb-rem3-integb-20261114 (checkout in <dir>/cand, cluster in <dir>-pg)
#   --port <n>          default 55675 (refused: 5432, 55432, 55651, 55660, anything below 1024 or above 65535)
#   --tag <label>       evidence directory <workspace>/evidence/b-<label> (default: UTC timestamp)
#   --groups <list>     comma list of: restore,oracle6,data-editor,awards,war-years,coleman,issue276,od5,brownlow
#                       (default: all but brownlow; `restore` must have run once on this cluster before any other group)
#   --with-brownlow     add the `brownlow` group: the two name-pinned Brownlow clones. They are built from the retained 2025
#                       template artefacts (brownlow-clones.sh), NOT from the rebuilt base, whose data the suites do not model.
#   --baseline <tsv>    the 52-id failure list (default: the run-2 integ-failures.tsv in the checkout)
#   --keep-cluster      do not `isolated-pg stop` at the end
#   --dry-run           check every argument and prerequisite, print the plan, change nothing
#
# Rules enforced (run-3 common brief, F-004/F-005/F-006):
#   * every database command goes through `isolated-pg run` on THIS scope's port; ambient DSNs are refused;
#   * AFLDB_TEST_PER_FILE_DB_PREFIX is refused if set (`afldb_v2_rb_` would silently un-skip isolated-populated-lifecycle);
#   * a fresh `--template` copy for every group; nothing is deleted or edited by hand to satisfy a guard; the only preparatory
#     statements are those listed in RESTORE.md (and are recorded in the evidence);
#   * `restore`, `oracle6` and `brownlow` take flock /mnt/ssd/afldb-rem3-base/heavy.lock; every step is bounded by `timeout`.
#     The single-file groups run without the lock (each is under ~5 minutes), as in phase A.
# Output: <evidence>/<group>*.json (vitest JSON) + .log; verdicts.tsv compares the 52 baseline ids (state-b excluded: it is owned
# by the stateb scope) and the war-years id with what this run observed; template-identity.txt holds the base's aggregates.
set -euo pipefail

DUMP="" SHA="" BRIDGE="" RESTORE_MD="" WS=/mnt/ssd/afldb-rem3-integb-20261114 PORT=55675 TAG="" GROUPS_ARG=""
WITH_BROWNLOW=0 BASELINE="" KEEP=0 DRY=0
LOCK=/mnt/ssd/afldb-rem3-base/heavy.lock
DG_SRC=/home/arm/projects/afldb/data/sources/draftguru/annual-html-20260826   # DEV checkout data: READ ONLY (copy only)

die() { echo "run-rebuilt: $*" >&2; exit 2; }
while [ $# -gt 0 ]; do
  case "$1" in
    --dump) DUMP=${2:-}; shift 2 ;;
    --sha256) SHA=${2:-}; shift 2 ;;
    --bridge) BRIDGE=${2:-}; shift 2 ;;
    --restore-md) RESTORE_MD=${2:-}; shift 2 ;;
    --workspace) WS=${2:-}; shift 2 ;;
    --port) PORT=${2:-}; shift 2 ;;
    --tag) TAG=${2:-}; shift 2 ;;
    --groups) GROUPS_ARG=${2:-}; shift 2 ;;
    --with-brownlow) WITH_BROWNLOW=1; shift ;;
    --baseline) BASELINE=${2:-}; shift 2 ;;
    --keep-cluster) KEEP=1; shift ;;
    --dry-run) DRY=1; shift ;;
    *) die "unknown argument: $1" ;;
  esac
done

# ---- argument checks (all of them run in --dry-run too) ----------------------------------------------------------------
[ -n "$DUMP" ] || die "--dump is required"
[ -n "$SHA" ] || die "--sha256 is required"
[ -n "$BRIDGE" ] || die "--bridge is required"
[[ "$SHA" =~ ^[0-9a-f]{64}$ ]] || die "--sha256 must be 64 lowercase hex characters"
[[ "$PORT" =~ ^[0-9]+$ ]] || die "--port must be a number"
if [ "$PORT" -lt 1024 ] || [ "$PORT" -gt 65535 ]; then die "--port out of range"; fi
case "$PORT" in 5432|55432|55651|55660) die "--port $PORT is forbidden (shared/DEV/sibling port)" ;; esac
[ -z "${AFLDB_TEST_PER_FILE_DB_PREFIX:-}" ] || die "AFLDB_TEST_PER_FILE_DB_PREFIX is set ('${AFLDB_TEST_PER_FILE_DB_PREFIX}'): refused (F-005; afldb_v2_rb_ would un-skip isolated-populated-lifecycle)"
[ -z "${AFLDB_TEST_DATABASE_URL:-}" ] || die "an ambient AFLDB_TEST_DATABASE_URL is set: refused (every database command must go through isolated-pg run)"
[ -f "$DUMP" ] || die "--dump not found: $DUMP"
[ -f "$BRIDGE" ] || die "--bridge not found: $BRIDGE"
case "$WS" in /mnt/ssd/afldb-rem3-integb-*) ;; *) die "--workspace must be this scope's /mnt/ssd/afldb-rem3-integb-* directory" ;; esac
CAND="$WS/cand"
[ -d "$CAND/.git" ] || die "no checkout at $CAND (run in/setup.sh first)"
[ ! -e "$CAND/.env" ] || die "$CAND/.env exists (the workspace must contain no .env)"
[ -n "$(git -C "$CAND" rev-parse HEAD)" ] || die "cannot read the checkout HEAD"
RB_DIR="$(cd "$(dirname "$DUMP")" && pwd)"
for f in SHA256SUMS restore-dump.mjs RESTORE.md; do [ -f "$RB_DIR/$f" ] || die "$RB_DIR/$f missing (the published rebuild directory is incomplete)"; done
[ -n "$RESTORE_MD" ] || RESTORE_MD="$RB_DIR/RESTORE.md"
[ -f "$RESTORE_MD" ] || die "--restore-md not found: $RESTORE_MD"
(cd "$RB_DIR" && sha256sum -c --quiet SHA256SUMS) >/dev/null 2>&1 || die "sha256sum -c SHA256SUMS failed in $RB_DIR"
grep -F "$SHA  $(basename "$DUMP")" "$RB_DIR/SHA256SUMS" >/dev/null || die "--sha256 is not the SHA256SUMS entry for $(basename "$DUMP")"
[ -z "$BASELINE" ] && BASELINE="$CAND/docs/v2/evidence/remediation-20261114/run2/qualification-2/integ-failures.tsv"
[ -f "$BASELINE" ] || die "--baseline not found: $BASELINE"
ALL_GROUPS=(restore oracle6 data-editor awards war-years coleman issue276 od5)
[ "$WITH_BROWNLOW" = 1 ] && ALL_GROUPS+=(brownlow)
if [ -z "$GROUPS_ARG" ]; then GROUPS_LIST=("${ALL_GROUPS[@]}"); else IFS=, read -r -a GROUPS_LIST <<< "$GROUPS_ARG"; fi
for g in "${GROUPS_LIST[@]}"; do
  case "$g" in restore|oracle6|data-editor|awards|war-years|coleman|issue276|od5|brownlow) ;; *) die "unknown group '$g'" ;; esac
done
[ -n "$TAG" ] || TAG=$(date -u +%Y%m%dT%H%M%SZ)
[[ "$TAG" =~ ^[A-Za-z0-9._-]+$ ]] || die "--tag may only contain [A-Za-z0-9._-]"
EV="$WS/evidence/b-$TAG"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PF_RUNNER="$CAND/docs/v2/evidence/remediation-20261114/run2/tests363/run-integration-per-file.sh"
[ -f "$PF_RUNNER" ] || die "per-file runner missing: $PF_RUNNER"
[ -f "$HERE/verdicts.js" ] || die "verdicts.js missing beside this script"
[ "$WITH_BROWNLOW" = 0 ] || [ -f "$HERE/brownlow-clones.sh" ] || die "brownlow-clones.sh missing beside this script"
if printf '%s\n' "${GROUPS_LIST[@]}" | grep -x restore >/dev/null; then
  [ -d "$DG_SRC/raw/years" ] || die "DraftGuru Stage A raw pages not found at $DG_SRC/raw/years (needed to import the bridge child)"
fi

export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_TEST_PYTHON=/home/arm/i250/afldb/.venv/bin/python
export AFLDB_V2_PG_ROOT="$WS-pg" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=$PORT
export AFLDB_DRAFTGURU_BRIDGE="$BRIDGE"

echo "== run-rebuilt plan ($(date -u +%FT%TZ))"
echo "dump=$DUMP sha256=$SHA bridge=$BRIDGE restore-md=$RESTORE_MD"
echo "workspace=$WS checkout=$(git -C "$CAND" rev-parse HEAD) port=$PORT evidence=$EV"
echo "groups: ${GROUPS_LIST[*]}"
if [ "$DRY" = 1 ]; then
  [ "$(sha256sum "$DUMP" | cut -d' ' -f1)" = "$SHA" ] || { echo "dry-run: dump sha256 DOES NOT match --sha256 (a real run would stop)"; exit 3; }
  echo "dry-run: dump sha256 matches"
  echo "dry-run: arguments and prerequisites accepted; nothing changed"
  exit 0
fi

# ---- real run ---------------------------------------------------------------------------------------------------------
mkdir -p "$EV"
say() { echo "$(date -u +%FT%TZ) $*" | tee -a "$EV/run.log"; }
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
strip() { sed 's/\x1b\[[0-9;]*m//g' | { grep -a -v -i 'postgres://' || true; }; }
[ "$(sha256sum "$DUMP" | cut -d' ' -f1)" = "$SHA" ] || die "dump sha256 mismatch"
ss -H -ltn "sport = :$PORT" | grep . >/dev/null || { IR start > "$EV/pg-start.out" 2>&1 < /dev/null; sleep 3; }
PM=$(head -1 "$AFLDB_V2_PG_ROOT/data/postmaster.pid")
ss -ltnp 2>/dev/null | grep ":$PORT " > "$EV/listener.txt" || true
grep "pid=$PM," "$EV/listener.txt" >/dev/null || die "the listener on $PORT is not this cluster's postmaster"
cp "$RESTORE_MD" "$EV/RESTORE.md.txt"; sha256sum "$RESTORE_MD" > "$EV/RESTORE.md.sha256"
grep -E 'fitzRoy baseline|ledger head|DraftGuru|commit ' "$RESTORE_MD" | head -6 > "$EV/rebuild-identity-quote.txt" || true

TMPL=afldb_v2_rem3integb_rb_tmpl_test            # the pristine restored rebuild
TMPLB=afldb_v2_rem3integb_rb_bridged_test        # the same, with the DraftGuru bridge child imported (RESTORE.md)
mkcopy() { IR create-db "$1" --template "${2:-$TMPL}" 2>&1 | strip | tail -1; }

# vitest summary and failing ids (file<TAB>full name<TAB>first line of the message)
summ() { node -e '
const j=require(process.argv[1]); const out=[];
for(const f of j.testResults){
  const n=f.name.replace(/\\/g,"/").replace(/^.*\/tests\//,"tests/");
  const bad=f.assertionResults.filter(a=>a.status==="failed");
  if(f.status==="failed"&&bad.length===0) out.push(n+"\t<file-level>\t"+String(f.message||"").split("\n")[0].slice(0,160));
  for(const a of bad) out.push(n+"\t"+a.fullName+"\t"+String(a.failureMessages[0]||"").split("\n")[0].slice(0,160));
}
console.log("total "+j.numTotalTests+" passed "+j.numPassedTests+" failed "+j.numFailedTests+" skipped "+(j.numPendingTests+(j.numTodoTests||0))+" files "+j.testResults.length);
console.log(out.sort().join("\n"));' "$1"; }
after() { # <label>
  if [ -f "$EV/$1.json" ]; then summ "$EV/$1.json" > "$EV/$1.summary.txt"; say "$1: $(head -1 "$EV/$1.summary.txt")"; else say "$1: no JSON report"; fi
}

# shared-mode vitest on a fresh copy: vt <db> <label> <timeout-s> <vitest args...>   (HEAVY=1 takes the lock)
vt() {
  local db=$1 label=$2 to=$3; shift 3
  say "vt $label db=$db: $*"
  (cd "$CAND" && ${HEAVY:+flock "$LOCK"} timeout "$to" node --import tsx tools/v2/isolated-pg.ts run "$db" -- node node_modules/vitest/vitest.mjs run "$@" \
     --reporter=default --reporter=json --outputFile.json="$EV/$label.json" > "$EV/$label.log" 2>&1) && rc=0 || rc=$?
  say "vt $label rc=$rc"; after "$label"
}
# per-file vitest (MODE=all: every file its own database from the base): pf <base-db> <label> <timeout-s> <vitest args...>
pf() {
  local base=$1 label=$2 to=$3; shift 3
  say "pf $label base=$base: $*"
  ${HEAVY:+flock "$LOCK"} timeout "$to" env CAND="$CAND" BASE="$base" MODE=all bash "$PF_RUNNER" "$@" \
    --reporter=default --reporter=json --outputFile.json="$EV/$label.json" > "$EV/$label.log" 2>&1 && rc=0 || rc=$?
  say "pf $label rc=$rc"; after "$label"
}
# read-only SQL: Q <db> <sql>
Q() { local db=$1; shift; (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- bash -c 'PGOPTIONS="-c default_transaction_read_only=on" "$AFLDB_V2_PG_BIN/psql" -X -A -t -F"|" "$AFLDB_TEST_DATABASE_URL" -c "$1"' _ "$*" 2>&1 | { grep -a -v '^isolated-pg:' || true; }); }

want() { local g; for g in "${GROUPS_LIST[@]}"; do [ "$g" = "$1" ] && return 0; done; return 1; }

if want restore; then
  say "restore: $TMPL from $(basename "$DUMP") exactly as RESTORE.md prescribes (create-db, restore-dump.mjs, verify, count diff)"
  IR create-db "$TMPL" 2>&1 | strip | tail -1
  (cd "$CAND" && flock "$LOCK" timeout 3000 node --import tsx tools/v2/isolated-pg.ts run "$TMPL" -- node "$RB_DIR/restore-dump.mjs" "$DUMP" "$SHA") 2>&1 | strip | tee "$EV/restore.log" | tail -6
  IR verify "$TMPL" 2>&1 | strip | tee -a "$EV/restore.log" | tail -2
  IR list 2>&1 | strip | grep -F "$TMPL" | tee -a "$EV/restore.log" || true
  # exact count(*) of every public base table against the published table-counts.tsv
  TC=$(ls "$RB_DIR"/*table-counts.tsv 2>/dev/null | head -1 || true)
  if [ -n "$TC" ]; then
    SQLTXT=$(awk -F'\t' 'NF==2 { printf "%sSELECT '\''%s'\'' AS t, count(*)::text AS n FROM public.\"%s\"", (c++ ? " UNION ALL " : ""), $1, $1 }' "$TC")
    Q "$TMPL" "$SQLTXT" | tr '|' '\t' | sort > "$EV/table-counts.restored.tsv" || true
    sort "$TC" > "$EV/table-counts.published.tsv"
    if diff "$EV/table-counts.published.tsv" "$EV/table-counts.restored.tsv" > "$EV/table-counts.diff"; then say "table counts: IDENTICAL to $(basename "$TC")"; else say "table counts: DIFFER (see table-counts.diff)"; fi
  fi
  {
    echo "identity of the restored rebuilt base (aggregates only):"
    Q "$TMPL" "SELECT 'ledger_max='||max(name)||' ledger_count='||count(*) FROM afldb_meta.schema_migrations"
    Q "$TMPL" "SELECT 'matches='||count(*)||' seasons='||min(season)||'..'||max(season)||' players='||(SELECT count(*) FROM players) FROM matches"
    Q "$TMPL" "SELECT 'season2026='||coalesce(max(status::text),'none') FROM seasons WHERE year=2026"
    Q "$TMPL" "SELECT 'seasons_in_progress='||coalesce(string_agg(year::text, ',' ORDER BY year),'none') FROM seasons WHERE status::text='in_progress'"
    Q "$TMPL" "SELECT 'player_match_stats_authority_rows='||count(*) FROM data_overrides WHERE entity_type='player_match_stats'"
    Q "$TMPL" "SELECT 'coleman_winner_rows='||count(*)||' seasons='||count(DISTINCT w.season)||' last_season='||max(w.season) FROM award_winners w JOIN awards a ON a.id=w.award_id WHERE a.slug='coleman'"
    Q "$TMPL" "SELECT 'coleman_2001_rows='||count(*) FROM award_winners w JOIN awards a ON a.id=w.award_id WHERE a.slug='coleman' AND w.season=2001"
    Q "$TMPL" "SELECT 'pf_2026_hawthorn_v_brisbane_lions='||count(*) FROM matches m JOIN clubs h ON h.id=m.home_club_id JOIN clubs a ON a.id=m.away_club_id WHERE m.season=2026 AND m.round_code='PF' AND h.name IN ('Hawthorn','Brisbane Lions') AND a.name IN ('Hawthorn','Brisbane Lions')"
    Q "$TMPL" "SELECT 'brownlow_coverage_2026='||coalesce(string_agg(stat_key||':'||coverage::text, ',' ORDER BY stat_key),'none') FROM stat_availability WHERE season=2026 AND stat_key LIKE 'brownlow%'"
    Q "$TMPL" "SELECT 'brownlow_round_votes_null_match_id='||count(*) FROM brownlow_round_votes WHERE match_id IS NULL"
  } 2>&1 | tee "$EV/template-identity.txt"

  # the DraftGuru bridge child (RESTORE.md "DraftGuru bridge child"): Stage A raw pages are copied READ-ONLY from the DEV checkout
  # data after every one of the 42 raw files matches the committed manifest; nothing is written to the source.
  say "stage A: verify and copy the 42 raw year pages"
  STAGE="$CAND/data/sources/draftguru/annual-html-20260826"
  MISMATCH=$(node -e '
const fs=require("fs"),c=require("crypto");
const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); let bad=0;
for(const e of m.source_urls){ const p=process.argv[2]+"/"+e.raw_filename; let ok=false; try{ ok=c.createHash("sha256").update(fs.readFileSync(p)).digest("hex")===e.sha256; }catch(_){} if(!ok){ bad++; console.error("MISMATCH "+e.raw_filename); } }
console.log(bad);' "$CAND/docs/rebuild-manifests/draftguru/annual-html-20260826.json" "$DG_SRC")
  [ "$MISMATCH" = 0 ] || die "Stage A raw pages do not match the committed manifest ($MISMATCH mismatches)"
  if [ ! -d "$STAGE/raw/years" ]; then mkdir -p "$STAGE/raw" && cp -a "$DG_SRC/raw/years" "$STAGE/raw/years" && chmod -R a-w "$STAGE/raw/years"; fi
  say "bridge: $TMPLB = $TMPL + import_draftguru.py --label annual-html-20260826 --bridge <child> (the only preparatory statement)"
  mkcopy "$TMPLB"
  (cd "$CAND" && flock "$LOCK" timeout 1800 node --import tsx tools/v2/isolated-pg.ts run "$TMPLB" -- "$AFLDB_PYTHON" tools/rebuild/draftguru/import_draftguru.py --label annual-html-20260826 --bridge "$BRIDGE") > "$EV/bridge-import.log" 2>&1 && say "bridge import rc=0" || say "bridge import FAILED rc=$? (see bridge-import.log)"
  # ISSUE-363 (integb): the import leaves the copy without planner statistics (56 pg_stats rows against 546 on the pristine template), which
  # made the three club-comparison "long rivalry performance" ceilings fail (2.8 s medians) on this copy only; ANALYZE (no data change) restores them.
  IR run "$TMPLB" -- bash -c '"$AFLDB_V2_PG_BIN/psql" -X -q "$AFLDB_TEST_DATABASE_URL" -c ANALYZE' 2>&1 < /dev/null | strip > "$EV/bridge-analyze.log" || true
  say "bridge: ANALYZE after import (planner statistics only), log bridge-analyze.log"
  { Q "$TMPLB" "SELECT 'draft_picks='||(SELECT count(*) FROM draft_picks)||' draft_persons='||(SELECT count(*) FROM draft_persons)||' bridge_identities='||(SELECT count(*) FROM external_identities WHERE match_method='draftguru_person_page_afltables_bridge')"; } 2>&1 | tee "$EV/bridged-identity.txt"
fi

if want oracle6; then
  B=afldb_v2_rem3integb_b_oracle_test; mkcopy "$B" "$TMPLB"
  HEAVY=1 pf "$B" oracle6 7200 tests/integration/club-comparison.test.ts tests/integration/database.test.ts tests/integration/draft-linkage.test.ts \
     tests/integration/admin-brownlow.test.ts tests/integration/gridley-corpus.test.ts tests/integration/release-gates.test.ts
fi
if want data-editor; then
  B=afldb_v2_rem3integb_b_de_test; mkcopy "$B"
  pf "$B" data-editor 3600 tests/integration/data-editor.test.ts
fi
if want awards; then
  B=afldb_v2_rem3integb_b_aw_test; mkcopy "$B"
  pf "$B" awards 3600 tests/integration/awards-reload-links.test.ts
fi
if want war-years; then
  for n in 1 2 3; do
    D=afldb_v2_rem3integb_b_war${n}_test; mkcopy "$D"
    vt "$D" "war-shared-$n" 1800 tests/integration/database.test.ts
  done
  B=afldb_v2_rem3integb_b_warpf_test; mkcopy "$B"
  pf "$B" war-perfile 1800 tests/integration/database.test.ts
  # the mechanism check (phase A): settle-afl-api-brownlow first, then the war-years case, on one shared copy
  M=afldb_v2_rem3integb_b_warmech_test; mkcopy "$M"
  vt "$M" war-mech-settle 2400 tests/integration/settle-afl-api-brownlow.test.ts
  vt "$M" war-mech-after 1200 tests/integration/database.test.ts -t 'separates the war years'
fi
if want coleman; then
  # (a) the rebuilt base (per-file copy): records whether it holds a Coleman 2001 row (the suite refuses if so, by design)
  B=afldb_v2_rem3integb_b_cole_test; mkcopy "$B"
  pf "$B" coleman-rebuilt 1800 tests/integration/v2-coleman-publication.test.ts
  # (b) the suite's documented base: a schema-only database (docs/v2/final-report.md:86, local-release-review.md:289-290)
  S=afldb_v2_rem3integb_b_coleschema_test
  IR create-db "$S" 2>&1 | strip | tail -1
  (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$S" -- node --import tsx tools/db/migrate.ts --target test) > "$EV/coleschema-migrate.log" 2>&1 || die "schema-only migrate failed"
  (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$S" -- node --import tsx tools/db/privileges.ts --target test) > "$EV/coleschema-privileges.log" 2>&1 || die "schema-only privileges failed"
  vt "$S" coleman-schema-only 1800 tests/integration/v2-coleman-publication.test.ts
fi
if want issue276; then
  B=afldb_v2_rem3integb_b_276_test; mkcopy "$B"
  pf "$B" issue276 1800 tests/integration/settle-afl-api-issue276.test.ts
fi
if want od5; then
  # a dedicated afldb_v2_rb_<x>_test clone (never the rebuilt base itself), shared mode, the exact -t filter
  D=afldb_v2_rb_rem3bio5_test; mkcopy "$D"
  # -t is a regex: the parentheses in the case name must be escaped or the filter matches nothing (all 74 cases skip)
  vt "$D" od5 3600 tests/integration/settle-afl-api.test.ts -t 'OD-5 reinstate \(rolled back, no rebuild\)'
fi
if want brownlow; then
  bash "$HERE/brownlow-clones.sh" all "$EV" | tee -a "$EV/run.log"
fi

# ---- verdicts: every baseline id (and the war-years id) against what this run observed ---------------------------------
JSONS=$(ls "$EV"/*.json 2>/dev/null || true)
if [ -n "$JSONS" ]; then
  # shellcheck disable=SC2086
  node "$HERE/verdicts.js" "$BASELINE" $JSONS | sort > "$EV/verdicts.tsv" || true
  cut -f1 "$EV/verdicts.tsv" | sed 's/@.*//' | sort | uniq -c | tee -a "$EV/run.log"
fi
( cd "$EV" && find . -maxdepth 1 -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum ) > "$EV/SHA256SUMS"
if [ "$KEEP" = 0 ]; then
  IR stop 2>&1 | strip | tail -2
  if ss -H -ltn "sport = :$PORT" | grep . >/dev/null; then say "WARNING: $PORT still listening"; else say "port $PORT free"; fi
fi
say "done"
