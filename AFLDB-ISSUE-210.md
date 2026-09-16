# AFLDB-ISSUE-210 — Leading imperative/request-wrapper phrasing ("find", "show", "list", "give me") declines otherwise-supported questions

Status: **RESOLVED 2026-09-17** (Sonnet 5, operator-validated on streamanator).
Fix implemented and focused-tested on `sonnet/issue-210-imperative-nl-phrasing`
(base current clean `main` after ISSUE-209; implementation commit `8324d2a`).
Parser version 58. Both required operator checks passed — see "Local GREEN
validation" and "Host validation" below.

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
`"find the big sticks leader for richmond"` completely untouched.

## Local GREEN validation

Worktree-local dependencies installed with `npm ci`. Full focused set:

```text
tests/nl-parser.test.ts             483/483
tests/nl-regression-corpus.test.ts  163/163
tests/nl-semantic-mapping.test.ts   174/174
tests/nl-stress-corpus.test.ts       53/53

Total: 873/873 passed
```

`npm run typecheck` (`next typegen` + `tsc --noEmit`): clean.

The ISSUE-210-specific describe block (the 8 wrapper/core pairs plus the 3
negative controls from "RED phase" above): **11/11 passed**.

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

## Host validation (streamanator, commit `8324d2a`, `PARSER_VERSION` 58)

### Frozen V5

`/home/arm/nl-stress-corpus-v5.csv`: **12000 scored / 12000 clean / 0 soft /
0 failed**. No regression.

### Exploratory v57 → v58

Pre-fix baseline `/home/arm/nl-exploratory-v57-validation/results.jsonl`,
post-fix `/home/arm/nl-exploratory-v58-validation/results.jsonl` — both
29,030 rows / 29,030 unique IDs.

Aggregate scorer totals:

```text
v57: 11151 clean / 15249 soft / 1130 failed / 1500 audit-required
v58: 12439 clean / 13913 soft / 1178 failed / 1500 audit-required
```

Diagnostic groups: 93.

### Structured-plan diff

Direct v57 → v58 comparison: **1408 changed plans**. Wrapper-family
distribution of every changed row:

```text
663 find
378 list
367 show
  0 other
```

No unrelated wording family changed. `give me` produced zero exploratory
changed-plan rows — the generated corpus's own templates evidently don't
happen to use that wrapper; coverage for it rests on the focused tests (RED
phase pair 2 and pair 8 above), which do exercise it directly.

### Full 1408-row reconciliation

**1288 rows, `soft_fail` → `clean`** (663 `find` + 319 `show` + 306 `list`):
the direct usability improvement — a semantically empty request wrapper is
now consumed before parsing the already-supported core query underneath it.

**48 rows, `soft_fail` → `fail`** — all `prefix: show`,
`category: player_game_single`, and all the pre-existing Gary Ablett
identity-scoring artifact already named in `AFLDB-ISSUE-206.md`'s triage (26
`WRONG_PLAYER: Gary Ablett Snr -> Gary Ablett`, 22
`WRONG_PLAYER: Gary Ablett Jnr -> Gary Ablett`). Consuming the leading `show`
now lets the parser reach a valid `player_game` plan that a leftover `show`
previously blocked outright; the exploratory scorer then compares the
expected suffixed display label ("Gary Ablett Snr"/"Gary Ablett Jnr")
against the shared canonical display name ("Gary Ablett") the resolver
correctly returns for the distinct underlying player ID — a pre-existing
scorer/oracle limitation exposed by newly-increased reachability, not a v58
parser regression, and not fixed here per the issue's explicit instruction
not to touch parser behaviour further.

**72 rows, audit-required `decline` → `success`** — all
`List sons of <PLAYER> with <career condition>`, category
`relationship_conditions`, expected corpus status `audit`. v57 declined
(`status: decline`, `plan: null`); v58 now produces a typed `player_career`
plan (`agg: list`, `relationshipSubject` = the named player,
`careerPredicates: [son_of_player(<id>)]`, the requested `careerConditions`
preserved). Representative: `List sons of Patrick Dangerfield with zero
goals` → `relationshipSubject = Patrick Dangerfield`,
`careerPredicates = son_of_player(10244)`, `careerConditions = [goals eq
0]`. These are genuinely newly-reachable, correctly-typed relationship
plans — the wrapper was the only thing blocking them — but they remain
audit-required by corpus design (`relationship_conditions` composition
ownership is intentionally manually audited per `AFLDB-ISSUE-206.md` §6),
so they are not reclassified as scored successes here, and exploratory V1
was not modified.

### Interpretation

```text
1408 changed plans
1288 soft_fail -> clean
  48 soft_fail -> fail   (pre-existing Gary Ablett scorer artifact, exposed not caused)
  72 audit decline -> success   (valid new plans, still intentionally manual-audit)
```

No query family outside `find`/`show`/`list` (and the already-working
`show me`, unchanged) moved at all.

## Resolution

**RESOLVED 2026-09-17.** Both required checks (frozen V5, direct exploratory
structured-plan diff) confirmed the fix: 1288 genuine soft-decline-to-clean
usability improvements, zero unrelated wording-family movement, and both of
the two non-improvement buckets (48 rows, 72 rows) traced to pre-existing,
already-documented corpus/scorer conditions rather than new defects. Known
carried-forward, out-of-scope findings (not fixed here, not newly introduced
by this issue):

- The Gary Ablett Jnr/Snr canonical-display-name scorer artifact
  (`AFLDB-ISSUE-206.md`), now additionally visible on 48 `show`-wrapped
  `player_game_single` rows because those rows are newly reachable at all.
- `relationship_conditions` composition (`List sons of X with Y`) remains
  intentionally audit-required by corpus design; this issue made 72 more
  such rows reachable as typed plans but did not change their audit status.

`PARSER_VERSION` 57 → 58, exactly once. Full record above; no further
parser, test, or corpus changes were made during closeout.
