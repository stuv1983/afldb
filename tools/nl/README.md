# Natural-language stress test

A repeatable regression harness for `/search`'s natural-language engine.
It runs a corpus of questions through the real parsing and execution
pipeline and reports what the parser *understood*, not merely whether it
returned something.

```bash
# on the dev server, from ~/projects/afldb
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"

# V1 -- the 12,000-question regression corpus
npm run nl:stress -- --corpus ~/nl-stress-corpus.csv --out ~/nl-stress-out

# V2 -- the 250,000-question qualification suite
npm run nl:stress -- --corpus ~/nl-killer-250k.csv --out ~/nl-stress-v2 --concurrency 6

# compare two finished runs (no database needed)
npm run nl:stress:compare -- ~/nl-stress-v2-before ~/nl-stress-v2-after
```

Use the npm script rather than calling `tsx` directly: it sets
`--conditions=react-server`, without which Node resolves the `server-only`
guard on every query module to the copy that throws.

## Two corpus schemas, detected from the header

The runner reads the CSV header and picks its scoring contract from it —
there is no `--v1`/`--v2` flag, and an unrecognised header is refused
rather than guessed at.

| | V1 | V2 |
| --- | --- | --- |
| Size | 12,000 rows | 250,000 rows |
| Expectations | its own column vocabulary, translated in `corpus.ts` | this codebase's own `NlQueryPlan` IR, compared directly |
| Oracles | one (interpretation, plus 51 verified answers) | five: `plan`, `plan+policy`, `answer`, `decline`, `metamorphic` |
| Execution | every row, unless `--parse-only` | only `answer` rows — a plan row's correctness is its interpretation |
| Memory | whole corpus and all results in RAM | streamed both ways; bounded aggregates only |
| Output | `report.md`, `failures.csv`, `summary.json` | the structured directory below |

V1 behaviour is unchanged, so earlier 12k results stay comparable.

### V2 oracles

| Oracle | Runs SQL | Passes when |
| --- | --- | --- |
| `plan` | no | canonical semantics equal the expectation |
| `plan+policy` | no | as `plan`, but the expected status may be a decline (era coverage) |
| `answer` | yes | semantics **and** the verified football result both match, scored independently |
| `decline` | no | the parser refuses; a wrong decline *reason* is soft, answering at all is `UNSAFE_ANSWER` |
| `metamorphic` | no | every phrasing in a `metamorphic_group` yields the same canonical semantics |

**A `plan` row is never failed because the query would return zero rows.**
A question can name a real player, club and season that never intersect;
that makes the result empty, not the interpretation wrong.

### What counts as semantics

Canonical semantics carry grain, metric, mode, aggregation (including
`top_n`'s `n`), entities, season range, match type, career and
club-season conditions, boundary and tie policy. They deliberately
exclude confidence, consumed tokens, unsupported-term diagnostics, parser
notes, entity-resolution debug, plan tokens, headlines, explanations and
formatting — none of that is a query.

Entities compare by **stable id** (`player.id`, `club.organizationId`,
`venue.id`), resolved through the same directories and resolver the
parser uses. Names differing cosmetically ("GWS Giants" vs "Greater
Western Sydney") is not a failure; `Sydney` vs `Greater Western Sydney`
still is. Collections whose order carries no meaning (career conditions,
club-season conditions) are sorted before comparison.

### V2 output

| File | Use |
| --- | --- |
| `run.json` | reproducibility: corpus SHA-256, row count, git commit, `PARSER_VERSION`, database, concurrency, node, host, start/finish, and the headline totals. Written *before* the first query and marked `running` until the run completes, so an interrupted run still says what it was. |
| `report.md` | read first: the five quality dimensions, safety counts, failure classes with examples, metamorphic divergences, per-category rates, highest-leverage fixes, latency. |
| `failures.jsonl` | only rows with a finding — the primary debugging file. |
| `results.jsonl` | every row's full forensic record; the input to `--resume`. |
| `metamorphic-failures.jsonl` | one record per divergent group, with majority and outlier semantics. |
| `unsupported-terms.csv` | `term,count,example` frequency table for vocabulary mining. |
| `latency.json` | throughput and p50/p90/p95/p99/p99.9 for the full path, the parser alone, and database execution. |

The headline is deliberately **not** one blended number. It reports
semantic correctness, answer correctness, safe declines and metamorphic
consistency separately, then the absolute count of confidently wrong
answers — because a rising clean rate must never excuse a rising
wrong-answer count. Compare the absolute hard number between runs, which
is what `npm run nl:stress:compare` exists to do: it lists rows that were
correct in the baseline and wrong in the candidate, regardless of which
way the percentage moved.

## Why it scores meaning rather than answers

If AFLDB checked itself against answers AFLDB produced, a query bug would
certify itself as correct. So almost every row asserts an *interpretation*
— grain, mode, metric, aggregation, entities, season scope, match type,
boundary, career conditions — and nothing about the number that comes
back. Only rows marked `VERIFIED_RESULT` in the corpus carry a factual
answer, and those were checked by hand first.

That is also why this does not drive `/search` over HTTP: the page renders
an answer, and the query plan behind it — the thing being tested — cannot
be recovered from HTML.

## Severity, and what "failed" means

| Severity | Meaning | Counts as a failure |
| --- | --- | --- |
| `hard` | A confidently wrong interpretation. The answer looked fine and meant something else. | Yes |
| `soft` | Declined something answerable, or answered below the corpus's confidence floor. The reader got no answer rather than a wrong one. | No |
| `info` | Neither side is wrong — chiefly a correct plan that matched no rows. | No |

The split matters because the two are not equally urgent. A wrong
opponent silently changes the answer; a decline is visible to the reader
and merely unhelpful. Fix hard findings first.

An `info`/`NO_RESULTS` row is a real and expected outcome for a corpus
that generates plausible-but-empty scopes ("Dustin Martin against St Kilda
in 2025" is a well-formed question about a season he did not play). The
corpus asserts meaning, so an empty result is reported and not scored.

## Output

| File | Use |
| --- | --- |
| `report.md` | Read this first: headline numbers, failure classes ranked by rows affected, worked examples, per-category rates, timing, and unsupported vocabulary. |
| `failures.csv` | Every failing row with its plan, for sorting and filtering in a spreadsheet. |
| `results.jsonl` | One line per question — full expectation, observation and findings. The input to `--report-only`. |
| `summary.json` | Headline counts, for comparing one run against the next. |
| `entity-index.json` | Club/venue name → id lookups, so `--report-only` needs no database. |

The point of a fixed corpus is the *second* run. Fix the rules behind the
biggest clusters, run the identical file again, and the movement in
`summary.json` is an objective measurement rather than an impression.

## Options

| Option | Effect |
| --- | --- |
| `--corpus <path>` | The CSV to run. Required. Schema detected from its header. |
| `--out <dir>` | Output directory. Default `./nl-stress-out`. |
| `--concurrency <n>` | Questions in flight at once. Default 6. |
| `--limit <n>` | First *n* rows only. |
| `--sample <n>` | *n* evenly spaced rows — what a pilot wants. The corpus is generated template by template, so its first 400 rows are 330 variations on one question; every *n*th row covers each category in proportion. Deterministic, so two pilots of the same size are comparable. |
| `--category <name>` | One corpus category only. Repeatable. |
| `--parse-only` | Skip SQL execution and score interpretation alone. Minutes instead of an hour, and enough to find every parser bug. |
| `--resume` | Skip ids already in `results.jsonl`. |
| `--report-only` | Re-score and re-report an existing `results.jsonl`. No database needed — use it when the scoring rules themselves need correcting. |
| `--allow-any-database` | Bypass the `_dev`/`_test` database-name guard. |

## Safety properties

- **Nothing is written to any table.** The run is SELECTs through the
  read-only app role.
- **`nl_search_log` is untouched.** That table records what real readers
  asked and drives vocabulary and confidence tuning; twelve thousand
  synthetic rows would drown the signal. This calls the parser and the
  compilers directly, never `answerNlQuestion`, so no logging path runs.
- **It refuses a database whose name is not `_dev` or `_test`**, on the
  same allowlist reasoning as `tests/setup.ts`.

## Corpus format

A CSV with a header row. Every `expected_*` column is optional: a blank
cell asserts nothing and is not checked. See `tools/nl/corpus.ts` for the
translation between corpus vocabulary and this codebase's plan IR — the
two differ in about six places (`margin` + `win`/`loss` versus
`win_margin`/`loss_margin`, `final` versus `finals`, `brownlow_wins`
versus `brownlow_medals`, and so on), and that table is the only place
those differences live.

Clubs and venues are compared by **identity, not name**, resolved through
the same directories the parser uses. Comparing strings would be wrong in
both directions here: the corpus writes "GWS Giants" where the database
says "Greater Western Sydney", while "Sydney" is a substring of "Greater
Western Sydney" and "Melbourne" of "North Melbourne" — so a substring
match would score the two most important mix-ups as passes. Any corpus
name the directories do not recognise is reported before the run starts.

The scoring rules have their own tests in `tests/nl-stress-corpus.test.ts`;
a harness that mis-scores is worse than no harness.
