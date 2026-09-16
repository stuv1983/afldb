# AFLDB-ISSUE-208 — Club-role ownership: `extractClubs`'s lookback window is not anchored to the nearest preposition

Status: **RESOLVED 2026-09-17** (Sonnet 5, operator-validated on streamanator).
Fix implemented and focused-tested on `sonnet/issue-208-club-role-ownership`
(base `ca17277f` on `main`, unmerged; implementation commit `70b72df`). Parser
version 56. Both required operator checks passed — see "Operator validation"
below.

This is follow-on item (2) of `AFLDB-ISSUE-206.md`'s six proposals, directly from
that issue's final triage of the 29,030-row independent exploratory corpus.

## Defect

`AFLDB-ISSUE-206.md` found 251 exploratory-corpus hard-failure rows split into two
families, both losing the question's subject club:

```text
Family A (134 rows) -- after-siren "to win for CLUB"
  Which player kicked the most behinds after the siren to win for North Melbourne
  between 2005 and 2015
  intended:  clubFor = North Melbourne, clubAgainst = absent
  actual:    clubAgainst = North Melbourne, clubFor = absent

Family B (117 rows) -- leading opponent phrasing
  Against Fremantle, what was Melbourne's largest lead at three quarter time
  since 2000
  intended:  clubFor = Melbourne, clubAgainst = Fremantle
  actual:    clubAgainst = Fremantle, clubFor = absent
```

## Root cause (verified against current source, not assumed from ISSUE-206)

`extractClubs` (`src/search/nl/parser.ts`) decided each club mention's role with:

```ts
const idx = working.toLowerCase().indexOf(match.matchedText);
const before = idx >= 0 ? working.slice(Math.max(0, idx - 20), idx) : '';
governedAgainst: AGAINST_PREPOSITION.test(before)
```

i.e. "does an against-like token (`against`/`versus`/`vs`/`v`/`to`/`over`,
`vocab.ts`'s `AGAINST_PREPOSITION`) exist ANYWHERE in this fixed 20-character
window", not "what is the nearest phrase that actually governs this mention".
Both families trace to that one broad test, verified with a disposable direct-probe
of `extractClubs` before any edit:

**Family A.** In "after the siren **to** win **for** North Melbourne", the word
immediately before the club is "for" (the true governor — `FOR_PREPOSITION`), but
the 20-character window also reached back far enough to contain the earlier,
unrelated "to" (from "to win"). `AGAINST_PREPOSITION.test` cannot distinguish a
governing token from an incidental one at a distance — it only asks whether the
pattern matches anywhere in the slice. The club was wrongly marked
`governedAgainst`, giving `clubAgainst = Club`, `clubFor = undefined`.

**Family B.** `extractClubs` finds and strips club mentions one at a time from a
mutable working copy of the text (`stripMatch`, which also collapses whitespace).
In "**Against** Fremantle, ... what was **Melbourne**'s largest lead ...", once
"Fremantle" was spliced out of the working copy, Melbourne's own 20-character
lookback window shrank enough to newly contain "against" — a word that genuinely
governed the *already-consumed* Fremantle mention, not Melbourne. Melbourne was
wrongly marked `governedAgainst` too. The role-assignment loop then fills
`clubAgainst` from the FIRST `governedAgainst` entry only (Fremantle) and leaves
`clubFor` unset, since there is no longer any un-governed mention left to become
the subject: `clubAgainst = Fremantle`, `clubFor = undefined`.

Both families therefore reconcile to one shared mechanism — a "does this window
contain a token" test standing in for "what is the nearest governing phrase" —
with `working`'s own mutation as the specific reason Family B's window can absorb
an unrelated, already-resolved club's preposition. This independently confirms
`AFLDB-ISSUE-206.md`'s diagnosis rather than taking it on trust.

## Fix

A new helper, `nearestGoverningPreposition(before)` (`parser.ts`, immediately above
`extractClubs`), replaces the window-existence test with a window-**anchored** one:
it strips at most one trailing determiner (`the`/`a`/`an`) from the preceding text,
then checks whether `AGAINST_PREPOSITION` or `FOR_PREPOSITION` matches at the very
END of that text (`` `${source}$` ``) — i.e. whether the preposition is the token
immediately governing the mention, not merely present somewhere earlier in the
window.

`extractClubs` also now computes `before` from the text it was originally handed
(the `text` parameter, via the same `phrasePosition` offset already used elsewhere
in the function for word-order tiebreaking) instead of from the internally mutated
`working` copy. A later club's role decision can therefore no longer be disturbed
by an earlier club having already been spliced out of `working`.

This single change fixes both families in one mechanism:

- Family A: "for" (immediately adjacent to the club) now wins over the more
  distant, no-longer-relevant "to" — the nearest-token check simply never looks
  past the immediate neighbour.
- Family B: the check no longer depends on what `stripMatch` has or hasn't removed
  from `working` yet, because it is evaluated against the original text.

No vocabulary was added, no parser stage was reordered, and the unordered
`scope.matchup` ("A versus B") detection — a separate code path in the same
function, keyed on the literal text found *between* two already-resolved mentions,
not on `governedAgainst` — was not touched.

**Files changed:**

- `src/search/nl/parser.ts` — `nearestGoverningPreposition` helper; `extractClubs`'s
  `governedAgainst` computation now uses it, anchored to the original `text`
  parameter instead of the mutated `working` copy.
- `src/search/nl/plan.ts` — `PARSER_VERSION` 55 → 56, version-history comment.
- `tests/nl-parser.test.ts` — 15 new regression tests (new
  `describe('AFLDB-ISSUE-208: ...')` block, three sub-groups: Family A, Family B,
  controls).

## Scope discipline — one adjacent, structurally similar defect found, documented only

`assignCrossDomainClubs` (`parser.ts`, AFLDB-ISSUE-152 Phase F — deciding which side
of "played ... and also coached ..." a club mention sits on) contains its own
`AGAINST_PREPOSITION.test(scanText.slice(Math.max(0, at - 20), at))` window check,
used to refuse an opponent-governed club (F-D3's "opponent" refusal reason). It has
the same broad "does this window contain a token" shape as the defect fixed here.
It was **not analysed** for the same failure mode and **was not changed** — out of
scope for ISSUE-208, which the runbook limits to `extractClubs`. Flagged here for a
future, separately-scoped look; not opened as a tracked issue (no corpus evidence
was gathered for it, and ISSUE-208's own corpus evidence is specific to
`extractClubs`'s two defect families).

No other adjacent defects were found or fixed. The other ISSUE-206 follow-on items
(numeric operator ownership — already resolved as ISSUE-207; head-to-head "has more
wins"; imperative vocabulary; `after YEAR`; `career_boundary` compiler restriction)
were not touched.

## RED phase evidence

15 new tests were added to `tests/nl-parser.test.ts` under
`describe('AFLDB-ISSUE-208: ...')`:

- **Family A** (4 tests): three defect-reproducing rows ("who kicked the most
  behinds/goals after the siren to win for CLUB [between Y and Z]", "who had the
  most kicks after the siren to win for CLUB") plus one control with an explicit
  opponent alongside "for" (both roles must still resolve).
- **Family B** (3 tests): three defect-reproducing "Against OPPONENT, what was
  SUBJECT's METRIC at CHECKPOINT [since/in YEAR]" rows, using club pairs
  constructed so the longer-aliased club (matched first by `findClub`'s
  longest-match rule) is the OPPONENT and the shorter-aliased SUBJECT club is
  resolved second, against a `working` copy that has already had the opponent
  spliced out — the exact shape that reproduces the mutation-driven window
  shrinkage.
- **Controls** (8 tests): plain `against`/`versus`/`vs`/`v` two-club forms, a
  genuine `to`/`over` opponent governor ("worst loss **to** Carlton", "biggest win
  **over** Carlton" — proving the fix does not disable a truly-adjacent `to`/`over`
  governor), a single ungoverned club defaulting to the subject side ("richmond
  biggest loss"), and a trailing "for" still governing the subject
  ("... comeback **for** Adelaide").

Run against the reverted (pre-fix) `governedAgainst` line
(`AGAINST_PREPOSITION.test(before)` over the old fixed `working`-relative window):

```text
npx vitest run tests/nl-parser.test.ts -t "AFLDB-ISSUE-208"
```

Result: **7 failed / 8 passed** (of the 15 new tests). The 7 failures were exactly
the rows tied to the diagnosed mechanism, every one failing the same way
(`scope.clubFor` came back `undefined` where a named subject club was expected):

- `who kicked the most behinds after the siren to win for Geelong between 2005 and 2015`
- `who kicked the most goals after the siren to win for Carlton`
- `who had the most kicks after the siren to win for Richmond`
- `control: an explicit opponent alongside "for" still resolves both roles correctly`
- `against Collingwood, what was Carlton's largest lead at three quarter time since 2000`
- `against Richmond, what was Carlton's score at half time in 2017`
- `against Collingwood, what was Geelong's largest lead at quarter time`

All 8 controls passed under the unfixed code, exactly as the hand analysis
predicted — none of them exercises the broad-window mechanism. This confirms the
new tests fail for the *diagnosed* reason, not an unrelated one, before any fix was
applied.

The fix was then reapplied and the same targeted run went 15/15.

## Focused test results (this workstation)

Run from a worktree-scoped `npm ci`-restored `node_modules` (this worktree only;
the shared main checkout's `node_modules` was empty, matching the same situation
recorded in `AFLDB-ISSUE-207.md`):

```text
npx vitest run tests/nl-parser.test.ts        -> 472/472 passed
npx vitest run tests/nl-stress-corpus.test.ts -> 53/53 passed
npm run typecheck                             -> clean (next typegen + tsc --noEmit)
```

Additional DB-free adjacent-suite check, run for extra collateral-regression
confidence (not one of the issue's required minimum checks):

```text
npx vitest run tests/nl-plan.test.ts tests/nl-semantic-mapping.test.ts \
  tests/nl-regression-corpus.test.ts tests/nl-audit-acceptance.test.ts \
  tests/query-intent.test.ts
-> 574/574 passed
```

## Operator validation

Both required checks were run on the Linux development host (streamanator, checked
out at commit `70b72df`, `PARSER_VERSION` = 56) and passed.

**1. Frozen V5 stable-regression gate** (parser v56, corpus unchanged):

```text
Corpus: /home/arm/nl-stress-corpus-v5.csv
Run:    /home/arm/nl-stress-v56-v5
Result: 12000 scored / 12000 clean / 0 soft / 0 failed
```

No regression to the stable baseline.

**2. ISSUE-206 exploratory 251-row club-role family recheck.** A direct
structured-plan comparison between the retained pre-fix (v55) and post-fix (v56)
exploratory runs — both 29,030 rows / 29,030 unique IDs
(`/home/arm/nl-exploratory-v55-validation/results.jsonl` vs
`/home/arm/nl-exploratory-v56-validation/results.jsonl`) — found:

```text
changed plans: 251
134 after_siren
117 team_checkpoint_collision
```

exactly matching the two families identified by AFLDB-ISSUE-206, with no other
structured-plan field changed anywhere in the 29,030-row corpus (no collateral
movement).

**Family A — after-siren.** Representative: "Which player kicked the most behinds
after the siren to win for North Melbourne between 2005 and 2015".

```text
Before v56: scope.clubAgainst = North Melbourne, scope.clubFor = absent
After  v56: scope.clubFor = North Melbourne, scope.clubAgainst = absent
```

The incorrect opponent role is removed and the named club is correctly restored as
the subject club.

**Family B — leading opponent checkpoint.** Representative: "Against Fremantle,
what was Melbourne's largest lead at three quarter time since 2000".

```text
Before v56: scope.clubAgainst = Fremantle, scope.clubFor = absent
After  v56: scope.clubAgainst = Fremantle, scope.clubFor = Melbourne
```

The correctly identified opponent is retained while the previously dropped subject
club is restored.

**Aggregate exploratory result.**

```text
Pre-fix  v55: 27530 scored / 1500 audit-required / 10874 clean / 15275 soft / 1381 failed / 97 diagnostic groups
Post-fix v56: 27530 scored / 1500 audit-required / 11125 clean / 15275 soft / 1130 failed / 95 diagnostic groups

Movement: clean +251, soft 0, failed -251
```

This exactly removes the 251 genuine parser hard failures identified during
ISSUE-206. The remaining 1130 hard failures are the already-audited ISSUE-206
corpus/scorer artifacts (496 symmetric-versus corpus-oracle rows, 283
achievement-summary aggregation corpus/scorer rows, 351 Gary Ablett identity scorer
rows) — out of scope for ISSUE-208, not addressed here.

**Resolution:** both required checks confirm the fix produces the intended
club-role reassignment for all 251 known rows with zero collateral movement.
Resolved 2026-09-17. The `assignCrossDomainClubs` out-of-scope finding above
remains open for separate consideration; no ISSUE-209 has been opened for it.
