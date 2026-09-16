# AFLDB-ISSUE-202 — GWS club identity leaks into unsupported-term detection

**Status:** Resolved 2026-09-16 (planning 2026-09-16, implementation 2026-09-16, all Sonnet 5), on
operator validation. Second of AFLDB-ISSUE-200's three candidate defect follow-ons (Stage 2
next-task item 5b, `PARSER_BUG` / `unsupported_term|tm|gws`, 128 rows). Implementation commit
`96e40e7`. The sections below are unchanged from planning and describe the fix as designed, which
matches what was applied; see §12 for the closeout/validation record.

## 1. Confirmed root cause (planning session, direct source inspection)

### Evidence
AFLDB-ISSUE-200's real-audit cluster `unsupported_term|tm|gws` (128 rows, disposition `PARSER_BUG`,
recorded in `tools/nl/issue-200-dispositions.csv` row 4):

> team_match/H2H margin questions naming 'GWS Giants' (e.g. 'Adelaide biggest win versus GWS
> Giants' 'Adelaide worst loss to GWS Giants') decline with unsupported_term='gws' even though GWS
> Giants is a recognised club identity elsewhere in the parser/corpus identity handling. The
> recognised club-name text is leaking into unsupported-term detection for these margin templates.
> All 128 rows share this shape.

`tools/nl/corpus.ts:158-169` independently documents the same club-name gap from the stress-harness
side:

```ts
export const CORPUS_CLUB_SPELLINGS: Record<string, string> = {
  'GWS Giants': 'Greater Western Sydney',
};
```

with the comment: "The directory knows 'gws', 'giants' and 'greater western sydney' separately --
and the parser resolves 'GWS Giants' from them perfectly well -- but the exact string is not a key
[for the harness's own identity comparison]." That comment is correct about *identity resolution*
(`clubAgainst` does bind to the right organization) and silent about *token consumption*, which is
the actual defect.

### The three cooperating facts

**Fact 1 — the GWS directory entry has no combined two-word alias.**
`tools/migration/import_legacy_afl.py:84` seeds the GWS organization's row as
`("Greater Western Sydney", "Greater Western Sydney", "GWS", "GWS", None, "current", True, "NSW")`
— display name, short_name and abbreviation are `"Greater Western Sydney"` / `"GWS"` / `"GWS"`.
`CLUB_NICKNAMES` (`src/search/nl/vocab.ts:1470-1471`) separately merges in:

```ts
giants: 'greater western sydney',
gws: 'greater western sydney',
```

`buildClubDirectory` (`src/db/queries/nl/resolve.ts:57-82`) merges nicknames onto a canonical
dbName only when that literal string is already in the organization's own name-set. Both `gws` and
`giants` land on the same GWS organization, but as two *independent single-word* names. Nothing in
`clubs`, `club_aliases`, or `CLUB_NICKNAMES` contains the two-word string `"gws giants"` (or
`"greater western sydney giants"`) as a single alias.

Every other club with a colloquial multi-word form does not have this gap:
- `"western bulldogs"`, `"port adelaide"`, `"brisbane lions"` are literal db names/short_names —
  one directory entry already covers the full phrase.
- `"west coast"` + `eagles`, `"gold coast"` + `suns` are a two-word db name plus a one-word
  nickname, so a two-club question ("X biggest win versus West Coast Eagles") needs the SAME total
  of two match slots (subject + one club spanning two directory hits collapses to two hits total:
  the 2-word canonical name in one findClub call, the trailing nickname in the next) — but the
  corpus (per `tools/nl/corpus.ts`'s own translation table) only ever spells GWS as the two
  *separate*-word form `"GWS Giants"`, where neither half is the 2-word canonical name, so both
  halves compete independently for match slots rather than one already covering two words.

**Fact 2 — `extractClubs` matches at most two club-alias spans per question, one per side.**
`src/search/nl/parser.ts:189-238`, via `findClub`/`findLongestMatch`
(`src/search/nl/entities.ts:43-64`): the loop runs exactly twice (`for (let i = 0; i < 2; i++)`),
and on each iteration `findLongestMatch` scans every remaining directory name across *all* clubs
and returns the single longest string that still occurs in the shrinking working text.

For "Adelaide biggest win versus GWS Giants" (lower-cased):
- Iteration 1: candidates present in the full text are `"adelaide"` (8 chars) and, within the GWS
  span, `"gws"` (3) and `"giants"` (6). Longest overall is `"adelaide"` — matched, stripped.
- Iteration 2: remaining text is `"biggest win versus gws giants"`. Candidates are `"gws"` (3) and
  `"giants"` (6). Longest is `"giants"` — matched, entity = GWS organization (`clubAgainst` binds
  correctly), stripped.
- The loop has now used both of its two slots. `"gws"` is never looked at again.

**Fact 3 — unsupported-term detection runs over whatever token span is left after entity
extraction, with no awareness of *why* a token is unclaimed.**
`consumedSet` (`parser.ts:3779-3783`) is built from `consumedTokens` plus `clubExtraction.consumed`
— which contains `"adelaide"` and `"giants"`, not `"gws"`. `leftoverTokens`
(`parser.ts:3837-3839`) filters `totalTokens` for anything not in `consumedSet`, not a mention
token, and not the player-candidate's first word; `"gws"` passes all three checks as a real,
non-stopword, unclaimed token. `report.unsupportedTerms` (`parser.ts:3853`) records it. This
depresses `ratio` (`parser.ts:3827`) and therefore `confidence` (`parser.ts:3843`) below
`NL_CONFIDENCE.clarify`, so `tryParse` returns `{ status: 'none', reason: 'low_confidence' }`
(`parser.ts:3891`). `declineFailureReason` (`src/db/queries/nl/answer.ts:57-62`) then classifies the
decline as `unsupported_term` (because `report.unsupportedTerms.length > 0`, checked ahead of the
generic `reason` fallthrough) and the stress harness surfaces the literal string `gws`.

### Why this happens *only* for GWS in the observed 128 rows
`extractClubs`'s two-slot cap is a deliberate, correct model of "a match has a subject side and an
opponent side" — it is not itself a bug, and no other family in the 465 remaining soft rows blames
it. GWS is the one club whose corpus-conventional spelling ("GWS Giants") is assembled from two
*independent* single-word directory entries with no single alias spanning both words, so a
two-club question exhausts the slot budget one word short of covering it. Confirming that all 128
rows share this exact shape (rather than a mix of causes) is planning task §6 below, not yet
executed against the real corpus in this session.

## 2. Classification

This is root-cause category **3** from the issue framing: a normalization/directory-completeness
gap — a resolved multi-word colloquial club name does not have every one of its component tokens
marked consumed, because one of those tokens (`gws`) was never given a combined alias with the
other (`giants`). It is **not**:
- a GWS-specific bug in the *matching code* (the same gap could in principle affect any club whose
  corpus-conventional spelling splits into two single-word aliases with no combined form — GWS is
  simply the one club where the corpus actually exercises that shape);
- a generic entity-span consumption defect in `extractClubs`'s slot budget (that design is correct
  and shared by every other club without incident);
- a team-match-specific bug (the same directory gap would affect any grain that names GWS the same
  way, e.g. head-to-head; the 128-row cluster happens to be `team_match` because that is the grain
  the corpus's GWS-naming margin templates use).

## 3. Required semantics

1. `"GWS Giants"` and `"GWS"` and `"Greater Western Sydney"` and `"Greater Western Sydney Giants"`
   must all resolve to the same GWS organization in `clubFor`/`clubAgainst`/`matchup`, exactly as
   today.
2. No token belonging to a correctly-resolved club mention may survive into
   `report.unsupportedTerms`.
3. A genuinely unsupported word must still decline as `unsupported_term` — the fix must not
   suppress `gws` (or any token) globally; it must only ever be consumed when it is actually part
   of a recognised club mention.
4. `team_match`/head-to-head grain, metric, and margin semantics for GWS matchups are otherwise
   unchanged.

## 4. Proposed implementation (not yet made)

Add one entry to `CLUB_NICKNAMES` (`src/search/nl/vocab.ts`, alongside the existing `gws`/`giants`
entries at line 1470-1471):

```ts
'gws giants': 'greater western sydney',
```

`CLUB_NICKNAMES` already supports multi-word keys — `'same olds': 'essendon'`
(`vocab.ts:1458`) is existing precedent, checked with the same word-boundary regex
(`findLongestMatch`, `entities.ts:51`) that will match `"gws giants"` as one 10-character string.
Because 10 characters is longer than every other candidate in a typical question (including
`"adelaide"` at 8), `findLongestMatch` will select it as the single longest match in whichever
iteration it runs, consuming both words in one `consumed` entry and leaving nothing for
`leftoverTokens` to strand. `gws` and `giants` remain independently valid single-word nicknames for
every other phrasing (bare `"GWS"`, bare `"Giants"`, `"GWS"` paired with a different second club).

**No change is proposed to:**
- `extractClubs` / `findClub` / `findLongestMatch` (`parser.ts`, `entities.ts`) — the two-slot
  design is correct and untouched;
- `consumedSet` / `leftoverTokens` / `report.unsupportedTerms` construction (`parser.ts`) — these
  correctly report an unclaimed token today; the fix removes the token from being unclaimed, not
  the reporting logic;
- `declineFailureReason` (`src/db/queries/nl/answer.ts`) — its classification is correct given its
  inputs;
- `buildClubDirectory` / `fetchClubNames` (`src/db/queries/nl/resolve.ts`) — the merge mechanism
  already supports this without modification;
- any `team_match` grain/metric/margin code — this is purely an entity-resolution/vocabulary fix
  upstream of grain-specific logic.

This was chosen over widening `extractClubs`'s slot budget or adding post-hoc "absorb adjacent
alias of an already-matched org" logic, because those are broader, riskier changes to a shared code
path (every grain that calls `extractClubs`) to fix a gap that is fully explained by one missing
dictionary entry, and because the existing `CLUB_NICKNAMES` mechanism was built for exactly this
class of fix (see its own docstring and the `marvel`/`etihad`/`gabba` `VENUE_NICKNAMES` precedent at
`vocab.ts:1478-1499`).

## 5. Files expected to change

| File | Change |
|---|---|
| `src/search/nl/vocab.ts` | Add `'gws giants': 'greater western sydney'` to `CLUB_NICKNAMES`. |
| `tests/nl-parser.test.ts` | Add a GWS fixture entry to the fake club directory (currently absent — see §1604 comment "The fixture directory has no Sydney or GWS") and regression cases (§6). |
| `src/search/nl/plan.ts` | One-line version-log comment for `PARSER_VERSION` (if bumped — see §7). |
| `CHANGELOG.md` | `[Unreleased]` entry once implemented and validated. |
| `issues.md` / `IssuesIndex.md` | Resolution record once operator-validated. |

No migration, schema, query, or route file is expected to change.

## 6. Corpus shape verification (to run before implementation)

The issue framing requires confirming the 128 rows are not silently mixed shapes before assuming a
single fix covers all of them. This session does not have shell/DB access to the corpus files
(`/home/arm/nl-stress-v51-v3`, a remote dev-host path) or the retained ISSUE-200 audit CSV, so the
operator should run:

```bash
awk -F',' 'NR==1 || $0 ~ /gws/' /home/arm/nl-stress-v51-v3 \
  | grep -i 'gws' > /tmp/issue-202-gws-rows.csv
wc -l /tmp/issue-202-gws-rows.csv
grep -io 'gws giants\|greater western sydney' /tmp/issue-202-gws-rows.csv | sort | uniq -c
grep -io 'biggest win\|biggest loss\|worst loss' /tmp/issue-202-gws-rows.csv | sort | uniq -c
grep -io 'versus\|against\|to gws' /tmp/issue-202-gws-rows.csv | sort | uniq -c
```

(Exact column/field names depend on the corpus CSV schema used by `tools/nl/audit-issue-200-*.ts`;
adjust the `awk`/`grep` fields to match the real header before running.) Expected finding, per
`tools/nl/issue-200-dispositions.csv`'s own rationale ("All 128 rows share this shape") and
`corpus.ts`'s `CORPUS_CLUB_SPELLINGS` translation table (which only maps `"GWS Giants"`, never bare
`"GWS"`): all 128 rows literally contain the two-word string `"GWS Giants"`, split across
win/loss and versus/against/to phrasing, with GWS always as the opponent (never the subject, since
the corpus's own templates always name the fixed club as subject in these margin questions — to be
confirmed, not assumed). If the operator's run finds a different shape (e.g. any row using bare
`"GWS"` alone still failing, or GWS as the subject), stop and report the contradiction rather than
proceeding with the proposed fix as scoped.

## 7. Regression test plan

Extend `tests/nl-parser.test.ts`'s existing club-directory fixture (`FAKE_CLUBS`,
`tests/nl-parser.test.ts:16-21`) with a GWS entry, mirroring the real directory's merged names:

```ts
{ organizationId: 7, slug: 'gws', name: 'Greater Western Sydney', names: ['greater western sydney', 'gws', 'giants', 'gws giants'] },
```

Add these cases (extending the closest existing `team_match`/club-resolution describe block, not a
new file, per repository test-reuse policy):

1. **Positive — the bug's exact shape.** `"Adelaide biggest win versus GWS Giants"` (and the
   `against`/`to` and win/loss variants confirmed present in §6) plans successfully as
   `team_match`, `clubFor` = Adelaide, `clubAgainst` = GWS, and `report.unsupportedTerms` does
   **not** contain `"gws"`.
2. **Alias equivalence.** The same query with `"Greater Western Sydney"` in place of `"GWS Giants"`
   still resolves to the same `clubAgainst`, confirming the fix did not disturb the existing
   canonical-name path.
3. **Bare abbreviation still works.** `"Adelaide biggest win versus GWS"` (no `"Giants"`) resolves
   identically — this already worked before the fix (only two directory tokens are needed) and
   must keep working, proving the fix is additive, not a replacement of the existing `gws`
   nickname.
4. **Bare nickname still works.** `"Adelaide biggest win versus Giants"` resolves identically for
   the same reason.
5. **Negative — proves this is not a blanket ignore of "gws".** A query where `"gws"` is adjacent
   to a genuinely unsupported word rather than `"giants"`, e.g. `"Adelaide biggest win versus GWS
   reserves"` (or another wording confirmed to reach the same code path in the real parser), must
   still report `"reserves"` (or the chosen unsupported word) as an unsupported term and decline.
   If `"gws"` were added to a global stopword/ignore list instead of a compound alias, this case
   would silently swallow `"gws"` regardless of context; the compound-alias fix must not.
6. **Unrelated club aliases unaffected.** Existing `West Coast Eagles`/`Gold Coast Suns`/`Port
   Adelaide Power`-style regression cases (if present) continue to pass unchanged — the fix touches
   only the GWS `CLUB_NICKNAMES` entries.
7. **`nl-vocab.test.ts` (DB-backed integration test) requires no new assertions**: its existing
   "every nickname is reachable" and "no nickname resolves to more than one organization" checks
   already cover a new `CLUB_NICKNAMES` entry automatically, since the canonical value
   (`'greater western sydney'`) is already a live db name.

## 8. Stable-corpus validation plan

1. Re-run the parser-v(N) stress harness against the retained V3 corpus
   (`/home/arm/nl-stress-corpus-v3.csv`) after implementation.
2. Confirm the `unsupported_term|tm|gws` auto-cluster count moves 128 → 0.
3. Confirm the other four remaining soft families are unchanged: `STALE_CORPUS_EXPECTATION` 180,
   `PARSER_BUG` zero 15, `GRAIN_EQUIVALENT` 72, `TAXONOMY_DRIFT` 70.
4. Confirm zero new hard failures and zero new soft findings via the same before/after semantic
   diff technique used for ISSUE-199/ISSUE-201 (`tools/nl/audit-issue-200-cluster.ts` or the
   equivalent comparison step).
5. Target final benchmark: 12,000 scored / 11,663 clean / 337 soft / 0 failed (465 − 128 = 337),
   pending confirmation that no row moves in an unexpected direction.

## 9. Parser-version recommendation

**Recommend bumping `PARSER_VERSION` 51 → 52.** Repository precedent (`plan.ts:515-524`'s v51
comment; `CHANGELOG.md` entries at "bumped to 47", "bumped to 46", etc.) bumps the version whenever
a fix changes which plan a previously-declining question resolves to — exactly this case: 128
questions that previously declined `unsupported_term` will now execute a `team_match` plan.
Precedent for *not* bumping is reserved for execution/answer-layer changes with no new parser
semantics (e.g. AFLDB-ISSUE-194's `answerTeamMatch` ranking fix, `CHANGELOG.md` line 225: "No new
grain, metric, or parser semantics; `PARSER_VERSION` not bumped"). This fix changes parser output
(consumed tokens, confidence, and ultimately plan-vs-decline), so it does not fit that exception.
Do not perform the bump in this planning session.

## 10. Risks / collateral cases

- **Scope risk, mitigated:** the fix is a single data-dictionary addition; it cannot affect any
  club other than GWS, any grain other than through the shared `extractClubs` path (which is
  unchanged), or any non-GWS vocabulary.
- **False confidence risk:** confirming the "all 128 rows share this shape" claim (currently sourced
  from AFLDB-ISSUE-200's audit rationale, not independently re-verified against the raw corpus in
  this session) is a prerequisite, not a formality — see §6. If even a few rows use bare `"GWS"` (no
  `"Giants"`) and still fail, that indicates a second, different mechanism and must not be folded
  into this fix silently.
- **Test-fixture gap:** `tests/nl-parser.test.ts` currently has *no* GWS entry in its fake club
  directory at all (confirmed by grep and by the file's own comment at line 1604), so today's unit
  suite cannot exercise this bug or its fix without the fixture addition in §7.
- **No interaction expected with ISSUE-201** (career-boundary season ranges) or any of the other
  three remaining soft families (`zero` word-form, pre-1965 stale coverage, grain-equivalent,
  taxonomy-drift) — none touch club/entity resolution.

## 11. Implementation-model recommendation

This is a narrow, well-isolated, single-file data fix with a fully-traced root cause and a
precedented fix pattern (`CLUB_NICKNAMES` multi-word key, same mechanism as the existing
`marvel`/`etihad`/`gabba` `VENUE_NICKNAMES` fix). It does not require novel architectural judgement,
cross-subsystem reasoning, or resolving ambiguous tradeoffs — the main work is mechanical (add the
dictionary entry, add the fixture, add the six regression cases in §7, run the focused suite). Sonnet
5 is well-suited to implement this directly from this runbook; escalating to a different model would
not materially improve the outcome. The one genuine judgement call — confirming the 128-row shape
distribution before trusting the "one shape" assumption (§6) — depends on operator-run corpus
evidence, not model capability.

## 12. Closeout and validation record (2026-09-16)

Implemented exactly as designed in §4/§7/§9: `'gws giants': 'greater western sydney'` added to
`CLUB_NICKNAMES`; `PARSER_VERSION` 51 → 52 with a history comment; nine regression cases plus a GWS
fixture entry added to `tests/nl-parser.test.ts`. No change to `extractClubs`, `findClub`/
`findLongestMatch`, `consumedSet`/`leftoverTokens`, `declineFailureReason`, or any grain/metric/
margin code. Commit `96e40e7`.

**Local validation:** `tests/nl-parser.test.ts` 428/428 passed; `npx tsc --noEmit` clean.

**Stable V3 corpus, v51 (pre-fix baseline):** 12,000 scored / 11,535 clean / 465 soft / 0 failed
(`GRAIN_EQUIVALENT` 72, `UNEXPECTED_DECLINE` 323, `WRONG_FAILURE_REASON` 70).

**Stable V3 corpus, v52 (post-fix, corpus unchanged):** 12,000 scored / 11,735 clean / 265 soft / 0
failed (`UNEXPECTED_DECLINE` 195, `WRONG_FAILURE_REASON` 70, `GRAIN_EQUIVALENT` 0).

**v51→v52 diff:** 200 soft rows removed, 0 added, 0 semantic changes among rows still soft. Removed
`UNEXPECTED_DECLINE`: exactly the 128-row `unsupported_term|tm|gws` cluster, each confirmed
`unsupportedTerms = ['gws']` with no other failure cause. Removed `GRAIN_EQUIVALENT`: all 72
pre-existing rows.

**§8/§10 estimate vs. actual — recorded, not silently reconciled:** this runbook's stable-corpus
target (§8 item 5) forecast 337 soft (465 − 128), assuming only the `unsupported_term|tm|gws`
cluster would move and that the 72 `GRAIN_EQUIVALENT` rows were an unrelated, unaffected family
(§10's risk list explicitly says "none touch club/entity resolution" for the other soft families,
which undersold this one). The actual result cleared those 72 rows too. Operator evidence traces
this to the same fix, not a second change: the 72 rows are GWS Giants player-season
leading-goalkicker questions (e.g. "GWS Giants player with most goals in 1897", repeated through
1920) that previously accepted only as an equivalent `player_season -> player_game/sum` grain
substitution because "GWS Giants" never resolved as one full club mention. With the combined alias
in place the full phrase resolves as a single entity and these questions now match the corpus's
exact expected semantics, moving from `GRAIN_EQUIVALENT` (soft) directly to clean. This is a
normalization improvement from the same directory-completeness root cause, not scope creep — no
code outside the one `CLUB_NICKNAMES` entry changed, and the collateral-effect analysis in §10
should have anticipated it for any grain that calls the shared club-extraction path, not just
`team_match`.

**Final soft composition (265):** `UNEXPECTED_DECLINE` 195 (180 stale pre-1965 coverage
expectations + 15 `zero` word-form parser defect, both pre-existing and out of scope for this
issue) and `WRONG_FAILURE_REASON` 70 (pre-existing taxonomy-drift family, unchanged in count and
row identity). No GWS-related soft findings remain in either class.

Resolved. `issues.md`, `IssuesIndex.md` and `CHANGELOG.md` updated accordingly.
