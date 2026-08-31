# NL semantic validation reference

Load only after a current defect and its first wrong layer are proven, or when
reviewing the validation evidence for an existing correction.

## Focused regression first

Extend the closest existing test home. Typical current homes include:

- parser/plan semantic tests under `tests/nl-*.test.ts`;
- database-backed NL tests under `tests/integration/nl-*.test.ts`;
- UI/runtime coverage under `tests/nl-ui/`.

Discover the current files before choosing. Do not create a new test file when
an existing suite is the natural semantic home.

Assert the canonical semantic plan, including every material field:

- grain, metric, aggregation, ordering, and limit;
- resolved entities and typed scope;
- comparison operator and threshold;
- `clubFor`, career conditions, periods, and other special fields;
- validation status and explicit unsupported terms.

Do not assert only that a query “answered”.

For a new phrase family, normally add:

1. the exact failing wording;
2. at least two realistic variants;
3. the nearest valid adjacent grammar;
4. a negative/collision case;
5. ambiguity, coverage, or unsupported controls when in the blast radius.

Examples of useful collision matrices:

```text
most games for Geelong
most career games for Geelong
most games in a match for Geelong
most games in a season for Geelong

Gary Ablett career games
Gary Ablett Jr career games

between 2000 and 2009
draws between Richmond and Carlton
```

## Database-backed integration

Use database integration when compilation, coverage, result projection, or
answer construction is material. Preflight the target first:

- target database ends in `_test`;
- intended test role is used;
- required migrations are applied;
- no checksum drift or unexpected migration state exists;
- no production or development data is mutated.

The focused integration should exercise the normal NL path and assert result
identity, values, count, ties, scope, and answer payload—not just HTTP success.

## Independent PostgreSQL truth

Write a separate truth query from the intended football semantics and schema.
Do not copy, call, or lightly reformat the NL compiler SQL.

For club-scoped career games, calculate appearances for the named organisation
lineage directly. Verify:

- qualifying player IDs;
- organisation-scoped appearance totals;
- comparison boundaries;
- ordering and complete tie set;
- returned answer fields and rendered description.

For correct-empty candidates, establish the relevant maximum or grouped result
set independently. For historical coverage, establish whether source values are
recorded rather than treating missing rows/NULL as zero.

Classify the comparison:

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

## Exact Problem Search rerun

After focused proof, rerun the literal Problem Search wording through the
current product path. Confirm:

- canonical typed plan;
- expected answer or decline;
- expected result count and tie behavior;
- no unexpected unsupported terms;
- expected confidence and entity resolution;
- answer projection, description, and UI outcome;
- expected telemetry fields and parser version.

Do not validate only an internal parser helper if the historical symptom was a
final product outcome.

## Corpus discovery and order

Discover the authoritative filenames in the current repository every session.
Do not recreate or hard-code a missing historical name.

At the 2026-08-30 repository snapshot, targeted inspection found:

- focused semantic fixture under
  `.agents/skills/nl-semantic-mapping/fixtures/`;
- realistic UI corpus named
  `tests/nl-ui/corpora/afldb-ui-questions-1440-real-user-v3-20260822.csv`;
- deliberate-decline corpus named
  `tests/nl-ui/corpora/afldb-ui-questions-60-real-user-decline-v3-20260822.csv`.

The previously referenced 1435 filename was not present in that snapshot. Treat
all names and counts above as discovery hints only; current repository source is
authoritative.

Run broader validation only after focused DB-free, integration, independent
truth, and exact-wording checks pass:

1. current focused semantic regression corpus;
2. current cleaned realistic product/UI benchmark;
3. deliberate-decline benchmark separately;
4. synthetic pressure corpus later, if useful for fuzzing.

Do not mix deliberate declines into the expected-answer headline. The synthetic
pressure corpus is not the product-quality benchmark.

## Before/after assessment

Compare by semantic category, not raw answerability:

- intended plan unchanged or deliberately changed;
- correct answers preserved;
- ambiguity remains safe;
- unsupported terms remain explicit;
- correct empty and coverage outcomes remain truthful;
- no new collision in neighbouring grammar;
- latency/result-count changes are explainable when material.

Inspect every unexpected regression. Do not alter expected outcomes merely to
make a benchmark pass, and do not claim a correctness percentage unless counted
answers have an appropriate oracle.

Record the exact commands and returned summaries in the active issue/runbook.
Respect the repository's user-executed command boundary: provide the smallest
next command unless the user explicitly authorises execution.
