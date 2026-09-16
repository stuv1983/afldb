# AFLDB-ISSUE-199 — NL stress corpus expectation cleanup after Stage 2 parser hardening

Status: **Open — planning complete** (2026-09-16, Sonnet 5). No code, corpus, or Git change made by
this session. Planning only, per the issue's own constraint. See `issues.md` for the ledger entry.

## 1. Problem statement

The unchanged V1 12,000-row stress corpus, re-run against `PARSER_VERSION` 50 (post-ISSUE-198), still
reports 173 `AMBIGUITY_NOT_DETECTED` hard failures:

| | v49 | v50 |
|---|---|---|
| total | 12000 | 12000 |
| clean | 10759 | 10764 |
| soft | 1063 | 1063 |
| hard fail | 178 | 173 |
| `AMBIGUITY_NOT_DETECTED` | 178 | 173 |
| `GRAIN_EQUIVALENT` | 72 | 72 |
| `UNEXPECTED_DECLINE` | 921 | 921 |
| `WRONG_FAILURE_REASON` | 70 | 70 |

`10764 + 1063 + 173 = 12000` and `72 + 921 + 70 = 1063` exactly — the three unrelated soft classes are
the entire soft bucket, and `AMBIGUITY_NOT_DETECTED` is the entire hard bucket. The five ISSUE-198
Jones rows (11626–11630) are the only rows that moved v49→v50; a full semantic diff confirms zero
collateral movement (1241 → 1236 non-clean, 5 fewer, 0 new, 0 changed-but-still-non-clean).

The remaining 173 hard failures are not parser defects. `tools/nl/corpus.ts`'s `AMBIGUITY_NOT_DETECTED`
class (line 419) fires whenever a row whose `expected_status` is `decline` in fact answers —
**irrespective of why the row was originally labelled decline**. All 173 rows are pre-existing corpus
rows whose decline label predates a feature that was later shipped:

- **Ablett, 5 rows (11601–11605):** labelled decline before ISSUE-197 (2026-09-16) proved the true
  Ablett family is 7 identities, ≤ `NL_LIMITS.maxPlayerCandidates` (12), so it now ranks completely
  instead of declining.
- **Team streak, 112 rows** (Adelaide 11651–11706, Brisbane Lions 11931–11986): labelled decline
  before team-streak support shipped at parser v16.
- **Coach record, 56 rows** (Adelaide 11763–11818): labelled decline before coach-record support
  shipped at parser v35 (migration 087, AFLDB-ISSUE-152 Phase B).

`5 + 112 + 56 = 173`, exactly the current hard-fail count. This is the same shape of finding as
AFLDB-ISSUE-070 (2026-08-21): a fixed corpus accumulates stale oracles as real capability ships past
it, and the fix is corpus relabelling, not application code.

## 2. Canonical corpus source — finding

**There is no in-repo generator for the V1 12,000-row stress corpus.** Verified by elimination:

- `tools/nl/afldb_nl_mass_generator.py` generates a *different* corpus: a 5-column
  `id,category,question,expected_status,tags` discovery/load corpus whose own docstring says new rows
  "deliberately use `expected_status=unknown`" — it has no concept of grain/metric/aggregation/
  verified-answer columns at all, and is not what `tools/nl/corpus.ts` reads.
- `tools/nl/generate-expanded-ui-corpus.mjs` generates the ~501-row *expanded UI corpus* consumed by
  the Playwright browser harness (`NL_UI_CORPUS`), a separate artefact from the V1 stress corpus
  (confirmed by AFLDB-ISSUE-067/069's own file lists) and also missing the rich expectation schema.
- `tools/nl/corpus.ts`'s own header comment states the actual provenance: *"The corpus was written
  against its own description of AFL semantics, not against this codebase's plan IR"* — i.e. it is an
  externally-authored artefact, not a codebase-derived one.
- No file anywhere in this repository defines the 12,000 questions, their ids, or their expected
  columns. `~/nl-stress-corpus.csv` on the dev host is itself the source of truth; `tools/nl/corpus.ts`
  is a *reader/scorer* for it, not a generator.

**Where expected verdict/status/reason is defined:** the CSV's own columns, translated by
`tools/nl/corpus.ts:toExpectation()` (`tools/nl/corpus.ts:201-259`) into a `StressExpectation`. The
relevant columns for this issue are `expected_status` (`success`/`decline`), `expected_grain`,
`expected_mode`, `expected_metric`, `expected_aggregation`, `expected_limit`, `expected_player`,
`expected_club`, `expected_failure_reason`, `expected_answer_primary`, `expected_answer_value`, plus
the identity columns `id`, `category`, `difficulty`, `verification_level`, `equivalence_group`,
`question`, `notes` that must not change.

**Consequence for this issue's approach:** goal 6 ("regenerate the stable 12,000-row corpus from its
canonical generator/source") cannot mean re-running a generator, because none exists. The correct
smallest-footprint action is a small, checked-in, self-verifying **correction script** that reads the
existing canonical CSV, rewrites only the expectation columns of the 173 named rows, leaves every
other byte of every other row untouched, and refuses to run if its assumptions about the current
(before) state of those 173 rows do not hold. This satisfies the issue's explicit instruction not to
hand-edit the file directly (i.e. not to open it and retype cells by hand, an unaudited and
unrepeatable change) while still not inventing a generator that never existed.

## 3. Where the canonical file actually lives

`~/nl-stress-corpus.csv` is on the Linux dev/build host (`README.md`'s own example path,
`tools/nl/README.md:9-13`), outside this Windows git worktree and outside the AFLDB repository proper.
Per `CLAUDE.md` §9, Claude does not execute shell/SSH commands; every step that touches the real file —
backing it up, running the correction script against it, re-running `npm run nl:stress`, diffing
results — is a command handed to the user, not executed by this session. This is also why the fix must
be a checked-in script rather than an interactively-edited file: the file cannot be inspected directly
from this session, so the script's own self-verification (§5) is the only correctness guarantee
available before the user runs it.

## 4. Exact stale-row groups, current vs. intended expectations

All three groups currently read `expected_status=decline` with some `expected_failure_reason`
(exact current string not directly observable from this session — the correction script must read and
assert it, not assume it; see §5's self-check). None of the below numeric answer values may be invented;
only what follows is directly evidenced by this planning request.

### 4a. Ablett — 11601–11605 (5 rows)

Trigger examples given: goals / games / disposals / marks / tackles, mirroring the Jones row layout
(11626 goals, 11627 games, 11628 disposals, 11629 marks, 11630 tackles) exactly one for one.

Real resolver evidence (DEV, from the issue report): the complete 7-identity family and its **games**
ranking —

| Player | Games |
|---|---|
| Gary Ablett (357-game identity) | 357 |
| Gary Ablett (248-game identity) | 248 |
| Geoff Ablett | 229 |
| Luke Ablett | 133 |
| Len Ablett | 70 |
| Kevin Ablett | 38 |
| Nathan Ablett | 34 |

The two Gary Abletts are **distinct player ids** per the issue's own instruction — do not collapse
them.

Intended expectation, all 5 rows: `expected_status=success`, `expected_grain=player_career`,
`expected_aggregation=max`, `expected_metric` = the row's own metric (`goals`/`games`/`disposals`/
`marks`/`tackles`), and the family completeness requirement (all 7 Abletts present in
`scope.playerIdIn`, none silently dropped) — this is the ISSUE-197 acceptance criterion and is what
the corpus should now assert instead of a decline.

**What is evidenced vs. what needs implementation-time verification:**

- The **games** row (11602, if the row order matches the Jones layout) can additionally carry
  `expected_answer_value=357` (`VERIFIED_RESULT` tier), since that is the one number this planning
  request directly cites from DEV evidence.
- The **goals/disposals/marks/tackles** rows (11601, 11603–11605) have no cited per-metric leader in
  this request. Per `CLAUDE.md` ("never invent evidence, root cause, validation, or resolution"), the
  correction script must **not** fabricate an `expected_answer_primary`/`expected_answer_value` for
  these four rows. Recommend leaving them at `SEMANTIC` verification level (status/grain/aggregation/
  metric only) unless the implementer separately runs the four missing leaderboard queries against
  `afldb_test`/DEV and records genuine evidence before upgrading them to `VERIFIED_RESULT`.
- **Risk to verify at implementation time, not assumed here:** the two Gary Abletts share an identical
  display name. If the corpus's `expected_answer_primary`/name-based scoring resolves a leader by
  display-name string rather than by id, a name collision between the 357-game and 248-game identities
  could make the **games** row's verified-answer check fragile even though the *ranking* itself is
  correct. Confirm how `tools/nl/stress-test.ts`/`corpus.ts` scores `answerPrimary` name collisions
  (likely via the same suffix-disambiguation precedent as the existing Ablett Jnr/Snr tests,
  `nl-semantic-mapping.test.ts:478-495`) before asserting `expected_answer_value` for that row.

### 4b. Team streak — 112 rows

- Adelaide winning streak: 11651–11678 (28 rows)
- Adelaide losing streak: 11679–11706 (28 rows)
- Brisbane Lions winning streak: 11931–11958 (28 rows)
- Brisbane Lions losing streak: 11959–11986 (28 rows)

Current parser support (`src/search/nl/plan.ts:520,963,1314-1315,1940-1947`): grain `team_streak`,
requiring `streakDefinition: { kind: 'win' | 'loss' | 'unbeaten' }`, and — per `plan.ts:1946`'s own
validation — **`metric` must be `null`** and aggregation must be `max` or `top_n` ("a team-streak
question ranks streak length", not a metric value).

Intended expectation, all 112 rows: `expected_status=success`, `expected_grain=team_streak`,
`expected_club` = Adelaide / Brisbane Lions, streak kind = `win` for the winning-streak block, `loss`
for the losing-streak block, `expected_metric` left blank (matches the `metric=null` contract),
`expected_aggregation=max` unless a specific row's question text asks for a ranked list of streaks (in
which case `top_n` + `expected_limit`, mirroring whatever an already-passing streak row for a
different club uses).

**Derivation method, not invention:** the parser has supported `team_streak` for other clubs since v16,
so the corpus almost certainly already has passing streak rows for other clubs today (that is the only
way these 921 `UNEXPECTED_DECLINE` / other-soft rows and the 10,764 clean rows are consistent with a
mature streak feature). The correction script should **read one already-passing streak row for a
different club from the same corpus and copy its non-status column shape verbatim** (same
`expected_grain`, `expected_mode` if any, `expected_aggregation`, column casing) rather than have this
plan guess the literal strings. This is the smallest-risk way to get the exact schema right without
fabricating a value this session cannot see. If no already-passing streak row exists to mirror, derive
the shape directly from `plan.ts`'s `team_streak` definition (§ above) and flag that as a materially
riskier step requiring extra review before running the script.

### 4c. Coach record — 56 rows

- Adelaide games coached: 11763–11790 (28 rows)
- Adelaide wins coached: 11791–11818 (28 rows)

Current parser support (`src/search/nl/plan.ts:537,971-984`; migration 087, AFLDB-ISSUE-152 Phase B,
parser v35): grain `coach_record`, metric `games` ("Games coached") or `wins` ("Wins"), scoped by
`expected_club=Adelaide`.

Intended expectation, all 56 rows: `expected_status=success`, `expected_grain=coach_record`,
`expected_metric=games` (first block) / `wins` (second block), `expected_club=Adelaide`,
`expected_aggregation=max` (a "who coached the most games/wins for Adelaide" leaderboard question)
unless an already-passing coach_record row for a different club shows a different shape to mirror —
same derivation method as §4b, for the same reason (the feature is documented as shipped and other
corpus rows are presumably already exercising it correctly).

## 5. The correction script

New file: `tools/nl/fix-issue-199-stale-expectations.ts`. Reuses `parseCsv`/the header-index pattern
already in `tools/nl/corpus.ts` rather than re-implementing CSV parsing (`CLAUDE.md` reuse discipline).

Behaviour:

1. Read `--corpus <path>` (the canonical file, e.g. `~/nl-stress-corpus.csv`) and `--out <path>`
   (never overwrites the input in place).
2. Parse to rows keyed by header, exactly as `corpus.ts:readCorpus` does.
3. Assert the file has exactly 12,000 data rows and that ids `11601`–`11605`, `11651`–`11706`,
   `11763`–`11818`, `11931`–`11986` are present, contiguous, and currently `expected_status=decline` —
   **fail loudly and change nothing** if any assumption does not hold (e.g. a different current
   `expected_failure_reason` string than expected, a gap in the id ranges, a row count that is not
   12,000). This is the self-check standing in for direct file inspection (§3).
4. For exactly those 173 rows, overwrite only the expectation columns per §4a/4b/4c. Every other
   column on those rows, and every column on all other 11,827 rows, is byte-identical to the input.
5. Write the result to `--out`. Print a summary: rows read, rows changed (must be exactly 173), row
   count in vs. out (must match), and the full list of changed ids (must match the 173 named above
   exactly, no more, no fewer).
6. Non-zero exit on any assertion failure (steps 3 or 5's count checks) — the script is designed to
   refuse rather than partially apply.

This keeps the fix auditable (a diffable script in Git, reviewed like any other change) and
idempotent-checkable (re-running it against its own output should report zero further changes, since
the 173 rows would already read `expected_status=success`).

## 6. Files expected to change

- **New:** `tools/nl/fix-issue-199-stale-expectations.ts` (correction script).
- **New (optional, small):** a unit test for the script's row-selection/column-rewrite logic against a
  tiny synthetic CSV fixture, mirroring `tests/nl-stress-corpus.test.ts`'s existing style — not a new
  test *file* if `tests/nl-stress-corpus.test.ts` is a sensible home; otherwise a small dedicated file
  is justified because the script is a distinct tool, not a scoring-rule change.
- **`tools/nl/README.md`:** one short addition noting the V1 corpus has no in-repo generator and is
  maintained via targeted correction scripts like this one — directly relevant documentation this
  session had to reconstruct by elimination, worth not re-discovering next time.
- **`~/nl-stress-corpus.csv` on the dev host — NOT part of this Git repository.** Updated by the user
  running the correction script and replacing the canonical file with its output, after backing up the
  original (§8).
- **`issues.md`, `IssuesIndex.md`:** this session's planning entry (already applied).
- **Not changed:** any file under `src/` (goal 11 — no parser code change), `CHANGELOG.md` (no retained
  behaviour change yet — this is planning, add at implementation/resolution time), any test that
  currently passes.

## 7. Regeneration and validation commands (user-executed, per `CLAUDE.md` §9)

```bash
# on the dev host, from ~/projects/afldb, after this issue's implementation session commits
# tools/nl/fix-issue-199-stale-expectations.ts

# 0. Back up the canonical file before touching it
cp ~/nl-stress-corpus.csv ~/nl-stress-corpus.csv.bak-issue-199

# 1. Run the correction script (writes a new file, never overwrites the input)
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
npx tsx tools/nl/fix-issue-199-stale-expectations.ts \
  --corpus ~/nl-stress-corpus.csv \
  --out ~/nl-stress-corpus-issue-199.csv

# 2. Confirm row count and changed-id count match exactly (script prints this; also verify independently)
wc -l ~/nl-stress-corpus.csv ~/nl-stress-corpus-issue-199.csv   # both 12001 lines (header + 12000)

# 3. Re-run parser v50 against the corrected corpus (full execution, not --parse-only,
#    because at least one row now carries expected_answer_value and needs SQL execution to check it)
npm run nl:stress -- --corpus ~/nl-stress-corpus-issue-199.csv --out ~/nl-stress-out-issue-199

# 4. Promote the corrected file to canonical only after step 3's result matches §9's expected shape
cp ~/nl-stress-corpus-issue-199.csv ~/nl-stress-corpus.csv
```

Validation is manual semantic comparison of `summary.json`/`report.md` between the pre-existing v50
run and the new run, per the issue's own instruction (`npm run nl:stress:compare` is not reliable for
V1 output — do not repair it here).

## 8. Expected result shape

| | v50 (unchanged corpus) | v50 (corrected corpus) |
|---|---|---|
| total | 12000 | 12000 |
| clean | 10764 | up to 10937 (+173) |
| soft | 1063 | 1063 (unchanged) |
| hard fail | 173 | 0 |
| `AMBIGUITY_NOT_DETECTED` | 173 | 0 |
| `GRAIN_EQUIVALENT` | 72 | 72 (unchanged) |
| `UNEXPECTED_DECLINE` | 921 | 921 (unchanged) |
| `WRONG_FAILURE_REASON` | 70 | 70 (unchanged) |

Do not assume the clean count reaches exactly 10937 — a row could score a *soft* finding instead of
fully clean (e.g. `WRONG_FAILURE_REASON` if the new `expected_failure_reason` guess in §4 is imprecise,
or `LOW_CONFIDENCE`), which would still discharge the hard failure without landing at the maximum
clean count. That is an acceptable outcome; a **new non-zero movement in `GRAIN_EQUIVALENT`,
`UNEXPECTED_DECLINE`, or `WRONG_FAILURE_REASON` counts is not** — those three classes must stay exactly
72/921/70 (goal 10). If they move, stop, document the exact rows and movement, and open a separate
issue rather than expanding this one (goal 11).

## 9. Risks

- The canonical CSV is outside this repo and outside this session's inspection; every "current value"
  assumption in §4 is a planning-time inference, not a verified read, and the correction script's
  self-check (§5.3) is the only guard against a wrong assumption silently corrupting the file.
- Ablett display-name collision risk for the verified `games` row (§4a).
- Team-streak/coach-record exact non-status column shapes are derived by parity with other rows in the
  same corpus, not directly evidenced (§4b/§4c) — verify a mirror row exists before running the script.
- No confirmed backup of the current canonical file exists prior to this plan; §7 step 0 is mandatory,
  not optional.
- `nl:stress:compare` is known-unreliable for V1 (goal 14) — validation is manual, which is slower and
  more error-prone than an automated diff; budget time for a careful manual read of `report.md`/
  `summary.json` rather than trusting a single number.

## 10. Does `PARSER_VERSION` change?

**No.** This issue changes corpus data only. `PARSER_VERSION` stays 50.

## 11. Is Stage 2 closeable after this issue?

**No, not fully.** This issue, once implemented and validated, discharges the entire current hard-fail
class (`AMBIGUITY_NOT_DETECTED`, 173 → 0) — the last hard-failure population Stage 2 has been tracking
since ISSUE-197/198. But three soft classes remain, exactly composing today's 1,063 soft count
(`72 + 921 + 70 = 1063`), and this issue's own scope explicitly excludes them (goal 10: "should not be
silently changed in this issue unless the source audit proves a direct expectation bug within the exact
173-row scope" — it does not). In particular `UNEXPECTED_DECLINE` at 921 rows is large enough that it
plausibly hides its own stale-corpus population (the AFLDB-ISSUE-070 precedent: data-coverage-limitation
rows and stale-oracle rows both present as "declined when the corpus expected success" style findings)
— but that is unaudited and out of this issue's scope. Stage 2's own closeout sequence
(`IssuesIndex.md`'s "Stage 2 next task" item 4, "a fresh exploratory stress sweep") is the next step
after this issue, followed by a decision on whether the three remaining soft classes need their own
triage/issue before Stage 2 can be declared complete.

## 12. Explicit non-goals (restating the planning request's constraints)

- No parser/application code change.
- No AFLW corpus involvement.
- No start of the fresh Codex exploratory corpus (separate future phase).
- No repair of `nl:stress:compare`.
- No relabelling of `GRAIN_EQUIVALENT`/`UNEXPECTED_DECLINE`/`WRONG_FAILURE_REASON` rows.
- No Git action by this planning session (per the issue's own instruction).

---

## Recommended implementation model/effort

**Sonnet 5, Medium effort.** The mechanism (a small, self-checking CSV correction script) is simpler
than ISSUE-197/198's parser-boundary work, but correctness depends on getting the exact expectation
column values right for three distinct feature shapes (family ranking, team streak, coach record)
without live access to the canonical file from a Windows session — recommend the implementation session
run on the dev host directly (or via the same worktree/SSH pattern used for ISSUE-126/137) so it can
read the real CSV's current rows before writing the script's assumptions, rather than carrying forward
this plan's inferences unverified.

## Summary for report

- **Canonical corpus source:** `~/nl-stress-corpus.csv` on the dev host — **no in-repo generator
  exists**; `tools/nl/corpus.ts` is a reader/scorer, not a generator, confirmed by its own header
  comment and by elimination against the two other, unrelated corpus generators in `tools/nl/`.
- **Stale row groups (173 total):** Ablett 11601–11605 (5), Adelaide/Brisbane Lions team streak
  11651–11706 + 11931–11986 (112), Adelaide coach record 11763–11818 (56).
- **Current vs. intended:** all 173 currently `expected_status=decline`; intended `success` with
  grain/metric/aggregation per feature (§4), with only one row (Ablett games) carrying a verified
  numeric answer — the rest are semantic-only to avoid inventing unverified leaderboard values.
- **Files expected to change:** new `tools/nl/fix-issue-199-stale-expectations.ts` (+ optional test),
  one-line `tools/nl/README.md` note, `issues.md`/`IssuesIndex.md`; the canonical CSV itself is outside
  this repository.
- **Regeneration command:** `npx tsx tools/nl/fix-issue-199-stale-expectations.ts --corpus <in> --out
  <out>`, user-run on the dev host (§7).
- **Validation commands:** `npm run nl:stress -- --corpus <corrected> --out <dir>`, manual comparison
  of `summary.json`/`report.md` against the existing v50 run (§7–8).
- **Expected result:** 12000 rows unchanged; hard fail 173 → 0; soft 1063 and its three named classes
  unchanged unless a genuine new defect surfaces (in which case: stop, document, new issue — not this
  one).
- **Risks:** unverifiable-from-here current-state assumptions (mitigated by the script's self-check),
  Ablett display-name collision, streak/coach shape derived by parity not direct evidence.
- **`PARSER_VERSION`:** unchanged at 50.
- **Stage 2 closure:** not achieved by this issue alone — the three unrelated soft classes
  (`GRAIN_EQUIVALENT` 72, `UNEXPECTED_DECLINE` 921, `WRONG_FAILURE_REASON` 70) remain open questions for
  a separate future triage.
