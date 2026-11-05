#!/usr/bin/env bash
# AFLDB-ISSUE-336 qualification on streamanator: isolated cluster on 55498, databases afldb_v2_i336*_test only.
set -u -o pipefail
: "${W:?}" "${BASE:?}" "${R:?}" "${PLAN_SHA:?}"
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export AFLDB_V2_PG_ROOT="$W/pg-root" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55498
EV="$W/evidence"; CAND="$W/cand"; SUM="$EV/QUAL-SUMMARY.txt"
say() { echo "$(date -u +%FT%TZ) $*" | tee -a "$EV/qual.log"; }
phase() { local n="$1"; shift; say "PHASE $n: start"; "$@" > "$EV/q-$n.log" 2>&1; local rc=$?; if [ $rc -eq 0 ]; then say "PHASE $n: PASS"; echo "PASS $n" >> "$SUM"; else say "PHASE $n: FAIL rc=$rc"; echo "FAIL $n rc=$rc" >> "$SUM"; fi; return $rc; }
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
RUNDB() { local db="$1"; shift; (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- "$@"); }
VT() { node node_modules/vitest/vitest.mjs run "$@"; }
strip() { sed 's/\x1b\[[0-9;]*m//g' | grep -vi 'postgres://'; }

q1_cand() {
  rm -rf "$CAND" && mkdir -p "$CAND" && (cd "$W/i336c" && tar cf - --exclude=./node_modules .) | (cd "$CAND" && tar xf -) || return 1
  cp -al "$W/i336c/node_modules" "$CAND/node_modules"
  cd "$CAND" && [ "$(git rev-parse HEAD)" = "$BASE" ] || { echo "base mismatch"; return 1; }
  git -c user.name=qual -c user.email=qual@localhost am -q "$W/in/i336.patch" || return 1
  echo "HEAD tree $(git rev-parse HEAD^{tree}) expected $R"; [ "$(git rev-parse HEAD^{tree})" = "$R" ] || return 1
  git diff --stat "$BASE" HEAD | tail -14
}
q2_typecheck() { cd "$CAND" && node node_modules/next/dist/bin/next typegen >/dev/null && node node_modules/typescript/bin/tsc --noEmit -p . && echo "tsc exit 0"; }
q3_unit() { cd "$CAND" && VT tests/catalogue-lookups.test.ts tests/coach-profile-route.test.ts tests/draftguru-acquisition.test.ts tests/grid-solver-spec.test.ts 2>&1 | strip | grep -E "✓|×|Test Files|Tests " | tail -12; return ${PIPESTATUS[0]}; }
q4_red() {
  cd "$CAND" && git show "$BASE:src/db/queries/draft.ts" > src/db/queries/draft.ts
  VT tests/catalogue-lookups.test.ts --reporter=verbose > "$EV/red-unit.log" 2>&1; local rc=$?
  git checkout -- src/db/queries/draft.ts; [ "$(git status --porcelain | grep -v '^??' | wc -l)" = 0 ] || { echo "tree not restored"; return 1; }
  strip < "$EV/red-unit.log" | grep -E "^ +(✓|×)|Tests " | head -30
  echo "red rc=$rc (expected non-zero)"; [ $rc -ne 0 ]
}
q5_db() {
  IR drop-db afldb_v2_i336app_test --acknowledge-destroy afldb_v2_i336app_test 2>/dev/null
  IR create-db afldb_v2_i336app_test --template afldb_v2_i336tmpl_test || return 1
  cp "$CAND/tools/v2/issue336-predraft-insert.ts" "$CAND/.i336-w.ts"
  P="$CAND/docs/v2/evidence/issue336-draft-categories-20261105/predraft-insert-plan.json"
  echo "=== refusal without the D-336-1 decision"; RUNDB afldb_v2_i336app_test node --import tsx tools/v2/issue336-predraft-insert.ts "$P" --plan-sha256 "$PLAN_SHA" 2>&1 | strip | tail -3; [ "${PIPESTATUS[0]}" -ne 0 ] && echo "refused as expected (non-zero exit)"
  echo "=== dry run"; RUNDB afldb_v2_i336app_test node --import tsx tools/v2/issue336-predraft-insert.ts "$P" --plan-sha256 "$PLAN_SHA" --accept-signing-head "Intl Schol" 2>&1 | strip | tail -40
  echo "=== apply"; RUNDB afldb_v2_i336app_test node --import tsx tools/v2/issue336-predraft-insert.ts "$P" --plan-sha256 "$PLAN_SHA" --accept-signing-head "Intl Schol" --apply 2>&1 | strip | grep -E '"checks"|_unchanged|new_p|newP|COMMITTED|ROLLED|rror'
  echo "=== re-run refuses (key already stored)"; RUNDB afldb_v2_i336app_test node --import tsx tools/v2/issue336-predraft-insert.ts "$P" --plan-sha256 "$PLAN_SHA" --accept-signing-head "Intl Schol" --apply 2>&1 | strip | tail -2
  rm -f "$CAND/.i336-w.ts"
  cp "$W/in/export-draft.mjs" "$CAND/.i336-export.mjs"; RUNDB afldb_v2_i336app_test node .i336-export.mjs "$EV/draft-export-after.json" | strip; rm -f "$CAND/.i336-export.mjs"; gzip -kf "$EV/draft-export-after.json"
}
q6_build() { cd "$CAND" && RUNDB afldb_v2_i336app_test env NODE_ENV=production npm run build 2>&1 | strip | tail -25; }
q7_start() {
  cd "$CAND" && (RUNDB afldb_v2_i336app_test env NODE_ENV=production AFLDB_BETA_GATE=off node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 33360 > "$EV/app.log" 2>&1 < /dev/null &) ; sleep 12
  curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:33360/draft/2025
}
PH="${*:-q1_cand q2_typecheck q3_unit q4_red q5_db q6_build q7_start}"
for ph in $PH; do phase "$ph" "$ph" || { case "$ph" in q1_cand|q5_db|q6_build) say "stopping after $ph"; break;; esac; }; done
say DONE; cat "$SUM"
