# ADR 0004 — Additive, reversible migrations from `111_`

- Status: Accepted (2026-10-19). V2 migrations: `111_curated_award_proposals.sql` (ADR 0008) and
  `112_derived_award_results.sql` (ADR 0006), both Stage 4, executed on in-memory PGlite over stub
  prerequisites only; unexecuted on PostgreSQL (V2-GAP-017).
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
- Qualification (Stage 4): a table that must never be public, or whose writer must be narrower
  than the registry grants (for example an append-only ledger, or UPDATE on workflow columns
  only), registers with neither `grant_app_read` nor `grant_import_write`. It carries explicit
  column-scoped grants in the migration and the matching re-grant block in
  `tools/maintenance/privileges.sql`, following migrations 074 and 104. Migration 111 is the first
  V2 instance (ADR 0008).
- No migration is applied to any real database from V2.

## Consequences

Every V2 migration stays "unexecuted on PostgreSQL" until an operator applies it to an isolated
database outside V2's authority.
