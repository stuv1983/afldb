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

Prepared without production or DEV access. The 2026-10-30 preparation (§4.1) used only streamanator, in a new
private root with its own loopback-only isolated cluster, and restored only the approved `a4641ca0` archive copy
into disposable `_test` databases. The other actions were the D-V2-PUSH-ROUTE-1 push (§0) and local commits.

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

Two further facts, found in preparation, apply the same reasoning to gate V3. First, O-FREEZE (a) stops the owner's
edits but not the public site: visitors' NL searches (`nl_search_log`), health events and beta sign-ins keep writing
between the frozen and the post-schema dump. Second, the window's own migrate run writes the seven new ledger rows
with production `applied_at` and `duration_ms`, which can never equal the rehearsal's. A literal `IDENTICAL` V3
would therefore always stop. §3.1 states the proposed rule for both gates.

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
- cluster role attributes and memberships of every `afldb_*` role (`C|`), except `afldb_v2_super`, the isolated
  cluster's own bootstrap superuser, which production does not have;
- the suite's two role-level assertions evaluated on that cluster's own values (`A|`).

**Gate V2 (43/43):**
- T reports 43 passed, 0 failed, 0 skipped.
- The comparison is `IDENTICAL`. `S|` and `E|` must be byte-identical, and every `A|` line on both sides must end in
  `ok`.
- A `REVIEW` verdict (cluster role facts differ, for example an attribute or a membership of an `afldb_*` role
  that only production has) lists each difference. The owner resolves it in the session. Because `E|` is identical
  by then, a `C|` difference cannot change any answer of the 43 assertions, but clone equivalence is then **not**
  claimed. It is never passed automatically.
- Every assertion's inputs are mapped to compared facts in
  [`permission-assertion-map.md`](evidence/production-execution-20261030/permission-assertion-map.md). The suite is
  catalogue-only and writes nothing; it still never runs on production.
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
| **V3 (after-state)** | A post-A-REL production dump (restored as clone C) vs clone AM, the rehearsed after-state | `snapshot-compare.mjs preservation` and `historical-manifest.ts compare`, then `drift-gate.mjs after` (§3.1): same archive base, so any difference is a production write or a migration that behaved differently from the rehearsal | That production after A-REL holds exactly the rehearsed content apart from attributed visitor/auth activity and ledger timing, and that no canonical write happened under the freeze |
| **M (sealed history)** | Production before vs after the window (cutover step 8) | `historical-manifest.ts produce --read-only-source --i-understand-this-reads-a-non-test-database`, then `compare` | `sealed-scope-identical` |

A changed ledger digest is reported as a ledger finding only. It is never offered as evidence about rows.

## 3. Genuine owner choices (with recommendations)

| # | Choice | Options | Recommendation |
|---|---|---|---|
| **O-DRIFT** *(new; PROPOSED, not approved by this preparation)* | What gates D and V3 do with differences | **(a)** Literal rule: any difference stops. Expect the stop at gate D: the session ends after a verified frozen backup, with A-AFLT done, and a re-baseline session follows. **(b)** The evidence rule in §3.1, implemented by `drift-gate.mjs` and proven by the controls in §4.1. **(c)** Recapture after A-AFLT and re-bind the acceptance before the window: two extra owner steps, and still fragile against logins and visitors | **(b)**. It is the rule's intent: a fresh migration rehearsal on the exact frozen bytes, a stop on any canonical, public-query, schema or migration-sensitive change, and every other changed row attributed to its writer from both restored databases. The approved archive-bound acceptance tool is **not** re-bound or edited; gate R's comparison with the committed `a4641ca0` outputs is the evidence instead |
| **O-ISO** *(new)* | Where clones A, B and C run | **(a)** `streamanator`: a new root and a new isolated cluster on an unused loopback port, no shared database, exactly as the accepted shadow (`shadow-restore.sh`, `transfer.ps1`). Linux, the same host as the 42/43 run. It needs a narrow authority to use that host (not DEV's database or app) and a disk check. **(b)** The workstation isolated cluster: no DEV host, but Windows, and less comparable with the accepted runs | **(a)**, with the Stage 0 disk check (two clones, a third after A-REL, and the dumps) |
| **O-FREEZE** *(new)* | How admin edits are frozen | **(a)** Procedural: the owner signs in to nothing and edits nothing from Stage 2 until Stage 13. Gate V3 then proves mechanically that no write occurred between the frozen dump and the post-schema dump. **(b)** Enforced with the ISSUE-250 promotion freeze (`tools/db/promotion-freeze.ts`). That revokes CONNECT, needs `postgres` and takes the site offline: an outage tool built for promotion | **(a)**. Four auth users, beta-gated, and V3 makes it verifiable |
| **O-RB** *(new; demanded by rollback runbook §4.2)* | `PREV` with 111–117 applied makes the preflight report 7× `unknown-applied-migration` | **(a)** Pre-record that as the expected exception for a code rollback. **(b)** Reverse the schema first (§5): data-losing, and forbidden for 116 | **(a)** |
| O-5 | Retention of the frozen and post-schema dumps, and any second copy | — | Keep the host release directory and the workstation copy until 30 days after A-GO with no rollback. Then delete under D-V2-EVIDENCE-RETENTION-1, never automatically. Add a second hash-verified copy on a separate medium the owner controls: the workstation is otherwise the only off-host copy |
| O-6 | HC-1: install the repository Caddyfile | take / decline | **Decline for this session.** It keeps the window to one failure domain. Its HSTS cannot be withdrawn by a revert, and F-1 affects only proxy-generated responses. Record F-1 as a known residual, and schedule HC-1 on its own approval |
| O-7 | When the session runs | — | **Owner-triggered, no calendar date.** The owner names the start time T0 in the approval (§8). The session is 4 h 45 min from T0 (3 h 35 min of stages, 25 min slack, 45 min code-rollback allowance), measured and budgeted in §5. Cut-offs are relative to T0. The only start constraint: T0 must not fall in 04:15–05:30 AEDT, the AFL Tables timer's observed run window (04:37 and 04:44), because Stage 0 stops on a running settle before A-AFLT retires it. No earlier authority is reused, including the expired 2026-10-27 day-D window |

### 3.1 O-DRIFT (b) as proposed: the evidence rule

Gate D compares clone A of the frozen dump with the `a4641ca0` "before" set; gate V3 compares clone C of the
post-A-REL dump with clone AM, the rehearsed after-state. Both run `snapshot-compare.mjs preservation`,
`historical-manifest.ts compare` and then `drift-gate.mjs`, which re-reads every changed row by primary key from
both restored databases. A table name alone never attributes anything.

**Always STOP** (both gates):
1. `DEFINITION_CHANGED`, `TABLE_ONLY_IN_*`, a scope mismatch (the comparator refuses: exit 2), or a sealed scope
   that is not `sealed-scope-identical`.
2. `QUERY_CHANGED` on any public query, with one exception: `audit_history`, only when its contract text is exactly
   `SELECT * FROM public.auth_audit_log` and that table's change is itself attributed in the same run.
3. Any row change in a migration-sensitive table: the ledger (gate D), `staging.afl_api_brownlow_vote`,
   `public.afl_api_identity_adjudications`, or any table that 111–117 create.
4. A changed table without a primary key, a catalogue shape that differs between the two databases, or a comparator
   report the row re-derivation cannot reproduce.
5. Any changed row that does not match its writer's rule below, and any insert dated before the reference time (gate D:
   the `a4641ca0` capture start; gate V3: the frozen dump's start, which is its snapshot).

**Writer rules** (the only rows that may differ):

| Writer class | Table | Gate D | Gate V3 |
|---|---|---|---|
| settle bookkeeping | `public.import_batches` | inserts only (time `started_at`), each with `tool = 'settle-afltables.ts'`, `target_table = 'staging.source_record_versions'` and notes matching `AFLDB-ISSUE-099 settle; snapshot=…; season=YYYY; mode=apply` | none (A-AFLT retired the writer): STOP |
| settle bookkeeping | `staging.source_records` | insert (time `first_seen_at`, `last_batch_id` attributed); update of `scope_key`, `last_seen_at`, `last_batch_id`, `absent_since`, `current_version_seq`, `current_payload_hash` where each row is either a head refresh (new `last_batch_id` attributed, `last_seen_at` after the reference) or an absence mark (only `absent_since` changes, after the reference) | none: STOP |
| settle bookkeeping | `staging.source_record_versions` | insert (time `observed_from`, `opened_by_batch_id` attributed); update of `observed_to`/`closed_by_batch_id` only on an open version, closed by an attributed batch after the reference | none: STOP |
| settle bookkeeping | `staging.source_payloads` | insert (time `first_stored_at`; content-addressed, no batch column: each new payload must be referenced by a `source_record_versions` row opened by an attributed batch) | none: STOP |
| settle bookkeeping | `staging.afltables_match`, `staging.afltables_player_match` | insert (time `projected_at`, `projected_by_batch_id` attributed); update of any non-key column, each row re-stamped with an attributed `projected_by_batch_id` and `projected_at` after the reference (every present record is re-projected on every run, `ON CONFLICT … DO UPDATE`) | none: STOP |
| settle bookkeeping | `public.import_rejections` | insert (time `rejected_at`, `import_batch_id` attributed) | none: STOP |
| settle candidates | `public.promotion_candidates` | insert (time `created_at`, `created_by_batch_id` attributed); refresh of a **pending** row re-stamped by an attributed batch (the `ON CONFLICT … WHERE status = 'pending'` columns only) | none: STOP |
| auth activity | `auth_sessions` | insert, delete, update of `expires_at`/`revoked_at` | same |
| auth activity | `auth_audit_log` | insert | same |
| auth activity | `auth_users` | update of `totp_last_step`, `password_hash`, `password_changed_at`, `must_change_password` | update of `totp_last_step` only |
| auth activity | `beta_login_tokens` | insert, delete, update of `used_at` | same |
| runtime telemetry | `app_health_events`, `nl_search_log`, `nl_search_feedback` | insert | same |
| migration ledger timing | `afldb_meta.schema_migrations` | none: STOP | only `applied_at`/`duration_ms` may differ; names, checksums and row set identical |

The settle rows are the `ff100dc2` writer's footprint, read from its code (`settle-afltables.ts:1845-1966, 2028,
2740-2810, 2827-2871, 3528, 3588-3613`, `observation-store.ts:104-224`): an idempotent nightly run inserts one batch and head-refreshes
every enumerated record, so updates are part of the rule (controls D10, D11). A batch reference never makes a canonical
row bookkeeping: 38 tables reference `import_batches`, canonical ones included, and only the tables named above may be
bound that way (control D7).

**Verdicts.** `NO_DIFFERENCE` (exit 0). `LEDGER_TIMING_ONLY` (V3 only, exit 0): the window's own migrate run
stamped production times, nothing else differs; no owner decision is needed, because names and checksums are
identical. `ATTRIBUTED_ONLY` (exit 3): continue only on the owner's GO in the session, on the recorded report,
which lists each class, row counts, time ranges and, for settle, the signatures (never a secret column).
`STOP` (exit 1) and invalid input (exit 2) end that gate.

**Why V3 needs the rule too.** O-FREEZE (a) stops the owner's edits, not the public site: visitors' NL searches and
health events, and beta sign-ins, keep writing while the previous code serves. A literal "IDENTICAL" V3 would also
always stop on the seven new ledger rows' production `applied_at`. Both are now explicit.

**Preparation is not approval.** The rule is implemented, controlled (§4.1) and pinned so that the owner can choose
it. Choosing (a) or (c) needs no code change: (a) treats any non-zero gate exit as STOP.

## 4. Pre-session preparation (no production access; no owner decision)

The session runs only reviewed bytes pinned by SHA-256 in the approval, following the established pattern
(host-inspection script hashes, `transfer.ps1` hash pins). P-1 to P-6 are complete and P-7 was run after P-6 closed, as recorded in §4.1.

| # | Item | Derived from | Control before pinning |
|---|---|---|---|
| P-1 | Host session script: read-only identity block (P0–P4 of `capture-prod.sh`: host, user, sysid, OID, owner, extensions, ledger digest, a read-only session); scheduler, process and admin-activity read; HC-3 `backup.sh --dir … --keep 999` with series-count and `pg_restore --list` checks; historical manifest before and after; the post-schema dump. Credentials parsed from `.env` into libpq variables only, never argv | `evidence/current-production-shadow/capture-prod.sh`, cutover steps 1–2 and 8, HC-3 | `bash -n`; a dry run of the parsing on a synthetic `.env` |
| P-2 | Transfer script: host → workstation (HC-4, SHA-256 both ends) → isolated host | `transfer.ps1` | Hash and parameter checks as in the original |
| P-3 | Isolated script: clones A, B and C on a new cluster. Source = `git archive 9ed9c9dd`, replacing `shadow-restore.sh`'s `c478c31b` tree. Clone A uses the accepted restore and capture options. Clone B keeps ACLs and owners: every role the dump names must exist first, and any `pg_restore` error stops. Gates D, R, T and V3, with the finding-code comparison against the committed `a4641ca0` outputs scripted | `shadow-restore.sh`, `followup.sh` F8–F9 | Synthetic controls, including negatives: a changed row → `ROWS_CHANGED`; a widened grant → `E|` difference; a missing staging default → suite 42/43 **and** an `S|` difference |
| P-4 | Controls for the two artefacts in this commit: `permission-readback.sql` on a disposable isolated `_test` database; `snapshot-compare.mjs` on synthetic snapshot pairs (identical, row change, definition change, query change, scope mismatch → exit 2) | — | Outputs retained beside the artefacts |
| P-5 | Copies, not in the `9ed9c9dd` checkout, for transfer to the host with pinned hashes: `permission-readback.sql`, `lib/arel-readback.sql`, `evidence/lock-build-20261029/artifact-manifest.mjs` (bound by `host-session.sh`'s embedded `PIN_*` values, and listed in `PINNED.SHA256`) | — | SHA-256 recorded in the approval |
| P-6 | Independent review of P-1 to P-5 and of this package. A finding of HIGH or above returns here | — | Review record |
| P-7 | After P-6 closes: `transfer-session.ps1 -Mode PinnedHash` on the reviewed tree. It assembles the pinned rehearsal set (every file P-3 reads: `isolated-rehearsal.sh`, `drift-gate.mjs`, `gate-r.mjs`, `snapshot-compare.mjs`, `permission-readback.sql`, `lib/*`, `expected-deltas.mjs`, `artifact-manifest.mjs`, the three accepted `a4641ca0` outputs) and `git archive 9ed9c9dd`, and prints the `PINNED.SHA256` and `src-9ed9c9dd.tar` hashes | — | Both hashes recorded in the approval (§8) |

### 4.1 Preparation run results (2026-10-30, streamanator only; no production or DEV access)

Final root `/home/arm/afldb-v2-prodexec-20261030T020000Z`: its own isolated cluster on 127.0.0.1:55491, fresh
credentials, disposable `_test` restores of the approved `a4641ca0` archive. Retained evidence:
[`run-20261030T020000Z/`](evidence/production-execution-20261030/run-20261030T020000Z/README.md). Review record:
[`review-P6-2026-10-30.md`](evidence/production-execution-20261030/review-P6-2026-10-30.md).

| Item | Result |
|---|---|
| Pinned set (P-7, `PinnedHash` on the reviewed tree, unchanged after the run) | `PINNED.SHA256` `38e7fbb4c948211796be4f7e9ea8de1e92be53cc2c82982e723952f9660e1842`; `src-9ed9c9dd.tar` `ab10691fb2e9facb9b28bdb65b04c2ee823813f41ee48c193f0abe94dd7b6ad5` |
| Rehearsal (P-3) | `PASS` in 553 s: gate D `NO_DIFFERENCE`, gate R `REPRODUCED`, gate T privileges 43/43, ledger-117 digest `647c3fb3…`. Restore of two clones 99 s, before capture 168 s, A-REL 21 s |
| Controls (P-3/P-4, `rehearsal-controls.sh` `7989eeca…`) | **`PASS 112/112` in one run** (04:36–05:20Z): D 23 (incl. D10 settle replay: seven tables attributed; D11 unbound refresh stops on `source_records` and both projections; gate 152 s), T 11, V 11, N 8, RB 13 (PREV `ff100dc2` on the 117 schema: runner accepts the ledger, build 229 s, health 200, 18 route checks, Brownlow writer suite, privileges), H 46 (`host-session.sh` `0fe897f8…` in library mode, including A-REL end to end in 9 s and its failure, no-retry and privileges-failure negatives; no password in any log) |
| End-to-end chain (P-2, `e2e-chain.ps1`) | E1–E3: post-schema Pull and PushIso `TRANSFER PASS`; `isolated-rehearsal.sh after` (gate V3) `PASS`, V3 `NO_DIFFERENCE`, 195 s. E4 stopped on a P-2 defect (below); after the fix, rerun of E4: PullIso `rehearse:PASS,after:PASS`, GateV2 `IDENTICAL` |
| Review (P-6) | Independent review plus four re-reviews: findings F-001 to F-018; every HIGH and MED closed; the P-2 `timings.txt` fix accepted in Re-review 4. F-011 (rerun evidence) is met by this run. Open LOW, no work gate: F-016 wording (fixed by this section), F-017 (H2b/H6b assert the exit code without a reason string), F-018 (an aborted controls run leaves `env.good` with isolated-cluster credentials; run 2's copy was redacted) |
| Approval pins (§8) | `host-session.sh` (P-1) `0fe897f856c039a33a3c178c57af789c58001681b50eea75316e8e27597b2067`; `transfer-session.ps1` (P-2) `0ee343bac81c7864a27e14c4237d80e8c3eb5f7f38ebf4ccfa1bdd3b47c0adb8`; `PINNED.SHA256` and `src-9ed9c9dd.tar` as above. Inside the pinned set: `permission-readback.sql` `1e7a4f62…`, `arel-readback.sql` `c195fab8…`, `snapshot-compare.mjs` `5542958b…`, `artifact-manifest.mjs` `ea37a7e7…`, `drift-gate.mjs` `ce80f864…`, `isolated-rehearsal.sh` `30c72d98…` |

**Failed and superseded attempts (kept, not counted):** rehearsal roots `20261029T210000Z` and `20261029T220000Z`
(controls with harness defects; `220000Z` also ENOSPC at the PREV build), `20261030T011000Z` and `20261030T013000Z`
(PASS on pinned sets superseded by the F-001 and F-014 fixes; used as D10/D11 trial beds). On the final root:
controls run 1 (stopped by the 3 GiB disk watchdog at RB4, because `room()` rounded `df -B1G` up; all controls up
to RB4 passed) and controls run 2 (D, T, V, N and RB passed; every H control failed with exit 5 because the harness
read the database OID with the wrong root; fixed and proven by an H-only trial, 46/46). E2E attempt 1 found the P-2
defect: `after` appends to `timings.txt`, which the rehearse manifest had sealed, so Stage 11's PullIso would always
stop; `transfer-session.ps1` now verifies that file only against the after manifest once `after` has run.

**Disk.** The host started at 4.7 GiB free. Cleanup of this preparation's own reproducible intermediates and
superseded evidence (compressed and verified, not deleted), and two owner-authorised lists of other disposable
build outputs and stopped clusters (per-file SHA-256 listings in
`/home/arm/afldb-v2-prodexec-20261029T220000Z/cleanup-external-20261030/`), raised it to 11.9 GiB. Budget: peak
use about 3 GiB, an external swing of about 3 GiB from media containers on the same filesystem, and a 3 GiB
watchdog reserve. The final controls run's lowest free space was 9,047 MiB.

## 5. The execution session (D-V2-PROD-EXEC-1)

**Roles:**
- **Owner:** every `sudo` command (`arm` has no sudo, and none is added), the gate D GO, `REVIEW` resolutions, and
  the visual acceptance.
- **Operator (Claude, under the approval):** the pinned scripts over the established `ssh afldb` identity
  (BatchMode), the transfers, and the isolated host.

**Rules:**
- Every stage writes its evidence before the next begins.
- A failed gate stops at that stage, and recovery follows §6.
- Times are relative to **T0**, the start the owner names in the approval (O-7). The duration of each stage is its
  budget; "measured" marks a duration taken from the 2026-10-30 preparation run on streamanator, "est." an
  operation that preparation could not run (production host only).

**Scripts per stage** (all pinned, §8): host stages run `host-session.sh <stage> <STAMP> …` streamed over
`ssh afldb bash -s`; transfers run `transfer-session.ps1 -Mode …`; the isolated stages run
`isolated-rehearsal.sh rehearse|after` on streamanator, started by the line PushIso prints.

| Start | Stage | Steps | Gate (stop unless it holds) |
|---|---|---|---|
| T0 (10′) | **0 Go check** | Local `HEAD`/`main`/`origin/main` = `9ed9c9dd`; pinned script hashes; `transfer-session.ps1 -Mode PinnedHash` prints exactly the approval's `PINNED.SHA256` and `src-9ed9c9dd.tar` hashes; `ssh -G afldb` identity. Isolated host read-only: the `a4641ca0` before-set present with its recorded hashes; disk budget. Host: `host-session.sh identity <STAMP> 110`, `writers`, `init` | Every identity matches §0–§1. Ledger is exactly 110 with digest `789946fe…`. No settle, migrate or dump process running |
| T0+0:10 (15′, owner-paced) | **1 Writer retirement (A-AFLT, HC-2)**, owner `sudo` | `sudo ls -la /etc/polkit-1/rules.d`; `sudo sha256sum` of the `*afldb*` rule, compared with `deploy/afldb-settle-afltables-trigger.rules` `3164e0d9…`; `sudo install -d -m 700 /root/afldb-v2-retired`; `sudo cp -p` of the rule into it (the kept copy); `sudo systemctl disable --now afldb-settle-afltables.timer`; `sudo mv` the rule into `/root/afldb-v2-retired/`. The email-intake timer is absent (H1): recheck, and disable it only if present | Timer `disabled`/`inactive`; `afldb-settle-afltables.service` `inactive`; no settle process; rule absent from `rules.d`; the kept copy's hash recorded |
| T0+0:25 (5′) | **2 Freeze** (O-FREEZE) | Freeze declared. Cutover step 2 scheduler loop recorded. Read-only: active sessions per role from `pg_stat_activity` (counts only). `host-session.sh retired <STAMP>` | No writer unit active. No afldb writer timer enabled or active (AFL Tables retired by Stage 1; AFL API and email-intake units absent, as the accepted capture recorded). `backup` and `arel` repeat this check |
| T0+0:30 (15′, est.: `npm ci`) | **3 Reviewed checkout** | `git fetch origin`; `git merge --ff-only 9ed9c9dd…`; `git rev-parse HEAD`; `git status --porcelain` empty; `npm ci`. The serving `.next/standalone` is untouched. Then `npm run preflight -- --mode deploy …` (cutover step 1) and `npx tsx tools/v2/cutover-preflight.ts legacy-writers` | HEAD = `9ed9c9dd…`. The preflight's only migration findings are `pending-migration` for exactly 111–117. `legacy-writers` exits 0 (PASS) |
| T0+0:45 (10′; the accepted capture dumped in 10 s) | **4 Frozen backup (HC-3)** and sealed manifest **before** | `host-session.sh backup <STAMP> frozen` (HC-3 `backup.sh --dir ~/backups/afldb/release-v2-<STAMP> --keep 999`, series count, `pg_restore --list`, ledger before = after, sidecar, `frozen.SHA256SUMS`); `host-session.sh manifest <STAMP> before` | `RESULT PASS` line; series count unchanged; SHA recorded; manifest written |
| T0+0:55 (10′, est.) | **5 Proven restore (HC-5)** | `host-session.sh restore-test <STAMP>` (`restore-test.sh <frozen dump>` into the disposable `afldb_restore_test`) | Exit 0, every parity check equal |
| T0+1:05 (10′; measured under 1 min for a 30 MB set) | **6 Off-host copy (HC-4, O-5)** | `transfer-session.ps1 -Mode Pull -Label frozen -ArchiveSha <RESULT sha> -SecondCopy <medium>` (to `C:\Users\stuar\backups\afldb\release-v2-<STAMP>\`); `-Mode PushPinned`, then `host-session.sh pinned`; `-Mode PushIso -Label frozen -ArchiveSha <RESULT sha> -PinnedSha <approval PINNED.SHA256> -SrcTarSha <approval tar>` (a new isolated root; the pinned set re-verified there) | `TRANSFER PASS` lines; SHA-256 equal everywhere |
| T0+1:15 (15′; measured 9 min 37 s) | **7 Isolated rehearsal on the frozen bytes** | **Clone A:** accepted restore; before captures; **gate D**; the A-REL sequence; after captures; **gate R**. **Clone B:** ACL-kept restore; the A-REL sequence; suite (**T**); `B.permissions.txt` | `rehearse.result` = `PASS`, or `PASS-PENDING-OWNER-GO` (gate D `ATTRIBUTED_ONLY`, §3.1); gate R `REPRODUCED`; T = 43/43. Then `transfer-session.ps1 -Mode PullIso -ArchiveSha <frozen sha>`: it pulls only a finished run (`rehearse.done`), verifies every file against the run's own evidence manifest, and hands over the 117 digest only for a `PASS*` summary that names this archive |
| T0+1:30 (5′) | **Gate D GO (owner)** | The owner reads the D/R/T summary and answers GO or STOP | GO. A STOP ends the session here (§6, row 1) |
| T0+1:35 (5′) | **8 A-ROLLBACK named** | Record the routes in §6 against the frozen dump's path and SHA, with O-RB | Recorded |
| T0+1:40 (15′; the stage measured 9 s end to end on a clone (`host-session.sh arel`, control H12; 16 s in the H trial; the rehearsal's own A-REL 21 s)) | **9 A-REL** | `host-session.sh arel <STAMP> <AM.ledger.digest> <frozen sha>`: re-verifies identity as `afldb_backup` and `afldb_owner`, ledger exactly 110, no writer process or timer, the clean reviewed checkout, the pinned files, and that the rehearsed archive is this directory's frozen dump with its restore proof. `AFLDB_PROD_DATABASE_URL` is not kept in the host `.env` (`docs/deployment.md`): the identity-checked `AFLDB_OWNER_DATABASE_URL` is handed to the migrate child's environment only, never argv, and migrate's own target line must name it. `migrate.ts --target prod --status` (pending exactly 111–117; not strictly read-only: it first runs the runner's `CREATE SCHEMA/TABLE IF NOT EXISTS` bootstrap as `afldb_owner`, a no-op on this target), then `--target prod`; ledger = the rehearsed 117 digest; `privileges.sql` and the two defaults (§1) as `afldb_owner` (`PGPASSWORD` in the child only); `arel-readback.sql` as `afldb_backup`. One attempt only: once migrate has reached the database, a second `arel` in the same directory refuses; an attempt refused before connecting is set aside and may rerun | Ledger 117: the 7 new names, checksums equal to clone A's; 0 pending. The new tables and the 115 index exist; `staging.afl_api_brownlow_vote.eligible` is nullable; the 116 trigger is enabled. The two `staging` default-ACL rows exist. `arel-readback.sql` 12/12 `ok` |
| T0+1:55 (10′) | **10 Gate V2: permissions** | `host-session.sh readback <STAMP> <digest>` (read only; `I|transaction_read_only|on` required) → `P.permissions.txt`; `transfer-session.ps1 -Mode GateV2` (`snapshot-compare.mjs permissions`, B vs P; it prints `TRANSFER PASS … IDENTICAL` or `TRANSFER REVIEW …`, never PASS for REVIEW) | `IDENTICAL`, or `REVIEW` resolved by the owner (§2.2, [assertion map](evidence/production-execution-20261030/permission-assertion-map.md)). T 43/43 already holds |
| T0+2:05 (25′; `after` measured 195 s on a clone; backup and transfer at production size not measured) | **11 Gate V3: after-state** | `host-session.sh backup <STAMP> postschema <digest>`; `transfer-session.ps1 -Mode Pull -Label postschema`, then `-Mode PushIso -Label postschema`; `isolated-rehearsal.sh after` (clone C; ledger equal to AM's; preservation and manifest compare against AM; `drift-gate.mjs after`); `-Mode PullIso -ArchiveSha <frozen sha>` | `after.result` = `PASS` (V3 `NO_DIFFERENCE` or `LEDGER_TIMING_ONLY`), or `PASS-PENDING-OWNER-GO` (only attributed visitor or auth activity, owner GO). Anything else stops before code, with the previous code still serving |
| T0+2:30 (35′, est.: host build) | **12 A-GO (O-ARTIFACT a)** | `npm run build 2>&1 \| tee build.log` with `AFLDB_ENV=production` from the host `.env`, and the log must contain "AFLDB_ENV=production detected". Record `.next/BUILD_ID` = `.next/standalone/.next/BUILD_ID`, and the `artifact-manifest.mjs` manifest SHA-256 (P-5). Then owner `sudo systemctl restart afldb` | Build exit 0 and both identities recorded **before** restart. `/api/health` returns HTTP 200 `{"status":"ok","database":"ok"}` through `beta.afldb.com` and on `127.0.0.1:3100`. The `x-afldb-build` header equals the recorded `BUILD_ID` |
| T0+3:05 (20′) | **13 Live acceptance and after-checks** | Signed in as Admin: `/admin/operations` renders. The owner saves a screenshot to the evidence; otherwise the result is `VISUAL: UNVERIFIED`, never prose. Key public pages return 200. `POST /api/admin/email-intake` → 410. Sealed manifest **after** + `compare` (gate M). Scheduler loop: AFL Tables `disabled`/`inactive`, AFL API absent as before. `legacy-writers` PASS. No new writer or provider integration enabled | All hold; M = `sealed-scope-identical` |
| T0+3:25 (10′) | **14 Close** | Lift the admin-edit freeze (writers stay retired). Write the window record (cutover step 11) | — |
| T0+3:35 – T0+4:45 | Contingency and recovery allowance | 25 min slack, plus 45 min reserved for a code rollback (rollback runbook §4.1: checkout `ff100dc2`, `npm ci`, build, restart, gate R4) | **Cut-offs:** Stage 9 must start by **T0+2:05**, or the session stops before any schema change. Stage 12 must start by **T0+2:55**, or it stops after V3 with the previous code serving the new schema; that rest state is safe (§6, rollback validation) and A-GO then needs its own short approval. **Hard end T0+4:45** |

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
commit], running only the pinned bytes: host-session.sh (P-1) [sha256]; transfer-session.ps1 (P-2) [sha256];
PINNED.SHA256 (P-3 set, P-7) [sha256], which enumerates permission-readback.sql, arel-readback.sql,
snapshot-compare.mjs, artifact-manifest.mjs, drift-gate.mjs, gate-r.mjs and every other pinned file;
src-9ed9c9dd.tar (P-7) [sha256].

Session: T0 = [date and time AEDT], not within 04:15–05:30 AEDT; 4 h 45 min from T0, cut-offs and hard end as §5.
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
