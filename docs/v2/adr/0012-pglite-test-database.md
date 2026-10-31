# ADR 0012 — PGlite 0.2.17 as the in-process, test-only PostgreSQL for new V2 SQL

- Status: Accepted (2026-10-19, Launch C / Stage 4); installed
- Plan decision: `docs/v2/plan.md` §3 D2 (ADR 0002), review resolutions R-008 and R-017 (§7)

## Context

Stage 4 adds additive migrations (from `111_`) and transactional services (curated award
approval, Coleman publication). No PostgreSQL, Docker or psql exists on the V2 workstation and V2
may not contact any database (plan §1). Without an in-process engine the new SQL and the
all-or-nothing transaction claims could only be "statically reviewed". Plan D2 allows exactly one
exact-pinned devDependency, `@electric-sql/pglite`, solely for that purpose.

## Decision

- Installed once, on 2026-10-19, by the orchestrator in `D:\dev\afldbV2` only:
  `npm install --save-dev --save-exact @electric-sql/pglite@0.2.17 --no-audit --no-fund --ignore-scripts`
  (npm 10.9.4, Node 22.21.0). `--no-audit`/`--no-fund` avoid extra registry calls and
  `--ignore-scripts` runs no install script; the package has none that the tests need.
- Version choice: 0.2.17 is a 2025 release of the 0.2 line, far more than two weeks before
  2026-10-19. The exact publication date was not looked up (no registry query other than the
  install was made), so this ADR states the bound, not the date.
- Change: `package.json` gains `"@electric-sql/pglite": "0.2.17"` under `devDependencies`;
  `package-lock.json` gains that entry plus one `node_modules/@electric-sql/pglite` record
  (version 0.2.17, `resolved` from registry.npmjs.org, `integrity` sha512, `dev: true`,
  Apache-2.0). The package has no dependencies; nothing else in the lockfile changed (diff: +8
  lines, 0 removed). V2's `node_modules` is a real directory, not a junction, so the install
  touched no other checkout.
- Smoke check (scratch script outside the repository, in-memory instance): it reported
  `PostgreSQL 16.4 ... compiled by emcc`, and a transaction that hit a CHECK violation rolled back
  to zero rows.
- Use is **test-only and in-memory**: helpers never pass a `dataDir` (so no files are written),
  never open a socket and never read a DSN. It is not a runtime dependency and no `src/**`,
  `tools/**` or `packages/*` runtime module imports it (only `packages/testing` and `tests/**`).
- Scope stays as ADR 0002 says: PGlite executes the NEW V2 migration SQL and the new services'
  SQL against labelled stub prerequisites. It never replays the 110 existing migrations, their
  roles or their grants; any statement it cannot run is recorded as "statically reviewed,
  unexecuted" in the step's evidence and in `docs/v2/known-gaps.md`.
- The test-DSN policy is unchanged: `packages/testing/src/dsn-policy.ts` and
  `src/db/test-process-guard.ts` are not modified, and PGlite needs no DSN.

## Consequences

New V2 migrations and transactional services get executed proofs on PostgreSQL 16.4 semantics
(constraints, foreign keys, rollback). Those proofs do not cover the production roles, grants,
`afldb_meta` registry functions, extensions (`pg_trgm`, `unaccent`) or the interaction with the
existing 110-migration schema; V2-GAP-009 (transactional preservation of the AFL API settle on
PostgreSQL) stayed open at the time because PGlite is deliberately not extended to that schema (R-017). It was
closed on 2026-10-31 by running the settle suites on guarded isolated PostgreSQL instead (`known-gaps.md`), not by
extending PGlite; this ADR's decision is unchanged.
