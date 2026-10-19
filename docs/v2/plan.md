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

## 7. Review resolutions (Launch A plan review, 2026-10-19)

Review: `docs/v2/reviews/plan-review-launchA-2026-10-19.md` (afldb-reviewer). Verdict
proceed-with-resolutions; no owner stop condition reached. The owner's working mode (do not
return for routine clarification or design choices; stop only for the listed conditions)
overrides the agent protocol's "CRIT/HIGH at plan review goes to the user", so the orchestrator
resolved every finding below with the most conservative option consistent with the instruction.
These resolutions amend §3 and §4 and bind Launches A-E.

- **R-001 (HIGH) D5 means strip, never throw.** `tests/setup.ts` is the global setup file for
  every test file. With `AFLDB_TEST_DATABASE_URL` absent it removes every `*DATABASE_URL*`
  variable and the libpq `PG*` connection variables from the test process and does not throw.
  The existing throw for `AFLDB_TEST_IMPORT_DATABASE_URL` without a test DSN is evaluated
  **before** the strip, so it still fires. Stage 1 acceptance is the **full** `vitest run
  --no-cache` diffed against `docs/v2/evidence/baseline-failures.txt` (same failing-file set,
  same failing-case set, unchanged load-failure messages), not the seven-suite set.
- **R-002 (HIGH) D5 proof tests must be non-vacuous.** The policy is a pure function
  (`applyTestDsnPolicy(env)`; implemented at `packages/testing/src/dsn-policy.ts`, exported by `@afldb/testing`), called by `tests/setup.ts` after the `.env`
  load, and unit-tested on env objects: absent DSN strips without throwing; a `_test` DSN plus a
  stray `DATABASE_URL` redirects `DATABASE_URL` to the test DSN (never deletes it); `afldb_dev`
  throws the existing message; `afldb_prod` throws by the same `_test$` allowlist suffix (the rule
  is the suffix, not a host heuristic); a non-URL throws. The present-DSN branch is labelled
  **unverified on a live database** (no database exists on this workstation).
- **R-003 (MED) runtime files keep accepting production DSNs.** `src/db/client.ts`,
  `src/db/authClient.ts` and `tools/current-season/load-env.ts` change only inside a test process
  (`process.env.VITEST` set, which vitest also hands to children it spawns): the clients refuse a
  DSN whose database name does not end in `_test` unless it is a never-connectable unit
  placeholder (an RFC 6761 `.invalid` host, or a loopback host on port 1, the repository's
  existing placeholder convention); `loadEnv()` does not populate `*DATABASE_URL*`/`PG*` names
  from a `.env` file. Outside a test process their behaviour is byte-for-byte unchanged in effect.
- **R-004 (MED) other DSNs in the present-DSN branch.** Resolved by **strip**, not throw: when a
  test DSN is present, any other set `*DATABASE_URL*` variable whose database name does not end in
  `_test` is removed (`DATABASE_URL` is redirected as before). The reviewer suggested a throw for
  `AFLDB_AUTH_DATABASE_URL`; strip was chosen because it is equally fail-closed (the variable can
  no longer reach a non-test database) without failing every suite on a host whose `.env` holds a
  DEV auth DSN that the integration files already overwrite with the test DSN. Unverifiable
  locally; recorded in `docs/v2/known-gaps.md`.
- **R-005 (MED) no `next build` in V2.** Ten `generateStaticParams` routes and the eager pool in
  `src/db/client.ts` make the production build require a database. It is not attempted; the gate
  is `next typegen` + `tsc`. Every `next` command runs with `NEXT_TELEMETRY_DISABLED=1`. Recorded
  as a V2-GAP.
- **R-006 (MED) omitted owner deliverables are assigned:** Stage 1 `docs/v2/architecture.md`
  (implemented state, including the `apps/web`/`apps/worker` mapping table); Stage 2 the database
  compatibility and ownership matrix (`docs/v2/db-ownership-matrix.md`, draft), completed in
  Stage 4; Stage 4 the "runtime independent of CSV/AFL Tables/Squiggle/Kali" and "no scheduler or
  admin path invokes offline legacy tools" tests; Stage 5 the admin-centre operating guide and a
  frontend contract test; Stage 6 the migration plan and a backup **and** rollback plan.
- **R-007 (MED) Stage 2 tooling semantics.** The comparator is DSN-free (two manifest files in, a
  diff out). The producer takes a DSN only through an explicit `--dsn-env <VAR>` flag (never
  implicitly from `DATABASE_URL`); a database whose name does not end in `_test` additionally
  requires both `--read-only-source` and `--i-understand-this-reads-a-non-test-database`; read-only
  is enforced server-side (`BEGIN READ ONLY` plus `SET TRANSACTION READ ONLY`/
  `default_transaction_read_only`) and asserted through a fake client in unit tests; the manifest
  holds counts and checksums only, never row content; it is never run against any database in
  Launch A. Restoration and reconciliation are documented in `docs/v2/historical-baseline.md`.
- **R-008 (MED, Stage 4)** A `111_`+ migration that grants through `afldb_meta` functions names the
  `tools/db/privileges.ts` change and carries a 097-style deploy-order comment (migration, then
  privileges, then code; ISSUE-027). In pglite, grant statements are either run against labelled
  stubs or marked "statically reviewed, unexecuted". `-- ROLLBACK:` blocks are comment lines only.
- **R-009 (LOW)** `@afldb/*` maps to `./packages/*/src/index.ts` only; subpath imports are
  forbidden by the boundary test; package tests live under `tests/` (vitest collects `tests/**`).
- **R-010 (LOW)** The boundary test resolves relative specifiers to files (so `../../src/...`
  escapes are caught), not only bare specifiers. `packages/testing` may import any package; only
  `tests/**` may import `@afldb/testing`.
- **R-011 (LOW)** Lint gate: no new ESLint findings in files V2 creates or edits; the 253 errors /
  132 warnings recorded in `baseline.md` are not fixed opportunistically.
- **R-012 (INFO)** Commit attribution uses the model that commits; the D3 departure from CLAUDE.md
  §5 is stated in the CHANGELOG V2 section. The reviewer's hazard check is answered: at
  2026-10-19 09:18:47 +11:00 an empty stray file `supplies` appeared at the source worktree root
  (`git status` shows `?? supplies`), consistent with the documented Read/Grep hook defect. It was
  **not** deleted (the source is read-only to V2); it is reported to the owner.

### Launch B decisions (Stage 3, 2026-10-19)

Recorded by the orchestrator under the owner's working mode (conservative choices, no routine
return). Sub-agent returns: `.phaneslight/returns/launchB-20261019/`. No new plan review: Launch B
continues the reviewed plan.

- **R-013 Seal choke point.** The seal (V2-GAP-006) is enforced in the three AFL API settle CLIs,
  after the manifest season is known and before any database client exists, through one helper
  (`tools/current-season/settle-season-seal.ts`) over a pure domain rule
  (`packages/domain/src/season-seal.ts`). The library functions (`runSettleAflApi`,
  `runSettleAflApiBrownlow`, `canonical-apply.ts`) are unchanged so integration suites that drive
  them with synthetic seasons keep their semantics; their per-target `season_not_in_progress` gate
  remains the backstop. Settle is never an audited correction (`correction: null`); the Brownlow
  completed-season backtest keeps its live `afldb_test` proof first and is logged as a separate,
  non-correction basis. A null or non-integer season is treated as sealed (fail-closed).
- **R-014 Coverage grading.** `api_verified` needs a committed stored fixture AND a committed test;
  2026 player statistics rest on one stored sample and are graded `api_partial` (worker W1 had
  proposed `api_verified`; downgraded for honesty). 2026 results stay `api_verified` because the
  whole stored season feed carries every concluded score and a test proves it complete.
- **R-015 Writer-free acquire constants.** Worker W5 found (MED) that the acquire CLIs reached the
  Brownlow settle and the observation store through three constant imports. The constants moved
  unchanged to `src/lib/acquisition/afl-api-acquisition-constants.ts` and are re-exported from
  their original modules; a static test now proves the acquire closure reaches no writer.
- **R-016 Façade scope.** `@afldb/acquisition` re-exports only modules whose runtime import closure
  reaches no `src/db/**`, `server-only` or writer module; the settle writers, `settle-core` and the
  derived recompute are cited by path in the stage contract (`AFL_API_PIPELINE`) instead, and
  replay takes the bundle builder by dependency injection.
- **R-017 No PGlite in Stage 3.** The AFL API settle needs the full 110-migration schema with its
  roles and grants, which plan D2 forbids extending PGlite to; transactional preservation is proved
  at the plan level and recorded as unexecuted (V2-GAP-009).
- **R-018 Fixture contract interpretation.** `LIVE`/`POSTGAME` are refused as `status_deferred`
  (non-projecting; the runbook's "fail closed"); swapped home/away on the same date is a refusal in
  the V2 fixture contract, stricter than the existing match path, which treats it as a different
  fixture. No fixtures writer is wired (AFLDB-ISSUE-229 B2 open: V2-GAP-008, cutover blocker).
- **R-019 Client defaults.** 4xx other than 408/425/429 are not retried; `Retry-After` is capped at
  30 s; the acquire tools space request starts by 250 ms, an implementation default because no
  provider limit is documented.

### Launch C decisions (Stage 4, 2026-10-19)

- **R-020 PGlite installed (D2).** `@electric-sql/pglite` 0.2.17, exact-pinned devDependency
  (ADR 0012). Used only in memory (no `dataDir`) by tests, to execute V2's own migrations over
  labelled stub prerequisites and stub roles. It is never extended to the 001-110 schema with its
  real roles and grants (D2), and a PGlite pass is not evidence for PostgreSQL: every V2 migration
  stays "unexecuted on PostgreSQL".
- **R-021 Read-only search under §9.** A mechanic declined to run `grep`/`sed` because the owner's
  command list does not name them. The launch rules' hook-hazard rule directs search through Bash
  (`grep -rn`, `find`) inside V2, so the orchestrator treats read-only search and file reading in
  V2 as authorised for this launch; nothing else is widened. The blocked enumeration was redone by
  the orchestrator.
- **R-022 Coleman season completeness.** "Complete" is the seal: a season is complete when it is
  sealed in `data/reference/seasons.json`; "settled" is an explicit caller attestation. So every
  derivable season is a sealed season. The derivation's comparison with stored rows is a report
  (agree / disagree / not derivable), never an overwrite (ADR 0006).
- **R-023 Brownlow eligibility.** The reconciliation's default `eligibilityRule` is `unrecorded`:
  if an ineligible player polled votes, the leader determination is refused. The opt-in
  `stored_eligible_rank_one` mirrors the stored-table rule (`src/lib/brownlow/entry.ts`:
  eligible rank 1). No rule exists for API-era seasons or retrospective/vacated awards; that is an
  owner decision (ADR 0007, V2-GAP-016). Ties give joint leaders; no winner rule is invented.
- **R-024 Curated awards shape.** Proposals and their append-only decision ledger are new tables
  (migration 111) keyed by natural identity (award slug, durable player identity string, club
  slug) with no FK into football tables, so a rebuild cannot empty them and promotion needs no
  remap. Transitions are audited in that ledger, not in `data_edits`: widening the `data_edits`
  allowlist would cascade into the promotion-inventory lineage rules. The approved winner is
  written by the existing `insertAwardWinner` in the same transaction. No four-eyes rule
  (V2-GAP-019). A Wikipedia-sourced proposal needs a `wikipedia.org` URL and an approval note of
  at least 20 characters; files only create proposals.
- **R-025 Legacy scope in Stage 4.** Only TypeScript entry points are moved: the Squiggle/Kali CLI
  is quarantined and its package script refuses through the `@afldb/domain` retired-entry
  registry. The AFL Tables runtime stays behind the ISSUE-316 boundary (frozen files; D-316-2 is
  the owner's, V2-GAP-011). Admin runtime paths (CSV upload, submission promotion, email intake,
  Squiggle/Kali refresh) are Stage 5's (V2-GAP-013). Python/R tools stay in place because V2
  cannot run them to prove a move (V2-GAP-014). A ratchet test lists every known legacy runtime
  edge, so a new one fails.
- **R-026 `external_identities` ownership.** One owner per source partition: `afl_api` rows belong
  to `@afldb/admin` adjudication (plus the offline bridge, correction and replay tools, never a
  settle); `afltables` rows to the offline historical loaders, with the admin attach as the audited
  correction restored by the replay; `draftguru` rows to its loader; `manual_admin_edit` rows to
  `@afldb/admin` (`docs/v2/db-ownership-matrix.md`).
- **R-027 CSV promotion classification.** The CSV submission promotion writes canonical tables
  directly (`src/lib/ingest/datasets.ts`), so it is classified remove-from-runtime and listed as a
  cutover blocker, not disabled in Stage 4: making admin server actions refuse is Stage 5's admin
  scope, and the email-intake timer is a deployment act.
- **R-028 Coleman publication.** Because a derivable season is complete and therefore sealed
  (R-022), every publication is an audited correction through the season seal, under one new
  workflow id `derived_award_publication` (`docs/v2/historical-baseline.md` §2). The publisher
  derives inside the call (it never accepts a prebuilt result), requires `data.awards.edit`, and
  requires the publishing user to be the correction's actor. Recompute is idempotent (`unchanged`,
  no write) or `superseded` (a new row pointing at the previous one). "Current" is derived from an
  append-only chain, never an UPDATE; the ledger has no FK into football tables; the publisher
  never writes `award_winners` (V2-GAP-021). Migration 112, ADR 0006.
- **R-029 Curated approval and the seal.** The orchestrator found (MED) that `approveProposal`
  wrote `award_winners`, a sealed historical table, without consulting the seal. Approval now
  evaluates the seal inside its transaction, before the promotion port, under a new workflow
  `curated_award_approval`: an open season proceeds as before; a sealed season needs a decision
  note of 20-2000 characters, otherwise the approval is refused and rolled back. The caller
  supplies the sealed set (`ApproveDependencies.sealed`); the package does no file I/O. The only
  sealed-set loader today is `tools/current-season/settle-season-seal.ts`; Stage 5 supplies one for
  `src/`.

### Launch D decisions (Stage 5, 2026-10-19)

Launch D continued the reviewed plan; no new plan review was run (launch instruction).

- **R-030 Retire by refusal, not removal.** Each retired admin surface keeps its export name and its
  existing guard as the first awaited statement, then returns the typed refusal from
  `RETIRED_ADMIN_SURFACES` (`packages/domain/src/legacy-retirement.ts`; 5 surfaces, 7 exports):
  `{ refused: true, code: 'legacy_retired', surface, error }`; routes answer HTTP 410. One
  best-effort `admin.legacy_retired_refused` audit row (detail `{ surface, export }`) per
  attributed refusal (`src/lib/admin/retired-admin.ts`). Retired actions take no parameters, so no
  caller input is read. The retired UI components are deleted; guards g-i in
  `docs/v2/legacy-disposition.md` §2 keep them deleted and the refusals refusing.
- **R-031 Email intake refuses unattributed.** `POST /api/admin/email-intake` answers 410 without
  reading the body, comparing the shared secret, touching the database or auditing: a caller
  that cannot be attributed must not be able to write audit rows. The poller files a 4xx to its
  Errors folder and never deletes it; disabling the timer is Stage 6 (V2-GAP-013).
- **R-032 Libraries stay.** `pipeline.ts`, `datasets.ts` and `src/lib/external-afl/*` remain because
  offline tools and the quarantined CLI use them; no admin file may import them (guard h). The
  ISSUE-273/304 race coverage is kept at library level through a test-local helper; the
  route-level coverage went with the routes.
- **R-033 One new capability.** `operations.centre.read` (Admin and Super Admin) gates the read-only
  overview. Mutations reuse existing capabilities (`data.awards.edit`; reads `data.awards.read`,
  `data.brownlow.read`). The sidebar gains "Operations centre" and loses "Legacy file intake" for
  Admin and Super Admin; the contributor branch is unchanged (its one link now shows the
  retirement notice; the role is otherwise refused by `getAdminUser`, AFLDB-ISSUE-186).
- **R-034 Two audit layers.** The durable audit is in the mutation's own transaction: the proposal
  ledger and `data_edits` (curated awards), `derived_award_results.correction` (Coleman). The
  activity trail is one best-effort `auth_audit_log` row per mutation attempt (success,
  unchanged, refusal), written on the auth pool after the transaction settles, as in the
  awards admin; it never changes the outcome, and an audit failure is reported to the operator
  as "the change WAS made". Reads write no audit row.
- **R-035 Coleman wiring without projection.** Compare is read-only (`data.awards.read`); publish
  needs `data.awards.edit`, a 20-2000 character note and the operator's settled attestation
  (R-022), with evidence reference `coleman_derivation:<season>:<inputChecksum>`. The goal facts are
  read before the publisher opens its transaction (it cannot nest); the stored checksum and inputs
  make the record reproducible. Still no projection into `award_winners` (V2-GAP-021).
- **R-036 Sealed-season loader in `src/`.** `src/lib/seasons/sealed-seasons.ts` reads
  `data/reference/seasons.json` fresh on every approval and publication; a missing or malformed
  registry raises `SeasonRegistryError` and the action is refused (the seal fails closed).
- **R-037 One connection role.** Every operations-centre database call uses the `afldb_import`
  connection (`withAwardProposalExecutor`, `AFLDB_IMPORT_DATABASE_URL`), as the other audited
  editors do; never `afldb_app`. Unexecuted on PostgreSQL (V2-GAP-017).
- **R-038 Brownlow view read-only.** Default eligibility rule `unrecorded` (R-023); no leaderboard
  and no provider-team mapping are passed (V2-GAP-023); a leader is shown only when determined.
- **R-039 Visual evidence.** Real pages need a database and a session, so they stay
  `VISUAL: UNVERIFIED` (V2-GAP-022). The presentational components were captured offline from
  SYNTHETIC props with the local Playwright Chromium (every non-file request aborted);
  the one overflow the automated check found was fixed. No visual pass is claimed.
- **R-040 Public revalidation deferred.** The orchestrator found (MED) that a curated approval
  does not refresh the cached public award pages. Fixing it needs revalidation paths through the
  `@afldb/admin` promotion port, outside the reviewed Stage 5 scope; recorded as V2-GAP-024.
- **R-041 No dedicated settle-refusal view.** D9 names "reconciliation failures": Stage 5 surfaces
  the Brownlow reconciliation and run status only; AFL API settle refusals stay in their reports
  and tables (V2-GAP-025).
