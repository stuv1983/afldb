# AFLDB V2 — backup and rollback runbook

Status: written in Stage 6 (Launch E, 2026-10-19). **NOT EXECUTED.** No step below has been run
against any database, host or service. Nothing here is an approval: every production step needs
the owner's explicit approval for that window (`docs/v2/go-no-go.md` §4), and the ISSUE-316 gates
(`issues/open/AFLDB-ISSUE-316.md` §7-§8) are separate owner decisions that this rebuild neither
grants nor satisfies.

This runbook pairs with `docs/v2/cutover-runbook.md` (the forward path) and
`docs/v2/shadow-rehearsal.md` (where every step below is rehearsed first, on a restored copy).
It covers only what V2 adds. The AFL Tables retirement and the AFL API unit installation have
their own rollback and roll-forward rules in ISSUE-316 §7 ("Roll-forward point").

## 1. What V2 changes in a production deployment

| Layer | Change | Reversible by |
|---|---|---|
| Schema | migration `111_curated_award_proposals.sql` (tables `award_proposals`, `award_proposal_decisions`) and `112_derived_award_results.sql` (table `derived_award_results`). Additive: no existing table, column, row, id or FK is altered | §5 (drop the three tables, after exporting them) |
| Grants | `tools/maintenance/privileges.sql:382-418` (afldb_import SELECT/INSERT, a column-scoped UPDATE on `award_proposals`, sequence USAGE) and `:550-559` (afldb_auth SELECT). No `afldb_app` grant: the tables are not app-readable | re-running the PREVIOUS release's `privileges.sql` after §5 (its revoke loop strips grants it does not name) |
| Code | the V2 application (operations centre, retired legacy admin surfaces, seal checks, Coleman publisher, curated awards) | §4 (redeploy the previous release) |
| Host | the email-intake timer disabled in the deploy window (`docs/v2/cutover-runbook.md` step 4) | §4.3 (re-enable it only if the previous release is restored and the owner wants CSV intake back) |

V2 does **not** rewrite any existing row. A rollback therefore never needs a data restore for the
existing tables; the backup in §2 is the safety net for an unexpected outcome, not a planned step.

## 2. Backup before the window (operator, production host)

Taken immediately before the cutover window, with every writer paused as the current production
release procedure requires (nightly settles not running, no admin edits in flight).

```bash
# 1. Custom-format dump of production (afldb_backup role, read-only; docs/backup-restore.md §1).
#    AFLDB_BACKUP_DATABASE_URL comes from the operator's environment file, never the command line.
bash tools/maintenance/backup.sh --keep 14
#    -> ~/backups/afldb/afldb_prod-<STAMP>.dump; record its sha256:
sha256sum ~/backups/afldb/afldb_prod-<STAMP>.dump

# 2. Prove it restores (docs/backup-restore.md §2). This restores into afldb_restore_test on the
#    host where the script runs and records the dump's sha256 as that database's comment.
bash tools/maintenance/restore-test.sh ~/backups/afldb/afldb_prod-<STAMP>.dump

# 3. Copy the dump off the host (the established off-host location) and record both sha256 values.

# 4. The sealed-history fingerprint of production, read-only (needs the owner's authority for a
#    read of a NON-test database; docs/v2/historical-manifest-spec.md §7). Run from the V2 checkout:
npx tsx tools/v2/historical-manifest.ts produce --dsn-env AFLDB_PROD_READONLY_DATABASE_URL \
    --out ~/backups/afldb/v2-manifest-before-<STAMP>.json \
    --read-only-source --i-understand-this-reads-a-non-test-database
```

Gate B (stop unless all hold): the dump exists, `pg_restore --list` succeeded inside `backup.sh`,
`restore-test.sh` exited 0 with every parity check equal, the off-host copy's sha256 equals the
host copy's, and the manifest file exists. `AFLDB_PROD_READONLY_DATABASE_URL` is a name chosen for
this runbook: any variable holding a read-only production DSN works, because the producer reads
only the variable named by `--dsn-env`.

## 3. Decision points

| Symptom after the deploy | Action |
|---|---|
| Migration 111 or 112 fails | Nothing to roll back: each migration runs in its own transaction (`tools/db/migrate.ts:287-299`) and a failure rolls it back and records nothing. Stop the window; keep the previous code running |
| `privileges.sql` fails | The previous code does not use the new tables, so production behaviour is unchanged. Stop; fix forward or run §5 |
| Build fails | The previous build is still the one being served (the build runs before the restart). Stop; nothing to roll back in the database |
| The new code fails health checks, or an operations-centre page errors | §4 (code rollback). The migrations may stay |
| A V2 table must be removed (owner decision) | §4, then §5 |

## 4. Code rollback (previous release)

### 4.1 Redeploy the previous release

Use the current production release procedure with the previously deployed commit (`PREV`, recorded
at the start of the window) as the target: check out `PREV`, `npm ci`, `npm run build`, restart,
then the health and build-identity checks that procedure requires. Migrations 111/112 can stay in
place: `PREV` never reads or writes the three tables, and the tables hold no row that `PREV` needs.

### 4.2 Expected preflight finding with the migrations left in place

With 111/112 applied and `PREV` checked out, a migration-parity comparison reports
`unknown-applied-migration` for both files (`tools/db/migration-safety.ts:165-169`), which the
preflight grades `FAIL` outside inspection mode (`tools/dev/preflight-core.ts:202-205`). Decide in
advance which applies: record it as the expected exception for this rollback, or run §5 so the
ledger and the checkout agree again. Do not edit the ledger by hand for any other reason.

### 4.3 What the previous release brings back

`PREV` restores the legacy admin surfaces that V2 retired (CSV upload, submission review and
promotion, the email-intake route, the Squiggle/Kali refresh, the AFL Tables settle trigger;
`docs/v2/legacy-disposition.md` L1-L3, L5, L6). The email-intake timer stays disabled unless the
owner decides otherwise: `sudo systemctl enable --now afldb-email-intake.timer` re-enables it.
Messages that reached the V2 route while it answered 410 were filed to the poller's Errors folder
and kept (`tools/email_intake/fetch_and_stage.py:606-607`, `:742-744`); they are not re-processed
automatically.

### 4.4 Verification gate R4

`PREV`'s health and build-identity checks pass; `systemctl is-enabled afldb-email-intake.timer`
prints what the owner decided; the AFL Tables and AFL API timers are in the state they had before
the window (V2 never changes them; ISSUE-316 owns them).

## 5. Database reversal of migrations 111 and 112 (data-loss step)

**Consequence, stated plainly: this DISCARDS every curated-award proposal and decision and every
published derivation record (Coleman), including their audit history.** Approved curated winners
are NOT removed: they are ordinary `award_winners` rows with their own `data_overrides` and
`data_edits` audit rows (migration 111 ROLLBACK block, lines 101-104), but the link from each
winner back to its proposal, evidence and decision chain is lost once the ledger is dropped.
`award_winners` is untouched by dropping `derived_award_results` (migration 112, lines 93-94).

Run only after §4 (the previous code is live), only with the owner's approval, as the production
owner role, from a shell whose DSN comes from the operator's environment file:

```sql
-- 1. Export first (psql client-side \copy writes on the operator's machine/host).
\copy (SELECT * FROM award_proposals ORDER BY id) TO 'v2-award_proposals-<STAMP>.csv' WITH (FORMAT csv, HEADER)
\copy (SELECT * FROM award_proposal_decisions ORDER BY id) TO 'v2-award_proposal_decisions-<STAMP>.csv' WITH (FORMAT csv, HEADER)
\copy (SELECT * FROM derived_award_results ORDER BY id) TO 'v2-derived_award_results-<STAMP>.csv' WITH (FORMAT csv, HEADER)

-- 2. Reverse, in one transaction, in the order the ROLLBACK blocks state.
BEGIN;
DROP TABLE IF EXISTS derived_award_results;      -- 112 ROLLBACK block, line 86
DROP TABLE IF EXISTS award_proposal_decisions;   -- 111 ROLLBACK block, line 95
DROP TABLE IF EXISTS award_proposals;            -- 111 ROLLBACK block, line 96
-- 3. Remove the two ledger rows so the runner and the preflight agree with the PREV checkout.
--    (Stage 6 addition, plan section 7 R-043: the migrations' own ROLLBACK comments do not
--    mention the ledger; without this step a later V2 deploy would skip 111/112 as "applied"
--    while their tables are gone.)
DELETE FROM afldb_meta.schema_migrations
 WHERE name IN ('111_curated_award_proposals.sql', '112_derived_award_results.sql');
COMMIT;
```

Then re-run the PREVIOUS release's `tools/maintenance/privileges.sql` (its revoke loop removes
nothing that still exists; the dropped tables took their grants with them). The repository-side
edits the ROLLBACK blocks list (privileges blocks, the `tests/integration/privileges.test.ts` NOT IN
list, `tools/db/promotion-inventory.ts`, the two pins in `tests/db-promotion-check.test.ts`, the list
in `tests/reference-data.test.ts`) are already absent from `PREV`; they matter only for a branch
that keeps V2 code but drops the tables, which this runbook does not support.

Verification gate R5 (read-only):

```sql
SELECT to_regclass('public.award_proposals') AS p,
       to_regclass('public.award_proposal_decisions') AS d,
       to_regclass('public.derived_award_results') AS r;           -- all three NULL
SELECT count(*) FROM afldb_meta.schema_migrations
 WHERE name IN ('111_curated_award_proposals.sql', '112_derived_award_results.sql');  -- 0
```

and the historical manifest of production taken after the reversal compares
`sealed-scope-identical` with the §2 manifest (`npx tsx tools/v2/historical-manifest.ts compare`):
the reversal touched no historical table.

## 6. Full restore (last resort, outside V2's design)

V2 rewrites no existing data, so a full restore should never be needed for a V2 rollback. If an
unrelated failure in the window demands one, follow `docs/production-promotion.md` and
`docs/backup-restore.md` §6 with the §2 dump; note that a restore discards every write made after
the dump (including any AFL API or AFL Tables settle that ran), and that `privileges.sql` must be
re-run after any restore.

## 7. Rehearsal status

Every step of §2, §4 and §5 is a step of `docs/v2/shadow-rehearsal.md` on an isolated copy. None
has been run. The rollback is therefore **untested**, and the production go/no-go treats
"rollback untested" as a no-go condition until the rehearsal records it (`docs/v2/go-no-go.md`).
