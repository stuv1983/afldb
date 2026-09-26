# AFLDB-ISSUE-247 — A legitimately empty staged reinstatement table blocks promotion

- **Status:** Open (2026-09-25). Implemented and DB-free validated. `code_test_db` rehearsal **PASS
  7/7** (2026-09-26, rollback-only, zero residue — §6). *(2026-09-26: committed `86e0e2ba`, merged
  `397f422d` and deployed to DEV. Two L4 runs then passed A5 and the staged reinstatement. None of
  the §7 live evidence was recorded, so it stays open; see §9.)*
- **Severity:** High — it blocks ISSUE-237 L4 at A5 on a valid DEV state.
- **Area:** promotion lifecycle — `tools/db/promotion-inventory.ts` (contract, `stageSql`,
  `promoteStagedSql`, `judgeStagedSourceRows`, plan validator), `tools/db/promotion-check.ts`
  (`--phase pre-cutover` staged-rows gate), `docs/production-promotion.md` §2 / §7.2.
- **Branch / worktree:** `sonnet/issue-247`, `D:\dev\afldb-issue-247`.
- **Related:** AFLDB-ISSUE-151 (staged reinstatement), AFLDB-ISSUE-155 (`brownlow_vote_entry_state`
  staged), AFLDB-ISSUE-235 (`afl_api_identity_adjudications` staged), AFLDB-ISSUE-237 (L4 A5,
  runbook §11d.14). Fixture-account cleanup is AFLDB-ISSUE-248 and is **not** part of this issue.

## 1. Live evidence (operator-run, 2026-09-25)

ISSUE-237 L4 A5 (`npm run db:promotion:check -- --environment dev --phase pre-cutover --database
afldb_dev --snapshot …`) was **REFUSED**:

```text
[FAIL] Staged tables hold rows in the replaced database
  brownlow_vote_entry_state      3
  external_grid_sources          1
  afl_api_identity_adjudications 0 — EMPTY
```

The AFL API census passed in the same run: importer rows **669**, human resolved rows **0**, ledger
rows **0**, net-linked ledger entries **0** (A4.1 read 0/0). An empty
`afl_api_identity_adjudications` ledger is a valid, evidenced state: the ledger records only human
adjudications, and no administrator has adjudicated an `afl_api` identity on DEV. A ledger row is
never manufactured to satisfy the gate. Nothing past A5 ran.

## 2. Root cause

AFLDB-ISSUE-151's staged mechanism restores a staged table's rows into a constraint-free
`promotion_staging.<t>` copy (plan step 2b), remaps them (2c), then promotes them into `public`
under the FK (2d). A data-only restore of an empty table leaves no row behind, so 2d could not tell
"restored zero rows" from "2b never ran". It resolved the ambiguity by presuming rows:

- `promotion-promote-staged.sql` raised `promotion_staging.<t> is empty …` for any empty copy;
- `--phase pre-cutover` (`judgeStagedSourceRows`) refused any empty staged table, so the plan would
  never reach that refusal mid-transcript.

That was sound while the only staged table (`external_grid_sources`) was seeded by migration 080.
ISSUE-155 and ISSUE-235 later staged two more tables by the same shape rule, and
`afl_api_identity_adjudications` can legitimately be empty. The mechanism **conflated a legitimate
zero-row table with a failure to execute the stage restore step**.

## 3. Fix (implemented 2026-09-25, uncommitted)

The emptiness question and the did-the-restore-run question are now answered separately.

### 3.1 Contract property: `stagedMayBeEmpty`

`TableTreatment.stagedMayBeEmpty?: { decidedBy, reason }` — a written declaration, never a table-name
special case. `promotionContractProblems()` refuses it on a table that is not a staged
reinstatement, without an `AFLDB-ISSUE-<n>` deciding issue, or without a reason. Only
`afl_api_identity_adjudications` declares it (`AFLDB-ISSUE-247`). `external_grid_sources` and
`brownlow_vote_entry_state` still **require rows**, exactly as before.

### 3.2 Stage-completion evidence (the sentinel)

`promotion-stage.sql` now also creates, in the same transaction as the staging copies:

- `promotion_staging.promotion_stage_completion (staged_table text PRIMARY KEY CHECK (staged_table
  IN (<the staged tables>)), restored_rows bigint NOT NULL CHECK (>= 0), completed_at timestamptz)`;
- `promotion_staging.record_stage_completion()` — a PL/pgSQL trigger function that refuses anything
  but a statement-level `INSERT` on a `promotion_staging` table, then inserts `(TG_TABLE_NAME,
  count(*) FROM <transition table>)`;
- one `AFTER INSERT … REFERENCING NEW TABLE AS restored FOR EACH STATEMENT` trigger per staging copy.

Why this binds the evidence to the stage step for that exact table:

| Property | Mechanism |
|---|---|
| Fires on a 0-row restore | A statement-level trigger fires once per `COPY` statement, even when it copies no rows. |
| Transactional | The row is written inside the load's own `psql --single-transaction`; a failed or rolled-back load leaves none. |
| A skipped load leaves none | Nothing but the trigger writes the table; the plan validator refuses any generated file (plan, remap, promotion) that writes it or drops/alters a trigger. |
| An empty script leaves none | A `promotion-stage-<t>.sql` with no `COPY` (an empty `pg_restore` stream) fires nothing. The existing `grep -q '^COPY promotion_staging.<t> ('` guard also stops it first. |
| No spoofing by an unrelated table | The name comes from `TG_TABLE_NAME` of the table the trigger is on, never a literal; the `CHECK` admits only staged tables; each table's promotion looks up its own name. |
| No double load | The primary key refuses a second `COPY` into the same copy, rolling that load back. |
| Not a row in the real staged table | The evidence lives in its own table. |

It is **not** a new plan file and it adds no new transcript line: the existing load line
`psql "$CANDIDATE_DSN" -v ON_ERROR_STOP=1 --single-transaction -f promotion-stage-<t>.sql` is what
fires it.

### 3.3 The promotion decision (step 2d)

Per staged table, before its `INSERT`:

| Evidence row | Staged rows | Contract | 2d |
|---|---|---|---|
| absent | any | any | **REFUSE** `promotion_staging.<t> has no stage-completion evidence: its staged restore (plan step 2b) did not run, did not commit, or loaded a script with no COPY for this table` |
| present (`restored_rows = n`) | ≠ n | any | **REFUSE** `… holds % row(s) but its evidenced restore copied %` |
| present | 0 | requires rows | **REFUSE** — the ISSUE-151 message, word for word |
| present | 0 | `stagedMayBeEmpty` | **promote** zero rows; `NOTICE … permitted empty by contract (AFLDB-ISSUE-247)` |
| present | n > 0 | any | unchanged (the unsettled-reference refusal still runs) |

After the last promoted table the file drops `promotion_stage_completion`, then
`record_stage_completion()`, then the schema, all without `CASCADE`, so any leftover object refuses
the whole file. Triggers are dropped with their staging tables. The sentinel does not survive a
completed promotion.

### 3.4 Pre-cutover gate

`judgeStagedSourceRows` gains `emptyPermitted`: a permitted empty table is reported (`EMPTY,
permitted by contract (AFLDB-ISSUE-247); promoted only on stage-completion evidence`) and does not
FAIL. An **absent** staged table still FAILs, and so does an empty table that requires rows. With
the A5 counts (`afl_api_identity_adjudications` 0, `brownlow_vote_entry_state` 3,
`external_grid_sources` 1) the gate now PASSes.

### 3.5 Unchanged

- Interrupted staging is still refused at every phase (`gateStagingLeftover`); its report now also
  names the evidence table when present, for the inspection.
- `CREATE SCHEMA` still refuses a leftover; nothing generated drops it outside 2d.
- Candidate/production count comparisons: all three staged tables still compare `equal`, so a
  permitted empty table must read 0 in the candidate.
- No constraint is dropped, deferred or disabled; ids are preserved; no `sources`/`matches`/`players`
  row is inserted.

## 4. Files changed

- `tools/db/promotion-inventory.ts` — `StagedMayBeEmpty`, `STAGE_COMPLETION_TABLE`,
  `STAGE_COMPLETION_FUNCTION`, `stagedMayBeEmpty()`, `stagedMayBeEmptyProblems()`,
  `stageCompletionTriggerSql()`, `stageEvidenceMissingMessage()`, `stageCompletionProblems()`; the
  contract entry for `afl_api_identity_adjudications`; `judgeStagedSourceRows`,
  `judgeStagingLeftover`, `stageSql`, `promoteStagedSql`, `stagedPlanProblems`,
  `lineageRemapProblems`, `promotionContractProblems`, the plan's 2b/2d comments and the acceptance
  checklist.
- `tools/db/promotion-check.ts` — the pre-cutover staged-rows gate reports permitted empty tables.
- `tests/db-promotion-check.test.ts` — the ISSUE-151 invariant test rewritten for the new contract;
  a new `AFLDB-ISSUE-247` block (12 tests).
- `docs/production-promotion.md` — §2 phase table, §7.2 staged steps 2b/2d, the new evidence section
  (with the A5 evidence), the interrupted-staging inspection.
- `issues/open/AFLDB-ISSUE-237.md` (§11d.14, status row, closing note), `issues.md`,
  `IssuesIndex.md`, `CHANGELOG.md`, this file.

## 5. Validation (DB-free, 2026-09-25, Windows worktree)

- `npx tsc --noEmit` — clean.
- `npx vitest run tests/db-promotion-check.test.ts` — **201/201** (the ISSUE-151 invariant test
  rewritten for the new contract; 12 new ISSUE-247 tests; every other ISSUE-151/155/235 staged test
  unchanged and green).
- `npx eslint tools/db/promotion-inventory.ts tools/db/promotion-check.ts
  tests/db-promotion-check.test.ts` — clean.
- `git diff --check` — clean.
- `tests/reference-data.test.ts` — 1 pre-existing, unrelated failure: its migration-derived
  "registered import write" list lacks migration 104's `afl_api_identity_adjudications`. It reads
  only migration files, and no migration is touched here.

No in-process PostgreSQL is installed, so the generated 2d SQL is exercised by a guard-sequence
walker (`runPromoteBlock`): it reads each table's `DO` block guards in file order and fails on any
guard it does not know, so a control-flow change forces the test to be revisited. The trigger and
transaction semantics themselves are only provable in PostgreSQL — §6.

## 6. Rehearsal (`code_test_db` only; rollback-only; zero residue) — PASS 7/7, 2026-09-26

Purpose: prove in PostgreSQL what the DB-free suite cannot — the trigger fires on a zero-row
`COPY`, a rolled-back load leaves no evidence, and the promotion refuses/accepts per §3.3.

Preconditions: `CODE_TEST_DSN` is the owner-role code_test_db DSN (on the workstation:
`AFLDB_TEST_DATABASE_URL` through the `127.0.0.1:55432` tunnel with the database name swapped to
`code_test_db`); `psql -Atc 'select current_database()'` prints `code_test_db` before anything
else. The code may be the uncommitted worktree (the 2026-09-26 run was). Every scenario runs in
**one outer transaction that ends in `ROLLBACK`** (or aborts on the expected error), so nothing
persists. On Windows put psql options before the DSN (`psql -X -At -v ON_ERROR_STOP=1 -f <f> -d
"$CODE_TEST_DSN"`).

```bash
set -eu
W=/tmp/i247-rehearsal; mkdir -p "$W"
# R0. Plan files only (no database contact). Dump paths are syntax-only here.
npm run db:promotion:check -- --environment dev --plan --database afldb_dev_candidate_r247 \
    --old-database afldb_dev --pre-cutover-dump "$W/pre.dump" --rebuilt-dump "$W/rebuilt.dump" \
    --plan-dir "$W/plan"
cd "$W/plan"
for f in promotion-truncate promotion-stage promotion-promote-staged; do
  sed -e '/^BEGIN;$/d' -e '/^COMMIT;$/d' "$f.sql" > "$W/$f.inner.sql"
done
# R1. A source dump of the three staged tables from code_test_db itself (shared lineage, so the
#     2c remap is a no-op and every reference already resolves).
pg_dump "$CODE_TEST_DSN" -Fc --data-only -t public.afl_api_identity_adjudications \
    -t public.brownlow_vote_entry_state -t public.external_grid_sources -f "$W/pre.dump"
for t in afl_api_identity_adjudications brownlow_vote_entry_state external_grid_sources; do
  pg_restore --data-only --no-owner --no-privileges --table=$t -f - "$W/pre.dump" \
    | sed -e "s/^COPY public\.$t (/COPY promotion_staging.$t (/" > "$W/stage-$t.sql"
  grep -q "^COPY promotion_staging.$t (" "$W/stage-$t.sql"
done
# R2. A ZERO-ROW afl_api script: the same COPY header and terminator, no data lines. This is
#     exactly what pg_restore emits for an empty table (R6 proves that on a real empty table).
awk '/^COPY promotion_staging\.afl_api_identity_adjudications \(/{print; skip=1; next}
     skip && /^\\\.$/{skip=0} !skip' "$W/stage-afl_api_identity_adjudications.sql" > "$W/stage-afl0.sql"
# R3. code_test_db cannot represent A5 from its own rows: its baseline is afl_api 0 /
#     brownlow 0 / grid 1 (auth_users 0), and brownlow REQUIRES rows. Rehearsal-only fixture DATA,
#     transaction-local, never committed:
#   - stage-brownlow-seed3.sql: exactly 3 synthetic COPY lines (status draft, NULL vote slots,
#     created_by = updated_by = 924701) spliced between the REAL brownlow COPY header and its
#     terminator; match_id/season come from existing matches via a read-only
#     COPY (SELECT … FROM public.matches …) TO STDOUT;
#   - fixture-auth-user.sql: refuse if auth_users id 924701 or email i247-rehearsal@invalid
#     exists, then INSERT … OVERRIDING SYSTEM VALUE (role contributor, password_hash NULL,
#     totp_secret NULL, disabled_at now()). It stands in for the real plan's own auth_users
#     pg_restore, which runs after promotion-truncate (auth_users is truncated there) and before
#     the staged promotion (brownlow_vote_entry_state declares restoreAfter: ['auth_users']).
#   The afl_api script stays the REAL, unchanged pg_restore output (its genuine zero-row COPY is
#   the proof), and external_grid_sources stays the REAL dumped row. Never fabricate a ledger row.
```

Each scenario is `psql -X -At -v ON_ERROR_STOP=1 -f <scenario>.sql -d "$CODE_TEST_DSN"`, where the
scenario file is `BEGIN;` + `\i promotion-truncate.inner.sql` + `\i fixture-auth-user.sql` +
`\i promotion-stage.inner.sql` + the loads below + `SET client_min_messages = notice;` +
`\i promotion-promote-staged.inner.sql` + checks + `ROLLBACK;`. The `SET` is needed because the
pg_restore preamble sets `client_min_messages = warning` for the session; in the real plan 2d runs
in its own psql session. A read-only fingerprint (`fingerprint.sql`: `promotion_staging` schema,
`promotion_stage_completion`, `record_stage_completion` function and triggers, fixture user and
fixture Brownlow rows, the grid row's md5, `promotion_candidates_decision_fk`, row counts of every
truncated table plus `staging_aflw`, every `public`/`staging_aflw` sequence position) is taken in a
fresh session before the rehearsal and after every scenario.

| # | Loads (after stage.inner) | Expected | Result 2026-09-26 |
|---|---|---|---|
| S1 (A5 state) | real afl (0 rows), brownlow-seed3, real grid; evidence before/after the afl load; promote; post checks | 3 evidence rows (`afl_api…` **0**, brownlow 3, grid 1); `NOTICE … permitted empty by contract (AFLDB-ISSUE-247)`; staging schema, evidence table, recorder, triggers all gone | **PASS.** Evidence 0 rows before the afl load; `COPY 0` then `EVIDENCE afl_api_identity_adjudications 0`; after all loads 0/3/1; the NOTICE; `INSERT 0 0`, `INSERT 0 3`, `INSERT 0 1`; POST schema/table/function/trigger all 0; public 0/3/1; `ROLLBACK` |
| S2 (skipped) | brownlow-seed3, real grid (no afl load) | `ERROR: promotion_staging.afl_api_identity_adjudications has no stage-completion evidence …` | **PASS.** Evidence brownlow 3, grid 1 only; that exact ERROR at the first 2d block; psql exit 3 |
| S3 (grid empty) | real afl, brownlow-seed3, stage-grid0 (R2's awk on the grid script) | the ISSUE-151 `… external_grid_sources is empty …` refusal, word for word | **PASS.** Evidence 0/3/**0** (the zero-row grid `COPY` also fired); afl NOTICE, brownlow settled, then the ISSUE-151 ERROR verbatim; psql exit 3 |
| S4 (double load) | real afl twice | the second `COPY` fails on `promotion_stage_completion_pkey` | **PASS.** `duplicate key value violates unique constraint "promotion_stage_completion_pkey"`, `Key (staged_table)=(afl_api_identity_adjudications)`, raised inside `record_stage_completion()`; psql exit 3 |
| S5 (rolled-back load) | `SAVEPOINT l`, real afl, `ROLLBACK TO SAVEPOINT l`, brownlow-seed3, real grid | evidence present inside the savepoint and absent after it; promotion refuses as S2 | **PASS.** Inside `afl_api_identity_adjudications 0`; after `ROLLBACK TO` 0 rows; the S2 ERROR; psql exit 3 |
| S6 (empty script) | `empty.sql` (0 bytes) in place of the afl load, brownlow-seed3, real grid | no afl evidence; promotion refuses as S2 | **PASS.** The S2 ERROR; psql exit 3. The real plan's `grep -q '^COPY promotion_staging.afl_api_identity_adjudications ('` exits 1 on the empty file and 0 on the real zero-row script |
| S7 (non-empty) | real afl, brownlow-seed3, real grid | evidence `restored_rows` = staged count; the ordinary settled notices; promotion PASS | **PASS.** `EVIDENCE_EQUALS_STAGED` true/true; "3 / 1 staged row(s) settled"; the promoted grid row's md5 equals the pre-rehearsal row's (`d8bdde68…`, id preserved); brownlow 16623/16624/16625 promoted; `ROLLBACK` |

**Residue.** After every scenario the fresh-session fingerprint was byte-identical to the baseline
(109 lines). The final fresh session read: no `promotion_staging` schema, `auth_users` 0, public
afl_api / brownlow / grid 0 / 0 / 1, no other sessions, no prepared transactions.

**Identity.** `code_test_db`, PostgreSQL 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1), role
`afldb_owner`, reached through the workstation tunnel. The plan was generated by the operator (R0,
"no database contacted"), and the three `.inner.sql` files equal the plan files minus
`BEGIN;`/`COMMIT;` (checked with `cmp`). Rehearsal files: `D:\tmp\i247-rehearsal\` (not in the
repository). Implementation change required: none.

**R6 (empty-table dump shape).** Proven on `code_test_db`'s real empty ledger (R1, 2026-09-26):
`pg_restore --data-only --table=afl_api_identity_adjudications -f - pre.dump | grep -c '^COPY
public.afl_api_identity_adjudications ('` → **1**, with the header followed directly by `\.`. Still
to repeat on the real DEV pre-cutover dump at L4 B-phase (read-only on the file). This is the fact
the whole design rests on (pg_dump emits a data entry with a `COPY` header for an empty table); the
plan's own `grep` guard re-proves it live and stops the transcript if it is ever false.

## 7. Proposed live procedure (after rehearsal PASS, commit, merge and DEV deployment)

1. Rerun ISSUE-237 L4 **A5** with a **fresh `$STAMP`** (the refused A5 may have written its
   snapshot; keep that file aside as FAIL-run evidence). Expect `[PASS] Staged tables hold rows in
   the replaced database` with `afl_api_identity_adjudications 0 staged — EMPTY, permitted by
   contract (AFLDB-ISSUE-247); promoted only on stage-completion evidence`, and the census
   669 / 0 / 0 / 0 unchanged.
2. Continue L4 by ISSUE-237 §11d. At plan generation, read `promotion-stage.sql` (the evidence table,
   recorder and three triggers) and `promotion-promote-staged.sql`.
3. At 2b the `grep` guard for `promotion-stage-afl_api_identity_adjudications.sql` must succeed
   (R6). After the three loads, read-only: `SELECT * FROM
   promotion_staging.promotion_stage_completion ORDER BY 1;` → expect `afl_api… 0`,
   `brownlow_vote_entry_state 3`, `external_grid_sources 1`; record it.
4. At 2d expect the `NOTICE … permitted empty by contract (AFLDB-ISSUE-247)` for the ledger and the
   usual settled-row notices; afterwards `promotion_staging` is absent.
5. `--phase candidate --compare <snapshot>`: `afl_api_identity_adjudications` compares `equal`
   0/0.

Resolve ISSUE-247 on rehearsal PASS plus the live A5 PASS and a clean 2b/2d on DEV. ISSUE-237 stays
open throughout.

## 8. Not done / boundaries

- 2026-09-25: no database, SSH, Git write or deployment command was run. A5 was not rerun.
- 2026-09-26: only the §6 rollback-only `code_test_db` rehearsal was run, under operator
  authorisation. It contacted no `afldb_dev`, `afldb_test` or production database; there was no
  SSH, no Git write, and no A5 rerun. The live DEV R6 check has not run.
- No ledger row was created. No fixture-account work (ISSUE-248).

## 9. Closure audit against ISSUE-237 L4 (2026-09-26, DB-free, Claude-run): REMAINS OPEN

- **Implementation state.** Committed `86e0e2ba`. It is contained in `397f422d` (the rolled-back
  L4, `20260926-033212`) and in `6ae70722` (the accepted L4, `20260926-085511`).
- **Recorded.** Both runs got past A5 and through the reinstatement: 033212 reached the post-swap
  phase (`issues/closed/AFLDB-ISSUE-249.md` §1), and 085511 reports "A/B/C gates … passed" (ISSUE-237
  §11d.15). The ledger was still empty at 085511: the post-swap AFL API adjudication replay
  "inserted 0, noops 0". So the permitted-empty path very probably ran live.
- **Missing (NOT RECORDED; the steps ran, except R6, whose run is unknown).** §7 names five live
  items, and none of them is in any repository record:
  1. the A5 `[PASS] Staged tables hold rows …` line with `afl_api_identity_adjudications 0 staged
     — EMPTY, permitted by contract (AFLDB-ISSUE-247)`;
  2. the R6 `grep` of `promotion-stage-afl_api_identity_adjudications.sql` for the real zero-row
     `COPY` header;
  3. the `promotion_staging.promotion_stage_completion` readback (expected `afl_api… 0`,
     `brownlow_vote_entry_state 3`, `external_grid_sources 1`);
  4. the 2d `NOTICE … permitted empty by contract (AFLDB-ISSUE-247)`, and the absence of
     `promotion_staging` afterwards;
  5. the C2 `--compare` line `afl_api_identity_adjudications equal 0/0`.

  In addition, the "documented targeted grid repair" that A–C needed is not documented anywhere in
  the repository. `external_grid_sources` is one of the three staged tables on this same 2b/2d
  path, so "clean 2b/2d" cannot be asserted until that repair is described.
- **Closure path (operator).**
  - Items 1, 3, 4 and 5 exist only in console output. Item 3 cannot be re-derived, because 2d drops
    the evidence table.
  - Item 2 needs no database. Re-check the host-generated
    `promotion-stage-afl_api_identity_adjudications.sql` if it was retained. Otherwise run
    `pg_restore --data-only --table=afl_api_identity_adjudications -f -` over the retained
    085511 pre-cutover dump, which is a file-only read.
  - Record what the grid repair was, and whether it touched the staged path.
  - If the console output is gone, whether to accept the progression evidence is an operator
    decision. This audit does not weaken §7 to make it.
