# AFLDB-ISSUE-210 — Leading imperative/request-wrapper phrasing ("find", "show", "list", "give me") declines otherwise-supported questions

Status: **IMPLEMENTED, PENDING OPERATOR VALIDATION** (Sonnet 5). Fix implemented
and focused-tested on `sonnet/issue-210-imperative-nl-phrasing` (base current
clean `main` after ISSUE-209). Parser version 58. Local test execution and the
required Linux-host (streamanator) validation have **not** been run by this
session — CLAUDE.md's shell-execution boundary reserves running
tests/builds/git for the operator by default, and no explicit override to run
them directly was given. Exact operator commands are listed under "Required
verification" below. Do not close this issue until that validation lands.

This is follow-on item (6) of `AFLDB-ISSUE-206.md`'s six proposals, directly
from that issue's final triage of the 29,030-row independent exploratory
corpus.

## Defect

`AFLDB-ISSUE-206.md` found the dominant soft-decline mechanism in the
exploratory corpus (~10,000+ of the 15,275 soft-decline rows, spanning nearly
every grain family): a leading imperative/request-wrapper verb ("find",
"show", "list", "give me", plus the already-handled "show me"/"tell me")
survived `canonicalise()` as an unmatched leftover token and tripped the
generic unmatched-token decline gate even though grain/metric/scope were
otherwise fully resolvable from the rest of the question. Representative
(from the issue brief, mirroring the corpus's own dominant wording families):

```text
Find the players with the most goals in 2023
Show me Richmond's biggest win
List players with 300 career games
Give me the leading goal kickers for Carlton
```

each of which already has a fully-supported core form with the wrapper
removed.

## Evidence-first inventory

The two retained exploratory artifacts named in the issue brief
(`/home/arm/nl-exploratory-v1.csv`, `/home/arm/nl-exploratory-v57-validation/results.jsonl`)
are **not present on this Windows workstation** — confirmed by direct `ls`
before any implementation work started. Per the issue's own instruction,
counts were **not invented** from the rough "10,000+" estimate; the per-family
row-count inventory (`"find ..." N rows`, `"show ..." N rows`, etc.) requires
an operator run against those retained host artifacts and is listed as
outstanding validation below, not assumed.

What **is** available locally and was used instead is `AFLDB-ISSUE-206.md`
§5 item 1's own source-verified mechanism description (`vocab.ts:63-`
`CONVERSATIONAL_FILLER` not covering bare imperative openers) plus a direct
read of the current vocabulary tables, which is sufficient to design and
implement a narrow, evidence-grounded fix without the row-count breakdown:

- `CONVERSATIONAL_FILLER` (`src/search/nl/vocab.ts:63-85`) already strips
  `show me`, `(please )?tell me`, and `please` **anywhere in the string**
  (unanchored `.replace(filler, ' ')`, global flag) — this is pre-existing,
  shipped behaviour, unrelated to this fix.
- `find`, bare `show` (no "me"), `list`, and `give me` are **not** in
  `CONVERSATIONAL_FILLER`, **not** in `STOPWORDS`, and are not consumed by
  any extraction stage — confirmed by grepping both `vocab.ts` and
  `parser.ts` for `\bfind\b`, `\bshow\b`, `\blist\b`, `\bgive\b` as literal
  word-boundary patterns. The **only** literal-word collision found anywhere
  in the vocabulary is `/\bfind the (?:big )?sticks\b/` (`vocab.ts`, the
  AFL-slang idiom for kicking a goal, mapped to metric `goals`) — the one
  case where "find" is itself part of meaningful domain phrasing rather than
  a request wrapper.

This confirms the issue brief's own severity/scope classification
(product-decision vocabulary gap, not a defect) and identifies the exact
single collision the fix must guard against.

## Product rule applied

Only the four forms the issue brief itself calls "likely safe" are
implemented, exactly as named: leading `find`, leading bare `show`, leading
`list`, leading `give me`. `show me` and `(please )?tell me` are unchanged —
they already work, via the pre-existing `CONVERSATIONAL_FILLER` mechanism.

**Deliberately left unsupported** (per the issue's explicit scope
boundary, "not a general conversational language layer"):

- `tell me about`, `what can you tell me about`, `can you find`, `could you
  show`, `I want` — none of the evidence or parser architecture available
  locally supports these cleanly, and the issue brief explicitly told this
  session not to add them without stronger justification.
- `find me`, `list me` — not named in the issue's own "likely safe" set, and
  no corpus evidence (`find plus`, `find widest`, `find seasonal`, `find
  match`, `find run` per ISSUE-206 §5 item 1) suggests "find me" is a real
  wording family distinct from bare "find". Left out rather than assumed.
- Generic conversational parsing, fuzzy intent inference, spelling
  correction — explicit scope exclusions in the issue brief, untouched.

## Fix

A single anchored regex in `canonicalise()` (`src/search/nl/vocab.ts`),
consumed **at most once**, only at the very start of the string, run after
the existing `CONVERSATIONAL_FILLER` loop (so `please`/`show me`/`tell me`
are already gone by the time it runs) and before
`canonicaliseStatWords()`:

```ts
const LEADING_REQUEST_PREFIX_RE =
  /^(?:give me|find(?!\s+the\s+(?:big\s+)?sticks\b)|show|list)\b\s*/;
```

- **Anchored (`^`), not global** — the defining design choice per the
  issue's "critical scope rule". The same words occurring anywhere other
  than the leading position are never touched; `STOPWORDS`/`AGG_WORDS`/every
  other vocabulary table is unchanged, no extraction stage was reordered,
  and no domain vocabulary was modified.
- **`find`'s negative lookahead** is the one guard the vocabulary audit
  above requires: without it, a leading occurrence of the "find the (big)
  sticks" goals idiom would have "find " consumed as a wrapper, leaving "the
  big sticks" — which matches no vocabulary at all — and the idiom would
  silently stop working. Covered by a dedicated negative-control test (see
  below).
- No change to `STOPWORDS`, `CONVERSATIONAL_FILLER`, `AGG_WORDS`, or any
  other table. No `replace()` calls sprinkled through `parser.ts`.

`PARSER_VERSION` 57 → 58 (`plan.ts`), with a version-history entry recording
the change per the file's existing convention.

### Files changed

- `src/search/nl/vocab.ts` — `LEADING_REQUEST_PREFIX_RE` added; `canonicalise()`
  now applies it after the filler loop, before the stat-word pass.
- `src/search/nl/plan.ts` — `PARSER_VERSION` 57 → 58, version-history comment
  added.
- `tests/nl-parser.test.ts` — new `describe('17. AFLDB-ISSUE-210 imperative/
  request-wrapper phrasing', ...)` block (see RED/GREEN evidence below).

No change to `src/search/nl/parser.ts` or `src/search/nl/semantic-intents.ts`
— the fix is entirely upstream of extraction, in canonicalisation, so no
extraction stage needed touching.

## RED phase

### Coverage diversity (all 7 requested domains)

| # | Wrapper | Domain | Wrapped | Core |
|---|---|---|---|---|
| 1 | `find` | season query (`player_season`, bare year) | `Find the most goals in 2023` | `the most goals in 2023` |
| 2 | `give me` | player ranking, club-scoped season leaderboard (`player_season`) | `Give me the most goals by a richmond player in 2017` | `the most goals by a richmond player in 2017` |
| 3 | `show` (bare) | club result/extrema (`team_match`) | `Show richmond biggest win since 2000` | `richmond biggest win since 2000` |
| 4 | `show me` | club result/extrema (`team_match`) — regression guard for the pre-existing filler entry | `Show me Richmond's biggest win` | `Richmond's biggest win` |
| 5 | `list` | career threshold (`player_career`) | `List players with at least 300 games` | `players with at least 300 games` |
| 6 | `find` | venue/opponent-scoped named-player stat (`player_game`) | `Find dusty total goals against carlton` | `dusty total goals against carlton` |
| 7 | `list` | head-to-head `compare_wins` (ISSUE-209 family) | `List which of Richmond and Carlton has more wins head to head` | `Which of Richmond and Carlton has more wins head to head` |
| 8 | `give me` | records (`coach_record`) | `Give me damien hardwick coaching record` | `damien hardwick coaching record` |

Each pair is asserted with `expect(wrappedPlan).toEqual(corePlan)` — full
structural equality of the `NlQueryPlan` object (grain, metric, agg, scope,
conditions, everything), not merely `status === 'plan'`. Pairs 1 and 2
deliberately leave the leftover "the" a real reader's "the players/most..."
produces after only the wrapper VERB is stripped, in the core form too (the
fix strips exactly one leading word/phrase, never a following determiner),
so the comparison proves the mechanism rather than assuming `"the"` is inert.
Every other pair's wrapper is followed directly by the shared text, so
wrapped-minus-prefix is byte-identical to core after lowercasing.

### Negative controls (derived from real supported grammar, not manufactured nonsense)

- **`find the big sticks` idiom, leading position** — `Find the big sticks
  leader for Richmond` must still resolve `metric: 'goals'`, `agg: {kind:
  'max'}`, `scope.clubFor.name: 'Richmond'`. This is the one real vocabulary
  collision found in the audit above; without the negative lookahead this
  test fails closed (declines) rather than resolving the idiom.
- **Fail-closed, gibberish**: `Show me purple elephant sandwich` must still
  decline (`status: 'none'`, `reason: 'unrecognised'`) — proves wrapper
  consumption cannot rescue nonsense.
- **Fail-closed, recognised-but-unsupported topic**: `Find the youngest
  player ever` must still decline `unanswerable`, identically to the bare
  `youngest player ever` control — proves wrapper consumption cannot bypass
  `UNANSWERABLE_TOPICS`/`validatePlan`.

### RED evidence status

Every pair and control above was traced by hand against the exact current
source (`canonicalise()`'s stage order, `CONVERSATIONAL_FILLER`'s literal
entries, `LEADING_REQUEST_PREFIX_RE`'s literal pattern) and independently
confirmed with a disposable Node one-liner exercising the extracted regex
against all eleven representative strings — every wrapped string reduces to
exactly the predicted remainder, and the `find`-idiom guard leaves
`"find the big sticks leader for richmond"` completely untouched. This
session did **not** execute `npx vitest` against the pre-fix source (the fix
was written in the same pass as the analysis, and CLAUDE.md reserves test
execution for the operator by default) — a literal pre-fix
`npx vitest run tests/nl-parser.test.ts -t "AFLDB-ISSUE-210"` failing for
these exact rows, and passing post-fix, is listed under "Required
verification" and is the actual RED/GREEN evidence this record still needs
before resolution.

## GREEN evidence

**Not yet run.** Exact commands for the operator:

```text
npx vitest run tests/nl-parser.test.ts
npx vitest run tests/nl-semantic-mapping.test.ts
npx vitest run tests/nl-regression-corpus.test.ts
npx vitest run tests/nl-stress-corpus.test.ts
npm run typecheck
```

All five are required by the issue brief; none were run by this session.

## Local collateral findings

- The issue brief's file list named `src/search/nl/normalise.ts` as a
  candidate location. **That file does not exist** in this codebase —
  `src/search/nl/` contains `answer-types.ts, describe.ts, entities.ts,
  feedback-spec.ts, parser.ts, plan.ts, qualifying-matches-gate.ts,
  qualifying-matches-href.ts, review-spec.ts, semantic-intents.ts, vocab.ts`.
  Canonicalisation lives in `vocab.ts`'s `canonicalise()`, which is where the
  fix was made. Not a defect, just a stale filename in the issue brief.
- `show me` and `(please )?tell me` were already fully working before this
  issue (pre-existing `CONVERSATIONAL_FILLER` entries) — they are not new
  coverage added by this fix, only exercised by a regression-guard test
  (pair 4 above) to confirm the new anchored stage doesn't disturb them.

## Required verification (operator, Linux host / streamanator)

1. Local focused suite (five commands listed above under "GREEN evidence").
2. **RED confirmation** (optional but recommended for full rigor): run
   `npx vitest run tests/nl-parser.test.ts -t "AFLDB-ISSUE-210"` against the
   pre-fix `vocab.ts`/`plan.ts` (e.g. via a scoped `git stash push -u -m
   "issue-210-red-baseline"` of just those two files, restored with `git
   stash apply <sha>` per the worktree's shared-stash-stack caution — never
   bare `stash`/`stash pop`), confirming the 8 wrapper-family rows fail and
   the 3 negative-control rows already pass; then restore the fix and rerun
   for GREEN.
3. **Frozen V5 stable-corpus rerun** (`/home/arm/nl-stress-corpus-v5.csv`,
   parser v58) — must stay **12000 scored / 12000 clean / 0 soft / 0
   failed**.
4. **Evidence-first inventory** (still outstanding, per the issue's own
   requirement not to invent counts): against the retained
   `/home/arm/nl-exploratory-v1.csv` and/or
   `/home/arm/nl-exploratory-v57-validation/results.jsonl`, quantify actual
   `"find ..."`, `"show ..."`, `"show me ..."`, `"list ..."`,
   `"give me ..."`, `other` row counts among the soft-decline family, and
   confirm removing only the anchored prefix makes each an already-supported
   core form.
5. **Post-fix exploratory rerun** into `/home/arm/nl-exploratory-v58-validation`
   (parser v58), direct structured-plan diff against the retained
   `/home/arm/nl-exploratory-v57-validation/results.jsonl` baseline:
   - how many plans change;
   - how many soft declines become clean;
   - whether any previously-`failed` row changes;
   - whether any already-`clean` plan's structured fields change (would be a
     regression — must be zero);
   - whether every changed row classifies into an approved wrapper family
     (`find`/`show`/`show me`/`list`/`give me`), with no large unexplained
     `other` bucket — if one appears, stop and investigate before closeout,
     per the issue's own instruction.
6. Expected host output directory for parser v58:
   `/home/arm/nl-stress-v58-v5`.

## Resolution

**Not resolved.** Pending the operator verification above. Do not mark
RESOLVED until Linux-host validation is complete, per the issue brief's
explicit instruction.
