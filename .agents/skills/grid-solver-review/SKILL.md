---
name: afldb-grid-solver-review-improve
description: Holistically review, test, debug and improve AFLDB Grid Solver across correctness, data semantics, UX, performance, architecture, maintainability, accessibility, board solvability and regression coverage. Sample Gridley boards are regression fixtures, not the scope of the review.
---

# AFLDB Grid Solver — Full Review and Improvement

## Mission

Perform an end-to-end review of AFLDB's Grid Solver as a product and subsystem.

This is **not** a task to fix only the defects visible in supplied screenshots.

The supplied Gridley examples are representative regression fixtures used to expose possible weaknesses. The review must inspect the Grid Solver as a whole, identify additional defects and weak areas, improve the implementation where justified, and leave behind stronger automated coverage.

Review the complete chain:

```text
board input
-> board/category interpretation
-> player/category predicates
-> database queries
-> candidate intersections
-> eligible counts
-> answer validation/selection
-> board solvability
-> server/client state
-> rendering
-> sharing/restoration
-> performance
-> tests
-> maintainability
```

The objective is a Grid Solver that is:

- semantically correct
- data-correct
- deterministic
- robust across supported criteria
- resistant to duplicate/incorrect candidates
- performant
- understandable to users
- maintainable
- well-tested
- safe to expose at its configured access level

Do not overfit fixes to one Gridley board.

---

# Repository operating rules

## Local working tree only

Work only in the current local AFLDB working directory.

Before editing:

1. inspect the repository
2. locate the actual Grid Solver implementation
3. inspect existing tests
4. inspect current local changes
5. identify the relevant call graph

Read-only Git commands are allowed:

```bash
git status
git diff
git log
git show
git branch --show-current
```

Do **not** run Git commands that mutate repository state, including:

```text
git pull
git fetch
git checkout
git switch
git reset
git clean
git rebase
git merge
git commit
git push
git stash
```

Do not overwrite unrelated local changes.

Do not touch migration/import tooling or Python files unless:

1. the investigation proves the defect is in the imported/source data rather than Grid Solver logic, and
2. the user explicitly approves expanding the scope.

Prefer small, proven changes over broad rewrites.

---

# AFLDB context

AFLDB is a Next.js/React/TypeScript application backed by PostgreSQL.

Grid Solver is one of the application's tools.

The active Grid Solver lives at:

```text
/grid-solver
```

Older admin Grid Solver routes may simply redirect to `/grid-solver`.

Do not mistake a redirect page for the real implementation.

Likely areas include, but are not limited to:

```text
src/app/grid-solver
src/components
src/db
src/lib
tests
```

Search for the actual implementation instead of assuming path names.

---

# Core principle

## The Grid Solver's own output is not the oracle

For every important behaviour:

- derive the expected result independently from PostgreSQL where practical
- compare that independent result to Grid Solver behaviour
- distinguish UI wording from backend semantics
- distinguish source-data defects from application defects

Do not conclude that a predicate is correct merely because one returned player happens to be valid.

A query can return the correct sample answer for the wrong reason.

---

# Review scope

The review must cover all of the following areas.

---

# 1. Architecture and implementation map

Before fixing anything, document how Grid Solver currently works.

Trace:

```text
route
-> page/server component
-> client components
-> board state
-> criterion/category definitions
-> query construction
-> database access
-> candidate calculation
-> eligible count calculation
-> player validation
-> board completion logic
-> URL/share-state handling
-> rendering
```

Identify:

- source files
- exported functions/types
- server/client boundaries
- duplicated logic
- category registries
- query helpers
- any caching/revalidation
- any API/route handlers
- any session or permission logic
- tests covering each layer

Produce a short implementation map before editing.

---

# 2. Criterion inventory

Build an inventory of **every criterion/category Grid Solver currently supports**.

For each criterion record:

```text
criterion key
display label
parameters
intended meaning
database tables/views used
predicate/query helper
validation path
eligible-count path
known tests
```

Do not review only the six criteria in the supplied screenshots.

Look for all supported categories, including categories related to:

- clubs
- games played
- debut/last season
- decades/seasons
- single-game statistics
- career statistics
- awards
- Rising Star
- Brownlow
- draft
- teammates
- opponents
- venues
- finals
- premierships
- records
- position/role if supported
- historical club identities
- AFL/AFLW scoping if Grid Solver supports both

If a category exists but is unreachable from the UI, note it.

If the UI exposes a category the backend does not correctly support, note it.

---

# 3. Semantic correctness audit

For every supported criterion, verify that its actual predicate matches its user-facing meaning.

Check particularly for semantic substitutions such as:

```text
played in decade != debuted in decade
played for club != currently belongs to club
Rising Star nominee != Rising Star winner
30+ in a game != career total >= 30
50 games or less != fewer than 50 games
teammate != same club at some unrelated time
finals appearance != match played in a season containing finals
```

For each criterion classify its status:

```text
correct
incorrect
ambiguous
unsupported by available data
label mismatch only
```

Where the intended meaning is ambiguous, establish it from product behaviour, existing tests, source comments or representative Gridley examples rather than guessing.

---

# 4. Boundary-condition audit

Review all comparisons for:

```text
<
<=
>
>=
=
BETWEEN
date/season ranges
decade bounds
NULL behaviour
```

Explicitly test boundary values.

Examples:

### Games played

For `50 games or less`:

```text
49 -> eligible
50 -> eligible
51 -> ineligible
```

### Single-game 30+

```text
29 -> ineligible
30 -> eligible
31 -> eligible
```

### Decade

For `played in the 2020s`:

```text
played in 2019 only -> ineligible
played in 2020 -> eligible
played in 2026 -> eligible
debuted before 2020 but played in 2020s -> eligible
```

Do not let the current season redefine the semantic range of the decade.

---

# 5. PostgreSQL truth verification

For each supported criterion, independently calculate a sample of qualifying player IDs directly from PostgreSQL.

Do not use Grid Solver's own query helper as the oracle.

Preferred method:

```text
criterion A -> independent set of player_ids
criterion B -> independent set of player_ids
expected cell -> A INTERSECT B
```

For each audited intersection compare:

```text
Grid Solver candidate count
independently derived count
Grid Solver sample candidates
independently derived candidates
```

Investigate all mismatches.

Use read-only SQL during investigation.

---

# 6. Intersection logic

Grid Solver is fundamentally an intersection engine.

Review whether row and column criteria combine correctly.

Look for:

- wrong `AND` / `OR` grouping
- predicates accidentally evaluated independently
- predicates incorrectly forced onto the same match
- predicates incorrectly allowed across different matches
- incorrect club/season correlation
- joins that multiply players
- accidental filtering of valid candidates
- conditions applied before aggregation when they belong after it
- conditions applied after aggregation when they belong before it

Important distinction:

Some intersections require two career facts to be independently true.

Other intersections require two conditions to apply to the **same match**.

The implementation must know which is which.

Example:

```text
played for Essendon
AND
30+ disposals in a game
```

may mean:

- player played for Essendon at some point and had a 30+ disposal game anywhere

or:

- player had a 30+ disposal game while playing for Essendon

Do not assume one interpretation globally.

Determine the intended Grid Solver semantics per category/intersection model.

---

# 7. Duplicate-player audit

Review all one-to-many joins.

Common sources:

- player_game rows
- club stints
- awards
- nominations
- draft rows
- match participation
- aliases
- historical identities
- team relationships

Check for:

```text
COUNT(*) where COUNT(DISTINCT player_id) is required
duplicate autocomplete candidates
duplicate eligible counts
duplicate answers
unstable ordering caused by duplicate rows
```

Eligible counts and candidate lists must represent unique players.

---

# 8. NULL and historical data behaviour

AFLDB's historical statistics contain periods where some stats were not recorded.

`NULL` does not mean zero.

Review every Grid Solver stat criterion for unsafe handling such as:

```sql
COALESCE(stat, 0)
```

when absence of recording should mean "unknown/not eligible for that predicate", not zero.

Verify:

- no false low-stat matches
- no false exclusions from unrelated missing values
- era coverage is respected
- categories are disabled or explained if data coverage makes them misleading

---

# 9. Club identity and history

Review club predicates against AFLDB's historical identity model.

Do not use brittle display-name matching.

Verify:

- canonical club IDs
- organisations/renames where applicable
- merged/separate entities according to AFLDB rules
- historical names
- opponent matching
- current-team fields are not incorrectly used for historical criteria

Test clubs with historical naming complexity, not only Essendon.

---

# 10. Player identity

Review all player lookup and relationship predicates.

Check:

- duplicate names
- aliases
- ambiguous names
- punctuation
- initials
- suffixes
- historical players
- player IDs retained across joins
- autocomplete display vs internal ID

A criterion such as:

```text
Teammate of Archie Roberts
```

must resolve to a stable player ID, not just a name string.

---

# 11. Teammate semantics

Treat teammate logic as a dedicated subsystem.

Do not assume the definition.

Investigate plausible definitions:

- appeared in the same senior match for the same club
- shared a club list in an overlapping season
- both played senior football for the same club in overlapping seasons
- another Gridley-specific definition

Use database evidence and representative boards to establish the intended behaviour.

Once established:

- centralise the definition
- add positive and negative tests
- add at least one near-miss case
- prevent accidental broadening/narrowing

---

# 12. Single-game statistics

Audit all `X+ stat in one game` and related criteria.

Verify:

- correct player-game table
- correct stat column
- correct match scope
- correct threshold comparison
- correct competition scope
- no career/season aggregation leakage
- no NULL-as-zero bug
- multiple qualifying matches still produce one player

Where possible test several stats, not only disposals.

---

# 13. Career-stat criteria

If supported, verify career-stat criteria separately from single-game criteria.

Review:

```text
SUM
MAX
AVG
COUNT
career games
career goals
career disposals
career awards
```

Make sure category metadata cannot accidentally route one type through another query strategy.

---

# 14. Season and decade semantics

Audit all categories involving:

```text
debuted in
played in
last played in
between seasons
in the 1990s
in the 2000s
in the 2010s
in the 2020s
```

These are distinct predicates.

Do not implement generic "year range" logic if the underlying fact differs.

Regression requirement:

Find a player who debuted before 2020 but played during the 2020s.

That player must:

```text
qualify: Played in the 2020s
not qualify: Debuted in the 2020s
```

---

# 15. Awards and nominations

Review every award-related criterion.

Verify distinctions such as:

```text
winner
nominee
vote recipient
top-N finish
selected in a team
Hall of Fame inductee
Rising Star nomination
Rising Star winner
Brownlow winner
Brownlow vote recipient
```

Do not substitute one relation for another because they live in nearby tables.

---

# 16. Board solvability

Review how Grid Solver determines whether a board is valid or solved.

For every board:

- calculate all 9 intersection candidate counts
- identify zero-candidate cells
- distinguish unanswered from impossible
- distinguish invalid answer from missing answer
- ensure completion state reflects valid player answers

A cell with:

```text
No answer
0 eligible
```

must not silently count as a solved player square.

If AFLDB intentionally supports impossible boards, prove that from product requirements and make the UI explicit.

For generated boards, strongly prefer generation that guarantees every cell is solvable.

---

# 17. Board-generation review

If AFLDB generates Grid Solver boards, audit the generator.

Review:

- category selection
- parameter selection
- compatibility rules
- solvability checks
- repeated categories
- trivial/easy boards
- impossible boards
- extremely broad intersections
- extremely narrow intersections
- determinism/randomness
- reproducibility
- performance

A generated board should ideally be validated against candidate counts before being presented.

Consider useful constraints such as:

```text
minimum candidate count per cell
maximum candidate count per cell
no duplicate row/column criteria
no semantically redundant pairings
```

Do not add arbitrary limits without evidence; recommend them if appropriate.

---

# 18. Board import/share/URL state

Audit how boards are serialised and restored.

Check:

- query-string preservation
- old admin redirects
- board IDs
- category parameters
- URL encoding
- browser refresh
- copy/share links
- back/forward navigation
- malformed parameters
- unknown/deprecated category keys
- missing player IDs
- stale boards after category changes

Shared boards should load deterministically.

Malformed board state should fail gracefully rather than crash.

---

# 19. Candidate search UX

Review the interaction used to choose a player for a square.

Check:

- autocomplete performance
- result relevance
- duplicate names
- ambiguous names
- keyboard navigation
- loading state
- no-results state
- stale search results
- race conditions
- clearing/changing a selection
- whether ineligible players are filtered or clearly rejected
- mobile behaviour

If the UI says "N possible answers", verify that number uses exactly the same candidate predicate as the selected cell.

---

# 20. Eligible-count correctness

Trace the exact code path used for:

```text
108 eligible
0 eligible
63 possible answers
```

Verify that counts:

- apply both row and column predicates
- use unique players
- use the same predicate as answer validation
- are not stale
- are not computed from a different category interpretation
- are scoped to the correct competition
- remain stable between server and client rendering

One source of truth is preferable.

---

# 21. Answer validation

Review what happens when a user selects or enters a player.

Check:

- valid answer accepted
- invalid answer rejected
- exact identity used
- duplicate names handled
- stale board state handled
- result remains valid after refresh
- result cannot be accepted because of a display-name collision

The backend should validate eligibility, not trust client state alone.

---

# 22. State management

Review Grid Solver state transitions.

Look for:

- stale selected cell
- stale eligible count
- race conditions between searches
- board change while request is in flight
- double submissions
- state lost on navigation
- inconsistent server/client initial state
- hydration issues
- impossible solved-count states

Use React/Next.js patterns already established in AFLDB unless they are the problem.

---

# 23. Error handling

Exercise failure paths:

- database error
- empty candidate set
- malformed board
- unsupported criterion
- missing player
- failed autocomplete request
- aborted request
- slow query
- stale share link
- no access
- unexpected null data

The UI should fail clearly and recoverably.

Do not expose raw SQL, stack traces or secrets.

---

# 24. Access control

Grid Solver access is configurable and the route was moved out of `/admin`.

Review:

- who can reach `/grid-solver`
- whether middleware matches the intended setting
- whether underlying data endpoints enforce the same access model
- whether old admin links redirect correctly
- whether board share links bypass intended access restrictions

Do not redesign permissions unless a defect is found.

---

# 25. Security review

This is not a full security audit, but check Grid Solver-specific risks.

Verify:

- parameterised SQL
- no user-controlled SQL fragments
- category keys are allowlisted
- numeric thresholds validated
- player/club IDs validated
- board state cannot select arbitrary columns/tables
- no sensitive admin-only data leaks through candidate endpoints
- error messages are safe

---

# 26. Performance review

Measure, do not guess.

Test:

- initial board load
- all 9 eligible counts
- player autocomplete
- changing selected cells
- loading a shared board
- repeated requests
- representative broad criteria
- representative narrow criteria

Inspect SQL where useful with:

```sql
EXPLAIN (ANALYZE, BUFFERS)
```

on safe read-only queries.

Look for:

- repeated identical queries
- N+1 patterns
- full scans
- expensive unindexed joins
- duplicate computation of the same candidate sets
- rebuilding all 9 cells unnecessarily
- large result transfer where only counts are required

Do not add indexes or schema migrations without explicit approval.

If an index is clearly needed, report it separately.

---

# 27. Caching and freshness

Review whether Grid Solver uses:

- Next.js caching
- memoisation
- route caching
- fetch caching
- database result caching

Ensure data does not remain stale after relevant database changes.

Avoid introducing caching that changes correctness.

If no caching exists, do not add it unless performance evidence warrants it.

---

# 28. Deterministic ordering

Candidate output should be stable.

Review ordering for:

- autocomplete
- suggested answers
- candidate lists
- ties
- generated boards

Avoid relying on PostgreSQL's implicit row order.

Use an explicit, meaningful deterministic order.

---

# 29. UI wording

After backend semantics are proven correct, review labels for clarity.

Prefer user-facing Gridley language rather than implementation language.

Examples:

```text
Played for club (Essendon)
-> Played for Essendon

X+ of a stat in one game (Disposals, 30)
-> 30+ disposals in a game

Fewer than X career games (50)
-> 50 games or less
```

Do not relabel an incorrect predicate to make it look correct.

Fix semantics first.

---

# 30. Accessibility

Review Grid Solver interaction for basic accessibility.

Check:

- keyboard use
- visible focus
- semantic buttons
- labelled inputs
- table/grid semantics where appropriate
- screen-reader accessible category names
- colour is not the sole status indicator
- status changes are understandable
- modal/popover focus behaviour
- contrast issues

Make targeted fixes where obvious and low-risk.

---

# 31. Responsive/mobile review

Test at least:

- desktop
- common laptop width
- tablet-ish width
- mobile width

Check:

- board remains usable
- row/column headings remain understandable
- candidate search is usable
- no important controls disappear
- no horizontal overflow that blocks gameplay
- counts/status remain visible

Do not redesign the entire page unless necessary.

---

# 32. Code quality and maintainability

Look for structural problems such as:

- criterion logic duplicated across count and validation paths
- stringly typed category names
- large switch statements repeated in multiple files
- UI labels mixed with SQL implementation
- board parsing duplicated
- raw SQL embedded in components
- category parameters not type-safe
- test fixtures coupled to implementation details

Prefer a shared criterion definition model where appropriate, e.g. conceptually:

```text
key
label
parameter schema
candidate predicate/query
validation
display metadata
coverage/compatibility information
```

Do not perform a large refactor without a concrete payoff.

---

# 33. Test-suite review

Inventory existing Grid Solver tests.

Classify coverage:

```text
unit
database/integration
route/server
component
Playwright/e2e
```

Identify high-value gaps.

Prioritise tests that protect semantics and intersections rather than snapshotting presentation.

---

# 34. Required regression tests

At minimum ensure coverage exists for:

## Career game boundary

```text
49 -> eligible
50 -> eligible
51 -> ineligible
```

## Single-game stat boundary

```text
29 -> ineligible
30 -> eligible
31 -> eligible
```

## Played-in-decade semantics

```text
debuted before 2020 + played in 2020s -> eligible
debuted in 2020s -> eligible
last played in 2019 -> ineligible
```

## Teammate

After the intended definition is proven:

```text
known true teammate -> eligible
near miss -> ineligible
```

## Rising Star

```text
known nominee -> eligible
known non-nominee -> ineligible
```

## Deduplication

A player qualifying through several rows must count once.

## Zero-cell handling

An unsatisfiable cell must not count as a solved player square.

## Shared board

A serialised board must restore to equivalent criteria.

## Malformed board

Invalid parameters must fail gracefully.

---

# 35. Representative-board testing

Use multiple boards.

The supplied sample is only Board A.

Create or find additional representative boards covering:

- simple club/history intersections
- decade criteria
- awards
- teammate logic
- single-game stats
- career thresholds
- historical players
- recent players
- broad candidate cells
- narrow candidate cells

The purpose is to expose generic defects.

Do not encode one screenshot's player names as the whole test strategy.

---

# 36. Supplied sample board

Use the attached Gridley board as an initial regression fixture.

## Columns

1. Essendon
2. 30+ disposals in a game
3. Played in the 2020s

## Rows

1. 50 games or less
2. Archie Roberts teammate
3. Rising Star nomination

Visible Gridley top-row examples include:

```text
Essendon x 50 games or less
Fred Anderson

30+ disposals x 50 games or less
Peter Brown

Played in 2020s x 50 games or less
Jed Adams
```

AFLDB currently displays equivalent-looking internal criteria such as:

```text
Played for club (Essendon)
X+ of a stat in one game (Disposals, 30)
Debuted between seasons (2020, 2026)
Fewer than X career games (50)
Teammate of... (Archie Roberts)
Rising Star nominee
```

This sample should trigger investigation of:

- `<=` versus `<`
- played-in-decade versus debuted-in-range
- teammate semantics
- zero-candidate intersections
- solved-cell counting
- UI wording

But these are **examples**, not the boundary of the review.

---

# 37. Independent sample-board matrix

For the supplied sample, independently verify all 9 cells.

Produce:

```text
Row criterion
Column criterion
AFLDB eligible count
Independent PostgreSQL count
Sample candidates
Status
```

Do not stop after the top row.

Investigate every mismatch.

---

# 38. Browser testing

Use Playwright or the repository's established browser-testing method.

Exercise real rendered behaviour.

Capture where useful:

- board load
- category labels
- counts
- candidate search
- answer selection
- invalid answer
- solved-state transitions
- shared URL reload
- browser console errors
- failed requests

Do not use browser output as the sole correctness oracle.

---

# 39. Database testing

Use the configured development/test database safeguards.

Prefer a test database for automated integration tests.

Never run destructive test behaviour against production.

Read-only investigation against development data is acceptable where already established by the project.

---

# 40. Fix strategy

Do not start with a rewrite.

For each issue:

1. reproduce
2. independently prove expected behaviour
3. identify root cause
4. classify severity
5. add a failing regression test
6. make the smallest reasonable fix
7. rerun focused tests
8. rerun wider Grid Solver tests
9. rerun typecheck
10. retest the rendered UI

Refactor only when duplication or architecture is itself causing correctness/maintenance problems.

---

# 41. Severity model

Classify findings.

## Critical

Examples:

- SQL injection
- unauthorised data exposure
- Grid Solver fundamentally cannot validate answers correctly
- broad corruption of many criterion types

## High

Examples:

- common criteria return wrong candidates
- impossible cells treated as solved
- share links restore a different board
- count and validation use different semantics

## Medium

Examples:

- one criterion family is semantically wrong
- duplicate counts
- incorrect boundary handling
- poor failure state
- major performance regression

## Low

Examples:

- misleading label
- minor accessibility defect
- inconsistent ordering
- cosmetic state issue

Do not inflate severity.

---

# 42. Improvement opportunities

In addition to confirmed bugs, identify worthwhile improvements.

Separate them into:

```text
must fix
should fix
nice to have
```

Potential areas include:

- centralised criterion registry
- shared candidate/validation predicate
- compatibility metadata
- board solvability pre-check
- better test fixtures
- deterministic candidate ordering
- clearer category labels
- faster count queries
- better empty/error states
- accessibility

Do not implement speculative improvements unless the benefit is clear and risk is low.

---

# 43. Validation commands

Discover actual scripts from `package.json`.

Do not assume exact names.

Typical validation may include repository equivalents of:

```bash
npm run typecheck
npm test -- <grid solver focused tests>
npm run test:e2e -- <grid solver spec>
```

If Grid Solver lacks meaningful Playwright coverage, add targeted coverage if it fits existing conventions.

Record exact commands and results.

---

# 44. Required deliverable

At the end, provide a structured report.

## A. Overall verdict

One of:

```text
Healthy
Healthy with minor issues
Needs improvement
Significant correctness defects
Unable to complete due to specific blocker
```

Explain why.

## B. Architecture map

Summarise the implementation path and source files.

## C. Criterion audit

For every supported criterion:

```text
Criterion
Meaning
Implementation
Status
Evidence
```

## D. Confirmed defects

For each:

```text
Severity:
Area:
Observed:
Expected:
Evidence:
Root cause:
Files:
Fix:
Tests:
```

## E. Sample-board matrix

Show all 9 cells and independent counts.

## F. Additional issues discovered

List defects not represented by the supplied screenshots.

This section is important.

The task is incomplete if the review only repeats the supplied issues.

## G. Performance findings

Include measured evidence where investigated.

## H. UX/accessibility findings

Separate correctness from presentation.

## I. Improvements made

List only files actually changed.

## J. Tests added/updated

List semantic coverage gained.

## K. Validation

Show exact commands and pass/fail results.

## L. Remaining risks

List anything still uncertain.

## M. Recommended next work

Prioritised:

```text
must fix before launch
should fix soon
later improvement
```

## N. Git state

Confirm:

```text
no commit created
no push performed
local changes left for user review
```

---

# 45. Launch assessment

At completion, state whether any discovered Grid Solver issue should block AFLDB launch.

Use:

```text
Launch blocker: YES / NO / CONDITIONAL
```

Base this on:

- correctness impact
- user visibility
- frequency
- data integrity
- security
- availability of a safe workaround

Do not call something a launch blocker merely because it is imperfect.

---

# Stop conditions

Stop and ask before proceeding if:

- the only correct fix requires modifying migration/import data
- a schema/index migration is required
- Gridley semantics cannot be established from available evidence
- a broad schema redesign is required
- unrelated working-tree changes make edits unsafe
- production data would need to be mutated
- access/security requirements are unclear and a change would broaden exposure

Do not guess around these conditions.
