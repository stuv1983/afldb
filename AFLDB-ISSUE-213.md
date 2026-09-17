# AFLDB-ISSUE-213 — `extractClubs` overlapping club-name position bug breaks unordered matchup detection

Status: **IMPLEMENTED, NOT YET RESOLVED 2026-09-17.** Local (DB-free) implementation, RED-reproduction
test authorship, and local test/typecheck verification are all complete on
`sonnet/issue-213-overlapping-club-matchup` (`npm ci` was run by the operator after the initial
implementation pass; see §6a for one fixture-only correction found once tests could actually execute).
Host validation on streamanator (frozen V5 + exploratory V2 against `/home/arm/nl-exploratory-v2.csv`)
is outstanding. See §8 for exact commands.

## 1. Confirmed defect (from AFLDB-ISSUE-212's closeout)

`AFLDB-ISSUE-212.md` §6a and `issues.md`'s ISSUE-212 entry recorded, but deliberately did not fix or
open as its own issue, one genuine parser defect exposed (not caused) by ISSUE-212's corrected
exploratory V2 oracle:

```
id: 20609919
question: Largest winning margin for North Melbourne versus Melbourne at Adelaide Oval
```

Expected semantic scope:

```
scope.matchup = unordered { North Melbourne, Melbourne }
```

Parser v59's actual result (identical in both the V1 and V2 oracle — the plan itself never changed,
only V2's oracle became strict enough to catch it):

```
grain = team_match
metric = win_margin
agg = max
scope.clubFor = North Melbourne
scope.clubAgainst = Melbourne
scope.venue = Adelaide Oval
scope.matchup = absent
```

Not an ISSUE-212 scorer defect, not an ISSUE-212 generator defect, not a new parser regression — a
pre-existing `extractClubs` defect previously masked by V1's directional oracle for this template.

## 2. Root cause, re-verified from current source

`src/search/nl/parser.ts`, `extractClubs` (pre-fix lines ~220-269) and its two position helpers,
`phrasePosition`/`phraseEnd` (pre-fix lines 161-170):

- `findClub` (`src/search/nl/entities.ts`, `findLongestMatch`) returns the **longest** directory name
  that exists anywhere in the current working text, regardless of where in the text it sits. For "North
  Melbourne versus Melbourne", the first `extractClubs` iteration always matches "North Melbourne" (15
  chars) over "Melbourne" (9 chars), no matter which one a reader would call "first".
- After the first club is stripped from the *working* copy, the second iteration matches "Melbourne".
  `extractClubs` then needed the REAL position of each match in the *original* question (not the
  mutated working copy, whose offsets no longer line up with the original text) so it could measure the
  literal gap between the two clubs and check it against `/^(?:v|vs\.?|versus)$/`.
- The old `phrasePosition`/`phraseEnd` found that position with a bare, non-global
  `new RegExp('\\b' + escaped(phrase) + '\\b').exec(text)` against the whole original text — i.e. the
  FIRST word-boundary occurrence of `phrase` anywhere in the string. But "Melbourne" is *also* a
  word-boundary match **embedded inside** "North Melbourne" itself — the space before it is a word
  boundary too — and that embedded occurrence comes first in the string. The search silently bound the
  second club to the position of the "Melbourne" *inside* "North Melbourne", not the real, later,
  standalone "Melbourne" after "versus".
- With both clubs' spans now overlapping/adjacent in the wrong way, the computed gap
  `text.slice(left.end, right.at)` came out empty (or the `left.end <= right.at` guard failed outright),
  so the exact-`versus` check never matched, `scope.matchup` was never formed, and the code fell through
  to the `for`/`against` directional role-assignment branch — which happened to assign `clubFor=North
  Melbourne, clubAgainst=Melbourne`, exactly the recorded defect.
- **Order-sensitive.** The reverse wording, "Melbourne versus North Melbourne", was already correct
  before this fix: `findClub` still matches "North Melbourne" first (same longest-match rule,
  independent of position), but the REAL standalone "Melbourne" is now the first `\bMelbourne\b` in the
  string too, so even the old buggy search happened to find the right occurrence. Confirmed by test (§6).

The previous doc comment on `phrasePosition` claimed the word-boundary anchor was there "so 'melbourne'
does not report the position of 'north melbourne'" — that claim does not hold: a `\b` before "Melbourne"
is satisfied by the space inside "North Melbourne" just as much as by any other word boundary, so the
anchor alone cannot distinguish the two.

## 3. Candidate pairs investigated

ISSUE-212 named two more pairs sharing the identical structural shape (the shorter club's name is the
literal tail word of the longer club's own name) as **unreproduced, source-derived hypotheses only** —
the actual ISSUE-212 host run found exactly one hard failure total, so neither was confirmed drawn by
that seed.

This session could not execute the parser against either pair directly (no `node_modules` in this fresh
worktree — see status above), so both were **confirmed by manual trace of the current, pre-fix source
logic** — a character-by-character simulation of `findLongestMatch`, the old `phrasePosition`, and the
`between`/`byPosition` matchup check, not an actual test run:

- **`Port Adelaide` / `Adelaide`** ("Largest winning margin for Port Adelaide versus Adelaide"): traces
  identically to North Melbourne/Melbourne — "adelaide" is the tail word of "port adelaide", the old
  search finds the embedded occurrence first, the gap comes out empty, matchup never forms, and the
  directional fallback happens to produce `clubFor=Port Adelaide, clubAgainst=Adelaide`. Reverse order
  ("Adelaide versus Port Adelaide") traces correctly, same reasoning as the confirmed row's reverse case.
- **`Greater Western Sydney` / `Sydney`** ("Largest winning margin for Greater Western Sydney versus
  Sydney"): traces identically — "sydney" is the tail word of "greater western sydney". Reverse order
  traces correctly.

Both are recorded in `tests/nl-parser.test.ts` as "confirmed to reproduce the same mechanism" (by trace,
not execution) rather than as unconfirmed hypotheses, since the mechanism is now understood precisely
enough to predict the outcome deterministically from the source logic alone. The operator's actual test
run (§7/§8) is the empirical confirmation this trace stands in for.

## 4. Implementation

`src/search/nl/parser.ts`:

- Removed `phrasePosition`/`phraseEnd`.
- Added `firstUnclaimedOccurrence(text, phrase, claimed)`: scans **all** word-boundary occurrences of
  `phrase` in `text` (global regex, not just the first) and returns the first one that does not overlap
  a span already present in `claimed`.
- `extractClubs`'s per-club loop now calls `firstUnclaimedOccurrence(text, match.matchedText, found)`
  instead of the old bare first-match search, passing the `found` array accumulated so far (each entry's
  `at`/`end` is exactly the span shape the new helper checks against). A later club can therefore never
  steal an earlier club's own already-claimed span, however their names relate textually.

This is the "preserve the actual matched occurrence position, avoid a later whole-string `RegExp.exec`
that can bind to an earlier embedded occurrence" design the issue anticipated, adapted to the smallest
change that fits the existing control flow: rather than threading match offsets out of `findClub`/
`findLongestMatch` (which would touch `entities.ts` and every other caller), the exclusion is applied at
the point `extractClubs` already re-derives positions, using only information it already has (the spans
of clubs found earlier in the same call).

**Generic, as required:** no club name, alias, or the row id appears anywhere in the fix. The exclusion
is purely by character span, so it applies identically to any pair of club names in this "one name is a
whole word embedded inside the other" relationship — not just the three pairs this issue investigated.

**Unaffected by design:** `nearestGoverningPreposition` (the `for`/`against`/`to` role-assignment logic)
and the exact-`versus`/`vs`/`v`-only matchup check are untouched. Directional wording, and symmetric
wording between clubs with no name overlap, are unaffected (§6).

## 5. Parser version

`PARSER_VERSION` 59 → 60, `src/search/nl/plan.ts`. A dated entry was added to the existing version-
history comment block directly above the constant, matching the v55-v59 entries already there. Bumped
exactly once, per the issue's instruction.

## 6. Tests (`tests/nl-parser.test.ts`)

DB-free, matching this file's existing conventions. All written to describe the RED (pre-fix) failure
explicitly in comments, then confirmed GREEN by an actual run once dependencies were installed (§7).

New fixtures: clubs `Melbourne` (org 8), `North Melbourne` (org 9), `Sydney` (org 10), `Essendon`
(org 11), `Hawthorn` (org 12); venue `Adelaide Oval` (id 3).

New `describe('AFLDB-ISSUE-213: overlapping club names must not steal each other's matched span', ...)`
block:

- **Confirmed defect.** The exact row-20609919 wording asserts `scope.matchup` with both clubs present
  and `clubFor`/`clubAgainst` both undefined (this is the RED reproduction — under pre-fix v59 source,
  this assertion fails: the plan instead carries `clubFor=North Melbourne`, `clubAgainst=Melbourne`, no
  `matchup`). Its reverse order is included as a documented-already-correct control, not a RED case.
- **Candidate pairs**, forward and reverse order, for both `Port Adelaide`/`Adelaide` and
  `Greater Western Sydney`/`Sydney` (§3).
- **Regression: ordinary non-overlapping symmetric wording.** `Sydney versus Richmond`,
  `Collingwood vs Carlton`, `Essendon v Hawthorn` — proves the fix does not turn every symmetric club
  pair into a special case; these clubs share no name-overlap at all.
- **Regression: directional wording for an overlapping-name pair stays directional.**
  `North Melbourne biggest win against Melbourne` and `biggest win by Port Adelaide against Adelaide` —
  proves the fix does not collapse legitimate `clubFor`/`clubAgainst` semantics into `matchup` just
  because the pair happens to have overlapping names.
- **Control: partial-text, non-collision pair.** `Adelaide versus Greater Western Sydney` — a sanity
  check for a pair that shares partial text but is not a whole-word embedding, so it never enters the
  new helper's overlap-exclusion branch at all.

## 6a. Fixture-only correction found once tests could execute

`npm ci` installed dependencies in this worktree, and the first real run of `tests/nl-parser.test.ts`
found one failure, **not a parser regression**: `describe('16. marquee matches...')`'s
`'a rivalry whose clubs are not in the directory declines instead of guessing'` (pre-existing, parser
v15 era) asserted `parse('players who played in a sydney derby')` declines (`status: 'none'`) because
its comment recorded that the shared fixture directory had no `Sydney` club. §6's new fixtures added
`Sydney` (and `Greater Western Sydney` already existed, from AFLDB-ISSUE-202) to that same shared
`CLUBS` array for this issue's own overlapping-name coverage — which made `'sydney derby'`
(`RIVALRY_WORDS` in `src/search/nl/vocab.ts` maps it to `['sydney', 'greater western sydney']`) resolve
both required clubs for the first time, so the question now produces a plan instead of declining. The
parser behaved correctly given the (now-changed) fixture; the test's *assumption about the fixture* was
invalidated, not the parser.

**Fix (test-only):** swapped the question to `'players who played in a western derby'`
(`RIVALRY_WORDS` → `['west coast', 'fremantle']`), neither of which is in the shared fixture and neither
of which this issue touches. This preserves exactly what the test proves — a rivalry cue whose two
required clubs are absent from the directory declines rather than guessing — via a different rivalry
pair instead of restructuring the fixture or introducing a per-test local `NlParseContext` (the shared
top-of-file fixture is used uniformly throughout this file with no existing precedent for scoping a
smaller directory to one test, so swapping the negative control's own rivalry pair was the smaller,
more consistent change). The comment was rewritten to explain the swap and name the mechanism
(`RIVALRY_WORDS`) directly rather than re-asserting a claim about which specific club is absent, so a
future fixture addition is less likely to silently invalidate it again. No other pre-existing test in
this file was found to depend on the absence of `Melbourne`, `North Melbourne`, `Essendon`, `Hawthorn`,
or `Adelaide Oval` (checked by search — the only other appearances of those name are its own fixture
declarations, the MCG-venue tests, which use the `mcg`/`the g` aliases rather than the literal word
"melbourne" and are unaffected, and this issue's own new test block). `Adelaide`/`Port Adelaide`/`GWS`
predate this issue and were not newly introduced.

`src/search/nl/parser.ts`/`plan.ts` (production code) were **not** touched for this correction.

## 7. Local verification — complete

```sh
cd D:\dev\afldb-issue-213
npm ci

npx vitest run tests/nl-parser.test.ts
# -> Test Files 1 passed (1), Tests 509 passed (509)

npx vitest run tests/nl-regression-corpus.test.ts tests/nl-semantic-mapping.test.ts tests/nl-stress-corpus.test.ts
# -> Test Files 3 passed (3), Tests 402 passed (402)

npm run typecheck
# -> clean, no errors
```

`tests/nl-stress-corpus.test.ts` tests the stress-harness scorer (`tools/nl/corpus.ts`) against
synthetic in-memory plans, not the parser itself, and was unaffected by either this issue's parser fix
or the fixture correction, as expected.

## 8. Host validation (streamanator) — commands for the operator, not yet run

Do **not** regenerate the V2 corpus — reuse the existing, frozen `/home/arm/nl-exploratory-v2.csv` from
ISSUE-212 (29,030 rows, seed `2060542026`, SHA256
`bb75e4b5067942117c60f8eab6cfd01de4d8fc1e0c4fee07e10650fae97edb4a`).

```sh
# 1. Frozen V5 stable corpus must stay 12000/12000/0/0 under v60.
npm run nl:stress -- --corpus /home/arm/nl-stress-corpus-v5.csv \
  --out /home/arm/nl-stress-v5-v60-recheck

# 2. Exploratory V2 against parser v60 (parse-only, matching ISSUE-212 §9's own invocation).
npm run nl:stress -- --corpus /home/arm/nl-exploratory-v2.csv \
  --out /home/arm/nl-exploratory-v2-v60-validation --parse-only --concurrency 6

node tools/nl/triage-exploratory-corpus.mjs \
  --corpus /home/arm/nl-exploratory-v2.csv \
  --results /home/arm/nl-exploratory-v2-v60-validation/results.jsonl \
  --failures /home/arm/nl-exploratory-v2-v60-validation/failures.csv \
  --summary /home/arm/nl-exploratory-v2-v60-validation/summary.json \
  --out /home/arm/nl-exploratory-v2-v60-validation/triage.md \
  --json /home/arm/nl-exploratory-v2-v60-validation/triage.json

# 3. Row 20609919 specifically: confirm it is no longer in the failure set.
grep -w 20609919 /home/arm/nl-exploratory-v2-v60-validation/failures.csv || echo "row 20609919 not in failures -- clean"

# 4. Structured plan-diff/reconciliation against ISSUE-212's retained v59 V2 run, if that run
#    directory (named exactly this way in AFLDB-ISSUE-212.md §9) is still present on the host --
#    confirms no row other than 20609919 moved, in either direction.
npm run nl:stress:compare -- /home/arm/nl-exploratory-v2-v59-validation /home/arm/nl-exploratory-v2-v60-validation
```

**Required outcomes before this issue resolves:**

1. Frozen V5 stays `12000 scored / 12000 clean / 0 soft / 0 failed`.
2. V2 row `20609919` moves from hard failure to clean.
3. V2 aggregate hard failures move `1 -> 0`, unless an independent, unrelated hard failure appears (which
   would itself need investigating separately, not folded into this issue's evidence).
4. No unrelated row changes — the `nl:stress:compare` regressions table must be empty, and any row
   movement outside `20609919` must be explained before this issue is marked resolved.

**Do not claim these results before the operator actually runs them.** This document records the
commands, not their output.

## 9. Guardrails honoured

- No club name (or row id) special-cased in the fix itself — the exclusion works purely on character
  spans already computed from the directory match, generically.
- Symmetric matchup semantics unchanged: still exactly `ClubA <v|vs|versus> ClubB` with nothing else
  between the two mentions; the fix only corrects how each mention's position is measured.
- `AFLDB-ISSUE-212`'s V2 corpus/scorer files (`tools/nl/generate-exploratory-corpus-v2.mjs`,
  `tools/nl/corpus.ts`) not touched.
- No directional club query converted to matchup (§6 regression coverage).
- No soft-fail family unrelated to this defect touched.
- No Git commit, push, merge, branch deletion, or worktree removal performed this session. Read-only
  Git inspection only.

## 10. Worktree status

Reviewed at the end of this session (see the final response for the exact command output and file
list) — no untracked files beyond the ones this session intentionally created
(`AFLDB-ISSUE-213.md` itself) were found; all other changes are edits to already-tracked files.
