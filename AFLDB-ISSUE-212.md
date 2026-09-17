# AFLDB-ISSUE-212 — Exploratory V2: correct three confirmed V1 corpus/scorer oracle defects

Status: IMPLEMENTED, NOT YET RESOLVED. Local (DB-free) implementation and RED/GREEN test
authorship complete on `sonnet/issue-212-exploratory-v2-scoring`. Host generation and validation on
streamanator are outstanding — do not mark RESOLVED until those run. This is follow-on item (4) of
`AFLDB-ISSUE-206.md`'s six proposals: "Correct the exploratory oracle's symmetric-matchup and
achievement aggregation assertions in a future versioned corpus, and make player identity scoring
ID-aware. Preserve V1 run and its findings."

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
this session started from). **Local GREEN confirmation via `npx vitest run` is an outstanding operator
action** (see §7) — not claimed here per CLAUDE.md's evidence discipline.

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
  surfacing, not a false failure to guard against). A V1 rerun with the updated scorer is *expected* to
  remain **12000/12000/0/0** on the frozen corpus; this is unverified until the host rerun in §7 runs
  and must be confirmed there before this issue can resolve.
- V1's own file, its 12,000-row expectations, and every retained v54–v59 result artifact are untouched.

## 7. Outstanding — required before RESOLVED

Local, DB-free work (generator, scorer, tests, docs) is complete. Still required, per the issue's own
closure gate ("Do not mark RESOLVED until V2 has been generated and validated on streamanator"):

1. Run the commands in §8 below (operator- or explicitly-authorised-session-executed, per
   `CLAUDE.md`'s Git/shell boundary).
2. Confirm `npx vitest run tests/nl-stress-corpus.test.ts` and `npm run typecheck` pass locally.
3. Generate V2 on streamanator, confirm deterministic replay (two runs, identical SHA256), duplicate
   IDs = 0, duplicate questions = 0.
4. Confirm V2-vs-frozen-V5 overlap is 0/0 (same invariant the generator already enforces and throws on).
5. Run parser v59 against V2 into `/home/arm/nl-exploratory-v2-v59-validation`.
6. Confirm the three corrected clusters (symmetric matchup, achievement summary, Gary Ablett identity)
   no longer appear as hard failures, and report the *exact* V2 counts (not V1's carried-forward
   numbers) for clean/soft/failed and for each corrected cluster.
7. Confirm the frozen V1 12,000-row rerun with the updated scorer stays 12000/12000/0/0 (§6's
   documented exception).
8. Update this file's Status to RESOLVED with the actual counts, update `issues.md`/`IssuesIndex.md`,
   and add a `CHANGELOG.md` entry during closeout.

## 8. Exact commands for the operator

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
