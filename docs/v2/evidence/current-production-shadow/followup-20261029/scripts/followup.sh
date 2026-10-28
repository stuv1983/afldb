#!/bin/bash
# AFLDB V2 current-production shadow follow-up (D-V2-CURRENT-SHADOW-FOLLOWUP-1), streamanator only.
# Reuses the retained root of run 20261028T192336Z: the verified private c478c31b source (read only, S2 NOT
# repeated), the archive, and the stopped isolated cluster on 127.0.0.1:55467 with the retained baseline and
# migration databases. Writes only under $F (new) and inside the owned cluster (two NEW disposable clones).
# Retained databases: read-only transactions / pg_dump only. Original evidence ($E) and xfer/: read only.
# A guard failure stops (evidence kept, owned cluster stopped). An item failure is recorded and the next
# independent item still runs. The evidence manifest is taken afterwards by seal.sh, once outputs stop changing.
#   ssh arm@10.0.40.100 "nohup bash $F/scripts/followup.sh > $F/run.log 2>&1 &"
set -uo pipefail
export LC_ALL=C
umask 077
R=/home/arm/afldb-v2-currentshadow-20261028T192336Z
F=$R/followup; S=$F/scripts; O=$F/evidence; E=$R/evidence
LV=/home/arm/afldb-v2-linuxverify-20261028T0310Z
NODE=/home/arm/.nvm/versions/node/v22.23.2/bin/node
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
PGBIN=/usr/lib/postgresql/16/bin
PORT=55467
STAMP=20261028T192336Z
ARCHIVE=$R/archive/afldb_prod-$STAMP.dump; SIDECAR=$R/archive/afldb_prod-$STAMP.provenance.json
ARCHIVE_SHA=a4641ca0d1533c30d6670dfa9b555552548a91b736054e941adba75cee0c46fc
SIDECAR_SHA=72f000462a2e7560afee97edf5598723a2ccfa45c9664e7d57ce7b62dddb57d4
MANIFEST_SHA=ea197fcf40c1b27108bebb1cc9b0a6523e8d79804952f77610f5f4606ac8ac75
SHADOWLOG_FINAL_SHA=99b6e575e2c735caf41a0bb920b43cdb92a9518f29928490e3e7c1ffa4d745e8
INV_SHA=b64c8a75cb2def63702549b803d7f8aedcad6c27f64eb30f76d125763e5e056d
INV_TAR_SHA=42822c7590a05e4ff8dc2066d33fbee0d7bdbc48b626099c5603b363607dac42
LV_MANIFEST_SHA=a08b7f64192dc1efd7466c7b7d0d8fb87b9f551f4cf339ac623914670f40b958
BASE=afldb_v2_shadow_current_baseline_test
MIG=afldb_v2_shadow_current_migration_test
PROBE=afldb_v2_shadow_current_fuprobe_test
IT=afldb_v2_shadow_current_fuit_test
UNITS='tests/v2-brownlow-eligibility.test.ts tests/v2-brownlow-reconciliation.test.ts tests/v2-shadow-award-reports.test.ts tests/v2-shadow-parity.test.ts tests/v2-shadow-capture.test.ts tests/v2-shadow-target.test.ts'
declare -A PIN=(
  [111_curated_award_proposals.sql]=2ed29d9598742c74d0f9db6f7bac0bec8409733c1dace1d25356ad27edb91290
  [112_derived_award_results.sql]=e0aa0c7e6fd14b6885aaf43725309e82e2d9b362cf167fd57cca9b95cef401ac
  [113_brownlow_eligibility_decisions.sql]=79e7b9d1b839414962571ffff832b230e458273c24bd26d8474d259137ca9971
  [114_award_projections_and_curated_revisions.sql]=1c33324f9c7c616e998aa152fdd5fbdf20b2585694b3e6d62c2addb5f307f180
  [115_adjudication_supersession_fk_index.sql]=2f16efb9694f76f946543bbaca01785127b632417ad21ba1fc7b8745bb7c1852
  [116_brownlow_correction_receipts.sql]=c61953b71e1210b5389579342e155d367dfada5737bf3cd37f1a536b9ac61075
  [117_brownlow_provider_eligibility_unknown.sql]=a7dff2bddb1dd9c01ea0e69478193c5e5c50d8a531b2db448e7052b9f25e286f
)
STAGE=start; OWNED=0; EVIDENCE=0
step() { STAGE="$*"; echo "== $* $(date -u +%FT%TZ)"; }
die() { echo "STOP: $1"; exit "${2:-1}"; }
rc() { echo "EXIT $1 = $2" | tee -a "$O/exit-codes.txt"; }
# A guard: record and stop on failure.
req() { rc "$1" "$2"; [ "$2" = 0 ] || die "$1 failed (exit $2); evidence retained" "$3"; }
finish() {
  local x=$?
  trap - EXIT
  [ "$EVIDENCE" = 1 ] || exit "$x"
  if [ "$OWNED" = 1 ]; then OWNED=0; "${ISO[@]}" stop; rc cluster-stop-on-exit $?; fi
  if [ "$x" = 0 ]; then echo SUCCEEDED > "$O/followup.result"; else echo "FAILED exit=$x stage=$STAGE" > "$O/followup.result"; fi
  echo "process completed exit=$x $(date -u +%FT%TZ)" > "$O/followup.done"
  echo "followup result: $(cat "$O/followup.result")"
  exit "$x"
}

[ "$(hostname)" = streamanator ] && [ "$(whoami)" = arm ] || die "wrong host or user" 2
[ -d "$S" ] && [ ! -e "$O" ] || die "follow-up root state unexpected (scripts missing or evidence already exists)" 2
mkdir -m 700 "$O" || die "evidence directory" 2
EVIDENCE=1; trap finish EXIT
step "follow-up start host=$(hostname) user=$(whoami)"
( cd "$S" && sha256sum * ) | tee "$O/scripts.sha256"
cp "$S/SCRIPTS.SHA256" "$O/scripts.expected.sha256" 2>/dev/null
( cd "$S" && sha256sum --check --strict SCRIPTS.SHA256 ); req scripts-pinned $? 2

step "F0 identities and integrity (read only)"
printf '%s  %s\n%s  %s\n' "$ARCHIVE_SHA" "$ARCHIVE" "$SIDECAR_SHA" "$SIDECAR" | sha256sum --check --strict -; req archive-sidecar $? 3
( cd "$R/xfer" && sha256sum --check --strict SHA256SUMS ); req xfer $? 3
[ "$(sha256sum < "$E/evidence-sha256.txt" | cut -c1-64)" = "$MANIFEST_SHA" ]; req original-manifest-sha $? 3
# Re-verify the original evidence against its own manifest. The one known exception (live shadow.log hashed while
# tee was appending; documented review LOW) must be the ONLY failure, and the final shadow.log must hash as recorded.
( cd "$E" && sha256sum --check "$E/evidence-sha256.txt" ) > "$O/original-manifest-recheck.txt" 2>&1
FAILS=$(grep -v ': OK$' "$O/original-manifest-recheck.txt" | grep -v '^sha256sum: WARNING' | paste -sd'|')
echo "original manifest re-check non-OK lines: [$FAILS]"
[ "$FAILS" = './shadow.log: FAILED' ]; req original-manifest-only-known-exception $? 3
[ "$(sha256sum < "$E/shadow.log" | cut -c1-64)" = "$SHADOWLOG_FINAL_SHA" ]; req shadow-log-final-sha $? 3
[ "$(cat "$E/shadow.result")" = SUCCEEDED ] && grep -q '^process completed exit=0 ' "$E/shadow.done"; req original-run-succeeded $? 3
for f in "${!PIN[@]}"; do printf '%s  %s\n' "${PIN[$f]}" "$R/src/src/db/migrations/$f"; done | sort -k2 | sha256sum --check --strict - | tee "$O/migrations-111-117.check"
req migrations-pinned "${PIPESTATUS[2]}" 3
[ "$(ls "$R/src/src/db/migrations" | grep -cE '^1(1[8-9]|[2-9][0-9])_')" = 0 ]; req no-migration-after-117 $? 3
test ! -e "$R/src/.env"; req no-dotenv $? 3
# The private source is reused read only: every non-node_modules file must still equal the S2 manifest.
( cd "$R/src" && find . -path ./node_modules -prune -o -type f -print0 | sort -z | xargs -0 sha256sum ) > "$O/src-rehash.sha256"; req src-rehash $? 3
cmp -s <(sort -k2 "$E/src.files.sha256") <(sort -k2 "$O/src-rehash.sha256"); req src-unchanged-since-S2 $? 3
"$NODE" --version > "$O/node-version.txt"; sha256sum "$NODE" >> "$O/node-version.txt"; "$PGBIN/postgres" --version > "$O/pg-version.txt"; uname -a > "$O/linux-version.txt"
df -B1 --output=avail /home/arm | tail -1 | tr -d ' ' > "$O/space-before.txt"; echo "free bytes at start: $(cat "$O/space-before.txt")"
du -sb "$R/cluster" | tee "$O/cluster-bytes-before.txt"

step "F1 item 3: the S2 source-manifest additions against the approved input inventory (files only)"
{ sha256sum "$LV/xfer/inputs.sha256" "$LV/xfer/inputs.tar" "$LV/evidence/src-c478c31b.files.sha256" "$LV/evidence/setup.log" "$LV/xfer/setup.sh"
  echo "-- setup.sh order (manifest taken, then inputs extracted into the same src):"
  grep -nE 'src-c478c31b\.files\.sha256"$|tar -xf "\$X/inputs\.tar"|sha256sum --quiet -c "\$X/inputs\.sha256"' "$LV/xfer/setup.sh"
  echo "-- setup.log:"; grep -nE '^src manifest:|^== inputs|^inputs OK' "$LV/evidence/setup.log"
  echo "-- shadow-restore.sh S2 SRC_FROM/SRC_MANIFEST:"; grep -nE '^SRC_(FROM|MANIFEST)=' "$R/shadow-restore.sh"
} > "$O/inventory-origin.txt" 2>&1; cat "$O/inventory-origin.txt"
[ "$(sha256sum < "$LV/xfer/inputs.sha256" | cut -c1-64)" = "$INV_SHA" ] && [ "$(sha256sum < "$LV/xfer/inputs.tar" | cut -c1-64)" = "$INV_TAR_SHA" ] \
  && [ "$(sha256sum < "$LV/evidence/src-c478c31b.files.sha256" | cut -c1-64)" = "$LV_MANIFEST_SHA" ]; X=$?; rc inventory-pins $X
if [ "$X" = 0 ]; then
  tar -tf "$LV/xfer/inputs.tar" | sort > "$O/inputs-tar.list"; rc inputs-tar-list $?
  "$NODE" "$S/inventory-compare.mjs" "$E/src-vs-c478c31b-manifest.diff" "$E/src.files.sha256" "$LV/xfer/inputs.sha256" \
    "$LV/evidence/src-c478c31b.files.sha256" "$O/src-rehash.sha256" "$O/inventory-comparison.json"; rc inventory-compare $?
  cmp -s <(awk '{print $2}' "$LV/xfer/inputs.sha256" | sed 's/^\*//' | sort) "$O/inputs-tar.list"; rc inventory-equals-tar-members $?
else
  echo "ITEM 3 BLOCKED: an inventory input does not match its recorded hash"
fi

step "F2 item 6a: focused unit checks (no database; generic functional tests, not archive measurements)"
cd "$R/src" || die "src" 4
for k in $(env | grep -oE '^(PG[A-Z_]*|[A-Z_]*DATABASE_URL[A-Z_]*|AFLDB_[A-Z_]*)=' | tr -d =); do unset "$k"; done
export NEXT_TELEMETRY_DISABLED=1
# shellcheck disable=SC2086
"$NODE" node_modules/vitest/vitest.mjs run --no-cache $UNITS --reporter=json --outputFile="$O/unit-focused.json" > "$O/unit-focused.stdout.log" 2> "$O/unit-focused.stderr.log"
rc unit-focused $?

step "F3 restart ONLY the owned cluster on 127.0.0.1:$PORT"
export AFLDB_V2_PG_ROOT="$R/cluster" AFLDB_V2_PG_BIN=$PGBIN AFLDB_V2_PG_PORT=$PORT
ISO=("$NODE" --import tsx tools/v2/isolated-pg.ts)
test ! -e "$R/cluster/data/postmaster.pid"; req no-postmaster-pid $? 4
test ! -e "$R/cluster/secrets/CREDENTIALS-EXPOSED"; req credentials-not-exposed $? 4
ss -H -ltnp "( sport = :$PORT )" | grep -q . && die "port $PORT in use" 4
"${ISO[@]}" start; req cluster-start $? 4
LINE=$(ss -H -ltnp "( sport = :$PORT )"); P=$(echo "$LINE" | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)
[ -n "$P" ] && tr '\0' ' ' < "/proc/$P/cmdline" | grep -q -- "$R/cluster" || die "$PORT not served by this root" 4
OWNED=1
echo "listener $(echo "$LINE" | awk '{print $4}') pid $P exe $(readlink "/proc/$P/exe") data $(tr '\0' ' ' < "/proc/$P/cmdline" | grep -oE -- "-D [^ ]+")" | tee "$O/listener.txt"
[ "$(echo "$LINE" | awk '{print $4}')" = "127.0.0.1:$PORT" ]; req listener-loopback-only $? 4
"${ISO[@]}" list | tee "$O/databases-at-start.txt"; req list $? 4
"${ISO[@]}" verify "$BASE" > "$O/verify-baseline.txt" 2>&1; req verify-baseline $? 4
"${ISO[@]}" verify "$MIG" > "$O/verify-migration.txt" 2>&1; req verify-migration $? 4
on() { local db=$1; shift; "${ISO[@]}" run "$db" -- "$@"; }

step "F4 items 4a/5: read-only measurements on the RETAINED databases"
cat > "$O/db-size.mjs" <<'JS'
import postgres from 'postgres';
const sql = postgres(process.env.AFLDB_OWNER_DATABASE_URL, { max: 1, onnotice: () => {}, connection: { default_transaction_read_only: true } });
try { const [r] = await sql`SELECT current_database() AS db, pg_database_size(current_database())::bigint AS bytes, current_setting('transaction_read_only') AS ro`;
  console.log(JSON.stringify(r)); } finally { await sql.end(); }
JS
on "$MIG" "$NODE" --input-type=module - < "$O/db-size.mjs" | tee "$O/db-size.migration.json"; req db-size-migration "${PIPESTATUS[0]}" 5
on "$BASE" "$NODE" --input-type=module - < "$O/db-size.mjs" | tee "$O/db-size.baseline.json"; req db-size-baseline "${PIPESTATUS[0]}" 5
on "$MIG" "$NODE" --input-type=module - "$MIG" "$R/src/src/db/migrations" "$O/receipt-catalog.migration.json" < "$S/receipt-catalog.mjs"; rc receipt-catalog-migration $?
on "$BASE" "$NODE" --input-type=module - "$BASE" "$R/src/src/db/migrations" "$O/receipt-catalog.baseline.json" < "$S/receipt-catalog.mjs"; rc receipt-catalog-baseline $?
on "$BASE" "$NODE" --import tsx --conditions=react-server "$S/brownlow-stored.mts" "$ARCHIVE_SHA" "$O/brownlow-stored.baseline.json" "$O/brownlow-stored.baseline.meta.json"; rc brownlow-stored-baseline $?
on "$MIG" "$NODE" --import tsx --conditions=react-server "$S/brownlow-stored.mts" "$ARCHIVE_SHA" "$O/brownlow-stored.migration.json" "$O/brownlow-stored.migration.meta.json"; rc brownlow-stored-migration $?
cmp "$O/brownlow-stored.baseline.json" "$O/brownlow-stored.migration.json"; rc brownlow-stored-byte-identical $?
dump_now() { on "$1" /usr/bin/env AFLDB_V2_PG_BIN="$PGBIN" "$NODE" "$E/schema-dump.mjs" "$2"; }
same_schema() { cmp -s <(grep -vE '^\\(un)?restrict ' "$1") <(grep -vE '^\\(un)?restrict ' "$2"); }
dump_now "$BASE" "$O/start.baseline.schema.sql"; rc start-schema-baseline $?
dump_now "$MIG" "$O/start.migration.schema.sql"; rc start-schema-migration $?
same_schema "$E/before.schema.sql" "$O/start.baseline.schema.sql"; rc baseline-schema-equals-run-before $?
same_schema "$E/postmig.schema.sql" "$O/start.migration.schema.sql"; rc migration-schema-equals-run-after $?

step "F5 item 4c: normalised schema sections (files only; the archive is read, not restored)"
"$PGBIN/pg_restore" --schema-only --no-owner -f "$O/archive.schema.sql" "$ARCHIVE"; rc archive-schema-text $?
"$NODE" "$S/schema-sections.mjs" "$O/archive.schema.sql" "$E/before.schema.sql" "$E/postmig.schema.sql" "$R/src/src/db/migrations" "$O/schema-sections.json"; rc schema-sections $?

step "F6 item 7 (bounded): aggregate drift against the committed 7fefcd9b figures"
if [ -s "$O/brownlow-stored.baseline.meta.json" ]; then
  "$NODE" "$S/drift-summary.mjs" "$E/before.preservation.json" "$O/brownlow-stored.baseline.meta.json" "$O/drift-summary.json"; rc drift-summary $?
else echo "drift summary skipped: no stored-report meta"; rc drift-summary skipped; fi

step "F7 space budget for the NEW disposable clones"
MB=$("$NODE" -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).bytes))' "$O/db-size.migration.json")
AV=$(df -B1 --output=avail /home/arm | tail -1 | tr -d ' ')
# Two clones of the migration copy, plus one clone's worth of transient WAL (CREATE DATABASE WAL_LOG), plus 1 GiB for
# fixtures and evidence; at least 2 GiB must remain free afterwards. Nothing retained is removed to make room.
NEED=$(( 3 * MB + 1073741824 )); FLOOR=2147483648
echo "migration copy $MB bytes; free $AV; budget $NEED; floor $FLOOR" | tee "$O/space-budget.txt"
CLONES=0; [ "$AV" -ge $(( NEED + FLOOR )) ] && CLONES=1; rc clone-budget-ok $(( 1 - CLONES ))

if [ "$CLONES" = 1 ]; then
  step "F8 item 4b: receipt actual-role probe on a NEW disposable clone"
  "${ISO[@]}" create-db "$PROBE" --template "$MIG"; X=$?; rc create-probe-clone $X
  if [ "$X" = 0 ]; then
    "${ISO[@]}" verify "$PROBE" > "$O/verify-probe.txt" 2>&1; rc verify-probe $?
    on "$PROBE" "$NODE" --input-type=module - "$PROBE" "$O/receipt-mutation.json" < "$S/receipt-mutation.mjs"; rc receipt-mutation $?
  fi
  step "F9 item 6b: focused integration checks on a NEW disposable clone (fixture writes)"
  "${ISO[@]}" create-db "$IT" --template "$MIG"; X=$?; rc create-it-clone $X
  if [ "$X" = 0 ]; then
    "${ISO[@]}" verify "$IT" > "$O/verify-it.txt" 2>&1; rc verify-it $?
    for t in privileges v2-brownlow-eligibility; do
      on "$IT" "$NODE" node_modules/vitest/vitest.mjs run --no-cache "tests/integration/$t.test.ts" --reporter=json \
        --outputFile="$O/it-$t.json" > "$O/it-$t.stdout.log" 2> "$O/it-$t.stderr.log"; rc "it-$t" $?
    done
  fi
  "${ISO[@]}" list | tee "$O/databases-with-clones.txt"
  df -B1 --output=avail /home/arm | tail -1 | tr -d ' ' > "$O/space-with-clones.txt"
  for c in "$PROBE" "$IT"; do
    if grep -q "$c" "$O/databases-with-clones.txt"; then "${ISO[@]}" drop-db "$c" --acknowledge-destroy "$c"; rc "drop-disposable-$c" $?; fi
  done
else
  echo "ITEMS 4b/6b BLOCKED: space budget not met; nothing retained was removed"
fi

step "F10 the retained databases are unchanged after every item"
dump_now "$BASE" "$O/end.baseline.schema.sql"; rc end-schema-baseline $?
dump_now "$MIG" "$O/end.migration.schema.sql"; rc end-schema-migration $?
same_schema "$E/before.schema.sql" "$O/end.baseline.schema.sql"; rc end-baseline-schema-equals-run-before $?
same_schema "$E/postmig.schema.sql" "$O/end.migration.schema.sql"; rc end-migration-schema-equals-run-after $?
on "$MIG" "$NODE" --input-type=module - "$MIG" "$R/src/src/db/migrations" "$O/receipt-catalog.migration.end.json" < "$S/receipt-catalog.mjs"; rc receipt-catalog-migration-end $?
"${ISO[@]}" list | tee "$O/databases-at-end.txt"

step "F11 stop the owned cluster; integrity re-checks"
OWNED=0; "${ISO[@]}" stop; req cluster-stop $? 8
ss -H -ltn "( sport = :$PORT )" | grep -q . && die "$PORT still listening after stop" 8
echo "$PORT free"
printf '%s  %s\n%s  %s\n' "$ARCHIVE_SHA" "$ARCHIVE" "$SIDECAR_SHA" "$SIDECAR" | sha256sum --check --strict -; req archive-recheck $? 8
( cd "$R/xfer" && sha256sum --check --strict SHA256SUMS ); req xfer-recheck $? 8
[ "$(sha256sum < "$E/evidence-sha256.txt" | cut -c1-64)" = "$MANIFEST_SHA" ]; req original-manifest-unchanged $? 8
df -B1 --output=avail /home/arm | tail -1 | tr -d ' ' > "$O/space-after.txt"; du -sb "$R/cluster" > "$O/cluster-bytes-after.txt"
echo "free bytes at end: $(cat "$O/space-after.txt")"
step "follow-up runner done (manifest is taken by seal.sh)"
