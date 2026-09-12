# AFLDB-ISSUE-137 — Production remediation plan: ISSUE-136 identity splits and ISSUE-113 Brownlow restoration

- **Status:** Open — **execution stage COMPLETE on production 2026-09-04 (§8.1–§8.8): T1 rehearsed then committed (batch 741, 298 re-points, four duplicates retired), T2/T4 derived rebuilds, Acceptance A and B fully green, ISSUE-113 Brownlow season load (batch 742, 16,120 / 0 rejected), build `MRjsomoqFJRsjZWElQ6A0` + restart, health ok. Verification stage A executed 2026-09-04 13:01–13:07 AEST (§8.12): A1–A7 PASS, 0 FAIL, A8/A9 blocked on a super-admin session, A10 not executable while `AFLDB_BETA_GATE=on`. Stage B pre-checked read-only 2026-09-04 15:28 AEST (§8.13): the timer next fires **Sat 2026-09-05 04:34:59 AEST** and `import_batches` still tops out at 742, so the first post-repair scheduled settle has not run. Remaining before resolution: the §8.10 B post-settle check and close-out (§5 step 14).**
- **Severity:** High
- **Area:** Data integrity / Operations / Database (production)
- **Branch / worktree:** `claude/issue-137` at `D:\dev\afldb-issue-137`, base `169d738` (main, ISSUE-113 merge)
- **Related:** `AFLDB-ISSUE-136` (rebuild-time fix; runbook `issues/closed/AFLDB-ISSUE-136.md`), `AFLDB-ISSUE-113` (artefact + loader; `issues/closed/AFLDB-ISSUE-113.md` §8.6, §8.18.5), `AFLDB-ISSUE-125` (promotion path, not implemented), `AFLDB-ISSUE-126` (production audit-trail expectations), `AFLDB-ISSUE-122`/`-131` (the settle chain that writes 2026 rows)
- **Migration:** none. The repository's last migration is `085_matches_is_finals_series.sql`, already applied on production.

This document is the implementation contract for the execution stage. Every figure in §1–§3 was
measured on production on 2026-09-04 under a read-only session; nothing here is inferred.

---

## 1. Production measurements (2026-09-04 11:23–11:26 AEST, `afldb_prod`, `afldb_owner`, `default_transaction_read_only = on`)

### 1.1 Host and code state

| Fact | Value |
|---|---|
| Checkout | `main` at `657a875` (Merge ISSUE-131) — **behind** the ISSUE-136 (`295e054`) and ISSUE-113 (`169d738`) merges; working tree clean except four untracked nightly settle manifests |
| Latest applied migration | `085_matches_is_finals_series.sql`, 2026-09-03 19:00 |
| Python / driver | `.venv/bin/python` 3.12.3, psycopg 3.3.4 (`import psycopg` succeeds) |
| `data/brownlow/` on host | **absent** (artefact, manifest and loader not yet deployed) |
| `.env` DSN variables present (names only) | `DATABASE_URL`, `AFLDB_AUTH_DATABASE_URL`, `AFLDB_IMPORT_DATABASE_URL`, `AFLDB_OWNER_DATABASE_URL`, `AFLDB_PROD_DATABASE_URL`, `AFLDB_BACKUP_DATABASE_URL` |
| Settle timer | `afldb-settle-afltables.timer` active; last fired 2026-09-04 04:31 AEST, next 2026-09-05 04:31 AEST (`OnCalendar 04:30` + up to 15 min); `afldb.service` active |
| Latest settle batch | `import_batches` 739, `settle-afltables.ts`, `completed`, 2026-09-04 04:31, 9,823 records read |
| Backups | `~/backups/afldb/`: latest `afldb_prod-20260903-185612.dump` (21 MB); pre-cutover `/home/arm/afldb_prod_pre_rebuild_20260902-200355.dump` also present |
| Database size | 342 MB |
| Last derived rebuild | `derived_rebuilds` 12–14, 2026-09-03 19:33 (`player_career_stats`, `club_seasons`, `search_rank`) |

### 1.2 The four splits

Mapping is **derived from the identity table**, not typed: the player registered to the renumbered
path is the duplicate; the player registered to the continuing path (the same path with the digit
suffix removed) is the career player.

| Player | Career id (continuing path) | Career span / DOB | Duplicate id (renumbered path) | Duplicate span / DOB |
|---|---|---|---|---|
| Charlie Cameron | **2604** `players/C/Charlie_Cameron.html` | 2014–2024, 1994-07-05 | **2608** `players/C/Charlie_Cameron3.html` | 2025–2026, NULL |
| Jack Graham | **6293** `players/J/Jack_Graham.html` | 2017–2024, 1998-02-25 | **6296** `players/J/Jack_Graham2.html` | 2025–2026, NULL |
| Jack Ross | **6521** `players/J/Jack_Ross.html` | 2019–2024, 2000-09-03 | **6525** `players/J/Jack_Ross3.html` | 2025–2026, NULL |
| Jack Williams | **6622** `players/J/Jack_Williams.html` | 2022–2024, 2003-12-01 | **6626** `players/J/Jack_Williams3.html` | 2025–2026, NULL |

- All eight identity rows: `source = afltables`, `match_method = afltables_profile_url`,
  `status = unique`, notes `Matched on profile URL, not name.` Each of the eight players has
  exactly **one** identity (no DraftGuru or other-source identity on any of them).
- ISSUE-136 §10.3 query (players with more than one AFL Tables identity): **0 rows**.
  `modern_four` (players of those names with `debut_season >= 2014`): **8**.
- All 22 `players` rows carrying the four names exist (historical namesakes 1897–1949 untouched);
  the namesakes' identities are `Charlie_Cameron0..2`, `Jack_Graham0..1`, `Jack_Ross0..2`,
  `Jack_Williams0..2`, each on its own historical player.
- **Billy Wilson 1790** (`Billy_Wilson2.html`, DOB 2005-06-16, 2025–2026) is a separate real player
  (the 1913–14 and 1932–35 Billy Wilsons are 1788/1789): **not part of this repair.**
- Heuristic scan for any other 2025-debut player sharing a name with a player whose career ended in
  2024 (modern era): returns **exactly the four pairs above** — no fifth split on production.
- Slugs: all four pairs share the slug (`charlie-cameron`, …); player URLs are `slug-id`, so the
  duplicate pages are `/players/charlie-cameron-2608`, `/players/jack-graham-6296`,
  `/players/jack-ross-6525`, `/players/jack-williams-6626`.

### 1.3 Match rows

| id | `player_match_stats` rows | first match | last match | 2025 rows | 2026 rows |
|---|---|---|---|---|---|
| 2604 | 229 | 2014-05-15 | 2024-09-28 | 0 | 0 |
| 2608 | 48 | 2025-03-29 | 2026-08-21 | 25 | 23 |
| 6293 | 131 | 2017-08-20 | 2024-08-24 | 0 | 0 |
| 6296 | 31 | 2025-03-16 | 2026-08-23 | 18 | 13 |
| 6521 | 70 | 2019-04-13 | 2024-08-24 | 0 | 0 |
| 6525 | 42 | 2025-03-13 | 2026-08-22 | 23 | 19 |
| 6622 | 29 | 2022-03-27 | 2024-08-24 | 0 | 0 |
| 6626 | 25 | 2025-03-30 | 2026-08-23 | 13 | 12 |

Shared `match_id` between a duplicate and its career player: **0 for every pair**. Total rows to
re-point: **146**.

### 1.4 Foreign keys referencing `players(id)` — complete inventory (`pg_constraint`, all schemas)

27 FK columns on 26 tables. `c` = ON DELETE CASCADE, `a` = NO ACTION.

| Child table . column | delete rule | rows on the duplicates (2608 / 6296 / 6525 / 6626) | rows on career players |
|---|---|---|---|
| `player_match_stats.player_id` | a | 48 / 31 / 42 / 25 | 229 / 131 / 70 / 29 |
| `brownlow_round_votes.player_id` | a | 21 / 18 / 23 / 13 (all season 2025, all 0 votes) | 206 (25 votes) / 120 (9) / 69 (0) / 29 (0) |
| `award_winners.player_id` | a | 2608: All-Australian 2019 (`aa:2019:755`), AA squad 2021 (`…:378`), AA squad 2022 (`…:399`), All-Australian 2023 (`aa:2023:843`); 6296: Larke Medal 2016 (`larke-medal:2016:717`) | 0 |
| `award_nominations.player_id` | a | 2608: Rising Star 2015 (`387dfaaa0398c5957939ed5c`) | 0 |
| `external_identities.player_id` | a | 1 each (the renumbered path) | 1 each (the continuing path) |
| `staging.afltables_player_match.player_id` | a | 23 / 13 / 19 / 12 (all season 2026 settle projections) | 0 |
| `player_name_aliases.player_id` | c | 1 each (`source_string` alias = display name) | 1 each (identical alias) |
| `player_career_stats.player_id` | c | 1 each (derived) | 1 each (derived) |
| `player_season_stats.player_id` | c | 2 each (derived) | 11 / 8 / 6 / 3 |
| `player_club_season_stats.player_id` | c | 2 each (derived) | 11 / 8 / 6 / 3 |
| `player_clubs.player_id` | c | 1 each (derived) | 2 / 1 / 1 / 1 |
| `player_birth_evidence.player_id` | c | 0 | 1 each |
| `captaincies`, `draft_persons`, `draft_picks`, `father_son_selections` (both columns), `hall_of_fame`, `honour_team_members`, `player_achievements`, `player_link_match_candidates`, `player_link_resolutions`, `player_match_period_stats`, `player_relationships` (both columns), `staging.afl_api_lineup`, `brownlow_season_votes` | a | **0** | 0 |

Non-FK references checked: `data_overrides` keyed on the paths **0**; `data_edits` rows for the
eight player ids **0**; `staging.source_records` has **67** rows whose external record id embeds
one of the paths — these are path-keyed settle-spine rows and are unaffected by re-pointing
player ids; `staging_aflw.*.player_id` columns are AFLW and unrelated. No other integer column
named like a player id exists outside the FK inventory.

### 1.5 Uniqueness-collision probe

For **every** unique index that contains a player FK column, the probe joined the duplicate's rows
to the career player's rows on all the other index columns:

- **Zero collisions in every fact table:** `pms_player_match_uq (player_id, match_id)`,
  `brownlow_round_uq (season, player_id, round_number)`, `award_winners_source_uq`,
  `award_nominations_source_uq`, `external_identities_uq (source_id, external_id)`,
  `afltables_player_match_grain_uq (source_id, player_id, match_key)`,
  `pmps_player_match_period_uq`, `player_birth_evidence_uq`.
- Collisions only in **derived** tables and the alias table: `player_career_stats_pkey` (4 pairs),
  `player_clubs_pkey` (3 pairs — Cameron, Ross, Williams stayed at one club; Graham changed clubs),
  `player_name_aliases_uq` (4 pairs, identical alias). The derived tables are truncated and rebuilt
  wholesale by `tools/migration/rebuild_derived.py` (order: `season_metadata`, `player_clubs`,
  `player_club_season_stats`, `player_season_stats`, `player_career_stats`, `club_seasons`,
  `search_rank`), so they are never re-pointed; the alias rows are `ON DELETE CASCADE` children of
  the duplicate and are removed with it.

Conclusion: **a direct re-point of the six fact-table FK columns is collision-free on the measured
production state.**

### 1.6 Brownlow state and loader prerequisites

| Fact | Value |
|---|---|
| `brownlow_season_votes` | **0 rows** |
| `brownlow_round_votes` | **320,861 rows / 44,478 votes / 42 seasons 1984–2025**; fingerprint `md5(season:player_id:round_number:votes …)` = **`17df6bab14dfe00ce6014651d983a92e`** (F0, pre-repair) |
| Derived Brownlow totals | `player_season_stats` 0, `player_career_stats` 0 |
| Named players today | Bob Skilton 1979 = 0, Dick Reynolds 3787 = 0, Harley Reid 5481 = 0, Matt Rowell 9239 = 0, Tom Green 12550 (2020–2025, `Tom_Green1.html`, 115 matches, no 2026 rows) = 0 |
| `stat_availability` `brownlow_season_total = complete` | 98 seasons, 1924–2025 (= manifest coverage [1924–1941] + [1946–2025]) |
| `seasons` | 2024 complete, 2025 complete, **2026 in_progress** (artefact carries no 2026 row) |
| `sources` | `afltables` id 8 |
| `afldb_meta.import_writable_tables` | includes `brownlow_season_votes`, `brownlow_round_votes`, `import_batches`, `import_rejections`, `players`, `external_identities`, `player_match_stats` |
| `afldb_import` privileges | TRUNCATE / INSERT / SELECT on `brownlow_season_votes`, `import_batches`, `import_rejections`, `player_season_stats`, `player_career_stats`, `derived_rebuilds` (also TRUNCATE on `brownlow_round_votes` by registry — the loader never issues it) |
| Roles | `afldb_app`, `afldb_auth`, `afldb_backup`, `afldb_import`, `afldb_owner` all present, login |
| DB-health reconciliation today | games 0, goals 0, finals 0, brownlow 0, missing 0 |

Tracked artefact (repository, `169d738`): `data/brownlow/season-votes.csv` sha256
`042a8fca776f3c3879585daa6524690d48add5e67f60c3f8dbdf5e5dc5c70059`, `player-identity.csv` sha256
`17b512e48374c12d2f666194aa99c7c713db57643ce5b31cc67f9f8931493c61`; manifest: 16,120 rows,
79,113 votes, 112 winners, 98 seasons, 4,275 players, NULL counts eligible_rank 3 /
polling_games 4,928 / three-vote 10,589 / two-vote 10,568 / one-vote 9,003, 3 ineligible rows,
link status unique 15,058 / resolved 1,062. Per-player expectations read from the artefact:
Harley Reid 10 (`Harley_Reid.html`), Matt Rowell 89, Tom Green 73 (`Tom_Green1.html`, 2021–2025),
Dick Reynolds 154, Bob Skilton 180. **The modern Charlie Cameron rows are keyed on
`Charlie_Cameron3.html` (2019–2024 = 25 votes) and the modern Jack Graham rows on
`Jack_Graham2.html` (2019–2022 = 9 votes)** — exactly the career players' round-vote totals, which
is why the load is correct only after the renumbered paths resolve to 2604 / 6293.

### 1.7 Fingerprints (pre-repair baseline for change control)

| Table | count | md5 |
|---|---|---|
| `players` (`id:display_name:slug`) | 13,277 | `2b5adb88eba967058dd83278be4b49ba` |
| `external_identities` (`id:source:external_id:player_id:status`) | 18,332 | `fea7be907801f5facedcbf2b92fe222c` |
| `player_match_stats` (`player_id:match_id`) | 694,273 | `68c2926caa81d4dc7a316dc830bda76e` |
| `award_winners` (`id:player_id`) | 3,298 | `b4d24b1fab06c24c6eb9237da4e6d7b2` |
| `award_nominations` (`id:player_id`) | 766 | `616a5b03acdebdd79298cf9bc641b850` |

13,277 = 13,275 AFL Tables identities + 2 DraftGuru shells (13276 Fred Rodriguez, 13277 Riley
Onley — no identity, no matches). The ISSUE-136 fold on `afldb_test` ended at **13,273**; that is
the target here.

### 1.8 How the settle chain interacts with the split (repository, verified)

- `deploy/afldb-settle-afltables.sh` runs `import_fitzroy_core.py --require-in-season
  --emit-observations` **offline** (no database) and only `settle-afltables.ts` opens PostgreSQL.
  In-season the importer sets `continuity = None` (`import_fitzroy_core.py:3244`), so continuity
  rules and the `external-identity split` HALT (`:2495-2505`, inside `import_players`, database
  path only) are **never on the nightly path**. Deploying the ISSUE-136 code therefore changes
  nothing about the nightly settle, before or after the repair.
- `settle-afltables.ts` resolves every profile url through `external_identities` on each run
  (`:1687`) and never writes `players`, `external_identities` or `player_match_stats` itself; the
  canonical rows come from the promotion/apply step. **After the identity re-point, the next settle
  projects the four players' 2026 rows onto the career ids by itself.** Until then every settle
  keeps writing them to the duplicates.
- The HALT would fire only on a full-history run against the split database (ISSUE-136 §13.6),
  which production cannot run (no full-history snapshot on the host). The HALT predicate is
  therefore proven in SQL (§6 A4).

---

## 2. Strategy comparison

| | (a) Canonical rebuild-and-promote (`AFLDB-ISSUE-125`) | (b) Supervised in-place reconciliation |
|---|---|---|
| Blast radius | Entire database replaced: football data **and** every application/auth/operations table | 4 `players` rows, 6 fact-table FK columns (298 rows re-pointed = 4 identities + 146 + 75 + 5 + 1 + 67; an earlier draft said 223, which omitted the 75 round-vote rows — see §8.2), 4 identity notes, derived tables rebuilt |
| Prerequisites | Full-history snapshots exist only on the dev host; a rebuild there, a dump, a restore over `afldb_prod`, then reinstatement of production-only state. ISSUE-125's procedure is **not written**; the 2026-09-02 promotion lost `auth_audit_log`, `beta_access_codes`, `site_settings` (ISSUE-126, still open) and promoted a test-fixture admin | A backup, one transaction, `rebuild_derived.py` — all tooling already exists on the host |
| Determinism | Re-derives everything from snapshots; also discards settle spine (`import_batches`, `staging.*`), `canonical_applications`, `data_edits`, `data_overrides`, `nl_search_log`, `app_health_events` unless each is individually carried over | Mapping is derived from the identity table by the same rule ISSUE-136 codified; every statement asserts its row count; end state is byte-for-byte the ISSUE-136 fold shape (`players = 13,273`, four players with two paths each, renumbered notes) |
| Atomicity / rollback | Not atomic; rollback = restore the pre-cutover dump | Atomic (`BEGIN … COMMIT`, any failed assertion rolls back with nothing written); post-commit rollback = restore the pre-change dump |
| Downtime / cache | Restore window with the app pointed at a moving database; every ISR page stale | No downtime; only the four player pages and Brownlow pages have a ≤1 h ISR window |
| Residual risk | Production-only state loss (demonstrated once already) | A fact-table row missed → the `NO ACTION` FKs make the final `DELETE` fail and the transaction rolls back (fail-closed by construction) |

**Recommendation: (b) supervised in-place reconciliation.** The production evidence shows zero
collisions in every fact table, no references outside the enumerated six FK columns, a mapping the
database itself yields deterministically, and a delete that PostgreSQL refuses unless every fact
row has been re-pointed. Path (a) would reintroduce the exact hazard ISSUE-125/126 record, with no
written procedure to prevent it, to fix four players.

---

## 3. In-place reconciliation — design

### 3.1 Deterministic source → target mapping

Computed inside the transaction, never typed:

```sql
-- rule pairs (ISSUE-136 contract rule ids, in this order):
--   2025-charlie-cameron-renumbered-profile  players/C/Charlie_Cameron3.html -> players/C/Charlie_Cameron.html
--   2025-jack-graham-renumbered-profile      players/J/Jack_Graham2.html     -> players/J/Jack_Graham.html
--   2025-jack-ross-renumbered-profile        players/J/Jack_Ross3.html       -> players/J/Jack_Ross.html
--   2025-jack-williams-renumbered-profile    players/J/Jack_Williams3.html   -> players/J/Jack_Williams.html
SELECT d.player_id AS dup_id, c.player_id AS career_id, d.external_id AS renumbered_path, c.external_id AS continuing_path
  FROM external_identities d JOIN sources s ON s.id = d.source_id
  JOIN external_identities c ON c.source_id = d.source_id AND c.match_method = d.match_method
   AND c.external_id = regexp_replace(d.external_id, '[0-9]+\.html$', '.html')
 WHERE s.key = 'afltables' AND d.match_method = 'afltables_profile_url'
   AND d.status IN ('unique','resolved') AND c.status IN ('unique','resolved')
   AND d.external_id IN ('players/C/Charlie_Cameron3.html','players/J/Jack_Graham2.html',
                         'players/J/Jack_Ross3.html','players/J/Jack_Williams3.html');
```

Refuse unless the result is exactly `{(2608,2604),(6296,6293),(6525,6521),(6626,6622)}`.

### 3.2 Every FK update required (in order), with the row count each must affect

| # | Statement (target = career id per §3.1) | Expected rows |
|---|---|---|
| 1 | `external_identities`: `SET player_id = career, notes = 'Matched on profile URL, not name. AFLDB-ISSUE-136 profile_url_continuity <rule-id>: AFL Tables renumbered this player''s profile; same player as <continuing path>. Re-pointed on production under AFLDB-ISSUE-137 on <date>.' WHERE external_id = renumbered AND player_id = dup` | 4 |
| 2 | `player_match_stats SET player_id = career WHERE player_id = dup` | 146 (48+31+42+25) |
| 3 | `brownlow_round_votes SET player_id = career WHERE player_id = dup` | 75 (21+18+23+13) |
| 4 | `award_winners SET player_id = career WHERE player_id = dup` | 5 |
| 5 | `award_nominations SET player_id = career WHERE player_id = dup` | 1 |
| 6 | `staging.afltables_player_match SET player_id = career WHERE player_id = dup` | 67 (23+13+19+12) |
| 7 | `players SET final_season = GREATEST(final_season, dup.final_season) WHERE id = career` (2024 → 2026); no other column is copied — the career row already holds DOB, evidence and names | 4 |
| 8 | Generic guard: for every FK in `pg_constraint` referencing `players`, `count(*)` of rows still on any duplicate id, restricted to `NO ACTION` constraints | 0 |
| 9 | `DELETE FROM players WHERE id IN (dups)` — the retirement. This is an enumerated, count-asserted step, not an ad-hoc delete: it may delete **exactly 4** rows and PostgreSQL refuses it if any `NO ACTION` child remains. Cascades remove 4 alias rows and the duplicates' derived rows (4 + 8 + 8 + 4) | 4 |
| 10 | Audit record: one `import_batches` row (`source_id = 8`, tool `AFLDB-ISSUE-137 identity reconciliation`, `target_table = players`, notes carrying the mapping and the counts above, status completed) — the ISSUE-126 audit-trail expectation | 1 |

Post-conditions asserted **before `COMMIT`** (any failure → `ROLLBACK`):

- §10.3 query returns exactly 4 rows: 2604 `{Charlie_Cameron3.html, Charlie_Cameron.html}`,
  6293 `{Jack_Graham2.html, Jack_Graham.html}`, 6521 `{Jack_Ross3.html, Jack_Ross.html}`,
  6622 `{Jack_Williams3.html, Jack_Williams.html}`; `modern_four = 4`.
- `count(*) FROM players` = 13,273; `external_identities` = 18,332 (rows moved, none removed);
  `player_match_stats` = 694,273; `brownlow_round_votes` = 320,861 and `sum(votes)` = 44,478;
  `award_winners` = 3,298; `award_nominations` = 766.
- Per career player: match rows 277 / 162 / 112 / 54, `min(season)` unchanged, `max(season)` 2026.
- The renumbered identities' `player_id` = career and `status` still `unique`.

### 3.3 Uniqueness collisions and refusal conditions (the transaction refuses and rolls back if any holds)

1. §3.1 mapping is not exactly the four expected pairs, or any duplicate id equals a career id.
2. Any duplicate has `dob IS NOT NULL` or `debut_season <> 2025`; any career player has
   `final_season <> 2024` (evidence that something changed since this plan was measured).
3. Any pair shares a `match_id` in `player_match_stats`, a `(season, round_number)` in
   `brownlow_round_votes`, a `(source_id, source_record_id)` in either award table, or a
   `match_key` in `staging.afltables_player_match` (re-run of the §1.5 probe inside the transaction).
4. Any `NO ACTION` FK table other than the six in §3.2 holds a row for a duplicate id.
5. Any statement in §3.2 affects a row count other than the one listed.
6. `players` count is not 13,277 at start or 13,273 at end.
7. The §10.3 query does not return exactly the four expected rows at the end.

### 3.4 Transaction boundaries

- **T1 — identity reconciliation:** one `BEGIN … COMMIT` as `afldb_owner`
  (`AFLDB_OWNER_DATABASE_URL`), holding `LOCK TABLE external_identities, player_match_stats,
  players IN EXCLUSIVE MODE` for its sub-second duration so a concurrent settle cannot interleave
  (readers are unaffected). Owner rather than `afldb_import` so no missing grant can abort the
  transaction mid-way; the fail-closed import registry is not the safeguard here — the count
  assertions and `NO ACTION` FKs are.
- **T2 — derived rebuild:** `tools/migration/rebuild_derived.py` (all targets, its own
  per-target transactions, ~45–60 s measured on `afldb_test`). Between T1 and T2 the four career
  players' derived rows are stale (DB-health would show 4 `games` mismatches); T2 follows T1
  immediately in the same window.
- **T3 — Brownlow load:** `tools/migration/import_brownlow_season.py` — one transaction of its
  own (`TRUNCATE ONLY brownlow_season_votes` + COPY, post-write assertions, zero rejections or
  nothing written; `brownlow_round_votes` count asserted unchanged inside it).
- **T4 — derived rebuild** again, so `player_season_stats` / `player_career_stats` carry the
  Brownlow totals.

### 3.5 Backup and rollback requirements

- **Before T1:** `tools/maintenance/backup.sh` on the host (runs as `afldb_backup`, writes
  `~/backups/afldb/afldb_prod-<ts>.dump`, verified with `pg_restore --list`), then
  `tools/maintenance/restore-test.sh` to prove that dump restores into `afldb_restore_test`, then an
  off-host copy to `D:\backups\afldb\`. Record the dump name and sha256 in §8.
- **T1 failure:** automatic `ROLLBACK`; nothing to undo.
- **Defect found after T1/T2 but before T3:** restore the pre-change dump
  (`pg_restore --clean --if-exists --no-owner --no-privileges --jobs=4
  --dbname="$AFLDB_OWNER_DATABASE_URL" <dump>`), then **`npm run db:privileges` (mandatory after any
  restore — `afldb_app` reads fail closed otherwise)**, then `rebuild_derived.py`, then restart
  `afldb`. A restore discards every write after the dump, so the whole procedure runs inside one
  window between two nightly settles and, if a restore was needed, the operator re-fires the settle
  (`systemctl start afldb-settle-afltables.service`) afterwards.
- **T3 failure:** the loader rolls back itself and exits 1; `brownlow_season_votes` stays empty.
  Re-run after fixing the cause; it is idempotent.
- **Wrong Brownlow data after T3:** not correctable by truncation alone (the derived tables were
  rebuilt); restore the dump as above.
- `afldb_prod_auth_recovery` stays on the host until §6 B passes (ISSUE-113 §8.18.5).

---

## 4. Brownlow restoration — prerequisites verified against production

| Prerequisite (`import_brownlow_season.py`) | Production state | OK |
|---|---|---|
| Artefact + manifest + identity file on the host | absent — arrives with the deploy of `169d738` or later | after deploy |
| Manifest hashes match the tracked files | verified in the repository (§1.6); the loader re-verifies before any DB contact (`--validate-only` runs it offline) | ✔ |
| `AFLDB_IMPORT_DATABASE_URL` in `.env`, role `afldb_import` | present; role exists | ✔ (confirm it names `afldb_prod`, §5 step 7) |
| `afldb_import` may `TRUNCATE`/`INSERT` `brownlow_season_votes`, `INSERT` `import_batches` / `import_rejections` | granted (registry-backed) | ✔ |
| `stat_availability` complete seasons == artefact coverage | 98 seasons 1924–2025 == manifest | ✔ |
| No artefact season is `in_progress`; all seasons known | 2026 in_progress, artefact ends 2025 | ✔ |
| `sources.key = 'afltables'` | id 8 | ✔ |
| Every artefact path resolves to exactly one player | 10 modern Cameron/Graham rows resolve to the **duplicates** today (2608 / 6296) — resolves to 2604 / 6293 only after T1; the artefact's 525 gap rows resolve through `player-identity.csv` as on `afldb_test` | after T1 |
| Only `brownlow_season_votes` is written | `TRUNCATE ONLY brownlow_season_votes` (`:713`), `copy_rows` into it, `import_batches`/`import_rejections` audit only; `brownlow_round_votes` read twice and asserted equal (`:669`, `:748`) | ✔ by code |
| Derived rebuild after the load | `rebuild_derived.py` sums `player_season_stats.brownlow_votes` / `player_career_stats.brownlow_votes` from `brownlow_season_votes` only | required (T4) |
| Python driver on host | psycopg 3.3.4 in `.venv` | ✔ |

---

## 5. Ordered operator procedure (execution stage — not authorised by this document)

Window: any time **outside 04:15–05:15 AEST** (settle timer), so no timer change is needed; ~30
min including the build. Every command runs on `PROD: afldb-prod` as `arm` from
`~/projects/afldb` unless stated. Dev (`streamanator`) should already carry `169d738` per the
house rule "dev before prod".

1. **Re-measure (read-only)** — the §1 script; stop unless §1.2, §1.3, §1.4, §1.7 counts are
   identical (a nightly settle may have added 2026 rows on the duplicates: if only the
   `player_match_stats` / `staging.afltables_player_match` 2026 counts grew, update the expected
   counts in §3.2 and proceed; anything else is a stop).
2. **Backup**: `tools/maintenance/backup.sh` → `tools/maintenance/restore-test.sh` → copy the
   dump off-host. Record name + sha256.
3. **Code**: `git pull` to ≥ `169d738` (brings `data/brownlow/`, the loader, the ISSUE-136
   importer); `npm ci`; `npm run db:migrate` must report **nothing pending** (085 is the last
   migration; stop if it wants to apply anything). Do **not** build/restart yet.
4. **Offline loader validation**: `.venv/bin/python tools/migration/import_brownlow_season.py
   --validate-only` — must print the manifest figures (16,120 / 79,113 / 112 / 98) and exit 0.
5. **T1** — run the reviewed reconciliation SQL (§3.1–§3.3) as `afldb_owner` in one transaction;
   read the assertion output; `COMMIT` only if every assertion passed.
6. **T2** — `.venv/bin/python tools/migration/rebuild_derived.py` (as `afldb_import`).
7. **Acceptance A** (§6). Confirm `AFLDB_IMPORT_DATABASE_URL` names database `afldb_prod`
   (print host/dbname only, never the DSN).
8. **T3** — `.venv/bin/python tools/migration/import_brownlow_season.py`; expect
   `brownlow_season_votes 16120 (79,113 votes, 112 winners, 98 seasons, 4275 players)` and
   `brownlow_round_votes 320861 (untouched)`, exit 0.
9. **T4** — `rebuild_derived.py` again.
10. **Acceptance B** (§6).
11. **Build + restart** (`npm run build`, then the documented restart) — placed last so the
    prerendered top-500 player pages and the fresh ISR cache are built from corrected data.
12. **Public consumers** (§7): check `/brownlow`, `/brownlow/2025`, `/brownlow/1996`,
    `/players/charlie-cameron-2604` (2026 rows, 277 games), `/players/charlie-cameron-2608` (404),
    compare page, a Grid Solver Brownlow axis, `/admin/db-health` (all 0), sitemap segment
    containing the Brownlow years.
13. **Next nightly settle**: confirm the batch completes and
    `staging.afltables_player_match` rows for the four players carry the career ids; nothing
    reappears on 2608 / 6296 / 6525 / 6626 (they no longer exist — a settle that tried to would
    fail its FK, which is the desired fail-closed signal).
14. Close out: §8 evidence, `issues.md`, `IssuesIndex.md`, `CHANGELOG.md`; decide the retirement of
    `afldb_prod_auth_recovery`.

### Explicit stop conditions

- Step 1 shows a fifth split, a changed mapping, a DOB on a duplicate, a career player already at
  `final_season = 2026`, or fingerprints differing for a reason other than nightly settle growth.
- Step 2 backup or restore-test fails, or the off-host copy is missing.
- Step 3 wants to apply a migration, or `git status` shows tracked modifications on the host.
- Step 4 exits non-zero (artefact/manifest disagreement).
- Any §3.3 refusal condition in T1 (the transaction rolls back; do not re-run with a relaxed check).
- T2 exits non-zero, or Acceptance A fails (restore per §3.5 before anything else).
- T3 reports any rejection or exits non-zero (nothing was written; investigate the rejection rows
  in `import_rejections` before re-running).
- Acceptance B fails on any line (restore per §3.5).
- `afldb_prod_auth_recovery` must not be dropped before Acceptance B passes.

---

## 6. Post-repair acceptance checks (all read-only SQL on `afldb_prod`)

**A — after T1 + T2**

| # | Check | Expected |
|---|---|---|
| A1 | ISSUE-136 §10.3 query (players with >1 AFL Tables identity) | exactly 4 rows: 2604, 6293, 6521, 6622 with their two paths each |
| A2 | `count(*) FROM players WHERE display_name IN (…four names…) AND debut_season >= 2014` | 4 |
| A3 | `players` / `external_identities` / `player_match_stats` / `brownlow_round_votes` counts | 13,273 / 18,332 / 694,273 / 320,861 |
| A4 | HALT predicate: for each rule pair, `count(DISTINCT player_id)` over the two paths in `external_identities` | 1 for all four (was 2) |
| A5 | `player_career_stats` games for 2604 / 6293 / 6521 / 6622 | 277 / 162 / 112 / 54; `final_season` 2026 |
| A6 | Award rows on the career players | 2604: AA 2019, AA squad 2021, 2022, AA 2023, Rising Star nomination 2015; 6293: Larke Medal 2016 |
| A7 | DB-health reconciliation (5 checks) | all 0 |
| A8 | `brownlow_round_votes` `sum(votes)` and fingerprint | 44,478; fingerprint now **F1** (differs from F0 only through the 75 re-pointed rows) — record F1 |
| A9 | Rows for 2608 / 6296 / 6525 / 6626 in any table | none (ids absent from `players`) |

**B — after T3 + T4**

| # | Check | Expected |
|---|---|---|
| B1 | `brownlow_season_votes` rows / `sum(votes)` / winners / distinct seasons / distinct players | **16,120 / 79,113 / 112 / 98 / 4,275** |
| B2 | NULL counts `eligible_rank` / `polling_games` | 3 / 4,928 |
| B3 | `brownlow_round_votes` count / votes / fingerprint | **320,861 / 44,478 / F1 unchanged** |
| B4 | `sum(brownlow_votes) FROM player_season_stats` and `FROM player_career_stats` | **79,113** and 79,113 |
| B5 | `player_career_stats.brownlow_votes`: Harley Reid 5481, Matt Rowell 9239, Tom Green 12550, Dick Reynolds 3787, Bob Skilton 1979 | **10 / 89 / 73 / 154 / 180** |
| B6 | Charlie Cameron 2604, Jack Graham 6293 | 25, 9 (season rows 2019–2024 and 2019–2022 on the same ids as the round votes) |
| B7 | ISSUE-113 V5: player-seasons with positive round votes lacking a season row under the same player | 0 rows / 0 votes |
| B8 | DB-health reconciliation (5 checks) | all 0 |
| B9 | `import_rejections` for the loader batch | 0; batch status completed |
| B10 | Both AFL Tables URLs per player resolve to one canonical player (`/players/charlie-cameron-2604` reachable, `…-2608` 404; identity rows agree) | as stated |

---

## 7. Application and cache implications

| Surface | Rendering | Effect / action |
|---|---|---|
| `/brownlow` | `force-dynamic` | correct immediately after T4 |
| `/brownlow/[year]` | ISR `revalidate = 3600`; `generateStaticParams` reads `brownlow_season_votes` (empty at any build before T3, so no year is prerendered; on-demand renders are cached) | a year visited before T3 stays stale ≤1 h; building **after** T4 (step 11) removes the window |
| `/players/[slug]` | ISR 3600; top-500 prerendered at build; stale slug → `permanentRedirect` | 2604 / 6293 / 6521 / 6622 stale ≤1 h unless built after T4; the four duplicate URLs 404 permanently (no redirect table exists — candidate follow-up: a retired-id redirect map, since search engines may hold the `-2608` URLs) |
| `/players`, `/players/[slug]/matches`, `/players/compare`, `/grid-solver` | `force-dynamic` | correct immediately after T2 (identity) and T4 (Brownlow axes: `brownlow_medallist`, `brownlow_votes_career_min`, `brownlow_finish_*`, `brownlow_season_votes_min` read `brownlow_season_votes` / `player_career_stats`) |
| Advanced search / query builder `brownlow_votes` | live queries on `player_career_stats` | correct after T4 |
| `sitemap.xml` / `sitemap` | `revalidate = 86400` | lists the four retired ids for ≤24 h (harmless 404s) and gains the Brownlow year URLs within 24 h; a build after T4 refreshes it |
| `/admin/db-health` | live | expect 4 `games` mismatches between T1 and T2 only; 0 afterwards |
| Revalidation API | none exists (only admin `revalidatePath` on admin routes) | no on-demand purge; rely on step 11 ordering or the 1 h window |

---

## 8. Execution evidence

### 8.1 Execution stage, 2026-09-04 11:41–11:59 AEST — preflight and backup complete; STOPPED at the operator checkpoint before T1

Operator authorisation (2026-09-04): supervised in-place reconciliation per §5, rebuild-and-promote
excluded, DEV-before-PROD enforced, mandatory stop before the first `afldb_prod` write. Everything
below was executed under that authorisation; **no `BEGIN`/`UPDATE`/`DELETE`/`TRUNCATE`, no loader
`--apply`, no derived rebuild, no service restart and no timer change has been run on production.**

**Worktree.** `D:\dev\afldb-issue-137` on `claude/issue-137` at `169d738`; the only uncommitted
changes are the ISSUE-137 planning edits (`IssuesIndex.md`, `issues.md`, this file). GitHub
`origin/main` = `169d738`.

**DEV: streamanator** (`arm@10.0.40.100`, `afldb_dev`).

| Fact | Before | After |
|---|---|---|
| Checkout | branch `dev` at `18f92d2` (Merge ISSUE-130) — does **not** contain `169d738` | branch `main` at **`169d738`** |
| Procedure | — | `deploy/sync-dev.ps1 -SshTarget dev -RemoteRef main -AllowDirtyServer` (the repository's documented dev deploy: `git checkout main`, `git pull --ff-only`, `npm ci`, `npm run db:migrate`, `npm run build`, respawn via `Restart=always`, health). `-AllowDirtyServer` only because the host tree carries untracked settle manifests / backups; no tracked modification existed. `origin/dev` (`ee72563`) is an ancestor of `main` (42 behind, 0 ahead), so the branch switch discards nothing |
| Migrations | 085 applied, 0 pending | unchanged, 0 pending |
| Build / service | `wiBlXD9GJSXrOQvzVif6a`, MainPID 1559432 (since 2026-09-01) | **`S6wER-7aEXc_B3EID7XMX`**, respawned 1559432 → **722387** at 11:51:36 AEST; `/api/health` `{"status":"ok","database":"ok"}`; live `x-afldb-build` header equals the built `BUILD_ID` |
| `data/brownlow/` | absent | present; `season-votes.csv` `042a8fca…c70059`, `player-identity.csv` `17b512e4…493c61` (= manifest) |
| DB | `afldb_dev` 13,363 players; `brownlow_season_votes` 16,120 / 79,113; ISSUE-136 §10.3 query 0 rows | unchanged (no DEV data touched) |

**PROD: afldb-prod** (`afldb_prod`, all DSNs verified as `localhost:5432/afldb_prod`: owner/prod =
`afldb_owner`, import = `afldb_import`, backup = `afldb_backup`, app = `afldb_app`).

| Step | Result |
|---|---|
| Host / time | `afldb-prod`, 2026-09-04 11:42 → 11:59 AEST throughout; **outside the 04:15–05:15 exclusion window** |
| Settle timer | `afldb-settle-afltables.timer` active; last 2026-09-04 04:31:21, **next 2026-09-05 04:31:12 AEST**; settle service inactive/success; latest batch still **739** (no settle ran during the stage) |
| Service | `afldb` active, MainPID 770310 since 2026-09-03 22:16:18 AEST, `BUILD_ID w9ce2qfWBViW-3wnIRGzt`, `/api/health` ok — **not restarted** |
| §1 re-measurement (11:42, read-only) | **identical to §1.2–§1.7 in every figure**: mapping (2608→2604, 6296→6293, 6525→6521, 6626→6622), match rows 48/31/42/25 (146) with 0 shared `match_id`, round votes 21/18/23/13 (75, 0 votes), awards 4+1 winners / 1 nomination, settle projections 23/13/19/12 (67), 27 FK columns, 0 fact-table collisions (only `player_career_stats_pkey` ×4, `player_clubs_pkey` ×3, `player_name_aliases_uq` ×4), `data_overrides` 0, `data_edits` 0, spine rows 67, no fifth split (R6 = the four pairs), shells 13276/13277 only, `players` 13,277 `2b5adb88…`, `external_identities` 18,332 `fea7be90…`, `player_match_stats` 694,273 `68c2926c…`, `award_winners` 3,298 `b4d24b1f…`, `award_nominations` 766 `616a5b03…`, `brownlow_season_votes` 0, `brownlow_round_votes` **320,861 / 44,478 / F0 `17df6bab14dfe00ce6014651d983a92e`**, DB-health 0/0/0/0/0, `stat_availability` complete 98 (1924–2025), 2026 `in_progress` |
| Code (§5 step 3), 11:53 | `git pull --ff-only` **`657a875` → `169d738`** on `main`; tracked tree clean before and after (4 untracked settle manifests only); `git diff 657a875..169d738` touches **no** `package.json`/`package-lock.json`, **no** `src/`/`deploy/`, **no** migration — only `tools/migration/`, `tools/db/rebuild-test.ts`, `tools/rebuild/fitzroy/`, `data/brownlow/`, `data/reference/`, tests, docs, issue ledgers. `npm ci` **skipped** (deviation, see 8.2). `AFLDB_MIGRATE_TARGET=prod npm run db:status` → `085_matches_is_finals_series.sql` applied, **0 pending**. No build, no restart |
| Artefact on host | `season-votes.csv` `042a8fca776f3c3879585daa6524690d48add5e67f60c3f8dbdf5e5dc5c70059`, `player-identity.csv` `17b512e48374c12d2f666194aa99c7c713db57643ce5b31cc67f9f8931493c61`, manifest `db44fb86…565f1` |
| Loader `--validate-only` (§5 step 4, offline) | exit **0**, `ok: true`: **16,120 rows / 79,113 votes / 112 winners / 98 seasons (1924–2025) / 4,275 players**, link status unique 15,058 / resolved 1,062, NULLs eligible_rank 3 / polling_games 4,928 / three 10,589 / two 10,568 / one 9,003, ineligible 3, identity file 179 players / 539 rows (174 gap players, 5 override players / 14 rows) |
| Loader identity resolution (read-only SQL simulation of `ProfileResolver`, artefact rows inlined, 11:58) | every artefact row carries a profile path; **0 unresolved, 0 ambiguous, 0 (season, player) duplicates; 16,120 rows resolve to exactly one player each, 4,275 distinct players**. The **10 rows / 34 votes** on the renumbered paths (`Charlie_Cameron3.html` 6 rows/25 votes 2019–2024, `Jack_Graham2.html` 4 rows/9 votes 2019–2022) resolve to the **duplicates 2608 / 6296 today** and to 2604 / 6293 after T1 — exactly §1.6 / §4. (The loader has no database dry-run mode, so this simulation is the pre-apply evidence; the loader itself re-resolves inside its own fail-closed transaction.) |
| Backup (§5 step 2), 11:54:13 | `tools/maintenance/backup.sh` (as `afldb_backup`) → **`/home/arm/backups/afldb/afldb_prod-20260904-115413.dump`**, custom format, **21,238,290 bytes**, 7 s, `pg_restore --list` readable, **1,199 objects**, sha256 **`b77ebce0ca39655dff424d26390f7c0d6c192dbd88cdee6cbe4bba215623f499`** |
| Restore verification | `tools/maintenance/restore-test.sh <dump>` into `afldb_restore_test`: restored in 9 s (pg_restore exit 1 from the two tolerated extension-owner messages only), **9/9 parity checks PASS** (`player_match_stats` 694,273, `players` 13,277, `matches` 17,047, `clubs` 24, career games 694,273, career goals 413,049, Brownlow season votes empty = empty, unrecorded disposals 248,996, `stat_availability` 3,120) → "Restore verified: the backup is proven". Restored copy re-checked read-only: 13,277 / 18,332 / 694,273 / 3,298 / 766 / 8,802 staging rows / 0 season votes, round votes 320,861 / 44,478 / **F0 identical**, the eight player rows as in §1.2 |
| Off-host copy | `D:\backups\afldb\afldb_prod-20260904-115413.dump`, 21,238,290 bytes, sha256 **identical** |
| Pre-checkpoint refusal re-run (11:58, read-only) | §3.3 R1 mapping = the four pairs; R2 duplicates (dob NULL, debut 2025, final 2026) = 4, careers (dob set, final 2024) = 4, identities on the eight = 8, `players` 13,277, FK columns 27; R3 collisions 0/0/0/0/0; R4 every NO ACTION FK column outside the six planned ones = 0 (the six carry 4 / 146 / 75 / 5 / 1 / 67; cascade children on the duplicates: `player_career_stats` 4, `player_season_stats` 8, `player_club_season_stats` 8, `player_clubs` 4, `player_name_aliases` 4, `player_birth_evidence` 0); `brownlow_season_votes` 0; round votes 320,861 / 44,478 / F0 |

**Exact transaction prepared for T1** — `issues/open/AFLDB-ISSUE-137-t1.sql` (also staged on the
host as `/home/arm/i137_t1.sql`). One `BEGIN … COMMIT` as `afldb_owner`; `LOCK … IN EXCLUSIVE MODE`
on `players`, `external_identities` and the five other fact tables; the §3.1 mapping computed into a
temp table and refused unless it is exactly `{(2608,2604),(6296,6293),(6525,6521),(6626,6622)}`; every
§3.3 refusal condition re-checked inside the transaction (R1–R4, R6 start count 13,277, FK inventory
27); the §3.2 statements in order with `GET DIAGNOSTICS` count assertions **4 / 146 / 75 / 5 / 1 / 67 /
4 (final_season) / 4 (delete)**; the generic NO ACTION guard before the delete; the audit
`import_batches` row (`source_id` 8, tool `AFLDB-ISSUE-137 identity reconciliation`, mapping and counts
in `validation_result`); post-conditions asserted before `COMMIT` (players 13,273, §10.3 exactly the
four expected rows, `modern_four` 4, table counts 18,332 / 694,273 / 320,861 + 44,478 / 3,298 / 766,
career spans 2604:277:2014–2026, 6293:162:2017–2026, 6521:112:2019–2026, 6622:54:2022–2026, renumbered
identities on the career ids with status `unique`, HALT predicate = 1 per pair). Identity notes are
written in the ISSUE-136 importer's format plus the ISSUE-137 suffix. The script ends with `ROLLBACK`
unless invoked with `-v commit=1`, so the same file can be rehearsed first. Any `RAISE` aborts psql
(`ON_ERROR_STOP`) and the server rolls back. No fuzzy or name inference; no unrelated cleanup.

### 8.2 Deviations from the runbook / operator brief (for acknowledgement at the checkpoint)

1. **Fact-row total.** The brief and §2 say "223 fact-row updates"; §3.2's own per-statement counts
   sum to **298** FK re-points (4 identities + 146 + 75 + 5 + 1 + 67; 294 without the identity
   rows). 223 = 146 + 67 + 5 + 1 + 4, i.e. it omits the 75 `brownlow_round_votes` rows. Every
   component was re-measured identical; the transaction asserts the per-statement counts, not the
   headline. The headline figure in §2 is corrected below to 298.
2. **`npm ci` skipped on production** (§5 step 3): `package.json` and `package-lock.json` are
   byte-identical between `657a875` and `169d738`, so the install would only recreate an identical
   `node_modules` under the running service. `db:status` (via the existing `tsx`) ran fine.
3. **Order:** code update and loader validation ran before the backup (the operator's sequence);
   the runbook had backup first. No database effect either way; the dump is the later, more
   current state.
4. **Locks:** T1 locks all six fact tables plus `players`/`external_identities` in `EXCLUSIVE`
   mode, not only the three named in §3.4 — readers unaffected, writers (a settle) excluded for the
   whole transaction.
5. **DEV branch:** streamanator was on branch `dev` (`18f92d2`); the supported script's `-RemoteRef
   main` moved it to `main` (`169d738`). Nothing on `dev`/`origin/dev` is outside `main`.
6. **Migration status** was proven with the read-only `--status` variant rather than by running
   `db:migrate` (same outcome: 0 pending; `db:migrate` would have been a no-op).
7. `sync-dev.ps1` printed one PowerShell `NativeCommandError` line around `git fetch --prune`
   (stderr wrapping of git's progress output); the deploy continued and exited 0 with every step
   verified independently afterwards.
8. **Follow-up, out of scope:** the four retired duplicate URLs (`/players/charlie-cameron-2608`,
   `…/jack-graham-6296`, `…/jack-ross-6525`, `…/jack-williams-6626`) will 404 after T1 — no
   redirect map exists (§7). To be recorded as a separate follow-up issue at close-out; it does not
   block the repair.

Host artefacts left in `/home/arm`: `i137_t1.sql`, `i137_prod_stage_b.sh`, `i137_prod_run_b.sh`,
`i137_prod_stage_b.log` (remove at close-out). Local transcripts: this session's scratchpad
(`prod_preflight.txt`, `prod_stage_a.txt`, `prod_stage_b.txt`, `prod_precheck.txt`, `dev_deploy.txt`).

### 8.3 Checkpoint — awaiting operator authorisation to continue

Proposed continuation, in order, each step reported before the next: (0) optional rehearsal of
`i137_t1.sql` **without** `-v commit=1` on `afldb_prod` (identical statements, ends in `ROLLBACK`;
holds the locks for its sub-second duration) — or against `afldb_restore_test` (a byte-identical
restore of the dump) with `-v commit=1` as a full dry run; (1) **T1** with `-v commit=1`; (2) T2
`rebuild_derived.py`; (3) Acceptance A; (4) T3 `import_brownlow_season.py`; (5) T4; (6) Acceptance
B; (7) build + restart; (8) §7 public checks; (9) next-settle confirmation; (10) close-out.

Still to record after continuation: T1 assertion output and F1, T2/T4 durations, T3 loader output,
Acceptance A/B measured tables, the settle batch id after the repair.

### 8.4 Execution stage part 2, 2026-09-04 12:13 AEST — T1 rollback rehearsal and final pre-write check (both green)

Operator authorisation (2026-09-04, resumption): continue per §8.3 with the §8.2 deviations accepted,
the transaction headline corrected to **298** re-points, and a rollback rehearsal mandatory before any
committed production mutation.

**Stage 1 — rehearsal** (`bash /home/arm/i137_s1.sh`: read-only snapshot → `psql … -f i137_t1.sql`
**without** `-v commit=1` → read-only snapshot). Host `afldb-prod` at `169d738`, tracked tree clean,
`afldb` active (MainPID 770310, untouched), settle timer active (next 2026-09-05 04:31:12 AEST),
settle service inactive/success. `/home/arm/i137_t1.sql` sha256
`879587feea58cc1824687a3f15f4d8aa145009474521d259996177af5785521c` = the repository file
`issues/open/AFLDB-ISSUE-137-t1.sql` (LF-normalised), 296 lines.

| Check | Result |
|---|---|
| Session | `afldb_prod` / `afldb_owner`, `default_transaction_read_only = off`, `### MODE: REHEARSAL` |
| Mapping (temp table) | exactly `2608→2604`, `6296→6293`, `6525→6521`, `6626→6622` with the four ISSUE-136 rule ids |
| Per-statement assertions | `external_identities 4`, `player_match_stats 146`, `brownlow_round_votes 75`, `award_winners 5`, `award_nominations 1`, `staging.afltables_player_match 67`, `players.final_season 4`, cascade notices `player_career_stats 4 / player_clubs 4 / player_name_aliases 4 / player_club_season_stats 8 / player_season_stats 8`, `players retired 4`, **`all assertions passed`** |
| Post-conditions (inside the transaction) | §10.3 exactly the four career ids with two paths each; career rows `final_season` 2026 with dob/debut unchanged; renumbered identities on 2604/6293/6521/6622, status `unique`, ISSUE-136-format notes with the ISSUE-137 suffix; `players` 13,273; `external_identities` 18,332; `player_match_stats` 694,273; `award_winners` 3,298; `award_nominations` 766; round votes 320,861 / 44,478 / **F1 `bb2a047194c45bd643c518fb2d716ac5`**; audit `import_batches` row (id 740 in the rehearsal, `records_updated` 298) |
| End | `ROLLBACK` → `### ROLLED BACK (rehearsal; nothing written)`, psql exit 0, 12:13:23–12:13:25 AEST |
| Residue | post-snapshot **identical** to the pre-snapshot in every count and fingerprint (`players` 13,277 `2b5adb88…`, `external_identities` 18,332 `fea7be90…`, `player_match_stats` 694,273 `68c2926c…`, `award_winners` 3,298 `b4d24b1f…`, `award_nominations` 766 `616a5b03…`, `staging.afltables_player_match` 8,802 `aa1a069e…`, `player_career_stats` 13,275 `df022ca8…`, `player_season_stats` 58,753 `fdb74208…`, `brownlow_season_votes` 0, round votes 320,861 / 44,478 / **F0 `17df6bab…` unchanged**, DB-health 0/0/0/0/0, `import_batches` 315 rows / max id 739, no ISSUE-137 batch row, `derived_rebuilds` max id 14, the eight player/identity/career-stat rows as in §1.2). The only difference: `import_batches` id sequence `last_value` 739 → 740 (the rolled-back audit insert consumed one value — the sequence behaviour the runbook permits) |

**Stage 2 — final read-only pre-write check** (`i137_precheck.sql` under
`default_transaction_read_only = on`, 12:13:27 AEST, outside the 04:15–05:15 window): R1 mapping =
the four pairs, all eight identities `unique`; R2 duplicates (dob NULL / debut 2025 / final 2026) 4,
careers (dob set / final 2024) 4, identities on the eight 8, `players` 13,277, FK columns 27; R3
collisions 0/0/0/0/0; rows on the duplicates 146 / 75 (0 votes) / 5 / 1 / 67, match spans
229+48 / 131+31 / 70+42 / 29+25 with the duplicates' rows all 2025–2026; R4: only the six planned
NO ACTION columns (4/146/75/5/1/67) and the five CASCADE columns (4/4/4/8/8) hold duplicate ids, every
other FK column 0 (27 listed); `brownlow_season_votes` 0; round votes 320,861 / 44,478 / F0; latest
batch still 739 (settle 04:31); `stat_availability` complete 98; seasons 2025 `complete`, 2026
`in_progress`. **Nothing drifted since §8.1.**

Note on the fingerprint expectation: the round-vote fingerprint includes `player_id`, so after T1 it
becomes F1 by construction (§6 A8). The reverse-mapped fingerprint (career id → duplicate id for the
2025+ rows of the four career players) must equal F0 after T1; before T1 it maps 0 rows and equals F0
(measured). That is how "unchanged apart from the 75 re-pointed rows" is proven.

Host artefacts added: `/home/arm/i137_fp.sql`, `i137_precheck.sql`, `i137_s1.sh` (remove at
close-out). Local transcript: this session's scratchpad `prod_s1.txt`.

### 8.5 T1 COMMITTED — 2026-09-04 12:18:07–12:18:09 AEST (irreversible checkpoint; rollback point is the §8.1 backup)

`bash /home/arm/i137_s3.sh`: guards (T1 sha256 = the rehearsed `879587fe…`; 12:18 AEST outside the
04:15–05:15 window; read-only split-signature scan = exactly the four pairs) → `psql … -v commit=1
-f i137_t1.sql` → read-only snapshot → Acceptance A queries. Service untouched (MainPID 770310),
settle timer untouched (next 2026-09-05 04:31:12 AEST), settle service inactive throughout.

**T1 output** (`### MODE: COMMIT`, `ro = off`): mapping = the four pairs with rule ids; NOTICEs
`external_identities 4 / player_match_stats 146 / brownlow_round_votes 75 / award_winners 5 /
award_nominations 1 / staging.afltables_player_match 67 / players.final_season 4`, cascade
`player_career_stats 4 / player_clubs 4 / player_name_aliases 4 / player_club_season_stats 8 /
player_season_stats 8`, `players retired 4`, `all assertions passed`; in-transaction post-state
identical to the rehearsal (fingerprints `players e40f5193…`, `external_identities e51fd714…`,
`player_match_stats a824b57d…`, `award_winners 24c25cf9…`, `award_nominations 96515c67…`, round votes
**F1 `bb2a047194c45bd643c518fb2d716ac5`**); audit `import_batches` **id 741** (`records_read` 8,
`records_updated` 298, `records_rejected` 0, `completed`); `COMMIT` → `### COMMITTED`, psql exit 0.

**Acceptance A, post-T1 / pre-T2 portion (12:18:09–12:18:11 AEST, read-only)**

| # | Result |
|---|---|
| A1 | §10.3 = exactly 2604, 6293, 6521, 6622 with `{base, renumbered}` paths each ✔ |
| A2 | `modern_four` = 4 ✔ |
| A3 | `players` **13,273** / `external_identities` **18,332** / `player_match_stats` **694,273** / `brownlow_round_votes` **320,861** ✔; `award_winners` 3,298, `award_nominations` 766, `staging.afltables_player_match` 8,802 (fingerprint changed only by the 67 re-points); cascade removed 4 `player_career_stats` (13,275 → 13,271) and 8 `player_season_stats` (58,753 → 58,745) rows on the retired ids |
| A4 | HALT predicate = 1 for all four pairs, each resolving to the career id ✔ |
| A5 (match rows) | 2604: **277** (2014–2026), 6293: **162** (2017–2026), 6521: **112** (2019–2026), 6622: **54** (2022–2026); `players.final_season` 2026 on all four, dob/debut unchanged ✔ — `player_career_stats` still 229/131/70/29 until T2 (expected) |
| A6 | 2604: Rising Star nomination 2015, AA Team 2019, AA 40-Man Squad 2021 + 2022, AA Team 2023; 6293: Larke Medal 2016 ✔ |
| A7 (pre-T2) | DB-health games **4** / goals **4** / finals **1** / brownlow 0 / missing 0 — the expected T1→T2 gap (§7 anticipated the 4 `games`; the duplicates' goals 82/6/10/25 and Cameron's 4 finals show the same way). Re-measured after T2 |
| A8 | round votes 320,861 / 44,478, fingerprint **F1 `bb2a0471…`**; reverse-mapping the 2025+ rows of the four career ids back to the duplicate ids re-creates **F0 `17df6bab…` exactly** (75 rows mapped) → nothing beyond the 75 re-points changed ✔ |
| A9 | ids 2608/6296/6525/6626 absent from `players`; **all 27 FK columns** referencing `players` hold 0 rows for them ✔; settle projections now 23/13/19/12 on the career ids ✔ |
| A10 | split-signature scan (renumbered path, dob NULL, debut ≥ 2025, same name, base-path player finished the season before) = **0 rows** ✔ |
| Audit | batch 741 as above; `import_batches` 316 rows; `derived_rebuilds` still max id 14 |

Host artefacts added: `/home/arm/i137_accA.sql`, `i137_s3.sh`. Local transcript `prod_s3.txt`.

### 8.6 T2 derived rebuild — 2026-09-04 12:20:34–12:21:09 AEST; Acceptance A fully green

`bash /home/arm/i137_s5.sh`: `.venv/bin/python tools/migration/rebuild_derived.py` (Python 3.12.3,
`afldb_import@localhost:5432/afldb_prod`) launched detached, log `/home/arm/i137_t2.log`. Output:
`season_metadata 130 (2.8s)`, `player_clubs 16,750 (6.0s)`, `player_club_season_stats 59,002 (6.7s)`,
`player_season_stats 58,753 (7.4s)`, `player_career_stats 13,271 (5.9s)`, `club_seasons 1,640 (2.4s)`,
`search_rank 13,273 (2.8s)`, **Completed in 34.0s**, exit 0; `derived_rebuilds` ids 15–21 all
`completed`. Service and timer untouched.

**Acceptance A after T2 (12:21:09–12:21:11 AEST, read-only)** — every §6 A-line green:

| # | Result |
|---|---|
| A1 / A2 / A4 / A6 / A9 / A10 | unchanged from §8.5 (four pairs, `modern_four` 4, HALT 1 per pair, awards as expected, 0 retired-id rows across all 27 FK columns, split scan 0 rows) ✔ |
| A3 | `players` 13,273 / `external_identities` 18,332 / `player_match_stats` 694,273 / `brownlow_round_votes` 320,861 ✔ (fingerprints unchanged since T1); `player_career_stats` 13,271 (`3838d919…`), `player_season_stats` 58,753 (`7abe20de…`, the eight retired rows re-derived under the career ids) |
| A5 | `player_career_stats`: 2604 **277** games / 486 goals / 27 finals, 6293 **162** / 57 / 11, 6521 **112** / 25 / 1, 6622 **54** / 46 / 0; `players.final_season` 2026 ✔ |
| A7 | DB-health reconciliation games / goals / finals / brownlow / missing = **0 / 0 / 0 / 0 / 0** ✔ |
| A8 | round votes 320,861 / 44,478 / F1 `bb2a0471…`; reverse-mapped = F0 `17df6bab…` (75 rows) ✔ |
| Audit | `import_batches` still 316 rows / max id 741; `brownlow_season_votes` still 0 (T3 not yet run) |

Host artefacts added: `/home/arm/i137_s5.sh`, `i137_t2.log`. Local transcript `prod_s5.txt`.

### 8.7 T3 Brownlow restoration + T4 derived rebuild — 2026-09-04 12:23:49–12:24:27 AEST; Acceptance B fully green

`bash /home/arm/i137_s6.sh`. Pre-T3 read-only guard: `brownlow_season_votes` 0, DB-health `games` 0,
retired ids in `players` 0, round-vote fingerprint F1 — passed. Artefacts on host unchanged
(`season-votes.csv` `042a8fca…c70059`, `player-identity.csv` `17b512e4…493c61`). Service (MainPID
770310) and settle timer untouched.

**T3** — `.venv/bin/python tools/migration/import_brownlow_season.py` (apply mode,
`afldb_import@localhost:5432/afldb_prod`), detached, log `/home/arm/i137_t3.log`: manifest 16,120 rows /
79,113 votes / 112 winners / 98 seasons; **`brownlow_season_votes 16,120 (79,113 votes, 112 winners, 98
seasons, 4275 players)`**, **`brownlow_round_votes 320,861 (untouched)`**, `completed in 1.7s`, exit 0.
Audit `import_batches` **id 742** (`import_brownlow_season.py` → `brownlow_season_votes`, `completed`,
**records_read 16,120 / records_inserted 16,120 / records_updated 0 / records_rejected 0**, 12:23:51–12:23:52),
`import_rejections` for the batch **0**.

**T4** — `rebuild_derived.py` detached, log `/home/arm/i137_t4.log`: the same seven targets
(130 / 16,750 / 59,002 / 58,753 / 13,271 / 1,640 / 13,273), **Completed in 33.1s**, exit 0;
`derived_rebuilds` ids 22–28 `completed` (28 rows total).

**Acceptance B (12:24:27–12:24:29 AEST, read-only)**

| # | Result |
|---|---|
| B1 | `brownlow_season_votes` **16,120 / 79,113 / 112 winners / 98 seasons (1924–2025) / 4,275 players** ✔ |
| B2 | NULL `eligible_rank` **3**, NULL `polling_games` **4,928**; ineligible 3; `link_status_value` trusted 16,120 ✔ |
| B3 | `brownlow_round_votes` **320,861 / 44,478 / F1 `bb2a047194c45bd643c518fb2d716ac5` unchanged**; reverse-mapped = F0 `17df6bab…` ✔ |
| B4 | `sum(brownlow_votes)`: `player_season_stats` **79,113**, `player_career_stats` **79,113** ✔ |
| B5 | Harley Reid 5481 **10**, Matt Rowell 9239 **89**, Tom Green 12550 **73**, Dick Reynolds 3787 **154**, Bob Skilton 1979 **180** ✔ |
| B6 | Charlie Cameron 2604 **25** (2019=11, 2020=1, 2021=1, 2022=3, 2023=8, 2024=1), Jack Graham 6293 **9** (2019=1, 2020=3, 2021=3, 2022=2) — season rows and round-vote sums identical per season on the same ids ✔ |
| B7 | ISSUE-113 V5 (player-seasons with positive round votes and no season row under the same player) **0 rows / 0 votes** ✔ |
| B8 | DB-health reconciliation **0 / 0 / 0 / 0 / 0** ✔ |
| B9 | batch 742 `completed`, 16,120 / 16,120 / 0 rejected, 0 rejection rows ✔ |
| B10 | HALT predicate 1 per pair, resolving to 2604 / 6293 / 6521 / 6622 (identity rows agree); URL checks deferred to the post-build §7 pass ✔ |
| extra | `stat_availability` `brownlow_season_total` complete 98 (1924–2025); seasons 2025 `complete`, 2026 `in_progress`; 98 seasons carry ≥ 1 winner (max 3, the tied years) |

Acceptance A re-run after T4: unchanged and green (A1, A2, A4, A5 277/162/112/54, A6, A9 0 rows across the
27 FK columns, A9b 23/13/19/12, A10 0 rows). Table state: `players` 13,273 `e40f5193…`,
`external_identities` 18,332 `e51fd714…`, `player_match_stats` 694,273 `a824b57d…`, `award_winners` 3,298,
`award_nominations` 766, `staging.afltables_player_match` 8,802, `brownlow_season_votes` 16,120
(`385196643e161927c611b0a7d9701b6e`), `player_career_stats` 13,271, `player_season_stats` 58,753;
`import_batches` 317 rows / max id 742. Career-stat Brownlow totals on the four: 2604 = 25, 6293 = 9,
6521 = 0, 6622 = 0.

Host artefacts added: `/home/arm/i137_accB.sql`, `i137_s6.sh`, `i137_t3.log`, `i137_t4.log`. Local
transcript `prod_s6.txt`.

### 8.8 Build + restart — 2026-09-04 12:28:18–12:31:21 AEST; post-restart verification 12:33–12:36 AEST

`bash /home/arm/i137_s8.sh` launched detached (`setsid nohup`, log `/home/arm/i137_s8.log`) at 12:28:18
with the service still on `w9ce2qfWBViW-3wnIRGzt` (MainPID 770310 since 2026-09-03 22:16).

| Step | Result |
|---|---|
| Build | `npm run build` under nvm Node v22.23.2 / npm 10.9.8: Next.js 16.3.1 (webpack), `Environments: .env`, compiled 11.4 s, TypeScript 11.0 s, **1,499 static pages** generated, `prepare-standalone` copied static/public/coming-soon and created `.next/cache`; **exit 0 at 12:31:08** (2 min 50 s). `BUILD_ID` **`MRjsomoqFJRsjZWElQ6A0`**, identical in `.next/standalone/.next/BUILD_ID`; standalone `server.js` written 12:31:06 |
| Restart (documented no-sudo path) | `kill` MainPID 770310 → systemd `Restart=always` respawned **MainPID 803941 at 12:31:18** (`NRestarts=1`), primary started **2 workers** (`AFLDB_WORKERS=2`); the old process is gone |
| Health | local `/api/health` → `{"status":"ok","database":"ok","latencyMs":27}` at 12:31:20; public `https://beta.afldb.com/api/health` → 200 `{"status":"ok","database":"ok","latencyMs":1}` at 12:33:11 (Cloudflare → Caddy → Node) |
| Served build header | **not available on production by configuration**: the `x-afldb-build` / `x-afldb-worker` / `x-afldb-pid` headers come from the `deploy/server-cluster.mjs` tracing wrapper, which is installed only when `AFLDB_TRACE_REQUESTS=on`; production `.env` does not set it (the dev host does, which is why `sync-dev.ps1`'s header check passes there). Build identity is proven instead by the running process (started 12:31:18) having imported `.next/standalone/server.js` written at 12:31:06, plus the prerendered output below |
| Security headers | origin responses carry the **production** branch of `next.config.ts`: CSP `script-src 'self' 'unsafe-inline'` (no `unsafe-eval`) and `Strict-Transport-Security: max-age=31536000; includeSubDomains` — `next build` loaded `.env` (`AFLDB_ENV=production`). `prepare-standalone` printed "AFLDB_ENV is not production; building with development headers" because that separate Node process does not load `.env`; the flag has no effect there beyond the log line (`isProductionBuild` is only used for the message). Observation only |
| Prerendered Brownlow output | **98 `/brownlow/[year]` pages, 1924–2025** in `.next/server/app/brownlow/`; the 2019 page lists Charlie Cameron; the 1996 page reads "James Hird and Michael Voss with 21 votes" |
| Prerendered player output | top-500 prerender includes `charlie-cameron-2604.html` (113 references to 2026, **0** references to 2608); no retired-id page exists |
| Route probes (anonymous, `AFLDB_BETA_GATE=on`) | local and public: `/brownlow`, `/brownlow/2025`, `/brownlow/1996`, `/players/charlie-cameron-2604`, `…-2608`, `/players/jack-graham-6293`, `…-6296`, `/players/jack-ross-6521`, `/players/jack-williams-6622`, `/players/compare`, `/grid-solver`, `/sitemap.xml`, `/sitemap/1.xml` → **307 `/beta?from=…`** (the gate, as designed); `/admin/db-health` → 307 `/admin/login`; `/api/health` 200; `/robots.txt` 200 |
| Grid Solver Brownlow axes | the exact predicates from `src/db/queries/grid-solver.ts`, read-only: `brownlow_medallist` 91 players, `brownlow_finish_exact` place 1 → 91, `brownlow_top_finish` ≤ 3 → 216, `brownlow_votes_career_min` ≥ 100 → 126, `brownlow_season_votes_min` ≥ 30 → 30, `brownlow_winner_votes_min` ≥ 30 → 16, Charlie Cameron 2604 satisfies `brownlow_season_votes_min` ≥ 10 (2019 = 11), retired ids in `brownlow_season_votes` 0 |
| Settle timer | untouched: next 2026-09-05 04:31:12 AEST, last 2026-09-04 04:31:21 |

**Limits of this verification.** With the beta gate on, an anonymous client (curl from the host or the
workstation) cannot render any gated page, so the §5 step 12 content checks of `/brownlow`,
`/brownlow/2025`, `/brownlow/1996`, `/players/charlie-cameron-2604` (277 games, 2026 rows),
`/players/charlie-cameron-2608` (404), the compare page, a Grid Solver Brownlow axis, `/admin/db-health`
(all 0) and the sitemap segment listing the Brownlow years remain **operator browser checks** under a
beta/admin session. The database-level equivalents (§8.6–§8.7 acceptance, the prerendered HTML and the
axis predicates above) are all green.

Host artefacts added: `/home/arm/i137_s8.sh`, `i137_s8_launch.sh`, `i137_s8.log`, `i137_s9.sh`. Local
transcripts `prod_s9.txt` and the workstation `public_checks.sh` output (in the session scratchpad).

### 8.9 Outstanding after the execution stage

1. Operator browser checks listed under §8.8 "Limits".
2. §5 step 13 — after the next settle (2026-09-05 04:31 AEST): a new `import_batches` row (> 742)
   `completed`; `staging.afltables_player_match` rows for the four players on 2604 / 6293 / 6521 / 6622;
   nothing on 2608 / 6296 / 6525 / 6626 (the ids no longer exist); DB-health still 0.
3. §5 step 14 close-out: `issues.md` resolution, `IssuesIndex.md`, the retired-URL redirect follow-up issue
   (§8.2 item 8), removal of `/home/arm/i137_*` and `/home/arm/i137_prod_*` scratch files, and the decision on
   `afldb_prod_auth_recovery`. Keep `afldb_prod-20260904-115413.dump` (host + `D:\backups\afldb\`) until then.

### 8.10 Verification stage prepared 2026-09-04 (post-build) — operator browser checklist and the post-settle script

No production command was run in this stage; it prepares the two outstanding verifications in §8.9.
Every expected value below is derived from the tracked artefact (`data/brownlow/season-votes.csv`),
the §8.5–§8.7 acceptance measurements or the rendering code, and is stated before the check is run.

**A — operator browser checks** (a signed-in beta session on `https://beta.afldb.com`; an anonymous
client gets the gate's 307, which is why these cannot be automated from the host). Record the result
in the right-hand column; a mismatch is a stop condition.

| # | URL | Expect | Result |
|---|---|---|---|
| A1 | `/brownlow` | Winners table: **112 rows across 98 seasons, 1924–2025** (rendered season count 98). Career vote leaders (top 50): **1 Gary Ablett Jnr 262, 2 Patrick Dangerfield 259, 3 Gary Dempsey 246**. Multiple winners section lists the four triple medallists **Bob Skilton, Dick Reynolds, Haydn Bunton, Ian Stewart** | **PASS** |
| A2 | `/brownlow/2025` | Winner **Matt Rowell 39**; then **Nick Daicos 32, Bailey Smith 29, Jordan Dawson 27, Andrew Brayshaw 26** | **PASS** |
| A3 | `/brownlow/1996` | Tied winners **James Hird and Michael Voss, 21 votes each** | **PASS** |
| A4 | `/players/charlie-cameron-2604` | **277 games**, career **2014–2026** (2025 and 2026 season rows present, Brisbane), summary **Brownlow votes 25**, per-season Brownlow column **2019 = 11, 2020 = 1, 2021 = 1, 2022 = 3, 2023 = 8, 2024 = 1**, and a **Brownlow Medal** section listing those six seasons | **PASS** |
| A5 | `/players/charlie-cameron-2608` | **404.** Expected and **not** an ISSUE-137 failure — the id is retired and no redirect map exists (§8.2 item 8, close-out follow-up) | **PASS** (expected 404) |
| A6 | `/players/jack-graham-6293`, `/players/jack-ross-6521`, `/players/jack-williams-6622` | **162 / 112 / 54 games**, each running to **2026**; Brownlow votes **9 / 0 / 0**. (`…-6296`, `…-6525`, `…-6626` also 404, same disposition as A5) | **PASS** |
| A7 | `/players/compare` | Compare **Charlie Cameron** with any other player: the **Brownlow votes** row reads **25** for Cameron and the games row **277** | **PASS** |
| A8 | `/grid-solver` | Any Brownlow axis resolves and returns players — e.g. **Brownlow medallist** (91 players qualify), **X+ career Brownlow votes** with X = 100 (126 players), **X+ Brownlow votes in a season** with X = 10 (Charlie Cameron qualifies, 2019 = 11). The SQL behind these axes was verified in §8.8; this check is that the UI renders them | **BLOCKED** — role |
| A9 | `/admin/db-health` (super-admin session) | Reconciliation **all five checks 0**; the table inventory shows `brownlow_season_votes` populated (**16,120** rows) | **BLOCKED** — role |
| A10 | `/sitemap.xml` → the segment it lists | The segment containing player/other URLs also carries **`/brownlow/<year>` entries, 1924–2025**. The sitemap revalidates every 24 h and was rebuilt at 12:31, so the Brownlow years should already be present; if they are not, re-check after 24 h before treating it as a failure | **BLOCKED** — config |

**B — post-settle verification** (after the scheduled settle at **2026-09-05 04:31 AEST**; §5 step 13).
Read-only. The script is tracked at `issues/open/AFLDB-ISSUE-137-settle-check.sql`; it pins
`default_transaction_read_only = on`, issues only `SELECT`, and ends in a **VERDICT** table whose 26
rows must all read `PASS`. Transfer it to the host as LF (`scp` the file, do not paste it), then:

```sh
# on afldb-prod, from ~/projects/afldb, after the settle has finished
systemctl status afldb-settle-afltables.service --no-pager | head -20
systemctl list-timers afldb-settle-afltables.timer --no-pager
journalctl -u afldb-settle-afltables.service --since '2026-09-05 04:00' --no-pager | tail -40
set -a; . ./.env; set +a
psql -v ON_ERROR_STOP=1 -X -q -f /home/arm/i137_settle_check.sql -d "$AFLDB_OWNER_DATABASE_URL"
```

What the script proves, against §8.9 item 2 and the operator brief:

- a new `import_batches` row **> 742** exists and is `completed`, with **0** `import_rejections` (checks 1–2);
- the settle service itself completed (`systemctl`/`journalctl` above — outside SQL);
- the four renumbered AFL Tables paths still resolve **only** to 2604 / 6293 / 6521 / 6622, status
  `unique`, and the eight paths are owned by exactly **four** players (checks 8–9, plus section 3);
- **no duplicate player was recreated**: the retired ids are absent from `players` and from **all 27**
  FK columns referencing `players(id)` (check 3, section 5), and the generic renumbered-profile split
  signature returns **0 rows** (check 10, section 9) — so a *fifth* split would also be caught;
- `staging.afltables_player_match` holds **0** rows on the retired ids and ≥ 67 on the career ids
  (checks 6–7; the count may legitimately grow as 2026 matches settle);
- Brownlow season totals unchanged — **16,120 / 79,113 / 112 winners / 98 seasons / 4,275 players**
  (checks 11–15) and derived season and career totals still **79,113 / 79,113** (checks 19–20);
- `brownlow_round_votes` structurally correct — **320,861 / 44,478 / F1
  `bb2a047194c45bd643c518fb2d716ac5`** (checks 16–18). Note the settle *can* legitimately write
  `brownlow_round_votes` (it is one of `PLAYER_MATCH_TARGET_TABLES`) if AFL Tables publishes a 2026
  vote; today the table ends at season 2025. A changed fingerprint is therefore **investigate, not
  automatically red** — section 7 prints `max(season)` so a new 2026 row is distinguishable from a
  disturbance of the historical rows;
- no repaired career shrank below its post-repair games (check 21 — growth from new 2026 matches is
  allowed, loss is not);
- DB-health remains **0 on all five** reconciliation checks (checks 22–26). The nightly settle
  recomputes derived stats in its own transaction for the players it touched
  (`settle-afltables.ts` → `recomputePlayerDerivedStats`), so a settle that writes canonical rows
  should leave these at 0 without any manual rebuild.

**Stop conditions for stage B.** Any `CHECK` row; a retired id reappearing anywhere; a settle batch in
`failed`/`running`; a new split-signature row. Persist the exact output and stop — do **not** re-run
T1, reload Brownlow, or rebuild the database. The rollback point remains
`afldb_prod-20260904-115413.dump` (§3.5).

### 8.11 Retention decisions carried to close-out

| Artefact | Status 2026-09-04 | Disposition |
|---|---|---|
| `~/backups/afldb/afldb_prod-20260904-115413.dump` (host) and `D:\backups\afldb\afldb_prod-20260904-115413.dump` (off-host), sha256 `b77ebce0…f499`, restore-tested 9/9 | retained | **Keep** until §8.10 A and B are green and the close-out evidence is persisted. It is the only rollback point for the T1 commit |
| `afldb_prod_auth_recovery` (database on the host) | retained | **ISSUE-137's own hold is released**: it was held under `AFLDB-ISSUE-113` §8.18.5 until §6 Acceptance B passed, and Acceptance B passed 2026-09-04 12:24 (§8.7). It is **not** to be dropped at this close-out, because `AFLDB-ISSUE-126` (production audit-trail expectations after the 2026-09-02 promotion lost `auth_audit_log`, `beta_access_codes`, `site_settings`) is still Open and owns it. Record the release here and leave the retirement decision to ISSUE-126 |
| `/home/arm/i137_*` scratch files (T1 SQL, stage scripts, acceptance SQL, logs — 19 files, plus `i137_settle_check.sql` once transferred) | on host | **Remove at close-out** (`rm -f /home/arm/i137_*`) once §8.10 B has run and its output is persisted in this runbook. The durable copies are tracked here: `AFLDB-ISSUE-137-t1.sql`, `AFLDB-ISSUE-137-settle-check.sql` and the §8.1–§8.10 evidence |
| Retired duplicate URLs `/players/charlie-cameron-2608`, `…/jack-graham-6296`, `…/jack-ross-6525`, `…/jack-williams-6626` | 404 | **Not** an ISSUE-137 failure (§8.2 item 8). Raise a separate follow-up issue at close-out for a retired-id redirect map; search engines may still hold those URLs |

### 8.12 Stage A executed — browser verification 2026-09-04 03:01–03:07 UTC (13:01–13:07 AEST)

Read-only browser session against `https://beta.afldb.com` (Playwright, Chromium). No production
command, database write, site setting, user or service change was made. The session was established at
`/admin/login` with a temporary **Admin**-role account (password + TOTP); the credentials were treated
as ephemeral input and are not recorded here or anywhere in the repository.

**Route note.** `/login` is behind the beta gate and 307s to `/beta?from=%2Flogin`, exactly as §8.10 A
anticipates for an un-admitted client. `/admin/login` is a public path and `src/middleware.ts:139-141`
admits an admin session through the beta gate, so that is the entry point used. Every check below was
performed inside that authenticated session.

**A1 — `/brownlow` — PASS.** Winners-by-season table **112 rows**, **98 distinct seasons**, range
**1924–2025**; the page's own prose states "98 seasons". Career vote leaders (50 rows) begin
**1 Gary Ablett 262 (2 medals, 357 games) · 2 Patrick Dangerfield 259 · 3 Gary Dempsey 246**; the
leader row links to `/players/gary-ablett-4702` and 357 games identifies Ablett Jnr (the runbook's
"Ablett Jnr" is a disambiguation, not the rendered string — the site renders the display name
`Gary Ablett`). Multiple winners: 17 rows, the triple medallists exactly **Haydn Bunton (1931, 1932,
1935), Dick Reynolds (1934, 1937, 1938), Bob Skilton (1959, 1963, 1968), Ian Stewart (1965, 1966,
1971)**.

**A2 — `/brownlow/2025` — PASS.** Heading "Won by Matt Rowell with 39 votes"; leaderboard
**1 Matt Rowell 39 (Winner) · 2 Nick Daicos 32 · 3 Bailey Smith 29 · 4 Jordan Dawson 27 ·
5 Andrew Brayshaw 26** (188 rows total).

**A3 — `/brownlow/1996` — PASS.** "Shared by James Hird and Michael Voss with 21 votes"; the table
ranks **Hird 21 (Winner), Corey McKernan 21 (Ineligible), Voss 21 (Winner)** — the ineligibility
handling is intact.

**A4 — `/players/charlie-cameron-2604` — PASS, every element.** Summary tiles **277 GAMES / 486 GOALS
/ 25 BROWNLOW VOTES / 27 FINALS / 2 PREMIERSHIPS**; prose "played 277 AFL games (2014–2026)"; last
match **21 Aug 2026**; 13 season rows including **2025 (Brisbane Lions, 25 games)** and
**2026 (Brisbane Lions, 23 games, "In progress")**; Clubs table Brisbane Lions 2018–2026 **204** +
Adelaide 2014–2017 **73** = 277, and the 13 season-row game counts also sum to **277**. Season `BV`
column: **2019 = 11, 2020 = 1, 2021 = 1, 2022 = 3, 2023 = 8, 2024 = 1**, 2025 = 0, 2018 and the
Adelaide seasons 0, 2026 "Not yet awarded" — sum 25. A **Brownlow Medal** section lists exactly those
six seasons with ranks (2019 #32, 2020 #157, 2021 #160, 2022 #112, 2023 #44, 2024 #152).

**A5 — `/players/charlie-cameron-2608` — PASS (expected 404).** HTTP **404**, page title "Player not
found", no `Location` header. `…/jack-graham-6296`, `…/jack-ross-6525`, `…/jack-williams-6626` also
return **404** with no redirect. Disposition unchanged: not an ISSUE-137 failure; the retired-id
redirect map remains the close-out follow-up (§8.2 item 8, §8.11).

**A6 — the other three repaired careers — PASS.**

| Player | Prose | Season/club rows sum | Brownlow |
|---|---|---|---|
| `jack-graham-6293` | "played 162 AFL games (2017–2026) … polling 9 Brownlow votes" | Richmond 131 + West Coast 31 = **162** | **9**, Brownlow Medal section present |
| `jack-ross-6521` | "played 112 AFL games (2019–2026)" | 7+7+15+15+19+7+23 + 2026 in progress 19 = **112** | **0** — every season `BV` 0, so no votes clause and no Brownlow section is rendered, which is the correct rendering of zero |
| `jack-williams-6622` | "played 54 AFL games (2022–2026)" | West Coast 1+10+18+13 + 2026 in progress 12 = **54** | **0**, same disposition |

Each runs to 2026 with an "In progress" 2026 row.

**A7 — `/players/compare` — PASS, with additional evidence.** Typing "Charlie Cameron" into the
first-player combobox returns **one** modern Charlie Cameron —
*Adelaide, Brisbane Lions · 2014–2026 · 277 games* — alongside three historical namesakes (Fitzroy /
North Melbourne 1926–1936, Geelong / South Melbourne 1905–1910, Fitzroy 1897). **No duplicate 2025–2026
entry appears**, so the split is gone from the player-name suggestion surface as well as from the
profile. Comparing against Jeremy Cameron resolved to `?a=2604&b=6934`, and the comparison rows read
**Games 277 | 297** and **Brownlow votes 25 | 123**.

**A8 — `/grid-solver` — BLOCKED, not a failure.** The route returns **404**. This is
`requireAudience(gridAudience)` (`src/lib/auth/audience.ts:24-30`) rejecting an under-ranked session,
not a missing page or a broken axis: a signed-out visitor is redirected to `/admin/login`, whereas a
signed-in account below the threshold gets `notFound()`. The verification account is role **Admin**,
and the `/admin` dashboard states in its own copy that the grid solver is "Currently open to super
admins only" — matching the recorded production setting (`gridAudience = super_admin`). Widening it is
a site-settings change and is out of scope for a read-only verification stage. The SQL behind the three
Brownlow axes was already verified in §8.8; what remains unverified is only the UI rendering of them.

**A9 — `/admin/db-health` — BLOCKED, not a failure.** The page calls `requireSuperAdmin()`
(`src/app/admin/db-health/page.tsx:21`), which redirects the Admin-role session to `/admin` (observed:
navigating to `/admin/db-health` lands on `/admin`, HTTP 200, no error). The five reconciliation checks
were measured directly as 0/0/0/0/0 in §8.7, and `brownlow_season_votes` at 16,120 rows in §8.7; this
check would only re-confirm them through the admin UI.

**A10 — `/sitemap.xml` — BLOCKED by configuration; the check's premise was wrong.** `/sitemap.xml`
returns **404 `text/plain`**, and so do `/sitemap/0.xml` and `/sitemap/1.xml`. This is by design and
predates the repair: `indexingEnabled()` (`src/lib/indexing.ts:14-20`) returns false whenever
`AFLDB_BETA_GATE=on`, and `src/app/sitemap.xml/route.ts:23-28` then deliberately 404s rather than
publish an empty index; `src/app/sitemap.ts:35,63` returns no segments for the same reason.
`/robots.txt` confirms the posture — it ends `User-Agent: *` / `Disallow: /` and advertises **no**
`Sitemap:` line. The sitemap surface is therefore unreachable on any beta-gated host regardless of the
repair, so §8.10 A10 as written cannot be executed on `beta.afldb.com`; it becomes checkable only when
the beta gate is lifted. The underlying data is nonetheless proven: the segment's Brownlow URLs come
from `SELECT DISTINCT season FROM brownlow_season_votes` (`src/app/sitemap.ts:112-114,137-140`), and
§8.7 measured that at **98** distinct seasons — the same 98 the `/brownlow` page rendered in A1.

**Console.** The only recurring console error on every page is a pre-existing, unrelated CSP block of
the Cloudflare Insights beacon (`script-src 'self' 'unsafe-inline'` refusing
`static.cloudflareinsights.com/beacon.min.js`). It appears on the beta gate and the admin login page
too, so it is not introduced by this build or this repair. No hydration, render or data error was
logged on any repaired page.

**Verdict for stage A: 7 PASS, 0 FAIL, 3 not executable with the available session/configuration.** No
stop condition was triggered. Every value stated in advance in §8.10 A was met exactly, with the two
wording clarifications noted (rendered name "Gary Ablett"; zero Brownlow votes render as an absent
section rather than a printed 0).

**Carried to close-out (new):**

1. A8 and A9 need a **super-admin** session to execute. Either run them under the existing super-admin
   account, or accept the §8.7/§8.8 SQL measurements as sufficient and record A8/A9 as closed on that
   basis. Do not widen `gridAudience` for the purpose of the check.
2. A10 is not executable while `AFLDB_BETA_GATE=on`. Fold it into the beta-lift checklist rather than
   holding ISSUE-137 open for it, and record the §8.7 season-count evidence as the substitute.
3. Stage B (§8.10 B, post-settle) remains outstanding until after **2026-09-05 04:31 AEST**.

### 8.13 Stage B not yet executable — read-only pre-check 2026-09-04 15:28 AEST (05:28 UTC)

Read-only host and database inspection only. No production write, no timer change, no settle trigger,
no scratch-file removal.

| Probe | Result |
|---|---|
| `date` on `afldb-prod` | `2026-09-04 15:28:53 AEST` (05:28:53 UTC) |
| `systemctl list-timers afldb-settle-afltables.timer` | **NEXT `Sat 2026-09-05 04:34:59 AEST` (13 h)**, LAST `Fri 2026-09-04 04:31:21 AEST` (10 h ago). The 04:34:59 is `OnCalendar 04:30` plus that day's randomised delay |
| `systemctl status afldb-settle-afltables.service` | `inactive (dead) since Fri 2026-09-04 04:31:56 AEST`, `Main PID 786905 (code=exited, status=0/SUCCESS)`; journal tail ends `settle chain complete — label settle-2026-2026-09-04-0431`, with 0 open candidates, 0 apply failures, 0 disagreements |
| `import_batches WHERE id >= 739` | `739 completed 2026-09-04 04:31:39 (9,823 read)`, `741 completed 12:18:07 (8)`, `742 completed 12:23:51 (16,120)`. **No batch > 742.** (740 is the id burned by the §8.4 rehearsal rollback) |
| `/home/arm/i137_*` | 19 files, unchanged since 12:36 AEST; `i137_settle_check.sql` **not yet transferred** |

**Conclusion.** The only settle run to date, batch 739 at 04:31 AEST, executed **before** the repair
(T1 committed 12:18). The first post-repair scheduled settle has not run. Stage B (§8.10 B) is
therefore not executable and **ISSUE-137 stays Open**; no acceptance assertion was evaluated, red or
green. Nothing in §8.11 is actioned: the backup, `afldb_prod_auth_recovery` and the `i137_*` scratch
files all stay in place.

**Next action (fresh session, after 2026-09-05 ~04:36 AEST).** `scp` the tracked
`issues/open/AFLDB-ISSUE-137-settle-check.sql` to `/home/arm/i137_settle_check.sql` as LF, then run the
four commands in §8.10 B. Note for that session: `ssh`/`scp` to `afldb-prod` must go through **PowerShell**
(Git Bash gets `Permission denied (publickey)`), the ssh host alias is **`afldb`** (not `afldb-prod`), and
a remote command must use single quotes inside a PowerShell double-quoted string with `` `$VAR `` for the
DSN — nested `\"` is mangled and silently drops `-d`, which then connects as role `arm` and fails.

---

## 9. Stage record

- **2026-09-04 — planning stage (this document).** Read-only measurement of `afldb_prod` (two
  scripted psql sessions under `default_transaction_read_only = on`, 11:23–11:26 AEST; host probes
  `git log`, `systemctl list-timers`, `ls`), repository verification of the settle chain, loader,
  derived rebuild and cache surfaces. Strategy chosen: **in-place reconciliation** (§2). No
  production write, migration, deploy, restart or timer change was made. Execution requires
  separate operator authorisation.
- **2026-09-04 11:41–11:59 AEST — execution stage, part 1 (preflight to checkpoint).** Operator
  authorised §5 with a mandatory stop before the first production write. DEV deployed to `169d738`
  and validated; PROD re-measured read-only (identical), code pulled to `169d738` without build or
  restart, `db:status` 0 pending, loader `--validate-only` ok, loader resolution simulated read-only
  (0 failures), backup `afldb_prod-20260904-115413.dump` taken, restore-tested (9/9) and copied
  off-host, §3.3 refusal/collision checks re-run, T1 rendered as `AFLDB-ISSUE-137-t1.sql`. Evidence
  §8.1, deviations §8.2, continuation plan §8.3. **Stopped at the checkpoint; no `afldb_prod`
  write, derived rebuild, loader apply, restart or timer change.**
- **2026-09-04 12:13 AEST — execution stage, part 2 (rehearsal + final pre-write check).** T1
  rehearsed on `afldb_prod` without `-v commit=1`: every assertion passed, `ROLLBACK` reached, every
  count/fingerprint unchanged afterwards (only the `import_batches` id sequence advanced 739→740).
  Final read-only refusal/collision check identical to §8.1. Evidence §8.4. **No committed write yet.**
- **2026-09-04 12:18 AEST — T1 COMMITTED on `afldb_prod`** (batch 741, 298 re-points, four duplicate
  players retired, every assertion passed). Post-T1 Acceptance A green for every check decidable before
  T2; DB-health shows the expected 4/4/1 games/goals/finals gap until the derived rebuild. Evidence §8.5.
- **2026-09-04 12:21 AEST — T2 derived rebuild complete (34 s, exit 0); Acceptance A fully green**
  (career games 277/162/112/54, DB-health 0/0/0/0/0, F1 recorded, reverse-mapped = F0). Evidence §8.6.
- **2026-09-04 12:24 AEST — T3 Brownlow season load (batch 742: 16,120 read / 16,120 inserted / 0
  rejected) and T4 derived rebuild complete; Acceptance B fully green** (16,120 / 79,113 / 112 / 98,
  derived totals 79,113, B5 10/89/73/154/180, round votes 320,861 / 44,478 / F1, DB-health 0×5).
  Evidence §8.7. Build + restart not yet run.
- **2026-09-04 12:28–12:36 AEST — build + restart complete.** `npm run build` exit 0, BUILD_ID
  `MRjsomoqFJRsjZWElQ6A0` (98 Brownlow year pages prerendered), service respawned (MainPID 803941),
  health ok locally and publicly; the build header is off on production by configuration
  (`AFLDB_TRACE_REQUESTS` unset) and gated pages need operator browser checks. Evidence §8.8;
  outstanding items §8.9. **Execution stage complete except the next-settle confirmation and close-out.**
- **2026-09-04 (post-build) — verification stage prepared.** No production command run. The operator
  browser checklist (§8.10 A) was derived with its expected values stated in advance — from the tracked
  artefact (`/brownlow` career leaders Ablett Jnr 262 / Dangerfield 259 / Dempsey 246; 2025 Rowell 39;
  1996 Hird and Voss 21) and from the §8.5–§8.7 acceptance figures (Cameron 2604: 277 games, 25 votes) —
  and the read-only post-settle verification script was written as
  `issues/open/AFLDB-ISSUE-137-settle-check.sql` (26-row PASS/CHECK verdict, §8.10 B). The 2026-09-05
  04:31 AEST settle has not yet run, so ISSUE-137 **stays Open**; close-out is gated on §8.10 A and B.
- **2026-09-04 13:01–13:07 AEST — verification stage A executed (browser, read-only).** Signed in at
  `/admin/login` with a temporary **Admin**-role account (password + TOTP) — `/login` is beta-gated,
  and an admin session passes the gate. §8.10 A results: **A1–A7 PASS** (112 winner rows / 98 seasons
  / 1924–2025; leaders 262 / 259 / 246; four triple medallists; 2025 Rowell 39 then 32 / 29 / 27 / 26;
  1996 Hird and Voss 21 with McKernan ineligible; Cameron 2604 = 277 games, 2014–2026, 25 votes with
  the six-season Brownlow section; Graham / Ross / Williams 162 / 112 / 54 running to 2026 with 9 / 0 /
  0 votes; the four retired ids clean 404s; `/players/compare` 277 and 25, and the typeahead offers a
  **single** modern Charlie Cameron). **A8 `/grid-solver` and A9 `/admin/db-health` BLOCKED** — both
  require a super-admin session and the verification account is Admin (`requireAudience` 404s,
  `requireSuperAdmin` redirects); no setting was widened to reach them. **A10 `/sitemap.xml` BLOCKED by
  configuration** — the sitemap surface 404s on any host with `AFLDB_BETA_GATE=on` by design
  (`indexingEnabled()`), so the check is not executable on `beta.afldb.com` at all. **0 FAIL, no stop
  condition.** Evidence §8.12. Stage B (post-settle) still outstanding, so ISSUE-137 stays **Open**.

- **2026-09-04 15:28 AEST — stage B pre-check (read-only, host + database).** Timer next fires
  **Sat 2026-09-05 04:34:59 AEST**; the last settle (batch 739, 04:31 AEST) predates the 12:18 repair
  and `import_batches` still tops out at **742**. The first post-repair scheduled settle has not run,
  so §8.10 B could not be executed and no acceptance assertion was evaluated. No production mutation,
  timer change or scratch-file removal. Evidence §8.13. ISSUE-137 remains **Open** on stage B alone.
