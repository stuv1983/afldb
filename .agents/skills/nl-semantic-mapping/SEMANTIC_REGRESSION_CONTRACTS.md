# Semantic regression contracts

Load only when the selected family overlaps one of these semantics. The examples
are collision and regression evidence, not a list of current defects.

## ISSUE-094 is historical

AFLDB-ISSUE-094 resolved real-user semantic families including:

- typed head-to-head record and compare-wins intent;
- draw count and latest draw;
- atomic grouped comparison operators;
- organisation-scoped club-career games;
- Gary Ablett suffix identity;
- explicit unsupported-metric handling;
- realistic benchmark cleanup.

Preserve these as regression contracts. Do not reopen ISSUE-094 or redesign
already-correct semantics merely because historical Problem Search rows remain.
Current reproduction wins over historical telemetry.

Representative controls:

```text
Richmond v Carlton head to head
Richmond record against Carlton
who has won more Richmond or Carlton

how many draws between Richmond and Carlton
Richmond draws against Carlton
last draw between Richmond and Carlton

teams with at most 2 wins against Richmond

Richmond career leader for games
most career games for Richmond

Gary Ablett Jr career goals
```

## Comparison operators

Consume comparison phrases atomically:

```text
at most
no more than
at least
no fewer than
more than
less than
fewer than
exactly
```

Do not globally demote meaningful words such as “most” into stopwords. Test the
canonical operator and at least one realistic variant, plus nearby language in
which the same token has a different role.

## Head-to-head and draws

Head-to-head is a typed two-organisation family. Preserve historical organisation
lineage and do not count duplicated team-side representations twice.

Draw questions remain typed head-to-head variants:

```text
how many draws between Richmond and Carlton
Richmond draws against Carlton
last draw between Richmond and Carlton
```

Protect the distinction between:

```text
between <club> and <club>
between <year> and <year>
```

## Club-career games

Club-scoped career games mean appearances **for the named organisation lineage**.
They do not mean whole-career games plus a filter that the player represented the
club at some point. The rule applies to leaders, thresholds, and lists.

### Career shorthand candidate

Historical Problem Search evidence made this a useful current-reproduction
example:

```text
most games for Geelong
```

Possible intended meaning:

```text
player with the most career appearances for the Geelong organisation
```

Do not assume that meaning or assume a current defect. Compare the exact current
plan and product result with:

```text
most career games for Geelong
Geelong career leader for games
most games in a match for Geelong
most games in a season for Geelong
```

A correction must not steal genuine match or season grain. Inspect phrase cue,
grain election, typed scope, validation, coverage, compiler, answer projection,
and rendering; correct the first wrong stage only.

### Club threshold candidate

For:

```text
players with at least 200 games for Collingwood
```

the supported intended semantic is:

```text
career appearances for the Collingwood organisation >= 200
```

It is not:

```text
whole-career games >= 200
AND player represented Collingwood
```

Trace:

```text
parser -> NlQueryPlan -> validatePlan -> career compiler
-> coverage -> result projection -> answer/render
```

Test adjacent operators:

```text
players with at least 200 games for Collingwood
players with more than 200 games for Collingwood
players with exactly 200 games for Collingwood
```

Independently calculate appearances across the relevant organisation lineage.
Do not reuse compiler SQL as truth.

## Player ambiguity and suffix identity

Bare identity can correctly remain ambiguous:

```text
Gary Ablett career games
Gary Ablett most goals in a season
```

Do not choose Jr or Sr from popularity, resolver score, recency, fame, or top
result. Preserve distinct identity for:

```text
Gary Ablett Jr / Jnr / Junior
Gary Ablett Sr / Snr / Senior
```

Suffix handling belongs in player identity resolution. Do not make suffixes
global filler words or collapse distinct player IDs.

## Correct empty results

These may parse correctly and still have no qualifiers:

```text
players with at least 500 career games
players with more than 500 career games
players with at least 1000 career games
players with more than 1000 career games
```

Prove the independent database maximum. If zero rows qualify, classify
`CORRECT_EMPTY_RESULT`. Do not loosen the comparison, drop a scope, lower
confidence, or force an answer.

Grouped opponent thresholds also require truth before classification:

```text
teams with at most 2 wins against Richmond
teams with at most 2 losses against Richmond
teams with at most 2 wins against Geelong
```

Old ambiguity followed by a current correct team-match plan and `no_results`
is a changed state. Verify database truth; it may be `CORRECT_EMPTY_RESULT`,
not a reopened parser defect.

## Coverage and unsupported metrics

Unsupported statistics must decline explicitly. Never map one to a similar
supported metric.

Historical coverage can correctly refuse:

```text
most inside 50s in 1900
who had the most inside 50s in 1900
```

If the statistic was not recorded for that era, preserve the coverage refusal.
Unknown stays NULL/unknown; never manufacture zero.

## One-off phrases

Historical exports included phrases such as:

```text
Most Disposals in a Match by a brisbane player
Richmond v Geelong 1983
Richmond v Carlton 1944
most points
most goal hand balls 21 1996
First game grand final
Brady Rowles
```

A one-off can expose a real family, but first ask:

1. Is the intended football meaning clear?
2. Is the wording realistic?
3. Can current typed semantics represent it?
4. Would support generalise to a useful family?
5. Can it avoid stealing adjacent valid grammar?
6. Can independent PostgreSQL truth prove the meaning?

If not, classify `NEEDS_SEMANTIC_DECISION`. Do not create
one-regex-per-query behavior.
