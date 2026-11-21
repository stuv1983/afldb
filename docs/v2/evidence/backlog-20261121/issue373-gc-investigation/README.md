# ISSUE-373 phase 1: classification of the 118 failing G-c findings (proposal only, no code edited)

Date 2026-11-22. Worktree `D:/dev/afldb-backlog-20261122` (branch `claude/backlog-20261122`). Written by a worker dispatch;
`node .phaneslight/scripts/cli.js new-file` could not be used (no Node on the workstation), so this file was created with the Write
tool. Companion data: `failing-cells-118.csv` (one row per finding: board, cell, row, col, category, blocking criterion, other
criterion, lacking Gridley player, approving decision). No source, test, data or corpus file was edited.

## 0. Headline

1. **All 118 findings are already owner-approved or retained under the G-b bounded policy, with zero unapproved differences.** The
   report's own `releaseOutcomes` (read from `gp1` and `gp2` on the host) says: `strictCorpusParity {passed:false, findings:118}`,
   `approvedDeferrals 78`, `approvedDisagreements 40`, `approvedTotal 118`, `approvedPolicyConformance {passed:true, unapprovedDifferences:0}`.
2. The 78 `unsupported` findings equal, cell for cell, the 78 cells enumerated in `data/reference/gridley-approved-deferrals.json`.
   The 40 `criterion disagreement` findings equal, cell for cell, the 21 + 11 + 8 cells of the three owner-approved sibling files.
   (Set equality checked locally for the 78; membership of every one of the 40 in an approving file checked; see section 1.)
3. G-c (N7) is therefore not a defect detector for these cells. It is the raw strict-parity indicator, and it fails by construction
   as long as any approved difference exists. Closing ISSUE-373 means an owner decision about N7, not a solver or data fix.
4. No fix is classified (A). Every candidate change is (B) proposal-only (section 3).
5. Precision: "118 cells" is 118 **findings** over **113 distinct cells**. Five cells (board:cell 920:2-2, 964:2-1, 990:2-2,
   1073:2-2, 1109:2-2) carry two sibling findings, one for Jarryd Lyons and one for Jimmy Webster.
   The 78 unsupported cells are 78 distinct cells; 10,287 - 78 = 10,209 is the "solved" count, so the 35 distinct brother cells are
   counted as solved.

## 1. Classification

Source: `ev/gp1/report-gridley_corpus.json` and the `gp2` report (host, read only); the `gp1` and `gp2` failing sets are identical
(same board, cell, row, col, category, player). Database `afldb_v2_rb_gp1_g1_test`; scope: maxSeason 2026, siblings 390, all dataset
gaps false.

| Category | Findings | Distinct cells | Boards | Approval |
|---|---|---|---|---|
| `unsupported` | 78 | 78 | 26 (each exactly 3 cells) | `data/reference/gridley-approved-deferrals.json` (ISSUE-118 section 23.36 W.2/W.3, decided 2026-09-05) |
| `criterion disagreement` | 40 | 35 | 22 | `gridley-approved-sibling-disagreements.json`: D-GAP029-21 (21 Lyons), D-GAP029-D3 (11 Lyons, 2026 boards), D-GAP029-D4W (8 Webster) |

### 1.1 The 78 unsupported, by blocking criterion (every cell has exactly one unsupported criterion)

| Gridley criterion | Cells | Reason constant (`src/search/gridley-compat.ts`) |
|---|---|---|
| `season2024player` ("2024 LISTED PLAYER") | 42 | `NO_LISTS`, line 179; mapping line 545 |
| `intrulesplayer` ("INT'L RULES") | 15 | `NO_OTHER_CODE`, line 181; mapping line 544 |
| `irish` | 6 | `NO_BIRTHPLACE`, line 180; mapping line 541 |
| `recruitedByDodoro` | 6 | `NO_RECRUITER`, line 183; mapping line 514 |
| `tasmanian` | 3 | `NO_BIRTHPLACE`; mapping line 542 |
| `spoils5season` | 3 | `NO_SPOILS`, line 182; mapping line 305 |
| `nfl` | 3 | `NO_OTHER_CODE`; mapping line 543 |

The partner criterion is a different one in nearly every cell (clubs, decades, teammates, awards, stats); it plays no part in the
failure because the cell is never solved. Per-cell detail: `failing-cells-118.csv`.

### 1.2 The 40 brother findings, by partner criterion and by the Gridley player AFLDB omits

| Partner criterion | Lyons | Webster | Total |
|---|---|---|---|
| 2020s | 5 | 3 | 8 |
| BL | 4 | 0 | 4 |
| prelimfinals1 | 4 | 0 | 4 |
| marks10match | 3 | 1 | 4 |
| GC | 3 | 0 | 3 |
| games150 | 2 | 0 | 2 |
| games100 | 2 | 0 | 2 |
| 2010s | 2 | 0 | 2 |
| AD | 2 | 0 | 2 |
| goalscareerlessthan20 | 0 | 2 | 2 |
| finals1 | 1 | 1 | 2 |
| handballs20, disposals25, grandfinals1, finals10 | 1 each | 0 | 4 |
| woodenspoon | 0 | 1 | 1 |
| **Total** | **32** | **8** | **40** |

(The matching per-criterion totals agree with the 8/4/4/4/3/2/2/2/2/2/2/1/1/1/1/1 counts in the ISSUE-363 tier P README.)
Every row is the same shape: `inGridley:true`, `inAfldb:false`, `lackingBuilders:["has_brother"]` (the sole lacking builder), with the
the brother axis is `has_brother({})` and the partner axis an ordinary builder that the player satisfies. By cell position: 2-2 x20,
2-1 x13, 2-0 x6, 1-0 x1.

### 1.3 How the report and the test define and count these

- **`unsupported`**: `mapGridleyCriterion` returns `absent(reason)` = `{status:'unsupported', category:'data_absent'}`
  (`src/search/gridley-compat.ts:133`). In the cell loop, if either axis is `unsupported` the test pushes a finding
  `category:'unsupported'` and returns before any solving (`tests/integration/gridley-corpus.test.ts:554-558`). The solver
  (`compileAxis`) never sees these axes: there is no builder to refuse them.
- **`criterion disagreement`**: produced only in the has_brother branch of the known-answer comparison
  (`gridley-corpus.test.ts:709-722`): Gridley lists a player AFLDB omits, has_brother is the sole lacking builder, and
  `siblingCriterionDisagreement(...)` (`tests/gridley-corpus-support.ts:53-62`) finds the exact (profile, Gridley id, board, cell, row,
  col) in an enumerated evidence group. Otherwise the same situation is `source coverage gap` (none present).
- **N7 counting** (`gridley-corpus.test.ts:800-837`): `failing = findings.filter(not INFORMATIONAL and not (DIAGNOSTIC and
  DATA_GAPS))` (line 832) then `expect(failing).toHaveLength(0)` (line 834). `INFORMATIONAL` is line 213; `DATA_GAPS` is lines
  227-233. `criterion disagreement` is in neither set, so it fails in strict and in diagnostic mode; `unsupported` fails strict and is
  only counted (not failed) with `AFLDB_GRIDLEY_DIAGNOSTIC=1`. The header comment (lines 23-38) states the acceptance intent: every
  valid criterion is answered exactly, so an unsupported one is a failure here by design.
- **G-b** (`gridley-corpus.test.ts:839-843`): `gridleyPolicyResults(strict, deferralPolicy)` from `tests/gridley-release-policy.ts`
  and asserts `unapprovedDifferences == []`. `isApprovedGridleyDeferral` (lines 36-41) approves only `category==='unsupported'`
  findings whose (board, cell, row, col) is in the enumerated 78 and which involve one of the seven criteria; lines 54-59 approve a
  `criterion disagreement` only when its `siblingEvidence` echoes the finding exactly and `siblingCriterionDisagreement` is non-null.
  Duplicates (same cell and player) stay unapproved (line 52 key). Findings are never rewritten (file header). The policy file is
  corpus-hash pinned (`loadGridleyDeferrals`, lines 16-34), and each sibling evidence file is sha256 pinned in
  `gridley-approved-sibling-disagreements.json`. Existing pins in `tests/gridley-compat.test.ts` (lines 41-63, 83-112, 114-170, 191-230)
  assert `strictCorpusParity.passed === false` with exact findings 21/11/8/78 together with the approved counts, i.e. the strict
  failure is a deliberately retained fact.
- **Why approved deferrals "do not apply" to N7**: G-b subtracts the approved set and asserts the remainder is empty; N7 asserts the
  raw strict failure list is empty and has no subtraction. The approval files themselves say "not a waiver of strict parity",
  "retaining raw strict mismatches", "never rewrite findings". Hence N7 cannot pass while the approvals exist, on any base.

## 2. Mechanism per class

### 2.1 Unsupported (78): the data AFLDB does not model, not a solver defect

`mapGridleyCriterion` has no axis to map to, because the canonical database has no such data:
`season2024player` = a season list that includes listed players with no game (`NO_LISTS`, "AFLDB models games played, not season
lists"); `irish`/`tasmanian` = birthplace, nationality, state of origin; `nfl`/`intrulesplayer` = other-code careers and
International Rules; `recruitedByDodoro` = recruiter history; `spoils5season` = spoils (a statistic no ingested source carries; the
comment at line 182 notes `one_percenters` is a different measure). The solver has no criterion kind for any of these and does not
"refuse" them at solve time: the decision is the mapping layer (`gridley-compat.ts:133`, `:179-183`). The unit test
`tests/gridley-compat.test.ts` and `gridley-corpus.test.ts:491-504` pin this exact seven-id set so a new or spent entry fails.

### 2.2 Brother disagreements (40): Gridley's brother population includes AFL-listed brothers who never played; AFLDB's does not

`has_brother` (`src/db/queries/grid-solver.ts:1446-1455`) selects a player only through an explicit canonical `sibling` row
labelled 'brothers' or 'twin brothers' whose other side is a linked player with `player_career_stats.games > 0`. Mapping:
`gridley-compat.ts:513` (`brother: mapped('has_brother')`); spec label `grid-solver-spec.ts:528`.

Representative cells (all `Gridley lists, AFLDB omits`, direction Gridley-only):
- Board 562 cell 2-1, `brother x BL`: Gridley player 3746 = AFLDB player 6850 (Jarryd Lyons) listed by Gridley; AFLDB omits him
  because his brother Corey Lyons (Brisbane Lions, listed 2017-2020 per the evidence file; draft year 2016) has no senior
  appearance, so `games > 0` fails. 32 findings.
- Board 564 cell 2-2, `brother x games150` and board 606 cell 2-2, `brother x 2020s`: same player, same cause.
- Board 920 cell 2-2, `brother x 2020s`: Gridley player 3989 = AFLDB player 7305 (Jimmy Webster, Hawthorn) via brother Zac Webster
  (Hawthorn rookie 2013, senior list 2014, delisted Oct 2016, no AFL appearance found; the afl.com.au statement is cited in the
  evidence file). Zac has no AFLDB player row. 8 findings; 5 of them share a cell with a Lyons finding.

Cause class: the **brother criterion definition** (games > 0, an owner-preserved rule: D-GAP029-21 `preservedRule`) against
Gridley's wider reading. It is not the partner criterion (that builder is satisfied: the player is "lacking" only on has_brother),
not half-brothers or direction/symmetry (the SQL is symmetric over both columns and the failing direction is single-player), and
not a missing-sibling-row defect in the ordinary sense: the evidence files record that the relationship is established and the
participation condition fails. What Gridley intends (listed, or state-league VFL, or a key error) is explicitly recorded as not
provable from the key (`interpretationLimit`, evidence file).

## 3. Smallest fix per class, class A or B

No fix is (A). (A) was defined as code-only that cannot change modelling or corpus semantics; the only code-only candidates
change a gate or the supported set, which is (B).

| # | Change | Test home | Class | Notes |
|---|---|---|---|---|
| F1 | Record the accepted residual in `issues.md`/CHANGELOG: G-c is raw strict parity; G-b is the bounded conformance gate; 118 = 78 retained deferrals + 40 owner-approved sibling differences; 0 unapproved | none (documentation) | **B** (owner confirmation: it records an accepted residual, which ISSUE-373's own Next action allows) | No code. |
| F2 | N7 adopts approved subtraction (like G-b): assert `unapprovedDifferences == []` from `gridleyPolicyResults` in N7 and keep a separate non-failing strict count | `tests/integration/gridley-corpus.test.ts` | **B** (changes the G-c gate and its expectation) | Makes N7 duplicate G-b, so strict parity would be only logged. Must not delete or weaken the strict assertion silently (CLAUDE.md section 10); owner approval and an explicit rename needed. |
| F3 | Map `season2024player` to `played_in_season('2024')` (42 cells) | `tests/gridley-compat.test.ts`, `tests/integration/gridley-corpus.test.ts` | **B** | Changes which cells are supported; the comment at `gridley-corpus.test.ts:235-242` calls it a "redundant compatibility alias", but listed-with-no-game players make it a different population, so new disagreements are likely. Not measured here (section 4); would need a full re-run and then `ACCEPTED_UNSUPPORTED` plus the policy file change (corpus-hash and cell-list pinned). |
| F4 | Acquire birthplace/origin (9 cells), other-code careers (18), recruiter history (6) and spoils (3) data and add builders | grid-solver tests, `tests/gridley-compat.test.ts` | **B** (data work, modelling change) | Largest effort; reverses ISSUE-118 W.2 acceptance. |
| F5 | Relax `has_brother` to count AFL-listed brothers with no game | `tests/integration/grid-solver.test.ts`, gridley tests | **B** | Reverses D-GAP029-21 `preservedRule`; needs list/brother data AFLDB does not hold (Zac Webster has no player row); would break the `strictCorpusParity` pins in `gridley-compat.test.ts`. |

### Option table for the owner

| Option | What changes | Result for N7 | Consequence |
|---|---|---|---|
| 1. Accept residual (F1) | Documentation only | N7 stays red by design | No risk, no code; ISSUE-373 resolves by recorded residual, as its Next action allows. Every run still shows a failing test someone must remember to interpret. |
| 2. Approved-deferral subtraction in N7 (F2) | N7 gate rewritten | N7 green on tier P and snapshot | Closest to what G-b already asserts; strict mismatches become informational only. Needs owner sign-off on the gate change and a stale-guard: the 118 must stay enumerated. |
| 3. Solver/data work (F3, F4) | New criteria and data | N7 green only when all 78 supported and no new disagreement | Large; F3 is the only cheap first step and is unmeasured. |
| 4. Change brother definition (F5) | Modelling change | Removes the 40 | Reverses an owner decision; needs listing data; risks the 10,209 solved cells. |

Recommended path for the orchestrator: present options 1 and 2 to the owner; options 3 and 4 only if the owner wants the data
modelled. Nothing under section 3 should be implemented in this run without that decision.

## 4. What was NOT verified

- No database was started, queried or built. No new cluster was created, so none needs stopping. No full-corpus re-run and no
  per-cell diff of the 10,209 solved cells was performed (so no (A) eligibility could be established).
- Whether the Lyons and Webster `sibling` rows exist in `player_relationships` on the tested databases was not re-queried; the
  statements about Corey Lyons and Zac Webster come from the tracked evidence files
  (`data/reference/gridley-sibling-eligibility-*.json`), which I did not independently confirm against the web sources they cite.
- The expected-versus-answered membership comparison (`expectedGridleyIds` are Gridley ids, `actualAfldbIds` are AFLDB ids) was not
  usable as a set difference, so no per-cell "who is missing" list beyond the report's own detail line (Gridley 3746 = AFLDB 6850,
  Gridley 3989 = AFLDB 7305) was derived.
- That each of the seven unsupported criteria is truly absent from the database (versus a mapping omission) was inferred from the
  reason constants and the test pins, not queried.
- Whether G-c was ever green historically on a base without the approved evidence was not checked.
- The set-equality of the 40 findings with the approving files was checked on cell keys and player identity (profile and Gridley id)
  using the host report; the sha256 pins in the approval files were not recomputed.

## 5. Files written by this dispatch

- `docs/v2/evidence/backlog-20261121/issue373-gc-investigation/README.md` (this file) and `failing-cells-118.csv`.
- Host workspace `/mnt/ssd/afldb-backlog-20261122c-373` (mode 0700): `ex1.py` (reads the gp1/gp2 reports, no writes to them) and
  `ex1.json` (extracted failing-cell rows, about 300 KB, includes membership id lists; public AFL ids only). No cluster.
- Local scratch (scratchpad directory, outside the repo): an `ex1.py` copy and an `ex1.json` copy.
