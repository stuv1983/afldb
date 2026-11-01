# Block L (GAP-029 match-event labels): execution-ready record (2026-11-02)

**Status: PREPARED. NOTHING WAS WRITTEN TO PRODUCTION.** One fresh backup was taken and read-only plan artefacts were produced. No label was applied, no approval exists, nothing was pushed, deployed, restarted, migrated or cleaned up. The apply script exists (`scripts/prod-apply.sh`) but has not been run and refuses to start without an owner approval file that this session did not create.

Evidence directory: [`evidence/gap029-block-l-20261102/`](evidence/gap029-block-l-20261102/) (scripts, public records, logs, Linux rehearsal). Dumps, the restored database and credentials are **not** in Git.

## 1. Pinned revision and qualification

| Item | Value |
|---|---|
| **Execution revision R** | `86da1a82329371fd23db6e2935a0e9334ba08f9a` |
| Superseded, never used operationally | `7ce80053502ec198e164739a5f48d514a75a774a` (its rehearsal control tried to stage a NULL venue, which `matches.venue_raw NOT NULL` forbids; the driver was corrected in R, the tool was not changed) |
| Evidence file (tool-bound) | `docs/v2/evidence/gap-029-match-event-correction-2026-11-01-r2.json`, LF-normalised sha256 `e3848807931cf255175c1642d9ded63590b2c7e2633b33a5e9f0fa5b96a4430f` (the master sequence now names this file; it previously named a non-existent one) |
| Private operations checkout (production host) | `/home/arm/ops/gap029-labels-86da1a82/cand`, a shallow clone packed on the workstation (tar sha256 `a6553f80c50a2b201fd27271293b3d4249e7d92aaeee2ccc0d563bad236a04df`, verified on the host), `HEAD` equals R, `git status --porcelain` empty, `node_modules` linked read-only from the serving checkout (`package.json` and `package-lock.json` byte-identical to it) and excluded locally. The primary production checkout stayed at `affe9a2c…` with an empty status; the serving release, `.env`, units and services were not touched. |

**Tool corrections in R** (`tools/v2/apply-gap029-match-events-production.ts`, new pure `tools/v2/gap029-label-checks.ts`):

1. **Venue identity.** `readRows` now selects `matches.venue_raw` and `entryProblem` compares it with the evidence `expect.venueRaw` by strict equality: NULL keeps its meaning (an evidenced NULL matches only a live NULL; a live NULL never matches an evidenced venue), and an evidence entry that omits the key refuses rather than being read as NULL. All 64 live venues equal the evidence (`M.C.G.` 61, `Marrara Oval` 1, `Perth Stadium` 1, `S.C.G.` 1), checked locally against the read-only production extract.
2. **Active Super Admin at apply time.** The audited writer (`saveEdit`) **records** `adminUserId` but does **not** check it, so the earlier tool checked the actor only in `plan`. `apply` now re-proves `role = 'super_admin' AND disabled_at IS NULL` in the pre-write transaction **and again before every label**, so an actor disabled or demoted mid-run stops the run at the next label boundary.
3. **Negative controls** (none weakens or regenerates evidence): a unit suite `tests/v2-gap029-label-checks.test.ts` (changed season, date, round, clubs, scores, a different venue, a case-changed venue, a NULL venue, an evidenced NULL, a missing key, a different event, a missing row) and rehearsal controls for a changed venue (different text; case change), a **disabled** actor and a **demoted** actor (plan and apply both refuse, nothing written, baseline unchanged afterwards) and an actor **disabled mid-run** (stops at 20 labels, audited and consistent).

**Qualification** (Linux, `streamanator`, Node v22.23.2, PostgreSQL 16.15 binaries, a new guarded cluster on 127.0.0.1:55493 under `/mnt/ssd/afldb-v2-gap029l-20261101T204205Z`; evidence in `linux-rehearsal/`):

| Check | Result |
|---|---|
| `tsc --noEmit -p .` | clean |
| Focused suites (label checks, season seal, module boundaries, isolated target) | 139 passed |
| Label end-to-end on the **ledger-117** production-derived restore (17,056 matches, 0 fixtures, 0 receipts) | **34 / 34** |
| Windows (workstation): label checks, season seal, module boundaries | 112 passed (at the superseded revision; the later change is driver-only) |

The 34 include the earlier 24 (baseline equality, four plan refusals, four approval refusals, edited plan, baseline drift, injected audit failure after 10 labels, resume, replay) plus the new venue, disabled, demoted and mid-run-revocation controls and a third backup/restore/re-plan cycle (10 labels written by an injected audit failure, 10 more (20 in all) before the actor is disabled mid-run, then the remaining 44; totals 64 labelled, 64 audit rows, 64 active overrides, distribution 31 / 22 / 11, replay writes nothing).

**Reused (unaffected) qualification.** `git diff --name-only e0f6c7bc..86da1a82` outside `docs/` lists only `CHANGELOG.md`, `IssuesIndex.md`, `issues.md`, the new unit test, the label tool, the new pure helper and the label rehearsal driver. No `src/`, `deploy/`, `package*.json` or other tool changed, so the following results at `2134e2fd` / `e0f6c7bc` stand: **C4b 36/36**, **Brownlow ordered 76/76** (authentic B0 prerequisite), **fixture window 46/46**, **production-mode builds** (release default heap 3072, and `AFLDB_BUILD_TYPECHECK=off-host`) and **standalone boots** ([master sequence 8.2](master-execution-sequence-2026-11-01.md)).

## 2. Target and actor identity (read-only, 2026-11-01 20:40Z = 2026-11-02 07:40 AEDT)

| Fact | Value |
|---|---|
| Host / user | `afldb-prod` / `arm` (existing SSH alias; no sudo used) |
| Database | `afldb_prod`, host `localhost`, port 5432, PostgreSQL 16.15, cluster `16/main` |
| System identifier / database OID | `7674454702926115004` / `66668`; database comment NULL |
| Validation role | `afldb_backup` (existing read-only channel; not a superuser; no grants or role changes) |
| Writer URLs (names only; values never printed) | `AFLDB_IMPORT_DATABASE_URL` is `afldb_import@localhost:5432/afldb_prod`; `DATABASE_URL` is `afldb_app@localhost:5432/afldb_prod`; no query strings |
| Ledger | 117 rows, last `117_brownlow_provider_eligibility_unknown.sql`, digest `647c3fb39ca66a572664e1dae9028e4fad4d6b121226d6bdf208e6738af45f72`; extensions `pg_trgm=1.6 plpgsql=1.0 unaccent=1.1` (all unchanged across the backup) |
| Serving | `afldb.service` MainPID 3218527 (since 2026-11-01 10:50:30 AEDT), build `QNEHXAtU53TzUjj0Mb7mv`; every settle, AFL API, Brownlow and e-mail unit is inactive and not enabled or not found; no crontab for `arm`; no AccessExclusive locks; no non-idle sessions |
| **Actor** | **id 1**: `super_admin`, not disabled, the **only** Super Admin, matches the owner's e-mail (boolean only), `can_manage_admins` false. |
| Audited-writer privileges (`afldb_import`) | `matches.match_event` UPDATE; `data_edits` INSERT; `data_overrides` column-level INSERT on all seven columns the writer names and UPDATE on the four it updates (`has_table_privilege` reads false for INSERT because the grants are column-level, migration 078; the column checks are true); `data_overrides_id_seq` USAGE; no triggers on `matches`, `data_edits` or `data_overrides`. The editor path has been used on production before (`matches` `match_sheet` and `audit_note_repair` edits, 24-25 Oct). |
| Label state now | 0 matches labelled, 0 `match_event` audit rows, 0 override rows. All 64 evidenced rows exist and equal the evidence in season, date, round, venue, both clubs and both scores, with `match_event` NULL. Production has 17,056 matches, latest `2026-09-26`, so it is the same data state as the earlier restore. |

## 3. Backup, restore verification and baseline equality

| Step | Result |
|---|---|
| Backup | the reviewed `capture-prod.sh` procedure with **constants only** changed (ledger 117 and its digest, decision label, output directory, sidecar wording; 26 changed lines, [diff](evidence/gap029-block-l-20261102/scripts/backup-script-vs-reviewed.diff)). One `pg_dump --format=custom` as `afldb_backup` in a read-only session, writers inactive. Directory `/home/arm/backups/afldb/gap029-labels-20261101T204724Z` (mode 700; files 600). |
| Archive | `afldb_prod-20261101T204724Z.dump`, **29,834,009 bytes**, sha256 **`9119895bcb5d6c34d88abd35169412c16c8dee2a49e32076d2ee23ffdc6e395d`**, 1,648 TOC entries, empty `pg_dump` stderr, ledger identical before and after, snapshot start **2026-11-01T20:47:24.990Z** (2026-11-02 07:47:24 AEDT). Provenance sidecar in `records/`. |
| Private copies (outside Git) | workstation `D:\tmp\gap029-blockL-private` (ACL: the operator account only; hash re-verified); streamanator `…/in/prod/` (700/600; hash re-verified). Neither is the DEV database. |
| Restore verification | into a **guarded disposable database** `afldb_v2_gap029blockl_l1_rst_test` in the isolated cluster on streamanator (launcher-proved marker; not production, not the DEV database). `pg_restore` exit 0, 0 stderr lines; ledger 117, 17,056 matches, 0 fixtures; restored at **2026-11-01T20:48:21.983Z**. The DEV services were untouched (`afldb.service` MainPID 1162113 and `postgresql@16-main` MainPID 1504 before and after). |
| **Baseline equality** | the tool's own `baseline` on live production at R: `9b17f3ad2b94c0b7f20ade336e0bf546949f84c3e1f27cbb98e9087ebb4761cf`; on the restored copy: the **same digest**. (It equals the digest of the earlier production-derived rehearsal restore, as expected: same data.) |

## 4. The plan (generated by `plan` mode only; read-only; no approval)

| Item | Value |
|---|---|
| **Plan digest** | **`1b538e1a50cacdb24d37d771d79261a5926e35c69f53d03481ec47a26e79528a`** (recomputed independently from the plan body: equal) |
| Plan file | `/home/arm/ops/gap029-labels-86da1a82/evidence/plan-1.json`, mode 600, sha256 `ef2e25888f850b37b5a1c43595791eb517d15ccb73bd43fe7bd19047de4ccc24` (copy in `records/plan-1.json`) |
| Operation / revision / evidence | `gap029-match-events` / `86da1a82…f9a` / `e3848807…430f` |
| Target | as section 2, user `afldb_backup` |
| Actor | 1 |
| Backup | sha256 `9119895b…395d`; restore evidence sha256 `b9a4c1260af1a26b26a612e2b3e2304a10e79fa6674b72f07862e77c9f8254c1`; `capturedAt` 20:47:24.990Z, `restoredAt` 20:48:21.983Z |
| Plan created / plan expiry | 2026-11-01T20:48:55.493Z / 2026-11-02T20:48:55.493Z |
| **Effective deadline** | **2026-11-02T20:47:24Z = 2026-11-03 07:47:24 AEDT**, because `apply` refuses a backup older than 24 hours (the plan's own expiry is a minute later). **Recommended approval expiry: 2026-11-02T20:30:00Z = 2026-11-03 07:30 AEDT.** If the window passes, the whole cycle (backup, restore, baseline, plan) is repeated; nothing is lost. |
| Matches | exactly the 64 ids of the evidence file, each `before` NULL and `action` "to label": 64 to label, 0 already labelled |

**Proposed label distribution** (the evidence file and the plan agree entry for entry): **Anzac Day 31** (1995-2026), **Dreamtime at the 'G 22** (2005-2026), **King's Birthday 11** (2015-2026). **Rows needing change: all 64** (`matches.match_event` NULL to the label). Expected result: 64 `matches.match_event` values, 64 `data_edits` rows and 64 active `data_overrides` rows added, nothing else.

Full list of match ids: `records/plan-1.json` (`entries`).

## 5. Exclusivity required before apply

The tool's baseline check refuses if the 64 rows, the labelled-match count or the `match_event` audit/override counts change between plan and apply, but it cannot see unrelated writes. For the window (about a minute) the owner must confirm in the approval that:

- no admin or contributor is using the Data Editor, the match sheet, fixture admin or player-link tools on **any** match (the writer takes a row lock with a 5-second timeout, so a collision fails one label and stops the run, resumable);
- no settle, e-mail intake, Brownlow stage, migration (including 118), fixture window, release build, promotion or restart is running or starts (every writer unit is currently inactive; the script refuses if a settle, migration, dump or correction process exists);
- nobody else holds a production shell doing database work.

After the apply, pages that use `match_event` (search, grid) are ISR-cached: allow about an hour or revalidate before judging them.

## 6. Partial failure and recovery (accurate)

- **Per-match commit.** Each label is written by `saveEdit` in its own transaction (one `data_edits` row, one `data_overrides` row, one `matches` update). The run stops at the **first** refusal or error; labels already committed **stay** (audited, replayable). A transaction in flight at a crash either commits whole or not at all.
- **Observable state.** On a partial run the tool exits non-zero and writes **no** result file; the truth is in the database. The apply script prints the read-only counts straight away. The post-write count check (delta of audit and override rows equals the labels written) runs only after a complete loop.
- **The old plan is dead after any committed label** (the baseline moved): rehearsed (`the old plan is refused after the partial write`). The resume is a **new** backup, restore, baseline, plan (it shows the remainder as "to label" and the written ones as "already labelled") and a **new** approval, then `apply` again. Rehearsed twice (10 then 20 labels written, then completion to 64).
- **A stop before the first label** (approval, plan, backup or drift refusal) writes nothing; fix the cause, then re-plan if the baseline moved.
- **Reversal.** There is **no** one-step reversal tool. Each label is an audited, replayable override: reversal is `saveEdit` of `match_event` back to NULL, per match, through the audited path, under its own review. The full-database fallback is the backup above, which would also discard every other write made since 2026-11-02 07:47 AEDT, so it is a last resort. Do not hand-edit rows.
- **Run it detached.** A dropped SSH session would stop a run mid-way (safe, as above); the script is therefore launched with `setsid nohup` and polled, not held on a live session.

## 7. Apply procedure (for after, and only after, the owner's approval)

1. Owner writes the approval statement below. The session then writes `approval.json` on the host, outside the checkout, mode 600, with exactly: `planDigest`, the plan's `target`, `revision` R, `operation` `gap029-match-events`, `evidenceSha256`, `approvedAt` (the moment the owner approved), `expiresAt` (the owner's expiry; not after the plan's), `reference` (the owner's words, at least one non-blank character).
2. `bash scripts/prod-apply.sh <R> ef2e2588…cc24 <approval.json> <backup file> <restore evidence>` (detached). It re-checks the approval against the plan, the plan file hash, the clean checkout, the backup hash and at least 20 minutes of backup freshness; checks that no writer, migration, dump or correction process is running; runs `apply`; reads back the distribution and the audit and override counts as `afldb_backup`; then replays the same plan and approval (expected: "already applied", writes nothing).
3. Success: 64 labelled (31 / 22 / 11), 64 audit rows, 64 active override rows, replay writes nothing. Stop and report on anything else.

## 8. The approval prompt (complete; the owner writes it, this session does not)

> I approve **Block L apply** at revision `86da1a82329371fd23db6e2935a0e9334ba08f9a`: write the **64 match-event labels** (Anzac Day 31, Dreamtime at the 'G 22, King's Birthday 11) listed in plan digest `1b538e1a50cacdb24d37d771d79261a5926e35c69f53d03481ec47a26e79528a` (plan file sha256 `ef2e25888f850b37b5a1c43595791eb517d15ccb73bd43fe7bd19047de4ccc24`) to **production** `afldb_prod` (host `afldb-prod`, `localhost:5432`, system identifier `7674454702926115004`, database OID `66668`), from `docs/v2/evidence/gap-029-match-event-correction-2026-11-01-r2.json` (LF sha256 `e3848807931cf255175c1642d9ded63590b2c7e2633b33a5e9f0fa5b96a4430f`), through the application's audited editor writer as **actor 1** (active Super Admin), using `tools/v2/apply-gap029-match-events-production.ts` from the private pinned checkout `/home/arm/ops/gap029-labels-86da1a82/cand`, bound to backup `afldb_prod-20261101T204724Z.dump` (sha256 `9119895bcb5d6c34d88abd35169412c16c8dee2a49e32076d2ee23ffdc6e395d`, restore-verified, baseline `9b17f3ad2b94c0b7f20ade336e0bf546949f84c3e1f27cbb98e9087ebb4761cf`). Valid until **2026-11-02T20:30:00Z (2026-11-03 07:30 AEDT)**. I confirm that for the window no other operator is editing match data, running a settle, migration, Brownlow stage, fixture window, build, deployment or restart, and that nobody will until the session reports completion. I accept the partial-failure handling in the execution-ready record (each label commits separately; a stop is resumed by a new backup, restore, plan and approval; there is no automatic reversal). This approves no push, migration, deployment, restart, cleanup or any other write.

## 9. Planned route for the later M2 build (no build was run)

Use the installed, non-destructive release tool only (ISSUE-329): `node deploy/release.mjs build --checkout /home/arm/projects/afldb --revision <M2 revision> --afldb-env production --typecheck off-host --typecheck-evidence "<text below>"`, then `verify`, `promote`, the owner's `sudo systemctl restart afldb`, `status --expect <id>` and `deploy/post-install-check.sh`. Never `npm run build` in the serving checkout (its clean step deletes the live `.next/standalone`); never lower `--min-available-mb`, `--require-available-mb` or `--require-free-gb`; leave the heap at the default 3072 MB, one worker.

- **Why off-host is the only admissible route on this host.** Production showed `MemAvailable` 2,952 MB and 56.7 GB free disk at the 2026-11-01 20:40Z probe. The build's admission needs 3,200 MB with the in-build type-check (it would be **refused**) and 2,100 MB with `--typecheck off-host`; lowering the guard to fit is exactly what is not allowed. The off-host recipe was built and booted on Linux at `e0f6c7bc` (1 min 48 s; master sequence 8.2).
- **Qualified type-check evidence.** `tsc --noEmit -p .` is clean on Linux at R (this record) and at `e0f6c7bc`; it is re-run on the **exact** revision the owner pushes, as M2 step 0, and its log is cited verbatim in `--typecheck-evidence` (about two minutes on streamanator; the script is `p3_typecheck` in `scripts/rehearse-host.sh`). Section 10 records the run for the current head.
- **Order.** M-a is migration 118 **first**, then this build (so the release smoke exercises the schema the code expects), promote, restart. Rollback with `release.mjs rollback --to <previous id>` is safe only before the first fixture apply (M-b). Block L is independent of M and does not need the build.

## 10. Type-check evidence for the current head

(Appended by the recording commit; see `linux-rehearsal/typecheck-head.log`.)

## 11. Leftovers (retained, private; nothing deleted)

| Where | What | Notes |
|---|---|---|
| `afldb-prod:/home/arm/backups/afldb/gap029-labels-20261101T204724Z/` | the backup, sidecar, TOC, ledger lists, checksums | mode 700/600; the apply script reads the dump from here |
| `afldb-prod:/home/arm/ops/gap029-labels-86da1a82/` | `in/` (tar, scripts, backup and restore-evidence JSON), `cand/` (pinned checkout), `evidence/` (targets, baseline, plan) | mode 700; to be removed after the apply on the owner's word |
| `streamanator:/mnt/ssd/afldb-v2-gap029l-20261101T204205Z/` | rehearsal workspace, the guarded cluster (stopped), the restored production copy `afldb_v2_gap029blockl_l1_rst_test` (contains production auth/audit data), the dump copy | mode 700; owner to say when to delete; the cluster has no listener |
| `D:\tmp\gap029-blockL-private` | dump, plan, backup and restore-evidence JSON, targets | ACL restricted to the operator account |
| `D:\tmp\gap029-blockL` | candidate clone, scripts, logs | no secrets |

## 12. Concrete owner actions that remain

1. Review this record; if satisfied, write the section 8 approval (or amend it) **before 2026-11-03 07:30 AEDT**.
2. Confirm the section 5 exclusivity for the window.
3. Push of the reviewed local commits (fast-forward) is still the owner's act and is **not** needed for block L; it is needed before M-a/M2.
4. Say when the private leftovers in section 11 may be deleted (production auth data sits in the restored copy and the dumps).
