# V2-GAP-029 — match-event labels and 2026 dated membership (2026-11-01)

Status (revision 1; see Revision 2 at the end, which supersedes it where they differ): **61 exact-ID event labels are prepared, evidenced and demonstrated on a guarded disposable clone; the
42 match-event Gridley findings all close there. Eight dated-membership cells cannot be corrected from
evidence because no database holds 2026 matches. Nothing was applied to DEV or PROD.** V2-GAP-029 stays OPEN.

## 1. What was built

| Artefact | Purpose |
|---|---|
| `docs/v2/evidence/gap-029-match-event-correction-2026-11-01.json` (sha256 `dcdc8b206168a977815614bffa643fef23e6821ceb1dd1398ea522d3b643859e`) | 61 entries, each with the exact `matchId`, an identity guard (season, date, round, venue, clubs, final score), the evidence tier, per-family completeness and exclusions, and the capture manifest (27 first-party pages: URL, HTTP status, bytes, sha256) |
| `tools/v2/apply-gap029-match-events.ts` | Isolated-only (guarded launcher, `checkIsolatedTestDsn/Server`). Plan by default; validates all 61 rows (identity unchanged, event NULL or already the intended label) **before** the first write; `--apply` writes each label through the editor's own `saveEdit` (`matches` / `match_event`), so every change has its `data_overrides` replay row and `data_edits` audit row and survives a rebuild |
| `docs/v2/evidence/gap-029-match-event-apply-report-2026-11-01.json` | Apply report from the clone |
| Raw page captures (outside Git) | `D:\tmp\afldb-gap029-source-evidence-20261101\raw\01.html … 27.html`, `fetch-log.txt` (all HTTP 200) |

## 2. The labels

| Series | Rows | Evidence and completeness |
|---|---|---|
| Dreamtime at the 'G | 21 (2005–2025) | AFL.com.au table, Richmond FC and Essendon FC agree; every year listed. 2020 (Marrara, Darwin) and 2021 (Perth Stadium) identified by venue and score. **Complete for 2005–2025** |
| Anzac Day | 30 (1995–2019 = 25; none in 2020; 2021–2025 = 5) | Collingwood FC list 1995–2017 plus reports; Collingwood FC and Essendon FC both state 2020 was not played; 30 = the clubs' own count ("30th Anzac Day game" in 2025). 2021 and 2022 rest on the unique 25 April meeting (2021 agrees with Essendon's "by four goals"); **2023 rests on count closure plus the unique 25 April meeting, its score not captured from a raw page**. Complete for 1995–2025 in the database |
| King's Birthday (Big Freeze) | 10 (2015–2019, 2021–2025) | The criterion is `match_event_played_between {King's Birthday, 2015–2099}`. 2015–2017 naming rests on Melbourne FC's statement that the Big Freeze round has hosted the King's Birthday match since 2015. 2020 not played; 2023-09-07 qualifying final excluded. **INCOMPLETE for earlier years (2001–2014 not established): not needed by the Gridley criterion and deliberately not labelled** |

Not inferred: no label was assigned from a date or a club pair alone; every id was resolved by season, club pair and
the first-party score (or the unique-meeting rule above, which is stated per row in the evidence file). 2026
editions of all three series are not in any database checked.

## 3. Demonstration (guarded clone `afldb_v2_gap029_events_test`, created from `afldb_v2_gap029_test`)

- Plan: 61/61 validated. `--apply`: verified true; 61 `data_edits` rows; 61 active `data_overrides`; labelled
  distribution Anzac Day 30 / Dreamtime at the 'G 21 / King's Birthday 10. Re-run idempotent (still 61).
- Gridley strict-parity corpus (`tests/integration/gridley-corpus.test.ts`, `AFLDB_GRIDLEY_DIAGNOSTIC=1`),
  before → after on the clone:

| | Before (accepted baseline) | After the 61 labels |
|---|---|---|
| Strict findings | 149 | 113 |
| Approved (99 = 78 deferrals + 21 disagreements) | 99 | 99 (unchanged) |
| Unapproved differences | 50 (42 match-event + 8 dated-membership) | **14 = 8 dated-membership (dataset gap) + 6 statement timeouts** |
| `match_event` findings | 42 | **0** |

The six timeouts are `career_teammates_min` cells (boards 1024 and 1026) that returned "canceling statement due to
statement timeout". They did not appear in the baseline and the corpus ran concurrently with other work on the
same workstation; this is a likely load effect but **was not re-run to prove it**. A quiet re-run is the check.

## 4. The 8 dated-membership cells: retained, not corrected

Every checked database (`gap029`, `hist`, `rb_release`, `gap006i`) has maximum match season 2025, no 2026 matches
and no 2026 `player_club_season_stats`. Finnbar Maley (id 4278) and Malcolm Rosas (id 9008) exist with AFL Tables
identities; Willem Duursma and Jagga Smith are not present (only Xavier and Zane Duursma). The cells depend on
2026 matches, participation and registrations, so no small exact-ID update can close them and none was
manufactured (no stable identity was invented; no September roster was substituted for April participation).
They need 2026 canonical match/participation ingestion; `evidence/gap-029-targeted-recovery.json` already lists
the first-party partial affiliation sources. The eight findings remain as the retained "dataset gap" set.

**Caveat found later the same day:** the read-only production census for the Brownlow packages shows production holds 2026 data (read-only probe 2026-11-01: 218 matches 2026-03-05 to 2026-09-26, all afltables-owned; player_club_season_stats up to 2026), so production is ahead of these clones. Whether the eight cells can be closed from production-held 2026 matches and registrations is **not yet checked** (that read was outside this item's authority). A read against a restore of the verified production backup, or an explicit read-only production check, would settle it.

## 5. Owner decisions / actions (none taken)

1. **Approve applying the 61 labels** to a named target through the audited path (`saveEdit`), or decline. The
   isolated tool is deliberately not a DEV/PROD runner; a DEV/PROD application needs its own reviewed entry point,
   target arrangement, backup and approval (no such authority was given).
2. Decide whether the **Anzac Day 2023** row (score not raw-captured) may stand on count closure, or must wait for a
   captured first-party score.
3. Confirm the **King's Birthday 2001–2014** gap is accepted as out of scope for the Gridley criterion.
4. Authorise 2026 ingestion, or accept the 8 dated-membership cells as a retained limitation.
5. Allow a quiet re-run of the corpus to clear the six timeouts.

---

# Revision 2 (2026-11-01, later the same day): production-derived data, 64 labels, quiet reruns

Status of revision 2: **the 8 dated-membership cells are resolved by production-derived data and need no correction; the label set grows to 64 (2026 editions added, Anzac Day 2023 now raw-evidenced); on a restore of the checksum-verified production backup the 64 labels apply, replay and audit correctly and close all 41 event-family findings that exist there; the six statement timeouts did not recur in any quiet run. Nothing was applied to DEV or PROD.** V2-GAP-029 stays OPEN: its other residuals (draft/trade-family dataset gaps on production data, 20 captain known-answer rows, 33 sibling source-coverage gaps) are separate and unchanged. This section supersedes §3-§5 where they differ; §1-§5 are retained unchanged as the first record.

## 6. Production-derived target

No new production dump was taken. The existing workstation copy of the verified post-schema production backup was restored into a fresh guarded disposable database:

| Item | Value |
|---|---|
| Backup | `C:\Users\stuar\backups\afldb\release-v2-20261030T210000Z\afldb_prod-20261031-084435.dump` |
| sha256 | `3f5b5339cee312950c308b494ca98ff29a2f1620d9f60a4d062fbaf37b624730` (re-computed on the workstation and equal to the recorded value; the other dump `…082655` was not used) |
| Restore | `pg_restore --no-owner` with privileges, into `afldb_v2_gap029_prod_test` on the guarded isolated cluster; the only errors were the two expected `COMMENT ON EXTENSION pg_trgm / unaccent` (not extension owner) |
| What it holds | 2026: 218 matches (2026-03-05 to 2026-09-26), 10,028 `player_match_stats` rows, 669 players with 2026 games, 669 `player_club_season_stats` rows; Willem Duursma 13362, Jagga Smith 13290, Finnbar Maley 4278 and Malcolm Rosas 9008 are present |
| Clone with labels | `afldb_v2_gap029_prodev_test`, created `--template` from the pristine restore |

## 7. Labels, revision 2

`docs/v2/evidence/gap-029-match-event-correction-2026-11-01-r2.json` (sha256 `b197f99f3b0ca4ef4f524e6d57f5b5de60b140ff8e3cca02f6c67c4f3b498ea4`); the first file (sha `dcdc8b20…3859e`, 61 entries) is retained unchanged. 64 entries: Anzac Day 31, Dreamtime at the 'G 22, King's Birthday 11.

- **2026 editions, re-evaluated against production data and the corpus cutoff (board dates to 2026-09-01).** The corpus now contains 2026 boards, so the 61 labels ending in 2025 could not be assumed complete. Each 2026 edition was identified in the production-derived `matches` and confirmed by first-party reports: Anzac Day 2026-04-25 Essendon 9.6 (60) v Collingwood 20.17 (137), match id 17247 (afl.com.au 1504213 and essendonfc 2004645, crowd 92,231); Dreamtime 2026-05-22 Richmond 10.14 (74) v Essendon 7.14 (56), id 17076 (afl.com.au 1523923, richmondfc 2029375, crowd 78,815); King's Birthday 2026-06-08 Melbourne 12.11 (83) v Collingwood 11.9 (75), id 17097 (afl.com.au 1536297, collingwoodfc 2042779, melbournefc 2042914, "Big Freeze 12", crowd 88,019). Raw pages are outside Git under `D:\tmp\afldb-gap029-source-evidence-20261101\raw2\` (pages 28-40, `fetch-log-2.txt`).
- **Anzac Day 2023 is now raw-evidenced** (the owner did not approve count closure alone): AFL.com.au match page 4837 gives Collingwood 13.12 (90) d Essendon 11.11 (77), id 16244.
- **Big Freeze closure:** the edition count "Big Freeze 12" in 2026 equals 2014-2019 (6) plus 2021-2026 (6, no 2020), so the 2015-2026 King's Birthday labels (excluding 2020, not played) are complete for the `match_event_played_between {King's Birthday, 2015-2099}` criterion. **King's Birthday 2001-2014 is outside that specific criterion only and is NOT extended to general King's/Queen's Birthday history; the wider family is not claimed complete.**

## 8. Isolated results

| Check | Result |
|---|---|
| Plan | 64/64 validated before the first write (identity unchanged; event NULL or already intended) |
| Apply on `afldb_v2_gap029_prodev_test` | verified true; 64 `data_edits` rows; 64 active `data_overrides`; labelled Anzac 31 / Dreamtime 22 / King's Birthday 11 |
| Idempotence | re-run changes nothing (still 64 and 64) |
| Report | `docs/v2/evidence/gap-029-match-event-apply-report-2026-11-01-r2.json` |

Gridley strict-parity corpus (`AFLDB_GRIDLEY_DIAGNOSTIC=1`), production-derived data, same corpus run on both clones:

| | Pristine restore | + 64 labels |
|---|---|---|
| Strict findings | 474 | 433 |
| Approved (78 deferrals + 21 disagreements) | 99 | 99 |
| Unapproved differences | 375 | 334 |
| Event-family dataset gaps (`anzac-*`, `dreamtime-*`, `bigfreeze-*`) | 41 | **0** |
| Remaining unapproved | 281 draft/trade-family dataset gaps (`pick1`, `picktop5/10`, `pickrookie`, `traded1`, `freeagent1`), 20 captain known-answer rows (Gridley 1350 and 6788 "missing from captain"), 33 sibling source-coverage gaps | identical |

The remaining 334 are identical in the pristine and the labelled run, so none is caused or changed by the labels. The 281 draft/trade-family cells are marked as dataset gaps by the corpus's own gap probe on this database; they are not gaps in the accepted `149/99/50` baseline, which was measured on `afldb_test`. Why this database trips the probe (for example, linked draft evidence that `afldb_test` carries and the production dump does not) was **not investigated here**, and neither were the 20 captain and 33 sibling rows, which are likewise present in both runs. They are listed so the production-derived number is not mistaken for a regression of the accepted baseline, which is unchanged.

## 9. The six statement timeouts

Reran quietly, sequentially, with the existing budgets (no timeout was increased):

| Run | Database | Timeouts |
|---|---|---|
| Control, no `ANALYZE` | `afldb_v2_gap029_events_test` (61 labels, no 2026 data) | 0 |
| After `ANALYZE` | same | 0 |
| First run after cloning | `afldb_v2_gap029_prodev_test` (never analysed) | 8 (boards 561, 640, 931; `career_teammates_min`) |
| Rerun after `ANALYZE` | same | 0 |

Classification, from the evidence only: **not reproduced when quiet.** The original six (boards 1024, 1026) did not recur in three quiet runs. A different eight appeared once on a freshly cloned, never-analysed production-derived database and did not recur after `ANALYZE`; the control run on a never-analysed database had none, so absent statistics alone is not shown to cause them. The cause (cold cache, absent planner statistics, or load) is **not established** and is not claimed. Operational note: run `ANALYZE` after restoring or cloning before a corpus run.

## 10. The 8 dated-membership cells

Boards 990 (2026-04-01), 992 (04-03), 1000 (04-11) and 1035 (05-16) contain `teammate_of` rows for four 2026 players. With production-derived data present they are no longer dataset gaps: **none of the eight cells is an unapproved difference** in either production-derived run. Their only findings are the existing `time of board` and `list membership` classifications.

Dated membership was then derived independently of the product query, strictly from qualifying senior participation (`player_match_stats` joined to `matches`) with `match_date` before the board date (and, as a sensitivity, through it), never from season totals, rosters, names alone or later participation (`node_modules/.cache/gap029/dated.mjs`, read-only; output retained at `D:\tmp\gap029-dated-membership.json`). Result, over the Gridley players who can be bridged to an AFLDB id by the teammate-criterion references plus the four stated overrides (387 of the corpus):

| Cell | Gridley lists | Gridley bridged | Dated set (before date / through date) | Dated-only (AFLDB lists, Gridley omits) | Gridley-only, bridged |
|---|---|---|---|---|---|
| 990 1-0 (WC) | 48 | 10 | 26 / 26 | 0 | 2 |
| 990 1-1 (goals < 20) | 35 | 3 | 18 / 18 | 0 | 1 |
| 990 1-2 (2020s) | 48 | 10 | 26 / 26 | 0 | 2 |
| 992 1-0 (CA) | 54 | 19 | 27 / 31 | 0 | 9 |
| 992 1-1 (25+ disposals) | 22 | 14 | 13 / 15 | 0 | 8 |
| 992 1-2 (no finals) | 22 | 1 | 8 / 9 | 0 | 1 |
| 1000 1-0 (SY) | 43 | 12 | 24 / 26 | 0 | 3 |
| 1035 1-0 (AD) | 43 | 14 | 30 / 30 | 0 | 3 |

Every Gridley-only bridged player falls in one of three groups, each established from data rather than assumed: (a) **no 2026 senior game at all** (Orazio Fantasia, Sam Docherty on board 992; Taylor Adams on 1000; Hugh Greenwood on 1035) - list-only players, not derivable from senior participation; (b) **first qualifying game after the board date** (Brandon Starcevich 2026-06-06 and Matthew Owies 04-04 on 990; Blake Acres, Nick Haynes on 992; Hayden McLean, Peter Ladhams on 1000; Mark Keane on 1035) - future participation, which is excluded by rule; (c) **played before the board date but in no 2026 match with the named player at all** (Charlie Curnow, Jack Silvagni, Tom De Koning on 992; Callum Ah Chee on 1035) - no shared senior match exists in the data, before or after the date. Two more (Adam Cerra, Nic Newman on 992) played their first game on the board date itself; whether Gridley's key includes the day is not knowable from the data, so they are not adjudicated. The dated-only column is **0** in every cell: nothing the strict derivation produces is absent from Gridley's key.

Conclusion: no exact, evidenced correction exists. Gridley counts list co-members; AFLDB counts senior participation. This is the same teammates semantic contract already adjudicated for `career_teammates_min` (D4/D5), here applied to `teammate_of`; the differences are classified, not defects, and no data was changed for them.

## 11. Reviewed production proposal (nothing executed)

Scope: set `matches.match_event` on 64 production rows through the audited path. No DEV or PROD application is authorised by this record.

1. **Entry point.** `tools/v2/apply-gap029-match-events.ts` is deliberately isolated-only (it refuses any non-guarded target) and must stay so. A production run needs a separately reviewed entry point that (a) refuses unless the target is the named production database, (b) runs the same pre-write identity validation of all 64 rows, (c) writes each label with `saveEdit` (so each has a `data_overrides` replay row and a `data_edits` audit row), and (d) supports plan-only. Writing and reviewing that entry point is the first step; it is not built here.
2. **Read-only precheck on PROD (owner or authorised session):** for the 64 `matchId` values in the r2 file, `SELECT id, season, match_date, round_code, venue_id, home_club_id, away_club_id, home_score, away_score, match_event FROM matches WHERE id = ANY(<64 ids>)` must return 64 rows, every identity column equal to the evidence entry and `match_event` NULL (or already the intended label). Any difference stops the run.
3. **Backup first**, the standard pre-change backup, verified, before step 4.
4. **Apply** in one window using the reviewed entry point; expected: 64 `data_edits`, 64 active `data_overrides`, labelled 31 / 22 / 11.
5. **Verify:** `SELECT match_event, count(*) FROM matches WHERE match_event IN ('Anzac Day','Dreamtime at the ''G','King''s Birthday') GROUP BY 1` returns 31 / 22 / 11 (the exact labels are in the evidence file); a rebuild/replay check that the 64 `data_overrides` rows replay (as exercised on the clone); search/grid pages that use `match_event` need ISR invalidation or an ISR wait.
6. **Rollback:** the labels are replay overrides; reversal is `saveEdit` setting `match_event` back to NULL (or removal of the 64 override rows through the same audited path), then the corpus event-family findings return to their prior count of 41. Restoring the backup is the fallback.
7. **Re-evaluation trigger:** the 64 labels are complete for 1995-2026 (Anzac), 2005-2026 (Dreamtime) and 2014/2015-2026 (King's Birthday, Big Freeze criterion only). The 2027 editions and any production match inserted after 2026-09-26 need a new evidence file; this proposal does not cover them.

Owner decisions: approve the production entry-point work and the window; or leave the labels as an evidenced, unapplied proposal (the corpus event-family findings then remain at 41 on production data).
