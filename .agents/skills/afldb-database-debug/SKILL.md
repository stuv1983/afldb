---
name: afldb-database-debug
description: Diagnose, verify and safely address AFLDB database defects using PostgreSQL, SQL, TypeScript and application tests. Never modify tools/migration or any Python file.
disable-model-invocation: true
---

# AFLDB Database Review, Debug and Remediation

Use this skill when AFLDB contains, appears to contain, or reports a database problem.

Examples:

- a record value looks impossible;
- a player, club, match, venue or award is linked incorrectly;
- duplicate rows appear;
- counts differ between pages;
- a derived total does not match its authoritative source;
- a historical club identity is wrong;
- a query returns the wrong rows even though NL parsing is correct;
- a page says no data exists when PostgreSQL contains it;
- a migration/schema/index/constraint issue is suspected;
- a database-backed search or record page disagrees with an independently verified SQL result;
- NULL coverage is being treated as zero;
- a bad database row must be corrected safely.

The goal is to find the **first incorrect layer**, prove the defect from the real development database, fix it at the smallest correct non-Python layer, and prove the result end to end.

---

# Hard restrictions

These rules are absolute unless the user explicitly changes them.

## Protected path

Do not modify, create, rename, delete or move anything under:

```text
D:\dev\afldb\tools\migration\
```

Equivalent repository-relative protected path:

```text
tools/migration/
```

Do not use that directory as the implementation location for a fix.

## Python prohibition

Do not modify, create, rename or delete **any Python file anywhere in the repository**.

Forbidden:

```text
*.py
```

This includes, but is not limited to:

```text
tools/migration/*.py
tools/validation/*.py
tools/maintenance/*.py
scripts/*.py
```

If the root cause is in Python:

1. prove that with evidence;
2. do not edit the Python;
3. determine whether a safe SQL/TypeScript-side correction can prevent or repair the issue;
4. clearly report that a future rebuild may reproduce the defect if the protected Python pipeline remains the source;
5. never pretend a downstream patch permanently fixes an upstream protected importer defect.

## Git

Do not commit, push, merge, rebase, reset, stash, checkout branches, tag or otherwise alter Git state.

Do not publish anything.

Work only in the current local working copy until the user reviews the changes.

## Production

Do not change the production database by default.

Use the development database for diagnosis and fixes.

Production DML/DDL requires an explicit instruction from the user after the change has been proven on development.

---

# Working environments

Local Windows working copy:

```text
D:\dev\afldb
```

Authoritative database-backed Linux development environment:

```text
/home/arm/projects/afldb
```

Development PostgreSQL database:

```text
afldb_dev
```

The Windows copy is suitable for inspection and editing.

A result is not considered verified until it has been tested against the Linux development environment and real PostgreSQL database.

---

# Allowed implementation areas

Subject to the repository's actual structure, fixes may use non-Python files in areas such as:

```text
src/db/
src/db/queries/
src/db/migrations/
src/search/
src/lib/
src/app/
src/components/
tests/
tools/nl/
tools/maintenance/
docs/
```

Only use a directory when its current contents and project conventions show it is appropriate.

Examples of allowed file types:

```text
.ts
.tsx
.sql
.md
.json
```

Never change a file merely because it is technically outside the protected path.

Find the correct ownership layer first.

---

# AFLDB data rules that must be preserved

## 1. NULL is not zero

A missing historical statistic means:

```text
not recorded / unavailable
```

It does not mean:

```text
recorded as zero
```

Never repair an empty historical stat by replacing NULL with 0 unless the authoritative source explicitly records zero.

Any query using:

```sql
COALESCE(stat, 0)
```

must be reviewed carefully when the distinction affects the answer.

## 2. Brownlow totals have an authoritative source

Career and season Brownlow totals must come from the authoritative Brownlow season/results data.

Do not reconstruct all-time Brownlow totals from player-match rows when those rows do not have complete historical coverage.

A discrepancy between:

```text
match-level Brownlow votes
```

and:

```text
authoritative season Brownlow totals
```

is not automatically a database corruption.

Verify which source the feature is supposed to use.

## 3. Historical club identity is explicit

Do not rewrite historical identities merely to match the current club name.

A historical club identity and its modern organisation lineage are related concepts, not interchangeable strings.

Examples requiring care include:

```text
South Melbourne / Sydney
Footscray / Western Bulldogs
Brisbane Bears / Brisbane Lions
```

Before changing club IDs, aliases or organisation links, determine whether the query/page is supposed to operate on:

- a historical identity;
- a current identity;
- an organisation lineage.

## 4. AFLW is structurally separate

AFLW data may live in its own schema/views and does not necessarily share all assumptions of the normalised AFL/VFL model.

Do not "repair" AFLW by forcing it into AFL/VFL assumptions.

---

# Operating modes

The command may specify one of these modes.

## `audit`

Investigate and classify only.

Do not edit application/database source files and do not persist database changes.

## `fix`

Investigate, implement the smallest correct non-Python fix, add regression coverage and verify it.

## `verify`

Do not broadly change code.

Re-run the provided defect and prove whether it is fixed.

## `full`

Perform the complete workflow:

```text
reproduce -> classify -> prove -> patch -> verify -> regression
```

If no mode is supplied, use:

```text
full
```

---

# Core rule: do not assume the database is wrong

A bad number on screen does not prove a bad stored row.

The first incorrect layer may be:

1. UI formatting;
2. answer description;
3. TypeScript query;
4. SQL calculation;
5. join cardinality;
6. alias/entity resolution;
7. derived table/view;
8. schema constraint;
9. actual stored data;
10. upstream import logic.

Always prove which one is wrong before changing data.

---

# First-response workflow

For every reported database defect:

1. record the exact symptom;
2. record where it appears;
3. reproduce it;
4. identify the underlying database entities;
5. query the source-of-truth rows directly;
6. compare raw rows with any derived rows;
7. inspect the application SQL/TypeScript that produced the visible result;
8. classify the defect;
9. only then design a fix.

Never begin by issuing an `UPDATE`.

---

# Defect classification

Classify every issue into one primary category.

## A. Stored-data defect

Examples:

- wrong score stored for a match;
- incorrect player ID;
- bad venue link;
- wrong award winner link;
- duplicate source row;
- impossible season;
- incorrect club identity.

Required proof:

- identify the exact primary key;
- show the bad stored value;
- show the authoritative/corroborating value;
- show why the correction is unambiguous.

## B. Derived-data drift

Examples:

- career total differs from source rows;
- club-season summary no longer equals matches;
- cached/derived statistic is stale;
- materialised/summary table was not rebuilt correctly.

Required proof:

```text
base rows -> independently computed expected value -> stored derived value
```

Do not patch a derived row until you know why it drifted.

## C. Query defect

Examples:

- duplicate-producing join;
- missing predicate;
- wrong aggregation;
- wrong side of a match;
- score calculated as home + away instead of selected team score;
- `COUNT(*)` applied after a multiplicative join;
- a LEFT JOIN accidentally behaves as an INNER JOIN;
- `WHERE` condition belongs before `GROUP BY`;
- wrong ordering or tie logic.

If base rows are correct, fix the query rather than the data.

## D. Entity-resolution defect

Examples:

- historical club alias maps to the wrong identity;
- venue alias resolves incorrectly;
- same-name player linked incorrectly;
- current organisation substituted for a historical club.

Fix resolution or the bad trusted link.

Do not rewrite unrelated source rows.

## E. Schema/constraint defect

Examples:

- missing unique constraint;
- nullable column that should be mandatory;
- invalid foreign key relationship;
- migration did not create an expected index;
- enum/check constraint does not match application vocabulary.

Use a new forward migration when the repository's migration policy requires one.

Do not rewrite old applied migrations merely to make history look clean.

## F. Coverage/data-availability issue

Examples:

- older player-match stat is NULL;
- period split not recorded;
- Brownlow match votes incomplete for an era;
- AFLW shape differs.

This is not a corruption.

Fix the application to decline, caveat or display availability honestly.

## G. Presentation defect

Examples:

- correct score displayed with wrong label;
- home/away names reversed;
- wrong unit;
- tie text says "player" for a club result.

Do not modify the database.

## H. Protected upstream defect

Use this when the root cause is conclusively inside:

```text
tools/migration/
```

or:

```text
*.py
```

Do not modify the protected source.

Document:

- exact protected file/path;
- evidence that it creates the defect;
- whether a downstream SQL or TypeScript safeguard is safe;
- whether the issue will recur on a rebuild.

---

# Reproduce the issue

Use the same surface where the user found it.

Examples:

- `/search`
- player page
- match page
- club page
- venue page
- records page
- admin review
- direct DB query

For a web-visible defect, capture:

```text
URL
input/query
headline/value shown
affected row/entity
expected value
```

Use Playwright when the problem is visible through the application.

Do not rely only on a screenshot if the DOM text can be asserted directly.

---

# Connect to PostgreSQL safely

Prefer the project's existing environment configuration.

Typical development-server pattern:

```bash
cd /home/arm/projects/afldb

set -a
[ -f .env ] && . ./.env
set +a

psql "$DATABASE_URL" -v ON_ERROR_STOP=1
```

Do not print credentials.

Do not hardcode credentials into scripts, tests or documentation.

For diagnosis:

```sql
BEGIN READ ONLY;

-- diagnostic queries

ROLLBACK;
```

Before changing data, prove the candidate change inside a transaction and roll it back.

---

# Inspect the real schema before writing SQL

Never infer column names from memory.

Useful discovery queries:

```sql
SELECT
  table_schema,
  table_name,
  table_type
FROM information_schema.tables
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY table_schema, table_name;
```

Columns:

```sql
SELECT
  table_schema,
  table_name,
  ordinal_position,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY table_schema, table_name, ordinal_position;
```

Constraints:

```sql
SELECT
  conrelid::regclass AS table_name,
  conname,
  contype,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE connamespace NOT IN (
  'pg_catalog'::regnamespace,
  'information_schema'::regnamespace
)
ORDER BY 1, 2;
```

Indexes:

```sql
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname NOT IN ('pg_catalog')
ORDER BY schemaname, tablename, indexname;
```

Do not propose schema fixes until the current schema has been inspected.

---

# Identify the exact affected rows

Always reduce the defect to stable IDs.

Prefer:

```text
player_id
match_id
club_id
venue_id
season
award/source key
```

over display strings.

Example investigation pattern:

```sql
SELECT *
FROM matches
WHERE id = :match_id;
```

Then inspect related rows using the actual schema.

Do not update by a broad display-name predicate such as:

```sql
WHERE player_name = 'John Smith'
```

when stable IDs exist.

---

# Check join cardinality

Many apparent data errors are multiplicative joins.

Before trusting an aggregate, compare row counts at each join.

Pattern:

```sql
SELECT COUNT(*) FROM base_table WHERE ...;

SELECT COUNT(*)
FROM base_table b
JOIN related_table r ON ...
WHERE ...;
```

Then inspect duplicate keys:

```sql
SELECT
  b.id,
  COUNT(*) AS joined_rows
FROM base_table b
JOIN related_table r ON ...
WHERE ...
GROUP BY b.id
HAVING COUNT(*) > 1
ORDER BY joined_rows DESC;
```

If a score of 119 becomes 357, explicitly check whether a three-row join multiplied the value.

Do not fix the stored `119` to `357`.

---

# Check duplicates properly

Do not use `SELECT DISTINCT` as a reflexive repair.

First determine why duplicates exist.

Find duplicates by the semantic key:

```sql
SELECT
  key1,
  key2,
  COUNT(*) AS rows
FROM target_table
GROUP BY key1, key2
HAVING COUNT(*) > 1
ORDER BY rows DESC;
```

Then inspect all duplicate rows.

Ask:

- Are they truly duplicate facts?
- Are they separate source records?
- Are they multiple clubs/roles that should coexist?
- Is a join creating apparent duplicates rather than storage?

Only delete stored duplicates when their semantic identity is proven.

---

# Check referential integrity

Find orphaned references using the actual foreign-key relationships.

Pattern:

```sql
SELECT child.*
FROM child_table child
LEFT JOIN parent_table parent
  ON parent.id = child.parent_id
WHERE child.parent_id IS NOT NULL
  AND parent.id IS NULL;
```

If an orphan exists:

1. inspect whether the parent should exist;
2. inspect migration history;
3. determine whether the child link or the missing parent is wrong;
4. do not simply set the foreign key to NULL to silence the issue.

---

# Check derived totals independently

Do not validate derived data using the same SQL that generated it.

Write an independent calculation.

Examples:

## Career total

```text
player-match/source rows
    ->
independent SUM/COUNT
    ->
compare with career/summary row
```

## Club season

```text
matches for one club and season
    ->
independent W/D/L/points calculation
    ->
compare with club-season row
```

## Team match score

Verify the club perspective explicitly.

A team's score must not become:

```text
home_score + away_score
```

or:

```text
SUM(team_score) after a multiplicative join
```

## Brownlow

Use the authoritative season/result source.

Do not use incomplete match vote rows to "prove" the authoritative total is wrong.

---

# Detect impossible values

When a displayed or stored value looks impossible, do not rely on intuition alone.

Run range checks.

Examples:

```sql
SELECT MIN(score), MAX(score)
FROM ...;
```

```sql
SELECT *
FROM ...
ORDER BY score DESC
LIMIT 50;
```

Compare the suspicious row against:

- the match's two team scores;
- source progression values;
- player rows;
- duplicate/join counts;
- other rows from the same era.

For a suspicious value such as:

```text
357 team score
```

determine whether it is:

- actually stored;
- a combined match score;
- a multiplied join result;
- a cumulative total across several rows;
- a formatting bug.

Only one of those is a stored-data defect.

---

# Historical club debugging

When a club result appears wrong:

1. resolve the exact club ID;
2. inspect historical identity;
3. inspect organisation/lineage ID;
4. inspect aliases;
5. inspect the match row's club references;
6. inspect whether the application query requests identity or lineage semantics.

Never fix:

```text
Brisbane Bears
```

by blindly mapping it to:

```text
Brisbane Lions
```

Historical identity may be the intended distinction.

Likewise, a nickname may represent an organisation while an official historical name represents one identity.

Prove the required semantics from the feature before changing IDs or aliases.

---

# Player identity debugging

Never trust a name alone when duplicate or near-duplicate player names exist.

Inspect:

```text
player_id
display name
career span
clubs
source row
source year
source club
match/link status
```

For honours/source links, preserve the project's trusted/untrusted model.

A bad trusted link should be corrected deliberately.

An ambiguous source row should remain ambiguous rather than being linked to the most famous candidate.

---

# NULL and coverage debugging

When a query returns too few rows:

```sql
SELECT
  COUNT(*) AS total,
  COUNT(stat_column) AS populated,
  COUNT(*) FILTER (WHERE stat_column IS NULL) AS missing
FROM ...
WHERE season BETWEEN :lo AND :hi;
```

Inspect by season:

```sql
SELECT
  season,
  COUNT(*) AS rows,
  COUNT(stat_column) AS populated
FROM ...
GROUP BY season
ORDER BY season;
```

Never convert missing historical coverage into a zero-valued performance.

If the data is unavailable, the correct fix may be:

```text
coverage decline
```

rather than:

```text
database update
```

---

# Schema change policy

If the defect genuinely requires a schema change:

1. inspect existing migration naming/order conventions;
2. create a **new forward SQL migration** if that is how this repository manages PostgreSQL schema changes;
3. do not edit already-applied historical migrations unless the repository explicitly treats them as mutable;
4. make the migration deterministic;
5. add constraints only after checking existing data satisfies them;
6. include a verification query/test;
7. test migration behaviour against development.

Never place the migration in:

```text
tools/migration/
```

Never implement the migration through Python.

If current project migrations are TypeScript rather than SQL, follow the existing non-Python convention.

---

# Data correction policy

A direct database correction must meet all of these:

- exact affected rows identified;
- authoritative expected value known;
- correction can be expressed using stable IDs;
- before/after state captured;
- transaction tested with rollback first;
- downstream derived data implications understood;
- rebuild recurrence risk understood.

Prefer a reproducible forward correction over an undocumented manual edit.

Depending on repository conventions, this may be:

- a new SQL migration;
- a non-Python maintenance SQL file;
- a TypeScript maintenance action/tool;
- an application-side query fix when the stored data is already correct.

Do not create an ad-hoc correction mechanism if the repository already has a proper forward-migration pattern.

---

# Transaction-first remediation

Before persisting a data fix:

```sql
BEGIN;

SELECT ...
FROM ...
WHERE primary_key = ...;

UPDATE ...
SET ...
WHERE primary_key = ...;

SELECT ...
FROM ...
WHERE primary_key = ...;

ROLLBACK;
```

Verify:

```text
rows matched
rows changed
old value
new value
related totals
```

Only after the rollback rehearsal is correct should the reproducible fix be implemented.

Do not run an unbounded UPDATE.

Bad:

```sql
UPDATE matches SET venue_id = 5;
```

Good shape:

```sql
UPDATE ...
SET ...
WHERE id IN (...)
  AND existing_value = expected_old_value;
```

Including the expected old value makes the correction fail safely if the database is not in the state you proved.

---

# Use assertions in corrective SQL

Where appropriate, fail loudly if assumptions are wrong.

A correction should not silently affect zero or many unexpected rows.

For PostgreSQL migrations, follow project conventions and consider guarded logic such as:

```sql
DO $$
DECLARE
  affected integer;
BEGIN
  SELECT COUNT(*)
  INTO affected
  FROM target_table
  WHERE ...;

  IF affected <> 1 THEN
    RAISE EXCEPTION
      'Expected exactly 1 target row, found %',
      affected;
  END IF;

  UPDATE target_table
  SET ...
  WHERE ...;
END
$$;
```

Do not copy this mechanically if the repository uses a different migration style.

---

# Query-layer debugging

If the database is correct, inspect the TypeScript query.

Focus on:

- joins;
- `WHERE`;
- `GROUP BY`;
- `HAVING`;
- window functions;
- aggregate placement;
- selected club perspective;
- aliases;
- ordering;
- tie retention;
- null handling;
- historical organisation joins;
- accidental fan-out.

Compare:

```text
raw SQL result
```

with:

```text
application query result
```

using the same entity IDs.

Do not patch the UI to disguise incorrect SQL.

---

# Views and derived SQL

If a view is involved:

```sql
SELECT pg_get_viewdef('schema.view_name'::regclass, true);
```

Check whether the view:

- joins one-to-many tables;
- uses `DISTINCT` to conceal fan-out;
- coalesces NULL;
- rewrites historical identities;
- filters a competition/season unexpectedly.

If a view is wrong and the project manages it through migrations, fix it with a new allowed forward migration.

---

# Performance when fixing database queries

A correct fix should not create a serious regression.

Use:

```sql
EXPLAIN (ANALYZE, BUFFERS)
...
```

on development for representative queries.

Check:

- row estimates;
- sequential scans on large tables;
- repeated nested loops;
- unnecessary sort volume;
- filters applied after a large join;
- index usage.

Do not add an index solely because a query is slow once.

First prove:

- the query shape is correct;
- the predicate is selective;
- an existing index does not already cover it.

---

# Application verification

For a user-visible database issue, direct SQL verification is necessary but not sufficient.

Use the real application after the fix.

With Playwright:

1. open the affected page/search;
2. reproduce the exact original action;
3. wait on the semantic result element;
4. assert the corrected value;
5. assert surrounding entity names;
6. assert no duplicate rows appeared;
7. assert the old bad value is absent when appropriate;
8. check browser console/page errors;
9. test at least one neighbouring unaffected record.

Avoid arbitrary sleeps.

Use accessible roles, labels and test IDs.

---

# Regression tests

Every fix should have the smallest useful regression test.

Choose the layer that failed.

## Query defect

Add a DB-backed TypeScript query/integration test.

## Description/UI defect

Add a unit/component/Playwright test.

## Schema defect

Add migration/schema validation.

## Data correction

Add a verification query/test that proves:

- corrected row/value;
- no duplicate semantic key;
- expected relationship;
- derived totals remain consistent.

## Historical identity defect

Test both:

- the corrected historical identity;
- a neighbouring current organisation query;

so the fix does not collapse the distinction.

---

# Rebuild-safety analysis

Because Python is protected, explicitly ask:

```text
Will a future database rebuild recreate this defect?
```

Possible outcomes:

## No

The defect is entirely in:

- TypeScript query;
- SQL view;
- schema;
- UI;
- non-Python migration.

Fix normally.

## Yes — Python/source pipeline creates it

Do not edit Python.

Options, depending on the project:

1. add a forward SQL correction applied after load;
2. add a DB constraint preventing the invalid state;
3. add a TypeScript/runtime safeguard;
4. add a validation test that fails loudly;
5. document the protected upstream defect for later work.

Do not silently rely on a one-off manual UPDATE that disappears on the next rebuild.

---

# Protected-file guard

Before finalising, prove the work did not modify forbidden files.

Do not use Git mutation commands.

Use filesystem inspection appropriate to the environment.

The final changed-file list must contain:

```text
zero *.py files
zero files under tools/migration/
```

If any protected file was modified accidentally:

- revert that local modification using a non-destructive file restore method available in the working copy;
- do not continue until the protected-path rule is satisfied.

If a safe restoration method is unavailable, stop and report the accidental protected-file change rather than compounding it.

---

# Recommended investigation SQL patterns

These are templates only. Adapt them to the actual schema.

## Find one match

```sql
SELECT *
FROM matches
WHERE season = :season
  AND round_number = :round
  AND (
    (home_club_id = :a AND away_club_id = :b)
    OR
    (home_club_id = :b AND away_club_id = :a)
  );
```

## Compare stored and calculated team score

```sql
SELECT
  id,
  home_score,
  away_score
FROM matches
WHERE id = :match_id;
```

Then compare the application's selected-team `value` to the correct side.

## Duplicate player-match rows

```sql
SELECT
  player_id,
  match_id,
  COUNT(*) AS rows
FROM player_match_stats
GROUP BY player_id, match_id
HAVING COUNT(*) > 1;
```

## Duplicate match identity

Use the real semantic key after inspecting schema; for example:

```sql
SELECT
  season,
  round_type,
  round_number,
  match_date,
  home_club_id,
  away_club_id,
  COUNT(*)
FROM matches
GROUP BY
  season,
  round_type,
  round_number,
  match_date,
  home_club_id,
  away_club_id
HAVING COUNT(*) > 1;
```

## Broken foreign key-like links

```sql
SELECT s.*
FROM source_table s
LEFT JOIN players p ON p.id = s.player_id
WHERE s.player_id IS NOT NULL
  AND p.id IS NULL;
```

## Derived drift

```sql
WITH calculated AS (
  SELECT
    player_id,
    SUM(goals) AS goals
  FROM player_match_stats
  WHERE goals IS NOT NULL
  GROUP BY player_id
)
SELECT
  p.id,
  p.display_name,
  stored.total_goals,
  calculated.goals
FROM ...
WHERE stored.total_goals IS DISTINCT FROM calculated.goals;
```

Only use this pattern for a statistic whose source rows have complete appropriate coverage.

---

# Never do these

Do not:

- edit `tools/migration/`;
- edit any `.py`;
- use Python to implement the repair;
- change source data merely to make a UI test pass;
- replace NULL with zero globally;
- rewrite historical clubs to current names;
- trust a name match over stable IDs;
- delete duplicate-looking rows without proving semantic duplication;
- use `DISTINCT` to hide a broken join without understanding it;
- patch a displayed number before checking raw SQL;
- update production while diagnosing;
- use an unbounded UPDATE/DELETE;
- modify a historical migration casually;
- claim a permanent fix when the protected Python rebuild path will recreate it;
- weaken a validation rule to accept corrupt state;
- add an index without measuring the query;
- skip UI verification for a user-visible defect.

---

# Example: impossible team score

Symptom:

```text
Collingwood vs St Kilda (1980) — 357 team score
```

Required workflow:

1. locate the exact match;
2. read stored home and away scores;
3. prove whether either club actually scored 357;
4. inspect the TypeScript query producing `value`;
5. check joins for row multiplication;
6. check whether `357` equals:
   - both team scores added;
   - one score multiplied;
   - multiple match rows summed;
   - a period progression error;
7. only if PostgreSQL itself stores 357 for the relevant club should this be treated as a stored-data defect;
8. otherwise fix the query/calculation layer;
9. verify direct SQL;
10. verify `/search` with Playwright;
11. add a regression test that the team-score value equals the selected team's actual score.

---

# Example: incorrect player link

Symptom:

```text
Award/source row points to the wrong same-name player.
```

Workflow:

1. inspect source row;
2. inspect linked player ID;
3. list same-name candidates;
4. compare club and era evidence;
5. confirm the correct candidate is unambiguous;
6. determine whether the bad link is stored or resolved at query time;
7. correct only the trusted link if stored;
8. preserve source spelling/source row;
9. preserve audit semantics;
10. test that ambiguous neighbouring rows remain unlinked.

Do not change a source name to force a player match.

---

# Example: missing old statistic

Symptom:

```text
A historical player appears to have zero contested possessions.
```

Workflow:

1. inspect raw DB value;
2. inspect coverage by season;
3. prove whether the column is NULL;
4. if unavailable, do not write zero;
5. fix the query/UI to exclude or caveat unavailable coverage;
6. add a regression test for the historical season.

This is a coverage fix, not a data correction.

---

# Final verification checklist

Before reporting completion:

- [ ] Exact original symptom reproduced.
- [ ] Affected database IDs identified.
- [ ] Current schema inspected rather than assumed.
- [ ] Raw source/base rows checked.
- [ ] Derived rows independently recalculated where relevant.
- [ ] Join cardinality checked for aggregate anomalies.
- [ ] NULL/coverage semantics checked.
- [ ] Historical identity semantics checked where relevant.
- [ ] First incorrect layer identified.
- [ ] Fix implemented only in an allowed non-Python location.
- [ ] No file under `tools/migration/` modified.
- [ ] No `.py` file modified or created.
- [ ] Development DB verified.
- [ ] Transaction rollback rehearsal used for data corrections.
- [ ] Regression test added.
- [ ] User-visible fix verified in the real application.
- [ ] Neighbouring unaffected case tested.
- [ ] Rebuild recurrence risk assessed.
- [ ] No production mutation performed unless explicitly authorised.

---

# Final report format

Use this structure.

## Issue

State:

- exact symptom;
- affected page/query/entity;
- affected IDs.

## Database truth

Show the independently verified database facts.

Example:

```text
Match 12345:
Collingwood 112
St Kilda 87

357 is not stored as either team's score.
```

## Root cause

State the first incorrect layer:

```text
stored data
derived data
query
join
entity resolution
schema
coverage
presentation
protected Python/import pipeline
```

Explain why.

## Fix

List:

- files changed;
- SQL/schema/data change if any;
- why this is the smallest correct fix.

Explicitly confirm:

```text
Protected Python files changed: none
tools/migration files changed: none
```

## Verification

List exact commands/tests and results.

For database corrections include:

```text
before
after
rows affected
rollback rehearsal
final verification
```

## Rebuild safety

State one of:

```text
Rebuild-safe
```

or:

```text
May recur on rebuild because the root cause is in protected Python/import logic.
```

If recurrence is possible, explain the non-Python safeguard added or the remaining limitation.

## Remaining issues

Separate:

- unresolved data quality;
- protected upstream issues;
- coverage limitations;
- unrelated defects discovered during the review.

---

# Completion standard

A database issue is not complete merely because the visible number changed.

It is complete only when:

1. the actual database truth is established;
2. the first incorrect layer is proven;
3. the smallest correct non-Python fix is implemented;
4. no protected path or Python file was changed;
5. development PostgreSQL agrees with the expected result;
6. the affected application surface agrees with PostgreSQL;
7. regression coverage exists;
8. neighbouring data remains correct;
9. rebuild recurrence risk is understood and reported.
