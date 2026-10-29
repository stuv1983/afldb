# V2 production execution package — D-V2-PROD-EXEC-1 (prepared 2026-10-30)

**Production: NO-GO. This package authorises nothing.** It combines the prepared release steps into **one
owner-triggered execution session**:
- A-AFLT, the freeze and A-BACKUP (choices 7–8, HC-2 to HC-5);
- A-ROLLBACK, A-REL and A-GO (choices 9–11);
- O-ARTIFACT (a), the route approved on 2026-10-30.

It adds only what those sources leave open:
- a way to evidence 43/43 without any test on production (§2.2);
- data checks that do not rest on the migration ledger (§2.3);
- a drift rule that the near-certain settle drift does not defeat (§2.1, O-DRIFT);
- one timed session (§5).

Sources, all unchanged by this package:
- [cutover runbook](cutover-runbook.md) and [rollback runbook](rollback-runbook.md);
- [ordered release plan](production-release-plan-2026-10-21.md) steps 2–8 and 11;
- [release choices](owner-decision-release-choices-2026-10-29.md);
- [host findings and change list](host-prerequisites-findings-2026-10-29.md);
- [lock record](owner-decision-lock-2026-10-29.md);
- `docs/deployment.md` §3 and §11.

Prepared without production, DEV or isolated-host access. The only actions taken were the D-V2-PUSH-ROUTE-1 push
(§0) and local commits.

## 0. Where the release stands (2026-10-30)

| Item | Value |
|---|---|
| Remote | `origin` = `https://github.com/stuv1983/afldb.git`, the source checkout's existing origin URL, read without changing `D:\dev\afldb`. No credential is embedded in the URL. Identity: same root commit `e31dc07b…` as the source repository, and `ff100dc2` is the first parent of the merge |
| Pushed (D-V2-PUSH-ROUTE-1, 2026-10-30) | `origin/main` was exactly `ff100dc2b8da8523f550ef45a9eaa3ef96d9d840` before the push. One atomic push without force: `main` `ff100dc2..9ed9c9dd` (fast-forward), and new branch `v2/rebuild` at `d3286d92c5f4b8701aba20eb1c6b694c42261620`. Read back with `git ls-remote`: `refs/heads/main` = `9ed9c9dd…`, `refs/heads/v2/rebuild` = `d3286d92…` |
| **Locked execution commit** | **`9ed9c9dd3e84682c43e96c46e98974b245eb54ed`**, tree `30b9f174…`. Local `main` and `origin/main` both point at it. The lock condition held, so the lock is **not** re-opened |
| Release method (O-ARTIFACT, approved 2026-10-30) | Build on the production host from exactly `9ed9c9dd` with `AFLDB_ENV=production`, by the established installation procedure. Record `BUILD_ID` and the artifact manifest before restart. The Windows build (`6z0tEoDM6-V-s4wbIH5RE`, `68f1d184…`) is verification evidence only: no second Windows build, and no byte comparison with Linux |
| `PREV` (last observed 2026-10-29) | Host checkout `ff100dc2`, build `vcxM_SyDxFCP0sj9n9W1t`, Node v22.23.2, `afldb.service` active. Database `afldb_prod`, OID 66668, sysid `7674454702926115004`, PostgreSQL 16.15, ledger 110 (digest `789946fe…`) |
| Still open, not waived | Privileges 42/43 until A-REL. Strict preservation and parity FAIL. Staged Brownlow comparator INCOMPLETE. V2-GAP-029. Authentic provider reconciliation is separate (gate 7) |

**Source checkout, not touched.** `D:\dev\afldb` local `main` is `6ffb893b`, 25 unpushed source-only commits ahead
of `ff100dc2` (ISSUE-271/272/326/327/328; ISSUE-327 parked). Its `origin/main` tracking ref was not fetched and
still reads `ff100dc2`. Remote `main` is now `9ed9c9dd`, so that local `main` has diverged from it. This does not
affect the release, because the host checks out by SHA. ISSUE-328 is already ported into V2, and the rest is
superseded for V2 (D-V2-SCOPE-20261027). Reconciling the source checkout stays the owner's separate matter.

## 1. Fixed inputs the session binds to

- **Revision:** `9ed9c9dd…`. The host reaches it with `git fetch origin` and `git merge --ff-only 9ed9c9dd…` on its
  `main`, and `git rev-parse HEAD` must equal the full SHA. "Latest `main`" is never enough.
- **Target:**
  - host `afldb-prod` (`209.38.87.252`, user `arm`), checkout `/home/arm/projects/afldb`;
  - database `afldb_prod`, with OID, sysid, owner `afldb_owner` and extensions as in §0.
- **Schema:** exactly the pending `111_…` to `117_…`. 116 and 117 are approved for this target and revision only.
- **Two staging defaults** (plan step 7 text, verbatim):
  - **D-V2-STAGING-IMPORT-DEFAULT-1:** `ALTER DEFAULT PRIVILEGES FOR ROLE afldb_owner IN SCHEMA staging GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLES TO afldb_import;`
  - **D-V2-STAGING-APP-DEFAULT-1:** `ALTER DEFAULT PRIVILEGES FOR ROLE afldb_owner IN SCHEMA staging GRANT SELECT ON TABLES TO afldb_app;`
- **Accepted reference:** archive `a4641ca0…` and its "before" snapshot set (preservation, historical manifest, row
  counts) on the isolated host, plus the committed run outputs
  `evidence/current-production-shadow/run-20261028T192336Z/{release-gates,migration.parity}.json`.

## 2. What this package resolves

### 2.1 Drift against `a4641ca0` is close to certain, so "any drift stops" would stop the window

The accepted capture was taken at 2026-10-28T19:23:36Z (06:23 AEDT on 10-29). The AFL Tables timer is still enabled
under `ff100dc2` (F-5; last observed run 04:37 AEDT on 10-29, next 04:44 on 10-30). At `ff100dc2`, every settle that
reaches its transaction inserts an `import_batches` row (`src/lib/acquisition/settle-afltables.ts:1845` at that
revision), even on an idempotent rerun over unchanged source data. Every nightly run from 10-30 until A-AFLT
therefore adds rows to the baseline. Owner logins (`auth_sessions`, `auth_audit_log`) would add more.

Choice 8 says "Any drift stops the release and needs a fresh rehearsal and archive-bound acceptance". Applied
literally, the session would stop at the comparison every time. A recapture first would not remove the problem
either: any later login reintroduces drift. **O-DRIFT** (§3) is therefore a genuine owner choice. The recommendation
keeps the rule's purpose: a fresh migration rehearsal on the exact bytes that will be migrated, plus a stop on any
change that could matter. It runs that rehearsal inside the session, on the frozen dump itself.

### 2.2 The 43/43 requirement: isolated test evidence and production read-back, kept apart

`tests/integration/privileges.test.ts` is catalogue-only: it asks the catalogue `has_*_privilege` questions and
writes no fixture. Its guard (`tests/integration/guard.ts`) still refuses any database that is not `*_test`. **That
guard is not bypassed, and no test runs on production.** The requirement is evidenced in two labelled parts:

| Part | Where | What | Claim it supports |
|---|---|---|---|
| **T (isolated test evidence)** | Clone **B** of the frozen window dump, `afldb_v2_shadow_permw_test`, on the isolated host. Restored **with ACLs and owners kept**. The accepted shadow used `--no-privileges`, which is why production ACLs were never compared | Exactly the A-REL sequence (reviewed runner 111–117, `privileges.sql`, the two defaults). Then the unmodified suite, invoked as in the follow-up (`node node_modules/vitest/vitest.mjs run --no-cache tests/integration/privileges.test.ts --reporter=json`). **Must report 43/43**. Then `permission-readback.sql` → `B.permissions.txt` | "The released permission policy, applied to production's frozen bytes, passes 43/43" |
| **P (production read-back)** | `afldb_prod` after A-REL, as `afldb_backup` (read-only principal) | `permission-readback.sql` only: one READ ONLY transaction, rolled back → `P.permissions.txt`. Then `snapshot-compare.mjs permissions --a B… --b P…` | "Production's catalogue inputs to those 43 assertions are identical to clone B's" |

[`permission-readback.sql`](evidence/production-execution-20261030/permission-readback.sql) extracts, without OIDs,
timestamps or the database name:
- owners and ACLs of schemas, relations, sequences, columns and routines;
- default ACLs, routine `SECURITY DEFINER`, pinned settings and body digests;
- the two `afldb_meta` registries, ledger names and checksums, and user triggers (`S|`);
- the **effective** privileges of `afldb_app`, `afldb_auth` and `afldb_import` (`E|`). This is the first comparison
  of production effective permissions that the release requires;
- cluster role attributes and memberships (`C|`);
- the suite's two role-level assertions evaluated on that cluster's own values (`A|`).

**Gate V2 (43/43):**
- T reports 43 passed, 0 failed, 0 skipped.
- The comparison is `IDENTICAL`. `S|` and `E|` must be byte-identical, and every `A|` line on both sides must end in
  `ok`.
- A `REVIEW` verdict (cluster role facts differ, for example `afldb_backup`'s `pg_read_all_data` membership, which
  the isolated cluster lacks) lists each difference. The owner resolves it in the session. Because `E|` is identical
  by then, a `C|` difference cannot change any answer of the 43 assertions. It is still never passed automatically.
- Any `DIFFERENT` verdict stops before A-GO.

Reporting wording is fixed: "privileges suite **43/43 on the isolated clone of the frozen production dump**;
production read-back **identical**". It is never "43/43 on production".

### 2.3 Data claims that do not rest on the ledger

The ledger proves only which migrations ran. Every data claim in the session rests on content. `shadow-capture.ts`
refuses every database except an `afldb_v2_shadow…_test` copy, with no override, so content is compared only from
dumps restored on the isolated host:

| Gate | Compares | Tool | Proves |
|---|---|---|---|
| **D (drift)** | Clone A of the frozen dump (accepted shadow restore method) vs the accepted `a4641ca0` "before" set | `snapshot-compare.mjs preservation`: per table, definition digest and rows as a multiset of whole-row digests; every contract query. Plus `historical-manifest.ts compare` (sealed scope) | What changed in the data between the accepted shadow and the freeze, table by table |
| **R (re-rehearsal)** | Clone A after the A-REL sequence vs clone A before | The accepted shadow procedure, unchanged: `shadow-parity.ts compare`, `release-gates.ts`, classifier `expected-deltas.mjs`. Their finding codes per table are compared with the committed `a4641ca0` run outputs | That 111–117 on the frozen bytes reproduce the accepted result: only the expected 116/117 deltas, the same strict findings, no new finding |
| **V3 (after-state)** | A post-A-REL production dump (restored as clone C) vs clone A's rehearsed after-state | `snapshot-compare.mjs preservation`: same archive base, so any difference is a production write or a migration that behaved differently from the rehearsal | That production after A-REL holds exactly the rehearsed content, and that no write happened under the freeze |
| **M (sealed history)** | Production before vs after the window (cutover step 8) | `historical-manifest.ts produce --read-only-source --i-understand-this-reads-a-non-test-database`, then `compare` | `sealed-scope-identical` |

A changed ledger digest is reported as a ledger finding only. It is never offered as evidence about rows.

## 3. Genuine owner choices (with recommendations)

| # | Choice | Options | Recommendation |
|---|---|---|---|
| **O-DRIFT** *(new)* | What gate D does with drift since `a4641ca0` | **(a)** Literal rule: any difference stops. Expect the stop: the session ends after a verified frozen backup, with A-AFLT done, and a re-baseline session follows. **(b)** Measured and re-rehearsed: continue only if **all** of these hold: (1) no `DEFINITION_CHANGED`, `TABLE_ONLY_IN_*` or `QUERY_CHANGED` (public projections unchanged); (2) the sealed scope is `sealed-scope-identical`; (3) no `ROWS_CHANGED` in a table that 111–117 create or alter (`staging.afl_api_brownlow_vote`, the 115-indexed adjudication table, or any new table); (4) every remaining `ROWS_CHANGED` table is named and attributed to its writer (expected: `import_batches` and `staging.source_record_versions` from the settle, and `auth_sessions`/`auth_audit_log` from logins); (5) gate R reproduces the accepted classification. Otherwise stop. The owner gives GO in the session on the recorded outputs. **(c)** Recapture after A-AFLT and re-bind the acceptance before the window: two extra owner steps, and still fragile against logins | **(b)**. It is the rule's intent: a fresh migration rehearsal, on the exact frozen bytes, with a stop on any canonical, public or schema change. The approved archive-bound acceptance tool is **not** re-bound or edited. Gate R's comparison is recorded as the evidence instead |
| **O-ISO** *(new)* | Where clones A, B and C run | **(a)** `streamanator`: a new root and a new isolated cluster on an unused loopback port, no shared database, exactly as the accepted shadow (`shadow-restore.sh`, `transfer.ps1`). Linux, the same host as the 42/43 run. It needs a narrow authority to use that host (not DEV's database or app) and a disk check. **(b)** The workstation isolated cluster: no DEV host, but Windows, and less comparable with the accepted runs | **(a)**, with the Stage 0 disk check (two clones, a third after A-REL, and the dumps) |
| **O-FREEZE** *(new)* | How admin edits are frozen | **(a)** Procedural: the owner signs in to nothing and edits nothing from Stage 2 until Stage 13. Gate V3 then proves mechanically that no write occurred between the frozen dump and the post-schema dump. **(b)** Enforced with the ISSUE-250 promotion freeze (`tools/db/promotion-freeze.ts`). That revokes CONNECT, needs `postgres` and takes the site offline: an outage tool built for promotion | **(a)**. Four auth users, beta-gated, and V3 makes it verifiable |
| **O-RB** *(new; demanded by rollback runbook §4.2)* | `PREV` with 111–117 applied makes the preflight report 7× `unknown-applied-migration` | **(a)** Pre-record that as the expected exception for a code rollback. **(b)** Reverse the schema first (§5): data-losing, and forbidden for 116 | **(a)** |
| O-5 | Retention of the frozen and post-schema dumps, and any second copy | — | Keep the host release directory and the workstation copy until 30 days after A-GO with no rollback. Then delete under D-V2-EVIDENCE-RETENTION-1, never automatically. Add a second hash-verified copy on a separate medium the owner controls: the workstation is otherwise the only off-host copy |
| O-6 | HC-1: install the repository Caddyfile | take / decline | **Decline for this session.** It keeps the window to one failure domain. Its HSTS cannot be withdrawn by a revert, and F-1 affects only proxy-generated responses. Record F-1 as a known residual, and schedule HC-1 on its own approval |
| O-7 | The session | — | **Saturday 2026-11-07, 09:00–14:00 AEDT (22:00Z 11-06 to 03:00Z 11-07), 5 h**: 4 h planned plus 1 h contingency. Off-season weekend morning; no match data is expected. It is a new window: no earlier authority is reused, including the expired 2026-10-27 day-D window. Cut-offs are in §5 |

## 4. Pre-session preparation (no production access; no owner decision)

The session runs only reviewed bytes pinned by SHA-256 in the approval, following the established pattern
(host-inspection script hashes, `transfer.ps1` hash pins). None of the items below exists yet, apart from the two
artefacts in this commit, whose control runs are also pending. **Recommended: one fresh session**, because of the
context ceiling.

| # | Item | Derived from | Control before pinning |
|---|---|---|---|
| P-1 | Host session script: read-only identity block (P0–P4 of `capture-prod.sh`: host, user, sysid, OID, owner, extensions, ledger digest, a read-only session); scheduler, process and admin-activity read; HC-3 `backup.sh --dir … --keep 999` with series-count and `pg_restore --list` checks; historical manifest before and after; the post-schema dump. Credentials parsed from `.env` into libpq variables only, never argv | `evidence/current-production-shadow/capture-prod.sh`, cutover steps 1–2 and 8, HC-3 | `bash -n`; a dry run of the parsing on a synthetic `.env` |
| P-2 | Transfer script: host → workstation (HC-4, SHA-256 both ends) → isolated host | `transfer.ps1` | Hash and parameter checks as in the original |
| P-3 | Isolated script: clones A, B and C on a new cluster. Source = `git archive 9ed9c9dd`, replacing `shadow-restore.sh`'s `c478c31b` tree. Clone A uses the accepted restore and capture options. Clone B keeps ACLs and owners: every role the dump names must exist first, and any `pg_restore` error stops. Gates D, R, T and V3, with the finding-code comparison against the committed `a4641ca0` outputs scripted | `shadow-restore.sh`, `followup.sh` F8–F9 | Synthetic controls, including negatives: a changed row → `ROWS_CHANGED`; a widened grant → `E|` difference; a missing staging default → suite 42/43 **and** an `S|` difference |
| P-4 | Controls for the two artefacts in this commit: `permission-readback.sql` on a disposable isolated `_test` database; `snapshot-compare.mjs` on synthetic snapshot pairs (identical, row change, definition change, query change, scope mismatch → exit 2) | — | Outputs retained beside the artefacts |
| P-5 | Copies, not in the `9ed9c9dd` checkout, for transfer to the host with pinned hashes: `permission-readback.sql`, `evidence/lock-build-20261029/artifact-manifest.mjs` | — | SHA-256 recorded in the approval |
| P-6 | Independent review of P-1 to P-5 and of this package. A finding of HIGH or above returns here | — | Review record |

## 5. The execution session (D-V2-PROD-EXEC-1)

**Roles:**
- **Owner:** every `sudo` command (`arm` has no sudo, and none is added), the gate D GO, `REVIEW` resolutions, and
  the visual acceptance.
- **Operator (Claude, under the approval):** the pinned scripts over the established `ssh afldb` identity
  (BatchMode), the transfers, and the isolated host.

**Rules:**
- Every stage writes its evidence before the next begins.
- A failed gate stops at that stage, and recovery follows §6.
- Times are AEDT on 2026-11-07.

| Time | Stage | Steps | Gate (stop unless it holds) |
|---|---|---|---|
| 09:00 (10′) | **0 Go check** | Local `HEAD`/`main`/`origin/main` = `9ed9c9dd`; pinned script hashes; `ssh -G afldb` identity. Isolated host read-only: the `a4641ca0` before-set present with its recorded hashes; disk budget. Host read-only identity (P-1 block) | Every identity matches §0–§1. Ledger is exactly 110 with digest `789946fe…`. No settle, migrate or dump process running |
| 09:10 (15′) | **1 Writer retirement (A-AFLT, HC-2)**, owner `sudo` | `sudo ls -la /etc/polkit-1/rules.d`; `sudo sha256sum` of the `*afldb*` rule, compared with `deploy/afldb-settle-afltables-trigger.rules` `3164e0d9…`; `sudo install -d -m 700 /root/afldb-v2-retired`; `sudo cp -p` of the rule into it (the kept copy); `sudo systemctl disable --now afldb-settle-afltables.timer`; `sudo mv` the rule into `/root/afldb-v2-retired/`. The email-intake timer is absent (H1): recheck, and disable it only if present | Timer `disabled`/`inactive`; `afldb-settle-afltables.service` `inactive`; no settle process; rule absent from `rules.d`; the kept copy's hash recorded |
| 09:25 (5′) | **2 Freeze** (O-FREEZE) | Freeze declared. Cutover step 2 scheduler loop recorded. Read-only: active sessions per role from `pg_stat_activity` (counts only) | No writer unit active. AFL API units absent, as before |
| 09:30 (15′) | **3 Reviewed checkout** | `git fetch origin`; `git merge --ff-only 9ed9c9dd…`; `git rev-parse HEAD`; `git status --porcelain` empty; `npm ci`. The serving `.next/standalone` is untouched. Then `npm run preflight -- --mode deploy …` (cutover step 1) and `npx tsx tools/v2/cutover-preflight.ts legacy-writers` | HEAD = `9ed9c9dd…`. The preflight's only migration findings are `pending-migration` for exactly 111–117. `legacy-writers` exits 0 (PASS) |
| 09:45 (10′) | **4 Frozen backup (HC-3)** and sealed manifest **before** | `backup.sh --dir ~/backups/afldb/release-v2-<STAMP> --keep 999`; SHA-256; the existing series count before and after. `historical-manifest.ts produce` (read-only, `afldb_backup`) | Count unchanged (11); `pg_restore --list` passes; SHA recorded; manifest written |
| 09:55 (10′) | **5 Proven restore (HC-5)** | `restore-test.sh <frozen dump>` into the disposable `afldb_restore_test` | Exit 0, every parity check equal |
| 10:05 (10′) | **6 Off-host copy (HC-4, O-5)** | Pull to `C:\Users\stuar\backups\afldb\release-v2-<STAMP>\`; SHA-256 equal on both ends; the second copy (O-5); transfer to the isolated host (O-ISO) | SHA-256 equal everywhere |
| 10:15 (30′) | **7 Isolated rehearsal on the frozen bytes** | **Clone A:** accepted restore; before captures; **gate D**; the A-REL sequence; after captures; **gate R**. **Clone B:** ACL-kept restore; the A-REL sequence; suite (**T**); `B.permissions.txt` | Gate D per O-DRIFT; gate R as in §2.3; T = 43/43 |
| 10:45 (5′) | **Gate D GO (owner)** | The owner reads the D/R/T summary and answers GO or STOP | GO. A STOP ends the session here (§6, row 1) |
| 10:50 (5′) | **8 A-ROLLBACK named** | Record the routes in §6 against the frozen dump's path and SHA, with O-RB | Recorded |
| 10:55 (20′) | **9 A-REL** | Re-verify identity, and the ledger at exactly 110. `node --import tsx tools/db/migrate.ts --target prod --status`, then `--target prod` (`AFLDB_PROD_DATABASE_URL` from `.env`, never argv). Then `psql -X -w -v ON_ERROR_STOP=1 -d afldb_prod -f tools/maintenance/privileges.sql` as `afldb_owner` (`PGPASSWORD` from the environment only). Then the two defaults (§1). Read back after each write | Ledger 117: the 7 new names, checksums equal to clone A's; 0 pending. The new tables and the 115 index exist; `staging.afl_api_brownlow_vote.eligible` is nullable; the 116 trigger is enabled. The two `staging` default-ACL rows exist |
| 11:15 (10′) | **10 Gate V2: permissions** | `permission-readback.sql` on `afldb_prod` as `afldb_backup` → `P.permissions.txt`; `snapshot-compare.mjs permissions` against B | `IDENTICAL`, or `REVIEW` resolved by the owner (§2.2). T 43/43 already holds |
| 11:25 (30′) | **11 Gate V3: after-state** | Post-schema dump into the same release directory (`--keep 999`); SHA-256; pull and copy as in Stage 6; restore as clone C; preservation capture; `snapshot-compare.mjs preservation` against clone A's after snapshot | `IDENTICAL`. Any difference stops before code, with the previous code still serving |
| 11:55 (35′) | **12 A-GO (O-ARTIFACT a)** | `npm run build 2>&1 \| tee build.log` with `AFLDB_ENV=production` from the host `.env`, and the log must contain "AFLDB_ENV=production detected". Record `.next/BUILD_ID` = `.next/standalone/.next/BUILD_ID`, and the `artifact-manifest.mjs` manifest SHA-256 (P-5). Then owner `sudo systemctl restart afldb` | Build exit 0 and both identities recorded **before** restart. `/api/health` returns HTTP 200 `{"status":"ok","database":"ok"}` through `beta.afldb.com` and on `127.0.0.1:3100`. The `x-afldb-build` header equals the recorded `BUILD_ID` |
| 12:30 (20′) | **13 Live acceptance and after-checks** | Signed in as Admin: `/admin/operations` renders. The owner saves a screenshot to the evidence; otherwise the result is `VISUAL: UNVERIFIED`, never prose. Key public pages return 200. `POST /api/admin/email-intake` → 410. Sealed manifest **after** + `compare` (gate M). Scheduler loop: AFL Tables `disabled`/`inactive`, AFL API absent as before. `legacy-writers` PASS. No new writer or provider integration enabled | All hold; M = `sealed-scope-identical` |
| 12:50 (10′) | **14 Close** | Lift the admin-edit freeze (writers stay retired). Write the window record (cutover step 11) | — |
| 13:00–14:00 | Contingency | — | **Cut-offs:** Stage 9 must start by **11:45**, or the session stops before any schema change. Stage 12 must start by **13:00**, or it stops after V3 with the previous code serving the new schema. That rest state is safe: `PREV` never reads the new tables. A-GO then needs its own short approval. **Hard end 14:00** |

## 6. Recovery routes (A-ROLLBACK; plan step 11 limits)

| Failure point | State | Route |
|---|---|---|
| Stop at Stages 0–8, including a gate D STOP | Nothing changed except A-AFLT (Stage 1+) and the host checkout (Stage 3+). The previous build keeps serving | Keep A-AFLT. Restoring the AFL Tables writer is not a recovery need, and restarting retired acquisition needs a new decision. The checkout may stay at `9ed9c9dd`, because the service keeps running the old standalone bundle. If the owner prefers, it can be returned with `git checkout --detach ff100dc2`, with no reset. To undo A-AFLT on the owner's order only: `sudo mv /root/afldb-v2-retired/<rule> /etc/polkit-1/rules.d/` with its original owner and mode, re-verify the hash, then `sudo systemctl enable --now afldb-settle-afltables.timer` |
| A migration fails (Stage 9) | Each migration is its own transaction. Earlier ones stay committed; the failed one records nothing | Stop. Keep the log, re-read the actual ledger and schema, no retry in the session. Code unchanged. Do not delete ledger rows, edit checksums or use `--target test` |
| `privileges.sql` or a default fails, or V2 is `DIFFERENT` | The previous code does not use the new tables | Stop before A-GO. Fix forward under a new approval. No improvised grant |
| V3 `DIFFERENT` | Production differs from the rehearsal | Stop before A-GO. Attribute the difference from the recorded report. No code install |
| Build fails (Stage 12) | The previous build still serves (the build runs before the restart) | Stop. Nothing to roll back |
| Health, identity or acceptance fails after the restart | New code live on the new schema | Code rollback (rollback runbook §4.1, `docs/deployment.md` §11): `git checkout ff100dc2`, `npm ci`, `npm run build`, owner `sudo systemctl restart afldb`; gate R4 (health, `x-afldb-build` = a fresh `PREV` build id). The schema stays (forward). O-RB: the 7× `unknown-applied-migration` is the recorded expected exception. No D-257-7 issue: migration 110 is not crossed |
| A V2 table must go (owner decision only) | — | Rollback runbook §5, only with row and sequence exports. **Never 116** (append-only receipts). **No NOT NULL on 117** without a separately reviewed proof of zero NULLs |
| Data loss or corruption | — | Host restore **only** from the frozen verified dump (path and SHA from Stage 4), with full sequence, auth and audit recovery and a writer freeze, under A-ROLLBACK. Rollback runbook §6 is the last resort and outside V2's design |

## 7. What the session does not do

No ISSUE-316 step (no AFL API unit install, enable or start; `acquisition.afl_api_current_season_enabled`
unchanged), no settle, acquire, rollover, C4b, Brownlow or Coleman operation, no curated approval, no Caddy, `.env`,
DNS, certificate or Cloudflare change (HC-1 declined unless the owner chooses otherwise), no apex launch, no test on
production, no ledger or checksum edit, no deletion of an existing dump, database or evidence root, and nothing in
`D:\dev\afldb`. EXEC and frozen P/H are unchanged.

## 8. The approval (after §4 is complete; fill the brackets, strike nothing else)

```text
D-V2-PROD-EXEC-1 — APPROVED as prepared in docs/v2/production-execution-package-2026-10-30.md at commit [package
commit], running only the pinned bytes: [P-1 sha256] [P-2 sha256] [P-3 sha256] [permission-readback.sql sha256]
[snapshot-compare.mjs sha256] [artifact-manifest.mjs sha256].

Session: Saturday 2026-11-07, 09:00–14:00 AEDT; cut-offs and hard end as §5.
Choices: O-DRIFT [b]; O-ISO [a streamanator, new root and isolated cluster only]; O-FREEZE [a]; O-RB [a];
O-5 [retain until 30 days after A-GO; second copy: <medium>]; O-6 HC-1 [decline].

Authorised, in order, within the session only: Stage 0 read-only checks on the host and the isolated host; A-AFLT
with HC-2 (my own sudo); the freeze; fast-forward of the host checkout to 9ed9c9dd and npm ci; A-BACKUP with HC-3,
HC-4, HC-5 and the second copy; the isolated rehearsal (clones A, B, C) and gates D, R, T; gate D GO by me in the
session; A-ROLLBACK as named in §6; A-REL on afldb_prod at 9ed9c9dd: migrations 111–117 (116 and 117 approved for
this target and revision), privileges.sql, D-V2-STAGING-IMPORT-DEFAULT-1 and D-V2-STAGING-APP-DEFAULT-1, read-backs;
gates V2 and V3 including the post-schema dump; A-GO by O-ARTIFACT (a) behind the unchanged beta.afldb.com route;
live acceptance and gate M.

Not authorised: any step outside §5, any test on production, any writer or provider integration, any ISSUE-316,
Brownlow, Coleman or curated operation, any Caddy/.env/DNS change, any deletion, and any action in D:\dev\afldb.
```
