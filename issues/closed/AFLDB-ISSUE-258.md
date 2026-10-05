# AFLDB-ISSUE-258 — Legacy CSV intake blanks existing statistics when an optional column is absent or malformed

## 0. Status

- **Status:** Resolved (2026-10-04; DEV accepted, PROD promotion outstanding). Implementation
  validated 2026-10-04 (operator run `run-20261004-080549`, PASS), committed as `e7b57ede`, deployed
  to DEV and accepted on the combined evidence in §18.5. The runbook moves to `issues/closed/` with
  the operator's commit.
- **Opened:** 2026-10-02.
- **Severity:** Low.
- **Area:** Legacy file intake / data integrity — `src/lib/ingest/datasets.ts`
  (`player_match_stats` and `match_results` datasets).
- **Review origin:** `playbooks/issue.md`, finding F-002.
- **Operator decision (2026-10-02, made after the review):** fix the two reachable datasets
  (§15.2). Deprecation alone is not the resolution.
- **Implemented 2026-10-03, uncommitted** on `issue/258-legacy-csv-null-preservation` from `main`
  `14c289e8` (§17). DB-free validation passed.
- **2026-10-03, validation pass (uncommitted):** F-258-I1 is now owned by **AFLDB-ISSUE-264**;
  F-258-I2 reviewed (§17.7); R-258-1 recorded; operator runner prepared (§17.9).
- **2026-10-04, `afldb_test` validation PASSED (§17.10, run 4):** `match-results-promotion` 10/10,
  `datasets` 16/16, `submission-promotion` 7/7; `npm run build` exit 0, 1,515 pages; every
  post-suite and post-build check clean. The final diff review is §17.11. Not yet committed.
- **2026-10-04, DEV deployed and validation-path acceptance run (§18):** `e7b57ede` on DEV, R-258-1
  census empty, submissions 54–59 behave as specified. **DEV accepted (§18.5)** on the combined
  `afldb_test` promotion evidence and the DEV upload/review validation. **No DEV promotion was
  performed.** The six acceptance submissions were then rejected through the application (§18.6).
- **Still visible:** F-258-I2 (`disposals` not schema-enforced), the §15.1 item 3 past-damage census
  (not run) and R-258-1 (re-validation of pre-deployment submissions) are unchanged; new LOW finding
  F-258-D1 (§18.7). Outstanding PROD notes: §18.8.
- **2026-10-05, ISSUE-264 now resolved:** F-258-I1 (Match Sheet authority ignored by this intake) is
  owned by AFLDB-ISSUE-264, which is **resolved 2026-10-05, DEV accepted, PROD promotion outstanding**
  (implementation `ebbe2c00`; runbook `issues/closed/AFLDB-ISSUE-264.md`). The 2026-10-03 to 2026-10-04
  entries above and in §17–§18 that call ISSUE-264 open and unimplemented are dated historical records
  and are kept as written.
- §1–§14 are the review's record as written before the decision.

## 1. Summary

The `player_match_stats` and `match_results` upload datasets read their optional numeric columns
with a helper that returns NULL both when the column is missing from the file and when the cell
holds text that is not a whole number. Validation reports such a row as `ok`. On promotion the
upsert overwrites every optional column of a matching existing row with the incoming value, so the
NULLs replace stored figures.

A file that carries only some statistic columns, or one with a typing error in a cell, therefore
erases canonical values behind a clean validation report.

## 2. Evidence

All references are to `main` at `1c1a4805`, file `src/lib/ingest/datasets.ts` unless stated.

- `:80-84` — `toIntOrNull`: `null` stays `null`; anything `Number()` does not turn into an integer
  becomes `null`. A missing column arrives as `undefined`, and `Number(undefined)` is `NaN`.
- `:666` — `player_match_stats` requires only `season`, `round_code`, `home_club`, `away_club`,
  `player`, `club`.
- `:719-722` — `brownlow_votes` is range-checked only when it parses; otherwise it is NULL.
- `:728`, `:734`, `:737` — `career_game_no`, `jumper_number` and all 21 statistics are taken through
  `toIntOrNull` (or passed through) with no "present but unparseable" check.
- `:742-788` — the upsert. `ON CONFLICT (player_id, match_id) DO UPDATE` sets `club_id`,
  `career_game_no`, `jumper_number`, all 21 statistics and `brownlow_votes` to the incoming values.
- `:544-553` — `match_results`: goals and behinds are read through `toIntOrNull`; they are compared
  with the score only when both parse.
- `:555-558` — attendance is the one optional column that does error when present and malformed.
- `:621-637` — the `match_results` upsert overwrites goals, behinds, attendance and
  `attendance_status` (among others) on conflict.
- `:838-853` — contrast: `player_bio` uses `COALESCE` and says "a partial file can never blank a
  figure it did not mention".
- `src/lib/ingest/pipeline.ts:44-51` — staging checks required columns only; extra and missing
  optional columns pass.
- `src/lib/ingest/csv.ts:99-108` — a blank cell becomes `null`.
- `tests/integration/datasets.test.ts:121-191` — the `player_match_stats` cases cover identity
  resolution and vote range only.

## 3. Supported execution/data path

1. An admin or Super Admin uploads a CSV at `/admin/upload` ("Legacy file intake"), or a recognised
   sender emails one.
2. `validateSubmission` runs `validateRow` per row. Rows whose optional columns are absent or
   malformed are `ok`.
3. A Super Admin approves and promotes at `/admin/submissions/<id>`
   (`decideSubmission`, `runPromotion` → `promoteSubmission`).
4. `promoteRow` upserts. Each row that matches an existing `(player, match)` or `match_key` has its
   optional columns overwritten.

## 4. Expected invariant

A row the validation report marks `ok` is applied as written, and a file that says nothing about a
figure leaves that figure alone. An unreadable cell is an error the reviewer sees.

## 5. Actual behaviour

- A statistic column missing from the header sets that statistic to NULL on every matched row.
- A cell such as `1O`, `12.5` or `n/a` sets that statistic to NULL, with verdict `ok`.
- The same applies to `career_game_no`, `jumper_number` and `brownlow_votes` for player rows, and
  to goals and behinds for match rows.
- A `match_results` file without an attendance column sets `attendance` to NULL and
  `attendance_status` to `not_collected` on a matched match.

## 6. First wrong layer / root cause

Validation. `toIntOrNull` conflates three states — not supplied, blank, unparseable — into one
value, and `validateRow` for these two datasets does not distinguish them. The upsert then treats
that value as an instruction to write NULL.

## 7. Impact

- **Data:** existing canonical statistics on matched rows are replaced by NULL ("not recorded"),
  including rows owned by a source. For a current-season row owned by the settling source the next
  settle restores the columns it proposes; `brownlow_votes` is not among them. For a completed
  season nothing restores the values short of a source reload or a backup.
- **User-visible:** player and match pages lose figures; derived totals follow after the next
  derived rebuild.
- **Operational:** the reviewer has no signal. The report shows every row `ok`.
- **Scope:** the two fact-table datasets of a pipeline ISSUE-186 marks deprecated. Reaching it needs
  an upload role and a Super Admin approval. The award datasets were not examined for this pattern.

## 8. Reproduction / witness

**By inspection:** `Number(undefined)` and `Number('1O')` are `NaN`; `Number.isInteger(NaN)` is
false; `toIntOrNull` returns `null`; nothing in `validateRow` raises; the upsert writes
`EXCLUDED.<column>`.

**Database rehearsal (not run; `afldb_test` only, with authorisation).**
1. Pick an existing `player_match_stats` row and note its statistics.
2. Stage and validate a one-row CSV with the six identifying columns and `goals` only. Expect `ok`.
3. Approve and promote. Read the row: every other statistic is NULL.

## 9. Disproof attempts

- Looked for a header check beyond required columns: none (`pipeline.ts:44-51`).
- Looked for a per-column parse error for statistics: none.
- Looked for `COALESCE` or a changed-columns-only update in either upsert: none.
- Looked for a database constraint that would refuse the NULLs: the statistic columns are nullable
  by design. Whether migration 020's attendance constraint refuses the `match_results` case when the
  stored attendance cites a source was **not** verified.
- Looked for a test or comment declaring full-row replacement intended: the description says
  "re-uploading a corrected file updates rather than duplicates"; nothing addresses omitted columns.

## 10. Existing-issue / historical search

Searched `issues.md` headings and text for upload, submission, CSV, intake, dataset, "partial file",
`toIntOrNull`; read ISSUE-186; checked ISSUE-013, 026, 074, 175, 185 and ISSUE-155 §27.

- **AFLDB-ISSUE-186** (resolved for Phase A): the pipeline is deprecated; retirement of the code
  (Phases B and C) is deferred and has no issue ID. Related, not an owner.
- **AFLDB-ISSUE-185**: provenance on promoted match results. Unrelated.
- **AFLDB-ISSUE-175**: promotion concurrency. Unrelated.
- **AFLDB-ISSUE-155** §27: records this dataset's `brownlow_votes` write as a compatibility path left
  unchanged. That decision covers the writer existing, not the blanking described here.

No issue owns this defect.

## 11. Scope

- Validation and promotion of optional numeric columns in the `player_match_stats` and
  `match_results` datasets.

## 12. Explicitly out of scope

- Retiring the legacy pipeline (the deferred ISSUE-186 phases), except as an alternative resolution.
- Whether this dataset should write `brownlow_votes` at all (ISSUE-155's recorded decision).
- Derived data after promotion. The review page already tells the administrator to rebuild.
- Manual authority or source ownership of rows a promotion updates.
- The award datasets and `player_bio`, `match_attendance`.

## 13. Proposed fix boundary

`src/lib/ingest/datasets.ts` only: distinguish absent, blank and unparseable for the optional
numeric columns of the two datasets; make unparseable an error; and stop a column the file does not
carry from overwriting a stored value. Alternatively, remove the two datasets from the registry
under the ISSUE-186 retirement.

*Added after the review:* the operator chose the fix, not the retirement, on 2026-10-02 (§15.2).

## 14. Proposed validation

- **DB-free:** validator cases for an absent column, a blank cell and a malformed cell, in the
  closest existing dataset suite.
- **Integration (`afldb_test`):** a promotion over an existing row asserting an unmentioned
  statistic survives and a malformed cell is refused at validation.
- **DEV acceptance:** one staged file through the review page.
- **Production acceptance:** not required.

## 15. Decisions / unresolved questions

### 15.1 As the review left them

1. Fix the datasets, or retire them under ISSUE-186 Phases B and C?
2. Should a blank cell in a column the file does carry mean "clear this figure" or "leave it"?
3. Has any promoted submission already blanked figures? A read-only check of `import_batches` rows
   with `tool = 'admin-upload'` and `target_table` in the two datasets would bound it. Not run.

### 15.2 Operator decision (2026-10-02, after the review)

**D-258-1 — Fix the two reachable legacy datasets.** Deprecation alone is not treated as the
resolution. The eventual ISSUE-186 retirement stays out of this implementation.

**D-258-2 — Semantics for an optional column:**

| The file has… | Result |
|---|---|
| no such column | the existing canonical value is preserved |
| the column, cell blank | the existing canonical value is preserved |
| the column, cell malformed or not a whole number | validation error; promotion must not proceed for that row |
| the column, a valid value | applied normally |

**D-258-3 — No implicit clear.** Blank never means "clear this figure". Explicit clearing, if it is
ever required, needs a separate deliberate contract and is not part of this issue.

Item 3 of §15.1 (whether a past promotion already blanked figures) was not decided and remains
**not run**. It would need its own authorisation.

### 15.3 Acceptance boundary that follows from the decision

- Applies to the optional columns of `player_match_stats` (the 21 statistics, `career_game_no`,
  `jumper_number`, `brownlow_votes`) and of `match_results` (goals, behinds, attendance).
- "Preserved" concerns a row that already exists. For a row the promotion inserts there is no
  existing value, so an absent or blank optional column is stored as not recorded, as today.
- An error row already blocks approval and promotion of the whole submission
  (`decideSubmission`, `promoteSubmission`), so "must not proceed for that row" is met by the
  existing gate once validation raises the error.
- `brownlow_votes` falls under the same rule: an absent or blank column no longer clears the stored
  mirror. Whether this dataset should write that column at all remains ISSUE-155's recorded decision
  and is not reopened here.
- Required columns and their existing validation are unchanged.

Two points to settle at implementation, neither a contradiction of the decision:

- `jumper_number` is free text, not a number, so "malformed" has no meaning for it. Absent and blank
  preserve; any supplied text applies.
- For `match_results`, preserving `attendance` must preserve `attendance_status` with it. The two are
  coupled by a database constraint that this review did not read.

## 16. Next action

1. ~~Operator: run the §17.9 runner.~~ **Done 2026-10-04, PASS** (§17.10 run 4).
2. Operator: review and commit (§17.8, §17.11). Do not stage the stray empty untracked file `value`
   (§17.11). `merge:ready` follows the commit.
3. Operator: deploy to DEV and run DEV acceptance (§14): one staged file through the review page.
   R-258-1 (§17.7) applies from the moment of deployment.
4. F-258-I1 is decided: AFLDB-ISSUE-264 owns it. Nothing further here.

## 17. Implementation (2026-10-03)

### 17.1 Start state

- Worktree `D:\dev\afldb-issue-258`, branch `issue/258-legacy-csv-null-preservation`, HEAD
  `14c289e8` (= `main`). The tree was clean. No earlier ISSUE-258 commit, stash or file existed, so
  there was nothing to preserve.
- The worktree had no `node_modules`. A junction to `D:\dev\afldb\node_modules` (same lockfile,
  same commit) was created. It is gitignored.
- No sub-agent was spawned. No Git write, no database command, no DEV/PROD contact.

### 17.2 What changed

All in `src/lib/ingest/datasets.ts`:

- **`optionalCountReader`.** A new reader for the optional count columns of the two datasets.
  - An absent column (`undefined`) or a blank cell (`null`) reads as null.
  - Any other text must match `^\d+$` and fit the column: smallint 0–32767; `attendance` (integer)
    0–2147483647; `brownlow_votes` 0–3. Otherwise the column is named in a reason and the row is
    an `error`.
  - Every malformed column is reported at once, before any reference lookup.
  - `toIntOrNull` is unchanged, as are its other callers (`season`, `round_number`, the scores and
    the award datasets).
- **`player_match_stats`.**
  - The 21 statistics, `career_game_no` and `brownlow_votes` go through the reader.
  - `jumper_number` stays free text: absent or blank → null, supplied text applies.
  - The upsert's `ON CONFLICT DO UPDATE` uses `COALESCE(EXCLUDED.x, player_match_stats.x)` for all
    24 optional columns. `club_id` and `import_batch_id` are unchanged.
- **`match_results`.**
  - Goals, behinds and attendance go through the reader. The existing refusal of an attendance of
    exactly 0 is kept.
  - The upsert keeps `home/away_goals` and `home/away_behinds` with `COALESCE`.
  - `attendance` and `attendance_status` move as a pair. Attendance is
    `COALESCE(EXCLUDED.attendance, matches.attendance)`; the status is the stored one when the file
    is silent, and `EXCLUDED.attendance_status` otherwise. This satisfies
    `matches_attendance_status_ck` (migration 020): it requires `complete` ⇔ attendance not null.
  - A new row (INSERT) still stores silent columns as NULL, with `attendance_status = 'not_collected'`.
- **`matchResultsKey`.** The natural-key builder promotion already used, now shared with
  validation. The promoted key is byte-identical.

### 17.3 Settled at implementation (within §15.2–§15.3)

- **I-258-1: what "malformed" means.** It covers a non-digit (`1O`, `n/a`), a fraction (`12.5`), a
  sign (`-3`), an exponent or hex form (`1e2`, `0x10`), and a value beyond the column's range.
  - Before this change, `Number()` accepted `12.0`, `1e2` and `0x10` as integers, and a negative or
    oversize value passed validation and then failed at promotion on a constraint or a smallint
    overflow.
  - The `brownlow_votes` refusal text changed from `must be 0-3` to the reader's shared wording.
- **I-258-2: a kept breakdown must still add up.** `matches_score_components_ck` (migration 022)
  requires goals×6+behinds = score wherever both are recorded. With D-258-2, a file that corrects a
  score but is silent on goals or behinds would keep a stored breakdown that no longer adds up, and
  the promotion would roll back on that constraint even though the report said `ok`.
  - Validation now reads the stored match by its natural key, but only when at least one component
    is blank. It overlays the file's components on the stored ones.
  - Where both components are known and do not add up to the file's score, the row is an `error`
    that names the stored figure and asks for both components.
  - This is not an implicit clear (D-258-3): nothing is cleared. The constraint remains the
    backstop if the stored row changes between validation and promotion.
- **I-258-3: `jumper_number` and attendance.** Settled as §15.3 proposed. The migration 020
  constraint was read: `matches_attendance_status_ck` and `matches_zero_attendance_ck`.

### 17.4 ISSUE-257 compatibility

- `datasets.ts` reads no `player_match_stats` authority: `data_overrides` appears only in the
  `all_australian` refusal. ISSUE-257 named this writer as out of its scope (257 §12; 257 sixth run,
  F-S7-01: an addition owned by this intake makes Return to source refuse, fail closed).
- This change does not touch `source_id`, provenance or ownership. It only stops silent columns from
  being written, so it narrows what the legacy promotion can overwrite. **No conflict with the
  ISSUE-257 code was found.**
- The remaining gap is recorded as F-258-I1 (§17.7). It was not fixed here: §12 places manual
  authority out of scope.

### 17.5 Tests

- **New DB-free suite `tests/ingest-datasets.test.ts`** (26 cases). No DB-free suite for the
  dataset registry existed: `tests/integration/datasets.test.ts` is DB-gated. The validators run
  against a fake `sql` tag that answers each reference lookup by query shape. The suite covers:
  - malformed cells in both datasets, with no query issued;
  - several malformed columns reported together;
  - absent and blank resolving alike to null;
  - valid values applying, including attendance above the smallint range and `jumper_number` text;
  - the supplied-breakdown refusal kept as it was;
  - the I-258-2 stored-breakdown refusal and its acceptance case.
- **Extended `tests/integration/match-results-promotion.test.ts`** with the describe block
  `AFLDB-ISSUE-258 optional columns keep stored figures on re-promotion`. It runs the real
  `validateSubmission()` → approve → `promoteSubmission()` path.
  - **Fixtures.** Synthetic season 2073 (the suite's reservation) in rounds `R258*`. Two current
    clubs are read through `resolveClub` and never written. Two fixture players are created and
    deleted.
  - **Cases.**
    - A match: absent and blank cells keep goals, behinds, attendance and status; a supplied
      attendance moves only that figure.
    - A malformed `match_results` cell is an `error`, its promotion is refused and the row is
      unchanged.
    - The I-258-2 refusal.
    - A new match stores NULL and `not_collected`.
    - A `player_match_stats` file carrying only `goals` keeps the other 23 optional figures.
    - All-blank cells keep everything, while a supplied `jumper_number` text applies.
    - A malformed `kicks` or `marks` cell is refused and the row is unchanged.
    - A new player row stores all 24 optional columns as NULL.
  - **Guards.** Before any write, `beforeAll` refuses unless the auth pool, through which
    `validateSubmission` writes, targets the same `_test` database, host and port as
    `AFLDB_TEST_DATABASE_URL`. `tests/setup.ts` checks only the test and import DSNs.
  - **Baseline and cleanup.** The baseline is a count plus an order-free row hash
    (`sum(hashtext(row::text))`) of every `matches` and `player_match_stats` row outside season
    2073. `afterAll` deletes the fixture rows, asserts that none remain, and asserts the baseline
    is byte-for-byte unchanged. Another writer on `afldb_test` during the run would make this
    assertion fail spuriously.

### 17.6 Validation evidence

| Check | Result |
|---|---|
| `tests/ingest-datasets.test.ts` (DB-free) | **26/26 passed** |
| DB-free suites importing the registry: `ingest-datasets`, `data-overrides-source-contract`, `catalogue-lookups`, `submission-review-actions`, `fitzroy-acquisition`, `honours-lifecycle-public-contract` | 137 passed, **2 failed** in `honours-lifecycle-public-contract` (`src/db/queries/awards.ts` 20≠19 and `grid-solver.ts` 23≠17 lifecycle-filter counts). Neither file is touched by this change, so the failures predate it. |
| `npm run typecheck` (`next typegen && tsc --noEmit`) | **passed** (exit 0), also re-run after the last edit |
| ESLint on the three changed files | **clean** (exit 0) |
| `npm run lint` (whole repository) | exit 1: 253 errors in 39 files, none of them changed here, so they predate this change |
| `npm run build` | **compiled** (22.8 s) and **TypeScript passed**. Page-data collection then stopped at `/sitemap/[__metadata_id__]`: `DATABASE_URL is not set`. The worktree has no `.env`, so this is environmental. Not a full pass. |
| `afldb_test` integration | **Not run.** The worktree has no `.env`, and the session was not given the `afldb_test` DSNs. The command is below. |

*Superseded 2026-10-03 by the runner in §17.9, which adds the target proof, the residue checks,
the fourth DSN (`AFLDB_IMPORT_DATABASE_URL`) and the full build. Kept as the original record.*

*Superseded 2026-10-04: the `afldb_test` integration run and the full build were completed by the
operator, **PASS** (`run-20261004-080549`, §17.10 run 4). The two lines marked "Not run" above and
the build's `DATABASE_URL is not set` stop are historical.*

Operator command (PowerShell, from `D:\dev\afldb-issue-258`). All three DSNs must name the
**`afldb_test`** database. Do not create a `.env` in the worktree.

```powershell
$env:AFLDB_TEST_DATABASE_URL = '<afldb_test owner DSN>'
$env:AFLDB_TEST_IMPORT_DATABASE_URL = '<afldb_test afldb_import DSN>'
$env:AFLDB_AUTH_DATABASE_URL = '<afldb_test auth-role DSN>'
node node_modules/vitest/vitest.mjs run tests/integration/match-results-promotion.test.ts tests/integration/datasets.test.ts tests/integration/submission-promotion.test.ts
Remove-Item Env:AFLDB_TEST_DATABASE_URL, Env:AFLDB_TEST_IMPORT_DATABASE_URL, Env:AFLDB_AUTH_DATABASE_URL
```

Expected: every test passes, including the seven ISSUE-258 cases, and the ISSUE-258 `afterAll` hook
passes, which proves cleanup and an unchanged baseline. The two neighbour suites re-check the
existing `datasets` validator cases and the generic promotion lock. For a full build, re-run
`npm run build` with `DATABASE_URL` set.

### 17.7 Findings

- **F-258-I1 (MED): the legacy intake ignores ISSUE-257 Match Sheet authority. Now owned by
  AFLDB-ISSUE-264** (opened 2026-10-03 by operator decision, after an ownership search found no
  existing owner). Its implementation stays outside this issue. The record as first written:
  - `player_match_stats.promoteRow` does not read `data_overrides`.
  - A file that **supplies** a figure still overwrites a field a Match Sheet correction protects.
  - A file naming a player the Match Sheet removed (`lineup`, `present: false`) re-inserts the row.
  - ISSUE-257 §12 assigned "the legacy CSV intake's writes to `player_match_stats`" to ISSUE-258,
    but §12 here puts manual authority out of scope, so no issue owns it.
  - This change narrows the gap: silent columns no longer write. It does not close it.
  - Not examined: how the next settle treats a protected field this intake overwrote.
  - A candidate fix is a refusal modelled on `all_australian`'s ISSUE-165 D-12 check. It needs an
    operator decision; it was not implemented.
- **F-258-I2 (LOW): a partial file can leave a player row internally inconsistent.**
  - Example: `kicks` and `handballs` supplied, `disposals` kept; or a player's `goals` changed
    against the match score.
  - No canonical constraint couples these columns, and validation never checked them even when all
    were supplied.
  - Before the change, the silent column was NULLed instead.
  - Recorded only.
  - **Review against the kicks/handballs/disposals contract (2026-10-03).** Verdict: **no enforced
    invariant is breached; this is a documented limitation.** Severity stays LOW.
    - *Where the contract is enforced:* the Match Sheet save validator refuses a submitted row whose
      three figures are all present and `disposals ≠ kicks + handballs`
      (`src/lib/match-sheet.ts:181-191`); the authority payload readers require the three to be
      recorded together and consistent (`src/lib/acquisition/match-sheet-authority.ts:474-481`,
      `tools/migration/common.py:1241-1247`). `COUPLED_DISPOSAL_FIELDS`
      (`match-sheet-authority.ts:56-61`) states it in so many words: "enforced by the Match Sheet
      validator and by nothing in the schema".
    - *Where it is not:* `player_match_stats` carries one CHECK, `pms_brownlow_range_ck`
      (migration 004:60); no migration adds a trigger on the table. The only disposals CHECK in the
      schema is on AFLW staging (`saflw_pms_disposals_ck`, migration 025:192). Both settles write
      the source's values unchecked (`settle-afltables.ts:2814-2843`, `settle-afl-api.ts:834-852`).
      `deriveDisposals` (`match-sheet.ts:200-210`) only fills a NULL `disposals`.
    - *Player goals against the match score:* nothing couples them. Migration 022's constraints
      are on `matches` and `match_period_scores` only.
    - *So:* a partial promotion cannot fail on this contract and breaches no constraint. The
      legacy validator never checked it, even when a file supplied all three; before this change a
      file supplying `kicks` and `handballs` NULLed `disposals`, which satisfied the check vacuously.
      The change therefore adds one route to an inconsistent row; it did not create the class.
    - *One concrete consequence:* the Match Sheet editor submits every row of the match
      (`src/app/admin/data-editor/MatchSheetEditor.tsx:395-419`) and the validator checks every
      submitted row, so a row left inconsistent makes that match's sheet refuse to save, naming the
      row, until an administrator corrects the three figures. It fails closed and is recoverable.
    - *Not checked:* whether stored rows already break the relation (settles and reloads never
      enforced it). A read-only count would answer it; not run.
    - *If the operator wants it closed:* require `kicks`, `handballs` and `disposals` to be supplied
      together, and consistent, whenever a file supplies any of them (mirrors
      `COUPLED_DISPOSAL_FIELDS`). It would extend D-258-2 and would refuse a file carrying only one
      of the three, so it needs a decision. Not implemented.
- **F-258-I3 (LOW): pre-deployment submissions carry the old validator's payload.**
  - Promotion applies `reasons.resolved` as stored at validation time and does not re-validate.
  - A legacy submission validated before deployment may hold a malformed cell already NULLed with
    verdict `ok`. After deployment it would promote with preserve semantics: safer than before, but
    the malformed cell would be skipped rather than refused.
  - Mitigation: re-validate any `validated`/`approved`/`failed` legacy submission before promoting
    it. Whether any exists on DEV or PROD was not checked (read-only; needs authorisation).
  - **R-258-1 — deployment requirement (recorded 2026-10-03).** From the moment ISSUE-258 is
    deployed to an environment (DEV, and later PROD), no legacy `match_results` or
    `player_match_stats` submission validated before that deployment may be promoted until it has
    been validated again by the deployed code. The routes, from the pipeline's status rules:
    - `staged`, `validated`, `rejected`: run **Validate** on `/admin/submissions/<id>`
      (`validateSubmission` accepts these, `src/lib/ingest/pipeline.ts:148`), then approve.
    - `approved`: **Reject** (allowed from `approved`, `src/app/admin/submissions/[id]/actions.ts`
      `decideSubmission`), then Validate, then Approve. Validation refuses an `approved` row
      directly.
    - `failed`: can be neither validated nor rejected, only promoted again (`pipeline.ts:274`).
      **Do not re-promote it.** Stage the same file again as a new submission (the duplicate check
      only matches `staged`/`validated` submissions, `pipeline.ts:82`) and leave the old one
      `failed`.
    - Operator check at deployment: list the legacy submissions in `staged`, `validated`,
      `approved` or `failed` for the two datasets (read-only). The count on DEV/PROD is unknown.
    - Carry R-258-1 into the DEV acceptance (§14) and into any PROD deployment note.
- **F-258-I4 (INFO): `round_number` is unchanged.** A malformed `round_number` beside a finals
  code still reads as empty. It is outside the §15.3 boundary.
- Unchanged and not run: §15.1 item 3, the past-damage census.

### 17.8 Files changed

- `src/lib/ingest/datasets.ts`
- `tests/ingest-datasets.test.ts` (new)
- `tests/integration/match-results-promotion.test.ts`
- `tests/integration/datasets.test.ts` (2026-10-04: round codes `R258V`/`R258D` and the
  `expectNoStoredMatch` precondition, §17.10 run 3; omitted from this list until the final diff
  review)
- `issues/open/AFLDB-ISSUE-258.md`, `issues.md`, `IssuesIndex.md`, `CHANGELOG.md`
- 2026-10-03 validation pass: `issues/open/AFLDB-ISSUE-258.md`, `issues.md` (ISSUE-258 entry and
  row; new ISSUE-264 entry and row), `IssuesIndex.md`. No code or test changed. The runner files
  live outside the repository (§17.9).

### 17.9 Operator validation runner (prepared 2026-10-03; runs in §17.10)

The session cannot read the connection settings (the approval classifier denies it), so the
`afldb_test` evidence is operator-run. The runner was written and inspected without reading them.

**Files (outside the repository, not tracked):**
- `D:\tmp\issue258\Invoke-Issue258Validation.ps1` — the runner (Windows PowerShell 5.1 compatible).
- `D:\tmp\issue258\issue258-db-probe.mjs` — its read-only database helper. Every query runs in a
  `READ ONLY` transaction; it loads `postgres` from the worktree.

**What it does, in order. It stops at the first failure.**
1. *Preconditions, no database contact:* the worktree has `package.json`, `node_modules\vitest`
   and `node_modules\postgres`, the three suites exist, and there is **no** worktree `.env`.
2. *Environment isolation:* every `*DATABASE_URL` variable already in the session is saved and
   cleared, so nothing pointing at `afldb_dev` can reach a child process.
3. *Settings:* reads only `AFLDB_TEST_DATABASE_URL` (owner), `AFLDB_IMPORT_DATABASE_URL`,
   `AFLDB_AUTH_DATABASE_URL` and `DATABASE_URL` (app, build only) from `D:\dev\afldb\.env`, and
   prefers `AFLDB_TEST_IMPORT_DATABASE_URL`/`AFLDB_TEST_AUTH_DATABASE_URL` when present. The
   helper's `derive` mode parses each URL (WHATWG `URL`, cross-checked against postgres.js's own
   option parsing, no connection) and replaces only host and port (the required
   `-TunnelHost`/`-TunnelPort`) and the database (`afldb_test`). User, password and query are
   kept; a query parameter that could override the target is refused. It prints key names and
   role names, never values.
4. *Target proof, before any write:* each URL must name `afldb_test` at exactly
   `TunnelHost:TunnelPort`. A live
   read-only session per role must report `current_user` = `session_user` = `afldb_owner`,
   `afldb_import`, `afldb_auth` and (build) `afldb_app`, with `current_database()` = `afldb_test`,
   one server address and no recovery. Any mismatch refuses, and nothing is written.
5. *Baseline:* a count plus an order-free 64-bit row hash (`hashtextextended`) of the historical
   rows in `matches`, `player_match_stats`, `players`, `seasons`, `clubs`, `club_organizations`, `data_overrides`,
   `data_submissions`, `data_submission_rows`, `sources`, `auth_users` and `import_batches`,
   excluding only the suites' fixture rows (season 2073, `AFLDB-ISSUE-175 `/`AFLDB-ISSUE-258 `
   players, the three marker CSV names, the `sports_data_lab` source, the two fixture e-mails). It
   refuses if fixture residue already exists.
6. *Suites, one at a time,* with the four test variables (`AFLDB_TEST_DATABASE_URL`,
   `AFLDB_TEST_IMPORT_DATABASE_URL`, `AFLDB_IMPORT_DATABASE_URL`, `AFLDB_AUTH_DATABASE_URL`):
   `match-results-promotion`, `datasets`, `submission-promotion`, each with `--reporter=verbose
   --hookTimeout=300000 --testTimeout=120000`. After each suite, the fingerprints are compared with
   the baseline and the residue counted.
   - Residue must be 0: season-2073 matches and season row, marker players and their stats rows,
     marker submissions, and `afldb-issue-258-fixture-*` clubs and club organizations.
   - Retained by design and reported only: the two fixture `auth_users` rows, the `sports_data_lab`
     source, and new `import_batches` rows with `tool = 'admin-upload'` for the three datasets
     (append-only, per the suites' comments). Any other new batch is UNEXPLAINED and stops the run.
7. *Build:* `npm run build` with `DATABASE_URL` on `afldb_test` (as `afldb_app` by default;
   `-BuildRole owner` if `afldb_app` cannot connect there), then the same check.
8. *`finally`, always:* restores every touched environment variable to its prior value (or
   removes it) and the console encoding, clears the in-memory secrets, and writes
   `summary.txt`.

**Secret handling.** Values are held in memory and passed to children only through the process
environment, never on a command line or in a file. All child output passes through a redaction
filter (full DSNs, raw and URL-decoded passwords) before it reaches the console or a log.

**Instructions (PowerShell, any directory).** The `55432` tunnel to `afldb_test` must be up, and
nothing else should be writing to `afldb_test` during the run.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\tmp\issue258\Invoke-Issue258Validation.ps1 -TunnelHost 127.0.0.1 -TunnelPort 55432
```

Options: `-BuildRole owner`, `-SkipBuild`, `-EnvFile <path>`, `-WorktreeRoot <path>`. The exit
code is 0 only for a full pass. Evidence: `D:\tmp\issue258\run-<stamp>\` (`summary.txt`, one log per
step, `baseline.json` and one check JSON per step; no secrets).

**Results still required:** the three suites passing (the seven ISSUE-258 cases and the block's own
`afterAll` included), each post-suite check `clean`, the build passing (page data included) and a
`clean` post-build check.

### 17.10 Operator runs

- **`run-20261003-221615` — stopped at target proof, nothing written.** `owner: connect
  ECONNREFUSED 127.0.0.1:5432`. The `.env` URLs keep their own host and port, but `afldb_test` is
  reached through the `55432` tunnel. Fix (runner only): the `-TunnelHost`/`-TunnelPort` rewrite
  and endpoint guard in §17.9 steps 3–4.
- **`run-20261004-060955` — derive and target proof passed with all four roles. Baseline OK.**
  `match-results-promotion` failed (exit 1): 3 passed (ISSUE-185 A–C, D and item 4) and 7 skipped.
  The ISSUE-258 block's `beforeAll` threw *"fixture needs two current club identities that
  resolve for the fixture season"*. The post-suite check was `clean`. Retained by design: 1
  fixture auth user and 2 `admin-upload/match_results` batches (explained). The next run's fresh
  baseline absorbs both and lists them.
  - *Cause:* the fixture looked for a real club with `last_season IS NULL` and
    `first_season <= 2073`, then `resolveClub(name, 2073)`, which requires
    `first_season <= 2073 <= coalesce(last_season, ∞)`. `afldb_test` has no such club. Reference
    load materialises a current club's `last_season` as the dataset's last season
    (`tools/migration/load_reference_data.py:269`), and the legacy importer uses the last season
    played. So no real identity can resolve for 2073.
  - *Fix (test only, resolution unchanged):* the block now creates two fixture identities
    (`afldb-issue-258-fixture-home`/`-away`, each its own `club_organizations` row, span
    2073–2073) in one transaction, with the deferred self-identity FK pattern of
    `match-admin-create.test.ts`. It refuses pre-existing `afldb-issue-258-fixture-*` rows,
    requires `resolveClub(name, 2073)` to return each fixture's own id, and deletes exactly the ids
    it created after the R258 matches and stats. Its `afterAll` asserts zero fixture clubs and
    organizations left. Its whole-table fingerprint now also covers `clubs` and
    `club_organizations`. The helper adds a `club_organizations` fingerprint and
    `fixture_clubs`/`fixture_club_organizations` residue counts.
  - *Checked locally, no database:* `tsc` (`npm run typecheck`), eslint on the file, DB-free
    `tests/ingest-datasets.test.ts` 26/26, `node --check` on the helper. The rerun is
    operator-run, command as in §17.9.
- **`run-20261004-062831` — `match-results-promotion` passed 10/10, all seven ISSUE-258 cases
  and the block's `afterAll` included. Check `clean`.** `datasets` failed 14 passed / 2 failed.
  Check `clean`: zero residue, fixture clubs and organizations included. 14 new
  `admin-upload` batches (10 `match_results`, 4 `player_match_stats`), all explained.
  `submission-promotion` and the build did not run.
  - *Failures:* *"warns rather than errors on an unrecognised venue"* got `error`, expected
    `warning`. *"computes result/winner/margin correctly for a draw"* had `resolved` undefined,
    because the row was refused.
  - *Cause: a fixture assumption, not a validation defect.* Both payloads name 1989, round `1`,
    `1989-04-01`, Carlton v Footscray, with no goals or behinds and scores 80–70 and 80–80.
    That is a real stored match. The sibling `player_match_stats` case *"errors when the named
    club did not play"* passes only because `resolveMatch` finds it uniquely. Under D-258-2/3, a
    row silent on the breakdown keeps the stored goals and behinds. Validation therefore overlays
    them and checks them against the row's score (`datasets.ts`, the stored-figure check after the
    goals/behinds sum). The real breakdown cannot add up to 80 or 70, so the row is correctly
    refused with *"… (the stored figure where the file is blank) do not add up to …"*. Promoting
    it would violate `matches_score_components_ck`. Before ISSUE-258 the check did not exist, so
    these "new match" tests were silently validating a correction of a historical match. No other
    check can refuse these rows. The season and clubs resolve (their own cases pass in the same
    run), the venue only warns, and the scores are well-formed.
  - *Fix (test only, validation unchanged):* both cases now name a match identity no stored match
    has: round codes `R258V`/`R258D` with `round_number` 1, dated `1989-01-01`. A precondition
    (`expectNoStoredMatch`, read through the auth role, which holds `SELECT` on `matches`,
    migration 032) proves no match exists for that season, round and date before validating. No
    row is written. The payloads keep their original shape (silent breakdown, same clubs, venue
    and scores) and every original assertion. The draw case also asserts the verdict is not
    `error`, so a refusal now reports itself directly. The conflicting-correction behaviour stays
    covered with synthetic data by `match-results-promotion`'s *"a new score the kept breakdown
    cannot reach is refused at validation"*.
  - *Checked locally, no database:* eslint on the file, `npm run typecheck`, DB-free
    `tests/ingest-datasets.test.ts` 26/26. The rerun is operator-run, command as in §17.9.
- **`run-20261004-080549` (run 4) — OVERALL: PASS.** Operator-run; evidence in
  `D:\tmp\issue258\run-20261004-080549\` (`summary.txt` and numbered logs). Target proof was
  `127.0.0.1:55432/afldb_test` for all four roles (owner, import, auth, build as `afldb_app`).
  Baseline OK.

  | Step | Result |
  |---|---|
  | `tests/integration/match-results-promotion.test.ts` | exit 0, **10/10**, check clean |
  | `tests/integration/datasets.test.ts` | exit 0, **16/16**, check clean |
  | `tests/integration/submission-promotion.test.ts` | exit 0, **7/7**, check clean |
  | `npm run build` (`DATABASE_URL` → `afldb_test` as `afldb_app`) | exit 0, **1,515/1,515** static pages, check clean |

  - *What "clean" means here* (`04-submission-promotion-check.log`, `05-build-check.log`): zero
    fixture residue for matches, season, players, `player_match_stats`, submissions, clubs and
    `club_organizations`; historical fingerprints equal the baseline.
  - ***The database is NOT byte-identical to its pre-run baseline.** Retained by design or
    append-only, and recorded rather than reverted:*
    - **Fixture auth users: 2** retained (baseline 1, so one more than before this run). By design;
      no cleanup was attempted.
    - **`import_batches` is append-only.** Max id 833 → 851 and 16 new `admin-upload` batches, all
      itemised and "explained" by the check: 10 `match_results`, 2 `player_bio`, 4
      `player_match_stats`. The id span is 18 against 16 itemised batches; the log does not
      account for the other 2 id values (sequence values are consumed by rolled-back inserts, but
      that was not verified here). Earlier runs' batches were absorbed into the baseline.
    - **Retained source:** `sports_data_lab_source` 1 (by design, unchanged).
  - Superseded: the failing record of runs 1–3 above stays as the history of how the fixtures were
    corrected; run 4 is the first complete pass.

### 17.11 Final diff review (2026-10-04)

Read-only Git, explicitly authorised for this step: `git status`, `git diff`, `git diff --check`,
`git log`. Nothing was staged, committed, deployed, or run against DEV/PROD, and no code or test
was changed by this review.

- **`git diff --check`:** exit 0, no whitespace errors. One advisory only: *"in the working copy of
  `tests/integration/match-results-promotion.test.ts`, LF will be replaced by CRLF the next time Git
  touches it"* (Windows `core.autocrlf`; not a content problem, same class as
  `windows-crlf-contract-test`).
- **Changed tracked files (7), 1,021 insertions, 57 deletions:** `CHANGELOG.md`, `IssuesIndex.md`,
  `issues.md`, `issues/open/AFLDB-ISSUE-258.md`, `src/lib/ingest/datasets.ts`,
  `tests/integration/datasets.test.ts`, `tests/integration/match-results-promotion.test.ts`.
  **Untracked:** `tests/ingest-datasets.test.ts` (new, intended) and `value` (see below).
- **`next-env.d.ts`: no change to report.** It is **gitignored** (`git status --ignored` lists
  `!! next-env.d.ts`, `.next/`, `tsconfig.tsbuildinfo`), so it cannot appear in a diff or commit
  whatever the build wrote. Its content is the standard generated form (the two `next` reference
  types plus imports of `.next/types/routes.d.ts` and `.next/types/root-params.d.ts`). It was not
  altered.
- **Source review (`datasets.ts`, read in full diff):** the scope matches §15.2–§15.3. No finding
  that blocks commit.
  - `optionalCountReader` is called before any lookup in both datasets, so every malformed cell is
    reported together; absent and blank both read as `null`.
  - The promotion `COALESCE` lists cover exactly the optional columns; `home_score`/`away_score`
    still overwrite. `attendance_status` follows `attendance` through a `CASE`, so
    `matches_attendance_status_ck` cannot be split.
  - The stored-breakdown overlay uses `matchResultsKey(...)` with the same `home.name`/`away.name`
    that `resolved.home_club_name`/`away_club_name` carry (`datasets.ts` lines ~614, ~655, ~678), so
    validation reads the same row promotion updates.
  - No new migration, no privilege change, no `.env`/DSN content in any changed file.
- **F-258-F1 (INFO): stray empty file `value`** in the worktree root, untracked, zero bytes, not
  part of this change; its origin was not established. Do not stage it. Left in place for the
  operator to delete or explain.
- **F-258-F2 (INFO): §17.8 omitted `tests/integration/datasets.test.ts`.** Corrected above.
- Unchanged and still outstanding: DEV acceptance (§14), R-258-1, the §15.1 item 3 past-damage
  census (not run), and AFLDB-ISSUE-264 (open, not implemented).

## 18. DEV deployment and review-page acceptance (2026-10-04)

### 18.1 Deployment

- **Preflight:** `npm run preflight -- --mode deploy --environment dev --issue 258 --ssh-host dev
  --dsn-env AFLDB_OWNER_DATABASE_URL --expect-database afldb_dev`, run from the primary checkout
  `D:\dev\afldb` on `main` at `e7b57ede` (clean; `main` = `origin/main` = remote `refs/heads/main`).
  READY, 0 blockers: database `afldb_dev` as `afldb_owner`, migration parity 110/110. The DSN's host
  and port were overridden in process memory to the existing `127.0.0.1:55432` tunnel (nothing
  printed, `.env` not copied). A first run from this feature worktree was BLOCKED for
  workstation-only reasons (mode requires `main`, no `.env`, `psql` off PATH); no bypass was used.
- **Recovery copy (before deploy):** `~/afldb-recovery/39a9fed1-IvHo-v-Lq-aKwzFe4i2nN` (copy of the
  serving standalone build, 831M, verified identical). The two earlier copies are untouched.
- **Deploy:** `deploy\sync-dev.ps1 -SkipMigrate -RemoteRef main`, exit 0. DEV `39a9fed1` →
  `e7b57ede`; `npm ci`, `npm run build` (1,516 pages), BUILD_ID `X0BaEweFcLMNQWMvLluhu`; systemd
  respawn `2596012 → 3112739` at 08:47:28 AEDT; health `ok`.
- **Serving proof:** primary 3112739 and 4 workers all in `/system.slice/afldb.service`, cwd
  `…/.next/standalone`, started 08:47:27 (after the build); listener `127.0.0.1:3100` owned by
  3112739; health `ok` on 3100 and 8090; both settle timers active. `db:status`: 0 pending.
- **ISSUE-257 rollback guard** (`issue257-rollback-guard.ts --target dev`), before and after:
  REFUSED, exit 2 (1 `player_match_stats` record, inactive), as expected. Roll forward only.
- **Gaps:** no `x-afldb-build` header is emitted (ISSUE-107 gate off), so the serving build is
  proven by process start/cwd/listener, not by header. The journal shows two
  `Failed to kill control group … Invalid argument` warnings at 08:47:23 from the kill-and-respawn
  restart; the service recovered cleanly.

### 18.2 R-258-1 census (read-only, before deploy)

`data_submissions` on DEV held **no** `match_results` or `player_match_stats` submissions in any
status (only 27 `all_australian`, `validated`, out of scope). Nothing required revalidation. PROD was
not examined and is out of scope.

### 18.3 Acceptance submissions (labelled `ISSUE258-ACCEPT-*`, retained, status `validated`)

Files are in `D:\tmp\issue258\accept\`. All target 2025 round 1 Sydney v Hawthorn (match 16623) and
player Angus Sheldrick (680). None was approved or promoted.

| ID | Dataset | Case | Result |
|---|---|---|---|
| 54 | match_results | optional columns absent | 1 ok, 0 warnings, 0 errors |
| 55 | match_results | optional columns present, blank | 1 ok |
| 56 | match_results | `home_goals=1O`, `away_behinds=12.5`, `attendance=4O310` | 1 error, three column-specific reasons |
| 57 | player_match_stats | only `kicks` | 1 ok |
| 58 | player_match_stats | columns present, blank | 1 ok |
| 59 | player_match_stats | `kicks=6x`, `disposals=9.5`, `brownlow_votes=4` | 1 error, three column-specific reasons |

Blank/absent columns resolve to `null` in the stored payload (54, 55, 57, 58), which is the preserve
signal. Screenshots: `.playwright-mcp/evidence-sub56-…png`, `…sub59-…png` (gitignored).
After the run: `import_batches` since 08:45 = 0; match 16623 and the player row are unchanged
(attendance 40310, kicks 6, handballs 3, disposals 9).

**Correction: the acceptance run did write to the DEV database.** It must not be described as having
made "no database writes". Staging (`upload.staged`) and validation (`submission.validated`) wrote
`data_submissions` and `data_submission_rows` records, and each action wrote an `audit_log` row. What
did not happen is **canonical promotion**: no submission was approved or promoted, no import batch was
created, and no canonical `matches` or `player_match_stats` row changed. The six rejections in §18.6
are further `data_submissions` and `audit_log` writes of the same kind.

### 18.4 Acceptance gaps recorded at the time of the validation-path run

Superseded by the decision in §18.5; kept for the record.

- Promotion-time preservation was not exercised on DEV, by instruction (no approve/promote). It rests
  on the `afldb_test` integration run (§17.10).
- The `Approve` button is rendered on error submissions 56 and 59; the server-side refusal was not
  clicked. Its code and coverage are examined in §18.7.
- Submissions 54, 55, 57 and 58 remained `validated` and promotable by a super admin. Resolved by
  §18.6.

### 18.5 Acceptance decision (2026-10-04)

Accepted on the combined evidence, with the limitation stated:

- **`afldb_test`:** promotion-time preservation and refusal tests passed (§17.10 run 4:
  `match-results-promotion` 10/10, `datasets` 16/16, `submission-promotion` 7/7; build exit 0).
- **DEV `e7b57ede`:** upload and review validation passed for submissions 54–59 (§18.3): absent and
  blank columns validate `ok` and store `null` (the preserve signal); malformed cells validate as
  per-column errors.
- **Limitation, retained: no DEV promotion was performed.** Promotion-time preservation is proven on
  `afldb_test` only, not on DEV. Doing so would have meant approving a file and writing canonical
  rows, which was not authorised.
- Unchanged and still visible: AFLDB-ISSUE-264 (open, unimplemented), F-258-I2, the §15.1 item 3
  past-damage census (not run), R-258-1.

### 18.6 Rejection of the acceptance submissions (2026-10-04)

Authorised by the operator. **Before acting**, each of 54–59 was opened in the DEV review page
(`http://10.0.40.100:8090/admin/submissions/<id>`, signed in as the Super admin) and verified: the
filename carried its `ISSUE258-ACCEPT-*` label, the dataset matched §18.3, and the status was
`validated`. None was approved, promoted or otherwise changed. All six matched, so the step went ahead.

Each was rejected with the page's normal **Reject** button (`decideSubmission`, decision `reject`),
one at a time; every page then showed status `rejected` and the notice "Rejected.":

| ID | Dataset | Label | Rows (clean / error) | Result |
|---|---|---|---|---|
| 59 | player_match_stats | `…-F-…-malformed` | 0 / 1 | `rejected` |
| 58 | player_match_stats | `…-E-…-valid-blank-cells` | 1 / 0 | `rejected` |
| 57 | player_match_stats | `…-D-…-valid-columns-absent` | 1 / 0 | `rejected` |
| 56 | match_results | `…-C-…-malformed` | 0 / 1 | `rejected` |
| 55 | match_results | `…-B-…-valid-blank-cells` | 1 / 0 | `rejected` |
| 54 | match_results | `…-A-…-valid-columns-absent` | 1 / 0 | `rejected` |

Not deleted: the submission records and their rows are retained as evidence.

**Evidence that nothing canonical changed:**

- *Code:* the reject branch of `decideSubmission` (`src/app/admin/submissions/[id]/actions.ts:64-76`)
  is one `UPDATE data_submissions … WHERE status IN ('staged','validated','approved')` plus an
  `audit()` call. It touches no `import_batches`, `matches` or `player_match_stats`. It runs on the
  auth connection; promotion runs on a separate import-role connection (`promoteSubmission`).
- *Application audit trail* (`/admin/audit`, read-only): exactly six new `submission.rejected` events,
  for submission IDs 54–59, at 22:02:55–22:04:15 UTC (2026-10-03), after the `submission.validated`
  events at 21:55 UTC. The audit action filter on DEV lists `submission.rejected`,
  `submission.validated` and `upload.staged` and **no** `submission.approved`, `submission.promoted` or
  `submission.promote_failed`: no approval or promotion has ever been recorded on DEV.
- *Not re-queried this step:* a direct `import_batches` / canonical row count. Under the §9 boundary no
  database command was run, and no admin page lists upload batches (the only readers of
  `import_batches` are the settle reports). The last direct reading remains §18.3 (batches since 08:45
  = 0; match 16623 and the player row unchanged), taken before the rejections. A confirming read-only
  query is offered to the operator in the session report.

### 18.7 Finding F-258-D1 (LOW): Approve is offered on submissions with error rows

**Code inspection (no execution).**

- *The affordance.* `ReviewControls.tsx:35` sets `canDecide = status === 'validated'`, and the Approve
  button renders on that alone. It does not look at the error count, so submissions 56 and 59 (status
  `validated`, 1 error row each) show Approve beside Reject. The page does print "Errors block
  approval. Warnings do not: …" when errors exist, which mitigates it.
- *The server gate is real and atomic.* `decideSubmission` approve (`actions.ts:47-63`) updates only
  `WHERE status = 'validated' AND NOT EXISTS (… r.verdict = 'error' OR r.verdict IS NULL)` and returns
  "Only a validated submission with no error rows can be approved." when nothing updates. The same
  rows are refused again at promotion (`pipeline.ts:296-301`, "Submission contains error rows;
  re-validate and fix the file.") and `ReviewControls`' own comment states the buttons are
  "affordances, not authority". `requireSuperAdmin` guards both.
- *Existing coverage.*
  - Promotion refusal of an error row: `tests/integration/submission-promotion.test.ts:253-267` (DB,
    `afldb_test`; also exercised in the §17.10 run 4 suite).
  - Reject path: `tests/submission-review-actions.test.ts` (two DB-free cases).
  - **The approve gate itself has no test.** No DB-free test pins the `NOT EXISTS` clause or the
    refusal message, and the integration suite does not call `decideSubmission` approve. The gate was
    read, not run, and **was not clicked on DEV** (clicking Approve on 56/59 was out of scope; a
    refusal there would be harmless but is unproven).
- *Verdict.* No data-integrity risk: an error submission cannot be approved or promoted. The defect is
  a misleading control plus an untested gate. ISSUE-258 did not change `ReviewControls.tsx` or
  `actions.ts`, so it is not introduced by this change. ISSUE-258 does turn malformed optional cells
  into error rows, so error submissions are now more likely to reach this screen.
- *Existing issues.* Searched `issues.md` and `IssuesIndex.md` for the Approve control, `ReviewControls`
  and submission-review error-row gating: no issue owns it. ISSUE-186 (retirement) is the nearest
  and covers the whole pipeline, not this control.
- *Disposition.* **Recorded here as a LOW finding only; no new issue number allocated.** It does not
  meet the §5 bar (not a data-integrity or security defect, not an unresolved regression), and the
  pipeline is deprecated. If the operator wants it fixed, the smallest change is to disable Approve
  (or show it as unavailable) when `report.errors > 0`, plus a DB-free test of the approve path. That
  is a decision for the operator, not part of ISSUE-258.

### 18.8 Outstanding PROD promotion notes

PROD has not been touched and is out of scope for this step. When ISSUE-258 is promoted:

- **R-258-1** applies to PROD as to any environment. Before promoting any pre-deployment
  `match_results` / `player_match_stats` submission, re-validate it (`approved` → Reject, Validate,
  Approve; `failed` → stage the file again; `staged`/`validated` → Validate). Census the PROD
  `data_submissions` for such rows first; DEV's was empty (§18.2), PROD's is unknown.
- The §15.1 item 3 past-damage census (did an earlier promotion already blank figures?) was never run
  for DEV or PROD.
- AFLDB-ISSUE-264 was open when this was written (2026-10-04). **Update 2026-10-05:** it is resolved and
  DEV accepted; PROD promotion is outstanding, so PROD will still ignore Match Sheet authority on this
  intake until ISSUE-264 is promoted there.
- DEV promotion-time preservation remains unexercised on DEV (§18.5); it rests on `afldb_test`.
- Recovery builds retained on the DEV host: `~/afldb-recovery/39a9fed1-IvHo-v-Lq-aKwzFe4i2nN` plus the
  two earlier copies (§18.1). Nothing was removed.
