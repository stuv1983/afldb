# Block B: Brownlow ordered stages B0, B1, B2, B3, E and acceptance: execution package (2026-11-02)

**Status: PREPARED. NOTHING WAS RUN ON PRODUCTION.** Every production-host command below is unrun. What *was* run is a host-phase rehearsal of the real `b-prod.sh` phases, the real Brownlow runner and the real evidence tools through **all five stages on an isolated production-derived ledger-118 clone**, with a fresh dump, restore, restored-copy baseline and assembled evidence per stage (section 4). No push, backup, plan, approval, apply, migration, timer, privilege or service action took place on production. Frozen P/H/EXEC, quarantined stores, retained releases, the compatibility junction, `.codex/`, archived source work and parked ISSUE-327 are untouched. No approval for any stage exists; a drafted approval is not approval.

This package **supersedes the command-level detail** of [master sequence section 6](master-execution-sequence-2026-11-01.md) and of the [ordered package](brownlow-ordered-execution-package-2026-11-01.md) sections 2 to 8 (their facts, expectations and the twelve rulings stand; where this file is more specific, this file governs). It is a sibling of [Block L](gap-029-block-l-execution-ready-2026-11-02.md) and [Block M](block-m-execution-package-2026-11-02.md).

Files: [`evidence/block-b-package-20261102/`](evidence/block-b-package-20261102/) - `b-prod.sh`, `capture-b.sh`, `restore-verify-b.sh`, `assemble-backup-evidence.mjs` (+ `assemble-selftest.sh`), `make-approval.mjs`, `plan-summary.mjs`, `requests/*.json`, `snapshots.sha256`, `rehearse-b-host.sh`, `linux-rehearsal/`.

## 1. What is pinned

| Item | Value |
|---|---|
| **R** (the revision the owner pushes and the checkout runs) | **unknown until the owner pushes**. Every phase refuses anything that is not 40 lowercase hex and refuses a checkout that is not exactly R and clean. **Rule:** R may differ from the rehearsed revision `RH` (section 4) **only under `docs/` and root `*.md`** (the runner, the query module and the stage code are the rehearsed bytes); check in section 5 (W0) |
| Prerequisite | **Block M-a complete**: ledger 118 rows, last `118_fixtures_unconfirmed_participants.sql`, digest `573594e9365b642ec518c252b17de11d3a423872c53c3020ab525db5904aaf57` (`b-prod.sh pre` refuses any other ledger). B is independent of M-b, L and C |
| Target | `afldb_prod`, `localhost:5432`, system identifier `7674454702926115004`, database OID `66668`, cluster `16/main`, `databaseComment` null, PostgreSQL 16.15 |
| Operator role (**owner decision D-B-ROLE**) | **`afldb_owner`**, DSN `AFLDB_OWNER_DATABASE_URL` from the checkout `.env`, parsed inside the phase into the runner child's environment **only** as the dedicated secret `AFLDB_BROWNLOW_CORRECTION_DSN` (never argv, never printed, never a shared `DATABASE_URL`). Why: the runner must read `public.brownlow_correction_receipts` and `afldb_meta`, which `afldb_import` cannot, and the same role ran the migration of M-a. Reads for identity, ledger, receipts and acceptance use `afldb_backup` in a read-only session |
| Runner | `node --import tsx --conditions=react-server tools/v2/brownlow-production-correction.ts baseline \| plan \| apply` (no force flag, no automatic target; refuses an existing output file) |
| Backup freshness | the runner accepts a backup and restore no older than **24 h**, `restoredAt` after `capturedAt`, `baselineDigest` **equal** to the live baseline at plan **and** apply; the plan lives 24 h; `make-approval.mjs` caps an approval at **12 h** and never beyond the plan |
| Requests (pinned, LF, copied outside the checkout before use) | `b0-fixture-identities.json` `71941fbe…a058` (`{"operation":"observe","seasons":[2025],"stage":"fixture-identities-2025"}`); `b1-observe.json` `91a54c40…728f` (`{"operation":"observe","seasons":[2025]}`); `b2-backfill.json` `606e0ad4…2d` (`backfill`, the 42 seasons 1984 to 2025, **2026 excluded**); `b3-adopt.json` `50e00e7f…07b` (`adopt`, `[2025]`); `e-eligibility.json` `563f336ea92a549d79c0dfd0a4bd2fd61fbdfa0b484f6cac1d47bc10228e858b` (twelve rulings, `actorId` 1) |
| Snapshots (staged outside Git, `data/sources/*` is ignored) | **B0** `fixtures/afl-api-2025-2026-10-20-014218`, 218 files, `manifest.json` sha256 `46a793d8874ff7e1063e4323cb14154f7852dfd184679588dfae58f59b769b36`; **B1** `brownlow/afl-api-brownlow-2025-2026-10-20-014218`, 3 files, `manifest.json` sha256 `43dec3ee84e2bd622a9d33899eb16896487d5344f5225eaa819b5a1262bb47f3`. Every file is pinned in `snapshots.sha256` (221 lines, itself sha256 `c97c03c5…7e4b`) and re-hashed by `b-prod.sh snapshots` |
| Expected effects | see the stage table (section 6); **2026 is preserved**: 9,522 `brownlow_round_votes` rows, a digest recorded by `pre` at B0 and re-compared by every later `pre` and `accept` |
| Frozen | the nightly watcher, Brownlow timer and every AFL API timer stay as they are; nothing in B activates, enables, starts or configures any of them |

## 2. Who does what

| Step | Who | Authority |
|---|---|---|
| W0 delta check, workstation | Claude | local read-only Git |
| D0 push (fast-forward only) | **Owner only** | push to `origin/main` |
| D1, snapshots, `pre`, capture, restore verification, `target`, `baseline`, assemble, `plan`, `accept` | Claude over SSH as `arm` (no sudo), **or the owner**; one SSH session per phase | only under the owner's written approval of the block (section 10) |
| `make-approval.mjs` and `apply` of a stage | Claude **or the owner**, **after** the owner's written approval of that stage (words recorded in the approval's `reference`) | the stage approval |
| The twelve rulings and the decision to record them (stage E) | **Owner** | already recorded as rulings; E needs its own approval |

Claude never uses `sudo`, never restarts anything, never pushes, never edits `.env`, never lowers a guard, never runs a stage on an expired or unmatched plan.

## 3. Variables

```bash
# production, as arm -- paste at the start of EVERY production session or SSH call
R=REPLACE_WITH_40_HEX_R
PKG=docs/v2/evidence/block-b-package-20261102
PKGD=/home/arm/blockb-pkg-${R:0:12}/$PKG          # the package as git archive of R (pinned bytes), created in D1
CHK=/home/arm/projects/afldb
N=/home/arm/.nvm/versions/node/v22.23.2/bin/node
export PATH="$(dirname $N):$PATH"
OPS=/home/arm/ops/blockb-${R:0:12}               # stage evidence (created by the phases, mode 700)
STAMP=REPLACE_WITH_UTC_STAMP_YYYYMMDDTHHMMSSZ    # chosen once per session
```

Stage names: `b0` fixture identities 2025, `b1` observe 2025, `b2` backfill 1984 to 2025, `b3` adopt 2025, `e` eligibility 2025.

## 4. Validation (actual results; nothing here touched production)

**Rehearsed revision `RH` = `ae8b625b8e09c353add74b1296d422d090a80321`** (a shallow `git clone` of RH packed as a tar, sha256 `212a51b3d0a589e08b64fb2b4b21c543a1ca11ef89c69bdea041056d108a6fcf`, extracted and checked clean on streamanator in a fresh workspace under `/mnt/ssd`; the dump, the node modules and the cluster tooling are the ones the Block L and M rehearsals used). Base: the checksum-verified production dump `3f5b5339…4730` (2026-10-31, ledger 117) restored into a guarded disposable database on an isolated cluster (loopback port 55495, exclusive-listener proof), then **migration 118 applied by the real migrate tool** (ledger 118 rows; the digest the wrapper computes equals `573594e9…af57`, so the offline derivation is reproduced a second time). The real `b-prod.sh` ran as a transformed copy whose only differences are host facts (host name, checkout path, the clone's database name, port, system identifier and OID, the writer-unit list, the crontab line, the evidence root, the target host; the 19-line diff is in `linux-rehearsal/b-prod.rehearsal.diff`). Approvals were SYNTHETIC (their `reference` says so); nothing here is approval or authority.

| Phase | Result |
|---|---|
| resources, inputs, `assemble-selftest.sh` (1 accept + 6 refusals), `capture-b.sh` refusal controls (no stage, bad stage, short reference, wrong host: nothing created), cluster, restore + migrate, prepare | all PASS |
| **b0 / b1 / b2 / b3 / e**: `pre`, `snapshots` (218 / 3 files), `target` (equals the reviewed identity field by field), live `baseline`, fresh `pg_dump`, `restore-verify-b.sh` (restore, clean facts JSON, **the real runner `baseline` of the restored copy**), `assemble` (**live baseline == restored baseline** every stage; the five baselines differ from one another, as they must), `plan`, `make-approval.mjs`, `apply`, `accept` | **all five PASS**; `accept` matched the literal facts of the section 6 table at every stage (b2: 320,861; b3: 621 / 8,901; e: 12 decisions) |
| refusals proven on every stage (8 or 9 per stage, 43 in all) | a stage out of order (`pre b1` before `b0`; `pre b0` after `b0`); `make-approval` with a short reference, with an expiry beyond 12 h and with a past expiry; an approval overwrite; a tampered (wrong plan digest) approval; a missing approval file; `accept` before the stage ran; a re-apply of an applied stage |
| stage `e` extra | the **actor control**: with Super Admin 1 disabled `pre e` stops ("not an active Super Admin"), then restored and the stage ran; 0 existing decisions and 0 unresolved settle issues confirmed before it |
| 2026 control | one 2026 vote row altered by one: `accept e` refused on the 2026 digest; restored; `accept e` passes. 2026 stayed 9,522 rows with NULL `match_id` throughout |
| cluster stop, DEV services | the isolated cluster stopped and no listener remained; DEV `afldb.service` MainPID 1162113 and `postgresql@16-main` MainPID 1504 unchanged before and after |

**Disclosed:** (1) the first `b0` attempt of this workspace failed because a separate validation of `restore-verify-b.sh` was running on the host at the same moment; the wrapper's writer guard saw a Brownlow runner process and **refused `apply` as designed**, nothing was written, the log is kept in `linux-rehearsal/old-b0-attempt/`, and the five stage phases were rerun from a clean reset in the same workspace with the same bytes and passed. (2) Three earlier iterations on other workspaces found and fixed real defects before this run: the runner refuses evidence files inside the checkout (the wrapper now copies the hash-verified request), a mis-transformed unit list in the rehearsal copy, the wrapper recursing through the wrong path, and restore facts that were not clean JSON. (3) `restore-verify-b.sh` gained one change after the final run (auto-initialise the isolated cluster when the workspace has none, so the default own-cluster path works in a new workspace; rehearsed bytes `c42b0c63…`, current `40ab71ac…`). That default path was then run **end to end with the current bytes** on the retained Block L backup (ledger 117, dump `9119895b…395d`): restore into the guarded database, clean facts (ledger 117, digest `647c3fb3…45f72`, matches 17,056, fixtures 0), the real runner baseline of the restored copy (`67b62218…4733`), cluster stopped. Every other package script is byte-identical to the rehearsed one (`b-prod.sh` `73f9c9e9…`, `capture-b.sh` `20c07830…`, `assemble-backup-evidence.mjs` `4d1d1aa8…`, `make-approval.mjs` `4d7843d3…`, `plan-summary.mjs` `fd4bb350…`). **Any later edit to `b-prod.sh` voids the stage rehearsal.** (4) **Not provable off-host:** `capture-b.sh` itself (only its refusals; it is the reviewed Block L / M capture with constants changed), the real systemd / crontab / credential state of production, and the real sizes and timings on the production host. The base data is production as of 2026-10-31, not today's production; the wrapper re-derives every fact it depends on at run time.

## 5. The sequence

**W0 (workstation, owner or Claude, read-only).**

```bash
RH=ae8b625b8e09c353add74b1296d422d090a80321; R=REPLACE_WITH_40_HEX_R
cd /d/dev/afldb && [ "$(git rev-parse HEAD)" = "$R" ]
git diff --name-only "$RH" "$R" | grep -v '^docs/' | grep -v '^[^/]*\.md$' ; echo "(nothing above = only docs and root markdown differ from the rehearsed tree)"
```

**D0 (owner)** `git push origin "$R:refs/heads/main"` (fast-forward only; no `--force`).

**D1 (production, `arm`; one session).** Package from R's own objects; the checkout moves only after the preflight passed; the snapshots are staged outside Git and verified byte for byte:

```bash
( set -euo pipefail; [[ $R =~ ^[0-9a-f]{40}$ ]]; cd "$CHK"
  [ -z "$(git status --porcelain)" ]; git fetch origin; [ "$(git rev-parse refs/remotes/origin/main)" = "$R" ]
  mkdir -m 700 "/home/arm/blockb-pkg-${R:0:12}"; git archive "$R" "$PKG" | tar -x -C "/home/arm/blockb-pkg-${R:0:12}"
  git merge --ff-only "$R"; [ "$(git rev-parse HEAD)" = "$R" ]; [ -z "$(git status --porcelain)" ]
  echo "D1 PASS"
)
```

Snapshots (from the workstation; PowerShell holds the `afldb` SSH alias):

```powershell
cd D:\dev\afldb
tar -C data/sources/afl_api -cf - fixtures/afl-api-2025-2026-10-20-014218 brownlow/afl-api-brownlow-2025-2026-10-20-014218 | ssh afldb "mkdir -p /home/arm/projects/afldb/data/sources/afl_api && tar -x -C /home/arm/projects/afldb/data/sources/afl_api"
```

then on production `bash "$PKGD/b-prod.sh" snapshots b0` and `snapshots b1` must print `SNAPSHOTS PASS` (218 and 3 files) and `git status --porcelain` must stay empty.

**One stage = S1 to S8, always in this order and always with a fresh backup (the stage changes the baseline, so a backup from before it cannot serve the next stage).** `S` is `b0`, `b1`, `b2`, `b3` or `e`; each stage needs its own owner approval (section 10). Times are budgets; an overrun is a STOP.

**S1 - pre (production, read-only, 1 min).** `bash "$PKGD/b-prod.sh" pre "$R" "$S"` must print `PRE PASS $S`. It enforces: checkout exactly R and clean; no writer unit enabled or active, no writer process, no crontab; identity (`afldb_prod`, OID, system identifier) as `afldb_backup` in a read-only session; ledger 118 and its digest; the **receipts exactly as this stage expects** (`b0` none, `b1` `observe=1`, `b2` `observe=2`, `b3` `backfill=1,observe=2`, `e` `adopt=1,backfill=1,observe=2`) so a missing, repeated or foreign earlier stage stops here; the 2026 vote digest (recorded at `b0`, compared at every later stage) and 9,522 rows. For `e` it also requires the request's `actorId` to be an **active Super Admin** on production, **0** existing eligibility decisions, and the **resolve checkpoint** (0 unresolved `afl_api_brownlow_settle` issues; non-zero is an owner decision, never skipped).

**S2 - backup (production, mode-700 directory, 5 to 10 min).**

```bash
B_STAGE=$S B_APPROVAL_REFERENCE='<the owner approval words, 20+ characters>' bash "$PKGD/capture-b.sh" 2>&1 | tee "/home/arm/blockb-$S-capture-$STAMP.log"
# RESULT PASS stamp=<STAMPB> archive_sha256=<H> ...   then:  BK=/home/arm/backups/afldb/blockb-$S-<STAMPB>
```

`capture-b.sh` is the reviewed Block L / M capture procedure with constants only changed (stage in the directory and decision label, ledger 118): a single `pg_dump` MVCC snapshot as `afldb_backup`, every writer unit checked inactive first, ledger read before and after, sidecar with the owner's words, `SHA256SUMS`. It refuses without `B_STAGE` and a 20+ character reference.

**S3 - restore verification and restored-copy baseline (off-host, 10 min).** Copy the dump privately to the workstation and to streamanator (mode 700/600, sha256 re-verified at each hop), in a workspace that holds the pinned candidate at R, clean, with `node_modules`:

```bash
EXPECT_ROWS=118 EXPECT_LAST=118_fixtures_unconfirmed_participants.sql EXPECT_DIGEST=573594e9365b642ec518c252b17de11d3a423872c53c3020ab525db5904aaf57 \
W=<workspace with cand + node_modules + in/restore.mjs + in/probe-dbs.mjs> R=$R DUMP=<dump> DUMP_SHA=<sha256 from the sidecar> TAG=$S bash restore-verify-b.sh
```

It restores into a guarded disposable database on the isolated cluster (never the DEV database), writes **clean** `restore-facts.json` and `restored-target.json`, and runs the **real runner `baseline`** against the restored copy (`baseline-restored.json`). Bring `restore-facts.json` and `baseline-restored.json` back to production (private, hashes re-verified) into `$OPS/$S-in/`.

**S4 - target and live baseline (production, read-only session, 2 min).**

```bash
bash "$PKGD/b-prod.sh" target   "$R" "$S"     # independent facts -> $OPS/$S/target.json, compared field by field with the reviewed identity
bash "$PKGD/b-prod.sh" baseline "$R" "$S"     # the runner's read-only baseline -> $OPS/$S/baseline-live.json
```

**S5 - assemble the two runner inputs (production, no database).**

```bash
node "$PKGD/assemble-backup-evidence.mjs" --stage $S --revision $R --target $OPS/$S/target.json --live-baseline $OPS/$S/baseline-live.json \
  --restored-baseline $OPS/$S-in/baseline-restored.json --sidecar $BK/afldb_prod-<STAMPB>.provenance.json --dump $BK/afldb_prod-<STAMPB>.dump \
  --restore-facts $OPS/$S-in/restore-facts.json --expect-ledger-digest 573594e9365b642ec518c252b17de11d3a423872c53c3020ab525db5904aaf57 --out-dir $OPS/$S/evidence
```

It **refuses** unless the dump bytes hash to the sidecar, the sidecar and restored ledger digests are the 118 digest, the live baseline **equals** the restored-copy baseline, both baselines are for this revision and this target, the backup came from this system identifier and OID, the ledger did not change during the capture, and the restore is after the capture. Equal baselines are the proof that the restored copy is the database the plan will be bound to; **any difference means something wrote between the capture and the baseline: stop and repeat S2 to S5.**

**S6 - plan (production, read-only session, no writes, 2 min).**

```bash
bash "$PKGD/b-prod.sh" plan "$R" "$S" "$OPS/$S/evidence/backup-$S.json" "$BK/afldb_prod-<STAMPB>.dump" "$OPS/$S/evidence/restore-evidence-$S.json"
node "$PKGD/plan-summary.mjs" "$OPS/$S/plan.json"            # the owner reviews this and the plan digest
```

`plan` re-runs `snapshots` (b0, b1) and `pre`, copies the hash-verified pinned request next to the evidence (the runner refuses evidence inside the checkout), then the runner proves the target, recomputes the baseline and refuses unless it equals the backup's.

**S7 - the owner's stage approval, then apply (production, one transaction, 1 to 10 min).** After the owner's written approval of exactly this plan digest:

```bash
node "$PKGD/make-approval.mjs" --plan "$OPS/$S/plan.json" --revision "$R" --reference '<the owner approval words for this stage, 20+ characters>' \
  --expires <ISO UTC, at most 12 h ahead and not after the plan expiry> --out "$OPS/$S/approval.json"
bash "$PKGD/b-prod.sh" apply "$R" "$S" "$OPS/$S/plan.json" "$OPS/$S/approval.json" "$BK/afldb_prod-<STAMPB>.dump" "$OPS/$S/evidence/restore-evidence-$S.json"
```

`apply` checks the approval against the plan (digest, revision, operation, seasons, stage, 20+ character reference, not expired, not beyond the plan), re-runs `snapshots` and `pre` (so a state that moved since the plan stops with nothing written), refuses if a receipt file for the stage already exists, then the runner's own gates run (fresh approval, target proof, backup and restore-evidence hashes, **baseline re-derived and equal**, season scope without 2026) and the stage commits in **one transaction** with its receipt, or rolls back completely. A stage is never re-applied.

**S8 - acceptance (production, read-only, 1 min).** `bash "$PKGD/b-prod.sh" accept "$R" "$S"` must print `ACCEPT PASS $S`: receipts exactly as expected after the stage, the 2026 digest unchanged, and the row facts of the stage table below.

## 6. Stages and their acceptance facts

| Stage | Request | Writes | `accept` facts (total / 2026 / in-scope with `match_id` / 2025 source-less / 2025 `afl_api` / staged 2025 / decisions) | Receipts after |
|---|---|---|---|---|
| **B0** | observe + stage `fixture-identities-2025`, snapshot `afl-api-2025-2026-10-20-014218` | one completed `import_batches` row, the 212 fixture staging observations with versions, receipt. **No canonical vote write.** The general settle CLI's sealed-season refusal is untouched | 330383 / 9522 / 0 / 9522 / 0 / 0 / any | `observe=1` |
| **B1** | observe 2025, snapshot `afl-api-brownlow-2025-2026-10-20-014218` | spine, typed staging (207 sets, **621** positive vote rows, 188 leaderboard players), batch, receipt. **No canonical vote write** | 330383 / 9522 / 0 / 9522 / 0 / **621** / any | `observe=2` |
| **B2** | backfill, 42 seasons 1984 to 2025 | `match_id` set on exactly **320,861** rows (22,239 positive + 298,622 zero); only `match_id` moves; **2026 keeps NULL** | 330383 / 9522 / **320861** / 9522 / 0 / 621 / any | `backfill=1,observe=2` |
| **B3** | adopt 2025 | **621** rows adopted to `afl_api`, **8,901** zero rows keep their source-less provenance, 621 `canonical_applications` rows, batch | 330383 / 9522 / 320861 / **8901** / **621** / 621 / any | `adopt=1,backfill=1,observe=2` |
| resolve checkpoint | none unless non-zero | `pre e` requires 0 unresolved `afl_api_brownlow_settle` issues; non-zero **stops for an owner decision** | | |
| **E** | eligibility, 12 rulings, `actorId` 1 | 12 decision rows, audited metadata and career publication in the same transaction, receipt; raw votes unchanged; the twelve players ineligible with no eligible rank; the 2025 winner stays player 9235 with 39 votes | 330383 / 9522 / 320861 / 8901 / 621 / 621 / **12** | `adopt=1,backfill=1,eligibility=1,observe=2` |
| **C: acceptance** | no database write | the owner records acceptance of the B0, B1, B2, B3 and E receipts and acceptance reads against the 98/98 local-season reconciliation; GAP-030 and GAP-031 close only on their receipts | | five receipts |

Reconciliation: 330,383 = 320,861 + 9,522; 22,860 = 22,239 + 621; 307,523 = 298,622 + 8,901. 2025 and 2026 both hold 9,522 rows (207 sets x 46 players).

## 7. Stop conditions and state-aware recovery

Every phase prints `STOP: <reason>` and exits non-zero; the first failed assertion stops. **Never retry a stage that exited 7 without first running `accept`.** Exit codes: `2` bad input, `3` checkout/input/evidence, `4` a writer is present, `5` state differs from the reviewed state, `6` a phase refused before any write, `7` the runner refused or failed during `apply`.

| What the receipts and facts show | Meaning | Action |
|---|---|---|
| `pre` stops on receipts not equal to the stage's expectation | an earlier stage is missing, repeated or foreign | stop; read `brownlow_correction_receipts`; never skip a stage |
| `pre` stops on the 2026 digest | the 2026 votes moved since `b0` | stop; owner decision; nothing is applied |
| S5 refuses on unequal baselines | a write happened between the capture and the baseline | stop; repeat S2 to S5 |
| S6 plan refuses (`fresh backup restore baseline does not equal this target baseline`) | the database moved since the backup | repeat S2 to S6 |
| `apply` exit 7, `accept` still shows the **before** receipts and facts | the transaction rolled back; nothing was written | the plan and approval are still valid until their expiry; **report the refusal to the owner before any retry**; a changed state needs a new plan |
| `apply` exit 7, `accept` shows the **after** facts | the stage committed (the runner exited after the commit) | record it; continue with the next stage's S1 |
| anything else (some but not all facts) | unexpected partial state | **stop, change nothing, report**; a stage is one transaction, so this indicates an outside writer |

Reversal exists only before any later write: the runner's `reverse-adopt` (B3) and the retained-history rule for observations (supersede, never erase). **Rollback of a committed stage is by the pre-stage backup under a separate owner decision, never automatic.** Block B has no service restart, so the serving release is unaffected.

## 8. Rollback fidelity

A stage that rolls back changes nothing. A committed stage is retained history: B0 and B1 add staging observations and receipts (no canonical vote change); B2 sets `match_id` only; B3 changes provenance of 621 rows with audit rows; E records twelve audited decisions and republishes the affected career data. Restoring the pre-stage dump would also discard anything written to the database since the dump (settle runs are disabled; edits through the admin UI are the only plausible writers), which is why `pre` demands that no writer is active and why each stage takes its own backup.

## 9. Approval statements (the owner writes them; this session does not)

Block approval (opens the preparation phases; reads and backups only): *"I approve Block B preparation for revision `<R>` on `afldb_prod`: run D1, the snapshot staging, and for each stage the `pre`, backup, restore verification, `target`, `baseline`, assemble and `plan` phases of docs/v2/block-b-execution-package-2026-11-02.md, using `afldb_owner` as the Brownlow operator role (D-B-ROLE). No stage may be applied without its own approval."*

Stage approval, one per stage (the plan digest is only known after S6): *"I approve applying Brownlow stage `<b0|b1|b2|b3|e>` with plan digest `<digest>` at revision `<R>` on `afldb_prod`, expiring `<UTC time, at most 12 h>`."* The words in the approval's `reference` are these.

Optional single statement for the whole ordered sequence (the owner's choice, weaker than per-digest): *"I approve stages b0, b1, b2, b3 and e in that order at revision `<R>` provided each plan's summary equals the table in section 6 (operation, stage, seasons, counts, receipts), each stage takes its own fresh backup, and any deviation stops the sequence."* Under this wording the digest is still recorded, and `make-approval.mjs` is run only after the summary matches.

## 10. Exact remaining actions

1. Owner: choose to approve D-B-ROLE (`afldb_owner`) and the block approval above (Block M-a complete first).
2. Owner: push R; owner or Claude: D1 and snapshot staging.
3. Per stage: S1 to S6, owner approval of the plan, S7, S8. Then the owner records the Block C acceptance (section 6) and closes GAP-030 and GAP-031 by their receipts.
4. After the last stage: re-baseline anything that follows (C4b, C5), because each stage changes the baseline.
