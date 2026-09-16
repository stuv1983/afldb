# AFLDB-ISSUE-203 — Numeric word "zero" is not bound as equality in career conditions

**Status:** Implemented, pending operator validation (2026-09-16, Sonnet 5). Operator confirmed the
corpus-shape verification in §6 (all 15 rows are `player_career`/`pc` grain, word "zero" governing
`goals`, no digit-`0` row already present) before implementation proceeded. Third of
AFLDB-ISSUE-200's three candidate defect follow-ons (Stage 2 next-task item 5c, `PARSER_BUG` /
`unsupported_term|pc|zero`, 15 rows). Not yet marked resolved -- pending the operator validation
commands in §12.

## 12. Implementation record (2026-09-16)

Both parts of §4 implemented exactly as proposed, plus §7's regression tests and §9's version bump:

- `src/search/nl/vocab.ts` -- added `zero: 0` to `NUMBER_WORDS` (§4a), unchanged elsewhere.
- `src/search/nl/parser.ts` -- `extractCareerConditions` now tracks `explicitComparator` (true only
  when `NUMBER_PLUS_RE` or a `COMPARE_OP_WORDS` phrase matched) and forces `op = 'eq'` when
  `value === 0 && !explicitComparator`, placed after `if (value === null) continue;` (§4b). The
  `qualifierBuilder`/`grand_finals`/`prelim_finals` branch itself was not touched, but the override
  runs before that branch's `op === 'gte'` check, so a (currently corpus-unobserved) "0 grand
  finals"-shaped clause would now also read as a plain `{ column: 'finals', op: 'eq', value: 0 }`
  condition instead of a `grand_finals_played_min` predicate -- flagged here since §10 only
  discussed this as a risk to watch for, not as a change to make; no corpus row exercises it.
- `src/search/nl/plan.ts` -- `PARSER_VERSION` 52 -> 53, with a v53 history comment (§9).
- `tests/nl-parser.test.ts` -- 8 new cases added to the existing `describe('4. career filters', ...)`
  block (§7's numbered list): the bug's exact shape, a bare single-condition control, the digit-`0`
  control, a positive-number-word control, all three explicit-comparator-wins cases in one test,
  the existing negative-trigger forms re-run, a truthiness-check regression, and an unrelated
  unsupported-word control. No new test file; no existing test removed or weakened.

Not run in this session (CLAUDE.md's command-execution boundary): `npx vitest run
tests/nl-parser.test.ts`, `npx tsc --noEmit`, and the stress/corpus comparison in §12 below --
operator commands are listed there.

## 1. Confirmed root cause (direct source inspection)

### Evidence
AFLDB-ISSUE-200's real-audit cluster `unsupported_term|pc|zero` (`issues.md:33306`,
`tools/nl/issue-200-dispositions.csv`):

> `player_career` games/list questions with a numeric zero-goal condition (e.g. "players with 4
> games and zero goals") decline with `unsupported_term`="zero" — the word-form "zero" is not bound
> to the numeric literal 0 for an equality condition and survives into unsupported-term detection.

### The chain

**Fact 1 — the number-word vocabulary has no "zero" entry.**
`NUMBER_WORDS` is defined once, at `src/search/query-intent.ts:185-192` (`once`/`twice`/`thrice`,
`one`..`ten`, `multiple`, `several`) and re-exported as a superset by
`src/search/nl/vocab.ts:21-25` (`...PLAYER_QUESTION_NUMBER_WORDS, dozen: 12, hundred: 100`), which
is the copy `src/search/nl/parser.ts` imports (`parser.ts:83`). Neither list contains `zero`. Every
number-word fallback loop in the parser (`parser.ts:932`, `:1201`, `:1522`, `:1670`, `:1763`, plus
`vocab.ts:31`'s `readCount` and the `RESULT_COUNT_GOVERNS` regex in `semantic-intents.ts:20`) reads
from this one shared map, so "zero" is unrecognised everywhere a number word is read, not just in
one call site.

**Fact 2 — `extractCareerConditions`'s numeric loop silently abandons the clause, without
stripping it, when no number is found.**
`parser.ts:1102-1227` walks `CAREER_STAT_WORDS` (`goals` at `parser.ts:969`), picking whichever
pending stat word occurs earliest in the remaining text (`parser.ts:1104-1114`), then searches a
clause-bounded window for a value: `NUMBER_PLUS_RE` ("200+"), then `COMPARE_OP_WORDS` + a bare digit,
then — only if no digit was found — the `NUMBER_WORDS` fallback (`parser.ts:1196-1205`). For
"zero goals", none of these match ("zero" is not a digit and not a `NUMBER_WORDS` key), so `value`
stays `null`. `pending.delete(best.entry)` (`parser.ts:1113`) has already removed `goals` from the
pending set *before* this check, and `if (value === null) continue;` (`parser.ts:1207`) skips the
`consumed.push`/`working` strip that normally happens at `parser.ts:1219-1226`. The stat word is
tried exactly once and never stripped on failure — "goals" is left in `working` for a later, more
general stat-word pass to pick up (this is why the reported unsupported term is `zero` alone, not
`zero goals`), while "zero" itself matches no vocabulary anywhere in the parser and survives as a
genuine leftover token.

**Fact 3 — leftover tokens become `unsupportedTerms` unconditionally.**
`leftoverTokens` (`parser.ts:3837-3839`) is every token not in `consumedSet`, not part of a failed
player mention, and not the candidate player's first word. `report.unsupportedTerms` is populated
from it at `parser.ts:3853` with no awareness of *why* a token is unclaimed — identical mechanism to
AFLDB-ISSUE-202's `gws` defect, different upstream cause (missing vocabulary entry, not a missing
multi-word alias). This depresses `ratio` (`parser.ts:3827`) and `confidence` below
`NL_CONFIDENCE.clarify`, and `declineFailureReason` (`src/db/queries/nl/answer.ts:57-62`) classifies
the decline as `unsupported_term` because `report.unsupportedTerms.length > 0`.

### A second, currently-latent defect the same code path controls

`extractCareerConditions`'s comparator selection defaults to `op: 'gte'`
(`parser.ts:1170`/`:1645`-style pattern) whenever no `COMPARE_OP_WORDS` phrase ("exactly", "at
least", "more than", …) is present, which is the correct default for every *positive* count ("300
games" bare means "at least 300"). It is not scoped for zero: "zero goals" and bare-digit "0 goals"
both reach this same default with no comparator phrase in the text, so both would bind as
`{ column: 'goals', op: 'gte', value: 0 }` — "at least 0 goals", which is true for every player and
answers a different question than the corpus's expected `goals = 0`
(`issues.md:33306`; the issue framing's own restated semantics: "e.g. career games threshold/
condition plus `goals = 0`"). This is not a falsy-value bug — `validateCondition`
(`plan.ts:1563-1575`) checks `Number.isFinite(cond.value)`, not truthiness, and
`src/db/queries/nl/player-career.ts:100-110` interpolates `cond.value` into SQL directly with no
truthy guard — so `value: 0` is never dropped once it exists. The defect is that nothing forces
`op` to `'eq'` when the bound value is exactly zero and no comparator was stated. Today this is
**unobserved** in the corpus (bare digit "0" is confirmed absent from all 15 rows — see §6 — and the
existing `eq: 0` test coverage in `tests/nl-parser.test.ts:260-618`/`:1148-1151` all goes through the
*separate* `no <stat>` / `never <stat>` / `without <stat>` negative-trigger machinery at
`parser.ts:1043-1085`, which is unaffected by this issue and pushes `eq: 0` directly, bypassing the
generic numeric loop entirely). Once "zero" is added to `NUMBER_WORDS`, this generic-loop default
becomes reachable for the first time for a *bound* zero, and would turn the 15
`unsupported_term` declines into 15 silent wrong answers instead of 15 correct ones, unless the
default is also fixed. Both changes are the same handful of lines in the same function — this is not
scope expansion, it is the minimum needed for "zero" to bind correctly rather than merely stop
declining.

## 2. Classification

**Not** zero-specific vocabulary alone, and **not** a truthiness/falsy-value bug (deliverable
question 3). It is two cooperating gaps in the same function, both required for correct behaviour:

1. A missing vocabulary entry (`NUMBER_WORDS` has no `zero` key) — this alone explains the 15
   `unsupported_term` declines.
2. A comparator-default gap (bare zero, with no explicit comparator, defaults to `gte` instead of
   `eq`) — this is what the corpus's expected semantics (`goals = 0`, an equality) requires, and
   what stops the fix from turning declines into wrong answers. It is not yet visible as a distinct
   failure class only because no corpus row currently reaches it (bare "zero"/"0" always declined
   before now).

This maps to option **5** in the issue framing ("some combination of the above" — specifically
options 1 and 2, not 3 or 4): add `zero` to the number-word map, and correct the comparator default
for a zero-valued, comparator-less clause. No change to the `no`/`never`/`without` negative-trigger
machinery, which already produces correct `eq: 0` and is untouched by this defect.

## 3. Required semantics

1. "players with 200 games and zero goals" → `player_career`, `{ column: 'games', op: 'gte', value:
   200 }` and `{ column: 'goals', op: 'eq', value: 0 }`; no unsupported term.
2. "players with 200 games and 0 goals" (digit form) → the same result. This is not currently
   provably correct (§1's second defect) and must be fixed alongside the word form since both flow
   through the identical default-op branch.
3. "players with 200 games and exactly zero goals" (or "at least zero goals", if such phrasing
   exists in the corpus) → the explicit comparator wins, as it already does for every non-zero
   value; the zero-specific default only applies when no comparator phrase is present.
4. Existing `no <stat>` / `never <stat>` / `without <verb>-ing <stat>` zero conditions
   (`parser.ts:1043-1085`) are untouched — they already produce `eq: 0` via a different mechanism and
   are not part of this defect.
5. Every other `NUMBER_WORDS` entry (`one` .. `ten`, `dozen`, `hundred`, `multiple`, `several`) keeps
   its current value and default-op behaviour (`gte` when bare, or whatever comparator is present).
6. Genuinely unsupported words unrelated to numbers still decline as `unsupported_term`.

## 4. Proposed implementation (not yet made)

### 4a. Vocabulary
Add `zero: 0` to `src/search/nl/vocab.ts`'s `NUMBER_WORDS` (lines 21-25), alongside `dozen`/
`hundred`, **not** to `src/search/query-intent.ts`'s `NUMBER_WORDS` (lines 185-192). Rationale:
`vocab.ts`'s own docstring already frames it as "Superset of query-intent.ts's NUMBER_WORDS" for
words this parser needs that the Grid Solver's `parsePlayerQuestion` never did (`dozen`/`hundred`
is existing precedent for exactly this kind of scoped addition). ISSUE-200's evidence is
specifically an NL-search `player_career` (`pc`) cluster, not a Grid Solver defect; adding `zero`
only to the NL-parser superset keeps `query-intent.ts`'s own `readCount`/`parsePlayerQuestion`
(Grid Solver) semantics completely unchanged, per the issue's own scope exclusion ("generic numeric
semantics beyond what the confirmed root cause requires").

This single addition is automatically picked up by every consumer of `vocab.ts`'s `NUMBER_WORDS`
(all six `parser.ts` call sites, `vocab.ts`'s `readCount`, and `semantic-intents.ts`'s
`RESULT_COUNT_GOVERNS`), since they all read the same shared map — this is expected and desired
(e.g. "zero wins against Richmond" should be recognised as a governed count in
`RESULT_COUNT_GOVERNS` the same way "two wins against Richmond" already is), not a separate change
to make per call site.

### 4b. Comparator default for a bound zero
In `extractCareerConditions` (`parser.ts:1102-1227`), track whether an explicit comparator phrase
was matched (currently the code only tracks the resulting `op` value, which cannot distinguish an
explicit "at least"/"no fewer than" `gte` from the implicit bare-number default `gte`). After `value`
is resolved and before `if (value === null) continue;`, force `op = 'eq'` when `value === 0` and no
explicit comparator phrase matched (i.e., neither `NUMBER_PLUS_RE` nor `COMPARE_OP_WORDS` produced
the current `op`). Do not touch the `qualifierBuilder`/`grand_finals`/`prelim_finals` branch
(`parser.ts:1213-1218`) — no corpus row combines a qualified final count with zero, and forcing `eq`
there would need separate verification against `GRID_BUILDERS`' own semantics, which is out of
scope.

**No change is proposed to:**
- the `no <stat>` / `never <stat>` / `without <stat>` negative-trigger loop (`parser.ts:1043-1085`)
  — it already produces `eq: 0` correctly and does not go through `NUMBER_WORDS` at all;
- `validateCondition`, `NlCareerCondition`, or any SQL compilation in
  `src/db/queries/nl/player-career.ts` — both already handle `value: 0` correctly (§1);
- `consumedSet` / `leftoverTokens` / `report.unsupportedTerms` construction — these correctly report
  an unclaimed token today; the fix removes "zero" from being unclaimed, not the reporting logic;
- `query-intent.ts`'s own `NUMBER_WORDS`/`readCount` (Grid Solver) — deliberately left untouched
  (§4a);
- the other four number-word fallback loops in `parser.ts` (`:932` rivalry/marquee match counts,
  `:1522` head-to-head win/loss/games extraction, `:1670`/`:1763` season/coach metric extraction) —
  they gain "zero" as a recognised word for free via the shared map, but none of them get the
  zero-forces-`eq` default-op correction, since none of the 15 corpus rows exercise those paths and
  the issue framing excludes generic numeric-semantics changes beyond the confirmed
  `player_career` root cause.

This mirrors ISSUE-202's chosen approach (a small, precedented dictionary/logic addition at the
exact site the audit named, not a broader redesign of comparator defaulting or number-word handling
generally).

## 5. Files expected to change

| File | Change |
|---|---|
| `src/search/nl/vocab.ts` | Add `zero: 0` to `NUMBER_WORDS` (§4a). |
| `src/search/nl/parser.ts` | In `extractCareerConditions`, force `op = 'eq'` for a comparator-less, zero-valued clause (§4b). |
| `tests/nl-parser.test.ts` | Regression cases (§7) extending the existing career-condition describe blocks. |
| `src/search/nl/plan.ts` | One-line `PARSER_VERSION` history comment, if bumped (§9). |
| `CHANGELOG.md` | `[Unreleased]` entry once implemented and validated. |
| `issues.md` / `IssuesIndex.md` | Resolution record once operator-validated. |

No migration, schema, query (beyond the existing `player-career.ts` compiler already handling
`value: 0`), or route file is expected to change.

## 6. Corpus family verification (to run before implementation)

This session has no shell/DB access to the dev-host corpus files. Per the issue framing, do not
assume all 15 rows are identical shape. Operator command against the retained failures file:

```bash
grep -i 'zero' /home/arm/nl-stress-v52-v3/failures.csv > /tmp/issue-203-zero-rows.csv
wc -l /tmp/issue-203-zero-rows.csv
cut -d',' -f1-6 /tmp/issue-203-zero-rows.csv   # adjust field indices to the real CSV header
grep -io 'zero [a-z_]*' /tmp/issue-203-zero-rows.csv | sort | uniq -c
grep -io '[0-9]\+ games\|[0-9]\+ finals\|[0-9]\+ clubs' /tmp/issue-203-zero-rows.csv | sort | uniq -c
grep -c 'player_career' /tmp/issue-203-zero-rows.csv
grep -io '\b0\b [a-z]*' /tmp/issue-203-zero-rows.csv | sort | uniq -c   # confirm no row uses digit "0" already
```

(Adjust `awk`/`grep`/`cut` fields to the real CSV header before running, as ISSUE-202's equivalent
step also had to.) Expected finding, per `tools/nl/issue-200-dispositions.csv`'s own rationale ("all
15 rows share this shape"): every row is `player_career` grain, names the literal word "zero"
governing `goals` (the representative wording given is "N games and zero goals"), pairs it with a
games (or similar career) threshold, and none use the digit `0` form. If the operator's run finds a
different metric than `goals`, a digit-`0` row, a non-`player_career` grain, or an explicit
comparator phrase ("exactly zero", "at least zero") already present, stop and report the
contradiction before implementing — a different metric would still be covered by the same fix (any
`CAREER_STAT_WORDS` column), but a digit-`0` row already present and *already scored as clean* would
contradict §1's "currently latent" claim and needs re-diagnosis; an explicit-comparator row would
mean §4b's implicit-default scope is too narrow.

## 7. Regression test plan

Extend the existing `player_career`/career-condition describe blocks in `tests/nl-parser.test.ts`
(the ones already exercising `eq: 0` via negative triggers, e.g. around `:260-618` and `:1148-1151`)
rather than a new file:

1. **The bug's exact shape.** `plan('players with 200 games and zero goals')` →
   `careerConditions` contains both `{ column: 'games', op: 'gte', value: 200 }` and
   `{ column: 'goals', op: 'eq', value: 0 }`; `report.unsupportedTerms` does not contain `'zero'`.
2. **Single-condition form**, if the corpus confirms it as a supported shape per §6:
   `plan('players with zero goals')` → same `goals eq 0` condition, whatever grain/ranking default
   an unscoped career condition already resolves to today (verify against current behaviour for an
   analogous non-zero bare condition, e.g. "players with 2 clubs", rather than assuming).
3. **Digit zero**: `plan('players with 200 games and 0 goals')` → identical result to case 1
   (`op: 'eq'`, not `'gte'`) — this is the currently-unproven case from §1's second defect.
4. **Existing number words unaffected**: `plan('players with 200 games and 2 clubs')`-style cases
   already in the suite continue to bind `op: 'gte'` (or whatever the existing default is) unchanged
   — zero is the only value whose default op changes.
5. **Explicit comparator on zero wins**, if §6 confirms such phrasing exists or is otherwise worth
   covering: `plan('players with at least zero games in finals')`-style case keeps `op: 'gte'`
   (or `'eq'` for "exactly zero") rather than being forced — proves §4b only overrides the *implicit*
   default, not an explicit comparator.
6. **Existing negative variants unchanged**: re-run (not duplicate) the existing `'no flags'` /
   `'most games without kicking a goal'` / `'never a premiership'` cases
   (`tests/nl-parser.test.ts:612-618`, `:1148-1151`) to confirm the negative-trigger path is
   untouched by both §4a and §4b.
7. **Zero not silently dropped**: assert `careerConditions` contains an object with `value: 0`
   (not merely truthy-checked) for both the word and digit forms — directly exercises deliverable
   question 6.
8. **Unrelated unsupported words remain unsupported**: a query pairing a genuine nonsense word with
   a zero condition, e.g. `'players with zero goals and flibbertigibbet'`, still declines with
   `unsupportedTerms` containing the nonsense word and not `'zero'`.

## 8. Stable-corpus validation plan

1. Re-run the parser-v(N) stress harness against the retained V3 corpus
   (`/home/arm/nl-stress-corpus-v3.csv`) after implementation.
2. Confirm the `unsupported_term|pc|zero` auto-cluster count moves 15 → 0.
3. Confirm the other soft families are unchanged: `STALE_CORPUS_EXPECTATION` 180 (pre-1965),
   `WRONG_FAILURE_REASON`/`TAXONOMY_DRIFT` 70.
4. Confirm zero new hard failures and zero new soft findings via the same before/after semantic-diff
   technique used for ISSUE-199/ISSUE-201/ISSUE-202 (`tools/nl/audit-issue-200-cluster.ts` or
   equivalent).
5. Target final benchmark: **12,000 scored / 11,750 clean / 250 soft / 0 failed**
   (`UNEXPECTED_DECLINE` 180, `WRONG_FAILURE_REASON` 70), matching the issue framing's own forecast,
   pending §6's shape confirmation.

## 9. Parser-version recommendation

**Recommend bumping `PARSER_VERSION` 52 → 53.** Repository precedent (ISSUE-197: 48→49, ISSUE-198:
49→50, ISSUE-201: 50→51, ISSUE-202: 51→52) bumps whenever a fix changes which plan/condition set a
previously-declining or previously-misbound question resolves to. This fix changes both (15
questions stop declining, and any bare-zero condition — word or digit — now binds `eq` instead of
the previously-unreachable-but-wrong `gte`), so it fits the bump pattern, not the
no-new-parser-semantics exception (`CHANGELOG.md` line 225, AFLDB-ISSUE-194). Do not perform the
bump in this planning session.

## 10. Risks / collateral cases

- **Comparator-default scope risk, mitigated:** §4b's `op = 'eq'` override is gated on `value === 0`
  and "no explicit comparator matched" — it cannot change behaviour for any non-zero value or any
  clause where the user stated a comparator explicitly.
- **Shared-vocabulary collateral, expected and low-risk:** adding `zero` to `vocab.ts`'s
  `NUMBER_WORDS` also makes it recognised in the four other number-word loops (§4a) and in
  `RESULT_COUNT_GOVERNS`. None of these get the `eq`-default correction (§4b is scoped to
  `extractCareerConditions` only), so e.g. "zero showdowns" would newly parse `times: 0` at
  `parser.ts:932` with whatever existing default that builder already has for `times`. This is a
  vocabulary-completeness side effect (the same word now means the same number everywhere), not a
  new semantic path, and matches how `dozen`/`hundred` already behave globally. Flagged, not fixed,
  per the issue's exclusion of "generic numeric semantics beyond what the confirmed root cause
  requires" — if the operator's corpus run surfaces a real "zero <event>" regression outside
  `player_career`, it should be a separate issue.
- **False-confidence risk:** the "all 15 rows share this shape" claim is sourced from ISSUE-200's
  audit rationale, not independently re-verified against the raw corpus in this session — §6 is a
  prerequisite, not a formality.
- **Digit-zero risk is real, not hypothetical:** §1's second defect means that without §4b, shipping
  §4a alone would convert 15 declines into 15 silently wrong answers (`goals >= 0` matching every
  player), which the stable-corpus benchmark would very likely surface as a new wrong-answer/soft
  class rather than the expected clean-count increase — this is why both changes must land together.
- **No interaction expected** with AFLDB-ISSUE-201 (career-boundary season ranges) or AFLDB-ISSUE-202
  (GWS club alias) — neither touches `NUMBER_WORDS`, `extractCareerConditions`'s comparator
  selection, or `player_career` column conditions.

## 11. Implementation-model recommendation

This is a narrow, fully-traced, two-part fix confined to one shared dictionary and one function's
default-comparator logic, with a precedented pattern for both parts (`dozen`/`hundred` for the
vocabulary addition; `COMPARE_OP_WORDS`'s existing "exactly" → `eq` entry for the comparator
concept). It does not require novel architectural judgement or cross-subsystem reasoning — the
genuine judgement call already made in this planning session is recognising that the vocabulary gap
alone is insufficient and would trade a decline for a silent wrong answer (§1's second defect),
which is exactly the kind of correctness-over-conservatism finding this issue asked for. Sonnet 5 is
well-suited to implement this directly from this runbook; escalating to a different model would not
materially improve the outcome. The one remaining dependency is operator-run corpus evidence (§6),
not model capability.
