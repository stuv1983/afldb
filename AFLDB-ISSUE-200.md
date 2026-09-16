# AFLDB-ISSUE-200 — Audit remaining NL V2 soft findings

Status: **Dispositions assigned, final apply-dispositions run pending** (planning 2026-09-16,
tooling implemented 2026-09-16, real-evidence dispositions recorded 2026-09-16, all Sonnet 5). §4's
two scripts are written and unit-tested; the operator has run the extraction/cluster-summary pass
against the real `nl-stress-v50-cleaned/` artifacts and found exactly six auto-clusters covering all
1,063 rows. This session recorded evidence-backed dispositions for all six in the checked-in
`tools/nl/issue-200-dispositions.csv`. **Not yet done:** the final `--apply-dispositions` run
against the real audit CSV, and its printed reconciliation. No parser/planner/scorer code changes
are proposed or made here or by the tooling. See §13 below and `issues.md` for the full evidence and
implementation notes.

**Deviation from this runbook, found during implementation:** §4a describes `groupPrefix` as
"already exported logic in stress-test.ts, reused." `tools/nl/stress-test.ts`'s `groupPrefix` is
in fact a private, non-exported function. `audit-issue-200-extract.ts` carries its own
`templatePrefix`, an exact duplicate of the same one-line formula, rather than exporting a path
parameter onto the stress harness's function for this unrelated read-only tool. No behavioural
difference.

## 0. Terminology note (read first)

This repo currently overloads "V2" two different ways, and the issue title uses the corpus-file
sense, not the scorer sense:

- **The audited corpus is the V1-schema, 12,000-row regression corpus** (`tools/nl/corpus.ts` +
  `tools/nl/stress-test.ts`, scored by `StressFindingClass`/`scoreRow`). Its canonical file is
  versioned on the dev host as `~/nl-stress-corpus.csv` → `~/nl-stress-corpus-v2.csv` (the
  AFLDB-ISSUE-199 correction output) — "v2" here is the corpus file's own version suffix.
- **`tools/nl/v2.ts` / `v2-runner.ts` is a separate, unrelated scorer** for the 250,000-question
  qualification suite (`V2FindingClass`, no `GRAIN_EQUIVALENT`, different corpus schema entirely).

AFLDB-ISSUE-200 is entirely about the first one. `tools/nl/v2.ts`, `v2-runner.ts` and the 250k suite
are out of scope and not touched or read further by this issue.

## 1. Baseline (given, re-derived from `IssuesIndex.md`/`issues.md` ISSUE-199 evidence)

`npm run nl:stress -- --corpus /home/arm/nl-stress-corpus-v2.csv --parse-only --out /home/arm/nl-stress-v50-cleaned`,
`PARSER_VERSION` 50, on main `06a19939`:

| | value |
|---|---|
| total | 12000 |
| clean | 10937 |
| soft | 1063 |
| hard | 0 |
| `GRAIN_EQUIVALENT` | 72 |
| `UNEXPECTED_DECLINE` | 921 |
| `WRONG_FAILURE_REASON` | 70 |

`72 + 921 + 70 = 1063` exactly. `scoreRow` (`tools/nl/corpus.ts:398`) makes these three classes
structurally mutually exclusive per row (each fires in its own early-return branch), so every soft
row carries exactly one of these three findings — the audit CSV proposed in §4 will have exactly
1,063 rows, one per soft row, by construction, not by post-hoc deduplication.

## 2. Source material read this session

- `IssuesIndex.md`, `issues.md` §AFLDB-ISSUE-197/198/199 (full entries) — confirmed the baseline
  table above, the corpus's external/non-generated nature, and that `nl:stress:compare` is
  known-unreliable for V1 output (do not route this audit through it).
- `tools/nl/corpus.ts` — `StressExpectation` (every `expected_*` CSV column), `scoreRow` (exactly
  where and why `GRAIN_EQUIVALENT`/`UNEXPECTED_DECLINE`/`WRONG_FAILURE_REASON` fire), `verdict`.
- `tools/nl/stress-test.ts` — `RunRecord` (`{ expected, actual }`, the full per-row forensic record),
  `writeOutputs`/`buildFailuresCsv` (what `failures.csv` actually contains), `readResults`,
  `loadEntityIndex`/`saveEntityIndex` (`entity-index.json`, the DB-free re-scoring path used by
  `--report-only`).
- `tools/nl/README.md` — output file table, confirming `results.jsonl` is "every row's full forensic
  record" for V1 too, and `entity-index.json` lets re-scoring run without a database connection.
- `src/db/queries/nl/log.ts` — `NlFailureReason` (closed 10-value vocabulary): `unsupported_topic`,
  `unsupported_term`, `ambiguous_player`, `low_confidence`, `unrecognised`, `coverage_unavailable`,
  `empty_result`, `query_timeout`, `database_error`, `internal_error`.

## 3. Finding: `failures.csv` does not carry enough fields for this audit

`buildFailuresCsv` (`tools/nl/stress-test.ts:497`) writes `grain`/`metric`/`aggregation`/`player`/
`clubFor`/`clubAgainst`/`matchType` from **`actual.plan` only**. For every `UNEXPECTED_DECLINE` row
(921 of the 1,063) `actual.plan` is `null` by definition — the row declined — so those columns are
blank for exactly the rows where the corpus's *expected* grain/metric/aggregation/entities are the
one thing this audit needs. `failures.csv` also never writes any `expected_*` field at all; the
`detail` column only ever shows the one field the finding itself compared (for
`UNEXPECTED_DECLINE`: `answered -> declined (reason: terms)`, nothing else).

`results.jsonl`, by contrast, stores the complete `StressExpectation` (every corpus column, already
translated) and the complete `StressObservation` (status, failure reason, full plan when one exists,
confidence, unsupported terms, lead/tie/total) for **every** row, pass or fail — this is the correct
source. `entity-index.json` (also already written by the v50 run) lets a new script re-run
`scoreRow` exactly as the real run did, without a database, the same way `--report-only` does.

Conclusion: **extend audit tooling in `tools/nl/`, do not read `failures.csv`.** No runtime/scoring
code changes — the new script only calls the existing, unmodified `scoreRow`/`verdict` exports from
`corpus.ts`, so its classification is guaranteed identical to the real run's.

## 4. Proposed audit tooling (not yet written — proposal only)

Two small scripts, both DB-free, both isolated to `tools/nl/`, both read-only against the corpus
file and `results.jsonl`/`entity-index.json`:

### 4a. `tools/nl/audit-issue-200-extract.ts`

```
npx tsx tools/nl/audit-issue-200-extract.ts \
  --results /home/arm/nl-stress-v50-cleaned/results.jsonl \
  --entity-index /home/arm/nl-stress-v50-cleaned/entity-index.json \
  --out /home/arm/issue-200-soft-audit.csv
```

For each `RunRecord` in `results.jsonl`: load the saved `EntityIndex`, call the real
`scoreRow(expected, actual, index)`, keep only records whose findings include exactly one `soft`
finding among `GRAIN_EQUIVALENT`/`UNEXPECTED_DECLINE`/`WRONG_FAILURE_REASON` (assert-fail loudly, not
silently drop, if a row has zero or more than one — that would mean the mutual-exclusivity assumption
in §1 broke, which is itself a finding worth surfacing before auditing anything). Write one CSV row
per soft finding with these columns:

| column | source |
|---|---|
| `id` | `expected.id` |
| `class` | the finding's `class` |
| `question` | `expected.question` |
| `category` | `expected.category` |
| `template` | `groupPrefix(expected.equivalenceGroup)` (already exported logic in `stress-test.ts`, reused) |
| `expected_status` | `expected.status` |
| `expected_grain` | `expected.grain` |
| `expected_mode` | `expected.mode` |
| `expected_metric` | `expected.metric` (+ `expected_metric_alternatives` if set) |
| `expected_aggregation` | `expected.aggregation` |
| `expected_top_n` | `expected.topN` |
| `expected_player` / `expected_club` / `expected_opponent` / `expected_venue` | as named |
| `expected_season_from` / `expected_season_to` | as named |
| `expected_match_type` / `expected_boundary_event` | as named |
| `expected_conditions` | `expected.conditions`, flattened `column op value; ...` |
| `expected_failure_reason` | `expected.failureReason` |
| `expected_min_confidence` | `expected.minConfidence` |
| `actual_status` | `actual.status` |
| `actual_failure_reason` | `actual.failureReason` |
| `actual_confidence` | `actual.confidence` |
| `actual_unsupported_terms` | `actual.unsupportedTerms.join(' ')` |
| `actual_grain` / `actual_mode` / `actual_metric` / `actual_aggregation` / `actual_top_n` | from `actual.plan` when present, else blank |
| `actual_player` / `actual_club_for` / `actual_club_against` / `actual_venue` | from `actual.plan.scope` when present |
| `actual_season_min` / `actual_season_max` / `actual_match_type` | from `actual.plan.scope` when present |
| `actual_career_conditions` | from `actual.plan.careerConditions`, flattened |
| `auto_cluster_key` | heuristic, see §4b |
| `cluster` | blank — filled from the disposition-mapping join in §4c |
| `provisional_disposition` | blank — filled from the disposition-mapping join in §4c |
| `notes` | `expected.notes` (the corpus's own notes column, carried through — often already explains intent) |

This is a strict superset of the column list sketched in the issue, adding the expected/actual
entity, season, match-type and condition fields the `UNEXPECTED_DECLINE` clustering dimensions in
§6 need and `failures.csv` cannot supply.

### 4b. Heuristic `auto_cluster_key` (mechanical pre-bucketing, not the final classification)

The point of this column is to turn "eyeball 1,063 rows" into "eyeball N clusters" — it is a starting
point for §6/§7's human judgement, never itself a disposition:

- `GRAIN_EQUIVALENT` → `${expected_grain}->${actual_grain}/${actual_mode}` (the only pair the current
  `scoreRow` code path can produce is `player_season->player_game/sum`, per the comment at
  `corpus.ts:448-462` — the script computing this from data rather than assuming it is itself the
  check for whether that comment is still the whole story at 72 rows).
- `WRONG_FAILURE_REASON` → `${expected_failure_reason}->${actual_failure_reason}`.
- `UNEXPECTED_DECLINE` → `${actual_failure_reason}|${template}`, with the single most frequent
  `actual_unsupported_terms` token appended when `actual_failure_reason` is `unsupported_term` (the
  term itself is usually the semantic family — "coach", "finals", "versus" and similar).

### 4c. `tools/nl/audit-issue-200-cluster.ts`

```
npx tsx tools/nl/audit-issue-200-cluster.ts \
  --audit /home/arm/issue-200-soft-audit.csv \
  --out-summary /home/arm/issue-200-clusters.md
```

Groups the extracted CSV by `(class, auto_cluster_key)`, writes a markdown table (cluster key, row
count, 5 example `id`/`question`/`expected_*`/`actual_*` rows) — this is the artifact a human (or a
follow-on Claude session with DEV read access) actually reads to assign a `disposition` per cluster,
recorded in a small hand-written mapping file, e.g. `issue-200-dispositions.csv` with columns
`auto_cluster_key, cluster_name, disposition, follow_on_issue, rationale`. A third, trivial pass
(`--apply-dispositions issue-200-dispositions.csv`, folded into the same script) left-joins that
mapping back onto all 1,063 rows and refuses to finish if any `auto_cluster_key` present in the audit
CSV is missing from the mapping — this is the mechanical form of the "every row has a cluster and
disposition" gate in §8, and it bounds the judgement work to "one row per cluster," not 1,063.

No parser/planner/application code is touched by either script. Both are new, isolated, checked-in
`tools/nl/` files with unit coverage in `tests/` (a synthetic `results.jsonl` fixture, mirroring the
`tests/nl-issue-199-corpus-fix.test.ts` precedent) before being run for real.

## 5. Classification schema

Disposition categories (closed set), matching the eight kinds of row the issue names:

| Disposition | Meaning | Typical follow-on |
|---|---|---|
| `STALE_CORPUS_EXPECTATION` | Corpus asserts a status/grain/metric/reason that current, intentional product semantics contradicts — same shape as ISSUE-070/199. | Corpus correction script, ISSUE-199-style. |
| `PARSER_BUG` | The parser fails to recognise vocabulary/entities/patterns it should, for a semantic family it already otherwise supports. | Parser follow-on issue. |
| `PLANNER_VALIDATOR_BUG` | Parse succeeds but the planner/validator declines or mis-shapes a plan for a grain/metric it otherwise supports. | Planner follow-on issue. |
| `INTENTIONAL_CONSERVATIVE_DECLINE` | Current decline is correct product behaviour (unsupported family, genuine ambiguity, safety-motivated refusal) and the corpus's success/reason expectation is aspirational or already-correct-as-decline. | No app change; corpus correction only if the *expected reason/status* itself is wrong, else no change. |
| `TAXONOMY_DRIFT` | Decline is correct; only the *labelled reason* differs, and neither corpus nor parser is factually wrong — a wording/categorisation mismatch. | Corpus `expected_failure_reason` correction, or (if the parser's own reason choice is the less accurate of the two) a small diagnostic-ordering parser fix. |
| `GRAIN_EQUIVALENT_LEGITIMATE` | Both grains genuinely answer the question; scorer is intentionally lenient here per `corpus.ts`'s own comment. | No change — stays soft/informational, per the issue's explicit instruction not to chase 100% clean. |
| `SCORER_HARNESS_ARTIFACT` | The comparison in `corpus.ts`/`stress-test.ts` itself is too strict or too loose for this row, independent of parser/planner correctness. | Scorer fix in `tools/nl/` only. |
| `DUPLICATE_MANIFESTATION` | Same root cause as another cluster already carrying a follow-on issue; tracked individually in the CSV but not double-counted toward a second issue. | Rides the other cluster's follow-on issue; `follow_on_issue` column points at it. |

Rule for promoting a cluster: a cluster becomes a **new tracked issue** only when its disposition is
`PARSER_BUG`, `PLANNER_VALIDATOR_BUG`, or `SCORER_HARNESS_ARTIFACT` *and* it is not a
`DUPLICATE_MANIFESTATION` of an already-opened cluster in this same audit pass — matching
`CLAUDE.md` §5's bar for a tracked issue (reproducible defect, not routine/cosmetic). A
`STALE_CORPUS_EXPECTATION` or `TAXONOMY_DRIFT` cluster becomes a **corpus-correction task**
(ISSUE-199-style script), not necessarily its own numbered issue, unless the correction itself is
non-trivial enough to need cross-session handoff. `INTENTIONAL_CONSERVATIVE_DECLINE` and
`GRAIN_EQUIVALENT_LEGITIMATE` clusters get **no change** — logged as audited-and-accepted in the
closeout evidence only.

## 6. Audit order and dimensions

Audit `GRAIN_EQUIVALENT` (72) and `WRONG_FAILURE_REASON` (70) first — both small, both already
narrowly characterised by §4b's exact-transition key, both plausibly one or two clusters each.
`UNEXPECTED_DECLINE` (921) last, clustered along the dimensions the issue lists (player/club/coach
resolution, numeric/comparator binding, career-vs-season scope, metric recognition,
aggregation/top-N, season/time boundaries, finals/premiership semantics, venue, H2H, relationships,
unsupported composition, ambiguity handling, tokenisation/punctuation) — `auto_cluster_key`
(`actual_failure_reason` + `template` + top unsupported term) is the mechanical starting split; the
human/agent pass over `issue-200-clusters.md` is what actually names and merges clusters along these
dimensions, since the corpus's own `template`/`category`/`equivalenceGroup` values are exactly what
was generated per semantic family and should line up with most of them directly.

## 7. Gate for "all 1,063 rows audited"

- The extraction script (§4a) produces exactly 1,063 rows, and its own internal assertion (exactly
  one soft finding per row) passed.
- Every `auto_cluster_key` present in the extracted CSV has a row in `issue-200-dispositions.csv`
  (mechanically enforced by `--apply-dispositions`, §4c).
- The joined CSV's `disposition` column has zero blank values across all 1,063 rows.
- Re-grouping the joined CSV by `class` reproduces exactly 72 / 921 / 70.
- Re-grouping by `disposition` sums to exactly 1,063.
- Every cluster promoted to `PARSER_BUG`/`PLANNER_VALIDATOR_BUG`/`SCORER_HARNESS_ARTIFACT` has, in
  `issue-200-clusters.md`, at least: the cluster's row count, 3+ example questions with expected vs.
  actual, and a one-paragraph root-cause hypothesis citing the specific parser/planner code path —
  the same evidentiary bar ISSUE-197/198 met before their runbooks were approved.
- No cluster is marked `STALE_CORPUS_EXPECTATION` or `INTENTIONAL_CONSERVATIVE_DECLINE` merely
  because that reduces the soft count — each such disposition must cite the current supported
  semantics (a specific parser/planner code path, test, or `docs/` rule) that makes the corpus
  expectation wrong, exactly as ISSUE-199's per-group evidence did.

## 8. Evidence format for ISSUE-200 closeout

Mirroring ISSUE-199's ledger style: an aggregate table (not the raw 1,063-row CSV) in `issues.md`,
of the shape:

| class | disposition | clusters | rows | follow-on |
|---|---|---|---|---|
| `GRAIN_EQUIVALENT` | `GRAIN_EQUIVALENT_LEGITIMATE` | 1 | 72 | none |
| `WRONG_FAILURE_REASON` | `TAXONOMY_DRIFT` | … | … | corpus correction (ISSUE-2xx) |
| `UNEXPECTED_DECLINE` | `PARSER_BUG` | … | … | ISSUE-2xx |
| … | | | | |
| **Total** | | | **1063** | |

plus a named list of every follow-on issue opened (or explicitly deferred, with reason), and the
counts-reconcile checks from §7 stated explicitly as satisfied. The per-row audit CSV and cluster
summary stay as retained DEV artifacts (like `nl-stress-v50-cleaned/`), referenced by path, not
pasted in full.

## 9. Recommended sequence after this audit

1. Run §4a/§4b/§4c tooling on DEV against the existing `nl-stress-v50-cleaned` artifacts (no new
   stress run needed — the baseline is already current).
2. Produce the closeout evidence table (§8); this discharges ISSUE-200 itself.
3. Open follow-on issues only for clusters disposed `PARSER_BUG`/`PLANNER_VALIDATOR_BUG`/
   `SCORER_HARNESS_ARTIFACT`, smallest/most-isolated root cause first (matching the
   ISSUE-197→198→199 sequencing precedent — each landed before the next was scoped).
4. Run the `STALE_CORPUS_EXPECTATION`/`TAXONOMY_DRIFT` corpus correction(s) last, in one batch if
   they don't depend on the parser fixes above, so the corpus is corrected once rather than
   incrementally.
5. Only after all follow-on issues resolve and corpus corrections land: re-run `nl:stress` on the
   corrected corpus and confirm the soft count has dropped by exactly the corrected/fixed rows, with
   zero collateral movement (the ISSUE-199 validation pattern) — this is the "stable V2-derived
   benchmark is semantically trustworthy" gate the parent request names before the large Codex
   exploratory corpus can be scoped.

## 10. Risks / unknowns requiring DEV evidence (cannot be resolved from this Windows session)

- Whether `entity-index.json` from the `nl-stress-v50-cleaned` run still exists alongside
  `results.jsonl` (it is written once per run by `saveEntityIndex`, not per-row) — if missing, §4a
  needs `--allow-any-database`-style DB access instead, or a fresh `--report-only` run to regenerate
  it, which the operator can do without re-executing SQL.
- The actual value distribution of `auto_cluster_key` — §4b's dimensions are hypotheses derived from
  the corpus's own vocabulary and `NlFailureReason`'s ten values, not a promise about what the real
  921 `UNEXPECTED_DECLINE` rows will cluster into. §6/§7 explicitly allow the human/agent pass to
  rename, split or merge clusters once `issue-200-clusters.md` is in hand.
- Whether any `UNEXPECTED_DECLINE` row's `actual_failure_reason` is `coverage_unavailable` in a way
  that implicates a genuine data/schema gap rather than a parser/planner gap — that would need a
  fourth disposition-adjacent note (data coverage, not code) if it turns out to be a real cluster;
  not assumed here.

## 11. Non-goals

Parser/planner/scorer code changes; `PARSER_VERSION` changes; modifying either external corpus file;
relabelling any row to reduce the soft count without cited evidence; opening follow-on issue numbers
before clustering; AFLW; the large fresh Codex exploratory corpus (Stage 2 boundary, per
`IssuesIndex.md`).

## 12. Implementation recommendation

Sonnet 5, Medium effort, on the dev host (or a session with direct DEV file read access) — the
extraction/cluster scripts are mechanically simple (mirroring `fix-issue-199-stale-expectations.ts`'s
shape: read, re-score with existing exports, write), but the actual clustering judgement in §4c
genuinely needs the real 1,063-row data in hand, which this Windows planning session does not have.

## 13. Real cluster dispositions (2026-09-16, from operator-supplied real `results.jsonl` evidence)

The real DEV run found exactly six `auto_cluster_key` values, not the "several dozen" §10 left open
as an unknown — one each for `GRAIN_EQUIVALENT` and `WRONG_FAILURE_REASON` (both are, empirically,
single-cluster classes at 72/72 and 70/70), and four partitioning the whole of `UNEXPECTED_DECLINE`
(598 + 180 + 128 + 15 = 921/921):

| `auto_cluster_key` | class | rows | disposition |
|---|---|---|---|
| `coverage_unavailable\|boundary` | `UNEXPECTED_DECLINE` | 598 | `PLANNER_VALIDATOR_BUG` |
| `coverage_unavailable\|fgf` | `UNEXPECTED_DECLINE` | 180 | `STALE_CORPUS_EXPECTATION` |
| `unsupported_term\|tm\|gws` | `UNEXPECTED_DECLINE` | 128 | `PARSER_BUG` |
| `player_season->player_game/sum` | `GRAIN_EQUIVALENT` | 72 | `GRAIN_EQUIVALENT_LEGITIMATE` |
| `unsupported_topic->unsupported_term` | `WRONG_FAILURE_REASON` | 70 | `TAXONOMY_DRIFT` |
| `unsupported_term\|pc\|zero` | `UNEXPECTED_DECLINE` | 15 | `PARSER_BUG` |

Reconciliation: `PLANNER_VALIDATOR_BUG` 598 + `STALE_CORPUS_EXPECTATION` 180 + `PARSER_BUG` 143
(128 + 15) + `GRAIN_EQUIVALENT_LEGITIMATE` 72 + `TAXONOMY_DRIFT` 70 = **1063**, matching
`EXPECTED_TOTAL` exactly. Full per-cluster evidence (worked examples, cited code/error text) is in
`issues.md`'s "Real DEV evidence and cluster dispositions" section and in the rationale column of
`tools/nl/issue-200-dispositions.csv` itself. This satisfies §7's evidentiary bar for the two
`PARSER_BUG` clusters and the one `PLANNER_VALIDATOR_BUG` cluster (row count, 3+ worked examples,
root-cause hypothesis citing the specific validator/parser behaviour), and §7's requirement that
`STALE_CORPUS_EXPECTATION`/`TAXONOMY_DRIFT` cite current supported semantics, not just a reduced
soft count.

Per §9: no follow-on issue numbers are opened by this disposition-recording pass. The four candidate
defect/correction families (§9 items 3-4, i.e. the three code follow-ons plus the one guarded
corpus-correction task) are named in `issues.md` but not yet scoped as separate tracked issues --
that happens only after the final `--apply-dispositions` run below confirms the real audit CSV
matches this six-cluster shape exactly.

**Final DEV command (not yet run):**
```
npx tsx tools/nl/audit-issue-200-cluster.ts \
  --audit /home/arm/issue-200-soft-audit.csv \
  --apply-dispositions tools/nl/issue-200-dispositions.csv \
  --out-final /home/arm/issue-200-soft-audit-final.csv
```
Expected: 1,063 rows in, 1,063 classified, 0 unmapped, 0 stale, and the per-disposition totals
above. If the real audit CSV has drifted from this six-cluster shape (a seventh cluster, or a
different per-cluster count), `applyDispositions` refuses to finish rather than silently
misclassifying -- that refusal should be reported back rather than the mapping widened to force a
pass.
