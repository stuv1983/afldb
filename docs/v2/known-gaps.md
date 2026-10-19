# AFLDB V2 — known gaps, blockers and deferred work

`V2-GAP-NNN` entries (ADR 0003). Each states what is missing, why, the evidence, and what would
close it. An entry is removed only when the closing evidence exists.

| ID | Severity | Area | State |
|---|---|---|---|
| V2-GAP-001 | Medium | test safety | open: unverifiable locally |
| V2-GAP-002 | Medium | frontend build | open: needs a database |
| V2-GAP-003 | Medium | environment | open: inherited, environmental |
| V2-GAP-004 | Low | source worktree hygiene | open: owner action |
| V2-GAP-005 | Low | historical baseline scope | open: AFLW not covered by the manifest |
| V2-GAP-006 | Medium | historical baseline | narrowed (Stages 3-4): enforced at the AFL API settle CLIs, the Coleman publisher and curated award approval; database-level and other writers open |
| V2-GAP-007 | Medium | historical baseline | open: manifest producer never run |
| V2-GAP-008 | High | AFL API fixtures | **open: cutover blocker** (AFLDB-ISSUE-229 B2 and the unbuilt fixtures writer) |
| V2-GAP-009 | Medium | AFL API promotion | open: transactional preservation unexecuted on PostgreSQL |
| V2-GAP-010 | Medium | AFL API coverage | open: 2012-2025 API coverage has no committed evidence |
| V2-GAP-011 | High | legacy runtime | **open: cutover blocker**, narrowed (Stage 5): the admin trigger refuses; the nightly settle, `npm run settle:afltables` and the trigger library stay until D-316-2 |
| V2-GAP-012 | Medium | legacy runtime | open: AFL API settle imports shared helpers from `settle-afltables.ts` |
| V2-GAP-013 | High | legacy runtime | **open: cutover blocker**, narrowed (Stage 5): every admin path refuses; the email-intake timer is still enabled (Stage 6) and the converted integration suites are unexecuted |
| V2-GAP-014 | Low | legacy quarantine | open: Python/R tools not physically quarantined |
| V2-GAP-015 | Medium | Coleman | open: derived on synthetic inputs only; no real season compared |
| V2-GAP-016 | Medium | Brownlow | open: owner decision: no eligibility rule for API-era seasons |
| V2-GAP-017 | Medium | Stage 4-5 SQL | open: migrations 111+, their grants and the Stage 5 operations-centre SQL unexecuted on PostgreSQL |
| V2-GAP-018 | Low | curated awards | open: revising an approved proposal is refused |
| V2-GAP-019 | Medium | curated awards | open: no four-eyes rule on approval |
| V2-GAP-020 | Low | curated awards | open: winners without a resolved player identity cannot be approved |
| V2-GAP-021 | Medium | Coleman | open, narrowed (Stage 5): the operations centre calls the publisher; published results are still not projected into `award_winners` |
| V2-GAP-022 | Medium | admin UI | open: Stage 5 admin pages never rendered (VISUAL: UNVERIFIED); owner eyeball required before production |
| V2-GAP-023 | Low | Brownlow | open: the reconciliation view has no staged API leaderboard and no provider-team-to-club mapping |
| V2-GAP-024 | Medium | curated awards | open: approving a curated award does not refresh the cached public award pages |
| V2-GAP-025 | Low | admin UI | open: no operations-centre view of AFL API settle refusals |

## V2-GAP-001 — The present-DSN branch of the test DSN policy is unverified on a live database

- **What.** When `AFLDB_TEST_DATABASE_URL` names a `_test` database, `applyTestDsnPolicy`
  (`packages/testing/src/dsn-policy.ts`) now also removes every other `*DATABASE_URL*` variable
  that does not name a `_test` database (for example an operator `.env`'s
  `AFLDB_IMPORT_DATABASE_URL=…/afldb_dev` or `AFLDB_AUTH_DATABASE_URL`). Inside a test process
  `src/db/client.ts` and `src/db/authClient.ts` refuse non-`_test` databases.
- **Why open.** Proved only on env objects and on this workstation, which has no database
  (`tests/dsn-policy.test.ts`). On the Linux dev host, an integration suite that relied on a
  non-`_test` import or auth DSN from `.env` (instead of setting it from the test DSN, as the
  integration files under `tests/integration/` do) would now fail closed with a "not set" error
  instead of reaching that database. That is the intended direction, but it has not been observed.
- **Close.** Run the integration suite against an isolated `afldb_test` (outside V2's authority)
  and record the result; any failure caused by the strip is a suite that was reaching a non-test
  database and should set its DSN from `AFLDB_TEST_DATABASE_URL`.

## V2-GAP-002 — The production frontend build is unexecuted in V2

- **What.** `npm run build` (`next build --webpack`) was not run.
- **Why.** It needs a database: ten routes export `generateStaticParams` that query PostgreSQL
  (for example `src/app/seasons/[year]/page.tsx:54`, `src/app/venues/[slug]/page.tsx:35`), and
  `src/db/client.ts` builds its pool at import and throws without `DATABASE_URL`. No database is
  available to V2, and pointing a build at any real database is forbidden (plan §1).
- **What was run instead.** `next typegen` and `tsc --noEmit --incremental false` (both exit 0 at
  the Stage 1 close; see `docs/v2/progress.md`).
- **Close.** A build against an isolated, disposable database with `NEXT_TELEMETRY_DISABLED=1`.

## V2-GAP-003 — Integration, Linux and POSIX behaviour is not exercised on the V2 workstation

- **What.** 85 integration suites refuse to load without a `_test` database; 15 unit cases fail
  for Windows-checkout or POSIX-execution reasons or because git-ignored evidence is absent from a
  fresh clone (exact list: `docs/v2/evidence/baseline-failures.txt`).
- **Why.** Environmental, inherited unchanged from the source (`docs/v2/baseline.md`).
- **Close.** A run on Linux against an isolated `afldb_test`. The V2 gate meanwhile is: no failure
  outside the baseline list, and no listed test weakened.

## V2-GAP-004 — A stray empty file `supplies` exists at the source worktree root

- **What.** `D:\dev\afldb-afl-api-cutover\supplies` (0 bytes, created 2026-10-19 09:18:47 +11:00)
  appears as `?? supplies` in the source's `git status`, which therefore no longer equals the
  launch snapshot `D:\tmp\afldbV2-source-snapshot-20261019\status.txt`.
- **Why.** Consistent with the documented workstation `Read`/`Grep` hook defect (it runs `cmd.exe`
  in the session cwd, which is the source worktree, and a redirect-like token in a payload creates
  an empty file). It appeared during the Launch A plan review. V2 work never writes to the source.
- **Close.** Owner removes the file (V2 agents are forbidden to modify the source) and, ideally,
  fixes or disables the hook.

## V2-GAP-005 — AFLW is outside the historical baseline manifest

- **What.** `HISTORICAL_TABLES` covers the AFL/VFL canonical tables only; `staging_aflw.*` and the
  `aflw.*` views are not fingerprinted (`docs/v2/historical-baseline.md` §3).
- **Why.** AFLW has its own loader (`tools/aflw/`) and modelling rules (`docs/aflw.md`) and is not
  part of the V2 AFL API scope.
- **Close.** An owner decision to cover AFLW, then a spec-version bump adding its tables.

## V2-GAP-006 — The seal on historical seasons is enforced only at the AFL API settle entry points

- **Stage 3 (2026-10-19) closed part of it.** `packages/domain/src/season-seal.ts`
  (`evaluateSeasonWrite`) decides a write against the seal from `data/reference/seasons.json`
  (sealed today: 1897-2025). The three AFL API settle CLIs
  (`tools/current-season/settle-afl-api.ts`, `settle-afl-api-fixtures.ts`,
  `settle-afl-api-brownlow.ts`, through `tools/current-season/settle-season-seal.ts`) refuse a
  sealed season in every writing mode before any database client is created; `--validate-only`
  and `--report` stay allowed. The one exception is the Brownlow completed-season backtest
  (`--allow-completed-season-backtest`): it opens a client first, admits the sealed season only
  after the live `afldb_test` proof passes, and logs it as a non-correction basis. Settle is never a correction
  workflow: the refusal names the audited workflows of `docs/v2/historical-baseline.md` §2.
  Tests: `tests/v2-season-seal.test.ts`, the "V2-GAP-006" block of
  `tests/afl-api-settle-cli-gate.test.ts` (refusal before the SQL stub is touched; negative
  control recorded in `docs/v2/progress.md`).
- **Still open.** (1) No database constraint or trigger: a writer that bypasses these CLIs
  (the library `runSettleAflApi`/`runSettleAflApiBrownlow` called directly, as rehearsal tools
  under `tools/db/` do; the AFL Tables settle; legacy loaders) is stopped only by the existing
  per-target `season_not_in_progress` gate in `src/lib/acquisition/canonical-apply.ts` (canonical
  writes only; staging, candidates, `data_issues` and `applyAttendanceEnrichment` are not covered by
  it). (2) The CLIs' real database paths are unexecuted (ordering proved through a throwing SQL
  stub only).
- **Stage 4 (2026-10-19) narrowed it further.** Two new V2 writers consult the seal before any
  write: the Coleman publisher (`publishColemanResult`, workflow `derived_award_publication`) and
  curated award approval (`approveProposal`, workflow `curated_award_approval`, which needs a
  decision note of 20-2000 characters for a sealed season). Both workflows are rows of
  `docs/v2/historical-baseline.md` §2. Tests: `tests/v2-coleman-publication*.test.ts`,
  `tests/v2-curated-awards*.test.ts` (unit and in-memory PGlite).
- **Still open after Stage 4.** The existing admin editors (data editor, award editor and others in
  `src/db/queries/`) and the legacy runtime writers (V2-GAP-011, V2-GAP-013) do not call
  `evaluateSeasonWrite`; the Stage 4 disposition classified the legacy writers but did not remove
  them.
- **Close.** An owner decision on database-level enforcement (an additive migration under plan
  D4), Stage 5 for the admin editors, and the ISSUE-316 cutover plus Stage 5 for the legacy
  writers.

## V2-GAP-007 — No manifest of the real baseline exists yet

- **What.** The producer (`tools/v2/historical-manifest.ts produce`) is tested only through a fake
  query function; its SQL has never executed on PostgreSQL, so a server-side error (for example a
  column privilege, or the memory cost of `string_agg` on the largest season) is possible.
- **Why.** Plan §7 R-007: never run in Launch A; V2 has no database access.
- **Close.** An authorised run against an isolated `afldb_test`, twice, with identical results,
  then (owner decision) a read-only run against the live source. Record timings and both manifests'
  locations, outside the repository.

## V2-GAP-008 — CUTOVER BLOCKER: AFL API pre-match fixtures are not ingestible (AFLDB-ISSUE-229)

- **What.** The AFL API cannot yet create or update AFLDB `fixtures` rows. AFLDB-ISSUE-229 is open
  (`issues.md` ~:41898; runbook `issues/open/AFLDB-ISSUE-229.md`). Genuinely unresolved, so V2
  did not invent the answer:
  1. **B2**: the first authentic pre-match season feed (the 2027 feed) has not been observed
     (`issues.md` ~:42056-42057; runbook ~:515-518), so the genuine TBC date/time representation,
     whole-season pre-match shape and new statuses/key variants are unknown; placeholder
     start-time detection is undecided (`issues.md` ~:41963).
  2. Provider statuses `LIVE`, `POSTPONED`, `CANCELLED`, TBC and any unseen string are
     unobserved and stay unsupported; nothing maps to `cancelled`/`void` (D-229-3, runbook
     ~:135-139, ~:538-541). D-229-2's pre-match score rule is not generalised to `LIVE`/`POSTGAME`.
  3. The fixtures writer is unbuilt: the second `fixtures` writer with ISSUE-162 §7 precedence,
     the source-agnostic I-1/I-2/I-3 and `foreign_owned_collision` checks against existing rows
     (D-229-4), the D-229-6 `editFixture()` guard, the D-229-7 preconditions, `fixture_key`
     minting and upsert by `(afl_api, providerId)`, and the fixture-only audit model (D-229-8a).
  4. The D-229-5 venue precondition is only half expressible offline: the provider venue must map
     in `data/reference/afl-api-identities.json` (checked), and its `legacy_name` must match a
     `venues` row (database work, unexecuted).
  5. Related existing behaviour (LOW, unchanged): the fixtures-only settle has no status gate of its
     own (`tools/current-season/settle-afl-api-fixtures.ts`; only the CONCLUDED default selection
     and the score-required build refusal keep pre-match records out of the match spine), and the
     match resolver does not refuse two different provider ids resolving to one canonical row
     through `match_key` (`src/lib/acquisition/afl-api-match-resolver.ts` ~:181-190).
- **What V2 built instead (Stage 3).** `packages/acquisition/src/fixture-contract.ts`: the
  recorded decisions as pure refusal contracts (status classification, projection preconditions,
  collision refusals incl. duplicate provider id, two ids for one fixture and swapped orientation),
  tested on the committed 2026 feed and pre-match slices (`tests/v2-fixture-contract.test.ts`).
  No writer is wired to it.
- **Close.** Capture B2 under AFLDB-ISSUE-229, decide the open items there, build and test the
  writer against an isolated `afldb_test`. Until then the production go/no-go for an AFL API-only
  fixture pipeline is **no-go**.

## V2-GAP-009 — Transactional preservation of promoted data is not executed on PostgreSQL

- **What.** "Preserve previous promoted data when validation fails" is proved at the plan level
  only (`tests/v2-acquisition-replay.test.ts`: a unit that fails validation is a build failure and
  is never planned; the full-rollback counter normalisation zeroes every durable counter). The
  settle's own transaction and rollback (`runSettleAflApi`'s `sql.begin`, the require-complete
  rollback) are covered by integration suites under `tests/integration/`, which need an
  `afldb_test` database and were not run here.
- **Why.** No database is available to V2. PGlite (plan D2) was not installed: the settle needs the
  full 110-migration schema with its roles and grants, and plan D2 forbids extending PGlite to the
  existing migrations' roles/grants.
- **Close.** Run the AFL API integration suites (`tests/integration/settle-afl-api*.test.ts`)
  against an isolated `afldb_test` and record the result.

## V2-GAP-010 — AFL API coverage of 2012-2025 is not backed by committed evidence

- **What.** The coverage registry (`docs/v2/coverage-matrix.md`) labels every season before 2026
  `historical_baseline` (or `unsupported` for Brownlow without a medal). 2022-2025 are registered
  in `data/reference/afl-api-identities.json` with round vocabularies, and a 2022-2025 Brownlow
  backtest is documented (`docs/acquisition/AFLDB-2026-API-ACQUISITION.md` ~:2079-2086), but no
  stored snapshot or test for those seasons is committed; 2012-2021 appear only in the provider's
  season listing. Even 2026 is `api_verified` only for results; fixtures, match stats, player stats
  and Brownlow are `api_partial`.
- **Why.** Raw acquisitions under `data/sources/afl_api/` are git-ignored; V2 may not fetch.
- **Close.** Commit sanitised stored snapshots for each season to be claimed, with tests, then
  regenerate the matrix (`tools/v2/coverage-matrix.ts --write`). Never relabel without evidence.

## V2-GAP-011 — CUTOVER BLOCKER: the AFL Tables runtime remains until the ISSUE-316 retirement

- **What.** The AFL Tables nightly settle (`deploy/afldb-settle-afltables.timer` -> `.sh` ->
  `acquire_core.R` -> `import_fitzroy_core.py` -> `tools/current-season/settle-afltables.ts` ->
  `src/lib/acquisition/settle-afltables.ts`), `npm run settle:afltables`, and the admin trigger
  (`src/app/admin/current-season/actions.ts` `startSettleRunAction` -> `settle-trigger.ts`) are
  still runtime paths in V2 (`docs/v2/legacy-disposition.md` L4, L5). They write the match spine,
  staging, promotion and derived tables (`legacy-disposition.md` §5).
- **Why.** Retiring them is the owner's ISSUE-316 decision D-316-2 (the C4b cutover), which V2 may
  not execute. The shell script, the trigger and the network register are frozen ISSUE-316 files.
  The register (`data/reference/afltables-network.json`, gates in
  `src/lib/acquisition/afltables-network.ts`) already makes every network path refuse once
  retired.
- **Guard.** `tests/v2-module-boundaries.test.ts` ratchets the known legacy runtime edges
  (`legacyRuntimeEdges`, `publicRuntimeLegacyReach`, `scheduledLegacyReferences`): a new edge
  fails the test.
- **Stage 5 (Launch D).** The admin trigger is retired: `startSettleRunAction` keeps its
  `acquisition.currentSeason` guard and then refuses (`legacy_retired`, surface
  `admin.afltables_settle_trigger`, one `admin.legacy_retired_refused` audit row) and never reaches
  `startSettleRun`; the start panel (`SettleRunPanel.tsx`) is deleted. The operations centre shows
  the AFL Tables unit's status only. `settle-trigger.ts` stays (frozen; read by
  `AflApiSettleUnitsPanel.tsx`, `current-season/page.tsx` type-only and `settle-status.ts`).
- **Close.** The owner executes D-316-2 under ISSUE-316; Stage 6 disables the timer. Until then
  the production go/no-go for an AFL API-only pipeline is **no-go**.

## V2-GAP-012 — The AFL API settle depends on helpers that live in `settle-afltables.ts`

- **What.** `src/lib/acquisition/settle-afl-api.ts:134-140` imports
  `automaticProposalUnderAuthority`, `scopeProposalToAuthority`, `PLAYER_MATCH_STAT_COLUMNS`,
  `CANONICAL_APPLY_ISSUE_OWNER` and `CANONICAL_APPLY_ISSUE_TYPE`, and
  `src/lib/acquisition/settle-report.ts:46-53` imports the canonical-apply and settle issue keys,
  `MATCH_TARGET_TABLES` and `SETTLE_SOURCE_KEY`, from `src/lib/acquisition/settle-afltables.ts`.
  This is a code dependency on the module, not a data dependency on AFL Tables.
- **Why.** Moving the helpers is a refactor of shared settle code that the integration suites
  (which need a database) must cover; Stage 4 did not attempt it.
- **Close.** Move the helpers into a source-neutral module, re-point both settles, run the settle
  integration suites on an isolated `afldb_test`, then `settle-afltables.ts` can be quarantined
  with L4.

## V2-GAP-013 — CUTOVER BLOCKER: the email-intake timer still runs; the CSV, email and Squiggle/Kali admin paths now refuse

- **What.** CSV upload (`src/app/admin/upload/**`), CSV submission review and promotion
  (`src/app/admin/submissions/[id]/actions.ts` -> `src/lib/ingest/pipeline.ts` ->
  `datasets.ts`), the email intake route (`src/app/api/admin/email-intake/route.ts`, fed by
  `deploy/afldb-email-intake.timer`) and the Squiggle/Kali admin refresh
  (`src/app/admin/current-season/actions.ts` -> `src/lib/external-afl/current-season-import.ts`)
  are still reachable (`legacy-disposition.md` L1-L3, L6). On promotion the CSV path writes
  `matches`, `player_match_stats`, `players`, `award_winners` and `award_nominations` directly.
- **Why.** These are admin routes and server actions; Stage 5 owns the admin surface. Disabling the
  email intake timer is a deployment act (Stage 6). Stage 4 retired only the Squiggle/Kali CLI
  (quarantined to `legacy/offline/`, package script refuses).
- **Guard.** The legacy runtime edges are ratchet-listed in `tests/v2-module-boundaries.test.ts`.
- **Stage 5 (Launch D).** Every admin path refuses after its unchanged guard, with the typed
  refusal `legacy_retired` from `RETIRED_ADMIN_SURFACES` (`packages/domain/src/legacy-retirement.ts`)
  and one best-effort `admin.legacy_retired_refused` audit row: `runCurrentSeasonAdminAction`
  (Squiggle/Kali), `runValidation`, `decideSubmission`, `runPromotion` (submissions) and the upload
  route (HTTP 410 after its same-origin check and `acquisition.legacyIntake`). The email-intake
  route answers 410 without reading the request, comparing the secret, touching the database or
  auditing (an unattributable caller must not write audit rows). The upload form, the review
  controls and the Squiggle/Kali controls are deleted; no admin file imports the pipeline,
  `datasets.ts` or the Squiggle/Kali libraries (`tests/v2-module-boundaries.test.ts`). The
  libraries stay because offline tools use them. The replacement is the curated award entry
  (`/admin/operations/awards`) and the existing audited editors.
- **Still open.** `deploy/afldb-email-intake.timer` still polls every 5 minutes: each message now
  gets 410 and the poller files it to its Errors folder, kept, never deleted
  (`tools/email_intake/fetch_and_stage.py:606-607`, `:742-744`), so disable the timer in the same
  window as the Stage 5 deploy or accept the pile-up. The changed integration suites
  (`tests/integration/{admin-upload-route,email-intake,submission-promotion}.test.ts`) are
  unexecuted (V2-GAP-003); route-level ISSUE-273/304 coverage was retired with the routes, the
  library-level race coverage is kept through a test-local helper.
- **Close.** Stage 6 disables the timer in the cutover runbook; an operator runs the three
  integration suites on an isolated `afldb_test`.

## V2-GAP-014 — Python and R legacy tools are not physically quarantined

- **What.** `tools/migration/*`, `tools/rebuild/**` and `tools/email_intake/*` stay in place
  (`legacy-disposition.md` L8-L10). Only the TypeScript CLI `update-current-season.ts` moved to
  `legacy/offline/`.
- **Why.** The sealed historical rebuild (`tools/db/rebuild-test.ts`) invokes them by path, and V2
  cannot execute Python or R to prove a moved script still runs. Three are frozen ISSUE-316 files
  (`tools/rebuild/afltables/acquire_club_lists.R`, `acquire_coaches.py`,
  `tools/rebuild/fitzroy/acquire_core.R`).
- **Guard.** No runtime TypeScript imports them (guard e in `legacy-disposition.md` §2).
- **Close.** Move them with the rebuild's path references updated, then run the rebuild on an
  isolated `afldb_test` to prove it still completes.

## V2-GAP-015 — The Coleman derivation has run on synthetic inputs only

- **What.** `deriveColeman` and the comparison report (`@afldb/derived`, ADR 0006) are tested on
  SYNTHETIC inputs (`tests/v2-coleman.test.ts`). No real season has been derived, and no
  comparison against the stored Coleman `award_winners` rows has been produced.
- **Why.** The repository has no committed per-match goal data, and V2 may not read a database.
- **Close.** Export the home-and-away goal facts and identities for the sealed seasons from an
  isolated `afldb_test` (read-only), run the derivation and the comparison report, and review
  every `disagree` and `not_derivable` row before any publication.

## V2-GAP-016 — OWNER DECISION: Brownlow eligibility rule for API-era seasons

- **What.** The reconciliation (`@afldb/derived`, ADR 0007) refuses a leader determination when an
  ineligible player polled votes, unless the caller selects `stored_eligible_rank_one` (the
  stored-table rule in `src/lib/brownlow/entry.ts`). No rule is recorded for API-era seasons, or
  for retrospective and vacated awards.
- **Why.** Naming a winner is a product rule; V2 does not invent one (plan §7 R-023).
- **Close.** The owner states the rule; it is added as an explicit `eligibilityRule` with tests.
  Related: V2-GAP-010 (API coverage of 2012-2025 has no committed evidence), so even with a rule
  the API-era reconciliation has no committed inputs yet.

## V2-GAP-017 — The Stage 4 migrations and grants are unexecuted on PostgreSQL

- **What.** `src/db/migrations/111_curated_award_proposals.sql` and
  `112_derived_award_results.sql`, their `tools/maintenance/privileges.sql` blocks, the two new
  `tests/integration/privileges.test.ts` cases, the promotion inventory with its two extra tables
  (the F0 pin is now 40), the server-only promotion port (`src/db/queries/award-proposals.ts`,
  which calls the real `insertAwardWinner`), the Coleman publisher SQL and the postgres.js adapter
  (`packages/db/src/sql-executor.ts`) have not run against PostgreSQL. Both migrations ran only on
  in-memory PGlite over labelled stub prerequisites and stub roles
  (`tests/v2-curated-awards-pglite.test.ts`, `tests/v2-coleman-publication-pglite.test.ts`).
- **Stage 5 additions, also unexecuted on PostgreSQL.** The operations-centre read loaders
  `src/db/queries/coleman-inputs.ts` and `src/db/queries/brownlow-reconciliation-inputs.ts`, the
  callers in `src/lib/admin/operations-centre.ts` (every database call goes through the
  `afldb_import` connection opened by `withAwardProposalExecutor`, including the reads of
  `staging.afl_api_brownlow_vote`, `brownlow_season_votes`, `matches` and the Coleman goal
  facts) and the activity-trail writes. They ran only against PGlite over the same stubs and
  against in-memory fakes (`tests/v2-admin-operations.test.ts`).
- **Why.** No database is reachable from V2 (plan §1); PGlite is not evidence for PostgreSQL
  (plan §7 R-020).
- **Close.** An operator applies the migrations to an isolated `afldb_test`, runs
  `npm run db:privileges`, and runs `tests/integration/privileges.test.ts` and the awards
  integration suites, then exercises each operations-centre page once (V2-GAP-022); record the
  result here.

## V2-GAP-018 — Revising an approved curated award is refused

- **What.** `reviseProposal` refuses an approved proposal (`approved_revision_unsupported`).
  Correcting a promoted winner today uses the existing replace/correct lifecycle in
  `src/db/queries/admin-awards.ts`, which does not link back to the proposal chain.
- **Close.** A wrapper over the existing replace/correct functions that records the new revision
  and its ledger row in the same transaction. Not built in Stage 5: the approval card says an
  approved winner is corrected only through `/admin/awards`.

## V2-GAP-019 — No four-eyes rule on curated award approval

- **What.** A holder of `data.awards.edit` may approve a proposal they created themselves. Every
  transition is still attributed in the append-only ledger.
- **Why.** No existing AFLDB workflow enforces separation of duties, and the owner has not asked
  for it; V2 did not invent one (plan §7 R-024).
- **Close.** Owner decision; if wanted, refuse approval by the creator in `approveProposal` and
  add the test.

## V2-GAP-020 — Curated winners need a resolved player identity

- **What.** A proposal whose player has no durable identity (`afltables:` or `manual_admin_edit:`)
  is refused at validation, so an identity-less legacy player cannot be approved as a winner.
- **Close.** Link the player first through the existing identity tools, then propose.

## V2-GAP-021 — Published Coleman results are not projected into `award_winners`

- **What.** `publishColemanResult` writes only the `derived_award_results` ledger (migration 112).
  The Coleman `award_winners` rows the public site reads remain owned by the offline
  `tools/migration/import_awards.py` coleman group. Nothing reads `derived_award_results` yet, and
  no admin route, server action or script calls the publisher.
- **Why.** Writing `award_winners` for a sealed season needs an owner-chosen correction workflow
  and a `player_name_raw` the pure derivation has no table for (ADR 0006 divergence 8); the admin
  surface is Stage 5's. V2-GAP-015 (no real season derived yet) comes first.
- **Stage 5 (Launch D).** Narrowed: `/admin/operations/coleman` compares a season (read-only,
  `data.awards.read`) and publishes it (`data.awards.edit`, a 20-2000 character note, the
  operator's settled attestation) through `publishColemanSeason` in
  `src/lib/admin/operations-centre.ts`, evidence reference
  `coleman_derivation:<season>:<inputChecksum>`. Decision (plan §7 R-035): still **no** projection
  into `award_winners`; the page says so.
- **Close.** A projection into `award_winners` calls `assertSeasonWritable` with a correction and
  supplies names (owner-chosen workflow); then the offline loader's coleman group is retired for
  seasons the publisher covers.

## V2-GAP-022 — The Stage 5 admin pages have never been rendered (VISUAL: UNVERIFIED)

- **What.** No real page of the operations centre (`/admin/operations`, `/awards`, `/awards/[id]`,
  `/coleman`, `/brownlow`) and none of the changed admin pages (`/admin`, `/admin/current-season`,
  `/admin/upload`, `/admin/submissions/[id]`, the sidebar) has been rendered in a browser: each needs
  a database and a staff session. The run-status rows read systemd through `settle-status.ts`; on a
  host without it they show "not available", which is intended but unproven on the real host.
- **Evidence that exists.** Component-level captures of the presentational components from
  SYNTHETIC props (`tests/fixtures/v2/operations-centre/props.synthetic.ts`) with the repository's
  own CSS, at 1280x800 and 390x844, offline (local Playwright Chromium, every non-file request
  aborted, 0 attempted): `docs/v2/evidence/stage5-visual/` (12 images and `capture-log.txt`). An
  automated check found horizontal overflow on one capture (a long durable identity, +29px at
  390px); it was fixed with `overflow-wrap` and the re-capture shows none. The images have not been
  inspected by any agent or person. They are not the pages: no layout shell, no session, no data.
- **Close.** The owner eyeballs the screens listed in `docs/v2/admin-operations.md` §6 on an
  isolated environment at desktop and mobile widths, and records the result here.

## V2-GAP-023 — Brownlow reconciliation view: no staged leaderboard, no provider-team mapping

- **What.** `src/db/queries/brownlow-reconciliation-inputs.ts` passes `leaderboard: null` (no staged
  table holds the API leaderboard; `src/db/migrations/103_afl_api_match_projections.sql:18`) and
  maps no provider team id to a club (no committed mapping), so the leaderboard comparison is "not
  supplied". `staging.afl_api_brownlow_vote` is an upsert, so a provider player removed from a
  match's vote set could leave a stale row; the reconciliation's 3/2/1 vote-set finding would
  surface it. The page states these caveats; it is read-only.
- **Close.** Stage the leaderboard and commit a provider-team mapping, then pass both.

## V2-GAP-024 — Approving a curated award does not refresh the cached public award pages

- **What.** An approval writes `award_winners` through `insertAwardWinner`, but the operations
  centre does not trigger revalidation of the public award pages (`src/app/awards/**` use
  `revalidate = 86400`), so a new winner can be missing from those pages for up to a day per
  worker. The existing awards admin posts its server-computed paths to `/admin/awards/revalidate`
  after the action returns (`src/app/admin/awards/submit-helper.ts`); the operations centre does
  not yet.
- **Why.** The curated services return no revalidation paths; adding them crosses the
  `@afldb/admin` promotion port and was not in Stage 5's reviewed scope.
- **Close.** Return the paths `insertAwardWinner` already computes through the promotion port and
  post them to `/admin/awards/revalidate` after a successful approval, as `/admin/awards` does.

## V2-GAP-025 — The operations centre has no view of AFL API settle refusals

- **What.** Plan D9 lists "reconciliation failures". The overview shows each settle unit's run
  status and links to the existing inspection tools; the Brownlow reconciliation has its own page.
  The AFL API settle's per-unit refusals (`canonical_applications`, `data_issues`, the settle
  reports) have no read-only view in the operations centre.
- **Close.** A read-only, capability-guarded view over the refused `canonical_applications` rows
  and the open settle `data_issues`, linked from the overview.
