# Run 4, scope `gates`: release-gates 363-W / 363-G / 363-B

Worker `afldb-worker`, 2026-11-15. Branch `claude/rem4-gates-20261115`, base B4 `7cfbe186e70ca91db67da1aa4e28325ccbc32a86`.
Code commit (the only code change): **`aade0feb6af5be57014898bff492cbaa19e7c92e`**, `tests/integration/release-gates.test.ts` (the only
repository file outside this directory that changed). The commit that adds this record changes nothing else (proved at the end, section 9).
Host workspace `/mnt/ssd/afldb-rem4-gates-20261115`, cluster `…-pg`, port 55682, databases `afldb_v2_rem4gates_*_test` / `afldb_v2_rb_rem4gates_*_test`.
Fixture seasons 2065 and 2066, prefix `CD_I4020`, **rolled back only** (nothing is committed by this file).

## 1. Result

| Base | Mode | B4 (before) | `aade0feb` (after) |
|---|---|---|---|
| accepted rebuild (`afldb_v2_rb_rem3-6d5388ea.dump`) | per-file `=all` | 67 tests: **9 failed**, 51 passed, 7 skipped | 75 tests: **0 failed**, 68 passed, 7 skipped |
| accepted rebuild | shared | 9 failed (same 9) | **0 failed**, 68 passed |
| 4 Nov snapshot (ledger 118) | per-file `=all` | 8 failed | 5 failed, 63 passed (section 5: every one pre-registered or pre-existing) |
| 4 Nov snapshot | shared | 8 failed | 5 failed, 63 passed |

"Shared" here is this file run alone in vitest with `AFLDB_TEST_PER_FILE_DB` unset against one fresh copy. The other 98 integration files were
not run (that is the orchestrator's qualification). The one interaction worth checking was: the only other committed fixture that touches a
season in this file's range, `brownlow-pending-projection.test.ts` (season 2066), run first in the same database and then this file
(`evidence/seq.out`): 8/8 then 68 passed on the rebuild, 8/8 then the same 5 pre-registered failures on the snapshot, and no season 2065 or 2066
row left in either database afterwards.

The 9 B4 failures on the rebuild are exactly run 3's `evidence/soft/rg1.list.txt` ids: "exact 261 players", "records why each attendance is
missing", "attaches every ladder row", the three birth-date ids and the three "2026 is provisional" gates. On the snapshot the 8 are six of those
(261, attendance, ladder, the three provisional) plus two class-1 environment ids ("Brownlow authority agrees with the canonical round votes",
"birth dates leaves the remaining players") that were already failing at B4 and are not among this scope's targets.
Raw verdicts: `evidence/it/b4_*.json.gz` and `evidence/it/fa_*.json.gz`; every command line is in `scripts/`.

## 2. 363-B provenance: why the rebuild says 13,347, not 13,255

Question: which committed inputs produce the rebuild's numbers? Answer, measured on both bases with `scripts/facts1.sql`, `facts3.sql`
(`evidence/facts/`):

| Quantity | pin (2026-09-06) | accepted rebuild | 4 Nov snapshot |
|---|---|---|---|
| players | 13,273 | 13,365 | 13,365 |
| dated players | 13,255 | **13,347** | 13,255 |
| …of which dated from a club list (`afltables_club_list`) | 12,400 | 12,400 | 12,400 |
| …of which dated from fitzRoy per-match stats (`fitzroy_player_stats`) | 855 | **947** | 855 |
| `player_birth_evidence` rows | 14,110 | **14,294** (947 + 13,347) | 14,110 |
| unique `afltables_profile_url` identities | 13,275 | **13,367** | 13,275 (+ 92 with status `resolved`) |
| undated (`dob_confidence = 'unknown'`) | 18 | 18 | **110** |
| players who debut after 2025 (the 2026 debutants) | 0 | 92, all dated | 92, none dated |
| the same figures over players who are not 2026 debutants | | 13,255 / 14,110 / 13,275 / 18 | 13,255 / 14,110 / 13,275 / 18 |

Cause. The pins were measured on the 2025-terminal fitzRoy baseline. The accepted rebuild uses `c2-2026-final-core-v1` (the register's single
accepted entry), which adds season 2026 and 92 players who debuted in it. Every one of the 92 carries a fitzRoy per-match date (855 + 92 = 947)
and is reached by a club-list row (the same `club-lists-20260905` manifest, so the 12,400 club-list-filled dates do not change): dated 947 + 12,400
= 13,347, evidence 947 + 13,347 = 14,294, unique profile identities 13,275 + 92 = 13,367. The loader
(`tools/migration/enrich_birth_dates_afltables.py`) and the club-list manifest (`run3/rebuild/inputs.tsv`, sha256 `e6d5ae26…`) are the same in both
measurements; only the fitzRoy core changed. The tracked contract already records exactly this as its "C2 SUCCESSOR"
(`tools/rebuild/afltables/afltables-contract.json` `club_player_lists.accepted_snapshot.measured`: `players_with_dob` 13,347 =
947 + 12,400, 13,352 paths resolve = 13,260 + 92 debutants, 12 renumbered profiles unresolved, 5 blank cells; reproduced by the isolated rehearsal at
`5643f5c2`), and the register records `c2-2026-final-core-v1` `identity_scan.distinct_urls` 13,367 (`data/reference/fitzroy-accepted-baselines.json`).
The snapshot (production) never ran the club-list stage for its 2026 debutants: they have identity rows with status `resolved`, no date and no
evidence, so it shows 13,255 / 14,110 / 13,275 / 110. That is a real difference between the two databases, not a stale test.

Independence of the new expected values. The population literals are cross-checked, inside the test, against the two tracked files above (read
with `readFileSync`, never produced by the loader or the database): `measured.players_with_dob`, `measured.players_with_club_list_birth_evidence`
and `identity_scan.distinct_urls`. The historical literals are the 2026-09 measurements, re-measured here over a raw-SQL scope
(`min(season) > 2025` excludes the 2026 debutants). The club-list evidence row count is asserted equal to the linked count (the contract's
`players_with_club_list_birth_evidence = players_with_dob`), an independent decomposition of the 14,294.

## 3. What changed, assertion by assertion

All in `tests/integration/release-gates.test.ts`. Test ids that were renamed (the failure ledger must map them):

| Old id (B4) | New id | Notes |
|---|---|---|
| `Advanced Search regression cases 50-199 goals and zero Brownlow votes returns the exact 261 players` | `… returns the cohort an independent oracle derives (261 through 2025)` | 363-W |
| `absence is never zero records why each attendance is missing` | unchanged | 363-W |
| `club organizations and identities attaches every ladder row to the identity trading that season` | unchanged | 363-W |
| `birth dates populates 13,255 canonical dates with no conflicts` | `… populates the canonical dates with no conflicts (13,255 historical, 13,347 on the accepted rebuild)` | 363-B |
| `birth dates keeps the evidence behind every recovered date` | `… (14,110 historical, 14,294 on the accepted rebuild)` | 363-B |
| `birth dates matches players on the profile URL rather than the name` | `… (13,275 historical, 13,367 on the accepted rebuild)` | 363-B |
| `birth dates leaves the remaining players honestly without a date` | unchanged | adds the scoped 18; 110 on the snapshot unchanged |
| `2026 is provisional (snapshot-pinned) reports 2026 Brownlow as pending, never as zero` | `a season in progress is provisional (established by this file, rolled back) reports Brownlow as pending, never as zero` | 363-G |
| `… awards no premier and no wooden spoon for 2026` | `… awards no premier and no wooden spoon` | 363-G |
| `… is the only season still in progress` | `season status structure has at most one season in progress, and it is the latest` | 363-G |

New tests: `is a genuine in-progress season with something for each contract to protect`, `carries an explicit as-at date and is not completed`,
`leaves nothing behind: the fixture is rolled back`, three `detects …` tests (Brownlow, honours, status/as-at), and in `season status structure`
`detects a second season in progress and an in-progress season that is not the latest` and `accepts exactly one season in progress when it is the
latest, and none at all`. The two `it.skip` tests keep their text.

### 363-W (3 ids)

* **261 cohort.** Two claims, kept apart. (1) The service result, mapped to AFL Tables profile keys (stable), equals an independent raw-SQL
  oracle `oracleCohortKeys(null)` written in the test: goals summed from `player_match_stats`, Brownlow from `brownlow_season_votes`, nothing from
  `player_career_stats` or the search service; a returned player without exactly one key fails (`served.length === ids.length`). (2)
  `oracleCohortKeys(2025)` is the historical 261, and its two membership digests are the **original ISSUE-113 pins**
  (`ca65f15239aaf0b5` legacy order, `79d3e6eea83a4620` canonical) reproduced from the oracle, not read back from the service. That the
  oracle's 2025-bounded membership reproduces the 2026-08 digests on both bases is the proof the historical cohort is unchanged. The "re-derive
  the fingerprints over stable keys" instruction is satisfied by construction: the digests were always over profile keys (never surrogate ids);
  what moved from 261 to 268 is the cohort, not the key. Every season loaded: 268 on both bases (`facts1-*.txt`). The raw-SQL oracle is the same
  shape `clubcmp` is asked to use for `database.test.ts` "50-199 goals and no Brownlow votes" (the orchestrator reconciles; `database.test.ts`
  is not touched here).
* **Attendance.** (1) every season: the distinct (status, missing) pairs are exactly `complete/figure` and `not_collected/missing` (the stored
  contract that absence says why it is absent and is never a zero; `matches_attendance_status_ck` makes `complete` and a figure agree in both
  directions, and every writer in `src/` only ever writes `complete` or `not_collected`, so the exact pair set is the old test's claim stated without a count). (2) through 2025: the same
  literals 15,187 / 1,651 (baselines `full-history-20260827` and `…0902`, `measured.attendance_known` 15,187; 15,187 + 218 matches of 2026 =
  15,405 = c2's `measured.attendance_known`, so the unbounded count moved when 2026 completed).
* **Ladder.** Keyed by club slug. Through 2025 (explicit `cs.season <= 2025` in the query): the same ranges and the 101/128/101 partition (independently
  derived from the ladder source by `tests/python/ladder_identity_contract.py`). Every season: no ladder row of the six identities sits outside the
  years that identity traded (literal club-history windows; the three open-ended identities have no upper bound), a stronger statement than the
  old range and immune to the next season.

### 363-G (3 gates)

* **No lookup of "the" in-progress season.** The provisional-season contracts run on season 2065, built in a transaction that always ends in a
  throw (`inRolledBackTransaction`): four real clubs read by slug (never written), four home-and-away matches over two rounds, eight synthetic
  players `CD_I4020-2065-c<i>-p<n>`, derived with the production recompute functions in production order (`recomputeSeasonMetadata`,
  `recomputeClubSeasons`, `recomputePlayerDerivedStats`, `recomputeBrownlowCoverage`, `recomputeSeasonBrownlowStatus`). The ladder has a unique last
  place (a wooden spoon would exist on a completed season) and eight player-season rows exist (a vote could be written): asserted, so no
  contract is vacuous. Contracts: three Brownlow grains `pending` and unrecorded; no `brownlow_season_votes`, `brownlow_round_votes`,
  `player_match_stats.brownlow_votes` or `player_season_stats.brownlow_votes` (a 0 counts) rows; every `player_season_stats.brownlow_status`
  `pending`; no premier, no spoon, no player premiership; status `in_progress`, `completed_at` NULL, `data_through_date` = the literal `2065-03-20`,
  `last_loaded_round` set. Expected values are literals chosen in the test; none comes from the code under test. The completed-season "pending"
  case belongs to D-365-1 (scope `brownlow`) and is not duplicated.
* **Structure on the real table.** `inProgressStructureViolations`: at most one `in_progress` season and it is the latest. It asserts the
  invariant, never existence: the 4 Nov snapshot has none, the accepted rebuild has 2027, both satisfy it (`expected [] to deeply equal [2026]` on
  the snapshot at B4 was the vacuous-pass shape this issue removes). Positive controls in a rolled-back transaction: normalise the real table, then
  exactly one latest season (accepted), and none (accepted), so the check cannot be "always violating".
* **Non-vacuity, permanent.** Each check has a `detects …` companion that corrupts the same fixture and requires the check to say so
  (`pss_brownlow_grain_ck` already refuses a vote under a non-`complete` status, so the zero vote is written together with the settled status that
  makes it the lie): zero vote, settled and `not_applicable` statuses, `complete`/`not_applicable` grains, a published season row, a premier, a
  spoon, a player premiership, a completed season, a missing as-at date, a second open season, an open season that is not the latest.
* **Non-vacuity against the product (mutation red, evidence below).** The same assertions fail when the production derivation is broken.

### 363-B (3 ids plus the related one)

Each test asserts two scopes in order. HISTORICAL (players not first appearing after 2025): the 2026-09 literals, which hold on both bases and
are calendar-independent. POPULATION (all players): the accepted-rebuild literals 13,347 / 14,294 / 13,367 (and 18 undated), cross-checked against the
tracked contract and register. The population pins are **base-dependent on purpose** (section 5) and are not made adaptive.

## 4. Provenance of every new or changed literal

| Literal | Where | Provenance |
|---|---|---|
| 261, `ca65f15239aaf0b5`, `79d3e6eea83a4620` (oracle through 2025) | 261 gate | measured 261 on both bases (`facts1-*.txt`, "thru25_bsv"); equals ISSUE-113 pin and run 3 `facts3` (261); digests = original pins reproduced from the oracle |
| 15,187 / 1,651 through 2025 | attendance | `facts1-*.txt`; register baselines `full-history-20260827`/`0902` `measured.attendance_known` 15,187; 16,838 − 15,187 = 1,651 |
| ranges 1925-1996 / 1997-2025 / 1897-1981 / 1982-2025 / 1999-2007 / 1925-2025, 101/128/101 | ladder | unchanged literals, now bounded in the query; `facts1-*.txt` ("n25", "last25"); ladder contract script |
| club windows (1925-1996, 1997, 1897-1981, 1982, 1999-2007, nm skips 1999-2007) | ladder | club history in the test comment; 0 stray rows on both bases |
| 13,255 / 14,110 / 13,275 / 18 (historical) | birth dates | 2026-09-06 rebuild measurements, re-measured on both bases (`facts3-*.txt`) |
| 12,400 club-list-filled | birth dates | contract text "12,400 NULL dates fillable"; 12,400 on both bases |
| 13,347 / 14,294 / 13,367 / 18 (population) | birth dates | section 2; contract C2 successor and register `distinct_urls`, read by the test |
| `2065-03-20`, pending, 0 | provisional fixture | chosen in the test (last of the four fixture match dates) |

## 5. Pre-registered base-dependent expectations (F-009)

On the 4 Nov snapshot, per-file and shared, these 5 fail and nothing else; every one is exact and expected:

| Test | Snapshot value (assertion text) | Class |
|---|---|---|
| `birth dates populates the canonical dates …` | `expected 13255 to be 13347` | pre-registered base-dependent (92 undated 2026 debutants) |
| `birth dates keeps the evidence behind every recovered date …` | `expected 14110 to be 14294` | same |
| `birth dates matches players on the profile URL …` | `expected 13275 to be 13367` | same |
| `birth dates leaves the remaining players honestly without a date` | `expected 110 to be 18` (18 + 92) | already failing at B4 (class 1: environment, snapshot lacks 2026-debutant dates); the scoped historical 18 passes there |
| `Brownlow authority agrees with the canonical round votes for every career inside their coverage` | `expected 183 to be +0` | already failing at B4 (class 1), not in this scope |

In each birth-date test the historical assertions run first and pass on the snapshot, so the failure text is the population figure. These tests
are baseline-pinned (below); they are not "fixed" for the snapshot.

## 6. Red/green and non-vacuity evidence

Red at B4 / green after, both bases, both modes: section 1 (every changed id is red at B4 with the exact text in `evidence/it/b4_*.json.gz`,
green on the rebuild in `fa_rb_*`). New assertions that cannot be red at B4 (they did not exist) are shown red by mutation. All mutations are
applied to fresh `--template` copies (data) or to one tracked source file restored with `git checkout --` and verified byte-identical
(`restored … byte-identical`, porcelain clean after each); outputs `evidence/final-A.out`, `final-A2.out`, `evidence/mut/`.

| Mutation (both bases unless stated) | Test that goes red | Exact text |
|---|---|---|
| a historical season left `in_progress` (`m_struct1`) | `season status structure has at most one…` | rebuild `2 seasons in progress: 2025, 2027 | …`; snapshot `season 2025 is in progress but is not the latest season` |
| a Brownlow row for a cohort player the career table lacks (`m_c261a`) | 261 gate | `expected [ …(268) ] to deeply equal [ Array(267) ]` (service ≠ oracle) |
| a cohort player moved out of 50-199 goals consistently (`m_c261b`) | 261 gate | `expected 260 to be 261` (only the historical literal can notice) |
| a cohort player loses his profile identity (`m_c261c`) | 261 gate | `expected 267 to be 268` (`served.length === ids.length`) |
| a historical missing crowd becomes recorded (`m_att1`) | attendance | counts move: `expected [ …(2) ] to deeply equal [ …(2) ]` |
| the pairing constraint dropped and a crowd mislabelled `complete` (`m_att2`) | attendance | `expected [ { status: 'complete', …(1) }, …(2) ] to deeply equal [ …(1) ]` |
| a Footscray 1950 row filed under Sydney (`m_lad1`) | ladder | `expected { slug: 'sydney', n: 45, …(2) } to match object { from: 1982, to: 2025 }` |
| a Sydney 1990 row lost (`m_lad2`) | ladder | `expected 127 to be 128` |
| a historical player loses date and link (`m_dob1`) | birth dates populates | `expected 13254 to be 13255` |
| a club-list evidence row dropped and unlinked (`m_dob2`) | birth dates evidence | `expected 14109 to be 14110` |
| `recomputeClubSeasons` spoon gate `se.status = 'complete'` removed (`g1.sed`, src) | `awards no premier and no wooden spoon` | `expected '1 club_seasons rows hold the wooden s…' to be ''` |
| `recomputeBrownlowCoverage` in-progress branch returns `not_applicable` (`g2.sed`, src) | `reports Brownlow as pending, never as zero` | `expected 'brownlow_season_total: coverage not_a…' to be ''` |
| `recomputeSeasonMetadata` never derives `in_progress` (`g3.sed`, src) | four provisional tests | `status is complete, not in_progress | …` |

The `detects …` tests (inside the file) run on every execution and prove each fixture contract can fail without touching the source.
**Not done:** a synthetic later completed season committed to a scratch copy (the F-013 acceptance shape) was not run here; the scoped assertions
were instead shown red by the mutations above, and green on both bases, with the unscoped counts equal to the oracle by construction.

## 7. F-021: what stays baseline-pinned, and when it goes stale

* **Population birth-date pins** (13,347 / 14,294 / 13,367 / 18) are pinned to the accepted baseline pair `c2-2026-final-core-v1` +
  `club-lists-20260905`. They go stale when the next baseline is accepted: a fitzRoy core with another season (2027 debutants appear as new
  players, dated or not), a club-list snapshot newer than 2026-09-05, or a corrected profile fold. They then need that baseline's measured values and
  the contract's next successor, and the two tracked files read by the test.
* **Historical pins** (261 and its digests, 15,187 / 1,651, the ladder ranges, 13,255 / 14,110 / 13,275 / 18) are bounded to 2025 and do not move
  when a season completes. They go stale only if the 1897-2025 history itself is corrected (a renumbered-profile fold, a match correction).
* The approved re-pins of the 268 cohort, the attendance statuses and the ladder ranges "to 2026" are therefore not pinned to 2026 any more: the
  unbounded forms are oracle equalities, the bounded forms are historical. The 2026-08 `AFLDB-ISSUE-095` upper bound 2025 is now explicit in the query.
* Frozen pins in this file (`DRAFTGURU_EXPECTED` 6,810 / 5,057, the 1960s cohort `4b4c6a2aa975cc17` / `258396e0512a2212`, 79,113, the Peter Brown
  and Barassi witnesses) were not touched.

## 8. Findings (outside or beside the scope; nothing fixed)

* **INFO, collision.** `tests/integration/brownlow-pending-projection.test.ts` (scope `brownlow`) COMMITS a fixture season 2066 (`SEASON = 2066`,
  prefix `issue316-bpend-`), inside this scope's allocated 2065-2066. No runtime conflict: this file never commits, files run serially in shared mode,
  each has its own database in per-file mode, and `insertFixtureSeason` refuses (with a sentence, not a duplicate-key error) to build over an existing
  2065 or 2066. `leaked-fixtures.ts` does not list 2066 (orchestrator-owned): if the orchestrator wants the leak guard to name it, that is its edit.
  `release-gates.test.ts` needs no `COMMITTING_SUITES` change (it is already a member and commits nothing).
* **INFO, production snapshot data.** The 4 Nov snapshot holds 92 players who debuted in 2026 with `dob` NULL, no evidence row, and profile identities
  with status `resolved` (the c2 rebuild has them dated with `unique` identities). They render as "Not recorded", never zero, so no
  data-model rule is broken; it is a completeness gap for the owner if production's birth-date stage should be re-run over the 2026 debutants
  (not requested here).
* **INFO, heavy lock.** `/mnt/ssd/afldb-rem4-base/heavy.lock` was held for most of this run by the baseline scope's full per-file run
  (`timeout 10800`); four scopes' typecheck/lint queued behind it. See section 9 for what that did to this scope's exit gate.

## 8b. Incidents (nothing outside authority was touched)

1. **Over-broad `pkill -f` of my own.** `pkill -u arm -f "in/final.sh A"` (to stop my own driver after the upper-case database-name mistake) also
   matched my own `ssh` shell (its command line contained the pattern), which exited 255. The pattern is specific to my script, so no other
   process can have matched; the driver's child `muts.sh rb` survived as an orphan (ppid 1) and was allowed to finish (it only creates and drops its
   own `afldb_v2_rb_rem4gates_mut_*` copies). The rule "never `pkill -f` a pattern that can match your own shell" was broken; no harm.
2. **Concurrent runs on one checkout.** A `seq.sh` run overlapped the src-mutation phase of the evidence chain (both use the one `cand`
   checkout, which `srcmut.sh` temporarily edits). Its results were discarded and `seq.sh` was re-run after the chain finished; `evidence/seq.out`
   is the clean re-run. Every `srcmut.sh` verified `restored … byte-identical` and an empty porcelain afterwards.
3. **Typecheck and lint gate queued on the heavy lock** (section 9).

## 9. Exit gate and cleanliness

At `aade0feb` in the host checkout (HEAD verified, `git status --porcelain` empty before and after):

| Gate | Result | Evidence |
|---|---|---|
| `npm run typecheck` (`next typegen && tsc --noEmit`) | **rc 0** | `evidence/typecheck.out`; typegen did not dirty the checkout |
| `npm run lint:gate` (ratchet) | **PASSED**: 338 errors in 43 files now, baseline allows 338 in 43; baseline untouched, `--update` never run | `evidence/lint-gate.out` |
| `eslint` on `tests/integration/release-gates.test.ts` | 0 errors, 0 warnings, 0 messages | `evidence/eslint-release-gates.json` |

Both heavy gates queued on `/mnt/ssd/afldb-rem4-base/heavy.lock` for about an hour behind other scopes' runs (flock is not first-in-first-out);
the time shows in `typecheck.out`/`lint-gate.out` only as the later file mtimes. Nothing else in the repository was changed by this scope, so
the gates measure exactly the one test file.

Not run: the 83-table count comparison of my two templates against `table-counts.tsv` (the dump and snapshot identity were verified by sha256,
the rebuild by `IR verify`, the snapshot by ledger 118; a listing of the baseline scope's host workspace, which this
scope only listed and did not read into, shows an empty `rb-table-counts.diff` there; that is that scope's evidence, not mine, and I do not rely on it).


## 10. Proposed ledger text (ISSUE-363, 363-W/G/B part) and CHANGELOG lines

**ISSUE-363, 363-W / 363-G / 363-B (release-gates), local, unpushed.** Status: fixed locally at `aade0feb`, qualification at the orchestrator's Q″.
Fix: `tests/integration/release-gates.test.ts` only. 363-W: the 261-player cohort, attendance statuses and ladder ranges are asserted over an explicit
seasons <= 2025 scope with literals and recorded provenance, and for the data as loaded against an independent raw-SQL oracle (cohort), the stored
status/figure pairing (attendance) and literal club-identity windows (ladder), keyed by AFL Tables profile key and club slug; the ISSUE-113 membership
digests are reproduced from the oracle. 363-G: the three "2026 is provisional" gates no longer look up a season; the provisional-season contracts run
on season 2065 established in an always-rolled-back transaction with the production recompute functions, the structure invariant (at most one season in
progress, the latest) is asserted on the real table without requiring one to exist, and every check has a corruption-detecting companion. 363-B: the
birth-date gates keep the 2026-09 literals for the historical population and pin the accepted rebuild (13,347 dated / 14,294 evidence rows / 13,367
profile identities, equal to the tracked contract's C2 successor and the register's `distinct_urls`), cause measured (92 2026 debutants).
Validation: red at B4 on both bases and both modes (9 / 8 failures); green 68/68 (7 skipped) on the accepted rebuild per-file and shared; on the 4 Nov
snapshot the only failures are the pre-registered base-dependent birth-date population pins plus two class-1 ids already failing at B4; 13 mutation reds.
Next action: orchestrator integration; the population pins go stale at the next accepted baseline (F-021).

CHANGELOG (Unreleased): `Tests: release-gates no longer assumes a season is in progress or that 2026 is incomplete. The 261-player cohort, attendance
statuses and ladder ranges are asserted over an explicit through-2025 scope and against independent raw-SQL oracles, keyed by stable profile and club
keys; the provisional-season contracts run on a rolled-back fixture season and the "at most one season in progress, the latest" invariant on the real
table; the birth-date gates are pinned to the accepted c2 rebuild (13,347 dated players) with historical through-2025 figures kept (ISSUE-363).`

## 11. Files

`scripts/` (every host command used, LF), `evidence/it/*.json.gz` (+ `.head`: checkout SHA, porcelain, mode, database), `evidence/mut/` (mutation
outputs, per-mutation JSON), `evidence/facts/` (aggregate counts only, no row extracts), `evidence/final-A*.out`, `evidence/seq.out`, `SHA256SUMS`.
`evidence/final-A.out` begins with four empty `A_*` runs: the first driver used an upper-case tag, which `isolated-pg` rejects as a database name
(`refused: database_name … is not an afldb_v2_*_test name`); nothing ran. Its stray `muts.sh rb` child (the driver was killed by an over-broad
`pkill -f` of my own, incident 1 below) completed and its dbmut results for the rebuild at `aade0feb` are the `rb` block of that file; the rest
is `final-A2.out`.
