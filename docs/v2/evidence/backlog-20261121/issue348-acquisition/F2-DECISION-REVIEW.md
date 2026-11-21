# ISSUE-348 F-2: decision-ready review of the DraftGuru reload's undeclared changes (NOT EXECUTED)

**Status.** Review for owner approval. **Nothing was executed against any database; no production contact.** The load itself is a
separate approval and is not in the Tuesday sitting. The sealed plan is not changed by this review (no re-seal, no rehearsal).
`cli.js new-file` could not run (no Node on the workstation); this file was created with the editor.

**F-1 (accepted by the owner):** per-label pin `reviewed_acquisitions["annual-html-20261122"]` (6,845 picks / 5,088 persons);
the August default rebuild (6,810 / 5,057) is preserved.

**Sources.** `SEALED-PLAN.md` §1-§2; `sealed/logs/{characterise,compare,state-*}.json`, `sealed/expected-{pre,post}.txt`,
`sealed/draftguru-surface-digest.sql`; `sealed/guard-report-annual-html-20261122.json`; code at the sealed tool blobs
(`tools/rebuild/draftguru/import_draftguru.py`, `parse_draft_snapshot.py`, `reload_guard.py`, `tools/migration/common.py`).
**Re-derivation (this review):** read-only Python (`-I`, aggregates only) on streamanator over the private row dumps
`ev-private/rows-{pre,reh1,reh2}/*.json` of workspace `/mnt/ssd/afldb-backlog-20261122b-348` (its stopped cluster was NOT
started) and its parsed snapshot `co/data/sources/draftguru/annual-html-20261122/parsed/rows.jsonl`; the August parsed rows
(`annual-html-20260826`, sha256 `06936baca3b37133949847e7589008a06be76bbc8f1fb5b4d2fef8b743838a64`, from the workstation checkout)
were compared read-only. Check: stored `draft_age`/`height_cm` in the R0 state equal `leading_int()` of the August parsed rows for
6,810/6,810 non-audited picks, and stored person games/goals equal their max for 5,057/5,057, so the August file is the source R0 was loaded from.

**Headline.** Every count below agrees between **pre to reh1** and **pre to reh2** (same id sets, same after-values; the two
restores are identical apart from batch ids and new identity-row ids). Every undeclared change is explained by the 2026-11-21
source differing from the 2026-08-26 source, or by importer rules the other 5,057 persons already follow. **No `dg_person_id` <->
`player_id` link, link status or match method changes in either direction** (§2, linkage block). No finding above LOW.

## 1. How the load writes (applies to every group)

`run_import` (`import_draftguru.py:1472-1603`) upserts persons by `(source_id, player_url)` (`PERSON_KEY` :176) and picks by
`(source_id, player_url, draft_year, draft_kind)` (`PICK_KEY` :183) through `reload_keyed` (`tools/migration/common.py:421`), whose
UPDATE assigns **every** non-key column of every matched row (`common.py:670, 687`); only value differences are changes. Links are
recomputed from scratch by `apply_authority` (`import_draftguru.py:755-872`) keyed on `player_url` (tracked ledger, live
`player_link_resolutions` decisions via `draft_persons.player_url` :649-688, the pinned bridge child). `player_link_resolutions` has 0
rows in R0 (`state-pre.json`), so the result is ledger plus bridge only. Pick link columns are copied from the person (:1536-1538).
`replay_admin_overrides(draft_picks)` (:1583, `common.py:2050-2217`) re-applies active overrides after the write, so an overridden
column is restored; the rehearsed after-state already includes that.

## 2. Change groups

Notation: counts are **reh1 = reh2** unless stated. "Linked" means `player_id` not NULL.

### (a) `draft_persons.name_key`, 31 rows (undeclared in R-5; guard-visible and acknowledged in the reconciliation)
- **Rows:** the 31 persons with ids 5058-5088, all inserted by D-336-2, one audited pick each. 31 / 31; id sets equal.
- **Code:** `draftguru_name_key` (`import_draftguru.py:255-266`, frozen G6 rule) -> `build_persons` :530 -> `PERSON_COLUMNS` :178 -> :1509-1522.
- **Why (importer behaviour, not a source fact):** the D-336-2 tool (`tools/v2/issue336-predraft-insert-production.ts:396`) stored an
  alphanumeric-only key. Verified: stored key == `re.sub('[^0-9a-z]','',after)` for 31/31; after == G6(`display_name_raw`) for
  5,088/5,088 (R0: 5,057/5,057 of the other persons already carry G6). `display_name_raw` is unchanged.
- **Identity linkage:** none. `name_key` is read by no `src/` query (only the non-unique index `ix_draft_persons_name`,
  migration 019:89); the importer does not match on it. Side effect (INFO): person 5076 (`ben_miller/4`, unmatched) goes
  `benmiller` -> `ben miller`, equal to linked person 483 (`ben_miller/1`); duplicate-key groups 54 -> 55. Not used for matching.

### (b) `draft_picks.source_record_id`, 1,472 rows (undeclared)
- **Rows:** 1,472 picks, all with the **same URL**, only `#row_index` moves; years 2008 147, 2009 170, 2010 179, 2011 159, 2012 115,
  2013 110, 2014 129, 2015 128, 2017 115, 2021 113, 2025 107.
- **Code:** `parse_draft_snapshot.py:454-455, 488` (`source_url`, `row_index`) -> `import_draftguru.py:598` -> `PICK_COLUMNS` :191.
- **Why (source order):** the fresh pages carry 35 more rows (the 35 D-336-2 picks: new-only keys = exactly those 35). For all
  6,810 August rows the shift `new row_index - old row_index` equals the number of new-only rows above them on the same page
  (6,810/6,810, 0 unexplained; shifts 0..5 and 11). The 35 audited picks already stored the **new** coordinates, so in R0 **35
  `source_record_id` values are shared by two picks** (35 duplicates); after the load there are **0 duplicates**. The load repairs a
  pre-existing collision.
- **Identity linkage:** none. It is a provenance pointer, not a key: the reload key is `PICK_KEY`; admin overrides key on
  `source_id|player_url|year|kind` (`common.py:2215`); `src/` writes it only for admin-created picks (`admin-draft.ts:962, 1441`).

### (c) `draft_picks.draft_age`, 101 rows, each -1 (undeclared)
- **Rows:** 101 picks (82 linked), spread over 36 draft years 1981-2024; all non-NULL to non-NULL; 0 among the 35 audited.
- **Code:** `parse_draft_snapshot.py:469` (`age_raw`) -> `import_draftguru.py:592` (`leading_int`) -> :1541.
- **Why (source fact):** the `Age` cell differs between the August and November pages for **exactly these 101 rows** (all old=N,
  new=N-1; e.g. pick 2300, 1997: `19yr` -> `18yr`). After-value == `leading_int(new age_raw)` for 6,845/6,845. The page does not say
  why (DOB correction vs basis); not independently verified.
- **Identity linkage:** none. Display only: `draft.ts:277` (player draft history) and Advanced Search column `draft_age`
  (`query-builder-spec.ts:412`), so a filter on draft age can return different rows for these players.

### (d) `draft_picks.height_cm`, 8 rows (undeclared). Full table in §3.
- **Code:** `parse_draft_snapshot.py:470` (`height_raw`) -> `import_draftguru.py:593` -> :1541. 6 NULL -> value, 2 value -> value
  (+19 cm, +17 cm). All 8 are unlinked rookie picks, 1996-1999. Source fact: the `Height` cell differs on exactly these 8 rows.

### (e) `reported_games` / `reported_goals` on picks and persons (undeclared)
- **Rows:** picks games 362 (327 increases, 35 NULL -> value), goals 178 (143 increases, 35 NULL -> value). Persons games 270 (239
  increases, 31 NULL -> 0), goals 138 (107 increases, 31 NULL -> 0). 0 decreases. Pick value == person value for 6,845/6,845.
- **Code:** parser `parity_only.games/goals` (`parse_draft_snapshot.py:477-484`) -> person max over their rows
  (`import_draftguru.py:574-579`) -> persons :1514, picks :1549.
- **Why (source fact):** all 239 / 107 increases are persons whose page figure grew between 2026-08-26 and 2026-11-21 (career totals).
  The 35 / 31 NULLs are the D-336-2 inserts, which stored no figures; the November page cell is an **explicit `0`** for 33 of the 35 rows
  (and 5, 13 for two), never blank, so this is a recorded value, not a coercion of "not recorded".
- **Identity linkage:** no stored link. All 239 / 107 value-to-value persons are linked; the 31 NULL -> 0 persons are the unlinked
  ones, `is_matching_backlog` stays false for all 31 (0 changes). Indirect (INFO): the admin candidate scorer uses reported figures
  as a positive-only signal (`src/lib/player-matching/score-candidate.ts:368-394, 527-528`; NULL gives no signal, 0 can now
  score), so suggestion scores in `/admin/player-links` for those 31 may change. Suggestions never write links; I did not trace
  any bulk-accept path (none found by keyword search in `player-matching` / `player-links`).

### (f) `dg_person_id`: picks 6,676, persons 4,967 (declared as "renumbering")
- **Code:** `build_persons` :528 (`len(persons)+1` over `player_url` byte order) -> :1512 (SET CONSTRAINTS DEFERRED :1506); picks
  copy the person's rank :1548.
- **Why:** it is a **per-load rank**. After the load `dg_person_id` == 1-based rank by `player_url` bytes for 5,088/5,088; R0 held that
  rank over the 5,057 plus ranks 5,058-5,088 for the 31. Each of the other 5,057 persons moves by exactly the number of new
  persons sorting before its URL (5,057/5,057); 121 unchanged. Pick rank == its person's rank, before and after (6,845/6,845).
- **Does anything link on it? No.** Persons/picks are keyed on `player_url` (:176, :183); decisions, ledger and bridge key on
  `player_url`; `external_identities.external_id` = `player_url`; `player_link_resolutions.target_id` = `draft_picks.id`, and
  pick and person row ids are identical across the three states (0 `draft_person_id` or `id` changes). `src/` and the linkage SQL
  (`afldb_test_draft_linkage_checks.sql`) never reference it. Other uses: `reload_guard.py:28, 75` (a reviewed person fact),
  `bridge_import_gate.py:260, 926-927, 1278` (link-only check 6.5 "not permuted", already refused on production, R-6), tests, one-off
  tools. `tools/migration/import_awards.py:522-655, 2585-2594` uses a different `dg_person_id` (legacy SQLite `person_links`).

### (g) `confidence_notes`: picks 35, persons 31 (declared)
- **Rows:** persons 31: I336 marker -> NULL. Picks 35: 33 marker -> NULL; 2 marker -> the person's existing bridge note (persons 2753,
  1875; their `player_id` is unchanged). After the load pick note == person note for 6,845/6,845; no I336 marker remains.
- **Linkage:** this column is link-adjacent (`PICK_LINK_COLUMNS` :210) but **not** in the sealed link digest, so I checked it
  separately: only provenance text changes, not `player_id`, `link_status`, `match_method`. Future-guard effect: the guard's primary
  signal for the 35 is `data_edits` (`reload_guard.py:225-227, 282-286`); the report shows both `data_edits` and `audited_insert`;
  `data_edits` is untouched, so the 35 stay protected without the marker.

### (h) `competition` NULL -> `AFL`, 35 picks (ids 6819-6853; declared)
- **Code:** `build_competition_resolver` :287-299 -> :594. D-336-2 stored NULL; the importer derives it from
  `data/reference/seasons.json` league eras for every DraftGuru pick. Guard-reviewed (35 protected rewrites). No link impact.

### (i) `original_club_raw`, 191 picks (declared; guard-reviewed)
- 188 value -> value, 3 NULL -> value (ids 378, 635, 859). Classes: 174 INSERT_SCHOOL, 11 INSERT_CLUB, 3 RENAME_EXPAND, 3 REPLACE_CLUB
  (5961, 6784, 6626: incoming bytes equal the owner CSV cell; ruled in the reconciliation). 187 are D-336-3 classifier rows, 4 are
  outside its range (233, 378, 635, 859). 152 of the 191 are linked picks; no link impact. Code: parser :471 -> importer :591.

### (j) `external_identities(draftguru)` (declared)
- **+31 inserts** (the 31 persons): all `status='unmatched'`, `player_id` NULL, `match_method` NULL, notes `stage_a_snapshot=annual-html-20261122`
  (`reconcile_draftguru_identities` :875-912). **notes relabel on all 5,057** existing rows (`...20260826` -> `...20261122`);
  existing `player_id`/`status`/`match_method`/`candidate_count` unchanged 5,057/5,057. The `link_idents` digest changes only
  because of the +31 rows (pre set is an exact subset of the after set). The new rows use fresh identity ids (non-deterministic).
- **Side effect (R-6):** `--link-only` and the GAP-029 link path read this note; they already refuse on production.

### (k) `import_batch_id` on 6,845 picks (declared) and 1 `import_batches` row (`completed`, declared)
- R0 picks carry 2 distinct batch ids; after the load 1. `draft_persons` has no `import_batch_id` column in `PERSON_COLUMNS`.

### Identity-linkage verdict (both directions, reh1 and reh2)
| Check (pre vs after) | Result |
|---|---|
| `link-picks.json` and `link-persons.json` (url / pick key, player_id, status, method) | byte-equal pre = reh1 = reh2 (parsed lists equal) |
| pick -> player map (6,845 rows); linked picks | identical; 5,215 = 5,215 |
| person (by url) -> player map (5,088 rows); linked persons | identical; 3,564 = 3,564 |
| reverse player -> persons, player -> picks | identical; no player has >1 DG person |
| picks: `player_id`, `link_status_value`, `match_method`, `candidate_count`, `draft_person_id`, key columns | 0 changes of 6,845 |
| persons: `player_id`, `link_status`, `match_method`, `candidate_count`, `is_matching_backlog` | 0 changes of 5,088 |
| identities existing: `player_id`, `status`, `match_method`, `candidate_count`, name, url | 0 changes of 5,057; +31 unmatched/NULL |
| pick.player_id == person.player_id == identity.player_id after | 6,845/6,845 and 5,088/5,088 |

## 3. The eight `height_cm` changes (all unlinked, 1996-1999 rookie picks; none feeds `players`)

Source: acquisition page `https://www.draftguru.com.au/years/<year>` (raw `raw/years/year_<year>.html`), table column **Height**; parsed
field `height_raw` in `parsed/rows.jsonl`. After = `leading_int(height_raw)`. Linked = no (`link_status` unmatched; pick and person
`player_id` NULL, so no `players.id`); "person" below is `draft_persons.id` (R0 `dg_person_id` equals it).

| Pick id | Year | Person id / URL slug | Player | Before | After | Source row (Nov page: column Height) | Aug page cell |
|---|---|---|---|---|---|---|---|
| 2110 | 1996 | 4867 `trent_simpson/1` | Trent Simpson | NULL | 183 | `years/1996#220` `183cm` | blank |
| 2114 | 1996 | 4699 `todd_nener/1` | Todd Nener | NULL | 191 | `years/1996#224` `191cm` | blank |
| 2300 | 1997 | 1652 `frankie_dimattina/1` | Frankie Dimattina | NULL | 175 | `years/1997#175` `175cm` | blank |
| 2445 | 1998 | 4632 `tim_masierowski/1` | Tim Masierowski | 176 | 195 | `years/1998#140` `195cm` | `176cm` |
| 2456 | 1998 | 1538 `don_webb/1` | Don Webb | 183 | 200 | `years/1998#151` `200cm` | `183cm` |
| 2465 | 1998 | 2339 `jeremy_jacques/1` | Jeremy Jacques | NULL | 194 | `years/1998#160` `194cm` | blank |
| 2608 | 1999 | 3342 `matthieu_lucas/1` | Matthieu Lucas | NULL | 183 | `years/1999#138` `183cm` | blank |
| 2640 | 1999 | 1158 `dale_walkingshaw/1` | Dale Walkingshaw | NULL | 178 | `years/1999#170` `178cm` | blank |

reh2 after-values equal reh1 for all eight. Each is that person's only pick. Page hashes (Nov, in `raw-pages.sha256`): 1996
`eb3caddf94d17c046d986420f5d92028bb4508154cc54d65dfa773670ecb3d63`, 1997 `dabf40706dc3e6ababa5a5a6444a9222e19e009206964fe5c04e5f3082dfcadd`,
1998 `4d783e437ec30929a718f349410c40dea98884da75a4548fb6a4f8b02b3f13b2`, 1999 `a2e9e08ab4af40bd4fc553cc20eb2af64afa956129200816f96d7019380004ed`.
**Does the pick height feed `players.height_cm`?** No. Nothing in `src/` or the importer copies `draft_picks.height_cm` to `players`
(the only writers of `players.height_cm` are `data-edits.ts:411-412`, `createPlayerInTransaction` `players.ts:415-485`, and the player
override replay `common.py:1832`); Grid Solver and Advanced Search read `p.height_cm` (`grid-solver.ts:1555-1559`,
`query-builder-spec.ts:149`); `seed_player` sets no height (:704). The pick height is shown only on the draft pages and admin editor
(`draft.ts:276`, `admin-draft.ts:322`). `players` is untouched by the load (digest-equal). **Not verified:** the +19/+17 cm
value-to-value jumps (Masierowski, Webb) against any independent source; they are what the November page says.

## 4. Final write set (the whole load; `UPDATE` touches every DraftGuru row, only these values change)

| Table | Column | Rows changed | R-5 declared? |
|---|---|---|---|
| `draft_picks` (6,845) | inserted / deleted | 0 / 0 | yes |
| | `competition` NULL -> AFL | 35 updated | yes |
| | `confidence_notes` | 35 updated | yes |
| | `dg_person_id` | 6,676 updated | yes ("renumbering") |
| | `original_club_raw` | 191 updated | yes |
| | `import_batch_id` | 6,845 updated | yes |
| | `source_record_id` | 1,472 updated | **no** |
| | `reported_games` | 362 updated (35 NULL -> value) | **no** |
| | `reported_goals` | 178 updated (35 NULL -> value) | **no** |
| | `draft_age` | 101 updated (-1 each) | **no** |
| | `height_cm` | 8 updated (6 NULL -> value) | **no** |
| | all other columns (`player_id`, `link_status_value`, `match_method`, `candidate_count`, `club_*`, `weight_kg`, `grade`, `signing*`, `detail`, `pick_*`, `draft_person_id`, ...) | 0 | n/a |
| `draft_persons` (5,088) | inserted / deleted | 0 / 0 | yes |
| | `confidence_notes` | 31 updated | yes |
| | `dg_person_id` | 4,967 updated | yes ("renumbering") |
| | `name_key` | 31 updated | **no** (guard-visible, in the reconciliation) |
| | `reported_games` | 270 updated (31 NULL -> 0) | **no** |
| | `reported_goals` | 138 updated (31 NULL -> 0) | **no** |
| | all other columns incl. `player_id`, `link_status`, `match_method`, `is_matching_backlog` | 0 | n/a |
| `external_identities` (draftguru) | inserted (unmatched, player_id NULL) | 31 | yes |
| | `notes` relabel | 5,057 updated | yes |
| | `player_id`, `status`, `match_method`; deleted | 0; 0 | n/a |
| `import_batches` | inserted (`completed`) | 1 | yes |
| (planner statistics) | `ANALYZE` on the three tables | no data | n/a |

**Untouched (digest-equal in reh1 and reh2, `state-*.json`, `compare.json`):** `players` (13,365), `data_edits` (206),
`data_overrides` (165), `player_link_resolutions` (0), `matches`, `player_match_stats`, the 8 non-DraftGuru picks (source_id 2).
Counts after: `draft_picks` 6,845 DraftGuru + 8 = 6,853; `draft_persons` 5,088; `import_batches` 93 -> 94.

## 5. Plan digest (unchanged; copied from `SEALED-PLAN.md` §1)

This review changes nothing in the plan. Recomputed locally and equal: manifest, guard report, reconciliation, SHA256SUMS, runner, digest SQL.

| Item | sha256 |
|---|---|
| Stage A manifest `annual-html-20261122.json` | `26ca190b3f0f9c7120c506289319b75118a79305c55767f9db7540d6ef22a27c` |
| Reload-guard effect digest | `ff8ef1b8ef900d9ab5b17c89b2f0f85d5b3091e9493456a45b2a5f67cf766452` |
| Reconciliation | `cf49f6a5671155c174d60497372fbf9c1fd15fce01bd9f0d3f3dab8619e0de4e` |
| Guard report | `91d1da0e9f394f26df513df8e8f03835b93623867bc1cd995fa0a719754150a4` |
| Transfer archive `i348-transfer.tar` | `478d4f809204f329251e9f58d03f1ab8a7491cb51f710c90a5b27f51aea77afb` |
| `i348-transfer.SHA256SUMS` | `632aefe9024253acd86e967d9285f3f81656788cc20bdbc5a893d3d3de951326` |
| Runner `i348-load.sh` | `61f44acb10cd63bbc7465e56289759b3a8bddd49713228ebc358683c10429c0d` |
| Digest SQL `draftguru-surface-digest.sql` | `ae742dcc1cae5f5429e1e8c6a022b27c960ab1f89761f2d90b7456d9746e1dd0` |

Status: **unchanged.** No column needs to be excluded from the write set on the evidence above; no PROPOSAL to change the plan.
Owner-visible choices, if any: accept the 8 heights and 101 ages as the November source states them, or hold the load.

## 6. Not verified / limits

- Source reasons for the 101 age and 8 height changes (the page shows the change, not the cause); no independent source consulted.
- `data_edits` rows for the 35 picks and the identity of the August parsed file were checked by effect (guard report reasons;
  stored values equal its parse), not by reading the database; the rehearsal clusters were not started.
- Admin-scorer effect (e) is by code reading; no bulk-accept path was traced beyond a keyword search.
- `updated_at`/`created_at` bookkeeping is excluded from the sealed digest and absent from the row dumps.

## 7. Owner decision (fill in)

> I approve the F-2 re-baseline groups ______ (a name_key, b source_record_id, c draft_age, d height_cm, e reported games/goals,
> f dg_person_id, g confidence_notes, h competition, i original_club_raw, j identities, k batch ids) and the sealed plan digests
> in §5 (manifest `26ca190b...`, effect `ff8ef1b8...`, reconciliation `cf49f6a5...`, transfer tar `478d4f80...`, SHA256SUMS `632aefe9...`,
> runner `61f44acb...`, digest SQL `ae742dcc...`) for a separate attended load on ____________ . Groups excluded or held: ______ .
>
> Signed: ____________  Date: ____________
