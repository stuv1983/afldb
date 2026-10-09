# AFLDB-ISSUE-313 — Database tooling passes the owner DSN, password included, on the `psql` command line

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
- **Severity:** Low. **Area:** database tooling / credential handling.
- **Key files:** `tools/db/psql.ts` (`psqlArgv`, `runPsql`), `tools/db/privileges.ts`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-048; partition note R6a-F02).
- **Classification:** code-proven. The practical exposure depends on the host.

## 1. Summary

The full connection string is an argv element of the `psql` child for its whole run: `-d <dsn>` in `psqlArgv`, and `-d dsn` in `privileges.ts`. On Linux, argv is readable by every local user through `/proc/<pid>/cmdline` / `ps`, unless `/proc` is mounted with `hidepid`. The privileges run holds the owner DSN. The module promises "Nothing here ever prints a DSN or a password", but `redact()` is applied only to psql's output.

## 2. Evidence

- `tools/db/psql.ts:16-17` (the promise), `:43-45` (`psqlArgv`) and `:78-81` (spawn).
- `tools/db/privileges.ts:92-98`.
- The project rule: no inline secret on a command line (agent operating protocol; `issues.md:40952`, "A DSN is never accepted on argv").

## 3. Trigger

`npm run db:privileges*` or `npm run db:test:rebuild` on any host where another local user can list processes.

## 4. Expected invariant

The secret reaches `psql` through the child environment (`PGPASSWORD`, or a password-stripped DSN), a service file or `.pgpass`, never through argv.

## 5. Actual behaviour

The credential is visible for the duration of each psql run.

## 6. First wrong layer

`tools/db/psql.ts:44`; `tools/db/privileges.ts:92`.

## 7. Impact

Credential exposure to co-tenant local users. Low on a single-operator droplet; real on a shared host or CI runner.

## 8. Reproduction / witness

Not executed (no credentials were used in this review).

## 9. Disproof attempts

psql does not rewrite its argv, and `.pgpass` is not referenced in `tools/db`. `privileges.sql:7` documents the same exposure for a hand-run psql, so the pattern is operationally accepted, which is why this is graded Low.

## 10. Existing-issue search

ISSUE-107/220 (web service `/proc/<pid>/environ`, resolved) and ISSUE-251 (its own CLI). Classification: **new**.

## 11. Scope

The two argv builders.

## 12. Out of scope

Hand-run psql commands documented in runbooks.

## 13. Proposed fix boundary

Pass a password-stripped DSN with `-d` and set `PGPASSWORD` in the child environment (never logged). Keep the ISSUE-093 §20 flag order.

## 14. Proposed validation

Extend the `psqlArgv` / `runPsql` DB-free tests:
- no argv element carries a password or `user:pass@` authority;
- `env.PGPASSWORD` is set;
- the flag order is unchanged.

## 15. Decisions / unresolved questions

None.

## 16. Next action

Implementation.
