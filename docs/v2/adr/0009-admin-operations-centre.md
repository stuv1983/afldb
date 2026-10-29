# ADR 0009 — A small, audited operations-focused admin centre

- Status: Accepted (2026-10-19); implemented in Stage 5 (Launch D, 2026-10-19); unexecuted on
  PostgreSQL and never rendered against a database (V2-GAP-017, V2-GAP-022)
- Plan decision: `docs/v2/plan.md` §3 D9

## Context

The admin centre has 56 pages and 25 admin server-action files (`docs/v2/inventory.md`),
including legacy runtime controls: CSV upload to final tables (`src/app/admin/upload`), the
AFL Tables settle trigger and the Squiggle/Kali refresh (`src/app/admin/current-season`).

## Decision

A small operations centre: data health, acquisition runs, reconciliation failures, unresolved
identities, award proposals, derived-result status, audit log, explicit maintenance and read-only
inspection. Each action shows what it changes, the affected season or records, validation state,
reversibility, the acting user and the resulting audit entry. Legacy runtime controls are removed
from the UI and their server actions refuse. Existing audited editors stay behind explicit
capabilities. UI work carries the Visual Evidence Mandate; with no database, captures are
normally impossible and are marked `VISUAL: UNVERIFIED` with the reason.

## Consequences

Role and audit tests accompany every action; no visual pass is ever claimed without captures.

## Implementation (Stage 5)

Operating guide: `docs/v2/admin-operations.md`; decisions: `docs/v2/plan.md` §7 R-030 to R-041.
Implemented: data health (coverage registry), acquisition-run status (no start control), unresolved
identities and the audit log as inspection links, award proposals, derived-result status and
publication (Coleman), Brownlow reconciliation (read-only), an action card with the six required
facts before every mutation, the retired legacy controls refusing after their guards. Not
implemented: a view of AFL API settle refusals (V2-GAP-025); public-page revalidation after a
curated approval (V2-GAP-024). Visual evidence: component-level captures from synthetic props
only; every real page is `VISUAL: UNVERIFIED`.