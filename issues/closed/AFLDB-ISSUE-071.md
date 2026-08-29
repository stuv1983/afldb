# AFLDB-ISSUE-071 — Parser-v25 V2 residual failure classification

## Scope and safety

- Worktree: `D:\dev\afldb-issue-071` only.
- Investigation date: 2026-08-27.
- PostgreSQL, remote/dev deployment, browser sweeps, network access, dependency installation, migrations/importers, Git commands, and unrelated issues are out of scope.
- Acceptance is repository evidence plus DB-free deterministic tests only.
- False confident answers are worse than deterministic declines. Confidence, coverage, ambiguity, and unsupported-term protections must not be weakened to improve a corpus score.

## Authoritative issue baseline

The detailed `issues.md` entry identifies the exact subject as the parser-v25 V2 qualification run driven by `tools/nl/v2-runner.ts` over a 250,000-row corpus. The historical report was `/home/arm/nl-stress-out-codex-v25-v2/report.md`; that external report is not available or required for this DB-free audit because its headline counts and categories are retained in the repository ledger.

Recorded run results:

- 245,464 scored rows: 233,021 clean, 5,263 soft, 7,180 hard.
- 20,000 / 20,000 independently verified football-answer rows passed.
- 24,393 / 24,393 adversarial/unanswerable rows declined safely.
- 0 unsafe answers.
- 6,788 / 6,788 metamorphic groups were consistent.
- 4,536 self-contradicting corpus-oracle rows were quarantined before scoring.

Recorded residual categories:

| Category | Count | Initial issue classification |
|---|---:|---|
| Season/range `WRONG_GRAIN` / `WRONG_MODE` | 6,643 | Known product-contract versus oracle-policy tension: the corpus expects `player_game` sums while named season/range leaderboards intentionally use `player_season`. |
| Expected-plan historical coverage declines | 2,169 | Likely valid deterministic coverage declines misclassified by the oracle. |
| Wrong decline reason | 3,094 | Likely stale/over-specific decline-reason expectations; answering a decline-oracle row would be unsafe. |
| Numeric-condition `DROPPED_FILTER` / `EXTRA_FILTER` | 537 | Unresolved in the original record; requires generator/oracle inspection before any parser defect is promoted. |

The issue record gives representative phrases: `record tackles since 2010`, `most bounces in the 1960s`, and `players with 3+ goals and exactly 3 clubs`.

## Proven findings

1. No dedicated runbook existed before this audit.
2. The original first-wrong-layer classification was generated corpus/oracle classification, with only the 537-row numeric-condition cluster left as possible parser follow-up.
3. Current repository source still declares `PARSER_VERSION = 25`; no repository evidence of an ISSUE-094 implementation has yet been found in this worktree.
4. `tools/nl/v2.ts`, `tools/nl/v2-runner.ts`, `tests/nl-stress-v2.test.ts`, and `tools/nl/README.md` are the direct V2 oracle/scoring execution path. The current harness already contains an `oracleDefect()` quarantine for numeric-condition rows whose English operators contradict `expected_semantics_json`.
5. `toV2Case()` attaches `oracleDefect()` findings to each row. `v2-runner.ts` still observes every such row, writes it to `results.jsonl` and `corpus-defects.jsonl`, but excludes it from failures, aggregate rates, and metamorphic majorities. This is the exact current oracle model; no production parser threshold is involved.
6. The historical 537-row numeric cluster has a proven harness cause. Before this fix, `oracleDefect()` associated operators only by numeric value. Its documented/tested limitation allowed same-valued clauses to share all operators. Consequently, `players with 3+ goals and exactly 3 clubs` could not expose an oracle that incorrectly expected `goals eq 3` and `clubs_played gte 3`: both expected conditions saw both `gte 3` and `eq 3` and escaped quarantine. Current parser regressions independently prove the intended typed plan is `goals gte 3` plus `clubs_played eq 3` and that both same-valued conditions survive.
7. The 6,643 season/range findings are superseded by later DB-free parser evidence in `tests/nl-regression-corpus.test.ts` (`NL-025`). The current product contract is explicit: any named season scope without an explicit total/career cue elects `player_season`; an explicit `total` cue preserves the alternative summed meaning. The test records independent verified-answer evidence showing the old range-sum reading can produce a plausible but wrong career total. These rows are stale corpus expectations, not current parser defects.
8. Historical coverage refusal is an explicit typed-plan validation policy. `validatePlan()` uses `nlCoverageFor()`/`nlCoverageGap()` and declines only when the requested range has no overlap with recorded coverage; partially overlapping or unbounded ranges remain answerable. Therefore the 2,169 expected-plan rows are valid deterministic declines and must be reclassified as `plan+policy`/decline expectations, not forced to plan.
9. The V2 decline oracle intentionally treats any decline as safe, makes a differing `expected_reason` only a soft `WRONG_FAILURE_REASON`, and treats a confident plan as hard `UNSAFE_ANSWER`. The 3,094 rows therefore do not establish parser semantic defects. Their exact reason expectations must be corrected or omitted at the corpus-generator layer; globally disabling reason comparison would discard useful diagnostics and is not justified without the source rows.
10. No `AFLDB-ISSUE-094` record or implementation exists in this worktree. No ISSUE-094 semantic work was duplicated. The directly available supersession evidence is the retained parser-v25-era regression work (`NL-024`/`NL-025`); any later ISSUE-094 work remains evidence only, not part of this implementation.
11. The documented DB-free `--report-only` path is V1-only in `tools/nl/stress-test.ts`. A V2 `results.jsonl` retains canonical keys and findings but not the complete original expected semantics/answers needed to apply a changed oracle. The external V2 corpus must therefore be present for a trustworthy rebaseline; the historical result file alone is insufficient. `tools/nl/README.md` has been corrected so it no longer promises V2 report-only support.

## Rejected hypotheses

- The aggregate 7,180 hard count is not evidence of 7,180 parser bugs: the retained run proves zero unsafe answers, perfect verified-answer rows, and perfect metamorphic consistency, while the ledger explicitly identifies large oracle-policy clusters.
- A historical coverage decline must not be converted into a plan merely to satisfy an expected-plan row; current product policy treats wholly unavailable eras as unanswerable.
- The 537 numeric-condition findings are not evidence that current extraction drops or adds conditions. Existing focused parser tests cover distinct and same-valued multi-condition clauses, mixed operators, and the `at most`/`most` collision. The remaining mismatch is the value-only oracle association described above.
- The correct repair is not to ignore all decline reasons. The harness already separates safe refusal from message/reason quality; only stale per-row reason expectations should be amended.

## Final residual classification

| Historical residual category | Classification | Correct contract | Oracle action | Reason / false-positive risk |
|---|---|---|---|---|
| 6,643 season/range `WRONG_GRAIN` / `WRONG_MODE` rows | Stale expectation; current behaviour already supersedes it | **Plan** as `player_season` for a named season/range leaderboard; an explicit total cue is required for summed semantics | Retain realistic questions and regenerate their expected typed semantics | Making bare `record`/`most` range wording a career-style sum can return a plausible career total for a season-record question; retained `NL-025` evidence demonstrates that unsafe reading. |
| 2,169 historical expected-plan rows | Valid deterministic decline / coverage policy | **Decline** with `coverage_unavailable` when the requested era has no recorded overlap; plan when any requested era is covered | Retain rows as `plan+policy` decline expectations | Forcing a plan would present absent historical statistics as a real zero/no-record answer and weaken typed coverage safety. |
| 3,094 wrong-decline-reason rows | Stale or over-specific reason expectation; exact rows unavailable | **Decline** remains required | Correct the per-row reason where evidence supports it, or omit only the reason assertion; never change expected status to plan merely to remove the soft finding | The historical run proves every decline row stayed safe and zero became an unsafe answer. A wrong reason is message-quality evidence, not a semantic parser failure. |
| 537 numeric `DROPPED_FILTER` / `EXTRA_FILTER` rows | Invalid/self-contradictory expected semantics escaping the oracle's same-value blind spot | Valid English such as `3+ goals and exactly 3 clubs` should **plan** with both typed conditions (`goals gte 3`, `clubs_played eq 3`) | Quarantine contradictory expectations from scored rates while reporting their ids; regenerate corrected expectations rather than deleting valid questions | Changing the parser to match swapped operators would confidently answer a different question. The repaired independent oracle now detects known clause-field swaps. |

No recorded residual category proves an unsupported semantic request or a current parser/plan/compiler defect. No row should be silently discarded: realistic questions remain with corrected expectations; self-contradictory expectations remain auditable in `corpus-defects.jsonl` but are removed from scoring.

## Audit plan

1. Trace V2 row parsing, oracle validation, observation, scoring, severity, quarantine, and report aggregation.
2. Inspect the current typed `NlQueryPlan`, coverage validation, parser-version history, and numeric career-condition extraction path only where directly relevant.
3. Inspect existing V2 and parser regressions for every recorded residual category and reconstruct representative rows without a database.
4. Classify each residual category as stale expectation, invalid generated case, valid decline, unsupported semantic request, actual parser/plan defect, or database-dependent uncertainty.
5. If repository evidence proves an oracle defect, make the smallest change in the V2 oracle/test contract and add focused DB-free regression coverage. Change production parser/plan code only if a bounded current defect is proven.
6. Run the smallest relevant Vitest suites and optional typecheck; do not run database, browser, network, build, migration, importer, or stress commands.
7. Update this runbook after each material finding or plan change, then synchronize `issues.md` and `IssuesIndex.md`. Update `CHANGELOG.md` only for a retained behaviour/test-contract change.

## Implemented change

- `tools/nl/v2.ts`: the independent corpus checker now associates each explicit operator/value with the finite numeric-condition noun immediately following it. Known same-valued clauses can no longer exchange operators invisibly. Unknown nouns retain conservative value-only checking only when the value has one unambiguous operator.
- `tests/nl-stress-v2.test.ts`: replaced the old test that enshrined the same-value blind spot with regressions for a swapped same-value pair, a correct same-value pair, and the exact ISSUE-071 `3+ goals and exactly 3 clubs` shape.
- `tools/nl/v2-runner.ts` and `tools/nl/README.md`: updated quarantine/report wording and corrected the V1-only `--report-only` documentation.
- Production `src/search/nl/parser.ts`, `vocab.ts`, `plan.ts`, and `describe.ts` are unchanged. `PARSER_VERSION` remains 25 because parser outcomes did not change.

## Validation performed

- Current execution path and contract inspected: V2 CSV validation/row conversion, `oracleDefect()` quarantine, canonical semantics, row scoring, runner observation/report aggregation, parser numeric-condition extraction, typed plan coverage validation, and focused regressions for same-valued conditions and season-range grain election.
- Attempted `npx.cmd vitest run tests/nl-stress-v2.test.ts tests/nl-parser.test.ts tests/nl-regression-corpus.test.ts`. Vitest never started: this worktree has no `node_modules`, and `npx` attempted a registry lookup that the restricted environment denied with `EACCES`. No dependency was installed and no network request succeeded.
- Confirmed `node_modules`, `node_modules/.bin/vitest.cmd`, and local TypeScript are absent. No further agent-run test execution was attempted in that environment; the later user-run validation is recorded below.
- PASS: Node 22 direct execution of the actual DB-free `tools/nl/v2.ts` module with type stripping, covering all existing `oracleDefect()` shapes plus the new same-valued positive, swapped, conservative-unknown, and `toV2Case()` attachment cases: 11 / 11 assertions passed. Node emitted only its module-type performance warning; no assertion or runtime failure occurred.
- PASS (user-run 2026-08-27): `npm.cmd test -- tests/nl-stress-v2.test.ts tests/nl-parser.test.ts tests/nl-regression-corpus.test.ts` — 3 / 3 test files and 382 / 382 tests passed in 447 ms (`nl-stress-v2` 58 / 58, `nl-regression-corpus` 163 / 163, `nl-parser` 161 / 161). No PostgreSQL or browser was involved.

## Resolution decision: correctness proof versus rebaseline measurement

- **A — correctness proof: complete.** The defect was an oracle-only field-association error. The focused V2 suite directly proves swapped same-value operators are quarantined, correct same-value clauses are retained, unknown nouns remain conservatively unclassified, and `toV2Case()` attaches the quarantine. The parser and regression suites prove the current numeric-condition, season/range, coverage, confidence, and decline contracts remain intact. All 382 focused tests pass.
- **B — rebaseline measurement: optional follow-up.** Re-running the historical 250k corpus would quantify new aggregate/quarantine counts and allow the old 3,094 reason expectations to be enumerated. It does not prove an additional invariant of the fixed `oracleDefect()` boundary and cannot change whether the directly tested same-value contradiction is handled correctly. The corpus is external and V2 `--report-only` is unavailable, but neither fact blocks resolution.
- No PostgreSQL, compiler-result truth, browser behavior, or network-backed validation is required for this oracle-only correction. Historical coverage refusals and safe declines are unchanged.

## Current status

**RESOLVED — 2026-08-27.** The bounded corpus-oracle defect is repaired, the exact correctness boundary and neighboring parser contracts pass 382 / 382 DB-free tests, and no current production parser defect is proven. An external 250k rerun is optional aggregate rebaseline measurement, not a resolution blocker.
