# ADR 0010 — Every legacy ingestion path is classified; offline tools are quarantined, not deleted

- Status: Accepted (2026-10-19); inventory done in Stage 0, disposition in Stage 4
- Plan decision: `docs/v2/plan.md` §3 D10

## Context

`docs/v2/inventory.md` §5 lists every legacy ingestion entry point: runtime CSV upload and email
intake, the AFL Tables nightly settle chain and its admin trigger, the Squiggle/Kali current-season
refresh, the offline rebuild families (`tools/rebuild/**`), the `tools/migration` importers and the
Wikipedia-derived enrichment parsers.

## Decision

Each path is classified in `docs/v2/legacy-disposition.md` as removed, offline evidence, disabled
compatibility boundary, replaced by AFL API, replaced by derivation, or replaced by curated entry.
Offline historical tools move under `legacy/offline/` only where the move is safe (their tests'
paths are updated); where a move would break the sealed historical rebuild they stay in place, are
classified, and are blocked from runtime by test. No scheduler registration, no runtime import, no
admin button. The only recoverable source of historical knowledge is never deleted.

## Consequences

The module-boundary rule "only `legacy/**` imports `legacy/**`" is already enforced (ADR 0001).
