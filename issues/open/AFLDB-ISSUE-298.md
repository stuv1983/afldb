# AFLDB-ISSUE-298 — AFL API snapshot companion files are read without manifest verification

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
- **Severity:** Low. **Area:** acquisition / evidence integrity.
- **Key file:** `src/lib/acquisition/afl-api-snapshot.ts` (`aflApiUnitSourcesFrom`).
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-033; partition note R4b-F03).
- **Classification:** code-proven.

## 1. Summary

Units are discovered from `fixture.json` manifest entries only. `match-roster.json` and `player-stats.json` are then read by naming convention, whether or not the manifest lists them, and a manifest entry with status `fixture_absent` skips hashing even though the file is still read. Unverified bytes are handed to the settle.

## 2. Evidence

- `src/lib/acquisition/afl-api-snapshot.ts:73` (`fixture_absent` skip) and `:84-88` ("the manifest is the one proof"), `:92-101`.
- `tools/current-season/acquire-afl-api.ts:139-165, :296-340` (acquisition never writes `fixture_absent`).
- `tools/current-season/settle-afl-api.ts:143` (consumer).

## 3. Trigger

A tampered or hand-edited manifest that omits a companion file, or lists it as `fixture_absent`.

## 4. Expected invariant

A unit whose three files are not all listed and hashed is refused.

## 5. Actual behaviour

The unverified companion is settled.

## 6. First wrong layer

`afl-api-snapshot.ts:92-101`.

## 7. Impact

A defence-in-depth gap only; it needs host-level tampering.

## 8. Reproduction / witness

Not executed.

## 9. Disproof attempts

`settle-afl-api.ts` has no second listing check.

## 10. Existing-issue search

None. Tests cover a missing file and a hash mismatch, not an unlisted companion (`tests/afl-api-player-evidence.test.ts:887-938`). Classification: **new**.

## 11. Scope

The unit source discovery.

## 12. Out of scope

The acquisition tool's own writes.

## 13. Proposed fix boundary

Build a set of listed, non-absent files and refuse a unit that is missing either companion.

## 14. Proposed validation

A DB-free test in `tests/afl-api-player-evidence.test.ts`.

## 15. Decisions / unresolved questions

None.

## 16. Next action

Implementation.
