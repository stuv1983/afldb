# AFLDB-ISSUE-225 — investigation runbook: 37 pre-existing `incorrect known answer` Gridley cells on non-draft criteria

**Status: RESOLVED 2026-10-02.** Every §21 closure criterion is met (§24.11). Implementation `4c0dfb39`
is merged to `main`. On DEV, V5 and V4 passed (§24.10), and the V5 page smoke passed 6/6 after a stale
page-cache diagnosis and a narrow club-page revalidation (§24.11). PROD is out of scope; it needs its own
promotion decision (§18.4). This runbook moved to `issues/closed/` with its four companions.

**Earlier status (kept as written):** **Pass 4 (2026-10-01): S1+S2 implemented as one slice under operator decisions D1–D9
(§24), uncommitted. Pass 5 (2026-10-01) implemented the operator's D10 and D11 decisions (§23, §24.4,
§24.7). Final operator validation (§24.9): DB-free focused tests 144/144, typecheck PASS, ISSUE-225 lint
delta 0 (full-repository lint FAILS on the pre-existing baseline, not on ISSUE-225). V2 (`afldb_test`
captaincies reload) and V3 (`afldb_test` diagnostic corpus, horizon 2025) are accepted PASS (§24.8).
Committed and merged to `main` as `4c0dfb39`. DEV phase (2026-10-02, operator-run, §24.10): V5 DEV
captaincies reload PASS and V4 read-only DEV acceptance probe PASS. No ISSUE-225 database validation step
remains. Next: confirm the §21 V5 page smoke, then closure (§24.10).** Pass 3 (2026-10-01): E3 and E4 recorded (§14, §15); final 37-cell
classification (§16); implementation design for S1 (captaincies) and S2 (Gridley adjudication) (§17–§22);
operator decisions (§23). Worktree `D:\dev\afldb-issue-225`, branch `sonnet/issue-225`, base `30b36ef0`. Pass 1
(§1–§10) and pass 2 (§11–§13) are kept as written. Where pass 3 refines them, §16 governs classification and
§17–§23 govern the slices (they supersede the §10 slice numbering). §24 records what was built and where it
departs from §16–§21.

**Evidence ids (renumbered in pass 2):** E1 = Gridley key probe (done). E2 = `afldb_test` SQL (done).
**E3 = `afldb_dev` horizon SQL** (new, §7). **E4 = independent public sources** (called E3 in pass 1, §13).

**Authority:** `issues.md` § AFLDB-ISSUE-225 is the ledger. This file is the investigation runbook and the
contract for the evidence pass. Nothing here implements a fix.

**Boundaries for every pass under this runbook until an implementation slice is approved:**

- no production code, query, test-assertion or classifier change;
- no database write of any kind: `afldb_test` is read under `BEGIN … READ ONLY` only, through
  `AFLDB-ISSUE-225-evidence.sql`. `afldb_dev` is read the same way, only through
  `AFLDB-ISSUE-225-e3-dev-horizon.sql` (pass 2). PROD is not touched;
- no change to `data/awards/captaincies.csv` or any other canonical CSV, and no `CHANGELOG.md` entry;
- no migration, data correction, import, rebuild or deployment;
- no blanket exception and no player-id special case. The suite's assertions are not weakened;
- shell, Git, SQL and network commands are operator-run (CLAUDE.md §9, §12).

---

## 1. Sources inspected (pass 1, native read/search only)

| Source | What it supplied |
|---|---|
| `issues.md` § AFLDB-ISSUE-225; `IssuesIndex.md` | Ledger record, cell table, constraint, next action |
| `issues/closed/AFLDB-ISSUE-222.md` §11.19.12, §11.19.14 | D3 origin; the 37-cell cross-check against the 2026-09-19 report |
| `issues/closed/AFLDB-ISSUE-118.md` §22.6, §23.21, Z.7 | Closure categories at 0; teammates eligible counts; captaincies Family B source |
| `D:\backups\afldb\issue-222\gridley-corpus-20260919-d1-d2.json` (sha256 `659e29ed…`, per §11.19.14) | The 37 cell records, read via a `"category": "incorrect known answer"` search only |
| `tests/fixtures/gridley/corpus.json` | Board dates and criterion text for boards 908–1140 |
| `tests/integration/gridley-corpus.test.ts` (bridge, fairness test, classification arms) | Why these cells score as they do |
| `src/search/gridley-compat.ts` | Criterion → builder mapping |
| `src/db/queries/grid-solver.ts` `compileAxis` | The five builders' SQL |
| `src/db/migrations/005, 007, 015, 017, 096` | `captaincies`, `player_clubs`, `player_career_stats`, `player_club_season_stats`, lineage, `season_list_members` |
| `data/awards/captaincies.csv`, `tools/migration/captaincies.py` (header) | Canonical captaincy source content and its loader contract |

`tests/fixtures/gridley/corpus-answers.json.gz` (the answer key) is gzipped and was **not** read; E1 below reads it.

## 2. The 37 cells (recovered verbatim from the 2026-09-19 report; reconciles cell-for-cell with the ledger)

Every record is "Gridley lists, AFLDB omits", and the lacking axis is always the ISSUE-225 criterion (the
report's `missing from <criterion>`), never the other axis. Gridley id = afldb id refers to the `afldb_test`
id space.

| # | Board | Date | Cell | Criterion × other axis | Gridley → afldb, player |
|---:|---:|---|---|---|---|
| 1 | 908 | 2026-01-09 | 0-1 | captain × disposals30 | 1350 → 2489 Cameron Bruce |
| 2 | 919 | 2026-01-20 | 0-1 | captain × clubbestfairest | 1350 → 2489 Cameron Bruce |
| 3 | 919 | 2026-01-20 | 0-2 | captain × risingStarNomination | 1350 → 2489 Cameron Bruce |
| 4 | 923 | 2026-01-24 | 0-0 | captain × HW | 1350 → 2489 Cameron Bruce |
| 5 | 938 | 2026-02-08 | 2-1 | captain × clubbestfairest | 1350 → 2489 Cameron Bruce |
| 6 | 938 | 2026-02-08 | 2-2 | captain × grandfinals1 | 6788 → 12093 Steven May |
| 7 | 938 | 2026-02-08 | 0-1 | games250sameclub × clubbestfairest | 2012 → 3581 David Swallow |
| 8 | 948 | 2026-02-18 | 0-1 | captain × disposals20avgseason | 1350 → 2489 Cameron Bruce |
| 9 | 967 | 2026-03-09 | 0-2 | games100clubs2 × 2010s | 2269 → 4006 Dylan Shiel |
| 10 | 988 | 2026-03-30 | 2-0 | captain × ME | 1350 → 2489 Cameron Bruce |
| 11 | 988 | 2026-03-30 | 2-0 | captain × ME | 6788 → 12093 Steven May |
| 12 | 988 | 2026-03-30 | 2-2 | captain × grandfinals1 | 6788 → 12093 Steven May |
| 13 | 993 | 2026-04-04 | 0-1 | teammates-100 × disposals30 | 379 → 669 Angus Brayshaw |
| 14 | 1005 | 2026-04-16 | 0-1 | captain × mcg-played-50 | 1350 → 2489 Cameron Bruce |
| 15 | 1005 | 2026-04-16 | 0-1 | captain × mcg-played-50 | 6788 → 12093 Steven May |
| 16 | 1024 | 2026-05-05 | 0-0 | teammates-150 × KA | 1359 → 2502 Cameron Mooney |
| 17 | 1024 | 2026-05-05 | 0-0 | teammates-150 × KA | 3211 → 5927 Hugh Greenwood |
| 18 | 1024 | 2026-05-05 | 0-0 | teammates-150 × KA | 41 → 59 Adam Simpson |
| 19 | 1024 | 2026-05-05 | 0-0 | teammates-150 × KA | 6173 → 11061 Robbie Tarrant |
| 20 | 1024 | 2026-05-05 | 0-0 | teammates-150 × KA | 1141 → 2126 Braydon Preuss |
| 21 | 1024 | 2026-05-05 | 0-0 | teammates-150 × KA | 4287 → 7870 Josh Gibson |
| 22 | 1024 | 2026-05-05 | 0-0 | teammates-150 × KA | 1846 → 3305 Darcy Tucker |
| 23 | 1024 | 2026-05-05 | 0-1 | teammates-150 × GC | 1130 → 2111 Brandon Matera |
| 24 | 1024 | 2026-05-05 | 0-1 | teammates-150 × GC | 3211 → 5927 Hugh Greenwood |
| 25 | 1024 | 2026-05-05 | 0-1 | teammates-150 × GC | 1128 → 2109 Brandon Ellis |
| 26 | 1024 | 2026-05-05 | 0-2 | teammates-150 × finals0 | 1130 → 2111 Brandon Matera |
| 27 | 1024 | 2026-05-05 | 0-2 | teammates-150 × finals0 | 1141 → 2126 Braydon Preuss |
| 28 | 1024 | 2026-05-05 | 0-2 | teammates-150 × finals0 | 3507 → 6461 Jack Newnes |
| 29 | 1024 | 2026-05-05 | 0-2 | teammates-150 × finals0 | 1846 → 3305 Darcy Tucker |
| 30 | 1111 | 2026-07-31 | 2-1 | captain × allAus1953 | 6788 → 12093 Steven May |
| 31 | 1111 | 2026-07-31 | 2-2 | captain × premier1x | 6788 → 12093 Steven May |
| 32 | 1140 | 2026-08-29 | 2-0 | captain × ME | 1350 → 2489 Cameron Bruce |
| 33 | 1140 | 2026-08-29 | 2-0 | captain × ME | 6788 → 12093 Steven May |
| 34 | 1140 | 2026-08-29 | 2-1 | captain × games200 | 1350 → 2489 Cameron Bruce |
| 35 | 1140 | 2026-08-29 | 2-1 | captain × games200 | 6788 → 12093 Steven May |
| 36 | 1140 | 2026-08-29 | 2-2 | captain × 2010s | 1350 → 2489 Cameron Bruce |
| 37 | 1140 | 2026-08-29 | 2-2 | captain × 2010s | 6788 → 12093 Steven May |

Totals: `captain` 20 (Bruce 11, May 9); `teammates-150` 14 (ten players, all board 1024); `teammates-100` 1;
`games250sameclub` 1; `games100clubs2` 1. All 15 bridges come from name-derived Gridley teammate criteria
(`cameron-bruce-teammate-1350`, `steven-may-teammate-6788`, …, all present in `corpus.json`).

## 3. Why the cells first appeared with the 2026-09-13 baseline (evidenced; exposure, not cause)

1. **All 37 cells sit on 2026 boards.** Boards 908–1140 are dated 2026-01-09 … 2026-08-29 (`corpus.json`).
2. **The suite auto-excused every disagreement on a board later than the database's last season.**
   `gridley-corpus.test.ts` classifies a known-answer disagreement `time of board` when
   `boardYear > gaps.maxSeason` (`maxSeason` = `max(matches.season)`), before any other arm runs.
3. **`afldb_test` did not carry season 2026 when ISSUE-118 closed.** ISSUE-118 Z.6 records 2026 as "a season
   `matches` does not carry". Z.7 (2026-09-06) and the 2026-09-19 report differ the way that change
   predicts: `dataset gap` 357 → 48, `time of board` 15,366 → 21,240, cells solved 9,854 → 10,161.
4. **The teammates criteria exist only on 2026 boards.** `teammates-100` / `teammates-150` occur on exactly three
   boards in the whole corpus: 993, 1024 and 1026 (all 2026). ISSUE-118 therefore never scored a fair comparison for `career_teammates_min`.

**Consequence.** ISSUE-118's "0 incorrect known answers" never covered these comparisons. The 37 are
disagreements that 2026 data exposed. They are not regressions introduced by the 2026-09-13 rebuild. This
explains *when* they appeared. It does **not** establish *why* AFLDB omits each player (§5).

`captain`, `games250sameclub` and `games100clubs2` **do** occur on many pre-2026 boards. Bruce's bridge
criterion also appears on pre-2026 boards (`corpus.json` line 16921), and the ISSUE-118 corpus fixture is
the same 1,143 boards. So there were pre-2026 boards where Gridley could have listed Bruce or May under
`captain`, and no disagreement was recorded. E1 (§6) tests whether Gridley's key changed between those boards
and 2026 without using a database.

## 4. Query path per criterion

All five mappings are `fixed(...)` entries in `src/search/gridley-compat.ts`. None carries a `note`, so the
suite's `partial dataset` arm cannot apply. Each cell runs through `solveCellSummary` and `compileAxis`
(`src/db/queries/grid-solver.ts`).

| Gridley criterion (its own text) | Builder | SQL semantics | Definitional gap visible in code |
|---|---|---|---|
| `captain`: "Captained their club for the majority of a season." | `club_captain_any` | `p.id IN (SELECT player_id FROM captaincies WHERE player_id IS NOT NULL AND link_status_value IN ('unique','resolved'))`: any captaincy row, any club, any season | AFLDB is looser (no "majority" test), so the builder can only over-include, never omit. An omission therefore means no trusted row for the player |
| `teammates-150` / `-100`: "…150 or more total teammates over their career. **Includes teammates they didn't play in a game with.** For seasons 2000 and prior, both players must have played in at least 1 game in the same season." | `career_teammates_min(x)` | Distinct other players sharing a `(season, club_id)` in `player_club_season_stats`, a table derived from `player_match_stats`, so both players must have **played** for that club that season | **Gridley counts list co-membership after 2000; AFLDB counts games-played co-membership in every era.** For any player, list teammates ⊇ played teammates, so this gap can only produce "Gridley lists, AFLDB omits", which is the direction of all 15 cells. AFLDB holds no historical lists: migration 096 says "no source in the repository publishes historical lists" (first authoritative list season 2027) |
| `games250sameclub`: "Played 250 or more games … for a single club … (including finals)." | `games_at_one_club_min_incl_merged(250)` | `EXISTS` a merged organization (rename folds through `organization_id`, a `merged_into` relation folds to its target) with `sum(player_clubs.games) >= 250` | None visible. `player_clubs` is derived from `player_match_stats` |
| `games100clubs2`: "Has played 100 or more games for two different AFL/VFL clubs (including finals)." | `games_at_multiple_clubs_min_incl_merged(100, 2)` | `c.clubs_played >= 2` AND at least 2 merged organizations each with `sum(player_clubs.games) >= 100` | None visible |

The query paths read `captaincies`, `player_club_season_stats`, `player_clubs`, `clubs`,
`club_organization_relations` and `player_career_stats` (the gate and the fairness test). ISSUE-222's draft
import touched none of them.

## 5. Repository evidence and provisional classification

### 5.1 `captain`: 20 cells, Cameron Bruce (11), Steven May (9)

- `data/awards/captaincies.csv` (1,774 rows; the canonical source `tools/migration/captaincies.py` loads,
  every row linked) has **no row naming Cameron Bruce or Steven May** under any id.
- The club-seasons they would occupy carry other captains:

  | Club | Seasons → recorded captain(s) |
  |---|---|
  | Melbourne | 2000–2008 David Neitz; 2009–2010 James McDonald; 2011 Brad Green; 2012–2013 Jack Grimes + Jack Trengove; 2014 Grimes + Nathan Jones; 2015–2016 Jones; 2017–2019 Jones + Jack Viney; 2020– Max Gawn |
  | Hawthorn | 2005–2007 Richard Vandenberg; 2008–2010 Sam Mitchell |
  | Gold Coast | 2011–2016 Gary Ablett Jr.; **2017–2018 Tom Lynch only**; 2019–2021 David Swallow; 2022–2024 Jarrod Witts; 2025– Noah Anderson |

- The source does represent co-captaincies (Callan Ward "2012–2019 (co-captain)"; Melbourne 2012–2013 and
  2017–2019 carry two captains). A missing co-captain is therefore a source omission, not a model limitation.
- The tracked CSV ids are DEV/legacy ids (`player-identity.csv`: Cameron Bruce 747, Steven May 11940), not
  `afldb_test` ids. The finding rests on names, so the id spaces do not affect it.

**Provisional (repository-supported):** AFLDB's omission matches its canonical source. The builder is not
at fault: it can only over-include. One question stays open. Either the source misses a real captaincy
(**canonical data gap**: source coverage), or Gridley's key names players who did not captain for a majority
of a season (**stale or wrong Gridley known answer**). The repository cannot decide it. E1 (did Gridley's key
change in 2026?), Q1 (does `afldb_test` hold any row the CSV does not?) and E4 (independent captain lists)
decide it.

**Anomaly to resolve in E1:** in the 2026 key Gridley lists May but **not** Bruce for `captain ×
grandfinals1` (boards 938, 988), `× allAus1953` and `× premier1x` (board 1111). A player-level captain set
would list Bruce in every cell whose other axis he satisfies. Whether he satisfies those axes is a Gridley
fact the fixture shows only by cell.

### 5.2 `teammates-150` (14 cells, ten players) and `teammates-100` (1 cell, Angus Brayshaw)

- Gridley's criterion text defines a **list-grain** teammate after 2000. AFLDB's builder is **games-grain**,
  and AFLDB holds no historical lists (096).
- All 15 disagreements run in the only direction that grain difference can produce.
- Every one of the eleven careers extends past 2000 (Mooney 1997–2011 and Simpson 1995–2009 straddle it).
  Q0a confirms this from data.

**Provisional (repository-supported; data confirmation pending):** a **definitional difference, list
membership versus games played**. This is the same mechanism as the suite's existing `list membership`
category, which already covers `teammate_of` but not `career_teammates_min`. The issue's possible labels
"query/predicate defect" and "canonical data gap" are not ruled out until Q2 shows:

- (a) the builder-grain recount is below threshold, and agrees with the organization-grain recount (no
  club-identity split inside a season);
- (b) no club-season in the eleven careers has a thin roster against its fixture (no data hole);
- (c) the whole-population eligible counts are consistent with ISSUE-118 §22.6 (3,580 / 995) plus season
  2026.

### 5.3 `games250sameclub` (David Swallow) and `games100clubs2` (Dylan Shiel): 1 cell each

No repository evidence decides these. Both builders derive from `player_match_stats` through `player_clubs`.
The candidate causes, each with the query that tests it:

- the derived total is below threshold and the source rows agree: a stale Gridley key, or matches missing
  from AFLDB against AFL Tables (Q3b, Q3c, then E4);
- `player_clubs` disagrees with `player_match_stats` (Q3a against Q3b);
- one club split across two organizations (Q3a `merged_organization_id`);
- a split player identity (Q0b).

**No classification is made.**

## 6. Evidence still required

| Id | What | Where | Gate |
|---|---|---|---|
| **E1** | Gridley key consistency over time for the 15 players | `issues/closed/AFLDB-ISSUE-225-gridley-key-probe.mjs`, which reads the two tracked fixtures only | **Done 2026-10-01** (§11.1) |
| **E2** | Canonical recounts and source rows (Q0–Q3) | `issues/closed/AFLDB-ISSUE-225-evidence.sql`, one `READ ONLY` transaction, guard refuses any DB but `afldb_test`, ends `ROLLBACK` | **Done 2026-10-01** (§11.2) |
| **E3** | Horizon-dependent facts only: DEV match horizon; Swallow and Shiel 2026 and career games by organization; Darcy Tucker teammate count including DEV 2026; derived-against-source agreement for those rows | `issues/closed/AFLDB-ISSUE-225-e3-dev-horizon.sql`, one `READ ONLY` transaction, guard refuses any DB but `afldb_dev`, ends `ROLLBACK` | **Done 2026-10-01, PASS** (§14) |
| **E4** | Independent public sources (minimum set in §13). Each citation needs a URL, an access date and the quoted text | Network | **Done 2026-10-01, operator-run** (§15). URL, access date and verbatim quote still to be captured in the S1/S2 evidence records (§23 D3) |

## 7. Operator commands (read-only)

From the worktree root, in PowerShell, with the `afldb_test` tunnel up. Use the same DSN as the corpus run
(`AFLDB_TEST_DATABASE_URL`, the tunnel port, CR stripped).

**E1, DB-free:**

```powershell
New-Item -ItemType Directory -Force D:\tmp\issue225 | Out-Null
node issues/closed/AFLDB-ISSUE-225-gridley-key-probe.mjs > D:\tmp\issue225\e1-gridley-key-probe.txt
```

**E2, `afldb_test`, read-only:**

```powershell
$dsn = $env:AFLDB_TEST_DATABASE_URL.Trim()
if ($dsn -notmatch '/afldb_test(\?|$)') { throw 'DSN does not name afldb_test' }
$env:PGOPTIONS = '-c default_transaction_read_only=on'
psql -X -v ON_ERROR_STOP=1 -o D:\tmp\issue225\e2-evidence.txt -f issues/closed/AFLDB-ISSUE-225-evidence.sql -d $dsn
Remove-Item Env:PGOPTIONS
```

The run proves its own target before reading anything else. The first section (`== G.`) prints
`current_database`, `transaction_read_only`, the server port and a timestamp. A `DO` guard then raises, and
`ON_ERROR_STOP` ends the run, unless the database is `afldb_test` and the transaction is read-only. Read-only
is enforced three ways: the `PGOPTIONS` session default, `BEGIN … READ ONLY`, and the guard. The script ends
with `ROLLBACK`. Expected runtime is under a minute; Q2c is the ~2 s roster-array shape. Return both text
files.

(As executed, the operator ran E2 server-side on streamanator through `D:\tmp\issue225\run-e2.sh`. That
runner also proves `current_database`, `default_transaction_read_only` and the port before running the file.)

**E3, `afldb_dev`, read-only (pass 2).** Use the same transport as E2. The runner
`D:\tmp\issue225\run-e3.sh` mirrors `run-e2.sh`. It sources the host `.env`, uses `AFLDB_IMPORT_DATABASE_URL`
(the `afldb_dev` importer DSN; ISSUE-112 §16.1 used this role for read-only `afldb_dev` extraction; chosen over the
app DSN because E3 reads `sources`, which the app role may not be granted) and sets
`PGOPTIONS=-c default_transaction_read_only=on`. It halts unless the database is `afldb_dev` and the
session default is read-only. It deletes both `/tmp` files on exit. From the worktree root, in PowerShell:

```powershell
scp issues/closed/AFLDB-ISSUE-225-e3-dev-horizon.sql streamanator:/tmp/afldb-issue225-e3.sql
scp D:\tmp\issue225\run-e3.sh streamanator:/tmp/afldb-issue225-run-e3.sh
ssh streamanator 'bash /tmp/afldb-issue225-run-e3.sh' | Out-File -Encoding utf8 D:\tmp\issue225\e3-dev-horizon.txt
```

Read-only is enforced three ways, as in E2: `PGOPTIONS`, `BEGIN … READ ONLY` and the `DO` guard
(`afldb_dev` only). The run ends with `ROLLBACK`. `Out-File -Encoding utf8` matters: the E1 and E2 files came
back as UTF-16 through a plain `>` redirect. Return `e3-dev-horizon.txt`.

## 8. Pre-registered decision rules (fixed before the evidence, so classification is not fitted to it)

| Family | Evidence outcome | Classification | Consequence (separate approved slice) |
|---|---|---|---|
| captain | Q1a finds a Bruce/May row that is not trusted-linked | linkage defect | Repair the link through the tracked captaincies path |
| captain | Q1a empty, and E4 independently shows a majority-of-season captaincy | **canonical data gap** (source coverage) | Add the evidenced rows to `data/awards/captaincies.csv`, bump the loader pins, reload through the tracked path |
| captain | Q1a empty, and E4 shows no captaincy (vice-captain / acting / leadership group) | **stale or wrong Gridley known answer** | A tracked, evidenced adjudication record read by the suite, of the `height-adjudications.csv` / `rookie-relisting-outcomes.csv` form. Never a player-id exception |
| captain | E1 shows the same pairing answered both ways by Gridley | supports a Gridley key revision; does not decide which side is right | Still needs E4 |
| teammates | Q2a builder-grain < threshold, equal to org-grain, careers past 2000, Q2b no thin roster, Q2c consistent | **definitional: list membership** | A direction-guarded rule in the suite: lacking axis `career_teammates_min`, Gridley lists / AFLDB omits, and the player has a post-2000 season. A disagreement on a pre-2001-only career, or the reverse direction, stays `incorrect known answer` |
| teammates | builder-grain ≠ org-grain | **query/predicate defect** (club-identity split inside a season) | Builder fix with a focused test |
| teammates | Q2b thin roster against a full fixture | **canonical data gap** | Data repair through the tracked import path |
| teammates | builder-grain ≥ threshold (yet the cell says AFLDB omits) | **test/corpus harness defect** or builder defect | Reproduce the cell directly |
| games-at-club | Q0b duplicate identity | canonical data defect (identity split) | Identity merge through the tracked path |
| games-at-club | Q3a two organizations for one club | **club-lineage interpretation defect** | Lineage fix |
| games-at-club | Q3a ≠ Q3b | derived-table defect | Rebuild/derivation fix |
| games-at-club | Q3a = Q3b < threshold, Q3c fixture complete, E4 AFL Tables agrees with AFLDB | **stale or wrong Gridley known answer** | Evidenced adjudication record, as above |
| games-at-club | E4 AFL Tables > AFLDB | **canonical data gap** (missing matches) | Data repair |
| any | Q0a `final_season` < `pms_final_season`, or Q0d > 0 | **test/corpus harness defect**: stale derived table makes the fairness test wrong | Rebuild derived before any classification |

## 9. Provisional answer to "one defect or several"

**Not one.** The repository already separates at least three independent families. The only thing they share
is the exposure mechanism in §3, which is a suite-coverage fact, not a cause.

1. `captain`: AFLDB is faithful to its canonical source. The source is either incomplete or Gridley is
   wrong. Decided by E1 and E4.
2. `teammates-*`: a definitional grain difference, provisional and pending Q2.
3. `games250sameclub` / `games100clubs2`: undetermined, pending Q0b and Q3.

## 10. Recommended slices after the evidence pass (none approved; each needs its own authorisation)

- **S1 (suite, teammates):** add the direction- and era-guarded `career_teammates_min` arm to the `list
  membership` classification, with a DB-free pin in `tests/gridley-compat.test.ts` or
  `tests/gridley-corpus-support.ts`. Extend the `list membership` informational text. Only if Q2 meets every
  condition in §8.
- **S2 (data, captain):** if E4 supports Gridley, add evidenced captaincy rows through
  `data/awards/captaincies.csv` and `tools/migration/captaincies.py` (pins 1,774 → N), then load to
  `afldb_test` through the tracked path. If E4 contradicts Gridley, add a tracked captaincy-adjudication
  record and a suite arm that reads it. (Pass 2: the loader pins `SOURCE_CITATIONS = {"wikipedia"}`, so a
  row evidenced only by a non-Wikipedia source widens the source contract and needs its own decision.)
- **S3 (games-at-club):** shaped by Q3 / E3 / E4, one of identity, lineage, derivation or data repair, or a
  Gridley-key adjudication.
- **S4 (suite coverage note):** record in the suite's header comment that the `boardYear > gaps.maxSeason`
  arm hides every disagreement on a board past the database horizon, so a season rollover can surface
  long-standing cells. Documentation only, optional.
- **Closure:** one diagnostic corpus rerun (`AFLDB_GRIDLEY_DIAGNOSTIC=1`, new dated report) once every
  slice lands. Target: `incorrect known answer` 0, with every moved cell carrying its evidence in the finding
  detail.

## 11. Pass 2: E1 and E2 evidence (operator-run 2026-10-01)

Outputs: `D:\tmp\issue225\e1-gridley-key-probe.txt` (1,143 boards, 1,143 answer keys) and
`D:\tmp\issue225\e2-evidence.txt`. Both are UTF-16, from a plain PowerShell `>` redirect.

**E2 safety, as printed by the run:** target `afldb_test`, `transaction_read_only = on`, port 5432,
`BEGIN … READ ONLY`, ended `ROLLBACK`, observed 2026-10-01 21:41:59 +10. No mutation.

### 11.0 Reproducibility boundary

- E2 Q0c: `afldb_test` today has `max_match_season = 2025` and `matches_2026 = 0`.
- The suite classes every known-answer disagreement on a board whose year is past `max(matches.season)` as
  `time of board` (`gridley-corpus.test.ts:578`), and an empty cell on such a board as `dataset gap` (`:553`).
- All 37 cells are on 2026 boards. On today's `afldb_test`, none of them can score `incorrect known answer`.

The ISSUE-222 37-cell report (2026-09-19) was produced while `afldb_test` carried 2026 matches. Today's
`afldb_test` therefore cannot reproduce that fair-comparison classification. **The 37 cells have not
disappeared.** The horizon masks them. The 2026-09-19 report remains the census. Reproducing it needs a
database that carries 2026.

A corollary from the same code: the suite scores a disagreement `incorrect known answer` only when the
player's `player_career_stats.final_season` is earlier than the board year. On the 2026-09-19 `afldb_test`,
every one of the 15 players therefore had a derived final season before 2026. The cause was either no 2026
game in that dataset or a stale derived table. Today's Q0d = 0 cannot tell those apart, because today's
database carries no 2026. For Swallow, Shiel and Tucker, E3 tests this.

### 11.1 Identity and derived-table checks (E2 Q0)

- Q0b: no duplicate display-name row for any of the 15 players. **Identity split ruled out.**
- Q0a: `player_career_stats.final_season` and `games` equal the `player_match_stats` recount for all 15.
  Q0d = 0 players with a stale final season. **Stale derived table ruled out on today's `afldb_test`.**
- `legacy_player_id` is NULL for all 15 on `afldb_test`.

### 11.2 Captain (E1 + E2 Q1)

- Q1c: `captaincies` holds 1,774 rows, 1,774 trusted, seasons 1897–2026.
- Q1a: no row on player 2489 or 12093. The name pattern matched only other players: Bruce Comben, Bruce
  Nankervis, Bruce Monteath and Bruce Duperouzel, all `unique`. **Linkage defect ruled out.**
- Q1b: every club-season either player played names other captains. For Bruce: Melbourne 2000–2008 Neitz,
  2009–2010 McDonald; Hawthorn 2011–2012 Hodge. For May: Gold Coast 2011–2016 Ablett, **2017–2018 Tom Lynch
  only**; Melbourne 2019 Viney and Jones, 2020–2025 Gawn.

AFLDB's answer matches its tracked source. `club_captain_any` is unchanged and must stay unchanged: it can
only over-include.

E1 (Gridley key over time):

| Player | Before 2026 | 2026 | Shape |
|---|---|---|---|
| Cameron Bruce (1350 → 2489) | 0 listed / 37 omitted | 11 listed / 4 omitted | Several identical `captain × X` pairs flip from omitted (2023–2025) to listed (2026): `ME`, `HW`, `disposals30`, `clubbestfairest`, `2010s` (`KEY CHANGED` lines) |
| Steven May (6788 → 12093) | 24 listed / 0 omitted | 9 listed / 0 omitted | Stable: Gridley has treated May as a captain on every board since 2023 |

The pass-1 anomaly in §5.1 (May listed but Bruce omitted on `grandfinals1`, `allAus1953` and `premier1x`) is
superseded. The four 2026 Bruce omissions are all on other-axis criteria. The decisive signal is the
pre-2026 → 2026 flip on identical pairs.

### 11.3 Teammates (E2 Q2)

Q2a, games-grain recount (`teammates_builder_grain` = `teammates_org_grain` for all 11; teammates to 2000 in
brackets where non-zero):

| Player (afldb id) | Recount / threshold | Career |
|---|---|---|
| Adam Simpson (59) | 143 / 150 (71 to 2000) | 1995–2009 |
| Angus Brayshaw (669) | 88 / 100 | 2015–2023 |
| Brandon Ellis (2109) | 143 / 150 | 2012–2024 |
| Brandon Matera (2111) | 149 / 150 | 2011–2020 |
| Braydon Preuss (2126) | 121 / 150 | 2017–2022 |
| Cameron Mooney (2502) | 128 / 150 (69 to 2000) | 1999–2011 |
| Darcy Tucker (3305) | 146 / 150 | 2016–**2025** |
| Hugh Greenwood (5927) | 140 / 150 | 2017–2024 |
| Jack Newnes (6461) | 142 / 150 | 2012–2022 |
| Josh Gibson (7870) | 144 / 150 | 2006–2017 |
| Robbie Tarrant (11061) | 149 / 150 | 2010–2022 |

- **(a)** Every recount is below threshold, and identity grain equals organization grain: **no club-identity
  split.**
- **(b)** Q2b roster coverage looks complete, so this is not a thin-data condition. Each club-season has 31–46
  distinct players. `club_player_games` equals 22 × `club_matches` before 2021 and 23 × from 2021 (the
  substitute era).
- **(c)** Q2c whole population: 3,580 eligible at 100 and 995 at 150. That is exactly ISSUE-118 §22.6, as
  expected at the same 2025 horizon.
- Every career has a post-2000 season (era guard satisfied).

All four §8 conditions for the definitional row hold.

### 11.4 Games at club (E2 Q3 + E1)

**David Swallow (3581):**

- Q3a: `player_clubs` holds Gold Coast 249, 2011–2025, in one organization (merged id = own id).
- Q3b: per-season recount 21, 12, 18, 22, 6, (2016 no row), 18, 20, 22, 15, 21, 22, 23, 20, 9 (2025, 2 of them
  finals) = 249. Derived equals source.
- Q3c: the Gold Coast fixture looks complete (22 a season; 17 in 2020; 23 in 2023–24; 25 with 2 finals in
  2025).
- He fails `games250sameclub` on current canonical evidence.
- E1: the exact `games250sameclub × clubbestfairest` pair is omitted on 2024-04-30 and 2025-01-14, and listed
  on 2026-02-08 (board 938). That board is dated **before any 2026 match**.

**Dylan Shiel (4006):**

- Q3a/Q3b: GWS 135 (2012–2018) and Essendon 99 (2019–2025: 22, 15, 8, 19, 12, 9, 14). Derived equals source,
  one organization per club.
- Q3c: both fixtures look complete.
- He fails `games100clubs2` through 2025 by one Essendon game.
- E1: `games100clubs2 × 2010s` is omitted on 2024-04-27 and 2025-04-27, and listed on 2026-03-09 (board 967).
- **Pass-2 refinement from E1:** Gridley already listed Shiel under `games100clubs2` on **board 887
  (2025-12-19)**, paired with `brownlow10votes`. That pair was omitted on 2024-02-16.
  - 2025-12-19 is after the 2025 season and before any 2026 match.
  - The suite treats Gridley keys as frozen at the board date (`gridley-corpus.test.ts:559-561`). Under that
    premise, no 2026 game can explain Gridley's count.
  - Board 887 itself was classed `time of board`, because Shiel's final season of 2025 is not earlier than
    the board year. That is why it is not among the 37.

**Shared shape (observation, not a cause):**

- Swallow and Shiel are each **exactly one game** short of the threshold through 2025 on AFLDB.
- Gridley first lists each on a board dated after the 2025 season and before any 2026 match.
- Gridley's earlier omissions are consistent with AFLDB's counts at those dates.

The disagreement is therefore a one-game difference somewhere in the 2025-or-earlier record:

- either AFLDB is missing a game (**canonical data gap**);
- or Gridley's count is one high (**stale or wrong Gridley known answer**).

E4's per-season comparison against AFL Tables locates which. E3 settles only the horizon question.

## 12. Refined provisional classification (pass 2; supersedes §5 and §9 where they differ)

### 12.1 Table

| Family | Cells | Player | Ruled out (evidence) | Provisional classification | Still needed |
|---|---:|---|---|---|---|
| `captain` | 9 | Steven May 12093 | linkage defect (Q1a); builder (over-include only) | **Candidate canonical source omission.** `captaincies.csv` (Wikipedia-sourced) has Gold Coast 2017–18 as Tom Lynch only; Gridley is stable on May (E1 24/0, 9/0) | E4 independent evidence of a majority-of-season captaincy **before any data correction** |
| `captain` | 11 | Cameron Bruce 2489 | linkage defect (Q1a); builder | **Candidate Gridley-key drift/inconsistency.** Identical pairs flip from omitted (2023–25, 0/37) to listed (2026, 11/4) | E4 independent evidence before adjudication |
| `teammates-150` / `-100` | 15 | 11 players (§11.3) | club-identity split (a); thin data (b); population drift (c); stale derived (Q0d) | **Semantic-contract difference.** Gridley's listed-teammate concept (list co-membership after 2000) against AFLDB's played co-club-season contract | Tucker only: E3 (horizon). The other ten are final |
| `games250sameclub` | 1 | David Swallow 3581 | identity split (Q0b); lineage (Q3a); derived drift (Q3a = Q3b); fixture hole (Q3c) | **Candidate Gridley-key error.** 249 < 250 through 2025; Gridley lists him on a board before any 2026 match | E3 (DEV 2026 and the ≤2025 total), then E4 |
| `games100clubs2` | 1 | Dylan Shiel 4006 | same four as Swallow | **Unresolved; horizon-dependent at the cell level.** Essendon 99 < 100 through 2025. Board 887 (2025-12-19) points to a one-game difference in the ≤2025 record that no 2026 game can explain: either a candidate canonical data gap or a Gridley-key error | E3 (does a 2026 Essendon game precede 2026-03-09?), then E4 |

### 12.2 Binding constraints carried from this pass

- **`club_captain_any` is not to be changed.** The query faithfully reflects the tracked `captaincies`
  source.
- **No evidence supports changing `career_teammates_min`.** Any teammates slice (§10 S1) is
  compatibility/adjudication only:
  - a direction- and era-guarded classification arm keyed on the builder;
  - never a blanket player exception or a player-id list;
  - never a builder change.
- **No canonical CSV correction before E4.** That covers May's captaincy and any Swallow or Shiel game.
  A captaincy row evidenced only by a non-Wikipedia source would also widen the loader's
  `SOURCE_CITATIONS = {"wikipedia"}` contract, which needs its own decision.
- **DEV supplies horizon facts only.** It answers whether a 2026 game happened and is recorded, plus
  derived/source agreement. It is not evidence for solver semantics (standing rule: semantics are decided on
  rebuilt `afldb_test`, tracked sources and the Gridley oracle).

### 12.3 One defect or several (refines §9)

Still **not one**. There are four independent mechanisms. Their only common factor is the 2026-horizon
exposure in §3.

1. A candidate source omission (May).
2. Candidate Gridley-key drift (Bruce).
3. A semantic-contract difference (teammates).
4. A one-game count difference of undetermined side (Swallow, Shiel). This one may itself resolve as either
   source gap or key error.

### 12.4 E3 pre-registered reading (fixed before E3 runs)

| Section | Outcome | Reading |
|---|---|---|
| G / H1 | not `afldb_dev`, not read-only, or `matches_2026 = 0` | Stop. E3 cannot settle the horizon. Record it |
| I, A1, A2, T1 | any `career_derived_agrees = f`, `agrees = f`, or any A2 row | DEV derived-table drift for that player. Its classification waits for a rebuild; nothing else is inferred |
| C2 `games_to_2025`; T2 `teammates_builder_grain_to_2025` | ≠ afldb_test (Swallow 249; Shiel GWS 135 / Essendon 99; Tucker 146) | DEV/`afldb_test` divergence on the ≤2025 record. Record it. Neither side is chosen without E4 |
| C2/C3 Swallow | `games_2026 = 0` | Horizon irrelevant. The cell is a fair comparison at any horizon; §12.1 stands and goes to E4 |
| C2/C3 Swallow | `games_2026 ≥ 1` | On a 2026-horizon database, the suite would class the cell `time of board` (final season ≥ 2026). `games_before_cell_board` must still be 249, because no 2026 match precedes 2026-02-08, so Gridley's listing on that date is still unexplained by AFLDB data. Also record that the 2026-09-19 `incorrect` class depended on that day's `afldb_test` (§11.0 corollary) |
| C2/C3 Shiel | Essendon `games_before_cell_board ≥ 100` | A 2026 Essendon game before 2026-03-09 satisfies the cell at its board date. Cell 9 is horizon (`time of board`), not a defect. Board 887 (2025-12-19) stays a separate one-game question for E4 |
| C2/C3 Shiel | Essendon `games_before_cell_board = 99` | Horizon does not explain cell 9. It joins Swallow's one-game question (E4) |
| T2/T3 Tucker | no 2026 row (C3, T3 empty) | Count stays 146. Tucker joins the semantic-contract classification with the other ten |
| T2/T3 Tucker | 2026 rows, `teammates_source_as_at_board_1024 ≥ 150` | Horizon explains cell 22/29: AFLDB's own contract reaches 150 by the board date. Class it `time of board`, not semantic |
| T2/T3 Tucker | 2026 rows, `teammates_source_as_at_board_1024 < 150` | Still below threshold on AFLDB's contract at the board date. Semantic-contract difference, as the other ten |

## 13. E4: minimum independent public-source evidence (identified, not fetched; needs authorisation)

Each item needs a URL, an access date and the quoted text. Prefer contemporaneous primary sources (the club,
AFL.com.au, AFL Tables) over aggregators. Gridley's criterion is "Captained their club for the **majority of
a season**". Vice-captaincy, the leadership group and one-off acting captaincy do not qualify.

**Steven May (decides: source omission → S2 data row, or not):**

1. A contemporaneous announcement (Gold Coast Suns official site or AFL.com.au) naming May captain or
   co-captain for the 2017 season. If the claim also covers 2018, a separate 2018 announcement.
2. Evidence the appointment held for most of each claimed season. A season-end or tenure-end item, such as
   his October 2018 trade or the 2019 captaincy change, or a club honour roll listing captains by season, is
   enough.
3. The current Wikipedia Gold Coast captains list compared with what `captaincies.csv` transcribed. The
   loader cites `wikipedia` only, so this shows whether the source itself has since been corrected.

**Cameron Bruce (decides: Gridley-key drift → adjudication record, or source omission):**

1. Melbourne FC's official captains honour roll covering 2000–2010.
2. Hawthorn's official captains honour roll covering 2011–2012.
3. Only if either roll is silent but another claim surfaces: one contemporaneous article for that specific
   season, establishing whether any acting or co-captaincy covered a majority of the season.

**David Swallow (decides: AFLDB missing a game, or Gridley key one high; plus status for Feb 2026):**

1. The AFL Tables player page (`afltables.com/afl/stats/players/D/David_Swallow.html`): games per season for
   2011–2025 and the career total, compared row by row with E2 Q3b. Check especially 2016, where AFLDB has no
   row.
2. One dated milestone or status source (Gold Coast Suns or AFL.com.au):
   - the date of his 250th game: on or before 2025 means AFLDB is missing a game; in 2026 means Gridley's
     2026-02-08 key ran ahead of its board date;
   - **or** a retirement/delisting notice at the end of 2025, which leaves him at 249 on both counts unless AFL
     Tables shows 250.

**Recommended addition, Dylan Shiel (same shape, E1 board 887):**

1. The AFL Tables player page: Essendon games per season for 2019–2025 (AFLDB 99) and GWS for 2012–2018
   (135).
2. One dated 100th-Essendon-game item, or an end-of-2025 status item.

## 14. Pass 3: E3 evidence (operator-run 2026-10-01, `afldb_dev`, read-only): PASS

As reported by the operator from `D:\tmp\issue225\e3-dev-horizon.txt`:

- **Safety:** `database = afldb_dev`, role `afldb_import`, `transaction_read_only = on`, `BEGIN READ ONLY`,
  ended `ROLLBACK`. No mutation.
- **Horizon:** `max_match_season = 2026`, `matches_2026 = 218`, `finals_2026 = 11`. Fixture and player-game
  completeness looked normal. The §12.4 stop row does not apply.
- **David Swallow:** Gold Coast 249 across all DEV data; 249 through 2025; 0 games in 2026. Source rows and
  `player_clubs` agree.
- **Dylan Shiel:** GWS 135, Essendon 99; 0 games in 2026. Source and `player_clubs` agree.
- **Darcy Tucker:** 146 teammates at builder grain, 146 at organization grain, 146 through 2025 and 146 as at
  board 1024. 0 games and 0 club-season rows in 2026. Source and derived rows agree.
- No `player_club_season_stats` disagreement for Swallow or Shiel.

**Reading per §12.4 (pre-registered):**

| Subject | Row that applied | Reading |
|---|---|---|
| Swallow | C2/C3 `games_2026 = 0`; `games_to_2025` = 249 = `afldb_test` | Horizon irrelevant. The cell is a fair comparison at any horizon. To E4 |
| Shiel | Essendon `games_before_cell_board = 99`; ≤2025 = `afldb_test` | Horizon does not explain cell 9. Joins Swallow's one-game question. To E4 |
| Tucker | no 2026 row | Count stays 146. Tucker joins the other ten as a semantic-contract difference. **The teammates family is final (15 cells)** |
| All three | no `agrees = f`, no A2 row | No DEV derived-table drift |

There is no 2026 horizon, stale-derived, identity, lineage or fixture explanation for any of these cells.

## 15. Pass 3: E4 public-source evidence (operator-run 2026-10-01)

As reported by the operator. **Provenance gap:** §13 requires a URL, an access date and the verbatim quoted
text for every citation. This report gives source names and paraphrased content. The verbatim capture is a
precondition of S1 and S2 (§23 D3). Nothing below may be written into a tracked data file until then.

| Subject | Independent sources (operator report) | Classification |
|---|---|---|
| **Steven May** | Gold Coast SUNS current captaincy history: "Gary Ablett 2011-2016; Tom Lynch & Steven May 2017-2018; David Swallow & Jarrod Witts 2019-2021; …". AFL.com.au also records May as Gold Coast co-captain 2017–18 | **Canonical `captaincies` source omission**: May 2017 and 2018 |
| **Cameron Bruce** | Melbourne FC: after David Neitz retired during 2008, James McDonald and Cameron Bruce were co-captains for the remainder of 2008; McDonald became sole captain for 2009 | **Canonical `captaincies` source omission**: Bruce 2008. **Independently, Gridley's key for Bruce is temporally inconsistent** (E1: 0/37 listed before 2026, then 11 listed / 4 omitted in 2026). That inconsistency does not erase the verified 2008 captaincy. Both facts are kept |
| **David Swallow** | AFL Tables final career total 249, all Gold Coast. AFL 2025 Annual Report retirement table: 249. DEV and `afldb_test`: 249 | **Gridley known-answer error** (`games250sameclub`) |
| **Dylan Shiel** | AFL Tables: GWS 135 + Essendon 99 = 234. Essendon retirement announcement: 99 Essendon games, 234 career. DEV and `afldb_test` agree | **Gridley known-answer error** (`games100clubs2`) |

**Teammates (no E4 needed).** E2 and E3 establish the 15 cells as semantic-contract differences. AFLDB
counts actual same-club, same-season playing overlap from canonical played data. The counts are internally
consistent and below threshold. `career_teammates_min` is not changed. There are no blanket player exceptions.

**Collateral facts in the same sources (bear on S1 scope, §17.3):** the quoted Gold Coast history also names
**Jarrod Witts** as co-captain 2019–2021, and `captaincies.csv` has Gold Coast 2019–2021 as David Swallow
only. The quoted Melbourne history names **James McDonald** as co-captain for the remainder of 2008, and
`captaincies.csv` has Melbourne 2008 as David Neitz only (McDonald's rows start in 2009).

## 16. Final 37-cell classification and disposition (supersedes §12.1)

"Post-repair" means after S1 (captaincies) and S2 (adjudication), on a database whose horizon includes 2026
(the census condition of the 2026-09-19 report). On today's `afldb_test` (horizon 2025) the 37 are masked as
`time of board` (§11.0). After S1 the 20 captain cells produce no finding on either horizon, because both sides
list the player. The 17 others stay masked until a 2026 horizon. §21 gives the measurable expectations for both
horizons.

| # | Board | Cell | Criterion × other | Player | Final classification | Disposition | Post-repair outcome |
|---:|---:|---|---|---|---|---|---|
| 1 | 908 | 0-1 | captain × disposals30 | Bruce | source omission (Melbourne 2008) | S1 | agreement (no finding) |
| 2 | 919 | 0-1 | captain × clubbestfairest | Bruce | source omission | S1 | agreement |
| 3 | 919 | 0-2 | captain × risingStarNomination | Bruce | source omission | S1 | agreement |
| 4 | 923 | 0-0 | captain × HW | Bruce | source omission | S1 | agreement |
| 5 | 938 | 2-1 | captain × clubbestfairest | Bruce | source omission | S1 | agreement |
| 6 | 938 | 2-2 | captain × grandfinals1 | May | source omission (Gold Coast 2017–18) | S1 | agreement |
| 7 | 938 | 0-1 | games250sameclub × clubbestfairest | Swallow | Gridley known-answer error | S2 record | `adjudicated key disagreement` |
| 8 | 948 | 0-1 | captain × disposals20avgseason | Bruce | source omission | S1 | agreement |
| 9 | 967 | 0-2 | games100clubs2 × 2010s | Shiel | Gridley known-answer error | S2 record | `adjudicated key disagreement` |
| 10 | 988 | 2-0 | captain × ME | Bruce | source omission | S1 | agreement |
| 11 | 988 | 2-0 | captain × ME | May | source omission | S1 | agreement |
| 12 | 988 | 2-2 | captain × grandfinals1 | May | source omission | S1 | agreement |
| 13 | 993 | 0-1 | teammates-100 × disposals30 | Brayshaw | semantic contract (list vs played) | S2 rule | `list membership` |
| 14 | 1005 | 0-1 | captain × mcg-played-50 | Bruce | source omission | S1 | agreement |
| 15 | 1005 | 0-1 | captain × mcg-played-50 | May | source omission | S1 | agreement |
| 16–22 | 1024 | 0-0 | teammates-150 × KA | Mooney, Greenwood, Simpson, Tarrant, Preuss, Gibson, Tucker | semantic contract | S2 rule | `list membership` |
| 23–25 | 1024 | 0-1 | teammates-150 × GC | Matera, Greenwood, Ellis | semantic contract | S2 rule | `list membership` |
| 26–29 | 1024 | 0-2 | teammates-150 × finals0 | Matera, Preuss, Newnes, Tucker | semantic contract | S2 rule | `list membership` |
| 30 | 1111 | 2-1 | captain × allAus1953 | May | source omission | S1 | agreement |
| 31 | 1111 | 2-2 | captain × premier1x | May | source omission | S1 | agreement |
| 32 | 1140 | 2-0 | captain × ME | Bruce | source omission | S1 | agreement |
| 33 | 1140 | 2-0 | captain × ME | May | source omission | S1 | agreement |
| 34 | 1140 | 2-1 | captain × games200 | Bruce | source omission | S1 | agreement |
| 35 | 1140 | 2-1 | captain × games200 | May | source omission | S1 | agreement |
| 36 | 1140 | 2-2 | captain × 2010s | Bruce | source omission | S1 | agreement |
| 37 | 1140 | 2-2 | captain × 2010s | May | source omission | S1 | agreement |

**Totals:** 20 cells become real AFLDB answers through corrected data (S1). The 15 teammate cells are
horizon-dependent: at a 2026 horizon they become `adjudicated key disagreement` under D6 (§24.3 item 1; this
supersedes the `list membership` disposition in the rows above); at the 2025 `afldb_test` V3 horizon they
remain `time of board`. 2 become `adjudicated key disagreement` (Gridley key error). `incorrect known answer` for
the census goes 37 → 0. Every moved cell keeps a named, counted, informational category with its evidence in
the finding detail. None is suppressed.

**Why "agreement" is sound for the 20 captain cells.** In every one of the 20 records the 2026-09-19 report
names `captain` as the only lacking axis (`missing from captain`). AFLDB's other-axis set therefore already
contains the player. Adding a trusted captaincy row makes `club_captain_any` contain him, so AFLDB lists him
and agrees with Gridley. No builder changes.

## 17. Captaincies provenance and root cause

### 17.1 The accepted source model (from `tools/migration/captaincies.py`, `import_awards.py`)

- **Bootstrap (1,375 rows, AFLDB-ISSUE-112 §19).** These rows were extracted read-only from `afldb_dev.captaincies`,
  which a legacy scrape outside this repository loaded, all with provenance `wikipedia`. `source_key` is that
  scrape's preserved 24-hex `source_record_id`. The Gold Coast, Melbourne and GWS rows are bootstrap rows.
- **ISSUE-118 Family B (+399 rows, §23.21).** Transcribed from the named Wikipedia captain lists of six clubs.
  `period` is the source span verbatim, and `source_key` = the first 24 hex of
  SHA-1(`issue118|club|season|player|period`). The file stays strictly key-ordered.
- **Citation contract.** `SOURCE_CITATIONS = {"wikipedia"}` is a *source-granularity* label. ISSUE-112 states it is
  "not a claim that any row identifies the exact historical page". The loader hard-maps every row to
  `sources.key = 'wikipedia'` (`require_source(sources, "wikipedia")`), reloads keyed on
  `(source_id, source_record_id)` scoped to that one source id, and refuses natural-key
  `(season, club_id, player_name_raw, role)` collisions with rows of any other provenance.
- **Row-level page citation precedent.** Fred Phillips (Hawthorn 1933, `resolved`) is a Wikipedia row whose
  `note` names the exact page it came from: "(Wikipedia: Fred Phillips (footballer))". A row taken from a
  Wikipedia player or season page, not a club captain list, is therefore already inside the accepted contract,
  provided the note names the page.
- **Identity.** `player_id` is the bootstrap id, resolved at load through `data/awards/player-identity.csv` →
  AFL Tables profile → `external_identities`. It never matches on a name. All four people S1 touches are in
  the census: Cameron Bruce 747 (`players/C/Cameron_Bruce.html`), Steven May 11940 (`players/S/Steven_May.html`),
  Jarrod Witts 12177 (`players/J/Jarrod_Witts.html`) and James McDonald 730 (`players/J/James_McDonald.html`).
  **No census change.**

### 17.2 Co-captaincy and partial-season support (no schema change needed)

- **Co-captains** are two or more `Captain` rows for one club-season, with the co-captaincy in the free-text
  `period` (GWS "2012–2019 (co-captain)", "2022 (co-captain)"; Melbourne 2012–13 Grimes + Trengove; Sydney
  2011–12 Goodes + McVeigh). Migration 098's column comment records the same convention for
  `club_leadership`: "co-captaincy is two or more concurrent active captain rows".
- **Partial-season captaincy** has no structured column. Migration 098 settles the semantics: "a sustained
  interim captain IS the captain for that period and is an ordinary captain appointment whose note may say so",
  while a one-match stand-in is out of scope. Bruce's 2008 co-captaincy (the remainder of the season after
  Neitz retired) is the sustained shape. It is an ordinary `Captain` row with the partial span in `period`/`note`.
- `ROLES = {"Captain"}`, `KNOWN_CLUBS`, the season span and the 24-club count are all unchanged by S1.

### 17.3 Why May 2017–18 and Bruce 2008 are missing (root cause)

- All the affected club-seasons are **bootstrap rows**: Gold Coast 2017–18 Lynch, Gold Coast 2019–21
  Swallow, Melbourne 2000–08 Neitz. Each carries a single name and the period text of a club captains table.
- The same scrape did carry co-captains wherever the club list's row named them (GWS, Melbourne 2012–13,
  Sydney). The missing names are exactly the ones the club captain list's period rows did not name: a co-captain
  sharing a period (May, Witts), and a mid-season succession inside the outgoing captain's final year
  (Bruce and McDonald, 2008).
- **Root cause: source coverage of the club-list grain.** The family transcribed the broad club captain lists.
  Those lists can omit co-captains and partial-season successors that player pages, season pages and official
  club histories record.
- The scrape itself is not in the repository, so whether the list or the scraper dropped the second name
  cannot be recovered. The fix does not depend on it: S1 adds the missing facts from a cited page, with no
  scraper change.
- This is **not** a builder, linkage, identity or schema defect. `club_captain_any` is correct for its data.

### 17.4 Does the source policy need to widen?

**Not necessarily.** Two compliant routes:

- **Route W (recommended): stay inside `SOURCE_CITATIONS = {"wikipedia"}`.**
  - Each added row must be supported by a specific Wikipedia page (player article, season article or club
    captains list) that the operator reads, with URL, access date and verbatim quote captured.
  - The note names the page, as in the Fred Phillips precedent. The official club or AFL.com.au text goes in
    the same note as corroboration, and the review manifest records both.
  - No loader, `sources` or reload-scope change.
  - Fail-closed: a row whose Wikipedia page does not record the fact is **not** added under `wikipedia`. It
    goes to Route O or stays open.
- **Route O: widen to an official-club citation (contract change, its own decision).** It needs:
  - `SOURCE_CITATIONS += {"club_official"}` and a new `data/reference/sources.json` key;
  - per-row `source_id` in `import_captaincies` (today it is hard-wired to `wikipedia`);
  - `reload_keyed` scoped over both source ids;
  - `_refuse_captaincy_natural_key_collisions` comparing against the owned set (`<> ALL(...)`), not one id;
  - a decision on the batch-level provenance map (`"captaincies": "wikipedia"`, `import_awards.py`);
  - the `afl-api-adjudication.ts` reason string;
  - new `captaincies-source.test.ts` cases.

  This is larger, and only justified if a Wikipedia page cannot be found for a row.

E4 as reported cites only non-Wikipedia sources. **Neither route can run until §23 D1/D3 are decided.** S1 as
designed below assumes Route W.

## 18. S1 design: captaincies repair (data slice, no code-semantics change)

### 18.1 Admission rule (fail-closed, reproducible, never player-specific)

A captaincy row is admitted only when **all** of these hold:

1. A cited source page, read on a recorded date, names the player as **captain or co-captain** of that club
   for that season. A sustained appointment, including the remainder of a season after a predecessor's
   departure, qualifies. Vice-captain, the leadership group and a one-match stand-in do not.
2. The URL, access date and verbatim quote are recorded in the review manifest (§18.3).
3. **Club-season completeness:** for every club-season the cited source covers, **every** captain it names is
   carried, not only the player a Gridley cell implicates. This is what makes the rule independent of Gridley
   and of player ids.
4. The player resolves through the existing identity census to exactly one profile (the loader already fails
   closed otherwise).
5. The row is **additive**. No existing row, `source_key` or `period` is edited.

### 18.2 Rows (subject to §23 D1–D3; the `period` text is taken verbatim from the cited page at implementation)

| season | club | player (bootstrap id) | link | period (illustrative) | note (shape) |
|---|---|---|---|---|---|
| 2017 | Gold Coast | Steven May (11940) | unique | `2017–2018 (co-captain)` | `co-captain with Tom Lynch (Wikipedia: <page>; corroborated: <club/AFL.com.au source>)` |
| 2018 | Gold Coast | Steven May (11940) | unique | `2017–2018 (co-captain)` | as above |
| 2019 | Gold Coast | Jarrod Witts (12177) | unique | `2019–2021 (co-captain)` | `co-captain with David Swallow (…)` |
| 2020 | Gold Coast | Jarrod Witts (12177) | unique | `2019–2021 (co-captain)` | as above |
| 2021 | Gold Coast | Jarrod Witts (12177) | unique | `2019–2021 (co-captain)` | as above |
| 2008 | Melbourne | Cameron Bruce (747) | unique | `2008 (co-captain)` | `co-captain with James McDonald for the remainder of 2008 after David Neitz retired (…)` |
| 2008 | Melbourne | James McDonald (730) | unique | `2008 (co-captain)` | `co-captain with Cameron Bruce for the remainder of 2008 after David Neitz retired (…)` |

- `source_key` = the first 24 hex of SHA-1(`issue225|<club>|<season>|<player>|<period>`), the ISSUE-118
  precedent. Each row is inserted at its sorted position, so the file stays strictly ascending.
- `role` = `Captain`; `source_citation` = `wikipedia` (Route W).
- No natural-key collision: none of the seven `(season, club, player, Captain)` tuples exists.
- The Witts and McDonald rows follow from rule 3. They change no Gridley answer, because both are already
  `club_captain_any` members through their 2022–24 and 2009–10 rows, and neither club-season is a premiership.
  Leaving them out would mean knowingly carrying a club-season that contradicts the very source read to fix it.

### 18.3 File-level changes

| File | Change |
|---|---|
| `data/awards/captaincies.csv` | +7 rows (1,774 → **1,781**), sorted insertion |
| `tools/migration/captaincies.py` | `EXPECTED_TOTAL = 1781`, plus an ISSUE-225 comment beside the Family B one. `MIN/MAX_SEASON`, `EXPECTED_DISTINCT_SEASONS` (130), `KNOWN_CLUBS` / 24, `ROLES` and `SOURCE_CITATIONS` are unchanged (Route W) |
| `tests/captaincies-source.test.ts` | Re-pin 1,774 → 1,781 (`row_count`, `linked_count`, `roles`, key count, the "short of the declared total" case: `got 1780`). `notes_present` 179 → 186. **New case:** the seven ISSUE-225 rows are pinned exactly (season, club, player, bootstrap id, period, note naming a Wikipedia page), and each `source_key` re-derives from the SHA-1 formula |
| `tests/data-overrides-source-contract.test.ts:888` | `'EXPECTED_TOTAL = 1781'` |
| `tools/db/rebuild-test.ts:1209` | `captaincies: 1781` (`tests/db-test-rebuild.test.ts` reads it through `e.captaincies`) |
| `docs/rebuild-manifests/captaincies/issue225-co-captaincy-review-<date>-v1.md` (new) | The review manifest: for each row, the URL, access date and verbatim quote of the Wikipedia page and of the corroborating official source. Precedent: `docs/rebuild-manifests/draftguru/rookie-relisting-independent-review-20260919-v1.md` |

**Not changed:**

- `src/db/migrations/098_club_leadership.sql`. Its comment says "1,774 rows", but it is an applied migration
  and `migrate.ts` refuses an edited applied migration. The stale comment is recorded here instead.
- `src/db/queries/grid-solver.ts` and `src/search/gridley-compat.ts`.
- `player-identity.csv`.
- The schema. No migration.

### 18.4 Load and rebuild implications

- **Load path:** the tracked awards loader's `captaincies` group (`import_awards.py import_captaincies`, reload
  keyed on `(source_id, source_record_id)`). Expected result: 7 inserts, 0 updates, 0 deletes, 0 rejections,
  1,781 rows / 1,781 linked on `afldb_test`.
- **No derived rebuild:** no derived table reads `captaincies`. `club_captain_any` and `premiership_captain`
  read it live.
- A canonical `afldb_test` rebuild picks the rows up from the CSV, with the pin at 1,781.
- **DEV:** the same group reload after the operator merges. DEV had 1,690 of 1,774 linked (the 84-identity
  split). All four S1 people are long-standing AFL Tables identities, but DEV linkage is checked, not assumed.
- **PROD:** out of scope. It needs its own promotion decision.
- **App-visible effect (data, not UI code):** these pages gain the new captaincies:
  - player pages for May, Bruce, Witts and McDonald;
  - Gold Coast and Melbourne club pages;
  - `captain_between_seasons` / `captain_of_club_between_seasons` answers.

  `club_leadership` (2027 and later) is untouched: `MAX_SEASON` stays 2026.

### 18.5 Ordering constraint (S1 alone makes the corpus worse)

Gridley's key **omits Bruce on 26 pre-2026 `captain × X` cells** on the seven pairs E1 shows flipping
(`ME` 6, `disposals30` 5, `2010s` 5, `HW` 4, `clubbestfairest` 3, `games200` 2, `risingStarNomination` 1).
AFLDB's other-axis set contains Bruce on every one of these pairs (the 2026 records lack only `captain`).
Bruce's final season is 2012, so these are **fair comparisons on every horizon, today's `afldb_test` included**.

After S1, each becomes an "AFLDB lists, Gridley omits" `incorrect known answer`. **S1 must not be loaded on
`afldb_test` before S2's Bruce adjudication is in the tree.** Land S1 and S2 as one slice, or S2 first.

**Chronology (later correction; the pass-3 finding above is kept as written).** The 26 cells were what the
original pair analysis had identified at D8. D10 (§24.4, §24.7) later completed the census over the whole
frozen key and proved that S1's full Bruce reverse exposure is **37** cells: 26 original pair-guard cells
plus 11 D10 cells. `#280 0-2` (`captain × clubs2+`) is a separate, informational club-count `list
membership` cell. 26 is therefore not the current figure for S1 alone.

## 19. S2 design: Gridley compatibility adjudication (test-suite only; solver untouched)

Three mechanisms, each one classified explicitly:

### 19.1 Teammates: structural rule, direction- and era-guarded (15 cells; pre-registered in §8)

A known-answer disagreement is classed `list membership` when **all** of these hold:

- Gridley lists the player and AFLDB omits him;
- the lacking axes are exactly `career_teammates_min` (no other lacking axis);
- the player's `final_season ≥ 2001`. Gridley's own text uses played co-membership for seasons ≤ 2000, so a
  career wholly inside that era would be a genuine disagreement.

The reverse direction, a pre-2001-only career, and a mixed lacking set all stay `incorrect known answer`.

**Justification:** Gridley's criterion text counts list co-membership after 2000. AFLDB counts played
co-membership and holds no historical lists (migration 096). For list-grain teammates ⊇ played-grain teammates,
only this direction can arise. E2 and E3 verified the 11 players (counts 88–149, identity = organization grain,
complete rosters, population 3,580/995).

**Detail text:** the finding names the rule and the builder threshold, so the cells stay visible and counted.
Optional, D5: append AFLDB's played-teammate count from a one-off `beforeAll` aggregate (~2 s, the Q2c
shape).

**Code:**

- a pure helper `teammateListMembership(...)` in `tests/gridley-corpus-support.ts`, pinned DB-free;
- one `else if` arm in `gridley-corpus.test.ts` directly after the existing `list membership` arm (`:584`),
  so `time of board` still wins first;
- the `list membership` INFORMATIONAL text extended to name `career_teammates_min` and the post-2000 rule.

### 19.2 Known-answer adjudication record (Swallow, Shiel; and Bruce's reverse cells after S1)

**New tracked file `data/players/gridley-known-answer-adjudications.csv`** (pattern:
`height-adjudications.csv`, `rookie-relisting-outcomes.csv`). Keyed by AFL Tables profile, never by name or a
database id, so it survives a rebuild.

- **Columns:** `afltables_profile, player, gridley_criterion, direction, verdict, afldb_evidence,
  independent_evidence, decided_on, reference`.
  - `direction` ∈ {`gridley_lists`, `gridley_omits`}.
  - `verdict` ∈ {`gridley_key_error`, `gridley_key_inconsistent`}.
  - `(afltables_profile, gridley_criterion, direction)` is unique.
- **`afldb_evidence`** is a canonical fact string the suite **re-derives** from the database. On any mismatch
  the record is STALE and the cell returns to `incorrect known answer`, with "adjudication STALE: …" in the
  detail (the §23.26 staleness pattern).

| profile | criterion | direction | verdict | `afldb_evidence` (re-derived) | independent evidence |
|---|---|---|---|---|---|
| `players/D/David_Swallow.html` | `games250sameclub` | `gridley_lists` | `gridley_key_error` | per-organization games: `gold-coast=249` | AFL Tables 249 all Gold Coast; AFL 2025 Annual Report retirement table 249 (URL, date, quote per D3) |
| `players/D/Dylan_Shiel.html` | `games100clubs2` | `gridley_lists` | `gridley_key_error` | `essendon=99;greater-western-sydney=135` | AFL Tables 135 + 99 = 234; Essendon retirement announcement 99 / 234 |
| `players/C/Cameron_Bruce.html` | `captain` | `gridley_omits` | `gridley_key_inconsistent` | trusted captaincy rows = `Melbourne:2008` exactly | Melbourne FC 2008 co-captaincy; E1: Gridley answers identical `captain × X` pairs both ways (0/37 before 2026, 11/4 in 2026) |

(Organization slugs are illustrative; the implementation uses `club_organizations.slug`. Per-organization
games are derived by the same merged-organization fold the `_incl_merged` builders use.)

**Classification arm** (pure helper `knownAnswerAdjudication(...)` in `gridley-corpus-support.ts`, wired as one
arm in the `incorrect known answer` chain before the height arm). It applies only if:

- a record exists for (player's profile, an axis's Gridley criterion id, this cell's direction);
- that axis is the one in question: for `gridley_lists`, it is among AFLDB's lacking axes; for `gridley_omits`,
  AFLDB lists the player;
- the record is not stale;
- for `gridley_key_inconsistent` only, a **pair guard** holds: Gridley's own key lists this bridged player under
  the same unordered criterion pair on at least one other board.

The pair guard is computed once in `beforeAll` from the answer key. It confines the Bruce record to the pairs
whose other axis Gridley demonstrably accepts for him, so the disagreement can only be about `captain`.

**Category:** new INFORMATIONAL `adjudicated key disagreement`. The detail carries the verdict, the
independent evidence, `decided_on` and `reference`. It is reported and counted, never failed, and never
silent. The header comment (`:23-33`) and the `CellFinding` union gain the category.

### 19.3 What S2 never does

- It never reads a player name or a database id in code.
- It never changes a builder, `compileAxis`, `gridley-compat.ts` or the strict/diagnostic split.
- It never excuses a board because of its year.
- It never excuses a criterion wholesale. The teammates rule is guarded by builder, direction and era. Every
  other excuse needs a tracked, re-derived, evidenced record.

### 19.4 File-level changes

| File | Change |
|---|---|
| `data/players/gridley-known-answer-adjudications.csv` (new) | 3 rows (§19.2) |
| `tests/gridley-known-answer-adjudications.ts` (new, not a test file) | Reader + validation (header, profile regex, enums, evidence ≥ 40 chars, ISO date, `AFLDB-ISSUE-\d{3}` reference, duplicate key); reuses `parseCsv` from `height-adjudications.ts` |
| `tests/gridley-corpus-support.ts` | `teammateListMembership`, `knownAnswerAdjudication`, `adjudicationEvidenceStaleness` (pure) |
| `tests/gridley-compat.test.ts` | DB-free pins (§20) |
| `tests/integration/gridley-corpus.test.ts` | Category + INFORMATIONAL text. `beforeAll`: load the records, resolve them by profile, derive the evidence (per-organization games from `player_clubs`; trusted captaincy rows by club and season) and build the pair-listing index. Two arms. The header comment |

## 20. Test plan

**DB-free (fast, first):**

1. `tests/captaincies-source.test.ts`:
   - re-pinned counts;
   - the seven ISSUE-225 rows exactly;
   - `source_key` re-derivation;
   - the existing ordering, duplicate and natural-key rejections unchanged.
2. `tests/data-overrides-source-contract.test.ts`: `EXPECTED_TOTAL = 1781`; `ROLES` / `MAX_SEASON` pins
   unchanged.
3. `tests/db-test-rebuild.test.ts`: the captaincies expectation flows from `rebuild-test.ts`.
4. `tests/gridley-compat.test.ts`, new cases:
   - **`teammateListMembership`:** fires on (Gridley lists, AFLDB omits, lacking = [`career_teammates_min`],
     final 2009); null for the reverse direction, for final season 2000, for lacking = [`career_teammates_min`,
     `played_for_club`], and for any other builder.
   - **`knownAnswerAdjudication`:**
     - fires for a matching `gridley_key_error` record on its lacking axis;
     - null when stale, for the wrong criterion, the wrong direction, a criterion that is not lacking, or no
       record;
     - `gridley_key_inconsistent` fires only with the pair guard true, and is null with it false.
   - **Staleness:** a changed game count or an extra or missing captaincy row reports STALE.
   - **The tracked CSV:** exactly 3 rows; every row validates; a malformed row is rejected for each rule.

**Integration (operator-run, `afldb_test`):**

5. Gridley corpus, diagnostic, with report (§21 expectations).
6. Optional, if the operator wants it: `tests/integration/awards-reload-links.test.ts` (the awards reload
   ownership/link contract) after the CSV change.

No new test file except the non-test reader module. No assertion is weakened.

## 21. Rebuild and validation plan (each state-changing step needs its own authorisation)

| Step | Where | What proves it |
|---|---|---|
| V0 | — | Operator decisions §23 D1–D9; E4b capture (URLs, dates, verbatim quotes, Wikipedia pages) written into the review manifest |
| V1 | workstation | DB-free vitest on the four suites above; `python tools/migration/captaincies.py` reports `row_count 1781`, `linked_count 1781`, `notes_present 186` |
| V2 | `afldb_test`, **write** | `captaincies` group reload: 7 inserted; 1,774 existing keyed rows rewritten in place by `reload_keyed` (reported as `updated`; reconciliation, not factual change); 0 deleted; 0 rejected; then read-only: 1,781 rows, 1,781 trusted; Bruce, May, Witts and McDonald rows present and trusted; `club_captain_any` eligible count **+2** exactly |
| V3 | `afldb_test` (horizon 2025), read | Diagnostic corpus with report. **Expected:**<br>• the 20 captain census cells give no finding; the 17 teammate, Swallow and Shiel census cells stay `time of board`;<br>• `time of board` falls by those 20 plus May's other `captain` cells that now agree (E1: up to 24 pre-2026). The exact delta is read from the report, and every cell that leaves must be a May or Bruce `captain` cell;<br>• **37 Bruce reverse cells classified `adjudicated key disagreement`** (`gridley_key_inconsistent`): the 26 original pair-guard cells plus the 11 D10 cells (§24.4, §24.7), plus the one expected `list membership` club-count cell (#280 0-2);<br>• `incorrect known answer` **0**;<br>• every other category unchanged |
| V4 | `afldb_dev`, read (D7/D11), after V5 | **Read-only ISSUE-225 DEV acceptance probe** (`tools/validation/issue225-dev-acceptance-probe.ts`, §24.6), **not** the diagnostic corpus. **Expected (exit 0, `PASS`):**<br>• `captain census`: `agreement` 20;<br>• `teammate census`: `adjudicated key disagreement` 15;<br>• `games census`: `adjudicated key disagreement` 2;<br>• `bruce reverse`: `adjudicated key disagreement` 37, `list membership` 1, `agreement` 126;<br>• `incorrect known answer` 0;<br>• all three tracked adjudication records `current` |
| V5 | DEV, after the operator merges | `captaincies` reload; read-only count and links; smoke the Bruce, May, Witts and McDonald player pages, plus the Gold Coast and Melbourne club pages (data-only change; the page code is untouched, so no visual capture is required, but the operator eyeballs it) |

**Pre-registered stop conditions for V3/V4 (no reclassification is improvised):**

- **Bruce `captain × grandfinals1`** (pre-2026 #289, #548, #766; 2026 #938, #988). Gridley never lists this
  pair for him, so the pair guard does not apply. If AFLDB's `grandfinals1` set contains Bruce, these 5 cells
  surface as `incorrect known answer`. That is a separate Grand Final fact question, not a captaincy one. Stop
  and record.
- **Bruce `captain × allAus1953` / `premier1x`.** Expected agreement: no All-Australian row in
  `all-australian.csv`; no premiership is expected. Any finding means stop.
- **Any other new `captain` reverse cell**, including May, Witts, McDonald or a `Y` outside E1's probe list,
  that the pair guard does not cover means stop.
- **Any `adjudicated key disagreement` outside the three records, or any STALE record**, means stop.
- **Any change outside the expected deltas** means stop.

## 22. Interaction summary (what each slice changes, and what it must never change)

| | S1 data | S2 suite |
|---|---|---|
| Changes | `captaincies.csv` +7, loader pin, 3 test pins, rebuild pin, review manifest | 1 tracked CSV, 1 reader, 3 pure helpers, 2 arms, 1 category |
| Never | Builders, schema, migrations, `player-identity.csv`, `SOURCE_CITATIONS` (Route W) | `grid-solver.ts`, `gridley-compat.ts`, `career_teammates_min`, `club_captain_any`, strict/diagnostic split, a year-based excuse |
| `CHANGELOG.md` | At resolution (captaincies data behaviour changes) | At resolution (corpus classification) |

## 23. Decisions requiring operator approval

| Id | Decision | Recommendation |
|---|---|---|
| **D1** | Captaincy source route: Route W (stay `wikipedia`, cite the exact page in `note`) or Route O (widen `SOURCE_CITATIONS` to an official-club source; loader, `sources.json`, reload scope and collision guard change) | **W.** O only for a row no Wikipedia page supports |
| **D2** | Club-season completeness: carry Witts 2019–21 and McDonald 2008 together with May and Bruce | **Yes.** Rule 3. Zero Gridley effect; avoids Gridley-driven curation |
| **D3** | E4 provenance: capture URL, access date and verbatim quote for every source (club, AFL.com.au, AFL Tables, Annual Report, Essendon) and the Wikipedia page per S1 row (E4b, network) before any tracked file is written | **Required.** It is fail-closed |
| **D4** | Bruce's reverse cells after S1: a tracked `gridley_key_inconsistent` record with the pair guard, or a generic structural `club_captain_any` reverse arm | **Tracked record.** A generic arm would pre-excuse future linkage errors |
| **D5** | Teammates: the structural direction/era-guarded rule (§19.1, pre-registered §8), or per-player records; and whether to append the played-teammate count to the detail | **Structural rule, with the count appended** |
| **D6** | New INFORMATIONAL category `adjudicated key disagreement`, or reuse `external source disagreement` | **New category.** The mechanism differs from the §23.19/§23.23 uses |
| **D7** | The 2026-horizon database for V4. Today's `afldb_test` ends 2025; the 2026-09-19 census came from a 2026-carrying `afldb_test`. DEV is not evidence for semantics | Continue `afldb_test` with 2026 under the ISSUE-230 clock rules, under its own authorisation; or accept V3 plus the 2026-09-19 census as closure evidence |
| **D8** | Slice shape: S1 + S2 as one implementation slice | **One slice.** §18.5: at D8, the original pair analysis had identified 26 Bruce reverse cells that S1 alone would fail. D10 later completed the census: S1's full Bruce reverse exposure is 37 (26 pair-guard + 11 D10), plus the separate informational `list membership` cell `#280 0-2` |
| **D9** | Leave the existing Lynch 2017–18, Swallow 2019–21 and Neitz 2000–08 `period` text unedited (additive only) | **Yes.** It preserves the bootstrap `source_key`s and the reload ownership |

**Operator decisions, 2026-10-01: D1–D9 approved as recommended**, with these specifics:

- **D3:** access date 2026-10-01. W1 is the Gold Coast captains list and W2 the 2008 Melbourne season page,
  plus the club corroboration.
- **D5:** teammates use the general rule, guarded exactly as §19.1. AFLDB's computed teammate count goes in
  the detail. No player-id exceptions.
- **D6:** the new informational category covers the adjudicated Gridley compatibility differences.
- **D7:** 2026-horizon validation runs on DEV, after DB-free validation and the `afldb_test` 2025 rehearsal,
  as one guarded operator phase. Claude does not mutate DEV.

Swallow and Shiel adjudication evidence was supplied by the operator, with AFL Tables re-read in pass 4
(§24.1).

| Id | Decision (operator, 2026-10-01, after pass 4) |
|---|---|
| **D10** | **Approved, Bruce-record-specific.** A reverse-direction Bruce `captain × X` disagreement is adjudicated only when **all** hold: (1) AFLDB proves his trusted captaincy, through the record's current `trusted_captaincies` evidence; (2) Gridley omits him from the cell; (3) AFLDB satisfies X; (4) the frozen Gridley key independently lists him under that exact X elsewhere in the corpus; (5) the record is not stale. Not a general captain rule: no generic "AFLDB lists captain / Gridley omits" exception, and no criterion Gridley never accepts for him. Pins required: old pair coverage 26, additional 11, total 37; a never-accepted X stays unadjudicated; stale evidence fails closed; unrelated players cannot use it. The five `captain × grandfinals1` cells are re-evaluated, not special-cased |
| **D11** | **A separate read-only DEV acceptance probe.** No weakening of `tests/setup.ts`, no pointing the writable corpus suite at `afldb_dev`, no extending `afldb_test` into 2026 for this issue, and no override around the `_test` guard. V3 stays the full diagnostic corpus on `afldb_test` (horizon 2025) and must reach 0 `incorrect known answer`. The probe is not a second corpus runner. It: refuses unless `afldb_dev`; runs read-only (`BEGIN READ ONLY` … `ROLLBACK`); has no setup or writes; reuses the adjudication reader and helpers; evaluates exactly the ISSUE-225 population; verifies the three records are current and the teammate guard carries AFLDB's count; reports counts by category; and fails non-zero on any `incorrect known answer`, stale record, unexpected cell, missing census cell, or Bruce reverse cell outside the D10 rule |

## 24. Pass 4: S1+S2 implementation (2026-10-01)

### 24.1 Source verification before coding (D3)

**Wikipedia, both pages read as raw wikitext on 2026-10-01. Every approved row is supported, and no row is
halted:**

- **W1** `List of Gold Coast Suns captains` (revision 1365013852): the table rows `2017–2018` {efn
  "Co-captains"} Tom Lynch / Steven May and `2019–2021` {efn "Co-captains"} David Swallow / Jarrod Witts.
- **W2** `2008 Melbourne Football Club season` (revision 1369103444):
  - infobox captains "David Neitz … (rounds 1–5)", "James McDonald … (rounds 6–22)", "Cameron Bruce …
    (rounds 6–22)";
  - prose: "For the remainder of the year, the captaincy was shared between Cameron Bruce and James
    McDonald".

**Corroboration:**

- Gold Coast SUNS 2018 leadership article: "Tom Lynch & Steven May will once again captain the club in 2018".
- The SUNS captaincy history panel: Lynch & May 2017–2018; Swallow & Witts 2019–2021.
- Melbourne FC, Bruce retirement article: "stepped up as co-acting captain with James McDonald". The same
  article's "vice-captain under McDonald in 2008" reads as a slip for 2009; it is recorded in the manifest.

**Provenance convention verified:**

- 399 existing rows re-derive exactly from SHA-1(`issue118|club|season|player|period`)[:24].
- 179 rows carry a note.
- The Fred Phillips row names its Wikipedia page in `note`.

**Additional checks (AFL Tables, 2026-10-01):**

- Swallow: 249 games, all Gold Coast, 2011–2025.
- Shiel: GWS 135 + Essendon 99 = 234.
- Bruce has no Grand Final row, so the §21 `captain × grandfinals1` stop pair is not expected to fire.

### 24.2 What was built

**S1 (data):**

- `data/awards/captaincies.csv` gains 7 rows at their sorted positions (1,774 → 1,781). `source_key` is
  SHA-1(`issue225|club|season|player|period`)[:24].
  - **Period:** May `2017–2018 (co-captain)`, Witts `2019–2021 (co-captain)`, Bruce and McDonald
    `2008 (co-captain, rounds 6–22)`.
  - **Note:** names the co-captain, the Wikipedia page and the corroboration.
- `captaincies.py` `EXPECTED_TOTAL = 1781`, with an ISSUE-225 comment.
- `rebuild-test.ts` `captaincies: 1781`.
- `data-overrides-source-contract.test.ts` `EXPECTED_TOTAL = 1781`.
- `captaincies-source.test.ts`:
  - re-pins 1,781 rows, 1,781 linked, 186 notes, and "got 1780";
  - one new case pins the seven rows exactly, re-derives every key, and asserts the Lynch, Swallow and Neitz
    bootstrap rows are untouched.
- Review manifest `docs/rebuild-manifests/captaincies/issue225-co-captaincy-review-20261001-v1.md`.

**S2 (suite only):**

- **`data/players/gridley-known-answer-adjudications.csv`:** 3 records, keyed by AFL Tables profile.

  | Player | Criterion | Direction / verdict | `afldb_evidence` |
  |---|---|---|---|
  | Bruce | `captain` | `gridley_omits` / `gridley_key_inconsistent` | `trusted_captaincies:Melbourne=2008` |
  | Swallow | `games250sameclub` | `gridley_lists` / `gridley_key_error` | `organization_games:gold-coast=249` |
  | Shiel | `games100clubs2` | `gridley_lists` / `gridley_key_error` | `organization_games:essendon=99;greater-western-sydney=135` |

- **`tests/gridley-known-answer-adjudications.ts`:** the reader. It validates:
  - the header and field count;
  - the profile path;
  - a criterion → evidence-kind registry, so a criterion with no declared kind is refused;
  - the direction and verdict enums;
  - the allowed (direction, verdict) shape;
  - a unique key;
  - sorted, distinct evidence tokens;
  - evidence of at least 40 characters;
  - an ISO date and an `AFLDB-ISSUE-NNN` reference.
- **`tests/gridley-corpus-support.ts`** (pure functions):
  - `teammateListMembership`;
  - `knownAnswerEvidence` / `knownAnswerEvidenceStaleness`;
  - `criterionPairKey`, `buildPairListingIndex`, `pairListedElsewhere`;
  - `knownAnswerAdjudication`.
- **`tests/integration/gridley-corpus.test.ts`:**
  - a new INFORMATIONAL category `adjudicated key disagreement`, added to the header and the `CellFinding`
    union;
  - in `beforeAll`:
    - the pair index over the bridged players;
    - played-teammate counts for bridged players, at the builder's own grain;
    - the per-organization games (the `mergedOrgExpr` fold) and the trusted captaincies of the adjudicated
      players;
    - staleness per record, logged and written to the report as `knownAnswerAdjudications`;
  - two arms:
    - teammates, directly after the existing `list membership` arm;
    - the known-answer adjudication, after the brothers arm and before the height arm. A STALE record stays
      `incorrect known answer` with "is STALE: …" in the detail.
- **`tests/gridley-compat.test.ts`:** a new describe block with 15 cases (§24.5).

**Untouched:**

- `grid-solver.ts`, `gridley-compat.ts`, `career_teammates_min`, `club_captain_any`;
- the strict/diagnostic split;
- migration 098 (its "1,774 rows" comment is now historical) and the schema;
- `player-identity.csv`, `SOURCE_CITATIONS`;
- `CHANGELOG.md`.

### 24.3 Deviations from §16–§21 (each tightens, or follows an explicit operator instruction)

1. **Teammates are `adjudicated key disagreement`, not `list membership`.** This follows the operator's D6
   instruction and stated outcome: the teammate, Swallow and Shiel cells all sit under the new informational
   classification. The guards are exactly §19.1. The `list membership` INFORMATIONAL text is therefore *not*
   extended (§19.1 "Code" bullet 3 dropped), and no existing `list membership` cell can move.
2. **A `gridley_lists` record applies only when its criterion is the *only* lacking axis.** §19.2 said
   "among". With a second lacking axis, the other axis is a separate disagreement the record cannot explain.
3. **The reader admits exactly two shapes:** `gridley_lists` + `gridley_key_error`, and `gridley_omits` +
   `gridley_key_inconsistent`. A "Gridley omits" cell cannot say which axis the key rejects, so every omits
   record carries the pair guard.
4. **`afldb_evidence` is prefixed by its evidence kind** (`organization_games:` / `trusted_captaincies:`),
   and the kind is bound to the criterion in the reader. Captaincies use `clubs.name=season`, per §19.2.
5. **The played-teammate count is computed for bridged players only.** It is diagnostic detail, not a guard
   (D5).
6. **Melbourne `period` carries W2's "rounds 6–22"**, beyond §18.2's illustrative `2008 (co-captain)`.

### 24.4 Material finding: the approved pair guard leaves 11 pre-2026 Bruce cells uncovered (D10, decided)

§18.5 counted the Bruce reverse cells only on the seven `KEY CHANGED` pairs. The answer key read in full
(DB-free, the same fixture E1 reads) shows a wider pattern:

- Gridley lists Bruce on 0 of 144 pre-2026 `captain` cells, and on 11 of 33 in 2026.
- The pair guard admits **exactly the designed 26** (pinned DB-free: ME 6, disposals30 5, 2010s 5, HW 4,
  clubbestfairest 3, games200 2, risingStarNomination 1; all pre-2026; none for May).

**12 further pre-2026 cells pair `captain` with a criterion Gridley does list Bruce under on another
board:**

| Board | Cell | Other criterion |
|---:|---|---|
| 148 | 0-2 | 2000s |
| 409 | 0-2 | 2000s |
| 469 | 2-2 | 2000s |
| 192 | 0-1 | games150 |
| 192 | 0-2 | finalswins1 |
| 205 | 2-2 | disposalsClubLeader |
| 246 | 0-2 | goals1avgseason |
| 549 | 0-2 | goals1avgseason |
| 826 | 0-2 | goals1avgseason |
| 280 | 0-2 | clubs2+ |
| 280 | 1-2 | coachedByClarkson |
| 620 | 0-2 | brownlow10votes |

- Bruce's career (1997–2012, Melbourne and Hawthorn, 266 games) makes AFLDB's other-axis set almost
  certainly contain him on most of these.
- After S1, each such cell is an "AFLDB lists, Gridley omits" reverse disagreement that the approved pair
  guard does not cover.
- `clubs2+` is absorbed by the existing club-count `list membership` arm. **The other 11 would score
  `incorrect known answer`, and V3 would fail** (that category fails in both modes). This is §21's
  pre-registered stop condition "any other new captain reverse cell … that the pair guard does not cover".
- No 2026 cell has this shape. Every unguarded 2026 Bruce omission is on a criterion Gridley never lists him
  under: a genuine other-axis question if AFLDB lists him, which is correctly left visible.

**D10 decided 2026-10-01 (§23): implemented in pass 5 (§24.7).** The rule is the criterion-level acceptance
guard, held to Bruce's record alone. It covers the 26 pair cells and the 11 above. `#280 0-2` (`clubs2+`) stays with
the existing club-count `list membership` arm.

### 24.5 Validation run in pass 4 (DB-free only; authorised for this task)

| Check | Result |
|---|---|
| `python tools/migration/captaincies.py` | `ok`, `row_count` 1781, `linked_count` 1781, `unlinked_count` 0, `notes_present` 186, 130 seasons, 24 clubs |
| `npx vitest run tests/gridley-compat.test.ts tests/captaincies-source.test.ts tests/data-overrides-source-contract.test.ts tests/db-test-rebuild.test.ts` | **4 files, 666/666 passed** |
| `npx tsc --noEmit -p tsconfig.json` (covers `tests/integration/gridley-corpus.test.ts`) | clean |
| `npx eslint` on the five changed TypeScript files | 0 errors; 1 pre-existing warning (`VALID_ROW_2` unused, `captaincies-source.test.ts`) |

*Historical pass-4 run by Claude. Superseded as current evidence by the operator's final validation (§24.9).
The eslint row covered only the files named then. The complete changed-surface lint in §24.9 also reports the
pre-existing `tools/db/rebuild-test.ts` error and warning.*

The new DB-free cases in `gridley-compat.test.ts`:

- **Tracked CSV:** exactly 3 records, plus a rejection per malformed shape.
- **Teammates rule:** fires on the guarded shape; null for the reverse direction, final season 2000, null
  final season, a mixed lacking set, and another builder.
- **Staleness:** current for each record. STALE for 250 games, Essendon 100, an extra or missing
  organization, no captaincy row, or an extra Hawthorn row.
- **Adjudication arm:**
  - fires for Swallow and Shiel;
  - null for no record, another criterion, the other direction, a non-lacking criterion, or a mixed lacking
    set;
  - a STALE record is reported stale;
  - Bruce applies only under the pair guard.
- **Census on the real key:**
  - the 20 captain cells are key-listed `captain` cells, and the CSV carries Bruce 747 and May 11940;
  - the 15 teammate cells classify with their E2 counts;
  - Swallow (938 0-1) and Shiel (967 0-2) sit on their records' criteria.
- **Pair guard on the real key:**
  - exactly the 26 cells by pair;
  - controls: `grandfinals1`, `allAus1953`, `premier1x`, `2000s`, `games150` and `coachedByClarkson` are
    never covered;
  - May gets none;
  - a board's own listing never satisfies its own guard.

**Not run (needs a database; §24.6):** the corpus suite itself, the captaincies reload, and
`awards-reload-links`.

**Environment note:** the worktree had no `node_modules`. It is a junction to
`D:\dev\afldb-issue-233\node_modules`, whose `package-lock.json` hash is identical; it is gitignored. The
worktree has no `.env`.

### 24.6 Operator commands (prepared; Claude ran none of them)

PowerShell, from the worktree root, with the `afldb_test` tunnel up. Python needs `psycopg`; use the
interpreter the earlier awards reloads used. `$testImport` is the importer-role DSN for `afldb_test`: your
`AFLDB_IMPORT_DATABASE_URL` with the database name swapped to `afldb_test`. Keep it in the session only.

**V2 — `afldb_test` captaincies reload (WRITE; own authorisation):**

```powershell
$testImport = '<afldb_import DSN, database afldb_test>'
$env:PGOPTIONS = '-c default_transaction_read_only=on'
psql -X -v ON_ERROR_STOP=1 -v expect_db=afldb_test -f issues/closed/AFLDB-ISSUE-225-s1-captaincies-checks.sql -d $testImport | Out-File -Encoding utf8 D:\tmp\issue225\v2-before.txt
Remove-Item Env:PGOPTIONS
$env:AFLDB_IMPORT_DATABASE_URL = $testImport
python tools/migration/import_awards.py --groups captaincies --dry-run
python tools/migration/import_awards.py --groups captaincies 2>&1 | Out-File -Encoding utf8 D:\tmp\issue225\v2-reload.txt
Remove-Item Env:AFLDB_IMPORT_DATABASE_URL
$env:PGOPTIONS = '-c default_transaction_read_only=on'
psql -X -v ON_ERROR_STOP=1 -v expect_db=afldb_test -f issues/closed/AFLDB-ISSUE-225-s1-captaincies-checks.sql -d $testImport | Out-File -Encoding utf8 D:\tmp\issue225\v2-after.txt
Remove-Item Env:PGOPTIONS
```

- The reload prints its target first; stop if it is not `afldb_test`.
- `AFLDB_LEGACY_SQLITE` stays unset (captaincies is legacy-free).

**Expected:**

- before: 1774 / 1774, and R is empty;
- reload: 7 inserted; 1,774 existing keyed rows rewritten in place by `reload_keyed` (reported as
  `updated`; reconciliation, not factual change); 0 deleted; 0 rejected;
- after: 1781 / 1781;
- P = before + 2;
- R shows seven trusted `wikipedia` rows, each linked to the profile in the manifest;
- C: Gold Coast 2017–18 Lynch + May, 2019–21 Swallow + Witts, Melbourne 2008 Neitz + Bruce + McDonald.

**Rollback**, if wanted: re-run the same reload from a checkout without the seven rows. `reload_keyed` deletes
the vanished keys inside the `wikipedia` scope.

**V3 — `afldb_test` diagnostic corpus (read-only, ~15 min), after V2:**

```powershell
$env:AFLDB_TEST_DATABASE_URL = '<afldb_test DSN>'
$env:AFLDB_GRIDLEY_DIAGNOSTIC = '1'
$env:AFLDB_GRIDLEY_REPORT = 'D:\tmp\issue225\v3-gridley-corpus.json'
npx vitest run tests/integration/gridley-corpus.test.ts 2>&1 | Out-File -Encoding utf8 D:\tmp\issue225\v3-gridley-corpus.txt
"exit=$LASTEXITCODE"
Remove-Item Env:AFLDB_GRIDLEY_DIAGNOSTIC; Remove-Item Env:AFLDB_GRIDLEY_REPORT
```

**Expected, horizon 2025:**

- the log line `known-answer adjudications` shows all three records `current`;
- **`incorrect known answer` 0**; the run passes;
- **37 `adjudicated key disagreement` Bruce `captain` cells, all `gridley_key_inconsistent`, all pre-2026**, each
  detail naming its D10 guard:
  - 26 on the §18.5 pairs (ME 6, disposals30 5, 2010s 5, HW 4, clubbestfairest 3, games200 2,
    risingStarNomination 1);
  - 11 under D10 (2000s 3, goals1avgseason 3, games150, finalswins1, disposalsClubLeader, coachedByClarkson,
    brownlow10votes).

  Fewer than 37 means AFLDB omits Bruce on an axis the key accepts for him. That is not a V3 failure, but it is
  recorded and stops the DEV phase, because the probe would report it as a missing cell;
- `list membership` +1: `#280 0-2` Bruce `captain × clubs2+`, the club-count arm;
- no teammate, Swallow or Shiel adjudication. Those cells are 2026 boards and stay `time of board`;
- `time of board`:
  - every cell that leaves it is a May or Bruce `captain` cell (the 20 census cells and others that now
    agree);
  - every cell that joins it is a Bruce `captain` cell on a 2026 board;
- every other category unchanged against the pre-change run.

Any STALE record, any adjudication outside the three records, or any other new cell: **stop** (§21).

**DEV phase (D7/D11). Only after V2 and V3 pass and the operator merges: V5, then V4.**

**V5 — DEV captaincies reload (writes DEV `captaincies` only).** Run on the DEV host checkout or over the DEV
tunnel, with the DEV importer DSN.

```powershell
$devImport = '<afldb_import DSN, database afldb_dev>'
$env:PGOPTIONS = '-c default_transaction_read_only=on'
psql -X -v ON_ERROR_STOP=1 -v expect_db=afldb_dev -f issues/closed/AFLDB-ISSUE-225-s1-captaincies-checks.sql -d $devImport | Out-File -Encoding utf8 D:\tmp\issue225\v5-before.txt
Remove-Item Env:PGOPTIONS
$env:AFLDB_IMPORT_DATABASE_URL = $devImport
python tools/migration/import_awards.py --groups captaincies 2>&1 | Out-File -Encoding utf8 D:\tmp\issue225\v5-reload.txt
Remove-Item Env:AFLDB_IMPORT_DATABASE_URL
$env:PGOPTIONS = '-c default_transaction_read_only=on'
psql -X -v ON_ERROR_STOP=1 -v expect_db=afldb_dev -f issues/closed/AFLDB-ISSUE-225-s1-captaincies-checks.sql -d $devImport | Out-File -Encoding utf8 D:\tmp\issue225\v5-after.txt
Remove-Item Env:PGOPTIONS
```

**Expected V5 result:** the DEV reload inserts 7. DEV trusted equals its own before + 7, but only if all four
people resolve. DEV had 84 unlinked of 1,774, so the linkage is checked, not assumed. Then smoke the May,
Bruce, Witts and McDonald player pages and the Gold Coast and Melbourne club pages.

**V4 — read-only ISSUE-225 DEV acceptance probe (D11), after V5.** This is not the corpus suite. The probe
is `tools/validation/issue225-dev-acceptance-probe.ts`.

```powershell
$env:AFLDB_ISSUE225_PROBE_DATABASE_URL = $devImport   # any DSN naming afldb_dev; the import role reads sources/external_identities
$env:AFLDB_STATEMENT_TIMEOUT_MS = '30000'               # the app client's 5 s default is tight over a tunnel
npx tsx --conditions=react-server tools/validation/issue225-dev-acceptance-probe.ts --report D:\tmp\issue225\v4-dev-probe.json 2>&1 | Out-File -Encoding utf8 D:\tmp\issue225\v4-dev-probe.txt
"exit=$LASTEXITCODE"
Remove-Item Env:AFLDB_ISSUE225_PROBE_DATABASE_URL; Remove-Item Env:AFLDB_STATEMENT_TIMEOUT_MS
```

The probe refuses (exit 2) before connecting:

- unless the DSN names `afldb_dev`;
- if the `--report` file already exists.

It then runs every statement inside `BEGIN READ ONLY`, proves `current_database() = afldb_dev` and
`transaction_read_only = on` first, and always ends in `ROLLBACK`.

**Expected V4 result (exit 0, `PASS`):**

| Group | Expected counts |
|---|---|
| `captain census` | `{"agreement":20}` |
| `teammate census` | `{"adjudicated key disagreement":15}`, each detail carrying AFLDB's count, printed per player (E2/E3: 88–149; Tucker 146) |
| `games census` | `{"adjudicated key disagreement":2}` (Swallow, Shiel) |
| `bruce reverse` | `{"adjudicated key disagreement":37,"list membership":1,"agreement":126}` |

- Excluded: `season2024player` ×2 (unsupported).
- Adjudications: all three `current`.

**Pre-registered failure reading:** the probe exits 1 on any of:

- `incorrect known answer`;
- an unexpected cell (an expected agreement that is not one);
- an expected cell missing;
- a STALE or unresolved record;
- a teammate detail without the count;
- an unbridged or unmapped criterion.

The most likely real-data trigger is a Bruce `captain × X` cell on a **2026** board. The 22 such omissions are
fair comparisons at a 2026 horizon (V3 treats them as `time of board`), and the key never accepts him for any
of their X. If AFLDB lists him on one (for example `finalswins5`), that is a genuine other-axis question,
outside D10: **stop and record, never widen the rule**.

### 24.7 Pass 5: D10 and D11 implementation (2026-10-01)

**D10 (Bruce-record-specific):**

- `knownAnswerAdjudication` (`tests/gridley-corpus-support.ts`) takes a `gridleyListsElsewhere(criterion)`
  predicate instead of the pair flag. A `gridley_key_inconsistent` record applies only when:
  - AFLDB lists the player on both axes;
  - the cell has exactly one other criterion X;
  - the frozen key lists the player under X in another cell;
  - the record is not stale.
- The guard asks about the other criterion, never the record's own. A player with no record is never
  adjudicated.
- The reader already restricts `gridley_key_inconsistent` to `gridley_omits`, and the tracked CSV holds it for
  one profile only (`players/C/Cameron_Bruce.html`; pinned).
- The pair helpers are replaced by `buildCriterionListingIndex` / `criterionListedElsewhere`.
- The corpus suite builds that index for the bridged players. Its INFORMATIONAL text and the Bruce record's
  `independent_evidence`/`reference` describe the D10 guard. The record's `afldb_evidence` is unchanged.
- `buildCoachResolver` and the two `list membership` builder regexes moved into the support module and are
  shared. Behaviour is unchanged.

**DB-free pins on the frozen key** (`tests/gridley-compat.test.ts`):

- Bruce has 177 captain cells: 11 listed, all 2026; 166 omitted, 144 of them before 2026.
- The old pair guard covers **26**, by pair.
- The D10 rule adds 12: one is `#280 0-2 clubs2+`, taken by the club-count arm, and **11** are adjudications.
- **Total intended adjudications: 37, all pre-2026.**
- These Xs are never accepted, so they stay unadjudicated: `grandfinals1`, `allAus1953`, `premier1x`,
  `finals10`, `finalswins5`, `tackles10match`.
- Stale Bruce captaincy evidence returns `stale` and classifies `incorrect known answer`.
- A player without a record is never adjudicated.

**`captain × grandfinals1` re-evaluated, not special-cased:**

- The frozen key lists Bruce under `grandfinals1` nowhere.
- The five cells are #289, #548, #766, #938 and #988.
- D10 therefore never covers them.
- AFL Tables shows no Grand Final for Bruce, so AFLDB's `played_a_grand_final` should omit him and the cells
  stay agreements. If AFLDB listed him, they would surface as `incorrect known answer` (V3 for the three
  pre-2026 cells, V4 for all five).

**D11, the read-only DEV acceptance probe:**

- `tests/issue225-acceptance.ts` (pure, shared):
  - the census constants;
  - `issue225Population`, the exact population, each cell with its one passing classification;
  - `classifyIssue225Cell`, which mirrors the corpus chain order through the shared helpers and fails closed
    on any builder whose arm it does not mirror.
- The population's Bruce cells are every `captain` cell whose key omits him: 164 evaluable, 2 unsupported
  excluded. Each is expected as:
  - `adjudicated key disagreement` where D10 condition 4 holds (37);
  - `list membership` for the club-count cell (1);
  - agreement otherwise (126).
- A census cell that is no longer key-listed throws "expected ISSUE-225 cell missing".
- `tools/validation/issue225-dev-acceptance-probe.ts` (CLI):
  - DSN and argument checks before any connection;
  - `@/db/client` imported only after `DATABASE_URL` is set to the checked DSN;
  - one `sql.begin('read only')` transaction, whose first statement proves `afldb_dev` and read-only;
  - lookups and the production `compileAxis`, restricted to the bridged ISSUE-225 players;
  - teammate counts at the builder's grain;
  - record staleness by profile;
  - classification, then a forced `ROLLBACK`;
  - counts by group and category, the failures named, an optional `--report` JSON (refuses to overwrite);
  - exit 0 / 1 / 2.

**DB-free validation (pass 5):**

| Check | Result |
|---|---|
| vitest: `gridley-compat`, `captaincies-source`, `data-overrides-source-contract`, `db-test-rebuild` | **4 files, 672/672 passed** |
| `npx tsc --noEmit -p tsconfig.json` (covers the probe, the shared module and the corpus suite) | clean |
| `npx eslint` on the seven changed TypeScript files | 0 errors; 1 pre-existing warning (`VALID_ROW_2`) |
| Probe refusal paths (no connection) | no DSN: exit 2; a DSN naming `afldb_test`: exit 2; unknown argument: exit 2 |
| Probe import chain, against a closed local port | modules load under `--conditions=react-server`; `ECONNREFUSED`, exit 1; no database contacted |

*Historical pass-5 run by Claude. The vitest, tsc and eslint rows are superseded as current evidence by the
operator's final validation (§24.9). In particular, "eslint 0 errors" held only for the files linted then. The
complete changed-surface lint finds one pre-existing error in `tools/db/rebuild-test.ts`.*

**Deviations:**

- The D10 rule is expressed through the record's verdict (`gridley_key_inconsistent`), which only the Bruce
  record carries and the reader binds to `gridley_omits`. No code names a player.
- The probe's expected Bruce population is derived from the frozen key: D10 condition 4 decides "adjudicated"
  versus "agreement". It is strict both ways, so AFLDB disagreeing with the key's acceptance of Bruce for any X
  fails the probe.
- The probe classifies with a mirrored subset of the corpus chain, not the corpus suite itself. Arms it does
  not mirror fail closed.

### 24.8 V2 and V3 evidence (operator-run; accepted PASS)

**V2 — `afldb_test` captaincies reload: PASS.**

| Check | Result |
|---|---|
| Target | `afldb_test` |
| `captaincies` rows | 1,774 → 1,781 |
| trusted | 1,774 → 1,781 |
| `club_captain_any` eligible | 589 → 591 (+2) |
| Import batch | 495 |
| `records_read` / inserted / updated / rejected | 1,781 / 7 / 1,774 / 0 |
| ISSUE-225 rows | all seven present and correctly linked |

**Updated-count semantics.** `import_captaincies()` calls `reload_keyed()`, keyed on
`(source_id, source_record_id)`. `reload_keyed()` UPDATEs every matching in-scope existing row, with no
value-difference guard, and `stats.updated` is that UPDATE's rowcount. So `records_updated` 1,774 means 1,774
existing keyed rows were rewritten in place (reconciliation). It does not mean 1,774 captaincy facts changed.
The source CSV change was strictly additive, and the post-check proves 1,781 rows, so 0 old source keys were
deleted. The original §21/§24.6 expectation of "0 updated" was wrong and is corrected there.

**V3 — `afldb_test` diagnostic corpus, horizon `maxSeason=2025`: PASS.**

| Check | Result |
|---|---|
| Tests | 1,205/1,205 passed; exit 0 |
| Adjudication records | all three `current` |
| Bruce `adjudicated key disagreement` | 37 |
| Bruce `list membership` | +1 (`#280 0-2`, club-count arm) |
| Teammate, Swallow and Shiel cells | remain `time of board` |
| `incorrect known answer` | 0 |

V3 is diagnostic evidence only; it is not the DEV acceptance probe (V4). No pre-S1 report comparison was
performed, so the "every other category unchanged" expectation (§21, §24.6) is not evidenced either way.

### 24.9 Final operator validation of the repository surface (operator-run; accepted)

This is the current DB-free evidence. It supersedes the pass-4/pass-5 tables in §24.5 and §24.7.

| Check | Result |
|---|---|
| `git diff --check` | PASS. LF→CRLF notices for `tests/captaincies-source.test.ts` and `tools/migration/captaincies.py` were warnings only |
| Forbidden paths | PASS. Untouched: `src/db/queries/grid-solver.ts`, `src/search/gridley-compat.ts`, `tests/setup.ts`, migrations, `CHANGELOG.md` |
| DB-free focused tests | The command named `tests/captaincies-source.test.ts`, `tests/data-overrides-source-contract.test.ts`, `tests/gridley-compat.test.ts` and `tests/issue225-acceptance.ts`. Vitest collected **3 files**, because `tests/issue225-acceptance.ts` is a support/core module, not a `*.test.ts` suite. **3 files passed, 144/144 tests** |
| `npm run typecheck` | PASS: `next typegen` and `tsc --noEmit` both succeeded |
| `npm run lint` (full repository) | **FAIL on the pre-existing repository baseline**: 390 problems (257 errors, 133 warnings). Not clean |
| ISSUE-225 scoped lint (complete changed TypeScript surface) | 3 findings, all pre-existing (below) |
| ISSUE-225 lint delta | **0**. ISSUE-225 introduced no lint regression |

**Scoped-lint findings:**

- `tests/captaincies-source.test.ts`: `VALID_ROW_2` unused (warning);
- `tools/db/rebuild-test.ts:1544:57`: `no-explicit-any` (error);
- `tools/db/rebuild-test.ts:3341:1`: anonymous default export (warning).

**Baseline proof.** The base checkout HEAD was proved to be `30b36ef0`. The same ESLint and config, run on
those two base files, produced the same 1 error and 2 warnings. The captaincies warning is at line 140 on
base and line 141 on ISSUE-225 only because preceding content moved; the rule and message are the same.

**Still in force:** V2 PASS on `afldb_test`, and V3 PASS (1,205/1,205, exit 0, 37 Bruce `adjudicated key
disagreement`, the expected `list membership` +1, 0 `incorrect known answer`; diagnostic only, not DEV
acceptance) (§24.8).

### 24.10 DEV phase: V5 and V4 evidence (operator-run 2026-10-02; accepted PASS)

The implementation commit `4c0dfb39` (`fix(captaincies): add ISSUE-225 co-captains and Gridley key
adjudication`) is merged to `main`. Both DEV steps ran from it, in the §24.6 order: V5, then V4.

**V5 — DEV captaincies reload: PASS.**

| Check | Before (read-only) | After (read-only) |
|---|---|---|
| Database / role | `afldb_dev` / `afldb_import` | `afldb_dev` / `afldb_import` |
| Read-only | `default_transaction_read_only=on` | `read_only=on` |
| `captaincies` rows | 1,774 | 1,781 |
| trusted | 1,774 | 1,781 (before + 7) |
| `club_captain_any` eligible | 589 | 591 (+2) |
| ISSUE-225 source rows | 0 | all 7 present, each uniquely linked |
| Transaction | rolled back | rolled back |

Before the reload, the affected seasons held only the pre-existing captains.

**Apply:**

- the importer printed its target explicitly: `afldb_import@127.0.0.1:55432/afldb_dev`;
- group `captaincies` only;
- `captaincies 1,781 (1781 linked)`; exit 0.

**Links (after):**

- Cameron Bruce → canonical 2489;
- James McDonald → canonical 6730;
- Steven May → canonical 12093 (2017, 2018);
- Jarrod Witts → canonical 6815 (2019, 2020, 2021).

**Affected season captain sets (after):**

- Gold Coast 2017: Steven May + Tom Lynch;
- Gold Coast 2018: Steven May + Tom Lynch;
- Gold Coast 2019–2021: David Swallow + Jarrod Witts;
- Melbourne 2008: Cameron Bruce + David Neitz + James McDonald.

**Latest captaincies import batch:**

| Field | Value |
|---|---|
| id | 97 |
| source / tool / target | `wikipedia` / `import_awards.py` / `captaincies` |
| status | `completed` |
| `records_read` | 1,781 |
| `records_inserted` | 7 |
| `records_updated` | 1,774 |
| `records_rejected` | 0 |

`records_updated` 1,774 has the same meaning as in V2 (§24.8). `reload_keyed` rewrites every matching keyed
row in place and reports it as `updated`. The figure is reconciliation, not 1,774 factual changes.

DEV linkage was checked, not assumed (§18.4). The before-proof shows 1,774 of 1,774 trusted, so the earlier
"84 unlinked of 1,774" DEV figure (§18.4, §24.6) no longer described DEV at V5. Why it changed is outside
this issue and was not investigated.

**Procedural note (operator anomaly; no mutation, no target ambiguity).**

- The first local V5 DSN parsing guard saw a malformed trailing `n` and halted.
- The interactive PowerShell session then continued. No mutation occurred under that malformed target.
- Before the actual mutation, the independent remote read-only check proved `afldb_dev`. The importer
  itself printed `127.0.0.1:55432/afldb_dev`.
- The after-check independently proved `afldb_dev`.

**V4 — read-only DEV acceptance probe (D11): PASS.**

Source and runtime guard:

- HEAD `4c0dfb39`; clean tracked worktree;
- `tsx` runtime present; tunnel `127.0.0.1:55432` present;
- the base64 DSN transport decoded to `afldb_dev`;
- final local target guard: host `127.0.0.1`, port `55432`, database `afldb_dev`.

Probe session: database `afldb_dev`; read-only `on`; server port 5432; horizon 2026; transaction rolled back;
observed 2026-10-02 07:21:01 +10.

Adjudication records, all three `current`:

| Profile | Criterion / verdict | AFLDB id |
|---|---|---|
| Cameron Bruce | `captain` / `gridley_omits` | 2489 |
| David Swallow | `games250sameclub` / `gridley_lists` | 3581 |
| Dylan Shiel | `games100clubs2` / `gridley_lists` | 4006 |

| Group | Expected (§21, §24.6) | Observed |
|---|---|---|
| `captain census` | `{"agreement":20}` | `{"agreement":20}` |
| `teammate census` | `{"adjudicated key disagreement":15}` | `{"adjudicated key disagreement":15}` |
| `games census` | `{"adjudicated key disagreement":2}` | `{"adjudicated key disagreement":2}` |
| `bruce reverse` | adjudicated 37, `list membership` 1, agreement 126 | `{"agreement":126,"adjudicated key disagreement":37,"list membership":1}` |

- Expected unsupported exclusions: `#241 0-1 season2024player` and `#487 0-1 season2024player`.
- Result `PASS`, exit 0. `incorrect known answer` 0: the probe exits 1 on any.
- The probe also exits 1 on a teammate detail without AFLDB's count (§24.6), so PASS proves every teammate
  detail carried it. The per-player values were not part of the returned evidence.

No §21 stop condition fired. This satisfies the designed D11/V4 DEV acceptance contract. No ISSUE-225
database validation step remains.

**Closure readiness (assessed 2026-10-02; closure not performed). Historical; superseded by §24.11.**

| Criterion | State |
|---|---|
| V0: D1–D9, E4b capture (§21, §23, §24.1) | Met |
| V1: DB-free validation (§21) | Met (§24.9 current; pass-4 checker 1,781 / 1,781 / 186) |
| V2: `afldb_test` reload (§21) | Met (§24.8) |
| V3: `afldb_test` diagnostic corpus, 0 `incorrect known answer` (§21; also the §10 closure rerun) | Met (§24.8). Its "every other category unchanged" line was not evidenced either way (§24.8) and was accepted as such |
| V4: read-only DEV acceptance probe (§21, D11) | Met (above) |
| V5: DEV `captaincies` reload, count and links (§21) | Met (above) |
| V5: "smoke the Bruce, May, Witts and McDonald player pages, plus the Gold Coast and Melbourne club pages (… the operator eyeballs it)" (§21) | **Not recorded.** The returned V5 evidence does not include it |
| Ledger constraint: evidenced per-cell correction or rule; no blanket exception; no assertion weakened | Met (§16–§19, §24) |
| `CHANGELOG.md` at resolution (§22) | Pending: a closure action |
| PROD (§18.4) | Out of scope; "It needs its own promotion decision". A follow-up, not a closure criterion |

### 24.11 V5 page smoke and closure (2026-10-02): RESOLVED

**Method.** The smoke was run in a Playwright browser against DEV `http://10.0.40.100:8090`. The operator
completed the beta gate, and later the super-admin sign-in, manually in that browser; Claude never handled
credentials. No database, importer, test, service, Git or PROD action was taken. The page code was
untouched (data-only change).

**Initial smoke: stale page cache, not a defect.** All six pages returned HTTP 200, rendered every
section and logged 0 console errors or warnings. Four showed pre-V5 captaincy data:

- Steven May had no captaincy line;
- James McDonald showed Melbourne 2009–2010 only;
- the Gold Coast Captains table held one captain per season (Lynch 2017–18, Swallow 2019–21);
- the Melbourne Captains table held Neitz alone for 2008.

**Diagnosis (source and response headers; nothing changed).**

- Player pages read `captaincies` directly, with no derived table and no cross-request data cache:
  `getPlayerHonours()` (`src/db/queries/awards.ts:448`, captaincy branch lines 501–519), grouped by club
  (`src/app/players/[slug]/page.tsx:210-215`). Its `unique`/`resolved` filter admits every linked row,
  because `link_status()` (`tools/migration/import_awards.py:119-131`) gives any row with a player id one
  of those two statuses.
- The club query `getClubCaptains()` (`src/db/queries/awards.ts:692-730`) is a `UNION ALL` with no
  `DISTINCT ON`, `GROUP BY` or `LIMIT`. Its rows are keyed by `id`, so same-season co-captains survive.
- Pages are ISR: players `revalidate = 3600`, clubs `revalidate = 86400`. The `captaincies` import
  (`import_captaincies()`) invalidates no page cache, so V5 left the cached pages in place.
- Live evidence: the May and McDonald pages first served stale copies (which triggered the normal
  background rebuild). Reloaded later, the same URLs showed "Captain, Gold Coast — 2017–2018 (2 seasons)"
  and "Captain, Melbourne — 2008–2010 (3 seasons)". The two club pages were still cache `HIT` on the pre-V5
  table within their 24-hour window.
- Classification: **stale cache. No public query or render defect.**

**Narrow refresh (DEV page cache only).** The existing awards revalidation route,
`POST /admin/awards/revalidate` (`data.awards.edit`; allowlist `src/app/admin/awards/revalidate-paths.ts`),
was called with exactly `{"paths":["/clubs/gold-coast","/clubs/melbourne"]}`.

- 24 authenticated POSTs were accepted. Each returned HTTP 200 and
  `{"ok":true,"revalidated":["/clubs/gold-coast","/clubs/melbourne"]}`. One earlier attempt, made before
  the admin sign-in, was redirected by the capability check and changed nothing.
- `revalidatePath` acts per worker process. The first 12 POSTs, sent one after another, did not reliably
  reach every worker: later loads still mostly served the pre-V5 tables. Two concurrent waves of 6 followed.
- There was no global purge, no `.next/cache` deletion, no service restart and no database mutation.
- The route does not identify the worker that handled a request, so **no claim is made that every DEV
  worker was individually reached.**

**Acceptance evidence.** After the concurrent refresh, each club page was loaded 8 consecutive times. Every
load showed the expected rows, and the old ETags and old content were never observed again.

| Page | Path | Cache statuses (8 loads) | Rows | Result |
|---|---|---|---|---|
| Gold Coast | `/clubs/gold-coast` | MISS, MISS, HIT, MISS, HIT, HIT, HIT, HIT; two new ETags, same content | 2017 and 2018: Steven May + Tom Lynch; 2019, 2020 and 2021: David Swallow + Jarrod Witts; 21 captaincy rows | PASS |
| Melbourne | `/clubs/melbourne` | MISS, MISS, MISS, HIT, MISS, HIT, HIT, HIT; two new ETags, same content | 2008: Cameron Bruce, David Neitz, James McDonald; 135 captaincy rows | PASS |

| Player page | Path | Honours line | Result |
|---|---|---|---|
| Cameron Bruce | `/players/cameron-bruce-2489` | Captain, Melbourne — 2008 (1 season) | PASS |
| Steven May | `/players/steven-may-12093` | Captain, Gold Coast — 2017–2018 (2 seasons) | PASS |
| Jarrod Witts | `/players/jarrod-witts-6815` | Captain, Gold Coast — 2019–2024 (6 seasons) | PASS |
| James McDonald | `/players/james-mcdonald-6730` | Captain, Melbourne — 2008–2010 (3 seasons) | PASS |

**V5 page smoke: PASS, 6/6.**

**Closure criteria (final; supersedes the §24.10 readiness table).**

| Criterion | State |
|---|---|
| V0: D1–D9, E4b capture | Met |
| V1: DB-free validation | Met (§24.9) |
| V2: `afldb_test` reload | Met (§24.8) |
| V3: `afldb_test` diagnostic corpus, 0 `incorrect known answer` (also the §10 closure rerun) | Met (§24.8). Its "every other category unchanged" line was **not** independently evidenced, and was accepted as such |
| V4: read-only DEV acceptance probe (D11) | Met (§24.10) |
| V5: DEV `captaincies` reload, count and links | Met (§24.10) |
| V5: page smoke (Bruce, May, Witts, McDonald; Gold Coast, Melbourne) | Met (above) |
| Ledger constraint: evidenced per-cell correction or rule; no blanket exception; no assertion weakened | Met (§16–§19, §24) |
| `CHANGELOG.md` at resolution (§22) | Met (`Unreleased`, 2 October 2026) |
| PROD (§18.4) | Out of scope: "It needs its own promotion decision". Not changed by this issue |

**Resolution (2026-10-02).**

- **Root cause.** The `captaincies` source omitted seven evidenced co-captaincy rows, because of the
  bootstrap's club-list grain (§17.3): May 2017–18, Witts 2019–21, Bruce and McDonald 2008. The remaining
  cells were a teammates semantic-contract difference (15) and two Gridley known-answer errors (Swallow,
  Shiel).
- **Fix.** S1 added the seven rows (1,774 → 1,781). S2 added a suite-only teammates rule, a tracked
  known-answer adjudication record and the D10 Bruce guard. D11 added the read-only DEV acceptance probe.
  Grid Solver semantics are unchanged.
- **Validation.** V1–V5 above, including the 6/6 DEV page smoke.

**Non-blocking follow-up (not an ISSUE-225 acceptance failure; no issue opened in this pass).** The club
page note "N recorded captaincy seasons" (`src/app/clubs/[slug]/page.tsx:376`) prints `captains.length`,
so it counts captaincy rows, not distinct seasons. Gold Coast reads 21 for 16 seasons.

## 25. Session log

- **2026-10-02, V5 page smoke and closure.**
  - Ran the V5 page smoke in Playwright; the operator signed in manually. Diagnosed the four initial
    failures as stale ISR page cache, not a query or render defect. Refreshed only the two club pages,
    through the existing awards revalidation route, and re-verified them (§24.11). PASS 6/6.
  - Resolved the issue: `issues.md` entry and Open Issues table, `IssuesIndex.md`, `CHANGELOG.md`. Moved this
    runbook and its four companions to `issues/closed/` and updated the live path references.
  - No database, importer, test, service, Git or PROD action. Nothing staged or committed.

- **2026-10-02, DEV evidence sync and closure-readiness assessment.**
  - Recorded the operator-run V5 (DEV captaincies reload) and V4 (read-only DEV acceptance probe), both
    accepted PASS, and the V5 procedural note (§24.10).
  - Assessed closure readiness against §10, §21, §22 and the ledger constraint (§24.10). Remaining: the §21
    V5 page smoke is not recorded.
  - Documentation only. No database, Git, shell or test command. Nothing staged or committed.
    `CHANGELOG.md` untouched. The issue was not closed or moved.

- **2026-10-02, final operator-validation evidence sync.**
  - Recorded the operator's repository-surface validation (§24.9): DB-free 144/144, typecheck PASS,
    full-repository lint FAIL on the pre-existing baseline, ISSUE-225 lint delta 0.
  - Marked the pass-4/pass-5 DB-free tables (§24.5, §24.7) as historical and superseded.
  - Documentation only. No database, Git, shell or deployment command. Nothing staged or committed.
    `CHANGELOG.md` untouched.

- **2026-10-02, post-V3 documentation sync.**
  - Recorded the operator-run V2 and V3 evidence (§24.8), both accepted PASS.
  - Corrected tracking wording that predated D6/D10/D11: §16 totals (teammate disposition by horizon), §21 V3
    (37 Bruce adjudications plus the club-count cell) and §21 V4 (the D11 read-only DEV acceptance probe, not
    the diagnostic corpus).
  - No implementation or test change. No database, Git, SSH or deployment command. Nothing staged or
    committed. `CHANGELOG.md` untouched.

- **2026-10-01, pass 5 (D10, D11).**
  - Implemented the operator's D10 (criterion-level, Bruce-record-only guard) and D11 (the read-only DEV
    acceptance probe) (§24.7).
  - DB-free only, pass-time (historical; superseded by §24.9): vitest 672/672; `tsc` clean; `eslint` 0
    errors on the files linted then; probe refusal paths and import chain run with no database contacted.
  - No database, Git, SSH or deployment command. Nothing staged or committed. `CHANGELOG.md` untouched.

- **2026-10-01, pass 4 (implementation, S1+S2 as one slice).**
  - Verified W1/W2 and the corroboration over the network (§24.1).
  - Implemented S1 and S2 (§24.2), with deviations §24.3.
  - Found the pair-guard coverage gap and proposed D10 (§24.4).
  - Found that `tests/setup.ts` blocks the D7 DEV corpus run and proposed D11 (§24.6).
  - Ran DB-free validation only (§24.5; historical, superseded by §24.9): captaincies checker; vitest 4
    files 666/666; `tsc`; `eslint`.
  - Created a `node_modules` junction (gitignored).
  - Prepared the V2–V5 commands and the read-only `AFLDB-ISSUE-225-s1-captaincies-checks.sql`.
  - No database, Git, SSH or deployment command. Nothing staged or committed. `CHANGELOG.md` untouched.

- **2026-10-01, pass 3 (evidence recording and implementation design only).**
  - Recorded the operator-run E3 (PASS, `afldb_dev` read-only, §14) and E4 (§15).
  - Final 37-cell classification (§16).
  - Captaincies provenance and root cause (§17): read `tools/migration/captaincies.py`, the
    `import_awards.py` captaincies group and `PlayerResolver`, `captaincies.csv` (by search), ISSUE-118
    §23.21/§23.23, and the migration 098 comments.
  - S1/S2 design (§18–§19), test plan (§20), validation plan (§21), decisions (§23).
  - New finding: S1 alone turns 26 pre-2026 Bruce cells into failures (§18.5), so S1 and S2 must land
    together. (Pair-analysis figure at the time; D10 later proved the full exposure is 37, §18.5.)
  - Collateral source omissions: Witts 2019–21, McDonald 2008 (§15, §18.2).
  - No shell, Git, SQL, network or test command executed by Claude.
  - No production code, test, classifier, canonical CSV, `CHANGELOG.md`, migration or database change.
    Nothing staged or committed.

- **2026-10-01, pass 2 (evidence recording only).**
  - Recorded the operator-run E1 and E2 (§11) and refined the classifications (§12).
  - Created the DEV E3 SQL `AFLDB-ISSUE-225-e3-dev-horizon.sql` with its pre-registered reading (§12.4), and
    the operator runner `D:\tmp\issue225\run-e3.sh`, outside the repository.
  - Identified the minimum E4 set (§13) without network access.
  - Renumbered the old network pass E3 → E4.
  - Updated the `issues.md` entry and Open Issues row, and `IssuesIndex.md`.
  - No shell, Git, SQL, network or test command executed by Claude. E3 has not been run.
  - No production code, test, classifier, canonical CSV, `CHANGELOG.md`, migration or database change.
  - Nothing staged or committed.
- **2026-10-01, pass 1 (investigation only).** Native read/search only. No shell, Git, SQL, network or test
  command was executed. Read the cited 2026-09-19 report artefact by search only. Created this runbook, the
  E1 probe and the E2 SQL. Updated the `issues.md` ISSUE-225 entry and `IssuesIndex.md`. No production code,
  test, classifier, data, migration or database change. Nothing staged or committed. Next: operator runs E1
  and E2 (§7) and returns both outputs.
