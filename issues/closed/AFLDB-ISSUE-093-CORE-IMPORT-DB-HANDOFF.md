# AFLDB-ISSUE-093 — Core Import DB-Execution Handoff

Handoff into a fresh **Fable / Low / Manual** session. Start point: the
PostgreSQL execution boundary of the Phase 4a core historical importer.
Durable source of truth: `AFLDB-ISSUE-093.md` (§18 + validation iterations).
Do not re-derive anything recorded here.

## CURRENT STATE

- `AFLDB-ISSUE-093` remains **Open**.
- Phase 4a core historical importer implementation is **complete**.
- Importer: `tools/migration/import_fitzroy_core.py`
- Focused non-DB suite: `tests/fitzroy-core-import.test.ts` — latest result
  **19/19 PASS**.
- Real canonical snapshot validation:
  `python tools/migration/import_fitzroy_core.py --label trial-2024 --validate-only`
  — **PASS** (no database access).
- **No fitzRoy PostgreSQL import has occurred yet.**
- DraftGuru has **not** started.

## REAL SNAPSHOT RESULT (trial-2024, validated)

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

Reconciliation (all exact):

- 9,936 player-match rows = 216 matches × 46 players.
- 9,522 Brownlow round-vote rows = 207 home-and-away matches × 46.
- 9 finals × 46 = 414; 9,936 − 414 = 9,522.
- 216/216 matches have player rows; 216/216 have known attendance.
- 658/658 players have one usable DOB; zero DOB conflicts.
- All 18 2024 club identities resolve (fitzRoy "Footscray" era-remaps to
  Western Bulldogs).
- No HALT condition occurred.

## FRESH `afldb_test` (verified final state)

```text
current_database=afldb_test
database_owner=afldb_owner
preserved_db=afldb_test_pre_rebuild_20260825|allow_connections=false
extension=pg_trgm
extension=unaccent
public_tables=60
```

Bootstrap history:

- The existing `afldb_test` was inspected before mutation: owner
  `afldb_owner`, zero user tables, no evidence of old imported data. It was
  therefore **retained**, not dropped/recreated.
- `pg_trgm` and `unaccent` installed.
- `npm run db:migrate:test` applied 71 migration files (`001`–`071`), 0
  previously applied, all 71 succeeded. (An earlier note saying the set ran
  through `072` was stale.)
- `npm run db:privileges:test` completed successfully once the existing
  `.env` test DSN was supplied to the command. A first attempt failed before
  executing the script because `AFLDB_TEST_DATABASE_URL` was unset in the
  interactive shell and `psql` fell back to role `arm`; that invocation made
  **no** database changes.

Privilege reconciliation result:

```text
afldb_app: 41 public relations readable, 19 revoked
afldb_import: 39 registered tables writable, 21 relations revoked
afldb_auth: grants applied on 32 of 32 tables, 28 other relations revoked
afldb_backup: pg_read_all_data needs a superuser; unchanged
```

The `afldb_backup` line is a NOTICE, not a failure.

## PRESERVED OLD DATABASE

`afldb_test_pre_rebuild_20260825` remains:

- `ALLOW_CONNECTIONS=false`;
- reference-only;
- never an input to the new rebuild;
- never to be enabled;
- never to be restored/copied/cloned into `afldb_test`;
- never to be queried as a source for the new importer.

The new rebuild retains **ZERO `AFLDB_LEGACY_SQLITE` dependency.**

## VALIDATED CORE CONTRACTS

### Player identity

- Canonical identity is the AFL Tables profile URL.
- The fitzRoy numeric ID is an in-run grouping/check key only.
- Never merge by name.
- Stable ID ↔ canonical profile URL must remain 1:1.
- An existing canonical profile URL mapped to a different `players.id` fails
  closed **before** any reconciliation mutation.

### Match identity

- `results.csv` is the canonical match/result structure; `player_stats`
  supplements it.
- Do not create duplicate matches independently from both inputs.
- HALT on ambiguous match identity.

### Attendance

- Blank/missing = no observation; `0` = legitimate recorded value.
- One distinct non-null value wins; more than one distinct non-null value
  fails closed.

### Stats

- Map by explicit CSV field name, never by column position.
- Preserve `not recorded / unavailable != 0`.
- Use the Phase-1 stat-availability semantics.

### Brownlow

- `Brownlow.Votes` is player-per-match grain; `NA != 0`.
- Import eligible `brownlow_round_votes`.
- Do not manufacture `brownlow_season_votes` from this snapshot.

### DOB / provenance

- fitzRoy DOB source key: `fitzroy_afldata`; evidence type:
  `fitzroy_player_stats`.
- Club-list DOB evidence (`club_all_time_list`) remains a separate
  provenance layer — never collapse them.

### ISSUE-092

- Reuse `check_population_drop()` from `tools/migration/common.py`.
  Do not duplicate it.

## NEXT OBJECTIVE

The fresh `afldb_test` currently has schema/privileges only. Next action:
load canonical Phase-1 reference data into `afldb_test` using
`tools/migration/load_reference_data.py`, from:

- `data/reference/sources.json`
- `data/reference/seasons.json`
- `data/reference/clubs.json`
- `data/reference/stat-definitions.json`
- `data/reference/stat-availability.json`
- `data/reference/venue-canonical.json`

After reference data is proven loaded, run the existing core importer
against PostgreSQL in dependency-safe order (venues → players → matches →
stats → brownlow; the importer's `--groups` keeps the order).

ISSUE-092 DB-backed tests 24–27 remain pending.

## OUT OF SCOPE

Do not begin: DraftGuru; draft; awards/honours; Wikipedia/FootyWire
adapters; `player_match_period_stats`; final `db:test:rebuild` orchestrator;
release-gate rebaselining; UI/API/frontend changes; dev database work;
production database work; old-database recovery.

DraftGuru follows only after the core historical PostgreSQL importer is
validated.

## LOW-REASONING HALT RULE

The next session is intentionally Fable Low. HALT immediately if:

- player identity is ambiguous;
- match identity is ambiguous;
- two source rows cannot be reconciled deterministically;
- fitzRoy cannot populate a required normalized field;
- schema/migration changes appear necessary;
- site code depends on legacy numeric IDs;
- ISSUE-092 safety conflicts with fresh-import behaviour;
- historical NULL semantics are unclear;
- actual PostgreSQL behaviour materially contradicts the approved importer
  contract;
- scope materially expands.

On HALT report only: 1. exact blocker; 2. evidence; 3. smallest decision
required; 4. files affected.

## COMMAND BOUNDARY

Manual session. Claude inspects/edits repository files natively. The user
runs all shell commands, tests, SQL/psql, migrations, database scripts, Git,
and deployment/service commands. Give one user-operated command at a time.
