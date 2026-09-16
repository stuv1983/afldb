# AFLDB-ISSUE-211 — Implement `after YEAR` as an exclusive season lower bound

Status: **RESOLVED 2026-09-17** (Sonnet 5, operator-validated on
streamanator). Implemented and focused-tested on
`sonnet/issue-211-after-year-season-bound` (base current clean `main` after
ISSUE-210, implementation commit `c113e6a`). `PARSER_VERSION` 58 → 59.

This is follow-on item (5) of `AFLDB-ISSUE-206.md`'s six proposals, directly
from that issue's final triage of the 29,030-row independent exploratory
corpus, and the largest single unimplemented soft-decline vocabulary family
it found.

## Defect / product gap

`extractSeasons` (`src/search/nl/parser.ts`) implemented `in YEAR`,
`since YEAR`, `before YEAR`, `between YEAR and YEAR`, and decades, but had no
form for `after YEAR`. `AFLDB-ISSUE-206.md` §5/§7 documented this explicitly
as a pending product decision (not a defect — an honest, correctly-labeled
decline), and named it the largest single soft-decline vocabulary
contributor: `after` alone 829 term-frequency rows among the 15,275
soft-decline rows, plus combinations (`season after` 83, `find after` 82,
`posted season tally after` 76, `find seasonal after` 69) — "roughly
1,200+ rows", explicitly **not** a verified per-row classification.

## Evidence-first inventory (this session)

The two retained host artifacts named in the issue brief
(`/home/arm/nl-exploratory-v1.csv`, `/home/arm/nl-exploratory-v58-validation/results.jsonl`)
are **not present on this Windows workstation** — confirmed by `ls`/`find`
before any implementation work started. Per the issue's own instruction, the
`~1,200+` estimate is **not** treated as a verified affected-row count in
this record; it is AFLDB-ISSUE-206's own term-frequency read of the
soft-decline bucket, not a classification that separates genuine
`after YEAR` temporal wording from `after the siren` or other non-temporal
`after` phrasing. That separation requires an operator run against the
retained host artifacts (exact commands below) and is listed as outstanding
validation, not assumed.

What **is** available locally and was used instead is a direct read of the
current parser source:

- `extractSeasons` (`parser.ts:379-449`) is the single season extractor;
  `in YEAR`/decades/`between`/`since`/`before`/bare-year all live inside it,
  called once (`parser.ts:2100`) — confirming there is no second, competing
  season parser to worry about and that this extractor should own `after`
  too, per the issue's implementation constraint.
- `SINCE_RE`/`BEFORE_RE`/`BETWEEN_RE`/`BARE_YEAR_RE` (`vocab.ts:714-726`) are
  all anchored to a literal `\d{4}` immediately after the keyword — the
  existing, established contract for this extractor's vocabulary.
- The after-siren family (`AFTER_SIREN_CUE_RE` and friends, `vocab.ts:433-`)
  and the achievement-clause connective `AFTER_THE_ACHIEVEMENT`
  (`vocab.ts:1131`, `after|following|since` + a determiner) are the two
  other places `after` has meaning. Neither ever puts a literal 4-digit year
  immediately after the word — `AFTER_THE_ACHIEVEMENT`'s own comment
  (`vocab.ts:1127-1129`) explicitly calls out `"after 1950"` as a *different*
  clause "with its own owner" that its regex must not (and does not) match.
  This is independent, pre-existing confirmation that a year-anchored
  `after` extractor cannot collide with either family.

## Intended semantics

`after YEAR` is an **exclusive** lower season bound: `scope.seasonMin = YEAR + 1`
(AFL seasons are whole years). This is deliberately distinct from `since YEAR`
(inclusive, `scope.seasonMin = YEAR`), asserted directly by a dedicated
contrast test (see RED phase).

## Fix

One new anchored regex and one new branch in the existing extractor, both
minimal, no new stage, no second parser:

- `AFTER_RE = /\bafter (\d{4})\b/` (`src/search/nl/vocab.ts`), immediately
  after `BEFORE_RE`, following the exact same anchoring convention as
  `SINCE_RE`/`BEFORE_RE`. Because it requires a literal 4-digit year right
  after the word, it structurally cannot match `after the siren`, `after
  their`, `after that`, `after round 12`, or any other non-temporal `after`
  usage — no vocabulary/stopword change, nothing global.
- In `extractSeasons` (`src/search/nl/parser.ts`), `AFTER_RE` is checked in
  an `else` branch alongside the existing `since` check (`since` still runs
  first, unconditionally, exactly as before): if `since` didn't already
  claim the lower bound, try `after`, and if it matches, set
  `seasonMin = Number(after[1]) + 1`, push the matched text to `consumed`,
  and strip it from `working` — the same three-step pattern `since`/`before`
  already use. `before`, `between`, decades and the bare-year fallback are
  completely unchanged; `before` still runs unconditionally after this
  branch, so `after 2000 before 2010`-shaped input (not a real corpus
  wording, not tested) would still be able to set both bounds, same as
  today's `since ... before ...`.

### Files changed

- `src/search/nl/vocab.ts` — new `AFTER_RE`.
- `src/search/nl/parser.ts` — import `AFTER_RE`; new `else` branch in
  `extractSeasons`.
- `src/search/nl/plan.ts` — `PARSER_VERSION` 58 → 59 + history comment.
- `tests/nl-parser.test.ts` — new `describe('AFLDB-ISSUE-211: after YEAR
  season bound', ...)` block (14 tests).

No change to `semantic-intents.ts` (grepped for `after`; no matches) and no
change to any after-siren vocabulary, `STOPWORDS`, stage ordering, or
`since`/`before`/`between`/exact-year/decade logic.

## RED phase

14 tests, all in the new describe block:

**Grain diversity (mirrors an already-supported `since YEAR` form in each
case, so only the bound arithmetic is new):**
- `most goals after 2019` → `player_season`, `seasonMin 2020` (mirrors
  `most goals since YEAR` → `player_season`, confirmed by direct probe: this
  bare-metric form reads as `player_season`, not `player_career`, exactly
  like `most goals since 2019` / `most brownlow votes since 2010` already do
  — corrected during RED after the first draft wrongly assumed
  `player_career`).
- `richmond biggest win after 2000` → `team_match`, `win_margin`,
  `seasonMin 2001`.
- `most brownlow votes after 2010` → `player_season`, `seasonMin 2011`.
- `most disposals at the MCG after 1995` → `player_game`, venue-scoped,
  `seasonMin 1996`.
- `teams with the most wins in a season after 2000` → `club_season`,
  `seasonMin 2001`.
- `dusty most goals after 2015` → named-player composition, `seasonMin 2016`.
- `Adelaide biggest win against GWS Giants after 2000` → composition with an
  opponent club, `seasonMin 2001`, opponent identity unaffected.

**Direct semantic contrast:**
- `after 2000` → `seasonMin 2001`; `since 2000` → `seasonMin 2000`, both
  asserted in the same test.

**Negative controls (required by the issue, real existing grammar, no
manufactured nonsense):**
- `who kicked the most goals after the siren` → `scope.seasonMin`/`seasonMax`
  both `undefined` (unchanged, no false season bound).
- `who kicked a goal after the siren to win` → same.
- `who has kicked the most goals after the siren for richmond in the finals
  after 2000` → composed control: after-siren club scoping (`clubFor`
  `Richmond`) survives untouched **and** the trailing `after 2000` still sets
  `seasonMin 2001` — proves the new extractor and the after-siren family
  coexist in one question without interference.

**Boundary years (per the issue's explicit boundary-case list, following the
extractor's existing conventions rather than inventing new clamping):**
- `after 1896` → `seasonMin 1897` (the first legal season — parses and
  plans, exactly as an equivalent `since 1897` would).
- `after 2026` → parses, `seasonMin 2027`, within `NL_LIMITS.maxSeason`
  (2100) — preserved architecture: a future year parses; whether it returns
  rows is an execution-time/data question, not a parse-time one.
- `after 9999` → `seasonMin 10000`. Investigated during RED: `parseNlQuestion`
  itself has **no** season-range gate — `extractSeasons` always sets
  whatever number the wording names, exactly as an equally out-of-range
  `since 9999` would. The out-of-range decline is `validatePlan`'s job
  (`plan.ts:2427`, `seasonMin > NL_LIMITS.maxSeason` → `"Season is out of
  range."`), called at compile time, not inside `parseNlQuestion`. The test
  was corrected during RED to call `validatePlan` directly on the parsed
  plan (mirroring the existing `brownlowGame(...)` pattern in
  `nl-regression-corpus.test.ts`) rather than asserting on `parse()`'s
  status — confirmed both that `seasonMin` reaches `10000` unclamped (no
  silent clamping, per the issue's explicit instruction) and that
  `validatePlan` refuses it, identically to how an equally out-of-range
  `since`/`before` value is already refused today.

All three RED-phase corrections above were caught by running the tests
against the real implementation, not assumed — see GREEN results below.

## Negative-control evidence for `after the siren`

`AFTER_RE` requires a literal 4-digit year immediately after the word.
`after the siren`, `after their`, `after that`, `after round 12`, and every
other domain use of `after` found in the source have no digits in that
position, so the regex cannot match them regardless of extractor ordering.
This was verified two ways: (1) source inspection of every `after`
occurrence in `vocab.ts`/`semantic-intents.ts` (documented above), and (2)
the three negative-control tests above, run against the real
`parseNlQuestion` pipeline — all pass, including the composed control that
exercises after-siren scoping and the new season bound in the same question.

## Local GREEN validation (worktree-local `npm ci`)

- `npx vitest run tests/nl-parser.test.ts` — **497/497** (14 new).
- `npx vitest run tests/nl-semantic-mapping.test.ts tests/nl-regression-corpus.test.ts tests/nl-stress-corpus.test.ts` — **390/390**, no regressions.
- `npx vitest run tests/nl-parser.test.ts -t "AFLDB-ISSUE-211"` — **14/14** focused selection.
- `npm run typecheck` (`next typegen` + `tsc --noEmit`) — clean.

## Host validation (streamanator)

Branch state at validation: commit `c113e6a`, `PARSER_VERSION` 59.

**Frozen V5 stable-corpus gate:** `/home/arm/nl-stress-corpus-v5.csv` — 12000
scored / 12000 clean / 0 soft / 0 failed. No regression.

**Exploratory v58 → v59:** both `/home/arm/nl-exploratory-v58-validation/results.jsonl`
and `/home/arm/nl-exploratory-v59-validation/results.jsonl` contain 29030 rows
/ 29030 unique IDs. Aggregate scorer totals moved v58 `12439 clean / 13913
soft / 1178 failed / 1500 audit-required` → v59 `13571 clean / 12651 soft /
1308 failed / 1500 audit-required`. The raw aggregate +130 hard-failure
movement is **not** an ISSUE-211 regression — see the row-level
reconciliation below, which found zero changed row moving `soft_fail →
fail`. The aggregate shift is explained by rows that were already hard
failures for unrelated, pre-existing reasons before v59 and happen to also
contain an `after YEAR` clause; they are untouched by this fix (not part of
the 1406 changed-plan set) and are out of scope for this issue.

**Exact changed-plan family:** a direct structured-plan diff, v58 baseline
vs v59 candidate, found exactly **1406 changed plans**, all containing a
genuine temporal `after <4-digit year>` clause (1406 `after YEAR`, 0
unrelated) — this is the real, row-level affected exploratory family count
for parser v59, superseding both the earlier unverified `~1,200+` estimate
and the raw term-frequency reads named in `AFLDB-ISSUE-206.md`.

### Full 1406-row reconciliation

- **1262 `soft_fail → clean`** — the direct usability improvement. Before
  v59, `after` was an unsupported token and the question declined outright.
  After v59, `scope.seasonMin = 2000` for the `after 1999` family lets the
  already-supported query underneath succeed. No unrelated parser field
  changed as a result of the new temporal operator.
- **136 `soft_fail → soft_fail`** — structurally improved but still
  correctly declined by existing ownership/coverage rules: 95
  `career_boundary`, 23 `head_to_head`, 18 `unsupported_composition`. Before
  v59: `failureReason = unsupported_term`, `unsupportedTerms = ["after"]`.
  After v59: `failureReason = coverage_unavailable`, `unsupportedTerms = []`,
  with the temporal clause now correctly parsed and preserved in the plan
  (`scope.seasonMin = 2000`) but the resulting composition rejected by the
  existing compiler/coverage contract. Representative classes: career
  boundary + club + season bound; head-to-head draw/count compositions;
  first-kick-goal summary + opponent + season composition. Not parser
  regressions — v59 simply allows these rows to progress from lexical
  failure to the correct semantic coverage gate. Compiler coverage was not
  broadened for this issue.
- **8 `audit → audit`** — all `category = malformed_input` (e.g. "Suns
  tackles 200 40 after 1999", "Tigers goals 200 40 after 1999"). Expected
  corpus status remains `audit`. Before v59: `status = decline`,
  `failureReason = unsupported_term`, `unsupportedTerms = ["after"]`. After
  v59: `status = success`, `scope.seasonMin = 2000`, with a typed
  `player_season` plan. These remain intentionally manual-audit cases
  because the source input itself is malformed/ambiguous — exploratory V1
  was not reclassified.
- **0 `soft_fail → fail`** — direct changed-row reconciliation found zero
  rows in the 1406 moving from soft to hard failure.

### After-the-siren regression boundary

118 changed rows contain `after the siren`; every one of them also contains
a separate genuine temporal expression (`after 1999`), e.g. "How many goals
after the siren to win versus Richmond after 1999", "Which player kicked
the most goals after the siren for Suns after 1999", "List behinds after
the siren against Adelaide after 1999". The existing `after the siren`
semantic intent remains intact — `AFTER_RE` only consumes `after
<4-digit year>`, so both meanings compose safely in the same question. No
row containing only `after the siren` (with no year) changed.

### Changed fields

The principal new semantic field is `scope.seasonMin: undefined → 2000` for
the generated exploratory `after 1999` family. Many rows also move from
`plan = null` to a fully typed plan, so a direct field-level diff naturally
reports grain/metric/aggregation/scope fields being populated — expected,
since the previously-unsupported `after` token blocked plan creation
entirely. No evidence of unrelated player identity, club role, metric
ownership, head-to-head intent, or after-siren interpretation being changed
by the new temporal extractor; 0 unrelated rows changed.

## Root cause

Documented product gap, not a silent parser defect: `extractSeasons`
already supported `in YEAR`/`since YEAR`/`before YEAR`/`between YEAR and
YEAR`/decades but had no form for `after YEAR`, as `AFLDB-ISSUE-206.md`
recorded. The fix extends the existing season extractor rather than
introducing a second temporal parser.

## Resolution

**RESOLVED 2026-09-17.** Local implementation, focused tests, and
`typecheck` are GREEN; host validation on streamanator confirmed the frozen
V5 stable corpus unaffected (12000/12000/0/0) and reconciled the full
1406-row exploratory changed-plan family with 0 unrelated rows and 0
`soft_fail → fail` transitions. Follow-on item (5) of
`AFLDB-ISSUE-206.md`'s six proposals is now closed. Known, deliberately
out-of-scope follow-up, not opened as its own issue in this closeout: the
136 `soft_fail → soft_fail` rows are correctly declined under the current
compiler/coverage contract (`career_boundary`, `head_to_head`,
`unsupported_composition`) and would require separate compiler-coverage
work, not a parser change, to progress further.
