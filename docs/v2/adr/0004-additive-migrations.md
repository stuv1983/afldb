# ADR 0004 — Additive, reversible migrations from `111_`

- Status: Accepted (2026-10-19). No V2 migration exists yet; the first is expected in Stage 4.
- Plan decision: `docs/v2/plan.md` §3 D4; review resolution R-008 (§7)

## Context

The existing PostgreSQL data is the project's main asset. Migrations 001-110 define it, and the
runner (`tools/db/migrate.ts`, `tools/db/migration-safety.ts`) hashes and executes each file whole.

## Decision

- New migrations are numbered from `111_` and are additive only: no rewrite of existing rows, no
  change to stable IDs or foreign keys, no destructive reset.
- Each carries a documented reversal: a `-- ROLLBACK:` block made of comment lines only (the
  runner executes the whole file) or a script under `docs/v2/rollback/`.
- New public tables follow the fail-closed app-read pattern (`afldb_meta.grant_app_read()`,
  migration 039) and, where the importer writes, the fail-closed import-write pattern (migration
  045). Any such migration names the matching `tools/db/privileges.ts` change and carries a
  097-style deploy-order comment (migration, then privileges, then code; AFLDB-ISSUE-027).
- No migration is applied to any real database from V2.

## Consequences

Every V2 migration stays "unexecuted on PostgreSQL" until an operator applies it to an isolated
database outside V2's authority.
