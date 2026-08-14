# AFLDB — Legacy Data Dictionary

Audit of the legacy AFL SQLite database that will act as the source and validation oracle for AFLDB.

| Field | Value |
|---|---|
| Legacy database | `afl.db` (SQLite, 537,010,176 bytes) |
| Authoritative copy | `/home/arm/projects/sports_data_lab/data/afl/afl.db` (dev server) |
| Local audited copy | `D:\dev\afldb\data\afl.db` — verified byte-size and aggregate-identical to the dev copy |
| Upstream source | `fitzRoy_data` → `afl_tables_playerstats/afldata.rda` (AFL Tables), plus independent scrapes |
| Season coverage | 1897 – 2026 (2026 in progress, latest match `2026-08-09`) |
| Built | 2026-08-12 12:51:20 |
| Objects | 44 tables |
| Access rule | **Read-only.** AFLDB never writes to this file. |

Classification vocabulary: `SOURCE`, `NORMALISED`, `DERIVED`, `CACHE`, `STAGING`, `LEGACY`, `REFERENCE`, `UNKNOWN`.

---

## 1. Core datasets

### 1.1 `games` — 694,210 rows — **SOURCE** ⭐ primary fact table

The authoritative player-match fact table and the foundation of AFLDB.

| Property | Value |
|---|---|
| Purpose | One row per player per match (player-game) |
| Source | AFL Tables via `fitzRoy` `afldata.rda`, loaded by `afl/build_db.py` |
| Coverage | 1897–2026, 13,361 distinct players, 17,027 distinct matches |
| Natural key | (`player_id`, `match_id`) — verified unique, 0 duplicates |
| Relationships | `player_id` → `players`, `match_id` → `matches` |
| Integrity | 0 NULL `player_id`, 0 NULL `match_id`, 0 orphans against `matches` |

Identity/context columns: `player_id`, `player`, `season`, `round`, `date`, `venue`, `club_hist`, `club_now`, `career_game_no`, `dob`, `birth_est`, `birth_year_est`, `opponent`, `is_home`, `result`, `points_for`, `points_against`, `is_final`, `match_id`, `match_event`.

Statistical columns (all `REAL` in SQLite; integer-valued in practice): `kicks`, `marks`, `handballs`, `disposals`, `goals`, `behinds`, `hitouts`, `tackles`, `rebounds`, `inside50s`, `clearances`, `clangers`, `frees_for`, `frees_against`, `brownlow`, `contested`, `uncontested`, `contested_marks`, `marks_i50`, `one_percenters`, `bounces`, `goal_assists`.

**NULL semantics — critical.** A NULL statistic means *not recorded in that era*, never zero. Per-stat availability is documented in `stat_coverage` and reproduced in §2.1. `goals` is the only statistic populated for all 694,207 measured player-games (100%); `goal_assists` reaches only 30.4%.

`round` values are `'1'`–`'25'` plus finals codes `EF`, `QF`, `SF`, `PF`, `GF` (text, not numeric — must not be cast blindly).

`result` ∈ {`W` 343,651, `L` 343,667, `D` 6,892}. `match_event` is NULL for 690,886 rows; otherwise `Anzac Day`, `Dreamtime at the 'G`, `King's Birthday`.

**Known issue.** `stat_coverage` reports 694,207 measured player-games against an actual 694,210 rows — a 3-row difference in the coverage measurement, not a data defect. Row-level integrity checks all pass.

---

### 1.2 `players` — 13,361 rows — **DERIVED** ⚠️ partially unsound

Career summary rebuilt from `games` by `afl/build_db.py`.

| Property | Value |
|---|---|
| Primary key | `player_id` (1–13,361, contiguous, no duplicates) |
| Relationships | 1:N → `games`; every player has ≥1 game, every game has a player |

Verified parity against `games` (0 mismatching rows in all three cases):

- `career_games` = `COUNT(games)` ✅
- `career_goals` = `SUM(games.goals)` ✅
- `finals_played` = `COUNT(games WHERE is_final=1)` ✅

**`career_brownlow` is NOT sound — do not migrate as a career total.** It is derived from `games.brownlow`, which only exists for 1931–1934 and 1984–2025. See §3.1. AFLDB must derive career Brownlow votes from `brownlow_results` instead.

**NULL semantics.** `dob` is NULL for 12,416 of 13,361 players (93% missing; only 945 known, essentially all modern). `birth_year`/`birth_year_min`/`birth_year_max` are *estimates* and must be presented as such. `career_brownlow` is NULL for 8,377 players.

**Name collisions confirm ID-based identity is mandatory** (requirement #20): `name_key` `peter brown` maps to 6 distinct players; `bill jones` and `les jones` to 5 each. Ron Barassi Sr (`2520`, debut 1936) and Jr (`2521`, debut 1953), and Ted Whitten Sr (`2268`) and Jr (`2443`), are correctly distinct rows.

Obscurity-model columns (`obscurity`, `*_component`, `obscurity_confidence`, `obscurity_model`) are a Sports Data Lab feature. **Classified `LEGACY` — not migrated to AFLDB.**

---

### 1.3 `matches` — 17,027 rows — **DERIVED**

Match-level table derived from `games` (`meta.matches_derived = 2026-08-12 14:04:58`) by `afl/derive_matches.py`.

| Property | Value |
|---|---|
| Key | `match_id` (unique), `match_key` (unique, `season|round|date|home|away`) |
| Coverage | 1897–2026; 718 finals; all 17,027 rows `data_status='player_stats'`, `game_status='played'`, `home_away_known=1` |

**Type problems to fix in PostgreSQL:** `home_score`/`away_score`/`margin` are `REAL` (must be `smallint`); `attendance` is `TEXT` (must be `integer`, NULL for 1,651 matches); quarter columns `home_q1`–`away_q4` are `TEXT` and hold *cumulative* points.

---

### 1.4 `match_details` — 17,027 rows — **SOURCE**

Per-match detail scraped from AFL Tables: attendance (`INTEGER`, NULL for 1,651), `match_time`, `scheduled_datetime`, and full quarter-by-quarter goals/behinds/points for both sides (0 NULLs on `home_q1_points`). Richer and better-typed than the quarter columns on `matches` — **AFLDB should prefer `match_details` for quarter scores and attendance.**

---

### 1.5 `clubs` — 18 rows — **REFERENCE**

Modern AFL clubs only: `club_id` (slug), `name`, `abbreviation`, `db_club_now`, `wikipedia_title`, `afltables_slug`, `active`.

**Incomplete for historical purposes.** Three historical entities appear in `games.club_now` and `team_seasons` but are absent here: **Fitzroy**, **University**, **Brisbane Bears**. AFLDB's `clubs` table must cover all 24 historical identities (requirement #21).

---

### 1.6 Club identity — 24 historical entities → 18 modern clubs

`games` carries both `club_hist` (identity at the time) and `club_now` (modern successor). This is a genuine strength and must be preserved.

| `club_hist` | `club_now` | Player-games | Seasons |
|---|---|---|---|
| Carlton | Carlton | 53,477 | 1897–2026 |
| Collingwood | Collingwood | 54,501 | 1897–2026 |
| Essendon | Essendon | 52,825 | 1897–2026 |
| Geelong | Geelong | 52,706 | 1897–2026 |
| Melbourne | Melbourne | 51,849 | 1897–2026 |
| St Kilda | St Kilda | 51,222 | 1897–2026 |
| Richmond | Richmond | 49,171 | 1908–2026 |
| Hawthorn | Hawthorn | 44,189 | 1925–2026 |
| North Melbourne | North Melbourne | 39,260 | 1925–2026 |
| **Kangaroos** | North Melbourne | 4,598 | 1999–2007 |
| **Fitzroy** | *Fitzroy* | 37,224 | 1897–1996 |
| **South Melbourne** | Sydney | 30,049 | 1897–1981 |
| Sydney | Sydney | 22,420 | 1982–2026 |
| **Footscray** | Western Bulldogs | 28,225 | 1925–1996 |
| Western Bulldogs | Western Bulldogs | 15,252 | 1997–2026 |
| **University** | *University* | 2,268 | 1908–1914 |
| **Brisbane Bears** | *Brisbane Bears* | 4,510 | 1987–1996 |
| Brisbane Lions | Brisbane Lions | 15,483 | 1997–2026 |
| West Coast | West Coast | 20,165 | 1987–2026 |
| Adelaide | Adelaide | 18,038 | 1991–2026 |
| Fremantle | Fremantle | 15,889 | 1995–2026 |
| Port Adelaide | Port Adelaide | 15,277 | 1997–2026 |
| Gold Coast | Gold Coast | 7,858 | 2011–2026 |
| Greater Western Sydney | GWS | 7,754 | 2012–2026 |

Note the naming inconsistency: `club_hist` uses `Greater Western Sydney` while `club_now` uses `GWS`. Fitzroy, University and Brisbane Bears map to themselves (no modern successor) — Brisbane Bears merged into Brisbane Lions in 1997 but the data deliberately keeps them distinct.

---

### 1.7 `team_seasons` — 1,640 rows — **DERIVED**

Season ladder per club: `season`, `club_now`, `played`, `wins`, `draws`, `losses`, `points_for`, `points_against`, `premiership_points`, `percentage`, `ladder_rank`, `wooden_spoon`. Coverage 1897–2026, no NULL `ladder_rank` or `premiership_points`. Columns are untyped in SQLite (declared without a type) — must be typed explicitly in PostgreSQL.

### 1.8 `season_goals` — 59,089 rows — **DERIVED**

Player-season goal totals with `is_club_leading` flag (1,673 leading seasons), 1897–2026. Reproducible from `games`.

### 1.9 Venues — 52 distinct

Venue names live as free text on `games.venue` and `matches.venue`; there is no venue entity table. 52 distinct names, from `M.C.G.` (132,582 player-games, 1897–2026) down to single-season grounds (`Albury`, `Euroa`, `Yallourn`, `Brisbane Exhibition` — all 40 player-games in 1952). Abbreviated forms (`M.C.G.`, `S.C.G.`, `W.A.C.A.`) need canonical names plus aliases in AFLDB.

---

## 2. Reference data

### 2.1 `stat_coverage` — 22 rows — **REFERENCE** ⭐ essential for requirement #96

Documents per-statistic availability. **Must be migrated** — it is what lets the UI distinguish a true `0` from *not recorded*.

| Stat | From | To | Populated |
|---|---|---|---|
| goals | 1897 | 2026 | 100.0% |
| brownlow | 1931 | 2025 | 48.5% ⚠️ *not continuous — see §3.1* |
| behinds, disposals, handballs, kicks, marks | 1965 | 2026 | ~64.1% |
| frees_for, frees_against | 1965 | 2026 | 64.0% |
| hitouts | 1966 | 2026 | 62.2% |
| tackles | 1987 | 2026 | 47.3% |
| clangers, clearances, inside50s, rebounds | 1998 | 2026 | 36.3% |
| bounces | 1999 | 2026 | 35.1% |
| contested, uncontested, contested_marks, marks_i50, one_percenters | 1999 | 2026 | 35.1% |
| goal_assists | 2003 | 2026 | 30.4% |

**Caveat.** `available_from`/`available_to` are min/max bounds, **not** a guarantee of continuity. The `brownlow` row is the proven counter-example. AFLDB should store per-season presence rather than trusting the range alone.

### 2.2 `meta` — 8 rows — **REFERENCE**

Build provenance: upstream source URL, season range, build timestamp, and per-import timestamps.

---

## 3. Awards, honours and votes

### 3.1 `brownlow_results` — 16,120 rows — **SOURCE** ⭐ authoritative Brownlow

Season Brownlow totals per player, scraped from AFL Tables, 1924–2025. 112 winners. All 16,120 rows are player-matched (15,058 `unique`, 1,062 `resolved`; **0 unmatched**). Columns include `votes`, `vote_rank`, `eligible_rank`, `ineligible`, `winner`, `games`, `three_vote_games`/`two_vote_games`/`one_vote_games`, `polling_games`.

**This is the authoritative source for season and career Brownlow votes in AFLDB.** Total 79,113 votes.

### 3.2 `brownlow_round_votes` — 194,033 rows — **SOURCE**

Round-by-round votes, **1984–2025 only**, keyed (`result_id`, `round_number`) across 8,570 results.

### 3.3 `awards` — 1,810 rows — **SOURCE**

38 distinct award types across `award`, `club_best_and_fairest` and `draft_pick` categories: Brownlow, Coleman, Norm Smith, All-Australian squad, Rising Star, AFLPA MVP, every club best-and-fairest, plus state-league medals (Magarey, Sandover, Liston, Morrish) and junior awards (Larke, Hunter Harrison). Most series begin 1980. Player identity is via `dg_person_id` → `dg_people` → `person_links` → `player_id`, **not** a direct `player_id`.

### 3.4 `all_australian` — 906 rows / `all_australian_history` — 1,252 rows — **SOURCE**

All-Australian selections 1979–2025 with position, captaincy flags. All 906 rows carry `dg_person_id`.

### 3.5 `hall_of_fame` — 343 rows — **SOURCE**

Australian Football Hall of Fame; 34 Legends. 241 of 343 matched to `player_id` (70%) — the remainder are largely non-VFL/AFL figures (coaches, administrators, state-league players) and should not be forced to match.

### 3.6 `captaincies` — 1,375 rows — **SOURCE**

Club captains by season; **all 1,375 rows matched to a `player_id`**. Role is uniformly `Captain`.

### 3.7 `rising_star_nominees` — 766 rows — **SOURCE**

Round-by-round Rising Star nominations from 1993 with per-nomination stat lines, `ineligible` flags and winner marking.

### 3.8 `team_selections` — 113 rows — **SOURCE**

Teams of the Century / similar honour teams, keyed (`team_name`, `name_key`).

---

## 4. Draft and relationships

### 4.1 `draft` — 6,810 rows — **SOURCE**

Draft/recruitment history 1981–2025 across 11 `draft_type` values, sourced from DraftGuru. Includes `pick`, `club`, `original_club`, `draft_age`, `height_cm`, `weight_kg`, `grade`, `competition`.

### 4.2 `draft_links` — 6,810 rows — **NORMALISED** ⚠️

Resolution of draft rows to `player_id`:

| `match_status` | Rows | Trust |
|---|---|---|
| `unique` | 4,816 | trusted |
| `resolved` | 176 | trusted |
| `unmatched` | 1,664 | **not linkable** |
| `implausible` | 153 | rejected |
| `ambiguous` | 1 | rejected |

Only `unique` + `resolved` (4,992 of 6,810, 73%) may be trusted. **AFLDB must not silently treat unmatched draft rows as matched.**

### 4.3 `dg_people` (5,320) / `person_links` (5,320) — **NORMALISED**

DraftGuru person registry and its resolution to `player_id`. This is the identity bridge for `awards` and `all_australian`.

### 4.4 `family_members` (2,290) / `family_relationships` (1,046) / `family_draft` (142) — **SOURCE**

Wikipedia-derived football families. Relationship types: `parent_child` 537, `sibling` 485, `grandparent_grandchild` 15, `aunt_uncle_niece_nephew` 3, `cousin` 3, `spouse` 2, `in_law` 1. `family_draft` covers father–son draft selections.

---

## 5. Scraped club and venue aggregates — **CACHE**

These are pre-computed scrapes of AFL Tables / Wikipedia pages. AFLDB can recompute most of them from `games`, so they are primarily **cross-validation oracles**, not migration targets.

| Table | Rows | Purpose |
|---|---|---|
| `club_player_register` | 15,310 | Per-club player register (cap no., jumper, DOB, height/weight) — **useful: a second DOB source** |
| `club_player_records` | 15,120 | Per-club record leaderboards |
| `club_player_totals` | 7,612 | Per-club career totals per player |
| `club_player_averages` | 7,612 | Per-club career averages per player |
| `club_match_sources` | 34,054 | Per-club match rows (STAGING) |
| `club_match_source_issues` | 0 | Detected cross-source conflicts — **currently empty** |
| `club_source_snapshots` | 72 | Scrape provenance (sha256, fetched_at) |
| `club_wikipedia_fields` | 333 | Club infobox fields |
| `venue_summary` | 52 | Per-venue totals |
| `venue_team_records` | 670 | Per-venue team records |
| `venue_player_records` | 1,638 | Per-venue player career records |
| `venue_player_game_records` | 1,396 | Per-venue single-game records |
| `venue_match_records` | 1,284 | Per-venue match records |

## 6. Audit / staging / legacy — **not migrated**

| Table | Rows | Class | Note |
|---|---|---|---|
| `afltables_match_scores` | 17,018 | STAGING | Score reconciliation audit |
| `afltables_player_index` | 13,358 | STAGING | Player profile reconciliation |
| `manual_round_fixtures` | 36 | STAGING | Manual fixture patches |
| `manual_round_games` | 828 | STAGING | Manual player-game patches |
| `historic_grids` | 1,124 | LEGACY | Sports Data Lab puzzle feature |
| `sqlite_stat1` | 118 | LEGACY | SQLite planner statistics |

---

## 7. Known gaps and issues

1. **Brownlow per-game votes are discontinuous — 1931–1934 and 1984–2025 only.** `players.career_brownlow` (46,979 votes) understates the authoritative total (79,113) by **32,134 votes / 40.6%**. Bob Skilton (3× medallist) shows NULL instead of 180; Dick Reynolds (3×) shows 31 instead of 154. **Resolution: `brownlow_results` is authoritative for season/career totals; `games.brownlow` is per-game detail only.**
2. **DOB is 93% missing** (945 of 13,361). `club_player_register` is a candidate second source. Birth-year fields are estimates and must be labelled as such.
3. **`clubs` omits Fitzroy, University and Brisbane Bears** — AFLDB needs all 24 historical identities.
4. **1,664 draft rows (24%) are unmatched** to a player.
5. **1,651 matches (9.7%) have no attendance** — mostly early-era and 2020 COVID matches.
6. **No venue entity table** — 52 free-text names needing canonicalisation and aliases.
7. **`awards` links through `dg_person_id`, not `player_id`** — a two-hop join with its own match-status filtering.
8. **`stat_coverage` ranges are min/max, not continuity guarantees.**
9. **Loose SQLite typing throughout** — `REAL` counters, `TEXT` attendance and quarter scores.
10. **2026 is an in-progress season** (189 matches, to 2026-08-09) and must not be presented as complete.
