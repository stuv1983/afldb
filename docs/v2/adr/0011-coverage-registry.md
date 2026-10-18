# ADR 0011 — Explicit, evidence-backed coverage registry

- Status: Accepted (2026-10-19); not implemented (Stage 3)
- Plan decision: `docs/v2/plan.md` §3 D11

## Context

The AFL API season registry covers roughly 2012-2026, detailed verified match contracts roughly
2022-2026, and AFLDB history far earlier. The owner forbids labelling an unverified season as
API-rebuildable.

## Decision

A coverage registry with statuses `api_verified`, `api_partial`, `historical_baseline`,
`manual_curated` and `unsupported`, per season and data family. Every claim is tied to a test, a
stored fixture or a cited document, using the existing season registry and identity files as
evidence; nothing is fetched. Seasons outside verified coverage default to `historical_baseline`
(sealed, `docs/v2/historical-baseline.md`) or `unsupported`.

## Consequences

The historical-baseline manifest tooling (Stage 2) is the verification instrument for seasons
labelled `historical_baseline`.
