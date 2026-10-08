# AFLDB-ISSUE-259 — NL club-scoped career rankings accept a career condition that is evaluated across the whole career

## 0. Status

- **Status:** **Resolved (2026-10-08)** — merged and pushed at `7adfb3e8`, deployed to DEV, DEV browser
  acceptance PASSED (§18). This supersedes the open-state wording below, which is preserved as history.
- **Opened:** 2026-10-02.
- **Severity:** Low.
- **Area:** NL search, validate stage — `src/search/nl/plan.ts` (`validatePlan`), with
  `src/db/queries/nl/player-career.ts` as the consumer.
- **Review origin:** `playbooks/issue.md`, finding F-003.
- **Operator decision (2026-10-02, made after the review):** fail closed — decline (§15.2).
- **Implemented in the working tree on 2026-10-08, uncommitted, together with AFLDB-ISSUE-260 (§17).
  Local validation PASSED (operator-run, 2026-10-08; §17.5). Commit, merge and DEV browser acceptance
  pending; the issue stays open until DEV acceptance passes.** §1–§14 are the review's record as
  written before the decision and are unchanged.

## 1. Summary

A career question limited to one club is answered only when its parts can be totalled for that
club. For a question with no ranking ("players with at least 200 games and no premierships for
Collingwood") validation refuses when any condition other than games is present, because the
compiler can only club-scope games.

The same guard does not look at conditions when the question ranks a club-scopable statistic. "Most
games for Collingwood without a premiership" validates, and the answer ranks appearances for
Collingwood among players whose whole-career premiership count is zero. One half of the answer is
club-scoped and the other is not, and the explanation does not say so.

## 2. Evidence

All references are to `main` at `1c1a4805`.

- `src/search/nl/plan.ts:2430-2439` — the guard. `scopedGamesConditions` requires
  `raw.metric === null` and every condition to be on `games`. `scopedRankedMetric` requires only a
  metric that is `games` or carries a statistic key. The plan is refused only when neither holds, so
  a ranked plan is never tested for its conditions.
- `src/db/queries/nl/player-career.ts:84-95` — with a club, the ranked value is club appearances or
  a per-club sum.
- `:107-109` — a `games` condition with a club uses club appearances.
- `:110-111` — any other column condition compares the whole-career column.
- `:113-118` — an award condition counts awards across the whole career.
- `tests/nl-semantic-mapping.test.ts:221-229` — "refuses club-scoped unranked conditions whose scope
  is not fully typed": the unranked form is pinned as a refusal.
- `tests/nl-plan.test.ts:262-270` — pins the metric half of the guard (games accepted, premierships
  refused). No test covers a ranked plan with a non-games condition.

## 3. Supported execution/data path

canonicalise → parse → plan → **validate (accepts)** → compile → PostgreSQL → answer → describe.

"most games for Collingwood without a premiership" parses to grain `player_career`, metric `games`,
`scope.clubFor` Collingwood, `careerConditions: [premierships = 0]`. `validatePlan` returns the
plan. `answerPlayerCareer` ranks club appearances and filters on `c.premierships = 0`.

## 4. Expected invariant

A club-scoped career plan either has every component scoped to the club or declines. ISSUE-215
records the guard's purpose as failing closed "rather than silently answer with a whole-career
total", and the unranked test above pins it.

## 5. Actual behaviour

A ranked, club-scoped career plan is accepted with any column or award condition. The condition is
evaluated on the whole career.

## 6. First wrong layer / root cause

`validatePlan`. The condition test is attached to the unranked branch only
(`raw.metric === null`), so the ranked branch has no condition test at all.

## 7. Impact

- **Data:** none.
- **User-visible:** a mixed-scope answer. For "most games for Carlton with at least 2 brownlow
  medals" a player with one medal at Carlton and one elsewhere qualifies. For "without a
  premiership" the whole-career reading is defensible, which is why this is Low; but the unranked
  form of the same wording declines, so the two forms disagree.
- **Operational:** none.
- **Scope:** `player_career` plans with a club, a ranked club-scopable metric, no career predicate,
  and at least one condition that is not `games`.

## 8. Reproduction / witness

DB-free, run during the review with `parseNlQuestion` and an in-memory club directory, then
`validatePlan`:

| Question | Plan | Validation |
|---|---|---|
| players with at least 200 games and no premierships for Collingwood | metric null; conditions premierships = 0, games ≥ 200 | "This career statistic cannot currently be totalled for one club." |
| most games for Collingwood without a premiership | metric games; condition premierships = 0 | valid |
| most games for Collingwood with no premierships | metric games; condition premierships = 0 | valid |
| most games for Carlton with at least 2 brownlow medals | metric games; condition brownlow_medals ≥ 2 | valid |

The compiled SQL was read, not executed.

## 9. Disproof attempts

- Searched `plan.ts` for any other check on `careerConditions` together with `clubFor`: none.
- Checked the compiler for a per-club path for conditions other than games: none.
- Checked for a test that pins the ranked form as accepted, which would show intent: none.
- Checked whether the parser routes such questions to another grain: it did not for the three
  questions above. Two other wordings tried did not parse to this shape and are not claimed.

## 10. Existing-issue / historical search

Searched `issues.md` and `IssuesIndex.md` for "totalled for one club", "club-scoped",
`careerConditions`, and read the summaries of ISSUE-110, 215 and 256.

- **AFLDB-ISSUE-110** (resolved): scope silently discarded at compile time. Same family, different
  shape.
- **AFLDB-ISSUE-215** (resolved): classified the unranked refusal as a legitimate coverage limit and
  left the guard unchanged. It did not consider a ranked plan.
- **AFLDB-ISSUE-256** (resolved): validated plans that crash. Unrelated mechanism.

No issue owns this defect.

## 11. Scope

- The club-scope guard for `player_career` in `validatePlan`, for ranked plans carrying conditions.
- The tests that pin it.

## 12. Explicitly out of scope

- Building per-club SQL for conditions other than games (the capability ISSUE-215 recorded as a
  future candidate).
- Career predicates with a club, which have their own ownership guard.
- The explanation's condition labels (AFLDB-ISSUE-260).
- Parser vocabulary. `PARSER_VERSION` changes only if parsing changes.

## 13. Proposed fix boundary

The guard at `plan.ts:2430-2439`, and nothing in the compiler unless the operator chooses to answer
and label rather than decline.

## 14. Proposed validation

- **DB-free:** cases in `tests/nl-plan.test.ts` and `tests/nl-semantic-mapping.test.ts` for the
  ranked form with a games condition (still valid) and with a non-games condition (the decided
  outcome).
- **Corpus:** the frozen corpus and the exploratory corpus rerun, to count rows that move from
  answered to declined.
- **DEV acceptance:** the three questions in §8.

## 15. Decisions / unresolved questions

### 15.1 As the review left them

1. Decline a club-scoped ranking that carries a whole-career condition, or answer it and state in
   the explanation that the condition is career-wide?
2. If declining: is "without a premiership" beside a club common enough in real questions that
   declining it is a usability loss? `nl_search_log` would show it. Not queried in this review.

### 15.2 Operator decision (2026-10-02, after the review)

**D-259-1 — Fail closed on mixed club/career scope.** A club-scoped career ranking is declined when
it contains a condition that cannot also be evaluated at club scope. The condition is not silently
reinterpreted as whole-career. The ranked form obeys the same scope-safety principle already applied
to the unranked form.

- "most games for Collingwood without a premiership" must decline under the existing coverage
  limitation, unless and until AFLDB gains explicit per-club compiler support for that condition.
- **This issue must not add that compiler capability.**
- No parser change is intended. `PARSER_VERSION` stays unchanged unless implementation shows that
  parsing itself must change.

Item 2 of §15.1 was not pursued; the decision does not depend on it. `nl_search_log` was not queried.

### 15.3 Acceptance boundary that follows from the decision

- A ranked club-scoped `player_career` plan whose conditions are all on `games` stays valid: the
  compiler does evaluate a games condition at club scope (`player-career.ts:107-109`).
- A ranked club-scoped plan with any other column condition, or any award condition, is refused with
  the existing limitation message.
- Plans with no club, and unranked plans, are unchanged.

One thing to measure in the implementation session, not a contradiction of the decision: whether the
frozen corpus or the exploratory corpus holds rows of this shape that currently expect an answer.
If so they move from answered to declined, and their expectations need the same adjudication earlier
corpus corrections had. The corpora were not searched in this pass.

## 16. Next action

Superseded by §17: implemented with AFLDB-ISSUE-260 on 2026-10-08; operator-run local validation
passed (§17.5). Next: the operator commits, merges and deploys to DEV, then the DEV browser acceptance
in §17.5 runs.

## 17. Implementation (2026-10-08) and validation

Written with the `sonnet/issue-259-260` working tree. Nothing was executed in the implementing
session (no shell, Git, SQL, tests, build or deployment).

### 17.1 Change

- `src/search/nl/plan.ts`, `validatePlan`, the `player_career` + `clubFor` + no-predicate block.
  `onlyScopedGamesConditions` (every condition is `kind: 'column'` on `games`; true for an empty
  list) is now computed once and required by both branches:
  - unranked: `metric === null`, at least one condition, `onlyScopedGamesConditions` (as before);
  - ranked: `metric !== null`, `onlyScopedGamesConditions`, and the existing metric test (`games`, or
    a column metric with a `statKey`).
  Neither holding returns the existing error, "This career statistic cannot currently be totalled for
  one club." The match/season-scope refusal that follows is unchanged.
- Validation (`validatePlan`) changed. Parser, SQL compiler (`player-career.ts`) and `PARSER_VERSION`:
  unchanged. No per-club capability added.

### 17.2 Outcomes (club-scoped `player_career`, no career predicate)

| Plan | Before | After |
|---|---|---|
| ranked, no condition | valid | valid |
| ranked, games condition(s) only | valid | valid |
| ranked, any non-games column condition | valid (mixed scope) | **refused** |
| ranked, any award condition | valid (mixed scope) | **refused** |
| ranked, games + non-games | valid (mixed scope) | **refused** |
| unranked, games conditions only | valid | valid |
| unranked, any non-games / award condition | refused | refused (unchanged) |
| any plan with no club | unchanged | unchanged |

An award-count ranking metric with a club was already refused (no `statKey`).

### 17.3 Corpus measurement (§15.3)

- Searched `tests/` (including `nl-regression-corpus`, `nl-stress-corpus`, `nl-audit-acceptance`,
  `nl-parser`, `integration/nl-*`), `tools/nl/ui-corpus.ts`, `generate-expanded-ui-corpus.mjs`,
  `afldb_nl_mass_generator.py` and both exploratory generators for a ranked club-scoped career plan
  with a non-games condition expecting an answer: **none found.**
- The exploratory generators emit club + conditions only as `career_numeric_binding` template 3
  (unranked list), which was already refused; their ranked templates (2, 4) carry no club.
- Integration tests that pair a club with a games condition (`tests/integration/nl-answers.test.ts`
  and `nl-semantic-mapping.test.ts`) stay valid.
- **Not measured:** the externally authored V1 stress CSV and the corpora the generators produce are
  not in the repository. Rows of the refused shape there, if any, will move from answered to declined;
  their expectations need the earlier-corpus adjudication if a run shows it. **No expectation was
  changed in this session.**

### 17.4 Tests added

- `tests/nl-plan.test.ts`, describe "club-scoped career conditions (AFLDB-ISSUE-259)": ranked refusal
  for a column condition (games metric and a statKey metric), for an award condition, and for a games
  + non-games mix; unranked refusal for the same; retained validity for games-only ranked and unranked
  plans, a ranked plan with no condition, and no-club plans with any condition.
- `tests/nl-semantic-mapping.test.ts`: the three §8 questions parse to the documented ranked shape and
  are refused with the exact message; "most games without a premiership" (no club) stays valid.
- Existing pins unchanged and expected to hold: the unranked refusal in `nl-semantic-mapping`, the
  `premierships` + club refusal in `nl-plan`.

### 17.5 Operator validation

**Local validation PASSED (operator-run, 2026-10-08).** The implementing session ran nothing; these
results were reported back by the operator and are recorded as returned.

```text
npx vitest run tests/nl-plan.test.ts tests/nl-semantic-mapping.test.ts
npm run typecheck
git diff --check
```

| Check | Result |
|---|---|
| `tests/nl-plan.test.ts` | 219 passed |
| `tests/nl-semantic-mapping.test.ts` | 178 passed |
| Combined | 397 passed, zero failures |
| `npm run typecheck` | passed, including Next route type generation |
| `git diff --check` | passed |

The three new `nl-semantic-mapping` cases, written from the §8 record, therefore hold on the parse
shape as well as on the validation.

**Was pending at the time of writing (all completed; DEV browser acceptance is recorded in §18):** operator
commit, merge, and DEV deploy (`deploy/sync-dev.ps1`); then DEV browser acceptance. After the DEV deploy, ask the three §8 questions in the browser and confirm each shows the
coverage-limit message and no answer. If a V1/V2 stress run is made, report the count of rows moving
from answered to declined (§17.3: not measured; the external V1 CSV and generated corpora are not in
the repository). The issue stays open until DEV acceptance passes.

## 18. DEV browser acceptance (2026-10-08) — PASSED

Run by the implementing session through the Playwright MCP interactive browser; shared with AFLDB-ISSUE-260
(§18 there). The operator entered the beta key personally at the gate; the key was not requested, read or
recorded. The cookie banner was declined. No SSH, deployment, configuration change, restart or database access
was made by this session.

### 18.1 Deployment evidence (operator-reported; not independently re-derived)

- DEV URL: `http://10.0.40.100:8090`. Checkout updated to `7adfb3e8` (merged and pushed). Build completed;
  standalone `BUILD_ID` `1iy-ZuCMeAIY9W77kTRMT`.
- Service restarted 2026-10-08 12:56:50 AEDT, MainPID 3896015. A later read-only operator check confirmed the
  same PID and start time, the correct `WorkingDirectory` and `ExecStart`, the revision and the `BUILD_ID`.
  `/api/health` returned HTTP 200 with the healthy payload.
- **Failed header check, preserved as reported:** `-Issue107Gate` failed with exit 21 because `x-afldb-build` was
  missing; `AFLDB_TRACE_REQUESTS` was absent from the primary process environment. **Live header parity was NOT
  verified.**

### 18.2 Build identity observed from the browser

- `/api/health` fetched from the browser: HTTP 200. The `x-afldb-build` response header was **absent** (null),
  consistent with the operator's failed-gate finding; it could not be used.
- The served HTML of `/` contained the string `1iy-ZuCMeAIY9W77kTRMT` (one occurrence), equal to the operator's
  standalone `BUILD_ID`. The endpoint therefore reaches the build the operator reported; no contradiction.
- Limit: the browser cannot read a git commit. That the build corresponds to `7adfb3e8` rests on the operator's
  deployment evidence plus the behaviour below. This is not header parity and is not claimed as such.

### 18.3 Results

Each question was submitted by typing it into the `/search` box and pressing Enter, from a freshly loaded
`/search` page each time (no carry-over of an earlier result). Run between about 13:05 and 13:06 AEDT (snapshot
timestamps 02:05–02:06 UTC).

| # | Question | Observed result | Verdict |
|---|---|---|---|
| 1 | most games for Collingwood without a premiership | Heading "AFLDB can't answer this"; body "This career statistic cannot currently be totalled for one club."; no ranking, table or player shown | PASS |
| 2 | most games for Collingwood with no premierships | Identical: "AFLDB can't answer this" and the exact message; no answer | PASS |
| 3 | most games for Carlton with at least 2 brownlow medals | "AFLDB can't answer this" and the exact message; no ranking or player shown. One extra navigation link rendered under the feedback prompt: "Brownlow winners — Carlton — Winners by season, filtered to this club." (`/brownlow?club=carlton#brownlow-winners`). It is a page suggestion for the typed question, not an answer, and not a result carried over from questions 1 or 2 (Carlton, not Collingwood) | PASS (observation recorded) |

In all three the rendered `main` text was exactly: search box, "AFLDB can't answer this", the message, and the
"Did AFLDB understand this question?" prompt (plus the Carlton link for question 3). No answer table, no stale
Collingwood content.

### 18.4 Browser errors

Playwright console messages (all, warning level and above, whole session): 0 errors, 0 warnings.

### 18.5 Evidence

`issues/closed/AFLDB-ISSUE-259-260-evidence/`:

- `q1-259-collingwood-without-a-premiership.png`
- `q2-259-collingwood-with-no-premierships.png`
- `q3-259-carlton-brownlow-medals.png`
- `q4-260-300-games-no-premierships-explanation-open.png` (ISSUE-260's question)

### 18.6 Resolution

All three acceptance questions show the coverage-limit message and no answer, on a build observed to be the
operator-reported one. The acceptance criteria in §8, §14 and §17.5 are met without weakening. **Resolved
2026-10-08.**

Recorded, not blocking: the external V1 stress CSV and generated corpora were not measured (§17.3), so the count
of rows there that move from answered to declined is unknown; and the `x-afldb-build` header parity on DEV is
unverified (§18.1), which is a deployment-tooling matter outside this issue's scope.
