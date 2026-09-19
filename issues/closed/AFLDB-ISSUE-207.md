# AFLDB-ISSUE-207 — Numeric operator ownership between grouped result threshold and margin filter

Status: RESOLVED 2026-09-16 (Sonnet 5, operator-validated on streamanator).
Fix applied and focused-tested on `sonnet/issue-207-numeric-operator-ownership`
(base `51e94370`, unmerged; implementation commit `4ecdd77a`). Parser version
55. Both required operator checks passed — see "Operator validation" below.

This is follow-on item (1) of `AFLDB-ISSUE-206.md`'s six proposals: the
highest-severity finding from that corpus (281 accepted, silently
wrong-answer rows), scoped narrowly to itself per ISSUE-206's own priority
ordering.

## Defect

`AFLDB-ISSUE-206.md` §37/§155/§260 found 281 exploratory-corpus rows where a
question combining a grouped wins/losses/draws/games threshold with a
per-match margin filter parsed with the two clauses' comparators silently
swapped:

```text
Teams with 7 or more wins by over 50 points
intended:  wins >= 7,  margin >  50
actual:    wins >  7,  margin >= 50
```

Both fields still passed `validatePlan`, so ISSUE-206's original grain/
metric-only scorer scored these `clean` — a genuinely wrong answer that
looked like a correct one.

## Root cause (verified against current source, not assumed from ISSUE-206)

`extractHavingClause` (`src/search/nl/parser.ts`) matches the grouped
result noun (`wins`/`losses`/`draws`/`games`/`win`/`won`/`lose`/`lost`) and
opens a window `±20` characters around it to find the clause's count
(digit, `twice`/`thrice`/`N times`, or a number word) and its comparator
(`COMPARE_OP_WORDS`, `src/search/nl/vocab.ts`). The count search genuinely
needs both directions — the count can precede the noun ("7 wins") or follow
it ("lose 5 times") — but the **operator** search reused the exact same
window, unbounded on the right.

Two independent mechanisms, both traced to that one over-wide window,
produced the swap:

1. **Character-window spillover.** On a short question the `+20`
   right-hand extension reaches past the noun's own number, across
   `by ... points`, into the margin clause's own operator word. "7 or more
   wins by **over** 50 points": no `COMPARE_OP_WORDS` entry matches "or
   more" (it isn't in that table at all — the bare-number default `gte` is
   what makes "or more" work), so with the window intact the loop instead
   finds `over` — belonging to the margin clause — and claims `gt` for the
   wins threshold. The claimed token is then stripped from the working
   text, so `extractMatchFilter` (which runs next) sees a bare margin
   number with no operator word left and falls back to its own default
   `gte`. Both operators end up wrong, in a mirrored way.

2. **Fixed vocabulary-list-order precedence**, independent of window width.
   `COMPARE_OP_WORDS` is an ordered array (`vocab.ts:738-761`) and the loop
   takes the first ENTRY in that array whose pattern matches anywhere in
   the window — not the entry whose match occurs earliest in the text.
   `at least` (array index 4) is listed before `more than` (array index
   6). "more than 7 wins by **at least** 50 points": even though "more
   than" appears first in the sentence and genuinely governs the wins
   clause, `at least` — sitting later in the text but earlier in the fixed
   list — is what the loop finds and claims, giving the wins threshold
   `gte` instead of `gt`. This reproduces even on a window that happens to
   contain both phrases intact, so mechanism 1's width tuning alone could
   not have fixed it.

Verified empirically with a disposable direct-parser probe (no test
infrastructure changes; deleted after use) against the unmodified parser
before any edit:

| Question | havingClause (buggy) | matchFilter (buggy) |
| --- | --- | --- |
| Teams with 7 or more wins by over 50 points | `wins gt 7` (want `gte`) | `win_margin gte 50` (want `gt`) |
| Teams with 7 or more losses by over 50 points | `losses gt 7` (want `gte`) | `loss_margin gte 50` (want `gt`) |
| Teams with more than 7 wins by at least 50 points | `wins gte 7` (want `gt`) | `win_margin gte 50` (correct by coincidence) |
| Teams with fewer than 7 losses by at least 50 points | `losses gte 7` (want `lt`) | `loss_margin gte 50` (correct by coincidence) |
| Teams with at least 7 wins by more than 50 points | `wins gte 7` (correct — "at least" is leftmost AND earliest-listed) | `win_margin gt 50` (correct) |
| Teams with over 7 wins by over 50 points | `wins gt 7` (correct) | `win_margin gt 50` (correct) |
| teams to lose 5 times by more than 100 points | `losses gte 5` (correct — "more than" fell just outside the char budget) | `loss_margin gt 100` (correct) |

The last three rows show why ISSUE-206's own representative examples and
this codebase's one pre-existing regression test for this family
(`teams to lose 5 times by more than 100 points`, added under ISSUE-188)
did not previously catch this: the bug's manifestation depends on exact
character distances and on `COMPARE_OP_WORDS`' fixed order relative to the
sentence, so several plausible phrasings happen to come out right by
accident while others do not.

## Fix

`extractHavingClause`'s operator search is now bounded to
`window.slice(0, countEnd)` — the window text up to and including the
count this clause already matched, never past it (`parser.ts`, inside the
`if (value !== null) { ... }` block, immediately before the
`COMPARE_OP_WORDS` loop).

This is sound because every `COMPARE_OP_WORDS` entry is a phrase that
governs a number *immediately following* it — including the `over`/`under`
entries, which require a digit lookahead (`(?=\s+\d)`) and are therefore
still satisfied when the search string is truncated right after that
digit. None of that vocabulary's forms apply to this having-clause family
from the far side of the noun; the only "trailing" idiom this family
supports ("7 or more wins") isn't in `COMPARE_OP_WORDS` at all and relies
on the existing bare-number default, which is untouched. Bounding the
search this way eliminates mechanism 1 (the competing text is no longer in
the searched substring) and mechanism 2 in the same stroke (with only one
clause's operator words present in the search string, list order can no
longer prefer the wrong one).

`extractMatchFilter` itself was not changed. No vocabulary was added, no
parser stage was reordered, and no default changed — matching the issue's
constraints.

**Files changed:**

- `src/search/nl/parser.ts` — `extractHavingClause`'s operator-search bound.
- `src/search/nl/plan.ts` — `PARSER_VERSION` 54 → 55, version-history comment.
- `tests/nl-parser.test.ts` — 11 new regression tests (new
  `describe('AFLDB-ISSUE-207: ...')` block) plus a strengthened assertion
  on the pre-existing ISSUE-188 `teams to lose 5 times by more than 100
  points` test (now also asserts `matchFilter`).

## RED phase evidence

With the fix temporarily reverted (operator search restored to the full
`window`), the 11 new tests were run in isolation:

```text
npx vitest run tests/nl-parser.test.ts -t "AFLDB-ISSUE-207"
```

Result: **4 failed / 7 passed** (of the 11 new tests). The 4 failures were
exactly the rows the root-cause analysis predicted would be wrong under
the unfixed code:

- `7 or more wins by over 50 points` → `havingClause.op` was `gt`, expected `gte`.
- `7 or more losses by over 50 points` → `havingClause.op` was `gt`, expected `gte`.
- `more than 7 wins by at least 50 points` → `havingClause.op` was `gte`, expected `gt`.
- `fewer than 7 losses by at least 50 points` → `havingClause.op` was `gte`, expected `lt`.

The other 7 (both no-margin controls, both already-declining controls, the
`at least ... by more than ...` and `over ... by over ...` pairings, and the
documented out-of-scope trailing-"or more"-in-margin gap) already passed
under the unfixed code, exactly as the hand analysis predicted (see the
table above). This confirms the new tests fail for the *diagnosed* reason,
not an unrelated one, before any fix was applied.

The fix was then reapplied and the same targeted run went 11/11.

## Focused test results (this workstation)

Run from a `npm ci`-restored `node_modules` scoped to this worktree only
(the shared main checkout's `node_modules` was empty; no other worktree or
checkout was touched):

```text
npx vitest run tests/nl-parser.test.ts        -> 457/457 passed
npx vitest run tests/nl-stress-corpus.test.ts -> 53/53 passed
npm run typecheck                             -> clean (next typegen + tsc --noEmit)
```

## Scope discipline — one adjacent gap found, documented only

While validating the "7 wins by 50 or more points" construction from the
issue's own coverage list, `extractMatchFilter`'s regex was found to have
no form for a trailing "or more"/"or fewer" after the margin number — the
question declines today (`points` left unconsumed) both before and after
this fix, for an unrelated reason (no `matchFilter` match at all, not an
ownership swap). This is a separate, pre-existing gap, not touched by this
fix, and is not opened as a tracked issue here (no corpus evidence of its
real-world frequency was gathered, and ISSUE-207's scope is the ownership
crossing specifically). A regression test asserts this decline behaviour
is unchanged by the fix, so a future change to it is a deliberate,
visible choice.

No other adjacent defects were found or fixed. The five other ISSUE-206
clusters (club-role ownership / `AGAINST_PREPOSITION`, head-to-head
"has more wins", imperative vocabulary, `after YEAR`, and the
`career_boundary` compiler restriction) were not touched.

## Operator validation

Both required checks were run on the Linux development host (streamanator)
and passed.

**1. Frozen V5 stable-regression gate** (parser v55, corpus unchanged):

```text
Corpus: /home/arm/nl-stress-corpus-v5.csv
Run:    /home/arm/nl-stress-v55-v5
Result: 12000 scored / 12000 clean / 0 soft / 0 failed
```

No regression to the stable baseline.

**2. ISSUE-206 exploratory 281-row numeric-operator family recheck.** A
direct structured-plan comparison between the retained pre-fix (v54) and
post-fix (v55) exploratory runs — both 29,030 rows / 29,030 unique IDs
(`/home/arm/nl-exploratory-v1-validation/results.jsonl` vs
`/home/arm/nl-exploratory-v55-validation/results.jsonl`) — found:

```text
changed plans: 281
281 havingClause.op: "gt" -> "gte"
281 matchFilter.op:  "gte" -> "gt"
```

All 281 changes are exactly the ISSUE-207 defect family, and no other
structured-plan field changed across the entire 29,030-row corpus (no
collateral movement). Representative row (id 20600048, "Teams with 7 or
more losses by over 60 points in 2017"): before the fix,
`havingClause = {losses, gt, 7}` / `matchFilter = {loss_margin, gte, 60}`
(swapped); after, `havingClause = {losses, gte, 7}` /
`matchFilter = {loss_margin, gt, 60}` (intended pairing).

The aggregate exploratory scorer result (27530 scored / 1500 audit-required
/ 10874 clean / 15275 soft / 1381 failed) is unchanged by this fix, as
expected: the ISSUE-206 scorer does not assert comparator fields, so these
281 rows were already scored `clean` before and after — the decisive
evidence is the direct structured-plan diff above, not the scorer's
aggregate counts. The scorer's diagnostic-group count moved 99 -> 97 as a
side effect of the plan changes; this is not separately investigated as it
carries no additional evidence beyond the field-level diff.

**Resolution:** both checks confirm the fix produces the intended operator
pairing with zero collateral movement. Issue resolved.
