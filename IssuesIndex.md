# AFLDB Current Issues Index

> Lightweight session index of open issues only.
>
> `issues.md` is the authoritative detailed ledger.
>
> Runbooks live under `issues/`, not at the repository root: `issues/open/<ISSUE-ID>.md` while
> the issue is open, `issues/closed/<ISSUE-ID>.md` once it is resolved, together with any
> `-HANDOFF.md` companions and evidence artefacts. Historical entries below name a runbook by
> filename only; resolved ones are in `issues/closed/`.

**Open issues:** 14 (ISSUE-316, registered 2026-10-18 on the uncommitted branch `opus/afl-api-cutover`; ISSUE-229, ISSUE-266–270, and the 7 review findings ISSUE-271–314 other than ISSUE-280, ISSUE-277, ISSUE-303, ISSUE-278, ISSUE-281, ISSUE-282, ISSUE-283, ISSUE-284, ISSUE-285, ISSUE-286, ISSUE-287, ISSUE-288, ISSUE-289, ISSUE-290, ISSUE-291, ISSUE-292, ISSUE-293, ISSUE-294, ISSUE-295, ISSUE-296, ISSUE-297, ISSUE-298, ISSUE-299, ISSUE-300, ISSUE-301, ISSUE-302, ISSUE-304, ISSUE-305, ISSUE-306, ISSUE-307, ISSUE-309, ISSUE-310, ISSUE-311, ISSUE-312, ISSUE-313 and ISSUE-314, registered on 2026-10-10; ISSUE-278, ISSUE-302, ISSUE-312, ISSUE-313, ISSUE-314 and ISSUE-315 were resolved on 2026-10-13, ISSUE-281 and ISSUE-288 on 2026-10-14 (both DEV-scoped; PROD installation and acceptance pending, runbooks `issues/closed/AFLDB-ISSUE-281.md` §18 and `issues/closed/AFLDB-ISSUE-288.md` §18), and ISSUE-265 on 2026-10-14, its closure documentation merged and pushed as `b8040018` and its ISSUE-265-specific PROD hold released, and ISSUE-297 on 2026-10-14 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-297.md` §18), and ISSUE-290 on 2026-10-14 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-290.md` §18), and ISSUE-291 on 2026-10-14 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-291.md` §18), and ISSUE-287 on 2026-10-14 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-287.md` §18), and ISSUE-286 on 2026-10-14 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-286.md` §18), and ISSUE-300 on 2026-10-14 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-300.md` §18), and ISSUE-306 on 2026-10-14 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-306.md` §18), and ISSUE-298 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-298.md` §18), and ISSUE-309 and ISSUE-311 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbooks `issues/closed/AFLDB-ISSUE-309.md` and `issues/closed/AFLDB-ISSUE-311.md` §18), and ISSUE-310 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-310.md` §18), and ISSUE-305 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-305.md` §18), and ISSUE-296 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-296.md` §18), and ISSUE-285 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-285.md` §19–§20), and ISSUE-282 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-282.md` §17–§18), and ISSUE-283 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-283.md` §17–§18), and ISSUE-284 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-284.md` §17–§18), and ISSUE-293 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-293.md` §17–§18), and ISSUE-294 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-294.md` §17–§18), and ISSUE-295 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-295.md` §17–§18), and ISSUE-301 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-301.md` §17–§18), and ISSUE-304 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-304.md` §17–§18), and ISSUE-307 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-307.md` §17–§18), and ISSUE-289 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-289.md` §17–§18), and ISSUE-277 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-277.md` §17–§18), and ISSUE-292 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-292.md` §17–§18), and ISSUE-299 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-299.md` §17–§18), and ISSUE-303 on 2026-10-15 (DEV-scoped: deployed to DEV on 2026-10-15 and browser-accepted; PROD installation and acceptance pending; runbook `issues/closed/AFLDB-ISSUE-303.md` §21–§22), and ISSUE-308 on 2026-10-15 (DEV-scoped: deployed to DEV and accepted under the owner's D-308-3 amendment; PROD installation and acceptance pending; runbook `issues/closed/AFLDB-ISSUE-308.md` §22), and ISSUE-280 on 2026-10-15 (DEV-scoped: deployed to DEV and accepted under the owner's D-280-1 and D-280-2 amendments; PROD installation and acceptance pending; runbook `issues/closed/AFLDB-ISSUE-280.md` §22); other issues' PROD prerequisites are unchanged)

> **Waiting and blockers:** [`blockers.md`](blockers.md) is a navigation register of everything outstanding (blocked
> work, actionable work awaiting execution, decisions, acceptance and deployment holds). It is not authoritative; the
> runbooks and `issues.md` are. Update it whenever a listed blocker or acceptance state changes.

### AFLDB-ISSUE-229 — AFL API fixture ingestion
- **2026-10-20 clarification:** B2 gates wiring/first applying the new-season fixture writer,
  with authentic whole-season/TBC/status/key/mapping evidence and first-apply approval. An
  inactive-writer backend preservation rehearsal is separate; ISSUE-229 remains OPEN.
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
  - **2026-10-19 (AFLDB V2 Launch F, `v2/rebuild` `d760280e`):** fixture writer built:
    `packages/acquisition/src/fixture-lifecycle.ts`, `src/lib/acquisition/afl-api-fixture-writer.ts` and
    `npm run settle:afl-api-fixture-schedule`. It resolves identity explicitly and fails closed;
    promotion is one idempotent transaction; unobserved statuses are acknowledged per run. Tested
    on isolated PostgreSQL 16 (17/17); the 2026 feed dry-runs clean. Never applied outside
    isolation.
- **Runbook:** `issues/open/AFLDB-ISSUE-229.md`.
- **Next action:** B2: capture the first authentic 2027 pre-match feed (no 2027 compSeason exists
  as of 2026-10-19). Validate-only and dry-run it, then the owner approves the first apply.
  B2 is seasonal first-season operational acceptance, not missing fixture-writer implementation;
  authentic 2026 evidence already proves the technical status/projection contract. Whole-season
  2027/TBC/status/key/mapping evidence and owner approval are not waived.

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
> lint, diff check and the full integration files (61/61) passed; commit `d37c1422` on `main`; the ISSUE-272 DEV census ran
> COMPLETE with 0 candidates (ISSUE-272 §17.15); push verified (live remote = `d37c1422`, then the documentation-only descendant `b2939eb7`), the historical `merge:ready` result not evidenced and not waived; fresh readiness PASSED, **DEV deployed at `b2939eb7` (BUILD_ID `e6baP2aMpe9KQ13d_24BL`) and ISSUE-272 DEV acceptance performed and QUALIFIED (twelfth pass, 11 Oct 2026; ISSUE-272 §17.18)**; ISSUE-271 acceptance, PROD installation and PROD acceptance outstanding; the "nothing implemented" above no longer applies to those two, and to no other finding). Each runbook is `issues/open/AFLDB-ISSUE-<ID>.md`.

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
- **Git and readiness (2026-10-10, shared with ISSUE-272 §17.16–§17.17):** commit `d37c1422` is on local `main`, the
  recorded `origin/main` and the live remote (`git ls-remote`); "uncommitted" above is superseded as to commit; how `main`
  advanced is not evidenced. The historical pre-merge `merge:ready` result for `d37c1422` is **not evidenced and not
  waived** (operator decision 10 Oct 2026: no waiver for either issue); it is recorded as missing and is not regenerated or
  replaced by any later check.
- **Deployment (2026-10-10/11, shared with ISSUE-272 §17.18):** the documentation-only descendant `b2939eb7` (application and
  test bytes those of `d37c1422`) passed fresh readiness (DB-free 246/246, typecheck, ESLint, byte binding) and is **deployed
  on DEV** (BUILD_ID `e6baP2aMpe9KQ13d_24BL`; 24/24 build headers from 4/4 workers). This issue's code is therefore running
  on DEV, but **no ISSUE-271 case was run**: ISSUE-272's acceptance cases exercised round codes only, so nothing here
  accepts the Data Editor authority refusal. The ISSUE-272 acceptance is itself qualified (original B3 INCONCLUSIVE;
  operator-adjudicated concurrent batch 115).
- **Next action:** ~~Operator supplies the `merge:ready` result for `d37c1422` or waives it~~ *(withdrawn: no waiver)*.
  ~~The operator commits the tracking documentation ... then DEV deployment with build identity~~ *(done, ISSUE-272
  §17.18)*. **Open:** write and run a DEV acceptance procedure for the Data Editor authority refusal (not yet written; DEV
  acceptance alone does not close the issue). The ISSUE-272 DEV censuses (before deployment and after acceptance) are
  **COMPLETE, 0 candidates** (ISSUE-272 §17.15, §17.18.6; they concern duplicate matches, not this issue's override
  authority). PROD behind the ISSUE-265 hold. D-271-1…4 (§17.7) are the derived implementation basis, not open decisions.

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
  before every capped listing) prepared, ~~unrun, not syntax-checked~~ **since run on DEV: COMPLETE, 0 candidates (below)**.
- **Sixth pass (2026-10-10):** commit `d37c1422` is on `refs/heads/main` (census runner Git evidence; the "uncommitted"
  wording in **State** above is superseded as to commit; push and `merge:ready` not evidenced). The read-only **DEV census
  ran COMPLETE** (`afldb_dev` as `afldb_import`, evidence `D:\tmp\issue272\run-20261010-155649-1780`; server identity
  operator-verified, not proved by the runner): **17,056 matches; 0 duplicate candidate groups/rows; 0 round-contract
  breaches; 0 home/away disagreements**; all canonical; all four listings FULL; 11/11 cross-checks; no repair performed or
  indicated. It shows the current DEV data state only: not that the defect is fixed, not that historical damage never
  occurred, not that PROD is clean. **Closure assessed (runbook §17.15): NOT closed.**
- **Seventh pass (2026-10-10; documentation only; runbook §17.16):** the credential-scan count of 21 is reconciled (20
  non-report files plus `summary.txt`, scanned before the other two reports exist): not an inconsistency. The **PROD census
  is optional and not chosen** (every statement of it is "only if chosen"): not a gate; PROD installation and acceptance
  stay separate blockers behind the ISSUE-265 hold. **Git, read-only:** local `main`, `origin/main` and the **live remote**
  (`git ls-remote`) all equal `d37c1422` ~~, a fast-forward of `41cbf730`~~ (eighth pass: only the tip agreement is
  evidenced; the parent `41cbf730` does not show how `main` advanced); the five changed files match the hashes the 61/61
  window recorded. **The `merge:ready` result is NOT EVIDENCED** (console-only tool, no readiness block, no record): the
  missing item is the operator's console output or a written waiver; the commit's presence is not treated as a passing
  gate. A concrete **DEV acceptance procedure is drafted for review, not approved or run** (§17.16.4).
- **Eighth pass (2026-10-10; documentation only; runbook §17.17, supersedes §17.16.4):** operator decisions: no
  `merge:ready` waiver, no PROD census now, no deployment or acceptance yet, validation-only insufficient. Proposed: fresh
  post-merge readiness of `d37c1422` in a new isolated worktree (R0–R8: tip agreement, preflight implementation mode, DB-free
  `ingest-datasets` 246, typecheck, five-file ESLint, diff check, scope and byte binding; ~~`merge:ready` informational with two
  pre-declared structural FAILs~~ *(withdrawn, ninth pass)*); deployed-build identity (full SHA, built `BUILD_ID`, and serving-process proof: ~~gate off
  only with worker start times and the rendered build ID~~ *(superseded, ninth/tenth pass: the gate is the only route)*); a traced side-effect inventory (submissions, row verdicts,
  `import_batches`, `auth_audit_log`, one identical-value `matches` row version; prohibited tables listed); whole-table
  before/after fingerprints, Gates G1/G2 before approval, stop rules with no automatic repair. The seventh-pass fixture
  query was defective (`venues.name` does not exist) and is corrected. Nothing run.
- **Ninth pass (2026-10-10; documentation only; runbook §17.17 revised in place):** operator decisions: no `merge:ready`
  waiver for either issue; no dirty-main deployment and no preflight bypass; the tracking documentation is committed first,
  so the intended deployment revision is a **documentation-only descendant of `d37c1422`**; `-Issue107Gate` preferred with
  the documented DEV tracing configuration, with **no host setting changed** until separately authorised; no PROD census;
  identical-value promotion stays provisional. Readiness is rebuilt around that descendant: a documentation commit (D0–D5,
  with `preflight --mode merge`), proof that only the four tracking files differ from `d37c1422`, `worktree:bootstrap`,
  `preflight --mode implementation`, DB-free 246, typecheck, ESLint, diff checks and byte binding on the exact revision, then
  read-only host prechecks and `preflight --mode deploy` before a gated deployment. `merge:ready` is **not** run as part of
  it, and no FAIL is pre-declared as acceptable. The documented read-only credential for the `auth_*` evidence is
  `AFLDB_BACKUP_DATABASE_URL` (`afldb_backup`, `pg_read_all_data`); its availability through the tunnel is unverified.
  Nothing run.
- **Tenth pass (2026-10-10; documentation only; runbook §17.17 corrected in place):** S-B runs `afldb_backup` in a separate
  child session, password typed into `Read-Host -AsSecureString` and held only in that child's `PGPASSWORD`, explicit
  `127.0.0.1:55432`, no DSN on any command line, and an in-session guard (database, role, not superuser, read-only, write
  probe) that refuses before any `auth_*` query. The post census V uses a reviewed **descendant-pinned copy** of the runner
  (pin `<DOC_SHA>`, parent `d37c1422`, four-file diff, blob `67820d85…` and its copy and guard hashes required); the
  original runner and its evidence are preserved. Credential-variable isolation now opens a child session before D0, so it
  precedes `npm ci` and every readiness command. Snapshots fingerprint every column of 12 named tables and of pre-existing
  batches, submissions and submission rows; what they do not cover is stated. The gate-off and `afldb_auth` alternatives
  are kept only as superseded history. Nothing run.
- **Twelfth pass (2026-10-11; documentation only; runbook §17.18): DEV deployed and DEV acceptance performed, QUALIFIED.**
  Documentation commit `b2939eb7658a15d7b70bd72be836107482362c0c` (sole parent `d37c1422`) pushed; fresh readiness R0–R7 PASS;
  gated DEV deployment exit 0, **BUILD_ID `e6baP2aMpe9KQ13d_24BL`**, I-1–I-4 PASS (24/24 headers, 4/4 workers). Acceptance (2025
  fixtures F1 16625, F2 16838): **C3/C4 = submissions 69/70 refused with the expected row reasons and rejected**; **C1/C2 =
  submissions 71/72 passed Gates G1/G2 (30/30 each) and were manually promoted as import batches 113/114**; **4 submissions,
  12 rows, 2 acceptance batches, 14 acceptance audit rows**. `matches` count 17,056, max id and whole-table fingerprint
  unchanged; the 12 covered tables unchanged; F1/F2 values unchanged, **both `xmin` values changed**. **Original B3 verdict:
  INCONCLUSIVE (unchanged)** — an unexpected import batch 115 (`settle-afl-api.ts`, 0 canonical writes). **Operator
  adjudication (recorded separately, 11 Oct):** batch 115 is unrelated concurrent DEV activity for this assessment; the
  batch-count rule is not met. **Census of record `D:\tmp\issue272\run-20261011-060523-24228`: COMPLETE, actual exit 0, 0
  findings, listings FULL, 17,056 matches (= B0), credential scan clean.** Conclusion: **DEV acceptance is supported only with
  the recorded concurrency exception; not an unqualified PASS; no ISSUE-271, PROD installation or PROD acceptance claim.**
  Recorded exceptions: refused first census launch (quoting), fixed copy of a sealed S-B launcher, credential-reuse and host
  routes, staging copies, an evidence-deletion incident (rebuilt hash-matched; copied back and verified 10 Oct 21:23, manifests
  30/30 and 12/12; the two folders are not untouched), an **unreconciled** BUILD_ID-mtime difference. (Thirteenth pass, 11 Oct:
  the B0/B1/B2 totals, fingerprints, history and audit rows were cross-checked against the saved outputs, no discrepancy.) A separate **2026 venue-season defect is drafted and pending registration, no issue number
  allocated** (`D:\tmp\issue272\DRAFT-ISSUE-venue-season-bound-2026.md`).
- **Fourteenth pass (2026-10-11; documentation only; runbook §17.18.10): B3 reconciled.** Every B3 requirement is met
  except §17.17.6's "one new batch" (B2 rule applied at B3; the same rule as "two new import batches"). **Batch 115 is the
  only discrepancy.** Its attribution, timing, zero canonical writes and unchanged fingerprints were re-verified from the raw
  outputs. Two precision notes: "scheduled" is inferred from the repository timer, not evidenced on DEV; 64 `data_issues`
  rows were refreshed, outside snapshot coverage. The adjudication authorises the attribution only (it says the rule "is NOT
  satisfied"), so **no acceptance outcome is appended**. Criterion 8 stays QUALIFIED and undecided.
- **Fifteenth pass (2026-10-11; documentation only; runbook §17.18.11): D-272-5 approved by the operator.** The exact
  batch-count requirement is waived for **batch 115 only**, when assessing ISSUE-272 criterion 8 on the existing 2025
  fixture evidence; it does not apply to ISSUE-271, PROD acceptance or issue closure. **Criterion 8: met with a recorded
  exception.** The original B3 verdict stays **INCONCLUSIVE**; all baselines and retained evidence unchanged; the earlier
  adjudication stays as recorded, D-272-5 separately. Batch 115: zero canonical writes, 64 `data_issues` rows refreshed,
  scheduled origin inferred. No database contact, nothing re-run.
- **Runbook:** `issues/open/AFLDB-ISSUE-272.md` (§17, §17.12, §17.13 historical, §17.14, §17.15, §17.16, §17.17, §17.18, §17.18.10, §17.18.11); census `issues/open/AFLDB-ISSUE-272-duplicate-match-census.sql` (blob `67820d85…`, run on DEV 10 Oct 2026 and again 11 Oct 2026 after acceptance: both COMPLETE).
- **Next action:** ~~Operator settles U-1…U-7 and approves or amends runbook §17.17~~ *(ninth pass: U-1 route, U-2
  credential and U-6 order are settled or identified)*. ~~The operator reviews §17.17~~ *(eleventh pass: §17.17 frozen
  10 Oct 2026 after one coverage-wording correction)*. ~~The operator opens the isolated child session
  (E1–E3), commits and pushes the tracking documentation (D0–D5), then runs readiness R0–R7 on that exact revision and the
  read-only host prechecks H-1–H-4 ... the gated DEV deployment with build identity I-1–I-4; then, if U-5 is approved, the
  cases C3, C4, C1, C2 and the post census~~ *(all done 10–11 Oct 2026; twelfth pass, runbook §17.18)*. **Remaining
  (criteria in §17.18.9, §17.18.11):** ~~the operator's closure-time position on the **qualified** DEV acceptance (original B3
  INCONCLUSIVE; batch 115 adjudicated, not satisfied). Fourteenth pass: the operator either records the prepared decision
  **D-272-5** (§17.18.10 item 6, Option A: waive the batch-count rule for batch 115 only; recommended) or declines it, in
  which case the commands for a fresh full acceptance run (Option B) are prepared for approval first.~~ *(fifteenth pass:
  D-272-5 approved and recorded; criterion 8 met with a recorded exception)* **PROD installation and PROD acceptance,
  blocked by the ISSUE-265 hold; then the closure procedure.** Separately: register the drafted 2026 venue-season defect (no number allocated yet; not treated as a
  gate); operator-owned housekeeping (staging copies, DEV host `.env` backup and retained `AFLDB_TRACE_REQUESTS=on`,
  kept readiness worktree/branch, tunnel PID 16372). ISSUE-271 is not accepted by this. The historical
  pre-merge `merge:ready` result stays recorded as not evidenced and not waived. No PROD census at this stage (PROD data
  state unassessed, not a gate). No candidate exists on DEV, so no disposition is owed. D-272-1…4 (§17.7) are the derived
  implementation basis, not open decisions.

### AFLDB-ISSUE-273 — Submission validation overwrites a concurrent approve, promote or reject
- **Severity:** Medium. **Area:** legacy CSV intake / submission lifecycle concurrency — `src/lib/ingest/pipeline.ts`.
- **State:** Open (2026-10-08), review F-008, code-proven. Fix implemented 2026-10-11 on `opus/issue-273`:
  verdicts are computed unlocked, then written with the status in one transaction under the
  submission row lock, guarded by status + `xmin`; approve now locks first. DB-free checks pass. `afldb_test`
  integration passed on 2026-10-11 (§18). D-273-1 approved and implemented 2026-10-11 (§19): email intake answers
  200 `validated: false` when a reviewer's decision superseded its validation; DB-free and `afldb_test` integration
  pass (ISSUE-264 State-B block excluded). Residual §19.5 (a reject before validation's first read) fixed 2026-10-11
  (§20): caller-specific start policy, intake from `staged`/`validated` only; manual re-validation kept; DB-free and
  `afldb_test` (`email-intake` 20/20, `submission-promotion` 15/15) pass. Final review corrections 2026-10-11 (§21):
  integration teardown now awaits all tracked background work before reset/cleanup; `afldb_test` 41 passed +
  4 expected-fail. Merged to main at `a34f0721` on 2026-10-11, readiness accepted under an operator exception for
  main's four untracked files (§22.1). The merge and deploy gates each failed only their clean-tree check; both raw
  FAILs are preserved and the two exceptions are separate (§22.1, §22.2). **Installed on DEV 2026-10-11 18:13** under the
  scoped deploy-gate exception D-273-DEV-1 (§22.2, §22.3), HEAD `a34f0721`: BUILD_ID `L22XfuX2nngl_51zwuzfH`, 4 of 4 workers, no migration applied. **DEV behavioural
  acceptance on synthetic fixtures SUPPORTED** (§22.4): submissions 73/74 both `rejected`, 11 expected audits in order, no
  import batch, `award_winners` 3712, migrations 110, service healthy afterwards. Not exercised on DEV: the race guard and the
  decided acknowledgement (`afldb_test` evidence only), the poller (offline self-test only), a real mailbox (unexercised
  anywhere); restricted roles only as narrowly tested on `afldb_test` (§22.4). The refused approve on 74 rests on a saved Playwright page snapshot (no
  database trace beyond the absence of an approval audit). D-273-DEV-2 approved: account id 4. DEV evidence only.
- **Runbook:** `issues/open/AFLDB-ISSUE-273.md` §17–§22. **Next action:** PROD installation and acceptance behind the
  ISSUE-265 hold, then closure (§19.6 item 4). Not closed.

### AFLDB-ISSUE-274 — A settle unit that writes only the `matches` row takes no row lock before its authority read
- **Severity:** Medium. **Area:** acquisition / settle concurrency — `src/lib/acquisition/canonical-apply.ts`.
- **State:** Open (2026-10-08), review F-009, code-proven mechanism (interleaving not executed); imported 2026-10-10.
  2026-10-11: fix + DB-free tests implemented LOCALLY on `opus/issue-274` (uncommitted); four integration cases written,
  NOT run; DB-free failures baselined against an unchanged `416f5f27` export (0 introduced); D-274-1 (lock strength)
  APPROVED 2026-10-12 (`FOR NO KEY UPDATE`; choice only, §21). After review (§19): the late retired-candidate window is closed by refusing such a unit
  (DB-free regression fails on the unfixed source); the integration harness bounds every wait and confirms holder, settle and
  backends gone before fixture cleanup (DB-free tests; PostgreSQL glue unexecuted). 2026-10-12 (§20): the late candidate is
  refused WITHOUT being locked (unlocked re-search; lock-order claims corrected); observation, termination and close/confirm
  are bounded and reported (162.2 s worst case, DB-free tests); an unresolved scenario stops the wrapper's and the three
  `afterAll` fixture removals and later scenarios (`createCleanupGate`). Probe revised (bounded; control options and
  `pg_terminate_backend` rehearsal), run 2026-10-12 against `afldb_test` and FAILED at State A (exit 1: migration 110 not applied there, §22);
  its later checks did not run (the relation-presence check ran and passed first: corrected in §22/§24); nothing changed to obtain a pass. 2026-10-12 (§23): the four integration cases do NOT need migration 110 (inherited
  from the durable Match Sheet wrapper); moved to their own describe with a matches-only precondition and cleanup, DB-free pins updated; a
  separate matches-only probe MO-1 prepared (not a pass of the original probe, whose FAIL stands). 2026-10-12 (§24): **MO-1 PASSED and the one focused
  `-t "ISSUE-274"` run PASSED against `afldb_test` (State A, exit 0, 4 passed | 76 skipped | 1 todo)**; baseline and post-run censuses identical (no retained rows or sessions,
  schema unchanged, migration 110 not applied). Limits: one run; not shown to fail on the unfixed source on PostgreSQL; State B, the rest of the file and other suites not run.
  2026-10-12 (§25, local files and read-only Git only): provenance check AFTER the run (not a pre-run fingerprint): all seven source/test files are byte-identical to reviewed R4;
  validation plan written and nothing run (R1 same tests with only the lock block reverted in an isolated copy, expected 2 failed | 2 passed | 1 todo; R2 whole `settle-afltables`;
  R3 whole `settle-afl-api`, which rewrites season-2026 derived rows; State-A vacuous passes listed as NOT EXERCISED; import-role lock not covered by existing tests, D-274-2).
  Still untested: overlapping-settle cycle, late-candidate case on PostgreSQL, State B.
  2026-10-12 (§26, owner-authorised R1/R2 on `afldb_test`, State A): **R1 lock-removal mutation (isolated copy, one file, six lines): exit 1, `2 failed | 2 passed | 76 skipped | 1 todo`, exactly the two
  `whileBlocked` discriminator failures** (blocked on the final `UPDATE matches`; no overwrite is shown). **R2 whole `settle-afltables`: `1 failed | 78 passed | 1 skipped | 1 todo` in 325 s; the one
  UNEXPECTED failure is ISSUE-099 O1 "extracts the real statement set" (a text-extraction test reading a prose comment at `settle-afltables.ts:1918` as SQL).** R2 exit 1 stands: 67 exercised and
  passed, 1 failed, 1 restricted-role skip, 11 durable scenarios reported passed but NOT EXERCISED, 1 todo; not a clean pass. Censuses before/after identical, the 12 pre-existing S6 batches preserved. R3, optional
  suites and Phase B not run. D-274-2: a direct `afldb_import` lock test is prepared, not run (§26.6).
  2026-10-12 (§27, local and DB-free): a targeted extractor comparison (not a suite run) gives the same O1 result on `HEAD` and the patch, so it is independent of this patch; registered as **ISSUE-315** (Low).
  The import-role test was revised (pid-based session confirmation with a visibility control, honest no-fixture failures, key-based cleanup if an INSERT reply is lost); `npm run typecheck` and ESLint on it are clean; not run.
  2026-10-12 (§28, local and DB-free): that test's cleanup was corrected: both fixture rows carry a per-run marker that every DELETE requires (a row another session put on the key survives and is reported); a lost
  season INSERT reply is reported as possible residue and the season is never removed; the primary failure, cleanup problems and connection-close failures are all reported. New pure helper plus a DB-free file
  (13 tests pass); typecheck, ESLint and whitespace clean; the new SQL is unexecuted and the test is still not run. R1/R2 not repeated; R3 pending.
  2026-10-12 (§29, owner-authorised, ONE run on `afldb_test`, State A): **the D-274-2 import-role lock test PASSED (exit 0, 1 passed, 0 skipped)**. Provenance (R8 patch hash, 14 blobs) and MO-1 verified first; both connections on
  the same server as `afldb_owner`/`afldb_import`; `matches.notes`/`seasons.notes` writable `text`. The role took `FOR NO KEY UPDATE` on one test-owned row, a competing `FOR UPDATE NOWAIT` was refused with `55P03`, free after rollback.
  Baseline and post-run censuses identical (no fixture residue, no sessions, schema/grants unchanged, 12 S6 batches unchanged). Runtime lock-permission evidence only, not applier acceptance; one run; DEV/PROD grants not examined. Tunnel closed.
  2026-10-12 (§30, owner-authorised, ONE run on `afldb_test`, State A): **R3, the whole `settle-afl-api.test.ts`, PASSED (exit 0, 72 passed, 669 s)**. Provenance (R8 patch, 10 blobs, MO-1) verified first; all 54 pre-clean selectors counted 0, so no pre-existing row was at risk. After: fixture selectors 0, no sessions, schema/grants unchanged, all 729 batches preserved, canonical `matches` content-identical. **Retained change: `club_seasons` season 2026 rewritten** by the suite's recompute hook (2 stale rows replaced; only `finals_played` 1 -> 0 differs); 14 sequences advanced. 70 of 72 exercised PostgreSQL, 1 DB-free, 1 NOT EXERCISED (ISSUE-257 §17.8, State A). One run; no test asserts the new lock; State B, overlapping-settle cycle and late candidate on PostgreSQL still unrun. Tunnel closed.
  2026-10-12 (correction to §30): the unchanged-file provenance was "listed files matched `HEAD` blobs; the ten changed files matched R8", not a complete dependency trace; `club_seasons` 2026 is the only table-content change detected (surrogate ids replaced, `finals_played` 1 -> 0; `player_match_stats`/`brownlow_round_votes` by count and ids only).
  2026-10-12 (§31): merged to main as `6f99b58d` with an owner-authorised readiness EXCEPTION (not a clean pass; the runbook has no `afldb-merge-readiness` block; the first merge preflight was misdirected and is superseded). DEV deployment and acceptance PREPARED, NOT executed (DEV at `a34f0721`): deploy-mode preflight BLOCKED only by the four preserved untracked files of `D:\dev\afldb` (not waived); delta 16 files, 0 migrations; independent of ISSUE-275. Pack `D:\tmp\issue274\dev-pack-20261012\`.
  2026-10-12 (§32, owner-authorised DEV steps only): **`6f99b58d` INSTALLED on DEV** (BUILD `kKfU7VKifbsWyPAAurnUU`; deploy gate passed only under the scoped clean-tree exception D-274-DEV-1; installation checks PASS) and the synthetic
  behavioural acceptance gave **VERDICT FIXED for both scenarios** (edit and delete versus settle; settle blocked on `FOR NO KEY UPDATE`, editor value and override kept, no update ledger row). The acceptance driver's first cleanup
  **FAILED and rolled back** (FK order: `staging.source_record_versions` before `staging.source_records`; a tooling defect); an FK investigation found derived `club_seasons` ids 1751/1752 (written by the settle recompute) that would also have blocked the
  season delete; an owner-authorised cleanup revision 1 removed them with the namespace and **SUCCEEDED** (every selector 0, season 2093 absent). S-1 versus the original S-0: **compare exit 5, preserved**, 0 failures, all 99 table comparisons matched
  (full-content hashes where collected; `player_match_stats` by row count and ordered ids only); `club_seasons` 1,640 rows with the identical content hash. The one review item, `club_seasons_id_seq`, advanced by four (1748 -> 1752) during the fixture interval; rows 1751/1752
  were removed, the allocation history of 1749/1750 was not captured, so the four values are not attributed solely to the two deleted rows. Owner-accepted as recorded; nothing reset; compare rules unchanged. Health PASS (24/24, 4 workers). Limits: synthetic fixtures and an emulated
  holder, not the real editor, State B durable Match Sheet cases or overlapping settles (the DEV run itself was in State B).
- **Runbook:** `issues/open/AFLDB-ISSUE-274.md`. **Next action:** the first scheduled nightly was **observed with no regression marker against the documented baseline on 13 Oct (one night, read-only checks, runbook §33; run revision `6f99b58d` supported by the host reflog, not recorded by the run; not shown: that the lock fired, the real editor, State B, overlapping settles)**; 64 refusals before and after the change with 0 canonical failures/inserts/updates/ledger writes (§33.8); lock execution and the historical reasons for the other 44 targets NOT PROVEN; the 14 Oct nightly (batch 122, 05:04:09-05:06:13) was the combined ISSUE-274 + ISSUE-276 observation and was graded **PASS, no regression**; the combined ISSUE-274 + ISSUE-276 DEV observation window is CLOSED (owner decision D-OBS-274276-20261014; 14 Oct nightly batch 122 PASS, no regression; runbook 274 section 33.10, 276 section 17.10; lock execution and the ISSUE-276 guard branch remain NOT PROVEN / NOT OBSERVED) (repeatability beyond the observed nights is not established by them alone). PROD: the ISSUE-265-specific PROD hold was released by `a862d192`; PROD still needs its own reviewed procedure (`blockers.md` R6);
  ISSUE-275 is a separate defect, not fixed by this.

### AFLDB-ISSUE-275 — A settle can insert period scores under a match it refused because a foreign owner created it concurrently
- **Severity:** Medium. **Area:** acquisition / canonical ownership — `src/lib/acquisition/canonical-apply.ts`.
- **State:** Open (2026-10-08), review F-010, code-proven mechanism (interleaving not executed); imported 2026-10-10.
  **Implemented locally 2026-10-13, revision 2 the same day** on `opus/issue-275` (`D:\dev\afldb-issue-275`, base `e315c1d3`; **since committed as `24ca412b` and on `origin/main` (verified 2026-10-14); installed on DEV 2026-10-14 13:52 AEDT (TARGET `17514052`, BUILD `2mH5otSwPUveE-pcn3LcF`; runbook 275 §30); acceptance NOT met**): `canonical-apply.ts` refuses a unit's `match_period_scores` unread whenever the same unit's `matches` target is unapplied for any reason other than `nothing_to_write`
  (deny-by-default, derived from the parent's result; `manual_authority_*` included; full path table runbook §22.1). DB-free: 15 cases pass (7 witnesses fail with the rule disabled; the 2 authority witnesses alone fail with it narrowed to the first pass's three reasons), five source-scan files 1064 passed + 1 failed (the CRLF baseline,
  pre-existing and unrelated, runbook §25), `tsc` exit 0. A wrong findings assertion in the witness was found and fixed in review (§24.1).
  **Focused `afldb_test` validation PASSED 2026-10-13 (runbook §26; evidence `D:\tmp\issue275\run-20261013-105531-v2\`):** target `afldb_owner`/`afldb_test`/`127.0.0.1:55432`, matches-only probe OK, one shell-free Vitest run with filter `ISSUE-274: precondition|ISSUE-275`: exit 0, **3 passed, 79 excluded by the filter, none selected skipped**; fresh pack-v2 baseline/after `CENSUS IDENTICAL`, `match_period_scores` count/key hash/whole-row hash unchanged; all eight repository files unchanged. Earlier attempts (inherited DSN role `arm`; `cmd.exe` split the filter, and its v1 census comparison is invalid) are preserved and are not acceptance evidence.
  Same-transaction planted-row witness only: no two-session concurrency, no DEV/PROD/State B evidence, no preparation-time pack-v2 hash manifest; the CRLF test failure (§25) is separate. Full-diff review (§27): no CRIT/HIGH/MED finding.
- **Update 2026-10-15:** the first nightly after the DEV installation (batch 123, 05:08:05-05:09:41 AEDT) was captured read-only: success, 64 refusals as on 14 Oct, no failure marker, censuses differ
  from the sealed baselines only as predicted; no finding attributable to the gate (expected on DEV). **Recorded as an unattributed observation**: checkout continuity through the run is not
  evidenced and was not invented. State B and the PROD split-ownership census remain unrun; not an acceptance (runbook §32).
- **Update 2026-10-15 (PROD census):** the PROD component of the section 15 split-ownership census is DONE (read-only, `afldb_prod` as the least-privileged `afldb_app`; runbook §34): 17,056 matches, 136,448 period rows, 1,744 rows (218 matches)
  with the parent's source, 134,704 rows (16,838 matches) with a NULL source, **0 both-set-and-different, 0 mixed-source matches**; recorded separately from the DEV component (§31), which read the same shape. This supersedes the "PROD component outstanding"
  wording in Next action below. State B and the first attributable nightly remain separate unmet requirements; the 15 Oct night stays unattributed.
- **Update 2026-10-15 (next deployment prepared, runbook §36):** PREV `17514052` re-read read-only; the delta reviewed; a hashed pack with exact PREV/TARGET guards, the 18-path exception checked by full sha-256, rollback, a per-issue checklist and a read-only **watcher** that makes the next nightly's revision attributable (timestamped capture series) is built and locally tested. Nothing deployed or authorised. The next night also first runs the 293-301 nightly-path changes. State B and PROD remain.
- **Update 2026-10-16 (nightly watched, runbook §38):** the first AFL API nightly on `0cb3d20c` (batch 124, 05:01:44-05:03:14) ran under the read-only watcher: `COVERED` (38 captures, 5 during the run, 0 failed reads), clean on every marker, 64 refusals as before, 230 feed-revision payload versions appended (investigated, not a defect). **Sampled coverage only: the first-attributable-nightly requirement is NOT credited, no operator confirmation was invented, the AFL Tables run is not covered.** Open count unchanged.
- **Update 2026-10-16 (D-275-DEV-NIGHT-20261016, runbook §40):** the owner accepted sampled coverage as sufficient for the first-attributable-nightly requirement for **one DEV invocation only** (`32f1e78797f04277a68342e92598de02`, batch 124, 16 Oct). That requirement is now **satisfied under the amended criterion**; continuity in the 20 s gaps and from deployment to the watcher is not established; the 15 Oct run stays unattributed; no AFL Tables or PROD credit. **ISSUE-275 stays Open: State B durable Match Sheet behaviour (procedure prepared, not run) and PROD installation and acceptance remain.** This supersedes the "first attributable nightly" wording in the entries below.
- **Update 2026-10-16 (State B stage S-T executed, runbook §44, D-275-STATEB-ST-1):** migration 110 was applied to `afldb_test` only and the durable Match Sheet cases ran in State B on the ISSUE-275 revision (`settle-afltables` selection 15 passed; `data-editor` ISSUE-257 selection 20 passed, 32 skipped), with zero fixture residue; `afldb_test` now stays in **State B** (earlier State A claims on it no longer hold). Not run: the `settle-afl-api` 17.8 afl_api case (its harness rewrites real 2026 derived rows) and the wider files. **S-D is unapproved; DEV and PROD untouched. ISSUE-275 stays Open.** The S-D procedure is **prepared, not run, not approved** (`issues/open/AFLDB-ISSUE-275-SD-PROCEDURE.md`, runbook §45): each on-demand AFL Tables settle is the full 2026 chain with the effects listed there. Skipped with no credit: 2 role-parity cases and D-257-9 (5); the 17.8 afl_api case is unrun and uncovered.
- **Update 2026-10-16 (State B traced; 17.8 run; S-D packaged, runbook §47-§49):** the only approved wording is item 2 of the 14 Oct pack's §10 ("State B durable Match Sheet behaviour: unrun ... A separate requirement with its own procedure"): no criterion, no environment, no procedure, so S-D is not shown to be required and the item is **not marked satisfied** (owner decision O-2). The ISSUE-257 17.8 afl_api case now **passed on a fixture season** (new `tests/integration/settle-afl-api-state-b.test.ts`; zero residue; a three-layer negative control fails it); this supersedes "17.8 unrun and uncovered" above for that behaviour only. Still skipped with no credit: 2 role-parity cases and D-257-9 (5). S-D revision 2 and its review ZIP (`D:\tmp\issue275-sd-review-rev2.zip`, sha-256 `9436a157...9322`) are for review, **not run, not approved**.
- **Update 2026-10-16 (owner decision O-2, runbook §51): the State B requirement is satisfied on `afldb_test`** by S-T plus the isolated season-2071 AFL API test, **as an owner-defined criterion** (the original approved wording, item 2 of the 14 Oct pack's §10, had none). Evidence re-verified before recording (hashes, assertions identical to the original 17.8 case, guards, cleanup, three-layer negative control). **Kept:** the original 17.8 case is still unrun in State B; the 2 role-parity cases and D-257-9 (5) get no credit; the negative control shows combined protection only; the accidental row 359 stays disclosed; test-environment behaviour only, not DEV or PROD acceptance. **S-D is parked.** **ISSUE-275 stays Open: PROD installation and acceptance remain (R6).** This supersedes the State B items in the two entries above and below.
- **Next action (2026-10-16, runbook §51):** nothing is pending for State B (satisfied for the test environment by O-2; S-D parked, not a requirement). Remaining for ISSUE-275: **PROD installation and PROD acceptance**, behind R6 (no PROD deployment procedure; PROD stays at `cd3cf782`). Optional and unscheduled: the wider guard, the order pin and PostgreSQL negative control, registering the CRLF baseline failure, crediting the skipped cases. The earlier Next-action lines below are history.
- **Next action (2026-10-16, runbook §42; S-T has since been executed, see the update above):** only the optional S-D stage remains unapproved. Owner to approve a scope (the S-T half below is done): **S-T** (apply migration 110 to `afldb_test`, run the durable `settle-afltables`/`settle-afl-api`/`data-editor` cases on the ISSUE-275 revision; choose the final `afldb_test` state) and, separately, optional **S-D** (one live DEV decision on match 17275 / player 345 / `marks`, one Return to source, two on-demand AFL Tables settles). PROD installation and acceptance remain behind R6.
- **Runbook:** `issues/open/AFLDB-ISSUE-275.md`. **Next action:** the merge and push are done (`24ca412b` on `origin/main`). The ISSUE-274 + ISSUE-276 observation window is **closed** (D-OBS-274276-20261014), so the hold on a DEV install was released; **installed on DEV 2026-10-14 13:52 AEDT under D-DEV-275-281-288-1** (TARGET `17514052`, BUILD `2mH5otSwPUveE-pcn3LcF`, installation checks PASS; runbook §30). Acceptance is NOT met and stays open: the first attributable nightly (needs independent continuity evidence covering the full run), State B durable Match Sheet behaviour and the PROD component of the §15 split-ownership census (the DEV component was DONE 2026-10-14 14:09 AEDT, runbook §31: 17,056 matches / 136,448 period rows; 1,744 same-source rows (218 matches); 134,704 NULL-source legacy rows (16,838 matches) = unattributed, not proof of authorship; 0 rows with both sources set and different; 0 matches with mixed period sources; read-only, nothing repaired). PROD: the ISSUE-265-specific PROD hold was released by `a862d192`; PROD still needs its own reviewed procedure (`blockers.md` R6). Open: the PROD §15 split-ownership census (not done; the fix is forward-only). D-275-1 is resolved by the owner's instruction; the period-only retry was traced and is not part of this defect (§23.4).

### AFLDB-ISSUE-276 — AFL API period scores that contradict the final score are written
- **Severity:** Medium. **Area:** AFL API settle — `src/lib/acquisition/afl-api-settle-plan.ts`, `afl-api-bundle.ts`.
- **State:** Open (2026-10-08), review F-011, code-proven; implemented 2026-10-12 on `opus/issue-276-period-score-guard`, committed as `5b0ab6dc`
  (DB-free validation 428/428). **Merged to `main` as `3ec76f28` and installed on DEV 13 October 2026, 06:26:00-06:28:27 AEDT** (operator-verified; runbook §17.8): preflight and final gate passed, 110 migrations already applied
  (none applied), BUILD_ID `5sDQtjtkxAIUBO5bVn6mY`, MainPID 2609207 (started 06:28:25, `NRestarts` 2), installation checks exit 0 (24/24 healthy probes, all four workers, controls on/4/10, reviewed blobs match, ISSUE-274's
  three checked runtime blobs unchanged), no fallback. **Installation established; real-data nightly acceptance pending.** Finding lifecycle: resolves only on explicit positive evidence, on the planned AND the corroborated path (a new-then-foreign-owned match is reachable; an afl_api-to-foreign transfer is not).
  Integration file reworked 2026-10-12 after static review (baseline restore of shared 2026 derived rows with equality assertion; proven fixture ownership, read-only startup that stops on leftovers;
  atomic teardown and payload-row residue check; runbook §17.5).
  **Focused `afldb_test` acceptance supported (operator-run, 2026-10-12; runbook §17.7):** first run 3 passed, 1 failed on a test-reader bigint/integer mismatch (fresh-case later steps unexecuted); after the test-side reader fix, R2 passed 4/4
  (exit 0, no skipped cases, 65.61 s). Residue before, after the failed run and after R2: all 13 owned/unproven counts 0, no payload or fixture-conflict rows, captured `seasons`/`club_seasons` (excl. `id`) values identical to the baseline
  (`club_seasons.id` and sequences deliberately excluded). Baseline `player_season_stats` for 2026 was empty, so a non-empty Brownlow restore was not exercised. **Not established:** whole-suite, restricted-role, live-provider, DEV behavioural or PROD acceptance.
- **Runbook:** `issues/open/AFLDB-ISSUE-276.md`. The names `period_scores_contradict_final_score` / `afl_api_period_scores_contradiction` were reviewed and are kept; no naming decision is outstanding.
  **Limits:** all 218 DEV 2026 matches are `afltables`-owned, so the nightly is not expected to reach the refusal branch or finding lifecycle; a clean nightly shows no regression only. PROD neither installed nor accepted.
  **Next action:** the 14 October nightly (batch 122, 05:04:09-05:06:13) was observed as the combined ISSUE-274 + ISSUE-276 observation and graded **PASS, no regression**; the window is **closed** (D-OBS-274276-20261014; runbook 276 section 17.10) on the minimum evidence. The guard branch is NOT OBSERVED on DEV (all 218 matches are `afltables`-owned). PROD installation and acceptance remain; no closure recorded.

**AFLDB-ISSUE-278 resolved 2026-10-13** (merge-scoped; implementation commit `dd18adb93a0207eb2ed812ac56636a90e2c89239`, parent `e7f84f14`, fast-forwarded to `main` and pushed; documentation-only closure commit follows it). `db:test:rebuild` and `db:test:prove-reset` now assert the connected database and role before anything else runs, refuse a DSN that libpq would read differently from postgres.js (query-string redirects, host-less or default-port forms), and run their psql and stage children with the libpq routing variables removed. DB-free: `tests/db-test-rebuild.test.ts` 670/670, `tsc --noEmit` clean. Two verdicts, kept separate: Procedure A (read-only, `afldb_test`) PASSED 12/12 and was accepted; Procedure B attempt 2 (one attempt, `afldb_test` only) gave a **proof PASS** (the always-aborted real `RESET_SQL`, `psql exit 3`) and, separately, an **unchanged-observed-state MATCH** (Tier 1 `a39ad96b…`, Tier 2 `4f11fda9…`; 99 tables, 63 sequences, 1,454,440 rows digested). Attempt 1 stopped at the baseline (`text || "char"`) with no proof and no verdict. **Limits kept:** a MATCH is not proof that no sequence operation occurred; index/TOAST contents, extended statistics, publications, subscriptions, roles, database settings, large objects and planner statistics are not covered; no real rebuild has been run, so the rebuild-stream guard is proven by Procedure A and the DB-free tests only; Procedure A is a historical result about the pre-reboot postmaster; the unpinned control V4c was omitted. Readiness was **accepted under a scoped cleanliness exception, not a clean pass**: `merge:ready` BLOCKED by exactly one blocker (15 untracked primary-checkout paths: nine `.agents/skills` files and six zero-byte stray-named files), all left untouched with sizes and hashes re-verified at every checkpoint; the merge-mode preflight's only blocker was the same 15 paths. Not deployed; no deployment is required or implied. Runbook and both verification procedures: `issues/closed/AFLDB-ISSUE-278*.md` (§18).

### AFLDB-ISSUE-316 — AFL API cutover: retire AFL Tables network acquisition
- **Severity:** Medium. **Area:** data acquisition / source retirement — `data/reference/afltables-network.json`, `deploy/afldb-settle-afltables.sh`,
  `tools/rebuild/fitzroy/acquire_core.R`, `tools/rebuild/afltables/`, `src/lib/acquisition/settle-trigger.ts`, season rollover.
- **State:** Open (2026-10-18, owner change of direction). AFL Tables acceptance work stopped; T6 watcher and N1/N2 withdrawn (Windows task disabled,
  evidence preserved). Inventory, gap map and cutover procedure prepared. One fail-closed switch for every AFL Tables network path, bounded by
  `last_season` and retired by the 2026 rollover in the same write (machine-enforced), and a DB-free readiness report with season-feed venue, team and
  round coverage, implemented locally on `opus/afl-api-cutover` (uncommitted; the new suite 421 as last run (419 passed, 2 POSIX-only skipped; seven-suite set 829 passed, 2 skipped, 831), executed 2026-10-19 after the final pre-commit audit (follow-up 8) under proven isolation with `--no-cache --configLoader runner` and redirected `TEMP`/`TMP`; superseded history: 306 and 716 after follow-up 7, 293 and 703 after follow-up 5). The rollover accepts exactly `D-316-1`. C3 is inert
  install only; the D1 rehearsal is C4b, run by one command that restores the setting however it ends (`afl-api-c4b-rehearsal.ts`; the tool itself has never run on Linux, PostgreSQL or PROD, its tests have, DB-free, on Windows). D-316-13 is unavailable until C4 is deployed.
  Nothing deployed; the PROD AFL Tables timer is untouched; B1 stays.
- **V2 reconciliation (2026-10-21):** source/snapshot 19/19 verified; imported in `c9cca86d`; V2 quarantine/refusal intentional. Local focused 669 pass / 2 POSIX-only skip, packaged refusals 4/4, typecheck/lint PASS. No DEV/PROD execution; full C0/C1 and C2 pending.
- **DEV C1 shell subset (2026-10-21):** D-V2-316-C0C1-1 and D-DEV-316-C1-REFUSALS-1 approved; DEV refusal fixtures passed 4/4 (retired exit 0, out-of-bounds exit 1, runner exit 0) on `streamanator`. No active acquisition control, deployed app or audit behaviour verified.
- **DEV app-check preparation (historical, 2026-10-21):** read-only DEV baseline verified (ledger 110, pending exactly 111–117, ports 3201/3202 free); build `WkKKyr7KAoFmMb5QyM4MQ` of `fffef96f` packaged (sha256 `c829da08…e40b0e`) and locally rehearsed PASS on an isolated clone; no DEV writes during preparation. Plan and decision D-DEV-316-C1-APP-1: `docs/v2/issue316-dev-app-check-plan-2026-10-21.md`. Later attempt below supersedes the prepared status.
- **DEV app attempt (2026-10-21):** D-DEV-316-C1-APP-1 approved; identity/size/hash gates passed; steps 0–2 completed. STOP at step 3: exact archive contains an esbuild symlink despite the reviewed no-symlinks description. No extraction, package execution, DB connection, dump, migration or app check; port 3201 free; root/archive retained. DEV C1 NOT PASSED.
- **Amended continuation (2026-10-21):** owner permitted the exact sole esbuild link and retained-root reuse; amended safety checks, extraction without overwrite, all 13,209 hashes, preflight, secure config and read-only dump PASS. Source ledger/checksums 110/110, no synthetic users/audit rows; dump counts identical, hash rechecked. Candidate DB absent; no pid; port 3201 free. C1 PENDING.
- **DEV candidate C1 complete (2026-10-21):** owner confirmed creation; DB identity/owner/UTF8/locales/emptiness verified. Restore, migrations 111–117, privileges, checksum readback PASS. Real Super Admin action exact `legacy_retired` refusal + exactly one attributed audit row id 1100, loopback; N1/N2 zero audit rows. Original DEV guard unchanged, ledger/checksums 110/110, no synthetic writes. Candidate stopped, port 3201 free; DB/root/backup/C: evidence retained. Approved candidate acceptance PASS; no V1 replacement or production installation.
- **C2 offline review (2026-10-21):** completed inspection reused: identity/ledger 110/inspected ACLs match; 218 scored matches, GF Fremantle 89–96 Brisbane; latest snapshot still in_season_partial. R 4.3.3 meets R >=4.1 and all selected 56-package metadata constraints; later Node 22.23.2 meets locked loader requirements. Archive checksum/membership PASS; 1731 CRLF-only conversions recorded. Package source/native hashes and exact endpoints remain incomplete. No acquisition-ready artifact or C2 execution. Package: `docs/v2/issue316-c2-preparation-2026-10-21.md`.
- **CRAN source review (2026-10-21):** exact approved fitzRoy 1.8.0 download HTTP 200, 1222934 bytes, SHA-256 `33ed0817…8d0b54c`; safe extraction on restricted C:, no code execution. Reached endpoints: GitHub parquet (130 reads), live-tail season/match pages + GitHub mapping CSV, 21 AFL Tables club pages, bg3.txt (131 reads). No explicit retry/throttle/timeout; transport policy delegated. Source provenance in `docs/v2/issue316-c2-cran-source-2026-10-21.json`.
- **C2 consolidated decision (2026-10-21, package v4):** ready to request one approval, not executable-ready. DEV `streamanator` probe-first runner (R/fitzRoy there never inspected; negative probe stops, no install); unchanged acquisition recommended (sizes measured by pre-run HEAD, owner ceiling); stdlib run guard with canary replaces the three further source reviews. Gap: no existing gate requires completed-season stats to cover every results match; offline checks E1/E2/E4 run between acquisition steps, E3 (17056 matches) at Stage 2/3.
- **C2 bounded successor inputs (2026-10-21, package v5):** owner approved only the exact-evidence corrections/normalisations/four continuity extensions, historical comparison finding and local strict WF comparison. Acquired bytes rechecked 391/391; Brownlow 2026 pending. Current V2 validator reconstructs H&A+WF, removes only evidenced contributions and recomputes the full H&A table; focused DB-free verification recorded in the package. No successor acceptance/register or reference-switch change; 1,640 not approved.
- **Bounded DEV rehearsal (2026-10-21):** read-only preflight PASS, independently derived H&A club-season expectation 1,640 (not witness-derived). BLOCKED before cluster creation: full derived rebuild makes decided-GF 2026 complete and its Brownlow complete/not_applicable, so cannot preserve pending. Candidate bindings/gates/import/rebuild/real D7 NOT RUN; no database connection or DEV writes. Evidence `C:\tmp\afldb-c2-dev-rehearsal-20261021\REPORT.md`.
- **Pending-Brownlow fix (2026-10-21):** owner authorised code/tests/one commit and resumed isolated DEV rehearsal. Existing availability/publication decisions now gate full/targeted derived and authoritative public/medal/ranking projections; pending canonical match/round votes are not imported. No schema/reference/authority-metadata change. Focused checks 310 passed / 1 existing skip + 2 mutation contracts; typecheck/lint passed. Prior blocked attempt retained as history.
- **Runbook:** `issues/open/AFLDB-ISSUE-316.md`. **Next action:** commit the bounded implementation, then execute authorised candidate gates/import/derived/real D7 in fresh dedicated DEV cluster; 1,640 accepted for rehearsal only. Production successor/census/rollover/release decisions remain outstanding. Current state: `docs/v2/issue316-c2-preparation-2026-10-21.md`.
- **Supplement-free implementation (2026-10-21; current):** Owner approved proposal §§3–5 and database-free affected checks, one agent, basis `4a2eea89cccc465f2f017fb06ad55a7d4cb7733d`. Local runner/tests now support explicit `stats_input_mode` (`supplemented_baseline` / `baseline_only`); baseline-only requires explicit `supplements: []` plus a matching selected `baseline_snapshot_label`. Heights/coaches intentionally share these stats inputs. Legacy supplemented argv/order, manifest proofs, measured expectations and all strict final gates remain. Synthetic configuration only; no successor contract installed. Focused runner 38/38; height/coach suites 27/27; nonincremental `tsc --noEmit --incremental false` exit 0. Full runner 700 passed / 4 existing CLI tests failed at tsx startup (`uv_os_get_passwd ENOMEM`), before CLI execution. Changed-file lint: 8 errors / 13 warnings, exactly reproduced on basis blobs (no new findings); `git diff --check` clean. Bounded review 2026-10-22 found no material correctness/gate issue; scoped local commit authorised. Next: separately approve construction of a provenance-bound canonical export from an isolated clone of retained stopped rehearsal state (runbook §12); no execution/binding approval. All unmatched/name_mismatch rows, including four unresolved Collingwood goal discrepancies, stay rejected; jumpers informational; ET unresolved; all three 2026 Brownlow keys pending; production NO-GO.

### AFLDB-ISSUE-279 — Under Next.js 16 every sitemap segment is empty
- **Severity:** Medium. **Area:** public site / SEO — `src/app/sitemap.ts`.
- **State:** Open (2026-10-08), review F-014, reproduced DB-free by the review (W6); imported 2026-10-10. Implemented
  2026-10-14 (`c206d1d1`), DB-free validated, **merged to `main` as `cf1d49c3`, installed on DEV in `f07c2a74` on 2026-10-15, not on PROD** (readiness accepted under a
  scoped cleanliness exception, runbook §18).
- **Update 2026-10-15 (installed on DEV):** the fix is in `f07c2a74`, installed on DEV at 16:30 AEDT (BUILD_ID `Xr8x1v5iRTaLiR7h0ScFg`, re-read
  read-only the same day). Installation is not the §14 item 2 check: with `AFLDB_INDEXING` unset `sitemap.ts` returns `[]` by design (`src/lib/indexing.ts`),
  so the check cannot be run without a DEV settings change (indexing on, beta gate off), which was outside the authority given. **Parked.** Not on PROD.
- **Update 2026-10-15 (evening; runbook §20): the parked procedure was incomplete and is corrected.** `AFLDB_INDEXING` is read at **build** time and the sitemap is cached, so a restart cannot pass: the window is `.env` edit (both keys) -> `npm run build` -> restart, check, then restore -> `npm run build` -> restart. Prepared as `window-279.sh` (sandbox-tested 23/23, never run on a host) with the exposure implications in `issues/open/AFLDB-ISSUE-280-308-279-DEV-ACCEPTANCE.md` §6.
- **Runbook:** `issues/open/AFLDB-ISSUE-279.md` (§17, §17.1, §18, §19, §20). **Next action:** the owner's separate decision D-279-1 (and confirmation that DEV is not reachable outside the LAN), then the window in the combined procedure §6 and the §14 item 2 check: `/sitemap/0.xml` must contain at least one `<url>`; restoration verified. Close only then.

**AFLDB-ISSUE-280 resolved 2026-10-15, DEV-scoped** (code `c68e1214`; installed on DEV by the gated deployment of `0cb3d20c` at 22:07 AEDT; accepted 22:26-22:55 AEDT). DEV stayed at `0cb3d20c` (BUILD_ID `jfwHG_Ru35eHV1Q9_O6oy`); no redeployment. **D-280-1 amended (owner, 2026-10-15):** one magic-link issuance for `stuart.villanti@gmail.com` through DEV's existing journal fallback; no SMTP configuration and no external email. The address was first verified allowlisted and not revoked (`/admin/access`, read-only). Under the D-280-2 criterion (reviewed simulated prefetch, one human confirmation, refused replay): one link issued at 11:50:30 UTC (audit `beta.magic_link_issued`, `delivered=false`; exactly one journal line, redacted in every record); the owner obtained it privately (their own terminal read the journal line, the clipboard excluded from history) and pasted it into the hidden box of an isolated test-browser window; it was never in chat and never saved. Before confirmation, `prefetch-sim.py --expect confirm`: 3 GET 200 "Confirm sign-in", no `afldb_beta` cookie, no `Location`, HEAD 200, EXPECTATION MET (token sha256[:8] `8c6493a5`, 43 characters); audit before confirmation: issued present, **no** verified event (1,072 events; baseline 1,071). The owner pressed "Sign in to the beta" once at 11:51:19 UTC (I issued no click): httpOnly `afldb_beta` cookie, landed on `/`, exactly one `beta.magic_link_verified`. Replay in a brand-new cookie-less browser context (the link was read inside the browser process from the test page's history, never printed): GET 200 confirmation page, no `Set-Cookie`, no `Location`, robots `noindex, nofollow`, referrer `no-referrer`; the button pressed once; redirected to `/beta` with no cookie; the audit then still showed exactly one verified event (1,073 events = baseline + issued + verified; no `beta.magic_link_revoked_email`). Journal check since 22:27:31: PASS (523 lines; the three `ERROR` matches are HTTP-200 requests for the static chunk `error-*.js`; no syntax error, unhandled, ECONNREFUSED or digest line). Visual: V-280-1 (desktop 1280x800) and V-280-2 (mobile 390x844, no horizontal overflow) were captured at replay time, i.e. of the same link's confirmation page after its token was spent (a GET reads no table, so the page is identical), because the owner clicked before the unused page could be captured; V-280-3 is the signed-in landing. Screenshots are viewport-only; URL metadata is path `/beta/verify` with `token=<redacted>`. Credential hygiene: a leak scan of the evidence found no token or link. Effects: `beta_login_tokens` +1 row (hash only, now used), `auth_audit_log` +2; no allowlist, settings, `.env`, hook, schema or SMTP change; no email; PROD untouched. **Limits:** actual link-scanning gateway behaviour remains untested (D-280-2); the pre-fix defect was not reproduced on the previous build (the optional control was not authorised); the replay and the captures were driven by the browser tool, the confirmation click was the owner's. PROD installation and acceptance pending. Evidence (workstation, not in the repository): `D:\tmp\dev-deploy-280-308-20261015-r2\run-20261015-2227-280\` (`SHA256SUMS.txt`, 18 files; decisions verbatim in `OWNER-DECISIONS.md`; results in `accept\ACCEPTANCE-RESULTS.md`). Full record: `issues.md` (ISSUE-280 entry) and `issues/closed/AFLDB-ISSUE-280.md` §22.


**AFLDB-ISSUE-308 resolved 2026-10-15, DEV-scoped** (code `16f31a67` and `46cb380e`; installed on DEV by the gated deployment of `0cb3d20c` at 22:07 AEDT). ISSUE-308 DEV acceptance (2026-10-15, after the deployment of `0cb3d20c`): `award_winners` 118 (All-Australian 1987, "Matthew Campbell", Brisbane) was re-read first and still matched the reviewed evidence (unlinked, `unmatched`; player 9257 Matthew Campbell, Brisbane Bears 1987-1993, 79 games, born 30 Jan 1964); one Super Admin approval through the drawer (score 97 Very high, bulk-ready) returned "Suggested match approved." without hanging; the follow-up `POST /admin/player-links/revalidate` returned 200 `{"ok":true}` from worker 1 (pid 2084226, build `jfwHG_Ru35eHV1Q9_O6oy`); the public page `/awards/all-australian/1987` then served the link `/players/matthew-campbell-9257` on worker 1 in 24 of 24 fresh-connection requests (and, see limits, on every worker); the after-read shows id 118 `player_id` 9257 `resolved`, linked 3471 -> 3472, unlinked 241 -> 240, total and max_id unchanged, `fingerprint_excl_target` unchanged (`3e15c68aee8d6f0a264fcefc1010d2d7`), so no other row moved; `/admin/audit` shows exactly one new `player_link.suggestion_approved` (targetTable `award_winners`, targetId 118, playerId 9257). **D-308-3 (owner, 2026-10-15), recorded as an explicit amendment of R308 §14 item 2.** Original criterion, preserved as history: "on DEV: approve one suggestion and request the award page", which must show the linked player. Amended criterion: a successful revalidation and linked-player rendering **on the worker that answers the follow-up POST**; the other workers may retain their cached page until it expires. No cluster-wide invalidation is claimed: `revalidatePath` reaches one worker's ISR cache (per-worker caches, ISSUE-134), which is a limitation of the mechanism, not fixed here. Limits: the four workers all showing the link is **not** evidence of cluster-wide invalidation, because the deployment restart emptied every worker's cache after the pre-approval probe, so the per-worker limit was neither shown nor refuted; the `player_link_resolutions` row was not independently read (not claimed); the bulk-approve path was not exercised; screenshots are viewport captures (V-308-1..3) with exact URLs recorded; whether the ISSUE-087 hang reproduces on Next 16.3.1 stays unknown (this action never calls `revalidatePath`, and none was seen). D-308-2: restoration declined, so the approved link stays (with its resolution and audit history). PROD installation and acceptance pending. Full record: `issues.md` (ISSUE-308 entry) and `issues/closed/AFLDB-ISSUE-308.md` §22.

**AFLDB-ISSUE-277 resolved 2026-10-15** (merge-scoped; implementation, tests and records as `8450134b`, fast-forwarded to `main` and pushed; documentation-only closure commit follows). D-277-1 (owner): option (a), with the save-time replay-compatibility guard. A Data Editor save of `dob`, birth year, height, weight or notes for a player whose only durable identity is the `manual_admin_edit` token wrote no override, so the next replay re-created the old value while the audit row still named the change. `saveEdit` now plans, before the canonical write, a merge of the edited group into the player's active creation record, refuses the save whole when the merged record would fail the replay's own pre-check (no `display_name`, or a `dob` without a usable confidence), and otherwise writes the merge and its own `manual_identity_record` audit row in the same transaction. Players holding an AFL Tables identity are unchanged. Validation, on `afldb_test` only: 8 new PostgreSQL cases, including the real `replay_admin_overrides('players')` re-creating a deleted player with every edited value (rolled back) and a guard that agrees with that replay on four record shapes; the whole `data-editor` file 52 passed; the DB-free source contract 74 passed; 6 of 8 new cases fail on the unfixed source; 7 of 7 mutants killed; residue 0; `tsc` and `git diff --check` clean. A read-only census found 92 manual players on DEV and on PROD, none token-only. **Limits:** not deployed; no DEV or PROD write; a player with a token but no active record, or no identity at all, is still not durable (unchanged); the replay's `afltables_profile_path` arm is not mirrored. Detail: `issues.md` (ISSUE-277 entry) and `issues/closed/AFLDB-ISSUE-277.md` §17-§18. **DEV installation (15 Oct 2026):** this change is in `f07c2a74`, installed on DEV at 16:30 AEDT (BUILD_ID `Xr8x1v5iRTaLiR7h0ScFg`, re-read read-only the same day); installation is not acceptance, and no DEV check of it is claimed. Not on PROD. "Not deployed" above is the merge-time state.

**AFLDB-ISSUE-282 resolved 2026-10-15** (merge-scoped; implementation `9baba193`, records `5906e426`, fast-forwarded to `main` and pushed; documentation-only closure commit follows). Each of the five replace transactions (award winner, Hall of Fame inductee, honour-team member, first-kick goal, after-the-siren kick) returned the revalidation paths of the voided row only, so the created row's award, season, player, club, match or team pages stayed stale until their ISR window expired (up to a day). Each now reads the created row inside the transaction and returns the de-duplicated union of both rows' paths. Integration, on `afldb_test` only (database proved for the owner, importer and auth roles before any write): `admin-awards` 4 focused cases passed and `admin-special-records` 2, including new replace cases for honour-team members and after-the-siren kicks, which had none; the same cases fail 4 and 2 on the unfixed source; 16 of 16 mutants killed; fixture residue 0 on 14 selectors throughout. `tsc`, `eslint` and `git diff --check` exit 0. Readiness was accepted under a scoped cleanliness exception (18 paths), not a clean pass. **Limits:** not deployed; no browser, DEV or PROD action; the action layer's use of the returned paths was not exercised; the whole integration files and the awards file's python replay tests were not run; ISSUE-283 is separate. Detail: `issues.md` (ISSUE-282 entry) and `issues/closed/AFLDB-ISSUE-282.md` §17–§18. **DEV installation (15 Oct 2026):** this change is in `f07c2a74`, installed on DEV at 16:30 AEDT (BUILD_ID `Xr8x1v5iRTaLiR7h0ScFg`, re-read read-only the same day); installation is not acceptance, and no DEV check of it is claimed. Not on PROD. "Not deployed" above is the merge-time state.

**AFLDB-ISSUE-283 resolved 2026-10-15** (merge-scoped; implementation, tests and records as `f0a0c917`, fast-forwarded to `main` and pushed; documentation-only closure commit follows). The award create forms offered an "Administrative note (kept with the audit entry)" that the three award create actions never read, so every creation audit entry carried the row's public text as `data_edits.note`; in every replace the note reached only the voided or suppressed half. The create actions now pass `adminNote`, the award, Hall of Fame and honour-team inserts record it as the creation audit note (the row's text stays in `new_values`), and all five replace functions hand it to the created half; a plain special-record create, which has no admin-note field, is unchanged. A create (or special-record replace) with no note now writes an empty audit note instead of the record text. Integration, on `afldb_test` only (database proved for the owner, importer and auth roles before any write): `admin-awards` 7 new cases and `admin-special-records` 4, with 5 new DB-free action cases; the same cases fail 7, 3 and 3 on the unfixed source; 18 of 18 mutants killed. One fixture-residue incident (3 + 1 rows and 1 audit row from the first special-records run) was removed by id with a guarded script and the suite's purge extended; the final census read 0. `tsc`, `eslint` and `git diff --check` exit 0. Readiness was accepted under a scoped cleanliness exception (18 paths), not a clean pass. **Limits:** not deployed; no browser, DEV or PROD action; no real Server Action was driven with a session and a database together; the whole integration files and the awards file's python replay tests were not run; earlier audit rows are not repaired. Detail: `issues.md` (ISSUE-283 entry) and `issues/closed/AFLDB-ISSUE-283.md` §17–§18. **DEV installation (15 Oct 2026):** this change is in `f07c2a74`, installed on DEV at 16:30 AEDT (BUILD_ID `Xr8x1v5iRTaLiR7h0ScFg`, re-read read-only the same day); installation is not acceptance, and no DEV check of it is claimed. Not on PROD. "Not deployed" above is the merge-time state.

**AFLDB-ISSUE-284 resolved 2026-10-15** (merge-scoped; implementation, tests and records as `f43d4d59`, fast-forwarded to `main` and pushed; documentation-only closure commit follows). The Brownlow season aggregate counted a match as "imported" only while it had no workflow row, so a source-complete 3/2/1 that an Admin then saved as a draft fell out of `final`, `voided` and `imported`: the season read "not complete" and the Publish panel listed a blocker and disabled "Publish season…", while the publish transaction, the per-round tables and `isMatchAccounted` counted the match as accounted. The aggregate now returns an `accounted` count with the gate's own rule (voided, or a complete 3/2/1 whatever the workflow row is); the season summary's `complete` and status, the season page and `incompleteMatchCount` use it, and `imported` stays a display count. Integration, on `afldb_test` only (database proved for the owner, importer and auth roles before any write): one new case on its own seeded season (a drafted source-complete match stays accounted, the season reads complete, publish accepted) passed alone and with its neighbouring blocks (32 passed); 3 DB-free cases; the same cases fail on the unfixed source and 7 of 7 mutants are killed; fixture residue read 0 throughout. `tsc`, `eslint` and `git diff --check` exit 0. Readiness was accepted under a scoped cleanliness exception (18 paths), not a clean pass. **Limits:** not deployed; no browser, DEV or PROD action; the season page and list were not rendered; the whole integration file was not run. Detail: `issues.md` (ISSUE-284 entry) and `issues/closed/AFLDB-ISSUE-284.md` §17–§18. **DEV installation (15 Oct 2026):** this change is in `f07c2a74`, installed on DEV at 16:30 AEDT (BUILD_ID `Xr8x1v5iRTaLiR7h0ScFg`, re-read read-only the same day); installation is not acceptance, and no DEV check of it is claimed. Not on PROD. "Not deployed" above is the merge-time state.

**AFLDB-ISSUE-285 resolved 2026-10-15** (merge-scoped; implementation `70af9ae3`, records `848f13f1`, integration case `39f996c8` with records `fbe9715c`, all fast-forwarded to `main` and pushed; documentation-only closure commit follows). After a `duplicate` refusal of an award-winner replacement the `/admin/awards` Replace panel had no control to give the confirmation the action requires; it now offers the create form's `confirmDuplicate` checkbox for the refused preview only, and the confirm button posts it only when ticked. DB-free: `tests/awards-replace-panel.test.ts` 20 cases, six mutants killed by behavioural assertions. Integration: a new `admin-awards` case run against `afldb_test` (database proved before any write; the new case passed and the whole file passed 33 of 33) shows the duplicate refusal rolls the void back whole and that, with `confirmDuplicate`, the void, replacement, natural-key cross-linked overrides and audit rows persist; two mutants of the duplicate check were killed and fixture residue read back as zero. The first closure (`5f440acf`) had been withdrawn because §14's second item was unmet; both items are now met. Readiness was accepted under a scoped cleanliness exception (18 paths), not a clean pass. **Limits:** not deployed; no browser, DEV or PROD action; the panel wiring and query layer are proved by separate suites. Detail: `issues.md` (ISSUE-285 entry) and `issues/closed/AFLDB-ISSUE-285.md` §17–§20. **DEV installation (15 Oct 2026):** this change is in `f07c2a74`, installed on DEV at 16:30 AEDT (BUILD_ID `Xr8x1v5iRTaLiR7h0ScFg`, re-read read-only the same day); installation is not acceptance, and no DEV check of it is claimed. Not on PROD. "Not deployed" above is the merge-time state.

**AFLDB-ISSUE-289 resolved 2026-10-15** (merge-scoped; implementation, tests and records as `39622149`, fast-forwarded to `main` and pushed; documentation-only closure commit follows). D-289-1 (owner): option (a), narrowly. A fixture that was cancelled and whose game was then played could never be reinstated: the played lock refused every group, and `checkMoveTarget` would have refused `already_played` for the fixture's own match even past the lock. `isFixtureEditAllowed` now allows exactly `fixture_reinstated` on a `cancelled` fixture whose resolution is `played` or `played_home_away_differs`; `reinstateFixture` skips `already_played` only for that single own result. Every other group, an ambiguous resolution, a duplicate scheduled fixture and a club clash still refuse, and no `matches` row is written. The fixture page renders the lifecycle panel for such a fixture with Reinstate alone. Validation, on `afldb_test` only: DB-free 80 passed (9 new, 7 failing on the unfixed source), the whole `admin-fixtures` integration file 39 passed (3 new: create, cancel, play, reinstate, with the played match byte-identical afterwards, plus the duplicate and ambiguous refusals), 6 of 6 mutants killed, residue 0, `tsc`, ESLint and `git diff --check` clean. **Limits:** not deployed; no browser, DEV or PROD action; **`VISUAL: UNVERIFIED`** (structural render test only). Detail: `issues.md` (ISSUE-289 entry) and `issues/closed/AFLDB-ISSUE-289.md` §17-§18. **DEV installation (15 Oct 2026):** this change is in `f07c2a74`, installed on DEV at 16:30 AEDT (BUILD_ID `Xr8x1v5iRTaLiR7h0ScFg`, re-read read-only the same day); installation is not acceptance, and no DEV check of it is claimed. Not on PROD. "Not deployed" above is the merge-time state.

**AFLDB-ISSUE-292 resolved 2026-10-15** (merge-scoped; the fix `1d2ec9fb` was already on `main`; this closure is documentation only). The players branch of `getEntityNaturalKey` orders its identity query (`afltables_profile_url` rows first, then the smallest path), so a renumbered-profile player's edits are keyed under one path whatever the physical row order. The runbook's open question was run read-only on 15 October 2026 with a guarded script (owner role on `afldb_dev`; the read-only backup role on `afldb_prod`): **no player on either database has active overrides under more than one `afltables` key, and the replay's own equal-authority conflict query returns no rows on either** (DEV 95 active player overrides over 93 players, PROD 92 over 92; the four players holding two accepted profile paths carry none), so no repair is needed. **Limits:** the fix is not deployed (DEV at `17514052`, PROD at `cd3cf782` both predate it); the census is current state only. Detail: `issues.md` (ISSUE-292 entry) and `issues/closed/AFLDB-ISSUE-292.md` §17-§20. **DEV installation (15 Oct 2026):** this change is in `f07c2a74`, installed on DEV at 16:30 AEDT (BUILD_ID `Xr8x1v5iRTaLiR7h0ScFg`, re-read read-only the same day); installation is not acceptance, and no DEV check of it is claimed. Not on PROD. "Not deployed" above is the merge-time state.

**AFLDB-ISSUE-293 resolved 2026-10-15** (merge-scoped; implementation, tests and records as `8e49a9da` with ISSUE-294, fast-forwarded to `main` and pushed; documentation-only closure commit follows). The settle runs under-reported `dataIssuesResolved` in `import_batches.validation_result` and the CLI counters: the AFL Tables run assigned its end-of-run restored count over the healed apply-failure findings it had already summed, and the AFL API run discarded the counts of three `resolveRestoredDisagreements` calls (match-score restore, venue-identity restore, period-scores contradiction; the runbook named two at older line numbers). Both now add what they close; which findings are resolved is unchanged. Integration, on `afldb_test` only (database proved for the owner, importer and auth roles before any write): a new AFL Tables heal case, a new AFL API score-disagreement restore case, the venue self-heal case and the three ISSUE-276 restore runs assert the count; the same cases fail on the unfixed source; 4 of 4 mutants killed. Fixture census unchanged (12 pre-existing S6 batches untouched). `tsc` and `git diff --check` exit 0; ESLint reports the same 20 problems as unchanged `main`, none new. Readiness was accepted under a scoped cleanliness exception (18 paths), not a clean pass. **Limits:** not deployed; no browser, DEV or PROD action; earlier runs' counters are not repaired; the test files were run by filter, not whole. Detail: `issues.md` (ISSUE-293 entry) and `issues/closed/AFLDB-ISSUE-293.md` §17–§18. **DEV installation (15 Oct 2026):** this change is in `f07c2a74`, installed on DEV at 16:30 AEDT (BUILD_ID `Xr8x1v5iRTaLiR7h0ScFg`, re-read read-only the same day); installation is not acceptance, and no DEV check of it is claimed. Not on PROD. "Not deployed" above is the merge-time state.

**AFLDB-ISSUE-294 resolved 2026-10-15** (merge-scoped; implementation, tests and records as `8e49a9da` with ISSUE-293, fast-forwarded to `main` and pushed; documentation-only closure commit follows). The AFL Tables settle, the lineup store and the deprecated fallback importer closed their import batch with `completed_at = now()`, the transaction start, so a batch's completion equalled its start and run durations could not be read from the ledger; the AFL Tables settle also left `records_inserted` and `records_updated` at 0. All three now use `clock_timestamp()`, and the AFL Tables settle records `records_inserted = versionsAppended` and `records_updated = 0` (the table is append-only); the lineup store and the fallback importer already wrote their counts. Integration, on `afldb_test` only (database proved for the owner, importer and auth roles before any write): the AFL Tables first-apply case asserts the counts and `completed_at > started_at`, the lineup-store batch case asserts the completion instant, and a DB-free source-contract case covers all three writers (the fallback importer by SQL text only); they fail on the unfixed source and 7 of 7 mutants are killed. Fixture census unchanged. `tsc` and `git diff --check` exit 0; ESLint reports the same 20 problems as unchanged `main`, none new. Readiness was accepted under a scoped cleanliness exception (18 paths), not a clean pass. **Limits:** not deployed; no browser, DEV or PROD action; earlier batches keep `completed_at = started_at`; the legacy CSV promotion batch (ISSUE-307) is unchanged; the test files were run by filter, not whole. Detail: `issues.md` (ISSUE-294 entry) and `issues/closed/AFLDB-ISSUE-294.md` §17–§18. **DEV installation (15 Oct 2026):** this change is in `f07c2a74`, installed on DEV at 16:30 AEDT (BUILD_ID `Xr8x1v5iRTaLiR7h0ScFg`, re-read read-only the same day); installation is not acceptance, and no DEV check of it is claimed. Not on PROD. "Not deployed" above is the merge-time state.

**AFLDB-ISSUE-295 resolved 2026-10-15** (merge-scoped; implementation, tests and records as `dba8b2d0`, fast-forwarded to `main` and pushed; documentation-only closure commit follows). The settle exception report listed open `canonical_apply_failed` findings by type and owner only, which both settles share, so the AFL API report showed AFL Tables' failures as its own and vice versa, and the AFL API's per-run findings could fill the 20-row cut and hide AFL Tables' own. The apply-failure section is now narrowed by `details.source_key`, which every writer stamps; the disagreement section is unchanged. Integration, on `afldb_test` only (database proved for the owner, importer and auth roles before any write): two cases insert open findings under a private key prefix and show that each report lists only its own source's failures and that 21 AFL API findings no longer hide the one AFL Tables finding; both fail on the unfixed source and 4 of 4 mutants are killed; the fixture census is unchanged. `tsc`, `eslint` and `git diff --check` exit 0. Readiness was accepted under a scoped cleanliness exception (18 paths), not a clean pass. **Limits:** not deployed; no browser, DEV or PROD action; the report CLI and its rendered text were not run; the test file was run by filter, not whole. Detail: `issues.md` (ISSUE-295 entry) and `issues/closed/AFLDB-ISSUE-295.md` §17–§18. **DEV installation (15 Oct 2026):** this change is in `f07c2a74`, installed on DEV at 16:30 AEDT (BUILD_ID `Xr8x1v5iRTaLiR7h0ScFg`, re-read read-only the same day); installation is not acceptance, and no DEV check of it is claimed. Not on PROD. "Not deployed" above is the merge-time state.

**AFLDB-ISSUE-296 resolved 2026-10-15** (merge-scoped; implementation commits `03fb5bcd` and `074667eb`, records `10548157`, fast-forwarded to `main` and pushed; documentation-only closure commit follows). The deprecated fallback current-season importer (`writeMatches` in `src/lib/external-afl/current-season-import.ts`) wrote `import_batches.records_rejected` as the canonical plan's planning count while writing no `import_rejections` rows, contradicting the column contract (migration 001; ISSUE-244 F008). It now writes `0`; the planning count stays in `validation_result` and the function's return value. DB-free: one new source-contract case in `tests/current-season-import.test.ts`, 6 of 6 mutants killed, `tsc` and `eslint` exit 0; the file's one failure (ISSUE-122 S6 derived-helper wiring) is identical on unchanged `main`. Readiness was accepted under a scoped cleanliness exception (18 paths), not a clean pass. **Limits:** not deployed; the assertion is on the SQL text, not a live batch row; no PostgreSQL or integration run; earlier batch rows not repaired. **Open (operator decision, not a gate):** whether to retire the fallback path. Detail: `issues.md` (ISSUE-296 entry) and `issues/closed/AFLDB-ISSUE-296.md` §17–§18. **DEV installation (15 Oct 2026):** this change is in `f07c2a74`, installed on DEV at 16:30 AEDT (BUILD_ID `Xr8x1v5iRTaLiR7h0ScFg`, re-read read-only the same day); installation is not acceptance, and no DEV check of it is claimed. Not on PROD. "Not deployed" above is the merge-time state.

**AFLDB-ISSUE-299 resolved 2026-10-15** (merge-scoped; the fix `091e4635` was already on `main`; this closure is documentation only). The R lineup and roster acquirers now refuse an existing non-empty output directory before the contract is read and before any network call (an empty directory is still accepted), so a second run with the same scope can no longer rewrite the first run's artefact and manifest. The runbook's operator-run networked double run was performed on 15 October 2026 for both scripts into fresh scratch directories (lineups for season 2026 round 20, rosters for 2026): the first run of each fetched (468 lineup rows; 812 roster rows) and **the second run of each exited 1 with the guard's message, made no request, and left the first run's files byte-identical.** **Limits:** one lineup round and one roster season from one workstation; nothing is deployed. Detail: `issues.md` (ISSUE-299 entry) and `issues/closed/AFLDB-ISSUE-299.md` §17-§20. **DEV installation (15 Oct 2026):** this change is in `f07c2a74`, installed on DEV at 16:30 AEDT (BUILD_ID `Xr8x1v5iRTaLiR7h0ScFg`, re-read read-only the same day); installation is not acceptance, and no DEV check of it is claimed. Not on PROD. "Not deployed" above is the merge-time state.

**AFLDB-ISSUE-301 resolved 2026-10-15** (merge-scoped; implementation, tests and records as `0d3d03b5`, fast-forwarded to `main` and pushed; documentation-only closure commit follows). `requestAflApi` called `fetch` with no `AbortSignal` and read the response body outside its retried region, so an upstream that accepted the connection and then stalled hung the run until systemd killed it, and a body-stream failure escaped as a bare `TypeError` past the backoff and the 401/403 logic. Each attempt, body read included, now runs under a deadline (a signal handed to `fetch` plus a race, so a transport that ignores the signal cannot hang the run), and a timeout or a failed body read is retried like a network failure. **The timeout is an implementation default of 60 s per attempt**, taken under the runbook's "operator or implementation choice"; it is not a measured figure and not an owner decision, and `RetryOptions.timeoutMs` overrides it. DB-free: five fake-timer cases with stub transports fail on the unfixed source and pass fixed; 449 neighbouring cases pass; 7 of 7 mutants killed; `tsc` and `git diff --check` exit 0; ESLint reports the same problem set as unchanged `main`. Readiness was accepted under a scoped cleanliness exception (18 paths), not a clean pass. **Limits:** not deployed; no network, DEV or PROD action; the behaviour against the real upstream is not exercised. Detail: `issues.md` (ISSUE-301 entry) and `issues/closed/AFLDB-ISSUE-301.md` §17–§18. **DEV installation (15 Oct 2026):** this change is in `f07c2a74`, installed on DEV at 16:30 AEDT (BUILD_ID `Xr8x1v5iRTaLiR7h0ScFg`, re-read read-only the same day); installation is not acceptance, and no DEV check of it is claimed. Not on PROD. "Not deployed" above is the merge-time state.

**AFLDB-ISSUE-304 resolved 2026-10-15** (merge-scoped; implementation, tests and records as `074c01ae`, fast-forwarded to `main` and pushed; documentation-only closure commit follows). The email poller forwarded an attachment of any size, base64-encoded into one JSON POST, and the intake route ran `request.json()` on the whole body before it looked at the sender or the base64 length, so a 40 MB attachment from any mail-authenticated sender was held in an app worker's memory only to be answered 403 or 400. The poller now refuses an attachment over the 5 MiB upload ceiling (reported, filed to Errors, counted as rejected, never encoded or posted; an attachment of exactly 5 MiB is still forwarded), and the route answers a declared `Content-Length` over the base64 limit plus a 16 KiB envelope allowance with 400 before parsing, after the secret check. A body with no or an unreadable length is parsed as before. DB-free: a Python self-test over `main()` (at the limit, one byte over, small; live and `--dry-run`) with a parity check against the app's constant, and five route cases with a spied `json()`, fail on the unfixed source and pass fixed; 11 of 11 mutants killed (one first survived and drove an added case); `tsc`, `py_compile`, `eslint` and `git diff --check` clean. Readiness was accepted under a scoped cleanliness exception (18 paths), not a clean pass. **Limits:** not deployed; no mail, network, DEV or PROD action; the poller is dormant on both hosts; a chunked body is not bounded before parsing; the intake integration file was not run. Detail: `issues.md` (ISSUE-304 entry) and `issues/closed/AFLDB-ISSUE-304.md` §17–§18. **DEV installation (15 Oct 2026):** this change is in `f07c2a74`, installed on DEV at 16:30 AEDT (BUILD_ID `Xr8x1v5iRTaLiR7h0ScFg`, re-read read-only the same day); installation is not acceptance, and no DEV check of it is claimed. Not on PROD. "Not deployed" above is the merge-time state.

**AFLDB-ISSUE-305 resolved 2026-10-15** (merge-scoped; implementation commits `d82e891e` and `5282322b`, records `1ba75b06`, fast-forwarded to `main` and pushed; documentation-only closure commit follows). Legacy intake validation now refuses a `match_results` `match_date` or `player_bio` `dob` that is not a real calendar day (`2024-02-30`), and a `player_bio` `height_cm` or `weight_kg` that is not plain digits in range (`1.8e2`, `0x50`, `80.0`), instead of letting the `::date` / `::smallint` cast fail at promotion and roll the submission back to `failed`. DB-free: 39 new cases (25 fail on the old source), `tests/ingest-datasets.test.ts` 299 passed, `tsc` and `eslint` exit 0, 9 of 10 mutants killed (the tenth is equivalent). Readiness was accepted under a scoped cleanliness exception (18 paths), not a clean pass. **Limits:** not deployed; no PostgreSQL or integration run. **Open follow-up (operator decision, not a gate):** `rising_star` `votes` and stat-line cells are not validated (H-305-1 determined: no CHECK on `award_nominations.votes`). Detail: `issues.md` (ISSUE-305 entry) and `issues/closed/AFLDB-ISSUE-305.md` §17–§18. **DEV installation (15 Oct 2026):** this change is in `f07c2a74`, installed on DEV at 16:30 AEDT (BUILD_ID `Xr8x1v5iRTaLiR7h0ScFg`, re-read read-only the same day); installation is not acceptance, and no DEV check of it is claimed. Not on PROD. "Not deployed" above is the merge-time state.

**AFLDB-ISSUE-307 resolved 2026-10-15** (merge-scoped; implementation, tests and records as `0d7810d8`, fast-forwarded to `main` and pushed; documentation-only closure commit follows). The legacy CSV promotion stamped `records_read = records_inserted = rows.length` and left `records_updated` at 0, so every `ON CONFLICT DO UPDATE`, every `player_bio` update and every `match_attendance` update that touched no row was counted as an insert. The six dataset writers' `promoteRow` now return `inserted`, `updated` or `noop` (the four upserts through `RETURNING (xmax = 0) AS inserted`, the two updates through `RETURNING id`), and the batch records `records_inserted` and `records_updated` from those outcomes; a row that matched nothing is in `records_read` only. Integration, on `afldb_test` only (database proved for the owner, importer and auth roles before any write; the promotion runs under the real import role): a new match is `read 1 / inserted 1 / updated 0`, a re-promoted match beside a new one `2 / 1 / 1`, player stats `1 / 1 / 0` then `1 / 0 / 1`, and a biography file whose second player was deleted after validation `2 / 0 / 1`; six DB-free cases cover all six writers; all fail on the unfixed source (which reports `inserted 2` for the mixed file) and 10 of 10 mutants are killed. The 147 promotion batches the runs left were removed by a guarded script and the batch census is back at its starting 690. `tsc` and `git diff --check` exit 0; ESLint reports the same problem set as unchanged `main`. Readiness was accepted under a scoped cleanliness exception (18 paths), not a clean pass. **Limits:** not deployed; no browser, DEV or PROD action; earlier batches are not repaired; the batch's `completed_at` still equals its start; the `xmax` semantics were exercised for `matches` and `player_match_stats`, not for the award tables or `match_attendance`; the match-results file's ISSUE-264 block does not run on `afldb_test` (pre-migration-110), identically on `main`. Detail: `issues.md` (ISSUE-307 entry) and `issues/closed/AFLDB-ISSUE-307.md` §17–§18. **DEV installation (15 Oct 2026):** this change is in `f07c2a74`, installed on DEV at 16:30 AEDT (BUILD_ID `Xr8x1v5iRTaLiR7h0ScFg`, re-read read-only the same day); installation is not acceptance, and no DEV check of it is claimed. Not on PROD. "Not deployed" above is the merge-time state.

**AFLDB-ISSUE-310 resolved 2026-10-15** (merge-scoped; implementation commits `3961d6fd` and `616e383b`, records `cc711d81`, fast-forwarded to `main` and pushed; documentation-only closure commit follows). The AFL API link path now takes the player's stable identity from the forward classifier (`classifyAflApiForwardIdentityRows`) and refuses a player with two non-pair AFL Tables paths, or two manual tokens, as T7; a continuity pair stores the rule's continuing path. The revoke ledger row keeps a deterministic fallback (`player_identity` is `NOT NULL`). DB-free: 6 new cases (3 fail on the old source), 4 of 4 mutants killed, file 162 passed with the pre-existing I14 failure. Readiness was accepted under a scoped cleanliness exception (18 paths), not a clean pass. **Limits:** not deployed; no PostgreSQL or integration run; the DEV/PROD collation is unknown and existing ledger rows are not audited. Detail: `issues.md` (ISSUE-310 entry) and `issues/closed/AFLDB-ISSUE-310.md` §17–§18. **DEV installation (15 Oct 2026):** this change is in `f07c2a74`, installed on DEV at 16:30 AEDT (BUILD_ID `Xr8x1v5iRTaLiR7h0ScFg`, re-read read-only the same day); installation is not acceptance, and no DEV check of it is claimed. Not on PROD. "Not deployed" above is the merge-time state.

**AFLDB-ISSUE-313 resolved 2026-10-13** (merge-scoped; implementation commit `d43207c1d349d32d71fc6e135229b5cd5812199c`, parent `5ffbc563`, fast-forwarded to `main` and pushed; documentation-only closure commit follows it). Every `psql` the TypeScript database tooling launches now gets a password-free `-d` value and the password in the child's `PGPASSWORD`; unmovable or ambiguous password forms are refused before psql starts (D-313-6, approved). DB-free: `tests/db-test-rebuild.test.ts` 589 passed (61 new); real-psql pack V1–V6 PASS on `streamanator` (psql 16.15). Readiness was accepted under a scoped cleanliness exception, not a clean pass. **Limits:** not end-to-end `privileges.ts` acceptance (D-313-1); V5 had 4 periodic samples; the credential launcher was outside the pack manifest; Windows, `root` visibility and PROD not verified; not deployed. Detail: `issues.md` (ISSUE-313 entry) and `issues/closed/AFLDB-ISSUE-313.md` §22.

**AFLDB-ISSUE-314 resolved 2026-10-13** (merge-scoped; implementation commit `c47709ad475c99c617d0b393af323607d107f2a8`, parent `24ca412b`, fast-forwarded to `main` and pushed; documentation-only closure commit follows it). `prepare-promotion-source --apply` now refuses an unusable `--record-out` before it verifies, connects or writes. DB-free: Windows 464 passed | 1 skipped; Linux (`streamanator`, Node v22.23.2) `-t ISSUE-314` 9 selected, 9 passed, 0 failed, 0 skipped. Readiness was accepted under a scoped cleanliness exception, not a clean pass. No real `--apply` or promotion was run; the `cannot be inspected` branch is untested; an unwritable directory, a full disk and a path created after the check are still found only by the final write. Detail: `issues.md` (ISSUE-314 entry) and `issues/closed/AFLDB-ISSUE-314.md` §17.9.

**AFLDB-ISSUE-312 and AFLDB-ISSUE-315 resolved 2026-10-13** (merge-scoped; commits `5d277ddd` and `9c279f5c`, merge `01976be7` onto local `main`, not pushed or deployed). ISSUE-312: a detached HEAD no longer breaks the migration safety scan (DB-free 37/37). ISSUE-315: the O1 statement extractor uses the TypeScript parser (DB-free 14/14; `afldb_test` `-t "obligation O1"` 3/3). Limits and the integration gate results are in `issues.md` (resolved note and the ISSUE-315 entry) and `issues/closed/AFLDB-ISSUE-312.md` §18.

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
