# ADR 0007 — Brownlow: AFL API authoritative, V2 adds pure reconciliation

- Status: Accepted (2026-10-19); not implemented (Stage 4)
- Plan decision: `docs/v2/plan.md` §3 D7

## Context

AFL API Brownlow acquisition, snapshot, staging and settle exist (`src/lib/acquisition/afl-api-brownlow.ts`,
`tools/current-season/{acquire,settle}-afl-api-brownlow.ts`, `deploy/afldb-settle-afl-api-brownlow.*`),
with timer and settlement conditions strengthened under AFLDB-ISSUE-232 and ISSUE-316.

## Decision

The AFL API stays the authoritative source. V2 adds a pure reconciliation module over the
existing snapshot/staging shapes: duplicate votes, per-player totals against the leaderboard,
round/match/club consistency, unresolved players, incomplete seasons, and ties reported without
inventing a winner rule. The strengthened timer and settlement conditions are preserved
byte-for-byte unless a test proves a change is required.

## Consequences

No Brownlow runtime behaviour changes in Stages 0-2.
