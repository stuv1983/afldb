# AFLDB-ISSUE-278 — The destructive `db:test:rebuild` reset never asserts which database it is connected to

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
- **Severity:** Medium. The reviewer graded it High; the main session regraded it Medium because the trigger needs a non-standard DSN form, although the consequence would be catastrophic.
- **Area:** database tooling / wrong-target safety.
- **Key files:** `tools/db/rebuild-test.ts` (`databaseOf`, `resolveTarget`, `RESET_SQL`, `runSql`), `tools/db/prove-reset.ts`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-013; partition note R6b-F01). The main session re-read `rebuild-test.ts:455-490`.
- **Classification:** the missing assertion is code-proven. The concrete trigger depends on libpq and was not executed.

## 1. Summary

The rebuild derives its target name from the DSN's URL path (`databaseOf`) and checks that name against an allowlist and the `--acknowledge-destroy` string. It then sends `RESET_SQL` through psql (libpq), and that SQL drops every schema object. Nowhere does it assert `current_database()` / `current_user` on the connection that destroys. The rollback-only proof stream does assert it (`prove-reset.ts:246-268`), yet the two are documented as sharing one execution path.

## 2. Evidence

- `tools/db/rebuild-test.ts`:
  - `:459-461`: `databaseOf` = `new URL(dsn).pathname`.
  - `:470-490`: the name allowlist ("A target is never inferred from a DSN").
  - `:522-533`, `:605-614`: name and acknowledgement equality.
  - `:2058-2120`: `RESET_SQL`. `:3305-3312`: `runSql`.
  - A whole-file grep for `current_database|session_user|current_user` finds nothing.
- `tools/db/prove-reset.ts:246-268` (in-stream assertion) and `:469-505`.
- `tools/db/psql.ts:43-45`: `-d <dsn>`, which libpq parses.
- The pre-reset capture child asserts identity only over postgres.js (`tools/migration/rebuild_afl_api_adjudications.ts:1144`).

## 3. Trigger (libpq-dependent)

`AFLDB_TEST_DATABASE_URL` whose URL path names the allowlisted target while libpq resolves a different database or server. Examples:

- `…/afldb_test?dbname=afldb_dev`: libpq lets a query-part keyword override the path. This is documented libpq behaviour, not executed here.
- `?host=` / `?hostaddr=`: no precedence question; the same name on another server.

## 4. Expected invariant

The destroying stream refuses unless `current_database()` equals the acknowledged target and `current_user` is `afldb_owner`, as the proof stream already checks.

## 5. Actual behaviour

The census and capture pass against the path-named database, then the reset destroys the libpq-resolved database. On the DEV host that could be `afldb_dev`, where `afldb_test` and `afldb_dev` coexist. The `/prod/i` name guard sees only the path.

## 6. First wrong layer

`tools/db/rebuild-test.ts:2058-2120` (no identity assertion in the reset stream), fed by `:459-461`.

## 7. Impact

A latent wrong-target hazard on the repository's most destructive tool. No incident is known.

## 8. Reproduction / witness

- Not executed. No DB-free libpq parser is available on this workstation (psycopg is not installed), and running psql is outside this task's command grant.
- DB-free witness W1 (proposed in the R6b notes): `databaseOf('postgresql://afldb_owner@localhost:5432/afldb_test?dbname=afldb_dev')` returns `afldb_test`, and `assertRebuildTargetName` accepts it.

## 9. Disproof attempts

- PRECHECK opens no connection.
- `runValidation` for the census inspects only the exit status, not the `database=` marker.
- The capture child asserts over postgres.js, which reads the path, not libpq.
- No test pins `databaseOf` with a query string.

## 10. Existing-issue search

- `issues.md` was searched for `dbname=`, `query param`, ISSUE-243/139/143 and ISSUE-093 §20.
- Classification: **new**.

## 11. Scope

Identity assertion in the reset and census streams, and DSN query-parameter refusal.

## 12. Out of scope

The `promotion-check` path, which is read-only and identity-gated.

## 13. Proposed fix boundary

- (1) Prepend an identity DO block to `RESET_SQL` (and to the census's enforce stream) asserting `current_database() = '<target>'` and `current_user = 'afldb_owner'`, modelled on `prove-reset.ts:246-268`.
- (2) In `resolveTarget`, refuse a DSN that carries `dbname`, `host`, `hostaddr`, `service` or `options` query parameters.
- Option (1) is the robust fix; option (2) is a cheap belt.

## 14. Proposed validation

1. DB-free: W1 (with fix (2), expect a refusal), and a string test that the stream `runSql` sends contains the assertion naming the target.
2. Then `npm run db:test:prove-reset` (operator-run).

## 15. Decisions / unresolved questions

- H-278-1: confirm libpq's query-part precedence, for example with `psycopg.conninfo.conninfo_to_dict` on a host with psycopg (DB-free). Fix (1) stands regardless.

## 16. Next action

Implement fix (1), plus (2) optionally, then the tests.
