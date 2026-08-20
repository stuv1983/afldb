---
name: afldb-nl-search-debug
description: Diagnose, expand, and fix AFLDB's deterministic natural-language search pipeline under `src/search` and related query compilers. Use for incorrectly answered, declined, misparsed, over-broad, under-filtered, aggregation, record, match, player, club, round, period, streak, draw, HAVING, or semantic NL questions. Do not introduce an LLM into the pipeline.
---

# AFLDB Natural-Language Search Debugging

Preserve the deterministic architecture:

`canonicalise -> parse -> canonical plan -> allowlisted compiler -> parameterised SQL -> answer`

No LLM belongs in the runtime search pipeline.

## Guardrails

- Work only in the local working copy.
- Inspect before editing.
- Do not run Git commands unless explicitly requested.
- Do not modify `tools/migration/**` or any `*.py` file unless explicitly requested.
- Keep compilers allowlisted and SQL parameterised.
- Do not "fix" a question by special-casing its full literal text when a semantic rule can own it.
- Do not weaken decline behaviour for unsupported questions merely to improve corpus scores.

## Reproduce at multiple layers

For every failing question capture:

1. original text;
2. canonicalised text/tokens;
3. detected intent/entities/conditions;
4. canonical plan;
5. compiler selected;
6. SQL and bound parameters where available;
7. database result;
8. rendered answer/explanation.

The first incorrect stage owns the fix.

## Classify the defect

Common categories:

- alias/canonicalisation;
- entity resolution;
- metric resolution;
- match/round/season constraint;
- comparison operator;
- aggregation/grouping;
- `HAVING`/count threshold;
- superlative or extremum;
- tie handling;
- period split (Q1-Q4/H1/H2);
- streak/sequence;
- pairwise repeated-event logic;
- player versus team grain;
- venue/opponent/club role;
- finals/match-type semantics;
- answer formatting/explanation only.

## Parser rules

- Prefer composable grammar/semantic primitives over phrase lists.
- Make operator precedence explicit.
- Keep count thresholds separate from match/player metrics.
- Apply aggregation stripping only after conditions have been safely parsed.
- Prevent numeric windows from stealing round, year, score, threshold, or period numbers.
- Preserve aliases such as club nicknames without allowing them to capture unrelated text.
- Treat "at least", "more than", "at most", "fewer than", and exact counts as distinct operators.
- Resolve "same two teams ... twice or more in the same season" at pair + season grain, not team grain.

## SQL/compiler rules

- Choose the correct grain before aggregation.
- Use `HAVING` for aggregate thresholds.
- Include all ties for extremum/record answers.
- Do not use `LIMIT 1` when the product rule promises tied holders.
- Verify home/away symmetry for team-pair questions.
- Keep season, round, opponent, venue, and match-type filters attached to the relation they constrain.

## Regression method

For each fix add:

- exact reported question;
- at least two paraphrases/metamorphic variants;
- a near-neighbour that must not change;
- a negative/unsupported case when the grammar was broadened.

Then run:

1. targeted parser/compiler tests;
2. the smallest relevant NL corpus subset;
3. `npm run typecheck`;
4. broader `npm run nl:stress` only when the rule has wide reach;
5. `npm run nl:ui` when the issue appears only through the rendered search page.

Compare semantic correctness, answer correctness, declines, soft failures, hard failures, and metamorphic stability. Do not accept a headline score improvement that creates a new semantic regression.
