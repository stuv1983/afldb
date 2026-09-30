# AFLDB-ISSUE-238 — DEV promotion rehearsal: design and operator handoff (DESIGN ONLY)

**Status: design APPROVED 2026-09-30 (D-1…D-7, Part K.1). Phase 0 `MODE=pre` PASSED on the
corrected rerun (`pre-20260930-223306`, `PHASE0_RESULT=CLEAN_FOR_REVIEW`, Part K.3). K.4 is CLOSED:
the dependency probe is clean and no ISSUE-252 preparation is needed. Next: D-1, the intermediate
implementation commit and the fast-forward integration (Part K.5), then `MODE=post`. No database
mutation has been executed.**
*(Superseded: "Phase 0 `MODE=pre` ran once (`pre-20260930-220356`, `PHASE0_RESULT=STOP`) … K.4 …
OPEN. Next gate: the corrected `MODE=pre` rerun.")*
*(Superseded: "Execution not yet started: Phase 0 (read-only) is written … and awaits its first
run"; before that, "design pass, 2026-09-30. Nothing in this document has been executed.")*

- **Scope:** §12.1 cases 44, 66, 67, 89, 90 and 92, plus case 33's PSG / post-swap sub-clause.
  S11-D1 re-levelled them here because they need real `afldb_{dev}` names, the ISSUE-250 freeze,
  a real swap and a real rollback.
- **Out of scope:**
  - Slice 11: complete at 19/19 and not revisited.
  - Item 12: designed separately after this.
  - The S6-D3 gate `CORRECTED_PROMOTION_REHEARSAL_REQUIRED`: it stays in place.
- **Why the gate is irrelevant here:** every run in this document is `--environment dev`, and S6-D3
  refuses only `--environment prod`. Nothing here changes or relies on the gate.

Parts A–J are design. Part K lists the decisions this design needs from the operator. Part L holds
the commands, which run only after approval.

---

## A. What the cases mean after S6-D2

S6-D2 (runbook §9.1, "Slice-6 decision") replaced ISSUE-238's custom PSG and post-swap digests with
the ISSUE-250 freeze:

| ISSUE-238 term | Implemented as (ISSUE-250) | Where it FAILs |
|---|---|---|
| PSG (pre-swap guard) | `--phase candidate --freeze-record`: the live target is frozen, quiescent and holds exactly F0 | the gate "live target … holds exactly the frozen state F0" names every drifted table |
| post-swap gate | `--phase production --freeze-record --old-database <kept>`: the kept database (by OID) holds exactly F0, and the promoted live database is the candidate, unfrozen | "kept … holds exactly F0" FAILs, so acceptance fails |

**F0 covers `afl_api_identity_adjudications` and `external_identities`** as whole-row md5 digests.
It covers every non-`rebuilt` public contract table (S6-D2's proof).

**Consequence for the late writes.** From `promotion-freeze.sql` onwards, only `afldb_owner`,
`afldb_backup` and superusers can connect.
- A real ORIGINAL runs as `afldb_import`, and the admin link runs as the app roles. Neither can
  commit in the window. That is the freeze working.
- The only writers that can reach the target's ledger in the window are privileged. That is the
  residual risk the digest gates exist to catch (`docs/production-promotion.md` §4.0: "A superuser
  or owner write to a production-owned table fails a later digest gate").
- So the rehearsal proves the cases in two parts:
  1. **Prevention:** a real ORIGINAL attempted in the window is refused at connection
     (`permission denied for database`).
  2. **Detection:** a privileged write shaped exactly like what that ORIGINAL (or an ordinary
     link/revoke) would have committed is injected into the window. The named gate then FAILs.

This interpretation needs operator confirmation (**D-4**).

---

## B. DEV topology

| Item | Value (re-verified read-only in Phase 0; §17 values are from 2026-09-26) |
|---|---|
| Host | `streamanator` (the DEV server; also hosts `code_test_db` and `afldb_test`) |
| Live target | `afldb_dev`. On 2026-09-26 it was OID 202860 and was restored to it by §17's rollback. Phase 0 records the current OID as `DEV_OID0`. |
| Source | `afldb_test` (`docs/production-promotion.md` §13). Each run restores a fresh dump of it into a new candidate. |
| Candidates | `afldb_dev_candidate_<stamp>`, one per run. |
| Kept / rolled-back names | `afldb_dev_pre_rebuild_<stamp>` exists only between a swap and its rollback. |
| Restore-test DB | `afldb_restore_test` (scratch; `restore-test.sh` overwrites it). |
| Deployed checkout | `~/projects/afldb`. It deploys from `main` and is **never touched**. |
| Code under test | a scratch overlay, `~/i238dev/afldb`: an rsync of the authoritative host worktree `~/afldb-issue238-s11`, sha-verified against the workstation, with `.env` and `node_modules` symlinked. This is §17's pattern. **Env (Phase 0 finding):** the ISSUE checkout's `.env` holds only `AFLDB_CODE_TEST_DATABASE_URL` / `AFLDB_CODE_TEST_IMPORT_DATABASE_URL`; the DEV and `afldb_test` role DSNs live in `/home/arm/projects/afldb/.env`. Every phase script loads both files, primary first, into its own process (`set -a; . ~/projects/afldb/.env; . ~/afldb-issue238-s11/.env; set +a`). `AFLDB_TEST_IMPORT_DATABASE_URL` does not exist on the host and is not invented; any later step that needs it is surfaced as its own prerequisite. |
| Git topology | Two independent repositories. ISSUE: `/home/arm/afldb-issue238-s11` (own `.git`, origin = `~/issue238-s11/transport/base.bundle`, HEAD `d279c8e0`, branch `issue/238-canonical-reattribution`, no local `main` by design; holds both `d279c8e0` and `8fc60404`). Deployed primary: `/home/arm/projects/afldb` (own `.git`, GitHub deploy remote, `main` at `8fc60404`, does not hold `d279c8e0`; four pre-existing untracked rebuild manifests, never touched). |
| Services | `afldb.service` (the app). §17 found no afldb timers installed on DEV; Phase 0 re-checks every `afldb*` unit. |
| Roles | `afldb_owner`, `afldb_import`, `afldb_backup`, `afldb_app`, `afldb_auth`. The preflight proves every DSN names `afldb_dev` and its role. |
| PROD | Never contacted. Phase 0 proves the DEV `.env` names neither `afldb_prod` nor the PROD IP. |

---

## C. BLOCKING PREREQUISITE: `afldb_dev`'s schema (decision D-1)

- **The branch position.** Migrations 106–107 (the `corrected` action,
  `previous_player_identity`, the M1 checks) are committed only on
  `issue/238-canonical-reattribution` (`e55a554d`); `git branch --contains` lists no `main`.
  Migrations 108–109 (`afldb_import` reads `data_edits` and `player_match_period_stats`) are
  **uncommitted**. DEV deploys `main`.
- **Measured (Phase 0, 2026-09-30):** `afldb_dev` has migrations 1–104 applied; **105–109 are
  pending** (105 `prod_actor_lifecycle_assertion` is already on deployed `main`; 106–109 are
  ISSUE-238 / ISSUE-253 work). `afldb_test` and `code_test_db` are both at 109/109, with zero pending
  and zero unknown migrations. **DEV reaches 109 by applying every pending migration, currently
  105–109.** *(Superseded: "`afldb_dev` is therefore almost certainly at a pre-106 migration
  level. Phase 0 proves the exact level.")*
- **What this means for DEV** while it is below 106:
  - the ledger CHECK refuses `action = 'corrected'`, so no corrected fixture can exist;
  - the ISSUE-238 checker's ledger reader selects `previous_player_identity`, which does not
    exist there, so every freeze-bound target read fails;
  - the real ORIGINAL needs `afldb_import SELECT` on `data_edits` (migration 108, found in
    Slice 10).
- **The rehearsal cannot run until `afldb_dev` is at migration 109, with `privileges.sql` applied.**
  This is a permanent DEV schema change. The pre-rehearsal state R0 (Part H) is therefore defined
  *after* that change, and teardown restores R0, not the pre-migration state.
- **Options for D-1:**
  - **(a) Recommended.** Commit ISSUE-238 through 109 (and ISSUE-253/254) to its branch, merge to
    `main`, and deploy to DEV normally (`deploy/sync-dev.ps1`, migrations, `db:privileges`).
    - The deployed DEV app then carries the ISSUE-238 code. That code is inert without a
      `corrected` row, and the PROD gate stays.
    - The overlay remains useful as the exact code under test.
  - **(b)** Apply the pending migrations (then believed 106–109; measured 105–109) and
    `privileges.sql` to `afldb_dev` from the overlay only,
    without merging.
    - DEV's migration ledger then runs ahead of `main`. `migrate.ts` refuses any later edit of an
      applied migration, so the files must never change before the merge.
    - `sync-dev.ps1` cannot apply an unmerged migration (the ISSUE-167 finding), so this is a
      manual `db:migrate` run with its own authorisation.
  - **(c)** Stop. Keep the DEV cases open until ISSUE-238 lands on `main`.
- **The candidate side also needs a check.** A candidate restored from `afldb_test` (rebuilt with
  the ISSUE-238 code, so at 109) must be accepted against the DEV target by the checker's
  schema/migration gates. Phase 0 runs a read-only `--phase source` / `--plan` probe to prove it.

---

## D. The fixture problem and its solution

**Facts:**
- **DEV's AFL API census (Phase 0, 2026-09-30; P0-H).** DEV has existing AFL API identities in
  `external_identities`: `unique / afl_api_manual_adjudication` 3,
  `unique / afl_api_name_team_season_bootstrap` 129, `unique / afl_api_stat_vector_bootstrap` 397,
  `unique / afl_api_stat_vector_season` 274. It has **no** adjudication ledger rows, **no**
  corrected authority, **no** AFL API-owned canonical rows (`player_match_stats` 0,
  `brownlow_round_votes` 0, `matches` 0), and no residue in the reserved `CD_I999238600*`
  namespace. *(Superseded: "DEV holds about 800 AFL API importer identities …")*
- No real DEV provider is a legitimate correction case, so no corrected authority can be found. It
  has to be created.
- A real `--apply` on a real DEV provider would plant false authority on a real identity. It is
  rejected.
- Carrying the retired Run-2 authority from `code_test_db` is refused by the recovery tool itself:
  "recovered only into code_test_db, never into afldb_dev". That is correct provenance protection.

**Solution: two namespaced fixture providers on real baseline players.**

| Fixture | Provider | Players | Role |
|---|---|---|---|
| **FX1** | `CD_I9992386001` | P1 → P1′ | becomes the **one corrected authority**, net `linked(P1)` then `corrected(P1′)` |
| **FX2** | `CD_I9992386002` | P2 (and P2′, used only by the injected late ORIGINAL) | stays net `linked(P2)`; the late-write subject for 44, 67, 89 and 92 |

**Why real baseline players.** Promotion joins target to candidate by stable identity. P1, P1′, P2
and P2′ must exist in both `afldb_dev` and `afldb_test` with the same unique
`afltables_profile_url`. Phase 0 selects four players that meet all of these conditions:
- historical, with an unambiguous AFL Tables path;
- no `afl_api` identity in either database;
- no AFL API-sourced canonical rows;
- not in any continuity pair.

The selection is recorded in `~/i238dev/state.env`.

**Why this shape passes the real gates:**
- The providers are absent from the candidate. So FX1 is CPC class 3 `insert`, identity-only
  (nothing implicates it). FX2 is a net-`linked` entry with no candidate row, which G2 leaves
  ungraded and D15 INSERTs post-swap.
- Neither is a target importer row, so G3 is unaffected.

**How FX1 and FX2 are created (decision D-2).**

1. **Seed (fixture SQL, one owner transaction, DEV unfrozen, app stopped).** This follows the
   ISSUE-237 L2 precedent. It inserts:
   - one attribution actor `issue238-dev-rehearsal-fixture@example.test` (`super_admin`, disabled,
     `password_hash` NULL, so it can never log in);
   - for FX1 and FX2, a `linked` ledger row and a `resolved` / `afl_api_admin_adjudication`
     identity row at P1 / P2. These are exactly the shapes the real admin link plus D15 leave;
   - evidence JSON marked `"fixture": true` and a fixed note.

   The script checks census preconditions (the providers and actor are absent, the players are as
   recorded) and commits only if `assertAflApiIdentityInvariant` passes. The seed is needed
   because the real admin link requires AFL API observations and pending candidates, which DEV
   does not have.
2. **Real correction of FX1: the one real DEV `--apply`**, which item 12 anticipates ("unless a
   real correction fixture is deliberately created under separate operator authorisation").
   - The real CLI runs on `afldb_dev` as `afldb_import`: `--validate-only`, then `--dry-run`, then
     `--apply --expect-fingerprint`, correcting FX1 from P1 to P1′.
   - Human origin: the corrected row `supersedes_id` = FX1's linked row.
   - FX1 has no observation, so the M1 surname gate has nothing to disagree with.
   - The closure is empty, so the correction is identity-only.
   - It writes: one `corrected` ledger row, FX1's identity updated to P1′, and batch K only if
     the tool opens one for an identity-only closure (Phase 0's code_test_db dry proof, below,
     records which).
3. **FX2 is never corrected by a real CLI on the target.** Its "late ORIGINAL" in 44 and 67 is the
   injected privileged write (Part A).

**How the fixture is distinguished from genuine DEV authority:**
- the provider ids are in the reserved range `CD_I999238600[0-9]` (real AFL API ids are far
  shorter), and Phase 0 proves the range is empty on DEV and `afldb_test`;
- the only actor is `…@example.test`, disabled, with no credential;
- the evidence carries `"fixture": true` and the note `AFLDB-ISSUE-238 DEV promotion rehearsal
  fixture`;
- the whole footprint is enumerated by census before and after, and removed by one bounded
  retirement (Part H).

**Dry proof before any DEV write (decision D-3).** Run the exact seed script and the real
correction on `code_test_db` first, through the existing tunnel wrapper, then tear them down. This
proves:
- the seed passes the invariant;
- the real ORIGINAL commits identity-only with no observation;
- the correction CLI accepts `afldb_dev`-style arguments;
- the retirement script returns the state exactly.

The seed and retirement scripts are the only new code. They are rehearsal-only files, written in a
later pass and reviewed before use.

---

## E. The freeze and service state required before any mutation

- **Before the seed:**
  - `afldb` is stopped, and so is every `afldb*` timer/service Phase 0 finds;
  - `systemctl is-active` reads `inactive` for each;
  - no non-superuser session is on `afldb_dev`.
  - The app stays stopped **for the whole rehearsal**, R0 to R1: an app writing telemetry between
    runs would break the exact-restore proof.
- **Every promotion run** follows `docs/production-promotion.md` §4.0 → §8 with `--environment dev`
  and `--freeze-record` everywhere. S6-D2 makes the freeze mandatory on DEV once a corrected set
  exists (`CORRECTED_PROMOTION_REQUIRES_FREEZE`), and this design uses it for every run, the
  zero-corrected ones included.
- **Unfrozen windows happen only between runs**: after a rollback and `promotion-unfreeze.sql`.
  Only these are allowed in them: the seed, the FX1 correction, the removal of injected writes,
  and the retirement.
- **`site_settings`, auth tables and telemetry:** the app is stopped, so nothing writes them.
  Phase 0 records their digest in R0.

---

## F. The runs and how each case is constructed

**Four freeze-enabled promotions.** Each starts from a freshly frozen `afldb_dev` and ends with the
guarded rollback, so the original `afldb_dev` (`DEV_OID0`) is always the live database between
runs.

| Run | Ledger state at §4 | Late write | Swap | Cases |
|---|---|---|---|---|
| **Z** (zero-corrected) | FX1 and FX2 `linked`; 0 `corrected` | 92Z: after §6 | yes, after the 92Z injection is removed | **92** (zero-corrected), **66** (zero-corrected), **33** PSG / post-swap |
| **C** (one-corrected) | FX1 `corrected`, FX2 `linked` | 44: after §6; then 92C: after §6 | no | **44**, **92** (with a corrected row), **66** (one-corrected) |
| **67A** | as C | the late ORIGINAL on FX2: after PSG, before the swap | yes | **67**, **90** |
| **67B** | as C | as 67A | yes | **67** (again), **89** |

**Between runs Z and C:** the FX1 real correction (Part D, step 2). It happens after Run Z's
rollback and release, with DEV unfrozen and the app stopped.

### Common promotion skeleton (every run)

1. **§4.0:** plan and apply the freeze, terminate sessions, then `--phase frozen` PASS. This
   writes `record.json`, holding the OID and F0.
2. **§4.1:** `backup.sh` → `PRE`, `restore-test.sh "$PRE"`, `--phase freeze-dump` PASS.
3. **§5:** `--phase pre-cutover --freeze-record … --snapshot`.
   - PASS means frozen, quiescent and equal to F0.
   - In Runs C, 67A and 67B the corrected census (Q2) also PASSes for FX1.
4. **§6:** a fresh `afldb_test` dump restored into `afldb_dev_candidate_<stamp>`, then `--phase
   restored --freeze-record --old-database afldb_dev`. It writes the v3 artefact
   (`--afl-api-supersede-out`) and the lineage file.
   - Carry-over precondition from §17 R-7, re-checked in Phase 0: `import_batches` 82/84 §7.4b
     option 1, and the §6.3 classification for `CD_I297354`.
   - In C, 67A and 67B the artefact must have `correctedReplays = [FX1]` (class 3, insert,
     identity-only). Its `expectedSupersedes` is ∅ (the providers are absent from the candidate).
5. **§7:** the freeze-bound plan and `promotion-reinstate.sh`. The ledger (FX1, FX2 rows, ids
   preserved) and `brownlow_vote_entry_state` are reinstated. Then `privileges.sql`.
6. **§7.4e** (C, 67A, 67B only): the real `--replay-promotion` as the candidate owner. The outcome
   must be `REPLAYED`, with FX1 class 3 insert and batch `none`.
7. **§7.5:** `--phase candidate --freeze-record`. This is **PSG**. It includes G1 after
   reinstatement and CRV for FX1.
8. **§8:** the swap as the app-stopped freeze-bound `promotion-swap.sql`, then `--phase production
   --freeze-record --old-database afldb_dev_pre_rebuild_<stamp>`. This is **the post-swap gate**,
   run before any app start. Then D15 `replayAflApiAdjudicationsFromSupersedeFile`, which is §8
   step 1 / E2.
9. **§10:** the guarded `promotion-rollback.sql`. The original is live and still frozen. Remove any
   injection that remains, then `--phase pre-cutover --freeze-record` must PASS again, equal to
   F0. Then `promotion-unfreeze.sql`.

### Case 92: an ordinary `linked`/`revoked` write after §6 → PSG STOPs

- **Run Z (92Z, zero corrected rows):**
  - Inject after step 4 PASS, before step 5: an owner INSERT of a `revoked` ledger row for FX2,
    superseding FX2's linked row.
  - Step 7 (PSG) must FAIL, with the frozen-state gate naming `public.afl_api_identity_adjudications`
    and no other table.
  - Remove the row, then step 7 PASSes, equal to F0.
  - Run Z then continues to the swap for case 33.
- **Run C (92C, with a corrected row present):** the same injection and assertion.
- **Why a revoke:** a revoke is the ledger-only "ordinary" write. A `linked` write would also need
  an identity row. Both kinds change the ledger digest; the revoke keeps the injection to one
  table.

### Case 44: an ORIGINAL "committed" after §6 → PSG STOPs (Run C)

- **Prevention first:** during the freeze, the real CLI `--validate-only` for FX2 against
  `afldb_dev` as `afldb_import` must be refused at connect: `FATAL: permission denied for database
  "afldb_dev"`.
- **Detection:** inject, after step 4 PASS, one owner transaction with exactly the rows a real
  FX2 ORIGINAL (P2 → P2′) commits:
  - a `corrected` ledger row superseding FX2's linked row, with `previous_player_identity` =
    P2's path, `previous_state` = FX2's resolved row, and fixture evidence;
  - FX2's identity row updated to P2′.
  The shape is taken from the Phase-0 dry proof's real FX1 correction, not invented.
- Step 7 must FAIL, naming exactly `public.afl_api_identity_adjudications` and
  `public.external_identities`.
- **Exact removal:** delete the injected row, and restore FX2's identity row with the exact
  original column values; the row md5 must equal its F0 value. Then step 7 PASSes.
- Run C stops at step 7 and does not swap. Its candidate is left unswapped (Part I).

### Case 66: PSG PASSes with the ledger unchanged, zero- and one-corrected

- **Zero-corrected:** Run Z's final step 7 PASS (after the 92Z removal), where "live target
  afldb_dev … holds exactly the frozen state F0" is PASS.
- **One-corrected:** Run C's final step 7 PASS (after both removals), plus CRV PASS for FX1.
- Both are read-only: the target digest is equal to F0 before and after each check.

### Case 33, the PSG / post-swap sub-clause (Run Z)

- PSG PASS (above).
- The swap.
- `--phase production` PASS: the kept database (OID `DEV_OID0`) is frozen and holds exactly F0,
  and the promoted live database is the candidate, unfrozen.
- D15 E2: it inserts FX2's resolved row on the promoted database, with no supersede and no STOP.
- "Change no state": the kept database is still exactly F0 after the production phase, so the
  checker is read-only.
- Then the rollback.

### Case 67: a write between PSG and the swap → post-swap gate FAILs (Runs 67A and 67B)

- After step 7 PASS, and before step 8's swap, inject the same "late FX2 ORIGINAL" rows as case 44
  into the frozen live `afldb_dev`.
- Then swap.
- `--phase production` must FAIL: "kept afldb_dev_pre_rebuild_<stamp> … holds exactly F0" FAILs,
  naming the same two tables, and no success line is printed.
- The promoted database (the candidate) holds FX2 only as D15 will insert it, net-`linked` at P2:
  **the late correction is lost**. This is the scenario the gate converts into a failed cutover.

### Case 90: remediation by rollback (after 67A)

- Run the guarded `promotion-rollback.sql`.
- **Acceptance:** `afldb_dev` has OID `DEV_OID0` and is still frozen, and it holds the late write:
  - the injected corrected row, by id;
  - FX2 at P2′;
  - FX1's correction intact: its corrected row, and its resolved row at P1′.
- **A freeze-bound `--phase pre-cutover`:**
  - the corrected census (Q2) evaluates;
  - the frozen-state gate FAILs, naming the two tables; that is expected, because the late write
    is the remediation's content;
  - the run prints no acceptance.
- **The promotion is not accepted.**
- **Teardown to the fixture baseline:** exact removal of the late write, then `pre-cutover` PASSes
  equal to F0, then release.

### Case 89: remediation by re-applying ORIGINAL on the new live (after 67B)

- On the promoted `afldb_dev`, after the production FAIL and D15 E2 (FX2 inserted at P2), with the
  app still stopped:
  - the real CLI for FX2 (P2 → P2′) runs as `afldb_import`: `--validate-only` for a fresh
    fingerprint, then `--dry-run`, then `--apply --expect-fingerprint`. It must COMMIT;
  - verification: the correction CLI re-run for FX1 and FX2 must be ALREADY_SATISFIED (Q2); the
    §8 E3 identity invariant must be OK; D15 E2 re-run must show no inserts, no supersedes and no
    STOP.
- **"Promotion accepted" after 89 (decision D-5).** The kept-database gate can never pass again
  (the kept database really holds the late write), so acceptance must be recorded from the checks
  above.
  - Proposed: acceptance = those three checks, plus a freeze-bound `--phase pre-cutover` of the
    **new** live database (freeze → frozen → pre-cutover → release) whose Q2 census PASSes for
    both providers.
- **Teardown:**
  - the guarded rollback (the original returns, still holding the late write);
  - exact removal;
  - `pre-cutover` PASS = F0;
  - release.
  - The promoted database, which now holds the re-applied correction, becomes the retained
    candidate name (Part I).

### Proving each write fell in the intended window

Each injection runs as one owner transaction whose first statement records:
- `pg_current_snapshot()`, `pg_current_xact_id()` and `clock_timestamp()`;
- the target OID and comment (the freeze token).

The window proof chain for every case is then:
1. **Not before:** the gate immediately before the injection PASSed, equal to F0, and its log
   line carries a timestamp earlier than the injection's `clock_timestamp()`. For 44/92 that gate
   is step 4 `restored` (which proves the old target equals F0); for 67 it is step 7 `candidate`.
   The injected rows' `xmin` values are later than the snapshot recorded after that gate.
2. **The write itself:** the injection returns the new rows' ids and `xmin`, and the md5 of the
   FX2 identity row after the update.
3. **Not after (44/92):** the next gate FAILs, naming exactly the injected tables. After exact
   removal the same gate PASSes, which proves the injection was the only drift.
4. **Not after (67):** after the swap, the kept database (same OID, same token) contains the
   injected rows by id, and the promoted database does not. The production-phase FAIL names the
   same tables. The swap log time follows the injection time.

Every step writes a log `~/i238dev/evidence/<run>-<step>.log` with `date -Is`, and each log's
sha256 goes into `~/i238dev/evidence/SHA256SUMS`.

---

## G. Acceptance evidence per case

| Case | PASS requires (all of) |
|---|---|
| 92 | **Run Z:** step 4 PASS; the injection log; step 7 FAIL with exactly `public.afl_api_identity_adjudications` drifted; after removal, step 7 PASS = F0. **Run C:** the same. |
| 44 | Run C: the in-window real-CLI refusal (`permission denied for database "afldb_dev"`); step 4 PASS; the injection log; step 7 FAIL naming exactly the ledger and `external_identities`; after exact removal, step 7 PASS = F0. |
| 66 | Run Z final step 7 PASS (zero-corrected), and Run C final step 7 PASS with CRV PASS for FX1 (one-corrected); the target digest = F0 before and after each. |
| 33 (PSG / post-swap) | Run Z: step 7 PASS; the swap; `--phase production` PASS (kept OID `DEV_OID0`, frozen, = F0; promoted = candidate OID, unfrozen); D15 E2 inserts FX2 only; the kept database = F0 after production; the rollback. |
| 67 | 67A and 67B each: step 7 PASS; the injection log (after the PSG timestamp, before the swap timestamp); the swap; `--phase production` FAIL naming the two tables, with no PASS line; the kept database holds the rows by id and the promoted database lacks them. |
| 90 | After 67A: rollback PASS; `afldb_dev` has OID `DEV_OID0`, frozen, holds the late write and FX1's correction; the freeze-bound `pre-cutover` frozen-state gate FAILs on the two tables; no acceptance is printed. |
| 89 | After 67B: the real FX2 ORIGINAL on the promoted database COMMITTED with a fresh fingerprint; the Q2 re-runs ALREADY_SATISFIED for FX1 and FX2; the E3 invariant OK; D15 E2 re-run clean; the D-5 acceptance record. |

---

## H. Teardown and the exact-restore proof

**R0, the pre-rehearsal state:** taken after D-1 (the migration), before the seed. It is the
reference for everything. Read-only, as `afldb_owner`, it records:
1. **Lineage and access:** `afldb_dev`'s OID, `datacl` and comment (`shobj_description`), and
   `pg_database` rows for every database, holding name, OID and comment.
2. **Data:** for every base table in `public` and `staging`, the row count and
   `sum(hashtextextended(x::text, 0))`. This is the "88-table census" pattern of the Option-A
   retirement, and it covers the canonical, derived, AFL API identity, ledger, auth and telemetry
   tables.
3. **Sequences:** every `public`/`staging` sequence as `last_value/is_called`.
4. **Markers:** freeze or rebuild markers (the database comment) on every database, 0 prepared
   transactions, and `--freeze-status` normal.
5. **Services:** each `afldb*` unit's active state at R0. The app's pre-rehearsal state is
   recorded separately before it is stopped, as `SERVICE0`.
6. **Files:** the `~/backups/afldb` listing, so the rehearsal's dumps are identifiable.

**Teardown steps:**
1. After the last run's rollback and release, the original `afldb_dev` (`DEV_OID0`) is live and
   unfrozen, holding R0 plus the FX1/FX2 footprint.
2. **Fixture retirement: one bounded owner transaction**, modelled on
   `retire-run2-authority.ts`:
   - lock both identity tables;
   - refuse unless the census equals the recorded footprint (the FX1 linked + corrected rows, the
     FX2 linked row, the FX1/FX2 identity rows, the fixture actor, and FX1's batch K if one was
     opened);
   - delete exactly those rows;
   - commit only if all of these hold:
     - `assertAflApiIdentityInvariant` passes;
     - no row names the reserved range;
     - every other table's count and hash is unchanged.
3. **Sequence restore:** each sequence the rehearsal advanced is set back to its R0 value with
   `setval`, only when its owning column holds nothing above that value (the harness rule).
4. **R1:** the R0 capture, repeated. **Acceptance:** R1 = R0 on every item, with two documented
   equivalences:
   - `datacl` may change from NULL to the explicit default-equivalent ACL (§17 R-8; F-002 by
     design). If R0 already shows the explicit form, it must be byte-equal;
   - the `pg_database` listing has no rehearsal candidate left, assuming D-7 chooses to drop them.
5. **Service restore:** start exactly the units that were active in `SERVICE0`, then check health
   is 200 and every role connects.

---

## I. Temporary databases, files and fixture authority after completion (decision D-7)

- **Candidates `afldb_dev_candidate_<stamp>` (4):**
  - they hold fixture authority. The 67B one also holds a real-CLI correction of FX2, and the
    89-remediation writes;
  - recommended: keep them until the evidence is reviewed, then `dropdb` each (sudo `postgres`);
  - a retained candidate must never be promoted.
- **`afldb_restore_test`:** a scratch database. It ends holding the last run's `PRE`. It is not
  restored (declared).
- **Dumps:** the `PRE` dumps taken after the seed contain fixture authority. Move them out of the
  `~/backups/afldb` backup series into `~/i238dev/dumps/` so a future restore can never pick them
  up. Keep the R0 safety dump in the series.
- **Kept:** the freeze directories, plan directories, `state.env`, the evidence logs and
  `SHA256SUMS`, until ISSUE-238 closes.
- **Removed at the end:**
  - the overlay tree `~/i238dev/afldb`;
  - the sudo drop-in, if one was used;
  - FX1/FX2 authority, by retirement from `afldb_dev`. Nothing fixture-derived remains in the live
    database.

---

## J. sudo

The commands run by the operator interactively, so **no sudoers change is needed**: typing the
sudo password at each prompt is the narrowest mechanism.

A drop-in is needed only if the operator wants scripted, unattended phases. If so, use §17's
precedent narrowed to exact commands, installed and removed by the operator
(`/etc/sudoers.d/afldb-i238dev`, mode 0440, checked with `visudo -cf`):

```
arm ALL=(postgres) NOPASSWD: /usr/bin/psql -X -v ON_ERROR_STOP=1 -d postgres -f -
arm ALL=(postgres) NOPASSWD: /usr/bin/createdb -O afldb_owner afldb_dev_candidate_*, /usr/bin/dropdb afldb_dev_candidate_*
arm ALL=(root) NOPASSWD: /usr/bin/systemctl stop afldb, /usr/bin/systemctl start afldb
```

`restore-test.sh`, `backup.sh`, pg_dump and pg_restore run as `arm` with the DSNs, as in §17.

---

## K. Decisions and authorisations required (nothing proceeds without them)

| ID | Decision | Recommendation |
|---|---|---|
| **D-1** | How `afldb_dev` reaches migration 109 plus privileges (Part C). This is a permanent DEV schema change. | (a) merge ISSUE-238 (+253/254) to `main`, then the normal DEV deploy |
| **D-2** | Authorise the DEV fixture: the owner SQL seed of FX1/FX2 (the linked authority, identity rows, disabled actor) and **one real DEV `--apply`** (FX1), per item 12's clause | authorise, bounded to the reserved range |
| **D-3** | Authorise the `code_test_db` dry proof of the seed, the FX1 correction and the retirement through the tunnel wrapper, before any DEV write | authorise |
| **D-4** | Accept the Part A interpretation: under the ISSUE-250 freeze, the case 44/67/89/92 window writes are proven as prevention (the real CLI refused in-window) plus detection (a privileged injection of the exact rows) | accept |
| **D-5** | What counts as "promotion accepted" after the 89 re-apply, given the kept-database gate cannot pass | Part F's proposal |
| **D-6** | Authorise the DEV mutations: the freeze/unfreeze cycles, 4 candidates, 3 swaps and 3 rollbacks (Run C does not swap), the injections and removals, the retirement, and DEV app downtime for the whole rehearsal | authorise, with a time window agreed |
| **D-7** | What happens after acceptance to the candidates, the rehearsal `PRE` dumps and the sudo drop-in (Part I) | drop the candidates after review; move the dumps out of the series |

### K.1 Operator decisions (2026-09-30) — binding

| ID | Decision |
|---|---|
| **D-1** | **APPROVED, option (a).** An intermediate implementation commit/merge to `main` of the ISSUE-238 implementation needed for the rehearsal, including the ISSUE-253/254 integration and migrations 106–109; then the normal DEV deploy/migration path brings `afldb_dev` to 109 with privileges. This does **not** close ISSUE-238. `CORRECTED_PROMOTION_REHEARSAL_REQUIRED` stays in place, unchanged. *(This supersedes, for this commit only, the S6-D3 note "no commit until then"; evidence cleanup stays deferred per D-7.)* |
| **D-2** | **APPROVED conditionally in advance.** Once DEV is at 109, Phase 0 is clean, the reserved range is empty, the four baseline players are pinned, R0 is captured and the services are frozen/stopped as designed: seed FX1 `CD_I9992386001` and FX2 `CD_I9992386002`, and perform **exactly one** real DEV `--apply` (FX1). No other DEV apply is authorised by this decision. |
| **D-3** | **APPROVED.** The complete seed / correction / retirement dry proof runs on `code_test_db` before the DEV fixture is created. It must restore rows, identities, ledger state and sequences exactly. |
| **D-4** | **ACCEPTED.** Prevention (the real CLI / app-role attempt during the freeze is refused by database permissions) plus detection (owner-inject exactly the write the frozen operation would have committed; the named F0 gate rejects it). Each injection is narrowly scoped, evidenced, and removed/reconciled by the case teardown. |
| **D-5** | **Case 89 acceptance.** The deliberately contaminated kept database need not become promotion-eligible while its injected late write remains. Case 89 passes when: the late write occurs in the intended window; the relevant gate detects it; the prescribed re-apply executes against the intended state with the expected remediation result; unrelated state is unchanged; the subsequent guarded rollback/teardown succeeds. The retained late write is evidence for the race case, not a state that must pass the kept-database gate. |
| **D-6** | **APPROVED conditionally in advance**, once D-1…D-3 prerequisites hold: the bounded DEV rehearsal of this handoff — service freeze/downtime, four candidate rehearsals, three swaps/rollbacks, the defined owner-injected late writes, the FX1 correction, fixture retirement, sequence restoration, R1 comparison. **`afldb_prod` is completely out of scope.** Hard stops: an unexpected gate result; unexplained data drift; a token/OID mismatch; any PROD database name; a failed guarded rollback; a failed fixture retirement; a failed sequence restoration; R1 ≠ R0 beyond the accepted semantically-equivalent `datacl` representation. |
| **D-7** | **Cleanup.** Remove temporary candidate databases/schemas after their guarded rollback/teardown is proven. Prefer interactive sudo; a temporary sudoers drop-in, if needed, is removed immediately after its authorised use. Preserve the R0 safety dump, logs, hashes and rehearsal evidence through item 12, the production-gate-removal testing, the final commit and provenance verification; only then clean `~/issue238-s11` and `D:\tmp\issue238-slice11`. |

**Approved ordering:**
1. Phase 0 read-only against the current DEV state.
2. Commit/merge the implementation needed for migrations 106–109 (DEV then applies every pending
   migration, currently 105–109; the mechanism is Part K.3, P0-I).
3. Normal DEV deploy/migration.
4. Re-run the migration/schema/privilege portion of Phase 0 and prove DEV is at 109.
5. The `code_test_db` fixture dry proof.
6. R0 and the safety dump; record service state; freeze/stop services.
7. Seed FX1/FX2.
8. Run Z.
9. The one authorised real DEV FX1 correction.
10. Run C.
11. Run 67A / case 90 rollback path.
12. Run 67B / case 89 re-apply path.
13. Retire the fixtures, restore sequences, prove R1 = R0, and restore exactly the services that were
    originally running.
14. Item 12, DEV read-only / no-op acceptance.

The concrete phase scripts are written from this handoff before any mutation; the contract is not
redesigned unless implementation evidence contradicts it.

### K.2 Script-writing pass notes (2026-09-30, before Phase 0 ran)

Written: `p0-phase0.sh` (read-only; `MODE=pre` for ordering step 1, `MODE=post` for step 4). While
writing it, three points were found where the design's Phase-0 list meets the current code. None
changes the contract; each is measured by Phase 0 and, if it bites, goes back to the operator.

- **P0-1: the "source / plan acceptance probe" (Part C, last bullet) cannot run read-only now.**
  `--phase source` requires the ISSUE-252 preparation record, which only
  `db:promotion:prepare-source --apply` writes, and that mutates `afldb_test`. `--plan` needs a
  restored candidate. Phase 0 substitutes: `afldb_test`'s migration ledger against the checkout
  (§4 of the script), plus the dependency probe below. The real acceptance stays Run Z's
  `--phase restored` gate.
- **P0-2: the skeleton starts at §4.0 and omits ISSUE-252 §3a/§3b.** Under `--environment dev` the
  checker does not require a source-dependency proof (`tools/db/promotion-check.ts:763` demands it
  only under `prod`; `docs/production-promotion.md` §5: "optional under `dev`"), so the skeleton is
  executable as written. Whether `--phase restored` then passes its lineage gate depends on whether
  `afldb_dev`'s F1/F2 dependency rows reference matches `afldb_test` holds under the same owner.
  Phase 0 §10 runs the read-only `--phase dependencies` on `afldb_dev` and checks every `match_key`
  in `afldb_test`. **CLEAN → no change. GAPS → operator decision** (§3a preparation of `afldb_test`
  is a separate mutation this handoff does not authorise).
- **P0-3: the source and dry-proof databases must also be at the checkout's migration set.** D-1
  covers `afldb_dev` only. A candidate restored from an `afldb_test` below 109, or a dry proof on a
  `code_test_db` below 109, would not test the 109 contract. Phase 0 §4/§5 record both; bringing
  either to 109 would need its own authorisation.

*(K.2 status after the first Phase 0 run: **P0-1** stands. **P0-2** is now a real prerequisite,
Part K.4. **P0-3** is RESOLVED: both test databases are at 109/109 with the full schema and grants.)*

### K.3 Phase 0 `MODE=pre`, first run (2026-09-30), and the Phase-0 corrections

**The run.** It was read-only: no database, Git, migration, deploy, freeze or service mutation.
- Evidence: `/home/arm/i238dev/phase0/pre-20260930-220356`.
- `phase0.log` sha256: `c2afc75b36c725ff044ba3a123be528083fbb80e69d637cddebacd16a3a97fff`.
- Result: `PHASE0_RESULT=STOP`. The causes are the script defects corrected below, not DEV state.

**Recorded baseline (authoritative until a rerun supersedes it):**

| Item | Value |
|---|---|
| ISSUE repo | `/home/arm/afldb-issue238-s11`, HEAD `d279c8e0d8dea3b49f271c1b3e50e6648f595bb8`, `issue/238-canonical-reattribution`, migrations through 109 |
| Deployed primary | `/home/arm/projects/afldb`, `main` at `8fc60404d12c64d410e1f41c68bd8f0c7f5b6154` ("fix(promotion): prepare current-season source dependencies"), migrations through 105 on disk; four pre-existing untracked rebuild manifests |
| DSN identity | `DATABASE_URL` → `afldb_dev`/`afldb_app`; `AFLDB_OWNER_DATABASE_URL` → `afldb_dev`/`afldb_owner`; `AFLDB_IMPORT_DATABASE_URL` → `afldb_dev`/`afldb_import`; `AFLDB_TEST_DATABASE_URL` → `afldb_test`/`afldb_owner`; `AFLDB_CODE_TEST_DATABASE_URL` → `code_test_db`/`afldb_owner`; `AFLDB_CODE_TEST_IMPORT_DATABASE_URL` → `code_test_db`/`afldb_import`. `AFLDB_TEST_IMPORT_DATABASE_URL` does not exist. |
| Migrations | `afldb_dev` 1–104 applied, 105–109 pending; `afldb_test` 109/109; `code_test_db` 109/109 (0 pending, 0 unknown each) |
| Schema/grants `prev_identity_col\|corrected_check\|imp_sel_data_edits\|imp_sel_pmps\|imp_ins_ledger\|imp_upd_ledger\|imp_del_ledger` | `afldb_dev` `0\|false\|false\|false\|true\|false\|false` (pre-D-1, expected); `afldb_test` and `code_test_db` `1\|true\|true\|true\|true\|false\|false` |
| `afldb_dev` | OID **202860**, no freeze/rebuild marker; `max_prepared_transactions=0`, prepared xacts 0; no `afldb_prod*` database on the host |
| Pre-existing databases | e.g. `afldb_dev_candidate_20260926-033212`, `afldb_dev_candidate_20260926-195601`, `afldb_dev_pre_rebuild_20260906-112500`, `afldb_dev_pre_rebuild_20260926-085511`. They predate ISSUE-238, are not its residue, and are never touched by this rehearsal. |
| Reserved namespace | `CD_I999238600*` empty in all three databases |
| `code_test_db` baseline | `external_identities` #18333 `CD_I9992370001`, player 1018, `unique` / `afl_api_stat_vector_bootstrap`, 0 ledger rows: the retained Slice-11 baseline importer, **not** residue; never mutated |
| DEV AFL API census | Part D (P0-H) |
| R-7 carry-overs (baseline lineage differences) | DEV: `import_batches` 82 and 84 present; `external_grids` refs 82:1123, 84:1143; `CD_I297354` `unique` / `afl_api_stat_vector_season` / player 7974. `afldb_test`: 82/84 absent, no refs, `CD_I297354` absent. |
| ISSUE-252 manifest A | `pre-20260930-220356/deps-A-dev.json`, file sha256 `0047987f378920ed166e9ae8714319808c2476656c75fb711d1c501c50b449e1`, `dependency_set_sha256` `abe4df4e73efef1ef858d485cf56a704f6e2b5b21c1f927853a8f47b3e20a785`; F1 = 3 rows, F2 = 0, F3 withheld by the DEV contract. Probe verdict: see P0-J and K.4. |
| Players (`~/i238dev/state.env`) | `DEV_OID0=202860`. P1 `players/A/Abe_McDougall.html` (DEV id 23, 59 PMS, 0 Brownlow round rows); P1′ `players/A/Abe_Watson.html` (24; 2; 0); P2 `players/A/Adam_Garton.html` (34; 3; 3); P2′ `players/A/Adam_Inglis.html` (41; 2; 0). The paths match across all three databases. FX1 `CD_I9992386001`, FX2 `CD_I9992386002`, actor `issue238-dev-rehearsal-fixture@example.test`. |
| SERVICE0 | `afldb.service` loaded, active (running), enabled; health 200; sessions on `afldb_dev`: `afldb_app` × 2; no AFLDB timer active. This is exactly what is restored at the end. |
| sudo | `arm` has password-required `(ALL : ALL) ALL`; no ISSUE-238/250 NOPASSWD drop-in (other NOPASSWD rules belong to unrelated host operations). Interactive sudo stays the model; no drop-in without separate justification. |
| Ancestry | merge-base `8fc60404…`; deployed main IS an ancestor of the ISSUE base, not the reverse; deployed main has 0 commits beyond the ISSUE base. Commits between: `71993907`, `12fb20cb`, `cdd1b7cd`, `5c79c47e`, `e55a554d`, `788bffa2`, `b440b226`, `76d70e38`, `9facb9cc`, `3f9fc1fe`, `d279c8e0`. |

**Corrections applied to `p0-phase0.sh`** (narrow; no contract change):
- **P0-A:** both env files are loaded, primary first, into the script's own process. A missing
  `AFLDB_TEST_IMPORT_DATABASE_URL` is a NOTE, not a STOP. `code_test_db` uses its real DSNs, no
  longer one derived by swapping the database name.
- **P0-B:** before D-1, `afldb_dev` must have exactly 105–109 pending and exactly the recorded
  pre-D-1 schema/grants tuple. With `MODE=post` it must be 109/109, 0 pending, 0 unknown, full
  tuple. The test databases must be at 109 with the full tuple in both modes. Any other state is a
  STOP.
- **P0-C:** hard gates cover the reserved `CD_I999238600*` identities and ledger, any `CD_I99923*`
  ledger row, the fixture actor, `players/Z/Zz238_*` paths, and the `issue238_s11_target` schema.
  Broader `CD_I99923*` identities are reported for information only; `code_test_db`
  `CD_I9992370001` (`unique` / `afl_api_stat_vector_bootstrap`) is the known baseline.
- **P0-D:** `--freeze-status` now runs as `npm run db:promotion:check -- --environment dev
  --freeze-status`. The freeze modes accept `--environment` (`tools/db/promotion-check.ts:549-585`),
  and `describeFreezeStatus()` judges that environment's names (`tools/db/promotion-freeze.ts:730`).
  The first run defaulted to `prod` and printed `NO LIVE DATABASE 'afldb_prod'`. **That line is not
  DEV evidence and is disregarded.** The script now requires the line
  `afldb_dev (oid <oid>, live): no marker, ACL open`.
- **P0-E:** the PROD IP is read without echo (or taken from the operator's environment). It must
  be a dotted IPv4 address: a placeholder is refused. It is never printed, logged or persisted.
  Both env files are checked. PROD is never contacted. The first run's literal placeholder made
  that check meaningless.
- **P0-F:** a dependency gap is a NOTE and a tracked prerequisite (K.4), not a Phase-0 STOP. The
  script adds a read-only classification of each gap (below).
- **P0-G:** the script inspects the deployed primary `/home/arm/projects/afldb`: that it is a git
  repository, that its branch is `main`, and its HEAD and porcelain state. With `MODE=pre`, HEAD
  must still be `8fc60404…` and must be an ancestor of the ISSUE HEAD; with `MODE=post`, HEAD must
  descend from it. It no longer expects a local `main` in the bundle-backed ISSUE repository. The
  ISSUE-243 preflight stays informational: its dirty-tree and branch-local-migration FAILs are
  expected before D-1.
- **P0-H:** the census wording is corrected (Part D).
- **P0-I:** the D-1 integration mechanism is recorded (below).
- **P0-J (found in this pass): the first run's dependency probe was defective.** `match_key`
  itself contains `|` (`2025|1|2025-03-07|Sydney|Hawthorn`), and the probe used `|` as the psql
  field separator. Its parser therefore keyed every `afldb_test` row as `2025`, so **every**
  dependency would have reported "absent" whether or not `afldb_test` holds it. This was reproduced
  locally on synthetic input: a held key reads as absent under the old parser and as held under the
  fixed one. The probe output is now tab-separated. **The claim "all three F1 dependencies are
  absent from `afldb_test`" is not established by the first run.** Unless the operator's follow-up
  checks queried those exact keys, the rerun decides.

**Corrected `MODE=pre` rerun: PASSED (2026-09-30), the authoritative Phase-0 result.**
- Evidence `/home/arm/i238dev/phase0/pre-20260930-223306`; `PHASE0_RESULT=CLEAN_FOR_REVIEW`,
  exit 0, `STOPS=0`, `NOTES=1`.
- The sole NOTE: `AFLDB_TEST_IMPORT_DATABASE_URL` absent (non-blocking by P0-A).
- **Dependency probe (fixed parser): F1 rows 3, held with the same owner 3, absent 0, owner
  mismatch 0: `DEPENDENCY_PROBE CLEAN`.** The first run's "gaps" were entirely the P0-J parser
  defect.
- The rest matches the baseline above:
  - `afldb_dev` 104 applied with exactly 105–109 pending; both test databases at 109/109;
  - OID 202860, no marker, freeze status `afldb_dev … live, no marker, ACL open`;
  - the reserved namespace clean; `CD_I9992370001` the accepted `code_test_db` baseline;
  - DEV has no ledger and no AFL API-owned canonical rows;
  - `afldb` active and enabled, health 200;
  - primary `main` at `8fc60404…` (still an ancestor of the ISSUE HEAD) with its four untracked
    manifests untouched; the ISSUE repository at `d279c8e0…`.

**D-1 integration mechanism (P0-I). Design only; D-1 is executed in its own pass.**
1. Create the authorised intermediate commit in the ISSUE repository. Stage explicit paths only,
   never `git add -A`. The stray untracked files `0`, `b`, `second` and the two JS-fragment names
   stay out.
2. Create a bundle of that branch history (`8fc60404..issue/238-canonical-reattribution`), then
   `git bundle verify` it.
3. In `/home/arm/projects/afldb`, first assert `HEAD == refs/heads/main`, `HEAD == 8fc60404…` and a
   clean tracked tree. Then fetch the bundle into a temporary ref (for example `refs/i238/d1`).
4. Verify: the ref's commit id equals the ISSUE commit, its tree equals the ISSUE tree,
   `merge-base --is-ancestor HEAD refs/i238/d1` holds, and the reviewed `diff --stat`.
5. Assert that none of the four untracked rebuild manifests collides with an incoming tracked
   path.
6. Run `git merge --ff-only refs/i238/d1`. Never use a source-tree copy, a cherry-pick series or a
   merge commit. **If primary `main` has moved: STOP and recompute ancestry.**
7. Apply the normal DEV deployment/migration path. `db:migrate` applies 105–109.
   `npm run db:privileges` (`tools/db/privileges.ts --target dev`) reconciles the grants (the
   ISSUE-027 order: migration and privileges before code). Then `MODE=post` Phase 0.

Two decisions this raises are listed in K.4's last table.

### K.4 ISSUE-252 dependency prerequisite (P0-F): CLOSED 2026-09-30, no action

**Closure.**
- The corrected rerun's probe is `DEPENDENCY_PROBE CLEAN`: all three F1 dependencies are held by
  `afldb_test` under the same owner. **K4-1 is closed with no action.** No ISSUE-252 preparation is
  required, and no dependency-preparation workaround is designed or executed. The §4.0 skeleton
  stands (K.2 P0-2 as written).
- **K4-2 decided:** the fast-forwarded `main` is pushed to GitHub, and local `main` must equal
  `origin/main` before DEV runs it.
- **K4-3 decided:** `db:migrate` and `db:privileges` run from the primary checkout, then the normal
  `deploy/sync-dev.ps1` (Part K.5).
- The analysis below is kept as the record of why the question was raised.

*(Historical, superseded by the closure above: "OPEN, operator decision".)*

**Finding.** Manifest A (K.3) lists three F1 `brownlow_vote_entry_state` rows, all on **2025**
matches:
- `2025|1|2025-03-07|Sydney|Hawthorn`
- `2025|1|2025-03-09|Greater Western Sydney|Collingwood`
- `2025|1|2025-03-29|Brisbane Lions|Geelong`

F2 = 0. F3 is withheld by the DEV contract. Their absence from `afldb_test` is **unverified**
(P0-J).

**The ISSUE-252 preparation mechanism cannot resolve these. This is code evidence, so this handoff
stops here rather than adapting it.**
- `db:promotion:prepare-source` prepares exactly one season: the in-progress one.
  - `retainedSnapshotProblems()` refuses any retained snapshot whose season is not
    `data/reference/seasons.json` `in_progress_seasons[0]`
    (`tools/db/promotion-source-dependencies.ts:1079-1096`).
  - `runPreparePromotionSource()` takes `season = inProgress[0]`
    (`tools/db/prepare-promotion-source.ts:527-535`).
  - `seasons.json` lists `[2026]`.
- So the mechanism cannot, by construction, place a 2025 match in `afldb_test`.
- Run as designed, it would write 2026 current-season data (manifest A has no 2026 dependency) and
  leave any 2025 gap in place.
- No DEV-only disposition covers F1 either. Only `data_edits` and `player_link_resolutions` carry a
  DEV `historicalOnly` treatment (`tools/db/promotion-inventory.ts:531`, `:654`); the table
  `brownlow_vote_entry_state` (`:957`) has none.
- Per CLAUDE.md §5, no ad-hoc SQL is substituted.

**Context (facts only, not a diagnosis):**
- On 2026-09-26 (ISSUE-250 §17.2 C1), DEV's `brownlow_vote_entry_state` rows (readback 3) were
  reinstated without error into a candidate restored from that day's `afldb_test`.
- `afldb_test` was freshly rebuilt and prepared on 2026-09-27 (ISSUE-252 §27.7).
- A gap today would therefore be a difference between the current rebuild's 2025 match keys and
  DEV's.

**What the corrected rerun measures (read-only, script §10).** For each gap key, it lists the
matches in both `afldb_dev` and `afldb_test` with the same season and date, or the same season and
teams (match id, key, owner). It lists DEV's `brownlow_vote_entry_state` target matches. It counts
the 2025 `match_key`s on each side, with up to 20 DEV-only and 20 test-only keys.

| Rerun outcome | Meaning | Route (operator decides) |
|---|---|---|
| **CLEAN** | The first-run gaps were the P0-J artefact | No preparation. The §4.0 skeleton stands; K.2 P0-2 applies as written |
| **Same fixture in `afldb_test` under another key** | A 2025 key divergence between DEV's lineage and the current rebuild | No existing mechanism applies. The options are all outside this handoff's authority: (i) a new DEV-only F1 disposition, a promotion-contract change with its own issue, like ISSUE-139 D1/D2; (ii) the operator confirms the three rows are admin test artefacts and authorises their removal from `afldb_dev` before R0, a permanent DEV data change recorded as such; (iii) keep the DEV cases blocked until one of those lands |
| **Match absent from `afldb_test` entirely** | DEV-only matches | The same options (i)–(iii) |

**Design only: the standard ISSUE-252 preparation, recorded as requested and NOT recommended for
these gaps.** It does not cover 2025 (above). Its commands are `docs/production-promotion.md`
§3a/§3b under `--environment dev`, with the retained 2026 inputs of ISSUE-252 §27.7:
- AFL API snapshot `afl-api-2026-2026-09-25-235854`, manifest
  `afb2a754943fba59a48eabf0bf01dbae7e64046e012318864dc84f68c96907c7`;
- bridge sha256 `47bfadbe7d7f565c0aaea4c956be6d7825ec888a8bb780271548f17546f5e41f`;
- the AFL Tables label and its manifest and `observations.json` hashes from that record.

```bash
# DEV: streamanator. DO NOT RUN. Both env files loaded; STAMP fixed once.
npm run db:promotion:check -- --environment dev --phase dependencies --database afldb_dev \
    --dependencies-out ~/backups/afldb/promotion-dev-$STAMP-dependencies-A.json
# afldb_test, afldb_owner: record V0 of acquisition.afl_api_current_season_enabled, set it true (§3a step 2)
export DATABASE_URL="$AFLDB_TEST_DATABASE_URL" AFLDB_IMPORT_DATABASE_URL="<an afldb_test afldb_import DSN>"
npm run db:promotion:prepare-source -- $P --validate-only
npm run db:promotion:prepare-source -- $P --dry-run
npm run db:promotion:prepare-source -- $P --apply --record-out ~/backups/afldb/promotion-dev-$STAMP-preparation.json
# restore the switch to V0 exactly (always, even after a failure)
npm run db:promotion:check -- --environment dev --phase source --database afldb_test --dsn-env AFLDB_TEST_DATABASE_URL \
    --target-dependencies <A> --target-dependencies-sha256 <hex> \
    --preparation-record <record> --preparation-record-sha256 <hex> --source-dependency-proof-out <proof>
```

- **Blocker even for this path:** `prepare-source` writes `afldb_test` as `afldb_import`, and the
  host has no `afldb_test` import DSN (P0-A). That would be a separate prerequisite.
- **Write set on `afldb_test`** (per the §27.7 rehearsal):
  - the `site_settings` switch, set and then restored;
  - the player-bridge loader: idempotent when all providers are already linked;
  - the AFL Tables 2026 apply (§27.7: 11,935 rows inserted, one import batch);
  - the AFL API corroboration apply: canonical applications, `data_issues` findings for the
    accepted `foreign_source_owner` census, one import batch;
  - the preparation record file.
  - A re-apply with the same labels is idempotent (0 inserted, 0 updated).
- **Verification:** `--phase source` PASS writes the proof, followed by the §27.7 post-preparation
  ownership checks.
- **Clean-up:** there is no in-place undo. Restoring `afldb_test` means a pre-preparation
  `pg_dump` taken first and restored, or `db:test:rebuild`. The prepared source is otherwise the
  normal promotion-ready state.

**Decisions this pass surfaces (none is executed):**

| ID | Decision | Needed before |
|---|---|---|
| **K4-1** | The F1 route, chosen from the rerun's classification | Run Z; recommended before D-1, because it decides whether the DEV rehearsal is executable at all |
| **K4-2** | GitHub vs. host-local `main` for D-1. `sync-dev.ps1` runs `git fetch` then `git pull --ff-only` from the GitHub remote (`deploy/sync-dev.ps1:134-140`). After a host-local `--ff-only`, that pull is a no-op, and DEV then runs commits GitHub `main` does not yet hold. The choice: push the same commit to GitHub first, or accept a recorded temporary lead | D-1 step 7 |
| **K4-3** | Where `db:privileges` runs in D-1. `sync-dev.ps1` runs `db:migrate` but no privileges reconcile. Proposed: `db:migrate` + `db:privileges` from the primary checkout right after the `--ff-only`, before `sync-dev.ps1` (whose migrate is then a no-op), per ISSUE-027 | D-1 step 7 |

### K.5 D-1 execution: the intermediate implementation commit and integration (2026-09-30)

**Where it happens.** The commit is made in the host ISSUE repository
(`/home/arm/afldb-issue238-s11`, parent `d279c8e0…`), the authoritative worktree. The workstation
worktree carries the identical content: every listed path's blob was hashed there and must match
on the host before anything is staged.

**The explicit staged-path list (26; nothing else is staged):**
- **Tracking (8):** `CHANGELOG.md`, `IssuesIndex.md`, `issues.md`,
  `issues/closed/AFLDB-ISSUE-253.md`, `issues/closed/AFLDB-ISSUE-254.md`,
  `issues/open/AFLDB-ISSUE-238.md`, `issues/open/AFLDB-ISSUE-238-DEV-PROMOTION-HANDOFF.md`,
  `issues/open/AFLDB-ISSUE-238-SLICE11-HANDOFF.md`.
- **Migrations (2):** `src/db/migrations/108_import_reads_data_edits.sql` (ISSUE-238),
  `src/db/migrations/109_import_reads_player_match_period_stats.sql` (ISSUE-253).
- **Production code (5):** `src/db/queries/match-admin.ts`,
  `src/lib/acquisition/afl-api-identity-correction.ts`, `tools/maintenance/privileges.sql`,
  `tools/migration/correct_afl_api_identity.ts`, `tools/migration/rebuild_derived.py`.
- **Rehearsal harnesses (2):** `tools/db/afl-api-identity-correction-rehearsal.ts`,
  `tools/db/afl-api-identity-promotion-rehearsal.ts`.
- **Tests (9):** `tests/awards-admin.test.ts`, `tests/correct-afl-api-identity-cli.test.ts`,
  `tests/data-overrides-source-contract.test.ts`, `tests/integration/derived-rebuild-parity.test.ts`,
  `tests/integration/draftguru-import.test.ts`, `tests/integration/match-admin-delete.test.ts`,
  `tests/integration/privileges.test.ts`, `tests/python/reference_cascade_contract.py`,
  `tests/reference-data.test.ts`.

**Excluded:** the repo-root strays `0`, `b`, `second`, `r.id).join('` and
`s.code))].sort().join('`, plus the four untracked rebuild manifests in the primary checkout.

**Attribution.**
- Every modified file is claimed by the ISSUE-238, 253 or 254 record.
- The ISSUE-254 code files are blob-identical to its own commit `09737a8a`. That commit sits
  directly on `d279c8e0`, on the unmerged branch `issue/254-derived-rebuild-parity`.
- **D-1 lands ISSUE-254 on `main` in its place.** That branch must not be merged afterwards;
  retiring it is an operator Git action for later.
- ISSUE-253 has no separate commit: its branch equals `d279c8e0`.

**The operator files** are in `~/i238dev/d1/`: `d1-paths.txt`, `d1-blobs.txt`,
`d1-commit-msg.txt`, `d1-1-commit.sh` and `d1-2-integrate.sh`. Each is sha-checked after
transport.

**Steps.** Each is a STOP on any refusal.
1. `d1-1-commit.sh` stages and commits.
   - It checks that HEAD is `d279c8e0…`, that the index is empty, and that every listed path's
     host blob equals the reviewed blob.
   - It refuses if any tracked modification lies outside the list.
   - It stages with `git add --pathspec-from-file`, then checks that the staged set equals the
     list, that the staged blobs equal the reviewed ones, and that `git diff --cached --check` is
     clean.
   - It commits once after a typed `COMMIT`. The commit must have exactly one parent,
     `d279c8e0…`, and exactly the listed paths.
   - It records `D1_COMMIT` and `D1_TREE`.
2. `d1-2-integrate.sh` bundles and fast-forwards.
   - It bundles `8fc60404..issue/238-canonical-reattribution`.
   - In the primary it re-asserts `HEAD == refs/heads/main == 8fc60404…` and a clean tracked tree
     (STOP if main moved).
   - It fetches the bundle into `refs/i238/d1`, then verifies the commit, the tree, that main is
     an ancestor, and that no untracked file collides with an incoming path.
   - After a typed `FF` it runs `git merge --ff-only refs/i238/d1`, then checks that no merge
     commit appeared and that the untracked set is unchanged.
3. **GitHub (K4-2):** `git push origin main` from the primary, a fast-forward with no force.
   Then `git fetch origin`, and local `main` must equal `origin/main` **before** anything deploys.
4. **DEV migration/deploy (K4-3), from the primary checkout:**
   - `npm run db:status`, which must list 105–109 pending;
   - `npm run db:migrate` (target `dev`, `AFLDB_OWNER_DATABASE_URL`);
   - `npm run db:privileges` (`tools/db/privileges.ts --target dev`);
   - `npm run db:status` again, which must list none pending;
   - then the normal workstation `deploy/sync-dev.ps1`: fetch, a no-op `pull --ff-only`, `npm ci`,
     a no-op `db:migrate`, build, restart, health.
5. **`MODE=post` Phase 0** must PASS before any FX1/FX2 work.

D-1 does not close ISSUE-238, and `CORRECTED_PROMOTION_REHEARSAL_REQUIRED` is unchanged.
There is no fixture seed, no DEV correction, no freeze, swap or rollback, and no PROD operation.

---

## Proposed rehearsal sequence

0. **Phase 0, read-only (Claude through the tunnel, or the operator):**
   - DEV's migration level and privileges;
   - the checker's source / plan acceptance of an `afldb_test` candidate against DEV;
   - the reserved provider range is empty;
   - select P1, P1′, P2, P2′;
   - re-check the R-7 carry-overs;
   - list the services, databases and datacl;
   - the `.env` does not name PROD.

   Stop on anything unexpected.
1. **D-1 executed** (outside this rehearsal).
2. **D-3:** the `code_test_db` dry proof. Write the seed and retirement scripts, review them, run
   them through the wrapper, and record the real FX1-correction row shape.
3. **R0 capture.** A safety `backup.sh` + `restore-test.sh`. `SERVICE0`. Stop the services.
4. **Seed FX1/FX2 on DEV (unfrozen).** Check the invariant.
5. **Run Z:** 92Z, 66 (zero-corrected), 33. Rollback, then release.
6. **The FX1 real correction on DEV (unfrozen).** Its Q2 re-run must be ALREADY_SATISFIED.
7. **Run C:** 44, 92C, 66 (one-corrected). No swap. Unswapped candidate; release.
8. **Run 67A:** 67, then 90. Removal, release.
9. **Run 67B:** 67, then 89. Rollback, removal, release.
10. **Retirement, sequence restore, R1 = R0.** Start the services from `SERVICE0`. Health check.
11. **Record** the evidence in the runbook. Then item 12. Then the separate gate-removal change.

## Risks and rollback boundaries

- **Last-resort boundary:** the R0 safety dump. Any unexplained state lets the operator restore
  `afldb_dev` from it. That changes the OID, which is recorded as a lineage change, not an
  exact restore.
- **Between runs, the boundary is the guarded rollback.** It returns `DEV_OID0` still frozen. A
  rollback guard refusal (wrong token, a missing kept database) is a hard stop: keep everything
  frozen and diagnose.
- **The injections are privileged writes to the live DEV ledger.** They are always removed by exact
  value, and the same freeze-bound gate proves the removal before release.
- **The one real DEV `--apply` (FX1) is durable until retirement.** If retirement's census
  refuses, DEV keeps a clearly fixture-marked corrected provider: disabled actor, reserved range.
  It is inert to the app, and the PROD gate still stands.
- **DEV downtime:** the app is stopped from step 3 to step 10.
- **Hard stops:** in addition to D-1's schema:
  - any gate result not as expected;
  - any table drift other than the injected ones;
  - a non-superuser session while frozen;
  - a token or OID mismatch;
  - a PROD name anywhere;
  - residue that retirement refuses;
  - R1 ≠ R0 beyond the two documented equivalences;
  - any unexpected app start.

## L. Commands to run ONLY after approval (skeletons; Phase-0 output fills the placeholders)

```bash
# DEV: streamanator — Phase 0 (read-only) is now the script (K.3):
#   MODE=pre  bash ~/i238dev/p0-phase0.sh      (before D-1; asks for the PROD IP without echo)
#   MODE=post bash ~/i238dev/p0-phase0.sh      (after D-1 + the DEV deploy)
# The skeleton lines below are the original design sketch, kept for history; the script supersedes
# them (it loads BOTH env files and runs --freeze-status with --environment dev).
# Nothing below the "after D-1" line runs until D-1…D-6 AND K.4's K4-1 are decided.
cd ~/afldb-issue238-s11 && hostname
set -a; . ./.env; set +a      # DEV DSNs; never echoed
npm run preflight -- --mode promotion --promotion-side target     # DSN identity per role (ISSUE-243)
psql "$AFLDB_OWNER_DATABASE_URL" -XAtc "select current_database(), count(*), max(name) from afldb_meta.schema_migrations"   # expect afldb_dev; the level decides D-1
psql "$AFLDB_OWNER_DATABASE_URL" -XAtc "select oid, datacl, shobj_description(oid,'pg_database') from pg_database where datname='afldb_dev'"
psql "$AFLDB_OWNER_DATABASE_URL" -XAtc "select count(*) from external_identities where external_id like 'CD_I999238600%'"   # expect 0
systemctl list-units --all 'afldb*' --no-pager
grep -c 'afldb_prod' .env                                         # expect 0

# ---- after D-1 … D-6 only ----
mkdir -p ~/i238dev/{evidence,dumps}
rsync -a --exclude node_modules --exclude .env ~/afldb-issue238-s11/ ~/i238dev/afldb/ && ln -s ~/afldb-issue238-s11/node_modules ~/i238dev/afldb/node_modules && ln -s ~/afldb-issue238-s11/.env ~/i238dev/afldb/.env
# R0 capture (script from the D-3 pass), safety dump, SERVICE0, stop
sudo systemctl stop afldb      # plus every unit Phase 0 listed
# seed (reviewed script), then Run Z per docs/production-promotion.md §4.0–§10 with --environment dev,
# injecting 92Z between §6 and §7.5 exactly as Part F; then the FX1 real correction; Runs C, 67A, 67B;
# retirement, sequence restore, R1, service restore.
```

The exact per-run command blocks, with every `STAMP`, `FREEZE`, `PRE` and injection statement,
are written as phase scripts (`~/i238dev/p*.sh`) in the pass after D-1…D-6 are decided. They
follow §17's pattern, and each is reviewed before it runs.
