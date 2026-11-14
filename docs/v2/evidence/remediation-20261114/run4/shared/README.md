# Run 4, scope `shared`: shared-mode cross-file leaks (ISSUE-363, T363-2 and T363-3)

Worker: `afldb-worker` (Sonnet 5.5). Branch `claude/rem4-shared-20261115` from B4 `7cfbe186e70ca91db67da1aa4e28325ccbc32a86`.
Test-only change: no `src/` file was edited and none needs to be. Files owned and edited:
`tests/integration/admin-fixtures.test.ts`, `tests/integration/after-siren.test.ts`,
`tests/integration/nl-answers-after-siren.test.ts`.

## 1. Result in one paragraph

In the default shared mode (`AFLDB_TEST_PER_FILE_DB` unset, one database, files serially) two suites changed the database
for every later file. `admin-fixtures` committed the deletion of all 218 provider-owned `fixtures` rows of the 4 Nov snapshot.
`after-siren` re-ran the real loader in `afterAll`, rewriting `after_siren_kicks`, and left one `auth_users` row and six
`import_batches` rows behind. Both are fixed in the owned files, each suite now asserts, as its last test, that every row it did not
create is exactly as it found it (red at B4's behaviour, green after), and a family of 14 files run in a shuffled and a reversed order
on both bases shows no table change from any file in the family (14-table digest identical, every step). `nl-answers-after-siren`
had a second, base-dependent cause (three literals that are the snapshot's, not the rebuild's): it is now pinned per measured state.
Six further failing ids on each base (the snapshot: `data-editor` 5, `gridley-corpus` 1; the rebuild: `special-records-lifecycle` 1, `special-records-public-suppression` file-level, `grid-solver` 1, `gridley-corpus` 3) belong to files I do not own and are reproduced alone on a fresh
copy of the same base, so they are order-independent and not caused by my files (section 8).

## 2. Commits (local, unpublished), in order

| SHA | Subject | Files |
|---|---|---|
| `5895fd19` | ISSUE-363: add the shared-mode "leaves pre-existing rows untouched" assertions (red at B4) | `admin-fixtures.test.ts`, `after-siren.test.ts` |
| `42494bb5` | ISSUE-363: admin-fixtures and after-siren leave pre-existing rows untouched in shared mode (T363-2, T363-3) | same two |
| `6bcbd1c6` | ISSUE-363: nl-answers-after-siren pins the 2026 after-siren witnesses per measured state | `nl-answers-after-siren.test.ts`, `admin-fixtures.test.ts` (one header comment) |
| this commit | ISSUE-363: shared scope record (README, raw evidence, SHA256SUMS) | `docs/v2/evidence/remediation-20261114/run4/shared/**` only |

`git diff --stat 7cfbe186..6bcbd1c6` lists exactly the three owned test files (351 insertions, 41 deletions). The record commit
touches nothing outside `docs/v2/evidence/remediation-20261114/run4/shared/`, so the code under test in section 6 is the code of the
final commit.

## 3. Seasons, ids and the `leaked-fixtures.ts` request

* Committed `seasons` row: **2071, status `complete`**, inserted by `admin-fixtures` in `beforeAll` and removed again (also by the
  safety net in `afterAll`), never while a match still sits on it. Season 2072 is only the `fixtures` window (no `seasons` row, by design D-3).
  `after-siren` commits no season. No provider-id prefix (`CD_I4050`) is needed.
* **Registry request (orchestrator edits it):** add `2071: 'tests/integration/admin-fixtures.test.ts'` to `COMMITTED_FIXTURE_SEASONS`.
  `admin-fixtures` and `after-siren` are already in `COMMITTING_SUITES`. 2072 holds `fixtures` rows only, which no guard reads.
* **Allocation collision (LOW):** `tests/integration/settle-afl-api-state-b.test.ts:66` has `FIXTURE_SEASON = 2071` (scope `brownlow`).
  The files run serially and each removes its season; `admin-fixtures` refuses to delete a season that still holds a match and asserts at
  start that the register holds no season at or beyond 2071. Risk is crash debris only. Reallocation is one constant (`SUITE_SEASON_NOW`).

## 4. Mechanisms (what, which statement, which assumption)

### T363-2, `admin-fixtures`
The suite derives `seasonNow = max(seasons.year)` and `seasonNext = seasonNow + 1`. The old `clearFixtureState()` ran
`DELETE FROM data_edits WHERE table_name='fixtures'`, `DELETE FROM data_overrides WHERE entity_type='fixtures'` and
`DELETE FROM fixtures WHERE season IN (seasonNow, seasonNext)`, on the stated assumption that "nothing outside this suite writes
`fixtures`". On the 4 Nov snapshot (latest season 2026) all 218 `fixtures` rows are provider-owned rows of **2027 = seasonNext**
(rounds 1-24 plus finals codes), so the suite deleted them in `beforeAll`, in the three replay proofs, and in `afterAll`, and committed it.
The accepted rebuild has 0 `fixtures` rows (latest season 2027 `in_progress`), so the damage is invisible there. Because the rows sit
inside the suite's own season, "leave them and scope the queries" cannot work: the suite asserts `seasonNext` is empty and its
duplicate-club checks would collide with real fixtures.

### T363-3, `after-siren`
The old `afterAll` "restored" the table by re-running the real loader `tools/migration/after_siren.py`. On the snapshot that rewrites
`after_siren_kicks` (the stored rows are older than the loader's current output: 5 of the 2026 kicks, rows 122-126, change from
unlinked to linked), adds `import_batches` rows, and the suite's throwaway admin (`auth_users`) was never removed. Aggregates, B4,
shared mode, one fresh copy per base (digests in `raw/dev/b4-*-siren/digest.*.tsv`):

| base | table | before | after `after-siren` |
|---|---|---|---|
| snapshot | `after_siren_kicks` | 126 rows, md5 `1dd1b626...` | 126 rows, md5 `4e3f2325...` |
| snapshot | `auth_users` | 4 | 5 |
| snapshot | `import_batches` | 75 | 81 |
| rebuild | `after_siren_kicks` | 126, md5 `d6c8a20f...` | 126, md5 `dcb01e3a...` |
| rebuild | `auth_users` | 0 | 1 |
| rebuild | `import_batches` | 26 | 32 |

Consequence on the snapshot: `nl-answers-after-siren` then fails 3 ids (loader-refreshed rows: 6 kickers without a trusted link became 1,
the latest match-linked kick changed, the maximum-kicks tie list changed). The same file alone on a fresh snapshot copy passes 20/20.

### `nl-answers-after-siren` is base-dependent in its own right (found while qualifying the rebuild)
Alone, at B4, on the **rebuild** the same three ids fail (raw/dev/b4-rb-nl-alone). Read-only probes of both templates
(aggregates; run on the host, not copied) show two measured states of the 2026 kicks:

| state | 2026 kicks without a match link | kicks without a trusted player link | latest match-linked kick | maximum-kicks tie |
|---|---|---|---|---|
| snapshot (loaded before the matches existed) | 5 | 6 | Nasiah Wanganeen-Milera (2025-07-27) | 9 players |
| rebuild / any database the current loader has run on | 0 | 1 | Tim Membrey (2026-08-28) | 10 players (adds Dylan Moore) |

## 5. The fix

`admin-fixtures.test.ts`
* The register's latest season is **suite-owned**: `beforeAll` inserts the `seasons` row 2071 (after asserting the real latest season is
  below 2071), so `seasonNow = 2071`, `seasonNext = 2072`; no real `fixtures` row is in the suite's window.
* `cleanSuiteSeasons()` self-heals crash debris **only** in seasons 2071/2072 (its fixtures, the `data_edits`/`data_overrides` naming them,
  its marker matches, the 2071 `seasons` row if no match remains). It no longer deletes unproven rows anywhere else.
* Ownership by capture: the pre-existing rows of `data_edits[fixtures]`, `data_overrides[fixtures]` and `fixtures` are captured (jsonb text)
  and every delete is "in scope and NOT in the capture, by id". This still removes the rows a proof deliberately corrupts (non-numeric
  season, invalid status), and still removes orphaned overrides (which would be replayed next run).
* The three replay proofs use `deleteCreatedFixtures()` (the suite's own rows) for the simulated destructive reload.
* `restoreCapturedRows()` is a safety net in `afterAll` only (re-inserts any captured row that went missing, byte for byte, using the
  non-generated column list because `fixtures.is_final` is a GENERATED column). The final test asserts the digest **before** the net runs.
* New final test: `leaves every fixtures, data_overrides and data_edits row it did not create exactly as it found it`. It compares
  `fixtures`, `data_overrides[fixtures]`, `data_edits[fixtures]`, `seasons` and `matches` (count and md5 of the raw rows) against the digest
  taken in `beforeAll`.
* Trap recorded: a postgres.js parameter typed `::jsonb` is serialised as a JSON string; the capture is passed as `::text::jsonb`.

`after-siren.test.ts`
* `afterAll` no longer runs the loader. Owned tables (`data_overrides[after_siren_kicks]`, `after_siren_kicks`, `import_batches` of tool
  `after_siren.py`, the suite's throwaway `auth_users` row) are captured after the marker-scoped clean and restored from the capture
  (delete differing rows, re-insert missing rows with their ids), in a transaction.
* New final test: `leaves every row it did not create exactly as it found it`: digest of the owned tables before and after.

`nl-answers-after-siren.test.ts`
* The three snapshot literals are kept exactly and a second set is added for the resolved state; the state is chosen by one independent
  fact (2026 kicks without a match link: 5 or 0) and any other value fails with its own count. The code under test is unchanged.

## 6. Provenance of every expected value

* No digest is a pinned literal: each is computed at run start and compared with the same query at the end (raw SQL over the tables,
  `md5(string_agg(row::text, chr(10) ORDER BY id))`; no function under test is called).
* The latest-season guard (`< 2071`) holds on both bases (max 2026 on the snapshot, 2027 on the rebuild).
* **Changed expected values: yes, one set.** `nl-answers-after-siren.test.ts`: 6 -> {6 | 1} kickers without a trusted link;
  `Nasiah Wanganeen-Milera` -> {that | `Tim Membrey`}; nine-name tie -> {nine | ten names with Dylan Moore}. Source: the read-only SQL probes
  of both templates above, not the code under test. The snapshot values are unchanged, so nothing was relaxed for the snapshot. The
  alternative (leave them snapshot-only) fails on the accepted rebuild at B4 (alone and in sequence). Owner may prefer to retire the snapshot state
  once the snapshot is no longer a qualification base; that is a decision, not made here.

## 7. Evidence

All runs are on streamanator, own cluster port 55685 (`isolated-pg run`), one fresh `--template` copy per experiment from two templates:
snapshot (the approved restore-verified 4 Nov dump `afldb_prod-20261104T021037Z.dump`, ledger 118, 17056 matches, 218 fixtures; see `raw/dev/setup.log`, `raw/dev/tsnap-probe.txt`)
and the accepted rebuild (dump sha256 `d8397aab...`, 83-table count diff against the published counts: `raw/dev/rb-counts.diff`, empty).
Raw per-run directories hold `run.log`, per-step summaries, full failure text (`*.failures.txt`) and the 14-table digests
(`digest.0.tsv`, `digest.last.tsv`, `digest.cumulative.diff`). Digest tables: fixtures, data_overrides, data_edits, after_siren_kicks,
import_batches, auth_users, sources, seasons, club_seasons, matches, venues, clubs, players, external_identities.

### RED (before the fix)
| run (`raw/dev/`) | code | base | result |
|---|---|---|---|
| `b4-snap-fixtures` | B4 | snapshot | 45/45 pass but digest: `fixtures 218 -> 0` (md5 `d41d8cd9...`) |
| `b4-snap-siren` | B4 | snapshot | `after-siren` 10/10 pass with 3 tables changed (digest); then `nl-answers-after-siren` 17 pass, **3 fail** |
| `b4-snap-nl-alone` | B4 | snapshot | 20/20 pass, digest identical (control) |
| `s1-snap-fixtures` | `5895fd19` | snapshot | 45 pass, **1 fail**: `the shared database after this suite (ISSUE-363 T363-2) leaves every fixtures, data_overrides and data_edits row it did not create exactly as it found it` : `AssertionError: expected { fixtures: { n: +0, ... } } to deeply equal { fixtures: { n: 218, ... } }` (`admin-fixtures.test.ts:1458`) |
| `s1-snap-siren`, `s1-rb-siren` | `5895fd19` | both | `after-siren`: 10 pass, **1 fail** `leaves every row it did not create exactly as it found it (ISSUE-363 T363-3)` : `expected { after_siren_kicks: ... } to deeply equal ...` (`after-siren.test.ts:418`) |
| `b4-snap-siren` (step 2), `s1-*-siren` (step 2) | B4/`5895fd19` | snapshot | `nl-answers-after-siren`: `expected [ 'Barry Hall', 'Brad Johnson', ...(8) ] to deeply equal [ ...(7) ]`; `expected 'Tim Membrey' to be 'Nasiah Wanganeen-Milera'`; `expected 1 to be 6` |
| `b4-rb-nl-alone`, `b4-rb-siren` | B4 | rebuild | `nl-answers-after-siren` 17 pass, **3 fail**, same three messages, alone and after `after-siren` (base-dependent literals; run in shared mode) |
| `b4-rb-fixtures`, `s1-rb-fixtures` | B4/`5895fd19` | rebuild | pass, digest identical: T363-2 is not visible on the rebuild (0 fixtures), as expected |

The stage-1 red files are the B4 suites plus only the two new final tests, so each red fails for the reason named, not for a fixture reason.

### GREEN (final code `6bcbd1c6`, clean host checkout)
`raw/final/checkout.txt`: `HEAD 6bcbd1c6a8bb53679664778d10c0fcf2e7a4f38b porcelain 0` before and after. (Development runs on an equal
scratch checkout are under `raw/dev/s2-*`, `s3-*`; the three test files there are byte-identical to the commit, sha256 prefixes
`b539b795...` / `d9fdaeb6...` / `d59487be...`.)

| run (`raw/final/`) | base | mode | result |
|---|---|---|---|
| `final-snap-shared` | snapshot | shared, 3 files in sequence | 46/46, 11/11, 20/20; 14-table digest identical |
| `final-rb-shared` | rebuild | shared | 46/46, 11/11, 20/20; digest identical |
| `final-snap-perfile`, `final-rb-perfile` | both | `AFLDB_TEST_PER_FILE_DB=all` | 46/46, 11/11, 20/20 |
| `final-gate` | - | - | `typecheck rc=0`, `lint:gate rc=0` (ratchet 338 errors in 43 files, baseline allows 338 in 43; baseline file untouched) |

### Mutation proof (red, then restored)
* `raw/dev/s2-snap-mutation`: scratch copy of the suite (never committed) with a test that sets `notes='MUTATED'` on the lowest-id fixture
  and deletes the highest-id fixture before the final test: the final test **fails** (`fixtures n: 217` vs 218), 46 pass, and the `afterAll`
  net restores both rows (cumulative digest identical).
* `raw/dev/s3-{snap,rb}-mutation-season`: scratch copy without `removeSuiteSeason()` in the final test: fails on both bases (the `seasons`
  digest differs), so a leaked season row is caught.

## 8. Family-order runs (shared mode, one database, files serially, one vitest invocation per file)

Family = the 14 integration files that read `fixtures`/`after_siren_kicks` or the tables the owned files write (enumerated by semble and
grep): admin-fixtures, admin-special-records, after-siren, data-editor, database, grid-solver, gridley-corpus, home-records,
match-admin-create, nl-answers-after-siren, settle-afl-api-fixtures, special-records-lifecycle, special-records-public-suppression,
v2-fixture-writer. (`settle-afl-api` and the state-b/brownlow files read `tests/fixtures` JSON, not the table.) Orders: shuffled
(`in/family.sh` list: lifecycle, after-siren, database, v2-fixture-writer, nl-answers, home-records, admin-fixtures, gridley, settle-fixtures,
data-editor, admin-special-records, grid-solver, public-suppression, match-admin-create) and reversed alphabetical. Final-checkout runs:
`raw/final/fam-{snap,rb}-{shuffled,reversed}`; development runs of the snapshot orders on the scratch checkout: `raw/dev/fam-snap-*`.

**Result:** in all four final runs the per-step and cumulative digests of the 14 tables are **identical** (no file in the family changed
a table, mine included); `admin-fixtures`, `after-siren` and `nl-answers-after-siren` pass in every position (46/46, 11/11, 20/20);
`v2-fixture-writer` (29/29) and `settle-afl-api-fixtures` (16/16) pass reading the 218 intact fixtures that `admin-fixtures` previously deleted.

### Failing ids in files I do not own (classification, vocabulary 1-6 of AGENT-BRIEF-COMMON-4 section 4)
Each was reproduced **alone on a fresh copy of the same base** (`raw/dev/ctl-b4-snap-*`, `raw/final/ctl-rb-*`), with the identical ids and text,
and appears identically in both orders: order-independent, not caused by the owned files. The owning scopes classify them authoritatively;
the class below is provisional and is asserted only where the failure text names its own condition.

| base | file | ids | message / condition | class |
|---|---|---|---|---|
| snapshot | `data-editor` | 5 (2a, 2b, 2c, 3a, 3b of the ISSUE-257 F-S9-03 block) | `afldb_test must hold no player_match_stats authority before this suite ... expected 1 to be 0`: the production snapshot holds one durable `player_match_stats` override | 4 (precondition refusal by design; condition named). Passes on the rebuild (63/64, 1 skipped) |
| snapshot | `gridley-corpus` | 1 | `every cell through solveCellSummary writes the run report and has no failing cells`: `expected [ ...(40) ] to deeply equal []` | not classified here (needs the failing-cell report; outside scope) |
| rebuild | `special-records-lifecycle` | 1 | `migration 102 allowlist widenings actually accepts an override and an audit row for both tables`: got `null value in column "admin_user_id"`; the rebuild holds 0 `auth_users` | provisional 1 (base precondition: needs an admin user; passes on the snapshot) |
| rebuild | `special-records-public-suppression` | 23 (file level, all skipped) | `no fixture found for "unlinked" - this database has not been loaded` | 4 (precondition refusal; condition named) |
| rebuild | `grid-solver` | 1 (`drafted_by_club_never_played`) | `linked draft selections are required to exercise the criterion: expected 0 to be greater than 0` | 4 (precondition refusal; condition named) |
| rebuild | `gridley-corpus` | 3 | `criteria has no probed dataset gap` (10 ids), bounded approved-deferral policy (322 entries), no failing cells (40) | not classified here (outside scope) |

## 9. Other observations (not fixed; none MED or above)
* The snapshot's stored `after_siren_kicks` rows are older than the current loader's output (5 of 2026's kicks unlinked). The old suite silently
  "refreshed" them; nothing else did, so the snapshot's stored state is now stable and the per-state pins in section 6 match it.
* Before this change `after-siren` left an `auth_users` row (an admin, `...@example.test`) and `import_batches` rows on every shared run
  (table residue also visible on the rebuild).
* Sequences are not restored (not rows); only rows are compared.
* Crash-debris policy changed: `admin-fixtures` now self-heals only seasons 2071/2072 and no longer deletes `fixtures` rows elsewhere.
* Heavy-lock contention on the host was severe (waits of 30-60 minutes); no lock was bypassed. Single-file focused runs and the read-only
  probes ran without it, as permitted.

## 10. Proposed ledger text (ISSUE-363; for the orchestrator to place)
**Status:** shared-mode leaks T363-2 and T363-3 fixed locally (branch `claude/rem4-shared-20261115`, test-only, unpublished); ISSUE-363 stays open
until the orchestrator merges the run and the remaining base-specific failures are owned.
**Fix:** `admin-fixtures` works in a suite-owned latest season (2071, `seasons` row created and removed) and deletes only rows absent from a
start-of-suite capture, so the snapshot's 218 provider fixtures survive; `after-siren` no longer re-runs the loader in `afterAll` and restores
only the rows it owns; both assert, as a final test, that the pre-existing rows are unchanged (red at B4's behaviour). `nl-answers-after-siren`
pins the 2026 witnesses per measured state (snapshot vs loader-resolved).
**Validation:** clean host checkout `6bcbd1c6`, both bases, shared and per-file: 46/46, 11/11, 20/20; shuffled and reversed 14-file family
order on both bases: 14-table digests identical at every step; typecheck rc 0, `lint:gate` passing; mutation proofs red. Failing ids in other files are
base-specific, reproduced alone, not caused by this change.
**Next action:** register season 2071 in `leaked-fixtures.ts` (`COMMITTED_FIXTURE_SEASONS`); decide whether the snapshot state in
`nl-answers-after-siren` stays pinned; owners classify the section 8 failures.

## 11. Proposed CHANGELOG lines (Unreleased)
* Tests: the shared-mode integration suite no longer deletes the snapshot's 218 provider-owned `fixtures` rows (`admin-fixtures` now works in a
  suite-owned season and removes only rows it created) and `after-siren` no longer rewrites `after_siren_kicks` or leaves an admin and import
  batches behind; each suite asserts that rows it did not create are unchanged (ISSUE-363).
* Tests: `nl-answers-after-siren` pins its 2026 after-the-siren witnesses for both the production snapshot and the loader-resolved rebuild (ISSUE-363).

## 12. Files
`raw/` holds the small raw files (`SHA256SUMS` in this directory covers every file under `raw/`; verify a committed copy with
`git cat-file blob HEAD:<path> | sha256sum`). Host workspace `/mnt/ssd/afldb-rem4-shared-20261115` (scripts in `in/`, full logs and JSON in
`evidence/` and `evidence-final/`; the host copies are not committed).
