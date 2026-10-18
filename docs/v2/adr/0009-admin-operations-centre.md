# ADR 0009 — A small, audited operations-focused admin centre

- Status: Accepted (2026-10-19); not implemented (Stage 5)
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
