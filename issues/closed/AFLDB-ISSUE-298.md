# AFLDB-ISSUE-298 — AFL API snapshot companion files are read without manifest verification

## 0. Status

- **Status:** **Resolved (2026-10-15, merge-scoped)**, on the push of the documentation-only closure commit (§18). Implemented as `fd22d7a9` and `3987afaf` on `sonnet/issue-298` (base `1149e17a`), merged and pushed with its records as `54697545`; DB-free validated (§17.1, §17.2). **Not deployed.**
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

~~Implementation.~~ Implemented (§17), merged, closed (§18).

## 17. Implementation record (2026-10-14)

- **Commits:** `fd22d7a9` (fix) and `3987afaf` (tests) on `sonnet/issue-298`, base `1149e17a`. Source: `src/lib/acquisition/afl-api-snapshot.ts`. Tests: `tests/afl-api-player-evidence.test.ts` (the existing suite that already pins this module's refusals).
- **Shape (§13).** `aflApiUnitSourcesFrom` builds the set of manifest entries whose status is not `fixture_absent`, discovers units exactly as before (a listed `<dir>/fixture.json`), and before reading anything requires `fixture.json`, `match-roster.json` and `player-stats.json` of every discovered unit to be in that set. Otherwise it throws `Match '<dir>' is not fully verified by the manifest: <every unverified file> not listed with a hash (absent, or marked fixture_absent) — refusing to settle it.` One incomplete unit refuses the whole snapshot, never a silent drop, because a partial settle would look complete. `verifyAflApiSnapshotManifest` is unchanged (it already re-hashes every listed non-absent file).
- **Scope kept.** The acquisition tool's writes are untouched (§12). `emit-afl-api-bundle.ts` also writes `fixture_absent`, but into its own semantic-pair bundle manifest, which `aflApiUnitSourcesFrom` never reads; its two consumers (`settle-afl-api.ts`, `emit-afl-api-player-bridge.ts`) read acquisition snapshots, which list all three files per unit and never write `fixture_absent` (`acquire-afl-api.ts`). A match directory whose `fixture.json` is not listed at all is still not discovered (unchanged: acquisition omits it only when the season feed has no raw record for the match).
- **Existing test changed.** The `fixture_absent` case previously asserted only `toThrow()` of the incidental read error; it now asserts the new refusal and its message.

## 17.1 Validation (2026-10-14, assistant-run on the owner's explicit authorisation; Windows, DB-free)

- New cases (all in `tests/afl-api-player-evidence.test.ts`): unlisted `match-roster.json`; unlisted `player-stats.json`; each of the three files marked `fixture_absent` while on disk; every unverified file named; a second unit with only a hashed `fixture.json` refused although unit 1 is complete; the complete unit still read.
- The file: **58 passed.** Nine dependent files (`admin-current-season-settle`, `afl-api-brownlow`, `afl-api-ingestion-safety`, `afl-api-match`, `afl-api-player-bridge-cli`, `afl-api-player-bridge-import`, `afl-api-player-evidence`, `afl-api-settle-cli-gate`, `db-promotion-check`): **1108 passed, 1 skipped.** `npx tsc --noEmit`, `npx eslint` of the two changed files and `git diff --check`: exit 0.
- **Against the pre-fix source** (`afl-api-snapshot.ts` restored to `1149e17a`, then back): **8 of the 58 cases fail** (the seven new cases and the amended `fixture_absent` case); the other 50 pass.
- **Not run / limits:** PostgreSQL, the integration files, the full suite, any acquisition against the network, any browser or DEV/PROD action. No real snapshot under `data/sources/afl_api/` was read.

## 17.2 Mutation checks of the tests (2026-10-14, assistant-run; Windows, DB-free)

Each mutant changes the real fix, is applied alone and restored from a saved copy; the whole evidence file is run against it. A kill counts only on an assertion failure.

| Mutant | Result against the final tests |
|---|---|
| A a `fixture_absent` entry counts as verified | killed (5) |
| B `match-roster.json` is not required | killed (5) |
| C `player-stats.json` is not required | killed (5) |
| D `fixture.json` is not required | killed (2) |
| E the refusal is never thrown | killed (8) |
| F only the first unit is checked | killed (2) |
| G only the first unverified file is named | killed (3) |
| H a file counts as listed if any file of its directory is | killed (7) |

All eight fail on `AssertionError`; none survived. The 58 cases pass unmutated.

## 18. Readiness, merge and closure (2026-10-15)

- **Readiness: accepted under a scoped cleanliness exception, not a clean pass.** `npm run preflight -- --mode implementation --issue 298`: READY (0 blockers, 3 warnings: `.env`, `psql`, `pg_restore`). `npm run merge:ready -- --issue 298` (raw output, unchanged: `D:\tmp\issue298\merge-ready-raw-1.txt`): every check PASS except **one blocker, "main worktree is clean"**, the primary checkout's **17** untracked paths (nine `.agents/skills` files, seven zero-byte stray-named files including `void`, the literal `$null)`).
- **Exception.** The owner authorised a fresh exception for this issue, covering only that clean-tree FAIL and the exact 17-path set, compared by full content hash and verified immediately before the merge with `D:\tmp\issue298\exception-check.py` (a copy of the read-only ISSUE-306 script): `precheck-1`, `premerge-1` (with `$null)` pinned to `d9edb1467a9ddecc7ca89424e5b5597f3c6fae7e5e41b49bb279aa1f71f62500`) and `postmerge-1`, all RESULT OK. The exception covers no other check and no other path.
- **Merge 1.** `fd22d7a9`, `3987afaf` and the records commit `54697545` fast-forwarded onto `main` (`1149e17a..54697545`) and pushed; local `main`, the fetched `origin/main` and `git ls-remote origin refs/heads/main` all equalled it afterwards. Before the merge a fresh `git fetch` and `ls-remote` showed `main` still at `1149e17a`.
- **Resolution.** Resolved on the push of the documentation-only closure commit, under §14 ("A DB-free test in `tests/afl-api-player-evidence.test.ts`"), which is DB-free only and met (§17.1); §15 lists no decision. The closure scope is **merge-scoped**: code on `main`, DB-free validated, **not deployed**.
- **Preserved limits.** Not deployed. No PostgreSQL, integration or network-acquisition run; no real snapshot under `data/sources/afl_api/` was read. A match directory whose `fixture.json` is not listed at all is still not discovered (unchanged, §17).
