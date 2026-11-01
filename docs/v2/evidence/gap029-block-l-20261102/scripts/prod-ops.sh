:
{
# Block L production-side operations: prep (private pinned ops checkout), baseline, plan. NO apply mode exists here.
#   bash prod-ops.sh prep     <R> <cand-tar-sha256>
#   bash prod-ops.sh baseline <R> <label>
#   bash prod-ops.sh plan     <R> <backup.json> <backup-file> <restore-evidence> <actor-id> <out-name>
# The primary production checkout is only READ (its node_modules is linked read-only into the private ops checkout; nothing in it,
# the serving release, the environment file, units or services is changed). DB access is the existing credential channel in the
# checkout .env, parsed into environment variables for the child process only (never argv, never printed). The validation
# connection is afldb_backup (read-only); the audited-writer URLs are exported only so the tool can prove they name the same target.
set -u -o pipefail
export LC_ALL=C
umask 077
step() { echo "== $* $(date -u +%FT%TZ)"; }
stop() { echo "STOP: $1"; exit "${2:-1}"; }
PHASE=${1:?phase}; R=${2:?revision}
[[ "$R" =~ ^[0-9a-f]{40}$ ]] || stop "revision must be 40 hex" 2
PROD=/home/arm/projects/afldb
PGBIN=/usr/lib/postgresql/16/bin
OPS=/home/arm/ops/gap029-labels-${R:0:8}
CAND=$OPS/cand; EV=$OPS/evidence
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
[ "$(hostname)" = afldb-prod ] && [ "$(id -un)" = arm ] || stop "unexpected host/user" 3
envval() { sed -n "s/^$1=//p" "$PROD/.env" | tail -1 | sed 's/^"\(.*\)"$/\1/'; }

case "$PHASE" in
prep)
  TAR_SHA=${3:?tar sha256}
  step "prep: verify upload, extract, pin"
  [ -f "$OPS/in/cand.tar.gz" ] || stop "upload missing" 3
  [ "$(sha256sum "$OPS/in/cand.tar.gz" | cut -d' ' -f1)" = "$TAR_SHA" ] || stop "cand.tar.gz sha256 mismatch" 3
  [ ! -e "$CAND" ] || stop "ops checkout already exists" 3
  mkdir -p -m 700 "$EV"
  tar xzf "$OPS/in/cand.tar.gz" -C "$OPS" || stop "extract failed" 3
  cd "$CAND" || stop "no checkout" 3
  [ "$(git rev-parse HEAD)" = "$R" ] || stop "HEAD is not $R" 3
  [ "$(git status --porcelain | wc -l)" = 0 ] || stop "ops checkout dirty" 3
  [ "$(sha256sum package-lock.json | cut -d' ' -f1)" = "$(sha256sum $PROD/package-lock.json | cut -d' ' -f1)" ] || stop "package-lock differs from the production checkout (node_modules not reusable)" 3
  [ "$(sha256sum package.json | cut -d' ' -f1)" = "$(sha256sum $PROD/package.json | cut -d' ' -f1)" ] || stop "package.json differs from the production checkout" 3
  ln -s "$PROD/node_modules" "$CAND/node_modules"
  echo node_modules >> "$CAND/.git/info/exclude"
  [ "$(git status --porcelain | wc -l)" = 0 ] || stop "node_modules link dirtied the tree" 3
  echo "ops_checkout=$CAND HEAD=$(git rev-parse HEAD) tracked=$(git ls-files | wc -l) dirty=0 node=$(node -v)"
  echo "prod_checkout_unchanged: head=$(GIT_OPTIONAL_LOCKS=0 git -C $PROD rev-parse HEAD) status_lines=$(GIT_OPTIONAL_LOCKS=0 git -C $PROD status --porcelain | wc -l)"
  (cd "$CAND" && node --import tsx --conditions=react-server -e "import('./tools/v2/gap029-label-checks.ts').then(m=>console.log('tool modules load: entryProblem', typeof m.entryProblem))") || stop "tsx cannot load the checkout" 3
  ;;
baseline|plan)
  LABEL=${3:?label}
  cd "$CAND" || stop "no ops checkout (run prep)" 3
  [ "$(git rev-parse HEAD)" = "$R" ] && [ "$(git status --porcelain | wc -l)" = 0 ] || stop "ops checkout not clean at $R" 3
  RE='^([a-z]+)://([^:@/]+)(:([^@]*))?@([^/:?]+)(:([0-9]+))?/([^?]+).*$'
  DSN=$(envval AFLDB_BACKUP_DATABASE_URL); [ -n "$DSN" ] || stop "backup credential missing" 2
  [[ "$DSN" =~ $RE ]] || stop "backup credential has an unexpected form (value not printed)" 2
  PGUSER=${BASH_REMATCH[2]}; PGHOST=${BASH_REMATCH[5]}; PGPORT=${BASH_REMATCH[7]:-5432}; PGDATABASE=${BASH_REMATCH[8]}; PWENC=${BASH_REMATCH[4]}
  PGPASSWORD=$(printf '%b' "${PWENC//\%/\\x}"); unset PWENC BASH_REMATCH
  [ "$PGUSER" = afldb_backup ] && [ "$PGDATABASE" = afldb_prod ] && [ "$PGHOST" = localhost ] && [ "$PGPORT" = 5432 ] || stop "credential is not afldb_backup@localhost:5432/afldb_prod" 2
  export PGUSER PGHOST PGPORT PGDATABASE PGPASSWORD PGCONNECT_TIMEOUT=10
  RO='-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=2000'
  step "target identity from independent facts (read-only session)"
  PGOPTIONS="$RO" PGAPPNAME=afldb-gap029-labels-target "$PGBIN/psql" -X -q -At -P pager=off -v ON_ERROR_STOP=1 -c "SELECT json_build_object('host', 'localhost', 'port', inet_server_port(), 'database', current_database(), 'user', current_user,
    'systemIdentifier', (SELECT system_identifier::text FROM pg_control_system()), 'databaseOid', (SELECT oid::text FROM pg_database WHERE datname=current_database()),
    'clusterName', current_setting('cluster_name'), 'databaseComment', shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database'))" > "$EV/target-$LABEL.json" || stop "target query failed" 5
  cat "$EV/target-$LABEL.json"
  node -e '
const t=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
const want={host:"localhost",port:5432,database:"afldb_prod",user:"afldb_backup",systemIdentifier:"7674454702926115004",databaseOid:"66668",clusterName:"16/main",databaseComment:null};
const bad=Object.keys(want).filter(k=>JSON.stringify(t[k])!==JSON.stringify(want[k]));
if(bad.length){console.error("target differs from the probe facts:",bad.join(","));process.exit(1);} console.log("target equals the probe facts (sysid, oid, cluster, user)");' "$EV/target-$LABEL.json" || stop "target identity differs from the reviewed probe" 5
  export AFLDB_GAP029_DSN=$(envval AFLDB_BACKUP_DATABASE_URL) AFLDB_IMPORT_DATABASE_URL=$(envval AFLDB_IMPORT_DATABASE_URL) DATABASE_URL=$(envval DATABASE_URL)
  unset PGPASSWORD
  RUN="node --import tsx --conditions=react-server tools/v2/apply-gap029-match-events-production.ts"
  if [ "$PHASE" = baseline ]; then
    step "tool baseline (read-only)"
    $RUN baseline --target "$EV/target-$LABEL.json" --out "$EV/baseline-$LABEL.json" || stop "baseline failed" 6
    node -e 'const b=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log("baselineDigest="+b.baselineDigest+" revision="+b.revision+" capturedAt="+b.capturedAt)' "$EV/baseline-$LABEL.json"
  else
    BACKUP=${4:?backup.json}; BFILE=${5:?backup file}; RESTORE=${6:?restore evidence}; ACTOR=${7:?actor id}; OUT=${8:?out name}
    step "tool plan (read-only; writes only the plan file)"
    $RUN plan --target "$EV/target-$LABEL.json" --actor-id "$ACTOR" --backup "$BACKUP" --backup-file "$BFILE" --restore-evidence "$RESTORE" --out "$EV/$OUT" || stop "plan refused" 6
    chmod 600 "$EV/$OUT"; sha256sum "$EV/$OUT"
  fi
  step "post-run: ops checkout still clean"
  echo "head=$(git rev-parse HEAD) status_lines=$(git status --porcelain | wc -l)"
  ;;
*) stop "unknown phase" 2 ;;
esac
step DONE
}
