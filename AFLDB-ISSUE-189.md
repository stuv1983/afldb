# AFLDB-ISSUE-189 — Approved Runbook

## Status / objective
- **Status:** Runbook approved 2026-09-15 (planned by Opus 5 High in plan mode). Not implemented.
- **Objective:** a club/team-subject question never answers at player grain, and never answers as a
  metric-less or season-less `club_season` dump. Answer at `club_season` only when the wording
  establishes season semantics; otherwise decline with a stated reason.
- **Recommended implementer:** Sonnet 5 or Fable High, normal mode, fresh session, from worktree
  `opus/issue-189-nl-club-subject-semantics`.
- **Operator decisions recorded 2026-09-15:**
  - **(D1)** Decline unscoped club/team rankings by wins/losses/draws/percentage unless the wording
    explicitly establishes season semantics: a season/year, "in a season", or a season condition
    such as premier/wooden spoon/finals. Never reinterpret an all-time-sounding club/team question
    as a best single season.
  - **(D2)** The club-subject premiership/flags misread found in an ISSUE-188 accepted regression is
    tracked separately as AFLDB-ISSUE-193. It is not fixed under 189, and ISSUE-188 stays closed.

---

## 1. Confirmed root cause (verified against current code, PARSER_VERSION 43)

1. **The subject check only looks at the first word, and runs after text has been stripped.**
   `CLUB_SUBJECT_LEADING = /^(?:teams?|clubs?|sides?)\b\s+\S/` (`vocab.ts:921`) is tested on the
   *mutated* `text` at `parser.ts:2397` (`clubSubjectPresent`). By then:
   - "which club/team …" never matches (the subject word isn't first);
   - `AGG_WORDS` `/(players?|teams?|clubs?) with/ → list` (`vocab.ts:168`) has already stripped
     "teams with" from "teams with 5 premierships" (`extractAggregation` strips its first match,
     `parser.ts:1313-1322`).
   Nothing marks the question as club-subject, so election (`parser.ts:2775`) skips `club_season`.
   The metric falls to `CAREER_STAT_WORDS` (`parser.ts:953`, premierships/flags/wins), so the
   question elects `player_career`. `club`/`team`/`which` are stopwords (`vocab.ts:881,890`), so the
   lost subject costs no confidence.
2. **A `club_season` plan is accepted with no metric and no conditions.**
   "teams with the most premierships": `most` is stripped first, so "teams with …" survives and the
   club-subject check fires. `extractClubSeasonMetric` (`parser.ts:1225`) finds nothing, and the
   consumed career metric is ignored by the `club_season` branch (`parser.ts:2775-2777`).
   `structureOnly` is false, so agg defaults to `max` (`parser.ts:3443`). `validatePlan` only
   rejects metric-null plans for other grains (`plan.ts:1774-1780`). `answerList`
   (`club-season.ts:76-87`) then returns the 25 most recent club seasons.
3. **Club-season rankings are single-season by construction.** `answerRanked` ranks individual
   `club_seasons` rows, and `describeClubSeasonAnswer` labels them `Club (season)`
   (`describe.ts:326-331`). An unscoped "teams with the most wins" therefore answers a best single
   season to what reads as an all-time question. The named-club path (NL-017) already requires
   season wording (`parser.ts:2463`, `seasonWorded`); the club-subject path does not.

## 2. Semantic decision and rationale

**Decision: B where a faithful club grain exists, A (decline by name) everywhere else. No new grain.**

- The only club-grained compilers are `club_season` (per-season rows: wins/losses/draws/percentage,
  plus premier/wooden_spoon/made_finals/missed_finals conditions), `team_match`, `team_streak`,
  `head_to_head` and `achievement_summary`. **No club-lineage totals grain exists** (all-time
  premierships, all-time wins). The typed `parseClubQuestion` (`query-intent.ts:277`) is also
  per-season only. Building one is out of scope.
- **Authoritative club-subject cues** (new `CLUB_SUBJECT_CUE`, evaluated once on `normalised`,
  immediately after `canonicalise`, before any extractor runs):
  - leading: `^(?:the )?(?:teams?|clubs?|sides?)\b\s+\S`
  - interrogative: `\b(?:which|what) (?:teams?|clubs?|sides?)\b`

  Not cues: a bare "clubs"/"teams" elsewhere ("played for the most clubs", "exactly two clubs",
  "most clubs") keeps meaning the `clubs_played` career column. That is the v9 lesson in the
  `CLUB_SUBJECT_LEADING` header.
- **The cue must be computed before extraction.** `extractAggregation` destroys the "teams with"
  cue, and the interrogative form is never leading. Any cue read from mutated `text` depends on
  extractor order, which is the defect itself.
- **Three kinds of subject:**
  - **Club/team subject:** the cue is set and no player is named (`player` unresolved).
  - **Player subject:** a player is named, or the wording is "which player"/"players"/"who" without
    a club cue.
  - **Subject-less:** neither ("most premierships", "exactly three wins against Carlton"). Existing
    behaviour is kept.
- **Legitimate `club_season` shapes:**
  - **(a) Conditions-only list/count:** "teams that won the wooden spoon", "how many teams won the
    wooden spoon".
  - **(b) Ranked metric with season semantics:** at least one of
    - `inOneSeason` ("in a season");
    - a single-year scope (`seasonMin !== undefined && seasonMin === seasonMax`);
    - at least one `clubSeasonConditions` entry ("fewest wins by a premier");
    - the unchanged NL-017 named-club path (`clubFor && seasonWorded`).
- **Refused `club_season` shapes (D1):**
  - **R2:** metric null with no conditions, for any agg kind.
  - **R3:** a ranked metric with no season semantics as defined above. This includes season *ranges*
    on the club-subject path ("which team has the most wins since 2000"), which read as totals over
    a span.
- **"teams with the most X":**
  - X = wins/losses/draws/percentage **plus** season semantics → answered faithfully by `club_season`.
  - X = wins/losses/draws/percentage **without** season semantics → declined (R3).
  - X = premierships/flags/brownlow/games/etc. → declined (R2); no club-lineage totals grain exists.
- **Grains that already answer club/team subjects correctly are untouched:** team_match (including
  having clauses), team_streak, head_to_head, achievement_summary, coach_record and family all
  precede the `club_season` branch in election. The cue changes nothing for them.

## 3. Implementation boundaries
- **Parser, vocab and validatePlan only.** No change to `club-season.ts`, `describe.ts`,
  `team-match.ts` or `query-intent.ts`, and no schema change.
- **`extractHavingClause`'s inputs stay as they are** (`clubSubjectCue` at `parser.ts:2360` keeps
  using `CLUB_SUBJECT_LEADING`). ISSUE-188 stays closed.
- **The NL-017 named-club path (`clubFor && … && seasonWorded`) is unchanged**, including its
  season-range acceptance.
- **Leave ISSUE-191, ISSUE-192 and ISSUE-193 untouched.**

## 4. Ordered changes

**Step 0 — tracking. DONE in the planning session 2026-09-15.**
AFLDB-ISSUE-193 is recorded in `issues.md` (entry plus Open Issues table) and `IssuesIndex.md`.
Open-issue counts in both files are recalculated from the actual open-issues table, never from a
hard-coded old→new number.

**Step 1 — `src/search/nl/vocab.ts`.**
Add an exported `CLUB_SUBJECT_CUE` beside `CLUB_SUBJECT_LEADING` (regex from §2). Its doc comment
must say:
- it is evaluated on the canonicalised question before extraction;
- why a bare non-subject "clubs" is excluded;
- that it is ISSUE-189's authoritative subject cue.

`CLUB_SUBJECT_LEADING` is unchanged.

**Step 2 — `src/search/nl/parser.ts`: compute the cue before any extraction.**
- Import `CLUB_SUBJECT_CUE`.
- Directly after `let text = normalised;` (`~1745`), add
  `const clubSubjectPreCue = CLUB_SUBJECT_CUE.test(normalised);`.

**Step 3 — `parser.ts`: feed it into club-season cueing.**
At `~2397`:
`const clubSubjectPresent = clubSubjectPreCue || CLUB_SUBJECT_LEADING.test(text.trim());`

The OR keeps every existing positive (for example, where a season prefix has been stripped).
`clubSeasonCuePresent` is otherwise unchanged. The `!player` guard at election is unchanged.

**Step 4 — `parser.ts`: refusals by name.**
Put these after grain election **and** after the typed metric-threshold re-routing (`~2961-3117`).
They go **immediately before the ISSUE-187 guard (`~3118`)**, so a club question gets a club reason
rather than the career-condition note. Use the existing
`report.confidence = 1; report.notes.push(…); return { status: 'none', reason: 'unrecognised', report };`
pattern.

- **R2:** `grain === 'club_season' && metric === null && clubSeasonConditionResult.conditions.length === 0`.
  - Note: "AFLDB answers club questions one season at a time (wins, losses, draws, percentage,
    premiers, wooden spoons, finals); it does not total a club's premierships or other records
    across its history."
- **R3:** `grain === 'club_season' && metric !== null && clubSeasonConditionResult.conditions.length === 0 && !inOneSeason && !(seasons.seasonMin !== undefined && seasons.seasonMin === seasons.seasonMax) && !(clubFor && seasonWorded)`.
  - Note: "Club wins, losses, draws and percentage are ranked one season at a time; add \"in a
    season\" or a year to ask for the best single season. AFLDB does not total them across a club's
    history."

Use the variables that are actually in scope. If the season range is held under different names at
that point, use those names, but keep the semantics exactly as written here.

**No separate player-grain refusal is added.** With the pre-cue set and no player named, election
always reaches `club_season` unless an earlier club-grained branch claims the question. A guard
would be unreachable and untestable. The regression matrix asserts the outcome instead.

**Step 5 — `src/search/nl/plan.ts` validatePlan backstop.**

*Invariant:* a `club_season` **ranking** aggregation (`max` / `min` / `top_n`) must never proceed
when it has neither a metric to rank by nor a club-season condition to define a qualifying set.

*Why it exists:* `answerClubSeason` (`club-season.ts:70-74`) silently degrades a metric-less plan to
`answerList`. That returns an arbitrary, unranked slice of the most recent club seasons, presented
under a ranking question. This is the ISSUE-189 P2 dump and the version-9 "most clubs" class.
Step 4's R2 closes the parser path. The backstop keeps the invariant true for any future parser path
or directly constructed plan that reaches the compiler, so the defect cannot silently return.

*Implementation (kept deliberately narrow):* after the metric-null block (`~1774-1780`), add
`raw.grain === 'club_season' && raw.metric === null && raw.clubSeasonConditions.length === 0 && (raw.agg.kind === 'max' || raw.agg.kind === 'min' || raw.agg.kind === 'top_n')`
→ `{ error: 'A club-season ranking needs a statistic to rank by.' }`.

List/count plans are deliberately not refused here: they are not rankings. Existing nl-plan and
integration fixtures build list/count club_season plans with conditions or metrics. Record the
invariant and its reason in a code comment beside the check.

**Step 6 — `plan.ts` version bump.**
Set `PARSER_VERSION = 44` and add a `// v44 -- AFLDB-ISSUE-189: …` comment in the existing style
(`~426-443`).

**Step 7 — tests** (extend existing suites; no new files).
- `tests/nl-parser.test.ts`: add `describe('AFLDB-ISSUE-189: club/team subject election', …)`
  directly after the ISSUE-188 describe (`~579`). Use the existing `plan()`/`parse()` helpers.
  Declines assert `result.status !== 'plan'` and that `report.notes` contains the R2 or R3 wording.
- `tests/nl-plan.test.ts`: add V1-V3 beside the ISSUE-190 describe (`~562-597`) using `basePlan`.

**Step 8 — close-out** (after operator validation passes).
- `issues.md` 189: Resolution (root cause, fix, validation) and remove it from the Open Issues table.
- `IssuesIndex.md`: remove 189. **Recalculate both open-issue counts from the rows actually left in
  the table.**
- `CHANGELOG.md` Unreleased: add an entry.
- ISSUE-188 stays closed.

## 5. Regression matrix

**Decline (status ≠ plan; never a player grain; never a metric-less club_season):**

| # | Question | Rule |
|---|---|---|
| D1 | which club has won the most premierships | R2 |
| D2 | which team has the most wins | R3 |
| D3 | teams with more than 5 premierships | R2 |
| D4 | clubs with 10 flags | R2 |
| D5 | teams with 5 premierships | R2 |
| D6 | teams with the most premierships | R2 |
| D7 | teams with the most wins *(behaviour change: was a season record)* | R3 |
| D8 | which team has the most wins since 2000 | R3 |
| D9 | top 5 teams by percentage | R3 |

**Positive (club grain, new or strengthened):**

| # | Question | Expected |
|---|---|---|
| P1 | which team has the most wins in a season | `club_season`, `wins`, agg max |
| P2 | which club had the most losses in 2017 | `club_season`, `losses`, seasonMin = seasonMax = 2017 |
| P3 | the side with the fewest wins in a season | `club_season`, `wins`, agg min |
| P4 | which clubs won the wooden spoon | `club_season`, metric null, `wooden_spoon` condition |
| P5 | which team has the longest winning streak | `team_streak` |

**Unchanged (existing assertions; must stay green without edits):**
- `nl-parser.test.ts` describe 13 (474-524): teams/clubs "in a season", fewest wins by a premier,
  premiership team, wooden spoon, made/missed finals, the richmond player case.
- ISSUE-188 describe (527-579), **including** "clubs that have won more than 10 premierships" →
  team_match (tracked by ISSUE-193, not changed here).
- First-kick summaries (1022, 1040, 1156, 1172, 1723) and `nl-audit-acceptance.test.ts:431`.
- "most wins" / "most premierships" → player_career (1424, 1442); "richmond most wins in a season"
  (1436).
- `nl-regression-corpus.test.ts` NL-017 (601-620).
- `nl-semantic-mapping.test.ts` club-subject having cases (83, 92, 930-1014).

**New neighbour assertions (player subject kept):**
- N1: which player has the most premierships → `player_career`, `premierships`.
- N2: players who played for the most clubs → `player_career` (no club cue).

**validatePlan (`nl-plan.test.ts`):**
- V1: `club_season`, metric null, agg max, no conditions → error.
- V2: the same with min and with top_n → error.
- V3: `club_season`, metric null, agg list, `[{kind:'premier'}]` → no error.

## 6. Validation gates (operator-run; no DB)
1. `npx vitest run tests/nl-parser.test.ts tests/nl-plan.test.ts tests/nl-semantic-mapping.test.ts tests/nl-regression-corpus.test.ts`
2. `npx tsc --noEmit`
3. Adjacent, run once after gates 1-2 pass:
   `npx vitest run tests/nl-audit-acceptance.test.ts tests/nl-describe.test.ts tests/nl-stress-corpus.test.ts tests/nl-stress-v2.test.ts tests/query-intent.test.ts`

**Database-backed validation is not required:**
- no compiler, SQL, schema or describe code changes;
- every positive row lands on `club_season`/`team_streak` shapes already verified against
  hand-written SQL (`tests/integration/nl-answers-team-club.test.ts:457-510`);
- every other row is a parse-time decline.

No `nl:stress` pass either: there are no which-club/which-team rows under `tools/nl`, and the only
corpus rows (first-kick CSVs) are covered by the parser tests above. DEV smoke after merge is
optional: ask D1, D7, P1.

## 7. Stop conditions / out of scope
- **Stop and report** if an "Unchanged" assertion fails and can only be fixed by editing that test.
  Do not weaken existing coverage.
- **Stop** if P1-P5 require touching election order or the 188 having gate.
- **Stop** if the season-range variable at the refusal point cannot express "single year" without
  new extraction.
- **Out of scope:**
  - a club-lineage totals grain (all-time premierships/wins);
  - changing NL-017's acceptance of season ranges for a named club;
  - the ISSUE-193 premierships-as-wins fix;
  - `describe.ts` wording ("Most wins." not saying "in a season");
  - `parseClubQuestion` typed search;
  - ISSUE-191/192;
  - any change to the inputs of `extractHavingClause`.

## Expected files changed (implementation session)
- `src/search/nl/vocab.ts`, `src/search/nl/parser.ts`, `src/search/nl/plan.ts`
- `tests/nl-parser.test.ts`, `tests/nl-plan.test.ts`
- `issues.md`, `IssuesIndex.md`, `CHANGELOG.md`, `AFLDB-ISSUE-189.md` (execution evidence)

## Exact next action
Start a fresh implementation session (Sonnet 5 or Fable High, normal mode) in this worktree.
Execute Steps 1-8 of this runbook, with the operator running the gates in §6.
