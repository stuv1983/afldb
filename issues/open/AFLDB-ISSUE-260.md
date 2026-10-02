# AFLDB-ISSUE-260 — NL answer explanation prints internal column markers for career conditions

## 0. Status

- **Status:** Open.
- **Opened:** 2026-10-02.
- **Severity:** Low.
- **Area:** NL search, describe/render stage — `src/search/nl/plan.ts` (`describePlan`).
- **Review origin:** `playbooks/issue.md`, finding F-004.
- **Operator decision (2026-10-02, made after the review):** approved for implementation; no further
  decision required (§15).
- Nothing has been implemented.

## 1. Summary

The explanation shown under an NL answer lists the conditions that were applied. For a career
column condition it prints the compiler's SQL marker instead of a readable name, so a public reader
sees lines such as "Condition: c.premierships exactly 0." and "Condition: c.games at least 300."

## 2. Evidence

All references are to `main` at `1c1a4805`.

- `src/search/nl/plan.ts:1003-1024` — `NL_CAREER_COLUMNS` maps each condition column to the SQL
  expression the career compiler uses (`games: 'c.games'`, `premierships: 'c.premierships'`, …).
- `src/search/nl/plan.ts:2719-2725` — `describePlan` builds the label for a column condition as
  `games for <club>` when the column is games and a club is present, and otherwise as
  `NL_CAREER_COLUMNS[cond.column]`.
- `src/search/nl/plan.ts:2726-2727` — an award condition uses `NL_AWARDS[...].label`, a readable
  name. Only the column branch is affected.
- `src/db/queries/nl/answer.ts:237` — the answer carries `explain: describePlan(plan)`.
- `src/components/NlAnswerSection.tsx:62` — each explanation line is rendered as a list item.
- No test asserts the text of a career-condition explanation line.

## 3. Supported execution/data path

parse → plan → validate → compile → PostgreSQL → answer → **describe (wrong label)** → render.

Any `player_career` answer whose plan has a column condition reaches it. "players with 300 games and
no premierships" is the plainest case.

## 4. Expected invariant

The explanation is reader-facing text. It names statistics the way the rest of the page does and
contains no database identifier.

## 5. Actual behaviour

The line contains the table alias and column name.

## 6. First wrong layer / root cause

`describePlan` reuses the compiler's column map as a label source. The map's values are SQL, not
labels.

## 7. Impact

- **Data:** none. Results are unaffected.
- **User-visible:** a database alias in public explanation text on every career-condition answer.
- **Operational:** none.
- **Scope:** the twenty columns of `NL_CAREER_COLUMNS`, in the explanation only.

## 8. Reproduction / witness

DB-free, run during the review with `parseNlQuestion`, `validatePlan` and `describePlan`:

| Question | Explanation lines |
|---|---|
| players with 300 games and no premierships | "Searched career records for every matching player." / "Condition: c.premierships exactly 0." / "Condition: c.games at least 300." |
| most games without a premiership | "Searched for the highest career games." / "Condition: c.premierships exactly 0." / "Ties: every player sharing the value is included." |
| players with at least 3 clubs | "Searched career records for every matching player." / "Condition: c.clubs_played at least 3." |

## 9. Disproof attempts

- Checked whether the explanation is an administrator-only trace: it is rendered by the public
  answer component.
- Checked whether another describer (`src/search/nl/describe.ts`) replaces these lines before
  render: the component renders `answer.explain` as produced.
- Checked for a test pinning the current text as intended: none.

## 10. Existing-issue / historical search

Searched `issues.md`, `IssuesIndex.md` and `CHANGELOG.md` for "Condition: c.", "c.premierships",
"c.games at least", and `tests/` for a pinned "Condition:" string. No match. ISSUE-110 corrected a
different explanation line (a scoped total described as a single match). No issue owns this.

## 11. Scope

- The label of a column condition in `describePlan`.

## 12. Explicitly out of scope

- Whether a club-scoped answer should state that a condition is career-wide (AFLDB-ISSUE-259).
- Any other explanation line.
- Parser, planner and compiler behaviour. `PARSER_VERSION` is unaffected.

## 13. Proposed fix boundary

`describePlan` in `src/search/nl/plan.ts`, using a readable name for each condition column. The
career metric registry already holds a label for most of them.

## 14. Proposed validation

- **DB-free:** a `tests/nl-plan.test.ts` case asserting the explanation of a career-condition plan
  contains no `c.` identifier, for every key of `NL_CAREER_COLUMNS`.
- **DEV acceptance:** one question from §8 in the browser.

## 15. Decisions / unresolved questions

None at the time of the review. Columns with no existing label need wording, which is an
implementation detail.

**Operator decision (2026-10-02, after the review).** Approved for implementation. The public
explanation must use reader-facing labels and must never expose an internal SQL or compiler
identifier such as `c.premierships`, `c.games` or `c.clubs_played`. No parser behaviour change is
intended.

## 16. Next action

Implement in the same focused NL session as AFLDB-ISSUE-259, unless implementation evidence shows
they should be separated. Not started.
