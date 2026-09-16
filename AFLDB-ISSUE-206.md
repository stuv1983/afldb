# AFLDB-ISSUE-206 — Fresh exploratory NL corpus

Status: discovery run complete; operator validation and follow-on selection pending. Baseline: `cd0b3921`, parser version 54, frozen V5 12,000/12,000 clean.

## Stage A coverage map (before generator implementation)

| Surface | Implemented contract and exploratory pressure |
| --- | --- |
| Grains | `player_game` (single/sum), `player_season`, `player_career`, `team_match`, `club_season`, `team_streak`, `head_to_head`, `coach_record`, `after_siren`, `achievement_summary`, `family`. `executePlan` dispatches every grain to a distinct compiler. |
| Metrics | Player match/season stats include goals, disposals, marks, tackles, contested/uncontested, inside 50s, clearances, efficiency and other tracked stats; career also includes games, finals, premierships, Brownlow and awards. Team match includes margin polarity, scores, crowd and Q3 deficit overcome; club season has wins/losses/draws/percentage; coaching has games/results/finals/flags/seasons/clubs/win percentage; family has combined games/linked members. Several grains use typed descriptors instead of a rank metric. |
| Aggregations | Max/min, top N, list and count. `player_game` additionally distinguishes single game from a sum over matches. Win/loss polarity is metric sensitive. |
| Scope and conditions | Club for/against, unordered matchup, venue, player/coach, season min/max, match type and round; career numeric and builder predicates, club-season booleans, metric thresholds, grouped team result HAVING and margin filters. Some scopes belong to specialised builders (relationship and coaching) rather than generic match scope. |
| Boundaries and time | Debut/last game with finals/Grand Final; first/last after-siren event; exact season, before/since/between and decades. `after YEAR` is not an implemented season-bound form, although the generator initially asserted it as supported. Match types include finals, each named final, wildcard final and home-and-away; wildcard is separate from the finals series. Team score checkpoints are QT/HT/3QT; period splits are Q1–Q4/H1/H2/full match. |
| Entity forms | Full and partial player names, family surnames, aliases, club lineages and nicknames, named venues and venue nicknames. Ambiguous people require a conservative resolution or a genuine family-ranking interpretation. |
| Composition | Supported intersections vary by grain. Particularly sensitive: player metric plus opponent/venue/season; career ranking plus several conditions; team result plus grouped thresholds; coaching club/season/qualifier; achievement and relationship predicates plus career conditions; cross-domain played-and-coached clauses. Unsupported field combinations are rejected by `validatePlan`. |
| Unsupported/fail closed | Explicit topic gate for rebound 50s, fantasy/SuperCoach, positions, age extremes, averages and subjective best-player/team prompts. Q1 comeback remains unimplemented. Coverage floors and ambiguous identity can decline. Compiler ownership checks reject scope fields a grain cannot honor. |

### Under-covered intersections in frozen V5

V5 schema/count analysis only; its question text is not a generation source. V5 has 4,293 `player_game`, 2,856 `team_match`, 2,593 `player_season`, 1,905 `player_career`, 112 `team_streak`, 56 `coach_record`, and no expected rows for the other five implemented grains. Goals/margin/disposals/games account for 9,643 of 12,000 rows. Only 9 rows combine club and venue, 3 combine opponent and venue, none combine player and venue, and no rows combine a career-predicate JSON column with club or season. These intersections and the five missing grains are primary targets. Repeated year variation is capped and cannot supply the row count by itself.

### Extraction-order targets

The parser claims marquee phrases before venues/clubs; venues before clubs; coaching after season but before match type; after-siren before ordinary player goals; aggregation before numeric career conditions; checkpoints before team metrics; and team metrics before player metrics. Generate paired phrases at these ownership seams, especially Q3 comeback versus 3QT checkpoint, `most` versus `at most`, grand-finals-coached versus Grand Final scope, goals after the siren versus goals per game, and venue names containing club names. The corpus will report evidence; ISSUE-206 will not change parser behavior.

## Execution

- Generator: `tools/nl/generate-exploratory-corpus.mjs`, version `issue-206-exploratory-v1`, fixed seed `2060542026`. Its templates author questions and expectations; the V5 file is read only for overlap rejection. The generated V1 CSV is frozen for this first run. The generator capped each template at 700 rows and each semantic equivalence group at six.
- Corpus: `/home/arm/nl-exploratory-v1.csv`; manifest: `/home/arm/nl-exploratory-v1.manifest.json`. Local working copies and raw triage artifacts are under `.tmp/issue-206/`. CSV SHA256: `45c4dabb48703b4b32dcd708ec670dba4524899adf81cfd90dc843ea28229bd0`. A deterministic replay produced the same digest. V5 exact and normalized overlap: **0 / 0**. Generated exact, normalized and ID duplicates: **0 / 0 / 0**. Frozen V5 was not edited.
- **29,030 rows / 25 families:** 24,680 intended supported, 2,850 intentionally unsupported, 1,500 uncertain/audit-required. Composition depths 1–5: 587 / 3,023 / 11,483 / 8,644 / 5,293. Largest grains: `team_match` 6,600; `player_game` 6,000; `player_career` 3,500; `player_season` 2,200; `club_season` 2,100. The other six implemented grains have 4,630 combined rows; 4,000 decline/audit rows leave grain unasserted. Aggregations: max 17,841; list 3,886; count 2,179; min 1,124; unasserted 4,000. The manifest has full family, metric, scope, template and status distributions.
- First parse-only run used the development database's entity directory (`afldb_dev`) and `/home/arm/nl-exploratory-v1-run`. No answer queries or production writes were run. The host checkout was at `e394f9e`, not local `cd0b3921`; `parser.ts`, `vocab.ts`, `semantic-intents.ts`, `entities.ts`, `describe.ts`, `answer-types.ts`, the resolver and engine had matching normalized source hashes, `plan.ts` matched ignoring comments/whitespace, and both reported parser v54. This is parser-semantic equivalence evidence, not a claim that the whole checkout matches. The host's older scorer did not know `audit` status, so local triage excluded its 179 clean / 1,187 soft / 134 failed audit-row contributions. **27,530 scored: 10,874 clean, 15,275 soft, 1,381 failed; 1,500 audit-required unscored.** There were no parser exceptions. The corrected totals are arithmetic over retained raw results; an independent run with the updated scorer remains to be done.

## Ranked finding clusters

The existing scorer's 1,381 hard rows break down into 251 high-confidence parser role errors, 779 corpus specification errors and 351 canonical-name scorer artifacts. A supplementary comparison of template-authored plan fields found 281 accepted rows with swapped numeric operators and 173 accepted rows using the wrong head-to-head answer kind; the V1 scorer did not check those fields. These counts describe independent rows, not field mismatches.

| Priority | Rows | Representative question; intended → actual | Likely source; disposition/confidence |
| --- | ---: | --- | --- |
| 1 | 281 | “Teams with 5 or more wins by over 50 points since 2000”: `wins ≥ 5`, margin `> 50` → `wins > 5`, margin `≥ 50`, accepted. | `extractHavingClause` searches a 20-character window for any comparison word and consumes `over` from the adjacent margin clause; `extractMatchFilter` then defaults to `≥`. Parser defect, high. |
| 2 | 134 | “Which player kicked the most behinds after the siren to win for North Melbourne between 2005 and 2015”: club **for** North Melbourne → club **against** North Melbourne, accepted. | `extractClubs` gives a 20-character preceding-window `to` priority as an against preposition (`parser.ts` and `vocab.ts`). Parser defect, high. |
| 3 | 117 | “Against Fremantle, what was Melbourne's largest lead at three quarter time since 2000”: Melbourne for / Fremantle against → Melbourne role absent, accepted. | `extractClubs` role assignment after a leading opponent and stripped club mention. Parser defect, high. |
| 4 | 173 | “Which of Dogs and Geelong has more wins head to head in 2023”: compare-wins answer → generic record answer, accepted. | `extractHeadToHeadCue` recognizes “who has won more” but the generic head-to-head cue wins this wording; `describeHeadToHeadAnswer` prints a record rather than naming the leader. Parser vocabulary/intent defect, medium-high. |
| 5 | 15,275 | Expected success → explicit decline. Largest shared terms: `after` 1,219; `find plus` 700; `find` 670; `season` 547; `seasonal` 527; `posted season tally` 500; `among` 488. | Mostly unsupported-term vocabulary and template phrasing; 907 coverage-unavailable declines also occur. Mixed parser gaps, corpus design and coverage contract. Cluster-by-cluster review required; do not interpret this as 15,275 parser defects. |

**The first four clusters are silent accepted plans (705 unique rows)** and outrank explicit declines. The two numeric-condition fields each differ on the same 281 rows. The two club-role families total 251 of the 1,381 hard scorer rows.

### Genuine unsupported and product-gap observations

All **2,850 intentionally unsupported** rows declined: 2,100 explicit topics with `unsupported_topic`; 750 unsupported compositions with 471 `unsupported_term`, 144 `unsupported_topic`, 135 `coverage_unavailable`. Q1/quarter-time comeback remains unimplemented, consistent with ISSUE-205. Fantasy/SuperCoach, positions, unsupported averages and rebound 50s also declined. `after YEAR` has no season extractor even though many generated rows asserted success; whether to add it is a product decision. Of 1,500 audit-required rows, 313 produced plans and 1,187 declined; the 114 accepted malformed-template rows especially need manual inspection before any correctness claim. No audit row was scored as semantic truth.

### Corpus and scorer errors found during triage

- **496 hard rows:** “A versus B” is an unordered matchup in the implemented contract, while `team_match_result/3` incorrectly asserts directional `clubFor`/`clubAgainst`. The plan carries both clubs as a matchup. Corpus specification error, high confidence.
- **283 hard rows:** achievement summary questions assert `agg=count`; the builder's semantic contract is its `achievementSummary` descriptor and carries `agg=max`. Corpus specification error, high confidence.
- **351 hard rows:** “Gary Ablett Jnr/Snr” resolves to the appropriate distinct player IDs (4701/4700) but the scorer compares the canonical shared display name “Gary Ablett” to the supplied qualifier string. Scorer identity artifact, high confidence.
- Temporal `after YEAR` was described as supported in the initial template design but is absent from `extractSeasons`. Its expected-success rows are a generator/product-contract mistake until the operator chooses support. Several other low-frequency templates use awkward phrasing; their declines need template review before parser work.

The raw grouped diagnostic report is `/home/arm/nl-exploratory-v1-run/triage.md` with machine-readable `/home/arm/nl-exploratory-v1-run/triage.json`; local copies are under `.tmp/issue-206/`. `tools/nl/triage-exploratory-corpus.mjs` reproduces them without changing expectations. Its groups preserve raw findings; this section provides the reviewed dispositions.

## Proposed ordered follow-on work (no issue IDs assigned)

1. Fix numeric operator ownership between grouped result HAVING and margin filters, with tests for adjacent counts and comparisons.
2. Fix club-role lookback/ownership for after-siren “to win for” and leading “against”, with precise opponent/club regression tests.
3. Decide whether “has more wins head to head” should invoke compare-wins and test the answer headline.
4. Review common honest-decline vocabulary in frequency order using a hand-picked sample; separate awkward generator wording, missing aliases and genuine supported-query failures.
5. Decide whether `after YEAR` and other unsupported compositions should become product features. Keep Q1 comeback and explicit unsupported topics declined until deliberately implemented.
6. Correct the exploratory oracle's symmetric-matchup and achievement aggregation assertions in a future **versioned** corpus, and make player identity scoring ID-aware. Preserve V1 run and its findings.

## Independent validation on a checkout containing this branch

Run after the branch is available on the development host. These commands do not change V5 or production data. The new run uses a separate output directory.

```sh
node tools/nl/generate-exploratory-corpus.mjs --baseline /home/arm/nl-stress-corpus-v5.csv --out /home/arm/nl-exploratory-v1-replay.csv --manifest /home/arm/nl-exploratory-v1-replay.manifest.json
sha256sum /home/arm/nl-exploratory-v1.csv /home/arm/nl-exploratory-v1-replay.csv
npx vitest run tests/nl-stress-corpus.test.ts
npm run typecheck
npm run nl:stress -- --corpus /home/arm/nl-exploratory-v1.csv --out /home/arm/nl-exploratory-v1-validation --parse-only --concurrency 6
node tools/nl/triage-exploratory-corpus.mjs --corpus /home/arm/nl-exploratory-v1.csv --results /home/arm/nl-exploratory-v1-validation/results.jsonl --failures /home/arm/nl-exploratory-v1-validation/failures.csv --summary /home/arm/nl-exploratory-v1-validation/summary.json --out /home/arm/nl-exploratory-v1-validation/triage.md --json /home/arm/nl-exploratory-v1-validation/triage.json
```

The CSV hash should be `45c4dabb48703b4b32dcd708ec670dba4524899adf81cfd90dc843ea28229bd0`. The local `node --check` checks and deterministic replay passed. Local offline dependency installation succeeded; focused Vitest passed **53/53** and `npm run typecheck` passed. The updated-scorer rerun on the development host remains unexecuted because automatic approval review rejected transfer of repository source to that host. The existing host harness produced the parse-only results above; no parser code or V5 expectation was edited.
