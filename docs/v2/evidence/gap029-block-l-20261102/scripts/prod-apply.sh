:
{
# Block L APPLY. PREPARED, NOT RUN. It refuses to start without an owner execution approval file naming this exact plan digest,
# revision and target; the preparing session never creates that file. One run = one tool apply, then read-only verification, then a replay.
#   bash prod-apply.sh <R> <plan-file-sha256> <approval.json> <backup-file> <restore-evidence>
# No partial-failure retry exists here: a stop leaves committed labels (each label is its own audited transaction); recovery is a NEW
# backup, restore, baseline, plan and approval (section "Partial failure" of the execution-ready record).
set -u -o pipefail
export LC_ALL=C
umask 077
step() { echo "== $* $(date -u +%FT%TZ)"; }
stop() { echo "STOP: $1"; exit "${2:-1}"; }
R=${1:?revision}; PLAN_SHA=${2:?plan file sha256}; APPROVAL=${3:?approval.json}; BFILE=${4:?backup file}; RESTORE=${5:?restore evidence}
[[ "$R" =~ ^[0-9a-f]{40}$ ]] || stop "revision must be 40 hex" 2
PROD=/home/arm/projects/afldb; PGBIN=/usr/lib/postgresql/16/bin
OPS=/home/arm/ops/gap029-labels-${R:0:8}; CAND=$OPS/cand; EV=$OPS/evidence; PLAN=$EV/plan-1.json
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
envval() { sed -n "s/^$1=//p" "$PROD/.env" | tail -1 | sed 's/^"\(.*\)"$/\1/'; }
[ "$(hostname)" = afldb-prod ] && [ "$(id -un)" = arm ] || stop "unexpected host/user" 3

step "A0 approval, plan and checkout"
[ -f "$APPROVAL" ] || stop "no execution approval file: the owner has not approved" 3
[ "$(sha256sum "$PLAN" | cut -d' ' -f1)" = "$PLAN_SHA" ] || stop "plan file differs from the reviewed bytes" 3
cd "$CAND" || stop "no ops checkout" 3
[ "$(git rev-parse HEAD)" = "$R" ] && [ "$(git status --porcelain | wc -l)" = 0 ] || stop "ops checkout not clean at $R" 3
node -e '
const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")),a=JSON.parse(fs.readFileSync(process.argv[2],"utf8")),now=Date.now();
const bad=[];
if(a.planDigest!==p.digest)bad.push("planDigest");if(a.revision!==process.argv[3])bad.push("revision");if(a.operation!==p.operation)bad.push("operation");
if(JSON.stringify(a.target)!==JSON.stringify(p.target)&&JSON.stringify(Object.entries(a.target).sort())!==JSON.stringify(Object.entries(p.target).sort()))bad.push("target");
if(a.evidenceSha256!==p.evidenceSha256)bad.push("evidenceSha256");if(!(Date.parse(a.expiresAt)>now))bad.push("approval expired");if(Date.parse(a.expiresAt)>Date.parse(p.expiresAt))bad.push("approval outlives plan");
if(!String(a.reference||"").trim())bad.push("reference");
const left=Date.parse(p.backup.capturedAt)+24*3600*1000-now;if(!(left>20*60*1000))bad.push("backup freshness left "+Math.round(left/60000)+" min (need >20)");
if(bad.length){console.error("approval/plan check failed: "+bad.join(", "));process.exit(1)}
console.log("approval matches plan "+p.digest.slice(0,12)+"; backup freshness left "+Math.round(left/60000)+" min");' "$PLAN" "$APPROVAL" "$R" || stop "approval does not match the reviewed plan" 3
[ "$(sha256sum "$BFILE" | cut -d' ' -f1)" = "$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).backup.sha256)' "$PLAN")" ] || stop "backup file differs from the plan" 3

step "A1 exclusivity gate (read-only)"
for u in afldb-settle-afltables.service afldb-settle-afl-api.service afldb-settle-afl-api-brownlow.service afldb-email-intake.service; do
  case "$(systemctl is-active "$u" 2>/dev/null)" in active|activating|reloading) stop "writer $u is running" 4;; esac
done
pgrep -af 'settle-|afl-api-|migrate\.ts|pg_dump|pg_restore|apply-gap029|brownlow-production-correction|afl-api-fixture-window' | grep -v -E "pgrep|prod-apply.sh" && stop "a writer, migration, dump or correction process is running" 4
echo "no conflicting process; app: $(systemctl is-active afldb.service) MainPID=$(systemctl show afldb.service -p MainPID --value)"

step "A2 tool apply (per-label audited commits)"
export AFLDB_GAP029_DSN=$(envval AFLDB_BACKUP_DATABASE_URL) AFLDB_IMPORT_DATABASE_URL=$(envval AFLDB_IMPORT_DATABASE_URL) DATABASE_URL=$(envval DATABASE_URL)
RUN="node --import tsx --conditions=react-server tools/v2/apply-gap029-match-events-production.ts"
$RUN apply --plan "$PLAN" --approval "$APPROVAL" --backup-file "$BFILE" --restore-evidence "$RESTORE" --out "$EV/result-1.json"
RC=$?; echo "apply exit=$RC"
[ $RC = 0 ] || { echo "PARTIAL OR REFUSED: do NOT re-run this plan. Read-only count below; recovery = new backup, restore, baseline, plan, approval."; }
unset AFLDB_GAP029_DSN AFLDB_IMPORT_DATABASE_URL DATABASE_URL

step "A3 read-only verification (afldb_backup)"
DSN=$(envval AFLDB_BACKUP_DATABASE_URL); RE='^([a-z]+)://([^:@/]+)(:([^@]*))?@([^/:?]+)(:([0-9]+))?/([^?]+).*$'
[[ "$DSN" =~ $RE ]] || stop "credential form" 2
export PGUSER=${BASH_REMATCH[2]} PGHOST=${BASH_REMATCH[5]} PGPORT=${BASH_REMATCH[7]:-5432} PGDATABASE=${BASH_REMATCH[8]}; PWENC=${BASH_REMATCH[4]}
export PGPASSWORD=$(printf '%b' "${PWENC//\%/\\x}"); unset PWENC DSN BASH_REMATCH
q() { PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=60000' "$PGBIN/psql" -X -q -At -F "$(printf '\t')" -v ON_ERROR_STOP=1 "$@"; }
q -c "SELECT 'labelled', match_event, count(*)::text FROM matches WHERE match_event IS NOT NULL GROUP BY 2 ORDER BY 2"
q -c "SELECT 'edits_match_event', count(*)::text FROM data_edits WHERE table_name='matches' AND field_group='match_event'"
q -c "SELECT 'overrides_match_event_active', count(*)::text FROM data_overrides WHERE entity_type='matches' AND field_group='match_event' AND is_active"
unset PGPASSWORD
[ $RC = 0 ] || stop "apply did not complete; see above" 6

step "A4 replay of the same plan and approval (expects: already applied, writes nothing)"
export AFLDB_GAP029_DSN=$(envval AFLDB_BACKUP_DATABASE_URL) AFLDB_IMPORT_DATABASE_URL=$(envval AFLDB_IMPORT_DATABASE_URL) DATABASE_URL=$(envval DATABASE_URL)
$RUN apply --plan "$PLAN" --approval "$APPROVAL" --backup-file "$BFILE" --restore-evidence "$RESTORE" --out "$EV/replay-1.json" || stop "replay refused" 7
unset AFLDB_GAP029_DSN AFLDB_IMPORT_DATABASE_URL DATABASE_URL
echo "head=$(git rev-parse HEAD) status_lines=$(git status --porcelain | wc -l)"
step DONE
}
