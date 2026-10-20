# AFLDB V2 — known gaps, blockers and deferred work

**Current bounded acceptance (2026-10-20, D-GAP029-21):** 149 strict findings;
99 approved (78 deferrals + 21 exact sibling disagreements), **0 data matches**;
50 unapproved (42 event + eight board-date membership). Both gates remain failed.
All six dedicated local credentials rotated on ownership-verified 55433; new logins
pass and old logins reject. Backend functionality, shared-data coverage limits,
unchanged release blockers and the next separate owner decision are distinguished in
[the current readiness record](gap-029-readiness.md). [Source requests](gap-029-source-requests.md).
Earlier run counts and unapproved-sibling proposals below are historical where superseded.

Current local-release follow-up: see `local-release-review.md` for final verification. Gap 014
and 021 and 028 are closed locally; 016 has its publication and 98-season evidence complete but remains
open for production-dump/owner release acceptance. Gap 022 now requires owner acceptance only,
not technical inspection. Gap 026 now requires the host/production-data rehearsal, not local
application rollback. The historical Launch F counts below are retained as history.
Current register: **29 total / 9 closed / 20 open**, including the separately tracked strict
historical-source/membership verification gap 029. No remaining failed test is treated as green.

`V2-GAP-NNN` entries (ADR 0003). Each states what is missing, why, the evidence, and what would
close it. A gap is marked CLOSED only when its closing evidence exists; closed entries are kept
with that evidence. **State at the close of Launch F (2026-10-19): 28 gaps.**
- **Closed (6), each on the isolated PostgreSQL 16 cluster:** 002, 012, 017, 018, 019 and 024.
- **Open (22).** The remaining **production-only** cutover blockers are 008 (B2), 011 and 013.
  Their reversible steps are documented; none was executed.
- Each closure below names its evidence. "Isolated" means the loopback-only cluster of
  `tools/v2/isolated-pg.ts` (`docs/v2/isolated-rebuild.md`), never production.

Production-blocker classes (`docs/v2/go-no-go.md` §3): **cutover** — structural, must be resolved
before an AFL API-only production pipeline; **rehearsal** — closed only by executing the isolated
shadow rehearsal (`docs/v2/shadow-rehearsal.md`) and recording its evidence; **reconciliation** —
award results must be shown reconcilable before production; **no** — not a production blocker.

| ID | Severity | Area | Production blocker | State | Owner action |
|---|---|---|---|---|---|
| V2-GAP-001 | Medium | test safety | rehearsal | open, narrowed: live guarded local workflow demonstrated; supported Linux runtime remains separate acceptance evidence | approve Linux isolated-cluster verification (S-A5), not a literal-name bypass |
| V2-GAP-002 | Medium | frontend build | no | **CLOSED (Launch F)**: `npm run build` exit 0 against the isolated `afldb_v2_visual_test`, telemetry disabled | none |
| V2-GAP-003 | Medium | environment | rehearsal | open, narrowed (Launch F): integration suites ran on Windows against isolated PG16; Linux/POSIX still unexercised | approve the Linux suite run (§7) |
| V2-GAP-004 | Low | source worktree hygiene | no | open: owner action | fix or disable the user-level Read/Grep/Glob hook; decide whether to delete the stray `supplies` |
| V2-GAP-005 | Low | historical baseline scope | no | open: AFLW not covered by the manifest | decide whether AFLW joins the manifest |
| V2-GAP-006 | Medium | historical baseline | no | narrowed (Stages 3-4): enforced at the AFL API settle CLIs, the Coleman publisher and curated award approval; database-level and other writers open | decide on database-level seal enforcement |
| V2-GAP-007 | Medium | historical baseline | rehearsal | open, narrowed (Launch F): the producer ran repeatedly on the isolated rebuild with identical results; no real-baseline manifest | approve the shadow captures (§4), then a read-only production run (cutover runbook step 3) |
| V2-GAP-008 | High | AFL API fixtures | **cutover** | **open, production-only**: writer built and tested (Launch F, `d760280e`); AFLDB-ISSUE-229 B2 uncaptured (no 2027 season exists) | capture B2, review its dry run, approve the first apply |
| V2-GAP-009 | Medium | AFL API promotion | rehearsal | open, narrowed: the two formerly name-pinned files pass locally (6/6 and 1/1); strict isolated proofs replace the name pin | Linux/production-dump replay under the same guarded target contract |
| V2-GAP-010 | Medium | AFL API coverage | no (coverage is not claimed) | open: 2012-2025 API coverage has no committed evidence | decide which seasons to evidence |
| V2-GAP-011 | High | legacy runtime | **cutover** | **open, production-only**, narrowed (Launch F): a V2 checkout refuses the AFL Tables settle; `cutover-preflight.ts legacy-writers` refuses the release while the timer or polkit rule remains | approve A-AFLT (disable the timer in the window) or complete ISSUE-316 C5 |
| V2-GAP-012 | Medium | legacy runtime | no | **CLOSED (Launch F)**: helpers moved to `settle-shared.ts`, both edges removed from the ratchet, settle integration suites pass on isolated PG16 | none |
| V2-GAP-013 | High | legacy runtime | **cutover** | **open, production-only**, narrowed (Launch F): the poller refuses in V2; the preflight refuses the release while the email-intake timer runs | approve the release window (step 4, 4a) |
| V2-GAP-014 | Low | legacy quarantine | no | **CLOSED locally**: acquisition implementations quarantined, refusing old entry points; deterministic rebuild retained and verified | no live retirement authorised |
| V2-GAP-015 | Medium | Coleman | reconciliation | open, narrowed (Launch F): 46/46 seasons (1980-2025) agree on the locally rebuilt history; production data not compared | approve the shadow Coleman capture on the production dump (§4/§8) |
| V2-GAP-016 | Medium | Brownlow | reconciliation | open, narrowed: atomic audited public publication implemented; 98/98 local seasons agree, none unresolved; archive-scoped migration evidence accepted (D-V2-BROWNLOW-ALT-1: stored-only, identical 98-season before/after) and an **authentic 2025 API snapshot reconciles** (207/207 matches, 188 players, 621 votes, totals, ranks and winner; [record](brownlow-authentic-reconciliation-2026-10-20.md)) **except 12 players the provider marks ineligible whom the stored table holds eligible (unresolved)** | owner ruling on the 12 and acceptance of the reconciliation ([checklist](release-requirements-checklist-2026-10-20.md) item 1) |
| V2-GAP-017 | Medium | Stage 4-5 SQL | no | **CLOSED (Launch F)**: 111-114 applied, privileges run, `privileges` and awards integration suites pass, operations pages rendered (isolated PG16) | none |
| V2-GAP-018 | Low | curated awards | no | **CLOSED (Launch F)**: `reviseApprovedProposal` (ADR 0008), PostgreSQL-tested | none |
| V2-GAP-019 | Medium | curated awards | no | **CLOSED (Launch F)**: four-eyes with a recorded self-approval attestation (ADR 0008, owner decision), PostgreSQL-tested | none |
| V2-GAP-020 | Low | curated awards | no | open: winners without a resolved player identity cannot be approved | none |
| V2-GAP-021 | Medium | Coleman | no | **CLOSED locally**: explicit guarded offline bootstrap refuses publisher-owned seasons; session locks survive batch commits; 27/27 publication tests | production comparison remains gap 015 |
| V2-GAP-022 | Medium | admin UI | rehearsal | open, narrowed: 26 images technically inspected; four Brownlow replacements recaptured/inspected after material wording/status fixes | owner acceptance per screen |
| V2-GAP-023 | Low | Brownlow | no | open: the reconciliation view has no staged API leaderboard and no provider-team-to-club mapping; the staged comparator is INCOMPLETE and **blocks the in-application reconciled leaderboard and club checks** (checklist item 1), not migration. The 2025 evidence run derived both from the data (an 18-team mapping, functional and injective; the staged leaderboard equals the stored totals), so they are derivable; nothing is committed | none for migration; needed for operational readiness |
| V2-GAP-024 | Medium | curated awards | no | **CLOSED (Launch F)**: approval returns the revalidation paths and the page posts them (ADR 0008), PostgreSQL-tested | none |
| V2-GAP-025 | Low | admin UI | no | open: no operations-centre view of AFL API settle refusals | none (V2 follow-up) |
| V2-GAP-026 | High | shadow rehearsal and rollback | rehearsal | open, narrowed: previous/V2/previous/V2 passes on a populated copy (2026-10-20); populated-ledger DB reversal and archive recovery restore everything exactly on a synthetic copy | approve host backup/rollback and production-dump rehearsal |
| V2-GAP-027 | Low | AFL API reconciliation report | no | open (Stage 6): the Stage 3 report format has no producer wired into the settle CLIs | none (V2 follow-up) |
| V2-GAP-028 | Low | integration tests | no | **CLOSED locally**: original four files 200/200, including teardown, on fresh isolated rebuild; literal-name dependencies removed with live identity proofs | Linux remains separate gap 003 |
| V2-GAP-029 | Medium | strict historical baseline verification | data quality | OPEN: 149 strict; 99 approved; 50 unapproved; both Gridley gates fail. D-V2-MIGRATION-SEPARATION permits separate backend acceptance only with preservation/compatibility evidence; **now PASS, scoped** to archive `a583fc7d…ed11b04` and 110 → 115 via D-V2-BROWNLOW-ALT-1 (Gridley findings unchanged and not waived) | approved local production backup and Linux rehearsal required: production-shadow-commands.md; source requests unchanged; shared-development incident uncertainty preserved |

## V2-GAP-001 — The present-DSN branch of the test DSN policy is unverified on a live database

- **Current local follow-up (2026-10-20):** the present-DSN path runs against native isolated
  PostgreSQL with explicit owner/import/auth role DSNs and live identity proofs. The remaining
  acceptance condition is the supported Linux environment, not a database literally named
  `afldb_test`. Stage 6's absent-database statements below are historical.

- **Launch F (2026-10-19).** 26 integration files ran on isolated PG16 databases with `AFLDB_TEST_DATABASE_URL` present and the strip active. No suite reached a non-`_test` database. A Linux `afldb_test` run is still needed.
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

- **CLOSED, Launch F (2026-10-19).** `npm run build` (`next build --webpack`, then `prepare-standalone`) exited 0 against the isolated, disposable `afldb_v2_visual_test`, with `NEXT_TELEMETRY_DISABLED=1`. It prerendered all 1,516 static pages. The captures in `docs/v2/evidence/launchF-visual/` were served from that build.
- **What.** `npm run build` (`next build --webpack`) was not run.
- **Why.** It needs a database: ten routes export `generateStaticParams` that query PostgreSQL
  (for example `src/app/seasons/[year]/page.tsx:54`, `src/app/venues/[slug]/page.tsx:35`), and
  `src/db/client.ts` builds its pool at import and throws without `DATABASE_URL`. No database is
  available to V2, and pointing a build at any real database is forbidden (plan §1).
- **What was run instead.** `next typegen` and `tsc --noEmit --incremental false` (both exit 0 at
  the Stage 1 close; see `docs/v2/progress.md`).
- **Close.** A build against an isolated, disposable database with `NEXT_TELEMETRY_DISABLED=1`.

## V2-GAP-003 — Integration, Linux and POSIX behaviour is not exercised on the V2 workstation

- **Launch F (2026-10-19).** The integration suites ran on Windows against isolated PG16; results are in `docs/v2/final-report.md` §3. Linux and POSIX are still unexercised.
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

- **Launch F (2026-10-19).** `historical-manifest.ts produce` ran on isolated copies of the locally rebuilt history (32 tables, 1,376 buckets). The before and after manifests around migrations 111-114 compared identical. No manifest of the real baseline exists.
- **What.** The producer (`tools/v2/historical-manifest.ts produce`) is tested only through a fake
  query function; its SQL has never executed on PostgreSQL, so a server-side error (for example a
  column privilege, or the memory cost of `string_agg` on the largest season) is possible.
- **Why.** Plan §7 R-007: never run in Launch A; V2 has no database access.
- **Close.** An authorised run against an isolated `afldb_test`, twice, with identical results,
  then (owner decision) a read-only run against the live source. Record timings and both manifests'
  locations, outside the repository.

## V2-GAP-008 — CUTOVER BLOCKER: AFL API pre-match fixtures are not ingestible (AFLDB-ISSUE-229)

- **Launch F (2026-10-19, `d760280e`).** The writer is built and tested (AFLDB-ISSUE-229 runbook §7). Only B2, the first authentic 2027 pre-match feed, and the owner's first-apply approval remain. A read-only check of the public compSeasons list shows no 2027 season yet.
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

- **Current local follow-up (2026-10-20):** all seven AFL API integration files pass locally:
  backtest 6, Brownlow reschedule 3, Brownlow 21, fixtures 16, issue276 4, state-B 1, main 73
  (**124/124**). The former name pin is replaced with strict isolated proofs. Remaining:
  supported Linux/production-dump rehearsal under that same target contract, not a name bypass.

- **Launch F (2026-10-19).** On the isolated rebuild, `settle-afl-api.test.ts` (73 tests), `-brownlow`, `-brownlow-reschedule`, `-fixtures` and `-issue276` pass. `-brownlow-backtest` and `-state-b` refuse any database not named `afldb_test`, by design.
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

- **Launch F (2026-10-19).** A V2 checkout refuses the AFL Tables settle: `npm run settle:afltables`, and the deploy script after its out-of-season exit. `tools/v2/cutover-preflight.ts legacy-writers` refuses the release while the timer is enabled, a unit is running or the on-demand polkit rule remains. The reversible window commands are cutover-runbook step 4a; none was executed. Production-only remainder: disable the timer (approval A-AFLT, or ISSUE-316 C5).
- **What.** The AFL Tables nightly settle (`deploy/afldb-settle-afltables.timer` -> `.sh` ->
  `acquire_core.R` -> `import_fitzroy_core.py` -> `tools/current-season/settle-afltables.ts` ->
  `src/lib/acquisition/settle-afltables.ts`), `npm run settle:afltables`, and the admin trigger
  (`src/app/admin/current-season/actions.ts` `startSettleRunAction` -> `settle-trigger.ts`) are
  still runtime paths in V2 (`docs/v2/legacy-disposition.md` L4, L5). They write the match spine,
  staging, promotion and derived tables (`legacy-disposition.md` §5).
- **Why.** Retiring them is the owner's ISSUE-316 sequence, which V2 may not execute: D-316-1 (C2)
  writes the AFL Tables switch `retired` in the 2026 rollover (and optionally disables the timer),
  and the timer must be disabled by C5 under D-316-4, which needs a recorded C4b PASS (D-316-13,
  never before C4 is deployed). Stage 6 correction (plan §7 R-042): this entry previously named
  D-316-2, which is the inert AFL API unit installation (C3), not the AFL Tables retirement
  (`issues/open/AFLDB-ISSUE-316.md` §7-§8). The shell script, the trigger and the network register are frozen ISSUE-316 files.
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
- **Stage 6 (Launch E).** No change to the runtime: the AFL Tables timer belongs to ISSUE-316, so
  the V2 cutover runbook deliberately leaves it alone and requires its state to be unchanged across
  the V2 release window (`docs/v2/cutover-runbook.md` §1, step 8).
- **Close.** The owner executes the ISSUE-316 sequence (D-316-1 at C2, the C4b PASS under
  D-316-13, D-316-4 at C5). Until then the production go/no-go for an AFL API-only pipeline is
  **no-go**.

## V2-GAP-012 — The AFL API settle depends on helpers that live in `settle-afltables.ts`

- **CLOSED, Launch F (2026-10-19, `aeea63d1`).** The helpers are now in `src/lib/acquisition/settle-shared.ts`; `settle-afl-api.ts` and `settle-report.ts` import it, and their ratchet edges are removed. The settle integration suites pass on isolated PG16 (see 009).
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

- **Launch F (2026-10-19).** `tools/email_intake/fetch_and_stage.py`, executed directly, refuses before reading the environment or the mailbox. The cutover preflight refuses the release while the email-intake timer can run. Production-only remainder: cutover-runbook step 4, not executed.
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
- **Stage 6 (Launch E).** `docs/v2/cutover-runbook.md` step 4 disables
  `afldb-email-intake.timer` in the same window as the V2 code deploy, before the code, with
  `is-enabled`/`is-active` gates; `docs/v2/rollback-runbook.md` §4.3 covers re-enabling it on a
  rollback. **Written, not executed.** The three integration suites are steps of
  `docs/v2/shadow-rehearsal.md` §7, also not executed.
- **Close.** The owner approves the release window and the operator runs step 4; an operator runs
  the three integration suites on an isolated copy (the shadow rehearsal) and records the result.

## V2-GAP-014 — Python and R legacy tools are not physically quarantined

- **CLOSED locally, 2026-10-19.** Six acquisition implementations/poller moved under
  `legacy/offline/tools/`; original entry points refuse. Offline deterministic replay remains
  reproducible: fresh 30-stage rebuild, 89 validation checks. No normal runtime/package/deploy
  caller can import legacy code. `legacy/offline/README.md` records entry points and boundaries.
  The historical rationale below is superseded; no live timer/service was touched.

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

- **Launch F (2026-10-19).** `shadow-award-reports.ts coleman` on the locally rebuilt history (1980-2025) reports agree 46, disagree 0, not derivable 0. Comparing production data still needs the shadow rehearsal.
- **What.** `deriveColeman` and the comparison report (`@afldb/derived`, ADR 0006) are tested on
  SYNTHETIC inputs (`tests/v2-coleman.test.ts`). No real season has been derived, and no
  comparison against the stored Coleman `award_winners` rows has been produced.
- **Why.** The repository has no committed per-match goal data, and V2 may not read a database.
- **Close.** Export the home-and-away goal facts and identities for the sealed seasons from an
  isolated `afldb_test` (read-only), run the derivation and the comparison report, and review
  every `disagree` and `not_derivable` row before any publication.

## V2-GAP-016 — OWNER DECISION: Brownlow eligibility rule for API-era seasons

- **Local follow-up, 2026-10-19.** Publication now shares the authorised decision transaction,
  updates only metadata, requires the data-edit audit, refuses unresolved leaders and supports
  joint eligible winners. Public queries demonstrably change after a decision; raw values and
  provenance remain identical. 98/98 locally available seasons determined/agreed; none unresolved.
  `evidence/local-brownlow-history-final.json`, ADR 0014 amendment. No bulk historical rewrite.
  Remaining: owner release acceptance and production-dump comparison, NOT implementation/count.
  Final follow-up also closes legacy generic Brownlow read exposure: old URLs redirect to the
  canonical pages, generic award criteria use published flags, and every rank-one criterion
  refuses an unresolved tied leader. Actual public joint winners and unchanged raw votes are
  covered by the final 324/324 focused checks.

- **Launch F (2026-10-19).** The rule is decided and implemented (ADR 0014; `brownlow_eligibility_decisions`, migration 113; PostgreSQL-tested). It stays open per ADR 0014's disposition: the projection path and the blast-radius count remain.
- **What.** The reconciliation (`@afldb/derived`, ADR 0007) refuses a leader determination when an
  ineligible player polled votes, unless the caller selects `stored_eligible_rank_one` (the
  stored-table rule in `src/lib/brownlow/entry.ts`). No rule is recorded for API-era seasons, or
  for retrospective and vacated awards.
- **Why.** Naming a winner is a product rule; V2 does not invent one (plan §7 R-023).
- **Close.** The owner states the rule; it is added as an explicit `eligibilityRule` with tests.
  Related: V2-GAP-010 (API coverage of 2012-2025 has no committed evidence), so even with a rule
  the API-era reconciliation has no committed inputs yet.

## V2-GAP-017 — The Stage 4 migrations and grants are unexecuted on PostgreSQL

- **CLOSED, Launch F (2026-10-19).** Migrations 001-114 were applied by the runner and `tools/db/privileges.ts` ran on isolated `afldb_v2_*_test` databases. `privileges.test.ts` and the V2 awards suites passed 134/134. Every operations-centre page rendered against them from the production build. The 111-114 reversal was rehearsed (`docs/v2/rollback-runbook.md` §7). A database named `afldb_test` was not used: the isolated cluster's `_test` databases served instead.
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

- **CLOSED, Launch F.** `reviseApprovedProposal` (migration 114, ADR 0008) records the revision and its ledger row in one transaction. `tests/integration/v2-curated-awards.test.ts` passes on isolated PG16.
- **What.** `reviseProposal` refuses an approved proposal (`approved_revision_unsupported`).
  Correcting a promoted winner today uses the existing replace/correct lifecycle in
  `src/db/queries/admin-awards.ts`, which does not link back to the proposal chain.
- **Close.** A wrapper over the existing replace/correct functions that records the new revision
  and its ledger row in the same transaction. Not built in Stage 5: the approval card says an
  approved winner is corrected only through `/admin/awards`.

## V2-GAP-019 — No four-eyes rule on curated award approval

- **CLOSED, Launch F.** Owner decision (ADR 0008): the creator may approve only with a written self-approval attestation recorded in the ledger. Tested on PGlite and isolated PG16; rendered in `docs/v2/evidence/launchF-visual/04-*`.
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

- **CLOSED locally, 2026-10-19.** Existing canonical projection retained; offline loader now
  requires the explicitly named offline bootstrap, dedicated isolated DSN and live identity
  proofs. It shares canonical season locks and refuses publisher-owned seasons. Real PostgreSQL
  publication suite 27/27 after migration 115 (`evidence/local-coleman-complete.json`), including
  a commit between acquisition and a competing lock probe; protection lasts until session close.

- **Launch F (2026-10-19).** The projection into `award_winners` is built (ADR 0015, `derived_award_projections`, migration 114) and PostgreSQL-tested. Still open: the offline loader's coleman group is not retired (the rebuild's `coleman` stage still runs it), and production execution is pending.
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

- **Technically inspected, 2026-10-19.** All 26 Launch F images opened and reviewed for
  readability/mobile/permissions/action wording/status clarity; material Brownlow wording and
  missing-API clarity corrected. Four affected screenshots recaptured and opened after final
  build, `evidence/local-visual/`. Assessment: `local-release-review.md`. Owner acceptance pending.

- **Launch F (2026-10-19).** The real pages were served by the production build from the isolated database, with synthetic staff, synthetic proposals and locally rebuilt history. 13 screens were captured as Super Admin and Admin at 1280x800 and 390x844, in `docs/v2/evidence/launchF-visual/` with `capture-log.txt`: HTTP 200, 0 horizontal overflow, 0 console errors and 0 external requests on every capture. The agent inspected the images and fixed one stale-copy defect. The owner's verdict is still required to close this gap.
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

- **CLOSED, Launch F.** Approval returns the server-computed revalidation paths, which the page posts to `/admin/awards/revalidate` (ADR 0008). Tested on isolated PG16 (`v2-curated-awards`).
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

## V2-GAP-026 — The shadow rehearsal, the parity and capture tools on real data, and both rollback paths have never run

- **Local application rollback demonstrated, 2026-10-19.** Archived previous compatible app
  `ff100dc2` (no new worktree), V2, previous retaining additive schema, then V2: all start and
  pass critical public/admin permission checks. Final post-115 previous 15/15 and V2 19/19.
  Raw vote hashes and ledgers unchanged across phases; three proposals/six decisions retained.
  Evidence `local-rollback-*.json`. This does not demonstrate pre-migration schema 110, host
  systemd/Caddy/TLS/backup, production data or destructive reversal with populated new ledgers.

- **Populated-ledger rollback rehearsal, 2026-10-20** (`docs/v2/rollback-populated-rehearsal-2026-10-20.md`).
  Synthetic identities on an archive-derived isolated PG16 copy: 8 proposals, 21 decisions, 2
  derived results, 4 eligibility decisions, 2 projections. Application rollback previous → V2 →
  previous → V2 (18/24/18/24 checks) left ledgers, public pages, permissions and audit unchanged.
  Reversal of 111–115 then data-only `pg_dump -Fc` / `pg_restore` recovery restored every row, id,
  reference, sequence and public result exactly (fail-closed on rerun, schema and grants identical
  after reapplication). The CSV-only procedure the runbook previously described did NOT restore
  identity sequences (the next audited write failed); the runbook now uses the archive. Not shown:
  a production dump, the host backup, systemd/Caddy/TLS, a real previous-release redeploy, and
  V2 writes between export and drop (lost by design). Application rollback with the additive schema
  retained stays the demonstrated route.

- **Launch F (2026-10-19).** The mechanics and the DB reversal were rehearsed on isolated PG16 with local data, NOT a production dump (see `rollback-runbook.md` §7 and `docs/v2/evidence/launchF/`). The synthetic shadow copy went through 111-114 pending → applied, and parity returned VERDICT PASS (5/5). For the reversal, the 001-114 → 001-110 schema is identical and re-forward is identical. Still open: the production-dump rehearsal, real-data parity, the application rollback (§4, redeploying `PREV`) and the backup step (§2).
- **What.** Stage 6 wrote the isolated shadow rehearsal (`docs/v2/shadow-rehearsal.md`), the
  parity tool (`tools/v2/shadow-parity.ts`, policy `v2.parity.1`), the capture tools
  (`tools/v2/shadow-capture.ts`, `tools/v2/shadow-award-reports.ts`), the target guard
  (`tools/v2/shadow-guard.ts`), the cutover runbook and the rollback runbook. The tools are unit
  tested on committed synthetic inputs, fakes and in-memory PGlite only; no command in any of the
  three documents has been run, so the rollback is untested (an owner no-go condition) and the
  parity thresholds have never met real data.
- **Why.** V2 has no database, host or network access (plan §1); restoring a production dump and
  creating databases need the owner's approval (`docs/v2/go-no-go.md` §4, S-A1..S-A5).
- **Close.** An operator runs the rehearsal under those approvals, the parity verdict is PASS (or
  every FAIL is reconciled by the owner), both rollback paths are rehearsed, and the record in
  `docs/v2/shadow-rehearsal.md` §10 is filled in.

## V2-GAP-027 — The AFL API reconciliation report has no producer in the settle CLIs

- **What.** `packages/acquisition/src/reconciliation-report.ts` (Stage 3) defines the
  machine-readable `afldb.v2.afl-api-reconciliation-report` with a builder, validator and JSON
  Schema, but no settle CLI emits it: the only callers are the package index, the stage contract and
  the tests. A rehearsal therefore reads the AFL API settle's outcome from its printed counters and
  exception report (`tools/current-season/settle-afl-api.ts` `counterLines`), not from that file,
  and the parity tool does not take it as an input.
- **Why.** Wiring it into the frozen-adjacent settle CLIs was not in any stage's reviewed scope;
  found while designing the Stage 6 parity inputs.
- **Close.** Emit the report from `settle-afl-api.ts` (an `--report-out <file>` option), test it,
  and add it to the parity inputs under a new policy version.

## V2-GAP-028 — Four integration files disagree with the rebuilt history and current code

- **CLOSED locally, 2026-10-20.** All original cases and teardowns pass on the freshly rebuilt
  `afldb_v2_rb_release_test`: admin-draft **46**, admin-season-lists **40**, awards-reload-links
  **107**, match-admin-delete **7** (**200/200**). Exact original 14 failures are preserved in
  `evidence/local-verification-initial.json`. Illegal test picks corrected inside the real
  <=200 production constraint; registered-season appearances explicitly seeded; captaincy and
  named-medal assertions reconciled by actual source scope; test-owned deletion audit cleaned
  before deleting its administrator. No production rule/assertion was disabled.
  Brownlow backtest/state-B also pass **6/6 + 1/1** without a literal `afldb_test`: loopback,
  approved port, `_test` name, cluster, live current database and marker are all required.
  Frozen DraftGuru provenance/sample checks pass independently of the checkout prefix. Linux
  remains a distinct platform gate, not a condition for closing this demonstrated local defect.
  The final verification follow-up also corrected a counterfactual test's unsupported deadlock
  victim assumption; 46/46 cases retain deadlock, atomicity, timeout and retry assertions for
  both outcomes permitted by PostgreSQL. No runtime guard or role privilege changed.

- **What.** These failures appeared on the isolated rebuild `afldb_v2_hist_test` (2026-10-19):
  - `tests/integration/admin-draft.test.ts`: 11 failures. Manual picks 301/210 are refused with
    "Pick number must be at most 200", and the dependent cases fail after them.
  - `awards-reload-links.test.ts`: 1 failure. The pins are stale: 1,375 captaincies records
    against 1,781 loaded, and 863 named-medal ids against 1,191 read.
  - `admin-season-lists.test.ts`: 2 failures. The appearances projection for `maxYear` is empty.
  - `match-admin-delete.test.ts`: its tests pass, but the teardown FK
    (`data_edits_admin_user_id_fkey`) fails.

  No file involved changed in V2 (`git diff 0f46c3ae..` is empty for them).
- **Why open.** It is unknown whether a Linux `afldb_test` rebuilt at the same commit reproduces
  them. The isolated rebuild ran without the DraftGuru bridge dataset.
- **Close.** Run the four files on Linux `afldb_test` (S-A5). Fix each test or the code at its
  cause, and never weaken an assertion.

## V2-GAP-029 — Strict baseline/reference evidence differs from locally reproduced history

- **Owner decision 2026-10-20:** OPEN as data quality debt. D-V2-MIGRATION-SEPARATION approves
  distinct backend and exact-reference criteria, conditional on existing records, IDs,
  relationships, event/registration/participation coverage and public results being preserved;
  functional ingestion/publication, permissions, audit and rollback must hold. New discrepancies
  block migration. 149 strict, 99 approved, 50 unapproved unchanged; no additional approvals.
  Production compatibility was INCOMPLETE (no approved local backup) at that time. Production NO-GO.
  [Decision](migration-acceptance-2026-10-20.md), [commands](production-shadow-commands.md).
- **Migration acceptance 2026-10-20 (D-V2-BROWNLOW-ALT-1):** the approved archive was rehearsed;
  preservation PASS and, with the scoped Brownlow alternative, migration compatibility PASS for that
  archive and 110 → 115 only. This does not resolve, waive or reclassify any Gridley finding: the
  **50 unapproved findings remain unapproved** (149 strict / 99 approved) and GAP-029 stays OPEN.
  Newly introduced data loss, coverage regression or an unexplained query difference would still block.
  [Decision](owner-decision-brownlow-alternative-2026-10-20.md).

- **Current acceptance:** D-GAP029-21 implemented; 149 strict, 99 approved, 50 unapproved. No data match or release waiver. [Readiness](gap-029-readiness.md), [verification](evidence/gap-029-acceptance-verification.json). The seven-file run below predates this bounded follow-up.

- **Status:** Partly resolved 2026-10-20. Latest seven-file relevant run: **1,397 passed / 3 failed / 7 skipped** on the preserved isolated clone `afldb_v2_gap029_test`. Two original strict Gridley assertions and the new policy-conformance assertion remain failed. Strict: **149 findings**; approved deferrals: **78 (0 data matches)**; unapproved: **71**. Rookie coverage repaired: **23 findings / 7 distinct cells**. No new deferral or production waiver. Detailed evidence: [Gridley closeout](gap-029-gridley-resolution.md), `evidence/gap-029-evidence-verification.json`.
- **Previous full-workflow result (unchanged until rerun):** 13,740 passed / 9 failed / 31 skipped;
  Coleman 27/27; original gap-028 files 200/200. **Focused result after the repairs** (the six GAP-029
  files together on `afldb_v2_rb_final_test`, strict, `evidence/gap-029-focused-tests.json`): 1,374 passed /
  2 failed / 7 skipped of 1,383 (the 7 skips are the existing release-gates skips). Typecheck clean;
  changed-file lint 0 errors / 0 new findings. The full workflow was not rerun: only test files changed.

### Resolved (previous expectation → corrected expectation → why)

1. **club-comparison-route (2 assertions): 42 → 41 through 2025, plus independent later meetings.**
   Adelaide v Brisbane Lions has 41 meetings 1997-2025 in the AFL Tables `results.csv`
   (`full-history-20260902`, 16,838 rows to 2025; its 1991-96 rows are Brisbane Bears, a distinct
   organisation). Independent SQL on organisation slugs gives the same 41. The retained 2026 AFL API feed
   holds two further meetings (Round 7, 2026-04-26; Semi Final, 2026-09-12). The 2026-09-15 pin of 42
   (commit `d9105aba`) was 41 plus one 2026 meeting; which one is not recorded. Not an application defect.
   Regression: the test asserts `through2025 = 41` strictly and `summary.meetings = 41 + season>=2026`.
2. **home-records venue totals: 3200 / 485 → 3151 / 484 through 2025, plus independent 2026.** Source
   `M.C.G.` rows: 3,151 matches, 484 finals; the DB agrees (119 grand finals and max attendance 121,696
   unchanged). The retained 2026 feed has 49 concluded MCG matches by 2026-09-14, exactly 3151 + 49 = 3200,
   and one finals-series match (the 2026-09-04 qualifying/elimination final; Wildcard Finals are
   `is_finals_series = false`), 484 + 1 = 485. The pin was the 2026-09-14 snapshot (`e4f872b9`). Not a defect.
3. **X1 played-and-coached (2 assertions): 367 → 365 through 2025, plus independent 2026-only coaches.**
   The 2026-09-09 evidence was **365** with three matchless coach identities (the original test header
   said so); the 2026-09-12 re-pin to 367 added Josh Carr (Port Adelaide, 23 games, season 2026 only) and
   Josh Fraser (Carlton, 15 games, 2026 only) when 2026 coaching assignments were loaded (AFL Tables
   `coaches_index.csv`). Jim Adamson (North Melbourne 1940, 11 games) is matchless in both snapshots: the
   per-match `Coach` column of `player_stats_1940.csv` is blank for North Melbourne rounds 8-18 (11 matches,
   matching his 11 games) and names Len Thomas for rounds 1-7. **Not repaired:** attributing those 11
   matches to Adamson would be an inference beyond the accepted source (owner decision if wanted; X1 would
   then be 366). Regression: `through2025 = 365` strictly; total = 365 + linked people whose only coached
   matches are 2026+.
4. **release-gates exact 261 / 110 digests (2 assertions): membership UNCHANGED; ordering-only
   disagreement.** The pinned digests are reproduced exactly from the local membership when the AFL Tables
   profile keys are ordered ignoring punctuation (`_`, `/`, `.`) and case — an order inferred to match a punctuation-ignoring
   Linux locale; the original host collation is not directly evidenced, for `string_agg(... ORDER BY external_id)` — and under none of the
   other orderings tried (C, case-folded, ICU `en`/`en-US`/`sv`/`und` at four strengths, numeric on/off;
   only the punctuation-ignoring variants match). The earlier note that locale ordering is not the cause had
   tried only punctuation-significant orders. Membership difference against the reference: **none** (261 =
   261 and 110 = 110 keys; the two original digests are the reference). The V1 host collation itself is not
   observable here. Fix: the test reads keys in C order, asserts the original pins from the legacy ordering
   applied in code (so it holds on any collation) and pins the canonical C-order digests
   `79d3e6eea83a4620` / `258396e0512a2212`. Key lists retained: `evidence/gap-029-identity-cohorts.json`.
5. **Gridley board 541, cell 2-1:** both official club pages were read directly. The 2025 Gold Coast trade follows the 2025-01-07 board. Extracted pages do not expose publication timestamps, so the previous exact completion-day claim is not independently verified here. The general 1-November cutoff was replaced by the narrowly tracked, evidence-checked board/cell/profile/direction record in `data/reference/gridley-board-541-trade.json`; unrelated discrepancies stay strict.

### Latest Gridley closeout

The prior 172 “cells” are **172 findings in 156 distinct cells**. The single machine-readable inventory, `evidence/gap-029-gridley-residual-inventory.json`, retains board dates, criteria, expected-membership references, evaluated actual memberships, observed identity differences, adjudications and exact required evidence; unavailable memberships remain UNKNOWN. No existing raw strict finding was overwritten.

- **Rookie draft:** eight retained independently sourced selections repaired through the established audited manual writer, on an isolated clone. Eight audits, eight durable replay records; second apply is idempotent. **23 findings / 7 cells resolved.** Phil Davis now has directly-read primary evidence. The draft release pin is 6,810 **DraftGuru** rows plus independently accounted durable manual selections, with unexpected sources rejected.
- **Existing deferrals:** §23.36 W.2/W.3 and §23.38 record acceptance of seven still-unsupported criteria, 26 occurrences / 78 cells. The bounded manifest enumerates all 78 and pins the corpus. No calendar expiry was recorded; changed support/scope/evidence requires review. Approved decisions count as **0 data matches** and still fail strict parity. Policy reporting fails on every unapproved difference, independently of diagnostic mode. No new owner approval is needed to represent the existing decisions.
- **42 event cells remain:** no recoverable exact labelled match source was found in the scoped tracked/documented artifacts. Canonical matches have no labels. Need a sourced exact-match export or event evidence; no date/clubs/venue inference.
- **8 registration/2026 cells remain:** the authentic September roster was hash-verified but post-dates the April/May boards. Malcolm Rosas and Finnbar Maley already have canonical identities; Willem Duursma and Jagga Smith do not. Need board-dated registrations and participation, not current memberships.
- **21 sibling cells remain as unapproved criterion disagreements:** direct club and league records establish no senior AFL appearance during Corey’s Brisbane career and distinguish subsequent state-league VFL/NEAFL football. No missing qualifying AFL game is established. Preserve `games > 0`; exact bounded owner proposal and its 71 → 50 policy impact are in the closeout. No approval is applied.

Final strict result: **149 findings / 149 cells = 50 dataset gaps + 78 unsupported + 21 unapproved criterion disagreements**. Policy result: **FAIL, 71 unapproved**. Known-answer errors and solver timeouts: **0**. Full workflow remains the historical result above, not rerun. Typecheck and changed-file lint pass. Original database, SSH listener, credentials and authentication are preserved; the dedicated cluster is verified on loopback **55433** because 55432 belongs to ssh.exe. See [closeout](gap-029-gridley-resolution.md) for exact evidence, commands and owner decision wording.

### Evidence investigation and port-incident follow-up

Launcher authentication on 55432 contacted the documented shared development endpoint through the SSH forward. Local PID/start time, forwarding arguments, SSH configuration and retained failure log support that finding; remote cluster/database identity, authentication method and logs remain unknown. Earlier blanket no-production/shared-contact wording is withdrawn. No new tunnel connection or SSH process change was made. New launcher preflight proves PID/executable/data-directory/loopback ownership before credentials, then retains SQL identity checks. Guard regressions 17/17; positive 55433 and negative 55432 checks pass.

The actual committed `common.py` rookie replay restores 8/8 removed selections on a dedicated rollback-only clone, remains idempotent, preserves eight audits/eight overrides and rolls the fixture back. The baseline and repair clone are unchanged. One targeted recovery pass found partial official event histories/two exact fixtures and dated affiliations for the four 2026 players, but no complete event-label artifact or complete board-date teammate snapshots; no partial dataset was promoted. See `gap-029-targeted-recovery.json`, `gap-029-port-incident.json`, `gap-029-rookie-actual-replay.json`, and latest `gap-029-evidence-verification.json`. Typecheck and changed-file lint pass; full workflow not run.
