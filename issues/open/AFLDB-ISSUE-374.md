# AFLDB-ISSUE-374 · Direct test-target maintenance can operate on a misconfigured database

**Open · High · 22 November 2026.** Recorded production revision and candidate, operator tools at review target `b445ba7f`.

The direct db:migrate:test and db:privileges:test scripts select an environment variable by target name. A nonempty DSN for another writable database passes that selection. Test migration mode skips the shared-target branch guard and bootstraps/applies DDL. The privilege launcher hands the same destination to the grant script. The rebuild orchestrator’s separate checks do not protect direct npm calls. Actual consequences depend on the connecting role’s rights. Confirmed by source, no non-test database contacted.

Source anchors — `tools/db/migrate.ts:141,199,276,322; tools/db/privileges.ts:95,116`.

## Correction and acceptance

Validate the target-specific database identity before the first write, including current_database() on the connection used for the operation. Keep the explicit code_test_db contract. Test a mismatched synthetic DSN and assert zero DDL/grant calls, then a permitted isolated target.

[Independent review](../reviews/AFLDB-FULL-REVIEW-2026-11-22.md)
