# ISSUE-336 D-336-2: end-to-end I336 SIMULATION at R′, and the ISSUE-347 runner fix (2026-11-11, closure run 8)

**Evidence class: SIMULATION.** No production host, DEV database, DEV service or shared database was contacted.

## Setup (streamanator)

- **Simulated production host:** a separate isolated PostgreSQL 16 cluster.
  - Loopback `127.0.0.1:55494`, system identifier `7706726153494630905`, data directory `/mnt/ssd/afldb-i336-sim-20261111/pg-sim/data`.
  - It holds `afldb_simprod`, restored from the approved 2026-11-04 production snapshot `afldb_prod-20261104T021037Z.dump` (sha256 `e77c307d3e0cddcb652e398a946e4c22c2063f13c70edadf96a975c92842826d`, ledger 118). `pg_restore` exit 0 with 0 stderr lines.
- **Built with R's own harness** (`tools/v2/gap029-ops/sim/sim-setup.sh` at `c1c4b22e`): the generated profile has `EVIDENCE_CLASS=SIMULATION`, and the wrapper ran in production mode (no `--rehearsal`).
- **Pinned checkout:** packed by `gap029-stage.ts pack` from a clean R checkout (tarball sha256 `3160b9d3…a55b8a`).
- **Driver:** `scripts/i336-sim.sh`.
- **ssh/scp stand-ins:** `scripts/lssh` and `scripts/lscp`. They accept only the simulation alias `dev` on host `streamanator`.
- **Resource limits:** every heavy step ran under `nice -n 10 ionice -c2 -n7`; one cluster at a time; ports 55493/55494 only.

## Episode e1: the runbook's direct-script route (AFLDB-ISSUE-336.md §3 steps 2–6)

| Step (log) | Result |
|---|---|
| `setup.log` | pack, cluster, restore, profile `97cf0f07…` |
| `prepare.log`, through the runner, steps 1–3 | prep; preflight (actor 1: `super_admin`, enabled, enrolled, non-fixture; 1 enabled Super Admin); `CAPTURE_COMPLETE stage=I336 run=I336-20261111T015440Z`; dump `0b15aa35…`; then **runner step 4 refused: `STOP TAG must match [a-z0-9_]+`, exit 2** (ISSUE-347) |
| `rb-p2.log` (direct `restore-assemble-host.sh`, TAG `i336_20261111_015440`) | capture SHA256SUMS OK, CAPTURE CHECK PASS, TARGET CHECK PASS, `pg_restore` exit 0, **`ASSEMBLY_COMPLETE stage=I336`** (`backup.json` `6a4c50e2…`) |
| `rb-p3.log` (`prod-stage.sh plan`) | `Review plan 10c71c64…: 35 to insert, 31 new persons, 0 already present`; `STATE BASELINE`; `PLAN_COMPLETE` |
| `rb-neg-pre.log` | N1 apply with no approval: exit 3. N2 wrong digest: exit 6. N3 wrong revision: exit 20. N4 I336 run under S3: exit 2. N5 malformed run: exit 2. N6 S3 run under I336: exit 2. N7 state BASELINE. Database unchanged |
| `rb-approve.log` | the generated statement; `APPROVAL WRITTEN` |
| `rb-apply.log` | `WRAPPER OUTCOME COMMITTED_VERIFIED (exit 0)`; report the same; `STATE PLANNED RESULT PRESENT`; verify 35/35 with pre-existing rows unchanged; `ACCEPTED stage=I336` |
| `rb-post.log` | second apply, capture and plan: each exit 21; no new backup |

**Facts** (read-only session as `afldb_backup`):

| | Before | After |
|---|---|---|
| `draft_picks` | 6,818 | 6,853 |
| `draft_picks`, 1991–2025 | 5,939 | 5,974 (5,966 DraftGuru + 8 manual) |
| `draft_persons` | 5,057 | 5,088 |
| I336 audit rows | 0 | 35, on 35 picks, actor 1 |

`manifest.json`, `outcome.json` and `I336.json` (the acceptance record) are the run's own files.

## Episodes e2 and e3: the fixed runner (ISSUE-347, commit `2207986f`), ops checkout still pinned at R

See `runner-logs/` and the run 8 section of `issues/open/OPEN-ISSUES-CLOSURE-RUN-20261108.md`.

**Fresh clone at the fix** (workspace `/mnt/ssd/afldb-i347-qual-20261111`, `runner-logs/clone.log` and `unit.log`):
- origin/main `12aa6e29` plus bundle sha256 `b9431798…1787`; HEAD `2207986f`;
- `tests/gap029-ops.test.ts` **84/84**;
- `tsc --noEmit` exit 0.

The episodes, `runner-logs/reset.log`, `episode.log` and `runner.log`, start from a baseline template rebuilt from the same snapshot (`pg_restore` exit 0):

| Episode | What happened | Why |
|---|---|---|
| e2 | **Step 4 passed:** `ASSEMBLY_COMPLETE`, TAG `i336_20261111_021950`, evidence verified by the runner at step 5. Step 6 (plan) was refused by the wrapper's host-wide exclusivity gate (`a writer, migration, dump or correction process is running`) | A concurrent disposable ISSUE-346 rehearsal was running on the same host. This is correct, fail-safe behaviour; the runner never retries |
| e3 | Refused at step 4 (`STOP port 55493 already listening`) | e2's restore cluster was still up: under heavy host IO, A9's `pg_ctl stop` had timed out (see e4). Fail-safe |
| e4 | **Full runner lifecycle:** `PREPARATION COMPLETE`, plan `23209294…` (35/31/0), `APPROVAL WRITTEN`, `WRAPPER OUTCOME COMMITTED_VERIFIED`, `ACCEPTED stage=I336`. Facts identical to e1 (6,853 picks, 5,088 persons, 35 audit rows by actor 1) | — |

**Operational note (all episodes):** `restore-assemble-host.sh` A9 prints `WARN port still listening` when `pg_ctl stop` exceeds its 60 s default, and still completes. The D-336-2 packet adds an explicit check after Step C. Both simulation clusters were stopped at the end with `pg_ctl stop -m fast -t 600`, and ports 55493 and 55494 are closed.

**Retained for the owner to delete** (each mode 700):
- `/mnt/ssd/afldb-i336-sim-20261111`, 7.1 GB, which holds restored production data;
- `/mnt/ssd/afldb-i336-simpack-20261111`;
- `/mnt/ssd/afldb-i336-simtools-20261111`;
- `/mnt/ssd/afldb-i347-qual-20261111`.

## Limits

- No real writers, timers or systemd units. Writer and timer checks ran only in their "not running" branch.
- Production's data volume and `pg_dump` duration are not simulated.
- The approval in e1 is a simulated owner act.
