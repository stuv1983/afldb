#!/usr/bin/env bash
# AFLDB-ISSUE-350 rehearsal, INNER half. Runs inside `isolated-pg run <db> -- bash <this> <evidence-dir> [TimeZone]` from the checkout root,
# so the cluster's DSNs are already in the environment (never printed). The database is a fresh copy of the 2026-11-04 production snapshot,
# which is production's pre-opening state (no 2027 seasons row, 18 current clubs at last_season 2026).
#   $1  evidence directory (outside the checkout, created here)
#   $2  session TimeZone for the read helper (default Etc/UTC; the O-3 rehearsal passes Australia/Melbourne)
set -u -o pipefail
E="$1"; TZNAME="${2:-Etc/UTC}"
mkdir -p "$E"
HERE="docs/v2/evidence/remediation-20261114/rollover"
T="node --import tsx tools/v2/issue350-season-open-production.ts"
CHECK="node --import tsx tools/v2/season-opening-check.ts --dsn-env AFLDB_BACKUP_DATABASE_URL --json"
export AFLDB_GAP029_DSN="$AFLDB_BACKUP_DATABASE_URL" AFLDB_GAP029_WRITE_DSN="$AFLDB_IMPORT_DATABASE_URL"
say() { echo "== $*"; }
run() { local name="$1"; shift; say "$name"; "$@" > "$E/$name.out" 2> "$E/$name.err"; local rc=$?; echo "rc=$rc" | tee "$E/$name.rc"; sed -E 's#postgres(ql)?://[^ ]+#<dsn>#g' "$E/$name.out" "$E/$name.err" | head -40; return 0; }

say "BEFORE"
# FACTS_BUNDLE: prod-facts-entry.mts bundled by esbuild (the SAME artifact that read production and DEV); identity is recorded, not asserted
export FACTS_BUNDLE="${FACTS_BUNDLE:?FACTS_BUNDLE required}"
RV_DSN="$AFLDB_BACKUP_DATABASE_URL" node "$FACTS_BUNDLE" > "$E/facts-before.json" 2> "$E/facts-before.err"; echo "facts-before rc=$?"
run tz-proof-before node --import tsx "$HERE/tz-proof.mts" AFLDB_BACKUP_DATABASE_URL
node "$HERE/q-run.mjs" "$HERE/q-public-effects.sql" AFLDB_BACKUP_DATABASE_URL "$TZNAME" > "$E/public-before.txt"
run check-before $CHECK
run describe $T describe --out "$E/target.json"
run baseline $T baseline --target "$E/target.json" --out "$E/baseline.json"
run plan $T plan --target "$E/target.json" --rehearsal --out "$E/plan.json"
run apply $T apply --plan "$E/plan.json" --rehearsal --out "$E/apply.json"
run verify $T verify --plan "$E/plan.json" --apply-record "$E/apply.json" --out "$E/verify.json"
run state-after $T state --plan "$E/plan.json" --out "$E/state-after.json"
run check-after $CHECK
RV_DSN="$AFLDB_BACKUP_DATABASE_URL" node "$FACTS_BUNDLE" > "$E/facts-after.json" 2> "$E/facts-after.err"; echo "facts-after rc=$?"
run tz-proof-after node --import tsx "$HERE/tz-proof.mts" AFLDB_BACKUP_DATABASE_URL
node "$HERE/q-run.mjs" "$HERE/q-public-effects.sql" AFLDB_BACKUP_DATABASE_URL "$TZNAME" > "$E/public-after.txt"
say "PUBLIC EFFECT (diff before after)"
diff "$E/public-before.txt" "$E/public-after.txt" > "$E/public-diff.txt"; cat "$E/public-diff.txt"
say "SECOND APPLY (must be a no-op)"
run plan2 $T plan --target "$E/target.json" --rehearsal --out "$E/plan2.json"
run apply2 $T apply --plan "$E/plan2.json" --rehearsal --out "$E/apply2.json"
run check-after2 $CHECK
