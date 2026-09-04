# AFLDB-ISSUE-118 — Persist Gridley history and use it as a Grid Solver compatibility corpus

> **REOPENED 2026-09-05.** The 2026-09-05 closeout (§22.12) counted 28 valid Gridley criteria as
> acceptable because they were classified `data_absent`. That is an unsupported valid question,
> not a pass. §23 holds the corrected acceptance contract and the reopened work; §1–§22 are
> preserved unchanged as the historical record, including the merge and deployment evidence.

**Runbook.** Stages 0–2 (§1–§21) were investigation, persistence and acquisition on
`opus/gridley-corpus`; §22 (4 September 2026, `claude/issue-118`) recovers that work onto
current `main`, exports the stored corpus as an offline fixture, maps every criterion, adds the
missing builders, proves the whole corpus through the production solver and resolves the
`/grid-solver` crash digest; §22.12 records the merge, the DEV and PROD deployments and the
acceptance that closed it on 5 September 2026. **Read §22 first; earlier sections are history.**

---

## 1. Repository identity

| Field | Value |
|---|---|
| Issue | `AFLDB-ISSUE-118` |
| Branch | `opus/gridley-corpus` |
| Worktree | `D:\dev\afldb-gridley` |
| HEAD SHA | `98354a393a327e4472ebf43966acf3bfd4aed42e` |
| Base SHA | `98354a393a327e4472ebf43966acf3bfd4aed42e` |
| Base branch | `main` (HEAD is an ancestor of `main`; `main` was 2 commits ahead at `7a0f592`) |
| Working tree at start | clean |
| Commits on this branch | none — the branch carried no implementation before Stage 0 |
| Model / effort | Opus 5, High, investigation |

Verified via `git rev-parse --show-toplevel` (`D:/dev/afldb-gridley`), `git rev-parse --git-dir`
(`D:/dev/afldb/.git/worktrees/afldb-gridley`) and `git worktree list`. The primary repository
`D:\dev\afldb` was inspected read-only for worktree/base state and **was not modified** — it
carries unrelated uncommitted work on `main` which was left untouched.

Repository instructions in force: `CLAUDE.md` (repo root) and `docs/development/WORKFLOW.md`,
both read in full for this session.

### Issue-number renumbering (ISSUE-117 → ISSUE-118)

Stage 0 originally selected `AFLDB-ISSUE-117` as the next free ID from base `98354a3`.
Upstream `main` independently allocated `AFLDB-ISSUE-117` (public-surface abuse hardening) at
`7a0f592`, so this work was renumbered to `AFLDB-ISSUE-118` before Stage 1 began. The upstream
`AFLDB-ISSUE-117` is legitimate and unrelated to Gridley; it must not be modified by this branch.
Any earlier note, scratchpad or session transcript referring to the Gridley work as ISSUE-117
means this issue.

---

## 2. Legacy source

| Field | Value |
|---|---|
| SQLite archive | `D:\dev\sports_data_lab\data\afl\afl.db` (537,010,176 bytes) |
| Table | `historic_grids` |
| Scraper | `D:\dev\sports_data_lab\utils\fetch_grids.py` (10,972 bytes) |
| Access mode | `sqlite3.connect("file:...?mode=ro", uri=True)` + `PRAGMA query_only=ON` |
| Mutations | **none** — no write, vacuum, repair or copy was performed |

---

## 3. Corpus integrity — Stage 0B (reproduced independently, not taken on trust)

| Check | Result |
|---|---|
| Sources present | `Gridley` only (1,123 rows). No `Immaculate Grid` rows exist |
| Total rows | **1,123** |
| Distinct dates | 1,123 |
| Distinct grid numbers | 1,123 |
| Date range | **2023-07-17 → 2026-08-12** |
| Grid number range | **1 → 1123** |
| Duplicate dates | 0 |
| Duplicate grid numbers | 0 |
| NULL/blank `grid_num` or `date` | 0 |
| **Missing grid numbers in 1..1123** | **0 — genuinely continuous** |
| **Missing calendar dates in range** | **0 — calendar span is exactly 1,123 days, one board per day** |
| Date ↔ number consistency | **0 inconsistencies.** `date = 2023-07-16 + grid_num days` holds for all 1,123 rows |
| Malformed `rows_json` / `cols_json` | 0 / 0 |
| Arrays not exactly length 3 | 0 |
| Non-string criteria | 0 |
| Blank criteria | 0 |
| `unsupported_json` | `'[]'` on all 1,123 rows — **vestigial, never populated** |
| `note` | `''` on all 1,123 rows — **vestigial, never populated** |
| Malformed `unsupported_json` | 0 |

Continuity was proved by full enumeration of the number and date sequences, not inferred from
`MIN`/`MAX`/`COUNT`. **The archive is perfect. There are no anomalies to record.**

**Fidelity cross-check.** Both archive dates that overlap the live probe (#1 `2023-07-17` and
#1123 `2026-08-12`) were re-fetched from Gridley and compared: `grid_num` vs `level`, row labels
and column labels **all match exactly**, with row = `vItems` and col = `hItems`. The legacy
`gridley_label()` join is reproducible byte-for-byte.

---

## 4. Criterion inventory — Stage 0C

| Metric | Value |
|---|---|
| Axis occurrences | **6,738** (= 1,123 × 6, exactly) |
| Distinct **raw** criteria | **788** |
| Distinct **normalized** criteria | **788** (normalization = trim + whitespace-collapse + casefold) |
| Normalized forms with >1 raw variant | **0** |
| Singleton criteria (appear once) | 236 |

Raw text is preserved exactly. Normalization was used for analysis only.

Most frequent: `PLAYED IN 2010s` (210), `Collingwood` (143), `Brisbane Lions` (130),
`Hawthorn` (126), `Geelong Cats` (124), `PREMIERSHIP PLAYER` (113),
`RISING STAR NOMINATION` (107), `ALL AUSTRALIAN` (99), `195cm OR TALLER` (86).

### 4.1 Legacy label lossiness (defect in the legacy capture, not in Gridley)

`gridley_label()` flattens `title` + `subtitle` into one string and **discards the split**:

- if `subtitle` is empty → `title`;
- else if `title` is a casefold substring of `subtitle` → `subtitle` alone (**title dropped**);
- else → `"{title} {subtitle}"`.

This inflates the distinct-criterion count with duplicated surnames and is not losslessly
reversible. Both forms occur for the same underlying criterion:

```
ADAM TRELOAR TRELOAR TEAMMATE   (title "ADAM TRELOAR" + subtitle "TRELOAR TEAMMATE")
ADAM TRELOAR TEAMMATE           (title contained in subtitle, so title was dropped)
BILLY FRAMPTON FRAMPTON TEAMMATE / BILLY FRAMPTON TEAMMATE
ALASTAIR CLARKSON COACHED BY CLARKSON
```

**AFLDB must not repeat this.** See §9 and §11.

---

## 5. Semantic taxonomy — Stage 0D

Derived from the corpus, not assumed. 36 families; distinct criteria / axis occurrences:

| Family | Distinct | Occurrences |
|---|---:|---:|
| teammate | 482 | 1,029 |
| award | 29 | 482 |
| single_game_stat | 23 | 334 |
| grand_final | 21 | 174 |
| season_stat | 20 | 162 |
| **club** | 19 | **2,034** |
| rivalry | 19 | 67 |
| finals | 18 | 303 |
| venue | 15 | 50 |
| debut_club | 15 | 27 |
| attribute | 13 | 152 |
| finals_stat | 11 | 89 |
| career_stat | 9 | 90 |
| club_games | 9 | 152 |
| draft | 8 | 106 |
| coaching | 8 | 16 |
| premiership | 7 | 183 |
| career_games | 7 | 231 |
| brownlow | 7 | 70 |
| marquee | 7 | 16 |
| decade_played | 6 | 427 |
| club_leader | 6 | 113 |
| team_season | 5 | 47 |
| grand_final_stat | 4 | 60 |
| club_journey | 3 | 146 |
| league_leader | 3 | 26 |
| debut_era | 3 | 6 |
| match_event | 2 | 7 |
| teammate_count | 2 | 3 |
| captaincy / honour / family / composition / recruiter / list / freebie | 1 each | 58 / 5 / 53 / 3 / 2 / 14 / 1 |

**Every one of the 788 criteria classified. Zero unclassified.**

### 5.1 Rare criteria worth attention

`HYPHENATED SURNAME`, `STEVE / STEVEN FIRST NAME`, `IRISH PLAYER 🇮🇪 ☘️`,
`NFL 🏈 PLAYER OR SIGNEE`, `TASMANIAN`, `WORN #13 GUERNSEY` (and #3/#9/#25/#35),
`PLAYED IN CHINA`, `FREE HIT`, `10 WINS IN A ROW`, `15 LOSSES SINGLE SEASON`,
`MORE FREES FOR THAN AGAINST`, `AVG 5+ SPOILS SINCE 2012`, `GAME WINNING KICK AFTER SIREN`,
`22+ YEARS OLD ON DEBUT`, `B&F + PREMIERSHIP SAME YEAR`,
`DUSTIN MARTIN DEFEATED BY DUSTY IN A GF`, `ADRIAN DODORO RECRUITED BY DODORO`.

`FREE HIT` is a Gridley freebie cell (every player qualifies) and is not an AFLDB predicate.

---

## 6. Current Gridley — Stage 0H

### 6.1 Legacy acquisition implementation (`fetch_grids.py`)

- `fetch_gridley(date)` GETs `https://gridleygame.com/data/grids/{date}.json`.
- Modern branch: if `hItems` and `vItems` are present, `rows = vItems`, `cols = hItems`,
  `grid_num = int(level)`. **Rows are the vertical axis; columns are the horizontal axis.**
- `gridley_label()` joins title+subtitle as described in §4.1.
- `save_grid()` creates `historic_grids` on demand, looks up an existing row by
  `(source, date)`, raises if the target `grid_num` is held by a *different* board, and
  otherwise **UPDATEs the existing row in place**, overwriting `rows_json`/`cols_json` and
  resetting `unsupported_json`/`note`. **This silently destroys prior historical evidence** —
  precisely the behaviour AFLDB must not reproduce (§10.4).
- `scan_gridley()` opens the DB read-only, takes `MAX(date)` for `Gridley`, and scans from
  `latest + 1 day` bounded by a 31-day window ending at `through`. Consequences: it **cannot
  backfill** a gap older than 31 days, and it **never re-checks** an already-saved date, so a
  board captured from a partial or wrong response can never be repaired.
- Error handling: any exception (HTTP error, network failure, malformed JSON) is caught, printed
  and returned as `None`, counted as `unavailable`. **Unavailable, network failure and malformed
  JSON are indistinguishable.**

### 6.2 Live probe (21 requests, 1.5 s apart, no historical crawl)

Endpoint `https://gridleygame.com/data/grids/YYYY-MM-DD.json` **still works**. Every request
returned `HTTP 200` with well-formed JSON, 3 `hItems` and 3 `vItems`.

Current JSON keys:
`completed, correctAnswersPlayerMap, correctGuesses, hItems, level, scoreMap, social, started, vItems`

`hItems`, `vItems` and `level` are all still present, so the legacy parser remains compatible.

**Current board: `2026-08-31` = Gridley #1142.** The `level = 2023-07-16 + date` relationship
that holds across the whole archive still holds today.

#### 6.2.1 FINDING — Gridley retains its ENTIRE history, not ~7 days

`2023-07-17` returned `HTTP 200` with `level = 1` — Gridley board #1, over three years old.
Every probed date from #1 to #1142 returned a complete board.

**The ~7-day retention premise is false.** This materially changes the plan (§10.1, §12).

#### 6.2.2 FINDING — each axis item carries a stable `id` and Gridley's own `description`

```json
{"id": "disposals20avgseason", "title": "20+ DISPOSALS", "subtitle": "AVG (SEASON)",
 "description": "Averaged 20 or more disposals per game for a single season (since 1965).",
 "emoji": "🏉", "type": null, "imgUrl": null}
```

- `id` is a **stable canonical criterion key** (`PA`, `captain`, `premier1x`, `height195`,
  `debut-team-richmond`, `daniel-rioli-teammate-1809`). It is far better than the flattened
  label for mapping, deduplication and persistence.
- `description` is **Gridley's own authoritative statement of the criterion's semantics**. It
  resolves ambiguity that the label alone cannot (see §7.2).
- `type: "player"` marks player-valued criteria, and teammate ids embed the Gridley player id
  (`daniel-rioli-teammate-1809` → 1809), giving a free name→id bootstrap for most of the 482
  teammate criteria. The scheme is not universal (`xavierellis` carries no id suffix).

**None of `id`, `title`/`subtitle` separation, `description`, `type` or `emoji` exists in the
legacy SQLite archive.** 91 distinct criterion ids with descriptions were harvested from the 21
probed boards and saved for reference during Stage 3.

#### 6.2.3 FINDING — `correctAnswersPlayerMap` is a per-cell answer key

It is a 3×3 array of `{gridleyPlayerId: guessCount}` — **Gridley's own complete set of
qualifying players for every cell**. Observed set sizes ranged from 7 to 3,012, and **every
cell in all 21 sampled boards was non-empty**.

This converts the compatibility corpus from "did AFLDB return anything" into a genuine
precision/recall measurement against an external oracle. It requires a Gridley-player-id →
AFLDB-player-id bridge, which does not exist yet (see §14, risk R4).

---

## 7. Compatibility matrix — Stage 0E

AFLDB Grid Solver audited at `src/search/grid-solver-spec.ts` (`GRID_BUILDERS`, **100
builders**, 11 groups, 21 stats in `GRID_STATS`) and `src/db/queries/grid-solver.ts`
(`compileAxis`, 1,031 lines). Prior contracts read: `AFLDB-ISSUE-046`, `-076`, `-103`.

### 7.1 Counts — by distinct criterion and by axis occurrence

| Status | Distinct | Occurrences |
|---|---:|---:|
| `EXACT_EXISTING` | **202** | **3,034** |
| `EXISTING_BUT_SEMANTICALLY_DIFFERENT` | 19 | 2,038 |
| `MISSING_BUT_DATA_AVAILABLE` | 42 | 374 |
| `MAPPING_MISSING_SOLVER_EXISTS` | 19 | 188 |
| `UNSUPPORTED_DATA_ABSENT` | 18 | 48 |
| `AMBIGUOUS_REQUIRES_DECISION` | 488 | 1,056 |
| **Total** | **788** | **6,738** |

`AMBIGUOUS` is dominated by one single question: **482 of the 488** are teammate criteria
(1,029 of the 1,056 occurrences). **Excluding teammates, only 6 distinct criteria (27
occurrences) are ambiguous.**

### 7.2 Proven equivalences (evidence, not text similarity)

- **Inclusive thresholds.** `career_games_max` compiles to `c.games <= N`
  (`grid-solver.ts:261`), and Gridley `50 GAMES OR LESS` is `<= 50`. Exact.
- **Strict-vs-inclusive handled by arithmetic, not by weakening.** Gridley
  `LESS THAN 20 GOALS CAREER` is `< 20`; AFLDB `career_goals_max` is `<= N`, so the mapping is
  `career_goals_max(19)`. Exactly equivalent; **no predicate is loosened**.
- **Finals vs Grand Final are correctly distinct.** AFLDB uses `m.is_final` for finals and
  `m.round_type = 'grand_final'` for Grand Finals — never conflated.
- **Era bounds in Gridley descriptions are disclosures, not extra filters.** Gridley says
  "(since 1965)" for disposals/kicks/marks, "(since 1966)" for hitouts, "(since 1987)" for
  tackles. `docs/data-dictionary.md` §2.1 records AFLDB coverage as
  **disposals/kicks/marks/behinds/handballs 1965**, **hitouts 1966**, **tackles 1987** — the
  same boundaries. Combined with AFLDB's NULL-is-not-zero rule, these criteria are equivalent
  **in effect**, so they stay `EXACT_EXISTING`.
- **`NO FINALS WINS` disambiguated by evidence.** Gridley's description is *"Never won a finals
  game."* with no played-finals gate → maps to `never_won_a_final`, **not**
  `played_finals_no_wins`. Reclassified from AMBIGUOUS to EXACT on this evidence.
- **Club lineage matches on renames.** Gridley: Western Bulldogs *"Includes players who played
  at least 1 game for Footscray"*; Sydney *"Includes … South Melbourne"*. AFLDB resolves club
  axes at `organization_id` (`grid-solver.ts:192-223`), which is the same rule.
- **`150+ GAMES SAME CLUB`.** Gridley: *"…for a single club. Can also have played games for
  other clubs."* AFLDB `games_at_one_club_min` sums per `organization_id` and does not require
  a one-club career. Exact.

### 7.3 FINDING (headline) — the bare club criterion is NOT equivalent

Gridley's own description for every club criterion ends **"…, or currently on their list."**

AFLDB's `played_for_club` reads `player_clubs`, which is games-played only. AFLDB therefore
returns a **strict subset**: it omits every listed-but-never-played player. AFLDB models games
played and has no season list/roster table, so this cannot be fixed by a mapping change.

Two further club-specific divergences:

- **Port Adelaide** is scoped by Gridley to *"Port Adelaide Power in the AFL (1997 onwards)"* —
  the SANFL club is excluded. AFLDB's `organization_id` lineage for Port Adelaide must be
  checked against this.
- **`BRISBANE LIONS FIRST CAREER GAME`** includes *Fitzroy* and *Brisbane Bears* debutants.
  Fitzroy→Brisbane is a **merger**, and AFLDB club-lineage semantics treat mergers as link-only
  rather than as one organization. Equivalence must be decided, not assumed.

This single family is 19 criteria / **2,038 occurrences** and is reclassified
`EXISTING_BUT_SEMANTICALLY_DIFFERENT`. **It must not be silently mapped to `played_for_club`.**

### 7.4 `MAPPING_MISSING_SOLVER_EXISTS` (19 criteria / 188 occurrences)

Award-family criteria where the builder exists (`award_winner`, `award_winner_min_times`,
`award_winner_between_seasons`, `all_australian_position`) but the exact `awards` row name is
not yet confirmed: `ALL AUSTRALIAN` (+ `2x`/`3x`/decade/range variants), `RISING STAR WINNER`,
`NORM SMITH` / `COLEMAN` / `ANZAC` / `SHOWDOWN` / `GLENDINNING ALLAN` / `BRETT KIRK` /
`MARCUS ASHCROFT` `MEDALIST`, `MARK OF THE YEAR`, `GOAL OF THE YEAR`, `AFLPA MVP`,
`ALL AUSTRALIAN RUCKMAN` → `all_australian_position('Ru')`.

Gridley's `allAus1953` description is specific and must be honoured: *"Includes VFL Team of the
Year (1982-90), and All-Australian teams selected after State of Origin carnivals (1953–1988)."*
Likewise `coleman` *"Includes 'Leading Goalkicker Medallists' awarded prior to … 1955."*

**Blocked on one read-only operator query** — the awards inventory (§13, V1).

### 7.5 `UNSUPPORTED_DATA_ABSENT` (18 criteria / 48 occurrences) — keep unsupported

| Criterion | Reason |
|---|---|
| `... COACHED BY ...` (8 criteria), `PREMIERSHIP COACH` | **No coaches table anywhere in AFLDB** |
| `ADRIAN DODORO RECRUITED BY DODORO` | Recruiters / list managers not modelled |
| `TASMANIAN`, `IRISH PLAYER 🇮🇪 ☘️` | **No birthplace or nationality column in the schema** |
| `NFL 🏈 PLAYER OR SIGNEE` | No other-code-football data |
| `22+ YEARS OLD ON DEBUT` | `players.dob` is **~93% NULL by its own column comment** — cannot be answered honestly |
| `2024 LISTED PLAYER` | AFLDB models games played, not season lists |
| `GAME WINNING KICK AFTER SIREN` | No scoring-event timeline |
| `AVG 5+ SPOILS SINCE 2012` | `spoils` is not an AFLDB stat; `one_percenters` is **not** equivalent |
| `INT'L RULES PLAYER FOR AUS` | International Rules representation not modelled |
| `ALL-AUSTRALIAN SQUAD 2024` | Squad/nominees distinct from the selected team |

---

## 8. Missing capabilities — Stage 0G

### 8.1 Category 1 — solver missing, authoritative data exists (42 criteria / 374 occurrences)

Candidates for Stage 4. Each names the AFLDB data that already backs it.

| Capability | Gridley examples | AFLDB data |
|---|---|---|
| Player height predicate | `195cm OR TALLER`, `180cm OR SHORTER` (86 + 54 occ) | `players.height_cm` (`002_core_entities.sql:139`) — **coverage must be measured first** |
| Sibling relationship | `BROTHER PLAYED` (53 occ) | `player_relationships` + `relationship_type` |
| League-wide season rank | `TOP 10 GOAL KICKER SEASON`, `TOP 10 DISPOSAL WINNERS (SEASON)`, `TOP 10 MARK TAKERS (SEASON)` | `player_season_stats` |
| Club-season Brownlow leader | `MOST BROWNLOW VOTES TEAM` (18 occ) | `brownlow_season_votes`; `club_season_stat_leader` is `GRID_STATS`-only |
| All-Australian position **group** | `ALL AUSTRALIAN DEFENDER` / `FORWARD` / `MIDFIELDER` | `all_australian_position` takes one of 14 exact codes; a group is a set |
| Stat within a club-pair matchup | `SHOWDOWN KICKED A GOAL`, `SYDNEY DERBY 5+ TACKLES` | `matchup_played_min` has no stat variant |
| Won a matchup / marquee match | `SHOWDOWN WINNER`, `ANZAC DAY MATCH WINNER` | `matches.winner_club_id` |
| Matchup / finals win rate | `WINNING RECORD IN FINALS`, `WINNING RECORD DERBY GAMES` | matches + `player_match_stats` |
| Won a GF against a named **club** | `BEAT COLL'WOOD IN A GRAND FINAL` | `lost_grand_final_against` takes a **player** and is the inverse |
| Premiership captain | `PREMIERSHIP CAPTAIN` | `captaincies` × premiership season |
| Father-son | `FATHER SON PICK SINCE 1986`, `FATHER OF A FATHER-SON PICK` | `father_son_selections` |
| Guernsey number | `WORN #13 GUERNSEY` (+#3/#9/#25/#35) | `player_match_stats.jumper_number` |
| Name-shape predicates | `HYPHENATED SURNAME`, `STEVE / STEVEN FIRST NAME` | `players.surname` / `given_name` |
| Match margin | `100 POINT WIN PLAYED IN` | `matches` scores |
| Consecutive-win streak | `10 WINS IN A ROW` | `matches` |
| Gather Round | `GATHER ROUND PLAYED IN` / `KICKED A GOAL` | not in `GRID_MATCH_EVENTS`; round/venue data exists |
| Non-goal stat across 2+ clubs | `30+ DISPOSALS TWO DIFF CLUBS` | only goals and games have a multi-club variant |
| GF-scoped repeat feat | `1+ GOAL MULTIPLE GRAND FINALS` | `games_with_stat_min_count` is not GF-scoped |

### 8.2 Category 3 — composition limitations (architectural)

**An axis holds exactly one builder** (`GridAxisState` = one `builder` + `params`). Cells
compile as `rowFragment AND colFragment`, so cross-axis composition itself is sound. The gaps
are *within* one axis:

1. **Two predicates on one axis.** `PICK 1 NATIONAL DRAFT` needs
   `draft_pick_between(1,1)` **and** `draft_type_is('National')`. `FATHER SON PICK SINCE 1986`
   needs a father-son predicate **and** a year bound.
2. **Season-scoped totals.** `20+ GAMES IN 2023` and `15+ GOALS IN 2023` need
   `games_in_season_min` / `season_stat_total_min` **bound to a named season**. Neither builder
   takes a season parameter. Adding one is a small, safe extension.
3. **Same-season conjunction.** `B&F + PREMIERSHIP SAME YEAR` requires two achievements *in the
   same season*. Cross-axis AND is career-scope, so this cannot be expressed even across two
   axes. **Genuinely new capability**, not a mapping fix.

### 8.3 FINDING — the largest composition-semantics risk (needs a decision, not code)

**1,853 of 10,107 cells (18.3%)** cross a bare club criterion with a threshold criterion that
Gridley may intend to be scoped *to that club* (`club × career_games`, `club × season_stat`,
`club × single_game_stat`, `club × club_leader`, `club × finals`, …).

AFLDB compiles these as an unscoped conjunction: *played for club X* AND *achieved Y somewhere
in their career*. If Gridley means *achieved Y while at club X*, the two differ materially. The
sampled descriptions do not settle it. **This must be decided from `correctAnswersPlayerMap`
evidence (§13, V4) before any mapping is written.** It is the single highest-value open
question after §7.3 and §10.2.

### 8.4 Category 4 — performance

None discovered statically. Two prior Grid Solver timeout issues are **Resolved** and set the
binding precedent: `AFLDB-ISSUE-076` (`won_final_at_venue`) and `AFLDB-ISSUE-103`
(`won_a_final` / `never_won_a_final`), both fixed **without** raising
`AFLDB_STATEMENT_TIMEOUT_MS` and without index or schema changes. That precedent governs any
timeout this corpus later exposes. Live measurement is pending operator execution (§13).

---

## 9. Historical cell audit — Stage 0F

**10,107 cells** (1,123 × 9), all classified. **This is static classification only.** Live
execution against PostgreSQL is reserved for the operator by `CLAUDE.md` §9 and was **not
performed**; nothing below claims an executed result.

A cell takes the **worse** of its two axis statuses.

| Static cell class | Count | Share |
|---|---:|---:|
| `B2_EXECUTABLE_SEMANTICS_DIVERGE` (an axis is `EXISTING_BUT_SEMANTICALLY_DIFFERENT` — almost entirely the club "on their list" divergence) | **3,351** | 33.2% |
| `H_AMBIGUOUS_SEMANTICS` (an axis is ambiguous — **3,132 of these are teammate cells**) | **3,154** | 31.2% |
| `A_EXECUTABLE_PENDING_OPERATOR` (both axes `EXACT_EXISTING`) | **1,959** | 19.4% |
| `D_PREDICATE_MISSING_DATA_AVAILABLE` | 1,029 | 10.2% |
| `C_MAPPING_MISSING_SOLVER_EXISTS` | 470 | 4.7% |
| `G_DATA_ABSENT` | 144 | 1.4% |

Axis-status pair matrix (row × column):

```
row\col    EXACT    DIFF     MAP     MDA     AMB     ABS
EXACT       1959    2628      89     112       9      15
DIFF         433     290      63      80       8      20
MAP          161     155       2       8       0      10
MDA          362     428      20      19       3       5
AMB         1326    1694      47      63       4      10
ABS           49      25       7       3       0       0
```

Most frequent family pairings: `club × teammate` (1,658), `award × club` (591),
`club × single_game_stat` (426), `decade_played × teammate` (347), `club × finals` (290),
`club × club` (286).

### 9.1 What has NOT been established

Classes **A (supported + answered)**, **B (supported + legitimately empty)**, **E (composition
defect)** and **F (performance defect)** from the task's taxonomy **cannot be assigned without
live execution**. The 1,959 `A_EXECUTABLE_PENDING_OPERATOR` cells are the population an
operator-run audit would execute to split A from B, E and F. No cell has been marked answered
or empty. No execution error, statement timeout or duration was observed, because nothing was
executed. Class **I (execution/infrastructure blocked)** applies to the whole corpus for this
session, by repository policy rather than by fault.

**Prior signal on class B:** every cell in all 21 sampled live boards had a non-empty Gridley
answer set (7–3,012 players). An empty AFLDB result for such a cell is therefore *prima facie*
suspicious — but **not** automatically a defect, since AFLDB legitimately excludes the
"currently on their list" players Gridley includes (§7.3).

### 9.2 Resolving two questions moves ~64% of the corpus

`club` (§7.3) and `teammate` (§10.2) together account for **6,505 of 10,107 cells (64.4%)**.
Both are decidable from evidence, and `correctAnswersPlayerMap` makes both cheap to settle.

---

## 10. Design decisions

### 10.1 DECISION — re-acquire the full history from Gridley; keep SQLite as cross-check

Because Gridley still serves **every** board back to #1 (§6.2.1), and because the live JSON
carries `id`, `title`/`subtitle` separately, `description` and `correctAnswersPlayerMap` that
the legacy archive **does not have** (§4.1, §6.2.2), the primary import source should be
**Gridley itself**, not the SQLite file.

The legacy archive remains valuable and should still be imported, as:
- an **independent provenance record** captured at the time (protects against upstream revision);
- a **cross-check** on the re-acquired history — the two overlapping dates already matched exactly;
- a **hedge** if Gridley's retention changes before the backfill completes.

This is a change from the premise in the task brief and is the single most consequential Stage 0
finding for the plan.

### 10.2 OPEN — teammate semantics (482 criteria / 1,029 occurrences / 3,132 cells)

AFLDB `teammate_of` is **same club-season overlap** (`player_club_season_stats` self-join,
`grid-solver.ts:645`). Gridley's description is only *"Player has been a teammate of X."*
Same-season-same-club and same-match are different rules and produce different sets.

**Do not assume equivalence.** Settle it empirically against `correctAnswersPlayerMap` (§13, V4).

### 10.3 DECISION — preserve the raw source JSON

**Yes, preserve it**, for these evidenced reasons:

- The legacy capture already proves the cost of not doing so: the flattened label destroyed
  `id`, the title/subtitle split, `description` and `type`, and is not reversible (§4.1).
- `correctAnswersPlayerMap` is large, is the compatibility oracle, and its usage will evolve —
  a reparse must be possible without re-fetching.
- Upstream schema has already changed once (the legacy parser carries a pre-`hItems` fallback).
- Payloads are modest: 12–143 KB observed, ~40 KB typical. At ~1,150 boards this is roughly
  **50 MB** — acceptable for the forensic value.

Store it compressed as `jsonb` alongside parsed columns, not instead of them.

### 10.4 DECISION — historical evidence is immutable

The legacy scraper's in-place UPDATE (§6.1) is the anti-pattern. AFLDB must **never** overwrite
a captured board. If Gridley later serves different content for a date already captured, record
a **new revision** and flag a conflict; never mutate the original row.

---

## 11. Proposed persistence design — Stage 0J

Board table + axis table, with raw JSON retained on the board. This is repository-consistent
(mirrors the normalised-entity + provenance pattern already used across AFLDB) and keeps the
six criteria addressable as rows for mapping and reporting.

```
external_grid_sources        -- 'Gridley' today; do NOT build an abstract multi-source platform
  id, code UNIQUE, name, base_url, notes

external_grids               -- one row per captured board REVISION
  id
  source_id            -> external_grid_sources
  board_number         integer NOT NULL      -- Gridley `level`
  board_date           date    NOT NULL
  revision             integer NOT NULL DEFAULT 1
  is_current           boolean NOT NULL DEFAULT true
  payload_sha256       text    NOT NULL      -- conflict detection
  raw_payload          jsonb   NOT NULL      -- §10.3
  fetched_at           timestamptz NOT NULL DEFAULT now()
  imported_at          timestamptz NOT NULL DEFAULT now()
  import_batch_id      -> import_batches
  provenance           text NOT NULL         -- 'gridley_api' | 'legacy_sqlite'
  UNIQUE (source_id, board_number, revision)
  UNIQUE (source_id, board_date, revision)
  -- exactly one current revision per board:
  CREATE UNIQUE INDEX ... ON external_grids (source_id, board_number) WHERE is_current;

external_grid_axes           -- exactly 6 per grid revision
  id
  grid_id              -> external_grids ON DELETE CASCADE
  orientation          text NOT NULL CHECK (orientation IN ('row','col'))
  position             smallint NOT NULL CHECK (position BETWEEN 0 AND 2)
  criterion_key        text                  -- Gridley item `id` (NULL for legacy-only rows)
  raw_title            text
  raw_subtitle         text
  raw_description      text
  raw_label            text NOT NULL         -- the flattened legacy-compatible label
  item_type            text                  -- Gridley `type`, e.g. 'player'
  UNIQUE (grid_id, orientation, position)

external_grid_answers        -- OPTIONAL, Stage 6: the Gridley oracle
  grid_id, row_position, col_position, source_player_key, guess_count
  UNIQUE (grid_id, row_position, col_position, source_player_key)
```

Mapping lives in a **separate** table so source evidence is never overwritten (§13, Stage 3):

```
external_grid_criterion_map
  source_id, criterion_key (or raw_label when key is absent)
  status            -- the six Stage 0E statuses
  builder_key       -- NULL unless EXACT/mapped
  builder_params    jsonb
  rationale         text
  decided_at, decided_by
  UNIQUE (source_id, criterion_key)
```

Notes:
- `board_number` and `board_date` are each unique per current revision; both are asserted
  because the archive proves they are 1:1 and a divergence is itself a finding.
- `grant_app_read()` **must** be called for every new public table — app read is fail-closed
  since migration 039, and `privileges.sql` must be reconciled.
- Nothing here is created during Stage 0.

> **CORRECTED IN STAGE 1 — see §20.2.** Two parts of the sketch above are wrong as written
> and were changed with evidence, not preference: the uniqueness keys must include
> `provenance` (otherwise §10.1 and §12B are unimplementable), and `fetched_at` must be
> nullable (the archive records no capture time). The rest of §11 was implemented as
> specified.

---

## 12. Proposed import design — Stage 0K

Two importers, sharing one idempotent upsert path.

**A. Legacy SQLite importer** (`tools/migration/import_external_grids.py` or the repo's
prevailing tool convention):

- opens the source with `file:...?mode=ro` **read-only**, plus `PRAGMA query_only=ON`;
- validates `source = 'Gridley'`, integer `grid_num`, ISO `date`, exactly 3 rows + 3 cols,
  all criteria non-empty strings;
- provenance `legacy_sqlite`; `criterion_key`, `raw_title`, `raw_subtitle`, `raw_description`
  are **NULL** (the archive does not have them) — `raw_label` only;
- deterministic ordering by `grid_num`; restartable; idempotent;
- on an existing board with **identical** content → `unchanged`; with **different** content →
  `conflict`, **refuse to overwrite**, report and continue;
- `--dry-run`; reports `inserted / unchanged / conflict / error` counts;
- the SQLite file is **not committed to Git** (537 MB, external artifact). It is an operator-
  supplied input path, consistent with how `AFLDB_LEGACY_SQLITE` is already handled elsewhere in
  the repo. After a successful, validated import it need not remain available.

**B. Gridley backfill importer** — same upsert path, provenance `gridley_api`, populating the
full item detail. Because Gridley serves the whole history, this is the **richer** source; where
both exist, the Gridley row is authoritative for detail and the SQLite row is the cross-check.
Backfill must be politely rate-limited (≥1 s between requests, resumable, bounded per run).

---

## 13. Proposed acquisition design — Stage 0L

- **Rolling window**, not today-only. Gridley's full retention (§6.2.1) removes the urgency but
  not the requirement: a bounded recent window (**14 days** suggested; the observed retention
  supports far more, so the window is chosen for operational recovery, not retention) lets AFLDB
  recover from an outage without a full crawl.
- Use the repository's **existing** scheduling/acquisition mechanism (`tools/migration/` job
  conventions plus the existing `deploy/` scheduling); **do not introduce a new scheduler**.
- Idempotent; already-saved unchanged boards are a no-op.
- **Distinguish outcomes explicitly** — the legacy scraper's worst flaw (§6.1):
  `saved` / `unchanged` / `unavailable (HTTP 404)` / `http_error` / `network_error` /
  `malformed_json` / `conflict`. Never collapse them into "unavailable".
- **Conflict/revision policy:** compare `payload_sha256` against the current revision. If it
  differs, insert a **new revision**, set the previous `is_current = false`, and raise a data
  issue. **Never** overwrite (§10.4).
- Rate-limit ≥1 s between requests; identify politely; retry with backoff on transport errors
  only, never on a clean 404.
- Emit operational counts and log to the existing health/telemetry path.

---

## 14. Proposed regression design — Stage 0N

Three layers, matching `CLAUDE.md` §10's escalation discipline.

1. **Exhaustive corpus audit** (offline / release-gate, operator-run, **not** normal CI).
   All boards × 9 cells. Emits the metric set below and a machine-comparable artifact so two
   code revisions can be diffed.
2. **Focused CI subset.** A small deterministic sample covering every semantic family, every
   mapped builder, the important combinations, previously failing combinations and the semantic
   edge cases (inclusive/exclusive thresholds, final vs Grand Final, rename lineage, NULL stats).
   Extends `tests/integration/grid-solver.test.ts` rather than creating a new home.
   **Do not add 10,107 cells as CI tests.**
3. **Performance subset.** Only cells measured to be expensive, carried forward explicitly, under
   the ISSUE-076/103 precedent: **never** raise the statement timeout to make it pass.

Metrics to report and compare across revisions: archived boards; axis occurrences; distinct raw
and normalized criteria; counts for each of the six statuses; total cells; executable cells;
answered; legitimately empty; mapping failures; composition failures; SQL/runtime failures;
statement timeouts; performance outliers. Once the Gridley-id bridge exists, add **precision and
recall against `correctAnswersPlayerMap`** — the strongest available correctness signal.

---

## 15. Validation

### 15.1 Executed this session

| Check | Result |
|---|---|
| Worktree / branch / HEAD / base identity | PASS (§1) |
| SQLite read-only integrity audit, 1,123 rows | PASS — zero anomalies (§3) |
| Grid-number and calendar continuity, full enumeration | PASS (§3) |
| JSON shape, criterion type/blank checks | PASS (§3) |
| Criterion inventory, 6,738 occurrences → 788 distinct | PASS (§4) |
| Classification coverage | PASS — 788/788, zero unclassified |
| Cell enumeration | PASS — 10,107 = 1,123 × 9 |
| Live Gridley probe, 21 requests @1.5 s | PASS (§6.2) |
| Legacy archive vs live Gridley fidelity, 2 overlapping dates | PASS — exact match |
| Repository hygiene (`git diff --check`, `git status`) | PASS (§17) |

No AFLDB test, build, typecheck, SQL, psql, service or Git-mutating command was executed. No
production system was touched. The legacy SQLite database was not modified.

### 15.2 Blocked — pending operator execution

`CLAUDE.md` §9 reserves SQL/psql execution for the operator. The following are **required
before Stage 3 mapping is written**; no workaround was implemented.

**V1 — awards inventory** (unblocks 19 `MAPPING_MISSING_SOLVER_EXISTS` criteria):
```sql
SELECT a.id, a.name, count(w.*) AS winners, min(w.season), max(w.season)
  FROM awards a LEFT JOIN award_winners w ON w.award_id = a.id
 GROUP BY a.id, a.name ORDER BY a.name;
```

**V2 — height coverage** (decides whether the height predicate can be built honestly):
```sql
SELECT count(*) AS players,
       count(height_cm) AS with_height,
       count(*) FILTER (WHERE height_cm >= 195) AS tall,
       count(*) FILTER (WHERE height_cm <= 180) AS short
  FROM players;
```

**V3 — club lineage vs Gridley scoping** (§7.3):
```sql
SELECT o.id, o.name, array_agg(c.name ORDER BY c.id) AS identities
  FROM clubs c JOIN organizations o ON o.id = c.organization_id
 GROUP BY o.id, o.name ORDER BY o.name;
```
Specifically: is SANFL Port Adelaide inside the Port Adelaide organization, and are Fitzroy /
Brisbane Bears inside the Brisbane Lions organization?

**V4 — the two headline semantic decisions** (§7.3, §8.3, §10.2). Take one recent board whose
`correctAnswersPlayerMap` is already captured, and compare AFLDB's result set for a
`club × teammate` cell and a `club × threshold` cell against Gridley's answer set. This settles
teammate overlap (season vs match), club "on their list", and club-scoped thresholds together.
Requires the Gridley-player-id bridge, so it is Stage 2/3 work, not a single query.

**V5 — the exhaustive live cell audit** (§9). Cannot run under Stage 0 policy and must not be
faked. It belongs to Stage 6 tooling and Stage 7 execution.

---

## 16. Risks and open questions

| Ref | Risk / question |
|---|---|
| R1 | **Club "on their list" (§7.3)** — 2,038 occurrences. AFLDB cannot represent it. Decide whether to map to `played_for_club` with a documented known divergence, or to classify unsupported. **Do not silently equate them.** |
| R2 | **Teammate rule (§10.2)** — 1,029 occurrences. Season-overlap vs same-match is unproven. |
| R3 | **Club-scoped thresholds (§8.3)** — 1,853 cells. Whether Gridley scopes the threshold to the paired club is undecided. |
| R4 | **Gridley player-id bridge** — `correctAnswersPlayerMap` uses Gridley-internal ids. Teammate criterion ids give a partial name→id bootstrap (not universal: `xavierellis`). Needed before any precision/recall metric. |
| R5 | **Upstream volatility** — Gridley could change schema or retention at any time. This is the argument for capturing raw JSON and backfilling early. |
| R6 | Fitzroy/Bears merger lineage vs AFLDB merger-is-link-only semantics (§7.3). |
| R7 | `docs/data-dictionary.md` §2.1 warns `available_from`/`available_to` are bounds, **not** proof of continuity. Era-equivalence in §7.2 relies on those bounds; per-season presence is the stronger check if a discrepancy appears. |
| R8 | Storage of `raw_payload` at ~50 MB is modest but should be confirmed against backup/restore expectations before Stage 1 lands. |

---

## 17. Files changed in Stage 0

| File | Change |
|---|---|
| `issues/open/AFLDB-ISSUE-118.md` | **new** — this runbook |
| `issues.md` | new `AFLDB-ISSUE-118` entry + Open Issues table row |
| `IssuesIndex.md` | new open-issue row; header counts updated |

**No source, migration, tool, test or `CHANGELOG.md` change was made.** `CHANGELOG.md` is
deliberately **not** updated: `CLAUDE.md` §5 restricts it to meaningful retained changes in
project behaviour, and Stage 0 is investigation-only. It becomes due at Stage 1.

Analysis scripts were written to the session scratchpad (outside the repository) and are
deliberately **not** durable repository tooling — `CLAUDE.md` §32/§13 prefers temporary analysis,
and the durable equivalents belong to Stage 6.

---

## 18. Stage plan

| Stage | Work | Required validation | Stop |
|---|---|---|---|
| **1** | PostgreSQL schema + migration (§11), `grant_app_read()` + `privileges.sql`, data access, legacy SQLite importer with dry-run (§12) | migration test, importer integrity + idempotency + conflict tests, typecheck | yes |
| **2** | Gridley JSON client, `id`/title/subtitle/description preservation, full historical backfill, rolling-window acquisition, revision/conflict policy (§13) | acquisition parsing tests, recovery tests, conflict tests | yes |
| **3** | Deterministic mappings for the 202 `EXACT_EXISTING` criteria only, in `external_grid_criterion_map`. Requires V1 and V3 first. **No new predicate semantics.** | mapping tests, semantic tests, no change to existing Grid Solver behaviour | yes |
| **4** | The `MISSING_BUT_DATA_AVAILABLE` predicates (§8.1), each with focused semantic tests. Requires V2 for height. **Nothing where data is absent or ambiguous.** | new builder tests + full existing Grid Solver suite unchanged | yes |
| **5** | Composition fixes (§8.2): season-bound parameters, two-predicate axes, same-season conjunction | composition tests; **never weaken a predicate to manufacture answers** | yes |
| **6** | Compatibility/regression harness: exhaustive audit tool, coverage metrics, focused CI subset, performance subset (§14) | subset green in CI; exhaustive audit runs offline | yes |
| **7** | Operator-safe execution: import all legacy boards, backfill Gridley history, run the exhaustive audit, record results | full counts, timeout/performance evidence, final compatibility report | yes |

Stage order is unchanged from the brief except that **Stage 2 now also performs the full
historical backfill**, because Gridley still serves it (§10.1).

---

## 19. Stage 1 as originally specified (superseded by §20)

Create the migration implementing §11 — `external_grid_sources`, `external_grids`,
`external_grid_axes` (defer `external_grid_answers` to Stage 6) — as the next sequential
migration after `079_nl_search_log_head_to_head_grain.sql`, i.e. **`080_external_grids.sql`**,
including:

1. the partial unique index enforcing exactly one `is_current` revision per board;
2. `afldb_meta.grant_app_read()` for each new public table (app read is fail-closed since
   migration 039) and the matching `privileges.sql` reconciliation;
3. table and column comments recording that captured boards are **immutable historical
   evidence** and that revisions are additive.

Then implement the legacy SQLite importer per §12 with `--dry-run` first, and run it in dry-run
against all 1,123 rows before any write.

**Recommended for Stage 1: a fresh session, Fable High** (`docs/development/WORKFLOW.md` §2 —
multi-file implementation against an approved runbook). High reasoning was sufficient for Stage
0; XHigh is not required. Stage 3 and Stage 5 involve genuine semantic judgement and should be
re-assessed for Opus at that point.

---

## 20. Stage 1 — persistence and legacy importer: IMPLEMENTED

**Status: COMPLETE. The operator gate passed on 31 August 2026 (§20.8).** Migration 080 is
applied to `afldb_dev`, grants are reconciled, and all 1,123 rescued boards are imported with
idempotency proved by an immediate rerun. Stage 1 is finished; ISSUE-118 stays **Open** because
Stages 2–7 remain.

| Field | Value |
|---|---|
| Branch / worktree | `opus/gridley-corpus` / `D:\dev\afldb-gridley` |
| HEAD at session start | `9ecc6fc` — Document Gridley corpus Stage 0 |
| Working tree at start | clean |
| Model / effort | Opus 5, High |
| Commits made | **none** — Git is operator-operated (`CLAUDE.md` §12) |

### 20.1 Files changed

| File | Change |
|---|---|
| `src/db/migrations/080_external_grids.sql` | **new** — `external_grid_sources`, `external_grids`, `external_grid_axes`, the `gridley` registry rows, and the grant model |
| `tools/migration/import_external_grids.py` | **new** — read-only legacy SQLite importer with `--dry-run` and `--no-db` |
| `tools/maintenance/privileges.sql` | reconciler re-grants the corpus's narrow append-only set after its revoke loop |
| `tests/external-grids-import.test.ts` | **new** — the Stage 1 contract suite (migration SQL + importer behaviour), DB-free |
| `issues/open/AFLDB-ISSUE-118.md` | this section; §11 correction marker; §19 marked superseded |
| `IssuesIndex.md`, `issues.md` | state and next action moved from Stage 0 to Stage 2 |
| `CHANGELOG.md` | `Unreleased` entry for the schema and importer |

Nothing else was touched. `AFLDB-ISSUE-117` was not opened or modified. The legacy SQLite
archive and its scraper were not modified; the archive was proved byte-identical before and
after every run (§20.6).

### 20.2 FINDING — §11's uniqueness keys contradict §10.1 and §12B

§11 specified:

```
UNIQUE (source_id, board_number, revision)
UNIQUE (source_id, board_date, revision)
CREATE UNIQUE INDEX ... ON external_grids (source_id, board_number) WHERE is_current;
```

§10.1 requires the rescued archive to be imported **as well as** the Gridley backfill — "an
independent provenance record captured at the time" and "a cross-check on the re-acquired
history" — and §12B says "where both exist, the Gridley row is authoritative for detail and the
SQLite row is the cross-check". Both statements require the two captures of a board to exist
**at the same time**.

With `provenance` absent from the key, they cannot. Board #1 captured from `legacy_sqlite` and
board #1 captured from `gridley_api` are two rows with the same `(source_id, board_number)`, so
the partial unique index admits only one as current. The Gridley backfill could then land only
by superseding the archive row — the cross-check destroying the thing it exists to check. The
`payload_sha256` conflict rule compounds it: the two paths produce structurally different
payloads by construction, so every backfilled board would also be reported as a content
conflict against an archive row that is not in conflict with it at all.

**Resolution.** `provenance` is part of the revision key:

```sql
UNIQUE (source_id, provenance, board_number, revision)
CREATE UNIQUE INDEX ux_external_grids_current_number
  ON external_grids (source_id, provenance, board_number) WHERE is_current;
CREATE UNIQUE INDEX ux_external_grids_current_date
  ON external_grids (source_id, provenance, board_date)   WHERE is_current;
```

Each acquisition path keeps its own revision chain, both captures of a board coexist, and
comparing them is an ordinary query rather than a constraint violation.
`tests/external-grids-import.test.ts` asserts the provenance-scoped key positively **and**
asserts the narrower key's absence, so a regression to §11's original form fails.

`UNIQUE (source_id, board_date, revision)` was **not** carried across in that form. Revision
numbers are per board, so that constraint cannot catch two different boards sharing a date
(they would sit at different revision numbers), while it *can* forbid a legitimate correction
that re-dates a board. The invariant that matters — board number and date are 1:1 — is asserted
where it is true and enforceable, over current revisions, by `ux_external_grids_current_date`.

### 20.3 Schema decisions actually made

Beyond §20.2, and all recorded in the migration's own comments:

* **`fetched_at` is nullable, with no `now()` default.** §11 had `NOT NULL DEFAULT now()`. The
  legacy archive records no capture timestamp (§3 — the table has seven columns and none is a
  time), so `now()` would stamp a board captured in 2023 with a 2026 capture time. That is a
  fabricated provenance claim in the one table whose entire purpose is provenance. NULL means
  "the capture did not record it", consistent with AFLDB's NULL-is-not-zero discipline.
* **`payload_sha256` is `char(64)` with a `~ '^[0-9a-f]{64}$'` CHECK**, matching migration 074's
  `source_payloads.payload_hash` rather than §11's bare `text`.
* **The hash recipe is stated, not assumed**: SHA-256 over
  `json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)` as UTF-8.
  jsonb normalises key order and whitespace on the way in, so a value read back out of
  PostgreSQL and re-serialised the same way reproduces the hash. The stored hash is therefore
  checkable, not merely stored.
* **`raw_payload` holds the archive row verbatim** — the JSON columns stay as the exact strings
  SQLite returned, not as reparsed arrays — under `{"source", "table", "row"}`. Nothing
  machine-specific (no file path, no timestamp) is in the hashed payload, so the hash is
  reproducible on any host.
* **`external_grid_sources` gained `ingest_source_id smallint NOT NULL UNIQUE REFERENCES sources(id)`.**
  `import_batches.source_id` requires a `sources` row, and AFLDB's provenance convention ties
  every ingested fact to that registry. The FK stops the grid registry and the ingest registry
  from disagreeing about who published a board. One `sources` row (`key = 'gridley'`,
  `kind = 'scrape'`) covers both acquisition paths; the path is recorded per row in
  `external_grids.provenance`, not as a second dataset.
* **`external_grid_answers` and `external_grid_criterion_map` were not created**, per §19 and
  §18 (Stage 6 and Stage 3). The suite asserts their absence, so a mapping cannot be smuggled
  into the evidence schema.

### 20.4 FINDING — the corpus is deliberately NOT import-writable

`afldb_meta.grant_import_write()` grants `SELECT, INSERT, UPDATE, DELETE, TRUNCATE`, and
`privileges.sql` regenerates that whole set from `import_writable_tables` on every reconcile.
Registering the corpus there would mean a hand `REVOKE` is silently undone at the next
`npm run db:privileges`, and the corpus would stop being immutable (§10.4) without anyone
editing a file. That is exactly the reasoning migration 074 applied to `promotion_decisions` and
066/073/078 applied to `data_edits` / `data_overrides`.

So the grant model is:

| Role | `external_grid_sources` | `external_grids` | `external_grid_axes` |
|---|---|---|---|
| `afldb_app` | SELECT (registered via `grant_app_read`) | SELECT | SELECT |
| `afldb_import` | SELECT | SELECT, INSERT, **UPDATE (is_current) only** | SELECT, INSERT |
| `afldb_auth` | — | — | — |

No `DELETE`, no `TRUNCATE`, and no `UPDATE` of any captured byte, for any role that writes.
`is_current` is the single mutable column because superseding a revision is additive history,
not a rewrite; Stage 1 issues no UPDATE at all. `privileges.sql` restates these after its
`afldb_import` revoke loop, which is what makes them survive a reconcile — that is the "matching
`privileges.sql` reconciliation" §19.2 asks for. **No registry list was hand-edited**: the
app-read and import-write registries are data, and `npm run db:privileges` needs no file change
for a newly registered readable table.

### 20.5 Importer decisions actually made

`tools/migration/import_external_grids.py`, per §12A:

* **Read-only twice over**: `sqlite3.connect("file:...?mode=ro", uri=True)` plus
  `PRAGMA query_only=ON`. The file contains no SQLite statement that could mutate the archive,
  and the suite asserts that.
* **Source validation before any row is read**: the `historic_grids` table must exist, carry all
  seven expected columns, and hold `source = 'Gridley'` and nothing else. A foreign game's rows
  are a **refusal**, not a filter — silently importing them under Gridley provenance would be a
  lie about who published a board.
* **Two-phase, fail-closed**: the whole archive is parsed and validated before the first
  `INSERT`. If any row is rejected, **nothing at all** is written. A partial rescue with the
  defect unrecorded is the failure mode worth preventing.
* **Every rejection is named**, never repaired: `rows_json_malformed`, `cols_json_not_array`,
  `rows_json_wrong_length`, `cols_json_non_string`, `cols_json_blank`, `rows_json_missing`,
  `date_not_iso`, `date_invalid`, `date_missing`, `grid_num_not_integer`,
  `unsupported_json_malformed`, `duplicate_grid_num`, `duplicate_date`. No trimming, padding,
  case folding or coercion anywhere on the path.
* **Dates must be ISO extended.** `date.fromisoformat` accepts `20230718` on Python 3.11+, which
  would silently admit a differently-formatted archive, so an explicit `^\d{4}-\d{2}-\d{2}$`
  gate runs first.
* **Criterion text is preserved byte-for-byte** — leading/trailing whitespace, case and emoji
  included. Normalisation is an analysis step (§4), and normalising during import would rewrite
  the evidence before anyone classified it.
* **`unsupported_json` and `note` are validated, not ignored.** Both are vestigial across all
  1,123 rows, but malformed content in them is a rejection, any content is preserved verbatim in
  `raw_payload`, and non-empty occurrences are counted in the report. Surfaced, never dropped.
* **Idempotent by classification**: `inserted` / `unchanged` / `conflict`. An identical board is
  a no-op, so a rerun is safe and restartable. A board whose stored content differs is a
  **conflict**: refused, reported, recorded against the import batch via `import_rejections`,
  and the run continues. A date already held by a different captured board is also a conflict,
  detected before the write rather than surfacing as a unique-index violation part-way through.
* **`--dry-run` cannot write.** It opens no `ImportBatch` — creating one is itself a committed
  `INSERT` — issues no `INSERT`, and rolls its read transaction back. It does still *read*
  PostgreSQL, to classify each board, so it needs a DSN and the psycopg driver. **`--no-db` is
  the DB-free mode**: `--dry-run --no-db` never contacts PostgreSQL and never imports the
  driver. See §20.7.
* **`--limit` is dry-run only.** A partial rescue that prints "OK" is how a half-imported corpus
  gets mistaken for a complete one.
* **`psycopg` and `common` are imported lazily**, inside the database path. Every other importer
  in `tools/migration/` imports them at module scope because every other importer needs a
  database; this one has a contractual DB-free mode — `--dry-run --no-db`, and only that — and a
  module-scope import would make it unrunnable on exactly the machines it exists for. `load_env`
  is a ten-line copy of `common.load_env` for the same reason, marked as such. Note the limit of
  this: `common.py` still imports `psycopg` at module scope, so every mode that reaches
  PostgreSQL needs the driver (the AFLDB venv), which is what §20.7's step 5 uses.

Deferred to Stage 2 by design: no `data_issues` write (§12A's contract is "report and continue";
raising data issues belongs to §13's acquisition path), and no revision creation — Stage 1 only
ever inserts revision 1.

### 20.6 Validation executed

Everything below was run in this session. **No SQL, psql, migration, Git or deployment command
was executed**, and no database was contacted.

**V-S1.1 — full-archive dry run (the mandatory Stage 1 milestone).**

```
python tools/migration/import_external_grids.py --dry-run --no-db \
  --sqlite "D:/dev/sports_data_lab/data/afl/afl.db"
```

```
Source
  table                : historic_grids (1123 row(s))
  rows read            : 1123
  boards parsed        : 1123
  rows rejected        : 0
  board number range   : #1 - #1123
  board date range     : 2023-07-17 - 2026-08-12
  distinct numbers     : 1123
  distinct dates       : 1123
  axis occurrences     : 6738
  distinct raw labels  : 788
  gaps in number range : 0
  duplicate numbers    : 0
  duplicate dates      : 0
  rows with unsupported: 0
  rows with a note     : 0

OK: 1123 board(s) validated. No database was contacted.
```

Exit 0. **All 1,123 rows validated, zero rejections.** The importer independently reproduces
Stage 0's headline figures — 6,738 axis occurrences and 788 distinct raw criteria (§3, §4) —
from a separate implementation, which is corroboration rather than restatement.

**V-S1.2 — importer behaviour, 33 checks, all PASS.** Throwaway SQLite fixtures built and torn
down per case; the real archive untouched.

| Group | Proven |
|---|---|
| Source refusal | missing `historic_grids`; a non-Gridley `source` value refused **before** any row is parsed |
| Structural rejection (12 cases) | malformed JSON; object instead of array; 2- and 4-element axes; non-string element; blank element; NULL axis column; `18/07/2023`; `20230718`; `2023-02-30`; NULL date; malformed `unsupported_json` — each named, each leaving nothing written |
| Corpus integrity | two boards on one date rejected as `duplicate_date`; a gap in the number sequence reported but **not** fatal |
| Determinism | byte-identical stdout across two runs; canonical JSON is sorted and compact; the hash is key-order independent |
| Read-only | source archive SHA-256 identical before and after; no `-journal`, `-wal` or `-shm` created beside it |
| Fidelity | criterion text preserved verbatim including surrounding whitespace and emoji |
| Idempotency / immutability | fresh → insert; identical → **unchanged**; different content → **conflict, refuses overwrite**; date held by another board → conflict; axes ordered `row 0-2` then `col 0-2` |
| CLI guards | `--no-db` without `--dry-run` → exit 2; `--limit` without `--dry-run` → exit 2 |
| Lazy import | module imports and runs with `psycopg` unavailable |

**V-S1.3 — migration, privileges and importer source contracts, 87 checks, all PASS.** Every
non-Python assertion in `tests/external-grids-import.test.ts` was executed against the real files
by an equivalent plain-Node mirror (`node_modules` is absent from this worktree; see §20.7).
Covers: exactly three tables created; `external_grid_answers` / `external_grid_criterion_map`
absent; no FK into any canonical table; no trigger or rule; no Grid Solver builder reference;
both registry rows seeded; provenance-scoped revision key present and the §11 key absent; both
partial unique indexes; `fetched_at` nullable with no `now()` default; `payload_sha256`,
`raw_payload` and their CHECKs; the axis shape constraints; all three `grant_app_read` calls;
`grant_import_write` absent; no `DELETE` or `TRUNCATE` granted; the column-scoped `is_current`
UPDATE as the only UPDATE; the `privileges.sql` re-grant block; `afldb_auth` untouched; the
importer's read-only and lazy-import contracts; and the dry-run branch reaching neither an
import batch nor an `INSERT`.

**V-S1.4 — the test file parses.** `node --experimental-strip-types` parsed
`tests/external-grids-import.test.ts` successfully; it failed only at `vitest` module
resolution, which is §20.7's gate.

### 20.7 The operator gate — commands as they must actually be run

**EXECUTED AND PASSED — results in §20.8.** Kept here because it is the reproducible procedure,
corrected against what the operator actually hit. At authoring time this worktree had no
`node_modules`, and `CLAUDE.md` §9 reserves package-manager, migration and SQL commands for the
operator.

**Prerequisites, each of which stopped a first attempt:**

| Prerequisite | Why | Symptom when missing |
|---|---|---|
| `AFLDB_OWNER_DATABASE_URL` | `db:migrate` targets the owner DSN; this worktree has no `.env` of its own (load the repository-standard one from `D:\dev\afldb\.env`) | migrate stops **before** connecting; nothing applied |
| The PostgreSQL SSH tunnel | the DSN is `127.0.0.1:5432` through the tunnel | `ECONNREFUSED 127.0.0.1:5432`; nothing applied |
| `psql` on `PATH` | `db:privileges` shells out to it (`C:\Program Files\PostgreSQL\16\bin`) | script refuses and reports "Nothing has been executed." |
| The AFLDB venv, `D:\dev\afldb\.venv` (psycopg 3.3.4) | **any** importer mode that touches PostgreSQL | `ModuleNotFoundError: psycopg`, raised by `common.py` |

Each of those failed closed with nothing half-done — which is the behaviour to want, and worth
recording as evidence rather than as friction.

```powershell
# 1. Dependencies for this worktree (once)
npm ci

# 2. The Stage 1 suite, then the wider gates
npx vitest run tests/external-grids-import.test.ts
npm run typecheck
npx eslint tests/external-grids-import.test.ts   # scoped: see §20.8 on repo-wide lint debt

# 3. Apply the migration to dev, then reconcile grants.
#    ORDER MATTERS: privileges.sql revokes every public table absent from the
#    registries, so it must run AFTER the migration, never before.
npm run db:migrate
npm run db:privileges

# 4. Source-side validation with NO database and NO driver required.
#    --no-db is the DB-free mode. Plain --dry-run is NOT: it classifies against
#    PostgreSQL, so it imports common.py and therefore needs psycopg.
python tools/migration/import_external_grids.py --dry-run --no-db --sqlite "D:/dev/sports_data_lab/data/afl/afl.db"

# 5. Dry run against the real database — classification, still no write.
#    Needs the venv interpreter.
D:\dev\afldb\.venv\Scripts\python.exe tools/migration/import_external_grids.py --dry-run --sqlite "D:/dev/sports_data_lab/data/afl/afl.db"

# 6. The import itself (expect: 1123 inserted, 0 unchanged, 0 conflicts)
D:\dev\afldb\.venv\Scripts\python.exe tools/migration/import_external_grids.py --sqlite "D:/dev/sports_data_lab/data/afl/afl.db"

# 7. Rerun it. Idempotency means 0 inserted, 1123 unchanged, 0 conflicts.
D:\dev\afldb\.venv\Scripts\python.exe tools/migration/import_external_grids.py --sqlite "D:/dev/sports_data_lab/data/afl/afl.db"
```

Steps 5–7 need `AFLDB_IMPORT_DATABASE_URL` (and `AFLDB_LEGACY_SQLITE`, if `--sqlite` is omitted).
The importer runs as `afldb_import`, so step 3 must have completed or every INSERT fails closed.

**Correction — which mode is DB-free.** Only `--dry-run --no-db` is. Plain `--dry-run` validates
the source and then classifies each board against `external_grids`, so it imports `common.py`,
which imports `psycopg` at module scope; on an interpreter without the driver it fails **after**
source validation and before any classification. That is the correct failure — it never writes —
but it is not a DB-free mode and must not be documented as one. Every DB-free claim in this
runbook (§20.5, §20.6 V-S1.1) is about `--dry-run --no-db`.

**Storage check for R8**, worth running once after the import — the legacy payloads are ~250
bytes each, so the archive should land in well under 1 MB, far below the ~50 MB §10.3 anticipates
for Gridley's richer payloads:

```sql
SELECT count(*) AS boards,
       pg_size_pretty(pg_total_relation_size('external_grids')) AS grids_size,
       pg_size_pretty(pg_total_relation_size('external_grid_axes')) AS axes_size
  FROM external_grids;
```

### 20.8 Operator gate — EXECUTED AND PASSED, 31 August 2026

Run by the operator on Windows against `afldb_dev`. Results as reported, not as predicted.

#### Build and static gates

| Gate | Result |
|---|---|
| `npm ci` | **PASS** — 419 packages added, 420 audited, **0 vulnerabilities** |
| `npx vitest run tests/external-grids-import.test.ts` | **PASS** — 1 file, **47/47 tests passed** |
| `npm run typecheck` | **PASS** — route types generated, no TypeScript errors |
| `npx eslint tests/external-grids-import.test.ts` | **PASS** — zero output |
| `npm run lint` (repository-wide) | **FAIL — pre-existing, unrelated debt.** 270 problems (188 errors, 82 warnings) across existing application, test, scratch and tooling files |

**The repository-wide lint failure is not owned by ISSUE-118 and was deliberately not fixed.**
Every file this issue added or touched is clean: the scoped ESLint run over
`tests/external-grids-import.test.ts` produced no output at all. Recording an unrelated lint
baseline rather than absorbing it follows the precedent set by ISSUE-099's runbook. Touching 188
unrelated errors inside a data-acquisition issue would put unreviewable churn in this branch's
diff and hide the Stage 1 change; the debt needs its own scope and its own decision.

#### Migration

Two first attempts failed closed with **nothing applied**, each for a missing prerequisite now
recorded in §20.7: `AFLDB_OWNER_DATABASE_URL` unset in this worktree (stopped before connecting),
then `ECONNREFUSED 127.0.0.1:5432` because the PostgreSQL SSH tunnel was down. Neither reached
the database.

After loading the repository-standard DSN from `D:\dev\afldb\.env` and restoring the tunnel:

```
npm run db:migrate          PASS, exit 0
target: dev (afldb_owner@127.0.0.1:5432/afldb_dev)
80 migration files, 79 previously applied
applied:
  079_nl_search_log_head_to_head_grain.sql — ok, 221 ms
  080_external_grids.sql                   — ok, 254 ms
Applied 2 migrations.
```

`080_external_grids.sql` applied cleanly on the first attempt. Its checksum is now frozen in
`afldb_meta.schema_migrations`, so **the file must not be edited**; any correction is a new
forward-only migration.

Two notes on that output, neither a defect in this work:

* **079 is not part of ISSUE-118.** It is the NL search-log head-to-head grain migration carried
  in from `main`, and `afldb_dev` simply had not had it applied yet. It rode along in the same
  run.
* The header line as transcribed ("80 files, 79 previously applied") is arithmetically
  inconsistent with "Applied 2 migrations" — 78 would fit. This looks like a transcription slip
  in the reported output rather than a runner defect, and it is **unverified**; it is noted here
  only so a later reader does not treat the figure as evidence.

#### Privileges

The first attempt stopped **before executing anything** because `psql` was not on `PATH`, and
said so explicitly: *"Nothing has been executed."* That is the reconciler failing closed, which
matters — a partial privilege reconcile is far worse than none. After adding
`C:\Program Files\PostgreSQL\16\bin` to `PATH`:

```
npm run db:privileges       PASS, exit 0
afldb_app    : 46 public relations readable, 20 revoked
afldb_import : 40 registered tables writable, 26 relations revoked
afldb_auth   : grants applied on 34 of 34 tables, 32 other relations revoked
afldb_backup : pg_read_all_data needs a superuser; unchanged
```

The corpus grants survived the reconcile, which is the specific thing §20.4 was designed for:
`external_grids` and `external_grid_axes` are **not** in `import_writable_tables` (so they are
among the "relations revoked" by the registry loop) and are re-granted their narrow append-only
set immediately afterwards by the block added to `privileges.sql`. Had that block been omitted,
this reconcile would have silently stripped the importer's access and the import below would have
failed closed.

#### Import

Source-side validation, DB-free, on the system interpreter:

```
python tools/migration/import_external_grids.py --dry-run --no-db --sqlite "D:/dev/sports_data_lab/data/afl/afl.db"
PASS, exit 0
1123 boards validated, 0 rejected, #1-#1123, 2023-07-17 through 2026-08-12,
6738 axis occurrences, 788 distinct raw labels,
0 number gaps, 0 duplicate numbers, 0 duplicate dates
"OK: 1123 board(s) validated. No database was contacted."
```

The plain `--dry-run` form documented in the earlier draft of §20.7 validated the source and then
failed on `ModuleNotFoundError: psycopg`, because it classifies against PostgreSQL and therefore
imports `common.py`. That is correct behaviour — it wrote nothing — but the wording was wrong and
is corrected in §20.5 and §20.7. The real imports used the established AFLDB venv at
`D:\dev\afldb\.venv` (psycopg 3.3.4).

**First real import:**

```
inserted   : 1123
unchanged  : 0
conflicts  : 0
rejected   : 0
exit 0 — "OK: 1123 board(s) inserted, 0 already captured."
```

**Immediate idempotency rerun:**

```
inserted   : 0
unchanged  : 1123
conflicts  : 0
rejected   : 0
exit 0 — "OK: 0 board(s) inserted, 1123 already captured."
```

The rerun is the strongest single piece of Stage 1 evidence. Every board was recognised by
`payload_sha256` as already captured, so the importer took the `unchanged` branch 1,123 times out
of 1,123 and issued no write: the hash recipe is reproducible across processes, the classifier is
correct, and a rerun cannot damage captured evidence. Zero conflicts also confirms that no board
number and no board date collided under the provenance-scoped unique indexes of §20.2.

#### What this establishes

* Migration 080 is **applied to `afldb_dev`** and its checksum is frozen.
* Grants are reconciled and the corpus's append-only model survives `npm run db:privileges`.
* All **1,123** rescued boards and their **6,738** axes are persisted with provenance
  `legacy_sqlite`, revision 1, `fetched_at` NULL.
* The import is **idempotent and restartable**, proved by execution rather than by argument.

Not established, and still open by design: nothing has been imported from Gridley itself
(Stage 2), no criterion is mapped (Stage 3), and no cell has been executed against the Grid
Solver (Stages 6–7). Storage (R8) was not measured; the query is in §20.7 and is cheap to run at
any time.

### 20.9 What Stage 1 did NOT do

No criterion was mapped, normalised or classified. `played_for_club` was not touched, weakened
or referenced. No predicate was added. No Grid Solver file was opened for edit. No Stage 3
operator SQL (V1–V3) was executed — those gate Stage 3, not Stage 1. No live Gridley request was
made. Nothing was committed, merged, rebased or pushed.

### 20.10 Exact next action

**Stage 1 is finished and the operator gate has passed (§20.8). Nothing in Stage 1 is
outstanding.** The work is uncommitted: the eight changed files listed in §20.1 sit in the
`opus/gridley-corpus` worktree, and committing them is the operator's call (`CLAUDE.md` §12).

**Next: Stage 2, in a fresh session** (§18) — the Gridley JSON client and the full historical
backfill. Provenance `gridley_api`, preserving the criterion `id`, the title/subtitle split,
`description` and `type` that the rescued archive lost; the rolling-window acquisition and the
revision/conflict policy of §13; rate-limited at ≥1 s.

The persistence path Stage 2 needs now exists **and is applied**, and it is provenance-scoped
(§20.2), so the backfill lands **alongside** the 1,123 rescued boards rather than displacing
them — and the two become the cross-check §10.1 asks for. Storage (R8) should be measured after
the backfill, when the payloads are Gridley's own at ~40 KB each rather than the archive's ~250
bytes.

A fresh session is recommended: Stage 2 is acquisition and parsing work, not semantic judgement.
Stage 3 remains gated on operator queries V1–V3 (§15.2), which are still unrun.

---

## 21. Stage 2 — Gridley acquisition and backfill: COMPLETE

**Status at 1 September 2026: Stage 2 is complete.** The code is implemented and the whole
operator gate — §21.10 steps 1–11 — has been executed and passed. The full 1,143-board Gridley
history is captured on disk and independently audited (§21.13), and all 1,143 boards are now
imported into `afldb_dev` under provenance `gridley_api`, with the immediate re-run proving
idempotency and the archive-vs-Gridley six-label cross-check returning zero divergence
(§21.16). Nothing is committed: the milestone is ready for an operator commit.

`AFLDB-ISSUE-118` itself remains **open** — Stage 3 onward are still to do.

| Field | Value |
|---|---|
| Branch / worktree | `opus/gridley-corpus` / `D:\dev\afldb-gridley` |
| HEAD at session start | `28fdb2f` — Implement Gridley corpus Stage 1 |
| Working tree at start | clean |
| Model / effort | Opus 5, High |
| Commits made | **none** — Git is operator-operated (`CLAUDE.md` §12) |
| Live network requests, implementation sessions | **none** — every live request was made by the operator (§21.13, §21.16) |
| Database commands, implementation sessions | **none** — every database command was run by the operator (§21.16) |

### 21.1 Files changed

| File | Change |
|---|---|
| `tools/migration/acquire_gridley_boards.py` | **new** — the network half: Gridley JSON → an immutable on-disk snapshot. No PostgreSQL in any mode |
| `tools/migration/import_gridley_boards.py` | **new** — the database half: snapshot → `external_grids` / `external_grid_axes` with provenance `gridley_api` |
| `tests/gridley-acquisition.test.ts` | **new** — the Stage 2 contract suite, 45 tests, no network and no database |
| `tests/fixtures/gridley/board-0001-2023-07-17.json` | **new** — Gridley #1, the exact response bytes |
| `tests/fixtures/gridley/board-1139-2026-08-28.json` | **new** — a recent board, the exact response bytes |
| `.gitattributes` | `tests/fixtures/gridley/*.json  -text` — the fixtures are hash-pinned captures, so git must not rewrite a byte |
| `issues/open/AFLDB-ISSUE-118.md` | this section |
| `IssuesIndex.md`, `issues.md` | state and next action moved from Stage 2 to the Stage 2 operator gate |
| `CHANGELOG.md` | `Unreleased` entry for the acquisition path and the API importer |

Nothing else was touched. **Migration 080 was not edited** and no new migration was created:
Stage 2 needs no schema change (§21.6). `AFLDB-ISSUE-117`, the legacy SQLite archive,
`fetch_grids.py` and every Grid Solver file were left alone.

### 21.2 DECISION — acquisition and import are two tools, not one

§12B described "the Gridley backfill importer" as a single job. Implementation splits it: a
network tool that writes files, and a database tool that reads them. The reasons are the
requirements themselves.

* **Partial network failure must not corrupt persisted boards.** With one tool, a connection
  dropped at board 700 of ~1,150 leaves a half-loaded corpus whose completeness cannot be
  established afterwards. With two, a failed run can only ever leave *files* — a visible,
  resumable state that has touched no table.
* **Byte-level forensic preservation.** `jsonb` normalises key order and whitespace, so the
  database cannot hold the response bytes. The snapshot does, and the row records the body's
  SHA-256, so a stored board can be tied back to the exact bytes it was parsed from.
* **Re-parsing must never mean re-fetching** (§10.3). A parsing change replays the snapshot
  offline.
* **It is testable without the source.** Every acquisition behaviour below is proved by running
  the tool against a loopback server, so Gridley is never contacted by CI.

This is also the repository's existing shape for external acquisition:
`tools/rebuild/draftguru/acquire_draft.py` → snapshot → `import_draftguru.py`. Stage 2 follows
its HTTP policy numbers exactly rather than inventing a second manner of retrieval.

### 21.3 Snapshot format

```
data/sources/gridley/<label>/          (label defaults to `history`; git-ignored under /data/*)
  raw/<YYYY-MM-DD>__<sha16>.json       exact response bytes
  http/<YYYY-MM-DD>__<sha16>.json      url, status, fetched_at, byte size, body sha256, level
  rejected/<YYYY-MM-DD>__<stamp>.json  a response that did not validate, body included
  runs/<stamp>.json                    one record per run: policy, counts, per-date outcomes
```

**A capture is named by its own content.** That is what makes the store immutable rather than
merely intended to be, and it is the direct answer to §6.1's anti-pattern:

- re-fetching a date whose bytes are unchanged resolves to a filename that already exists, so
  the run does nothing;
- re-fetching a date whose bytes have **changed** writes a **new** file beside the first;
- every write uses `open(path, "xb")`, so overwriting is refused by the filesystem rather than
  by a check a later edit could remove. There is no `w`, no `unlink`, no `rmtree` anywhere in
  the file, and the suite asserts their absence.

### 21.4 Acquisition behaviour

| Requirement | How |
|---|---|
| Deterministic | dates processed ascending; captures ordered by (date, `fetched_at`, hash) |
| Resumable | a date whose capture is complete on disk is `skipped` without a request |
| Idempotent | identical bytes resolve to an existing filename; nothing is rewritten |
| Bounded | `--max-requests` (default **200**) caps a run and prints where to resume |
| Rate limited | `--delay` ≥ 1.5 s default, enforced between every request including retries |
| Retry policy | 3 retries at 2/4/8 s, on timeouts, connection errors, HTTP 5xx and 429 **only** |
| 404 | `unavailable`, never retried; `--require-complete` makes it a failure |
| Redirects | same host only; a cross-host redirect is refused |
| robots.txt | fetched once, recorded in the snapshot, honoured. **There is no override flag** |
| Failure | named as one of nine outcomes; the four failure outcomes exit non-zero |
| Malformed | written to `rejected/` with the body and the reason; **never** into `raw/` |
| Dry run | `--dry-run` makes no request at all, not even robots.txt |

Selection is `--days N` (the §13 rolling window), `--from/--to`, `--date` (repeatable) or
`--all`. A date before 2023-07-17 is refused: there is no board.

### 21.5 FINDING — the response cannot be trusted to be the board that was requested

The endpoint is keyed by date and **the payload carries no date of its own** — only `level`.
Nothing in a response says which URL produced it. An endpoint that answered every date with the
current board would therefore fill the snapshot with ~1,150 copies of one board, and no field in
the data would say so.

The one available check is the publisher relationship `level = (board_date − 2023-07-16).days`,
which holds across all 1,123 rescued boards and was re-verified this session against all 21
Stage 0 probe payloads. Acquisition and import each enforce it independently and reject a
mismatch by default; `--allow-level-drift` accepts it, records both the received and the expected
level, and exists for the day the publisher legitimately changes the relationship. The schema
still does not encode the relationship (migration 080 was right not to) — it is a validation of
the request/response pairing, not a rule about boards.

### 21.6 FINDING — Stage 2 needs no schema or privilege change

Checked rather than assumed:

* `external_grids` and `external_grid_axes` already carry every field Stage 2 populates.
  `criterion_key`, `raw_title`, `raw_subtitle`, `raw_description` and `item_type` are exactly the
  columns migration 080 left nullable for archive rows.
* The revision chain is already provenance-scoped (§20.2), so `gridley_api` captures land
  **beside** the 1,123 `legacy_sqlite` rows rather than displacing them. The importer never
  reads, updates or supersedes a `legacy_sqlite` row, and every statement is scoped to
  `provenance = %s`.
* `afldb_import` already holds `SELECT, INSERT` on both tables plus `UPDATE (is_current)` — which
  is precisely and only what a revision needs: demote the previous row, insert the new one.
* `data_issues` is in `afldb_meta.import_writable_tables` (seeded by migration 045, never
  revoked since), so recording a revision as a data issue needs no new grant.

**Nothing in the Stage 1 privilege model was weakened, and migration 080 was not edited.**

### 21.7 Persistence decisions

* **The stored payload is an envelope, and it is content only:**
  `{"source": "gridley_api", "url", "board_date", "body_sha256", "payload": <the response>}`.
  `fetched_at` is deliberately **outside** it, in its own column. Inside the hashed envelope it
  would make every re-fetch of an unchanged board look like new content, and the change oracle
  would be worthless. Nothing host-specific is in it, so the hash is reproducible anywhere.
* **One hash recipe.** `canonical_json` and `payload_hash` are imported from
  `import_external_grids` rather than restated, so both provenances are hashed identically. The
  suite recomputes a capture's hash **in TypeScript** from the returned envelope and asserts it
  matches — a stored hash only its own writer can reproduce is not a checkable hash.
* **`fetched_at` is truthful or the capture is refused.** It comes from the snapshot's request
  record. A capture with no record, or a record with no `fetched_at`, is a **rejection** — the
  same discipline §20.3 applied to the archive's absent capture time, from the other direction.
* **The snapshot is re-validated, never trusted.** The importer re-parses the raw bytes,
  recomputes the body hash, checks it against both the filename and the request record, and
  refuses a mismatch. A snapshot edited after capture cannot import.
* **`raw_title`/`raw_subtitle`/`raw_description`/`item_type` are the source strings verbatim** —
  unstripped, un-normalised, `null` preserved as NULL. A non-string where a string is expected is
  a rejection, not a `str()` coercion: coercing would store a plausible-looking description as
  though Gridley had said it.
* **`raw_label` reproduces the lossy legacy rule exactly**, including its `or`-fallback to `id`
  and its `strip()`. It is the *only* field the two provenances share, so a "better" label would
  silently break the cross-check they exist for. **Verified this session**: the reproduction is
  byte-identical to the rescued archive on both boards the Stage 0 probe overlaps (#1 and #1123),
  rows = `vItems` and cols = `hItems`, and the CI suite pins board #1's six labels.
* **The answer key is preserved in `raw_payload`, and no answer table is created.**
  `correctAnswersPlayerMap`, `correctGuesses`, `scoreMap`, `emoji`, `theme`, `imgUrl` and
  `showOnLaunch` are all kept verbatim inside the envelope. `external_grid_answers` is Stage 6 and
  `tests/external-grids-import.test.ts` asserts its absence; extracting the oracle into columns
  before the Gridley-player-id bridge exists (risk R4) would be Stage 6 work smuggled into
  Stage 2. The importer counts and reports answer cells and player references so the oracle's
  presence is visible without being modelled.
* **Two-phase and fail closed**, as Stage 1 is over the archive: the whole snapshot is parsed and
  validated before the first INSERT, and one rejection means nothing at all is written.
  Acquisition already refuses to put an invalid response into `raw/`, so a rejection at import
  time means the snapshot changed after capture — a reason to stop, not to import the rest.
* **A revision demotes before it inserts**, inside one transaction. The partial unique index
  admits one current revision per board per provenance, so the order is a correctness
  requirement. `is_current` is the only column the file ever updates.

### 21.8 FINDING — comparing only against the current revision breaks the re-run

Found by running it, not by reading it. A snapshot **accumulates** captures: once a board has
been revised, the snapshot permanently holds the superseded capture as well as the current one.
The first implementation classified `unchanged` against the current revision only, so on the
next run the superseded capture looked like new content and became yet another revision — a
completed backfill would have grown one revision per board per re-run, forever. That is exactly
the "rerunning a completed backfill must not create duplicate current revisions" requirement,
failing.

**Resolution.** `unchanged` is decided against the **whole** revision chain for that board, and
`load_current_state` returns every hash a board has ever been captured under. Proven by test:
first import of a two-capture board gives 1 inserted + 1 revised; re-running the same snapshot
gives 0 inserted / 0 revised / 2 unchanged and no conflict.

That leaves one case the per-capture rule cannot see: upstream serving content it served before,
after serving something else in between. A per-board pass catches it — if the **newest** capture
is not the revision that ends up current, the board is refused and reported as a revert rather
than silently renumbered. Whether a revert should become a further revision is a decision about
historical evidence, not one an importer should settle.

### 21.9 Validation executed

Everything below was run in this session. **No live Gridley request, no SQL, no psql, no
migration, no Git and no deployment command was executed**, and no database was contacted.

**V-S2.1 — Stage 2 suite.** `npx vitest run tests/gridley-acquisition.test.ts` — **45 passed**.

**V-S2.2 — Stage 1 suite unchanged.**
`npx vitest run tests/external-grids-import.test.ts tests/gridley-acquisition.test.ts` —
**92 passed (2 files)**, 40 s. Stage 1's 47 assertions are untouched and still hold.

**V-S2.3 — typecheck.** `npm run typecheck` — clean (one real error found and fixed: the stub
server's reply union did not discriminate on `status`).

**V-S2.4 — scoped lint.** `npx eslint tests/gridley-acquisition.test.ts` — clean. Repo-wide
`npm run lint` has pre-existing unrelated debt and is not ISSUE-118 scope (§20.6).

**V-S2.5 — label reproduction against the rescued archive.** The legacy `gridley_label()` rule
was re-derived from `fetch_grids.py` and applied to the Stage 0 probe payloads, then compared
with `historic_grids` for the two overlapping dates. The SQLite file was opened
`file:...?mode=ro` with `PRAGMA query_only=ON` and **was not modified**.

```
2023-07-17  archive #1     payload level 1     rows match: True   cols match: True
2026-08-12  archive #1123  payload level 1123  rows match: True   cols match: True
```

**V-S2.6 — board-number anchor.** `level = (board_date − 2023-07-16).days` holds for all 21
Stage 0 probe payloads without exception.

**V-S2.7 — the acquisition path, end to end, offline.** Driven against a loopback server serving
the committed fixtures. Proved by execution: exact-byte capture; a request record whose
`body_sha256`, `level`, `expected_level` and `byte_size` match the bytes; resume without a
request; `--refresh` on unchanged content as a no-op; `--refresh` on changed content keeping
**both** captures with the original byte-identical; 404 → `unavailable` with one request and no
retry; `--require-complete` making it a failure; 403 → `http_error` with no retry; 503, 503, 200
→ retried and saved after 3 requests; malformed JSON → `rejected/` with the body and nothing in
`raw/`; a valid board served under the wrong date → refused, and accepted only under
`--allow-level-drift`; a 2-item axis and a blank criterion id → refused; robots `Disallow`
stopping the run after exactly one request; pacing enforced; `--max-requests 1` stopping after
one board and naming the next date; `--dry-run` making **zero** requests.

**V-S2.8 — the import path, offline.** `--dry-run --no-db` over a two-board snapshot:

```
capture files read   : 2      captures parsed      : 2      captures rejected : 0
board number range   : #1 - #1139
axis occurrences     : 12     distinct criterion ids: 11    axes with description : 12
axes with subtitle   : 4      axes with item type   : 1
captures with answer key: 2 of 2    answer-key cells: 18    answer-key player refs: 810
```

Field-level preservation is asserted against the fixture itself: criterion ids in source order,
`raw_title`/`raw_subtitle`/`raw_description`/`item_type` identical to the payload's strings,
`null` preserved as NULL, `type: "player"` carried through, row = `vItems` and col = `hItems` at
positions 0–2, the envelope's `payload` deep-equal to the original response, and the envelope
carrying no `fetched_at`.

**V-S2.9 — tamper and omission.** A raw file edited after capture → `capture_name_mismatch` /
`http_record_mismatch`, exit 1, nothing written. A deleted request record → `http_record_missing`.
A record with `fetched_at` removed → `fetched_at_missing`. An absent snapshot → exit 1.
`--no-db` without `--dry-run` and `--limit` without `--dry-run` → exit 2.

**V-S2.10 — revision, idempotency and revert.** See §21.8. Also proved: a changed capture chains
inside a single run (`inserted` rev 1 then `revised` rev 2, the second superseding a row the run
has not written yet, resolved at write time).

**V-S2.11 — a killed run recovers.** A raw file whose request record is missing is no longer
counted as held: the next run re-requests the date, completes the record with a truthful
timestamp, reports `INCOMPLETE: 1 capture(s)`, and the snapshot imports cleanly again. Found
while reviewing the write ordering, then covered by test.

### 21.10 The operator gate — commands as they must actually be run

**Every step has been executed and passed — steps 1–6 in §21.13, steps 6b–11 in §21.16.** The
block is kept as the record of what was run, and as the recipe for a later re-acquisition.

Steps 1, 2 and 3 are entirely offline: step 3 is `--dry-run`, which the tool proves makes no
request at all, not even for `robots.txt`. **Step 4 is the first live contact with Gridley.**
Steps 4, 6 and 6b make live requests to an external service; steps 7 onward write to or read
`afldb_dev`. Both are operator-reserved (`CLAUDE.md` §9, §11).

**Database environment variables.** This environment has **no `AFLDB_DATABASE_URL`** — an earlier
version of steps 10 and 11 named it, psql therefore received an empty DSN, fell back to its
local default connection and failed authentication as the Windows user (corrected, §21.15 item 4).
The DSN variables present in the operator's session, loaded from `D:\dev\afldb\.env`, were
`AFLDB_OWNER_DATABASE_URL`, `AFLDB_IMPORT_DATABASE_URL`, `AFLDB_AUTH_DATABASE_URL`,
`AFLDB_BACKUP_DATABASE_URL` and `AFLDB_TEST_DATABASE_URL`. `.env.example` documents the same
names (plus `AFLDB_TEST_IMPORT_DATABASE_URL` and a commented `AFLDB_PROD_DATABASE_URL`) and
**contains no `AFLDB_DATABASE_URL` anywhere** — checked in this worktree, so the correction is
established from repository evidence and not only from the failed attempt. The read-only steps 10 and 11 were run under `AFLDB_OWNER_DATABASE_URL`. Steps 7–9 name no DSN
at all: `import_gridley_boards.py` connects through `tools/migration/common.py`, which requires
**`AFLDB_IMPORT_DATABASE_URL`** — the least-privileged role that can do the job, which is the
point of the split.
**Never print a DSN or echo one into this file**; name the variable, never its value. In
PowerShell the variables are `$env:AFLDB_OWNER_DATABASE_URL`, and psql needs the DSN and `-c`
passed as separate arguments — see the §21.16 step 10 note on the shell-quoting trap.

```bash
# 1. DONE 2026-08-31. Node dependencies for this worktree (once).
#    419 packages added, 420 audited, 0 vulnerabilities.
npm ci

# 1b. Python interpreter. Do NOT create a .venv in this worktree: the
#     established AFLDB environment already has what the DB steps need, and a
#     second one is another thing to keep in step for no benefit. Only the
#     DB-touching steps (7, 8, 9) need it at all; every step before them runs
#     on any Python 3.11+.
#         D:\dev\afldb\.venv   (psycopg 3.3.4, confirmed 2026-08-31)
#     Referred to below as $AFLDB_PY:
#         $AFLDB_PY = D:\dev\afldb\.venv\Scripts\python.exe

# 2. DONE 2026-08-31. 91 passed + 1 skipped, typecheck clean (§21.13).
#    No network, no database.
npx vitest run tests/gridley-acquisition.test.ts tests/external-grids-import.test.ts
npm run typecheck

# 3. DONE 2026-08-31. Offline: 1,143 dates planned, nothing written.
python tools/migration/acquire_gridley_boards.py --all --dry-run

# 4. DONE 2026-08-31. FIRST LIVE CONTACT. A small window, to confirm the
#    endpoint and the policy before any historical crawl. Writes files only;
#    no database is touched. Result: 3 saved, 0 failures, 4 requests.
python tools/migration/acquire_gridley_boards.py --days 3

# 5. DONE 2026-08-31. 3 captures parsed, 0 rejected, no database contacted.
python tools/migration/import_gridley_boards.py --dry-run --no-db

# 6. DONE 2026-08-31, in six bounded runs (200/200/200/200/200/140).
#    All 1,143 dates are captured; 0 failures of any kind. Re-running is
#    always safe and is now a no-op.
python tools/migration/acquire_gridley_boards.py --all

# 6b. DONE 2026-09-01. Completeness verification: "0 to request", all 1,143
#     dates skipped, 1 request (robots.txt only), exit 0. Read what that does
#     and does not prove: every date is already captured, so each is skipped
#     BEFORE any board request and only robots.txt is fetched. It therefore
#     asserts that the SNAPSHOT is whole — a capture exists for every planned
#     date — and not that Gridley still serves them. --require-complete matters
#     here as the standing rule for later runs, where a clean 404 becomes a
#     failure instead of a quiet gap. Cheap re-assertion, not a second crawl.
#     A non-zero exit at this point would mean a capture has gone missing
#     from disk since step 6, which is worth stopping for.
python tools/migration/acquire_gridley_boards.py --all --require-complete

# 7. DONE 2026-09-01. Classify the whole snapshot against the real database.
#    Still no write. Needs $AFLDB_PY (step 1b): the DB path imports psycopg.
#    Result: 1,143 would be inserted / 0 revised / 0 unchanged / 0 conflicts.
D:\dev\afldb\.venv\Scripts\python.exe tools/migration/import_gridley_boards.py --dry-run

# 8. DONE 2026-09-01. The import itself. Result: 1,143 inserted / 0 revised /
#    0 unchanged / 0 conflicts / 0 rejected.
D:\dev\afldb\.venv\Scripts\python.exe tools/migration/import_gridley_boards.py

# 9. DONE 2026-09-01. Rerun it. Idempotency: 0 inserted, 0 revised,
#    1,143 unchanged, 0 conflicts.
D:\dev\afldb\.venv\Scripts\python.exe tools/migration/import_gridley_boards.py

# 10. DONE 2026-09-01. R8 in the database, now that the payloads are Gridley's
#     own and not the archive's. Read-only. Result: gridley_api 1,143 revisions
#     / 9,813 kB, legacy_sqlite 1,123 revisions / 373 kB. That is a PostgreSQL
#     pg_column_size(raw_payload) aggregate and is NOT the same measurement as
#     the 42.9 MB raw on-disk snapshot (§21.13) — different representations.
#     NOTE: use a DSN variable that exists. There is no AFLDB_DATABASE_URL.
#     PowerShell: $env:AFLDB_OWNER_DATABASE_URL, passed as its own argument.
psql "$AFLDB_OWNER_DATABASE_URL" -c "SELECT provenance, count(*) AS revisions,
  pg_size_pretty(sum(pg_column_size(raw_payload))) AS payload_bytes
  FROM external_grids GROUP BY provenance ORDER BY provenance;"

# 11. DONE 2026-09-01. The cross-check the two provenances exist for: where do
#     the archive and Gridley disagree about a board's six labels? Read-only.
#     Result: ZERO rows, over the 1,123 boards both provenances hold —
#     1,123 x 6 = 6,738 overlapping board-axis positions agree exactly.
psql "$AFLDB_OWNER_DATABASE_URL" -c "
  SELECT g.board_number, a.orientation, a.position, a.raw_label AS gridley,
         b.raw_label AS archive
    FROM external_grids g
    JOIN external_grid_axes a ON a.grid_id = g.id
    JOIN external_grids h ON h.source_id = g.source_id
     AND h.board_number = g.board_number
     AND h.provenance = 'legacy_sqlite' AND h.is_current
    JOIN external_grid_axes b ON b.grid_id = h.id
     AND b.orientation = a.orientation AND b.position = a.position
   WHERE g.provenance = 'gridley_api' AND g.is_current
     AND a.raw_label IS DISTINCT FROM b.raw_label
   ORDER BY g.board_number, a.orientation, a.position LIMIT 50;"
```

**Step 11 is the point of Stage 2.** §10.1 wanted the rescued archive as an independent
cross-check on a re-acquired history; after step 8 that check is an ordinary query, and any row
it returns is a finding about one of the two captures. **It returned no rows** (§21.16): the
rescued archive and the re-acquired history agree on every label they both hold.

### 21.11 What Stage 2 has NOT done

Stage 2's own database work **is** done: `external_grids` now holds the 1,123 `legacy_sqlite`
rows beside 1,143 `gridley_api` rows, R8 is measured in the database, and the archive-vs-Gridley
cross-check §10.1 wants the two provenances for has been run over all 1,123 shared boards
(§21.16). What follows is what Stage 2 deliberately left for later stages.

No criterion was mapped, normalised or classified; `external_grid_criterion_map` and
`external_grid_answers` still do not exist. The Gridley-player-id bridge (R4) was not built.
`played_for_club` was not touched or referenced, no predicate was added, no Grid Solver file was
opened for edit, and no AFLDB answer was compared against `correctAnswersPlayerMap`. Operator
queries V1–V3 remain unrun; they gate Stage 3. Nothing was committed, merged, rebased or pushed.

### 21.12 Exact next action

**The Stage 2 operator gate is finished (§21.13, §21.16). The exact next action is the operator
commit of this milestone, then Stage 3 in a fresh session**, beginning from this runbook and
re-assessing reasoning effort before the deterministic mapping work starts.

Stage 3 is deterministic mappings for the 202 `EXACT_EXISTING` criteria only, into
`external_grid_criterion_map`, still gated on operator queries V1–V3 (§15.2). Stage 3 involves
semantic judgement, so re-assess model and effort at that point (§19) rather than inheriting this
session's settings.

Both of the questions this checkpoint opened for the gate are now answered:

1. **Is the history complete?** Yes. `--require-complete` passed over all 1,143 dates with no
   board request made (§21.16 step 6b).
2. **What does the six-label cross-check return?** Zero rows, over all 6,738 overlapping
   board-axis positions (§21.16 step 11). The rescued archive and the re-acquired history give
   the corpus one consistent reading, so Stage 3 maps criteria without a provenance conflict to
   resolve first.

One question remains open and is deliberately **not** resolved here:

3. **Should the change oracle hash the whole payload, or only the board?** See §21.14. It is an
   evidenced design question, it did not block the import, and it must be settled — with
   `--refresh` evidence in hand — before any recurring acquisition is scheduled. Changing the
   recipe re-hashes the whole corpus, so it is not a side-effect edit.

**Issue-number collision, for reconciliation elsewhere.** A separate worktree,
`D:\dev\afldb-issue-118` on branch `codex/issue-118`, independently allocated
`AFLDB-ISSUE-118` for unrelated NL-search telemetry work. That worktree was not inspected,
edited or reconciled here, and neither issue was renumbered: resolving the duplicate allocation
is its own task, to be done after this Stage 2 milestone is committed.

### 21.13 Operator gate — acquisition EXECUTED AND PASSED, 31 August 2026

Run by the operator in `D:\dev\afldb-gridley`. Recorded here verbatim, then independently
audited from the snapshot on disk (V-OP.7 below). **Steps 7–11 were not run and no database was
contacted.**

#### Step 1 — dependencies

`npm ci` — **PASS**: 419 packages added, 420 audited, 0 vulnerabilities, an `eslint@9.39.5`
deprecation warning only.

**No worktree `.venv` was created, deliberately.** The established AFLDB environment at
`D:\dev\afldb\.venv` already carries psycopg 3.3.4 and remains the intended interpreter for the
DB-touching steps. §21.10 step 1 has been corrected to say so; its earlier `python -m venv .venv`
line was wrong and would have created a second environment to keep in step for no benefit.

#### Step 2 — focused tests and typecheck

```
npx vitest run tests/gridley-acquisition.test.ts tests/external-grids-import.test.ts
```

**PASS — 2/2 files. 91 passed + 1 SKIPPED = 92 total**, 40.41 s. Stage 2: 45/45 passed.
Stage 1: 47 total, 46 passed + 1 skipped.

**The skip is real and is recorded as a skip, not as a pass.** The Stage 1 suite's optional
legacy-archive validation looks for `/home/arm/projects/sports_data_lab/data/afl/afl.db`; the
Windows archive is at `D:\dev\sports_data_lab\data\afl\afl.db`, so the case did not run. Not a
blocker: that archive was independently validated during Stage 1 (§20.6, §20.8) and this session
re-read it read-only for V-S2.5. **Do not restate this run as 92/92 passed.** A hard-coded POSIX
path in a suite that otherwise runs on both platforms is worth fixing on its own, but it is
Stage 1 hygiene and not Stage 2 scope.

`npm run typecheck` — **PASS**: `next typegen` generated route types, `tsc --noEmit` reported no
errors.

#### Step 3 — offline plan

`acquire_gridley_boards.py --all --dry-run` — **PASS**, and explicitly reported that no request
was made and nothing was written.

| Field | Value |
|---|---|
| Source | `https://gridleygame.com/data/grids/YYYY-MM-DD.json` |
| Snapshot | `D:\dev\afldb-gridley\data\sources\gridley\history` |
| Range | 2023-07-17 → 2026-09-01, **1,143 dates** |
| State | 0 captured, 1,143 to request |
| Policy | ≥1.5 s pacing, 3 retries at 2/4/8 s, 20 s timeout, default bound 200 |
| First / last of batch 1 | 2023-07-17 / 2024-02-01 |

#### Step 4 — FIRST LIVE CONTACT

`acquire_gridley_boards.py --days 3` over 2026-08-30 → 2026-09-01 — **PASS**.

**3 saved.** revised 0, unchanged 0, skipped 0, unavailable 0, http_error 0, network_error 0,
malformed_json 0, shape_invalid 0. Dates considered 3; **requests made 4**.

The operator flagged the 4th request as consistent-but-unproven. **It is now proven from
repository evidence**: `check_robots()` is called once per run before any board is requested, and
across all seven runs the totals are 1,143 board requests + 7 robots requests = 1,150 (V-OP.7).
The one robots response is stored once, content-addressed, at
`http/robots__90d24bc3bf698ac1.{txt,json}`.

#### Step 5 — DB-free validation of the first captures

`import_gridley_boards.py --dry-run --no-db` — **PASS**, PostgreSQL explicitly skipped.

```
capture files read 3   captures parsed 3   captures rejected 0
board numbers #1141-#1143   dates 2026-08-30 - 2026-09-01
distinct boards 3   distinct dates 3   dates with >1 capture 0   number gaps 0
axis occurrences 18   distinct criterion ids 18   axes with description 18
axes with subtitle 13   axes with item type 3
captures with answer key 3/3   answer-key cells 27   answer-key player refs 3,469
```

#### Step 6 — bounded historical acquisition

Six runs at the default 200-request bound. Every run: 0 revised, 0 unchanged, 0 unavailable, and
0 across all four failure categories.

| Run | Captured at start | To request | Saved | Skipped | Requests | Remaining | Next date |
|---|---:|---:|---:|---:|---:|---:|---|
| 1 | 3 | 1,140 | 200 | 3 | 201 | 940 | 2024-02-02 |
| 2 | 203 | 940 | 200 | 203 | 201 | 740 | 2024-08-20 |
| 3 | 403 | 740 | 200 | 403 | 201 | 540 | 2025-03-08 |
| 4 | 603 | 540 | 200 | 603 | 201 | 340 | 2025-09-24 |
| 5 | 803 | 340 | 200 | 803 | 201 | 140 | 2026-04-12 |
| 6 | 1,003 | 140 | 140 | 1,003 | 141 | 0 | — |

The `skipped` column is the resumability contract working: each run re-listed every date and
requested only the ones it did not already hold.

#### V-OP.7 — independent audit of the snapshot (this session, read-only)

Not taken on trust. Every capture on disk was re-read and re-hashed; no file was written, no
request was made, no database was contacted.

| Check | Result |
|---|---|
| Raw captures | **1,143** |
| Date range | **2023-07-17 → 2026-09-01** |
| Calendar span | **1,143 days — one board per day, no missing date** |
| Board number range | **#1 – #1143**, 0 gaps, 0 duplicates |
| Dates with >1 capture | **0** — no board was revised during first acquisition |
| Bytes re-hashed against filename | **1,143 / 1,143 match**, 0 mismatches |
| Request records | **1,143 present, 0 orphans**, every one carries `fetched_at` and a `body_sha256` equal to the bytes |
| Level drift (`level` vs the date's implied number) | **0** |
| Rejected responses | **0** |
| Run records | **7**, all `status: completed` |
| Total HTTP requests | **1,150** = 1,143 boards + 7 robots |
| Declared user agent | `AFLDB-corpus/1.0 (AFLDB Grid Solver compatibility corpus; contact: …)` |
| Pacing recorded in every run | 1.5 s |
| Raw payload on disk | **42.9 MB**, mean **38.4 KB** per board |

`robots.txt` as served and stored (sha256 `90d24bc3…`):

```
# https://www.robotstxt.org/robotstxt.html
User-agent: *
Disallow:
```

An empty `Disallow` allows everything, so the crawl was permitted rather than merely
unobjected-to. The response is retained in the snapshot as the record of that.

**Cross-session fidelity.** Board #1 (`2023-07-17`) as acquired live is **byte-identical** to the
Stage 0 probe capture committed at `tests/fixtures/gridley/board-0001-2023-07-17.json`, taken on
a different day by a different tool. R8's premise holds and board #1 is stable at three years
old.

### 21.14 FINDING — the payload mixes the board with live play counters

Found by comparing the live capture of board #1139 (`2026-08-28`) against the Stage 0 probe of
the same board taken three days earlier. **Both are 200s, both are the same board, and their
bytes differ.**

| Field | Stage 0 probe | Live capture | |
|---|---|---|---|
| `hItems`, `vItems` | — | — | **identical** |
| `level`, `social` | — | — | **identical** |
| `started` | 3,422 | 3,431 | changed |
| `completed` | 2,437 | 2,444 | changed |
| `correctGuesses` | — | — | changed, all 9 cells |
| `scoreMap` | — | — | changed |
| `correctAnswersPlayerMap` | — | — | changed — **counts only** |

The answer key deserves its own line: **the qualifying player SET is identical in all nine
cells** — 0 players added, 0 removed — and only the per-player guess counts moved. Board #1, three
years old and no longer being played, was byte-identical over the same interval.

So the payload is two things at once: an **immutable board definition plus answer key**, and a
**live popularity counter** that ticks for as long as people keep playing.

**Consequences, recorded rather than acted on:**

* Nothing in this checkpoint is wrong because of it. First acquisition fetched each date once, so
  0 revisions were created, and preserving the counters is correct — they are real captured
  evidence of what the source served at that moment (§10.3).
* But `payload_sha256` is computed over the whole envelope, so **any `--refresh` of a board people
  are still playing will legitimately produce a new revision**, and `data_issues` will record a
  divergence, for a board whose criteria and answer key have not changed at all. The §13 rolling
  window will do this routinely for recent dates.
* For Stage 6 the important half is stable: the oracle is the player set, and the player set did
  not move.

**Open question for a later stage — not this one.** Should the revision oracle hash the whole
payload, or a board-identity projection (`hItems`, `vItems`, `level`, and the answer key's player
sets) with the counters preserved in `raw_payload` but outside the hash? The second would make a
revision mean "the board or its answer key changed", which is what a compatibility corpus
actually cares about. **Do not change it as a side effect of resuming the import**: the current
behaviour is defensible, it is what the 1,143 captures on disk were hashed under, and changing
the recipe would re-hash the whole corpus. Decide it explicitly, with `--refresh` evidence in
hand, before scheduling any recurring acquisition.

### 21.15 Documentation corrections made at this checkpoint

1. **§21.10 said "Steps 3 onward make live requests"** — wrong. Step 3 is `--dry-run` and makes no
   request at all, which the suite proves. Corrected: steps 1–3 are offline, **step 4 is the first
   live contact**.
2. **§21.10 step 1 told the operator to create a worktree `.venv`** — corrected to use the
   established `D:\dev\afldb\.venv` (psycopg 3.3.4), and steps 7–9 now name that interpreter.
   Only steps 7–9 need it.
3. **The reported mojibake is NOT in the file.** Checked rather than assumed, and deliberately
   described here by codepoint rather than quoted, so this paragraph does not itself become
   the thing a future encoding check trips over. `issues/open/AFLDB-ISSUE-118.md` decodes as
   valid UTF-8 with no BOM; it stores the em dash correctly as the bytes `e2 80 94` and the
   section sign as `c2 a7`; and it contains no U+00E2/U+20AC or U+00C2/U+00A7 pair of the kind
   that a double-decode produces. The garbled em dashes and section signs are a console
   rendering artefact
   — Windows PowerShell decoding UTF-8 as cp1252. **Nothing was rewritten.** To read it correctly:
   `chcp 65001` first, or `Get-Content -Encoding utf8 <file>`, or read it in an editor.

Made at the 1 September finalisation, after the rest of the gate was run:

4. **§21.10 steps 10 and 11 told the operator to use `$AFLDB_DATABASE_URL`** — that variable does
   not exist in this environment. Found by running it: psql received an empty DSN, fell back to
   its default local connection, prompted for the Windows user `stuar` and failed
   authentication. **The SQL never ran and nothing was written.** This is a runbook defect, not a
   database or tooling defect. Corrected to `AFLDB_OWNER_DATABASE_URL`, which is what the two
   read-only steps were then run under, with the full list of DSN variables that do exist now
   recorded in §21.10 so the next operator does not have to discover them.
5. **§21.10 steps 7–9 named the interpreter as `...\.venv\Scripts\python`** — corrected to
   `python.exe`, which is what was actually invoked.
6. **§21 status, §21.10 step markers, §21.11 and §21.12 said the import was outstanding** —
   corrected throughout: steps 6b–11 are done and recorded in §21.16, and the next action is the
   operator commit followed by Stage 3 in a fresh session.

### 21.16 Operator gate — steps 6b–11 EXECUTED AND PASSED, 1 September 2026

Run by the operator in `D:\dev\afldb-gridley`, against `afldb_dev` over the restored SSH tunnel
on `127.0.0.1:5432`, with the environment loaded from `D:\dev\afldb\.env` and the established
interpreter `D:\dev\afldb\.venv\Scripts\python.exe`. Recorded here verbatim. **No credential was
printed and none is recorded here.** With §21.13 this completes §21.10 steps 1–11.

#### Step 6b — completeness verification

`acquire_gridley_boards.py --all --require-complete` — **PASS**.

| Field | Value |
|---|---|
| Date range | 2023-07-17 → 2026-09-01, **1,143 dates** |
| Already captured | **1,143** |
| To request | **0** — bound 0 board requests |
| saved / revised / unchanged | 0 / 0 / 0 |
| skipped | **1,143** |
| unavailable, http_error, network_error, malformed_json, shape_invalid | **0 each** |
| Dates considered | 1,143 |
| Requests made | **1** |

`OK: 0 captures written, 1,143 already on disk.` The single request is the per-run `robots.txt`
fetch established by the V-OP.7 audit; **no board payload was re-fetched**. The run record is on
disk as the eighth entry in `data/sources/gridley/history/runs/`, `status: completed`, and its
counts match the above.

#### Step 7 — classify the complete snapshot against `afldb_dev`, without writing

`import_gridley_boards.py --dry-run` — **PASS, exit 0.**

```
capture files read    : 1,143     captures parsed : 1,143   captures rejected : 0
board number range    : #1 - #1143          board dates : 2023-07-17 - 2026-09-01
distinct boards       : 1,143     distinct dates  : 1,143
dates with >1 capture : 0         gaps in number range : 0
axis occurrences      : 6,858     distinct criterion ids : 839
axes with description : 6,851     axes with subtitle : 3,900   axes with item type : 1,066
captures with answer key : 1,143 of 1,143
answer-key cells      : 10,287    answer-key player refs : 1,512,436
```

PostgreSQL classification: **1,143 would be inserted, 0 revised, 0 unchanged, 0 conflicts.**

`OK: 1143 capture(s) validated, 1143 would be inserted, 0 would become new revisions, 0 already
captured. Nothing was written.`

#### Step 8 — the real `gridley_api` import

`import_gridley_boards.py` — **PASS, exit 0.**

**1,143 inserted, 0 revised, 0 unchanged, 0 conflicts, 0 rejected.**

`OK: 1143 board(s) inserted, 0 new revision(s), 0 already captured.`

`afldb_dev` now holds the whole Gridley history under `gridley_api`, beside the 1,123
`legacy_sqlite` rows Stage 1 imported. Neither provenance touched the other.

#### Step 9 — immediate idempotency re-run

The same command again, immediately — **PASS, exit 0.**

**0 inserted, 0 revised, 1,143 unchanged, 0 conflicts, 0 rejected.**

`OK: 0 board(s) inserted, 0 new revision(s), 1143 already captured.`

This is §21.8's fix proved against the real database and the complete snapshot, not a fixture:
re-running a finished backfill creates nothing.

#### Step 10 — R8 measured in the database

Read-only, under `AFLDB_OWNER_DATABASE_URL`.

| provenance | revisions | payload_bytes |
|---|---:|---|
| `gridley_api` | 1,143 | **9,813 kB** |
| `legacy_sqlite` | 1,123 | **373 kB** |

**These are PostgreSQL `pg_column_size(raw_payload)` aggregates and are a different measurement
from the 42.9 MB raw on-disk snapshot in §21.13** — a different representation of the same
captures, not a discrepancy. Do not present one as a correction of the other. R8 is answered:
the richer Gridley payloads cost single-digit megabytes in the database.

**Two operator notes, neither a defect in the code.**

* The first attempt used the runbook's `$AFLDB_DATABASE_URL`, which does not exist. psql got an
  empty DSN, fell back to a default local connection, prompted for Windows user `stuar` and
  failed authentication. **The query did not run and nothing was written.** The runbook was
  wrong; §21.10 and §21.15 item 4 record the correction.
* Passing the DSN and `-c "<sql>"` through PowerShell in one go had psql read the SQL as a
  surplus command-line argument and drop into interactive mode. The connection to `afldb_dev`
  itself succeeded over SSL, and the query was then run inside that authenticated session. A
  shell-quoting trap, not a database or tooling problem.

#### Step 11 — `legacy_sqlite` versus `gridley_api`, the six-label cross-check

Read-only, under `AFLDB_OWNER_DATABASE_URL`, the query exactly as §21.10 step 11 gives it.

```
 board_number | orientation | position | gridley | archive
--------------+-------------+----------+---------+---------
(0 rows)
```

**PASS — zero rows.** The two provenances overlap on 1,123 boards of six axes each, so this
establishes **no `raw_label` divergence across 1,123 × 6 = 6,738 overlapping board-axis
positions**. This is the cross-check §10.1 wanted the rescued archive for, and the answer is that
the archive and the re-acquired history read the corpus identically. §21.9 V-S2.5 had compared
two boards; this compares every board they share.

#### What this establishes

* The Gridley history is acquired in full and is whole on disk: 1,143 of 1,143 dates,
  2023-07-17 → 2026-09-01, boards #1–#1143 with no gap and no duplicate, every stored byte
  matching its recorded hash (§21.13).
* It is persisted in `afldb_dev` in full under `gridley_api`, with zero conflicts and zero
  rejections, and re-running the import is a proven no-op.
* The corpus has one consistent reading across both provenances.
* Storage in the database is measured and modest.
* **No Stage 3 work was performed.** No criterion was mapped, no solver semantics or mappings
  were changed, migration 080 was not edited, no migration was added, and the hashing/revision
  recipe was not touched. §21.14 remains open, deliberately.
* Nothing was committed, merged, rebased, pushed or deployed. The Stage 2 milestone is ready for
  the operator commit.

---

## 22. Stages 3–6 — compatibility proven on the stored corpus (4 September 2026)

**Status at 4 September 2026:** the recovered Stage 0/1/2 work is on `claude/issue-118`
(cherry-picked from `opus/gridley-corpus`, which `main` never merged), the whole stored corpus is
exported as an offline fixture, every one of its 839 criteria is classified, 29 builders were
added so that every criterion AFLDB holds data for is answerable, the exhaustive regression
runs every cell through the production solver, and the `/grid-solver` crash digest is
identified. §22.9 has the run figures; §22.10 the exact next action.

| Field | Value |
|---|---|
| Branch / worktree | `claude/issue-118` / `D:\dev\afldb-issue-118` |
| Base | `main @ f04e86d` |
| Recovered commits | `d7e98f0` (Stage 0 doc), `ffba02d` (Stage 1), `084cf2e` (Stage 2) — cherry-picks of `9ecc6fc`/`28fdb2f`/`6e3b38a`; conflicts on `CHANGELOG.md`, `IssuesIndex.md`, `issues.md`, `.gitattributes` resolved by keeping `main`'s files (tracking rewritten in this section; the Gridley `.gitattributes` rule re-added) |
| Model / effort | Fable 5.1, Medium |
| Databases touched | `afldb_dev` read-only (corpus export, telemetry, reference facts); `afldb_test` read-only (regression); **production untouched** |

### 22.1 Stage 0 — what survived and what did not

- `main` carried nothing of the Gridley work: no migration `080`, no importer, no fixtures, no
  acquisition tool. All three `opus/gridley-corpus` commits cherry-picked cleanly apart from the
  tracking files; `tools/maintenance/privileges.sql` applied without conflict. The recovered
  suites (`tests/gridley-acquisition.test.ts`, `tests/external-grids-import.test.ts`) pass on
  current `main`: **92/92**.
- The on-disk snapshot (`data/sources/gridley/history/`, git-ignored in the deleted
  `D:\dev\afldb-gridley` worktree) **is gone**. The corpus survives only in `afldb_dev`
  (`external_grids`: 1,143 `gridley_api` + 1,123 `legacy_sqlite` current revisions, migration
  `080` applied there with checksum `0801b8a9…`) and in the two committed fixture boards. The
  raw JSON was preserved by §10.3 exactly for this case.
- `afldb_test` does not have migration `080` (its ledger runs 081–085 only), which is why the
  regression reads the corpus from the exported fixture, not from the database.

### 22.2 Stage 1 — the authoritative corpus, exported offline

`tools/gridley/export_corpus.py` (read-only, `--dsn`) writes two byte-deterministic files:

| File | Content | Size |
|---|---|---|
| `tests/fixtures/gridley/corpus.json` | 1,143 boards: number, date, 3 row items (`vItems`) and 3 column items (`hItems`) with Gridley's `id`/`title`/`subtitle`/`description`/`type`, the AFL champion image id where present, and each cell's answer-set size | 1,648,799 bytes |
| `tests/fixtures/gridley/corpus-answers.json.gz` | per board a 3×3 array of sorted Gridley player ids (`correctAnswersPlayerMap` keys), gzip with a zero mtime | 3,023,422 bytes |

The stored envelope is `raw_payload -> {board_date, body_sha256, payload, source, url}`; the
Gridley JSON is `payload`. Rows = `vItems`, columns = `hItems` (§21.4).

**Denominator (`tests/gridley-compat.test.ts`, DB-free, asserted exactly):**

| Measure | Value |
|---|---:|
| stored games | **1,143** (#1 2023-07-17 → #1143 2026-09-01, dense) |
| question/cell occurrences | **10,287** cells; **6,858** criterion occurrences |
| unique criteria (by Gridley `id`) | **839** |
| mapped to an AFLDB Grid Solver axis | **810** criteria / **6,590** occurrences |
| freebie (`free-hit`, "select any player") | 1 / 1 |
| data absent in AFLDB (explicit reason each) | **28** criteria / **267** occurrences |
| malformed / non-question rows | **0** — every capture parsed; 14 ids vary only in subtitle/description wording across boards |
| unrecognised | **0** |
| answer-key entries | 1,512,436 (13,524 distinct Gridley player ids); no empty cell |

Duplicates/equivalents: distinct Gridley ids are the unit; the same question under two ids
(`grandfinals1-2000s` / `grandfinals2000s-playedin-1`) maps to the same axis, asserted by "one
axis per id".

### 22.3 Stage 2 — semantic mapping (`src/search/gridley-compat.ts`)

Rules are keyed by Gridley's criterion **id** and pin the title(s) Gridley has used; a changed
title is refused as unrecognised, never mapped to the old meaning. AFLDB ids (organizations,
venues, awards, players) come from injected lookups. Decisions that were not obvious:

- **Clubs.** Gridley: "played ≥1 game … *or currently on their list*". AFLDB has no season
  lists, so the listed-never-played tail is unrepresentable (`NO_LISTS`; noted on every club
  rule, not hidden). Everything else is `played_for_club` at the organization.
  **Brisbane Lions** is Gridley-defined to include Fitzroy and the Bears; AFLDB's lineage model
  keeps mergers link-only (`club_organization_relations.merged_into`), so two new builders
  follow that link explicitly: `played_for_club_incl_merged`, `debut_club_incl_merged`.
  `bears` is the Bears organization alone. Sydney/South Melbourne and Bulldogs/Footscray are
  one organization already. Port Adelaide is AFL-only in both.
- **Teammates** (403 `*-teammate-<gridleyId>` + ~140 name-only ids) → `teammate_of`
  (same club-season overlap). Names resolve by normalised full name; the five ambiguous names
  are settled by debut season in `PLAYER_OVERRIDES` (Josh J. Kennedy 2008, Nathan Brown 1997
  (Bulldogs), Scott Thompson 2001 (Adelaide), Tom Hickey 2011, Gary Ablett jr 2002). The
  answer-key bridge (§22.4) checks each choice.
- **Thresholds by arithmetic.** "less than 10 goals" → `career_goals_max(9)`; "50 games or
  less" → `career_games_max(50)`; era disclosures ("since 1965") are AFLDB's own coverage and
  need no filter (§7.2).
- **Finals.** `NO FINALS WINS` → `never_won_a_final` (no played-finals gate, per Gridley's
  text); `WINNING RECORD IN FINALS` → new `finals_winning_record` (draws are neither).
- **Grand Finals.** Named-year boards → `grand_final_between_seasons(y,y)`; "beat Collingwood
  in a GF" → new `grand_final_won_against_club`; "1+ goal in multiple GFs" → new
  `grand_finals_with_stat_min_count`; "defeated by Dusty in a GF" → `lost_grand_final_against`.
- **Season-bound totals.** `20+ GAMES IN 2023`, `15+ GOALS IN 2023` → new
  `games_in_named_season_min` / `named_season_stat_total_min`.
- **Leaders.** Club leaders → `club_season_stat_leader` (ties count); `MOST BROWNLOW VOTES
  TEAM` → new `club_season_brownlow_leader`; `TOP 10 GOAL KICKER SEASON` etc. → new
  `league_season_stat_rank_top` (`rank()`, ties at the boundary included).
- **Rivalries.** Showdown = Port Adelaide/Adelaide, Western Derby = West Coast/Fremantle,
  QClash = Brisbane/Gold Coast, Sydney Derby = Sydney/GWS via `matchup_played_min` plus new
  `matchup_won_min`, `matchup_game_stat_min`, `matchup_winning_record`. Anzac Day and Dreamtime
  use `matches.match_event`; `ANZAC DAY MATCH WINNER` → new `match_event_won`; **Big Freeze** =
  King's Birthday from 2015 → new `match_event_played_between`. **Gather Round** carries no tag:
  new `gather_round_played` / `gather_round_game_stat_min` derive it as the one home-and-away
  round per season (2023+) played entirely at the four South Australian grounds.
- **Awards.** All-Australian selections (incl. 1953–1988 carnivals and VFL Team of the Year, as
  AFLDB's `all-australian` rows already do), position groups → new
  `all_australian_defender/forward/midfielder` (ruck excluded, as Gridley says);
  `ALL-AUSTRALIAN SQUAD 2024` → new `all_australian_squad_in_season` (AFLDB's squad rows are the
  non-selected members, so squad ∪ team); B&F in a premiership year → new
  `best_and_fairest_in_premiership_season`; premiership captain → new `premiership_captain`
  (captain that season **and** on the winning GF side).
- **Draft.** `PICK 1` / `TOP 5` / `TOP 10` → new `national_draft_pick_between`
  (`draft_kind = 'national'`; `draft_pick_between` spans every draft kind); rookie →
  `draft_type_is('Rookie')`; free agent → `draft_type_is('Free Agency')` (FA + DFA); father–son
  pick → `recruited_via('Father-Son')`.
- **Names & numbers** (new group): `given_name_in('Steve,Steven,Stephen,Stefan')`,
  `surname_hyphenated`, `jumper_number_worn(n)`; `100 POINT WIN` → new `won_by_margin_min`;
  `10 WINS IN A ROW` → new `consecutive_wins_min` (runs in the player's own game sequence);
  `MORE FREES FOR THAN AGAINST` → `career_stat_exceeds`; `PLAYED IN CHINA` →
  `played_at_venue(Jiangwan Stadium)`; `30+ DISPOSALS TWO DIFF CLUBS` → new
  `single_game_stat_multi_club_min`.

**Data absent — the 28 criteria (267 occurrences) AFLDB cannot answer, with the reason the
rule table carries:**

| Criteria | Occ. | Why |
|---|---:|---|
| `height195`, `height180` | 142 | `players.height_cm` is NULL for all 13,273 players on every environment; `draft_picks.height_cm` covers drafted players only |
| `brother` | 53 | `player_relationships` (migration 006) has never been populated anywhere |
| `season2024player` | 14 | no season lists |
| `coachedBy*` ×7, `premcoach` | 16 | no coaching data in the schema |
| `moty`, `goty`, `anzacmedal`, `showdown-medal`, `glendenning`, `qclash-medal`, `battleofthebridge-medal` | 22 | no such award rows in `awards` |
| `intrulesplayer`, `nfl` | 6 | other-code / representative careers not modelled |
| `winaftersiren` | 4 | no scoring-event timeline |
| `fathersonfather` | 3 | `father_son_selections` never populated; `signing_kind` names the son only |
| `irish`, `tasmanian` | 3 | no birthplace / nationality |
| `recruitedByDodoro` | 2 | recruiters not modelled |
| `spoils5season` | 1 | spoils not a recorded stat |
| `debut22` | 1 | `players.dob` populated for 855 of 13,273 |

None of these is a solver limitation; each needs a data acquisition of its own and is recorded
as follow-up in §22.11, not silently excluded.

### 22.4 Stage 3 — the exhaustive regression (`tests/integration/gridley-corpus.test.ts`)

Against `afldb_test`, offline from Gridley, deterministic:

1. lookups from the database (organizations, venues, awards, all players);
2. one `compileAxis` + full eligible-set query per distinct mapped criterion, timed;
3. every one of the 10,287 cells through `solveCellSummary` (the page's own call), asserting
   `eligible` equals the intersection of the two criterion sets, is non-empty (Gridley's answer
   set never is), and — for the **401 Gridley player ids the corpus itself bridges** (403
   player-valued criteria: 401 teammate ids, 2 of whom also appear as GF opponents) — that membership in Gridley's
   answer key and in AFLDB's eligible set agree in both directions;
4. a failure names board, cell, source criterion, the AFLDB axis and a category: `parse`,
   `unsupported` (counted, never failed), `query failure`, `timeout`, `empty answer`,
   `incorrect known answer`, `count mismatch`; every criterion over 1 s and every cell over 1 s is
   listed and fails the run.

`AFLDB_GRIDLEY_REPORT=<file>` writes the full per-criterion / per-cell report.

### 22.5 Stage 4 — digest `1511510695`

- The digest is Next's `djb2(message + stack)` of a server-component error
  (`create-error-handler.js:102`). The same digest is already on record: **`AFLDB-ISSUE-076`**
  (`issues.md`, Symptom/Evidence) reproduced it on dev build `NQrtI3zQGWx62e6zbI5bR` and
  `journalctl -u afldb` correlated *every* occurrence with **SQLSTATE 57014, "canceling
  statement due to statement timeout"** thrown by postgres.js. `afldb_dev.app_health_events`
  still holds those four `PAGE_CRASH` rows (2026-08-22 16:42–16:45, build
  `NQrtI3zQGWx62e6zbI5bR`) — this session read them.
- The production events (2026-09-03 05:49, two rows) carry the identical digest on a different
  build. The digest is stable across builds because the cancelled statement's error is created
  inside the externalised driver at the same deploy path on both hosts, so the hashed message
  and stack do not change with the app bundle. **Exception: PostgreSQL 57014 statement timeout
  in a Grid Solver cell.**
- Mechanism: `page.tsx` awaited nine `solveCellSummary` calls in one `Promise.all`; one
  cancelled statement rejected the render and the route showed the error boundary, which posts
  `PAGE_CRASH` with the digest. `error.tsx` stores only the digest, so the offending *board* is
  not in telemetry.
- **Production journal, read by the operator on 2026-09-05 (read-only, host `afldb-prod`).**
  The app-health timestamps are UTC, so the incident window is **2026-09-03 15:45–15:55 AEST**
  (the first `05:45–05:55` local query returned nothing for that reason). The retained journal
  block holds two entries, both `Error [PostgresError]: canceling statement due to statement
  timeout`, `code: '57014'`, `digest: '1511510695'`, at **15:49:25** and **15:49:41 AEST**.
  This confirms on production, independently of ISSUE-076's dev correlation, that digest
  `1511510695` is SQLSTATE 57014 and that there were two incidents, not one repeated event.
  **Limitation:** the retained block does not contain the `/grid-solver?g=...` request line, so
  the board token cannot be recovered and the exact cell that timed out on production stays
  unnamed. This does not block closeout: the failure class is confirmed at the production host,
  ISSUE-076 had already tied the digest to the same timeout class, and this branch reproduced
  the class at cell level and removed it for the whole catalogue (§22.4, §22.6).
- Which predicate timed out on production on 2026-09-03 is therefore known by class, not by
  board. Two facts bound the hypothesis: the ISSUE-076/103 repairs
  (`6014b9e`, `0391e07`) were on production by then, and the crash came the morning after the
  2026-09-02 database promotion — `docs/production-promotion.md` and `tools/db/promotion-*` run
  **no `ANALYZE`** after the restore, so planner statistics were whatever autovacuum had reached.
- Fixes in this branch: (1) `guardCellTimeout` / `isStatementTimeout` in
  `src/db/queries/grid-solver.ts` confine 57014 to its square — the page renders "Timed out" for
  that square and the drill-down, logs `[grid-solver] cell r-c timed out: <row> x <col>`
  server-side, and rethrows anything else (`tests/grid-solver-timeout.test.ts`, 7 tests);
  (2) the corpus run gates every predicate the corpus can produce at 1 s (§22.9).
  This is not a catch-all: only SQLSTATE 57014 is confined, and only per cell.

### 22.6 Stage 5 — performance

Criteria over 1 s in the criterion pass (full eligible set, tunnel latency ≈ 60 ms included):

| Criterion | Axis | ms | Players |
|---|---|---:|---:|
| `moreFFthanFAcareer` | `career_stat_exceeds(frees_for, frees_against)` | 1,866 | 2,511 |
| `teammates-150` | `career_teammates_min(150)` | 1,819 | 995 |
| `teammates-100` | `career_teammates_min(100)` | 1,766 | 3,580 |

`career_teammates_min` is the documented ~2 s roster-array shape (grid-solver.ts comment);
`career_stat_exceeds` on two `live_only` stats sums `player_match_stats` twice per player —
`player_career_stats.frees_for/frees_against` exist but are **NULL on `afldb_test`** (canonical
rebuild does not fill them), so switching to the precomputed column was not taken without
evidence that dev/prod populate it. No index was added. All three are one-shot set queries;
§22.9 records the per-cell production-path timings.

### 22.7 Stage 6 — UI

Only the crash handling above: a timed-out square and drill-down render as such; the `text`
parameter kind (for `given_name_in`) gets a plain text input in `GridSolverForm.tsx`. No
redesign.

### 22.8 Files changed in this session

- `src/search/grid-solver-spec.ts` — 29 builders, `text` param kind, `Names & numbers` group
  (108 → 137)
- `src/db/queries/grid-solver.ts` — their compilers; `clubIdsInclMerged`, `matchupMatchFilter`,
  `gatherRoundMatchIds`, season-bound `seasonStatAtLeast`; `isStatementTimeout`, `guardCellTimeout`
- `src/app/grid-solver/page.tsx`, `src/app/grid-solver/GridSolverForm.tsx`
- `src/search/gridley-compat.ts` — the mapping (new)
- `tools/gridley/export_corpus.py` — fixture exporter (new)
- `tests/fixtures/gridley/corpus.json`, `corpus-answers.json.gz` (new)
- `tests/gridley-compat.test.ts`, `tests/integration/gridley-corpus.test.ts`,
  `tests/grid-solver-timeout.test.ts` (new); `tests/grid-solver-spec.test.ts` (count)
- `docs/search.md` §7; `.gitattributes` (Gridley rule re-added); tracking files

### 22.9 Validation

- `tests/gridley-compat.test.ts` + `tests/grid-solver-spec.test.ts`: **29/29** (DB-free).
- `tests/grid-solver-timeout.test.ts`: **7/7** (DB-free).
- `tests/gridley-acquisition.test.ts` + `tests/external-grids-import.test.ts`: **92/92**.
- `tests/integration/grid-solver.test.ts` "every grid builder compiles and solves":
  **137/137** on `afldb_test`.
- `npx tsc --noEmit`: clean. `eslint` on every changed file: 0 errors, 1 pre-existing warning
  (`_total` in `solvePredicates`).
- Exhaustive corpus run on `afldb_test`: **see §22.9.1**.

#### 22.9.1 Exhaustive corpus run

Run of 4 September 2026 (sixth and final run of the session; each earlier run found and fixed
something — see the history below). `npx vitest run tests/integration/gridley-corpus.test.ts`
against `afldb_test` over the 55432 tunnel, ~5 minutes, **1,161/1,161 tests**.

| Measure | Value |
|---|---:|
| criteria mapped and compiled | 810, **0 query failures, 0 timeouts, 0 empty sets** outside the named dataset gaps |
| criteria over 1 s (full eligible set) | 3: `teammates-150` 1,818 ms, `teammates-100` 1,784 ms, `moreFFthanFAcareer` 1,763 ms — none over the 4 s guard |
| cells through `solveCellSummary` | **9,141** of 10,287 (the rest are the 795 `unsupported` + 351 `dataset gap` cells below, never solved because an axis is data-absent here) |
| `eligible` = set intersection | every solved cell (0 count mismatches) |
| empty answers | **0** |
| cell time p50 / p90 / p99 / max | 41 ms / 300 ms / 523 ms / 2,061 ms; 19 cells over 1 s, all on `teammates-100/150`, `moreFFthanFAcareer` or a large teammate set; none over 4 s |
| known-answer checks (401 bridged players × 9,141 cells) | **0 incorrect known answers** among fair comparisons |

Findings that are counted and reported, not failed (each names its reason in the log and the report):

| Category | Cells / checks | Meaning |
|---|---:|---|
| `unsupported` | 795 cells | an axis is one of the 28 data-absent criteria (§22.3) |
| `dataset gap` | 353 cells | an axis reads a dataset `afldb_test` lacks: draft links (5 of 6,810 linked), `matches.match_event` (0 rows), the 2026 season (2026 debutants Duursma and Smith; two teammate cells whose only answers moved club in 2026) |
| `partial dataset` | 506 checks | `captaincies` has no Geelong, Hawthorn or West Coast rows on any environment (West Coast × premiership captain is empty for that reason) |
| `time of board` | 12,531 checks | Gridley's answer key is frozen at the board's date; the player was still playing then (or a Hall of Fame induction came later: Hodge/Riewoldt 2025, Ablett 2026), so today's AFLDB legitimately differs |
| `list membership` | 809 checks | Gridley's club, decade, teammate, club-count, wooden-spoon and minor-premiership criteria count a player merely *listed* by the club that season — verified case by case (Kane Johnson listed at Richmond 2009, Robbie Tarrant at Richmond 2023, the suspended 2016 Essendon players in a wooden-spoon season, Michael Voss's Bears→Lions merger before the fold); AFLDB models games played and has no list data (`NO_LISTS`, §22.3) |

The oracle is therefore exact on what it can be exact about: for every player whose career had
ended before the board's year, every criterion pair AFLDB holds data for, in both directions, the
solver and Gridley agree.

**History of the six runs (what each found):** run 1 exposed `brownlow_season_votes.club_id`
being NULL (club leader over-inclusion), the swapped Josh Kennedy overrides, 61 cells over 1 s
with a 4.9 s worst case and the `afldb_test` dataset gaps; run 2 (InitPlan shape) fixed the
slow pairs but timed out on two 13,000-player axes; run 3 (set-then-rank) showed the Bears→Lions
merger fold was missing from the club-count criteria and that the answer keys are frozen at
board date; runs 4–5 verified the residual disagreements one by one (all list membership) and
run 6 is clean.

### 22.10 Exact next action

The branch is complete and green; two things stand between it and closeout, both the operator's:

1. **DONE 2026-09-05 — production journal read.** Result recorded in §22.5: two 57014 entries
   with digest `1511510695` at 15:49:25 and 15:49:41 AEST (the window is UTC in telemetry, so
   the `05:45` command below found nothing); the `/grid-solver?g=` request line is not in the
   retained block, so the board is not recoverable. Closeout proceeds on the digest identity.
   The original instruction is kept below for the record.

   **Read the production journal for the 2026-09-03 crash (read-only, PROD).** Which board timed
   out is not in telemetry; the journal has it. One command, from PowerShell (the production alias
   needs the agent-held key):

   ```text
   ssh -o BatchMode=yes afldb "journalctl -u afldb --since '2026-09-03 05:45' --until '2026-09-03 05:55' --no-pager | grep -v '_next/static' | head -80"
   ```

   Expected: `PostgresError: canceling statement due to statement timeout`, `code: 57014`,
   `digest: '1511510695'` and, just above, the request line for `/grid-solver?g=...`. Paste the
   `g=` token into `parseBoardState` (or the page on DEV) to name the board; record it in §22.5.
   If the journal has rotated, `journalctl --list-boots` first; if the entry is gone, the
   identification stands on the digest identity with ISSUE-076's correlated journal and the
   4 dev events on build `NQrtI3zQGWx62e6zbI5bR`, and the closeout says so.
   Also worth one read-only check while there: `SELECT relname, last_analyze, last_autoanalyze
   FROM pg_stat_user_tables WHERE relname IN ('player_match_stats','matches','player_clubs')` —
   the promotion of 2026-09-02 ran no `ANALYZE` (§22.11).

2. **DONE 2026-09-05 — merged and deployed to DEV then PROD, code first (§22.12).**
   Original instruction kept for the record: **Merge and deploy `claude/issue-118` to DEV, then PROD, code first.** Migration `080` is
   for the corpus tables only and is optional on production; it is already on `afldb_dev`.
   No privileges change is required for the app. After deploy, load `/grid-solver` with the
   ISSUE-076 board and one of the corpus's heaviest pairs (`teammates-100` × `disposals30`) and
   confirm every square resolves.

Then close: move `issues/open/AFLDB-ISSUE-118.md` to `issues/closed/`, mark the ledger entry
Resolved with the production board recorded, retire the row from `IssuesIndex.md` and the Open
Issues table (3 → 2). Nothing in ISSUE-110 or ISSUE-137 is touched by this branch.

Optional, separately tracked follow-ups (§22.11): refresh `afldb_test` so the `dataset gap`
line is empty; acquisitions for the 28 data-absent criteria and the three missing clubs'
captaincies; `ANALYZE` in the promotion procedure.

### 22.11 Follow-up recorded, not carried as open issues

- Data acquisitions that would retire the 28 data-absent criteria: player height (all
  players), sibling relationships (`player_relationships`), father–son links, coaching
  tenures, the seven medals, birthplace.
- `afldb_test` lags `afldb_dev` in ways the corpus exposes: no `matches.match_event` tags
  (legacy import only), no linked `draft_picks` (5 vs 5,103), no `player_achievements`, no 2026
  season, `player_career_stats.frees_*` NULL — while dev has only 910 `jumper_number` values
  against test's 643,114. Families that read those tables pass on test only where test has the
  data; the run report lists each affected criterion.
- `docs/production-promotion.md` runs no `ANALYZE` after the restore (§22.5).

### 22.12 Merge, deployment and acceptance (5 September 2026) — RESOLVED

**Merge.** `claude/issue-118` fast-forwarded onto `main` (`f04e86d` → `4efdf70`, five commits,
no merge commit, no conflicts); `main` had not moved since the issue's base. The push to `main`
was the operator's (the agent's push was refused by the auto-mode classifier).

**DEV (`streamanator`, hostname proven on every connection).** `deploy/sync-dev.ps1`:
`169d738` → `4efdf70` (29 commits; the 24 that are not this issue are closeouts of issues already
accepted on DEV/PROD, and the only migration among them is `080`, already applied on `afldb_dev`),
`npm ci`, `db:migrate` **0 pending**, build **`tmEQ-3b-HBNZtkAw90Aag`**, `MainPID` 1594 → 138335 at
05:25:43 AEST. The script's own health `curl` ran 16 ms after the respawn and got connection
refused; from a fresh connection: `HTTP 200 {"status":"ok","database":"ok","latencyMs":28}`,
`x-afldb-build` = `BUILD_ID`. Page-level acceptance with a beta cookie minted from the host secret
(gate on; the Grid Solver audience is public on DEV), every square resolved and no square "Timed
out" on any board:

| Board (DEV ids: Cerra 12603, Fitzroy 106, GWS 111, Brisbane 102, MCG 234) | page | cell 0-0 drill-down |
|---|---:|---:|
| ISSUE-076 regression (Cerra teammate / 50+ games at 2 clubs / 20+ kicks × Fitzroy / GWS / won final at MCG) | 200, 980 ms, 9 cells (2 legitimately "No answer") | 200, 557 ms |
| heavy corpus pair `teammates-100` × `disposals30` (+ 200 games / 2010s × 5+ goals / GWS) | 200, 2,391 ms, 9 cells | 200, 2,325 ms |
| corpus worst cell `won_by_margin_min` × `played_for_club_incl_merged` (+ teammates-100 / disposals30 × Fitzroy / won final at MCG) | 200, 1,869 ms, 9 cells | 200, 1,902 ms |
| default board | 200, 527 ms | — |

DEV journal since the restart: `57014` 0, `1511510695` 0, `PostgresError` 0, `timed out` 0,
`status=5xx` 0.

**PROD (`afldb-prod`, hostname asserted by the deploy script itself before any mutation).**
Pre-flight read-only: `main` @ `169d738`, only untracked files, fast-forwardable, service active,
health OK, `db:status` **0 pending** at that checkout. Deployed detached (`setsid nohup`) 05:29:29 →
05:33:39 AEST: `git pull --ff-only` to `4efdf70`, `npm ci --include=dev`, **no `db:migrate`**,
`npm run build` → **`pEc4154P6P0QK8Hjoo5Uj`**, `MainPID` 803941 → 838666
(`ExecMainStartTimestamp` 05:33:29), local health OK on the first try,
`https://beta.afldb.com/api/health` 200.

- **Migration `080_external_grids.sql` deliberately NOT applied on production** — `db:status`
  after the pull lists it as the single PENDING migration and it stays that way. Reason, verified
  in code before the deploy: nothing under `src/` reads `external_grids` except the migration
  itself and a comment in `src/search/gridley-compat.ts`, and no runtime module imports
  `gridley-compat.ts` (it is used by `tests/` and `tools/gridley/` only). The Grid Solver runtime
  is unchanged by the table's absence. No privileges change was needed.
- **Page-level on PROD:** `/grid-solver` answers `307` to a beta-only cookie because the
  production audience is `super_admin` — the auth gate working, not an error. No admin session
  was minted (that is a write to production `auth_sessions`), so the browser render on PROD was
  not exercised by the agent; the three boards are linked below for the operator.
- **Solver-level on PROD, through the production call chain** (`createAxisSetCache` +
  `guardCellTimeout(solveCellSummary)` exactly as `page.tsx` composes them, `tsx` with
  `server-only` stubbed, the host's `DATABASE_URL`, `AFLDB_STATEMENT_TIMEOUT_MS=5000`; PROD ids
  Cerra 28, Fitzroy 7, GWS 12, Brisbane 3, MCG 26):

| Board | 9 cells | timeouts | top answers (eligible:name) |
|---|---:|---:|---|
| ISSUE-076 | 676 ms | 0 | 31:Dean Turner, 22:Rhys Palmer, 282:Stuart Cochrane, 0:—, 11:Caleb Marchbank, 44:Alex Cincotta, 120:Lyle Skinner, 46:Tom Sheridan, 1075:Josh Carmichael |
| heavy `teammates-100` × `disposals30` | 3,502 ms | 0 | 1057:Daryl Vernon, 1157:Dave Dick, 86:Kristian Jaksch, 488:Neville Fields, 352:George Bennett, 28:Sam Jacobs, 527:Beau Muston, 258:Lewis Johnston, 105:Rhys Cooyou |
| corpus worst cell | 2,338 ms | 0 | 385:Jack Harrow, 215:Jack Harrow, 1885:Paul Geister, 559:Fred Backway, 383:Fred Backway, 1882:Ern Hazel, 189:Zac OBrien, 85:Graeme Shearer, 848:Daryl Freame |

PROD journal from the restart to the end of acceptance (24 lines): `57014` 0, `1511510695` 0,
`PostgresError` 0, `timed out` 0, `error` 0. **No recurrence of digest `1511510695`.**
Transport headers: `prepare-standalone` printed "AFLDB_ENV is not production" because that
helper runs outside `.env`; `next build` loads `.env` itself, the built `routes-manifest.json`
carries HSTS and the production CSP, the loopback response serves HSTS, and Caddy sets both at
the edge. Nothing to fix. Every temporary script/log was removed from both hosts.

Operator browser confirmation on PROD (optional, super_admin session):

- ISSUE-076: `https://beta.afldb.com/grid-solver?g=eyJyb3dzIjpbeyJidWlsZGVyIjoiZ2FtZXNfYXRfbXVsdGlwbGVfY2x1YnNfbWluIiwicGFyYW1zIjp7ImdhbWVzIjoiNTAiLCJjbHVicyI6IjIifX0seyJidWlsZGVyIjoidGVhbW1hdGVfb2YiLCJwYXJhbXMiOnsicGxheWVyIjoiMjgifX0seyJidWlsZGVyIjoic2luZ2xlX2dhbWVfc3RhdF9taW4iLCJwYXJhbXMiOnsic3RhdCI6ImtpY2tzIiwieCI6IjIwIn19XSwiY29scyI6W3siYnVpbGRlciI6InBsYXllZF9mb3JfY2x1YiIsInBhcmFtcyI6eyJjbHViIjoiNyJ9fSx7ImJ1aWxkZXIiOiJwbGF5ZWRfZm9yX2NsdWIiLCJwYXJhbXMiOnsiY2x1YiI6IjEyIn19LHsiYnVpbGRlciI6Indvbl9maW5hbF9hdF92ZW51ZSIsInBhcmFtcyI6eyJ2ZW51ZSI6IjI2In19XSwib3JkZXIiOiJnYW1lc19hc2MifQ`
- heavy pair: `https://beta.afldb.com/grid-solver?g=eyJyb3dzIjpbeyJidWlsZGVyIjoiY2FyZWVyX3RlYW1tYXRlc19taW4iLCJwYXJhbXMiOnsieCI6IjEwMCJ9fSx7ImJ1aWxkZXIiOiJjYXJlZXJfZ2FtZXNfbWluIiwicGFyYW1zIjp7ImdhbWVzIjoiMjAwIn19LHsiYnVpbGRlciI6InBsYXllZF9pbl9kZWNhZGUiLCJwYXJhbXMiOnsiZGVjYWRlIjoiMjAxMCJ9fV0sImNvbHMiOlt7ImJ1aWxkZXIiOiJzaW5nbGVfZ2FtZV9zdGF0X21pbiIsInBhcmFtcyI6eyJzdGF0IjoiZGlzcG9zYWxzIiwieCI6IjMwIn19LHsiYnVpbGRlciI6InNpbmdsZV9nYW1lX3N0YXRfbWluIiwicGFyYW1zIjp7InN0YXQiOiJnb2FscyIsIngiOiI1In19LHsiYnVpbGRlciI6InBsYXllZF9mb3JfY2x1YiIsInBhcmFtcyI6eyJjbHViIjoiMTIifX1dLCJvcmRlciI6ImdhbWVzX2FzYyJ9`
- corpus worst cell: `https://beta.afldb.com/grid-solver?g=eyJyb3dzIjpbeyJidWlsZGVyIjoid29uX2J5X21hcmdpbl9taW4iLCJwYXJhbXMiOnsibWFyZ2luIjoiMTAwIn19LHsiYnVpbGRlciI6ImNhcmVlcl90ZWFtbWF0ZXNfbWluIiwicGFyYW1zIjp7IngiOiIxMDAifX0seyJidWlsZGVyIjoic2luZ2xlX2dhbWVfc3RhdF9taW4iLCJwYXJhbXMiOnsic3RhdCI6ImRpc3Bvc2FscyIsIngiOiIzMCJ9fV0sImNvbHMiOlt7ImJ1aWxkZXIiOiJwbGF5ZWRfZm9yX2NsdWJfaW5jbF9tZXJnZWQiLCJwYXJhbXMiOnsiY2x1YiI6IjMifX0seyJidWlsZGVyIjoicGxheWVkX2Zvcl9jbHViIiwicGFyYW1zIjp7ImNsdWIiOiI3In19LHsiYnVpbGRlciI6Indvbl9maW5hbF9hdF92ZW51ZSIsInBhcmFtcyI6eyJ2ZW51ZSI6IjI2In19XSwib3JkZXIiOiJnYW1lc19hc2MifQ`

**Closed 2026-09-05.** Ledger entry Resolved, row retired from `IssuesIndex.md` and the Open Issues
table (3 → 2), runbook moved to `issues/closed/`. ISSUE-110 and ISSUE-137 untouched.

---

## 23. REOPENED 2026-09-05 — the acceptance definition was too weak

| Field | Value |
|---|---|
| Branch / worktree | `claude/issue-118` / `D:\dev\afldb-issue-118` |
| Base | `main @ 208fd5d` (the closeout commit) |
| Model / effort | Fable 5.1, Medium |
| Databases touched | first session: none (tunnel down); second session (operator-run validation, then §23.12): `afldb_test` read-only. **Production untouched.** |

### 23.1 The acceptance gap

The original acceptance statement was *"every valid Gridley question captured by AFLDB is
answerable correctly by AFLDB Grid Solver."* §22.2 recorded **28 criteria / 267 occurrences** as
"data absent in AFLDB (explicit reason each)" and §22.9.1 counted their **795 cells** as
`unsupported` — *"counted, never failed"*. The closeout therefore certified the corpus while
one criterion occurrence in 26 (267 / 6,858) and one cell in 13 (795 / 10,287) was not answered
at all. An explicitly classified gap is still a gap: a valid Gridley question AFLDB cannot answer
is an unsupported valid question, whatever its label.

Two of those gaps were also mis-shaped, not merely unfilled:

- **All-Australian.** `allAus1953` / `allAus2x` / `allAus3x` and the decade criteria were mapped
  through the *generic* `award_winner*` builders with the `all-australian` award id injected. On
  the page that award is only reachable inside the generic award dropdown, grouped under
  `honour team` and named "All-Australian Team", while "All-Australian 40-Man Squad" sits under
  `award` — so a user sees the squad and not the final team, and nothing on the page says the two
  are different honours. `award_winner_min_times` also counted **rows**, not seasons: the 1984 team
  lists nine players under both their club and their state (§23.2), so a single 1984 selection
  counted as "2x".
- **Height.** `height195` / `height180` had no builder at all; the rule simply said the column is
  empty.

### 23.2 Corrected acceptance contract

| Measure | Required at closeout |
|---|---:|
| valid stored Gridley criteria | N |
| answerable **exactly** by the Grid Solver | **N** |
| unsupported valid criteria (`data_absent`) | **0** |
| unresolved / unrecognised valid criteria | **0** |
| malformed / non-question rows | explicit count only, kept separate from valid questions |
| timeouts | **0** |
| incorrect known-answer comparisons (fair comparisons) | **0** |

`data_absent` remains a permitted **intermediate diagnostic** while the issue is open. It never
counts as a pass. Every valid criterion must either be answered exactly, or be *proven* not to be a
valid Gridley question / corpus item — nothing is excluded because AFLDB lacks the data.

### 23.3 Stage AA1 — what AFLDB's `all-australian` rows actually are

Established from the checked-in source and its importer, not from the award's name:

- **Source:** `data/awards/all-australian.csv` (parser `tools/migration/all_australian.py`,
  loaded by `tools/migration/import_awards.py` as award slug `all-australian`, name
  "All-Australian Team", **category `honour_team`** — `data/awards/award-definitions.csv`).
  1,158 rows, 53 distinct seasons 1953–2025, **1,078 linked** to a player (80 unlinked: state-league
  and interstate selections with no AFLDB player), two provenances kept distinct per row:
  `draftguru` 906 rows (1979, 1980, 1983, 1985–1988, 1991–2025; positions and captaincy on the
  1991+ rows, 760 with a position) and `wikipedia` 252 rows (1953, 1956, 1958, 1961, 1966, 1969,
  1972, 1982, 1984, 1989, 1990; no positions).
- **These are final-team selections, not squad nominations.** Every 1991+ season carries 20–22
  rows (the selected 22 including interchange), never the 40/44-man squad. The squad is a
  **separate award**: slug `all-australian-squad`, "All-Australian 40-Man Squad", category
  `award`, 358 rows 2007–2025 in `data/awards/named-medals.csv`, holding the members **not**
  selected in the final team (§22.3). The two are never merged in the data.
- **1991+ completeness:** 35 seasons × 20–22 rows, every season present — complete as a final
  team.
- **Pre-1991 rows, per season** (rows / source): 1953 20 w, 1956 20 w, 1958 20 w, 1961 20 w,
  1966 20 w, 1969 20 w, 1972 20 w, 1979 20 d, 1980 20 d, 1982 20 w, 1983 20 d, **1984 48 w**,
  1985 20 d, 1986 23 d, 1987 21 d, 1988 22 d, 1989 22 w, 1990 22 w. The 1984 rows are 24
  club-labelled (Hawthorn, Melbourne, Essendon, …) plus 24 state-labelled (Vic 9, WA 8, SA 5,
  NT 1, NSW 1); nine players appear under both (the parser documents this as deliberate).
- **Against Gridley's definition** ("Includes VFL Team of the Year (1982–90), and State of Origin
  carnivals (1953–1988)"): AFLDB holds a team for **every** year 1982–1990 and for every carnival
  year (1953, 1956, 1958, 1961, 1966, 1969, 1972, 1979, 1980, 1983, 1986, 1988). **Open question:**
  in the years that had *both* a carnival team and a VFL Team of the Year (1983, 1986, 1988) AFLDB
  holds one team of 20–23 rows, i.e. one of the two, and which one is not recorded in the source;
  and what the second 1984 set of 24 state-labelled rows represents is not recorded either. These
  are settled by the answer-key comparison in §23.8 step 3, not by assumption.
- **Corpus denominator for this family:** 12 criterion ids, 172 occurrences, 512 cells, 588
  distinct Gridley player ids in those cells' answer keys, 141 of them bridgeable to AFLDB players
  through the corpus's own player-valued criteria (`allAus1953` 101, `allAus2x` 19, `allAusDef`
  13, `allAus2010s` 8, `allAusFwd` 8, `allAus2000s` 7, `allAus3x` 5, `allAus2020s` 4, `allAusMid`
  3, `allAus1990s` 2, `allAusRuc` 1, `allAusSquad2024` 1).
- **Representative answer-key comparison (1x / 2x / 3x, pre-1991 and modern players):** requires
  `afldb_test` (§23.8 step 3). Not executed this session — the tunnel was down.

### 23.4 Stage AA2 — the final team is now its own question

**Cause of the page defect:** not a missing row and not a naming mismatch in the data — a
**UI discoverability defect**. `getAwardOptions()` returns every award and the form groups the
dropdown by `awards.category`; `all-australian` is `honour_team`, the squad is `award`, so the
final team appears only inside a differently-named optgroup with a label that does not say "final
team", and the mapping's dependence on the generic dropdown meant nothing on the page distinguished
the two honours.

**Fix (implemented, DB-free tests green):**

| Builder | Label on the page | Semantics |
|---|---|---|
| `all_australian_team` | All-Australian final team (1953 onwards) | slug `all-australian`, linked rows |
| `all_australian_team_min_times` | All-Australian final team, X+ times | `count(DISTINCT season) >= X` — the 1984 club+state pair is one selection |
| `all_australian_team_between_seasons` | All-Australian final team, between seasons | season bounds |
| `all_australian_squad_member` | All-Australian 40-man squad member (2007 onwards) | squad rows ∪ final-team rows from the squad award's first season (2007), since the team is drawn from the squad |
| `all_australian_squad_in_season` (relabelled) | All-Australian 40-man squad member, in season | unchanged |
| `all_australian_defender/forward/midfielder` (relabelled) | All-Australian final-team … (1991 onwards) | unchanged |

`src/search/gridley-compat.ts` now maps `allAus1953` → `all_australian_team`, `allAus2x/3x` →
`all_australian_team_min_times`, the four decade ids → `all_australian_team_between_seasons`;
`allAusSquad2024` stays on `all_australian_squad_in_season`. The generic `award_winner*` builders
are untouched. Tests: `tests/gridley-compat.test.ts` ("keeps the All-Australian final team
distinct from the 40-man squad …" — mapping and label assertions), `tests/grid-solver-spec.test.ts`
(catalogue 145 → 151), and a DB-backed `describe` in `tests/integration/grid-solver.test.ts`
(final-team set = the award's linked distinct players; the squad set differs in both directions;
squad first season 2007; `min_times(2)` equals the distinct-season truth and excludes any
single-season double row).

### 23.5 Stage H1 — height sources measured

| Source | What it is | Coverage measured | Verdict |
|---|---|---|---|
| `players.height_cm` (migration 002) | canonical column | NULL for all players on every environment (§22.3) | target column; the `player_bio` ingest dataset (`src/lib/ingest/datasets.ts`, keyed by player id, COALESCE — never blanks a value) is the repository-standard write path |
| `draft_picks.height_cm` (migration 006, DraftGuru) | **draft-day** height of drafted players, 1981+ | drafted players only | **not used** as a silent substitute for biographical height |
| AFL Tables `player_details` via fitzRoy `fetch_player_details_afltables()` | per-club all-time player register: `Player, Team, Cap, #, HT, WT, Games, Wins, Draws, Losses, Goals, Seasons, Debut, Last` | **already acquired**: snapshot `full-history-20260902` (tracked manifest `docs/rebuild-manifests/afltables_fitzroy_core/full-history-20260902.json`, `player_details.csv` sha256 `62171adf…`, 16,731 rows; the git-ignored CSV is on disk in `D:\dev\afldb-issue-102\data\sources\afltables\fitzroy_core\full-history-20260902\`). **15,888 of 16,731 club-player rows carry HT (95%)**; 12,816 distinct names, 12,111 with a height. `tools/migration/import_fitzroy_core.py` deliberately does not import it ("supplemental only, no ID/DOB/URL") | best historical coverage available; **no stable id** — identity is name + Team + Cap + Seasons, so loading it needs a reconciliation to `players` (name, club organization, debut/final season) with fail-closed ambiguity |
| AFL API `fetch_player_details_afl` (`docs/acquisition/AFLDB-2026-API-ACQUISITION.md` §, probe P4) | current club lists with `heightInCm`, stable `providerId` | current season only (46 rows per club in the probe) | authoritative for current players; no history |
| DraftGuru person pages (`tools/rebuild/draftguru/profile_person_pages.py`) | regex `height_candidates` from page text | no checked-in snapshot; draft-context height | not a source |

**Gridley denominator for height:** 2 criteria, 142 occurrences, **426 cells, 7,216 distinct
Gridley player ids in their answer keys** (195 bridgeable). The AFLDB-side coverage figures
(players total, heights present, answer-key players covered / missing) require `afldb_test` and
the reconciliation — §23.8.

**Decision required (High):** loading AFL Tables heights is a cross-source reconciliation
(name/club/seasons → `players.id`), and the alternative — a per-player AFL Tables page acquisition
keyed by the AFL Tables id AFLDB already holds in `external_identities`, which needs no
reconciliation but is ~13k rate-limited requests and a new acquisition tool — is a design choice
with provenance consequences. Per the reopen brief this is a **Fable High** decision; Stage H2 is
therefore **not started**. Nothing was inferred, no value was written.

### 23.6 Stage H3 — height builders (implemented ahead of the data)

`height_min` ("Height X cm or taller", `p.height_cm IS NOT NULL AND p.height_cm >= X`) and
`height_max` ("Height X cm or shorter", `… <= X`) in a new `Biography` group; NULL never
qualifies. `height195` → `height_min(195)`, `height180` → `height_max(180)`. Until H2 lands
these answer nothing, and the corpus regression **fails on them** (§23.7) instead of passing —
the probe `heights: count(height_cm IS NOT NULL) > 0` names them as a dataset gap.
`tests/integration/grid-solver.test.ts` asserts the NULL semantics against the table's own counts
(taller + shorter across a 180/181 split = players with a known height).

### 23.7 Stage 3 — every previously data-absent criterion, reclassified

All 28 (267 occurrences) — none hidden, low-frequency rows included. **Only "now answerable"
counts towards acceptance**; every other status is an OPEN failure against the final target.

| Gridley id | Label | Occ. | Current reason | Required capability | Status |
|---|---|---:|---|---|---|
| `height195` | 195cm OR TALLER | 87 | `players.height_cm` NULL everywhere | H2: load AFL Tables heights (§23.5) | builder done; **acquisition required** |
| `height180` | 180cm OR SHORTER | 55 | same | same | builder done; **acquisition required** |
| `brother` | BROTHER PLAYED | 53 | `player_relationships` (migration 006) never populated | sibling acquisition (AFL Tables "brother of" relations on player pages) + `sibling_played` builder | **acquisition required** |
| `season2024player` | 2024 LISTED PLAYER | 14 | no season lists | season-list model (club lists per season) + AFL API list acquisition | **schema/model required** |
| `moty` | MARK OF THE YEAR | 7 | no award rows | award rows incl. Channel Seven / ABC 1970–2000, per Gridley's text | **acquisition required** |
| `goty` | GOAL OF THE YEAR | 3 | no award rows | award rows since 1976 | **acquisition required** |
| `showdown-medal` | SHOWDOWN MEDALIST | 5 | no award rows | Showdown Medal rows | **acquisition required** |
| `anzacmedal` | ANZAC MEDALIST | 3 | no award rows | Anzac Medal rows | **acquisition required** |
| `glendenning` | GLENDINNING–ALLAN MEDALIST | 2 | no award rows | Glendinning–Allan Medal rows | **acquisition required** |
| `qclash-medal` | MARCUS ASHCROFT MEDALIST | 1 | no award rows | Marcus Ashcroft Medal rows | **acquisition required** |
| `battleofthebridge-medal` | BRETT KIRK MEDALIST | 1 | no award rows | Brett Kirk Medal rows | **acquisition required** |
| `premcoach` | PREMIERSHIP COACH | 4 | no coaching data | coaches + coaching tenures model, acquisition, `premiership_coach` builder | **schema/model required** |
| `coachedByWorsfold` | COACHED BY WORSFOLD | 3 | no coaching data | coaching tenures + `coached_by` builder | **schema/model required** |
| `coachedByDaniher` | COACHED BY DANIHER | 2 | same | same | **schema/model required** |
| `coachedByHardwick` | COACHED BY HARDWICK | 2 | same | same | **schema/model required** |
| `coachedBySimpson` | COACHED BY SIMPSON | 2 | same | same | **schema/model required** |
| `coachedByClarkson` | COACHED BY CLARKSON | 1 | same | same | **schema/model required** |
| `coachedByGoodwin` | COACHED BY GOODWIN (incl. caretaker) | 1 | same | same | **schema/model required** |
| `coachedByMatthews` | COACHED BY MATTHEWS (VFL/AFL) | 1 | same | same | **schema/model required** |
| `intrulesplayer` | INT'L RULES PLAYER FOR AUS | 5 | representative careers not modelled | representative-selection model + International Rules squads acquisition | **schema/model required** |
| `nfl` | NFL PLAYER OR SIGNEE | 1 | other-code careers not modelled | other-code career model + curated source | **schema/model required** |
| `winaftersiren` | GAME WINNING KICK AFTER SIREN | 4 | no scoring-event timeline | scoring-event data; no free structured source identified for the full history | **source unavailable** (to be verified before closeout) |
| `fathersonfather` | FATHER OF A FATHER-SON PICK | 3 | `father_son_selections` never populated; `signing_kind` names the son | father→son link acquisition (DraftGuru father-son pages / AFL Tables relations) | **acquisition required** |
| `irish` | IRISH PLAYER (raised in Ireland) | 2 | no birthplace / nationality | birthplace model + acquisition | **schema/model required** |
| `tasmanian` | TASMANIAN | 1 | same | same | **schema/model required** |
| `recruitedByDodoro` | RECRUITED BY DODORO | 2 | recruiters not modelled | recruiter/list-manager tenure model; no structured source identified | **source unavailable** (to be verified) |
| `spoils5season` | AVG 5+ SPOILS SINCE 2012 | 1 | spoils not a recorded stat | Champion Data–only statistic; not in any free source AFLDB uses | **source unavailable** |
| `debut22` | 22+ YEARS OLD ON DEBUT | 1 | `players.dob` for 855 of 13,273 | DOB acquisition (the `player_birth_evidence` / ISSUE-090 path) + `age_on_debut_min` builder | **acquisition required** |

Totals: now answerable **0 of 28** (the two height criteria have builders but no data);
acquisition required 14; schema/model required 11; source unavailable 3. Not one of the 28 is a
malformed or non-question row: each is a real, well-defined Gridley question. The families the
brief named are all present above (height, siblings, father–son, coaches, named medals,
birthplace/state/nationality, International Rules/NFL, after-the-siren, spoils, age on debut,
recruiter, season lists). Also carried as an open partial-data failure: `captain` / `premcaptain`
answer from `captaincies` that has **no Geelong, Hawthorn or West Coast rows** on any environment
(§22.9.1 "partial dataset", 506 checks) — an acquisition of those three clubs' captains.

### 23.8 Stage 4 — the regression can no longer go green on a gap

`tests/integration/gridley-corpus.test.ts` now **fails by default** on any `unsupported`,
`dataset gap` or `partial dataset` finding, on any unsupported or gapped *criterion* (new test
"has no valid criterion left unsupported, and no probed dataset gap"), and — as before — on
`parse`, `query failure`, `timeout`, `empty answer`, `count mismatch` and `incorrect known
answer`. Only the two documented semantic differences (`time of board`, `list membership`) remain
informational. `AFLDB_GRIDLEY_DIAGNOSTIC=1` downgrades the three data-gap categories to
counted-and-named for development runs and prints that the run is not an acceptance run. The
height gap is probed (`heights`) so the empty height sets are named, not mistaken for a solver
fault. `tests/gridley-compat.test.ts` pins the data-absent count at **26 criteria / 125
occurrences** as tracked debt (mapped 812 / 6,732; denominator unchanged at 839 / 6,858).

### 23.9 Stage 5 — UI

The five questions the brief requires are on the page through `GRID_BUILDERS` (the form renders
the catalogue by group, no bespoke UI): *All-Australian final team (1953 onwards)*,
*All-Australian final team, X+ times*, *All-Australian 40-man squad member (2007 onwards)* /
*…, in season*, *Height X cm or taller*, *Height X cm or shorter*. Browser verification on DEV is
pending deployment (§23.11). No other Grid Solver UI was changed.

### 23.10 Validation executed this session (workstation, DB-free)

- `tests/gridley-compat.test.ts` + `tests/grid-solver-spec.test.ts` + `tests/grid-solver-timeout.test.ts`: **36/36**, then **31/31** for the two after the new tests were added.
- `npx tsc --noEmit`: exit 0. `eslint` on every changed file: exit 0.
- Corpus counts above computed from `tests/fixtures/gridley/corpus.json` / `corpus-answers.json.gz`
  offline; the All-Australian source figures from `data/awards/*.csv`.

### 23.11 Blocked — needs the operator, and the exact next action

The `127.0.0.1:55432` tunnel to `streamanator` (`afldb_test`) was closed, so nothing DB-backed ran.
In order, once the tunnel is up (from `D:\dev\afldb-issue-118`):

1. **Builders compile and the AA/height semantics hold on real data:**
   `npx vitest run tests/integration/grid-solver.test.ts` — expect every builder (151) to solve and
   the two new `describe`s to pass; the height `describe` passes on an all-NULL column (0 = 0).
2. **Diagnostic corpus run** (development mode, ~5 min):
   `AFLDB_GRIDLEY_DIAGNOSTIC=1 AFLDB_GRIDLEY_REPORT=<file> npx vitest run tests/integration/gridley-corpus.test.ts`
   — expect the 12 All-Australian criteria to compile on the new builders, `height195`/`height180`
   to be named under `dataset gap` (probe `heights: false`), and the unsupported list to print the
   26 remaining criteria.
3. **Stage AA1 answer-key comparison** from that report: filter `cellStats` / `findings` to the 512
   All-Australian cells; compare Gridley's answer count with AFLDB's per cell, and the 141 bridged
   players' membership in both directions. Specifically settle (a) whether 1983/1986/1988 need the
   second team of that year, (b) what the 24 state-labelled 1984 rows are and whether Gridley counts
   a 1984 club+state pair as one selection or two, (c) 2x / 3x on modern players. Record in a
   §23.3 addendum; if (b) shows Gridley counts two, change `all_australian_team_min_times` back to
   row counting **with the evidence cited**.
4. **Strict run** `npx vitest run tests/integration/gridley-corpus.test.ts` — expected to **FAIL**
   until the acquisitions land; the failure list is the open work.
5. Then a **Fable High** session for Stage H2 (height acquisition design: reconciliation of the
   acquired AFL Tables register versus a per-id page acquisition; provenance; `player_bio` load)
   and for the schema/model families in §23.7, each as its own runbook stage.

Closeout requires §23.2 in full: 100% of valid criteria supported exactly, 0 unsupported, 0
unresolved, 0 unrecognised, 0 timeouts, the strict run green on a database that carries every
dataset, and the browser check of §23.9 on DEV. **ISSUE-110 and ISSUE-137 are not touched by this
branch. Production is not touched.**

### 23.12 DB-backed validation and the All-Australian answer-key comparison (5 September 2026, second session)

**Operator validation on `afldb_test` (tunnel up):** `tests/integration/grid-solver.test.ts`
**189/189** — every builder (151) solves; the final team is distinct from the 40-man squad; X+
counts distinct seasons (the 1984 double rows do not make a "2x"); `height_min` / `height_max`
compile and NULL never qualifies. Diagnostic corpus run (`AFLDB_GRIDLEY_DIAGNOSTIC=1`):
**1,164/1,164**, cells solved 9,141 / 10,287, **unsupported valid criteria 26**, findings
`unsupported` 375, `dataset gap` 773, `partial dataset` 506, **timeouts 0**; probe `maxSeason`
2025, `draftLinks` false, `matchEvents` false, **`heights` false** (so the two height criteria are
now a named dataset gap, not an unsupported question). Slowest full-axis criteria unchanged
(`teammates-150` 1,816 ms, `teammates-100` 1,788 ms, `moreFFthanFAcareer` 1,766 ms; none over
the 4 s guard). A strict run would fail on exactly those three data-gap categories.

**The oracle (`tests/integration/gridley-aa-oracle.test.ts`, opt-in with `AFLDB_AA_REPORT=<file>`,
~60 s).** Gridley player ids are opaque and the answer keys carry ids only, so the corpus's name
bridge (player-valued criteria) reaches 380 players. This run adds a **co-occurrence fingerprint
bridge**: a Gridley id and an AFLDB player that occupy the same cells across the corpus are the
same person (Jaccard ≥ 0.7 over cell memberships, second candidate below half the best, injective).
Result: **1,609** fingerprint matches, **380** name matches, **157** ids in both — **0
disagreements**, so the method is validated; union bridge **1,832** players. Computed over 791
criterion sets and 9,798 usable cells.

**All-Australian comparison — exact counts.** 493 cells carry an All-Australian criterion
(292 `allAus1953`, 56 `allAus2x`, 39 `allAusDef`, 24 `allAusFwd`, 22 `allAus2010s`, 19
`allAus2000s`, 12 `allAus2020s`, 10 `allAus3x`, 9 `allAusMid`, 4 `allAus1990s`, 3 `allAusRuc`,
3 `allAusSquad2024`). Gridley's answer entries in those cells: 41,531 for `allAus1953` (AFLDB
38,889), 4,012 for `allAus2x` (AFLDB 3,835), 344 for `allAus3x` (AFLDB 314); the decade,
position and squad criteria agree to within list-membership noise (median per-cell difference 0 to
2; `allAusSquad2024` 84 = 84). **26,391 Gridley answer entries (51%) are unbridged → identity
bridge gap**, counted, not judged. Among bridged players every entry was classified:

| Classification | Entries | Distinct retired players |
|---|---:|---:|
| board-time effect (player still active at the board, or Hall of Fame inducted after it) | 730 | — |
| other axis, not All-Australian (the pair criterion: `clubs1`, `hof`, club list membership) | 636 | — |
| **AFLDB source missing required selection** (Gridley lists, AFLDB holds no selection or too few) | **315** | **14** |
| AFLDB source has extra non-Gridley selection | 65 | **1** (David Clarke, 48 cells) plus board-time modern players |

**Every material disagreement, by name (bridged, retired before the board):**

| Player | AFLDB All-Australian rows | Gridley says | Cells | Classification |
|---|---|---|---:|---|
| Jim Krakouer (1982–1991) | none | 1x **and 2x** | 58 | source missing (two selections) |
| David Rhys-Jones (1980–1992) | none | 1x | 50 | source missing |
| Darren Kappler (1987–1998) | none | 1x | 47 | source missing |
| Steven Stretch (1986–1995) | none | 1x | 41 | source missing |
| Brian Taylor (1980–1990) | none | 1x | 31 | source missing |
| Dermott Brereton (1982–1995) | 1985 Hawthorn | 2x **and 3x** | 16 | source missing (two selections) |
| Barry Mitchell (1984–1996) | 1991 Sydney | 2x | 15 | source missing |
| Doug Hawkins (1978–1995) | 1984 Footscray | 2x | 13 | source missing |
| Brian Royal (1983–1993) | 1986 Western Bulldogs | 2x | 11 | source missing |
| Greg Anderson (1988–1996) | 1993 Adelaide | 2x | 11 | source missing |
| Bernie Quinlan (1969–1986) | 1984 Fitzroy | 2x | 9 | source missing |
| Gary Malarkey (1977–1986) | 1979 Geelong | 2x | 7 | source missing (1980 or a 1983 team — source ambiguity on the season) |
| Terry Wallace (1978–1991) | 1982 Hawthorn, 1988 Western Bulldogs | 3x | 4 | source missing |
| Gary Pert (1982–1995) | 1985 Fitzroy, 1989 Fitzroy | 3x | 2 | source missing |
| David Clarke (Geelong, 1971–1982) | 1972 "David Clarke*" Geelong (wikipedia row, link resolved from **2** candidates) | not an All-Australian | 48 | **source ambiguity**: either the 1972 link points at the wrong David Clarke or Gridley's 1972 team omits him — to be settled against the 1972 carnival team, not assumed |
| Petracca, Curnow, Oliver, L. Ryan (active) | modern, correct | omitted from `ONE CLUB` × All-Australian on 2026 boards | 15 | other axis (`clubs1` list-membership convention) — not All-Australian |
| Hodge, Riewoldt | correct | omitted from `HALL OF FAME` × All-Australian, board #339 (2024) | 2 | board-time (inducted 2025) — not All-Australian |

Not one bridged player that AFLDB lists in an All-Australian team of 1983, 1984, 1986 or 1988 is
omitted by Gridley: every one is listed in **100%** of the `allAus1953` cells whose other axis they
satisfy (e.g. Rioli 49/49, Glendinning 68/68, Greene 67/67, Wiley 57/57, Hardie 61/61, Healy
70/70, Ablett 86/86, Frawley 49/49, McLean 47/47), and players with a single AFLDB season are
listed in **0** of their `allAus2x` cells while players with two or more distinct seasons are
listed in all of them. AFLDB therefore has **no extra selection** in those years; it is **missing**
selections.

**Conclusions for 1983 / 1984 / 1986 / 1988 (from the oracle and the source rows, not from labels):**

- **1984 — complete, both teams.** The 48 rows are two teams: 24 club-labelled rows (the VFL Team
  of the Year) and 24 state-labelled rows (Vic 9, WA 8, SA 5, NT 1, NSW 1: a State of Origin–based
  All-Australian team). Gridley counts **both**: WA-only 1984 members with no club row — Allen
  Daniels (29/29 cells), Murray Rance (27/27), Paul Harding (47/47) — are listed as All-Australians,
  as are the club-only members (Purser 48/48, Evans 49/49, Burns 41/41). Whether Gridley counts a
  player named in both 1984 teams as one selection or two **cannot be decided from the corpus**:
  all nine dual-listed players (Tuck, Flower, Madden, Daniher, Glendinning, Baker, Greene, Healy,
  Ablett, Ackerly) hold another season, and the three whose row count reaches 3 only through the
  pair (Baker, Greene, Ackerly) satisfy the other axis of none of the ten `allAus3x` cells.
  Distinct-season counting stays, with this recorded as an open ambiguity that only a 3x cell
  involving one of those three could settle.
- **1983, 1986, 1988 — one team each, and it is the carnival team.** AFLDB's rows for those
  seasons contain SANFL/WAFL players with no club (8, 11 and 4 rows: Bradley, Motley, Kevin Taylor,
  Peake, Jarman, MacNish, Keene, Wilson, Whittlesea, Long …) — the State of Origin carnival
  composition — and Gridley accepts every bridged one of them. The **VFL Team of the Year for
  1983, 1986 and 1988 is absent**: the 14 Gridley-listed players AFLDB lacks are all VFL players of
  exactly those years (Quinlan's 116-goal 1983, Brian Taylor's 100-goal 1986, Brereton, Kappler,
  Stretch, Mitchell, Anderson, Rhys-Jones in 1988 …). This matches the source's own shape: the
  `wikipedia` rows cover 1982, 1984, 1989 and 1990 — precisely the Team of the Year seasons that
  had **no** carnival — and `draftguru` covers the carnival seasons, so the years with both events
  got only the carnival team. Gridley's definition ("Includes VFL Team of the Year (1982–90), and
  State of Origin carnivals (1953–1988)") requires both.
- **1x / 2x / 3x, modern players:** exact. Every disagreement among bridged retired players traces
  to the three missing teams (or David Clarke 1972); the 1991+ rows produce no disagreement at all.

**Is the current All-Australian mapping exact?** The **builders and mapping are exact** for what
AFLDB holds: the final-team semantics, the distinct-season counting and the decade/position/squad
criteria all agree with Gridley's keys. **The family is not complete**, because the source lacks
three teams. Classification of the family: **AFLDB source missing required selection** — an
acquisition of the 1983, 1986 and 1988 VFL Teams of the Year (~60 rows) into
`data/awards/all-australian.csv` under the existing `wikipedia` provenance and key shape
(`aah:<season>:<player>:<club>`), with the parser's declared counts (`EXPECTED_TOTAL` 1,158,
`EXPECTED_BY_SOURCE`, `EXPECTED_LINKED`) bumped deliberately, plus a decision on the 1972 David
Clarke link. Not done in this session (Medium; acquisition is its own stage).

**Remaining unsupported count:** 26 criteria / 125 occurrences (unchanged this session); plus the
open data gaps that fail the strict run on this database (`heights`, draft links, marquee tags,
partial captaincies) and the three missing All-Australian teams, which the strict run cannot see
(they show only through the oracle, as `AFLDB source missing required selection`).

**Files:** `tests/integration/gridley-aa-oracle.test.ts` (new, opt-in). Typecheck and lint clean.

### 23.13 Exact next action (as recorded after §23.12 — superseded by §23.15)

1. **Stage AA3 — acquire the three VFL Teams of the Year (1983, 1986, 1988)** into
   `data/awards/all-australian.csv` (wikipedia provenance, `aah:` keys, parser expectations
   bumped), re-run `tools/migration/import_awards.py` on `afldb_dev`/`afldb_test`, then the oracle
   (`AFLDB_AA_REPORT=<file> npx vitest run tests/integration/gridley-aa-oracle.test.ts`) — expect
   the 14 "source missing" players to clear. Resolve David Clarke 1972 against the 1972 carnival
   team in the same pass.
2. **Fable High session** for Stage H2 (height acquisition and provenance, §23.5) and the
   schema/model families (§23.7); the oracle's fingerprint bridge (1,832 players) is the tool for
   the height answer-key comparison (7,216 Gridley ids need height; 195 of them name-bridged,
   more now fingerprint-bridged).
3. Strict corpus run stays red until the acquisitions land; closeout per §23.2.

### 23.14 Stage AA3 — the VFL Teams of the Year acquired (5 September 2026, third session)

**Scope as briefed:** the 1983, 1986 and 1988 VFL Teams of the Year. **Scope as executed:
1983, 1986, 1987 and 1988.** The source (below) names a VFL Team of the Year every season
1982–1990 except 1985, and AFLDB's 1987 rows are — like 1983/1986/1988 — the carnival team
(21 draftguru rows = the source's 1987 State of Origin team of 22 minus its coach; Jarman /
Rogers / McDermott / Salisbury with no club), while two of the §23.12 "source missing" players
(David Rhys-Jones, Steven Stretch) and Jim Krakouer's second selection are in the **1987** Team of
the Year and nowhere else. Leaving 1987 out would have left the family incomplete under the same
rule that made 1983/1986/1988 incomplete, so it is included and called out here.

**Source.** Wikipedia, *All-Australian team*, section "VFL/AFL Team of the Year: 1982–1990"
(`https://en.wikipedia.org/wiki/All-Australian_team`; raw wikitext fetched 2026-09-05 through
`?action=raw`). The section states: *"The AFL website recognises players who were named in the
VFL/AFL Team of the Year from 1982 to 1990 as having All-Australian status. This was a team picked
by Victorian selectors. Teams were named every season from 1982 to 1990, except 1985."* Each team
is an `{{Aussie rules team}}` template whose title is literally **"1983 VFL Team of the Year"**,
**"1986 VFL Team of the Year"**, **"1987 VFL Team of the Year"**, **"1988 VFL Team of the Year"**,
all citing one reference (`TOTYs`): HB Meyers, *The forgotten accolade – the VFL Team of the
Year*, The Mongrel Punt, 23 June 2023
(`https://themongrelpunt.com/footy-history/2023/06/23/the-forgotten-accolade-the-vfl-team-of-the-year/`).
The same article's "Australian Football Carnival era: 1953–1988" section holds the State of Origin
teams for 1983, 1985, 1986, 1987 and 1988 separately, so the source itself keeps the two honours
apart; the 1984 template in the same section is the team the bootstrap's 24 club-labelled
`wikipedia` rows already hold, which confirms the provenance is the same page. **No ambiguity:**
none of the 14 §23.12 players appears in a carnival team, and no carnival-only player appears in a
Team of the Year. Positions (template slots), the 1986 captain (Terry Daniher) and the coaches
(Jeans 1983/1986) are present in the source and **not carried**: `wikipedia` rows carry no
position, captaincy or note by the parser's contract (`POSITIONS` is the draftguru slot
vocabulary), and no coach row exists anywhere in the family. Recording those is a separate
contract change, not done here.

**Rows added (86, all `wikipedia`, key `aah:<season>:<player>:<club>`, `link_status`
`resolved`, `candidate_count` 1, no position / captaincy / note).** Player is the article's link
label verbatim (`Gary Ablett Sr.`, `Billy Picken`, `Steven O'Dwyer`); club is the template's
abbreviation expanded to the full club string the 1984 `wikipedia` rows already use (`Syd` →
`Sydney Swans`, `Foot` → `Footscray`, `WC` → `West Coast`, `NM` → `North Melbourne`, `St K` →
`St Kilda`, the rest their obvious names — all in `KNOWN_CLUBS`).

| Season | Size | Team (source order: B, HB, C, HF, F, followers, interchange) |
|---|---:|---|
| 1983 | 20 | Des English (Carlton), Gary Malarkey (Geelong), Gary Ayres (Hawthorn), Ken Hunter (Carlton), Ross Glendinning (North Melbourne), Russell Greene (Hawthorn), Robert Flower (Melbourne), Terry Wallace (Hawthorn), Geoff Cunningham (St Kilda), Tim Watson (Essendon), Terry Daniher (Essendon), Maurice Rioli (Richmond), Simon Madden (Essendon), Bernie Quinlan (Fitzroy), Leigh Matthews (Hawthorn), Mark Lee (Richmond), Michael Tuck (Hawthorn), Brian Royal (Footscray), Billy Picken (Collingwood), Mark Browning (Sydney Swans) |
| 1986 | 22 | Mark Thompson (Essendon), Gary Pert (Fitzroy), Gary Ayres (Hawthorn), Glenn Hawker (Essendon), Paul Roos (Fitzroy), Dennis Carroll (Sydney Swans), Doug Hawkins (Footscray), Greg Williams (Sydney Swans), Robert DiPierdomenico (Hawthorn), Gary Ablett Sr. (Geelong), Terry Daniher (Essendon), Gary Buckenara (Hawthorn), Wayne Blackwell (Carlton), Brian Taylor (Collingwood), Jim Krakouer (North Melbourne), Greg Dear (Hawthorn), Gerard Healy (Sydney Swans), Dale Weightman (Richmond), Craig Bradley (Carlton), Justin Madden (Carlton), John Platten (Hawthorn), Dermott Brereton (Hawthorn) |
| 1987 | 22 | Andrew Bews (Geelong), Chris Langford (Hawthorn), David Rhys-Jones (Carlton), Sean Wight (Melbourne), Paul Roos (Fitzroy), Mark Bos (Geelong), Robert DiPierdomenico (Hawthorn), Greg Williams (Sydney Swans), Steven Stretch (Melbourne), Wayne Johnston (Carlton), Stephen Kernahan (Carlton), Tony McGuinness (Footscray), Mark Bairstow (Geelong), Tony Lockett (St Kilda), Dale Weightman (Richmond), Justin Madden (Carlton), Gerard Healy (Sydney Swans), John Platten (Hawthorn), Simon Madden (Essendon), Russell Morris (Hawthorn), Jim Krakouer (North Melbourne), Ross Glendinning (West Coast) |
| 1988 | 22 | Gary Ayres (Hawthorn), Chris Langford (Hawthorn), Danny Frawley (St Kilda), John Worsfold (West Coast), Stephen Silvagni (Carlton), Brett Lovett (Melbourne), Darren Kappler (Fitzroy), Greg Williams (Sydney Swans), Craig Bradley (Carlton), Gary Buckenara (Hawthorn), Stephen Kernahan (Carlton), Peter Daicos (Collingwood), Dale Weightman (Richmond), Jason Dunstall (Hawthorn), Steven O'Dwyer (Melbourne), Simon Madden (Essendon), Gerard Healy (Sydney Swans), John Platten (Hawthorn), Shane Morwood (Collingwood), Dermott Brereton (Hawthorn), Matthew Larkin (North Melbourne), Barry Mitchell (Sydney Swans) |

The existing draftguru carnival rows for all four seasons are untouched; the two teams stay two
sets of rows (28 players are in both teams of their season, 23 of them under the same club
string).

**Player links.** `player_id` is the manifest's bootstrap id (legacy `afldb_dev.players.id`),
resolved by name against the bootstrap read-only and checked against the AFL Tables profile and
debut/final season: every one of the 63 distinct players resolved to **exactly one** bootstrap
player carrying an `afltables_profile_url` identity, so every row is `resolved` / 1. Seven of
them were not yet in `data/awards/player-identity.csv` (no earlier manifest referenced them) and
were censused: 686 Sean Wight, 1254 Shane Morwood, 1361 Steven ODwyer, 1391 Geoff Cunningham,
1400 Wayne Blackwell, 1403 Brian Taylor, 1708 Des English (`EXPECTED_ROWS` 1,738 → 1,745,
`with_identity` 1,720 → 1,727, the 18 no-identity players unchanged). Load outcome: **86 of 86 new
rows linked** on both databases (`afldb_test` 1,244 rows / 1,153 linked, was 1,158 / 1,067;
`afldb_dev` 1,244 / 1,153 — dev additionally reports bootstrap 1347 Matt Rendell as not uniquely
carried, pre-existing).

**Parser contract (`tools/migration/all_australian.py`).** `EXPECTED_TOTAL` 1,158 → **1,244**,
`EXPECTED_BY_SOURCE.wikipedia` 252 → **338**, `EXPECTED_LINKED` 1,078 → **1,164**; seasons, null
clubs, positions, captains and notes unchanged. The natural identity is now
**`(source, season, player, club)`**: `(season, player, club)` collides for the 23 players named
in both teams of one season under one club string (e.g. `Michael Tuck` / `Hawthorn` 1983 in
both), and those are two selections in two teams, not a duplicate. Legitimately duplicated
`(season, player)` pairs 10 → **38** (1983 7, 1984 9, 1986 6, 1987 9, 1988 6, 2016 1). Mirrored
in `tests/all-australian-source.test.ts`, `tests/player-identity-source.test.ts`,
`tests/integration/awards-reload-links.test.ts` (1,244 / 1,245 read / 1,164 / 338 / 38) and
`tools/db/rebuild-test.ts` (`allAustralian: 1244`). No builder, mapping or award-semantics
change.

**Oracle before / after (`afldb_test`, same corpus, same bridge method):**

| Measure | Before (§23.12 re-run this session) | After |
|---|---:|---:|
| fingerprint bridge / union bridge | 1,609 / 1,832 | 1,615 / 1,838 (0 disagreements both) |
| unbridged Gridley answer entries | 26,391 | 26,247 |
| board-time effect | 730 | 730 |
| other axis, not All-Australian | 636 | 639 |
| **AFLDB source missing required selection** | **315 entries / 14 players** | **11 entries / 1 player** |
| AFLDB source has extra non-Gridley selection | 65 | 65 (unchanged set) |

**The 14-player gap:** cleared for **13**. Jim Krakouer (1986 + 1987), David Rhys-Jones (1987),
Darren Kappler (1988), Steven Stretch (1987), Brian Taylor (1986), Dermott Brereton (1986 + 1988,
now 3x with 1985), Barry Mitchell (1988, 2x with 1991), Doug Hawkins (1986, 2x with 1984), Brian
Royal (1983, 2x with 1986), Bernie Quinlan (1983, 2x with 1984), Gary Malarkey (**1983** — the
"1980 or 1983" question in §23.12 is settled), Terry Wallace (1983, 3x with 1982/1988), Gary Pert
(1986, 3x with 1985/1989). (The briefing's "Simon Mitchell / Mark Royal / Gary Anderson / Peter
Malarkey / Stephen Pert" are these players under the §23.12 names.) **Not cleared: Greg Anderson**
(11 `allAus2x` entries). Gridley lists him as a 2x All-Australian; AFLDB holds 1993 (Adelaide)
only, and the source article lists him in exactly one team in 1982–2025 (1993) and in no carnival
team. On the evidence available this is a Gridley-side claim, not a source gap; it is **recorded,
not fixed**, and would need a second authoritative source naming a second selection before any row
is added.

**David Clarke 1972 — resolved, no data change.** The row links bootstrap 1895 → AFL Tables
`players/D/David_Clarke0.html`: born 31 December 1952, career 1971–1982 (the other candidate,
`David_Clarke1`, was born in 1980 and played 1999–2005). The source's 1972 carnival team lists
*David Clarke (Australian footballer, born 1952)*, Victoria, Geelong. The link is correct; Gridley's
answer keys omit him (48 cells). Classification changes from "source ambiguity" to **Gridley-side
omission**; the 65 "extra" entries are therefore all either this omission or other-axis /
board-time effects, none an AFLDB source error.

**The same-season double-selection count — now decided by the corpus.** Danny Frawley is named in
both 1988 teams and in no other season: 1 distinct season, 2 rows. He satisfies the other axis of
**7 `allAus2x` cells and Gridley lists him in 0 of them**, while every player with two distinct
seasons and a same-season double (Leon Baker 6/6, David Ackerly 4/4) is listed in all of theirs.
Gridley counts a player named in two teams of one season **once**. `all_australian_team_min_times`
(`count(DISTINCT season)`) is therefore exactly right and the §23.12 open ambiguity is closed for
the dual-team seasons; the 1984 club+state pair is the same shape (one season, two lists) and stays
on distinct-season counting.

**Validation executed (workstation, `afldb_test` through the 55432 tunnel):**

| Check | Result |
|---|---|
| `python tools/migration/all_australian.py` / `player_identity.py` | ok, 1,244 rows / 1,745 players |
| `tests/all-australian-source.test.ts`, `tests/player-identity-source.test.ts`, `tests/gridley-compat.test.ts`, `tests/grid-solver-spec.test.ts` | 91/91 |
| `tests/db-test-rebuild.test.ts` | 240/240 |
| `import_awards.py --groups all_australian` → `afldb_test`, then `afldb_dev` | 1,244 rows, 1,153 linked, 0 rejected, 3 s each |
| `tests/integration/grid-solver.test.ts` | 189/189 (final team ≠ squad, distinct-season X+ still holds with the new double rows) |
| `tests/integration/awards-reload-links.test.ts -t "all-australian manifest reload"` (needs `AFLDB_TEST_IMPORT_DATABASE_URL`, the import role on `afldb_test`) | 8/8 |
| `AFLDB_AA_REPORT=… tests/integration/gridley-aa-oracle.test.ts` | 16/16, ~55 s, table above; no timeout |
| `tsc --noEmit` | clean |
| `eslint` on the four touched TS files | 2 pre-existing `no-explicit-any` errors on untouched lines (`tests/player-identity-source.test.ts:43`, `tools/db/rebuild-test.ts:810`) and 1 pre-existing warning; nothing in this diff |

**Files:** `data/awards/all-australian.csv` (+86), `data/awards/player-identity.csv` (+7),
`tools/migration/all_australian.py`, `tools/migration/player_identity.py`,
`tests/all-australian-source.test.ts`, `tests/player-identity-source.test.ts`,
`tests/integration/awards-reload-links.test.ts`, `tools/db/rebuild-test.ts`, this runbook,
`issues.md`, `IssuesIndex.md`, `CHANGELOG.md`. Production untouched.

### 23.15 Exact next action

1. **All-Australian family: complete** for Gridley's definition (`AFLDB source missing required
   selection` = 11 entries, all Greg Anderson, documented above as Gridley-side; 0 AFLDB source
   errors). No further acquisition unless a second source names an Anderson selection. Optional,
   separate contract change: carry the Team of the Year positions / 1986 captaincy on `wikipedia`
   rows.
2. **Fable High session** for Stage H2 (height acquisition and provenance, §23.5) and the
   schema/model families (§23.7); the oracle's fingerprint bridge (now 1,838 players) is the tool
   for the height answer-key comparison.
3. Strict corpus run stays red until the height/draft/marquee/captaincy gaps land; closeout per
   §23.2. Production receives the 86 rows with the next deploy plus `import_awards.py --groups
   all_australian` (ISSUE-137 sequencing applies; not part of this stage).
