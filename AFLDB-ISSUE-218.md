# AFLDB-ISSUE-218 — `team_match_result` "widest"/"how much...lose"/"lopsided meeting" phrasing declines with `unsupported_term`

**Status:** IMPLEMENTED, NOT YET RESOLVED (Sonnet 5). Awaiting operator host validation on `streamanator`.

## 1. Problem, as given

Three `team_match_result` exploratory clusters decline under `PARSER_VERSION = 64`:

```text
569 — team_match_result/2 — "By how much did Pies lose to Carlton in their most lopsided meeting at Adelaide Oval after 1999" -> unsupported_term: how much lose lopsided meeting
522 — team_match_result/1 — "At Kardinia Park, find the widest Pies win to North Melbourne in 2023" -> unsupported_term: find widest
56  — team_match_result/0 — "What was Bombers' biggest victory against Pies at Optus Stadium in 2017" -> unsupported_term: bombers'
```

Baseline: clean `main` after AFLDB-ISSUE-217 (`19e6dc68`). Frozen V5: 12000/12000/0/0. Exploratory V2 under v64: 29030 input / 27530 scored / 19421 clean / 8109 soft / 0 failed / 1500 audit-required.

## 2. Scope proof — do `/0`, `/1`, `/2` share one root cause?

`tools/nl/generate-exploratory-corpus-v2.mjs` lines 300-316 (`team_match_result` generator) — all four templates (0-3) share one expected-plan shape:

```js
temporal({ grain: 'team_match', metric, aggregation: 'max', club: c[1], opponent: o[1], venue: v[1] }, t)
```

where `metric` is `win_margin`/`loss_margin` from the row's `lose` flag. Only template 3 ("Largest margin for C versus O...") sets `expected_scope_kind: 'matchup'` — a separate, already-resolved defect (AFLDB-ISSUE-212/213), out of scope here.

Direct trace against `src/search/nl/parser.ts` (`extractClubs`, `nearestGoverningPreposition`) and `src/search/nl/vocab.ts` (`TEAM_METRIC_WORDS`, `AGG_WORDS`) proved, BEFORE any code change:

- `/1` and `/2` already extract `clubFor`/`clubAgainst` correctly. Templates use `against`/`to` (already in `AGAINST_PREPOSITION`), so the existing club-role machinery from AFLDB-ISSUE-208/213 handles both without modification.
- The correct win/loss direction is already latent for any wording using the existing NOUN forms (`loss`/`win`/`defeat`/`victory` in `TEAM_METRIC_WORDS`). `/2`'s verb forms ("lose to"/"beat") were the only thing missing.
- `/0`'s only failure is a single leftover token, `bombers'` — everything else in that template (venue, opponent via "against", year) already resolves.

**Conclusion: `/1` and `/2` share ONE mechanism (missing wrapper vocabulary around an already-correct semantic extraction). `/0` is a distinct, unrelated, already-known possessive-alias defect and does NOT belong in this issue.**

## 3. Root cause(s) — verified from current source

### `/1` and `/2`: three independent, purely-additive wrapper gaps

1. **`/1`'s "widest"** was absent from `AGG_WORDS`'s max-aggregation regex (`src/search/nl/vocab.ts` line ~221) — every other synonym ("biggest"/"largest"/"greatest"/"longest"/"maximum"/"heaviest"/"most") was already there.
2. **`/1`'s leading "At V, find..."** — `LEADING_REQUEST_PREFIX_RE` (AFLDB-ISSUE-210) only reaches a request verb at the very start of the string. AFLDB-ISSUE-215's `LEADING_FOR_CLAUSE_REQUEST_PREFIX_RE` widened that to a leading `for` scope clause only ("For Adelaide, find..."). A leading VENUE scope clause ("At Kardinia Park, find...") is the identical shape, one preposition later — `at` was never added to the leading-preposition set.
3. **`/2`'s "by how much did X lose/beat Y..."** uses the VERB forms of the existing win/loss NOUNS. Neither `lose`/`lost`/`beat` existed anywhere in `TEAM_METRIC_WORDS`, so the win/loss cue never matched. This is distinct from `extractHavingClause`'s pre-existing `lose`/`lost` entry (`src/search/nl/parser.ts` line 1708), which only claims the word when a NUMBERED threshold follows nearby ("teams to lose 5 times") — with no count present, that extractor leaves the text untouched (confirmed by reading its final-return branch), so the bare verb reaches `extractTeamMetric` unclaimed. `/2` additionally leaves "how much" and "most lopsided meeting" as decorative wrapper text once the verb IS recognised — "most" already yields `max` via the pre-existing `AGG_WORDS` entry, so "lopsided meeting" changes no semantics (required-semantics item 4 confirmed: pure max-margin wording, not a distinct semantic path).

Direct trace confirms whichever club is the grammatical subject of `lose`/`beat` is always the ungoverned mention `extractClubs` already binds to `clubFor` — no new position-reading logic was needed. `lose`/`lost` ⇒ `clubFor` is the losing side; `beat`/`beats` ⇒ `clubFor` is the winning side — the exact mirror of how the noun forms already behave. For "beat" specifically, neither club is governed by a preposition at all ("X beat Y" has no preposition before Y), so both clubs fall through to `extractClubs`'s existing word-order fallback (first ungoverned = `clubFor`, second = `clubAgainst`) — pre-existing, general-purpose logic, not something added for this fix.

### `/0`: a distinct, already-known possessive-alias defect

`canonicalise()`'s only possessive-stripping rule (`src/search/nl/vocab.ts` line ~145, `/['’]s\b/g`) matches an apostrophe immediately BEFORE a trailing "s" ("richmond's" → "richmond"). "Bombers'" is an ALREADY-PLURAL noun with the apostrophe AFTER the "s" ("bombers'") — that regex does not match it at all, and the punctuation-strip step deliberately leaves apostrophes untouched (needed for "o'brien"). The trailing apostrophe survives glued to "bombers", fails every club-alias match, and surfaces as the sole leftover token — exactly the reported `bombers'` failure.

This is the IDENTICAL mechanism AFLDB-ISSUE-214 already found and deliberately left unfixed for `club_season_rank` ("Suns'"/"Pies'"/"Bulldogs'", 210 rows), and that issue's own residual-pattern list names further plausible recurrences across `team_streak` ("Tigers' longest unbeaten streak") and checkpoint/team-record wording. It is a genuinely cross-family, generic possessive-alias defect — **deferred, not fixed here**, per this runbook's explicit instruction not to shoehorn a one-family fix onto a cross-family defect.

## 4. Corpus expectation verification

The generator's `e` object is identical in shape across templates 0-2 (Scope proof above, §2). No generator/scorer defect found; `tools/nl/generate-exploratory-corpus-v2.mjs` / `tools/nl/corpus.ts` not touched.

## 5. Fix

`src/search/nl/vocab.ts`:

- `AGG_WORDS`'s max-aggregation entry gains `widest` alongside the existing synonyms.
- `LEADING_FOR_CLAUSE_REQUEST_PREFIX_RE` (AFLDB-ISSUE-215) renamed `LEADING_SCOPE_CLAUSE_REQUEST_PREFIX_RE` and widened from a leading `for` clause to `(?:for|at)`. `at` is the same generic, already-recognised venue-scoping preposition venue extraction reads anywhere else it appears (venue matching runs on the full text regardless of context); `on` deliberately left out — no corpus wording ever needs it.
- `TEAM_METRIC_WORDS` gains two verb entries immediately after the existing noun forms:
  ```ts
  [/\b(?:lose|loses|lost)\b/, 'loss_margin'],
  [/\bbeats?\b/, 'win_margin'],
  ```
- Two new exports, gated wrapper words (never added to `STOPWORDS` or any blanket-ignore list):
  ```ts
  export const TEAM_MATCH_RESULT_HOW_MUCH_RE = /\bhow much\b/;
  export const TEAM_MATCH_RESULT_LOPSIDED_RE = /\blopsided (?:meeting|match|game|contest|encounter)s?\b/;
  ```

`src/search/nl/parser.ts`:

- At the existing point where a matched `teamMetricResult` word is stripped from `text` (step 11), a new gated block fires only when `teamMetricResult.metric` is `win_margin`/`loss_margin` **and** both `clubFor` and `clubAgainst` have already resolved — i.e. only once the sentence is a confirmed directional two-club result construction — consuming `TEAM_MATCH_RESULT_HOW_MUCH_RE` and `TEAM_MATCH_RESULT_LOPSIDED_RE` if present.

No grain-election branch touched. No club-role assignment logic touched.

## 6. Semantic checks (issue requirements 1-7)

1. Expected plans for `/0`-`/2` confirmed correct by direct source trace against the generator (§2).
2. `/1`/`/2` already extracted both clubs correctly before this fix (§3).
3. `/2` preserves direction correctly when the subject club is the loser — confirmed by the explicit "lose to" vs "beat" distinguishing test (same `clubFor`, opposite metric).
4. "most lopsided meeting" is pure wrapper wording, not a semantic change — `max` aggregation comes entirely from "most" (pre-existing `AGG_WORDS`); "lopsided meeting" contributes nothing once consumed.
5. `/1`/`/2` already elected the correct grain/metric before this fix; only wrappers were missing.
6. `/0` fails specifically because "bombers'" is never consumed by `canonicalise`'s possessive-stripping rule (confirmed by direct regex trace).
7. `/0` shares its mechanism with the already-documented `club_season_rank` possessive-alias defect (AFLDB-ISSUE-214) and is deferred to a future cross-family issue.

## 7. RED tests added

`tests/nl-parser.test.ts`, new top-level describe block "AFLDB-ISSUE-218", DB-free, all fixtures reused from the existing `CLUBS`/`VENUES` directories (no new fixtures needed):

- Three representative `/2` cases (Collingwood loses to Carlton at Adelaide Oval after 1999; Hawthorn loses to Geelong at the MCG since 2000; Richmond loses to Carlton in 2017 with no venue), each asserting grain/metric/agg/clubFor/clubAgainst/venue/season bounds together.
- The explicit "lose to" vs "beat" direction-distinguishing test.
- Three representative `/1` cases (Collingwood's widest win to North Melbourne at the MCG in 2023; Greater Western Sydney's widest loss to Sydney at Docklands in 2017 — exercising the AFLDB-ISSUE-213 GWS/Sydney overlapping-name pair directionally; Richmond's widest win to Carlton at Adelaide Oval since 2000).
- One `/0` deferral control proving "Bombers' biggest victory against Pies" still declines on the unresolved "bombers'" token, unchanged by this fix.
- Regression controls: already-supported directional win/loss queries unchanged; ordinary head-to-head stays `head_to_head`; symmetric "versus" matchup (AFLDB-ISSUE-213) unaffected; venue ownership intact; "find" still not globally ignored; "widest" contributes aggregation only (does not rescue an unsupported question) and generalises correctly beyond this issue's templates; bare "meeting" without "lopsided" still declines; unrelated "lost" usage still declines on its own genuinely unsupported term; team score/crowd and team streak families unaffected.

## 8. Parser version

`PARSER_VERSION` bumped 64 → 65 (`src/search/nl/plan.ts`), production parser semantics changed, exactly once.

## 9. Local validation (this session)

- `npm install` (previously dependency-less worktree, operator-authorised by the runbook).
- `npx vitest run tests/nl-parser.test.ts` → **595/595 passed** (575 pre-existing + 20 new).
- `npx vitest run tests/nl-regression-corpus.test.ts tests/nl-semantic-mapping.test.ts tests/nl-stress-corpus.test.ts` → **402/402 passed** (163/163 + 174/174 + 65/65), no regression.
- `npm run typecheck` → clean.

## 10. Guardrails honoured

No club, venue, year, or corpus ID special-cased in `parser.ts`/`vocab.ts`. "widest"/"lose"/"lost"/"beat" added as unconditional word→aggregation/metric mappings exactly like their existing synonyms, never as blanket stopwords. "how much"/"lopsided meeting" gated on a positively-recognised win/loss-margin construction with both clubs resolved, never added to `STOPWORDS`. `LEADING_SCOPE_CLAUSE_REQUEST_PREFIX_RE` widened only to `at` (not `on`), on the evidence no corpus wording needs it. `/0` deliberately left declining. No unrelated NL family touched. Exploratory V2 generator/scorer untouched.

## 11. Hygiene

`git status --short` showed the four intended files (`src/search/nl/parser.ts`, `src/search/nl/plan.ts`, `src/search/nl/vocab.ts`, `tests/nl-parser.test.ts`). One zero-byte stray artefact (`club_season`, a shell-redirect-parsing artefact from an earlier command this session) was found and deleted, positively identified as session-created.

## 12. Expected host validation (streamanator, NOT YET RUN)

1. Re-run the frozen V5 stable corpus (`/home/arm/nl-stress-corpus-v5.csv`) at `PARSER_VERSION = 65` — expect **12000/12000 clean/0 soft/0 failed**, unchanged.
2. Re-score the frozen exploratory V2 corpus (`/home/arm/nl-exploratory-v2.csv`, NOT regenerated) against v65; compare against the v64 baseline (27530 scored / 19421 clean / 8109 soft / 0 failed / 1500 audit-required).
3. Confirm target-cluster counts: `team_match_result/2` 569 → expected 0; `team_match_result/1` 522 → expected 0; `team_match_result/0` 56 → expected UNCHANGED at 56 (deliberately not fixed).
4. A direct v64-vs-v65 structured-plan comparison of all 29,030 rows, expecting exactly `569 + 522 = 1091` changed plans, zero unrelated movement, and zero change to any `team_match_result/0` row's plan.

Status stays IMPLEMENTED, NOT YET RESOLVED until this runs and reconciles. Do not update `CHANGELOG.md` until then.

## 13. Resolution

Not yet resolved — awaiting operator host validation per §12.
