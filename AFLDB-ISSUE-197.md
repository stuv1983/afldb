# AFLDB-ISSUE-197 — NL surname candidate resolution is truncated before ambiguity checks

Status: **Resolved** 2026-09-16 (Sonnet 5, worktree `afldb-issue-197`), operator-validated: 25/25
`tests/integration/nl-semantic-mapping.test.ts`, 951/951 across the full focused NL suite set, clean
`npx tsc --noEmit`. This runbook was the implementation contract; see `issues.md`'s AFLDB-ISSUE-197
entry for the "Implementation"/"Validation"/"Resolution" sections recording what was actually built,
the two test files touched beyond §8's list, a test-fixture `player_career_stats` NOT-NULL
correction, and an integration-path control-flow investigation (fixture defect, not a production
defect — see that entry for the full trace). Not committed, not merged — Git remains user-operated
per `CLAUDE.md`. Corpus relabelling (§12) is a separate follow-up, tracked under Stage 2's next task
in `IssuesIndex.md`, not part of this resolution.

## 1. Problem statement

The NL parser's surname/family ranking contract is: for a bare-surname mention, 2–12 plausible
player identities are a real, small family and should be ranked as one population
(`scope.playerIdIn`); more than 12 is a generic surname clash and must decline. Production never
lets the >12 branch fire, and can rank a family it wrongly believes is complete when it is not,
because the player candidate list production hands the parser is hard-capped at 5 rows before
either check runs. This is a fail-open correctness/safety defect: certain "most goals" / "most
games" style questions for a same-surnamed group of players return a confident (certainty 1.0),
factually wrong answer instead of the correct answer (small family) or a decline (large family).

## 2. Stage 2 evidence

Source: Stage 2 closeout audit of the 208 V1 `AMBIGUITY_NOT_DETECTED` hard failures.

- 208 rows audited → 40 `GENUINE_FAIL_OPEN`, 168 `STALE_CORPUS_EXPECTATION`, 0
  `CORPUS_DATA_DEFECT`, 0 `OTHER`.
- All 40 genuine rows collapse to this one root cause.
- Ablett (11601–11605, 5 rows): DB holds 7 plausible Abletts with games; production resolver
  supplies only 5 (Kevin Ablett and Nathan Ablett are silently omitted).
- Generic surname families (35 rows): Johnson 59, Brown 92, Smith 136, Williams 97, Jones 79,
  Wilson 54, Anderson 49 plausible identities by the current plausibility rule — all far past the
  documented cap of 12, all still answered instead of declined.
- Reproduced wrong answers at confidence 1.0:
  - "Brown most goals" → truncated result Ben Brown 360; true surname-family leader Jonathan
    Brown 594.
  - "Brown most games" → truncated result Gavin Brown 254; true leader Jonathan Brown 256.
  - "Jones most goals" → truncated result Jack Jones 156; true leader Peter Jones 284.

## 3. Exact root cause

`src/db/queries/nl/resolve.ts:170-176`:

```ts
export async function resolvePlayer(name: string): Promise<NlPlayerCandidate[]> {
  const results = await searchPlayers(name, 5);
  ...
}
```

`resolvePlayer` is the sole production implementation of `NlParseContext.resolvePlayer`
(`src/search/nl/parser.ts:111`, wired in `buildNlParseContext`, `resolve.ts:179-185`). It is the
*only* candidate source for both branches in the player-mention step
(`src/search/nl/parser.ts:2646-2786`):

- the accept branch (`top.score >= PLAYER_ACCEPT_SCORE`, i.e. 500 — `parser.ts:115,2671`);
- the ambiguity/family branch (`parser.ts:2724-2785`), which derives `plausible` by filtering
  `candidates` — the same, already 5-capped array — against a whole-word-prefix test
  (`candidateNameWords`, `parser.ts:1818-1824`), then checks
  `plausible.length >= 2 && plausible.length <= NL_LIMITS.maxPlayerCandidates` (`parser.ts:2745`)
  to rank, or `plausible.length >= 2` alone (`parser.ts:2778`) to decline as a generic clash.

Because `plausible ⊆ candidates` and `candidates.length <= 5`, `plausible.length` can never exceed
5. The decline branch at `parser.ts:2778-2784` (`plausible.length >= 2` after already failing the
`<= 12` test) is therefore dead code in production: it can only be reached with a hand-built
`resolvePlayer` fake, never through the real resolver. Every existing regression test that
exercises it does exactly that (`tests/nl-parser.test.ts:75-79`, a plain injected
`Record<string, NlPlayerCandidate[]>`) — it proves the parser's own branching logic, not the
production boundary that feeds it, which is exactly the gap the audit found.

Corroborating evidence that this cap has been live and unnoticed: `NL_LIMITS.maxPlayerCandidates`'s
own comment (`src/search/nl/plan.ts:1335-1340`) says *"the real cases are small — five Abletts is
the widest genuine one seen"*. The real family is 7. Whoever wrote that comment could only ever
have observed the truncated-to-5 result — the comment is itself an artefact of this defect, not
independent evidence against it.

## 4. Current resolver/parser data flow

```
parser.ts: candidatePlayerSpan(text)              -- pick the leftover alpha span (<=4 words)
        -> ctx.resolvePlayer(lookupName)           -- ONE call, production: resolve.ts:170
              -> searchPlayers(name, 5)             -- src/db/queries/search.ts:84-145
                    ranked: exact(1000) > prefix(500) > substring(250) > trigram-only(0-100),
                    + LEAST(career-games prominence, 400)/10, LIMIT 5
        -> candidates (<=5 rows, by construction)
        -> top = candidates[0]
        -> if top.score >= 500: accept branch, player = top.ref            (parser.ts:2671)
        -> else: plausible = candidates.filter(wholeWordPrefixMatch)       (parser.ts:2741-2744)
              -> 2 <= plausible.length <= 12: rank family, scope.playerIdIn = plausible ids
              -> plausible.length > 12: DEAD — plausible.length is bounded by 5
```

`searchPlayers`'s `WHERE` clause (`players.search_name LIKE '%term%' OR search_name % term`) uses
the existing `gin_trgm_ops` index on `players.search_name` / `player_name_aliases.search_alias`
(migration `008_search.sql:32,35`). Its `rank` tiers are strictly separated (1000/500/250 vs. a
trigram-only match capped at ~100 without a `LIKE` hit), so every player whose name *contains* the
query term as a raw substring outranks every purely fuzzy suggestion — but "contains as a
substring anywhere" is a **looser** test than the parser's own whole-word-prefix
`candidateNameWords` check. This distinction matters for Option A below.

## 5. Candidate completeness invariant

For a bare-surname (or short multi-token) mention, whatever candidate set reaches the parser's
ambiguity branch must satisfy:

> **Invariant:** the fetched set contains *every* player for whom the parser's own plausibility
> predicate (`candidateNameWords` whole-word-prefix match, all mention tokens) would return true,
> up to `NL_LIMITS.maxPlayerCandidates + 1` — and if the true plausible count exceeds that bound,
> the fetched set must contain at least `maxPlayerCandidates + 1` genuinely plausible members so
> the overflow is visible.

A fix that fetches more rows but ranks them by a *different, looser* predicate than the one that
decides plausibility does not establish this invariant — it only raises the truncation point.

## 6. Options considered

### Option A — fetch `maxPlayerCandidates + 1` via the existing `searchPlayers`

**Rejected.** `searchPlayers`'s `WHERE`/`ORDER BY` matches on raw substring containment across the
whole name string (`search_name LIKE '%term%'`), not per-word prefix. A short/common token (e.g.
"cox") substring-matches unrelated names ("Wilcox") at the *same* score tier (250) as genuine
word-initial matches ("Cox", "Coxon"). Those false-positive matches compete for the same 13-row
window on prominence (`games DESC`) as true family members. A prominent "Wilcox" can push a
lower-profile true "Cox" out of the top 13, which:

- silently produces an *incomplete* ≤12-looking family (the exact hazard §5 forbids), or
- silently produces a ≤12 count that is actually missing members of a true >12 family, ranking
  instead of declining.

This is not a hypothetical for every surname, but it is not provably safe for all of them either,
and the issue's own instruction is not to guess. Widening the same query's limit does not close
the gap between "matches by substring" (what `searchPlayers` computes) and "matches by whole-word
prefix" (what the parser's plausibility rule actually means).

### Option B — explicit count, then bounded fetch

Two-query variant of Option A (count first, fetch only when ≤12). Rejected for the same reason as
A: without changing the *matching predicate* to the parser's own whole-word-prefix rule, the count
and the fetch both inherit the same substring-vs-prefix mismatch. Two round trips also doubles the
cost of the ambiguous path for no correctness gain over a single dedicated query.

### Option C — dedicated surname/family candidate resolver

**Chosen.** `resolvePlayer` mixes two different jobs: (1) best-guess, typo-tolerant, ranked lookup
for a confident single-player mention (the accept branch, `PLAYER_ACCEPT_SCORE` gate), and (2)
enumerating a bounded *family* of plausible identities once no single confident guess exists. Job
(1) genuinely wants fuzzy/trigram matching and a small limit. Job (2) wants an exact, exhaustive
(up to the cap) enumeration under the *same* predicate the parser already uses to decide
plausibility — no fuzziness, no substring false positives, no silent truncation.

A new function implements the parser's whole-word-prefix predicate directly in SQL: every mention
token must be a whole-word prefix of some word of a candidate's primary name or a
`player_name_aliases` alias (mirroring what `candidateNameWords` already checks in TypeScript,
`parser.ts:1818-1824`). Because the predicate is mirrored exactly rather than approximated by a
generic ranked search, there is no substring-vs-prefix gap: the query returns, by construction,
precisely the set the parser's own rule calls plausible. Fetching `maxPlayerCandidates + 1` (13)
of those lets the parser tell "≤12, complete" from ">12, decline" from a single call.

No new index/migration: the existing `gin_trgm_ops` index on `search_name`/`search_alias` still
pre-filters cheaply via `LIKE '%token%'` (a superset of the whole-word-prefix set), and the precise
per-token word-boundary check runs as a secondary filter over that already-small pre-filtered
result — the same two-step shape `searchPlayers` already uses, just with the substring/trigram
ranking replaced by an exact per-word predicate for this one path.

`resolvePlayer`'s existing 5-row cap and its `searchPlayers` call are untouched; only the ambiguity
branch gets a second, purpose-built data source, and only when it is reached (top candidate absent
or scoring below `PLAYER_ACCEPT_SCORE` — already-rare relative to total NL search volume).

## 7. Chosen design and why

- **New export** `resolvePlayerFamily(tokens: string[]): Promise<NlPlayerCandidate[]>` in
  `src/db/queries/nl/resolve.ts`. SQL: pre-filter `players`/`player_name_aliases` rows containing
  every token as a raw substring (uses the existing trigram index), then keep only rows where,
  for *every* token, some whitespace-split word of the matched name/alias starts with it
  (`regexp_split_to_array`/`unnest` + `LIKE token || '%'`), deduplicated per player (mirror
  `searchPlayers`'s `DISTINCT ON (player_id)` `best`-form pattern so a player matching through two
  aliases isn't counted twice), ordered by career games DESC (existing prominence tie-break) then
  id, `LIMIT NL_LIMITS.maxPlayerCandidates + 1`.
- **`NlParseContext`** (`src/search/nl/parser.ts:88-112`) gains a required
  `resolvePlayerFamily: (tokens: string[]) => Promise<NlPlayerCandidate[]>` field, wired in
  `buildNlParseContext` (`resolve.ts:179-185`) alongside the existing `resolvePlayer`.
- **Parser's else-branch** (`parser.ts:2724-2785`): when the accept branch is not taken, call
  `ctx.resolvePlayerFamily(lookupTokens)` instead of deriving `plausible` by filtering the shared,
  5-capped `candidates`. Branch on the result:
  - 0 or 1 → unchanged fallthrough (preserves the existing "one weak fuzzy match is an unknown
    spelling, not ambiguity" contract, `parser.ts:2726-2739`);
  - 2–12 → complete family, rank as today, `scope.playerIdIn` = every returned id;
  - 13 (i.e. `> maxPlayerCandidates`) → decline as today (`ambiguousPlayerMention`).
  Keep the existing `candidateNameWords` whole-word-prefix filter applied to whatever
  `resolvePlayerFamily` returns, as a cheap defence-in-depth check rather than trusting the SQL
  blindly (see §14).
- **`NL_LIMITS.maxPlayerCandidates`'s comment** (`plan.ts:1335-1340`) is corrected: it currently
  asserts "five Abletts is the widest genuine one seen", which is the truncated-to-5 artefact this
  issue fixes. Replace with the true figure (7) and keep the cap at 12 (unchanged — the cap itself
  is not the defect, its enforcement was unreachable).
- `resolvePlayer(name, 5)` and the accept branch are **not** changed by this issue (see §15 for a
  related but distinct, out-of-scope observation about the accept branch).

## 8. Files expected to change

- `src/db/queries/nl/resolve.ts` — new `resolvePlayerFamily` export; wire into
  `buildNlParseContext`.
- `src/search/nl/parser.ts` — `NlParseContext` type; else-branch candidate source
  (`parser.ts:2724-2785`).
- `src/search/nl/plan.ts` — `PARSER_VERSION` bump + history comment (§10);
  `NL_LIMITS.maxPlayerCandidates` comment correction.
- `tests/nl-parser.test.ts` — fake `resolvePlayerFamily` added to the shared `ctx`; new unit cases
  (§9).
- `tests/integration/nl-semantic-mapping.test.ts` — new synthetic `FIXTURE_PREFIX` family
  fixtures; new DB-backed cases (§9). This is the existing home that already builds a real
  `buildNlParseContext()` and inserts synthetic players (`FIXTURE_PREFIX`-prefixed, e.g. the Gary
  Ablett Jnr/Snr fixture at lines 163-178) — the correct semantic home per `CLAUDE.md`'s reuse
  rule, not a new test file.
- `issues.md` / `IssuesIndex.md` — already updated by this planning session; updated again on
  resolution.
- `CHANGELOG.md` — `Unreleased` entry added at implementation/resolution time (behaviour has not
  changed yet).

No `src/db/migrations/` file is expected — no schema change, no new index.

## 9. Test matrix

Unit (`tests/nl-parser.test.ts`, fake `ctx.resolvePlayerFamily`, no DB — fast, exercises the
parser's own branch logic):

1. 2-candidate bare-surname family → ranks; `scope.playerIdIn` has both ids.
2. Exactly 12 candidates → ranks; `scope.playerIdIn` has all 12 (low boundary).
3. Exactly 13 candidates → declines as ambiguous (`ambiguousPlayerMention`), proving `> 12` not
   `>= 12` (high boundary — the issue's required "exactly 12 / 13" item).
4. `resolvePlayerFamily` returns 0 or 1 while `resolvePlayer`'s normal candidates surfaced one weak
   fuzzy match ("smoth" → John Smith style) → still declines as unknown spelling, not ambiguity
   (proves the existing non-ambiguity contract, `parser.ts:2726-2739`, is unchanged).
5. Existing full-name accept-branch tests ("dustin martin", the 2-candidate "gary ablett" exact
   duplicate-name case) pass unmodified — proves `resolvePlayer`'s 5-cap and the accept branch are
   untouched by this issue.
6. Defensive re-check: if a fake `resolvePlayerFamily` returns a candidate that does **not**
   satisfy the whole-word-prefix predicate (a deliberately wrong test double), it is still dropped
   before entering `scope.playerIdIn` — proves the retained TS filter fails closed rather than
   trusting the resolver's output unconditionally (issue's optional item 7).

Integration (`tests/integration/nl-semantic-mapping.test.ts`, real `buildNlParseContext()`,
synthetic `FIXTURE_PREFIX` players — proves the production resolver boundary itself, not just the
parser's internal branch, which is exactly what the audit found existing tests do not do):

7. Insert 7 synthetic same-surname players with distinct career games (mirrors the real Ablett
   family size) → the parsed/compiled answer ranks across all 7, picks the correct highest-games
   member; none silently omitted.
8. Insert 13 synthetic same-surname players → declines as ambiguous through the real resolver
   boundary (DB-backed analogue of Brown/Smith, deterministic and independent of live surname
   counts that drift as data is imported).
9. Wrong-answer proof: insert a synthetic 6-or-7-player family where the true highest-games member
   would **not** be among the first 5 by `searchPlayers`' own text-score/prominence ranking (give a
   later-ranked-by-text-score member the highest games) → the fixed system answers with the correct
   member. This operationalises the Brown/Jones wrong-answer evidence in a deterministic fixture
   rather than depending on live career totals that can change.
10. 2-player family end-to-end via DB fixture (smallest ambiguous case) — confirms unchanged
    semantics through the real boundary, not just the unit fake.
11. Existing Gary Ablett Jnr/Snr suffix-disambiguation tests (`nl-semantic-mapping.test.ts:478-495`)
    and the existing alias-aware `searchPlayers` tests (`:597-627`) pass unmodified.

## 10. Parser-version decision

**Recommend bumping `PARSER_VERSION` 48 → 49.** The root cause sits at the resolver/parser
boundary, not in a vocabulary table, but the externally observable output for surname-only
questions changes in both directions: a genuine ≤12 family (Ablett) now returns a complete,
correctly-ranked answer instead of one silently computed over an incomplete 5-player subset, and a
>12 generic surname (Brown, Smith, Johnson, Williams, Jones, Wilson, Anderson, ...) now declines
(`status: none`) instead of returning a confident wrong answer. Every prior parser-behaviour change
in this file's history (`v44`–`v48`, `plan.ts:440-490`) bumps the version specifically because
parse/plan output changes for real phrasings, regardless of which internal stage caused it — this
issue fits the same convention. Add a `v49` history comment describing the resolver-boundary fix
plainly (in the style of the existing `v44`–`v48` comments) so a future reader does not have to
re-derive that the fix lived outside the vocabulary tables.

## 11. DB/operator validation plan

Operator-run (Claude does not execute shell/Git per `CLAUDE.md` §9):

1. `npx vitest run tests/nl-parser.test.ts` — the unit matrix (§9 items 1–6).
2. `npx vitest run tests/integration/nl-semantic-mapping.test.ts` — requires
   `AFLDB_TEST_DATABASE_URL` pointed at a database ending in `_test`; the DB-backed matrix (§9
   items 7–11).
3. `npx tsc --noEmit`.
4. Do not request a full-suite or build run unless one of the above is insufficient or a
   pre-deployment gate requires it (`CLAUDE.md` §10/§11).
5. Optional, read-only, operator-run: after the fix lands, re-run the audit's counting query
   against the real data to confirm Ablett = 7 and the generic families are still > 12, before any
   corpus relabelling (§12) is done in a separate session.

## 12. Corpus follow-up implications

Not touched in this issue. Expected disposition once ISSUE-197 is implemented and validated:

- The 35 generic-surname rows (Johnson/Brown/Smith/Williams/Jones/Wilson/Anderson) remain expected
  declines and should become clean passes once production correctly declines them.
- The 5 Ablett rows should be relabelled from expected-decline to expected-success across the
  complete 7-player family (no longer a truncated-5 answer).
- The remaining 168 `STALE_CORPUS_EXPECTATION` rows (streak/coaching grains) are a separate,
  unrelated corpus-expectation correction and are explicitly out of scope here.

Corpus relabelling is a separate follow-up task, not a substitute for this fix and not performed by
this runbook.

## 13. Acceptance criteria

- 0 or 1 plausible player: existing normal resolution behaviour is bit-for-bit unchanged.
- 2–12 plausible players: every plausible player is present in the ranked family; `scope.playerIdIn`
  represents the complete set; no candidate is silently omitted (Ablett: all 7 present).
- \>12 plausible players: the parser declines as ambiguous under the existing generic-clash
  contract; no top-5/top-N prominence subset is ever treated as the complete family (Brown, Smith,
  Johnson, Williams, Jones, Wilson, Anderson all decline).
- All test matrix items (§9) pass; no existing test is weakened, skipped, or deleted to achieve
  this.
- `npx tsc --noEmit` clean.
- `PARSER_VERSION` bumped with a `v49` history comment (§10).
- `NL_LIMITS.maxPlayerCandidates`'s stale comment is corrected.

## 14. Rollback/failure considerations

- The change is additive and isolated to the non-confident/ambiguous player-mention branch: a new
  resolver function, a new `NlParseContext` field, and a narrowed data source inside one existing
  `else` branch. No data or schema change to unwind; rollback is reverting the four touched files
  and the `PARSER_VERSION` bump.
- Residual risk is a subtle bug in the new predicate's SQL (e.g. a normalisation mismatch between
  `afldb_normalise_name` and the new query's own tokenisation) rather than in the parser's
  branching, which is unchanged. Two failure directions:
  - **Under-returns** (misses a true family member): the exact hazard this issue exists to close.
    Caught only by the completeness tests (§9 items 7, 9–10), not by any runtime filter — this is
    why those tests are mandatory before sign-off, not optional coverage.
  - **Over-returns** (includes a false positive): caught at runtime by the retained
    `candidateNameWords` defence-in-depth filter (§7, §9 item 6) — worst case is an unnecessary
    decline, not a wrong answer, which is the safe failure direction.
- Performance: the dedicated query only runs on the ambiguous/non-confident path, already rare
  relative to total NL search volume, and reuses the existing trigram index for its pre-filter — no
  migration or new index expected, but confirm with `EXPLAIN` during implementation if a generic
  surname's pre-filter set turns out unexpectedly large.

## 15. Explicit non-goals

From the issue:

- `compare-runs.ts` / `--report-only` harness defect.
- Team streak semantics; coach-record semantics.
- AFLW competition-aware NL work.
- Unrelated soft corpus findings; corpus relabelling of any kind.
- Broad player-search/entity-resolution redesign beyond this exact contract.

Additional observation, deliberately not fixed here: the accept branch's `nameMatches` ambiguity
check (`parser.ts:2700-2703`, the "Thomas" example) filters the *same* 5-capped `candidates` array,
so a common first name with more than 5 exact/prefix matches could theoretically under-count
`nameMatches` and under-state ambiguity (certainty 0.7 vs 1). This does **not** change *which*
player is chosen — `resolvePlayer`'s own `ORDER BY rank DESC, games DESC` already selects the most
prominent match regardless of family size — so it is a certainty-calibration gap, not a wrong-answer
defect, and is outside this issue's confirmed-defect scope (the audit's 40 genuine fails are all
wrong-answer, not miscalibrated-confidence, cases). Worth a narrow follow-up issue if evidence ever
shows it matters; not tracked as a new issue here per `CLAUDE.md`'s bar for "meaningful reproducible
defect" (there is no reproduction, only a theoretical parallel).

## Unresolved planning question

`resolvePlayerFamily`'s exact per-player deduplication when a candidate matches through more than
one alias (mirror `searchPlayers`'s `DISTINCT ON (player_id) ... ORDER BY player_id, form_rank DESC`
pattern) and whether `player_name_aliases` needs the same treatment as it does in `searchPlayers`
for full parity — recommend yes (since `candidateNameWords` already folds `matchedName` into the
plausibility check) but the exact query shape is an implementation-time detail, not a blocking
design gap.

---

## Recommended implementation model/effort

**Sonnet 5, High effort** — matches the complexity class of AFLDB-ISSUE-195/196 (NL
resolver/parser-boundary safety fixes with a cross-file contract, an explicitly-rejected naive
option requiring judgement, and a DB-backed regression requirement).

## Summary for report

- **Chosen fix:** Option C — a dedicated `resolvePlayerFamily` resolver in
  `src/db/queries/nl/resolve.ts` that mirrors the parser's whole-word-prefix plausibility predicate
  exactly in SQL (fetching `maxPlayerCandidates + 1`), replacing the shared 5-capped `candidates`
  array as the ambiguity branch's data source. Option A (naively widen `resolvePlayer`'s existing
  limit to 13) is rejected: `searchPlayers`'s substring/trigram ranking is not equivalent to the
  parser's own plausibility rule and can silently crowd out true family members for short/common
  surnames.
- **Schema/migration required:** No.
- **`PARSER_VERSION` bump:** Yes, 48 → 49.
- **Expected production files:** `src/db/queries/nl/resolve.ts`, `src/search/nl/parser.ts`,
  `src/search/nl/plan.ts`.
- **Expected test files:** `tests/nl-parser.test.ts`, `tests/integration/nl-semantic-mapping.test.ts`.
- **Unresolved planning question:** exact per-player deduplication shape for the new query when a
  candidate matches through more than one alias (§ "Unresolved planning question" above) — an
  implementation-time detail, not a blocker.
