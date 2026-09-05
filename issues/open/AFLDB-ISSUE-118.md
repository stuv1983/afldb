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
| Model / effort | Fable 5.1, Medium (first three sessions); Fable 5.1, High (fourth session, §23.16–§23.18) |
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
| Model / effort | Fable 5.1, Medium (first three sessions); Fable 5.1, High (fourth session, §23.16–§23.18) |
| Databases touched | first session: none (tunnel down); second session (operator-run validation, then §23.12): `afldb_test` read-only; third session: `afldb_test` + `afldb_dev` (All-Australian rows); fourth session: migration 086 + heights on `afldb_test` and `afldb_dev`. **Production untouched.** |

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

### 23.15 Exact next action (as recorded after §23.14 — superseded by §23.18)

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

### 23.16 Stage H2 — heights acquired from the AFL Tables register (5 September 2026, fourth session, Fable High)

**Decision taken (the §23.5 "decision required").** Load the already-acquired AFL Tables
`player_details` register (snapshot `full-history-20260902`) through a reconciliation that never
consults AFLDB by name, rather than a ~13k-page per-player acquisition. The reconciliation is
closed-form because the *same snapshot's* `player_stats` files carry the AFL Tables profile URL —
the identity `external_identities` already stores (`afltables` / `afltables_profile_url`, 13,275
rows on `afldb_test`) — on every match row.

**H2.1 Reconciliation algorithm (`tools/migration/enrich_heights.py`).**

1. Every file read is sha256-checked against its tracked manifest
   (`docs/rebuild-manifests/afltables_fitzroy_core/<label>.json`) before anything else happens.
2. `player_stats` rows (129 full-history files + the tracked in-season `issue129-t7-20260903`
   file, because the register was captured on 2026-09-02 and its current players' games include
   2026) are folded per **(profile URL, register club)** into games (row count), goals (sum), the
   exact season set, the guernseys worn and the source's own spellings of the name. `Playing.for`
   is folded onto the register's club page only where the register itself does so
   (Footscray → Western Bulldogs, Kangaroos → North Melbourne, South Melbourne → Sydney, Greater
   Western Sydney → GWS); any other unknown club aborts.
3. A register row maps when **exactly one** aggregate has the same club, games, goals and season
   set **and** the register's normalised name equals one of that aggregate's names. Zero
   candidates → `unmatched`; several with the name → `ambiguous`; a unique fact match whose name
   is spelled differently on the two AFL Tables pages → `name_mismatch`. All three fail closed
   into `import_rejections` with the full source row. The guernsey is corroboration only
   (reported, never decisive: the register prints one number, the match rows several).
4. The profile URL is normalised to the `players/A/Name.html` form `external_identities` stores
   (`import_fitzroy_core.normalise_profile_url`, the same function) and looked up there. That is
   the only bridge to `players.id`. A URL with no canonical row is a rejection, not a guess.
5. Per canonical player, every mapped height is counted. Two distinct values → both kept as
   evidence, **no fill**, a `data_issues` row (`height_conflict`). One value: fill only where
   `players.height_cm IS NULL`; an existing equal value is an agreement; an existing different
   value is kept and opened as a `data_issue`. Unknown (blank or implausible `HT`) stays NULL.

**Ambiguity policy:** no name-only matching, no fuzzy matching, no arbitrary choice between
candidates or between heights; every non-mapped row is written to `import_rejections` with its
reason; the run is idempotent (evidence upserted on `(player_id, source_id, height_cm)`, fill
touches only NULL, an open data_issue is not duplicated).

**Provenance / write model (H2.3).** Migration `086_player_height_evidence.sql`, the smallest
forward-only change, mirrors 018: `player_height_evidence` (player, source, external_id = profile
URL path, height_cm CHECK 120–230, evidence_type `afltables_player_details_register`, confidence,
occurrences, batch, notes; UNIQUE per player/source/height) and `players.height_evidence_id`;
registered through `grant_app_read` / `grant_import_write` so `privileges.sql` reconciles it. The
`player_bio` ingest dataset (admin upload, COALESCE) remains the manual path and is untouched; a
value it sets has `height_evidence_id` NULL, which is how a hand-entered height is told apart. The
draft-day `draft_picks.height_cm` is still not used as a substitute.

**Reconciliation report (source side, identical on every run):**

| Measure | Count |
|---|---:|
| register rows | 16,731 |
| rows with a height | 15,888 |
| (url, club) aggregates | 16,734 |
| **mapped** | **16,713** |
| unmatched (games/goals/seasons fit no aggregate) | 9 |
| ambiguous | 0 |
| name mismatch (facts unique, spelling differs: Jonathon/Jonathan Ross, Steven/Stephen Icke ×2, Jack Patterson/Paterson ×2, Glenn/Glen Scanlon ×2, Lyle/Lyall Anderson, Norman Paternoster) | 9 |
| mapped rows with a height | 15,870 |
| distinct profile URLs with a height | 12,580 |
| **URLs asserting two heights** | **0** |
| guernsey corroboration checked / disagreeing | 14,639 / 9 |

Without the in-season supplement the same run maps 14,400 + 1,647 and leaves 675 current players
unmatched (their 2026 games are in the register and not in the full-history rows) — measured
first, which is why the supplement label is an explicit, manifest-verified input.

**Canonical side on `afldb_test` (batch 165, then batch 166 as the idempotence proof):**

| Measure | Batch 165 | Batch 166 (re-run) |
|---|---:|---:|
| mapped rows with no canonical player (all 92 are 2026 debutants; `afldb_test` holds no 2026 identities) | 92 | 92 |
| canonical players receiving height | **12,487** | 0 |
| already present and agreeing | 0 | 12,487 |
| disagree with existing value / two heights for one player | 0 / 0 | 0 / 0 |
| evidence rows / rejections | 12,487 / 110 | 12,487 (upserted) / 110 |

State after: `players` 13,273, `height_cm` 12,487 (min 155, max 211, mean 181.8), every filled
height linked to the evidence row that justified it (link consistency 0 mismatches, 0 unlinked),
≥195 cm 697 players, ≤180 cm 6,072, `data_issues(height_conflict)` 0. 786 players remain NULL:
the register has no height for 843 rows (pre-war players mostly) and 18 rows failed closed.

**H2.2 Gridley coverage (`tests/integration/gridley-height-oracle.test.ts`, opt-in
`AFLDB_HEIGHT_REPORT`, `AFLDB_HEIGHT_PLANNED=<dry-run report>` for the before-apply measure).**

| Measure | Before apply (planned) | After apply |
|---|---:|---:|
| height criteria / cells | 2 / 426 | 2 / 426 |
| distinct Gridley answer-key players | 7,216 | 7,216 |
| bridged to AFLDB (name ∪ fingerprint bridge) | 774 | 941 (the height cells now feed the fingerprint) |
| bridged with an authoritative height | 0 (774 planned) | **941** |
| bridged **missing** height | **0** | **0** |

The source covers every bridgeable Gridley height-key player. The unbridged remainder is the
oracle's limit (a Gridley id seen in fewer than two usable cells cannot be fingerprinted), not a
height gap: the corpus regression's `heights` probe is now true.

**H2.5 Height oracle — answer-key comparison (420 usable height cells).** False positives and
false negatives reported separately:

| Kind | Entries | Classification |
|---|---:|---|
| false negative (Gridley lists, AFLDB does not) | 3,730 | **AFLDB height fails the bound** — 48 distinct players on `height195` (AFL Tables 194 cm ×34, 193 ×9, 192 ×4, 189 ×1) and 35 on `height180` (181 ×33, 182 ×2) |
| false negative | 279 | other axis only (height satisfied) — the ISSUE-118 board-time / list-membership differences already documented |
| false negative | 39 | fails the bound + other axis |
| false positive (AFLDB lists, Gridley omits) | 171 | board-time effect (player active after the board date) |
| false positive | 55 | 6 distinct players: Brian Roberts 199 / Ken Beck 198 (1960s–70s, Gridley evidently has no height for them) and Jed Anderson, Bradley Hill, Liam Ryan 179 / Malcolm Rosas 175 |

**What the 83 disagreeing players are.** All are 1997+ debutants. Gridley counts them at ≥195 /
≤180 while AFL Tables says 189–194 / 181–182. Wikipedia's infobox agrees with **AFL Tables**, not
Gridley, for the three probed this session (Charlie Curnow 194, Dylan Grimes 193, Brodie Smith
189 — Gridley lists Smith as 195+ in 48 cells). So Gridley's height data is a third source (most
likely the AFL website's current listed heights, which this session could not fetch — the
player URLs return 404 unauthenticated), and AFLDB's answer is exact for its authoritative source.
This is a **source difference, recorded here, not an AFLDB defect and not a data gap**; no test
was weakened for it. Whether AFLDB should also hold the AFL API's listed height as a second
evidence source for current players (the §23.5 row: `fetch_player_details_afl`, `heightInCm`,
stable `providerId`, no `afl_api` identity bridge yet — migration 077's comment) and which
source wins when they differ is an **operator decision**; the evidence table is built to hold
both without overwriting either.

**Applied to DEV (`afldb_dev`)**: migration 086 + `privileges.sql`, then the same two runs —
batch 96 filled **11,740** players (932 rejections: the same 18 fail-closed rows and 914 rows whose
profile URL has no canonical identity on DEV — 905 of them pre-2026 Fitzroy / University /
Brisbane Bears / South Melbourne-era players, because `afldb_dev` holds only 12,472 `afltables`
identities against `afldb_test`'s 13,275, the ISSUE-090/137 identity split), batch 97 re-run 0
filled / 11,740 agreeing. Two DEV players (Fred Rodriguez 184, Riley Onley 194) already carried a
hand-entered height with no evidence row; both untouched, `height_evidence_id` NULL as designed. Production untouched.

**Validation executed (workstation, `afldb_test` through the 55432 tunnel):**

| Check | Result |
|---|---|
| `tests/height-reconciliation.test.ts` (pure reconciliation on synthetic rows, through the interpreter) | 6/6 |
| `tests/db-promotion-check.test.ts` (new football table pinned; **also pins `external_grid_*` from 080, which had never been classified — a pre-existing red on main**) | 37/37 |
| `tests/gridley-compat.test.ts` | pass (data-absent pin unchanged: the height ids were already `mapped`) |
| `npm run db:migrate:test` | 086 applied (**and 080, ISSUE-118's own external-grids migration from main, which had never reached `afldb_test`** — additive, non-canonical tables) |
| `enrich_heights.py --dry-run` → apply → re-run | tables above |
| `tests/integration/gridley-height-oracle.test.ts` before and after | 16/16 each, ~65 s |
| `tests/integration/grid-solver.test.ts` | 189/189 (height NULL semantics now hold over 12,487 real values) |
| `AFLDB_GRIDLEY_DIAGNOSTIC=1 tests/integration/gridley-corpus.test.ts` | **1,163/1,164**, 0 timeouts, 0 cells over the 4 s guard; cells solved 9,141 → **9,560**; `dataset gap` 773 → **354** (the `heights` probe is true; what remains is draft links / marquee tags / post-2025 boards); `unsupported` 375 (26 criteria) and `partial dataset` 506 unchanged; **`incorrect known answer` 299** — every one a height cell, 9 distinct name-bridged retired players (afldb 10175, 9771 Nathan Brown, 10878 Reece Conca, 12659, 4766, 4002 Dylan Grimes, 3258, 2109 Brandon Ellis, …), the retired subset of the 83 source disagreements above. The one failing test is the no-failing-cells gate on exactly those 299; a strict run fails on the same cells plus the draft / marquee / captaincy gaps |
| `npx tsc --noEmit`, `eslint` on the six touched TS files | clean |

**Side finding in the All-Australian family (from the larger bridge).** With the height cells usable the union bridge grew from 1,838 to 2,162 players, and the refactored AA oracle (output otherwise unchanged: 791 sets, 9,798 cells, 0 bridge disagreements) now reports `AFLDB source missing required selection` = **76 entries / 2 players**: Greg Anderson (11, §23.14, Gridley-side) and **Tony Buhagiar (65 cells, `allAus1953`)**. AFLDB *has* his row — `aa:1979:20` in `data/awards/all-australian.csv`, the 1979 carnival team — but its link is `implausible` because 1979 precedes his VFL debut (1981, a state-league selection). Gridley counts a pre-VFL state selection for a player who later played VFL. Not an acquisition gap: a link-rule decision for pre-debut state-league selections, recorded in §23.18.

**Not done, deliberately.** The `db:test:rebuild` stage plan (`tools/db/rebuild-test.ts`, pinned
by `tests/db-test-rebuild.test.ts`) does **not** yet run the height stage, so a rebuild of
`afldb_test` would drop the heights until it is re-run by hand. Adding it means binding a second,
in-season snapshot label into the rebuild's "no acquisition, tracked inputs only" doctrine
(§10 order, ISSUE-111/112/113 admissions) — an operator decision on which label and where the
in-season snapshot must live, recorded in §23.18 as the next action rather than taken here.

**Files:** `src/db/migrations/086_player_height_evidence.sql`, `tools/migration/enrich_heights.py`,
`tests/height-reconciliation.test.ts`, `tests/integration/gridley-oracle-bridge.ts` (the
criterion-set / cell / bridge scaffold extracted unchanged from the AA oracle),
`tests/integration/gridley-aa-oracle.test.ts` (now imports it; output unchanged),
`tests/integration/gridley-height-oracle.test.ts`, `tests/db-promotion-check.test.ts`,
`src/search/gridley-compat.ts` (comment), this runbook, `issues.md`, `IssuesIndex.md`,
`CHANGELOG.md`.

### 23.17 The remaining 26 unsupported criteria, grouped by what each family needs

Inspected on `afldb_test` and in the tracked sources this session (5 September 2026). The
classifications use the brief's vocabulary. Occurrence counts are §23.7's.

| Group | Gridley ids (occ.) | Classification | Evidence | What lands it |
|---|---|---|---|---|
| **Named medals** | `moty` (7), `goty` (3), `showdown-medal` (5), `anzacmedal` (3), `glendenning` (2), `qclash-medal` (1), `battleofthebridge-medal` (1) — 22 | **existing source path, rows not acquired** | `tools/migration/named_medals.py` + `data/awards/named-medals-definitions.csv` / `named-medals.csv` already carry 17 medals (979 rows, Wikipedia-cited, identity through `player-identity.csv`); none of these seven is defined | seven definition rows + the Wikipedia list pages transcribed into `named-medals.csv`; `award_winner` builders already exist; no schema |
| **Captaincy gaps** | `captain` / `premcaptain` partial-data failures (506 checks) | **existing source path, rows not acquired** | `data/awards/captaincies.csv` (1,375 rows) has no Geelong, Hawthorn, West Coast, Fitzroy, University or Brisbane Bears rows | same transcription path as the 18 clubs present; no schema |
| **Age on debut / DOB** | `debut22` (1) | **existing table merely unpopulated (test-only lag) + builder** | `players.dob` 855 / 13,273 on `afldb_test`; the birth-evidence path (018/072, `enrich_birth_dates*.py`) recovered ~12,000 dates on the legacy build and is not a rebuild stage | run the DOB enrichment as a tracked stage (same decision as the height stage, §23.16 item 3), then an `age_on_debut_min` builder over `dob` and the debut match date |
| **Siblings / father–son** | `brother` (53), `fathersonfather` (3) — 56 | **acquisition required; tables exist** | `player_relationships` (006) 0 rows, `father_son_selections` (006) 0 rows; `draft_picks.signing_kind` names the son only | AFL Tables player pages list "Brother of / Son of" relations keyed by the profile URL AFLDB already holds — a ~13k-page acquisition, or the DraftGuru father-son index for the 3-occurrence case; then `sibling_played` / `father_of_father_son` builders |
| **Coaches** | `premcoach` (4), `coachedByWorsfold` … `coachedByMatthews` (12) — 16 | **schema required + acquisition** | no coaching entity; the fitzRoy `player_stats` rows carry a per-match `Coach` column (e.g. "Bolton, Brendon"), so the snapshot already names every match coach 1897–2026 | a `coaches` / `coaching_tenures` model derived from the snapshot's per-match coach column (no new acquisition), then `coached_by` and `premiership_coach` builders |
| **Season-list membership** | `season2024player` (14) | **schema required + acquisition** | no club-list-per-season model; the AFL API list acquisition (probe P4) gives current lists only | a `club_season_lists` model; 2024 needs a historical list source (AFL Tables per-season club pages carry the played list, not the full list) — the "played in 2024 for the club" approximation is a documented semantic difference, not the criterion |
| **Birthplace / state / nationality** | `irish` (2), `tasmanian` (1) — 3 | **schema required + acquisition** | no birthplace column on `players` (checked) | a birthplace/nationality column with evidence; source per player not free in bulk — DraftGuru person pages for drafted players, Wikipedia infoboxes otherwise |
| **International Rules / NFL** | `intrulesplayer` (5), `nfl` (1) — 6 | **schema required + curated source** | no representative or other-code career model | small curated CSVs (Wikipedia squad lists) into a `representative_selections` table + builder |
| **After-the-siren** | `winaftersiren` (4) | **fundamentally unavailable (free)** | no scoring-event timeline in any source AFLDB uses; AFL Tables has no play-by-play | only a curated list (Wikipedia "after the siren" article) could answer it — a curated-source decision, not an acquisition |
| **Recruiters** | `recruitedByDodoro` (2) | **fundamentally unavailable** | no structured source names a recruiter per player | curated-list decision or accept as Gridley-only |
| **Spoils** | `spoils5season` (1) | **fundamentally unavailable** | Champion Data statistic, not in any free source | accept as Gridley-only |
| **Test dataset lag** | draft links / marquee tags (`dataset gap` findings) | **test-only dataset lag** | `draftLinks` false / `matchEvents` false on `afldb_test` (§23.12 probes) | a rebuild that includes the draft-link decisions and marquee events, no code |

**Recommended order (safest first).** (1) Named medals and the six missing captaincy clubs:
tracked CSV transcription through importers that already exist, zero schema, and together they
retire 22 criterion occurrences plus the 506 partial-data checks. (2) DOB as a tracked stage plus
the `age_on_debut_min` builder: the evidence path exists. (3) Coaches from the snapshot's own
per-match coach column: one migration, no acquisition, 16 occurrences. (4) Siblings / father–son
from AFL Tables player pages keyed by the profile URL: the largest single family (56) and the only
one needing a new page acquisition. (5) Season lists, birthplace, representative careers: each
needs a model decision. (6) After-the-siren, recruiters, spoils: record the curated-source or
Gridley-only decision explicitly so the corrected contract (§23.2) can be met by *proof*, not by
silence.

### 23.18 Exact next action (as recorded after §23.16 — superseded by §23.22)

1. **Height family — decide Gridley's source.** AFLDB now answers both height criteria exactly
   from AFL Tables; the oracle disagrees on 83 bridged players whose Gridley height differs from
   AFL Tables (and from Wikipedia where probed). Next: acquire the AFL API listed heights
   (`fetch_player_details_afl`, `heightInCm` + `providerId`) as a **second evidence source** for
   current-list players, compare them with the 83, and take the operator decision on precedence
   (AFL Tables vs AFL listed height) — `player_height_evidence` already holds both without
   overwriting. Until that decision the corpus regression fails on those cells as `incorrect known
   answer` (diagnostic and strict alike); it must not be reclassified without the evidence.
2. **Rebuild stage.** Admit `enrich_heights.py` to `tools/db/rebuild-test.ts` after `fitzroy`
   (needs the operator's choice of the tracked in-season label to bind and where that snapshot
   lives), and update the `tests/db-test-rebuild.test.ts` order pins with it.
3. **Then the families in §23.17's order**: named medals + captaincy clubs (transcription only),
   DOB stage + `age_on_debut_min`, coaches from the snapshot's per-match coach column, siblings /
   father–son, the model decisions, the curated-source decisions.
4. **All-Australian link rule:** decide whether a pre-VFL-debut state-league selection (Tony
   Buhagiar, `aa:1979:20`, link `implausible`) counts — Gridley says yes; 65 `allAus1953` cells.
5. Production receives migration 086 and `enrich_heights.py` with the next deploy (ISSUE-137
   sequencing applies; prod's identity coverage must be measured with `--dry-run` first — the DEV
   run shows what a legacy-lineage identity set does to the fill count).

### 23.19 Stage H3/H4 — height source precedence decided on evidence; heights admitted to the rebuild (5 September 2026, fifth session, Fable High)

**Correction to §23.16.** That section said the 83 disagreeing players were "all 1997+ debutants" and that
Wikipedia agreed with AFL Tables for Charlie Curnow at 194 cm. Neither holds: the 83 span debuts from 1971
(Rod Galt) to 2025, and the register (`player_details.csv`, both Curnow rows) says **192**, so the Wikipedia
194 was agreeing with the AFL's own listing, not with AFL Tables.

**H3.1 Second source acquired — the AFL API season rosters.** `tools/rebuild/afl_api/acquire_rosters.R`
(new; contract block `roster` in `tools/rebuild/afl_api/afl-api-contract.json`; source-family shape already
declared as `afl_api`/`roster` from probe P4) acquires every AFL men's club list for each season of an explicit
`--from/--to` range through `fetch_player_details_afl(season = S, team = NULL, current = TRUE)` once per season.
Measured mechanics, binding for the pinned fitzRoy 1.8.0: `current = TRUE` with a past season returns THAT
season's list (2012, 2015, 2019 probed); `current = FALSE` expands the season to `2012:S` and fails inside
`dplyr::mutate` for every S > 2012, so it is never called; the API holds nothing before 2012 (2010 returned
nothing) and `--from < 2012` is refused rather than written as an absence. Snapshot **`rosters-20260905`**
(tracked manifest `docs/rebuild-manifests/afl_api/rosters-20260905.json`; raw JSON gitignored under
`data/sources/afl_api/rosters/`): 15 seasons 2012–2026, 12,263 rows, 18 teams every season, 2,395 distinct
`providerId`s, 2,393 with a height, one 0 cm row (zero-as-missing → NULL). The listed height is **one constant
per profile replicated to every season** (0 of 1,824 mapped players vary): the API serves the current listing,
not the height a player was listed at in a given year.

**H3.2 Identity, fail-closed, no `external_identities` write.** `tools/migration/enrich_heights_afl_api.py`
(new) verifies every artefact against the tracked manifest, then reconciles each `providerId` to at most one
canonical player over the canonical match facts `fitzroy` loaded (`player_match_stats ⋈ matches ⋈
clubs.organization_id`): rule 1, same normalised name AND a shared (club organisation, season); rule 2, only when
rule 1 finds nobody, same surname AND the same guernsey in a shared (club, season) — the API prints formal given
names ("Timothy", "Mitchell", "Cameron") where AFL Tables prints "Tim", "Mitch", "Cam". Apostrophes are stripped
before comparing (the API's curly apostrophe is dropped by NFKD, AFL Tables' straight one becomes a space).
Several candidates under either rule → ambiguous; a player claimed by two `providerId`s → both refused. On the
rebuilt `afldb_test`: **1,824 mapped** (1,751 rule 1, 73 rule 2), **571 unmatched** (list members who never
played a senior game), **0 ambiguous**; guernsey corroboration 1,824 checked, 2 disagree (reported only).
`providerId` is kept in `player_height_evidence.external_id`; the secondary `external_identities` row the
source-family note contemplates is left to the roster family's own issue.

**H3.3 AFL API against AFL Tables (1,824 shared players).** Latest listing == canonical **1,123**; differs
**701** (deltas API − AFL Tables: −1: 148, −2: 40, −3: 13, −4: 7, −5: 1, −7: 2, −8: 1, −9: 2; +1: 274, +2: 123,
+3: 45, +4: 16, +5: 7, +6: 2, +7: 1, +9: 1); canonical NULL with API evidence **2** (afldb 6519 at 187, 6619 at
198; reported, **not filled**). 38% of shared players differ with a systematic +1/+2 cm skew in the AFL
listing: a different measurement convention, not a sprinkling of errors — neither source can be shown wrong
from the other.

**H3.4 Third source, targeted — Wikipedia infobox heights for the adjudication set only.** For the 89
players in the height oracle's disagreement lists (83 false negatives + 6 false positives), the infobox
`height` was read through the Wikipedia API (title, revision id, timestamp recorded) into the tracked artefact
**`data/players/height-evidence-wikipedia.csv`** (83 rows; keyed by the AFL Tables profile path, never by
name). Absent: Nathan Brown (afldb 9771 — two Nathan Browns born 1978 both debuted in 1997, the article cannot
be tied to him without a stable key) and Max Crow, Brad Hardie, Stuart Anderson, Peter Mann, Stephen Powell
(no infobox height). `tools/migration/enrich_heights_wikipedia.py` (new) loads it as evidence (source
`wikipedia`, `wikipedia_infobox_height`), refusing the whole file if any profile fails to resolve. **60 of 83
agree with AFL Tables exactly.** A targeted corroboration set, not a Wikipedia height acquisition.

**H3.5 The comparison the brief asked for (89 disagreement players).**

| Measure | Count |
|---|---:|
| disagreement players total | 89 (83 Gridley-lists/AFLDB-omits, 6 the reverse) |
| AFL API covered | 56 |
| AFL API == AFL Tables (exact cm) | 30 |
| AFL API on Gridley's side of the bound | 10 (8 false negatives, 2 false positives) |
| AFL API differs from AFL Tables but sits on AFLDB's side of the bound | 16 |
| AFL API unavailable (retired before 2012) | 33 |
| Wikipedia covered / == AFL Tables (exact cm) | 83 / 60 |
| all three sources equal | 0 — by construction (Gridley is on the other side of the bound from AFL Tables for every one) |
| Gridley agrees with **no** source AFLDB can acquire | 18 of the 56 API-covered players (Bontempelli 193/194/194 vs ≥195, Grimes 193/194/193, Curnow 192/194/194, Walker 193/192/194 …) |

Per-player: AFL Tables / AFL API / Wikipedia against the bound, source-side classification (rule in H3.6):
**70** external-source-disagreement; **13** source-conflict with a source on Gridley's side (Charlie Cameron
181/180/178 ≤180; Himmelberg 194/195/195, Ugle-Hagan 194/197/197, Ridley 192/195/195, Treacy 193/195/195, Cordy
193/195/195, McCartin 194/195/195 ≥195; Rosas 175/180/180; Scott Harding 181/–/178; Scott Stevens 194/–/195;
Brent Moloney 181/181/182; Corey Wagner 181/181/180; Bradley Hill 179/182/–, Jed Anderson 179/182/–, Liam Ryan
179/181/–); **6** with no independent source (Nathan Brown, Max Crow, Brad Hardie, Stuart Anderson, Peter
Mann, Stephen Powell).

**H3.6 Decision — source precedence (evidence-backed, independent of Gridley).**

1. **The AFL Tables `player_details` register is the canonical authority for `players.height_cm`.** It
   covers the population (12,487 of 13,273 players, one value each), joins through the identity model AFLDB is
   built on, and is corroborated exactly by the AFL listing for 1,123 of 1,824 shared players and by Wikipedia
   for 60 of 83 checked. The AFL listing differs on 38% of shared players with a systematic skew and is a single
   current value per profile; adopting it for the 1,824 players it covers and the register for the other
   11,000 would make the column measure two different things. **No canonical height was changed.** The 2
   NULL players with API-only evidence stay NULL (a fill from a corroborating source is a separate decision).
2. **The AFL API roster listing is corroborating evidence**, loaded on every rebuild, never overwriting, never
   filling.
3. **Wikipedia is targeted corroboration** for the adjudication set, loaded on every rebuild from the tracked
   artefact.
4. **Gridley is an external oracle only.** Its height source is none of the three (H3.5) and cannot be acquired,
   so its cells are classified by `tests/integration/gridley-corpus.test.ts` from AFLDB's own evidence rows
   (`player_height_evidence` from any source but `afltables`):

   | Category | Rule | Counted as |
   |---|---|---|
   | `external source disagreement` | every independent source sits on AFLDB's side of the bound, none on Gridley's | informational (reported, never failed) |
   | `source conflict` | an independent source sits on Gridley's side, **or** no independent source exists | data gap (fails strict, counted in diagnostic): AFLDB keeps the AFL Tables value but its answer is not proven, so the cell stays open |

   Nothing was reclassified to make a test green: every open cell names the source that would have to be
   adjudicated.

**H3.7 Corpus regression after the decision** (`afldb_test` rebuilt from scratch — see H4 — with the Family A
medals loaded, diagnostic run, 1,164/1,164): cells solved 9,626 of 10,287; `incorrect known answer` **299 →
0**, replaced exactly by `external source disagreement` **197 cells / 6 players** (Reece Conca 10878 38, Tom
Scully 12659 38, Gavin Wanganeen 4766 36, Dylan Grimes 4002 32, Daniel Wells 3258 27, Brandon Ellis 2109 26 —
each with AFL API and/or Wikipedia on AFLDB's side) and `source conflict` **102 cells / 3 players** (Paddy
McCartin 10175 44 cells: AFL API 195, Wikipedia 195 on Gridley's side; Jamarra Ugle-Hagan 6700 18 cells: 197 /
197; Nathan Brown 9771 40 cells: no independent source). `unsupported` 375 → **309**, `dataset gap` 354,
`partial dataset` 506 (before Family B, §23.21), `time of board` 14,061, `list membership` 836, timeouts 0.
Height oracle (`gridley-height-oracle`) 16/16; `grid-solver` 189/189.

**H4 Rebuild — heights survive from scratch, manifest-pinned, no worktree dependency.**

* `tools/db/rebuild-test.ts` gains three DATA stages directly after `fitzroy`: `heights`
  (`enrich_heights.py --label <accepted baseline> --supplement-label …`), `heights-afl-api`
  (`enrich_heights_afl_api.py --label <accepted roster>`), `heights-wikipedia`
  (`enrich_heights_wikipedia.py --csv data/players/height-evidence-wikipedia.csv`). None acquires, none reads
  the legacy SQLite; each reads a tracked manifest or a tracked artefact.
* **How the in-season supplement is selected:** pinned, never defaulted, in the fitzRoy contract
  (`datasets.player_details.height_enrichment.supplements`: label, tracked manifest, SHA-256 of the manifest's
  canonical LF bytes, reason — the register was captured 2026-09-02 and counts 2026 games the 2025-terminal
  baseline cannot supply). The register itself is the accepted baseline's own `player_details.csv`. The AFL API
  roster is pinned the same way in `afl-api-contract.json` (`roster.accepted_snapshot`). A later capture is a
  successor decision recorded by editing the pin, exactly like the ladder witness.
* **Fail-closed preflight** before destruction: the pin readers refuse on a missing or mismatched manifest;
  `enrich_heights.py --validate-only` (new flag), `enrich_heights_afl_api.py --validate-only` and
  `enrich_heights_wikipedia.py --validate-only` re-prove every artefact hash / the artefact's shape. Snapshot
  bytes live under `data/sources/…` of the checkout running the rebuild (this session junctioned them from the
  issue-102/-129 worktrees; nothing in the runner names another worktree).
* **Final validation** gates: `players_with_height = 12,487`, `height_without_evidence = 0`,
  `height_conflicts_open = 0`, `players_with_afl_api_height_evidence = 1,824`,
  `players_with_wikipedia_height_evidence = 83` (the artefact's row count; the loader refuses unless every row
  resolves).
* `tests/db-test-rebuild.test.ts`: order pins (13 → 16 stages, 10 data stages), a `height enrichment` block
  (argv derivation, ordering, refusal on a tampered pin hash, preflight refusal, gate keys): 246/246.

**H4 validation, honestly.** `npm run db:test:rebuild --acknowledge-destroy afldb_test --draftguru-label
annual-html-20260902` was run detached from this worktree (08:20–11:10, the fitzRoy stage dominating through
the 55432 tunnel). It reset `afldb_test`, ran migrations/privileges/reference/fitzroy and then **the two new
height stages exactly as planned: batch 7 filled 12,487 with 12,487 evidence rows and 110 rejections; batch 8
wrote 1,824 AFL API evidence rows** — the rebuild reproduces the hand-run numbers to the row. It then **failed
at `awards-honours`** because this session edited `named_medals.py`'s declared row count (Family A, §23.20)
while the run was in flight — an operator error of this session, not a runner defect. The `heights-wikipedia`
stage was added after that launch and is therefore not yet proven by an unattended run. The remaining stages
were then executed by hand with the runner's own argv, in its order (`enrich_heights_wikipedia.py`,
`import_awards.py --groups all_australian under_22 rising_star club_bf named_medals hall_of_fame honour_teams
captaincies`, `import_brownlow_season.py`, `rebuild_derived.py`, `import_awards.py --groups coleman`,
`validate_ladder_witness.py --label ladder-20260828 --compare` → "All checks passed"), and the runner's
`finalValidationSql()` was executed through `psql`: **PASSED, 53 checks**, including all five height gates
above. **A clean unattended `db:test:rebuild` of the complete 16-stage graph is the first item of §23.22.**

**Applied to DEV (`afldb_dev`)**: `enrich_heights_afl_api.py` batch 98 (1,842 players; DEV maps 6 by the
guernsey rule instead of 73 because its legacy-lineage `player_match_stats` carries few guernseys; 10
canonical-NULL players reported), `enrich_heights_wikipedia.py` batch 99 (83 rows, 60 agree / 23 differ).
Production untouched.

### 23.20 Family A — the seven Gridley named medals (5 September 2026, fifth session)

**Semantics verified against Gridley's own descriptions:** Anzac (best on ground, Collingwood–Essendon Anzac
Day), Showdown (Adelaide–Port Adelaide), Glendinning–Allan (West Coast–Fremantle Western Derby), Brett Kirk
(Sydney–GWS; renamed Kirk–Ward Medal upstream in 2026, kept under Gridley's name), Marcus Ashcroft
(Brisbane–Gold Coast QClash), Goal of the Year ("since 1976"), Mark of the Year ("includes the Channel Seven and
ABC awards 1970–2000"). Source: the Wikipedia winner lists (dedicated medal pages for the five derby medals,
the Goal/Mark of the Year pages), read through the Wikipedia API on 2026-09-05 and transcribed — no winner was
taken from Gridley.

**Rows:** 7 definitions appended to `data/awards/named-medals-definitions.csv` (category `award`, competition
`AFL`, last_season 2025 like every ongoing award) and **328 winner rows** appended to
`data/awards/named-medals.csv` (Glendinning–Allan 64, Mark of the Year 63, Showdown 58, Goal of the Year 56,
Anzac 30, Marcus Ashcroft 29, Brett Kirk 28), `source_citation` **`wikipedia`**, `link_status` `unique`, note =
the occasion ("Round 4", "Anzac Day", "Channel Seven award" / "ABC award"). Every 2026 winner (9 rows) was
deliberately excluded: the family's declared span ends at 2025 and the season rollover owns the 2026 curation.
Identity: each winner resolved fail-closed to one canonical player by normalised name + played for the club
organisation in that season (337 of 337 after seven reviewed spelling equivalences recorded in the session:
Jeasualenko→Jesaulenko, Billy→Bill Picken, Monkhurst→Monkhorst, Matthew→Matt White, Rod→Rodney Ashman,
Michael→Mick Conlan, "Jr."/"Sr." suffixes dropped); **35 players added to `data/awards/player-identity.csv`**
with their AFL Tables profile (Mick Conlan's from the snapshot's own 1983 rows, DEV lacking that identity).

**Code:** `tools/migration/named_medals.py` — declared coverage 979 → **1,307** rows, 17 → **24** awards,
seasons 1970–2025 (56 distinct), 1,191 linked, 1,109 with a note; `source_citation` vocabulary
{draftguru, wikipedia}; the natural-identity guard now includes the occasion for per-match medals and the
1970–2000 dual awards (Luke Parker won both 2022 Sydney derbies; Geoff Raines won both 1982 Marks of the Year).
`tools/migration/import_awards.py` writes each winner under its own row-level provenance (`source_ids[...]`)
and scopes the reload to both sources. `src/search/gridley-compat.ts`: the seven ids (`anzacmedal`,
`showdown-medal`, `glendenning`, `battleofthebridge-medal`, `qclash-medal`, `goty`, `moty`) map to
`award_winner` on the new slugs; `tests/gridley-compat.test.ts` denominators 812 → **819 mapped distinct**,
data-absent **26 → 19 criteria / 125 → 103 occurrences**; `tests/named-medals-source.test.ts`,
`tests/player-identity-source.test.ts` (census 1,745 → 1,780) re-pinned; `tools/db/rebuild-test.ts`
`AWARDS_HONOURS_EXPECTED` 979 → 1,307 medal rows, 39 → 46 definitions.

**Loaded:** `afldb_test` — all 328 rows linked (30/28/64/56/29/63/58 per award, every row with a player);
`afldb_dev` — 1,307 rows, 1,185 linked (Mick Conlan unlinked on DEV, the identity split). Corpus after:
`unsupported` 375 → 309 (the 22 medal occurrences × 3 cells); the named-medal cells now compare against
Gridley's keys under the ordinary rules.

### 23.21 Family B — captaincies for the six missing club lineages (5 September 2026, fifth session)

**State: complete in this checkpoint** — tracked files, loader pins, tests, `afldb_test` and `afldb_dev`
loads all done; only the post-load corpus re-run's count is recorded from the run in flight (below).

**Source and rows:** the Wikipedia captain lists (List of Geelong / Hawthorn / West Coast Eagles / Fitzroy
Football Club captains; the Brisbane Bears and Melbourne University season tables), read 2026-09-05, expanded
from periods to seasons (open periods run to 2026, the family's declared `MAX_SEASON`): **399 rows** appended
to `data/awards/captaincies.csv` (Geelong 126, Fitzroy 106, Hawthorn 105, West Coast 46, Brisbane Bears 10,
University 7), role `Captain`, `period` = the source span verbatim, `source_key` a 24-hex SHA-1 digest of
`issue118|club|season|player|period` (the file stays strictly key-ordered). Identity: name + played for the
club that season, else name + played for the club in some season with the career spanning it (the injured
captaincies of Barry Stoneham 1995 and Leigh Colbert 1999); 14 reviewed spelling equivalences (Sam Newman,
Gary Ablett, John Kennedy, Haydn Bunton, Bill Twomey, Charlie Cameron, Richard Vandenberg, Stephen Malaxos,
Alan Ruthven, Matthew Rendell, George Elliott, Edward Baker, Bert Chadwick, Charles Chapman); one explicit
`resolved` link (Fred Phillips, Hawthorn captain-coach 1933 with no senior game recorded — St Kilda 1925–32 on
AFL Tables). **One source row is not carried**: Hawthorn 1952, Peter O'Donohue — no AFL Tables identity of
that name exists, and the family requires every row linked. **82 players added to the identity census**
(1,780 → 1,863) and six existing Fitzroy census rows (Haydn Bunton, Ron Alexander, Kevin Murray, Garry Wilson,
Owen Abrahams, Frank Curcio) given the profile they lacked (census "without identity" 18 → 12).

**Code:** `tools/migration/captaincies.py` 1,375 → **1,774** rows, 18 → **24** club strings;
`tests/captaincies-source.test.ts` re-pinned (1,774 / 1,774 linked / 24 clubs / 179 notes);
`src/search/gridley-compat.ts` `captain` / `premcaptain` lose their "partial" note (the corpus regression's
`partial dataset` category is retained for any future partial mapping); `tools/db/rebuild-test.ts`
`captaincies` 1,375 → 1,774. **Loaded:** `afldb_test` 1,774 rows, **1,774 linked**; `afldb_dev` 1,774 rows,
1,690 linked (84 identities DEV lacks — the identity split).

**Corpus after Family B:** diagnostic run after the captaincy load (1,164/1,164): cells solved 9,626 of 10,287; `partial dataset` 506 → **0**; `unsupported` 309, `dataset gap` 354, `external source disagreement` 197, `source conflict` 102, `time of board` 14,429, `list membership` 839, timeouts 0 — and **`incorrect known answer` 5 cells / 1 player: Adam Goodes (afldb 35), `premiership_captain`**, previously hidden under `partial dataset` while the captain criteria carried the partial note. Those are bootstrap Sydney rows, not Family B rows: AFLDB records Goodes as a 2012 premiership co-captain (with Jarrad McVeigh) and Gridley's key omits him — a co-captaincy semantics question for the next session, recorded, not reclassified. The strict run fails on those 5 cells plus the 102 height source-conflict cells, the 309 unsupported and the 354 dataset-gap cells.

### 23.22 Remaining unsupported criteria and the exact next action (as recorded after §23.21 — items 1 and 2 done in §23.23)

**Still unsupported (19 criteria, 103 occurrences; §23.17's other families, unchanged):** `brother` (53),
`season2024player` (14), `intrulesplayer` (5), `premcoach` (4), `winaftersiren` (4), `coachedByWorsfold` (3),
`fathersonfather` (3), `coachedByDaniher` (2), `coachedByHardwick` (2), `coachedBySimpson` (2), `irish` (2),
`recruitedByDodoro` (2), `coachedByClarkson` (1), `coachedByGoodwin` (1), `coachedByMatthews` (1), `debut22`
(1), `nfl` (1), `spoils5season` (1), `tasmanian` (1). Families and what lands them: §23.17 rows for DOB/age on
debut, siblings/father–son, coaches, season lists, birthplace, International Rules/NFL, after-the-siren,
recruiters, spoils. Open besides these: the 3 height `source conflict` players (H3.7), the `dataset gap`
findings (draft links / marquee tags / post-2025 boards — test dataset lag, not code), and the All-Australian
link rule for Tony Buhagiar (§23.18 item 4, undecided).

**Exact next action (fresh session):**

1. **Prove the complete rebuild graph unattended:** `npm run db:test:rebuild -- --acknowledge-destroy
   afldb_test --draftguru-label annual-html-20260902` with `AFLDB_PYTHON`, `AFLDB_TEST_IMPORT_DATABASE_URL` and
   psql on PATH, snapshots under `data/sources/` (junctions from the issue-102/-129 worktrees are how this
   session did it), **without editing any loader while it runs**; expect all 16 stages and 53 final checks
   (heights 12,487 / AFL API 1,824 / Wikipedia 83 / medals 1,307 / captaincies 1,774). Budget ~3 h through the
   tunnel.
2. Decide Gridley's premiership-captain semantics for co-captains (Adam Goodes, Sydney 2012: 5 cells, §23.21) — a mapping/semantics decision, not data; then re-run the corpus
   (`AFLDB_GRIDLEY_DIAGNOSTIC=1 AFLDB_GRIDLEY_REPORT=<file> npx vitest run
   tests/integration/gridley-corpus.test.ts`, ~5 min) and the strict run for the failing-cell list.
3. Height `source conflict` (3 players, 102 cells): an operator decision on whether the AFL's own listing
   (corroborated by Wikipedia for McCartin and Ugle-Hagan) outranks the register for current players — if so,
   correct through the evidence model (`player_height_evidence` already holds both), never by hand.
4. Then §23.17's order: DOB stage + `age_on_debut_min`, coaches from the snapshot's per-match coach column,
   siblings/father–son, the model and curated-source decisions.
5. Production receives migration 086 and the three height loaders, the seven medals and the six captaincy
   clubs with the next deploy (ISSUE-137 sequencing; measure DEV-style identity coverage with dry runs first).

### 23.23 Rebuild gate passed unattended; premiership-captain co-captaincy decided (5 September 2026, sixth session, Fable medium)

**Gate — the complete 16-stage graph, unattended, from this worktree.** `npm run db:test:rebuild --
--acknowledge-destroy afldb_test --allow-owner-import-dsn --draftguru-label annual-html-20260902` with
`AFLDB_PYTHON` = the workstation Python 3.12 (psycopg 3.3.5), psql 16 on PATH, the tunnel on 55432 and the
snapshot junctions of §23.19 H4; launched detached 11:46:10, `Rebuild complete.` at 12:08 — **22 minutes**, the
fitzRoy stage taking ~15 minutes (the 3 hours of the H4 attempt were the tunnel, not the stage). Offline
preflight re-proved the register, the 130 player_stats files, the 15 roster artefacts and the Wikipedia CSV
before the reset. No loader, contract or artefact was edited while it ran. Every stage ran in order:
precheck, recreate, migrations, privileges, reference, fitzroy, **heights (batch 7: filled 12,487, evidence
rows 12,487, rejections 110), heights-afl-api (batch 8: 1,824 rows over 1,824 players), heights-wikipedia
(batch 9: 83 rows)**, draftguru, awards-honours (medals 1,307, captaincies 1,774, definitions 46),
brownlow-season (16,120 rows, 79,113 votes), derived, coleman (46), ladder-witness ("All checks passed"),
fingerprints. **FINAL VALIDATION PASSED: 53 checks**, including the five height gates and the medal and
captaincy counts, exactly as §23.19 H4 predicted. Observation, not a defect: `players = 13,271` is the
accepted fitzRoy baseline's distinct-player count; the table holds 13,273 because the `draftguru` stage
creates two 2026 draftees with no senior game (Fred Rodriguez, Riley Onley, DraftGuru identities only).
Item 1 of §23.22 is closed; the H4 caveat ("not yet proven by an unattended run") no longer applies.

**Corpus on the clean rebuild, unchanged test (run 1, diagnostic, 1,163/1,164, 294.8 s):** cells solved 9,626
of 10,287; `time of board` 14,429, `list membership` 839, `external source disagreement` 197, `source
conflict` 102, `unsupported` 309, `dataset gap` 354, **`incorrect known answer` 5**, timeouts 0, cells over
1 s 16 (max 2.07 s) — identical to §23.21's numbers, so the rebuild reproduces the hand-continued database.
The 5 failing cells are all one player on one criterion: Adam Goodes (Gridley 25 = afldb 35),
`premcaptain` × 2000s (#30, #284), × 1990s (#53), × 2010s (#183), × goals1avgseason (#183).

**Co-captaincy — the determination (item 2 of §23.22), from the stored oracle, the tracked source and the
rebuilt canonical facts; `afldb_dev` deliberately not used as evidence.**

| Evidence | What it says |
|---|---|
| Gridley's stored description (`tests/fixtures/gridley/corpus.json`, `premcaptain`) | "Won a premiership while captaining the team." — the same words the solver's comment uses |
| Gridley's answer key | Goodes absent from all 5 cells he would satisfy. Cell counts (Gridley / AFLDB on the rebuilt `afldb_test`): 2000s 17 / 18, 2010s 14 / 16, 1990s 13 / 15, 40+ disposals 8 / 10, 1+ goal season average 53 / 52, Collingwood 15 / 14, Essendon 12 / 11; WC 4 / 4, ME 10 / 10, RI 12 / 12, GE 9 / 9, HW 9 / 9, 3× premiership player 25 / 25. The differences fit one pattern: Gridley omits the Sydney co-captains (Goodes 2012; Kirk and Barry 2005 are unbridged, visible only in the counts) and includes the Grand-Final-day captain of flags whose appointed captain did not play (Collingwood 1958) and the 1897 Essendon premiership decided without a Grand Final |
| Tracked source, `data/awards/captaincies.csv` (Wikipedia captain lists) | Sydney 2005–2007: Barry Hall, Brett Kirk, Leo Barry (plus Stuart Maxfield 2003–2005), note "Barry Hall 2005 premiership captain"; Sydney 2011–2012: Adam Goodes, Jarrad McVeigh, note "Jarrad McVeigh 2012 premiership captain"; Western Bulldogs: Robert Murphy 2015–2017 with "Easton Wood 2016 premiership captain" on Wood's own 2018 row. The source lists every appointed captain and designates one "premiership captain" per flag in free text. The role vocabulary is `{Captain}` (`captaincies.py`); AFLDB holds no premiership-captain designation as data |
| Canonical facts on the rebuilt `afldb_test` | Premierships with more than one linked captain: 1917 Collingwood (McHale, Wilson — both played), 1968 Carlton (Nicholls played; Barassi did not), 2005 Sydney (Hall, Kirk, Barry played; Maxfield did not), 2012 Sydney (Goodes, McVeigh — both played), 2024 and 2025 Brisbane Lions (Andrews, Neale — both played). Premierships where **no** listed captain played the Grand Final: 1915 Carlton (Billy Dick), 1958 Collingwood (Frank Tuck), 1977 North Melbourne (Keith Greig), 2004 Port Adelaide (Matthew Primus), 2016 Western Bulldogs (Robert Murphy). 1897 and 1924 have only `semi_final` rows: no Grand Final was played |
| AFLDB's premiership rule | `rebuild_derived.py`: a premiership is "a game in a grand final whose result the player's club won"; `premiership_player`, `premierships_min`, `premiership_between_seasons` and `premiership_captain` all apply it, so 1897/1924 are excluded everywhere consistently |

**Decision.** Gridley's `premcaptain` means *the* premiership captain — one person per flag, the captain of
record on Grand Final day. AFLDB's `premiership_captain` means *a captain of the club that season who played
in and won the Grand Final*, derived from canonical captaincies and match facts. Goodes was an appointed 2012
co-captain (source-backed) who played the winning Grand Final (canonical fact): AFLDB's answer is true under its
own documented semantics, and narrowing it would require a designation AFLDB holds only as a note, or an
invented tie-break. **AFLDB's data and semantics are not wrong; the solver is unchanged; nothing is
special-cased for Gridley.** The disagreement is definitional and is classified as such in the corpus
regression from AFLDB's own evidence: `tests/integration/gridley-corpus.test.ts` now loads, from
`captaincies` ⋈ `matches` ⋈ `player_match_stats`, every player who shared a premiership club-season with
another linked captain where all of them played and won the Grand Final, and a `premiership_captain` cell in
which AFLDB lists such a player and Gridley omits him is `external source disagreement` (informational) with
the co-captains named in the detail. The rule never reads Gridley's answer, and a co-captain Gridley *lists*
while AFLDB omits would still fail. Cross-check with the counts: the rule reclassifies exactly the 5 Goodes
cells and nothing else.

**Corpus after the classification (run 2, diagnostic, 1,164/1,164, 301.0 s):** cells solved 9,626 of 10,287;
`incorrect known answer` **5 → 0**; `external source disagreement` 197 → **202** (the 5 Goodes cells, each
"co-captain of Sydney 2012 with Jarrad McVeigh (all played and won the Grand Final)"); every other category
unchanged (`time of board` 14,429, `list membership` 839, `source conflict` 102, `unsupported` 309, `dataset
gap` 354); timeouts 0; cells over 1 s 17 (max 2.07 s, under the 4 s gate). **Strict run (run 3, 295.4 s):** 1,162/1,164 — the two acceptance assertions fail as designed and nothing else: 19 unsupported valid criteria, and 765 failing cells = `unsupported` 309 + `dataset gap` 354 + `source conflict` 102; `incorrect known answer` 0, timeouts 0, no cell over 4 s. Acceptance is still not met; the remaining work is data (§23.17 families, the height operator decision, the test dataset lag), not solver correctness.

**Recorded, not fixed (canonical follow-up, outside this family):** the Grand-Final-day captain of the five
flags whose appointed captain did not play (1915, 1958, 1977, 2004, 2016) is not in AFLDB at all — the
source carries it only as a note on a different row (Wood) or not at all (Weideman 1958, Tredrea 2004). A
"matchday captain" fact would need its own curated source and a deliberate role-vocabulary change
(`captaincies.py` says so); it produces no bridged mismatch today because none of those players is
player-valued in the corpus. `afldb_dev` shows the same 2005/2012 structure (historical comparison only;
its 1,690 linked captaincies against 1,774 on `afldb_test` is dataset lag, not evidence).

**Files:** `tests/integration/gridley-corpus.test.ts` (co-captaincy evidence map, classification branch,
`INFORMATIONAL` text). No solver, loader, data or schema change.

**Exact next action:** items 3–5 of §23.22 stand: (3) the height `source conflict` operator decision (3
players, 102 cells); (4) §23.17's families in order — DOB stage + `age_on_debut_min`, coaches from the
snapshot's per-match coach column, siblings/father–son, then the model and curated-source decisions; (5)
production with the next deploy (ISSUE-137 sequencing).

### 23.24 Stage D1 — dates of birth from the AFL Tables all-time club lists (5 September 2026, sixth session)

**Why this family first (§23.17 item 2).** The rebuilt canonical database carries `players.dob` for **855 of
13,273** players, all from fitzRoy per-match rows. The accepted register cannot supply the rest: fitzRoy 1.8.0's
`get_player_details_afltables()` reads the 21 all-time club pages and then `select(-"DOB")`s the column away and
keeps no hrefs (`html_table()`), so `player_details.csv` has neither dates nor profile links. The legacy
`enrich_birth_dates.py` path read the legacy SQLite's `raw_row_json`; it is not a rebuild stage and never can be.
`debut22` ("22+ years old on debut", 1 occurrence) needs population-wide dates, and so does any honest
age-on-debut answer.

**Acquisition — `tools/rebuild/afltables/acquire_club_lists.R`** (new; contract
`tools/rebuild/afltables/afltables-contract.json`, block `club_player_lists`, new file). Reads the same 21 pages
(`https://afltables.com/afl/stats/alltime/<slug>.html`, fitzRoy's own slug map, `bullldogs` included) under
fitzRoy's User-Agent, concurrency 1, 1.5 s pacing, 20 s timeout, 3 retries at 2/4/8 s on transient failures;
robots.txt fetched and recorded (404: none published). Terminal on a non-200 page, a header that is not the
contract's, a linked-row without an href, a duplicate profile path on one page, or an empty club: no manifest.
Keeps the raw HTML bytes (`raw/`, sha256) and one CSV per club (`parsed/`, values as printed, plus
`profile_href` and `profile_path` = `normalise_profile_url()` of the href — the identity key). Snapshot
**`club-lists-20260905`**: 21 pages in ~40 s, **16,731 rows — the register's exact row count** — every row
with a DOB cell, 5 blank (`&nbsp;`: Kelly Robinson, Morrie Davidson, Dick Casey, Jim Schellnack, Bill
Hennington, all pre-1930), **13,364 distinct profile paths, 0 cross-club date disagreements**. Tracked manifest
`docs/rebuild-manifests/afltables_club_lists/club-lists-20260905.json` (LF; sha256
`e6d5ae26…3941`), pinned as `club_player_lists.accepted_snapshot` in the contract. Raw artefacts gitignored
under `data/sources/afltables/club_lists/` like every snapshot.

**Loader — `tools/migration/enrich_birth_dates_afltables.py`** (new). `--validate-only` re-proves every parsed
and raw artefact hash offline (0.1 s); otherwise joins each path to a canonical player **only through
`external_identities` (source `afltables`)**, folding the fitzRoy contract's `profile_url_continuity` rules
(none needed for this pair of captures); writes every date seen to `player_birth_evidence` (source `afltables`,
`evidence_type` `afltables_club_list`, `external_id` = profile path, batch-tracked); **fills `players.dob` only
where NULL** (`dob_confidence` sourced, `dob_evidence_id` set); never overwrites; reports disagreements and
refuses to fill any player reached with two different dates. Names are never used.

**Reconciliation on the rebuilt `afldb_test` (dry run, then load):** identities 13,275; **paths resolved 13,260**,
unresolved **104** — 92 are 2026 debutants (`Seasons` = 2026) the 2025-terminal baseline cannot hold, 12 are
profiles AFL Tables renumbered after the 2026-09-02 register capture (e.g. `Archie_Roberts0.html` beside the
baseline's `Archie_Roberts.html`; the 15 baseline identities absent from every page are their counterparts —
the ISSUE-136 mechanism, out of the contract's four tracked rules, reported not folded); players reached
13,260; **fillable 12,400; existing dates agree 853; disagree 2** (Roan Steele afldb 11043: fitzRoy 2002-09-19 vs
AFL Tables 2001-10-22; Jack Hayes afldb 6330: 1997-03-06 vs 1996-03-06 — kept as fitzRoy's, both evidence rows
recorded, adjudication is a separate decision); page-conflict players 0. **Loaded (batch 21, 1,658 s single-statement over the tunnel): evidence rows 13,255, filled 12,400; players with `dob` 855 → 13,255 of 13,273, `dob_without_evidence` 0, 18 still NULL (13 pre-2026 profiles with no resolvable page row, 5 blank cells).** DEV not loaded (next session, after the stage exists).

**Not yet done as of this section ((a) and (b) done in §23.25; (c) DEV load still open):** (a) the rebuild stage `birth-dates` after
`heights-wikipedia` with the contract pin read fail-closed, `--validate-only` in the preflight, and gates
(`players_with_dob`, `dob_without_evidence = 0`, `players_with_club_list_birth_evidence`) plus the
`tests/db-test-rebuild.test.ts` order/argv pins — and **batch the writes** (`executemany`/COPY): the
single-statement loop took ~25 minutes through the 55432 tunnel, which is fine by hand and wrong for a stage;
(b) the `age_on_debut_min` builder over `dob` and `player_career_stats.debut_date`, `debut22` mapped in
`gridley-compat.ts` (data-absent 19 → 18 criteria, 103 → 102 occurrences), `tests/gridley-compat.test.ts`
denominators, a `grid-solver` test, then the corpus; (c) DEV load. AFL Tables dates remain evidence with
fitzRoy's as the existing value where both exist; a precedence decision for the 2 disagreements is recorded, not
taken.

### 23.25 Stage D1 completed — `birth-dates` in the rebuild, batched writes, `age_on_debut_min` and `debut22` (5 September 2026, seventh session, Fable medium)

**Rebuild stage — `tools/db/rebuild-test.ts`.** New data stage `birth-dates` directly after `heights-wikipedia`
and before `draftguru` (it joins only through the afltables identities `fitzroy` registered; nothing later reads
`dob`). Its argv is `enrich_birth_dates_afltables.py --label <pin>` where the pin is read fail-closed by
`afltablesClubListPin()` from `tools/rebuild/afltables/afltables-contract.json`
`club_player_lists.accepted_snapshot` (`label`, `manifest`, `manifest_sha256_lf`, `measured`): a missing block,
a manifest absent from the checkout, a manifest that does not hash to its LF binding (`manifestSha256` normalises
CRLF, so an autocrlf checkout still proves) or a non-integer measured value is a `RebuildRefused` before anything
is destroyed. The preflight runs the derived `--validate-only` argv (every parsed and raw artefact hash, 0.1 s,
no database) beside the three height preflights. Five final-validation gates read the contract's new `measured`
block and are never typed into the runner: `players_with_dob_after_birth_dates` = 13,255 (the key is distinct
from the fitzRoy register's `players_with_dob` = 855, which stays in `MEASURED_NOT_DB_GATED` — the register's
claim is fitzRoy's own dates, the stage's claim is the rebuilt total), `dob_without_evidence` = 0,
`players_with_club_list_birth_evidence` = 13,255, `club_list_birth_conflict_players` = 0 (players reached with
two different page dates, never filled) and `dob_disagreeing_with_club_list` = 2 (the retained fitzRoy dates of
Roan Steele 11043 and Jack Hayes 6330 — the documented unresolved state, pinned so a silent overwrite or a
silent adjudication fails the rebuild). `tests/db-test-rebuild.test.ts`: order pins 16 → 17 stages / 10 → 11
data stages, a `birth dates` block (argv derivation, ordering, refusal on no pin / tampered hash / missing
manifest / missing measured value, preflight refusal with `Nothing has been destroyed`, gate keys and their
place after the height gates): **251/251**.

**Batched loader writes — `tools/migration/enrich_birth_dates_afltables.py`.** The per-row loop (13,255
`INSERT … RETURNING` + 12,400 `UPDATE` round trips, 1,658 s over the 55432 tunnel in §23.24) is replaced by two
`COPY`s into `ON COMMIT DROP` temp tables, one keyed upsert (`ON CONFLICT (player_id, source_id, dob)`, grouped
by player and date so two paths reaching one player with the same date collapse to one evidence row with
summed occurrences — the loop let the last path win; this capture has none) and one join `UPDATE … FROM` that
sets `dob_evidence_id` from the player's own evidence row of the same date and touches only `dob IS NULL`.
Fail-closed additions inside the transaction: the upsert's rowcount must equal the distinct (player, date)
pairs, and `count(*) WHERE dob IS NOT NULL AND dob_evidence_id IS NULL` must be 0, or the batch rolls back and is
recorded `failed`. Reconciliation, identity rules and the never-overwrite rule are unchanged. **Timings on
`afldb_test`:** rerun on the already-loaded database (batch 22) — evidence rows 13,255 upserted, **filled 0**,
write 1.2 s, 1.9 s end to end (idempotence proven); inside the rebuild (batch 10, clean database) — evidence rows
13,255, **filled 12,400**, write 2.7 s, 3.4 s end to end. Same counts as the hand-run §23.24 load to the row.

**Rebuild gate, unattended, 17 stages.** `npm run db:test:rebuild -- --acknowledge-destroy afldb_test
--allow-owner-import-dsn --draftguru-label annual-html-20260902` with `AFLDB_PYTHON` = the workstation Python
3.12, psql 16 on PATH, the tunnel on 55432 and the §23.19 snapshot junctions; launched 13:31:21, `Rebuild
complete.` 13:54:40 — **23 min 19 s**. No loader, contract or artefact was edited while it ran (the debut22
solver/test edits below touch nothing the rebuild reads). Stage output: identities 13,275, paths resolved 13,260,
unresolved 104, fill 12,400, existing agree 853, disagree 2, page-conflict players 0. **FINAL VALIDATION PASSED:
58 checks** (53 of §23.23 + the five above, each `= expected`). `players` is 13,271 at the stage (the two
DraftGuru-only 2026 draftees arrive later), 13,273 at validation; 18 players remain without a date (13 pre-2026
profiles with no resolvable page row, 5 blank cells) exactly as §23.24 predicted.

**`age_on_debut_min` — the builder (`src/search/grid-solver-spec.ts`, `src/db/queries/grid-solver.ts`).**
Group `Biography`, label "Aged X or older on debut", one integer param `years`. Compiles to
`p.dob IS NOT NULL AND c.debut_date IS NOT NULL AND c.debut_date >= p.dob + make_interval(years => N)`: completed
years on debut day, inclusive of the birthday itself, ordinary date arithmetic (a 29 February birthday lands on
28 February in a common year), and an unknown date on either side never qualifies. `c` is the
`player_career_stats` relation every axis already joins; `debut_date` is `min(match_date)` from
`rebuild_derived.py`. `GRID_BUILDERS` 151 → 152. **Gridley `debut22`** ("22+ YEARS OLD / ON DEBUT", 1
occurrence, board 171 row 2) maps to `age_on_debut_min {years: 22}` in `gridley-compat.ts`; the `NO_DOB`
data-absent reason is deleted. Nothing reads Gridley's answer key; the result is derived from canonical `dob` +
`debut_date` only. Population on the rebuilt `afldb_test`: 13,255 players with both dates, **4,416 aged 22 or
more on debut**, 8,839 under 22, 3 who debuted on their 22nd birthday (inside the bound), 16 with a debut and no
date (never qualify).

**Tests.** `tests/gridley-compat.test.ts` denominators re-pinned: mapped occurrences 6,754 → **6,755**, mapped
distinct 819 → **820**, data-absent occurrences 103 → **102**, data-absent distinct 19 → **18**, `debut22 [1]`
removed from the named list, a `map('debut22', '22+ YEARS OLD', 'ON DEBUT')` assertion added.
`tests/grid-solver-spec.test.ts` builder count 152. `tests/integration/grid-solver.test.ts` new block `age on
debut`: the solver's eligible count equals the SQL truth for ≥ 22, every player with both dates is on exactly one
side of the 22nd birthday, and ≥22 minus ≥23 equals the SQL count of 22-year-old debutants (inclusive lower
bound proven): **191/191** on the rebuilt database. `tests/integration/gridley-corpus.test.ts`: a `dobs` dataset
gap (present when at least half of `players` carry `dob`, the draft-link threshold) so `age_on_debut_min` is
reported as `dataset gap` rather than a wrong answer on a database without the stage (afldb_dev today). Unit
suites 282/282; `tsc --noEmit` clean; eslint on the touched files reports only the pre-existing `no-explicit-any`
findings (same counts at HEAD).

**Corpus, before → after, on the same rebuilt `afldb_test`.** Diagnostic (1,164/1,164, 294.0 s): cells solved
**9,626 → 9,629** of 10,287; `unsupported` **309 → 306** (the three `debut22` cells); `time of board` 14,429 →
14,431 (two players AFLDB lists on `debut22 × grandfinals2` whose second Grand Final came after the board date —
the documented board-time semantics, on the other axis); `list membership` 839, `external source disagreement`
202, `source conflict` 102, `dataset gap` 354 unchanged; **`incorrect known answer` 0**, timeouts 0, cells over
1 s 16 (max 2.09 s, under the 4 s gate); `debut22` itself solved in 25 ms and the three cells in 41–174 ms; the
one exactly-comparable cell (`debut22 × 2-1`) is 362 / 362. Strict (1,162/1,164, 293.1 s): the two acceptance
assertions fail as designed and nothing else — **unsupported valid criteria 19 → 18**, failing cells 765 → **762**
= `unsupported` 306 + `dataset gap` 354 + `source conflict` 102. Acceptance is still not met; the remaining
work is data.

**Not done / deviations.** (a) DEV load of the birth dates (`afldb_dev` still has fitzRoy's 855): a hand run of
the loader against DEV or the next DEV rebuild — DEV is not semantic evidence, so nothing here depended on it.
(b) The 2 fitzRoy/AFL Tables disagreements stay as recorded (fitzRoy retained, both evidence rows present,
gate pinned at 2); adjudication is a separate decision. (c) The 12 renumbered profiles / 92 2026 debutants are
unresolved by design until the fitzRoy baseline advances. (d) `age_on_debut_max` is not added — no Gridley
criterion needs it and the brief was `debut22` only.

**Files:** `tools/db/rebuild-test.ts`, `tools/rebuild/afltables/afltables-contract.json` (`measured` block),
`tools/migration/enrich_birth_dates_afltables.py`, `src/search/grid-solver-spec.ts`, `src/db/queries/grid-solver.ts`,
`src/search/gridley-compat.ts`, `tests/db-test-rebuild.test.ts`, `tests/gridley-compat.test.ts`,
`tests/grid-solver-spec.test.ts`, `tests/integration/grid-solver.test.ts`, `tests/integration/gridley-corpus.test.ts`,
`CHANGELOG.md`, `IssuesIndex.md`, this runbook.

**Exact next action:** items 3–5 of §23.22 stand, renumbered: (1) the height `source conflict` operator decision
(3 players, 102 cells); (2) §23.17's remaining families — **coaches** from the snapshot's per-match coach column
(`premcoach` 4, `coachedBy*` 12 occurrences), then **siblings / father–son** (`brother` 53, `fathersonfather` 3),
then the model and curated-source decisions (`season2024player` 14, `irish`/`tasmanian`, `nfl`,
`intrulesplayer`, `winaftersiren`, `spoils5season`, `recruitedByDodoro`); (3) DEV load of the birth dates;
(4) production with the next deploy (ISSUE-137 sequencing). Tony Buhagiar's All-Australian adjudication remains
open.

### 23.26 Stage E1 — the three height source conflicts adjudicated on evidence (5 September 2026, eighth session, Fable medium)

**Scope.** The `source conflict` category §23.19 left open: 102 cells, 3 players (Paddy McCartin 10175 44 cells,
Jamarra Ugle-Hagan 6700 18, Nathan Brown 9771 40). For each, every source AFLDB holds was inspected on the
rebuilt `afldb_test` (register rows in `full-history-20260902/player_details.csv`, `player_height_evidence`,
`external_identities`) and an explicit decision made. **No canonical height changed** (`players.height_cm`
194 / 194 / 181 before and after; `height_evidence_id` unchanged).

**E1.1 Identity first — Nathan Brown.** Gridley's Nathan Brown is id 5429 (criterion
`nathan-brown-teammate-5429`); AFL Tables lists three Nathan Browns and the §23.19 Wikipedia pass could not key
his article by name. The 50 `height180` cells whose key lists 5429 sit on Richmond (12), Western Bulldogs (3),
`dreamtime-playedin-1`, `allAus1953`/`allAus2000s`, `clubLeadingGoalKicker2x` and `brownlow50votes` axes: the
1997–2003 Bulldogs / 2004–2009 Richmond player, afldb 9771, exactly as `PLAYER_OVERRIDES` bridges him — not
the Melbourne Nathan Brown 9770 whom the register lists at 180. The Stage D1 dates settle the article: afldb
9771 `dob` 1978-02-10; Wikipedia "Nathan Brown (Australian footballer, born 1978)" infobox `birth_date`
1978-02-10, `draftpick` 10th 1996 (Bulldogs), `years1` 1997–2003, `years2` 2004–2009, **`height` 183 cm**
(revision 1343824433, 2026-03-16T16:40:56Z). Added as row 84 of the tracked
`data/players/height-evidence-wikipedia.csv` with the tie recorded in its note; loaded on `afldb_test` by
`enrich_heights_wikipedia.py` (batch 22: 84 profiles resolved, 0 unresolved, 60 agree / 24 differ, 0.7 s;
`--validate-only` and `--dry-run` first). Decision: **AFL Tables 181 retained; the only independent source
(183) sits on AFLDB's side of the ≤180 bound**, so under the unchanged §23.19 H3.6 rule the 40 cells are
`external source disagreement` — evidence, not a rule change. The `players_with_wikipedia_height_evidence`
gate derives from the artefact's row count (`wikipediaHeightRows()`), so the next rebuild expects 84 without
an edit; `tests/db-test-rebuild.test.ts` 251/251 unchanged.

**E1.2 Paddy McCartin — AFL Tables 194 retained.** Register: 194 on both club rows (St Kilda 2015–2018,
Sydney 2022–2023). AFL API roster: 195, one constant across all seven listed seasons (2015–2019, 2022–2023;
`CD_I298312`). Wikipedia infobox: 195 (revision 1371023312), **uncited** — it cannot be shown independent of
the AFL listing. The 1 cm difference is the AFL listing's documented systematic skew (+1 on 274 of the 701
differing shared players, H3.3). Neither source can be shown wrong from the other; §23.19 rule 1 keeps the
column on one measurement convention. **Decision: retain; the cell answer at the ≥195 bound is not provable
from AFLDB's sources.**

**E1.3 Jamarra Ugle-Hagan — AFL Tables 194 retained.** Register: 194 on both club rows (Western Bulldogs
2021–2024 and Gold Coast 2026 — the register captured 2026-09-02 includes his current club and still says 194).
AFL API: 197, one constant 2021–2026 (`CD_I1009301`). Wikipedia: 197 (revision 1369185653), uncited. A 3 cm
delta is beyond the ±2 skew but inside the listing's distribution (+3 on 45 shared players). Superseding for one
player would put `height_cm` on two conventions (rule 1); a column-wide rule "listing supersedes the register
when they differ by ≥3 cm and a third source agrees" would touch roughly 100 players and needs Wikipedia (or
another source) for each — a separate policy decision, not made here. **Decision: retain; the cell answer at
the ≥195 bound is not provable from AFLDB's sources.**

**E1.4 The classification contract — an adjudication is a tracked, self-invalidating record.** New tracked
artefact **`data/players/height-adjudications.csv`** (columns `afltables_profile, player, afltables_cm,
competing_evidence, decision, reason, decided_on, reference`; two rows, `retain_afltables`; keyed by the AFL
Tables profile path, never by name; `.gitignore` now opts `/data/players/` in explicitly for it and the
Wikipedia set, which had been force-added). Reader `tests/height-adjudications.ts` (`loadHeightAdjudications`,
fail-closed on header, field count, profile shape, duplicate profile, non-integer or implausible height,
unsorted or malformed `source:cm` pairs, unknown decision, a reason under 40 characters, date, reference) and
`adjudicationStaleness(adj, canonicalHeight, competing)`: a record applies **only while the canonical height
and the exact set of non-AFL-Tables evidence pairs are those it was decided on**; a supersession, a new register
value, a new source or a changed value returns it to `source conflict` with the reason in the cell detail.
`tests/integration/gridley-corpus.test.ts`: new informational category **`adjudicated source conflict`**
(reported, never failed) taken in the height branch after the §23.19 evidence test and before the open
`source conflict` fallback; the rule for `external source disagreement` and `source conflict` is unchanged.
Nothing reads Gridley's key. `tests/height-reconciliation.test.ts` gains a `height adjudications artefact`
block (the tracked rows exactly as recorded, quoted/CRLF parsing, six refusals, five staleness cases):
**10/10**; `tsc --noEmit` clean; eslint clean on the touched files.

**E1.5 Evidence, before → after, same rebuilt `afldb_test` (plus batch 22).**

| Measure | Before (§23.25) | After |
|---|---:|---:|
| `source conflict` cells / players | 102 / 3 | **0 / 0** |
| `adjudicated source conflict` cells / players | — | **62 / 2** (McCartin 44, Ugle-Hagan 18) |
| `external source disagreement` cells / players | 202 / 7 | **242 / 8** (+ Nathan Brown 40) |
| `incorrect known answer` | 0 | 0 |
| `unsupported` cells / valid criteria | 306 / 18 | 306 / 18 |
| `dataset gap` | 354 | 354 |
| cells solved | 9,629 / 10,287 | 9,629 / 10,287 |
| timeouts / cells over 1 s (max) | 0 / 16 (2.09 s) | 0 / 18 (1.91 s) |
| strict failing cells | 762 | **660** = `unsupported` 306 + `dataset gap` 354 |
| Wikipedia evidence players (rebuild gate) | 83 | 84 |

Diagnostic 1,164/1,164 (284 s); strict 1,162/1,164 (the two acceptance assertions, on `unsupported` 306 and
`dataset gap` 354 only). Height oracle (`gridley-height-oracle`, `AFLDB_HEIGHT_REPORT`) 16/16, 420 height cells
compared, bridged answer players with a height 950 / 950; its per-cell false-negative shape for the three
players is unchanged because the oracle reads `players.height_cm`, which did not move. `grid-solver`
integration untouched (no builder or SQL changed).

**Not done / deviations.** (a) The height-adjudication model is a test-side classification contract; nothing
in `src/` or the rebuild reads the artefact (it does not fill or change data, so no stage or gate is needed).
(b) DEV (`afldb_dev`) does not carry batch 22; DEV is not semantic evidence. (c) The column-wide "≥3 cm with a
third source" question (E1.3) is recorded, not decided.

**Files:** `data/players/height-evidence-wikipedia.csv` (+1 row), `data/players/height-adjudications.csv`
(new), `.gitignore`, `tests/height-adjudications.ts` (new), `tests/height-reconciliation.test.ts`,
`tests/integration/gridley-corpus.test.ts`, `CHANGELOG.md`, `IssuesIndex.md`, `issues.md`, this runbook.

**Exact next action:** §23.25's list less item (1): **coaches** from the snapshot's per-match coach column
(`premcoach` 4, `coachedBy*` 12 occurrences) — inspect the accepted fitzRoy/AFL Tables source first, record the
source/model decision, then a match-level (match, club, coach) responsibility model suitable for later
person/profile integration; then siblings / father–son; then the model and curated-source decisions; DEV load of
the birth dates; production with the next deploy (ISSUE-137 sequencing). Tony Buhagiar's All-Australian
adjudication remains open.

### 23.27 Stage E2 (coaches) — source investigated, model decided, NOT implemented (5 September 2026, eighth session, Fable medium)

Investigation only, as the brief required before any schema. Nothing in `src/`, the migrations, the rebuild or
`afldb_test` changed for coaches in this session. Context reached the handoff ceiling after §23.26; the
implementation is the exact next action below.

**E2.1 What the accepted snapshot carries.** Every fitzRoy `player_stats_<season>.csv` in the accepted
baseline `full-history-20260902` (129 files, 685,473 rows, 81 columns) carries a **`Coach`** column (column 79),
"Surname, Given" form, one value per row; the in-season supplement `issue129-t7-20260903` carries the same
column. Measured on the baseline:

| Measure | Value |
|---|---:|
| team-match groups (season, date, round, home, away, playing-for) | 33,676 = 16,838 matches × 2 |
| groups with a coach | 32,034; groups without 1,642 |
| groups whose rows disagree on the coach | **0** — the column is exactly one coach per (match, club) |
| matches with both coaches / one / neither | 15,817 / 400 / 621 |
| seasons with any gap | 1897–1901 (every match), 1902–1910 shrinking (127/144 → 36/188), 1912 18, 1914 1, 1915–1922 15–17 each, **1940 11/224**; complete from 1941 |
| distinct coach strings | 383 (+2 in the supplement only: Carr, Josh; Fraser, Josh) |
| team-seasons with more than one coach | 162 of 1,530 — mid-season changes and caretakers are represented per match (2022: seven clubs; 2023 Gold Coast King/Dew, North Ratten/Clarkson, Richmond McQualter/Hardwick; 2024 West Coast Simpson/Schofield; 2025 Melbourne Chaplin/Goodwin) |
| the eight Gridley coaches | Worsfold 388 team-matches (West Coast 2002–2013, Essendon 2016–2020); Daniher 223 (Melbourne 1998–2007); Hardwick 355 (Richmond 2010–2023 r10, Gold Coast 2024–2025); Simpson 242 (West Coast 2014–2024); Clarkson 449 (Hawthorn 2005–2021, North 2023–2025); Goodwin 203 (**Essendon 2013 ×1** — the caretaker match Gridley's text names — Melbourne 2017–2025); Matthews, Leigh 461 (Collingwood 1986–1995, Brisbane Lions 1999–2008; "Matthews, Herbie" is a distinct string) |

Spelling is stable: one string per person across eras (McHale 1912–1949, Kennedy 1957–1989, Sheedy 1981–2013,
Malthouse 1984–2015 each a single string). The column names the coach; it does not key the person.

**E2.2 Identity — the AFL Tables coaches index and coach pages are the key.** `afltables.com/afl/stats/
coaches/coaches_idx.html` (fetched once for this investigation, 227 KB, not stored) lists **386 coach pages
with 386 distinct names — no name maps to two pages** — and **all 385 snapshot + supplement strings resolve
to a page by exact string** (one index name never coaches in the snapshot). Each coach page
(`coaches/<Given>_<Surname><n>.html`, the same `<n>` disambiguation as player profiles; e.g. `Ron_Barassi0.html`)
carries a **"Player Stats" link to the exact player profile path** (`../players/R/Ron_Barassi0.html`), the
coach's birth date, and every game coached with its game URL. That link is the person identity: it is the
same `players/<L>/<Name>.html` path `external_identities` holds for every canonical player (source
`afltables`), so a coach who played joins the existing player row through the key AFLDB is built on, and a
coach who did not play (no "Player Stats" link) has no player row and none is fabricated. Name-only linking
measured on `afldb_test` shows why the key matters: of 383 strings, 349 match exactly one player by
normalised name with debut ≤ first season coached, **16 are ambiguous** (Ron Barassi — two Ron Barassis, Mark
Williams — three, both **premiership coaches**; Alan Richardson, Len Smith, Charlie Cameron, Jack Williams …)
and 18 match nobody (Worrall, Fagan, Craig, Cahill, Bolton, Kinnear, McCartney, Brittain, Todd … — coach-only
in the VFL/AFL, correctly unlinkable; "ONeil, John" is an apostrophe difference).

**E2.3 Model decision.**

1. **`coaches`** — one row per person who coached: `id`, `afltables_coach_path` (unique; the coach page
   path), `display_name`, `given_name`, `surname`, `name_key` (the snapshot's "Surname, Given" string, unique),
   `dob` (from the coach page), **`player_id` nullable → `players`** with `link_status_value link_status`
   (`unique` when the coach page's Player Stats profile resolves through `external_identities`; `unmatched`
   when the page has no profile link; never inferred from the name), `source_id`, `source_record_id`,
   `import_batch_id`, `notes`. This is the "person" seam: a player-turned-coach is one `players` row plus one
   `coaches` row joined by `player_id`; later profile work renders both domains from that join.
2. **`match_coaches`** — `(match_id, club_id)` primary key, `coach_id`, `source_id`, `source_record_id`
   (`<match_key>@<club>`), `import_batch_id`. One row per (match, club) with a coach in the snapshot column;
   caretakers and mid-season changes are simply the coach of that match. No season ranges anywhere. Coach
   W/D/L, games, win %, finals, Grand Finals and premierships are **derived** from `match_coaches ⋈ matches`
   when needed, never stored.
3. **Acquisition (new tracked dataset, manifest-pinned):** `tools/rebuild/afltables/acquire_coaches.R` (or
   `.py` beside `acquire_club_lists.R`) fetches the coaches index and the 386 coach pages, writes
   `coaches_index.csv` (name, coach path) and `coach_pages.csv` (coach path, player profile path or blank,
   born, games coached) plus raw HTML under gitignored `data/sources/afltables/coaches/<label>/`, with a tracked
   manifest `docs/rebuild-manifests/afltables_coaches/<label>.json` and a pin block `coaches.accepted_snapshot`
   in `tools/rebuild/afltables/afltables-contract.json` (label, manifest, `manifest_sha256_lf`, `measured`),
   read fail-closed exactly like `club_player_lists`.
4. **Loader** `tools/migration/import_match_coaches.py`: verifies the coaches snapshot and the fitzRoy baseline
   + supplements (the same labels the `heights` stage reads from `height_enrichment`, reused through a shared
   argv helper — the per-match rows are the same files), builds (match_key, club) → coach string from the
   `Coach` column (refusing any group with two strings), resolves the match by `matches.match_key`
   (16,838 / 16,838 populated) and the club through `import_fitzroy_core.ClubResolver` (historical identity),
   resolves the string → coach page (exact, refusing an unmapped string) → profile → `player_id`, upserts
   `coaches` then `match_coaches` in one transaction, `--validate-only` and `--dry-run` like the other loaders.
   The coach page's own games-coached count is a per-coach cross-check against the column (report only,
   gate the total).
5. **Rebuild:** data stage `coaches` after `birth-dates` and before `draftguru` (needs matches, clubs and the
   afltables identities `fitzroy` registered; nothing later reads it), preflight `--validate-only`, final gates
   from the contract's `measured` block: `coaches` (385 with the supplement), `match_coaches` (32,034 baseline +
   supplement rows), `matches_with_both_coaches`, `coaches_linked_to_players`, `coaches_unlinked` (coach-only),
   `match_coaches_without_coach_page` = 0. `tests/db-test-rebuild.test.ts` order pins 17 → 18 stages / 11 → 12
   data stages.
6. **Grid Solver** (`grid-solver-spec.ts`, `grid-solver.ts`): `coached_by {coach}` (group Coaching, "Coached
   by X": exists `player_match_stats pms ⋈ match_coaches mc ON (mc.match_id, mc.club_id) = (pms.match_id,
   pms.club_id)` with `mc.coach_id = $coach` — the same set-then-rank semi-join shape as `teammate_of`) and
   `premiership_coach` (no params: exists `coaches c` with `c.player_id = p.id` and a `match_coaches` row on a
   `round_type = 'grand_final'` match whose `winner_club_id` is that row's club). `GRID_BUILDERS` 152 → 154.
   `gridley-compat.ts`: `premcoach` → `premiership_coach`; `coachedBy*` → `coached_by` with the coach resolved
   by a `resolveCoach` lookup (exact given + surname, the eight are unique); the eight data-absent reasons are
   deleted (data-absent criteria 18 → 10, occurrences 102 → 86). Focused tests: loader reconciliation on
   synthetic rows beside `tests/height-reconciliation.test.ts`, `grid-solver-spec` builder count,
   `gridley-compat` denominators, an `integration/grid-solver` block (solver counts equal SQL truth for
   `coached_by` Goodwin including the 2013 Essendon match, `premiership_coach` equals the distinct linked
   premiership coaches), then diagnostic + strict corpus with before/after (`unsupported` 306 / 18 criteria
   expected → 290 / 10, everything else unchanged).

**Not decided / to verify during implementation.** (a) Whether the 621 no-coach matches and 400 one-sided
matches (all ≤1922 plus 1940) should be reported as a `measured` absence only (recommended: they are the
source's own gaps; no stage fills them). (b) The one index-only coach (never in the snapshot) is loaded as a
`coaches` row with no `match_coaches` rows, or skipped — recommended: loaded, so the person exists once the
next in-season snapshot names them. (c) The coach page's "Player Stats" link is the identity; if any page's
profile path does not resolve in `external_identities`, the loader must refuse rather than fall back to the
name.

**Files:** `IssuesIndex.md`, `issues.md`, this runbook (no code).

**Exact next action (fresh session, Fable medium):** implement E2.3 items 3 → 4 → 5 → 6 in that order,
acquiring the coaches snapshot first (label `coaches-<date>`, 386 pages, polite rate), proving the loader on
`afldb_test` by hand (`--validate-only`, `--dry-run`, load), then the unattended 18-stage `db:test:rebuild`
(expect FINAL VALIDATION 58 + the new gates), then the solver/compat tests and both corpus modes, recording
before/after in a §23.28. Then siblings / father–son, the model and curated-source decisions, DEV load of the
birth dates, production with the next deploy (ISSUE-137 sequencing). Tony Buhagiar's All-Australian
adjudication remains open.

### 23.28 Stage E2 (coaches) — IMPLEMENTED: coach pages acquired, `coaches` + `match_coaches` canonical, rebuild stage, `coached_by` / `premiership_coach` (5 September 2026, ninth session, Fable medium)

Implements §23.27 E2.3 items 3 → 6 exactly as decided; nothing in the model was redesigned. Every join is
fail-closed on the accepted contract and nothing is matched by name.

**E2.1 Source acquisition — `coaches-20260905`.** New adapter `tools/rebuild/afltables/acquire_coaches.py`
(standard library only; the contract's HTTP policy — fitzRoy User-Agent, 1.5 s pacing, 20 s timeout, 3 bounded
retries, robots.txt recorded, any non-200 terminal with no manifest written) reads the coaches index and every
page it links: **386 index rows, 386 pages, 386 distinct names**, extraction 2026-09-05T06:36:13Z, robots.txt
404. Parsed artefacts `parsed/coaches_index.csv` (the index row as printed: name, page href/path, teams, seasons,
the H&A / finals / total W-D-L-T-% and PR/GF cells) and `parsed/coach_pages.csv` (page path, `<h1>` display
name, `Born:` as printed, the Player Stats href and its normalised profile path, the Games Coached row count,
the raw sha256) — **tracked** (`.gitignore` opts in only `data/sources/afltables/coaches/*/parsed/`,
`.gitattributes` forces LF because the manifest hashes them); raw HTML (387 files) gitignored but hash-bound.
Manifest copied to the tracked `docs/rebuild-manifests/afltables_coaches/coaches-20260905.json`
(LF sha256 `3e78f473…`) and pinned as `coaches.accepted_snapshot` in `afltables-contract.json` with the
`measured` block below. 368 pages carry a Player Stats profile, **18 do not** — the coach-only people
(Worrall, Fagan, Craig, Cahill, Bolton, Kinnear, McCartney, Brittain, Todd, …), matching §23.27's "18 match
nobody". Two source quirks handled without guessing: the index omits `</tr>` on its header row (the parser
closes a row on the next start tag) and one page file has a space in its name ("Allan_La Fontaine.html", kept
verbatim as identity; only the request line is percent-encoded).

**E2.2 Four coach-page hrefs AFL Tables does not serve as printed — tracked, evidence-dated corrections.**
The loader's first dry run refused four pages whose Player Stats link resolved to no `afltables` identity.
Each was checked against the live site and the identities on the same day and recorded as a
`coaches.profile_link_corrections` rule (exact `(coach_path, page_profile_path)` match, each rule must apply
exactly once or the loader refuses — the `source_row_corrections` discipline): **Allan La Fontaine** (page
links `Allan_La Fontaine.html` → HTTP 404; `Allan_La_Fontaine.html` is HTTP 200 and is the fitzRoy url column
form, player 486); **Alan Belcher** (AFL Tables serves *both* `Alan_Belcher.html` and `Allan_Belcher.html`,
each Born 2-Dec-1884; the coach page links the former, fitzRoy's url column is the latter, player 451 — one
person, two paths; the fitzRoy path is AFLDB's identity); **John ONeil** (`John_ONeil.html` 404; `John_ONeill.
html` 200, both pages Born 30-Aug-1935, player 7673); **Jim Toohey** (`Jim_Toohey.html` 404; the served
profiles are `Jim_Toohey0` Born 23-Jul-1886 and `Jim_Toohey1` Born 1-Jun-1915; the coach page, Fitzroy 1920,
prints 23-Jul-1886 → player 7202 — the date, not the name, selects). The rules and their evidence sit in the
contract; the unit test proves a rule applies by exact page and href, exactly once, and refuses once its page
is fixed upstream.

**E2.3 Canonical schema — migration `087_coaches.sql`.** `coaches` (one row per person: `afltables_coach_path`
unique, `name_key` = the snapshot's exact "Surname, Given" string unique, `display_name`, `given_name`,
`surname`, `dob`, **`player_id` nullable → `players`** with `link_status_value` and a CHECK that a player is
carried only under `unique`, `afltables_profile_path`, `source_games_coached` (evidence only, commented as
never a total), source/record/batch/notes; one coach row per player at most) and **`match_coaches`**
(`(match_id, club_id)` PK, `coach_id`, source/record/batch; a trigger refuses a club that is not one of the
match's two). Games, W/D/L, finals, Grand Finals and premierships are derived, never stored. Registered
`grant_app_read` + `grant_import_write` for both tables. Applied to `afldb_test` by `db:migrate:test` (087, 252
ms) and reconciled by `db:privileges:test` (afldb_import 43 registered tables writable). No other branch tip
carries an 087.

**E2.4 Loader — `tools/migration/import_match_coaches.py`.** Verifies the coaches manifest (parsed always; raw
whenever `raw/` is present — refusing a mismatch either way), then the baseline's and every pinned supplement's
`player_stats` files (the heights stage's `verified_files`), `--validate-only` stopping there offline (8.3 s).
Folds the per-match rows through `iter_player_stats` (row corrections applied) with the canonical
`ClubResolver` to one string per `(match_key, club)` — **695,085 rows → 34,094 team-match groups, 32,452 with a
coach, 1,642 without, 0 disagreements, 385 distinct strings, every one exactly one index name**. Resolves the
match by `matches.match_key` (a key absent from a season the database holds refuses; a season the database
does not hold at all is reported and skipped — the 418 supplement groups of 2026 on the 2025-terminal
`afldb_test`), the club through the match's own two clubs, the coach page through the exact string, and the
player **only** through the page's profile path → `external_identities` (continuity rules folded, the four
tracked corrections applied). Upserts `coaches` (every page — the index-only coach and the two supplement-only
coaches exist as people now) then `match_coaches` (temp-table COPY, set-based upsert, stale rows of this source
removed) in one `import_batches` transaction. **On `afldb_test`: 386 coaches (368 linked, 18 coach-only),
32,034 assignments; matches with both coaches 15,817 / one 400 / none 621** — exactly §23.27's measurement;
cross-check: 364 of 386 pages' own Games Coached equal the canonical assignment count (the rest are the
source's ≤1922/1940 gaps and 2026). Batch 23 in 12.7 s (write 4.4 s); a second run (batch 24) wrote the same
386 / 32,034 with 0 stale removed — idempotent.

**E2.5 Rebuild integration.** `tools/db/rebuild-test.ts`: `afltablesCoachesPin()` reads
`coaches.accepted_snapshot` fail-closed (label, tracked manifest, LF hash proven, seven integer `measured`
values); data stage **`coaches`** after `birth-dates` and before `draftguru` (argv = loader + pinned label +
the baseline label + every `height_enrichment` supplement — the same pins the heights stage reads, so the two
cannot disagree); preflight runs `--validate-only` before the destructive reset; **eight final gates**
(`coaches`, `coaches_linked_to_players`, `coaches_unlinked`, `coaches_linked_outside_unique` = 0,
`match_coaches`, `matches_with_both_coaches`, `matches_with_one_coach`, `matches_without_coach`), all read from
the pin, none typed, none reading a name. Evaluated against the hand-loaded `afldb_test`: 8/8 PASS.
`tests/db-test-rebuild.test.ts`: stage order 17 → 18 (data 11 → 12) and a `coaches` block (argv derivation,
order, four pin refusals, preflight refusal, gate shape and registration).

**E2.6 Grid Solver.** New param kind `coach` and group **Coaching**: `coached_by {coach}` — "the player
appeared in a canonical match for a club while the specified coach was assigned to that club for that exact
match" (`player_match_stats ⋈ match_coaches` on `(match_id, club_id)`, the `teammate_of` semi-join shape) —
and `premiership_coach` (a `coaches` row with a proven `unique` player link and a `match_coaches` row on a
`round_type = 'grand_final'` match whose `winner_club_id` is that row's club; a drawn Grand Final counts for
nobody). `GRID_BUILDERS` 152 → 154. UI: `getCoachOptions()` (`src/db/queries/coaches.ts`, every coach with
the season span of their assignments) feeds a select in `GridSolverForm` and the axis description on the page.
`tests/integration/grid-solver.test.ts`: solver counts equal SQL truth for `coached_by` Goodwin (his 2013
Essendon caretaker match included, every returned player in the truth set) and for `premiership_coach` (Leigh
Matthews linked and present; the operator's coach-only list — Todd, Kinnear, Cahill, Brittain, Craig,
McCartney, Bolton, plus Fagan — all `player_id` NULL / `unmatched`, no players row created): **195/195**.

**E2.7 Gridley compatibility.** `gridley-compat.ts`: `GridleyLookups.resolveCoach` (exactly one `coaches` row
by normalised display name — the eight are unique on the index; ambiguity → `unresolved`, an empty coaches
table → `dataset gap`); `premcoach` → `premiership_coach`; `coachedBy*` → `coached_by` with the resolved coach.
The `NO_COACHES` reason is gone. `tests/gridley-compat.test.ts` denominators: mapped 6,755 → 6,771 occurrences
/ 820 → 828 criteria; **data-absent 102 → 86 occurrences, 18 → 10 criteria** (brother 53, season2024player
14, intrulesplayer 5, winaftersiren 4, fathersonfather 3, irish 2, recruitedByDodoro 2, nfl 1, spoils5season 1,
tasmanian 1).

**E2.8 One semantic finding — Gridley's `coachedByGoodwin` is list-grain.** Board #752's key lists Dyson
Heppell (4011) and Joe Daniher (7315) as coached by Goodwin. Goodwin's only Essendon assignment is the 2013
round 23 caretaker match (Essendon v Richmond, 22 Essendon players); neither played in it (Heppell 19 games in
2013, Daniher 5, none that day). Gridley's text — "Has played on an AFL team coached by Simon Goodwin. Includes
teams coached in a caretaker capacity" — counts a player listed by the club in a season the coach coached a
match for it; AFLDB's `coached_by` is a match the player played under that coach, as the brief specifies. The
five cells are therefore the corpus's existing documented `list membership` difference (the same rule that
already covers club, decade and teammate criteria), and `coached_by` was added to that classification's builder
set with the case recorded beside it. **No data, predicate or answer was changed.**

**E2.9 Evidence, before → after, same `afldb_test` (migration 087 + batch 23/24 by hand; the unattended
rebuild below reproduces it).**

| Measure | Before (§23.26) | After |
|---|---:|---:|
| `unsupported` cells / valid criteria | 306 / 18 | **258 / 10** |
| unsupported occurrences (compat) | 102 | **86** |
| cells solved | 9,629 / 10,287 | **9,677 / 10,287** |
| `dataset gap` | 354 | 354 |
| `source conflict` / `adjudicated source conflict` | 0 / 62 | 0 / 62 |
| `external source disagreement` | 242 | 242 |
| `list membership` | 839 | 844 (+5, E2.8) |
| `incorrect known answer` | 0 | **0** |
| timeouts / cells over 1 s | 0 / 18 | 0 / 15 (strict run; 18 in the diagnostic run) |
| strict failing cells | 660 | **612** = `unsupported` 258 + `dataset gap` 354 |
| `GRID_BUILDERS` | 152 | 154 |
| rebuild stages / data stages / final gates | 17 / 11 / 58 | 18 / 12 / 66 |

Diagnostic 1,164/1,164 (292 s); strict 1,162/1,164, failing only on the two acceptance assertions
(`unsupported` 258, `dataset gap` 354). §23.27 expected 306 → 290 cells: the eight criteria's 16 occurrences
span 48 cells, so 258. `tests/db-test-rebuild.test.ts` 251 → **256/256**; `grid-solver-spec` + `gridley-compat`
31/31; `coach-reconciliation` (new) 9/9; `integration/grid-solver` 195/195; `tsc --noEmit` clean; eslint clean
on every touched file (the runner's and rebuild test's pre-existing `no-explicit-any` findings are outside the
edited ranges).

**E2.10 Rebuild gate, unattended, 18 stages.** `npm run db:test:rebuild -- --acknowledge-destroy afldb_test
--allow-owner-import-dsn --draftguru-label annual-html-20260902` with `AFLDB_PYTHON` = the workstation Python
3.12, psql 16 on PATH and the tunnel on 55432; launched detached 16:55:07, `Rebuild complete.` 17:17:14 —
**22 min 7 s**. Offline preflight (the coaches `--validate-only` among them) before destruction; COACHES after
BIRTH DATES: 386 index rows / 386 pages verified, raw bytes verified (387 files), 386 coaches (368 linked, 18
coach-only), 32,034 assignments (15,817 / 400 / 621), cross-check 364 / 386, batch 11 in 11.9 s. **FINAL
VALIDATION PASSED: 66 checks** (58 of §23.25 + the eight coach gates, each `= expected`). On the rebuilt
database: the eight gates 8/8 by direct evaluation; the operator's coach-only list (Todd, Kinnear, Cahill,
Brittain, Craig, McCartney, Bolton) and Fagan all `player_id` NULL / `unmatched`; Ron Barassi → player 11243,
Leigh Matthews → 8474, Mark Williams → 9150, each `unique` through their page's profile path, never the name.

**Not done / deviations.** (a) DEV (`afldb_dev`) carries neither migration 087 nor the coaches; DEV is not
semantic evidence. (b) `tests/integration/privileges.test.ts` fails one assertion on `afldb_test` both hand-migrated and after the
clean rebuild, unrelated to this stage: `external_grids` / `external_grid_axes` are writable but unregistered
because migration 080 (§20–§21) grants `afldb_import` a narrow INSERT on them deliberately outside the registry
and the suite's exclusion list was never extended — recorded as **`AFLDB-ISSUE-138`** (test-only; no privilege
is wrong); `coaches` and `match_coaches` are registered and writable and the other 34 assertions pass. (c) The coach page's Games Coached count is stored as evidence only; the 22 pages whose count differs
from the canonical assignments are the source's own ≤1922/1940 gaps and 2026, reported, not gated. (d) The
index's per-coach totals are kept in the parsed artefact for provenance and read by nothing.

**Files:** `tools/rebuild/afltables/acquire_coaches.py` (new), `tools/rebuild/afltables/afltables-contract.json`
(`coaches` block: rules, corrections, pin), `docs/rebuild-manifests/afltables_coaches/coaches-20260905.json`
(new), `data/sources/afltables/coaches/coaches-20260905/parsed/*.csv` (new, tracked), `.gitignore`,
`.gitattributes`, `src/db/migrations/087_coaches.sql` (new), `tools/migration/import_match_coaches.py` (new),
`tools/db/rebuild-test.ts`, `src/search/grid-solver-spec.ts`, `src/db/queries/grid-solver.ts`,
`src/db/queries/coaches.ts` (new), `src/app/grid-solver/page.tsx`, `src/app/grid-solver/GridSolverForm.tsx`,
`src/search/gridley-compat.ts`, `tests/coach-reconciliation.test.ts` (new), `tests/db-test-rebuild.test.ts`,
`tests/grid-solver-spec.test.ts`, `tests/gridley-compat.test.ts`, `tests/integration/grid-solver.test.ts`,
`tests/integration/gridley-corpus.test.ts`, `tests/integration/gridley-oracle-bridge.ts`, `CHANGELOG.md`,
`IssuesIndex.md`, `issues.md`, this runbook.

**Exact next action (fresh session):** siblings / father–son from `data/players/father-son/` (inspect the
`fathersonfather` and `brother` Gridley wording first; a reusable family-relationship model, explicit identity,
fail closed on ambiguity), then after-the-siren (`data/records/after-siren/`, establish `winaftersiren`'s exact
meaning), International Rules (`data/reference/international-rules/`, establish `intrulesplayer`'s meaning and
inventory the scrape programmatically), `season2024player`, the Tony Buhagiar All-Australian adjudication;
`spoils5season` and `recruitedByDodoro` stay deferred, `irish` / `tasmanian` / `nfl` presumptively deferred
pending their exact semantics. DEV load of the birth dates and coaches; production with the next deploy
(ISSUE-137 sequencing).

### 23.29 Family F (father–son / siblings) — father–son rule selections IMPLEMENTED; siblings blocked on a source export (5 September 2026, tenth session, Fable medium)

The §23.28 next action, item (1). Exact Gridley semantics were established from the stored wording first,
the existing schema was reused rather than redesigned, every identity is a profile path resolved once with
the evidence recorded, and the sibling half stops at a documented blocker rather than a bespoke data hunt.

**F.1 Exact criterion semantics (stored Gridley wording, `tests/fixtures/gridley/corpus.json`).**
`fathersonfather` — title FATHER OF, subtitle A FATHER-SON PICK — "Player has had a son selected under
the Father-Son rule in the national draft (since 1986)": 3 occurrences, one wording. The axis is the
**father** (a VFL/AFL player) of a son selected under the rule; the son's own AFL career is irrelevant.
`brother` — title BROTHER, subtitle PLAYED — "Has at least one brother who has played in the VFL/AFL.":
53 occurrences, one wording. The relationship at any time; nothing about playing with or against him.

**F.2 What AFLDB already had.** Migration 006 created `player_relationships` (the general family model:
`relationship_type` enum `parent_child | sibling | grandparent_grandchild | aunt_uncle_niece_nephew |
cousin | spouse | in_law | other`, both sides nullable with the raw names as the durable record) and
`father_son_selections` (one row per selection: drafted son, father, club, year, pick, rule, competition,
two independent `link_status` columns); migration 044 gave both the `(source_id, source_record_id)`
natural key; both are in the 039/045 read and write registries. **Neither has ever held a row.**
`draft_picks` carries 118 `signing_kind = 'Father-Son'` rows (1988–2025) with the father only as free text
in `signing` ("Father-Son (David Cloke)", two "(?????)"), and on the rebuilt `afldb_test` the draft link
layer is 5 resolved / 6,805 unmatched, so it can key neither person. DraftGuru's flag is also broader than
the rule (Josh Dunkley 2015, Darryl McDowell-White 2022, Charlie Banfield 2025 carry it; the 1997–1998
third-round selections do not). The legacy Sports Data Lab SQLite (`docs/data-dictionary.md` §4.4) holds
Wikipedia-derived families — `family_members` 2,290, `family_relationships` 1,046 (`sibling` 485,
`parent_child` 537), `family_draft` 142 — PLANNED for `player_relationships` and never migrated.

**F.3 The source and its normalisation.** `data/players/father-son/vfl-afl.csv` (raw, untracked) is the
"List of father–son selections" table of the Wikipedia article **Father–son rule** (pageid 4274230,
revision 1370239415, 2026-08-19T23:51:53Z, read from the MediaWiki API this session): 131 lines = header +
**127 selections (1988–2025)** + 3 trailer rows (sources; "Games Played last updated 12/10/2025"; the
selection-number note: none before 1997, third round 1997–2006, bidding since 2007). Seven columns; the
year is the selection year (the draft, or the pre-draft listing, of that year); `Selection` is blank
(22 rows, → `pre-draft`), a pick (96, → `national`) or "N (rookie)" (9, → `rookie`). The games columns are
**club-grain**: the son's games for the drafting club and the father's for the qualifying club (David
Cloke 114 of 333 at Collingwood; Gary Ablett Sr 242 of 248 at Geelong; state-league qualifications are
annotated — "146 (Claremont)", "391 (Port Adelaide in SANFL)", "N/A (Administrator)"). They are therefore
corroboration, reported per row, never a selector. Duplicate structure: none (a son appears once; fathers
repeat — David Cloke three sons, fifteen fathers two). The AFLW file (18 rows) was not used: it is out of
ISSUE-118's VFL/AFL scope and the AFLW identity layer is separate.

**F.4 Identity rules (`tools/migration/father_son.py normalize`, run once against `afldb_test`, output
tracked).** Nothing downstream matches a name; the normaliser resolves each person to an AFL Tables
profile path with deterministic rules and **refuses the run on anything it cannot decide from the row's
own evidence**: names normalised (diacritics, punctuation, the `^` listed marker, middle initials,
`Jr./Sr./Snr.`); a **son** is the unique same-name player who debuted in `[year, year+7]` and played for
the drafting club's organisation; a **father** the unique same-name player who debuted at least 15
seasons before the selection and played for that organisation's lineage (an organisation's own
identities — Footscray, South Melbourne, Kangaroos — plus Fitzroy and the Bears for the Lions, whose
eligibility recognises them); `Sr.`/`Jr.` keep the earliest/latest debut only when that season is unique
among the candidates (a shared season stays ambiguous — the unit test caught the first draft deciding
such a tie); zero candidates is a non-player only when the list itself says so (son 0 games; father with a
state-league/administrator annotation); every other zero, every name-and-era-only father (state-league
qualification) and every ambiguity needs a tracked adjudication. Measured: **127 rows, 0 ambiguous; sons
99 linked / 28 never played (list 0 games, no candidate); fathers 123 linked (107 distinct) / 4 with no
VFL/AFL career (Garry Fletcher — administrator; Noel Morton — Claremont; Jim Michalanney — Norwood; Peter
Morrison — see below)**; games corroborated on 210 of the 222 linked people, the 12 differences all the
list's own club-grain or stale figures (Michael Bowden 57 vs 59 on his second row, Robert Walls 215 vs
Carlton 218, David Clarke 207 vs Geelong 202, Andrew Bews 164 vs Geelong 207, and eight sons' club-grain
totals).

**F.5 Adjudications — `data/players/father-son-adjudications.csv` (7 rows, each evidence-dated
2026-09-05; every one must be needed and apply exactly once or the normaliser refuses).** Two name
variants: **Brad Campbell** (Melbourne 1992) → `players/B/Bradley_Campbell.html` (AFL Tables and
DraftGuru give the full name; Melbourne, 1 game in 1994 = the list's 1); **Billy Brownless** (Geelong
2018) → `players/B/Bill_Brownless.html` (Geelong 1986–1997, 198 games = the list's 198; Wikipedia
"Bill Brownless", Anthony William, uses Billy throughout; DraftGuru "Father-Son (Bill Brownless)"). Four
state-league-qualified fathers whose lineage rule cannot fire, each tied by a Wikipedia article read this
session: **John McIntosh** (Ashley McIntosh's article: "played football for Claremont and St Kilda"; the
only John McIntosh on AFL Tables is St Kilda 1970–1972), **Bryan Cousins** (his article: Geelong debut
1975, 67 games to 1979, then Perth; father of Ben), **Russell Ebert** (his article: "his son Brett was
selected under the league's Father-son rule" 2002; 25 games for North Melbourne 1979), **Brian Peake**
(Brett Peake's article: "His father, Brian Peake, played … East Fremantle, Geelong, Perth"; Geelong
1981–1984). One explicit **non-link**: **Peter Morrison** (Brisbane Lions 1999) — the list records
"Unknown (W.G., Mayne)", a QAFL qualification; no source ties the Footscray/South Melbourne Peter Morrison
(1974–1981, b. 1956) to Shane Morrison, and a shared name is not identity, so the row loads with the
father `unmatched` by decision, not by omission.

**F.6 The tracked artefacts.** `data/players/father-son-selections.csv` (127 rows; the seven raw columns
verbatim plus `source_key` = `wikipedia-father-son-rule:<year>:<seq>`, `competition`, `selection_pick`,
each person's profile path, link status `unique | resolved | unmatched` and resolution note) and
`data/players/father-son-selections.source.json` (article, pageid, revision, raw row count, measures).
`father_son.py normalize --check` regenerates from the raw list and the adjudications against a database
and refuses on any byte difference (proven identical after the suffix-rule fix). `.gitignore` opts the
three files in explicitly; `.gitattributes` forces LF on `data/players/father-son-*` because the check
compares bytes.

**F.7 Canonical schema — migration `088_father_son_link_checks.sql`.** No new table: the two migration-006
tables are the model. 088 adds the draft_persons-style CHECKs (a trusted status carries a player, an
untrusted one does not — one per person column), a pair uniqueness constraint, and column comments for
`competition` and `selection_note`. No grant call: both tables were already registered. Applied to
`afldb_test` (150 ms).

**F.8 Loader — `father_son.py load` (the rebuild stage; `--validate-only` offline, `--dry-run`).** Reads
only the artefact; resolves every non-empty profile through `external_identities` (afltables,
`afltables_profile_url`, unique/resolved) and refuses any that does not resolve or any status that
disagrees with its path; upserts `father_son_selections` on `(source wikipedia, source_key)` with
`club_id` = the organisation's identity contesting the following season, and one `parent_child` row per
selection in `player_relationships` (father as person A, son as person B, names verbatim, links where
proven, label "father and son (AFL father–son rule selection)", `source_record_id`
`father-son:<source_key>`), removing stale rows of this source, in one `import_batches` transaction. On
`afldb_test`: **batch 23 — 127 selections (99 sons, 123 fathers, 107 distinct), 127 relationships, 0.9 s;
batch 24 identical, 0 stale removed — idempotent.** `draft_picks` was not touched: the 118 DraftGuru flags
remain the draft source's own evidence, not the canonical selection record.

**F.9 Rebuild integration (`tools/db/rebuild-test.ts`).** Data stage **`father-son`** after `coaches` and
before `draftguru` (argv `father_son.py load --csv … --provenance …`; it joins only players and the
identities `fitzroy` registered); the preflight proves the three tracked files exist and runs
`--validate-only` before the destructive reset; **six final gates read from the artefact itself**
(`father_son_selections` 127, `father_son_sons_linked` 99, `father_son_fathers_linked` 123,
`father_son_distinct_fathers` 107, `father_son_links_outside_trusted_status` 0,
`player_relationships_parent_child` 127) — none typed, none reading a name; a small RFC 4180 reader
(`parseCsvRows`) because the notes carry commas. Stages 18 → **19** (data 12 → 13), gates 66 → **72**.
Evaluated against the hand-loaded `afldb_test`: **6/6 PASS.** `tests/db-test-rebuild.test.ts` 256 →
**261/261** (stage order, argv/preflight derivation, artefact-reader refusals, preflight refusals, gate
shape and registration).

**F.10 Grid Solver and Gridley.** Two builders in Draft & recruitment, no parameters, linked rows only:
**`father_son_father`** (a player whose son was selected under the rule) and **`father_son_selection`**
(a player selected under it). `GRID_BUILDERS` 154 → **156**. `gridley-compat.ts`: `fathersonfather` →
`father_son_father`; `NO_FATHER_LINK` gone; `brother` stays data-absent with its reason rewritten to the
actual state (F.12). Denominators: mapped 6,771 → 6,774 occurrences / 828 → 829 criteria; **data-absent
86 → 83 occurrences, 10 → 9 criteria** (brother 53, season2024player 14, intrulesplayer 5, winaftersiren
4, irish 2, recruitedByDodoro 2, nfl 1, spoils5season 1, tasmanian 1). The corpus test probes
`father_son_selections` as a dataset (`fatherSon` gap) so an empty table reports a gap, never a guess.
`tests/integration/grid-solver.test.ts`: solver counts equal SQL truth for both builders; Gary Ablett Sr
(`Gary_Ablett0`) is the father of the 2001 and 2004 rows and Gary Jr (`Gary_Ablett1`) a son, not a father;
Brayden Shaw (never played) and Jim Michalanney (no VFL/AFL career) are rows with no player and no
fabricated one; the relationship counts equal the selection counts — **198/198**.

**F.11 Evidence, before → after, same `afldb_test` (migration 088 + batch 23/24 by hand).**

| Measure | Before (§23.28) | After |
|---|---:|---:|
| `unsupported` cells / valid criteria | 258 / 10 | **249 / 9** |
| unsupported occurrences (compat) | 86 | **83** |
| cells solved | 9,677 / 10,287 | **9,686 / 10,287** |
| `dataset gap` | 354 | 354 |
| `source conflict` / `adjudicated source conflict` | 0 / 62 | 0 / 62 |
| `external source disagreement` | 242 | 242 |
| `list membership` | 844 | 844 |
| `incorrect known answer` | 0 | **0** |
| timeouts / cells over 1 s | 0 / 15–18 | 0 / 18 diagnostic, 16 strict (max 1.9 s) |
| strict failing cells | 612 | **603** = `unsupported` 249 + `dataset gap` 354 |
| `GRID_BUILDERS` | 154 | 156 |
| rebuild stages / data stages / final gates | 18 / 12 / 66 | 19 / 13 / 72 |

The 9 `fathersonfather` cells (3 boards, 107 eligible fathers, 9 ms) produced **no finding of any
category** — every bridged Gridley answer agrees with AFLDB in both directions. Diagnostic 1,164/1,164
(294 s); strict 1,162/1,164, failing only on the two acceptance assertions. `father-son-reconciliation`
(new) 11/11; `grid-solver-spec` + `gridley-compat` green with the new denominators; `tsc --noEmit` clean;
eslint on every touched file clean apart from the two pre-existing warnings outside the edited ranges.

**F.12 Siblings — investigated, BLOCKED on a source export, not started.** The repository holds no
sibling evidence: the raw father–son list has none, `player_relationships` has none, and nothing tracked
does. The only accepted-lineage source is the legacy SQLite `family_relationships` (485 `sibling` pairs,
Wikipedia-derived, with `family_members` for identity) at
`/home/arm/projects/sports_data_lab/data/afl/afl.db` on the DEV host — not on this workstation. Two
read-only SSH attempts to inspect its schema (an inline script, then the recorded scp-and-run-by-path
transport) were **denied by the session's permission classifier**, so the tables' shape and their
identity columns are unknown to this session and no sibling model was designed on guesses. A Wikipedia
"football families" scrape would be a disproportionate bespoke acquisition while a curated export already
exists, so per the brief this stops here. **Exact operator step:** on the DEV host,
`sqlite3 ~/projects/sports_data_lab/data/afl/afl.db ".schema family_members" ".schema family_relationships" ".schema family_draft"`
and export the three tables to CSV under `data/players/families/` (untracked raw, like `father-son/`);
the next session then normalises `sibling` pairs through the same profile-path discipline (the
`family_members` identity columns decide whether that is deterministic) into `player_relationships`
`sibling` rows, adds a `has_brother` builder over the same table, and maps `brother` (53 occurrences,
159 cells — the largest remaining family). `family_draft` (142) should also be compared with the 127
tracked selections as a second source.

**Not done / deviations.** (a) No unattended full rebuild this session: the stage, preflight and gates
are proven by the runner's unit tests and by evaluating the six gates against the hand-loaded database;
the next unattended `db:test:rebuild` will prove them end to end (expect 19 stages, FINAL VALIDATION
72/72). (b) The AFLW list is untouched. (c) `draft_picks` father-son flags and the canonical selections are
not reconciled programmatically (four DraftGuru-only, eleven Wikipedia-only rows noted in F.2); a data-QA
comparison is a possible follow-up, not a defect. (d) DEV carries none of migrations 087/088 nor the
data; DEV is not semantic evidence.

**Files:** `tools/migration/father_son.py` (new), `data/players/father-son-selections.csv`,
`data/players/father-son-selections.source.json`, `data/players/father-son-adjudications.csv` (new,
tracked), `.gitignore`, `.gitattributes`, `src/db/migrations/088_father_son_link_checks.sql` (new),
`tools/db/rebuild-test.ts`, `src/search/grid-solver-spec.ts`, `src/db/queries/grid-solver.ts`,
`src/search/gridley-compat.ts`, `tests/father-son-reconciliation.test.ts` (new),
`tests/db-test-rebuild.test.ts`, `tests/grid-solver-spec.test.ts`, `tests/gridley-compat.test.ts`,
`tests/integration/grid-solver.test.ts`, `tests/integration/gridley-corpus.test.ts`, `CHANGELOG.md`,
`IssuesIndex.md`, `issues.md`, this runbook.

**Exact next action (fresh session):** (1) operator exports the legacy family tables (F.12), then
siblings → `player_relationships` `sibling` + `has_brother` + `brother`; (2) after-the-siren
(`data/records/after-siren/`, establish `winaftersiren`'s exact meaning first); (3) International Rules
(`data/reference/international-rules/`, establish `intrulesplayer`, inventory the scrape
programmatically); (4) `season2024player`; (5) the Tony Buhagiar All-Australian adjudication;
`spoils5season` / `recruitedByDodoro` deferred, `irish` / `tasmanian` / `nfl` presumptively deferred. Run
the unattended 19-stage rebuild at the next checkpoint (expect FINAL VALIDATION 72/72). DEV load of birth
dates, coaches and father–son; production with the next deploy (ISSUE-137 sequencing).

### 23.30 Rebuild gate passed unattended — 19 stages, FINAL VALIDATION 72/72 (5 September 2026, eleventh session, Fable medium)

**Scope.** Validation only. Father–son (§23.29) was admitted to the rebuild after the last unattended
proof (§23.28, 18 stages / 66 checks), so the complete graph had to be proven from scratch against
`afldb_test` before the next canonical data family begins. No code, data or migration changed this session.

**Pre-run inspection.** `tools/db/rebuild-test.ts` `planStages()` declares exactly 19 stage ids in order:
precheck, recreate, migrations, privileges, reference, fitzroy, heights, heights-afl-api, heights-wikipedia,
birth-dates, coaches, **father-son** (directly after coaches, before draftguru), draftguru, awards-honours,
brownlow-season, derived, coleman, ladder-witness, fingerprints. `finalValidationChecks()` = the 66 checks of
§23.28 + `fatherSonChecks()` (six gates) = 72.

**Command (the documented one, unchanged):**

```text
npm run db:test:rebuild -- --acknowledge-destroy afldb_test --allow-owner-import-dsn --draftguru-label annual-html-20260902
```

with `AFLDB_PYTHON` = the workstation Python 3.12 (`…\Programs\Python\Python312\python.exe`, psycopg 3.3.5),
`C:\Program Files\PostgreSQL\16\bin` prepended to PATH for `psql`, and the SSH tunnel on 55432. Launched
detached from this worktree at HEAD `d6b6d57` via `Start-Process powershell` with output to a log file (the
harness's foreground/background tool timeout is 10 min, shorter than the rebuild).

**Result.** Started 19:22:37, `Rebuild complete.` 19:45:56, exit 0 — **23 min 19 s**. All 19 stages executed in
the declared order, none failed. PRECHECK (offline preflight incl. `father_son.py` shape/provenance check)
before destruction; migration `088_father_son_link_checks.sql` applied in 192 ms; FATHER–SON after COACHES:
127 selections, shape verified, provenance revision 1370239415, sons linked 99, fathers linked 123, distinct
fathers 107, `father_son_selections` 127, `player_relationships` 127, stale rows removed 0, batch 12 in 0.9 s.
**FINAL VALIDATION PASSED: 72 checks**, each `= expected`, the six father–son gates among them:
`father_son_selections` 127, `father_son_sons_linked` 99, `father_son_fathers_linked` 123,
`father_son_distinct_fathers` 107, `father_son_links_outside_trusted_status` 0,
`player_relationships_parent_child` 127.

**Warnings (all harmless, all pre-existing).** The `--allow-owner-import-dsn` OWNER notice (ISSUE-083, by
design on the workstation); the AWARDS & HONOURS unlinked-identity warnings (all_australian 5, rising_star
1 + 15, club_bf 4 + 1, named_medals 3 + 3, hall_of_fame 2, honour_teams 1, and 33 non-AFLDB club names kept
as `club_name_raw`) — identical in kind to §23.23/§23.25/§23.28 and already covered by the honours gates.
Nothing new was surfaced; no regression on this branch.

**Exact next action (fresh session):** Begin sibling-family canonical ingestion after operator export is
available (F.12: export the legacy family tables to CSV under `data/players/families/`, then siblings →
`player_relationships` `sibling` + `has_brother` + `brother`). Not started this session.

### 23.31 Family F (siblings) — canonical sibling pairs IMPLEMENTED, `has_brother`, Gridley `brother` mapped (5 September 2026, twelfth session, Fable medium)

The §23.30 next action. The operator export of the legacy football-families tables was present; this
session normalised its sibling rows through the father–son identity discipline into `player_relationships`,
mapped the largest remaining Gridley family, and — after a mid-session correction from the operator —
made the absence of a source row mean *unknown*, never *no brother*.

**F.13 The operator export and its schema.** `data/players/families/` (raw, untracked, as `father-son/`):
`family-schema.sql` (the legacy SQLite DDL), `family_members.csv` (2,290 rows: `source_member_id` — a
stable 24-hex key — `family_key`, `family_name`, `member_name`, `member_wikipedia_url` (2,115 non-empty),
`clubs_raw` (704 non-empty), `parent_source_member_id`, `explicit_relation_label`, the legacy name-match
columns `player_id` / `match_status` / `candidate_count` / `candidate_player_ids` / `match_notes`),
`family_relationships.csv` (1,046 rows keyed `source_relationship_id`, two member keys with roles,
`relationship_type`, `relationship_label`, `evidence` — the article sentence — `extraction_method`,
`confidence`, `source_url`, `source_revision_id`) and `family_draft.csv` (142). All rows are the Wikipedia
article **List of Australian rules football families**, revision **1365040810**, scraped
2026-08-02T08:44:41Z, legacy-imported 2026-08-12. `family_draft` is 127 AFL father–son + 15 AFLW
father–daughter rows: the AFL half is the domain §23.29 already made canonical from the article the rule
itself has, and it carried no identity the sibling normalisation needed, so it is **unused** (decision
recorded; nothing from it was imported or compared).

**F.14 Source relationship inventory (measured, not assumed).** `relationship_type`: `parent_child` 537,
`sibling` **485**, `grandparent_grandchild` 15, `cousin` 3, `aunt_uncle_niece_nephew` 3, `spouse` 2,
`in_law` 1. The 485 sibling rows: `relationship_label` `siblings/brothers` 454 (every one of whose
sentences says "brother(s)"), `siblings` 22, `twins` 9; roles `sibling`/`brother`/`twin`/`sister` (two
`sister` rows); `extraction_method` `prose_rule` for all 485; `confidence` `high` for all; **one row per
unordered pair** (485 distinct pairs; 239 written A<B, 246 B<A — the export's ordering is arbitrary);
**0 self-references; 0 duplicate source ids**. The 31 rows not labelled brothers: 9 `twins` (Atkins, Cook,
Febey, Fleming, Gowans, Lower, Williams, Selwood — whose sentence says brothers — and the AFLW Moody twins)
and 22 `siblings` (the Davies, Hamilton, Scholz, Svarc, Button/Martin and Dowrick sisters — AFLW; the
mixed Houghton, Laurie, O'Driscoll, Walker and Western pairs; the James and Strom families). The
estimate "~485 pairs" was exact for rows; the canonical pair count differs (F.16).

**F.15 Identity — `tools/migration/family_siblings.py normalize` (run once against the §23.30 `afldb_test`,
output tracked).** The legacy `player_id` cannot be used: the canonical rebuild seeds no
`legacy_player_id` (0 of 13,273 on `afldb_test`), so it maps to nothing and is carried only as an audit
column (`person_x_legacy`, e.g. `unique:9130`). AFLDB holds no Wikipedia identity source, so the URL is
evidence, not a key. Each of the **798** people named in a sibling row is resolved **once** to an AFL Tables
profile path: normalised name (the father–son normaliser's rules, including `Sr`/`Jr`) → the same-name
players with an AFL Tables identity, one per player (a player with two identities — Charlie Cameron 2604 —
is one candidate) → the listed clubs, when any is a VFL/AFL organisation, must include one the candidate
played for (lineage: Footscray/Bulldogs, South Melbourne/Sydney, Bears+Fitzroy/Lions; `&`, `/`, `,` and
`and` all separate clubs — the legacy parser had mis-scoped Rendell, the Knotts and Lewis Jetta as
`out_of_scope` on `&`/`and`) — listed clubs that are ALL outside the VFL/AFL (state-league lists, "Carlton
coach", "Port Adelaide rookie") mean the source says the person did not play VFL/AFL: unlinked whatever
the name matches → when more than one candidate remains and the article title carries a birth-year
disambiguator (`…(footballer, born 1940)`), the candidate whose canonical birth year (Stage D1) equals it,
**only if every candidate has a birth year** so the rule never decides by elimination → one candidate is
`unique`, none `unmatched`, several `ambiguous` and **unlinked** with the candidates recorded, unless a
tracked adjudication decides. Measured before adjudication: **672 unique, 118 unmatched, 8 ambiguous**;
the birth-year rule resolved 24 of the legacy's 32 ambiguities on its own. Agreement with the legacy match:
635 legacy-unique → unique, 9 legacy-resolved → unique, 4 legacy-`out_of_scope` → unique (the separator
bug above), 2 legacy-unique → unmatched (Zeke Uwland, Cody Curtin: 2025 debutants absent from the
`full-history-20260902` snapshot; they will link on the next baseline), 86 legacy-unmatched → unmatched.
**No name-only, surname, fuzzy or family-key link exists** (the reconciliation test proves every `unique`
note is exactly the rule chain).

**F.16 Adjudications — `data/players/sibling-adjudications.csv` (8 rows, keyed by `source_member_id`,
each evidence-dated 2026-09-05, each required to be needed and applied once or the run refuses).** All
eight are the leftover same-name ambiguities, each decided from the person's own Wikipedia article read
this session (birth date + club + debut season, matched to one AFL Tables profile): Alwyn Davey →
`Alwyn_Davey0` (b. 1984, Essendon 2007; `Alwyn_Davey1` is his 2004-born son), Ron Evans → `Ron_Evans1`
(b. 1939, Essendon 1958, Coleman 1959–60), John Gill → `John_Gill1` (b. 1941, Carlton 1962), Andrew L.
Krakouer → `Andrew_Krakouer0` (b. 1971, North Melbourne 1989; `Andrew_Krakouer1` is Jim's son), Bert
Lucas → `Bert_Lucas0` (b. 1922, Carlton 1944 / South Melbourne — both candidates had played for a listed
club), Jack Malone → `Jack_Malone1` (b. 1919, Footscray 1941; both candidates share the birth year so the
title rule could not decide), Frank Murphy → `Frank_Murphy0` (b. 1905, Collingwood 1925), Ian Nankervis →
`Ian_Nankervis0` (b. 1948, Geelong 1967). No explicit non-link was needed; **`ambiguous_sides` = 0**.

**F.17 Pairs, labels and the coverage rule.** Every export sibling row becomes one canonical `sibling`
row with the pair ordered deterministically (by profile path, else by `name:<normalised>`; roles travel
with their person), so a reversed source ordering can never produce a second canonical pair; the artefact
reader refuses an unordered, repeated or self pair. The Gardner family is listed twice in the article
(`gardner-0324`, `gardner-0327`, both Corrie ↔ Eric): the two rows resolve to the same two identities and
are **merged** into one canonical pair with the other key kept in `also_source_keys` (allowed only when
both people are linked; two unlinked namesake pairs refuse). The canonical `relationship_label` states
what the source evidences about sex: `brothers` (the export's own `siblings/brothers` label, or any
sentence saying brother(s)), `twin brothers`, `sisters` (a sentence saying sister(s)), or — because
`players` is the men's VFL/AFL and two players who are siblings are brothers — `brothers` / `twin
brothers` for a `siblings` / `twins` row whose two people both resolve to canonical players; otherwise
the export's label. **Operator correction, applied mid-session:** a pair the export does not carry is
*unknown coverage*, never a negative — the article's prose rule saw "Gary is … father of Gary Jr. and
Nathan" and produced only parent–child rows, and it produced no sibling row for the Mooneys or the Wakelin
twins although the family notes say "Jason is Cameron's elder brother" and "Darryl and Shane are
identical twin brothers". Such a pair is admitted only with explicit independent evidence through
**`data/players/sibling-supplements.csv`** (14 rows, each naming both profile paths, the label, the quoted
sentence — a brothers supplement must quote "brother(s)", never a shared parent or surname — and the
date; a supplement must be needed, i.e. absent from the export, and both profiles must be canonical
identities, or the run refuses). The 14: Gary Ablett Jr ↔ Nathan Ablett (the correction's own case,
"the younger brother of Gary Ablett Jr"), Angus ↔ Andrew and Angus ↔ Hamish Brayshaw, Brad ↔ Luke
Ottens, Cameron ↔ Jason Mooney, Darryl ↔ Shane Wakelin (twin brothers), Joe ↔ Darcy Daniher (6 Essendon
games), Kane ↔ Chad Cornes, Luke ↔ Matthew Ball (17 Hawthorn games), Peter ↔ Shaun Burgoyne, Sam Reid
(`Sam_Reid2`, b. 1991) ↔ Ben Reid, Travis ↔ Jason and Travis ↔ Cameron Cloke, Jake ↔ Will Kelly — every
one a pair the export's family sentence named only as a father's sons, found by the corpus run below and
then evidenced from the people's own articles (Jarryd Lyons's brother Corey was listed by Brisbane
2017–2020 and never played an AFL match, so no pair: F.21). **Tests never assert a negative from a missing
row**: the integration test asserts only presences, and the "does not qualify by one-sided rows" check is
a statement about what the canonical data proves, labelled as such.

**F.18 The tracked artefacts.** `data/players/sibling-relationships.csv` — **498 pairs** = 485 export rows
− 1 merged duplicate + 14 supplements (25 columns: source key, family, both people's name/role/URL/listed
clubs/legacy status/profile/link/note, canonical and source labels, the sentence, extraction method,
revision, merged keys); `sibling-relationships.source.json` (article, revision, raw file names and counts,
the type inventory, measures, label counts); the adjudications and supplements above. Measures (from the
artefact, never typed): pairs 498; **both linked 389, one linked 64, unlinked 45**; brother pairs linked
389; **players with a linked brother 658**; unlinked sides 154; ambiguous 0; adjudicated sides 9 (Andrew
Krakouer sits in two rows); merged 1; supplements 14; labels `brothers` 466, `twin brothers` 7, `sisters`
8, `siblings` 13, `twins` 3. `normalize --check` regenerates from the raw export + adjudications +
supplements against the database and refuses any byte difference — **proven identical** after every
regeneration this session. `.gitignore` opts the four files in; `.gitattributes` forces LF on
`data/players/sibling-*`.

**F.19 Loader and canonical rows.** `family_siblings.py load` (`--validate-only` offline, `--dry-run`)
reads only the artefact, resolves every profile through `external_identities` (afltables,
`afltables_profile_url`, unique/resolved) and refuses a missing identity or a status disagreeing with
its profile; writes one `player_relationships` row per pair — `relationship` `sibling`, `family_key` /
`family_name`, both names verbatim and roles, `relationship_label` as above, `confidence` `source`,
`evidence` = the sentence + article/family/revision (supplements: the quoted evidence + the supplement
key), `extraction_method` from the export (`adjudication` for supplements), `source_id` wikipedia,
`source_record_id` `siblings:<key>` — upserted on `(source_id, source_record_id)` with a `WHERE … IS
DISTINCT FROM` guard so an unchanged row is not rewritten, stale `siblings:%` rows of the source removed,
one `import_batches` transaction. No migration: the 006/044 schema represents the semantics; pair
uniqueness is enforced by the normaliser and gated (below), not by a new constraint. On `afldb_test` by
hand: batch 24 wrote 484 rows; batch 25 **0 inserted or changed, 0 stale** (idempotent); batches 26/28/30
added the supplements as they were evidenced (1, 12, 1 changed); batch 31 **0 changed**. Verified by SQL:
498 sibling rows (389 both linked), 127 parent_child rows untouched, **0 self-pairs, 0 duplicate
canonical pairs**, 658 distinct players with a linked brother, label counts as the artefact.

**F.20 Player-family compatibility — one real gap fixed.** `getPlayerFamily` already returns generic
rows (its filter excludes only `father-son:%`), and Gary Ablett Jr's page query now returns his Nathan
row. But `relationshipLabel()` rendered every `sibling` row as "Brother", which would have shown Joel
Western's unlinked sister Mikayla as a brother. Smallest fix: the query returns `relationship_label`,
`relationshipLabel(type, direction, label)` renders Brother / Twin brother / Sister / Twin / Sibling from
it, and `PlayerFamilyCard` passes it through (`tests/player-family-card.test.ts` updated). No other UI
change.

**F.21 Grid Solver and Gridley.** Builder **`has_brother`** (Biography, no parameters): a player with an
explicit canonical `sibling` row labelled `brothers` / `twin brothers`, both sides linked, whose other
side has `player_career_stats.games > 0` (AFLDB's "played" semantics; two 0-game players exist) — never a
surname, family key or shared parent. `GRID_BUILDERS` 156 → **157**. `gridley-compat.ts`: `brother`
(stored wording "Has at least one brother who has played in the VFL/AFL.", 53 occurrences, one wording)
→ `has_brother`; `NO_SIBLINGS` gone. Denominators: mapped 6,774 → **6,827** occurrences / 829 → **830**
criteria; **data-absent 83 → 30 occurrences, 9 → 8 criteria** (season2024player 14, intrulesplayer 5,
winaftersiren 4, irish 2, recruitedByDodoro 2, nfl 1, spoils5season 1, tasmanian 1). The corpus test
probes sibling rows as a dataset (`siblings` gap) and gains a **`source coverage gap`** category (a
DATA_GAP: fails strict, counted in diagnostic): a `has_brother` cell where Gridley lists a player and the
canonical sibling sources carry no brothers row for him — unknown coverage, open until an evidenced pair
is admitted; the reverse direction (AFLDB lists on a cited brothers row, Gridley omits) reports as
`external source disagreement` naming the row. `tests/integration/grid-solver.test.ts`: solver count =
SQL truth (658), every row in the truth set, Gary Sr ↔ Geoff/Kevin from the export and Gary Jr ↔ Nathan
from the supplement (`siblings:afldb-sibling-supplement:001`), 0 self / duplicate pairs, no sisters row
links anyone — **200/200**.

**F.22 Corpus evidence, before → after, the same `afldb_test` (hand-loaded, diagnostic mode, 1,164/1,164).**

| Measure | Before (§23.30 state) | After (first run: export only) | After (final: + classification + 14 supplements) |
|---|---:|---:|---:|
| `unsupported` cells / data-absent criteria | 249 / 9 | 90 / 8 | **90 / 8** |
| unsupported occurrences (compat) | 83 | 30 | **30** |
| cells solved | 9,686 / 10,287 | 9,842 | **9,842 / 10,287** |
| `dataset gap` | 354 | 357 | 357 |
| `incorrect known answer` | 0 | 484 (12 players, all "Gridley lists, AFLDB omits") | **0** |
| `source coverage gap` (new) | — | — | **21 cells / 1 player** (Jarryd Lyons) |
| `external source disagreement` | 242 | 243 | 243 |
| `adjudicated source conflict` | 62 | 65 | 65 |
| `list membership` | 844 | 855 | 852 |
| timeouts / cells over 1 s | 0 / 16 | 0 / 18 | **0 / 16 (max 1.9 s)** |
| `brother` criterion | data-absent | 634 players, 29 ms | **658 players, 29 ms** |
| strict failing cells (derived) | 603 | — | 468 = `unsupported` 90 + `dataset gap` 357 + `source coverage gap` 21 |

The first run's 484 "incorrect" findings were 12 players Gridley credits with a brother and the export
did not pair: 11 were evidenced from the players' own articles and admitted as supplements (F.17), which
is admitting canonical evidence, not tuning to the oracle; the twelfth (Lyons: a listed-only brother) is
exactly the coverage category. `incorrect known answer` stayed 0 on every non-brother axis; the three
brother × `height195` cells classify under the height rules (1 disagreement, 3 adjudicated) as before.
No canonical row was changed to make a cell green.

**F.23 Rebuild integration.** Data stage **`siblings`** after `father-son`, before `draftguru` (argv
`family_siblings.py load --csv … --provenance …`); the preflight proves the four tracked files exist and
runs `--validate-only` before the destructive reset; **seven artefact-derived gates**:
`player_relationships_sibling` 498, `sibling_pairs_both_linked` 389, `sibling_unlinked_sides` 154,
`sibling_brother_pairs_linked` 389, `sibling_players_with_brother` 658, `sibling_self_pairs` 0,
`sibling_duplicate_pairs` 0 (`least/greatest` grouping) — none reads a name or a family key. Stages 19 →
**20** (data 13 → 14), checks 72 → **79**. `tests/db-test-rebuild.test.ts` 261 → **266/266**.

**Full unattended rebuild — PASSED.** Launched detached from this worktree (uncommitted working tree at
HEAD `dfdd37e` + this session's changes) with the documented command, `AFLDB_PYTHON` = the workstation
Python 3.12, psql on PATH, tunnel on 55432. Started 21:36:17, `Rebuild complete.` 21:58:33, exit 0 —
**22 min 16 s**. All **20 stages** executed in the declared order: PRECHECK (both family preflights
before destruction), …, FATHER–SON (batch 12: 127 selections / 127 relationships), **SIBLINGS** (batch 13:
498 pairs, shape verified, provenance revision 1365040810, both linked 389, players with a linked brother
658, 498 inserted, 0 stale, 0.7 s — identical to the hand load), DRAFTGURU, … FINGERPRINTS. **FINAL
VALIDATION PASSED: 79 checks**, the seven sibling gates among them: `player_relationships_sibling` 498,
`sibling_pairs_both_linked` 389, `sibling_unlinked_sides` 154, `sibling_brother_pairs_linked` 389,
`sibling_players_with_brother` 658, `sibling_self_pairs` 0, `sibling_duplicate_pairs` 0;
`player_relationships_parent_child` 127 unchanged. Warnings: only the pre-existing OWNER notice and the
awards/honours unlinked-identity notes (§23.30). After the rebuild the 14 supplements were re-cited with
the families-page entry (F.17a: evidence text only, no count changed): `normalize --check` byte-identical,
hand reload batch 25 **14 changed** (the evidence column), batch 26 **0 changed** — the rebuilt
`afldb_test` therefore carries the committed artefact exactly. Strict corpus run on the rebuilt database:
1,162/1,164 — failing only on the two acceptance assertions, failing cells = `unsupported` 90 +
`dataset gap` 357 + `source coverage gap` 21 (no `incorrect known answer`, no timeout, 17 cells over 1 s).

**F.17a Upstream-page reconciliation (operator clarification, applied).** The operator directed that the
article itself — https://en.wikipedia.org/wiki/List_of_Australian_rules_football_families — is the
primary relationship source and the export only its parsed snapshot, and that every remaining brother
coverage gap be checked against the page, not the export. The page is too large for a single fetch, so
each relevant family entry was read by section through the MediaWiki parse API this session (Ablett §5,
Ball §47, Brayshaw §108, Burgoyne §140, Cloke §196, Cornes §216, Daniher §239, Kelly (3) §485, Lyons
§547; Mooney/Wakelin/Ottens/Reid from the export's `family_notes`, which is that page's entry text at
revision 1365040810). Result: the page is **explicit** for Mooney ("Jason is Cameron's elder brother")
and Wakelin ("Darryl and Shane are identical twin brothers") — both supplements now cite the page as the
primary evidence; for Ablett, Ball, Brayshaw, Burgoyne, Cloke, Cornes, Daniher, Kelly, Ottens and Reid
the page says only that the men are one father's sons, which is not brother evidence under the rule, so
those supplements rest on the players' own articles (each quoted) with the page entry cited as context.
**Lyons**: the page reads "Marty is the father of Jarryd and Corey" — no explicit brother statement — and
Corey Lyons (listed by Brisbane 2017–2020, no AFL match) has no canonical identity, so the pair cannot be
recorded and Jarryd's 21 cells remain a **genuine `source coverage gap`**. **Jake Kelly** was never
unresolved: he is `players/J/Jake_Kelly.html` (b. 21 January 1995, Adelaide/Essendon) on the roster and
in supplement 014 from the first; the earlier fetch failures were only wrong article slugs, and his
correct article (`Jake_Kelly_(Australian_footballer)`: pick 40, 2014 Rookie Draft, son of Craig Kelly;
it names no brother) is now cited as identity corroboration beside Will Kelly's article, which states the
relationship. Every supplement's `evidence` carries the page URL, revision, the quoted entry, and the
quoted article sentence, so each addition is auditable.

**F.24 Validation executed this session.** `family_siblings.py normalize` / `--check` (byte-identical, four
times); `load --validate-only`; load ×2 idempotent (batch 31: 0 changed); `tests/sibling-reconciliation.test.ts`
(new, 12/12: club parsing, title birth year, labels, suffix/club/year narrowing, outside-VFL/AFL lists,
adjudication needed/stale/unlinked, supplement needed/stale/non-identity, self-pair, duplicate-family
merge, artefact refusals, and the tracked artefact's counts derived from itself against the provenance);
`father-son-reconciliation` 11/11; `db-test-rebuild` 266/266; full unattended rebuild 20 stages / 79 checks (above); strict corpus 1,162/1,164 (acceptance assertions only); `grid-solver-spec` (157); `gridley-compat`
(new denominators, `brother` gone from the data-absent list); `player-family-card`; integration
`grid-solver` 200/200; corpus diagnostic 1,164/1,164 (296 s); `npx tsc --noEmit -p .` clean; eslint on
every touched file clean apart from the pre-existing `no-explicit-any` / unused-variable findings outside
the edited ranges.

**Deviations and follow-up.** (a) The export's coverage is incomplete for brothers the article names
only as a father's sons or in family notes its prose rule skipped — the 14 supplements are the ones the
corpus surfaced, not a census; a fresh extraction directly from the article (the operator noted its full
list; the export is that article at revision 1365040810) is the right next sibling step, kept out of this
milestone. (b) Jarryd Lyons's brother Corey never played (listed only): the 21 cells stay `source
coverage gap` by the corpus's own rule, and no pair is recorded because supplements require two canonical
players. (c) The AFLW-only sisters (8 rows) and mixed pairs are loaded unlinked; the AFLW identity layer is
separate. (d) `family_draft.csv` unused. (e) DEV carries none of this; DEV is not semantic evidence.

**Files:** `tools/migration/family_siblings.py` (new), `data/players/sibling-relationships.csv`,
`data/players/sibling-relationships.source.json`, `data/players/sibling-adjudications.csv`,
`data/players/sibling-supplements.csv` (new, tracked), `.gitignore`, `.gitattributes`,
`tools/db/rebuild-test.ts`, `src/search/grid-solver-spec.ts`, `src/db/queries/grid-solver.ts`,
`src/search/gridley-compat.ts`, `src/db/queries/players.ts`, `src/lib/family-format.ts`,
`src/components/PlayerFamilyCard.tsx`, `tests/sibling-reconciliation.test.ts` (new),
`tests/db-test-rebuild.test.ts`, `tests/grid-solver-spec.test.ts`, `tests/gridley-compat.test.ts`,
`tests/player-family-card.test.ts`, `tests/integration/grid-solver.test.ts`,
`tests/integration/gridley-corpus.test.ts`, `CHANGELOG.md`, `IssuesIndex.md`, `issues.md`, this runbook.

**Exact next action (fresh session):** begin the after-the-siren canonical data milestone
(`data/records/after-siren/`, establish `winaftersiren`'s exact meaning first). Then International Rules,
`season2024player`, the Tony Buhagiar adjudication; a fresh sibling extraction from the families article
when a sibling follow-up is scheduled. DEV load of birth dates, coaches, father–son and siblings;
production with the next deploy (ISSUE-137 sequencing).
