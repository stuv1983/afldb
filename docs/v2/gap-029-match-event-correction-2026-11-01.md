# V2-GAP-029 — match-event labels and 2026 dated membership (2026-11-01)

Status: **61 exact-ID event labels are prepared, evidenced and demonstrated on a guarded disposable clone; the
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

## 5. Owner decisions / actions (none taken)

1. **Approve applying the 61 labels** to a named target through the audited path (`saveEdit`), or decline. The
   isolated tool is deliberately not a DEV/PROD runner; a DEV/PROD application needs its own reviewed entry point,
   target arrangement, backup and approval (no such authority was given).
2. Decide whether the **Anzac Day 2023** row (score not raw-captured) may stand on count closure, or must wait for a
   captured first-party score.
3. Confirm the **King's Birthday 2001–2014** gap is accepted as out of scope for the Gridley criterion.
4. Authorise 2026 ingestion, or accept the 8 dated-membership cells as a retained limitation.
5. Allow a quiet re-run of the corpus to clear the six timeouts.
