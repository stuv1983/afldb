# AFLDB V2 — rebuild plan (execution contract)

Status: **approved by the owner's V2 rebuild instruction of 2026-10-19** (local work only).
This file is the contract every V2 stage executes against. It records decisions already
made so they are not re-litigated mid-stage. A stage that finds material evidence against a
decision stops that workstream, records the contradiction in `docs/v2/known-gaps.md`, and
continues the other workstreams.

## 1. Authority (verbatim limits from the owner's instruction)

Authorised, for this rebuild only:

- read and modify files in `D:\dev\afldbV2` (the V2 repository);
- read the source worktree `D:\dev\afldb-afl-api-cutover` (never modify, clean, reset or stash it);
- run local formatting, linting, type checking, unit tests and isolated tests in V2;
- create additive migrations, fixtures and migration tooling;
- create local Git branches and **local commits in V2** (several well-scoped commits);
- refactor, reorganise and remove code inside V2 after preserving required function and history;
- write architecture, migration, risk, operational and cutover documentation.

This authorisation satisfies CLAUDE.md §9/§12's "explicit authorisation" **for these local
V2 commands only**. It is not standing authorisation for anything below.

Forbidden (stop the workstream and record a blocker instead):

- contacting, querying or mutating production, DEV (`afldb_dev`), the dev host, or `afldb_test`
  (no tunnel is open and no DSN is provided to V2 — do not look for one, do not copy any `.env`);
- running C4b, any settle, acquire, rollover, migration or privilege command against any database;
- installing or activating services, deploying, `git push`, tags, pull requests;
- reading, copying, rotating or printing secrets; copying `.env*` into V2;
- granting or using D-316-13, executing D-316-2, or treating V2 as approval of any ISSUE-316 gate;
- fabricating live API responses, historical results or player mappings;
- network access other than the npm registry for an already-decided devDependency (§3 D2).

## 2. Baseline (recorded by the primary session; see `docs/v2/baseline.md`)

- Source: `D:\dev\afldb-afl-api-cutover`, branch `opus/afl-api-cutover`, HEAD `ff100dc2`, plus 19
  uncommitted files (ISSUE-316 follow-up 8), preserved at `D:\tmp\afldbV2-source-snapshot-20261019\`.
- V2: `D:\dev\afldbV2`, branch `v2/rebuild`, cloned from the local repository at `ff100dc2`,
  `origin` remote **removed** (nothing to push to), own `node_modules` from `npm ci`.
- Seven-suite baseline in V2: 829 passed, 2 skipped (831), identical to the source.

## 3. Decisions (made; do not re-open without contradicting evidence)

- **D1 Layout: in-place strangler, not a physical monorepo move.** The Next.js app stays at the
  repository root and *is* `apps/web` logically (systemd units, `prepare-standalone.mjs`, Caddy,
  1,881 tracked files and every test assume root paths; a physical move is high-risk, low-value).
  New V2 code lives in `packages/<module>/src/**` reached through tsconfig `paths`
  `@afldb/<module>` (mirrored in `vitest.config.mts`). Modules: `domain`, `db`, `acquisition`,
  `derived`, `admin`, `testing`. `apps/worker` is the documented mapping onto
  `tools/current-season/*` and the AFL API systemd units (no move). The mapping table lives in
  `docs/v2/architecture.md`. Existing `src/lib/**` code is **wrapped or re-exported**, not
  rewritten, unless a V2 requirement needs new behaviour.
- **Dependency direction** (enforced by ESLint `no-restricted-imports` and a test):
  `domain` imports nothing internal; `db` imports `domain`; `acquisition`, `derived`, `admin`
  import `domain` and `db`; `src/app/**` and `src/components/**` must not import
  `@afldb/acquisition` or any legacy path; nothing outside `legacy/` imports `legacy/**`;
  acquisition clients never write final tables (writes go through promotion/settle).
- **D2 Dependencies.** No new runtime dependency. One devDependency may be added, exact-pinned:
  `@electric-sql/pglite`, solely to execute new V2 migration SQL and transactional contract tests
  in-process. If it cannot run the needed SQL, stop that attempt, record it, and mark the SQL
  "statically reviewed, unexecuted". Never extend it to the 110 existing migrations' roles/grants.
- **D3 Tracking.** V2 does **not** allocate new `AFLDB-ISSUE-NNN` IDs (they would collide with the
  mainline ledger). V2 gaps, blockers and deferred work use `V2-GAP-NNN` in
  `docs/v2/known-gaps.md`. `CHANGELOG.md` gets an `Unreleased → AFLDB V2` section.
  `issues.md`/`IssuesIndex.md` are left as inherited from the source (ISSUE-316 stays open).
- **D4 Database.** Additive migrations only, numbered from `111_`, each with a documented reversal
  (a `-- ROLLBACK:` block or a `docs/v2/rollback/` script) and no rewrite of existing rows. Stable
  IDs and FKs untouched. New public tables obey the fail-closed app-read grant pattern
  (`grant_app_read()`, see migration history). No migration is applied to any real database.
- **D5 Connection safety (Stage 1, first code change).** `tests/setup.ts` must make an absent
  `AFLDB_TEST_DATABASE_URL` fail closed: remove `DATABASE_URL` and every other DSN variable from
  the test process so no test can reach a non-test database. Add tests proving: a non-`_test` DSN is
  refused; a production-looking DSN is refused; with no test DSN, `DATABASE_URL` is unset in tests.
  Inspect `src/db/client.ts`, `src/db/authClient.ts`, `tools/current-season/load-env.ts` for any
  path where a tool or test could pick up a non-local DSN and add the narrowest fail-closed guard.
- **D6 Coleman.** Derived, never ingested: `packages/derived` holds a pure derivation over
  promoted player goal facts (home-and-away only per the existing ISSUE-111 definition — read
  `tools/migration/import_awards.py` / `award_definitions.py` for the agreed scope; do not
  invent a different one), complete-and-settled season required, ties supported, leaderboard and
  inputs preserved, derivation version + timestamp + input checksum recorded, refusal for incomplete
  seasons, idempotent recompute. Publication goes through an explicit audited operation.
- **D7 Brownlow.** AFL API remains authoritative. V2 adds a pure reconciliation module (duplicate
  votes, per-player totals vs leaderboard, round/match/club consistency, unresolved players,
  incomplete seasons, ties reported without a winner rule) over the existing snapshot/staging
  shapes. The strengthened timer and settlement conditions from ISSUE-316/ISSUE-232 are preserved
  byte-for-byte unless a test proves a change is required.
- **D8 Curated awards.** Proposal → validation → review → transactional approval/rejection →
  revisions, all audited, via `packages/admin` services with capability checks; manual entry in the
  admin data editor uses the same pathway. Wikipedia input is a locally supplied file prepared
  offline into proposals; never auto-approved, never fetched by runtime code.
- **D9 Admin.** A small operations centre (data health, acquisition runs, reconciliation failures,
  unresolved identities, award proposals, derived-result status, audit log, explicit maintenance,
  read-only inspection). Each action shows what changes, affected season/records, validation state,
  reversibility, acting user, resulting audit entry. Legacy runtime controls (CSV-to-final-table,
  AFL Tables/Squiggle/Kali triggers, run-everything, hidden settle side effects) are removed from
  the UI **and** their server actions refuse. Existing audited editors are kept behind explicit
  capabilities. UI work carries the Visual Evidence Mandate: with no database, captures will
  normally be impossible — mark `VISUAL: UNVERIFIED` with the reason; never claim a visual pass.
- **D10 Legacy.** Every ingestion path is classified in `docs/v2/legacy-disposition.md`
  (removed / offline evidence / disabled compatibility boundary / replaced by AFL API / replaced by
  derivation / replaced by curated entry). Offline historical tools move under `legacy/offline/`
  only where the move is safe (update their tests' paths); where a move would break the sealed
  historical rebuild, they stay in place but are classified and blocked from runtime by test. No
  scheduler registration, no runtime import, no admin button. **Never delete the only recoverable
  source of historical knowledge.**
- **D11 Coverage.** An explicit coverage registry (`api_verified`, `api_partial`,
  `historical_baseline`, `manual_curated`, `unsupported`) per season and data family, every claim
  tied to a test, stored fixture or cited document. Unverified seasons are never labelled
  rebuildable. Use the existing season registry/identities files as evidence; do not fetch.

## 4. Stages, deliverables and acceptance

Each stage ends with: relevant tests run, `tsc --noEmit --incremental false`, `eslint --no-cache`
on changed files, diff review for secrets/caches/artefacts, then a local commit. Run vitest with
`--no-cache`, with `DATABASE_URL`, `AFLDB_TEST_DATABASE_URL` and `AFLDB_TEST_IMPORT_DATABASE_URL`
unset and `TEMP`/`TMP` pointed at a scratch directory.

| Stage | Deliverables | Acceptance |
|---|---|---|
| 0 Evidence | `docs/v2/baseline.md` (done by primary); `docs/v2/inventory.md`: backend, frontend, DB, admin dependencies; every legacy ingestion entry point (src, tools, deploy, package scripts) | inventory cites file paths; numbers re-derivable |
| 1 Foundation | D5 guards + tests; `packages/*` skeleton + aliases + ESLint boundary rules + boundary test; ADRs `docs/v2/adr/0001…`; README V2 section | baseline suites unchanged; new tests pass; tsc/eslint clean |
| 2 Historical baseline | `docs/v2/historical-baseline.md`; provenance model doc; read-only verification tooling (checksums/counts manifest spec, comparison script that takes a DSN only from an explicit flag and refuses non-`_test` unless `--read-only` + explicit confirmation flag) — not run against anything | tool unit-tested with fixtures only |
| 3 AFL API pipeline | `packages/acquisition` façade over existing client/snapshot/staging/resolve/promote; coverage registry; fixture identity contracts (duplicate, rescheduled, finals mapping, cancelled/postponed/abandoned, home/away/venue); player resolution refusal (no placeholders); replay-from-snapshot; rate limit/retry/timeout bounds; machine-readable reconciliation report | tests for each; ISSUE-229 residue (if any) recorded as cutover blocker, not invented |
| 4 Derived + curated | Coleman (D6); Brownlow reconciliation (D7); curated awards (D8) migration + services; legacy imports quarantined (D10) | the test lists in the owner's instruction for Coleman, Brownlow and curated awards |
| 5 Admin | operations centre (D9); nav simplification; legacy controls removed and refusing; role + audit tests | permission/audit tests; `VISUAL:` status recorded |
| 6 Shadow-ready | comparison report tooling + parity thresholds; isolated shadow-run commands (documented, not executed); rollback + cutover runbooks; go/no-go checklist; risk register; known gaps; changelog | every required document exists and describes implemented state only |

## 5. Commits (local only, in V2)

1. baseline controlled fork + safety controls; 2. architecture + DB boundaries; 3. AFL API
pipeline; 4. Brownlow + Coleman; 5. curated awards; 6. admin centre; 7. legacy quarantine;
8. tests + operational docs. Merging adjacent ones is fine; splitting is fine. Message style:
conventional prefix + scope (`feat(v2-derived): …`), ending with the attribution line
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## 6. Honesty rules

Documentation describes what exists and was run. Anything not executed (SQL against PostgreSQL,
UI rendering, Linux behaviour, live API) is labelled unexecuted with the reason. Test counts are
read from runs, never predicted. Do not weaken, skip or delete tests to obtain a pass; explain
environmental skips exactly. Production go/no-go stays **no-go** while any ISSUE-316 gate or
D-316-13 remains unsatisfied.
