#!/usr/bin/env bash
# Final qualification for the auth scope, run inside one heavy-lock acquisition.
set -u
W=/mnt/ssd/afldb-rem-auth-20261114
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
cd "$W/cand"
O=$W/evidence-raw/final
mkdir -p "$O"
{
  echo "HEAD=$(git rev-parse HEAD)"
  echo "branch=$(git rev-parse --abbrev-ref HEAD)"
  echo "status-porcelain-lines-before=$(git status --porcelain | wc -l)"
} > "$O/00-checkout.txt"

echo "== typecheck (next typegen && tsc --noEmit)" > "$O/10-typecheck.txt"
( npx next typegen && npx tsc --noEmit ) >> "$O/10-typecheck.txt" 2>&1
echo "exit=$?" >> "$O/10-typecheck.txt"

# Vitest, unit scope: everything the changed sources and files touch.
FILES="tests/auth.test.ts tests/settle-season-revalidation.test.ts tests/workflow-preflight.test.ts tests/beta-verify.test.ts \
tests/unit/sorting.test.ts tests/nl-answer-feedback-boundary.test.ts tests/nl-feedback.test.ts tests/deploy-release.test.ts \
tests/admin-access-actions.test.ts tests/admin-audit-viewer.test.ts tests/admin-brownlow-actions.test.ts \
tests/admin-current-season-settle.test.ts tests/admin-lifecycle-actions.test.ts tests/admin-nl-search-actions.test.ts \
tests/admin-settings-actions.test.ts tests/admin-upload-route.test.ts tests/awards-replace-panel.test.ts \
tests/email-intake-route.test.ts tests/health-event-route.test.ts tests/player-link-mutations.test.ts \
tests/player-links-page.test.ts tests/search-rate-limit.test.ts tests/submission-review-actions.test.ts \
tests/v2-admin-operations-ui.test.ts tests/v2-admin-operations.test.ts tests/v2-shadow-award-reports.test.ts"
echo "== vitest" > "$O/20-vitest.txt"
npx vitest run $FILES >> "$O/20-vitest.txt" 2>&1
echo "exit=$?" >> "$O/20-vitest.txt"

echo "== lint gate (must pass at the baseline)" > "$O/30-lint-gate.txt"
( time npx tsx tools/dev/lint-gate.ts ) >> "$O/30-lint-gate.txt" 2>&1
echo "exit=$?" >> "$O/30-lint-gate.txt"

# Red demonstration: one new `any` in src must fail the gate; then restore.
echo "== lint gate with a deliberate new error (must fail)" > "$O/31-lint-gate-red.txt"
printf '\nexport const lintGateProbe: any = 1;\n' >> src/lib/sorting.ts
( npx tsx tools/dev/lint-gate.ts ) >> "$O/31-lint-gate-red.txt" 2>&1
echo "exit=$?" >> "$O/31-lint-gate-red.txt"
git checkout -q -- src/lib/sorting.ts

{
  echo "HEAD=$(git rev-parse HEAD)"
  echo "status-porcelain-lines-after=$(git status --porcelain | wc -l)"
  git status --porcelain | head
} > "$O/90-checkout-after.txt"
echo DONE > "$O/done.flag"
