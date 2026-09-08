# AFLDB-ISSUE-152 — Expand deterministic NL Search to newer AFLDB record families

**Stage 0 (allocation + inventory) runbook. No implementation.**

| | |
|---|---|
| Worktree | `D:\dev\afldb-issue-152` |
| Branch | `opus/issue-152-nl-record-expansion` |
| Base SHA | `c2761e64e9089f9e38572145e67a6ab2fee0fe12` (`Merge branch 'opus/issue-110-semantic-closeout'`) |
| Base freshness | `main` is AT that SHA — it has not advanced. `git merge-base HEAD main` = the same commit. |
| Parser baseline | `PARSER_VERSION` **34** (`src/search/nl/plan.ts:312`). **Not incremented by Stage 0.** |
| Status | **OPEN — STAGE 0 ONLY.** Inventory complete, semantic contract proposed, awaiting operator review. |
| Migration | **None proposed.** Stage 0 found no canonical-data gap requiring schema change. |
| Found | 2026-09-08 |

ISSUE-110 is Resolved and merged and is **not** reopened, amended or extended by this issue.

---

## 1. Stage-0 scope statement

ISSUE-152 compares the canonical/public AFLDB data surface against the typed
deterministic NL layer and identifies truthful missing semantic domains. Stage 0
delivers the inventory, the coverage matrix and the semantic decisions that need
an operator answer. It changes no parser, plan, compiler, corpus or UI behaviour.

---

## 2. Evidence pack

- **File:** `ISSUE-152-nl-evidence.sql` (worktree root, 1,032 lines, untracked at
  allocation time).
- **Inspected:** yes.
- **Executed against `afldb_test`:** **NO — operator gate.** See §2.2.
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

### 2.2 Why it was not executed — operator gate

Not a refusal, a capability boundary:

- this worktree has **no `.env`** (only `.env.example`), so no `AFLDB_TEST_DATABASE_URL`;
- `psql` is not on `PATH` (the client exists at
  `C:\Program Files\PostgreSQL\16\bin\psql.exe`);
- `afldb_test` lives on the remote host and is reached through the operator's
  `55432` SSH tunnel, which is not up in this session.

**Operator command** (tunnel up, `afldb_test` DSN, never production):

```
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -X -v ON_ERROR_STOP=1 `
    -f ISSUE-152-nl-evidence.sql `
    -d "<afldb_test DSN on 55432>" `
    *> ISSUE-152-nl-evidence-output.txt
```

Everything in §§3–5 below is **code- and schema-derived and does not depend on
that output**. The output is required only to (a) fill the "evidence" column
values, (b) derive the test/corpus witnesses, and (c) settle decisions **D3**,
**D5** and **D7** in §7.

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
- **Identity/link limitations:** 383 coach rows; some coach-only
  (`player_id` NULL) and **must not** be given a player link or a `/players`
  href. Some coach `display_name`s collide with player names (Ron Barassi, Mark
  Williams, Damien Hardwick) — a `coach` reference must be a **distinct plan
  field** from `player`, never the same resolver.
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

| ID | Decision | Recommendation |
|---|---|---|
| **D1** | Does NL rank coaches by win percentage, and at what minimum games? `/records/coaches` uses **50** and states it on the page. | **Yes**, reusing the site's `(W+D/2)/G` convention and the same **50**-game qualifier, stated in the interpretation. Never a different number silently. |
| **D2** | "Coaches who coached more than one club" — by `organization_id` or by raw `clubs.id`? They differ for a coach who coached Footscray and Western Bulldogs. | **`organization_id`**, matching every other club-scoped NL semantic. |
| **D3** | `premiership_coach` is player-grain (a coach who *also* played). Is "coaches with premierships" a coach-grain question instead — which would include coach-only people? | **Coach grain** for "coaches with premierships"; keep `premiership_coach` for the player-grain reading. Needs §1.7 to size the seam. |
| **D4** | May an after-siren question be scoped to finals/round? Only `premiership_season` rows have a `match_id`. | **Yes for finals**, over premiership rows only, with the non-premiership exclusion stated. Round-level scope: decline. |
| **D5** | Expose `kick_scored='none'` (misses), `shot_detail` and the `siren` subtype to NL? | **Misses yes** ("who missed after the siren" is a real question); `shot_detail` and `siren` subtype **no** — source detail, no natural question. Confirm against §7.4 that each subtype has a witness. |
| **D6** | `getFamilyRecords` — see **Finding F1**. Should "biggest football families" mean *all* relationship types (what the query does) or *siblings* (what the page says)? | **DEFERRED to AFLDB-ISSUE-153** (operator, 2026-09-08). ISSUE-152 does not settle it and does not ship a third reading; C1 waits. |
| **D7** | Which relationship enum members get NL wording? | `sibling` + `parent_child` in Phase D. `cousin`/`grandparent_grandchild` only if §7.5 shows real linked witnesses. `spouse`/`in_law`/`other`: **no**. |
| **D8** | "Father-son" is **ambiguous in AFLDB's own UI** — see **Finding F1**. `/records/father-son` shows `parent_child` relationships; the Grid Solver's `father_son_selection` is the draft rule. | **DEFERRED to AFLDB-ISSUE-153** (operator, 2026-09-08). Until it is settled NL must **not** guess: FS1–FS3 and FS6 wait, and the bare phrase "father-son" stays unrecognised rather than being bound to either reading. |
| **D9** | Cross-domain composition (F1–F3). | **Defer to Phase F**, and only for the "also" reading. Decline "later". |

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

---

## 9. Recommended implementation order

Phase A (this document) is complete pending operator answers to §7.

| Phase | Content | Gate |
|---|---|---|
| **B — Coaching** | `coach_record` grain + `NlCoachRef` + coach resolver; remove the false decline (F2); wire `coached_by`. Highest value: five public surfaces, a false decline, and the SQL already written. | red parser/plan tests → `validatePlan` ownership tests → DB-backed comparison against hand-written SQL → rendered cases |
| **C — After-the-siren** | `after_siren` grain, four dimensions kept distinct. Self-contained, one table, no identity seam. | same |
| **D — Family / father–son** | **Blocked on AFLDB-ISSUE-153** for the F1-dependent subfamilies (C1, FS1–FS3, FS6, decisions D6/D8). C2/C3/C4/FS4 do not depend on F1 and may proceed. | same |
| **E — First-kick-goal closure** | E6–E8 only; three wordings over existing builders. Cheapest phase; may be folded into B or C. | same |
| **F — Cross-domain** | Only after B–D are green, only the "also" reading, only with per-filter ownership. | plus explicit ownership tests |
| **G — Corpus + DEV acceptance** | New ISSUE-152 corpus; rendered DEV acceptance. | 1,435 + 60 unchanged and still green |

Reordering note: **E before D** is defensible and cheaper. **B first** is not
negotiable — it is the only phase fixing an active untruth.

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

Decline/control cases must include: coverage refusals (pre-1923 coaching), the
coach/player identity collision, unlinked-side refusals, "goal after the siren"
vs "to win", "father-son" ambiguity (D8), and "later coached" (D9).

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
- No parser, plan, compiler, corpus, UI, schema or `CHANGELOG` behavioural change.
- `PARSER_VERSION` unchanged at 34.
- **Blocking gate:** the evidence pack must be executed against `afldb_test`
  (§2.2) before Phase B design is finalised — it settles D3, D5, D7 and supplies
  every test witness. **No threshold is asserted in this document.**
- **Second gate:** operator answers to §7 D1–D9. **D6 and D8 are deferred to
  AFLDB-ISSUE-153** and are not a precondition for Phases B, C or E.
- **Operator decisions recorded 2026-09-08:** Stage 0 approved for persistence;
  Finding **F1** is out of ISSUE-152 implementation scope and is tracked as
  **AFLDB-ISSUE-153**; ISSUE-152 records F1 as an external dependency, repairs
  neither page, and defers only the family/father-son wording whose meaning
  depends on it.
