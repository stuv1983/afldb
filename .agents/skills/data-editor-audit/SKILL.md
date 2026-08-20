---
name: afldb-data-editor-debug
description: Review, reproduce, debug, fix, and regression-test AFLDB's admin Data Editor so additions, edits, lineup changes, match-player statistics, derived totals, public pages, records, and database-backed search remain consistent. Use this skill for any issue where data saved through /admin/data-editor is missing, stale, incorrect, only partially updated, or not reflected everywhere it should be.
---

# AFLDB Data Editor Review & Debug Skill

## Mission

Review the AFLDB **Data Editor end to end** and fix defects rather than only patching the visible symptom.

The primary invariant is:

> A successful admin edit must leave every authoritative and derived representation of that fact consistent.

For match-player statistics, this is especially strict. If an administrator adds or changes a player's kick, handball, disposal, mark, tackle, hitout, free, goal, behind, Brownlow vote, lineup participation, or other supported match statistic, the change must be visible in the source match row and in every career, season, match, leaderboard, record, search, or other database-backed surface that is supposed to derive from it.

Do **not** treat a successful form message as proof that the edit is correct.

---

# Repository Safety Rules

Work only in the existing local working directory.

Expected repository when present:

`D:\dev\afldb`

Rules:

1. Inspect the repository before changing code.
2. Do not clone, checkout, switch branches, reset, merge, rebase, commit, push, stash, or otherwise alter Git state.
3. Do not create commits.
4. Leave all changes in the local working tree for the user to review.
5. Do not modify:
   - `D:\dev\afldb\tools\migration`
   - any `*.py` Python file
6. Do not add a Python-based fix, repair script, migration helper, or test harness.
7. Prefer the project's existing TypeScript/Node/PostgreSQL tooling.
8. Never point destructive tests at production.
9. Before running a mutation, identify which database/environment is connected.
10. If the environment cannot be proven to be a development/test environment, restrict work to read-only inspection until a safe target is identified.
11. Any test mutation to existing data must be reversible.
12. Record the original values before changing them.
13. Restore test data after verification and verify that restoration propagated too.

---

# Current Data Editor Surfaces to Review

Start with the actual repository, but likely entry points include:

- `app/admin/data-editor/actions.ts`
- `app/admin/data-editor/EditorForm.tsx`
- `app/admin/data-editor/MatchSheetEditor.tsx`
- `app/admin/data-editor/CreateMatchForm.tsx`
- `app/admin/data-editor/CreatePlayerForm.tsx`
- `app/admin/data-editor/DeleteMatchButton.tsx`
- `app/admin/data-editor/AwardWinnerForm.tsx`
- `app/admin/data-editor/HallOfFameForm.tsx`
- `app/admin/data-editor/HonourTeamForm.tsx`
- `app/admin/data-editor/MatchBrowser.tsx`
- `app/admin/data-editor/PlayerFinder.tsx`
- `app/admin/data-editor/page.tsx`

Then follow their imports into the actual mutation and query layers, especially:

- `db/queries/match-sheet.ts`
- `db/queries/data-edits.ts`
- `db/queries/match-admin.ts`
- `db/queries/matches.ts`
- `db/queries/players.ts`
- `db/queries/awards-admin.ts`
- `lib/match-sheet.ts`
- `lib/edit/spec.ts`
- `lib/match-lineup-editor.ts`

Also trace the public query code that consumes edited data:

- player profile queries
- player match-history queries
- player career totals
- player season totals
- match detail queries
- season pages and leaderboards
- club pages
- records pages
- natural-language search
- exports/API routes if present

The file names above are starting points, not assumptions. Follow the code that actually executes in the current repository.

---

# Core Principle: Find the Source of Truth First

Before changing anything, build a small data-flow map.

For each editable fact determine:

1. Which UI control creates or edits it?
2. Which server action receives it?
3. Which validation layer parses it?
4. Which DB query/function writes it?
5. Which source table/column is authoritative?
6. Which views, materialized views, aggregate tables, cache tables, generated columns, or derived records depend on it?
7. Which application queries read those representations?
8. Which routes are revalidated after the mutation?
9. Which audit rows are created?
10. What happens if any part of the save fails?

Do not guess table names. Inspect the schema and the SQL/TypeScript query layer.

Produce a dependency map such as:

| Fact | Source write | Derived dependencies | Public consumers |
|---|---|---|---|
| player kick in match | discovered source | discovered career/season/record dependencies | match page, player page, season leaders, records, NL search |
| player mark in match | discovered source | discovered aggregates | same relevant consumers |
| lineup membership | discovered source | games/appearances and player-club/season dependencies | match/player/season surfaces |
| official match score | matches/source score columns | ladder/season/club/records dependencies | match, season, club, records |
| player bio | players | search/index/profile dependencies | player pages/search |
| draft pick | draft source | player/draft views | draft/player pages |

---

# Important Existing Business Rule: Player Scores vs Official Team Score

Do not "fix" a correct separation between player scoring totals and the official match score.

The match-sheet editor may intentionally keep:

- player goals/behinds
- official team goals/behinds/points

as separate data.

This matters because team behinds may include rushed behinds that cannot be attributed to a player.

Therefore:

- changing a player's goal must update the player's match/season/career goal totals and all relevant player-based leaderboards/records;
- changing a player's behind must update the player's match/season/career behind totals where those totals are supported;
- do **not** automatically alter the official team score unless the current business rule explicitly requests score synchronisation;
- official match scores should instead be tested through the Match Details editing path;
- if a score-sync option exists, test that separately and deliberately.

Do not silently change this rule just to make totals appear equal.

---

# Statistic Consistency Rules

For every match-player statistic supported by the current schema, identify all expected derived effects.

At minimum review:

- goals
- behinds
- kicks
- handballs
- disposals
- marks
- tackles
- hitouts
- frees for
- frees against
- Brownlow votes
- jumper number
- lineup membership / appearance
- club assignment for the match

Also inspect the schema for additional editable statistics not shown above.

## Kicks and handballs

Where AFLDB's current model treats disposals as:

`disposals = kicks + handballs`

verify all three values stay internally consistent.

A `kicks + 1` test should normally result in:

- match kicks: `+1`
- match disposals: `+1`
- season kicks: `+1`
- season disposals: `+1`
- career kicks: `+1`
- career disposals: `+1`
- relevant leaderboards/records/search results updated

Likewise for `handballs + 1`.

Do not assume the UI's automatic disposal calculation is enough. Verify the submitted payload and persisted database values.

If historical data or the schema permits explicit disposals that differ from kicks + handballs, identify that rule before enforcing an invariant globally.

## Marks

A `marks + 1` test should affect marks only, apart from generic metadata such as updated timestamps/audit rows.

It must not accidentally alter:

- kicks
- handballs
- disposals
- goals
- behinds
- tackles
- hitouts
- team score

## Other counting stats

For tackles, hitouts, frees for, frees against, goals, behinds and any other count:

- the match value must change by exactly the submitted delta;
- season aggregate must change by the same delta;
- career aggregate must change by the same delta;
- unrelated statistics must not change;
- records/leaderboards must react if the new value crosses a ranking threshold.

---

# Add vs Edit vs Remove Must All Work

Do not only test editing an existing non-null value.

Each relevant field needs these state transitions where allowed:

1. `NULL/blank -> number`
2. `number -> larger number`
3. `number -> smaller number`
4. `number -> 0`
5. `0 -> number`
6. `number -> NULL/blank` if nullable
7. same value -> no-op

Verify semantics carefully:

- blank must not silently become zero unless that is the defined schema rule;
- zero must not silently become null;
- nullable historical stats must remain distinguishable from recorded zero where the database model expects that distinction.

---

# Required Match-Sheet Delta Tests

Use a real development match and player whose data can be safely restored.

Record a baseline before every mutation.

Run small, unique deltas so the expected result is unambiguous.

Recommended sequence:

## Test A — kick propagation

Baseline:

- match kicks
- match handballs
- match disposals
- season kicks/disposals
- career kicks/disposals
- relevant record/leaderboard placement

Mutation:

`kicks = baseline + 1`

Expected:

- kicks `+1`
- disposals `+1` when the current model derives disposals from kicks + handballs
- handballs unchanged
- season and career deltas exactly match
- public/API/search surfaces agree

Restore the original kick value and verify every value returns to baseline.

## Test B — handball propagation

Mutation:

`handballs = baseline + 1`

Expected:

- handballs `+1`
- disposals `+1` under the current model
- kicks unchanged
- season and career deltas exactly match

Restore and verify.

## Test C — mark propagation

Mutation:

`marks = baseline + 1`

Expected:

- match marks `+1`
- season marks `+1`
- career marks `+1`
- all unrelated statistics unchanged

Restore and verify.

## Test D — tackle propagation

Repeat the same delta pattern for tackles.

## Test E — hitout propagation

Repeat the same delta pattern for hitouts.

## Test F — frees

Test frees-for and frees-against independently.

## Test G — player scoring

Test goals and behinds independently.

Verify player totals and relevant records update.

Do not require the official match team score to change unless score synchronisation is explicitly enabled by the current feature.

## Test H — Brownlow votes

If Brownlow votes are editable for the selected data source:

- update match votes with a reversible value;
- verify the authoritative Brownlow/season/player total used by the site;
- verify no duplicate or conflicting award source is created;
- restore.

Respect any existing rule that makes a separate Brownlow dataset authoritative.

---

# Required Lineup Tests

Adding or removing a player can be more destructive than changing one number, so test it carefully.

## Add player to match

Use a safe development match.

Verify:

- correct player ID
- correct club ID
- lineup row created exactly once
- no duplicate player in the same match
- jumper number semantics
- entered match stats persist
- match appearance/game count changes if lineup membership represents an appearance
- player season games changes correctly
- player career games changes correctly
- club/season membership or appearance-derived data changes if applicable
- public match page lists the player
- player match-history page lists the match
- player profile totals include the match
- search/records see the new data where relevant

Then remove/restore the test player and verify the original state returns.

## Remove player from match

Verify:

- match-player data is removed or deactivated according to schema design
- derived career and season totals decrease by the removed row's values
- appearance/game counts decrease correctly
- no orphaned stat row remains
- no orphaned Brownlow/audit/link record remains unless intentionally historical
- public pages no longer show the removed match-player relation
- re-adding restores the expected state without duplication

## Move/replace lineup player

If the UI supports vacancy replacement or recent-lineup loading:

- make sure replaced players are tracked correctly;
- removed player IDs must not accidentally delete a re-added player;
- player order/jumper details must not cause duplicate source rows;
- stats from the previous player must not leak to the replacement player;
- copying a recent lineup must not copy previous-match stats into the new match.

---

# Match Editing Tests

Review the generic Match Details editor separately from the Match Sheet.

Test:

- season
- round type
- round number
- date
- venue
- home club
- away club
- home goals
- home behinds
- home total score
- away goals
- away behinds
- away total score
- quarter scores
- attendance
- event/final metadata
- notes or other currently editable fields

For score edits verify any dependent data used by the application, including where applicable:

- win/loss/draw result
- winning margin
- ladder calculations
- club records
- season records
- match records
- biggest wins/losses
- highest/lowest scores
- finals records
- venue records
- natural-language search answers

If those values are calculated directly from the match row, verify the query reads the updated source.

If they are materialised, verify the materialisation is refreshed transactionally or immediately enough to keep the site consistent.

---

# Create Match Tests

Test creating a development match with deliberately recognisable values.

Verify:

- exactly one match row exists
- home and away clubs are correct
- round/date/venue are correct
- team score components are correct
- total points satisfy `goals * 6 + behinds` where values are supplied
- quarter data is stored correctly
- no duplicate match is created after refresh/retry
- admin audit is written
- the new match appears in the admin browser
- the new match appears in public match/season/club queries where it should
- the new match can immediately accept a lineup and player stats

After testing, delete the test match through the supported Data Editor path and verify cleanup.

---

# Delete Match Tests

Use only a reversible development/test match or a match specifically created for testing.

Before deletion capture:

- match ID
- both teams
- season
- player IDs
- every player stat on the match
- season/career totals for at least two affected players
- any Brownlow rows
- relevant record/leaderboard values

After deletion verify:

- match row removed
- match-player rows removed
- dependent rows removed according to FK/cascade/business rules
- affected player season totals decrease correctly
- affected player career totals decrease correctly
- game/appearance counts decrease correctly
- records/leaderboards no longer include deleted values
- match is absent from public pages/search
- audit/history behaviour matches the application's intended retention model

Do not delete a real historical match merely to prove this path.

---

# Player Creation & Player Editing Tests

For a safely removable or clearly synthetic development player, verify:

## Create

- player row created exactly once
- display name and names persist
- DOB/confidence persist
- height/weight persist
- notes persist
- optional draft data links to the same player
- player search can find the new player
- player profile loads
- admin editor can reopen the player

## Edit

Change one field at a time and verify:

- source row changes
- search/index/profile values update
- coupled fields save together where designed
- no unrelated fields are reset because they were omitted from a group form
- null/blank semantics remain correct
- audit row contains the actual old/new values

---

# Awards, Hall of Fame & Honour Team Tests

Review addition flows for:

- award winner
- Hall of Fame inductee
- honour / representative team member

Verify:

- selected player ID links to the intended player
- season/team/category fields persist
- no duplicate logical row is created on retry
- linked player profile reflects the addition where the site displays it
- award/team pages reflect it where applicable
- authoritative datasets are not bypassed

Respect existing exclusions. For example, if Brownlow winners are intentionally sourced from a separate authoritative season-votes dataset, do not create a second conflicting source through a generic award form.

---

# Database Verification Is Mandatory

For every bug reproduction and every fix, compare:

1. UI state before save
2. submitted payload
3. source DB row after save
4. derived DB values after save
5. public query result after save
6. browser-rendered output after save

A bug is not closed if only one layer is correct.

Use the project's existing PostgreSQL access method.

Prefer direct SQL inspection using the existing connection/configuration already used by the app.

Do not introduce Python.

---

# Discover Derived Data Instead of Assuming It

Search the repository for all references to the changed source column and table.

For a field such as `kicks`, inspect:

- INSERT/UPDATE statements
- aggregation SQL
- CTEs
- views
- materialized views
- refresh functions
- triggers
- generated columns
- career summary queries
- season summary queries
- record queries
- NL-search SQL builders
- cached/precomputed tables
- API/CSV query code
- tests/fixtures

Then determine whether derived values are:

### Query-time derived

No database rebuild may be necessary. The bug may instead be:

- stale page cache
- wrong join
- wrong filter
- incorrect aggregate
- duplicate row
- missing row
- query using the wrong table

### Stored/materialised

A mutation must update or refresh the affected derived data.

The correct fix should generally update only the affected:

- match
- player(s)
- club(s)
- season(s)

Avoid rebuilding the entire database after a single match stat unless architecture truly requires it.

---

# Transactionality Requirements

Inspect the mutation transaction.

For a match-sheet save, the desired behaviour is generally:

1. validate complete payload
2. lock/read the current affected rows as needed
3. determine changed/added/removed players
4. update source match-player rows
5. remove intended rows
6. update any required derived state
7. update score only if explicitly requested
8. write the data-edit audit/history required by the application's data model
9. commit

If a required core step fails, the core data mutation should not be left half-applied.

Audit/logging policy may intentionally allow a data mutation to survive a secondary activity-log failure. Preserve existing product policy unless it is itself the defect under investigation.

Test failure paths where practical.

---

# Concurrency & Idempotency Checks

Check for double-submit and repeated saves.

Verify:

- clicking Save twice does not duplicate a match-player row;
- resubmitting the exact same payload is a no-op or idempotent update;
- removed players are not repeatedly deleted in a way that throws;
- a player cannot appear twice in one match;
- two browser tabs cannot silently overwrite unrelated stat changes without detection if the app has a concurrency mechanism;
- if there is no concurrency protection, document the risk rather than inventing a complex solution unless it causes the reported defect.

---

# Validation Checks

Inspect server-side validation, not just input attributes.

Reject or correctly handle:

- negative stats
- non-integers for count stats
- NaN
- Infinity
- unreasonably large values
- invalid player IDs
- wrong-club player IDs
- duplicate players
- player belonging to neither match club
- invalid Brownlow vote values
- malformed payload JSON
- invalid match IDs
- duplicate removed-player IDs
- same player in active players and removed players
- impossible match clubs
- invalid score arithmetic
- blank vs zero vs null

Client-side controls are not a security or integrity boundary.

---

# UI and Cache Verification

The current feature uses Next.js server actions and route revalidation.

After a successful DB save, test a hard reload and normal navigation for all relevant surfaces.

At minimum for match-player edits check:

- `/admin/data-editor`
- match-sheet editor reopen
- `/matches/{id}`
- player's profile
- player's match-history page
- season page
- club page if it surfaces the statistic
- relevant records page
- NL search if it queries the edited statistic

Verify the user does not need an application restart or manual database rebuild to see a normal one-row edit.

If the DB is correct but the UI is stale, trace:

- `revalidatePath`
- `revalidateTag`
- cached query functions
- `unstable_cache`
- route segment caching
- client state after server action
- redirects/navigation
- materialized DB state

Do not add broad cache invalidation unless narrower invalidation cannot keep the feature correct.

---

# Natural-Language Search Verification

Because AFLDB's NL search is database-backed, a successful edit may change search answers.

For an edited statistic, run deterministic questions that should include the changed row.

Examples:

- `most kicks [Player] [Season]`
- `most marks [Player] [Season]`
- `most disposals [Club] [Season]`
- `most hitouts [Club] v [Opponent]`
- record/superlative questions that the test value is designed to cross

Do not use an artificially enormous value in real historical data merely to force a record.

Prefer a controlled development/test match or compare exact player/match filters.

If NL search remains stale while public SQL queries are correct, identify whether it reads:

- a different table
- a cached dataset
- a precomputed index
- a derived aggregate that was not refreshed

Fix the shared data contract where possible instead of special-casing NL search.

---

# Audit Verification

Every Data Editor mutation that is meant to be audited must be checked.

Verify:

- correct entity/table
- correct row ID
- correct field group/action
- old values are accurate
- new values are accurate
- admin user is accurate
- note is retained
- no audit row is created for a true no-op unless product policy calls for it
- a mutation is not duplicated because the UI retried after an audit warning

Do not let an audit warning encourage a user to resubmit a mutation that already succeeded.

---

# Root-Cause Debug Order

When an edit is not reflected everywhere, debug in this order:

1. **UI state**
   - Was the intended value present before submit?

2. **Payload**
   - Was the intended field serialised?
   - Was it `null`, `0`, or the intended number?

3. **Server validation**
   - Did parsing change the value?

4. **Source DB write**
   - Did the authoritative row actually update?

5. **Transaction**
   - Did a later failure partially roll back or partially commit?

6. **Derived DB state**
   - Did career/season/materialised totals update?

7. **Consumer query**
   - Is the page/search reading the correct source?

8. **Cache**
   - Is the database correct but the route stale?

9. **Presentation**
   - Is formatting hiding the new value?

Do not start by adding more `revalidatePath()` calls before proving the database is correct.

---

# Fix Strategy

Prefer fixes in the lowest correct shared layer.

Examples:

- payload bug -> fix editor serialisation
- validation bug -> fix shared payload validator
- source write bug -> fix DB mutation query
- stale derived totals -> fix transaction/recalculation dependency
- multiple public surfaces wrong -> fix shared query/aggregate, not each page
- only one route stale -> fix that route's caching/invalidation
- duplicate data -> fix uniqueness/idempotency at DB/query layer where appropriate

Avoid:

- page-specific compensating arithmetic
- hard-coded player/match IDs
- one-off data repair code left in production paths
- full-database rebuilds after every admin edit
- duplicated definitions of career/season totals
- silently coercing null historical stats to zero
- changing unrelated parser/search logic to mask incorrect stored data

---

# Regression Tests to Add

Use the project's existing test framework.

Add focused TypeScript tests near the affected logic.

At minimum cover:

## Match sheet payload

- number serialisation
- null/blank serialisation
- zero serialisation
- kicks/handballs/disposals behaviour
- added player
- removed player
- duplicate player rejection
- invalid club rejection

## DB mutation

Use existing integration/database test infrastructure if available.

Test:

- update one stat
- add match-player row
- remove match-player row
- derived season delta
- derived career delta
- restore/reverse mutation
- no-op save
- transaction rollback on injected failure where supported

## Query regression

Assert the same edited test data is reflected by:

- match-player query
- player career query
- player season query
- relevant records/leaderboard query

If the NL search has an existing deterministic harness, add a regression case there only after the underlying database/query path is verified.

---

# Browser Test

Use Playwright if the repository already has it or it can be run with existing project tooling.

The browser test should prove the real workflow:

1. open development Data Editor
2. locate a known test match
3. open Match Sheet Editor
4. record current player value
5. change one stat
6. save
7. confirm success
8. reload editor
9. confirm persisted value
10. open public match page
11. open player page
12. inspect relevant season/record surface
13. run relevant NL query if available
14. restore original value
15. repeat the verification after restoration

Do not mock the DB for this end-to-end proof.

---

# Evidence Required Before Declaring Fixed

Do not say "fixed" solely because tests pass.

Provide evidence for at least one real reversible end-to-end mutation.

Example evidence format:

```text
Test: Player X, Match #1234, kicks 14 -> 15

Source match-player row:
  kicks:      14 -> 15
  handballs:   9 -> 9
  disposals:  23 -> 24

Player season:
  kicks:      201 -> 202
  disposals:  318 -> 319

Player career:
  kicks:      950 -> 951
  disposals: 1501 -> 1502

Match page: 15 kicks / 24 disposals
Player match history: 15 kicks / 24 disposals
Season/player totals: updated
Records/NL search: updated where applicable

Restore:
  15 -> 14
All checked values returned to baseline.
```

Use the actual discovered field/table/query names in the real report.

---

# Completion Checklist

Before finishing, confirm:

- [ ] repository inspected before changes
- [ ] connected DB/environment identified
- [ ] production not mutated
- [ ] source-of-truth table identified
- [ ] all derived dependencies identified
- [ ] match-sheet save reviewed
- [ ] generic data-edit save reviewed
- [ ] player creation/edit reviewed
- [ ] match creation/edit reviewed
- [ ] lineup add/remove reviewed
- [ ] match deletion reviewed safely
- [ ] awards/honours additions reviewed where applicable
- [ ] kick propagation tested
- [ ] handball propagation tested
- [ ] disposal consistency tested
- [ ] mark propagation tested
- [ ] tackle propagation tested
- [ ] hitout propagation tested
- [ ] frees propagation tested
- [ ] goals/behinds player totals tested
- [ ] official score separation preserved
- [ ] null/zero semantics tested
- [ ] source DB verified
- [ ] season aggregates verified
- [ ] career aggregates verified
- [ ] public match page verified
- [ ] player page verified
- [ ] season/club/records consumers verified
- [ ] NL search verified where applicable
- [ ] route/cache behaviour verified
- [ ] audit data verified
- [ ] test mutation restored
- [ ] restoration verified across all affected surfaces
- [ ] regression tests added
- [ ] no Git operations performed
- [ ] no Python files changed
- [ ] migration tooling untouched

---

# Final Report Format

Return a concise engineering report with these headings:

## Root cause

State exactly why the edit/addition was not propagating correctly.

## Data flow

Show:

`UI -> server action -> validation -> source DB -> derived data -> public query/cache`

Identify the broken link.

## Changes made

List only files actually changed and why.

## Database proof

Show before/after values for a reversible test mutation.

Include:

- match source value
- season total
- career total
- at least one consuming query/page

## Tests

List automated and browser/integration tests run and their results.

## Restoration

Confirm any temporary database mutations were restored and rechecked.

## Remaining risks

Only list real unresolved risks.

## Local status

State clearly:

- changes are local only
- no commit/push was performed
- Git state was not intentionally altered

---

# Definition of Done

The feature is done only when all of the following are true:

1. Adding supported data works.
2. Editing supported data works.
3. Removing supported data works where the UI supports removal.
4. The authoritative source row is correct.
5. Every required derived aggregate is correct.
6. The same edit is reflected by the application's relevant public queries.
7. Cached pages do not remain stale after a normal save.
8. Reversing the edit returns all affected totals to the original baseline.
9. A regression test protects the repaired dependency.
10. No unrelated historical data was changed.

The standard is **database consistency**, not merely "the Data Editor said Saved."
