# ADR 0008 — Curated awards through an audited proposal workflow

- Status: Accepted (2026-10-19); not implemented (Stage 4)
- Plan decision: `docs/v2/plan.md` §3 D8

## Context

Club awards, league awards and historical honours that cannot be derived are today loaded by
offline importers (`tools/migration/import_awards.py` and its Wikipedia-derived parsers) and
edited through admin editors. The owner forbids direct Wikipedia-to-production automation.

## Decision

Proposal, validation, review, transactional approval or rejection, and revisions, all audited,
implemented as `@afldb/admin` services with capability checks. Manual entry in the admin data
editor uses the same pathway. Wikipedia input is a locally supplied file prepared offline into
proposals; it is never auto-approved and never fetched by runtime code.

## Consequences

Requires an additive migration (ADR 0004) and the matching privileges change.
