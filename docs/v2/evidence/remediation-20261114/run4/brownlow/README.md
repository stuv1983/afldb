# Run 4, scope `brownlow`: ISSUE-365 (D-365-1) and ISSUE-363 item 3

Worker: `afldb-worker` (Sonnet 5.5). Branch `claude/rem4-brownlow-20261115`, base B4 `7cfbe186e70ca91db67da1aa4e28325ccbc32a86`, unpublished.
Commits (code, in order): `8d946b6a` **ISSUE-365** (rule, tests, rehearsal pin, docs), `8248133b` **ISSUE-363** (settle suites), `d6b872d1` **ISSUE-365** (typed rows in the new unit test, lint ratchet; behaviour-neutral). This README and the raw
evidence are a final docs-only commit on top (its SHA is in the final report; no code changed after `d6b872d1`).
Host workspace `/mnt/ssd/afldb-rem4-brownlow-20261115`, port 55681, evidence checkout `final` (matrix at `8248133b`; moved to `d6b872d1` for the gates; empty porcelain; bundles `B4..8248133b` sha256
`eaa05abf21a3be1618834eba27854df475f4707538a26cc01d8534abf35958c9`, `8248133b..d6b872d1` sha256 `df1f331f8de1be3f7229a0b35cd5fe5c07c4bb74eab3b38e06025849d50de8e9`). Bases: accepted rebuild `rb` (dump sha256 `d8397aab...65c63`, 131 seasons,
no `(afl_api, CD_I297354)` identity) and the 4 Nov production-derived snapshot `snap` (dump sha256 `e77c307d...`, 130 seasons, real identity row id 19189 -> player 7974,
row md5 `cf04e8f54805716e81742d4dbe3d5af4`; **aggregates only here, nothing copied off the host**). Every run is on a fresh `--template` copy of a restored template.

## 1. Part A: D-365-1 (`recomputeBrownlowCoverage`, ISSUE-365)

**Owner text:** "a completed season without loaded Brownlow results remains pending unless an explicit authoritative decision establishes that no medal was
awarded. Missing data must not imply no medal. Preserve historical no-medal seasons and test both cases."

**Defect (B4):** `recomputeBrownlowCoverage` (the only live writer of the three Brownlow `stat_availability` rows after load) ended all three grains with
`ELSE 'not_applicable'`: a completed season with no `brownlow_season_votes` rows (2026 on both bases) became "no medal awarded" the first time anything recomputed it
(a Brownlow settle with `apply`, a finalisation, the correction tool). `lockMatch` then refuses every mutation there.

**Change (`src/db/queries/player-derived.ts`):**
- New exported `BROWNLOW_DECLARED_NO_MEDAL_SEASONS` = 1897-1923 and 1942-1945. Provenance: `data/reference/stat-availability.json` `coverage_ranges` rows of the three
  `brownlow_*` keys with `coverage: "not_applicable"`, the committed declaration the rebuild loads. NOT the coverage registry (`packages/domain` carries `unsupported` for 2027 for another reason).
  `tests/reference-data.test.ts` proves the constant equal to those JSON ranges for all three keys. Not a 'use server' module (no const-array trap).
- All three grains now end `WHEN c.declared_no_medal THEN 'not_applicable' ELSE 'pending'`; the ranges are bound parameters (`unnest($::int[], $::int[])`). The rule never reads the
  existing `stat_availability` row. Precedence (first match wins) is in the function comment: season_total medal->complete, in-progress->pending, workflow decisions->partial,
  declared->not_applicable, else pending; round/match unchanged except the last two branches.
- `recomputeSeasonBrownlowStatus` does not share the inference: it follows the existing row through `brownlowStatusSql` (not_applicable row -> not_applicable; complete+medal -> complete;
  else pending). Unchanged.
- Left unedited and documented: migration 016 (applied, never edited) and `tools/migration/import_legacy_afl.py:845-857` carry the same inference; no live path invokes the importer
  (no reference in package.json, deploy/, tools/v2, tools/db/rebuild-test.ts, tools/current-season or src; only manual runbooks `docs/deployment.md` sec 7 and `docs/production-cutover.md`, and it needs the
  retired legacy SQLite). The old "keep all three definitions in lockstep" claim in the JSDoc is replaced by a statement that they are no longer in lockstep.
- Docs, same commit: `docs/data-dictionary.md` 3.2a and `docs/architecture.md` 4.6.

**Tests (red on B4 with the exact text, then green).**
- New `tests/integration/brownlow-pending-coverage.test.ts` (8 tests; created with `new-file`; no suite already owned a recompute-rule test). Fixture season **2063**
  (`BROWNLOW_PENDING_SEASON` in `brownlow-fixture.ts`: 2 full H&A matches, completed, no medal, no coverage row). Cases: recompute writes pending x3; heals a planted
  `not_applicable` (control: `recomputeSeasonBrownlowStatus` alone follows the row and keeps `not_applicable`); finalisation refused (`season_not_polled`) on a planted `not_applicable`,
  admitted on the recomputed `pending` and then `partial`; **both historical cases**, 1900 and 1943, recomputed in a rolled-back transaction (season_total and round rows byte-identical,
  match row identical apart from measured counts); a real 1943 match finalise is refused without writing; an all-season sweep (1897-2027, rolled back): `not_applicable` iff declared at all three grains, season_total equal to the committed JSON grid.
- `tests/reference-data.test.ts`: 2 new tests (constant == literals == JSON; source-text guards: no registry import, no `FROM stat_availability` in the function, exactly three `declared_no_medal ... ELSE 'pending'`, no `ELSE 'not_applicable'`).
- Expected values are literals (owner rule, JSON ranges) or independent SQL, never the implementation under test.
- **RED at B4** (`raw/rb-red1`, `raw/snap-red1`; shared mode; src unchanged): integration 4 failed / 4 passed on both bases. Exact text: `Error: finalisation refused (season_total was 'not_applicable'): season_not_polled No Brownlow Medal was awarded for that season, so it has no votes to record. No Brownlow Medal was awarded in 2063.`;
  `AssertionError: expected 'not_applicable' to be 'pending'`; sweep `2026 brownlow_season_total: not_applicable (declared=false)`. Unit `unit/red-b4-reference-data.log`: 2 failed (`expected undefined to deeply equal [ { firstSeason: 1897 ...`, `Target cannot be null or undefined.`). The 4 passing integration cases are the historical-season guards (they must pass before and after).
- **GREEN at `8248133b`**: 8/8 on both bases in shared and per-file `AFLDB_TEST_PER_FILE_DB=all` (`*-fin1seq`, `*-fin1a4`); unit 70/70.
- Collision proof for 2063: seasons 2063/2064, matches, `CD_I4010%` identities and their coverage rows were 0 on both bases before use. **2064 collides** with `tests/integration/venue-records.test.ts:64` (`CROWD_SEASON = 2064`), so only 2063 is used.

**Existing tests that pinned the old rule (item i):** (1) `SETTLED_BROWNLOW_COVERAGE` in `tools/db/afl-api-identity-correction-rehearsal.ts` (match/season `not_applicable` -> `pending`; derived by reasoning, then confirmed:
with the new rule and the OLD pin case 29 reports `FAIL baseline: ... exactly the three settled Brownlow coverage rows for 2092` with observed pending/complete/pending 0/1 = the new literals; with the new pin 33/33); (2) `settle-afl-api-brownlow.test.ts`
`COVERAGE_SENTINEL` (`is_recorded true, not_applicable, NULL` "a state no real recompute can produce") stays valid for 2026 (now `pending`): suite 21/21 on both bases;
(3) `brownlow-fixture` `NO_MEDAL` 2084 is hand-seeded `not_applicable` and read, never recomputed: `admin-brownlow.test.ts` 47/47 on rb; (4) `database.test.ts` war-years test, see below.

**Order-dependent contamination, red/green (item f):** the pre-`6edf4f99` `settle-afl-api-brownlow` suite (run as a scratch file in the host checkout only, removed after) followed by `database.test.ts` on ONE database:
at B4 src the war-years test fails: `AssertionError: expected [ 1942, 1943, 1944, 1945, 2026 ] to deeply equal [ 1942, 1943, 1944, 1945 ]` (`rb-warred1`, `snap-warred2`); at the new src the same sequence passes 69/69 (`rb-wargreen1`, `snap-wargreen2`).

**Population effect, all 131/130 seasons (rolled back, `out/sweep-*.txt`, md5 of the diff set):** rb old `8191164b...` / new `8f39083c...`; snap old `254602e1...` / new `2ddbe877...`.
Season_total and round grains: under the new rule NO existing historical row changes (diffs: rb 2027 `ABSENT -> pending` x3 because the season has no rows; snap 2026 round `pending -> partial`, pre-existing `vote_rows>0` branch, not touched).
The old rule additionally flipped 2026 season_total and round to `not_applicable` on both bases. **Match grain:** on BOTH rules 130 rows loaded with `populated_rows/total_rows = NULL/NULL` come back with measured counts after any recompute
(e.g. 1900 `0/68`, 1943 `0/80`), and 1931 moves `partial -> complete 108/108`: pre-existing and unrelated to D-365-1, so "byte-identical" holds for season_total and round only (finding F-3).
**2026 on both bases (g)** `raw/g2026.txt`: loaded `pending/pending/pending` (md5 `467b502b...`); inside one recompute OLD: rb `not_applicable x3` (match 0/207) / snap match `not_applicable`, round `partial`, total `not_applicable`;
NEW: rb `pending x3` (match 0/207) / snap match `pending 0/207`, round `partial`, total `pending`; after rollback identical to before on both.

**ISSUE-238 rehearsal table (`code_test_db` in my cluster only, fresh database per case):** 84 implemented cases/variants at the Part A tip: 83 PASS, 1 not run. `c47` (full rebuild) refuses because the harness pins the import DSN to port 55432, a forbidden port: **class 6, blocked**.
Seven cases first aborted on my launcher's missing `DATABASE_URL`/`AFLDB_AUTH_DATABASE_URL` for the `react-server` writers (launcher fixed; `ct-tip1b` reran them from `final`: all 7 PASS). `ct-tip1` ran in the working checkout whose `src/db/queries/player-derived.ts`, the rehearsal tool and `brownlow-fixture.ts` are byte-identical to `final` (sha256 checked).

## 2. Part B: ISSUE-363 item 3, the real provider id `CD_I297354`

Owner text: review the remaining Brownlow suites using the real provider id; where they create/mutate/clean up fixtures replace the reliance with isolated ids; preserve genuine read-only historical assertions.
**Enumeration** (suites that load `tests/fixtures/afl_api/match/{02-player-stats,03-match-roster}.raw.json`, which name `CD_I297354` once and twice): `settle-afl-api.test.ts` and `settle-afl-api-state-b.test.ts` (already isolated in run 3, unchanged here), and the three
`settle-afl-api-brownlow*.test.ts` suites (changed). `settle-afl-api-fixtures`/`issue276` do not use the id unrenamed (issue276 has `isolatePlayerIds`). Unit tests (`afl-api-match`, `afl-api-settle-plan`, `db-promotion-check`) are DB-free and read-only: left.
**Change:** new `tests/integration/afl-api-fixture-player.ts` (created with `new-file`; test-support module, not a suite; needed because `brownlow-fixture.ts` imports the app pool) holds `renameFixturePlayer` (occurrence counts asserted 1 and 2), `ownedFixtureProviderPlayerId(serial)` (`CD_I4010` + 6 digits;
real ids are 6-7 digits), `realFixtureIdentityRow`, `realFixturePlayerStatRowsIn`, `readSeasonCoverage`/`restoreSeasonCoverage`. The three suites rename onto `CD_I4010000001/2/3`, deliberately unbridged; record the real `(afl_api, CD_I297354)` row before anything writes and assert it byte-identical in `afterAll`;
assert no real-player `player_match_stats` row exists in their matches.
**RED (snapshot, shared; scratch copies of the new suites with an identity "rename", removed after; `snap-pbred1..3`):** brownlow `expected '{"fixtureRaw":{"id":9027,"providerId"…' not to contain 'CD_I297354'`; reschedule `Error: 2 player_match_stats row(s) in this suite's matches belong to the real CD_I297354 player.`; backtest `Error: 1 player_match_stats row(s) in this suite's match belong to the real CD_I297354 player.`
On the rebuild (no real identity) reschedule/backtest pass unrenamed (`rb-pbred2/3`): there the change is a regression guard only; the brownlow suite's rename assertion is red on both bases (`rb-pbred1`).
**Second defect found while measuring (F-2, in my files, fixed):** the reschedule and backtest suites apply a Brownlow settle to 2026, which recomputes its `stat_availability` rows, and never restored them. At the pre-fix suites a shared run left 2026 describing deleted fixtures on both bases
(`snap-pb1s2/3`, `rb-pb1s2/3`: coverage md5 `70209edc...` -> `b488d3b5...` after reschedule, `16db37f6...` after backtest: round `partial`, match `pending 0/209`). They now capture and restore the rows as the brownlow suite does since `6edf4f99` (crash residue falls back to a recompute).
**GREEN at `8248133b`:** coverage md5 `70209edc0e475b3ae07d130e1514c997` and (snap) the real row (1 row, md5 `cf04e8f5...`, player 7974) unchanged after every step of an 8-file shared sequence on one database, both bases (`*-fin1seq`).

## 3. Final matrix (clean checkout `final` = `8248133b`; `*-fin1seq` shared sequence on ONE fresh database per base, `*-fin1a<n>` per-file `=all`, one fresh base copy each)

| # | file | rb shared | rb per-file | snap shared | snap per-file |
|---|---|---|---|---|---|
| 1 | settle-afl-api-brownlow | 21/21 | 21/21 | 21/21 | 21/21 |
| 2 | settle-afl-api-brownlow-reschedule | 3/3 | 3/3 | 3/3 | 3/3 |
| 3 | settle-afl-api-brownlow-backtest | 6/6 | 6/6 | 6/6 | 6/6 |
| 4 | brownlow-pending-coverage (new) | 8/8 | 8/8 | 8/8 | 8/8 |
| 5 | admin-brownlow | 47/47 | 47/47 | 46/47 (class 1) | 46/47 (class 1) |
| 6 | settle-afl-api-state-b | refused (class 4) | refused (class 4) | 1/1 | 1/1 |
| 7 | settle-afl-api | 73/74 (class 1) | 73/74 (class 1) | 73/74 (class 1) | 73/74 (class 1) |
| 8 | database | 69/69 | 69/69 | 69/69 | 69/69 |

Unit (single-file runs, `unit/`): reference-data 70/70, admin-match-mutations 17, afl-api-ingestion-safety 198, correct-afl-api-identity-cli 276, current-season-import 360, data-overrides-source-contract 78, finals-semantics-contract 10, match-sheet 97, v2-season-seal 62: all pass.
Failure classification (vocabulary 1-6; none is caused by this change, each shown at B4 or on the intended condition):
- **admin-brownlow `migration 094 ... exactly one match (preflight P2)`, snapshot only: `expected 9522 to be +0`.** Class 1: passes 47/47 on the accepted rebuild (the intended base); identical failure at B4 on the snapshot (`snap-b4admin`). On the snapshot 9,522 historical round rows are not resolved to exactly one match.
- **settle-afl-api OD-5 case:** `Refusing to rebuild '<db>': the only explicit rebuild targets are ...`. Class 1: a name-pinned case (isolated name `afldb_v2_rb_<x>_test` under `isolated-pg run`; per-file names `afldb_v2_pf_*` are refused by design). Passes 1/1 on both bases when run under a conforming name (`rb-od5rb`, `snap-od5snap`, `-t "OD-5 reinstate \(rolled back, no rebuild\)"`); the other 73 cases pass.
- **settle-afl-api-state-b on the rebuild:** `afldb_test has no auth_users row; this file will not create one.` Class 4 (deliberate refusal, condition: the base must hold an `auth_users` row; the accepted rebuild holds none); identical at B4 (`rb-b4stateb`); passes on the snapshot.

## 4. Gates, clones (filled from the host)

- typecheck (`npm run typecheck`, heavy lock, `final`): **rc 0** at `d6b872d1` (`raw/typecheck.log`; `raw/typecheck-8248133b.log` rc 0 at the matrix commit).
- `npm run lint:gate` (heavy lock, `final`, never `--update`): **PASSED at the ratchet: 338 errors in 43 files, baseline allows 338 in 43** at `d6b872d1` (`raw/lint-gate.log`). At `8248133b` it FAILED with 1 regression (`tests/reference-data.test.ts` `no-explicit-any` 31 -> 33, my two `(r: any)` casts; `raw/lint-gate-8248133b-REGRESSION.log`), fixed in `d6b872d1`; `lint-baseline.json` untouched, `--update` never run.
- `v2-brownlow-eligibility-2025-rehearsal` / `v2-brownlow-production-correction` on `afldb_v2_brownlow_tristate_twelve_test` / `afldb_v2_brownlow_policy_final_test` in my cluster, built from the run-3 recipe with the retained rem3 artefacts (read-only inputs, sha256 verified): **`v2-brownlow-eligibility-2025-rehearsal` 3/3 passed (154 s); `v2-brownlow-production-correction` 8/8 passed (2,467 s)**, both shared mode under the heavy lock, run from `final` at `d6b872d1` (`raw/clones/`: template restore verified against the exported identity, 1,640 TOC entries with the 4 documented extension entries excluded, migrations 116-118 via the normal runner, privileges).

## 5. Findings

| id | grade | where | summary |
|---|---|---|---|
| F-1 | MED (outside scope; for the orchestrator/owner) | 4 Nov snapshot, `player_season_stats` | All **669** 2026 `player_season_stats.brownlow_status` rows read `not_applicable` while the three 2026 `stat_availability` rows read `pending` (rebuild: 669 x `pending`; `raw/acc-2026.txt`). So the ISSUE-365 symptom already sits in the player-season rows of production-derived data and a coverage-only repair would not clear it; `recomputeSeasonBrownlowStatus(2026)` alone does (rolled back, `raw/repair2026.txt`: 669 `not_applicable` -> 669 `pending`). Production itself was not read. |
| F-2 | LOW (fixed, in scope) | reschedule/backtest suites | left 2026 coverage describing deleted fixtures in a shared run (section 2). |
| F-3 | INFO | recompute, match grain | any recompute turns NULL populated/total into measured counts (130 rows) and moves 1931 `partial -> complete`; pre-existing under both rules. |
| F-4 | LOW (outside scope) | `src/db/queries/admin-brownlow.ts:723-724` | `lockMatch` says "No Brownlow Medal was awarded in {season}." also when the coverage row is ABSENT (2027 on the rebuild): the same inference D-365-1 forbids, in a refusal message. Not changed (not in my edit list). |
| F-5 | MED (owner decision, outside scope) | `src/lib/format.ts` `brownlowStatusNote`/`formatBrownlow`, `/players/[slug]` season table, `tests/e2e/journeys.spec.ts:134` | `pending` is worded "season in progress / medal not awarded": false for a completed season whose results are not loaded (F-006). Wording proposal in section 6.4; not changed. |
| F-6 | INFO | `docs/deployment.md` sec 7, `docs/production-cutover.md:158` | still document the retired `import_legacy_afl.py` path that carries the old inference. |

Existing ISSUE-365 rows on any real database are NOT repaired by this change (it only affects future recomputes); production and DEV were never contacted.

## 6. Proposed text for the orchestrator (nothing below was written to a tracked ledger by this scope)

### 6.1 ISSUE-365 ledger entry (status stays OPEN)

> **AFLDB-ISSUE-365 (Open): a completed Brownlow season without loaded results was recorded as "no medal awarded".**
> Evidence: `recomputeBrownlowCoverage` ended all three grains with `ELSE 'not_applicable'`, so the first recompute of a completed season
> holding no `brownlow_season_votes` rows (2026 on the accepted rebuild and on the 4 Nov snapshot) wrote `not_applicable` at season_total,
> round and match grain; `lockMatch` then refuses every Brownlow mutation there, and a `not_applicable` season reads as "no medal awarded" to the public status note.
> Decision D-365-1 (owner, 2026-11-15): a completed season without loaded Brownlow results stays `pending` unless an explicit authoritative
> decision establishes no medal; missing data must not imply no medal; historical no-medal seasons are preserved.
> Fixed LOCALLY (commit `8d946b6a`, branch `claude/rem4-brownlow-20261115`, unpublished): the only declaration is
> `BROWNLOW_DECLARED_NO_MEDAL_SEASONS` (1897-1923, 1942-1945, from `data/reference/stat-availability.json`); every other completed season
> without a medal is `pending`; the rule never reads the existing row. Tests: `brownlow-pending-coverage.test.ts`, `reference-data.test.ts`,
> the ISSUE-238 rehearsal pin. **Not closed, because:** (1) nothing has been published or deployed; (2) the rule changes only FUTURE
> recomputes: it repairs no existing row, on any database; (3) production and DEV `stat_availability` rows for 2026 were never read by this
> work, so whether they currently read `not_applicable` is unknown (the accepted rebuild and the snapshot both hold `pending/pending/pending`
> in `stat_availability` and only become `not_applicable` when something recomputes 2026; BUT the 4 Nov snapshot's 669 `player_season_stats` 2026 rows already read
> `brownlow_status = not_applicable`, see 6.3, so the derived rows must be checked and repaired too); (4) the public wording of a `pending` season ("in progress" /
> "medal not awarded") is a separate owner decision (section 6.4). Residual divergence, documented and left unedited: migration 016 and
> `tools/migration/import_legacy_afl.py` still derive `not_applicable` from an absent medal (applied migrations are never edited; the importer
> is a retired manual path no live script invokes).

### 6.2 CHANGELOG (Unreleased) lines

- `Changed`: Brownlow coverage recompute (`recomputeBrownlowCoverage`) no longer infers "no medal awarded" from missing results: a completed
  season without loaded Brownlow results stays `pending`; only the declared seasons 1897-1923 and 1942-1945 are `not_applicable` (ISSUE-365, D-365-1;
  local, unpublished; no existing row is repaired).
- `Fixed (tests)`: the three Brownlow AFL API settle suites no longer settle the real provider player id `CD_I297354` (renamed to owned `CD_I4010...` ids,
  real identity row asserted unchanged) and the reschedule/backtest suites restore the 2026 coverage rows they recompute (ISSUE-363, local).

### 6.3 Conditional repair step and acceptance query (F-005) for the packet

Applies ONLY where the read-only query in step 1 shows a stale `not_applicable`; this scope read no production or DEV state.
Needs separate owner approval, a backup, and the deployed D-365-1 code. **Observation that shapes it (aggregates, `raw/acc-2026.txt`):**
the 4 Nov snapshot (production-derived) already holds `stat_availability` 2026 = `pending/pending/pending` BUT all **669** `player_season_stats`
2026 rows read `brownlow_status = not_applicable` (the accepted rebuild holds 669 x `pending`). So the symptom of ISSUE-365 can sit in the
player-season rows even when the coverage rows already read `pending`, and a coverage-only repair would not clear it.

1. READ (no write): `SELECT stat_key, coverage, populated_rows, total_rows FROM stat_availability WHERE season = 2026 AND stat_key IN ('brownlow_season_total','brownlow_round_votes','brownlow_match_votes') ORDER BY stat_key;`
   and `SELECT brownlow_status, count(*) FROM player_season_stats WHERE season = 2026 GROUP BY 1;` and `SELECT status FROM seasons WHERE year = 2026;`
   Nothing to repair when no coverage row reads `not_applicable` and no `player_season_stats` row reads `not_applicable`.
2. In ONE transaction, through the shipped code (not hand SQL), in this order and each only if its condition holds: (a) if any 2026 coverage row reads
   `not_applicable`: `recomputeBrownlowCoverage(tx, 2026)`; (b) always when any 2026 `player_season_stats` row reads `not_applicable` or (a) ran:
   `recomputeSeasonBrownlowStatus(tx, 2026)` (it follows the coverage row, so on a `pending` row it writes `pending` and `brownlow_votes` NULL).
   Both are exported from `src/db/queries/player-derived.ts`. Commit only if the acceptance below passes inside the same transaction; otherwise roll back.
   Rolled-back dry run of both orders on both test bases at this commit: `raw/repair2026.txt` (snapshot: 669 `not_applicable` -> 669 `pending` with
   `recomputeSeasonBrownlowStatus` alone; coverage rows stay `pending`; the full order leaves round `partial` there because round vote rows exist).
3. ACCEPTANCE (read, after): the three 2026 coverage rows have `is_recorded=false` and `coverage='pending'` for `brownlow_season_total` and
   `brownlow_match_votes`, and `pending` or `partial` for `brownlow_round_votes` (`partial` only when 2026 round vote rows exist);
   `SELECT DISTINCT brownlow_status FROM player_season_stats WHERE season = 2026` returns only `pending`;
   `SELECT count(*) FROM stat_availability WHERE stat_key LIKE 'brownlow%' AND coverage = 'not_applicable' AND season >= 1924 AND season NOT BETWEEN 1942 AND 1945` returns 0
   and the same count with `season BETWEEN 1942 AND 1945` still returns 12 (3 keys x 4 war seasons; measured on both test bases).

### 6.4 Neutral wording for the Brownlow status note (F-006; `src/lib/format.ts` `brownlowStatusNote`, NOT changed by this scope)

Today `brownlowStatusNote('pending')` and `formatBrownlow` tell the reader the season is in progress / the medal not awarded, which is false for
a completed season whose results simply are not loaded. Proposed `pending` note: "Brownlow Medal results for this season have not been loaded yet."
(no claim about whether a medal was awarded or the season is still being played); keep `not_applicable` ("No Brownlow Medal was awarded in {season}.")
only for the declared seasons. E2E pin to update with it: `tests/e2e/journeys.spec.ts:134`.

### 6.5 Fixture seasons and `leaked-fixtures.ts` (orchestrator edits that file)

Committed fixture season used: **2063** only (`BROWNLOW_PENDING_SEASON`, shape in `tests/integration/brownlow-fixture.ts`), consumer
`tests/integration/brownlow-pending-coverage.test.ts`. 2064 was allocated but **collides** with `tests/integration/venue-records.test.ts:64`
(`CROWD_SEASON = 2064`), so it is NOT used. `leaked-fixtures.ts` needs: season 2063 -> `brownlow-pending-coverage.test.ts`, and that file added
to the COMMITTING_SUITES membership (it seeds committed rows through `brownlow-fixture.ts`). The new provider ids `CD_I4010000001..3` (serials 1-3,
no database row is ever written for them) need no registry entry; `CD_I4010` was unused in the repository before this change.

## 7. Disclosures, incidents, edits

- **Authority:** only Git inspection and local commits on my branch, and commands in my own host workspace/cluster (port 55681). Never touched: production, DEV services, port 5432/55432/55651/55660/55671-55678, shared `afldb_test`, RB-1, ISSUE-331 stores, `D:\devfldb`, any other worktree. Nothing pushed.
- **Non-conforming database name in my own cluster:** `code_test_db` (the rehearsal tool targets that literal name); created and dropped by my launcher with the cluster superuser after asserting my root and port; dropped at the end.
- **Heavy lock:** single-file runs ran without it (the 3-suite groups were split into single-file runs because the lock was contended for ~1 h by other scopes); the "shared sequence" is eight separate single-file vitest invocations on ONE database, not one multi-file process. Typecheck, lint gate and the template restore/clone suites took the lock.
- **Host-side git metadata in my own workspace:** `git worktree add` of `cand-b4` (B4, for red runs) and `final` (the evidence checkout), local refs `rem4-final`, `rem4-final2` fetched from my bundles, `/node_modules` added to `cand/.git/info/exclude` (the symlinked `node_modules` of the extra worktrees). Removed or listed in the final report at close-out.
- **Scratch files (removed):** `zz-old-brownlow-scratch.test.ts` (the pre-`6edf4f99` suite, red/green control), `zz-red-*` (identity-rename copies for the Part B red), both only in host checkouts, never committed. One temporary `/tmp/rem4brownlow-filelist.txt` on the host (created by my evidence listing, removed).
- **Two of my own queued jobs were killed by exact PID** (a lock-waiting `partb.sh` and its `flock`), then relaunched as single-file runs; no pattern kill.
- **Read-only inputs used:** `/mnt/ssd/afldb-rem3-integb-20261114/brownlow/in` (the retained Brownlow template artefacts; copied into my workspace, sha256 verified) and the rem3 published rebuild/snapshot dumps for the two bases.
- **Defects of mine found and fixed during the run:** my first `reference-data` source-text guard matched its own comment (fixed before the commit); the launcher lacked `DATABASE_URL`/`AFLDB_AUTH_DATABASE_URL` for seven `react-server` rehearsal cases (reran); two `any` casts in the new unit test regressed the lint ratchet 338 -> 340 (fixed in `d6b872d1`, per-file eslint counts equal B4).
- **Edits (repository):** `src/db/queries/player-derived.ts` (coverage rule + constant + comment); `tests/integration/brownlow-fixture.ts` (season 2063 shape, `'absent'` coverage); NEW `tests/integration/brownlow-pending-coverage.test.ts`; `tests/reference-data.test.ts` (2 tests, typed rows);
  `tools/db/afl-api-identity-correction-rehearsal.ts` (the `SETTLED_BROWNLOW_COVERAGE` pin + comment); `docs/data-dictionary.md`, `docs/architecture.md`; NEW `tests/integration/afl-api-fixture-player.ts`; `tests/integration/settle-afl-api-brownlow.test.ts`, `...-reschedule.test.ts`, `...-backtest.test.ts`;
  this README, `SHA256SUMS` and `raw/`. Not edited: `issues.md`, `IssuesIndex.md`, `blockers.md`, `CHANGELOG.md`, `leaked-fixtures.ts`, `src/lib/format.ts`, any UI, migrations, `import_legacy_afl.py`, `tools/dev/lint-baseline.json`.

## 8. Evidence layout

`raw/<base>-<label>/{summary.txt,vitest.log}` per run (ANSI stripped, DSN lines removed; JSON reporter output left on the host): `*-red*`/`*-green*` Part A (working checkout before commit), `*-warred*`/`*-wargreen*` order-dependence control, `*-pbred*` Part B red, `*-pb1*` pre-hygiene suites (residue),
`*-fin1seq`/`*-fin1a<n>` final matrix, `*-od5*`/`*-b4*`/`*-finadmin` classification runs; `raw/unit/` unit red/green; `raw/ct-tip1`, `raw/ct-tip1b` rehearsal table; `raw/out/sweep-*.txt` population sweep; `raw/g2026.txt`, `raw/repair2026.txt`, `raw/acc-2026.txt`; `raw/typecheck*.log`, `raw/lint-gate*.log`; `raw/clones/`.
`SHA256SUMS` lists every committed raw file; each committed copy was checked with `git cat-file blob HEAD:<path> | sha256sum`.

