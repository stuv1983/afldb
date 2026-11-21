#!/usr/bin/env bash
# Release 7 revision 3 (R7R3), block D2-D4 (and pre-publication recovery R1) = the guarded 2026 Brownlow attachment through the CAND
# checkout's tools/v2/brownlow-season-attach.ts. PRODUCTION, as arm. One step per connection:
#   target          READ-ONLY. Writes <data>/target.json (0600): host/port/database/user from AFLDB_IMPORT_DATABASE_URL (never printed)
#                   plus the live identity (system identifier, database OID, cluster name, comment). Must be afldb_prod / 66668 /
#                   7674454702926115004. Prints the active super-admin ids (ids and roles only) for the owner to name the actor.
#   plan            READ-ONLY (REPEATABLE READ READ ONLY). Writes <data>/plan-2026.json. Expect rows=9522 positive=621 votes=1242
#                   matches=207/207 attach=9522 mirror=9522. Prints the digest and the plan file sha256 for the owner's review. The
#                   digest the 18 Nov production dump produced is 100c112f...76aa7; a different digest is a STOP for the owner.
#   dry   <digest> <actor>   the whole transaction, every check included, ROLLED BACK. Expect DRY-RUN ... unattached_after=0 mirror_after=9522.
#   commit <digest> <actor>  WRITES: attaches 9522 round rows, fills 9522 match-mirror cells (NULL -> value), one sealed audit row.
#                   Only after D1v PASS, the owner's digest review and a passing dry run. Then run r7r3-a1-facts.sh attached.
#   reverse-dry / reverse-commit <digest> <actor>   R1, ONLY BEFORE PUBLICATION: exact reversal from the same export (refuses
#                   `already_published` once 2026 is published).
# The DSN reaches the tool only through AFLDB_BROWNLOW_ATTACH_DSN in a subshell environment (never argv, never printed). No force flag.
# Run: tr -d '\r' < r7r3-d2-attach.sh | ssh afldb bash -s -- <STAMP> <target|plan|dry|commit|reverse-dry|reverse-commit> [<digest> <actor>]
main() {
set -euo pipefail; export LC_ALL=C; umask 077
trap 'echo "STOP line $LINENO: $BASH_COMMAND"' ERR
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH
C=${R7R3_CHECKOUT:-/home/arm/projects/afldb}; ENVF=${R7R3_ENV_FILE:-$C/.env}; DSNVAR=${R7R3_ATTACH_DSN_ENV:-AFLDB_IMPORT_DATABASE_URL}; BKVAR=${R7R3_DSN_ENV:-AFLDB_BACKUP_DATABASE_URL}
CAND=c8d4202a4cb3cf0ccdd1cad01e1227a1610c2d76; EXPECT_DIGEST=${R7R3_EXPECT_DIGEST:-100c112f400a492906cbc2a5c3886243c15d412eb62f84d50f17c63ae1f76aa7}
IDW=${R7R3_IDENTITY:-afldb_prod|66668|7674454702926115004}
STAMP=${1:?STAMP}; [[ $STAMP =~ ^[0-9]{8}T[0-9]{6}Z$ ]]; MODE=${2:?mode}; [[ $MODE =~ ^(target|plan|dry|commit|reverse-dry|reverse-commit)$ ]]
A=${R7R3_DATA:-/home/arm/r7r3-data-$STAMP}; [ -d "$A" ]; [ "$(stat -c %a "$A")" = 700 ]
cd "$C"; [ "$(git rev-parse HEAD)" = "$CAND" ]; [ -z "$(git status --porcelain)" ]
echo "== R7R3 D $MODE $(date -u +%FT%TZ) checkout=CAND"
NOTE="Release 7R3 window $STAMP, owner approval R7R3: attach the official 2026 count (AFLDB-ISSUE-370)"
attach() { ( set -a && . "$ENVF" && set +a; export AFLDB_BROWNLOW_ATTACH_DSN=${!DSNVAR}
  for v in $(compgen -e | grep -E '_DATABASE_URL$|^DATABASE_URL$|^PG' || true); do unset "$v"; done
  node --import tsx --conditions=react-server tools/v2/brownlow-season-attach.ts "$@" ); }
case $MODE in
target)
  [ ! -e "$A/target.json" ]
  ( set -a && . "$ENVF" && set +a; export R7R3_DSN=${!DSNVAR}; node --input-type=module -e '
    import { createRequire } from "node:module"; const postgres = createRequire(process.cwd() + "/package.json")("postgres");
    const u = new URL(process.env.R7R3_DSN);
    if (u.search || u.hash) { console.error("STOP the import DSN carries a query string; the attachment transport refuses it"); process.exit(1); }
    const sql = postgres(u.toString(), { max: 1, connect_timeout: 5, onnotice: () => {}, connection: { default_transaction_read_only: true } });
    const [r] = await sql.unsafe(`SELECT current_database() AS database, current_user AS "user", c.system_identifier::text AS "systemIdentifier", d.oid::text AS "databaseOid",
      current_setting(\x27cluster_name\x27) AS "clusterName", shobj_description(d.oid, \x27pg_database\x27) AS "databaseComment"
      FROM pg_control_system() c CROSS JOIN pg_database d WHERE d.datname = current_database()`);
    await sql.end();
    const t = { host: u.hostname, port: Number(u.port || 5432), database: r.database, user: r.user, systemIdentifier: r.systemIdentifier,
      databaseOid: r.databaseOid, clusterName: r.clusterName, databaseComment: r.databaseComment };
    if (decodeURIComponent(u.username) !== r.user || decodeURIComponent(u.pathname.slice(1)) !== r.database) { console.error("STOP DSN and live identity disagree"); process.exit(1); }
    process.stdout.write(JSON.stringify(t) + "\n");
  ' > "$A/target.json" )
  chmod 600 "$A/target.json"
  ID=$(node -e 'const t=require(process.argv[1]);console.log([t.database,t.databaseOid,t.systemIdentifier].join("|"))' "$A/target.json")
  echo "target: $(node -e 'const t=require(process.argv[1]);console.log(t.host+":"+t.port, t.database, t.user, t.clusterName, t.databaseOid, t.systemIdentifier)' "$A/target.json")"
  [ "$ID" = "$IDW" ] || { echo "STOP target identity $ID is not $IDW"; exit 1; }
  echo "target.json sha256 $(sha256sum "$A/target.json" | cut -c1-64)"
  # Actor candidates through the read-only backup role (the import role cannot read auth_users): ids and roles only.
  ( set -a && . "$ENVF" && set +a
    re='^(postgres(ql)?://)([^:/@]+):([^@]*)@(.*)$'; d=${!BKVAR}; [[ $d =~ $re ]] || { echo "bad DSN shape" >&2; exit 1; }
    printf -v PGPASSWORD '%b' "${BASH_REMATCH[4]//\%/\\x}"; export PGPASSWORD
    PGOPTIONS='-c default_transaction_read_only=on' psql -X -q -v ON_ERROR_STOP=1 -At -F ' ' -d "${BASH_REMATCH[1]}${BASH_REMATCH[3]}@${BASH_REMATCH[5]}" \
      -c "SELECT 'ACTOR-CANDIDATE', id, role FROM auth_users WHERE role = 'super_admin' AND disabled_at IS NULL ORDER BY id" )
  echo "D RESULT target PASS" ;;
plan)
  [ -s "$A/target.json" ]; [ ! -e "$A/plan-2026.json" ]
  OUT=$(attach plan --target "$A/target.json" --season 2026 --out "$A/plan-2026.json" 2>&1) || { echo "$OUT"; echo "D RESULT plan FAIL"; exit 1; }
  echo "$OUT"
  DIG=$(node -e 'console.log(require(process.argv[1]).digest)' "$A/plan-2026.json"); [[ $DIG =~ ^[0-9a-f]{64}$ ]]
  grep -qx "PLAN season=2026 rows=9522 positive=621 votes=1242 matches=207/207 attach=9522 mirror=9522 digest=$DIG" <<< "$OUT"
  echo "plan file sha256 $(sha256sum "$A/plan-2026.json" | cut -c1-64)"
  if [ "$DIG" = "$EXPECT_DIGEST" ]; then echo "PASS digest equals the 18 Nov production-dump rehearsal digest"
  else echo "STOP digest $DIG differs from the rehearsal digest $EXPECT_DIGEST: the owner reviews the plan before anything else"; exit 1; fi
  echo "D RESULT plan PASS digest=$DIG" ;;
dry|commit|reverse-dry|reverse-commit)
  DIG=${3:?digest}; ACT=${4:?actor}; [[ $DIG =~ ^[0-9a-f]{64}$ ]]; [[ $ACT =~ ^[0-9]{1,9}$ ]]
  [ -s "$A/target.json" ] && [ -s "$A/plan-2026.json" ]
  [ "$(node -e 'console.log(require(process.argv[1]).digest)' "$A/plan-2026.json")" = "$DIG" ]
  case $MODE in dry) OP=apply; FL=(); OUTF=dry;; commit) OP=apply; FL=(--commit); OUTF=apply;;
    reverse-dry) OP=reverse; FL=(); OUTF=reverse-dry;; reverse-commit) OP=reverse; FL=(--commit); OUTF=reverse;; esac
  R="$A/$OUTF-2026-$(date -u +%H%M%S).json"
  rc=0; OUT=$(attach "$OP" --target "$A/target.json" --export "$A/plan-2026.json" --digest "$DIG" --actor "$ACT" --note "$NOTE" --out "$R" ${FL[@]+"${FL[@]}"} 2>&1) || rc=$?
  echo "$OUT"; echo "exit=$rc"
  [ $rc = 0 ] || { echo "D RESULT $MODE FAIL (exit $rc): run r7r3-a1-facts.sh to establish the state before anything else"; exit 1; }
  case $MODE in
    dry)    grep -qx "APPLY DRY-RUN (rolled back) season=2026 attached=9522 mirrored=9522 unattached_after=0 mirror_after=9522 audit=- digest=$DIG" <<< "$OUT" ;;
    commit) grep -qE "^APPLY COMMITTED season=2026 attached=9522 mirrored=9522 unattached_after=0 mirror_after=9522 audit=[0-9]+ digest=$DIG$" <<< "$OUT" ;;
    reverse-dry)    grep -qx "REVERSE DRY-RUN (rolled back) season=2026 attached=-9522 mirrored=-9522 unattached_after=9522 mirror_after=0 audit=- digest=$DIG" <<< "$OUT" ;;
    reverse-commit) grep -qE "^REVERSE COMMITTED season=2026 attached=-9522 mirrored=-9522 unattached_after=9522 mirror_after=0 audit=[0-9]+ digest=$DIG$" <<< "$OUT" ;;
  esac
  echo "result file $R sha256 $(sha256sum "$R" | cut -c1-64)"
  echo "D RESULT $MODE PASS" ;;
esac
}
main "$@" < /dev/null
