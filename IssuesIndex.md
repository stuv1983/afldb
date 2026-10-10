# AFLDB Current Issues Index

> Lightweight session index of open issues only.
>
> `issues.md` is the authoritative detailed ledger.
>
> Runbooks live under `issues/`, not at the repository root: `issues/open/<ISSUE-ID>.md` while
> the issue is open, `issues/closed/<ISSUE-ID>.md` once it is resolved, together with any
> `-HANDOFF.md` companions and evidence artefacts. Historical entries below name a runbook by
> filename only; resolved ones are in `issues/closed/`.

**Open issues:** 51 (ISSUE-229, ISSUE-265–270, and the 44 review findings ISSUE-271–314 registered on 2026-10-10)

> **Waiting and blockers:** [`blockers.md`](blockers.md) is a navigation register of everything outstanding (blocked
> work, actionable work awaiting execution, decisions, acceptance and deployment holds). It is not authoritative; the
> runbooks and `issues.md` are. Update it whenever a listed blocker or acceptance state changes.

### AFLDB-ISSUE-265 — A settle unit can lose a match-lock deadlock to a legacy CSV promotion, with no in-run retry
- **Severity:** Medium (raised from Low on 2026-10-05, D-265-12). **Area:** data integrity / concurrency —
  `src/lib/acquisition/canonical-apply.ts` (`lockUnitMatchRows`, `applyAttendanceEnrichment`),
  `settle-afltables.ts`, `settle-afl-api.ts`, `settle-core.ts`, `src/lib/ingest/datasets.ts` (the
  ISSUE-264 hooks, `match_attendance`).
- **State:** Open (2026-10-04), from ISSUE-264 F-002. The operator accepted it as a temporary ISSUE-264
  limitation (D-264-11). ISSUE-264 is resolved (2026-10-05, DEV accepted, PROD promotion outstanding;
  runbook `issues/closed/AFLDB-ISSUE-264.md`); this limitation is **still open and not eliminated**, and the
  DEV acceptance did not exercise it.
  - A settle holding a later match can deadlock with a promotion holding an earlier one. If the settle is
    the victim, one unit rolls back with a `canonical_apply_failed` finding and the run continues. There
    is no in-run retry.
  - Recovery comes on the provider's next in-season run: the AFL Tables §9.3 retry, or the AFL API
    re-diff. This is traced in code (`issues/closed/AFLDB-ISSUE-264.md` §14.5.2). No real settle has been run into the
    deadlock.
  - DEV has no AFL Tables timer, so an AFL Tables unit waits for an operator-run settle.
  - The deadlock is not eliminated.
- **Runbook:** `issues/open/AFLDB-ISSUE-265.md`.
  - **2026-10-05 investigation (runbook §10–§15):**
    - **F-265-1**: an AFL API attendance-enrichment deadlock loses the **whole** run.
    - `match_attendance` is a third, unordered legacy match writer.
    - An in-run unit retry is futile in the main shapes.
    - Recommended: a settle/promotion advisory gate. Independently reviewed.
  - **2026-10-05 decisions (runbook §14.1):**
    - D-265-1..12 accepted: Option 3 gate, with settles shared and the promotions (including
      `match_attendance`) exclusive.
    - D-265-5 accepted (2026-10-05): a 300 s settle gate wait with a 330 s gate-statement bound. PROD
      records cannot validate it: promotion durations are not recorded. The D-265-13 query gives
      settle-duration context only (runbook §16.4).
    - D-265-14 accepted (Phase B case B11). D-265-15 accepted: the Phase A tooling is archived unchanged in
      `issues/open/AFLDB-ISSUE-265-phase-a/` (runbook §20.7).
    - Nothing implemented yet.
  - Phase A window 1 (2026-10-05 15:23:57): FAILED, census CLEAN (runbook §17.12). It is kept as
    historical evidence.
  - **Phase A window 2 (2026-10-05 16:22:35): PASSED 3/3, census CLEAN** (runbook §17.14). C2, C1 and
    F-265-1 are demonstrated with real settles. Retained: batches 1230, 1233 and 1237. No migration was
    applied (109).
  - Phase A is retired, and Phase B replaces it (runbook §17.15). The S0 checkpoint is commit 62f2cd67.
  - **2026-10-05: mitigation IMPLEMENTED in the working tree, uncommitted** (runbook §21). Shared settle gate
    (300 s / 330 s), exclusive gate in the three legacy hooks, ascending `match_attendance` hook, database-free
    pins, Phase B harness B1–B11. Typecheck, lint, unit pins and the network-blocked skip check pass.
    Pre-window verification (§22): the two failing tests are pre-existing; provenance manifests and a
    full-`settle-afltables` regression runner are prepared.
  - **Phase B window (2026-10-05 22:41, operator-run): PASSED 11/11 on `afldb_test`** (runbook §23). No skips,
    census CLEAN, 14 retained `admin-upload` batches all explained, historical fingerprints unchanged, zero
    teardown problems, provenance unchanged (58 files), no migration applied (State A). Evidence:
    `D:\tmp\issue265\run-20261005-224117-Full\`. It does **not** show protection against writers that lack the
    gate (Match Sheet, Data Editor, `player_bio`, direct SQL), and the regression window and DEV acceptance
    have not run.
  - **Regression window FAILED twice (2026-10-05 23:10 and 2026-10-06 05:28), cause confirmed** (runbook §24). Suites
    32/32, 16/16, 7/7, 76/76 passed; the census after `settle-afltables` was DIRTY both times (3 unexplained
    `settle-afltables.ts` batches each). Cause: the S6 block commits three batches per run and its teardown never deleted
    them; the probe shared the blind spot. Operator diagnostic: 18 S6 batches = six from these windows (1339-1341,
    1477-1479) plus **twelve historical** (66-68, 325-327, 543-545, 639-641). Verdicts and evidence preserved;
    **regression acceptance outstanding**. Suite teardown and probe corrected (uncommitted).
  - **S6 cleanup EXECUTED and VERIFIED (operator-run 2026-10-06; runbook §24.9):** six batches deleted (COMMITTED), post-commit
    Verify PASSED, the twelve historical batches unchanged.
  - **Historical exception APPROVED (operator, 2026-10-06 08:46) and Static PASS (runbook §24.10):** twelve pins and `rowMd5`
    values unchanged (0 differences vs the saved Plan); `s6-selftest` 12/12 on the approved file;
    `run-20261006-084649-Regression-Static` PASS (172 files).
  - **Regression window PASSED (operator-run 2026-10-06 08:56; runbook §25):** 32/32, 16/16, 7/7, 76/76; all censuses clean;
    migration 110 restored and verified against the capture; the twelve historical S6 rows unchanged, no new S6 residue; 36
    retained `admin-upload` batches (15 + 2 + 19), all explained; 172 provenance files unchanged. Both earlier failed verdicts and
    all evidence preserved (`D:\tmp\issue265\run-20261006-085603-Regression-Full\`). A `-Phase Build` was added to the runner
    (runbook §25.5).
  - **Build PASSED (operator-run 2026-10-06, `-Phase Build`, runbook §25.8):** `npm run build` exit 0 as `afldb_app` on `afldb_test`,
    1,515/1,515 static pages, standalone bundle ready; post-build census CLEAN (no database write); twelve S6 pins unchanged;
    172 provenance files unchanged; migration 110 not applied (State A). Two build warnings recorded as observed, **not** claimed
    pre-existing (deprecated `middleware` convention; `process.cwd` Edge Runtime notice from `node_modules/next`). Evidence:
    `D:\tmp\issue265\run-20261006-092204-Regression-Build\`. No new tracked change from the build. **Commit, `merge:ready`,
    deployment and DEV acceptance are pending**; ISSUE-265 stays open.
- **Next action:**
  1. The operator reviews and commits the eighteen files in runbook §25.7 (explicit paths; not the stray files; nothing under `D:\tmp\`).
  2. `npm run merge:ready -- --issue 265`, then merge/push, `deploy/sync-dev.ps1` and DEV acceptance (runbook §18.2).

### AFLDB-ISSUE-229 — AFL API fixture ingestion
- **Severity:** Medium. **Area:** acquisition / fixtures — `afl_api` season feed → `fixtures`,
  `canonical_applications`, `admin-fixtures.ts`.
- **State:** Open (2026-09-23). Fixture ingestion only. **Not resolved.**
  - **2026-10-02 (main `5a85226c`):** Option B decided; D-229-1 through D-229-8a decided.
    **B1 COMPLETE.**
  - Authentic retained pre-match evidence now covers `SCHEDULED`
    (`tests/fixtures/afl_api/match/04-season-feed-scheduled.raw-slice.json`) and
    `UNCONFIRMED_TEAMS`
    (`tests/fixtures/afl_api/match/05-season-feed-unconfirmed-teams.raw-slice.json`, 1154 bytes,
    sha256 `e39ac375cabf5f1fc2f182e4e7e28e53d072a4a8d49001320d163bb904867da7`).
  - Under the recorded D-229 decisions, both statuses map to fixture projection with AFLDB
    fixture status `scheduled`.
  - No fixture writer has been built.
- **Runbook:** `issues/open/AFLDB-ISSUE-229.md`.
- **Next action:** B2: capture and review the first authentic 2027 pre-match season feed before
  the fixture writer is wired or applied.

### AFLDB-ISSUE-266 — Email intake accepts unaligned SPF/DKIM passes, so a forged From address stages submissions as any admin
- **Severity:** High. **Area:** Legacy intake / email ingress — `tools/email_intake/fetch_and_stage.py`.
- **State:** Open (2026-10-08), 2026-10-08 full code review F-001. D-266-1 (trusted `dmarc=pass` only, bound to the
  single From mailbox's domain) and D-266-2 (`AFLDB_INTAKE_AUTHSERV_ID` required; exit 78 before IMAP) were decided on
  2026-10-09. Committed as `077af7ee`, merged and pushed to main. Pre-commit review fixed two parser gaps (runbook
  §18.8); the DB-free suite passed 160/160 on Windows and on Linux (streamanator, CPython 3.12.3; runbook §18.9).
  **Deployed to DEV only** (`7adfb3e8` → `077af7ee`; deployed suite 160/160, operator-reported; build and service
  unchanged; runbook §18.10). DEV `preflight` is BLOCKED by nine untracked settle manifests, not passed. PROD
  inspected, not deployed (held at `cd3cf782` during ISSUE-265 observation). Neither host has an intake timer, cron
  reference, IMAP settings or authserv-id in the places checked, so the fix is dormant. Live mail not tested; no host
  accepted.
- **Runbook:** `issues/open/AFLDB-ISSUE-266.md`.
- **Next action:** Before intake is activated on any host, verify the mail provider's header behaviour, confirm the
  authserv-id and set `AFLDB_INTAKE_AUTHSERV_ID`, then `--dry-run` a legitimate and a non-passing message (runbook
  §18.6, §18.10.8). PROD gets the code after ISSUE-265's observation.

### AFLDB-ISSUE-267 — Override replay writes NULL period scores from a partial `score` override
- **Severity:** High. **Area:** data integrity / admin override replay — `tools/migration/common.py`
  (`replay_admin_overrides`, matches branch).
- **State:** Open (2026-10-08), 2026-10-08 full code review F-002. Implemented 2026-10-09 with ISSUE-269 on
  `sonnet/issue-267-269` (since committed, below). **Operator integration run 2026-10-09 FAILED (6 failed, 37 filtered/skipped):**
  the replay wrote merged components and derived totals in two UPDATEs (`matches_score_components_ck`, 23514), and
  fixture cleanup failed on `club_seasons_season_fkey` (the score save derived two season-2081 `club_seasons` rows;
  historical baseline 1,624 → 1,626), leaving residue on `afldb_test`. **Second fix pass:** one atomic
  UPDATE for components, totals, margin, result and winner; cleanup records and deletes the derived ladder rows in one
  transaction. `py_compile`, `tsc` (exit 0), source-contract 69/69 green. **Residue:** recovery dry run passed and
  rolled back; the commit attempt refused before any DELETE (the two ladder rows were already absent; what removed
  them is unknown); a fresh census showed the namespace empty, foreign counts 0, `club_seasons_total` 1,624.
  **Second integration run 2026-10-09 10:47:03 PASSED** on `afldb_test` as `afldb_owner`: 6 passed, 37 filtered
  skips, no suite or hook failures, 33.80 s; residue and baseline assertions passed. **Implementation validated on
  `afldb_test`.** **DEV exposure census complete 2026-10-09** (operator-run before deployment; `afldb_dev` as
  `afldb_import`, read-only, through `== Done.`): 0 active `matches` overrides; section 1 partial 0, resolving 0;
  sections 2–5 no rows; no replay blockers. **Committed as `86e2d19f`, merged to `main` and pushed; DEV deployed
  2026-10-09** (operator-confirmed: full revision `86e2d19fa6936f73872da45c7b5cb3200e274543`; `common.py` no
  working-tree diff from HEAD; migrations 110/110, nothing to apply; build OK, `BUILD_ID` `Jlf_U7HZnqispmedF-TaS`;
  respawn 844885 → 849656, active since 11:40:00 AEDT; readiness after 2 s; health ok, database ok, 28 ms). The
  deployment did not exercise the Python matches replay. **PROD exposure census complete 2026-10-09** (operator-run;
  `afldb_prod` via SSH alias `afldb`, as `postgres`, read-only, through `== Done.`, psql exit 0): 0 active `matches`
  overrides; section 1 partial 0, resolving 0; sections 2–5 no rows; no section-3/4 replay blockers. It does not
  establish that the fix is installed on PROD. `merge:ready -- --issue 267`: READY twice (after a fresh fetch too),
  0 blockers, 2 metadata warnings (no `afldb-merge-readiness` JSON block in the ISSUE-267 runbook; no automated
  unexpected-file classification metadata). **PROD installation deferred:** PROD stays at `cd3cf782` until ISSUE-265's
  observation ends; measured release `cd3cf782..86e2d19f` (assistant read-only review of GitHub's comparison, transcribed from the
  supplied review; not operator-run Git evidence) is 9 commits, 40 files (no migration, package
  manifest/lockfile, `deploy/` or `next.config.ts` change), but includes ISSUE-261's settle/retry change, so deploying
  the full range would change the code under observation. Neither host's empty symptom section assesses historical
  corruption; historical impact remains unassessed, nothing repaired.
- **Runbook:** `issues/open/AFLDB-ISSUE-267.md` §17.10–§17.15; census
  `issues/open/AFLDB-ISSUE-267-269-override-census.sql`; residue
  `issues/open/AFLDB-ISSUE-267-269-fixture-residue-{census,recovery}.sql`.
- **Next action:** After the ISSUE-265 observation hold at `cd3cf782` is lifted, prepare and review a deployment
  procedure for this release (the r6 pack must not be reused; the range includes ISSUE-266 and ISSUE-261; the
  deploy-mode preflight is expected to FAIL on the settle manifests), then the applicable PROD deployment acceptance
  (runbook §17.15): verify the installed `tools/migration/common.py`. Then resolve with ISSUE-269.

### AFLDB-ISSUE-268 — Legacy `match_attendance` intake turns a blank cell into a sourced, settle-protected zero crowd
- **Severity:** High. **Area:** legacy intake / NULL-vs-zero — `src/lib/ingest/datasets.ts` (`match_attendance`).
- **State:** Open (2026-10-08), 2026-10-08 full code review F-003, reproduced DB-free (W2). **Implemented 2026-10-09 in
  `sonnet/issue-268`, committed as `5659f789`, merged and pushed to `main`, and deployed to DEV (installation and operational
  acceptance complete, 9 Oct 2026); operator checks at 15:11:57 passed (ingest-datasets 181/181, `tsc`,
  `eslint`, `git diff --check`) and the targeted ISSUE-268 integration cases passed twice on `afldb_test` as `afldb_owner`
  (15:21:42, 15:30:35: 7 passed, 32 filtered skips each); both operator-run censuses complete (DEV 15:59:22, PROD 16:02:57).**
  `validateRow` refuses a blank or missing `attendance` cell;
  every nonblank cell is read as before (`Number()`, whole number 0–200,000; `0` still validates; stricter `^\d+$` is
  undecided, D-268-1).
  `match_attendance`'s `preparePromotion` also re-reads every retained cell (same shared reader) before the gate/locks/writes
  and refuses the whole submission on a blank, unreadable or out-of-range cell or a disagreeing stored figure, whatever the
  stored verdict; the pipeline records that refusal as status `failed` (no `matches` row or batch written). DB-free and
  integration cases added; the integration file's fixture hooks were hardened in the review round (read-only preflight that
  refuses existing reserved rows, owned-id-only teardown, residue reported, runbook §17.12.1). A read-only census of
  already-promoted blank-cell rows was run by the operator on DEV (snapshot 2026-10-09 15:59:22, `afldb_dev`) and PROD (16:02:57,
  `afldb_prod`), both PostgreSQL 16.15, read-only repeatable-read, complete through `== Done.`: **no retained `match_attendance`
  submissions, no rows in Sections 2–5, every summary count zero, every statement parsed; classification of populated rows not
  exercised; no exposure found in the records checked** (runbook §17.14). **Historical impact unassessed, nothing repaired, no
  repair indicated, neither census installed the fix.** **Deployed to DEV only** (`86e2d19f` → `5659f789`, 110/110 migrations already
  applied, readiness and health `ok`); that deployment did not exercise attendance validation or promotion, and the ISSUE-107 gate
  was off, so no live build-header parity is claimed. **Not installed on PROD**, which is held at `cd3cf782`.
- **Runbook:** `issues/open/AFLDB-ISSUE-268.md` (§0–§16 from the review; §17 implementation record, §17.15 commit, merge and DEV deployment); census
  `issues/open/AFLDB-ISSUE-268-blank-attendance-census.sql`.
- **Residual exposure:** approval still trusts stored verdicts (a stale `validated` submission can be approved); promotion
  is now refused, but a refused attempt leaves the submission `failed`, which can be neither rejected nor re-validated
  (runbook §17.7). Remedy before any attempt: reject → re-validate; after: upload a corrected file as a new submission.
  Undecided, as separate follow-ups and **not** merge gates: D-268-1 (tighten nonblank cells to digits?) and D-268-3 (let a
  `failed` submission be rejected? shared pipeline). D-268-2's scoped promotion guard is implemented and passed the seven targeted
  integration cases twice.
- **Evidence (runbook §17.11):** 2026-10-09 15:11:57 unit file 181/181, `tsc`, `eslint`, `git diff --check` passed; target
  `afldb_test` / `afldb_owner` / `127.0.0.1:55432`; targeted ISSUE-268 integration cases passed at 15:21:42 and 15:30:35 (7 passed,
  32 filtered skips; no suite or hook failures; fixture preflight and cleanup assertions passed). All three pools used the test owner
  connection temporarily, so **restricted-role permissions and the full integration file are NOT validated.** The 15:11:57 ESLint
  command covered `datasets.ts`, `ingest-datasets.test.ts` and `match-results-promotion.test.ts`. Both censuses complete (runbook
  §17.14, above). **Commit and deployment (operator-reported, runbook §17.15):** `5659f789e95339f744ef4047e9ebdd3c0f81c299`
  fast-forwarded and pushed (`main` and `origin/main` matched); both `merge:ready` runs READY, 0 blockers, 2 warnings (no runbook
  readiness JSON metadata; no automated unexpected-file classification), nine paths checked explicitly by the operator. DEV
  (`streamanator`, `/home/arm/projects/afldb`): dependency installation and standalone build passed; nothing migrated;
  `BUILD_ID` `HcuY5qwdXjl-wq55zN3I_`; PID 849656 → 1095527, started 16:36:31 AEDT; readiness passed after 3 seconds; exact SHA
  confirmed, `datasets.ts` matched `HEAD`, service active, health `ok` (latency 30 and 32 ms).
- **Next action:** PROD installation and acceptance after the unchanged ISSUE-265 hold is lifted and a deployment procedure is
  prepared and reviewed (R2, R6, R15 in `blockers.md`). D-268-1 and D-268-3 are separate follow-ups, not merge gates. The
  restricted-role and full-file integration runs are optional extra evidence, not done and not claimed. Historical impact is
  unassessed and nothing is repaired; no repair is indicated by the census outputs, and a future repair needs separate evidence and
  operator authorisation (runbook §15).

### AFLDB-ISSUE-269 — `replay_admin_overrides('matches')` applies only one of a match's active override rows
- **Severity:** Medium. **Area:** data integrity / admin override replay — `tools/migration/common.py`.
- **State:** Open (2026-10-08), 2026-10-08 full code review F-004. Implemented 2026-10-09 with ISSUE-267
  (since committed, below): active rows merged into one object per `match_key`; equal-authority disagreements refused before any
  write; inactive rows excluded. Shared operator integration run 2026-10-09 FAILED (6 failed); **shared second-pass
  run 2026-10-09 PASSED on `afldb_test` (6 passed): implementation validated on `afldb_test`** (ISSUE-267).
  **DEV exposure census complete 2026-10-09** (shared with ISSUE-267: 0 active `matches` overrides, section 2 and all
  other sections no rows, no replay blockers). **Committed as `86e2d19f`, merged/pushed, DEV deployed 2026-10-09**
  (shared with ISSUE-267; the deployment did not exercise the Python matches replay). **PROD exposure census complete
  2026-10-09** (shared: 0 active `matches` overrides, section 2 and all other sections no rows, no replay blockers; not
  evidence that the fix is installed on PROD); `merge:ready` READY twice. PROD installation deferred (PROD held at
  `cd3cf782`; shared with ISSUE-267, §17.15); historical corruption not established, historical impact remains
  unassessed, nothing repaired.
- **Runbook:** `issues/open/AFLDB-ISSUE-269.md` §17.6–§17.9.
- **Next action:** As ISSUE-267 (deployment procedure prepared and reviewed after the hold lifts, then the applicable
  PROD deployment acceptance, ISSUE-267 runbook §17.15); resolve any
  census section-3 or section-4 row before a promotion.

### AFLDB-ISSUE-270 — A delegated admin manager can take over a peer admin account through a spare invite
- **Severity:** Medium. **Area:** authentication / administrator lifecycle — `src/app/admin/invite/[token]/actions.ts`
  (`confirmEnrolment`), `src/db/queries/admin-invites.ts` (new).
- **State:** Open (2026-10-08), 2026-10-08 full code review F-005, code-proven. **Implemented 2026-10-09 in
  `sonnet/issue-270` (worktree `afldb-issue-270`), revised the same day for D-270-2 and then for the independent
  review (§19: 5 s redemption statement timeout, tracked background transactions, doc corrections, integration-harness
  deadline correction); operator validation is COMPLETE for the working tree** (runbook §19.9,
  9 Oct 2026: unit 199/199 at 19:59:08 AEDT; typecheck, four-file lint and diff check, repeated after the harness
  correction; the whole `tests/integration/admin-lifecycle.test.ts` 37/37, none skipped, on `afldb_test` as
  `afldb_owner` from 20:57:05 AEDT; fixture residue check 0/0/0/0 for the i270 and i155 patterns on users and invites
  only). **Committed as `b239e0ac19b04becd4c1bdf26737d806590d8484`, merged to `main` and pushed (merge-readiness READY, 0
  blockers, 2 warnings), and installed on DEV three times on 10 October 2026** (runbook §20; latest service start 08:14:38
  AEDT, BUILD_ID `caodaX9EgGbJK4cZLFLRk`, earlier 05:53:50 and 07:55:26; all 110 migrations already applied; remote HEAD,
  both source files, `systemctl` and `/api/health` verified after each). That is **DEV installation and operational
  acceptance only: no invite redemption was exercised on DEV**; the second run's journal reported a control-group kill
  warning (recorded as reported, not investigated). **Not shown:** restricted `afldb_auth` validation, real-database
  Server Action end-to-end coverage, PROD installation or acceptance, historical-misuse assessment (nothing repaired); the
  ISSUE-107 gate was off, so no live build-header parity is claimed. Every redemption now requires the stored issuer's current authority, read under its row lock
  (D-270-2, operator-decided: enabled super admin grants anything; enabled delegated admin grants a plain admin only;
  anyone else nothing), free addresses and contributors included. An existing `admin`/`super_admin` is still overwritten
  only for a current super admin, and an outranking account is still refused, also in the upsert's `ON CONFLICT … WHERE`.
  Refusals write nothing and audit `admin.invite_rejected` with a reason. No migration, no bulk revocation.
- **Runbook:** `issues/open/AFLDB-ISSUE-270.md` §17 (implementation), §18 (D-270-2 revision, corrected concurrency
  reasoning), §19 (review follow-up, follow-ups list), §19.9 (operator validation results) and §20 (commit, merge and
  DEV deployments).
- **Next action:** Commit, merge/push and DEV installation with operational acceptance are complete (runbook §20).
  ISSUE-270 stays open: PROD installation and any applicable PROD acceptance remain outstanding behind the unchanged
  ISSUE-265 hold (no PROD procedure exists or is proposed here); close only after that applicable remaining acceptance is
  complete. D-270-1 (uniqueness index) remains undecided and is not a gate; §19.6 follow-ups are recorded, not gates.

> **2026-10-08 full code review findings ISSUE-271–314 (imported 2026-10-10).** Findings F-006–F-049 of the 2026-10-08 full code review at `20a7a4bb`, all **Open (2026-10-08), nothing implemented**.
> Runbooks copied unchanged from the review worktree into `issues/open/` and registered on **10 October 2026** (an import
> date, not a review or validation date). Classifications are the review's; **no finding was re-verified against current
> `main`**. The cited review report `issues/reviews/2026-10-08-full-code-review.md` and witness outputs were not imported.
> Ledger entries: `issues.md`, section *Imported review findings AFLDB-ISSUE-271–314*. **Selected next implementation
> batch: ISSUE-271/272** (implemented 2026-10-10 in worktree `afldb-issue-271`, uncommitted; DB-free tests, typecheck,
> lint, diff check and the full integration files (61/61) passed, review, commit, the ISSUE-272 DEV census and deployment
> outstanding; the "nothing implemented" above no longer applies to those two, and to no other finding). Each runbook is `issues/open/AFLDB-ISSUE-<ID>.md`.

### AFLDB-ISSUE-271 — Legacy `match_results` promotion overwrites Data Editor corrections on `matches`
- **Severity:** Medium. **Area:** legacy CSV intake / admin authority — `src/lib/ingest/datasets.ts` (`match_results`).
- **State:** Open (2026-10-08), review F-006, code-proven; imported 2026-10-10. **Implemented 2026-10-10 with ISSUE-272 in
  worktree `afldb-issue-271` (`sonnet/issue-271`); uncommitted.** Operator, 10 Oct 2026, on the pre-review-correction tree:
  `tests/ingest-datasets.test.ts` 246/246 (09:40:51 AEDT), TypeScript, five-file ESLint and `git diff --check` passed;
  integration: first window failed (historical, below), then **passed 61/61** after the corrections. A supplied value conflicting with active Data Editor authority (score group incl. derived
  scores; attendance group; manual-edit attendance citation, which also blocks replacing a `match_attendance` figure) is
  refused at validation (advisory) and under the match lock at promotion (whole submission, left `failed`); unreadable or
  inconsistent authority refuses. Also touches `src/lib/ingest/pipeline.ts` (validation reader). Open follow-ups, not
  tested or resolved (§17.10): orphaned overrides refuse with an unreachable editor link (F4); reader connection/statement
  bounds (F5); no real Data Editor-versus-promotion race test; restricted-role and manual-citation DB evidence outstanding.
  **Integration, 10 Oct:** the first window (`D:\tmp\issue271\apply-20261010-120323-16676`) **FAILED** *(historical)*:
  `match-results-promotion` 44/45 (one ISSUE-264 F-002 fixture interaction, 23505 `club_seasons_uq`), `datasets` 16/16; the
  runner's report failure was separate. After the fixture and runner corrections the fresh window
  (`D:\tmp\issue271\apply-20261010-122808-24240`, Preflight `…preflight-20261010-122730-18800`) **PASSED: 45/45 + 16/16 =
  61/61**, 0 failed, 0 skipped, `afldb_test` only, State A restored and verified, report completed (§17.12; ISSUE-272
  §17.14). Not claimed: that the database is wholly unchanged or residue-free (the probe covers its listed tables and
  fixture counters only). Not covered: a real Data Editor save-versus-promotion race; a dedicated PostgreSQL
  manual-attendance-citation case; `current_user` asserted inside every application connection.
- **Runbook:** `issues/open/AFLDB-ISSUE-271.md` (§17, §17.10, §17.11 historical, §17.12).
- **Next action:** Operator review and commit; `merge:ready` on a fresh ref, fast-forward and push `main`; ISSUE-272 DEV
  census run and reviewed; then DEV deployment and acceptance (DEV acceptance alone does not close the issue). PROD behind
  the ISSUE-265 hold. D-271-1…4 (§17.7) are the derived implementation basis, not open decisions.

### AFLDB-ISSUE-272 — Legacy `match_results` builds the match key from the raw round code and creates duplicate matches
- **Severity:** Medium. **Area:** legacy CSV intake / match identity — `src/lib/ingest/datasets.ts` (`match_results`).
- **State:** Open (2026-10-08), review F-007, reproduced DB-free by the review (W3); imported 2026-10-10. **Implemented
  2026-10-10 with ISSUE-271 (same worktree); uncommitted.** DB-free tests, typecheck, lint and diff check passed (operator,
  10 Oct, pre-correction tree; see ISSUE-271); integration: the first window 10 Oct FAILED (44/45 + 16/16; *historical*:
  one F-002 fixture interaction with this batch's 2073 Grand Finals, §17.13), then after the fixture and runner corrections
  **PASSED 61/61** (45/45 + 16/16, 0 failed, 0 skipped; `afldb_test` only; State A restored and verified;
  `D:\tmp\issue271\apply-20261010-122808-24240`; §17.14; the database is not claimed wholly unchanged or residue-free).
  `R1`→`1`, `gf`→`GF`, unsupported text refused;
  `resolved.round_code` and the canonical key at every key site; pre-fix submissions normalised at promotion when
  consistent, otherwise refused whole; two rows resolving to one canonical match key refuse the whole submission before any
  lock, write or batch (§17.11). Updates reach only a match under the compatible canonical name-keyed identity (not an
  admin-created club-ID-keyed one); existing non-canonical matches are not repaired, and a corrected upload can create a
  canonical twin beside one. Duplicate census (third pass: three provenance classes, four round-contract checks, totals
  before every capped listing) prepared, **unrun, not syntax-checked**.
- **Runbook:** `issues/open/AFLDB-ISSUE-272.md` (§17, §17.12, §17.13 historical, §17.14); census `issues/open/AFLDB-ISSUE-272-duplicate-match-census.sql` (**unrun, not syntax-checked**).
- **Next action:** Operator review and commit; `merge:ready` on a fresh ref, fast-forward and push `main`; then run and
  review the read-only **DEV census, including singleton non-canonical rows, before DEV deployment** (historical candidates
  require review; no damage or repair is established; any disposition is the operator's, with no automatic repair, rekey,
  delete or merge); then DEV deployment and acceptance (DEV acceptance alone does not close the issue). PROD behind the
  ISSUE-265 hold; PROD census only if chosen. D-272-1…4 (§17.7) are the derived implementation basis, not open decisions.

### AFLDB-ISSUE-273 — Submission validation overwrites a concurrent approve, promote or reject
- **Severity:** Medium. **Area:** legacy CSV intake / submission lifecycle concurrency — `src/lib/ingest/pipeline.ts`.
- **State:** Open (2026-10-08), review F-008, code-proven; nothing implemented; imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-273.md`. **Next action:** code fix plus tests.

### AFLDB-ISSUE-274 — A settle unit that writes only the `matches` row takes no row lock before its authority read
- **Severity:** Medium. **Area:** acquisition / settle concurrency — `src/lib/acquisition/canonical-apply.ts`.
- **State:** Open (2026-10-08), review F-009, code-proven mechanism (interleaving not executed); imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-274.md`. **Next action:** fix plus tests, sequenced with ISSUE-275.

### AFLDB-ISSUE-275 — A settle can insert period scores under a match it refused because a foreign owner created it concurrently
- **Severity:** Medium. **Area:** acquisition / canonical ownership — `src/lib/acquisition/canonical-apply.ts`.
- **State:** Open (2026-10-08), review F-010, code-proven mechanism (interleaving not executed); imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-275.md`. **Next action:** fix plus integration case, with ISSUE-274; split-ownership
  census open.

### AFLDB-ISSUE-276 — AFL API period scores that contradict the final score are written
- **Severity:** Medium. **Area:** AFL API settle — `src/lib/acquisition/afl-api-settle-plan.ts`, `afl-api-bundle.ts`.
- **State:** Open (2026-10-08), review F-011, code-proven; imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-276.md`. **Next action:** fix plus DB-free test; refusal reason name open.

### AFLDB-ISSUE-277 — Data Editor edits other than the name to a token-only player are not durable
- **Severity:** Medium. **Area:** Data Editor / override replay — `src/db/queries/data-edits.ts`, `tools/migration/common.py`.
- **State:** Open (2026-10-08), review F-012, code-proven; imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-277.md`. **Next action:** operator decision **D-277-1** ((a) or (b)), then implementation.

### AFLDB-ISSUE-278 — The destructive `db:test:rebuild` reset never asserts which database it is connected to
- **Severity:** Medium (the reviewer graded it High; the review's main session regraded it). **Area:** DB tooling /
  wrong-target safety — `tools/db/rebuild-test.ts`.
- **State:** Open (2026-10-08), review F-013, assertion gap code-proven, libpq trigger not executed; imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-278.md`. **Next action:** fix (1), optionally (2), plus tests; review gating note:
  before the next `db:test:rebuild`. H-278-1 open.

### AFLDB-ISSUE-279 — Under Next.js 16 every sitemap segment is empty
- **Severity:** Medium. **Area:** public site / SEO — `src/app/sitemap.ts`.
- **State:** Open (2026-10-08), review F-014, reproduced DB-free by the review (W6); imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-279.md`. **Next action:** fix plus test update, before search indexing is enabled.

### AFLDB-ISSUE-280 — Beta magic link is consumed by any GET, including a mail scanner's prefetch
- **Severity:** Low. **Area:** beta gate — `src/app/beta/verify/route.ts`. **State:** Open (2026-10-08), F-015; imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-280.md`. **Next action:** implementation (low priority).

### AFLDB-ISSUE-281 — Two public list pages fail on a sort key that names an inherited object property
- **Severity:** Low. **Area:** public site / sort allowlists — `src/db/queries/players.ts`, `draft.ts`. **State:** Open
  (2026-10-08), F-016, reproduced by the review (W5); imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-281.md`. **Next action:** implementation (trivial).

### AFLDB-ISSUE-282 — Replace actions revalidate only the replaced row's public pages
- **Severity:** Low. **Area:** admin awards / special records / revalidation. **State:** Open (2026-10-08), F-017; imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-282.md`. **Next action:** implementation, with ISSUE-283.

### AFLDB-ISSUE-283 — The administrative note is not recorded on creation audit rows
- **Severity:** Low. **Area:** admin awards / special records / audit. **State:** Open (2026-10-08), F-018; imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-283.md`. **Next action:** implementation, with ISSUE-282.

### AFLDB-ISSUE-284 — Brownlow season "accounted" count excludes a drafted source-complete match and blocks Publish
- **Severity:** Low. **Area:** admin Brownlow — `src/db/queries/admin-brownlow.ts`. **State:** Open (2026-10-08), F-019;
  imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-284.md`. **Next action:** implementation.

### AFLDB-ISSUE-285 — Award Replace panel cannot give the duplicate confirmation its action requires
- **Severity:** Low. **Area:** admin awards UI — `src/app/admin/awards/ReplacePanel.tsx`. **State:** Open (2026-10-08),
  F-020; imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-285.md`. **Next action:** implementation.

### AFLDB-ISSUE-286 — Hall of Fame legend and removal years are not bounded server-side
- **Severity:** Low. **Area:** admin awards / Hall of Fame validation. **State:** Open (2026-10-08), F-021; imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-286.md`. **Next action:** implementation.

### AFLDB-ISSUE-287 — Source-owned draft pick `null_pick_number` confirmation is unreachable
- **Severity:** Low. **Area:** admin draft UI — `src/app/admin/draft/SourceFieldsPanel.tsx`. **State:** Open (2026-10-08),
  F-022; imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-287.md`. **Next action:** implementation.

### AFLDB-ISSUE-288 — `createCoach` casts an unvalidated `dob` outside its error handling
- **Severity:** Low. **Area:** admin coaches — `src/db/queries/admin-coaches.ts`. **State:** Open (2026-10-08), F-023;
  imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-288.md`. **Next action:** implementation.

### AFLDB-ISSUE-289 — A cancelled fixture that is later played can never be reinstated
- **Severity:** Low. **Area:** admin fixtures — `src/db/queries/admin-fixtures.ts`. **State:** Open (2026-10-08), F-024;
  imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-289.md`. **Next action:** operator decision **D-289-1** ((a) or (b)).

### AFLDB-ISSUE-290 — Manual draft selections accept out-of-range age, height, weight and pick number
- **Severity:** Low. **Area:** admin draft / validation. **State:** Open (2026-10-08), F-025; imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-290.md`. **Next action:** implementation.

### AFLDB-ISSUE-291 — Admin player creation persists unvalidated biographical fields
- **Severity:** Low. **Area:** admin player creation — `src/db/queries/players.ts` (`createPlayerInTransaction`).
  **State:** Open (2026-10-08), F-026; imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-291.md`. **Next action:** implementation.

### AFLDB-ISSUE-292 — Data Editor override key is chosen nondeterministically for a player with two AFL Tables paths
- **Severity:** Low. **Area:** Data Editor / override replay — `src/db/queries/data-edits.ts`. **State:** Open
  (2026-10-08), F-027 (trigger a hypothesis); imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-292.md`. **Next action:** implementation (small), possibly with ISSUE-277;
  two-path census open.

### AFLDB-ISSUE-293 — Settle runs under-report `dataIssuesResolved`
- **Severity:** Low. **Area:** acquisition / settle accounting. **State:** Open (2026-10-08), F-028; imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-293.md`. **Next action:** implementation (trivial).

### AFLDB-ISSUE-294 — AFL Tables, lineup and fallback import batches record `completed_at = started_at` and no inserted count
- **Severity:** Low. **Area:** acquisition / import batch accounting. **State:** Open (2026-10-08), F-029; imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-294.md`. **Next action:** implementation.

### AFLDB-ISSUE-295 — Settle exception report mixes both sources' apply-failure findings
- **Severity:** Low. **Area:** acquisition / settle reporting — `src/lib/acquisition/settle-report.ts`. **State:** Open
  (2026-10-08), F-030; imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-295.md`. **Next action:** implementation (trivial).

### AFLDB-ISSUE-296 — Deprecated fallback importer sets `records_rejected` without rejection rows
- **Severity:** Low. **Area:** acquisition / deprecated fallback — `src/lib/external-afl/current-season-import.ts`.
  **State:** Open (2026-10-08), F-031; imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-296.md`. **Next action:** implementation, or an operator decision to retire the
  fallback path.

### AFLDB-ISSUE-297 — AFL API provider id is used unvalidated as a file path and URL path segment
- **Severity:** Low. **Area:** AFL API client — `src/lib/acquisition/afl-api-client.ts`. **State:** Open (2026-10-08),
  F-032; imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-297.md`. **Next action:** implementation.

### AFLDB-ISSUE-298 — AFL API snapshot companion files are read without manifest verification
- **Severity:** Low. **Area:** acquisition / evidence integrity — `src/lib/acquisition/afl-api-snapshot.ts`. **State:**
  Open (2026-10-08), F-033; imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-298.md`. **Next action:** implementation.

### AFLDB-ISSUE-299 — R lineup and roster acquirers overwrite retained evidence in place
- **Severity:** Low. **Area:** acquisition tooling — `tools/rebuild/afl_api/acquire_{lineups,rosters}.R`. **State:** Open
  (2026-10-08), F-034; imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-299.md`. **Next action:** implementation.

### AFLDB-ISSUE-300 — AFL API control-database read failure is reported as "disabled by a super admin"
- **Severity:** Low. **Area:** acquisition / diagnostics — `src/lib/acquisition/afl-api-ingestion-control.ts`. **State:**
  Open (2026-10-08), F-035; imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-300.md`. **Next action:** implementation.

### AFLDB-ISSUE-301 — AFL API HTTP client has no request timeout and reads the body outside its retry
- **Severity:** Low. **Area:** acquisition / network resilience — `src/lib/acquisition/afl-api-client.ts`. **State:** Open
  (2026-10-08), F-036; imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-301.md`. **Next action:** implementation; timeout value open.

### AFLDB-ISSUE-302 — Lineup bundle records the pinned fitzRoy version as provenance whatever version ran
- **Severity:** Low. **Area:** acquisition / provenance — `src/lib/acquisition/lineup-bundle.ts`. **State:** Open
  (2026-10-08), F-037; imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-302.md`. **Next action:** operator decision **D-302-1**.

### AFLDB-ISSUE-303 — `/admin/upload` promises 5 MB but Server Actions accept 1 MB
- **Severity:** Low. **Area:** legacy CSV intake UI / framework configuration — `next.config.ts`. **State:** Open
  (2026-10-08), F-038; imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-303.md`. **Next action:** operator decision **D-303-1**.

### AFLDB-ISSUE-304 — Email intake parses the whole body before sender and size checks
- **Severity:** Low. **Area:** email ingress resource bounds — `src/app/api/admin/email-intake/route.ts`. **State:** Open
  (2026-10-08), F-039; imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-304.md`. **Next action:** implementation, after ISSUE-266.

### AFLDB-ISSUE-305 — Legacy intake validation accepts values promotion then rejects
- **Severity:** Low. **Area:** legacy CSV intake validation — `src/lib/ingest/datasets.ts`. **State:** Open (2026-10-08),
  F-040, reproduced by the review (W4); imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-305.md`. **Next action:** implementation; H-305-1 open.

### AFLDB-ISSUE-306 — Legacy intake duplicate detection compares raw club text
- **Severity:** Low. **Area:** legacy CSV intake validation — `src/lib/ingest/datasets.ts` (`fileKey`). **State:** Open
  (2026-10-08), F-041; imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-306.md`. **Not implemented** — the ISSUE-271/272 batch (2026-10-10) canonicalised
  only the round code in `match_results` `fileKey`; club text is still compared raw. **Next action:** implementation (the
  review proposed doing it alongside ISSUE-272; that batch did not).

### AFLDB-ISSUE-307 — Legacy promotion counts every promoted row as inserted
- **Severity:** Low. **Area:** legacy CSV intake / batch accounting — `src/lib/ingest/pipeline.ts`. **State:** Open
  (2026-10-08), F-042; imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-307.md`. **Next action:** implementation (low priority).

### AFLDB-ISSUE-308 — Approving a player-link suggestion does not revalidate public pages
- **Severity:** Low. **Area:** admin player links / revalidation — `src/app/admin/player-links/actions.ts`. **State:** Open
  (2026-10-08), F-043; imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-308.md`. **Next action:** choose the mechanism (does the ISSUE-087 hang reproduce on
  Next 16.3.1?), then implement with ISSUE-309/311.

### AFLDB-ISSUE-309 — Multi-target player-link actions stop at the first failure after earlier targets committed
- **Severity:** Low. **Area:** admin player links — `src/app/admin/player-links/actions.ts`. **State:** Open (2026-10-08),
  F-044; imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-309.md`. **Next action:** implementation, with ISSUE-308 and ISSUE-311.

### AFLDB-ISSUE-310 — AFL API link path derives the stable player identity by a different rule from the forward classifier
- **Severity:** Low. **Area:** AFL API identity — `src/db/queries/afl-api-player-links.ts`. **State:** Open (2026-10-08),
  F-045 (collation-dependent); imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-310.md`. **Next action:** implementation; DEV/PROD collation question open
  (operator-run).

### AFLDB-ISSUE-311 — Activity audit after a committed player-link mutation is unwrapped or silent
- **Severity:** Low. **Area:** admin player links / activity audit. **State:** Open (2026-10-08), F-046; imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-311.md`. **Next action:** implementation, with ISSUE-309.

### AFLDB-ISSUE-312 — Migration safety scan fails on a detached HEAD with a misleading error
- **Severity:** Low. **Area:** DB tooling / migrations / preflight — `tools/db/migration-safety.ts`. **State:** Open
  (2026-10-08), F-047; imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-312.md`. **Next action:** implementation.

### AFLDB-ISSUE-313 — Database tooling passes the owner DSN, password included, on the `psql` command line
- **Severity:** Low. **Area:** DB tooling / credential handling — `tools/db/psql.ts`. **State:** Open (2026-10-08), F-048;
  imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-313.md`. **Next action:** implementation.

### AFLDB-ISSUE-314 — `prepare-promotion-source --apply` checks `--record-out` only after committing its writes
- **Severity:** Low. **Area:** DB tooling / promotion preparation — `tools/db/prepare-promotion-source.ts`. **State:** Open
  (2026-10-08), F-049; imported 2026-10-10.
- **Runbook:** `issues/open/AFLDB-ISSUE-314.md`. **Next action:** implementation.

**AFLDB-ISSUE-233 resolved 2026-10-08** (implementation merged 2026-10-01 as `f0abbb4c` and `cc1a5f2d`; operator
decision D-233-4) — AFL API season discovery (D-233-1), season-scoped AFL API Brownlow artefacts (D-233-2), and an
`afl_api` ownership census that refuses at rebuild, rollover and promotion (D-233-3). The promotion gate's first live read
PASSED on DEV (`afldb_dev`, HEAD `7adfb3e8`) and PROD (`afldb_prod`, HEAD `cd3cf782`): ownership gate PASS and dependencies
phase PASS, no `afl_api`-owned match in any season; graded offline (0 CRIT/HIGH/MED, 5 INFO). **Accepted limits:** no real
promotion ran; `pre-cutover`, `restored`, `candidate` and `production` are DB-free tested only (capture their results at
the next real promotion); the first genuine D-233-2 load is a 2026 rollover follow-up; the unfrozen manifests must not be
reused for a promotion. The PROD read ran at about 19:17 AEDT on 2026-10-08, inside ISSUE-265's N2 observation window. Full
record: `issues.md`, `issues/closed/AFLDB-ISSUE-233.md` §4.12–§4.13.

**AFLDB-ISSUE-259 and AFLDB-ISSUE-260 resolved 2026-10-08** (Sonnet 5; merged and pushed at `7adfb3e8`;
operator-run local validation and DEV deployment; DEV browser acceptance via Playwright MCP) — a club-scoped career
ranking with any non-`games` condition now declines with "This career statistic cannot currently be totalled for one
club." (259, D-259-1), and the "How was this calculated?" lines name career conditions in words, not `c.` markers
(260). DEV `http://10.0.40.100:8090`, operator-reported `BUILD_ID` `1iy-ZuCMeAIY9W77kTRMT` (seen in the served HTML):
the three ISSUE-259 questions each showed the message and no answer; "players with 300 games and no premierships"
returned 33 players with "Condition: premierships exactly 0." and "Condition: games at least 300." and no `c.` marker;
console 0 errors, 0 warnings. **Limitation recorded:** the operator's `-Issue107Gate` failed with exit 21
(`x-afldb-build` missing; `AFLDB_TRACE_REQUESTS` absent), so live header parity was NOT verified. Full record:
`issues.md`, `issues/closed/AFLDB-ISSUE-259.md` §18, `issues/closed/AFLDB-ISSUE-260.md` §18, evidence
`issues/closed/AFLDB-ISSUE-259-260-evidence/`.

**AFLDB-ISSUE-255 resolved 2026-10-01** (Sonnet 5, implementation committed `f6d189d0`, operator-run
DEV acceptance) — the AFL API settle no longer records an unused emergency as a game played. The
authentic feed lists a named emergency who never took the field as a stats row (Brayden Fiorini,
`CD_I993799`, roster `EMERG`, 0% time on ground, every statistic 0); a roster-`EMERG` + TOG 0 + all-zero
row is now an observation-only `non_participant`, counted in `nonParticipantPlayerRows`. A fresh
authentic ISSUE-232 D1b on DEV (snapshot `afl-api-2026-2026-10-01-104329`) showed 218 matches / 10,029
player rows, source COMPLETE, `corroboratedForeignOwned` 218, `nonParticipantPlayerRows` 1,
`canonicalRowsInserted` 0, `canonicalRowsUpdated` 0, derived recompute 0/0, and was then confirmed by
the first systemd run (batch 95). The 36 `afltables`-owned foreign-owner `player_match_stats`
refusals are classified and expected, not failures. No PROD work. Full record: `issues.md`,
`issues/closed/AFLDB-ISSUE-255.md` §7.

**AFLDB-ISSUE-232 resolved 2026-10-01** (Sonnet 5, operator-run DEV acceptance at `f6d189d0`) — AFL API
operational wiring on DEV. After ISSUE-255 was deployed, §7 D1b (rerun), D2, D3, D4 and E all passed:
the first observed systemd match run exited 0 and committed import batch 95 (218 matches / 10,029
player rows, inserts 0, updates 0, refusals 36, failures 0); all 218 2026 matches stay
`afltables`-owned with no `afl_api` ownership and no Fiorini phantom row; the match timer is enabled
(next run Fri 2026-10-02 05:10:02 AEST, no catch-up firing); and the Brownlow timer is permanently
enabled with the environment gate closed, firing as a clean no-op at 2026-10-01 21:05:00 AEST with
every snapshot inventory and settle-batch count still 0. The operator's manual `/admin/current-season`
final check also PASSED (Match and player statistics: Batch 95 completed; Brownlow votes: No batch
recorded yet; no error or alert state). Not done: PROD (nothing
installed or authorised); the Brownlow count window stays closed (first full-chain firing at the 2027
count or a separately authorised rehearsal). ISSUE-233 is unaffected and stays open. Full record:
`issues.md`, `issues/closed/AFLDB-ISSUE-232.md` §7.

**AFLDB-ISSUE-237 resolved 2026-09-28** (implementation and DEV/afldb_test validation by Sonnet 5,
operator-run PROD promotions) — AFL API importer-created `unique` identities are now carried through
`db:test:rebuild` and database promotion. `afldb_test` (L3), DEV (L4, stamp `20260926-085511`) and
PROD (L5) all accepted. L5 needed three real attempts: `20260926-213225` refused on 92 candidate-only
manual player registrations PROD never held (opened AFLDB-ISSUE-251); `20260927-142540`, after
ISSUE-251's registration lifecycle passed in full, refused on a 2026 Brownlow lineage-dependency gap
(opened AFLDB-ISSUE-252); `20260928-101642`, after the ISSUE-252 fix was completed and deployed
(`8fc60404`), ran the full freeze-bound procedure end to end and PASSED — swap, post-promotion
replay (92 registrations resolved, AFL API invariant OK), current-season AFL Tables settle, SC3
idempotence and the scheduled settle-timer path all clean. `docs/deployment.md` §6a documentation
(S5) was verified current. Cleanup of the retained rollback database and the two failed candidates is
deliberately deferred per `docs/production-promotion.md` §10 and is not a resolution blocker.
AFLDB-ISSUE-251 and AFLDB-ISSUE-252 were subsequently resolved on 2026-09-28; those later
closures do not alter this ISSUE-237 historical record. Full record: `issues.md`, `issues/closed/AFLDB-ISSUE-237.md` §16.

**AFLDB-ISSUE-251 resolved 2026-09-28** (implementation, DB-free/rehearsal validation and
operator-run PROD execution) — a separately guarded, fail-closed PROD adoption mode was
added to the pinned ISSUE-224 registration tool, minting PROD-local `manual_admin_edit` tokens for
the exact approved 92-player set under a real enabled+enrolled PROD `super_admin`, with no
`afldb_test` token/actor crossing into PROD and no AFL API identity written. After DB-free (144/144)
and live `code_test_db` rehearsal (first-adoption apply, second-apply refusal, atomic-rollback
proof, retry/conflict cases, positive-shape census) validation and a closed MEDIUM review finding,
an operator-authorised one-time apply against real `afldb-prod` committed exactly 92 registrations
with zero conflict and zero AFL API identities, independently confirmed by census. A subsequent
fresh ISSUE-237 L5 attempt (stamp `20260927-142540`) then proved the intended AFLDB-ISSUE-242
convergence in full (92/92 planned `rebind B → A`) and correctly stopped instead on the unrelated,
separately opened AFLDB-ISSUE-252 — proving ISSUE-251 never masked a different failure. A third
fresh L5 (stamp `20260928-101642`), run after the ISSUE-252 fix deployed, passed end to end. All 13
runbook acceptance criteria are met. The retained failed candidates, the frozen rollback database
and the adoption backup remain retained evidence, cleanup deferred per
`docs/production-promotion.md` §10. AFLDB-ISSUE-252 was subsequently resolved on 2026-09-28;
that later closure does not alter this ISSUE-251 historical record. Full record: `issues.md`,
`issues/closed/AFLDB-ISSUE-251.md` §25.

**AFLDB-ISSUE-252 resolved 2026-09-28** (implementation committed/merged/deployed; confirming fresh
PROD L5) — the promotion source lifecycle now guarantees required rebuilt dependencies before
candidate restoration: `db:promotion:prepare-source` settles the retained current-season AFL
Tables/AFL API sources into `afldb_test` (ownership-preserving, hash-bound, no network), and
`db:promotion:check` mandates a target dependency manifest and ownership-parity gate at `--phase
source`, with a frozen re-check at prod `--phase pre-cutover` — no opt-out. Automated fail-closed
tests (`tests/db-promotion-check.test.ts`, 375/375) reproduce the missing-current-season condition
directly. A real fresh `afldb_test` rebuild/preparation rehearsal (89/89 rebuild checks, D-252-12
36-row classified refusal census, D-252-13 669/669 player-bridge) and the `code_test_db` isolated
rehearsal (A–V, 104 checks) both PASSED. Implementation committed (`4bda2107`, `8fc60404`), merged
and deployed to the PROD checkout. A completely fresh ISSUE-237 L5 PROD attempt (stamp
`20260928-101642`, new freeze/dump/candidate, not the failed `20260927-142540` candidate) then
passed the restored lineage gate through to a clean guarded swap with no candidate-specific manual
repair. Cleanup of the retained failed candidates and the frozen rollback database remains deferred
per `docs/production-promotion.md` §10. Full record: `issues.md`,
`issues/closed/AFLDB-ISSUE-252.md` §28.

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
