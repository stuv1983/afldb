# AFLDB-ISSUE-215 — `career_numeric_binding` "plus"/"among" phrasing declines with `unsupported_term`

- **Status:** RESOLVED 2026-09-17 (Sonnet 5, operator-validated on streamanator, two host-validation
  rounds). Round 1 (commit `5eca839`, §10) fully cleared `career_numeric_binding/2` and cleared 491 of
  700 `/3` rows to a valid parsed plan; the remaining 209 `/3` rows were a second, residual "plus"
  ownership gap (§11-§12), fixed the same session under the same `PARSER_VERSION` 62 (a correction, not
  a new semantic feature) and confirmed by round 2 (commit `6a341fd`, §16). All 700 `/3` rows now
  produce structurally valid `player_career` plans; the 491 that still decline do so at the legitimate
  `coverage_unavailable` execution boundary (§11), not a parser defect.
- **Worktree:** `sonnet/issue-215-career-numeric-binding-phrasing`, base `origin/main` after AFLDB-ISSUE-214 (`6a224dde`).
- **Baseline:** clean `main` after AFLDB-ISSUE-214, `PARSER_VERSION` 61 → 62.
- **Implementation commits:** `5eca839` ("Fix career numeric binding phrasing"), `6a341fd` ("Complete
  career numeric plus binding").

## 1. Problem, as given

Two large exploratory `career_numeric_binding` clusters, both `review: template_contract`,
`support: supported`, `expected_status: success`:

```text
700 — career_numeric_binding/3
552 — career_numeric_binding/2
-------------------------------
1252 rows
```

Representative `/3` failures (`unsupported_term: find plus`):

```text
For St Kilda, find players with at least 20 finals plus zero goals
For Suns, find players with at least 20 finals plus fewer than 5 losses
For Adelaide, find players with no premierships plus at most 10 Brownlow votes
```

Representative `/2` failures (`unsupported_term: among ...`):

```text
Who has the most career goals among players with at least 200 games and zero goals
Who has the most career games among players with fewer than 5 losses and at most 10 Brownlow votes
Who has the most career clubs among players with exactly 3 premierships and fewer than 5 losses
```

## 2. Scope proof — do the two clusters share one root cause?

Inspected `tools/nl/generate-exploratory-corpus-v2.mjs`'s `career_numeric_binding` generator
(lines ~284-299):

```js
{ name:'career_numeric_binding', n:2000, make() {
  const a=pick(CONDITIONS); let b=pick(CONDITIONS);
  while(b.c.field===a.c.field)b=pick(CONDITIONS);
  const s=pick(CAREER_STATS), c=C(), template=pick([0,1,2,3,4]);
  const clauses=chance(.5)?[a,b]:[b,a];
  const q=[
    words('List players with',clauses[0].q,'and',clauses[1].q),
    words('Players who have',clauses[0].q+',',clauses[1].q),
    words('Who has the most career',s[0],'among players with',clauses[0].q,'and',clauses[1].q),
    words('For',c[0]+',','find players with',clauses[0].q,'plus',clauses[1].q),
    words('Of players with',clauses[0].q,'and',clauses[1].q+',','who has the fewest career',s[0]),
  ][template];
  const e={grain:'player_career', metric:template===2||template===4?s[1]:'',
    aggregation:template===2?'max':template===4?'min':'list', conditions:clauses.map(x=>x.c)};
  if(template===3)e.club=c[1];
  return row('career_numeric_binding',template,q,e,{...});
}}
```

Five templates from one shared pool of two numeric career conditions (`CONDITIONS`, drawn from
`games`/`goals`/`premierships`/`brownlow_votes`/`clubs_played`/`finals`/`losses`). `career_numeric_binding/2`
is template index 2 ("who has the most career `<S>` among players with A and B"); `/3` is template
index 3 ("for `<club>`, find players with A plus B"). Templates 0/1/4 (joined by "and"/comma) already
score clean.

Debug-traced every representative row directly against the current parser (`parseNlQuestion`, DB-free
fixture context) before writing any fix:

- **`/3` (all three representative rows):** both numeric conditions were **already binding correctly**
  — `report.consumed` included every condition's stat word and number for all three rows. The ONLY
  leftover tokens were `"find plus"` / `"find plus"` / `"find plus"` — pure wrapper vocabulary, no
  predicate loss.
- **`/2` (all three representative rows):** two of the three failed on `"among"` alone, with both
  conditions already binding correctly underneath. The **first** representative row
  ("... most career goals among players with at least 200 games and zero goals") additionally lost
  its "zero goals" condition entirely — traced to a second, independent defect (§3).

**Conclusion: `/2` and `/3` do NOT share one single root mechanism.** They share the *same category*
of gap — an unrecognised wrapper word around an otherwise-fully-supported construction ("find"+"plus"
for `/3`, "among" for `/2`) — but `/2` additionally carries a second, independent, more severe defect
that `/3`'s template cannot have at all, because template 3 has no ranked metric (`aggregation: 'list'`,
`metric: ''`) for a stat word to collide with.

## 3. Root cause, verified from current source

### 3a. Wrapper vocabulary (shared category, `/3` and `/2`)

- `src/search/nl/vocab.ts`'s `LEADING_REQUEST_PREFIX_RE` (AFLDB-ISSUE-210) strips a leading
  imperative verb only when it is the very first word of the string. "For Adelaide, find players
  with ..." puts "find" one clause later, behind a leading "for" scope clause — by the time this
  runs, the clause's own comma has already been turned into a space by canonicalise's punctuation
  strip (it runs before either prefix regex), so there is nothing left to anchor a "clause boundary"
  on except the literal word "for" itself.
- Nothing in the vocabulary reads the word "plus" as a conjunction anywhere — `NUMBER_PLUS_RE` matches
  a digit immediately followed by the `+` symbol (`"200+"`), which is unrelated to the English word
  "plus" joining two clauses.
- Nothing reads "among"/"amongst" as belonging to the numeric-binding construction. The one existing
  place "among(st)?" is consumed at all, `CROSS_DOMAIN_CONSUME_RE`, is gated on the unrelated
  played-and-coached cross-domain reading (`coachReading === 'coached_population'`), never on a bare
  numeric-conditions ranking question.

### 3b. Metric/condition collision — predicate loss (`/2` only)

`extractCareerConditions` (`src/search/nl/parser.ts`) resolves, for each pending stat column, the
EARLIEST occurrence of that stat word in the sentence to decide *processing order* (a deliberate
AFLDB-ISSUE-196 fix, documented in the surrounding comment). Before this fix, that same earliest
occurrence was also the ONLY occurrence ever inspected for an adjacent comparator/number: if it had
none, the column was abandoned outright (`if (value === null) continue;` inside the outer
`while (pending.size > 0)` loop, with the stat's entry already removed from `pending`).

A stat word can legitimately occur twice in one question — once naming the ranked subject ("who has
the most career GOALS ...") and again inside its own, later, numeric condition ("... among players
with ... zero GOALS"). For "Who has the most career goals among players with at least 200 games and
zero goals", the pending loop's earliest-occurrence search for `goals` lands on the *ranking* mention
first (no adjacent number there), the column is abandoned, and the true "zero goals" condition later
in the sentence is never examined — silently discarded, not declined. Confirmed independent of the
"among" wrapper gap: the same defect reproduces on "most career goals **with** at least 200 games and
zero goals" (no "among" at all).

Reordering the phrasing so the metric mention comes AFTER the conditions clause (template 4, "of
players with A and B, who has the fewest career S") does not trigger this defect, because the stat
word's earliest occurrence is then the condition's own mention, not the ranking mention — confirmed by
debug trace, not assumed.

## 4. Corpus expectation — verified, not assumed

The generator's `e` object for templates 2 and 3 follows the identical `{grain:'player_career',
conditions:[...]}` shape every other template in the family uses, with `metric`/`aggregation` set
consistently for the ranking templates (2 and 4) and `e.club` set only for the club-scoped template
(3). No generator/scorer defect found. Not touched.

## 5. Implementation

Smallest generic change in each case; no club name, corpus ID, exact metric pair, or sample string
special-cased.

### 5a. `src/search/nl/vocab.ts` — leading request verb behind a leading "for" clause

```ts
const LEADING_FOR_CLAUSE_REQUEST_PREFIX_RE =
  /^(for\s+(?:\S+\s+){1,4})(?:give me|find(?!\s+the\s+(?:big\s+)?sticks\b)|show|list)\b\s*/;
```

Applied in `canonicalise()` immediately after the existing top-anchored strip, replacing the match
with its own captured leading-clause group (`'$1'`) — the clause itself is put back, never deleted, so
whatever it names (a club, in every observed case) still reaches the extraction stage that reads it.
Bounded to 1-4 words after "for", longer than any name in this engine's directories, so it can only
ever reach the length of a real leading scope clause, never an arbitrary run of unrelated text. "for"
is already a generic, recognised club-scoping preposition (`extractClubs` reads it the same way
anywhere else it appears) — not a club name special-cased here.

### 5b. `src/search/nl/parser.ts` — `extractCareerConditions`, "plus" as a second clause boundary

```ts
const lastPlus = priorText.toLowerCase().lastIndexOf(' plus ');
const boundaryEnd = Math.max(
  lastAnd >= 0 ? lastAnd + 5 : -1,
  lastComma >= 0 ? lastComma + 1 : -1,
  lastPlus >= 0 ? lastPlus + 6 : -1,
);
...
const plusBoundarySpan = (lastPlus >= 0 && lastPlus + 6 === boundaryEnd)
  ? { start: outerStart + lastPlus + 1, end: outerStart + lastPlus + 5, text: 'plus' }
  : null;
...
if (value === null) continue;
if (plusBoundarySpan) spans.push(plusBoundarySpan);
```

"plus" is folded into the exact same clause-boundary computation "and"/comma already use for clipping
the numeric-condition lookback window, and its span is queued for removal — but **only pushed into
`spans` after this clause has gone on to bind a real value**. A "plus" in front of a clause that never
binds is left completely alone; the question still declines on its own leftover text (see §8 negative
controls). Deliberately NOT added to the global `STOPWORDS` set: "plus" names nothing else anywhere in
this engine's vocabulary today, and a blanket addition would silently stop flagging it in every other,
unrelated construction too — the per-token `consumed`/span mechanism keeps the consumption scoped to
this one structural position.

### 5c. `src/search/nl/parser.ts` — `extractCareerConditions`, "among players" wrapper

```ts
if (conditions.length > 0 || predicates.length > 0) {
  const amongMatch = /\bamong(?:st)?\b(?=\s+(?:the\s+)?players?\b)/.exec(working);
  if (amongMatch) {
    consumed.push(amongMatch[0]);
    working = stripMatch(working, amongMatch[0]);
  }
}
```

Gated on a condition/predicate having ACTUALLY been found this call — never a bare presence check —
so a genuinely unsupported "among ..." elsewhere is not silently swallowed (§8). The lookahead
consumes only the cue word itself; "players"/"player" is already inert `STOPWORDS` vocabulary and is
left untouched in `working`.

### 5d. `src/search/nl/parser.ts` — `extractCareerConditions`, occurrence retry (predicate loss)

The per-column processing loop now retries successive occurrences of the SAME stat word (never a
different one) until one has an adjacent comparator/number, or none do:

```ts
const occurrenceRe = new RegExp(candidateRe.source, 'g');
let searchFrom = 0;
let bound = false;
while (!bound) {
  occurrenceRe.lastIndex = searchFrom;
  const match = occurrenceRe.exec(working);
  if (!match) break;
  const idx = match.index;
  searchFrom = idx + match[0].length;
  ... // unchanged qualifier/window/value logic, using this occurrence's idx/match
  if (value === null) continue;      // try the NEXT occurrence of this stat word
  ...
  bound = true;
}
```

The `best`-selection logic that picks WHICH stat column to process next (unchanged, still uses each
column's single earliest occurrence for ordering) is untouched — only what happens once a column is
selected changed. A stat word with only one occurrence and no adjacent number ("most flags") still
abandons the column exactly as before (§8 regression control) — the retry finds no second occurrence
and simply exits the inner loop without binding.

## 6. Semantic checks (issue requirements 1-6)

1. `/2` and `/3` are semantically the same numeric-binding OPERATION expressed through different
   wrappers, but NOT the same underlying binding mechanism end-to-end — `/2` has an extra,
   independent predicate-loss defect `/3` cannot exhibit (§2, §3b).
2. `/3`'s failures were wrapper vocabulary only ("find"+"plus"); `/2`'s failures were wrapper
   vocabulary ("among") PLUS, for one of the three representative rows, genuine predicate loss.
3. Yes — confirmed and fixed (§3b, §5d): a numeric predicate was being parsed as far as finding its
   stat word, then silently discarded when that word's earliest occurrence had no adjacent number.
4. No metric misbinding was found (a number never bound to the wrong metric); the defect was pure
   loss, not misassignment — every RED test asserts the exact `careerConditions` array (not
   `toContainEqual`) so a regression that duplicated or misassigned either condition would fail
   loudly.
5. Yes — "zero"-valued phrases (`op: 'eq', value: 0`) already had dedicated handling from
   AFLDB-ISSUE-203 and needed no new special-casing here; they were simply the condition most often
   caught by the collision because `goals` appears in both `CAREER_STATS` (rankable metrics) and
   `CONDITIONS` (bindable columns).
6. Club scope in `/3` is unaffected by ownership semantics — `scope.clubFor` is set exactly as it is
   for every other club-scoped career query; the fix only changes which characters survive
   canonicalisation before club extraction runs, never how a club is matched.

## 7. Parser version

`PARSER_VERSION` 61 → 62 (`src/search/nl/plan.ts`), with a new entry in the existing version-history
comment block above the constant, matching the repository's established convention.

## 8. Tests (`tests/nl-parser.test.ts`), all DB-free

New top-level `describe('19. AFLDB-ISSUE-215 career numeric-binding phrasing ...')` block. The shared
`CLUBS` fixture has Richmond/Carlton/Collingwood/Geelong/Adelaide/Port Adelaide/Greater Western
Sydney/Melbourne/North Melbourne/Sydney/Essendon/Hawthorn — no St Kilda or Gold Coast Suns — so the
issue brief's `St Kilda`/`Suns` wording is represented with `Richmond` (same construction, no
production logic special-cased); `Adelaide` is kept verbatim where the brief already used it.

RED cases (all now GREEN), asserting the exact plan (grain, metric, agg, scope, and the FULL
`careerConditions` array, not just `toContainEqual`):

- `/3`-style: "For Richmond, find players with at least 20 finals plus zero goals"; "For Richmond,
  find players with at least 20 finals plus fewer than 5 losses"; "For Adelaide, find players with no
  premierships plus at most 10 Brownlow votes".
- `/2`-style: "Who has the most career games among players with fewer than 5 losses and at most 10
  Brownlow votes"; "Who has the most career clubs among players with exactly 3 premierships and fewer
  than 5 losses"; and the two metric/condition-collision cases — "Who has the most career goals among
  players with at least 200 games and zero goals" (collision on `goals`) and "Who has the most career
  games among players with at least 200 games and zero goals" (collision on `games`, the other field,
  proving the fix is generic to whichever column collides).

Regression controls:

- Existing `career_numeric_binding` wordings unchanged: "and"-joined (template 0/1), comma-joined
  (template 1), trailing-metric (template 4), a single unconjoined condition, and "most flags"
  (single-occurrence-no-number column still abandons cleanly, proving the occurrence-retry loop
  doesn't invent a spurious match).
- "plus" is not globally ignored: beside a genuinely unsupported clause ("... plus a puppy"), with no
  preceding bound clause at all ("players with plus zero goals"), and entirely outside the
  numeric-binding construction ("richmond biggest win plus their finals record") — all three still
  decline with "plus" (or a phrase containing it) in `unsupportedTerms`.
- "among" is not globally ignored: "most career goals among players" (no numeric condition present at
  all) still declines with `among` in `unsupportedTerms`, proving the `conditions.length > 0` gate.
- bare "find" is not a magic universal filler: "since 2000, find the most goals" (a leading clause with
  no "for" anchor) still declines with `find` in `unsupportedTerms`, proving the fix is specific to a
  leading "for ..." clause, not any leading comma-clause.

## 9. Local verification — complete

This worktree had no installed dependencies (fresh worktree); operator-authorised `npm install` run
this session.

```text
$ npx vitest run tests/nl-parser.test.ts
-> Test Files 1 passed (1), Tests 536 passed (536)

$ npx vitest run tests/nl-regression-corpus.test.ts tests/nl-semantic-mapping.test.ts tests/nl-stress-corpus.test.ts
-> Test Files 3 passed (3), Tests 402 passed (402)

$ npm run typecheck
-> Generating route types... / Types generated successfully; tsc --noEmit clean
```

Broken out by suite:

```text
tests/nl-parser.test.ts:            536/536 passed
tests/nl-regression-corpus.test.ts: 163/163 passed
tests/nl-semantic-mapping.test.ts:  174/174 passed
tests/nl-stress-corpus.test.ts:      65/65 passed
------------------------------------------------
                                    402/402 passed
```

`typecheck`: clean. `PARSER_VERSION` confirmed 62.

## 10. Host validation round 1 (streamanator, commit `5eca839`, `PARSER_VERSION = 62`) — complete

### 10a. Frozen V5

```text
12000 scored
12000 clean
0 soft
0 failed
```

No stable-corpus regression.

### 10b. Exploratory V2

```text
v61: 15925 clean / 11605 soft / 0 failed
v62: 16477 clean / 11053 soft / 0 failed
net: clean +552, soft -552, failed 0
```

### 10c. Target-cluster reconciliation

```text
career_numeric_binding/2: 552 previous unexpected declines -> 0 remaining -> FULLY FIXED
career_numeric_binding/3: 700 previous unsupported_term declines ->
  491 coverage_unavailable
  209 unsupported_term: plus
  0 clean so far
```

### 10d. Direct plan comparison

```text
v61 rows: 29030, v62 rows: 29030, missing: 0, changed plans: 1043
552 (/2) + 491 (/3, now reaching a plan that then fails validatePlan) = 1043
```

The remaining 209 `/3` rows stay `plan: null` in both versions, so they never enter the plan diff at
all — consistent with a parser-level decline (§16), not an execution-level one.

## 11. Follow-up investigation: 491 `/3` rows now `coverage_unavailable`

### 11a. The exact guard

`src/search/nl/plan.ts`'s `validatePlan`, `raw.grain === 'player_career' && raw.scope.clubFor` branch
(~line 2366):

```ts
if (raw.grain === 'player_career' && raw.scope.clubFor && raw.careerPredicates.length === 0) {
  const def = raw.metric ? NL_METRICS.player_career[raw.metric] : undefined;
  const scopedGamesConditions = raw.metric === null
    && raw.careerConditions.length > 0
    && raw.careerConditions.every((condition) => condition.kind === 'column' && condition.column === 'games');
  const scopedRankedMetric = raw.metric !== null
    && (raw.metric === 'games' || (def?.kind === 'column' && !!def.statKey));
  if (!scopedGamesConditions && !scopedRankedMetric) {
    return { error: 'This career statistic cannot currently be totalled for one club.' };
  }
  ...
}
```

`tools/nl/v2-runner.ts`'s `observe()` maps any `validatePlan` `{error}` result to
`failureReason: 'coverage_unavailable'` — the plan itself parsed correctly (confirmed by the host
output's own plan dumps: `grain`/`agg`/`scope.clubFor`/`careerConditions` are all exactly right), but
is refused before it ever reaches SQL.

### 11b. Rationale, verified against the SQL compiler

`src/db/queries/nl/player-career.ts`'s `conditionSql` special-cases a per-club value for exactly ONE
column:

```ts
if (cond.column === 'games' && plan.scope.clubFor) {
  return sql`${clubAppearanceCount(plan.scope.clubFor.organizationId)} ${op} ${cond.value}`;
}
const column = sql.unsafe(NL_CAREER_COLUMNS[cond.column]);
return sql`${column} ${op} ${cond.value}`;
```

Every other condition column falls through to `NL_CAREER_COLUMNS[cond.column]` — a precomputed
**whole-career** total (`c.finals`, `c.premierships`, `c.goals`, `c.losses`, `c.brownlow_votes`, ...),
never scoped to the named club. `career_numeric_binding/3` always has exactly TWO DISTINCT condition
fields (the generator explicitly excludes picking the same field twice) and `metric: ''`
(`aggregation: 'list'`) — so `scopedGamesConditions` (requires EVERY condition to be `games`) can
**never** be true for two distinct fields, and `scopedRankedMetric` can never be true either
(`raw.metric` is always `null`). **Every parseable `/3` row with a club scope structurally fails this
guard, unconditionally, regardless of which two fields were picked** — confirmed by the host numbers:
491 = every row that reached a plan at all (700 − 209 still-declining-in-parsing rows).

The guard's own surrounding comment cites its origin directly: AFLDB-ISSUE-110 finding B — a
club-scoped career plan that silently used the whole-career total while claiming to answer a
club-scoped question (the exact SQL shape `conditionSql` would otherwise emit here). This guard exists
specifically to fail closed rather than repeat that defect.

### 11c. A genuine, separate asymmetry (found, not fixed)

`goals` (unlike `finals`/`premierships`/`losses`/`brownlow_votes`/`clubs_played`) DOES carry a
`statKey` in `NL_METRICS.player_career` (`plan.ts` line 1069:
`columnMetric('goals', 'Goals', 'c.goals', 'goals')`), and `metricValueExpr` (the RANKED-metric value
expression, same file, lines 76-87) already proves a correct per-club SQL shape for it:

```ts
if (plan.scope.clubFor) {
  ...
  if (def.statKey) {
    return sql`(SELECT sum(pms.${sql.unsafe(def.statKey)})::int
                  FROM player_match_stats pms JOIN clubs pcl ON pcl.id = pms.club_id
                 WHERE pms.player_id = p.id AND pcl.organization_id = ${organizationId})`;
  }
}
```

`conditionSql` never reuses this pattern for a CONDITION's threshold — only for the ranked `metric`.
So even the one CONDITIONS-pool combination that is, in principle, fully answerable with EXISTING data
and an EXISTING proven SQL shape (`games` + `goals` together) currently fails the same guard, because
(a) the guard's `scopedGamesConditions` branch requires every condition to be `games`, not "every
condition is club-scopable", and (b) `conditionSql` has no club-scoped path for `goals` to fall back on
even if the guard allowed it.

### 11d. Classification

**(1) Legitimate coverage limitation** for all 491 rows as currently executable, **not** a parser
defect, **not** an overly broad guard for the specific field combinations these rows use. Reasoning:

- Every `/3` row necessarily uses two DISTINCT fields from `{games, goals, premierships,
  brownlow_votes, clubs_played, finals, losses}`. Of those seven, only `games` (via
  `clubAppearanceCount`) and `goals` (via a live per-match sum, proven for the metric path but not
  reused for conditions) have ANY per-club SQL shape anywhere in this codebase. The other five
  (`premierships`, `brownlow_votes`, `clubs_played`, `finals`, `losses`) are precomputed whole-career
  facts with no live per-match join built for "did this happen while at club X" — building one (e.g. a
  `clubAppearanceCount`-style `count(DISTINCT match) WHERE is_finals_series AND club = X` for finals)
  is plausible future work, but does not exist today.
- Even the ONE combination that is fully answerable today with proven SQL patterns (`games` + `goals`)
  currently fails, because `conditionSql` doesn't reuse `metricValueExpr`'s existing per-club-sum shape
  for a condition threshold — a genuine, narrow, **separate** gap, flagged in §11c and **not fixed
  here**: it requires new SQL in `conditionSql` (a `player-career.ts` change, not a parser change), is
  outside this issue's charter (parser wrapper-vocabulary ownership), and per the runbook's explicit
  instruction not to weaken the guard without first proving it wrong for the cases it actually blocks.
  This one combination is a minority even of the 491 (`games`+`goals` is 1 of the
  `C(7,2) = 21` possible unordered field pairs).
- The guard fails CLOSED with an honest, specific message ("This career statistic cannot currently be
  totalled for one club") rather than silently answering with the whole-career total dressed up as a
  club total — exactly the ISSUE-110 finding B failure mode it was built to prevent. Removing or
  weakening it would reintroduce a silent-wrong-answer defect for a real, current data/execution gap.
- The exploratory corpus's oracle marks every `career_numeric_binding/3` row `expected_status:
  success` unconditionally, without distinguishing which field pairs are actually club-scopable today
  — a genuine corpus/execution-semantics mismatch in the SENSE that the oracle doesn't yet model this
  distinction, but per the runbook's explicit instruction **the generator/scorer is not modified here**
  to "make the result green"; this is recorded as an observation only (§14).

**Not fixed, not touched:** `validatePlan`'s guard, `conditionSql`, `metricValueExpr`. No corpus
generator/scorer file touched.

## 12. Follow-up correction: 209 residual `/3` "plus" ownership rows — FIXED

### 12a. Root cause A — boundary lookback too short

`extractCareerConditions`'s clause-boundary search (finding "and"/","/"plus" at all, to know where the
current clause's own value-search window should start) was clipped to the SAME fixed 20-character
lookback the value search itself uses (`outerStart = idx - 20`). "no more than " alone is 13
characters; together with "plus " (5) and a number (up to 4 digits + a space), the true boundary could
sit more than 20 characters back from the stat word — invisible to `lastIndexOf`, not merely unmatched.
Confirmed by debug trace: "For Port Adelaide, find players with exactly 3 premierships plus no more
than 250 games" bound both conditions correctly but left "plus" as the sole leftover token, with
`report.consumed` showing no `plus` entry at all.

### 12b. Root cause B — the negative-condition loop never looks for a neighbouring "plus"

`extractCareerConditions`'s `negativeTargets` loop (the "no X"/"never X"/"without X" zero-condition
matcher, which runs BEFORE the numeric pending-stat loop) matches and strips only the "no X" phrase
itself, with no knowledge of a "plus" immediately touching it on either side. For "For Sydney, find
players with more than 50 goals plus no premierships", the loop found and stripped "no premierships"
cleanly but left the preceding "plus" completely untouched — the pending-stat loop's own boundary
search (which DOES look for "plus") never runs for this clause, because it was never a pending-stat
match at all (it went through the negative-condition path instead).

Both are the SAME `/3` "plus" ownership mechanism §5b targeted, exposed by combinations the three
original representative rows didn't happen to construct — confirmed, not assumed, by reproducing all
three host examples locally before making any change (RED), then verifying each turns GREEN after each
fix independently (root cause A alone fixed the "Port Adelaide" example; root cause B was still needed
for the other two).

### 12c. Fix, both in `src/search/nl/parser.ts`, `extractCareerConditions`

**A.** The boundary search now uses its own, wider probe span (`boundaryProbeStart`, 40 characters —
comfortably larger than the longest `COMPARE_OP_WORDS` phrase, `"no greater than"`, plus a 4-digit
number and the joining word), separate from the value-search `outerStart` (unchanged at 20 characters).
`lastIndexOf` still returns the NEAREST boundary within the wider span, so this can only reveal a real
boundary that was previously invisible — it can never reach past the nearest one into an earlier,
unrelated clause (proven by a new three-clause regression control, §13).

**B.** The `negativeTargets` loop now checks the text immediately before (and, for symmetry, after) its
own match for a lone `plus`, and folds it into the same removed span — but ONLY once its own "no X"
clause has actually matched (the identical "only once it binds" discipline §5b's original fix uses). A
TRAILING "plus" after a negative clause needs no new handling: that ordering leaves "plus" in front of
the SECOND (pending-loop) clause instead, already covered by the pending loop's own boundary search
(proven by the pre-existing, still-passing "no premierships plus at most 10 Brownlow votes" case).

No metric combination, club name, or sample string is special-cased in either fix; both are keyed on
generic textual structure (comparator-phrase length, "no X" match adjacency).

### 12d. RED tests added (before the fix; confirmed to fail against the pre-fix source, then pass after)

New `describe` block in `tests/nl-parser.test.ts`, nested in the existing "19. AFLDB-ISSUE-215 ..."
suite: the three host examples verbatim (club names already in the shared `CLUBS` fixture — Sydney,
Port Adelaide; `Fremantle` substituted with `Essendon`, not in the fixture), each asserting the full
`careerConditions` array. Plus a new negative-control regression proving the widened boundary probe
still finds the NEAREST boundary in a three-clause sentence ("and" then "plus"), not a farther one.

## 13. Local verification after the follow-up correction — complete

```text
$ npx vitest run tests/nl-parser.test.ts
-> Test Files 1 passed (1), Tests 540 passed (540)

$ npx vitest run tests/nl-regression-corpus.test.ts tests/nl-semantic-mapping.test.ts tests/nl-stress-corpus.test.ts
-> Test Files 3 passed (3), Tests 402 passed (402)

$ npm run typecheck
-> Generating route types... / Types generated successfully; tsc --noEmit clean
```

`PARSER_VERSION` confirmed still 62 (a correction to the same version, not a new semantic feature, per
this session's explicit instruction).

## 14. Guardrails honoured

No club name, corpus ID, exact metric/condition pair, or sample string special-cased in
`parser.ts`/`vocab.ts` (test-file club substitutions are fixture-availability choices only). "plus"
and "among" are NOT added to `STOPWORDS` or any other blanket-ignore list — both remain gated to the
specific supported construction, with regression controls proving they still surface as
`unsupported_term` outside it (§8, §12d). "find" is only additionally stripped behind a literal leading
"for ..." clause, never any leading clause generically. No unrelated NL family touched. Exploratory V2
generator/scorer untouched — corpus expectation verified correct, not changed (§4); the
`career_numeric_binding/3` oracle's unconditional `expected_status: success` across all field pairs was
found to not yet distinguish club-scopable from non-club-scopable combinations (§11d), but this is
recorded as an observation only, not corrected, per the runbook's explicit instruction not to modify
the generator/scorer to make the result green. `validatePlan`'s club-scoped-career-condition guard
(§11a) was investigated and NOT weakened or removed — classified a legitimate current coverage
limitation (§11d), with the SQL-level evidence (§11b, §11c) recorded for a future issue rather than
acted on here.

## 15. Residual, permanent future-work candidate (not a parser defect, not fixed here)

**491 `coverage_unavailable` rows (§11), confirmed unchanged and final by round 2 (§16):** classified a
legitimate, currently-real coverage limitation — `conditionSql`
(`src/db/queries/nl/player-career.ts`) has no per-club SQL path for any condition column except
`games`, and does not reuse the per-club sum shape `metricValueExpr` already proves for `goals` as a
ranked metric. Building either (a genuine per-club query for
`finals`/`premierships`/`losses`/`brownlow_votes`/`clubs_played`, or reusing the existing `goals`
per-club pattern for a condition threshold) is real future SQL-compiler work, explicitly out of this
issue's parser-ownership charter, and **not attempted in this issue**. Recorded here as a follow-up
candidate only; no new tracked issue opened.

A non-corpus phrasing probed during investigation — "most career `<S>` **with** `<conditions>`" (no
"players"/"among" at all) — hits a separate, pre-existing, unrelated scope guard ("that condition is a
career-wide fact and cannot also be limited to this question's other scope") once both conditions
correctly bind. This is NOT a `career_numeric_binding` corpus construction (every real template uses
"players with"), is unaffected by this issue's fix either way, and is left untouched.

## 16. Host validation round 2 (streamanator, commit `6a341fd`, `PARSER_VERSION = 62`) — complete

### 16a. Frozen V5

```text
12000 scored
12000 clean
0 soft
0 failed
```

No stable-corpus regression, second confirmation.

### 16b. Exploratory V2

```text
16477 clean
11053 soft
0 failed
1500 audit-required
```

Aggregate unchanged from round 1 (§10b) — expected, not a null result: the 209 corrected rows moved
`unsupported_term` (a soft-decline classification) → a valid parsed plan → `coverage_unavailable` (also
a soft-decline classification). Both are `soft`, so the aggregate clean/soft counts do not move; the
row-level plan diff (§17) is what proves the correction actually took effect.

### 16c. Final target-family triage

```text
career_numeric_binding/2: 0 remaining
career_numeric_binding/3: 700 coverage_unavailable, 0 unsupported_term
```

All 700 `/3` rows now reach a structurally valid `player_career` plan (grain, scope.clubFor, and both
`careerConditions` all correct — confirmed by the host's own plan dumps for representative rows,
including the four new examples in the round-2 request: "For Sydney, find players with more than 50
goals plus no premierships", "For Port Adelaide, find players with exactly 3 premierships plus no more
than 250 games", "For Fremantle, find players with no more than 250 games plus no premierships", "For
Dogs, find players with zero goals plus no premierships", "For Brisbane Lions, find players with more
than 50 goals plus at least three clubs"); each then legitimately declines at the `coverage_unavailable`
execution boundary documented in §11.

## 17. Round-1 → round-2 direct plan reconciliation

```text
/home/arm/nl-exploratory-v2-v62-validation/results.jsonl (round 1, commit 5eca839)
vs
/home/arm/nl-exploratory-v2-v62-r2/results.jsonl (round 2, commit 6a341fd)

round 1 rows: 29030
round 2 rows: 29030
missing: 0
changed plans: 209
```

The 209 changed rows are exactly the former `/3` `unsupported_term: plus` cases — moving from
`plan: null` (declined in parsing) to a real, structurally correct plan (which then meets the
`coverage_unavailable` guard, §11) — with zero unrelated movement anywhere else in the 29,030-row
corpus. Structured diff saved as `/home/arm/issue-215-v62-r1-r2-plan-diff.json`.

## 18. Final ISSUE-215 accounting

```text
career_numeric_binding/2: 552 parser failures -> 0 (clean)
career_numeric_binding/3: 700 parser failures -> 700 valid parsed plans
  491 became valid plans in round 1 (commit 5eca839)
  209 became valid plans in round 2 (commit 6a341fd)
```

Of the 700 `/3` plans, all reach the same legitimate `coverage_unavailable` execution-coverage boundary
(§11, §15) — a pre-existing, unrelated SQL-compiler limitation this issue's charter is parser ownership,
not execution coverage, and does not extend to.

Overall exploratory V2 clean improvement attributable to this issue: **+552 clean, -552 soft, 0 hard
regression** (round 1, §10b; unchanged by round 2, §16b, as expected — see §16b). Separately, and not
reflected in the clean/soft aggregate because both are `soft` classifications: **209 rows corrected from
`unsupported_term` (a parser-ownership decline) to a valid-plan `coverage_unavailable` (an
execution-coverage decline)** — a real fix, proven by the row-level plan diff in §17, not visible in the
top-line aggregate.

## 19. Resolution

**RESOLVED 2026-09-17.** All required outcomes met:

- `career_numeric_binding/2` fully fixed (552 → 0, §10c, confirmed unchanged by §16c);
- `career_numeric_binding/3` wrapper-vocabulary and "plus" ownership parsing fully fixed — all 700 rows
  now produce structurally valid plans (491 in round 1, §10c; 209 in round 2 via the follow-up
  correction, §12, §17);
- the repeated-stat-occurrence predicate-loss defect is fixed (§3b, §5d, §6);
- the remaining `/3` declines (700 of 700, at the `coverage_unavailable` boundary) are confirmed
  legitimate execution-coverage limitations, not parser defects (§11, §15);
- `PARSER_VERSION` bumped exactly once, 61 → 62 (§7); the round-2 follow-up is a correction under the
  same version, not a second bump;
- final local verification: `tests/nl-parser.test.ts` 540/540 (§13); broader regression 402/402 (§13);
  `typecheck` clean (§13);
- frozen V5 stayed 12000 scored / 12000 clean / 0 soft / 0 failed across both host-validation rounds
  (§10a, §16a) — no stable-corpus regression;
- exploratory V2 hard failures remained 0 throughout (§10b, §16b);
- round-1 direct plan comparison reconciled exactly 1043 changed plans (552 + 491), 0 missing (§10d);
- round-2 direct plan comparison reconciled exactly 209 additional changed plans, 0 missing, zero
  unrelated movement (§17).

See `issues.md` and `CHANGELOG.md` for the retained ledger/user-facing summary.
