#!/usr/bin/env bash
# GAP-029 Linux qualification, run as `arm` on streamanator in a FRESH guarded workspace and cluster. Nothing here touches production, the DEV database or any DEV
# service (DEV service state is recorded before and after). It performs no push, no deployment, no restart and no cleanup of anything it did not create.
#
# Stages: Q0 inputs and DEV baseline; Q1 static (typecheck + focused DB-free tests + Python contract + original-gate hash); Q2 the guarded cluster and a
# restore of the retained baseline dump into a disposable chain database; Q3 the real four-stage chain with negative controls (chain-inner.sh);
# Q4 evidence assembly + its negative controls from a fresh restore; Q5 affected editor integration + focused regressions; Q6 final corpus re-measurement;
# Q7 stop the cluster, prove isolation and DEV unchanged. Every result is written under $EVP and summarised in $EVP/qualification-summary.txt.
#
# Usage: W=<workspace: cand/ (checkout at R, node_modules), pg-root/, in/ (restore.mjs probe-dbs.mjs), venv/ (python with psycopg)>
#        R=<40-hex frozen revision> DUMP=<retained baseline dump> DUMP_SHA=<sha256> PROVENANCE=<capture provenance json> PROD_TARGET=<production target json> TAG=<label>
#        bash qualify-host.sh
set -u -o pipefail
: "${W:?}" "${R:?}" "${DUMP:?}" "${DUMP_SHA:?}" "${PROVENANCE:?}" "${PROD_TARGET:?}" "${TAG:?}"
[[ "$TAG" =~ ^[a-z0-9_]+$ ]] || { echo "STOP TAG must match [a-z0-9_]+ (it becomes part of an isolated database name)"; exit 2; }
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
PORT=55493; CAND="$W/cand"; EVP="$W/evidence-private/$TAG"; HELP="$CAND/docs/v2/evidence/gap029-hardening-20261103/scripts"
PY="${PY:-$W/venv/bin/python}"
mkdir -p -m 700 "$W/evidence-private"; [ -e "$EVP" ] && { echo "STOP $EVP exists; choose a new TAG"; exit 2; }; mkdir -m 700 "$EVP"
SUM="$EVP/qualification-summary.txt"; : > "$SUM"
export AFLDB_V2_PG_ROOT="$W/pg-root" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=$PORT AFLDB_PYTHON="$PY"
say() { echo "$(date -u +%FT%TZ) $*" | tee -a "$SUM"; }
rec() { echo "$*" | tee -a "$SUM"; }
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
RUNDB() { local db="$1"; shift; (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- "$@"); }
dev_services() { for u in afldb.service postgresql@16-main.service; do echo "$u $(systemctl is-active $u 2>&1) MainPID=$(systemctl show -p MainPID --value $u 2>&1)"; done; }
FAILS=0; ok() { rec "PASS $1"; }; bad() { FAILS=$((FAILS+1)); rec "FAIL $1"; }

say "Q0 inputs"
rec "host=$(hostname) user=$(whoami) kernel=$(uname -sr) node=$(node -v) python=$("$PY" -V 2>&1) pg_restore=$(/usr/lib/postgresql/16/bin/pg_restore --version)"
[ "$(cd "$CAND" && git rev-parse HEAD)" = "$R" ] && [ "$(cd "$CAND" && git status --porcelain | wc -l)" = 0 ] && ok "candidate clean at $R" || { bad "candidate not clean at $R"; exit 3; }
[ "$(sha256sum "$DUMP" | cut -d' ' -f1)" = "$DUMP_SHA" ] && ok "dump sha256 verified" || { bad "dump sha256 mismatch"; exit 3; }
ss -ltn 2>/dev/null | awk '{print $4}' | grep -E ":$PORT$" && { bad "port $PORT already listening"; exit 3; }
dev_services | tee "$EVP/dev-before.txt" >> "$SUM"

say "Q1 static: typecheck, focused DB-free tests, Python contract, original gate"
( cd "$CAND" && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json ) > "$EVP/tsc.log" 2>&1 && ok "tsc --noEmit clean" || { bad "tsc"; tail -5 "$EVP/tsc.log"; }
( cd "$CAND" && node node_modules/vitest/vitest.mjs run tests/gap029-outcome.test.ts tests/gap029-assembly.test.ts tests/gap029-rookie-selections.test.ts tests/gap029-captaincy-additions.test.ts tests/v2-season-seal.test.ts ) > "$EVP/vitest-focused.log" 2>&1 \
  && ok "focused GAP-029 + season-seal suites ($(grep -E 'Tests ' "$EVP/vitest-focused.log" | tail -1 | sed 's/\x1b\[[0-9;]*m//g'))" || { bad "focused suites"; tail -15 "$EVP/vitest-focused.log"; }
( cd "$CAND" && "$PY" tests/python/gap029_common_contract.py ) > "$EVP/py-contract.log" 2>&1 && ok "Python contract ($(grep -c '^ok' "$EVP/py-contract.log") checks)" || { bad "Python contract"; grep FAIL "$EVP/py-contract.log"; }
grep -q '^skip' "$EVP/py-contract.log" && bad "a Python contract check was skipped (psycopg missing?)"
[ "$(sha256sum "$CAND/tools/rebuild/draftguru/bridge_import_gate.py" | cut -d' ' -f1)" = fbce43f7f1e374b3dfac05968e627b8ad9f337279f233a49bc19ff57d02d558d ] && ok "bridge_import_gate.py byte-identical (fbce43f7...558d)" || bad "bridge_import_gate.py differs"

# cleanup trap FIRST: a slow start must not leave the isolated cluster running (the trap also covers the start itself)
fin() { local rc=$?; say "Q7 stop the cluster, prove isolation"; IR stop || true; sleep 2
  ss -ltn | awk '{print $4}' | grep -E ":$PORT$" && bad "port still listening"
  dev_services > "$EVP/dev-after.txt"; cmp -s "$EVP/dev-before.txt" "$EVP/dev-after.txt" && ok "DEV services unchanged (afldb.service, postgresql@16-main.service: state and MainPID)" || bad "DEV service state differs"
  rec "QUALIFICATION RESULT: $([ "$FAILS" = 0 ] && echo PASS || echo "FAIL ($FAILS)")  revision $R  host $(hostname) user $(whoami)"; exit $([ "$FAILS" = 0 ] && echo 0 || echo 1); }
trap fin EXIT
say "Q2 start the guarded cluster, restore the retained baseline into a disposable chain database"
( IR start > "$EVP/pg-start.out" 2>&1 < /dev/null & ); sleep 4; IR status || exit 4
pmpid=$(head -1 "$AFLDB_V2_PG_ROOT/data/postmaster.pid"); ss -ltnp 2>/dev/null | grep ":$PORT " > "$EVP/listener.txt"
grep -q "127.0.0.1:$PORT" "$EVP/listener.txt" && grep -q "pid=$pmpid," "$EVP/listener.txt" && [ "$(grep -c . "$EVP/listener.txt")" = 1 ] && ok "listener is exclusively the cluster we started (127.0.0.1:$PORT)" || { bad "listener not exclusive"; IR stop || true; exit 4; }
CHAIN=afldb_v2_gap029_${TAG}_chain_test
IR create-db "$CHAIN" || exit 5
RUNDB "$CHAIN" node "$W/in/restore.mjs" "$DUMP" "$DUMP_SHA" | tee "$EVP/restore.out" || exit 5
cp "$W/in/probe-dbs.mjs" "$CAND/.probe-dbs.mjs"; RUNDB "$CHAIN" node .probe-dbs.mjs "$CHAIN" | tee "$EVP/restore-probe.txt"; rm -f "$CAND/.probe-dbs.mjs"
grep -q '"ledger":"118_' "$EVP/restore-probe.txt" && ok "restored ledger is 118" || { bad "restored ledger is not 118"; exit 5; }

say "Q3 the four-stage chain and its negative controls (S1 -> S2 -> S3 -> S4 on one disposable clone)"
RUNDB "$CHAIN" env CAND="$CAND" EVP="$EVP" HELPERS="$HELP" PY="$PY" bash "$HELP/chain-inner.sh" && ok "chain: $(tail -1 "$EVP/chain/summary.txt")" || { bad "chain: $(tail -1 "$EVP/chain/summary.txt" 2>/dev/null)"; grep '^FAIL' "$EVP/chain/summary.txt" | head -10; }

say "Q4 evidence assembly from a fresh restore, with its negative controls (one data stage shown; run restore-assemble-host.sh per stage for the real packages)"
ASM=afldb_v2_gap029_${TAG}_asm_test; IR create-db "$ASM" || exit 6
RESTORED_AT=$(date -u +%FT%T.%3NZ)
RUNDB "$ASM" node "$W/in/restore.mjs" "$DUMP" "$DUMP_SHA" > "$EVP/asm-restore.out" 2>&1 || exit 6
TOC=$(/usr/lib/postgresql/16/bin/pg_restore --list "$DUMP" | grep -cv '^;')
AS() { RUNDB "$ASM" bash -c "cd '$CAND' && node --import tsx tools/v2/gap029-assemble-restore-evidence.ts $*"; }
AS restore-evidence --provenance "$PROVENANCE" --dump "$DUMP" --dump-sha256 "$DUMP_SHA" --restored-at "$RESTORED_AT" --toc-entries "$TOC" --production-target "$PROD_TARGET" --out "$EVP/asm-restore-evidence.json" > "$EVP/asm-1.log" 2>&1 && ok "restore evidence generated from the guarded restored database" || { bad "restore evidence"; tail -3 "$EVP/asm-1.log"; }
for st in S1 S2 S3 S4; do
  extra=""; [ "$st" = S2 ] && extra="--label annual-html-20260826"
  AS assemble --stage $st --production-target "$PROD_TARGET" --dump "$DUMP" --dump-sha256 "$DUMP_SHA" --restore-evidence "$EVP/asm-restore-evidence.json" --work-dir "$EVP/asm-work-$st" --out "$EVP/asm-backup-$st.json" $extra > "$EVP/asm-$st.log" 2>&1 \
    && ok "assembled sealed $st evidence: $(tail -1 "$EVP/asm-$st.log" | cut -c1-150)" || { bad "assemble $st"; tail -3 "$EVP/asm-$st.log"; }
done
ASMCTL() { local name="$1" want="$2"; shift 2; local log="$EVP/asm-ctl-$name.log"; "$@" > "$log" 2>&1; local rc=$?; if [ "$rc" != 0 ] && grep -q -- "$want" "$log" && [ ! -e "$EVP/asm-ctl-$name.json" ]; then ok "assembler refuses $name"; else bad "assembler control $name (exit $rc)"; head -2 "$log"; fi; }
ASMCTL wrong-dump-sha "hash to the stated sha256" AS assemble --stage S1 --production-target "$PROD_TARGET" --dump "$DUMP" --dump-sha256 "$(printf '0%.0s' {1..64})" --restore-evidence "$EVP/asm-restore-evidence.json" --work-dir "$EVP/asm-ctl-w1" --out "$EVP/asm-ctl-wrong-dump-sha.json"
node -e "const f=require('fs');const e=JSON.parse(f.readFileSync(process.argv[1]));e.restoredAt='2020-01-01T00:00:00.000Z';e.restore.restoredAt=e.restoredAt;e.capturedAt='2020-01-01T00:00:00.000Z';f.writeFileSync(process.argv[2],JSON.stringify(e))" "$EVP/asm-restore-evidence.json" "$EVP/asm-stale-evidence.json"
ASMCTL stale-evidence "older than 24 hours" AS assemble --stage S1 --production-target "$PROD_TARGET" --dump "$DUMP" --dump-sha256 "$DUMP_SHA" --restore-evidence "$EVP/asm-stale-evidence.json" --work-dir "$EVP/asm-ctl-w2" --out "$EVP/asm-ctl-stale-evidence.json"
node -e "const f=require('fs');const e=JSON.parse(f.readFileSync(process.argv[1]));e.backup.sha256='f'.repeat(64);f.writeFileSync(process.argv[2],JSON.stringify(e))" "$EVP/asm-restore-evidence.json" "$EVP/asm-other-dump-evidence.json"
ASMCTL evidence-for-another-dump "different dump" AS assemble --stage S1 --production-target "$PROD_TARGET" --dump "$DUMP" --dump-sha256 "$DUMP_SHA" --restore-evidence "$EVP/asm-other-dump-evidence.json" --work-dir "$EVP/asm-ctl-w3" --out "$EVP/asm-ctl-evidence-for-another-dump.json"
node -e "const f=require('fs');const t=JSON.parse(f.readFileSync(process.argv[1]));t.databaseOid='1';f.writeFileSync(process.argv[2],JSON.stringify(t))" "$PROD_TARGET" "$EVP/asm-other-target.json"
ASMCTL evidence-for-another-source "different source database" AS assemble --stage S1 --production-target "$EVP/asm-other-target.json" --dump "$DUMP" --dump-sha256 "$DUMP_SHA" --restore-evidence "$EVP/asm-restore-evidence.json" --work-dir "$EVP/asm-ctl-w4" --out "$EVP/asm-ctl-evidence-for-another-source.json"
ASMCTL output-exists "already exists" AS assemble --stage S1 --production-target "$PROD_TARGET" --dump "$DUMP" --dump-sha256 "$DUMP_SHA" --restore-evidence "$EVP/asm-restore-evidence.json" --work-dir "$EVP/asm-ctl-w5" --out "$EVP/asm-backup-S1.json"
ASMCTL work-dir-exists "work directory already exists" AS assemble --stage S1 --production-target "$PROD_TARGET" --dump "$DUMP" --dump-sha256 "$DUMP_SHA" --restore-evidence "$EVP/asm-restore-evidence.json" --work-dir "$EVP/asm-work-S1" --out "$EVP/asm-ctl-work-dir-exists.json"
for st in S1 S2 S3 S4; do sha256sum "$EVP/asm-backup-$st.json" | tee -a "$SUM"; done
# determinism: the stage values must equal what the chain's own plans computed on the same baseline, independent of the assembler
node -e "
const f=require('fs');const a=JSON.parse(f.readFileSync('$EVP/asm-backup-S2.json'));const p=JSON.parse(f.readFileSync('$EVP/chain/s2-plan.json'));
const ok=JSON.stringify(a.draftLinkRestorePlanExpect)===JSON.stringify(p.expect);console.log(ok?'S2 draftLinkRestorePlanExpect equals the chain plan expectation':'S2 draftLinkRestorePlanExpect DIFFERS from the chain plan expectation');process.exit(ok?0:1)" | tee -a "$SUM" && ok "assembled S2 expectation == plan expectation on the same baseline" || bad "S2 expectation differs"

say "Q5 affected editor integration and focused regressions (against a disposable database; AFLDB_TEST_DATABASE_URL is set by the guarded runner)"
RUNDB "$CHAIN" bash -c "cd '$CAND' && node node_modules/vitest/vitest.mjs run tests/integration/admin-draft.test.ts tests/integration/sealed-editor-guard.test.ts tests/admin-draft-actions.test.ts tests/data-overrides-source-contract.test.ts tests/draftguru-import.test.ts" > "$EVP/vitest-editor.log" 2>&1 \
  && ok "editor integration + focused regressions ($(sed 's/\x1b\[[0-9;]*m//g' "$EVP/vitest-editor.log" | grep -E 'Tests ' | tail -1))" || { bad "editor integration / regressions"; sed 's/\x1b\[[0-9;]*m//g' "$EVP/vitest-editor.log" | grep -E "FAIL|Error" | head -10; }

say "Q6 final corpus re-measurement on the post-chain clone"
mkdir -p "$EVP/corpus"
RUNDB "$CHAIN" bash -c "cd '$CAND' && AFLDB_GRIDLEY_DIAGNOSTIC=1 AFLDB_GRIDLEY_REPORT='$EVP/corpus/report.json' node node_modules/vitest/vitest.mjs run tests/integration/gridley-corpus.test.ts" > "$EVP/corpus/run.log" 2>&1; echo "corpus test file exit $? (diagnostic mode exits 1 by design while strict parity retains its 118 accepted findings)" | tee -a "$SUM"
node "$HELP/corpus-summary.mjs" "$EVP/corpus/report.json" > "$EVP/corpus/summary.json" && ok "corpus: conformance PASS, 0 unapproved, 0 incorrect known answers, strict parity retained at 118 (report sha256 $(sha256sum "$EVP/corpus/report.json" | cut -d' ' -f1))" || { bad "corpus acceptance"; cat "$EVP/corpus/summary.json" | head -40; }
