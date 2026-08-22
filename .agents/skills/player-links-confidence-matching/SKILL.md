---
name: player-links-confidence-matching
description: Review and improve AFLDB admin/player-links by adding explainable, database-backed candidate matching, confidence scoring, ranked suggestions, bulk review, and safe approval workflows for unmatched external players.
---

# AFLDB Player Links — Confidence Matching & Review Skill

## Purpose

Improve `/admin/player-links` so Super Admins do not need to manually search for every unmatched player.

The system should use the information already available for an unmatched/external player — such as:

- player name
- date of birth
- seasons / years played
- clubs played for
- games played
- goals
- other available career totals or source metadata

—to identify likely existing AFLDB players and present ranked suggestions with an explainable confidence score.

The objective is to automate candidate discovery, **not to silently create uncertain links**.

High-confidence matches may be offered for bulk approval, but the system must remain conservative where identity is ambiguous.

---

## Working Rules

1. Work only in the current AFLDB repository and connected development database.
2. First inspect the existing `/admin/player-links` implementation, data model, source-link tables, player schema, admin actions, and current matching logic.
3. Do not assume column names or table relationships. Verify them from the code and database.
4. Reuse existing services, repository helpers, server actions, validation, permissions, UI components, and audit patterns where possible.
5. Do not introduce an LLM dependency for player identity matching.
6. Matching must be deterministic, testable, explainable, and reproducible.
7. Do not silently link uncertain players.
8. Super Admin must be able to inspect why a suggestion received its score before approving it.
9. Preserve existing manually created links.
10. Never overwrite an existing confirmed player link without an explicit Super Admin action.
11. Prevent two external identities from being incorrectly linked to one local player where the existing schema/business rules prohibit it.
12. Keep the page performant. Do not compare every unmatched player against every player in the database if a candidate-blocking strategy can reduce the search space.

---

# Phase 1 — Review Current Implementation

Inspect all code involved in `/admin/player-links`, including:

- page / route
- components
- server actions
- player search
- source-player records
- existing player links
- unmatched-player data
- player profile / career data
- permissions / Super Admin checks
- audit logging
- revalidation behaviour
- database queries

Document:

1. Where unmatched players come from.
2. Which fields are available for each unmatched player.
3. Which fields exist on canonical AFLDB players.
4. How links are currently written to the database.
5. Whether one canonical player can have multiple external/source identities.
6. Existing uniqueness constraints.
7. Existing admin audit/history mechanisms.
8. Current page performance characteristics.
9. Whether suggestions can be calculated efficiently at request time or should be cached/materialised.

Do not change code until the current flow is understood.

---

# Phase 2 — Profile the Available Matching Data

Using the development database, determine how useful each potential identity signal is.

At minimum inspect:

- full player name
- first name
- surname
- initials
- common abbreviations
- punctuation differences
- accents / apostrophes / hyphens
- date of birth
- debut / first season
- final / last season
- clubs represented
- games
- goals
- source-specific player IDs
- career totals that exist in both datasets

Determine:

- how many unmatched players have DOB
- how many have club history
- how many have active year ranges
- how many have career games/goals
- how often names are duplicated in AFL/VFL history
- how often DOB is duplicated
- how often same-name players overlap in era

Use this analysis to tune matching weights based on actual AFLDB data rather than arbitrary assumptions.

---

# Phase 3 — Candidate Generation

Do not score every AFLDB player.

Generate a small candidate set first.

Recommended blocking rules:

### Strong candidate blocks

Include players when one or more of the following is true:

- exact normalised full name
- exact surname + compatible first name / initial
- exact DOB
- near-name + overlapping playing era
- near-name + shared club

### Name normalisation

Normalise names before comparison:

- lowercase
- trim whitespace
- collapse repeated whitespace
- remove harmless punctuation differences
- normalise apostrophes
- normalise hyphens where appropriate
- support initials
- support known aliases only when backed by existing AFLDB alias data

Do not make aggressive nickname assumptions unless AFLDB already stores aliases.

### Candidate rejection

Reject obvious impossible candidates early, for example:

- DOB conflict beyond configured tolerance
- non-overlapping career era where the source years are reliable
- incompatible clubs where both records contain complete club histories
- external player already linked elsewhere
- local candidate already conflicts with an established unique source link

---

# Phase 4 — Confidence Scoring

Implement a deterministic score from `0` to `100`.

The exact weights must be validated against the actual dataset, but start with the following model.

## Positive signals

### Date of birth

- exact DOB: `+40`
- DOB differs by 1 day and source quality is known to contain timezone/date conversion issues: `+15` maximum, only if such errors are proven in the dataset
- DOB missing on either side: `0`
- conflicting DOB: strong penalty / candidate rejection

### Name

- exact normalised full name: `+25`
- surname exact + first name exact after normalisation: `+25`
- surname exact + first initial compatible: `+14`
- strong fuzzy name similarity: `+8 to +18`
- weak fuzzy similarity: do not rely on it alone

### Playing years

- exact first and last season: `+15`
- strong overlapping career window: `+8 to +12`
- partial overlap: `+3 to +7`

### Clubs

- complete club set exact: `+15`
- substantial club overlap: `+8 to +12`
- one shared club: `+4 to +7`

### Games / goals / career totals

When the field is known to be comparable between sources:

- exact career games: `+5`
- exact career goals: `+5`
- close totals within a documented source tolerance: smaller score

Do not compare statistics that have different historical coverage or definitions.

---

## Negative signals

Apply explicit penalties for contradictions.

Examples:

- conflicting DOB: `-60` or reject
- no overlap in reliable playing years: `-35`
- completely different clubs with complete histories: `-25`
- same name but materially different career totals: `-15`
- candidate already linked to a conflicting source identity: reject or `-100`

A strong contradiction must be able to outweigh several weak positive signals.

---

# Phase 5 — Confidence Bands

Use both a numeric score and a human-readable band.

Suggested starting bands:

### 95–100 — Very High

Expected characteristics:

- exact name + exact DOB
- and/or exact name + DOB + matching career/club evidence

UI treatment:

- green / strongest indicator
- eligible for bulk approval
- still show evidence

### 85–94 — High

Expected characteristics:

- strong identity agreement across several independent fields
- no material contradictions

UI treatment:

- prominent recommendation
- one-click approve
- optionally eligible for bulk approval after validation proves precision is acceptable

### 70–84 — Medium

Expected characteristics:

- plausible candidate
- missing one major identity signal or some ambiguity exists

UI treatment:

- manual review required
- never auto-approve

### 50–69 — Low

UI treatment:

- show only when useful
- clearly mark as uncertain
- manual search should remain easy

### Below 50

Do not present as a recommended match by default.

The thresholds are initial values only. Validate them against known linked players before adopting them.

---

# Phase 6 — Explainability

Every candidate displayed in the admin UI must explain its score.

Example:

`96% — Very High confidence`

Reasons:

- Name exact: `+25`
- DOB exact: `+40`
- Career years 1984–1995 exact: `+15`
- Clubs: Richmond exact: `+11`
- Career goals exact: `+5`

Also show contradictions, if any:

- Games differ: source 187 / AFLDB 188: `-4`

Do not expose only a mysterious percentage.

---

# Phase 7 — Admin UI

Enhance `/admin/player-links` with a workflow designed for fast review.

For each unmatched player show:

### Source / unmatched player

- name
- DOB
- years active
- clubs
- games
- goals
- source
- source player ID if useful

### Best AFLDB candidate

- canonical player name
- DOB
- career years
- clubs
- games
- goals
- player profile link
- confidence score
- confidence band
- evidence / score breakdown

### Alternative candidates

Show the next `2–4` candidates when sufficiently plausible.

This is important for common names and ambiguous historical records.

### Actions

Provide:

- `Approve suggested match`
- `Choose alternative`
- `Search players`
- `No valid match / leave unmatched`
- `Reject suggestion`

If supported by the current data model, consider:

- `Mark as reviewed`
- `Create player` only through the existing canonical workflow

---

# Phase 8 — Bulk Review

Add a bulk-review mode for high-confidence rows.

Possible workflow:

1. Filter to `Very High` confidence.
2. Preselect only rows meeting a conservative threshold.
3. Super Admin reviews the evidence.
4. Super Admin explicitly clicks `Approve selected`.
5. Show the number of links that will be created.
6. Persist through the same validated link action used by single approval.

Never perform bulk linking simply because the page loaded.

Do not preselect rows with:

- conflicting evidence
- duplicate candidate collisions
- ambiguous same-name candidates
- existing source-link conflicts

---

# Phase 9 — Collision Detection

Before bulk approval, detect cases where:

- two unmatched records have the same highest-ranked local candidate
- a source player is already linked
- a local player has an incompatible existing source link
- two candidates have nearly identical scores

Flag these as `Needs review` even if their raw score is high.

A useful ambiguity rule is:

- if best candidate score is high but the gap between candidate #1 and candidate #2 is too small, downgrade the recommendation

Example:

- Candidate A: `93`
- Candidate B: `91`

This should not behave like a normal 93-confidence suggestion.

Introduce a `candidate gap` / `margin` concept.

Example starting rule:

- best score >= 90
- AND score gap to second candidate >= 10
- AND no hard contradictions

Only then consider the record `Very High confidence` for bulk review.

---

# Phase 10 — Suggested Confidence Model

Use a structure similar to:

```ts
type PlayerMatchEvidence = {
  nameScore: number;
  dobScore: number;
  yearsScore: number;
  clubScore: number;
  gamesScore: number;
  goalsScore: number;
  penalties: Array<{
    reason: string;
    value: number;
  }>;
};

type PlayerMatchCandidate = {
  playerId: number;
  score: number;
  confidence: "very_high" | "high" | "medium" | "low";
  evidence: PlayerMatchEvidence;
  hardConflict: boolean;
};
```

Keep scoring code outside UI components.

Prefer a dedicated module such as:

```text
lib/player-matching/
  normalise-name.ts
  candidate-search.ts
  score-candidate.ts
  confidence.ts
  types.ts
```

Use the repository's actual conventions after inspection rather than forcing this structure if a better existing location exists.

---

# Phase 11 — Validate Against Existing Confirmed Links

This is mandatory before exposing bulk approval.

Use existing known-good player links as a labelled validation dataset.

For each confirmed link:

1. Temporarily treat it as unmatched in the test harness.
2. Generate candidates.
3. Rank them.
4. Record whether the true player is candidate #1.
5. Record confidence score.
6. Record the margin to candidate #2.

Produce metrics such as:

- Top-1 accuracy
- Top-3 accuracy
- precision for score >= 95
- precision for score >= 90
- precision for score >= 85
- number of ambiguous collisions
- number of false-positive `Very High` suggestions

Target for bulk-review eligibility should be extremely conservative.

For example:

- `Very High` bucket should ideally demonstrate effectively 100% precision on the available validation set before bulk approval is enabled.

If it does not, raise the threshold or adjust the scoring model.

---

# Phase 12 — Database Truth Checks

Manually inspect samples from each band:

- 20 Very High
- 20 High
- 20 Medium
- 20 Low / rejected

Pay special attention to:

- duplicate player names
- fathers/sons with similar names
- players who changed clubs
- players with abbreviated names
- historical players with incomplete DOB
- incomplete stat coverage
- players whose source career totals differ slightly

Do not tune the model only against modern players with rich data.

---

# Phase 13 — Persistence

When Super Admin approves a suggestion:

1. Re-read the current source player and target canonical player server-side.
2. Verify neither side has changed since the suggestion was generated.
3. Re-check link conflicts.
4. Persist using the existing canonical linking mechanism.
5. Record audit information if the project already supports it.
6. Refresh/revalidate the necessary admin UI.

The confidence score is advisory evidence, not permission to bypass server-side validation.

If practical, record the match metadata:

- match method: `manual`, `suggested`, `bulk_suggested`
- score at approval
- algorithm/version
- approving admin
- timestamp

Do not modify schema solely for this unless the existing model cannot support the required auditability and a schema change is justified.

---

# Phase 14 — Performance

The admin page must remain responsive with a large unmatched set.

Prefer:

- database candidate filtering
- indexed exact DOB lookup
- indexed / normalised surname lookup where practical
- era filters
- club filters
- pagination
- server-side ranking
- limited candidate count per unmatched player

Avoid:

- loading the entire players table into the browser
- client-side O(unmatched × all players) matching
- one database round trip per field per row

Measure performance before and after.

---

# Phase 15 — Filters and Queue Views

Consider adding filters for:

- Very High
- High
- Medium
- No suggestion
- Ambiguous
- Collision
- Already reviewed
- source
- club
- era

Default queue should prioritise the easiest wins:

1. Very High
2. High
3. Ambiguous high-score cases
4. Medium
5. No candidate

This should let an administrator clear hundreds of obvious matches quickly before handling difficult records.

---

# Phase 16 — Testing

Add tests for:

## Name matching

- exact names
- case differences
- whitespace
- apostrophes
- hyphens
- initials
- similar but different names

## DOB

- exact DOB
- missing DOB
- conflicting DOB

## Career years

- exact range
- overlapping range
- impossible range

## Clubs

- exact club list
- subset
- one-club overlap
- no overlap

## Statistics

- exact games/goals
- near values
- conflicting values

## Ranking

- true player ranks first
- ambiguous candidates are flagged
- candidate gap logic works
- contradictions lower score

## Safety

- existing links cannot be overwritten accidentally
- duplicate bulk target is blocked
- non-Super Admin cannot approve
- bulk action validates every selected record server-side

## UI

- score and confidence displayed
- evidence visible
- alternatives selectable
- approve action updates row correctly
- rejected / reviewed state behaves correctly

---

# Phase 17 — Deliverables

When complete, provide:

1. Summary of the existing player-link architecture.
2. Database fields available for matching.
3. Candidate generation approach.
4. Final confidence formula and reasoning.
5. Validation metrics using confirmed links.
6. Files changed.
7. Tests added and results.
8. Database truth checks performed.
9. Performance comparison.
10. Any unresolved ambiguous cases.
11. Recommended threshold for bulk-review eligibility.
12. Screenshots or browser verification of the updated admin workflow if browser tooling is available.

---

# Required Outcome

The completed `/admin/player-links` workflow should allow a Super Admin to see something similar to:

```text
Unmatched source player
------------------------------------------------
John Smith
DOB: 12 Mar 1972
Played: 1991–1998
Clubs: Richmond
Games: 104
Goals: 37

Best AFLDB match
------------------------------------------------
John Smith             97% — VERY HIGH
DOB: 12 Mar 1972       exact       +40
Name                    exact       +25
Years: 1991–1998        exact       +15
Club: Richmond          exact       +12
Goals: 37               exact        +5

[Approve match] [Alternatives] [Search manually]
```

For an ambiguous player:

```text
Best match: John Brown       88%
Alternative: John M Brown   85%
Gap: 3

Status: NEEDS REVIEW
Reason: two plausible candidates have similar confidence.
```

The system must optimise for **correct links first, speed second**.

A false positive is more damaging than leaving a player unmatched.
