# AFLDB-ISSUE-284 — Brownlow season "accounted" count excludes a drafted source-complete match and blocks Publish

## 0. Status

- **Status:** Open (2026-10-08). Implemented and validated on `afldb_test` 2026-10-15 (§17); not deployed.
- **Severity:** Low. **Area:** admin Brownlow.
- **Key file:** `src/db/queries/admin-brownlow.ts` (`selectSeasonAggregates`).
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-019; partition note R2a-F03). The orchestrator confirmed that `player-derived.ts:651` (coverage) uses the facts rule and is unaffected.
- **Classification:** code-proven.

## 1. Summary

The season aggregate counts a match as `imported` only when `entry_status IS NULL AND facts_complete`. A match that already has a complete 3/2/1 from the source, and on which an Admin presses "Save draft", is therefore counted in none of final, voided or imported. The season reads "not complete", and the Publish panel lists a blocker and disables "Publish season…". Meanwhile the publish transaction's own gate, the per-round tables and the pure rule `isMatchAccounted` all count the match as accounted.

## 2. Evidence

- `src/db/queries/admin-brownlow.ts:213` (the `imported` predicate) and `:261-262` (accounted/complete).
- The gate: `admin-brownlow.ts:1313-1316`. Per-round: `:339-342`, `src/app/admin/brownlow/[season]/[round]/page.tsx:51-53`. The badge: `admin-brownlow-ui.ts:113-116`.
- `src/lib/brownlow/entry.ts:529-534` (`isMatchAccounted`), `:416-420` (draft allowed from null).
- The UI: `MatchVoteEditor.tsx:343-352` (Save draft rendered), `PublishPanel.tsx:66-77, :161`.

## 3. Trigger

An Admin (`data.brownlow.draft`) saves a draft on a historical match whose source votes are complete.

## 4. Expected invariant

One accounting rule: a complete 3/2/1 is accounted, whatever its draft row.

## 5. Actual behaviour

The coverage strip and the Publish control disagree with the gate and the round tables, and Publish is blocked in the UI.

## 6. First wrong layer

`src/db/queries/admin-brownlow.ts:213`.

## 7. Impact

The operator is misled, and publishing is blocked until a Super Admin finalises the drafted match. No data effect.

## 8. Reproduction / witness

Not executed (DB-backed).

## 9. Disproof attempts

- No UI guard prevents a draft on an imported match.
- The aggregate does not feed the gate.

## 10. Existing-issue search

ISSUE-155 §27.9 defines accounted as `final + void + imported`. "Imported" is implemented two ways. Classification: **new**.

## 11. Scope

The aggregate predicate and the derived status.

## 12. Out of scope

Coverage (`player-derived.ts`), which is unaffected.

## 13. Proposed fix boundary

Count `facts_complete` without the `entry_status IS NULL` condition for accounting, keeping `imported` as a display count if wanted.

## 14. Proposed validation

Integration (`tests/integration/admin-brownlow.test.ts`): a draft on an imported match → the season is still complete and publish is accepted.

## 15. Decisions / unresolved questions

None.

## 16. Next action

~~Implementation.~~ Superseded by §17.

## 17. Implementation and validation (2026-10-15)

### 17.1 Change

- `src/db/queries/admin-brownlow.ts`: `selectSeasonAggregates` gains an `accounted` count, `count(*) FILTER (WHERE entry_status = 'void' OR facts_complete)`, which is the rule the publish transaction's gate and the per-round tables already use. `BrownlowSeasonCounts` and the aggregate row carry it, and `toSeasonSummary` takes `complete` and the season status from it instead of `final + voided + imported`. `imported` is unchanged (the display count of matches with no workflow row and complete facts); a drafted match whose source votes are complete is now in `draft` and in `accounted`, not in `imported`.
- `src/app/admin/brownlow/labels.ts`: `incompleteMatchCount` is `expected - accounted`. `src/app/admin/brownlow/[season]/page.tsx`: the coverage strip and the Publish panel's `accounted` read `overview.accounted`.
- No migration and no write path changed; the publish gate, the per-round tables and `isMatchAccounted` are untouched.

### 17.2 Tests

- `tests/integration/admin-brownlow.test.ts`: a new block `one accounting rule for the season aggregate (ISSUE-284)`, one case on `afldb_test`. It has its own season (2075; a new `BROWNLOW_ACCOUNTING_SEASON` shape in `brownlow-fixture.ts`, two full home-and-away matches in one round) seeded by the block's own `beforeAll` and swept with the others, because the shared reserved `short` season is mutated by earlier cases (a first version that used it failed in a multi-block run: two drafts already existed). Both matches get a complete source 3/2/1 (accounted 2, complete). One is then drafted: `draft` 1, `imported` 1, `accounted` still 2, `complete` true, status `entered`, the round table 2/2, the season list agrees, and `publishBrownlowSeason` is accepted.
- `tests/brownlow-entry.test.ts` (DB-free): `incompleteMatchCount` counts what remains after the accounted matches and never goes negative, and a source-contract case that the season page and `labels.ts` do not rebuild `accounted` from the display counts (no test renders the page).

### 17.3 Results

- **Authority.** `D:\tmp\issue284\run-int.mjs` (the ISSUE-282 launcher, copied, with extra vitest arguments passed through) derived the owner, importer and auth DSNs in memory from the primary `.env`, pointed them at `afldb_test` on tunnel port 55432 and proved `current_database() = afldb_test` for each before vitest started. No credential was printed or written. The file's `beforeAll` seeds the reserved Brownlow seasons over the tunnel in 35 to 50 seconds, beyond vitest's 30-second hook default, so the runs pass `--hookTimeout=900000 --testTimeout=300000`; the first attempt timed out in the hook and left nothing behind (census 0). No `afldb_dev`, PROD, migration, rebuild, restore, truncation or repair; only the fixture's own seasons were written and removed by its own sweep.
- **Fixed code.** Filter `ISSUE-284`: **1 passed**, 45 skipped. With its neighbours (`refusals that write nothing`, `the main season, administered in order`, `publication`, `the season list`, and the new block): **32 passed**, 14 skipped. DB-free: `brownlow-entry` 95 passed; with `admin-brownlow-actions`, `brownlow-focus-restore`, `brownlow-vote-form-data` and `brownlow-season-artefact`, 206 passed in 5 files.
- **Unfixed source** (`git checkout HEAD -- src/`, the fixed files copied back and sha-256 verified): the integration case fails (`accounted` does not exist: `expected undefined to be 2`) and 3 DB-free cases fail. Mutant M1 restores the original predicate with the field present, which reproduces the defect itself: `expected 1 to be 2` once the match is drafted.
- **Mutants** (`D:\tmp\issue284\mutate284.mjs`, one at a time, original bytes restored and hash-verified after each): the original `entry_status IS NULL` predicate (M1), `complete` rebuilt from `final + voided + imported` (M2), the exposed count rebuilt the same way (M3), voided matches dropped from the rule (M4, killed by the main-season block), complete facts dropped from the rule (M5), `incompleteMatchCount` never subtracting (M6), and the page rebuilding `accounted` (M7). **All 7 killed.**
- **Fixture residue.** A read-only census of the ISSUE-155 Brownlow fixtures (matches, seasons 2075/2084/2085/2089, club seasons, availability, round and season votes, authority, entry state, players, authority audit rows) read 0 before the first run and after every run, mutant and neighbour run.
- **Static.** `tsc --noEmit` exit 0; ESLint of the six changed files exit 0; `git diff --check` exit 0.

### 17.4 Limits

- Not deployed; no browser, DEV or PROD action; the season page and list were not rendered. The whole `admin-brownlow` integration file was not run (the migration, concurrency and reload-precedence blocks are outside the change); the blocks named in §17.3 were. A `final` match whose facts are not a complete 3/2/1 is no longer counted as accounted by the aggregate; that is the gate's own rule, and no fixture or finalise path produces such a match.
