# Remediation run 3, scope `integb` (phase B): the 53 integration ids on the accepted-baseline rebuild

Branch `claude/rem3-integb-20261114` (created at integration commit `aae066c4`, which carries the stateb fixes and phase A's runner), host
`streamanator`, workspace `/mnt/ssd/afldb-rem3-integb-20261114`, cluster `/mnt/ssd/afldb-rem3-integb-20261114-pg`, **port 55675**, host checkout
`cand` (clone of the review checkout, base `6d5388ea…` from the verified bundle `0a1b46d1…ccf68`, then my commits by bundle; no `.env`; `npm ci`
done). Every database command ran through `isolated-pg run` on port 55675 with `AFLDB_V2_PG_ROOT`, `AFLDB_V2_PG_PORT`, `AFLDB_V2_PG_BIN`
exported; a fresh `--template` copy per experiment; none of the forbidden ports, production, DEV, `afldb_test` on :5432, sudo or wsl was touched.
Nothing under `src/` changed; `AFLDB_TEST_PER_FILE_DB_PREFIX` was never set.

Commits on the branch (all `ISSUE-363:`; the trailer names Claude Opus 5.5 on the first four and Claude Sonnet 5.5 on `8db4007d` and this evidence commit, the model that wrote them), in order:

| SHA | What |
|---|---|
| `641ccd1a` | phase B runner and Brownlow clone helper adapted to this scope's workspace guard, port 55675 and database labels (logic unchanged) |
| `ff0be025` | `tests/integration/settle-afl-api-brownlow.test.ts`: restores its season's `stat_availability` rows exactly as found (section 3) |
| `38fe163c` | `tests/integration/settle-afl-api-issue276.test.ts`: fixtures use an ordinary home-and-away round so they cannot collide with the real 2026 final (section 4) |
| `82e03229` | `tests/integration/database.test.ts`: four stale witnesses re-pinned from the retired `2026082x` baseline to the accepted c2 baseline (section 5) |
| `8db4007d` | `docs/v2/evidence/remediation-20261114/run3/integ/run-rebuilt.sh`: ANALYZE the bridged copy after the DraftGuru import (section 8, the three performance tests); runner only, no test or `src` change |
| (evidence commit) | this directory |

Final code state qualified: host checkout `HEAD = 8db4007dc5b8cebcf1b18512ef04fbe71523d47c` (`82e03229` plus the runner-only commit), `git status --porcelain` empty at the start of the
final run (`evidence/final2/run.log.txt.gz`). The test files of `82e03229` and `8db4007d` are byte-identical, so the single-file runs made at `82e03229`
(`evidence/it/*`, `evidence/final/`, the snapshot-copy finals `sf_*`, war-years red/green) remain valid for them; `evidence/final/` is the earlier full run at
`82e03229` (its oracle6 group still shows the three performance failures of section 8) and is kept, `evidence/final2/` is the authoritative full run at `8db4007d`.
`tsc --noEmit` rc 0 with 0 errors at `82e03229` (`evidence/facts/tsc.out`); `eslint` on the three changed test files:
3 `no-explicit-any` errors at `settle-afl-api-brownlow.test.ts:180-182` and 1 warning at `database.test.ts:630`, all in lines this scope did not touch
(they are in the file at `aae066c4`).

## 1. Result

53 ids, six-class vocabulary (class 1 passes under intended conditions; 2 actual defect, fixed with red/green; 3 stale assertion; 4 deliberate
refusal; 5 limitation awaiting owner; 6 not run / blocked):

| Class | Count | Ids |
|---|---|---|
| 1 passes under intended conditions | **14** | admin-brownlow P2; data-editor 5; draft-linkage 2; release-gates "Brownlow authority", "birth dates leaves the remaining players"; OD-5; the two Brownlow clone suites; v2-coleman-publication |
| 2 actual defect, fixed (red/green) | **2** | `database` "separates the war years" (test hygiene in `settle-afl-api-brownlow`); `settle-afl-api-issue276` (fixtures collide with the real 2026 final) |
| 3 stale assertion (witness measured before 2026 completed) | **31** | corrected and passing: `database` 4; **not corrected** (file cannot pass on the rebuild, see 6): club-comparison 24, release-gates 3 ("exact 261 players", "records why each attendance is missing", "attaches every ladder row") |
| 4 deliberate refusal | 0 | (the Coleman suite refuses on a populated base by design, but its documented schema-only base passes, so it is class 1) |
| 5 limitation awaiting owner | **5** | awards-reload-links (Coleman contract 46 vs 47); gridley-corpus (run-2 accepted limitation N7); release-gates "2026 is provisional" x3 |
| 6 not run here | **1** | `settle-afl-api-state-b` (owned by the stateb scope) |

Counts per class: 14 / 2 / 31 / 0 / 5 / 1 = 53.

## 2. The base the suites ran on

`afldb_v2_rb_rem3-6d5388ea.dump` (sha256 `d8397aab…65c63`, verified) restored exactly as the published `RESTORE.md` prescribes
(`create-db`, `isolated-pg run <db> -- node restore-dump.mjs <dump> <sha>`, `verify`): `pg_restore exit=0`, `ISOLATED TARGET OK`, the exact
`count(*)` of all 83 public tables **identical** to the published `table-counts.tsv` (`evidence/c1/table-counts.diff` empty). Identity
(`evidence/c1/template-identity.txt`): ledger head `118_fixtures_unconfirmed_participants.sql` (118), 17,056 matches, seasons 1897-2026 plus a 2027
row, 13,365 players, **2026 `complete`, the only season in progress is 2027**, `data_overrides` player_match_stats authority rows **0**, Coleman 47
rows (1980-2026) including a 2001 row, the real 2026 preliminary final Hawthorn v Brisbane Lions present, 2026 Brownlow coverage `pending` x3,
no round vote with a NULL `match_id`. The bridge child (sha256 `1200e702…b9d`) was imported into a copy used only by the `oracle6` group (then `ANALYZE`d, see section 8)
(`import_draftguru.py --label annual-html-20260826 --bridge <child>`, rc 0; the 42 Stage A raw pages verified against the committed manifest before the
read-only copy). The snapshot copies come from the approved 4 Nov snapshot (30,141,895 bytes, sha256 `e77c307d…2826d`, both verified) restored with
`restore.mjs` and migrated to ledger 118 (`evidence/facts/snap-tmpl-probe.txt`).

The two bases agree on every aggregate the tests pin except the ones named below (`evidence/facts/facts2-*.txt`, `facts3-*.txt` identical; `facts1`
differs only in the snapshot's missing 2027 season row and match ids; `facts4` differs only in player surrogate ids).

## 3. `database` "Brownlow correctness separates the war years": a test defect, fixed

Phase A found the mechanism but filed it as "not reproduced standalone". It is a real hygiene defect of a **different file**:
`settle-afl-api-brownlow.test.ts` works on the real season 2026; its cleanup ended with `recomputeBrownlowCoverage(tx, 2026)`, which on a base where
2026 is `complete`, has no accepted medal and no workflow decisions rewrites the pre-existing rows (`player-derived.ts:735-740`). Whichever file runs
next in a shared run sees the changed rows.

Fix (test only; `recomputeBrownlowCoverage` and `src/` untouched): `beforeAll` captures every `stat_availability` row of the season before anything
writes; `afterAll` restores exactly that content in one transaction and asserts equality; the recompute stays **only as crash repair** (when `beforeAll`
finds this suite's own residue, `startedClean` is false) and says so in a comment. The crash-repair branch was not exercised live (no residue was
manufactured); it is the unchanged previous behaviour.

Proof, shared mode, a fresh snapshot copy per experiment, one forced order as separate `isolated-pg run` invocations
(`evidence/exp/`, driver `host-scripts/exp.sh`; the rows are the 24 `stat_availability` rows of 2026, `rows-*.txt`):

| Experiment (code) | Order | Result |
|---|---|---|
| **red1** at `641ccd1a` (test files identical to `aae066c4`) | brownlow, then database | rows before md5 `7ea20d9dd3e1`, after the brownlow file `32f0d069ffc3`: `brownlow_season_total pending -> not_applicable`, `brownlow_round_votes pending -> partial`, `brownlow_match_votes pending -> not_applicable 0/207`. `database`: 69 tests, 5 failed; the war-years id fails with **`AssertionError: expected [ 1942, 1943, 1944, 1945, 2026 ] to deeply equal [ 1942, 1943, 1944, 1945 ]`** (the run-1 text) |
| **green1** at `ff0be025` | brownlow, then database | rows md5 `7ea20d9dd3e1` at start, after brownlow and after database (**equal**); brownlow 21/21; war-years **passed** |
| **green2** | database, then brownlow (reversed) | rows equal at every step; war-years passed; brownlow 21/21 |
| **green3** | brownlow, database, brownlow, database | rows equal at every step; war-years passed both times |
| **greenreb** on a copy of the rebuilt base | brownlow, database | rows equal; war-years passed; brownlow 21/21 |

The brownlow family still passes (21/21) in every green run, on snapshot copies and on the rebuild. At the final HEAD the runner's war-years group on
the rebuild passes in all three shared runs, the per-file run and the mechanism pair (`war-mech-settle` 21/21 then `war-mech-after` passes;
`evidence/final2/run.log.txt.gz`, versus c1 at `641ccd1a` where `war-mech-after` failed with the same text on the rebuild: `evidence/c1/war-mech-after.json.gz`).
The 2026 `stat_availability` rows of the rebuild and the snapshot are identical (md5 `7ea20d9dd3e1`), so the mechanism is the same on both.

## 4. `settle-afl-api-issue276`: fixtures collided with the real 2026 final, fixed

Red: at `641ccd1a` on a copy of the rebuild the file refuses to run (4 skipped, `evidence/c1/issue276.log.txt.gz`): `ISSUE-276 cases cannot run: these existing
canonical rows are not ISSUE-276 fixtures … 2026|PF|2026-09-19|Hawthorn|Brisbane Lions (matches.id 17055)`. The cases used the fixture file's own
Preliminary Final with Hawthorn at home to Brisbane Lions, so the real final differs from a case by the date alone (`sameFixtureIdentity`: same
oriented clubs, at most one of round/date differing). Any base holding the completed 2026 season refuses; the snapshot refuses the same way
(`matches.id 17266`, phase A).

Fix (fixture only, no assertion, club, venue, score, roster or ownership rule changed): the cases carry API round 5 (`afl_api_2026` -> canonical
home-and-away round '6', the choice `settle-afl-api-brownlow` already makes): `ROUND_CODE`/`API_ROUND_NUMBER` constants, the fixture round and roster
round number rewritten in `unitSourceFor`, `matchKeyFor` and the conflict check use `ROUND_CODE`, and the one hand-seeded foreign-owned row becomes a
home-and-away round-6 row. A case now differs from the real final in round and date. Real 2026 Hawthorn (home) v Brisbane Lions rows: only the
final (round 23 has Brisbane Lions at home; `evidence/facts/facts1-rebuild.txt`).
Green: 4/4 on a fresh copy of the rebuild and 4/4 on a fresh snapshot copy (`evidence/it/i276r`, `i276s`, repeated at the final HEAD in
`evidence/final2/issue276.json.gz` and `evidence/it/sf_276.json.gz`).

## 5. Stale test witnesses: before/after (authorised correction, evidence)

Corrected only where (a) the application equals the test's independent derivation on the rebuild **and** the snapshot copy, (b) the two bases agree,
(c) provenance shows measurement on the retired baseline, and the file then passes on the rebuild.

| Id | Before | After | Provenance (c) | Independent evidence (a), (b) |
|---|---|---|---|---|
| `database` "data integrity has the full player-match dataset" | 685,471 | **695,499** | pinned `673f0e31` (2026-08-30) to `full-history-20260827`; the accepted-baseline register's c2 entry `measured.player_match_rows` is 695,499 (the two retired entries say 685,471) | `count(*)` of `player_match_stats` through season 2025 = **685,471**, 2026 = 10,028 (`evidence/facts/facts2-rebuild.txt`); the snapshot gives the same |
| `database` "200-249 games with 16 or more finals" | 114 | **120** | `414f110c` (2026-09-04, `0902` baseline) | cohort re-derived from `player_match_stats` through 2025 = **114**; all seasons, finals counted as `player_career_stats` counts them (`is_finals_series`) = 120 (`facts2`, `facts3`) |
| `database` "50-199 goals and no Brownlow votes" | 261 | **268** | `414f110c` (ISSUE-113 measurement) | goals through 2025 from the fact table with career Brownlow = 0 gives **261** (`facts3`) |
| `database` "200+ games, 100+ goals and 15+ finals" | 219 | **223** | `673f0e31` | through 2025 = **219**; all seasons (`is_finals_series`) = 223 (`facts2`, `facts3`) |

Result: `database.test.ts` **69/69 on the rebuild copy** (`evidence/it/dbr.json.gz`, and in `evidence/final2/oracle6.json.gz`) and **69/69 on a fresh
snapshot copy** (`evidence/it/dbs.json.gz`, `sf_db.json.gz`). Before, the snapshot copy gave the same four values (`223`, `120`, `268`, `695499`).
The tests have no separate independent SQL of their own; the through-2025 derivation above is the independent evidence. No register, contract or
pin of `AWARDS_HONOURS_EXPECTED`/`DRAFTGURU_EXPECTED`/ladder tuple was touched.

Side observation (INFO, not changed): the 2026 Wildcard Finals (`WF`, 2 matches, 92 player rows) have `is_final = true` but `is_finals_series = false`;
`player_career_stats.finals` counts the latter (sum 29,732 against 29,824 `is_final` rows). The `finals` cohorts above therefore exclude them. Whether
a wildcard final is a "final" for career statistics is a modelling question for the owner.

## 6. Stale witnesses prepared but NOT applied (28 ids)

Why not applied: the brief permits a witness change only when the file then passes on the rebuild. Neither file can, for reasons that are not
witness values of this kind:
* `club-comparison.test.ts`: two further id witnesses fail on the rebuild and pass on the snapshot (so (b) fails and they are not in the 53):
  Jarryd Lyons `6818` (rebuild `6850`) with a different intervening club, and James Cook `6711` (rebuild id `6743`, so the lookup by id finds nothing). Player surrogate
  ids differ between the production snapshot and the c2 rebuild (`facts4-*.txt`: Ben Keays 1103/1109, Cook 6711/6743, Lyons 6818/6850). Several other witnesses are
  statements about the end of 2025 ("latest meeting 2025", "current streak is Adelaide's single 2025 win", "Tom Doedee is the latest crossover").
* `release-gates.test.ts`: the three "2026 is provisional" gates (owner decision, section 10) and three birth-date gates that pass on the snapshot and fail on the rebuild.

Evidence that the 24 + 3 differences are the completed 2026 season and nothing else (`evidence/facts/facts4-rebuild.txt`; the snapshot is identical):
Adelaide v Brisbane Lions 41 meetings through 2025 (2 finals-series) **+ 2** in 2026 (1 finals-series) = 43; Carlton v Collingwood 268 + 2 = 270; attendance `complete`
15,187 through 2025 + 218 (2026) = 15,405 (the register's `attendance_known`); `club_seasons` ranges end 2026 (western-bulldogs 1997-2026, sydney 1982-2026,
north-melbourne 1925-2026). A diagnostic run with `expect.soft` on a scratch copy (never committed) lists **every** mismatching witness with its line and the
actual value: `evidence/soft/cc2.list.txt` (club-comparison, 108 lines) and `evidence/soft/rg1.list.txt` (release-gates, 28 lines). The release-gates
"exact 261 players" gate additionally pins two id-set fingerprints (`ca65f15239aaf0b5`, `79d3e6eea83a4620`) that would be re-measured (rebuild `f7719c70521bee69`,
`7b65674c50d3d508`).

## 7. The 53 ids

Columns: rebuild result at the final code (`evidence/final2/*`, or c1 where noted), snapshot result (phase A at `6d5388ea` for files unchanged since, or
`evidence/it/sf_*` at the final HEAD). "oracle6" is the six-file per-file run on the bridged rebuild copy; "oracle6-snapshot" is phase A's
(`../integ/evidence/a/oracle6-snapshot.json.gz`). Class is section 1.

| n | file | test id (short) | class | rebuild (final2, or named run) | snapshot (phase A, or `sf_*` at the final code) |
|---|---|---|---|---|---|
| 1 | admin-brownlow | migration 094 objects and backfill resolved every historical round row | 1 | oracle6: PASS | oracle6-snapshot: FAIL expected 9522 to be +0 |
| 2 | awards-reload-links | <file-level> | 5 | awards: FAIL(file) "afldb_test holds 47 Coleman winner row(s); the tracked contract declares exactly 46" (97 passed, 10 skipped) | sf_aw: FAIL(file), same refusal |
| 3 | club-comparison | club comparison: crossover players lists everyone who represented both | 3 | oracle6: FAIL expected [ { playerId: 2616, …(13) }, …(11) ] to have a length of 11 but got 12 | oracle6-snapshot: FAIL expected [ { playerId: 2604, …(13) }, …(11) ] to have a length of 11 but got 12 |
| 4 | club-comparison | club comparison: crossover players reports Ben Keays as Brisbane Lions | 3 | oracle6: FAIL expected 156 to be 131 | oracle6-snapshot: FAIL expected 156 to be 131 |
| 5 | club-comparison | club comparison: crossover players summarises the first and most recen | 3 | oracle6: FAIL expected 12 to be 11 | oracle6-snapshot: FAIL expected 12 to be 11 |
| 6 | club-comparison | club comparison: head-to-head Brownlow counts eligible and covered mee | 3 | oracle6: FAIL expected [ { matchId: 11178, …(4) }, …(39) ] to have a length of 39 but got 40 | oracle6-snapshot: FAIL expected [ { matchId: 11178, …(4) }, …(39) ] to have a length of 39 but got 40 |
| 7 | club-comparison | club comparison: head-to-head by decade reproduces the Adelaide vs Bri | 3 | oracle6: FAIL expected [ [ 1990, 5, 2, 3, +0 ], …(3) ] to deeply equal [ [ 1990, 5, 2, 3, +0 ] | oracle6-snapshot: FAIL expected [ [ 1990, 5, 2, 3, +0 ], …(3) ] to deeply equal [ [ 1990, 5, 2, 3, +0 ] |
| 8 | club-comparison | club comparison: head-to-head by decade sums every Carlton vs Collingw | 3 | oracle6: FAIL expected 270 to be 268 | oracle6-snapshot: FAIL expected 270 to be 268 |
| 9 | club-comparison | club comparison: head-to-head core filters by era (Club Rivalry Explor | 3 | oracle6: FAIL expected 10 to be 8 | oracle6-snapshot: FAIL expected 10 to be 8 |
| 10 | club-comparison | club comparison: head-to-head core filters by match type so that home- | 3 | oracle6: FAIL expected 43 to be 41 | oracle6-snapshot: FAIL expected 43 to be 41 |
| 11 | club-comparison | club comparison: head-to-head core groups venue records by canonical v | 3 | oracle6: FAIL expected 43 to be 41 | oracle6-snapshot: FAIL expected 43 to be 41 |
| 12 | club-comparison | club comparison: head-to-head core handles the Carlton vs Collingwood  | 3 | oracle6: FAIL expected 270 to be 268 | oracle6-snapshot: FAIL expected 270 to be 268 |
| 13 | club-comparison | club comparison: head-to-head core keeps Brisbane Bears and Fitzroy ou | 3 | oracle6: FAIL expected [ …(43) ] to have a length of 41 but got 43 | oracle6-snapshot: FAIL expected [ …(43) ] to have a length of 41 but got 43 |
| 14 | club-comparison | club comparison: head-to-head core paginates the complete meetings lis | 3 | oracle6: FAIL expected [ { matchId: 13184, …(22) }, …(17) ] to have a length of 16 but got 18 | oracle6-snapshot: FAIL expected [ { matchId: 13184, …(22) }, …(17) ] to have a length of 16 but got 18 |
| 15 | club-comparison | club comparison: head-to-head core reads streaks from chronological or | 3 | oracle6: FAIL expected 'b-win' to be 'a-win' | oracle6-snapshot: FAIL expected 'b-win' to be 'a-win' |
| 16 | club-comparison | club comparison: head-to-head core summarises Adelaide vs Brisbane Lio | 3 | oracle6: FAIL expected 43 to be 41 | oracle6-snapshot: FAIL expected 43 to be 41 |
| 17 | club-comparison | club comparison: head-to-head player averages applies the five-recorde | 3 | oracle6: FAIL expected 7 to be 5 | oracle6-snapshot: FAIL expected 7 to be 5 |
| 18 | club-comparison | club comparison: head-to-head player averages ranks the disposals aver | 3 | oracle6: FAIL expected [ [ 'Matt Crouch', 7, 30.71 ], …(2) ] to deeply equal [ [ 'Matt Crouch' | oracle6-snapshot: FAIL expected [ [ 'Matt Crouch', 7, 30.71 ], …(2) ] to deeply equal [ [ 'Matt Crouch' |
| 19 | club-comparison | club comparison: head-to-head player averages retains every tie at the | 3 | oracle6: FAIL expected 1 to be 2 | oracle6-snapshot: FAIL expected 1 to be 2 |
| 20 | club-comparison | club comparison: head-to-head player averages reuses the comparison me | 3 | oracle6: FAIL expected 43 to be 41 | oracle6-snapshot: FAIL expected 43 to be 41 |
| 21 | club-comparison | club comparison: head-to-head player averages splits a crossover playe | 3 | oracle6: FAIL expected 16 to be 14 | oracle6-snapshot: FAIL expected 16 to be 14 |
| 22 | club-comparison | club comparison: head-to-head player leaders consolidates a player who | 3 | oracle6: FAIL expected 16 to be 14 | oracle6-snapshot: FAIL expected 16 to be 14 |
| 23 | club-comparison | club comparison: head-to-head player leaders keeps every tied holder o | 3 | oracle6: FAIL expected 42 to be 40 | oracle6-snapshot: FAIL expected 42 to be 40 |
| 24 | club-comparison | club comparison: head-to-head player leaders ranks H2H games leaders a | 3 | oracle6: FAIL expected 22 to be 20 | oracle6-snapshot: FAIL expected 22 to be 20 |
| 25 | club-comparison | club comparison: head-to-head player leaders ranks H2H goals leaders w | 3 | oracle6: FAIL expected 57 to be 54 | oracle6-snapshot: FAIL expected 57 to be 54 |
| 26 | club-comparison | club comparison: period-score rivalry records exposes pair-level perio | 3 | oracle6: FAIL expected 43 to be 41 | oracle6-snapshot: FAIL expected 43 to be 41 |
| 27 | data-editor | Durable Match Sheet authority: rollback, replay and continuity (AFLDB- | 1 | data-editor: PASS | sf_de: FAIL afldb_test must hold no player_match_stats authority before this suite (the repl |
| 28 | data-editor | Durable Match Sheet authority: rollback, replay and continuity (AFLDB- | 1 | data-editor: PASS | sf_de: FAIL afldb_test must hold no player_match_stats authority before this suite (the repl |
| 29 | data-editor | Durable Match Sheet authority: rollback, replay and continuity (AFLDB- | 1 | data-editor: PASS | sf_de: FAIL afldb_test must hold no player_match_stats authority before this suite (the repl |
| 30 | data-editor | Durable Match Sheet authority: rollback, replay and continuity (AFLDB- | 1 | data-editor: PASS | sf_de: FAIL afldb_test must hold no player_match_stats authority before this suite (the repl |
| 31 | data-editor | Durable Match Sheet authority: rollback, replay and continuity (AFLDB- | 1 | data-editor: PASS | sf_de: FAIL afldb_test must hold no player_match_stats authority before this suite (the repl |
| 32 | database | advanced search regression cases 200+ games, 100+ goals and 15+ finals | 3 (corrected) | oracle6: PASS; war-shared-1: PASS | oracle6-snapshot: FAIL expected 223 to be 219; sf_db: PASS |
| 33 | database | advanced search regression cases 200-249 games with 16 or more finals | 3 (corrected) | oracle6: PASS; war-shared-1: PASS | oracle6-snapshot: FAIL expected 120 to be 114; sf_db: PASS |
| 34 | database | advanced search regression cases 50-199 goals and no Brownlow votes | 3 (corrected) | oracle6: PASS; war-shared-1: PASS | oracle6-snapshot: FAIL expected 268 to be 261; sf_db: PASS |
| 35 | database | data integrity has the full player-match dataset | 3 (corrected) | oracle6: PASS; war-shared-1: PASS | oracle6-snapshot: FAIL expected 695499 to be 685471; sf_db: PASS |
| 36 | draft-linkage | DraftGuru bridge on afldb_test — §6.1 reconciliation (read-only) perso | 1 | oracle6: PASS | oracle6-snapshot: FAIL expected 3559 to be 3465 |
| 37 | draft-linkage | DraftGuru bridge on afldb_test — §6.4 negative controls (read-only) wi | 1 | oracle6: PASS | oracle6-snapshot: FAIL expected [ …(94) ] to deeply equal [] |
| 38 | gridley-corpus | Gridley corpus -- every cell through solveCellSummary writes the run r | 5 | oracle6: FAIL expected [ …(40) ] to deeply equal [] | oracle6-snapshot: FAIL expected [ …(40) ] to deeply equal [] |
| 39 | release-gates | gate: 2026 is provisional (snapshot-pinned) awards no premier and no w | 5 | oracle6: FAIL expected 1 to be +0 | oracle6-snapshot: FAIL expected 1 to be +0 |
| 40 | release-gates | gate: 2026 is provisional (snapshot-pinned) is the only season still i | 5 | oracle6: FAIL expected [ 2027 ] to deeply equal [ 2026 ] | oracle6-snapshot: FAIL expected [] to deeply equal [ 2026 ] |
| 41 | release-gates | gate: 2026 is provisional (snapshot-pinned) reports 2026 Brownlow as p | 5 | oracle6: FAIL expected 'complete' to be 'in_progress' | oracle6-snapshot: FAIL expected 'complete' to be 'in_progress' |
| 42 | release-gates | gate: Advanced Search regression cases 50-199 goals and zero Brownlow  | 3 | oracle6: FAIL expected 268 to be 261 | oracle6-snapshot: FAIL expected 268 to be 261 |
| 43 | release-gates | gate: Brownlow authority agrees with the canonical round votes for eve | 1 | oracle6: PASS | oracle6-snapshot: FAIL expected 183 to be +0 |
| 44 | release-gates | gate: absence is never zero records why each attendance is missing | 3 | oracle6: FAIL expected [ …(2) ] to deeply equal [ …(2) ] | oracle6-snapshot: FAIL expected [ …(2) ] to deeply equal [ …(2) ] |
| 45 | release-gates | gate: birth dates leaves the remaining players honestly without a date | 1 | oracle6: PASS | oracle6-snapshot: FAIL expected 110 to be 18 |
| 46 | release-gates | gate: club organizations and identities attaches every ladder row to t | 3 | oracle6: FAIL expected { slug: 'western-bulldogs', …(3) } to match object { from: 1997, to: 20 | oracle6-snapshot: FAIL expected { slug: 'western-bulldogs', …(3) } to match object { from: 1997, to: 20 |
| 47 | settle-afl-api-issue276 | <file-level> | 2 (fixed) | issue276: PASS | sf_276: PASS |
| 48 | settle-afl-api-state-b | <file-level> | 6 (stateb) | not run here (stateb scope) | not run here (stateb scope) |
| 49 | settle-afl-api | AFLDB-ISSUE-235 OD-5: observeLiveReinstatement() against real PostgreS | 1 | od5: PASS | sf_od5: PASS |
| 50 | v2-brownlow-eligibility-2025-rehearsal | <file-level> | 1 | b2-eligibility-2025: PASS | a-b2: PASS |
| 51 | v2-brownlow-production-correction | <file-level> | 1 | b1-production-correction: PASS | a-b1: PASS |
| 52 | v2-coleman-publication | <file-level> | 1 | coleman-rebuilt: FAIL(file) refusing to run: 1 Coleman 2001 row(s) already exist that this suite did not create; coleman-schema-only: PASS | sf_cole: FAIL(file) refusing to run: 1 Coleman 2001 row(s) already exist that this suite did not create |
| 53 | database | Brownlow correctness separates the war years from merely uncollected s | 2 | oracle6: PASS; war-shared-1: PASS | oracle6-snapshot: PASS; sf_db: PASS |

State-b (row 48) is owned by the stateb scope and was not run. Rows 50 and 51 ran on dedicated clones built only from the retained recipe and
hash-verified artefacts (they cannot use the rebuilt base; `brownlow-clones.sh`): both pass on the rebuild side in `evidence/final2/brownlow/` (B2 3/3 in 2.5 min, B1 8/8 in 38 min, `run.log`), as in phase A (3/3, 8/8) and in `evidence/final/brownlow/` at `82e03229`; the clones were built from the retained recipe and artefacts, so they do not depend on 2026 being complete.

## 8. Failures on the rebuild that are not among the 53 (report, nothing changed)

From `evidence/final2/oracle6.summary.txt` against phase A's snapshot run: failures new on the rebuild (pass on the snapshot, so rebuild and snapshot disagree and (b) fails):
* club-comparison: "reports Jarryd Lyons as Adelaide first, then Brisbane Lions" (id 6818 vs 6850), "treats Footscray and Western Bulldogs as one continuing organisation" (James Cook id 6711 vs 6743);
* release-gates: "birth dates populates 13,255 canonical dates with no conflicts" (rebuild 13,347), "keeps the evidence behind every recovered date" (14,294 vs 14,110), "matches players on the profile URL" (13,367 vs 13,275);
* gridley-corpus: "criteria has no probed dataset gap" (4 criteria, e.g. `anzac-playedin-1`) and "conforms to the bounded approved-deferral policy" (65 cells): the rebuilt dataset has criterion gaps the snapshot does not;
* club-comparison "long rivalry performance" x3 (the group ceiling 750 ms, the H2H Brownlow query ceiling 250 ms, the route-equivalent load 1,500 ms) failed in **both** earlier runs (`evidence/c1`, `evidence/final/oracle6`) at ~2.8-3.0 s warm medians. I first read that as host load; it was not: the `final` oracle6 run had the host to itself. Cause (measured, `evidence/it/perfa_nostats.*`, `perfb_stats.*`, `facts/facts5-planner-stats.txt`): the bridged copy that group runs on has **no planner statistics** after the DraftGuru import (56 `pg_stats` rows, 3 analysed tables, against 546 rows / 32 tables on the pristine restored template and 639 / 52 on the snapshot), so the planner chooses bad plans. On a copy of the bridged base: **3 failed** as is (`perfa_nostats`), **0 failed, 7/7 passed** after `ANALYZE` alone (`perfb_stats`; no data change). Runner defect, fixed in `8db4007d` (ANALYZE right after the bridge import, `evidence/final2/bridge-analyze.log.txt.gz`); in `evidence/final2/oracle6` the three pass. Not an application defect.

## 9. Application question F-1(a), reported not fixed

`recomputeBrownlowCoverage` (`src/db/queries/player-derived.ts:735-740`) maps the `brownlow_season_total` of a season that is not `in_progress`, has no
`brownlow_season_votes` rows and no `brownlow_vote_entry_state` decisions to **`not_applicable`** ("no medal was awarded", like 1942-45). For 2026 the
Brownlow was in fact awarded but is not yet loaded (rebuild and snapshot: `seasons` 2026 `complete`, 0 `brownlow_season_votes` rows for 2026, 188 for 2025,
0 entry-state rows). What the rebuild says today (`evidence/facts/facts1-rebuild.txt`): `brownlow_season_total`, `brownlow_round_votes`, `brownlow_match_votes` for 2026 all
**`pending`**, `is_recorded` false. After one recompute they become `not_applicable` / `partial` / `not_applicable 0/207` (`evidence/exp/red1-rows-after1b.txt`).

Exact callers: `src/lib/acquisition/afl-api-brownlow.ts:1722` (the AFL API Brownlow settle, guarded only by `anyCanonicalBrownlowChange`),
`src/db/queries/admin-brownlow.ts:1192` (after finalising or voiding a match) and `:1392` (after writing season rows, where `medal_awarded` becomes true).
Consequence: `not_applicable` is also what `admin-brownlow.ts:723` and `:1317` refuse to work in ("lockMatch refuses every Brownlow mutation in a season whose
season_total coverage is not_applicable", the comment at `player-derived.ts:659-668`), so the first automatic Brownlow settle of a completed season with no
published medal would both misreport the season as "no medal" and lock the admin workflow out of it. The code already handles that hazard for the
entry-state path (`w.decided > 0 -> partial`) but not for the settle path. This is an application and modelling question (owner), not a test question.

## 10. Owner decisions prepared (none taken)

1. **F-1(a)** (section 9). Options: (a) in the season-total `CASE`, keep a completed season with no accepted medal at `pending` unless it is a declared no-medal season (a small explicit list or a workflow decision), with a targeted regression on a base with a completed season; (b) leave the rule and keep the test hygiene fix only; (c) record as a limitation. Consequences: (a) changes a modelling rule and admin lock semantics; (b)/(c) leave the settle path able to lock a completed season. **Recommendation: (a)**, as a separate issue.
2. **Stale witnesses of club-comparison and release-gates** (28 ids, section 6). Options: (1) re-pin every listed witness to the c2 values (mechanical, `soft/*.list.txt` gives each), and replace the Lyons/Cook surrogate-id lookups by a stable key; (2) bound the witnesses to seasons <= 2025 (an independent SQL `season <= 2025` in both the oracle and the application call) so they do not go stale again when 2027 loads; (3) accept as a limitation. **Recommendation: (2)** for club-comparison ("latest", "current streak" cannot be re-pinned durably), (1) for the release-gates counts.
3. **The three "2026 is provisional" gates** (class 5). Evidence: on the accepted c2 baseline 2026 is `complete` (premier 1, wooden spoon 1; the only season in progress is 2027; 2026 Brownlow coverage `pending`). Options: re-point the gates to the current in-progress season and to "a completed season has a premier and a spoon"; keep them and run only on a base with 2026 in progress (not available: the register accepts only c2); retire. **Recommendation: re-point**.
4. **Coleman contract `expected_rows` 46** (awards-reload-links, class 5): the rebuild already holds 47 rows (1980-2026) because the derived loader materialises a winner for every completed season; the pin was measured while 2026 was in progress. Not edited (frozen). Options as in phase A: keep the pin and run only on an in-progress-2026 base; re-pin and derive the legacy-transition expectation from the family; accept. **Recommendation: re-pin and derive.**
5. **Birth-date gates and the rebuild's enrichment** (3 ids new on the rebuild, section 8): the c2 rebuild with the 2026-09-05 inputs holds 13,347 dates against the pins' 13,255. Frozen modelling pins; owner decides whether the pins follow the rebuild or the production snapshot. **Recommendation: pins follow the accepted rebuild.**
6. **Gridley**: run-2 accepted limitation N7 is unchanged (40 failing cells on both bases); two further Gridley assertions fail only on the rebuild (criteria gaps, 65 deferral cells). Owner to classify; no change made.
7. **Wildcard Finals in career `finals`** (section 5, INFO).

## 11. Findings and disclosures

| Id | Grade | Where | Summary |
|---|---|---|---|
| F-001 | MED | `src/db/queries/player-derived.ts:735-740`; callers section 9 | complete season with no accepted medal reads `not_applicable`; the AFL API settle would also lock the admin workflow; escalated to the spawner |
| F-002 | MED | `tests/integration/club-comparison.test.ts` (Lyons/Cook id witnesses), `tests/integration/release-gates.test.ts` (birth-date gates) | pins that differ between the production snapshot and the c2 rebuild (player surrogate ids, birth-date counts): modelling pins, owner decision |
| F-003 | MED | owner decisions 2-4 | 28 stale witnesses and the 2026-state gates need an owner decision; none edited here |
| F-004 | LOW | `settle-afl-api-brownlow.test.ts:180-182` | 3 pre-existing `no-explicit-any` lint errors (not in lines this scope changed) |
| F-005 | INFO | section 5 | `WF` has `is_final` true but `is_finals_series` false; career `finals` excludes it |
| F-006 | LOW | `run-rebuilt.sh` (fixed in `8db4007d`) | the bridged copy had no planner statistics, failing three performance ceilings; runner defect, not application |

Disclosures: (a) `node .phaneslight/scripts/cli.js new-file` was not used (the workstation has no Node); the evidence files are plain copies. (b) The Brownlow
artefacts were copied read-only from the retained DEV-host workspace `/home/arm/afldb-v2-brownlowverify-20261028` (as in phase A); nothing there was written.
(c) Diagnostic scratch files `tests/integration/zz-soft-*.test.ts` were created in the host checkout for the soft-assertion runs and removed by the same script
(`host-scripts/softrun.sh`); they were never committed. (d) Single-file groups ran without the heavy lock (as in phase A); restore, oracle6 and the Brownlow clones took it.
(e) The first run (`evidence/c1`, `641ccd1a`) overlapped a snapshot-template restore and a soft diagnostic run on the host; I first attributed its three timing failures to that, which the later quiet run disproved (section 8: missing planner statistics).
(f) My scratch databases were dropped with `drop-db --acknowledge-destroy` between the runs (my own cluster only); before `final2` every database except the snapshot template and the `sf_*` snapshot copies was dropped so the whole runner (restore included) ran afresh at `8db4007d`. (h) The ANALYZE experiment (`perfa_nostats`, `perfb_stats`) ran on scratch copies at `82e03229` before the runner fix; `perfb_stats` used one `ANALYZE` statement through `isolated-pg run`, no data change. (g) The 2026 `stat_availability` of the
snapshot copy was never modified by a green run (rows md5 identical before and after).

## 12. Evidence layout

* `evidence/final2/`: the full runner at the final HEAD `8db4007d` (`run.log.txt.gz`, `verdicts.tsv`, per-group vitest JSON `*.json.gz`, `*.summary.txt`, logs with ANSI and any `postgres://` line removed, Brownlow clones in `brownlow/`).
* `evidence/final/`: the earlier full runner at `82e03229` (same layout; three performance failures, no ANALYZE). `evidence/c1/`: the first full run at `641ccd1a` (restore, identity, table-count diff, bridge import, the red war-years mechanism and the issue276 refusal).
* `evidence/exp/`: war-years red/green experiments; `evidence/it/`: single-file runs on fresh copies (database, issue276, perf, snapshot finals `sf_*`); `evidence/soft/`: diagnostic soft-assertion lists.
* `evidence/facts/`: read-only SQL facts (`facts1-4` for rebuild and snapshot, `facts5-planner-stats.txt`), `tsc.out`, snapshot template probe. `host-scripts/`: every script that ran on the host, plus the SQL files.
* `SHA256SUMS`: every committed raw file; verify with `git cat-file blob HEAD:<path> | sha256sum`.
