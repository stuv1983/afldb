# AFLDB-ISSUE-152 — Expand deterministic NL Search to newer AFLDB record families

**Stage 0 (allocation + inventory) runbook. No implementation.**

| | |
|---|---|
| Worktree | `D:\dev\afldb-issue-152` |
| Branch | `opus/issue-152-nl-record-expansion` |
| Base SHA | `c2761e64e9089f9e38572145e67a6ab2fee0fe12` (`Merge branch 'opus/issue-110-semantic-closeout'`) |
| Base freshness | `main` is AT that SHA — it has not advanced. `git merge-base HEAD main` = the same commit. |
| Parser baseline | `PARSER_VERSION` **34** (`src/search/nl/plan.ts:312`). **Not incremented by Stage 0.** |
| Status | **OPEN — PHASES B, C AND E COMMITTED AND VALIDATED; PHASE G RENDERED ACCEPTANCE COMPLETE AND GREEN 2026-09-09; PHASE D (UNBLOCKED HALF: C2/C3/C4/FS4) IMPLEMENTED, RENDERED AND GREEN 2026-09-09 — P5-r2 319/319 AND A FRESH P4-r1 1,495/1,495 (§24), UNCOMMITTED; PHASE F PLANNED 2026-09-09 (runbook §25) — NOT STARTED, NOT AUTHORISED TO CODE.** Inventory complete, semantic contract approved, **evidence gate executed and GREEN (2026-09-08)**, **operator decisions final (2026-09-08, §7)**: D1–D5, D7, D9 approved; D10 partially approved; D11 SATISFIED by the authorised `afldb_test` load (§18.2); D6/D8 deferred to AFLDB-ISSUE-153. Implementations: **§14** Phase B (`e8f5f67`), **§16** Phase C (`47a645f`), **§18** Phase E (`75d207d`) — §17 is superseded by §18. **§19–§21 record Phase G**: P3-r2 **271/271** and P4-r1 **1,495/1,495**, both with every transport gate at zero (§21.3, §21.4). **§22–§24 record Phase D's unblocked half**: `PARSER_VERSION` 38, six new grid builders, no migration, 67 new DB-free cases and 20 DB-backed ones green, and the rendered acceptance now COMPLETE — **P5-r2 319/319** (238 answered / 21 unanswerable / 60 absent, every transport counter at zero, 4/4 batches) and a **fresh P4-r1 1,495/1,495** (1,435 + 60, unchanged), with **D20 ACCEPTED** as capped-list disclosure. **P5 attempt 1 was INADMISSIBLE** — a stale pre-Phase-D standalone build — and a fresh discriminator proved Phase D rendering before P5-r2 (§24.1, §24.2). Historical Phase G P3/P4 evidence is untouched (§24.5). The issue stays OPEN for the **blocked Phase D half** (C1, C5/C6, FS1–FS3, FS6 and D6/D8, with AFLDB-ISSUE-153), **Phase F** (gated on B–D), the **uncommitted working tree**, and the **un-run deploy steps** — migrations **092 and 093 must both reach `afldb_dev` and production BEFORE the code**. |
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
| E6 | First-kick goal by `<player>` | **SUPPORTED** | `player` pin ANDed with `first_kick_goal_player` (`player-career.ts:143`); corrected in place per **E-D6** — see §17.1. **Both residuals CLOSED by Phase E (§18):** DB-proven (W2/W3) and the yes/no headline shipped (**E-D1**) | no | — | 5.1 |
| E7 | Goal with each of first N kicks | **SUPPORTED** (Phase E, §18) | `first_kick_goal_consecutive_min`, reused unchanged; parser emits it from `FIRST_KICK_CONSECUTIVE_RE` | no | — | 5.2 |
| E8 | First-kick goal was their only career goal | **SUPPORTED** (Phase E, §18) | `first_kick_goal_only_career_goal`, reused unchanged; the cue owns its own negation | no | — | 5.2 |
| E9 | `no_further_career_kicks`, `kickless_matches_before_first_kick` | DECLINE | now declined **by name**, not by leftover token (§18.5) | no | — | 5.2 |
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
| **M7** | ~~Unresolved `club_id` / `opponent_club_id` on `after_siren_kicks` was never counted, so §15.6's exclusion caveat rested on an assumption.~~ **CLOSED 2026-09-08** by the §15.19 read-only query (operator decision D16): `club_unresolved = 0`, `opponent_unresolved = 0`, `events = 126`. Every curated event has both club ids resolved, so the caveat was dead code and was not implemented. See §16.2. | B, §15.6 |

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

> **Progress 2026-09-09 (updated at Phase G closeout).** **B — DONE** (committed
> `e8f5f67`, §14). **C — DONE** (committed `47a645f`, §16). **E — DONE** (committed
> `75d207d`, §18). **G — DONE and GREEN for B, C and E** (§21): rendered browser
> acceptance passed at **271/271** (new families) and **1,495/1,495** (the existing
> gate). **D and F have NOT started.** `nl:stress` has still NOT been run, and
> nothing has been deployed.

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

---

## 15. Phase C — after-the-siren implementation plan (PLAN ONLY, NOT IMPLEMENTED)

**Status: PLAN — IMPLEMENTED 2026-09-08. See §16 for what actually happened,
including the three deviations from this section and the measured M7 result that
retired one of its behaviours.** Phase B is complete and is not reopened.
Nothing here is Phase D/E/F work, and nothing here is deployed.

Binding inputs, all already decided and not re-litigated below: **D4** (finals
scope only over premiership-season rows carrying `match_id`; round-level scope
declines; canonical match properties require `match_id`), **D5** (misses exposed
explicitly as `kick_scored='none'`; behinds and goals exposed distinctly;
`shot_detail` not exposed; siren subtype not exposed), **D10** as written in
**§7.1** (the match-link ownership boundary and its two hard limits).

### 15.1 Exact `NlQueryPlan` / grain fields

**One new grain.** `NlGrain` gains a tenth member:

```ts
  /**
   * A curated, cited kick after the siren (migration 089,
   * AFLDB-ISSUE-118 §23.33). An EVENT grain, not a person grain and not a
   * statistic grain: AFLDB has no play-by-play data and never recomputes
   * one of these from scores or player_match_stats.
   */
  | 'after_siren';
```

**One new typed descriptor**, carried the way `achievementSummary`,
`headToHead` and `streakDefinition` already are — a single object, so
`validatePlan`'s "fields its compiler cannot honour" list stays a flat
enumeration and no dimension can be added without appearing here:

```ts
export type NlAfterSirenSubject = 'event' | 'player';
export type NlAfterSirenScored = 'goal' | 'behind' | 'none';
export type NlAfterSirenEffect = 'won' | 'drew' | 'none';
export type NlAfterSirenKickerResult = 'win' | 'draw' | 'loss';
export type NlAfterSirenOccurrence = 'first' | 'most_recent';

export type NlAfterSiren = {
  /**
   * What the rows ARE. 'event' returns the curated events themselves;
   * 'player' aggregates them per kicker and requires a trusted player
   * link. The two answer different questions and have different payloads.
   */
  subject: NlAfterSirenSubject;
  /**
   * after_siren_kicks.kick_scored — what the kick REGISTERED.
   * undefined means ANY kick, INCLUDING a miss: "kicks after the siren"
   * is 126 events, not the 101 that scored something.
   */
  kickScored?: NlAfterSirenScored;
  /**
   * after_siren_kicks.kick_effect — what the kick did to the RESULT.
   * Independent of kickScored and ANDed with it: "a goal after the siren"
   * is kickScored alone, "a goal after the siren TO WIN" is both.
   */
  kickEffect?: NlAfterSirenEffect;
  /**
   * after_siren_kicks.kicker_result — the match result from the kicker's
   * side. Independent of kickEffect: one measured event is
   * (none, none, WIN). Never inferred from matches.winner_club_id.
   */
  kickerResult?: NlAfterSirenKickerResult;
  /**
   * "the first" / "the most recent". Match-linked only (D10 limit 1) —
   * see afterSirenRequiresMatchLink below.
   */
  occurrence?: NlAfterSirenOccurrence;
};
```

and on `NlQueryPlan`:

```ts
  /** after_siren only: which events, aggregated which way. */
  afterSiren?: NlAfterSiren;
```

**No new `NlAggregation` member.** `earliest`/`latest` are *not* added to the
shared aggregation union — that union is exhaustively switched by every grain and
widening it for one grain invites silent gaps elsewhere. The precedent is
`NL_ACHIEVEMENT_SUMMARY_KINDS`, which already carries `'earliest' | 'latest'` as
a *descriptor* value with a plain aggregation. `occurrence` follows it, and an
occurrence answer is a one-row `list`.

**One new metric,** deliberately singular:

```ts
  after_siren: {
    /**
     * A COUNT of after-siren events in the filtered set. There is exactly
     * one metric here on purpose: every distinction ("goals", "behinds",
     * "misses", "game winners", "winning goals") is a typed DIMENSION on
     * NlAfterSiren, not a second metric name. Two spellings of one question
     * is the ISSUE-110 failure this grain must not reintroduce.
     */
    siren_kicks: columnMetric('siren_kicks', 'Kicks after the siren', 'siren_kicks'),
  },
```

**`siren_kicks`, NOT `kicks` — this naming is load-bearing.** `NL_COVERAGE` is
keyed by metric name and already holds
`kicks: { firstSeason: 1965, note: 'Kicks were not recorded before 1965.' }` for
the player-statistic column. A metric literally named `kicks` would inherit that
1965 floor and **decline every after-the-siren question about 1913–1964** — 
including the measured first event, Billy Schmidt 1913 (§2.8). The rename removes
the collision; the grain-first branch below removes it a second time.

**Coverage.** A new `NL_COVERAGE` entry plus a grain-first branch in
`coverageFor`, mirroring the coaching one exactly (a metric-less `list`/`count`
plan must still get the floor):

```ts
  siren_kicks: {
    firstSeason: 1913,
    note: 'AFLDB\'s after-the-siren record begins in 1913.',
    grains: ['after_siren'],
  },
```

```ts
  if (grain === 'after_siren') return NL_COVERAGE.siren_kicks ?? null;
```

1913 is the measured first season (§0.2). It is a **floor and nothing more**: it
says a 1900 after-siren question has no answer, and makes **no** completeness
claim for any season after it. See §15.18 for the permanent caveat that carries
the rest of that honesty into the rendered answer.

**Fields this grain refuses BY NAME** in `validatePlan` (the ISSUE-110
discarded-scope rule; each is listed rather than left to a general check):
`coach`, `coachQualifier`, `scope.matchup`, `scope.venue`, `scope.roundNumber`,
`scope.playerIdIn`, `careerConditions`, `careerPredicates`,
`clubSeasonConditions`, `achievementSummary`, `headToHead`, `streakDefinition`,
`periodSplit`, `scoreCheckpoint`, `resultFilter`, `debutGame`, `havingClause`,
`matchFilter`, `boundary`, `mode`.

**Fields it consumes:** `player`, `scope.clubFor`, `scope.clubAgainst`,
`scope.seasonMin`, `scope.seasonMax`, `scope.matchType`, `metric`, `agg`,
`metricCondition`, `afterSiren`, `tiePolicy`, `limit`.

**The D10 boundary as one exported function**, so the rule lives in exactly one
place and both `validatePlan` and the compiler read it:

```ts
/**
 * D10 (§7.1) limit 2, and limit 1. TRUE when the question needs something
 * `matches` owns — finals/round_type, canonical date, canonical match
 * identity — or needs a deterministic chronology, which `after_siren_kicks`
 * alone cannot provide: round_raw is free text ('GF', 'round 1', 'round 3'
 * all occur on non-premiership rows) and gives no within-season order.
 *
 * A match-unlinked row is EXCLUDED from these answers and included in
 * every other one. `premiership_season` alone is never the gate.
 */
export function afterSirenRequiresMatchLink(plan: NlQueryPlan): boolean {
  return plan.scope.matchType !== undefined
    || plan.afterSiren?.occurrence !== undefined;
}
```

**Hand-maintained lists that must gain the grain.** `GRAIN_LABEL`,
`GRAIN_SUBJECT` and `TIE_ENTITY` in `describe.ts` are `Record<NlGrain, string>`
and so are compiler-enforced (`tsc` fails without them):
`after_siren: 'after the siren'` / `'kick'` / `'kick'`. The `grains` array inside
`validatePlan` is **not** compiler-enforced — a plain literal array. Omitting
`'after_siren'` there fails closed (every plan rejected as an unknown grain)
rather than opening a hole, and `tests/nl-plan.test.ts` catches it, but it is
named here because it is the one addition `tsc` will not find.

### 15.2 Answer payload shape

Two payload variants plus reuse of the existing `count`, because an event list
and a player leaderboard are genuinely different shapes:

```ts
  | { kind: 'after_siren_event'; lead: NlAfterSirenEventRow | null; rows: NlAfterSirenEventRow[]; total: number }
  | { kind: 'after_siren_player'; lead: NlAfterSirenPlayerRow | null; rows: NlAfterSirenPlayerRow[]; total: number }
```

```ts
/**
 * One curated after-siren event. Match-owned fields (matchId, matchDate,
 * roundType) are NULL for a match-unlinked row and are never filled from
 * after_siren_kicks — season and round_raw are that row's own facts and
 * are not a substitute for a canonical match (D10 §7.1).
 */
export type NlAfterSirenEventRow = {
  eventId: number;
  season: number;
  /** The source's own round string, verbatim. Displayed as recorded, never parsed. */
  roundRaw: string;
  competition: string;
  premiershipSeason: boolean;
  /** NULL when the source's kicker never linked to a player (6 of 126 measured). */
  playerId: number | null;
  playerSlug: string | null;
  /** Always present: the source's own spelling, shown when playerId is null. */
  playerName: string;
  clubName: string;
  clubSlug: string | null;
  opponentName: string;
  opponentSlug: string | null;
  kickScored: 'goal' | 'behind' | 'none';
  kickEffect: 'won' | 'drew' | 'none';
  kickerResult: 'win' | 'draw' | 'loss';
  /**
   * RENDERING ONLY (see §15.18 and the D13 confirmation in §15.21): fed to
   * the existing afterSirenEventLabel so the NL answer words an event the
   * same way every other AFLDB surface does. Not a parser dimension, not a
   * plan field, not filterable.
   */
  siren: 'final' | 'end_of_regulation' | 'end_of_extra_time';
  matchId: number | null;
  matchDate: Date | null;
  roundType: string | null;
  /** false when the source row carried no reference (1 of 126 measured). */
  cited: boolean;
  value: number | null;
};

/** One kicker, aggregated over the filtered events. Trusted link only. */
export type NlAfterSirenPlayerRow = {
  playerId: number; slug: string; displayName: string;
  /** The count of qualifying events. Measured ceiling is 2. */
  value: number;
  firstSeason: number; lastSeason: number;
  /** The clubs the player kicked for WITHIN the filtered set, not their career clubs. */
  clubNames: string | null;
};
```

`shot_detail`, `supergoal_scoring`, `kicker_score_raw`, `opponent_score_raw`,
`kicker_points`, `opponent_points`, `link_status_value`, `candidate_count`,
`source_id`, `source_record_id` and `notes` are **not** selected and **not**
rendered. D5 excludes `shot_detail`; the rest are provenance or verbatim source
figures (one 1944 row's goals.behinds does not add to its stated points — 089's
own comment) that a natural-language answer must not present as a computed fact.

`describeAnswer`'s `compatible` check gains the two exceptions, exactly as
`coach_record`/`count` did:

```ts
    || (plan.grain === 'after_siren'
        && (payload.kind === 'after_siren_event' || payload.kind === 'after_siren_player'
            || payload.kind === 'count'))
```

`payloadTotal` in `answer.ts` gains both new kinds.

### 15.3 Compiler / query ownership

**New file `src/db/queries/nl/after-siren.ts`**, exporting
`answerAfterSiren(plan, limit)`, wired into `execute.ts`'s switch (which is
exhaustive over `NlGrain`, so `tsc` demands the case).

It is **not** a second derivation of the existing read model, but nor is it a
parameterised copy of it: `getAfterSirenRecords` in `src/db/queries/after-siren.ts`
is the Records board, whose five-CTE first/last-attempt/first/last-goal shape
answers a different question. What the NL compiler **shares verbatim** with it,
and must not re-decide:

- the trusted-link rule (`player_id IS NOT NULL`, and — because
  `after_siren_kicks_link_ck` already binds them —
  `link_status_value IN ('unique','resolved')` stated explicitly anyway);
- `COALESCE(cl.name, a.club_name_raw)` / `COALESCE(op.name, a.opponent_name_raw)`
  club naming, and the `clubSlug`/`opponentSlug` null-when-unresolved convention;
- `LEFT JOIN matches m ON m.id = a.match_id` as the ONLY route to a canonical
  match property.

**Ownership, encoded structurally rather than by convention:**

- The base relation is `after_siren_kicks a`, alone. Every dimension, the season,
  both raw club names, the competition, the `premiership_season` flag and the
  citation come from it and from nothing else.
- `matches` is joined `LEFT` and is used **only to project** `match_date` and
  `round_type`. When `afterSirenRequiresMatchLink(plan)` is true — and only then
  — the compiler additionally emits `a.match_id IS NOT NULL`, promoting the join
  to an effective inner join and excluding unlinked rows.
- `a.premiership_season` is emitted as a filter **only** when the question asks
  for a canonical match property (i.e. together with `matchType`). It is never
  emitted merely to make a match link likely. D10 is explicit that `match_id`
  must not be required because an event is premiership-season, and the converse
  discipline applies here.
- **`round_raw` is never read as a filter, by any code path in this compiler.**
  It is projected for display and nothing else. The witness is §2.6's Kerry Good,
  1980, `round_raw = 'GF'`, North Melbourne v Collingwood, **Escort
  Championships, `premiership_season = false`** — any round- or finals-shaped
  filter that reads `round_raw` returns that row as a Grand Final. This is why
  D4 makes round-level scope decline and why finals scope goes through
  `matches.round_type` / `matches.is_finals_series`.
- All SQL is parameterised. Every enum value reaching SQL is bound, and is one of
  the closed union members above, never text from the question. Metric lookup
  goes through a closed `switch` in the compiler, the same discipline
  `coach-record.ts` applies.

Four query shapes, one per plan shape:

| Plan | SQL |
|---|---|
| `subject:'event'`, `agg:'list'` | event rows, `ORDER BY a.season DESC, a.id DESC` (the order `getPlayerAfterSirenEvents` already uses), `LIMIT` |
| `subject:'event'`, `agg:'count'` | `count(*)` over the filtered events → `{kind:'count'}` |
| `subject:'event'`, `occurrence` | one event row, `ORDER BY m.match_date ASC|DESC, a.id ASC|DESC`, `LIMIT 1`, match-linked only |
| `subject:'player'`, `agg` max/min/top_n/list/count | group by `a.player_id`, `count(*) AS value`, `rank() OVER (ORDER BY value DESC|ASC)` with no `PARTITION BY`, every row at the lead rank returned |

### 15.4 Parser vocabulary and precedence

**Cue gate**, mirroring `COACH_CUE_RE` — nothing in the after-siren vocabulary is
tried until this matches, because `goals`, `behinds`, `points`, `won` and `drew`
all name other things:

```ts
export const AFTER_SIREN_CUE_RE =
  /\bafter the siren\b|\bafter-the-siren\b|\bpost[- ]siren\b|\bon the siren\b|\bas the siren (?:sounded|went)\b|\bsiren\b/;
```

The bare `\bsiren\b` alternative is last and is safe: no other AFLDB concept in
the vocabulary uses the word, and the same shape already works for `\bcoach\b`.

**Dimension vocabulary**, tried only once the cue has matched:

```ts
export const AFTER_SIREN_SCORED_WORDS: [RegExp, 'goal' | 'behind' | 'none'][] = [
  [/\bgoals?\b|\bmajors?\b|\bsnags?\b|\bsausages?\b/, 'goal'],
  [/\bbehinds?\b|\bminors?\b|\bpoints?\b/, 'behind'],
  [/\bmiss(?:ed|es|ing)?\b|\bfell short\b|\bout on the full\b|\bsprayed\b|\bfailed to score\b|\bdid ?n.?t score\b/, 'none'],
];

export const AFTER_SIREN_EFFECT_WORDS: [RegExp, 'won' | 'drew' | 'none'][] = [
  [/\bto win\b|\bwinner\b|\bgame[- ]winner\b|\bmatch[- ]winner\b|\bwinning\b|\bto snatch (?:the )?(?:win|victory)\b|\bto steal (?:the )?(?:win|victory)\b/, 'won'],
  [/\bto draw\b|\bto tie\b|\bto level (?:the )?(?:scores?|match|game)?\b|\bfor a draw\b/, 'drew'],
];

export const AFTER_SIREN_RESULT_WORDS: [RegExp, 'win' | 'draw' | 'loss'][] = [
  [/\band (?:still )?won\b|\bin a win\b|\bwon anyway\b|\band (?:their|his) (?:side|team) won\b/, 'win'],
  [/\band (?:still )?lost\b|\bin a loss\b|\bin a losing\b|\band (?:their|his) (?:side|team) lost\b/, 'loss'],
  [/\bin a draw\b|\band drew\b|\bin a drawn (?:match|game)\b/, 'draw'],
];

export const AFTER_SIREN_OCCURRENCE_WORDS: [RegExp, 'first' | 'most_recent'][] = [
  [/\bmost recent\b|\blatest\b|\bthe last\b|\bwhen was the last\b|\bmost recently\b/, 'most_recent'],
  [/\bfirst\b|\bearliest\b|\bwhen was the first\b/, 'first'],
];
```

**Order within each list matters** and follows the `COACH_METRIC_WORDS`
precedent: `to win` before the bare `winning`; the multi-word miss idioms before
the bare `missed`.

**`AFTER_SIREN_RESULT_WORDS` is tried BEFORE `AFTER_SIREN_EFFECT_WORDS`**, so
"missed after the siren and lost" reads `kickerResult='loss'` and does not have
"lost" mistaken for anything else; and "and won" is not read as `kickEffect='won'`
— the two are semantically different and §2.1's `(none, none, win)` event proves
it. Whichever list matches first claims and strips its phrase.

**Placement in `parseNlQuestion`: a new step 5d, immediately after Phase B's
step 5c (coaching) and before match-type extraction.** The constraints:

- **After season extraction**, so a year is never read as a dimension token.
- **Before `extractPlayerMetric` / `extractCareerConditions` / `extractTeamMetric`
  / the club-season extractors.** This is *the* critical precedence rule of
  Phase C: `goals` must be claimed as the `kickScored` dimension and never as the
  `player_match_stats` goals metric, or "who has kicked the most goals after the
  siren" answers with a career-goals leaderboard. The block therefore suppresses
  those extractors for the rest of the parse exactly as `coachReading` does
  (`playerMetricResult`/`teamMetricResult`/`clubSeasonCuePresent` short-circuit).
- **Before, but not consuming, `extractMatchType`.** Unlike coaching — where
  "finals" and "grand finals" were coaching *metrics* — here finals is genuine
  match SCOPE (D4). The after-siren block must therefore **leave** "finals" /
  "grand final" in the text for `extractMatchType` to claim as `scope.matchType`.
  This is an explicit inversion of the Phase B rule and is called out because
  copying Phase B verbatim would break D4.
- **Player mention resolution is untouched.** See §15.5.

**Mutual exclusion.** If `COACH_CUE_RE` and `AFTER_SIREN_CUE_RE` both fire, the
question declines (`status:'none'`, reason `'unrecognised'`) with the note
"AFLDB cannot combine a coaching question with an after-the-siren question."
Fail closed; neither grain owns the other's fields.

**Subject election** (`event` vs `player`), decided in the block and asserted by
test:

- `subject = 'player'` when the aggregation resolves to `max`/`min`/`top_n`, or a
  `metricCondition` was consumed, or an explicit player-subject cue is present
  (`which player`, `who has kicked the most`, `players who`).
- `subject = 'event'` otherwise — including a named `player` with a `list`
  aggregation ("Barry Hall's goals after the siren" is his events, not a
  one-row leaderboard), every `count`, and every `occurrence`.

**Structural gate.** `structuralOk` for this grain is
`afterSiren !== undefined` — the cue matched and a descriptor was built. A bare
"siren" with nothing else still declines through the ordinary confidence gate.

### 15.5 Player resolution behaviour

- **No new directory.** Unlike coaching — where 18 of 386 people have no player
  row and the identity spaces differ — an after-siren kicker **is** a player.
  Resolution goes through the existing `ctx.resolvePlayer` path, unchanged.
- **`scope.playerIdIn` is REFUSED for this grain.** The ambiguous-surname
  ranking path (parser v9) exists so a real tie decides between candidates. Here
  the measured metric ceiling is **2** and *every* superlative is already a tie
  (§7.3), so ranking across an ambiguous surname over a 126-row curated list
  would present a coin flip as a record. Fail closed; the question declines.
- **A resolved player with no after-siren row is an honest EMPTY result**, not a
  decline: "No after-the-siren kick recorded for <name>." AFLDB knows the player
  and knows the curated list; the answer is nobody.
- **The 6 unlinked source kickers are never reachable by a player mention.** A
  question naming one resolves through `players` and finds either nothing or a
  different person. Those rows remain valid **event** evidence and appear in
  every `subject:'event'` answer under their source spelling
  (`player_name_raw`), unlinked and unlinkable — the §15.18 caveat says so.
- A `player` plus `subject:'player'` is refused: a leaderboard of one is not a
  ranking. A named player takes `subject:'event'`.

### 15.6 Club / opponent lineage handling

- `scope.clubFor` = the **kicker's** club. `scope.clubAgainst` = the **opponent**.
  Both may be present at once ("Fremantle goals after the siren against
  Richmond").
- Both fold the full `organization_id` lineage, exactly as the club page and
  `coach-record.ts` do:

```sql
  a.club_id IN (SELECT id FROM clubs WHERE organization_id = $org)
  a.opponent_club_id IN (SELECT id FROM clubs WHERE organization_id = $org)
```

- **The lineage witness is measured and must be a test**: §2.5's four goals
  against the Richmond organization include **Bill Wood, Footscray, 1946**
  (event 16, match 4486). A raw `club_id` comparison would drop it. "Against the
  Western Bulldogs" must likewise reach the Footscray era, and nothing of
  Fitzroy's ever reaches Brisbane Lions — a merger is a different organisation.
- `scope.matchup` is **refused**: a curated event names one side as the kicker,
  and a symmetric two-club reading is not a thing this table owns.
- **Rows with an unresolved club.** `club_id` and `opponent_club_id` are
  nullable. A club-scoped answer counts only rows whose club id resolved, and if
  any in-scope row did not, the caveat says how many were excluded. **The number
  of such rows is not measured** — see gap **M7** in §15.20; the pre-implementation
  addendum query in §15.19 must be run before this behaviour is finalised.

### 15.7 Linked versus unlinked row rules (D10, §7.1, encoded)

`afterSirenRequiresMatchLink()` is the whole rule. The table below is its
contract, and `tests/nl-plan.test.ts` asserts every row of it:

| Semantics | needs `match_id` | needs trusted player link |
|---|---|---|
| event `list` | no | no |
| event `count` | no | no |
| club / opponent totals | no | no |
| `kickScored` / `kickEffect` / `kickerResult` filters | no | no |
| season scope, `premiership_season` flag | no | no |
| player ranking / player count / `metricCondition` | no | **yes** |
| a named player's events | no | **yes** (the mention resolves to a player id) |
| finals / `round_type` scope (D4) | **yes** | no |
| `occurrence` first / most recent (D10 limit 1) | **yes** | no |
| canonical match date, venue, a `/matches/[id]` link | **yes** | no |

Two consequences stated so they cannot be quietly softened later:

1. **`match_id` is never required because a row is premiership-season.** The four
   2026 premiership rows with no match link (Zurhaar, Moore ×2, Membrey; §2.6,
   §7.4) are counted, listed, attributed to their clubs and their kickers, and
   classified on all three dimensions — everything except ordering and finals.
2. **When a match link IS required, the exclusion is stated, not silent.** The
   answer's caveat names how many recorded kicks were left out and why.

### 15.8 Finals handling

- `scope.matchType` is accepted and compiled from **`matches` only**:
  `'finals'` → `m.is_finals_series`; a literal round type → `m.round_type = $t`.
  `round_raw` is not consulted. `a.premiership_season` is emitted alongside as a
  belt-and-braces filter that makes the query self-evidently right (089's
  `after_siren_kicks_match_ck` already implies it).
- Any `matchType` — including `'home_and_away'` — sets
  `afterSirenRequiresMatchLink`, because `round_type` is a `matches` column.
- `scope.roundNumber` **declines** (D4): "AFLDB records an after-the-siren kick's
  round only as the source wrote it, so a round-number question cannot be
  answered." The Kerry Good 1980 `'GF'` row is why.
- **"After the siren in a Grand Final" returns an honest EMPTY result.** §2.7 is
  exhaustive: 8 premiership finals events, all match-linked — EF Shuey 2017; QF
  Smith 2016, King 1994, Brownless 1994; PF Lockett 1996, Ablett 1994, Buckenara
  1987; SF Jesaulenko 1972 — and **no VFL/AFL Grand Final after-siren event
  exists**. Returning the 1980 Escort Championships row instead is the single
  most likely wrong answer in this family and gets its own test.

### 15.9 Earliest / latest handling

- `occurrence` sets `afterSirenRequiresMatchLink` (D10 limit 1). The compiler
  orders by `m.match_date`, tie-broken by `a.id`, and takes one row.
- **No `season` + `round_raw` ordering is implemented, and none is proposed.**
  `round_raw` is free text — `'GF'`, `'round 1'`, `'round 3'` all occur — and
  gives no within-season order. The operator's D10 limit 1 requires a proven
  deterministic total ordering independent of `matches` before this changes;
  none is proven, so this stays match-linked.
- **The answer says so.** "Ordered by match date, so only the 116 after-the-siren
  kicks linked to a canonical match are considered; 10 recorded kicks have no
  match link and cannot be placed in order." (Counts computed at answer time from
  the filtered set, not hard-coded.)
- Measured witnesses (§2.8): first = event 1, Billy Schmidt, St Kilda v Carlton,
  1913-08-02, match 1313. Most recent = event 121, Nasiah Wanganeen-Milera,
  St Kilda v Melbourne, 2025-07-27, match 16792. The four 2026 unlinked rows
  **must not** win "most recent" — its own test.

### 15.10 Ranking, count and list semantics

- **Every superlative in this family is a tie.** §7.3 is exhaustive: max kicks 2,
  max goals 2, max winning kicks 2. `tiePolicy` is `'all'` and the ranked query
  uses `rank()` with no `PARTITION BY`, returning every row at the lead rank —
  the same shape every other grain uses. A "most goals after the siren" answer
  that names one player is wrong by construction.
  - "most goals after the siren" → **Barry Hall (1001) and Gary Rohan (4742)**,
    2 each (§2.4).
  - "most kicks after the siren" → **nine** players tied on 2: Hall, Rohan,
    Mundy, Riewoldt, Blight, Kernahan, Hawkins, McGovern, Johnson (§2.4).
- **`min` is REFUSED** for this grain: the set is *defined* by having at least one
  after-siren kick, so "fewest kicks after the siren" has no answer that means
  anything. Declines rather than returning everyone on 1. (Operator confirmation
  D15, §15.21.)
- `count`: over `subject:'event'`, the number of events; over `subject:'player'`,
  the number of distinct trusted-linked kickers.
- `list` over `subject:'event'`: ordered `season DESC, id DESC`, capped at
  `NL_LIMITS.maxListRows` (100). The whole family is 126 rows, so a list is
  genuinely bounded and the "showing N of M" line will rarely fire.
- `metricCondition` on `siren_kicks` requires `subject:'player'` and `agg:'list'`
  — the same rule `player_game`/`player_season` already enforce. Because the
  ceiling is 2, **"3 or more goals after the siren" is an honest empty result,
  not a decline**: the question is well-formed and the answer is nobody.

### 15.11 Goals versus behinds versus misses

- `kickScored` carries three distinct values that are never collapsed:
  `goal` | `behind` | `none`.
- **Absent `kickScored` means ANY kick, including a miss.** "Kicks after the
  siren" is 126 events, not the 101 that registered a score. Easy to get wrong,
  so it is asserted.
- **"Missed after the siren" is fixed to `kick_scored='none'` only.** A behind is
  colloquially also a miss, and 089's own comment records that a behind that left
  the kicker's side behind is `('behind','none')`. One reading is chosen — the
  column's own meaning, "the shot registered nothing" — and the rendered
  interpretation states which was answered, so a reader can see it. "Kicked a
  behind after the siren" reaches the behind reading through the behind/point
  vocabulary.
- Witnesses: `none/none` → event 125 (Dylan Moore 2026, unlinked) and, for a
  match-linked substitute, David King 1994 QF (event 48) and Alex Jesaulenko
  1972 SF (event 27) from §2.7. `behind/none` → event 126 (Tim Membrey 2026,
  unlinked); 21 premiership rows exist (§2.1).

### 15.12 `kick_effect` — won / drew / none

- `kickEffect` is what the kick did to the **result**, and is ANDed with
  `kickScored`, never merged into it.
- `'won'` **includes a winning behind** — 5 premiership + 1 non-premiership rows
  (§2.1). Match-linked witnesses: Michael Walters 2019 (event 103, match 15495)
  and Tony Lockett 1996 PF (event 51, match 11171).
- `'drew'` levelled the scores; witness Tom Hawkins 2017 (event 94, match 15114).
- `'none'` changed nothing, including a behind that left the side behind or level.
- **The binding distinction, with numbers.** Derived from §2.1 (exhaustive over
  126 events; the integration test re-proves each with its own hand-written SQL
  rather than pinning this arithmetic):

  | Reading | dimensions | all rows | premiership only |
  |---|---|---|---|
  | goal after the siren | `kickScored='goal'` | **71** | 67 |
  | goal after the siren **to win** | `kickScored='goal' AND kickEffect='won'` | **62** | 59 |
  | won a game with a kick after the siren | `kickEffect='won'` | 68 | 64 |
  | missed after the siren | `kickScored='none'` | 25 | 25 |
  | missed after the siren **and lost** | `kickScored='none' AND kickerResult='loss'` | 18 | 18 |

  The first two rows must return different numbers, and a test asserts the
  inequality directly.
- **The existing `after_siren_winner` grid builder is NOT wired in Phase C, and
  that is deliberate.** It compiles to
  `premiership_season AND kick_scored IN ('goal','behind') AND kick_effect='won'
  AND siren IN ('final','end_of_extra_time')` at `player_career` grain — i.e.
  precisely the *third* row of that table, "won a game with a kick after the
  siren", including a winning behind and premiership-only. It must never answer
  "kicked a goal after the siren" (67 vs 64, different populations). The
  `after_siren` grain answers that question with the right dimensions and the
  right caveats, and two routes to one question is exactly the collision F3
  warns about. The builder is left untouched and unreferenced. (Operator
  confirmation D14, §15.21.)

### 15.13 `kicker_result` semantics

- The match result **from the kicker's side**, read from the source's own final
  score at import time. Never inferred here from `matches.winner_club_id`, from
  `scores`, or from `player_match_stats` — the "no inferred facts" rule.
- **Independent of `kickEffect`, with an exhaustive witness**: §2.1 row 7 is
  premiership, `kick_scored='none'`, `kick_effect='none'`, **`kicker_result='win'`**
  — a player who scored nothing after the siren and whose side won anyway. So
  "missed after the siren and lost" (18) is strictly narrower than "missed after
  the siren" (25), and the two must never compile to the same predicate.
- The `none/none` group splits 18 loss / 6 draw / 1 win, all measured.

### 15.14 Explicit decline cases

Each declines, or emits a plan that `validatePlan` refuses. Each gets a corpus
row and an acceptance-test entry.

| # | Form | Why |
|---|---|---|
| C-D1 | "after-siren goals in round 1" | round-level scope declines (D4); `round_raw` is free text |
| C-D2 | "goals after the siren at the MCG" | venue is a `matches` property not exposed for this grain |
| C-D3 | "Richmond v Carlton after the siren" | `scope.matchup` not owned |
| C-D4 | "which coach won most games on a goal after the siren" | coaching cue + siren cue; fail closed |
| C-D5 | "fewest kicks after the siren" | `min` refused — the set is defined by having ≥1 |
| C-D6 | "goals after the siren in 1900" | coverage floor 1913 |
| C-D7 | "most after-siren goals in a season" | no per-season after-siren grain (the coaching `inOneSeason` rule) |
| C-D8 | "after the siren in extra time" / "before extra time" | siren subtype not exposed (D5); single witnesses, nothing rankable |
| C-D9 | "who kicked it out on the full after the siren" / "who fell short" | `shot_detail` not exposed (D5) |
| C-D10 | "how much did they win by after the siren" | verbatim source scores, not a computed fact |
| C-D11 | "after the siren in the NAB Cup" | competition-name filtering not exposed; only the `premiership_season` flag |
| C-D12 | "Ablett after the siren" (ambiguous surname) | `scope.playerIdIn` refused; every superlative is already a tie |
| C-D13 | "300-game players who kicked a goal after the siren" | cross-grain career predicate; not owned by this grain |
| C-D14 | "was it a supergoal after the siren" | `supergoal_scoring` not exposed |
| C-D15 | "did the siren sound before the kick" | out of family |

**Not a decline** — supported, and included as a positive combination test:
"who has kicked the most goals after the siren for Richmond in the finals since
2000" (finals ⇒ match-linked, club lineage, season range, player subject).

### 15.15 Red-before-green test matrix

Existing suites are extended; **one** new file is created, because no existing
suite is a sensible semantic home for a DB-backed after-siren comparison.

| Suite | What it covers |
|---|---|
| `tests/nl-parser.test.ts` | cue gating, dimension vocabulary and its order, metric-extractor suppression, subject election, occurrence words, coach/siren mutual exclusion, every §15.14 decline |
| `tests/nl-plan.test.ts` | `validatePlan` ownership — every refused field by name; the §15.7 table; `afterSirenRequiresMatchLink` derivation; `min` refused; metric/agg/threshold combinations; `siren_kicks` vs `kicks` coverage non-collision |
| `tests/nl-describe.test.ts` | headline and interpretation for all four shapes; tie wording; the three caveats; that "goal after the siren" and "goal after the siren to win" produce different sentences |
| `tests/nl-audit-acceptance.test.ts` | a new `describe` block in the Phase B coaching style: supported forms → intended plan; §15.14 forms → decline or failed validation |
| `tests/nl-ui-corpus.test.ts` | shape assertions for the two new CSVs |
| `tests/integration/nl-answers-after-siren.test.ts` | **NEW.** DB-backed, every assertion compared against independently hand-written SQL |
| `tests/integration/database.test.ts` | `after_siren: true` added to `SUPPORTED_NL_GRAINS` |

**The genuine red-before-green sequence.** Each step must be *observed* failing
before the code that makes it pass is written:

- **R0 — the current-behaviour probe, first, before any edit.** Run
  "who has kicked the most goals after the siren", "how many goals after the
  siren have there been" and "goal after the siren to win" through the current
  parser and record the verbatim outcome. If any **answers** — most plausibly by
  claiming `goals` as the `player_match_stats` metric and ranking career goals
  while "after the siren" survives only as leftover tokens under the confidence
  gate — that is a **live false-answer defect** and is recorded as a new Finding
  (the F2 analogue for this family), with the failing assertion written first.
  If all three decline, the tests assert the decline first and are flipped when
  the grain lands. **This probe is not optional and its result is not assumed
  here.**
- **R1** — `after_siren` added to `SUPPORTED_NL_GRAINS` ⇒ `database.test.ts`
  fails against `afldb_test` ⇒ migration 093 written ⇒ passes. This is the F5
  mechanism working as designed (§15.20).
- **R2** — parser tests for each vocabulary form, written before the vocabulary.
- **R3** — the two inequality tests (goal ≠ goal-to-win; miss ≠ miss-and-lost),
  written before the dimensions exist.
- **R4** — the Grand Final empty-result test, written before finals scope exists;
  it must fail loudly if the Kerry Good 1980 row is ever returned.
- **R5** — the "most recent" test, written before `occurrence` exists; must
  return event 121 and never a 2026 unlinked row.
- **R6** — the tie tests (Hall + Rohan; the nine on 2), written before ranking.
- **R7** — the parity test against `getAfterSirenRecords`, written before the
  compiler: for every player, the NL compiler's unfiltered per-player count must
  equal that function's `attempts`, and its `kickScored='goal'` count must equal
  `goals`. Two independent code paths agreeing on the overlapping question.

### 15.16 DB-backed hand-written-SQL witnesses

All from `ISSUE-152-nl-evidence-output.txt` (`afldb_test`, 2026-09-08,
read-only). The integration suite re-derives every count with its own SQL; the
numbers below are the expected values, not the source of truth.

| Question | Expected | Evidence |
|---|---|---|
| most goals after the siren | Barry Hall (1001) **and** Gary Rohan (4742), 2 each, tied | §2.4, §7.3 |
| most kicks after the siren | nine players tied on 2 | §2.4 |
| 3+ goals after the siren | **empty** (ceiling is 2) | §7.3 |
| goals after the siren against Richmond | 4 — Bill Wood 1946 Footscray (16/4486), Karmichael Hunt 2012 (82/14091), David Mundy 2017 (92/15065), Noah Anderson 2022 (113/16122) | §2.5 |
| after the siren in a Grand Final | **empty**, never Kerry Good 1980 | §2.7, §2.6 |
| after the siren in finals | 8 events, all match-linked | §2.7 |
| the first kick after the siren | event 1, Billy Schmidt, 1913-08-02, match 1313 | §2.8 |
| the most recent goal after the siren | event 121, Nasiah Wanganeen-Milera, 2025-07-27, match 16792 — **not** a 2026 row | §2.8 vs §7.4 |
| how many kicks after the siren | 126 total; 121 premiership; 116 match-linked; 120 trusted-linked kickers | §0.1, §2.2, §2.3 |
| behind after the siren that won | Michael Walters 2019 (103/15495), 6 rows | §7.4, §2.1 |
| behind after the siren that drew | Tom Hawkins 2017 (94/15114), 3 premiership rows | §7.4 |
| goal after the siren vs goal to win | 71 vs 62 (67 vs 59 premiership) | §2.1 |
| missed after the siren vs missed and lost | 25 vs 18 | §2.1 |
| missed after the siren and still won | 1 event | §2.1 |
| kicks not linked to a player | 6 of 126 (5 cited, 1 uncited) | §2.3 |

Four of the six `(kick_scored, kick_effect)` witnesses in §7.4 are 2026 rows with
`match_id` NULL, so any test needing a match link takes the linked substitutes
named above — the point §5.3.B already makes.

### 15.17 Corpus additions (additive only)

Two new CSVs, same five columns and naming convention as Phase B's:

- `tests/nl-ui/corpora/afldb-ui-questions-after-siren-v1-<date>.csv` — ~80
  realistic questions, `expected_status=plan`, categories `siren_event_list`,
  `siren_player_rank`, `siren_club_scope`, `siren_opponent_scope`,
  `siren_finals`, `siren_occurrence`, `siren_count`, `siren_effect`,
  `siren_result`, `siren_miss`.
- `tests/nl-ui/corpora/afldb-ui-questions-after-siren-decline-v1-<date>.csv` —
  ~25 declines, at least one per §15.14 row plus phrasing variants.

The 1,435-row realistic and 60-row decline gates are **untouched** and are
re-asserted siren-free, the same assertion Phase B added for coaching.

### 15.18 Renderer wording

Two new tables in `NlAnswerSection.tsx`, following `CoachRecordTable`'s shape
including its `rows.length <= 1` suppression:

- **`AfterSirenEventTable`** — Season | Round (as recorded) | Player | Club |
  Opponent | What happened | Match.
  - "What happened" is the **existing** `afterSirenEventLabel`
    (`src/lib/after-siren-format.ts`), so an NL answer words an event exactly as
    the profile and records pages already do — "Goal after the siren to win",
    "Behind after the siren to draw", "Missed after the siren", "Missed before
    extra time".
  - Player: `playerPath` when `playerId` is non-null; otherwise the source
    spelling as **plain muted text**, never a link.
  - Match: `matchPath` only when `matchId` is non-null; an unlinked row shows
    "—" and **no fabricated date**.
  - Round shows `round_raw` verbatim under a header that says "as recorded", so
    a `'GF'` on a non-premiership row cannot read as a Grand Final.
- **`AfterSirenPlayerTable`** — Player | Kicks after the siren | Seasons | Clubs.

Headlines and interpretations (`describe.ts`), for the four shapes:

- player ranking — "Barry Hall and Gary Rohan — 2 goals after the siren (tied)"
- event count — "71 kicks after the siren"
- event list — "4 goals after the siren against Richmond"
- occurrence — "Billy Schmidt — St Kilda v Carlton, 2 August 1913"

**The interpretation must name every applied dimension in words**, so that
"a goal after the siren" and "a goal after the siren to win" are visibly
different answers on the page:

- `kickScored`: "that kicked a goal" / "that kicked a behind" / "that scored
  nothing"
- `kickEffect`: "and won the match" / "and levelled the scores" / "which did not
  change the result"
- `kickerResult`: "in a match their side won / drew / lost"

Three caveats:

1. **Always, on every after-siren answer:** "AFLDB's after-the-siren record is a
   curated, cited list of individual events, not a systematic record of every
   kick after every siren." The 1913 floor alone would imply a completeness this
   family does not have. (Operator confirmation D12, §15.21.)
2. **Player-subject answers:** "N of the M recorded kicks are not linked to a
   player and are not counted here." (6 of 126 measured.)
3. **Match-link-required answers:** "Only the N kicks linked to a canonical match
   can be ordered / scoped to finals; M recorded kicks have no match link."

Both counts are computed from the filtered set at answer time, never hard-coded.
Nothing exposes `shot_detail`, `supergoal_scoring` or the verbatim source scores,
and `siren` appears only inside `afterSirenEventLabel`'s existing sentence.

### 15.19 Pre-implementation measurement addendum (must run before §15.6 is final)

One read-only query, to close gap **M7**. It is the only measurement Phase C
needs that the Stage-0 pack did not take:

```sql
SELECT count(*) FILTER (WHERE club_id IS NULL)          AS club_unresolved,
       count(*) FILTER (WHERE opponent_club_id IS NULL) AS opponent_unresolved,
       count(*)                                          AS events
  FROM after_siren_kicks;
```

If either count is zero, §15.6's exclusion caveat is dead code and is dropped. If
not, the caveat ships and the excluded rows are named in the test matrix.

### 15.20 Schema and telemetry implications — the F5 analogue

**Migration 093 is expected to be REQUIRED, and the requirement is proven by a
failing test, not assumed.**

`nl_search_log.grain`'s CHECK currently lists nine grains (046 → 055 → 079 →
092). `after_siren` is the tenth. `logNlSearch` schedules its INSERT via
`after()` and deliberately swallows failures so telemetry can never break a
search — so without 093, **every after-siren answer renders correctly, HTTP 200,
right rows, right wording, while its telemetry row is rejected and dropped with
only a `console.error`.** That is exactly F5, and exactly what 055, 079 and 092
each repaired for an earlier grain.

Phase B's fix makes this self-detecting: `tests/integration/database.test.ts`
drives its accepted list from `Record<NlGrain, true>`, so adding
`after_siren: true` **fails the test first** (step R1). The migration is then
written, and only then does the test pass — genuine red-before-green for the
schema change, which is why the "no migration unless implementation proves one is
required" rule is satisfied rather than bypassed.

- File: `src/db/migrations/093_nl_search_log_after_siren_grain.sql`.
  **093 is free** — no `09[3-9]` migration exists on any local or remote branch
  (checked 2026-09-08). The migration naming/collision/checksum contract (36/36)
  re-checks this and must be run.
- Forward-only and **strictly widening**: all nine existing grains retained
  verbatim; the CHECK is not weakened, not dropped, not made `NOT VALID`; no
  existing row can fail the new predicate; `logNlSearch` unchanged.
- The contract test additionally keeps its "an unsupported grain is still
  REJECTED" assertion, so widening cannot become a formality, and gains
  `expect(inserted).toContain('after_siren')` beside `coach_record` so reverting
  093 fails by name.
- **Deploy ordering: 093 must reach `afldb_dev` and production BEFORE the code**,
  or it reproduces the silent-drop window it fixes. It joins 092 in the same
  ordering constraint — both migrations before the ISSUE-152 code.

**No other schema change.** `after_siren_kicks` (089) already carries every
column this grain reads; `SELECT afldb_meta.grant_app_read('after_siren_kicks')`
is already in 089, so the app-read fail-closed rule is satisfied and no
privileges change is needed. **No index change**: `ix_after_siren_kicks_effect`
is partial on `WHERE premiership_season` and will not serve a non-premiership
query, which over 126 rows is irrelevant — stated here so nobody adds one.

**Measurement gap M7** (unresolved club ids, §15.19) is added to the §5.3.G gap
list.

### 15.21 `PARSER_VERSION` bump point

**One bump, 35 → 36**, in the single commit that lands the behavioural wiring —
the vocabulary, the grain election and the plan emission together. Not in a
test-only commit, not in the migration-only commit, and not twice. A new entry is
added to the `PARSER_VERSION` doc block in `plan.ts`, in the style of 35, saying
exactly what version 36 covers: the tenth grain, the three independent typed
dimensions, the match-link boundary, and the metric-extractor precedence change
that stops "goals after the siren" being read as a career-goals ranking.

### 15.22 Files this phase touches

| File | Change |
|---|---|
| `src/search/nl/plan.ts` | grain, `NlAfterSiren`, plan field, `NL_METRICS.after_siren`, coverage entry + grain branch, `afterSirenRequiresMatchLink`, `validatePlan` block, `PARSER_VERSION` 36 |
| `src/search/nl/vocab.ts` | `AFTER_SIREN_CUE_RE` and the four word lists |
| `src/search/nl/parser.ts` | step 5d, extractor suppression, subject election, structural gate, mutual exclusion |
| `src/search/nl/answer-types.ts` | two row types, two payload variants |
| `src/search/nl/describe.ts` | grain label maps, `compatible` exceptions, four describe shapes, three caveats |
| `src/db/queries/nl/after-siren.ts` | **new** — the compiler |
| `src/db/queries/nl/execute.ts` | dispatch case |
| `src/db/queries/nl/answer.ts` | `payloadTotal` cases |
| `src/components/NlAnswerSection.tsx` | two tables |
| `src/db/migrations/093_nl_search_log_after_siren_grain.sql` | **new** — after R1 fails |
| `tests/*` | the §15.15 matrix |
| `tests/nl-ui/corpora/*after-siren*.csv` | **new** — two corpora |
| `issues/open/AFLDB-ISSUE-152.md`, `IssuesIndex.md`, `issues.md`, `CHANGELOG.md`, `docs/search.md` | tracking |

Not touched: `src/db/queries/after-siren.ts`, `src/lib/after-siren-format.ts`,
`src/db/queries/grid-solver.ts` (the `after_siren_winner` builder), migration 089,
the coaching implementation, the 1,435/60 corpora, and the four external
`afldb_test` snapshot-drift assertions in `tests/integration/database.test.ts`.

### 15.23 Operator decisions still required before Phase C is implemented

| # | Decision | Recommendation |
|---|---|---|
| **D12** | The 1913 coverage floor **plus** a permanent "curated, cited list, not a systematic record" caveat on every after-siren answer. A floor alone implies a completeness this family does not have. | **Approve both.** |
| **D13** | D5 says the siren subtype is not exposed. Reading: not a parser dimension, not filterable, not a plan field — but `siren` **is** selected and passed to the existing `afterSirenEventLabel` so an NL answer words an event exactly as the rest of the site does. | **Confirm this reading.** The alternative is a second, divergent wording for the same event. |
| **D14** | The `after_siren_winner` grid builder is deliberately **not** wired in Phase C, leaving one route to the question. | **Confirm.** Two routes to one question is the F3 collision. |
| **D15** | `min` aggregation refused for this grain ("fewest kicks after the siren"). | **Approve the refusal.** |
| **D16** | The §15.19 addendum query (unresolved `club_id` / `opponent_club_id`, gap M7) must be run against `afldb_test` before §15.6's lineage semantics are final. Read-only, operator-executed. | **Authorise the run.** |
| **D17** | Migration **093** authorised as Phase C work, on the same terms 092 was authorised for Phase B, and applied to `afldb_dev`/production **before** the code. | **Authorise.** |
| **D18** | The four 2026 rows may be an `afldb_test` artefact (its `matches` evidence stops in 2025). No test pins a 2026 row's *presence*; the "most recent must not be an unlinked row" test is robust either way. | **Confirm** that this is acceptable, or say the 2026 rows are to be treated as real. |
| **D19** | If the **R0 probe** shows the current parser *answers* an after-siren question with a career-goals ranking, that is a live false-answer defect. Is it recorded as a new Finding on ISSUE-152 (the F2 analogue) and fixed inside Phase C, or split out? | **Record it on ISSUE-152 and fix it in Phase C** — the grain is the fix. |

### 15.24 Stop condition

~~This section is a plan. Nothing is implemented, no test is written, no
migration exists, `PARSER_VERSION` is still 35, and no deployment is proposed.~~

**SUPERSEDED 2026-09-08.** D12–D19 were answered (D12 approved, D13 confirmed,
D14 confirmed, D15 approved, D16 authorised, D17 authorised, D18 confirmed, D19
recorded-and-fixed-here — though its condition did not fire, see §16.1), the
operator authorised implementation, and Phase C is implemented at
`PARSER_VERSION` 36 with migration 093. It is **not committed and not
deployed**. See §16.

---

## 16. Phase C — IMPLEMENTED 2026-09-08

**Status: IMPLEMENTED, focused validation green, NOT deployed, NOT committed.**
The operator approved §15 with decisions **D12–D19** (§15.23) and authorised
implementation in a fixed order. Everything below is what actually happened,
including the two places the plan was not followed and why.

`PARSER_VERSION` 35 → **36**, once, in the behavioural wiring.

### 16.1 R0 — the pre-implementation probe (D19 does NOT fire)

Run **before any edit**, through the current parser (v35) with a DB-free
context. All eight probes **declined**. No live false-answer defect exists, so
**D19's condition does not fire** and no F2-analogue finding is recorded.

| Question | Result | Consumed | Unsupported |
|---|---|---|---|
| Who has kicked the most goals after the siren? | `none` / low_confidence 0.40 | `most`, `goals` | `after siren` |
| how many goals after the siren have there been | `none` / low_confidence 0.22 | `how`, `many`, `goals` | `after siren there been` |
| goal after the siren to win | `none` / low_confidence 0.15 | `win` | `goal after siren` |
| most kicks after the siren | `none` / low_confidence 0.40 | `most`, `kicks` | `after siren` |
| when was the first goal after the siren | `none` / low_confidence 0.05 | `goal` | `when first after siren` |
| Barry Hall's goals after the siren | `none` / low_confidence 0.05 | `goals` | `barry hall after siren` |
| missed after the siren and lost | `none` / **unrecognised** 0.00 | — | `missed after siren lost` |
| goals after the siren for Richmond | `none` / low_confidence 0.40 | `richmond`, `goals` | `after siren` |

**The hazard §15.4 names is nonetheless confirmed, and is only masked.** The
player-metric extractor DID claim `goals`/`kicks` — see the `consumed` column —
and the wrong answer was suppressed solely by the 0.35 unresolved penalty on the
leftover `after siren` tokens. The moment a cue consumes those tokens that
penalty disappears. The step-5d precedence rule is therefore load-bearing, not
tidiness, and `tests/nl-parser.test.ts` asserts it directly ("goals is claimed
as the kickScored dimension, never as the career goals metric").

### 16.2 M7 — the §15.19 measurement (D16), and the caveat it retires

Read-only against `afldb_test`, 2026-09-08:

```
club_unresolved | opponent_unresolved | events
              0 |                   0 |    126
```

**Both counts are zero.** Every one of the 126 curated events has a resolved
`club_id` and a resolved `opponent_club_id`. Per §15.19's own instruction, the
§15.6 "rows with an unresolved club are excluded and the caveat says how many"
behaviour is **dead code and was not implemented**. Gap **M7** is closed as
measured, not carried.

The two exclusions that ARE real were measured at the same time and are wired:
**6 of 126** events have no trusted player link, **10 of 126** have no canonical
match. Both are computed at answer time from the filtered set (never
hard-coded) and surface as caveats only when non-zero.

### 16.3 Files changed

| File | Change |
|---|---|
| `src/search/nl/plan.ts` | tenth grain `after_siren`; `NlAfterSiren` + its five closed unions and their runtime lists; `NlQueryPlan.afterSiren`; `NL_METRICS.after_siren.siren_kicks`; `NL_COVERAGE.siren_kicks` (1913) + the grain-first branch in `nlCoverageFor`; exported `afterSirenRequiresMatchLink`; the `validatePlan` ownership block; the grain added to the three `Record<NlGrain, …>` maps and to the literal `grains` array; `PARSER_VERSION` 35 → 36 with a new doc entry |
| `src/search/nl/vocab.ts` | `AFTER_SIREN_CUE_RE`, `AFTER_SIREN_SCORED_WORDS`, `AFTER_SIREN_EFFECT_WORDS`, `AFTER_SIREN_RESULT_WORDS`, `AFTER_SIREN_OCCURRENCE_WORDS`, `AFTER_SIREN_KICK_NOUN_RE`, `AFTER_SIREN_PLAYER_SUBJECT_RE` |
| `src/search/nl/parser.ts` | step 5d; extractor suppression (team metric, career conditions, first-kick achievement, club-season, player metric); subject election; the after-siren aggregation default; the per-season refusal; the structural gate; coach/siren mutual exclusion |
| `src/search/nl/answer-types.ts` | `NlAfterSirenEventRow`, `NlAfterSirenPlayerRow`, `NlAfterSirenExclusions`, two payload variants |
| `src/search/nl/describe.ts` | `compatible` exceptions; four describe shapes; grain-aware `count` wording; exported `answerCaveats` |
| `src/db/queries/nl/after-siren.ts` | **new** — the compiler |
| `src/db/queries/nl/execute.ts` | dispatch case |
| `src/db/queries/nl/answer.ts` | `payloadTotal` cases; caveats wired into `buildAnswer` |
| `src/components/NlAnswerSection.tsx` | `AfterSirenEventTable`, `AfterSirenPlayerTable` |
| `src/db/migrations/093_nl_search_log_after_siren_grain.sql` | **new** |
| `tests/nl-parser.test.ts`, `tests/nl-plan.test.ts`, `tests/nl-describe.test.ts`, `tests/nl-audit-acceptance.test.ts`, `tests/nl-ui-corpus.test.ts`, `tests/integration/database.test.ts` | Phase C coverage |
| `tests/integration/nl-answers-after-siren.test.ts` | **new** — 20 DB-backed comparisons |
| `tests/nl-ui/corpora/afldb-ui-questions-after-siren-v1-20260908.csv` | **new** — 93 rows |
| `tests/nl-ui/corpora/afldb-ui-questions-after-siren-decline-v1-20260908.csv` | **new** — 27 rows |

Not touched, exactly as §15.22 requires: `src/db/queries/after-siren.ts`,
`src/lib/after-siren-format.ts`, the `after_siren_winner` grid builder,
migration 089, the Phase B coaching implementation, the 1,435/60 corpora, and
the four external `afldb_test` snapshot-drift assertions.

### 16.4 Supported after-the-siren question families

| Family | Example | Plan |
|---|---|---|
| event list | "goals after the siren" | `event`, `kickScored:'goal'`, `list` |
| any kick | "kicks after the siren" | `event`, no `kickScored` — 126 events, misses included |
| event count | "how many goals after the siren" | `event`, `count` |
| kicker ranking | "who has kicked the most goals after the siren" | `player`, `kickScored:'goal'`, `max` |
| top N kickers | "top 5 players by goals after the siren" | `player`, `top_n` |
| threshold | "3 or more goals after the siren" | `player`, `list` + `metricCondition` |
| effect | "goals after the siren to win" / "to draw" | `kickScored` **and** `kickEffect` |
| kicker result | "missed after the siren and lost" | `kickScored:'none'` + `kickerResult:'loss'` |
| miss | "missed after the siren" | `kickScored:'none'` only |
| club lineage | "goals after the siren for Richmond" | `scope.clubFor`, organization-folded |
| opponent lineage | "goals after the siren against Richmond" | `scope.clubAgainst`, organization-folded |
| finals | "goals after the siren in the finals" | `scope.matchType`, match-linked only |
| occurrence | "the first / most recent goal after the siren" | `occurrence`, match-linked only |
| named player | "Barry Hall's goals after the siren" | `player` + `event` subject |
| combined | "most goals after the siren for Richmond in the finals since 2000" | all of the above at once |

### 16.5 Explicit declines

Every §15.14 row declines, or emits a plan its own validator refuses. Measured
outcomes:

| # | Form | How it fails |
|---|---|---|
| C-D1 | "goals after the siren in round 1" | validation: fields the compiler cannot honour (`roundNumber`) |
| C-D2 | "goals after the siren at the MCG" | validation: venue not owned |
| C-D3 | "Richmond v Carlton after the siren" | validation: `matchup` not owned |
| C-D4 | "which coach won most games on a goal after the siren" | parser: `unrecognised`, mutual exclusion |
| C-D5 | "fewest kicks after the siren" | validation: "there is no fewest to rank" (D15) |
| C-D6 | "goals after the siren in 1900" | validation: 1913 coverage floor |
| C-D7 | "most goals after the siren in a season" | parser: `unrecognised`, no per-season grain |
| C-D8 | "goals after the siren in extra time" | parser: leftover `extra time` |
| C-D9 | "who kicked it out on the full after the siren" | parser: leftover `it out full` |
| C-D10 | "how much did they win by after the siren" | parser: leftover `how much they win` |
| C-D11 | "goals after the siren in the NAB Cup" | parser: leftover `nab cup` |
| C-D12 | ambiguous surname | `scope.playerIdIn` refused by name |
| C-D13 | "300 game players who kicked a goal after the siren" | parser: leftover `game` |
| C-D14 | "was it a supergoal after the siren" | parser: leftover |
| C-D15 | "did the siren sound before the kick" | parser: leftover `sound before` |

A bare "siren" also declines: the structural gate requires a dimension, a
subject noun, a scope or a player, so the cue alone never returns the whole
curated list.

### 16.6 Red-before-green proof

Each step was **observed** failing before the code that makes it pass existed.

| Step | Red | Green |
|---|---|---|
| **R1** telemetry | `after_siren` added to the type-derived `SUPPORTED_NL_GRAINS`; `afldb_test` rejected it — `new row for relation "nl_search_log" violates check constraint "nl_search_log_grain_check"` | migration 093 written and applied → passes, and `expect(inserted).toContain('after_siren')` names it |
| **R2** vocabulary | 14 parser assertions failing | step 5d |
| **R3** inequalities | goal ≠ goal-to-win, miss ≠ miss-and-lost, failing at both the wording and the SQL layer | typed dimensions |
| **R4** Grand Final | empty-result assertion failing | finals scope via `matches.round_type` |
| **R5** most recent | occurrence assertion failing | `occurrence` + match-link boundary |
| **R6** ties | Hall/Rohan and the nine-on-2 assertions failing | `rank()` with no `PARTITION BY` |
| **R7** parity | parity against `getAfterSirenRecords` failing | the compiler |
| plan ownership | 20 `nl-plan` assertions failing | the `validatePlan` block |
| describe | 11 `nl-describe`/acceptance assertions failing | the four describe shapes + `answerCaveats` |

**46 assertions were observed red across five suites before implementation
began.**

### 16.7 Validation

| Gate | Result |
|---|---|
| `tests/nl-parser.test.ts` | **218 passed** |
| `tests/nl-plan.test.ts` | **129 passed** |
| `tests/nl-describe.test.ts` | **43 passed** |
| `tests/nl-audit-acceptance.test.ts` | passed |
| `tests/nl-ui-corpus.test.ts` | **35 passed** |
| `tests/query-intent.test.ts`, `tests/migration-checksum.test.ts` | passed |
| DB-free NL total | **490 passed / 490** |
| `tests/integration/nl-answers-after-siren.test.ts` | **20 passed** (new) |
| `tests/integration/nl-answers-coaching.test.ts` + 5 other NL integration suites | **86 passed, 3 skipped** — Phase B coaching still green |
| `tests/integration/database.test.ts` — telemetry grain contract | **passed** after 093 |
| `npx tsc --noEmit` | clean |
| `eslint` on every changed file | no new errors; 4 `no-explicit-any` errors in `plan.ts` are **pre-existing** (present at `HEAD`, on the 13 live-only career stats), and the `_total`/`_rnk` unused-var warnings match `coach-record.ts`'s existing pattern |

`tests/integration/database.test.ts` still reports the **same four**
snapshot-drift failures documented in **§14.4.1** (694,445 vs 685,471 and its
three dependent counts). They are external, pre-existing, and were not
investigated or edited under this phase.

### 16.8 DB-backed integration results

All 20 assertions compare the compiler against **independently hand-written
SQL**; every §15.16 witness was re-measured and matched exactly.

| Question | Measured | Matches §15.16 |
|---|---|---|
| most goals after the siren | **Barry Hall and Gary Rohan**, 2 each | yes |
| most kicks after the siren | **nine** tied on 2: Hall, Johnson, Mundy, Rohan, Riewoldt, Blight, McGovern, Kernahan, Hawkins | yes |
| 3+ goals after the siren | **empty** (ceiling 2) | yes |
| goals after the siren against the Richmond lineage | **4** — Bill Wood 1946 **Footscray** (event 16, match 4486), Karmichael Hunt 2012, David Mundy 2017, Noah Anderson 2022 | yes |
| after the siren in a Grand Final | **empty**; the `round_raw = 'GF'` non-premiership row is asserted absent | yes |
| after the siren in finals | **8**, all match-linked | yes |
| first kick after the siren | event **1**, Billy Schmidt, 1913, match 1313 | yes |
| most recent kick | event **121**, Nasiah Wanganeen-Milera, 2025, match 16792 — never an unlinked later row | yes |
| total events | **126**; 6 with no player link, 10 with no match link | yes |
| goal vs goal-to-win | asserted strictly different, both against hand-written SQL | yes |
| miss vs miss-and-lost | asserted strictly different | yes |
| missed and still won | > 0 (the `(none, none, win)` witness) | yes |
| R7 parity | per-player kicks == `getAfterSirenRecords().attempts` and goals == `.goals` for **every** player, and the NL total equals the board's row count | new |

### 16.9 Corpus additions (additive only)

- `afldb-ui-questions-after-siren-v1-20260908.csv` — **93** rows across all ten
  §15.17 categories.
- `afldb-ui-questions-after-siren-decline-v1-20260908.csv` — **27** rows across
  all fourteen §15.14 decline families.

Every one of the 120 rows was executed through the **real** club/player
directory against `afldb_test` and behaves exactly as declared: 93 produce a
validated `after_siren` plan, 27 decline. The 1,435-row realistic gate, the
60-row decline gate and both Phase B coaching corpora are untouched and are
asserted siren-free.

### 16.10 Deviations from §15, and why

Three, all narrowing rather than widening.

1. **`out on the full` and `fell short` are NOT in `AFTER_SIREN_SCORED_WORDS`,
   though §15.4 lists them.** §15.4 and §15.14 C-D9 contradict each other: the
   vocabulary would map both phrases to `kick_scored='none'`, while C-D9
   requires them to decline because `shot_detail` is not exposed (D5). Resolved
   in favour of the **decline**, because mapping a shot_detail phrase to the
   coarser "registered nothing" answers a narrower question than the reader
   asked. Left unmatched, the words survive as leftover tokens and the ordinary
   confidence gate declines — the same fail-closed mechanism every other
   unsupported term uses. `sprayed`, `missed`, `failed to score` and `didn't
   score` are kept: none names a shot_detail value.

2. **The §15.6 unresolved-club caveat was not implemented.** M7 measured zero
   unresolved club ids and zero unresolved opponent ids, and §15.19 says
   explicitly that in that case the caveat is dead code and is dropped.

3. **Two small vocabulary/parser additions §15.4 did not anticipate**, both
   found by executing the corpus rather than by inspection, and both fixing a
   question the engine understood completely and then declined:
   - `AFTER_SIREN_KICK_NOUN_RE` (`kicks`/`attempts`/`shots`), consumed with no
     dimension set. Without it "kicks after the siren" left its own subject noun
     as an unexplained leftover. It is consumed a second time after a dimension
     word claims the first pass, so "kicks after the siren that missed" works.
   - The hyphenated compounds `match-winning` / `game-winning` are listed WHOLE
     in `AFTER_SIREN_EFFECT_WORDS`, before the bare `winning`. A hyphenated form
     is ONE token to `meaningfulTokens`, so consuming half of it left the whole
     compound counted as a leftover.

   A fourth candidate was deliberately NOT added: "every goal after the siren"
   still declines on the leftover word `every`, because making `every` an
   aggregation cue would change behaviour for all ten grains and is outside this
   phase. Those phrasings were removed from the corpus rather than forced.

### 16.11 Migration 093

`src/db/migrations/093_nl_search_log_after_siren_grain.sql` — forward-only,
strictly widening. All nine grains 092 accepted are retained verbatim; the
CHECK is not weakened, dropped without replacement, or made `NOT VALID`; no
existing row can fail the new predicate. No other schema, data, privilege or
index change. Applied to `afldb_test` on 2026-09-08 (93 files, 92 previously
applied, 1 applied in 240 ms); the migration naming/collision/checksum contract
passes.

**Deploy ordering, unchanged from §15.20: 093 must reach `afldb_dev` and
production BEFORE the Phase C code**, or it reproduces the silent
telemetry-drop window it exists to close. It joins 092 under that constraint —
both migrations before the ISSUE-152 code.

### 16.12 Phase C — TECHNICALLY COMPLETE 2026-09-08

Implemented, focused validation green, **not committed, not deployed, no
rendered/browser run, no `npm run build`, no `nl:stress` sweep**. Phases D–F are
untouched and have not started. ISSUE-152 stays **OPEN**.
---

## 17. Phase E — first-kick-goal closure implementation plan (SUPERSEDED BY §18)

> **Status 2026-09-09: this plan has been IMPLEMENTED and is retained as the
> design record only.** What was actually built, where it deviated, and the
> validation that accepted it are in **§18**. Read §18 first; where the two
> disagree, §18 is authoritative.


Phase E is **gap closure over an already-supported family**, not a redesign. It
adds **no grain, no compiler, no query file and no SQL**: every fact it exposes
is already implemented, parameterised, lineage-correct and grid-tested. The work
is parser wiring, ownership, declines, wording and — the expensive half — the
**D11 DB-backed acceptance** the family has never had (**F4**).

### 17.1 Already supported — must NOT be re-implemented

Verified in code, not assumed. Nothing below is touched except where §17.2 says so.

| # | Subfamily | Where it already lives | Regression proof today |
|---|---|---|---|
| E1 | "who kicked a goal with their first kick" | `FIRST_KICK_GOAL_RE` (`vocab.ts:857`) -> `extractFirstKickGoal` (`parser.ts:388`) -> `NL_ACHIEVEMENTS.first_kick_goal.builder` (`plan.ts:428`) -> `first_kick_goal_player` (`grid-solver.ts:992`) | `nl-parser.test.ts` §14 |
| E2 | club-scoped | `parser.ts:2455` pushes `first_kick_goal_for_club` (`grid-solver.ts:1017`, lineage by `organization_id`) | `nl-parser.test.ts` §14, `nl-plan.test.ts:251` |
| E3 | season/decade-scoped | `parser.ts:2458` pushes `first_kick_goal_between` (`grid-solver.ts:1027`) | `nl-parser.test.ts` §14, `nl-plan.test.ts:229` |
| E4 | earliest / most recent | `ACHIEVEMENT_SUMMARY_CUES` (`vocab.ts:884`) `earliest`/`latest` -> `achievement_summary` | `nl-parser.test.ts` §14 |
| E5 | by club / decade / season / clubs-without | same cue list -> `achievement-summary.ts` | `nl-parser.test.ts` §14/§15 |
| **E6** | **first-kick goal by `<player>`** | **already works end to end**: `parser.ts` pins `plan.player`, `validatePlan` accepts it, and `conditionsWhere` (`player-career.ts:143`) ANDs `p.id = ${plan.player.id}` with `compileAxis` (`player-career.ts:213`). The file's own comment records the bug that made it so ("did Dustin Martin kick a goal with his first kick" once listed every holder). | `nl-parser.test.ts:1035` "a named player stays pinned to the plan" |

**Correction to §5.1.** E6 is marked GAP-SAFE in the coverage matrix. On the
code as it stands that is **wrong**: the semantic path exists and is tested. E6's
only genuine deficits are (a) it has never been proven against data (**F4**), and
(b) its *answer wording* is a bare list headline (§17.12, decision **E-D1**).
Phase E therefore **does not add a second E6 path**; it proves the existing one
and, if E-D1 is approved, improves only the rendered sentence.

### 17.2 What is actually missing

| # | Missing | Cause | Fix |
|---|---|---|---|
| **E7** | "kicked a goal with each of their first three kicks" | `FIRST_KICK_GOAL_RE` cannot match the phrase (the numeral and "each of" sit between "first" and "kicks"), and nothing in the NL layer emits `first_kick_goal_consecutive_min` | new vocabulary + one `careerPredicates.push` |
| **E8** | "whose first-kick goal was their only career goal" | the phrase *is* matched, but the tail ("only career goal") is left in the text, where `extractPlayerMetric`/`extractCareerConditions` (`parser.ts:1084`, `:606`) read "goal" as the ranking subject — a silent misread, not a decline; and nothing emits `first_kick_goal_only_career_goal` | new cue consumed inside step 5a + one push |
| E6r | E6 residuals | §17.1 | proof (§17.10) + wording (E-D1) |
| **E9** | `no_further_career_kicks`, `kickless_matches_before_first_kick` | deliberate | stays declined, and is now **explicitly** declined (§17.7) |

Everything else in family E stays exactly as it is.

### 17.3 Exact reuse inventory

No new SQL is written in Phase E. The four artefacts below are consumed verbatim:

| Reused | Path | Role in Phase E |
|---|---|---|
| `first_kick_goal_consecutive_min` | `grid-solver.ts:1001` — `consecutive_goal_kicks >= $kicks`, linked rows only | the E7 predicate |
| `first_kick_goal_only_career_goal` | `grid-solver.ts:996` — `no_further_career_goals`, linked rows only | the E8 predicate |
| `first_kick_goal_player` / `_for_club` / `_between` | `grid-solver.ts:992/1017/1027` | unchanged; E7/E8 AND with the scoped two |
| `compileAxis` via `answerPlayerCareer` | `player-career.ts:213` | the only execution path; no new compiler |
| `listFirstKickGoals` (`feature: 'multi-kick' | 'only-career-goal'`) and `getFirstKickGoalSummary` (`multiKick`, `onlyCareerGoal`) | `player-achievements.ts:67-70`, `:120-121` | the **independent oracle** for §17.10 parity — the public board already answers E7/E8 with the same two conditions (`consecutive_goal_kicks > 1`, `no_further_career_goals`) |

Semantics are taken from the column comments in migration 053, not inferred:
`consecutive_goal_kicks` is `smallint NOT NULL DEFAULT 1 CHECK (>= 1)` and means
"a goal with EACH of their first n kicks"; `no_further_career_goals` means "never
scored another **goal**" (checkable, and checked by the importer);
`no_further_career_kicks` is a different, kick-level claim (E9).

Because the column is `NOT NULL` with a `>= 1` CHECK there is **no NULL trap**:
`consecutive_goal_kicks >= 1` is exactly the whole family, which is why N = 1
maps to the plain builder rather than the consecutive one (**E-D3**).

### 17.4 Parser wording additions

All of it lands in **step 5a** (`parser.ts:1626-1651`) — ahead of every metric,
threshold, grain and boundary cue, for the reason already documented there — and
inside `extractFirstKickGoal`, which grows two optional modifiers alongside
`summaryKind`.

**New in `vocab.ts`:**

1. `FIRST_KICK_CONSECUTIVE_RE` — tried **before** `FIRST_KICK_GOAL_RE`, because it
   subsumes it. Shapes: "goal with each of their first three kicks", "goals with
   their first 3 kicks", "kicked goals with his first two kicks", "goal with each
   of the first N kicks", "first three kicks were all goals". The count is a
   capture group resolved through `NUMBER_WORDS` (`vocab.ts:21`) or a bare
   numeral, the same lookback discipline `extractPlayerMetricThreshold` uses.
2. `FIRST_KICK_ONLY_GOAL_CUES` — consulted **only after** `FIRST_KICK_GOAL_RE`
   matched, exactly like `ACHIEVEMENT_SUMMARY_CUES`, so a loose phrase can never
   elect the family on its own. Shapes: "was their only career goal", "only goal
   of their career", "only ever goal", "never kicked another goal", "never scored
   again", "and never goaled again".

**Precedence and suppression (each one is a test in §17.9):**

- `FIRST_KICK_CONSECUTIVE_RE` before `FIRST_KICK_GOAL_RE`; the whole span is
  consumed, so no numeral, "goal" or "kick" survives for the metric extractors.
- The E8 cue is consumed **inside** step 5a, before `extractPlayerMetric` (1084),
  `extractPlayerMetricThreshold` (1110) and `extractCareerConditions` (1763) run —
  this is the whole point of E8 (§17.2).
- **Negation ownership.** `extractFirstKickGoal`'s negation guard currently
  declines any "never/not/without" governing the phrase, exempting only
  `clubs_without`. The E8 cue joins that exemption on the same principle — *the
  cue owns the negation* — but **only** for the goal-level wordings. A kick-level
  negation ("never kicked the ball again") is E9 and must still decline (§17.7).
- **Mutual exclusion with summaries.** If a summary cue is present, the E7/E8
  modifier is **not consumed and no achievementKey is returned**: `achievement_summary`
  carries no `careerPredicates`, so a consumed modifier would be dropped on the way
  to SQL — the ISSUE-110 defect. Leaving the span unconsumed makes it a leftover
  token and the question declines, which is the honest outcome. (Same shape as the
  after-siren suppression at `parser.ts:1640`.)
- **Mutual exclusion with after-siren**, unchanged: `afterSirenReading` already
  suppresses the whole of step 5a.

**Plan assembly** (`parser.ts:2453-2470`), inside the existing
`grain === 'player_career' && achievementResult.achievementKey` block, after the
`for_club` / `between` pushes and before the bare-builder fallback:

```
if (achievementResult.consecutiveKicks !== undefined && achievementResult.consecutiveKicks >= 2) {
  careerPredicates.push({ builder: 'first_kick_goal_consecutive_min',
                          params: { kicks: String(achievementResult.consecutiveKicks) } });
}
if (achievementResult.onlyCareerGoal) {
  careerPredicates.push({ builder: 'first_kick_goal_only_career_goal', params: {} });
}
```

The existing `careerPredicates.length === 0` fallback then supplies the bare
`first_kick_goal_player` only when nothing scoped it — unchanged, and correct for
N = 1 (E-D3).

### 17.5 Ownership and validation rules

- **No new owning builders.** `first_kick_goal_consecutive_min` and
  `first_kick_goal_only_career_goal` take no club and no season, so neither joins
  `NL_CAREER_SEASON_OWNING_BUILDERS` / `NL_CAREER_CLUB_OWNING_BUILDERS`
  (`plan.ts:1151-1158`). Those two lists are **not edited**.
- **Composition is safe and is the intended shape.** "Carlton players who kicked a
  goal with each of their first three kicks" emits `first_kick_goal_for_club` **and**
  `first_kick_goal_consecutive_min`; the club is then owned by the first, the
  ISSUE-110 gate at `plan.ts:1631` passes, and `answerPlayerCareer` ANDs both
  fragments. This is exact, not approximate: `player_achievements` holds one
  first-kick-goal row per person for this source (`player_achievements_source_uq`
  on `(source_id, source_record_id)`, one manifest id per player), so two `IN`
  subqueries over the same row cannot combine different rows. **A post-load
  assertion proves it** (§17.9, R6) rather than leaving it as an argument.
- **Without a scoped builder the existing gates already fail closed**: a club with
  only the E7/E8 predicate hits "This kind of career question cannot be limited to
  one club"; a season range hits "A career question cannot be restricted to a
  season range"; venue/opponent/match type hit `plan.ts:1581`. No new validation is
  needed for any of these — but each gets a Phase E test, because the combination
  is new.
- **N bounds.** Non-integer, `< 1`, or `> NL_LIMITS`-scale absurdities (a cap of
  **10** is proposed; the source legend's observed maximum is a single digit) are
  refused at parse time rather than sent to SQL as an always-empty predicate.
  `requireInt` (`grid-solver.ts`) is the second line of defence.
- `maxCareerPredicates` (8) is untouched; the largest Phase E plan carries 3.

### 17.6 Identity and link boundaries

- **Linked rows only.** All five builders require `player_id IS NOT NULL AND
  link_status_value IN ('unique','resolved')`. NL never reports an unlinked
  achievement row as a player, and never converts a `player_name_clean` into an
  identity. Unchanged from E1–E5.
- **The public board is wider.** `/records/first-kick-goal` lists unlinked rows
  too (`getFirstKickGoalSummary` returns `linked`/`unlinked` separately). The NL
  answer is therefore a **subset** of the board by design; §17.10's parity
  witnesses compare NL against the board **filtered to linked rows**, and the
  divergence is stated in the caveat (§17.12), never silently absorbed.
- **No play-by-play inference.** The claim is curated and unrecomputable; nothing
  in Phase E derives it from `player_match_stats`, `matches` or scores.
- **Club lineage** stays `organization_id` via `first_kick_goal_for_club`; the
  achievement's own club and season are used, never the player's debut club or
  debut season (`grid-solver.ts:1017,1027` comments).
- **Coaches and players stay distinct**: Phase E touches neither.

### 17.7 Explicit decline cases

| ID | Question shape | Why it declines | Mechanism |
|---|---|---|---|
| E-DEC-1 | "players who never kicked the ball again after their first-kick goal" | `no_further_career_kicks` (E9) — kick-level, not goal-level | kick-level negation is excluded from the E8 cue; leftover token |
| E-DEC-2 | "players who did not record a kick in their first two games" | `kickless_matches_before_first_kick` (E9) | no vocabulary; unrecognised |
| E-DEC-3 | "players who never kicked a goal with their first kick" | polarity inversion of the whole family | existing negation guard (`parser.ts:421`) |
| E-DEC-4 | "which club has had the most players goal with each of their first three kicks" | summary grain cannot carry the modifier | §17.4 suppression -> leftover token |
| E-DEC-5 | "by decade, players whose first-kick goal was their only career goal" | same | same |
| E-DEC-6 | "goal with each of their first three kicks at the MCG / against Collingwood / in a grand final" | no builder consumes venue, opponent or match type | `plan.ts:1581` |
| E-DEC-7 | "goal with each of their first three kicks since 2000" **with no season-owning builder** | season unowned | `plan.ts:1679` (the emitted plan does own it via `_between`, so this case is constructed in the test rather than typed) |
| E-DEC-8 | "goal with each of their first 0 / -2 / 40 kicks" | out of range | §17.5 N bounds |
| E-DEC-9 | "players who kicked a goal with their first kick this decade" | existing bare-decade rule | already tested (`nl-parser.test.ts:1074`); re-asserted with the E7 wording |
| E-DEC-10 | "who kicked a goal with their first kick for Carlton in the 1940s at the MCG" | venue | `plan.ts:1581` |
| E-DEC-11 | "how many kicks did X have before his first goal" | not this family; no coverage | unrecognised |

### 17.8 Ownership/validation additions summary

None to `validatePlan` are *expected*. Phase E asserts the existing gates against
the new shapes; if an assertion proves a gate is missing, the fix is a named
refusal in the same style, recorded as a deviation.

### 17.9 Red-before-green test matrix

Existing suites only; no new unit-test file. Each row must be **observed failing**
before its implementation exists.

| Step | Suite | Red assertion |
|---|---|---|
| R1 | `tests/nl-parser.test.ts` (extend §14/§15) | E7 wordings produce `careerPredicates = ['first_kick_goal_consecutive_min']` with the exact bound `kicks`; word-numerals and numerals both |
| R2 | `tests/nl-parser.test.ts` | E8 wordings produce `['first_kick_goal_only_career_goal']` **and** `metric === null` — the metric-misread guard (§17.2) |
| R3 | `tests/nl-parser.test.ts` | composition: club -> `[for_club, consecutive_min]`; season -> `[between, consecutive_min]`; club+season+E8 -> all three, in a stable order |
| R4 | `tests/nl-parser.test.ts` | every §17.7 decline: E-DEC-1..11 |
| R5 | `tests/nl-plan.test.ts` | `validatePlan` accepts the three composed shapes and refuses the unowned-club / unowned-season / venue / opponent / match-type variants by name |
| R6 | `tests/integration/nl-answers-first-kick-goal.test.ts` (**new**, Phase B/C precedent) | one-row-per-player invariant (§17.5) asserted directly against `player_achievements` |
| R7 | same | the §17.10 witnesses, each against independently hand-written SQL |
| R8 | same | **parity** with `listFirstKickGoals`/`getFirstKickGoalSummary` filtered to linked rows |
| R9 | `tests/nl-describe.test.ts` | E7/E8 plan-description lines; and, if **E-D1** is approved, the yes/no wording |
| R10 | `tests/nl-audit-acceptance.test.ts` | a Phase E `describe` block: supported forms -> intended plan; §17.7 forms -> decline or failed validation |
| R11 | `tests/nl-ui-corpus.test.ts` | the two new corpora read with the expected shape; earlier gates asserted free of first-kick-goal wording |

`tests/integration/first-kick-goal-reload-links.test.ts` is **not modified**: it
becomes runnable as a side effect of the D11 load (§17.10) and is run as a
control.

### 17.10 The D11 `afldb_test` gate — operator-run, and what it changes

**Nothing in Phase E may be accepted on parser/plan proof alone.** The loader is
**not** run without explicit operator authorisation.

**Prerequisites the operator must satisfy first:**

1. **The curated extract is absent from this worktree.** `data/records/first-kick-goal.csv`
   is gitignored (`.gitignore:77` re-includes only the tracked manifest), and a
   worktree carries no untracked files. Only `data/records/first-kick-goal-ids.csv`
   (334 records: `fkg-001`..) is present. The operator either copies the curated
   extract into `data/records/` here, or points `AFLDB_FIRST_KICK_GOAL_CSV` at the
   main checkout's copy.
2. **The DSN must be set explicitly.** The importer reads
   `AFLDB_IMPORT_DATABASE_URL` and its `loadEnv` is setdefault — an exported value
   wins over `.env`, and this worktree's `.env` points that variable at
   `afldb_dev`. It must be exported to the **`afldb_test`** DSN (tunnelled port),
   or the load lands in the wrong database.

**Commands, in order:**

```
npm run records:first-kick-goal -- --check          # parse + legend decode, no DB
npm run records:first-kick-goal                     # resolve + report, writes NOTHING
npm run records:first-kick-goal -- --apply          # one transaction
```

**What `--apply` changes in `afldb_test`:** inserts ~334 `player_achievements`
rows with `achievement_type='first_kick_goal'` and `source_id` =
`wikipedia_first_kick_goal`, keyed by `source_record_id`; one `import_batches` row;
possibly `data_issues` rows where the legend disagrees with `player_career_stats`.
It is keyed and non-destructive (ISSUE-078) and touches no other table.

**Known side effects, declared in advance:**

- `tests/integration/first-kick-goal-reload-links.test.ts` currently cannot run
  (`takeSourceLinked` throws "no spare source-linked first_kick_goal row in
  afldb_test"). After the load it runs, and it needs the **same** extract and
  manifest on disk. It is run as a control, unmodified.
- The four external `afldb_test` snapshot-drift assertions in
  `tests/integration/database.test.ts` (§14.4.1, §16.7) are **not touched, not
  investigated and not edited**. They are expected to keep failing exactly as
  before; Phase E must not change their counts, and that is asserted by
  re-running the suite and comparing the same four failures.

**M-E1 — the post-load measurement (the §15.19 analogue).** The E7/E8 populations
are unknown: the legend markers live only in the gitignored extract, so no count
can be stated before the load. Immediately after `--apply`, read-only:

```sql
SELECT count(*) AS total,
       count(*) FILTER (WHERE player_id IS NOT NULL
                          AND link_status_value IN ('unique','resolved')) AS linked,
       count(*) FILTER (WHERE consecutive_goal_kicks > 1)  AS multi_kick,
       max(consecutive_goal_kicks)                          AS max_consecutive,
       count(*) FILTER (WHERE no_further_career_goals)      AS only_career_goal,
       count(*) FILTER (WHERE no_further_career_kicks)      AS no_further_kicks,
       min(season), max(season)
  FROM player_achievements WHERE achievement_type = 'first_kick_goal';
```

The corpus thresholds and the §17.11 witnesses are finalised from these numbers,
never from the source's prose. **A zero or tiny population is a valid outcome**:
an empty result asserted against hand-written SQL is still a DB-backed witness
(the Phase C "3+ goals after the siren -> empty" precedent), and if
`max_consecutive` is 2 then "first three kicks" is a **measured empty**, which the
corpus must state rather than imply.

### 17.11 DB-backed hand-written-SQL witnesses

Every one is compared against SQL written independently of the compiler.

| # | Question | Witness |
|---|---|---|
| W1 | "players who kicked a goal with their first kick" | count == linked total from M-E1 |
| W2 | "did `<player>` kick a goal with his first kick" (a known holder) | exactly that player, 1 row |
| W3 | same, for a non-holder | 0 rows, and the plan still carries the player pin |
| W4 | "Carlton players who kicked a goal with their first kick" | == `listFirstKickGoals({club:'carlton'})` filtered to linked |
| W5 | "...in the 1940s" | == season BETWEEN 1940 AND 1949, linked |
| W6 | **E7** "goal with each of their first two kicks" | == `consecutive_goal_kicks >= 2`, linked; and == `listFirstKickGoals({feature:'multi-kick'})` linked-filtered |
| W7 | **E7** with N = max+1 from M-E1 | measured empty |
| W8 | **E8** "first-kick goal was their only career goal" | == `no_further_career_goals`, linked; and == `listFirstKickGoals({feature:'only-career-goal'})` linked-filtered |
| W9 | **composition** E7 + club | == the single ANDed hand-written query; proves §17.5 |
| W10 | **composition** E8 + season range | same |
| W11 | E8 vs E9 inequality | `no_further_career_goals` set ≠ `no_further_career_kicks` set, asserted strictly (or, if M-E1 shows them equal on this data, asserted as an equality **with the reason recorded**, never as a semantic claim) |
| W12 | parity | NL total for E7/E8 == `getFirstKickGoalSummary().multiKick` / `.onlyCareerGoal` **minus unlinked**, computed from the same query |
| W13 | linked-only boundary | at least one unlinked row exists and is absent from every NL answer (if M-E1 shows `unlinked = 0`, this is recorded as unprovable on this data, not silently dropped) |

### 17.12 Renderer and interpretation wording

- **Plan description** needs no new machinery: `describePlan` already renders
  `Condition: ${GRID_BUILDERS[axis.builder].label}` (`plan.ts:1904`), giving
  "Condition: Goal with each of their first X kicks." and "Condition: First-kick
  goal was their only career goal." The literal `X` matches the existing NL
  precedent (`grand_finals_played_min` renders "Played in X+ Grand Finals" today).
  **Recommendation: keep the precedent; do not add parameter interpolation in
  Phase E** (decision **E-D5**).
- **Answer wording (E-D1).** `describePlayerCareerAnswer`'s no-metric branch
  (`describe.ts:643`) renders "0 players match" / "1 player matches". For "did
  `<player>` kick a goal with his first kick" that is a poor sentence, and it is
  the only real E6 deficit. Proposed, **gated narrowly** to
  `plan.player && !plan.metric && plan.careerPredicates.length > 0`: headline
  "`<Player>` — yes" / "`<Player>` — no", interpretation naming the conditions.
  The one existing assertion on that wording (`nl-describe.test.ts:253`,
  "320 players match") is an unpinned plan and is unaffected.
- **Caveat.** No `answerCaveats` entry is added (that helper is after-siren only).
  The curated/linked-only boundary is instead stated in the E6/E7/E8
  interpretation sentence, once, in the site's own language: the record is a
  curated list, and unlinked rows are not counted.
- Nothing in `/records/first-kick-goal`, `player-achievements.ts` or
  `NlAnswerSection.tsx` changes.

### 17.13 `PARSER_VERSION`

**Yes — 36 -> 37, exactly once.** Behavioural parser semantics change: two new
vocabulary families, two new emitted predicates, a widened negation exemption and
new declines. The bump lands with a new entry in the `plan.ts` history comment.
No second bump within Phase E.

### 17.14 Telemetry and schema

**No migration is expected, and none will be written unless implementation proves
one is required.** Phase E adds:

- **no new grain** — `player_career` and `achievement_summary` both predate the
  `nl_search_log_grain_check` CHECK as widened by 093, so the 092/093 failure mode
  does not recur;
- **no new metric value** and **no new `failure_reason`** — declines use the
  existing unrecognised / low-confidence / validation paths.

Proof rather than assertion: `tests/integration/database.test.ts`'s type-derived
grain contract test is run against `afldb_test` as part of acceptance. If it, or
a telemetry insert, proves a constraint blocks Phase E, the response is the F5
pattern — one forward-only, strictly widening migration **094**, with the deploy
ordering note.

### 17.15 Files this phase touches

| File | Change |
|---|---|
| `src/search/nl/vocab.ts` | `FIRST_KICK_CONSECUTIVE_RE`, `FIRST_KICK_ONLY_GOAL_CUES` |
| `src/search/nl/parser.ts` | step 5a modifiers in `extractFirstKickGoal`; two `careerPredicates.push` calls; summary/after-siren suppression; N bounds; decline notes |
| `src/search/nl/plan.ts` | `PARSER_VERSION` 36 -> 37 + history entry. **No** change to `NL_ACHIEVEMENTS`, the grain union, the owning-builder lists, or `validatePlan` unless §17.8 fires |
| `src/search/nl/describe.ts` | only if **E-D1** is approved |
| `tests/nl-parser.test.ts`, `tests/nl-plan.test.ts`, `tests/nl-describe.test.ts`, `tests/nl-audit-acceptance.test.ts`, `tests/nl-ui-corpus.test.ts` | Phase E coverage |
| `tests/integration/nl-answers-first-kick-goal.test.ts` | **new** — the §17.11 witnesses |
| `tests/nl-ui/corpora/afldb-ui-questions-first-kick-goal-v1-<date>.csv` | **new**, ~18 rows |
| `tests/nl-ui/corpora/afldb-ui-questions-first-kick-goal-decline-v1-<date>.csv` | **new**, ~6 rows (one per §17.7 family) |
| `issues/open/AFLDB-ISSUE-152.md`, `IssuesIndex.md`, `CHANGELOG.md` | tracking |

Explicitly **not** touched: `src/db/queries/grid-solver.ts`, the five builders,
`src/db/queries/nl/achievement-summary.ts`, `src/db/queries/player-achievements.ts`,
`src/app/records/first-kick-goal/page.tsx`, `tools/records/import-first-kick-goal.ts`,
migration 053, the Phase B and Phase C implementations, the 1,435/60 corpora, the
coaching and after-siren corpora, and the four external snapshot-drift assertions.

### 17.16 Corpus additions (additive only)

Per §10: ~15-20 realistic, ~5 declines. Categories: `fkg_holder_list`,
`fkg_named_player`, `fkg_club_scope`, `fkg_season_scope`, `fkg_consecutive`,
`fkg_only_goal`, `fkg_composition`, `fkg_summary` (existing E4/E5 shapes, as
control rows); declines: `fkg_decline_no_further_kicks`,
`fkg_decline_kickless`, `fkg_decline_negated`, `fkg_decline_summary_modifier`,
`fkg_decline_scope`, `fkg_decline_range`. Every row executed against `afldb_test`
after the load, and the earlier gates asserted free of first-kick-goal wording, in
the `nl-ui-corpus.test.ts` style Phase C established.

### 17.17 Operator decisions still required

| ID | Decision | Recommendation |
|---|---|---|
| **E-D1** | Yes/no answer wording for a named-player predicate question (§17.12) | **Approve**, gated to `player && !metric && careerPredicates.length > 0` |
| **E-D2** | Authorise the loader, and supply the curated extract location + the `afldb_test` DSN (§17.10) | required before any acceptance; Phase E cannot be accepted without it |
| **E-D3** | N = 1 ("a goal with their first one kick") maps to `first_kick_goal_player`, not `consecutive_min` | **Approve** — the two are provably identical (`NOT NULL DEFAULT 1`, `CHECK >= 1`) and the plain label reads correctly |
| **E-D4** | Allow E7/E8 to compose with club/season (§17.5) | **Approve** — the ownership rule is satisfied by the scoped builder, and the one-row-per-player invariant is asserted (R6) |
| **E-D5** | Interpolate parameters into predicate description lines | **Decline for Phase E** — precedent is label-only; record as a separate cosmetic follow-up if wanted |
| **E-D6** | Whether E6's status correction (§17.1) should also correct the §5.1 matrix row in place | **Approve** — the matrix is evidence and should not carry a known-wrong status |

### 17.18 Stop condition

Phase E is complete when: R1-R11 were observed red then green; the §17.11
witnesses pass against a loaded `afldb_test`; the Phase B and Phase C suites, the
1,435/60 gates and `first-kick-goal-reload-links.test.ts` are still green; the
four snapshot-drift failures are unchanged; `tsc --noEmit` is clean; and this
section is superseded by a `§18 Phase E — IMPLEMENTED` record. Phases D, F and G
remain untouched.

---

## 18. Phase E — IMPLEMENTED 2026-09-09

**Status: IMPLEMENTED, non-DB gate green, D11 DB-backed acceptance green, NOT
deployed, NOT committed at the time of writing.** The operator authorised the
loader (**E-D2**) and answered **E-D1 – E-D6**; everything below is what actually
happened, including the places the plan was not followed and why.

`PARSER_VERSION` 36 → **37**, once, in the behavioural wiring, with the history
entry in `plan.ts`. No second bump.

Phase E built **no new grain, no new builder, no new query file, no SQL and no
migration**. Every fact it now exposes was already implemented, parameterised,
lineage-correct and grid-tested; the work was parser ownership, declines, one
wording gate, and the DB-backed proof the family had never had (**F4**).

### 18.1 Operator decisions, as answered

| ID | Answer | Where it landed |
|---|---|---|
| **E-D1** | **APPROVED** | `describe.ts:665-675` — yes/no headline gated to `plan.player && !plan.metric && plan.careerPredicates.length > 0`. Every unpinned list keeps the "N players match" wording it has always had |
| **E-D2** | **AUTHORISED** — loader run against `afldb_test` (§18.2) | the D11 gate is satisfied; Phase E is accepted on data, not on parse shapes |
| **E-D3** | **APPROVED** | N = 1 maps to `first_kick_goal_player`, not `consecutive_min` — `consecutive_goal_kicks` is `NOT NULL DEFAULT 1 CHECK (>= 1)`, so the two are provably the same set and the plain label reads correctly |
| **E-D4** | **APPROVED** | E7/E8 compose with club and season; the scoped builder owns the club/season and the one-row-per-player invariant is asserted directly (R6) |
| **E-D5** | **DECLINED for Phase E** | `plan.ts:1919` still renders `Condition: ${GRID_BUILDERS[...].label}` — label only, no parameter interpolation. Matches the `grand_finals_played_min` precedent. A cosmetic follow-up if ever wanted |
| **E-D6** | **APPROVED** | the §5.1 matrix row for E6 was corrected in place; E7/E8/E9 are now updated there too |

### 18.2 The D11 load — authorisation, source, and what it reported

Operator-run against `afldb_test` over the `55432` tunnel, with
`AFLDB_IMPORT_DATABASE_URL` exported explicitly (the worktree `.env` points that
variable at `afldb_dev`, and the importer's `loadEnv` is setdefault).

**Curated loader source path actually used — recorded because §17.10 left it
open:**

```
D:\dev\afldb\data\records\first-kick-goal.csv
```

i.e. the **main checkout's** copy. The extract is gitignored (`.gitignore:77`
re-includes only the tracked manifest) and a worktree carries no untracked files,
so `D:\dev\afldb-issue-152\data\records\` holds only the tracked
`first-kick-goal-ids.csv` (334 records, `fkg-001`..). No copy of the extract was
made into this worktree and none is committed.

**Apply result — `import_batches` batch 230:**

```
334 updated / 0 inserted / 0 deleted
```

Recorded exactly as reported. These are the counters of a **keyed reconcile over
an already-present population**, not a first insert into an empty table
(ISSUE-078 makes the loader keyed and non-destructive, so a re-apply reports
updates and no inserts). The provenance of the pre-existing rows was not
established in this session and is **not** claimed here; what matters for
acceptance is the post-load population, which was measured directly (§18.3) and
is asserted as a fixture contract by the integration suite. Nothing outside
`player_achievements` / `import_batches` / `data_issues` was touched.

### 18.3 M-E1 — the post-load measurement

Read-only against `afldb_test`, the §17.10 query. **These are the numbers the
corpus thresholds and the §17.11 witnesses were finalised from — never the
source's prose.**

| total | linked | multi-kick | max consecutive | only-career-goal | no-further-kicks | seasons |
|---|---|---|---|---|---|---|
| **334** | **330** | **44** | **6** | **23** | **4** | **1911–2026** |

Consequences, each of which changed a test or a corpus row:

- **`max_consecutive = 6`**, so "first three kicks" is a real, non-empty
  population and not the measured-empty case §17.10 warned about. The E7 suite
  runs N ∈ {2, 3, 4, 6} and asserts each is non-empty; **N = 7** is the W7
  measured empty.
- **`linked = 330` of 334**, so **4 unlinked rows exist** and W13 is provable on
  this data rather than being recorded as unprovable. The NL answer is a strict
  subset of `/records/first-kick-goal`, by design.
- **`only_career_goal = 23` vs `no_further_kicks = 4`** — the two sets are
  measurably different, so W11 asserts the E8/E9 inequality **strictly**. The
  fallback in §17.11 (assert equality with the reason recorded) did not fire.
- **`max(season) = 2026`** — the extract carries a current-season row. Nothing in
  the parser or the builders depends on the range; it is recorded because the
  fixture contract pins it.

### 18.4 Files changed

| File | Change |
|---|---|
| `src/search/nl/vocab.ts` | `FIRST_KICK_CONSECUTIVE_RE`, `FIRST_KICK_CONSECUTIVE_MAX = 10`, `FIRST_KICK_ONLY_GOAL_CUES` (five shapes; the two negation forms also consume the `after their <achievement>` relation — §18.6), `FIRST_KICK_NO_FURTHER_KICKS_CUES` (E9, recognised only in order to decline by name) |
| `src/search/nl/parser.ts` | `extractFirstKickGoal` grows `consecutiveKicks` / `onlyCareerGoal` alongside `summaryKind`, plus the three fail-closed flags; two `careerPredicates.push` calls; the negation exemption widened by one; the four named refusals |
| `src/search/nl/plan.ts` | `PARSER_VERSION` 36 → 37 + history entry. **No** change to `NL_ACHIEVEMENTS`, the grain union, `NL_CAREER_SEASON_OWNING_BUILDERS`, `NL_CAREER_CLUB_OWNING_BUILDERS` or `validatePlan` |
| `src/search/nl/describe.ts` | E-D1 yes/no branch + the curated/linked-only note |
| `tests/nl-parser.test.ts`, `tests/nl-plan.test.ts`, `tests/nl-describe.test.ts`, `tests/nl-audit-acceptance.test.ts`, `tests/nl-ui-corpus.test.ts` | Phase E coverage |
| `tests/integration/nl-answers-first-kick-goal.test.ts` | **new** — the §17.11 witnesses |
| `tests/nl-ui/corpora/afldb-ui-questions-first-kick-goal-v1-20260908.csv` | **new**, 20 rows |
| `tests/nl-ui/corpora/afldb-ui-questions-first-kick-goal-decline-v1-20260908.csv` | **new**, 6 rows |
| `issues/open/AFLDB-ISSUE-152.md`, `IssuesIndex.md`, `issues.md`, `CHANGELOG.md` | tracking |

Untouched exactly as §17.15 required: `src/db/queries/grid-solver.ts` and all five
builders, `src/db/queries/nl/achievement-summary.ts`,
`src/db/queries/player-achievements.ts`, `src/app/records/first-kick-goal/page.tsx`,
`tools/records/import-first-kick-goal.ts`, migration 053, the Phase B and Phase C
implementations, the 1,435/60 corpora, the coaching and after-siren corpora, and
`tests/integration/first-kick-goal-reload-links.test.ts`.

### 18.5 The three deliberate fail-closed deviations from §17.4 — and why

§17.4 specified that a modifier the plan cannot carry should be **left
unconsumed**, becoming a leftover token so the question declines on the
unresolved-token penalty. **That was not built, deliberately, in three places.**
Each one instead **consumes the span and returns a named refusal**
(`parser.ts:1725-1755`), because the leftover words in this family are literally
`goal` and `kick` — both `METRIC_WORDS`.

This is the Phase C **R0** lesson applied in advance: there, the metric extractor
*did* claim `goals`/`kicks` and the wrong answer was suppressed **only** by the
0.35 unresolved-token penalty. Leaving a first-kick-goal tail in the text bets the
decline on that same penalty. A cue that consumes the span removes the penalty and
hands `goal`/`kick` straight to `extractPlayerMetric` — the question would then be
answered confidently as a career-goals or career-kicks leaderboard. Declining by
name is the only outcome that cannot bleed.

| Deviation | Trigger | Flag | What the user is told |
|---|---|---|---|
| **E9** (E-DEC-1) | a kick-level negation — "never kicked the ball again", "never had another kick", "no further kicks" — checked **before** the E8 cue so the two claims can never be conflated | `kickLevelResidual` | "AFLDB records whether a first-kick goal was a player's only career GOAL, not whether they ever kicked the football again." |
| **E-DEC-4 / E-DEC-5** | an E7 or E8 modifier arriving with an `achievement_summary` cue ("which club has had the most players goal with each of their first three kicks", "by decade, players whose first-kick goal was their only career goal") | `modifierWithSummary` | "A summary of the first-kick-goal record counts every holder; it cannot also be narrowed to the multi-kick or only-career-goal subset." |
| **E-DEC-8** | N outside `[1, FIRST_KICK_CONSECUTIVE_MAX]` — 0, negative, 40 | `countOutOfRange` | "A first-kick goal streak is counted from 1 to 10 kicks; that number is outside what this record holds." |

`achievement_summary` carries no `careerPredicates`, so the E-DEC-4/5 case is the
ISSUE-110 silent-scope shape: a consumed modifier would be dropped on the way to
SQL and the wider summary returned as though it had been narrowed. Refusing is the
honest outcome.

**A fourth guard, not a deviation but new**, sits in plan assembly
(`parser.ts:2349-2360`): if grain election lands anywhere other than
`player_career` while an E7/E8 modifier is present, the question declines with
"That first-kick-goal detail can only narrow a list of players." `careerPredicates`
exist only at `player_career` grain, so any other grain would carry the words as
consumed and the condition nowhere — the same ISSUE-110 shape, caught one stage
later.

**Negation ownership** widened by exactly one: an E8 cue owns its own "never",
as `clubs_without` already did (`parser.ts:486-492`). Everything else governed by
"never / not / didn't / without" still hits the existing polarity guard and
declines (E-DEC-3).

### 18.6 One extraction correction found by the acceptance gate

`players who never kicked another goal after their first-kick goal` planned as
`none (ambiguous)`. Cause: `FIRST_KICK_GOAL_RE` consumes the achievement span
first, which is the noun phrase the `after` relation governs; the E8 cue then
matched only `never kicked another goal` and left the orphaned connective behind.
`their` is a stopword, `after` is not, so a fully supported wording declined on an
unsupported token **after** E8 had already claimed the semantics.

Fixed in `vocab.ts` by giving the two negation-form cues an optional trailing
relation clause, so the cue claims the whole supported wording. **A determiner
after the connective is required**, which is what keeps it narrow: `after their` /
`after that` is the remnant of a consumed noun phrase, while `after 1950` or
`after round 12` is a scope clause with its own owner and cannot match. No new
builder, grain, SQL or version bump; E9's earlier position is unchanged, so
E-DEC-1 still declines by name.

### 18.7 Corrections to §17

- **`listFirstKickGoals` does not exist.** §17.3 and §17.11 (W4, W6, W8) name it;
  the real export is **`getFirstKickGoalList`**
  (`src/db/queries/player-achievements.ts:53`), consumed by
  `src/app/records/first-kick-goal/page.tsx:17,90`. The integration suite imports
  the correct name; the plan text was wrong, not the code.
  `getFirstKickGoalSummary` was named correctly.
- **E6 was never a gap** (§17.1's own correction), and both of its residuals are
  now closed: DB-proven by W2/W3, and the headline wording shipped under E-D1.
- **§15.6-style caveat machinery was not needed.** The curated/linked-only
  boundary is stated in the E6/E7/E8 interpretation sentence, once, as §17.12
  specified. No `answerCaveats` entry was added.

### 18.8 Red-before-green proof

The five NL suites were run against pre-Phase-E source **`47a645f`** (Phase C
head) with the Phase E tests in place:

```
21 failed / 427 passed
  tests/nl-parser.test.ts          16 Phase E failures
  tests/nl-describe.test.ts         4 Phase E failures
  tests/nl-audit-acceptance.test.ts 1 Phase E failure
  tests/nl-plan.test.ts           136/136 still green
```

`nl-plan.test.ts` staying fully green is the expected and desired result: Phase E
adds **no** validation rule. Its Phase E assertions exercise gates that already
existed (`plan.ts:1581`, `:1631`, `:1679`) against new shapes, so they pass both
before and after — they are regression pins, not red-before-green rows. §17.8 is
therefore satisfied as written: no `validatePlan` change was required.

R6–R8 were red by construction — the suite could not run at all before the D11
load.

### 18.9 Validation

**Non-DB gate, 2026-09-09 — 485/485 PASS:**

| Suite | Result |
|---|---|
| `tests/nl-parser.test.ts` | **253/253 PASS** |
| `tests/nl-plan.test.ts` | **136/136 PASS** |
| `tests/nl-describe.test.ts` | **49/49 PASS** |
| `tests/nl-audit-acceptance.test.ts` | **10/10 PASS** |
| `tests/nl-ui-corpus.test.ts` | **37/37 PASS** |
| **total** | **485/485 PASS** |
| `npx tsc --noEmit` | **clean** |

**DB-backed Phase E acceptance (D11), against the loaded 334-row `afldb_test`
population:**

| Suite | Result |
|---|---|
| `tests/integration/nl-answers-first-kick-goal.test.ts` | **20/20 PASS in 1.499s** |

This is the authoritative Phase E proof: W1–W13 and R6–R8, each answer compared
against **independently hand-written SQL**, and — where the public board answers
the same question — against `getFirstKickGoalList` / `getFirstKickGoalSummary`
filtered to linked rows. Two code paths agreeing is evidence; one code path
agreeing with itself is not.

### 18.10 ISSUE-078 reload regression — recorded separately, and why

`tests/integration/first-kick-goal-reload-links.test.ts` was invoked jointly and
produced **11 Windows timeout failures**. **Classified as the already-proven
Windows runtime pathology, NOT a Phase E regression**, and recorded as a separate
validation:

- the same characteristic **~90–230 s importer child-process stalls**, with the
  spelling-correction case at **~181 s** again;
- the authoritative earlier **Linux** run of this exact reload suite:
  **16/16 PASS in 53.94 s**;
- Phase E touches **none** of what this suite exercises — not the importer, not
  the reload harness, not the manifest/rekey logic, not the player-link queries,
  not the ISSUE-078 implementation. §18.4 lists the changed files;
- **no test timeout was increased and no importer or reload behaviour was
  modified** to make it pass.

The two validations therefore stand apart and must not be merged in any summary:

1. **Phase E DB-backed NL semantics — 20/20 PASS on Windows** (authoritative).
2. **ISSUE-078 reload regression — Linux 16/16 PASS is authoritative; Windows
   execution is non-authoritative** under the established runtime pathology.

### 18.11 Corpus additions (additive only)

| Corpus | Rows |
|---|---|
| `afldb-ui-questions-first-kick-goal-v1-20260908.csv` | **20** realistic |
| `afldb-ui-questions-first-kick-goal-decline-v1-20260908.csv` | **6** declines, one per §17.7 family |

The pre-Phase-E gates are **unchanged**: **1,435** realistic and **60** decline,
plus the Phase B coaching and Phase C after-siren corpora, all asserted free of
first-kick-goal wording by `nl-ui-corpus.test.ts:190`. The expansion is purely
additive, exactly as Phases B and C were.

### 18.12 Telemetry and schema — no migration

**None required, and none written.** §17.14's expectation held: Phase E adds no
grain (`player_career` and `achievement_summary` both predate the
`nl_search_log_grain_check` CHECK as widened by 092/093), no new metric value and
no new `failure_reason` — every decline uses the existing unrecognised path. The
092/093 failure mode does not recur, and **094 was not needed**.

### 18.13 Phase E — TECHNICALLY COMPLETE 2026-09-09; what remains

§17.18's stop condition is met: R1–R11 observed red then green (R5 as a pin, §18.8),
the §17.11 witnesses pass against a loaded `afldb_test`, the Phase B/C suites and
the 1,435/60 gates are still green, `tsc --noEmit` is clean, and §17 is superseded
by this section.

**NOT done, and not in Phase E's scope:** commit; rendered/browser run of the two
new corpora; `npm run build`; `nl:stress`; deploy. At deploy time migrations **092
AND 093 must still both reach `afldb_dev` and production BEFORE the code** — Phase
E adds no third migration but does not retire that ordering requirement.

**The four external `tests/integration/database.test.ts` dataset-count failures**
(§14.4.1, §16.7) remain out of scope, uninvestigated and unedited.

**Phases D, F and G remain untouched and are NOT started.**

---

## 19. Phase G — P1 PASS, P3 attempt 1 INADMISSIBLE (2026-09-09 local / 2026-09-08Z)

§9 defines Phase G as "New ISSUE-152 corpus; rendered DEV acceptance", gated on
"1,435 + 60 unchanged and still green", but writes no procedure. This section is
the procedure, and the record of the first attempt.

### 19.1 What was run

| Step | Command | Result |
|---|---|---|
| P1 build gate | `npm run build` (Windows, `AFLDB_BUILD_WORKERS=4`, `DATABASE_URL` -> `afldb_test`) | **PASS** — `next build --webpack` + `prepare-standalone.mjs` |
| P2 server | `npx next start -p 3100`, `afldb_test` over the 55432 tunnel | served |
| P3 rendered sweep | `playwright test --config playwright.nl-stress.config.ts --project nl-stress --no-deps`, 270 rows (the six additive corpora merged) | **INADMISSIBLE — see §19.2** |
| P4 existing gates | 1,435 + 60 | **NOT RUN**, deliberately |

Rendered acceptance runs against a **local production build of this branch**,
not against DEV: DEV serves `main`, which has no `coach_record` grain, no
`after_siren` grain and no Phase E wording, so a DEV sweep would measure the
wrong code. The beta gate is `off` in this worktree, so `auth.setup.ts` is
skipped with `--no-deps` over a `tests/nl-ui/.auth/state.json` carrying only
`afldb_consent=declined` (gitignored; no admission is faked, because there is
nothing to be admitted past).

### 19.2 P3 attempt 1 — transport PASS, semantics INADMISSIBLE

**Reported:** 270/270 observed, 88 pass, 182 fail, outcomes `answered 30`,
`absent 240`, `unanswerable 0`, `http_error 0`, `page_error 0`, zero client
errors, zero filler disagreements. Preserved at `nl-ui-out-152-new/`.

**What that run actually established:**

- **Transport and browser execution completed.** 270 navigations, every one
  HTTP 200, no page error, no console error, no hydration error.
- **Semantic evidence is INADMISSIBLE.** `/search` enforces a per-IP,
  **per-process** rate limit of **30 requests / 60 seconds** in front of the NL
  pipeline (`src/app/search/rate-limit.ts:5`, `new RateLimiter(30, 60_000)`,
  keyed `ip:${requestIp()}`; AFLDB-ISSUE-120, `CHANGELOG.md:1742`). A limited
  request renders "Too many searches" **without calling `globalSearch()`** and
  without writing an `nl_search_log` row.
- **Exactly 30 requests traversed the NL pipeline** — the limiter's entire
  budget. `npx next start` is ONE process, so both Playwright workers shared
  ONE limiter and split it 15/15, which is why the passes are the first 15 rows
  of each worker's first batch (`coach_001`-`coach_015`,
  `siren_077`-`siren_091`) rather than any semantic family.
- **The remaining 240 were rate-limited**, not answered and not declined. The
  whole run took **26 seconds** (`20:53:07.115Z` -> `~20:53:33`), inside one
  fixed 60-second window, so the budget never refilled. Throttled rows returned
  in **77-191 ms** (document byte at ~52 ms) against **207-918 ms** for answered
  rows — far too fast for even one statement over the 55432 tunnel.
- **All 58 apparent decline passes are DISCARDED as evidence.** A throttled page
  carries no answer panel, which is exactly what a correct decline looks like to
  the harness, so those rows would have "passed" with the database switched off.
- **Phase G P3 remains UNPROVEN, not failed.** No parser, planner, compiler or
  renderer defect is implicated, and none was changed.

The adjacent-row proof, same builder, same grain, consecutive requests:

```
coach_015  "Leigh Matthews coaching record"  answered  207ms  "Leigh Matthews - 461 games, 267-8-186"
coach_016  "Ron Barassi coaching record"     absent     81ms  (no panel)
```

### 19.3 What the 30 admissible observations DO prove

- **`coach_record` renders end-to-end** — list ("42 coaches"), count, and career
  ("Leigh Matthews - 461 games, 267-8-186") shapes.
- **`after_siren` renders end-to-end** with correct interpretations and real
  counts — 62 game-winning, 9 levelling, 25 misses, 21 behinds, 18
  missed-and-lost.
- **App-role reads on `afldb_test` work for `coaches`, `match_coaches` and
  `after_siren_kicks`** — the migration 087/089 fail-closed grant hazard is ruled
  out for those three tables.
- **First-kick-goal has NO rendered evidence in either direction.** All 20 plan
  rows sat at corpus positions 245-264, behind the throttle.

### 19.4 Why this was never seen before

The limiter landed on **1 September 2026** (ISSUE-120). The last large UI sweeps
were **18-19 August 2026**. Phase G is the first `nl:ui` run since, and
`playwright.nl-stress.config.ts` still describes a 12,000-load run taking "the
better part of an hour" (~200/min) — 6.7x the limit. Every gate ISSUE-152 has
passed so far (parser, plan, describe, acceptance, and the DB-backed integration
suites) calls the engine **in-process** and never traverses HTTP, so none of them
can meet the limiter.

### 19.5 Harness change — the only edit (2026-09-09)

`tests/nl-ui/nl-stress.spec.ts` — `observe()` now recognises the rendered
"Too many searches" branch and records it as **`page_error`**, the existing
crash class, which fails the batch loudly and at once. Scored as `absent` it
marked every throttled plan row a semantic failure AND every throttled decline
row a pass — fiction in both directions.

**No new outcome value, no scoring change, no corpus change, no timeout change,
and no application change.** `scoreObservation` already fails a crash under
every expectation (`tests/nl-ui-corpus.test.ts:322`), so the consequence is
pinned by an existing test. `observe()` is not exported and needs a live
Playwright `Page`, so the DOM detection itself has no isolated unit surface;
its proof is the re-run.

**The rate limiter was NOT changed, disabled or weakened, and must not be.**

### 19.6 The re-run shape

The deployed runtime shape, so each forked worker holds its own limiter exactly
as production does: `node deploy/server-cluster.mjs` with `AFLDB_WORKERS=8`
against `afldb_test`, driven by **one** Playwright worker
(`NL_UI_WORKERS=1`). The standalone server does not read `.env`, so the
environment must be exported into the process first. Node's cluster does not
round-robin on Windows, so worker count carries the margin rather than
scheduling fairness.

Independent confirmation that a re-run actually reached the pipeline: rows in
`nl_search_log` tagged `issue152-phaseg-*` should equal the corpus size.
Attempt 1 should show **30**.

### 19.7 Smoke r1 — INADMISSIBLE infrastructure evidence (2026-09-09)

The first paced smoke run (40 coaching rows, tag `issue152-phaseg-smoke`)
returned **40/40 HTTP 500**. It is inadmissible, and no semantic conclusion of
any kind may be drawn from it.

**Root cause — proven, not inferred.** The persisted standalone server log
carries the exception:

```text
Error: connect ECONNREFUSED 127.0.0.1:55432
```

This workstation runs no PostgreSQL server. Every Phase G DSN reaches the
database through an SSH forward on `127.0.0.1:55432`, and that forward was not
running. Nothing else was wrong:

| Ruled out | Evidence |
|---|---|
| Phase B/C/E semantics | No question reached the parser; the failure precedes `globalSearch()`. |
| Parser / planner | Same. `/search` with **no** query — `getSiteSettings()` alone — also returned 500. |
| Rate limiter, pacing | 0 rate-limit detections across all 40 rows; the limiter is in-memory and fails open (`src/app/search/rate-limit.ts`). |
| Grants on `afldb_test` | No connection was ever established, so no grant was ever exercised. |
| Standalone runtime | `/` returned 200 — one of 1,472 build-time prerenders. The process, bundle, static assets and module resolution were all healthy. |

**What r1 does establish:** pacing works. 40 observed rows, 0 rate-limit
detections, 0 `page_error`. That is the entire admissible content of the run.

**What it cannot establish:** anything end-to-end. It wrote **no**
`nl_search_log` rows, so it has no telemetry provenance either.

**Why `/` looked healthy while every question failed.** `/` is prerendered and
touches no database; `/search` is `force-dynamic` (`src/app/search/page.tsx`)
and calls `getSiteSettings()` before any query-specific work. `getSiteSettings`
swallows only `42P01`, so a dead pool correctly rethrows and renders 500. A
green `/` proved the server, and nothing about the database.

**Harness changes, so this cannot recur silently (no application code, no DB
grant, no parser/planner/limiter/pacing change):**

- `tools/issue-152/phase-g-tunnel.ps1` — new. Window 1 holds the forward:
  `ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:55432:127.0.0.1:5432
  arm@10.0.40.100`. Local port read from `.env`; no credential read, printed or
  stored; an occupied port is reported by PID and never terminated.
- `tools/issue-152/phase-g-server.ps1` — refuses to start unless
  `127.0.0.1:55432` accepts a connection, with the message *"Phase G PostgreSQL
  tunnel is not running. Start .\tools\issue-152\phase-g-tunnel.ps1"*. It also
  now tees the server's stdout and stderr to
  `nl-ui-out-152-phaseg/server/server-<timestamp>.log` — one file per run,
  never overwritten, no credential, gitignored. That log is what proved this
  root cause; before it existed the exception died with the console window.
- `tools/issue-152/phase-g-diagnose.ps1` — new, read-only. Identifies the
  process on 3100 by command line, reports the tunnel, probes `/`, `/search`
  and one coaching question, and prints the log lines those probes produced.
- `tools/issue-152/phase-g-status.ps1` — new `-- PostgreSQL tunnel 55432 --`
  block: listening state, owning PID, and a real connect test (an `ssh -L` can
  hold the socket while the forward behind it is dead).

**The re-run is tagged `issue152-phaseg-smoke-r2`.** r1's tag is retained here
as the label of an inadmissible run, so a later telemetry query cannot
accidentally treat the two as one body of evidence.

---

## 20. Phase G — P3 run 1 VALID (269/270); one corpus-contract defect, corrected (2026-09-09)

The first *admissible* P3 run. Unlike attempt 1 (§19.2) nothing was throttled
and unlike smoke r1 (§19.7) the tunnel was up, so this run's semantics count.

### 20.1 What was run

| | |
|---|---|
| Tag | `issue152-phaseg-p3-r1` |
| Started | 2026-09-09T01:15:13Z |
| Corpus | merged B+C+E, 270 rows (212 plan / 58 decline), fixed phase order |
| Pacing | 2,200 ms at **one** worker; 3 batches, 11.3 min |
| Preserved | `nl-ui-out-152-phaseg/p3-new-family/` (`run-manifest.json`, `summary.json`, `observations-w0.jsonl`, `playwright.json`) |

```text
NL UI sweep — 270 of 270 questions observed
  pass 269   fail 1   unscored 0
  outcomes: answered 211  unanswerable 16  absent 43  http_error 0  page_error 0
  filler-variant disagreements: 0
  loads with a client-side error (reported, not failed): 0
  failures by category: fkg_named_player 1
```

Every transport gate held: 270/270 observed, **0** `http_error`, **0**
`page_error`, **0** rate-limit detections, **0** unscored, **0** metamorphic
violations, **0** client-side errors. Playwright exit 0.

### 20.2 The sole failure was a defect in the corpus, not in the parser

`fkg_005` asked **"did gary ablett kick a goal with his first kick"** with an
`expected_status` of `plan`. Observed outcome: `absent` (HTTP 200 — the page
rendered, with no NL answer section).

That is the *correct* behaviour under a contract this issue did not write and
must not weaken. Two players in the directory are named **Gary Ablett** (ids
4700 and 4701; see the `ablett-0004` family measured for `AFLDB-ISSUE-153`),
and `src/search/nl/parser.ts:2092` states the resolver's rule outright:

> the resolver found SOMETHING, just nothing it would commit to — "ablett"
> surfaces both Gary Abletts below accept strength. That is an ambiguity, not
> an unknown word.

An unsuffixed "Gary Ablett" therefore resolves to `ambiguousPlayerMention`, and
the pipeline declines rather than silently answering about whichever record
sorted first. A question that cannot name one player **must not** be a `plan`
expectation. The row asserted the opposite, so the corpus was wrong and the
engine was right.

This is also why the fix is not "add an alias" or "prefer the junior". Guessing
between two real players is precisely the failure mode `playerId`/`matchedName`
telemetry exists to make visible (§ISSUE-110, `src/search/nl/plan.ts:1970`).

### 20.3 The correction — one row replaced, one row added

- **`fkg_005` plan row rewritten** to the suffixed form: *"did gary ablett jr
  kick a goal with his first kick"*, tagged `player,yes-no,suffix-alias`. This
  keeps the family's named-player coverage and now exercises the Jr/Jnr alias
  path (`src/search/nl/parser.ts:1383`) rather than an unresolvable mention.
- **`fkg_dec_007` added** to the first-kick-goal decline corpus with the bare
  wording — category `fkg_decline_ambiguous_player`, tags `player,ambiguous`.
  The observed `absent` is a legitimate decline (`tools/nl/ui-corpus.ts:172`),
  so the run-1 observation already stands as this row's red evidence.

Nothing else was touched: no parser, planner, compiler, renderer, vocabulary,
query, migration or grant change. `PARSER_VERSION` stays **37**.

### 20.4 New pinned Phase G P3 size — 271

Plan stayed **212** because `fkg_005` was *replaced*, not added; only the
decline side grew.

| | Before | After |
|---|---|---|
| coaching plan / decline | 99 / 25 | 99 / 25 |
| after-the-siren plan / decline | 93 / 27 | 93 / 27 |
| first-kick-goal plan / decline | 20 / 6 | 20 / **7** |
| **Total** | 270 (212 / 58) | **271 (212 / 59)** |

`build-phase-g-corpora.ts` refused to build until this was recorded, which is
the guard working as designed:

```text
new: expected 270 rows, merged 271. A tracked corpus changed size --
update PHASE_G_SETS and the issue record together, rather than loosening the gate.
```

**The guard was not loosened.** `PHASE_G_SETS.new.expected` is now
`{ rows: 271, plan: 212, decline: 59, unknown: 0 }` and the merged output is
renamed `phase-g-new-family-271.csv`. Harness files updated to match, all
counts pinned rather than relaxed: `tools/issue-152/build-phase-g-corpora.ts`,
`phase-g-new-corpus.ps1` (banner, decline gate, manifest `kind`, GREEN line),
`phase-g-verify.ps1` (step 3 expectation), `phase-g-smoke.ps1` (banner text),
`tools/issue-152/README.md`. `phase-g-status.ps1` needed no change — it counts
data lines at run time and hard-codes nothing.

### 20.5 What P3 run 1 does and does not prove

**Proves.** The transport is honest end to end, and 269 of 270 rendered
answers agree with the corpus — including all 58 decline expectations and all
212 plan expectations except the defective row. This is the first semantic
evidence for Phases B, C and E through a real browser.

**Does not prove.** P3 acceptance itself. Two rows have never been observed in
their current form: the rewritten `fkg_005` and the new `fkg_dec_007`. P3-r2
must run the full 271 — a partial re-run of the two changed rows would not
re-establish the metamorphic groupings or the transport gates.

### 20.6 Status

Phase G P3 is **NOT YET GREEN — one valid run, one corpus defect found and
fixed, re-run required.** Tag the re-run `issue152-phaseg-p3-r2`. P4 (the
1,495-row existing gate) is unchanged by this and has not been run.

> **SUPERSEDED 2026-09-09 — see §21.** The re-run was executed as
> `issue152-phaseg-p3r2` (not `…-p3-r2`) and passed **271/271**; P4 then ran as
> `issue152-phaseg-p4r1` and passed **1,495/1,495**. This section is retained as
> the record of how the corpus defect was found and corrected. Phase G is
> **COMPLETE**.
---

## 21. Phase G — COMPLETE 2026-09-09; P3-r2 271/271 and P4-r1 1,495/1,495

§9's Phase G gate — "New ISSUE-152 corpus; rendered DEV acceptance", conditional
on "1,435 + 60 unchanged and still green" — is **met**. Both sweeps ran to
completion through a real browser against a local production build of this
branch, every transport gate held, and **no expectation was relaxed to get
there**: the strict corpus-size guard, the decline gate and the 1,435/60 gate are
all still the gates they were.

### 21.1 The full Phase G run ledger

| Step | Run tag | Rows | Result |
|---|---|---|---|
| P1 build | — | — | **PASS** (§19.1) |
| P2 server | — | — | `npx next start -p 3100`, `afldb_test` over the 55432 tunnel |
| P3 attempt 1 | — | 270 | **INADMISSIBLE** — throttled, measured the rate limiter (§19.2) |
| Smoke r1 | `issue152-phaseg-smoke-r1` | 40 of 270 | **INADMISSIBLE** — infrastructure, not semantics (§19.7) |
| Smoke r2 | `issue152-phaseg-smoke-r2` | 40 of 270 | **PASS** — 40/40, paced transport clean |
| P3 r1 | `issue152-phaseg-p3-r1` | 270 | **VALID, 269/270** — one corpus-contract defect (§20) |
| P3 r2 | `issue152-phaseg-p3r2` | **271** | **PASS — 271/271** (§21.3) |
| P4 r1 | `issue152-phaseg-p4r1` | **1,495** | **PASS — 1,495/1,495** (§21.4) |

**Run tags as actually recorded.** §20.6 asked for `issue152-phaseg-p3-r2`; the
runs were tagged `issue152-phaseg-p3r2` and `issue152-phaseg-p4r1` (no hyphen
before the run number). The `run-manifest.json` files are authoritative and this
table matches them, not the earlier suggestion.

### 21.2 Smoke r1 vs smoke r2 — why the distinction is kept

Smoke r1 is retained in this record as **inadmissible infrastructure evidence,
not a failure**: the Windows-side PostgreSQL tunnel was not up, so the server
answered `ECONNREFUSED 127.0.0.1:55432` and the sweep measured a database that
was not reachable rather than the parser (§19.7). Smoke r2, run with the tunnel
up and the same 2,200 ms pacing at one worker, observed **40 of 40 rows,
40 answered, 0 `http_error`, 0 `page_error`, 0 rate-limit detections**. That is
what licensed the two full sweeps below: it proved the *transport* before an
80-minute run was spent proving semantics on it.

### 21.3 P3-r2 — the pinned 271-row new-family corpus, GREEN

| | |
|---|---|
| Tag | `issue152-phaseg-p3r2` |
| Started | 2026-09-09T02:04:42Z |
| Corpus | `phase-g-new-family-271.csv` — merged B+C+E, **271 rows (212 plan / 59 decline)** |
| Pacing | 2,200 ms at **one** worker; 3 Playwright batches, 11.3 min |
| Preserved | `nl-ui-out-152-phaseg/p3-new-family-r2/` (`run-manifest.json`, `summary.json`, `observations-w0.jsonl`, `playwright.json`) |

```text
NL UI sweep — 271 of 271 questions observed
  pass 271   fail 0   unscored 0
  outcomes: answered 212  unanswerable 16  absent 43  http_error 0  page_error 0
  filler-variant disagreements: 0
  loads with a client-side error (reported, not failed): 0
  no scored failures
```

Every gate held: **271/271 observed**, **0** fail, **0** unscored, **0**
`http_error`, **0** `page_error`, **0** rate-limit detections, **0** metamorphic
(filler-variant) disagreements, **0** client-side errors, `failuresByCategory`
empty. Playwright exit 0, 3 passed.

The 59 decline expectations resolve as **16 `unanswerable` + 43 `absent`** —
both are legitimate decline outcomes under `tools/nl/ui-corpus.ts:172`, and the
split is the corpus's, not a scoring relaxation. The 212 `answered` rows are
exactly the 212 plan expectations.

**Both rows changed after P3-r1 were observed in their current form**, which is
what §20.5 said P3-r2 had to establish: the rewritten `fkg_005` ("did gary
ablett jr kick a goal with his first kick") answered, and the new `fkg_dec_007`
(bare "gary ablett") declined. The full 271 was re-run rather than the two
changed rows, so the metamorphic groupings and the transport gates were
re-established, not inherited.

> **AFLDB-ISSUE-153 note (2026-09-09) — the run above is NOT superseded.**
> The 271-row P3 set contains no relationship or cross-domain row, so none of
> the five rows AFLDB-ISSUE-153 reclassified is in it. **271 = 212 plan + 59
> decline is unchanged**, and the run result above stands exactly as run.

### 21.4 P4-r1 — the existing 1,435 + 60 regression gate, UNCHANGED and GREEN

| | |
|---|---|
| Tag | `issue152-phaseg-p4r1` |
| Started | 2026-09-09T03:09:35Z |
| Corpus | `phase-g-regression-1495.csv` — the two tracked v3 corpora of 2026-08-22, merged, **unmodified** |
| Pacing | 2,200 ms at **one** worker; 15 Playwright batches, 1.1 h |
| Preserved | `nl-ui-out-152-phaseg/p4-regression-r1/` (same four artefacts) |

```text
NL UI sweep — 1495 of 1495 questions observed
  pass 1495   fail 0   unscored 0
  outcomes: answered 1435  unanswerable 60  absent 0  http_error 0  page_error 0
  filler-variant disagreements: 0
  loads with a client-side error (reported, not failed): 0
  no scored failures
```

**1,495/1,495 observed, 1,435 answered, 60 unanswerable, 0 fail, 0 unscored, 0
`http_error`, 0 `page_error`, 0 rate-limit detections, 0 metamorphic
violations, 0 client-side errors.** All 15 batches passed; Playwright exit 0.

The answered/unanswerable split is **exactly** 1,435 / 60 — the gate's own
shape. Three parser versions (34 → 37), two new grains, a deleted false decline
and three new fail-closed refusals moved **no** existing row in either
direction. `corpusSources` in the manifest names the two tracked CSVs directly,
so the gate was measured on the tracked files and not on a copy that had drifted.

### 21.5 What Phase G proves — and what it still does not

**Proves.** Rendered, browser-observed semantic acceptance for Phases B, C and
E: 212 plan and 59 decline expectations agree with the shipped code through the
real `/search` route, and the pre-existing 1,435/60 gate is untouched by all of
it. Transport honesty is proven independently of semantics — no throttling, no
HTTP or page errors, no unscored rows, in either sweep.

**Does not prove.** (1) Anything about **DEV or production**: both sweeps ran
against a local production build of this branch on `127.0.0.1:3100`, because DEV
serves `main`, which has neither the `coach_record` nor the `after_siren` grain
and none of the Phase E wording — a DEV sweep would have measured the wrong code
(§19.1). (2) Anything about **Phases D and F**, which have not started. (3)
`npm run build` for deployment purposes beyond the P1 gate, `nl:stress`, or any
deploy step. The migration ordering requirement is untouched: **092 AND 093 must
both reach `afldb_dev` and production BEFORE the code.**

### 21.6 The corpus correction, restated for the record

P3-r1 was a **valid** run whose single failure was a defect in the corpus, not
in the engine (§20.2). `fkg_005` asserted `expected_status = plan` for the
unsuffixed "gary ablett", but two players in the directory carry that name (ids
4700 and 4701), so the existing resolver contract classifies the bare mention as
`ambiguousPlayerMention` and declines rather than guessing which record sorted
first. **That contract is correct and was not weakened.** The plan row was
suffixed to "gary ablett jr" and the bare wording was added to the decline
corpus as `fkg_dec_007`, giving the final pinned size **271 = 212 plan + 59
decline**. `PHASE_G_SETS.new.expected` was updated to match; the strict
size guard that refused to build was **kept**, not loosened.

### 21.7 The Phase G harness — reusable, and what each piece is for

`tools/issue-152/` is now a complete rendered-acceptance workflow rather than a
set of one-off commands, and it is the reason r2 was cheap after r1 found a
defect:

| Script | Role |
|---|---|
| `phase-g-tunnel.ps1` | window 1 — the 55432 PostgreSQL tunnel whose absence made smoke r1 inadmissible |
| `phase-g-server.ps1` | window 2 — `next start -p 3100` against `afldb_test`, log preserved under `nl-ui-out-152-phaseg/server/` |
| `phase-g-verify.ps1` | static gates only: `tsc --noEmit`, `nl-ui-corpus.test.ts`, corpus build, `playwright --list`, and the pacing validator |
| `phase-g-smoke.ps1` | 40-row paced transport probe — run before, never instead of, a full sweep |
| `phase-g-new-corpus.ps1` | P3, the pinned 271 |
| `phase-g-regression.ps1` | P4, the 1,495-row existing gate |
| `phase-g-status.ps1` | counts data lines at run time and hard-codes nothing |
| `phase-g-diagnose.ps1` | post-mortem over a preserved run |
| `build-phase-g-corpora.ts` | merges the six tracked sources; **refuses to build on a size change** |
| `phase-g-common.ps1` | shared paths, gates, manifest writer, preservation |

The pacing validator in `phase-g-verify.ps1` step 5 is the guard that matters
most: `Number('2.2s')` is `NaN`, and before it existed a delay written that way
would have silently disabled pacing and reproduced §19.2's throttled run — a
sweep that *looks* paced, measures the rate limiter, and reports the result as
semantics. `"2.2s"` is now rejected with a non-zero exit and `2200` accepted,
and the script's own exit status is its verdict rather than its last child's.

**Preserved run output is immutable.** `Save-PhaseGRunOutput` claims a free
directory name under `nl-ui-out-152-phaseg/` and **refuses to overwrite an
existing one**, so a re-run cannot quietly replace the evidence it is meant to
be compared against. That contract is itself tested, offline and in a temporary
directory, by `tests/phase-g-preserve-static.test.ps1`.

### 21.8 Closeout validation, 2026-09-09

Non-destructive; no sweep, no server, no database, no Git write.

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **PASS** — clean, exit 0 |
| `nl-parser.test.ts` | **253 / 253** |
| `nl-plan.test.ts` | **136 / 136** |
| `nl-describe.test.ts` | **49 / 49** |
| `nl-audit-acceptance.test.ts` | **10 / 10** |
| `nl-ui-corpus.test.ts` | **37 / 37** |
| `nl-semantic-mapping.test.ts` | **159 / 159** |
| Combined | **6 files, 644 / 644 passed, 0 failed** |
| `phase-g-verify.ps1` | **PASS — all six gates, exit 0** |
| `phase-g-preserve-static.test.ps1` | **PASS — 30 assertions, exit 0** |

The 271-row and 1,495-row browser sweeps were **not** re-run: the closeout
changed only tracking prose, and re-running them would have proven nothing the
preserved manifests do not already hold.

### 21.9 Status — Phase G COMPLETE; ISSUE-152 stays OPEN

**Phase G is COMPLETE and GREEN.** P3 is green at the pinned 271 and P4 confirms
the 1,435/60 gate is unchanged.

**ISSUE-152 is NOT resolvable on this evidence.** What remains, unchanged by
Phase G:

1. **Phase D (family / father–son) has not started.** Its F1-dependent half
   (C1, FS1–FS3, FS6, decisions D6/D8) is blocked on `AFLDB-ISSUE-153`;
   C2/C3/C4/FS4 do not depend on F1 and may proceed.
2. **Phase F (cross-domain) has not started** and is gated on B–D being green
   (§9), so it cannot start ahead of D.
3. **Nothing from Phase G is committed**, and the branch is unmerged.
4. **No deploy.** Migrations **092 and 093 must both reach `afldb_dev` and
   production BEFORE the code**; `nl:stress` has not been run.
5. The four external `tests/integration/database.test.ts` dataset-count failures
   remain out of scope, uninvestigated and unedited.

---

## 22. Phase D — IMPLEMENTED 2026-09-09 (unblocked half only: C2, C3, C4, FS4)

Scope executed exactly as authorised: **C2, C3, C4, FS4**. Untouched and still
declining: **C1, C5/C6, FS1, FS2, FS3, FS6, D6, D8** — all of which remain with
`AFLDB-ISSUE-153`.

`PARSER_VERSION` **37 → 38**, one bump, with the plan/version-history entry.
**No migration.** The design stays at `player_career`; no family grain exists.

### 22.1 The evidence this phase was built on

The read-only evidence run of **2026-09-09 14:08:43** against `afldb_test` as
`afldb_app` (`default_transaction_read_only=on`, one backend pid start-to-end,
`ROLLBACK`) — script `ISSUE-152-phase-d-evidence.sql`, transcript
`nl-ui-out-152-phaseg/evidence/ISSUE-152-phase-d-evidence-afldb_test-20260909-140843.txt`.
Both are **retained**: the script is the reproducible pack and the transcript is
the measurement.

The facts the implementation actually rests on:

| Fact | Value | Where it is used |
|---|---|---|
| `parent_child` roles, exhaustive | **father → son, 127 of 127** | the role predicates in `has_afl_father` / `has_afl_son` / the three `*_of_player` builders |
| `sibling` roles | sibling/sibling 321, brother/sibling 74, sibling/brother 69, brother/brother 23, twin/twin 9, sister rows 2 (**neither linked**) | why "brother" stays LABEL-backed and why twins/sisters decline |
| `has_brother` population | **658**, of whom **0** have zero games | C2 is answerable as-is; no 0-game rows to explain |
| symmetric parent-or-child | **181** | `has_afl_parent_or_child` |
| `parent_child` fathers = `father_son_father` | **107 = 107**, overlap 107, neither side exclusive | the measured collapse; why **D8 cannot be decided from data** |
| linked fathers / selections with a linked father | **107 / 123** | FS4 |
| unlinked opposite side | present in both directions (Robert Walls → David Walls; Peter Morrison → Shane Morrison) | the fail-closed witnesses |
| same display name across a linked pair | **4 pairs**, including Gary Ablett **4700/4701** | answers are by id, never by name |

### 22.2 Red before green — the Stage-0 probe, recorded

`tests/tmp-issue152-phase-d-stage0.test.ts` was run against the pre-Phase-D
parser on **2026-09-09** and printed **31 of 31 NONE**: every C2, C3, C4 and FS4
wording declined, alongside the blocked controls. The distribution:

- **26** `unrecognised` at confidence 0.00;
- **1** `ambiguous` at 0.65 (`most games by a player with a brother who played
  AFL` — the ranking half parsed, the relationship half was a leftover token);
- **1** `low_confidence` at 0.15 (`father-son selections by club`);
- the remaining rows were the blocked controls, also `unrecognised`.

Three failure modes were named by that run and each one drove a design decision:

1. `who is Brent Harvey's son` reported the unsupported term **"brent harvey
   son"** — the relationship noun was being swallowed into the candidate player
   span, so the noun has to be claimed BEFORE the player scan;
2. `players with a brother who also played VFL/AFL` reported **"vfl/"** —
   `CONVERSATIONAL_FILLER` strips `afl` out of `VFL/AFL` and leaves a token that
   ends in a non-word character;
3. every blocked father-son form declined on the leftover tokens **"father-son"**
   and **"selections"**, which is exactly the mechanism Phase D must not disturb.

The probe has served its purpose and is **deleted**; this section is its durable
record.

### 22.3 Files changed

| File | Change |
|---|---|
| `src/search/grid-solver-spec.ts` | six new builders (catalogue **158 → 164**), plus the stale header count/paragraph corrected — it still claimed 137 builders and that family relationships were absent |
| `src/db/queries/grid-solver.ts` | six new `compileAxis` cases, additive only (69 insertions, 0 deletions) |
| `src/search/nl/plan.ts` | `relationshipSubject` on the plan; `NL_RELATIONSHIP_POPULATION_BUILDERS` / `NL_RELATIONSHIP_OF_PLAYER_BUILDERS` / `isRelationshipPlan`; the pairing validation; `PARSER_VERSION` 38 + history entry |
| `src/search/nl/vocab.ts` | the relationship vocabulary: the frame rule, the out-of-scope table, the FS4 cues, the D8 guard, the two noise lists |
| `src/search/nl/parser.ts` | `extractRelationship` (step 5e) and its four gates: the named declines, the per-player subject requirement, the grain gate, the plan attachment |
| `src/search/nl/describe.ts` | relationship wording (list, ranked, pinned) and the two answer caveats |
| `tests/nl-parser.test.ts` | the Phase D block (47 cases) + four fixture players |
| `tests/nl-plan.test.ts` | the validation block (8 cases) |
| `tests/nl-describe.test.ts` | the wording block (12 cases) |
| `tests/grid-solver-spec.test.ts` | catalogue count 158 → 164 |
| `tests/integration/nl-answers-relationships.test.ts` | **new**: 20 DB-backed cases against hand-written SQL |
| `tests/tmp-issue152-phase-d-stage0.test.ts` | **deleted** (§22.2) |

### 22.4 The six builders, and the three rules they encode

```
has_afl_father            person_b (the SON), father linked and played
has_afl_son               person_a (the FATHER), son linked and played
has_afl_parent_or_child   either side, the other linked and played  [role-blind]
brother_of_player(id)     label-backed sibling of the named person
father_of_player(id)      the named person's father
son_of_player(id)         the named person's son
```

1. **Direction is role-typed, never positional.** Every directional builder
   names `person_a_role = 'father' AND person_b_role = 'son'`. Today this
   changes nothing (127 of 127 rows are father → son); the day a mother-daughter
   row is loaded it is the only thing that keeps the answers correct.
2. **"Brother" stays label-backed** (`brothers` + `twin brothers`), reusing
   `has_brother` unchanged. `relationship = 'sibling'` also holds sisters and
   unsexed rows and is never read as "brother".
3. **An unlinked side is a name, never an identity.** Every builder requires the
   side it returns to be non-NULL, and every "played" builder requires the OTHER
   side to have `player_career_stats.games > 0` — the same fail-closed rule
   `has_brother` already used.

`has_afl_parent_or_child` is deliberately **role-blind**: direction is exactly
what that question does not ask, and it is the shape whose population (181) was
measured.

### 22.5 The list-cap contract — inspected, and REUSED, not re-invented

The instruction was to inspect the existing list-cap handling and reuse its
contract, and not to ship a knowingly truncated complete list. What the
framework actually has is **explicit over-cap disclosure, not an over-cap
refusal**:

- `answerList` computes `count(*) OVER ()` **before** `LIMIT`, so `payload.total`
  is the TRUE size of the qualifying set, never the page size;
- the headline is that true count — "**658 players match**", not a list;
- `NlAnswerSection.tsx` prints "**Showing 100 of 658**" under the table and
  labels it "658 total".

That is the contract every other family in this engine already answers under —
"who coached Richmond" (42), "players with 200 games" (thousands) — so Phase D
reuses it rather than inventing a refusal that would make this one family behave
unlike every other. **Nothing was paginated and nothing returns a silent 100.**

Phase D adds one thing on top, because the instruction's concern is real: an
answer carrying a relationship predicate now states the cap **in the answer
itself**, not only in the table footer —

> 658 players qualify. This answer lists the first 100 of them, most games
> first; it is not the whole list.

— alongside the always-on source boundary:

> AFLDB's family relationships come from a tracked, cited list of football
> families. A relative it has not linked to a player is a name only, and is
> counted nowhere here.

**Operator decision D20 — ACCEPTED 2026-09-09.** The operator accepted the
recommendation: relationship queries whose true result count exceeds 100 use
AFLDB's **existing capped-list disclosure contract**, not a Phase-D-specific
refusal.

The accepted contract, in full:

1. the **true total** is computed and reported — `count(*) OVER ()` before
   `LIMIT`, so it is the size of the qualifying set, never the page size;
2. the existing **capped table** is rendered;
3. `Showing 100 of N` is disclosed explicitly, by `NlAnswerSection.tsx`;
4. the **answer wording itself** states that the displayed rows are not the
   complete list;
5. **silent truncation is prohibited.**

No Phase-D-specific refusal is introduced for C2 (658), C3 (181) or FS4 (107)
merely because their totals exceed the cap. The count IS the answer to "which
players had a brother who played AFL", and refusing it while disclosing every
other family's over-cap list would be an inconsistency, not a safety gain.

D20 is held by five assertions in `tests/nl-describe.test.ts` (§23.4): the
headline is the true total and not the row count; the disclosure names both
numbers and the phrase "it is not the whole list"; and each of 658, 181 and 107
answers-with-disclosure rather than declining. The rendered half is covered by
the eight over-cap rows in the Phase D corpus (§23.1).

### 22.6 Wording

No Phase D answer uses "Players meeting every condition asked for". Every one
names the relationship:

| Shape | Rendered |
|---|---|
| population list | `Players with a brother who played VFL/AFL.` |
| ” | `Players with a father who played VFL/AFL.` / `… a son who played VFL/AFL.` / `… a parent or child who played VFL/AFL.` |
| FS4 | `Players whose son was selected under the father–son rule.` |
| per-player | `Brothers of Brent Harvey.` / `Sons of Brent Harvey.` / `Fathers of Cooper Harvey.` |
| ranked | `Highest career games among players with a brother who played VFL/AFL.` |
| pinned yes/no | `Dustin Martin has no recorded brother who played VFL/AFL.` |

"Family" appears in no answer: what a football family IS is precisely what
`AFLDB-ISSUE-153` has yet to decide, and the word would claim an answer to it.
"No **recorded** relative" is likewise deliberate — absence in a curated export
is not absence in life.

### 22.7 What still declines, and how each decline is kept

| Class | Example | Mechanism |
|---|---|---|
| FS1/FS2/FS3/FS6 (**D8**) | `father-son selections`, `Geelong father-son selections`, `father-son selections in 2022`, `father-son selections by club` | the **D8 guard**: any father-son wording that is not an explicit FATHER-side FS4 cue stops the extractor dead, consuming nothing, so the pre-existing leftover-token decline stands untouched |
| C1 / C5 / the family grain (**D6**) | `biggest football families`, `which family has the most AFL players`, `families with three AFL players` | no frame matches, so the extractor never fires and the pre-existing decline stands |
| sisters, twins, cousins, grandparents, aunts/uncles, spouses/in-laws, mothers/daughters | `which players had a twin brother who played AFL` | named declines, checked BEFORE every supported cue, each stating what the data actually holds |
| vague family wording | `who are Dustin Martin's family members`, `AFL players related to Phil Krakouer` | named decline; `related to` never broadens into "every relationship type" |
| pairings | `parent and child pairs who both played AFL` | a pair is not a player; named decline |
| ambiguous subject | `brothers of Gary Ablett` | fails closed — two real players 10.9 points apart, and answering for the higher-ranked one would silently pick a family member's family |
| unresolvable subject | `brothers of Some Unknown Person` | fails closed |
| club scope | `richmond players with a brother who played` | `validatePlan` — no relationship builder owns `clubFor` (the v33 rule) |
| season scope | `players with a brother who played since 2000` | `validatePlan` — no relationship builder owns a season range |
| venue / opponent / match type | `players with a brother who played at the mcg` | `validatePlan`'s existing predicate-scope gate |
| another grain | `most goals in 2015 by a player with a brother who played` | the parser's grain gate: a relationship at any grain but `player_career` would be dropped on the way to SQL (ISSUE-110), so it declines by name |

### 22.8 The one regression the RED tests caught

`Ben Cousins`. `PLAYER_NICKNAMES` maps `cousins` → `ben cousins`, so a bare
`\bcousins?\b` gate turned **"most goals by ben cousins"** into a family question
and declined it. This is why every relationship word in this vocabulary requires
a **frame** — an article, possessive, pronoun, copula, or `of`/`who`/`that` — and
why `by` is deliberately NOT one of the framing words. The case is now a
permanent test.

### 22.9 Validation

Everything below was run in this worktree on **2026-09-09**.

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **clean** |
| `tests/nl-parser.test.ts` | **300/300** (47 new) |
| `tests/nl-plan.test.ts` | **144/144** (8 new) |
| `tests/nl-describe.test.ts` | **61/61** (12 new) |
| `tests/nl-audit-acceptance.test.ts`, `tests/query-intent.test.ts`, `tests/nl-ui-corpus.test.ts`, `tests/gridley-compat.test.ts` | **green, unchanged** |
| `tests/grid-solver-spec.test.ts` | **16/16** (catalogue 164) |
| the nine remaining DB-free NL suites (regression corpus, semantic mapping, stress corpora, feedback, search log, h2h describe, expanded-corpus generator) | **485/485** |
| `tests/integration/nl-answers-relationships.test.ts` | **20/20**, DB-backed against `afldb_test` |
| `tests/integration/nl-semantic-mapping.test.ts`, `nl-answers.test.ts`, `nl-answer-boundary.test.ts`, `nl-vocab.test.ts` | **61/61** |
| `tests/integration/nl-answers-{after-siren,coaching,first-kick-goal,game-season,team-club}.test.ts` | **113/113** |
| `tests/integration/grid-solver.test.ts` | **206/208** — see §22.10 |

The DB-backed suite compares every builder against independently hand-written
SQL and asserts the measured populations (658 / 181 / 107 / 127) as a fixture
contract, the role inventory (0 non-father→son rows), both unlinked-side
witnesses, and the Gary Ablett identity trap.

**Two measured facts that contradicted the test author, not the code:**

1. At PLAYER level the label-backed brother set and the unsexed
   `relationship = 'sibling'` set are the **same 658 people** — every player
   reachable through a `siblings`/`twins`-labelled row is already reachable
   through a `brothers` row, and neither sister row has a linked side. The label
   restriction is still required (the ROWS differ), so the suite asserts the
   invariant — brother ⊆ sibling — rather than today's coincidence.
2. **Gary Ablett Snr has more than one recorded son**, so `son_of_player(4700)`
   correctly returns two ids. The identity assertion was rewritten to test what
   actually matters: the same-named son appears as his own id and no two rows
   collapse together.

### 22.10 Two `tests/integration/grid-solver.test.ts` failures that are NOT Phase D

```
solves the mapped ISSUE-076 won-final grid ...      expected 282 to be 283
solves the three ISSUE-103 finals-win cells ...     won_x_games_1: expected 3644 to be 3658
```

Both are a solver-versus-in-test-oracle disagreement on **won-final eligibility**,
stable across two consecutive runs. They are **provably not this phase**: the
Phase D diff adds 69 lines to `src/db/queries/grid-solver.ts` with **zero
deletions**, and the only deletions in `src/search/grid-solver-spec.ts` are six
comment lines. No executable line in the finals path was touched.

Not investigated, not edited, and no issue filed without the operator: the
recommendation is to allocate **`AFLDB-ISSUE-154`** (the next free ID) for a
solver-versus-oracle disagreement in `won_final` eligibility on `afldb_test`,
with the two failures above as its evidence.

### 22.11 Deviations from the brief, and why

1. **The over-cap forms answer with disclosure rather than refusing.** The
   framework has no over-cap refusal to reuse; it has explicit disclosure, and
   that is what "reuse its contract" resolves to. Recorded as **D20** in §22.5
   with the one-line reversal if the operator disagrees.
2. **`parent and child pairs …` declines** rather than answering as C3. A pair
   is not a player, and the instruction was explicit that Phase D builds no
   family grain.
3. **The catalogue header comment was corrected** (it claimed 137 builders when
   158 existed, and claimed family relationships were absent when `has_brother`
   had been there since ISSUE-118). `docs/search.md:346` still says 137 and was
   left alone — a documentation-only drift, outside this phase.
4. **`/\bare\b/` was added to the relationship clause noise** rather than to
   `STOPWORDS`. Every other copula is a stopword and this one is not, which is
   why "who ARE Brent Harvey's brothers" resolved a player called "are dustin
   martin". Fixing it globally would have been the better fix and a wider blast
   radius; it is contained to a relationship reading for now and recorded here
   as a candidate.

### 22.12 What Phase D does NOT do

- No family grain, no `family_key` grouping, no ISSUE-153 semantics.
- No migration; nothing in the schema changed.
- **No rendered/browser acceptance yet** — no Phase G re-run, no corpus rows
  added, no `nl:stress`, no deploy, and nothing committed.
- The DB-backed suite proves the SQL against `afldb_test`; it does not prove the
  rendered page. That is the next gate (§22.13).

### 22.13 Proposed rendered Phase D corpus (BUILT — see §23)

Additive only, in the Phase G shape: two new files under
`tests/nl-ui/corpora/`, merged by `build-phase-g-corpora.ts`, leaving the pinned
271 and 1,495 untouched until the operator approves the new totals.

`afldb-ui-questions-relationships-v1-<date>.csv` — **26 expected-answer rows**

| Family | Rows |
|---|---|
| C2 population | 4 (`which players had a brother who played AFL`, `players with a brother who also played VFL/AFL`, `which AFL players had brothers who played`, `AFL players with a brother who played`) |
| C2 ranked / pinned | 4 (`most games by a player with a brother who played AFL`, `most goals by a player with a brother who played`, `did Dustin Martin have a brother who played AFL`, `did Brent Harvey have a brother who played AFL`) |
| C3 symmetric | 3 |
| C3 directional | 4 (`players whose father also played AFL`, `players whose son also played AFL`, plus one ranked each) |
| C4 per-player | 6 (Brent Harvey brothers/son, Cooper Harvey father, Gary Ablett **Snr** son with the disambiguated name form, David Cloke's sons, Marcus Ashcroft's son) |
| FS4 | 5 (`fathers of father-son selections`, `which father-son fathers played the most games`, `most games by a father whose son was selected under the father-son rule`, `players whose son was selected under the father-son rule`, `did Brent Harvey have a son selected under the father-son rule`) |

`afldb-ui-questions-relationships-decline-v1-<date>.csv` — **22 expected-decline
rows**: the six blocked father-son forms, the three C1/C5 family-grain forms,
the eight out-of-scope relationship families, the two vague forms, the
ambiguous-subject form, the pairings form, and the four scope forms (club,
season, venue, other grain).

Pinned totals after the merge would become **P3 271 → 319** and **P4 1,495
unchanged**.

**Superseded by §23**, which is what was actually built. Two deviations from
the proposal above are recorded in §23.2; the counts (26 / 22 / 48) and the
families are unchanged.

### 22.14 Status

**Phase D (unblocked half) is TECHNICALLY COMPLETE and green at every gate that
does not need a browser.** ISSUE-152 stays **OPEN** for: the blocked Phase D
half (C1/FS1–FS3/FS6, with `AFLDB-ISSUE-153`), Phase F, the rendered Phase D
corpus and Phase G re-run, the uncommitted working tree, and the un-run deploy
(migrations **092 and 093 must reach `afldb_dev` and production BEFORE the
code**).

The rendered corpus and its acceptance harness are now built — §23. The
rendered RUN itself is still outstanding.

---

## 23. Phase D — rendered corpus and acceptance harness BUILT 2026-09-09

The gate §22.12 named as missing. Two additive corpora, one additive runner,
one additive merged set, and the static pins that hold all of it. **No sweep
has been run yet**; §23.7 is the exact command that runs it.

### 23.1 The two corpora

Additive only, in the Phase G shape, tracked under `tests/nl-ui/corpora/`:

| File | Rows |
|---|---|
| `afldb-ui-questions-relationships-v1-20260909.csv` | **26**, every one `plan` |
| `afldb-ui-questions-relationships-decline-v1-20260909.csv` | **22**, every one `decline` |
| | **48** |

Scope is the authorised half and nothing else — **C2, C3, C4, FS4**:

| Category | Rows | What it holds |
|---|---|---|
| `rel_brother_population` | 4 | the C2 list, four phrasings including `VFL/AFL` |
| `rel_brother_ranked` | 2 | C2 composed with a games ranking and a goals ranking |
| `rel_brother_pinned` | 2 | the pinned yes/no, including the **Ben Cousins** case |
| `rel_parent_child_symmetric` | 3 | C3 role-blind, list and ranked |
| `rel_parent_child_directional` | 4 | father and son directions, list and ranked each |
| `rel_of_player` | 6 | C4: Brent Harvey's brothers (two phrasings) and son, Cooper Harvey's father, Gary Ablett Snr's sons, David Cloke's sons |
| `rel_father_son_rule` | 5 | FS4 list, ranked, spelled-out and pinned |

The 22 decline rows are **one row per boundary**, each named by its category so
a phrasing that starts answering one of them fails the sweep by name rather
than silently: `rel_decline_family_grain` (C1/D6), `rel_decline_family_size`
(C5/C6), `rel_decline_fs1` / `_fs2` / `_fs3` / `_fs6` (D8, ISSUE-153),
`rel_decline_vague_family`, `rel_decline_vague_related`, `rel_decline_sister`,
`_twin`, `_cousin`, `_grandparent`, `_uncle`, `_in_law`, `_mother`,
`rel_decline_pairing`, `rel_decline_ambiguous_subject`, and the five scopes no
relationship builder owns — `rel_decline_scope_club`, `_season`, `_venue`,
`_opponent`, `_match_type`.

**The Ben Cousins regression (§22.8) is preserved as a rendered pair**: the
plan row `did Ben Cousins have a brother who played AFL` (the surname resolving
as a player while a relationship cue is present) sits opposite the decline row
`which AFL players are cousins` (the relationship word itself). The stronger of
the two is the plan row: it is the only corpus question where the collision and
a real relationship cue occur together.

### 23.2 Two deviations from the §22.13 proposal

1. **`did Brent Harvey have a brother who played AFL` was replaced by `did Ben
   Cousins have a brother who played AFL`.** The proposal's Harvey row was a
   second pinned C2 yes/no; the Cousins row is a pinned C2 yes/no that ALSO
   carries the §22.8 regression, and Brent Harvey is already pinned by
   `rel_026`. Coverage is strictly larger for the same row.
2. **Marcus Ashcroft's son was dropped for a second C3 ranked row.** `sons of
   Gary Ablett Snr` (2 sons) and `who are David Cloke's sons` (3 sons) already
   prove the multi-row per-player shape, and the spare row buys the symmetric
   C3 ranking, which otherwise had none.

Counts and families are otherwise exactly as proposed.

### 23.3 Every row was verified against `afldb_test` BEFORE being pinned

A throwaway DB-backed probe parsed all 48 questions through
`buildNlParseContext()` + `parseNlQuestion()` + `validatePlan()` and, for each
plan row, executed the real `executePlan()` and rendered it through
`describeAnswer()` / `answerCaveats()`. **48 of 48 behaved as the corpus
claims**, on the same database the sweep server uses. The probe was deleted;
this is its record.

What it established beyond the plan/decline verdict:

- the three over-cap populations render as measured — **658**, **181**, **107**
  — each with the D20 disclosure naming both numbers;
- `sons of Gary Ablett Snr` resolves the **father, id 4700** (2 sons), not the
  son — the identity trap of §22.9 point 2, now proven in the rendered path;
- `who are David Cloke's sons` returns **3**;
- the 22 decline rows split into **17 parser declines** (`status = none`) and
  **5 `validatePlan` refusals** (club, season, venue, opponent, match type) —
  both render as not-`answered`, which is what the sweep scores;
- the two pinned negatives render as an ANSWER, not an empty panel:
  `Dustin Martin — no` / `Dustin Martin has no recorded brother who played
  VFL/AFL`. `NlAnswerSection` only takes the `.empty` branch for
  `payload.kind === 'unanswerable'`, so a zero-row `player_career` still
  renders the "How was this calculated?" trace the sweep looks for.

### 23.4 D20, in code

`answerCaveats` already implemented the accepted contract (§22.5). What this
slice adds is the acceptance evidence for it — five assertions in
`tests/nl-describe.test.ts`:

- the headline is the **true total** and not the number of rows carried
  (658 reported from a 1-row payload);
- the disclosure names **both** numbers and the phrase `it is not the whole
  list`;
- **658, 181 and 107** each answer-with-disclosure rather than declining, with
  the relationship named in the interpretation.

Plus the eight over-cap rows in the corpus itself, which prove the same thing
through the rendered page.

### 23.5 The merged set, and why Phase G could not simply be widened

The accepted Phase G evidence is the historical statement **271 = 212 plan + 59
decline, green at P3-r2** (§21.3), and §19.3 identifies throttled rows by their
**position** in that corpus. Both statements stay checkable only while the
271-row corpus keeps its size AND its row order.

So Phase D **appends** rather than editing:

| Set | Output | Rows | Plan | Decline | Batches |
|---|---|---|---|---|---|
| `new` (Phase G P3) | `phase-g-new-family-271.csv` | 271 | 212 | 59 | 3 |
| **`current` (Phase D)** | `phase-d-current-new-family-319.csv` | **319** | **238** | **81** | **4** |
| `regression` (Phase G P4) | `phase-g-regression-1495.csv` | 1,495 | 1,435 | 60 | 15 |

`current` lists the six Phase B/C/E sources in the **same order** as `new`, then
the two relationship corpora. Rows 1–271 of the 319-row file are byte-for-byte
the 271-row file — checked with `diff` when it was built, and permanently by
`tests/nl-ui-corpus.test.ts`, which reads both merged files back through
`readUiCorpus` and compares the prefix. The Phase D rows are 272–319.

**238 = 212 + 26. 81 = 59 + 22. 319 = 271 + 48.**

### 23.6 Files changed

| File | Change |
|---|---|
| `tests/nl-ui/corpora/afldb-ui-questions-relationships-v1-20260909.csv` | **new**, 26 plan rows |
| `tests/nl-ui/corpora/afldb-ui-questions-relationships-decline-v1-20260909.csv` | **new**, 22 decline rows |
| `tools/issue-152/phase-d-corpus.ps1` | **new**: the Phase D acceptance runner (P5) |
| `tools/issue-152/build-phase-g-corpora.ts` | the `current` set, `PLAYWRIGHT_BATCH_SIZE` / `expectedBatches`, and a main-module guard so the unit suite can import the set table without writing into the evidence tree |
| `tools/issue-152/phase-g-common.ps1` | `Invoke-PhaseGCorpusBuild` accepts `current` (one `ValidateSet` entry) |
| `tools/issue-152/phase-g-verify.ps1` | `-Set new`/`-Set current`, defaulting to `new`; the pinned rows/plan/decline/batches now come from a per-set table |
| `tools/issue-152/README.md` | the new runner, the third set, the new generated paths |
| `tests/nl-ui-corpus.test.ts` | the Phase D corpus-shape block and the merged-set pins (§23.8) |
| `tests/nl-describe.test.ts` | the five D20 assertions (§23.4) |

**Nothing in `src/` changed in this slice.** Parser stays at **v38**, no
migration, no schema change. The historical Phase G runners, corpora and
preserved evidence are untouched.

### 23.7 The rendered Phase D acceptance run — NOT YET RUN

Three windows, unchanged from Phase G:

```powershell
# window 1
.\tools\issue-152\phase-g-tunnel.ps1

# window 2
.\tools\issue-152\phase-g-server.ps1

# window 3 -- static first, then the sweep (~12 minutes at 2,200 ms x 1 worker)
.\tools\issue-152\phase-g-verify.ps1 -Set current
.\tools\issue-152\phase-d-corpus.ps1
```

`phase-d-corpus.ps1` keeps every P3 guard for the reason P3 acquired it
(§19.2): 2,200 ms pacing at **one** worker, `NL_UI_LIMIT` refused rather than
inherited, a throttled load recorded as `page_error` and failing the gates, and
an `-OutName` claimed before the run and never overwritten. It adds four
refusals of its own — a corpus that is not 319/238/81, a corpus that does not
slice into 4 Playwright batches, the P3/P4 run tags, and a missing tunnel
(TCP probe; no psql and no database client anywhere in the script).

Run tag **`issue152-phased-p5`**, output preserved at
`nl-ui-out-152-phaseg/p5-phase-d-current/`. Expected: **319/319 observed, 0
failures, 0 unscored, 0 metamorphic, 0 rate-limit detections.**

### 23.8 Validation, 2026-09-09

Everything below was run in this worktree.

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **clean** |
| `tests/nl-parser.test.ts`, `nl-plan.test.ts`, `nl-describe.test.ts`, `nl-audit-acceptance.test.ts`, `query-intent.test.ts`, `grid-solver-spec.test.ts`, `nl-ui-corpus.test.ts` | **627/627** |
| `tests/nl-regression-corpus.test.ts`, `nl-stress-corpus.test.ts`, `nl-expanded-ui-corpus-generator.test.ts`, `gridley-compat.test.ts` | **232/232** |
| `tests/integration/nl-answers-relationships.test.ts` | **20/20**, DB-backed against `afldb_test` |
| `tests/integration/nl-semantic-mapping.test.ts` | **22/22** |
| `phase-g-verify.ps1 -Set current` | **PASS** — corpus 319/238/81, `playwright --list` enumerated **4** batch tests, `2.2s` rejected |
| `phase-g-verify.ps1` (default, `new`) | **PASS** — corpus 271/212/59, **3** batches. Unchanged. |
| `tests/phase-g-preserve-static.test.ps1` | **PASS**, 30 assertions |
| the 48-row DB-backed corpus probe (§23.3) | **48/48**, then deleted |

The static pins are stated **three times, independently** — in
`PHASE_G_SETS.current`, in `phase-d-corpus.ps1`, and in
`tests/nl-ui-corpus.test.ts` — so a corpus edit has to be made three times on
purpose before a sweep can quietly change size.

`tests/integration/grid-solver.test.ts` still has the **two** finals failures of
§22.10. They are outside ISSUE-152, were not investigated and were not
modified, and that suite is **not** claimed green.

### 23.9 Status

Phase D's rendered corpus and acceptance harness are **BUILT and statically
green**. The rendered RUN is the next action and has not been performed.

ISSUE-152 stays **OPEN** for:

- the **rendered Phase D acceptance run** (§23.7) and the P4 regression re-run;
- the **blocked Phase D half** — C1, C5/C6, FS1, FS2, FS3, FS6, and the D6/D8
  decisions — which remain with `AFLDB-ISSUE-153` and are covered here only by
  decline rows;
- **Phase F**;
- the uncommitted working tree;
- the un-run deploy — migrations **092 and 093 must reach `afldb_dev` and
  production BEFORE the code**.

No Git write, commit, merge or deploy was performed in this slice.

---

## 24. Phase D — RENDERED ACCEPTANCE COMPLETE AND GREEN 2026-09-09 (P5-r2 319/319, P4-r1 1,495/1,495)

§23 built the Phase D corpus and harness and left the rendered run as the next
action. It has now been performed. **The unblocked Phase D slice — C2, C3, C4
and FS4 — is complete and green through a real browser against a real build.**

`PARSER_VERSION` stays **38**. **No migration.** Nothing in `src/` changed
during acceptance or closeout — the only edits since `50f8c54` that touch
executable behaviour are the Phase D implementation of §22, which was already
green before the sweep started.

### 24.1 P5 attempt 1 — INADMISSIBLE, and why it is recorded rather than deleted

The first P5 attempt is **inadmissible evidence and is not counted anywhere**.
It ran against a **stale, pre-Phase-D standalone build**: the sweep exercised
the transport correctly, but the code under it did not contain the six new
relationship builders, so every relationship row measured the old parser.

This is the same class of defect as §19.2 and §19.7 — a run whose transport is
sound and whose *subject* is wrong — and it is kept for the same reason: a
Phase G/D run that looks clean is not automatically a run that measured this
branch. The pre-run discriminator below exists because of it.

### 24.2 The discriminator — Phase D rendering proved BEFORE P5-r2 was started

Before P5-r2 was launched, a **fresh discriminator** was run against the rebuilt
standalone server to prove the served build actually contained Phase D: a
relationship question that only the §22 builders can answer was asked through
the running server and **rendered a Phase D relationship answer**, not the
pre-Phase-D decline.

That check is what makes P5-r2 admissible. Without it, 319 green rows prove only
that 319 rows agreed with something.

### 24.3 P5-r2 — the merged 319-row `current` set, GREEN

| | |
|---|---|
| Run tag | `issue152-phased-p5r2` |
| Preserved output | `nl-ui-out-152-phaseg/p5-phase-d-current-r2/` |
| Observed | **319 / 319** |
| Answered | 238 |
| Unanswerable | 21 |
| Absent | 60 |
| Pass | **319** |
| Fail | **0** |
| Unscored | **0** |
| Rate-limit detections | **0** |
| `page_error` | **0** |
| `http_error` | **0** |
| Filler disagreements | **0** |
| Client-side errors | **0** |
| Playwright batches | **4 / 4 passed** |

238 + 21 + 60 = 319, and 238 plan / 81 decline is exactly the pinned
`PHASE_G_SETS.current` shape asserted independently in three places (§23.7).

> **AFLDB-ISSUE-153 note (2026-09-09) — the run above is preserved as run; the
> SPLIT it names is superseded.** The P5-r2 result — 319/319 observed, 238
> answered, 0 fail — is a historical measurement of the code and corpus of
> 2026-09-09 and is NOT rewritten. What has moved since is the pinned
> plan/decline split: AFLDB-ISSUE-153 Stages 2-4 shipped FS1, FS2, FS3 and FS6,
> so four rows of the relationship decline corpus are reclassified IN PLACE —
> `rel_dec_003` (FS1), `rel_dec_004` (FS2), `rel_dec_005` (FS3) and
> `rel_dec_006` (FS6) — and `PHASE_G_SETS.current` is re-pinned **319 = 242
> plan + 77 decline**. Row count, row ids and row order are untouched, so every
> position-based statement in §19.3, §23 and §24 still holds. The 238/81 shape
> named in this section describes the run as it happened, not the current pin.

### 24.4 P4-r1 — the 1,495-row regression gate, re-run fresh and UNCHANGED

| | |
|---|---|
| Run tag | `issue152-phased-p4r1` |
| Preserved output | `nl-ui-out-152-phaseg/p4-regression-phase-d-r1/` |
| Observed | **1,495 / 1,495** |
| Answered | 1,435 |
| Unanswerable | 60 |
| Pass | **1,495** |
| Fail | **0** |
| Unscored | **0** |
| Rate-limit detections | **0** |
| `page_error` | **0** |
| `http_error` | **0** |
| Filler disagreements | **0** |
| Client-side errors | **0** |
| Playwright batches | **15 / 15 passed** |

The 1,435 + 60 shape is **identical** to P4-r1 under Phase G (§21.4). Four
parser versions, three new grains, a deleted false decline and six new grid
builders have moved **no** existing answer in either direction.

This is a **fresh** run under its own tag against the Phase D build — not a
citation of the Phase G result.

### 24.5 Historical Phase G evidence does not move

The Phase G P3 and P4 preserved runs are **untouched**. Phase D appended a
separate `current` set whose first 271 rows are byte-for-byte the pinned 271-row
file, so every position-based statement in §19.3, §20 and §21 survives
unchanged. `phase-g-new-corpus.ps1` still runs exactly the accepted
271 = 212 + 59 corpus, and `phase-g-verify.ps1` with no `-Set` still reports it.

Preserved output remains immutable: a re-run under an already-claimed `-OutName`
is refused, not overwritten (`tests/phase-g-preserve-static.test.ps1`).

### 24.6 What this slice does and does not close

**Complete and green:** **C2**, **C3**, **C4**, **FS4**.

**Still incomplete, blocked, or deliberately out of this slice:**

| Item | State |
|---|---|
| **C1** | BLOCKED on `AFLDB-ISSUE-153` (F1). Decline row only. |
| **C5**, **C6** | Out of this slice. Decline rows only. |
| **FS1**, **FS2**, **FS3**, **FS6** | BLOCKED on `AFLDB-ISSUE-153` (F1). Decline rows only. |
| **D6**, **D8** | Deferred operator decisions; sit with `AFLDB-ISSUE-153`. |
| **Phase F** | NOT STARTED. Gated on B–D (§9). |

Every blocked boundary above is held by a **named decline row** in the rendered
corpus, so the refusal is a measured behaviour and not an absence of coverage.

**D20 is ACCEPTED** (§22.5, §23.4) and its capped-list disclosure contract is
now proved end-to-end: the eight over-cap rows rendered a true total, the
existing capped table and explicit "Showing 100 of N" wording, with no
Phase-D-specific refusal introduced for 658 / 181 / 107.

The **authoritative `afldb_test` evidence of Stage 0 remains the basis** for
every semantic claim in this issue. The rendered sweep confirms the browser
agrees with it; it does not replace it.

### 24.7 Closeout validation, 2026-09-09

Non-destructive. Run in this worktree after P5-r2 and P4-r1. **No sweep was
re-run — no executable behaviour changed during closeout.**

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **clean**, exit 0 |
| 16 focused DB-free NL suites (parser, plan, describe, audit-acceptance, ui-corpus, regression-corpus, stress-corpus, stress-v2, semantic-mapping, head-to-head-describe, feedback, answer-feedback-boundary, search-log, expanded-ui-corpus-generator, query-intent, admin-nl-search-actions) | **1,107 / 1,107**, 16/16 files |
| `tests/grid-solver-spec.test.ts` | **16 / 16** |
| `tests/integration/nl-answers-relationships.test.ts` | **20 / 20**, DB-backed against `afldb_test` |
| `tests/integration/nl-semantic-mapping.test.ts` | **22 / 22**, DB-backed against `afldb_test` |
| `phase-g-verify.ps1 -Set current` | **PASS**, all six gates — corpus **319 / 238 / 81**, `playwright --list` enumerated **4** batches, `2.2s` rejected, `2200` accepted |
| `phase-g-verify.ps1` (default, `new`) | **PASS**, all six gates — corpus **271 / 212 / 59**, **3** batches. **UNCHANGED.** |
| `tests/phase-g-preserve-static.test.ps1` | **PASS**, 30 assertions |
| `git diff --check` | **clean** — no whitespace errors, no conflict markers |

The two DB-backed suites were run over the operator's `55432` SSH forward to
`afldb_test`. Read-only NL answer assertions; production untouched; no
migration, privilege or state-changing command was issued.

### 24.8 The two `tests/integration/grid-solver.test.ts` failures are still NOT ISSUE-152

Unchanged from §22.10 and §23.8: that suite still has **two** won-final
failures (282 vs 283, 3,644 vs 3,658). They are **outside ISSUE-152**, were not
investigated, were not touched during acceptance or closeout, and that suite is
**not** claimed green. Recommend allocating `AFLDB-ISSUE-154`.

### 24.9 Status

The **unblocked Phase D slice is COMPLETE, RENDERED and GREEN.** Phases B, C, D
(unblocked half), E and G are all green; the working tree is reviewed and ready
for the operator to stage.

**ISSUE-152 stays OPEN** for:

- the **blocked Phase D half** — C1, C5/C6, FS1, FS2, FS3, FS6 and the D6/D8
  decisions — which remain with `AFLDB-ISSUE-153`;
- **Phase F**, which has not started and is gated on B–D;
- the **uncommitted working tree** — everything since `50f8c54`;
- the **un-run deploy** — migrations **092 and 093 must both reach `afldb_dev`
  and production BEFORE the code**, or the telemetry grain CHECK drops rows
  silently while answers render correctly;
- the decision on whether `nl:stress` runs before deploy — it has still NOT been
  run for B, C, D or E.

**Do not resolve ISSUE-152 on this evidence.** No Git write, commit, merge or
deploy was performed in this slice.

---

## 25. Phase F — cross-domain composition implementation plan (PLAN ONLY, NOT IMPLEMENTED)

> **SUPERSEDED BY §26 (2026-09-09).** This section is the plan and remains
> the contract Phase F was built against; §26 records what was built, the
> five recorded deviations, and what is still outstanding. The status line
> below describes this section, not the phase.

**Status: PLANNED. Phase F has NOT started.** No executable source, migration,
corpus, test or `PARSER_VERSION` change was made by this section. The measured
`afldb_test` evidence of **2026-09-09** (F0–F8, recorded verbatim in §25.2) is
the authoritative semantic basis and is not re-derived below.

Gate satisfied: §9 requires B–D green before F. **B (§14), C (§16), E (§18), G
(§21) and D's unblocked half (§22–§24) are green**; D's remaining half is
formally deferred to `AFLDB-ISSUE-153` and is **not** a Phase F dependency —
none of C1, FS1, FS2, FS3, FS6, D6 or D8 supplies a predicate, a plan field or
a vocabulary rule that X1, X2 or X3 consumes, except through the single explicit
boundary named in **F-D1** (§25.13).

### 25.1 Exact scope recovered from the issue

Phase F owns exactly the three **X** families of §5.1, plus one Phase-B
deferral that §13.15(4) and §13.6 assigned to it by name:

| ID | Family | Source | IN Phase F |
|---|---|---|---|
| **X1** | Played AFL/VFL **and also coached** | §5.1, §5.2 F, D9 | **IN** |
| **X2** | Played for club X **and also coached** club X (or another club) | §5.1, §5.2 F, D9 | **IN** |
| **X3** | Father–son **selected** player who **also coached** | §5.1, §5.2 F, D9, §6.3 | **IN — conditionally, see F-D1** |
| **§13.15(4)** | "Richmond players coached by Damien Hardwick" — the `coached_by` + club ownership failure | §13.15(4): "It needs the `coached_club(org)` builder, which is **Phase F**. Declines until then." | **IN** |
| **§13.6 / A9 fallback** | "coached more than one club" if A9 had not shipped in Phase B | §13.6 | **OUT — moot.** A9 shipped in Phase B; the `organizations` metric exists on `coach_record`. Nothing carries over. |

Explicitly **OUT** of Phase F, unchanged and still declining:

- **"later"** in any form (D9, §11) — see §25.7.
- **C1, FS1, FS2, FS3, FS6, D6, D8** — `AFLDB-ISSUE-153`. Phase F introduces no
  wording, builder or plan field for any of them, and their existing named
  decline rows are untouched.
- **C5/C6**, sisters, twins, cousins, grandparents, in-laws, mothers — Phase D
  boundaries, untouched.
- Season, venue, opponent, round and match-type scope on any cross-domain
  question (§25.9).
- Any coach-versus-coach, assistant/caretaker, representative-side or
  coaching-tenure semantics (§13.15(6)–(8)).
- **Premiership players who became coaches**, if read as "premiership **as a
  player**": that is `premiership_coach` inverted and is *not* what §5.1 X2
  names. §5.1's X2 title is the evidence pack's label; **F2's measured
  population is the club-composition question** (played Richmond ∧ coached
  Richmond, 27), and that is what Phase F implements. The premiership reading
  is a different question with no measured population and is **OUT**.

### 25.2 Measured basis (2026-09-09, `afldb_test`, read-only, `afldb_app`)

Executed over the 127.0.0.1:55432 tunnel on one reserved backend under
`default_transaction_read_only=on`, `BEGIN TRANSACTION READ ONLY` … `ROLLBACK`.
Production untouched. **These are facts; Phase F does not re-measure them.**

| Ref | Fact | Value |
|---|---|---|
| **F0** | `coaches` rows / player-linked / coach-only | **386 / 368 / 18** |
| F0 | linked coaches whose player has AFL/VFL games | **368** (zero-game linked: **0**) |
| F0 | player ids linked to more than one coach row | **0** |
| **F1** | **X1 — played AND actually coached (`match_coaches` evidence)** | **365** |
| F1 | the weaker `coaches`-identity-only seam | 368 — **NOT the X1 semantic** |
| **F2** | **X2 — played Richmond ∧ coached Richmond** | **27** |
| F2 | Richmond `organization_id` / raw `club_ids` | **18** / `[18]` |
| F2 | coached Richmond, never played Richmond | **14** (Yze, Jeans, McQualter, Hardwick, Frawley, Rawlings, Gieschen, Walls …) |
| F2 | linked players who coached Richmond, played anywhere | **41** |
| **F3** | **X3 — father–son selection ∧ coached** | **1** — **Rhyce Shaw**, player 10974, coach 233, father 10853, selection club 5, draft year 1999 |
| F3 | father–son selections / selected unlinked / father unlinked | 127 / 28 / 4 |
| **F4** | raw club identities ≠ organizations for real coaches | Pagan **3/2**, Wallace **3/2**, Laidley **2/1**; Minogue 5 orgs, Northey 5, Malthouse 4, Blight 4, Barassi 4, Hafey 4, Walls 4 |
| **F5** | of the 365: coaching began strictly after the playing career | **238**; began before or during: **127**; chronology missing: **0** |
| **F6** | duplicate display names within X1 / across coaches | **0 / 0** |
| **F8** | negative witnesses available | player-linked coaches with no father–son selection (Kingsley, Simpson, Yze, Clarkson, Jeans); players with no coaching record (Aaron Black ×2, Cadman, Davey, Cerra) |

Top X1 witnesses (playing games / coached games): Malthouse 174/718, McHale
261/713, Sheedy 251/678, Jeans 77/576, Hafey 67/522, Parkin 211/518, Barassi
254/515, Matthews 332/461.

X2 witnesses (Richmond playing / Richmond coached): Hafey 67/248, Dyer 311/222,
Bentley 263/133, Hughes 87/120, Jewell 80/113, Minogue 94/101, Wallace 11/99,
Bartlett 403/88.

**Three consequences that drive the whole design:**

1. **F1 vs the 368 seam.** A `coaches` row is an identity, not proof that the
   person coached a match. X1 must be `match_coaches`-backed. `premiership_coach`
   already reads `coaches ⋈ match_coaches` and is the shape to copy; a naive
   `EXISTS (SELECT 1 FROM coaches WHERE player_id = p.id)` returns **368** and
   is the exact regression the oracle suite must forbid.
2. **F4 kills raw club equality.** `match_coaches.club_id` is a raw historical
   identity. Any coached-club scope must fold through
   `clubs.organization_id`, exactly as §13.6 requires for `coach_record`.
3. **F5 is why "later" still declines.** Chronology is *derivable* (238 vs 127,
   0 missing) — and that is precisely the trap. D9 declined "later" because the
   ordering is **not a stored, owned semantic**, not because it is
   uncomputable. Phase F does **not** reopen D9 (§25.7).

### 25.3 Operator matrix

Common to all three families: grain `player_career`, `agg: 'list'`,
`metric: null` unless a career metric is separately named, result grain **one
row per canonical player id**, identity keyed by `playerId` (F6 changes
nothing — §25.8), tie behaviour inherited from the existing
`rank()`-with-ties + `dedupeByIdentity` path, and the D20 capped-list
disclosure contract (§25.11).

#### X1 — played and also coached

| Aspect | Contract |
|---|---|
| Approved wording | "players who also coached", "players who went on to coach"¹, "which players both played and coached", "players who played and coached", "how many players have played and coached" |
| Mandatory decline | any "**later**" / "**afterwards**" / "**after they retired**" / "**before they coached**" temporal wording (§25.7); "premiership players who became coaches" (no measured population, §25.1) |
| Parser ownership | new cross-domain reading `coachReading = 'coached_population'`, elected inside the existing §1684 coaching block, **before** `coach_record` (§25.8) |
| Plan shape | `grain: 'player_career'`, `careerPredicates: [{ builder: 'has_coached', params: {} }]`, no `scope.clubFor` |
| Result grain | canonical players, one row each |
| Builder | **NEW `has_coached`**, parameterless (§25.4) |
| Coach/player seam | `coaches.player_id IS NOT NULL AND link_status_value = 'unique'` **AND** an actual `match_coaches` row — population **365**, never 368 |
| Club ownership | none; `scope.clubFor` present ⇒ **refuse** (`has_coached` owns no club) |
| SQL ownership | `has_coached` alone |
| Rendering | "Players who also played and coached." Never "later". |
| List / rank / count | `list` by default; `count` when the reader asks "how many"; a career metric ("most games among players who also coached") is admitted through the existing ranked path — this is **ranking players by a career metric**, not ranking the composition |
| Ties | existing `rank()`-with-ties; `dedupeByIdentity` on `playerId` |
| D20 | **365 > 100 ⇒ mandatory.** True total 365, 100 rows, explicit "Showing 100 of 365" caveat, silent truncation prohibited |

¹ "went on to coach" is **temporal wording** and is listed here only to be
refused. See F-D2 (§25.13) — the recommendation is to **decline** it with the
"later" family. It is written into this row so the ambiguity is decided
deliberately rather than by regex accident.

#### X2 — played for a club and also coached a club

| Aspect | Contract |
|---|---|
| Approved wording | "players who played for Richmond and also coached Richmond", "who both played for and coached Richmond", "Richmond players who also coached Richmond", "players who played for Richmond and coached Collingwood" (asymmetric, same shape) |
| Mandatory decline | "later"/"went on to" wording; a club named on only one side with the other side unstated ("Richmond players who also coached" — see F-D3, §25.13); any season/venue/opponent/round/match-type scope |
| Parser ownership | the same cross-domain reading, plus **role-scoped club extraction**: the playing club and the coached club are extracted as two independently-bound organizations |
| Plan shape | `grain: 'player_career'`, `careerPredicates: [{ builder: 'played_for_club', params: { club: '<orgA>' } }, { builder: 'coached_club', params: { club: '<orgB>' } }]`, **`scope.clubFor` left UNSET** |
| Result grain | canonical players, one row each |
| Builders | `played_for_club` **REUSED unchanged** (existing, org-lineage, `grid-solver.ts:255`) + **NEW `coached_club(club)`** |
| Coach/player seam | as X1 — `coaches.player_id` linked *and* a `match_coaches` row for that organization |
| Club ownership | **both clubs are builder parameters.** `scope.clubFor` is never set, so `careerPredicatesOwnClubFor` is never consulted and the generic playing-club `EXISTS` at `player-career.ts:155` is never emitted (§25.5 — this is the single most important structural decision in Phase F) |
| SQL ownership | `played_for_club` owns the playing org; `coached_club` owns the coached org; nothing else reaches SQL |
| Rendering | "Players who played for Richmond and also coached Richmond." Both club names always stated, on their own side of the sentence |
| List / rank / count | `list`; `count` on "how many"; career-metric ranking admitted as for X1 |
| Ties | as X1 |
| D20 | 27 is under the cap; the contract still applies unconditionally and fires for a larger organization |

#### X3 — father–son selected player who also coached

| Aspect | Contract |
|---|---|
| Approved wording | **explicit draft-rule wording only**, and only in composition with the coaching conjunct: "players selected under the father–son rule who also coached", "which father–son rule selections went on to coach"¹ |
| Mandatory decline | every bare/vague father–son form (D8, unchanged); the same wording **without** the coaching conjunct (that is FS1, still blocked); "later"/temporal wording; ranking wording of any kind |
| Parser ownership | a **son-side explicit-rule cue admitted only when the cross-domain coaching conjunct is present** (§25.8 step 4), otherwise the D8 guard at `vocab.ts:1074` stands unchanged |
| Plan shape | `careerPredicates: [{ builder: 'father_son_selection', params: {} }, { builder: 'has_coached', params: {} }]` |
| Result grain | canonical players; an **unlinked** selected player is a name in the source and can be no one (28 of 127 are unlinked) |
| Builders | `father_son_selection` **REUSED unchanged** (`grid-solver.ts:1279`, linked rows only) + `has_coached` |
| Club ownership | none; a club with X3 ⇒ refuse |
| SQL ownership | the two builders, ANDed |
| Rendering | "Players selected under the father–son rule who also coached." |
| List / rank / count | **LIST ONLY.** `count` is admissible ("how many"), `max`/`min`/`top_n` are **refused** (§25.10) |
| Ties | not applicable — no ranking exists to tie |
| D20 | population **1**; the contract applies and never fires |

¹ again temporal — refused under F-D2 unless the operator decides otherwise.

### 25.4 Builder decision — two new builders, two reuses, one rejection

**Decision: Phase F adds exactly TWO new Grid Solver builders —
`has_coached` (parameterless) and `coached_club(club)` — and reuses
`played_for_club` and `father_son_selection` unchanged.** Catalogue **164 → 166**.

**What `coached_by` owns, and why it cannot serve.** `coached_by`
(`grid-solver-spec.ts:340`, `grid-solver.ts:935`) takes **`coach` and nothing
else**, and answers *"players who were coached by this coach"* — its SQL joins
`player_match_stats` to `match_coaches` on `(match_id, club_id)` and filters
`mc.coach_id = $1`. Three independent reasons it cannot represent Phase F:

1. **Wrong subject.** Its result set is the coach's *players*, not the coach.
   X1/X2/X3 ask about people who **were** the coach.
2. **Wrong parameter.** It owns a *coach id*. It owns no club, which is exactly
   the §13.15(4) ownership failure: with `coached_by` in the predicate list a
   `scope.clubFor` is consumed by nothing and would reach SQL as nothing at all
   (ISSUE-110 finding B). §13.15(4) already names `coached_club(org)` as the
   Phase F fix.
3. **Wrong seam.** It never touches `coaches.player_id`, so it cannot express
   the player↔coach identity link at all.

**Overloading it is prohibited** — adding an optional club parameter would give
one builder two meanings ("coached by X" and "coached club Y"), which is the
ISSUE-110 two-spellings-of-one-question defect the catalogue exists to prevent.

**Why organization lineage must live inside the builder.** F4 measures the
divergence on real coaches (Pagan 3 raw / 2 orgs, Wallace 3/2, Laidley 2/1). If
the caller folded, every future caller would have to fold identically;
`match_coaches.club_id` is the raw historical identity and §13.6 already makes
folding the compiler's job. `coached_club` therefore takes the **organization
id** — the same `club()` param type `played_for_club`, `club_captain` and
`first_kick_goal_for_club` already take, whose `NlClubRef.organizationId`
(`plan.ts:381`) is already lineage-level — and folds inside its own SQL. A
rename folds; a merger never does; both follow from `organization_id` with no
special case.

**Does X1 need its own predicate, or can it reuse something?** It needs
`has_coached`. Nothing existing expresses "this player coached at least one
match": `premiership_coach` is a strictly narrower feat (Grand Final winner),
`coached_by` is the wrong subject, and `coached_club` requires a club the X1
question does not supply. `has_coached` is `coached_club` with the club
predicate dropped — deliberately a separate parameterless key rather than an
optional parameter, matching how `club_captain` / `club_captain_any` are two
keys in the same catalogue.

**Can X2 be two independent predicates on `player_career`?** **Yes, and it
must be.** `played_for_club(orgA)` ∧ `coached_club(orgB)` is a conjunction of
two independently-compiled `EXISTS`/`IN` fragments over `p.id`, which is
exactly what `careerPredicates` is (§5.2 F: "a coaching predicate would be one
more"). It also makes the asymmetric question ("played for Richmond, coached
Collingwood") free, and it keeps each club owned by the builder that uses it.

Proposed SQL, mirroring `premiership_coach`'s existing seam and
`club_captain`'s existing lineage fold:

```sql
-- has_coached: played is asserted by the grid's own p.id domain; this
-- predicate asserts only that the person actually coached a match.
-- 365 with the match_coaches join; 368 without it (F1/F7).
p.id IN (SELECT c.player_id
           FROM coaches c
           JOIN match_coaches mc ON mc.coach_id = c.id
          WHERE c.player_id IS NOT NULL
            AND c.link_status_value = 'unique')

-- coached_club(<organization id>): the same seam, folded to a lineage.
p.id IN (SELECT c.player_id
           FROM coaches c
           JOIN match_coaches mc ON mc.coach_id = c.id
          WHERE c.player_id IS NOT NULL
            AND c.link_status_value = 'unique'
            AND mc.club_id IN (SELECT id FROM clubs WHERE organization_id = $1))
```

`link_status_value = 'unique'` is `premiership_coach`'s own rule
(`grid-solver.ts:944`) and is reused verbatim: F0 measures 368 unique links and
**0** player ids linked to more than one coach row, so the rule costs nothing
and keeps one identity contract across the catalogue.

**Group placement:** both go in the existing `Coaching` group beside
`coached_by` and `premiership_coach`. **No migration. No new table. No new
column.**

### 25.5 Grain and plan decision — no new grain, no new plan field, no migration

**Decision: everything stays on `player_career` + `careerPredicates`. Phase F
adds no grain, no plan field, no migration.**

Proof against the current type/validation/compiler contract:

- **Type.** `careerPredicates: GridAxisState[]` (max 8, `NL_LIMITS`) already
  carries parameterised builders; `has_coached` (0 params) and
  `coached_club` (1 club param) are ordinary members. Phase D needed
  `relationshipSubject` only because a *named person* had to be echoed back in
  the sentence; Phase F names no person that the predicates do not already bind
  as an organization.
- **Validation.** The ownership machinery Phase F needs already exists:
  `NL_CAREER_CLUB_OWNING_BUILDERS` / `careerPredicatesOwnClubFor`
  (`plan.ts:1203,1247`) and the `player_career` refusals at `plan.ts:1743`,
  `:1771`, `:1790`.
- **Compiler.** `answerPlayerCareer` compiles predicates through `compileAxis`,
  the grid solver's own catalogue, so two new builders are reachable with **no
  compiler change at all** (`player-career.ts` is not edited).
- **Rendering.** `answerCaveats` and `describePlayerCareerAnswer` already carry
  the capped-list contract and the "among …" ranked wording; Phase F extends the
  predicate→phrase maps, not the payload shape.

**The one structural trap, and the decision that avoids it.** If `coached_club`
were added to `NL_CAREER_CLUB_OWNING_BUILDERS` and X2 were expressed as
`scope.clubFor = Richmond` + `coached_club(18)`, then
`careerPredicatesOwnClubFor` returns true and `player-career.ts:155`
**suppresses the generic playing-club `EXISTS`** — silently answering "coached
Richmond" (41) instead of "played Richmond and coached Richmond" (27). The
suppression is correct for `first_kick_goal_for_club`, where the feat implies
playing for the club; it is **wrong** for coaching, where F2 measures 14 people
who coached Richmond without ever playing there.

**Therefore:**

- **X2 sets no `scope.clubFor` at all.** Both clubs are builder parameters.
- **`coached_club` is NOT added to `NL_CAREER_CLUB_OWNING_BUILDERS`.** It never
  needs to be, because it never coexists with `scope.clubFor` — and if a future
  parser bug ever produced that combination, the existing `plan.ts:1743` refusal
  fires and the question declines instead of answering the wrong one. Leaving it
  out is the fail-closed choice.
- A new named test asserts precisely this: a plan with `scope.clubFor` set
  **and** `coached_club` present is **refused**.

### 25.6 Club ownership rules (binding)

- Every coached-club scope compiles to
  `mc.club_id IN (SELECT id FROM clubs WHERE organization_id = $1)` —
  never `mc.club_id = $1`, never a raw `clubs.id`.
- The bound value is `NlClubRef.organizationId`, already lineage-level
  (`plan.ts:381`); no lookup is added.
- Renames fold, mergers never do — automatic from `organization_id`.
- F4's Pagan / Wallace / Laidley witnesses are pinned in the oracle suite
  (§25.12 T7) as the regression that catches a raw-id reintroduction.

### 25.7 Temporal boundary — "also" ships, "later" declines

**D9 is not reopened.** F5 makes chronology *derivable* (238 after, 127
before-or-during, 0 missing) and that changes nothing: the decline stands
because no builder, plan field or renderer **owns** a temporal ordering between
a playing and a coaching career. Supporting "later" would be a separate,
deliberate ownership/design decision — a new builder with its own measured
contract — and Phase F does not take it.

**Where the refusal lives — parser, by name, never a silent strip:**

- A new `CROSS_DOMAIN_TEMPORAL_RE` in `vocab.ts` matching
  `later`, `went on to`, `afterwards`, `after (?:he |they )?retired`,
  `after (?:his|their) playing (?:career|days)`, `subsequently`, `then coached`,
  `before (?:he |they )?coached`.
- Checked **inside the cross-domain reading, before any predicate is emitted**,
  and returning the existing named-decline shape used at `parser.ts:1928`:
  `report.confidence = 1`, a stated note, `{ status: 'none', reason: 'unrecognised' }`.
- The stated note is the honest one:
  *"AFLDB does not record the order of a person's playing and coaching careers,
  so it cannot answer whether one came after the other. Ask instead who both
  played and coached."*
- **The words are never consumed and never stripped.** A silent strip would turn
  "players who later coached Richmond" into the *different* question the
  evidence pack itself got wrong (§5.3.F: §6.1 is titled "later" and its SQL has
  no temporal predicate at all). That failure mode is the reason D9 exists.
- `validatePlan` carries the second half of the same invariant as a
  belt-and-braces refusal: **no plan may carry a temporal marker field**, because
  none exists — nothing to check, and nothing may be added.

### 25.8 Parser extraction order (one bump: v38 → **v39**)

Exactly **one** `PARSER_VERSION` bump for Phase F, documented in the `plan.ts`
history comment as every prior phase did.

The collision risk is concrete and must be measured before anything is written:
`COACH_CUE_RE` (`vocab.ts:290`) matches the bare word **"coached"**, so *today*
"players who played for Richmond and also coached Richmond" enters the §1684
coaching block, elects `coachReading = 'coach_record'`, finds no coach in the
directory, and reaches grain election with `scope.clubFor = Richmond` already
consumed by `extractClubs` (§1625) — `structuralOk` is **true** on
`!!scope.clubFor`. Whether that currently declines rests entirely on the
leftover-token confidence ratio. **This is a red-before-green probe, not an
assumption** — see §25.14 R0.

Ordering, as a numbered contract:

1. **Clubs (§1625) and seasons (§1659) stay where they are.** Unchanged. The
   clubs the cross-domain reading needs are already extracted, with their roles
   and text positions available from `ClubExtraction`.
2. **The cross-domain reading is elected FIRST inside the §1684 coaching
   block** — before `coached_by`, before `premiership_coach`, before
   `coach_record`. Its cue is a **composition cue**
   (`\b(?:also|both)\b` adjacent to a playing/coaching pair, `played and coached`,
   `both played and coached`, `played .* and (?:also )?coached`), not the bare
   `COACH_CUE_RE`. Electing after `coach_record` would be useless: `coach_record`
   is the block's fallthrough and would already have claimed the question.
3. **The temporal refusal (§25.7) runs immediately after election and before any
   predicate is emitted.** "Players who later coached Richmond" must decline
   *as a cross-domain question with a stated reason*, not as an unrecognised
   token soup.
4. **The X3 son-side cue runs only inside the cross-domain reading** (subject to
   **F-D1**), after the temporal refusal. Outside it, `FATHER_SON_RULE_RE`'s D8
   guard (`vocab.ts:1074`) is **untouched** and FS1/FS2/FS3/FS6 keep declining
   on their own leftover tokens exactly as §22 left them.
5. **Club-role assignment.** The playing club is the organization named on the
   playing side of the composition; the coached club is the one on the coaching
   side. One club named for both sides binds both parameters to the same org
   (the Richmond case, 27). Ambiguity here is a **decline**, not a guess
   (F-D3, §25.13).
6. **`extractRelationship` (§1925) is unchanged and still runs after.** A
   cross-domain plan that reached it would already have consumed its cues.
7. **The generic player-name scan is unchanged and still runs after the coaching
   block** — the §1684 comment's whole point: 368 of 386 coaches share a name
   with a player, and X1/X2/X3 name **no person at all**, so no coach or player
   name may be resolved by them. A cross-domain question that *does* carry a
   person name (F-D3's "did Mick Malthouse play and coach") is out of Phase F
   scope in this plan and declines.
8. **Match type, round, venue, opponent extraction unchanged.** Anything they
   set on a cross-domain plan is refused in `validatePlan` (§25.9), never
   dropped.
9. **Grain election (§2348) gains one branch:** `coachReading ===
   'coached_population'` ⇒ `grain = 'player_career'`, placed **before** the
   `coachReading === 'coach_record'` branch. `structuralOk`'s existing
   `player_career` clause already accepts `careerPredicates.length > 0`, so no
   confidence-model change is needed.
10. **`careerPredicates` emission** joins the existing block at `parser.ts:2770`
    beside `coached_by` / `premiership_coach`.

### 25.9 `validatePlan` ownership — fail-closed rules

Every rule below refuses; none drops a filter. No scope reaches SQL unless a
compiler or builder explicitly owns it.

| # | Condition | Refusal |
|---|---|---|
| V1 | `coached_club` present **and** `scope.clubFor` set | "This kind of career question cannot be limited to one club." — the existing `plan.ts:1743` rule, which fires because `coached_club` is deliberately **not** in `NL_CAREER_CLUB_OWNING_BUILDERS` (§25.5) |
| V2 | any cross-domain predicate **and** `scope.seasonMin`/`seasonMax` | existing `plan.ts:1790` — neither new builder owns a season, so a season range fails closed |
| V3 | any cross-domain predicate **and** `scope.venue` / `clubAgainst` / `matchType` / `roundNumber` | existing `plan.ts:1771` career-scope refusal |
| V4 | `has_coached` **and** `scope.clubFor` | V1's rule; `has_coached` owns no club either |
| V5 | `has_coached` **and** `coached_club` in one plan | **new** — "A coaching question already scoped to a club must not also ask the unscoped one." Prevents a redundant/contradictory pair reaching SQL |
| V6 | `father_son_selection` present **and** `agg.kind` is `max`, `min` or `top_n` | **new** — "A father–son selection question is a list, not a ranking." (D9: X3 is a list, never a ranking) |
| V7 | `father_son_selection` present **without** a coaching predicate | **new, and the F-D1 boundary made explicit** — "AFLDB cannot yet answer what 'father–son' means on its own." FS1 stays blocked |
| V8 | any bare/vague father–son wording | unchanged — never reaches `validatePlan`; the parser's D8 guard stops it |
| V9 | grain is `coach_record` **and** a cross-domain predicate is present | **new** — the coach-only grain (18 coach-only people, F0) must never leak into player-career semantics, and vice versa |
| V10 | any cross-domain predicate at a grain other than `player_career` | **new** — "A question about who both played and coached is answered at career grain." |
| V11 | a temporal marker of any kind | structurally impossible: no plan field exists and none is added (§25.7) |

### 25.10 SQL and builder semantics — the three populations

| Family | Compiled shape | Expected on `afldb_test` |
|---|---|---|
| **X1** | `has_coached` alone | **365** — *not* 368. The `match_coaches` join is the whole difference and is asserted by its own oracle test (§25.12 T8) |
| **X2** | `played_for_club(18)` **AND** `coached_club(18)` | **27**. Both halves preserved: `played_for_club` alone would over-count, `coached_club(18)` alone returns **41** (F2), and the two must intersect |
| **X3** | `father_son_selection` **AND** `has_coached` | **1** — Rhyce Shaw (10974). Linked rows only; the 28 unlinked selected players are names, not identities |

`has_coached`'s `match_coaches` join is a hard requirement of the semantic, not
an optimisation: mere existence of `coaches.player_id` is an identity claim and
nothing more.

### 25.11 Rendering contract

Extend the existing Phase D machinery in `describe.ts`; add no new payload kind.

- **Subject phrases** (a `CROSS_DOMAIN_PHRASE` map beside
  `RELATIONSHIP_WITH_PHRASE`):
  - `has_coached` → *"Players who also played and coached."*
  - `played_for_club(A)` + `coached_club(A)` → *"Players who played for
    Richmond and also coached Richmond."*
  - `played_for_club(A)` + `coached_club(B)` → *"Players who played for
    Richmond and also coached Collingwood."*
  - `father_son_selection` + `has_coached` → *"Players selected under the
    father–son rule who also coached."*
- **"Later" is never rendered**, in any string, under any branch, unless a
  future separate operator decision approves the semantics. A grep-level test
  asserts the token is absent from every Phase F wording constant.
- **Ranked composition** reuses the Phase D "among …" wording: *"Most career
  games among players who also played and coached."*
- **Capped-list disclosure (D20, reused verbatim).** `answerCaveats`
  (`describe.ts:619`) is gated today on `isRelationshipPlan`. Phase F adds a
  sibling `isCrossDomainPlan(plan)` and the two share one caveat body, so there
  is **one** cap contract, not two. For X1 with 365 qualifying and
  `NL_LIMITS.maxListRows = 100`:

  > *"365 players qualify. This answer lists the first 100 of them, most games
  > first; it is not the whole list."*

  Silent truncation is prohibited. The table's own footer is not sufficient —
  the answer sentence itself must say it, exactly as D20 requires.
- **No coaching-completeness caveat is invented.** M1 (per-season coaching
  completeness) is still unmeasured; Phase F therefore makes no completeness
  claim in either direction.

### 25.12 Independent DB-oracle test matrix

New file `tests/integration/nl-answers-cross-domain.test.ts`, modelled exactly
on `tests/integration/nl-answers-relationships.test.ts`: every count compared
against **independently hand-written SQL**, with the measured F0–F8 fixture
contract asserted once so a data change is a deliberate decision.

| # | Pins | Guards against |
|---|---|---|
| **T1** | X1 answer count **= 365**, and equals hand-written `coaches ⋈ match_coaches` SQL | the core X1 semantic |
| **T2** | X2 answer count **= 27**, equals hand-written `player_clubs`/`match_coaches` intersection | the conjunction |
| **T3** | X3 answer count **= 1** | X3's population |
| **T4** | X3's single row **is player 10974, Rhyce Shaw** (id, not name) | identity by id |
| **T5** | Richmond **positives**: Hafey, Dyer, Bentley, Jewell, Bartlett, Minogue, Wallace, Hughes all present in X2 | false negatives |
| **T6** | Richmond **negatives**: Hardwick, Walls, Jeans, Yze, McQualter, Frawley, Rawlings, Gieschen **absent** from X2 (coached, never played there) — and Aaron Edwards / Fiora / Pattison absent (played, never coached there) | both directions of the conjunction |
| **T7** | **Lineage trap**: Pagan, Wallace, Laidley each satisfy `coached_club` for **every** organization they coached (2, 2, 1) and for **no** organization they did not; a raw-`club_id` implementation fails this | the F4 regression |
| **T8** | **The 368 seam**: hand-written `coaches WHERE player_id IS NOT NULL` ∩ played = **368**, X1 = **365**, and the difference is exactly the coach identities with **no `match_coaches` row** | X1 regressing to the identity-only seam |
| **T9** | father–son **negative**: Kingsley, Simpson, Yze, Clarkson, Jeans are in X1 and **absent** from X3 | X3 collapsing into X1 |
| **T10** | coaching **negative**: Aaron Cadman, Aaron Davey, Adam Cerra absent from X1 | X1 over-reaching |
| **T11** | **Identity**: both "Aaron Black" ids absent from X1 and never merged by name (F6/F8) | name-based identity |
| **T12** | D20: X1 `payload.total` **= 365**, `payload.rows.length` **= 100**, and the caveat string contains both numbers | silent truncation |
| **T13** | `validatePlan` refuses V1, V5, V6, V7, V9, V10 (one case each) | ownership fail-closed |
| **T14** | `coached_club(18)` alone = **41**; asserted so the X2 test is known to be measuring the intersection and not one half | a half-dropped conjunction |

DB-free suites extended in place (no new file): `tests/nl-parser.test.ts`
(cross-domain election, the temporal declines, the X3 composition boundary),
`tests/nl-plan.test.ts` (the V-rules), `tests/nl-describe.test.ts` (wording, the
"later" absence assertion, the cap sentence), `tests/grid-solver-spec.test.ts`
(catalogue **164 → 166**), `tests/nl-ui-corpus.test.ts` (the new pins).

### 25.13 Operator decisions required before Phase F is coded

| ID | Question | Recommendation |
|---|---|---|
| **F-D1** | **X3 needs an explicit son-side father–son cue, which is currently blocked.** §22's D8 guard admits *only* the FATHER-side FS4 wording; the SON side (`father_son_selection`, FS1) is deferred to `AFLDB-ISSUE-153`. X3 cannot be answered without it. Options: **(a)** admit the explicit son-side rule cue **only in composition with the coaching conjunct**, leaving standalone FS1 declining (V7); **(b)** defer X3 entirely until D8 is settled, shipping Phase F as X1 + X2 only. | **(b) — defer X3.** D8's own recorded ground is that *"no witness can distinguish the two readings"* (§7, D8), and that is still true inside a composition: option (a) also produces a product surface where "players selected under the father–son rule" declines but the same phrase plus "who also coached" answers — a difference no reader can predict. The measured population is **1 row**. The semantic cost is high, the yield is one player, and X3 is cleanly re-addable the day D8 lands. **If the operator prefers (a), the plan above is complete for it** — V7 is exactly the boundary it needs. |
| **F-D2** | Do "**went on to coach**" / "**became a coach**" / "**turned to coaching**" decline with "later", or read as "also"? | **Decline, with "later".** They assert the same ordering "later" does. D9's whole basis is that the ordering is unowned; admitting a synonym would reopen the decision by regex. |
| **F-D3** | A club named on only one side — "**Richmond players who also coached**" (played Richmond, coached anywhere = a real question) and "**players who coached Richmond and also played**" — answer or decline? | **Decline in Phase F.** Both are legitimate questions, but each needs its own role-scoped club binding and neither has a measured population in F0–F8. Declining them keeps Phase F to the three measured populations; each gets a named decline corpus row so the boundary is visible and re-openable. |
| **F-D4** | X2 currently plans `played_for_club`, which reads `player_clubs`. F2's **27** was measured from **Richmond playing games**. Are the two definitions identical here? | **One targeted evidence query is required** — the only genuinely missing fact in this plan. See §25.16. |

### 25.14 Implementation sequence

0. **R0 — red-before-green probe (mandatory, first).** A throwaway script, the
   §16.1 / §22.2 pattern, parses ~24 Phase F wordings against the current v38
   parser and prints each outcome. It must show that **no** X1/X2/X3 wording is
   currently answered. **If any wording currently returns a plan — especially
   the `coach_record`-election path in §25.8 — that is a live wrong-answer
   defect and must be recorded in this runbook before any code is written.**
   The probe is deleted afterwards, as §22.2's was.
1. Builders: `has_coached`, `coached_club` in `grid-solver-spec.ts` and
   `grid-solver.ts`; `grid-solver-spec.test.ts` 164 → 166.
2. Vocabulary: composition cues, `CROSS_DOMAIN_TEMPORAL_RE`, (F-D1(a) only) the
   son-side rule cue.
3. Parser: the cross-domain reading, in the order §25.8 fixes; `PARSER_VERSION`
   **38 → 39**, one bump, with the `plan.ts` history comment.
4. `validatePlan`: V5, V6, V7, V9, V10 (V1–V4 already exist and are asserted,
   not rewritten).
5. `describe.ts`: `isCrossDomainPlan`, the phrase map, the shared D20 caveat.
6. DB-free tests: parser, plan, describe, spec — **red first**.
7. `tests/integration/nl-answers-cross-domain.test.ts` — T1–T14, hand-written
   SQL, read-only against `afldb_test`.
8. Corpus: the two new tracked CSVs, `PHASE_G_SETS.next`, the runner, the pins
   (§25.15).
9. Rendered acceptance: build → discriminator → P6 → fresh P4 regression
   (§25.15).
10. Runbook §26 (implementation record), `IssuesIndex.md`, `issues.md`,
    `CHANGELOG.md` — the last only if behaviour materially changed, which for a
    shipped Phase F it will have.

### 25.15 Corpus and rendered acceptance plan

**The accepted historical sets do not move.** The Phase G `new` set stays
**271 = 212 + 59**; the Phase D `current` set stays **319 = 238 + 81** and
`phase-d-corpus.ps1` still runs exactly it. Phase F **appends** a third
generation, `PHASE_G_SETS.next`, whose first 319 rows are byte-for-byte the
319-row file, so every position-based statement in §19.3, §23 and §24 survives.

Two new tracked corpora, `tests/nl-ui/corpora/`:

| File | Rows |
|---|---|
| `afldb-ui-questions-cross-domain-v1-<date>.csv` | **14 plan** |
| `afldb-ui-questions-cross-domain-decline-v1-<date>.csv` | **16 decline** |

Plan rows (14): X1 plain ×3 (list, count, one filler paraphrase); **X1 capped
disclosure ×2** (the 365/100 sentence must render — the single highest-value
rendered assertion in Phase F); X1 ranked-by-career-metric ×1; X2 Richmond
symmetric ×3 (including a pinned positive that must contain Hafey and a pinned
form that must not contain Hardwick); X2 asymmetric ×1; X2 organization-lineage
regression ×2 (a Pagan/Wallace-shaped club whose raw and lineage ids differ);
filler variants ×2. **X3 contributes 0 plan rows under the recommended F-D1(b)**
— it becomes 2 plan rows (list form, count form) if the operator chooses (a).

Decline rows (16): "later" ×4 (X1, X2, X3 shapes, plus a "went on to" F-D2
form); unsupported scope ×5 (season, venue, opponent, round, match type on a
cross-domain question); vague father–son ×2 (unchanged D8 forms, re-pinned in
this generation); standalone explicit FS1 wording ×1 (V7 — the F-D1 boundary,
which stays a decline under either option); one-sided club ×2 (F-D3); ranked X3
×1 (V6); `coach_record` collision ×1 ("Richmond's coaching record" must still
answer as `coach_record`, pinned as a *plan* row rather than a decline —
counted in the plan column if the operator wants it, otherwise stated here as
the collision the parser must not break).

**Resulting totals:**

| Set | Rows | Plan | Decline | Playwright batches @ 100 |
|---|---|---|---|---|
| `new` (frozen, Phase G) | 271 | 212 | 59 | 3 |
| `current` (frozen, Phase D) | 319 | 238 | 81 | 4 |
| **`next` (Phase F)** | **349** | **252** | **97** | **4** |
| `regression` (frozen) | 1,495 | 1,435 | 60 | 15 |

349 = 319 + 30; 252 = 238 + 14; 97 = 81 + 16. Under F-D1(a) the totals are
**351 / 254 / 97**, still 4 batches. Pins stated three times independently, as
Phase D established: `PHASE_G_SETS.next`, the new
`tools/issue-152/phase-f-corpus.ps1`, and `tests/nl-ui-corpus.test.ts`.

**Rendered acceptance (P6), reusing the Phase G/D tooling unchanged:**

1. Fresh production build of this branch — DEV serves `main` and would measure
   the wrong code (§19.1).
2. **Stale-build preflight/discriminator**: a Phase-F-only question rendered on
   the running server *before* the sweep. P5 attempt 1 was inadmissible for
   exactly this reason (§24.1); the discriminator is not optional.
3. Immutable `-OutName` (preserved output refuses overwrite), **fresh
   `-RunTag`** (`issue152-phasef-p6…`), the P3/P4/P5 tags refused by name.
4. **2,200 ms pacing, ONE worker**, `NL_UI_LIMIT` refused not inherited,
   throttling classified as `page_error` and a hard failure.
5. Corpus guard: refuse anything that is not 349/252/97 and does not slice into
   4 batches; TCP tunnel probe, no database client in the script.
6. **100% of the current set must pass**, then a **fresh 1,495-row regression
   re-run**.

Acceptance requires, on both sweeps: **0 semantic failures, 0 unscored, 0 rate
limit, 0 page_error, 0 http_error, 0 filler disagreements, 0 client-side
errors.**

### 25.16 The one genuinely missing evidence query (F-D4)

Everything else in this plan is settled by F0–F8. One fact is not, and it
decides whether `played_for_club` is the right reuse for X2:

`played_for_club` reads `player_clubs` ("club identities actually
represented", `007_derived_stats.sql:127`), while F2's **27** was measured from
**Richmond playing games**. The definitions coincide only if no `player_clubs`
row carries `games = 0`. If any does, X2 via `played_for_club` would return a
number other than 27 and the builder choice must change to a games-backed
predicate.

Read-only, `afldb_test`, over the existing tunnel — three counts:

```sql
BEGIN TRANSACTION READ ONLY;

-- (1) Does player_clubs ever record a zero-game membership?
SELECT count(*) AS zero_game_memberships FROM player_clubs WHERE games = 0;

-- (2) X2 exactly as the plan would compile it (played_for_club ∧ coached_club).
--     Must equal 27.
SELECT count(*) AS x2_via_player_clubs
  FROM players p
 WHERE p.id IN (SELECT pc.player_id FROM player_clubs pc
                 WHERE pc.club_id IN (SELECT id FROM clubs WHERE organization_id = 18))
   AND p.id IN (SELECT c.player_id FROM coaches c
                  JOIN match_coaches mc ON mc.coach_id = c.id
                 WHERE c.player_id IS NOT NULL AND c.link_status_value = 'unique'
                   AND mc.club_id IN (SELECT id FROM clubs WHERE organization_id = 18));

-- (3) X1 exactly as the plan would compile it. Must equal 365, not 368.
SELECT count(DISTINCT c.player_id) AS x1_via_has_coached
  FROM coaches c
  JOIN match_coaches mc ON mc.coach_id = c.id
 WHERE c.player_id IS NOT NULL AND c.link_status_value = 'unique';

ROLLBACK;
```

Expected: **0, 27, 365**. Query (3) also settles a second question the plan
assumes: that adding `link_status_value = 'unique'` (reused from
`premiership_coach`) does not move X1 off 365. **Any other result changes the
builder design and must be reported before implementation begins.**

### 25.17 Blockers, dependencies and stop condition

**Blockers:** none technical. Phase F's gate (B–D green) is satisfied.

**Dependencies:** operator answers to **F-D1** through **F-D4**; F-D4 needs the
three-count query above; and the pre-existing ISSUE-152 obligations are
unchanged — the working tree since `50f8c54` is uncommitted, migrations **092
and 093 must both reach `afldb_dev` and production BEFORE the code**, and
`nl:stress` has still not been run for B, C, D or E.

**Not blockers:** C1, FS1, FS2, FS3, FS6, D6, D8 and `AFLDB-ISSUE-153`. They
remain explicit declines and are re-pinned, not relaxed, by the Phase F corpus.
The two pre-existing `tests/integration/grid-solver.test.ts` won-final failures
are still out of scope and untouched.

**Stop condition for this section:** planning only. No executable source,
migration, corpus, test, harness or `PARSER_VERSION` change; no database
command; no Git write; **Phase F is not started and ISSUE-152 is not
resolvable**.

---

## 26. Phase F — IMPLEMENTED 2026-09-09 (X1 + X2; X3 deferred by F-D1)

**Status: IMPLEMENTED and LOCALLY VALIDATED. Rendered acceptance NOT yet
run.** §25 remains the contract; this section records what was built
against it, every deviation, and what is still outstanding.

The four operator decisions are final and were applied as given:

| ID | Decision | Effect on the build |
|---|---|---|
| **F-D1** | **(b) — defer X3 to `AFLDB-ISSUE-153`** | No son-side father-son wording. `father_son_selection` is emitted by no parser path, and a NEW named refusal inside the cross-domain reading stops the composition from becoming a back door into D8 (§26.4). Rhyce Shaw stays measured evidence for ISSUE-153 and is not a Phase F query. |
| **F-D2** | **decline** temporal wording | `CROSS_DOMAIN_TEMPORAL_RE`, checked inside the reading before any predicate is emitted. "went on to", "became a coach", "later", "then coached", "after they retired" all decline WITH A STATED REASON. Nothing is stripped. |
| **F-D3** | **decline** one-sided club composition | Club roles are assigned per OCCURRENCE by the nearest verb; a side left empty declines. |
| **F-D4** | **resolved — `played_for_club` reuse approved** | No new playing-side builder, no new grain, no migration. The transcript `nl-ui-out-152-phaseg/evidence/ISSUE-152-phase-f-fd4-afldb_test-20260909-191040.txt` is retained evidence and was NOT re-derived; its zero-game-membership fact is re-asserted once as a fixture in the oracle suite. |

### 26.1 R0 — red before green, recorded

The mandatory §25.14(0) probe was written, run against the **v38** parser
and deleted. Its transcript is preserved at
`nl-ui-out-152-phaseg/evidence/ISSUE-152-phase-f-r0-probe-20260909.txt`.

**No X1, X2 or X3 wording answered under v38.** 24 wordings, all declining
or refused.

One finding, recorded because §25.14 requires it to be: the
`coach_record`-election path §25.8 predicted **is real**. Under v38,
*"players who played for Richmond and coached Collingwood"* produced a
**plan at confidence 1.00** — `grain: 'coach_record'`, `clubFor:
Richmond`, `clubAgainst: Collingwood` — and was stopped by `validatePlan`
("A coaching question contains fields its compiler cannot honour."), not
by the confidence gate. It was therefore never a wrong answer, but it was
one ownership rule away from being one. Every other cross-domain wording
declined at parse.

Also confirmed unchanged and still refused at `validatePlan`: *"Richmond
players coached by Damien Hardwick"* — see §26.8.

### 26.2 Files changed

| File | Change |
|---|---|
| `src/search/grid-solver-spec.ts` | **+2 builders** in the existing `Coaching` group: `has_coached` (no params), `coached_club` (`club()`). Catalogue **164 → 166**. |
| `src/db/queries/grid-solver.ts` | The two SQL cases. Both join `match_coaches`; `coached_club` folds through `clubs.organization_id`. |
| `src/search/nl/vocab.ts` | `CROSS_DOMAIN_PLAY_VERB_SOURCE`, `CROSS_DOMAIN_COACH_VERB_SOURCE`, `CROSS_DOMAIN_COMPOSITION_RE`, `CROSS_DOMAIN_SHARED_CLUB_RE`, `CROSS_DOMAIN_TEMPORAL_RE`, `CROSS_DOMAIN_CONSUME_RE`. |
| `src/search/nl/parser.ts` | `clubScanText` snapshot; `assignCrossDomainClubs` + two position helpers; the `coached_population` reading elected first inside the §1684 coaching block; grain branch before `coach_record`; predicate emission; the `crossDomainClubs` plan field. |
| `src/search/nl/plan.ts` | `crossDomainClubs` plan field; `NL_CROSS_DOMAIN_BUILDERS`; `isCrossDomainPlan`; V5/V6/V7/V9/V10 plus the club-reference/parameter agreement rule; `PARSER_VERSION` **38 → 39** with its history entry. |
| `src/search/nl/describe.ts` | `cappedListCaveat` extracted and SHARED with Phase D; `isCrossDomainPlan` caveat branch; `crossDomainSubjectPhrase`, wired into both the list and the ranked branch. |
| `tests/grid-solver-spec.test.ts` | 164 → 166. |
| `tests/nl-parser.test.ts` | +1 describe block, 27 cases. |
| `tests/nl-plan.test.ts` | +1 describe block, 9 cases. |
| `tests/nl-describe.test.ts` | +1 describe block, 8 cases. |
| `tests/nl-ui-corpus.test.ts` | The `next` set pins (349/253/96), the append-order pin, and the named-row pins — 3 cases. |
| `tests/integration/nl-answers-cross-domain.test.ts` | **NEW.** The independent DB oracle suite, 21 cases. |
| `tests/nl-ui/corpora/afldb-ui-questions-cross-domain-v1-20260909.csv` | **NEW.** 15 plan rows. |
| `tests/nl-ui/corpora/afldb-ui-questions-cross-domain-decline-v1-20260909.csv` | **NEW.** 15 decline rows. |
| `tools/issue-152/build-phase-g-corpora.ts` | `PHASE_G_SETS.next` — 349 rows, appending to `current`. |
| `tools/issue-152/phase-f-corpus.ps1` | **NEW.** The P6 runner. |

**No migration. No new table. No new column. No new grain. No change to
`src/db/queries/nl/player-career.ts`.**

### 26.3 The two builders, and the two rules they encode

```sql
-- has_coached
p.id IN (SELECT c.player_id FROM coaches c
           JOIN match_coaches mc ON mc.coach_id = c.id
          WHERE c.player_id IS NOT NULL AND c.link_status_value = 'unique')

-- coached_club(<organization id>)
p.id IN (SELECT c.player_id FROM coaches c
           JOIN match_coaches mc ON mc.coach_id = c.id
          WHERE c.player_id IS NOT NULL AND c.link_status_value = 'unique'
            AND mc.club_id IN (SELECT id FROM clubs WHERE organization_id = $1))
```

1. **A `coaches` row is an identity, not proof of coaching.** The
   `match_coaches` join is the semantic. 368 linked identities; **365**
   people actually coached a match. The oracle suite asserts the
   difference is exactly the identities with no `match_coaches` row.
2. **A coached club is an organization lineage.** Never `mc.club_id =
   $1`. Measured on the real divergence: Pagan 3 raw ids / 2
   organizations, Wallace 3/2, Laidley 2/1.

### 26.4 The parser, and the four things it refuses

The reading is elected **first** inside the coaching block, on a
COMPOSITION cue (`played … and also coached`, `both played … coached`,
`players … also coached`) or a temporal cue — never on the bare
`COACH_CUE_RE`. Electing after `coach_record`, the block's fallthrough,
would have been useless.

Inside the reading, in order, before any predicate exists:

1. **Temporal wording → decline, by name** (F-D2/D9). *"AFLDB does not
   record the order of a person's playing and coaching careers, so it
   cannot answer whether one came after the other. Ask instead who both
   played and coached."*
2. **Any father-son wording → decline, by name** — a NEW refusal, and a
   deviation from §25 recorded deliberately (§26.7). It exists so that a
   phrase which declines on its own can never become answerable merely by
   appending "and also coached". The D8 guard at `vocab.ts` is untouched.
3. **A club governed by an against-preposition → decline.** This reading
   CLEARS `clubAgainst` on its way to binding both sides, so an opponent
   had to be caught here; without it, *"played and also coached against
   Carlton"* bound Carlton as the coached club and answered confidently.
   Found by the corpus verification run, not by reasoning.
4. **A one-sided or ambiguous club composition → decline** (F-D3).

**Club roles are assigned per OCCURRENCE**, by the nearest verb before
each mention in the reader's own wording, measured on a snapshot taken
before club names were spliced out. "Richmond … Richmond" is one entity
match in two places, and asking only where the first one sits would have
put the whole question on the playing side. Two exceptions, both narrow
and explicit: a club conjoined by both verbs with nothing between them
("both played for **and** coached Richmond") binds both sides, and a club
as the leading noun adjunct of "players" ("**Richmond players** who also
coached Richmond") is the playing side.

**`scope.clubFor` is never set.** Both clubs are builder parameters. This
is the single most important structural decision in the phase: had
`coached_club` owned `scope.clubFor`, the compiler's generic playing-club
`EXISTS` would have been suppressed and *"played for Richmond and also
coached Richmond"* would have answered **41** (coached Richmond) instead
of **27**.

### 26.5 Wording

- X1 → *"Players who played VFL/AFL and also coached."*
- X2 → *"Players who played for Richmond and also coached Richmond."*
- Asymmetric → *"Players who played for Richmond and also coached Collingwood."*
- Ranked → *"Highest career games among players who played VFL/AFL and also coached."*

**"Later" appears in no branch and no constant**, asserted by a test.

**D20 is REUSED, not re-invented.** `answerCaveats`' cap sentence was
extracted into one helper shared by the Phase D relationship branch and
the Phase F cross-domain branch, so there is one cap contract rather than
two. X1 renders: *"365 players qualify. This answer lists the first 100 of
them, most games first; it is not the whole list."* No coaching-
completeness caveat was invented in either direction (M1 is still
unmeasured).

### 26.6 Validation

| Gate | Result |
|---|---|
| R0 red-before-green probe (v38) | **PASS** — no Phase F wording answered; one `coach_record` election recorded (§26.1) |
| `npm run typecheck` | **PASS** |
| DB-free suite (`vitest run`, excluding integration + nl-ui) | **3,777 passed**, 14 skipped, **2 failed — both pre-existing and unrelated** (§26.9). Baseline before this phase was 3,730; **+47 new DB-free cases**, plus the 21 oracle cases below. |
| `tests/nl-parser.test.ts` | 327 passed (+27 Phase F) |
| `tests/nl-plan.test.ts` | 153 passed (+9 Phase F) |
| `tests/nl-describe.test.ts` | 74 passed (+8 Phase F) |
| `tests/nl-ui-corpus.test.ts` | 48 passed (+3 Phase F) |
| `tests/grid-solver-spec.test.ts` | catalogue 166 |
| **`tests/integration/nl-answers-cross-domain.test.ts`** | **21 passed** — the oracle suite |
| Every other NL integration suite (11 files) | **215 passed**, 0 failed |
| Corpus verification against `afldb_test` | **30/30 rows** behaved as pinned, BEFORE pinning |
| `build-phase-g-corpora.ts next` | 349 rows, 253 plan, 96 decline, 4 batches |

**The oracle suite's pins**, every one compared against independently
hand-written SQL:

| Pin | Value |
|---|---|
| X1 | **365** — and *not* the 368 identity-only seam, with the difference proven to be the matchless identities |
| X2 Richmond | **27** |
| `coached_club(18)` alone | **41**, so 27 is provably an intersection; 41 − 27 = the measured **14** |
| Richmond positives present | Hafey 12550, Dyer 6244, Bentley 10377, Hughes 4386, Jewell 12775, Minogue 3195, Wallace 12378, Bartlett 8193 |
| Coached-Richmond-only absent | Yze 67, Jeans 481, McQualter 600, Hardwick 3175, Frawley 3266, Rawlings 6669, Gieschen 6912, Walls 11145 — and each IS in the coaching half, so their absence is the playing half working |
| Played-Richmond-only absent | Edwards 6, Fiora 7, Pattison 51 |
| Never coached absent | Aaron Black **1 and 2** (one display name, two identities), Cadman 3, Davey 5, Cerra 28 |
| Lineage traps | Pagan 3651, Wallace 12378, Laidley 3208 — each satisfies `coached_club` for EVERY organization they coached and for none they did not; raw ids proven to outnumber organizations |
| D20 | `total` 365, `rows` 100, caveat contains both numbers |
| Fixture | 386 / 368 / 18 coach rows; **0** zero-game `player_clubs` memberships (F-D4) |
| Ownership | V1, V5, V6, V7, V9, V10 each refused |

Corpus verification measured every plan row's real population:
365 ×6, ranked lead Kevin Bartlett 403 games, Richmond **27** ×3,
Richmond→Collingwood **4**, Sydney **28**, Western Bulldogs **18**,
and `Richmond's coaching record` still electing `coach_record`.

The two lineage rows are the strongest of these: Sydney's lineage answer
is **28** where a raw-`club_id` implementation would answer **2**, and the
Western Bulldogs' is **18** where a raw-id implementation would answer
**0**.

### 26.7 Deviations from §25, and why

1. **A new plan field, `crossDomainClubs`, WAS added.** §25.5 said none
   was needed. Source inspection proves that was mistaken: `describe.ts`
   has no club directory and no way to turn an organization id into a
   name, so §25.11's requirement that both club names always be stated is
   unsatisfiable from the builder parameters alone. The field carries the
   same contract `relationshipSubject` already carries — it is the
   resolved reference the bound id came from, never a substitute for it —
   and `validatePlan` refuses any plan where the named clubs and the
   bound parameters disagree, in either direction.
2. **A father-son refusal was added inside the reading** (§26.4(2)).
   §25.8(4) assumed the D8 guard's leftover tokens would be enough under
   F-D1(b). They were, for the wordings measured — but only by accident
   of token counting, and the operator's brief is explicit that no
   surface may exist where wording declines alone and answers with a
   coaching conjunct appended. This makes that a rule rather than a
   coincidence.
3. **An opponent refusal was added inside the reading** (§26.4(3)). Not
   anticipated by §25.9, which assumed `validatePlan`'s existing
   career-scope rule would catch it. It cannot: this reading clears
   `clubAgainst` before `validatePlan` ever sees the plan. **Found by
   measurement** — the first corpus verification run answered *"players
   who played and also coached against Carlton"* with 27 Carlton people.
4. **The corpus split is 15 plan / 15 decline, not 14 / 16.** X3 is
   deferred, and the `coach_record` collision row — which must ANSWER —
   is counted in the plan column, where a row expecting a plan belongs.
   §25.15 left this to the operator. **Set total 349 and batch count 4
   are unchanged.**
5. **`CROSS_DOMAIN_CONSUME_RE` consumes `vfl/`, not `vfl` and `afl`.**
   `canonicalise` strips a bare "afl" as conversational filler, so
   "VFL/AFL" reaches the reading as the single orphaned token `vfl/`.
   Found by the corpus verification run; the row it broke is one of
   §25.3's own approved wordings.

### 26.8 "Richmond players coached by Damien Hardwick" — still a decline

§25.1 lists §13.15(4) as IN Phase F. **It was not implemented, and it
still refuses at `validatePlan`.** The reason is the contract's own:

- §25.3 gives it no operator-matrix row, §25.11 no wording, §25.12 no
  oracle test and §25.15 no corpus row. It is named IN and specified
  nowhere.
- It has **no measured population** in F0–F8.
- Its two readings — "coached by Hardwick *at Richmond*" and "played for
  Richmond *and* coached by Hardwick anywhere" — are different questions
  with different answers, and the wording does not choose between them.
  That is exactly the shape **F-D3** decides: a club named on one side
  with no explicitly owned target on the other declines.
- `coached_by` owns a coach id and no club, and the brief forbids
  overloading it.

It is re-pinned as a decline and re-addable the day it has an owned
coaching-club target and a measured population.

### 26.9 The two DB-free failures are NOT Phase F

- `tests/finals-semantics-contract.test.ts` — the known Windows CRLF
  failure: the test splits migration SQL on a bare `\n` and this is an
  `autocrlf=true` checkout. Passes on Linux.
- `tests/reference-data.test.ts` — expects a hard-coded list of
  post-migration-045 tables and receives three more
  (`external_grid_axes`, `external_grid_sources`, `external_grids`).

Neither file is modified by this phase, and neither reads any file this
phase modified — both read migration SQL, of which none changed. They are
pre-existing on this branch. Recorded here because §22.10/§24.8 name only
the two `tests/integration/grid-solver.test.ts` won-final failures, and
these two were not previously written down.

### 26.10 Status — Phase F code COMPLETE; rendered acceptance OUTSTANDING

Done: §25.14 steps 0–8, plus the corpus build (step 9).

**Not done, and required before Phase F can be called green:**

1. **Fresh production build of this branch.** DEV serves `main` and would
   measure the wrong code (§19.1).
2. **The stale-build discriminator**, which is not optional (§24.1):
   `/search?q=players+who+also+coached` on the running server must answer
   **"365 players match"** BEFORE the sweep starts.
3. **P6** — `.\tools\issue-152\phase-f-corpus.ps1`, 349 rows, immutable
   `-OutName p6-phase-f-next`, fresh `-RunTag issue152-phasef-p6`,
   2,200 ms at one worker (~13 min).
4. **A fresh P4 regression re-run** — `.\tools\issue-152\phase-g-regression.ps1`,
   1,495 rows (~55 min).

Both sweeps must show 0 semantic failures, 0 unscored, 0 rate limit,
0 `page_error`, 0 `http_error`, 0 filler disagreements, 0 client-side
errors.

The pre-existing ISSUE-152 obligations are unchanged: **migrations 092
and 093 must reach `afldb_dev` and production BEFORE the code**, and
`nl:stress` has still not been run for B, C, D, E or F.

**ISSUE-152 is NOT resolvable.** No deployment, no merge, no production
change was made.

---

## 27. Phase F — RENDERED ACCEPTANCE COMPLETE AND GREEN 2026-09-09 (P6 349/349, P4-r1 1,495/1,495)

§26 built Phase F and left the rendered run as its next action. That run has now
been performed. **The Phase F scope — X1 and X2, with X3 deferred by F-D1 — is
COMPLETE and GREEN through a real browser against a real production build of this
branch.**

`PARSER_VERSION` stays **39**. **No migration.** Nothing in `src/` changed during
acceptance or closeout; the only code edits after `f619de8` are two test-only type
contracts (`2ec9871`) and one harness `ValidateSet` entry (`5be7511`), both recorded
in §27.4.

### 27.1 The build, and the discriminator that made P6 admissible

A **fresh production `npm run build` of this branch PASSED** and was served
standalone on `127.0.0.1:3100`. DEV serves `main` and would have measured the wrong
code (§19.1); the build was taken after the test type-contract correction of §27.4,
so the built tree is the tree the sweeps measured.

The **mandatory stale-build discriminator of §26.10(2) was then run and PASSED**:

| | |
|---|---|
| Request | `/search?q=players+who+also+coached` on the running server |
| HTTP status | **200** |
| Rendered answer | **`365 players match`** |

That is the X1 population §26.6 measured against `afldb_test`, and no pre-Phase-F
build can produce it — under v38 the same wording declined (§26.1). This check is
what makes P6 admissible: the first P5 attempt of §24.1 was thrown away for its
absence, and it is now a standing precondition, not a courtesy.

**D20 also rendered correctly in that same check.** X1 is a 365-row population
against a 100-row page cap, and the page reported **`Showing 100 of 365`** with the
answer text explicitly stating that the displayed rows were **not** the whole list.
The capped-list disclosure contract accepted for Phase D (§22.5, §23.4, §24.6) is
therefore proved end-to-end for the cross-domain grain as well, from the shared
`cappedListCaveat` §26.2 extracted for exactly this reason.

### 27.2 P6 — the merged 349-row `next` set, GREEN

| | |
|---|---|
| Run tag | `issue152-phasef-p6` |
| Preserved output | `nl-ui-out-152-phaseg/p6-phase-f-next/` |
| Corpus | **349** rows — **253** plan / **96** decline |
| Observed | **349 / 349** |
| Answered | 253 |
| Unanswerable | 25 |
| Absent | 71 |
| Pass | **349** |
| Fail | **0** |
| Unscored | **0** |
| Rate-limit detections | **0** |
| `page_error` | **0** |
| `http_error` | **0** |
| Filler disagreements | **0** |
| Client-side errors | **0** |
| Playwright batches | **4 / 4 passed** |

253 + 25 + 71 = 349, and 253 plan / 96 decline is exactly the `PHASE_G_SETS.next`
shape pinned independently in `build-phase-g-corpora.ts`, `phase-f-corpus.ps1` and
`tests/nl-ui-corpus.test.ts` (§26.5). Every one of the 30 new cross-domain rows was
verified against `afldb_test` **before** it was pinned, so a green row here is
agreement with measured data and not agreement with itself.

> **AFLDB-ISSUE-153 note (2026-09-09) — the run above is preserved as run; the
> SPLIT it names is superseded.** P6 measured the code and corpus of 2026-09-09
> and is NOT rewritten. Since then AFLDB-ISSUE-153 Stage 5 (operator decision
> Q6) lifted the F-D1 deferral of X3, so a fifth row is reclassified IN PLACE —
> `xd_dec_014`, "players selected under the father-son rule who also coached",
> which now answers with 1 person (Rhyce Shaw, player 10974). With the four
> `current` reclassifications it inherits, `PHASE_G_SETS.next` is re-pinned
> **349 = 258 plan + 91 decline**. `xd_dec_012`, `xd_dec_013` and `xd_dec_015`
> still decline and are pinned by name. Row count, ids and order are untouched.

### 27.3 P4-r1 — the 1,495-row regression gate, re-run fresh and UNCHANGED

| | |
|---|---|
| Run tag | `issue152-phasef-p4r1` |
| Preserved output | `nl-ui-out-152-phaseg/p4-regression/` |
| Corpus | **1,495** rows |
| Observed | **1,495 / 1,495** |
| Answered / plan | 1,435 |
| Unanswerable / decline | 60 |
| Absent | **0** |
| Pass | **1,495** |
| Fail | **0** |
| Unscored | **0** |
| Rate-limit detections | **0** |
| `page_error` | **0** |
| `http_error` | **0** |
| Filler disagreements | **0** |
| Client-side errors | **0** |
| Playwright batches | **15 / 15 passed** |

The 1,435 + 60 shape is **identical** to P4-r1 under Phase G (§21.4) and under
Phase D (§24.4). Since the gate was first measured under Phase G, **six relationship
builders, two cross-domain builders, two parser versions (37 → 39) and two new plan
fields have moved no existing answer in either direction.** This is a **fresh** run
under its own tag against the Phase F build — not a citation of an earlier result.

### 27.4 Two corrections made during acceptance, neither semantic

1. **Test type contracts (`2ec9871`).** `tests/nl-plan.test.ts` asserted the V-rule
   refusal with the scope literal `matchType: 'final'`, which is not a member of the
   union; the correct literal is `'finals'`. `tests/nl-ui-corpus.test.ts` typed its
   local `build()` helper as `'new' | 'current' | 'regression'`, a hand-copied union
   that the new `next` set falsified; it now imports `PhaseGSetName` from
   `build-phase-g-corpora.ts` so the set list has exactly one definition. **Both are
   test-side type corrections. No parser, planner, describe, query or corpus
   behaviour changed**, and the assertions they carry are unchanged. The production
   `npm run build` of §27.1 was taken **after** this correction and passed.
2. **The Phase G PowerShell harness needed `next` in its shared `ValidateSet`
   (`5be7511`).** `Invoke-PhaseGCorpusBuild` in `tools/issue-152/phase-g-common.ps1`
   validated `-Set` against `new | current | regression`, so `phase-f-corpus.ps1`
   could not ask it for the `next` set it defines. One entry was added. **This is a
   harness-only correction with no semantic change**: the `new` (271) and `current`
   (319) sets and every guard around them are untouched, and the immutability and
   pacing contracts of §21 still hold.

### 27.5 Historical evidence does not move

The Phase G P3/P4 and Phase D P5/P4 preserved runs are **untouched**. `next` appends
to `current` exactly as `current` appended to `new`, so the first 271 rows remain
byte-for-byte the pinned Phase G file and the first 319 remain the pinned Phase D
set; every position-based statement in §19.3, §20, §21, §23 and §24 survives
unchanged. Preserved output stays immutable — a re-run under a claimed `-OutName`
is refused, not overwritten.

### 27.6 What Phase F closes, and what stays deferred

**Complete and green:** **X1** (played and actually coached, `match_coaches`-backed,
365 and provably not the 368 identity-only seam) and **X2** (played for and coached
the same club, 27 — plus the asymmetric and organization-lineage forms), together
with every refusal F-D2, F-D3 and §26.4 put around them.

**Deferred by decision, and NOT Phase F failures:**

| Item | State |
|---|---|
| **X3** (son-side father-son composition) | Deferred to `AFLDB-ISSUE-153` by **F-D1**. Held by a named decline row and by the in-reading father-son refusal (§26.4(2)). |
| **C1** | Blocked on `AFLDB-ISSUE-153` (F1). Decline row only. |
| **FS1**, **FS2**, **FS3**, **FS6** | Blocked on `AFLDB-ISSUE-153` (F1). Decline rows only. |
| **D6**, **D8** | Deferred operator decisions; sit with `AFLDB-ISSUE-153`. |

Every one of those boundaries is held by a **named decline row in the rendered
corpus**, so each refusal is a measured behaviour and not an absence of coverage.
None of them was investigated, touched or re-scoped by this phase.

Also unchanged and still a decline: **`Richmond players coached by Damien Hardwick`**
(§26.8), and the two DB-free failures of §26.9, which remain pre-existing and are
not Phase F.

### 27.7 Status — Phase F ACCEPTED; ISSUE-152 stays OPEN

**Phase F is ACCEPTED.** Its code, corpus, oracle suite and rendered acceptance are
complete and green, the working tree is clean, and the branch is **ready to merge as
a stable checkpoint before `AFLDB-ISSUE-153` begins.**

**ISSUE-152 as a whole is NOT closed and must not be resolved on this evidence.**
Still outstanding:

- the **blocked Phase D half** — C1, C5/C6, FS1, FS2, FS3, FS6 and the D6/D8
  decisions — which remain with `AFLDB-ISSUE-153`, and **X3** with them;
- the **un-run deploy** — migrations **092 and 093 must both reach `afldb_dev` and
  production BEFORE the code**, or the telemetry grain CHECK drops rows silently
  while answers render correctly;
- the decision on whether `nl:stress` runs before deploy — it has still **not** been
  run for B, C, D, E or F.

No deployment, no merge and no production change was made in this slice.

## 28. Final closeout — RESOLVED 2026-09-13

**Merge and production migrations.** The Phase F checkpoint (`opus/issue-152-nl-record-
expansion`, tip `6f9723a`) was already an ancestor of `main`; it is now independently
confirmed an ancestor of PROD HEAD `0955db3`. Production migrations **092**
(`092_nl_search_log_coach_record_grain.sql`) and **093**
(`093_nl_search_log_after_siren_grain.sql`) are applied.

**§27.7's deferred-half blocker is discharged by `AFLDB-ISSUE-153`.** The eight labels
this issue deferred — **C1, FS1, FS2, FS3, FS6, D6, D8 and X3** — were absorbed and
resolved by `AFLDB-ISSUE-153` (its Stages 1–7, RESOLVED 2026-09-13:
`issues/closed/AFLDB-ISSUE-153.md` §11.16). They are not remaining ISSUE-152 blockers.

**§27.7's `nl:stress` blocker is discharged.** Run against `afldb_test`:

- **V1** — corpus `/home/arm/nl-stress-corpus.csv`, 12,000 rows, `PARSER_VERSION` 41:
  10,726 clean / 1,063 soft / 211 hard, **0 errors**.
- **V2** — corpus `/home/arm/nl-killer-250k.csv`
  (SHA256 `d2edefd572f2daa393c1d2c7d59b3fdf98de1e9eba725cde49193da9724b392d`), 250,000
  rows, 244,927 scored: 226,920 clean / 10,259 soft / 7,748 hard, **0 errors**, 0 unsafe
  answers, safe declines 24,393/24,393, metamorphic consistency 6,788/6,788.

This runbook defines no numeric `nl:stress` pass threshold and does not require the
general corpora to contain the ISSUE-152 grains specifically. The hard findings were
reviewed and are outside ISSUE-152 scope; no ISSUE-152 regression was identified.
ISSUE-152-specific semantics remain independently covered by the phase-specific
DB-backed and rendered acceptance suites recorded in §14, §16, §18, §21, §24 and §27.

**Production first-kick-goal data gap, found during final verification.** Initial live
PROD verification found "who coached Richmond" (PASS, 42 coaches) and "goals after the
siren" (PASS, 71 events) correct, but "players who kicked a goal with their first kick"
parsed correctly and returned 0. Investigation proved this was **not a parser/code
defect**: `afldb_test` held the full Phase E population (334 total / 330 player-linked /
328 match-linked / 23 no-further-career-goals / 4 no-further-career-kicks, seasons
1911–2026) while both `afldb_dev` and `afldb_prod` held 0 rows. Root cause: the curated
`player_achievements` first-kick-goal population (§18) had not been restored after the
canonical database rebuild/cutover.

**Remediation.** The tracked importer `tools/records/import-first-kick-goal.ts` was
rehearsed on DEV first — `--check` PASS; dry run 334 imported / 330 matched / 0
ambiguous / 4 unmatched / 328 match-resolved; `--apply` completed as **DEV import batch
89**; post-import DEV counts 334/330/328/23/4, seasons 1911–2026 — then the same
supported path was executed on PROD: DB identity proven `afldb_prod`/`afldb_import`;
`--check` PASS; dry run matched DEV exactly; `--apply` completed as **PROD import batch
116**, 334 inserted / 0 updated; post-import PROD counts 334 total / 330 player-linked /
328 match-linked / 23 no-further-career-goals / 4 no-further-career-kicks, seasons
1911–2026. Expected unresolved/source-quality findings remain and are **not** closure
blockers: 4 unmatched 2026 source rows, 2 unresolved first-kick matches, a Gerald
O'Loughlin source-career-kicks contradiction, and an Archer Day-Wicks
source-career-goals contradiction (all recorded by the importer itself).

**Final live PROD verification (`https://beta.afldb.com`):**

- "players who kicked a goal with their first kick" — PASS, 330 players match (Showing
  100 of 330).
- A known-positive player taken from the live PROD record page, Josh Rachele — "did josh
  rachele kick a goal with his first kick" — PASS, yes.
- "who coached Richmond" — PASS, 42 coaches.
- "goals after the siren" — PASS, 71 kicks after the siren.
- Runtime: application/API/RSC requests 200, no warnings. A recurring CSP block of
  `static.cloudflareinsights.com/beacon.min.js` is a pre-existing, unrelated
  analytics-beacon issue, not ISSUE-152.

**Final verdict.** `AFLDB-ISSUE-152` final production deployment/data gate: **PASS**.

**AFLDB-ISSUE-152 RESOLVED — 2026-09-13.** No remaining ISSUE-152 implementation,
stress, migration, data, deployment or browser gate remains. Full closing record:
`issues.md` (Status — RESOLVED 2026-09-13, and its Resolution section).
