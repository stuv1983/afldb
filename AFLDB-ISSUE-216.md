# AFLDB-ISSUE-216 — `player_season_leaderboard` "posted...season tally..." / "...seasonal...total" phrasing declines with `unsupported_term`

Status: **IMPLEMENTED, NOT YET RESOLVED** — awaiting operator host validation on `streamanator`.

## 1. Problem, as given

Two large `player_season_leaderboard` exploratory clusters remain under `PARSER_VERSION` 62:

```text
576 — player_season_leaderboard/0
559 — player_season_leaderboard/3
--------------------------------
1135 rows
```

Representative `/0` failures:

```text
Which player posted the highest season tally of handballs for Collingwood during the 2010s
-> unsupported_term: posted season tally

Which player posted the highest season tally of kicks for Tigers after 1999
-> unsupported_term: posted season tally
```

Representative `/3` failures:

```text
Find the Port Adelaide player with the best seasonal goal assists total after 1999
-> unsupported_term: seasonal

Find the Fremantle player with the best seasonal kicks total before 2019
-> unsupported_term: seasonal
```

## 2. Scope proof — do the two clusters share one root cause?

`tools/nl/generate-exploratory-corpus-v2.mjs`, `player_season_leaderboard` generator (lines ~262-271):

```js
{ name:'player_season_leaderboard', n:2200, make() {
  const s=S(), c=C(), t=pick(TIME.filter(x=>x.q)), template=pick([0,1,2,3]);
  const q=[
    words('Which player posted the highest season tally of',s[0],'for',c[0],t.q),
    words('For',c[0]+',','who led the',s[0],'in a season',t.q),
    words('Most',s[0],'by a',c[0],'player in one season',t.q),
    words('Find the',c[0],'player with the best seasonal',s[0],'total',t.q),
  ][template];
  return row('player_season_leaderboard',template,q,
    temporal({grain:'player_season',metric:s[1],aggregation:'max',club:c[1]},t),
    {depth:3,scope:'club+time'});
}},
```

All four templates build the **identical** expected plan shape: `grain: 'player_season'`,
`aggregation: 'max'`, the same metric/club/time. They are four English phrasings of one semantic
construction, not four different questions.

Templates `/1` ("For `<club>`, who led the `<stat>` in a season `<time>`") and `/2` ("Most `<stat>` by a
`<club>` player in one season `<time>`") already score clean. Traced directly in `src/search/nl/parser.ts`:
with no player named, a club named, and a season named (either via the "in a season"/"in one season" idiom
or via `seasons.seasonMin`/`seasonMax`), the existing no-player/season-named `player_season` grain-election
branch (the block commented "No player named, a season WAS named...") already fires correctly, and neither
template leaves any word unconsumed.

`/0` and `/3` fail for **two different reasons**, traced below — they are not one mechanism.

## 3. Root cause, verified from current source

### 3a. Wrapper vocabulary (shared category, `/0` and `/3`)

Neither "posted", "season" (the literal word inside "season tally" — distinct from the already-consumed
"in a season" idiom), "tally", nor "seasonal" was ever claimed by any extractor in `src/search/nl/parser.ts`
or `src/search/nl/vocab.ts`. Each survives to `leftoverTokens`/`report.unsupportedTerms`
(`src/search/nl/parser.ts`, the confidence/leftover-token accounting near the end of
`parseNlQuestion`), which forces a decline via the clarify-band leftover-token gate even when grain
election is otherwise correct.

Confirmed: `/0`'s sole defect is this wrapper gap. With "posted"/"season"/"tally" hypothetically stripped,
`/0`'s grain election already lands correctly on `player_season` (see §3b for why — `/0` never sets
`aggregateTotal`).

### 3b. Grain-election defect (`/3` only, independent of §3a)

`/3`'s template ends in "...total `<time>`" — e.g. "the best seasonal goal assists total after 1999". The
bare word "total" is exactly what `AGGREGATE_TOTAL_WORDS`
(`src/search/nl/vocab.ts`: `/\b(?:total|combined|overall|cumulative|aggregate)\b(?!\s+(?:score|points))/`)
matches everywhere else in the parser as the "dusty TOTAL goals against Carlton" cue — a named player's
scoped RUNNING total across every game in range, not a per-season tally.

`aggregateTotal` is computed once, early (`src/search/nl/parser.ts`, `const aggregateTotal =
AGGREGATE_TOTAL_WORDS.test(text);`), before the wrapper words are ever inspected. The no-player/season-named
`player_season` grain-election branch requires `!aggregateTotal` among its guards. With `aggregateTotal` true
for `/3`, that branch's condition fails, and the unnamed-player question (`clubFor` set, so `scoped` is
true) falls through to the next matching branch: `scoped || inOneGame` → `grain = 'player_game', mode =
'sum'`. This silently answers "sum of goal assists for every Port Adelaide player across every game after
1999" instead of "the best single Port Adelaide season" — a different, wrong question, not merely a
leftover-token decline.

`/0`'s template has no "total"/"combined"/"overall"/"cumulative"/"aggregate" word anywhere
("...season tally of `<stat>` for `<club>` `<time>`"), so `aggregateTotal` is already `false` for `/0` and
this defect does not exist there — confirmed by direct trace of the template text, not assumed from the
shared family name.

**Conclusion:** `/0` and `/3` do **not** share one root mechanism. `/0` is a pure wrapper-vocabulary gap.
`/3` carries that same wrapper gap **plus** an independent grain-election defect. Both remain tightly-scoped
variants of one already-supported semantic construction (player-season leaderboard, club+time scoped), so
both are fixed together in this issue rather than splitting `/3` out as a separate follow-up.

## 4. Corpus expectation — verified, not assumed

The generator's `e` object (§2) is identical in shape across all four templates; no generator/scorer defect
found. Neither file touched.

## 5. Implementation

### 5a. `src/search/nl/vocab.ts` — three new gated cues

Added next to `CLUB_SEASON_SEASONAL_ADJECTIVE_RE` (the ISSUE-214 precedent this mirrors):

```ts
export const PLAYER_SEASON_LEADERBOARD_TALLY_RE = /\bseason tally\b/;
export const PLAYER_SEASON_LEADERBOARD_SEASONAL_RE = /\bseasonal\b/;
export const PLAYER_SEASON_LEADERBOARD_POSTED_RE = /\bposted\b/;
```

- `PLAYER_SEASON_LEADERBOARD_TALLY_RE` matches "season tally" as one phrase (not bare "tally"), so a
  genuinely unrelated "tally" elsewhere is untouched.
- `PLAYER_SEASON_LEADERBOARD_SEASONAL_RE` is read only once a real player_match_stats `METRIC_WORDS` match
  is already present in the text — the same gating discipline `CLUB_SEASON_SEASONAL_ADJECTIVE_RE` uses for
  the disjoint `CLUB_SEASON_METRIC_WORDS` vocabulary (wins/losses/draws/percentage). The two "seasonal"
  cues can never both match the same word: a question naming a player stat word never also matches
  `CLUB_SEASON_METRIC_WORDS`, and vice versa.
- `PLAYER_SEASON_LEADERBOARD_POSTED_RE` is read only once one of the two cues above has already matched, so
  bare "posted" elsewhere ("posted a big score") is never touched and does not become a universal request
  wrapper.

### 5b. `src/search/nl/parser.ts` — extraction, gated on a positive metric-word probe

Immediately after the existing `IN_ONE_GAME`/`IN_A_FINAL`/`IN_A_GRAND_FINAL`/`IN_ONE_SEASON`/`OVER_CAREER`/
`AGGREGATE_TOTAL_WORDS` cue-consumption loop:

```ts
const playerSeasonLeaderboardMetricWordPresent = METRIC_WORDS.some(([re]) => re.test(text));
const playerSeasonTallyMatch = playerSeasonLeaderboardMetricWordPresent
  ? PLAYER_SEASON_LEADERBOARD_TALLY_RE.exec(text) : null;
const playerSeasonSeasonalMatch = playerSeasonLeaderboardMetricWordPresent
  ? PLAYER_SEASON_LEADERBOARD_SEASONAL_RE.exec(text) : null;
const playerSeasonLeaderboardCue = !!playerSeasonTallyMatch || !!playerSeasonSeasonalMatch;
// ... consumed into consumedTokens / stripped from text ...
const playerSeasonPostedMatch = playerSeasonLeaderboardCue
  ? PLAYER_SEASON_LEADERBOARD_POSTED_RE.exec(text) : null;
```

`METRIC_WORDS` is probed (not yet consumed — `extractPlayerMetric` does not run until step 11), the same
positive-identification discipline ISSUE-214's `clubSeasonMetricWordPresent` uses. "total" itself needs no
new consumption logic: it was already unconditionally stripped by the pre-existing cue loop.

### 5c. `src/search/nl/parser.ts` — grain-election override, narrowly scoped

The no-player/season-named `player_season` branch's guard changes from:

```ts
!inOneGame && !aggregateTotal && !overCareer
```

to:

```ts
!inOneGame && (!aggregateTotal || playerSeasonLeaderboardCue) && !overCareer
```

The override fires **only** when `playerSeasonLeaderboardCue` was positively identified (§5b) — a real
metric word plus "season tally" or "seasonal". `aggregateTotal` itself is untouched everywhere else,
including the named-player branch's `mode = (aggregateTotal || overCareer) ? 'sum' : 'single'` choice
("dusty total goals against Carlton" stays `player_game`/`sum`, unaffected).

## 6. Semantic checks (issue requirements 1-7)

1. `/0` expected plan (`grain: player_season`, metric, `max`, club, time) confirmed correct by direct
   source trace (§2-§3).
2. `/3` expected plan confirmed correct the same way.
3. Current extraction already gets player/club/time/metric correct in both clusters; only wrapper words
   were `/0`'s residual defect, plus the independent `aggregateTotal` misroute for `/3`.
4. `/0` never fails grain election. `/3` did, traced in §3b — the two clusters are not symmetric.
5. `/0` and `/3` do not reach the same internal branch by default; `/3` fell through to the
   `player_game`/`sum` fallback without the fix. They are made to reach the same `player_season` branch
   only via the new, narrowly-gated `playerSeasonLeaderboardCue` override.
6. "seasonal" stays player-season-specific: gated on an actual player metric word, never globally consumed.
   The ISSUE-214 club-season "seasonal" cue is unrelated (disjoint vocabulary) and unchanged, re-asserted
   by a regression test.
7. "season tally" and "seasonal ... total" are synonyms for the identical supported operation — both
   consumed into the same `playerSeasonLeaderboardCue` flag. No distinct ownership logic was needed because
   the two phrasings never co-occur in one question and neither collides with the disjoint club-season
   vocabulary.

## 7. Parser version

`PARSER_VERSION` 62 → 63 (`src/search/nl/plan.ts`), with a new dated entry in the existing version-history
comment block above the constant.

## 8. Tests (`tests/nl-parser.test.ts`), all DB-free

New describe block inside `describe('11. player-season queries')`. Six RED cases from the issue brief
(`Fremantle` → `Geelong`, not in the shared `CLUBS` fixture; `Collingwood`, `Richmond`, `Port Adelaide`,
`Sydney` kept verbatim), each asserting `p.grain`/`p.metric`/`p.agg`/`p.scope.clubFor?.name`/
`p.scope.seasonMin`/`p.scope.seasonMax` together — not merely a non-decline. The `/3` "Port Adelaide" case
additionally asserts `p.grain === 'player_season'` (not `'player_game'`) and `p.player` is undefined, the
exact grain-election defect fixed here.

Seven regression controls:

- existing player-season leaderboard wording (`most goals by a richmond player in 2017`) unchanged;
- the pre-existing named-player scoped-running-total reading (`dusty total goals against carlton` →
  `player_game`/`sum`) unchanged, proving `aggregateTotal`'s other use is untouched;
- bare "seasonal" with no player metric word still declines (`richmond seasonal vibes`);
- bare "tally" without a preceding "season" still declines as an unsupported term;
- bare "posted" with no season-tally/seasonal construction still declines and does not become a universal
  request wrapper;
- the ISSUE-214 club-season "seasonal" cue (`north melbourne's highest seasonal losses`) unchanged;
- career leaderboard wording (`who has the most career goals`) stays `player_career`; single-game
  leaderboard wording (`most disposals in a final`) stays `player_game`/`single`.

## 9. Local verification — complete

- `npx vitest run tests/nl-parser.test.ts` → 554/554 passed (541 pre-existing + 13 new).
- `npx vitest run tests/nl-regression-corpus.test.ts tests/nl-semantic-mapping.test.ts
  tests/nl-stress-corpus.test.ts` → 402/402 passed (163/163 + 174/174 + 65/65, no regression).
- `npm run typecheck` → clean.
- `PARSER_VERSION` confirmed 63.
- `npm install` was required and run (operator-authorised) in this previously dependency-less worktree.

## 10. Guardrails honoured

- No club name, player name, corpus ID, or exact metric special-cased in `parser.ts`/`vocab.ts`.
- "posted"/"season"/"tally"/"seasonal"/"total" not added to `STOPWORDS` or any blanket-ignore list — all
  three new cues are gated on a real `METRIC_WORDS` match; "total" received no new consumption logic at
  all, only the pre-existing `aggregateTotal` flag's effect on one grain-election branch was narrowed.
- No unrelated NL family touched.
- Exploratory V2 generator/scorer untouched (corpus expectation verified correct, §4).
- `git status --short` shows exactly the four intended files (`src/search/nl/parser.ts`,
  `src/search/nl/plan.ts`, `src/search/nl/vocab.ts`, `tests/nl-parser.test.ts`); no stray/zero-byte
  artefacts found.

## 11. Host validation — outstanding

Not yet run. Recommended commands on `streamanator`, in order:

1. Frozen V5 stable corpus (`/home/arm/nl-stress-corpus-v5.csv`) under `PARSER_VERSION = 63` — expect
   unchanged **12000 scored / 12000 clean / 0 soft / 0 failed**.
2. Frozen exploratory V2 corpus (`/home/arm/nl-exploratory-v2.csv`) under `PARSER_VERSION = 63` — v62
   baseline is **27530 scored / 16477 clean / 11053 soft / 0 failed / 1500 audit-required**.
3. A direct v62-vs-v63 structured-plan comparison of the full 29,030-row exploratory V2 corpus before
   closeout, the same way ISSUE-214/ISSUE-215 reconciled their target clusters.

Expected outcome, **not promised**: `player_season_leaderboard/0` (576 rows) clearing fully — a pure
wrapper-vocabulary gap with no known residual mechanism. `player_season_leaderboard/3` (559 rows) clearing
fully or substantially — wrapper gap plus grain-election fix, no known residual mechanism identified during
implementation, but not host-verified. Host validation must determine the exact `/0`/`/3` remaining counts,
aggregate clean/soft movement, hard failures (expect 0), and whether any unrelated plan changed. Do not
assume all 1135 rows move before host validation returns.

## 12. Resolution

NOT YET RESOLVED. Awaiting operator host validation on `streamanator` per §11. `CHANGELOG.md` entry
deferred until validation completes, per this issue's own instructions.
