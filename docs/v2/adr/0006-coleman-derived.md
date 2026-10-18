# ADR 0006 — Coleman Medal is derived, never ingested

- Status: Accepted (2026-10-19); not implemented (Stage 4)
- Plan decision: `docs/v2/plan.md` §3 D6

## Context

The owner's instruction says Coleman results must be derived from promoted player goal
statistics rather than ingested as a primary external dataset where they can be derived.

## Decision

`@afldb/derived` will hold a pure derivation over promoted player goal facts: home-and-away
matches only, using the project's existing competition definition (ISSUE-111, as recorded in
`tools/migration/award_definitions.py` and `tools/migration/import_awards.py`, to be read before
implementation; a different scope is not invented). It requires a complete and settled season,
supports tied leaders, preserves the leaderboard and its inputs, records a derivation version,
timestamp and input checksum, refuses to publish an incomplete season and recomputes
idempotently. Publication goes through an explicit audited operation.

## Consequences

Until Stage 4 lands, `@afldb/derived` exports nothing and no Coleman behaviour changes.
