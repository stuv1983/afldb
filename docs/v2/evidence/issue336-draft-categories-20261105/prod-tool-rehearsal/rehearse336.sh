#!/usr/bin/env bash
# AFLDB-ISSUE-336: rehearse the guarded production insert tool on a fresh copy of the 4 Nov production restore (isolated cluster only).
set -u -o pipefail
W=/mnt/ssd/afldb/workspaces/i336-draft-20261105; EV=$W/evidence/i336-prod-rehearsal; CAND=$W/cand
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH" AFLDB_V2_PG_ROOT=$W/pg-root AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55498
mkdir -p "$EV"; exec > >(tee -a "$EV/rehearsal.log") 2>&1
strip() { sed 's/\x1b\[[0-9;]*m//g' | grep -vi 'postgres://'; }
step() { echo; echo "=== $(date -u +%FT%TZ) $*"; }
cd "$CAND" || exit 1
step checkout
git fetch -q "$W/in/i336.bundle" "HEAD:refs/heads/i336-review" || { echo FETCH-FAIL; exit 1; }
git checkout -q --detach i336-review || { echo CHECKOUT-FAIL; exit 1; }
[ "$(git rev-parse HEAD^{tree})" = "$R" ] || { echo "TREE-MISMATCH $(git rev-parse HEAD^{tree})"; exit 1; }
git diff --quiet && git diff --cached --quiet && echo "clean HEAD $(git rev-parse --short HEAD) tree ok"
IR="node --import tsx tools/v2/isolated-pg.ts"
$IR start 2>&1 | tail -1
DB=afldb_v2_i336rehe_test
$IR drop-db $DB --acknowledge-destroy $DB 2>&1 | tail -1
$IR create-db $DB --template afldb_v2_i336tmpl_test 2>&1 | tail -1
T="node --import tsx --conditions=react-server tools/v2/issue336-predraft-insert-production.ts"
RUN() { $IR run $DB -- bash -c "export AFLDB_GAP029_DSN=\"\$AFLDB_TEST_DATABASE_URL\" AFLDB_GAP029_WRITE_DSN=\"\$AFLDB_TEST_IMPORT_DATABASE_URL\"; $*" 2>&1 | strip | grep -v '^isolated-pg:'; return "${PIPESTATUS[0]}"; }

step "describe (read-only)"; RUN "$T describe --out $EV/target.json"; echo "rc=$?"
step "viable actor"; A=$(cp "$W/in/find-actor.mjs" .i336-actor.mjs; RUN "node .i336-actor.mjs" | grep -oE '"viable":\[[0-9,]*\]' | grep -oE '[0-9]+' | head -1); echo "actor=$A"
rm -f .i336-actor.mjs
[ -n "$A" ] || { echo NO-ACTOR; exit 1; }
step "NEGATIVE production-mode plan on the isolated clone"; RUN "$T plan --target $EV/target.json --actor-user-id $A --out $EV/neg-prod-plan.json"; echo "rc=$? (expect 1)"
step "baseline (read-only)"; RUN "$T baseline --target $EV/target.json --out $EV/baseline.json"; echo "rc=$?"
step "plan --rehearsal"; RUN "$T plan --target $EV/target.json --actor-user-id $A --rehearsal --out $EV/plan.json"; echo "rc=$?"
step "NEGATIVE non-viable actor"; RUN "$T plan --target $EV/target.json --actor-user-id 999999 --rehearsal --out $EV/plan-bad-actor.json" >/dev/null
RUN "$T apply --plan $EV/plan-bad-actor.json --rehearsal --out $EV/apply-bad-actor.json"; echo "rc=$? (expect 1, nothing written)"
step "state before"; RUN "$T state --plan $EV/plan.json --out $EV/state-before.json"; echo "rc=$?"
step "apply --rehearsal"; RUN "$T apply --plan $EV/plan.json --rehearsal --out $EV/apply.json"; echo "rc=$? (expect 0)"
step "verify (read-only)"; RUN "$T verify --plan $EV/plan.json --apply-record $EV/apply.json --out $EV/verify.json"; echo "rc=$?"
step "state after"; RUN "$T state --plan $EV/plan.json --out $EV/state-after.json"; echo "rc=$?"
step "NEGATIVE replay of the applied plan"; RUN "$T apply --plan $EV/plan.json --rehearsal --out $EV/apply-replay.json"; echo "rc=$? (expect 1, baseline drift)"
step "audit and seal facts (read-only)"
RUN "node --input-type=module -e \"import postgres from 'postgres'; const s=postgres(process.env.AFLDB_TEST_DATABASE_URL,{max:1,onnotice:()=>{}}); const r=await s\\\`SELECT count(*)::int AS audit_rows, count(DISTINCT row_id)::int AS picks, min(admin_user_id)::int AS actor FROM data_edits WHERE table_name='draft_picks' AND field_group='source_insert' AND note LIKE 'AFLDB-ISSUE-336 owner-approved correction%'\\\`; const p=await s\\\`SELECT count(*)::int AS n, count(*) FILTER (WHERE signing_kind='Intl Schol')::int AS intl, count(*) FILTER (WHERE player_id IS NOT NULL)::int AS linked, count(*) FILTER (WHERE club_id IS NULL)::int AS null_club FROM draft_picks WHERE confidence_notes LIKE 'AFLDB-ISSUE-336 bounded insert%'\\\`; console.log(JSON.stringify({audit:r[0],picks:p[0]})); await s.end();\""
node -e "const a=require('$EV/apply.json'); const c=a.created||[]; const b={}; for (const x of c) b[x.seal]=(b[x.seal]||0)+1; console.log(JSON.stringify({outcome:a.outcome, written:a.written, newPersons:a.newPersons, sealBasis:b}))"
step "export after"; cp "$W/in/export-draft.mjs" .i336-export.mjs; RUN "node .i336-export.mjs $EV/draft-export-after.json"; rm -f .i336-export.mjs; gzip -f "$EV/draft-export-after.json"; echo "rc=$?"
echo REHEARSE-DONE
