# AFLDB Current Issues Index

> Lightweight session index of open issues only.
>
> `issues.md` is the authoritative detailed ledger.
>
> Runbooks live under `issues/`, not at the repository root: `issues/open/<ISSUE-ID>.md` while
> the issue is open, `issues/closed/<ISSUE-ID>.md` once it is resolved, together with any
> `-HANDOFF.md` companions and evidence artefacts. Historical entries below name a runbook by
> filename only; resolved ones are in `issues/closed/`.

**Open issues:** 15

### AFLDB-ISSUE-248 — Reserved-domain DEV auth fixtures block promotion
- **Severity:** High. **Area:** DEV auth operations — `auth_users`, `admin_invites`,
  `auth_audit_log`, `auth_sessions`; `tools/maintenance/issue248-cleanup-dev-auth-fixtures.ts`.
- **State:** Open (2026-09-25), from the ISSUE-237 L4 A5 refusal (the test-fixture identity gate).
  The closure is `auth_users` 14/17/18 (disabled), invite 5, audit rows 807/808/811/812/889/890/912/913
  (user 18 login/logout, NULL detail) and revoked sessions 13/15/29/35. Every other FK count is 0.
  Implemented and DB-free validated, committed `a4f734af`:
  - `npm run db:issue248:cleanup-dev-auth-fixtures -- --environment dev --actor-email <super admin>
    [--apply]`, validate-only by default;
  - `afldb_dev` only, with exact closure guards and a dynamic catalogue FK census;
  - other reserved-domain rows are a STOP, never swept in;
  - one real-actor `test_fixture.cleanup` audit, then FK-ordered exact-id deletes, in one
    transaction with postcondition totals; ALREADY_CLEAN on rerun.
- **Runbook:** `issues/open/AFLDB-ISSUE-248.md` (§9 has the live procedure).
- **Next action:** finish combined ISSUE-247/248 integration and deploy to DEV. Then run runbook
  §9 under explicit DEV authorisation, resolve on P1–P4, and rerun ISSUE-237 L4 A5.

### AFLDB-ISSUE-247 — A legitimately empty staged reinstatement table blocks promotion
- **Severity:** High. **Area:** promotion lifecycle — `tools/db/promotion-inventory.ts`
  (`stageSql`, `promoteStagedSql`, `judgeStagedSourceRows`), `tools/db/promotion-check.ts`,
  `docs/production-promotion.md` §7.2.
- **State:** Open (2026-09-25), from ISSUE-237 L4 A5 on `afldb_dev`, REFUSED by the ISSUE-151
  staged-rows gate: `afl_api_identity_adjudications` 0 (beside `brownlow_vote_entry_state` 3 and
  `external_grid_sources` 1), while the AFL API census passed (669 / 0 / 0 / 0). The empty ledger
  is legitimate. Implemented and DB-free validated, committed `86e0e2ba`:
  - a contract-declared `stagedMayBeEmpty` (only on `afl_api_identity_adjudications`);
  - per-table stage-completion evidence (`promotion_staging.promotion_stage_completion`) written by
    a statement-level trigger on each staging copy inside the load's own transaction;
  - 2d refuses missing evidence, a moved row count, and zero rows where the contract requires rows.

  `code_test_db` rehearsal **PASS 7/7**, zero residue (2026-09-26).
- **Runbook:** `issues/open/AFLDB-ISSUE-247.md` (§6 rehearsal, §7 live procedure).
- **Next action:** finish combined ISSUE-247/248 integration and deploy to DEV; then ISSUE-237 L4
  A5 with a fresh `$STAMP` and the live DEV R6 header check.

### AFLDB-ISSUE-243 — Promotion preflight cannot validate target credentials and rejects known DEV operational artefacts
- **Severity:** High. **Area:** operator workflow tooling — `tools/dev/preflight-core.ts`,
  `tools/dev/preflight.ts`, `docs/production-promotion.md` §3, ISSUE-237 §11d A2.
- **State:** Open (2026-09-25). It comes from the first real ISSUE-237 L4 A2 run on DEV, which
  STOPPED at A2 with no dump, candidate or swap. Implemented and DB-free validated, but
  uncommitted:
  - `--mode promotion` now requires `--promotion-side source|target`.
  - **source:** `*_test`, with migration parity.
  - **target:** exactly `afldb_dev` or `afldb_prod`, identity/role/connectivity only, and no
    `afldb_meta` read, so restricted import/backup credentials pass.
  - Invalid combinations refuse before DB contact.
  - Untracked `afltables_fitzroy_core/settle-*.json` manifests are WARN, using the same regex as
    `deploy/sync-dev-remote.sh`. Every other dirty path still FAILs.
- **Runbook:** `issues/open/AFLDB-ISSUE-243.md` (§8 has the corrected L4 A2 commands).
- **Next action:** the operator reviews, commits and deploys to DEV. Then rerun ISSUE-237 L4 A2
  under the separate L4 authorisation, and resolve this issue on four READY results.

### AFLDB-ISSUE-242 — Cross-database manual player registration token convergence blocks ISSUE-237 L4
- **Severity:** High. **Area:** promotion lifecycle — `tools/db/promotion-inventory.ts`,
  `tools/db/promotion-check.ts`, the step-2c lineage remap file, `docs/production-promotion.md` §6.
- **State:** Open (2026-09-25), from ISSUE-237 FR-2 / A4.2. Implemented and DB-free validated, but
  uncommitted. `--phase restored` plans the convergence by accepted AFL Tables path:
  - **rebind:** the candidate token retires and DEV's token binds to the same player;
  - **retire:** the candidate token retires and the player stays source-owned in DEV;
  - **STOP:** anything else.

  Step 2c applies it inside the remap transaction, with a final-state assertion. `--phase
  candidate` re-proves it through the unchanged A4.2. The `code_test_db` rehearsal
  (`tools/db/promotion-convergence-rehearsal.ts`, 103/103, 2026-09-25) executed the generated
  step-2c SQL in PostgreSQL: rebind, retire, every STOP, rollback of a failed and of an
  assertion-refused CTE, the idempotent re-run, and a 92-player mixture. Zero residue. No DEV,
  PROD or `afldb_test` contact.
- **Runbook:** `issues/open/AFLDB-ISSUE-242.md` (§8a is the rehearsal evidence).
- **Next action:** the operator reviews and commits. Then ISSUE-237 L4 under separate DEV
  authorisation.

### AFLDB-ISSUE-238 — Correcting a consumed trusted `afl_api` player link with canonical reattribution
- **Severity:** Medium. **Area:** admin / player identity — `external_identities` (`afl_api`),
  `player_match_stats`, `brownlow_round_votes`, `canonical_applications` and derived dependents.
- **State:** Open. Triaged 2026-09-26 and deliberately NOT folded into the bulk pass. It moves
  canonical statistics, which needs:
  - a collision/merge policy;
  - superseding ledger entries;
  - a new human-ledger correction action.

  These are operator data-semantics decisions. The dependency closure is recorded.
- **Runbook:** `issues/open/AFLDB-ISSUE-238.md`.
- **Next action:** operator decisions §5 (a–c), then the plan and review.

### AFLDB-ISSUE-237 — AFL API importer-created `unique` identities are not carried through database promotion or the `afldb_test` rebuild
- **Severity:** Medium. **Area:** promotion / rebuild lifecycle — `external_identities`
  (`afl_api`), `docs/production-promotion.md`, `tools/db/rebuild-test.ts`.
- **State:** Open (2026-09-23), split out of the ISSUE-235 plan review (R4). Pre-existing. Neither
  the promotion runbook nor `db:test:rebuild` has an `afl_api` identity step, so the importer's
  `unique` links (669 on DEV) are lost. A bridge re-import is not a safe recovery (runbook F3). Not an ISSUE-235
  dependency. ISSUE-235 is now resolved; this remains the next independent development issue.
  The plan was reviewed and revised on 2026-09-24 (`issues/open/AFLDB-ISSUE-237.md`), and
  operator decisions OD-1…OD-5 were recorded the same day (runbook §15):
  - **Rebuild.** It captures and replays these rows by stable identity, combined atomically with
    the ISSUE-235 ledger capture. It fails closed (OD-1), and a database marker replaces the
    cwd-relative recovery hazard (F5).
  - **Promotion.** It carries the rows in the rebuilt dump and adds gates G1–G3. Production G3
    hard loss is FAIL. DEV may WARN only for classified, re-acquired season-class identities,
    with a mandatory census (OD-3).
  - **D15.** It supersedes an agreeing importer row (OD-2).
  - **Coverage.** `afldb_test` coverage is recovered through stable identity (OD-4) from the I18
    dump, which is only the **candidate** authoritative pre-I18 backup until runbook §11a
    R1.1–R1.5 prove it. Without that proof, L3–L5 are blocked.
  - **Correction (same day).** Marker survival is prerequisite P-M, which gates S3.
  - **OD-6 approved (same day).**
    - **Rebuild:** an importer/human overlap is broken state. Stage 2 STOPs on it before
      destruction, `E_rebuild = ∅` is an invariant that Stage 18 re-checks before mutation, and
      any rebuild supersede is a hard STOP.
    - **Promotion:** the post-swap replay supersedes exactly G2's AGREE list; a missing or extra
      supersede is a hard STOP.
  - **Authorisation.** S1–S7 are authorised (non-destructive).

  **P-M point 2 PROVEN (2026-09-24)** by operator-run live evidence against `afldb_test`
  (real `psql`/`RESET_SQL` path; runbook §11(d)2). S1, S2, S4–S7 implemented (uncommitted); **S3
  implemented 2026-09-24** (the combined capture format, the `AFLDB_REBUILD_CAPTURE_ROOT` root,
  the database marker, the generalised Stage 2 decision, the Stage 18 transaction order, and the
  Stage 19 combined invariant). Typecheck clean; DB-free/fake-transaction suites green
  (557/558 — the one failure is a pre-existing, unrelated gap in a DB-free import-reachability
  test's resolver). Nothing has been run against a real database this session.
- **Key files:** `tools/migration/rebuild_afl_api_adjudications.ts`,
  `tools/migration/replay_afl_api_adjudications.ts`, `src/lib/acquisition/afl-api-adjudication.ts`,
  `tools/db/promotion-check.ts`, `tools/db/rebuild-test.ts`.
  P-M points 1, 2 and 4 are proven; **point 3 is NOT proven**. The L1/L2 testability gaps are
  closed in code (2026-09-24, DB-free tested, NOT RUN):
  - the `code_test_db`-only rehearsal fixture
    (`npm run db:code-test:issue237-rehearsal -- seed|verify|teardown|residue`);
  - the deterministic `--rehearsal-stop-after recreate` halt;
  - a Stage 2 fix, so that `--recover` works on a reset database.

  The prepared commands are in runbook §11b.
- **Next action (2026-09-25):**
  - **Done:** L1/L2, R1, R2 and S6 (9/9) PASS. **R3 PASS** on the rerun under the OD-7
    continuity amendment: 802/802/802, 3/129/397/273 (hashes in runbook §11a.1).
  - **Continuity, reverse direction:** a continuity identity now resolves on a target only when
    both rule paths name the same single player; a split, missing or ambiguous path STOPs Stage 18,
    D15, R4 and promotion G2 alike (one shared classifier). DB-free tested only.
  - **R4 validate-only FAIL (correct):** 92 unresolved = exactly the ISSUE-224 cohort, dropped by
    the I18 rebuild (runbook §11a.2.1). This is not an R4 defect.
  - **Actor tool (DB-free tested, NOT live-run):** `npm run db:issue237:ensure-recovery-actor`
    creates or finds a disabled, credential-free `super_admin` attribution actor on
    `afldb_test` only (runbook §11a.2.2). `afldb_test` still has 0 `auth_users` rows.
  - ~~**Next:** the operator runs the actor tool, then re-registers the 92-player ISSUE-224 cohort
    with that `--admin-user-id`, then runs a fresh R4 validate-only.~~ *(Done 2026-09-25, below.)*
  - **R4 COMPLETE and R5 PASS (2026-09-25, operator-run, runbook §11a.2.3).**
    - The actor is id 144: `super_admin`, disabled, no credentials, recovery attribution only.
    - The 92 ISSUE-224 players are re-registered (13857–13948: CREATE 92, then ALREADY_SATISFIED
      92).
    - R4 ran validate-only, then dry-run, then apply. All three PASS: 802 inserted and committed,
      and post-commit parity and invariant PASS.
    - The independent re-run found 802 identical, 0 to insert.
    - **The 2026 matches and stats are NOT restored.** That is ISSUE-224/228 work, not an
      ISSUE-237 prerequisite.
  - **Remaining gates (runbook §11a.3) — historical; superseded by the 2026-09-25 L3 PASS update
    below:**
    - **L3** (the destructive `afldb_test` rebuild) — *(2026-09-25, before L3 ran: the ISSUE-245
      blocker was CLEARED. Its `code_test_db` rehearsal was PASS, runbook §11a.5, and the
      settle-afl-api integration rerun was PASS, 9/9, against the populated `afldb_test`. The
      exact guarded L3 operator sequence was written, runbook §11c. At the time that sequence was
      prepared, L3 had not yet run; it has since run and PASSED — see "Update (2026-09-25): L3
      PASS" below.)*
    - **L4 (DEV) and L5 (PROD)** follow L3, at scheduled promotions.
    - **Also open:** the S5 `docs/deployment.md` §6a update, S9 closure and the operator commit.
  - **Update (2026-09-25): L3 PASS (operator-run, runbook §11a.6).**
    - The real `afldb_test` rebuild carried 802 importer identities (3/129/397/273) and 92
      registrations across a real `players.id` renumbering (13857–13948 → 13272–13363).
    - Final validation passed 85 checks. The post-L3 source gate PASSED, the settle-afl-api
      filter was 9/9, and neither a marker nor a pending capture remains.
    - AFLDB-ISSUE-245 is RESOLVED.
    - §11c's DraftGuru label is corrected to `annual-html-20260826`.
    - **Gate state:** R1–R5, P-M, L1, L2 and L3 PASS; **L4 and L5 NOT RUN**.
  - **L4 is prepared, NOT run** (runbook §11d, source-derived). Three HIGH checker findings
    (§11d.0):
    - the G1 marker read is dead;
    - G2 is vacuous in the documented order;
    - `candidate`-phase G1 refuses a reinstated ledger.

    *(Historical, superseded by the L4 hardening update below.)* When found, these three defects
    confined L4 to a DEV `afl_api` ledger with zero rows. That temporary restriction ended when
    F-L4-1..3 were fixed: L4 now supports a non-empty DEV human ledger, subject to the repaired
    G2, `--phase candidate` and D15 contracts. L4 has still not run, and it is not currently
    executable end-to-end: it is expected to STOP at B4 until the manual-registration
    token-convergence prerequisite is resolved (see the final pre-commit review update below).
    The S5 §6a gap appears closed by the ISSUE-245 rewrite.
  - **Update (2026-09-25): L4 hardening, DB-free validated; L4 NOT RUN.**
    - F-L4-1..3 are fixed: the marker is read with `shobj_description`; G2 reads the candidate's
      importer rows against the TARGET ledger; `--phase candidate` verifies the reinstated
      ledger.
    - F-L4-4..6 are fixed: the `E_promotion` file is written only on PASS, is bound, and is
      verified again after the swap; a DEV regeneration generator is added; a documentation error
      is corrected.
    - Runbook §11d is rewritten and works with an empty or non-empty DEV ledger.
  - **Update (2026-09-25): L4 semantic blockers resolved in code, DB-free validated; L4 NOT RUN.**
    - **F-L4-8 (A4.2):** a new pre-swap gate predicts the `players` override replay. A DEV
      registration whose AFL Tables path the candidate holds under a **different** token is a
      STOP, as is every other unfaithful case.
    - **F-L4-9 (A4.3):** any active DEV `matches` / `match_coaches` override on a match the
      candidate lacks is a STOP. That includes every 2026 key, because no deferred replay exists.
    - **F-L4-10:** `--lineage-remap-out` is published only by a fully passing run, and the file
      is bound to its candidate.
    - §11d now has no operator decision left. If DEV holds a different-token registration, L4
      STOPs until a token-convergence follow-up (proposed, not allocated) exists. *(2026-09-25:
      allocated as **AFLDB-ISSUE-242**, the L4 prerequisite. B4 stays fail-closed until it is
      merged, and L4 is still NOT RUN.)*
  - **Update (2026-09-25): final pre-commit review of the whole diff (runbook §11d.11); L4 NOT
    RUN.** FR-1..7 are fixed, DB-free:
    - A4.2 predicts every players-replay refusal: name, casts, equal-authority conflicts, and the
      `players` CHECKs from id-keyed candidate columns.
    - **A candidate-only manual token is now a STOP. L4 therefore STOPs at B4 while `afldb_test`
      carries registrations that DEV does not hold under the same token.**
    - G2 collides by player as well as by identity.
    - An ungraded G3 row STOPs.
    - Rebuild `--recover` now covers a crash between Stage 17 and the registration replay.
    - The D15 exact-set check runs on an empty ledger.
    - There are zero ESLint errors on ISSUE-237 lines.
  - **Update (2026-09-25): first real L4 attempt STOPPED at A2 (DEV at `bfafed36`); L4 NOT RUN.**
    - All four promotion preflights FAILed, and nothing after A2 ran: no dump, candidate or swap.
    - The preflight prerequisite is **AFLDB-ISSUE-243**. Runbook §11d A2 now carries its
      `--promotion-side` commands.
  - **Update (2026-09-25): the second real L4 attempt STOPPED at A4.3; L4 NOT RUN** (runbook
    §11d.12).
    - **A3 PASS:** 802 rows (273/397/129/3), importer sha256 `e04a5776…98783b`, marker `<NULL>`.
    - A4.1 read 0/0 and A4.2 read 92/92.
    - **A4.3 STOP, `matches` = 1:** the orphaned, retained ISSUE-109 DEV fixture override.
    - No A5, backup, dump, candidate, plan or swap ran. The prerequisite is **AFLDB-ISSUE-246**.
  - **Update (2026-09-25): AFLDB-ISSUE-246 RESOLVED on live DEV evidence; the A4.3 blocker is
    cleared** (runbook §11d.13).
    - The orphan override is retired: `auth_audit_log` 983, and the rerun of A4.3 returned no
      rows. **A4.3 is now PASS.**
    - A3 remains PASS, A4.1 remains 0/0, and A4.2 remains 92/92.
    - No A5, promotion dump, candidate, plan or swap ran as part of ISSUE-246. **L4 remains NOT
      RUN.**
  - **Update (2026-09-25): L4 A5 REFUSED on two independent gates; L4 NOT RUN** (runbook §11d.14).
    - The AFL API census itself PASSED: 669 importer, 0 human resolved, 0 ledger, 0 net-linked.
    - **Gate 1 (ISSUE-151 staged rows):** `afl_api_identity_adjudications` 0
      (`brownlow_vote_entry_state` 3, `external_grid_sources` 1). The empty ledger is legitimate.
      Prerequisite: **AFLDB-ISSUE-247** (committed `86e0e2ba`, rehearsal PASS 7/7).
    - **Gate 2 (test-fixture identity):** three disabled reserved-domain `auth_users` rows
      (14, 17, 18) and one used, expired `admin_invites` row (5), with FK references limited to 8
      login/logout audit rows and 4 revoked sessions, all of user 18. Prerequisite:
      **AFLDB-ISSUE-248** (committed `a4f734af`).
    - Nothing past A5 ran: no backup, dump, candidate, plan or swap.
  - **Update (2026-09-26): the post-merge L4 (ISSUE-247/248 at `397f422d`) reached the post-swap
    phase and was ROLLED BACK.** The promoted candidate held first-kick-goal 0 against DEV's 335 /
    334 → **AFLDB-ISSUE-249** (rebuild never loaded the family; no gate read it). `afldb_dev` is
    restored; `afldb_dev_candidate_20260926-033212` is retained. **L4 is NOT COMPLETE.** The next L4
    needs ISSUE-249 deployed and `afldb_test` reloaded (ISSUE-249 runbook §7). *(Superseded by the
    update below.)*
  - **Update (2026-09-26): L4 PASS (operator-run). AFLDB-ISSUE-249 is RESOLVED** (deployed at
    `6ae70722`), and the fresh L4 run (promotion stamp `20260926-085511`) is the first accepted DEV
    promotion under this issue.
    - The rebuild-owned first-kick-goal source gate PASSED (334/334 manifest identities) before the
      candidate was built.
    - Candidate/pre-swap/post-swap gates A–C passed after the ISSUE-249 fix. **G3 found exactly one
      classified DEV-regenerable hard loss**, `CD_I297354` (class `afl_api_stat_vector_season`,
      stable identity `players/K/Karl_Amon.html`); `E_promotion` was empty.
    - The DEV §6.3 exception was exercised for real: a fresh §9 current-season re-acquisition
      (AFL Tables + AFL API, `settle-2026-2026-09-26-0941`, batch 86, 0 refusals/failures), a fresh
      target-bound DEV bridge emitter (669/669 providers linked, 0 unresolved/contradictory), and
      the loader's validate-only → dry-run → apply sequence, which regenerated exactly that one row.
    - The mandatory `dev-regeneration-census` PASSED (`CD_I297354: PASS`), and final health is
      `{"status":"ok"}`.
    - The promoted `afldb_dev` (stamp `20260926-085511`) holds first-kick-goal 335 total: 334
      `wikipedia_first_kick_goal` (source-owned, reconstructed) + 1 `manual_admin_edit` (the ISSUE-167
      row, recreated by the post-swap replay). Retained evidence, not touched:
      `afldb_dev_pre_rebuild_20260926-085511`, `afldb_dev_candidate_20260926-033212` (the earlier
      failed candidate).
    - **L4 is PASS.** ISSUE-237 remains OPEN: **L5 PROD is NOT RUN**, and this DEV-only exception
      does not apply to production, where G3 hard loss is FAIL with no exception.
  - **Next action:** L5, inside a future scheduled production promotion, under production's
    unmodified G3 hard-loss rule (FAIL, no DEV-style exception). Runbook §11d.15 has the full L4
    record.
  - **Not authorised:** no production promotion or PROD mutation without separate, scheduled
    authorisation.

### AFLDB-ISSUE-234 — Optional AFL API feed expansion (extended statistics, umpires, play-by-play)
- **Severity:** Low. **Area:** data acquisition, investigation only.
- **State:** Open (2026-09-23), ISSUE-228 S10 successor. Optional; not required by the supported
  ISSUE-228 architecture.
- **Next action:** none scheduled; investigate when a product need arises.

### AFLDB-ISSUE-233 — AFL API season discovery and season rollover ownership
- **Severity:** Medium. **Area:** season lifecycle — `data/reference/afl-api-identities.json`, the
  rollover runbook, `stat-availability.json`.
- **State:** Open (2026-09-23), ISSUE-228 S10 successor. Replaces resolved ISSUE-101/F as owner of
  the rollover runbook change (Q7 wording, AFL API Brownlow season-totals artefact load).
- **Next action:** review the rollover runbook against ISSUE-228 runbook §17/§19.3; plan
  proposal-only season discovery (§13.4).

### AFLDB-ISSUE-232 — AFL API operational wiring: systemd timers, Brownlow scheduled settle and admin status
- **Severity:** Medium. **Area:** deployment / operations — `deploy/afldb-settle-afl-api*`,
  `src/lib/acquisition/settle-status.ts`, `settle-trigger.ts`, `/admin/current-season`.
- **State:** Open (2026-09-23). Units ship and pass `sh -n` + DEV dry-run; not installed on any host.
  `deploy/afldb-settle-afl-api-brownlow.sh` omits `--use-fixture-identity`, intentionally
  fail-closed (ISSUE-244 §40); supplying it is likely correct for AFL Tables-owned fixtures
  (ISSUE-228 runbook §22.20 B). Also owns match-before-Brownlow ordering, the admin unit status, and
  the optional automatic `revalidateSeason()` after an AFL API settle.
- **Next action:** operator decides the wrapper flag (a reversal of ISSUE-244 §40), then a DEV
  wiring pass proven by `sh -n` + DEV `--dry-run` of the chain.

### AFLDB-ISSUE-231 — AFL API source-integrity hardening: retired-identity rekey and match-family absence sweep
- **Severity:** Low. **Area:** settle — `afl_api` resolver (`NO_MATCH_REKEY_SCOPE`),
  `AflApiSettleBundle`.
- **State:** Open (2026-09-23), the two S6 residuals. Hardening, not known canonical-data
  corruption: both fail safely, and 0 `afl_api`-owned matches exist today.
- **Next action:** schedule when `afl_api` owns canonical matches; design the season-enumeration
  completeness carrier first.

### AFLDB-ISSUE-229 — AFL API fixture ingestion
- **Severity:** Medium. **Area:** acquisition / fixtures — `afl_api` season feed → `fixtures`,
  `canonical_applications`, `admin-fixtures.ts`.
- **State:** Open (2026-09-23). Reserved by the ISSUE-228 plan (§13), now opened. Fixture
  ingestion only.
- **Next action:** plan against ISSUE-228 runbook §13; capture pre-match payloads to fix the status
  vocabulary first.

### AFLDB-ISSUE-230 — `afldb_test` 2026 AFL Tables spine carries 2099 observation timestamps from the 2026-09-06 settle benchmark
- **Severity:** Low. **Area:** test database hygiene: `afldb_test` `staging.source_records`.
- **State:** Open (2026-09-23). A real-clock `settle-afltables.ts` touching any 2026 key on
  `afldb_test` refuses on `source_records_seen_ck`. Under ISSUE-228 S9 the operator authorised
  continuing the 2099 lineage there only (batches 2421/2422, up to 2099-01-06). It is not repaired.
  DEV and PROD are unaffected. It did not block ISSUE-228 S9, which was accepted 2026-09-23.
- **Next action:** pick a reviewed `afldb_test`-only re-stamp or a real-clock rebuild of the 2026
  lineage. S9 is now accepted, so either may be scheduled.

### AFLDB-ISSUE-226 — Stale `docs/architecture.md` §5/§6: documented application structure names `src/services/`, `src/db/schema/` (Drizzle) and `src/types/`, none of which exist
- **Severity:** Low. **Area:** documentation — `docs/architecture.md` §5 "Application structure",
  §6 "Shared statistical definitions".
- **State:** Open (2026-09-19). Found during the closure review of PhanesLight bootstrap commit
  `a59917a4`. Verified three ways against the tracked tree: `git ls-files src` returns exactly
  `app`, `components`, `db`, `lib`, `search`, `styles`, `middleware.ts` (no `services`, no
  `types`); `git ls-files src/db` returns exactly `authClient.ts`, `client.ts`, `migrations`,
  `queries` (no `schema/`); `package.json` carries no Drizzle dependency — PostgreSQL is accessed
  through `postgres` 3.4.9 (postgres.js) directly, and nothing imports `@/services` or `@/types`.
  Documentation only: no application, query, data or deployment behaviour affected, and
  `CLAUDE.md` §6's repository map (what agent routing actually reads) is correct and unaffected.
  Deliberately not corrected under the bootstrap — out of its scope.
- **Key files:** `docs/architecture.md` §5, §6.
- **Next action:** correct §5's directory tree and drop the Drizzle reference. Then **establish
  where the §6 shared statistical definitions actually live** before rewriting that claim — this
  issue asserts only that they are not in `src/services/`, and does not assert where they are.

### AFLDB-ISSUE-220 — Web service credential boundary contradicts the application's `afldb_import` requirement; owner-role code-test DSN and a complete `.env` copy reach the internet-facing process
- **Severity:** High. **Area:** deployment / runtime security.
- **State:** Open (2026-09-17). Implemented in worktree `afldb-issue-220` (Sonnet 5, uncommitted),
  pending operator DEV/PROD verification. §4b established: `writeStandaloneDirectory` in the
  installed Next 16.3.1's own `next/dist/build/index.js` copies `.env`/`.env.production` into
  `.next/standalone/` unconditionally, in a hardcoded loop with no `next.config.ts` knob to
  suppress it — `next.config.ts` correctly left untouched. `deploy/afldb.service` now unsets
  `AFLDB_OWNER_DATABASE_URL AFLDB_TEST_DATABASE_URL AFLDB_TEST_IMPORT_DATABASE_URL
  AFLDB_TEST_AUTH_DATABASE_URL AFLDB_CODE_TEST_DATABASE_URL AFLDB_CODE_TEST_IMPORT_DATABASE_URL
  AFLDB_BACKUP_DATABASE_URL AFLDB_PROD_DATABASE_URL` and keeps exactly `DATABASE_URL`,
  `AFLDB_AUTH_DATABASE_URL`, `AFLDB_IMPORT_DATABASE_URL`; `tools/build/prepare-standalone.mjs`
  now deletes any `.env*` under the standalone tree and fails the build if one survives; new
  `tests/deploy-web-unit.test.ts` derives the full DSN name set from `.env.example` (found
  `docs/deployment.md`'s §9 table was itself missing 5 real DSN names — completed it rather than
  deriving from the incomplete table, see `issues.md` Implementation section). PROD still not
  inspected.
- **Runbook:** `issues/open/AFLDB-ISSUE-220.md` (relocated from the repository root 2026-09-19;
  the `afldb-issue-220` worktree still holds its uncommitted copy at the old root path).
- **Key files:** `deploy/afldb.service`, `docs/deployment.md` §9, `tools/build/prepare-standalone.mjs`,
  `tools/build/env-in-standalone.mjs` (new), `tests/deploy-web-unit.test.ts` (new).
- **Local validation (2026-09-17):** `vitest run tests/deploy-web-unit.test.ts` **15/15 passed**;
  `tsc --noEmit` **clean**. DEV/PROD not yet run.
- **Next action:** operator runs the Git/DEV rollout (commit → `merge:ready` → push/merge → `sync-dev.ps1`
  build → manual unit reinstall + restart → names-only checks + Admin Centre write/revert), then PROD
  read-only checks. Resolve only once DEV steps 1–5 and PROD steps 2–3/6 (runbook §8/§9) pass.

### AFLDB-ISSUE-225 — Gridley corpus: 37 pre-existing `incorrect known answer` cells on non-draft criteria, present on `afldb_test` before AFLDB-ISSUE-222 and untouched by it
- **Severity:** Medium. **Area:** Grid Solver / canonical data — `captaincies`,
  `player_club_season_stats`, club lineage; `tests/integration/gridley-corpus.test.ts`.
- **State:** Open (2026-09-19, ISSUE-222 decision D3). 37 cells, all "Gridley lists, AFLDB
  omits", identical in the 2026-09-17 pre-import run and the 2026-09-19 run (report
  `7f14ff2c…`): `captain` 20 (Cameron Bruce 2489 ×11, Steven May 12093 ×9), `teammates-150` 14
  (ten players, board #1024), `teammates-100` 1 (Angus Brayshaw 669), `games250sameclub` 1
  (David Swallow 3581), `games100clubs2` 1 (Dylan Shiel 4006). ISSUE-118 closed at 0; the cells
  arrived with the 2026-09-13 `afldb_test` baseline. Root cause not investigated; not a draft
  matter.
- **Key files:** `src/db/queries/grid-solver.ts` (`club_captain_any`, `career_teammates_min`,
  `games_at_*_incl_merged`), `captaincies`, `player_club_season_stats`, the corpus suite.
- **Next action:** targeted read-only queries on `afldb_test` (captaincies rows for 2489/12093;
  teammate recounts for the board-1024/993 players; lineage for 3581/4006), then classify each
  cell from canonical evidence — never by a blanket exception.

**AFLDB-ISSUE-221 resolved 2026-09-18** (implemented 2026-09-17 by Fable 5.1; committed, merged
and DEV-verified 2026-09-18 by Sonnet 5) — Grid Solver draft-criteria review: honest "No data"
squares for an axis matching nobody, `draft_type_is` reads `draft_kind`, trade/free-agency rows
excluded from the three "drafted" builders, Gridley `fatherson` remapped to
`father_son_selection`, bounded numeric parameters with a per-square "Invalid value", the form
keyed by the board token so Reset resets, two stale `is_final` test oracles corrected. Committed
`f1a8daca`, merged to `main` at `159518ec`, deployed to DEV (`sync-dev.ps1 -RemoteRef main`,
revision `159518e`; found and corrected the DEV host's Git checkout sitting on a stale `dev`
branch, fast-forwarded 62 commits including AFLDB-ISSUE-220 and the NL-search chain
AFLDB-ISSUE-204–219 that had not reached DEV via this path before). All four required DEV browser
checks plus a valid non-draft answer check passed in a real authenticated `super_admin` session
via Playwright MCP (the operator signed in directly; the audience gate was not bypassed). The
reported symptom's root cause (draft-pick linkage, 5 of 6,810) is unfixed by design and now
tracked as **AFLDB-ISSUE-222** (draft runbook, awaiting operator approval). See `issues.md` for
the full record.

**AFLDB-ISSUE-222 resolved 2026-09-19** (executed across 2026-09-18/19 by Sonnet 5/Opus 5/Fable
5.1, operator-run on `afldb_test`/`afldb_dev`; deployed at commit `19eb40c0`) — the DraftGuru
person-page bridge is complete on both `afldb_test` (3,470 linked persons, 5,115/6,810 picks,
75.11%, Gridley-proven: `incorrect known answer` 99 → 37, zero draft-criterion cells) and
`afldb_dev` (real fail-closed `--link-only` import, committed and twice independently verified,
`summary_sha256 6a89a1ba…`, identical figures). Build `uKIChkbyo_-A3PMi40aFi` (1,516 static pages,
102/102 migrations); DEV health `status=ok, database=ok, latencyMs=16`. Browser-verified: the
AFLDB-ISSUE-221 Grid Solver draft-axis regression is resolved on DEV, `/admin/draft` renders all
6,810 selections, and both linked and unlinked draft selections render correctly. An operational
environment-truncation incident during DEV diagnosis (an unsafe inline PowerShell/SSH command
truncated `.env` to 17 bytes) was recorded transparently, fully recovered from live process state
plus freshly rotated credentials, and followed by a fresh independently verified DEV backup
(parity 9/9). The 1,587 remaining unmatched persons (AFLDB-ISSUE-224) and manual link-approval/
pick-creation mutation checks (out of scope) are **not** claimed resolved by this closure.
AFLDB-ISSUE-223/224/225 remain open, untouched. Full record: `AFLDB-ISSUE-222.md` §11.19.22,
`issues.md`'s *Resolution (2026-09-19)*.

**Fable code review outside NL search — 2026-09-17 (Fable 5.1, review and planning only).**
Reviewed with native inspection: authentication/session/middleware/capabilities and every auth
Server Action (no defect); the admin `*-actions.ts` files the 2026-09-15 mutation audit's glob did
not match, content publish/upload, settle trigger, and the public writers (no defect); all seven
route handlers and every `sql.unsafe` sink traced to a module allowlist (no defect); the tracked
deploy units, cluster entry point, both Caddyfiles, settle chain, build wrapper, DB clients
(**AFLDB-ISSUE-220** opened). Not reviewed: `deploy/sync-dev.ps1` body, `tools/maintenance/*`,
migrations, the admin action modules already covered by the 2026-09-15 audit,
`tools/email_intake/`, page components beyond their query allowlists, `src/db/queries/admin-users.ts`.
Residual, no new ID: `/api/admin/email-intake` still admits `contributor` senders — deferred under
resolved AFLDB-ISSUE-186 Phase B. No project-wide PASS is claimed.

**Fable NL code review — FINAL: PASS (2026-09-17, Fable 5.1, operator-validated on streamanator).**
Lineage: Stage 1 found eight defects (F1–F8) → Stage 2 confirmed them as AFLDB-ISSUE-187..192,
hardening added 193..196, the corpus audit's 40 genuine fail-open rows became 197 (all resolved
2026-09-15/16) → the 168 stale `AMBIGUITY_NOT_DETECTED` expectations (112 team-streak + 56
coach-record, plus 5 Ablett = 173) were corrected under AFLDB-ISSUE-199, then V3/V4/V5 under
201/204/205 → 198..219 hardened further to parser v66. This acceptance pass re-verified every
187..197 fix in the current tree (not from issue status), confirmed the AFLDB-ISSUE-197 family
contract (complete candidates via `resolvePlayerFamily`, 2–12 ranks, >12 declines and is
reachable, direct resolution distinct), and reran the frozen V5 corpus parse+execute on v66:
11997/0/3. The three failures (`verified_finals_without_premiership`, rows 41–43) were adjudicated
`STALE/INVALID EXPECTATION` from current canonical data (Dane Rampe and Nick Dal Santo genuinely
tied at 24 finals, 0 premierships, nobody else at 24) and corrected V5 → V6 by the new fail-closed
script `tools/nl/fix-stale-finals-without-premiership-tie.ts` (3/3 targets, 0 non-targets).
**Final V6: 12000/12000 clean / 0 soft / 0 failed / 0 errors.** V6 is now the stable baseline. No
new issue opened; no production code changed. Volatility note: Rampe is active mid-2026-finals, so
another final would re-stale rows 41–43 honestly (see the script header / `issues.md` ISSUE-219).

**AFLDB-ISSUE-219 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) —
cross-family NL defect: a plural club/venue alias already ending in "s" takes a bare trailing
apostrophe for its possessive ("Bombers'", "Dogs'", "Lions'", the AFLDB-ISSUE-214 §10c residual's
"Suns'"/"Pies'"/"Bulldogs'"), which `canonicalise()`'s existing `'s\b` strip
(`src/search/nl/vocab.ts`) never matched (it requires a literal "s" after the apostrophe).
Club/venue matching itself already resolved these aliases correctly via word-boundary regexes;
only the final leftover-token comparison in `parseNlQuestion` (`src/search/nl/parser.ts`) ever
disagreed, because `meaningfulTokens`' whitespace split kept the apostrophe attached to the word
while the matched/consumed span did not. Confirmed a shared `canonicalise()` defect, not a
per-builder one, by tracing `tools/nl/generate-exploratory-corpus-v2.mjs`'s `possessive()` helper
(line 178) across five families: `team_match_result`, `team_checkpoint_collision`,
`q3_comeback_near_miss`, `club_season_rank` (the ISSUE-214 residual) and `team_streak`. Fixed with
one new generic trailing-apostrophe strip in `canonicalise()`, mirroring the existing `'s` rule
rather than special-casing any club — no apostrophe made globally ignorable (only a trailing one
immediately before whitespace/end-of-string; a mid-word apostrophe like `o'brien` is untouched).
`PARSER_VERSION` 65 → 66 (baseline corrected during reconciliation with `AFLDB-ISSUE-218`, which
already holds 64 → 65 on `dev`). `AFLDB-ISSUE-218` (below) **independently found and deliberately
deferred the identical defect** for its own `team_match_result/0` cluster (56 rows,
"Bombers'"/"Dogs'"/"Brisbane Lions'"), naming this exact cross-family issue as its recorded
follow-up candidate — confirming this issue's root-cause finding a second, independent way,
alongside AFLDB-ISSUE-214 §10c. Local: `tests/nl-parser.test.ts` **605/605**, broader gates
**402/402**, `typecheck` clean. **Host validation (streamanator):** no established mechanism
existed to transport uncommitted code to a host, so a temporary, isolated `git worktree`
(`/home/arm/nl-issue219-validation`, off `origin/dev` at `a98c3e42`) was created and a `git diff`
patch applied — a clean `git apply --check` itself served as the identity proof;
`/home/arm/projects/afldb` and the retained git stash were never touched, and the temp worktree
was removed after validation. Host suites reconfirmed 605/605 + 402/402 + clean typecheck.
Exploratory V2 (29,030 rows, the AFLDB-ISSUE-218-corrected corpus) moved **20512 → 20876 clean**
(+364 / -364 soft / 0 failed), reconciling exactly across five families (`club_season_rank` 210,
`team_streak` 75, `team_match_result` 56, `team_checkpoint_collision` 16,
`q3_comeback_near_miss` 7) — every one of the 364 improved rows confirmed to carry a
trailing-apostrophe alias, zero that don't. The frozen V1/"V5" corpus's three failing rows (a
stale `verified_finals_without_premiership` fact check, Nick Dal Santo → Dane Rampe tie count)
were proven via a decisive v65-vs-v66 control against the same current database to be pre-existing
data drift, **not** a regression — flagged as a stale-corpus-expectation candidate, not opened as
its own issue in this closeout. See `issues.md` and `AFLDB-ISSUE-219.md` §14 for the full record.

**AFLDB-ISSUE-218 resolved 2026-09-17** (Sonnet 5, operator-validated on
streamanator across two host-validation rounds) — `team_match_result/1` (522
rows, "at V, find the widest X win/loss to Y...") and `/2` (569 rows, "by how
much did X lose to Y in their most lopsided meeting...") shared one
wrapper-vocabulary-only mechanism (both already extracted clubs/direction
correctly); fixed with additive vocabulary only (`widest` in `AGG_WORDS`, a
leading scope-clause request-verb strip widened to `at` as well as `for`,
verb forms `lose`/`lost`/`beat` in `TEAM_METRIC_WORDS`, two narrowly-gated
wrapper consumers for "how much"/"lopsided meeting"), no grain-election or
club-role logic touched, `PARSER_VERSION` 64 → 65. Round-1 host validation
(commit `5bcc957`) found V5 green and `/1` fully cleared (522→0), but exposed
`/2` moving from an honest soft decline into a 569-row HARD FAILURE — worse
than the pre-fix state — so the issue was reopened rather than closed.
Re-investigation traced production SQL (`src/db/queries/nl/team-match.ts`'s
clubFor-relative `win_margin`/`loss_margin`) and the parser's pre-existing,
uniformly-applied `clubFor`=subject convention against every pre-issue
directional test, then found and confirmed (empirically, 0 mismatches across
every affected row) a genuine, isolated **exploratory V2 generator/oracle
defect**: `team_match_result`'s templates 0/1/3 all keep club `c` as the
sentence's grammatical subject, but template 2 alone renders `o` as subject
and `c` as object without a corresponding fix to its expected `club`/
`opponent`/`metric` triple. Parser v65 was confirmed correct and untouched;
only the generator's template-2 expectation construction was corrected
(commit `6ed227d`), `PARSER_VERSION` staying at 65 (corpus-only correction).
Round-2 host validation confirmed **0 failed**: frozen V5 stayed
12000/12000/0/0; exploratory V2 moved v64 baseline (19421 clean/8109
soft/0 failed) → v65-corrected (20512 clean/7018 soft/0 failed), net
**+1091 clean/-1091 soft/0 failed**, reconciling exactly to `522 + 569 =
1091`; a determinism/isolation diff confirmed 0 question-text/row-id changes
anywhere in the 29,030-row corpus, with all 569 changed rows confined to
`team_match_result/2`'s own expectation columns. `team_match_result/0` (56
rows, "Bombers'"/"Dogs'"/"Brisbane Lions'" possessive aliases) remains
unchanged at 56 honest declines throughout both rounds — a distinct,
already-known trailing-apostrophe plural possessive-alias defect (the same
mechanism AFLDB-ISSUE-214 already found and left unfixed for
`club_season_rank`), deliberately deferred as a future cross-family issue
candidate, not opened as its own tracked issue in this closeout.
Implementation commits `5bcc957` (parser) and `6ed227d` (exploratory oracle
correction) on `sonnet/issue-218-team-match-result-phrasing`, unmerged.
Local: `tests/nl-parser.test.ts` 595/595, broader gates (`nl-regression-corpus`
163/163, `nl-semantic-mapping` 174/174, `nl-stress-corpus` 65/65 = 402/402),
`typecheck` clean. See `issues.md` and `AFLDB-ISSUE-218.md` for the full
record.

**AFLDB-ISSUE-217 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) —
`player_game_single`'s three large exploratory clusters (`/0` 423 rows "biggest `<metric>` haul in one
match", `/4` 422 rows "peak single-game `<metric>`", `/3` 409 rows "which match saw `<player>` collect
the most `<metric>`", combined 1254 rows) share ONE root mechanism, not three, and it is NOT grain/mode
misrouting — a named player's per-game stat already defaults correctly to `grain='player_game',
mode='single'`. The defect was in `candidatePlayerSpan` (`src/search/nl/parser.ts`): it greedily takes
the first four remaining non-stopword alpha tokens with no notion of "stop at a non-name word", so
unconsumed wrapper vocabulary ("haul", "peak"/"single-game", "match"/"saw"/"collect" — none had any
vocabulary entry) got swept into the player-name candidate alongside the real name (e.g. "dustin martin
haul"), which then failed player resolution outright — the polluted span is exactly the reported
`unsupported_term`. The adjacent `player_game_scope_collision/3` (555 rows, "single-match `<metric>`
record for...") was inspected and confirmed to share the identical mechanism (bare "single-match" always
sat immediately before the player name) and was included. Fixed with one generic `IN_ONE_GAME` extension
(bare "single-game"/"single-match" adjective, not only "in ... game/match") plus three new gated
wrapper-word consumers (`WHICH_MATCH_SAW_RE`, `PLAYER_GAME_SINGLE_HAUL_RE`, `PLAYER_GAME_SINGLE_PEAK_RE`)
— no player, club, venue, or metric special-cased. `PARSER_VERSION` 63 → 64. Implementation commit
`879b0e1` ("Fix player game single match phrasing"),
`sonnet/issue-217-player-game-single-phrasing`, unmerged. Local: `tests/nl-parser.test.ts` 575/575 (554 +
21 new), broader gates (`nl-regression-corpus` 163/163, `nl-semantic-mapping` 174/174, `nl-stress-corpus`
65/65 = 402/402), `typecheck` clean. Host validation (streamanator, commit `879b0e1`): frozen V5 stayed
**12000/12000/0/0**; exploratory V2 moved **17612 → 19421 clean (+1809)**, **9918 → 8109 soft (-1809)**,
0 failed throughout. All four target clusters fully cleared: `player_game_single/0` 423 → 0, `/4` 422 →
0, `/3` 409 → 0, `player_game_scope_collision/3` 555 → 0. A direct 29,030-row plan-level comparison (v63
vs. v64) found exactly **1809 changed plans, 0 missing rows**, reconciling exactly to the four target
clusters, zero unrelated movement. A separate, pre-existing `WRONG_PLAYER` scorer-identity artifact (the
already-tracked Gary Ablett Jnr/Snr display-name mismatch from AFLDB-ISSUE-206/210) remains present
across several rows in the affected template families, confirmed independent of this fix and left
untouched. See `issues.md` and `AFLDB-ISSUE-217.md` for the full record.

**AFLDB-ISSUE-216 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) —
`player_season_leaderboard`'s two exploratory clusters (`/0` 576 rows "posted the highest season tally
of `<stat>` for `<club>` `<time>`", `/3` 559 rows "the best seasonal `<stat>` total `<time>`") do NOT
share one root mechanism: both left "posted"/"season"/"tally"/"seasonal" unconsumed as leftover wrapper
vocabulary (shared gap), but `/3` additionally carried an independent grain-election defect — its own
"total" collided with the generic `AGGREGATE_TOTAL_WORDS` scoped-running-total cue and silently
misrouted the unnamed-player question to `player_game`/`sum` instead of `player_season`. Fixed with
three new gated vocabulary entries (`PLAYER_SEASON_LEADERBOARD_TALLY_RE`,
`PLAYER_SEASON_LEADERBOARD_SEASONAL_RE`, `PLAYER_SEASON_LEADERBOARD_POSTED_RE`, all gated on an actual
player-stat `METRIC_WORDS` match) plus a narrow `playerSeasonLeaderboardCue` override on the
`aggregateTotal` grain-election guard — no club, player, or metric special-cased. `PARSER_VERSION` 62 →
63. Implementation commit `8de4a96` ("Fix player season leaderboard phrasing"),
`sonnet/issue-216-player-season-leaderboard-phrasing`, unmerged. Local: `tests/nl-parser.test.ts`
554/554 (541 + 13 new), broader gates (`nl-regression-corpus` 163/163, `nl-semantic-mapping` 174/174,
`nl-stress-corpus` 65/65 = 402/402), `typecheck` clean. Host validation (streamanator, commit `8de4a96`):
frozen V5 stayed **12000/12000/0/0**; exploratory V2 moved **16477 → 17612 clean (+1135)**, **11053 →
9918 soft (-1135)**, 0 failed throughout. Both target clusters fully cleared: `/0` 576 → 0, `/3` 559 → 0.
A direct 29,030-row plan-level comparison (v62 vs. v63) found exactly **1135 changed plans, 0 missing
rows**, all in the target family, zero unrelated movement. See `issues.md` and `AFLDB-ISSUE-216.md` for
the full record.

**AFLDB-ISSUE-215 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator, two
host-validation rounds) — `career_numeric_binding`'s two exploratory clusters (`/3` 700 rows "for CLUB,
find players with A plus B", `/2` 552 rows "who has the most career S among players with A and B") do
NOT share one root mechanism — `/3` is a pure wrapper-vocabulary gap ("find" behind a leading "for"
clause, "plus" as an unrecognised conjunction); `/2` shares that gap ("among") plus an independent,
genuine predicate-loss defect (a stat word's earliest occurrence was the only one ever tried, silently
dropping a same-column condition stated after the ranking mention). Both fixed; `PARSER_VERSION` 61 →
62. Round-1 host validation (commit `5eca839`): frozen V5 stayed 12000/12000/0/0; `/2` fully fixed
(552 → 0); `/3` split into 491 `coverage_unavailable` and 209 `unsupported_term: plus`. The 491 were
investigated and classified a **legitimate, currently-real coverage limitation, not a parser/guard
defect** — `conditionSql` (`src/db/queries/nl/player-career.ts`) has no per-club SQL path for any
career condition column except `games`, and `validatePlan`'s club-scoped-career-condition guard
(`src/search/nl/plan.ts`) correctly fails closed rather than silently answer with a whole-career total
— guard NOT weakened, no corpus/scorer file touched, recorded as a future SQL-compiler capability
candidate (see `AFLDB-ISSUE-215.md` §11, §15). The 209 were a second, residual "plus" ownership gap in
`extractCareerConditions` — a 20-character clause-boundary lookback too short for a long comparator
phrase like "no more than " (widened to 40, proven safe by a new three-clause regression control), and
the "no X" negative-condition loop never checking for a neighbouring "plus" — fixed the same session
under the same `PARSER_VERSION` 62 (a correction, not a new semantic feature). Round-2 host validation
(commit `6a341fd`) confirmed the fix: frozen V5 stayed 12000/12000/0/0 again; `career_numeric_binding/3`
final triage is 700 `coverage_unavailable` / 0 `unsupported_term` — **all 700 `/3` rows now produce
structurally valid plans**; a direct round-1-vs-round-2 plan comparison found exactly 209 changed
plans, 0 missing, zero unrelated movement. Implementation commits `5eca839` and `6a341fd` on
`sonnet/issue-215-career-numeric-binding-phrasing`, unmerged. Local: `tests/nl-parser.test.ts`
540/540, broader gates (`nl-regression-corpus` 163/163, `nl-semantic-mapping` 174/174,
`nl-stress-corpus` 65/65 = 402/402), `typecheck` clean. See `issues.md` and `AFLDB-ISSUE-215.md` for
the full record.

**AFLDB-ISSUE-214 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — `club_season_rank`'s "what season had the highest/lowest `<metric>`" and "`<club>`'s highest/lowest seasonal `<metric>`" phrasings declined with `unsupported_term: season`/`seasonal`: neither word was ever consumed by any extractor, so it survived as a leftover token even when the surrounding club-season construction was otherwise fully understood. Confirmed both failing clusters (`club_season_rank/1`, `club_season_rank/3`) are two English phrasings of one already-supported semantic construction, not two mechanisms. Fixed with two new gated vocabulary entries (`CLUB_SEASON_RANK_SEASON_CUE_RE`, `CLUB_SEASON_SEASONAL_ADJECTIVE_RE`) folded into the existing `clubSeasonCuePresent`/single-season-guard logic — no club name, corpus ID, or exact sample string special-cased. `PARSER_VERSION` 60 → 61. Implementation commit `731edd8` on `sonnet/issue-214-club-season-rank-phrasing`, unmerged. Local: `tests/nl-parser.test.ts` 519/519, broader gates (`nl-regression-corpus` 163/163, `nl-semantic-mapping` 174/174, `nl-stress-corpus` 65/65 = 402/402), `typecheck` clean. Operator-validated on streamanator: frozen V5 stayed **12000/12000/0/0**; exploratory V2 moved **14879 → 15925 clean (+1046)**, **12651 → 11605 soft (-1046)**, 0 failed throughout. The full `club_season_rank/3` cluster (642 rows) cleared; 404 of 614 `club_season_rank/1` rows cleared, 210 remaining on a separate, pre-existing possessive-club-alias defect (`Suns'`/`Pies'`/`Bulldogs'`) deliberately **not folded into this issue and not opened as its own tracked issue** — recorded as a follow-up candidate only. A direct 29,030-row plan-level comparison (v60 vs. v61) found exactly **1046 changed plans, 0 missing rows**, all in the target family, zero unrelated movement. See `issues.md` and `AFLDB-ISSUE-214.md` for the full record.

**AFLDB-ISSUE-213 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — a pre-existing
`extractClubs` defect (`src/search/nl/parser.ts`) exposed by, not caused by, ISSUE-212's corrected
exploratory V2 oracle. `phrasePosition`/`phraseEnd` re-found a matched club's position with a bare
first-match `\b<name>\b` search of the whole original question, so a shorter club's name embedded,
word-bounded, inside a longer club's own name ("Melbourne" inside "North Melbourne") silently rebound
onto the longer club's own span instead of the real, later standalone mention — the computed gap
between the two clubs came out empty, the `versus`/`vs`/`v` separator was never recognised, and
`scope.matchup` never formed for wording like "North Melbourne versus Melbourne" (confirmed row
`#20609919`), falling back to directional `clubFor`/`clubAgainst` instead. Fixed with a new
`firstUnclaimedOccurrence` helper that excludes spans an earlier club match in the same call has
already claimed, generic across any overlapping-name pair — no club special-cased. `PARSER_VERSION`
59 → 60. `Port Adelaide`/`Adelaide` and `Greater Western Sydney`/`Sydney` confirmed to reproduce the
identical mechanism, first by source trace and then empirically by the host plan diff (see below). One
pre-existing negative-control test needed a fixture-only swap (`sydney derby` → `western derby`) after
this issue's new `Sydney`/`Melbourne`/`North Melbourne` fixtures invalidated its "absent club"
assumption — not a parser regression, no production code touched for that correction. Implementation
commit `4f0be951` on `sonnet/issue-213-overlapping-club-matchup`, unmerged. Local: `tests/nl-parser.test.ts`
509/509, broader gates (`nl-regression-corpus` 163/163, `nl-semantic-mapping` 174/174, `nl-stress-corpus`
65/65 = 402/402), `typecheck` clean. Operator-validated on streamanator: frozen V5 stayed
**12000/12000/0/0**; exploratory V2 moved **1 → 0** hard failures (row `#20609919` confirmed clean); a
direct 29,030-row plan-level reconciliation (v59 vs. v60) found **exactly 1 changed plan**, the known
row, with **zero unrelated changes** elsewhere in the corpus. See `issues.md` and
`AFLDB-ISSUE-213.md` for the full record.

**AFLDB-ISSUE-212 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — follow-on item
(4) of `AFLDB-ISSUE-206.md`'s six proposals: corrected the exploratory NL corpus/scorer's three
confirmed V1 oracle defects (496-row symmetric "versus" matchup, 283-row achievement-summary
aggregation, 351-row Gary Ablett Jnr/Snr identity, all at parser v54) in a new versioned
`tools/nl/generate-exploratory-corpus-v2.mjs` + `tools/nl/corpus.ts` scorer contract. Not a
parser-feature issue: `PARSER_VERSION` unchanged at 59, no `src/search/nl/{parser,vocab,
semantic-intents}.ts` file touched. Operator-validated on streamanator: V2 (29,030 rows, seed
`2060542026`, SHA256 `bb75e4b5067942117c60f8eab6cfd01de4d8fc1e0c4fee07e10650fae97edb4a`, deterministic
replay confirmed, V5 exact/normalized overlap 0/0, 1,500 audit-required) scored against parser v59:
**27530 scored / 14878 clean / 12651 soft / 1 failed**; the frozen V1 12,000-row corpus stayed
**12000/12000/0/0** under the updated scorer, no regression. A same-corpus, same-parser (v59)
reconciliation of the pre- vs. post-ISSUE-212 oracle found **1308 old false hard failures removed**
(545 `team_match_result` matchup + 320 `achievement_summary` aggregation + 443 player-identity, split
225 Gary Ablett Snr / 218 Jnr) **and 1 newly exposed genuine hard failure** — net failed count change
-1307, not "1307 fixed". The v54→v59 counts (496→545, 283→320, 351→443) grew because
AFLDB-ISSUE-207..211 landed in between and let more previously-declined rows reach a scored plan for
the first time, exposing more instances of the same three pre-existing defects — none of those five
fixes touched matchup detection, achievement aggregation, or player-identity resolution themselves.
The one newly exposed hard failure (row #20609919, "... margin for North Melbourne versus Melbourne at
Adelaide Oval ...") is a genuine, distinct, pre-existing `extractClubs` defect (`phrasePosition`/
`phraseEnd` re-finding a club's position via a bare word-boundary search of the whole original text can
find a shorter club's name embedded inside a longer club's own name, here "Melbourne" inside "North
Melbourne", instead of the real second mention, silently preventing the unordered matchup from
forming) — confirmed identical parser plan in V1 and V2, not a corpus/scorer defect and not introduced
by this issue, deliberately left unfixed and **not opened as its own tracked issue in this closeout**.
Two structurally similar pairs (`Port Adelaide`/`Adelaide`, `Greater Western Sydney`/`Sydney`) are
**unreproduced hypotheses only** — the actual host run found exactly one failure total, so neither is
confirmed to have been drawn by this seed or to reproduce the mechanism. See `issues.md` and
`AFLDB-ISSUE-212.md` (§6a, §8) for the full record.

**AFLDB-ISSUE-211 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — follow-on item
(5) of `AFLDB-ISSUE-206.md`'s six proposals, the largest single unimplemented soft-decline vocabulary
family it found: `extractSeasons` (`src/search/nl/parser.ts`, `src/search/nl/vocab.ts` new `AFTER_RE`)
had no form for `after YEAR` as an exclusive lower season bound (`scope.seasonMin = YEAR + 1`,
deliberately distinct from inclusive `since YEAR`). Fix extends the existing single season extractor
with one new anchored regex and one new `else` branch alongside the existing `since` check — no second
parser, no vocabulary/stage reordering, `after the siren`/`AFTER_THE_ACHIEVEMENT` unaffected because
neither ever puts a literal year immediately after the word. `PARSER_VERSION` 58 → 59. Implementation
commit `c113e6a`, unmerged on `sonnet/issue-211-after-year-season-bound`. Operator-validated on
streamanator: frozen V5 stable-corpus rerun stayed **12000/12000/0/0**, and a direct structured-plan diff
of the retained ISSUE-206 29,030-row exploratory corpus (pre-fix v58 vs post-fix v59) found exactly
**1406 changed plans**, all genuine `after <4-digit year>` wording, 0 unrelated — reconciled in full:
**1262 `soft_fail→clean`** (the genuine usability gain), **136 `soft_fail→soft_fail`** (95
`career_boundary` / 23 `head_to_head` / 18 `unsupported_composition`, correctly declined under the
existing compiler/coverage contract once the temporal clause parses), **8 `audit→audit`**
(`malformed_input` rows, intentionally still manual-audit by corpus design), and **0 `soft_fail→fail`**.
118 changed rows compose `after the siren` with a separate genuine `after YEAR` clause; both meanings
coexist correctly in every one. See `issues.md` and `AFLDB-ISSUE-211.md` for the full record.

**AFLDB-ISSUE-210 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — follow-on item
(6) of `AFLDB-ISSUE-206.md`'s six proposals: a leading imperative/request-wrapper verb ("find", bare
"show", "list", "give me" — "show me"/"tell me" already worked) survived `canonicalise()`
(`src/search/nl/vocab.ts`) as an unmatched leftover token and tripped the generic decline gate even when
the rest of the question was otherwise fully supported — the dominant soft-decline mechanism ISSUE-206
found (~10,000+ of 15,275 soft-decline exploratory rows). Fix: one new anchored
`LEADING_REQUEST_PREFIX_RE`, consumed at most once at the very start of the string; `find` carries a
negative lookahead protecting the pre-existing "find the (big) sticks" goals idiom, the one real
vocabulary collision found. `PARSER_VERSION` 57→58. Implementation commit `8324d2a`, unmerged on
`sonnet/issue-210-imperative-nl-phrasing`. Operator-validated on streamanator: frozen V5 stable-corpus
rerun stayed **12000/12000/0/0**, and a direct structured-plan diff of the retained ISSUE-206 29,030-row
exploratory corpus (pre-fix v57 vs post-fix v58) found exactly **1408 changed plans**
(`663 find / 378 list / 367 show / 0 other`, zero unrelated wording family), reconciled in full: **1288
`soft_fail→clean`** (the genuine usability gain), **48 `soft_fail→fail`** (all `show`-prefixed
`player_game_single` rows, all the pre-existing Gary Ablett Jnr/Snr canonical-display-name scorer
artifact from `AFLDB-ISSUE-206.md`, exposed by new reachability rather than caused by this fix), and
**72 audit-required `decline→success`** ("List sons of X with Y" `relationship_conditions` rows, now
valid typed `player_career` plans but still intentionally manual-audit by corpus design). See
`issues.md` and `AFLDB-ISSUE-210.md` for the full record.

**AFLDB-ISSUE-209 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — follow-on item
(3) of `AFLDB-ISSUE-206.md`'s six proposals: `extractHeadToHeadCue`'s `compare_wins` family
(`src/search/nl/semantic-intents.ts`) recognized only past-tense "won more", so present-tense "has/have
more wins ... head to head" fell through to the generic `head to head` → `record` cue and answered with
a full record instead of naming the leader. Fix added a dedicated "has/have (more|the most) wins head to
head" pattern plus a trailing-"head to head" extension to the existing "won more" pattern, both checked
before the generic record families; `PARSER_VERSION` 56→57. Operator-validated on streamanator (commit
`f2e067f`): frozen V5 stable-corpus rerun stayed **12000/12000/0/0**, and a direct structured-plan diff
of the retained ISSUE-206 29,030-row exploratory corpus (pre-fix v56 vs post-fix v57) found exactly
**199 changed plans**, all `headToHead.kind: record→compare_wins` in the same wording family — 173
matching ISSUE-206's direct estimate, plus 26 that also carried a mechanically-linked `between YEAR and
YEAR` season/havingClause correction (the same atomic "wins" consumption fix incidentally resolved a
misread grouped-threshold on those 26 rows) — zero collateral movement elsewhere, so **the validated
affected surface is 199 rows, not 173**. Implementation commit `f2e067f`, unmerged on
`sonnet/issue-209-head-to-head-more-wins`. Two adjacent wordings ("has more wins between A/B", "has more
wins against the other") investigated and deliberately not fixed — claimed earlier by
`extractClubSeasonMetric`'s "most wins" club_season ranking cue, a different mechanism. See `issues.md`
and `AFLDB-ISSUE-209.md` for the full record.

**AFLDB-ISSUE-208 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — follow-on item
(2) of `AFLDB-ISSUE-206.md`'s six proposals: `extractClubs`'s club-role lookback (`src/search/nl/parser.ts`)
tested "does an against-like token exist anywhere in a fixed 20-character window", not "what is the
nearest preposition governing this club" — losing the subject club on 134 after-siren rows ("to win FOR
Club" mis-read the earlier, unrelated "to" as governing) and 117 leading-opponent/checkpoint rows
("Against Opponent, ... Subject's ..." let the opponent's own stripped-out "against" leak into the
subject's shrunken window). One shared mechanism, fixed by a `nearestGoverningPreposition` helper
anchored to the immediately-preceding token, checked against the pre-mutation text — no vocabulary
added, no stage reordered, `scope.matchup` unchanged; `PARSER_VERSION` 55→56. Operator-validated on
streamanator (commit `70b72df`): frozen V5 stable-corpus rerun stayed **12000/12000/0/0**, and a direct
structured-plan diff of the retained ISSUE-206 29,030-row exploratory corpus (pre-fix v55 vs post-fix
v56) found exactly **251 changed plans** (134 `after_siren` + 117 `team_checkpoint_collision`), zero
collateral movement elsewhere, clearing all 251 confirmed parser-defect hard failures (aggregate hard
failures 1381→1130, clean +251, soft unchanged). Implementation commit `70b72df`, unmerged on
`sonnet/issue-208-club-role-ownership`. One structurally similar, undisturbed finding in
`assignCrossDomainClubs` (its own fixed-window `AGAINST_PREPOSITION.test` for the played/coached
opponent refusal) documented but not fixed and not yet opened as its own issue. See `issues.md` and
`AFLDB-ISSUE-208.md` for the full record.

**AFLDB-ISSUE-207 resolved 2026-09-16** (Sonnet 5, operator-validated on streamanator) — follow-on item
(1) of `AFLDB-ISSUE-206.md`'s six proposals, the highest-severity finding (281 silently-wrong-answer
corpus rows). Root cause: `extractHavingClause`'s operator search used an unbounded `±20`-character
window that could reach past a grouped wins/losses/draws/games threshold's own count into an adjacent
margin clause's operator word, and separately let `COMPARE_OP_WORDS`' fixed vocabulary order outrank the
clause's own, correctly-positioned operator word. Both effects silently swapped the two clauses'
comparators while still passing `validatePlan`. Fix bounded the operator search to
`window.slice(0, countEnd)` — no vocabulary added, no stage reordered, no default changed;
`PARSER_VERSION` 54→55. Operator-validated on streamanator: frozen V5 stable-corpus rerun stayed
**12000/12000/0/0**, and a direct structured-plan diff of the retained ISSUE-206 29,030-row exploratory
corpus (pre-fix v54 vs post-fix v55) found exactly **281 changed plans**, all
`havingClause.op: gt->gte` paired with `matchFilter.op: gte->gt` (the intended pairing), zero collateral
movement elsewhere in the corpus. Implementation commit `4ecdd77a`, unmerged on
`sonnet/issue-207-numeric-operator-ownership`. One pre-existing, out-of-scope gap documented but not
fixed: `extractMatchFilter` has no form for trailing "by 50 or more/fewer points". See `issues.md` and
`AFLDB-ISSUE-207.md` for the full record.

**AFLDB-ISSUE-206 resolved 2026-09-16** (Sonnet 5) — final triage of the 29,030-row independent V1
exploratory corpus, re-verified against current branch source rather than taken on the first-pass
(Codex) scorer labels. All 1,381 hard failures reconcile exactly to five root causes: 496
(`team_match_result` symmetric "versus", confirmed corpus-oracle defect — parser already emits a correct
`matchup` scope, template wrongly asserts directional clubs), 283 (`achievement_summary` aggregation,
confirmed corpus/scorer defect — the grain's executor never reads `plan.agg`), 351 (Gary Ablett Jnr/Snr,
confirmed scorer defect — player ID resolves correctly, only display-name string comparison is wrong),
and **251 genuine parser defects** (`after_siren`/`team_checkpoint_collision` clubFor loss, one shared
root mechanism: `AGAINST_PREPOSITION`'s 20-character lookback window in `extractClubs` is not anchored to
the nearest preposition). Two further clusters are silent wrong answers scored `clean`, outside the
1,381: 281 rows (numeric operator ownership crossing between `extractHavingClause`/`extractMatchFilter`,
confirmed parser defect, highest severity) and 173 rows (head-to-head "has more wins" phrasing gap).
Soft declines (15,275) trace mainly to one mechanism (imperative/structural phrasing vocabulary gap,
~10,000+ rows) plus `after YEAR` (unimplemented, ~1,200+ rows) and a deliberate `career_boundary`
compiler restriction (907 rows, fails closed by design). Six follow-on proposals recorded in priority
order in `AFLDB-ISSUE-206.md`, no ISSUE-207+ IDs assigned yet. No parser behaviour, `PARSER_VERSION`, V5
row or production data changed. See `issues.md` and `AFLDB-ISSUE-206.md` for the full record.

**AFLDB-ISSUE-205 resolved 2026-09-16** (Sonnet 5, operator-validated) — AFLDB-ISSUE-200's
`TAXONOMY_DRIFT` disposition for the remaining 70 `WRONG_FAILURE_REASON` rows was incomplete: two
unrelated families, not one benign label mismatch. **Family A (42 rows,** "biggest three quarter time
comeback" **):** genuine parser-ordering defect — `extractScoreCheckpoint` consumed "three quarter time"
before `extractTeamMetric` could match the already-implemented `q3_deficit_overcome` team_match metric.
Fix required two rounds (a `'3QT'`-entry guard, then a `'QT'`-entry follow-up after the operator's first
run found the first guard incomplete — a second, independent fall-through matching the same nested
substring); `PARSER_VERSION` 53→54. **Family B (28 rows,** "comeback from quarter time" **):** genuine
Q1/quarter-time feature gap (no `q1_deficit_overcome` metric exists, and none was added — deliberate
scope decision); stays declined, `expected_failure_reason` corrected `unsupported_topic`→
`unsupported_term`. Two correction-tool validation defects found and fixed along the way (both
test/tooling-only, no parser/runtime defect): an over-broad candidacy design gated on old-state
(`decline`+`unsupported_topic`) before question-text identity, wrongly flagging an unrelated live
fantasy-score row; and a DB-free test fixture that leaked a filler-row default
(`expected_grain='player_game'`) into synthetic decline rows. Operator-validated end-to-end: 446/446
parser tests, 35/35 integration tests (incl. new `q3_deficit_overcome` SQL coverage), clean
`tsc --noEmit`, 15/15 correction-tool tests, real V4→V5 correction (70/70 targets, 0 non-targets
touched, independently re-verified), parser-v54 rerun against V5 = **12000 scored / 12000 clean / 0 soft
/ 0 failed**. V5 is now the stable regression-corpus baseline, superseding V4. Stage 2 remains closed,
not reopened. See `issues.md` and `AFLDB-ISSUE-205.md` §11 for the full record.

**AFLDB-ISSUE-204 resolved 2026-09-16** (Sonnet 5, operator-validated) — guarded V3→V4 corpus
correction for the 180-row `coverage_unavailable|fgf` stale pre-1965/1987 finals-stat coverage
expectations (disposals/marks/tackles, finals/Grand Finals, seasons 1897-1926). Three fail-closed
correction-tool defects were found and fixed across three operator runs before the fourth completed
end-to-end: (1) an over-broad category+template-only selector matched 996 rows, not 180, retargeted to
the row's full structural signature; (2) a singular-only `/\bfinal\b/i` question-text check rejected
real plural "finals" wording, widened to `/\bfinals?\b/i`; (3) a season-shape gate wrongly required
`expected_season_from === expected_season_to` for every row, fixed by branching on
`expected_match_type` (Grand Final rows carry a blank `expected_season_to`). All three were
correction-tool-only; no parser/runtime defect was found. Final run: 180/180 targets corrected, 0
non-targets touched, parser-v53 rerun against V4 = 12000 scored / 11930 clean / 70 soft / 0 failed
(down from 250 soft), the 180 `UNEXPECTED_DECLINE` rows removed with zero new soft rows and zero
semantic changes among the rest; `PARSER_VERSION` unchanged at 53. See `issues.md` and
`AFLDB-ISSUE-204.md` §11 for the full record. AFLDB-ISSUE-187..204 all now resolved. **Stage 2 (the
AFLDB-ISSUE-200 corpus audit and its four follow-ons) is now closed**; the remaining 70
`WRONG_FAILURE_REASON` taxonomy-drift rows are a separate, not-yet-opened cleanup/audit task (see
Stage 2 next task below).

AFLDB-ISSUE-202 (GWS club identity leaks into unsupported-term detection) resolved 2026-09-16
(Sonnet 5, operator-validated) -- see `issues.md` for the full record, including the additional 72
grain-equivalent GWS player-season rows normalized as a byproduct of the same fix.

AFLDB-ISSUE-203 (numeric word "zero" not bound as equality in `player_career` conditions) resolved
2026-09-16 (Sonnet 5, operator-validated) -- root cause was two cooperating gaps in
`extractCareerConditions` (missing `zero` vocabulary entry, and a comparator default wrong for a
bound zero); `PARSER_VERSION` 52→53; 15 zero-word soft findings cleared, 0 new soft rows, 0
semantic changes among the 250 remaining soft rows -- see `issues.md` for the full record.

AFLDB-ISSUE-187..192 were opened 2026-09-15 from the Fable NL Search Stage 1 review (Fable 5.1,
medium effort), re-verified by Stage 2 on main `8a0c4cb`. Subsystem: natural-language search
(`src/search/nl/`, `src/db/queries/nl/`). AFLDB-ISSUE-190 resolved 2026-09-15 (Sonnet 5);
AFLDB-ISSUE-188 resolved 2026-09-15 (Sonnet 5); AFLDB-ISSUE-187 resolved 2026-09-15 (Sonnet 5);
AFLDB-ISSUE-189 resolved 2026-09-15 (Sonnet 5, from the approved runbook, operator-validated);
AFLDB-ISSUE-191 resolved 2026-09-15 (Sonnet 5, operator-validated); see `issues.md`.
AFLDB-ISSUE-193 (opened 2026-09-15 during ISSUE-189 planning) resolved 2026-09-15 (Sonnet 5,
operator-validated); see `issues.md`.
AFLDB-ISSUE-192 resolved 2026-09-15 (Sonnet 5, operator-validated: 31/31 integration tests,
5/5 ISSUE-192 regression tests, clean `tsc --noEmit`); see `issues.md`.
AFLDB-ISSUE-187..193 all remain resolved; the Stage 2 closeout audit (2026-09-16, Sonnet 5 High)
found three neighbouring, unrelated defects while verifying the resolved fixes and opened
AFLDB-ISSUE-194..196. AFLDB-ISSUE-196 resolved 2026-09-16 (Sonnet 5 High, from the approved
runbook — one runbook correction to the `across` regression contract mid-implementation, see
`issues.md` — operator-validated: 389/389 `nl-parser.test.ts`, 167/167 `nl-semantic-mapping.test.ts`,
clean `tsc --noEmit`). AFLDB-ISSUE-195 resolved 2026-09-16 (Sonnet 5 High, from the approved runbook
`AFLDB-ISSUE-195.md`, Option B — subject-gated "won the/a premiership" vocabulary plus a narrow
club-season ownership guard, no runbook correction needed — operator-validated: 398/398
`nl-parser.test.ts`, 167/167 `nl-semantic-mapping.test.ts`, clean `tsc --noEmit`); see `issues.md`.
AFLDB-ISSUE-194 resolved 2026-09-16 (Sonnet 5 Medium, `sonnet/issue-194-team-match-symmetric-matchup`,
unmerged — operator-validated: 34/34 `tests/integration/nl-answers-team-club.test.ts`, clean
`tsc --noEmit`); see `issues.md`. AFLDB-ISSUE-187..196 all now resolved. The Stage 2 corpus triage
of the 208 `AMBIGUITY_NOT_DETECTED` rows (2026-09-16) classified 40 as `GENUINE_FAIL_OPEN`, 168 as
`STALE_CORPUS_EXPECTATION`, and opened AFLDB-ISSUE-197 for the 40 (one root cause).
**AFLDB-ISSUE-197 resolved 2026-09-16** (Sonnet 5, from the approved runbook `AFLDB-ISSUE-197.md` —
Option C, a dedicated `resolvePlayerFamily` resolver mirroring the parser's whole-word-prefix
predicate in SQL; `PARSER_VERSION` 48 → 49; operator-validated: 25/25
`tests/integration/nl-semantic-mapping.test.ts`, 951/951 across the full focused NL suite set,
clean `tsc --noEmit` — see `issues.md` for the full Implementation/Validation/Resolution record,
including one mid-session fixture correction and one integration-path control-flow investigation
that concluded fixture defect, not production defect). AFLDB-ISSUE-187..197 all now resolved.

Stage 2 status: **blocked again, narrowly.** ISSUE-197 resolving its one genuine fail-open root
cause cleared six of the seven generic-surname families (Johnson, Brown, Smith, Williams, Wilson,
Anderson). The v49 regression rerun (2026-09-16) found the seventh, Jones (rows 11626-11630,
5 rows), still hard-failing for a distinct-but-related reason: the parser's own defence-in-depth
`candidateNameWords` re-check does not tokenise hyphenated surnames (`Darcy Byrne-Jones`,
`David Rhys-Jones`) the same way SQL's `afldb_normalise_name` does, undercounting the real 13-member
Jones family to 11 and ranking a wrong answer instead of declining. **AFLDB-ISSUE-198 opened
2026-09-16, resolved 2026-09-16** (Sonnet 5, from the approved runbook `AFLDB-ISSUE-198.md` — one
implementation-time deviation from its §5 Option C code sketch, found empirically: `candidatePlayerSpan`
widens its acceptance test via the new shared `splitNameWords` helper but keeps the original
punctuation-bearing token, rather than exploding it, to stay aligned with the confidence/leftover-token
accounting elsewhere in the parser — see `issues.md`'s Implementation section). `PARSER_VERSION` 49 →
50. Operator-validated 2026-09-16: `tests/integration/nl-semantic-mapping.test.ts` 29/29 (DB-backed,
`afldb_test`), combined focused suite 964/964 across 6 files (`nl-parser.test.ts` 413/413,
`nl-semantic-mapping.test.ts` 167/167, `nl-regression-corpus.test.ts` 163/163,
`nl-audit-acceptance.test.ts` 10/10, `nl-plan.test.ts` 182/182, plus the integration file above),
clean `tsc --noEmit`. AFLDB-ISSUE-187..198 all now resolved.

The unchanged V1 12k-row corpus re-run on parser v50 (post-merge Stage 2 step) has now been run: hard
failures 178 -> 173, confirmed to be exactly the five Jones rows (11626-11630) clearing with zero
collateral movement. **AFLDB-ISSUE-199 resolved 2026-09-16** (Sonnet 5, from the approved runbook
`AFLDB-ISSUE-199.md`, revised mid-implementation after two real-DEV validation failures — see
`issues.md`'s Implementation/Final-patch-revision sections — a self-verifying correction script,
`tools/nl/fix-issue-199-stale-expectations.ts`, corrected exactly the 173 stale-decline rows; operator-
validated: correction-tool summary 173/173 targets modified, 0 non-target rows touched, plus a parser-v50
`nl:stress` re-run showing `AMBIGUITY_NOT_DETECTED`/hard-fail 173 -> 0 with the three soft classes
unchanged at 72/921/70; DB-free unit suite 28/28; `PARSER_VERSION` unchanged at 50). AFLDB-ISSUE-187..199
all now resolved. Stage 2 is **not** closed by this: the three soft classes remain open and unaudited
(item 4 below), and the rest of the Stage 2 closeout sequence remains outstanding.

**AFLDB-ISSUE-200 opened 2026-09-16, resolved 2026-09-16** (all Sonnet 5) for item 4's soft-class
audit. Runbook `AFLDB-ISSUE-200.md` written (planning); `tools/nl/audit-issue-200-extract.ts` and
`tools/nl/audit-issue-200-cluster.ts` (plus a shared constants module) written with DB-free unit
tests (implementation); the operator ran both scripts against the real
`/home/arm/nl-stress-v50-cleaned/` artifacts and found exactly six auto-clusters covering all 1,063
rows, and evidence-backed dispositions for all six were recorded in a checked-in mapping
(`tools/nl/issue-200-dispositions.csv`); **operator-validated resolution:** the final
`audit-issue-200-cluster.ts --apply-dispositions` run against the real
`/home/arm/issue-200-soft-audit.csv` reconciled exactly -- 1063 rows in, 1063 classified, 0
unmapped, 0 stale, `PLANNER_VALIDATOR_BUG` 598 / `STALE_CORPUS_EXPECTATION` 180 / `PARSER_BUG` 143 /
`GRAIN_EQUIVALENT_LEGITIMATE` 72 / `TAXONOMY_DRIFT` 70; local `tsc --noEmit` clean,
37/37 DB-free tests passed. No parser/planner/scorer code changed; neither external corpus file
modified. The three candidate defect follow-ons and the one guarded corpus-correction task (named in
`issues.md`) are recorded but not opened as tracked issues in this closeout.

**AFLDB-ISSUE-201 opened 2026-09-16, resolved 2026-09-16** (all Sonnet 5) for the first of those
follow-ons: the `PLANNER_VALIDATOR_BUG` `coverage_unavailable|boundary` cluster (598 rows).
`validatePlan` now exempts a `raw.boundary` plan from the career season-range rejection;
`player-career.ts` compiles the range against `c.debut_season`/`c.final_season`; `PARSER_VERSION`
50 → 51. Operator-validated: 774/774 focused unit tests, 33/33
`tests/integration/nl-answers.test.ts`, clean `tsc --noEmit`; stable-corpus rerun cleared 596 of the
598 rows, and the remaining 2 (id 9907, id 10294 — both "... Grand Final before 1897", `seasonMax`
genuinely one season before `NL_LIMITS.minSeason`) were confirmed stale corpus expectations, not
implementation defects, and corrected by a new guarded, self-verifying script,
`tools/nl/fix-issue-201-stale-boundary-expectations.ts` (17/17 unit tests passed). Final stable-corpus
result: 12,000 scored / 11,535 clean / 465 soft / 0 failed, with an independent diff confirming zero
collateral movement anywhere else in the corpus. See `issues.md` and `AFLDB-ISSUE-201.md` for the full
record. AFLDB-ISSUE-187..201 all now resolved.

Full entries, evidence, root causes and acceptance criteria are in `issues.md`.

## Stage 2 next task

1. **Done** (2026-09-16) — V1 regression corpus re-run against parser v49 (parse-only): hard
   failures 208 -> 178.
2. **Done** (2026-09-16) — fresh run's semantic rows compared against the retained v48 baseline:
   1271 -> 1241 non-clean rows, 30 rows became clean, 0 new non-clean rows, 0
   changed-but-still-non-clean rows. This comparison is what surfaced the Jones rows (§ above,
   AFLDB-ISSUE-198) as still-hard rather than clean.
3. **Done, resolved 2026-09-16** — the V1 12k corpus was re-run on parser v50: hard failures 178 ->
   173 (only the five Jones rows, 11626-11630, moved; confirmed clean via full semantic diff, zero
   collateral movement). The remaining 173 hard failures (5 Ablett + 112 team-streak + 56 coach-record)
   were all stale expected-decline rows predating shipped features. **AFLDB-ISSUE-199 resolved
   2026-09-16** — corrected via a checked-in, self-verifying script
   (`tools/nl/fix-issue-199-stale-expectations.ts`), operator-run against the real canonical CSV
   (`~/nl-stress-corpus.csv` on the dev host, which has no in-repo generator); `AMBIGUITY_NOT_DETECTED`
   173 -> 0, the three soft classes unchanged. See `issues.md` for full evidence.
4. **Done, resolved 2026-09-16 — AFLDB-ISSUE-200.** All 1,063 soft rows (`GRAIN_EQUIVALENT` 72,
   `UNEXPECTED_DECLINE` 921, `WRONG_FAILURE_REASON` 70) are classified into exactly six real
   clusters, operator-confirmed via the tool's own final `--apply-dispositions` run:
   `PLANNER_VALIDATOR_BUG` 598, `STALE_CORPUS_EXPECTATION` 180, `PARSER_BUG` 143,
   `GRAIN_EQUIVALENT_LEGITIMATE` 72, `TAXONOMY_DRIFT` 70 — no
   `intentional_conservative_decline`/`scorer_harness_artifact`/`duplicate_manifestation` clusters
   turned up in the real data. See `issues.md` for full evidence. Runbook: `AFLDB-ISSUE-200.md`.
5. **(a) done, resolved 2026-09-16 — AFLDB-ISSUE-201.** **(b) done, resolved 2026-09-16 —
   AFLDB-ISSUE-202**: a `PARSER_BUG` fix for "GWS"/"GWS Giants" leaking into unsupported-term
   detection on `team_match` margin questions (128 manifestations). Root cause was a missing
   combined alias (see `issues.md`/`AFLDB-ISSUE-202.md`); fix applied was the one-line
   `CLUB_NICKNAMES` addition, operator-validated against the retained V3 corpus (465 → 265 soft).
   The same fix also normalized all 72 `GRAIN_EQUIVALENT_LEGITIMATE` rows (GWS Giants player-season
   leading-goalkicker questions) to exact expected semantics as a byproduct, so that class is now 0.
   Stage 2 was **not yet** closed after (c): **(c) opened 2026-09-16 as AFLDB-ISSUE-203, resolved
   2026-09-16** (`PARSER_BUG` fix for the word "zero" not binding as numeric-zero in career conditions,
   15 manifestations, operator-validated, `PARSER_VERSION` 52→53); **(d) opened 2026-09-16 as
   AFLDB-ISSUE-204, resolved 2026-09-16** (guarded corpus correction for the 180
   `coverage_unavailable|fgf` disposals/marks/tackles finals/Grand Final rows that asserted a stale
   `expected_status=success` — two coverage floors, not one: disposals/marks before 1965, tackles
   before 1987 — retargeted after the first operator run failed closed on an over-broad 996-row
   selector, then two further fail-closed correction-tool bugs found and fixed; operator-validated:
   180/180 targets corrected, 0 non-targets touched, parser-v53 rerun 250→70 soft with the 180
   `UNEXPECTED_DECLINE` rows removed and zero new soft rows, `PARSER_VERSION` unchanged at 53).
   **Stage 2 is now closed** — (a)-(d) all resolved. The fresh exploratory Codex corpus sweep is now in
   scope, per the original Stage 2 boundary, as a separate not-yet-opened task.
6. **Opened 2026-09-16 as AFLDB-ISSUE-205, resolved 2026-09-16.** The 70 `TAXONOMY_DRIFT` rows were
   **not** accepted diagnostic drift after all — the audit found a real parser-ordering defect silencing
   an already-implemented team_match metric (42 rows, fixed, `PARSER_VERSION` 53→54) plus a genuine
   Q1-comeback feature gap (28 rows, stays declined with a corrected failure-reason label). Corrects, but
   does not reopen, Stage 2 itself. V5 corpus: 12000/12000 clean, 0 soft, 0 failed. See
   `AFLDB-ISSUE-205.md`.

Completed issue runbooks and supporting evidence are archived under `issues/closed/`.
