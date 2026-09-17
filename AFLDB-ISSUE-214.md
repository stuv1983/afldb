# AFLDB-ISSUE-214 — `club_season_rank` "what season had..."/"...seasonal..." phrasing declines with `unsupported_term: season`/`seasonal`

- **Status:** RESOLVED 2026-09-17 (Sonnet 5, operator-validated on streamanator).
- **Worktree:** `sonnet/issue-214-club-season-rank-phrasing`, base `a0da645f`. Implementation commit `731edd8` ("Support club season rank phrasing").
- **Baseline:** clean `main` after AFLDB-ISSUE-213, `PARSER_VERSION` 60 → 61.

## 1. Problem, as given

Exploratory V2 under parser v60: 29030 input / 27530 scored / 14879 clean / 12651 soft / 0 failed /
1500 audit-required. Two soft-failure clusters targeted:

```text
642 — club_season_rank/3 — UNEXPECTED_DECLINE
614 — club_season_rank/1 — UNEXPECTED_DECLINE
```

Combined: 1256 rows. Representative failures and their current decline reasons:

- "For Suns, what season had the lowest wins during the 2010s" / "For Swans, what season had the
  highest losses" / "For West Coast, what season had the highest losses in 2017" →
  `unsupported_term: season`.
- "North Melbourne's highest seasonal losses" / "Sydney's highest seasonal draws in 2017" /
  "Greater Western Sydney's highest seasonal losses in 2023" → `unsupported_term: seasonal`.

## 2. Scope proof — do the two clusters share one root cause?

Inspected `tools/nl/generate-exploratory-corpus-v2.mjs`'s `club_season_rank` generator
(lines ~361-373):

```js
{ name:'club_season_rank', n:1400, make() {
  const c=C(), metric=pick([['wins','wins'],['losses','losses'],['draws','draws'],['percentage','percentage']]);
  const t=T(), template=pick([0,1,2,3]), min=chance(.3);
  const q=[
    words('Which club had the', min?'fewest':'most', metric[0], 'in a season', t.q),
    words(possessive(c[0]), min?'lowest':'highest', 'seasonal', metric[0], t.q),
    words('Rank teams by their', min?'smallest':'largest', metric[0], 'season', t.q),
    words('For', c[0]+',', 'what season had the', min?'lowest':'highest', metric[0], t.q),
  ][template];
  const e=temporal({grain:'club_season', metric:metric[1], aggregation:min?'min':'max'}, t);
  if (template===1 || template===3) e.club = c[1];
  return row('club_season_rank', template, q, e, {depth: e.club?3:2, scope: e.club?'club+time':'time'});
}}
```

All four templates build the **identical** expected plan shape: `grain: 'club_season'`, the same
`metric`/`aggregation` mapping, `e.club` set for templates 1 and 3. Templates 0 ("Which club had
the most wins in a season") and 2 ("Rank teams by their largest losses season") already score
clean — they already pass through the existing `clubSubjectPresent` leading "teams"/"clubs" cue.
Templates 1 and 3 are two more English phrasings of the *same* semantic construction, not a second
mechanism: the only thing that differs between all four templates is which words the reader used to
say "in a season" and whether a club is named alongside it.

**Conclusion: both clusters share one root cause and belong in one fix.** Confirmed against source,
not assumed from the shared answer-type name.

## 3. Root cause, verified from current source

- `src/search/nl/vocab.ts`'s `IN_ONE_SEASON` (`/\bin (?:a|one|any|(?:a )?single|the same) season\b/`)
  has no form for the adjective "seasonal". No vocabulary entry anywhere reads "what/which season
  had" as a club-season cue either — the closest existing pattern, `ACHIEVEMENT_SUMMARY_CUES`'s
  `by_season` (vocab.ts line 1054, `/\bby\s+(?:year|season)\b|\bwhich\s+(?:year|season)\b|.../`),
  belongs to the unrelated `achievement_summary` grain and is never consulted by `club_season`.
- `src/search/nl/parser.ts`'s `clubSeasonCuePresent` (pre-fix):
  ```ts
  const clubSeasonCuePresent = coachReading === null && !afterSirenReading && (clubSubjectPresent
    || clubSeasonConditionResult.conditions.length > 0
    || (!!clubFor && !teamMetricResult.metric && clubSeasonMetricWordPresent && seasonWorded));
  ```
  has no branch for either phrasing. For "North Melbourne's highest seasonal losses" (no explicit
  year), `seasonWorded` is false (`inOneSeason` doesn't match "seasonal"; no year/decade present),
  so the grain was never even elected as `club_season` at all.
- Even where `club_season` WAS already reachable through the existing `clubFor && seasonWorded`
  branch (e.g. "For Suns, what season had the lowest wins during the 2010s", where the decade
  already sets `seasonWorded`), the bare word "season" from "what season had" was still never
  stripped from `text`. `what`/`had` are `STOPWORDS` and get filtered from leftover tokens, but
  "season" is not, so it survived to `report.unsupportedTerms` and triggered the leftover-token
  decline gate regardless of grain election succeeding.
- The separate AFLDB-ISSUE-189 single-season guard (`src/search/nl/parser.ts` ~line 3480:
  `grain === 'club_season' && metric !== null && ... && !(clubFor && seasonWorded)`) would ALSO
  have declined the no-explicit-year cases even after grain election, since none of its existing
  allowances (`inOneSeason`, a single explicit year, `clubFor && seasonWorded`) are satisfied by
  "seasonal" alone.

## 4. Corpus expectation — verified, not assumed

The generator's own `e` object for templates 1 and 3 is identical in shape to the already-passing
templates 0 and 2 (Section 2). No generator/scorer defect found. Not touched.

## 5. Implementation

Smallest generic change; no club name, corpus ID, or exact sample string special-cased.

`src/search/nl/vocab.ts` — two new exports beside `CLUB_SEASON_METRIC_WORDS`:

```ts
export const CLUB_SEASON_RANK_SEASON_CUE_RE = /\b(?:what|which)\s+season\s+had\b/;
export const CLUB_SEASON_SEASONAL_ADJECTIVE_RE = /\bseasonal\b/;
```

`CLUB_SEASON_RANK_SEASON_CUE_RE` is an unambiguous club-season cue in its own right (nothing else in
this vocabulary reads "what/which season had"), matched and consumed as one phrase.
`CLUB_SEASON_SEASONAL_ADJECTIVE_RE` is read only once a `CLUB_SEASON_METRIC_WORDS` match is already
present in the text — the same gating `CLUB_SEASON_METRIC_WORDS` itself requires before being tried
at all — so bare "seasonal" alone still names nothing.

`src/search/nl/parser.ts` — computed immediately before `clubSeasonCuePresent`:

```ts
const clubSeasonRankSeasonCueMatch = CLUB_SEASON_RANK_SEASON_CUE_RE.exec(text);
const clubSeasonSeasonalCueMatch = clubSeasonMetricWordPresent ? CLUB_SEASON_SEASONAL_ADJECTIVE_RE.exec(text) : null;
const clubSeasonPerSeasonPhrasing = !!clubSeasonRankSeasonCueMatch || !!clubSeasonSeasonalCueMatch;
if (clubSeasonRankSeasonCueMatch) {
  consumedTokens.push(clubSeasonRankSeasonCueMatch[0]);
  text = stripMatch(text, clubSeasonRankSeasonCueMatch[0]);
}
if (clubSeasonSeasonalCueMatch) {
  consumedTokens.push(clubSeasonSeasonalCueMatch[0]);
  text = stripMatch(text, clubSeasonSeasonalCueMatch[0]);
}
const clubSeasonCuePresent = coachReading === null && !afterSirenReading && (clubSubjectPresent
  || clubSeasonConditionResult.conditions.length > 0
  || clubSeasonPerSeasonPhrasing
  || (!!clubFor && !teamMetricResult.metric && clubSeasonMetricWordPresent && seasonWorded));
```

`clubSeasonPerSeasonPhrasing` is also OR'd into the AFLDB-ISSUE-189 single-season guard's existing
allowances (`!inOneSeason && !(single explicit year) && !(clubFor && seasonWorded)` →
`&& !clubSeasonPerSeasonPhrasing`), so a club named alongside either new phrasing with no explicit
year still passes that guard instead of declining with "ranked one season at a time".

No other cue, guard, or grain touched.

## 6. Semantic checks (issue requirements 1-8)

1. "what season had the highest losses" elects `club_season` via the new cue, not filler-only
   consumption of "season" — proven by asserting `p.grain`/`p.metric`/`p.agg` together, not merely
   a non-decline.
2. "highest seasonal losses" reads as the identical ranking operation (same assertions).
3. Club ownership preserved — `p.scope.clubFor?.name` asserted in every new positive test.
4. Explicit year/decade constraints preserved — `p.scope.seasonMin`/`seasonMax` asserted for the
   decade case (2010s → 2010/2019) and the explicit-year cases.
5. `highest`→max / `lowest`→min mapping unchanged — asserted via `p.agg`.
6. wins/losses/draws stay distinct metrics — a `draws` case included.
7. Unsupported-term validation not weakened globally — `CLUB_SEASON_SEASONAL_ADJECTIVE_RE` is gated
   on a metric word being present; regression test "richmond seasonal vibes" still declines.
8. Bare "season"/"seasonal" not made universally ignorable — the rank-season cue requires the exact
   "what/which season had" phrase; a season-less, cue-less "which team has the most wins" still
   declines with its pre-existing "ranked one season at a time" message (regression test kept).

## 7. Parser version

`PARSER_VERSION` 60 → 61 (`src/search/nl/plan.ts`), with a new dated entry in the existing
version-history comment block above the constant, matching the repository's established convention.

## 8. Tests (`tests/nl-parser.test.ts`), all DB-free

New describe block nested inside "13. club_season queries". The shared test-fixture `CLUBS`
directory (established by AFLDB-ISSUE-213) has Richmond, Carlton, Collingwood, Geelong, Adelaide,
Port Adelaide, Greater Western Sydney, Melbourne, North Melbourne, Sydney, Essendon, Hawthorn — no
Gold Coast Suns or West Coast Eagles — so the issue brief's `Suns`/`West Coast` wording is
represented with fixture clubs that exercise the identical construction (`Suns`→`Richmond`,
`Swans`→`Sydney` kept as-is since Sydney's alias list already includes "swans", `West Coast`→
`Carlton`); no club name is special-cased in the fix itself, only in these test fixtures' choice of
which available club to use.

RED cases (all now GREEN):

- "for Richmond, what season had the lowest wins during the 2010s" → `club_season`, `wins`, `min`,
  `clubFor.name = 'Richmond'`, `seasonMin/Max = 2010/2019`.
- "for Swans, what season had the highest losses" → `club_season`, `losses`, `max`,
  `clubFor.name = 'Sydney'`, no explicit year required.
- "for Carlton, what season had the highest losses in 2017" → `club_season`, `losses`,
  `clubFor.name = 'Carlton'`, `seasonMin/Max = 2017/2017`.
- "north melbourne's highest seasonal losses" → `club_season`, `losses`, `max`,
  `clubFor.name = 'North Melbourne'`, no explicit year required.
- "sydney's highest seasonal draws in 2017" → `club_season`, `draws`, `clubFor.name = 'Sydney'`,
  `seasonMin/Max = 2017/2017`.
- "greater western sydney's highest seasonal losses in 2023" → `club_season`, `losses`,
  `clubFor.name = 'Greater Western Sydney'`, `seasonMin/Max = 2023/2023`.

Regression controls:

- Positive, unchanged: "teams with the most wins in a season", "which club had the most losses in
  2017".
- Negative, unchanged: "which team has the most wins" still declines ("ranked one season at a
  time"); "richmond seasonal vibes" still declines (proves `CLUB_SEASON_SEASONAL_ADJECTIVE_RE`'s
  metric-word gate, not a blanket "seasonal" pass).

## 9. Local verification — complete

This worktree had no installed dependencies (new worktree, no populated sibling to junction from);
operator authorised `npm install` here for this session.

```text
$ npx vitest run tests/nl-parser.test.ts
-> Test Files 1 passed (1), Tests 519 passed (519)

$ npx vitest run tests/nl-regression-corpus.test.ts tests/nl-semantic-mapping.test.ts tests/nl-stress-corpus.test.ts
-> Test Files 3 passed (3), Tests 402 passed (402)

$ npm run typecheck
-> Generating route types... / Types generated successfully; tsc --noEmit clean
```

Broken out by suite for the closeout record:

```text
tests/nl-parser.test.ts:            519/519 passed
tests/nl-regression-corpus.test.ts: 163/163 passed
tests/nl-semantic-mapping.test.ts:  174/174 passed
tests/nl-stress-corpus.test.ts:      65/65 passed
------------------------------------------------
                                    402/402 passed
```

`typecheck`: clean. `PARSER_VERSION` confirmed 61.

## 10. Host validation (streamanator) — complete

Validated commit/version: `731edd8`, `PARSER_VERSION = 61`.

### 10a. Frozen V5

```text
12000 scored
12000 clean
0 soft
0 failed
```

No stable-corpus regression.

### 10b. Exploratory V2

Parser v60 baseline:

```text
27530 scored
14879 clean
12651 soft
0 failed
1500 audit-required
```

Parser v61:

```text
27530 scored
15925 clean
11605 soft
0 failed
1500 audit-required
```

Net movement: clean +1046, soft -1046, failed 0, audit-required 0.

### 10c. Target-cluster reconciliation

Initial ISSUE-214 targets (parser v60):

```text
club_season_rank/3 — 642 unexpected declines
club_season_rank/1 — 614 unexpected declines
```

After parser v61:

```text
club_season_rank/3 — 0 remaining from the targeted season-ranking phrasing defect
club_season_rank/1 — 210 remaining
```

`642 + (614 - 210) = 1046`, exactly matching the aggregate soft→clean movement in §10b. The entire
`/3` cluster (template 3, "what season had the highest/lowest `<metric>`") is cleared. 404 of 614
`/1` rows (template 1, "`<club>`'s highest/lowest seasonal `<metric>`") are cleared; 210 remain.

The remaining 210 `/1` rows are **not** still failing on "seasonal" — the season-ranking phrasing
this issue targeted is confirmed working for them. Representative remaining rows:

```text
20600206 — Suns' lowest seasonal losses before 2019
  -> unsupported_term: suns'

20600323 — Pies' highest seasonal wins in 2017
  -> unsupported_term: pies'

20600424 — Western Bulldogs' highest seasonal percentage since 2000
  -> unsupported_term: bulldogs'
```

This is a **separate, pre-existing defect**: the possessive apostrophe on a club alias/nickname
(`Suns'`, `Pies'`, `Bulldogs'`) is not being stripped/matched as club ownership the way the full
club name's possessive form (`Sydney's`, `North Melbourne's`) already is in this issue's own test
fixtures. It is orthogonal to the season-ranking cue this issue fixed: every one of these rows
already carries the correct "seasonal `<metric>`" construction and would resolve if the club alias
itself were recognised. **Not folded into ISSUE-214** — documented here as a follow-up candidate
only; no new tracked issue opened in this closeout (that decision, and any severity/reproduction
work, is left to a future session that can inspect `findClub`/alias matching directly).

### 10d. Direct plan comparison

A direct v60 → v61 comparison of:

```text
/home/arm/nl-exploratory-v2-v60-validation/results.jsonl
/home/arm/nl-exploratory-v2-v61-validation/results.jsonl
```

found:

```text
v60 rows: 29030
v61 rows: 29030
missing from v60: 0
changed plans: 1046
```

Structured diff saved as `/home/arm/issue-214-v60-v61-plan-diff.json`. The first changed rows are
all representative target-family season-rank constructions, including:

```text
For Suns, what season had the lowest wins during the 2010s
For Swans, what season had the highest losses
North Melbourne's highest seasonal losses
Sydney's highest seasonal draws in 2017
For West Coast, what season had the highest losses in 2017
Greater Western Sydney's highest seasonal losses in 2023
```

No rows were missing between runs — the fix is isolated to exactly the 1046 rows in §10b/§10c, with
zero unrelated movement.

## 11. Guardrails honoured

No club name, corpus ID, or exact sample string special-cased in `parser.ts`/`vocab.ts` (test-file
club substitutions are fixture-availability choices, not production logic). "season"/"seasonal" not
deleted or made globally ignorable outside the two new structurally-gated cues. No unrelated NL
family touched. Exploratory V2 generator/scorer untouched — corpus expectation verified correct, not
changed. The separate possessive-club-alias defect found during host validation (§10c) was not
folded into this issue's fix and no source file was touched for it.

## 12. Resolution

**RESOLVED 2026-09-17.** All required outcomes met:

- both target phrasing clusters confirmed to share one parser ownership/cue mechanism (§2);
- `PARSER_VERSION` bumped exactly once, 60 → 61;
- local parser tests 519/519; broader regression 402/402; typecheck clean;
- frozen V5 remains 12000/12000/0/0 — no stable-corpus regression;
- exploratory V2 gains exactly 1046 clean rows, soft failures drop exactly 1046, hard failures
  remain 0, audit-required unchanged at 1500;
- the entire `club_season_rank/3` cluster (642 rows) is cleared;
- 404 of 614 `club_season_rank/1` rows are cleared;
- the remaining 210 `/1` rows expose a separate, pre-existing possessive-club-alias defect
  (`Suns'`/`Pies'`/`Bulldogs'` etc.), not the season-ranking defect this issue targeted — recorded
  as a follow-up candidate only (§10c), not folded into this issue and not opened as a new tracked
  issue in this closeout;
- a direct 29,030-row plan-level comparison (v60 vs. v61) confirms exactly 1046 changed plans and 0
  missing rows, with the changed rows matching the target family.

See `issues.md` for the ledger entry and `CHANGELOG.md` for the retained user-facing summary.
