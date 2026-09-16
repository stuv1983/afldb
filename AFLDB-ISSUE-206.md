# AFLDB-ISSUE-206 — Fresh exploratory NL corpus

Status: RESOLVED 2026-09-16 (Sonnet 5). Discovery run complete, final triage complete, follow-on work enumerated (no ISSUE-207+ IDs assigned). Baseline: `cd0b3921`, parser version 54, frozen V5 12,000/12,000 clean. See "Final triage and closure" below for the audited reconciliation; the "Ranked finding clusters" and "Proposed ordered follow-on work" sections above it are Codex's first-pass write-up and are retained as history, not as the current disposition.

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

## Final triage and closure (Sonnet 5, 2026-09-16)

This section supersedes the dispositions in "Ranked finding clusters" above with source-verified
conclusions. It was produced by re-reading the retained run artifacts (`.tmp/issue-206/results.jsonl`,
`failures.csv`, `triage.json`/`triage-native-check.json`, `summary.json`/`summary-native-check.json` --
local copies of the `/home/arm/nl-exploratory-v1-validation` run) against the current `parser.ts`,
`entities.ts`, `semantic-intents.ts`, `vocab.ts` and `src/db/queries/nl/achievement-summary.ts` on this
branch. No parser file was edited. `summary-native-check.json`/`triage-native-check.json` are a second,
audit-aware-scorer run of the same corpus against the same parse results, produced locally after the
SSH transfer needed for a real development-host rerun was rejected; they reproduce the corrected
27,530/10,874/15,275/1,381 totals byte-for-byte (aside from the header noting native audit handling),
which is the reproducibility evidence for those corrected numbers.

### 1. Exact reconciliation of the 1,381 hard failures

Computed directly from `failures.csv` filtered to `verdict=fail` with the 1,500 audit-required IDs
excluded (1,515 old-scorer fail rows − 134 audit-classified fail rows = 1,381, confirmed by direct
count):

| Category | Rows | Scorer class | Disposition |
| --- | ---: | --- | --- |
| `team_match_result` (symmetric "versus") | 496 | `DROPPED_FILTER` ×2 (`clubFor`, `clubAgainst`) | CORPUS_ORACLE_DEFECT |
| `achievement_summary` (aggregation field) | 283 | `WRONG_AGGREGATION` | CORPUS_ORACLE_DEFECT / SCORER_DEFECT |
| `player_game_scope_collision` + `player_game_scoped_total` + `player_game_single` (Gary Ablett Jnr/Snr) | 193 + 106 + 52 = 351 | `WRONG_PLAYER` | SCORER_DEFECT |
| `after_siren` clubFor loss | 134 | `DROPPED_FILTER` | CONFIRMED_PARSER_DEFECT |
| `team_checkpoint_collision` clubFor loss | 117 | `DROPPED_FILTER` | CONFIRMED_PARSER_DEFECT |

496 + 283 + 351 + 134 + 117 = **1,381 exactly**. No unresolved remainder.

**Remaining genuine parser-defect hard-failure count: 251** (134 after-siren + 117 checkpoint). The other
1,130 (779 corpus-oracle + 351 scorer) are tooling artifacts, not parser bugs -- the parser's actual
answers for those rows are semantically correct, verified below.

### 2. Status of Codex's 496 / 283 / 351 oracle-scorer clusters

All three are **CONFIRMED**, with root cause traced to source, not merely re-asserted from the scorer
label:

- **496 -- symmetric "versus" matchup.** Row `#20600073` ("Largest winning margin for Sydney versus
  Richmond at Optus Stadium") produces `scope.matchup = { clubA: Sydney, clubB: Richmond }`, a real,
  deliberate unordered-pair scope `extractClubs` already emits for `A v B`/`A vs B`/`A versus B` text
  (`parser.ts:214-222`). The plan is scoped to exactly the two named clubs; the scorer's field
  comparison only knows `clubFor`/`clubAgainst` and reports both as dropped because it does not look
  inside `matchup`. The generator's `team_match_result/3` template asserts directional `club`/`opponent`
  for an unordered "versus" question, which is itself the wrong oracle for that wording. CONFIRMED
  CORPUS_ORACLE_DEFECT, high confidence -- **not a parser defect**, and not a confidently wrong answer
  (the computed margin is for the correct two-club matchup either way).
- **283 -- achievement_summary aggregation.** `src/db/queries/nl/achievement-summary.ts:66-160`
  (`answerAchievementSummary`) never reads `plan.agg` at all; every `by_club`/`by_decade`/`by_season`
  branch runs a hand-written `count(*) ... GROUP BY` query regardless of it, and grouping/shape is
  controlled entirely by `plan.achievementSummary.kind`. `parser.ts:3732` shows `agg` for this grain
  falls through to a generic default (`{kind:'max'}`) because `achievement_summary` has no aggregation
  cue-recognition branch of its own -- it is a vestigial field for this grain. The corpus asserts
  `aggregation=count`; the real contract is `achievementSummary.kind`, which every sampled row got right.
  CONFIRMED CORPUS_ORACLE_DEFECT (the field being checked has no behavioral effect) -- **not a parser
  defect**, real answer is correct.
- **351 -- Gary Ablett Jnr/Snr.** Row `#20600624` resolves `player.id: 4701` (Gary Ablett Jnr's stable
  ID, matching the ID convention already recorded in memory) with `player.name: "Gary Ablett"` (the
  shared canonical display name). The scorer compares the expected qualifier string `"Gary Ablett Jnr"`
  against `actual.plan.player.name` as plain text, which can never match a canonical shared display name.
  Player identity resolved correctly (right person, right ID); only the scorer's string-equality identity
  check is wrong. CONFIRMED SCORER_DEFECT, high confidence -- **not a parser defect**.

No count changed under the updated (audit-aware) scorer; all three totals are exact and stable between
`triage.json` and `triage-native-check.json`.

### 3. Final disposition of the four accepted-plan semantic clusters

All four were re-derived from `results.jsonl` against current parser source, not accepted on the scorer's
say-so.

**(a) 281 -- numeric operator ownership (havingClause vs matchFilter).** CONFIRMED_PARSER_DEFECT, high
confidence. Representative: `#20600048`/`#20600129`/`#20600153` ("Teams with 7 or more losses/wins by
over N points [in YEAR]"). `extractHavingClause` (`parser.ts:1513-1607`) searches a ~40-character window
centered on the result word (`losses`/`wins`) for an operator via `COMPARE_OP_WORDS`
(`vocab.ts:738-761`), but that window is not clipped at the having-clause's own boundary -- it reaches
into the adjacent `"by over N points"` margin clause. `"7 or more losses"` has no explicit operator
phrase of its own (COMPARE_OP_WORDS has no "or more" entry; the intended reading is the `gte` default),
so the only pattern that matches inside the window is `/\bover(?=\s+\d)/` from the *margin* clause,
which the having-clause wrongly claims (`op: 'gt'` instead of the correct default `gte`) and then strips
out of the text. `extractMatchFilter` (`parser.ts:1609-1631`) runs next on the now-`"over"`-stripped
text, finds no operator word in its own `by\s+(...)?\s+\d+\s+points` match, and falls back to its own
default `gte` instead of the correct `gt`. One mechanism (a non-clause-bounded operator window in
`extractHavingClause`) produces both field errors on the same row. **This is scored `clean` by the
current field-blind scorer -- these are 281 real silent wrong answers not counted in the 1,381**, and are
the single highest-severity finding in this triage: a plausible, confidently-returned, wrong count/margin
threshold.
**(b) 251 -- club-role (clubFor) ownership loss (after-siren "to ... for CLUB" + leading "Against CLUB,
...").** CONFIRMED_PARSER_DEFECT, high confidence, **one shared root mechanism** with two triggering
surfaces. `AGAINST_PREPOSITION` (`vocab.ts:680`) is
`/\b(?:against|versus|vs\.?|v\.?|to|over)\b/`, tested against a fixed 20-character lookback window before
each matched club in `extractClubs` (`parser.ts:189-238`), not the single nearest preceding word:
  - *After-siren* (134 rows, e.g. `#20600271` "...after the siren **to win for** North Melbourne..."):
    the after-siren extractor consumes "to win" as `afterSiren.kickEffect: "won"` before club extraction
    runs, but the literal token `to` sits inside the 20-character window ahead of "North Melbourne" and
    matches `AGAINST_PREPOSITION` even though the true, immediately-adjacent governing preposition is
    `for`. North Melbourne is misclassified `governedAgainst: true` and comes out as `clubAgainst`
    instead of `clubFor`.
  - *Checkpoint* (117 rows, e.g. `#20600112` "**Against** Fremantle, what was Melbourne's largest lead at
    three quarter time..."): both "Fremantle" and "Melbourne" are found by the two-club scan. Fremantle
    is correctly `governedAgainst` (adjacent "Against"). Fremantle is then spliced out of the working
    text (`stripMatch`), which shifts "Melbourne" left; the leftover "against" token drifts back inside
    *its* 20-character lookback window too, so Melbourne is **also** marked `governedAgainst: true`. The
    role-assignment loop (`parser.ts:227-235`) takes only the first `governedAgainst` entry as
    `clubAgainst` and requires every other entry to be `!governedAgainst` before it can become `clubFor`
    -- Melbourne, marked `governedAgainst` too, qualifies for neither role and is silently dropped from
    the plan entirely (not even misassigned -- absent).
  Both surfaces trace to the same design flaw: the lookback window is a substring scan over a fixed
  character budget, not anchored to the nearest preposition token. **These 251 rows are within the 1,381
  hard-failure count** (`DROPPED_FILTER`, category `after_siren`/`team_checkpoint_collision`) --
  confidently wrong or confidently unscoped answers, not honest declines.
**(c) 173 -- head-to-head "has more wins" answer kind.** LIKELY_PARSER_DEFECT (vocabulary-coverage gap),
medium-high confidence. Representative: `#20600060` "Which of Dogs and Geelong has more wins head to
head in 2023". `extractHeadToHeadCue` (`semantic-intents.ts:24-61`) tries families in a fixed list order;
the `compare_wins` pattern is narrowly `/\b(?:who has|who'?s|who|which team has) won more\b/` (past tense
"won more" only) and does not match "**has more wins** ... head to head" framing, so the loop falls
through to the generic `/\bhead[- ]to[- ]head.../ -> 'record'` pattern, which matches unconditionally on
any "head to head" mention regardless of the comparison wording preceding it. The question explicitly
names two clubs and asks which one has more wins -- this is not genuine product ambiguity (per the task's
own check: a named two-club "which has more" framing has a well-defined leader answer), it is a
phrasing-coverage gap in one regex. Severity is lower than (a)/(b): the `record` answer is not numerically
wrong (it still carries both clubs' true win/loss/draw counts), it simply does not name a leader directly.
**Scored `clean`, not in the 1,381.**

### 4. Genuine remaining parser-defect hard-failure count

**251** (item 3b above). This is the only sub-population of the 1,381 hard failures that traced to an
actual parser bug rather than a corpus/scorer artifact.

### 5. Top soft-decline (15,275) root-cause clusters

Grouped from `results.jsonl`'s `actual.unsupportedTerms`/`failureReason` for all `UNEXPECTED_DECLINE` rows
with the 1,500 audit IDs excluded (14,368 carry an `unsupportedTerms` leftover token; 907 carry an
explicit `coverageNote`/`errorMessage` refusal instead). Per the task's instruction, these are grouped by
mechanism, not by wording variant:

1. **Imperative/structural phrasing vocabulary gap -- dominant cluster, roughly 10,000+ rows across
   nearly every family.** Leading command verbs (`find`, `show`, `list`, `sum`, `across`) and idiom
   phrases the generator's templates use ("find plus" 700, "find" 624, "find widest" 471, "show seasons
   when they" 527, "posted season tally" 500, "find seasonal" 490, "among"/"among represented" 755
   combined, "how much lose/beat ... lopsided meeting" 510 combined, "managed"/"ranked" (coach_record)
   560 combined, "find match"/"when met"/leading "match" noun 790+, "list margins greater" 262, "find
   run" 213, "season"/"seasonal" as a bare noun 890+ combined) are never stripped as filler or recognized
   as structural no-ops (`CONVERSATIONAL_FILLER` in `vocab.ts:63-` is a conversational-phrase list, e.g.
   "could you please tell me"; it does not cover bare imperative openers), so the leftover token trips
   the generic unmatched-token decline even though grain/metric/scope are otherwise fully resolvable.
   Classification: parser vocabulary gap / product decision on how far to widen it -- these are plausible
   real-user phrasings, not nonsense, so this is not simply a corpus-authoring mistake, but the volume is
   large enough that a single blanket "add every imperative synonym" fix is a genuine scope decision, not
   a bug fix.
2. **`after YEAR` unimplemented temporal form -- roughly 1,200+ rows** (`after` alone 829; combined with
   other terms e.g. "season after" 83, "find after" 82, "posted season tally after" 76, "find seasonal
   after" 69). Already flagged in the original coverage map (`extractSeasons` has no `after YEAR` form);
   confirmed as the largest single contributor and a pending product decision, not a new finding.
3. **`career_boundary` club+boundary-event compiler restriction -- 907 rows**, all `coverageNote`-free
   with `failureReason: "coverage_unavailable"` and `errorMessage: "This career statistic cannot
   currently be totalled for one club."` (verified on `#20600122`, "last game in a Grand Final for
   Melbourne"). The plan parses completely and correctly (`boundary.event/where`, `clubFor`, season
   scope all present); the executor deliberately refuses to combine a career boundary event with a club
   scope. This is a **coverage restriction that fails closed as designed**, not a parser bug and not a
   vocabulary gap -- a legitimate future-feature candidate, not a defect.
4. **Q1/quarter-time comeback -- ~312 rows** (`q3_comeback_near_miss` family). Already tracked as
   unimplemented, consistent with ISSUE-205. No new finding.

### 6. Audit-required (1,500) family distribution

| Family | Rows | Declined | Accepted | Why left unscored |
| --- | ---: | ---: | ---: | --- |
| `identity_ambiguity` | 600 | 600 | 0 | Deliberately ambiguous bare-surname references (Brown, Johnson, Jones, Smith, Williams, etc.) with multiple real matches; **100% decline is the fail-closed expected behavior**, no defect. |
| `malformed_input` | 550 | 436 | 114 | Deliberately garbled/stress phrasing (doubled prepositions, garbled numeric strings). Most correctly decline; **the 114 accepted rows need manual inspection** -- there is no reliable oracle for "the right answer to malformed input", so these were correctly left unscored rather than judged pass/fail automatically. |
| `relationship_conditions` | 350 | 151 | 199 | Family-relationship plus career-predicate composition ("brothers of X who played N premierships"). Split roughly 57/43 success/decline with **no defined product contract for this composition**, so this family needs an operator decision before it can be scored as semantic truth either way. |

No audit row was converted to a success or decline expectation in this pass, per the task's instruction.

### 7. Proposed follow-on work (ordered, no issue IDs assigned)

1. **Fix numeric operator ownership crossing between grouped result HAVING and margin filter.**
   Root cause: `extractHavingClause`'s operator-search window (`parser.ts:1513-1607`) is not clipped at
   the having-clause boundary and can claim an operator word that belongs to the adjacent
   `extractMatchFilter` margin clause (and vice versa, since the claimed token is then stripped).
   Affected: 281 rows (currently scored `clean` -- a genuinely undetected silent wrong answer).
   Severity: **silent wrong answer** (highest). Files: `src/search/nl/parser.ts` (`extractHavingClause`,
   `extractMatchFilter`), `src/search/nl/vocab.ts` (`COMPARE_OP_WORDS`). Would likely bump
   `PARSER_VERSION`. Exploratory V2 depends on this being fixed (or at least the scorer catching it) to
   report a trustworthy clean rate.
2. **Fix club-role (clubFor) ownership loss in `extractClubs`'s `AGAINST_PREPOSITION` lookback window.**
   Root cause: a fixed 20-character substring-scan window, not anchored to the nearest preceding word,
   both (a) lets a distant `to`/`over` token override an adjacent `for`, and (b) lets a stripped leading
   club's residual preposition drift into a second club's window after `stripMatch` shifts text left.
   Affected: 251 rows (`after_siren` clubFor + `team_checkpoint_collision` clubFor), already scored
   `fail`. Severity: **silent wrong / confidently unscoped answer**. Files: `src/search/nl/parser.ts`
   (`extractClubs`), `src/search/nl/vocab.ts` (`AGAINST_PREPOSITION`). Would likely bump
   `PARSER_VERSION`. Exploratory V2 depends on this.
3. **Widen the head-to-head "has more wins" pattern.** Root cause: `extractHeadToHeadCue`'s
   `compare_wins` family only matches "won more" (past tense), so "has/have more wins ... head to head"
   falls through to the generic `record` cue. Affected: 173 rows, scored `clean`. Severity: **wrong plan,
   likely visible** (the record answer still contains the true win counts). Files:
   `src/search/nl/semantic-intents.ts` (`extractHeadToHeadCue`). Would likely bump `PARSER_VERSION` if
   changed. Exploratory V2 depends on this only if the operator wants this family scored as `compare_wins`.
4. **Correct the V1 exploratory scorer/oracle defects for a versioned V2.** Three confirmed issues, one
   ticket: (i) the "versus" template (`team_match_result/3`) should assert `matchup`, not directional
   `club`/`opponent`; (ii) `achievement_summary` templates/scorer should assert `achievementSummary.kind`,
   not the unused `agg` field; (iii) the scorer's player-identity check should compare by resolved
   `player.id`, not raw display-name string equality. Affected: 496 + 283 + 351 = 1,130 rows, all
   currently misclassified as hard failures despite correct parser output. Severity: **corpus/scorer
   only** -- no user-facing behavior is wrong. Files: `tools/nl/generate-exploratory-corpus.mjs`
   (templates), `tools/nl/stress-test.ts` / `tools/nl/triage-exploratory-corpus.mjs` (scorer field
   checks). No `PARSER_VERSION` bump. Exploratory V2 depends on this directly -- without it, V2's clean
   rate cannot be trusted even if items 1-3 are fixed.
5. **Product decision: implement `after YEAR` as a season-bound form.** Affected: ~1,200+ soft-decline
   rows, the largest single vocabulary contributor. Severity: **product decision** (currently an honest,
   correctly-labeled decline, not a defect). Files: `src/search/nl/parser.ts` (`extractSeasons`). Would
   bump `PARSER_VERSION` if implemented. Exploratory V2 should not re-assert success for this form until
   the decision is made.
6. **Product decision: imperative/structural phrasing vocabulary breadth.** Affected: ~10,000+
   soft-decline rows spanning nearly every family (see item 5.1 above). Severity: **product decision** /
   **mixed** -- some of this is a legitimate coverage gap (real users may phrase things this way), some is
   the generator's own template style diverging from realistic phrasing. Needs an operator read on how
   much of this vocabulary is worth adding before any parser work is scoped. Files: `src/search/nl/vocab.ts`
   (stopword/filler lists), `src/search/nl/parser.ts` (leftover-token / grain-election paths). No
   `PARSER_VERSION` bump until a decision is made and implemented. Exploratory V2 depends on this decision
   to set a realistic decline-rate baseline.

Not proposed as new follow-on work: the `career_boundary` club+boundary compiler restriction (907 rows,
deliberate fail-closed design, a future-feature candidate rather than a defect) and Q1/quarter-time
comeback (already tracked via ISSUE-205).

### 8. ISSUE-206 closeout decision: READY_TO_CLOSE

The exploratory corpus is reproducible (SHA256-verified, independent replay matched, focused suite 53/53,
typecheck clean). The audit-aware local scorer rerun (`triage-native-check.json`) reproduces the
corrected 27,530/10,874/15,275/1,381 totals exactly, which is sufficient discovery-tooling validation in
lieu of the still-unavailable development-host rerun. All 1,381 hard failures are now reconciled exactly
to five named root causes with no unresolved remainder; Codex's three oracle/scorer clusters and all four
accepted-plan semantic clusters were independently re-verified against current source rather than taken
on trust, and every one of them was either confirmed or refined with a precise mechanism. Known
oracle/scorer errors are clearly separated from genuine parser defects (251 confirmed parser rows out of
1,381; two more silent-wrong-answer clusters of 281 and 173 rows found outside the scorer's own count).
Follow-on work is enumerated in priority order above. ISSUE-206 is a discovery/infrastructure issue and,
per its own closure contract, does not need the parser defects it found to be fixed before closing --
that work is intentionally left for separate, not-yet-numbered follow-on issues.
