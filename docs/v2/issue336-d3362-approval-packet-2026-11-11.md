# ISSUE-336 D-336-2: the 35-row production insert (stage I336) — approval packet (2026-11-11)

**Status: PREPARED. NOT GRANTED. NOT EXECUTED.** This packet is the exact executable form of `issues/open/AFLDB-ISSUE-336.md` §3 steps 2–7. Each numbered step needs its own owner approval, using the text in §5. No production host was contacted while preparing it.

## 1. Pins and preconditions

| Item | Value |
|---|---|
| Execution revision R (ops checkout on production; the I336 pin) | `c1c4b22ee15007111eab66f6d354e0b9ecbb2ade`, the same revision the r2 application release builds |
| Reviewed evidence | `docs/v2/evidence/issue336-draft-categories-20261105/predraft-insert-plan.json`, sha256 `6a207cfe3b1408d6ff747040cecfac1cde9ebd9a43f584711c573eb20ff511cb`, pinned in `tools/v2/gap029-ops-lib.ts` (`I336_EVIDENCE_SHA256`) |
| Actor | `auth_users.id 1`: active, fully enrolled, sole enabled Super Admin. Checked by `preflight`, asserted again at apply |
| Expected plan | 35 to insert, 31 new unmatched persons, 0 already present. `planProblems` refuses anything else |
| Expected after-state | `draft_picks` +35; 1991–2025 DraftGuru rows reconcile 5,966 = 5,966; 35 `data_edits` rows by actor 1, seal basis `audited_correction` |
| Production profile | `tools/v2/gap029-ops/profile.production.env` at R: `afldb_prod` OID 66668, system identifier 7674454702926115004, ledger 118 |
| Order | Release first (r2, recommended in runbook §3 step 1). D-336-2 does not depend on it. Both `0f251c2d`/`f32d44f0` and R have the same `package-lock.json`, so `prep`'s node_modules check passes either way |
| Route | **Direct scripts** (`prod-stage.sh` on production, `restore-assemble-host.sh` on streamanator), driven from the workstation with Windows OpenSSH. The workstation has no Node, and the GAP-029 runner (`gap029-stage.ts`) carries ISSUE-347 at R. The direct route needs neither |

## 2. Qualification of this exact path (SIMULATION, 2026-11-11)

**Setup.** On streamanator, workspace `/mnt/ssd/afldb-i336-sim-20261111`:
- the existing GAP-029 simulation harness at R (`tools/v2/gap029-ops/sim/`);
- a separate loopback cluster on 55494 with its own system identifier `7706726153494630905`, holding `afldb_simprod` restored from the approved 2026-11-04 snapshot (sha256 `e77c307d…826d`, ledger 118);
- evidence class `SIMULATION` throughout;
- the production-mode wrapper (no `--rehearsal`).

**Results:**

| Step | Result |
|---|---|
| prep, preflight, capture | `CAPTURE_COMPLETE stage=I336`. Actor 1 `super_admin`, enabled, enrolled, non-fixture e-mail; 1 enabled Super Admin. `pg_dump` exit 0 |
| P2 restore + sealed assembly | `ASSEMBLY_COMPLETE stage=I336`. `pg_restore` exit 0, 0 stderr. **The first sealed `assemble --stage I336` anywhere**; it closes the runbook §2 "not rehearsed" gap |
| P3 plan | Digest `10c71c64…4b1e`: **35 to insert, 31 new persons, 0 already present**. State BASELINE |
| Refusals before approval (no mutation, database unchanged) | apply with no approval: exit 3. Wrong digest: approve exit 6. Wrong revision: exit 20. I336 run under S3: exit 2. Malformed run: exit 2. S3 run under I336: exit 2 |
| approve, apply | `COMMITTED_VERIFIED` (exit 0) |
| report / state / accept | `COMMITTED_VERIFIED`; `PLANNED RESULT PRESENT`; verify 35/35 with pre-existing rows unchanged; `ACCEPTED stage=I336` |
| Facts after | `draft_picks` 6,818 → 6,853; 1991–2025 5,939 → 5,974 (5,966 DraftGuru + 8 manual); `draft_persons` 5,057 → 5,088 (+31); 35 audit rows on 35 picks, actor 1 |
| Refusals after acceptance | second apply, capture and plan: each exit 21, no new backup |

**Found by this run: ISSUE-347.** The GAP-029 workstation runner's `prepare` derived the restore TAG with fixed offsets, so an I336 run stopped at restore and assembly (exit 2) after the capture had been taken. The precedent route for S2–S4 used that runner, so following it at R would leave an unused production backup. The direct route in §4 is unaffected, which is why this packet uses it. The fix is local commit `2207986f`, unpublished while `main` is frozen.

**Limits:**
- The simulation has no real writers, timers or systemd units.
- Production's data volume and its own `pg_dump` duration are not simulated.
- Window and timer conflicts are exercised only in their "not running" branch.

Evidence: `docs/v2/evidence/issue336-i336-simulation-20261111/`.

## 3. Recovery (unchanged from runbook §4)

- Outcomes and exit codes are `tools/v2/gap029-common.ts`'s.
- A REFUSED or ROLLED_BACK run wrote nothing; prepare a new run with a fresh capture.
- A committed run is never retried, reversed or restored by the tools.
- Restoring the stage backup would discard every later production write. That is a separate owner decision with its own approval.
- `OUTCOME_UNDETERMINED`: run `report` and `state` (both read-only) and stop for the owner.
- Each run's capture and run directories are mode 700 and never deleted by the tools; the owner removes them after acceptance.

## 4. Exact commands (workstation Git Bash; `afldb` is the production SSH alias; `SM="ssh -o BatchMode=yes -i ~/.ssh/afldb_dev arm@10.0.40.100"`)

Space SSH connections out. The home network's IPS blocks bursts of outbound port-22 connections; see the operator note "firewall blocks own SSH".

```bash
R=c1c4b22ee15007111eab66f6d354e0b9ecbb2ade; OPS=/home/arm/ops/gap029-stages/c1c4b22e; P=$OPS/cand/tools/v2/gap029-ops/prod-stage.sh
STAMP=$(date -u +%Y%m%dT%H%M%SZ); W=/mnt/ssd/afldb-i336-prod-$STAMP          # new restore workspace on streamanator
```

**Prepared tarball (2026-11-11, recommended; replaces the pack line below).** The tarball the simulation qualified
is retained on streamanator: `/mnt/ssd/afldb-i336-simpack-20261111/pack-c1c4b22e/cand.tar.gz`, sha256
`3160b9d339d0d23747bb53ab9a597ccf54737c31218fe867762885a407a55b8a`. It was packed by `gap029-stage.ts pack` from a
clean checkout at R (`e1-logs/setup.log`: `PACKED revision c1c4b22e… tracked 4998`) and re-verified on 2026-11-11: the
same sha256, and its `cand` is at R with an empty `git status --porcelain`. `tar -czf` is not reproducible (file times
and the gzip header), so a fresh pack would print a different TARSHA. To use it: set
`WP=/mnt/ssd/afldb-i336-simpack-20261111; TARSHA=3160b9d339d0d23747bb53ab9a597ccf54737c31218fe867762885a407a55b8a`,
skip the `pack` line, and write `$WP` for `$W-pack` in Step A's `scp` and Step C's `TAR=`. Keep `-simpack-` until
D-336-2 is accepted.

**Step A: pin the ops checkout (production writes only under `$OPS`).** Pack on streamanator from a clean checkout at R, then upload to production and `prep`:
```bash
$SM "cd /mnt/ssd/afldb-i336rel-qual-20261108T201140Z/cand && test \"\$(git rev-parse HEAD)\" = $R && test -z \"\$(git status --porcelain)\" && PATH=\$HOME/.nvm/versions/node/v22.23.2/bin:\$PATH node --import tsx tools/v2/gap029-stage.ts pack --rev $R --out-dir $W-pack"
scp -i ~/.ssh/afldb_dev arm@10.0.40.100:$W-pack/pack-c1c4b22e/cand.tar.gz . && TARSHA=$(sha256sum cand.tar.gz | cut -d' ' -f1); echo "$TARSHA"
ssh afldb "umask 077; mkdir -p -m 700 $OPS/in && cat > $OPS/in/cand.tar.gz" < cand.tar.gz
ssh afldb "cd $OPS && [ \"\$(sha256sum in/cand.tar.gz | cut -d' ' -f1)\" = $TARSHA ] && { [ -d cand ] || tar xzf in/cand.tar.gz -C $OPS; } && bash $P prep $R $TARSHA"
```

**Step B (runbook step 2, P1): preflight, then ONE capture.** Read-only on production, apart from the backup files:
```bash
ssh afldb "bash $P preflight $R I336"          # expect: actor1 ... 1 super_admin true true true; enabled super_admin count: 1
ssh afldb "bash $P capture $R I336"            # prints RUN=I336-<stamp>, CAPTURE_DIR, RUN_DIR, TARGET_SHA256, CAPTURE_COMPLETE
RUN=<the printed RUN>; CAP=/home/arm/backups/afldb/gap029-I336-${RUN#I336-}; RD=$OPS/runs/$RUN
```

**Step C (runbook step 3, P2): restore and assembly on streamanator.**
```bash
mkdir -m 700 i336-$RUN && scp -r afldb:$CAP i336-$RUN/capture && scp afldb:$RD/target.json i336-$RUN/
$SM "W=$W TAR=$W-pack/pack-c1c4b22e/cand.tar.gz TAR_SHA256=$TARSHA R=$R SRC_CAND=/mnt/ssd/afldb-i336rel-qual-20261108T201140Z/cand bash /mnt/ssd/afldb-i336rel-qual-20261108T201140Z/cand/tools/v2/gap029-ops/restore-workspace-setup.sh"
$SM "mkdir -m 700 -p $W/in/$RUN" && scp -i ~/.ssh/afldb_dev -r i336-$RUN/capture i336-$RUN/target.json arm@10.0.40.100:$W/in/$RUN/
$SM "cd $W/in/$RUN/capture && sha256sum -c --quiet SHA256SUMS && W=$W R=$R STAGE=I336 CAPDIR=$W/in/$RUN/capture PROD_TARGET=$W/in/$RUN/target.json TAG=i336_\$(echo $RUN | cut -c6-13)_\$(echo $RUN | cut -c15-20) bash $W/cand/tools/v2/gap029-ops/restore-assemble-host.sh"   # expect ASSEMBLY_COMPLETE stage=I336 class=GENUINE_PRODUCTION
```
**Check after Step C.** The log must not contain `WARN port still listening`. Under heavy host IO in the simulation (e4), `pg_ctl stop` timed out after 60 s and the restore cluster on 55493 stayed up. The script warns and still completes. A later run then refuses with `STOP port 55493 already listening`, which is fail-safe. If the warning appears, stop the cluster before anything else: `/usr/lib/postgresql/16/bin/pg_ctl -D $W/pg-root/data stop -m fast -t 600`.

**Step D (runbook step 4, P3): the read-only plan.**
```bash
EV=$W/evidence-private/i336_$(echo $RUN | cut -c6-13)_$(echo $RUN | cut -c15-20)
scp -i ~/.ssh/afldb_dev arm@10.0.40.100:$EV/backup.json arm@10.0.40.100:$EV/restore-evidence.json i336-$RUN/ && scp i336-$RUN/backup.json i336-$RUN/restore-evidence.json afldb:$RD/
ssh afldb "bash $P plan $R I336 $RUN"          # expect: 35 to insert, 31 new persons, 0 already present; STATE BASELINE; PLAN_COMPLETE
```
**STOP here. The owner reads the plan summary.**

**Step E (runbook step 5): approval, the owner's act.** The statement is generated from the plan and must be kept inside the run directory:
```bash
NB=$(date -u -d '-1 min' +%FT%TZ); EXP=<ISO-8601 UTC, at most 90 min ahead and before the printed backup limit>
ssh afldb "cd $OPS/cand && /home/arm/.nvm/versions/node/v22.23.2/bin/node --import tsx tools/v2/gap029-ops.ts statement --stage I336 --run-dir $RD --window 'from $NB until $EXP' > $RD/approval-statement.txt && cat $RD/approval-statement.txt"
ssh afldb "bash $P approve $R I336 $RUN <plan digest> $RD/approval-statement.txt $EXP $NB"   # APPROVAL WRITTEN
```

**Step F (runbook step 6): apply once, then report, state and accept.**
```bash
ssh afldb "bash $P apply $R I336 $RUN"         # WRAPPER OUTCOME COMMITTED_VERIFIED (exit 0); any other outcome: STOP, report + state only
ssh afldb "bash $P report $R I336 $RUN"; ssh afldb "bash $P state $R I336 $RUN"; ssh afldb "bash $P accept $R I336 $RUN"   # ACCEPTED stage=I336
```

**Step G (runbook step 7): after.** Read-only:
- reconciliation against the owner CSVs, expecting 5,966 = 5,966;
- `/draft/2008`, `/draft/2025` and `/draft/2009?view=pre-draft` show the new Pre-Draft rows (desktop and mobile capture, or `VISUAL: UNVERIFIED`);
- record D-336-2 closed in `issues.md`.

## 5. Approval texts (one per step; nothing is granted until the owner writes it)

- **D-336-2/A+B (pin and capture):** "I approve, on afldb-prod as arm, uploading the R-pinned ops checkout `c1c4b22ee15007111eab66f6d354e0b9ecbb2ade` (tarball sha256 `<TARSHA>`; with the prepared tarball, `3160b9d339d0d23747bb53ab9a597ccf54737c31218fe867762885a407a55b8a`) to `/home/arm/ops/gap029-stages/c1c4b22e` and running `prod-stage.sh prep`, `preflight` and ONE `capture` for stage I336: one read-only `pg_dump` of `afldb_prod` as `afldb_backup` into a new mode-700 directory under `/home/arm/backups/afldb`. No database write, service, timer or application change."
- **D-336-2/C+D (restore, assemble, plan):** "I approve copying that capture to a new mode-700 workspace on streamanator, restoring it into a guarded disposable database there, assembling the sealed I336 evidence, uploading `backup.json` and `restore-evidence.json` to the run directory, and running the read-only I336 `plan`."
- **D-336-2/E+F (apply):** "I approve D-336-2: apply, once, to `afldb_prod` (OID 66668, system identifier 7674454702926115004) the digest-pinned I336 plan `<digest>`, at execution revision `c1c4b22ee15007111eab66f6d354e0b9ecbb2ade`, after this stage's own fresh restore-verified backup `<dump sha256>`. Exactly the 35 DraftGuru Pre-Draft rows of reviewed evidence `6a207cfe…11cb`, with 31 new unmatched persons, each audited through `recordDataEdit` under the season seal as actor `auth_users.id 1`, in the window `<NB>` to `<EXP>`. Then report, state and accept. Nothing else." (The `approve` step records the generated statement itself; this text is the owner's instruction to run it.)

## 6. Next executable action

After the r2 release (or independently, if the owner prefers): the owner's D-336-2/A+B approval, then Step A.
