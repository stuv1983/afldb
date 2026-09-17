# AFLDB-ISSUE-219 — cross-family trailing-apostrophe plural club-alias possessive fails resolution

Status: **Implementation complete 2026-09-17, reconciled onto `origin/dev` (which carries
AFLDB-ISSUE-218) the same day. Operator round-1 local verification complete: implementation and
AFLDB-ISSUE-219's own tests fully correct (10/10), broader gates 402/402, typecheck clean; the
one reported failure was a stale AFLDB-ISSUE-218 test expectation, now reconciled (§10a). Awaiting
operator round-2 re-run and host validation.**

## 0. Reconciliation (this session)

The original implementation below (§1-§9) was written against a stale baseline (`main` after
AFLDB-ISSUE-217, `PARSER_VERSION` 64) in an earlier session. This worktree was then rebased onto
`origin/dev`, which carries `AFLDB-ISSUE-218` — resolved and operator-validated, moving
`PARSER_VERSION` 64 → 65 — producing merge conflicts in `issues.md`, `src/search/nl/plan.ts` and
`tests/nl-parser.test.ts` between AFLDB-ISSUE-218's landed changes and this issue's stashed
changes. All three were resolved by keeping AFLDB-ISSUE-218's content verbatim and re-applying
this issue's changes on top of it:

- `src/search/nl/plan.ts`: AFLDB-ISSUE-218's `v65` version-history comment kept unmodified; this
  issue's own comment re-numbered `v66` (not `v65`) and `PARSER_VERSION` corrected to `65 → 66`
  (not `64 → 65`).
- `tests/nl-parser.test.ts`: the raw conflict interleaved the two issues' test blocks at the
  line level (both were appended at the same end-of-file location by independent sessions, and
  the diff aligned superficially similar lines from each). Resolved by extracting AFLDB-ISSUE-218's
  complete, unedited describe block from the pre-conflict `git show :2:...` blob and
  AFLDB-ISSUE-219's complete block from the `git show :3:...` blob, then concatenating them as two
  separate top-level `describe(...)` calls — AFLDB-ISSUE-218's block first (verbatim, untouched),
  this issue's block second (header comment updated to cross-reference AFLDB-ISSUE-218, test
  bodies unchanged).
- `issues.md`: AFLDB-ISSUE-218's resolved entry kept verbatim; this issue's entry updated to
  correct the baseline, retract the "AFLDB-ISSUE-218 does not exist" claim (see §2), and add a
  reconciliation note.

Critically, **AFLDB-ISSUE-218 never touched `canonicalise()`, `extractClubs`'s matching logic, or
the leftover-token reconciliation in `parseNlQuestion`** — its own fix was `AGG_WORDS`,
`LEADING_SCOPE_CLAUSE_REQUEST_PREFIX_RE` (a rename+widen of AFLDB-ISSUE-215's
`LEADING_FOR_CLAUSE_REQUEST_PREFIX_RE`), `TEAM_METRIC_WORDS`, and two new gated wrapper regexes —
none of which are the code path this issue's fix touches. §4 below re-verifies the root-cause
trace against the current `dev` source and confirms it is unchanged.

## 1. Problem, as given

Recognised plural club aliases followed by a trailing apostrophe fail club resolution:

```text
What was Bombers' biggest victory against Pies
-> (pre-fix) unsupported_term: bombers'

equivalent Dogs'/Lions' forms
```

To be treated as a shared club/entity-resolution defect, not patched per-builder unless
investigation proved otherwise.

## 2. AFLDB-ISSUE-218 — independently found and deferred the same defect

An earlier version of this section (written before this worktree was rebased onto `origin/dev`)
stated that `AFLDB-ISSUE-218` did not exist anywhere in the repository. That was accurate only of
the pre-rebase branch state — `origin/dev` carries it, resolved and operator-validated
2026-09-17. **`AFLDB-ISSUE-218` independently found the identical defect** while investigating
`team_match_result`'s exploratory clusters: its `team_match_result/0` (56 rows, "What was
Bombers'/Dogs'/Brisbane Lions' biggest victory/defeat...") is the same trailing-apostrophe plural
possessive-alias mechanism traced in §4 below, root-caused to the identical line in
`canonicalise()`, and — per that issue's own explicit scope discipline — **deliberately deferred**
rather than fixed inside `team_match_result`, with its own record naming this exact issue as "a
future cross-family issue candidate" (see `AFLDB-ISSUE-218.md` §3, `/0` root-cause bullet, and its
Resolution section). This is exactly the shared-layer, cross-family defect this issue's brief
asked to confirm before implementing, now confirmed a second, independent way: two separate
investigations (AFLDB-ISSUE-214 for `club_season_rank`, AFLDB-ISSUE-218 for `team_match_result/0`)
found the same root cause and both declined to patch it per-builder.

## 3. AFLDB-ISSUE-214 §10c residual evidence (verbatim from `issues.md`)

After AFLDB-ISSUE-214's fix, `club_season_rank/1` had 210 remaining rows, confirmed **not** still
failing on "season"/"seasonal" (that issue's own target):

```text
20600206  "Suns' lowest seasonal losses before 2019"          -> unsupported_term: suns'
20600323  "Pies' highest seasonal wins in 2017"                -> unsupported_term: pies'
20600424  "Western Bulldogs' highest seasonal percentage
           since 2000"                                         -> unsupported_term: bulldogs'
```

AFLDB-ISSUE-214 explicitly deferred this: "a separate, pre-existing possessive-club-alias defect
... deliberately not folded into this issue's fix and not opened as its own tracked issue in
this closeout — recorded as a follow-up candidate only."

## 4. Trace: canonicalisation/entity-resolution path (re-verified against current `dev`, post-AFLDB-ISSUE-218)

Pipeline (per CLAUDE.md §8): `canonicalise -> parse -> plan -> validate -> compile -> PostgreSQL
-> answer -> describe/render`. The defect is entirely in the first stage. Re-traced in full
against the current `dev` source (after AFLDB-ISSUE-218 landed) rather than assumed unchanged from
the original investigation — the finding is identical, since AFLDB-ISSUE-218 never touched this
code path (§0).

### 4.1 `Bombers`, `Dogs`, `Lions` (already supported)

Lowercased, untouched by either possessive strip in `canonicalise()` (`src/search/nl/vocab.ts`
~line 142). Reach `meaningfulTokens`/`extractClubs` as plain words; `extractClubs`
(`src/search/nl/parser.ts`) matches them via a `\bname\b` word-boundary regex against the
merged club/nickname directory and resolves `scope.clubFor`/`clubAgainst` correctly.

### 4.2 `Bombers'`, `Dogs'`, `Lions'` (defective)

Lowercased to `bombers'`/`dogs'`/`lions'`. `canonicalise()`'s existing possessive strip:

```ts
.replace(/['’]s\b/g, '')     // "richmond's" -> "richmond", "dusty's" -> "dusty"
```

requires a literal `s` immediately after the apostrophe. Here the apostrophe is immediately
followed by whitespace/end-of-string, not `s` — the regex does not match, and the apostrophe
survives attached to the word all the way through `canonicalise()`.

**First point of divergence — NOT club matching.** `extractClubs`'s `\bbombers\b` word-boundary
regex still matches inside the literal string `"bombers'"` (a regex `\b` boundary exists between
the word-character `s` and the non-word-character `'`), so the club identity resolves correctly
here too — `scope.clubFor`/`clubAgainst` are set. The divergence is downstream, in the final
leftover-token reconciliation at the end of `parseNlQuestion` (`src/search/nl/parser.ts`
~line 4123–4193):

```ts
const totalTokens = meaningfulTokens(normalised);              // ~line 2132
...
const allConsumed = [...consumedTokens, ...clubExtraction.consumed, ...].join(' ');
const consumedSet = new Set(meaningfulTokens(allConsumed));    // ~line 4119-4123
...
const leftoverTokens = totalTokens.filter(
  (t) => !consumedSet.has(t) && !mentionTokens.has(t) && t !== candidateRaw?.split(' ')[0],
);                                                               // ~line 4177
```

`meaningfulTokens` (`src/search/nl/parser.ts` ~line 142) does `text.split(/\s+/)` — a pure
whitespace split, so `totalTokens` contains the literal token `"bombers'"` (apostrophe attached).
`consumedSet`, by contrast, is built from `clubExtraction.consumed`, which `extractClubs` pushes
as the matched vocabulary string itself — `"bombers"` (no apostrophe), not a copy of the exact
substring the regex matched inside `text`. `"bombers'" !== "bombers"`, so
`consumedSet.has("bombers'")` is `false`, and `"bombers'"` survives as a `leftoverToken`, reported
verbatim in `report.unsupportedTerms` — reproducing AFLDB-ISSUE-214 §10c's evidence exactly.

The club was never actually unresolved; only the bookkeeping that reconciles "what did the
question say" against "what did the parser explain" ever disagreed, because one side kept the
punctuation and the other did not.

## 5. Cross-family scope (step 6: corpus search)

The exploratory corpus itself (`tools/nl/generate-exploratory-corpus-v2.mjs`'s 29,030-row output)
is generated and scored only on the operator's host (`streamanator`), not present in this
worktree, so this session traced the **generator source** directly — the same methodology prior
issues (e.g. AFLDB-ISSUE-214/215/216/217's "Scope proof") used before host validation was
available, and authoritative for which rows will exercise a trailing-apostrophe alias, since the
generator is what produces them.

`possessive()` (line 178):

```js
const possessive = (name) => `${name}${/s$/i.test(name) ? "'" : "'s"}`;
```

Any club/nickname already ending in `s` gets the bare trailing apostrophe. Used across five
distinct grain families (confirmed by direct read of each generator function, not assumed from
name similarity):

| Line | Family | Template fragment |
|---|---|---|
| 304 | `team_match_result` | `'What was',possessive(c[0]),'biggest',noun,'against',o[0],'at',v[0],t.q` |
| 333 | `team_checkpoint_collision` | `'Against',o[0]+',','what was',possessive(c[0]),'largest lead at',cp[0],t.q` |
| 342 | `q3_comeback_near_miss` | `possessive(c[0]),'largest three quarter time comeback against',o[0],t.q` |
| 344 | `q3_comeback_near_miss` | `'Find',possessive(c[0]),'record three-quarter time comeback versus',o[0],t.q` |
| 366 | `club_season_rank` | `possessive(c[0]),min?'lowest':'highest','seasonal',metric[0],t.q` — **the AFLDB-ISSUE-214 §10c residual family** |
| 389 | `team_streak` | `'What is',possessive(c[0]),'longest',kind[0],'streak against',o[0],t.q` |
| 508 | `unsupported_composition` | deliberately-unsupported feature-gap family for an unrelated reason (no `q1_deficit_overcome`-style metric exists); not part of this issue's target surface, noted only for completeness |

Every one of the first five rows shares the identical mechanism traced in §4.2 — this is a shared
`canonicalise()`/entity-resolution defect, not something owned by `team_match_result`,
`club_season`, `team_streak`, or any other individual builder, as the task brief required
investigation to confirm before implementation.

## 6. Fix

`src/search/nl/vocab.ts`, `canonicalise()`, smallest shared-layer change, no club/venue/alias
special-casing:

```ts
export function canonicalise(raw: string): string {
  let text = raw
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .replace(/[.,!?:;—–…"“”()[\]]/g, ' ');
  // AFLDB-ISSUE-219: strip a bare trailing possessive apostrophe...
  text = text.replace(/(\w)['’](?=\s|$)/g, '$1');
  for (const filler of CONVERSATIONAL_FILLER) text = text.replace(filler, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  ...
}
```

Placed immediately after the punctuation-to-space pass, so any other punctuation has already
become whitespace and a word-final apostrophe is reliably followed by a real boundary. Mirrors
the existing `'s\b` rule (already generic across every word, not club-specific) rather than
adding a new club-specific pattern. A mid-word apostrophe (`o'brien`, followed by another letter,
never a boundary) is untouched by construction — the lookahead requires whitespace or end of
string immediately after the apostrophe.

## 7. Requirement-by-requirement check

1. **Ordinary alias forms unchanged** — no apostrophe present, the new rule cannot fire; test
   `'Bombers biggest victory against Pies'` asserts identical output to the possessive form.
2. **Trailing-apostrophe aliases resolve identically** — asserted via full plan shape
   (`grain`/`metric`/`agg`/`scope.clubFor`/`scope.clubAgainst`/`streakDefinition`), not merely a
   non-decline, across three families.
3. **Multi-word club names remain correct** — `North Melbourne` (no possessive) and the combined
   `GWS Giants'` alias (possessive on the second word of a two-word alias) both tested.
4. **Player names containing apostrophes remain correct** — the pre-existing `o'brien`
   mid-word-apostrophe regression coverage is untouched (mid-word, never followed by a boundary);
   a further explicit test added under the new describe block confirms this under the new rule.
5. **Unknown words ending in apostrophes still fail closed** — `Glorbins'` (not a club, player, or
   vocabulary word) still declines; the rule strips generically exactly as the pre-existing `'s`
   rule already does for every unrecognised word, it adds no unknown-word special case. A second
   test (`"Richmond's supporters' favourite ground"`, no metric/cue) confirms stripping does not
   manufacture a plan out of an unsupported sentence.
6. **At least two distinct NL families** — three used: `team_match_result`, `club_season_rank`,
   `team_streak`.

## 8. Parser version

`PARSER_VERSION` **65 → 66** (`src/search/nl/plan.ts`) — corrected during reconciliation (§0) from
the original implementation's stale `64 → 65`, since AFLDB-ISSUE-218 already holds `64 → 65` on
`dev`. AFLDB-ISSUE-218's own `v65` version-history comment is preserved unmodified; a new `v66`
comment was added above the constant for this issue, explicitly cross-referencing both
AFLDB-ISSUE-214 and AFLDB-ISSUE-218 as the two issues that independently found and deferred this
same defect. **Justification for the bump itself (unchanged by the renumbering):** this changes
production parser output for real user input (any plural-alias possessive club/venue question
that previously declined now resolves) — the same category of change every prior bump in this
ledger reflects, not a test/tooling/corpus-only correction.

## 9. Tests added

`tests/nl-parser.test.ts`, new top-level `describe('AFLDB-ISSUE-219: ...')` block at end of file,
all DB-free:

- 4 positive cross-family cases: `team_match_result` (Bombers'/Pies'), `club_season_rank`
  (Pies', the exact AFLDB-ISSUE-214 §10c residual family), `team_streak` (Bombers'/Pies'), and a
  multi-word combined-alias `team_match_result` case (`GWS Giants'`).
- 6 regression controls: plain alias unchanged; ordinary singular `'s` possessive unchanged
  (pre-existing behaviour); multi-word club name without a possessive unchanged; a mid-word
  player apostrophe unaffected; an unknown word with a trailing apostrophe still fails closed; a
  cue-less trailing-apostrophe sentence still declines.

`Suns`/`Dogs`/`Western Bulldogs` are not in `tests/nl-parser.test.ts`'s shared `CLUBS` fixture —
the same substitution practice AFLDB-ISSUE-214 used for `Suns`/`West Coast`. `Bombers`/`Pies`/
`Lions`/`Giants` (all real plural nicknames already in the fixture) stand in; same defect
mechanism, no wording special-cased in the fix itself.

## 10. Verification — operator round 1 (2026-09-17)

`npm install` completed successfully in this previously dependency-less worktree (npm audit
remediation out of scope for this issue, per the operator's instruction).

**Focused parser suite (`tests/nl-parser.test.ts`): 605 total, 604 passed, 1 failed.**

- AFLDB-ISSUE-219's own new `describe('AFLDB-ISSUE-219: ...')` block: **10/10 passed** —
  `team_match_result`, `club_season_rank`, `team_streak`, the multi-word combined alias, and all
  six regression controls.
- The single failure was AFLDB-ISSUE-218's own `/0: deferred` test ("Bombers' biggest victory
  against Pies" ... `expect(result.status).not.toBe('plan')`) — it asserted the pre-fix deferred
  decline. **This is not an implementation regression.** AFLDB-ISSUE-218 explicitly deferred
  fixing this exact row to "a future cross-family issue" (§2 above); AFLDB-ISSUE-219 is that
  issue, and its whole purpose is to make this row return a plan instead of declining. The test
  was pinning behaviour this issue was written to change — a superseded historical expectation,
  not a correctness signal. See §10a for the reconciliation made to that test.

Broader NL gates (`nl-regression-corpus.test.ts` 163 + `nl-semantic-mapping.test.ts` 174 +
`nl-stress-corpus.test.ts` 65 = **402/402 passed**, no regression). `npm run typecheck`: **clean**.

## 10a. Stale-test reconciliation (this session, operator instruction)

Per the operator's explicit instruction, the production implementation was **not** changed to
satisfy the old test — it is correct, and the old test's assertion is what was stale.
`tests/nl-parser.test.ts`'s AFLDB-ISSUE-218 `/0: deferred` test was updated in place:

- **Renamed** from `/0: deferred -- a distinct, pre-existing possessive-club-alias defect, not
  fixed by this issue` to `/0: deferred here, resolved by AFLDB-ISSUE-219 -- the trailing-apostrophe
  possessive-alias defect`, making the historical relationship (deferred by 218, resolved by 219)
  explicit in the description rather than deleting or silently flipping it.
- **Retained**, not deleted — it still exercises the exact same query AFLDB-ISSUE-218's own
  investigation used (`"What was Bombers' biggest victory against Pies at Optus Stadium in
  2017"`, including the venue/year AFLDB-ISSUE-219's own tests don't separately cover), now as a
  cross-issue regression/handoff record instead of a decline assertion.
- **Reassigned from `parse()`/`not.toBe('plan')` to `plan()`**, now asserting the full current
  correct semantics rather than merely non-decline: `grain === 'team_match'`,
  `metric === 'win_margin'`, `agg === { kind: 'max' }`, `scope.clubFor.name === 'Essendon'`,
  `scope.clubAgainst.name === 'Collingwood'`, `scope.venue.name === 'Optus Stadium'`,
  `scope.seasonMin === 2017`, `scope.seasonMax === 2017`.
- The AFLDB-ISSUE-218 header comment above the `describe` block (which explains *why* `/0` was
  originally deferred) was left otherwise untouched — a one-sentence forward pointer was appended
  noting that the deferred issue is AFLDB-ISSUE-219 and pointing at the updated `/0` block, rather
  than rewriting AFLDB-ISSUE-218's own historical reasoning.
- Not duplicated against AFLDB-ISSUE-219's own `describe` block: this is one test, reusing
  AFLDB-ISSUE-218's original exact query (with venue and year), not a copy of any of AFLDB-ISSUE-219's
  four cross-family cases.

Exact commands for the operator to confirm the reconciliation, smallest-first:

```bash
npx vitest run tests/nl-parser.test.ts
# expect: 605/605 (604 previously-passing + the now-updated AFLDB-ISSUE-218 /0 test)

npx vitest run tests/nl-regression-corpus.test.ts tests/nl-semantic-mapping.test.ts tests/nl-stress-corpus.test.ts
# expect: 402/402, unchanged (no source touched, test-only change)

npm run typecheck
# expect: clean, unchanged
```

Broader NL semantic/stress gates already passed in round 1 (above) and are not expected to move.
Exploratory-corpus/host validation on `streamanator` follows the standard issue lifecycle
(`docs/development/WORKFLOW.md` §5) once the 605/605 re-run confirms — not run in this session.

## 11. Guardrails honoured

- No club, venue, alias, or corpus ID special-cased in `vocab.ts`.
- Apostrophes are **not** made globally ignorable — only a trailing apostrophe immediately before
  whitespace/end-of-string is stripped, mirroring the pre-existing `'s` rule exactly; a mid-word
  apostrophe is provably untouched (regression test).
- `unsupported_term`/fail-closed behaviour not weakened — two regression tests prove an
  unrecognised word and a cue-less sentence both still decline.
- Fix applied once at the shared `canonicalise()` layer, not duplicated into `team_match_result`,
  `club_season`, `team_streak`, or any other individual builder.
- No unrelated NL family touched.
- Exploratory V2 generator/scorer untouched (its `possessive()` helper was read to establish
  scope, not modified).
- AFLDB-ISSUE-218's resolved record and its `PARSER_VERSION` `v65` history entry are preserved
  unmodified by this reconciliation (§0). Its `describe('AFLDB-ISSUE-218...')` block keeps all 20
  of its original tests — 19 unchanged, plus its `/0` test updated in place per §10a (renamed and
  reassigned to assert current correct behaviour, not deleted or moved out of the block).

## 12. Resolution

**RESOLVED 2026-09-17** (Sonnet 5, operator-validated on `streamanator`). Local verification (§10):
round 1 found the implementation and AFLDB-ISSUE-219's own tests fully correct (10/10); the one
failure was a stale AFLDB-ISSUE-218 test expectation, reconciled in §10a without touching
production code; round 2 confirmed `tests/nl-parser.test.ts` 605/605, broader gates 402/402,
`typecheck` clean. Host validation (§13, run against a temporary isolated worktree — the live
`/home/arm/projects/afldb` checkout was never modified) confirmed the fix on real
host/runtime/database: exploratory V2 moved 20512 → 20876 clean (+364 / -364 soft / 0 failed / 0
regressions), reconciling exactly across five families (`club_season_rank` 210,
`team_streak` 75, `team_match_result` 56, `team_checkpoint_collision` 16,
`q3_comeback_near_miss` 7), with every one of the 364 improved questions confirmed to contain a
trailing-apostrophe alias and zero that don't. The frozen V1/"V5" corpus's 3 failing rows
(`verified_finals_without_premiership`, Nick Dal Santo → Dane Rampe tie-count) were proven, via a
decisive parser-v65-vs-v66 control against the identical current database, to be pre-existing
data/corpus drift unrelated to this fix — not a regression, not blocking resolution. Full evidence
in §14. `CHANGELOG.md` updated; `PARSER_VERSION` 66 is final for this issue.

## 13. Host-validation runbook (streamanator) — executed, GREEN 2026-09-17

This section is the exact host-validation sequence for the operator on `streamanator`, following
the same pattern AFLDB-ISSUE-214 through AFLDB-ISSUE-218 used (frozen V1/"V5" 12k stable corpus +
the 29,030-row exploratory V2 corpus, both via the current unified `npm run nl:stress` runner —
see `tools/nl/README.md`). This issue changes only `canonicalise()` (`src/search/nl/vocab.ts`); no
generator/scorer file is touched, so the exploratory V2 corpus is **not regenerated** — the same
frozen CSV AFLDB-ISSUE-218's round-2 correction already produced is reused as-is.

### 13.0 Transport problem and resolution

AFLDB-ISSUE-219's changes are staged but **uncommitted** in this Windows worktree
(`D:\dev\afldb-issue-219`, branch `sonnet/issue-219-possessive-club-aliases`). `streamanator`
cannot obtain them by checking out a branch head, because there is no commit to fetch. No
established project mechanism transports uncommitted code to a validation host (every prior
NL issue's host validation ran against an already-committed implementation commit) — this is the
first host validation to happen before a commit exists, so §13.1–§13.4 below define one, built
entirely from mechanisms this project already uses for isolation:

- **Transport**: a plain-text unified diff (`git diff`), the same artefact class this session's
  own reconciliation work was built from — small, human-diffable, and `git apply` fails loudly on
  any mismatch rather than silently applying wrong content, which is what makes it also serve as
  the identity proof (§13.2's step 3 and §13.4).
- **Isolation**: a `git worktree`, exactly the mechanism `npm run worktree:bootstrap` already uses
  for every issue implementation (WORKFLOW.md §5) — applied here to host-side validation instead.
  A worktree shares the existing repository's object database but has its own independent working
  directory and index; creating or removing one touches only `.git/worktrees/` bookkeeping in the
  main checkout, never that checkout's tracked files, untracked files, index, or `HEAD`.
- **Dependencies/env**: symlinks into the existing `/home/arm/projects/afldb` checkout's
  `node_modules` and `.env` — read-only references, nothing copied or duplicated, nothing written
  back through them (`nl:stress` is SELECT-only against the app's read-only DB role, per
  `tools/nl/README.md`'s own safety properties, unchanged by this issue).

**Nothing here touches the retained git stash** (no `git stash` command anywhere in this runbook)
**and nothing here modifies `/home/arm/projects/afldb`'s working tree, index, or `HEAD`** — every
command that reads from it is a symlink or a `git worktree`/`git rev-parse` invocation run *from*
it, never a checkout, reset, or file write *into* it. §13.6 verifies this explicitly.

### 13.1 Windows: verify state and produce the transport patch

Run from `D:\dev\afldb-issue-219`.

```bash
git status --short
# expect exactly:
#   AM AFLDB-ISSUE-219.md
#   M  IssuesIndex.md
#   M  issues.md
#   M  src/search/nl/plan.ts
#   M  src/search/nl/vocab.ts
#   M  tests/nl-parser.test.ts

git rev-parse HEAD
# record this SHA -- it must match streamanator's origin/dev tip in 13.2 step 1

git diff HEAD > /tmp/afldb-issue-219.patch
wc -l /tmp/afldb-issue-219.patch
# a few hundred lines, six files -- sanity-check against the file list above before sending it anywhere
```

`git diff HEAD` (not `--cached`) so the patch captures the full current working-tree state
regardless of staging, matching "the exact current Windows working-tree code" precisely.

### 13.2 streamanator: verify base commit, create an isolated worktree

Run from the **existing** `/home/arm/projects/afldb` checkout. This does not check out anything,
switch branches, or modify any tracked file there — `git rev-parse`/`git fetch` are read-only
against the remote, and `git worktree add` only registers a new worktree; it never touches this
checkout's own working directory.

```bash
cd /home/arm/projects/afldb
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"

git fetch origin dev
git rev-parse origin/dev
# MUST equal the SHA recorded in 13.1. If it does not, stop -- the Windows
# worktree is not based on the dev tip streamanator has, and applying the
# patch below would land on the wrong base. Do not proceed until they match.

git worktree add --detach /home/arm/nl-issue219-validation origin/dev
git status --short
# expect: clean (unchanged) -- confirms this checkout itself was not touched
```

### 13.3 Transport: copy the patch to the temp worktree

Run from Windows. `scp` a plain LF text file, then apply it by path on the remote side (not piped
through `ssh` inline) — the established transport pattern for this project.

```bash
scp /tmp/afldb-issue-219.patch streamanator:/home/arm/nl-issue219-validation/afldb-issue-219.patch
```

### 13.4 streamanator: apply the patch and prove it is the intended code

Run from the new temp worktree, **not** `/home/arm/projects/afldb`.

```bash
cd /home/arm/nl-issue219-validation

git apply --check afldb-issue-219.patch
# must succeed silently -- any error here means the base commit didn't match
# (re-check 13.2 step 1) or the patch transferred corrupted; stop and do not
# force-apply

git apply afldb-issue-219.patch
git status --short
# expect exactly the same six-file list as 13.1's git status output

grep -n "^export const PARSER_VERSION" src/search/nl/plan.ts
# expect: export const PARSER_VERSION = 66;

git diff --stat
# expect the same file list/line counts as the patch itself -- this, plus the
# clean `git apply` above, is the identity proof: git apply refuses a patch
# that does not match its base byte-for-byte, so a successful apply IS proof
# this is the exact Windows working-tree content, not merely "close"
```

### 13.5 streamanator: provide dependencies and environment safely

Symlinks only — nothing copied, nothing installed fresh, nothing written into
`/home/arm/projects/afldb`.

```bash
ln -s /home/arm/projects/afldb/node_modules /home/arm/nl-issue219-validation/node_modules
ln -s /home/arm/projects/afldb/.env /home/arm/nl-issue219-validation/.env
ls -la /home/arm/nl-issue219-validation/node_modules /home/arm/nl-issue219-validation/.env
# confirm both resolve (symlink target exists, not broken)
```

`package.json`/`package-lock.json` are unchanged by this issue, so the existing installed
`node_modules` is exactly what this code needs — no `npm install` required.

### 13.6 streamanator: run the corpus validation (unchanged logic, new working directory)

Identical to the originally-prepared steps — only `cd` changed, from `~/projects/afldb` to the
temp worktree. Corpus CSV paths are unchanged (`~/nl-stress-corpus.csv`,
`~/nl-exploratory-v2-corrected.csv` already live under the operator's home directory, outside any
checkout, so no copying is needed for them either).

```bash
cd /home/arm/nl-issue219-validation
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
```

**Step A — smallest focused check: the five affected families, parse-only.** Confirms the fix on
real host/runtime (real merged club/venue directory, real resolver) without the cost of a full
29,030-row SQL-executing run.

```bash
npm run nl:stress -- \
  --corpus ~/nl-exploratory-v2-corrected.csv \
  --category team_match_result --category team_checkpoint_collision \
  --category q3_comeback_near_miss --category club_season_rank --category team_streak \
  --parse-only --out ~/nl-issue219-families-v66
```

**Expected:** completes in well under a minute (five categories, parse-only). Then confirm no
failing row still names a trailing-apostrophe alias:

```bash
grep -iE "bombers'|dogs'|lions'|pies'|suns'|bulldogs'|giants'" ~/nl-issue219-families-v66/failures.csv || echo "CLEAN: no trailing-apostrophe alias in any failure"
```

**Expected:** `CLEAN: no trailing-apostrophe alias in any failure` — every row that used to fail on
`unsupported_term: bombers'`/`dogs'`/etc. within these five families no longer appears in
`failures.csv` at all.

**Step B — frozen V1 ("V5") stable 12,000-row corpus: no regression.** The unconditional guardrail
every prior NL issue in this series required to stay green.

```bash
npm run nl:stress -- --corpus ~/nl-stress-corpus.csv --out ~/nl-issue219-v1-v66
cat ~/nl-issue219-v1-v66/summary.json
```

**Expected:** `total: 12000, pass: 12000` (or equivalently `12000 clean / 0 soft / 0 failed`,
matching every prior round's `12000/12000/0/0`) — identical to AFLDB-ISSUE-218's own frozen V1
result. Any drop is a hard stop; do not proceed to Step C.

**Step C — exploratory V2 (29,030 rows) at v66: full gate.** Not `--parse-only` here — matches the
full-gate practice every prior issue in this series used (the corpus's few dozen `answer`-oracle
rows execute SQL; the rest score on interpretation alone).

```bash
npm run nl:stress -- --corpus ~/nl-exploratory-v2-corrected.csv --out ~/nl-issue219-v2-v66
cat ~/nl-issue219-v2-v66/summary.json
```

**Expected:** `0 failed` (the critical guardrail every issue in this series enforces — a hard
failure is worse than a decline). Clean count should be **higher** than AFLDB-ISSUE-218's own v65
result (20512 clean / 7018 soft / 0 failed) by roughly the number of trailing-apostrophe rows this
fix newly resolves — at minimum the two already-known clusters, `team_match_result/0` (56 rows)
and the `club_season_rank/1` residual (210 rows, AFLDB-ISSUE-214 §10c) — **plus** however many
additional rows `team_checkpoint_collision`, `q3_comeback_near_miss` and `team_streak` happen to
carry (their `possessive()` calls draw a random club per row, so their exact affected count is not
knowable in advance without running the corpus — Step D measures it precisely). `1500
audit-required` unchanged (untouched by this fix).

**Step D — direct plan comparison: v65 baseline vs v66 candidate.** Re-score both directories (a
normal run's `results.jsonl` carries no findings until re-scored), then diff.

```bash
# Re-score the retained AFLDB-ISSUE-218 round-2 baseline directory if its
# results.jsonl has no findings yet (skip this line if it already does):
npm run nl:stress -- --out <AFLDB-ISSUE-218's retained v65 output dir> --report-only

npm run nl:stress -- --out ~/nl-issue219-v2-v66 --report-only

npm run nl:stress:compare -- <AFLDB-ISSUE-218's retained v65 output dir> ~/nl-issue219-v2-v66
```

**Expected:**
- 0 rows regressed (rows correct/clean in v65 that become non-clean in v66) — the one number this
  comparison exists to protect.
- Every changed row belongs to one of the five families named above (`team_match_result`,
  `team_checkpoint_collision`, `q3_comeback_near_miss`, `club_season_rank`, `team_streak`), moving
  `soft → clean`.
- **Zero movement in any other family** — this fix touches `canonicalise()`, the very first
  pipeline stage every question passes through, so this is the step that proves the change did not
  leak into unrelated wording (multi-word club names, ordinary aliases, player names with
  apostrophes, or any family without a trailing-apostrophe possessive in its templates).
- The `team_match_result/0` and `club_season_rank/1` rows specifically confirmed among the changed
  set (spot-check a handful of ids/questions from the diff output against the representative
  examples in `issues.md`'s AFLDB-ISSUE-214 §10c and this issue's own §1/§3).

**Step E — reconcile and report.** Reconcile the Step C/D counts exactly (changed-row count should
equal the clean-count delta from Step C, with 0 unrelated movement), then report back:

- frozen V1: pass/total (expect 12000/12000)
- exploratory V2: scored/clean/soft/failed (expect 0 failed)
- exact clean-count delta vs the v65 baseline, and how many rows it reconciles to per family
- confirmation that 0 rows regressed and 0 rows moved outside the five named families
- `PARSER_VERSION` confirmed 66 in `run.json`/`summary.json`'s own metadata for both runs

### 13.7 Cleanup (after validation, regardless of outcome)

Run from `/home/arm/projects/afldb` — `git worktree remove` must be run from the repository that
owns the worktree metadata, and it only deletes the temp directory, never anything in the main
checkout.

```bash
cd /home/arm/projects/afldb
git worktree remove /home/arm/nl-issue219-validation --force
git worktree list
# confirm the temp entry is gone and the main checkout is not listed as removed

rm -f /home/arm/nl-issue219-validation/afldb-issue-219.patch 2>/dev/null || true
rm -f /tmp/afldb-issue-219.patch   # on Windows: delete the same file there

git status --short
# expect: clean -- proves /home/arm/projects/afldb was never modified by this runbook
```

The `nl-issue219-families-v66`/`nl-issue219-v1-v66`/`nl-issue219-v2-v66` output directories under
`~` are validation evidence, not part of the temp worktree — leave them for the record unless the
operator prefers to archive/delete them separately.

**Guardrails (unconditional, matching every prior issue in this series, plus this runbook's own
transport constraints):**
- 0 hard failures anywhere in either corpus — a hard failure is worse than the pre-fix decline and
  is grounds to stop and reopen investigation, not to proceed.
- 0 unrelated movement outside the five named families.
- No `git stash` command anywhere in this runbook — the retained stash is never touched.
- `/home/arm/projects/afldb`'s working tree, index, and `HEAD` are never modified — every step
  that reads from it does so via `git worktree`/`git rev-parse`/`git fetch` (all non-mutating to
  the working tree) or a symlink; §13.7 confirms this with a final `git status --short`.
- Do not commit, push, merge, or deploy at any point in this runbook.
- Do not update `CHANGELOG.md` or mark this issue resolved until Steps B–D all pass as expected —
  resolution is written after this report comes back, not before.

## 14. Host-validation results (streamanator) — GREEN, 2026-09-17

### 14.1 Transport and identity, confirmed

Temporary isolated worktree created from `origin/dev` at
`a98c3e4233d96f88761b550e7d91b38920880f69`. The AFLDB-ISSUE-219 patch applied cleanly
(`git apply --check` passed before the real apply — per §13.4, a clean apply is itself the
identity proof: `git apply` refuses a patch that doesn't match its base byte-for-byte).
`PARSER_VERSION` confirmed **66** on the host. The live `/home/arm/projects/afldb` checkout was
**not modified** at any point (per §13.2/§13.7's non-mutating `git worktree`/symlink-only design).

### 14.2 Host unit/integration suites (re-confirmed against the transported code)

- `tests/nl-parser.test.ts`: **605/605** passed.
- Broader NL gates (`nl-regression-corpus` + `nl-semantic-mapping` + `nl-stress-corpus`):
  **402/402** passed.
- `npm run typecheck`: **clean**.

Identical to the operator's local Windows-side round-2 results — the host copy behaves exactly
like the Windows working tree, as the transport's identity proof (§14.1) predicted it would.

### 14.3 Frozen V1/"V5" 12,000-row corpus — parse+execute against current `afldb_dev`

```text
v66: 11997 clean / 0 soft / 3 failed
```

All three failures are the same fact check, `verified_finals_without_premiership`: **Nick Dal
Santo → Dane Rampe, expected tie 1, actual tie 2.**

**Decisive control:** parser v65, same current database, same V5 corpus, same parse+execute mode
produced **exactly the same** `11997 clean / 0 soft / 3 failed`, on the exact same three rows.
Since v65 predates this issue's fix entirely, the three failures cannot be caused by it — they are
**pre-existing current-data drift against a frozen verified-answer oracle**, not an AFLDB-ISSUE-219
regression. (The earlier `12000/12000` v65 result quoted throughout this document, e.g. §13's
"identical to AFLDB-ISSUE-218's own frozen V1 result", was a **parse-only** run and so never
executed/verified these three factual answers — it is not in conflict with this finding, only
narrower in scope.)

**Disposition:** not opened as its own tracked issue in this closeout, and not folded into
AFLDB-ISSUE-219 — this is a stale verified-answer expectation in the frozen V1/"V5" corpus itself
(the same category of defect AFLDB-ISSUE-199/201/204 each corrected with a small, checked-in,
self-verifying correction script), unrelated to club-alias possessive handling. Recorded here as a
candidate for that same treatment in a future session.

### 14.4 Exploratory V2 (29,030 rows / 27,530 scored) — parse+execute against current `afldb_dev`

Using the corrected AFLDB-ISSUE-218 corpus, `/home/arm/nl-exploratory-v2-corrected.csv` — **not**
the older, pre-correction `/home/arm/nl-exploratory-v2.csv`, which still carries the 569
`team_match_result/2` oracle defect AFLDB-ISSUE-218 fixed and would misrepresent this issue's own
baseline.

| | v65 (baseline) | v66 (candidate) |
|---|---:|---:|
| Scored | 27530 | 27530 |
| Clean | 20512 | 20876 |
| Soft | 7018 | 6654 |
| Failed | 0 | 0 |
| Audit-required | 1500 | 1500 |

**Net: +364 clean / -364 soft / 0 failed / 0 hard regressions.**

**Manual row-ID reconciliation** (`failures.csv`, since `nl:stress:compare` could not — see
§14.5): v65 carried 7018 finding rows, v66 carries 6654; **364 improved, 0 regressed, 6654 still
soft** (all pre-existing, unrelated soft declines/coverage boundaries, unchanged by this fix).

**Exact improvement clusters** (sum to 364, matching the aggregate delta exactly):

| Family | Rows |
|---|---:|
| `club_season_rank` | 210 |
| `team_streak` | 75 |
| `team_match_result` | 56 |
| `team_checkpoint_collision` | 16 |
| `q3_comeback_near_miss` | 7 |
| **Total** | **364** |

`club_season_rank` (210) and `team_match_result` (56) match the two already-known, previously
counted clusters exactly — AFLDB-ISSUE-214 §10c's `club_season_rank/1` residual and
AFLDB-ISSUE-218's `team_match_result/0` cluster, both cited in this issue's own §1-§3 as the
originating residual evidence. `team_streak` (75), `team_checkpoint_collision` (16) and
`q3_comeback_near_miss` (7) are the first concrete counts for the three families this issue's
generator trace (§5) identified as sharing the mechanism but whose affected row count was not
knowable in advance (their `possessive()` calls draw a random club per row).

**Scope proof:** all 364 improved questions contain a trailing-apostrophe token; **0 improved
questions lack one** — the fix's effect is exactly, and only, on the defect it targets.

**Aliases represented** across the 364 improved rows (sums to 364):

```text
Giants'    51      Suns'      42
Bombers'   48      Tigers'    34
Pies'      45      Bulldogs'  33
Dogs'      45      Lions'     22
Swans'     44
```

### 14.5 Harness limitation, not a validation failure

`npm run nl:stress:compare` could not perform its row-severity comparison for these two runs: both
use the raw V1-style `results.jsonl` shape, and re-scoring with `--report-only` did not resolve it
— the tool continued reporting findings unavailable (see `tools/nl/compare-runs.ts`'s own
documented behaviour: a V1 `results.jsonl` written by a normal run carries no findings until
`--report-only` re-scores it, and that re-score did not produce a form the comparator could read
here). Recorded as a **harness limitation**, not a validation failure. The authoritative aggregate
totals (§14.4's table) plus the manual `failures.csv` row-ID reconciliation (§14.4) — both
independently produced from the runs' own output files — provide the same direct, row-level proof
the compare tool exists to give, and are treated as authoritative in its place.

### 14.6 Verdict

**GREEN.** All required outcomes met: the fix is confirmed correct on real host/runtime/database,
cross-family (five distinct grains, not the two the brief required a minimum of), scoped exactly
to trailing-apostrophe aliases (0 improved rows without one, 0 unrelated movement), with 0 hard
regressions anywhere — the only failing rows in either corpus (V5's three) are proven, by decisive
control, to be pre-existing data drift this fix did not cause. This issue is resolved (§12).
