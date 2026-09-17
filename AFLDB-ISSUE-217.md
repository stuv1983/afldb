# AFLDB-ISSUE-217 — `player_game_single` "haul"/"peak single-game"/"which match saw...collect" phrasing declines with `unsupported_term`

Status: **IMPLEMENTED, NOT YET RESOLVED** — awaiting operator host validation on `streamanator`.

## 1. Problem, as given

Three large `player_game_single` exploratory clusters remain under `PARSER_VERSION` 63:

```text
423 — player_game_single/0
422 — player_game_single/4
409 — player_game_single/3
-----------------------------
1254 rows
```

Representative `/0` failures:

```text
What was Dustin Martin's biggest Brownlow votes haul in one match during the 2010s
-> unsupported_term: dustin martin haul

What was Chris Judd's biggest goals haul in one match in 2009
-> unsupported_term: chris judd haul
```

Representative `/4` failures:

```text
Find Lance Franklin's peak single-game clearances in 2017
-> unsupported_term: lance franklin peak single-game

Find Nat Fyfe's peak single-game inside 50s in 2009
-> unsupported_term: nat fyfe peak single-game
```

Representative `/3` failures:

```text
Which match saw Patrick Dangerfield collect the most goal assists since 2000
-> unsupported_term: match saw patrick dangerfield collect

Which match saw Patrick Dangerfield collect the most kicks in 2017
-> unsupported_term: match saw patrick dangerfield collect
```

Optional adjacent cluster inspected: `player_game_scope_collision/3` (555 rows):

```text
Find the single-match disposals record for Shane Crawford against Brisbane Lions at Gabba in 2009
-> unsupported_term: single-match shane crawford
```

## 2. Scope proof — do `/0`, `/3`, `/4` share one root cause?

`tools/nl/generate-exploratory-corpus-v2.mjs`, `player_game_single` generator (lines 229-238):

```js
{ name:'player_game_single', n:2100, make() {
  const p=P(), s=S(), t=T(), template=pick([0,1,2,3,4]);
  const q=[
    words('What was',p+"'s",'biggest',s[0],'haul in one match',t.q),         // 0
    words('Show the highest',s[0],'game for',p,t.q),                        // 1
    words(p,'record',s[0],'in a game',t.q),                                 // 2
    words('Which match saw',p,'collect the most',s[0],t.q),                 // 3
    words('Find',p+"'s",'peak single-game',s[0],t.q),                      // 4
  ][template];
  return row('player_game_single',template,q,
    temporal({grain:'player_game',mode:'single',metric:s[1],aggregation:'max',player:p},t),
    {depth:2,scope:t.type});
}},
```

All five templates share one expected-plan shape. Templates `/1` and `/2` already score clean:

- `/1` ("Show the highest `<stat>` game for `<player>`") via the pre-existing `STAT_GAMES_IDIOM_WORDS`
  "`<stat>` game(s)" idiom (`src/search/nl/vocab.ts` ~line 934), which resolves the metric AND consumes
  the trailing "game" in one step.
- `/2` ("`<player>` record `<stat>` in a game") via the pre-existing `AGG_WORDS` "record" → `max` entry
  (`src/search/nl/vocab.ts` line 214) plus the named-player default at grain election
  (`src/search/nl/parser.ts` ~line 3312).

`/0`, `/3`, `/4` never reach a plan. This confirms the family is not broken uniformly — only the three
templates whose wrapper word has no vocabulary entry anywhere in the pipeline fail.

`player_game_scope_collision` generator (lines 240-248), template 3:

```js
words('Find the single-match',s[0],'record for',p,'against',c[0],'at',v[0],t.q)
```

expects the identical `{grain:'player_game',mode:'single',metric,aggregation:'max',player,opponent,venue}`
shape, plus opponent/venue scope.

## 3. Root cause — verified from current source, ONE shared mechanism

**Grain/mode election was already correct in every failing row before this fix.** A named player's
per-game stat question defaults to `grain = 'player_game', mode = 'single'`
(`src/search/nl/parser.ts` lines 3312-3322, the "A named player's per-game stat defaults to their
single-game peak" branch) whenever `aggregateTotal`/`overCareer` are absent — true in all three failing
templates. Grain election is not the defect.

The actual defect is upstream, in player-mention resolution — step 12, `candidatePlayerSpan`
(`src/search/nl/parser.ts` line 2037):

```ts
function candidatePlayerSpan(text: string): string | null {
  const tokens = text.split(/\s+/).filter(Boolean);
  const alphaRun = tokens.filter((t) => {
    if (STOPWORDS.has(t)) return false;
    const words = splitNameWords(t);
    return words.length > 0 && words.every((w) => /^[a-z]+$/.test(w));
  });
  if (alphaRun.length === 0) return null;
  return alphaRun.slice(0, 4).join(' ');
}
```

This takes the first **four** remaining non-`STOPWORDS` alpha tokens in `text`, in order, with no notion
of "stop at a non-name word", and joins them into one candidate string handed to `ctx.resolvePlayer`.

"haul" (`/0`), "peak" and "single-game" (`/4`), and "match"/"saw"/"collect" (`/3` — "which" alone is a
`STOPWORDS` entry, so only it is excluded) had no vocabulary entry anywhere in the pipeline before this
fix. Each survived in `text` all the way to step 12 and was swept into the candidate span alongside the
real player name:

| Question (after earlier stages consume metric/agg/season) | `candidateRaw` | Result |
|---|---|---|
| "...dustin martin biggest brownlow votes haul in one match..." → after metric/agg/season strip: "...dustin martin haul..." | `dustin martin haul` | fails `resolvePlayer` (score depressed below `PLAYER_ACCEPT_SCORE`) |
| "...lance franklin peak single-game clearances..." → after metric/season strip: "...lance franklin peak single-game..." | `lance franklin peak single-game` | fails resolution |
| "...which match saw patrick dangerfield collect..." → "which" stripped as a stopword | `match saw patrick dangerfield` (4-token cap; "collect" overflows) | fails resolution, "collect" also surfaces separately in `leftoverTokens` |

The polluted span then fails `ctx.resolvePlayer` outright, producing `unresolvedPlayerMention =
candidateRaw`, which is exactly the reported `unsupported_term` string in every representative failure
above (`"dustin martin haul"`, `"lance franklin peak single-game"`, `"match saw patrick dangerfield
collect"`) — confirmed by direct trace against `report.unsupportedTerms`'s construction
(`src/search/nl/parser.ts` lines 4133-4150: `unresolvedPlayerMention` is pushed first, then
`leftoverTokens` — which excludes tokens already inside `unresolvedPlayerMention` but NOT tokens beyond
the four-token cap, explaining why "collect" appears as a second, separate entry). This is not the
"leftover alias" hypothesis raised in the issue brief — the player name IS resolved correctly whenever it
reaches `resolvePlayer` alone; the defect is that it never reaches `resolvePlayer` alone.

**`player_game_scope_collision/3` shares the identical mechanism.** The template reads "single-match
`<stat>` record for `<player>` against `<club>` at `<venue>`..." — by the time `candidatePlayerSpan` runs
at step 12, "`<stat>`" is already consumed by metric extraction, "record" by the pre-existing `AGG_WORDS`
entry, and "for" is a `STOPWORDS` entry, so "single-match" ends up the token immediately preceding the
surviving player-name span in `text`. Before this fix, bare "single-match" had no vocabulary entry (only
"in ... single game/match" did), so it was swept into the candidate alongside the player name the same
way "haul"/"peak" were — e.g. `"single-match shane crawford"`, matching the issue's representative
failure exactly. Confirmed included per the issue's own inclusion test (§9 below), not assumed from name
similarity.

### Possessive vs non-possessive forms (issue requirement 4)

`canonicalise`'s `'s\b` strip (`src/search/nl/vocab.ts` line 145: `.replace(/['’]s\b/g, '')`) already
normalises "Dustin Martin's" to "dustin martin" cleanly, before any extractor runs. Possessive forms
(`/0`, `/4`) and non-possessive forms (`/3`) reach `candidatePlayerSpan` through the identical mechanism —
possessive normalisation was never the defect, and the two forms are not distinct mechanisms.

## 4. Corpus expectation verification

The generator's `e` object for both `player_game_single` and `player_game_scope_collision` is identical
in shape across every template within each family (§2 above). No generator/scorer defect found; neither
file touched.

## 5. Fix

`src/search/nl/vocab.ts`:

- `IN_ONE_GAME` gains a second alternative: `\bsingle[- ](?:game|match)\b`, reading the bare compound
  adjective ("peak single-game clearances", "the single-match disposals record") as the same single-game
  cue "in a single game" already is. Narrowly anchored — "single" must be immediately adjacent to
  "game"/"match" (a hyphen or one space, nothing between) — so it cannot fire on an unrelated "single"
  elsewhere in a question ("his single greatest game").
- Four new exports:
  - `WHICH_MATCH_SAW_RE = /^which match saw\b\s*/` — anchored to the very start of the string, the same
    discipline `LEADING_REQUEST_PREFIX_RE` uses for its own request-wrapper verbs.
  - `PLAYER_GAME_SINGLE_COLLECT_RE = /\bcollect(?:s|ed|ing)?\b/` — read only once `WHICH_MATCH_SAW_RE`
    has already matched (parser.ts), so a bare "collect" anywhere else in a question is untouched.
  - `PLAYER_GAME_SINGLE_HAUL_RE = /\bhaul\b/` and `PLAYER_GAME_SINGLE_PEAK_RE = /\bpeak\b/` — read only
    once the single-game cue AND an actual `METRIC_WORDS` match are both already present in the text,
    the same two-part gating discipline `PLAYER_SEASON_LEADERBOARD_SEASONAL_RE` (ISSUE-216) uses.

`src/search/nl/parser.ts`:

- `whichMatchSawCue` computed before the existing `IN_ONE_GAME`/`IN_A_FINAL`/`IN_A_GRAND_FINAL`/
  `IN_ONE_SEASON`/`OVER_CAREER`/`AGGREGATE_TOTAL_WORDS` cue-strip loop, and OR'd into `inOneGame`'s own
  election — the leading phrase is itself a valid single-game cue, not merely consumed text.
- Immediately after that loop: if `whichMatchSawCue`, consume the leading phrase (it sits ahead of the
  player mention, so it must be gone before `candidatePlayerSpan` runs at step 12) and, separately,
  "collect" wherever it sits after the player mention — both gated on the same boolean, so "collect" can
  never fire without the leading phrase also having matched.
- Then, gated on `inOneGame && METRIC_WORDS.some(([re]) => re.test(text))`, consume "haul"/"peak" if
  present.

No grain-election branch was touched — grain/mode were already correct; only the text pollution reaching
step 12 was fixed.

## 6. Semantic checks (issue requirements 1-9)

1. Expected plans for `/0`/`/3`/`/4` confirmed correct by direct source trace against the generator (§2).
2. Player names ARE resolved by the existing resolver, but the text span handed to it was never the
   player's name alone (§3) — confirmed by trace, not the "leftover alias" hypothesis.
3. Possessive and non-possessive forms fail through the identical mechanism (§3) — not distinct.
4. Grain already lands on `player_game` in every case.
5. Mode already lands on `single` in every case via the existing named-player default.
6. `max` aggregation is already present via existing `AGG_WORDS` entries ("biggest"/"most") — untouched.
7. "haul", "peak", "single-game", "match saw", "collect" were the only remaining problem once grain/
   mode/player/metric were confirmed already correct.
8. Player identity ownership happens in `candidatePlayerSpan`/`resolvePlayer` (step 12), strictly AFTER
   wrapper-word interpretation needs to happen (step 6) to keep the wrapper words out of the span — this
   ordering is exactly why the fix consumes the wrapper words before step 12.
9. `player_game_scope_collision/3` shares the exact same mechanism (§3) and is included.

## 7. RED tests added

`tests/nl-parser.test.ts`, new top-level `describe('AFLDB-ISSUE-217: ...')` block, DB-free:

- Three representative `/0` cases (Dustin Martin/Brownlow votes, Chris Judd/goals, Patrick
  Dangerfield/marks), three `/4` cases (Lance Franklin/clearances, Nat Fyfe/inside 50s, Dustin
  Martin/kicks), three `/3` cases (Patrick Dangerfield/goal assists, Patrick Dangerfield/kicks, Chris
  Judd/handballs) — each asserting `p.grain`/`p.mode`/`p.metric`/`p.agg`/`p.player?.name`/
  `p.scope.seasonMin`/`p.scope.seasonMax` together, not merely a non-decline.
- Both representative `player_game_scope_collision/3` cases (Shane Crawford vs Brisbane Lions at Gabba;
  Jason Akermanis vs Port Adelaide at Optus Stadium), additionally asserting `p.scope.clubAgainst?.name`
  and `p.scope.venue?.name`.
- Six new `PLAYERS` fixture entries (Chris Judd, Lance Franklin, Nat Fyfe, Patrick Dangerfield, Shane
  Crawford, Jason Akermanis), one new club (Brisbane Lions), two new venues (Gabba, Optus Stadium).
- Ten regression controls: existing single-game wording (`dusty most disposals`) unchanged; "haul" in
  unrelated text (no single-game cue) still declines; "peak" in unrelated text (no single-game cue) still
  declines; bare "single-game" with no supported player/stat construction still declines; bare "record"
  with no metric/player still declines (pre-existing `AGG_WORDS` behaviour untouched); "collect" outside
  the "which match saw...collect" construction still declines; named-player scoped totals (`dusty total
  goals against carlton`) stay `player_game`/`sum`; career record wording (`who has the most career
  goals`) stays `player_career`; the AFLDB-ISSUE-216 player-season leaderboard wording stays
  `player_season`; club/team match records (`richmond biggest win in a final`) stay `team_match`.

## 8. Parser version

`PARSER_VERSION` 63 → 64 (`src/search/nl/plan.ts`). Production parser semantics changed; bumped exactly
once.

## 9. Local validation (this session)

- `npm install` (worktree was dependency-less; operator-authorised) — succeeded, unrelated dependency
  vulnerability noise only.
- `npx vitest run tests/nl-parser.test.ts` → **575/575 passed** (554 pre-existing + 21 new).
- `npx vitest run tests/nl-regression-corpus.test.ts tests/nl-semantic-mapping.test.ts
  tests/nl-stress-corpus.test.ts` → **402/402 passed** (163/163 + 174/174 + 65/65, no regression).
- `npm run typecheck` → clean.

## 10. Guardrails honoured

No player, club, venue, metric, or corpus ID special-cased in `parser.ts`/`vocab.ts`. "haul"/"peak"/
"collect"/"match"/"saw"/"record" not added to `STOPWORDS` or any blanket-ignore list. "haul"/"peak" are
gated on the single-game cue AND a real `METRIC_WORDS` match; "collect" is gated on the anchored
`whichMatchSawCue`; the "single-game"/"single-match" adjective extension requires the words to be
immediately adjacent, with no interaction with `SCOPE_GOVERNS_MATCH_TYPE`'s separate final/grand-final
concern (`src/search/nl/parser.ts` lines 495-517, confirmed by direct inspection — that gate governs
match-TYPE words only, not the `game`/`match` noun `IN_ONE_GAME` itself reads). "record" received no new
consumption logic (pre-existing `AGG_WORDS` entry, untouched). No unrelated NL family touched. Exploratory
V2 generator/scorer untouched (corpus expectation verified correct, not changed).

## 11. Hygiene

`git status --short` showed the four intended files
(`src/search/nl/parser.ts`, `src/search/nl/plan.ts`, `src/search/nl/vocab.ts`,
`tests/nl-parser.test.ts`). One zero-byte stray artefact (`2`, a shell-redirect-parsing artefact from an
earlier command this session) was found and deleted, positively identified as session-created.

## 12. Host validation — not yet run

Recommended commands for the operator on `streamanator`:

1. Frozen V5 rerun against `PARSER_VERSION` 64 — expect **12000 scored / 12000 clean / 0 soft / 0
   failed**, unchanged.
2. Retained exploratory V2 corpus (`/home/arm/nl-exploratory-v2.csv`) rerun against v64 — report new
   scored/clean/soft/failed/audit-required counts against the v63 baseline (27530 / 17612 / 9918 / 0 /
   1500).
3. `player_game_single/0`, `/4`, `/3` remaining counts, and `player_game_scope_collision/3` remaining
   count — expect 0 in all four if the fix generalises as traced in §3 (NOT promised in advance, per the
   issue's own instruction).
4. A direct v63-vs-v64 structured-plan comparison across all 29,030 rows — confirm changed-plan count, 0
   missing rows, and zero unrelated movement outside the four target clusters. If the fix generalises
   exactly as traced, the expected changed-row count is `423 + 422 + 409 + 555 = 1809`, but this is a
   traced expectation to be confirmed by evidence, not a promised result.

## 13. Resolution

**NOT YET RESOLVED.** Status stays `IMPLEMENTED, NOT YET RESOLVED` until the operator runs the host
validation in §12 on `streamanator` and confirms the expected outcomes. `CHANGELOG.md` entry deferred
until then, per the issue's explicit instruction.
