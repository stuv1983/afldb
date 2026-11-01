:
{
# Block B (Brownlow) production-side phases. Run as `arm` on afldb-prod, ONE phase per call, from the package extracted from the approved
# revision. The ONLY phase that writes to the database is `apply`, and only with an approval file the owner authorised. Nothing here builds,
# deploys, restarts, activates a timer or uses sudo. The runner's own gates (plan digest, target proof, revision, backup and restore-evidence
# hashes, approval expiry, season scope that excludes 2026) are NOT re-implemented here; this wrapper binds the stage to its inputs around them.
#   bash b-prod.sh pre       <R> <stage>      read-only: checkout, writers, identity, ledger 118, receipts exactly as this stage expects, 2026 digest
#   bash b-prod.sh snapshots <stage>          read-only: the staged snapshot bytes equal the pinned list (b0, b1)
#   bash b-prod.sh target    <R> <stage>      writes ONE new file: target.json from independent facts (afldb_backup), user afldb_owner
#   bash b-prod.sh baseline  <R> <stage>      runner `baseline` against production (read-only session)
#   bash b-prod.sh plan      <R> <stage> <backup.json> <backup-file> <restore-evidence>      runner `plan` (read-only session, no writes)
#   bash b-prod.sh apply     <R> <stage> <plan.json> <approval.json> <backup-file> <restore-evidence>   runner `apply` (WRITES; needs the approval)
#   bash b-prod.sh accept    <R> <stage>      read-only: receipts and row facts AFTER the stage
# stage: b0 (fixture identities 2025) b1 (observe 2025) b2 (backfill 1984-2025) b3 (adopt 2025) e (eligibility 2025)
set -u -o pipefail
export LC_ALL=C
umask 077
step() { echo "== $* $(date -u +%FT%TZ)"; }
stop() { unset PGPASSWORD HS_DSN AFLDB_BROWNLOW_CORRECTION_DSN; echo "STOP: $1"; exit "${2:-1}"; }

PHASE=${1:?phase}; shift
CHK=/home/arm/projects/afldb
PGBIN=/usr/lib/postgresql/16/bin
NODE=/home/arm/.nvm/versions/node/v22.23.2/bin/node
EXPECT_DB=afldb_prod; EXPECT_DSN_HOST=localhost; EXPECT_DSN_PORT=5432
EXPECT_SYSID=7674454702926115004; EXPECT_OID=66668
MIG118=118_fixtures_unconfirmed_participants.sql
L118_DIGEST=573594e9365b642ec518c252b17de11d3a423872c53c3020ab525db5904aaf57
UNITS="afldb-settle-afltables.service afldb-settle-afltables.timer afldb-settle-afl-api.service afldb-settle-afl-api.timer
afldb-settle-afl-api-brownlow.service afldb-settle-afl-api-brownlow.timer afldb-email-intake.service afldb-email-intake.timer"
HERE=$(cd "$(dirname "$0")" && pwd)
[ "$(hostname)" = afldb-prod ] && [ "$(id -un)" = arm ] || stop "unexpected host/user" 3
[ -x "$NODE" ] && [ -x "$PGBIN/psql" ] || stop "missing node or psql" 3

# stage table: request file, its sha256, snapshot label (observe stages), receipts BEFORE, receipts AFTER (operation=count, sorted by operation)
stage_table() {
  case "$1" in
    b0) REQ=requests/b0-fixture-identities.json; REQ_SHA=71941fbeb2a52890; LABEL=afl-api-2025-2026-10-20-014218; SNAPDIR=fixtures/$LABEL; MANIFEST=46a793d8874ff7e1063e4323cb14154f7852dfd184679588dfae58f59b769b36; BEFORE=""; AFTER="observe=1" ;;
    b1) REQ=requests/b1-observe.json; REQ_SHA=91a54c4050e9ac41; LABEL=afl-api-brownlow-2025-2026-10-20-014218; SNAPDIR=brownlow/$LABEL; MANIFEST=43dec3ee84e2bd622a9d33899eb16896487d5344f5225eaa819b5a1262bb47f3; BEFORE="observe=1"; AFTER="observe=2" ;;
    b2) REQ=requests/b2-backfill.json; REQ_SHA=606e0ad4086c5ff5; LABEL=""; SNAPDIR=""; MANIFEST=""; BEFORE="observe=2"; AFTER="backfill=1,observe=2" ;;
    b3) REQ=requests/b3-adopt.json; REQ_SHA=50e00e7ffab82de5; LABEL=""; SNAPDIR=""; MANIFEST=""; BEFORE="backfill=1,observe=2"; AFTER="adopt=1,backfill=1,observe=2" ;;
    e)  REQ=requests/e-eligibility.json; REQ_SHA=563f336ea92a549d; LABEL=""; SNAPDIR=""; MANIFEST=""; BEFORE="adopt=1,backfill=1,observe=2"; AFTER="adopt=1,backfill=1,eligibility=1,observe=2" ;;
    *) stop "stage must be b0, b1, b2, b3 or e" 2 ;;
  esac
}

hs_parse_dsn() { # key role ; PG* for this process only, identity checked, value never printed
  local key=$1 role=$2 envf="$CHK/.env" line pwenc
  [ -r "$envf" ] || stop "env file unreadable" 2
  [ "$(grep -c "^$key=" "$envf")" = 1 ] || stop "$key must appear exactly once in .env" 2
  line=$(sed -n "s/^$key=//p" "$envf" | sed 's/^"\(.*\)"$/\1/'); [ -n "$line" ] || stop "$key empty" 2
  local re='^(postgres|postgresql)://([^:@/]+):([^@]*)@([^/:?]+)(:([0-9]+))?/([^?/]+)$'
  [[ "$line" =~ $re ]] || { unset line; stop "$key has an unexpected form (value not printed)" 2; }
  PGUSER=${BASH_REMATCH[2]}; pwenc=${BASH_REMATCH[3]}; PGHOST=${BASH_REMATCH[4]}; PGPORT=${BASH_REMATCH[6]:-5432}; PGDATABASE=${BASH_REMATCH[7]}
  [ -n "$pwenc" ] || stop "$key has no password (value not printed)" 2
  PGPASSWORD=$(printf '%b' "${pwenc//\%/\\x}"); HS_DSN=$line; unset pwenc line BASH_REMATCH
  echo "dsn_identity key=$key user=$PGUSER host=$PGHOST port=$PGPORT database=$PGDATABASE"
  [ "$PGUSER" = "$role" ] && [ "$PGDATABASE" = "$EXPECT_DB" ] && [ "$PGHOST" = "$EXPECT_DSN_HOST" ] && [ "$PGPORT" = "$EXPECT_DSN_PORT" ] \
    || stop "$key is not $role@$EXPECT_DSN_HOST:$EXPECT_DSN_PORT/$EXPECT_DB" 2
  export PGUSER PGHOST PGPORT PGDATABASE PGPASSWORD PGCONNECT_TIMEOUT=10
}
RO='-c default_transaction_read_only=on -c statement_timeout=120000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=120000'
q() { PGOPTIONS="$RO" PGAPPNAME=afldb-blockb-read "$PGBIN/psql" -X -q -At -F "$(printf '\t')" -P pager=off -v ON_ERROR_STOP=1 "$@"; }
backup_identity() {
  hs_parse_dsn AFLDB_BACKUP_DATABASE_URL afldb_backup
  local ident; ident=$(q -c "SELECT current_database(), (SELECT oid FROM pg_database WHERE datname=current_database()), (SELECT system_identifier::text FROM pg_control_system()), current_setting('transaction_read_only')") || stop "identity query failed" 5
  [ "$ident" = "$(printf '%s\t%s\t%s\ton' "$EXPECT_DB" "$EXPECT_OID" "$EXPECT_SYSID")" ] || stop "identity differs from the reviewed target: $ident" 5
  echo "identity ok"
}
no_writers() {
  local u e a out x
  for u in $UNITS; do
    e=$(systemctl is-enabled "$u" 2>/dev/null); a=$(systemctl is-active "$u" 2>/dev/null)
    case "$e" in enabled|enabled-runtime|linked|linked-runtime|alias) stop "writer unit $u is $e" 4;; esac
    case "$a" in active|activating|reloading) stop "writer unit $u is $a" 4;; esac
  done
  out=$(pgrep -af 'settle-afltables|settle-afl-api|acquire-afl-api|tools/db/migrate\.ts|backup\.sh|pg_dump|pg_restore|afl-api-fixture-window|apply-gap029|brownlow-production-correction'); x=$?
  [ "$x" -le 1 ] || stop "process check failed (pgrep exit $x)" 4
  [ "$x" = 1 ] || { printf '%s\n' "$out"; stop "a settle, migration, dump, restore, window, label or Brownlow process is running" 4; }
  if crontab -l >/dev/null 2>&1; then stop "arm has a crontab" 4; fi
  echo "no writer unit enabled or active; no writer process; no crontab"
}
clean_at() {
  [[ $1 =~ ^[0-9a-f]{40}$ ]] || stop "not a 40-hex revision: $1" 2
  [ "$(git -C "$CHK" rev-parse HEAD)" = "$1" ] || stop "checkout HEAD is $(git -C "$CHK" rev-parse HEAD), expected $1" 3
  [ -z "$(git -C "$CHK" status --porcelain)" ] || stop "checkout has changes" 3
  git -C "$CHK" diff --quiet && git -C "$CHK" diff --cached --quiet || stop "tracked or staged changes" 3
}
receipts() { q -c "SELECT coalesce(string_agg(operation||'='||n, ',' ORDER BY operation), '') FROM (SELECT operation, count(*) AS n FROM brownlow_correction_receipts GROUP BY operation) t"; }
digest2026() { q -c "SELECT count(*)||':'||md5(coalesce(string_agg(md5(to_jsonb(x)::text), '|' ORDER BY md5(to_jsonb(x)::text)), '')) FROM brownlow_round_votes x WHERE season = 2026"; }
facts() { q -c "SELECT (SELECT count(*) FROM brownlow_round_votes), (SELECT count(*) FROM brownlow_round_votes WHERE season=2026), (SELECT count(*) FROM brownlow_round_votes WHERE season BETWEEN 1984 AND 2025 AND match_id IS NOT NULL), (SELECT count(*) FROM brownlow_round_votes WHERE season=2025 AND source_id IS NULL), (SELECT count(*) FROM brownlow_round_votes WHERE season=2025 AND source_id IS NOT NULL), (SELECT count(*) FROM staging.afl_api_brownlow_vote WHERE season=2025), (SELECT count(*) FROM brownlow_eligibility_decisions)" | tr '\t' '|'; }
BDIR_OF() { echo "/home/arm/ops/blockb-${1:0:12}"; }
common_pre() { # R stage
  clean_at "$1"; no_writers; backup_identity
  local l rows last dig; l=$(q -c "SELECT name, checksum FROM afldb_meta.schema_migrations ORDER BY name COLLATE \"C\"") || stop "ledger query failed" 5
  rows=$(printf '%s\n' "$l" | wc -l); last=$(printf '%s\n' "$l" | tail -1 | cut -f1); dig=$(printf '%s\n' "$l" | sha256sum | cut -c1-64)
  echo "ledger rows=$rows last=$last digest=$dig"
  [ "$rows" = 118 ] && [ "$last" = "$MIG118" ] && [ "$dig" = "$L118_DIGEST" ] || stop "ledger is not the 118 state (Block M-a must be complete): a Brownlow plan from another ledger is void" 5
}
reqfile() { # stage -> path of the pinned request, verified
  stage_table "$1"; local f="$HERE/$REQ"
  [ -f "$f" ] && [ "$(sha256sum < "$f" | cut -c1-16)" = "$REQ_SHA" ] || stop "request file missing or not the pinned bytes" 3
  echo "$f"
}

case "$PHASE" in
pre)
  R=${1:?R}; S=${2:?stage}; stage_table "$S"
  step "pre $S: checkout, writers, identity, ledger 118, receipts"
  common_pre "$R" "$S"
  got=$(receipts); echo "receipts=[$got] expected before=[$BEFORE]"
  [ "$got" = "$BEFORE" ] || stop "receipts are not exactly what stage $S expects before it runs (an earlier stage is missing, repeated or foreign)" 5
  D26=$(digest2026); echo "votes2026=$D26"
  BD=$(BDIR_OF "$R"); mkdir -p -m 700 "$BD"
  if [ ! -e "$BD/votes2026.digest" ]; then [ "$S" = b0 ] || stop "no recorded 2026 digest: stage b0 must run first" 5; echo "$D26" > "$BD/votes2026.digest"; fi
  [ "$(cat "$BD/votes2026.digest")" = "$D26" ] || stop "the 2026 vote rows changed since b0 (Brownlow 2026 must stay byte-identical)" 5
  echo "facts total|2026|inscope_match_id|2025_nosource|2025_source|staged2025|decisions = $(facts)"
  [ "$(q -c "SELECT count(*) FROM brownlow_round_votes WHERE season=2026")" = 9522 ] || stop "2026 vote row count is not 9522" 5
  echo "PRE PASS $S"
  ;;
snapshots)
  S=${1:?stage}; stage_table "$S"; [ -n "$SNAPDIR" ] || stop "stage $S has no snapshot" 2
  step "snapshots $S: staged bytes equal the pinned list"
  cd "$CHK/data/sources/afl_api" 2>/dev/null || stop "no data/sources/afl_api in the checkout" 3
  [ -d "$SNAPDIR" ] || stop "snapshot $SNAPDIR is not staged" 3
  [ "$(sha256sum < "$SNAPDIR/manifest.json" | cut -c1-64)" = "$MANIFEST" ] || stop "manifest.json differs from the pinned bytes" 3
  grep " \*\?$SNAPDIR/" "$HERE/snapshots.sha256" > /tmp/blockb-snap-$$.txt || stop "no pinned lines for $SNAPDIR" 3
  n=$(wc -l < /tmp/blockb-snap-$$.txt); have=$(find "$SNAPDIR" -type f | wc -l)
  [ "$n" = "$have" ] || { rm -f /tmp/blockb-snap-$$.txt; stop "the snapshot holds $have files, the pin lists $n" 3; }
  sha256sum -c --quiet /tmp/blockb-snap-$$.txt || { rm -f /tmp/blockb-snap-$$.txt; stop "a snapshot file differs from the pinned bytes" 3; }
  rm -f /tmp/blockb-snap-$$.txt
  [ -z "$(git -C "$CHK" status --porcelain)" ] || stop "staging dirtied the checkout" 3
  echo "SNAPSHOTS PASS $S ($n files)"
  ;;
target)
  R=${1:?R}; S=${2:?stage}; stage_table "$S"; clean_at "$R"; no_writers
  BD=$(BDIR_OF "$R")/$S; mkdir -p -m 700 "$BD"; [ ! -e "$BD/target.json" ] || stop "target.json already exists for $S; evidence is never overwritten" 3
  backup_identity
  T=$(q -c "SELECT json_build_object('host','localhost','port',inet_server_port(),'database',current_database(),'user','afldb_owner','systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'databaseOid',(SELECT oid::text FROM pg_database WHERE datname=current_database()),'clusterName',current_setting('cluster_name'),'databaseComment',shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database'))")
  unset PGPASSWORD
  printf '%s\n' "$T" > "$BD/target.json"; chmod 600 "$BD/target.json"; cat "$BD/target.json"
  "$NODE" -e '
const t = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const want = { host: "localhost", port: 5432, database: "afldb_prod", user: "afldb_owner", systemIdentifier: "7674454702926115004", databaseOid: "66668", clusterName: "16/main", databaseComment: null };
const bad = Object.keys(want).filter((k) => JSON.stringify(t[k]) !== JSON.stringify(want[k]));
if (bad.length) { console.error("target differs from the reviewed facts: " + bad.join(",")); process.exit(1); }
console.log("target equals the reviewed facts (sysid, oid, cluster, owner role)");' "$BD/target.json" || stop "target mismatch" 5
  ;;
baseline|plan|apply)
  R=${1:?R}; S=${2:?stage}; shift 2; stage_table "$S"
  clean_at "$R"; no_writers
  BD=$(BDIR_OF "$R")/$S; [ -f "$BD/target.json" ] || stop "no target.json for $S: run the target phase" 3
  RUNNER=(node --import tsx --conditions=react-server tools/v2/brownlow-production-correction.ts)
  # The runner's DSN is the owner role's, handed to the child process alone as the dedicated secret variable (never argv, never printed).
  hs_parse_dsn AFLDB_OWNER_DATABASE_URL afldb_owner; DSN=$HS_DSN; unset PGPASSWORD HS_DSN
  export PATH="$(dirname "$NODE"):$PATH"
  cd "$CHK" || stop "no checkout" 3
  SNAP=(); [ -n "$LABEL" ] && SNAP=(--snapshot-label "$LABEL")
  if [ "$PHASE" = baseline ]; then
    OUT="$BD/baseline-live.json"; [ ! -e "$OUT" ] || stop "baseline already exists for $S; take a new stage directory or a new revision, evidence is never overwritten" 3
    bash "$HERE/b-prod.sh" pre "$R" "$S" > /dev/null || stop "pre failed: no baseline is taken on a state this stage does not expect" 6
    step "baseline $S (read-only session)"; AFLDB_BROWNLOW_CORRECTION_DSN=$DSN "${RUNNER[@]}" baseline --target "$BD/target.json" --out "$OUT" || stop "baseline refused" 6
  elif [ "$PHASE" = plan ]; then
    BACKUP=${1:?backup.json}; BFILE=${2:?backup file}; RESTORE=${3:?restore evidence}
    [ -z "$LABEL" ] || bash "$HERE/b-prod.sh" snapshots "$S" || exit $?
    PRE=$(bash "$HERE/b-prod.sh" pre "$R" "$S") || { printf '%s\n' "$PRE"; stop "pre failed" 6; }
    OUT="$BD/plan.json"; [ ! -e "$OUT" ] || stop "a plan already exists for $S" 3
    step "plan $S (read-only session, no writes)"
    AFLDB_BROWNLOW_CORRECTION_DSN=$DSN "${RUNNER[@]}" plan --target "$BD/target.json" --request "$(reqfile "$S")" --backup "$BACKUP" --backup-file "$BFILE" --restore-evidence "$RESTORE" --out "$OUT" "${SNAP[@]}" || stop "plan refused" 6
    sha256sum "$OUT"
  else
    PLAN=${1:?plan.json}; APPROVAL=${2:?approval.json}; BFILE=${3:?backup file}; RESTORE=${4:?restore evidence}
    [ -f "$APPROVAL" ] || stop "no execution approval file: the owner has not approved" 3
    [ -z "$LABEL" ] || bash "$HERE/b-prod.sh" snapshots "$S" || exit $?
    bash "$HERE/b-prod.sh" pre "$R" "$S" > /dev/null || stop "pre failed at apply time; nothing was written" 6
    OUT="$BD/receipt.json"; [ ! -e "$OUT" ] || stop "a receipt file already exists for $S; a stage is never re-applied" 3
    "$NODE" -e '
const fs = require("fs"); const [plan, appr, R, S, reqSha] = process.argv.slice(1);
const p = JSON.parse(fs.readFileSync(plan, "utf8")), a = JSON.parse(fs.readFileSync(appr, "utf8")); const bad = [];
if (a.planDigest !== p.digest) bad.push("planDigest"); if (a.revision !== R) bad.push("revision");
if (a.operation !== p.request.operation) bad.push("operation"); if (JSON.stringify(a.seasons) !== JSON.stringify(p.request.seasons)) bad.push("seasons");
if (S === "b0" && a.stage !== "fixture-identities-2025") bad.push("stage");
if (typeof a.reference !== "string" || a.reference.trim().length < 20) bad.push("reference");
if (!(Date.parse(a.expiresAt) > Date.now())) bad.push("expired"); if (Date.parse(a.expiresAt) > Date.parse(p.expiresAt)) bad.push("expiry beyond the plan");
if (bad.length) { console.error("approval refused: " + bad.join(",")); process.exit(1); }
console.log("approval matches plan " + p.digest + " at " + R);' "$PLAN" "$APPROVAL" "$R" "$S" "$REQ_SHA" || stop "approval does not bind this plan and stage" 6
    step "apply $S (WRITES; one stage, one receipt; no retry)"
    AFLDB_BROWNLOW_CORRECTION_DSN=$DSN "${RUNNER[@]}" apply --plan "$PLAN" --approval "$APPROVAL" --backup-file "$BFILE" --restore-evidence "$RESTORE" --out "$OUT" "${SNAP[@]}"; x=$?
    unset DSN
    echo "RUNNER EXIT $x"; [ "$x" = 0 ] || stop "the runner refused or failed (the stage is one transaction; run accept to learn whether it committed). No retry." 7
    echo "APPLY RAN $S: now run: bash b-prod.sh accept $R $S"
  fi
  unset DSN
  ;;
accept)
  R=${1:?R}; S=${2:?stage}; stage_table "$S"
  step "accept $S (read-only)"
  clean_at "$R"; backup_identity
  got=$(receipts); echo "receipts=[$got] expected after=[$AFTER]"
  [ "$got" = "$AFTER" ] || stop "receipts after $S are not exactly [$AFTER]" 5
  BD=$(BDIR_OF "$R"); D26=$(digest2026); echo "votes2026=$D26"
  [ "$(cat "$BD/votes2026.digest")" = "$D26" ] || stop "the 2026 vote rows changed" 5
  F=$(facts); echo "facts total|2026|inscope_match_id|2025_nosource|2025_source|staged2025|decisions = $F"
  case "$S" in
    b0) want="330383|9522|0|9522|0|0|*" ;;       # canonical tables unchanged, no typed staging row
    b1) want="330383|9522|0|9522|0|621|*" ;;     # 621 typed staging rows, still no canonical vote change
    b2) want="330383|9522|320861|9522|0|621|*" ;;
    b3) want="330383|9522|320861|8901|621|621|*" ;;
    e)  want="330383|9522|320861|8901|621|621|12" ;;
  esac
  case "$F" in $want) ;; *) stop "row facts after $S differ from [$want]" 5;; esac
  echo "ACCEPT PASS $S"
  ;;
*) stop "unknown phase" 2 ;;
esac
}
