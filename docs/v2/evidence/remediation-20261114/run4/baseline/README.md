# Remediation run 4, scope `baseline`: the three integration cells run 3 never measured, at B4

Branch `claude/rem4-baseline-20261115` (created at B4 `7cfbe186e70ca91db67da1aa4e28325ccbc32a86`). No code and no test was changed; this directory is the
only thing the scope commits. Purpose (PLAN-REVIEW-4 F-009): measure, at B4, the cells run 3 never measured, so the run-4 failure ledger can say
gone / new / continuing for every cell. Everything below was measured on the DEV host `streamanator` in the scope's own workspace and cluster; nothing is
inferred from run 3 except where a table says "run 3".

## 1. Proof that B4 carries run 3's Q′ code

`proof-b4-equals-qprime.txt`: `git diff --stat 692b1902 7cfbe186 -- src tests tools packages deploy package.json package-lock.json` is **empty (0 bytes of
diff)**. Q′ = `692b1902cbcc321cea76a30857a03e15f02db6b7`. The only paths that differ between Q′ and B4 are `CHANGELOG.md`, `IssuesIndex.md`, `blockers.md`,
`issues.md` and files under `docs/v2/evidence/remediation-20261114/{,run3,run4}`. So the B4 integration tests, `src`, `tools` and `packages` are Q′'s.

## 2. The three cells, named exactly

| Cell | Base (fresh copy of) | `AFLDB_TEST_PER_FILE_DB` | Driver |
|---|---|---|---|
| **C1** | accepted rebuild + DraftGuru bridge child + `ANALYZE` (`afldb_v2_rem4baseline_rbb_tmpl_test`) | `all` (every file its own database) | `run2/tests363/run-integration-per-file.sh` (committed, unchanged), `MODE=all`, `AUDIT` on |
| **C2** | same template, one fresh copy `afldb_v2_rem4baseline_c2_test` | unset (every file serially against that ONE copy) | `isolated-pg run <db> -- node node_modules/vitest/vitest.mjs run tests/integration` |
| **C3** | 4 Nov snapshot, restored and migrated to ledger 118 (`afldb_v2_rem4baseline_snap_tmpl_test`), one fresh copy `afldb_v2_rem4baseline_c3_test` | unset | same as C2 |

All three: `--reporter=default --reporter=json --outputFile.json=...`, `tests/integration` (99 files), vitest 4.1.10, Node 22.23.2, `fileParallelism: false`
(`vitest.config.mts`), the vitest cache deleted before each cell, ports: PostgreSQL **55686** only, no `.env` in the checkout. "Shared" means one of the scope's own
isolated databases, never the shared `afldb_test` (brief section 1). **Mode `1` (only the `COMMITTING_SUITES`) was not run.** Not run either: unit tests, typecheck,
lint, build, the dedicated Brownlow clones, the OD-5 rebuild-named clone, the Coleman schema-only base, the `draftguru-import` importer groups (Stage A was absent in every cell, as at
run 3's Q′ integration run, so its `describe.skipIf(!canRun)` importer groups are skipped, reported as 23 `pending` assertions in the JSON; its reload-guard group, which needs no Stage A, runs and passes in all cells; see section 3), and the snapshot x per-file control (not re-run: run 3's
`run3/qualification-3/integ-failures.tsv` is the reference, and C3 below reproduces it exactly, which is the cheaper control).

Environment common to the cells: `PYTHON`, `AFLDB_PYTHON`, `AFLDB_TEST_PYTHON` = `/home/arm/i250/afldb/.venv/bin/python`; `AFLDB_V2_PG_ROOT/PORT/BIN`;
`AFLDB_DRAFTGURU_BRIDGE=<child>` set for C1 and C2 only (draft-linkage derives its expectations from the child; run 3's snapshot cell did not set it).
`AFLDB_TEST_PER_FILE_DB_PREFIX`, ambient DSNs and `AFLDB_TEST_PER_FILE_DB` (for C2/C3) were refused by the driver's guard; `raw/c{2,3}-env-names.txt` lists
the `AFLDB_*` variable names in the driver's environment (names only). `AFLDB_TEST_PYTHON` is new relative to run 3's `qual.sh` (it matches integb); it is
constant across the three cells.

## 3. Preparation (all verified before use; `raw/driver-*.txt`, `raw/run.log`)

- Bundle `/mnt/ssd/afldb-rem4-base/base-B4.bundle` sha256 `b1e2491b…7a74` verified against `SHA256SUMS`; host checkout `HEAD` = B4 and **0 porcelain lines**
  before every cell (the cell guard stops otherwise) and at the end; `npm ci` (427 packages).
- **Snapshot:** `afldb_prod-20261104T021037Z.dump` 30,141,895 bytes sha256 `e77c307d…826d` (both verified), restored with `restore.mjs`, `migrate.ts --target test`
  ("118 already applied"), probe ledger `118_fixtures_unconfirmed_participants.sql`, 17,056 matches, `fixtures` 218, 1 `player_match_stats` authority row, no
  in-progress season, `draft_picks` 6,818 (`raw/snap-template-identity.txt`, `snap-tmpl-probe.txt`).
- **Accepted rebuild:** `afldb_v2_rb_rem3-6d5388ea.dump` sha256 `d8397aab…65c63` plus `SHA256SUMS` (`sha256sum -c` OK for all 5 files), restored per `RESTORE.md`
  (`create-db`, `restore-dump.mjs`: `pg_restore exit=0`, `IR verify`: `ISOLATED TARGET OK`). The exact `count(*)` of all **83** public tables is **identical** to the
  published `table-counts.tsv` (`raw/rb-table-counts.diff` empty). Identity: ledger 118, 17,056 matches, 13,365 players, `fixtures` 0, 2026 `complete`, in progress
  **2027**, authority rows 0, `draft_picks` 6,810 (`raw/rb-template-identity.txt`).
- **Bridge:** Stage A raw pages were copied read-only from the run-3 workspace `/mnt/ssd/afldb-rem3-qual-20261114/cand/data/sources/draftguru/annual-html-20260826`
  after **42/42** files matched `docs/rebuild-manifests/draftguru/annual-html-20260826.json`; child `…bridge-child-v3-6d5388ea.json` sha256 `1200e702…b9d`;
  `import_draftguru.py --label annual-html-20260826 --bridge <child>` rc 0 (picks 6,810, persons 5,057, bridge identities 3,559, `raw/bridged-identity.txt`),
  then `ANALYZE` (run 3 integb section 8). The only difference from the pristine rebuild is `import_batches` 26 -> 27 (`raw/rb-bridged-template.table-counts.tsv`
  against `rb-table-counts.restored.tsv`). **Stage A was deleted from the checkout again before any cell ran** (guard), so the checkout state equals run 3's Q′
  integration run (Stage A absent) and the `draftguru-import` importer groups stay skipped (23 `pending` + 1 `skipped` in every cell). The fitzRoy `full-history-20260902` and `sample.json` fixtures were not installed: no
  integration test reads them (they feed the unit tests; grep of `tests/integration` shows only `settle-afltables` building its own bundle directory).
- Every cell started from a **fresh** `--template` copy; C1's base was verified unmodified by the run (`raw/c1-base.table-counts.diff` empty); **0** per-file
  databases were left (`IR list | grep -c _pf_` = 0).

### Incident (no authority breach): the first `tmpl_rb` run failed at the Stage A check
`raw/driver-evidence-setup.out.txt`: the first script version (`scripts/baseline.v1-first-run.sh`, sha256 `c264dc82…8d`) prefixed `raw/years/` to manifest paths that
already carry it, so all 42 files "mismatched" and the phase stopped after the restore and count diff (those passed). I split the phase into `tmpl_rb` (restore and count
diff, as run) and `bridge` (path fixed) and ran `bridge c1 c2 c3` (`scripts/baseline.sh`, sha256 `fdc595e7…db7`; `raw/driver-evidence-run2.out.txt`). Nothing else changed;
`run.log` therefore carries one extra "stage A: verify and copy" line.

### Relation to run 3's scripts
Reused: `run2/tests363/run-integration-per-file.sh` (unchanged, used from the checkout), run-3 `qual.sh`'s vitest invocation and its `vfail` extraction (moved verbatim
into `scripts/vfail.js`), `setup.sh`'s clone/cluster/template phases and `run-rebuilt.sh`'s restore, count diff, bridge import and `ANALYZE`. Not a line-for-line copy:
paths, port (55686), database names (`afldb_v2_rem4baseline_*_test`), lock (`/mnt/ssd/afldb-rem4-base/heavy.lock`) differ; the unit, shell, build and fixtures phases are
absent. `scripts.sha256`-style hashes: `SHA256SUMS`.

## 4. Results

| | **C1** rebuild x per-file | **C2** rebuild x shared | **C3** snapshot x shared |
|---|---|---|---|
| Files (vitest) | 17 failed / 76 passed / 6 skipped (99) | 16 / 77 / 6 (99) | 11 / 82 / 6 (99) |
| Tests (vitest) | **66 failed** / 3,409 passed / 2 expected fail / 147 skipped (3,647) | **68** / 3,408 / 2 / 146 (3,647) | **42** / 3,457 / 2 / 123 (3,647) |
| Failing ids (`file<TAB>name<TAB>text`, file-level counted once each) | **73** (66 tests + 7 file-level) | **73** (68 + 5) | **46** (42 + 4) |
| Duration | 2,329.9 s vitest (38.8 min wall) | 1,474.6 s | 1,572.7 s |
| Driver rc | 1 (vitest failures) | 1 | 1 |
| Per-file DBs left / base changed | 0 / no | n/a | n/a |
| Leaked committed rows (table-count diff, section 7) | n/a | 8 tables | 7 tables |
| Section 4 classes (by `classify.js`) | 4 x class 1, 27 x 3, 5 x 5, **37 unclassified-baseline** | same tallies (different ids) | 14 x 1, 27 x 3, 5 x 5, **0 unclassified** |

(`awards-reload-links` is a file-level failure with an empty message in all three cells: its own refusal text is not in the first failure line the JSON keeps; run 3's
`integ-failures.tsv` records it the same way.)

Failing-id lists, raw: `raw/c1-failures.tsv`, `raw/c2-failures.tsv`, `raw/c3-failures.tsv` (`file<TAB>full test name<TAB>first line of failure`); with classes:
`raw/c{1,2,3}-classified.tsv`; counts and per-file status/duration: `raw/c{1,2,3}-counts.txt`; summaries `raw/c{1,2,3}-summary.txt`; raw vitest JSON and logs (gzipped):
`raw/c{1,2,3}.json.gz`, `raw/c{1,2,3}.log.gz`.

### Comparisons (`raw/cmp-*.tsv`, keyed on file + full test name)
- **C3 against run 3's snapshot x per-file (46 ids, `run3/qualification-3/integ-failures.tsv`): 46 common, 0 only in either.** Shared mode on the snapshot at B4 fails
  exactly the ids per-file mode failed at Q′ (this is "continuing" for all 46; the three cells' B4 = Q′ equality of section 1 makes this a like-for-like comparison).
- C1 against C2: **70 common, 3 only in C1, 3 only in C2.** C1-only: `admin-season-lists` (file-level), `settle-afl-api-state-b` (file-level),
  `special-records-lifecycle` ("migration 102 allowlist widenings"). C2-only: `afl-api-c7-observation` x3.
- C1 and C2 against C3: 36 common with C3; 37 only on the rebuild (cells C1/C2), 10 only on the snapshot. The 10 snapshot-only are run 3's class-1 ids that pass on
  the rebuild (admin-brownlow x1, data-editor x5, draft-linkage x2, release-gates x2), exactly as run 3 integb section 7 recorded.
- Run 3 never measured a rebuild full run, so no id of C1/C2 is "gone/new" against run 3; ids also in run 3 integb sections 7-8 are marked below, the rest are a
  **first measurement** ("unclassified-baseline", no cause is claimed).

## 5. File order of the shared runs (one order is one sample)

`raw/c2-order.txt`, `raw/c3-order.txt` (`n<TAB>file<TAB>marker`) were taken from vitest's per-file result lines; the JSON reporter's file order (`raw/c*-counts.txt`)
is the same. **C1, C2 and C3 ran the 99 files in the identical order** (no vitest cache; vitest's default sequencer then orders by file size): 1 settle-afl-api, 2 settle-afltables,
3 awards-reload-links, 4 data-editor, 5 club-comparison, 6 settle-promotion-deadlock, 7 match-results-promotion, 8 settle-afl-api-brownlow, 9 admin-brownlow, 10 admin-draft,
11 admin-awards, 12 privileges, 13 draftguru-import, 14 settle-afl-api-issue276, 15 admin-lifecycle, 16 grid-solver, **17 admin-fixtures**, 18 admin-club-leadership,
19 admin-special-records, 20 v2-brownlow-eligibility, 21 gridley-corpus, 22 dob-enrichment-issues, 23 first-kick-goal-reload-links, 24 release-gates, 25 admin-season-lists,
26 nl-semantic-mapping, 27 nl-answers-relationships, 28 v2-coleman-publication, 29 database, 30 submission-promotion, 31 nl-answers-team-club, 32 query-builder,
33 player-family-and-coaching, 34 v2-curated-awards, 35 observation-spine, 36 admin-coaches, 37 settle-afl-api-state-b, 38 settle-afl-api-fixtures, 39 match-admin-create,
40 sealed-editor-guard, 41 v2-fixture-writer, 42 nl-answers-game-season, 43 player-link-concurrency, 44 match-admin-delete, 45 club-comparison-route,
46 isolated-populated-lifecycle, 47 special-records-public-suppression, 48 afl-api-lineup-store, 49 nl-search-telemetry-clear, 50 settle-afl-api-brownlow-backtest,
51 coach-head-to-head, 52 nl-answers, 53 settle-afl-api-brownlow-reschedule, 54 special-records-lifecycle, 55 nl-answers-after-siren, 56 nl-answers-cross-domain,
57 afl-api-c7-observation, 58 venue-records, 59 nl-answers-first-kick-goal, 60 db-promotion-receipts, 61 nl-answers-coaching, 62 coach-comparison-route, 63 player-matching,
64 v2-brownlow-production-correction, 65 join-request-approval, 66 draft-linkage, **67 after-siren**, 68 import-role-match-lock, 69 brownlow-pending-projection,
70 brownlow-pending-populated, 71 afl-api-ownership-census, 72 fk-indexes, 73 admin-audit, 74 auth-audit-jsonb, 75 club-coach-records, 76 derived-rebuild-parity,
77 club-premierships, 78 v2-brownlow-eligibility-2025-rehearsal, 79 club-honours, 80 datasets, 81 email-intake, 82 access-codes, 83 gridley-aa-oracle, 84 gridley-height-oracle,
85 club-match-records, 86 v2-afl-api-settle-findings, 87 admin-upload-route, 88 nl-answer-boundary, 89 home-records, 90 club-premiership-players, 91 club-crowd-records,
92 club-players, 93 nl-vocab, 94 club-comparison-view, 95 player-compare, 96 grid-solver-investigation, 97 db-health, 98 player-honours, 99 import-role-parity.
Another order (a different cache state, a changed file size, `--sequence.shuffle`) can move order-dependent results; section 7 names the ones this order exposes.

## 6. Classification (brief section 4; only where run-3 records give the cause)

`scripts/classify.js` applies first-match rules citing run 3 `integb` section 7 rows (and section 8 for the rebuild-only ids) and `qualification-3` "Common (46)"; a rule fires
only on the base(s) where run 3 observed that failure; everything else is `unclassified-baseline` with its failure text. No id is relabelled.

- **C3 (snapshot x shared): all 46 ids classified**, each by run 3's record: class 1 x14 (admin-brownlow 1, data-editor 5, draft-linkage 2, release-gates 2, OD-5 1, v2-coleman 1,
  the two dedicated-clone suites 2), class 3 x27 (club-comparison 24, release-gates "50-199 goals", "absence is never zero", "club organizations"), class 5 x5 (awards-reload-links,
  gridley-corpus, release-gates "2026 is provisional" x3). Identical to the run-3 per-file ids.
- **C1 and C2: 37 ids each are `unclassified-baseline`; 40 distinct ids in all (34 common, 3 C1-only, 3 C2-only), `raw/unclassified-baseline-union.tsv`.** Of these, **7 are
  already named in run 3 integb section 8** as failing on the rebuild and never classified there (club-comparison "Jarryd Lyons" 6850 vs 6818 and "Footscray ... James Cook";
  release-gates "birth dates" x3 (13,347 vs 13,255, 14,294 vs 14,110, 13,367 vs 13,275); gridley-corpus "no probed dataset gap" (4 criteria) and "bounded approved-deferral
  policy" (65 cells)). **The other 33 are a first measurement** (run 3 never ran these suites on the rebuild; all 33 pass on the snapshot, in C3 and in run 3):

| File | Ids | Cells | First failure line (representative) |
|---|---|---|---|
| nl-answers-relationships | 11 | C1 C2 | `expected [ 12661 ] to deeply equal [ 3048 ]`; `expected 'Garry Fenton' to be 'Garry Foulds'`; `fixture assumption failed: the Ablett family was not found` |
| nl-answers-cross-domain | 6 | C1 C2 | `Dani Laidley must have coached at least o…`; `Tom Hafey (12550) must be in X2`; `expected [] to have a length of 3 but got +0` |
| nl-answers-first-kick-goal | 4 | C1 C2 | `expected 334 to be 330` (x2); `expected +0 to be 4`; `expected [] to have a length of 4 but got +0` |
| nl-answers-after-siren | 3 | C1 C2 | `expected 'Tim Membrey' to be 'Nasiah Wanganeen-Milera'`; `expected 1 to be 6`; tie-list length differs |
| afl-api-c7-observation | 3 | **C2 only** | `PostgresError: update or delete on table "seasons" violates foreign key constraint "club_seasons_season_fkey"` (the test's own `DELETE FROM seasons` at `afl-api-c7-observation.test.ts:218`) |
| admin-season-lists | 2 | C1 (2), C2 (1) | `2027: expected true to be false` (both); file-level `update or delete on table "auth_users" violates foreign key constraint "data_overrides_admin_user_id_fkey"` (**C1 only**) |
| nl-answers-coaching | 1 | C1 C2 | `expected 15 to be 14` |
| special-records-public-suppression | 1 | C1 C2 | file-level `no fixture found for "unlinked" — this database has not been loaded` |
| settle-afl-api-state-b | 1 | **C1 only** | file-level `afldb_test has no auth_users row; this file will not create one.` |
| special-records-lifecycle | 1 | **C1 only** | `expected [Function] to throw error including 'rollback' but got 'null value in column "admin_user_id" …'` |

I make no causal claim for these 33. Observations that bear on a later classification, none verified as a cause: (a) the two bases agree on the row counts of the tables these
suites read (`coaches` 386, `player_relationships` 626, `after_siren_kicks` 126, `player_achievements` 334) but differ in player surrogate ids (`player_name_aliases`,
`external_identities` 19,319 vs 18,424) and in `match_coaches` (32,034 vs 32,470) (`raw/snap-template.table-counts.tsv` against `raw/rb-table-counts.restored.tsv`); run 3 integb section 2
had already recorded that `facts4` differs "only in player surrogate ids", and PLAN-REVIEW-4 F-012 pre-registers that a surrogate-id fingerprint differs by base; (b) the rebuild has
**0 `auth_users`**, `admin_invites`, `data_overrides` and `data_edits` rows (snapshot: 4 / 3 / 165 / 168), which matches the three C1-only admin-user ids and the file-level
`auth_users` messages; (c) the rebuild already holds a **2027 `seasons` row** (snapshot: none), which matches `admin-season-lists` "2027".

## 7. Shared-mode evidence (T363-2, T363-3 and new contamination)

Table-count diffs of every public table before and after the shared cells (`raw/c{2,3}-before|after.table-counts.tsv`, `raw/c{2,3}.table-counts.diff`); per-file residue per file in C1:
`raw/c1-audit.jsonl` (`netRowDelta` per table; run 3's snapshot equivalent is `run3/qualification-3/integ-audit.jsonl`).

**T363-2 (`admin-fixtures` deletes every `fixtures` row): reproduced on the snapshot, structurally absent on the rebuild.** C3: `fixtures` **218 -> 0** after the run; the file
order puts `admin-fixtures` 17th, so every later suite ran on an empty table; **no failing id in C3 is attributable to it** (C3's 46 ids equal run 3's per-file 46). The audit that names the
suite: run 3 snapshot per-file `integ-audit.jsonl` (`admin-fixtures`: `public.fixtures` `netRowDelta` -218). On the rebuild `fixtures` is 0 before the run (C2: 0 -> 0), so the effect
cannot appear there; the C1 audit has no `fixtures` residue.

**T363-3 (`after-siren` / `nl-answers-after-siren` cross-file contamination): not reproduced as a shared-mode effect at B4.** C3 (snapshot x shared): both files pass (0 ids), with
`after-siren` 67th and `nl-answers-after-siren` 55th in this order. On the rebuild the three `nl-answers-after-siren` ids fail in **both** C1 (per-file) and C2 (shared) with the same text, so there
they are base-dependent, not order-dependent (section 6, `unclassified-baseline`). One order is one sample: this says nothing about other orders.

**New shared-mode effects (not in the run-2 T363 list); candidate defects for the `shared` scope, each with its evidence, none fixed here:**
1. **`v2-coleman-publication` deletes the real Coleman 2001 `award_winners` row after refusing to run.** Evidence: the audit shows `award_winners` `netRowDelta` **-1** for that file in C1 and in
   run 3's snapshot per-file audit; C2's table diff shows `award_winners` 3,713 -> 3,712. Mechanism read from `tests/integration/v2-coleman-publication.test.ts`: `beforeAll` (line 302) calls
   `teardown()` while `awardId` is still 0, then `seed()` resolves it, then line 307 throws "refusing to run: 1 Coleman 2001 row(s) already exist that this suite did not create"; `afterAll`
   (line 310) runs `teardown()` with `awardId` now set, and `purge()` line 187 `DELETE FROM award_winners WHERE award_id = ${awardId} AND season = ${SEASON}` removes the row it refused to touch.
   Both templates hold exactly one Coleman 2001 row (`scripts/q-coleman.sh`: snapshot 1/46 Coleman rows, rebuild 1/47). C3's net `award_winners` is unchanged (unexplained; a later suite may restore it).
   The brief's rule "cleanup deletes only rows the suite created" is broken by this file, which no run-4 scope owns.
2. **Admin-user rows leaked by earlier files mask the rebuild's empty `auth_users` in shared mode.** C2: `auth_users` 0 -> 4, `data_edits` 0 -> 6, `data_overrides` 0 -> 3; C1's audit attributes
   `auth_users` +1 to `match-results-promotion`, `submission-promotion`, `sealed-editor-guard`, `join-request-approval` and `after-siren`. `settle-afl-api-state-b` (37th), `special-records-lifecycle`
   (54th) and the `admin-season-lists` file-level teardown failure occur in per-file C1 and not in shared C2: consistent with their result depending on an earlier file having left an admin user (not proven).
3. **`afl-api-c7-observation` x3 fails only in shared mode on the rebuild** (`club_seasons_season_fkey` on its own `DELETE FROM seasons`). C2's `club_seasons` grew 1,640 -> 1,642, and C1's audit shows
   `match-admin-delete` (44th, before `afl-api-c7-observation` 57th) committing `club_seasons` `netRowDelta` +2. That correlation is consistent with the leak being the cause; I did not prove it
   (it needs a focused two-file run).
4. Other leaked committed rows, both shared cells: `import_batches` +225 (rebuild 27 -> 252; snapshot 75 -> 300), `import_rejections` +3, `sources` +1; C3 also `auth_users` +4, `data_edits` +6, `data_overrides` +2.

## 8. Anything that looks new (for the orchestrator; nothing outside scope was changed)

- **MED, escalated:** the 33 first-measurement failures on the accepted rebuild (section 6) and the two shared-mode effects 1-2 above change what run 4's rebuild cells can show. Whatever
  the plan intends the rebuild cells to prove, 40 ids fail on it today with no recorded cause, 33 of them never seen before; run 3's "isolated accepted-baseline rebuild PASS" covered the
  53-id groups only (integb section 7-8), not the full suite. C1 and C2 differ by 6 ids that are order/leak effects (section 4).
- **MED, escalated:** `v2-coleman-publication` deletes a real row after its own refusal (section 7, item 1), in a file no scope owns.
- LOW/INFO: all three cells passed their guard (HEAD B4, 0 porcelain, no `.env`, no Stage A, no ambient DSN). The 6 skipped files and `draftguru-import`'s skipped groups mean ~147 skipped tests
  in C1 (146 in C2) against 123 in C3, i.e. 23 to 24 more skipped tests on the rebuild; not examined.

## 9. Reproduction

```
# workstation: scp scripts/baseline.sh scripts/vfail.js scripts/counts.js scripts/classify.js scripts/post.sh to $W/in/ (W=/mnt/ssd/afldb-rem4-baseline-20261115, plain mkdir first)
bash $W/in/baseline.sh clone cluster tmpl_snap tmpl_rb bridge c1 c2 c3 seal stop   # as run: clone cluster tmpl_snap tmpl_rb, then bridge c1 c2 c3, then seal, stop
bash $W/in/post.sh                                                                 # orders, classes, comparisons (reads the host evidence dir)
```
Host evidence (full, uncompressed JSON and logs): `/mnt/ssd/afldb-rem4-baseline-20261115/evidence/` (`c{1,2,3}.json`, `c{1,2,3}.log`); the committed copies are gzipped, and
`gunzip | sha256sum` of each equals the host file's hash (`raw/host-raw-sha256.txt`, checked). `raw/SHA256SUMS-host.txt` and `raw/scripts.sha256` are the host's own seal output; `SHA256SUMS` (this directory) hashes
every committed byte. The superseded `raw/c{1,2,3}-order-log.txt` (`baseline.sh`'s first order extraction, a loose pattern: 172/169/147 names for 99 files)
is kept for completeness; `raw/c{1,2,3}-order.txt` (from `post.sh`) is the one to use.

State at the end: cluster stopped, no listener on 55686, no process under the workspace, host checkout `HEAD` B4 with 0 porcelain lines; workspace and cluster left in place (1.4 GB and 2.4 GB).
