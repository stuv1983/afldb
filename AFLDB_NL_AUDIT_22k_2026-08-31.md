# AFLDB NL Search — Result Audit (22k corpus)

**Input:** `sample/afldb-nl-searches-7d-2026-08-30 (1).csv`
**Rows:** 20,000 search-log rows · 20,000 unique question strings (0 exact duplicates)
**Parser version:** `28` (uniform) · **Review layer:** `reviewStatus` / `reviewCategory` / `reviewNotes` blank on every row
**Audit date:** 2026-08-31
**Corroboration:** every pattern below also appears, at the same proportions, in the earlier 4,147-row export (`afldb-nl-searches-7d-2026-08-30.csv`). The 5× larger file did not surface any new class of defect; it sharpened the counts and confirmed the comparator bug is 100% reproducible.

---

# Executive Summary

## Corpus shape

| Field group | Notes |
|---|---|
| Question field | `question` (templated/generated corpus — fixed skeletons, varied player/club/venue/year) |
| Outcome vocab | `answered`, `answered_caveat`, `no_results`, `unanswerable`, `declined_ambiguous`, `unrecognised`, `declined_low_confidence` |
| Failure-reason vocab | *(blank)*, `coverage_unavailable`, `empty_result`, `ambiguous_player`, `unsupported_term`, `unsupported_topic` |
| Grain vocab | `player_game`, `player_season`, `player_career`, `team_match`, `head_to_head`, `team_streak`, *(blank)* |
| Metric vocab | disposals, handballs, kicks, marks, tackles, hitouts, clearances, contested, uncontested, inside_50s, goals, wins, games, win_margin, team_score |
| Confidence | 0–1; **94.6% of rows = exactly 1**, including 6,364 rows that returned no answer |
| Plan | JSON query plan (`agg`, `grain`, `scope`, `metric`, `careerConditions`, `clubSeasonConditions`) — **primary evidence** |
| Missing | **No answer/result-payload column, no error/stack column** — this bounds two conclusions below |

## Outcome clusters

| outcome | n | % |
|---|--:|--:|
| answered_caveat | 7,489 | 37.4% |
| answered | 5,072 | 25.4% |
| unanswerable | 4,134 | 20.7% |
| no_results | 2,230 | 11.2% |
| declined_ambiguous | 760 | 3.8% |
| unrecognised | 247 | 1.2% |
| declined_low_confidence | 68 | 0.3% |

## Failure-reason clusters

`coverage_unavailable` 3,952 · `empty_result` 2,230 · `ambiguous_player` 760 · `unsupported_term` 315 · `unsupported_topic` 182

## Semantic families (by question skeleton)

- `players with <comparator> N <metric> [in a game | in YEAR | against CLUB]` — threshold lists (~7,600 rows)
- `<Player> most <metric> [at VENUE] [against CLUB] [in YEAR]` — player superlatives (~6,500 rows)
- `<Club> leading <metric> in YEAR` / `most <metric> for <Club> in YEAR` — club-season leaders
- `<Club> {highest score|biggest win|record|wins} against <Club>` / `head to head` / `draws` — team & H2H
- `<Club> longest {winning|losing|unbeaten} streak` — team streaks (83 rows, all answered)
- `most <metric> {between YEAR and YEAR | since YEAR}` — ranged aggregates

## Verdict counts

| Bucket | Clusters | ~rows | ~% |
|---|--:|--:|--:|
| **REAL_NL_DEFECT (confirmed)** | **5** | **~1,530** | **~7.6%** |
| REAL_NL_DEFECT (candidate, needs answer payload) | 1 | up to 2,927 | up to 14.6% |
| CORRECT_EMPTY_RESULT | 3 families | ~2,200 | ~11% |
| CORRECT_DECLINE | 3 families | ~200 | ~1% |
| DATA_COVERAGE_LIMITATION | 2 families | ~4,130 | ~20.7% |
| INFRASTRUCTURE_OR_TELEMETRY | 0 incidents · 1 observability gap | — | — |
| NEEDS_MORE_EVIDENCE | 2 | (see below) | — |

**Headline.** The genuine NL problems collapse to **five generic parser bugs plus one high-volume candidate**. Zero infrastructure failures in 20,000 rows. Raw "answered %" (62.8%) is not a usable quality score: ~20.7% of traffic is a legitimate historical-coverage limit, ~11% is a legitimate empty result, and the real defects are concentrated in a handful of comparator / alias / grain rules — not spread across the vocabulary.

**Adjusted semantic quality (defensible band):** of the ~13,600 rows where the engine attempted an answer, **~1,530 (≈11%) are wrong for a fixable semantic reason**; if the `answered_caveat` threshold-drop (Defect F, candidate) is confirmed, that rises to ~4,450 (≈33% of attempted answers).

---

# Priority Review Queue

| # | Cluster | Example | Classification | Freq | Unique wordings | Why it matters | Generic/Entity |
|--:|---|---|---|--:|--:|---|---|
| 1 | `answered_caveat` threshold lists carry **no predicate** in the plan and return `resultCount=1` | `players with fewer than 10 disposals against GWS` → plan has `agg:list, metric:disposals`, **no condition**, rc=1 | REAL_NL_DEFECT *(candidate — needs payload)* | 2,927 | ~2,927 | 14.6% of all traffic; every threshold-phrased game/season list looks like it silently drops the filter and returns one row | Generic |
| 2 | `"no more than N"` / `"no fewer than N"` (+goals, career path) → plan emits `op=eq, value=0` | `players with no fewer than 12 goals in a game` → `{op:eq,value:0,column:goals}`, rc=3417, `answered` | REAL_NL_DEFECT | 105 | ~105 | 100% mismatch rate; wrong operator, operand **and** grain; returns "players with 0 career goals", no caveat | Generic |
| 3 | `"at most N <metric>"` → token `"most"` unsupported → `declined_ambiguous / ambiguous_player` | `players with at most 20 disposals in 1985`, conf 0.65, `unsupportedTerms=most` | REAL_NL_DEFECT | 475 | ~475 | A standard ≤ phrasing is rejected on the game/season path (works on the career path); mislabels a player-free question as "ambiguous player" | Generic |
| 4 | bare `"Bulldogs"` never resolves to Western Bulldogs | `Collingwood wins against Bulldogs` → `declined_ambiguous`; `Bulldogs v Roos head to head` → `unrecognised` | REAL_NL_DEFECT | 408 | ~408 | `Dogs` / `Footscray` / `Western Bulldogs` all resolve (~45% answered); the single most-common nickname yields **0 answered** across every question shape | Generic |
| 5 | `"<Club> wins against <Club>"` → `grain=player_game, metric=wins` → `coverage_unavailable` | `Eagles wins against Hawks` → player_game/wins, `unanswerable` | REAL_NL_DEFECT | 385 | ~385 | Should route to `head_to_head` (which answers `record against` / `who has won more` fine); instead asks for a per-game player "wins" stat that cannot exist | Generic |
| 6 | goals-threshold list, no club/player → `grain=player_career`, `"in a game"` / `"in YEAR"` dropped | `players with more than 2 goals in 1989` → grain `player_career`, rc 7670 | REAL_NL_DEFECT *(shares root with #2)* | ~150 net | ~150 | Answers a career question when a per-game/per-season one was asked; returns thousands of rows | Generic |
| 7 | Jr/Sr/Snr/Jnr/Senior/Junior all serialize as `resolvedTo:"Gary Ablett"` | `Gary Ablett Sr …` and `Gary Ablett Jnr …` both show `resolvedTo:"Gary Ablett"` | INFRASTRUCTURE_OR_TELEMETRY (observability) | 1,651 | — | In-career queries for each suffix *do* answer, so routing is probably right — but the log can't prove it, which blocks exactly this review | Generic (telemetry) |

Everything else (pre-1998 stat coverage, player-outside-career empties, `metres gained` / `pressure acts` declines, bare `Gary Ablett` ambiguity, same-club head-to-head) is **correct behaviour** — see later sections.

---

# REAL_NL_DEFECTS

## Defect F *(candidate)* — threshold list queries drop the predicate and return one row

### Failure pattern
For `players with <comparator> N <metric> [in a game | in YEAR | against CLUB]` resolving to `player_game` or `player_season` grain, the plan contains **no threshold condition anywhere** — `careerConditions:[]`, `careerPredicates:[]`, `clubSeasonConditions:[]`, `agg:{kind:"list"}`, `limit:100` — and the search returns **`resultCount = 1`** with `outcome = answered_caveat`. The comparator phrase (`fewer than 10`, `no fewer than 5`, `at least 30`, …) is simply absent from the serialized plan.

### Scale
- 2,927 threshold-phrased `answered_caveat` rows. **2,927 / 2,927 (100%)** have no serialized predicate. **2,575 / 2,927 (88%)** return `resultCount = 1`.
- By contrast, threshold queries that *do* get a serialized predicate (the `player_career` goals path) return 3,000–8,600 rows.

### Representative questions
- `players with fewer than 10 disposals against GWS` → `grain:player_game, metric:disposals`, no condition, rc 1
- `Geelong players with no fewer than 5 hitouts in a game` → `grain:player_game, metric:hitouts`, no condition, rc 1
- `players with at least 30 disposals in 2016` → `grain:player_season, metric:disposals`, no condition, rc 1
- `players with less than 5 clearances against North Melbourne` → `grain:player_game`, no condition, rc 1

### Why current behaviour is (probably) wrong
"players with fewer than 10 disposals in a game" asks for a **list** of qualifying players. Returning a single row — and a plan with no filter — is consistent with the game/season list path building a leaderboard (top-1 / top-N by the metric) and ignoring the comparator entirely. If so, the answer is not just incomplete, it is the opposite of the question ("fewer than" returning the maximum).

### The one innocent explanation
The predicate might be applied at execution time and never serialized, with `rc=1` being a display convention. **This cannot be distinguished from the export** — there is no answer/caveat text column.

### Evidence needed to promote or drop this
The rendered answer + caveat string for ~20 of these rows, e.g. `players with fewer than 25 handballs in a game` (rc 1) and `players with at least 30 disposals in 2016` (rc 1). If the returned row is a single leader rather than a filtered list, this is **Priority 1** and by volume the largest defect in the system.

### Likely code area
The `player_game` / `player_season` list-plan builder — the branch that sets `agg:{kind:"list"}` without ever populating a conditions array from the parsed comparator.

### Smallest sensible fix (if confirmed)
Populate a `clubSeasonConditions` / game-level condition from the parsed comparator on the game/season list path, exactly as the career path already does.

### Regression test
```
p = plan("players with fewer than 10 disposals against GWS")
assert p.grain == "player_game"
assert {"op":"lt","value":10,"column":"disposals"} in p.conditions
assert result_is_a_list_not_a_single_leader(...)
```

### Expected reach
**Broad NL impact** — 14.6% of this corpus; every threshold list that isn't goals-on-the-career-path.

---

## Defect A — `"no more than N"` / `"no fewer than N"` collapse to `goals == 0`

### Failure pattern
On the `player_career` threshold path, `"no more than N"` and `"no fewer than N"` are both parsed to `{op:"eq", "value":0, "column":"goals"}` — wrong operator, wrong operand, wrong direction. **All 105 occurrences in the corpus are corrupted (100%).** `resultCount = 3417` recurs across dozens of unrelated questions — the signature of one canned "goals = 0" query executing regardless of input.

### Representative questions (all → `careerConditions:[{op:eq,value:0,column:goals}]`)
- `players with no fewer than 12 goals in a game` → rc 3417, `answered`
- `players with no more than 6 goals in 2000` → rc 3417, `answered`
- `players with no fewer than 6 goals against Greater Western Sydney` → rc 3417, `answered`
- `players with no more than 10 goals in a game` → rc 3417, `answered`

### Evidence
Serialized `plan` JSON. Contrast on the *same path*: `fewer than 10` → `lt 10`; `less than 8` → `lt 8`; `at most 8` → `lte 8`; `at least 6` → `gte 6`; `more than 1` → `gt 1`; `exactly 2` → `eq 2` — all correct (0 mismatches across 400+ rows). Only the two negated two-word forms fail, and they fail every time.

### Why current behaviour is wrong
The user gets "players with exactly 0 career goals" and **no caveat** — a confident wrong answer. The `= 0` also has nothing to do with the stated `N`.

### Likely code area
The comparator phrase→op map in the career-conditions builder. `"no more than"` / `"no fewer than"` / `"no less than"` are missing, and there is a silent default of `op=eq, value=0` for an unmatched comparator.

### Smallest sensible fix
Add `"no more than" → lte`, `"no fewer than" → gte`, `"no less than" → gte` (`"no greater than" → lte`). Replace the `eq/0` fallback with a hard parse failure (decline), so no future unmapped comparator can silently become "= 0".

### Regression test
```
assert plan("players with no more than 4 goals in a game").condition == {op:"lte", value:4, column:"goals"}
assert plan("players with no fewer than 12 goals in 2013").condition == {op:"gte", value:12, column:"goals"}
assert outcome("players with no less than 3 goals in 1990") != "answered with op=eq/value=0"
```

### Expected reach
Directly **one narrow family** (~0.5% of corpus). The fallback removal is **broad NL impact** — it closes the class of "unmapped comparator → fabricated `= 0`".

---

## Defect B — `"at most N"` rejected on the player_game / player_season path

### Failure pattern
`"at most"` is not in the comparator vocabulary used when the query resolves to `player_game` / `player_season` grain. The token **`"most"`** is left stranded → `unsupportedTerms`, confidence pinned to **0.65**, and the parser then **guesses the stray token is a player surname** and declines with `failureReason = ambiguous_player` — even when the question contains no player at all. The same phrase parses correctly on the `player_career` goals path (`at most 10 goals in a game` → `lte 10`).

### Scale
- `"at most"` appears in 625 rows → **475 `declined_ambiguous`** (`unsupportedTerms=most`, conf 0.65), 107 `answered` (the career-goals variant), 25 `no_results`, rest small.
- Control phrasings on the same skeletons: `at least` 728 rows / 9 ambiguous · `no more than` 614 / 6 · `less than` 541 / 13. Only `at most` breaks.

### Representative questions
- `players with at most 20 disposals in 1985` — `declined_ambiguous`, `unsupportedTerms=most`
- `Roos players with at most 40 tackles in a game` — `declined_ambiguous`
- `players with at most 25 uncontested possessions against Gold Coast` — `declined_ambiguous`

### Likely code area
1. The comparator lexicon for the game/season threshold builder (missing `at most`; check `no less than`, `up to`, `at minimum` too).
2. The fallback that promotes an unresolved leftover token to a speculative player mention — that is what produces the misleading `ambiguous_player`.

### Smallest sensible fix
Add `"at most" → lte` (and `"at least" → gte` if not already) so the game/season map matches the career map. Independently: never promote a known quantifier/stopword (`most`, `least`, `fewer`) to a player hypothesis.

### Regression test
```
assert plan("players with at most 25 disposals in 2020").condition == {op:"lte", value:25, column:"disposals"}
assert outcome("players with at most 15 marks against Lions").startswith("answered")   # not declined_ambiguous
```

### Expected reach
**Many generated questions** — 2.4% of this corpus; any "at most" threshold search on a non-career metric.

---

## Defect C — bare `"Bulldogs"` is not a club alias

### Failure pattern
The alias registry maps `Western Bulldogs`, `Footscray`, and `Dogs` to the club, but **not the bare nickname `Bulldogs`**. When `Bulldogs` is the club token, resolution fails; the stray capitalised token is treated as a possible player → `declined_ambiguous / ambiguous_player` (conf 0.65), or, with another unmapped token present, `unrecognised` / `declined_low_confidence` (`unsupportedTerms` = `bulldogs head head`, `bulldogs between`, `dustin martin bulldogs`, …).

### Scale
- 408 bare-`Bulldogs` rows: **279 `declined_ambiguous` + 64 `unrecognised` + 60 `declined_low_confidence` + 5 `unanswerable` = 0 answered.**
- Controls on identical skeletons: `Dogs` 408 rows → 189 answered / 139 caveat; `Footscray` 425 → 194 / 140; `Western Bulldogs` 448 → 202 / 147.
- Only 6 / 408 bare-`Bulldogs` rows resolved the club at all.
- `unsupportedTerms` frequency: `bulldogs` 312, `bulldogs head head` 28, `bulldogs last between` 12, `bulldogs between` 10.

### Representative questions
- `Collingwood wins against Bulldogs` → `declined_ambiguous`
- `Bulldogs leading contested possessions in 2016` → `declined_ambiguous`
- `Bulldogs v Roos head to head` → `unrecognised` (`bulldogs head head`)
- `Dustin Martin most tackles against Bulldogs` → `declined_low_confidence`

### Likely code area
The club nickname / alias registry (the structure that already contains `Dogs`, `Pies`, `Cats`, `Roos`, `Blues`). One missing key.

### Smallest sensible fix
Add `"bulldogs" → Western Bulldogs` (the org id used for `Dogs` resolutions in this data is `24`). Handle the historical-identity edge (`Footscray or Bulldogs`, `Western Bulldogs vs Footscray`) as a graceful "same club" response rather than `unrecognised` / `unanswerable`.

### Regression test
```
assert resolve("Bulldogs").club == "Western Bulldogs"
assert outcome("Collingwood wins against Bulldogs").startswith("answered")
assert outcome("Bulldogs v Roos head to head").startswith("answered")
```

### Expected reach
**Many generated questions** — 2.0% of this corpus, across head-to-head, team_match, threshold, and player-vs-club shapes. Real user traffic is likely higher: `Bulldogs` is a primary AFL nickname.

---

## Defect D — `"<Club> wins against <Club>"` routed to `player_game` / `wins` instead of `head_to_head`

### Failure pattern
`"<Club> wins against <Club>"` is parsed as a **player-game** query for a `wins` metric (`grain:player_game, metric:wins`), which has no coverage, so it returns `unanswerable / coverage_unavailable`. The semantically identical `"<Club> record against <Club>"`, `"who has won more <Club> or <Club>"`, and `"<Club> v <Club> head to head"` all route to `head_to_head` and are answered.

### Scale
- 385 rows: `metric = wins`, `failureReason = coverage_unavailable`, **all 385 at `grain = player_game`.**

### Representative questions
- `Eagles wins against Hawks` → player_game/wins → `unanswerable`
- `Western Bulldogs wins against Collingwood` → player_game/wins → `unanswerable`
- `Footscray wins against Cats` → player_game/wins → `unanswerable`

### Why current behaviour is wrong
"How many games has club X won against club Y" is a first-class head-to-head question the engine already answers under other phrasings. The `wins` metric on `player_game` grain is a category error — there is no per-player-per-game "wins" statistic.

### Likely code area
Intent/grain routing: the `"wins against"` phrase should map to the head-to-head handler (like `"record against"`), not to the player-metric handler with `metric=wins`.

### Smallest sensible fix
Add `"<Club> wins against <Club>"` / `"<Club> losses against <Club>"` to the head-to-head phrase set; when `metric` would resolve to `wins`/`losses` with two clubs in scope, force `grain=head_to_head`.

### Regression test
```
assert plan("Eagles wins against Hawks").grain == "head_to_head"
assert outcome("Western Bulldogs wins against Collingwood").startswith("answered")
```

### Expected reach
**One narrow family** — 1.9% of this corpus; every `"X wins against Y"` phrasing.

---

## Defect E — goals-threshold list, no club/player → `player_career` grain, timeframe dropped

### Failure pattern
`players with <comparator> N goals in a game` and `players with <comparator> N goals in <YEAR>` (with no `<Club> players` / `for <Club>` scope) route to **`player_career`** grain. `"in a game"` is discarded entirely (`scope:{}`); a bare year keeps `seasonMin/Max` but the grain stays career. Non-goals metrics on the same skeleton route correctly to `player_game` / `player_season`.

### Scale
- `player_career` grain total: 645 rows. Of those, **283 have text that says `"in a game"` or `"in YEAR"`** — 169 `answered` (returning 3,000–8,600 rows each), 114 `unanswerable`.
- All 263 rows with `resultCount > 1000` are `player_career`.

### Representative questions
- `players with more than 2 goals in 1989` → grain `player_career`, rc 7670
- `players with no more than 6 goals in 2000` → grain `player_career`, `scope:{seasonMin:2000,seasonMax:2000}`, rc 3417 (also hit by Defect A)
- `players with less than 10 goals in a game` → grain `player_career`, `scope:{}`, rc 8074

### Likely code area
Grain selection: `goals` + threshold + list-agg + no club scope forces `player_career`. An explicit `"in a game"` / `"per game"` cue should pin `player_game`; a bare `in <year>` should pin `player_season` — *before* the goals-career preference applies.

### Smallest sensible fix
In grain selection, honour an explicit per-game / bare-year cue ahead of the goals→career default. (This also removes the grain half of Defect A.)

### Regression test
```
assert plan("players with fewer than 3 goals in a game").grain == "player_game"
assert plan("players with more than 2 goals in 1989").grain == "player_season"
assert plan("players with more than 2 goals in 1989").scope == {seasonMin:1989, seasonMax:1989}
```

### Expected reach
**One narrow family** — ~0.8% net of corpus (heavy overlap with Defect A).

---

# CORRECT_EMPTY_RESULT — do **not** count these as defects

### 1. Player outside active career window — the bulk of `no_results` (2,230 rows; 1,627 at `player_game` grain)
The player and opponent/venue resolve with `confidence 1`, the plan's season bounds match the question, and the query legitimately returns nothing.
- ≥ 160 rows name a **future season** (2025–2027): `Gary Ablett Jnr most handballs at Docklands in 2026`.
- ≥ 165 rows pair a **modern player with a pre-career year**: `Gary Ablett Junior most disposals against Sydney in 1975` (debuted 2002); `Scott Pendlebury most goals at Adelaide Oval in 1987` (debuted 2006).
- Post-retirement: `Gary Ablett Snr most goals at SCG in 2023` (retired 1996).
- Non-coexisting opponent: `Gary Ablett Snr … against Port Adelaide` (Port Adelaide joined 1997).

**Confirming evidence:** resolution certainty 1 + plan season bounds equal to the question + matching in-career questions for the same player return `answered`. **Exclude from every future defect denominator.**

### 2. Legitimately empty team-level thresholds
`Footscray biggest win in 1921`, `GWS biggest win in 1927` — club did not play that season → `no_results` with a correct `team_match` plan.

### 3. Same-club head-to-head — `head_to_head` `unanswerable` (78 rows)
`how many draws between Richmond and Tigers`, `who has won more Carlton or Blues`, `Western Bulldogs vs Footscray head to head`. Both mentions resolve to one club; there are no inter-club games. Returning `unanswerable` is defensible; a "that's the same club" message would be friendlier (low-value label improvement, not a defect).

---

# DATA_COVERAGE_LIMITATION

### 1. Pre-modern statistical coverage — `unanswerable / coverage_unavailable` (3,952 rows, 19.8% of the whole corpus)
Requests for **contested/uncontested possessions, clearances, inside 50s, hitouts, tackles** (and derived `wins`) at season/game/H2H grain for seasons **1897–1998**. **0 of 3,490 question-years are ≥ 2000** — a clean coverage boundary, not a parser fault. Decade spread is broad (1900s–1920s heaviest, 1980s–1990s second).
- `Cats leading inside 50s in 1927`, `most contested possessions for Saints in 1967`, `Lance Franklin most clearances against Carlton in 1963`.

**Limitation type:** *unavailable statistic for the requested era.* League-wide possession/clearance/inside-50 data begins ~1998; tackles ~1987. The engine correctly declines rather than fabricating. **Working as intended — the single largest cluster in the file.**

Minor label nit: a handful of era-coverage cases surface as `empty_result` rather than `coverage_unavailable` (e.g. `Gary Ablett Snr most inside 50s against Swans`). Cosmetic; no user-visible harm.

### 2. Genuinely untracked metrics — `metres gained`, `pressure acts`, `rebound 50s`, `score involvements`, `fantasy points`
- `metres gained` 81 rows → all `unrecognised`; `pressure acts` 106 → all `unrecognised`; `rebound 50s` 89 → `unanswerable`; `score involvements` 93 → `unanswerable`.
- `metres gained` (72) and `pressure acts` (98) are the 3rd/4th most common `unsupportedTerms`.

**Limitation type:** *unsupported statistic (all eras).* AFLDB does not carry these modern Champion Data metrics. Clean declines (`confidence 0`, explicit `unsupportedTerms`). **Not a defect.**

### 3. `"<Player> most goals in debut season"` (9 rows)
→ `declined_low_confidence` / `declined_ambiguous`, `unsupportedTerms` = `debut season` / `debut; season` (note the stray semicolon — a tokenisation artifact). "debut season" is not supported vocabulary. **CORRECT_DECLINE** with a cosmetic tokeniser bug; too small to prioritise.

---

# INFRASTRUCTURE_OR_TELEMETRY

**No infrastructure incidents in 20,000 rows.**
- Zero `error` outcomes; zero `failureReason` values matching error/timeout/database/http/internal.
- Every `answered` / `answered_caveat` row (12,561) has a non-empty `planHash` **and** `resultCount`.
- `durationMs`: min 10, p50 139, p95 1,144, max 6,568 — healthy.
- `parserVersion` uniformly `28`.

**One observability gap (not a semantic failure):**
- **Suffix collapse.** 1,651 rows carry a `Jr` / `Sr` / `Snr` / `Jnr` / `Senior` / `Junior` suffix; **1,651 / 1,651 serialize `resolvedTo:"Gary Ablett"` with no id or suffix.** In-career queries for each suffix do get answered and out-of-career ones go empty in the right direction, so resolution is probably correct internally — but the log cannot prove it, and this export exists to enable review.
  **Fix:** include the resolved player id + disambiguation tag in `entityResolution.resolvedTo`, e.g. `"Gary Ablett Sr (#1974)"`.
- `reviewStatus` / `reviewCategory` / `reviewNotes` blank on every row — expected (pre-review export), noted so it is not mistaken for data loss.

---

# NEEDS_MORE_EVIDENCE

### 1. `answered_caveat` threshold lists (Defect F) — up to 2,927 rows / 14.6%
Every threshold-phrased `answered_caveat` row has **no predicate in the serialized plan** and 88% return `resultCount = 1`. Either the filter is applied at execution and simply not serialized (benign, `rc=1` a convention), or the game/season list path drops the comparator and returns a leaderboard (severe).
**Resolve with:** the rendered answer + caveat text for ~20 rows — e.g. `players with fewer than 25 handballs in a game`, `players with at least 30 disposals in 2016`. **Add an answer/caveat column to the export.** Nothing else in the data can settle it.

### 2. Snr/Jnr routing correctness — 1,651 rows
Circumstantial evidence says suffix resolution works, but the collapsed `resolvedTo` makes a systematic "all Snr queries hit the Jnr record" bug invisible.
**Resolve with:** the resolved player id for ~10 rows, or one spot-check of an answered `Gary Ablett Sr …` result against known Ablett Sr game logs. Cheap once the id is in the export (see telemetry fix).

---

# Review First (highest-value clusters)

| # | Cluster | Why it matters | Est. reach | Next evidence needed |
|--:|---|---|---|---|
| 1 | Defect F — threshold `answered_caveat` lists, no predicate, rc=1 | Potentially the largest defect by volume | ~2,927 (14.6%) | Answer/caveat payload for ~20 rows → add export column |
| 2 | Defect A — `no more than`/`no fewer than` → `eq 0` | Confident wrong answers, no caveat, 100% repro | ~105 direct; broad via fallback removal | None — plan JSON is conclusive; ship the fix |
| 3 | Defect B — `at most` → `declined_ambiguous` | Standard ≤ phrasing rejected; spurious `ambiguous_player` | ~475 (2.4%) | Confirm which sibling phrasings the game/season path also lacks |
| 4 | Defect C — bare `Bulldogs` alias | 0 answered vs ~45% for `Dogs`/`Footscray` | ~408 (2.0%), likely more in real traffic | Decide same-club response for `Footscray or Bulldogs` |
| 5 | Defect D — `X wins against Y` → player_game/wins | Known H2H question, category-error routing | ~385 (1.9%) | None — routing table is conclusive |
| 6 | Defect E — goals threshold → `player_career`, timeframe dropped | Answers a different grain; thousands of rows | ~150 net | None — plan JSON conclusive; overlaps Defect A fix |
| 7 | Stray-token → speculative player fallback | Root of ~99% of spurious `ambiguous_player` (Defects B & C) | ~750 `declined_ambiguous` | Confirm desired failureReason for a player-free unmatched token |
| 8 | Suffix collapse in `entityResolution` | Blocks Snr/Jnr audit + all future review | 1,651 Ablett rows | — (telemetry change) |
| 9 | Snr/Jnr routing correctness | Possible silent mis-resolution | 1,651 | Resolved id or 10-row manual spot-check |
| 10 | `empty_result` vs `coverage_unavailable` labelling | Misleads reviewers about *why* a query is empty | ~few hundred | Align reason code on the era-coverage branch |

---

# Probably Ignore (no engineering effort)

| Cluster | Rows | Verdict |
|---|--:|---|
| `coverage_unavailable`, pre-1998 possessions/clearances/inside-50s/tackles/wins | ~3,952 | DATA_COVERAGE_LIMITATION — correct decline; clean era boundary (0 question-years ≥ 2000) |
| `no_results` for player + out-of-career / future / non-coexisting opponent | ~2,200 | CORRECT_EMPTY_RESULT — resolution certainty 1, plan bounds match question |
| `metres gained` / `pressure acts` / `rebound 50s` / `score involvements` | ~370 | CORRECT_DECLINE / coverage — genuinely untracked, handled cleanly |
| bare `Gary Ablett` (no suffix) → `declined_ambiguous` (conf 0.7) | small | CORRECT_DECLINE |
| same-club head-to-head (`Carlton or Blues`, `Richmond and Tigers`) | 78 | Defensible `unanswerable`; at most a friendlier message |
| team streaks (`<Club> longest winning streak`) | 83 | All answered — working |

---

# Investigate Later (NEEDS_MORE_EVIDENCE)

1. **Defect F** — `answered_caveat` threshold-drop. Blocked on the answer-payload export column; schedule that change now because this is potentially the #1 defect by volume.
2. **Snr/Jnr routing correctness** — blocked on resolved-id telemetry; then a 10-row spot check.

---

# Recommended Next Work (ranked)

Ranked by (1) questions improved, (2) confidence the behaviour is wrong, (3) change safety, (4) ease of regression coverage.

1. **Add an answer/caveat column to the NL export, then re-triage `answered_caveat` (Defect F).** Not an engine change, but it gates the single largest unknown (up to 14.6% of traffic) and the Snr/Jnr audit. Highest expected value.
2. **Fix `"no more than"` / `"no fewer than"` comparators and delete the `op=eq, value=0` fallback (Defect A).** Confidence: certain (100% mismatch in plan JSON). Safety: high (lexicon add + replace silent default with a decline). Regression: trivial plan assert.
3. **Add `"at most"` (audit siblings) to the game/season comparator lexicon; stop promoting quantifier tokens to player mentions (Defect B + fallback).** ~475 rows + cleans ~99% of spurious `ambiguous_player`. Confidence: high. Safety: high. Regression: outcome + plan asserts.
4. **Route `"<Club> wins/losses against <Club>"` to `head_to_head` (Defect D).** ~385 rows. Confidence: high (other H2H phrasings already work). Safety: medium (touches routing — regress-test `record against` / `who has won more`). Regression: grain assert.
5. **Add `"bulldogs" → Western Bulldogs` to the alias registry (Defect C).** ~408 rows, one row of data, zero risk. Regression: `resolve()` + outcome asserts + the `Footscray or Bulldogs` same-club case.
6. **Honour explicit per-game / bare-year cues ahead of the goals→career grain default (Defect E).** ~150 net rows; also removes the grain half of Defect A. Confidence: high. Safety: medium (test non-goals metrics don't regress). Regression: grain + scope asserts.
7. **Serialize the resolved player id + suffix in `entityResolution`.** Telemetry-only, low risk; unblocks the Snr/Jnr audit and every future manual review.

**Do not** invest in: broadening `metres gained` / `pressure acts`, "making the parser more tolerant" of pre-1998 stat requests, or treating player-outside-career empties as defects — those are the engine behaving correctly. Do not prioritise the same-club-H2H or `empty_result`-label nits over the generic parser bugs above.

---

## Appendix — method

- Scripts: `scratchpad/audit22k.py`, `scratchpad/audit22k_b.py` (dependency-free `csv` + `json`).
- Every defect count is derived from `plan` JSON and/or `outcome × grain × unsupportedTerms` cross-tabs, not from `outcome` alone.
- "Correct" buckets were validated against known AFL facts (statistical-coverage start dates, club entry years, player career spans) plus internal consistency (in-career variants of the same question returning `answered`).
- No expected answers were invented; unresolved cases are listed as NEEDS_MORE_EVIDENCE with the exact missing artifact.
