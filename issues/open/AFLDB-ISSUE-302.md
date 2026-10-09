# AFLDB-ISSUE-302 — Lineup bundle records the pinned fitzRoy version as provenance whatever version ran

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
- **Severity:** Low. **Area:** acquisition / provenance.
- **Key files:** `src/lib/acquisition/lineup-bundle.ts`, `tools/rebuild/afl_api/acquire_lineups.R`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-037). Partition R4b raised it as a cross-partition lead; the main session verified it.
- **Classification:** code-proven.

## 1. Summary

`acquire_lineups.R` records `fitzroy_version_installed`, `fitzroy_version_pinned` and `fitzroy_version_match`. It deliberately records a mismatch rather than refusing. The lineup bundle loader takes `fitzroy_version_pinned` as the acquisition's `fitzroyVersion` and never reads the installed version or the match flag. A bundle built with an unpinned fitzRoy therefore states the pinned version as its provenance. The core AFL Tables importer refuses the same mismatch.

## 2. Evidence

- `src/lib/acquisition/lineup-bundle.ts:400-402` (`fitzroyVersion: m.fitzroy_version_pinned`) and `:312` (propagated as `fitzroy_version`).
- `tools/rebuild/afl_api/acquire_lineups.R:155-157` (records all three).
- `tools/migration/import_fitzroy_core.py:958` (refuses `fitzroy_version_match is not True`).
- `tools/rebuild/afl_api/acquire_rosters.R:108-112` (rosters refuse).

## 3. Trigger

Acquiring lineups on a host where the installed fitzRoy differs from the contract pin.

## 4. Expected invariant

The provenance names the version that actually ran, or the bundle refuses a mismatched acquisition (as the core importer does).

## 5. Actual behaviour

The pinned version is recorded as provenance.

## 6. First wrong layer

`src/lib/acquisition/lineup-bundle.ts:400-402`.

## 7. Impact

Misleading provenance on lineup observations. No value corruption is known.

## 8. Reproduction / witness

Not executed.

## 9. Disproof attempts

A repository grep for `fitzroy_version_match` / `fitzroyVersion` shows no consumer check on the lineup path.

## 10. Existing-issue search

None. Classification: **new**.

## 11. Scope

The lineup bundle's provenance.

## 12. Out of scope

The roster and core acquirers (they already refuse).

## 13. Proposed fix boundary

Refuse a manifest whose `fitzroy_version_match` is not `true`, or record `fitzroy_version_installed`.

## 14. Proposed validation

DB-free: `tests/afl-api-lineup.test.ts` with a mismatched manifest.

## 15. Decisions / unresolved questions

- D-302-1: refuse, or record the installed version (operator).

## 16. Next action

D-302-1.
