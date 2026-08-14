# AFLDB — Migration Inventory

Maps every legacy table to its AFLDB target. Row counts are **measured** from the audited database (built 2026-08-12), not carried over from historical documentation.

Status vocabulary: `PLANNED`, `IN PROGRESS`, `MIGRATED`, `VALIDATED`, `DEFERRED`, `NOT MIGRATED`.

---

## 1. Core migration

| Legacy table | Legacy rows | Target table | Transformations | Status | Validation |
|---|---|---|---|---|---|
| `games` | 694,210 | `player_match_stats` | Type tightening (`REAL`→`smallint`); resolve `club_hist`/`club_now` → `club_id`; resolve `venue` → `venue_id`; preserve NULL-vs-0 stat semantics; bulk `COPY` | PLANNED | Row count, per-stat NULL counts, `SUM(goals)`=412,844, (player,match) uniqueness |
| `players` | 13,361 | `players` | Migrate identity + `dob`/birth estimates only. **Drop** `career_*` (rebuilt as derived) and **drop** all obscurity columns | PLANNED | Row count 13,361, contiguous IDs, `name_key` retained for search |
| `matches` | 17,027 | `matches` | `REAL`→`smallint` scores; `TEXT` attendance → `integer`; take quarter scores from `match_details`; resolve club/venue FKs | PLANNED | Row count, 718 finals, `match_key` uniqueness, FK integrity |
| `match_details` | 17,027 | `matches` (merged) + `match_quarter_scores` | Preferred source for attendance and quarter goals/behinds/points | PLANNED | 1,651 NULL attendance preserved as NULL |
| `clubs` (18) + `games.club_hist` (24) | 24 identities | `clubs` + `club_aliases` | **Expand to 24 historical identities**; add Fitzroy, University, Brisbane Bears; record successor relationships; normalise `Greater Western Sydney`/`GWS` | PLANNED | All 24 `club_hist` values resolve; no orphan player-games |
| *(derived from `games.venue`)* | 52 distinct | `venues` + `venue_aliases` | Create venue entities from free text; canonical names for `M.C.G.`, `S.C.G.`, `W.A.C.A.` | PLANNED | All 52 names resolve; 0 unmatched player-games |
| `team_seasons` | 1,640 | `club_seasons` / `ladder_entries` | Explicit typing (source columns are untyped); resolve `club_now` → `club_id` incl. Fitzroy/University/Brisbane Bears | PLANNED | 1897–2026 coverage, ladder rank continuity |
| *(derived)* | — | `seasons` | New table, 1897–2026, with `is_complete=false` for 2026 | PLANNED | 130 seasons |

## 2. Awards, votes and honours

| Legacy table | Legacy rows | Target table | Transformations | Status | Validation |
|---|---|---|---|---|---|
| `brownlow_results` | 16,120 | `brownlow_season_votes` | **Authoritative** season/career Brownlow source | PLANNED | `SUM(votes)`=79,113; 112 winners; 0 unmatched |
| `brownlow_round_votes` | 194,033 | `brownlow_round_votes` | 1984–2025 only; flag coverage explicitly | PLANNED | 8,570 distinct results |
| `games.brownlow` | (column) | `player_match_stats.brownlow_votes` | Per-game detail **only** for 1931–1934, 1984–2025; NULL elsewhere means *not recorded* | PLANNED | Per-season presence recorded in `stat_availability` |
| `awards` | 1,810 | `awards` + `award_winners` | Split award definitions from winners; resolve `dg_person_id` → `player_id` via `person_links`, keeping match status | PLANNED | 38 award types; unmatched retained but flagged |
| `all_australian` | 906 | `award_winners` (AA) | 1979–2025 with position/captain flags | PLANNED | 906 rows, all with `dg_person_id` |
| `all_australian_history` | 1,252 | `award_winners` provenance | Match-status detail | PLANNED | — |
| `hall_of_fame` | 343 | `hall_of_fame` | Keep 102 unmatched (non-VFL/AFL figures) as name-only | PLANNED | 343 rows, 34 Legends, 241 matched |
| `captaincies` | 1,375 | `captaincies` | All rows player-matched | PLANNED | 1,375 rows, 100% matched |
| `rising_star_nominees` | 766 | `award_nominations` | Round nominations with stat line and eligibility | PLANNED | 766 rows |
| `team_selections` | 113 | `honour_teams` | Teams of the Century etc. | PLANNED | 113 rows |

## 3. Draft and relationships

| Legacy table | Legacy rows | Target table | Transformations | Status | Validation |
|---|---|---|---|---|---|
| `draft` | 6,810 | `drafts` + `draft_picks` | 1981–2025, 11 draft types | PLANNED | 6,810 rows |
| `draft_links` | 6,810 | (link resolution) | **Only `unique` (4,816) + `resolved` (176) trusted.** 1,664 `unmatched`, 153 `implausible`, 1 `ambiguous` remain unlinked and are recorded as such | PLANNED | Exactly 4,992 linked picks |
| `family_members` | 2,290 | `player_relationships` source | Wikipedia families | PLANNED | 2,290 rows |
| `family_relationships` | 1,046 | `player_relationships` | 7 relationship types | PLANNED | 1,046 rows, type distribution preserved |
| `family_draft` | 142 | `player_relationships` (father–son) | Father–son draft rule | PLANNED | 142 rows |
| `dg_people` | 5,320 | `external_identities` | DraftGuru identity bridge | PLANNED | 5,320 rows |
| `person_links` | 5,320 | `external_identities` | Resolution with match status | PLANNED | — |

## 4. Reference and provenance

| Legacy table | Legacy rows | Target table | Transformations | Status | Validation |
|---|---|---|---|---|---|
| `stat_coverage` | 22 | `stat_availability` | **Expanded to per-season presence**, not just min/max — the `brownlow` gap proves ranges are insufficient | PLANNED | 22 stats; Brownlow gap 1935–1983 represented |
| `meta` | 8 | `sources` / `import_batches` | Build provenance | PLANNED | — |
| `season_goals` | 59,089 | *(derived)* | Rebuilt from `games` as `player_season_stats` | PLANNED | Recomputed totals match legacy exactly |

## 5. Derived data — rebuilt, not migrated

Recomputed in PostgreSQL from authoritative tables and validated against the legacy values.

| Target | Derivation | Validation oracle |
|---|---|---|
| `player_season_stats` | Aggregate `player_match_stats` by (player, season, club) | `season_goals` 59,089 rows; 1,673 club-leading seasons |
| `player_career_stats` | Aggregate `player_match_stats` + `brownlow_season_votes` | `players.career_games` (Σ=694,210), `career_goals` (Σ=412,844), `finals_played` — all previously verified 0-mismatch |
| `player_career_stats.brownlow_votes` | **From `brownlow_season_votes`, NOT `games.brownlow`** | Σ=79,113 (legacy `players.career_brownlow` Σ=46,979 is wrong) |
| `club_seasons` | Aggregate matches + `team_seasons` | 1,640 rows |
| Record leaderboards | Aggregate/window queries | `club_player_records`, `venue_*` scrapes as cross-check |

## 6. Not migrated

| Legacy table | Rows | Reason |
|---|---|---|
| `players.obscurity*`, `*_component` | (columns) | Sports Data Lab feature, out of AFLDB scope |
| `historic_grids` | 1,124 | Sports Data Lab puzzle feature |
| `afltables_match_scores` | 17,018 | Reconciliation audit artefact |
| `afltables_player_index` | 13,358 | Reconciliation audit artefact |
| `club_match_sources` | 34,054 | Staging for the derived `matches` table |
| `club_match_source_issues` | 0 | Empty |
| `manual_round_fixtures` / `manual_round_games` | 36 / 828 | Manual patches already folded into `games` |
| `club_source_snapshots` | 72 | Scrape provenance; retained in legacy only |
| `sqlite_stat1` | 118 | SQLite internal |
| `club_player_*` (4 tables) | 45,654 | **Retained as validation oracles**, not migrated — recomputable from `games`. Exception: `club_player_register` is mined for DOB. |
| `venue_*` (5 tables) | 5,040 | **Retained as validation oracles** — recomputable from `games` |

---

## 7. Totals

| Category | Legacy rows | Migrating |
|---|---|---|
| Core facts (`games`) | 694,210 | ✅ |
| Match/club/season/venue | 35,746 | ✅ |
| Awards, votes, honours | 215,505 | ✅ |
| Draft and relationships | 22,538 | ✅ (with match-status gating) |
| Reference | 30 | ✅ |
| Validation oracles (club/venue scrapes) | 50,694 | ❌ retained in legacy |
| Staging / audit / legacy features | 66,492 | ❌ |

---

## 8. Advanced Search regression baselines

Captured from the legacy database as **exact player-ID sets** (requirement #29). Stored at `tests/fixtures/oracle_baseline.json` with a SHA-256 of each sorted ID list.

| Case | Expected count | ID-set SHA-256 (16) |
|---|---|---|
| Debuted 1960s AND exactly 2 clubs | 110 | `8cebc4aa37002766` |
| Career games 200–249 AND ≥16 finals | 117 | `8f31521e6adac021` |
| Career goals 50–199 AND **0 Brownlow votes (authoritative)** | **269** | `ae1eb8efd59b06b3` |
| Career goals 50–199 AND 0 Brownlow votes *(legacy per-game derivation)* | 750 | `ae1c474ebba72683` |
| Career games ≥200 AND goals ≥100 AND finals ≥15 | 222 | `45db7a6aa22a9176` |

> **The third and fourth rows are the same question with different answers.** The legacy per-game derivation returns 750 players; the authoritative `brownlow_results` source returns 269. The 481-player difference is entirely players from the 1935–1983 per-game gap who did poll votes. **AFLDB targets 269.** This is a deliberate, documented correction of legacy behaviour, not a regression.

### Representative player parity targets

| Player ID | Player | Games | Goals | Finals | Clubs | Brownlow (authoritative) |
|---|---|---|---|---|---|---|
| 4182 | Scott Pendlebury | 440 | 209 | 33 | 1 | 225 |
| 788 | Brent Harvey | 432 | 518 | 24 | 1 | 191 |
| 1319 | Michael Tuck | 426 | 320 | 39 | 1 | 104 |
| 1509 | Kevin Bartlett | 403 | 778 | 27 | 1 | 160 |
| 3702 | Bob Skilton | 237 | 412 | 1 | 1 | **180** *(legacy: NULL)* |
| 1466 | Haydn Bunton | 119 | 207 | 0 | 1 | **122** *(legacy: 79)* |
| 3578 | Dick Reynolds | 320 | 442 | 27 | 1 | **154** *(legacy: 31)* |
| 2520 | Ron Barassi **Sr** | 58 | 84 | 3 | 1 | 6 |
| 2521 | Ron Barassi **Jr** | 254 | 330 | 23 | 2 | 72 |

The two Barassi rows are the standing test that AFLDB never collapses distinct players sharing a name.

### Aggregate parity targets

| Metric | Value |
|---|---|
| `games` rows | 694,210 |
| `players` rows | 13,361 |
| `matches` rows | 17,027 |
| Σ career games | 694,210 |
| Σ goals | 412,844 |
| Σ Brownlow votes (authoritative) | 79,113 |
| Σ Brownlow votes (per-game, incomplete) | 46,979 |
| Distinct venues | 52 |
| Finals matches | 718 |
