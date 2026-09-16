# AFLDB-ISSUE-204 — Correct stale pre-1965/1987 finals-stat coverage expectations (180-row family)

**Status:** Implementation complete, pending operator validation (2026-09-16, Sonnet 5). Fourth and
final of AFLDB-ISSUE-200's follow-on families (Stage 2 next-task item 5d). Correction tool and tests
written; not yet run against the real corpus; not resolved.

## 0. Naming correction

This issue was requested under the working title "pre-1965 first-goal-final coverage expectations."
That title is not accurate:

- The `auto_cluster_key` for this family is `coverage_unavailable|fgf`. Per
  `buildAutoClusterKey`/`templatePrefix` (`tools/nl/audit-issue-200-extract.ts:85-87,122-137`), the
  `fgf` segment is `expected.equivalenceGroup.split('|')[0]` — a template mnemonic authored in the
  external corpus itself (`equivalence_group` column), not a value defined anywhere in this
  repository.
- The operator's direct re-inspection (2026-09-16, superseding this issue's earlier planning-session
  guess) confirms the 180 rows are disposals/marks/tackles (60 each) player-statistic questions about
  Finals/Grand Finals matches (`player_game` grain), not a "first goal of a final"
  achievement/event query. There is no `first_goal_final` achievement type anywhere in
  `src/search/nl/` or `src/lib/`.
- `fgf` = "Finals/Grand Final" (the match-type scope of the template), not "first goal final."

Ledger title: **"Correct stale pre-1965/1987 finals-stat coverage expectations."**

## 1. Operator-verified evidence (2026-09-16, superseding the prior planning session's re-derivation plan)

The earlier planning-session draft of this issue proposed a new `audit-issue-204-extract.ts` tool to
independently re-derive the 180-row family's exact composition (its old §6). That re-derivation has
since been done directly by the operator against the real parser-v53/V3 run, making the proposed
extraction tool unnecessary. The verified composition:

```text
180 rows
category: finals_grand_final
template: fgf (equivalence_group's first '|'-segment)
actual grain: player_game
actual status: decline
actual failure detail: UNEXPECTED_DECLINE: answered -> declined (coverage_unavailable)

metric: disposals 60, marks 60, tackles 60
actual match-type distribution: grand_final 90, finals 90 (parser vocabulary)
expected match-type distribution: grand_final 90, final 90 (corpus's own vocabulary --
  tools/nl/corpus.ts's MATCH_TYPES maps corpus 'final' -> parser NlMatchType 'finals')
season: 1897 through 1926 inclusive, 6 rows per season (30 seasons x 3 metrics x 2 match types = 180)

stale expectation fields on all 180 rows (before correction):
  expected_status = success
  expected_grain = player_game
  expected_mode = single
  expected_aggregation = max
  expected_failure_reason = <empty>
  expected_coverage_behavior = full
  expected_min_confidence = 0.80
```

Corroborated by two independent facts already in the repository: AFLDB-ISSUE-200's real-audit
disposition of `coverage_unavailable|fgf` (598+180+128+72+70=1063 reconciled exactly,
operator-validated), and AFLDB-ISSUE-203's own operator-run parser-v53 rerun against the *unchanged*
V3 corpus, which independently reports `UNEXPECTED_DECLINE: 180` with zero collateral movement — two
separate runs, three parser versions apart, agree on 180.

## 2. Source-of-truth coverage rule (direct source inspection)

`NL_COVERAGE`, `src/search/nl/plan.ts:1104-1144` — a module-level `Partial<Record<string, NlCoverage>>`
keyed by metric name:

```
disposals: { firstSeason: 1965, note: 'Disposals were not recorded before 1965.' },
marks:     { firstSeason: 1965, note: 'Marks were not recorded before 1965.' },
tackles:   { firstSeason: 1987, note: 'Tackles were not recorded before 1987.' },
```
(`plan.ts:1135`, `:1136`, `:1138`.)

Enforcement path:

- `nlCoverageFor(grain, metric)` (`plan.ts:1181-1195`) selects the rule by metric name; not gated by
  `coverage.grains` for these three metrics, so it applies at every grain that carries the metric,
  including `player_game`/finals.
- `nlCoverageGap(coverage, scope)` (`plan.ts:1202-1222`): `recorded = [firstSeason, +Infinity)`; the
  gap fires when the requested range never intersects that interval. `firstSeason` itself is inside
  the covered range, so the cutoff is inclusive: season 1965 disposals is answerable, season 1964 is
  not. Same for marks (1965) and tackles (1987).

**Two distinct floors, not one.** `disposals`/`marks` share `firstSeason=1965`; `tackles` is
`firstSeason=1987`. All 180 rows are at seasons 1897-1926 (§1), before both floors, so the decline is
correct for the whole family under either floor — the family is at least two subfamilies by coverage
floor, further split by match type, not one homogeneous family.

## 3. Runtime-correctness proof

`nlCoverageGap` is a pure season-interval containment test with no finals/grand-final special-casing
and no code path that could answer a pre-floor season. For every row in this family (seasons
1897-1926, metric in {disposals, marks, tackles}), `seasonMax (<=1926) < firstSeason (1965 or 1987)`,
so the gap fires unconditionally. **The runtime is already correct; this is a corpus-only
correction.** No row in this family is boundary-adjacent to either floor (the corpus does not contain
1964/1965/1986/1987 boundary-control questions — the source coverage rule in §2 is the authority for
the exact boundary, not this corpus).

## 4. Data-family reality check

`disposals`, `marks`, `tackles` are `player_game`-grain box-score columns. AFL/VFL match-statistic
collection (kicks/marks/handballs/disposals) began in 1965 and tackles specifically in 1987 — the same
floor family as behinds/kicks/handballs (also 1965, `plan.ts:1132-1134`), consistent with the AFLDB
memory convention that missing historical statistics mean "not recorded," not zero.

## 5. Implementation

**Tool:** `tools/nl/fix-issue-204-stale-coverage-expectations.ts`, following
`tools/nl/fix-issue-201-stale-boundary-expectations.ts`'s precedent (success -> decline, fail-closed on
any mismatch, self-verifying post-check that nothing else moved).

**Targeting strategy — deliberately not a hardcoded id list.** AFLDB-ISSUE-199/201 hardcoded explicit
id lists/ranges because their audits named exact ids. This issue's operator evidence (§1) names the
family's exact composition but not a literal id list, and this repository's own V3 corpus is not
carried in-repo to read ids from directly. Hardcoding a fabricated range would be exactly the kind of
guess this script's own discipline forbids. Instead:

1. Candidates are *derived* from each row's own `category` (`finals_grand_final`) and
   `equivalence_group` template prefix (`fgf`) — the same signature
   `audit-issue-200-extract.ts`'s `templatePrefix()` already uses to build the
   `coverage_unavailable|fgf` cluster key this issue corrects.
2. Every candidate is then individually re-verified against every audited old-field value from §1
   (`assertAuditedCoveragePreState`) — old status/grain/mode/aggregation/failure-reason/coverage-
   behavior/min-confidence, metric in {disposals, marks, tackles}, match type in {final, grand_final},
   a single pinned season in [1897, 1926] — and against its own question text agreeing with its
   metric/match-type/season fields (`assertQuestionMatchesRow`). A candidate that disagrees with the
   audited shape in any way aborts the whole run.
3. The accepted target set must be exactly 180, with exactly the audited 60/60/60 metric split, 90/90
   match-type split, and 30 seasons of exactly 6 rows each — the full composition from §1, not just the
   total.

**Fields changed** (mirrors `fix-issue-201...ts` exactly — same rationale, a decline row has no answer
to describe):
```ts
record.expected_status = 'decline';
record.verification_level = 'EXPECTED_DECLINE';
record.expected_failure_reason = 'coverage_unavailable';
record.expected_coverage_behavior = '';
record.expected_min_confidence = '';
```
`expected_grain`/`expected_mode`/`expected_metric`/`expected_aggregation`/`expected_season_from`/
`expected_season_to`/`expected_match_type` are **preserved** — the plan still parses to exactly that
shape; only the season range is outside coverage.

**Post-hoc self-check:** exactly 180 rows changed, zero rows outside the derived target set changed
(byte-identical field-by-field diff against the original).

**CLI:**
```bash
npx tsx tools/nl/fix-issue-204-stale-coverage-expectations.ts \
  --corpus ~/nl-stress-corpus-v3.csv --out ~/nl-stress-corpus-v4.csv
```
Refuses to overwrite `--corpus` unless `--allow-overwrite-input` is passed. Never writes to V3.

## 6. Tests

`tests/nl-issue-204-corpus-fix.test.ts`, DB-free, mirroring `tests/nl-issue-201-corpus-fix.test.ts`'s
fixture shape (a synthetic 12,000-row corpus with the 180-row target family built at ids 5000-5179,
30 seasons x 3 metrics x 2 match types, plus filler rows for the rest). Covers:

1. exactly 180 rows corrected to the established decline shape, non-target rows untouched;
2. input/output row count stays 12000;
3. row ordering preserved;
4. every non-target row byte-identical at the parsed field level;
5. input row count != 12000 refuses;
6. a target row missing (derived count drops to 179) refuses;
7. a duplicate id refuses;
8. old `expected_status` drift refuses;
9. old `expected_coverage_behavior` drift refuses;
10. question text disagreeing with its own metric/season/match-type fields refuses;
11. `expected_metric` outside disposals/marks/tackles refuses;
12. season outside 1897-1926 refuses;
13. `expected_match_type` outside final/grand_final refuses;
14. `assertAuditedCoveragePreState`/`assertQuestionMatchesRow`/`assertOutputPathIsSafe` unit-level
    checks (accept/reject cases, including the `expected_min_confidence` drift case).

## 7. Parser/runtime

Unchanged. `PARSER_VERSION` remains **53**. Nothing in this implementation touches
`src/search/nl/parser.ts`, `src/search/nl/plan.ts`, `src/db/`, or the parser version — §3 established
the runtime is already correct for this family.

## 8. Operator commands

```bash
# 1. Correction-tool focused tests
npx vitest run tests/nl-issue-204-corpus-fix.test.ts

# 2. Typecheck
npx tsc --noEmit

# 3. The real V3 -> V4 correction
npx tsx tools/nl/fix-issue-204-stale-coverage-expectations.ts \
  --corpus ~/nl-stress-corpus-v3.csv --out ~/nl-stress-corpus-v4.csv
# Expect stdout: input rows 12000, output rows 12000, target rows expected 180,
# target rows modified 180, non-target rows modified 0.

# 4. Row-count / mutation-scope proof (independent of the tool's own summary line)
wc -l ~/nl-stress-corpus-v3.csv ~/nl-stress-corpus-v4.csv   # both 12001 (header + 12000)
diff <(sort ~/nl-stress-corpus-v3.csv) <(sort ~/nl-stress-corpus-v4.csv) | grep -c '^[<>]'
# expect 360 changed lines (180 old + 180 new), i.e. exactly 180 rows differ

# 5. Full parser-v53 rerun against V4 (parser/runtime unchanged at v53)
npx tsx tools/nl/stress-test.ts --corpus ~/nl-stress-corpus-v4.csv --out ~/nl-stress-v53-v4

# 6. Compare V3-result vs V4-result soft-row summaries
cat ~/nl-stress-v53-v3/summary.txt   # or the run's printed summary -- baseline: 250 soft
cat ~/nl-stress-v53-v4/summary.txt   # expected: 70 soft (see benchmark below)

# 7. Prove the 180 old UNEXPECTED_DECLINE rows disappear and no new soft rows appear
#    (compare the two runs' soft-finding id sets directly, not just the totals)
jq -r 'select(.finding=="UNEXPECTED_DECLINE") | .id' ~/nl-stress-v53-v3/results.jsonl | sort -n > /tmp/v3-unexpected-decline-ids.txt
jq -r 'select(.finding=="UNEXPECTED_DECLINE") | .id' ~/nl-stress-v53-v4/results.jsonl | sort -n > /tmp/v4-unexpected-decline-ids.txt
wc -l /tmp/v3-unexpected-decline-ids.txt /tmp/v4-unexpected-decline-ids.txt   # 180 and 0

# 8. Confirm the remaining 70 soft rows are only the known WRONG_FAILURE_REASON family
jq -r 'select(.finding!="WRONG_FAILURE_REASON")' ~/nl-stress-v53-v4/results.jsonl | \
  jq -s 'map(select(.severity=="soft")) | length'   # expect 0
```

(Commands 4-8 use whatever exact field/output names `tools/nl/stress-test.ts` actually emits for a
run's soft findings — confirm the field names against that script's current output shape before
running verbatim, since this file does not re-verify `stress-test.ts`'s own schema.)

## 9. Expected V4 benchmark (stated, not proof)

```text
12000 scored
11930 clean
70 soft
0 failed

WRONG_FAILURE_REASON: 70
UNEXPECTED_DECLINE: 0
GRAIN_EQUIVALENT: 0
hard failures: 0
```

This arithmetic is not proof of anything on its own — the operator must compare row ids and semantics
per command 7 above, not just totals.

## 10. Residual risks / stop conditions

- If the real V3 corpus's `finals_grand_final`/`fgf` candidate count is not exactly 180, or the
  metric/match-type/season distribution does not match §1 exactly, the tool aborts and writes nothing
  — this is the intended fail-closed behaviour, not a bug to work around by loosening the derivation.
- If any candidate's old expectation fields have already drifted from §1's exact values (e.g. a prior
  partial correction), the tool aborts naming the offending row rather than silently accepting or
  rejecting it.
- The 70 `WRONG_FAILURE_REASON` taxonomy-drift rows, parser/runtime code, `PARSER_VERSION`, and any
  other historical coverage floor are explicitly out of scope and untouched by this tool.
- `CHANGELOG.md` is intentionally not yet updated — pending operator validation per task instruction.
