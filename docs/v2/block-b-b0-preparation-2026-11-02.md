# Block B preparation outcome: stage B0 plan prepared on production (2026-11-02)

**Status: B0 PREPARED. NOTHING WAS APPLIED.** The owner approved Block B preparation (D-B-ROLE: `afldb_owner` through the dedicated Brownlow channel, preparation only). Under that approval the production checkout and package bytes were verified, the two snapshots were staged and verified byte for byte, `pre b0` passed, a fresh backup was taken, privately transferred and restore-verified off-host, the live and restored baselines were proven equal, and a read-only B0 plan exists. No apply, stage approval file, eligibility recording, reversal, restore of production, push, migration, restart, timer change, acquisition activation, cleanup or privilege change took place. Production still holds **0 Brownlow correction receipts**. B1, B2, B3 and E were **not** prepared: they depend on committed preceding stages and their baselines, receipts and plans do not exist yet.

Package: [block-b-execution-package-2026-11-02.md](block-b-execution-package-2026-11-02.md). Evidence: [`evidence/block-b-prep-20261102/`](evidence/block-b-prep-20261102/) (numbered logs 01 to 12).

## 1. Binding

| Item | Value |
|---|---|
| Owner approval | "I approve Block B preparation under docs/v2/block-b-execution-package-2026-11-02.md" (2026-11-02, written in the session; its words are recorded in the backup sidecar) |
| Execution revision R | `ea98a35f20610e75c18e698bc0d9fe084c3c783d` (the production checkout's `HEAD` and the serving release's revision). Local docs-only commits after R do not change it; **nothing was pushed, fetched into, reset or switched** |
| Package bytes | the 14 files extracted on the host from R's own Git objects (`git archive R`) hash identically to R's objects read locally (`b-prod.sh` `73f9c9e9…`, `capture-b.sh` `20c07830…`, `assemble-backup-evidence.mjs` `4d1d1aa8…`, `restore-verify-b.sh` `40ab71ac…`, `snapshots.sha256` `c97c03c5…7e4b`); the package directory is byte-identical between R and the local `HEAD`; between the rehearsed revision `ae8b625b` and R only `restore-verify-b.sh` (the disclosed rehearsal change) and rehearsal logs differ, and no non-docs file differs |
| Target | `afldb_prod`, `afldb-prod` localhost:5432, system identifier `7674454702926115004`, OID `66668`, cluster `16/main`, comment null; the `target` phase equals the reviewed identity field by field |
| Ledger | 118 rows, last `118_fixtures_unconfirmed_participants.sql`, digest `573594e9365b642ec518c252b17de11d3a423872c53c3020ab525db5904aaf57`, read before and after the dump and in the restored copy |
| Serving state | `afldb.service` MainPID 3268373, `NRestarts=0`, before and after (never touched) |

## 2. What ran (UTC, all on 2026-11-02)

| Step | Time | Result |
|---|---|---|
| D1-equivalent (no fetch, no merge, no checkout move) | before 02:41 | checkout `HEAD` = R, clean, `origin/main` ref already R; package extracted from R's objects to `/home/arm/blockb-pkg-ea98a35f2061` (mode 700) and hashed |
| Snapshot staging | before 02:41 | tar of the two retained snapshots (sha256 `fb98a5c4…9d67`, equal at the host); local `sha256sum -c` of all 221 lines first; staged under `data/sources/afl_api/` (Git-ignored) |
| `snapshots b0` / `snapshots b1` | 02:41:14 | `SNAPSHOTS PASS b0 (218 files)`, `SNAPSHOTS PASS b1 (3 files)`; manifests `46a793d8…9b36` and `43dec3ee…47f3`; checkout stayed clean |
| `pre b0` | 02:41:14 | `PRE PASS b0`: no writer unit, process or crontab; identity; ledger 118 and digest; receipts `[]`; facts `330383\|9522\|0\|9522\|0\|0\|0`; 2026 digest recorded |
| Backup (S2) | 02:41:37 to 02:41:46 | `blockb-b0-20261102T024137Z`: `pg_dump` exit 0, 0 stderr bytes, 29,848,939 bytes, TOC 1,651, sha256 `25d89ec745fb2aeed6b16d964da5e7ee3b0a9032eecda53dae609036a5e73536`; ledger unchanged across the capture; writers inactive; `RESULT PASS` |
| Private transfers | 02:42 | workstation `D:\tmp\blockb-private\b0` (ACL: the operator account only) and streamanator `<workspace>/in/prod-b0/` (700/600); dump sha256 equal at all three places |
| Fresh isolated environment | 02:42 | new workspace `/mnt/ssd/afldb-v2-blockb-prod-20261102T024241Z`, candidate = copy of an existing clean candidate fast-forwarded by a hash-checked Git bundle to R (clean, `HEAD` = R), **new** cluster initialised for this run on loopback port 55496 (exclusive-listener proof) |
| Restore verification | 02:43:11 to 02:43:59 | `pg_restore` exit 0, 0 stderr lines, toc 1,651; restored ledger 118, digest equal; 17,056 matches, **218 fixtures** (M-b's); cluster stopped, no listener; DEV `afldb.service` MainPID 1162113 and `postgresql@16-main` MainPID 1504 unchanged |
| `target`, live `baseline` | 02:44 to 02:45 | target equals reviewed facts; live baseline `d998c120…3de5` |
| **First `assemble`** | 02:45 | **REFUSED**: live `d998c120…` differs from the restored copy's `399583ba…`. Treated as a failed gate; the sequence stopped (finding in section 3) |
| Diagnosis and correction | 02:46 to 02:49 | see section 3 |
| `assemble` (second) | 02:49 | `ASSEMBLED b0: baseline d998c120… == restored` |
| **`plan b0`** | 02:49:58 | `Review plan 7c84362f84c09d49dabd4616f4e70eca91d15d65e17bfd5d24895cb93c2bf267; no writes` |
| `pre b0` again, final state check | 02:50:43 and 02:53:41 | `PRE PASS b0` again; receipts `[]`; 2026 digest unchanged; actor 1 active Super Admin; 0 unresolved `afl_api_brownlow_settle` issues; checkout R clean |

## 3. Gate failure and its resolution: session time zone (a package defect)

The Brownlow baseline hashes `to_jsonb` text of 22 tables. `to_jsonb` renders `timestamptz` in the **session time zone**. Production's server time zone is `Australia/Melbourne`; the isolated restore cluster's sessions are `Etc/UTC`. The rehearsal could not show this (live clone and restore ran on one cluster). The package's S3 therefore cannot produce a restored baseline equal to production's.

Proof that production did **not** change (a write between capture and baseline would have), using the runner's own per-table hash query, read-only, in a repeatable-read read-only transaction:

| Comparison | Result |
|---|---|
| live (Melbourne session) vs restored (UTC session) | counts equal in all 22 tables; hashes differ in 14 tables (those holding timestamps); equal in the 4 that hold none (`brownlow_season_votes`, `players`, `player_match_stats`, `external_identities`) and in the 4 empty ones |
| **live read in a UTC session vs restored (UTC session)** | **all 22 table hashes and counts identical** |

Correction (no packaged script edited, no production action, disposable database only): `ALTER DATABASE afldb_v2_blockb_b0_rst_test SET TimeZone = 'Australia/Melbourne'`, then the **same real runner `baseline`** on the restored copy. Result `d998c1200d7b5de7dc0d93f35005cd2eacad65b95924412a5bc39720ce9b3de5`, **equal to production's**. The UTC-session restored baseline (`399583ba…`) is retained as `baseline-restored-utc-session.json`; the aligned one is `baseline-restored-melbourne.json` on the host. The script is [`restored-timezone-align.sh`](evidence/block-b-prep-20261102/restored-timezone-align.sh).

**Consequence for every later stage:** S3 must be followed by this alignment step, or S5 will refuse. It is a defect of the package procedure (not of the runner, which compares like with like at `plan` and `apply`: both read live, same time zone). Editing `restore-verify-b.sh` would change R's pinned bytes, so the step is recorded here and in the ordered-sequence approval below, not patched.

## 4. B0 plan: what it would do

| Item | Value |
|---|---|
| **Plan digest** | `7c84362f84c09d49dabd4616f4e70eca91d15d65e17bfd5d24895cb93c2bf267` (`plan.json` sha256 `6e8f2697…5ea0`) |
| Created / **expires** | 2026-11-02T02:49:58.336Z / **2026-11-03T02:49:58.336Z** (24 h; `make-approval.mjs` caps an approval at 12 h and never beyond the plan) |
| Operation | `observe`, stage `fixture-identities-2025`, seasons `[2025]` (2026 not included) |
| Snapshot | `afl-api-2025-2026-10-20-014218`, manifest sha256 `46a793d8874ff7e1063e4323cb14154f7852dfd184679588dfae58f59b769b36`, 218 files |
| Built observation records | **212**; `recordsDigest` `d6bbe18465b02915627defde6db6a42849de80fbfedb5822d9fd2c980c9e671f`; **refused provider match ids (4)**: `CD_M20250142501`, `CD_M20250142502`, `CD_M20250142503`, `CD_M20250142504`. The rehearsal plan has the same 212, the same 4 refusals and the same records digest |
| Exact writes (one transaction, with its receipt) | `import_batches` +1 (completed), `staging.source_records` and `staging.source_record_versions` (the 212 fixture-identity observations), `brownlow_correction_receipts` +1 (`observe`). **Inside the same transaction the runner re-hashes all 22 tables and rolls the whole stage back if any table other than those three moved**, if `staging.source_records` or `import_batches` did not move, or if vote values, zero rows, provenance or the 2026 rows are not preserved |
| Not written | any `brownlow_round_votes` row, `matches`, `fixtures`, `players`, `site_settings`, `auth_users`, awards or career data; no canonical vote write |
| Baseline bound | `d998c1200d7b5de7dc0d93f35005cd2eacad65b95924412a5bc39720ce9b3de5` (live == restored copy of backup `25d89ec7…3536`) |
| Backup / restore evidence | `blockb-b0-20261102T024137Z` (above); `restore-evidence-b0.json` sha256 `07418a0e687ce6c7ca058a994356ca8a182224e371beefca63ce4bbe9ca1eecb`, `backup-b0.json` sha256 `22195af6234529cdab00c3d1e6abbeac571fbc5c87e5dc835ee5002f05087845`; `restoredAt` 02:43:25.839Z after `capturedAt` 02:41:46.489Z |
| Acceptance after apply | receipts exactly `observe=1`; facts `330383 \| 9522 \| 0 \| 9522 \| 0 \| 0 \| any`; 2026 digest unchanged |
| Operator role | `afldb_owner` through `AFLDB_BROWNLOW_CORRECTION_DSN`, parsed inside the phase (D-B-ROLE); reads for identity, ledger, receipts and acceptance use `afldb_backup` read-only |

## 5. 2026 preservation proof

| Fact | Value |
|---|---|
| 2026 `brownlow_round_votes` rows | **9,522**, all with `match_id` NULL |
| Digest recorded by `pre b0` (and preserved in `/home/arm/ops/blockb-ea98a35f2061/votes2026.digest`) | **`9522:8096c0494f77a8f4cd1ed270654fae95`** |
| Re-compared | at the second `pre b0` (02:50:43) and the final check (02:53:41): equal; every later `pre` and `accept` re-compares it, and the B2 request excludes 2026 |
| Whole-table facts now | total 330,383; 2026 9,522; in-scope with `match_id` 0; 2025 source-less 9,522; 2025 `afl_api` 0; staged 2025 0; eligibility decisions 0 |

## 6. Genuine unresolved gates

**None blocks B0.** For the record:

1. The session time zone defect (section 3) is resolved for B0 by an isolated-database setting; it needs the owner's awareness because it is a deviation from the packaged S3, and every later stage must repeat the step.
2. The four refused provider ids are expected (they appear identically in the rehearsal plan); the owner's apply approval names the plan digest, which binds them.
3. Not a B0 gate, but checked read-only for the sequence: the E-stage actor (user 1) is an active Super Admin and there are 0 unresolved `afl_api_brownlow_settle` issues now. `pre e` re-checks both at its time.
4. Time: the approval below expires 2026-11-02T14:00:00Z; the plan itself lives to 2026-11-03T02:49:58Z, and the backup is accepted for 24 h from 02:41:46Z. After either, B0 repeats S2 to S6. The apply also re-runs `snapshots` and `pre` and re-derives the baseline: **any production write between now and the apply (an admin edit, a settle) makes the runner refuse with nothing written, and the plan must then be retaken.**

## 7. B0 apply approval (complete; drafted, NOT granted, NOT executed)

> I approve applying Brownlow stage **b0** (operation `observe`, stage `fixture-identities-2025`, season 2025) with plan digest `7c84362f84c09d49dabd4616f4e70eca91d15d65e17bfd5d24895cb93c2bf267` at revision `ea98a35f20610e75c18e698bc0d9fe084c3c783d` on `afldb_prod` (`afldb-prod`, system identifier `7674454702926115004`, database OID `66668`), expiring `2026-11-02T14:00:00Z`. Scope: one transaction that records the 212 fixture-identity observations of snapshot `afl-api-2025-2026-10-20-014218` (manifest `46a793d8874ff7e1063e4323cb14154f7852dfd184679588dfae58f59b769b36`, records digest `d6bbe184…671f`, the four refused ids as in the plan) in `import_batches`, `staging.source_records` and `staging.source_record_versions`, plus one `observe` receipt, with no canonical vote write and the 2026 rows (9,522; digest `9522:8096c0494f77a8f4cd1ed270654fae95`) unchanged. Use `afldb_owner` through the packaged channel (D-B-ROLE) for this apply only. Run `make-approval.mjs` with these words, then `apply`, then `accept` (required: receipts exactly `observe=1`, facts `330383|9522|0|9522|0|0|any`), then stop. The stage is never re-applied; any refusal, exit 7, drift or unexpected `accept` result stops with nothing further done and is reported before any retry. No later stage, push, restart, timer change, acquisition activation or cleanup is approved.

Mechanics when granted: `node make-approval.mjs --plan $OPS/b0/plan.json --revision R --reference '<the words above>' --expires 2026-11-02T14:00:00Z --out $OPS/b0/approval.json` (the tool refuses an expiry more than 12 h ahead or after the plan), then `b-prod.sh apply R b0 plan approval dump restore-evidence`, then `b-prod.sh accept R b0`.

## 8. Alternative: conditional ordered-sequence approval (complete; drafted, NOT granted, NOT executed)

Choose either section 7 (one stage at a time) or this one. It keeps a fresh plan, fresh backup, restore verification and stop conditions for **every** stage, and it removes only the interruption between "plan ready" and "apply". Package section 9 allows it; the digest is still recorded and `make-approval.mjs` runs only after the plan's summary equals the row below.

> I approve Brownlow stages **b0, b1, b2, b3 and e** in that order at revision `ea98a35f20610e75c18e698bc0d9fe084c3c783d` on `afldb_prod` (system identifier `7674454702926115004`, OID `66668`), using `afldb_owner` through the packaged channel (D-B-ROLE) for these applies only, **provided** that for each stage: (1) `pre` passes with receipts exactly as that stage expects; (2) a **fresh** backup of that stage is taken, privately transferred, restore-verified off-host in a fresh isolated environment, the restored copy's session time zone is aligned to `Australia/Melbourne` before its runner baseline, and the **live and restored baselines are equal**; (3) the stage's plan summary equals the row below in every listed field; (4) the 2026 digest `9522:8096c0494f77a8f4cd1ed270654fae95` (9,522 rows, `match_id` NULL) is unchanged; (5) `accept` after the stage equals the row below. Each stage's approval file is created only after (1) to (4), expires no more than 4 hours after its plan, and carries these words as its reference. **Any deviation, refusal, drift, exit 7 without a matching `accept`, expired plan or unexpected count stops the whole sequence and is reported; nothing is retried or skipped, a stage is never re-applied, and no later stage runs.** Stage scopes:
>
> | Stage | Plan summary must equal | `accept` must equal (total \| 2026 \| in-scope `match_id` \| 2025 source-less \| 2025 `afl_api` \| staged 2025 \| decisions) and receipts |
> |---|---|---|
> | **b0** | `observe`, stage `fixture-identities-2025`, seasons `[2025]`, snapshot `afl-api-2025-2026-10-20-014218`, manifest `46a793d8…9b36`, 212 built records, 4 refused (`CD_M20250142501` to `…04`), records digest `d6bbe184…671f` | `330383 \| 9522 \| 0 \| 9522 \| 0 \| 0 \| any`; `observe=1` |
> | **b1** | `observe`, seasons `[2025]`, snapshot `afl-api-brownlow-2025-2026-10-20-014218`, manifest `43dec3ee…47f3`; 207 sets, **621** positive vote rows, 188 leaderboard players; no canonical vote write | `330383 \| 9522 \| 0 \| 9522 \| 0 \| 621 \| any`; `observe=2` |
> | **b2** | `backfill`, the 42 seasons 1984 to 2025, **2026 excluded**; `match_id` set on exactly **320,861** rows (22,239 positive + 298,622 zero); only `match_id` moves | `330383 \| 9522 \| 320861 \| 9522 \| 0 \| 621 \| any`; `backfill=1,observe=2` |
> | **b3** | `adopt`, seasons `[2025]`; **621** rows adopted to `afl_api`, **8,901** zero rows keep their source-less provenance, 621 `canonical_applications` rows | `330383 \| 9522 \| 320861 \| 8901 \| 621 \| 621 \| any`; `adopt=1,backfill=1,observe=2` |
> | **e** | `eligibility`, 12 rulings, `actorId` 1 (an active Super Admin), 0 existing decisions, 0 unresolved `afl_api_brownlow_settle` issues at `pre e`; 12 decision rows with audited metadata and career publication in the same transaction; raw votes unchanged; the twelve players ineligible with no eligible rank; the 2025 winner stays player 9235 with 39 votes | `330383 \| 9522 \| 320861 \| 8901 \| 621 \| 621 \| 12`; `adopt=1,backfill=1,eligibility=1,observe=2` |
>
> Reconciliation that must hold: 330,383 = 320,861 + 9,522; 22,860 = 22,239 + 621; 307,523 = 298,622 + 8,901. This approval does not cover the Block C acceptance, any reversal or restore of production, a push, migration, restart, timer change, acquisition activation, cleanup or privilege change. To stop before eligibility, strike "and e" and the `e` row: stage E then needs its own approval.

Notes: b0 in this sequence may reuse the plan `7c84362f…` only while it, the backup and the approval are all unexpired and `apply`'s own re-check passes; otherwise b0 repeats S2 to S6 first. Plans for b1 to e do not exist and cannot until the preceding stage commits.

## 9. Disclosures and what was left in place (no cleanup was authorised)

* Production host, outside Git: `/home/arm/blockb-pkg-ea98a35f2061` (package copy), `/home/arm/blockb-pkg-ea98a35f2061.sha`, `/home/arm/ops/blockb-ea98a35f2061/` (`votes2026.digest`, `b0/` with `target.json`, `baseline-live.json`, `request.json`, `plan.json`, `evidence/`; `b0-in/` with `restore-facts.json`, `baseline-restored.json` (UTC session, **not** used) and `baseline-restored-melbourne.json`), `/home/arm/backups/afldb/blockb-b0-20261102T024137Z/`, `/home/arm/blockb-b0-capture-20261102T024137Z.log`, the staged snapshots under the checkout (Git-ignored; checkout clean), step scripts `/home/arm/bb-*.sh` and `/tmp/bb-*` (including a read-only query script).
* Workstation: `D:\tmp\blockb-private\b0` (dump, sidecar, restore inputs; ACL: operator only).
* Streamanator: workspace `/mnt/ssd/afldb-v2-blockb-prod-20261102T024241Z` (its cluster is stopped, no listener on 55496), `/tmp/bb-*.sh`, `/tmp/bb-tables.sql`, `/home/arm/.blockb-w-path`. Quarantined stores and the older workspaces were not touched.
* Port: `restore-verify-b.sh` defaults to 55493 (an older workspace's cluster); this run used 55496 through its documented environment variable, in its own new cluster.
* The authentic production-only facts: the base data here is today's production (ledger 118, 218 fixtures), not the 2026-10-31 dump of the rehearsal; B0's 212 observations and records digest equal the rehearsal's.
* Visual: no UI change; not applicable.

## 10. Correction of the record

* **M-a changed the ledger to 118 (117 to 118, migration `118_fixtures_unconfirmed_participants.sql`); M-b did not.** M-b created the 218 fixtures, one completed import batch, the explicit `false` acquisition setting and two audit rows; the ledger was 118 before and after it. The M-b outcome section 6 listed `afldb_meta.schema_migrations` among the tables "this window changed"; that line is corrected there.
* **The earlier backups remain valid retained recovery archives.** They are *unsuitable as current Brownlow baseline evidence* (a Brownlow plan binds to a baseline taken after the preceding state-changing block), not invalid backups. The wording "void" for backups is corrected in the M-b outcome, the M-b package table row, the M-a outcome and the CHANGELOG. Specifically retained: `blockm-a-20261102T014742Z` (the pre-M-a insurance, ledger 117), `blockm-b-20261102T022308Z` (ledger 118, immediately before the fixture window) and the earlier Block L and capture archives; their restore evidence stays valid for what it proved.
