---
name: afldb-grid-solver-review
description: Review, reproduce, verify, debug and locally fix AFLDB Grid Solver behaviour against real Gridley boards, PostgreSQL data and the rendered UI. Use this skill when Grid Solver criteria, eligible counts, candidate answers, board solvability, labels or intersections look wrong.
---

# AFLDB Grid Solver Review

## Purpose

Review the AFLDB Grid Solver end-to-end and determine whether each board criterion, row/column intersection, eligible-player count and returned answer matches the intended Gridley meaning.

The goal is not to make the sample board merely "look right". The goal is to prove that the underlying predicates are semantically correct, that all legitimate candidates are included, that invalid candidates are excluded, and that generated/shared boards remain solvable.

Use the attached Gridley sample board as the first regression case.

## Repository rules

- Work only in the current local AFLDB working directory.
- Inspect the repository before changing anything.
- Do not run `git pull`, `git fetch`, `git checkout`, `git switch`, `git reset`, `git clean`, `git rebase`, `git merge`, `git commit`, `git push`, or any other command that changes Git state.
- `git status`, `git diff`, `git log`, `git show`, `git branch --show-current` and similar read-only Git commands are allowed.
- Do not overwrite unrelated local changes.
- Do not change database migrations or Python import/migration tooling unless the investigation proves they are the actual defect and the user explicitly approves that scope.
- Prefer the smallest local code/test change that fixes a proven defect.
- Never change an answer just to match one screenshot without proving the predicate.

## Known application context

AFLDB is a Next.js/React/TypeScript application backed by PostgreSQL.

The Grid Solver lives at `/grid-solver`. Older `/admin/...` Grid Solver links may redirect there and preserve the query string, so trace the real implementation rather than stopping at a redirect page.

Relevant areas are likely to include:

- `src/app/grid-solver`
- Grid Solver components under `src/components`
- Grid Solver database/query helpers under `src/db` or `src/lib`
- criteria/category definitions
- board serialisation/deserialisation
- candidate/eligibility queries
- tests under `tests`
- Playwright coverage
- any shared player, club, awards, Rising Star or match-stat query helpers

Do not assume those paths are exact. Locate the real call chain first.

## Source-of-truth order

When sources disagree, use this order:

1. The actual Gridley rule/category meaning for the board being reproduced.
2. AFLDB PostgreSQL facts.
3. AFLDB's criterion implementation.
4. Rendered Grid Solver output.
5. Labels/text shown in the UI.

The rendered AFLDB result is evidence to investigate, not a source of truth.

## First regression board

Reproduce the attached Gridley board with these visible criteria:

### Columns

1. Essendon
2. 30+ disposals in a game
3. Played in the 2020s

### Rows

1. 50 games or less
2. Archie Roberts teammate
3. Rising Star nomination

The AFLDB sample currently renders equivalent-looking internal labels such as:

- `Played for club (Essendon)`
- `X+ of a stat in one game (Disposals, 30)`
- `Debuted between seasons (2020, 2026)`
- `Fewer than X career games (50)`
- `Teammate of... (Archie Roberts)`
- `Rising Star nominee`

Treat those labels as a warning sign: some describe different predicates from the Gridley board.

The sample screenshots show Gridley accepting these three top-row players:

- Essendon × 50 games or less: **Fred Anderson**
- 30+ disposals in a game × 50 games or less: **Peter Brown**
- Played in the 2020s × 50 games or less: **Jed Adams**

AFLDB currently returns the same three names, but that does **not** prove the underlying criteria are correct.

The AFLDB sample also reports:

- Archie Roberts teammate × 30+ disposals: `No answer`, `0 eligible`
- Archie Roberts teammate × played in the 2020s: `No answer`, `0 eligible`

Do not accept those zero-result intersections without independently proving them. A Gridley board is expected to have playable intersections; a zero-result cell may indicate incorrect teammate semantics, incorrect decade semantics, an over-restrictive join, identity/date logic, or missing data.

## Critical semantic checks

### 1. "50 games or less"

Expected boundary:

`career_games <= 50`

Do not implement this as:

`career_games < 50`

Explicitly test at least:

- 49 games -> qualifies
- 50 games -> qualifies
- 51 games -> does not qualify

If the backend predicate is correct but the UI says "Fewer than 50", fix the wording too.

### 2. "30+ disposals in a game"

Expected meaning:

The player recorded at least 30 disposals in at least one individual match.

Boundary:

`MAX(single_game_disposals) >= 30`

Test:

- career high 29 -> no
- career high exactly 30 -> yes
- career high >30 -> yes

Do not accidentally:

- sum disposals across matches
- use season totals
- use career totals
- interpret `NULL` historical stats as zero
- exclude a valid player because the stat is absent in unrelated games

### 3. "Played in the 2020s"

This is not the same as "debuted between 2020 and 2026".

Expected meaning:

The player appeared in at least one relevant senior match in a season in the 2020s.

For current AFLDB data in 2026, that normally means an appearance in seasons 2020 through 2026, while the semantic category itself represents the 2020-2029 decade.

Required regression case:

Find at least one player who debuted before 2020 but played in the 2020s.

That player:

- must qualify for `Played in the 2020s`
- must fail `Debuted between 2020 and 2026`

If AFLDB currently uses debut year for this Gridley category, treat it as a confirmed semantic defect.

Do not silently redefine a decade criterion around the current season.

### 4. "Played for Essendon"

Use canonical club identity, not display text matching.

Verify:

- correct club ID/organisation mapping
- historical naming/identity rules
- a player qualifies if they played at least one senior match for Essendon
- no false positives from opponent/team-name string matches

### 5. "Archie Roberts teammate"

Do **not** assume what "teammate" means.

Determine the Gridley definition from the board behaviour and/or application/source evidence, then encode that exact meaning.

Investigate at least these possible interpretations:

- appeared in the same match for the same club
- were on the same club list in overlapping seasons
- both played senior football for the same club during overlapping career periods
- another Gridley-specific relationship rule

Use PostgreSQL to build candidate sets for each plausible definition and determine which one explains the real board.

This criterion is a priority because AFLDB currently reports two zero-candidate intersections on the sample.

Also verify Archie Roberts resolves to one unique player identity.

### 6. "Rising Star nomination"

Verify that this uses actual Rising Star nomination records, not:

- Rising Star winner only
- debut season
- age heuristic
- draft status
- a text/name approximation

Check the database relationship and test known nominees and non-nominees.

## Board solvability

A board generator/solver must not treat `No answer` as a successfully solved square.

For every loaded or generated board:

- compute the full eligible candidate set for all 9 intersections
- flag any intersection with zero eligible candidates
- do not report the board as `9 of 9 squares solved` when a square has no valid player
- distinguish:
  - unanswered
  - valid player answer
  - invalid player answer
  - genuinely unsatisfiable criterion intersection

If the product intentionally supports unsatisfiable boards, prove that from existing product requirements before preserving that behaviour.

## Candidate-set review

For each of the 9 sample intersections, produce the database-derived candidate set or at least:

- eligible count
- first 10 deterministic candidates
- exact predicate used
- SQL/query path
- whether AFLDB and Gridley semantics agree

Do not only test the player AFLDB currently selected.

For every criterion, test:

- positive example
- negative example
- boundary example where applicable
- cross-intersection example

## Eligible-count review

Trace how `N eligible` is calculated.

Verify that the count:

- uses the same predicate as answer validation
- applies both row and column criteria
- deduplicates players
- is not inflated by multiple matches, awards or club rows
- does not exclude candidates due to an accidental `INNER JOIN`
- handles missing stats correctly
- uses the same competition scope as the board

If the UI candidate search shows a different number from the backend cell count, trace both code paths and make them use one source of truth.

## Query review

Inspect generated SQL/query helpers for common failure modes:

- wrong `AND`/`OR` grouping
- inner joins that should be `EXISTS`
- one-to-many joins multiplying player rows
- `COUNT(*)` instead of `COUNT(DISTINCT player_id)`
- comparison off-by-one errors
- season/debut confusion
- player identity/name ambiguity
- current club vs historical club confusion
- award winner vs nominee confusion
- career stat vs single-game stat confusion
- `NULL` coerced to zero
- filters applied before/after aggregation incorrectly
- conditions evaluated against different matches when they must refer to the same match
- conditions forced onto the same match when they only need to be true somewhere in a career

Prefer `EXISTS` predicates where they express the criterion more accurately and avoid duplicate-row side effects.

## UI/label review

After semantic correctness is proven, review presentation.

Prefer Gridley-style user-facing wording over internal predicate names.

Examples:

- `Played for club (Essendon)` -> `Played for Essendon`
- `X+ of a stat in one game (Disposals, 30)` -> `30+ disposals in a game`
- `Debuted between seasons (2020, 2026)` -> `Played in the 2020s` only if the backend predicate is also corrected
- `Fewer than X career games (50)` -> `50 games or less`
- `Teammate of... (Archie Roberts)` -> `Archie Roberts teammate`
- `Rising Star nominee` -> `Rising Star nomination` if that matches the product's category wording

Do not hide a backend semantic mismatch by changing only the label.

## Reproduction workflow

### Phase 1 - map the implementation

1. Find the `/grid-solver` route.
2. Trace:
   - board parsing
   - category definitions
   - criterion normalisation
   - database query creation
   - candidate counting
   - answer selection/validation
   - rendering
3. Identify all tests already covering the feature.
4. Record the exact files involved before editing.

### Phase 2 - reproduce the sample

Use the development server and Playwright if available.

Reproduce the attached board exactly.

Capture:

- URL/query parameters
- board definition
- all 9 criteria/intersections
- eligible counts
- current suggested/selected answers
- whether zero-result cells are considered solved
- browser console errors
- failed requests

Take screenshots only if useful; correctness must be proven from data.

### Phase 3 - verify against PostgreSQL

Use read-only SQL first.

For each criterion, independently calculate qualifying player IDs.

Then calculate each intersection by set intersection or SQL `EXISTS`.

Do not use the Grid Solver's own query as the independent oracle.

Example methodology:

```text
criterion A -> set of player_ids
criterion B -> set of player_ids
expected cell -> A INTERSECT B
```

Compare that independent result with the application's candidate query.

### Phase 4 - classify defects

Classify every issue before fixing it:

- semantic predicate bug
- boundary/off-by-one bug
- player identity bug
- database data gap
- join/aggregation bug
- eligible-count bug
- board solvability bug
- UI label-only bug
- stale test expectation
- unsupported Gridley category

Do not mix unrelated fixes.

### Phase 5 - fix locally

Only after a defect is proven:

1. make the smallest targeted change
2. add a regression test that fails before the fix
3. add boundary tests where relevant
4. rerun focused tests
5. rerun Grid Solver integration/e2e tests
6. rerun typecheck
7. retest the sample board in the rendered UI

Do not commit or push.

## Required tests

At minimum, add/verify tests for:

### Career-games boundary

```text
49 -> eligible
50 -> eligible
51 -> ineligible
```

### Single-game 30+ disposals boundary

```text
29 -> ineligible
30 -> eligible
31+ -> eligible
```

### Played in 2020s semantic distinction

```text
debuted before 2020 + played in 2020s -> eligible
debuted in 2020s -> eligible
last played in 2019 -> ineligible
```

### Teammate semantics

Once the Gridley meaning is established:

```text
known true teammate -> eligible
near-miss/non-teammate -> ineligible
```

Include at least one case that would fail under the previously suspected interpretation.

### Rising Star

```text
known nominee -> eligible
known non-nominee -> ineligible
```

### Intersection count

Verify at least one cell with multiple qualifying relationships does not duplicate the same player.

### Zero-cell handling

A zero-candidate intersection must not be silently represented as a solved player square.

## Commands

Discover the available scripts from `package.json` rather than assuming exact names.

Typical validation should include the repository equivalents of:

```bash
npm run typecheck
npm test -- <focused grid solver tests>
npm run test:e2e -- <grid solver spec>
```

If there is no dedicated Grid Solver Playwright test, add one only if it provides meaningful regression coverage and fits the existing test structure.

Use the configured development/test database safeguards. Never point destructive test code at production data.

## Deliverable

When finished, report:

### 1. Verdict

One of:

- Grid Solver semantics are correct
- Grid Solver has confirmed defects
- Unable to prove correctness because of a specific data/source gap

### 2. Findings

For each finding:

```text
Severity:
Criterion/cell:
Observed:
Expected:
Evidence:
Root cause:
Files:
Fix:
Test:
```

### 3. Sample-board matrix

Provide all 9 intersections:

```text
Row criterion | Column criterion | AFLDB count | independently verified count | status
```

### 4. Changes made

List only files actually edited and why.

### 5. Validation

Show exact commands and pass/fail results.

### 6. Remaining uncertainty

Explicitly list anything not proven.

### 7. Git state

Confirm:

- no commit created
- no push performed
- local changes are ready for user review

## Stop conditions

Stop and ask before proceeding if:

- the only apparent fix requires changing migration/import data
- the database lacks the information needed to reproduce Gridley's rule
- Gridley's teammate semantics cannot be established from available evidence
- fixing the issue would require a broad schema redesign
- unrelated local changes make the target files unsafe to edit

Do not guess around any of those conditions.
