# AFLDB-ISSUE-341 — Restore target validation can accept a DSN that connects to the source database

**Status: RESOLVED 2026-11-08; fix published 2026-11-09 in `532dcd77` (`origin/main` `c5959bbf..ae28bd70`; not deployed; evidence carried forward, `docs/v2/evidence/open-issues-closure-20261108/b2b5-publish/`).** Real two-database restore qualification on an isolated loopback cluster on streamanator: **37 passed, 0 failed**. Distinct source, target and bystander sentinels. The cases:
- H0 reproduced the `?dbname=` hazard read-only;
- nine contract refusals;
- the in-session identity guard;
- a positive restore under hostile inherited libpq routing.

Evidence: `docs/v2/evidence/open-issues-closure-20261108/ev341/`; record: the ISSUE-341 entry in `issues.md`. Non-blocking owner follow-up: ratify or widen the DSN contract. Historical status follows.

**Earlier status: implemented locally 2026-11-08 (uncommitted), awaiting user-executed verification.** Accepted connection contract (owner may widen): `postgres[ql]://USER[:PASSWORD]@HOST[:PORT]/DBNAME[?sslmode|sslrootcert|sslcert|sslkey|sslcrl|connect_timeout|application_name=…]`, identifier USER/DBNAME, single host; all else refused before any child. libpq routing variables unset after `.env`. Every destructive or marker stream starts with an in-session `current_database()`/`current_user` assertion. Stub harness: `bash tests/restore-test.test.sh`. Still to do: the authorised two-disposable-database sentinel qualification. Opened 2026-11-08. **Severity: Medium.** Area: Database restore and wrong-target safety.

This review authorizes documentation only. The sequence below is a proposal, not authorization to implement or operate any environment. [Detailed ledger](../../issues.md#afldb-issue-341).

Review baseline: branch claude/issue-339-deploy-preflight, HEAD 5cba6846ddfcfd5d7a3fd29e14bc8877099d9656, 2026-11-08. These source paths are unchanged from the locally recorded published origin/main 7fabc6e51c5c53c4b6f6fe345f21191d9184660b; this is not a fresh remote or production verification. Evidence is source-established, with no new executable reproduction. Graph tools were unavailable; exact source and caller searches were used. See [review handoff](AFLDB-ISSUE-339.md#repository-review-handoff-2026-11-08) for coverage and limits.

## Affected behavior and exact evidence

- tools/maintenance/restore-test.sh:45-56 replaces the URL path with afldb_restore_test but preserves the query; :65 checks only the path.
- :83-87 removes a userinfo password, not target-changing query options; :91 tests SELECT 1 without current_database/current_user.
- :106 clears the named restore database comment; :119-129 drops every non-system table in the actual connected database with CASCADE.
- :145-152 also passes the same DSN to pg_restore --clean.
- Closed ISSUE-278 records PostgreSQL 16 fe-connect.c evidence that a URI query dbname overrides its path (issues.md, H-278-1); its fix covers rebuild-test/prove-reset, not this shell entry point.

## Trigger, prerequisites and impact

A configured source URL has a query such as ?dbname=afldb_dev. Rewriting its path produces /afldb_restore_test?dbname=afldb_dev, which passes the textual guard but libpq connects to afldb_dev. The restore database must also exist and the owner must be able to comment on it, allowing line 106 to pass before the destructive loop. A valid input dump and table ownership are also prerequisites. No real DSN or backup was inspected or executed.

The restore verifier can drop source tables before restoring, despite announcing a disposable target. Severity follows the accepted ISSUE-278 Medium classification: nonstandard configuration prerequisite, potentially catastrophic consequence.

## Root cause, callers and smallest viable fix

The guard validates a representation of the destination rather than the destination selected by libpq. Separate SELECT 1 and COMMENT statements do not prove the identity of the connection that executes DROP.

Reject ambiguous/target-changing connection options, pin the child connection and environment, and assert current_database/current_user in the same SQL stream immediately before any destructive statement. Apply the same pinned identity to pg_restore and parity/comment operations. Use -X for psql and preserve secret-free invocation. Reuse ISSUE-278's target-pinning rules where appropriate, without copying a URL-path-only guard.

## Implementation sequence and dependencies

1. Extend the existing connection-target tests with query dbname, encoded query names, service/environment overrides and standard URLs. Define the accepted connection contract before constructing child commands.
2. Add same-session identity refusal ahead of clearing the marker and DROP; bind pg_restore to the verified destination and remove conflicting inherited libpq target options.
3. Add a shell-entry harness that observes the real restore command sequence with stub children; then qualify on two disposable databases with distinct sentinels.

Implement before any live reproduction or ISSUE-342 integration exercise. Owner must confirm supported DSN forms and test environment.

## Focused reproduction and regression checks

Use tests/db-test-rebuild.test.ts for shared target semantics if the helper is reused. No existing restore-test shell suite was identified; add a focused maintenance harness only where an existing suite cannot host the entry-point checks. Prove a path/query mismatch refuses before COMMENT, DROP or pg_restore, source sentinel survives, expected disposable target works, and inherited target overrides are refused or neutralized. No private backup is needed: generate a small disposable fixture in the later implementation phase.

These checks are proposed for a later authorized implementation phase; none was executed during this review. Existing evidence does not establish an incident on DEV or production.

## Measurable acceptance criteria

Every destructive child is bound to the intended disposable database and expected role. Wrong identity refuses before any marker/table change. Both source and unrelated disposable database sentinels remain unchanged in all refusal cases.

## Failure handling and recovery

Stop on any identity disagreement. Never retry a suspected misdirected run automatically. If this entry point has already damaged another database, preserve incident evidence and let the owner choose recovery from independently verified backups; no backup restoration, deletion or live assessment is authorized by this playbook.

## Duplicate and decision review

Distinct remaining entry point from closed ISSUE-278; ISSUE-250's dump-binding marker does not establish destination identity. Neither issue is reopened.
