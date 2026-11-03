#!/usr/bin/env bash
# GAP-029 four-stage chain, in order (S1 captaincy additions, S2 draft link-only, S3 rookie selections, S4 sibling pair), run ONLY inside the guarded
# isolated runner (`tools/v2/isolated-pg.ts run <db> --`) against a disposable clone, with the negative controls. Called by qualify-host.sh.
# Every stage runs `plan --rehearsal` then `apply --rehearsal`; a clone can never be given a production plan (the tools refuse it, and that refusal is a control).
# Env: CAND (checkout at the frozen revision) EVP (private evidence dir) HELPERS (dir holding fingerprint.mjs) PY (python with psycopg) ACTOR (default 1)
set -u -o pipefail
: "${CAND:?}" "${EVP:?}" "${HELPERS:?}" "${PY:?}"
[ "${AFLDB_V2_ISOLATED_PG:-}" = 1 ] || { echo "STOP run inside tools/v2/isolated-pg.ts run"; exit 2; }
export AFLDB_GAP029_DSN="$AFLDB_TEST_DATABASE_URL" AFLDB_GAP029_WRITE_DSN="$AFLDB_IMPORT_DATABASE_URL"
ACTOR="${ACTOR:-1}"; LABEL="${LABEL:-annual-html-20260826}"
cd "$CAND"
OUT="$EVP/chain"; mkdir -p -m 700 "$OUT"
PASS=0; FAILN=0; : > "$OUT/summary.txt"
note() { echo "$*" | tee -a "$OUT/summary.txt"; }
fp() { (cp "$HELPERS/fingerprint.mjs" ./.fp.mjs && node ./.fp.mjs; rm -f ./.fp.mjs); }
S1() { node --import tsx tools/v2/gap029-captaincy-additions-production.ts "$@"; }
S3() { node --import tsx --conditions=react-server tools/v2/gap029-rookie-selections-production.ts "$@"; }
S2() { "$PY" tools/v2/gap029-draft-link-production.py "$@"; }
S4() { "$PY" tools/v2/gap029-sibling-pair-production.py "$@"; }
must() { # name expected-exit -- cmd...   (positive step: exit code and OUTCOME line recorded)
  local name="$1" want="$2"; shift 3; local log="$OUT/$name.log"; "$@" > "$log" 2>&1; local rc=$?
  if [ "$rc" = "$want" ]; then PASS=$((PASS+1)); note "PASS $name exit=$rc :: $(grep -m1 '^OUTCOME' "$log" | cut -c1-110)"; else FAILN=$((FAILN+1)); note "FAIL $name exit=$rc (wanted $want)"; tail -5 "$log"; fi
}
ctl() { # name expected-text -- cmd...   (negative control: refuses, exit 1, database fingerprint unchanged)
  local name="$1" want="$2"; shift 3; local log="$OUT/ctl-$name.log"; local b a; b=$(fp); "$@" > "$log" 2>&1; local rc=$?; a=$(fp)
  if [ "$rc" != 0 ] && grep -q -- "$want" "$log" && [ "$b" = "$a" ]; then PASS=$((PASS+1)); note "PASS control $name :: exit=$rc :: $(head -1 "$log" | cut -c1-110)"; else FAILN=$((FAILN+1)); note "FAIL control $name exit=$rc fp-equal=$([ "$b" = "$a" ] && echo yes || echo NO)"; head -3 "$log"; fi
}
tamper() { node -e "const f=require('fs');const p=JSON.parse(f.readFileSync(process.argv[1],'utf8'));p.tamperedByControl=true;f.writeFileSync(process.argv[2],JSON.stringify(p))" "$1" "$2"; }

# ---- target identity of this clone, proven by query (no values typed) ----
cat > ./.id.mjs <<'EOS'
import postgres from 'postgres';
const url = new URL(process.env.AFLDB_TEST_DATABASE_URL);
const sql = postgres(process.env.AFLDB_TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
const [row] = await sql`SELECT current_database() AS database, current_user AS "user", c.system_identifier::text AS "systemIdentifier", d.oid::text AS "databaseOid",
  current_setting('cluster_name') AS "clusterName", shobj_description(d.oid,'pg_database') AS "databaseComment" FROM pg_control_system() c CROSS JOIN pg_database d WHERE d.datname = current_database()`;
console.log(JSON.stringify({ host: '127.0.0.1', port: Number(url.port), ...row }, null, 2));
await sql.end({ timeout: 2 });
EOS
node ./.id.mjs > "$OUT/target.json"; rm -f ./.id.mjs; T="$OUT/target.json"
echo '{"host":"127.0.0.1","port":1,"database":"afldb_prod","user":"afldb_import","systemIdentifier":"1","databaseOid":"1","clusterName":"16/main","databaseComment":null}' > "$OUT/fake-prod-target.json"
note "chain clone: $(node -e "const t=require('$T');console.log(t.database+' system='+t.systemIdentifier+' oid='+t.databaseOid)")  revision $(git rev-parse HEAD)"
note "fingerprint at start: $(fp)"

# ---- S1 ----
must s1-baseline 0 -- S1 baseline --target "$T" --rehearsal --out "$OUT/s1-baseline.json"
must s1-plan 0 -- S1 plan --target "$T" --rehearsal --out "$OUT/s1-plan.json"
tamper "$OUT/s1-plan.json" "$OUT/s1-plan-tampered.json"
ctl s1-tampered-plan "plan digest" -- S1 apply --plan "$OUT/s1-plan-tampered.json" --rehearsal --out "$OUT/ctl-s1.json"
ctl s1-clone-without-rehearsal "rehears" -- S1 plan --target "$T" --out "$OUT/ctl-s1b.json"
must s1-apply 0 -- S1 apply --plan "$OUT/s1-plan.json" --rehearsal --out "$OUT/s1-apply.json"
must s1-replay 0 -- S1 apply --plan "$OUT/s1-plan.json" --rehearsal --out "$OUT/s1-apply-2.json"
grep -q 'NOTHING_WRITTEN' "$OUT/s1-replay.log" && note "PASS s1 replay wrote nothing" || { FAILN=$((FAILN+1)); note "FAIL s1 replay did not report NOTHING_WRITTEN"; }
must s1-state 0 -- S1 state --plan "$OUT/s1-plan.json" --rehearsal --out "$OUT/s1-state.json"
grep -q "PLANNED RESULT PRESENT" "$OUT/s1-state.log" && note "PASS s1 state reports the planned result" || { FAILN=$((FAILN+1)); note "FAIL s1 state does not report the planned result"; }
note "fingerprint after S1: $(fp)"

# ---- S2 ----
CHILD="$OUT/child.json"
"$PY" tools/rebuild/draftguru/export_person_bridge.py --resolve-against isolated --parent data/reference/draftguru-person-bridge-20260918-v3.json --out "$CHILD" > "$OUT/child-export.log" 2>&1 || { note "FAIL child export"; tail -3 "$OUT/child-export.log"; }
CH=$(sha256sum "$CHILD" | cut -d' ' -f1); note "S2 child sha256 $CH"
must s2-plan 0 -- S2 plan --target "$T" --rehearsal --child "$CHILD" --child-sha256 "$CH" --label "$LABEL" --out "$OUT/s2-plan.json"
ctl s2-wrong-child-sha "pinned child hash" -- S2 plan --target "$T" --rehearsal --child "$CHILD" --child-sha256 "$(printf '0%.0s' {1..64})" --label "$LABEL" --out "$OUT/ctl-s2a.json"
ctl s2-missing-label "required" -- S2 plan --target "$T" --rehearsal --child "$CHILD" --child-sha256 "$CH" --out "$OUT/ctl-s2b.json"
ctl s2-no-production-dry-run "no production dry run is authorised" -- S2 plan --target "$OUT/fake-prod-target.json" --child "$CHILD" --child-sha256 "$CH" --label "$LABEL" --with-dry-run --out "$OUT/ctl-s2c.json"
ctl s2-clone-without-rehearsal "rehearsed with --rehearsal" -- S2 plan --target "$T" --child "$CHILD" --child-sha256 "$CH" --label "$LABEL" --out "$OUT/ctl-s2d.json"
tamper "$OUT/s2-plan.json" "$OUT/s2-plan-tampered.json"
ctl s2-tampered-plan "plan digest" -- S2 apply --plan "$OUT/s2-plan-tampered.json" --rehearsal --out "$OUT/ctl-s2e.json"
must s2-apply 0 -- S2 apply --plan "$OUT/s2-plan.json" --rehearsal --out "$OUT/s2-apply.json"
must s2-state 0 -- S2 state --plan "$OUT/s2-plan.json" --rehearsal --out "$OUT/s2-state.json"
grep -q "PLANNED RESULT PRESENT" "$OUT/s2-state.log" && note "PASS s2 state reports the planned result" || { FAILN=$((FAILN+1)); note "FAIL s2 state does not report the planned result"; }
note "fingerprint after S2: $(fp)"

# ---- S3 ----
must s3-plan 0 -- S3 plan --target "$T" --actor-user-id "$ACTOR" --rehearsal --out "$OUT/s3-plan.json"
ctl s3-nonviable-actor "actor" -- S3 plan --target "$T" --actor-user-id 999999 --rehearsal --out "$OUT/ctl-s3a.json"
tamper "$OUT/s3-plan.json" "$OUT/s3-plan-tampered.json"
ctl s3-tampered-plan "plan digest" -- S3 apply --plan "$OUT/s3-plan-tampered.json" --rehearsal --out "$OUT/ctl-s3b.json"
must s3-apply 0 -- S3 apply --plan "$OUT/s3-plan.json" --rehearsal --out "$OUT/s3-apply.json"
must s3-verify 0 -- S3 verify --plan "$OUT/s3-plan.json" --apply-record "$OUT/s3-apply.json" --out "$OUT/s3-verify.json"
must s3-state 0 -- S3 state --plan "$OUT/s3-plan.json" --rehearsal --out "$OUT/s3-state.json"
grep -q "PLANNED RESULT PRESENT" "$OUT/s3-state.log" && note "PASS s3 state reports the planned result" || { FAILN=$((FAILN+1)); note "FAIL s3 state does not report the planned result"; }
note "fingerprint after S3: $(fp)"

# ---- S4 ----
must s4-plan 0 -- S4 plan --target "$T" --rehearsal --out "$OUT/s4-plan.json"
tamper "$OUT/s4-plan.json" "$OUT/s4-plan-tampered.json"
ctl s4-tampered-plan "plan digest" -- S4 apply --plan "$OUT/s4-plan-tampered.json" --rehearsal --out "$OUT/ctl-s4a.json"
ctl s4-clone-without-rehearsal "rehears" -- S4 plan --target "$T" --out "$OUT/ctl-s4b.json"
must s4-apply 0 -- S4 apply --plan "$OUT/s4-plan.json" --rehearsal --out "$OUT/s4-apply.json"
must s4-state 0 -- S4 state --plan "$OUT/s4-plan.json" --rehearsal --out "$OUT/s4-state.json"
grep -q "PLANNED RESULT PRESENT" "$OUT/s4-state.log" && note "PASS s4 state reports the planned result" || { FAILN=$((FAILN+1)); note "FAIL s4 state does not report the planned result"; }
note "fingerprint after S4 (end of chain): $(fp)"

note "CHAIN RESULT: $PASS passed, $FAILN failed"
[ "$FAILN" = 0 ]
