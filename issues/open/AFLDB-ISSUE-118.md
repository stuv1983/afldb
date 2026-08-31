# AFLDB-ISSUE-118 — Persist Gridley history and use it as a Grid Solver compatibility corpus

**Stage 0 investigation runbook.** This is the durable cross-session handoff document.
Stage 0 is investigation and design only. **No implementation was performed.**

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

## 19. Exact next action for Stage 1

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
