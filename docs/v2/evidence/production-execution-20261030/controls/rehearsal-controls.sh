#!/bin/bash
# AFLDB V2 release preparation: positive and negative controls for P-1 and P-3 (D-V2-PROD-EXEC-1 package P-3/P-4).
# Runs on streamanator after `isolated-rehearsal.sh rehearse` on the same root, against that root's running
# isolated cluster only. Every control clone is a NEW disposable afldb_v2_*_test database created from a
# rehearsal clone and dropped after its check; REF0, A, AM and B are never modified. Writes under $R/controls.
#   bash rehearsal-controls.sh <STAMP> <prev_src_tar_sha256> <host_session_sh_sha256> <v2_bundle_sha256>
# Needs in $R/controls: this file, host-session.sh (the exact approved copy, bound by its hash),
# src-ff100dc2.tar (git archive of PREV) and v2-9ed9c9dd.bundle (git bundle of main at the locked commit).
# Each control states its expected verdict; controls.result is PASS only if every control met it.
set -uo pipefail
export LC_ALL=C
umask 077
STAMP=${1:-}; PREV_SHA=${2:-}; HS_SHA=${3:-}; BUNDLE_SHA=${4:-}
[[ "$STAMP" =~ ^[0-9]{8}T[0-9]{6}Z$ && "$PREV_SHA$HS_SHA$BUNDLE_SHA" =~ ^[0-9a-f]{192}$ ]] \
  || { echo "usage: rehearsal-controls.sh <STAMP> <prev_tar_sha> <host_session_sha> <bundle_sha>"; exit 2; }
REVIEWED=9ed9c9dd3e84682c43e96c46e98974b245eb54ed
R=/home/arm/afldb-v2-prodexec-$STAMP; P=$R/pinned; E=$R/evidence; K=$R/controls; O=$K/out
PORT=55491; PGBIN=/usr/lib/postgresql/16/bin
NODE=/home/arm/.nvm/versions/node/v22.23.2/bin/node
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
A=afldb_v2_shadow_pxfrozen_test; AM=afldb_v2_shadow_pxfrozenmig_test; B=afldb_v2_shadow_permw_test; REF0=afldb_v2_shadow_pxref_test
X=afldb_v2_shadow_pxctl_test
[ "$(hostname)" = streamanator ] && [ -d "$K" ] && [ ! -e "$O" ] || { echo "STOP: host or controls state"; exit 2; }
case "$(cat "$E/rehearse.result" 2>/dev/null)" in PASS*) ;; *) echo "STOP: the rehearsal has not passed"; exit 2;; esac
[ "$(sha256sum < "$K/host-session.sh" | cut -c1-64)" = "$HS_SHA" ] || { echo "STOP: host-session.sh is not the approved copy"; exit 2; }
[ "$(sha256sum < "$K/src-ff100dc2.tar" | cut -c1-64)" = "$PREV_SHA" ] || { echo "STOP: PREV tar hash"; exit 2; }
[ "$(sha256sum < "$K/v2-9ed9c9dd.bundle" | cut -c1-64)" = "$BUNDLE_SHA" ] || { echo "STOP: bundle hash"; exit 2; }
mkdir -m 700 "$O"
exec > >(tee -a "$O/controls.log") 2>&1
cd "$R/src" || exit 2
for k in $(env | grep -oE '^(PG[A-Z_]*|[A-Z_]*DATABASE_URL[A-Z_]*|AFLDB_[A-Z_]*)=' | tr -d =); do unset "$k"; done
export AFLDB_V2_PG_ROOT="$R/cluster" AFLDB_V2_PG_BIN=$PGBIN AFLDB_V2_PG_PORT=$PORT NEXT_TELEMETRY_DISABLED=1
ISO=("$NODE" --import tsx "$R/src/tools/v2/isolated-pg.ts")
# Superuser psql for the ownership control and cluster facts only; the password stays in this child's environment.
super() { PGPASSWORD="$(cat "$R/cluster/secrets/superuser.pw")" PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=afldb_v2_super "$PGBIN/psql" -X -q -At -v ON_ERROR_STOP=1 "$@"; }
on() { local db=$1; shift; "${ISO[@]}" run "$db" -- "$@"; }
sqlx() { on "$1" /usr/bin/env AFLDB_V2_PG_BIN="$PGBIN" "$NODE" "$P/psql-owner.mjs" -At "${@:2}"; }
FAILS=0
expect() {  # expect <control> <observed> <expected...>
  local name=$1 got=$2; shift 2
  if [[ " $* " == *" $got "* ]]; then echo "CONTROL $name: PASS (got $got, expected $*)" | tee -a "$O/controls.txt"
  else echo "CONTROL $name: FAIL (got $got, expected $*)" | tee -a "$O/controls.txt"; FAILS=$((FAILS + 1)); fi
}
# A control whose setup did not apply proves nothing: any failed setup statement aborts the whole run (no
# verdict is recorded for it). A setup that applies but changes nothing cannot pass either, because every
# expected verdict below needs the change to be visible.
setup() { sqlx "$@" > /dev/null || { echo "STOP: control setup failed on $1 (exit $?)"; exit 1; }; }
verdict() { "$NODE" -e 'try{process.stdout.write(String(require(process.argv[1])[process.argv[2]]))}catch{process.stdout.write("none")}' "$1" "$2"; }
# yes when the gate report holds a stop for exactly this subject (an expected STOP for another reason proves nothing)
stopped() { "$NODE" -e 'try{const r=require(process.argv[1]);process.stdout.write(r.stops.some(s=>s.subject===process.argv[2])?"yes":"no")}catch{process.stdout.write("none")}' "$1" "$2"; }
# a file-level mutation that leaves the file unchanged is a harness defect, never a verdict
mutated() { cmp -s "$1" "$2" && { echo "STOP: control mutation of $2 changed nothing"; exit 1; }; :; }
# room <GiB>: the host keeps at least this much free before a stage that writes large files, or the run stops
# (bytes, not `df -B1G`, which rounds up: run 1 passed `room 6` with less than 6 GiB free)
room() { local a; a=$(df -B1 --output=avail /home/arm | tail -1 | tr -d ' '); echo "disk: $((a / 1048576)) MiB free (need $1 GiB) $(date -u +%T)"
  [ "$a" -ge $(( $1 * 1073741824 )) ] || { echo "STOP: disk below $1 GiB before the next stage"; exit 1; }; }
clone() { "${ISO[@]}" create-db "$X" --template "$1" > /dev/null || { echo "STOP: clone"; exit 1; }; }
drop() { "${ISO[@]}" drop-db "$X" --acknowledge-destroy "$X" > /dev/null || { echo "STOP: drop"; exit 1; }; }
REF_TIME=$(cat "$E/reference/captured_start_utc.txt")
FROZEN_START=$("$NODE" -e 'const fs=require("fs");const d=process.argv[1];const f=fs.readdirSync(d).find(n=>/\.release\.json$/.test(n));process.stdout.write(require(d+"/"+f).dump_start_utc)' "$R/xfer")
SHA=$(cut -c1-64 < <(cd "$R/xfer" && grep '\.dump$' SHA256SUMS))
cat > "$O/settle-batch.sql" <<'SQL'
INSERT INTO import_batches (source_id, tool, target_table, records_read, notes)
SELECT source_id, 'settle-afltables.ts', 'staging.source_record_versions', 0,
       'AFLDB-ISSUE-099 settle; snapshot=settle-2026-2026-10-30-0444; season=2026; mode=apply'
  FROM import_batches WHERE tool = 'settle-afltables.ts' ORDER BY id DESC LIMIT 1;
SQL
# Copies the newest row of a table, minus its key and time column, so every NOT NULL/CHECK holds.
copyrow() { printf "SELECT format('INSERT INTO %%s (%%s) SELECT %%s FROM %%s ORDER BY id DESC LIMIT 1', '%s', c, c, '%s') FROM (SELECT string_agg(quote_ident(column_name), ',' ORDER BY ordinal_position) c FROM information_schema.columns WHERE table_schema = split_part('%s','.',1) AND table_name = split_part('%s','.',2) AND column_name NOT IN ('id','at','created_at','client_ref')) s \\\\gexec\n" "$1" "$1" "$1" "$1"; }

# A control's 120 MiB preservation snapshot is an intermediate: its compare and gate reports are the evidence.
# Its sha256 is recorded, then it is removed so the run keeps the host reserve (disk budget, 2026-10-30).
snapshot_done() { ( cd "$O" && sha256sum "$1.preservation.json" ) >> "$O/control-snapshots.sha256" && rm -f "$O/$1.preservation.json"; }
# gate D on control clone X: capture, compare with the a4641ca0 before set, sealed scope, attribution against REF0.
gate_d() {
  local tag=$1
  on "$X" "$NODE" --import tsx tools/v2/shadow-capture.ts preservation --dsn-env AFLDB_OWNER_DATABASE_URL \
    --contract docs/v2/preservation-queries.json --backup-sha256 "$SHA" --seal 2025 --out "$O/$tag.preservation.json" > /dev/null || { echo "STOP: capture $tag"; exit 1; }
  on "$X" "$NODE" --import tsx tools/v2/historical-manifest.ts produce --dsn-env AFLDB_OWNER_DATABASE_URL --out "$O/$tag.manifest.json" > /dev/null || { echo "STOP: manifest $tag"; exit 1; }
  "$NODE" "$P/snapshot-compare.mjs" preservation --a "$E/reference/before.preservation.json" --b "$O/$tag.preservation.json" --out "$O/$tag.compare.json" > /dev/null
  "$NODE" --import tsx tools/v2/historical-manifest.ts compare "$E/reference/before.manifest.json" "$O/$tag.manifest.json" --out "$O/$tag.manifest-compare.json" > /dev/null
  local mx=$?
  on "$X" "$NODE" --input-type=module - drift "$O/$tag.compare.json" "$mx" "$REF0" "$REF_TIME" "$O/$tag.gate.json" < "$P/drift-gate.mjs"
  GATE_EXIT=$?
  snapshot_done "$tag"
}
gate_v3() {
  local tag=$1
  on "$X" "$NODE" --import tsx tools/v2/shadow-capture.ts preservation --dsn-env AFLDB_OWNER_DATABASE_URL \
    --contract docs/v2/preservation-queries.json --backup-sha256 "$SHA" --seal 2025 --out "$O/$tag.preservation.json" > /dev/null || { echo "STOP: capture $tag"; exit 1; }
  on "$X" "$NODE" --import tsx tools/v2/historical-manifest.ts produce --dsn-env AFLDB_OWNER_DATABASE_URL --out "$O/$tag.manifest.json" > /dev/null || { echo "STOP: manifest $tag"; exit 1; }
  "$NODE" "$P/snapshot-compare.mjs" preservation --a "$E/postmig.preservation.json" --b "$O/$tag.preservation.json" --out "$O/$tag.compare.json" > /dev/null
  "$NODE" --import tsx tools/v2/historical-manifest.ts compare "$E/postmig.manifest.json" "$O/$tag.manifest.json" --out "$O/$tag.manifest-compare.json" > /dev/null
  local mx=$?
  on "$X" "$NODE" --input-type=module - after "$O/$tag.compare.json" "$mx" "$AM" "$FROZEN_START" "$O/$tag.gate.json" < "$P/drift-gate.mjs"
  GATE_EXIT=$?
  snapshot_done "$tag"
}
suite() {
  on "$X" "$NODE" node_modules/vitest/vitest.mjs run --no-cache tests/integration/privileges.test.ts --reporter=json --outputFile="$O/$1.suite.json" > /dev/null 2>&1
  "$NODE" -e 'const r=require(process.argv[1]); const f=[]; for (const t of r.testResults) for (const a of t.assertionResults) if (a.status!=="passed") f.push(a.title);
    process.stdout.write(`${r.numPassedTests}/${r.numTotalTests} failed=[${f.join(" ; ")}]`)' "$O/$1.suite.json"
}
readback() { on "$X" /usr/bin/env PSQL_ROLE=afldb_backup AFLDB_V2_PG_BIN="$PGBIN" "$NODE" "$P/psql-owner.mjs" -f "$P/permission-readback.sql" > "$O/$1.permissions.txt" || { echo "STOP: read-back $1 failed"; exit 1; }; }

room 3
echo "== D controls (template A = the frozen bytes, reference REF0/a4641ca0) $(date -u +%FT%TZ)"
clone "$A"; { cat "$O/settle-batch.sql"; copyrow public.auth_audit_log; copyrow public.app_health_events; copyrow public.nl_search_log
  echo "INSERT INTO auth_sessions (token_hash, user_id, expires_at) SELECT 'control-' || md5(random()::text), min(id), now() + interval '1 day' FROM auth_users;"
  echo "UPDATE auth_users SET totp_last_step = coalesce(totp_last_step, 0) + 1 WHERE id = (SELECT min(id) FROM auth_users);"; } > "$O/D1.sql"
setup "$X" -f "$O/D1.sql"; gate_d D1; expect D1-writer-activity-attributed "$GATE_EXIT" 3
expect D1-classes "$("$NODE" -e 'process.stdout.write(require(process.argv[1]).classes.join(","))' "$O/D1.gate.json")" auth-activity,runtime-telemetry,settle-bookkeeping
drop
clone "$A"; setup "$X" -c "UPDATE players SET notes = coalesce(notes, '') || ' ' WHERE id = (SELECT min(id) FROM players);"
gate_d D2; expect D2-canonical-row-change-stops "$GATE_EXIT" 1; expect D2-subject "$(stopped "$O/D2.gate.json" public.players)" yes; drop
clone "$A"; setup "$X" -c "ALTER TABLE public.data_issues ADD COLUMN control_x integer;"
gate_d D3; expect D3-definition-change-stops "$GATE_EXIT" 1; expect D3-subject "$(stopped "$O/D3.gate.json" public.data_issues)" yes; drop
clone "$A"; setup "$X" -c "INSERT INTO afldb_meta.schema_migrations (name, checksum, duration_ms) VALUES ('118_control.sql', 'control', 0);"
gate_d D4; expect D4-ledger-change-stops "$GATE_EXIT" 1; expect D4-subject "$(stopped "$O/D4.gate.json" afldb_meta.schema_migrations)" yes; drop
clone "$A"; sed "s/SELECT source_id, 'settle-afltables\.ts',/SELECT source_id, 'manual-control.ts',/" "$O/settle-batch.sql" > "$O/D5.sql"
grep -q "'manual-control.ts'" "$O/D5.sql" && grep -q "WHERE tool = 'settle-afltables.ts'" "$O/D5.sql" || { echo "STOP: D5 setup"; exit 1; }; setup "$X" -f "$O/D5.sql"
gate_d D5; expect D5-unsigned-bookkeeping-stops "$GATE_EXIT" 1; expect D5-subject "$(stopped "$O/D5.gate.json" public.import_batches)" yes; drop
clone "$A"; { cat "$O/settle-batch.sql"; echo "UPDATE import_batches SET started_at = '2026-10-01T00:00:00Z' WHERE id = (SELECT max(id) FROM import_batches);"; } > "$O/D6.sql"
setup "$X" -f "$O/D6.sql"; gate_d D6; expect D6-backdated-bookkeeping-stops "$GATE_EXIT" 1
expect D6-subject "$(stopped "$O/D6.gate.json" public.import_batches)" yes; drop
# A canonical row re-pointed at a genuine settle batch: a batch reference never makes canonical data bookkeeping.
clone "$A"; { cat "$O/settle-batch.sql"
  echo "SELECT format('UPDATE public.matches SET %I = (SELECT max(id) FROM public.import_batches) WHERE id = (SELECT max(id) FROM public.matches)', a.attname) FROM pg_constraint k JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1] WHERE k.contype = 'f' AND k.conrelid = 'public.matches'::regclass AND k.confrelid = 'public.import_batches'::regclass LIMIT 1 \gexec"; } > "$O/D7.sql"
setup "$X" -f "$O/D7.sql"
gate_d D7; expect D7-canonical-change-beside-settle-stops "$GATE_EXIT" 1; expect D7-subject "$(stopped "$O/D7.gate.json" public.matches)" yes; drop
"$NODE" -e 'const fs=require("fs");const s=JSON.parse(fs.readFileSync(process.argv[1]));s.scope.seal=2024;fs.writeFileSync(process.argv[2],JSON.stringify(s))' "$E/before.preservation.json" "$O/D8.seal.json"
"$NODE" "$P/snapshot-compare.mjs" preservation --a "$E/reference/before.preservation.json" --b "$O/D8.seal.json" --out "$O/D8.compare.json" 2> "$O/D8.stderr"
expect D8-scope-mismatch-refused "$?" 2
expect D8-no-report-written "$(test -e "$O/D8.compare.json" && echo written || echo absent)" absent
on "$A" "$NODE" --input-type=module - drift "$O/does-not-exist.json" 0 "$REF0" "$REF_TIME" "$O/D9.gate.json" < "$P/drift-gate.mjs" 2> "$O/D9.stderr"
expect D9-missing-compare-is-invalid "$?" 2
# D10/D11: the ff100dc2 settle footprint replayed (observation-store.ts): one batch; 50 unchanged records
# head-refreshed; one record marked absent; one record changed (payload, version close, new version, head);
# one rejection; 50 rows of each projection re-stamped (every present record is re-projected on every run). D11 is the same refresh pointing last_batch_id at a batch that is not an attributed settle.
settle_replay() {  # settle_replay <batch expression for the head refresh>
  cat "$O/settle-batch.sql"
  cat <<SQL
DO \$\$ BEGIN IF (SELECT count(*) FROM staging.source_records WHERE absent_since IS NULL) < 62 THEN
  RAISE EXCEPTION 'control needs 62 present source records'; END IF; END \$\$;
CREATE TEMP TABLE ctl_b AS SELECT max(id) AS id FROM import_batches;
UPDATE staging.source_records SET last_seen_at = now(), last_batch_id = ($1)
 WHERE (source_id, family, external_record_id) IN (SELECT source_id, family, external_record_id FROM staging.source_records
        WHERE absent_since IS NULL ORDER BY source_id, family, external_record_id LIMIT 50);
UPDATE staging.source_records SET absent_since = now()
 WHERE (source_id, family, external_record_id) = (SELECT source_id, family, external_record_id FROM staging.source_records
        WHERE absent_since IS NULL ORDER BY source_id DESC, family DESC, external_record_id DESC LIMIT 1);
CREATE TEMP TABLE ctl_r AS SELECT source_id, family, external_record_id, current_version_seq AS v,
  md5(external_record_id) || md5('control-' || external_record_id) AS h
  FROM staging.source_records WHERE absent_since IS NULL ORDER BY source_id, family, external_record_id OFFSET 60 LIMIT 1;
INSERT INTO staging.source_payloads (source_id, family, payload_hash, hash_recipe, raw_payload)
  SELECT source_id, family, h, 'control', '{"control": true}'::jsonb FROM ctl_r;
UPDATE staging.source_record_versions v SET observed_to = now(), closed_by_batch_id = (SELECT id FROM ctl_b) FROM ctl_r r
 WHERE v.source_id = r.source_id AND v.family = r.family AND v.external_record_id = r.external_record_id AND v.version_seq = r.v AND v.observed_to IS NULL;
INSERT INTO staging.source_record_versions (source_id, family, external_record_id, version_seq, payload_hash, observed_from, opened_by_batch_id)
  SELECT source_id, family, external_record_id, v + 1, h, now(), (SELECT id FROM ctl_b) FROM ctl_r;
UPDATE staging.source_records s SET current_version_seq = r.v + 1, current_payload_hash = r.h, last_seen_at = now(), last_batch_id = (SELECT id FROM ctl_b)
  FROM ctl_r r WHERE s.source_id = r.source_id AND s.family = r.family AND s.external_record_id = r.external_record_id;
INSERT INTO import_rejections (import_batch_id, source_record_id, reason, payload) SELECT id, 'control', 'control: unresolved identity', '{}'::jsonb FROM ctl_b;
DO \$\$ BEGIN IF (SELECT count(*) FROM staging.afltables_match) < 50 OR (SELECT count(*) FROM staging.afltables_player_match) < 50 THEN
  RAISE EXCEPTION 'control needs 50 rows in each projection'; END IF; END \$\$;
UPDATE staging.afltables_match SET projected_by_batch_id = ($1), projected_at = now()
 WHERE (source_id, family, external_record_id) IN (SELECT source_id, family, external_record_id FROM staging.afltables_match ORDER BY 1, 2, 3 LIMIT 50);
UPDATE staging.afltables_player_match SET projected_by_batch_id = ($1), projected_at = now()
 WHERE (source_id, family, external_record_id) IN (SELECT source_id, family, external_record_id FROM staging.afltables_player_match ORDER BY 1, 2, 3 LIMIT 50);
SQL
}
attributed() { "$NODE" -e 'const r=require(process.argv[1]);process.stdout.write(String(r.tables.filter(t=>t.verdict==="ATTRIBUTED"&&t.cls==="settle-bookkeeping").map(t=>t.table).sort().join(",")))' "$1"; }
clone "$A"; settle_replay '(SELECT id FROM ctl_b)' > "$O/D10.sql"; setup "$X" -f "$O/D10.sql"; T_D10=$(date +%s)
gate_d D10; echo "d10_gate_seconds=$(( $(date +%s) - T_D10 ))" | tee -a "$O/timings.txt"
expect D10-settle-replay-attributed "$GATE_EXIT" 3
expect D10-seven-settle-tables "$(attributed "$O/D10.gate.json")" public.import_batches,public.import_rejections,staging.afltables_match,staging.afltables_player_match,staging.source_payloads,staging.source_record_versions,staging.source_records
expect D10-classes "$("$NODE" -e 'process.stdout.write(require(process.argv[1]).classes.join(","))' "$O/D10.gate.json")" settle-bookkeeping; drop
clone "$A"; settle_replay '(SELECT min(id) FROM import_batches)' > "$O/D11.sql"; setup "$X" -f "$O/D11.sql"
gate_d D11; expect D11-unbound-refresh-stops "$GATE_EXIT" 1; expect D11-subject "$(stopped "$O/D11.gate.json" staging.source_records)" yes
expect D11-projection-subject "$(stopped "$O/D11.gate.json" staging.afltables_match)" yes; drop

echo "== T controls (template B after the A-REL sequence) $(date -u +%FT%TZ)"
clone "$B"; setup "$X" -c "GRANT INSERT ON public.players TO afldb_app;"
T1=$(suite T1); echo "T1 suite $T1"; expect T1-suite-below-43 "$(echo "$T1" | cut -d' ' -f1 | grep -qx '43/43' && echo full || echo below)" below
readback T1; "$NODE" "$P/snapshot-compare.mjs" permissions --a "$E/B.permissions.txt" --b "$O/T1.permissions.txt" --out "$O/T1.compare.json" > /dev/null
expect T1-widened-grant-different "$?" 1
expect T1-effective-line-reported "$(grep -c '"E|table|afldb_app|public.players|INSERT"' "$O/T1.compare.json")" 1; drop
clone "$B"; setup "$X" -c "ALTER DEFAULT PRIVILEGES FOR ROLE afldb_owner IN SCHEMA staging REVOKE SELECT ON TABLES FROM afldb_app;"
T2=$(suite T2); echo "T2 suite $T2"; expect T2-suite-42-of-43 "$(echo "$T2" | cut -d' ' -f1)" 42/43
expect T2-failing-assertion "$(echo "$T2" | grep -c 'inherits that from migration 014')" 1
readback T2; "$NODE" "$P/snapshot-compare.mjs" permissions --a "$E/B.permissions.txt" --b "$O/T2.permissions.txt" --out "$O/T2.compare.json" > /dev/null
expect T2-missing-default-different "$?" 1
expect T2-stored-default-acl-line "$(grep -c '"S|default-acl|for=afldb_owner|schema=staging|objtype=r|grantee=afldb_app' "$O/T2.compare.json")" 1; drop
clone "$B"; super -d "$X" -c "ALTER TABLE public.players OWNER TO afldb_auth;" > /dev/null || { echo "STOP: control setup failed (T5)"; exit 1; }
readback T5; "$NODE" "$P/snapshot-compare.mjs" permissions --a "$E/B.permissions.txt" --b "$O/T5.permissions.txt" --out "$O/T5.compare.json" > /dev/null
expect T5-ownership-change-different "$?" 1; drop
sed 's/^\(C|role|afldb_backup|.*|inherit=\)t|/\1f|/' "$E/B.permissions.txt" > "$O/T3.permissions.txt"; mutated "$E/B.permissions.txt" "$O/T3.permissions.txt"
"$NODE" "$P/snapshot-compare.mjs" permissions --a "$E/B.permissions.txt" --b "$O/T3.permissions.txt" --out "$O/T3.compare.json" > /dev/null
expect T3-cluster-role-fact-review "$?" 3
sed 's/^\(A|afldb_app-unprivileged|.*\)|ok$/\1|FAIL/' "$E/B.permissions.txt" > "$O/T4.permissions.txt"; mutated "$E/B.permissions.txt" "$O/T4.permissions.txt"
"$NODE" "$P/snapshot-compare.mjs" permissions --a "$E/B.permissions.txt" --b "$O/T4.permissions.txt" --out "$O/T4.compare.json" > /dev/null
expect T4-assertion-fail-different "$?" 1
# A truncated production read-back (lines sort A|, C|, E|, I|, S|: the cut loses E and S facts) never compares equal.
head -n 2000 "$E/B.permissions.txt" > "$O/T6.permissions.txt"; mutated "$E/B.permissions.txt" "$O/T6.permissions.txt"
"$NODE" "$P/snapshot-compare.mjs" permissions --a "$E/B.permissions.txt" --b "$O/T6.permissions.txt" --out "$O/T6.compare.json" > /dev/null
expect T6-truncated-readback-different "$?" 1

echo "== V3 controls (template AM, the rehearsed after-state) $(date -u +%FT%TZ)"
LEDGER_TIMING="UPDATE afldb_meta.schema_migrations SET applied_at = now(), duration_ms = coalesce(duration_ms, 0) + 1 WHERE name >= '111';"
clone "$AM"; setup "$X" -c "$LEDGER_TIMING"; gate_v3 V1
expect V1-ledger-timing-only "$GATE_EXIT" 0; expect V1-verdict "$(verdict "$O/V1.gate.json" verdict)" LEDGER_TIMING_ONLY; drop
clone "$AM"; { echo "$LEDGER_TIMING"; copyrow public.nl_search_log; } > "$O/V2.sql"; setup "$X" -f "$O/V2.sql"; gate_v3 V2
expect V2-visitor-telemetry-attributed "$GATE_EXIT" 3; drop
clone "$AM"; setup "$X" -f "$O/settle-batch.sql"; gate_v3 V3
expect V3-settle-after-retirement-stops "$GATE_EXIT" 1; expect V3-subject "$(stopped "$O/V3.gate.json" public.import_batches)" yes; drop
clone "$AM"; setup "$X" -c "UPDATE afldb_meta.schema_migrations SET checksum = 'control' WHERE name LIKE '117%';"; gate_v3 V4
expect V4-ledger-checksum-stops "$GATE_EXIT" 1; expect V4-subject "$(stopped "$O/V4.gate.json" afldb_meta.schema_migrations)" yes; drop
clone "$AM"; setup "$X" -c "UPDATE players SET notes = coalesce(notes, '') || ' ' WHERE id = (SELECT min(id) FROM players);"; gate_v3 V5
expect V5-canonical-write-under-freeze-stops "$GATE_EXIT" 1; expect V5-subject "$(stopped "$O/V5.gate.json" public.players)" yes; drop
# After A-REL only the TOTP step may move on auth_users: a password change in the window is not attributed.
clone "$AM"; { echo "$LEDGER_TIMING"; echo "UPDATE auth_users SET password_hash = password_hash || 'x', password_changed_at = now() WHERE id = (SELECT min(id) FROM auth_users);"; } > "$O/V6.sql"
setup "$X" -f "$O/V6.sql"; gate_v3 V6
expect V6-password-change-after-arel-stops "$GATE_EXIT" 1; expect V6-subject "$(stopped "$O/V6.gate.json" public.auth_users)" yes; drop

echo "== N controls: failures propagate, incomplete evidence is never PASS $(date -u +%FT%TZ)"
# Two new stamps derived from this run's (+100 s, +200 s): never an existing root.
plus() { local e; e=$(date -u -d "$(sed -E 's/^(....)(..)(..)T(..)(..)(..)Z$/\1-\2-\3 \4:\5:\6/' <<< "$STAMP") UTC" +%s) && date -u -d "@$((e + $1))" +%Y%m%dT%H%M%SZ; }
S2=$(plus 100); S3=$(plus 200); R2=/home/arm/afldb-v2-prodexec-$S2
[[ "$S2$S3" =~ ^[0-9]{8}T[0-9]{6}Z[0-9]{8}T[0-9]{6}Z$ ]] || { echo "STOP: N-control stamps"; exit 1; }
[ ! -e "$R2" ] && [ ! -e "/home/arm/afldb-v2-prodexec-$S3" ] || { echo "STOP: N-control roots exist"; exit 1; }
mkdir -m 700 "$R2" "$R2/xfer" && cp -al "$P" "$R2/pinned"
cp "$R/xfer/"*.release.json "$R2/xfer/"; head -c 1000000 "$R/xfer/"*.dump > "$R2/xfer/afldb_prod-20261028T192336Z.dump"; cp "$R/xfer/SHA256SUMS" "$R2/xfer/"
PS=$(sha256sum < "$P/PINNED.SHA256" | cut -c1-64)
bash "$P/isolated-rehearsal.sh" rehearse "$S2" "$SHA" "$PS" > "$O/N1.out" 2>&1; expect N1-corrupted-transfer-stops "$?" 9
expect N1-result-recorded-fail "$(cut -c1-4 "$R2/evidence/rehearse.result")" FAIL
expect N1-no-cluster-created "$(test -e "$R2/cluster" && echo yes || echo no)" no
bash "$P/isolated-rehearsal.sh" rehearse "$S3" "$SHA" "$PS" > "$O/N2.out" 2>&1; expect N2-missing-root-stops "$?" 2
mkdir -m 700 "$O/N3" && cp "$E"/{gateD.json,T.privileges.json,B.permissions.txt,B.fidelity.diff,AM.ledger.digest,rehearse.exit-codes.txt,rehearse.input-sha256.txt} "$O/N3/"
"$NODE" "$P/rehearsal-summary.mjs" rehearse "$O/N3" "$O/N3.summary.json" > /dev/null; expect N3-missing-gateR-incomplete "$?" 2
expect N3-only-gateR-missing "$("$NODE" -e 'process.stdout.write(require(process.argv[1]).missing.join(","))' "$O/N3.summary.json")" gateR.json
mkdir -m 700 "$O/N4" && cp "$E"/{gateD.json,gateR.json,B.permissions.txt,B.fidelity.diff,AM.ledger.digest,rehearse.exit-codes.txt,rehearse.input-sha256.txt} "$O/N4/"
"$NODE" -e 'const fs=require("fs");const r=JSON.parse(fs.readFileSync(process.argv[1]));r.numPassedTests=42;r.numFailedTests=1;fs.writeFileSync(process.argv[2],JSON.stringify(r))' "$E/T.privileges.json" "$O/N4/T.privileges.json"
"$NODE" "$P/rehearsal-summary.mjs" rehearse "$O/N4" "$O/N4.summary.json" > /dev/null; expect N4-42-of-43-fails "$?" 1
mkdir -m 700 "$O/N5" && cp "$E"/{gateD.json,gateR.json,T.privileges.json,B.permissions.txt,B.fidelity.diff,AM.ledger.digest,rehearse.input-sha256.txt} "$O/N5/"
sed 's/^EXIT gateR = 0$/EXIT gateR = 1/' "$E/rehearse.exit-codes.txt" > "$O/N5/rehearse.exit-codes.txt"
"$NODE" "$P/rehearsal-summary.mjs" rehearse "$O/N5" "$O/N5.summary.json" > /dev/null; expect N5-failed-step-code-fails "$?" 1

echo "== RB: forward-schema code rollback, rollback runbook §4.1 (PREV ff100dc2 on the 117 schema) $(date -u +%FT%TZ)"
# The established local-release harness (linux rehearsal 2026-10-20): PREV in src/.local-release/previous, built
# with this checkout's installed node_modules, served on 127.0.0.1:3911 from a NEW clone of AM, checked with
# tools/v2/local-runtime-check.mts (18 anonymous/Admin/Super Admin route and permission checks).
PV=$R/src/.local-release/previous
[ ! -e "$R/src/.local-release" ] && mkdir -m 700 "$R/src/.local-release" "$PV" && tar -xf "$K/src-ff100dc2.tar" -C "$PV" || { echo "STOP: PREV extract"; exit 1; }
clone "$AM"
on "$X" /usr/bin/env -C "$PV" "$NODE" --import tsx tools/db/migrate.ts --target test --status > "$O/RB1.prev-status.txt" 2>&1
expect RB1-prev-runner-accepts-ledger "$?" 0
expect RB1-prev-nothing-pending "$(grep -cx '0 pending.' "$O/RB1.prev-status.txt")" 1
sqlx "$X" -c "SELECT name FROM afldb_meta.schema_migrations ORDER BY name COLLATE \"C\"" > "$O/RB2.ledger-names.txt" || { echo "STOP: RB2 ledger"; exit 1; }
find "$PV/src/db/migrations" -maxdepth 1 -name '*.sql' -printf '%f\n' | sort > "$O/RB2.prev-files.txt"
expect RB2-unknown-applied-exactly-111-117 "$(comm -23 "$O/RB2.ledger-names.txt" "$O/RB2.prev-files.txt" | paste -sd' ')" \
  "111_curated_award_proposals.sql 112_derived_award_results.sql 113_brownlow_eligibility_decisions.sql 114_award_projections_and_curated_revisions.sql 115_adjudication_supersession_fk_index.sql 116_brownlow_correction_receipts.sql 117_brownlow_provider_eligibility_unknown.sql"
expect RB2-every-prev-migration-applied "$(comm -13 "$O/RB2.ledger-names.txt" "$O/RB2.prev-files.txt" | grep -c .)" 0
room 6; T_RB=$(date +%s)
on "$X" "$NODE" tools/v2/local-release.mjs build previous > "$O/RB3.prev-build.log" 2>&1; expect RB3-prev-build "$?" 0
cp "$PV/.next/BUILD_ID" "$O/RB3.BUILD_ID" 2>/dev/null; echo "rb_build_seconds=$(( $(date +%s) - T_RB ))" | tee -a "$O/timings.txt"
ss -ltn | grep -q '127.0.0.1:3911 ' && { echo "STOP: 127.0.0.1:3911 already in use"; exit 1; }
( exec setsid "${ISO[@]}" run "$X" -- "$NODE" tools/v2/local-release.mjs start previous ) > "$O/RB4.prev-server.log" 2>&1 & SRV=$!
H200=none; for i in $(seq 1 90); do
  c=$(curl -s -o "$O/RB4.health.json" -w '%{http_code}' --max-time 3 http://127.0.0.1:3911/api/health) && [ "$c" = 200 ] && { H200=200; break; }; sleep 2; done
expect RB4-prev-health-200 "$H200" 200
expect RB4-prev-health-database-ok "$(grep -c '"database":"ok"' "$O/RB4.health.json" 2>/dev/null)" 1
# A V2 UNKNOWN (NULL) provider eligibility row is present while PREV serves: PREV never reads the column.
NUL0=$(sqlx "$X" -c "SELECT count(*) FROM staging.afl_api_brownlow_vote WHERE eligible IS NULL") || { echo "STOP: RB null count"; exit 1; }
[ "$NUL0" -gt 0 ] || { setup "$X" -c "UPDATE staging.afl_api_brownlow_vote SET eligible = NULL WHERE ctid = (SELECT min(ctid) FROM staging.afl_api_brownlow_vote);"
  NUL0=$(sqlx "$X" -c "SELECT count(*) FROM staging.afl_api_brownlow_vote WHERE eligible IS NULL"); }
echo "RB null-eligible rows present: $NUL0"
on "$X" "$NODE" --import tsx tools/v2/local-runtime-check.mts previous rollback-117 "$O/RB5.runtime.json" > "$O/RB5.runtime.log" 2>&1
expect RB5-prev-runtime-checks "$?" 0
expect RB5-route-permission-checks "$("$NODE" -e 'try{process.stdout.write(String(require(process.argv[1]).checks.length))}catch{process.stdout.write("none")}' "$O/RB5.runtime.json")" 18
kill -TERM -- "-$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null
for i in $(seq 1 30); do ss -ltn | grep -q '127.0.0.1:3911 ' || break; sleep 1; done
expect RB4-prev-server-stopped "$(ss -ltn | grep -c '127.0.0.1:3911 ')" 0
rm -rf "$PV/.next"; room 2
# PREV's own AFL API Brownlow writer suite on the 117 schema, with the UNKNOWN row present.
on "$X" /usr/bin/env -C "$PV" "$NODE" "$R/src/node_modules/vitest/vitest.mjs" run --no-cache tests/integration/settle-afl-api-brownlow.test.ts \
    --reporter=json --outputFile="$O/RB6.prev-brownlow.json" > "$O/RB6.prev-brownlow.log" 2>&1
expect RB6-prev-brownlow-writer-suite "$?" 0
expect RB6-null-eligible-rows-kept "$(sqlx "$X" -c "SELECT count(*) FROM staging.afl_api_brownlow_vote WHERE eligible IS NULL")" "$NUL0"
# Off the route (runbook §5 runs it only after a reversal): PREV privileges.sql completes on the 117 schema; the
# resulting read-back difference from B is recorded for the owner, not graded.
on "$X" /usr/bin/env -C "$PV" "$NODE" --import tsx tools/db/privileges.ts --target test > "$O/RB7.prev-privileges.log" 2>&1
expect RB7-prev-privileges-completes "$?" 0
readback RB7; "$NODE" "$P/snapshot-compare.mjs" permissions --a "$E/B.permissions.txt" --b "$O/RB7.permissions.txt" --out "$O/RB7.compare.json" > /dev/null
echo "INFO RB7 read-back after PREV privileges.sql vs B: exit $? (not on the code-rollback route; recorded, not graded)"
drop

echo "== H controls: host-session.sh functions in library mode (no production) $(date -u +%FT%TZ)"
H=$K/hs; mkdir -m 700 "$H" "$H/checkout" "$H/backups"
for d in tools src packages node_modules data docs package.json package-lock.json tsconfig.json; do ln -s "$R/src/$d" "$H/checkout/$d"; done
HX=afldb_v2_shadow_hsctl_test; HM=afldb_v2_shadow_hsctlmig_test
"${ISO[@]}" create-db "$HX" --template "$A" > /dev/null && "${ISO[@]}" create-db "$HM" --template "$AM" > /dev/null || { echo "STOP: hs clones"; exit 1; }
PW() { "$NODE" -e 'process.stdout.write(encodeURIComponent(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))[process.argv[2]]))' "$R/cluster/secrets/roles.json" "$1"; }
mkenv() { umask 077; { echo "AFLDB_BACKUP_DATABASE_URL=postgresql://afldb_backup:$(PW afldb_backup)@127.0.0.1:$PORT/$1"
  echo "AFLDB_OWNER_DATABASE_URL=postgresql://afldb_owner:$(PW afldb_owner)@127.0.0.1:$PORT/$1"; } > "$H/checkout/.env"; }
SYSID=$(super -d postgres -c "SELECT system_identifier FROM pg_control_system()")
oid() { super -d postgres -c "SELECT oid FROM pg_database WHERE datname = '$1'"; }
hs() {  # hs <log> <db> <commands...>: source the script, point its constants at the isolated cluster, run
  local log=$1 db=$2 dboid; shift 2
  # the OID is read with this run's R (the superuser secret), before the subshell points R at the control checkout
  dboid=$(oid "$db") && [ -n "$dboid" ] || { echo "STOP: no OID for $db"; exit 1; }
  ( source "$K/host-session.sh"; hs_config
    EXPECT_HOST=streamanator; R=$H/checkout; BACKUPS=$H/backups; EXPECT_DB=$db; EXPECT_DSN_HOST=127.0.0.1; EXPECT_DSN_PORT=$PORT
    EXPECT_SYSID=$SYSID; EXPECT_OID=$dboid; WRITER_UNITS=afldb-v2-control-nonexistent.service; STAMP=20261029T210300Z
    RETIRED_TIMERS=afldb-v2-control-nonexistent.timer
    PIN_PERMISSION_READBACK=$(sha256sum < "$P/permission-readback.sql" | cut -c1-64); PIN_AREL_READBACK=$(sha256sum < "$P/arel-readback.sql" | cut -c1-64)
    PIN_ARTIFACT_MANIFEST=$(sha256sum < "$P/artifact-manifest.mjs" | cut -c1-64)
    eval "$*" ) > "$O/$log" 2>&1
}
DIG=$(cat "$E/AM.ledger.digest")
mkenv "$HX"; hs H1.log "$HX" hs_identity 110; expect H1-identity-110 "$?" 0
hs H2a.log "$HX" hs_identity 117; expect H2a-117-without-digest "$?" 2
hs H2b.log "$HX" hs_identity 117 "$DIG"; expect H2b-110-db-is-not-117 "$?" 5
cp "$H/checkout/.env" "$O/env.good"
sed 's#^AFLDB_BACKUP_DATABASE_URL=postgresql://afldb_backup:[^@]*@#AFLDB_BACKUP_DATABASE_URL=postgresql://afldb_backup@#' "$O/env.good" > "$H/checkout/.env"
hs H3a.log "$HX" hs_identity 110; expect H3a-no-password "$?" 2
{ cat "$O/env.good"; grep '^AFLDB_BACKUP' "$O/env.good"; } > "$H/checkout/.env"; hs H3b.log "$HX" hs_identity 110; expect H3b-duplicate-key "$?" 2
sed 's#^AFLDB_BACKUP_DATABASE_URL=.*#AFLDB_BACKUP_DATABASE_URL=mysql://x:y@z/w#' "$O/env.good" > "$H/checkout/.env"; hs H3c.log "$HX" hs_identity 110; expect H3c-bad-scheme "$?" 2
grep '^AFLDB_OWNER' "$O/env.good" | sed 's/^AFLDB_OWNER_/AFLDB_BACKUP_/' > "$H/checkout/.env"; hs H3d.log "$HX" hs_identity 110; expect H3d-owner-under-backup-key "$?" 2
printf 'AFLDB_BACKUP_DATABASE_URL="postgresql://afldb_backup:p%%40ss%%25w0rd%%3A@localhost:5432/afldb_prod"\n' > "$H/checkout/.env"
hs H3e.log "$HX" 'EXPECT_DB=afldb_prod; EXPECT_DSN_HOST=localhost; EXPECT_DSN_PORT=5432; hs_parse_dsn AFLDB_BACKUP_DATABASE_URL afldb_backup; [ "$PGPASSWORD" = "p@ss%w0rd:" ] && echo decoded-ok'
expect H3e-percent-decoding "$(grep -c '^decoded-ok$' "$O/H3e.log")" 1
cp "$O/env.good" "$H/checkout/.env"
( exec -a settle-afltables-control sleep 30 ) & SP=$!
hs H4.log "$HX" hs_no_writer_running; expect H4-writer-process-stops "$?" 4; kill "$SP" 2>/dev/null; wait "$SP" 2>/dev/null
for n in 1 2; do : > "$H/backups/$HX-2026010${n}-000000.dump"; done; mkdir -m 700 "$H/backups/release-v2-20261029T210300Z"
hs H5.log "$HX" hs_backup frozen; expect H5-frozen-backup "$?" 0
expect H5-series-unchanged "$(find "$H/backups" -maxdepth 1 -name "$HX-*.dump" | wc -l)" 2
SIDE=$(ls "$H/backups/release-v2-20261029T210300Z/"*.release.json)
"$NODE" -e 'const p=require(process.argv[1]); process.exit(p.format==="afldb.v2.release-backup.1"&&p.label==="frozen"&&p.observed_ledger.length===110&&p.observed_ledger_digest==="789946fe734b23c32ec87e59e3b860877d31a4b32b561624bf1d88fb8f055153"&&/^[0-9a-f]{64}$/.test(p.archive_sha256)?0:1)' "$SIDE"
expect H5-sidecar-accepted-by-P3 "$?" 0
( cd "$H/backups/release-v2-20261029T210300Z" && sha256sum --check --strict --quiet frozen.SHA256SUMS ); expect H5-sums-verify "$?" 0
hs H5b.log "$HX" hs_backup frozen; expect H5b-second-frozen-refused "$?" 6
FSHA=$(grep '\.dump$' "$H/backups/release-v2-20261029T210300Z/frozen.SHA256SUMS" | cut -c1-64)
hs H6.log "$HX" hs_manifest before; expect H6-manifest-before "$?" 0
hs H6b.log "$HX" hs_manifest after "$DIG"; expect H6b-after-on-110-refused "$?" 5
hs H8.log "$HX" hs_arel "$DIG" "$FSHA"; expect H8-arel-refuses-non-reviewed-checkout "$?" 6
expect H8-reason "$(grep -c '^STOP: checkout ' "$O/H8.log")" 1
hs H8b.log "$HX" hs_arel "$DIG"; expect H8b-arel-without-archive-hash "$?" 2
# streamanator has the AFL API timers installed and enabled: the window guard must refuse them.
hs H13.log "$HX" 'RETIRED_TIMERS="afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.timer"; hs_writers_retired'; expect H13-enabled-timer-stops "$?" 4
expect H13-reason "$(grep -c '^STOP: writer timer afldb-settle-afl-api.timer is enabled' "$O/H13.log")" 1
mkenv "$HM"; cp "$P/permission-readback.sql" "$P/arel-readback.sql" "$P/artifact-manifest.mjs" "$H/backups/release-v2-20261029T210300Z/pinned/" 2>/dev/null \
  || { mkdir -m 700 "$H/backups/release-v2-20261029T210300Z/pinned"; cp "$P/permission-readback.sql" "$P/arel-readback.sql" "$P/artifact-manifest.mjs" "$H/backups/release-v2-20261029T210300Z/pinned/"; }
hs H7.log "$HM" hs_readback "$DIG"; expect H7-readback-117 "$?" 0
expect H7-read-only "$(grep -c '^I|transaction_read_only|on$' "$H/backups/release-v2-20261029T210300Z/P.permissions.txt")" 1
mv "$H/backups/release-v2-20261029T210300Z/P.permissions.txt" "$O/H7.P.permissions.txt"
echo "-- tamper" >> "$H/backups/release-v2-20261029T210300Z/pinned/permission-readback.sql"
hs H7b.log "$HM" hs_readback "$DIG"; expect H7b-tampered-pinned-refused "$?" 6
# End-to-end inputs, kept for the transfer script's Pull/GateV2 under this run's STAMP: the post-schema
# backup of an A-REL clone (-> rehearsal `after`, gate V3) and the read-back of a clone of B (-> gate V2).
HB=afldb_v2_shadow_hsctlperm_test
"${ISO[@]}" create-db "$HB" --template "$B" > /dev/null || { echo "STOP: hs clone of B"; exit 1; }
HD=$H/backups/release-v2-$STAMP; mkdir -m 700 "$HD" "$HD/pinned" && cp "$P/permission-readback.sql" "$P/arel-readback.sql" "$P/artifact-manifest.mjs" "$HD/pinned/"
hs H10.log "$HM" "STAMP=$STAMP; hs_backup postschema $DIG"; expect H10-postschema-backup "$?" 0
expect H10-result-line "$(grep -c '^RESULT PASS stage=backup label=postschema ' "$O/H10.log")" 1
mkenv "$HB"; hs H11.log "$HB" "STAMP=$STAMP; hs_readback $DIG"; expect H11-readback-of-B-clone "$?" 0
# H12: the A-REL stage end to end to RESULT PASS from a real clean git checkout of the locked commit (migrate.ts
# --target prod with its git-inventory safety check, privileges.sql, both defaults, the 12-line read-back), on
# NEW 110 clones of the frozen bytes; then its negatives: a failed migration, the no-retry marker, a failed
# privileges.sql. restore-test.sh is the unchanged reviewed procedure: its proof file is a marked stand-in here.
room 3; G=$H/gitco
git clone --quiet --no-checkout "$K/v2-9ed9c9dd.bundle" "$G" && git -C "$G" checkout --quiet --detach "$REVIEWED" \
  && cp -al "$R/src/node_modules" "$G/node_modules" || { echo "STOP: git checkout for H12"; exit 1; }
newdb() { "${ISO[@]}" create-db "$1" --template "$2" > /dev/null || { echo "STOP: create $1"; exit 1; }; }
dropdb() { "${ISO[@]}" drop-db "$1" --acknowledge-destroy "$1" > /dev/null || { echo "STOP: drop $1"; exit 1; }; }
arel_dir() {
  local d=$H/backups/release-v2-$1
  mkdir -m 700 "$d" "$d/pinned" && cp "$P/permission-readback.sql" "$P/arel-readback.sql" "$P/artifact-manifest.mjs" "$d/pinned/" \
    && cp "$H/backups/release-v2-20261029T210300Z/frozen.SHA256SUMS" "$d/" \
    && echo "control stand-in: restore-test.sh is not exercised by this control" > "$d/restore-test.SHA256SUMS" || { echo "STOP: arel dir $1"; exit 1; }
}
arel_env() { mkenv "$1"; cp "$H/checkout/.env" "$G/.env"; }
HA=afldb_v2_shadow_hsctlarel_test; newdb "$HA" "$A"; arel_env "$HA"; arel_dir 20261029T210500Z; DA=$H/backups/release-v2-20261029T210500Z
echo "ERROR: could not prove migration safety across refs/worktrees: (control: an attempt refused before connecting)" > "$DA/arel.migrate.log"
T_AR=$(date +%s)
hs H12.log "$HA" "R=$G; STAMP=20261029T210500Z; hs_arel $DIG $FSHA"; expect H12-arel-result-pass "$?" 0
echo "hs_arel_seconds=$(( $(date +%s) - T_AR ))" | tee -a "$O/timings.txt"
expect H12-result-line "$(grep -c "^RESULT PASS stage=arel ledger_digest=$DIG\$" "$O/H12.log")" 1
expect H12-preconnect-attempt-set-aside "$(find "$DA" -maxdepth 1 -name 'arel.migrate.preconnect-*.log' | wc -l)" 1
expect H12-identity-checked-target "$(grep -cxF "AFLDB migrations -> prod (afldb_owner@127.0.0.1:$PORT/$HA)" "$DA/arel.status-before.txt")" 1
expect H12-seven-applied "$(grep -cx 'Applied 7 migration(s).' "$DA/arel.migrate.log")" 1
expect H12-readback-12-ok "$(grep -c '|ok$' "$DA/arel.readback.txt")" 12
expect H12-checkout-still-clean "$(git -C "$G" status --porcelain | grep -c .)" 0
XS=$X; X=$HA; readback H12; X=$XS
"$NODE" "$P/snapshot-compare.mjs" permissions --a "$E/B.permissions.txt" --b "$O/H12.permissions.txt" --out "$O/H12.compare.json" > /dev/null
expect H12-surface-identical-to-rehearsed-B "$?" 0
dropdb "$HA"
HC=afldb_v2_shadow_hsctlfail_test; newdb "$HC" "$A"; arel_env "$HC"; arel_dir 20261029T210600Z
setup "$HC" -c "CREATE TABLE public.award_proposals (control integer);"
hs H12c.log "$HC" "R=$G; STAMP=20261029T210600Z; hs_arel $DIG $FSHA"; expect H12c-failed-migration-stops "$?" 7
expect H12c-reason "$(grep -c '^STOP: migrate exited 1' "$O/H12c.log")" 1
expect H12c-no-result-pass "$(grep -c '^RESULT PASS' "$O/H12c.log")" 0
hs H12d.log "$HC" "R=$G; STAMP=20261029T210600Z; hs_arel $DIG $FSHA"; expect H12d-no-retry-after-connect "$?" 6
expect H12d-reason "$(grep -c '^STOP: A-REL already reached the database' "$O/H12d.log")" 1
hs H12e.log "$HC" hs_identity 110; expect H12e-failed-migration-left-110 "$?" 0
dropdb "$HC"
HP=afldb_v2_shadow_hsctlpriv_test; newdb "$HP" "$A"; arel_env "$HP"; arel_dir 20261029T210700Z
setup "$HP" -c "ALTER SEQUENCE public.player_link_resolutions_id_seq RENAME TO control_renamed_seq;"
hs H12f.log "$HP" "R=$G; STAMP=20261029T210700Z; hs_arel $DIG $FSHA"; expect H12f-failed-privileges-stops "$?" 7
expect H12f-reason "$(grep -c '^STOP: privileges.sql exited' "$O/H12f.log")" 1
expect H12f-no-result-pass "$(grep -c '^RESULT PASS' "$O/H12f.log")" 0
hs H12g.log "$HP" hs_identity 117 "$DIG"; expect H12g-schema-applied-before-privileges-failure "$?" 0
dropdb "$HP"
rm -f "$G/.env"
LEAK=0; for f in "$O"/H*.log "$H"/backups/release-v2-*/arel.* "$O"/RB*.log; do for r in afldb_backup afldb_owner; do grep -qF "$("$NODE" -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))[process.argv[2]])' "$R/cluster/secrets/roles.json" "$r")" "$f" && LEAK=1; done; done
expect H9-no-password-in-any-log "$LEAK" 0
for d in "$HX" "$HM" "$HB"; do "${ISO[@]}" drop-db "$d" --acknowledge-destroy "$d" > /dev/null; done
rm -f "$O/env.good" "$H/checkout/.env"

echo "== result $(date -u +%FT%TZ)"
"${ISO[@]}" list | tee "$O/databases-after-controls.txt"
TOTAL=$(grep -c '^CONTROL ' "$O/controls.txt")
if [ "$FAILS" = 0 ]; then echo "PASS $TOTAL/$TOTAL" > "$O/controls.result"; else echo "FAIL $FAILS of $TOTAL" > "$O/controls.result"; fi
( cd "$O" && find . -type f ! -name evidence-sha256.txt -print0 | sort -z | xargs -0 sha256sum ) > "$O/evidence-sha256.txt"
cat "$O/controls.result"
[ "$FAILS" = 0 ]
