# AFLDB-ISSUE-170 — Coach profile expansion and coach comparison

**Status:** IN PROGRESS — Stage 0 discovery COMPLETE; Stages 1A–1D and 2A–2D implemented and
committed; Stage 1E (route-contextual profiles, the acceptance correction) implemented, browser
accepted, UNCOMMITTED. `CHANGELOG.md` entry owed when the feature lands.
**Area:** Public coaches / Player coaching history / Comparison
**Created:** 2026-09-14
**Branch:** `feature/issue-170-coach-overhaul`
**Worktree:** `D:\dev\afldb-issue-170`

## Objective

Expand AFLDB's coaching surfaces from the existing career summary into a richer historical
record, then add a two-coach comparison surface.

The feature must continue to derive coaching history from canonical AFLDB match data. It must
not introduce a second source of truth for coach totals.

The required user-facing capabilities are:

1. richer coach career history;
2. biggest win and biggest loss;
3. venue history;
4. record against a selected opposition club;
5. the same richer coaching history for coaches whose canonical public page is a player page;
6. comparison of two coaches;
7. direct coach-v-coach head-to-head where they actually opposed each other.

---

## 0. Discovery — COMPLETE

Read-only discovery was run against:

- database: `afldb_test`
- connection: `127.0.0.1:55432`
- database guard: `_test`
- PostgreSQL session: `default_transaction_read_only = on`

Diagnostic artefacts are under the gitignored directory:

`artifacts/issue-170/`

No application code, schema, migration or production data was changed during discovery.

### 0.1 Existing architecture

Current coaching records are derived from canonical:

- `coaches`
- `match_coaches`
- `matches`
- `clubs`
- `venues`

The existing `getCoachCareer(coachId)` read model already derives:

- games;
- wins;
- losses;
- draws;
- win percentage;
- finals;
- Grand Finals;
- premierships;
- club coaching stints.

The public routing architecture has an important constraint:

- coach-only identities can render `/coaches/[slug]`;
- a coach linked to a player redirects to that player's canonical player page;
- linked player/coaches currently receive coaching history through `PlayerCoachingCareer`.

Therefore ISSUE-170 MUST NOT implement the richer history only on the standalone coach route.
The read model and primary coaching presentation must be reusable by both coach-only and
player-linked surfaces.

### 0.2 Coach population

Discovery result:

- coaches: 386
- coaches linked to player identities: 368
- coach-only identities: 18
- unique player links: 368
- coaches with at least one canonical match assignment: 385

One coach identity currently has no `match_coaches` assignment:

- Jim Adamson — coach ID 315, player ID 6962

This is a supported zero-game edge case. ISSUE-170 must render safely when a coach exists but
has no canonical coaching assignments. It is not a requirement of ISSUE-170 to manufacture or
backfill coaching history for that identity.

### 0.3 Canonical coaching coverage

`match_coaches` contains:

- 32,452 coach-match assignments;
- 385 coaches with games;
- 16,426 matches with at least one coach;
- seasons 1902–2026.

Across all 17,051 matches:

- 16,026 have both coaches;
- 400 have one coach;
- 625 have no coach;
- 0 have more than two coaches;
- 0 have duplicate club assignments.

Historical incompleteness is concentrated in early seasons:

| Era | Matches | Both coaches | One coach | No coach |
|---|---:|---:|---:|---:|
| pre-1920 | 1,714 | 737 | 356 | 621 |
| 1920s | 935 | 902 | 33 | 0 |
| 1930s | 1,120 | 1,120 | 0 | 0 |
| 1940s | 1,102 | 1,091 | 11 | 0 |
| 1950s | 1,126 | 1,126 | 0 | 0 |
| 1960s | 1,145 | 1,145 | 0 | 0 |
| 1970s | 1,378 | 1,378 | 0 | 0 |
| 1980s | 1,446 | 1,446 | 0 | 0 |
| 1990s | 1,761 | 1,761 | 0 | 0 |
| 2000s | 1,850 | 1,850 | 0 | 0 |
| 2010s | 2,037 | 2,037 | 0 | 0 |
| 2020s | 1,437 | 1,433 | 0 | 4 |

The four modern matches without coach assignments are current-season 2026 finals:

- Fremantle v Hawthorn — 2026 QF, 3 Sep 2026
- Geelong v Carlton — 2026 EF, 4 Sep 2026
- Adelaide v Western Bulldogs — 2026 EF, 5 Sep 2026
- Sydney v Brisbane Lions — 2026 QF, 5 Sep 2026

These are a current-season coach-ingestion/settlement concern and are OUT OF SCOPE for
ISSUE-170. The feature must simply tolerate absent coach assignments.

### 0.4 Score and margin coverage

All 32,452 canonical coach assignments have both home and away scores.

- missing scores: 0
- stored margin disagreements: 0
- coach-side resolution failures: 0
- largest available coach-perspective win: +190
- largest available coach-perspective loss: -190

Biggest win and biggest loss therefore require no new stored data.

Coach-perspective margin is:

- home coach: `home_score - away_score`
- away coach: `away_score - home_score`

Do not create stored coach-margin columns or coach summary tables.

### 0.5 Opponent lineage

All 32,452 coach assignments resolve an opposition club.

- unresolved opponent club: 0
- missing opponent organisation: 0
- coach/opponent-organisation pairs: 4,179
- opponent organisations represented: 21

"History against club" MUST use `clubs.organization_id`, not a single historical club identity.

This preserves one opposition history across identity/name lineage where AFLDB already considers
the club the same organisation.

### 0.6 Venue coverage

Venue coverage for canonical coach assignments is complete:

- assignments: 32,452
- mapped canonical venue: 32,452
- raw-only venue: 0
- no venue: 0
- canonical venues represented: 52
- coach/venue combinations: 3,776

Venue history can therefore use canonical `venue_id` directly.

No venue-repair migration or raw-name fallback is required by ISSUE-170.

### 0.7 Finals semantics

Existing canonical fields support the requested records:

- Finals: `matches.is_finals_series`
- Grand Finals: `matches.round_type = 'grand_final'`
- Premiership: Grand Final where `winner_club_id = coached club`

Observed:

- finals assignments: 1,380
- Grand Final assignments: 244
- premiership assignments: 119

These semantics remain authoritative for ISSUE-170.

### 0.8 Direct coach-v-coach viability

Direct opposition can be derived by joining the coach assigned to the home club and the coach
assigned to the away club for the same match.

Coverage:

- matches with both coaches: 16,026
- distinct coach-v-coach matchups: 3,962
- first direct matchup season: 1904
- latest: 2026

Examples proving useful historical depth include:

- Mick Malthouse v Kevin Sheedy — 47 meetings
- Tom Hafey v Ron Barassi — 46
- Jock McHale v Frank Hughes — 43
- Kevin Sheedy v David Parkin — 41
- Alastair Clarkson v Chris Scott — 28 through 2026

Direct H2H is therefore a real data-backed feature, not an inferred relationship.

### 0.9 Index/performance baseline

Relevant existing indexes include:

- `ix_match_coaches_coach (coach_id, match_id)`
- `match_coaches_pkey (match_id, club_id)`
- `ix_matches_home (home_club_id, season)`
- `ix_matches_away (away_club_id, season)`
- `ix_matches_venue (venue_id)`
- `ix_matches_winner (winner_club_id)`
- `ix_matches_finals_series`
- `ix_clubs_organization (organization_id, first_season)`

Whole-history discovery aggregations completed in roughly 7–126 ms on the test database.

Therefore:

**No new index is authorised by planning alone.**

A new index may be added only if implementation query plans or measured acceptance evidence show
a real regression.

### 0.10 Stage 0 architecture decision

PASS.

ISSUE-170 is primarily a:

- read-model;
- query;
- server-rendered UI;
- route/state;
- test

feature.

There is currently no evidence requiring:

- a migration;
- stored coach summary tables;
- duplicated career totals;
- stored opponent records;
- stored venue records;
- stored coach-v-coach records.

Canonical match-level data remains the source of truth.

---

# Stage 1 — Coach profile expansion

## Stage 1A — Shared rich coaching read model

Extend/reuse the existing coach career query boundary.

Required career totals:

- Games
- Wins
- Losses
- Draws
- Win %
- Finals
- Grand Finals
- Premierships

Win percentage retains the existing AFLDB definition:

`(wins + draws * 0.5) / games * 100`

Add:

### Biggest win

Return sufficient match context to display and link the record:

- match ID/key or canonical match-link identity;
- season;
- date;
- coached club;
- opponent;
- coach-perspective margin;
- venue;
- finals context where useful.

### Biggest loss

Same contract as biggest win.

Tie behaviour must be deterministic.

Preferred ordering:

1. largest absolute relevant margin;
2. earliest or latest match date, explicitly selected and tested;
3. stable match ID/key as final tie-break.

Do not allow PostgreSQL's incidental row order to choose a tied record.

### Zero-game behaviour

A coach identity with no `match_coaches` rows must not:

- crash;
- divide by zero;
- display invented zero-value historical claims as if coverage were complete.

Render an explicit no canonical coaching match record state.

## Stage 1B — Venue history

Add per-coach venue history derived from canonical venue IDs.

For each venue expose:

- venue name / slug;
- Games;
- Wins;
- Losses;
- Draws;
- Win %;
- Finals;
- Grand Finals;
- first coached match/date;
- most recent coached match/date.

Sort order should prioritise coaching games, then use a deterministic venue-name tie break.

Do not create stored coach-venue summary data.

## Stage 1C — History against club

Provide a club/opponent selector from valid AFLDB club organisations.

The selected opponent is scoped by `organization_id`.

For the selected organisation show:

- Games;
- Wins;
- Losses;
- Draws;
- Win %;
- Finals;
- Grand Finals;
- biggest win;
- biggest loss;
- venue history.

The record is always from the selected coach's perspective.

Historical identity changes inside one AFLDB organisation must not split the record.

URL state should be shareable/bookmarkable rather than client-only hidden state.

## Stage 1D — Shared presentation

The richer coaching history must be available on BOTH canonical public surfaces:

1. standalone coach pages for coach-only identities;
2. player pages for player-linked coaches.

Do not duplicate two independently maintained implementations.

Prefer a shared server-renderable coaching history component/read model with surface-specific
wrappers only where genuinely required.

Existing player-to-coach canonical redirect behaviour remains unchanged unless implementation
evidence demonstrates a separate routing defect.

**Superseded by Stage 1E:** Stage 1 acceptance demonstrated exactly that routing defect.

## Stage 1E — Route-contextual profiles (acceptance correction, 2026-09-14)

Stage 1 acceptance found that `/coaches/[slug]-id` permanently redirected a player-linked coach
to `/players/[slug]-id`, so selecting a coach through Coaches delivered a PLAYER profile: Mick
Malthouse opened with playing statistics, "Compare with another player" as the primary action and
his coaching record at the bottom of the page. Coach-context links (the coaches index, the coach
records board, a club's coaching table, the Stage 2 comparison) pointed straight at `/players` for
the same reason, so the defect did not need the redirect to reproduce.

The correction: **route context decides presentation, identity does not.**

- `/coaches/[slug]-id` renders the coach-oriented profile for EVERY coach, player-linked or not.
  The permanent redirect to the player route is removed.
- `/players/[slug]-id` remains the player-oriented profile and keeps its Coaching Career section.
- Neither route is a redirect alias of the other. Each is canonical to itself, and the coach
  page's `Person` block carries `sameAs` pointing at the player page so the two documents are
  readable as one human rather than two.
- The coach page's primary comparison action is **Compare with another coach**, linking to
  `/coaches/compare?a=<coach id>` with the coach preselected. "Compare with another player" does
  not appear on the coach route.
- A player-linked coach page carries a secondary **View playing career** link.
- `coachProfilePath` — the one helper every coaching surface links through — now always resolves
  to the coach route. It previously resolved a player-linked coach to `/players` precisely because
  the coach route redirected there.
- The sitemap publishes every coach page, not only the coach-only identities. ~368 real pages were
  previously unpublishable because they redirected.

The only presentation change beyond routing is `W–L–D` added to the coach page's stat strip, so
every headline figure this issue requires is visible without scrolling.

Still deliberately unchanged: `searchCoaches` remains scoped to `player_id IS NULL`, so the site
search box returns a person who both played and coached once, as a player. Revisit only with
evidence that a reader expects both.

### Stage 1E acceptance

- `tests/coach-profile-route.test.ts` (new): the route contract — no redirect for a player-linked
  coach, coach-only unchanged, coaching data primary, compare-with-coach preselected, playing-career
  link, self-canonical metadata, `sameAs`, one-hop stale-slug redirect, no loop.
- `tests/format.test.ts`, `tests/club-coach-records.test.ts`,
  `tests/integration/coach-comparison-route.test.ts`: the three suites that encoded the old
  link-to-player rule, updated to the new one.
- `tests/e2e/journeys.spec.ts`: the two-route browser journey through Mick Malthouse.
- Browser acceptance on the running DEV build, 2026-09-14: `/coaches` links Malthouse to
  `/coaches/mick-malthouse-1` (all 386 rows link to coach pages); that URL renders 200 with no
  redirect, leads with 718 games / 406–305–7 / 57.0% / 52 finals / 8 GFs / 3 premierships, the
  club, biggest win/loss, venue and history-against-club sections, `Compare with another coach →`
  = `/coaches/compare?a=1` (verified preselected) and `View playing career →` =
  `/players/mick-malthouse-9635`; `/players/mick-malthouse-9635` renders 200, player-centric, with
  `Compare with another player →` and Coaching Career as its last section; a stale coach slug
  redirects once to the coach route; `/records/coaches` (74 links) and `/clubs/collingwood` (20)
  resolve every coach name to a coach page.

## Stage 1 acceptance

Stage 1 is complete when focused tests prove:

- existing career totals remain correct;
- biggest win/loss perspective is correct for home and away coaching assignments;
- draws do not become wins/losses;
- finals and Grand Final semantics remain canonical;
- tied biggest margins are deterministic;
- venue aggregation is correct;
- opponent history uses organisation lineage;
- zero-game coaches render safely;
- coach-only profile receives the richer UI;
- linked player/coach receives the same richer data;
- a player-linked coach reaches a coach-oriented profile through `/coaches`, not a player one
  (Stage 1E);
- historical missing coach assignments do not break rendering;
- responsive rendering is acceptable on public breakpoints.

---

# Stage 2 — Compare coaches

## Stage 2A — Comparison route and selection

Create a public two-coach comparison surface following AFLDB's existing comparison conventions
where practical.

Requirements:

- select coach A;
- select coach B;
- canonical/shareable URL state;
- swap direction;
- reject/handle same-coach comparison deliberately;
- useful empty state before two coaches are selected.

The selector must operate on canonical coach identities, including coach-only and player-linked
coaches.

## Stage 2B — Side-by-side career comparison

For each selected coach show:

- Games
- Wins
- Losses
- Draws
- Win %
- Finals
- Grand Finals
- Premierships
- biggest win
- biggest loss
- career seasons
- clubs/organisations coached
- venue record summary

Career comparison is independent of whether the coaches ever directly opposed one another.

## Stage 2C — Direct coach-v-coach head-to-head

Where both coaches were assigned to opposing clubs in the same match, show their direct record.

Required:

- meetings;
- wins for coach A;
- wins for coach B;
- draws;
- win percentage/perspective as appropriate;
- Finals meetings;
- Grand Final meetings;
- first meeting;
- most recent meeting;
- biggest win for coach A over coach B;
- biggest win for coach B over coach A;
- venues where they met.

Do not call two careers "head-to-head" merely because their active seasons overlap.

A direct H2H match exists only when both coach assignments exist on opposing clubs in the same
canonical match.

If the coaches never directly opposed each other:

- career comparison still renders;
- H2H explicitly states that no canonical direct meetings are recorded.

Historical matches with only one/no coach assignment are excluded from direct H2H rather than
having the missing coach inferred.

## Stage 2D — Useful comparison context

Add only evidence-backed context that materially improves comparison.

Candidates:

- overlapping coaching seasons;
- number of common active seasons;
- clubs coached;
- shared club organisations, if any;
- common venues;
- finals meetings;
- Grand Final meetings.

Avoid novelty statistics that duplicate existing values or require unreliable inference.

---

# Stage 3 — Validation and performance

Before completion:

1. run focused query/read-model tests;
2. run focused component/route tests;
3. test coach-only and player-linked identities;
4. test one long-career multi-club coach;
5. test organisation-lineage behaviour;
6. test a known direct H2H pair;
7. test two coaches with no direct H2H if available;
8. test the zero-assignment coach edge;
9. measure representative query execution;
10. inspect query plans only where performance warrants it;
11. run relevant typecheck/build gates required by the changed boundary;
12. perform rendered desktop/mobile acceptance.

No migration/index is added merely because one could theoretically improve a query.

---

# Explicit non-goals

ISSUE-170 does NOT:

- repair historical missing coach assignments;
- repair the four currently coachless 2026 finals;
- backfill Jim Adamson;
- redesign coach administration;
- alter coach/player linkage rules;
- replace canonical player routing;
- create manually maintained coach career totals;
- create stored coach-v-club aggregates;
- create stored coach-v-venue aggregates;
- create stored coach-v-coach aggregates;
- broaden into Natural Language Search;
- change current-season acquisition/settlement.

Any genuine defect discovered in those areas should be separately evidenced and allocated rather
than silently absorbed into ISSUE-170.

---

# Implementation principle

`match_coaches` records who coached each club in a match.

`matches` records the result, scores, finals status, venue and participating clubs.

`clubs.organization_id` provides the lineage boundary for opponent history.

Those canonical facts are sufficient to derive ISSUE-170.

The implementation should therefore prefer small composable read models over new persistence.

