# AFLDB-ISSUE-209 — Head-to-head "has more wins" wording answered with a generic record instead of naming the leader

Status: **RESOLVED 2026-09-17** (Sonnet 5, operator-validated on streamanator).
Fix implemented and focused-tested on `sonnet/issue-209-head-to-head-more-wins`
(base current clean `main` after ISSUE-208; implementation commit `f2e067f`).
Parser version 57. Both required operator checks passed — see "Operator
validation" below.

This is follow-on item (3) of `AFLDB-ISSUE-206.md`'s six proposals, directly
from that issue's final triage of the 29,030-row independent exploratory
corpus.

## Defect

`AFLDB-ISSUE-206.md` found 173 exploratory-corpus rows that scored `clean`
(the scorer does not assert the head-to-head answer kind) but carried the
wrong answer shape:

```text
Which of Dogs and Geelong has more wins head to head in 2023
  intended:  headToHead.kind = compare_wins
  actual:    headToHead.kind = record
```

The parser identified both clubs and the head-to-head scope correctly — the
`record` answer is not numerically wrong, it carries both clubs' true
win/loss/draw counts — but it does not directly answer "which one has more
wins", the question actually asked.

## Root cause (verified against current source, not assumed from ISSUE-206)

`extractHeadToHeadCue` (`src/search/nl/semantic-intents.ts`) tries a fixed
list of `[pattern, kind]` families in array order and returns on the first
match:

```ts
[/\b(?:who has|who'?s|who|which team has) won more\b/, 'compare_wins'],
[/\bhead[- ]to[- ]head(?:\s+(?:record|between))?\b/, 'record'],
...
```

The `compare_wins` entry recognized only past-tense "won more" wording. It
does not match present-tense "**has more wins** ... head to head", so the
loop fell through to the generic `head[- ]to[- ]head` pattern, which matches
unconditionally on any "head to head" mention regardless of the comparison
wording preceding it.

`extractHeadToHeadCue` runs before `extractClubs` (`parser.ts`), and both
`compare_wins`/`record` only commit to the plan once real two-club
resolution succeeds afterwards (`matchup` or `clubFor`+`clubAgainst`);
otherwise the cue is restored as a leftover token and the confidence gate
declines. This is the existing safety net that keeps a lone "most wins"
ranking question (no second club) from ever being mis-read as a comparison.

### Wording distribution of the actual 173-row corpus family

`tools/nl/generate-exploratory-corpus.mjs`'s `head_to_head` family (`n:900`,
line 362) generates exactly four templates via `pick([0,1,2,3])`; template
index 2 is the entire source of this defect family:

```js
words('Which of',a[0],'and',b[0],'has more wins head to head',t.q)
```

i.e. **100% of the 173 rows are the single literal wording** "Which of A and
B has more wins head to head" with an optional trailing temporal clause
(`t.q`, e.g. "in 2023", "between 2005 and 2015"). No "has the most wins"
variant, "between A and B" variant (without "head to head"), or "against the
other" variant exists anywhere in the actual corpus — those are illustrative
extensions from the issue brief's "Product semantics" section, not
corpus-derived evidence, and were investigated separately below.

## Fix

Two changes to `extractHeadToHeadCue`'s family list, both checked before the
generic `head to head`/`record` families so an unambiguous two-club win
comparison always wins over the generic record reading:

```ts
[/\b(?:who has|who'?s|who|which team has) won more(?:\s+head[- ]to[- ]head)?\b/, 'compare_wins'],
[/\b(?:has|have)\s+(?:more|the most)\s+wins\s+head[- ]to[- ]head\b/, 'compare_wins'],
```

1. A new pattern for "has/have (more|the most) wins head to head" — the
   exact wording of the 173-row corpus family (`more`), plus `the most` as
   the same structurally-bound comparison (still exactly two clubs), which
   the issue's own product semantics explicitly asked for.
2. The pre-existing "won more" pattern now also optionally absorbs a
   trailing "head to head" ("which team has won more head to head, Carlton
   or Richmond") — found not to reach `compare_wins` either during the RED
   pass, for a related but distinct reason (see RED evidence below).

Neither pattern's match spans the club-name tokens (matching the existing
patterns' own discipline), so `extractClubs` still resolves the two real
clubs from the surrounding text afterwards; the comparison only ever commits
once that two-club resolution succeeds.

### Investigated and deliberately NOT added

The issue brief's illustrative examples also included "has more wins
**between** A and B" and "has more wins **against the other**". Both were
added to the RED test matrix first, and both failed via a **different
mechanism** than the corpus defect: they never reach
`extractHeadToHeadCue`'s family list at all. `extractClubSeasonMetric`
(`parser.ts`, `CLUB_SEASON_METRIC_WORDS`) recognizes bare "wins" as a
club_season ranking metric ("most wins in a season") and its cue-presence
check (`clubSeasonCuePresent`, `parser.ts` around line 2701) claims the
question first, so it declines as an unsupported club_season composition
rather than falling through to the generic head-to-head record cue the way
the corpus family does. Fixing that would mean changing
`extractClubSeasonMetric`'s cue-ownership logic — a different subsystem, and
not the "smallest correct fix" for this issue, and not represented anywhere
in the actual 173-row corpus. Left undone; documented here as an adjacent
finding, not opened as its own issue (no corpus evidence of real-world
frequency gathered).

`PARSER_VERSION` 56 → 57 (`plan.ts`). No broad parser-stage reorder, no
club-name special cases, no unrelated vocabulary expansion.

## RED evidence

Regression tests added to `tests/nl-semantic-mapping.test.ts` under a new
`AFLDB-ISSUE-209:` `it.each` block, using varied club pairs (not just
Richmond/Carlton) to prove the fix is a structural pattern.

Initial RED run (before test-matrix reconciliation): **177 tests, 168
passed, 9 failed** — 8 of the 9 new `AFLDB-ISSUE-209` comparison rows plus
one proposed generic-record control.

That first RED design exposed two proposed assertions that were not valid,
requiring the test matrix to be reconciled before proceeding to
implementation:

- `Which team has more wins between Collingwood and North Melbourne` and
  `Which team has more wins against the other, Richmond or Carlton` failed
  via `extractClubSeasonMetric`'s decline path (see "Investigated and
  deliberately NOT added" above), not the corpus defect's `record` fallback
  — removed from the test matrix rather than used to justify broadening the
  fix into that subsystem.
- `Show the head-to-head record between Richmond and Carlton` was proposed
  as an already-supported generic-record control but was itself unsupported
  pre-fix (`unsupportedTerms = ["show between"]`) — removed rather than
  used to justify expanding parser behaviour unrelated to this issue.
- `Which team has won more head to head, Carlton or Richmond?` was proposed
  as an already-supported control but was also found unsupported pre-fix:
  the existing "won more" cue consumed "won more" and left "head to head"
  behind as an unconsumed leftover token, causing a decline. Judged the
  same underlying atomic-consumption defect as the corpus family (one
  regex, one file, zero interaction with other patterns) and folded into
  the fix rather than treated as a separate, unrelated bug.

Final RED run (matrix reconciled to 7 rows — the corpus wording family plus
the folded-in "won more head to head" fix, minus the two removed
club_season-path cases): **8 of 9 comparison rows failed** for the exact
predicted reason (`headToHead.kind: record` instead of `compare_wins`, or a
decline for the "won more head to head" case), 1 already-passing control
("Who has won more, Carlton or Richmond?").

## GREEN evidence

```text
tests/nl-semantic-mapping.test.ts   174/174 passed
tests/nl-parser.test.ts             472/472 passed
tests/nl-describe.test.ts            89/89 passed
tests/nl-stress-corpus.test.ts       53/53 passed
total                                788/788 passed

npm run typecheck: clean (next typegen + tsc --noEmit, 0 errors)
```

All `AFLDB-ISSUE-209` tests pass; all pre-existing head-to-head tests
(record, draw_count, last_draw, the pre-existing "won more" compare_wins
rows) remain green — zero regressions.

## Operator validation (streamanator, commit `f2e067f`, `PARSER_VERSION` 57)

**Frozen V5 stable-corpus rerun** (`/home/arm/nl-stress-corpus-v5.csv`):
**12000 scored / 12000 clean / 0 soft / 0 failed** — no regression.

**ISSUE-206 exploratory corpus, direct structured-plan diff** between the
retained pre-fix (v56, `/home/arm/nl-exploratory-v56-validation/results.jsonl`)
and post-fix (v57, `/home/arm/nl-exploratory-v57-validation/results.jsonl`)
runs, both 29,030 rows / 29,030 unique IDs: **199 changed plans**, every one
in the same wording family ("has more wins head to head"), zero collateral
movement in any unrelated intent family.

- **173 rows** (the direct ISSUE-206 estimate): `headToHead.kind: record ->
  compare_wins`, no other field changed.
- **26 additional rows**, a subset of the 199 also containing a trailing
  `between YEAR and YEAR` clause: same `headToHead.kind: record ->
  compare_wins` movement, **plus** a second, mechanically-linked correction.
  Under v56, because "wins" was never atomically consumed by a head-to-head
  cue, it was left as a bare noun for `extractHavingClause`'s grouped-result
  logic to find; on these rows it wrongly bound the trailing year range as a
  grouped wins threshold (`seasonMin=2005, seasonMax=2005, havingClause:
  {metric: wins, op: gte, value: 2015}` for "... head to head between 2005
  and 2015"). Under v57, the new pattern consumes "has more wins head to
  head" as one unit — "wins" is no longer a dangling noun — so
  `extractHavingClause` never fires and `extractSeasons`/`BETWEEN_RE`
  captures the year range cleanly (`seasonMin=2005, seasonMax=2015,
  havingClause: absent`). This is a direct side effect of the same
  one-pattern fix (atomic ownership of "wins"), not a second, independently
  implemented correction — `extractHavingClause`/`extractMatchFilter` were
  not touched.

**Independent classification of the 26-row subset:** `between-year-range:
26, other: 0` — confirms all 26 are the same date-range mechanism, none are
an unrelated movement.

**199 vs 173 — why the corpus family is larger than ISSUE-206's estimate:**
ISSUE-206's triage counted rows by their `headToHead.kind` field alone (its
own field-level check for this cluster). That correctly found all 199 rows
with the intent defect, but reported the count as "173" from an earlier,
narrower pass that had not yet separated the `between YEAR and YEAR`
subset's *additional* `havingClause` corruption from the primary
`headToHead.kind` defect — both defects share one root cause (the
comparative phrase not atomically owning "wins") and one fix, but they are
two distinct malformed-field symptoms on the same 26 rows. The validated
affected surface for this issue is **199 rows**, not 173; ISSUE-206's figure
undercounted by exactly the 26-row date-range subset.

**Exploratory scorer movement:**

```text
v56: 27530 scored / 1500 audit-required / 11125 clean / 15275 soft / 1130 failed
v57: 27530 scored / 1500 audit-required / 11151 clean / 15249 soft / 1130 failed
movement: clean +26, soft -26, failed 0
```

The 173 primary rows remain scorer-`clean` in both runs (the scorer does not
assert `headToHead.kind`, as ISSUE-206 already established). The 26
date-range rows moved from `soft` to `clean` because the incorrect `wins >=
2015` grouped-threshold reading, and the truncated `seasonMax`, both
disappeared.

## Resolution

Both required operator checks (frozen V5, direct exploratory structured-plan
diff) confirmed the fix with zero collateral movement outside the "has more
wins head to head" wording family. Resolved 2026-09-17. Known out-of-scope,
undisturbed finding: `extractClubSeasonMetric`'s "most wins" club_season
ranking cue claims "has more wins between A and B" / "has more wins against
the other" before `extractHeadToHeadCue` ever sees them; not fixed, not
opened as its own issue (no corpus evidence of real-world frequency
gathered).
