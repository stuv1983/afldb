# ADR 0005 — Test-process connection safety (fail closed by stripping)

- Status: Accepted, implemented in Stage 1 (2026-10-19)
- Plan decision: `docs/v2/plan.md` §3 D5; review resolutions R-001..R-005 (§7)

## Context

`tests/setup.ts` is the vitest setup file for every test file. Before V2 it loaded `<repo>/.env`
and, only when `AFLDB_TEST_DATABASE_URL` named a `_test` database, redirected `DATABASE_URL` to
it. With no test DSN, any `DATABASE_URL`, `AFLDB_IMPORT_DATABASE_URL` or `AFLDB_AUTH_DATABASE_URL`
from the environment or `.env` stayed visible to unit tests, to the modules they import and to the
child processes they spawn. Separately, a CLI imported by a test could call `loadEnv()` in
`tools/current-season/load-env.ts` and rehydrate a stripped DSN from `.env`.

## Decision

1. `applyTestDsnPolicy(env)` in `@afldb/testing` (`packages/testing/src/dsn-policy.ts`), called by
   `tests/setup.ts` after its `.env` load:
   - no test DSN: remove every `*DATABASE_URL*` variable and the libpq connection variables
     (`PGHOST`, `PGPASSWORD`, ...); never throw. The pre-existing refusal of
     `AFLDB_TEST_IMPORT_DATABASE_URL` without a test DSN is evaluated first, so it still fires.
   - a test DSN naming a `_test` database: redirect `DATABASE_URL` to it (as before) and remove
     any other set `*DATABASE_URL*` variable that does not name a `_test` database.
   - a test DSN naming anything else, or not a URL: throw the pre-V2 messages.
2. `src/db/client.ts` and `src/db/authClient.ts` call `assertTestProcessDsn()`
   (`src/db/test-process-guard.ts`, re-exported by `@afldb/db`) before building a pool. Outside a
   test process (`VITEST` unset) it is a no-op, so production and DEV keep their own DSNs. Inside
   one it refuses any database whose name does not end in `_test`, except never-connectable unit
   placeholders (an RFC 6761 `.invalid` host, or a loopback host on port 1).
3. `loadEnv()` skips `*DATABASE_URL*` and libpq names from `.env` only inside a test process; its
   behaviour outside one is unchanged and still covered by the ISSUE-244 F029 tests.

## Consequences

- `tests/dsn-policy.test.ts` proves every branch on env objects, the live post-setup state, the
  client refusals and the `loadEnv()` filter. A negative control with the three guards disabled
  failed 3 of its cases; with them restored all pass.
- The present-DSN branch is unverified on a live database (V2-GAP-001).
- The rule is the `_test` suffix allowlist, not a host heuristic: a tunnelled `afldb_prod` on
  `localhost:5432` is refused.
