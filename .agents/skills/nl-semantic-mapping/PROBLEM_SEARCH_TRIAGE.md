# Problem Search triage reference

Load this reference only while analysing an export, chronology, review metadata,
or telemetry. Counts below describe one historical snapshot; they are not a
permanent baseline and not a current defect list.

## 2026-08-29 snapshot

The supplied 30-day export covered 2026-08-22 through 2026-08-29:

- 543 data rows plus the CSV header;
- 225 unique questions.

Observed outcomes:

| Outcome | Rows |
|---|---:|
| unrecognised | 254 |
| declined_ambiguous | 95 |
| unanswerable | 94 |
| declined_low_confidence | 73 |
| no_results | 27 |

Observed failure reasons:

| Failure reason | Rows |
|---|---:|
| unrecognised | 252 |
| ambiguous_player | 95 |
| coverage_unavailable | 94 |
| unsupported_term | 75 |
| empty_result | 27 |

These were **not 543 current defects**. The export mixed historical failures,
benchmark/test repetitions, replays, correct ambiguities, correct coverage
refusals, correct empty results, and potential current defects.

The latest date, 2026-08-29, contained 23 rows:

- 19 `no_results / empty_result`;
- 2 `declined_ambiguous / ambiguous_player`;
- 2 `unanswerable / coverage_unavailable`.

Examples that were useful triage signals in that snapshot:

- `most games for Geelong`, observed around `grain=player_game`,
  `metric=games`, `coverage_unavailable`;
- `players with at least 200 games for Collingwood`, observed around
  `grain=player_career`, `coverage_unavailable`.

They are examples, not eternal defects. Reproduce them against the current
parser/build before editing.

If the exact export is unavailable, locate the current equivalent or use the
trusted recorded snapshot explicitly as historical evidence. Do not manufacture
rows or silently substitute a different export.

## Deduplication worksheet

Always report raw rows and unique questions, then cluster by semantic meaning.
Useful initial family labels include:

- head-to-head record or compare wins;
- draw count or latest draw;
- club-career leader, list, or threshold;
- grouped/opponent threshold;
- player ambiguity;
- unsupported metric;
- historical coverage;
- empty-result threshold;
- season-specific head-to-head;
- realistic one-off phrase needing a semantic decision.

For every family record:

| Field | Purpose |
|---|---|
| firstOccurrence | Earliest evidence; may predate a fix |
| lastOccurrence | Best lead for current reproduction |
| occurrenceCount | Frequency after identifying replay noise |
| uniqueWordingCount | Breadth of the real phrase family |
| outcomeTransition | Changed product state |
| failureReasonTransition | Changed investigation |
| grainTransition | Possible parser/plan change |
| confidenceTransition | Useful when confidence was causal |
| parser/build boundary | Separates historical and current behavior |
| source/run/session evidence | Identifies benchmark or replay repetition |

Do not count benchmark or replay duplicates as independent user incidents.
Prioritise realistic semantic breadth and harm, especially wrong answers, over
raw frequency.

## Classification decision guide

Use one analytical classification per family:

- `CURRENT_DEFECT`: reproducible current intended semantics are clear, but the
  deterministic pipeline declines or fails at a wrong layer.
- `CURRENT_WRONG_ANSWER`: current product confidently returns the wrong entity,
  value, grain, aggregation, or scope. Highest safety priority.
- `CORRECT_DECLINE`: the request cannot be supported safely under current
  typed semantics.
- `CORRECT_AMBIGUITY`: multiple relevant entities remain and the query gives
  insufficient identity evidence.
- `CORRECT_COVERAGE_REFUSAL`: the requested statistic is not recorded for the
  requested scope or era.
- `CORRECT_EMPTY_RESULT`: a correct typed query has independently proven zero
  qualifying rows.
- `HISTORICAL_FIXED`: current reproduction proves old telemetry predates a
  fix; retain the phrase as a regression contract.
- `BENCHMARK_OR_REPLAY_NOISE`: repeated automation is determinable and does not
  represent independent incidents.
- `NEEDS_SEMANTIC_DECISION`: wording or product meaning is genuinely unclear,
  or support cannot generalise safely.
- `TELEMETRY_GAP`: missing identity prevents reliable current/historical or
  user/automation attribution.

A changed failure mode is a new investigation. For example:

```text
declined_ambiguous -> no_results
```

Do not preserve the old classification without reproducing the new plan,
compiler, database truth, and final product result.

## Review metadata

The analytical taxonomy above is not the persisted review enum.

Current `NlReviewStatus` values are:

```text
unreviewed
reviewing
accepted
fixed
wont_fix
duplicate
not_a_problem
```

Current `NlReviewCategory` values are:

```text
parser_bug
new_alias
new_metric
new_semantic_rule
ambiguous_language
missing_data
coverage_limitation
correct_decline
performance
database_error
user_error
other
```

Read `src/search/nl/review-spec.ts` before persisting because these enums may
change. Use only supported values. Put the finer analytical classification and
evidence in `reviewNotes` where no exact category exists.

Evidence-based notes can say:

- “Parser vN fixed ambiguity; latest run reaches team_match. Empty result
  independently verified.”
- “Unsuffixed Gary Ablett intentionally ambiguous; suffix required.”
- “Inside 50s unavailable for 1900; preserve coverage refusal.”

Do not mark a row historical/fixed, duplicate, or not-a-problem without evidence.

## Telemetry

Problem Search already exposes fields including:

```text
question
outcome
failureReason
topic
grain
metric
confidence
unsupportedTerms
resultCount
durationMs
parserVersion
sessionId
parentSearchId
reviewStatus
reviewCategory
reviewNotes
```

When available, also use build/deployment identity, request source,
benchmark/corpus run ID, and request correlation identity. They help separate
real traffic, automation, control replays, and parser releases.

Missing identity can justify `TELEMETRY_GAP` and a later issue. Do not expand a
semantic correction into an unrequested telemetry-schema project.
