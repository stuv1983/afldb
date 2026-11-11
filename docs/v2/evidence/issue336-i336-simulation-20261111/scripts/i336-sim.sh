#!/usr/bin/env bash
# AFLDB-ISSUE-336 (D-336-2) — SIMULATION ONLY, streamanator, 2026-11-11.
# End-to-end I336 run of the REAL GAP-029 workstation runner (gap029-stage.ts), production-host wrapper (prod-stage.sh, production mode, no
# --rehearsal), capture and restore/assembly at the pinned revision R = c1c4b22e, against a SIMULATED production host: a separate isolated
# PostgreSQL cluster (own system identifier, loopback, port 55494) holding afldb_simprod restored from the approved 2026-11-04 production
# snapshot (ISSUE-333 O2 capture, sha256 e77c307d...). Evidence class SIMULATION throughout. No production, DEV database, DEV service or
# shared database is contacted. ssh/scp are local stand-ins (lssh/lscp) that accept only the simulation host alias "dev" on this machine.
# Usage: bash i336-sim.sh <phase>   phases: setup prepare neg-pre approve apply post facts teardown
set -u -o pipefail
R=c1c4b22ee15007111eab66f6d354e0b9ecbb2ade
SIM=/mnt/ssd/afldb-i336-sim-20261111
PACK=/mnt/ssd/afldb-i336-simpack-20261111
SRC=/mnt/ssd/afldb-i336rel-qual-20261108T201140Z/cand
DUMP=/mnt/ssd/afldb/workspaces/afldb-issue333-o2-20261104/private/afldb_prod-20261104T021037Z.dump
DUMP_SHA=e77c307d3e0cddcb652e398a946e4c22c2063f13c70edadf96a975c92842826d
TOOLS=/mnt/ssd/afldb-i336-simtools-20261111
LOG=$TOOLS/logs
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH" LC_ALL=C
mkdir -p "$LOG"
PHASE=${1:?phase}
exec > >(tee -a "$LOG/$PHASE.log") 2>&1
say() { echo "$(date -u +%FT%TZ) $*"; }
NICE="nice -n 10 ionice -c2 -n7"
PG=/usr/lib/postgresql/16/bin

# Simulation environment for the runner: profile, local ssh/scp, remote env (the wrapper on the "host" reads the same simulation profile).
simenv() {
  export GAP029_PROFILE="$SIM/profile.sim.env" GAP029_RESTORE_PROFILE="$SIM/profile.sim.env" GAP029_REMOTE_ENV="GAP029_PROFILE=$SIM/profile.sim.env"
  export GAP029_SSH="$TOOLS/lssh" GAP029_SCP="$TOOLS/lscp" GAP029_SSH_GAP_MS=0
}
RUNNER() { (cd "$SRC" && simenv && $NICE node --import tsx tools/v2/gap029-stage.ts "$@"); }
WRAP() { (simenv && cd "$SIM" && $NICE bash "$SIM/ops/${R:0:8}/cand/tools/v2/gap029-ops/prod-stage.sh" "$@"); }
rundir() { ls -d "$SIM"/ws-runs/I336-* 2>/dev/null | head -1; }
# Cluster identity assertion before every state-changing step: the simulated production cluster is ours, loopback only, on 55494.
assert_sim() {
  local su; su=$(cat "$SIM/pg-sim/secrets/superuser.pw")
  local got; got=$(PGPASSWORD="$su" "$PG/psql" -X -At -h 127.0.0.1 -p 55494 -U afldb_v2_super -d postgres -c "SELECT current_setting('listen_addresses')||'|'||current_setting('port')||'|'||current_setting('data_directory')")
  unset su
  echo "sim cluster: $got"
  [[ "$got" == "127.0.0.1|55494|$SIM/pg-sim/"* ]] || { echo "STOP simulated cluster identity unexpected"; exit 9; }
}
facts() {  # read-only facts from the simulated production database (afldb_backup role, read-only session)
  local pw; pw=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).afldb_backup)' "$SIM/pg-sim/secrets/roles.json")
  PGPASSWORD="$pw" PGOPTIONS='-c default_transaction_read_only=on' "$PG/psql" -X -At -h 127.0.0.1 -p 55494 -U afldb_backup -d afldb_simprod -c "
    SELECT 'draft_picks total='||count(*)||' pre_draft='||count(*) FILTER (WHERE draft_kind='pre_draft')||' y1991_2025='||count(*) FILTER (WHERE draft_year BETWEEN 1991 AND 2025)||' i336_marked='||count(*) FILTER (WHERE confidence_notes LIKE 'AFLDB-ISSUE-336 bounded insert%') FROM draft_picks;
    SELECT 'draft_persons='||count(*) FROM draft_persons;
    SELECT 'i336_audit rows='||count(*)||' picks='||count(DISTINCT row_id)||' actors='||coalesce(string_agg(DISTINCT admin_user_id::text, ','),'-') FROM data_edits WHERE table_name='draft_picks' AND field_group='source_insert' AND note LIKE 'AFLDB-ISSUE-336 owner-approved correction%';
    SELECT 'ledger='||count(*)||' last='||max(name COLLATE \"C\") FROM afldb_meta.schema_migrations;"
  unset pw
}

case "$PHASE" in
setup)
  [ "$(sha256sum "$DUMP" | cut -d' ' -f1)" = "$DUMP_SHA" ] || { echo "STOP dump sha"; exit 3; }
  [ "$(git -C "$SRC" rev-parse HEAD)" = "$R" ] && [ -z "$(git -C "$SRC" status --porcelain)" ] || { echo "STOP source checkout is not a clean R"; exit 3; }
  for p in 55494 55493; do ss -ltn | awk '{print $4}' | grep -qE ":$p\$" && { echo "STOP port $p in use"; exit 3; }; done
  say "pack R from the clean R checkout (runner pack: shallow fetch into a fresh repository)"
  (cd "$SRC" && node --import tsx tools/v2/gap029-stage.ts pack --rev "$R" --out-dir "$PACK") || exit 4
  TAR=$PACK/pack-${R:0:8}/cand.tar.gz
  say "sim-setup (from R's own tools)"
  SIM=$SIM DUMP=$DUMP DUMP_SHA=$DUMP_SHA SRC_CAND=$SRC TAR=$TAR R=$R $NICE bash "$SRC/tools/v2/gap029-ops/sim/sim-setup.sh" || exit 5
  assert_sim; facts
  echo "TAR $TAR $(sha256sum "$TAR" | cut -d' ' -f1)"
  ;;
prepare)
  assert_sim
  TAR=$PACK/pack-${R:0:8}/cand.tar.gz; H=$(sha256sum "$TAR" | cut -d' ' -f1)
  RUNNER prepare --stage I336 --rev "$R" --tar "$TAR" --tar-sha256 "$H" --private-root "$SIM/ws-runs" --restore-workspace "$SIM/rw" --restore-host dev
  echo "prepare exit=$?"
  ;;
neg-pre)
  assert_sim; D=$(rundir); RUN=$(basename "$D"); DIG=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).digest)' "$D/plan.json")
  echo "run=$RUN digest=$DIG"
  say "N1 apply with no approval (expect refusal before mutation)"; RUNNER apply --run-dir "$D"; echo "N1 exit=$?"
  say "N2 approval with a wrong digest (expect refusal)"; RUNNER approve --run-dir "$D" --digest "$(printf '%064d' 0)" --expires "$(date -u -d '+90 min' +%FT%TZ)"; echo "N2 exit=$?"
  say "N3 wrong revision (no pinned checkout for it)"; WRAP preflight 09acd432a00000000000000000000000000000ab I336; echo "N3 exit=$?"
  say "N4 stage/run mismatch (an I336 run named under S3)"; WRAP plan "$R" S3 "$RUN"; echo "N4 exit=$?"
  say "N5 malformed run name"; WRAP report "$R" I336 "I336-2026111T000000Z"; echo "N5 exit=$?"
  say "N6 state after the refusals (expect BASELINE)"; RUNNER state --run-dir "$D"; echo "N6 exit=$?"
  facts
  ;;
approve)
  assert_sim; D=$(rundir); DIG=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).digest)' "$D/plan.json")
  node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const s=p.summary||{}; console.log("plan summary:", JSON.stringify(s).slice(0,600)); console.log("actor:", p.actorUserId, "expiresAt:", p.expiresAt)' "$D/plan.json"
  cat "$D/actor.txt" 2>/dev/null | head -3
  RUNNER approve --run-dir "$D" --digest "$DIG" --expires "$(date -u -d '+90 min' +%FT%TZ)"; echo "approve exit=$?"
  ;;
apply)
  assert_sim; D=$(rundir); facts
  RUNNER apply --run-dir "$D"; echo "apply exit=$?"
  RUNNER report --run-dir "$D"; echo "report exit=$?"
  RUNNER state --run-dir "$D"; echo "state exit=$?"
  RUNNER accept --run-dir "$D"; echo "accept exit=$?"
  facts
  ;;
post)
  assert_sim; D=$(rundir); RUN=$(basename "$D")
  say "P1 second apply of the accepted stage (expect refusal)"; RUNNER apply --run-dir "$D"; echo "P1 exit=$?"
  say "P2 capture after acceptance (expect refusal; no backup taken)"; before=$(ls "$SIM"/backups | wc -l); WRAP capture "$R" I336; echo "P2 exit=$? backups before=$before after=$(ls "$SIM"/backups | wc -l)"
  say "P3 plan after acceptance (expect refusal)"; WRAP plan "$R" I336 "$RUN"; echo "P3 exit=$?"
  say "P4 state after (expect the planned result present)"; RUNNER state --run-dir "$D"; echo "P4 exit=$?"
  facts
  ;;
# ---- RUNBOOK PATH (issues/open/AFLDB-ISSUE-336.md §3 steps 3-6: restore-assemble-host.sh and prod-stage.sh called directly, operator TAG) ----
rb-p2)  # P2 restore + assembly on the restore host, from the capture the wrapper took (copied by the runner's step 4, hashes verified there)
  assert_sim; RUN=$(basename "$(ls -d "$SIM"/ops/${R:0:8}/runs/I336-* | head -1)"); IN=$SIM/rw/in/$RUN
  (cd "$IN/capture" && sha256sum -c --quiet SHA256SUMS) && echo "capture SHA256SUMS OK" || { echo "STOP capture hashes"; exit 3; }
  TAG=i336_${RUN:5:8}_${RUN:14:6}; echo "run=$RUN tag=$TAG"
  W=$SIM/rw R=$R STAGE=I336 CAPDIR=$IN/capture PROD_TARGET=$IN/target.json TAG=$TAG PROFILE=$SIM/profile.sim.env $NICE bash "$SIM/rw/cand/tools/v2/gap029-ops/restore-assemble-host.sh"
  echo "rb-p2 exit=$?"
  ;;
rb-p3)  # P3: put the sealed evidence in the production run directory, then the read-only plan
  assert_sim; RD=$(ls -d "$SIM"/ops/${R:0:8}/runs/I336-* | head -1); RUN=$(basename "$RD"); EV=$(ls -d "$SIM"/rw/evidence-private/i336_* | head -1)
  cp -p "$EV/backup.json" "$EV/restore-evidence.json" "$RD/" && sha256sum "$EV/backup.json" "$RD/backup.json" "$EV/restore-evidence.json" "$RD/restore-evidence.json"
  WRAP plan "$R" I336 "$RUN"; echo "rb-p3 exit=$?"
  ls "$RD"
  ;;
rb-neg-pre)
  assert_sim; RD=$(ls -d "$SIM"/ops/${R:0:8}/runs/I336-* | head -1); RUN=$(basename "$RD")
  DIG=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).digest)' "$RD/plan.json"); echo "run=$RUN digest=$DIG"
  OPS="$SIM/ops/${R:0:8}/cand"; EXP=$(date -u -d '+90 min' +%FT%TZ)
  (cd "$OPS" && node --import tsx tools/v2/gap029-ops.ts statement --stage I336 --run-dir "$RD" --window "from now until $EXP") > "$TOOLS/stmt-neg.txt"; echo "statement exit=$?"
  say "N1 apply with no approval (expect refusal before mutation)"; WRAP apply "$R" I336 "$RUN"; echo "N1 exit=$?"
  say "N2 approval with a wrong digest (expect refusal)"; WRAP approve "$R" I336 "$RUN" "$(printf '%064d' 0)" "$TOOLS/stmt-neg.txt" "$EXP"; echo "N2 exit=$?"
  say "N3 wrong revision (no pinned checkout for it)"; WRAP preflight 09acd432a00000000000000000000000000000ab I336; echo "N3 exit=$?"
  say "N4 stage/run mismatch (an I336 run named under S3)"; WRAP plan "$R" S3 "$RUN"; echo "N4 exit=$?"
  say "N5 malformed run name"; WRAP report "$R" I336 "I336-2026111T000000Z"; echo "N5 exit=$?"
  say "N6 S1-S4 run name under I336"; WRAP report "$R" I336 "S3-20261111T015440Z"; echo "N6 exit=$?"
  say "N7 state after the refusals (expect BASELINE)"; WRAP state "$R" I336 "$RUN"; echo "N7 exit=$?"
  facts
  ;;
rb-approve)
  assert_sim; RD=$(ls -d "$SIM"/ops/${R:0:8}/runs/I336-* | head -1); RUN=$(basename "$RD")
  DIG=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).digest)' "$RD/plan.json")
  OPS="$SIM/ops/${R:0:8}/cand"; NB=$(date -u -d '-1 min' +%FT%TZ); EXP=$(date -u -d '+90 min' +%FT%TZ)
  (cd "$OPS" && node --import tsx tools/v2/gap029-ops.ts plan-summary --stage I336 --run-dir "$RD") 2>&1 | head -20
  (cd "$OPS" && node --import tsx tools/v2/gap029-ops.ts statement --stage I336 --run-dir "$RD" --window "from $NB until $EXP") > "$TOOLS/stmt.txt"; echo "statement exit=$?"; cat "$TOOLS/stmt.txt"
  WRAP approve "$R" I336 "$RUN" "$DIG" "$TOOLS/stmt.txt" "$EXP" "$NB"; echo "approve exit=$?"
  ;;
rb-apply)
  assert_sim; RD=$(ls -d "$SIM"/ops/${R:0:8}/runs/I336-* | head -1); RUN=$(basename "$RD"); facts
  WRAP apply "$R" I336 "$RUN"; echo "apply exit=$?"
  WRAP report "$R" I336 "$RUN"; echo "report exit=$?"
  WRAP state "$R" I336 "$RUN"; echo "state exit=$?"
  WRAP accept "$R" I336 "$RUN"; echo "accept exit=$?"
  facts
  ;;
rb-post)
  assert_sim; RD=$(ls -d "$SIM"/ops/${R:0:8}/runs/I336-* | head -1); RUN=$(basename "$RD")
  say "P1 second apply of the accepted stage (expect refusal)"; WRAP apply "$R" I336 "$RUN"; echo "P1 exit=$?"
  say "P2 capture after acceptance (expect refusal; no backup taken)"; before=$(ls "$SIM"/backups | wc -l); WRAP capture "$R" I336; echo "P2 exit=$? backups before=$before after=$(ls "$SIM"/backups | wc -l)"
  say "P3 plan after acceptance (expect refusal)"; WRAP plan "$R" I336 "$RUN"; echo "P3 exit=$?"
  say "P4 state after (expect the planned result present)"; WRAP state "$R" I336 "$RUN"; echo "P4 exit=$?"
  facts
  ;;
facts) facts ;;
teardown)
  SIM=$SIM bash "$SRC/tools/v2/gap029-ops/sim/sim-teardown.sh"
  ss -ltn | awk '{print $4}' | grep -E ':5549[34]$' && echo "WARN still listening" || echo "ports 55493/55494 closed"
  ;;
*) echo "unknown phase"; exit 2 ;;
esac
