# AFLDB-ISSUE-093 — Core Import DB-Execution COMPLETE Handoff

Durable completion record for the fitzRoy/core PostgreSQL execution session
(2026-08-26). Predecessor: `AFLDB-ISSUE-093-CORE-IMPORT-DB-HANDOFF.md`.
Durable source of truth remains `AFLDB-ISSUE-093.md` (§15–§18 phase records);
ISSUE-092 safety design is in `AFLDB-ISSUE-092.md` (§4/§5/§11).

**This handoff marks the end of the fitzRoy/core DB execution session.**
`AFLDB-ISSUE-093` remains **Open**. The next work item is **DraftGuru
ACQUISITION investigation** (see §13 — no DraftGuru data has been acquired
yet).

## 1. Repository synchronization (verified)

- Windows dev checkpoint committed and pushed:
  `cc9b6f7 chore: checkpoint validated AFLDB work through ISSUE-093`
- `streamanator` was initially at `dadcf9c` and held one untracked file:
  `src/db/migrations/071_audit_link_fk_indexes.sql`.
- Before pulling, the server copy and the `origin/dev` copy of that file were
  SHA-256 compared:

  ```text
  87a8c7e3602f9c2a9f4c4cbac69b9046c78d395f352a09aa9f676d6213549ec6
  ```

  They matched exactly. The untracked server copy was removed and the server
  was fast-forwarded `dadcf9c -> cc9b6f7`.
- Server working tree after execution: branch `dev` matches `origin/dev`.
  No tracked rebuild files are dirty. Only pre-existing operational/untracked
  files remain:

  ```text
  .deploy-backups/
  .env.bak-20260815-091704
  .env.bak-20260818-134133
  FETCH_HEAD
  afldb-ui-questions-1440-real-user-v3-20260822.csv
  afldb-ui-questions-2101-realistic-20260822.csv
  afldb-ui-questions-5001-pressure-20260822.WRONG.csv
  afldb-ui-questions-5001-pressure-20260822.csv
  afldb-ui-questions-60-real-user-decline-v3-20260822.csv
  ```

## 2. Fresh `afldb_test` migration state

- The fresh `afldb_test` had migrations 001–071 already applied (bootstrap
  recorded in the predecessor handoff).
- After repository synchronization, `npm run db:migrate:test` reported:
  **72 migration files, 71 already applied, applied only
  `072_dob_conflict_ownership.sql`, success.**
- Fresh `afldb_test` is therefore at migrations **001–072**.
- Preserved `afldb_test_pre_rebuild_20260825` remains reference-only with
  `ALLOW_CONNECTIONS=false` and was **never** used as rebuild input.
- **ZERO `AFLDB_LEGACY_SQLITE` dependency was used.**

## 3. Python runtime discovery (environment note, not a defect)

- The first reference-loader attempt using system `python3` failed **before
  any database work** with `ModuleNotFoundError: No module named 'psycopg'`.
- The repository already carries `.venv/lib/python3.12/site-packages/psycopg`
  (psycopg-binary 3.3.4).
- All DB-backed Python migration/rebuild commands therefore used
  **`.venv/bin/python`**.
- This was an interpreter/environment mismatch only; it occurred before any
  database mutation and is **not** a data or loader failure.

## 4. Canonical reference-data load (PASS)

Loader run with `AFLDB_IMPORT_DATABASE_URL` explicitly derived from
`AFLDB_TEST_DATABASE_URL`, targeting `afldb_owner@localhost:5432/afldb_test`.

```text
sources                                    11
seasons                                   130
  range: 1897-2026
  in progress: 1
clubs                                      24
  current: 18
club_aliases                               48
club_organizations                         21
  relations: 3
stat_definitions                           24
stat_availability                        3,120
  recorded season/stat pairs: 1,159
```

## 5. fitzRoy trial snapshot transfer

- The validated raw snapshot is not tracked in Git.
- The exact previously validated Windows snapshot was **copied** (not
  reacquired) to `data/sources/afltables/fitzroy_core/trial-2024/`:
  `player_details.csv`, `player_stats_2024.csv`, `results.csv`.
- Copying ensured the database execution used the same snapshot previously
  validated against the committed manifest
  (`docs/rebuild-manifests/afltables_fitzroy_core/trial-2024.json`).

## 6. Server-side validate-only result (PASS, no database access)

`.venv/bin/python tools/migration/import_fitzroy_core.py --label trial-2024 --validate-only`

```text
matches                      216
matches_with_player_rows     216
attendance_known             216
players                      658
players_with_dob             658
players_with_dob_conflict    0
player_match_rows            9936
venues                       17
seasons                      2024-2024
brownlow_round_vote_rows     9522
```

All 18 2024 club identities resolved: Adelaide, Brisbane Lions, Carlton,
Collingwood, Essendon, Fremantle, Geelong, Gold Coast, Greater Western
Sydney, Hawthorn, Melbourne, North Melbourne, Port Adelaide, Richmond,
St Kilda, Sydney, West Coast, Western Bulldogs.

## 7. First PostgreSQL core import (PASS)

The import was explicitly pointed at `afldb_test`. Importer-reported counts
and a direct PostgreSQL count check returned **exactly** the same values:

```text
venues                                      17
players                                    658
matches                                    216
match_period_scores                      1,728
player_match_stats                       9,936
brownlow_round_votes                     9,522
```

## 8. ISSUE-092 DB-backed validation (COMPLETE — 27/27 PASS)

The now-populated fresh `afldb_test` ran
`tests/integration/dob-enrichment-issues.test.ts`: **27/27 PASS**, including
the previously pending ISSUE-092 population-gate cases:

- **test 24:** fixture-source run cannot touch the real afltables population;
- **test 25:** empty asserted population is refused unconditionally;
- **test 26:** over-threshold population drop is refused and requires the
  explicit `--acknowledge-population-drop` override;
- **test 27:** equal-or-larger asserted population passes without false
  positive.

Also verified in the same run: migration 072 tests passed; D1
resolved-history suppression passed; D5 `dob_disputed` recomputation passed;
harness integrity passed; test 23 proved no fixture residue.

**ISSUE-092 DB-backed tests 24–27 are no longer pending.**

## 9. Core importer idempotency proof (PASS)

The exact same fitzRoy import was executed a second time against
`afldb_test`. The importer again reported, and a second direct PostgreSQL
count query returned, **exactly** the section-7 counts (17 / 658 / 216 /
1,728 / 9,936 / 9,522). Rows did not double. The trial-2024 core PostgreSQL
importer is proven idempotent for this fresh rebuild execution.

## 10. Reference-loader cascade safety proof (fail-closed, PASS)

An attempted post-core rerun of `load_reference_data.py` was refused with:

```text
ERROR: refusing to load reference data: TRUNCATE ... CASCADE would also empty
brownlow_round_votes, external_identities, match_period_scores, matches,
player_birth_evidence, player_match_stats, player_name_aliases, players,
venue_aliases, venues, which hold data this loader does not rebuild.
Run against a freshly migrated database, or pass --allow-cascade if emptying
them is genuinely intended.
```

No `--allow-cascade` override was used. A direct DB check after the refusal
showed all data intact:

```text
sources                   12
seasons                  130
clubs                     24
venues                    17
players                  658
matches                  216
player_match_stats      9936
brownlow_round_votes    9522
```

`sources` is 12 (not 11) because the canonical reference load initially
created 11 and the fitzRoy core import registered its own source. This is
expected.

The reference loader's cascade guard is proven fail-closed and
non-destructive once downstream/core data exists.

## 11. Important operational conclusion

The supported rebuild order demonstrated by this execution is:

1. fresh database;
2. migrations;
3. canonical reference-data loader;
4. source/core importers.

The reference-data loader is intentionally **not** a general post-core
rerunnable step: its replacement semantics require truncating reference
domains whose cascades can reach downstream data.

**Do not recommend `--allow-cascade` for normal rebuild operation.**

## 12. Current ISSUE-093 state

Completed/proven:

- canonical tracked reference data;
- fitzRoy 1.8.0 acquisition contract;
- trial-2024 manifest/snapshot validation;
- ISSUE-092 population-drop safety mechanisms;
- fresh DB migrations through 072;
- canonical reference-data PostgreSQL load;
- fitzRoy core PostgreSQL import;
- direct DB reconciliation;
- core-import idempotency;
- reference-loader fail-closed cascade protection;
- ISSUE-092 DB tests 24–27.

Still deliberately deferred / not started:

- DraftGuru source acquisition;
- DraftGuru raw snapshot;
- DraftGuru snapshot manifest/checksum contract;
- DraftGuru PostgreSQL importer;
- broader historical fitzRoy acquisition/import beyond trial-2024;
- Brownlow season-total manufacture;
- any remaining ISSUE-093 source families not already completed.

**Brownlow season totals must remain deferred unless the existing ISSUE-093
contract explicitly changes. Do not manufacture totals from partial
evidence.**

The rebuild path must continue to have **ZERO `AFLDB_LEGACY_SQLITE`
dependency**. The preserved `afldb_test_pre_rebuild_20260825` stays locked
(`ALLOW_CONNECTIONS=false`), reference-only, never an input.

## 13. Next boundary — DraftGuru acquisition

The next ISSUE-093 work item is **DraftGuru ACQUISITION investigation**
(`AFLDB-ISSUE-093.md` §13.5), in a fresh bounded session.

**No DraftGuru raw data has yet been acquired for the new rebuild path.**

Before designing or implementing the DraftGuru PostgreSQL importer, the next
session must first determine from repository evidence and the live/source
interface:

1. Exactly which DraftGuru data domains AFLDB requires.
2. Which DraftGuru source is authoritative for those domains.
3. What reproducible acquisition interface is actually available:
   - downloadable files,
   - structured HTTP/API endpoints,
   - embedded structured data,
   - HTML pages,
   - or another mechanism.
4. Whether the acquisition can be performed reproducibly without relying on
   `AFLDB_LEGACY_SQLITE`.
5. How the raw response/files should be preserved as an immutable source
   snapshot.
6. What metadata must be recorded for provenance:
   - source URL/endpoint,
   - acquisition timestamp,
   - source/version information where available,
   - file names,
   - byte sizes,
   - SHA-256 hashes,
   - row/record counts.
7. What stable source identifiers are actually present for:
   - draft events,
   - selections/picks,
   - players,
   - clubs,
   - draft years/seasons,
   - trades/order/pick metadata where applicable.
8. Whether DraftGuru player records contain a stable identifier that can be
   reconciled with AFLDB identities without unsafe name-only merging.
9. What null/missing/not-applicable representations occur in the real
   acquired data.
10. Whether historical coverage is complete or has gaps that must be
    explicitly represented.
11. How acquisition and PostgreSQL import will remain separate stages,
    matching the fitzRoy architecture.
12. What validation-only checks can be performed against the acquired
    snapshot before any database mutation.

Important: do **NOT** define the final DraftGuru database mapping based only
on assumptions about the website or hypothetical fields. An actual DraftGuru
snapshot must be acquired and inspected before the final
source/identity/import contract is approved.

The intended sequence is:

```text
DraftGuru source investigation
-> acquire raw data
-> preserve immutable snapshot
-> generate/verify manifest and checksums
-> inspect real schema/fields/identities
-> define source and identity contract
-> plan PostgreSQL importer
-> implement
-> validate/reconcile/idempotency test
```

The rebuild path must continue to have **ZERO `AFLDB_LEGACY_SQLITE`
dependency**.

All contracts in `AFLDB-ISSUE-093-CORE-IMPORT-DB-HANDOFF.md` (player
identity via AFL Tables profile URL, match identity via `results.csv`,
attendance semantics, NULL ≠ 0 stats, Brownlow `NA != 0`, ISSUE-092
`check_population_drop()` reuse) remain in force.
