# AFLDB-ISSUE-152 — Expand deterministic NL Search to newer AFLDB record families

**Stage 0 (allocation + inventory) runbook. No implementation.**

| | |
|---|---|
| Worktree | `D:\dev\afldb-issue-152` |
| Branch | `opus/issue-152-nl-record-expansion` |
| Base SHA | `c2761e64e9089f9e38572145e67a6ab2fee0fe12` (`Merge branch 'opus/issue-110-semantic-closeout'`) |
| Base freshness | `main` is AT that SHA — it has not advanced. `git merge-base HEAD main` = the same commit. |
| Parser baseline | `PARSER_VERSION` **34** (`src/search/nl/plan.ts:312`). **Not incremented by Stage 0.** |
| Status | **OPEN — STAGE 0 COMPLETE; PHASE B TECHNICALLY COMPLETE 2026-09-08 (all gates run, F5 CLOSED); PHASES C–F NOT STARTED.** Inventory complete, semantic contract approved, **evidence gate executed and GREEN (2026-09-08)**, **operator decisions final (2026-09-08, §7)**: D1–D5, D7, D9 approved; D10 partially approved; D11 requires DB-backed verification; D6/D8 deferred to AFLDB-ISSUE-153. Phase B implementation recorded at **§14**; its last two blocked gates were executed on 2026-09-08 and both passed (§14.4). The issue stays OPEN for Phases C–F and for the un-run rendered/browser and deploy steps only. |
| Migration | **One — `092_nl_search_log_coach_record_grain.sql` (Phase B, F5).** Stage 0's "none proposed" is superseded by implementation evidence (§14.6): the ninth `NlGrain` cannot be admitted without extending the `nl_search_log.grain` CHECK. Applied to `afldb_test` and verified 2026-09-08. |
| Found | 2026-09-08 |
| Evidence executed | 2026-09-08, `afldb_test` over the operator's `55432` tunnel, read-only, `ROLLBACK`. Production untouched. |

ISSUE-110 is Resolved and merged and is **not** reopened, amended or extended by this issue.

---

## 1. Stage-0 scope statement

ISSUE-152 compares the canonical/public AFLDB data surface against the typed
deterministic NL layer and identifies truthful missing semantic domains. Stage 0
delivers the inventory, the coverage matrix and the semantic decisions that need
an operator answer. It changes no parser, plan, compiler, corpus or UI behaviour.

---

## 2. Evidence pack

- **File:** `ISSUE-152-nl-evidence.sql` (worktree root, 1,033 lines, untracked at
  allocation time).
- **Output:** `ISSUE-152-nl-evidence-output.txt` (worktree root, untracked,
  UTF-16LE as written by PowerShell redirection).
- **Inspected:** yes.
- **Executed against `afldb_test`:** **YES — 2026-09-08, gate CLEARED.** See §2.2.
- **Safety re-verified by inspection:** opens `BEGIN TRANSACTION READ ONLY`,
  contains **zero** `INSERT`/`UPDATE`/`DELETE`/`DROP`/`ALTER`/`CREATE`/`TRUNCATE`/
  `GRANT`/`REVOKE`/`COPY` statements, closes with `ROLLBACK`. SELECT-only.
- **Schema contract:** its stated source contracts (`coaches`/`match_coaches`
  migration 087, `after_siren_kicks` 089, `player_relationships` +
  `father_son_selections` 006, `player_achievements` 053) were checked against the
  migrations in this worktree and **all match**, including column names, the
  nullable link columns and the `relationship_type` enum.

### 2.1 Query inventory (41 labelled query sections)

| § | Queries |
|---|---|
| 0 Inventory | 0.1 row/link counts, 0.2 season/date coverage |
| 1 Coaching | 1.1 career leaders W-D-L, 1.2 leaders by wins, 1.3 win% at 50+ games, 1.4 Richmond lineage-scoped, 1.5 Richmond 2017, 1.6 multi-organization coaches, 1.7 played-and-coached seam, 1.8 identity/link boundary |
| 2 After-the-siren | 2.1 event-domain distribution, 2.2 competition/match-link coverage, 2.3 player-link boundary, 2.4 leaders, 2.5 goals against Richmond, 2.6 won/drew, 2.7 finals, 2.8 first/most recent |
| 3 Family | 3.1 types + link completeness, 3.2 labels, 3.3 sibling witnesses, 3.4 parent-child witnesses, 3.5 largest families, 3.6 unlinked boundary |
| 4 Father-son | 4.1 coverage/link statuses, 4.2 by club organization, 4.3 Geelong witness, 4.4 fully linked witnesses |
| 5 First-kick goal | 5.1 coverage/link, 5.2 source annotations, 5.3 first/most recent, 5.4 Richmond lineage, 5.5 the 1990s |
| 6 Cross-domain | 6.1 players who later coached Richmond, 6.2 Richmond players who coached Richmond, 6.3 father-son players who coached |
| 7 Witnesses | 7.1 coaching thresholds, 7.2 Richmond coach thresholds, 7.3 after-siren boundaries, 7.4 per-subtype witnesses, 7.5 per-enum witnesses |

§7 exists specifically to derive thresholds from the data rather than assert
them — the ISSUE-110 lesson. **No threshold in this runbook is asserted as
returning rows.** Where a threshold is needed, the matrix cites the §7 query
that must supply it instead of naming a number.

### 2.2 Execution — operator gate CLEARED

Executed by the operator on **2026-09-08** against `afldb_test` over the local
`55432` SSH tunnel, read-only, production untouched.

| | |
|---|---|
| Target | `afldb_test` (never production, never `afldb_dev`) |
| Transaction | `BEGIN TRANSACTION READ ONLY` … `ROLLBACK` — both reached |
| Terminator | `END AFLDB-ISSUE-152 NL EVIDENCE PACK` printed |
| Failures | none — no `ERROR:`, `FATAL:` or `psql:` line in the output |
| Sections returned | 41 of 41 |

**Evidence-pack-only SQL corrections made before the successful run** (no
product, schema, query or test file was touched):

1. §7.4 — `id` qualified as `a.id` in both the `SELECT` list and the `ORDER BY`
   (ambiguous between the ranked CTE and the joined table).
2. §2.8 — `id AS event_id` restored from the ranked CTE after an earlier broad
   replacement had rewritten it to `a.id`.

`ISSUE-152-nl-evidence.sql.bak` is the pre-correction copy and is untracked
scratch; it is not part of the contract.

Everything in §§3–5.2 is **code- and schema-derived and did not depend on that
output**. The measured results are recorded in **§5.3** and settle **D1–D5**,
**D7** and **D9**; **D6** and **D8** remain deferred to AFLDB-ISSUE-153 by
operator decision, though §5.3 materially changes their premise.

---

## 3. Current deterministic NL implementation — what it can express today

Pipeline (unchanged): canonicalise → parse → plan → validate → compile →
PostgreSQL → answer → describe/render.

### 3.1 Grains (`NlGrain`, `plan.ts:316`)

`player_career`, `player_game`, `player_season`, `team_match`, `club_season`,
`team_streak`, `head_to_head`, `achievement_summary`. Eight, each with exactly
one compiler in `src/db/queries/nl/execute.ts`, one `NlAnswerPayload` variant
(`answer-types.ts:101`), one `describe*Answer` branch (`describe.ts`) and one
table component in `src/components/NlAnswerSection.tsx`.

**There is no person grain that is not a player.** Every existing grain that
names a person names a `players` row.

### 3.2 The typed plan (`NlQueryPlan`, `plan.ts:817`)

Closed catalogues, all allowlist-then-bind: `NL_METRICS` (per grain),
`NL_CAREER_COLUMNS`, `NL_AWARDS`, `NL_ACHIEVEMENTS`, `NL_CLUB_SEASON_CONDITION_KINDS`,
`NL_HAVING_METRICS`, `NlMatchType`, `GRID_BUILDERS`. `validatePlan`
(`plan.ts:996`) is exhaustive and fail-closed — ~80 distinct refusals, each
per-grain, and scope a grain's compiler cannot consume is refused rather than
dropped (the ISSUE-110 v33 ownership rule, `NL_CAREER_SEASON_OWNING_BUILDERS` /
`NL_CAREER_CLUB_OWNING_BUILDERS`).

### 3.3 Career predicates reuse `GRID_BUILDERS` — but the parser reaches only 8 of them

`NlQueryPlan.careerPredicates` is `GridAxisState[]`, compiled by the grid
solver's `compileAxis`. `GRID_BUILDERS` holds **179** builders. The NL parser
can emit exactly **eight**:

| Builder | Emitted at |
|---|---|
| `debuted_between` | `parser.ts:1483` |
| `first_kick_goal_for_club` | `parser.ts:2105` |
| `first_kick_goal_between` | `parser.ts:2109` |
| `first_kick_goal_player` | `parser.ts:2119` (via `NL_ACHIEVEMENTS`) |
| `match_event_min` | `parser.ts:454` |
| `matchup_played_min` | `parser.ts:463` |
| `grand_finals_played_min` | `parser.ts:751` |
| `prelim_finals_played_min` | `parser.ts:751` |

**This is the single most important Stage-0 finding.** The builders
`coached_by`, `premiership_coach`, `after_siren_winner`, `father_son_selection`,
`father_son_father` and `has_brother` are **already implemented, already
parameterised, already lineage-correct and already grid-tested** — and are
**unreachable from natural language**. A large part of ISSUE-152 is parser
wiring, not new SQL.

### 3.4 First-kick goal — already substantially supported

`FIRST_KICK_GOAL_RE` (`vocab.ts:700`) + `extractFirstKickGoal`
(`parser.ts:372`) + `ACHIEVEMENT_SUMMARY_CUES` (`vocab.ts:725`) +
`achievement_summary` grain + `achievement-summary.ts`. Six summary kinds:
`by_club`, `by_decade`, `by_season`, `clubs_without`, `earliest`, `latest`.
Negation is handled explicitly (a "never" governing the phrase declines rather
than inverting).

### 3.5 The coaching decline is now a false statement

`vocab.ts:882-884`, `UNANSWERABLE_TOPICS`:

```ts
{
  re: /\bcoach(?:es|ed|ing)?\b/,
  topic: 'coaching',
  reason: 'AFLDB has no coaching data at all -- no coach, no coach-per-club-season, nothing.',
},
```

That reason was true when written. Since migration **087** AFLDB has `coaches`
(one row per person, `player_id` seam, `link_status_value`) and `match_coaches`
(the per-match assignment), plus `/coaches`, `/coaches/[slug]`,
`/records/coaches`, club-page coaching records and player-page coaching career.
The rule now **declines every coaching question with an untrue reason**, and it
fires before entity extraction, so it also swallows any future coaching support.

This is a truthfulness defect in its own right, not merely a missing feature.
It is tracked here as **Finding F2** (§8).

### 3.6 Vocabulary gaps

`grep` over `src/search/nl/`: **zero** occurrences of `siren`; **zero** family,
father-son, sibling or relationship vocabulary (the `relationship` hits are
head-to-head club-relationship language, unrelated). Those families therefore
decline today as `unrecognised`/`low_confidence` — an honest decline, but a
decline.

### 3.7 Regression gates

| Corpus | Path | Rows |
|---|---|---|
| Realistic rendered | `tests/nl-ui/corpora/afldb-ui-questions-1440-real-user-v3-20260822.csv` | 1,435 |
| Decline rendered | `tests/nl-ui/corpora/afldb-ui-questions-60-real-user-decline-v3-20260822.csv` | 60 |

**Neither corpus contains a single question matching `coach`, `siren`, `father`,
`brother`, `sibling`, `famil` or `relative`.** Consequence: the ISSUE-152
families are **purely additive** to both gates. No existing expectation needs to
change, and removing the §3.5 coaching decline cannot flip an existing row.
Neither corpus is modified by Stage 0.

Test homes to extend (never replace): `tests/nl-parser.test.ts`,
`tests/nl-plan.test.ts`, `tests/nl-describe.test.ts`,
`tests/nl-audit-acceptance.test.ts`, `tests/integration/nl-answers*.test.ts`,
`tests/nl-ui/nl-stress.spec.ts`.

---

## 4. Canonical/public data families

| Family | Table(s) | Grain | Public UI | NL today | Grid Solver today |
|---|---|---|---|---|---|
| Coaching | `coaches`, `match_coaches` (087) | one row per (match, club) | `/coaches`, `/coaches/[slug]`, `/records/coaches`, club page, player page | **declined, falsely** | `coached_by`, `premiership_coach` |
| After-the-siren | `after_siren_kicks` (089) | one curated event | `/records/after-the-siren`, player page | none | `after_siren_winner` |
| Family | `player_relationships` (006) | one relationship row | `/records/family` | none | `has_brother` |
| Father–son (draft rule) | `father_son_selections` (006/088) | one selection | **none** — see F1 / ISSUE-153 | none | `father_son_selection`, `father_son_father` |
| Parent–child pairs | `player_relationships` | one relationship row | `/records/father-son` | none | none |
| First-kick goal | `player_achievements` (053) | one curated achievement | `/records/first-kick-goal` | **substantially supported** | 5 builders |

The eight classic `RECORD_CATEGORIES` (`records.ts:55`) — most games, goals,
finals, premierships, Brownlow votes, goals in a game/season, disposals in a
game — are **already covered** by existing NL grains. The five *new* record
boards are exactly the families above. No other post-NL-design canonical/public
record family was found.

### 4.1 Key schema facts that constrain semantics

- `match_coaches.club_id → clubs(id)` — the **raw historical identity**, not the
  organization. Lineage folding must go `clubs.organization_id`, exactly as
  `getClubCoachRecords` already does.
- `coaches.source_games_coached` is **evidence only** (the migration header says
  so explicitly). Never an answer total.
- `coaches.player_id` is NULL for coach-only people; `coaches_link_ck` forces
  `player_id IS NOT NULL ⟺ link_status_value = 'unique'`.
- `after_siren_kicks` carries four independent typed dimensions — `kick_scored`
  (goal/behind/none), `kick_effect` (won/drew/none), `kicker_result`
  (win/draw/loss), `siren` (final/end_of_regulation/end_of_extra_time) — plus
  `premiership_season`, and `after_siren_kicks_match_ck` guarantees
  `match_id IS NULL` for every non-premiership row.
- `player_relationships` has a **nullable player id on both sides** and an
  8-member `relationship_type` enum: `parent_child`, `sibling`,
  `grandparent_grandchild`, `aunt_uncle_niece_nephew`, `cousin`, `spouse`,
  `in_law`, `other`. `relationship_label` carries the finer wording; the
  `has_brother` builder proves the stored labels include `'brothers'` and
  `'twin brothers'`, so **sex-specific "brothers" wording IS supported by the
  data** — but only through the label, never inferred from `sibling`.
- `father_son_selections` carries **two independent link statuses**
  (`drafted_link_status`, `father_link_status`) plus `club_id`, `draft_year`,
  `rule`, `selection_pick`.
- `player_achievements` first-kick-goal carries four decoded typed columns:
  `consecutive_goal_kicks`, `no_further_career_goals`,
  `no_further_career_kicks`, `kickless_matches_before_first_kick`.

### 4.2 Reusable SQL that already exists

`src/db/queries/coaches.ts` already implements the **entire** coaching answer
surface, lineage-correct and with the site's draw-weighted win rate
`(W + D/2) / G * 100`:

| Function | Answers |
|---|---|
| `getCoachRecordsByGames` | league-wide games/W-D-L/finals/GF/premierships leaders |
| `getCoachRecordsByWinPct(minGames)` | league-wide win-percentage leaders |
| `getClubCoachRecords(clubId)` | every coach of one club **by `organization_id` lineage**, that club only |
| `getCoachCareer` / `getPlayerCoachingCareer` | one coach's career + per-club stints |
| `getCoachOptions` | the coach directory (`display_name` + season span) |

An NL coach compiler is a **parameterised generalisation of these**, not new
semantics. The same is true of `getAfterSirenRecords`, `getFamilyRecords`,
`getFatherSonRecords` and the six unreachable grid builders in §3.3.

---

## 5. Coverage matrix

Statuses: **SUPPORTED** · **GAP-SAFE** (safe to add) · **GAP-DECIDE** (needs a
semantic decision) · **GAP-LIMIT** (data/identity limitation) · **DECLINE**
(the decline should remain).

The required columns are split across a compact status table and the per-family
detail blocks that follow it, because an 18-column table is unreadable. Every
required column is present.

### 5.1 Status table

| # | Family / subfamily | Status | Proposed grain / builder | Schema change | Phase | Evidence |
|---|---|---|---|---|---|---|
| A1 | Coaches of a club ("who coached Richmond") | GAP-SAFE | `coach_record`, club-scoped list | no | B | 1.4 |
| A2 | Coach whole-career record | GAP-SAFE | `coach_record` + `coach` ref | no | B | 1.1 |
| A3 | Coach record at one club | GAP-SAFE | `coach_record` + `coach` + `clubFor` | no | B | 1.4 |
| A4 | Club-scoped coach ranking (most wins/games for a club) | GAP-SAFE | `coach_record`, metric + `clubFor` | no | B | 1.4, 7.2 |
| A5 | League-wide coach ranking | GAP-SAFE | `coach_record`, metric, no club | no | B | 1.1, 1.2 |
| A6 | Coach win percentage | GAP-DECIDE (**D1**) | `coach_record` metric `win_pct` | no | B | 1.3 |
| A7 | Coach threshold ("Richmond coaches with 100+ wins") | GAP-SAFE | `coach_record` + `metricCondition` | no | B | 7.1, 7.2 |
| A8 | Season-scoped coaching ("who coached Richmond in 2017") | GAP-SAFE | `coach_record` + `seasonMin/Max` (owned) | no | B | 1.5 |
| A9 | Coaches of more than one club | GAP-DECIDE (**D2**) | `coach_record` + clubs-coached condition | no | B | 1.6 |
| A10 | Coaches with (multiple) premierships | GAP-SAFE | `coach_record` metric `premierships` | no | B | 1.1 |
| A11 | "Players coached by X" | GAP-SAFE | reuse `coached_by` | no | B | 1.7 |
| A12 | "Premiership coaches" as players | GAP-DECIDE (**D3**) | reuse `premiership_coach` | no | B | 1.7 |
| B1 | Players who kicked a goal after the siren | GAP-SAFE | `after_siren` grain, `kick_scored='goal'` | no | C | 2.1, 7.4 |
| B2 | Most after-siren goals / kicks | GAP-SAFE | `after_siren` metric `goals`/`attempts` | no | C | 2.4, 7.3 |
| B3 | After-siren kicks that won the game | GAP-SAFE | `after_siren` + `kick_effect='won'` (or reuse `after_siren_winner`) | no | C | 2.6, 7.4 |
| B4 | After-siren kicks to draw | GAP-SAFE | `after_siren` + `kick_effect='drew'` | no | C | 2.6, 7.4 |
| B5 | After-siren goals **against** a club | GAP-SAFE | `after_siren` + `clubAgainst` (lineage) | no | C | 2.5 |
| B6 | After-siren goals **for** a club | GAP-SAFE | `after_siren` + `clubFor` (lineage) | no | C | 2.5 |
| B7 | After-siren events in finals | GAP-DECIDE (**D4**) | `after_siren` + `matchType='finals'` | no | C | 2.7 |
| B8 | After-siren events in a season | GAP-SAFE | `after_siren` + season range | no | C | 2.2 |
| B9 | First / most recent after-siren goal | GAP-SAFE | `after_siren` + `earliest`/`latest` | no | C | 2.8 |
| B10 | After-siren events by `<player>` | GAP-SAFE | `after_siren` + `player` | no | C | 2.3 |
| B11 | Misses, `shot_detail`, `siren` subtype | GAP-DECIDE (**D5**) | `after_siren` extra dimensions | no | C | 2.1, 7.4 |
| B12 | Non-premiership (NAB Cup etc.) events | GAP-LIMIT | excluded by default | no | C | 2.2 |
| C1 | Biggest football families | GAP-DECIDE (**D6**) | `family` grain, combined games | no | D | 3.5 |
| C2 | Brothers who played AFL | GAP-SAFE | reuse `has_brother` (label-backed) | no | D | 3.2, 3.3 |
| C3 | Parent–child AFL players | GAP-SAFE | `family`, `relationship='parent_child'` | no | D | 3.4 |
| C4 | Family members of `<player>` | GAP-SAFE | `family` + `player` | no | D | 3.3, 3.4 |
| C5 | Families with N AFL players | GAP-SAFE | `family` + `metricCondition` on members | no | D | 3.5, 7.5 |
| C6 | Cousins / grandparent / in-law / spouse | GAP-DECIDE (**D7**) | `family` + relationship key | no | D | 3.1, 7.5 |
| C7 | Rows with one/both sides unlinked | GAP-LIMIT | excluded from player results | no | D | 3.6 |
| FS1 | Father–son **selections** (the draft rule) | GAP-DECIDE (**D8**) | reuse `father_son_selection` | no | D | 4.1, 4.4 |
| FS2 | Club-scoped father–son selections | GAP-DECIDE (**D8**) | needs a new club-scoped builder | no | D | 4.2, 4.3 |
| FS3 | Father–son selections by draft year | GAP-DECIDE (**D8**) | needs a new year-scoped builder | no | D | 4.1 |
| FS4 | Fathers of father–son selections | GAP-SAFE | reuse `father_son_father` | no | D | 4.4 |
| FS5 | Selection pick / rule detail | GAP-LIMIT | not naturally expressible; decline | no | — | 4.1 |
| FS6 | Father–son selections by club / by year (distribution) | GAP-SAFE | `achievement_summary`-shaped grouping | no | D | 4.2 |
| E1 | Who kicked a goal with their first kick | **SUPPORTED** | `player_career` + `first_kick_goal_player` | no | — | 5.1 |
| E2 | Club-scoped first-kick goals | **SUPPORTED** | `first_kick_goal_for_club` | no | — | 5.4 |
| E3 | Season/decade-scoped first-kick goals | **SUPPORTED** | `first_kick_goal_between` | no | — | 5.5 |
| E4 | First / most recent first-kick goal | **SUPPORTED** | `achievement_summary` `earliest`/`latest` | no | — | 5.3 |
| E5 | By club / decade / season / clubs-without | **SUPPORTED** | `achievement_summary` | no | — | 5.1 |
| E6 | First-kick goal by `<player>` | GAP-SAFE | `player` + achievement predicate | no | E | 5.1 |
| E7 | Goal with each of first N kicks | GAP-SAFE | reuse `first_kick_goal_consecutive_min` | no | E | 5.2 |
| E8 | First-kick goal was their only career goal | GAP-SAFE | reuse `first_kick_goal_only_career_goal` | no | E | 5.2 |
| E9 | `no_further_career_kicks`, `kickless_matches_before_first_kick` | DECLINE | — | no | — | 5.2 |
| X1 | Players who later coached club X | GAP-DECIDE (**D9**) | cross-grain composition | no | F | 6.1, 6.2 |
| X2 | Premiership players who became coaches | GAP-DECIDE (**D9**) | cross-grain composition | no | F | 6.3 |
| X3 | Father–son players who became coaches | GAP-DECIDE (**D9**) | cross-grain composition | no | F | 6.3 |

The **Evidence** column names the query that must supply each value. Those
queries have now been run: the measured witnesses, threshold counts, coverage
boundaries and identity limits are in **§5.3**, and no status in the table above
changed as a result — except that **E1–E5 remain SUPPORTED on code, but cannot
be proven against `afldb_test`**, which holds zero first-kick-goal rows
(Finding **F4**, decision **D11**).

### 5.2 Per-family detail

#### A — Coaching

- **Canonical source / true grain:** `match_coaches`, one row per (match, club).
  Everything else — games, W-D-L, win %, finals, Grand Finals, premierships — is
  **derived** from `match_coaches ⋈ matches`. `coaches.source_games_coached` is
  cross-check evidence and is never the answer.
- **Currently answerable dimensions:** none (falsely declined).
- **Currently answerable aggregations:** none.
- **Missing semantics:** all seven readings the brief names — coach career
  record; coach record at one club; club-scoped coach ranking; league-wide coach
  ranking; coaches of a club; season-scoped assignment; coach-only vs
  also-played identity.
- **Identity/link limitations:** **386** coach rows (measured §1.8 — the "383"
  written at allocation time was source-derived and is corrected here): **368**
  `unique` with a player link, **18** `unmatched` coach-only. Coach-only people
  **must not** be given a player link or a `/players` href. The names shared with
  players (Ron Barassi, Mark Williams, Damien Hardwick) are, for the 368, the
  *same person* rather than a collision — but a `coach` reference must still be a
  **distinct plan field** from `player`, because 18 coaches have no player row at
  all and because "games" means a different number for the same human.
- **Historical/coverage limitations:** the source `Coach` column covers 32,034
  of 33,676 team-matches, with gaps before 1923 and eleven 1940 records. A
  season-scoped coaching question before ~1923 must carry a coverage note or
  decline — an `NL_COVERAGE` entry, exactly as stat coverage already works.
  Exact first/last season: **§0.2**.
- **Lineage:** club scope by `clubs.organization_id`, matching
  `getClubCoachRecords`. Footscray coaching counts on Western Bulldogs; a merger
  is a different organization and never folds.
- **Ambiguity/collision risks:** "games" (played vs coached); "club" (played for
  vs coached); "wins" (player career wins vs coaching wins); the coach/player
  name collision above. Every one of these must be disambiguated by the
  *subject* the question names, not guessed.
- **Win-percentage convention:** `(W + D/2) / G * 100`. Do not silently switch to
  `W/G`. `/venues` uses `wins/games` for a *venue* record — a different board
  with a different convention; do not cross-contaminate.

#### B — After-the-siren

- **Canonical source / grain:** `after_siren_kicks`, one curated cited event.
  **Never** inferred from scores or `player_match_stats`.
- **Missing semantics:** everything; there is no `siren` token in the NL layer.
- **The four dimensions must stay distinct.** In particular "goal after the
  siren" (`kick_scored='goal'`) ≠ "goal after the siren **to win**"
  (`kick_scored='goal' AND kick_effect='won'`). The existing `after_siren_winner`
  builder is the **second** of those and additionally admits a winning *behind*
  — so it answers "won a game with a kick after the siren", and must not be
  reused as the answer to "kicked a goal after the siren".
- **Identity/link limitations:** `player_id` nullable; trusted only at
  `link_status_value IN ('unique','resolved')`. Unlinked rows are real evidence
  but cannot produce a player result. Counts: **§2.3**.
- **Coverage limitations:** `after_siren_kicks_match_ck` means non-premiership
  rows (Escort Championships, NAB Cup, JLT) **never** have a `match_id`. A
  finals or round scope is therefore only meaningful over
  `premiership_season = true` rows. Counts: **§2.2**.
- **Lineage:** both `club_id` and `opponent_club_id` are raw `clubs` ids — fold
  via `organization_id` for "against Richmond".

#### C — Family / relationships

- **Canonical source / grain:** `player_relationships`, one relationship row;
  `family_key` groups a family.
- **Do not invent** biological sex, direction, or AFL-playing status. What the
  data *does* support: `relationship` (8-member enum), `relationship_label`
  (proven to include `'brothers'`/`'twin brothers'` by `has_brother`),
  `person_a_role`/`person_b_role` (proven to include `'father'`/`'son'` by
  `getFatherSonRecords`). Full label and role inventory: **§3.2**, **§7.5**.
- **Identity/link limitations:** both sides nullable, by design — "many
  recorded family members never played VFL/AFL". `has_brother` additionally
  requires the *other* side to have `player_career_stats.games > 0`, i.e. to have
  actually played. A relationship question that returns players must apply the
  same rule. Unlinked counts: **§3.1**, **§3.6**.
- **Ambiguity/collision risk:** "family" also appears innocently in football
  prose; the vocabulary must require a genuine relationship cue.

#### D — Father–son

- **Canonical source / grain:** `father_son_selections`, one draft selection.
  This is a *draft-rule* fact and is **not** synonymous with `parent_child`.
- **Identity/link limitations:** two independent link statuses. An unlinked
  father name is a name and **must never** be converted into a canonical player
  identity. Counts: **§4.1**.
- **Lineage:** `club_id` is a raw `clubs` id; a "Geelong father-son selections"
  question folds by `organization_id`.
- **Coverage:** `draft_year` range from **§4.1**.

#### E — First-kick goal

- Already the best-covered family. The remaining safe additions (E6–E8) reuse
  builders that already exist. E9 is recommended for **decline**: `no_further_career_kicks`
  and `kickless_matches_before_first_kick` are source-legend minutiae with no
  natural question, and the brief explicitly warns against exposing obscure
  source-legend detail merely because a column exists.

#### F — Cross-domain

- The typed plan **can** express these architecturally — `careerPredicates` is a
  list of independently-compiled `EXISTS`/`IN` fragments, and a coaching
  predicate would be one more. What is missing is **ownership**: every filter in
  the question must be consumed by a builder that takes it as a parameter, or
  validation must refuse it. "Players who later coached Richmond" needs a
  `coached_club(org)` builder that owns the club; without one, the club would
  reach SQL as nothing at all — precisely the ISSUE-110 finding-B failure.
- **"later" is not expressible.** Neither `coached_by` nor any proposed builder
  carries a temporal ordering between a playing career and a coaching career.
  "Players who **later** coached Richmond" must therefore either be answered as
  "players who **also** coached Richmond" — a different question — or decline.
  **Recommend: decline the "later" wording, support the "also" wording.**
- Stage 0 recommendation: **do not implement F until B–D are green.**

### 5.3 Measured evidence — `ISSUE-152-nl-evidence-output.txt` (`afldb_test`, 2026-09-08)

Everything in this section is *measured*, not asserted. Where a query was
`LIMIT`-bounded it yields **witnesses, not exhaustive counts**, and is marked so.

#### 5.3.0 Inventory (§0.1, §0.2 — exhaustive)

| Family | Rows | Trusted link | Unlinked | Span |
|---|---|---|---|---|
| `match_coaches` | 32,034 | 32,034 | 0 | seasons 1902–2025 |
| `coaches` | 386 | 368 `unique` | 18 `unmatched` | — |
| `after_siren_kicks` | 126 | 120 | 6 | seasons 1913–2026 |
| `player_relationships` | 625 | 485 both-linked | 140 | — |
| `father_son_selections` | 127 | 96 both-linked | 31 | draft years 1988–2025 |
| `player_achievements` first-kick-goal | **0** | 0 | 0 | — (see **F4**) |

**Truncation register.** `LIMIT`-bounded (witness lists only): §1.1, §1.2, §1.3
(25); §1.6, §1.7, §2.4, §3.5 (50); §3.3, §3.6 (100). Everything else returned
fewer rows than its limit, or was unbounded, and is **exhaustive**: §0.1, §0.2,
§1.4 (42), §1.5, §1.8, §2.1, §2.2, §2.3, §2.5, §2.6 (80), §2.7, §2.8, §3.1,
§3.2, §3.4 (96), §4.1–§4.4, §5.1–§5.5 (0), §6.1 (41), §6.2 (27), §6.3, §7.1–§7.5.

#### 5.3.A Coaching

- **Distribution over all coaches (§7.1, exhaustive):** games min 1, max 718,
  median 43; wins min 0, max 466, median 15.
- **League-wide leaders (§1.1/§1.2, top 25 — witnesses only):** games Mick
  Malthouse 718; wins Jock McHale 466; premierships Jock McHale 7, Norm Smith 6,
  Frank Hughes 5.
- **Win percentage (§1.3, 50+ games, top 25):** leader **Cliff Rankin 78.95**
  (57 g, 45 W, 0 D). The draw-weighted convention is confirmed arithmetically —
  George Angus 41 W / 2 D / 60 g → `(41 + 1) / 60 = 70.00`, not `41/60`.
- **Club-scoped, organization lineage (§1.4 and §7.2, both exhaustive):** the
  Richmond organization has **42** coaches, 1908–2025. Exact threshold counts,
  usable directly as test expectations:

  | Threshold (Richmond org) | Count | Boundary witnesses |
  |---|---|---|
  | ≥ 200 coached games | 3 | Hardwick 307, Hafey 248, Dyer 222 |
  | ≥ 100 coached games | 8 | … Dan Minogue 101 (lowest inside) |
  | ≥ 50 coached games | 14 | … Des Rowe / Albert Pannam 54 |
  | ≥ 100 coaching wins | 3 | Hafey 173, Hardwick 170, Dyer 134 |
  | ≥ 50 coaching wins | 7 | … Tony Jewell 53 (Danny Frawley 45 excluded) |
  | ≥ 25 coaching wins | 14 | … Jeff Gieschen / Barry Richardson 25 |

- **Season witness (§1.5, exhaustive):** Richmond in 2017 → exactly one coach,
  **Damien Hardwick**, 25 games, 18 W, 0 D, 7 L. A single-row answer shape.
- **Multi-club (§1.6, top 50):** maximum 5 organizations (Dan Minogue, John
  Northey). **The two readings in D2 genuinely differ**, with measured witnesses:
  **Denis Pagan** and **Terry Wallace** each show **2 organizations / 3 club
  identities** (North Melbourne + Kangaroos, Footscray + Western Bulldogs).
- **Identity seam (§1.8, exhaustive):** 368 `unique` (all player-linked) / 18
  `unmatched` (no player link). No `resolved` status exists for coaches. **4.7%
  of coaches are unreachable from any player-grain builder** — this is the exact
  size of the D3 seam.
- **Coverage boundaries:** no `match_coaches` row before season **1902** or after
  **2025** (§0.2). A coaching question about 1897–1901 or about 2026 has no data
  in this database and must say so rather than answer zero.
- **Split stints are real:** Jack Titus coached Richmond in **1937 and 1965**
  (3 seasons, 17 games); Dick Harris in **1944 and 1964**. `first_season ..
  last_season` is therefore **not** a continuous tenure and must never be
  rendered as one.

#### 5.3.B After-the-siren

- **Domain distribution (§2.1, exhaustive, 12 combinations over 126 events).**
  Premiership rows: `goal/won` 58 + 1 (`end_of_extra_time`), `goal/drew` 8,
  `behind/won` 5, `behind/drew` 3, `behind/none` 21, `none/none` 25 (18 loss,
  6 draw, **1 win**). Non-premiership: `goal/won` 3, `goal/drew` 1,
  `behind/won` 1.
- **`kicker_result` is independent of `kick_effect`:** one event is
  `kick_scored='none'`, `kick_effect='none'`, `kicker_result='win'`. "Missed
  after the siren **and lost**" is strictly narrower than "missed after the
  siren", and must not be compiled as the same predicate.
- **Competition coverage (§2.2, exhaustive):** VFL/AFL 121 (116 match-linked,
  5 not); NAB Cup 3, Escort Championships 1, JLT Community Series 1 — **none of
  the 5 non-premiership rows has a match link**, exactly as
  `after_siren_kicks_match_ck` requires.
- **The non-premiership trap has concrete witnesses (§2.6).** Five rows carry
  premiership-looking round labels while being `premiership_season = false`:
  Jack Riewoldt 2013 "round 3", Luke Russell 2013 "round 1", Mark Williams 2011
  "round 1", Ed Langdon 2017 "round 3", and **Kerry Good 1980 `round_raw = 'GF'`**
  (North Melbourne v Collingwood, Escort Championships). Any round- or
  finals-shaped filter that reads `round_raw` without `premiership_season = true`
  returns them as home-and-away or Grand Final events. **This is why B12 is
  GAP-LIMIT and why D4 must be premiership-only.**
- **Finals (§2.7, exhaustive):** 8 premiership finals events, **all
  match-linked** — EF Luke Shuey 2017; QF Isaac Smith 2016, David King 1994,
  Bill Brownless 1994; PF Tony Lockett 1996, Gary Ablett 1994, Gary Buckenara
  1987; SF Alex Jesaulenko 1972. **No VFL/AFL Grand Final after-siren event
  exists** — "after the siren in a Grand Final" must return an honest empty
  result, never the 1980 Escort Championships row.
- **Metric ceiling (§7.3, exhaustive):** max kicks per player **2**, max goals
  **2**, max game-winners **2**. §2.4: exactly two players hold 2 after-siren
  goals — **Barry Hall** and **Gary Rohan**, both with 2 winning goals; seven
  more have 2 kicks; everyone else has 1. **Every after-siren superlative is a
  tie**, so `max`/`top_n` must return a tie set, and no threshold above 2 has any
  witness.
- **Lineage witness (§2.5, exhaustive):** 4 goals after the siren *against* the
  Richmond organization — Bill Wood (**Footscray** 1946), Karmichael Hunt (Gold
  Coast 2012), David Mundy (Fremantle 2017), Noah Anderson (Gold Coast 2022).
  The 1946 row proves the "for/against Western Bulldogs" reading must fold by
  `organization_id`.
- **Recency boundary (§2.8 vs §2.6/§7.4) — new decision D10.** The most recent
  **match-linked** event is 2025-07-27, Nasiah Wanganeen-Milera (St Kilda v
  Melbourne, match 16792). Four **2026** events exist with
  `premiership_season = true` and **no `match_id`** — Cameron Zurhaar, Dylan
  Moore (×2), Tim Membrey. "The most recent goal after the siren" therefore has
  two different truthful answers depending on whether a match link is required.
  Note this particular instance may be an `afldb_test` artefact (its `matches`
  evidence stops in 2025); the compiler rule still has to be decided.
- **Subtype witnesses (§7.4, exhaustive over the six present
  `(kick_scored, kick_effect)` pairs):** `goal/won` 124, `goal/drew` 123,
  `behind/won` 103, `behind/drew` 94, `behind/none` 126, `none/none` 125.
  **Four of the six are the 2026 rows with `match_id` NULL** — DB-backed tests
  needing a match link must take linked substitutes from §2.6/§2.7, e.g.
  `behind/won` → Michael Walters 2019 (event 103, match 15495), `behind/drew` →
  Tom Hawkins 2017 (event 94, match 15114).
- **`siren` subtype populations (§2.1):** `final` dominant, `end_of_regulation`
  **1**, `end_of_extra_time` **1**. Single witnesses; nothing rankable.
- **Player link (§2.3, exhaustive):** 120 `unique` and cited; 5 `unmatched` and
  cited; 1 `unmatched`, uncited. Only `unique` and `unmatched` occur.

#### 5.3.C Family / relationships

- **Only two relationship types exist (§3.1, exhaustive):** `sibling` **498**
  (389 both-linked, 109 not, **378** `family_key`s) and `parent_child` **127**
  (96 both-linked, 31 not, **0 `family_key`s**). `cousin`,
  `grandparent_grandchild`, `aunt_uncle_niece_nephew`, `spouse`, `in_law` and
  `other` have **zero rows**. §7.5 confirms: only two enum members have a witness.
- **Label inventory (§3.2, exhaustive):** `brothers` 467, `siblings` 13,
  `sisters` **8**, `twin brothers` 7, `twins` 3; every `parent_child` row carries
  the single label `father and son (AFL father–son rule selection)`.
- **"Brothers" is not `relationship = 'sibling'`.** 24 sibling rows are not
  brothers. The label-backed set (`brothers` + `twin brothers`) is **474**.
  `has_brother` is correct as written and must be **reused**, not re-derived.
  "Sisters" (8 rows) and "twins" (10 rows) are expressible but have no builder.
- **Witnesses:** siblings §3.3 (100 of 389 shown) — Ablett, Krakouer, Brayshaw,
  Cloke, Matera, Motlop; twin brothers Paul & Simon Atkins (relationship 146).
  Parent–child §3.4 (96, exhaustive) — Gary Ablett Sr → Jr, Brent Harvey →
  Cooper Harvey, David Cloke → Cameron / Jason / Travis.
- **Identical names inside one family (§3.5).** The largest family,
  `ablett-0004`, has **5 linked players but only 4 distinct display names** —
  ids 4700 and 4701 are both "Gary Ablett". A family answer must disambiguate by
  id, never by name. Next largest: `calverley-0156`, `hiskins-0415`,
  `pender-0682` at 4 members each. §3.5 is top-50 of 378 and ranks by **member
  count**, not by combined career games (see **M5**).
- **Fail-closed boundary (§3.6, 100 of 140 shown):** e.g. Robert Walls (11145) →
  David Walls (unlinked); Garry Fletcher → Simon Fletcher (both unlinked);
  Peter Morrison (unlinked) → Shane Morrison (11802). An unlinked side is a
  **name**, never a player identity, and must not be rendered as one.

#### 5.3.D Father–son selections

- **Coverage (§4.1, exhaustive):** 127 selections, draft years 1988–2025; 96
  both-linked, 28 child-unlinked, 4 father-unlinked. Status pairs:
  `unique/unique` 91, `unmatched/unique` 26, `unique/resolved` 4,
  `unique/unmatched` 3, `resolved/unique` 1, `unmatched/resolved` 1,
  `unmatched/unmatched` 1. **`resolved` occurs here** (unlike `coaches` and
  `after_siren_kicks`), so the trusted set for this family really is
  `IN ('unique','resolved')`.
- **By organization (§4.2, exhaustive):** 17 organizations — Collingwood 17
  (1988–2021), Geelong 14 (1995–2022), Carlton 13 (1988–2025),
  Footscray/Western Bulldogs 11 (1992–2025), Essendon 9, Melbourne 9, Richmond 8,
  … Fitzroy 1 (1993).
- **Geelong witness (§4.3, exhaustive, 14):** Gary Ablett Jr (1995, pick 40,
  father Gary Ablett Sr), Tom Hawkins (2006, pick 41, father Jack Hawkins),
  Matthew Scarlett (1997, pick 45) — plus three unmatched children (Simon
  Fletcher 1995, Adam Donohue 2007, Osca Riccardi 2022) as fail-closed witnesses.
- **Fully-linked witnesses (§4.4, exhaustive, 96):** Levi Ashcroft (2024, pick 5,
  Marcus Ashcroft), Cooper Harvey (2022, pick 56, Brent Harvey), **Alwyn Davey →
  Alwyn Davey** (2022, pick 45 — father and son share a display name, ids 535 and
  536).
- `selection_pick` is **NULL** on several 1988 rows (Heath Shephard, Michael
  James, Sean Bowden). FS5's exclusion is now supported by incompleteness as well
  as by unnaturalness.
- **The measured collapse — bears directly on F1 and D8.**
  `father_son_selections` (127 / 96 / 31) and
  `player_relationships WHERE relationship = 'parent_child'` (127 / 96 / 31) are
  **the same population** in this database, and every `parent_child` row carries
  the draft-rule label. Consequences: (a) the two "father-son" meanings currently
  coincide *extensionally*, so F1's father-son half is a **latent** divergence,
  not an active wrong answer; (b) **no witness exists** that distinguishes the
  two readings, so NL could not be validated either way; (c) the bare phrase must
  stay unrecognised until AFLDB-ISSUE-153 decides — exactly what D8 already says,
  now on measured grounds.
- **F1's family half is latent too.** `parent_child` rows have **no
  `family_key`**, and no cousin/in-law/spouse row exists at all, so
  `getFamilyRecords`' `family_key` grouping cannot presently return a
  non-sibling family. `/records/family` is correct **in fact** and wrong **by
  construction**.

#### 5.3.E First-kick goal — NOT MEASURABLE ON `afldb_test` (Finding F4)

All five §5 queries returned **zero rows**: `player_achievements WHERE
achievement_type = 'first_kick_goal'` is empty in `afldb_test`. The literal is
correct — production code uses the same one
(`src/db/queries/player-achievements.ts:22`, `src/db/queries/awards.ts:520`,
`src/db/queries/grid-solver.ts:994`) — so the query is right and the table is
empty. **Cause:** the family is loaded by
`npm run records:first-kick-goal -- --apply` from a **gitignored** hand-curated
extract, with identity assigned from the tracked manifest
`data/records/first-kick-goal-ids.csv` (`tools/records/import-first-kick-goal.ts`
header). A database rebuilt from tracked sources therefore has none. This is a
**test-fixture gap, not a product defect** — the public board is unaffected.

#### 5.3.F Cross-domain

- **§6.1 (exhaustive):** 41 player-linked coaches of the Richmond organization.
  **§6.2 (exhaustive):** 27 of them also played for Richmond. **§6.3
  (exhaustive):** exactly **one** father-son-selected player who became a coach —
  **Rhyce Shaw** (player 10974, 1999 Collingwood selection, coach 233, 29 coached
  games). X3 is a list, never a ranking.
- **The pack proves D9's point against itself:** §6.1 is titled "players who
  *later* coached Richmond" but its SQL contains **no temporal predicate** — it
  is the "also" reading under a "later" heading. That is precisely the failure
  mode the rendered wording must avoid.
- The pack measures **no playing-career seasons**, so "later" is neither
  confirmed nor refuted by it. The split stints in §5.3.A (Jack Titus 1937 &
  1965, Dick Harris 1944 & 1964) are consistent with coaching *during* a playing
  career but are not proof. Decline "later".

#### 5.3.G Measurement gaps — named so they are not mistaken for measured facts

| ID | Gap | Bears on |
|---|---|---|
| **M1** | Per-season coaching completeness was not measured; §0.2 gives only the 1902–2025 span. The "gaps before 1923, eleven 1940 records" line in §5.2 A remains **source-derived**. An `NL_COVERAGE` entry needs a per-season count first. | A8, coverage declines |
| **M2** | How many of the 368 player-linked coaches have zero playing games (§1.7 is top-50 by coached games). | A12, rendering |
| **M3** | Whether any of the 18 coach-only people coached a premiership. Would size D3's answer difference exactly; **the D3 recommendation does not depend on it**. | D3 |
| **M4** | `after_siren_kicks.shot_detail` was never queried. D5's exclusion of it rests on "no natural question", not on evidence. | D5, B11 |
| **M5** | Combined career games per family — the metric `/records/family` actually orders by — was not measured; §3.5 ranks by member count. | C1, D6, ISSUE-153 |
| **M6** | League-wide coaching threshold counts (§1.1–§1.3 are `LIMIT 25`). Club-scoped thresholds (§1.4/§7.2) **are** exhaustive; league-wide ones are witnesses only. | A5, A7, corpus |

---

## 6. Proposed semantic contract

### 6.1 Two new grains

**`coach_record`** — the person-grain that is not a player.

```
grain: 'coach_record'
coach?: NlCoachRef          // { id, slug|null, name } from `coaches`, NOT NlPlayerRef
scope.clubFor?              // organization; owned by the coach compiler
scope.seasonMin/Max?        // owned by the coach compiler
metric: 'games' | 'wins' | 'losses' | 'draws' | 'finals'
      | 'grand_finals' | 'premierships' | 'seasons' | 'win_pct' (D1)
agg: max | min | top_n | list | count
metricCondition?            // "more than 100 wins"
```

Compiler: a parameterised generalisation of `getClubCoachRecords` /
`getCoachRecordsByGames`. Payload: a new `coach_record` variant. Renderer: one
new table in `NlAnswerSection.tsx` that links to `/coaches/[slug]` and, only
when `player_id` is non-NULL, also to the player.

**`after_siren`** — the curated event grain.

```
grain: 'after_siren'
player?                     // "after-the-siren goals by Dusty"
scope.clubFor / clubAgainst // organization lineage
scope.seasonMin/Max, matchType (finals only, D4)
kickScored?: 'goal' | 'behind' | 'none'
kickEffect?: 'won' | 'drew' | 'none'
metric: 'attempts' | 'goals' | 'goals_to_win' | 'goals_to_draw' | null
agg: max | min | top_n | list | count | earliest | latest
```

Compiler: a parameterised generalisation of `getAfterSirenRecords`. Always
`premiership_season` + trusted link, unless a decision says otherwise.

### 6.2 One new grain, provisional

**`family`** — pending **D6**. If approved: `family_key`-grouped rows with
member lists, generalising `getFamilyRecords`, plus a relationship-typed player
list for C2–C4.

### 6.3 Reuse rather than duplicate

`coached_by`, `premiership_coach`, `after_siren_winner`, `father_son_selection`,
`father_son_father`, `has_brother`, `first_kick_goal_consecutive_min`,
`first_kick_goal_only_career_goal` — **eight existing builders to wire to
vocabulary, not reimplement.**

Genuinely new builders needed (small, mirroring existing shapes):
`coached_club(org)`, `father_son_selection_for_club(org)`,
`father_son_selection_between(from,to)`, and — if D6 lands —
`has_relative(relationship)`.

### 6.4 Ownership additions (the v33 rule)

Any new season/club-owning builder must be added to
`NL_CAREER_SEASON_OWNING_BUILDERS` / `NL_CAREER_CLUB_OWNING_BUILDERS`, and the
two new grains must own their own `clubFor`/`seasonMin`/`seasonMax` explicitly
in `validatePlan`. A field nothing owns must fail closed.

---

## 7. Decisions requiring operator approval

**OPERATOR DECISIONS RECORDED 2026-09-08 — this section is now closed except
where a row says otherwise.**

| Decision | Operator answer |
|---|---|
| D1, D2, D3, D4, D5, D7, D9 | **APPROVED** as recommended below. |
| D6, D8 | **DEFERRED** to AFLDB-ISSUE-153. |
| D10 | **PARTIALLY APPROVED** — see the ownership boundary in **§7.1**, which is binding. |
| D11 | **DB-BACKED VERIFICATION REQUIRED.** Parser/plan-only verification is **not** accepted for Phase E. The first-kick-goal family must be populated in `afldb_test` through the existing supported loader before Phase E is accepted. **That loader must NOT be run until the operator explicitly authorises it.** Phase E stays after Phase B and Phase C; the `afldb_test` population is an **operator gate**; the DB-backed testing contract is not weakened. |
| F1 | Remains **external-only** under AFLDB-ISSUE-153. ISSUE-152 repairs neither page. |

The recommendation column below is retained as the rationale of record. Where the
operator answer above differs from the recommendation (D10, D11), **the operator
answer governs**.

| ID | Status | Decision | Measured basis | Final recommendation |
|---|---|---|---|---|
| **D1** | **RESOLVED** | Rank coaches by win percentage, and at what minimum games? | §1.3 returns a populated 25-row board at 50+ games; the draw-weighted formula is confirmed arithmetically (George Angus 41 W / 2 D / 60 g → 70.00). No other qualifier was measured (**M6**). | **Yes.** `(W + D/2)/G × 100`, qualifier **50 games** as `/records/coaches` uses, **always stated in the interpretation** — at that qualifier the leader is Cliff Rankin (78.95%, 57 games), so an answer that omits the qualifier reads as wrong. An explicitly user-stated minimum is allowed as a `metricCondition` on games; never a different default silently. |
| **D2** | **RESOLVED** | "More than one club" — `organization_id` or raw `clubs.id`? | §1.6 measures the divergence: **Denis Pagan** and **Terry Wallace** each show **2 organizations / 3 club identities**. The readings really do differ. | **`organization_id`**, matching every other club-scoped NL semantic. Report the organization count, never the raw club count. |
| **D3** | **RESOLVED** | Is "coaches with premierships" a coach-grain question rather than the player-grain `premiership_coach`? | §1.8: 386 coaches, **368** player-linked, **18** coach-only — a player-grain builder is structurally blind to 4.7% of coaches. **M3** (whether any of the 18 won a premiership) is optional and does not change the shape. | **Coach grain** for "coaches with premierships"; keep `premiership_coach` for the player-grain reading ("premiership coaches" *as players*). Two different questions, two different grains, never silently substituted. |
| **D4** | **RESOLVED — strengthened** | May an after-siren question be scoped to finals/round? | §2.7: 8 finals events, all match-linked, across EF/QF/PF/SF. §2.6: five non-premiership rows carry premiership-looking labels, including **`round_raw = 'GF'`** (Kerry Good 1980, Escort Championships, no `match_id`). No VFL/AFL Grand Final after-siren event exists. | **Yes for finals, over `premiership_season = true` rows only**, with the non-premiership exclusion stated. Round-level scope: **decline**. "After the siren in a Grand Final" must return an honest empty result — never the 1980 Escort Championships row. |
| **D5** | **RESOLVED — refined** | Expose misses, `shot_detail` and the `siren` subtype? | §2.1: `kick_scored='none'` = 25 premiership events (18 loss, 6 draw, **1 win**); `behind` = 29. §7.4 gives a witness for all six present pairs. `siren` subtypes other than `final` have **1 event each**. `shot_detail` was never queried (**M4**). | **Misses yes**, but expose `kick_scored` explicitly as `goal` \| `behind` \| `none`: the bare word "missed" maps to `kick_scored <> 'goal'` (54 premiership events) with the reading stated, while "kicked a behind after the siren" binds `behind`. Because `kicker_result` is independent of `kick_effect`, "missed **and lost**" must be its own predicate. **`siren` subtype: no** (single witnesses). **`shot_detail`: no** (unchanged, and not evidence-dependent). |
| **D6** | **DEFERRED — AFLDB-ISSUE-153** | "Biggest football families" — all relationship types or siblings? | §3.1/§3.2: only `sibling` and `parent_child` exist, and `parent_child` rows have **no `family_key`**, so the unfiltered `family_key` grouping cannot presently return a non-sibling family. The defect is **latent**, not active. **M5**: combined career games unmeasured. | Unchanged: **ISSUE-152 does not settle it and ships no third reading; C1 waits.** The evidence lowers the urgency (no wrong page is being served today) without removing the ambiguity. |
| **D7** | **RESOLVED — decisively** | Which relationship enum members get NL wording? | §3.1/§7.5: `sibling` 498 and `parent_child` 127 are the **entire** table (625). `cousin`, `grandparent_grandchild`, `aunt_uncle_niece_nephew`, `spouse`, `in_law`, `other` have **zero rows**. §3.2: labels are `brothers` 467, `siblings` 13, `sisters` 8, `twin brothers` 7, `twins` 3. | **`sibling` and `parent_child` only** — the other six are an empty-set call, not a taste call, and must decline. "Brothers" stays **label-backed** (`brothers` + `twin brothers` = 474) via the existing `has_brother`, never `relationship = 'sibling'`, because 8 `sisters` and 16 unsexed rows exist. "Sisters"/"twins" are expressible but have no builder — **out of Phase D scope**, recorded as candidates. |
| **D8** | **DEFERRED — AFLDB-ISSUE-153** | "Father-son" means two different things in AFLDB's own UI. | §4.1 vs §3.1/§3.2: `father_son_selections` and `parent_child` are the **same 127 rows** with the same 96/31 link split, and every `parent_child` row carries the draft-rule label. The readings coincide extensionally, so **no witness can distinguish them**. | Unchanged, now on measured grounds: **the bare phrase stays unrecognised**; FS1–FS3 and FS6 wait. NL must not bind a phrase whose two readings the data cannot yet tell apart. |
| **D9** | **RESOLVED** | Cross-domain composition (X1–X3). | §6.1 (41) / §6.2 (27) / §6.3 (**1** — Rhyce Shaw). §6.1's own SQL has **no temporal predicate** despite its "later" title; no playing-career season is measured anywhere in the pack. | **Defer to Phase F**, "also" reading only, per-filter ownership enforced. **Decline "later"** — the ordering is not stored, and the pack demonstrates how easily the wrong label attaches to the right query. X3 is a list, never a ranking. |
| **D10** | **PARTIALLY APPROVED — §7.1 governs** | When an `after_siren_kicks` row has `premiership_season = true` but **no `match_id`**, may it appear in answers, and in `earliest`/`latest`? | §2.8 vs §2.6/§7.4: the most recent match-linked event is 2025-07-27 (Wanganeen-Milera); four 2026 events (Zurhaar, Moore ×2, Membrey) are player-linked and cited but match-unlinked, and four of §7.4's six subtype witnesses are among them. This instance may be an `afldb_test` artefact — its `matches` evidence stops in 2025 — but the compiler rule must be decided regardless. | **Admit them.** `season`, `round_raw`, `club_name_raw` and `opponent_name_raw` live on the event row, so the answer renders truthfully without a match. Require `match_id` **only** where the match supplies the semantics (finals/round scope — D4). Otherwise "the most recent goal after the siren" silently answers 2025 when 2026 events exist. |
| **D11** | **ANSWERED — (a) required, gated** | Phase E has **no first-kick-goal data in `afldb_test`** (Finding **F4**). Load it, or accept parser/plan-only verification? | §5.1–§5.5 all returned 0 rows; the family loads from a gitignored curated extract via `npm run records:first-kick-goal -- --apply`. | **Operator answer: option (a), and only (a).** Option (b) is refused — parser/plan-only verification is not acceptable for Phase E. The family must be populated in `afldb_test` through the existing supported loader before Phase E is accepted, the loader is **not** to be run until the operator explicitly authorises it, and Phase E remains sequenced after Phase B and Phase C. |

### 7.1 D10 — the after-siren match-link ownership boundary (binding)

Partially approved. A match-unlinked `after_siren_kicks` row **may** participate
in any semantics that are **fully answerable from `after_siren_kicks` itself**:

- `list`, `count`
- player totals
- club / opponent totals (`club_name_raw`, `opponent_name_raw`, folded via
  `organization_id` where a club id is present)
- `kick_scored` (`goal` / `behind` / `none`)
- `kick_effect` (`won` / `drew` / `none`)
- `kicker_result`
- `season`
- the `premiership_season` flag

**`match_id` must NOT be required merely because the event is a
premiership-season event.**

Two hard limits:

1. **Chronology.** A match-unlinked row must **not** determine "most recent" or
   "first" until the implementation proves a **deterministic total ordering
   independent of canonical `matches`**. `season` + `round_raw` is **not**
   automatically sufficient — `round_raw` is free text (§2.6 shows `'GF'`,
   `'round 1'`, `'round 3'` on non-premiership rows) and gives no within-season
   order. Until such an ordering is proven and documented, `earliest`/`latest`
   are **match-linked only**, and the answer must say so.
2. **Canonical match properties.** Any semantics that need the canonical match
   **must** require `match_id` and decline or exclude rows without it, as
   appropriate. At minimum: finals / `round_type` (D4), canonical match date,
   venue, canonical match identity (a `/matches/[id]` link).

Ownership statement: `after_siren_kicks` owns event identity, competition,
season, both raw club names, all four typed dimensions and the citation.
`matches` owns date, round type, finals status, venue and match identity. A
question whose answer needs a column from the second set is a match-linked
question; every other after-siren question is not. Phase C must encode this
split explicitly rather than gating on `premiership_season` alone.

---

## 8. Findings

**F1 — `/records/father-son` and `/records/family` do not read what their prose
says.** *(Public UI truthfulness. **OUT OF ISSUE-152 IMPLEMENTATION SCOPE** by
operator decision 2026-09-08; tracked separately as **AFLDB-ISSUE-153**. ISSUE-152
records it as an external dependency and repairs neither page.)*

- `/records/father-son` → `getFatherSonRecords` reads
  `player_relationships WHERE relationship = 'parent_child'`. It **never touches
  `father_son_selections`**. So AFLDB's public "father-son" board is a
  parent-child board, while the Grid Solver's "Father–son selection" builder is
  the actual AFL draft rule, over a different table. Two different meanings of
  the same phrase in one product.
- `/records/family` → `getFamilyRecords` groups **every** relationship type by
  `family_key` with **no `relationship` filter**, while the page prose states
  "Combined career VFL/AFL games by a linked family of **siblings**" and "A
  family is a set of players AFLDB has linked as **siblings**"
  (`src/app/records/family/page.tsx:15,99`). A family whose only link is a
  cousin or in-law row is counted and described as siblings.

Neither is an NL bug, and ISSUE-152 repairs neither page.

**Measured 2026-09-08 (§5.3.D) — F1 is LATENT, not active.** Both halves are
structural defects that this data does not currently express:

- `father_son_selections` (127 / 96 linked / 31 not) and
  `player_relationships WHERE relationship = 'parent_child'` (127 / 96 / 31) are
  **the same population**, and every `parent_child` row carries the label
  `father and son (AFL father–son rule selection)`. The two "father-son"
  meanings coincide extensionally today, so `/records/father-son` is not
  currently serving a wrong set — but nothing enforces that, and **no witness
  exists that could distinguish the readings**, which is exactly why D8 stays
  deferred.
- `player_relationships` holds **only** `sibling` (498) and `parent_child` (127)
  rows — zero cousin, in-law, spouse, grandparent, aunt/uncle or other — and
  `parent_child` rows carry **no `family_key`**. Since `getFamilyRecords` groups
  by `family_key`, it cannot presently return a non-sibling family.
  `/records/family` is therefore correct **in fact** and wrong **by
  construction**.

This *lowers the urgency* of AFLDB-ISSUE-153 (no wrong page is being served
today) without changing its scope or removing the ambiguity. It does not change
any ISSUE-152 decision.

**Operator decision (2026-09-08) — F1 is an external dependency, not a blocker:**

- F1 is tracked as **AFLDB-ISSUE-153**, not fixed here.
- F1 **does not block Phase B (coaching), Phase C (after-the-siren) or Phase E
  (first-kick-goal closure).** None of those three touches
  `player_relationships`, `father_son_selections`, `/records/family` or
  `/records/father-son`, so all three proceed on their own evidence.
- Only NL wording **whose meaning depends on F1** is deferred: the family and
  father-son subfamilies whose answer changes according to how ISSUE-153 settles
  the page semantics — **C1**, **FS1**, **FS2**, **FS3**, **FS6**, and decisions
  **D6** and **D8**. These wait for ISSUE-153 semantics.
- Subfamilies in the same families that do **not** depend on F1 — **C2**
  (`has_brother`, label-backed), **C3**/**C4** (typed `parent_child` /
  per-player, stated in relationship-type terms), **FS4** (`father_son_father`)
  — are unaffected by ISSUE-153 and may proceed, provided their rendered wording
  names the relationship type explicitly rather than the contested word
  "father-son".

**F2 — the NL coaching decline states something untrue.** §3.5. The reason
string asserts AFLDB has no coaching data at all; migration 087 and five public
surfaces contradict it. Fixed in Phase B by deleting the rule as coaching
support lands — not before, and never by softening the wording while still
declining.

**F3 — six implemented, tested grid builders are unreachable from NL.** §3.3.
Not a defect; a wiring gap, and the reason Phases B–D are cheaper than they look.

**F4 — `afldb_test` has no first-kick-goal data.** §5.3.E. All five §5 queries
returned zero rows: `player_achievements WHERE achievement_type =
'first_kick_goal'` is empty in the integration database. The achievement-type
literal matches production code, so the query is right and the table is empty.
The family is loaded by `npm run records:first-kick-goal -- --apply` from a
**gitignored** hand-curated extract, with durable ids assigned from the tracked
manifest `data/records/first-kick-goal-ids.csv`, so a rebuild from tracked
sources produces none.

**This is a test-fixture gap, not a product defect** — `/records/first-kick-goal`
and the E1–E5 NL support are unaffected on DEV and production. Its consequence is
narrow and specific: **Phase E has no DB-backed witnesses**, and the E1–E5
"SUPPORTED" claims cannot be proven against `afldb_test` as it stands. Decision
**D11** records the operator's two options. Not a blocker for Phase B or C, which
touch neither table.

---

## 9. Recommended implementation order

Phase A (this document) is complete pending operator answers to §7.

| Phase | Content | Gate |
|---|---|---|
| **B — Coaching** | `coach_record` grain + `NlCoachRef` + coach resolver; remove the false decline (F2); wire `coached_by`. Highest value: five public surfaces, a false decline, and the SQL already written. | red parser/plan tests → `validatePlan` ownership tests → DB-backed comparison against hand-written SQL → rendered cases |
| **C — After-the-siren** | `after_siren` grain, four dimensions kept distinct. Self-contained, one table, no identity seam. | same |
| **D — Family / father–son** | **Blocked on AFLDB-ISSUE-153** for the F1-dependent subfamilies (C1, FS1–FS3, FS6, decisions D6/D8). C2/C3/C4/FS4 do not depend on F1 and may proceed. | same |
| **E — First-kick-goal closure** | E6–E8 only; three wordings over existing builders. **Sequenced after B and C — it is NOT folded into either** (operator, 2026-09-08). **Blocked by an operator gate:** `afldb_test` has no first-kick-goal rows (**F4**), and D11 requires the family to be loaded there through the existing supported loader before Phase E is accepted. The loader must not be run without explicit operator authorisation. | **same, DB-backed comparison mandatory** — parser/plan-only verification is not accepted |
| **F — Cross-domain** | Only after B–D are green, only the "also" reading, only with per-filter ownership. | plus explicit ownership tests |
| **G — Corpus + DEV acceptance** | New ISSUE-152 corpus; rendered DEV acceptance. | 1,435 + 60 unchanged and still green |

Reordering note: **E before D** is defensible and cheaper — but note E is now the
phase with the weakest verification story (**F4**/**D11**), while **B**'s and
**C**'s witnesses are fully measured. **B first** is not negotiable — it is the
only phase fixing an active untruth, and after the evidence run it is also the
best-evidenced: §1.4/§7.2 give exhaustive club-scoped threshold counts, §1.5 a
single-row season witness, §1.8 the exact identity seam.

Each phase increments `PARSER_VERSION` **once** (34 → 35 → 36 …), documents the
bump in the `plan.ts` history comment, and ships red-before-green semantic tests.

## 10. Estimated corpus growth

Additive; the existing 1,435 and 60 are untouched.

| Phase | Realistic | Decline / control |
|---|---|---|
| B coaching | 90–120 | 20–25 |
| C after-siren | 60–80 | 15–20 |
| D family + father-son | 50–70 | 20–25 |
| E first-kick closure | 15–20 | 5 |
| F cross-domain | 10–15 | 10 |
| **Total** | **~225–305** | **~70–85** |

Decline/control cases must include: coverage refusals (pre-1902 and 2026
coaching, §0.2), the coach-only identity boundary (18 people, §1.8),
unlinked-side refusals (§3.6, §4.3), "goal after the siren" vs "to win",
"father-son" ambiguity (D8), and "later coached" (D9). The evidence adds four
more that must be present: **"after the siren in a Grand Final"** (zero VFL/AFL
witnesses; the only `GF` row is non-premiership — §2.7/§2.6), **a NAB Cup /
JLT / Escort row presented as a home-and-away round** (§2.6), **an after-siren
superlative that must render a tie** (max is 2, two-way — §7.3/§2.4), and
**"sisters"/"cousins"** (8 rows with no builder; zero rows respectively —
§3.1/§3.2).

## 11. Families recommended for exclusion

- **E9** — `no_further_career_kicks`, `kickless_matches_before_first_kick`.
- **FS5** — father-son `selection_pick` / `rule` detail.
- **B11 partial** — `shot_detail`, `siren` subtype (misses themselves stay).
- **C6 partial** — `spouse`, `in_law`, `other` relationships.
- **F "later"** — temporal ordering between playing and coaching careers is not
  stored and must not be implied.

No whole family is recommended for exclusion.

---

## 12. Stage-0 completion

- Requested scope addressed; **stopped at the Stage-0 stop condition.**
- No parser, plan, compiler, corpus, UI, schema, test or `CHANGELOG` change.
- `PARSER_VERSION` unchanged at **34**.
- **First gate — CLEARED 2026-09-08.** The evidence pack was executed against
  `afldb_test`, read-only, `ROLLBACK` reached, no errors, production untouched
  (§2.2). Its measured results are in **§5.3**. Every threshold in this document
  is now either **measured and cited**, or explicitly listed as a measurement gap
  (**M1–M6**). **No threshold is asserted without a citation.**
- **Second gate — CLOSED 2026-09-08.** Operator answers recorded in §7:
  **D1, D2, D3, D4, D5, D7, D9 approved**; **D10 partially approved** under the
  binding ownership boundary in **§7.1**; **D11 answered — DB-backed
  verification required, `afldb_test` population is an operator gate, the loader
  is not to be run without explicit authorisation**; **D6** and **D8** remain
  deferred to **AFLDB-ISSUE-153** and are not a precondition for Phases B, C
  or E; **F1** stays external-only under **AFLDB-ISSUE-153**.
- **Third gate — OPEN.** Operator approval of the **Phase B implementation
  plan (§13)**. No implementation has begun.
- **Phase B (coaching) is unblocked by evidence** and remains first: it carries
  the only active untruth (**F2**) and now has exhaustive club-scoped witnesses.
- **Operator decisions recorded 2026-09-08:** Stage 0 approved for persistence;
  Finding **F1** is out of ISSUE-152 implementation scope and is tracked as
  **AFLDB-ISSUE-153**; ISSUE-152 records F1 as an external dependency, repairs
  neither page, and defers only the family/father-son wording whose meaning
  depends on it. §5.3.D shows F1 is currently **latent** — that lowers its
  urgency but changes neither its scope nor any ISSUE-152 decision.
- **Not done, deliberately:** no implementation, no `PARSER_VERSION` bump, no
  corpus or test change, and no state-changing command against any database
  (**D11(a)** is now required but is the operator's to run, not executed here).

---

## 13. Phase B — coaching implementation plan (PLAN ONLY, NOT IMPLEMENTED)

Prepared 2026-09-08 after the operator decisions in §7. **Nothing in this section
has been built.** No source, test, corpus or `CHANGELOG` file has been touched.
Approval of this section is the third gate (§12).

Phase B implements coverage-matrix rows **A1–A12** and removes Finding **F2**.
It touches no `player_relationships`, `father_son_selections` or
`player_achievements` code, so it is independent of AFLDB-ISSUE-153 (F1) and of
the D11 `afldb_test` gate.

### 13.1 Exact typed plan / grain changes

All in `src/search/nl/plan.ts` unless stated.

1. **`NlGrain` += `'coach_record'`** (`plan.ts:316`). It is the ninth grain and
   the **first person-grain that is not a player** (§3.1).
2. **New ref type**, beside `NlPlayerRef` (`plan.ts:379`):

   ```ts
   /** A `coaches` row. Deliberately NOT an NlPlayerRef: 18 of 386 coaches have no player row at all (§1.8). */
   export type NlCoachRef = {
     id: number;            // coaches.id
     slug: string;          // coachSlug(display_name) -- derived, `coaches` stores no slug
     name: string;          // coaches.display_name
     playerId: number | null;   // non-null only for a 'unique' link (coaches_link_ck, migration 087)
     playerSlug: string | null;
   };
   ```

   `validateRef(raw.coach, 'id', 'Coach')` validates it unchanged — the existing
   helper (`plan.ts:959`) already requires a positive integer id plus string
   `slug`/`name`.
3. **`NlQueryPlan.coach?: NlCoachRef`** (`plan.ts:817` block), documented as
   `coach_record` only and **mutually exclusive with `player`**.
4. **`NL_METRICS.coach_record`** (`plan.ts:567`), nine `columnMetric` entries:

   | key | label | note |
   |---|---|---|
   | `games` | Games coached | |
   | `wins` | Wins | |
   | `draws` | Draws | |
   | `losses` | Losses | |
   | `finals` | Finals coached | `matches.is_finals_series` |
   | `grand_finals` | Grand Finals coached | `round_type = 'grand_final'` |
   | `premierships` | Premierships | GF **won** |
   | `seasons` | Seasons in charge | `count(DISTINCT m.season)` — **not** a tenure length |
   | `win_pct` | Win percentage | D1; qualifier-gated, see §13.9 |

   Their `column` values are **markers for the coach compiler**, not literal
   SQL — the same convention the 13 `live_only` career stats already use
   (`plan.ts:613-619`). No new `NlMetricDef` kind is needed.
5. **`metricCondition` extended to `coach_record`** (`plan.ts:1066`). The gate
   becomes `player_game | player_season | coach_record`. The complementary
   "a list needs a threshold" rule (`plan.ts:1082`) is **not** extended: a
   coach-record `list` is a legitimate unthresholded answer ("who has coached
   Richmond" → 42 rows), which is why the two rules must be edited separately.
   The `agg.kind !== 'list'` restriction (`plan.ts:1074`) **does** apply to
   `coach_record` — a threshold lists qualifiers, it never ranks one.
6. **`validatePlan` `coach_record` gate** (`plan.ts:996`), added to the `grains`
   array (`plan.ts:999`) and given its own exhaustive block, in the shape of the
   existing `head_to_head` / `achievement_summary` blocks:
   - **owns** `coach`, `scope.clubFor`, `scope.seasonMin`, `scope.seasonMax`,
     `metric`, `agg`, `metricCondition`, `tiePolicy`, `limit`;
   - **refuses** `player`, `scope.playerIdIn`, `scope.clubAgainst`,
     `scope.matchup`, `scope.venue`, `scope.matchType`, `scope.roundNumber`,
     `careerConditions`, `careerPredicates`, `clubSeasonConditions`,
     `achievementSummary`, `headToHead`, `streakDefinition`, `periodSplit`,
     `scoreCheckpoint`, `resultFilter`, `debutGame`, `havingClause`,
     `matchFilter`, `boundary`, `mode`;
   - requires `metric === null || metric ∈ NL_METRICS.coach_record`;
   - requires `agg.kind ∈ {max, min, top_n, list, count}`;
   - `metric === null` is legal **only** for `agg.kind ∈ {list, count}`
     ("who coached Richmond", "how many coaches has Richmond had").
   - A `coach` and a `clubFor` together are legal (A3, "Hardwick's record at
     Richmond"); a `coach` with `agg.kind ∈ {max, min, top_n}` and no metric is
     not.
7. **Label maps** (`plan.ts:1408`, `:1420`, `:1431`): `GRAIN_LABEL.coach_record =
   'coaching'`, `GRAIN_SUBJECT.coach_record = 'coach'`,
   `TIE_ENTITY.coach_record = 'coach'`.
8. **`describePlan`** (`plan.ts:1463`): one new line, `Coach: <name>.`, emitted
   beside the existing `Player:` line, plus the club/season lines it already
   emits. The win-percentage qualifier line is added here too (§13.9).
9. **`NL_COVERAGE` floor** (`plan.ts:685`): one entry keyed `games` with
   `grains: ['coach_record']` and `firstSeason: 1902` (measured, §0.2). The
   `grains` filter is what keeps it away from every other grain's `games`
   metric. **No pre-1923 gap and no per-season completeness claim is encoded** —
   that is measurement gap **M1** and is not yet evidence.
10. **`src/search/nl/answer-types.ts`**: `NlCoachRecordRow` and a
    `{ kind: 'coach_record'; lead; rows; total }` payload variant
    (`answer-types.ts:101`). Row shape mirrors `ClubCoachRecordRow`
    (`coaches.ts:256`) plus `coachOnly`, and keeps `winPct` **as a string**
    (`round(...)::numeric` comes back from postgres.js as text —
    `coaches.ts:166` says so explicitly).
11. **`src/db/queries/nl/coach-record.ts`** — new compiler, `answerCoachRecord`;
    registered in `src/db/queries/nl/execute.ts:25` switch. `payloadTotal`
    (`answer.ts:189`) gains the `coach_record` case.
12. **`src/search/nl/describe.ts`**: `describeCoachRecordAnswer`, dispatched
    from `describeAnswer` (`describe.ts:67`), reusing `tiedSubject` /
    `dedupeByIdentity` unchanged (identity = `coachId`).
13. **`src/components/NlAnswerSection.tsx`**: `CoachRecordTable`, in the shape
    of the existing `PlayerCareerTable` (`:247`).
14. **`PARSER_VERSION` 34 → 35** (`plan.ts:312`) with a history entry — see
    §13.14.

### 13.2 Coach identity, kept distinct from player identity

- The plan carries `coach`, never `player`, for a coaching question. The two
  fields are mutually exclusive and `validatePlan` refuses a `coach_record`
  plan that carries `player`.
- **Why it cannot be folded into `NlPlayerRef`:** §1.8 (exhaustive) —
  **368** coaches are `unique` and player-linked, **18** are `unmatched` with
  no player row at all. No `resolved` status exists for coaches. A player-grain
  representation is structurally blind to 4.7% of coaches (this is D3).
- The 368 linked coaches are the **same human** as their player row (Ron
  Barassi, Damien Hardwick, Mark Williams), not a name collision — but "games"
  is a different number for the same person: Mick Malthouse **174 playing
  games / 718 coached** (§1.7), Leigh Matthews **332 / 461**. The grain, not the
  name, decides which number is meant.
- **Rendering rule** (`CoachRecordTable`): link `playerPath(playerSlug,
  playerId)` when `playerId !== null`, otherwise `coachPath(slug, id)`. This is
  not cosmetic — `/coaches/[slug]-id` **permanently redirects** a linked coach
  to their player page (`src/app/coaches/[slug]/page.tsx:88-91`), so linking a
  linked coach to the coach route would ship a guaranteed redirect. A coach-only
  person must **never** be given a `/players` href.
- **Coach directory**, new `buildCoachDirectory()` in
  `src/db/queries/nl/resolve.ts` beside `buildClubDirectory` (`resolve.ts:55`):
  386 rows, `coaches` LEFT JOIN `players`, returning
  `NlCoachDirectoryEntry = NlCoachRef & { names: string[] }`. Cheap and
  deterministic, exactly like the club/venue directories; **no fuzzy search**
  and no reuse of `searchPlayers`.
  - `names` = `lower(display_name)`, **plus** `lower(surname)` only when that
    surname belongs to **exactly one** coach in the table and does not appear in
    the club or venue directory. Measured reason: **Albert Pannam (160) and
    Charlie Pannam (266) both coached Richmond** (§1.4), and Len Smith (88) /
    Norm Smith (10) both coached. A bare "Pannam" or "Smith" therefore resolves
    to nothing, is left in the text as a leftover token, and declines — the
    fail-closed outcome, not a coin flip.
  - `NlParseContext` (`parser.ts:80`) gains **`coaches?: NlCoachDirectoryEntry[]`**
    — **optional, defaulting to `[]`**. Every existing test constructs the
    context as an object literal (`tests/nl-audit-acceptance.test.ts:33` and
    others); an optional field means none of them changes, and an absent
    directory declines coaching questions rather than answering them wrongly.
  - `findCoach` exported from `src/search/nl/entities.ts` beside `findClub` /
    `findVenue` (`entities.ts:48-54`), delegating to the existing
    `findLongestMatch`.

### 13.3 Parser vocabulary and collision handling

New vocabulary in `src/search/nl/vocab.ts`:

```ts
/** Any coaching cue. Also the gate for COACH_METRIC_WORDS below. */
export const COACH_CUE_RE = /\bcoach(?:es|ed|ing)?\b|\bcoaching record\b|\bin charge of\b|\bat the helm\b/;

/** "players coached by X", "who did X coach", "under X" -- the PLAYER-grain reading. */
export const COACHED_BY_RE = /\b(?:players?|who)\b[^.?]*\bcoached by\b|\bcoached by\b|\bplayed under\b|\bunder coach\b/;

/** "premiership coach(es)" as a PLAYER-grain predicate (A12), distinct from the coach-grain premierships metric (A10/D3). */
export const PREMIERSHIP_COACH_RE = /\bpremiership[- ]winning coach(?:es)?\b|\bpremiership coach(?:es)?\b/;

/** coach_record ranking words. Tried ONLY once a coach cue is present. */
export const COACH_METRIC_WORDS: [RegExp, string][] = [
  [/\bwin (?:percentage|pct|rate)\b|\bwinning percentage\b/, 'win_pct'],
  [/\bpremierships?\b|\bflags?\b/, 'premierships'],
  [/\bgrand finals?\b/, 'grand_finals'],
  [/\bfinals?\b/, 'finals'],
  [/\bwins?\b|\bvictories\b/, 'wins'],
  [/\blosses\b|\bdefeats\b/, 'losses'],
  [/\bdraws?\b/, 'draws'],
  [/\bseasons?\b|\byears in charge\b/, 'seasons'],
  [/\bgames?\b|\bmatches\b/, 'games'],
];
```

**Ordering inside `parseNlQuestion` (`parser.ts:1211`).** One new step **5c**,
after venue (step 2), `by a <club> player` (step 3), club (step 4), season /
match type / round / award (step 5) and first-kick-goal (step 5a) extraction,
and **before** the player-name candidate scan:

1. probe `COACH_CUE_RE` on the current text → `coachCuePresent`;
2. if present, run `findCoach` over `ctx.coaches ?? []`, strip the match, record
   it in `report.entityResolution`;
3. classify the reading: `COACHED_BY_RE` or `PREMIERSHIP_COACH_RE` →
   **player-grain**; otherwise → **coach-grain**.

**Why before the player scan:** with 368 coaches sharing a player name, leaving
"damien hardwick" in the text would send it to `resolvePlayer` and produce an
`NlPlayerRef` for a coaching question. The coach cue is what decides which
identity space the name is resolved in.

**Metric collision, handled exactly as `club_season` already is.**
`CLUB_SEASON_METRIC_WORDS` (`vocab.ts:276`) is only tried once
`clubSeasonCuePresent` is true (`parser.ts:1517-1526`), precisely because
"wins"/"losses"/"draws" also name player career columns. Phase B mirrors that
one code path:

- `COACH_METRIC_WORDS` is extracted **only** when `coachCuePresent`;
- when it fires, the club-season and player-stat metric passes are skipped for
  that word, so "games" cannot double-read;
- with no coach cue, **nothing changes** — "most wins" keeps its existing
  `player_career` / `club_season` behaviour and every existing corpus row keeps
  its result.

**Grain election** (`parser.ts:1745` ladder). One new branch, inserted after
`achievement_summary` / `head_to_head` and **before** `team_streak`:

```
} else if (coachCuePresent && !coachedByReading) {
  grain = 'coach_record';
  metric = coachMetricResult.metric ?? null;
}
```

`coachedByReading` routes to `player_career` with a `coached_by` /
`premiership_coach` career predicate instead. `structuralOk` (`parser.ts:2234`)
gains `: grain === 'coach_record' ? (metric !== null || !!coach || !!clubFor)` —
a bare "coaching" with no coach, no club and no metric has no structure and must
decline.

**The four collisions named in §5.2 A, and their resolutions:**

| Collision | Resolution |
|---|---|
| "games" — played vs coached | The coach cue elects the grain; without it the word keeps its player meaning. |
| "club" — played for vs coached | At `coach_record` grain `clubFor` means *coached*; at `player_career` grain it keeps its existing meaning. Never both in one plan. |
| "wins" — player career wins vs coaching wins | Same gate as "games". |
| coach/player name | Coach directory resolution happens only under a coach cue; otherwise the name goes to `resolvePlayer` as today. |

### 13.4 Removing the false decline (Finding F2)

`vocab.ts:881-885` — the entire `UNANSWERABLE_TOPICS` entry:

```ts
{ re: /\bcoach(?:es|ed|ing)?\b/, topic: 'coaching',
  reason: 'AFLDB has no coaching data at all -- no coach, no coach-per-club-season, nothing.' },
```

is **deleted**, in the **same commit** as the coaching support lands — not
before, and never softened while still declining. The rule is consulted at
`parser.ts:1229`, ahead of all entity extraction, so while it exists no coaching
wiring downstream can ever be reached.

Consequence to state plainly: after deletion, a coaching question Phase B does
**not** support no longer declines with a *reason*; it declines through the
ordinary leftover-token / `low_confidence` / `ambiguous` path (`parser.ts:2295-2323`),
which is honest ("could not understand") rather than false ("no data exists").
§13.15 lists the forms that must land there, and the decline corpus asserts it.

Nothing else in `UNANSWERABLE_TOPICS` is touched.

### 13.5 Existing coaching query functions reused

`src/db/queries/coaches.ts` is the source of truth; the NL compiler is a
**parameterised generalisation of it**, and re-derives none of its arithmetic.

| Existing function | Phase B use |
|---|---|
| `getClubCoachRecords(clubId)` (`coaches.ts:303`) | The exact SQL shape for a **club-scoped** coach answer (A1, A3, A4, A7, A8), including the `organization_id` subquery and the `seasons` count. |
| `getCoachRecordsByGames(limit)` (`coaches.ts:177`) | The exact SQL shape for a **league-wide** ranking (A5, A10), including the `count(mc.match_id)` / `m.id IS NOT NULL` draw guard its header comment explains. |
| `getCoachRecordsByWinPct(minGames, limit)` (`coaches.ts:219`) | The win-percentage board and the 50-game qualifier (A6 / D1). |
| `getCoachCareer(coachId)` (`coaches.ts:64`) | The single-coach whole-career answer (A2) and the per-club stint breakdown. |
| `getCoach(id)` (`coaches.ts:139`) | Identity + player link for the ref. |
| `listCoaches()` (`coaches.ts:352`) | The directory query's model (386 rows, LEFT JOINs). |
| `winPct(w, d, g)` (`coaches.ts:47`) | The one draw-weighted formula. Never re-typed. |

`coaches.source_games_coached` is **evidence only** (migration 087) and is read
by none of the above and by nothing in Phase B.

**Reuse boundary.** These functions take fixed arguments and no season range, so
Phase B does **not** call them from the NL compiler; it adds
`src/db/queries/nl/coach-record.ts` whose SQL is the same shape with bound
parameters for club organization, season range, metric ordering, threshold and
limit. §13.11 is the test that proves the generalisation returns what the
originals return.

### 13.6 `organization_id` lineage rules

- Club scope compiles to exactly the `getClubCoachRecords` predicate
  (`coaches.ts:326-329`):
  `mc.club_id IN (SELECT id FROM clubs WHERE organization_id = $1)`, with
  `$1 = plan.scope.clubFor.organizationId` — `NlClubRef.organizationId` is
  already the lineage-level id (`plan.ts:381`), so no lookup is added.
- `match_coaches.club_id` is the **raw historical identity** (§4.1); folding is
  the compiler's job and must never be assumed by the caller.
- A rename folds (Footscray coaching counts on Western Bulldogs); **a merger
  never folds** (nothing of Fitzroy's reaches Brisbane Lions), which follows
  automatically from `organization_id` and needs no special case.
- D2 (approved): "coached more than one club" counts **organizations**, not raw
  club identities. Measured divergence: Denis Pagan and Terry Wallace each show
  **2 organizations / 3 club identities** (§1.6, §5.3.A). A9 renders the
  organization count; the raw club count is never reported.
- A9 is implemented as a `metricCondition` on a `clubs_coached` **derived
  count**, and it is the one A-row that needs a tenth metric key
  (`organizations`), added only if A9 ships in Phase B; if it does not, A9 moves
  to Phase F and the metric is not added.

### 13.7 Whole-career vs one-organization semantics

Two different questions, two different numbers, never silently substituted:

| Plan | Meaning | Witness |
|---|---|---|
| `coach` set, **no** `clubFor` | Whole coaching career, all clubs | Hardwick's career total (all clubs), not 307 |
| `coach` set, `clubFor` set | That organization only | Hardwick **at Richmond**: 307 g, 170 W, 6 D, 131 L, 56.35% (§1.4, exhaustive) |
| no `coach`, `clubFor` set | Every coach of that organization | Richmond: **42** coaches, 1908–2025 (§1.4, exhaustive) |
| no `coach`, no `clubFor` | League-wide leaderboard | Malthouse 718 games; McHale 466 wins (§1.1/§1.2, top-25 witnesses) |

- The rendered interpretation must **always** name which of the four it
  answered. "Damien Hardwick's coaching record" and "Damien Hardwick's record at
  Richmond" must not produce the same sentence.
- **Split stints are real and must never render as a continuous tenure.** Jack
  Titus coached Richmond in **1937 and 1965** — `first_season 1937,
  last_season 1965, seasons 3, games 17`; Dick Harris **1944 and 1964** —
  `seasons 2, games 10` (§1.4, exhaustive). The row therefore renders
  `first_season`–`last_season` **with the `seasons` count beside it**, and the
  interpretation says "seasons in charge", never "coached from 1937 to 1965".
  `getClubCoachRecords`' own header comment (`coaches.ts:288-292`) already makes
  this point for Tony Jewell.

### 13.8 Ranking, list, threshold semantics

| `agg` | Meaning at `coach_record` | Notes |
|---|---|---|
| `max` / `min` | Rank-one leader with **all ties**, `tiePolicy: 'all'` | Same `rank()`-with-ties SQL every grain uses; `dedupeByIdentity` on `coachId`. |
| `top_n` | Top N by metric, ties at the boundary included | `NL_LIMITS.maxTopN` unchanged. |
| `list` | The qualifying set, unranked | Club-scoped default order = `getClubCoachRecords`' own: `max(m.season) DESC, min(m.season) DESC, display_name`. Legal with `metric === null`. |
| `count` | How many coaches match | `{ kind: 'count'; value }` payload, already exists (`answer-types.ts:110`). |
| `metricCondition` | Threshold on the selected metric, `agg` forced to `list` | "Richmond coaches with 100+ wins" → 3 rows (§7.2, exhaustive). |

- Ranking is over **derived** aggregates (`match_coaches ⋈ matches`), never over
  `coaches.source_games_coached`.
- `min` over a coaching metric is admitted but is nearly always a tie at 1 game
  / 0 wins (§7.2: Max Hislop and Verdun Howell both 1 game, 0 wins at Richmond),
  so the tie renderer, not a special case, carries it.
- Threshold values are bound parameters; the metric is looked up in
  `NL_METRICS.coach_record` and never spliced.

### 13.9 The 50-game win-percentage qualifier (D1, approved)

- Formula: **`(W + D/2) / G × 100`**, the site convention, reused from
  `winPct` (`coaches.ts:47`) / `getCoachRecordsByWinPct`
  (`coaches.ts:244-248`). Never `W/G`. `/venues` uses `wins/games` for a
  **venue** record — a different board, not to be cross-contaminated.
- Default qualifier: **50 games coached**, as `/records/coaches` uses
  (`getCoachRecordsByWinPct`'s `minGames = 50` and its header comment).
- **The qualifier is always stated**, in both the interpretation and the
  `describePlan` explain lines. Required wording:

  > Best coaching win percentage, minimum 50 games coached. Win percentage
  > counts a draw as half a win — (wins + draws ÷ 2) ÷ games.

  Measured reason this is not optional: at 50+ games the leader is **Cliff
  Rankin, 78.95% from 57 games** (§1.3) — an answer that omits the qualifier
  reads as wrong to anyone who expects Jock McHale. The draw weighting is
  likewise visible in the data: **George Angus 41 W / 2 D / 60 g → 70.00**,
  where `W/G` would print 68.33 (§1.3).
- A **user-stated** minimum ("coaches with at least 100 games, best win
  percentage") is honoured as a `games` `metricCondition` and the stated number
  is echoed. A **different silent default is never used**: absent a user
  minimum, it is 50 and it is said out loud.
- `win_pct` with **no** qualifier and `agg ∈ {max, top_n}` must not be
  answerable at all — `validatePlan` injects the 50-game floor (parser-set) and
  refuses a `win_pct` ranking plan that carries neither.

### 13.10 Red-before-green tests

Every test below is written and **observed failing** before the corresponding
implementation lands. Existing suites are extended, never replaced; no existing
expectation changes.

| File | Cases (red first) |
|---|---|
| `tests/nl-parser.test.ts` | coach cue elects `coach_record`; coach name resolves from the injected directory, not `resolvePlayer`; "players coached by Damien Hardwick" elects `player_career` + `coached_by`; "premiership coaches" elects `player_career` + `premiership_coach`; "coaches with the most premierships" elects `coach_record` metric `premierships` (D3 — the two must not collapse); bare "Pannam"/"Smith" declines; **no-coach-cue regression battery**: "most wins", "most games", "Richmond most wins in a season" keep their pre-Phase-B grains and metrics. |
| `tests/nl-plan.test.ts` | `validatePlan` accepts the five legal `coach_record` shapes (§13.7) and **refuses** each field in the §13.1(6) refusal list, one assertion per field; `metric === null` legal only for `list`/`count`; `metricCondition` forces `agg: 'list'`; `win_pct` ranking without a qualifier refuses; `coach` + `player` together refuses; season floor 1902 refuses 1901. |
| `tests/nl-describe.test.ts` | whole-career vs at-a-club interpretations differ; the 50-game qualifier sentence appears verbatim for every `win_pct` answer; a split-stint row renders "3 seasons in charge, 1937–1965" and **never** "coached from 1937 to 1965"; a two-way tie renders both names via `tiedSubject`. |
| `tests/nl-audit-acceptance.test.ts` | the Phase B question set parses to the intended plans end to end (parse → `validatePlan`), including the decline set of §13.15. |
| `tests/integration/nl-answers-coaching.test.ts` **(new file)** | §13.11. A new file is the consistent home: the integration suites are already split by grain — `nl-answers.test.ts` is player_career only (its own header says so), `-game-season`, `-team-club`. It imports `./guard` like its siblings. |
| `tests/nl-ui/nl-stress.spec.ts` | rendered coaching answers, incl. one coach-only person (no `/players` href) and one linked coach (no `/coaches` href). |

### 13.11 DB-backed hand-written-SQL comparisons

`tests/integration/nl-answers-coaching.test.ts`, against `AFLDB_TEST_DATABASE_URL`
(a `_test` database, read-only queries), following `nl-answers.test.ts`'s rule
that every answer is checked against an **independently hand-written** query
rather than "returns rows":

1. **Club-scoped list** — `answerCoachRecord` with `clubFor = Richmond` vs a
   hand-written `getClubCoachRecords`-shaped query. Assert row count **42**,
   identical `(coachId, games, wins, draws, losses, seasons)` tuples, identical
   order.
2. **Club-scoped thresholds** — ≥200 games → **3**; ≥100 games → **8**;
   ≥50 games → **14**; ≥100 wins → **3**; ≥50 wins → **7**; ≥25 wins → **14**
   (§7.2, exhaustive), each also compared to a hand-written `HAVING`.
3. **Season witness** — Richmond 2017 → exactly one row, Damien Hardwick,
   25/18/0/7 (§1.5, exhaustive).
4. **Win percentage** — the 50+ games board's leader is Cliff Rankin at 78.95;
   George Angus computes 70.00, proving the draw weighting against a
   hand-written `W/G` control that must **not** match (§1.3).
5. **Lineage** — a Western Bulldogs query returns Footscray-era coaching rows;
   a Brisbane Lions query returns **no** Fitzroy coaching rows.
6. **Identity seam** — every returned row's `coachOnly` agrees with
   `coaches.player_id IS NULL`; totals across the table are **368 linked / 18
   coach-only** (§1.8, exhaustive).
7. **Non-fabrication** — an unknown coach id and an out-of-range season return
   empty, never a fabricated zero-row "record".

League-wide thresholds are asserted only as **inequalities and orderings**, not
exact counts: §1.1–§1.3 are `LIMIT 25` witness lists, not exhaustive
(measurement gap **M6**).

### 13.12 Exact measured witnesses (from `ISSUE-152-nl-evidence-output.txt`)

Every number below is quoted from the 2026-09-08 run; **(E)** marks exhaustive,
**(W)** marks a `LIMIT`-bounded witness list.

- **(E) §0.1** — `coaches` 386 = **368** `unique` + **18** `unmatched`;
  `match_coaches` **32,034**, all linked.
- **(E) §0.2** — coaching seasons **1902–2025**, dates **1902-05-03** to
  **2025-09-27**.
- **(W) §1.1** — Mick Malthouse (coach 1, player 9635) 1984–2015, **718** g,
  406 W, 7 D, 305 L, 52 finals, 8 GF, **3** premierships, 57.03%; Jock McHale
  (coach 2) 1912–1949, 713 g, **466** W, 10 D, 237 L, 16 GF, **7** premierships,
  66.06%; Kevin Sheedy (3) 678 g, 4 premierships; Chris Scott (16) 360 g, 245 W,
  **68.47%**; Norm Smith (10) 452 g, **6** premierships; Frank Hughes (18) 378 g,
  **5** premierships.
- **(W) §1.3, 50+ games** — Cliff Rankin (152) **57 g, 45 W, 0 D, 78.95**;
  Jack Bisset (120) 80 g, 63 W, **78.75**; George Angus (149) **60 g, 41 W, 2 D,
  70.00**; Craig McRae (73) 99 g, 67 W, 2 D, 68.69.
- **(E) §1.4 — Richmond organization, all 42 rows.** Damien Hardwick (17)
  2010–2023, 14 seasons, **307** g, 170 W, 6 D, 131 L, **56.35**; Tom Hafey (5)
  1966–1976, 11 seasons, 248 g, **173** W, 2 D, 73 L, 70.16; Jack Dyer (43)
  1941–1952, 222 g, 134 W; Perce Bentley (12) 133 g; Frank Hughes (18) 120 g;
  Tony Jewell (57) 113 g, 53 W; Danny Frawley (84) 113 g, **45** W; Dan Minogue
  (20) **101** g; Albert Pannam (160) **54** g; Des Rowe (164) **54** g; Jeff
  Gieschen (172) 49 g, **25** W; Barry Richardson (176) 47 g, **25** W; Jack
  Titus (285) **1937 and 1965**, 3 seasons, 17 g; Dick Harris (319) **1944 and
  1964**, 2 seasons, 10 g; Charlie Taylor (347) 2 g, 0 W; Max Hislop (367) and
  Verdun Howell (370) **1 g, 0 W** each.
- **(E) §1.5** — Richmond 2017: exactly **one** row, Damien Hardwick, 25 g,
  18 W, 0 D, 7 L.
- **(W) §1.6** — Dan Minogue (20) and John Northey (24) **5 organizations**
  each; Mick Malthouse, Tom Hafey, Ron Barassi, Robert Walls 4 each; Denis Pagan
  and Terry Wallace **2 organizations / 3 club identities** (§5.3.A).
- **(W) §1.7** — Malthouse 174 playing / 718 coached; Jock McHale 261 / 713;
  Kevin Sheedy 251 / 678; Leigh Matthews 332 / 461; Allan Jeans 77 / 576.
- **(E) §1.8** — 368 `unique` (all player-linked) / 18 `unmatched` (none
  linked). No `resolved`.
- **(E) §7.1** — games min **1**, max **718**, median **43**; wins min **0**,
  max **466**, median **15**.
- **(E) §7.2 — Richmond thresholds, usable directly as expectations:**
  ≥200 g → **3** (307, 248, 222); ≥100 g → **8** (lowest inside: Dan Minogue
  101); ≥50 g → **14** (lowest inside: Pannam / Rowe 54; Gieschen 49 excluded);
  ≥100 W → **3** (Hafey 173, Hardwick 170, Dyer 134); ≥50 W → **7** (Jewell 53
  inside, Frawley 45 excluded); ≥25 W → **14** (Gieschen / Richardson 25 inside).

**Surname-collision witnesses used by §13.2:** Albert Pannam (160) and Charlie
Pannam (266) both coached Richmond; Len Smith (88) coached Richmond while Norm
Smith (10) coached elsewhere. Both surnames are therefore excluded from the
directory's alias set.

### 13.13 Corpus additions (additive only)

- The two existing gates — `afldb-ui-questions-1440-real-user-v3-20260822.csv`
  (1,435 rows) and `afldb-ui-questions-60-real-user-decline-v3-20260822.csv`
  (60 rows) — are **not edited**. Neither contains a single `coach` question
  (§3.7), so removing the false decline cannot flip an existing row; both must
  stay green unchanged.
- Two new files in `tests/nl-ui/corpora/`, same header
  (`id,category,question,expected_status,tags`):
  - `afldb-ui-questions-coaching-v1-<date>.csv` — **90–120** rows,
    `expected_status = plan`, categories covering A1–A12: club coaches, career
    record, record at a club, club ranking, league ranking, win percentage,
    thresholds, season-scoped, multi-club, premierships, players coached by,
    premiership coaches.
  - `afldb-ui-questions-coaching-decline-v1-<date>.csv` — **20–25** rows,
    `expected_status = decline`, one per line of §13.15.
- Every corpus question whose expected answer is a number uses a §13.12
  witness, so a corpus row and a DB assertion cannot drift apart.

### 13.14 `PARSER_VERSION` bump point

**One** bump for the whole phase: **34 → 35** (`plan.ts:312`), made in the same
commit that wires the parser and deletes the F2 decline — the commit in which
an identical question first produces a different result. The history comment
above the constant gains:

```
35: coaching becomes answerable (AFLDB-ISSUE-152 Phase B). A new
    coach_record grain over match_coaches, a coach reference distinct
    from any player reference (18 of 386 coaches have no player row at
    all), and the removal of the UNANSWERABLE_TOPICS 'coaching' rule,
    whose stated reason -- that AFLDB holds no coaching data -- stopped
    being true at migration 087 and had been declining every coaching
    question with an untrue explanation ever since.
```

Phases C, D, E and F each get their own single bump (36, 37, …). No bump is made
by a test-only or corpus-only commit.

### 13.15 Forms that must still decline

After F2's removal these must land on the ordinary decline path
(`unrecognised` / `low_confidence` / `ambiguous`), never on a fabricated answer,
and each gets a decline-corpus row:

1. **Coverage floor** — "who coached Carlton in 1899" (no `match_coaches` row
   before **1902**, §0.2).
2. **Ambiguous coach surname** — "Pannam's coaching record", "Smith's coaching
   record" (§13.2).
3. **Unknown coach** — any name absent from the 386-row directory.
4. **Ownership failure (the ISSUE-110 rule)** — "Richmond players coached by
   Damien Hardwick". `coached_by` takes a `coach` parameter **only**
   (`grid-solver-spec.ts:339`) and owns no club, so the club would reach SQL as
   nothing at all. It needs the `coached_club(org)` builder, which is **Phase
   F**. Declines until then.
5. **"Later"** — "players who later coached Richmond" (D9: no temporal ordering
   is stored; only the "also" reading is supportable, and only in Phase F).
6. **Assistant / caretaker / senior-coach distinctions** — `match_coaches`
   records the club's coach for a match and nothing finer.
7. **Coach of a state or representative side, coaching in another competition,
   coaching awards, coaching tenure reasons (sacked/resigned), contracts,
   salaries** — none is in AFLDB.
8. **Coach vs coach head-to-head** — "Hardwick's record against Clarkson" is a
   coach-versus-coach question; `match_coaches` can express it, but no plan
   field owns a second coach in Phase B, so it declines rather than silently
   answering one coach's whole record.
9. **Per-season coaching completeness claims** — "was every club's coach
   recorded in 1940" (measurement gap **M1**).
10. **`win_pct` superlative with no qualifier and an explicit "no minimum"**
    ("best win percentage of any coach ever, no minimum") — refused rather than
    answered from a 1-game sample (§7.1: minimum is 1 game).

### 13.16 Files this phase touches

| File | Change |
|---|---|
| `src/search/nl/plan.ts` | grain, `NlCoachRef`, `coach` field, `NL_METRICS.coach_record`, `NL_COVERAGE` floor, label maps, `validatePlan` gate, `describePlan` line, `PARSER_VERSION` 35 |
| `src/search/nl/vocab.ts` | `COACH_CUE_RE`, `COACHED_BY_RE`, `PREMIERSHIP_COACH_RE`, `COACH_METRIC_WORDS`; **delete** the `coaching` `UNANSWERABLE_TOPICS` entry |
| `src/search/nl/entities.ts` | `NlCoachDirectoryEntry`, `findCoach` |
| `src/search/nl/parser.ts` | optional `coaches` on `NlParseContext`; step 5c; grain-election branch; `structuralOk` clause; plan assembly `coach` field |
| `src/search/nl/answer-types.ts` | `NlCoachRecordRow`, `coach_record` payload |
| `src/search/nl/describe.ts` | `describeCoachRecordAnswer` + dispatch |
| `src/db/queries/nl/coach-record.ts` | **new** compiler |
| `src/db/queries/nl/execute.ts` | dispatch case |
| `src/db/queries/nl/answer.ts` | `payloadTotal` case |
| `src/db/queries/nl/resolve.ts` | `buildCoachDirectory`, wired into `buildNlParseContext` |
| `src/components/NlAnswerSection.tsx` | `CoachRecordTable` |
| tests + corpora | §13.10, §13.13 |
| `CHANGELOG.md` | one `Unreleased` entry — coaching becomes answerable; the false decline is removed |

No migration. No change to `src/db/queries/coaches.ts`, to any `/coaches`,
`/records/coaches` or club-page route, or to the Grid Solver.

### 13.17 One open sub-decision for the operator

**Seasons after the last recorded one.** §0.2 measures coaching data ending at
season **2025**. "Who coached Richmond in 2026" has two truthful treatments:

- **(a)** an `NL_COVERAGE` range `[[1902, 2025]]`, which **declines** — but
  hard-codes a last season that becomes wrong the moment 2026 matches load; or
- **(b)** a floor-only rule at 1902 (§13.1(9)) plus the existing empty-result
  path (`answer.ts:161`), which answers **"AFLDB has no coaching records for
  Richmond in 2026"** — truthful, self-updating, and already implemented.

**Recommendation: (b)**, with the floor at 1902 kept as a hard decline. This is
narrower than §5.2 A's "a question about 2026 must say so rather than answer
zero" — under (b) it does say so, as an explicit empty result rather than a
refusal. Flagged rather than assumed.

### 13.18 Risks and how each is contained

| Risk | Containment |
|---|---|
| A coaching metric word steals an existing player/club question | The `coachCuePresent` gate mirrors `clubSeasonCuePresent` exactly; a no-coach-cue regression battery in `tests/nl-parser.test.ts` plus the untouched 1,435-row corpus prove it. |
| A coach-only person is rendered with a player link | `coachOnly` asserted against `coaches.player_id IS NULL` in the integration test; rendered check in the stress spec. |
| Whole-career and at-a-club numbers are conflated | Separate plan shapes, separate interpretations, and Hardwick's 307-game Richmond record asserted against his career total. |
| Win percentage silently becomes `W/G` | The George Angus 70.00-vs-68.33 control in §13.11(4) fails if the formula changes. |
| A split stint renders as continuous tenure | Jack Titus 1937/1965 is a describe-level red test. |
| The removed decline leaves coaching questions answered wrongly instead of declined | §13.15's ten forms are decline-corpus rows, written red before the deletion lands. |

### 13.19 Stop condition

This section is a plan. Work began on operator approval of §13 (given
2026-09-08, together with the §13.17 sub-decision: **floor-only coverage at
1902, no upper bound**). What was actually built is recorded in **§14**;
§13 is left as written so the plan and the outcome can be compared.

## 14. Phase B — IMPLEMENTED 2026-09-08

Operator approval of §13 was given on 2026-09-08, with the §13.17 sub-decision
answered as **(b)**: a floor-only coaching coverage rule at **1902**, no
hard-coded upper bound, an empty future-season result treated as a genuine
empty result, and no claim of completeness from 1902 onward.

Phase B only. Phase C has not begun.

### 14.1 Files changed

| File | Change |
|---|---|
| `src/search/nl/plan.ts` | `coach_record` grain; `NlCoachRef`; `NlQueryPlan.coach`; `NlQueryPlan.coachQualifier`; `NL_METRICS.coach_record` (10 metrics); `NL_COACH_WIN_PCT` + `coachWinPctQualifierNote`; `NL_COVERAGE` coaching floor + grain-level `nlCoverageFor` rule; `validatePlan` coach_record gate; label maps; `describePlan` coach + qualifier lines; `PARSER_VERSION` 34 → 35 |
| `src/search/nl/vocab.ts` | `COACH_CUE_RE`, `COACH_WIN_PCT_RE`, `COACHED_BY_RE`, `PREMIERSHIP_COACH_RE`, `COACH_METRIC_WORDS`, `COACH_NO_QUALIFIER_RE`; **deleted** the `coaching` `UNANSWERABLE_TOPICS` entry (F2) |
| `src/search/nl/entities.ts` | `NlCoachDirectoryEntry`, `findCoach` |
| `src/search/nl/parser.ts` | optional `coaches` on `NlParseContext`; the coaching step; `extractCoachMetric`; grain-election branch; per-season refusal; `structuralOk` clause; plan assembly |
| `src/search/nl/answer-types.ts` | `NlCoachRecordRow`, `coach_record` payload |
| `src/search/nl/describe.ts` | `describeCoachRecordAnswer` + count dispatch + the four §13.7 interpretations |
| `src/db/queries/nl/coach-record.ts` | **new** compiler |
| `src/db/queries/nl/execute.ts` | dispatch case |
| `src/db/queries/nl/answer.ts` | `payloadTotal` case |
| `src/db/queries/nl/resolve.ts` | `buildCoachDirectory`, wired into `buildNlParseContext` |
| `src/lib/format.ts` | `coachProfilePath` (the linked-coach / coach-only link rule) |
| `src/components/NlAnswerSection.tsx` | `CoachRecordTable` |
| `tests/nl-parser.test.ts` | coach directory in the shared context; the false-decline expectation replaced; 21 coaching cases incl. the no-cue regression battery |
| `tests/nl-plan.test.ts` | `validatePlan` coach_record suite (one refusal assertion per field) + `describePlan` wording |
| `tests/nl-describe.test.ts` | the four interpretations, the split stint, the tie, the verbatim qualifier |
| `tests/nl-audit-acceptance.test.ts` | 16 supported coaching families + 16 must-decline forms |
| `tests/integration/nl-answers-coaching.test.ts` | **new**; 23 DB-backed cases |
| `tests/nl-ui-corpus.test.ts` | the two pre-Phase-B gates asserted untouched and coaching-free; the new corpora's shape |
| `tests/format.test.ts` | `coachProfilePath` |
| `src/db/migrations/092_nl_search_log_coach_record_grain.sql` | **new**; extends `nl_search_log.grain`'s CHECK to admit `coach_record` (F5) |
| `tests/integration/database.test.ts` | `coach_record` added to the exhaustive grain map; the grain test now also names `coach_record` and asserts a random unsupported grain is still rejected |
| `tests/nl-ui/corpora/afldb-ui-questions-coaching-v1-20260908.csv` | **new**, 99 rows |
| `tests/nl-ui/corpora/afldb-ui-questions-coaching-decline-v1-20260908.csv` | **new**, 25 rows |
| `CHANGELOG.md` | one `Unreleased` entry |

One migration — 092, and only because the ninth grain forced it (F5 below;
§13.16's "no migration" assumption is superseded by implementation evidence).
No change to `src/db/queries/coaches.ts`, to any `/coaches`, `/records/coaches`
or club-page route, or to the Grid Solver. No deployment.

### 14.2 Supported coaching question families

`coach_record` grain: every coach of a club (A1); how many coaches a club has
had; a coach's whole career (A2); a coach's record at one organization (A3);
club-scoped rankings (A4); league-wide rankings (A5) over
`games | wins | draws | losses | finals | grand_finals | premierships | seasons | organizations`;
win percentage with a stated qualifier (A6); thresholds on any metric (A7);
season-scoped coaching (A8); multi-club coaching as an ORGANIZATION count (A9);
premiership counts (A10). `player_career` grain: "players coached by X" (A11)
and "premiership coaches" (A12), through the existing `coached_by` and
`premiership_coach` builders.

### 14.3 Declines that remain

The ten forms of §13.15 all decline, plus one added during implementation:

11. **A per-season coaching split** — "most wins in a season by a coach". A
    coaching record is totalled across the seasons in scope and there is no
    per-season coaching grain, so consuming "in a season" and answering the
    all-time total would be the ISSUE-110 discarded-scope failure. The parser
    declines with that reason rather than answering.

Measured decline routes (probe, 2026-09-08): the 1902 floor and the
"Richmond players coached by X" ownership failure refuse at `validatePlan`;
the other thirteen decline at parse as `unrecognised` / `ambiguous` /
`low_confidence`.

### 14.4 Validation

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | PASS, clean |
| `tests/nl-parser.test.ts` | 188/188 PASS |
| `tests/nl-plan.test.ts` + `tests/nl-describe.test.ts` | 118 + new cases PASS |
| `tests/nl-audit-acceptance.test.ts` | PASS |
| `tests/format.test.ts`, `tests/nl-ui-corpus.test.ts` | PASS |
| `tests/integration/nl-answers-coaching.test.ts` (`afldb_test`, 55432 tunnel) | **23/23 PASS** |
| `tests/nl-regression-corpus.test.ts` | PASS, unchanged |
| Red check | With the three Phase B gates temporarily reverted, **53** of the new cases fail; restored, 330/330 pass |

**F5 re-run, 2026-09-08** (after migration 092 and the telemetry-test change):

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | PASS, clean |
| Focused Phase B gate — `nl-parser`, `nl-plan`, `nl-describe`, `nl-audit-acceptance`, `nl-ui-corpus`, `format`, `nl-regression-corpus` | **548/548 PASS** (7 files) |
| `tests/workflow-preflight.test.ts` + `tests/migration-checksum.test.ts` (migration naming/collision/checksum contract) | **36/36 PASS** |
| `npm run preflight -- --mode implementation --issue 152` | Migration inventory clean — **no numeric collision and no duplicate name** for 092 across every local ref, remote ref and sibling worktree; the only migration finding is the expected `branch-local-migration` WARN (092 is not yet on `origin/main`). The single FAIL is "working tree is clean", the expected state of an uncommitted, unreviewed change. |
| `tests/integration/database.test.ts` -> "accepts every supported NL telemetry grain and rejects an unsupported one" (the F5 telemetry contract) | **PASS.** Run 2026-09-08 with 092 applied to `afldb_test`. All nine grains insert, `coach_record` among them, and a random unsupported grain is still rejected. **F5 is proven fixed against the database, not merely written.** |
| `tests/integration/nl-answers-coaching.test.ts` (re-run) | **23/23 PASS** (2026-09-08), unchanged from the first run. |
| `tests/integration/database.test.ts` (whole file) | **42/46.** The 4 failures are **pre-existing `afldb_test` dataset-baseline drift with no relationship to Phase B** — see §14.4.1. |

The two gates §14.4 previously recorded as BLOCKED were executed on 2026-09-08
after `npm run db:migrate:test` applied 092 over the `55432` tunnel. The command
block used was:

```powershell
$env:AFLDB_TEST_DATABASE_URL = "<afldb_test DSN on 127.0.0.1:55432>"
npm run db:migrate:test          # applies 092
npx vitest run tests/integration/database.test.ts tests/integration/nl-answers-coaching.test.ts
```

#### 14.4.1 The four `database.test.ts` failures are NOT Phase B

The same run reports 4 failures in `tests/integration/database.test.ts`. Every
one is a hard-coded row-count expectation pinned to a **dataset snapshot**, and
the `afldb_test` in use has since moved off that snapshot. None touches NL
search, the parser, the planner, the coaching compiler, telemetry or migration
092, and Phase B changes no row count anywhere in the database.

| Assertion | Snapshot expectation | Current `afldb_test` |
|---|---|---|
| `data integrity` -> has the full player-match dataset | 685,471 | 694,445 |
| `advanced search regression cases` -> 200-249 games with 16 or more finals | 114 | 119 |
| `advanced search regression cases` -> 50-199 goals and no Brownlow votes | 261 | 268 |
| `advanced search regression cases` -> 200+ games, 100+ goals and 15+ finals | 219 | 223 |

The first assertion's own comment pins it explicitly to
**`full-history-20260827`** (`measured.player_match_rows = 685,471`). The other
three are counts over the same population and move with it.

**Operator decision 2026-09-08: these four are EXTERNAL, PRE-EXISTING
`afldb_test` baseline drift and are OUT OF SCOPE for AFLDB-ISSUE-152.** They
were **not** investigated and **not** edited under this issue. Re-pinning a
snapshot expectation to whatever the database currently returns would destroy
the drift signal these assertions exist to raise; the correct resolution —
re-measure and re-pin against a named snapshot, or restore the snapshot — is a
separate dataset-baseline investigation. Phase B's own DB contract is the
telemetry-grain test above, and it passes.

The integration suite compares the compiler against independently hand-written
SQL and confirms the exhaustive witnesses: Richmond 42 coaches in
`getClubCoachRecords` order; Hardwick 307/170/6/131, 14 seasons, 56.35%, and a
career total strictly greater than 307; Richmond 2017 exactly one row
(25/18/0/7); thresholds ≥200 g → 3, ≥100 g → 8, ≥50 g → 14, ≥100 W → 3,
≥50 W → 7, ≥25 W → 14; George Angus 70.00 against a `W/G` control that returns
68.33 and must not match; the 50-game board led by Cliff Rankin at 78.95 while
the unqualified board is led by a sub-50-game coach; Footscray-era rows on
Western Bulldogs and no Fitzroy row on Brisbane Lions; `coachOnly` agreeing
with `player_id IS NULL` row by row and 368/18/386 in total; an unknown coach
and an empty season returning nothing rather than a fabricated zero record; and
`min(season)` over `match_coaches ⋈ matches` being exactly 1902.

The two new corpora are also executed through the **real** 386-coach directory
in that suite: all 99 plan rows parse and validate, all 25 decline rows decline,
and the directory is asserted to exclude `pannam` and `smith` as aliases while
keeping `hardwick`.

### 14.5 Deviations from §13, and why

**Operator review 2026-09-08: the implementation is ACCEPTED subject to F5, and
deviations 1, 2, 3 and 5 below are ACCEPTED as recorded** — coaching extraction
before match-type extraction, `coachQualifier` instead of overloading
`metricCondition`, `organizations` as a tenth `coach_record` metric, and
`coachProfilePath` unit coverage instead of `nl-stress` link coverage.
**Deviation 4 (red-before-green ordering) is accepted for Phase B only**,
because the post-hoc red proof demonstrated 53 new cases failing with the
Phase-B gates removed; **Phase C onward must return to genuine red-before-green
ordering.**

1. **Where the coaching step sits.** §13.3 places it after match-type
   extraction. It is placed after SEASON extraction but BEFORE match-type
   extraction instead: `extractMatchType` consumes "grand final"/"final", which
   are coaching METRICS ("the most grand finals"), and leaving it later made
   that whole family unreachable. Running after seasons keeps a year out of a
   threshold's number window.
2. **The win-percentage qualifier is a plan field.** §13.9 requires the
   qualifier to be parser-set, always stated, and refused when absent, but
   `metricCondition` qualifies the plan's OWN metric and cannot express "50
   games" on a `win_pct` ranking. A single new coach-owned field,
   `coachQualifier: { minGames }`, carries it; `validatePlan` refuses it on
   every other grain and refuses a `win_pct` ranking that lacks it.
3. **A tenth metric, `organizations`, ships.** §13.6 made it conditional on A9
   shipping in Phase B. A9 ships, so the metric exists; it counts
   `DISTINCT organization_id` and the raw club count is never reported.
4. **Test order.** §13.10 asks for red-before-green. The tests were written
   after the implementation in this session; a red check was performed
   afterwards instead by temporarily reverting the three Phase B gates and
   observing 53 of the new cases fail. That is evidence the tests are not
   vacuous, but it is **not** the test-first ordering §13.10 asked for.
5. **`tests/nl-ui/nl-stress.spec.ts` was NOT touched.** That spec is a
   corpus-driven browser sweep with no home for two hand-written rendered-link
   assertions, and it needs a running server. The rule it was to test — a
   coach-only person never gets a `/players` href, a linked coach never gets a
   `/coaches` one — is instead pinned as a pure function, `coachProfilePath`
   in `src/lib/format.ts`, with unit tests, and `coachOnly` is asserted
   row-by-row against `coaches.player_id` in the integration suite. The
   rendered check remains outstanding and is listed below.

### 14.6 F5 — CLOSED 2026-09-08 (fixed by migration 092 and verified against the database)

**F5 — `nl_search_log.grain`'s CHECK constraint did not know the ninth grain.
FIXED 2026-09-08 by `src/db/migrations/092_nl_search_log_coach_record_grain.sql`,
on the operator's explicit authorisation as Phase B work (not a new issue, not
Phase C). CLOSED 2026-09-08:** migration 092 was applied to `afldb_test` with
`npm run db:migrate:test`, and the contract test —
`tests/integration/database.test.ts` -> "accepts every supported NL telemetry
grain and rejects an unsupported one" — **PASSES**. All nine grains insert,
`coach_record` among them, and a random unsupported grain is still rejected, so
the CHECK was widened without being turned into a formality. F5 needs no further
work under this issue; only the deploy-time application of 092 to `afldb_dev`
and production remains, and that is ordinary deployment sequencing (below), not
an open finding.

Migration **079** pinned the constraint to eight grains and its own header says
"Keep this list aligned with NlGrain in `src/search/nl/plan.ts`". Adding the
ninth supported grain, `coach_record`, therefore drifted the telemetry schema
contract for the third time (046 -> 055 -> 079 -> 092).

The consequence was exactly the one 055 and 079 were written to repair:
`logNlSearch` deliberately swallows INSERT failures so telemetry can never turn
a good search into an error (`src/db/queries/nl/log.ts`), so **every coaching
answer would have rendered correctly while its telemetry row was rejected and
dropped in silence.** Nothing a reader sees is wrong; the search log simply
would not contain coaching — the vocabulary/confidence signal migration 046
built the table to capture.

**The Stage-0 "no migration" assumption (§13.16) is superseded by implementation
evidence.** A ninth supported `NlGrain` cannot be admitted without extending
this constraint; a coaching answer that renders while its telemetry is silently
dropped is not an acceptable end state.

What migration 092 does, and what it deliberately does not do:

- extends the CHECK to nine grains, **retaining all eight previously accepted
  grains verbatim**;
- forward-only and strictly widening — no existing row can fail the new
  predicate, and the constraint is **not** weakened, removed, or made
  `NOT VALID`;
- touches nothing else: no privileges, no columns, no indexes, no data;
- `logNlSearch` is **unchanged**. The swallow-and-`console.error` behaviour is
  deliberate and documented, and investigation found no separate telemetry
  defect. The repair here is to the schema contract, not to telemetry error
  handling.

```sql
ALTER TABLE nl_search_log DROP CONSTRAINT nl_search_log_grain_check;
ALTER TABLE nl_search_log ADD CONSTRAINT nl_search_log_grain_check CHECK (grain IN
  ('player_career', 'player_game', 'player_season', 'team_match', 'club_season', 'team_streak',
   'head_to_head', 'achievement_summary', 'coach_record'));
```

The contract test is `tests/integration/database.test.ts` -> "accepts every
supported NL telemetry grain and rejects an unsupported one". It now:

- drives the accepted list from `Record<NlGrain, true>`, so the **tenth** grain
  fails this test rather than silently losing its telemetry in production;
- names `coach_record` (and `head_to_head`) explicitly, so reverting either
  migration fails by name;
- asserts a **random unsupported grain is still REJECTED**, inside the existing
  always-rollback `expectRejected` helper, so widening the CHECK cannot quietly
  turn it into a formality.

**Deployment ordering:** migration 092 must be applied **before** the Phase B
code reaches any environment (`afldb_dev`, then production). Code first would
reproduce the silent-drop window this fixes.

**Also outstanding — DONE since:**

- ~~The two DB-backed gates have not been re-run since migration 092 was
  written.~~ **DONE 2026-09-08.** 092 applied to `afldb_test`; the F5 contract
  test PASSES and `tests/integration/nl-answers-coaching.test.ts` is 23/23. See
  §14.4.

**Still outstanding (does not block Phase B being technically complete):**

- The rendered UI has not been exercised: no dev server run, no browser
  sweep of the two new corpora, no deployment. The corpora are written and
  gated at parse/plan level but have never been rendered.
- `npm run build` has not been run.
- Migration 092 has not been applied to `afldb_dev` or production. It must be
  applied BEFORE the Phase B code reaches either.

### 14.7 Phase B — TECHNICALLY COMPLETE 2026-09-08

Phase B is **technically complete**: every gate the runbook set for it has been
executed and passed, and **F5, its one implementation finding, is CLOSED**.

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | PASS, clean |
| Focused Phase B suites — `nl-parser`, `nl-plan`, `nl-describe`, `nl-audit-acceptance`, `nl-ui-corpus`, `format`, `nl-regression-corpus` | **548/548 PASS** (7 files) |
| Migration naming/collision/checksum contract — `workflow-preflight`, `migration-checksum` | **36/36 PASS** |
| NL telemetry grain contract (F5) — `tests/integration/database.test.ts` | **PASS** with 092 applied |
| Coaching answers vs hand-written SQL — `tests/integration/nl-answers-coaching.test.ts` | **23/23 PASS** |
| Four `database.test.ts` dataset-count assertions | **FAIL — external, pre-existing `afldb_test` baseline drift; out of ISSUE-152 scope, not investigated, not edited (§14.4.1)** |

"Technically complete" means the code, tests, migration and documentation are
finished and validated. It does **not** mean shipped: the rendered/browser run,
`npm run build`, and deployment (092 first, then code) are still to come, and
Phases C–F have not started. **AFLDB-ISSUE-152 therefore stays OPEN.**

Phase C is **not** started and is not to be started on this instruction.
