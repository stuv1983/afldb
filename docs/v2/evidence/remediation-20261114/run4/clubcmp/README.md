# Remediation run 4, scope `clubcmp`: club-comparison, the four `database` witnesses, Gridley classification

Branch `claude/rem4-clubcmp-20261115` (base B4 `7cfbe186e70ca91db67da1aa4e28325ccbc32a86`), worktree `D:\dev\afldb-rem4-clubcmp`, host `streamanator`,
workspace `/mnt/ssd/afldb-rem4-clubcmp-20261115`, cluster `/mnt/ssd/afldb-rem4-clubcmp-20261115-pg`, **port 55683**, host checkout `cand` (verified
bundle of B4, no `.env`, `npm ci` done). Every database command ran through `isolated-pg run` on port 55683; a fresh `--template` copy per
experiment; no push, no production, no DEV service, no `afldb_test` on :5432, no sudo, no wsl. Nothing under `src/` changed. Only two test files
changed: `tests/integration/club-comparison.test.ts` and `tests/integration/database.test.ts`. No test title was renamed, no test deleted, skipped
or weakened, no fixture committed (so there is nothing for `tests/integration/leaked-fixtures.ts`: the scratch season used is **2067**, prefix
`CD_I4030`, scratch databases only; section 8 records the collision check).

## 1. Result

Six-class vocabulary (1 passes under intended conditions; 2 actual defect fixed with red/green; 3 stale assertion; 4 deliberate refusal;
5 limitation awaiting owner; 6 not run / blocked):

| Ids | Class | State |
|---|---|---|
| `club-comparison` 24 ids (13 historical-witness families, see section 3) | **3** stale assertion (witness measured before 2026 completed) | corrected; green on both bases, both modes |
| `club-comparison` "reports Jarryd Lyons ..." (6818 vs 6850) and "treats Footscray and Western Bulldogs as one ..." (Cook 6711 vs 6743) | **3** stale assertion (surrogate `players.id` differs between the snapshot and a rebuild) | corrected: players resolved by AFL Tables profile identity; green on both bases |
| `database` x4: "has the full player-match dataset" (685,471), "200-249 games with 16 or more finals" (114), "50-199 goals and no Brownlow votes" (261), "200+ games, 100+ goals and 15+ finals" (219) | **3** stale assertion (would go stale the moment another season completes) | corrected: oracle on all seasons AND oracle <= 2025 = literal; proven by the synthetic-2067 probe |
| `gridley-corpus` "has no probed dataset gap" and "conforms to the bounded approved-deferral policy" | **5** limitation awaiting owner (not a test defect, not the 363-W class) | classified in section 7, no change made |
| `gridley-corpus` run-2 limitation N7 (40 failing cells, both bases) | **5** | unchanged, untouched |

## 2. Method (owner decision 363-W)

* The query API `src/db/queries/club-comparison.ts` takes no season bound, so a bound cannot be passed to the application. Instead every assertion
  is two statements: (a) the **application equals the independent raw-SQL oracle over all seasons** (so a wrong application still fails, today and
  after 2027); (b) the **historical literal is pinned on the same oracle bounded to `m.season <= 2025`** (`HISTORY_THROUGH`), so it cannot move when
  a later season completes. No expected value is computed by the implementation under test; the oracles are plain joins over `matches`,
  `clubs`, `player_match_stats`, `brownlow_season_votes` (`oracle*` helpers, each with an optional `through` bound).
* **Stable player keys.** Surrogate `players.id` is not stable: Lyons 6818 (snapshot) / 6850 (rebuild), Cook 6711 / 6743, Keays 1103 / 1109,
  Brad Johnson 2068 / 2076. Every named player is resolved by `external_identities` (source `afltables`, `external_id` `players/<initial>/<Name>.html`,
  trusted status `unique`/`resolved`) through `playerIdByProfile()`, which asserts exactly one row. Verified on both bases with identical date of
  birth / debut / final season: Jarryd_Lyons (1992-07-22, 2012-2024), James_Cook (1974-01-07, 1994-2000), Ben_Keays (1997-02-23), Brad_Johnson
  (1976-07-18), Charlie_Cameron.html (the 2014 debutant; four players are called Charlie Cameron), Tom_Doedee, Martin_McKinnon, Simon_Black,
  Taylor_Walker, Michael_Voss, Alastair_Lynch, Matt_Crouch, Lachie_Neale, Rory_Laird, Josh_Dunkley, Izak_Rankine, Andrew_McLeod,
  Hugh_McCluggage, Scott_Thompson0 (1983, 2001-2017; `Scott_Thompson1` is a different player, 1986, 2008-2019).
* Match ids <= 2025 are identical on both bases (finals 12275 / 12463 etc. are literal); 2026 match ids differ (Adelaide v Lions 2026: 16899 and
  17053 on the rebuild, 17251 and 17270 on the snapshot), which is why nothing historical may be pinned on an unbounded result.

## 3. Provenance of every pinned literal

Each literal below is the measured ISSUE-144 witness, re-measured here with the bounded (<= 2025) oracle on **both** bases and found identical;
the test asserts it as `oracle(through 2025) == literal`, and `application == oracle(all seasons)` separately.

| Literal(s) | Bounded-oracle measurement (both bases) |
|---|---|
| Adelaide v Brisbane Lions 41 meetings: 19 / 21 / 1 (A wins / B wins / draw), 39 home-and-away, 2 finals (ids 12275, 12463), era counts 5 / 15 / 13 / 8, pagination 25 + 16, Gabba 25 / 11 / 14 / 0, Adelaide Oval 7 / 1 draw | `oracleSummary/oracleMeetings(adelaide, lions, 2025)`; all 2026+ meetings dropped (2026: 2 meetings, both won by the Lions) |
| records 138 / 141 / 1 / 177 / 189 / 39 / 249 / 44 and their tie ids; streaks 7 (14177 -> 15346, 2013-2018) / 6 (12275 -> 12710) / current A-win 16729 | `oracleRuns(... 2025)` implements the documented streak contract over the chronological bounded meetings |
| Brisbane Bears + Fitzroy kept out of Lions totals: 41; Carlton v Collingwood 268 meetings, 22 finals; decades table and points | bounded oracle (2026: 2 further Carlton v Collingwood meetings, hence 270 unbounded) |
| crossover Adelaide / Lions: 11 players (Cameron 73 + 181 = 254, Keays Adelaide 131 / Lions 30, Lyons 55 / 102, Doedee latest completion 2025-08-09); Carlton / Bulldogs crossover 40 both ways; Cook 49 / 96; Brad Johnson 364; McKinnon first 1999-05-01 | `oracleCrossoverThrough(...)` from `player_match_stats` bounded to 2025; the unbounded `player_clubs` oracle gives 12 (adds Callum Ah Chee 2026-03-14, Keays 156) |
| H2H leaders: Simon Black 23 / Taylor Walker 20 / Michael Voss 16 games; Walker 54 goals; Lynch 45; Cameron games 14 / 5 / 9 and goals 32 / 8 / 24; single-match goals 7 x 5 and disposals 40 x 4; goal assists 14 / 5 / 9 and 9 / 8 / 17 | `oracleH2HPlayers(... 2025)`, `oracleH2HStatRows(... 2025)` |
| H2H Brownlow: 39 eligible, 39 covered; named witnesses Scott_Thompson0 / Voss / Black | `oracleH2HMatchVotes(... 2025)`; the application is held to the all-seasons oracle, `coverage` expected as `covered === eligible ? 'complete' : 'partial'` (src rule, `getHeadToHeadBrownlow`) |
| averages: top three Crouch 7 / 30.71, Neale 8 / 29.75, Laird 14 / 28.86; boundary Dunkley 5 / Rankine 4; rank-ten tie McLeod / McCluggage 11 games, total 9 | `oracleAverages(... 2025)`, `oracleAverageSplit`, `oracleRecordedGames` |
| period coverage 41 / 268 | `oracleMeetings(..., 2025)` lengths; the application equals the all-seasons oracle |

One assertion is intentionally unchanged: `getClubSeasonBrownlowSummary(lions, 2026)` expecting `pending` (finding F-CC-1, section 9).

## 3a. The `database` witnesses and release-gates "exact 261 players" are one fact

`database` "50-199 goals and no Brownlow votes" and `release-gates` "exact 261 players" assert the same cohort. This scope owns the treatment; scope
`gates` adopts the same definition (copy `oracleCohorts` from `tests/integration/database.test.ts`). Definition, from `player_match_stats` joined to
`matches` (never from `player_career_stats`, which is the thing under test): per player `goals = sum(s.goals)` (NULL goals are never coerced), cohort
= `goals BETWEEN 50 AND 199` and no `brownlow_season_votes` row with `votes > 0` and `season <= through`. Measured on both bases: **261 through
2025, 268 over all seasons**. Likewise 114 / 120 (200-249 games, >= 16 finals, `finals` = `is_finals_series`), 219 / 223 (200+ games, 100+ goals,
15+ finals) and 685,471 / 695,499 rows (2026 holds 10,028). The application's `player_career_stats` is asserted equal to the all-seasons oracle, and
the historical literal equal to the <= 2025 oracle. Modelling note: `is_final` and `is_finals_series` differ only for the 2026 Wildcard Finals
(92 rows); career `finals` counts `is_finals_series`.

## 4. Red / green (exact failure texts, unmodified B4 file vs this scope's file)

Per-file mode (`AFLDB_TEST_PER_FILE_DB=all`) on pristine fresh template copies; "shared" is one database for the run. Raw: `evidence/*.summary.txt`.

| Run | B4 file | This scope's file |
|---|---|---|
| `database` rebuild / snapshot, per-file and shared | 69 / 69 pass (witnesses were frozen at the accepted baseline) | 69 / 69 pass |
| `club-comparison` rebuild, per-file | **26 failed** / 70 (24 historical + Lyons `expected 6850 to be 6818` + Cook `expected undefined to be 'James Cook'`) | 70 / 70 (see section 6 for the timing note) |
| `club-comparison` snapshot, per-file | **25 failed** (the same 24 + the unlocked timing test) | 70 / 70 |
| `club-comparison` shared | (not run on B4) | rebuild 69 / 70 unlocked (timing), snapshot 70 / 70 |

Representative B4 failure texts on the rebuild: `expected 43 to be 41` (Adelaide v Lions meetings, summary, venues, period coverage),
`expected 270 to be 268` (Carlton v Collingwood), `expected 12 to be 11` and `expected [ …(11) ] to have a length of 11 but got 12` (crossover),
`expected 156 to be 131` (Keays), `expected 'b-win' to be 'a-win'` (current streak), `expected 16 to be 14` (Cameron games), `expected 57 to be 54`
(Walker goals), `expected 7 to be 5` / `expected 1 to be 2` (average boards).

## 5. Staleness probe: a synthetic later COMPLETED season

`evidence/synth2067.sql` (scratch only, never committed as a fixture, prefix `CD_I4030`, season 2067, run only against disposable template
copies) inserts a completed season 2067 with: one home-and-away game for a player at 199 games and >= 16 finals, one for a player at 49 goals and
no Brownlow votes (3 goals), one elimination final for a player at 14 finals with 200+ games and 100+ goals, one Adelaide v Brisbane Lions
home-and-away meeting (Lions win, Keays and Cameron rows), cumulative period scores (period 4 = full-time), a `club_seasons` ladder row per
participant, `stat_availability` rows copied from 2026, and rolls the active clubs' `last_season` forward (as production would). Derived tables are
rebuilt with `rebuild_derived.py --targets player_clubs player_career_stats`. Cohorts before / after: rows 695,499 -> 695,505 (the synthetic rows),
200-249/16 120 -> 121, 50-199 no votes 268 -> 269, 200/100/15 223 -> 224.

| Probe | B4 file | This scope's file |
|---|---|---|
| `database` on synthetic 2067, rebuild and snapshot | **4 failed**: `expected 224 to be 223`, `expected 121 to be 120`, `expected 269 to be 268`, `expected 695505 to be 695499` | **69 / 69** both bases |
| `club-comparison` on synthetic 2067 | rebuild 27 failed, snapshot 24 failed | **70 / 70** both bases |

Pristine bases are green for both files (section 4), so the two files agree with the data both before and after a later season completes.
Findings from earlier, less realistic synthetic seasons (no ladder, no period scores, no club lifespans) were synthetic-data artefacts of the
probe, not of the tests, and the probe script was completed accordingly; they are not tests changes.

## 6. Performance (long rivalry performance, 750 ms / 250 ms / 1,500 ms ceilings)

The performance tests are untouched by this scope (the diff does not enter `describe('club comparison: long rivalry performance')`). Under the
heavy lock they pass: `evidence/heavy_rb_pf_cc.summary.txt` (70 / 70, rebuild) and, in the final runs, both bases in both modes
(`evidence/c1_*.summary.txt`: 139 / 139 each). Warm medians in the final runs (`c1_rb_pf.log.gz`, `c1_snap_pf.log.gz`, 5 runs each):
`getHeadToHeadBrownlow` 35.7 / 32.2 ms (Adelaide v Lions) and 69.3 / 71.4 ms (Carlton v Collingwood); `getClubBrownlowHistory (A)` 232.0 / 233.9 ms and
239.2 / 241.3 ms; the extended-rivalry parallel group 39.5 / 42 ms. Pristine restored templates carry planner statistics, so no `ANALYZE` was needed
(the run-3 bridged-copy `ANALYZE` finding does not apply); the bridged template was not built in this scope.

Caveat (F-CC-2): the 250 ms ceiling has only 8-20 ms of headroom on `getClubBrownlowHistory (A)`. Unlocked runs under host load 10-11 failed it
(B4 snapshot 250.4 ms; this file 255.8 ms `new_rb_shared_cc`, 311.4 ms `newrbpf_cc`, 257.4 ms `newrbsh_cc`; the test body is unmodified),
and passed the same code once the host was quiet or the lock was held. These unlocked failures are kept in the evidence deliberately; they are a
property of the ceiling and host load, not of this scope's change.

## 7. Gridley classification (no oracle, corpus or test change)

The two assertions fail only on the rebuild: "has no probed dataset gap, unless run in diagnostic mode" (4 criteria: `anzac-playedin-1`,
`anzac-won-1`, `bigfreeze-playedin-1`, `dreamtime-playedin-1`) and "conforms to the bounded approved-deferral policy" (65 cells; the test reports a cell that
reads a gapped criterion as category `dataset gap`, `gridley-corpus.test.ts:561`, which the policy does not approve; the cell count is run 3's measurement,
not re-measured here). The probe values and the run-3 log line are in `../../run3/integb/evidence/final2/oracle6.log.txt.gz` (`gapped criteria: anzac-playedin-1,
anzac-won-1, bigfreeze-playedin-1, dreamtime-playedin-1`).

**Cause: not the completed-2026 / 363-W class.** The probe `gaps.matchEvents = count(matches.match_event IS NOT NULL) > 0` is false on the rebuild
(0 rows) and true on the snapshot (64 rows: Anzac Day 31, Dreamtime at the 'G 22, King's Birthday 11). The 64 labels are the GAP-029 Block L
corrections, written through the audited Data Editor (`saveEdit`), whose replay rows live in `data_overrides`: the rebuild holds **0**
`data_overrides` rows, the snapshot **165** (64 `matches/match_event`, 92 `players/identity`, 8 `draft_picks/selection`, 1
`player_match_stats/lineup`). The rebuild is built from sources and does not carry the administrator-curated state. The other dataset probes are
equal or better on the rebuild (heights 12,579 v 12,487, dates of birth 13,347 v 13,255, after-the-siren 125 v 120; linked draft picks only after
the DraftGuru bridge, the run-3 bridged template reports `draftLinks true`).

**Proposed fix.** Not a test edit. Either (a) the rebuild runbook carries an explicit "apply GAP-029 labels" stage (the isolated applier
`tools/v2/apply-gap029-match-events.ts` validates all 64 ids first; ids <= 2025 are identical on both bases, the three 2026 ids differ on the
rebuild, so it needs an evidence file keyed to the rebuild's 2026 ids or a <= 2025 subset), or (b) the owner accepts that the rebuilt dataset is
not Gridley-acceptance-complete and the two assertions are recorded as "rebuild lacks admin overrides". **An owner decision is needed** on whether
the rebuild must reproduce `data_overrides`. I did not apply the applier and did not run the full Gridley corpus on a labelled rebuild copy, so
that the 65 cells disappear after labelling is inferred from the mapping, not measured here.

## 8. Season and prefix collision check

Season 2067 and match-key prefix `CD_I4030` are used nowhere in `src/`, `tests/`, `tools/`, `docs/` (the prefix appears only in this run's brief) and
exist in neither base (`seasons` 2067 / 2068: 0 rows; `matches` 0; `external_identities` / `matches.match_key` prefix: 0). The comment in
`tests/integration/admin-brownlow.test.ts:1613` lists 2068 among seasons "claimed elsewhere", which is why the probe used 2067 only. Nothing is
committed that creates either; there is no `COMMITTING_SUITES` entry to add.

## 9. Findings

* **F-CC-1 (LOW):** `club-comparison` "getClubSeasonBrownlowSummary(lions, 2026) is `pending`" will fail the day the 2026 Brownlow loads. Left unchanged
  (brownlow-scope / D-365-1 territory); it is the one remaining time-dependent assertion in the file.
* **F-CC-2 (INFO):** the three long-rivalry performance tests are load-sensitive (the 250 ms Brownlow ceiling failed at 250.4 ms and 255.8 /
  311 ms under host load 10-11 when run unlocked); they pass on the same code under the heavy lock (section 6).
* **F-CC-3 (INFO):** the Wildcard Final modelling note in section 3a (`is_final` v `is_finals_series`).

## 9a. Proposed ledger text and CHANGELOG lines (not applied by this scope)

`issues.md` ISSUE-363, scope `clubcmp` entry: "club-comparison (24 + Lyons/Cook surrogate-id) and the four `database` witnesses re-pinned under owner
decision 363-W: each assertion holds the application to an independent raw-SQL oracle over all seasons and pins the historical literal on the same
oracle bounded to season <= 2025; named players resolve by AFL Tables profile identity. Green on the accepted rebuild and the 4 Nov snapshot, in
per-file and shared modes (139 / 139 with `database`), under a synthetic completed season 2067 (B4 red: 4 `database`, 24-27 `club-comparison`; new
green), `tsc` rc 0, `lint:gate` passed (338 / 43 unchanged). Gridley `has no probed dataset gap` and `conforms to the bounded approved-deferral
policy` fail only on the rebuild because it carries 0 `data_overrides` (64 GAP-029 match-event labels live in the snapshot's 165): owner decision
needed on whether the rebuild must reproduce administrator overrides; no test change made."

`CHANGELOG.md` (Unreleased, tests): "Test: club-comparison and database integration witnesses are bounded to seasons through 2025 on an independent
oracle (application held to the all-seasons oracle), players resolved by AFL Tables identity, so a later completed season or a rebuild no longer
makes them stale (ISSUE-363)." No application behaviour changed.

Classification vocabulary ids (section 1): club-comparison 24 + 2 = class 3; database 4 = class 3; the two Gridley assertions = class 5 (owner
decision pending), N7 unchanged class 5.

## 9b. Incidents (none is a boundary breach)

* First launch of the unmodified-B4 runs used a hyphenated database name (`afldb_v2_*_b4-rb-pf_test`); `isolated-pg` refused it and the queued
  wrappers waited on the heavy lock; I killed my own three wrapper processes (pids 2862926 / 2862843 / 2862842) and relaunched with underscore
  labels. A later relaunch likewise killed my own wrapper chain (2873209 / 2873083 / 2869838) so the B4 baseline could run without holding the lock
  during the long queue.
* One mistaken invocation re-ran `onsynth.sh ... database.new.test.ts` against a file that no longer existed and overwrote `b4_synth_rb_db.log`; the
  synthetic season was rebuilt (final `synth2067.sql`) and every synthetic run repeated, so the committed `b4_synth_*` / `new_synth_*` evidence is from
  the final base.
* I removed my two scratch `*.b4.test.ts` copies while a queued `lint:gate` was starting; ESLint aborted (`lint-gate-new-aborted-by-own-file-removal.log`)
  and was re-run (`lint-gate-new.log`, then in the final run). An orphaned queued `lint:gate` flock of mine (pid 3138979) was killed.
* Scratch probe databases (`afldb_v2_rem4clubcmp_probe_rb_test`, `..._probe_sn_test`, synthetic bases) are dropped before the final report.

## 10. Files and final state

Code commit `f368d275d8309cf53bfc19eeca0e65521afb1a9e` (the two test files only) is the commit every `c1_*` run qualified: host checkout `HEAD` equal to
it, `git status --porcelain` empty (`evidence/c1_porcelain.txt`, 0 lines), blobs `41e17281...` (club-comparison) and `d1106a4c...` (database)
(`evidence/c1_test-blobs.txt`), `tsc` rc 0 (`evidence/c1_typecheck.log.gz`), `lint:gate` passed 338 errors / 43 files, equal to the baseline
(`evidence/c1_lint-gate.log.gz`), `database` + `club-comparison` 139 / 139 on the accepted rebuild and the 4 Nov snapshot, per-file and shared, under the
heavy lock. The commit that adds this directory changes no file outside `docs/v2/evidence/remediation-20261114/run4/clubcmp/`; the final report
records its SHA and the host re-verification.

`evidence/` holds every run's `*.summary.txt` (failure texts), gzip JSON and logs, the scratch scripts (`scripts/`, including `synth2067.sql`),
cohort measurements and `tsc` / `lint:gate` output; `SHA256SUMS` covers every file under `evidence/` (each checked against the committed blob).
