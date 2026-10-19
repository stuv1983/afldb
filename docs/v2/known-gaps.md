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
| V2-GAP-006 | Medium | historical baseline | narrowed (Stage 3): enforced at the AFL API settle CLIs; database-level and other writers open |
| V2-GAP-007 | Medium | historical baseline | open: manifest producer never run |
| V2-GAP-008 | High | AFL API fixtures | **open: cutover blocker** (AFLDB-ISSUE-229 B2 and the unbuilt fixtures writer) |
| V2-GAP-009 | Medium | AFL API promotion | open: transactional preservation unexecuted on PostgreSQL |
| V2-GAP-010 | Medium | AFL API coverage | open: 2012-2025 API coverage has no committed evidence |

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
- **Close.** An owner decision on database-level enforcement (an additive `111_`+ migration under
  plan D4), and the Stage 4 legacy quarantine (plan D10) for the other writers.

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
