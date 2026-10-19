# AFLDB V2 — progress and handoff

The handoff file for every V2 launch. Updated at every commit. Counts are read from runs, never
predicted. Source of authority: `docs/v2/plan.md` (sections 1-6 and the section 7 review
resolutions) and `docs/v2/owner-instruction-2026-10-19.md`.

## Run discipline (every launch)

- Work only in `D:\dev\afldbV2`. The source worktree `D:\dev\afldb-afl-api-cutover` is read-only.
- Test/type/lint commands run with `env -u DATABASE_URL -u AFLDB_TEST_DATABASE_URL
  -u AFLDB_TEST_IMPORT_DATABASE_URL`, `TEMP`/`TMP`/`TMPDIR` pointed at a scratch directory, and
  `NEXT_TELEMETRY_DISABLED=1` for `next`: `npx vitest run --no-cache …`,
  `npx tsc --noEmit --incremental false`, `npx eslint --no-cache <files>`.
- Full-suite gate: the failing-test set must equal `docs/v2/evidence/baseline-failures.txt`
  exactly (compare the sorted ` FAIL ` lines). Lint gate: no new findings in files V2 creates or
  edits, and the repository-wide count stays at 253 errors / 132 warnings.
- Returns from sub-agents are persisted under `.phaneslight/returns/<run-id>/` (git-ignored).

## Stage status

| Stage | Status | Commits |
|---|---|---|
| Plan review (Launch A) | done; resolutions in `plan.md` §7 | `58ec8626` |
| 0 Evidence | done: `docs/v2/baseline.md` (primary session), `docs/v2/inventory.md` | `58ec8626` |
| 1 Foundation | done; closure verified (no CRIT/HIGH/MED) | `37f4fc0e` |
| 2 Historical baseline | done; closure verified, its MED fixed | `80e110d6`, `a4b2c8d8` (closure fix) |
| 3 AFL API pipeline | done; afldb-closure PASS_WITH_FINDINGS (LOW/INFO only) (Launch B) | b87a980e, fdd08ca3, 7c2db0d5, a7738391 + this progress commit |
| 4 Derived + curated | done; afldb-closure PASS_WITH_FINDINGS (LOW/INFO only) (Launch C) | `fad164cd`, `4c34be93`, `ddb42525`, `498fd46d`, `034f6947`, `4c54e0d9`, `1374fc13` + this closure commit |
| 5 Admin | in progress (Launch D): legacy admin controls retired (milestone 1); operations centre in progress | this commit |
| 6 | not started (Launch E) | — |

## Stage 0 — evidence

- `docs/v2/inventory.md`: headline counts re-derived (52 public pages, 56 admin pages, 19 route
  handlers, 30 server-action files, 74 query modules, 110 migrations, 118 `src/lib` files, 55
  package scripts, 33 deploy files) and the legacy ingestion invoker matrix L1-L13.
- Open fact for Stage 4: `tools/current-season/update-current-season.ts:52` defaults `--source`
  to `squiggle` (mechanic finding F-001, LOW).

## Stage 1 — foundation

Delivered:

- D5 connection safety (ADR 0005): `packages/testing/src/dsn-policy.ts` (`applyTestDsnPolicy`),
  `tests/setup.ts` calling it, `src/db/test-process-guard.ts` used by `src/db/client.ts` and
  `src/db/authClient.ts`, and the `loadEnv()` test-process filter in
  `tools/current-season/load-env.ts`. Tests: `tests/dsn-policy.test.ts` (20 tests). Negative
  control: with the three guards disabled, 3 of its cases fail; restored, all pass.
- D1 module skeleton (ADR 0001): `packages/{domain,db,acquisition,derived,admin,testing}/src/index.ts`,
  `@afldb/*` in `tsconfig.json` and `vitest.config.mts`, ESLint boundary blocks in
  `eslint.config.mjs`, `packages/testing/src/module-boundaries.ts` and
  `tests/v2-module-boundaries.test.ts` (14 tests).
- ADRs 0001-0011, `docs/v2/architecture.md`, `docs/v2/known-gaps.md` (V2-GAP-001..004), README
  V2 section, `CHANGELOG.md` `### AFLDB V2`.

Results read from runs (2026-10-19):

| Check | Result |
|---|---|
| `tests/dsn-policy.test.ts` + `tests/v2-module-boundaries.test.ts` | 34 passed (2 files) |
| Neighbouring suites (`afl-api-ingestion-safety`, `catalogue-lookups`, `auth`, `afl-api-settle-cli-gate`) with `dsn-policy` | 5 files, 435 tests: all passed after one test-only fix in `dsn-policy.test.ts` |
| `next typegen` | exit 0 |
| `tsc --noEmit --incremental false` | exit 0 |
| `eslint --no-cache` on every created/edited file | 0 errors; 3 warnings, all pre-existing in `src/db/client.ts` (1) and `src/db/authClient.ts` (2) at `HEAD` |
| `eslint --no-cache .` (repository-wide) | 253 errors, 132 warnings: unchanged from baseline |
| Full `vitest run --no-cache` | **Test Files 96 failed, 169 passed, 2 skipped (267); Tests 15 failed, 8984 passed, 48 skipped (9047)**, 324 s. Failing set identical to `baseline-failures.txt` (102 lines, no new failure, none missing); load-failure messages unchanged (83 "AFLDB_TEST_DATABASE_URL must be set", 4 "DATABASE_URL is not set"). Delta from baseline: +2 files, +34 passing tests (the two new suites). |
| `next build` | not run: needs a database (V2-GAP-002) |

Open items: V2-GAP-001 (present-DSN branch unverified live), V2-GAP-002 (no build), V2-GAP-003
(environmental), V2-GAP-004 (stray `supplies` file in the source worktree; owner action).

Stage 1 closure (afldb-closure, return `.phaneslight/returns/launchA-20261019/05-closure-stage1.md`):
no CRIT/HIGH/MED; re-ran typegen, tsc, eslint, focused (5 files, 413 tests) and full vitest
(identical to the figures above; failing set equal to the baseline); no undisclosed drift; the
source worktree differs from its snapshot only by `?? supplies`. LOW C-002: with a `_test` DSN
present the libpq `PG*` variables are not stripped (within R-001; covered by V2-GAP-001). INFO
C-001 (stale `tests/dsn-policy.ts` path in a comment and plan R-002) fixed in the Stage 2 commit.
API baseline not re-derived by script (`regen-registry`/`api-diff` not authorised).

## Stage 2 — historical baseline

Delivered:

- `docs/v2/historical-baseline.md` (definition: sealed = every season not in progress in
  `data/reference/seasons.json`, today 1897-2025; the audited correction workflows; verification;
  reconciliation and restoration, documented and not executed), `docs/v2/provenance.md` (cites
  migrations 001-110), `docs/v2/db-ownership-matrix.md` (draft, completed in Stage 4),
  `docs/v2/historical-manifest-spec.md`.
- Manifest code: `packages/domain/src/historical-manifest.ts` (spec of 32 tables, sealed rule,
  validation, comparator; pure), `packages/db/src/historical-manifest-producer.ts` (read-only
  producer and target refusals), `tools/v2/historical-manifest.ts` (CLI: `compare` offline,
  `produce` never run).
- Tests: `tests/v2-historical-manifest.test.ts` (34 tests at `80e110d6`, 37 after the closure fix) with the synthetic fixture
  `tests/fixtures/v2/historical-manifest/before.synthetic.json`. Negative control: corrupting a
  spec table name and a key column made 2 spec tests fail; restored, all pass.
- V2-GAP-005 (AFLW not covered), V2-GAP-006 (seal detected, not enforced), V2-GAP-007 (producer
  never run).

Results read from runs (2026-10-19):

| Check | Result |
|---|---|
| `tests/v2-historical-manifest.test.ts` + `tests/v2-module-boundaries.test.ts` | 2 files, 48 passed |
| `tsc --noEmit --incremental false` | exit 0 |
| `eslint --no-cache` on every created/edited Stage 2 code file | exit 0, no findings |
| `eslint --no-cache .` | 253 errors, 132 warnings: unchanged |
| Full `vitest run --no-cache` | **Test Files 96 failed, 170 passed, 2 skipped (268); Tests 15 failed, 9018 passed, 48 skipped (9081)**, 320 s. Failing set identical to `baseline-failures.txt` (102 lines; none new, none missing); load-failure messages unchanged (83 + 4). Delta from Stage 1: +1 file, +34 passing tests (the new suite). |
| source worktree status vs launch snapshot | differs only by `?? supplies` (V2-GAP-004) |

Stage 2 closure (afldb-closure, return `.phaneslight/returns/launchA-20261019/07-closure-stage2.md`):
no CRIT/HIGH; disclosure exact; tsc, eslint, focused (3 files, 68 tests) and full vitest reproduced
the figures above; two negative controls of its own (read-only check removed: 1 failure;
ROLLBACK removed: 5 failures); 15+ migration citations checked, no false statement.

- **MED C2-001, fixed.** A fact bucket with a NULL season (possible in `award_winners`) was
  treated as open, so its changes were info only. Now `isSealedBucket` makes it sealed in both the
  producer and the comparator; two regression tests, which fail with the old rule (negative
  control: 2 failures) and pass with the fix.
- LOW C2-002 (the `seasons` digest includes measured/status columns, so a re-measurement reports
  `FACTS_CHANGED`): documented in the spec §3. LOW C2-003 (the static column map ignores DROP/RENAME
  COLUMN; no current defect): recorded, no work. INFO C2-006 (a failing ROLLBACK could mask the
  original error): fixed, ROLLBACK attempted exactly once, with a test. INFO C2-007 wording fixed.
  INFO C2-005: the curated `baseline-failures.txt` has 102 ' FAIL ' lines; a raw run also prints one
  stdout line beginning "FAIL  9.6 that run passed every offline guard" from a baseline-failing
  draftguru test, so a raw count can read 103 — compare against the curated list, as here.

After the fix (2026-10-19): `tests/v2-historical-manifest.test.ts` 37 tests; focused 3 files, 71
passed; tsc exit 0; eslint clean on the changed files; full suite: **Test Files 96 failed, 170 passed, 2 skipped (268); Tests 15 failed, 9021 passed, 48 skipped (9084)**, 378 s; failing set identical to `baseline-failures.txt` (102 lines, none new, none missing); load-failure messages unchanged (83 + 4).

## Stage 3 — AFL API pipeline (Launch B)

Sub-agent returns: `.phaneslight/returns/launchB-20261019/` (01-05 mechanic digests, 06-11 worker
returns). Decisions: `docs/v2/plan.md` §7, "Launch B decisions" R-013..R-019. No database, network
or PostgreSQL command was run; every database path below is unexecuted.

Commits (branch `v2/rebuild`):

- `b87a980e` feat(v2-acquisition): evidence-backed coverage registry (D11) and sealed-season
  refusal at the AFL API settle CLIs (V2-GAP-006)
- `fdd08ca3` feat(v2-acquisition): AFL API fixture identity contract and player-resolution
  fail-closed tests
- `7c2db0d5` feat(v2-acquisition): AFL API client resilience, acquisition metadata in snapshot
  manifests, writer-free acquire constants
- `a7738391` feat(v2-acquisition): @afldb/acquisition pipeline contract, generated stage map,
  snapshot replay and machine-readable reconciliation report; Stage 3 docs and gaps

Delivered (what exists):

1. **Boundary.** `packages/acquisition/src/pipeline.ts` (`AFL_API_PIPELINE`, seven stages),
   generated stage map in `docs/v2/architecture.md` §9 (66 rows, `tools/v2/acquisition-stage-map.ts
   --check`). `tests/v2-acquisition-pipeline.test.ts` proves the client, season discovery and
   enumeration and both acquire CLIs reach no writer, no `src/db/**`, no `server-only` and hold no
   SQL mutation (negative controls included).
2. **Coverage registry (D11).** `packages/domain/src/coverage-registry.ts` →
   `docs/v2/coverage-matrix.md` (`tools/v2/coverage-matrix.ts --check`). 650 cells: api_verified 1
   (2026 results), api_partial 4 (2026 fixtures, match_stats, player_stats, brownlow),
   historical_baseline 614, manual_curated 0, unsupported 31 (Brownlow 1897-1923, 1942-1945).
3. **Seal.** `packages/domain/src/season-seal.ts` + `tools/current-season/settle-season-seal.ts`,
   wired into the three AFL API settle CLIs before any client (V2-GAP-006 narrowed). Negative
   control by W2: gate call removed → 2 failed / 52 passed; restored → 54 passed.
4. **Fixture contract.** `packages/acquisition/src/fixture-contract.ts` (13 refusal codes, collision
   refusals); writer not built: **V2-GAP-008, cutover blocker** (AFLDB-ISSUE-229 B2).
5. **Player resolution fail-closed** (tests only): captured resolver SQL, no `INSERT INTO players`
   anywhere in the pipeline, Brownlow whole-set refusal on one unresolved vote.
6. **Snapshot and replay.** Manifest metadata extended; `replayAflApiSnapshot` gives identical plan
   digests; a failing unit is never planned. PostgreSQL transactional proof unexecuted (V2-GAP-009;
   PGlite not installed, R-017).
7. **Client resilience.** No 4xx retry (bar 408/425/429), capped `Retry-After`, option validation,
   250 ms rate limiter, remedies in every message; tested with a fake fetch.
8. **Reconciliation report.** `packages/acquisition/src/reconciliation-report.ts`
   (`afldb.v2.afl-api-reconciliation-report` v1, builder, serialiser, validator, JSON Schema).

Verification (executed 2026-10-19, Windows, DSN variables unset):

- Focused: 18 suites, **1299 passed, 2 skipped (1301)** (v2-coverage-registry, v2-season-seal,
  v2-fixture-contract, v2-acquisition-pipeline, v2-acquisition-replay, v2-reconciliation-report,
  v2-module-boundaries, v2-historical-manifest, dsn-policy, afl-api-settle-cli-gate,
  afl-api-settle-plan, afl-api-ingestion-safety, afl-api-brownlow, afl-api-brownlow-acquire,
  afl-api-match, afl-api-rounds, afl-api-cutover, afl-api-player-evidence).
- Full suite once: Test Files 96 failed | 176 passed | 2 skipped (274); Tests **15 failed | 9234
  passed | 48 skipped (9297)**. The 102 `FAIL` lines are identical to
  `docs/v2/evidence/baseline-failures.txt` (no new failure; all need a database DSN).
- `npx tsc --noEmit --incremental false`: exit 0. ESLint on the files Stage 3 changed: 7 problems (6
  errors, 1 warning), all on lines that predate Stage 3 (`tests/afl-api-match.test.ts`,
  `tests/afl-api-settle-plan.test.ts`, `tests/afl-api-brownlow-acquire.test.ts`; blame bbf87566),
  none introduced; repository wide: 253 errors / 132 warnings (exactly at the ceiling, unchanged).
- ISSUE-316 cutover files: sha256 unchanged (nine files). Source worktree status differs from the
  snapshot only by `?? supplies`.

Gaps created or changed: V2-GAP-006 (narrowed), V2-GAP-008 (High, **cutover blocker**), V2-GAP-009
(Medium), V2-GAP-010 (Medium).

## Stage 4 — derived and curated data (Launch C)

Sub-agent returns: `.phaneslight/returns/launchC-20261019/` (git-ignored working memory). Commits:
`fad164cd` (Coleman derivation + comparison report, Brownlow reconciliation + report),
`4c34be93` (progress), `ddb42525` (curated awards, migration 111, PGlite), `498fd46d` (legacy
disposition), `034f6947` (Coleman publisher, migration 112), `4c54e0d9` (curated approval through
the season seal), then the Stage 4 documents commit.

Delivered:
- **Coleman (D6, ADR 0006).** `deriveColeman` (pure, versioned `v2.coleman.1`, home-and-away only,
  complete = sealed plus a settled attestation, joint winners on ties) and the comparison report
  (agree / disagree / not derivable; never an overwrite). `publishColemanResult` writes the
  append-only `derived_award_results` ledger (migration 112) in one transaction, only as an
  audited correction through the season seal (`derived_award_publication`); identical recompute
  is `unchanged`, a corrected one `superseded`. Status: **synthetic fixtures only**; no real
  season derived or compared (V2-GAP-015); no projection into `award_winners` and no caller yet
  (V2-GAP-021).
- **Brownlow (D7, ADR 0007).** `reconcileBrownlowSeason` and a versioned, schema-validated JSON
  report; joint leaders on ties; an unresolved identity refuses the whole set; an ineligible
  vote-getter refuses the leader determination unless `stored_eligible_rank_one` is selected.
  Status: **committed synthetic fixtures only**; the API-era eligibility rule is an owner
  decision (V2-GAP-016).
- **Curated awards (D8, ADR 0008).** Migration 111 (`award_proposals`, append-only
  `award_proposal_decisions`), `@afldb/admin` services (create, validate, approve, reject,
  revise, list, history, offline file parser), the server-only promotion port, approval through
  the season seal (`curated_award_approval`). Services only; Stage 5 owns the UI.
- **PGlite.** `@electric-sql/pglite` 0.2.17, exact-pinned devDependency, in memory only
  (ADR 0012). Migrations 111 and 112 ran only on PGlite over stub prerequisites; **unexecuted on
  PostgreSQL** (V2-GAP-017).
- **Legacy (D10, ADR 0010).** `docs/v2/legacy-disposition.md`. Quarantined: 1 file
  (`update-current-season.ts` to `legacy/offline/`, F-001 fixed). Retired with a refusal: 1
  package script (`current-season:update`). Retained with a recorded disposition: everything
  else (rows L1-L13), including the AFL Tables runtime behind ISSUE-316 (V2-GAP-011) and the CSV,
  email and Squiggle/Kali admin paths until Stage 5 (V2-GAP-013). Guards and a legacy-edge
  ratchet in `tests/v2-module-boundaries.test.ts`.
- **Ownership matrix** completed (`docs/v2/db-ownership-matrix.md`): writer census,
  `external_identities` owner per source partition, legacy runtime writers ("not yet" removed).
- Decisions R-020 to R-029 in `plan.md` §7. Gaps: V2-GAP-011 (High, **cutover blocker**), 012
  (Medium), 013 (High, **cutover blocker**), 014 (Low), 015 (Medium), 016 (Medium, owner
  decision), 017 (Medium), 018 (Low), 019 (Medium), 020 (Low), 021 (Medium); V2-GAP-006 narrowed
  again.

Stage-close results (orchestrator runs on the committed tree plus these documents):

| Check | Result |
|---|---|
| full `npx vitest run --no-cache` | Test Files 96 failed / 182 passed / 2 skipped (280); Tests 15 failed / 9532 passed / 48 skipped (9595); the 102 ` FAIL ` lines are identical to `docs/v2/evidence/baseline-failures.txt` (no new failure, none weakened) |
| `npx tsc --noEmit --incremental false` | exit 0 |
| `npx eslint --no-cache .` | 253 errors, 132 warnings: unchanged, exactly at the ceiling |
| ESLint on every created/edited file | 0 errors on every created file; edited files equal to `HEAD` (`tests/reference-data.test.ts` 29 errors, `tests/db-promotion-check.test.ts` 2 warnings, pre-existing, R-011) |
| `tools/v2/coverage-matrix.ts --check`, `tools/v2/acquisition-stage-map.ts --check` | both exit 0 |
| frozen ISSUE-316 files | source: 19 of 19 sha256 match the snapshot; V2: 18 of 19 match, `CHANGELOG.md` differs by design (the V2 section) |
| source worktree status | differs from the snapshot only by `?? supplies` |

`afldb-closure` (`.phaneslight/returns/launchC-20261019/09-closure-stage4.md`) re-derived every
check independently and returned **PASS_WITH_FINDINGS**: tsc 0; focused 12 files 1227 passed, 5
failed (all baseline lines); full suite identical to the above (102 `FAIL` lines byte-identical
to the baseline); ESLint 253/132; both generators 0; frozen hashes as above; 57 changed paths, no
drift; migrations 111/112 additive with comment-only rollback, no `afldb_app` grant, no UPDATE or
DELETE on the ledgers. Findings: C8-001 (LOW, V2-GAP-014 said two frozen rebuild files; there are
three) and C8-002 (LOW, `.env.example` and `docs/acquisition/AFLDB-2026-API-ACQUISITION.md` still
named the retired CLI as live), both corrected in the closure commit; C2-001 (INFO: the curated and
legacy commits' focused runs reported 6 failures because they also ran
`tests/awards-admin.test.ts`, whose one failure is a baseline line); C0-001 (LOW, procedural:
closure itself ran `npm view @electric-sql/pglite@0.2.17 time`, a network command its brief did
not authorise; output discarded, no repository change; reported to the owner).

## Stage 5 — admin operations centre (Launch D, in progress)

Sub-agent returns: `.phaneslight/returns/launchD-20261019/` (git-ignored). No database, network,
deploy or PostgreSQL command was run.

Visual Evidence Mandate declaration (made by the orchestrator before any UI change was applied):
target viewports 1280x800 and 390x844; affected screens `/admin` (dashboard), `/admin/current-season`,
`/admin/upload`, `/admin/submissions/[id]`, the admin sidebar, and the new `/admin/operations`,
`/admin/operations/awards`, `/admin/operations/awards/[id]`, `/admin/operations/coleman`,
`/admin/operations/brownlow`; reference design: the existing admin pages and `src/styles/globals.css`
(no separate design document). Rendering a real admin page needs a database and a session, which
this workstation does not have.

Milestone 1 (legacy retirement, worker W-A): the CSV upload route, the submission review actions,
the email-intake route, the Squiggle/Kali refresh action and the AFL Tables settle trigger keep
their existing guards and then refuse (`legacy_retired`; routes HTTP 410; one
`admin.legacy_retired_refused` audit row per attributed refusal; the email-intake route answers 410
with no body read, no secret, no database and no audit). Four UI components deleted
(`SettleRunPanel`, `CurrentSeasonControls`, `UploadForm`, `ReviewControls`); the legacy-edge ratchet
shrinks from 18 pairs to 11. Focused run (orchestrator, 7 files): 5 failed / 988 passed / 1 skipped;
the 5 failures are the 5 baseline lines of `tests/current-season-import.test.ts`.

## Resumption point

Stage 4 is done. **Launch D starts Stage 5** (admin operations centre and
UI, ADR 0009): read `docs/v2/plan.md` (stage 5 row, D9, §7 R-020 to R-029), this file,
`docs/v2/known-gaps.md` (V2-GAP-011, 013, 016, 018, 019 and 021 are the Stage 5
inputs), `docs/v2/legacy-disposition.md` (L1-L3, L5, L6 are Stage 5's) and ADR 0008's "What Stage
5 must wire". Stage 5 must: wire a server-only caller for the curated services and the Coleman
publisher; supply a `src/` sealed-set loader for `ApproveDependencies.sealed` (today the only
loader is `tools/current-season/settle-season-seal.ts:22`); make the CSV upload, submission
promotion, email-intake route and Squiggle/Kali admin actions refuse; and remove the AFL Tables
admin trigger. Stages 5 and 6 have not been started.
