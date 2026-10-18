# ADR 0002 — No new runtime dependency; one optional exact-pinned devDependency

- Status: Accepted (2026-10-19). The optional devDependency is not installed as of Stage 2.
- Plan decision: `docs/v2/plan.md` §3 D2; review resolution R-008 (§7)

## Context

V2 must not introduce a new platform for neatness. Some Stage 4 work (new additive migrations,
transactional contract tests) would benefit from executing SQL in-process, and no PostgreSQL
exists on the V2 workstation.

## Decision

No new runtime dependency. One devDependency may be added, exact-pinned and at least two weeks
old: `@electric-sql/pglite`, solely to execute new V2 migration SQL and transactional contract
tests in-process. It is never used to replay the 110 existing migrations' roles and grants. Where
pglite cannot run a statement (for example grants through `afldb_meta` functions), that SQL is run
against labelled stubs or marked "statically reviewed, unexecuted".

## Consequences

The only permitted network contact during the rebuild is the npm registry for that one install.
