# AFLDB Current Issues Index

> Lightweight session index of open issues only.
>
> `issues.md` is the authoritative detailed ledger.

**Open issues:** 0

**AFLDB-ISSUE-212 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — follow-on item
(4) of `AFLDB-ISSUE-206.md`'s six proposals: corrected the exploratory NL corpus/scorer's three
confirmed V1 oracle defects (496-row symmetric "versus" matchup, 283-row achievement-summary
aggregation, 351-row Gary Ablett Jnr/Snr identity, all at parser v54) in a new versioned
`tools/nl/generate-exploratory-corpus-v2.mjs` + `tools/nl/corpus.ts` scorer contract. Not a
parser-feature issue: `PARSER_VERSION` unchanged at 59, no `src/search/nl/{parser,vocab,
semantic-intents}.ts` file touched. Operator-validated on streamanator: V2 (29,030 rows, seed
`2060542026`, SHA256 `bb75e4b5067942117c60f8eab6cfd01de4d8fc1e0c4fee07e10650fae97edb4a`, deterministic
replay confirmed, V5 exact/normalized overlap 0/0, 1,500 audit-required) scored against parser v59:
**27530 scored / 14878 clean / 12651 soft / 1 failed**; the frozen V1 12,000-row corpus stayed
**12000/12000/0/0** under the updated scorer, no regression. A same-corpus, same-parser (v59)
reconciliation of the pre- vs. post-ISSUE-212 oracle found **1308 old false hard failures removed**
(545 `team_match_result` matchup + 320 `achievement_summary` aggregation + 443 player-identity, split
225 Gary Ablett Snr / 218 Jnr) **and 1 newly exposed genuine hard failure** — net failed count change
-1307, not "1307 fixed". The v54→v59 counts (496→545, 283→320, 351→443) grew because
AFLDB-ISSUE-207..211 landed in between and let more previously-declined rows reach a scored plan for
the first time, exposing more instances of the same three pre-existing defects — none of those five
fixes touched matchup detection, achievement aggregation, or player-identity resolution themselves.
The one newly exposed hard failure (row #20609919, "... margin for North Melbourne versus Melbourne at
Adelaide Oval ...") is a genuine, distinct, pre-existing `extractClubs` defect (`phrasePosition`/
`phraseEnd` re-finding a club's position via a bare word-boundary search of the whole original text can
find a shorter club's name embedded inside a longer club's own name, here "Melbourne" inside "North
Melbourne", instead of the real second mention, silently preventing the unordered matchup from
forming) — confirmed identical parser plan in V1 and V2, not a corpus/scorer defect and not introduced
by this issue, deliberately left unfixed and **not opened as its own tracked issue in this closeout**.
Two structurally similar pairs (`Port Adelaide`/`Adelaide`, `Greater Western Sydney`/`Sydney`) are
**unreproduced hypotheses only** — the actual host run found exactly one failure total, so neither is
confirmed to have been drawn by this seed or to reproduce the mechanism. See `issues.md` and
`AFLDB-ISSUE-212.md` (§6a, §8) for the full record.

**AFLDB-ISSUE-211 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — follow-on item
(5) of `AFLDB-ISSUE-206.md`'s six proposals, the largest single unimplemented soft-decline vocabulary
family it found: `extractSeasons` (`src/search/nl/parser.ts`, `src/search/nl/vocab.ts` new `AFTER_RE`)
had no form for `after YEAR` as an exclusive lower season bound (`scope.seasonMin = YEAR + 1`,
deliberately distinct from inclusive `since YEAR`). Fix extends the existing single season extractor
with one new anchored regex and one new `else` branch alongside the existing `since` check — no second
parser, no vocabulary/stage reordering, `after the siren`/`AFTER_THE_ACHIEVEMENT` unaffected because
neither ever puts a literal year immediately after the word. `PARSER_VERSION` 58 → 59. Implementation
commit `c113e6a`, unmerged on `sonnet/issue-211-after-year-season-bound`. Operator-validated on
streamanator: frozen V5 stable-corpus rerun stayed **12000/12000/0/0**, and a direct structured-plan diff
of the retained ISSUE-206 29,030-row exploratory corpus (pre-fix v58 vs post-fix v59) found exactly
**1406 changed plans**, all genuine `after <4-digit year>` wording, 0 unrelated — reconciled in full:
**1262 `soft_fail→clean`** (the genuine usability gain), **136 `soft_fail→soft_fail`** (95
`career_boundary` / 23 `head_to_head` / 18 `unsupported_composition`, correctly declined under the
existing compiler/coverage contract once the temporal clause parses), **8 `audit→audit`**
(`malformed_input` rows, intentionally still manual-audit by corpus design), and **0 `soft_fail→fail`**.
118 changed rows compose `after the siren` with a separate genuine `after YEAR` clause; both meanings
coexist correctly in every one. See `issues.md` and `AFLDB-ISSUE-211.md` for the full record.

**AFLDB-ISSUE-210 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — follow-on item
(6) of `AFLDB-ISSUE-206.md`'s six proposals: a leading imperative/request-wrapper verb ("find", bare
"show", "list", "give me" — "show me"/"tell me" already worked) survived `canonicalise()`
(`src/search/nl/vocab.ts`) as an unmatched leftover token and tripped the generic decline gate even when
the rest of the question was otherwise fully supported — the dominant soft-decline mechanism ISSUE-206
found (~10,000+ of 15,275 soft-decline exploratory rows). Fix: one new anchored
`LEADING_REQUEST_PREFIX_RE`, consumed at most once at the very start of the string; `find` carries a
negative lookahead protecting the pre-existing "find the (big) sticks" goals idiom, the one real
vocabulary collision found. `PARSER_VERSION` 57→58. Implementation commit `8324d2a`, unmerged on
`sonnet/issue-210-imperative-nl-phrasing`. Operator-validated on streamanator: frozen V5 stable-corpus
rerun stayed **12000/12000/0/0**, and a direct structured-plan diff of the retained ISSUE-206 29,030-row
exploratory corpus (pre-fix v57 vs post-fix v58) found exactly **1408 changed plans**
(`663 find / 378 list / 367 show / 0 other`, zero unrelated wording family), reconciled in full: **1288
`soft_fail→clean`** (the genuine usability gain), **48 `soft_fail→fail`** (all `show`-prefixed
`player_game_single` rows, all the pre-existing Gary Ablett Jnr/Snr canonical-display-name scorer
artifact from `AFLDB-ISSUE-206.md`, exposed by new reachability rather than caused by this fix), and
**72 audit-required `decline→success`** ("List sons of X with Y" `relationship_conditions` rows, now
valid typed `player_career` plans but still intentionally manual-audit by corpus design). See
`issues.md` and `AFLDB-ISSUE-210.md` for the full record.

**AFLDB-ISSUE-209 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — follow-on item
(3) of `AFLDB-ISSUE-206.md`'s six proposals: `extractHeadToHeadCue`'s `compare_wins` family
(`src/search/nl/semantic-intents.ts`) recognized only past-tense "won more", so present-tense "has/have
more wins ... head to head" fell through to the generic `head to head` → `record` cue and answered with
a full record instead of naming the leader. Fix added a dedicated "has/have (more|the most) wins head to
head" pattern plus a trailing-"head to head" extension to the existing "won more" pattern, both checked
before the generic record families; `PARSER_VERSION` 56→57. Operator-validated on streamanator (commit
`f2e067f`): frozen V5 stable-corpus rerun stayed **12000/12000/0/0**, and a direct structured-plan diff
of the retained ISSUE-206 29,030-row exploratory corpus (pre-fix v56 vs post-fix v57) found exactly
**199 changed plans**, all `headToHead.kind: record→compare_wins` in the same wording family — 173
matching ISSUE-206's direct estimate, plus 26 that also carried a mechanically-linked `between YEAR and
YEAR` season/havingClause correction (the same atomic "wins" consumption fix incidentally resolved a
misread grouped-threshold on those 26 rows) — zero collateral movement elsewhere, so **the validated
affected surface is 199 rows, not 173**. Implementation commit `f2e067f`, unmerged on
`sonnet/issue-209-head-to-head-more-wins`. Two adjacent wordings ("has more wins between A/B", "has more
wins against the other") investigated and deliberately not fixed — claimed earlier by
`extractClubSeasonMetric`'s "most wins" club_season ranking cue, a different mechanism. See `issues.md`
and `AFLDB-ISSUE-209.md` for the full record.

**AFLDB-ISSUE-208 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — follow-on item
(2) of `AFLDB-ISSUE-206.md`'s six proposals: `extractClubs`'s club-role lookback (`src/search/nl/parser.ts`)
tested "does an against-like token exist anywhere in a fixed 20-character window", not "what is the
nearest preposition governing this club" — losing the subject club on 134 after-siren rows ("to win FOR
Club" mis-read the earlier, unrelated "to" as governing) and 117 leading-opponent/checkpoint rows
("Against Opponent, ... Subject's ..." let the opponent's own stripped-out "against" leak into the
subject's shrunken window). One shared mechanism, fixed by a `nearestGoverningPreposition` helper
anchored to the immediately-preceding token, checked against the pre-mutation text — no vocabulary
added, no stage reordered, `scope.matchup` unchanged; `PARSER_VERSION` 55→56. Operator-validated on
streamanator (commit `70b72df`): frozen V5 stable-corpus rerun stayed **12000/12000/0/0**, and a direct
structured-plan diff of the retained ISSUE-206 29,030-row exploratory corpus (pre-fix v55 vs post-fix
v56) found exactly **251 changed plans** (134 `after_siren` + 117 `team_checkpoint_collision`), zero
collateral movement elsewhere, clearing all 251 confirmed parser-defect hard failures (aggregate hard
failures 1381→1130, clean +251, soft unchanged). Implementation commit `70b72df`, unmerged on
`sonnet/issue-208-club-role-ownership`. One structurally similar, undisturbed finding in
`assignCrossDomainClubs` (its own fixed-window `AGAINST_PREPOSITION.test` for the played/coached
opponent refusal) documented but not fixed and not yet opened as its own issue. See `issues.md` and
`AFLDB-ISSUE-208.md` for the full record.

**AFLDB-ISSUE-207 resolved 2026-09-16** (Sonnet 5, operator-validated on streamanator) — follow-on item
(1) of `AFLDB-ISSUE-206.md`'s six proposals, the highest-severity finding (281 silently-wrong-answer
corpus rows). Root cause: `extractHavingClause`'s operator search used an unbounded `±20`-character
window that could reach past a grouped wins/losses/draws/games threshold's own count into an adjacent
margin clause's operator word, and separately let `COMPARE_OP_WORDS`' fixed vocabulary order outrank the
clause's own, correctly-positioned operator word. Both effects silently swapped the two clauses'
comparators while still passing `validatePlan`. Fix bounded the operator search to
`window.slice(0, countEnd)` — no vocabulary added, no stage reordered, no default changed;
`PARSER_VERSION` 54→55. Operator-validated on streamanator: frozen V5 stable-corpus rerun stayed
**12000/12000/0/0**, and a direct structured-plan diff of the retained ISSUE-206 29,030-row exploratory
corpus (pre-fix v54 vs post-fix v55) found exactly **281 changed plans**, all
`havingClause.op: gt->gte` paired with `matchFilter.op: gte->gt` (the intended pairing), zero collateral
movement elsewhere in the corpus. Implementation commit `4ecdd77a`, unmerged on
`sonnet/issue-207-numeric-operator-ownership`. One pre-existing, out-of-scope gap documented but not
fixed: `extractMatchFilter` has no form for trailing "by 50 or more/fewer points". See `issues.md` and
`AFLDB-ISSUE-207.md` for the full record.

**AFLDB-ISSUE-206 resolved 2026-09-16** (Sonnet 5) — final triage of the 29,030-row independent V1
exploratory corpus, re-verified against current branch source rather than taken on the first-pass
(Codex) scorer labels. All 1,381 hard failures reconcile exactly to five root causes: 496
(`team_match_result` symmetric "versus", confirmed corpus-oracle defect — parser already emits a correct
`matchup` scope, template wrongly asserts directional clubs), 283 (`achievement_summary` aggregation,
confirmed corpus/scorer defect — the grain's executor never reads `plan.agg`), 351 (Gary Ablett Jnr/Snr,
confirmed scorer defect — player ID resolves correctly, only display-name string comparison is wrong),
and **251 genuine parser defects** (`after_siren`/`team_checkpoint_collision` clubFor loss, one shared
root mechanism: `AGAINST_PREPOSITION`'s 20-character lookback window in `extractClubs` is not anchored to
the nearest preposition). Two further clusters are silent wrong answers scored `clean`, outside the
1,381: 281 rows (numeric operator ownership crossing between `extractHavingClause`/`extractMatchFilter`,
confirmed parser defect, highest severity) and 173 rows (head-to-head "has more wins" phrasing gap).
Soft declines (15,275) trace mainly to one mechanism (imperative/structural phrasing vocabulary gap,
~10,000+ rows) plus `after YEAR` (unimplemented, ~1,200+ rows) and a deliberate `career_boundary`
compiler restriction (907 rows, fails closed by design). Six follow-on proposals recorded in priority
order in `AFLDB-ISSUE-206.md`, no ISSUE-207+ IDs assigned yet. No parser behaviour, `PARSER_VERSION`, V5
row or production data changed. See `issues.md` and `AFLDB-ISSUE-206.md` for the full record.

**AFLDB-ISSUE-205 resolved 2026-09-16** (Sonnet 5, operator-validated) — AFLDB-ISSUE-200's
`TAXONOMY_DRIFT` disposition for the remaining 70 `WRONG_FAILURE_REASON` rows was incomplete: two
unrelated families, not one benign label mismatch. **Family A (42 rows,** "biggest three quarter time
comeback" **):** genuine parser-ordering defect — `extractScoreCheckpoint` consumed "three quarter time"
before `extractTeamMetric` could match the already-implemented `q3_deficit_overcome` team_match metric.
Fix required two rounds (a `'3QT'`-entry guard, then a `'QT'`-entry follow-up after the operator's first
run found the first guard incomplete — a second, independent fall-through matching the same nested
substring); `PARSER_VERSION` 53→54. **Family B (28 rows,** "comeback from quarter time" **):** genuine
Q1/quarter-time feature gap (no `q1_deficit_overcome` metric exists, and none was added — deliberate
scope decision); stays declined, `expected_failure_reason` corrected `unsupported_topic`→
`unsupported_term`. Two correction-tool validation defects found and fixed along the way (both
test/tooling-only, no parser/runtime defect): an over-broad candidacy design gated on old-state
(`decline`+`unsupported_topic`) before question-text identity, wrongly flagging an unrelated live
fantasy-score row; and a DB-free test fixture that leaked a filler-row default
(`expected_grain='player_game'`) into synthetic decline rows. Operator-validated end-to-end: 446/446
parser tests, 35/35 integration tests (incl. new `q3_deficit_overcome` SQL coverage), clean
`tsc --noEmit`, 15/15 correction-tool tests, real V4→V5 correction (70/70 targets, 0 non-targets
touched, independently re-verified), parser-v54 rerun against V5 = **12000 scored / 12000 clean / 0 soft
/ 0 failed**. V5 is now the stable regression-corpus baseline, superseding V4. Stage 2 remains closed,
not reopened. See `issues.md` and `AFLDB-ISSUE-205.md` §11 for the full record.

**AFLDB-ISSUE-204 resolved 2026-09-16** (Sonnet 5, operator-validated) — guarded V3→V4 corpus
correction for the 180-row `coverage_unavailable|fgf` stale pre-1965/1987 finals-stat coverage
expectations (disposals/marks/tackles, finals/Grand Finals, seasons 1897-1926). Three fail-closed
correction-tool defects were found and fixed across three operator runs before the fourth completed
end-to-end: (1) an over-broad category+template-only selector matched 996 rows, not 180, retargeted to
the row's full structural signature; (2) a singular-only `/\bfinal\b/i` question-text check rejected
real plural "finals" wording, widened to `/\bfinals?\b/i`; (3) a season-shape gate wrongly required
`expected_season_from === expected_season_to` for every row, fixed by branching on
`expected_match_type` (Grand Final rows carry a blank `expected_season_to`). All three were
correction-tool-only; no parser/runtime defect was found. Final run: 180/180 targets corrected, 0
non-targets touched, parser-v53 rerun against V4 = 12000 scored / 11930 clean / 70 soft / 0 failed
(down from 250 soft), the 180 `UNEXPECTED_DECLINE` rows removed with zero new soft rows and zero
semantic changes among the rest; `PARSER_VERSION` unchanged at 53. See `issues.md` and
`AFLDB-ISSUE-204.md` §11 for the full record. AFLDB-ISSUE-187..204 all now resolved. **Stage 2 (the
AFLDB-ISSUE-200 corpus audit and its four follow-ons) is now closed**; the remaining 70
`WRONG_FAILURE_REASON` taxonomy-drift rows are a separate, not-yet-opened cleanup/audit task (see
Stage 2 next task below).

AFLDB-ISSUE-202 (GWS club identity leaks into unsupported-term detection) resolved 2026-09-16
(Sonnet 5, operator-validated) -- see `issues.md` for the full record, including the additional 72
grain-equivalent GWS player-season rows normalized as a byproduct of the same fix.

AFLDB-ISSUE-203 (numeric word "zero" not bound as equality in `player_career` conditions) resolved
2026-09-16 (Sonnet 5, operator-validated) -- root cause was two cooperating gaps in
`extractCareerConditions` (missing `zero` vocabulary entry, and a comparator default wrong for a
bound zero); `PARSER_VERSION` 52→53; 15 zero-word soft findings cleared, 0 new soft rows, 0
semantic changes among the 250 remaining soft rows -- see `issues.md` for the full record.

AFLDB-ISSUE-187..192 were opened 2026-09-15 from the Fable NL Search Stage 1 review (Fable 5.1,
medium effort), re-verified by Stage 2 on main `8a0c4cb`. Subsystem: natural-language search
(`src/search/nl/`, `src/db/queries/nl/`). AFLDB-ISSUE-190 resolved 2026-09-15 (Sonnet 5);
AFLDB-ISSUE-188 resolved 2026-09-15 (Sonnet 5); AFLDB-ISSUE-187 resolved 2026-09-15 (Sonnet 5);
AFLDB-ISSUE-189 resolved 2026-09-15 (Sonnet 5, from the approved runbook, operator-validated);
AFLDB-ISSUE-191 resolved 2026-09-15 (Sonnet 5, operator-validated); see `issues.md`.
AFLDB-ISSUE-193 (opened 2026-09-15 during ISSUE-189 planning) resolved 2026-09-15 (Sonnet 5,
operator-validated); see `issues.md`.
AFLDB-ISSUE-192 resolved 2026-09-15 (Sonnet 5, operator-validated: 31/31 integration tests,
5/5 ISSUE-192 regression tests, clean `tsc --noEmit`); see `issues.md`.
AFLDB-ISSUE-187..193 all remain resolved; the Stage 2 closeout audit (2026-09-16, Sonnet 5 High)
found three neighbouring, unrelated defects while verifying the resolved fixes and opened
AFLDB-ISSUE-194..196. AFLDB-ISSUE-196 resolved 2026-09-16 (Sonnet 5 High, from the approved
runbook — one runbook correction to the `across` regression contract mid-implementation, see
`issues.md` — operator-validated: 389/389 `nl-parser.test.ts`, 167/167 `nl-semantic-mapping.test.ts`,
clean `tsc --noEmit`). AFLDB-ISSUE-195 resolved 2026-09-16 (Sonnet 5 High, from the approved runbook
`AFLDB-ISSUE-195.md`, Option B — subject-gated "won the/a premiership" vocabulary plus a narrow
club-season ownership guard, no runbook correction needed — operator-validated: 398/398
`nl-parser.test.ts`, 167/167 `nl-semantic-mapping.test.ts`, clean `tsc --noEmit`); see `issues.md`.
AFLDB-ISSUE-194 resolved 2026-09-16 (Sonnet 5 Medium, `sonnet/issue-194-team-match-symmetric-matchup`,
unmerged — operator-validated: 34/34 `tests/integration/nl-answers-team-club.test.ts`, clean
`tsc --noEmit`); see `issues.md`. AFLDB-ISSUE-187..196 all now resolved. The Stage 2 corpus triage
of the 208 `AMBIGUITY_NOT_DETECTED` rows (2026-09-16) classified 40 as `GENUINE_FAIL_OPEN`, 168 as
`STALE_CORPUS_EXPECTATION`, and opened AFLDB-ISSUE-197 for the 40 (one root cause).
**AFLDB-ISSUE-197 resolved 2026-09-16** (Sonnet 5, from the approved runbook `AFLDB-ISSUE-197.md` —
Option C, a dedicated `resolvePlayerFamily` resolver mirroring the parser's whole-word-prefix
predicate in SQL; `PARSER_VERSION` 48 → 49; operator-validated: 25/25
`tests/integration/nl-semantic-mapping.test.ts`, 951/951 across the full focused NL suite set,
clean `tsc --noEmit` — see `issues.md` for the full Implementation/Validation/Resolution record,
including one mid-session fixture correction and one integration-path control-flow investigation
that concluded fixture defect, not production defect). AFLDB-ISSUE-187..197 all now resolved.

Stage 2 status: **blocked again, narrowly.** ISSUE-197 resolving its one genuine fail-open root
cause cleared six of the seven generic-surname families (Johnson, Brown, Smith, Williams, Wilson,
Anderson). The v49 regression rerun (2026-09-16) found the seventh, Jones (rows 11626-11630,
5 rows), still hard-failing for a distinct-but-related reason: the parser's own defence-in-depth
`candidateNameWords` re-check does not tokenise hyphenated surnames (`Darcy Byrne-Jones`,
`David Rhys-Jones`) the same way SQL's `afldb_normalise_name` does, undercounting the real 13-member
Jones family to 11 and ranking a wrong answer instead of declining. **AFLDB-ISSUE-198 opened
2026-09-16, resolved 2026-09-16** (Sonnet 5, from the approved runbook `AFLDB-ISSUE-198.md` — one
implementation-time deviation from its §5 Option C code sketch, found empirically: `candidatePlayerSpan`
widens its acceptance test via the new shared `splitNameWords` helper but keeps the original
punctuation-bearing token, rather than exploding it, to stay aligned with the confidence/leftover-token
accounting elsewhere in the parser — see `issues.md`'s Implementation section). `PARSER_VERSION` 49 →
50. Operator-validated 2026-09-16: `tests/integration/nl-semantic-mapping.test.ts` 29/29 (DB-backed,
`afldb_test`), combined focused suite 964/964 across 6 files (`nl-parser.test.ts` 413/413,
`nl-semantic-mapping.test.ts` 167/167, `nl-regression-corpus.test.ts` 163/163,
`nl-audit-acceptance.test.ts` 10/10, `nl-plan.test.ts` 182/182, plus the integration file above),
clean `tsc --noEmit`. AFLDB-ISSUE-187..198 all now resolved.

The unchanged V1 12k-row corpus re-run on parser v50 (post-merge Stage 2 step) has now been run: hard
failures 178 -> 173, confirmed to be exactly the five Jones rows (11626-11630) clearing with zero
collateral movement. **AFLDB-ISSUE-199 resolved 2026-09-16** (Sonnet 5, from the approved runbook
`AFLDB-ISSUE-199.md`, revised mid-implementation after two real-DEV validation failures — see
`issues.md`'s Implementation/Final-patch-revision sections — a self-verifying correction script,
`tools/nl/fix-issue-199-stale-expectations.ts`, corrected exactly the 173 stale-decline rows; operator-
validated: correction-tool summary 173/173 targets modified, 0 non-target rows touched, plus a parser-v50
`nl:stress` re-run showing `AMBIGUITY_NOT_DETECTED`/hard-fail 173 -> 0 with the three soft classes
unchanged at 72/921/70; DB-free unit suite 28/28; `PARSER_VERSION` unchanged at 50). AFLDB-ISSUE-187..199
all now resolved. Stage 2 is **not** closed by this: the three soft classes remain open and unaudited
(item 4 below), and the rest of the Stage 2 closeout sequence remains outstanding.

**AFLDB-ISSUE-200 opened 2026-09-16, resolved 2026-09-16** (all Sonnet 5) for item 4's soft-class
audit. Runbook `AFLDB-ISSUE-200.md` written (planning); `tools/nl/audit-issue-200-extract.ts` and
`tools/nl/audit-issue-200-cluster.ts` (plus a shared constants module) written with DB-free unit
tests (implementation); the operator ran both scripts against the real
`/home/arm/nl-stress-v50-cleaned/` artifacts and found exactly six auto-clusters covering all 1,063
rows, and evidence-backed dispositions for all six were recorded in a checked-in mapping
(`tools/nl/issue-200-dispositions.csv`); **operator-validated resolution:** the final
`audit-issue-200-cluster.ts --apply-dispositions` run against the real
`/home/arm/issue-200-soft-audit.csv` reconciled exactly -- 1063 rows in, 1063 classified, 0
unmapped, 0 stale, `PLANNER_VALIDATOR_BUG` 598 / `STALE_CORPUS_EXPECTATION` 180 / `PARSER_BUG` 143 /
`GRAIN_EQUIVALENT_LEGITIMATE` 72 / `TAXONOMY_DRIFT` 70; local `tsc --noEmit` clean,
37/37 DB-free tests passed. No parser/planner/scorer code changed; neither external corpus file
modified. The three candidate defect follow-ons and the one guarded corpus-correction task (named in
`issues.md`) are recorded but not opened as tracked issues in this closeout.

**AFLDB-ISSUE-201 opened 2026-09-16, resolved 2026-09-16** (all Sonnet 5) for the first of those
follow-ons: the `PLANNER_VALIDATOR_BUG` `coverage_unavailable|boundary` cluster (598 rows).
`validatePlan` now exempts a `raw.boundary` plan from the career season-range rejection;
`player-career.ts` compiles the range against `c.debut_season`/`c.final_season`; `PARSER_VERSION`
50 → 51. Operator-validated: 774/774 focused unit tests, 33/33
`tests/integration/nl-answers.test.ts`, clean `tsc --noEmit`; stable-corpus rerun cleared 596 of the
598 rows, and the remaining 2 (id 9907, id 10294 — both "... Grand Final before 1897", `seasonMax`
genuinely one season before `NL_LIMITS.minSeason`) were confirmed stale corpus expectations, not
implementation defects, and corrected by a new guarded, self-verifying script,
`tools/nl/fix-issue-201-stale-boundary-expectations.ts` (17/17 unit tests passed). Final stable-corpus
result: 12,000 scored / 11,535 clean / 465 soft / 0 failed, with an independent diff confirming zero
collateral movement anywhere else in the corpus. See `issues.md` and `AFLDB-ISSUE-201.md` for the full
record. AFLDB-ISSUE-187..201 all now resolved.

Full entries, evidence, root causes and acceptance criteria are in `issues.md`.

## Stage 2 next task

1. **Done** (2026-09-16) — V1 regression corpus re-run against parser v49 (parse-only): hard
   failures 208 -> 178.
2. **Done** (2026-09-16) — fresh run's semantic rows compared against the retained v48 baseline:
   1271 -> 1241 non-clean rows, 30 rows became clean, 0 new non-clean rows, 0
   changed-but-still-non-clean rows. This comparison is what surfaced the Jones rows (§ above,
   AFLDB-ISSUE-198) as still-hard rather than clean.
3. **Done, resolved 2026-09-16** — the V1 12k corpus was re-run on parser v50: hard failures 178 ->
   173 (only the five Jones rows, 11626-11630, moved; confirmed clean via full semantic diff, zero
   collateral movement). The remaining 173 hard failures (5 Ablett + 112 team-streak + 56 coach-record)
   were all stale expected-decline rows predating shipped features. **AFLDB-ISSUE-199 resolved
   2026-09-16** — corrected via a checked-in, self-verifying script
   (`tools/nl/fix-issue-199-stale-expectations.ts`), operator-run against the real canonical CSV
   (`~/nl-stress-corpus.csv` on the dev host, which has no in-repo generator); `AMBIGUITY_NOT_DETECTED`
   173 -> 0, the three soft classes unchanged. See `issues.md` for full evidence.
4. **Done, resolved 2026-09-16 — AFLDB-ISSUE-200.** All 1,063 soft rows (`GRAIN_EQUIVALENT` 72,
   `UNEXPECTED_DECLINE` 921, `WRONG_FAILURE_REASON` 70) are classified into exactly six real
   clusters, operator-confirmed via the tool's own final `--apply-dispositions` run:
   `PLANNER_VALIDATOR_BUG` 598, `STALE_CORPUS_EXPECTATION` 180, `PARSER_BUG` 143,
   `GRAIN_EQUIVALENT_LEGITIMATE` 72, `TAXONOMY_DRIFT` 70 — no
   `intentional_conservative_decline`/`scorer_harness_artifact`/`duplicate_manifestation` clusters
   turned up in the real data. See `issues.md` for full evidence. Runbook: `AFLDB-ISSUE-200.md`.
5. **(a) done, resolved 2026-09-16 — AFLDB-ISSUE-201.** **(b) done, resolved 2026-09-16 —
   AFLDB-ISSUE-202**: a `PARSER_BUG` fix for "GWS"/"GWS Giants" leaking into unsupported-term
   detection on `team_match` margin questions (128 manifestations). Root cause was a missing
   combined alias (see `issues.md`/`AFLDB-ISSUE-202.md`); fix applied was the one-line
   `CLUB_NICKNAMES` addition, operator-validated against the retained V3 corpus (465 → 265 soft).
   The same fix also normalized all 72 `GRAIN_EQUIVALENT_LEGITIMATE` rows (GWS Giants player-season
   leading-goalkicker questions) to exact expected semantics as a byproduct, so that class is now 0.
   Stage 2 was **not yet** closed after (c): **(c) opened 2026-09-16 as AFLDB-ISSUE-203, resolved
   2026-09-16** (`PARSER_BUG` fix for the word "zero" not binding as numeric-zero in career conditions,
   15 manifestations, operator-validated, `PARSER_VERSION` 52→53); **(d) opened 2026-09-16 as
   AFLDB-ISSUE-204, resolved 2026-09-16** (guarded corpus correction for the 180
   `coverage_unavailable|fgf` disposals/marks/tackles finals/Grand Final rows that asserted a stale
   `expected_status=success` — two coverage floors, not one: disposals/marks before 1965, tackles
   before 1987 — retargeted after the first operator run failed closed on an over-broad 996-row
   selector, then two further fail-closed correction-tool bugs found and fixed; operator-validated:
   180/180 targets corrected, 0 non-targets touched, parser-v53 rerun 250→70 soft with the 180
   `UNEXPECTED_DECLINE` rows removed and zero new soft rows, `PARSER_VERSION` unchanged at 53).
   **Stage 2 is now closed** — (a)-(d) all resolved. The fresh exploratory Codex corpus sweep is now in
   scope, per the original Stage 2 boundary, as a separate not-yet-opened task.
6. **Opened 2026-09-16 as AFLDB-ISSUE-205, resolved 2026-09-16.** The 70 `TAXONOMY_DRIFT` rows were
   **not** accepted diagnostic drift after all — the audit found a real parser-ordering defect silencing
   an already-implemented team_match metric (42 rows, fixed, `PARSER_VERSION` 53→54) plus a genuine
   Q1-comeback feature gap (28 rows, stays declined with a corrected failure-reason label). Corrects, but
   does not reopen, Stage 2 itself. V5 corpus: 12000/12000 clean, 0 soft, 0 failed. See
   `AFLDB-ISSUE-205.md`.

Completed issue runbooks and supporting evidence are archived under `issues/closed/`.
