# AFLDB-ISSUE-196 — Approved Runbook

## Status / objective
- **Status:** Planned 2026-09-16 (Sonnet 5 High, plan mode, worktree
  `sonnet/issue-196-plan`, from main `8f5b68a`). Not implemented.
- **Objective:** `extractCareerConditions` must bind each numeric career-condition phrase to its own
  governing `CAREER_STAT_WORDS` noun, never a neighbouring clause's number, across "and"/comma
  (already correct) and the prepositions "at"/"for"/"across"/"over"/"with" (currently broken).
  "players with 300 games at 2 clubs" must plan `games >= 300` AND `clubs_played >= 2`, never
  `clubs_played >= 300` with an orphaned `2`.
- **Recommended implementer:** Sonnet 5, High effort, normal mode, fresh session, from a new
  worktree/branch off main once this plan's branch reaches main (or continued directly in this
  worktree if the operator chooses to implement here).
- **Do not combine with AFLDB-ISSUE-194 or AFLDB-ISSUE-195.** Distinct mechanisms, distinct files
  in the same subsystem; keep the diffs separable.

---

## 1. Confirmed root cause (verified against current code, main `8f5b68a`, `PARSER_VERSION` 46)

`extractCareerConditions` (`src/search/nl/parser.ts:1016-1195`) iterates the fixed constant array
`CAREER_STAT_WORDS` (`parser.ts:953-978`, order: `premierships, finals, clubs_played, goals, games,
wins, losses, draws, brownlow_medals, brownlow_votes`) in **array order**, not the order the nouns
appear in the question.

For each entry it finds the noun's position (`idx`), builds a backward-only lookback `window`
ending at the noun (`parser.ts:1110-1132`), and searches that window (leftmost match wins,
`.exec()` with no `/g` flag) for a `N+` form, then a comparator word (`COMPARE_OP_WORDS`), then a
bare digit, then a number word (`parser.ts:1134-1171`). The window is clipped at the **nearest
preceding** `" and "` or `,` (added for AFLDB-ISSUE-118-era corpus work — see the comment at
`parser.ts:1110-1126`) — but at nothing else.

For `"players with 300 games at 2 clubs"`:
1. `clubs_played` (array position 3) is tried before `games` (array position 5).
2. `clubs_played`'s window has no `" and "`/`,` to clip at, so it spans the **entire** preceding
   text: `"players with 300 games at 2 clubs"`.
3. The bare-digit search (`/\b(\d{1,4})\b/.exec(window)`) returns the **leftmost** match in that
   window: `"300"`, not the `"2"` that is actually adjacent to `"clubs"`.
4. `clubs_played` is bound `gte 300`; the spans for `"300"` and `"clubs"` are stripped from
   `working` (`parser.ts:1184-1191`).
5. `games` is then tried: its own window (text before `"games"`) no longer contains any digit
   (`"300"` is gone), so `value` stays `null` and the loop `continue`s at `parser.ts:1172` —
   **the `games` entry's stat word itself is never stripped**, because the strip only happens after
   a value is found.
6. The leftover bare `"games"` word is later read as a bare ranking metric by the reuse loop at
   `parser.ts:2604-2613` (`grain: player_career, metric: games, aggregation: list`).
7. The orphaned literal `"2"` is a pure-digit token, excluded from `meaningfulTokens`
   (`parser.ts:128-130`, `/^\d+\+?$/` filter), so it cannot lower `tokenRatio` or appear in
   `unsupportedTerms` (`parser.ts:3679-3705`). Confidence stays high; `validatePlan` sees a
   structurally valid `player_career` plan (metric non-null) and accepts it.

This matches the Stage 2 audit's finding exactly. Confirmed independently by re-tracing the code at
`8f5b68a`, not merely re-quoted from the audit.

**Neighbouring risk, independently verified:** the same "leftmost digit in an unclipped
window" defect reproduces for `"for"`, `"across"`, `"over"` in place of `"at"` (traced by hand
against the current code below), and additionally — a distinct failure mode not in the audit note —
for a comparator word attached to the wrong clause: `"players with more than 300 games at 2 clubs"`
binds `clubs_played` to `op: 'gt', value: 300` under current code, because the comparator search
(`COMPARE_OP_WORDS`) and the digit search both scan the same unclipped window independently, with
no requirement that the matched comparator sit next to the matched digit.

---

## 2. Semantic decision and rationale

**Decision: Option C — process `CAREER_STAT_WORDS` occurrences in sentence (textual) order, not
array order.** No new grain, no new boundary-word list, no `STOPWORDS` change.

### Why this is sufficient by itself

Once each career-stat noun is resolved in the order it actually occurs in the sentence, and its
consumed span (noun + operator + number) is stripped from `working` **before the next noun is
looked up**, a later noun's backward-only window can never reach a number that belonged to an
earlier noun — that text is no longer in `working` at all, not merely clipped. This is stronger than
window-clipping: it removes the shared window entirely rather than trying to find every preposition
that must additionally act as a boundary.

Traced by hand against the full required matrix (§5) and every existing regression case that
exercises this loop (`tests/nl-parser.test.ts` "regression: two career conditions in one sentence do
not cross-contaminate", `tests/nl-parser.test.ts:446-458`, `tests/nl-semantic-mapping.test.ts:165-189`):
every case resolves correctly under sentence-order processing, including cases where sentence order
differs from array order (e.g. `"players with over 2 games and over 5 premierships"` — `games` is
array position 5, processed after `premierships` today; under sentence order `games` is processed
first because it occurs first in the text — the result is identical either way because the existing
`" and "` clip still isolates the second clause regardless of which noun is second).

This also directly fixes the comparator-misattribution failure mode found in §1: because the whole
first clause (noun + its own comparator + its own number) is removed before the second clause's
window is ever built, the second clause's window cannot contain the first clause's comparator word
either.

### Rejected alternatives

**Option A — nearest-number ownership (pick the rightmost/nearest digit match in the window instead
of the leftmost).** Rejected as insufficient on its own. It only fixes the digit-selection half of
the bug. The comparator search (`COMPARE_OP_WORDS`, `parser.ts:1157-1160`) is a **separate**,
independent `.exec()` over the same unclipped window; picking the nearest digit does not stop it
from picking up a comparator word that belongs to a different clause. Traced example:
`"players with more than 300 games at 2 clubs"` — nearest-digit-only would correctly bind `clubs`
to `2`, but the comparator scan still finds `"more than"` anywhere in the same unclipped window and
would still misattach `op: 'gt'` to `clubs_played` instead of `games`. Making Option A fully correct
would require *also* scoping the comparator search to sit immediately before the chosen number —
at which point it is doing strictly more work than Option C for no additional benefit, since Option
C gets both right for free by removing the earlier clause's text outright. Also has to keep the
existing `and`/comma window-clipping alongside it (removing that clipping to rely on "nearest" alone
would reopen the truncated-digit-slice defect the clipping was added for, per the comment at
`parser.ts:1110-1126`), so it is not actually simpler in the end.

**Option B — stronger clause/window boundaries (treat `at`/`for`/`with`/`across`/`over` as
additional window-clip boundaries alongside `and`/comma).** Rejected as more invasive and
individually riskier than Option C, though it was verified to also solve the required matrix with
enough per-word care:
- `over` **cannot** be a boundary word: `COMPARE_OP_WORDS` already treats
  `/\bover(?=\s+\d)/` as a comparator (`vocab.ts:743`), and that is exactly the reading needed for
  `"players with over 300 games at 2 clubs"` (§5 case 7). Clipping the window at `"over"` would
  strip the comparator's own trigger word out of the window it needs to be found in, breaking the
  existing `"over N"` reading for the very clause that contains it.
- Bare `" at "` **collides with `"at least"`/`"at most"`** (`COMPARE_OP_WORDS`,
  `vocab.ts:732-733`). `"players with at least 300 games"` contains the literal substring
  `" at "` as the head of `"at least"`; a naive unconditional `" at "` boundary would clip the
  window to start after `"at "`, leaving only `"least 300 games"` for the comparator scan — `"at
  least"` no longer matches as a phrase, and the clause silently falls back to the default `gte`
  (this happens to produce the same *value* for `"at least"`, since `gte` is also the default, but
  would silently break `"at most"` — `NlCompareOp` `'lte'` — since there is no other regex that
  recognises the word `"most"` alone). This needs a negative lookahead
  (`/ at (?!least\b|most\b)/`) to be safe — a second special case beyond the `over` one above.
- Adding `"across"` as a boundary word also requires adding `"across"` to `STOPWORDS`
  (`vocab.ts:857-895`) — it is not currently a stopword, unlike `at`/`for`/`with`/`over`, which all
  already are (`vocab.ts:859,872,880`) precisely so a leftover instance costs nothing in
  `meaningfulTokens`/confidence. Skipping this would leave `"across"` in `working` as an unconsumed,
  non-stopword token in case 6 (§5), lowering `tokenRatio` and adding a spurious entry to
  `unsupportedTerms` — a self-inflicted regression the audit did not flag but this planning pass
  found while tracing Option B by hand.
- The issue text itself explicitly flags `with` as "too semantically overloaded to use naively": it
  is also the clause-**introducing** word for the whole career-condition sentence (`"players
  with…"`), so a bare `" with "` boundary risks clipping in front of the sentence's own opening
  word in some phrasings. No required test case forces resolving a `with`-linked pair of clauses
  (`"300 games with 2 clubs"` is not idiomatic AFLDB phrasing and is not in the required matrix), so
  there is no forcing evidence to justify the risk. **Not implemented; noted as a residual
  non-goal below.**

Given three of five prepositions in Option B's own candidate list need a special-case guard or an
unrelated `STOPWORDS` edit to avoid a regression, and Option C needs none of that, Option C is the
smaller, safer change.

**Option D — fail closed on ambiguous ownership.** Rejected as unnecessary on top of Option C, not
rejected outright. Sentence-order processing removes the structural cause of ambiguity for every
case in the required matrix (§5) and every existing regression test (§6): a noun's window can only
ever contain text that has not already been claimed by an earlier (in text order) noun, so there is
no remaining two-clause shape in this matrix where "ownership cannot be established reliably." Do
not add a generic decline-on-ambiguity mechanism now — there is nothing left for it to catch inside
this fix's scope, and CLAUDE.md's guidance against building for hypothetical cases applies. If a
future stress-corpus run surfaces a genuine three-or-more-clause (or otherwise pathological) career
condition that still mis-binds under sentence order, track it as a new issue with its own
reproduction, rather than speculatively guarding against it here.

### Confidence / orphan-number architecture

**Decision: fix numeric ownership only; do not touch the confidence/`meaningfulTokens` architecture.**
The pure-digit exclusion in `meaningfulTokens` (`parser.ts:129`, `/^\d+\+?$/`) is a deliberate,
long-standing, parser-wide design choice (every numeric condition elsewhere in the file relies on
"a consumed digit costs nothing, an unconsumed digit costs nothing either" — see e.g. the
`"players with at least 2 clubs"` comment at `parser.ts:3663-3678`, which depends on exactly this
property to keep confidence at 1 for an all-stopword-and-digit sentence). Adding a narrow "numeric
token claimed by no producer" guard scoped to `extractCareerConditions` was considered per the
issue's own framing, but Option C removes the only mechanism (§1) by which this family can currently
orphan a digit; there is no longer a reproducible scenario in this family for the guard to catch.
Building it anyway would be validation for a scenario Option C has already made unreachable —
exactly what CLAUDE.md's minimal-change guidance excludes. If a future issue finds a *different*
mechanism in this family that orphans a digit, scope a guard to that mechanism then.

---

## 3. Exact files/functions to change

1. **`src/search/nl/parser.ts`, function `extractCareerConditions` (lines 1016-1195), the main loop
   at lines 1076-1192 only.**
   Replace the `for (const [re, column] of CAREER_STAT_WORDS)` fixed-order loop with a
   "repeatedly pick the pending entry whose match occurs earliest in the current `working`" loop.
   Everything **inside** the loop body (finals qualifier probe, window construction and its
   `and`/comma clipping, `NUMBER_PLUS_RE`/`COMPARE_OP_WORDS`/digit/number-word search, span
   construction, condition/predicate push, span stripping) is **unchanged** — only the
   entry-selection strategy changes.
   `CAREER_STAT_WORDS` itself (`parser.ts:953-978`) is **not** reordered and **not** otherwise
   edited — the other consumer at `parser.ts:2604-2613` (bare ranking-metric fallback) and
   `CAREER_ONLY_METRICS` (`parser.ts:998-1000`) both iterate the constant directly and must keep
   seeing it in its current array order; they are unaffected by this change because the change is
   local to `extractCareerConditions`'s own loop, not to the shared array.

2. **`src/search/nl/plan.ts`, `PARSER_VERSION` (currently `46`, line 469) and its preceding version
   history comment block (lines ~420-468).** Bump to `47` and append a `v47` comment in the same
   style as `v42`-`v46`, naming AFLDB-ISSUE-196, `extractCareerConditions`, and summarising the
   sentence-order change and its effect (see §7).

No other file requires a change. `vocab.ts` is untouched (Option C needs no new boundary words and
no `STOPWORDS` edit).

### Implementation sketch (for the implementing session — not applied by this plan)

```ts
// was: for (const [re, column] of CAREER_STAT_WORDS) { const match = re.exec(working); if (!match) continue; ... }
const pending = new Set(CAREER_STAT_WORDS); // reference equality on the shared tuples is fine here
while (pending.size > 0) {
  let best: { entry: [RegExp, NlCareerColumn]; match: RegExpExecArray; idx: number } | null = null;
  for (const entry of pending) {
    const [re] = entry;
    const match = re.exec(working);
    if (!match) continue;
    const idx = working.indexOf(match[0]);
    if (!best || idx < best.idx) best = { entry, match, idx };
  }
  if (!best) break;
  pending.delete(best.entry);
  const [, column] = best.entry;
  const { match, idx } = best;
  // ... existing loop body, verbatim, using `match`/`idx`/`column` as before ...
  // the existing `if (value === null) continue;` now simply moves to the next
  // while-iteration; the entry has already been removed from `pending`, so it
  // is never retried and there is no infinite-loop risk.
}
```

The implementer should confirm the exact variable capture (the existing body reads `match` and
`idx` as closures inside the `for` loop today; moving them to `best.match`/`best.idx` is a
mechanical rename, not a behavioural change) and should not otherwise touch the body.

---

## 4. Ordering interaction check (verified, not assumed)

Club/season/aggregation/streak/having-clause/match-filter/result-filter extraction all run **before**
`extractCareerConditions` in `parseNlQuestion` (`parser.ts:2472-2474`; club extraction specifically
at `parser.ts:1881`, well before). By the time `extractCareerConditions` sees `text`, a real club
name (e.g. `"for Collingwood"`) has already been fully stripped — confirmed against
`tests/nl-semantic-mapping.test.ts:169-179` (`"players with ${words} 200 games for
Collingwood"`), which is unaffected by this change either way, since `"for Collingwood"` never
reaches `extractCareerConditions` as a preposition-plus-number phrase at all. The prepositions this
fix cares about (`at`/`for`/`across`/`over` linking two bare numeric clauses) only ever appear intact
at this stage when neither side has already been claimed as a club/season/aggregation phrase — which
is exactly the shape of the required matrix (§5).

---

## 5. Required query matrix — intended parse, before/after

| # | Query | Plan/decline | Expected conditions | Current (`8f5b68a`) behaviour | After fix |
|---|---|---|---|---|---|
| 1 | `players with 300 games at 2 clubs` | plan | `games gte 300`, `clubs_played gte 2` | `clubs_played gte 300`; `games`/`2` orphaned, metric leaks to bare `games` ranking | fixed: both conditions, `metric: null` |
| 2 | `players with 300 games for 2 clubs` | plan | `games gte 300`, `clubs_played gte 2` | same defect as #1 (`for` is not a boundary today) | fixed: both conditions |
| 3 | `players with 300 games and 2 clubs` | plan | `games gte 300`, `clubs_played gte 2` | **already correct** — existing `" and "` window clip isolates the clauses | unchanged (still correct) |
| 4 | `players with 2 clubs and 300 games` | plan | `clubs_played gte 2`, `games gte 300` | **already correct** — `clubs_played` (array-earlier and sentence-earlier here) claims its own preceding `2` before `games` is tried | unchanged (still correct) |
| 5 | `players with more than 300 games at 2 clubs` | plan | `games gt 300`, `clubs_played gte 2` | `clubs_played gt 300` (steals both the number *and* the comparator); `games` orphaned | fixed: `games gt 300`, `clubs_played gte 2` |
| 6 | `players with 300 games across 2 clubs` | plan | `games gte 300`, `clubs_played gte 2` | same defect as #1 (`across` is not a boundary today) | fixed: both conditions |
| 7 | `players with over 300 games at 2 clubs` | plan | `games gt 300`, `clubs_played gte 2` | `clubs_played gt 300` (via the same unclipped-window defect: `over(?=\s+\d)` and the leftmost digit both land in the `clubs` window) | fixed: `games gt 300`, `clubs_played gte 2` |
| 8 | `players with 10 premierships in 300 games` | plan | `premierships gte 10`, `games gte 300` | **already correct** — `premierships` is both array-first and sentence-first here, and its own preceding `10` is never contested | unchanged (still correct) |
| 9 | `players with 300 games` (baseline) | plan | `games gte 300` | correct | unchanged |
| 10 | `players with 2 clubs` (baseline) | plan | `clubs_played gte 2` | correct | unchanged |
| — | `players with three premierships at two clubs` (number-word form) | plan | `premierships gte 3`, `clubs_played gte 2` | same defect as #1/#2/#6, number-word path: `clubs_played` window reaches back across `"at"` and finds `"three"` before `"premierships"` is ever tried | fixed: sentence order resolves `premierships` (sentence-first) before `clubs_played`, so `clubs_played`'s window only ever contains `"...at two clubs"` |

None of the ten required cases, nor the number-word variant, should decline — every one names two
unambiguous career-stat nouns each with its own unambiguous governing number once correctly bound.

---

## 6. Regression-test matrix

**Home:** extend the existing `describe('regression: two career conditions in one sentence do not
cross-contaminate', ...)` block in `tests/nl-parser.test.ts` (currently lines 1027-1069) — it is the
semantically closest existing suite (same function, same "two career conditions, one sentence"
shape, same style of hand-traced regression comment). Do not create a new describe block or a new
test file.

Add (exact expected conditions, matching §5):

1. **Original trigger** — `'players with 300 games at 2 clubs'` →
   `toContainEqual({ kind: 'column', column: 'games', op: 'gte', value: 300 })` and
   `toContainEqual({ kind: 'column', column: 'clubs_played', op: 'gte', value: 2 })`.
2. **Alternate preposition** — `'players with 300 games for 2 clubs'` → same two assertions.
3. **Reversed order** (must stay green, documents the case that already worked) —
   `'players with 2 clubs and 300 games'` → `clubs_played gte 2`, `games gte 300`.
4. **Comparative form** — `'players with more than 300 games at 2 clubs'` →
   `games gt 300`, `clubs_played gte 2`. This is the case that most directly proves the
   comparator-misattribution half of the bug is fixed, not just the digit-selection half.
5. **Third preposition, for completeness against the audit's neighbouring-risk list** —
   `'players with 300 games across 2 clubs'` → `games gte 300`, `clubs_played gte 2`.
6. Optionally, the `over` form (`'players with over 300 games at 2 clubs'`) if the implementer
   wants the full §5 matrix directly represented in this block rather than relying on manual
   verification; not strictly required since it exercises the same code path as case 4.

**Existing tests that must remain green (do not weaken, do not delete):**
- `tests/nl-parser.test.ts:1038-1042` — `'players with more than 300 clubs and over 10
  premierships'` → `clubs_played gt 300`, `premierships gt 10` (the original AFLDB-ISSUE-118-era
  truncated-digit-slice regression; still protected because the `" and "` clip is untouched, and
  because sentence order here still processes `clubs_played` and `premierships` in the same
  relative order the existing test expects — see §2's traced example).
- `tests/nl-parser.test.ts:1044-1067` — the other three tests in the same describe block
  (`'players with more than 4 clubs and over 4 premierships'`, `'players with at least 1 games and
  over 1 goals'`, `'players with over 2 games and over 5 premierships'`,
  `'players with more than 5 goals and over 5 finals'`) — all hand-traced against sentence-order
  processing in §2 and confirmed unaffected.
- `tests/nl-parser.test.ts:170-182` — `'players with 200 games and no premiership'`,
  `'players with 250 games and exactly two clubs'`.
- `tests/nl-parser.test.ts:446-458` — the `at least`/`more than`/`less than`/`exactly` comparator
  table (single-condition, unaffected by iteration order).
- `tests/nl-parser.test.ts:460-466` — `without`/`never` negation (handled by the separate
  `negativeTargets` loop before the main loop; untouched).
- `tests/nl-semantic-mapping.test.ts:165-189` — the club-scoped `"for Collingwood"` table and the
  "refuses club-scoped unranked conditions" test (confirmed in §4 that club extraction removes
  `"for <club>"` before this function ever runs).

No other describe block in either file names `clubs_played`, `games`, or the `CAREER_STAT_WORDS`
loop in a way that this change could plausibly affect (checked via the full `clubs_played`/
`careerConditions` grep across both files during planning).

---

## 7. `PARSER_VERSION` bump

Bump `PARSER_VERSION` from `46` to `47` in `src/search/nl/plan.ts:469`, and add a `v47` entry to the
comment block immediately above it (after the existing `v46` entry, lines ~461-468), in the
established style. Suggested text for the implementer to adapt once the exact final diff is known:

> `// v47 -- AFLDB-ISSUE-196: extractCareerConditions now resolves CAREER_STAT_WORDS occurrences in`
> `// the order they appear in the question, not CAREER_STAT_WORDS's fixed vocabulary order, so a`
> `// later-in-vocabulary noun's lookback window can no longer reach a number that an`
> `// earlier-in-the-sentence noun has already claimed. "players with 300 games at 2 clubs" (and the`
> `// same shape with "for"/"across"/"over") now binds games >= 300 and clubs_played >= 2 instead of`
> `// misreading clubs_played >= 300 with the literal 2 silently orphaned.`

---

## 8. Risks / non-goals

- **Non-goal:** no new career-condition grain, column, or metric (per the issue's own non-goals).
- **Non-goal:** `"with"` is deliberately **not** added as a window boundary (§2, Option B rejection).
  A future issue may revisit this if a real corpus hit demonstrates a `with`-linked two-clause
  career condition that mis-binds — none is known today.
- **Residual, out-of-scope risk:** `"over"` used as a clause-**linker** immediately before a number
  belonging to the *next* clause (e.g. a hypothetical `"300 games over 2 clubs"`, read as "spread
  over 2 clubs") is not in the required matrix and is not fixed by this change, because `"over"`
  immediately followed by a digit is unconditionally read as the `gt` comparator
  (`vocab.ts:743`) regardless of iteration order, and sentence order does not disambiguate a
  genuine same-position conflict between "comparator for the next number" and "clause linker before
  the next number." This is the same class of inherent ambiguity noted for Option D (§2) — track as
  a new issue only if a real query of this shape is found; do not speculatively guard against it now.
- **No change to `validatePlan`, `describe.ts`, or any SQL/compiler code.** This is a parser-only,
  pre-plan-assembly fix; `careerConditions` values reaching `plan.ts`/the compiler are unchanged in
  shape, only in which value lands on which column.
- **No DB/schema impact.** Parser/plan-only, matches the issue's own "Migration/schema
  implications: None."
- **Confirm before implementing:** re-run the exact grep/read evidence in §1, §4 and §6 against
  whatever commit main is at when implementation starts, in case AFLDB-ISSUE-194/195 or unrelated
  work has touched `parser.ts`/`plan.ts` in the interim (both are in the same file; check for line
  drift).

---

## 9. Validation commands for the operator

Smallest-first, per CLAUDE.md's testing escalation:

1. `npx vitest run tests/nl-parser.test.ts` — the extended "two career conditions… do not
   cross-contaminate" block plus every existing test named in §6.
2. `npx vitest run tests/nl-semantic-mapping.test.ts` — non-regression for the club-scoped career
   condition tests at lines 165-189.
3. `npx tsc --noEmit` — the loop restructuring changes control flow and variable scoping inside
   `extractCareerConditions`; confirm no type regressions (e.g. `RegExpExecArray` typing through the
   `best` object).

DB-backed verification is **not** required unless implementation reveals unexpected SQL/compiler
impact (none is expected — see §8). Do not request a broader NL corpus run for this focused a
parser change; the Stage 2 sign-off's separate full-corpus/triage requirements (`IssuesIndex.md`)
are a distinct, larger piece of work this plan does not cover.

---

## 10. Implementation steps, in order

1. Re-verify §1's line numbers and the exact current text of `extractCareerConditions`
   (`parser.ts:1016-1195`) against the commit main is on at implementation time.
2. Rewrite the main loop (`parser.ts:1076-1192`) per §3's sketch: replace fixed-array iteration with
   "repeatedly select the pending `CAREER_STAT_WORDS` entry whose match occurs earliest in the
   current `working`," keeping the loop body's window/comparator/digit/number-word/span logic
   byte-for-byte otherwise unchanged.
3. Add the six regression cases from §6 to the existing describe block in
   `tests/nl-parser.test.ts` (extend, do not duplicate the block).
4. Run validation command 1 (§9); fix any failure by re-checking the trace in §2/§5 for that
   specific case before changing approach.
5. Run validation command 2 (§9).
6. Run validation command 3 (§9).
7. Bump `PARSER_VERSION` to `47` and add the `v47` comment (§7) once the implementation's actual
   final shape is known (word the comment to match what was actually built, not the sketch verbatim).
8. Report changed files (`src/search/nl/parser.ts`, `src/search/nl/plan.ts`,
   `tests/nl-parser.test.ts`) to the operator for review/commit — implementation session does not
   commit; per CLAUDE.md, Git remains user-operated.
9. Update `issues.md` AFLDB-ISSUE-196 (status, root cause as actually fixed, validation evidence)
   and remove it from `IssuesIndex.md`/the Open Issues table once the operator confirms the
   validation commands passed — this is implementation-session work, not this plan's.
