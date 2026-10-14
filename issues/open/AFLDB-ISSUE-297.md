# AFLDB-ISSUE-297 — AFL API provider id is used unvalidated as a file path and URL path segment

## 0. Status

- **Status:** Open (2026-10-08). **Implemented and committed 2026-10-14** as `9c5ba69c` on `sonnet/issue-297` (base `839e084c`); DB-free validation passed (§17); **not merged or pushed** — readiness is BLOCKED (§17.4). Not deployed.
- **Severity:** Low. **Area:** acquisition / AFL API client and acquisition tool.
- **Key files:** `src/lib/acquisition/afl-api-client.ts` (`parseAflApiSeasonMatchesEnvelope`, `plan*Request`), `tools/current-season/acquire-afl-api.ts`, `src/lib/acquisition/afl-api-snapshot.ts`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-032; partition note R4b-F01). The main session re-read the parser and the acquisition loop.
- **Classification:** code-proven.

## 1. Summary

The season feed parser accepts any non-empty string as `providerId`. The acquisition tool then joins it into a relative path and creates directories, writing `fixture.json`, `player-stats.json` and `match-roster.json` under it. The client interpolates it into `/afl/playerStats/match/${id}`, a request that carries the `x-media-mis-token` header. An id such as `../../escape` writes outside the claimed snapshot directory and requests an unintended path. The snapshot reader later follows the manifest's traversal.

## 2. Evidence

- `src/lib/acquisition/afl-api-client.ts:369-380` (`typeof providerId !== 'string' || length === 0` is the only check) and `:154, :162` (URL paths).
- `tools/current-season/acquire-afl-api.ts:309-312, :330, :337` (`join(match.providerId, …)`, `mkdirSync(dirname(path), {recursive: true})`) and `:389-395` (the cleanup removes the claimed directory only).
- `src/lib/acquisition/afl-api-snapshot.ts:74` (`join(snapshotDir, entry.file)`).
- The measured shape is `CD_M<digits>` (`tools/current-season/emit-afl-api-bundle.ts:65`).

## 3. Trigger

An upstream feed (or an operator-overridden base URL) that returns an entry `{providerId: "../../escape", status: "CONCLUDED"}`.

## 4. Expected invariant

Every field of the feed is untrusted. An id that is not `^CD_M\d+$` is refused at parse time.

## 5. Actual behaviour

Files are written outside the evidence tree and token-bearing requests go to arbitrary paths on the CFS host. Under systemd the write is bounded by `ReadWritePaths=/home/arm/projects/afldb/data/sources/afl_api` (`deploy/afldb-settle-afl-api.service:75`).

## 6. First wrong layer

`src/lib/acquisition/afl-api-client.ts:371-374`.

## 7. Impact

Low: the attacker would have to be the upstream provider over TLS, or the base URL would have to be misconfigured. It is a gap in otherwise strict feed validation.

## 8. Reproduction / witness

Not executed. The DB-free check is in §14.

## 9. Disproof attempts

No `CD_M` shape check exists in the client, the acquisition tool or the snapshot reader.

## 10. Existing-issue search

"path traversal" and "providerId directory": none. Classification: **new**.

## 11. Scope

Provider-id shape validation.

## 12. Out of scope

Other feed fields, which are already gated.

## 13. Proposed fix boundary

A regex guard in `parseAflApiSeasonMatchesEnvelope`, and the same guard in the `plan*Request` helpers.

## 14. Proposed validation

DB-free:
- `parseAflApiSeasonMatchesEnvelope('{"matches":[{"providerId":"../escape","status":"CONCLUDED"}]}')` throws.
- `runAcquisition` with the existing `stubFetch` harness refuses before writing.

## 15. Decisions / unresolved questions

None.

## 16. Next action

~~Implementation.~~ Done 2026-10-14 (§17). Remaining: merge and push (§17.4), then the closure records.

## 17. Implementation record (2026-10-14)

### 17.1 Change (commit `9c5ba69c`, parent `839e084c`, tree `02c744ed`; exactly three files)

- `src/lib/acquisition/afl-api-client.ts`: exported `AFL_API_MATCH_PROVIDER_ID_PATTERN` (`/^CD_M\d+$/`) and `AFL_API_SEASON_PROVIDER_ID_PATTERN` (`/^CD_S\d+$/`) and a private `assertProviderId`. `parseAflApiSeasonMatchesEnvelope` refuses an entry whose `providerId` is not `CD_M<digits>`, naming the entry index and a 64-character slice of the value. `planAflApiPlayerStatsRequest` and `planAflApiMatchRosterRequest` apply the match pattern; `planAflApiBrownlowSeasonRequest` and `planAflApiBrownlowLeaderboardRequest` apply the season pattern. The empty-value messages (`matchProviderId is required.`, `seasonProviderId is required.`) are unchanged. JavaScript `$` without the `m` flag does not match before a trailing newline, so `CD_M1\n` is refused.
- Consequence for `tools/current-season/acquire-afl-api.ts`: it claims its (empty) snapshot directory, fetches the feed and parses it (`:284`) before it writes `00-season-matches.json` or any per-match file, so a hostile id refuses before any file is written or any per-match CFS request is made (only the token and public season-feed requests have happened; the empty claimed directory is removed by `cleanupPartialSnapshot`). No change to the tool was needed. The snapshot reader (`afl-api-snapshot.ts:74`) was not changed: it reads manifest entries the acquisition tool wrote, and the runbook's §13 boundary names only the parser and the plan helpers.
- `tools/db/afl-api-season-rekey-rehearsal.ts`: the `code_test_db` rehearsal's synthetic ids were `CD_M2026231R` + `OLD`/`NEW`/`AMA`/`AMB`/`AMN`, which the new contract refuses. They are now `CD_M20262319` + `01`..`05` (`providerLike` `CD_M20262319%`; one hard-coded message regex updated). The `LIKE` semantics are unchanged; the `2026231` series is still not a real season code. **The rehearsal was not re-run** (it needs `code_test_db`); its DB-free fixture tests in `tests/afl-api-match.test.ts` pass. Residue from any earlier rehearsal under the old `CD_M2026231R%` prefix would no longer be counted by the tool's census; the rehearsal rolls back, so none is expected, and none was checked.
- `tests/afl-api-match.test.ts`: four new `AFLDB-ISSUE-297` cases (match plan helpers; season plan helpers; parser; `runAcquisition` with a feed containing `../../escape`, asserting no `playerStats`/`matchRoster` request, no manifest, no `CD_M1` directory and nothing created outside the claimed snapshot directory), the two Brownlow plan imports, and the synthetic ids `CD_M_OTHER` → `CD_M99` and the rehearsal id regexes.

### 17.2 Validation (DB-free, Windows, 2026-10-14; run by the assistant under the owner's per-task authorisation)

- `tests/afl-api-match.test.ts`, `tests/afl-api-brownlow-acquire.test.ts`, `tests/afl-api-ingestion-safety.test.ts`: **386 passed, 0 failed** (3 files). The first run, before the synthetic-id change, had 12 failures, all from ids this contract correctly refuses (`CD_M2026231ROLD`/`RNEW`, `CD_M_OTHER`).
- **Witness:** with `afl-api-client.ts` restored to `HEAD`, the four new cases fail (4 failed, 209 skipped by the `-t ISSUE-297` filter); with the fix they pass. The fixed file was restored from a saved copy and the diff re-checked.
- `tsc --noEmit` exit 0. ESLint on the three files: 3 `no-explicit-any` errors in `tests/afl-api-match.test.ts`, **identical at the base commit** (stash differential; line numbers shifted by 64), none introduced. `git diff --check` clean.
- Whole `vitest run` in the fresh worktree: 94 files failed, of which 83 are `tests/integration/*` (no database URL) and 11 are non-integration files with 11 failing tests (Windows CRLF baseline, missing untracked `data/` inputs, etc.). A stash differential on those 11 files gives **identical failure sets and counts before and after** (11 failed | 1039 passed | 3 skipped, both). No integration test was run; a static search found no integration file that reaches the parser or the four plan helpers (`runAcquisition`, `parseAflApiSeasonMatchesEnvelope` and the plan helpers appear only in `tests/afl-api-match.test.ts` and `tests/afl-api-brownlow-acquire.test.ts`).
- Real shapes checked: every `providerId` in the retained season-feed fixtures normalises to `CD_M<digits>` (matches), and `data/reference/afl-api-identities.json` seasons are `CD_S<digits>`; the 218-entry 2026 feed passes the parser.

### 17.3 Not established

- No DEV or PROD run. The parser is also used by the settle's season-enumeration read (`afl-api-season-enumeration.ts:160`), so after deployment a feed carrying any other id shape would make the enumeration throw; the measured shape is `CD_M<digits>` and no counter-example is known. The first nightly after deployment is the observation; it is not required by §14.
- The `code_test_db` rekey rehearsal was not re-run.
- Other feed fields, the manifest-driven snapshot reader and the R acquirers are out of scope (§12).

### 17.4 Readiness (2026-10-14)

`npm run merge:ready -- --issue 297` (raw output preserved at `D:\tmp\issue297\merge-ready-raw-1.txt`, SHA-256 `f3125173…`): **BLOCKED**, one blocker (`FAIL main worktree is clean: D:/dev/afldb`), two metadata warnings (no `afldb-merge-readiness` block in the runbook; no unexpected-file classification). Every other check passed (branch, issue worktree clean, local `main` = recorded `origin/main` = `839e084c`, ahead 1 / behind 0, migration parity). The primary listed **16** untracked paths — the 15 preserved paths (nine `.agents/skills` files and six zero-byte stray-named files) **plus a zero-byte file `void`, created at 16:17:12 on 2026-10-14 during this session by the tooling**. The owner's exception covers exactly the 15; deleting `void` was refused by the permission classifier, so it was not removed and the exception was **not applied**. Merge, push and closure are waiting on the owner (remove `void`, or extend the exception to it).
