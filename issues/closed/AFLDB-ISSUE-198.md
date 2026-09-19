# AFLDB-ISSUE-198 — NL family ambiguity cap miscounts hyphenated/apostrophe player names

Status: **Resolved** 2026-09-16 (Sonnet 5), operator-validated: DB-backed integration
`tests/integration/nl-semantic-mapping.test.ts` 29/29, combined focused suite 964/964 (6 files),
clean `npx tsc --noEmit`. See `issues.md`'s Implementation/Validation/Resolution sections for the
full record and one deviation from this runbook's literal §5 Option C code sketch. Not committed,
not merged — Git remains user-operated per `CLAUDE.md`. The unchanged V1 12k-row corpus re-run on
parser v50 (§11) is a separate post-merge Stage 2 step, not yet performed.

## 1. Problem statement

The bare-surname/family ambiguity branch introduced by AFLDB-ISSUE-197 uses a TypeScript
whole-word-prefix predicate (`candidateNameWords`, `parser.ts:1829-1834`) as a defence-in-depth
re-check on top of `resolvePlayerFamily`'s SQL plausibility result. That TypeScript predicate
tokenises a candidate's name by plain whitespace-splitting (`.split(/\s+/)`), while the SQL side's
own plausibility rule (and the `players.search_name` / `player_name_aliases.search_alias` columns
it reads) is built by `afldb_normalise_name`, which treats hyphens, underscores and slashes as
*additional* word separators (migration `009_fix_name_normalisation.sql`, restated in
`099_normalise_unicode_whitespace.sql:71-91`). A hyphenated surname is therefore two words to SQL
and one opaque word to TypeScript. For "Jones", this silently drops `Darcy Byrne-Jones` and
`David Rhys-Jones` from the re-checked `plausible` set, undercounting a real 13-identity family to
11, crossing back under `NL_LIMITS.maxPlayerCandidates` (12) and ranking a confident, wrong answer
instead of declining.

A second, related defect at an earlier pipeline stage (§4) means a hyphenated or apostrophe-bearing
surname is not just miscounted in the ambiguity branch — a *full-name* mention of such a player can
lose the surname token entirely before any resolver is even called, which is directly relevant to
this issue's own required regression coverage (§9 item 5) and is folded into this plan rather than
deferred, per §6.

## 2. Evidence (from the issue report, reproduced against current code)

`resolvePlayerFamily(['jones'])` returns 13 candidates (DB evidence, unchanged). Diagnostic reproducing
the parser's own re-check tokenisation on that result: 13 resolver candidates -> 11 parser-style
plausible candidates. Dropped:

- `Darcy Byrne-Jones` — `candidateNameWords` words: `{'darcy', 'byrne-jones'}` — no word starts with
  `jones`.
- `David Rhys-Jones` — words: `{'david', 'rhys-jones'}` — no word starts with `jones`.

11 <= `NL_LIMITS.maxPlayerCandidates` (12), so `parser.ts:2785` ranks instead of declining
(`parser.ts:2778-2784`, dead-code-no-longer per ISSUE-197, now reachable and wrong here).

## 3. Exact root cause

`candidateNameWords` (`parser.ts:1829-1834`):

```ts
function candidateNameWords(c: NlPlayerCandidate): string[] {
  const words = new Set(normalisePlayerSuffixes(c.ref.name.toLowerCase()).split(/\s+/));
  if (c.matchedName) {
    for (const w of normalisePlayerSuffixes(c.matchedName.toLowerCase()).split(/\s+/)) words.add(w);
  }
  return [...words];
}
```

splits only on `\s+`. `afldb_normalise_name` (`099_normalise_unicode_whitespace.sql:71-89`):

```sql
regexp_replace(
  regexp_replace(
    regexp_replace(translate(lower(input), U+00A0..., '   '...), '[''`.,]', '', 'g'),
    '[\-_/]', ' ', 'g'),
  '\s+', ' ', 'g')
```

removes apostrophes/backticks/periods/commas, then turns hyphens, underscores and slashes into
spaces, *before* whitespace-collapsing. `players.search_name` / `player_name_aliases.search_alias`
are this function's output (kept in sync by a trigger/ETL step, not recomputed ad hoc), and
`resolvePlayerFamily`'s own `words` (`resolve.ts:219,227`,
`regexp_split_to_array(p.search_name, '\\s+')`) inherit that separator treatment for free.
`candidateNameWords` never applies it, so it drifts from the SQL side on exactly the punctuation
classes `afldb_normalise_name` was written to handle.

This is not a new mismatch invented by ISSUE-197 — `candidateNameWords` already had this gap before
ISSUE-197 (it also governs the accept branch's `nameMatches`/`justified`-token logic,
`parser.ts:2710,2729`) — but ISSUE-197 is what made a *reachable* production path exercise the
specific case (`resolvePlayerFamily` returning real hyphenated surnames as part of a genuine large
family) where the gap produces a wrong, confident answer instead of a merely-miscalibrated
certainty.

## 4. Related, closely-coupled defect: `candidatePlayerSpan`'s token filter

`candidatePlayerSpan` (`parser.ts:1806-1811`):

```ts
function candidatePlayerSpan(text: string): string | null {
  const tokens = text.split(/\s+/).filter(Boolean);
  const alphaRun = tokens.filter((t) => /^[a-z]+$/.test(t) && !STOPWORDS.has(t));
  if (alphaRun.length === 0) return null;
  return alphaRun.slice(0, 4).join(' ');
}
```

`/^[a-z]+$/` rejects *any* token containing a hyphen or an apostrophe outright — it does not loosely
match them, it drops the whole token. This runs on the reader's own text, downstream of
`canonicalise()`, whose own comment (`vocab.ts:99-100`) deliberately *preserves* hyphens and
apostrophes at that earlier stage because "`inside-fifties`", "`home-and-away`" and "`o'brien`" all
need theirs — i.e. the pipeline already knows real names carry these characters, but the one place
that turns leftover text into a player-lookup span was never updated to match.

Consequence, verified against the code (not corpus data — the V1 NL corpus has no hyphenated/
apostrophe full-name rows to have already caught this):

- A query naming a hyphenated player by their full name with the hyphen intact — e.g. "David
  Rhys-Jones most games" — loses the `rhys-jones` token entirely at this filter. `candidateRaw`
  degrades to `"david"` alone. Every "David ..." player's `search_name` starts with `"david"`, so
  every one of them ties at the prefix-tier score (500) in `searchPlayers` — at or above
  `PLAYER_ACCEPT_SCORE`, so the **accept branch** fires and silently picks whichever "David" ranks
  highest by similarity/games, which need not be David Rhys-Jones. This is a wrong-answer risk, not
  merely a miscount.
- A *bare* hyphenated or apostrophe surname with no separate given-name token surviving (e.g. a
  surname-only mention for an apostrophe-bearing player) can make `alphaRun` empty, returning `null`
  from `candidatePlayerSpan` — "no player mentioned" — rather than reaching the ambiguity logic at
  all.

Both failure shapes are the same general defect as §3, one pipeline stage earlier: a name-bearing
token is judged and consumed under plain-ASCII-alpha rules instead of the rules
`afldb_normalise_name` already encodes for exactly this class of character.

## 5. Candidate fix options

### Option A — reimplement `afldb_normalise_name`'s punctuation regex as a second TypeScript function

Rejected outright per the issue's own instruction. The project already has one incident from
exactly this shape of duplication (AFLDB-ISSUE-164/migration 099: Postgres's `\s+` regex is
ASCII-only, so a U+00A0-separated name silently failed to match `players.search_name` until the SQL
function was fixed and the *comment* on it was written specifically to warn against a second,
independently-drifting copy: "`afldb_normalise_name()` is the single canonical implementation...
TypeScript never forks it," `099_normalise_unicode_whitespace.sql:28-33`). Writing a second ad hoc
hyphen-handling regex in `parser.ts` reproduces the identical risk class this issue is itself an
instance of.

### Option B — carry SQL-normalised words on `NlPlayerCandidate` and consume them in `candidateNameWords`

`resolvePlayerFamily`'s `matched` CTE already computes exactly the right per-row `words` array
(`resolve.ts:219,227`) and currently discards it after the `plausible` filter. Extending
`NlPlayerCandidate` with an optional `searchWords?: string[]` field, populated only by
`resolvePlayerFamily`, and preferring it in `candidateNameWords` when present, closes the exact gap
in §3 with zero new TypeScript punctuation logic — it reuses the value SQL already computed.

Rejected as the primary fix: it only reaches `resolvePlayerFamily`-sourced candidates. The accept
branch's own use of `candidateNameWords` (`parser.ts:2710,2729`, fed by `resolvePlayer`/
`searchPlayers`) keeps the identical bug, and `searchPlayers` is a general-purpose query used
outside NL search (admin/typed search) — piping a new NL-only field through it, or forking a
second NL-specific query just to add one column, is a larger, less-contained change than fixing the
one function that actually has the defect. It also does not touch §4 at all, so the accept-branch
wrong-answer risk for full hyphenated names would remain.

### Option C — a small shared TypeScript tokeniser mirroring `afldb_normalise_name`'s documented punctuation contract, used at both ends of the comparison (chosen)

`afldb_normalise_name`'s punctuation behaviour is a stable, three-line, plain-English-documented
contract (`COMMENT ON FUNCTION`, `099_normalise_unicode_whitespace.sql:90-91`): apostrophes and
full stops are removed; hyphens, underscores and slashes become spaces. Unlike the Unicode-whitespace
class that caused the ISSUE-164 incident, JavaScript's `\s` already matches every Unicode space
separator Postgres's `\s+` had to be specially fixed to catch (Postgres's own regex needed
`translate()` first; V8's regex engine does not), so nothing about *that* axis needs mirroring —
only the punctuation-class axis does.

Add one small helper, e.g. `splitNameWords`, next to `normalisePlayerSuffixes`
(`parser.ts:1813-1818`), that applies exactly this documented contract to an in-memory display
string, with a comment naming the SQL function and migration as the source of truth so a future
change to either side is discoverable from the other:

```ts
function splitNameWords(name: string): string[] {
  return name
    .replace(/['’.]/g, '')
    .replace(/[-_/]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}
```

Use it in two places, both already identified as sharing the same gap:

1. `candidateNameWords` (§3) — replace `.split(/\s+/)` with `splitNameWords(...)` for both the
   canonical name and `matchedName`. Fixes the reported defect and the accept-branch's parallel,
   currently-unreproduced instance in one change.
2. `candidatePlayerSpan` (§4) — split the reader's leftover text on hyphens the same way whitespace
   is split (apostrophes stripped, not split-on, matching `afldb_normalise_name` treating them as
   deletions rather than breaks), so a hyphenated or apostrophe-bearing name survives as ordinary
   plain-alpha word tokens instead of being rejected as a single punctuation-bearing token. This
   keeps `resolvePlayer`/`resolvePlayerFamily`'s inputs exactly the same *shape* they already handle
   correctly today (multiple plain-alpha tokens) — it does not teach either resolver anything new
   about punctuation, it just stops throwing the surname away before they ever see it.

This is smaller than Option B (no type/schema change, no SQL change, `resolve.ts` untouched) and
more complete (fixes both the reported branch and the closely-related span-extraction defect with
one shared rule, not two independent patches).

## 6. Scope decision: folding in §4

§4 is a distinct code location (`candidatePlayerSpan`, one step earlier in the pipeline than
`candidateNameWords`) and, read narrowly, the issue's own reported symptom (Jones ambiguity
miscount) does not require touching it — "jones" alone has no hyphen. It is folded into this issue's
scope rather than split out because:

- the issue's own required regression coverage (goal 6 in the planning request: full-name queries
  for Darcy Byrne-Jones and David Rhys-Jones "still resolve correctly") cannot be written as a
  passing test without it — verified against current code, that test would fail today for reasons
  unrelated to `candidateNameWords`, and it is not an existing, already-passing behaviour this issue
  would otherwise be "preserving";
- it is the same general rule (hyphens/apostrophes are name-internal punctuation, not word
  boundaries the parser should choke on) applied one stage earlier, not a different subsystem;
  fixing one without the other leaves the shared rule half-applied;
- it is small (one tokenisation line) and shares the same helper as the primary fix, not a second
  investigation.

If the user prefers a strictly narrow ISSUE-198 (candidateNameWords only) with §4 tracked
separately, that is a one-line scope change to this plan before implementation — flagged here rather
than decided unilaterally past this point.

## 7. Punctuation boundary beyond hyphens (goal 7)

Applying `afldb_normalise_name`'s actual contract (not a hyphen-only special case) means this fix's
boundary is exactly:

- **Fixed by this issue:** hyphens, underscores, slashes (word breaks); apostrophes (curly and
  straight) and full stops (deletions, not breaks) — e.g. `O'Brien`, `D'Angelo`, hyphenated surnames
  like `Rhys-Jones`, `Byrne-Jones`, `McDonald-Tipungwuti`.
- **Already correct, not touched:** Unicode whitespace inside a display name (JS `\s` already
  matches it; this was the ISSUE-164 axis, specific to Postgres's regex engine, not V8's).
  Multi-word surnames separated by an ordinary space (`Van Der Berg`) already split correctly today.
- **Explicitly out of this boundary:** any other punctuation `afldb_normalise_name` does not treat
  specially (there is none currently — its character classes are exhaustive over `'`, `` ` ``, `.`,
  `,`, `-`, `_`, `/`). If a future migration adds a new class to `afldb_normalise_name`, this issue's
  TypeScript mirror (`splitNameWords`) must be updated in the same change — the comment added in §5
  is there to make that dependency visible, not to guarantee it is automatically kept in sync.

## 8. Files expected to change

- `src/search/nl/parser.ts` — new `splitNameWords` helper (near `normalisePlayerSuffixes`,
  ~`parser.ts:1813`); `candidateNameWords` (`parser.ts:1829-1834`) uses it; `candidatePlayerSpan`
  (`parser.ts:1806-1811`) tokenisation widened to treat hyphens as separators and apostrophes as
  deletions before the `^[a-z]+$` test.
- `src/search/nl/plan.ts` — `PARSER_VERSION` bump + `v50` history comment (§10).
- `tests/nl-parser.test.ts` — new unit cases (§9).
- `tests/integration/nl-semantic-mapping.test.ts` — new synthetic `FIXTURE_PREFIX` cases (§9).
- `issues.md` / `IssuesIndex.md` — already updated by this planning session; updated again on
  resolution.
- `CHANGELOG.md` — `Unreleased` entry added at implementation/resolution time, not by this plan.

No `src/db/migrations/` file, no change to `src/db/queries/nl/resolve.ts` — the root cause and its
fix are entirely on the TypeScript tokenisation side; `resolvePlayerFamily`'s SQL was already
correct (it is what exposed the TypeScript side's gap).

## 9. Test matrix

Unit (`tests/nl-parser.test.ts`, fake `ctx.resolvePlayerFamily`/`ctx.resolvePlayer`, no DB):

1. A fake 13-candidate family for a bare surname, two of whose members have a hyphenated `ref.name`
   (e.g. synthetic "Xx Byrne-Yy"), declines as ambiguous — proves the hyphenated members are no
   longer silently dropped from the re-check, so the true count (13) rather than the undercounted
   one (11) governs the `<=12`/`>12` decision.
2. The same fixture with only 12 total candidates (one hyphenated member) ranks, with the hyphenated
   member present in `scope.playerIdIn` — proves a hyphenated member counts *toward* the family, not
   just toward the decline threshold.
3. A full-name query containing a literal hyphen (e.g. "xx byrne-yy most games" against a fake
   resolver returning that one confident candidate) resolves via the accept branch with no leftover
   unjustified token — proves `candidatePlayerSpan`'s widened tokenisation and `candidateNameWords`'s
   `splitNameWords` agree end-to-end for a full name, not just a bare surname.
4. Existing ISSUE-197 unit cases (2-candidate family, exactly-12, exactly-13 with plain names,
   0/1-candidate non-ambiguity contract, the defensive non-plausible-candidate drop) pass unmodified.
5. Existing full-name accept-branch tests (Dustin Martin, the Gary Ablett exact-duplicate case) pass
   unmodified.

Integration (`tests/integration/nl-semantic-mapping.test.ts`, real `buildNlParseContext()`, synthetic
`FIXTURE_PREFIX` players — proves the production boundary, not just the parser's branch logic,
mirroring why ISSUE-197 required this level for its own fix):

6. Insert a synthetic 13-player same-surname family where two members have a hyphenated compound
   surname (distinct career games so ranking is checkable) → declines as ambiguous through the real
   `resolvePlayerFamily` + `candidateNameWords` boundary.
7. Insert the same family with one hyphenated member removed (12 total) → ranks across all 12,
   picking the correct highest-games member, hyphenated member included.
8. Insert one synthetic hyphenated-surname player and query their full name → the accept branch
   resolves them correctly (not a same-given-name decoy) — this is the test that would fail today
   without §4's fix.
9. Existing Gary Ablett Jnr/Snr suffix tests and existing alias-aware `searchPlayers` tests pass
   unmodified.

Deliberately not added as a hard assertion: a live-DB test keyed to the real "Jones" family's exact
current count (13) or the real Darcy Byrne-Jones / David Rhys-Jones rows. Following the ISSUE-197
precedent (its own §9 item 9 rationale), a synthetic fixture with a controlled, fixed shape is the
correct semantic home for the *mechanism* proof; the real "Jones" evidence is confirmed at the
corpus level instead (§11), where it belongs, and stays valid regardless of future data changes to
the real Jones family's size.

Optional, not required by the issue: one synthetic apostrophe-surname fixture (e.g. "Xx O'Yy") to
exercise the §7 boundary directly rather than only by written argument. Recommended as a small
addition at implementation time given the fix already covers it for free; not a blocking item.

## 10. Parser-version decision

**Recommend bumping `PARSER_VERSION` 49 -> 50.** Externally observable output changes for real
phrasings in both directions, exactly the standing convention (`plan.ts:479-499`, v44-v49):

- generic hyphenated/apostrophe-inclusive surname families that previously ranked a confident wrong
  answer (undercounted under the cap) now correctly decline;
- full-name mentions of hyphenated/apostrophe-surnamed players that previously silently degraded to
  a given-name-only guess (or failed to be recognised as a player mention at all) now resolve to the
  named player.

Add a `v50` history comment in the style of v44-v49 describing the fix as a tokenisation-boundary
correction between `afldb_normalise_name` and the parser's own word-splitting, not a vocabulary
change — so a future reader does not have to re-derive that, same discipline ISSUE-197's own v49
comment followed.

## 11. Corpus follow-up implications (not performed here)

Per the planning constraints: no corpus relabelling in this issue, Stage 2 stays not-closed, and the
five Jones rows (11626-11630) remain genuine failures in the V1 corpus until this issue is
implemented and validated. Once implemented:

- The five Jones rows should become clean declines, joining the six ISSUE-197 families already
  fixed (Johnson, Brown, Smith, Williams, Wilson, Anderson) — Jones was always part of the same
  35-row ISSUE-197 population; it is only failing separately because it happens to be the one
  generic-surname family in the V1 corpus whose plausible set includes hyphenated members that
  cross the cap boundary in the wrong direction.
- No other currently-passing corpus row is expected to change, since the fix only affects
  punctuation classes that were previously either mis-tokenised (hyphen/apostrophe surnames) or
  already handled correctly (plain names, plain multi-word names) — recommend confirming this with
  the same v48->v49-style full semantic re-run once implemented, before any relabelling.
- The five Ablett rows and the 168 stale team-streak/coach rows are unrelated to this issue (per
  `IssuesIndex.md`'s existing Stage 2 next-task list) and stay exactly as already planned there.

## 12. Acceptance criteria

- `Jones most games`/`most goals`/`most disposals`/`most marks`/`most tackles` decline as ambiguous
  against the real resolver (>12 plausible identities correctly counted, hyphenated members
  included) — confirmed by the corpus re-run in §11, not a live-data unit assertion.
- Hyphenated-surname candidates count toward both sides of the `<=12`/`>12` boundary (§9 items 1-2,
  6-7).
- `Ablett most games` and other existing ≤12 families still rank completely and correctly (§9 items
  4-5, 9 — no regression).
- Full-name queries for hyphenated/apostrophe-surnamed players resolve to the named player, not a
  same-given-name decoy or a decline (§9 items 3, 8).
- All existing ISSUE-197 and pre-existing suffix/alias/nickname tests pass unmodified.
- `npx tsc --noEmit` clean.
- `PARSER_VERSION` bumped with a `v50` history comment (§10).
- No corpus row relabelled by this issue; Stage 2 stays not-closed until this issue resolves and its
  own corpus re-run (§11) is reviewed separately.

## 13. Rollback/failure considerations

- Additive/narrowing change confined to two functions in `parser.ts` plus the version bump — no data
  or schema change to unwind. Rollback is reverting the touched files.
- Failure direction if `splitNameWords` under-splits (misses a real separator class): identical to
  today's bug, caught by §9's hyphenated-family tests, not a new risk.
- Failure direction if `candidatePlayerSpan`'s widened tokenisation over-admits (treats a
  non-name hyphenated leftover word, e.g. an unrecognised stat phrase, as a player-name attempt): the
  safe direction — it still fails to resolve and declines/leaves the mention unrecognised, the same
  outcome class as today's silent drop, not a new wrong-answer path (§4 analysis).
- Performance: no new DB round trip, no query change; the two touched functions are pure
  string/array operations already on the hot path at their current cost.

## 14. Explicit non-goals

- Corpus relabelling of any kind (§11).
- `resolvePlayer`/`resolvePlayerFamily` SQL changes — not required, not touched.
- The out-of-scope accept-branch `nameMatches` 5-cap gap ISSUE-197 §15 already declined to fix
  (unrelated to tokenisation; a candidate-count cap, not a word-splitting mismatch).
- Any redesign of `candidatePlayerSpan` beyond the single tokenisation-boundary fix in §5/§9 (e.g.
  raising its 4-word span limit, changing `STOPWORDS`, or handling multi-hyphen/triple-barrel names
  beyond what a hyphen-as-separator split already handles for free).

---

## Recommended implementation model/effort

**Sonnet 5, Medium-High effort** — smaller footprint than ISSUE-197 (two functions in one file, no
SQL/schema/type change) but the §4 scope-fold and the punctuation-boundary reasoning (§7) require the
same level of care as ISSUE-197's resolver-boundary work to avoid re-forking `afldb_normalise_name`.

## Summary for report

- **Root cause:** `candidateNameWords` (`parser.ts:1829-1834`) tokenises a candidate's name by plain
  whitespace-splitting, while SQL's `afldb_normalise_name` (and the `search_name`/`search_alias`
  columns `resolvePlayerFamily` reads) treats hyphens/underscores/slashes as word breaks too. A
  hyphenated surname is one TS word and two SQL words, so the parser's own defence-in-depth
  whole-word-prefix re-check silently drops hyphenated family members, undercounting Jones from 13
  to 11 and ranking a wrong answer instead of declining.
- **Exact control flow:** `resolvePlayerFamily(['jones'])` (SQL, correct) returns 13 -> parser's
  `plausible = familyCandidates.filter(candidateNameWords-based whole-word-prefix test)`
  (`parser.ts:2781-2784`, TypeScript, incomplete) drops 2 hyphenated members -> 11 -> `11 <= 12` ->
  ranks (`parser.ts:2785`) instead of declining (`parser.ts:2786-2794` region, `>12` branch).
- **Related, folded-in defect:** `candidatePlayerSpan` (`parser.ts:1806-1811`) rejects any token
  containing a hyphen or apostrophe outright, so a full-name mention of such a player can lose the
  surname before any resolver runs, degrading to a given-name-only guess (wrong-answer risk via the
  accept branch) or failing to detect a mention at all.
- **Candidate fix options:** (A) fork `afldb_normalise_name`'s regex into a second TS
  implementation — rejected, reproduces the exact ISSUE-164-class risk the codebase already has a
  documented policy against; (B) carry SQL-normalised words on `NlPlayerCandidate` for
  `resolvePlayerFamily` only — rejected, larger footprint (type/SQL change) and leaves the
  accept-branch and `candidatePlayerSpan` instances of the same gap unfixed; (C) one small shared
  `splitNameWords` helper mirroring `afldb_normalise_name`'s documented punctuation contract, used by
  both `candidateNameWords` and `candidatePlayerSpan` — chosen.
- **Files expected to change:** `src/search/nl/parser.ts`, `src/search/nl/plan.ts`,
  `tests/nl-parser.test.ts`, `tests/integration/nl-semantic-mapping.test.ts`. No migration, no
  `resolve.ts` change.
- **Test matrix:** §9 — 5 unit cases, 4 integration cases, all against synthetic fixtures, not live
  "Jones" data.
- **Risks:** low; additive/narrowing string-tokenisation change with no schema/data/query impact; the
  one over-admission risk in `candidatePlayerSpan` fails safe (decline), not wrong-answer (§13).
- **`PARSER_VERSION`:** recommend 49 -> 50 (§10) — real output changes for real phrasings, matching
  the v44-v49 convention.
- **Stage 2 status:** stays not-closed. The five Jones rows (11626-11630) remain genuine failures
  until this issue is implemented and validated; no corpus row is touched by this plan.
