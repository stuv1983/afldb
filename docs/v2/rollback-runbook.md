# AFLDB V2 — backup and rollback runbook

Status (2026-10-31): **rehearsed, not exercised on production** (V2-GAP-026 closed on that basis; §7). Production has
only moved forward, so no production rollback has run. Its available targets are the retained releases that
`node deploy/release.mjs status` lists and the verified frozen and post-schema dumps; an available target is not an
exercised rollback. The backup of §2 was executed for the 2026-10-31 window. Every production step needs
the owner's explicit approval for that window (`docs/v2/go-no-go.md` §4), and the ISSUE-316 gates
(`issues/open/AFLDB-ISSUE-316.md` §7-§8) are separate owner decisions that this rebuild neither
grants nor satisfies.

This runbook pairs with `docs/v2/cutover-runbook.md` (the forward path) and
`docs/v2/shadow-rehearsal.md` (where every step below is rehearsed first, on a restored copy).
It covers only what V2 adds. The AFL Tables retirement and the AFL API unit installation have
their own rollback and roll-forward rules in ISSUE-316 §7 ("Roll-forward point").

## 1. What V2 changes in a production deployment

**Current additive stream: 111–115.** In addition to the historical table summary below,
113 adds the Brownlow eligibility ledger, 114 the canonical award projection ledger, and 115
an index on existing adjudication supersession references. Application rollback keeps all of
them and every publication/decision/audit row. The prior 111–114 reversal evidence is not a
115 destructive-reversal rehearsal. No schema reversal is needed to run the previous app;
the index can safely remain. Never treat the historical drop procedure as a generic undo
of authorised publication data. Host execution/backup approval is still required.

| Layer | Change | Reversible by |
|---|---|---|
| Schema | migration `111_curated_award_proposals.sql` (tables `award_proposals`, `award_proposal_decisions`) and `112_derived_award_results.sql` (table `derived_award_results`). Additive: no existing table, column, row, id or FK is altered | §5 (drop the three tables, after exporting them) |
| Grants | `tools/maintenance/privileges.sql:382-418` (afldb_import SELECT/INSERT, a column-scoped UPDATE on `award_proposals`, sequence USAGE) and `:550-559` (afldb_auth SELECT). No `afldb_app` grant: the tables are not app-readable | re-running the PREVIOUS release's `privileges.sql` after §5 (its revoke loop strips grants it does not name) |
| Code | the V2 application (operations centre, retired legacy admin surfaces, seal checks, Coleman publisher, curated awards) | §4 (redeploy the previous release) |
| Host | the email-intake timer disabled in the deploy window (`docs/v2/cutover-runbook.md` step 4) | §4.3 (re-enable it only if the previous release is restored and the owner wants CSV intake back) |

V2's migrations are additive; authorised publications can update existing award metadata.
Application rollback retains that data and all audit ledgers. It is NOT a database restore or
destructive migration reversal. The backup in §2 remains necessary for unexpected outcomes.

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
| Build fails | Through the release route (`deploy/release.mjs build`, ISSUE-329) nothing is published and the serving release is untouched; stop. An in-place `npm run build` in the serving checkout is **not** safe: it clears `.next` first, and on 2026-10-31 it destroyed the serving assets. Nothing to roll back in the database |
| The new code fails health checks, or an operations-centre page errors | §4 (code rollback). The migrations may stay |
| A V2 table must be removed (owner decision) | §4, then §5 |

## 4. Code rollback (previous release)

### 4.1 Redeploy the previous release

Production uses the release route (`docs/deployment.md` §3a, §11; AFLDB-ISSUE-329, installed
2026-10-31). `PREV` is the retained release that `previous` names, recorded at the start of the
window as its release id `<rev12>-<BUILD_ID>`. Switch back to it without rebuilding, as arm from the
serving checkout with the unit's pinned Node:

```bash
node deploy/release.mjs rollback                # or: rollback --to <PREV release id>
sudo systemctl restart afldb                     # owner
node deploy/release.mjs status --expect <PREV release id>
bash deploy/post-install-check.sh <PREV release id>
```

Never check out, `npm ci` or `npm run build` in the serving checkout to roll back: that deletes the
live bundle first (AFLDB-ISSUE-329). The frozen 2026-10-30 execution package keeps its in-place text
as the record of what was approved then. Migrations 111-117 can stay in
place: `PREV` never reads or writes the six new tables, and the tables hold no row that `PREV` needs
(validated for 111-117 with the previous code `ff100dc2` on a production-derived clone on 2026-10-30; §7, controls
RB1-RB7).

The retained `previous` release is a V2 build, so rolling back to it crosses no schema boundary. A pre-V2 release
(`ff100dc2`) is **not retained** on the host (its bundle was destroyed in the 2026-10-31 incident); returning to it
would need a fresh route build of that revision, which no record shows, and the RB controls prove only that its
code runs on the 117 schema.

### 4.2 Expected preflight finding with the migrations left in place

With 111-117 applied and `PREV` checked out, a migration-parity comparison reports
`unknown-applied-migration` for each of the seven files (`tools/db/migration-safety.ts:165-169`), which the
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

`node deploy/release.mjs status --expect <PREV release id>` prints `STATUS PASS` and appends
`status-pass` to `events.log`: the service process runs in `PREV`'s release directory, `PREV`'s
`_buildManifest.js` answers 200, the release rolled back from answers 404, and `/api/health` is
`ok`/`ok`. This replaces the earlier `x-afldb-build` header gate, which production does not emit
(`AFLDB_TRACE_REQUESTS` is off). `deploy/post-install-check.sh` then passes; a public `CACHE` line
for the release rolled back from is an old Cloudflare cache HIT and is not a failure, because the
same script proves that build absent at the origin. `systemctl is-enabled afldb-email-intake.timer`
prints what the owner decided; the AFL Tables and AFL API timers are in the state they had before
the window (V2 never changes them; ISSUE-316 owns them).

## 5. Database reversal of migrations 111-115 (data-loss step)

**Consequence, stated plainly: this DISCARDS every curated-award proposal and decision and every
published derivation record (Coleman), including their audit history.** Approved curated winners
are NOT removed: they are ordinary `award_winners` rows with their own `data_overrides` and
`data_edits` audit rows (migration 111 ROLLBACK block, lines 101-104), but the link from each
winner back to its proposal, evidence and decision chain is lost once the ledger is dropped.
`award_winners` is untouched by dropping `derived_award_results` (migration 112, lines 93-94).

**Limit at ledger 116 and 117.** This reversal was rehearsed through 115 only (Launch F and the populated rehearsal,
both before 116 and 117 existed). It has not been rehearsed with 116 and 117 applied, and 116 (append-only
receipts) is never reversed. Do not run it on production at ledger 117 without a fresh rehearsal on a clone of the
production-derived state. The supported recovery from data loss is §6, restoration from the verified frozen dump.

Run only after §4 (the previous code is live, so nothing can write the V2 ledgers between export
and drop), only with the owner's approval, as the production owner role, from a shell whose DSN
comes from the operator's environment file. **Do not run step 2 until step 1 has produced a
non-empty archive whose table-of-contents lists all five `TABLE DATA` entries and five
`SEQUENCE SET` entries** (`pg_restore --list`); keep the archive and its `sha256sum` in restricted
storage, never in Git.

```sh
# 1. Export first. One snapshot, data only, carries each identity sequence's state.
pg_dump --data-only --format=custom --no-owner --no-privileges \
  --table=public.award_proposals --table=public.award_proposal_decisions \
  --table=public.derived_award_results --table=public.brownlow_eligibility_decisions \
  --table=public.derived_award_projections --file=v2-ledgers-<STAMP>.dump
pg_restore --list v2-ledgers-<STAMP>.dump | grep -c 'TABLE DATA'    # 5
pg_restore --list v2-ledgers-<STAMP>.dump | grep -c 'SEQUENCE SET'  # 5
sha256sum v2-ledgers-<STAMP>.dump

# 2. Reverse 115, then 111-114 with their four ledger rows, each in one transaction (both idempotent):
psql -v ON_ERROR_STOP=1 -f docs/v2/rollback-115.sql
psql -v ON_ERROR_STOP=1 -f docs/v2/rollback-111-114.sql
```

`pg_dump` warns about circular foreign keys (self-references); the restore below succeeds
regardless because it is one transaction loading each table in id order. Optionally keep a CSV
copy for human inspection (`\copy (SELECT * FROM award_proposals ORDER BY id) TO '…' WITH
(FORMAT csv, HEADER)`), but **a CSV export is not a recovery procedure by itself**: `\copy` back
restores rows but leaves every `GENERATED ALWAYS` identity sequence at its start, so the next
audited write fails with a duplicate primary key until each sequence is set with
`SELECT setval('<seq>', <last_value>, <is_called>)` from a recorded value.

**Consequence of the reversal that no export avoids:** while the tables are absent, the links from
`data_edits` (`curated_proposal_id`), `data_overrides` (`approved_entity_key`) and the Coleman
projection actions to the dropped ledgers cannot be resolved. They resolve again after recovery.

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
       to_regclass('public.derived_award_results') AS r,
       to_regclass('public.brownlow_eligibility_decisions') AS b,
       to_regclass('public.derived_award_projections') AS j;       -- all five NULL
SELECT count(*) FROM afldb_meta.schema_migrations WHERE name ~ '^11[1-5]_';  -- 0
```

and the historical manifest of production taken after the reversal compares
`sealed-scope-identical` with the §2 manifest (`npx tsx tools/v2/historical-manifest.ts compare`):
the reversal touched no historical table.

### 5.1 Recovery after a reversal (reapply, then restore)

Only when V2 is to be redeployed with its recorded history. Run the CURRENT release's tools with the same `<target>` and guards the forward migration used
(`docs/production-promotion.md`; the rehearsal used `--target test` on a disposable database):

```sh
npx tsx tools/db/migrate.ts --target <target>      # 111-115 re-applied from the ledger
npx tsx tools/db/privileges.ts --target <target>   # grants
pg_restore --data-only --single-transaction --exit-on-error --no-owner --no-privileges \
  v2-ledgers-<STAMP>.dump                          # rows, ids and sequence state, fail-closed
```

Run once. A second run fails on the first duplicate key and changes nothing (verified). Then compare
row counts and the largest id per table with the export and run one rolled-back insert to confirm
the next id is `max(id)+1`.

## 6. Full restore (last resort, outside V2's design)

V2 rewrites no existing data, so a full restore should never be needed for a V2 rollback. If an
unrelated failure in the window demands one, follow `docs/production-promotion.md` and
`docs/backup-restore.md` §6 with the §2 dump; note that a restore discards every write made after
the dump (including any AFL API or AFL Tables settle that ran), and that `privileges.sql` must be
re-run after any restore.

## 7. Rehearsal status

Every step of §2, §4 and §5 is a step of `docs/v2/shadow-rehearsal.md` on an isolated copy.

**Launch F (2026-10-19), isolated PostgreSQL 16 only. These are rehearsal mechanics, not
production.** §5 was rehearsed with `docs/v2/evidence/launchF/rollback-rehearsal.sh` on two empty
`afldb_v2_*_test` databases:
- the runner applied 001-114 and privileges;
- the five exports and `docs/v2/rollback-111-114.sql` ran (gate R5: all five tables NULL, 0 ledger
  rows);
- `pg_dump -s --no-privileges` of the reversed schema is **identical** to 001-110 applied alone;
- the runner then reported 111-114 pending and re-applied them, and the schema-and-grants dump is
  **identical** to the first forward (hashes in `docs/v2/evidence/launchF/rollback-dumps.sha256`).

The V2 ledgers were empty when reversed, so data-loss exports were exercised only as commands.
§2 (the production backup), §4 (redeploying `PREV`) and §6 were **not** rehearsed: §4 needs a
second checkout and a host, and §2 needs production. The production go/no-go therefore still
treats the application rollback as untested (`docs/v2/go-no-go.md`).

**Populated-ledger rehearsal (2026-10-20), isolated PostgreSQL 16, synthetic identities on an
archive-derived copy.** `docs/v2/rollback-populated-rehearsal-2026-10-20.md` records it. With
8 proposals, 21 decisions, 2 results, 4 eligibility decisions and 2 projections:
- the application rollback (previous, V2, previous, V2 on the additive schema) passed 18/24/18/24
  checks with ledgers, public pages, permissions and audit unchanged;
- the §5 reversal and §5.1 recovery with the archive restored every row, id, reference, sequence
  and public result exactly, the reapplied schema and grants were identical to the first forward
  state, and a restore rerun failed closed;
- the CSV-only recovery that this runbook previously described restored the rows but **not** the
  sequences, so the next audited write failed; `setval` repaired it.

This is a rehearsal on a synthetic populated copy, not on a production dump. §2 (the production
backup), §4 on a host and §6 remain unrehearsed, and any V2 write between export and drop is lost.
**The demonstrated rollback route remains the application rollback with the additive schema
retained**; the database reversal is a last resort needing the owner's approval.

**Update, 2026-10-31 (V2-GAP-026 closed on rehearsal evidence; full record `shadow-rehearsal.md` §10).** Where the
paragraphs above call a step unrehearsed, this supersedes them as follows.

| Step | State | Evidence |
|---|---|---|
| §2 backup | **Executed for real** in the 2026-10-31 window: frozen dump `599e32a1…`, restore proven 9/9 on the host, off-host copies verified on the workstation and streamanator, re-verified at Stage 14 | `production-execution-record-2026-10-31.md` §2, §5 |
| §4 code rollback, previous code on the 117 schema | **Rehearsed** on streamanator against a clone of the production-derived after-state: ledger accepted, exactly 111-117 unknown-applied, health 200, 18 route and permission checks, Brownlow writer suite, `privileges.sql` completes (RB1-RB7, controls 112/112, 2026-10-30). The build there ran in a private worktree, so it could not show the in-place flaw above | `evidence/production-execution-20261030/run-20261030T020000Z/controls-run3-final/` |
| §4.1 release-route rollback | **Rehearsed** on a stand-in systemd 255 unit and in the package dress rehearsal (F6, R8), and in the 25/25 route suite (L8): no build, `npm` or Git; `status --expect` PASS. Not run on the production unit, not through Caddy or TLS (the dress rehearsal used a loopback `PUBLIC`) | `issues/closed/AFLDB-ISSUE-329.md` §8-§8a; `issues/closed/AFLDB-ISSUE-329-installation-20261031/INSTALLATION.md` §2 |
| §5 reversal | Rehearsed through 115 only; see the limit at ledger 116 and 117 in §5 | above |
| §6 full restore | The restore procedure is proven into a scratch database (host and isolated); a restore over production has not been run and should not be | Stage 5, Stage 7 |

**Exercised versus available.** No production rollback has run. Production has moved forward only (V2 adoption,
ISSUE-329 first route build, ISSUE-330), and ISSUE-330's rollback branch D5 was "not used". Current targets:
`61a95f7397da-JYIBkYn8ynPgYMn1e5nK-` (the `previous` release, one recorded `status-pass`) and
`9ed9c9dd3e84-QNEHXAtU53TzUjj0Mb7mv`. An optional drill, with the owner's approval for a window, is
`node deploy/release.mjs rollback`, an owner restart, `status --expect <PREV id>`, `bash deploy/post-install-check.sh <PREV id>`,
then return with `node deploy/release.mjs rollback --to <current id>` (a mistaken rollback is reversed the same way, INSTALLATION.md) and run the same checks again. Pace the two restarts 30 s apart
(ISSUE-329 O2). It is not a close condition for V2-GAP-026.

The AFL API writer activation (ISSUE-316) has its own rollback and roll-forward rules and is not covered here.
