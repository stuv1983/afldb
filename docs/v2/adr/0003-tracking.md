# ADR 0003 — V2 tracking uses `V2-GAP-NNN`, not `AFLDB-ISSUE-NNN`

- Status: Accepted, in effect (2026-10-19)
- Plan decision: `docs/v2/plan.md` §3 D3

## Context

CLAUDE.md §5 allocates `AFLDB-ISSUE-NNN` IDs from `issues.md`. V2 is a local fork; allocating IDs
in it would collide with the mainline ledger, where work continues independently.

## Decision

V2 gaps, blockers and deferred work are recorded as `V2-GAP-NNN` in `docs/v2/known-gaps.md`.
`CHANGELOG.md` carries an `### AFLDB V2` subsection under `## Unreleased`. `issues.md`,
`IssuesIndex.md` and `issues/**` are left exactly as inherited (ISSUE-316 stays open).
Stage-by-stage state and the resumption point live in `docs/v2/progress.md`.

## Consequences

This departs from CLAUDE.md §5's allocation rule for a stated reason (ledger collision); the
departure is recorded in the CHANGELOG V2 section. Merging V2 back would map each open gap to a
mainline issue at that time.
