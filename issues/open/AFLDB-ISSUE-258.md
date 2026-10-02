# AFLDB-ISSUE-258 — Legacy CSV intake blanks existing statistics when an optional column is absent or malformed

## 0. Status

- **Status:** Open.
- **Opened:** 2026-10-02.
- **Severity:** Low.
- **Area:** Legacy file intake / data integrity — `src/lib/ingest/datasets.ts`
  (`player_match_stats` and `match_results` datasets).
- **Review origin:** `playbooks/issue.md`, finding F-002.
- **Operator decision (2026-10-02, made after the review):** fix the two reachable datasets
  (§15.2). Deprecation alone is not the resolution.
- Nothing has been implemented. §1–§14 are the review's record as written before the decision.

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

An implementation session scoped to §15.2 and §15.3. Not started.
