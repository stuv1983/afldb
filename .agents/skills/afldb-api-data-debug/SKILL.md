---
name: afldb-api-data-debug
description: Review, test, debug and improve AFLDB external API data ingestion, staging, reconciliation and reporting. Use when current-season API imports return unexpected counts, unresolved teams or matches, missing data, duplicate data, incorrect completion states, source disagreements, or suspicious dry-run reports.
---

# AFLDB API Data Debugging

## Purpose

Review and debug AFLDB code that retrieves data from external APIs and turns it into staged or canonical AFLDB data.

The priority is correctness of the entire pipeline:

external API
→ fetch
→ validate source response
→ normalise
→ stage
→ resolve teams/entities
→ resolve AFLDB matches
→ determine completion
→ reconcile sources
→ plan writes
→ apply only when explicitly authorised
→ report accurate counts

Do not treat a successful HTTP response as proof that the importer is working correctly.

The external source must be compared with:

1. the raw API response,
2. the normalised representation,
3. staged database rows,
4. existing AFLDB data,
5. the final dry-run/apply report.

---

# Repository

Work only in the current AFLDB working directory.

Inspect the repository before changing anything.

Read at minimum:

- `README.md`
- `CHANGELOG.md`
- `issues.md` if present
- `package.json`
- files used by `npm run current-season:update`
- external API clients
- current-season normalisation code
- current-season staging code
- team/club resolution code
- match reconciliation code
- dry-run/report generation code
- relevant tests

Follow imports and call chains rather than guessing which file owns the behaviour.

Do not commit, push, checkout, reset, merge, rebase or otherwise modify Git history.

Do not deploy changes.

Do not modify production.

Do not change database migrations, schema design or historical migration/import tooling unless investigation proves that the defect is there and it is genuinely required.

Prefer fixing the smallest responsible layer.

---

# Current External Sources

AFLDB currently uses external current-season sources including:

- `squiggle_api`
- `kali_afl_stats`

Treat each source independently.

Do not assume both APIs:

- use the same club names,
- use the same round numbering,
- represent future fixtures the same way,
- use the same completion semantics,
- use null and zero identically,
- populate scores at the same point,
- identify matches the same way,
- or update at the same time.

Existing AFLDB source-specific behaviour must be preserved unless demonstrated to be incorrect.

Known examples include:

- Squiggle Opening Round numbering may differ from AFLDB.
- Kali may use names such as `Brisbane` where AFLDB uses `Brisbane Lions`.
- Kali completion may need to be inferred from scores and match date.
- Squiggle provides its own completion information.
- Future fixtures may exist before teams, scores or other fields are finalised.

---

# Safety Rules

## Dry-run first

Always begin with dry-run behaviour.

Never add `--apply`, update canonical matches, insert canonical matches, overwrite scores, or otherwise mutate AFLDB fact data while investigating unless explicitly instructed by the user.

Staging may itself be a database write.

Therefore distinguish between:

- external API read,
- staging write,
- canonical AFLDB write.

Do not claim that "dry run writes nothing" until the implementation has been checked.

If dry-run deliberately snapshots external payloads into staging, state that clearly.

## Secrets

Never print, log, copy or expose:

- `KALI_AFL_API_KEY`
- database passwords
- SMTP credentials
- tokens
- connection strings containing credentials
- other `.env` secrets.

Confirm that credentials are loaded server-side/environment-side only.

Sanitise diagnostic output.

## Existing AFLDB data

Existing final AFLDB match data is authoritative unless the reconciliation rules explicitly permit an external update.

Never overwrite an existing completed result merely because one API disagrees with it.

Report disagreement first.

---

# Investigation Method

## Phase 1 — Map the pipeline

Find the implementation behind:

`npm run current-season:update`

Trace the complete execution path.

Document internally:

`CLI/admin action`
→ `source selection`
→ `API request`
→ `response parsing`
→ `normalisation`
→ `staging`
→ `team resolution`
→ `match resolution`
→ `completion eligibility`
→ `insert/update planning`
→ `report`

Identify exactly where each displayed report count is calculated.

Do not infer a count's meaning from its label.

Find the actual predicate used.

---

# Phase 2 — Inspect the source API contract

For every source being tested, inspect a small representative live response using the existing API client where practical.

Do not build a second competing importer just for diagnosis.

Capture enough fields to determine:

- source match ID
- competition/year
- date
- round
- round name
- home team
- away team
- home score
- away score
- completion state
- venue if available
- last-updated information if available

Check for:

- missing properties,
- nulls,
- empty strings,
- zero score placeholders,
- renamed properties,
- changed types,
- API schema drift,
- duplicate IDs,
- duplicate matches,
- future placeholder fixtures.

Do not assume `0` means a recorded zero.

Do not assume the presence of numerical score properties means the game has been played.

---

# Phase 3 — Check date handling

Date handling is critical for current-season data.

Verify:

- source timezone,
- parsing timezone,
- date-only versus datetime values,
- UTC conversion,
- Australian local date handling,
- AFLDB stored match date,
- comparisons with "today",
- future-match detection.

A fixture later today must not accidentally become completed merely because its date equals the current date.

Where completion depends on time/date, inspect whether the code compares:

`date < today`

versus:

`date <= today`

and whether that behaviour is appropriate.

Do not fix this by guessing match start times if the source does not provide them.

---

# Phase 4 — Check completion semantics

For every staged match derive these states separately:

- source says complete
- scores fields exist
- scores are meaningful
- fixture date is past
- teams are known
- AFLDB match resolves
- eligible to insert
- eligible to update

Do not collapse these into one boolean.

Pay particular attention to future fixtures with values such as:

`home_score = 0`
`away_score = 0`

A numeric `0-0` placeholder is not automatically a completed scored match.

If the report calls such rows "With scores", determine whether that label actually means:

- score columns are non-null,

or:

- a legitimate played score exists.

Fix either the predicate or the report wording if the current description is misleading.

---

# Phase 5 — Team resolution

Inspect all unresolved team values.

Classify each unresolved row into one of:

`UNKNOWN_ALIAS`
`MISSING_HOME_TEAM`
`MISSING_AWAY_TEAM`
`SOURCE_PLACEHOLDER`
`INACTIVE_OR_HISTORICAL_IDENTITY`
`SOURCE_DATA_ERROR`
`RESOLVER_BUG`

Do not blindly create aliases.

For real club-name variants:

1. verify the source consistently uses the name,
2. identify the correct AFLDB club/organisation,
3. use the existing source-normalisation mechanism,
4. add a focused regression test.

Values such as:

`not recorded`
`TBD`
empty string
null

must not become club aliases.

Future fixtures whose participants have not yet been determined should normally be classified as incomplete fixture data rather than a team-resolution defect.

---

# Phase 6 — Match resolution

For each staged row determine why it did or did not resolve to AFLDB.

Check the actual match key components, including as applicable:

- season
- competition
- round
- round type
- round number
- date
- home club
- away club
- source match ID

Identify whether failure is caused by:

- teams unresolved,
- AFLDB match does not yet exist,
- incorrect round conversion,
- date mismatch,
- home/away reversal,
- historical club identity mismatch,
- duplicate candidate AFLDB matches,
- fixture not yet created locally,
- invalid source data.

Do not describe every unmatched future fixture as an error.

---

# Phase 7 — Reconciliation

Compare Kali and Squiggle where they appear to describe the same fixture.

Use stable football identity rather than assuming their external IDs correspond.

For overlapping matches compare:

- season
- round
- date
- home club
- away club
- final score
- completion state

Classify disagreements.

Example classifications:

`SOURCE_AGREEMENT`
`SCORE_DISAGREEMENT`
`DATE_DISAGREEMENT`
`ROUND_DISAGREEMENT`
`TEAM_DISAGREEMENT`
`COMPLETION_DISAGREEMENT`
`ONLY_IN_KALI`
`ONLY_IN_SQUIGGLE`

Do not silently choose whichever API was processed last.

---

# Phase 8 — Audit report calculations

Every displayed summary value must be independently reproducible from staged rows.

Review counts such as:

- Fetched
- Complete
- With scores
- Staged
- Inserted
- Resolved
- Updated
- Unresolved
- Unresolved teams

Define exactly what each means.

Names must describe the actual predicate.

Counts from different pipeline stages must not be mixed under similar names.

For each total, establish an invariant where appropriate.

Examples:

`fetched = number of accepted source records before normalisation filtering`

`staged = rows represented in staging for this run`

`resolved = staged rows successfully matched to an existing AFLDB match`

`planned_insert = eligible completed rows without an AFLDB match`

`planned_update = eligible resolved rows whose authoritative score differs and satisfies update policy`

`unresolved_match = staged rows expected to resolve but which did not`

`incomplete_fixture = staged future/incomplete fixtures not expected to resolve yet`

The exact definitions must follow the code and intended product behaviour, but they must be mutually understandable.

Avoid one overloaded `unresolved` counter covering unrelated states.

---

# Current 2026 Reproduction

Use the current dry-run result as a primary reproduction case.

Observed:

```text
Fetched:       415
Complete:      396
With scores:   415
Staged:        415
Inserted:        0
Resolved:        0
Updated:         0
Unresolved:    415
```

Source report:

```text
kali_afl_stats
Staged:             197
Resolved:           197
Complete:           197
With scores:        197
Unresolved teams:     0

squiggle_api
Staged:             218
Resolved:           199
Complete:           199
With scores:        218
Unresolved teams:    11
```

This must be investigated.

Do not assume these values are valid merely because the command completed successfully.

There is an apparent semantic/reporting inconsistency:

```text
source-level resolved:
197 + 199 = 396

top-level resolved:
0

top-level unresolved:
415
```

Determine whether:

1. the two reports use different definitions of `resolved`,
2. the aggregate counters are never populated during dry-run,
3. the aggregate report is counting "not written" as "unresolved",
4. planned operations are being conflated with reconciliation,
5. or the aggregate report contains a genuine bug.

If the meanings differ intentionally, rename or restructure the report so an operator cannot reasonably misinterpret it.

---

# Current Squiggle Fixtures to Inspect

Inspect the supplied unresolved/sample records, including:

```text
38692 | 2026-08-21 | R24 | Collingwood | Brisbane Lions
38693 | 2026-08-22 | R24 | Carlton | Fremantle
38695 | 2026-08-22 | R24 | Geelong | Richmond
38696 | 2026-08-22 | R24 | Melbourne | Western Bulldogs
38699 | 2026-08-22 | R24 | Adelaide | Greater Western Sydney
38694 | 2026-08-23 | R24 | Essendon | Port Adelaide
38698 | 2026-08-23 | R24 | Sydney | North Melbourne
38700 | 2026-08-23 | R24 | West Coast | Hawthorn
38719 | 2026-08-29 | R25 | not recorded | not recorded
38720 | 2026-08-29 | R25 | not recorded | not recorded
```

Determine separately whether each row is:

- a legitimate future fixture,
- a match not yet present in AFLDB,
- an unresolved team-mapping defect,
- a source placeholder,
- or a reconciliation defect.

Rows containing `not recorded` must receive special attention.

Do not add `not recorded` as a team alias.

---

# Database Verification

Use read-only queries while diagnosing.

Inspect relevant staging rows and existing `matches` rows.

Where useful, compare counts directly in SQL rather than trusting application output.

Verify:

- staged row count by source,
- unique external IDs,
- duplicate external IDs,
- null/missing teams,
- rows marked complete,
- rows with score fields,
- rows whose date is in the future,
- resolved AFLDB match IDs,
- unresolved team names,
- duplicate resolution candidates.

Do not mutate canonical data for a diagnostic query.

---

# Tests

Before changing code, locate existing tests for current-season external sources.

Add focused regressions for any confirmed defect.

Prefer small deterministic fixtures over depending entirely on the live API.

Tests should cover relevant cases such as:

- completed Squiggle match,
- future Squiggle fixture,
- Squiggle fixture with `0-0` placeholder scores,
- future fixture with unknown teams,
- known Squiggle team aliases,
- Kali human-readable date,
- Kali team aliases,
- Opening Round conversion,
- same fixture returned by both sources,
- unresolved match,
- ambiguous match,
- dry-run report counters,
- aggregate/source report consistency.

Mock secrets.

Never include a real API key in fixtures.

---

# Fixing Rules

Fix root causes, not the displayed symptom.

Examples:

Bad:

```ts
if (season === 2026) {
  resolved = 396;
}
```

Bad:

```ts
if (team === "not recorded") {
  mapToSomeClub();
}
```

Good:

- correct a broken aggregate,
- correctly classify future fixtures,
- repair a source normaliser,
- separate score-presence from completed-score semantics,
- correct round conversion,
- repair a match-resolution predicate,
- rename misleading report columns,
- add explicit result categories.

Do not broaden behaviour beyond the demonstrated defect without evidence.

---

# Validation

After changes run the smallest relevant tests first.

Then run:

```bash
npm run typecheck
```

Run the relevant current-season/API test suites.

Run the 2026 importer again in dry-run mode.

Do not use apply flags.

Compare before and after counts.

For each changed count explain exactly why it changed.

If practical, independently validate selected matches against both source APIs and AFLDB.

---

# Expected Final Report

When finished, report:

## Finding

State the actual root cause.

## Evidence

Show the relevant source/API/staging/AFLDB evidence.

## Changes

List files changed and what was corrected.

## 2026 dry-run result

Show the new summary and source-level report.

## Remaining unresolved rows

Separate them into meaningful categories, for example:

```text
Expected future fixtures
Source placeholders
Unknown team aliases
Missing AFLDB matches
Ambiguous matches
Source disagreement
Actual importer defects
```

## Tests

Show tests/typecheck performed and results.

## Safety

Explicitly state whether:

- canonical match rows were inserted,
- canonical match rows were updated,
- existing scores were changed,
- staging rows were written.

Do not simply say "nothing was written" if staging was modified.

---

# Success Criteria

The task is complete only when:

- API responses are being interpreted according to their actual source semantics.
- Future fixtures are not incorrectly treated as completed results.
- Placeholder scores are not mistaken for played scores.
- Placeholder team names are not treated as legitimate club aliases.
- team resolution is deterministic.
- match resolution is deterministic.
- source disagreements remain visible.
- dry-run cannot modify canonical AFLDB match facts.
- staged versus canonical writes are clearly distinguished.
- report totals accurately represent their stated meaning.
- aggregate counts can be reconciled with source-level counts.
- the 2026 dry-run no longer contains unexplained contradictory totals.
- confirmed fixes have focused regression coverage.
- no secrets are exposed.
- no production data is modified.
