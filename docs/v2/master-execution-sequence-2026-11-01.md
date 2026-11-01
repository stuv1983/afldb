# Master execution sequence and approval blocks (2026-11-01)

**Status: PREPARED. NOTHING WAS EXECUTED ON PRODUCTION OR ANY SHARED DATABASE.** Everything proven below was proven on guarded, disposable `afldb_v2_*_test` databases restored from the checksum-verified production backup `afldb_prod-20261031-084435.dump` (sha256 `3f5b5339…4730`), with the real runners and the real `pg_dump` / `pg_restore`. No push, installation, restart, provider or writer activation, or cleanup took place. Frozen P/H/EXEC, the parked legacy ISSUE-327, `.codex/`, backups and retained evidence are untouched.

This document orders the remaining owner-attended work, gives each block its **own exact approval**, and records what is proven, what is only simulated, and what cannot be proven off the production host. It supersedes the ordering text of the earlier per-subsystem packages where they differ; their command detail still stands except where section 7 corrects it.

## 1. Rules that bind every block

1. **One block, one approval.** Approving a block authorises exactly its own steps. It does not authorise any other block, even in the same owner-attended session. A block's approval is a written statement of the form in its section; "go ahead" is not an approval.
2. **Relative timing only.** `T0` is the moment the owner says the session starts. Times below are offsets from `T0` and from the previous step's completion; no calendar date is held. A block may be run in a later session, subject to the re-planning rule in section 3.
3. **Re-plan after every state-changing block.** A plan, backup, restore evidence and baseline taken before an earlier block are void for a later one (section 3 explains which table each block moves). A plan bound to ledger 117 is **not** reused for a ledger-118 target: it is re-taken, re-hashed and re-approved.
4. **Stop on the first unexpected result.** The stop conditions are in each block. Nothing is retried blindly; the recovery route is stated beside the step.
5. **Nothing here activates an AFL API timer, writer or provider** except where a block says so by name (the temporary switch in block M, the rehearsal in block C4b, and the cutover in C5), and each of those has its own approval and its own restore.
6. **No secret is printed, committed or put in a request.** DSNs travel only as the environment secrets the tools name. Evidence directories are new, outside the checkout, and created exclusively.

## 2. Order and why

| Order | Block | Moves | Depends on |
|---|---|---|---|
| 1 | **L**: the 64 evidenced match-event labels | `matches.match_event`, `data_edits`, `data_overrides` | nothing |
| 2 | **M**: migration 118, compatible code, first 2027 fixture apply | schema ledger 117 → 118, `fixtures`, `import_batches`, `site_settings` (temporary switch) | L is independent; M needs its own backup |
| 3 | **C3**: install the four AFL API units inert | files in `/etc/systemd/system` only | M (the code must carry the units' scripts) |
| 4 | **C4b**: D1 rehearsal | `site_settings` (toggled and restored), `auth_audit_log`, a snapshot | C3 and M deployed |
| 5 | **C5**: cutover go | switch, one timer | C4b PASS record |
| any time after 2 | **B**: ordered Brownlow stages | `brownlow_*`, `canonical_applications`, `import_batches` | **BLOCKED**, see section 6; re-baselined after L and M |

L and M can share one owner-attended session, as can C3, C4b and C5, but each remains separately approved. B is independent of C3 to C5 and is held back only by the blocker in section 6.

## 3. Ledger and digest dependencies (what a later stage must recompute)

The Brownlow runner's baseline hashes a closed list of tables that includes `afldb_meta.schema_migrations`, `site_settings`, `import_batches`, `data_edits`, `data_issues` and `auth_users`. Therefore:

| Earlier block | Table(s) it changes that the Brownlow baseline hashes | Consequence |
|---|---|---|
| L (labels) | `data_edits` (+64 audit rows), `data_overrides`, `matches.match_event` | any Brownlow plan or backup made before L is void; the 64 audit rows are expected in the new baseline |
| M (118) | `afldb_meta.schema_migrations` (ledger 117 → 118), `import_batches` (+1 fixture batch), `site_settings` (the switch row) | the package text "expect 117 as latest" becomes "expect 118 as latest"; the owner read-only block (Brownlow package section 3) is re-run; baselines are retaken |
| C4b | `site_settings` (an explicit `false` row replaces "absent"), `auth_audit_log` (two rows, plus two if a watchdog acts) | a Brownlow baseline taken before C4b differs after it; retake |
| C5 | `site_settings` (`true`) | as above |

Rule: **take the Brownlow `baseline`, backup and restore evidence immediately before its `plan`, in the same session as the stage, after every block you intend to run before it.** The runner refuses a stale baseline, so the failure mode is a refusal, not silent damage. For the C3 to C5 chain, the C4b tool takes its own BEFORE/AFTER records and compares them; it needs no external baseline.

## 4. Block L: the 64 evidenced match-event labels

**Approval statement (owner writes it, naming the revision R and the evidence file):** "I approve block L at revision R: label the 64 matches in `docs/v2/evidence/gap029-match-events-r2-2026-11-01.json` (sha256 `e3848807…430f` after line-ending normalisation) using `tools/v2/apply-gap029-match-events-production.ts`, with the plan digest shown by `plan`, valid until <expiry ≤ 24 h>."

Tool: `tools/v2/apply-gap029-match-events-production.ts` (modes `baseline`, `plan`, `apply`). It requires: a clean tracked checkout at the approved revision; the target named by `target.json` (host, port, database, user) to equal the writer DSN supplied in `AFLDB_GAP029_DSN` and the application's `AFLDB_IMPORT_DATABASE_URL` / `DATABASE_URL` to name the same host, port and database; a fresh backup and verified restore (24 h, bytes re-hashed); an actor who is an active Super Admin; every one of the 64 rows re-validated against the evidence file (`entryProblem`); the covered matches carrying no event already. It writes each label through the application's own audited edit path (`saveEdit`, one transaction each, so a stop is resumable), then verifies by deltas (`auditRowsAdded`, `overridesAdded`) and by the distribution **Anzac 31 / Dreamtime 22 / King's Birthday 11**.

Steps (each relative to `T0`):

| Offset | Actor | Step | Check |
|---|---|---|---|
| +0:00 | operator | clean checkout at R; `git rev-parse HEAD` equals R; `git status --porcelain` empty | equal / empty |
| +0:05 | operator | fresh `pg_dump -Fc` of `afldb_prod`, restore into a scratch database, restore evidence written | restore evidence `restoredAt` after `capturedAt` |
| +0:20 | operator | `baseline` on production and on the restored copy | the two baseline digests equal |
| +0:25 | operator | `plan` | "Review plan <digest>", 64 to label, no writes |
| +0:30 | owner | writes `execution-approval.json` pinned to the plan digest, R, target, evidence sha, expiry | file exists |
| +0:35 | operator | `apply` | result: 64 labelled, 64 audit rows, 64 active overrides; distribution as above |
| +0:50 | operator | replay of the same plan and approval | "already applied", writes nothing |

**Proven on disposable copies** (`tools/v2/gap029-labels-isolated-e2e.mts`, **24/24 checks**, run on a fresh clone of the production-derived restore): baseline on live equals baseline on the restored backup; four plan refusals (non-Super-Admin actor, wrong target identity, writer naming another database, backup bytes differing); no refusal wrote anything; four approval refusals (wrong revision, expired, no reference, another plan's approval); a plan edited after review is refused; baseline drift is refused; an injected audit failure after 10 labels leaves exactly the labels written so far (resumable); a fresh backup, re-plan and resume completes to 64; replay writes nothing. **Not provable here:** the production host, role grants and network; the first apply on the real `afldb_prod` OID.

After the apply, pages that use `match_event` (search, grid) are ISR-cached: allow the ISR window (about one hour) or revalidate before judging them. Stop if any check fails, if `plan` shows other than 64, or if the distribution differs. Recovery: labels are individually audited overrides; the standing route is the backup taken at +0:05. Do not hand-edit rows.

## 5. Block M: migration 118, compatible code, first 2027 fixture apply

Three gated steps under **one** approval, each with its own stop condition. The approval names R (the commit the owner pushes; later commits follow `fb54a3ed`), migration 118's blob sha256 (`49e59fcd…8401`), and the pinned 2027 snapshot (`afl-api-2027-2026-11-01-012026`, feed sha256 `21fd12e7704b7c7146cfbab414352352f3cfaa53e7ef5038f4411fa789e4c84d`).

**Order is mandatory: schema, then compatible code, then (only afterwards) the first fixture apply.**

### M1: migration 118 (schema only; no fixture row is written)

Owner-approved fresh backup; push of the reviewed commits (fast-forward only); fast-forward merge on the host; `tools/db/migrate.ts --target prod --status` (read-only) shows exactly one pending migration, `118_fixtures_unconfirmed_participants.sql`; then the same command without `--status`. Ledger becomes 118.

**Rollback compatibility, proven on disposable copies of the production-derived restore** ([record](issue229-rollback-compatibility-2026-11-01.md)): 117 → 118 with **no ingestion** succeeds and rewrites no row; the **previous revision** (`ad245d60`) and the **revision production serves now** (`fd48ace0`, probed separately) run against schema 118 with public and admin routes returning 200 and manual fixture creation working. After the **218-record retained feed has been applied** (the populated-118 state), code rollback to that revision still serves public and admin routes, but **11 label-participant fixture rows are invisible to the old admin code and the label-fixture detail page returns 404**; no data is lost or changed. **Therefore a code-only rollback after the first apply is safe for public availability and for the 135 confirmed fixtures, and is *not* a full-fidelity rollback**: the 83 unconfirmed and 11 label rows are not shown to the old admin. The exact data-recovery route if the owner needs the pre-118 view back: the schema undo is rehearsed on a disposable copy ([script](evidence/issue229-undo-118-rehearsal-2026-11-01.sql): it first removes only the provider-owned 2027 rows, which the retained feed re-creates, then drops the added constraints and columns, restores NOT NULL on the club ids and removes the ledger row; not an authorised production step). Removal is by source and season (or by the apply's import batch), never by hand. The pre-apply backup is the authoritative restore.

### M2: compatible code (release)

`node deploy/release.mjs build` for R, `promote`, owner `sudo systemctl restart afldb`, `status --expect`, `post-install-check.sh`. Rollback is `release.mjs rollback`, which is safe at this point because no fixture row exists yet (above).

### M3: the first 2027 fixture apply

**Finding F-229-SWITCH (new, material).** `settle-afl-api-fixture-schedule.ts` refuses `--dry-run` and `--apply` unless `site_settings.acquisition.afl_api_current_season_enabled` is **true** (it reads the same switch as the cutover). Production holds the switch **absent**. So the first apply needs a **temporary enable of the ingestion switch** and a verified restore to `false`, and this must be approved as such. It does **not** start a timer: the AFL API units are not installed (C3 not done) and the AFL Tables timer is disabled, so nothing acquires while the switch is on. It must be restored before C4b, whose preconditions require the setting absent or exactly `false`. The explicit `false` row then left behind is accepted by C4b and by the application's reader (it reads both the string `"false"` the admin toggle writes and a boolean).

Steps: (a) `--validate-only` of the pinned snapshot copied to the host (hash-checked, no connection); (b) fresh backup; (c) switch on through the admin toggle as a Super Admin (writes `auth_audit_log`), read back; (d) `--dry-run` (expected `created=218`, rolled back, 0 rows after); (e) `--apply` (expected `created=218`, one batch, **135 confirmed / 83 unconfirmed, 11 label-participant rows, 10 NULL venues, 83 NULL dates and times, 0 unconfirmed rows with a date or time**); (f) switch off through the admin toggle, read back `false`; (g) replay `--apply` is refused by the switch (so a replay is proven on the disposable copy: `no_changes`, 218 unchanged, byte-identical).

Stop if the dry-run does not report 218 created and 0 rows after, or if the apply reports anything else, or if the switch cannot be restored and verified (then use the switch's admin toggle; never leave it on).

**Proven on disposable copies:** [fixture proof](evidence/issue229-2027-fixture-local-proof-2026-11-01.json) (retained 218-record feed applies and replays idempotently; lifecycle refusals), and the **admin fixtures list** (36/36 desktop and mobile Playwright checks, screenshots retained): confirmed, unconfirmed and label fixtures all appear with their confirmation state; unknown participants, venue and kick-off show as TBC; no provisional timestamp is shown as confirmed; no placeholder appears as a result. **L1 is fixed and tested:** when a provider-managed final slot exists in a round, a manual create is refused with a named reason rather than silently overlapping it; legitimate multiple finals in one round are preserved; ambiguous matches are refused clearly. **Not provable here:** the live production switch, timing and role grants.

## 6. Block B: ordered Brownlow stages (BLOCKED)

[Ordered package](brownlow-ordered-execution-package-2026-11-01.md) stays the stage reference; this section replaces its ordering and corrects its expectations.

**Finding F-BRO-1 (blocking).** Stage B1 (`observe` of the 2025 Brownlow snapshot) cannot succeed on production as packaged. The adopt stage groups the 207 vote sets by match, and every set was `unknown_match` on the production-derived restore, because production holds **no 2025 `afl_api` match-family (fixture) observations** (only the 217 of 2026). The 212 that the earlier rehearsals had came from `settle-afl-api-fixtures.ts`, which now **refuses sealed seasons (1897–2026)**, and the fixtures snapshot they were built from (`afl-api-2025-2026-10-20-014218`) is **not retained anywhere** (searched `D:\tmp`, `D:\dev`, `.local-release`, `D:\backups`). **An owner decision is needed** before block B can be approved: (1) a new reviewed route for the 2025 fixture identities; (2) re-acquire the 2025 fixture snapshot from the provider under the owner's authority and settle it through a reviewed sealed-season path; or (3) another route the owner chooses. Until then B stays unapproved. The isolated rehearsal below proves the later stages with that one prerequisite **seeded and labelled SIMULATED**.

**Finding F-BRO-2 (fixed, committed `b683cfc3`).** `observe` was running observe-only, which skips the typed projection `staging.afl_api_brownlow_vote`, so adopt refused "expected exactly 207 sets / 621 positives / 8901 legacy zeros". The runner now writes the typed projection (`apply: true, autoApply: false, observeOnly: false`), so after `observe` the staging holds **621 typed rows and 207 distinct sets**, with no canonical vote change. The package's B1 acceptance row (staged 621) is now correct as written; the earlier package sentence implying observe-only is superseded.

**Finding F-BRO-3 (fixed, committed `5768249b`).** The pinned eligibility request lacked the explicit `"seasons":[2025]` the runner requires ("scope must name explicit seasons 1984–2025; 2026 excluded"). The file now carries it; its sha256 is `563f336ea92a549d79c0dfd0a4bd2fd61fbdfa0b484f6cac1d47bc10228e858b` (was `0f49b83e…22b65`; the twelve rulings are unchanged).

**Approval statement for each stage (when unblocked):** one per stage (observe, backfill, adopt, [resolve only if the count is non-zero], eligibility), each pinned to its own plan digest, the executing revision, the target, the operation, the seasons and an expiry. Skip `resolve` only when the checkpoint count of unresolved `afl_api_brownlow_settle` issues is **0**, evaluated freshly at that point (it was 0 on every disposable run).

**Actual end-to-end result on a disposable copy (53/53 checks, `tools/v2/brownlow-isolated-e2e.mts`, the real runner CLI, real `pg_dump`/`pg_restore` into a second database per stage, fresh clone of the production-derived restore; run 5, after the fixes above).** Per stage the driver took a fresh backup, restored it, required the live and restored baselines to be equal, then plan, approval, apply and replay. **B1 observe:** 621 typed rows staged, 207 distinct sets, no canonical vote change, exactly one receipt, replay writes no second receipt or batch, 2026 untouched. **B2 backfill (1984 to 2025):** plan repairs exactly 320,861 rows; an injected receipt failure rolled all 320,861 candidate writes back with every table unchanged; the recovery apply of the same plan committed; replay wrote no second receipt; `match_id` is set on exactly 320,861 in-scope rows; the 9,522 2026 rows keep `match_id` NULL and are byte-identical; totals 330,383 (positive 22,239, zero 298,622 in scope); only `match_id` moved. **B3 adopt:** 207 adoptable, 0 refused; 621 rows adopted to `afl_api`, the 8,901 zero rows keep their original provenance; season, player, round, votes and `match_id` unchanged; 621 `canonical_applications` audit rows; replay writes nothing. **Resolve checkpoint:** 0 unresolved `afl_api_brownlow_settle` issues, so `resolve` was skipped by the package rule. **E eligibility:** an approval omitting one of the twelve rulings is refused with state unchanged; apply commits 12 decisions, all twelve players ineligible with no eligible rank; the 2025 winner stays player 9235 with 39 votes at eligible rank 1; raw vote rows unchanged; replay writes nothing. **Acceptance:** exactly one receipt per stage (observe, backfill, adopt, eligibility = 4), 2026 vote rows byte-identical to the start. Refusals exercised: stale or edited plans and approvals, wrong target, missing rulings. Report: `D:\tmp\afldb-bro-e2e-20261101e\report.json` (counts, digests, statuses; no DSN). **Simulated and labelled so:** the 212 2025 `afl_api` fixture observations were copied from an earlier rehearsal database by `tools/v2/brownlow-isolated-seed-2025-fixture-observations.mts` (one SIMULATED import batch). That is exactly the F-BRO-1 prerequisite; it is not production evidence. **Not provable here:** the production OID, roles, grants and the host's `pg_dump`.

## 7. Block C: C3, C4b, C5

The commands are those of [the C2–C5 packages](issue316-gap011-c2-c5-packages-2026-11-01.md) (sections 3, 5, 6), with these corrections and additions.

**C2 acceptance** is recorded on the corrected criterion in that document's section 2 (the actual production writer-retirement boundary of 2026-10-31, not the earlier undeployed plan's rollover label). It does not accept C3 to C5.

**C3 (inert install, owner sudo).** Approval names the revision and the six pinned file hashes. Proven only as far as the files' syntax and the acceptance reads; the install itself is host-only.

**C4b (D1 rehearsal).** Approval is D-316-13, granted only after C3 and M2 are deployed. **Proven in isolation** (`tools/v2/c4b-isolated-e2e.mts`, **36/36 checks**, real tool code, real detached watchdog process, real database writer and control-path reader): the setting is restored and verified on success (CLEAR), on a settle failure, on a step that throws, on a dry-run that reports canonical writes, on an incomplete feed, on a BEFORE/AFTER difference, on SIGINT and on a deadline; a transient restore failure succeeds on the third attempt; a permanent restore failure exits 3 "RESTORATION NOT VERIFIED", leaves the setting honestly `true`, and `--restore-only` recovers it; refusals (a timer enabled, a service active, the register not `[2027]`, a leftover `true`, writer and control path naming different databases) write nothing and arm no watchdog; **a parent SIGKILL is rescued by the watchdog, which turns the setting off by itself in about 5 seconds** with an audit trail. **Defect found and fixed (F-C4B-1, committed `4518f321`):** the tool wrote and read the setting as a real JSON boolean while the admin toggle stores the JSON **string** `"false"` (postgres.js double-encodes), so a restore could never verify and a leftover admin-written `"false"` was refused; the tool now reads both forms as the application does, writes a real boolean, and normalises only its own key in the BEFORE/AFTER record. Unit tests added (normaliser; strict `AFLDB_SETTLE_TRIGGER`). **Simulated, and said so in the report:** `systemctl is-enabled|is-active` answers (no systemd on the workstation), the post-C2 `[2027]` register supplied in memory (the repository file is the pre-C2 `[2026]`), the two provider-facing steps (acquire and settle dry-run are scripted), and the readiness verdict. **Genuinely not reproducible in isolation:** real `systemd` unit and timer states, the unit's `UnsetEnvironment=`, polkit, the provider's live response, and the production role grants.

**C5 and the trigger plan (`AFLDB_SETTLE_TRIGGER=systemd`, approved for the C5 plan).** Set it explicitly **at C5**, through the reviewed configuration mechanism, not now. What it does, from the code: `settleTriggerConfigured()` is strict equality to `'systemd'` and it gates **only read-only `systemctl show` status reads** for the three settle units; `startSettleRunAction` is retired and never imports `startSettleRun`; there is **no direct-execution path** anywhere. Steps: (1) `.env` gains the single line `AFLDB_SETTLE_TRIGGER=systemd` (the unit takes `EnvironmentFile=/home/arm/projects/afldb/.env`); (2) **configuration read-back:** `grep -c '^AFLDB_SETTLE_TRIGGER=systemd$' .env` equals `1`, and no other `AFLDB_SETTLE_TRIGGER` line exists; (3) **owner restart** `sudo systemctl restart afldb` (30 s after the last start); (4) **effective-environment read-back:** the value in `/proc/<MainPID>/environ` for the new MainPID equals `systemd`; (5) the Settle panel's service column now reads unit state instead of "On-demand refresh is not enabled on this host." **Absent or invalid configuration cannot introduce a direct-execution fallback — proven by unit test:** the values undefined, empty, `off`, `Systemd`, `SYSTEMD`, ` systemd`, `systemd `, `true`, `1`, `direct` and `systemd\n` are all "not configured": status reads are unavailable, `startSettleRun` returns `unavailable`, and **no child process is spawned**; only the exact `systemd` allows the read-only `show`, and never `start`. Rollback: delete the line and restart `afldb`.

C5 additionally requires: the C4b PASS record, no 2027 match started (the first starts 2027-03-17 UTC), the Brownlow timer disabled, and its own D-316-4 approval.

## 8. Proven, simulated, not provable

| Subject | Proven on disposable copies (real code, real PostgreSQL) | Simulated or scripted (disclosed) | Cannot be proven off the host |
|---|---|---|---|
| Admin fixtures list, L1 | 36/36 visual checks, 89 + 45 focused tests | none | live data volume |
| Migration 118 and rollback | 117 → 118; candidate manages confirmed/unconfirmed; 218 feed applies and replays; old revision on 118 before and after ingestion; schema undo rehearsal | the "old revision" is run from a build of its commit, not the production process | production traffic |
| 64 labels | 24/24 e2e (refusals, drift, injected failure, resume, replay) | the actor is a seeded Super Admin | the production OID, roles, network |
| Brownlow B1 to E | section 6 | the 2025 fixture observations (F-BRO-1) | production OID, roles, backups on the host |
| C4b | 36/36 e2e | systemd answers, `[2027]` register, scripted acquire and settle, readiness verdict | real systemd, polkit, provider, `UnsetEnvironment=` |
| Trigger | unit tests over eleven values; no spawn | none | the live `.env` and process environment |

### 8.1 Isolated Linux qualification (2026-11-01) - NONCONFORMING ENVIRONMENT, superseded by 8.2

> **These results were obtained inside the quarantined WSL distro `AFLDB-V2-Rehearsal-20261020`, which ISSUE-331 / D-331-2 forbids booting.** They are retained unedited for the record and are **not authorised release qualification**; no approval block may cite them. The toolchain came from a changed, unverifiable store. ISSUE-331 is reopened for this use (`docs/v2/issue331-incident-assessment-2026-11-01.md` section 6). The correct qualification is section 8.2.

Workstation Windows runs do not prove Linux behaviour, so the changed tools were re-run on Linux. **Environment:** the WSL2 distro `AFLDB-V2-Rehearsal-20261020` (Linux, systemd present but not used by the drivers), non-root user `rehearsal`, Node v22.21.0, PostgreSQL 16 client and server binaries, 31 GB RAM and 915 GB free before the run (checked first; nothing deleted or unregistered). Workspace `/home/rehearsal/qual-20261101` = `git archive` of the committed tree (3,849 files equal to `git ls-files`), the distro's existing Linux `node_modules` copied privately (lock file sha256 `984b4422…` equal to the checkout's; nothing installed or upgraded), a **new** guarded cluster on 127.0.0.1:55490 under `/home/rehearsal/qual-pg-20261101` (the distro's older cluster untouched). The same verified production backup (sha256 `3f5b5339…4730`, re-hashed on Linux) was restored with `pg_restore --no-owner` (only the two expected extension-comment errors; 17,056 matches).

| Check | Linux result |
|---|---|
| Typecheck | clean |
| Focused suites (`afl-api-cutover`, `admin-fixture-actions`, `v2-fixture-contract`) | **557 passed, 0 failed, 58 skipped** (POSIX-only cases such as SIGTERM-ignoring processes ran) |
| C4b end-to-end | **36/36**, including the parent-SIGKILL scenario: the real detached watchdog turned the setting off by itself in about 4.8 s with the `on (run)` then `off (watchdog)` audit trail |
| GAP-029 labels end-to-end | **24/24** |
| Brownlow end-to-end | **not re-run on Linux**: its simulated prerequisite is seeded from a Windows-side rehearsal database that is not on the Linux cluster, and the runner has no platform-specific code beyond the driver's dump/restore binary names (fixed below) |

**Defects the Linux run found, all in test drivers (none in production code), fixed and committed (`ac6732c0`, `f2e5540c`):** the C4b driver killed the victim with the Windows-only `taskkill`, so on Linux the parent was never killed, S12 failed and S13 cascaded (31/36 on the first Linux run); the labels and Brownlow drivers named `pg_dump.exe` / `pg_restore.exe`. The first Linux attempt also showed a provisioning-order slip of mine (roles created before the cluster started), which is a procedure note, not a defect. **Residual:** the first Linux C4b run left an orphan victim process (killed by me afterwards), which is exactly the case the portable kill now avoids. Evidence on the distro: `/home/rehearsal/qual-evidence-20261101/` (retained).

## 9. Consolidated owner-action list

See the final report and the table in [IssuesIndex.md](../../IssuesIndex.md); in order:

1. Adopt or amend the C2 acceptance record (recorded on the corrected criterion in the C2–C5 package section 2).
2. **Decide F-BRO-1** (route for the 2025 fixture identities). Block B cannot be approved before this.
3. **Decide F-229-SWITCH**: approve the temporary switch enable inside block M3, or require another route.
4. Approve block L (section 4), naming R.
5. Approve block M (section 5), naming R, the migration hash and the snapshot; push the reviewed commits (not done here).
6. Approve C3 (installation), then D-316-13 (C4b), then D-316-4 (C5), each separately.
7. Name the evidence reviewer for C4b.
8. Optional owner design note: an admin cannot resolve or update a **provider-managed** slot (D-229-6 keeps provider rows read-only); the slot is resolved at the next provider settle, and L1 therefore directs the admin to that route.
