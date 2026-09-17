# AFLDB-ISSUE-215 — `career_numeric_binding` "plus"/"among" phrasing declines with `unsupported_term`

- **Status:** IMPLEMENTED, NOT YET RESOLVED. Awaiting operator host validation on streamanator.
- **Worktree:** `sonnet/issue-215-career-numeric-binding-phrasing`, base `origin/main` after AFLDB-ISSUE-214 (`6a224dde`).
- **Baseline:** clean `main` after AFLDB-ISSUE-214, `PARSER_VERSION` 61 → 62.

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

## 10. Host validation (streamanator) — PENDING

Not yet run. Recommended commands, matching the frozen-corpus contract this issue's runbook
specifies:

```text
/home/arm/nl-stress-corpus-v5.csv       -- frozen V5 stable, must stay 12000/12000/0/0
/home/arm/nl-exploratory-v2.csv         -- exploratory V2, current baseline under v61:
                                            29030 input / 27530 scored / 15925 clean /
                                            11605 soft / 0 failed / 1500 audit-required
```

Expected to establish, per the runbook's requirements — none promised in advance:

- how many `career_numeric_binding/2` rows move (552 targeted; the collision sub-case is a MINORITY
  of `/2` — only rows where the randomly-picked ranked metric's field coincides with one of the two
  randomly-picked condition fields, roughly 2/11 of `/2` rows by construction, not all 552 need the
  §5d fix specifically to clear, but the "among" wrapper fix alone should clear the rest);
- how many `career_numeric_binding/3` rows move (700 targeted, wrapper-vocabulary-only);
- whether any residual subcluster remains in either template;
- whether any unrelated plan changes anywhere in the 29,030-row corpus (a direct v61-vs-v62 plan
  comparison, matching the pattern used for every prior issue in this series);
- no new hard failures.

## 11. Guardrails honoured

No club name, corpus ID, exact metric/condition pair, or sample string special-cased in
`parser.ts`/`vocab.ts` (test-file club substitutions are fixture-availability choices only). "plus"
and "among" are NOT added to `STOPWORDS` or any other blanket-ignore list — both remain gated to the
specific supported construction, with regression controls proving they still surface as
`unsupported_term` outside it (§8). "find" is only additionally stripped behind a literal leading
"for ..." clause, never any leading clause generically. No unrelated NL family touched. Exploratory
V2 generator/scorer untouched — corpus expectation verified correct, not changed (§4).

## 12. Residual subcases deliberately left out of this closeout

- The exact proportion of `/2`'s 552 rows that hit the §3b metric/condition collision specifically
  (versus the "among" wrapper gap alone) is not counted locally — this worktree has no access to the
  real 29,030-row corpus, only the six representative rows and additional hand-built probes. Host
  validation (§10) will give the real split.
- A non-corpus phrasing probed during investigation — "most career `<S>` **with** `<conditions>`" (no
  "players"/"among" at all) — hits a separate, pre-existing, unrelated scope guard ("that condition is
  a career-wide fact and cannot also be limited to this question's other scope") once both conditions
  correctly bind. This is NOT a `career_numeric_binding` corpus construction (every real template uses
  "players with"), is unaffected by this issue's fix either way, and is left untouched.

## 13. Resolution

**NOT YET RESOLVED.** Implementation complete and locally verified (§9); awaiting operator host
validation (§10) before this issue can close per the runbook's explicit instruction to keep status at
"IMPLEMENTED, NOT YET RESOLVED" until then. `CHANGELOG.md` resolution entry intentionally not yet
added, per the same instruction.
