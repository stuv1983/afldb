# AFLDB-ISSUE-299 — R lineup and roster acquirers overwrite retained evidence in place

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
- **Severity:** Low. **Area:** acquisition tooling / evidence retention.
- **Key files:** `tools/rebuild/afl_api/acquire_lineups.R`, `tools/rebuild/afl_api/acquire_rosters.R`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-034; partition note R4b-F04).
- **Classification:** code-proven.

## 1. Summary

Both R acquirers use a deterministic default label (no timestamp) and create the output directory silently when it already exists. A second run with the same scope therefore rewrites the artefact and `manifest.json` over the first. That is the silent-overwrite hazard `src/lib/acquisition/snapshot-dir.ts` was added to prevent for the TypeScript acquirers.

## 2. Evidence

- `acquire_lineups.R:76, :80, :111` (default label `afl-api-lineups-<season>-r<round>`, `dir.create(showWarnings = FALSE)`).
- `acquire_rosters.R:94-95, :131`.
- `src/lib/acquisition/snapshot-dir.ts` and `issues.md:39507-39555` (the TypeScript fix).
- `afl-api-contract.json:91-93` protects the accepted roster snapshot only after the fact.

## 3. Trigger

`Rscript tools/rebuild/afl_api/acquire_lineups.R --season 2026 --round 20`, run twice.

## 4. Expected invariant

An existing output directory is refused, or the default label is timestamped.

## 5. Actual behaviour

The prior evidence is overwritten.

## 6. First wrong layer

`acquire_lineups.R:76-111`; `acquire_rosters.R:94-131`.

## 7. Impact

Loss of the prior evidence bytes. The accepted roster snapshot's sha check later refuses to use the result, but the original bytes are gone.

## 8. Reproduction / witness

Not executed.

## 9. Disproof attempts

There is no `dir.exists` refusal.

## 10. Existing-issue search

`acquire_lineups` / `acquire_rosters` appear in design entries only (`issues.md:8928, :9077`). Classification: **new**.

## 11. Scope

The two R scripts.

## 12. Out of scope

The TypeScript acquirers (already safe).

## 13. Proposed fix boundary

Refuse an existing out_dir, or timestamp the default label.

## 14. Proposed validation

Run twice with the same scope into a scratch `--out-dir` (operator-run; network) and expect a refusal on the second run.

## 15. Decisions / unresolved questions

None.

## 16. Next action

Implementation.
