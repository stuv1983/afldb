# ADR 0010 — Every legacy ingestion path is classified; offline tools are quarantined, not deleted

- Status: Accepted (2026-10-19); inventory done in Stage 0; disposition implemented in Stage 4
  (`docs/v2/legacy-disposition.md`), with the admin runtime paths left to Stage 5
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

## Implementation (Stage 4)

- `docs/v2/legacy-disposition.md` classifies rows L1-L13 with their callers (`file:line`) and
  defines guards a-f.
- Quarantined: `tools/current-season/update-current-season.ts` moved to
  `legacy/offline/tools/current-season/` (`git mv`); its `--source` no longer defaults to Squiggle
  and is required (F-001). Retired: the `current-season:update` package script runs
  `tools/v2/retired-entry.ts`, which prints the refusal from the `@afldb/domain` registry
  (`RETIRED_ENTRIES`) and exits 1.
- Guards in `packages/testing/src/module-boundaries.ts`, exercised by
  `tests/v2-module-boundaries.test.ts`: the known legacy runtime edges are a ratchet (a new edge
  fails), public routes may not reach a legacy runtime module, no offline tool is imported by
  runtime code, no scheduler references a quarantined path, and every retired entry is wired to
  its refusal.
- Not moved, by decision (plan §7 R-025): the AFL Tables runtime (behind ISSUE-316, V2-GAP-011),
  the admin CSV, email and Squiggle/Kali paths (Stage 5, V2-GAP-013) and the Python/R tools
  (V2-GAP-014).

## Consequences

The module-boundary rule "only `legacy/**` imports `legacy/**`" is already enforced (ADR 0001).
The production go/no-go for an AFL API-only runtime stays no-go until V2-GAP-011 and V2-GAP-013
close.
