# V2-GAP-029 — S1 production preparation: consolidated handoff (3 Nov 2026)

**State: S1 is fully prepared and waiting for ONE owner act (the D1-PROD approval plus a window). Nothing was applied to production.**
GAP-029 stays open. S2–S4 are NOT pre-authorised by anything here: each needs its own fresh backup, restore and plan after the preceding stage has been applied and accepted.

Supersedes nothing: `docs/v2/gap-029-ordered-execution-handoff-2026-11-03-rev3.md` (decisions, strict-parity findings, rev-3 evidence) remains the decision record. This note adds the production wrapper, its validation, and the genuine S1 evidence.

## 1. Frozen execution revision and wrapper hashes

**Execution revision R = `f05a2e78fdd0d90824789ab81ee2d2e4ffe3ab8f`** (local branch `main`; nothing pushed). Documentation-only commits after R record evidence and do not move it.

| File (sha256 of the blob at R) | |
|---|---|
| `tools/v2/gap029-ops/prod-stage.sh` | `1794c4d9f31fa4d2cf668d0cfbacc07abad247a2056ef47b7162135ab7385698` |
| `tools/v2/gap029-ops/capture-prod-stage.sh` | `8279f351965e22ae696d4a96ad3d9188f57e4f2b274019ddb1b069b64a1cef63` |
| `tools/v2/gap029-ops/restore-assemble-host.sh` | `6006b26d9fd362caf780bba61f3fefec2f3d22657bc06ed60fc80df7aabe8a66` |
| `tools/v2/gap029-ops/restore-workspace-setup.sh` | `a5fc7e027dc30a22cad5d54627e831e55c00aaa8b7ecc1d9b2e6974003f09e28` |
| `tools/v2/gap029-ops/restore.mjs` | `1674835761f58df97eb58ed904ceec90934bfe91a895bc09280f89149027ad48` |
| `tools/v2/gap029-ops/probe-dbs.mjs` | `de732a9e77f5fc9935f2852376b33c53a8b15d5a88bd3cdadeb239894d22f0f9` |
| `tools/v2/gap029-ops/profile.production.env` | `9bee98b5b071694100a867d14008b9316652f93894568a5db01fd0833baa8170` |
| `tools/v2/gap029-ops.ts` | `127aac5baa57246138339604947415bd94aca59d2a7f58f4bd240f589fc5c2ed` |
| `tools/v2/gap029-ops-lib.ts` | `0caec51a39a3ee842b53839d1a3b2d3993a28eaaea03363666c6ba916cd5ba84` |
| `tools/v2/gap029-stage.ts` | `264777edaac1d077ab55acd9d800f10343084be6f414ce9de8dd0bd9d87bc7f7` |
| `tests/gap029-ops.test.ts` | `fb4fda8c61742b8a258d9e60cbf45e3d14aae91d24bb1ac71331dda5d15e4a71` |

The execution tarball (pinned checkout of R, produced by `gap029-stage.ts pack` from a shallow fetch into a fresh repository) has sha256 `a88b1afb79e143a52f15b942989266e2e0d95eb670e3ee136009f236b84153f4`. The stage tools, `gap029-common.ts`, `gap029_common.py` and the assembler are the previously reviewed files, unchanged (R only adds the wrapper files above plus `tools/v2/gap029-ops/sim/*`, simulation-only).

**Guarded push / checkout procedure: none is required.** The wrapper does not use the production Git checkout (`/home/arm/projects/afldb`, still `d00e07e3`, clean). R is uploaded as a hash-verified tarball into a private pinned checkout `/home/arm/ops/gap029-stages/f05a2e78/cand` (mode 700) whose `node_modules` is a symlink to the production checkout's (package.json and package-lock.json sha256-equal, verified by `prep`). Pushing R to `origin` is optional, owner-decided, and not a precondition of anything below.

## 2. What was built

* `prod-stage.sh` (production host, one phase per call): `prep`, `preflight`, `capture`, `plan`, `approve`, `apply`, `report`, `state`, `accept` (+ internal `__apply`). Binds each operation to revision, target identity, stage, inputs and evidence hashes through a run manifest; apply requires a separate owner approval naming THAT stage's actual plan digest; one detached apply behind an exclusive lock, never retried; the six reviewed outcome classes and exit codes are preserved; any contradiction between the tool's exit/line and a post-run read-only state probe is `OUTCOME_UNDETERMINED`; no rollback claim after a commit, no automatic restore; order gate (stage N+1 needs a fresh backup after stage N is applied **and accepted**); credentials parsed from `.env` into child environment only (never argv, never printed).
* `capture-prod-stage.sh` — the per-stage fresh backup, derived from the reviewed hardening script by profile substitution only (diff: `docs/v2/evidence/gap029-s1-prep-20261103/capture-vs-reviewed.diff`; after the review two read-only guards were added to it: a profile key whitelist and "only the production profile on the production host"). `restore-assemble-host.sh`, `restore-workspace-setup.sh`, `restore.mjs`, `probe-dbs.mjs` — restore and sealed-evidence assembly on the isolated cluster (diff vs reviewed: `restore-assemble-vs-reviewed.diff`; `restore.mjs` is now strict about a non-zero `pg_restore` status).
* `gap029-ops.ts` / `gap029-ops-lib.ts` — host CLI and the pure rules; `gap029-stage.ts` — the workstation runner (pack, prepare with a hash check at every transfer, approve/apply/report/state/accept, owner-command printer).
* Evidence class: `GENUINE_PRODUCTION` vs `SIMULATION` is stamped into the capture sidecar, the manifest and the run record, checked at every phase, and now bound in code to the pinned production identity in both directions (a hand-made profile cannot mint genuine evidence for another database).
* Deliberately not done: **ANALYZE** (no privilege grant is authorised; autovacuum/stage tools own statistics); no deployment, build, restart, timer/switch change, grant or cleanup.

## 3. Validation (measured)

* **Unit/static:** `tests/gap029-ops.test.ts` 55 tests pass; with the six existing GAP-029 / season-seal suites **186/186 pass**; `tsc --noEmit` clean at R.
* **Simulated production host (EVIDENCE_CLASS=SIMULATION, streamanator):** a second isolated PostgreSQL cluster (own system identifier, port 55494) holding `afldb_simprod`, restored from the retained 2 Nov production dump (ledger 118) — named so the stage tools run in **production mode** (they refuse isolated-test names without `--rehearsal`). The real wrapper, capture, restore/assembly, plan, approval, apply, report and accept were driven over real ssh/scp. Results (logs in `docs/v2/evidence/gap029-s1-prep-20261103/sim/`):
  * full chain **S1→S2→S3→S4, each on its own fresh capture/restore/plan, each `COMMITTED_VERIFIED` and accepted** — run twice (e5 at the first commit ec667f76 and e8 at the post-review commit 65b68758; R differs from 65b68758 by one line — `PYTHONDONTWRITEBYTECODE` on the `prep` python probe — which the genuine preparation exercised); S3 as actor 1, S2/S4 through the python importers;
  * refusals before any mutation: apply with no approval; approval with the wrong digest; approval expiring past the backup limit; tampered `plan.json`, `backup.json`, `restore-evidence.json`, dump; a conflicting dump/restore process; wrong revision; stage/run mismatch; S3 before S2 accepted (order gate); wrong expected identity at capture (no backup taken); second apply; direct/forged `__apply`; apply/plan/capture after acceptance; production-target file with a wrong OID; edited sidecar; tampered dump or an extra file in the capture directory at the restore host; scp failure after capture (state reported, nothing retried);
  * injected tool failures against a real database (a node shim, simulation-only): tool killed → `OUTCOME_UNDETERMINED`, state `BASELINE`, report/accept consistent; real commit then `COMMITTED_VERIFICATION_FAILED` (exit 3) → accept refused (24); real commit while the tool claims `ROLLED_BACK` → `OUTCOME_UNDETERMINED` (contradiction), never "rolled back".
* **Reuse of qualification:** the S1–S4 stage tools, the assembler and the Linux qualification of rev 3 (96fc69bb) were not re-run; none of their bytes changed. The wrapper's own paths were qualified as above.
* **Limits (stated, not hidden):** no production apply path has been run by design; the simulation shares the stage tools' code but not production's data volume, systemd units, timers or real writers (units are named non-existent in the simulation profile, so the writer/timer checks are exercised only in their "not running" branch, and the settle-window check in its "outside 04:00–05:30" branch); stale (>24 h) backups, S2 recovery-limit behaviour after a real python-importer commit failure, and a `COMMITTED_VERIFICATION_UNAVAILABLE` (exit 4) injection are covered by unit tests only; the shim injects outcome lines, not real database faults; `cp -n` prints a coreutils portability warning in the plan phase (harmless, left to avoid moving R).

## 4. Independent review (one bounded review, fresh agent, read-only)

Scope: wrapper, capture procedure, restore/assembly, runner, integration with the reviewed stage tools; the earlier findings M-1/M-2/L-1..L-4 were supplied as already fixed. Coverage: every wrapper file and the tests read in full; the reviewed stage tools only sampled (out of scope); both diffs regenerated and matched byte-for-byte; `restore.mjs`/`probe-dbs.mjs` byte-identical to the reviewed copies.

| Sev | Finding | Disposition |
|---|---|---|
| HIGH | internal `__apply` reachable from the command line, bypassing every apply gate and the lock | **Fixed:** one-shot token bound to the lock's pid, refuses if an apply record exists; verified live |
| MED | unreadable `outcome.json` made the wrapper `exit ""` = status 2 (= ROLLED_BACK) | **Fixed:** exit 25 with a warning |
| MED | a second prepared run of an accepted stage could still be planned/approved/applied | **Fixed:** `not_accepted` in plan/approve/apply; verified live |
| MED | evidence class was only a self-declared string | **Fixed:** bound to the pinned production host/sysid/OID/db both ways; hostname guard in bash |
| MED | `restore.mjs` treated a non-zero `pg_restore` with ≤6 stderr lines as success | **Fixed:** strict (all real restores so far were exit 0 / 0 stderr lines) |
| LOW | concurrent applies of one stage from different runs | **Fixed:** `stage_run_gate` (blocks unless the other run's outcome proves nothing was written) |
| LOW | `accept` did not re-verify the manifest | **Fixed** |
| LOW | tool refusing before it logs left no outcome for 1800 s | **Fixed** (synthetic "missing log" → UNDETERMINED immediately) |
| LOW | python block-buffering could split the OUTCOME line | **Fixed:** `PYTHONUNBUFFERED=1` |
| LOW | runner did not compare the run's profile hash; unvalidated remote dir names | **Fixed** (both) |
| INFO | `--max-age-hours` could weaken freshness; bare-time approval expiry; notBefore clock; bash profile keys; pyc write in `prep` | **Fixed** (clamp ≤ 24 h; explicit zone required; notBefore sent explicitly; key whitelist in all three scripts; `PYTHONDONTWRITEBYTECODE`) |
| INFO | `$EXPECT_DB_HOST` interpolated into SQL (profile grammar permits `'`) | Accepted: the tracked profile is fixed and hash-bound |

Post-fix verification: unit tests, the 186-test set, `tsc`, and the full S1→S4 chain re-run on the fixed revision (plus the live checks marked above). No second review was run (one was authorised).

## 5. Genuine S1 preparation — evidence

Run `S1-20261103T074434Z`, evidence class **GENUINE_PRODUCTION**, profile `production` (sha256 of the profile file is in `run.json`). Production touched read-only except: private mode-700 directories under `/home/arm/ops/gap029-stages/f05a2e78` and `/home/arm/backups/afldb/gap029-S1-20261103T074434Z` (the one backup). Production checkout unchanged (`d00e07e3`, 0 dirty lines); `afldb.service` active, settle timer inactive/disabled as before; actor `auth_users.id 1`: role super_admin, enabled, enrolled, non-fixture e-mail, and the **only** enabled Super Admin (the wrapper now stops if that count is not 1). The owner e-mail comparison was not used (identity pinned by id, role, enrolment and the single-Super-Admin count, as in the rev-3 probe).

| Item | Value |
|---|---|
| Target (read-only, as `afldb_backup`) | `afldb_prod`, OID 66668, system id 7674454702926115004, cluster 16/main, ledger 118 / `118_fixtures_unconfirmed_participants.sql`, extensions `pg_trgm=1.6 plpgsql=1.0 unaccent=1.1` |
| Backup (writers enabled, one MVCC snapshot) | captured `2026-11-03T07:44:35.055Z`, 30,089,779 bytes, 1,651 TOC entries, ledger unchanged across capture; **sha256 `409b21a2da198d58d442dcdc6b4726fa893877023839e58e8c57b621ee661ded`** — identical on production, workstation and streamanator |
| Restore (streamanator, isolated cluster 127.0.0.1:55493, DB `afldb_v2_gap029_s1_20261103_074434_rst_test`) | `pg_restore` exit 0, 0 stderr lines, ledger 118 restored; DEV services unchanged before/after |
| `restore-evidence.json` sha256 | `4c784f7e51b6a39e5008e58b637564212baa032646f23dc570cdee849c66a25f` (matches on all machines) |
| `backup.json` (sealed, machine-assembled) sha256 | `58976ebf447f38fc3fc760a4e707a0ab727bf195ed71ef7331805807685b7dc0` |
| `target.json` sha256 | `5b0a54ee050f4d2d277efa0a8f557838f06e20c26e4eff8cf9d38c1d79f8a3b9` |
| `plan.json` sha256 | `5fce9a1c0e151be1d4f962569b758f22bf536e3566316b3c065708a21a9abc2a` |
| `manifest.json` sha256 | `7cc1b2b88dbced03953ef77ef706e8689e4b62b1b421250bb36c9e39b07be695` |
| **Plan digest** | **`e5a7a0396c5f8d37a6748779c41bffda9564943e24a93409e60cf4eabc4eefb2`** |
| State against the plan | `BASELINE` (7 to insert, 0 already present) |
| Plan expiry / latest approval expiry | plan `2026-11-04T07:45:34.891Z`; **approval must expire before `2026-11-04T07:24:35Z`** (backup 24 h limit minus 20 min); the apply also refuses if less than 20 min of backup freshness remains |

**Expected changes (exactly):** INSERT 1 `import_batches` row and 7 `captaincies` rows (source wikipedia); nothing updated or deleted — 2008 Melbourne: Cameron Bruce, James McDonald; 2017 and 2018 Gold Coast: Steven May; 2019, 2020, 2021 Gold Coast: Jarrod Witts (all `Captain`).

Files in `docs/v2/evidence/gap029-s1-prep-20261103/`: `plan.json`, `manifest.json`, `run.json`, `target.json`, `prepare-s1.log`, `statement-template.txt`, both diffs, `sim/` apply logs. The dump, `backup.json`, `restore-evidence.json` and the capture directory stay private (workstation `D:\tmp\gap029-prod\runs\S1-20261103T074434Z`, production `/home/arm/backups/afldb/gap029-S1-20261103T074434Z` and `…/ops/gap029-stages/f05a2e78/runs/…`, streamanator `/mnt/ssd/afldb-v2-gap029-prod-20261103/evidence-private/s1_20261103_074434`). They contain production data: the workstation copy is under `D:\tmp` in the user profile; delete deliberately after S1 is accepted.

## 6. The one thing left: D1-PROD (S1) — owner approval

Statement to approve (fully populated; only the window is open). The runner records it verbatim as the approval reference after refusing any digest that is not this plan's:

> I approve D1-PROD: apply, once, to afldb_prod (database OID 66668, system identifier 7674454702926115004) the digest-pinned S1 plan e5a7a0396c5f8d37a6748779c41bffda9564943e24a93409e60cf4eabc4eefb2 (seven co-captain rows (captaincies)), at execution revision f05a2e78fdd0d90824789ab81ee2d2e4ffe3ab8f, after this stage's own fresh restore-verified backup 409b21a2da198d58d442dcdc6b4726fa893877023839e58e8c57b621ee661ded (restore evidence 4c784f7e51b6a39e5008e58b637564212baa032646f23dc570cdee849c66a25f; evidence class GENUINE_PRODUCTION). Exactly the seven co-captain rows named in the plan, additive only. Nothing else. No retry and no automatic restore. Window: from `<START>` until `<EXPIRY, not later than 2026-11-04T07:24:35Z>`.

Copy-ready commands (all on the workstation, `D:\dev\afldb`; the runner ssh-es to `afldb` with the 2.5 s pacing that avoids the Firewalla burst limit; use Windows OpenSSH, not WSL):

```text
[WORKSTATION D:\dev\afldb]  node --import tsx tools/v2/gap029-stage.ts approve --run-dir D:\tmp\gap029-prod\runs\S1-20261103T074434Z --digest e5a7a0396c5f8d37a6748779c41bffda9564943e24a93409e60cf4eabc4eefb2 --expires <ISO-8601 UTC ending in Z, <= 2026-11-04T07:24:00Z> [--not-before <ISO-8601 Z>]
   expect: MANIFEST VERIFY PASS ... class GENUINE_PRODUCTION / APPROVAL WRITTEN for S1 plan e5a7a039... (any other digest: APPROVAL REFUSED)
[WORKSTATION D:\dev\afldb]  node --import tsx tools/v2/gap029-stage.ts apply  --run-dir D:\tmp\gap029-prod\runs\S1-20261103T074434Z
   expect: APPROVAL CHECK PASS / no conflicting writer ... / tool exit 0; state probe exit 0 / WRAPPER OUTCOME COMMITTED_VERIFIED (exit 0) stage S1 / post-run state probe: PLANNED RESULT PRESENT
[WORKSTATION D:\dev\afldb]  node --import tsx tools/v2/gap029-stage.ts report --run-dir D:\tmp\gap029-prod\runs\S1-20261103T074434Z      (only if the apply session drops; it never starts an apply)
[WORKSTATION D:\dev\afldb]  node --import tsx tools/v2/gap029-stage.ts accept --run-dir D:\tmp\gap029-prod\runs\S1-20261103T074434Z
   expect: STATE PLANNED RESULT PRESENT / ACCEPTANCE RECORDED for S1 ... / ACCEPTED stage=S1
```

Any outcome other than `COMMITTED_VERIFIED` (exit 0) or `NOTHING_WRITTEN` (exit 0) is a STOP with an owner decision: exit 1 refused before mutation, 2 rolled back, 3/4 committed (verification failed/unavailable — the change IS in; nothing is retried or restored), 5 undetermined (read-only `state` first). Wrapper-only stops use exit ≥ 20 (21 order/already accepted, 22 apply lock or another run applied, 23 still running — poll `report`, 24 acceptance refused, 25 unreadable outcome record).

If the window is missed or the baseline moves (any production writer, ledger or identity change), do not apply: the wrapper's gates (manifest, capture age, approval, live baseline probe by the stage tool) refuse, and S1 needs a fresh `prepare` (a new backup). After S1 is accepted, S2 is prepared from scratch with `prepare --stage S2 …` (same command shape as in `prepare-s1.log`), and so on.

## 7. Housekeeping

* Simulation cluster on streamanator was stopped (`sim-teardown.sh`); its directory `/mnt/ssd/afldb-v2-gap029-sim-20261103a` (16 GB, mode 700, restored production data) is retained for the owner to delete. The genuine restore workspace `/mnt/ssd/afldb-v2-gap029-prod-20261103` and `/mnt/ssd/gap029-prod-in`, `/mnt/ssd/gap029-sim-in` are retained.
* DEV services were not touched (`afldb.service` and `postgresql@16-main.service` unchanged, MainPIDs 1677/1536). `.codex/`, frozen P/H/EXEC, archived source and parked ISSUE-327 untouched.
* Accepted Webster, Lyons and rookie-source decisions were not reopened.
