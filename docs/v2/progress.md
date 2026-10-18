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
| 2 Historical baseline | done, pending closure verification | the Stage 2 commit (`feat(v2-baseline): …`) |
| 3-6 | not started (Launches B-E) | — |

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
- Tests: `tests/v2-historical-manifest.test.ts` (34 tests) with the synthetic fixture
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

## Resumption point

Launch A ends after `afldb-closure` verifies Stage 2. **Launch B starts Stage 3 (AFL API
pipeline)**: read `docs/v2/plan.md` (stage 3 row, D2-D4, §7), this file, `docs/v2/known-gaps.md`,
`docs/v2/inventory.md` (Part B, AFL API pipeline) and `docs/v2/historical-baseline.md` §2 (the
promotion must refuse sealed seasons, V2-GAP-006). Stages 3-6 have not been started.
