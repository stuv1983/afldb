# AFLDB-ISSUE-259 — NL club-scoped career rankings accept a career condition that is evaluated across the whole career

## 0. Status

- **Status:** Open.
- **Opened:** 2026-10-02.
- **Severity:** Low.
- **Area:** NL search, validate stage — `src/search/nl/plan.ts` (`validatePlan`), with
  `src/db/queries/nl/player-career.ts` as the consumer.
- **Review origin:** `playbooks/issue.md`, finding F-003.
- **Operator decision (2026-10-02, made after the review):** fail closed — decline (§15.2).
- Nothing has been implemented. §1–§14 are the review's record as written before the decision.

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

One focused NL session implementing this issue together with AFLDB-ISSUE-260, unless implementation
evidence shows they should be separated. Not started.
