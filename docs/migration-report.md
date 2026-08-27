# AFLDB — Migration Report

Result of migrating the legacy AFL SQLite database into AFLDB PostgreSQL.

| | |
|---|---|
| Date | 2026-08-15 |
| Source | `/home/arm/projects/sports_data_lab/data/afl/afl.db` (read-only, built 2026-08-12) |
| Target | `afldb_dev` on PostgreSQL 16.14, dev server `10.0.40.100` |
| Core import | 114 s |
| Enrichment | 8 s (birth dates, draft) |
| Derived rebuild | 30 s |
| Validation | **93 / 93 checks passed** |
| Rows rejected | 0 |

Reproduce with:

```bash
python tools/migration/import_legacy_afl.py     # idempotent full load
python tools/migration/enrich_birth_dates.py    # birth dates from raw rows
python tools/migration/import_draft.py          # draft rows and people
python tools/migration/rebuild_derived.py       # derived summaries
python tools/validation/validate_migration.py   # 93 parity checks
```

> **Historical.** This block reproduces the 2026-08-15 legacy migration, not the supported
> rebuild. `tools/migration/import_draft.py` was retired by AFLDB-ISSUE-093 Stage B2-7 and now
> fails fast; the supported DraftGuru importer is
> `tools/rebuild/draftguru/import_draftguru.py`. See §"Not yet migrated" below.

The whole pipeline was re-run from an empty schema after the corrections below, so every figure here comes from a clean load rather than from incremental patching.

---

## 1. Migrated volumes

| AFLDB table | Rows | Source |
|---|---:|---|
| `seasons` | 130 | derived from `games` (1897–2026) |
| `clubs` | 24 | all historical identities (18 current) |
| `club_aliases` | 48 | every source spelling |
| `venues` | 52 | derived from `games.venue` |
| `venue_aliases` | 55 | |
| `players` | 13,361 | legacy `players` (identity only) |
| `matches` | 17,027 | legacy `matches` + `match_details` |
| `match_period_scores` | 136,216 | `match_details` quarter scores |
| `player_match_stats` | **694,210** | legacy `games` (bulk `COPY`, 84 s) |
| `brownlow_season_votes` | 16,120 | `brownlow_results` (79,113 votes) |
| `brownlow_round_votes` | 194,033 | 1984–2025 only |
| `stat_availability` | 2,860 | computed per season, per statistic, per grain |
| `staging.team_seasons` | 1,640 | legacy `team_seasons`, all clubs resolved |
| `club_organizations` | 21 | derived from the 24 identities |
| `player_birth_evidence` | 12,472 | recovered from `club_player_register.raw_row_json` |
| `draft_persons` | 5,057 | keyed on the source's own person id |
| `draft_picks` | 6,810 | every row retained, linked or not |

### Derived (rebuilt, never migrated)

| Table | Rows |
|---|---:|
| `player_clubs` | 16,841 |
| `player_club_season_stats` | 59,092 |
| `player_season_stats` | 58,843 |
| `player_career_stats` | 13,361 |
| `club_seasons` | 1,640 |

---

## 2. Validation

All 88 checks pass, covering row counts, aggregate totals, referential integrity, NULL semantics, per-season stat availability, representative-player parity, and exact Advanced Search ID sets.

### Aggregate parity

| Metric | Legacy | AFLDB | |
|---|---:|---:|---|
| Player-games | 694,210 | 694,210 | ✅ |
| Σ career games | 694,210 | 694,210 | ✅ |
| Σ goals | 412,844 | 412,844 | ✅ |
| Σ finals played | — | matches legacy | ✅ |
| Finals matches | 718 | 718 | ✅ |
| Matches without attendance | 1,651 | 1,651 | ✅ |
| Players with DOB | 945 | 945 | ✅ |

### NULL semantics

NULL counts are preserved exactly, so "not recorded" never becomes zero:

| Statistic | NULL player-games |
|---|---:|
| `disposals` | 249,041 |
| `tackles` | 365,921 |
| `hitouts` | 262,361 |
| `goal_assists` | 482,928 |
| `brownlow_votes` | 357,360 |

### Advanced Search regression cases

Compared as exact player-ID sets with SHA-256 hashes, not merely counts.

| Case | Expected | AFLDB | |
|---|---:|---:|---|
| Debuted 1960s AND exactly 2 clubs | 110 | 110 | ✅ hash match |
| Career games 200–249 AND ≥16 finals | 117 | 117 | ✅ hash match |
| Goals 50–199 AND 0 Brownlow votes | 269 | 269 | ✅ hash match |
| Games ≥200 AND goals ≥100 AND finals ≥15 | 222 | 222 | ✅ hash match |

---

## 3. Deliberate corrections to legacy behaviour

### 3.1 Career Brownlow votes — corrected

Per-game Brownlow votes exist only for **1931–1934** and **1984–2025**. The legacy `players.career_brownlow`, derived by summing them, totalled 46,979 against the authoritative 79,113 — **32,134 votes (40.6%) missing**.

AFLDB derives career and season Brownlow totals from `brownlow_season_votes` (1924–2025). Per-game votes are migrated unchanged as match-level detail.

| Player | Legacy career Brownlow | AFLDB |
|---|---:|---:|
| Bob Skilton (3× medallist) | NULL | **180** |
| Dick Reynolds (3× medallist) | 31 | **154** |
| Haydn Bunton (3× medallist) | 79 | **122** |

Consequence for search: *"goals 50–199 AND zero Brownlow votes"* returns **269** players in AFLDB against **750** under the legacy derivation. The 481 difference are players who did poll votes during the 1935–1983 per-game gap. AFLDB is correct.

### 3.2 "Clubs played" — defined as modern club identities

Found by a failing validation check during this migration. Counting distinct *historical* identities made Brent Harvey a two-club player because North Melbourne was branded "Kangaroos" from 1999 to 2007. He played for one club.

`player_career_stats.clubs_played` counts distinct `clubs.current_identity_id`, so renames (Footscray → Western Bulldogs), relocations (South Melbourne → Sydney) and rebrands are not double-counted. **111 players** were affected. `player_clubs` still records each historical stint, so Harvey's page can show both names.

Before the fix, "debuted 1960s AND exactly two clubs" returned 109 players instead of 110.

`clubs_played` counts distinct `clubs.organization_id`, which expresses the same lineage as a first-class entity. A **merger** is deliberately not a rename: a player who appeared for both Fitzroy and Brisbane Lions played for two clubs, because those are two organizations.

### 3.3 `seasons.premier_club_id` removed

The column created a circular foreign key with `clubs`, which made `TRUNCATE clubs CASCADE` silently truncate `seasons` mid-import. It was also a second copy of a fact already in `matches`. Premiers now resolve from Grand Final results only.

### 3.4 Brownlow stored at player-season grain

`player_season_stats` was keyed by club and repeated the whole season's Brownlow total on every club row. Summing it gave **79,280** against the authoritative **79,113**: 44 polling player-seasons split across two clubs duplicated 167 votes.

The source cannot allocate a season total between clubs, and AFLDB does not invent an allocation. The table was split:

| Table | Grain | Rows | Awards |
|---|---|---:|---|
| `player_club_season_stats` | player · season · club | 59,092 | none, structurally |
| `player_season_stats` | player · season | 58,843 | the only season-grain Brownlow |

Season records and leading goalkickers now read the player grain, so a mid-season transfer is one entry rather than two smaller part-seasons ranked below the real figure.

### 3.5 Grand Final replays resolved to the decisive match

1948, 1977 and 2010 each have two Grand Final rows — a draw and its replay. Joining on `round_type` alone returned both, producing **133 rows for 130 seasons** and leaving one copy of each replay season with a null premier. Premier queries now select the non-drawn match: Melbourne 1948, North Melbourne 1977, Collingwood 2010.

### 3.6 Ladder rows attached to the identity of the era

`club_seasons` was built from the source ladder, which names every club by its **modern** name. Sydney therefore had ladder rows back to 1897 and Western Bulldogs back to 1925, while Footscray, South Melbourne and Kangaroos had none at all — club pages showed empty ladder histories beside historical player leaders drawn from the correct identities.

Rows now resolve through `afldb_identity_for_season()`:

| Organization | Eras | Rows |
|---|---|---:|
| Western Bulldogs | Footscray 1925–1996 / Western Bulldogs 1997–2026 | 72 + 30 = 102 |
| Sydney | South Melbourne 1897–1981 / Sydney 1982–2026 | 84 + 45 = 129 |
| North Melbourne | North Melbourne 1925–2026 / Kangaroos 1999–2007 | 93 + 9 = 102 |

Premiership flags follow the identity, so South Melbourne keeps its three flags and the 1999 flag sits with Kangaroos.

### 3.7 Birth dates recovered from raw source rows

The legacy `players` table carries 945 dates; AFLDB carries **12,478**, a rise from 7.1% to 93.4%. The dates were never missing — the club register scraper collapsed a malformed table header, leaving `club_player_register.dob` empty for all 15,310 rows while `raw_row_json` kept the payload.

Players are matched on the AFL Tables profile URL, never on the name. Two conflicts (Jack Hayes, Roan Steele) keep their existing value and are flagged rather than resolved by import order. 883 players remain honestly without a date.

### 3.8 Draft identity resolved per person

All 6,810 draft rows are imported. Resolving identity once per **person** rather than per row — the source describes 5,057 people — recovered 89 links that the data already justified elsewhere, and makes it impossible for the same person to be linked in one row and unlinked in the next.

The 1,664 unmatched rows are two populations, not one defect: **1,498 people never played a senior game**, so having no AFLDB player is correct; **100 people did play** and are a genuine matching backlog, flagged and raised as open data issues.

---

## 4. Legacy defect found

**The legacy `season_goals` table is missing 3 player-games.** It holds 59,089 rows summing to 694,207 games, against a true 694,210 across 59,092 player-season-club combinations.

The missing rows are the three most recent 2026 debutants:

| Player ID | Player | Season | Club |
|---|---|---|---|
| 13359 | William Green | 2026 | Sydney |
| 13360 | Noah Howes | 2026 | Collingwood |
| 13361 | Alex Van Wyk | 2026 | Port Adelaide |

The legacy derived table was built before those three played. This also explains the "694,207 of 694,207 player-games" figure in the legacy `stat_coverage` table noted during the Phase 1 audit — both artefacts were generated from the same stale pass.

AFLDB's `player_season_stats` includes all three and is correct. **No action needed in AFLDB**; recorded because it explains a real difference between the two databases.

---

## 5. Data preserved rather than resolved

Consistent with the principle of not inventing corrected values, these known gaps are carried as explicit NULLs or flags for later enrichment passes:

| Gap | Extent | How AFLDB holds it |
|---|---|---|
| Missing DOB | 12,416 of 13,361 (93%) | `dob` NULL, `dob_confidence = 'unknown'`; birth years marked `'estimated'` |
| Missing attendance | 1,651 matches (9.7%) | `attendance` NULL, never 0 |
| Era-limited statistics | up to 69.6% of player-games | column NULL + `stat_availability` per season |
| Venue canonicalisation | 49 of 52 names unexpanded | `venue_raw` always populated; `venue_id` resolves for all 52 |
| Unmatched draft picks | 1,664 (24%) | *pending Phase 3b*: `player_id` NULL + `link_status_value` |

---

## 6. Schema changes required by the migration

Discovered by running the migration rather than by inspection:

| Migration | Change | Why |
|---|---|---|
| `010` | `TRUNCATE` for `afldb_import` | reload-style import is what makes reruns idempotent |
| `011` | sequence `UPDATE` for `afldb_import` | `setval()` after loading explicit ids |
| `012` | club self-identity FK deferrable | first club has nothing valid to reference yet |
| `013` | drop `seasons.premier_club_id` | circular FK truncated reference data |
| `014` | `staging` schema privileges + `staging.team_seasons` | raw → staging → normalised → derived |

`afldb_app` remains read-only throughout; verified by an explicit privilege test.

---

## 7. Outstanding at the time of this 15 August migration run

Awards, All-Australian, Hall of Fame, honour teams, captaincies, draft picks and player relationships are not yet migrated. All target tables exist and accept unresolved links, so they can be loaded without further schema change.

This section is a dated result, not the current loader inventory. The later
Phase 3b tooling in `tools/migration/import_awards.py` now loads awards,
All-Australian, AFLPA 22 Under 22, Hall of Fame, honour teams and captaincies;
`tools/migration/import_draft.py` loaded draft history at the time of this report; it was
**retired by AFLDB-ISSUE-093 Stage B2-7** and replaced by
`tools/rebuild/draftguru/import_draftguru.py`, which loads the same 5,057 persons / 6,810
picks from the accepted DraftGuru Stage A snapshot with no `AFLDB_LEGACY_SQLITE` dependency.
The commands in this report reproduce the *historical* legacy migration and are not the
supported rebuild path. Player relationships remain separately deferred as described in the
current README.
