# AFLDB-ISSUE-218 — `team_match_result` "widest"/"how much...lose"/"lopsided meeting" phrasing declines with `unsupported_term`

**Status:** IMPLEMENTED, NOT YET RESOLVED (Sonnet 5). Round 1 host validation
(commit `5bcc957`, `PARSER_VERSION = 65`) found V5 green but exposed a genuine
`team_match_result/2` semantic discrepancy — re-investigated in §14-§18 below
and determined to be an exploratory V2 GENERATOR/ORACLE defect, not a parser
regression. Corrected in this same session (generator-only, `PARSER_VERSION`
unchanged at 65). Awaiting round-2 operator host validation on `streamanator`.

## 0. Round-1 host validation result (superseded investigation, see §14+)

Commit `5bcc957`, `PARSER_VERSION = 65`:

- Frozen V5: **12000 scored / 12000 clean / 0 soft / 0 failed** — GREEN, no regression.
- Exploratory V2: v64 baseline (19421 clean / 8109 soft / 0 failed / 1500 audit-required) → v65 (**19943 clean / 7018 soft / 569 failed / 1500 audit-required**): +522 clean, -1091 soft, +569 failed.
- Reconciles to `team_match_result/1` (522 rows, fully cleared, as intended) and `team_match_result/2` (569 rows, moved from an honest soft decline into a **hard failure** — worse than the pre-fix state). `team_match_result/0` unchanged at 56, as intentionally deferred.
- v65 triage for the 569 `/2` rows: every row reports `WRONG_METRIC` (actual `loss_margin`) plus `OWNERSHIP_LOSS` on both `clubFor` and `clubAgainst`, with the ownership diagnostics self-classified by `tools/nl/triage-exploratory-corpus.mjs`'s own hardcoded rule (line ~133, `if (f.family==='team_match_result' && ['clubFor','clubAgainst'].includes(f.field)) return 'corpus_expectation_error';`) as a corpus-expectation error, while the metric diagnostic fell through to that same tool's default `silent_wrong_plan` bucket — an inconsistency in the ad-hoc triage tool's own labelling (see §17), not independent evidence that the metric and ownership are two different defects.

This is why the issue was reopened rather than closed: a hard failure on 569 rows is worse than the original honest decline, and per the critical guardrail the issue cannot close while any `/2` row is `failed`.

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

## 12. Expected host validation, ROUND 1 (superseded — see §14 onward)

*This section recorded the pre-round-1 prediction. Round 1 ran (§0) and exposed a real defect in this prediction's assumption that the exploratory oracle's `/2` expectation was already correct — it was not. Kept for history; do not use to judge round 2.*

1. ~~Re-run the frozen V5 stable corpus... expect 12000/12000 clean/0 soft/0 failed.~~ **Confirmed true** — V5 stayed green.
2. ~~Re-score exploratory V2 against v65...~~ **Ran; see §0.**
3. ~~Confirm target-cluster counts: `/2` 569 → 0...~~ **False** — `/2` moved to 569 HARD FAILURES, not 0.
4. ~~A direct v64-vs-v65 plan comparison expecting exactly 1091 changed plans...~~ Not reached; investigation reopened instead (§14).

## 13. Resolution (superseded — see §18)

Not resolved after round 1: the critical guardrail ("a hard failure is worse than the original honest decline") was violated by the round-1 result. Reopened; see §14-§18.

## 14. Reopened investigation — is parser v65 wrong, or is the exploratory V2 oracle wrong for `/2`?

Per the operator's explicit instruction, the pre-round-1 conclusion "the generator/scorer was correct" is retracted pending fresh evidence, and the question is answered from first principles: production SQL semantics, the parser's own established conventions, and direct empirical comparison — never from the exploratory oracle itself.

### 14a. Canonical production semantics for `margin`/`win_margin`/`loss_margin`

`src/db/queries/nl/team-match.ts`'s `metricValueExpr` (the only place these three metrics compile to SQL):

```ts
case 'win_margin':
  return sql`CASE WHEN t.winner_club_id = t.club_id THEN (t.score_for - t.score_against) END`;
case 'loss_margin':
  return sql`CASE WHEN t.winner_club_id IS NOT NULL AND t.winner_club_id <> t.club_id
                   THEN (t.score_against - t.score_for) END`;
```

There is **no generic `margin` metric anywhere in the type system** — `NL_METRICS.team_match` (`src/search/nl/plan.ts`) lists only the two typed, polarity-specific metrics. `t.club_id` is `scope.clubFor`'s organization (`scopeClauses`, same file: `t.club_id IN (SELECT id FROM clubs WHERE organization_id = ${scope.clubFor.organizationId})`). So: **`win_margin` is defined as "the margin BY WHICH `clubFor` won"; `loss_margin` is defined as "the margin BY WHICH `clubFor` lost."** Both are already, unambiguously, `clubFor`-relative — this has been the production representation since before AFLDB-ISSUE-218 (`richmond biggest loss`, `adelaide worst loss to gws giants`, both pre-existing passing tests, already use exactly this convention). The issue's original "metric = margin" wording (in the initial runbook's Required Semantics section) was informal/descriptive, not naming a real field — the real implementation must, and already did, choose `win_margin` vs `loss_margin` based on `clubFor`'s own result.

**Answer to A: `loss_margin` (a typed, `clubFor`-relative metric) is the correct, already-established canonical representation for a directional "team X lost" query — not a generic `margin`.**

### 14b. Canonical `clubFor`/`clubAgainst` ownership for "X lost to Y"

`src/search/nl/parser.ts`'s `extractClubs`/`nearestGoverningPreposition` (unchanged by this issue, in production since AFLDB-ISSUE-208/213): the **ungoverned mention** (no `for`/`by`/`from`/`against`/`versus`/`vs`/`v`/`to`/`over` immediately before it) becomes `clubFor`; a mention governed by an against-preposition becomes `clubAgainst`. This is not new or specific to `/2` — it is the SAME rule every existing directional test already relies on:

- `richmond biggest loss` → `clubFor=Richmond` (subject, ungoverned).
- `adelaide worst loss to gws giants` → `clubFor=Adelaide` (subject), `clubAgainst=GWS` (governed by "to").
- `richmond's widest lead against carlton` → `clubFor=Richmond`, `clubAgainst=Carlton`.

"Collingwood lost to Carlton" has the identical grammatical shape as "Adelaide['s] loss to GWS Giants" — Collingwood/Adelaide is the ungoverned sentence subject, Carlton/GWS is governed by "to". Applying the SAME, already-shipped rule: `clubFor=Collingwood`, `clubAgainst=Carlton`, and since Collingwood (the subject) is the one who lost, `metric=loss_margin`.

**Answer to B: ownership is subject-oriented (`clubFor` = the grammatical/query subject — the club the question names first and un-governed), never winner-oriented.** This is not a new decision made for ISSUE-218; it is the pre-existing, uniformly-applied contract every directional team-match test in this repository already depends on.

### 14c. `/1` comparison

`/1`'s two templates:

```text
At Kardinia Park, find the widest Pies win to North Melbourne in 2023
At SCG, find the widest Greater Western Sydney loss to Sydney in 2017
```

Both keep the SAME club (`Pies`/`GWS`) as the sentence's first-named, ungoverned subject throughout, exactly like `/0`'s and `/3`'s templates. v65 parses both exactly as intended: `clubFor=Collingwood`/`Greater Western Sydney` (subject), `clubAgainst=North Melbourne`/`Sydney` (governed by "to"), `metric=win_margin`/`loss_margin` matching the subject's own result. This is why round 1 found `/1` **fully clean (522/522)** with zero defect — its wording never diverges from the same subject-first convention `/0` and `/3` also use.

`/2`, by contrast, is built the opposite way round: `"By how much did O beat/lose-to C..."` puts the SECOND-drawn club (`o`) in the sentence-subject slot and the FIRST-drawn club (`c`) as the object of the verb — the one template in the family that does this (confirmed by direct inspection of `tools/nl/generate-exploratory-corpus-v2.mjs` lines 300-308, quoted in §3/§14d below). `/1` and `/2` are NOT semantically different constructions — both are the same directional team-match-result record query — but the ORACLE represented them inconsistently: `/1`'s expected `club` field always tracks the actual grammatical subject (because its template happens to keep `c` as subject), while `/2`'s expected `club` field names `c` regardless of the fact that its OWN template's wording puts `o` in the subject position instead.

### 14d. Generator/oracle construction — exact defect

`tools/nl/generate-exploratory-corpus-v2.mjs` (pre-fix), `team_match_result`:

```js
const c=C(), o=distinctClub(c), v=V(), t=T(), lose=chance(.4), template=pick([0,1,2,3]);
const noun=lose?'defeat':'victory', metric=lose?'loss_margin':'win_margin';
const q=[
  words('What was',possessive(c[0]),'biggest',noun,'against',o[0],'at',v[0],t.q),          // template 0: C is subject
  words('At',v[0]+',','find the widest',c[0],lose?'loss':'win','to',o[0],t.q),              // template 1: C is subject
  words('By how much did',o[0],lose?'beat':'lose to',c[0],'in their most lopsided meeting at',v[0],t.q), // template 2: O is subject!
  words('Largest',lose?'losing':'winning','margin for',c[0],'versus',o[0],'at',v[0],t.q),   // template 3: C is subject (matchup anyway)
][template];
return row('team_match_result',template,q,temporal({grain:'team_match',metric,aggregation:'max',club:c[1],opponent:o[1],venue:v[1]},t), ...);
```

Templates 0, 1 and 3 all keep `c[0]` as the sentence's grammatical subject, so the fixed `club:c[1]` expectation always happens to name the club the (unchanged) parser convention will bind as `clubFor`. Template 2 alone swaps the word order — `o[0]` is named immediately after "did", `c[0]` is the object of "beat"/"lose to" — yet its expected `club:c[1]`/`metric` were never adjusted to match. This is a genuine, template-2-only authoring inconsistency within the SAME generator function, not a semantic ambiguity: templates 0/1/3 establish, unambiguously, that this family's "club" field is supposed to name the sentence's grammatical subject, and template 2 simply fails to follow its own family's contract.

### 14e. Empirical confirmation (not inferred — directly measured)

A temporary DB-free probe (this session, `tests/tmp-issue218-*.test.ts`, deleted after use — not committed) parsed the exact pre-fix-generator `team_match_result/2` rows with the real, unmodified v65 parser and compared to the CSV's pre-fix expected values:

| question | oracle expected (pre-fix) | v65 parser actual |
|---|---|---|
| "...did Western Bulldogs beat Swans..." | `club=Sydney, opponent=Western Bulldogs, metric=loss_margin` | `clubFor=Western Bulldogs, clubAgainst=Sydney, metric=win_margin` |
| "...did Fremantle lose to Richmond..." | `club=Richmond, opponent=Fremantle, metric=win_margin` | `clubFor=Fremantle, clubAgainst=Richmond, metric=loss_margin` |
| "...did Pies lose to Carlton..." | `club=Carlton, opponent=Collingwood, metric=win_margin` | `clubFor=Collingwood, clubAgainst=Carlton, metric=loss_margin` |

Every row: oracle's `club`/`opponent` are exactly the parser's `clubAgainst`/`clubFor` (swapped), and the metric is exactly inverted — precisely the "O is the real subject, C is the real object" mismatch predicted in §14d, with no exceptions across the sample.

After applying the fix in §16, the SAME probe technique was re-run exhaustively against **all 576 `team_match_result/2` rows** produced by a full local regeneration (fake 12,000-row placeholder V5 baseline, seed unchanged) — **0 mismatches out of 576**, i.e. every corrected row's expected `{metric, club, opponent}` now equals exactly what the unmodified v65 parser produces.

### 14f. Determination

**Outcome 1 — parser v65 is correct; the exploratory V2 oracle has a genuine, template-2-only construction defect.** No parser code changes in this correction pass. `PARSER_VERSION` stays 65.

## 15. Note on the triage tool's inconsistent labelling

`tools/nl/triage-exploratory-corpus.mjs` (an ad-hoc, non-authoritative diagnostic script, distinct from the real scorer in `tools/nl/corpus.ts`) already carries a hardcoded rule (line ~133) that reclassifies any `team_match_result` `clubFor`/`clubAgainst` ownership mismatch as `corpus_expectation_error` — i.e. its own author already anticipated this exact class of oracle defect for this exact family. Its separate, simpler `cmp('metric', ...)` comparator (line 84) has no equivalent carve-out, so the metric mismatch fell through to the default `silent_wrong_plan` bucket even though it is not an independent defect — it is the direct, mechanical consequence of comparing the parser's metric to the WRONG club's expected metric once ownership itself is already mismatched (see `tools/nl/corpus.ts` lines 531-536, `bothMargins` → `WRONG_RESULT_SIDE`, which explicitly documents win_margin-vs-loss_margin as "the polarity bug class... clusters separately", i.e. this codebase's real scorer already has a name for exactly this shape of finding). No triage-tool code was changed — it is an operator-facing diagnostic aid, out of scope for a parser-vs-corpus determination, and its bucket labels were correctly not treated as authoritative per the operator's own instruction.

## 16. Correction made

`tools/nl/generate-exploratory-corpus-v2.mjs`, `team_match_result` generator, template 2 ONLY:

```js
// template 0,1,3: unchanged, club=c[1]/opponent=o[1]/metric=metric (C is subject)
const resultOwner = template === 2 ? o : c;
const resultOpponent = template === 2 ? c : o;
const resultMetric = template === 2 ? (lose ? 'win_margin' : 'loss_margin') : metric;
return row('team_match_result',template,q,temporal({grain:'team_match',metric:resultMetric,aggregation:'max',club:resultOwner[1],opponent:resultOpponent[1],venue:v[1]},t), ...);
```

No RNG-consuming call added, removed, or reordered (`C()`, `distinctClub()`, `V()`, `T()`, `chance()`, `pick()` all called exactly as before, in the same order) — question text and row IDs are unaffected. Verified: a full local regeneration (fake baseline, same seed `2060542026`) found **0 question-text differences** and **576 changed rows, all and only `template_id=team_match_result/2`** (0 rows touched in `/0`, `/1`, `/3`, or any other family). Templates 0, 1 and 3's own code paths are untouched. No parser/vocab/plan source file changed in this correction. No corpus IDs, exact question strings, clubs, or venues special-cased — the fix is keyed only on the structural `template === 2` branch already present in the same function, mirroring templates 0/1/3's own already-existing per-template branching (e.g. `scopeKind:template===3?'matchup':undefined`).

`src/search/nl/parser.ts`, `src/search/nl/vocab.ts`, `src/search/nl/plan.ts`, and `tests/nl-parser.test.ts` are UNCHANGED from the round-1 implementation (§1-§11 above still describe them accurately). No new RED test added to `tests/nl-parser.test.ts` for this correction — the corrected semantics were ALREADY the ones asserted there (the round-1 "distinguishes 'Pies lose to Carlton' from 'Pies beat Carlton'" test already pins exactly this ownership/metric contract; the defect was never in the parser those tests exercise).

## 17. Parser version after correction

Unchanged: **65**. Production parser semantics did not move in this correction — only the exploratory V2 generator's own expected-value construction for one template did. Per the operator's explicit instruction, `PARSER_VERSION` is not bumped for a corpus-only correction.

## 18. Tests after correction

- `npx vitest run tests/nl-parser.test.ts` → **595/595 passed**, unchanged from round 1 (no parser/vocab/plan source touched).
- `npx vitest run tests/nl-regression-corpus.test.ts tests/nl-semantic-mapping.test.ts tests/nl-stress-corpus.test.ts` → **402/402 passed**, unchanged.
- `npm run typecheck` → clean, unchanged.
- No committed generator/scorer unit test suite exists for `generate-exploratory-corpus-v2.mjs` (confirmed by search — it is a standalone CLI script, not imported as a module by any test file, consistent with AFLDB-ISSUE-212's own precedent of validating it via host-side manifest/hash + downstream scoring rather than a local unit suite). In place of inventing new test infrastructure, this session validated the correction directly and exhaustively (§14e): a full local regeneration plus an exhaustive parser-vs-expectation diff over all 576 `team_match_result/2` rows it produced, 0 mismatches.

## 19. Documentation status

`issues.md` and `IssuesIndex.md` updated to record: the round-1 host result, the reopened investigation, the root-cause determination (oracle defect, not parser), and the correction made. Status remains **IMPLEMENTED, NOT YET RESOLVED**. `CHANGELOG.md` still not touched.

## 20. Expected host validation, ROUND 2 (NOT YET RUN)

The frozen `/home/arm/nl-exploratory-v2.csv` on `streamanator` must be REGENERATED (not hand-patched) from the corrected `tools/nl/generate-exploratory-corpus-v2.mjs`, using the SAME real V5 baseline and the SAME seed (`2060542026`, the script's default — do not pass `--seed`), to produce a byte-for-byte-identical-except-`/2`-expectations replacement corpus:

```text
node tools/nl/generate-exploratory-corpus-v2.mjs \
  --baseline /home/arm/nl-stress-corpus-v5.csv \
  --out /home/arm/nl-exploratory-v2-corrected.csv \
  --manifest /home/arm/nl-exploratory-v2-corrected.manifest.json
```

Then:

1. Diff `/home/arm/nl-exploratory-v2.csv` (round-1 frozen file) against the new `nl-exploratory-v2-corrected.csv`: expect **0 `question` column differences** anywhere, and changes confined **only** to rows with `template_id=team_match_result/2` (expect the real-baseline count to again be close to 569, not necessarily exactly 576 — that count came from a local fake-baseline run with no V5-overlap rejections). Any row outside that template_id changing, or any `question` text changing anywhere, is a hard stop — do not proceed to scoring.
2. Re-run the frozen V5 stable corpus against `PARSER_VERSION = 65` (unchanged parser) — expect **12000/12000 clean/0 soft/0 failed** again (this was already green in round 1 and no parser code changed, but re-confirm).
3. Re-score `nl-exploratory-v2-corrected.csv` against `PARSER_VERSION = 65`. Expect **0 failed** (the critical guardrail): the 569 `team_match_result/2` rows should return to `clean` (not merely back to the pre-fix `soft`), since the corrected oracle now asserts exactly what the parser produces. Expect the aggregate to reconcile to roughly `19421 (v64 baseline) + 522 (/1, already banked) + ~569 (/2, now also clean) ≈ 20512` clean, `0` failed, `1500` audit-required unchanged, `team_match_result/0` still 56 honest declines.
4. A direct structured-plan comparison of `nl-exploratory-v2.csv` (round-1) vs `nl-exploratory-v2-corrected.csv` scored at the SAME `PARSER_VERSION = 65`: expect the ONLY rows whose scored outcome changes are the `team_match_result/2` rows (failed → clean), zero unrelated movement, and the actual PLAN each of those rows produces is IDENTICAL before and after (only the CSV's own expectation columns changed — the parser was never touched).

Status stays IMPLEMENTED, NOT YET RESOLVED until round 2 reconciles with 0 failed and the above confirmations. Only then update `CHANGELOG.md` and close the issue.
