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
| 3 AFL API pipeline | implemented; closure verification pending (Launch B) | b87a980e, fdd08ca3, 7c2db0d5, a7738391 + this progress commit |
| 4-6 | not started (Launches C-E) | — |

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
- `npx tsc --noEmit --incremental false`: exit 0. ESLint on Stage 3 files: 0 problems; repository
  wide: 253 errors / 132 warnings (at the ceiling, unchanged).
- ISSUE-316 cutover files: sha256 unchanged (nine files). Source worktree status differs from the
  snapshot only by `?? supplies`.

Gaps created or changed: V2-GAP-006 (narrowed), V2-GAP-008 (High, **cutover blocker**), V2-GAP-009
(Medium), V2-GAP-010 (Medium).

## Resumption point

Stage 3 is implemented and committed; `afldb-closure` verification of Stage 3 is the last Launch B
step (its result is recorded below this line when it returns). **Launch C starts Stage 4** (legacy
quarantine, plan D10): read `docs/v2/plan.md` (stage 4 row, D10, §7), this file,
`docs/v2/known-gaps.md` (V2-GAP-006 remainder and V2-GAP-008 stay open),
`docs/v2/db-ownership-matrix.md` ("Open for Stage 4") and `docs/v2/architecture.md` §9. Stages 4-6
have not been started.
