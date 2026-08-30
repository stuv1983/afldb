---
name: nl-semantic-mapping
description: Diagnose, map, extend, and validate AFLDB's deterministic natural-language search when questions parse, decline, filter, project, or render with the wrong football semantics.
---

# AFLDB NL Semantic Mapping

## Purpose

Use this skill when AFLDB NL Search may misunderstand a realistic question,
decline a supported meaning, answer at the wrong grain or scope, project a
misleading value, or disagree with Problem Search or corpus evidence. Also use
it to decide whether a case is a parser defect, semantic-mapping defect,
projection/display defect, data limitation, correct decline, or correct empty
result. Work on one evidence-backed family at a time; an export is not a queue
of presumed defects.

The product architecture is:

```text
canonicalise
-> parse
-> plan
-> validate
-> compile
-> PostgreSQL
-> answer
-> describe/render
```

The objective is correct deterministic AFL semantics. **Do not try to drive the
Problem Search count to zero.**

Loading this skill does not itself authorize code changes, shell commands,
database access, broad corpus runs, or a new issue. Follow `AGENTS.md`, the
user's command boundary, and the active issue/runbook.

## Current source map

Use codebase-memory first for structural discovery and call-chain tracing, then
read the material source directly. These are the current authoritative entry
points; rediscover them if paths move:

| Boundary | Current source |
| --- | --- |
| Canonical vocabulary | `src/search/nl/vocab.ts` (`canonicalise`) |
| Parser and plan assembly | `src/search/nl/parser.ts` (`parseNlQuestion`) |
| Typed IR, grains, metrics, limits, coverage, parser version | `src/search/nl/plan.ts` |
| Dedicated semantic cues | `src/search/nl/semantic-intents.ts` |
| Entity resolution | `src/search/nl/entities.ts`, `src/db/queries/nl/resolve.ts` |
| End-to-end orchestration and logging | `src/db/queries/nl/answer.ts` (`answerNlQuestion`) |
| Validated-plan dispatch | `src/db/queries/nl/execute.ts` (`executePlan`) |
| Grain compilers | `src/db/queries/nl/*.ts` |
| Payload and description | `src/search/nl/answer-types.ts`, `src/search/nl/describe.ts` |
| Visible answer tables | `src/components/NlAnswerSection.tsx` |
| Telemetry/admin | `src/db/queries/nl-search-log.ts`, `src/app/admin/nl-search/` |

There is no universal “semantic map” file. Meaning is distributed across
closed vocabulary, typed cue extraction, grain election, scope/condition plan
assembly, validation, and the matching compiler. Find the first wrong boundary
instead of assuming every semantic defect belongs in `parser.ts`.

## Load references only when needed

- Read [PROBLEM_SEARCH_TRIAGE.md](PROBLEM_SEARCH_TRIAGE.md)
  when analysing an export, chronology, review metadata, or telemetry.
- Read
  [SEMANTIC_REGRESSION_CONTRACTS.md](SEMANTIC_REGRESSION_CONTRACTS.md)
  when a candidate overlaps head-to-head, draws, club-career games, player
  suffixes, unsupported metrics, coverage, empty results, or a one-off phrase.
- Read [VALIDATION.md](VALIDATION.md) only after a current
  defect has been selected and focused verification is being designed.

Do not load all references merely because the skill was invoked.

## Hard rules

- Keep the runtime NL pipeline deterministic. Do not add an LLM or network model
  call.
- Never generate SQL directly from user text. Compile only a validated typed
  `NlQueryPlan` into allowlisted parameterised SQL.
- Do not add full-query phrase hacks or arbitrary English rewrites to make
  individual rows pass.
- Do not silently discard meaningful words, globally demote semantic words such
  as “most”, lower confidence thresholds to increase answerability, or map an
  unsupported metric to a vaguely similar metric.
- False confident answers are worse than correct declines.
- Preserve safe player ambiguity, tie handling, historical organisation
  lineage, organisation-level club scoping, and NULL-versus-zero semantics.
- Treat qualification, ranking, payload projection, description, and visible
  table fields as separate contracts. Passing one does not prove the others.
- A valid plan returning zero rows can be correct. Missing historical coverage
  is not zero.
- Do not change benchmark expectations, remove realistic questions, or weaken
  tests merely to make results pass.
- Do not run broad repository investigations or full corpora before focused
  evidence justifies them.

## Establish the current boundary

1. Read `IssuesIndex.md`.
2. Determine whether the family has an existing owner. Read only the exact
   matching issue entry or approved runbook.
3. Check codebase-memory index status and targeted coverage. Use the graph for
   structural discovery, then verify material findings directly in source.
   Do not re-index unless coverage is materially inadequate.
4. Read the parser version from current source. Never treat a version named in
   this skill, an issue, telemetry, or a corpus as current.
5. Locate the latest available Problem Search export and discover current test
   and corpus filenames. Do not recreate a stale or missing filename.

For partial, stale, `metadata_changed`, excluded, or otherwise incomplete index
coverage, direct source is authoritative.

## Repository terminology and grains

`NlQueryPlan` is the contract between language and SQL. Its `grain` says what
one result row means. Current grains are:

```text
player_career  player_game  player_season  team_match
club_season    team_streak  achievement_summary  head_to_head
```

Inspect at least `grain`, `metric`, `mode`, `agg`, `scope`, player identity,
`careerConditions`, `careerPredicates`, `clubSeasonConditions`,
`havingClause`, `matchFilter`, `periodSplit`, score/result filters, boundary,
tie policy, and limit when present. A plausible metric at the wrong grain is
still a wrong plan.

- NL club scope uses `club_organizations.id`, not one historical `clubs.id`.
  “For Richmond” normally spans the organisation lineage; verify the compiler
  joins through `clubs.organization_id`.
- Whole-career totals and club-scoped career totals are different facts.
  Club-scoped career games mean appearances for the named organisation, not
  whole-career games plus a test that the player once represented it.
- `clubFor`, `clubAgainst`, and a two-club `matchup` are distinct scopes.
- `player_game`, `player_season`, and `player_career` remain different grains
  even when summing match rows happens to produce the same number.
- Comparison phrases map atomically to `gte`, `lte`, `gt`, `lt`, or `eq`.
  Preserve `at least` versus `more than` versus `exactly`.
- `matchFilter` filters qualifying matches before a grouped `havingClause`
  counts them. Do not collapse the two thresholds.
- Period splits and score checkpoints have deliberately limited grain/metric
  combinations. Do not silently discard a period that validation rejects.
- Missing/NULL historical statistics mean unknown or not recorded, not zero.
- Extreme answers include every tie unless the typed contract says otherwise.

## Logged searches and export evidence

The Super Admin page `/admin/nl-search` exposes read-only telemetry. Its audited
CSV route currently supports `searches`, `problems`, `terms`, `topics`,
`reasons`, `reformulations`, and `plans` for 7/30/90/365-day periods.

- `searches` is the richest chronology: question, outcome/reason, confidence
  components, entity resolution, plan/hash, result count, parser version,
  session/parent ids, and review data.
- `problems` contains only rows with a failure reason and has a reduced export
  shape. Use `searches` or search detail when the exact plan matters.
- `terms` supplies frequency and examples. Frequency justifies investigation,
  not an automatic alias or metric mapping.
- `topics` records deliberately unsupported subjects, often a data-roadmap
  decision rather than a parser defect.
- `plans` groups different wording by `plan_hash`; compare distinct questions
  as well as repeated searches.
- `reformulations` links a session's question chain. An answered first query
  followed quickly by a rephrase can reveal a wrong answer absent from the
  failure-only list.

Use current enums from `src/search/nl/review-spec.ts`. Keep this skill's finer
analytical classification in review notes when the persisted category is
coarser. Missing deployment/request-source identity is a telemetry gap, not
permission to infer real-user or benchmark provenance.

## Generated corpora and mass outputs

Read a corpus header before choosing a harness. AFLDB has distinct formats:

- five-column UI corpora (`id,category,question,expected_status,tags`) run via
  the Playwright NL UI harness;
- V1/V2 semantic stress corpora run via `npm run nl:stress`, which detects and
  refuses unknown schemas;
- Problem Search exports are telemetry, not executable expectations.

The current local operator generator is
`tools/nl/afldb_nl_mass_generator.py`. Confirm its interface with:

```text
python -X utf8 tools/nl/afldb_nl_mass_generator.py --help
```

It can mine `searches`, `problems`, `terms`, `reformulations`, and `plans`
exports and offers `balanced`, `realistic`, and `hostile` profiles. Always use
an explicit new `--out` path and seed. Do not overwrite an operator's existing
corpus. Generated rows deliberately use `expected_status=unknown`: they support
discovery, load, runtime-safety, and metamorphic checks, but cannot prove
semantic correctness.

The current local `afldb-nl-mass-corpus.csv` and summary are untracked operator
artifacts. The summary records 100,000 balanced questions with no export seed
inputs. Treat that as provenance, not as a benchmark or a requirement to run
all 100,000 rows.

Reduce a large output before reading parser code:

1. separate crashes/errors, unsafe answers, unexpected declines, unscored
   unknowns, correct empty results, and metamorphic divergences;
2. group by expected/actual grain, metric, scope shape, operator, and first
   failure reason rather than literal question alone;
3. split entity-resolution, coverage-era, and projection/display families;
4. select one representative, two realistic variants, and adjacent collision
   controls;
5. reproduce those cases through the current pipeline;
6. compare the identical fixed corpus/output contract before and after.

## Triage before coding

Problem Search is discovery evidence, not an oracle. First calculate:

- raw data rows, excluding the header;
- unique normalized questions;
- observed date range;
- outcome and failure-reason totals;
- semantic-family clusters rather than literal-string groups.

For every meaningful family record:

- first and last occurrence;
- occurrence count and unique wording count;
- outcome, failureReason, grain, and useful confidence transitions;
- parser/build boundary when telemetry permits;
- likely benchmark, replay, or control repetition.

Chronology changes the investigation. For example, a family moving from
`declined_ambiguous` to `no_results` is not one unchanged failure. Reproduce
the latest state from scratch. Historical rows from an older parser are evidence
and regression inputs, not proof of a current defect.

Classify each family exactly once:

```text
CURRENT_DEFECT
CURRENT_WRONG_ANSWER
CORRECT_DECLINE
CORRECT_AMBIGUITY
CORRECT_COVERAGE_REFUSAL
CORRECT_EMPTY_RESULT
HISTORICAL_FIXED
BENCHMARK_OR_REPLAY_NOISE
NEEDS_SEMANTIC_DECISION
TELEMETRY_GAP
```

Record uncertainty instead of guessing. Do not treat `no_results`,
`ambiguous_player`, or `coverage_unavailable` as automatically defective.
Repeated corpus runs must not inflate priority.

Prioritise, in order:

1. a reproducible current wrong answer, especially wrong scope or identity;
2. a reproducible current defect affecting a realistic phrase family;
3. a useful family with clear typed semantics and independently provable truth.

Do not code until the highest-value candidates have justified current
classifications or explicit unresolved classifications.

## Reproduce the current candidate

Capture the exact current path for the raw question:

- normalized/canonical query and current parser version;
- parse status, failureReason, unsupported terms;
- club and player resolution;
- grain, metric, aggregation, scope, `clubFor`, career conditions,
  comparison operator, threshold, and other special plan fields;
- confidence components;
- `validatePlan` result;
- compiler path and bound parameters;
- coverage decision;
- qualifying rows, ranking/aggregation expression, tie set, result count, and
  every answer-payload field used by the product;
- final description/rendered product outcome.

Find the **first wrong stage** in:

```text
canonicalise -> parse -> plan -> validate -> compile
-> PostgreSQL -> answer -> describe/render
```

The first wrong stage owns the correction:

- If the typed plan is wrong, fix the smallest general semantic cue.
- If the plan is right, do not patch the parser; inspect validation, coverage,
  compiler, answer projection, or rendering.
- If PostgreSQL truth and the result set are right but displayed meaning is
  wrong, fix answer construction or description.
- If intent is unclear or the typed model cannot express it safely, classify
  `NEEDS_SEMANTIC_DECISION` and stop.

### Qualification is not projection

Never declare a fix complete merely because the right entities qualify.
Filtering, ranking, payload projection, description, and display are separate.

For a club-scoped career threshold, both sides must hold:

```text
qualify/rank using appearances for the named organisation lineage
AND
project and label the scoped value the reader asked for
```

It is still wrong if club appearances qualify a player while the payload,
headline, or visible `Games` column presents whole-career
`player_career_stats.games` as though it were that scoped value. Conversely,
changing a label or projected field does not repair a whole-career threshold
plus club-membership filter. Inspect `conditionsWhere`, the ranked value
expression, `NlPlayerCareerRow`, `buildAnswer`/`describeAnswer`, and
`PlayerCareerTable` independently. Apply the same check to opponent, season,
period, per-match, and grouped scopes.

## Make the smallest typed correction

Before proposing implementation, read directly:

- the exact parser extraction and grain-election branches involved;
- relevant plan fields, metric catalogue, coverage rule, and validation;
- the selected compiler's qualification, aggregation/ranking, and SELECT
  projection;
- answer payload, description, and rendered component fields;
- the closest unit and integration regressions;
- schema/data documentation or migrations when organisation lineage, grain,
  or NULL coverage is material.

Prefer:

```text
real phrase family
-> typed semantic cue
-> NlQueryPlan
-> validatePlan
-> compiler
-> normal NlAnswer
```

Avoid:

```text
full-query regex
-> special answer hack
```

Any new semantic concept must remain typed through plan validation before SQL.
Use an existing plan field when it already expresses the meaning; extend the
typed contract only when the current contract cannot.

Before implementation, add the smallest focused failing regression in the
closest existing suite. Assert canonical plan fields, not merely “answered”.
Include realistic wording variants and adjacent collision controls so a new cue
cannot steal another valid grain or grammar.

Current focused homes include `tests/nl-parser.test.ts`,
`tests/nl-plan.test.ts`, `tests/nl-describe.test.ts`,
`tests/nl-semantic-mapping.test.ts`, matching
`tests/integration/nl-*.test.ts`, and `tests/nl-ui/nl-stress.spec.ts`.
Assert complete material plan fields, not only `status === 'plan'`. For SQL or
projection work assert identities, scoped values, whole-career control values,
ordering, ties, payload fields, description, and visible table labels.

## Prove semantics independently

For every newly answered or materially re-scoped query, verify football truth
independently in PostgreSQL. The NL compiler and its SQL are not an oracle.

Before DB-backed validation:

- inspect the intended DSN without exposing secrets;
- require the database name to end in `_test` for integration work;
- confirm the intended role, migrations, and checksum state;
- stop on a non-test target, drift, or unexpected migration state;
- perform no production write, migration, deployment, or access.

The independent query must model the intended AFL semantics directly, including
organisation lineage, scope, aggregation, ties, and NULL coverage. Compare the
database truth with both the result rows and the answer/rendered meaning.

Use evidence labels:

```text
PASS_EXACT
PASS_TIE
CORRECT_DECLINE
CORRECT_EMPTY
WRONG_VALUE
WRONG_ENTITY
WRONG_GRAIN
WRONG_AGGREGATION
WRONG_SCOPE
UNEXPECTED_DECLINE
UNEXPECTED_ANSWER
TELEMETRY_GAP
```

## Validation order

Typical focused commands, after authorization and environment preflight, are:

```text
npm test -- tests/nl-semantic-mapping.test.ts
npm test -- tests/integration/nl-semantic-mapping.test.ts
```

Integration requires `AFLDB_TEST_DATABASE_URL`; the database name must end in
`_test`. Confirm the intended role and migration/checksum state first.

For a V1 semantic corpus, pilot an evenly distributed parser-only sample before
any full run:

```text
npm run nl:stress -- --corpus <v1.csv> --out <new-output-dir> --sample 500 --parse-only
```

Do not pass a five-column UI corpus to `nl:stress`. For a five-column corpus,
set `NL_UI_CORPUS` and a small `NL_UI_LIMIT`, then use `npm run nl:ui` with the
separate Playwright configuration and required base URL/beta environment. Read
`tests/nl-ui/nl-stress.spec.ts` first; `unknown` rows are unscored except for
runtime safety.

After the focused regression and correction:

1. focused DB-free parser/plan/description tests;
2. focused database-backed integration when applicable;
3. independent PostgreSQL truth;
4. the exact Problem Search wording through the current product path;
5. the focused semantic regression corpus;
6. the current realistic product benchmark;
7. the deliberate-decline benchmark separately;
8. synthetic pressure/fuzzing only if still useful.

Compare before and after by semantic family and inspect unexpected regressions.
Raw answerability is not correctness. Do not report a correctness percentage
without an appropriate truth oracle.

## Parser versioning

Read the current parser version before any implementation.

- A behaviour-changing parser, vocabulary, canonicalisation, plan, or validation
  change must bump it according to the current repository contract.
- For compiler, coverage, answer, or rendering-only changes, follow current
  repository convention rather than bumping reflexively.
- Record `before -> after` in the issue and final report.

## Review metadata and telemetry

Keep analytical family classifications separate from persisted review enums.
Use only the current `NlReviewStatus` and `NlReviewCategory` values defined in
`src/search/nl/review-spec.ts`; do not invent incompatible stored values.
Put finer classification and evidence in review notes when the schema does not
represent them.

Use existing parserVersion, sessionId, parentSearchId, and review fields when
available. Missing build/deployment, request-source, corpus-run, or correlation
identity may require `TELEMETRY_GAP`, not speculation or a schema project
inside the semantic fix.

## Issue and stop discipline

- Update the existing issue rather than creating a duplicate.
- Do not reopen a historical resolved issue solely because its old questions
  appear in Problem Search.
- Create a new issue only for a meaningful reproducible defect without an owner.
- Keep the issue/runbook current after material evidence, direction changes,
  rejected hypotheses, implementation decisions, and validation.
- Update `IssuesIndex.md` and `CHANGELOG.md` only when current repository
  workflow and validated retained changes justify it.
- Do not start the next family after the selected scope reaches its acceptance
  boundary.

## Required execution sequence

1. Read current issue/index state.
2. Read current parser version, graph status/coverage, and direct source.
3. Count and group the latest evidence by semantic family and chronology.
4. Separate historical, replay, telemetry-gap, and correct non-defect outcomes.
5. Select and reproduce the highest-value current candidate end to end.
6. Identify the first wrong layer and both qualification and projection
   contracts.
7. Add the smallest focused regression, realistic variants, and collision
   controls.
8. Implement the smallest typed correction through the normal validated path.
9. Run focused DB-free checks, then DB/projection truth when applicable.
10. Rerun literal wording and rendering before a sampled or full corpus.
11. Compare before/after by family; update tracking only with validated facts.
12. Stop.

## Completion report

Report:

- export rows, unique questions, and date range;
- classification totals and unresolved families;
- selected wording, current reproduction, first wrong layer, and root cause;
- independently stated qualification, ranking, projection, and display
  contracts, including scoped versus whole-career control values;
- files changed and typed semantics changed;
- parser version before and after;
- focused tests and database integration;
- independent PostgreSQL truth;
- exact Problem Search rerun;
- focused corpus, realistic benchmark, and decline-suite results;
- unexpected regressions and remaining current candidates;
- issue status and exact remaining acceptance gates.

Do not claim resolution until the selected current defect, collision controls,
independent truth, exact wording, focused corpus, realistic benchmark, decline
safety, and durable issue evidence agree.
