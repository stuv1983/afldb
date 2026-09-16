# AFLDB-ISSUE-205 — Two-family root cause for the 70 remaining WRONG_FAILURE_REASON rows

**Status:** IN PROGRESS (Sonnet 5). **Runtime is fully validated and green** (§5a): parser 446/446,
integration 35/35 (including the `q3_deficit_overcome` SQL test), `tsc --noEmit` clean. Do not modify
parser/runtime again unless new evidence demands it; `PARSER_VERSION` stays 54. The first real corpus-
correction attempt then correctly failed closed on an over-broad candidacy design in the correction tool
itself (§7a) — unrelated to the runtime fix, and fixed in the same script. **Not yet resolved.** Do not
mark resolved, update `CHANGELOG.md`, or regenerate V5 until the validation sequence in §8 passes.

Opened as AFLDB-ISSUE-200's Stage 2 next-task item 6 (the 70 `WRONG_FAILURE_REASON`/`TAXONOMY_DRIFT`
rows left unaudited when Stage 2 closed). Stage 2 itself is not reopened or redefined by this issue.

## 1. Baseline

```text
main @ 5609fe17 (AFLDB-ISSUE-204 merged)
PARSER_VERSION 53
Corpus:  /home/arm/nl-stress-corpus-v4.csv
Run:     /home/arm/nl-stress-v53-v4
Result:  12000 scored / 11930 clean / 70 soft / 0 failed
Soft findings: WRONG_FAILURE_REASON: 70 (100%)
```

## 2. Audit: the 70 rows are two unrelated families, not one taxonomy-drift cluster

Real evidence, operator-extracted from `/home/arm/nl-stress-v53-v4/failures.csv`:

```text
rows: 70
category: expected_decline 70          (corpus's own generic placeholder category for this cluster)
template: decline 70                   (ditto — not a useful discriminator between the two families)
detail:  WRONG_FAILURE_REASON: unsupported_topic -> unsupported_term   (all 70)
status:  decline                        (all 70 — both expected and actual)
grain/metric/aggregation: ("", "", "")  (all 70 — nothing parsed)
unsupportedTerms:
  comeback       42
  comeback from  28
```

Representative rows:

```text
11707 | Adelaide biggest three quarter time comeback
11708 | Adelaide biggest three quarter time comeback since 2000
11709 | who has the biggest three quarter time comeback for Adelaide
```

Two phrase families, cleanly separated by the `unsupportedTerms` value:

- **Family A (42 rows):** `"...three quarter time comeback..."` / `"...3qt comeback..."` phrasing.
- **Family B (28 rows):** `"...comeback from quarter time..."` phrasing (Q1, not Q3).

AFLDB-ISSUE-200's own disposition for this cluster (`tools/nl/issue-200-dispositions.csv` row 6,
`three_quarter_time_taxonomy_drift`, `TAXONOMY_DRIFT`) treated all 70 as one benign label mismatch:
"Three-quarter-time comeback questions ... correctly decline in both expected and actual output; only
the failure-reason label differs. No semantic-correctness defect." **This audit disproves that.**

## 3. Family A root cause: genuine parser-ordering defect

`q3_deficit_overcome` is a real, fully implemented team_match metric:

- Vocab: `TEAM_METRIC_WORDS[0]` (`src/search/nl/vocab.ts:229`) —
  `/\b(?:3qt|three[- ]quarter time) comebacks?\b/`.
- Plan: `plan.ts:983` — `q3_deficit_overcome: columnMetric('q3_deficit_overcome', '3QT deficit overcome', 'q3_deficit')`.
- SQL: `src/db/queries/nl/team-match.ts:64-65` —
  `CASE WHEN t.winner_club_id = t.club_id AND t.q3_score_against IS NOT NULL THEN (t.q3_score_against - t.q3_score_for) END`.

It predates 15 September 2026 (referenced in the AFLDB-ISSUE-192 changelog entry as an unaffected
side-dependent metric) — not a recent, half-finished addition.

**The defect:** `extractScoreCheckpoint`'s `'3QT'` entry (`src/search/nl/parser.ts:1442-1453`, pipeline
step 6.5) unconditionally consumed `"three quarter time"`/`"3qt time"` — in service of a *different*
feature (`scoreCheckpoint`, "who was leading at three quarter time") — before `extractTeamMetric`
(step 11, `parser.ts:2565-2566`) ever saw the text. By the time step 11 ran, only the orphaned word
`"comeback"` remained, which matches no `TEAM_METRIC_WORDS` entry. `metric` stayed `undefined`, grain
election (`parser.ts:2982-2984`, gated purely on `teamMetricResult.metric` being truthy) never fired,
and the row declined generically with `unsupported_term`.

`validatePlan` (`plan.ts:1995-1999`) independently forbids `scoreCheckpoint` co-occurring with
`q3_deficit_overcome` ("This team-match statistic is not meaningful at a score checkpoint") — proof
these are two genuinely different plan shapes competing for the same surface phrase, not a case where
both could coexist. This exact class of "an earlier stage eats tokens a later stage needs" bug has
precedent in this codebase (AFLDB-ISSUE-191, boundary extraction vs. period-split).

No unit test previously exercised this collision: `tests/nl-parser.test.ts`/`tests/nl-plan.test.ts` had
zero `scoreCheckpoint` text-extraction coverage before this issue (the only prior `scoreCheckpoint` hits
were `validatePlan`-level tests against hand-built plan objects, `nl-plan.test.ts:757,894`), and the only
prior "comeback" hits in `tests/` were an unrelated club-comparison UI feature
(`tests/integration/club-comparison.test.ts`).

**Verdict: these 42 questions should answer, not decline.** Both the runtime and the corpus's own
`expected_status=decline` were wrong.

## 4. Family B root cause: genuine feature gap, not corpus drift either

"Comeback from quarter time" means a Q1 (end-of-first-term) deficit overcome — AFL terminology
distinguishes quarter time / half time / three-quarter time as three separate breaks, and AFLDB's own
club-comparison feature already models them as three separate stats
(`src/db/queries/club-comparison.ts:2699-2706`,
`biggest-comeback-from-quarter-time-a/b` / `-half-time-` / `-three-quarter-time-`). NL search implements
only the Q3 metric; no `q1_deficit_overcome` exists anywhere in `TEAM_METRIC_WORDS` or `team-match.ts`.

The same extraction-order collision applies (`extractScoreCheckpoint`'s `'QT'` entry consumes bare
`"quarter time"` the same way the `'3QT'` entry did), but fixing the ordering would not help: there is no
metric for `extractTeamMetric` to recover once unblocked. This is a real, currently-unimplemented
capability, not a bug in an existing one.

`expected_failure_reason=unsupported_topic` was stale regardless of the ordering question:
`UNANSWERABLE_TOPICS` (`src/search/nl/vocab.ts:1542-1600`, a curated list of 6 named-but-untracked
concepts — rebound 50s, fantasy/SuperCoach, position, youngest/oldest, averages, subjective rankings) has
no comeback entry of any kind, so `unsupported_topic` was never a live label this phrase could produce.

**Decision (operator-directed, AFLDB-ISSUE-205 scope):** do not implement Q1 comeback support under this
issue. Do not add an `UNANSWERABLE_TOPICS` entry merely to preserve the stale label. These 28 rows stay
declines; only the failure-reason label is corrected to the runtime's own honest `unsupported_term`.

## 5. Runtime fix (Family A only)

`src/search/nl/parser.ts`, `extractScoreCheckpoint`'s `'3QT'` entry:

```diff
- [/\bat (?:3qt|three[- ]quarter)[- ]time\b|\b(?:3qt|three[- ]quarter)[- ]time\b/, '3QT'],
+ [/\bat (?:3qt|three[- ]quarter)[- ]time\b(?!\s+comebacks?\b)|\b(?:3qt|three[- ]quarter)[- ]time\b(?!\s+comebacks?\b)/, '3QT'],
```

A negative lookahead withholds the checkpoint match only when a comeback word immediately follows,
letting `extractTeamMetric` see the intact `"three quarter time comeback"`/`"3qt comeback"` phrase at
step 11. Only this one entry changed — `'HT'`/`'QT'` are untouched, so Family B's behaviour and every
genuine score-checkpoint question ("leading at three quarter time", "Adelaide score at three quarter
time") are unaffected by construction. Smallest safe change: no broader parser-stage reordering, per the
operator's explicit preference.

`PARSER_VERSION` 53 → 54 (`src/search/nl/plan.ts`), with a version-history comment in the file's
established style (mirrors the v52/v53 entries immediately above it).

## 5a. First operator-validation run: the 3QT-only guard was incomplete (found and fixed, same pass)

Operator results against the §5 fix:

```text
tests/integration/nl-answers-team-club.test.ts: 35/35 passed
  including "AFLDB-ISSUE-205: q3_deficit_overcome answers the biggest
  three-quarter-time deficit the eventual winner overcame"

tests/nl-parser.test.ts: 444 tests, 440 passed, 4 failed
  Adelaide biggest three quarter time comeback
  Adelaide biggest three quarter time comeback since 2000
  who has the biggest three quarter time comeback for Adelaide
  Adelaide three quarter time comeback
  -> all four now fail with unsupportedTerms: "three comeback"
  (Adelaide 3qt comeback still passes)
```

The integration SQL result is significant: it independently confirms `q3_deficit_overcome`'s SQL path
(§3) was never the problem, isolating the remaining defect entirely to parser extraction — no SQL/schema
change is implicated by this finding.

**Root cause of the incompleteness:** the §5 fix only withheld the `'3QT'` entry's *own* match on
"three quarter time comeback". It did not stop `extractScoreCheckpoint`'s next entry, `'QT'`
(`/\bat (?:q(?:uarter)?|qtr|quarter|quatre)[- ]time\b|.../`, generic Q1 checkpoint), from then matching
the *nested substring* `"quarter time"` inside `"three quarter time comeback"` and stripping it anyway —
`extractScoreCheckpoint`'s `for` loop tries each entry against the same original text in order and
returns on the first match, so when `'3QT'` declines, `'HT'` (no match) then `'QT'` gets a turn against
the still-full text and matches `"quarter time"` unconditionally. Result: `"three quarter time comeback"`
→ `"three"` + `"comeback"` both orphaned (`unsupportedTerms: "three comeback"`), exactly matching the
operator's observed regression. Two checkpoint patterns were competing for the same surface phrase; only
one of them had been guarded.

**Fix (same file, same entry group, `src/search/nl/parser.ts`):**

```diff
- [/\bat (?:q(?:uarter)?|qtr|quarter|quatre)[- ]time\b|\b(?:q(?:uarter)?|qtr|quarter|quatre)[- ]time\b/, 'QT'],
+ [/\bat (?<!three[- ])(?:q(?:uarter)?|qtr|quarter|quatre)[- ]time\b|\b(?<!three[- ])(?:q(?:uarter)?|qtr|quarter|quatre)[- ]time\b/, 'QT'],
```

A negative lookbehind refuses a `"quarter"`/`"qtr"`/`"quatre"` checkpoint word directly preceded by
`"three "`/`"three-"`, so `'QT'` can never re-consume what `'3QT'`'s own guard just withheld — regardless
of which entry the loop reaches first. Traced by hand against every named case: for
`"...three quarter time comeback"`, `'3QT'` declines (comeback follows) and `'QT'`'s lookbehind now also
declines (immediately preceded by `"three "`) — the full phrase survives intact for `extractTeamMetric`
at step 11. For `"Adelaide score at quarter time"` (no `"three"` present), the lookbehind never triggers
and `'QT'` fires exactly as before. For `"Adelaide largest comeback from quarter time"` (Family B),
`"quarter time"` is preceded by `"from "`, not `"three "` — the exclusion does not apply, `'QT'` still
fires and consumes it, so Family B's decline behaviour is byte-for-byte unchanged from before this
fix. Still no metric regex change (`TEAM_METRIC_WORDS[0]` untouched), no `HT` change, no stage reordering
— the fix stays inside `extractScoreCheckpoint`'s own entry list, per the operator's explicit constraint.

`PARSER_VERSION` remains 54: this refines the same unmerged behaviour change from §5, not a second
independent parser-semantics change.

## 6. Corpus scorer contract (established before touching any expectation)

Read `tools/nl/corpus.ts`'s `scoreRow` (the function every `nl:stress` run scores against) directly:

- **Plan-shape fields** — `grain`, `mode`, `metric`/`metricAlternatives`, `aggregation`, `topN`,
  `player`/`club`/`opponent`/`venue` identity, `seasonFrom`/`seasonTo`, `matchType`/`boundaryEvent`,
  `conditions`, `coverageBehaviour`, `minConfidence` — are checked **unconditionally** whenever the
  corpus row supplies them (`corpus.ts:468-638`), regardless of `--parse-only` vs. a full execute run.
- **Verified-answer fields** — `answerPrimary`, `answerValue`, `tieCount`, `resultCount` (the
  `WRONG_VERIFIED_ANSWER`/`WRONG_VERIFIED_VALUE`/`WRONG_TIE_COUNT` classes) — are gated behind
  `actual.executed` (`corpus.ts:611-632`): *"Only checkable when SQL actually ran: a --parse-only run has
  a plan and no answer, and scoring a missing answer as a wrong one would fail all 51 hand-verified rows
  for the wrong reason."* They are also only checked when the corpus row supplies that field at all.

**Finding:** the 42 Family A corrections need **no real DB answer value**. Leaving
`expected_answer_primary`/`expected_answer_value`/`expected_result_count`/`expected_tie_count` blank
(`verification_level=SEMANTIC`, the level most of the corpus's existing success rows already use) is
sufficient and scorer-correct, whether the eventual `nl:stress` run executes SQL or not. `verification_level`
itself is stored on the parsed expectation but is not read anywhere in `scoreRow`'s branching logic — it
is documentation, not an active scorer switch; what actually gates the verified-answer checks is
`actual.executed` combined with the corpus supplying the field. No DB answer values were invented,
computed, or populated anywhere in this issue's correction.

## 7. Tests added

**`tests/nl-parser.test.ts`**, new describe block `2a. AFLDB-ISSUE-205: three-quarter-time comeback vs
score-checkpoint collision` (10 cases), DB-free, inserted after the existing `2. team queries` block:

1. `adelaide biggest three quarter time comeback` → `grain='team_match'`, `metric='q3_deficit_overcome'`,
   `agg={kind:'max'}`, `scope.clubFor.name='Adelaide'`.
2. `...since 2000` → same + `scope.seasonMin=2000`.
3. `who has the biggest three quarter time comeback for adelaide` → same, trailing-club phrasing.
4. `adelaide three quarter time comeback` (no superlative) → grain/metric still resolve.
5. `adelaide 3qt comeback` → short form (never affected by the collision — no `"time"` word to eat).
6. Negative: `adelaide score at three quarter time` → `scoreCheckpoint='3QT'`, `metric='team_score'`,
   never `q3_deficit_overcome`.
7. Negative: `who was leading at three quarter time` → metric never `q3_deficit_overcome`, regardless of
   how the rest of the question resolves (written defensively — "leading" is an `AGG_WORDS` superlative,
   not a `TEAM_METRIC_WORDS` entry, so this question's exact resolved shape was not independently
   re-derived by static reading; the invariant that matters for this fix is asserted unconditionally).
8. Negative (§5a follow-up): `adelaide score at quarter time` → `scoreCheckpoint='QT'`,
   `metric='team_score'`, proving the `'QT'` entry's new `"three "`-exclusion lookbehind does not disturb
   a genuine, standalone Q1 checkpoint.
9. Negative (§5a follow-up): `who was leading at quarter time` → metric never `q3_deficit_overcome` or a
   hypothetical `q1_deficit_overcome`.
10. Negative (Family B control): `adelaide largest comeback from quarter time` → still declines,
    `status='none'`, `unsupportedTerms` still contains `comeback` — proves the `'QT'` exclusion is scoped
    to `"three "`/`"three-"` only and does not affect Family B's `"comeback from quarter time"` phrasing
    (preceded by `"from "`, not `"three "`).

Cases 1-5 and 6-7 (originally written against the §5-only fix) are what caught the §5a incompleteness —
they were correct expectations from the start; the first operator run's 4 failures were the runtime
still being wrong, not the tests. Cases 8-10 are new, added for the §5a follow-up specifically.

**`tests/integration/nl-answers-team-club.test.ts`**, one DB-backed test inserted after "derives Q3 as
the three-quarter checkpoint minus half-time": ranks `q3_deficit_overcome` via `answerTeamMatch` directly
(bypassing the parser, matching this file's existing convention) and checks the result against an
independently hand-written SQL query over `matches`/`match_period_scores`. Proves `team-match.ts`'s
`q3_deficit_overcome` SQL path is reachable and correct — it had zero live-answer coverage before this
issue.

No Q1 SQL, no Q1 vocab, no `UNANSWERABLE_TOPICS` entry added, per the operator's explicit scope
boundary.

**Operator-run and GREEN** (second validation pass, after the §5a fix):

```text
tests/nl-parser.test.ts:                          446/446 passed
tests/integration/nl-answers-team-club.test.ts:     35/35 passed
npx tsc --noEmit:                                  passed
```

Do not modify the parser/runtime again unless new evidence demands it. `PARSER_VERSION` remains 54.

## 7a. Correction-tool candidacy defect found and fixed (first V4→V5 attempt)

Running the correction script against the real V4 corpus failed closed on:

```text
Row 11819: matches the audited before-state (decline/unsupported_topic)
but its question text matches neither comeback family regex.
Question: "Adelaide highest fantasy score". Refusing to run.
```

This is a real, correctly-triggered abort (no V5 written) but exposes an over-broad candidacy design:
the script gated candidacy on `expected_status==='decline' && expected_failure_reason==='unsupported_topic'`
**first**, and only then classified the surviving rows' question text into Family A/B, treating "matches
neither regex" as an error. `decline`+`unsupported_topic` is an **old-state fact**, not a **target-identity
fact** — the real V4 corpus legitimately carries several other decline/unsupported_topic families sharing
that exact shape (fantasy/SuperCoach, rebound 50s, youngest/oldest, position, averages, subjective
ranking — `UNANSWERABLE_TOPICS`, `src/search/nl/vocab.ts:1542-1600`), and AFLDB-ISSUE-205 must never
inspect any of them as candidates, let alone assert an old-state against them this issue never audited.

**Fix** (`tools/nl/fix-issue-205-comeback-taxonomy.ts`): candidacy is now decided by `classify()` — the
row's own question text against the two family regexes — **before** any old-state field is ever read. A
row neither family regex names is simply not a candidate at all and passes through completely
uninspected (not merely unmodified, and no assertion is made about it). Only a row already identified as
Family A/B by its own text then has its audited old-state (status/failure-reason/blank plan-shape fields)
verified; only a genuine Family A/B row with drift aborts the run. This mirrors the same "identity first,
old-state second" lesson `tools/nl/fix-issue-204-stale-coverage-expectations.ts` reached after its own
first operator run over-matched on category+template alone (AFLDB-ISSUE-204.md §0a) — the signal that
discriminates a real target from a same-shaped sibling must gate candidacy itself, never just filter it
afterward. The distribution self-check was also strengthened to independently prove
`intersection(FamilyA, FamilyB) = 0` (not just the two counts), per the operator's explicit request.

This is **correction-tool-only** — no parser/runtime file touched, no `PARSER_VERSION` change, and it
does not alter §3/§4/§5/§5a's root-cause conclusions in any way. The `q3_deficit_overcome` SQL and parser
fix are proven correct independently of this finding (§5a's integration/parser results).

**New DB-free regression tests**, `tests/nl-issue-205-corpus-fix.test.ts` (15 cases), following
`tests/nl-issue-204-corpus-fix.test.ts`'s established fixture/fake pattern — a synthetic 12,000-row
corpus (7 clubs × 6 Family-A phrasings = 42, 7 clubs × 4 Family-B phrasings = 28) plus 3 unrelated
decline/unsupported_topic siblings (fantasy, rebound-50, youngest), and a fake `ParseEngine` (`{ ctx,
parseNlQuestion }`, keyed by exact question text — no database) standing in for `loadEngine()`'s real
engine:

1. an unrelated fantasy row is ignored (the exact row-11819 regression, reproduced in miniature);
2. an unrelated rebound-50 row is ignored;
3. a Family A row is selected and corrected to the real re-parsed plan shape;
4. a Family B row is selected and corrected to `unsupported_term` only, every other field preserved;
5. a missing Family A target (41 instead of 42) aborts on the aggregate count;
6. a missing Family B target (27 instead of 28) aborts on the aggregate count;
7. a genuine Family A row with drifted `expected_status` aborts;
8. a genuine Family B row with drifted `expected_failure_reason` aborts;
9. every non-target row (filler + all 3 siblings) is left byte-identical;
10. the exact 42/28/70 distribution and 0-non-target-modification invariants;
11. a Family A row whose real re-parsed plan is not a `'plan'` status aborts (runtime-fix-not-active
    guard);
12. a Family B row that unexpectedly re-parses to a plan aborts (Q1-support-added guard);
13. wrong total row count aborts;
14. duplicate id aborts;
15. `assertOutputPathIsSafe` accepts/refuses the `--out === --corpus` case (a single test covering both
    branches, not two).

`correctCorpus()`'s signature was narrowed from the full `loadEngine()` return type to a new exported
`ParseEngine` type (`{ ctx: NlParseContext; parseNlQuestion }`) to make this DB-free testing possible —
`loadEngine()`'s real return value still structurally satisfies it with no cast, so `main()`/the real
corpus run are unaffected.

### First test run: synthetic fixture did not reproduce the audited V4 before-state (test-only, fixed)

Operator result: 4/15 passed, 11 failed, nearly all stopping on the first Family A row:

```text
Row 5000: Family A candidate's audited before-state expects
"expected_grain"="" (blank), found "player_game".
Question: "Adelaide biggest three quarter time comeback".
Refusing to run.
```

**Root cause, confirmed by inspection, is entirely in the test fixture, not `correctCorpus()`.** The
fixture's `declineRow()` helper spread `...baseRow(id)`, and `baseRow()` sets `expected_grain:
'player_game'` (a plausible value for its OWN purpose — a `success`-status filler row) without ever
being overridden back to blank for a decline row. Every synthetic Family A/B row therefore started with
a fabricated plan-shape field a real V4 decline row never carries (the corpus's "blank asserts nothing"
convention — there is no plan until the fixed parser produces one). `correctCorpus()`'s fail-closed
old-state assertion caught this exactly as designed; **this is not a correction-tool or runtime defect,
and no production file was touched.**

Traced precisely why only 4 of 15 passed: the candidacy loop processes rows in ascending id order, and
row 5000 (`FAMILY_A_DEFS[0]`) is the lowest-id target, so any test using the unmodified full fixture threw
on row 5000 before ever reaching its own intended assertion — including the two sibling-ignore tests,
which never got to see their own siblings because the function rejected before the loop ever reached
their higher ids. Only the 4 tests whose failure trigger fires strictly *before* row 5000's blank-grain
check (or that never touch the candidacy loop at all) survived: the input-row-count check, the duplicate-
id check, `assertOutputPathIsSafe` (does not call `correctCorpus` at all), and the "drifted
`expected_status`" test (which corrupts row 5000 itself, so its own intended check fires before the
blank-grain check for that same row). Every other test failed purely because of this one fixture field.

**Fix (test file only):** `declineRow()` now explicitly sets `expected_grain: ''`, overriding
`baseRow()`'s filler default. Every other field `correctCorpus()`'s old-state assertion checks
(`expected_metric`/`expected_aggregation`/`expected_club`/`expected_opponent`/`expected_venue`/
`expected_match_type`) was already correctly blank via `baseRow()` and needed no change.
`verification_level='EXPECTED_DECLINE'` was kept as a reasonable real-V4-consistent value, though
`correctCorpus()` does not actually assert it (not one of the 7 checked fields).

**Not yet re-run** — I cannot execute tests. Exact command: `npx vitest run tests/nl-issue-205-corpus-fix.test.ts`.

**Corpus correction itself has not been re-run against the real V4 file.** Once the new DB-free tests are
green, the next step is the real, DB-backed run (§8 step 4) — still pending.

## 8. Validation sequence

Steps 1-3 are **DONE, GREEN** (§5a). Steps 4-7 are not yet run; run in order, stop and report back at the
first failure rather than proceeding.

```bash
# 1. Focused parser tests (DB-free) -- DONE: 446/446 passed
npx vitest run tests/nl-parser.test.ts

# 2. Integration test (needs AFLDB_TEST_DATABASE_URL) -- DONE: 35/35 passed
npx vitest run tests/integration/nl-answers-team-club.test.ts

# 3. Typecheck -- DONE: passed
npx tsc --noEmit

# 4. NEW -- correction-tool DB-free regression tests (§7a), not yet run
npx vitest run tests/nl-issue-205-corpus-fix.test.ts

# 5. Corpus correction — DB-backed, needs a real DATABASE_URL and
#    --conditions=react-server (see the script's header for why).
#    This is a RE-RUN: the first attempt correctly failed closed on
#    row 11819 (§7a) before the candidacy fix; not yet re-attempted.
npx tsx --conditions=react-server tools/nl/fix-issue-205-comeback-taxonomy.ts \
  --corpus /home/arm/nl-stress-corpus-v4.csv --out /home/arm/nl-stress-corpus-v5.csv

#    Expect exactly:
#      input rows:                12000
#      output rows:               12000
#      target rows expected:      70
#        family A (Q3, expected):   42
#        family B (Q1, expected):   28
#      target rows modified:      70
#      non-target rows modified:  0

# 6. Parser-v54 run against V5 (parse-only or full, matching however
#    the v53/V4 baseline run was taken)
npm run nl:stress -- --corpus ~/nl-stress-corpus-v5.csv --out ~/nl-stress-v54-v5

# 7. Direct V4 -> V5 row-by-row comparison (not the retired
#    nl:stress:compare) -- confirm the changed-id set is exactly the
#    70 audited ids and nothing else moved.
```

**Expected post-correction stable result**, if every step above passes with no surprises: **12000
scored / 12000 clean / 0 soft / 0 failed.** This is reachable because both families' corrections are
scorer-complete: Family A's plan-shape fields (§6) are exactly what the scorer checks for a `SEMANTIC`
success row, and Family B's corrected `unsupported_term` matches the runtime's actual (unchanged, still
correct) decline reason. If step 5 shows any Family A row still soft/failed, or any Family B row not
exactly `unsupported_term`, treat that as new evidence — do not force the corpus green to match a wrong
runtime result.

## 9. Deliverable summary

1. **Exact runtime change:** `src/search/nl/parser.ts`, `extractScoreCheckpoint`'s `'3QT'` entry gains a
   negative lookahead excluding a trailing `comeback(s)` (§5); its `'QT'` entry gains a negative
   lookbehind excluding a checkpoint word directly preceded by `"three "`/`"three-"` (§5a, added after
   the first operator run found the `'3QT'`-only guard incomplete — `'QT'` was still matching the nested
   `"quarter time"` substring inside `"three quarter time comeback"`). Two small, targeted regex changes
   inside the same entry list; no metric regex change, no `'HT'` change, no stage reordering.
2. **Parser version change:** `PARSER_VERSION` 53 → 54 (`src/search/nl/plan.ts`), version-history
   comment added.
3. **Tests added:** 10 parser cases (`tests/nl-parser.test.ts`, 446/446 total suite passed) + 1
   integration case (`tests/integration/nl-answers-team-club.test.ts`, 35/35 passed) + 16 DB-free
   correction-tool cases (`tests/nl-issue-205-corpus-fix.test.ts`, §7a — not yet run).
4. **Parse-only corpus scorer requirement:** plan-shape fields only; verified-answer fields
   (`answerPrimary`/`answerValue`/`tieCount`/`resultCount`) are never required for a `SEMANTIC` row and
   are gated behind `actual.executed` even when supplied. No DB answer values needed or invented (§6).
5. **Exact proposed V4→V5 mutations:**
   - **Family A (42 rows):** `expected_status: decline→success`; `verification_level: →SEMANTIC`;
     `expected_grain: →team_match`; `expected_metric: →q3_deficit_overcome`; `expected_aggregation:
     →max`; `expected_club`/`expected_opponent`/`expected_venue`/`expected_season_from`/
     `expected_season_to`: set from each row's own real re-parsed plan (never hand-guessed — see
     `tools/nl/fix-issue-205-comeback-taxonomy.ts`); `expected_failure_reason`,
     `expected_coverage_behavior`, `expected_min_confidence`: cleared.
   - **Family B (28 rows):** only `expected_failure_reason: unsupported_topic→unsupported_term`. Every
     other field unchanged.
6. **Parser version stays 53 or moves to 54?** Moves to 54 — real runtime behaviour changed (§5).
7. **Proposed worktree/branch:** `sonnet/issue-205-team-match-comeback-parser-defect` (this worktree,
   `D:\dev\afldb-issue-205`, is already on branch `sonnet/issue-205-wrong-failure-reason-audit` — the
   operator may rename or continue on it; the working title in `CLAUDE.md`-tracked docs has been updated
   to reflect the real scope).
8. **Remaining operator commands required:** steps 4-7 of §8's sequence (correction-tool DB-free tests,
   the real V4→V5 correction re-run, the v54-vs-V5 stress run, the direct V4→V5 diff) — steps 1-3 are
   already done and green. None of these I can run myself.

## 10. Risks / edge cases carried forward

- Test 7 (`who was leading at three quarter time`) was written defensively because static reading could
  not fully resolve whether "leading" (an `AGG_WORDS` superlative, not a `TEAM_METRIC_WORDS` entry) plus
  a bare checkpoint with no other metric word produces a `'plan'` or a decline. The test's invariant
  (never `q3_deficit_overcome`) holds either way, but the operator's real run may reveal this phrasing
  needs its own follow-up if it unexpectedly declines — out of this issue's scope, worth a note if seen.
- The correction script's Family A path requires the runtime fix (§5) to already be active in the same
  process — it re-parses every candidate live rather than trusting a hand-derived value. If step 1/2/3
  in §8 are not green first, step 4 will abort informatively rather than writing a wrong V5.
- Family B's disposition (stay declined, relabelled) is a product/scope decision already made by the
  operator for this issue. A future feature issue may revisit Q1/half-time comeback support; this issue
  deliberately does not touch that door.
- I have not swept for other latent `TEAM_METRIC_WORDS`-vs-`extractScoreCheckpoint`/`extractPeriodSplit`/
  `extractBoundary` collisions beyond the comeback path this audit was pointed at — that would be new
  scope.
