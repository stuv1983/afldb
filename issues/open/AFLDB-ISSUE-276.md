# AFLDB-ISSUE-276 — AFL API period scores that contradict the final score are written

## 0. Status

- **Status:** Open (2026-10-08). Implemented locally 2026-10-12 on `opus/issue-276-period-score-guard` (base `6f99b58d`); uncommitted, not merged, installed on DEV or deployed. Focused `afldb_test` acceptance is **SUPPORTED** (2026-10-12, operator-run): after a first run that passed 3 and failed 1 on a test-reader type mismatch (§17.6), the corrected file passed **4/4** (§17.7), with the residue query showing zero owned/unproven rows and the shared 2026 digests identical to the pre-run baseline. This is not whole-suite, restricted-role, live-provider, DEV or PROD acceptance. A static-review correction pass (2026-10-12) reworked the file's shared-state restoration, ownership proof and payload cleanup; see §17.5. See §17.
- **Severity:** Medium. **Area:** acquisition / AFL API settle / data integrity.
- **Key files:** `src/lib/acquisition/afl-api-settle-plan.ts` (`planRosterFamily`), `src/lib/acquisition/afl-api-bundle.ts`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-011; partition note R4b-F02). The main session grepped the flag's consumers.
- **Classification:** code-proven.

## 1. Summary

The AFL API bundle computes `periodScoresReproduceFinalScore`: do the match-roster widget's cumulative period scores reproduce the fixture's final score? The bundle's own doc calls this check "§9 assertion 4". The flag is never consulted by the settle plan or the writer, so a `false` result still yields a planned roster family, and the contradicting period scores are written to `match_period_scores`.

## 2. Evidence

- `src/lib/acquisition/afl-api-bundle.ts:1154-1158` (flag doc) and `:1209-1215` (flag computed).
- `src/lib/acquisition/afl-api-settle-plan.ts:356-366`: `planRosterFamily` decides on `rosterRecord.deferral` and the match target only.
- Repository grep: the flag is consumed only by `tools/current-season/emit-afl-api-bundle.ts:457-460` (the backtest report).
- `src/lib/acquisition/settle-afl-api.ts:705-722`: `cumulativePeriodsOf` checks only intra-roster consistency. `:1458-1477`: the period proposal. `canonical-apply.ts:844-856`: the upsert.
- Contrast: `local_time_contradiction` refuses (`afl-api-bundle.ts:1109-1116`).

## 3. Trigger

A CONCLUDED fixture (home 100, away 80) whose separately fetched match-roster payload carries a stale or partial `recentMatchScores` entry. For example, its periods sum to 70/55, or it has three periods only.

## 4. Expected invariant

A `false` cross-family check refuses the roster family (for example `period_scores_contradict_final_score`) and records a data issue. A `null` result (no own-match entry) stays skipped.

## 5. Actual behaviour

The roster record is planned, and the contradicting checkpoints are written. The match row and its period rows then disagree.

## 6. First wrong layer

`src/lib/acquisition/afl-api-settle-plan.ts:356-366`.

## 7. Impact

Canonical quarter checkpoints whose final cumulative points differ from the match result. NL quarter/half/three-quarter-time answers compile over `match_period_scores`.

## 8. Reproduction / witness

Not executed. A DB-free witness was proposed in the R4b notes: build a bundle whose roster periods sum to 70/55 against a 100/80 fixture, then call `buildAflApiSettleRecords`. The expectation is a deferral or rejection; today the record carries a projection.

## 9. Disproof attempts

No gate exists in `settle-afl-api.ts`, `canonical-apply.ts` or `afl-api-settle-plan.ts`, and `buildAflApiSettleRecords` creates no deferral from the flag.

## 10. Existing-issue search

- `issues.md` was searched for `cumulative`, `assertion 4` and `periodScoresReproduceFinalScore`. The hits are ISSUE-048 (NL compile) and backtest tallies only.
- Classification: **new**.

## 11. Scope

Gating the roster family on the flag.

## 12. Out of scope

AFL Tables period scores.

## 13. Proposed fix boundary

In `buildAflApiSettleRecords` or `planRosterFamily`, map `periodScoresReproduceFinalScore === false` to a roster-family refusal, and record a data issue in the writer.

## 14. Proposed validation

DB-free: `tests/afl-api-settle-plan.test.ts` or `tests/afl-api-match.test.ts` with the bundle in §8, asserting that the roster record carries no projection.

## 15. Decisions / unresolved questions

- The refusal reason name and its data-issue type (operator or implementation choice).
  **Implementation choice (2026-10-12), reversible before merge:** reason `period_scores_contradict_final_score`
  (the runbook's own example); data-issue type `afl_api_period_scores_contradiction`. No operator ruling was sought or given.

## 16. Next action

The operator-run focused `afldb_test` integration run (§17.4 item 2) and residue captures (§17.4 item 3) are done (§17.7). Next: operator review and commit of the nine-file change set, an operator ruling or acceptance on the two names in §15, then merge, DEV deployment and smoke (§17.4 items 1 and 4). The issue stays open until those are met.

## 17. Implementation (2026-10-12)

### 17.1 Root cause and behaviour

Root cause as recorded in §6: `planRosterFamily` (`afl-api-settle-plan.ts`) decided on `rosterRecord.deferral` and the match target only, and
nothing downstream read `AflApiMatchBundle.periodScoresReproduceFinalScore`.

- `src/lib/acquisition/afl-api-settle-plan.ts`: `planRosterFamily` now takes the bundle. Order of precedence: deferral, then blocked match,
  then `periodScoresReproduceFinalScore === false` => `{ status: 'refused', reason: 'period_scores_contradict_final_score', detail }`
  (detail = the roster's final cumulative vs the fixture's final score, with the period counts), else `planned`. `null` is strictly not a
  refusal. New export `PERIOD_SCORES_CONTRADICT_FINAL_SCORE`; `AflApiRosterFamilyPlan` gains the `refused` member.
- `src/lib/acquisition/settle-afl-api.ts` (planned-match branch): a `refused` roster plan builds no `match_period_scores` target, so
  neither the automatic path nor a review-first promotion candidate can carry the contradiction, and opens an
  `afl_api_period_scores_contradiction` `data_issues` finding (`error`, entity `matches`, key `afl_api|match_roster|<id>|match_period_scores`).
  A `planned` roster plan resolves an open finding under that key (`resolveRestoredDisagreements`, owner-stamped) **only when
  `bundle.periodScoresReproduceFinalScore === true`** (see "Lifecycle defect corrected" below).
- Deliberately unchanged: the match family and player units; the typed staging projection (`staging.afl_api_match`, an observation audit
  surface the canonical writer never reads back); the corroborated branch's period-score WRITING (it writes none; its finding
  lifecycle was corrected on 2026-10-12, see "Corroborated-match path" below); existing canonical
  `match_period_scores` rows (a refusal neither deletes nor rewrites them); settle counters and the CLI report (no new counter, so no
  report-shape or source-scrape test changes; the finding is counted in `dataIssuesOpened`/`dataIssuesRefreshed`).

**Lifecycle defect corrected (2026-10-12, found by tracing the finding's resolution path while authoring §17.3).** The first
implementation resolved the open finding on *every* `planned` roster plan. `planRosterFamily` returns `planned` for a `null` check
(no own-match score entry in the roster payload), so a later run with **no usable period evidence** marked a standing
contradiction finding `source_agreement_restored` although nothing had been checked, and the contradicting data stayed
unreviewed. The resolution is now guarded by `bundle.periodScoresReproduceFinalScore === true` (positive evidence), at the
resolution call in the planned-match branch of `settle-afl-api.ts`. Paths traced and found already correct: a **deferred** roster
and a **blocked** match never reach the planned-roster branch, so neither touches the finding.

**Corroborated-match path (2026-10-12; traced, fixed).** The first pass left the corroborated branch alone and recorded the residual
"a finding opened while the match was `afl_api`-owned stays open if it later resolves as foreign-owned", reachability unexamined. Now examined:

- *Ownership transfer of an existing row is NOT reachable.* `canonical-apply.ts:797-814` (§19.1(e)): no code path sets `matches.source_id` on
  an UPDATE; every other `UPDATE matches` in `src/` and `tools/` (`canonical-apply.ts:866`/`1513`, `datasets.ts:1826`, `data-edits.ts:388-476`,
  `repair-match-rekeys.ts:623`, `common.py:1988`) sets attendance, time, notes, scores or `source_record_id`, never `source_id`; a DB promotion
  or rollover that would re-own an `afl_api` row is refused (`promotion-check.ts:1937-1948`, `rollover-season.ts:81-85`).
- *A new-then-foreign transition IS reachable.* A finding is written for a `new_target` plan before any row exists (`entity_id` NULL). A review-first
  run (`autoApply: false`) proposes the INSERT as a candidate and writes no match; an apply-time refusal also leaves none. If another source (AFL
  Tables, a declared co-source) then creates that fixture, the next `afl_api` run resolves it by `match_key` as `corroborated`. That branch never
  touched the finding, so a contradiction that has since been corrected stayed open for ever.
- *Fix* (`settle-afl-api.ts`, `resolvePeriodScoresFindingOnPositiveEvidence`, now called from the planned AND the corroborated branch): resolve only when
  the roster plan is `planned` (so not deferred, blocked or refused) AND `periodScoresReproduceFinalScore === true`. On a corroborated match a roster that
  still contradicts, has no own-match score entry or is deferred leaves an existing finding exactly as it is; nothing is opened or refreshed there,
  because afl_api writes no period scores for a foreign-owned match, so a new finding would describe no withheld write. The explicit-`true`
  guard on the planned path is unchanged.

### 17.2 Validation actually run (2026-10-12; no database, host, network, build, rebuild, settle, migration or deploy)

Worktree `node_modules` is a local junction to `D:\dev\afldb\node_modules` (`package-lock.json` hashes identical); no `.env`, so no DSN was
set (`tests/setup.ts` therefore configured no database). Commands were run with the user's explicit authorisation for this task.

- `npx vitest run tests/afl-api-settle-plan.test.ts tests/afl-api-match.test.ts tests/afl-api-ingestion-safety.test.ts`:
  3 files, 428 tests passed (the settle-plan file is 53 tests, 8 of them new). Both other files use injected stub fetch / source scrapes.
- New cases in `tests/afl-api-settle-plan.test.ts` (`AFLDB-ISSUE-276` block): the precondition (`periodScoresReproduceFinalScore === false` for
  both mutations); refusal for "three periods only" (77-95 vs 122-131) and for a stale fourth period (83-101); refusal against an existing
  afl_api-owned target; a valid score still `planned`; `null` evidence still `planned`; deferral precedence; blocked-match precedence.
  With the guard temporarily disabled the three refusal cases failed (3 failed, 50 passed); restored, all pass.
- `npx tsc --noEmit -p tsconfig.json`: exit 0 (not `npm run typecheck`, which also runs `next typegen`).
- `npx eslint` on the three changed files: only the 3 pre-existing `no-explicit-any` errors at `tests/afl-api-settle-plan.test.ts:50,58,59`.

Re-run after the lifecycle correction, the corroborated-path fix and the move to an isolated integration file (2026-10-12, still no database: no `.env`, no `AFLDB*`/`DATABASE*`/`PG*` environment variable present):

- `npx vitest run tests/afl-api-settle-plan.test.ts tests/afl-api-match.test.ts tests/afl-api-ingestion-safety.test.ts`: 3 files, 428 passed (unchanged; none of these exercises the writer branch).
- `npx tsc --noEmit -p tsconfig.json`: exit 0 (covers the new integration file, which type-checks but has **not been executed**).
- `npx eslint src/lib/acquisition/settle-afl-api.ts tests/integration/settle-afl-api-issue276.test.ts`: exit 0, clean. `tests/integration/settle-afl-api.test.ts` is byte-identical to `HEAD` again (this change's block and helper additions were removed); its 19 errors and 1 warning are pre-existing.
- One unrelated DB-free failure exists at `HEAD`: `tests/player-link-mutations.test.ts` "I14 owns its actor and its teardown needs nothing from setup" fails on `expect(suite).not.toMatch(/FROM auth_users ORDER BY/)` because `tests/integration/settle-afl-api.test.ts:2881` (the ISSUE-257 describe) contains that statement. It is independent of ISSUE-276 and was not touched.

Re-run after the static-review corrections (§17.5; 2026-10-12, still no database, host or network):

- `npx vitest run tests/afl-api-settle-plan.test.ts tests/afl-api-match.test.ts tests/afl-api-ingestion-safety.test.ts tests/db-test-rebuild.test.ts tests/audit-link-fk-indexes.test.ts`: 5 files, 961 passed.
- `npx tsc --noEmit -p tsconfig.json`: exit 0. `npx eslint` on the integration file and the two changed source files: exit 0.
- A temporary DB-free scratch test (written, run once, deleted; not in the diff) built the bundle for all four provider ids under all five mutations the cases use (valid, three periods only, no own score entry, LIVE roster, no venue timezone) and confirmed that **all 80 settle records** carry an exact quoted namespace marker in their payload (match: the provider id; roster: both; player stats: the rewritten player ids only, so the stats payload does NOT contain the match id).
- **Not machine-checked:** the SQL in the integration file and in `AFLDB-ISSUE-276-RESIDUE.sql` (no local PostgreSQL or SQL parser is available, and no database may be contacted). Both were reviewed by hand against the migrations only.

### 17.3 Authored but NOT RUN (no DB-free execution path; no database was contacted)

> **Status update (2026-10-12):** the heading and the wording below record the position when this section was written. The four cases were subsequently run by the operator on `afldb_test`: 3 passed and 1 failed on a test-reader type mismatch (§17.6), then 4/4 passed after the reader fix (§17.7). Their SQL and the residue SQL have now been executed.

Four integration cases live in their own file, `tests/integration/settle-afl-api-issue276.test.ts` (describe title begins `AFLDB-ISSUE-276`). **They have never been executed; passing is unproven, and a fixture or assertion mistake is possible.**

**Why a separate file.** The ISSUE-228 suite's file-level hooks (`beforeAll`/`beforeEach`/`afterAll`) run a broad baseline before every case, including a focused `-t` run:
`cleanup()` (every `issue228-integration` batch, every `%CD_M2026ISSUE228%` row, the shared keep-alive match), a rebuilt synthetic player and bridge, and a full recompute of the
shared 2026 `seasons`/`club_seasons` rows. The ISSUE-276 file has its own narrow hooks and imports nothing from the ISSUE-228 file.

**Setup / shared writes / cleanup scope** (full statement in the file header):

- *Namespace:* provider ids `CD_M2026ISSUE276A/B/C/D`; dates 2026-06-15/16/17/22 (Mon/Tue/Wed/Mon); batch marker `snapshot=issue276-integration;`; keep-alive `CD_M2026ISSUE276-keepalive`. Every provider player id in the cloned payloads is rewritten to `CD_I276<digits>`, so no fixture player can resolve to a real or ISSUE-228 bridged player: all player units refuse as `unresolved_identity`, and the file writes no `players`, `external_identities`, `player_match_stats`, `player_clubs` or player-derived row.
- *Guards (before any write):* `import './guard'` first (DSN required, `_test` database, preflight); `current_database()` re-checked; a session advisory lock excludes a second run of this file; the live schema is checked against the restoration's column lists (§17.5 item 1); the whole namespace is inspected read-only and **any** hit stops the run, deleting nothing (§17.5 item 2); foreign `possible_existing_match` conflicts are checked (startup, then before every case); only then is the shared baseline captured and `writesAllowed` set. `tests/setup.ts` is unchanged.
- *Writes by the file itself:* at most one keep-alive `matches` row (only if afldb_test holds no non-final 2026 match, since the writer's `recomputeClubSeasons()` fails closed on that) and case D's afltables-owned `matches` row. Both are tracked by `INSERT ... RETURNING id` and a run-unique `matches.notes` marker. Everything else is written by the production writer and owned through the batch ids it returns.
- *Unavoidable shared writes:* whenever a case's settle writes a canonical row, `runSettleAflApi()` recomputes season 2026 in the same transaction. Exactly: `seasons` first_match_date, last_match_date, match_count, club_count, status, data_through_date, last_loaded_round, completed_at (and so the generated is_complete); `club_seasons` DELETE + INSERT of every 2026 row (new `id`s; `import_batch_id` is not written, so it becomes NULL); `player_season_stats` brownlow_status AND brownlow_votes for every 2026 row. `recomputePlayerDerivedStats` is a no-op (no fixture player resolves). The file captures that state before any write and restores it from the capture at teardown (§17.5 item 1); it never recomputes.
- *Cleanup scope:* only rows proven owned (§17.5 item 2), by exact id, in one transaction; payloads only by retained exact identity plus stored-content evidence plus no surviving citation (§17.5 item 3). Nothing mentions `issue228`.

**Cases.**

1. *Fresh match (A).* Three-periods-only roster: match inserted, no `match_period_scores` row, no period ledger/candidate row, exactly one open
   `afl_api_period_scores_contradiction` finding (severity `error`, `entity_id` NULL, reason/detail/fixture score recorded). Repeat: same finding id
   refreshed in place (`entity_id` now the match id), canonical snapshot unchanged. Valid roster: finding resolved (`source_agreement_restored`, still one row),
   8 period rows (home 31/67/77/122, away ending 131). A further valid run: no canonical change, no new finding.
2. *Existing rows (B).* Valid run writes 8 period rows; a stale-fourth-period roster (83-101) then leaves the whole canonical snapshot (match, every
   column of every period row, ledger and candidate counts) identical, with zero rows inserted/updated/ledgered, plus one open finding.
3. *Lifecycle (C).* After a contradiction opens the finding: a roster with no own-match score entry (`null` evidence), a `LIVE` (deferred) roster
   carrying valid scores, and a blocked match (fixture `venue.timezone` removed => `unproved_match_date`) each leave the **same** finding open and write no
   period row; only a valid roster resolves it and writes the periods. The `null`-evidence step is the regression for the lifecycle defect above (by inspection it
   fails on the pre-correction writer; this was not executed). The deferred and blocked steps pin behaviour that was already correct.
4. *Corroborated (D).* A review-first (`autoApply: false`) contradictory run opens the finding and writes no match; an afltables-owned fixture with the same key is then
   seeded; from there the match is `corroborated`. A contradicting roster, a roster with no own-match entry and a `LIVE` roster each leave the finding unchanged (not
   refreshed, not resolved, no second row); a valid roster resolves it (`source_agreement_restored`), `afl_api` writes no period row, and the match stays afltables-owned and unmodified.
   Fails on the pre-fix writer at the final resolution step (by inspection; not executed).

Nothing on the writer branch (finding creation/refresh/resolution on the planned and corroborated paths, absence of a period target, refused-then-healed) is validated until these pass.

### 17.4 Closure requirements still open

> **Status update (2026-10-12):** items 2 and 3 were carried out by the operator and are recorded in §17.7 (item 2: 4/4 passed on the second run; item 3: residue captured before, after the failed run and after the second run). Items 1 and 4 remain open. The "never been run" wording in item 3 is historical.

1. Operator review and commit of the diff (and an operator ruling, or acceptance, on the two names in §15).
2. Operator-run focused integration run on `afldb_test` (§17.3 cases): from the worktree root with `AFLDB_TEST_DATABASE_URL` set to the
   `afldb_test` DSN (and the SSH tunnel up, if that is how the host is reached): `npx vitest run tests/integration/settle-afl-api-issue276.test.ts`.
   Expected: 1 file, 4 tests passed (no other file collected; the vitest config runs files serially). It prints a `[ISSUE-276] ... restored from it` warning only if the shared
   2026 rows moved (expected whenever a case's settle committed a canonical row). **Three outcomes besides a pass are evidence, not failures to edit away:** (a) startup refuses with a
   listing of namespace rows or foreign conflicts (nothing was written or deleted: classify with the residue SQL and clear them deliberately; recovering from an interrupted run is a MANUAL
   operator step by design, no automatic cleanup exists); (b) a case fails; (c) `afterAll` throws `teardown FAILED` naming exactly what was left behind or could not be restored.
3. Read-only residue and ownership report before and after: `psql "$AFLDB_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f issues/open/AFLDB-ISSUE-276-RESIDUE.sql`
   (one READ ONLY transaction, rolled back). Expected both times: section 1 `owned` and `unproven` are 0 in every row, and sections 1b, 1c, 2 (payloads) and 3 (precondition) return no rows;
   section 4 is a capture: compare its three digests (seasons row, club_seasons excluding id, player_season_stats) before and after. **The query has never been run.**
4. Merge, then DEV deployment and smoke per the lifecycle; ISSUE-274's first-nightly acceptance and ISSUE-275 are independent and unchanged.

### 17.5 Static-review corrections (2026-10-12)

> **Status update (2026-10-12):** "never been executed" and "NOT RUN" below describe this pass as written. The corrected file and the residue SQL were later executed by the operator (§17.6, §17.7).

A static review of the authored integration file found three classes of defect. All three were corrected in `tests/integration/settle-afl-api-issue276.test.ts` and `AFLDB-ISSUE-276-RESIDUE.sql`;
**the production planner and writer changes are untouched** and nothing in the review exposed a production defect. The corrected file has never been executed.

1. **Shared derived state: restore the baseline, do not recompute truth.** The earlier teardown recomputed season 2026 "to canonical truth" only if a narrow snapshot differed. That did not prove the
   baseline came back: the snapshot omitted `player_season_stats` (which `recomputeSeasonBrownlowStatus` rewrites: `brownlow_status` and `brownlow_votes`) and `club_seasons.import_batch_id` (which
   `recomputeClubSeasons` does not write, so a recompute loses it); recompute may also differ from a stale baseline; and with zero non-final matches and a non-empty `club_seasons` baseline it neither
   recomputed `club_seasons` nor restored it. Now: the recompute functions and schema (`002`, `006`, `015`, `065`) were read; the full `seasons` row, every `club_seasons` column except `id`, the brownlow columns
   of every 2026 `player_season_stats` row and an md5 of the whole rows are captured before any write; teardown compares and, only if different, restores from the capture in one transaction
   (`jsonb_to_recordset`), then re-captures and **asserts equality** (a difference fails the run). The zero-non-final branch needs no special case because the capture, not a recompute, is restored.
   The restoration's column lists are checked against `information_schema` at startup (exact `club_seasons` column set, `id` identity, `seasons.is_complete` generated, required columns present, no foreign key
   referencing `club_seasons`); a mismatch stops the run before any write. *Choice explained:* transaction isolation was rejected because the writer commits through its own `sql.begin` and a case must see committed
   state across several runs; wrapping would also need production changes. *Excluded, with reasons:* `club_seasons.id` (identity, reissued by every recompute, nothing references it), sequence positions (no
   test can roll them back; precedent: ISSUE-274's DEV comparison differed only in `club_seasons_id_seq`, which the owner accepted), and `players`/`player_*` (untouched by construction). Window: between a case's commit and teardown other
   sessions on afldb_test see the recomputed rows; the advisory lock only excludes other runs of this file.
   **Teardown reporting:** each step (fixture removal, shared-state restoration, connection close) runs independently inside `afterAll`, failures are collected, and a single error names everything left behind or not
   restored. `afterAll` touches nothing at all when startup did not complete (`writesAllowed` false), so a startup refusal cannot delete the leftovers it refused to run over.
2. **Fixture ownership is proven before anything is deleted.** The earlier `removeCaseFixtures()` ran in `beforeAll`/`beforeEach` and deleted any `matches` row whose key equalled a fixture key or whose
   `source_record_id` began with the namespace, so a pre-existing or foreign row with an exact key would have been deleted. Now: startup inspects the namespace **read-only** and stops on *any* hit (matches,
   ledger, candidates, rejections, findings, typed projections, spine records and versions, marker batches, and afl_api payloads whose stored content carries an exact marker); foreign
   `possible_existing_match` conflicts are checked **before** the keep-alive or any fixture is written; a key alone never authorises deletion. Ownership is derived from what this run created, by returned identity:
   batch ids returned by `runSettleAflApi()` (each re-verified to carry `snapshot=issue276-integration;`); the keep-alive and case D's foreign-owned row by `INSERT ... RETURNING id` plus a run-unique
   `matches.notes` marker. A match is owned if seeded by this run, or if written by an adopted batch (`source_id = afl_api`, namespaced `source_record_id`, adopted `import_batch_id`); other tables are owned only through
   an adopted batch. Anything else in the namespace is UNPROVEN and teardown refuses (throws, deleting nothing). A session advisory lock stops a concurrent run of the file. The residue SQL now reports
   `OWNED` versus `UNPROVEN` per table (and `OWNED-WRITER`/`OWNED-SEED`/`UNPROVEN` per match), using only evidence a later session can see (marker batches, namespaced ids, the seed marker). Also fixed while tracing keys:
   the earlier predicate `split_part(issue_key, '|', 3)` missed `canonicalApplyIssueKey` findings (`afl_api|apply|<family>|<id>|...`, id in the fourth segment); both shapes are now covered.
3. **Payload cleanup is atomic and its residue check inspects payload rows.** The earlier cleanup deleted versions and payloads in separate autocommit statements (a failure between them left orphan payloads that
   no later run examined) and the residue query only counted surviving version references. Now: every removal (periods, ledger, candidates, findings, rejections, matches, projections, records, versions,
   payloads, batches) is one transaction, child to parent, each statement asserting the exact row count its ownership proof predicted; any surprise rolls it all back; the namespace is then re-inspected and must be empty.
   A payload is deleted only if (a) its exact `(family, payload_hash)` was retained from a version proven owned *before* that version was deleted, (b) its **stored `raw_payload`** contains an exact quoted namespace
   marker (a fixture provider id or a rewritten player id; before any write `buildBundle()` asserts every record the writer will persist carries one, and a DB-free scratch run confirmed it for all 80 records the cases
   can build), and (c) no surviving version cites it. A payload with marker evidence that no owned version retained, or a retained payload without marker evidence, is UNPROVEN and blocks teardown. A payload that a
   non-fixture version also cites is left in place and reported. Unrelated orphan payloads are never selected: the scan is bounded to the afl_api source, three families and exact markers. The residue SQL (section 2)
   now selects the actual payload rows by stored content and classifies each (`RESIDUE`, `WITH FIXTURE VERSIONS`, `SHARED`).

**Remaining limitations (honest list).**
- Nothing here was executed: the corrected hooks, every SQL statement in them, the four cases and the residue SQL are **NOT RUN**; passing is unproven and a SQL or assertion mistake is possible. The SQL was not machine-parsed.
- `data_issues` has no batch or provenance column, so a finding is owned by its exact provider id in the key plus "at least one batch was adopted this run"; that is weaker than the other tables.
- The residue SQL cannot see the run ledger, so its `OWNED` class is marker evidence (anyone can type a marker), not proof; it must not be used to justify deleting anything on its own.
- Recovery from an interrupted run is manual by design: the next run refuses and lists what it found; no deletion script is shipped (it would be unrun deletion code). Rebuilding afldb_test (`db:test:rebuild`) is the heavy fallback.
- Sequence positions and `club_seasons.id` values are not restored. Other sessions can observe the recomputed 2026 rows between a case and teardown.
- The advisory lock covers only concurrent runs of this file, not other suites writing the same shared 2026 rows.
- The marker lists in the integration file and in the residue SQL (six values) are maintained by hand and must change together if the fixtures' player ids change.

### 17.6 First operator integration run and reader type fix (2026-10-12)

**Outcome of the operator-run `npx vitest run tests/integration/settle-afl-api-issue276.test.ts` on `afldb_test`: 3 passed, 1 failed.** The failure was at `tests/integration/settle-afl-api-issue276.test.ts:1145`:
`expected "18476" to equal 18476.` The fresh-case steps after that assertion were **not executed**. Teardown reported restoration of the shared 2026 state; an **independent post-run comparison (residue SQL, section 4 digests before/after) is pending** and the restoration is not yet independently confirmed. The failed log is preserved as evidence and has not been edited or deleted.

**Cause: test-reader type mismatch, not a production defect.** `data_issues.entity_id` is `bigint` (postgres.js returns int8 as a string) while `matches.id` is `integer` (returned as a number). Fix, test file only: `FindingRow.entityId` is now `string | null`, `findingsFor` selects `entity_id::text AS "entityId"`, and the fresh-case assertion is `expect(refreshed.entityId).toBe(String(match.id))`. The strict equality and the existing null assertions are kept; no production code changed and no global bigint decoding was configured.

**Checks after the fix (database-free):** `npx tsc --noEmit -p tsconfig.json` exit 0; `npx eslint tests/integration/settle-afl-api-issue276.test.ts` exit 0. **The integration file has not been re-run;** the fresh-case path after line 1145, and therefore the writer branch it covers, remains unvalidated. ISSUE-276 stays **Open**.

*Superseded in part by §17.7:* the integration file was re-run after this fix and passed 4/4, and the independent post-run comparison for this failed run was completed (its residue capture matches the pre-run baseline). The statements above are kept as written.

### 17.7 Operator acceptance evidence: focused `afldb_test` run (2026-10-12)

**Result: focused `afldb_test` acceptance is SUPPORTED.** Four of four cases passed on the second run with no skipped cases, and the shared and owned state returned to the pre-run baseline after both the failed first run and the passing second run. This is evidence for the focused file on `afldb_test` only; see "Not established" below.

**Evidence** (operator-captured, outside the repository, not edited): `D:\tmp\issue276\acceptance-20261012-213614\` holding `residue-before.json`, `integration.txt`, `residue-after-failed-run.json`, `integration-r2.txt` and `residue-after-r2.json`. Times below are AEDT (UTC+11); the JSON `capturedAt` values are UTC. All three residue captures record the same `sqlSha256` (`3bff95f8bbfd63d78084cd10bdac50f1e571d6eedd54e20c88fb5314039f268b`) and database `afldb_test`.

| Step | Time (AEDT) | Result |
|---|---|---|
| `residue-before.json` | 21:36:14 | Baseline. |
| `integration.txt` (original run) | start 21:38:33, 58.20 s | 1 file; **3 passed, 1 failed** (§17.6). Failure at `tests/integration/settle-afl-api-issue276.test.ts:1145` (`expected "18476" to equal 18476`, bigint `entity_id` string versus integer `matches.id`) in the fresh-match case; the steps after that assertion **were not executed**. |
| `residue-after-failed-run.json` | 21:44:59 | Matches the baseline (`matchesBaseline: true`; the section 4 values below read identical). |
| Reader correction | before R2 | Test file only (§17.6); DB-free `tsc --noEmit` and `eslint` on the file passed. No production code changed. |
| `integration-r2.txt` (R2) | start 21:57:45, 65.61 s (tests 64.87 s) | 1 file, **4 tests passed**, no skipped or failed cases; exit 0 as reported by the operator (the log does not carry an exit code). |
| `residue-after-r2.json` | 22:00:06 | Matches the baseline (`matchesBaseline: true`). |

**Original (failed) run, preserved.** Cases passed in the original run: existing-rows, lifecycle and corroborated. The fresh-match case (A) failed at the type mismatch and so left its repeat-refresh, correction and further-valid-run steps unexecuted until R2. The failed log is preserved as evidence.

**R2 case timings** (from the log): fresh 16,050 ms; existing-rows 11,764 ms; lifecycle 16,360 ms; corroborated 14,705 ms.

**Residue result, identical at all three captures.** Section 1: all 13 rows report `owned` 0 and `unproven` 0 (matches, period rows of the namespace, `player_match_stats` of the namespace, canonical applications, promotion candidates, data issues, import rejections, the three `staging.afl_api_*` and source-record tables, the AFL Tables staging check and marker-carrying import batches). The statements for sections 1b, 1c, 2 (payload rows by stored content) and 3 (fixture-conflict precondition) returned no rows, so no namespace match, finding, marker batch, payload row or `possible_existing_match` conflict remained. The residue SQL ran to completion in a read-only transaction all three times, so it is now executed, not merely hand-reviewed.

**Section 4 baseline and final values (identical).** `seasons` 2026: `in_progress`, `match_count` 0, `club_count` 0, the first/last/through date, `last_loaded_round` and `completed_at` columns null, `seasons_row_md5` `ff03c807c908ced281ad500f69d17e6a`. `club_seasons` 2026: 2 rows, `club_seasons_md5_excluding_id` `17f40e49f37d638f233799cb29da1529`, 0 with `import_batch_id`, 0 non-final 2026 matches. `player_season_stats` 2026: 0 rows (digests empty). `club_seasons.id` and sequence positions remain **deliberately excluded** from the comparison (§17.5 item 1).

**Restoration exercised.** The log of both runs prints the `[ISSUE-276]` notice that the shared 2026 derived rows had moved from the setup capture and were restored from it (`seasons.club_count` and `match_count` 0 to 2; `first_match_date` 2026-01-02, `last_match_date` and `data_through_date` 2026-06-17, `last_loaded_round` `PF`; `club_seasons` rows for `club_id` 3 and 13 differed). This is the expected recompute side effect (§17.3). Neither log shows a `teardown FAILED` error, and the later captures show the baseline digests, which is the independent confirmation. The log header in both runs shows a PowerShell `NativeCommandError` stderr wrapper line; the same header appears on the passing run.

**Not established.**
- Restoration of a **non-empty** Brownlow baseline: `player_season_stats` for 2026 was empty, so that part of the restore path was not exercised with data.
- Anything beyond the focused file: no whole-suite run, no restricted-role run, no live-provider run, and nothing on DEV or PROD.
- The two names in §15 are still an unratified implementation choice.

**Remaining lifecycle.** §17.4 items 1 and 4: operator review and commit of the change set, merge (`npm run merge:ready -- --issue 276`), DEV deployment and smoke, then closure. ISSUE-276 stays **Open**.
