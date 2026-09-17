# AFLDB-ISSUE-212 — Exploratory V2: correct three confirmed V1 corpus/scorer oracle defects

Status: **RESOLVED 2026-09-17.** Local (DB-free) implementation, RED/GREEN tests, and streamanator
host generation/validation are all complete. This is follow-on item (4) of `AFLDB-ISSUE-206.md`'s six
proposals: "Correct the exploratory oracle's symmetric-matchup and achievement aggregation assertions
in a future versioned corpus, and make player identity scoring ID-aware. Preserve V1 run and its
findings." See §8 for the final validated host evidence and §6a for one genuine, distinct,
newly-discovered parser defect this issue's corrected oracle exposed (not fixed here, recorded as a
follow-up finding for a separate future issue).

Not a parser-feature issue. `PARSER_VERSION` stays `59` (unchanged); no `src/search/nl/parser.ts`,
`vocab.ts` or `semantic-intents.ts` file was touched.

## 1. Confirmed V1 root causes (re-verified from source on this branch, not re-asserted from ISSUE-206's text)

All three were independently re-checked against current source before any fix was written:

- **496 rows — `team_match_result` symmetric "versus".** `extractClubs` (`src/search/nl/parser.ts:220-268`)
  treats a literal `ClubA <v|vs|versus> ClubB` adjacency (nothing else between the two club mentions)
  as the unordered pair `scope.matchup`, unconditionally — this check runs *before*, and independently
  of, the `for`/`against`/`to` role-assignment logic (`if (!matchup) { ...role assignment... }`,
  `parser.ts:258`), so an earlier "for Club" in the same sentence cannot override it. Confirmed on the
  only V1 template that produces this exact adjacency:
  `tools/nl/generate-exploratory-corpus.mjs`'s `team_match_result` family, template 3 ("Largest
  winning margin for Sydney versus Richmond at Optus Stadium"), which asserted directional
  `expected_club`/`expected_opponent` for wording the parser has always read as unordered. Templates
  0–2 of the same family use `against`/`to`/word-order, which the parser reads directionally, and are
  unaffected. `tools/nl/corpus.ts`'s scorer only compared `plan.scope.clubFor`/`clubAgainst` and had no
  path to check `plan.scope.matchup` at all, so it reported `DROPPED_FILTER` on both slots for every
  one of these rows.
- **283 rows — `achievement_summary` aggregation.** `answerAchievementSummary`
  (`src/db/queries/nl/achievement-summary.ts`) groups and shapes its answer entirely on
  `plan.achievementSummary.kind` (`by_club`/`by_decade`/`by_season` switch, confirmed by direct read —
  no reference to `plan.agg` anywhere in the file). `parser.ts`'s aggregation resolution
  (`parser.ts:3756-3791`) has no `achievement_summary`-specific branch, so a cue-free question (none of
  the family's four templates contains an aggregation cue word) falls through to the final default,
  `resolvedAgg ?? (structureOnly ? {kind:'list'} : {kind:'max'})` — `{kind:'max'}` in every case. V1's
  generator asserted `expected_aggregation:'count'` for this family regardless; the scorer's generic
  `plan.agg.kind !== expected.aggregation` check therefore reported `WRONG_AGGREGATION` on every row
  despite the answer's actual grouping/shape being correct.
- **351 rows — Gary Ablett Jnr/Snr identity.** The parser resolves the two distinct, correct player
  ids (Jnr 4701, Snr 4700) via the qualified corpus name; both players' canonical `players.title` is
  the shared display name "Gary Ablett". `tools/nl/corpus.ts`'s player slot
  (`{ label: 'player', cls: 'WRONG_PLAYER', want: expected.player, got: plan.player?.name }`) had no
  `wantId`/`gotId` pair at all — unlike the adjacent club/venue slots, which already prefer id
  identity — so it always fell back to `sameName(expected.player, plan.player.name)`, a plain string
  comparison that a qualified corpus name ("Gary Ablett Jnr") can never win against a shared canonical
  display name ("Gary Ablett").

## 2. V2 design and versioning approach

**Generator:** `tools/nl/generate-exploratory-corpus-v2.mjs`, `generatorVersion`
`issue-212-exploratory-v2`, same fixed seed `2060542026`, same `PARSER_VERSION` `59` label (parser
untouched). It is a fork of `tools/nl/generate-exploratory-corpus.mjs`, not an in-place edit — V1's
file is byte-for-byte untouched and was not read-modified in this session beyond the initial
inspection read.

**Question generation is deliberately unchanged.** No family/template axis, no RNG-consuming call, and
no equivalence-grouping input (`keyFor()`, unmodified) was altered — only the *expectation fields
written for two families* differ (`team_match_result` template 3, `achievement_summary`), and both
changes are to columns `keyFor()` does not read. This means the accept/reject/cap decisions, the
Fisher–Yates shuffle, and therefore every row's id, question text and position are bit-identical to
V1's own deterministic run — id `N` in V1 and id `N` in V2 are the same generated question. This is the
direct id-level comparability the issue asked for, achieved by construction rather than by post-hoc
diffing.

**Scorer contract:** two new, optional CSV columns, read by `tools/nl/corpus.ts`'s `toExpectation()`
and blank on every V1/frozen-V5 row:

| Column | Values | Effect when set |
| --- | --- | --- |
| `expected_scope_kind` | `matchup` | `club`/`opponent` name the row's two unordered participants; checked against `plan.scope.matchup` as a set (either order), not as `clubFor`/`clubAgainst`. |
| `expected_achievement_kind` | an `NlAchievementSummaryKind` | Checked against `plan.achievementSummary.kind`; the grain's generic `expected_aggregation` check is bypassed for `achievement_summary` in favour of this field (own `if (expected.grain === 'achievement_summary')` branch in `scoreRow`, not a global change). |

Player identity is a **scorer-only, non-version-gated fix**: `EntityIndex` gained an optional
`playerId(name)`, and the player slot now carries `wantId`/`gotId` exactly like the pre-existing
club/venue slots (`wantId` only when `index.playerId` resolves the name unambiguously; otherwise falls
back to the unchanged `sameName` string comparison). This is generic — no player id, name, or
"Jnr/Snr" string appears anywhere in `corpus.ts`. `tools/nl/stress-test.ts` builds the index per run
from the corpus's own distinct `expected_player` names, resolved through the same `ctx.resolvePlayer`
the parser itself calls (memoised in `engine.ts`), keeping only a name the resolver settles without a
rival (sole candidate, or a strict score win over the next one); `entity-index.json` persists it
alongside the existing club/venue maps so `--report-only` reruns need no database.

**Version detection is per-row, not a flag or a corpus-wide switch.** Both new columns are read by the
same `readCorpus`/`scoreRow` that already scores the frozen V1 12,000-row corpus and the V1 exploratory
corpus; their absence (every existing row) reproduces the exact pre-ISSUE-212 comparison. This was a
deliberate choice over a `--corpus-version` flag: it follows the corpus's own existing rule ("a blank
column asserts nothing") instead of adding a second axis of behaviour to reason about, and it means a
future third corpus can mix rows that do and do not use these columns without any harness change.

## 3. Files changed

| File | Change |
| --- | --- |
| `tools/nl/corpus.ts` | `StressExpectation` gains `scopeKind`/`achievementSummaryKind` (+ `toExpectation` reads the two new columns); `EntityIndex` gains optional `playerId`; `scoreRow` gains the matchup-set check, the achievement_summary-specific aggregation branch, and id-preferring player comparison. |
| `tools/nl/stress-test.ts` | New `buildPlayerIndex()`; `loadV1Engine`'s `index` gets `playerId` wired in `main()` from the corpus's own distinct player names; `entity-index.json` read/write extended with `players`; `reportUnindexedEntities` also reports an unindexed player name. |
| `tools/nl/generate-exploratory-corpus-v2.mjs` | New file (forked from the V1 generator). `generatorVersion` `issue-212-exploratory-v2`; `HEADER` gains the two new optional columns; `team_match_result` template 3 sets `expected_scope_kind='matchup'`; `achievement_summary` drops `expected_aggregation` and sets `expected_achievement_kind`; manifest gains `supersedes`, `correctedFamilies`, `scopeKindCounts`, `achievementKindCounts`. |
| `tools/nl/triage-exploratory-corpus.mjs` | Its own independent field comparison (a diagnostic, not the pass/fail oracle) updated to recognise `expected_scope_kind='matchup'` the same way, so it stays a valid diagnostic for a V2 corpus instead of reporting a spurious `OWNERSHIP_LOSS` on every corrected matchup row. No change needed for the achievement-summary case (its generic `expected_plan_json`/`achievementSummary` comparison already covered it; the aggregation `cmp()` already no-ops on a blank `expected_aggregation`). |
| `tools/nl/README.md` | Documents the two new optional columns, the player-identity comparison, and `entity-index.json`'s new `players` map. |
| `tests/nl-stress-corpus.test.ts` | Three new `describe` blocks (RED→GREEN, see §5), each with the required negative control. |
| `AFLDB-ISSUE-212.md`, `issues.md`, `IssuesIndex.md` | This tracking. |

`src/search/nl/parser.ts`, `vocab.ts`, `semantic-intents.ts`, `plan.ts` (`PARSER_VERSION`) — **untouched**.
`/home/arm/nl-exploratory-v1.csv` / `.manifest.json` — **not read or modified in this session** (no
host access from this workstation); nothing in this branch's diff touches them.

## 4. Scoring principle applied

Per the issue's own instruction, entity/answer-shape authority is asserted only where the compiler
actually owns it, not blanket-relaxed:

- Player identity: id is authoritative wherever an index can resolve it (club/venue already worked
  this way; player now matches the same pattern) — a wrong id still fails.
- Symmetric matchup: the unordered pair is authoritative only for rows that assert it via
  `scopeKind`; every other row keeps the exact pre-existing directional `clubFor`/`clubAgainst` check.
- Achievement summary: `achievementSummary.kind` is authoritative only for that one grain;
  `expected_aggregation` is checked at full, unchanged strength for every other grain (verified by a
  negative-control test — see §5).

## 5. RED/GREEN test evidence

Added to `tests/nl-stress-corpus.test.ts`. RED evidence for each: the finding these tests assert
against is the ISSUE-206-confirmed defect quoted from source in §1 above (the pre-fix `scoreRow` code
this session started from). Closure is based on the host validation in §8, run against the actual
generated V2 corpus and current parser v59 — the decisive evidence for this issue's own defects.

- **Symmetric matchup** (`describe('AFLDB-ISSUE-212: symmetric "versus" matchup scoring')`): passes
  with both expected clubs present in `scope.matchup` in either order; a directional-shaped plan
  (`clubFor`/`clubAgainst`, no `matchup`) against a `scopeKind:'matchup'` expectation is a
  `DROPPED_FILTER`; a matchup missing one expected club is `WRONG_CLUB`. **Negative control:** an
  expectation with no `scopeKind` (genuinely directional wording) still fails on a swapped
  `clubFor`/`clubAgainst` plan and passes on the correct one — the pre-existing directional path is
  unchanged.
- **Achievement summary** (`describe('AFLDB-ISSUE-212: achievement_summary scored by
  achievementSummary.kind')`): a plan carrying the generic default `agg:{kind:'max'}` but the correct
  `achievementSummary.kind` passes; a wrong `kind` is `WRONG_AGGREGATION`. **Negative control:** an
  ordinary (non-`achievement_summary`) grain's `expected_aggregation` mismatch against the plan's `agg`
  still fails — the generic check is not globally weakened.
- **Player identity** (`describe('AFLDB-ISSUE-212: player identity prefers a resolved id over
  display-name text')`): a correct distinct id (Jnr 4701 vs. Snr 4700, both `name:'Gary Ablett'`)
  passes; the wrong distinct id fails even though the display name still matches. **Ordinary-player
  control:** a uniquely-named player with no index entry still matches/fails by name, unchanged. **No-
  index control:** with no player index supplied at all, the exact pre-ISSUE-212 name-only comparison
  is reproduced (still fails on the Ablett case) — the fix is additive, never regressing the DB-free
  path.

## 6. V1 compatibility

- `readCorpus`/`toExpectation`/`scoreRow` are the same functions the frozen V1 12,000-row corpus and
  the V1 exploratory corpus already run through; every new field/branch is gated on a column that is
  absent on both, so their scoring is byte-for-byte the pre-ISSUE-212 behaviour with one documented
  exception below.
- **Documented exception (per the issue's own allowance for this):** player-identity id-preference is
  *not* gated by corpus version, because it is strictly more precise and only activates when
  `stress-test.ts`'s engine can resolve a name to exactly one id — it cannot regress a row that already
  passed by name (a name match with a resolvable, disagreeing id would itself be a real defect worth
  surfacing, not a false failure to guard against). **Confirmed** (see §8): the frozen V5 12,000-row
  corpus rerun with the updated scorer stayed **12000 scored / 12000 clean / 0 soft / 0 failed** — no
  regression from this issue's scorer changes.
- V1's own file, its 12,000-row expectations, and every retained v54–v59 result artifact are untouched.

## 6a. Newly discovered, distinct parser defect (not fixed here, correctly still hard-fails under V2)

While reasoning about the corrected V2 oracle's coverage, row `#20609919` ("... margin for North
Melbourne versus Melbourne at Adelaide Oval ...") was confirmed (parser result identical across V1 and
V2 — same id, same question, same parse) to produce `clubFor=North Melbourne, clubAgainst=Melbourne,
scope.matchup=absent`, not the unordered matchup this template's wording asserts under V2. This is
**not** a corpus/scorer defect and **not** something ISSUE-212 introduced — the parser plan is
unchanged between runs; V1's directional oracle happened to match by coincidence (see mechanism
below), which is exactly the kind of false-clean result this issue's V2 corpus exists to stop hiding.

**Source-verified mechanism:** `extractClubs` (`parser.ts:220-268`) correctly identifies both club
mentions via `findClub` (longest-alias matching finds "North Melbourne" as one mention, not two), but
its *positional* recomputation for the unordered-matchup check re-derives each mention's span with
`phrasePosition`/`phraseEnd` (`parser.ts:162-170`), both `new RegExp('\\b'+phrase+'\\b').exec(text)` —
a bare regex search of the **entire original text** for the matched club's own display string, taking
whichever occurrence comes first. When the second club's display text also occurs, word-bounded, as a
substring of the first club's own display text (here, "Melbourne" is word-bounded inside "North
Melbourne"), this search finds that embedded occurrence — which sits *before* the first club's own
span ends — instead of the real, later, standalone "versus Melbourne" mention. `between = text.slice
(left.end, right.at)` (`parser.ts:249`) then computes a negative/empty slice, `between !== 'versus'`,
and `matchup` never forms; the same buggy `at` also feeds `nearestGoverningPreposition`'s own lookback
for the second club, so the role-assignment fallback (`parser.ts:258-266`, the *unordered* branch that
runs when nothing is `governedAgainst`) resolves `clubFor`/`clubAgainst` by original draw order instead
— which is why the result reads as directionally "correct" here (`clubFor=North Melbourne,
clubAgainst=Melbourne` matches the template's own `club`/`opponent` assignment) rather than obviously
wrong. This is a coincidence of word order, not a safety net: the same mechanism could just as easily
assign the roles the other way for a differently-ordered pair.

**Scope decision: do not suppress this in the V2 oracle.** The wording "for A versus B" is
structurally identical regardless of which two clubs fill A/B, so `expected_scope_kind='matchup'`
correctly applies to every `team_match_result` template-3 row uniformly, including this one — the
resulting hard failure is a true, previously-hidden defect finding, exactly the "cleaner evidence for
future parser work" this issue exists to produce (see Purpose). Special-casing the generator to avoid
asserting `matchup` for these club pairs would re-hide the same defect V1's directional oracle already
hid, the opposite of this issue's intent. No `corpus.ts`/generator change was made for this.

**Other pairs in the generator's own `CLUBS` array with the identical structural shape** (a shorter
club's display text is a whole word inside a longer club's display text, in the order the "... for A
versus B ..." template draws them — i.e. the longer name drawn as `c` and the shorter as `o`), which
the same source-verified mechanism would predict to produce the same kind of hard failure:

- `c[0]='Port Adelaide'`, `o[0]='Adelaide'`
- `c[0]='Greater Western Sydney'`, `o[0]='Sydney'`

(The reverse draw order for each pair — e.g. `c[0]='Melbourne'`, `o[0]='North Melbourne'` — does *not*
trigger it: the shorter name drawn first has no earlier embedded occurrence to collide with, traced
through the same source above.)

**These two pairs are hypotheses from source inspection only and have not been empirically
reproduced.** The actual host validation run (§8) found exactly **one** genuine hard failure in the
whole 27,530-row scored V2 corpus — row `#20609919` — meaning that, in this specific seeded generation,
either `distinctClub` never drew the `Port Adelaide`/`Adelaide` or `Greater Western Sydney`/`Sydney`
pair in this exact order for a `team_match_result` template-3 row, or it did and the predicted mechanism
did not reproduce for it. Both remain open, unconfirmed possibilities; nothing in this session's host
run distinguishes between them, and no further investigation was performed (out of scope for this
closeout). Only `North Melbourne`/`Melbourne` (row `#20609919`) is empirically confirmed.

Recorded here as a genuine finding for a possible **separate future issue** — **no next issue number is
allocated in this closeout**, per this repository's convention for an out-of-scope discovery made while
resolving a different issue (e.g. ISSUE-208's `assignCrossDomainClubs` finding). An operator may open a
tracked issue for it, scoped to confirming or ruling out the two unreproduced pairs before deciding
whether to fix the underlying `phrasePosition`/`phraseEnd` mechanism.

## 7. Closeout checklist (all complete)

Per the issue's own closure gate ("Do not mark RESOLVED until V2 has been generated and validated on
streamanator"), all of the following were completed before this issue was marked RESOLVED:

1. Ran the commands in §9 below on streamanator.
2. Generated V2 on streamanator; confirmed deterministic replay (two runs, identical SHA256) — see §8.
3. Confirmed V2-vs-frozen-V5 overlap is 0/0 (the same invariant the generator itself enforces and
   throws on) — see §8.
4. Ran parser v59 against V2 into `/home/arm/nl-exploratory-v2-v59-validation` — see §8.
5. Confirmed the three corrected clusters (symmetric matchup, achievement summary, Gary Ablett
   identity) no longer appear as false hard failures, and recorded the *exact* V2 counts (not V1's
   carried-forward numbers) — see §8.
6. Confirmed the frozen V1 12,000-row rerun with the updated scorer stays 12000/12000/0/0 (§6).
7. Confirmed exactly one genuine, distinct, previously-hidden hard failure (§6a, row `#20609919`) — a
   pre-existing parser defect this issue's corrected oracle exposed, not a corpus/scorer defect and not
   introduced by this issue. Not fixed here; recorded as a follow-up finding for a possible separate
   future issue, with no issue number allocated in this closeout.
8. Updated this file's Status to RESOLVED, `issues.md`, `IssuesIndex.md`, and `CHANGELOG.md`.

## 8. Final host validation evidence (streamanator, 2026-09-17)

**V2 generation:**

```text
29,030 rows
seed 2060542026
SHA256 bb75e4b5067942117c60f8eab6cfd01de4d8fc1e0c4fee07e10650fae97edb4a
deterministic replay confirmed (two runs, identical SHA256)
V5 exact overlap: 0
V5 normalized overlap: 0
1,500 audit-required (unscored, same audit population as V1)
```

**Frozen V1 12,000-row corpus, rerun with the updated scorer:**

```text
12000 scored
12000 clean
0 soft
0 failed
```

No regression — confirms §6's documented exception (player-identity id-preference) did not disturb the
frozen corpus.

**Exploratory V2, parser v59:**

```text
27,530 scored
14,878 clean
12,651 soft
1 failed
1,500 audit-required
55 diagnostic groups
```

**V1-v59 → V2-v59 hard-failure reconciliation.** This compares the *same* V1 corpus rows and the *same*
current parser (v59) scored two ways — once under the pre-ISSUE-212 oracle (`V1-v59`), once under this
issue's corrected oracle (`V2-v59`) — not V1's original v54 numbers from `AFLDB-ISSUE-206.md`:

```text
1308 old hard failures removed (V1-v59 → V2-v59)
1 newly exposed genuine hard failure (row #20609919, see §6a)
net failed count change = -1307
```

This is **not** "1307 failures fixed" — it is two separate, opposite-direction movements that happen to
net to -1307: 1,308 rows that were hard-failing only because of the three confirmed corpus/scorer oracle
defects (§1) now correctly score clean or soft, and 1 row that was previously hard-passing by
coincidence (§6a) now correctly hard-fails on a genuine, different, pre-existing parser defect the
corrected oracle no longer accidentally hides.

**Removed-hard-failure breakdown (1,308 total):**

| Category | Rows |
| --- | --- |
| `team_match_result` (symmetric matchup fix) | 545 |
| `achievement_summary` (aggregation fix) | 320 |
| `player_game_scope_collision` (player-identity fix) | 213 |
| `player_game_scoped_total` (player-identity fix) | 118 |
| `player_game_single` (player-identity fix) | 112 |

The three `player_game_*` rows total **443** player-identity removals, split:

```text
225 Gary Ablett Snr
218 Gary Ablett Jnr
```

**Why these counts exceed AFLDB-ISSUE-206's original figures (496 / 283 / 351):** `AFLDB-ISSUE-206.md`'s
counts were measured against parser v54. Five parser fixes landed between v54 and v59
(AFLDB-ISSUE-207 through 211), each of which moved previously-*declined* rows into a scored plan for the
first time (most directly, AFLDB-ISSUE-210's imperative-phrasing fix and AFLDB-ISSUE-211's `after YEAR`
fix — both explicitly recorded exposing more Gary-Ablett-pattern rows as they became newly reachable).
None of those fixes touched `extractClubs`'s matchup detection, `achievementSummary` aggregation, or
player-identity resolution — they are unrelated parser-vocabulary gains that simply let more rows *reach*
the same three pre-existing oracle/scorer defects this issue corrects. The v54→v59 counts growing
(545 vs 496, 320 vs 283, 443 vs 351) is the expected, correct consequence of that reachability increase,
not a sign of a new or different defect.

## 9. Commands used for host validation

Local (this workstation or any checkout of this branch):

```sh
npx vitest run tests/nl-stress-corpus.test.ts
npm run typecheck
```

Streamanator (after this branch is available on that host):

```sh
node tools/nl/generate-exploratory-corpus-v2.mjs \
  --baseline /home/arm/nl-stress-corpus-v5.csv \
  --out /home/arm/nl-exploratory-v2.csv \
  --manifest /home/arm/nl-exploratory-v2.manifest.json

# deterministic-replay check
node tools/nl/generate-exploratory-corpus-v2.mjs \
  --baseline /home/arm/nl-stress-corpus-v5.csv \
  --out /home/arm/nl-exploratory-v2-replay.csv \
  --manifest /home/arm/nl-exploratory-v2-replay.manifest.json
sha256sum /home/arm/nl-exploratory-v2.csv /home/arm/nl-exploratory-v2-replay.csv

npm run nl:stress -- --corpus /home/arm/nl-exploratory-v2.csv \
  --out /home/arm/nl-exploratory-v2-v59-validation --parse-only --concurrency 6

node tools/nl/triage-exploratory-corpus.mjs \
  --corpus /home/arm/nl-exploratory-v2.csv \
  --results /home/arm/nl-exploratory-v2-v59-validation/results.jsonl \
  --failures /home/arm/nl-exploratory-v2-v59-validation/failures.csv \
  --summary /home/arm/nl-exploratory-v2-v59-validation/summary.json \
  --out /home/arm/nl-exploratory-v2-v59-validation/triage.md \
  --json /home/arm/nl-exploratory-v2-v59-validation/triage.json

# V1 compatibility check (§6's documented exception, unaffected columns)
npm run nl:stress -- --corpus /home/arm/nl-stress-corpus-v5.csv --out /home/arm/nl-stress-v5-recheck
```
