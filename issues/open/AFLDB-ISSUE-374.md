# AFLDB-ISSUE-374 · Direct test-target maintenance can operate on a misconfigured database

**Open · High · 22 November 2026.** Recorded production revision and candidate, operator tools at review target `b445ba7f`.

The direct db:migrate:test and db:privileges:test scripts select an environment variable by target name. A nonempty DSN for another writable database passes that selection. Test migration mode skips the shared-target branch guard and bootstraps/applies DDL. The privilege launcher hands the same destination to the grant script. The rebuild orchestrator’s separate checks do not protect direct npm calls. Actual consequences depend on the connecting role’s rights. Confirmed by source, no non-test database contacted.

Source anchors — `tools/db/migrate.ts:141,199,276,322; tools/db/privileges.ts:95,116`.

## Correction and acceptance

Validate the target-specific database identity before the first write, including current_database() on the connection used for the operation. Keep the explicit code_test_db contract. Test a mismatched synthetic DSN and assert zero DDL/grant calls, then a permitted isolated target.

[Independent review](../reviews/AFLDB-FULL-REVIEW-2026-11-22.md)

## Local fix status

**Local fix, 23 November 2026 (`51040bbe`; local, not deployed; this entry stays open pending Astra's re-review).** `tools/db/target-identity.ts`: the test target must name a plain `*_test` database and code-test exactly `code_test_db`, refused before any connection; `migrate.ts` checks `current_database()` on its single connection and inside the ledger bootstrap and every migration transaction; `privileges.ts` runs an identity assertion first in the same psql session so `ON_ERROR_STOP` ends the run before `privileges.sql`. Harness with a real second database: the unfixed commands took a writable non-test database from 1 relation to 185 and granted on it (including via a libpq `dbname=` redirect); on the fix both exit 1 and the database fingerprint and sentinel row are unchanged; a permitted `_test` target still migrates (118, then up to date) and grants. Record: ../reviews/AFLDB-FULL-REVIEW-2026-11-22-FIXES.md
