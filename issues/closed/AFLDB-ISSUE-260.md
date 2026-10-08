# AFLDB-ISSUE-260 — NL answer explanation prints internal column markers for career conditions

## 0. Status

- **Status:** **Resolved (2026-10-08)** — merged and pushed at `7adfb3e8`, deployed to DEV, DEV browser
  acceptance PASSED (§18). This supersedes the open-state wording below, which is preserved as history.
- **Opened:** 2026-10-02.
- **Severity:** Low.
- **Area:** NL search, describe/render stage — `src/search/nl/plan.ts` (`describePlan`).
- **Review origin:** `playbooks/issue.md`, finding F-004.
- **Operator decision (2026-10-02, made after the review):** approved for implementation; no further
  decision required (§15).
- **Implemented in the working tree on 2026-10-08, uncommitted, together with AFLDB-ISSUE-259 (§17).
  Local validation PASSED (operator-run, 2026-10-08; §17.3). Commit, merge and DEV browser acceptance
  pending; the issue stays open until DEV acceptance passes.**

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

Superseded by §17: implemented with AFLDB-ISSUE-259 on 2026-10-08; operator-run local validation
passed (§17.3). Next: the operator commits, merges and deploys to DEV, then the DEV browser acceptance
in §17.3 runs.

## 17. Implementation (2026-10-08) and validation

Nothing was executed in the implementing session (no shell, Git, SQL, tests, build or deployment).

### 17.1 Change

- `src/search/nl/plan.ts`: new `CAREER_COLUMN_LABEL: Record<NlCareerColumn, string>` beside `OP_WORDS`;
  `describePlan` uses it instead of `NL_CAREER_COLUMNS[cond.column]`. Typing it on `NlCareerColumn`
  makes a column added to `NL_CAREER_COLUMNS` without a label a TypeScript error.
- Labels (lower case to match the existing metric-condition lines, "Brownlow" capitalised as a proper
  noun): games, goals, finals, premierships, wins, draws, losses, Brownlow votes, Brownlow medals,
  clubs played, seasons played, debut season, final season, behinds, kicks, handballs, disposals,
  marks, tackles, hitouts. Wording was needed only for the columns the metric registry does not label
  (`clubs_played`, `seasons_played`, `debut_season`, `final_season`, `draws`/`wins`/`losses` as
  lower-case words); the metric registry was not reused because its labels are capitalised metric
  names ("Clubs") and the registry covers fewer columns.
- Unchanged: the operator words and values, "games for <club>" for a club-scoped games condition,
  award-condition labels, every other explanation line, the compiler's `NL_CAREER_COLUMNS` map.
- Example lines: "Condition: premierships exactly 0.", "Condition: games at least 300.", "Condition:
  clubs played at least 3."

### 17.2 Tests added

`tests/nl-plan.test.ts`, describe "career condition labels (AFLDB-ISSUE-260)":
- every key of `NL_CAREER_COLUMNS`: the line matches `Condition: <letters and spaces> at least 7.`
  and contains neither the SQL marker, a `c.` alias, nor an underscore;
- exact lines for representative columns across all five operators (eq, gte, gt, lte, lt);
- two conditions keep one line each in plan order; a ranked plan; a club-scoped games condition and an
  award condition keep their labels.
The existing `/premierships.*exactly 0/` assertion still holds.

### 17.3 Operator validation

**Local validation PASSED (operator-run, 2026-10-08).** The implementing session ran nothing; these
results were reported back by the operator and are recorded as returned. They were run together with
ISSUE-259's files.

```text
npx vitest run tests/nl-plan.test.ts tests/nl-semantic-mapping.test.ts
npm run typecheck
git diff --check
```

| Check | Result |
|---|---|
| `tests/nl-plan.test.ts` (holds the new "career condition labels" describe) | 219 passed |
| `tests/nl-semantic-mapping.test.ts` | 178 passed |
| Combined | 397 passed, zero failures |
| `npm run typecheck` | passed, including Next route type generation |
| `git diff --check` | passed |

The `CAREER_COLUMN_LABEL` completeness check (a column added to `NL_CAREER_COLUMNS` without a label is
a TypeScript error) held under the typecheck.

**Was pending at the time of writing (all completed; DEV browser acceptance is recorded in §18):** operator
commit, merge, and DEV deploy (`deploy/sync-dev.ps1`); then DEV browser acceptance. After the DEV deploy, ask one §8 question (for example "players with 300 games and no
premierships") in the browser and confirm the explanation panel shows no `c.` identifier. The issue
stays open until that passes.

Uncertainty: none beyond wording. The label wording is an implementation detail per §15; the operator
may prefer "career premierships"-style prefixes, which would be a one-line change per label.

## 18. DEV browser acceptance (2026-10-08) — PASSED

Run by the implementing session through the Playwright MCP interactive browser; shared with AFLDB-ISSUE-259
(§18 there, which holds the full deployment narrative). The operator entered the beta key personally at the
gate; the key was not requested, read or recorded. No SSH, deployment, configuration change, restart or
database access was made by this session.

### 18.1 Deployment evidence (operator-reported; not independently re-derived)

- DEV `http://10.0.40.100:8090`; checkout `7adfb3e8`; standalone `BUILD_ID` `1iy-ZuCMeAIY9W77kTRMT`; service
  restarted 2026-10-08 12:56:50 AEDT, MainPID 3896015; `/api/health` HTTP 200.
- **Failed header check, preserved as reported:** `-Issue107Gate` failed with exit 21 because `x-afldb-build` was
  missing (`AFLDB_TRACE_REQUESTS` absent from the primary process environment). **Live header parity was NOT
  verified.** From the browser the header was also absent; the served HTML of `/` contained the `BUILD_ID`
  string once, matching the operator's value. The browser cannot read a git commit.

### 18.2 Result

Question typed into the `/search` box and submitted with Enter, about 13:06 AEDT:
**players with 300 games and no premierships**.

- Returned an answer: heading "33 players match", "Players meeting every condition asked for.", a table of 33
  players (Travis Boak, 387 games, first; Rohan Smith, Sam Newman and Marc Murphy, 300 games, last).
- "How was this calculated?" opened (a `<details>` element, `open = true`) and listed exactly:
  1. Searched career records for every matching player.
  2. **Condition: premierships exactly 0.**
  3. **Condition: games at least 300.**
- Both required lines are present. No `c.games`, `c.premierships` or any `c.<column>` marker appears in the
  explanation or anywhere in the page text (regular expression `\bc\.[a-z_]+` over the explanation and over the
  whole body: no match).
- Console (all, warning level and above, whole session): 0 errors, 0 warnings.

Not part of this acceptance: the correctness of the 33 listed players was not independently checked; the
criterion is the explanation text.

### 18.3 Evidence

`issues/closed/AFLDB-ISSUE-259-260-evidence/q4-260-300-games-no-premierships-explanation-open.png` (full page,
explanation open). The ISSUE-259 screenshots are in the same folder.

### 18.4 Resolution

The explanation uses reader-facing names and no internal SQL marker, on a build observed to be the
operator-reported one. §8, §14 and §17.3 are met without weakening. **Resolved 2026-10-08.** The label wording
remains an implementation detail (§15).
