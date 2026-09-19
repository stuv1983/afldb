# AFLDB-ISSUE-195 — Approved Runbook

## Status / objective
- **Status:** Planned 2026-09-16 (Sonnet 5 High, plan mode, worktree
  `sonnet/issue-195-plan`, from main `414efea`). Not implemented.
- **Objective:** "teams that won the premiership and the wooden spoon" must plan a `club_season`
  question carrying **both** the premiership (`premier`) and wooden-spoon (`wooden_spoon`)
  conditions, never a plan that silently keeps only one of them. More generally: once
  `club_season` grain is elected with a club/team subject, a semantic word consumed elsewhere in
  the question but never read by the elected `club_season` plan fields must cause a decline, not a
  silent drop.
- **Recommended implementer:** Sonnet 5, High effort, normal mode, fresh session, from a new
  worktree/branch off main once this plan's branch reaches main (or continued directly in this
  worktree if the operator chooses to implement here).
- **Do not combine with AFLDB-ISSUE-194 or AFLDB-ISSUE-196.** Distinct mechanisms, distinct
  sub-areas of the same file; keep the diffs separable (ISSUE-196 already shipped, unmerged, ahead
  of this plan on `parser.ts`/`plan.ts` — re-check line numbers at implementation time).

---

## 1. Confirmed root cause (verified against current code, main `414efea`, `PARSER_VERSION` 47)

Traced by hand, not re-quoted from the Stage 2 audit note.

For `"teams that won the premiership and the wooden spoon"`:

1. **`clubSubjectPreCue`** (`parser.ts:1829`, tested against `normalised` before any extractor
   runs) is `true` — the sentence leads with `"teams "`, matching `CLUB_SUBJECT_CUE`
   (`vocab.ts:937`).
2. **Step 10, `extractCareerConditions`** (`parser.ts:1016-1218`, called at `parser.ts:2495-2499`):
   `premierships?|flags?` (`CAREER_STAT_WORDS`, `parser.ts:954`) is tried, but no number/comparator
   sits near "premiership" in this sentence, so the numeric loop's `value === null` branch
   (`parser.ts:1195`) `continue`s **without stripping the word**. "premiership" survives intact in
   `working`/`text`.
3. **Step 10.5, `extractClubSeasonConditions`** (`parser.ts:1228-1240`, called at
   `parser.ts:2536`): iterates `CLUB_SEASON_CONDITION_WORDS` (`vocab.ts:540-549`). The `premier`
   entry is `/\bpremiers?\b|\bpremiership (?:team|side)\b|\bwon the flag\b/` (`vocab.ts:546`) —
   `\bpremiers?\b` requires a word boundary immediately after "premier"/"premiers"; "premiership"
   continues with "-ship" so that boundary never occurs, and neither of the other two alternatives
   matches "won the premiership" either. **No match.** Only `wooden_spoon` is recognised
   (`/\bwooden spoon\b/`, `vocab.ts:541`) and stripped. `clubSeasonConditionResult.conditions =
   [{ kind: 'wooden_spoon' }]`.
4. **Step 11, bare `CAREER_STAT_WORDS` ranking-subject fallback** (`parser.ts:2627-2636`): runs
   because `playerMetricResult.metric` and `teamMetricResult.metric` are both still unset. Scans
   `CAREER_STAT_WORDS` in **fixed array order** (not sentence order — that only applies inside
   `extractCareerConditions`'s own loop, per AFLDB-ISSUE-196; this is a *different* loop that reuses
   the same constant). The first entry, `/\bpremierships?\b|\bflags?\b/`, matches the surviving bare
   "premiership" and wins immediately (`break` at `parser.ts:2634`).
   `playerMetricResult = { metric: 'premierships', ... }`. The word is stripped from `text` and
   pushed onto `consumedTokens` (`parser.ts:2633`) — it now counts as "consumed" for confidence
   purposes even though no field of the eventual plan will ever read it.
5. **Grain election** (`parser.ts:2867-2869`):
   `clubSeasonCuePresent && !player` is true (the cue is true independently, via
   `clubSubjectPresent`, and doubly true via `clubSeasonConditionResult.conditions.length > 0`), so
   `grain = 'club_season'`, `metric = clubSeasonMetricResult.metric ?? null` — `null`, since no
   `wins/losses/draws/percentage` word is present. **`playerMetricResult.metric` is never read on
   this branch, or anywhere else once `grain === 'club_season'`** (confirmed: no reference to
   `playerMetricResult` appears anywhere in the `club_season` plan-assembly path,
   `parser.ts:3479-3621`). The stray `'premierships'` value is now permanently unreachable.
6. **R2/R3 guards** (`parser.ts:3230-3246`, AFLDB-ISSUE-189): R2 requires
   `metric === null && clubSeasonConditionResult.conditions.length === 0` — false here
   (`conditions.length === 1`). R3 requires `metric !== null` — false here (`metric === null`).
   Neither fires.
7. **`validatePlan`** (`plan.ts`) never sees `playerMetricResult` at all — it is a parser-local
   variable, not a field of the raw plan object passed to it. There is no vantage point inside
   `plan.ts` from which this defect is visible; any guard must live in `parser.ts`, before plan
   assembly.
8. Result: `status: 'plan'`, `grain: 'club_season'`, `metric: null`,
   `clubSeasonConditions: [{ kind: 'wooden_spoon' }]`, `agg: { kind: 'list' }` (the conditions-only
   default), confidence 1 — the premiership half of the question is gone with no trace in the plan
   and no decline.

This matches the issue's own root-cause description exactly, now confirmed against the specific
line numbers and mechanisms at `414efea`.

---

## 2. Semantic decision and rationale

**Decision: Option B — vocabulary fix (natural "won the premiership" wording, subject-gated) plus
a narrowly-scoped club-season ownership guard.** Option A alone (vocabulary-only) is verified below
to fix the confirmed trigger, but is proven insufficient by itself: the exact same drop mechanism
(§1 steps 4-5) reproduces for **any** word `CAREER_STAT_WORDS` recognises that
`CLUB_SEASON_CONDITION_WORDS`/`CLUB_SEASON_METRIC_WORDS` do not yet cover, not only premiership
wording — traced concretely for bare "finals" below. Option C (source-side suppression in the
generic fallback) and Option D (blanket fail-closed) are both rejected in favour of the narrower
combination. Each is addressed in turn.

### 2.1 Why the vocabulary gap is real and where it sits

`CLUB_SEASON_CONDITION_WORDS`'s `premier` entry covers `premiers?`, `premiership (?:team|side)`,
`won the flag` — but not `won the premiership`, the most natural way a reader actually phrases the
club-season condition ("premiership" the noun of the achievement, "premiers" the noun for the
team). This is a genuine, narrow vocabulary gap, not a structural defect by itself.

**Verified: adding the missing wording, alone, fixes the confirmed trigger.** Step 10.5
(`extractClubSeasonConditions`) runs *before* step 11 (the bare-fallback loop that stole
"premiership" in §1 step 4). If step 10.5's vocabulary is extended to recognise "won the
premiership", it claims and strips the word before step 11 ever sees it — step 11 then finds
nothing left to steal, `playerMetricResult.metric` stays unset for this sentence, and the plan
carries `clubSeasonConditions: [wooden_spoon, premier]` with no guard needed at all for this
specific trigger. Traced by hand against the full extraction order in §1; not assumed.

### 2.2 Why vocabulary-only (Option A) is not sufficient on its own

The issue explicitly requires proof that no other consumed-but-unowned path remains in this family
before stopping at vocabulary-only. There is one, demonstrated by hand-tracing a **different**
`CAREER_STAT_WORDS` word through the identical mechanism:

`"teams that played the finals and won the wooden spoon"` — "played the finals" matches neither the
existing `made_finals`/`missed_finals` `CLUB_SEASON_CONDITION_WORDS` entries (`vocab.ts:547-548`,
which require "made/make/makes/making/qualified for/reached", not "played") nor any
`CLUB_SEASON_METRIC_WORDS` entry. It survives to step 11's bare-fallback loop, which matches
`/\bfinals?\b/` (the *second* entry in `CAREER_STAT_WORDS`, `parser.ts:955`) and sets
`playerMetricResult.metric = 'finals'`. `clubSeasonConditionResult.conditions = [wooden_spoon]`
(from the correctly-recognised wooden-spoon clause). Grain election elects `club_season` exactly as
in §1 step 5, `metric` stays `null`, R2/R3 do not fire (`conditions.length === 1`), and the plan
would silently answer "teams that won the wooden spoon" — the "played the finals" half vanishes
with no trace, the same failure shape as the confirmed trigger, under different vocabulary. There
is no bound on how many `CAREER_STAT_WORDS` entries (`goals`, `games`, `wins`, `losses`, `draws`,
`brownlow_medals`, `brownlow_votes`, and `finals` itself in unqualified form) could hit this same
mechanism for some future phrasing this planning pass has not anticipated. Vocabulary-only leaves
this structurally open.

### 2.3 The ownership guard: narrowest reliable signal, and why it does not break existing behaviour

**Signal chosen:** once grain resolves to `'club_season'`, `playerMetricResult.metric` is
**never read by any `club_season` plan field** (§1 step 5 — confirmed, not assumed, by grepping
every reference to `playerMetricResult` in the `club_season` branch and the entire plan-assembly
tail). Therefore **any** non-null `playerMetricResult.metric` surviving to grain election, once
`grain === 'club_season'`, represents a word the parser recognised as meaningful but the elected
grain cannot represent — the exact "consumed but unowned" signal the issue asks for, and it
requires no new intermediate state, no confidence-architecture change, and no new vocabulary list.

**Critical carve-out, found by tracing existing passing tests, not invented defensively:**
`playerMetricResult.metric === 'clubs_played'` must be **excluded** from the guard. Reason,
confirmed against current code and multiple *currently passing* tests:
`CAREER_STAT_WORDS`'s `clubs_played` entry is `/\bclubs?\b/` (`parser.ts:956`) — the literal word
"club"/"clubs". In a `club_season` question whose subject noun is itself "club(s)" (not "team(s)"),
that subject noun is not consumed by anything before step 11 unless the sentence also contains the
literal word "with" (`AGG_WORDS`'s `/\b(?:players?|teams?|clubs?) with\b/`, `vocab.ts:168`, the only
existing stripper of a bare subject noun). Hand-traced against four *currently green*
`tests/nl-parser.test.ts` cases that would regress under a naive "any non-null metric" guard:
  - `'which clubs won the wooden spoon'` (`tests/nl-parser.test.ts:709-714`) — "club" left in
    `text` after "wooden spoon" is stripped; step 11 matches `clubs?` and sets
    `playerMetricResult.metric = 'clubs_played'`.
  - `'which club had the most losses in 2017'` (`tests/nl-parser.test.ts:694-700`) — same
    mechanism; "club" (singular, from the interrogative "which club") is the leftover.
  - `'clubs that made finals'` / `'clubs that missed finals'`
    (`tests/nl-parser.test.ts:540-550`) — "clubs" leftover after the made/missed-finals phrase is
    stripped.
  In every one of these, the "second semantic" the naive guard would think it found is just the
  question's own subject noun re-matching its own `CAREER_STAT_WORDS` entry — never a genuine
  second request. A guard without this carve-out would turn four currently-correct, currently-green
  plans into false declines. `clubs_played` is the *only* `CAREER_STAT_WORDS` column whose bare
  word (no attached number — a genuine "N clubs" condition is already claimed by
  `extractCareerConditions` at step 10, before step 11 ever runs) can also be the subject noun of a
  club-season question; no other column shares this property, so the carve-out is exactly this one
  value, not a broader category.

**Guard condition (final form):**
```
grain === 'club_season' && playerMetricResult.metric && playerMetricResult.metric !== 'clubs_played'
```
placed after the existing R2/R3 blocks (so R2/R3's more specific messages take priority when they
also apply — they are not mutually exclusive with this guard in general, only in the two required
trigger cases, where R2 already declines first) and before the AFLDB-ISSUE-187 guard.

**Why it will not break the cases the issue asks to protect (traced, not assumed):**
- **Valid `club_season` metric rankings** ("which team has the most wins in a season"): `wins` is
  claimed by `clubSeasonMetricResult` at step 10.5 (`parser.ts:2557-2562`, gated on
  `clubSeasonCuePresent`) *before* step 11 runs, so it is already stripped from `text` and step 11's
  fallback never sees it. `playerMetricResult.metric` stays unset. No interaction with the guard.
- **Valid conditions-only `club_season` lists** ("teams that won the wooden spoon", "clubs that
  made/missed finals", "which clubs won the wooden spoon"): covered by the `clubs_played`
  carve-out above; no other `CAREER_STAT_WORDS` word is left over in any of these phrasings.
- **Player-career premiership queries** ("which player has the most premierships", "players who
  have won 3 premierships", "richmond players who have won 3 premierships"): none of these has a
  leading/interrogative team/club/side subject, so `clubSubjectPresent` is `false` and
  `clubSeasonConditionResult.conditions` stays empty from vocabulary alone; `clubSeasonCuePresent`
  requires `clubSubjectPresent || conditions.length > 0 || (clubFor && …)`, all false here, so grain
  never reaches `club_season` for these questions at all — the guard's `grain === 'club_season'`
  precondition is never true, so it cannot fire. (This is also why the new "won the premiership"
  vocabulary, gated the same way — see §2.4 — cannot manufacture a false `club_season` cue for a
  player-subject sentence: gating on `clubSubjectPresent` and the guard's own precondition are two
  independent, mutually reinforcing protections.)
- **Team-result HAVING queries**: `grain` resolves to `team_match` (`parser.ts:2864-2866`), not
  `club_season`, whenever `havingResult.havingClause || teamMetricResult.metric` — checked *before*
  the `club_season` branch in the same `if`/`else if` chain (`parser.ts:2800-2869`), so these never
  reach the guard's precondition either.
- **AFLDB-ISSUE-189's R2/R3 fail-closed declines**: unaffected — both run before the new guard and
  return first when they apply (§2.3's placement note); traced concretely for
  `'which club has won the most premierships'` and `'teams with more than 5 premierships'` in §5.

### 2.4 Vocabulary addition: subject-gated, not added to the always-tried list

The new "won the premiership" wording is **not** added to `CLUB_SEASON_CONDITION_WORDS` itself
(the always-tried list, whose existing entries are deliberately idiomatic/team-only —
"premiers", "premiership team/side", "won the flag" are not natural ways to describe a single
player's achievement). "won the premiership" **is** a completely natural way to describe a single
player's achievement ("Dustin Martin won the premiership with Richmond in 2017"), so adding it
unconditionally would risk exactly the misrouting the issue's acceptance criteria forbid for a
bare, number-less player-subject phrasing (not itself in the required matrix, but a foreseeable
regression given how central "premiership" is to AFL discourse — materially more likely than the
existing, untested "won the flag" idiom). It is therefore added as a **second, gated** entry, tried
by `extractClubSeasonConditions` only when `clubSubjectPresent` (`parser.ts:2489`, already computed
and in scope before the step-10.5 call site at `parser.ts:2536`) is `true`. All five required-matrix
phrasings that need this wording (`"teams that won the premiership…"`, `"teams that won the
premiership"`) have a literal leading "teams", so `clubSubjectPresent` is `true` for every one of
them — the gate blocks nothing the matrix requires.

### 2.5 Rejected alternatives

**Option A, vocabulary-only — rejected as insufficient alone**, per §2.2: it fixes the confirmed
trigger but leaves the identical mechanism open for every other `CAREER_STAT_WORDS` word not yet
covered by `CLUB_SEASON_CONDITION_WORDS`/`CLUB_SEASON_METRIC_WORDS` (concretely demonstrated for
bare "finals"). Still implemented as *part* of the combined fix (Option B), because it is the
correct, minimal representation of the confirmed trigger's specific wording gap and the guard alone
would only decline the trigger, not answer it faithfully as the issue's acceptance criteria prefer
("preserve both requested semantics... or explicitly decline").

**Option C, change generic metric-extraction ownership/order — rejected.** Suppressing step 11's
bare `CAREER_STAT_WORDS` fallback whenever a club subject/club-season cue is present would need to
special-case exactly which `CAREER_STAT_WORDS` columns are "club-season-relevant enough to suppress"
without a corresponding club-season representation to route to — which is precisely the ownership
question the guard already answers declaratively, but done implicitly inside a shared fallback loop
that seven other grains also depend on (`parser.ts:2888` onward reads `playerMetricResult.metric`
for `player_game`/`player_season`/`player_career`). Silently suppressing a match there risks
starving those other grains of a metric they legitimately need whenever a club subject cue
*happens* to be present alongside a genuine player-scoped question (e.g. a hypothetical "Richmond's
most premierships-winning player" style phrasing near `clubFor`), which is a materially larger,
harder-to-verify blast radius than a narrow post-hoc guard checked only once grain has already
committed to `club_season`. Also creates an ordering dependency between grain election (which runs
after step 11) and metric extraction (step 11 itself) that does not exist today — extraction would
need to know the eventual grain before grain election has run. Rejected in favour of the guard,
which checks the already-elected `grain` after the fact and touches no other grain's path.

**Option D, blanket fail-closed on any mixed owned/unowned semantics — rejected as broader than
necessary.** The issue's own framing warns against inventing a generic "consumed-token ownership"
framework. The guard adopted here is already the narrowest form of Option D that the evidence
supports: scoped to exactly one grain (`club_season`), exactly one already-computed variable
(`playerMetricResult.metric`), with exactly one evidence-based carve-out (`clubs_played`). It is not
a general framework — it does not touch `careerConditions`, `teamMetricResult`, `clubSeasonMetricResult`,
or any other grain's plan assembly. No broader architecture issue is being opened; this guard's
scope is judged sufficient for the family the issue describes (club-season conjunctions where a
second, currently-unrepresented semantic is silently dropped by the bare ranking-subject fallback).

---

## 3. Exact files/functions to change

1. **`src/search/nl/vocab.ts`**
   - **Line 546** (inside `CLUB_SEASON_CONDITION_WORDS`, `vocab.ts:540-549`): widen the existing
     `premier` entry to accept the plural team/side form (needed for matrix item 4, "premiership
     teams that won the wooden spoon" — `\bteam\b`/`\bside\b` do not match inside "teams"/"sides"
     because there is no word boundary before the trailing "s"):
     ```
     // before:
     [/\bpremiers?\b|\bpremiership (?:team|side)\b|\bwon the flag\b/, 'premier'],
     // after:
     [/\bpremiers?\b|\bpremiership (?:team|side)s?\b|\bwon the flag\b/, 'premier'],
     ```
   - **After line 549** (immediately following the `CLUB_SEASON_CONDITION_WORDS` array, before the
     `METRIC_WORDS` block that currently starts at line 551): add the new gated export, with a
     doc comment explaining why it is separate from the array above (per §2.4/§2.3):
     ```ts
     /**
      * AFLDB-ISSUE-195: "won the premiership"/"won a premiership" name the same
      * club-season is_premier column as the unambiguous phrases in
      * CLUB_SEASON_CONDITION_WORDS above, but unlike "premiers"/"premiership
      * team(s)/side(s)"/"won the flag" this phrasing is also completely natural
      * PLAYER-subject English ("Dusty won the premiership with Richmond in
      * 2017"). Tried ONLY when an independent club/team subject cue
      * (clubSubjectPresent, computed before this extractor runs and unaffected
      * by whether this phrase itself matches) is already present -- never on
      * the strength of this phrase alone. See extractClubSeasonConditions's
      * `subjectGated` parameter in parser.ts.
      */
     export const CLUB_SEASON_PREMIERSHIP_SUBJECT_GATED: [RegExp, 'premier'] =
       [/\bwon (?:the |a )?premiership\b/, 'premier'];
     ```

2. **`src/search/nl/parser.ts`**
   - **Line 64** (import list): add `CLUB_SEASON_PREMIERSHIP_SUBJECT_GATED` alongside
     `CLUB_SEASON_CONDITION_WORDS`.
   - **`extractClubSeasonConditions`, `parser.ts:1228-1240`**: add a `subjectGated: boolean`
     parameter and use it to conditionally extend the tried-words list:
     ```ts
     function extractClubSeasonConditions(
       text: string,
       subjectGated: boolean,
     ): { text: string; conditions: NlClubSeasonCondition[]; consumed: string[] } {
       const conditions: NlClubSeasonCondition[] = [];
       const consumed: string[] = [];
       let working = text;
       const words = subjectGated
         ? [...CLUB_SEASON_CONDITION_WORDS, CLUB_SEASON_PREMIERSHIP_SUBJECT_GATED]
         : CLUB_SEASON_CONDITION_WORDS;
       for (const [re, kind] of words) {
         const match = re.exec(working);
         if (!match) continue;
         conditions.push({ kind });
         consumed.push(match[0]);
         working = stripMatch(working, match[0]);
       }
       return { text: working, conditions, consumed };
     }
     ```
   - **Call site, `parser.ts:2536`**: pass `clubSubjectPresent` (already computed at
     `parser.ts:2489`, in scope):
     ```
     // before:
     const clubSeasonConditionResult = extractClubSeasonConditions(text);
     // after:
     const clubSeasonConditionResult = extractClubSeasonConditions(text, clubSubjectPresent);
     ```
   - **New ownership guard**: insert immediately after the existing R3 block closes
     (`parser.ts:3246`, the `}` closing the `if` that starts at `parser.ts:3237`), before the blank
     line/AFLDB-ISSUE-187 comment at `parser.ts:3248`:
     ```ts
     // AFLDB-ISSUE-195. Once grain has elected club_season, playerMetricResult
     // is never read by any club_season plan field (metric comes only from
     // clubSeasonMetricResult, conditions only from clubSeasonConditionResult)
     // -- so a non-null playerMetricResult.metric surviving to this point is a
     // word the parser recognised as meaningful that the elected grain cannot
     // represent, not a word that was safely ignored. clubs_played is excluded:
     // a bare "club(s)" left over here is this question's OWN subject noun
     // re-matching CAREER_STAT_WORDS' clubs_played entry (confirmed against
     // "which clubs won the wooden spoon", "which club had the most losses in
     // 2017", "clubs that made/missed finals" -- all currently-passing tests),
     // never a second requested semantic.
     if (
       grain === 'club_season' && playerMetricResult.metric
       && playerMetricResult.metric !== 'clubs_played'
     ) {
       report.confidence = 1;
       report.notes.push(
         `AFLDB could not combine "${playerMetricResult.metric}" with this club-season question in one plan; ask the two questions separately.`,
       );
       return { status: 'none', reason: 'unrecognised', report };
     }
     ```

3. **`src/search/nl/plan.ts`** — bump `PARSER_VERSION` (currently `47`, line 479) to `48` and append
   a `v48` comment in the established style, above line 479, naming AFLDB-ISSUE-195, the vocabulary
   addition, and the ownership guard (exact wording finalised once the real diff is known — see §7
   for a suggested draft).

No other file requires a change. `plan.ts`'s `validatePlan`, `NlClubSeasonCondition`, and
`CLUB_SEASON_CONDITION_LABEL` (`plan.ts:1177,1183,2357`) already support the `'premier'` kind and
multi-condition `clubSeasonConditions` arrays (confirmed: `club-season.ts`'s compiler already
iterates `plan.clubSeasonConditions` as an AND-ed list, `src/db/queries/nl/club-season.ts:29,43`) —
no compiler/SQL change is needed, matching the issue's non-goal.

---

## 4. Ordering interaction check (verified, not assumed)

`clubSubjectPresent` (`parser.ts:2489`) is computed strictly before the `extractClubSeasonConditions`
call site (`parser.ts:2536`) in the same function body, so passing it as the new parameter requires
no restructuring. It is itself `clubSubjectPreCue || CLUB_SUBJECT_LEADING.test(text.trim())` — the
first half is computed on `normalised`, before any extractor runs (`parser.ts:1829`), so it survives
regardless of what earlier steps (aggregation, streak, having-clause, team-metric) have already
stripped from `text` by step 10.5; the second half is a live re-test against `text` as mutated up to
that point, which ORs in any case the pre-cue's narrower pattern missed. For every required-matrix
phrasing that needs the new gated wording (§5, items 1 and 5), the leading "teams" word is untouched
by every extractor that runs before line 2489 (checked: none of `extractAggregation`,
`extractStreakDefinition`, `extractHavingClause`, `extractMatchFilter`, `extractResultFilter`,
`extractTeamMetric` match on a leading "teams that won…" prefix), so `clubSubjectPresent` is `true`
by the time it matters.

---

## 5. Required semantic matrix

| # | Query | Plan/decline | Expected conditions/metric | Owner |
|---|---|---|---|---|
| 1 | `teams that won the premiership and the wooden spoon` (confirmed trigger) | **plan** | `clubSeasonConditions: [wooden_spoon, premier]`, `metric: null` | `extractClubSeasonConditions` (existing `wooden_spoon` entry + new gated `premier` entry) |
| 2 | `teams that won the flag and the wooden spoon` (positive control) | **plan** | `clubSeasonConditions: [wooden_spoon, premier]`, `metric: null` | `extractClubSeasonConditions` (existing ungated `premier` entry, unchanged) — already correct today, locked in as a regression |
| 3 | `teams that were premiers and won the wooden spoon` | **plan** | `clubSeasonConditions` contains both `premier` and `wooden_spoon` | `extractClubSeasonConditions` (existing ungated `premiers?` entry, unchanged) |
| 4 | `premiership teams that won the wooden spoon` | **plan** | `clubSeasonConditions` contains both `premier` and `wooden_spoon` | `extractClubSeasonConditions` (existing entry, widened to `(?:team\|side)s?` in §3) |
| 5 | `teams that won the premiership` | **plan** | `clubSeasonConditions: [premier]`, `metric: null` | `extractClubSeasonConditions` (new gated `premier` entry) |
| 6 | `teams that won the wooden spoon` | **plan** (unchanged) | `clubSeasonConditions: [wooden_spoon]`, `metric: null` | existing, already green (`tests/nl-parser.test.ts:533-538`) |
| 7 | `which team has won the most premierships` | **decline (R2)** | — | AFLDB-ISSUE-189 R2 (`parser.ts:3230-3236`), unaffected — the new gated regex requires "won (the\|a)? premiership" with nothing intervening; "won the most premierships" has "most" in between and does not match |
| 8 | `teams with more than 5 premierships` | **decline (R2)** | — | AFLDB-ISSUE-189 R2, unaffected (no "won" word present at all) |
| 9 | `players who have won 3 premierships` | **plan, `player_career`** | `careerConditions: [{ column: 'premierships', op: 'gte', value: 3 }]` | `extractCareerConditions` (existing, unaffected — no leading team/club/side subject, `clubSubjectPresent` is `false`, gated entry never tried; existing test `tests/nl-parser.test.ts:567-571`) |
| 10 | `richmond players who have won 3 premierships` | **plan, `player_career`, club-scoped** | as above, `scope.clubFor` set | unaffected — leading word is "richmond" (a club name), not "team(s)/club(s)/side(s)", so `CLUB_SUBJECT_CUE` does not match; existing test `tests/nl-parser.test.ts:587-591` |
| 11 | `which player has the most premierships` | **plan, `player_career`** | `metric: 'premierships'` | unaffected — "which player" does not match `CLUB_SUBJECT_CUE`; existing test `tests/nl-parser.test.ts:723-727` |
| 12 | `teams with the most wins in a season` | **plan, `club_season`** | `metric: 'wins'`, `agg: { kind: 'max' }` | unaffected — "wins" claimed by `clubSeasonMetricResult` at step 10.5, before step 11's fallback runs; existing test `tests/nl-parser.test.ts:505-510` |
| — | `teams that played the finals and won the wooden spoon` (guard proof, §2.2) | **decline (new guard)** | — | new ownership guard (§3) — proves the guard's independent value: `clubSeasonConditions: [wooden_spoon]` alone (`conditions.length === 1`, so R2 does not fire), `metric: null` (R3 does not fire, requires `metric !== null`), but `playerMetricResult.metric === 'finals'` (not `clubs_played`) triggers the new guard instead of silently answering "teams that won the wooden spoon" |
| — | `which clubs won the wooden spoon` (carve-out proof, §2.3) | **plan (unchanged)** | `clubSeasonConditions: [wooden_spoon]`, `metric: null` | existing, already green (`tests/nl-parser.test.ts:709-714`) — must stay green under the new guard because of the `clubs_played` carve-out |

The ISSUE-189 declines (rows 7-8) remain declines. The ISSUE-188/player-subject premiership queries
(rows 9-11) remain `player_career`. Row 12 (a plain club-season metric ranking) is unaffected.

---

## 6. Regression-test matrix

**Home:** extend the existing `describe('AFLDB-ISSUE-189: club/team subject election', ...)` block
in `tests/nl-parser.test.ts` (`tests/nl-parser.test.ts:622-734`) with a new nested
`describe('AFLDB-ISSUE-195: premiership + wooden-spoon conjunction ownership', ...)`, inserted after
the existing `describe('neighbour: player subject kept', ...)` block closes (`tests/nl-parser.test.ts:733`)
and before the outer block's closing `});` (`tests/nl-parser.test.ts:734`). This is the file and
region the issue's own "Key files" section names; do not create a new test file or a new top-level
describe.

Add (matches §5's matrix exactly):

1. **Original trigger, must never narrow silently** —
   `'teams that won the premiership and the wooden spoon'` →
   `p.clubSeasonConditions` `toContainEqual({ kind: 'premier' })` **and**
   `toContainEqual({ kind: 'wooden_spoon' })` (both, not `toEqual([{ kind: 'wooden_spoon' }])`,
   which is what the pre-fix defect would produce). `p.metric` `toBeNull()`.
2. **Positive control, already-recognised wording** —
   `'teams that won the flag and the wooden spoon'` → same both-conditions assertion. Locks in
   behaviour that is correct today so a future change cannot regress it unnoticed.
3. **Alternate phrasing** — `'teams that were premiers and won the wooden spoon'` → same
   both-conditions assertion.
4. **Plural "premiership teams" form** (proves the `(?:team|side)s?` widening) —
   `'premiership teams that won the wooden spoon'` → same both-conditions assertion.
5. **Standalone gated wording** — `'teams that won the premiership'` →
   `p.clubSeasonConditions` `toEqual([{ kind: 'premier' }])`, `p.metric` `toBeNull()`,
   `result.status` is `'plan'` (not a decline).
6. **Guard proof, independent of the vocabulary fix** —
   `'teams that played the finals and won the wooden spoon'` → `result.status` is **not** `'plan'`
   (declines rather than silently answering "teams that won the wooden spoon" alone). Assert on
   `result.status` only (`'none'`/`'unanswerable'`, whichever the actual decline path produces) —
   do not assert exact note text unless the implementer confirms the precise message, since this
   case exercises the new guard's message, not R2/R3's.
7. **Ownership guard does not regress `clubs_played` subject-noun collisions** — re-assert (or
   confirm still green, if already covered by the existing tests at `tests/nl-parser.test.ts:709-714`
   and `540-550`) that `'which clubs won the wooden spoon'`, `'clubs that made finals'`, and
   `'clubs that missed finals'` still return `status: 'plan'` with their existing
   `clubSeasonConditions` assertions unchanged.

**Existing tests that must remain green (do not weaken, do not delete):**
- `tests/nl-parser.test.ts:622-734` — every existing R2/R3/positive/neighbour case in the
  AFLDB-ISSUE-189 block (traced individually in §2.3/§5).
- `tests/nl-parser.test.ts:504-556` — the full `describe('13. club_season queries', ...)` block,
  especially `'fewest wins by a premier'` and `'most losses by a premiership team'`
  (`tests/nl-parser.test.ts:518-531`), which exercise the *existing*, ungated `premier` entry and
  must be unaffected by the new gated addition.
- `tests/nl-parser.test.ts:567-571`, `587-591` — the ISSUE-188 `extractHavingClause`
  player-subject/club-scoped "won 3 premierships" tests (row 9/10 in §5).
- `tests/nl-parser.test.ts:1021-1024` — `'teams that won the spoon'` (bare "spoon"), unaffected
  (different `CLUB_SEASON_CONDITION_WORDS` entry, unchanged).

No other describe block in `tests/nl-parser.test.ts` or `tests/nl-semantic-mapping.test.ts` names
`clubSeasonConditions`, `CLUB_SEASON_CONDITION_WORDS`, or a club/team-subject premiership phrase in
a way this change could plausibly affect (checked via a targeted grep for "premiership", "wooden
spoon", and "club_season" across both files during planning — see the inline results captured
earlier in this planning session).

---

## 7. `PARSER_VERSION` bump

Bump `PARSER_VERSION` from `47` to `48` in `src/search/nl/plan.ts:479`, and add a `v48` entry to the
comment block immediately above it (after the existing `v47` entry, `plan.ts:469-478`), in the
established style. Suggested text for the implementer to adapt once the exact final diff is known:

> `// v48 -- AFLDB-ISSUE-195: CLUB_SEASON_CONDITION_WORDS' premier entry now also recognises`
> `// plural "premiership teams/sides"; a new, separately-gated CLUB_SEASON_PREMIERSHIP_SUBJECT_GATED`
> `// entry recognises "won the/a premiership" but only when an independent club/team subject cue`
> `// (clubSubjectPresent) is already established, so it cannot manufacture a false club-season`
> `// reading for a player-subject question. Grain election also gained a narrow ownership guard:`
> `// once grain elects club_season, a non-null playerMetricResult.metric (other than the`
> `// clubs_played subject-noun collision) now declines rather than being silently dropped --`
> `// "teams that won the premiership and the wooden spoon" now carries both conditions instead of`
> `// only wooden_spoon.`

---

## 8. Risks / non-goals

- **Non-goal:** no new `club_season` grain, aggregation, or condition kind. `'premier'` already
  exists; this reuses it.
- **Non-goal:** no change to AFLDB-ISSUE-189's R2/R3 guards or `validatePlan`'s backstop — both are
  unaffected (§2.3, §5).
- **Non-goal:** no change to `club-season.ts`, `describe.ts`, or any SQL/compiler code — the
  compiler already ANDs an arbitrary-length `clubSeasonConditions` array (confirmed,
  `club-season.ts:29,43`).
- **Not attempted:** a general "consumed-token ownership" framework across the whole parser. The
  guard is deliberately scoped to one grain and one already-computed variable (§2.5, Option D
  rejection). If a future stress-corpus run or user report surfaces the same silent-drop mechanism
  for a *different* grain (not `club_season`), track it as a new issue with its own reproduction
  rather than retroactively widening this guard.
- **Known, accepted gap — named-club phrasing:** `"richmond won the premiership and the wooden
  spoon"` (a named club, not a bare "teams"/"clubs" subject) is **not** covered by the new gated
  wording, because `clubSubjectPresent` does not consider a bare club name a subject cue (by
  design — a named club is just as often a `player_game`/`player_season` scope, per the existing
  `clubSeasonCuePresent` comment at `parser.ts:2540-2550`). Not in the required matrix; not fixed
  here. If a real query of this shape is found, it needs its own adjudication (the same
  `clubFor`-plus-season-wording style gate `clubSeasonCuePresent` already uses for named-club
  metric rankings), not a speculative extension now.
- **Known, accepted gap — "minor premiers"/other premiership-adjacent phrasing:** the existing,
  unmodified `premiers?` entry already matches "premiers" inside "minor premiers", which is a
  *different* record (ladder leader, not flag winner) — this is a pre-existing vocabulary ambiguity,
  not introduced or worsened by this change, and out of scope per the issue's non-goals.
- **No DB/schema impact.** Parser/plan-only, matches the issue's own "Migration/schema
  implications: None."
- **Confirm before implementing:** re-run the exact grep/read evidence in §1, §3, §4 and §6 against
  whatever commit main is at when implementation starts — AFLDB-ISSUE-196 already landed on
  `parser.ts`/`plan.ts` ahead of this plan (unmerged, per its own runbook); check for line drift
  from that and from any other work landed on `main` since `414efea`.

---

## 9. Validation commands for the operator

Smallest-first, per CLAUDE.md's testing escalation:

1. `npx vitest run tests/nl-parser.test.ts` — the new AFLDB-ISSUE-195 describe block plus every
   existing test named in §6.
2. `npx vitest run tests/nl-semantic-mapping.test.ts` — non-regression for the player-subject
   premiership tests (no club-season-condition assertions live here today, but it exercises
   `extractCareerConditions`'s premiership path, which this change does not touch — confirm it
   stays green).
3. `npx tsc --noEmit` — new function parameter (`extractClubSeasonConditions`'s `subjectGated`) and
   new vocab export; confirm no type regressions.

DB-backed verification is **not** required — no SQL/compiler change (§8). Do not request a broader
NL corpus/stress run for this focused a parser change; the Stage 2 sign-off's separate
full-corpus/triage requirements (`IssuesIndex.md`) are a distinct, larger piece of work this plan
does not cover.

---

## 10. Implementation steps, in order

1. Re-verify §1's line numbers and the exact current text of `CLUB_SEASON_CONDITION_WORDS`
   (`vocab.ts:540-549`), `extractClubSeasonConditions` (`parser.ts:1228-1240`), its call site
   (`parser.ts:2536`), and the R2/R3 guard block (`parser.ts:3230-3246`) against the commit main is
   on at implementation time — AFLDB-ISSUE-196 may have shifted line numbers within `parser.ts`.
2. Widen the existing `premier` entry in `vocab.ts` to `(?:team|side)s?` (§3.1).
3. Add the new `CLUB_SEASON_PREMIERSHIP_SUBJECT_GATED` export in `vocab.ts`, with its doc comment
   (§3.1).
4. Add the import in `parser.ts` (§3.2).
5. Add the `subjectGated` parameter to `extractClubSeasonConditions` and update its call site to
   pass `clubSubjectPresent` (§3.2).
6. Add the new ownership guard immediately after the R3 block (§3.2).
7. Add the seven regression cases from §6 to the new nested describe block in
   `tests/nl-parser.test.ts` (do not create a new file or top-level block).
8. Run validation command 1 (§9); for the guard-proof case (§6 item 6), confirm the actual decline
   `reason`/note text produced and adjust the test assertion to match what the code actually
   produces, rather than asserting a guessed message.
9. Run validation command 2 (§9).
10. Run validation command 3 (§9).
11. Bump `PARSER_VERSION` to `48` and add the `v48` comment (§7) once the implementation's actual
    final shape is known (word the comment to match what was actually built, not the sketch
    verbatim).
12. Report changed files (`src/search/nl/vocab.ts`, `src/search/nl/parser.ts`,
    `src/search/nl/plan.ts`, `tests/nl-parser.test.ts`) to the operator for review/commit —
    implementation session does not commit; per CLAUDE.md, Git remains user-operated.
13. Update `issues.md` AFLDB-ISSUE-195 (status, root cause as actually fixed, validation evidence)
    and remove it from `IssuesIndex.md`/the Open Issues table once the operator confirms the
    validation commands passed — this is implementation-session work, not this plan's.
