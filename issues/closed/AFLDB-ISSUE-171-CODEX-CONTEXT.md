# AFLDB-ISSUE-171 — Codex context pack (v2)

Generated for the ISSUE-171 worktree discovery/implementation handoff.

## Objective

Expand the AFL home-page **Record of the week** setting beyond the current five career-player categories. The implementation should become a curated, typed catalogue capable of rendering multiple record domains/grains without turning the feature into a query builder.

## Current home-record contract

Current relevant files on `main`:

- `src/lib/site-settings.ts`
- `src/app/admin/settings/page.tsx`
- `src/app/admin/settings/SettingsForm.tsx`
- `src/app/page.tsx`
- `src/db/queries/records.ts`
- `src/db/queries/site-settings.ts`
- `src/app/admin/settings/actions.ts`

`src/lib/site-settings.ts` currently owns `HOME_RECORD_CATEGORIES` and deliberately restricts it to five career categories because the home panel assumes the `getCareerRecord()` five-name leaderboard shape.

Current allowed AFL values:

- `most-goals`
- `most-games`
- `most-finals`
- `most-premierships`
- `most-brownlow-votes`

`src/app/admin/settings/page.tsx` turns those values into `{ value, label }` using `RECORD_CATEGORIES`, then `SettingsForm.tsx` renders them in one `<select>`.

Existing persisted values must remain valid.

## Existing player record surfaces

`src/db/queries/records.ts` already contains these public record categories:

### Career grain
- Most Games
- Most Goals
- Most Finals
- Most Premierships
- Most Brownlow Votes

Backed by `player_career_stats`.

### Match grain
- Most Goals in a Match
- Most Disposals in a Match

Backed by `player_match_stats` + `matches`.

### Season grain
- Most Goals in a Season

Backed by `player_season_stats`.

Important semantics already encoded there:
- match/season categories are not career rows;
- era-limited statistics preserve NULL/not-recorded semantics;
- rank is calculated over the complete population before filters;
- column selection comes from fixed compile-time maps.

ISSUE-171 should reuse these definitions instead of reimplementing them.

## Coach domain

Primary source: `src/db/queries/coaches.ts`.

Canonical coaching totals are derived from:

- `coaches`
- `match_coaches`
- `matches`
- `clubs`
- `venues`

`getCoachCareer(coachId)` already derives, from canonical per-match assignments:

- games
- wins
- draws
- losses
- finals
- grand finals
- premierships
- win percentage using `(wins + draws * 0.5) / games * 100`
- biggest win
- biggest loss
- per-club records
- per-venue records

This works for coach-only people with `coaches.player_id IS NULL`, so home-record coach links must target `/coaches/...`, not assume a player profile.

Strong ISSUE-171 candidates:
- most games coached
- most wins coached
- most finals coached
- most Grand Finals coached
- most premierships coached
- best coaching win percentage with an explicit minimum-games threshold

Do not rank `source_games_coached`: that is evidence only, not the canonical total.

## Venue domain

Primary source: `src/db/queries/venues.ts`.

`listVenues()` already ranks venues by total matches.

ISSUE-150 added canonical venue read models including:

- total matches
- recorded-attendance coverage
- average recorded attendance
- first/latest match
- club W-D-L records
- highest attendance
- lowest recorded attendance
- highest single-team score
- biggest winning margin
- top players at venue for games/goals/marks/kicks/handballs

Important semantics:
- attendance NULL means unrecorded and must never become zero;
- historical club identities remain historical;
- era-limited player statistics exclude NULL rather than coercing to zero;
- deterministic tie-breaks are part of the existing contract.

Strong ISSUE-171 venue candidates:
- most VFL/AFL matches hosted
- most finals hosted
- most Grand Finals hosted
- highest recorded attendance (venue attached to the match)
- highest average recorded attendance only if a sensible minimum-recorded-match threshold is declared

Avoid inventing a venue statistic that the existing model cannot support cleanly.

## Goal with first kick

Primary source: `src/db/queries/player-achievements.ts`.

This is a curated/source-backed achievement family, not a computed numeric column leaderboard.

Canonical public rows are `player_achievements` where:
- `achievement_type = 'first_kick_goal'`
- `status = 'active'`

Public list rows already expose:
- linked player or source name
- season
- round
- club/opponent
- resolved match
- consecutive goal kicks
- no further career goals
- no further career kicks
- kickless matches before first kick

Existing summary/read models provide:
- total / linked / unlinked
- earliest / latest season
- multi-kick count
- only-career-goal count
- resolved-match count
- earliest/latest highlights
- by-club counts
- by-decade counts

Important: unlinked source rows are intentionally retained and publicly meaningful. Aggregates that claim player identity should follow the existing linked-row semantics.

Good ISSUE-171 presentation candidates:
- most consecutive goals from first career kicks
- earliest recorded first-kick-goal event
- most recent recorded first-kick-goal event
- a deterministic first-kick-goal feature list

Do not pretend this family is ordinary play-by-play data: it exists because a curated cited source says the event occurred.

## After-the-siren domain

Primary source: `src/db/queries/after-siren.ts`.

Canonical table: `after_siren_kicks`, active rows only.

`getAfterSirenRecords()` already derives per linked player:
- attempts
- goals
- behinds
- misses
- goals to win
- goals to draw
- first attempt
- last attempt
- first goal
- last goal

Existing comments explicitly describe these as Records boards for:
- most attempts
- most goals

Strong ISSUE-171 candidates:
- most after-the-siren attempts
- most after-the-siren goals
- most after-the-siren goals to win
- most after-the-siren goals to draw

These already have a natural ranked-player shape and are better first additions than forcing individual event rows into the old career leaderboard contract.

## Naming clarity discovered during UI review

A current/public-facing card labelled **“Father–Son Records”** is too vague when the underlying data specifically represents selections made under the AFL father–son rule.

For ISSUE-171 naming, prefer:

- **Father–Son Selections**

rather than:

- Father–Son Records

Suggested description:

> Players selected under the AFL father–son rule, ranked by combined career games.

This must remain clearly distinct from:

- **Most Games by Family**

which represents combined career games across a linked sibling family.

General naming rule for ISSUE-171:
- avoid generic “Records” labels when a more specific statistical noun exists;
- labels should communicate the actual grain/meaning of the card;
- different families should not sound interchangeable merely because they all live under `/records`.

## Recommended first catalogue shape

Do not make the stored setting contain SQL or a database column.

Use a compile-time catalogue with a stable key per option and metadata sufficient to resolve:

- stable value
- group/admin label
- public title
- definition
- unit/value label
- domain/grain
- provider/query
- row/render kind
- destination link, when one exists

Suggested admin groups:

1. Players — Career
2. Players — Match
3. Players — Season
4. Coaches
5. Venues
6. Special records

The existing five values should keep their exact persisted identifiers.

## Suggested INCLUDE set for first implementation

High-confidence, existing semantics/read models:

### Players — Career
- Most Goals
- Most Games
- Most Finals
- Most Premierships
- Most Brownlow Votes

### Players — Match
- Most Goals in a Match
- Most Disposals in a Match

### Players — Season
- Most Goals in a Season

### Coaches
- Most Games Coached
- Most Wins Coached
- Most Finals Coached
- Most Premierships Coached
- Best Win Percentage (with explicit minimum-games threshold)

### Venues
- Most Matches Hosted
- Most Finals Hosted
- Most Grand Finals Hosted
- Highest Recorded Attendance

### Special records
- Most After-the-Siren Attempts
- Most After-the-Siren Goals
- Most After-the-Siren Goals to Win
- Most Consecutive Goals from First Career Kicks

The exact final catalogue should be confirmed by the attached read-only evidence SQL output.

## Candidate DEFER set unless discovery proves a clean contract

- lowest attendance globally: technically answerable but weak as a home-page showcase;
- venue average attendance without a minimum sample threshold;
- first/most recent event rows as the only representation of a "record";
- arbitrary club/team aggregates merely because SQL can compute them;
- records whose only source is incomplete/unlinked identity without explicit wording.

## Performance constraint

The home page should:
1. load/parse the selected setting;
2. resolve exactly one catalogue entry;
3. run only that entry's provider;
4. render that result.

Do not execute every record query and then select one in memory.

Avoid per-row N+1 queries.

## Safety/backwards compatibility

- stale/unknown stored values must fall back to the default;
- existing five values remain accepted;
- no arbitrary stored SQL/column names;
- compile-time allow-lists only for any dynamic SQL expression;
- no migration solely to rename old values;
- preserve existing `site.settings` authorisation;
- AFLW behaviour remains out of scope except unavoidable shared typing.

## Data evidence

Run `ISSUE-171-DATA-EVIDENCE.sql` against `afldb_test` and save output to:

`AFLDB-ISSUE-171-DATA-EVIDENCE.txt`

Codex should read that file rather than asking the operator to paste the output into chat.

The evidence query is aggregate/read-only and is intended to settle:
- actual population/coverage;
- useful top values;
- threshold suitability;
- whether proposed catalogue entries have meaningful rows today.
