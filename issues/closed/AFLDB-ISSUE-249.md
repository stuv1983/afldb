# AFLDB-ISSUE-249 — Promotion/rebuild drops canonical first-kick-goal achievements

- **Status:** RESOLVED 2026-09-26 (discovered 2026-09-26, local). Deployed and accepted on a real
  ISSUE-237 L4 DEV promotion. See §9 for the final acceptance evidence. **Severity:** High (data
  loss on promotion; blocked ISSUE-237 L4). **Area:** database rebuild stage graph
  (`tools/db/rebuild-test.ts`), first-kick-goal importer
  (`tools/records/import-first-kick-goal.ts`), promotion checker (`tools/db/promotion-check.ts`).
- **Implemented/deployed fix:** commit `6ae70722` (`fix(db): preserve first-kick-goal records
  across rebuilds`), on main/DEV.
- **The rest of this document (§1–§8) is the pre-deployment investigation and DB-free/`code_test_db`
  validation record, preserved as written.** It predates the real DEV promotion that proved the fix;
  read it as history, not current status.
- **Branch/worktree:** `sonnet/issue-249` in `D:\dev\afldb-issue-249`, base `main @ 397f422d`.
- **Scope boundary:** code fix + DB-free tests + an isolated `code_test_db` rehearsal. No DEV
  mutation, no PROD contact, no `afldb_test` rebuild, no Git write. The retained
  `afldb_dev_candidate_20260926-033212` is evidence and is not touched.

## 1. Live evidence (operator-reported, 2026-09-26; read, not reproduced here)

The post-merge ISSUE-237 L4 DEV promotion (ISSUE-247 + ISSUE-248 merged at `397f422d`) reached
the post-swap phase (§11d E). There:

| Database | first-kick-goal rows | `wikipedia_first_kick_goal` rows | `fkg-001` override |
|---|---|---|---|
| promoted candidate (`afldb_dev_candidate_20260926-033212`, retained) | **0** | **0** | present (reinstated `data_overrides`) |
| pre-promotion DEV (restored by rollback) | 335 | 334 | present |

The tracked manifest `data/records/first-kick-goal-ids.csv` (334 active `fkg-NNN`) and the curated
extract `data/records/first-kick-goal.csv` both exist; the extract was independently shown to parse
334 rows. The promotion was rolled back; `afldb_dev` again holds 335 / 334 and `fkg-001`.

The 335th DEV row is not a Wikipedia row: it is the ISSUE-167 DEV acceptance record created
through `/admin/records/first-kick-goal/new` — `manual_admin_edit` provenance, source record
`first_kick_goal:fdadd8a8-…`, carried by a whole-row `record` override
(`issues/closed/AFLDB-ISSUE-167.md:3537-3540`). The same acceptance left a `correction` override
(and lifecycle history) on `wikipedia_first_kick_goal:fkg-001` (`AFLDB-ISSUE-167.md:3517-3526`).

## 2. Root cause (proven from source before any production code changed)

### 2.1 The exact path that loses the rows — a RECONSTRUCTION defect

`player_achievements` is import-writable (migration `053_player_achievements.sql:152`,
`grant_import_write`), so the promotion contract treats it as **`rebuilt`**: "the rebuilt
database's own content stands" (`tools/db/promotion-inventory.ts:43-45`). The candidate is a dump
of `afldb_test`, so DEV's first-kick-goal population is exactly `afldb_test`'s.

`afldb_test` is built only by the stage graph `planStages()` (`tools/db/rebuild-test.ts:722-1095`,
pinned by `tests/db-test-rebuild.test.ts:1232-1240`). **No stage runs the first-kick-goal
importer.** The graph resets the database (stage `recreate`), re-runs every migration (which
creates an empty `player_achievements` and its `wikipedia_first_kick_goal` source row), and then
loads reference, fitzRoy, heights, birth dates, coaches, father–son, siblings, after-siren, manual
registrations, DraftGuru, AFL API adjudications, awards, Brownlow, derived and Coleman — never
`tools/records/import-first-kick-goal.ts`. A fresh rebuild therefore reaches **0** by construction.

The ISSUE-237 **L3** destructive `afldb_test` rebuild (2026-09-25) is when this bit: until then
`afldb_test` carried 334 rows only because an operator had once run
`npm run records:first-kick-goal -- --apply` against it by hand (ISSUE-152 Phase E,
`issues/closed/AFLDB-ISSUE-152.md:3265-3291`; "measured on afldb_test 2026-09-13: 334 of 334",
`promotion-inventory.ts:485-487`). L3 reset the database and nothing reloaded the family.

This was observed once before and misfiled: ISSUE-152 found the table empty on a rebuilt
`afldb_test` and recorded "A database rebuilt from tracked sources therefore has none. This is a
**test-fixture gap, not a product defect**" (`AFLDB-ISSUE-152.md:646-656`). It stopped being a
test-fixture gap the moment a rebuilt `afldb_test` became the source of a DEV promotion.

### 2.2 Why the source inputs survive

They never live in the database. The manifest is tracked (`.gitignore:111-113` re-includes only
`data/records/first-kick-goal-ids.csv`); the extract is a gitignored, hand-curated file that sits
in each checkout (`import-first-kick-goal.ts:80-83`, ISSUE-084 §9.2). A reset cannot touch
either. The importer is keyed by those durable ids (`source_record_id = fkg-NNN`,
`player_achievements_source_uq`), so reconstruction is a re-run, not a recovery.

### 2.3 Why `fkg-001` surviving did not reconstruct the other 334

`data_overrides` is a `reinstate` table (`promotion-inventory.ts:557-564`): DEV's rows are carried
into the candidate verbatim. But the `fkg-001` override is a **`correction` delta over a
source-owned row**, never a row. The special-record replay adapter
(`tools/records/special-records-replay.ts`) can only:

- re-create a row from a whole-row **`record`** override (`manual_admin_edit` rows only, :345-367);
- apply a **`correction`** to an existing row — and **refuse the whole run** when the target row
  does not exist: `'correction target row does not exist'` (:303-304, :317-324);
- warn-and-retain a **`lifecycle`** override whose row is absent (:326-343).

**What is proven and what is inferred (restated 2026-09-26, final verification).**

- **Proven (operator-reported live counts, §1):** the promoted candidate held **0**
  `wikipedia_first_kick_goal` rows where DEV held 334. All 334 source rows were missing.
- **Proven:** the `fkg-001` `correction` override survived into the candidate, because
  `data_overrides` is reinstated verbatim.
- **Proven from source:** the adapter's contract. A `correction` whose target row is absent refuses
  the whole run (`special-records-replay.ts:303-304`, `:317-324`).
- **Inferred, not independently proven:** that the failed L4's post-swap `player_achievements` adapter
  (§11d **E1**, second half, which the operator calls **E1b**) refused on exactly `fkg-001`
  with `correction target row does not exist`, and rolled back the manual row's `record`
  re-creation with it. This follows from the code behaviour above applied to the proven state.
  - **No retained transcript line was available to confirm it.** None is on the workstation: not in
    the repository, the sibling worktrees, `D:\dev\afldb-evidence-archive` or `D:\tmp`. The L4 ran on
    the DEV host, which this session did not contact.
  - If the operator retains that transcript, its E1b line should be attached here. Until then, the
    exact refusal mechanism stays an inference.

By design a source-owned row is not re-creatable from an override (ISSUE-167 §8.1/§8.2). The source
importer owns those 334 rows, which is why the fix reconstructs them rather than relaxing the adapter.

### 2.4 Why no gate stopped the swap before E1b — an ACCEPTANCE-GATE defect

- `--phase source` (A3), `restored` (B4) and `candidate` (C2) never look at `player_achievements`.
  `gateCompare` compares only the promotion **contract** tables (`promotion-check.ts:759-762`);
  import-writable ("rebuilt") tables have no count or identity comparison at all.
- The lineage gate never needed a `player_achievements` row to resolve on DEV: its two referrers,
  `data_edits` and `player_link_resolutions`, are **historical-only** on a DEV promotion
  (`promotion-inventory.ts:531-550`, `:654-678`), so they are not reinstated and not remapped.
- A4.2/A4.3 (`gateOverrideReplayTargets`) predict only the `players`, `matches` and
  `match_coaches` replays, not the special-record adapter.
- The rebuild's own FINAL VALIDATION has no first-kick-goal fingerprint (after-siren has one,
  `rebuild-test.ts:2895-2919`), so the L3 rebuild "passed" at 0.

### 2.5 The four candidate mechanisms, separated

| Mechanism | Present? | Evidence |
|---|---|---|
| 1. Reconstruction defect | **YES — the root cause** | §2.1: no stage owns the family |
| 2. Dump/restore defect | No | `player_achievements` is an ordinary `rebuilt` table; the dump carried `afldb_test`'s 0 faithfully |
| 3. Reinstatement defect | No | `data_overrides` was reinstated correctly (fkg-001 present); a correction cannot create rows by design |
| 4. Post-swap acceptance-gate defect | **YES — why it reached the swap** | §2.4: no pre-swap gate reads the family |

### 2.6 Which lifecycle owns reconstruction

The **rebuild stage graph** (`tools/db/rebuild-test.ts`). It is the only lifecycle that turns
tracked sources into a promotable database; the importer is the family's only writer and is
deterministic given its inputs; the post-swap `data_overrides` replay stays the owner of human
decisions over the rebuilt rows (unchanged).

## 3. Fix design

1. **Reconstruction.** A new `first-kick-goal` DATA stage in `planStages()`, placed after
   `derived` / `coleman` (the importer resolves through `players.debut_season`/`final_season`,
   `player_clubs`, `player_match_stats.career_game_no` and cross-checks `player_career_stats`, all
   of which `derived` builds, and the player population is complete after `draftguru`). It runs the
   **existing** importer, as the import role, with `--apply --provenance
   data/records/first-kick-goal.source.json`.
2. **Pinned inputs, fail-closed.** A tracked provenance file pins the extract and the manifest by
   CRLF-normalised sha256, the extract row count and the active manifest count. The importer, under
   `--provenance`, refuses before any database contact on a missing file, a hash or count mismatch,
   or a manifest join that is not exact. `--validate-only` runs the same checks with no database, and
   the rebuild PRECHECK runs it before anything is destroyed.
3. **Importer refactor, not a second representation.** The pure parse/manifest code moves to
   `tools/records/first-kick-goal-source.ts` so the checker and tests can share it without the
   importer's server-only resolver. The importer's resolve and write phases are exported and take a
   database handle, so a rehearsal can run the real code inside a rolled-back transaction. No
   resolution rule, key, column or refusal changes.
4. **FINAL VALIDATION.** Fingerprints derived from the tracked manifest: owned rows = active
   manifest ids, every active id present, no duplicate key, provenance complete.
5. **Promotion gate (independent).** `first-kick-goal source identities` in the checker: the
   expected set is the tracked manifest's active `fkg-NNN` ids; the observed set is the database's
   `wikipedia_first_kick_goal` `source_record_id`s. Missing, unknown or duplicated ids FAIL at
   `--phase source`, `restored` (candidate), `candidate` and `production`; at `restored` every
   target id still active in the manifest must also be in the candidate, so a non-empty target and
   an empty candidate is an explicit STOP. `pre-cutover` reports the target set (INFO). No count is
   hard-coded; the manifest is the expectation.

## 4. Implementation (2026-09-26, uncommitted)

| File | Change |
|---|---|
| `tools/records/first-kick-goal-source.ts` (new) | The pure source contract: extract/manifest parsing and the manifest join moved **verbatim** from the importer; `loadPinnedSource()` (every refusal before any DB contact); `canonicalSha256()` (CRLF folded at the byte level); `trackedExpectedIds()`. No DB, no `server-only`. |
| `data/records/first-kick-goal.source.json` (new, tracked) | The pin: extract sha256 `8f234f3b…a036`, 334 rows; manifest sha256 `72e348a2…cda9`, 334 active. Pinned from the workstation's accepted extract (`D:\dev\afldb\data\records\first-kick-goal.csv`, the ISSUE-084 §9.2 distribution copy). |
| `.gitignore` | Opts the pin in; the extract stays gitignored. |
| `tools/records/import-first-kick-goal.ts` | Refactor, no rule change: imports the source module; exports `resolveFirstKickGoalRows(db, rows)`, `reportResolution()`, `reconcileFirstKickGoal(tx, …)` (the old `sql.begin` body, unchanged, on the caller's transaction); the CLI runs only as a script. New flags: `--provenance <pin>` (load exactly the pinned bytes; refused with `--assign-ids`/`--rekey`) and `--validate-only` (pin + exact join, no DB). |
| `src/lib/ingest/datasets.ts` | `resolveClub`/`resolvePlayer` accept `Sql | TransactionSql` (type-only). |
| `tools/db/rebuild-test.ts` | New `first-kick-goal` data stage after `coleman` (`npx tsx --conditions=react-server tools/records/import-first-kick-goal.ts --apply --provenance data/records/first-kick-goal.source.json`, import role); PRECHECK requires the tracked manifest + pin and runs the pinned `--validate-only`; FINAL VALIDATION adds `first_kick_goal_rows`, `first_kick_goal_id_set_mismatch` (md5 of the sorted id set, `COLLATE "C"`), `first_kick_goal_duplicate_ids`, `first_kick_goal_rows_missing_provenance`, all derived from the tracked manifest. |
| `tools/db/promotion-check.ts` | Gate `first-kick-goal source identities (AFLDB-ISSUE-249)`: pure `judgeFirstKickGoalIdentities()`, read-only `FIRST_KICK_GOAL_IDENTITIES_SQL`. FAIL at `source`, `candidate`, `production`; at `restored` also against the `--old-database` target; INFO at `pre-cutover`. A target id the manifest has since retired is reported, not refused. No existing gate changed. |
| `tools/db/rebuild-test.ts` (final verification) | `main()`'s real `Deps` object is moved **verbatim** into an exported `createCliDeps(spawnSync)`, and `main()` calls it. There is no behaviour change. The runner rehearsal (§6a) uses it to dispatch the planned stage through exactly the CLI's own child-process and psql path. |
| `tools/records/first-kick-goal-rehearsal.ts` (new) + `package.json` script `db:code-test:issue249-rehearsal` | The in-process code_test_db rehearsal `run` (§6), and the rebuild-runner rehearsal `runner` (§6a) with its pure dispatch gate `gateRunnerDeps()`. |
| `docs/production-promotion.md` §2 | One paragraph on the new gate and the rebuild prerequisite. |
| Tests | `tests/first-kick-goal-source.test.ts` (new, 20: +2 for `gateRunnerDeps` over the real `planStages`/`executeRebuild`); `tests/db-promotion-check.test.ts` (+11: +1 for the 334 + manual-row ownership boundary, §6b); `tests/db-test-rebuild.test.ts` (+6, two order lists updated). |

The observed DB name and the 334/335 counts appear nowhere in production logic: the expectation is
always the tracked manifest's active id set.

## 5. DB-free validation (Claude-run, 2026-09-26)

- `npm run typecheck` — clean (final run, after §6a).
- `npx vitest run tests/first-kick-goal-source.test.ts tests/db-promotion-check.test.ts
  tests/db-test-rebuild.test.ts`, final run: **720 tests, 718 passed, 2 failed**.
  - `first-kick-goal-source`: 20/20.
  - `db-promotion-check`: 212/212.
  - `db-test-rebuild`: 486/488. Both failures are the baseline pair below.

**Baseline control of the two `db-test-rebuild` failures (2026-09-26).** This change edits
`tests/db-test-rebuild.test.ts`, so "pre-existing" was proven rather than asserted.
`npx vitest run tests/db-test-rebuild.test.ts tests/db-promotion-check.test.ts` was run in the clean
`D:\dev\afldb` checkout. That checkout is `main` @ `397f422d0997878cc5cbfda348223b639dacedd0`, with an
empty `git status`. It used the same Node (v22.21.0) and the same `node_modules`, because this
worktree's `node_modules` is a junction to it.

| | clean `main` @ `397f422d` | ISSUE-249 worktree |
|---|---|---|
| `db-test-rebuild` | 482 tests, **2 failed** | 488 tests (+6), **2 failed** |
| `db-promotion-check` | 201/201 | 211/211 at the control (+10); 212/212 final (+11) |
| Total | 683, 681 passed | 699, 697 passed (control) |

Both failures reproduce **identically** on `main`: the same test names and the same error text. Only
the line numbers differ, shifted by this change's +111 lines in the test file.

1. `AFLDB-ISSUE-235 I18 fixture harness (DB-free) > teardown and verify run under plain tsx: nothing
   they load reaches server-only (post-I18 teardown refusal, 2026-09-24)`
   - Error: `unresolved import '../../../data/reference/afl-api-identities.json' from
     <checkout>\src\db\queries\afl-api-player-links.ts`.
   - Location: `main` `:5543`, worktree `:5654`.
2. `AFLDB-ISSUE-237 recovery attribution actor — ensure_issue237_recovery_actor.ts (DB-free) > never
   populates a credential or auth-token field, and writes only through the shared ISSUE-235 helper`
   - Error: `AssertionError: expected 'export async function remapActors(\r\…' not to contain
     'INSERT INTO'`.
   - Location: `main` `:8240`, worktree `:8351`.

**ISSUE-249 introduces no additional failure.** The two causes are the I18 walker trying only
`.ts`/`.tsx`/`index.ts`, and the CRLF `'\n}\n'` slice, which is the known Windows autocrlf class.
Neither was changed here; no unrelated production code was touched.
- Importer-adjacent DB-free suites (`coleman-derivation`, `current-season-import`,
  `data-overrides-source-contract`, `special-records-identity`, `special-records-admin`) pass.
  `special-records-replay-parity` is DB-backed (`afldb_test`) and was not run.
- ESLint on every new/refactored file: clean. The remaining findings in `rebuild-test.ts` /
  `db-test-rebuild.test.ts` are pre-existing lines (`no-explicit-any`) this change did not touch.
- `git diff --check`: clean.
- Pinned `--validate-only` against the accepted extract: 334 rows, 334 stable ids, exact join;
  without the extract it refuses (`extract is missing … Nothing was loaded`, exit 1).

## 6. code_test_db rehearsal — PASS 15/15 (2026-09-26)

`npm run db:code-test:issue249-rehearsal -- run --acknowledge code_test_db --out D:/tmp/i249-rehearsal
--real-source`, owner + import DSNs = the workstation `.env` DSNs through the `127.0.0.1:55432`
tunnel with the database swapped to `code_test_db`; `AFLDB_FIRST_KICK_GOAL_CSV` pointed at the
accepted extract for R8. Connections: `code_test_db` as `afldb_owner` and as `afldb_import`.

**Baseline finding.** `code_test_db` — itself built by the same rebuild runner (ISSUE-146) — held
`player_achievements` **0** before the run: an independent reproduction of §2.1.

| # | Scenario | Result |
|---|---|---|
| R3.0 | the importer CLI, pinned `--validate-only`, intact fixture (control) | PASS, exit 0 |
| R3.1 | CLI `--apply` with the extract missing | PASS: exit 1, `extract is missing`, no `Reconciled` |
| R3.2 | CLI `--apply` with a changed extract | PASS: exit 1 on the pinned hash |
| R3.3 | missing manifest | PASS: `identity manifest is missing` |
| R3.4 | the refusals touched nothing | PASS: fingerprint unchanged |
| R1 | reconstruction of a 5-row fixture built from code_test_db facts (3 unique debut players across 1920–2019, 1 unmatched name, 1 ambiguous name) | PASS: 5 inserted under `fkg-001..005`; players 41/10/4 with their debut matches 4996/11101/13463; 1 `career_goals_contradicts_source` data issue (the `*` marker row) |
| R1.b | the rebuild FINAL VALIDATION checks on it | PASS 4/4 |
| R4 | unresolved identities | PASS: `fkg-004` unmatched (0 candidates), `fkg-005` "Jack Shelton" ambiguous (2 candidates); both `player_id`/`match_id` NULL — no guessed link |
| R6 | complete candidate through the gate (alone and vs a target holding the set) | PASS |
| R2 | idempotent rerun | PASS: 0 inserted, 5 updated, 0 deleted; every surrogate id and column identical; data issues refiled identically |
| R5 | catastrophic loss (savepoint deletes the family): target 5, candidate 0 | PASS: gate FAIL with `STOP … holds NO first-kick-goal record while 5 are expected and target … holds 5 — the AFLDB-ISSUE-249 loss`; FINAL VALIDATION also fails (`rows 0≠5`, `id_set_mismatch 1≠0`) |
| R5.b | partial loss of one id | PASS: gate FAIL naming exactly `fkg-001` |
| R5.c | both savepoints rolled back | PASS: reconstruction intact, gate PASS |
| R8 | the REAL pinned source (tracked pin + accepted extract) on code_test_db | PASS: 334 inserted, 0 deleted; 330 linked, 4 unmatched, 0 ambiguous; 328 matches resolved; tracked-manifest gate PASS (334 / 334 distinct); FINAL VALIDATION 4/4 |
| R7 | residue: fresh-session fingerprint before vs after | PASS: identical (`player_achievements` 0, `import_batches` 25, `data_issues` 0, `data_overrides` 0, 5 schemas, 0 prepared xacts, no `promotion_staging`, database comment NULL, sequences `1/false`, `25/true`, `1/false` — restored with `setval` because `nextval` is not transactional) |

Everything ran in one import-role transaction that ended in ROLLBACK; the refusal cases ran the
importer's own CLI as the rebuild stage does. Evidence: `D:\tmp\i249-rehearsal\` (`evidence.json`,
both fingerprints, the fixture) and `D:\tmp\i249-rehearsal.log`, outside the repository.

**Final re-run (2026-09-26, final verification): PASS 15/15, exit 0.** The command was
`npm run db:code-test:issue249-rehearsal -- run --acknowledge code_test_db --out D:\tmp\i249-final
--real-source`, with the same DSNs and the same `AFLDB_FIRST_KICK_GOAL_CSV`. The following
`residue` read the pre-run fingerprint exactly:

- `player_achievements` 0, `import_batches` 25, `data_issues` 0, `data_overrides` 0;
- 5 schemas, 0 prepared transactions, no `promotion_staging`, comment NULL;
- sequences `1/false`, `25/true`, `1/false`.

Log: `D:\tmp\i249-final.log`.

This rehearsal exercises the importer in-process. It does **not** prove that the rebuild RUNNER
schedules and executes the stage. That is §6a.

## 6a. code_test_db REBUILD-RUNNER rehearsal — PASS 12/12 (2026-09-26)

**Why a second rehearsal.** The proven root cause is that `planStages()` omitted the family. §6
calls the importer's phases directly, so it cannot catch a stage that is planned wrongly, dispatched
wrongly or never reached.

**Command.**

```
npm run db:code-test:issue249-rehearsal -- runner --acknowledge code_test_db --out D:\tmp\i249-runner
```

- DSNs: the §6 owner and import DSNs, exported as the runner's own dedicated
  `AFLDB_CODE_TEST_DATABASE_URL` / `AFLDB_CODE_TEST_IMPORT_DATABASE_URL`.
- `AFLDB_FIRST_KICK_GOAL_CSV` points at the accepted extract.
- `C:\Program Files\PostgreSQL\16\bin` was prepended to `PATH` for this run only, because the
  runner's validation path shells out to `psql`.

**How it enters.** It goes through `tools/db/rebuild-test.ts` itself and nothing else:

- `parseArgs(['--target','code_test_db'])` and `resolveTarget()`, with every database-name guard
  intact. It requires the restricted import role, and owner substitution is not offered.
- `resolveFitzroySource()` and `planStages()`, for the real 29-stage plan.
- `executeRebuild()`, unchanged, dispatching through `createCliDeps()`, which is the CLI's own
  `Deps`.

**What executes and what does not.**

- `code_test_db` is already a completed rebuild (ISSUE-146). It holds every earlier stage's output
  and none of this family.
- `gateRunnerDeps()` lets `executeRebuild` walk the whole plan in order and asserts every
  `==> <stage>` announcement against the plan.
- Stages 1–26 are **dispatched but not executed**: no reset, no migration and no reload. The
  destructive `runSql` is never delegated.
- `first-kick-goal` is **executed for real**, with its planned argv and env, through the runner's
  `runCommand`, and it **commits**.
- The run halts deterministically when `ladder-witness` is announced, before it does anything.
- Afterwards, the stage's committed rows, their data issues and its batch are removed exactly, and
  the sequences are restored.
- There is **no second implementation of the stage anywhere**.

| # | Scenario | Result |
|---|---|---|
| RR0 | The runner's own target resolution; both connections on `code_test_db` (`afldb_owner`, `afldb_import`); family empty; no active override; no other session | PASS |
| RR1 | `planStages(code_test_db)` | PASS. `first-kick-goal` is stage **27 of 29**, exactly once. It comes after `recreate`, `migrations`, `privileges`, `fitzroy`, `draftguru`, `afl-api-adjudications-bijection`, `derived` and `coleman`, and before `ladder-witness` → `fingerprints`. Kind `data`, `run: command`. argv = `npx tsx --conditions=react-server tools/records/import-first-kick-goal.ts --apply --provenance data/records/first-kick-goal.source.json`. Env is exactly `AFLDB_IMPORT_DATABASE_URL` = the target import DSN. The planned FINAL VALIDATION SQL carries the family checks. |
| RR1.b | PRECHECK's `firstKickGoalValidateArgv()` through the runner's `runCommand` | PASS: exit 0, `334 rows, 334 stable ids, exact manifest join; no database touched` |
| RR2 | Reference: the importer's own phases on the same database, rolled back | 334 rows, 3 entity data issues |
| RR3 | `executeRebuild` over the whole plan | PASS. 27 stages dispatched in plan order; **only** `first-kick-goal` executed, exit 0. Stage output: `Reconciled 334 rows as import batch 27: 0 updated, 334 inserted, 0 deleted.` It halted before `ladder-witness`; `fingerprints` did not run. |
| RR4 | What the stage **committed**, in a fresh read-only transaction | PASS. 334 rows = the tracked manifest's exact id set, 334 distinct. Links: 321 `unique` + 9 `resolved` + 4 `unmatched`. It is **row-for-row identical to RR2** in every column except the surrogate id and batch, and so are its 3 data issues. One import batch (`tools/records/import-first-kick-goal.ts`, `completed`, `records_read` 334). |
| RR5 | `buildFinalValidationSql(firstKickGoalChecks())` through the runner's own `runValidation` (psql) | PASS |
| RR5.b | The **complete planned FINAL VALIDATION stream** (the `fingerprints` stage's SQL), run read-only | PASS. `first_kick_goal_rows = 334 (expected 334)`, `first_kick_goal_id_set_mismatch = 0`, `first_kick_goal_duplicate_ids = 0`, `first_kick_goal_rows_missing_provenance = 0`. The whole stream: **`AFLDB-FINAL-VALIDATION PASSED: 89 checks`**, psql exit 0. |
| RR6 | §6b ownership boundary on real rows: the committed family plus one `manual_admin_edit` first-kick-goal row (rolled back) | PASS. **335** family rows; the gate PASSes on the **334** manifest ids, both alone and against a target in the same state. The FINAL VALIDATION checks pass. |
| RR6.b | The manual row still present, `fkg-001` removed (savepoint) | PASS. The gate FAILs with `STOP missing 1: fkg-001` and `STOP held by target but absent here 1: fkg-001`. The manual row is not reported as unknown. FINAL VALIDATION fails (`rows 333≠334`, `id_set_mismatch 1≠0`). |
| RR7 | Exact removal (334 rows, 4 data issues including the table-level `source_count_discrepancy`, 1 batch), `setval`, then a fresh-session fingerprint | PASS. Identical to the pre-run fingerprint. An independent `residue` afterwards agreed. |

**First attempt (same day): FAIL, repaired. Disclosed.**

1. **`psql` was not on `PATH`.** RR5 and RR5.b could not run, and the run aborted in RR5.b. RR0–RR4
   had passed. The fix records a missing `psql` as a failure instead of aborting.
2. **The cleanup missed one row.** It removed `data_issues` by a join to the family rows, so it
   missed the importer's **table-level `source_count_discrepancy` row**, whose `entity_id` is NULL.
   The RR7 fingerprint therefore FAILED (`data_issues` 1 ≠ 0), and **one row remained on
   `code_test_db`**.
   - That row was `data_issues` id 8. Pre-run `data_issues` was 0 with its sequence at `1/false`,
     so the row was unambiguously this run's.
   - It was removed by an owner-connection scratch script outside the repository. The script
     inspected the row read-only first, then ran one `DELETE … WHERE id = 8 AND entity_type =
     'player_achievements' AND entity_id IS NULL AND issue_type = 'source_count_discrepancy'`
     (1 row), plus `setval(…data_issues…, 1, false)`. That `setval` was a no-op: RR7 had already
     restored the sequence.
   - The next `residue` read was identical to the baseline.
   - The rehearsal now removes this run's `player_achievements` data issues by an id watermark taken
     before the run, which includes entity-less rows.

   The repaired rehearsal above is the result of record.

Evidence: `D:\tmp\i249-runner\` (`runner-evidence.json`, both fingerprints) and
`D:\tmp\i249-runner.log`, outside the repository.

**Not proven by §6/§6a:** a destructive end-to-end `db:test:rebuild` with the new stage.

- Stages 1–26 were dispatched, not re-executed. Their output is `code_test_db`'s earlier rebuild,
  which a pre-ISSUE-249 runner produced.
- No destructive rebuild was run anywhere. The workstation worktree lacks the gitignored rebuild
  inputs for stages 1–26.
- Nothing about the real DEV promotion is proven here.

The first real end-to-end proof is §7 step 3 (L3 rerun on `afldb_test`).

## 6b. Ownership boundary: 334 source rows vs 335 DEV rows

The tracked source contract owns the **manifest-backed `fkg-NNN` identity set**: 334 active ids in
the current pin. DEV's 335th first-kick-goal row is the ISSUE-167 `manual_admin_edit` acceptance
record (§1).

That row is outside the contract, and the checks scope it out as follows:

- The gate SQL scopes by source key **and** type: `s.key = 'wikipedia_first_kick_goal' AND
  achievement_type = 'first_kick_goal'`.
- The FINAL VALIDATION checks use the same scope.
- A manual row therefore never becomes a manifest member, and never counts as an unknown id.
- The duplicate and provenance checks still apply in full inside that scope.

Proven twice:

- **DB-free:** `tests/db-promotion-check.test.ts`, "owns the manifest-backed fkg set only". It uses a
  table-backed fake that applies the gate's bound `$1`/`$2`. It proves four things:
  - the tracked set plus one manual row gives **PASS**, with `334 … row(s), 334 distinct`;
  - removing one manifest id gives a **STOP naming exactly it**, with `unknown` empty;
  - a duplicated fkg id still **FAILs**;
  - every `firstKickGoalChecks()` SQL carries the same scope.
- **On real rows:** RR6 / RR6.b above.

The replay adapter, not the source gate, owns the manual row. On DEV it is carried by its `record`
override (§2.3).

## 7. What comes next (operator; each step separately authorised) — historical; superseded by §9

*(This section is preserved as written on 2026-09-26 before deployment. It describes the planned
path, not what ran. §9 records what actually happened.)*

1. Review and commit this branch; merge; deploy to DEV (the checker on the DEV host must carry the
   new gate and the tracked manifest/pin).
2. Confirm the accepted extract on each rebuild/promotion host matches the pin (read-only):
   `sha256sum data/records/first-kick-goal.csv` → `8f234f3b76ce78c18e6d0bc7f30ef8f64ec125b4b646f4cd15577a32f0e5a036`
   (the file has no CRLF, so the raw hash equals the canonical one).
3. Give `afldb_test` the family, then prove it with the gate. Either
   - **(recommended)** rerun the ISSUE-237 **L3** `db:test:rebuild` with the extract present (PRECHECK
     now refuses without it); FINAL VALIDATION must show the four `first_kick_goal_*` checks; or
   - run the stage's own command once against `afldb_test` (non-destructive, keyed):
     `npm run records:first-kick-goal -- --apply --provenance data/records/first-kick-goal.source.json`
     with `AFLDB_IMPORT_DATABASE_URL` exported to the `afldb_test` import DSN.

   Then `npm run db:promotion:check -- --environment dev --phase source --database afldb_test` must
   show `[PASS] first-kick-goal source identities (AFLDB-ISSUE-249)` with 334 / 334.
4. Rerun ISSUE-237 L4 from A with a fresh `$STAMP`. Expect the new gate: INFO at A5 (DEV 334),
   PASS at B4 (candidate vs `afldb_dev`), PASS at C2 and after the swap. E1's `player_achievements`
   adapter should then apply the `fkg-001` correction and re-create the manual row (DEV back to
   335 / 334).

Resolve ISSUE-249 only on step 3's source PASS and a clean L4 (B4/C2 PASS, E1 adapter success,
post-swap production PASS). **ISSUE-237 L4 remains NOT COMPLETE** until a separately authorised real
DEV promotion succeeds.

## 8. Boundaries (2026-09-26)

- No `afldb_dev`, `afldb_test` or production contact. No SSH. No commit, push or merge. No
  deployment. One index-only slip is disclosed. To produce the requested `git diff --stat`, Claude
  ran `git add -N` on the five new files, then reverted it with `git reset -q --` on the same paths.
  The index is back to its pre-session state, and the new files are plain untracked (`??`).
- `node_modules` is a junction to `D:\dev\afldb\node_modules` (identical `package-lock.json`), per
  the worktree convention.
- `afldb_dev_candidate_20260926-033212` was not touched.
- Database contact was `code_test_db` only: the rollback-only rehearsal (§6) plus two read-only
  `residue` fingerprints, and one `setval` per touched sequence to return it to its pre-run value.
- Final verification (2026-09-26, commands authorised by the operator for this task):
  - **`code_test_db`:** the §6 re-run and `residue`, and two §6a `runner` runs. The runner runs
    COMMITTED the real stage's rows and then removed them exactly, with a watermark delete and
    `setval`.
  - **Disclosed repair:** the first runner run's one leftover `data_issues` row was removed by a
    scratch owner script (§6a).
  - `code_test_db` ends identical to its pre-session fingerprint.
  - **The clean `D:\dev\afldb` `main` checkout:** one read-only `npx vitest run` for the baseline
    control (§5). Its `git status` is still empty at `397f422d`.
  - **Not touched:** DEV, PROD, `afldb_test` and `afldb_dev_candidate_20260926-033212`. No
    destructive rebuild. ISSUE-237 L4 was not run. No Git write.
  - **Removed stray file:** a zero-byte untracked file named `!report.executed.includes(id))`
    appeared at the worktree root at 05:12, inside this session's window. It is the typical
    by-product of a shell redirect over a `(id) => !report…` fragment of `rebuild-test.ts:3211`.
    It was inspected (0 bytes) and deleted. It was never part of the change.
- The failed 2026-09-26 promotion (§1) is evidence of this defect, not a success; it was rolled back
  by the operator. **It has since been superseded by the resolution in §9.**

## 9. Resolution (2026-09-26, operator-run, real DEV promotion)

The fix (commit `6ae70722`) was reviewed, committed and deployed to DEV. `afldb_test` was given the
first-kick-goal family, and the ISSUE-237 L4 DEV promotion was rerun with a fresh `$STAMP`
(`20260926-085511`), following exactly the §7 path this document proposed.

**Source proof (§7 step 3).**

- The first-kick-goal source promotion gate PASSED: 334/334 manifest identities.
- The rebuild's FINAL VALIDATION reported 89 checks; the source promotion gate PASSED overall.

**L4 (§7 step 4), promotion stamp `20260926-085511`.**

- A/B/C gates (candidate, pre-swap, swap) passed after the documented targeted grid repair.
- G3 found exactly one classified DEV-regenerable hard loss, `CD_I297354`
  (`afl_api_stat_vector_season`, `players/K/Karl_Amon.html`) — unrelated to first-kick-goal, and
  covered by the ISSUE-237 §6.3 DEV exception (full record: `issues/open/AFLDB-ISSUE-237.md`
  §11d.15). `E_promotion` was empty.
- **E1's `player_achievements` adapter applied the `fkg-001` correction and re-created the manual
  row, exactly as predicted in §2.3 and expected in §7 step 4.** The special-record replay reported
  `recreated: 1, restored: 0, corrected: 0, lifecycle: 0`.
- **Resulting DEV first-kick-goal census (the regression proof):** `total_first_kick_goal|335`,
  `wikipedia_first_kick_goal|334`, `manual_first_kick_goal|1` — DEV's exact pre-failure state (§1),
  now reconstructed from source plus the reinstated override, not carried as dead weight through the
  rebuild.
- Post-swap production-phase promotion check PASSED, and the first-kick-goal promotion gate PASSED
  after the swap. Final health: `{"status":"ok","database":"ok","latencyMs":17}`.

**Retained evidence, not touched:** the earlier failed candidate
`afldb_dev_candidate_20260926-033212` (§1, first-kick-goal 0 — the discovery evidence for this
issue) and the pre-rebuild snapshot `afldb_dev_pre_rebuild_20260926-085511`.

**Acceptance.** This resolves exactly the condition §7 set: "Resolve ISSUE-249 only on step 3's
source PASS and a clean L4 (B4/C2 PASS, E1 adapter success, post-swap production PASS)." Both are
proven above. **AFLDB-ISSUE-249 is RESOLVED.**

**Scope note — this does not resolve ISSUE-237.** AFLDB-ISSUE-237's L4 DEV promotion is now PASS
under its own §6.3 contract (the G3 exception used was `CD_I297354`, unrelated to first-kick-goal).
**ISSUE-237 remains OPEN: L5 PROD has not run**, and production's G3 hard-loss rule has no
DEV-style exception. See `issues/open/AFLDB-ISSUE-237.md` §11d.15 for the full L4 record.
