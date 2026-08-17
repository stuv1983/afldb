# Natural-language stress test

A repeatable regression harness for `/search`'s natural-language engine.
It runs a corpus of questions through the real parsing and execution
pipeline and reports what the parser *understood*, not merely whether it
returned something.

```bash
# on the dev server, from ~/projects/afldb
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
npx tsx tools/nl/stress-test.ts --corpus /path/to/corpus.csv --out ~/nl-stress-out
```

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
| `--corpus <path>` | The CSV to run. Required. |
| `--out <dir>` | Output directory. Default `./nl-stress-out`. |
| `--concurrency <n>` | Questions in flight at once. Default 6. |
| `--limit <n>` | First *n* rows only — for a pilot. |
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
