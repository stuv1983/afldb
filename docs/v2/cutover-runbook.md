# AFLDB V2 — production cutover runbook and migration plan

Status: written in Stage 6 (Launch E, 2026-10-19). **NOT EXECUTED, and NOT EXECUTABLE while the
production verdict in `docs/v2/go-no-go.md` is NO-GO** (it is NO-GO today). No step has been run
against production, DEV, `afldb_test` or any host. This document is not an approval: each step
names the approval it needs, and none of those approvals exists.

Companion documents: `docs/v2/rollback-runbook.md` (backup and rollback),
`docs/v2/shadow-rehearsal.md` (the isolated rehearsal every step below must pass first),
`docs/v2/go-no-go.md` (verdicts and the approvals list), `docs/v2/risk-register.md`.

## 1. Two separate tracks: the V2 release and the AFL API cutover

1. **The V2 release** (this runbook): migrations 111 and 112, their grants, and the V2 code (the
   operations centre, the retired legacy admin surfaces, the seal checks, curated awards, the
   Coleman publisher), plus disabling the email-intake timer in the same window
   (`docs/v2/legacy-disposition.md` L3, V2-GAP-013).
2. **The AFL API cutover** (`issues/open/AFLDB-ISSUE-316.md` §7, steps C0-C9): retiring AFL Tables
   network acquisition and turning on the AFL API pipeline for 2027. It is governed entirely by
   ISSUE-316's own owner decisions. **V2 does not execute, grant, satisfy or shorten any of them.**
   In particular:
   - the AFL Tables nightly settle (`deploy/afldb-settle-afltables.timer`, L4, V2-GAP-011) keeps
     running until the ISSUE-316 sequence retires it: **D-316-1** (C2) writes the AFL Tables switch
     `retired` in the 2026 rollover and optionally disables the timer; the timer must be disabled
     by **C5** at the latest, which needs **D-316-4** (the cutover go) and a recorded C4b PASS;
   - **D-316-2** (C3) installs the four AFL API units on PROD as inert units (nothing started, no
     timer enabled); it is also a separate owner approval and is not part of the V2 release;
   - **D-316-13** (C4b, the production D1 rehearsal) must not be granted or used before C4 is
     deployed (ISSUE-316 §7 C4b, §8);
   - AFL API pre-match fixtures stay unsupported until AFLDB-ISSUE-229 B2 (V2-GAP-008).

   Correction (plan §7 R-042): earlier V2 documents said the AFL Tables runtime stays "until
   D-316-2". In ISSUE-316, D-316-2 is the inert AFL API unit installation (C3); the AFL Tables
   retirement is D-316-1 (C2) and the timer is disabled at C5 (D-316-4). The gap itself
   (V2-GAP-011) is unchanged: it closes only through the ISSUE-316 sequence.

The V2 release can precede the AFL API cutover: nothing in it enables, disables or depends on an
AFL API or AFL Tables unit. It must not be combined with any ISSUE-316 step in one window.

## 2. Migration plan

| Order | What | Why this order |
|---|---|---|
| 1 | `src/db/migrations/111_curated_award_proposals.sql` | creates `award_proposals` and the append-only `award_proposal_decisions`; their only FKs are to `auth_users` and to `award_proposals` itself (no FK into football tables) |
| 2 | `src/db/migrations/112_derived_award_results.sql` | creates the append-only `derived_award_results` ledger; FKs only to `auth_users` and to itself (the supersession chain); none into football tables |
| 3 | `tools/maintenance/privileges.sql` (owner role) | grants `afldb_import` SELECT/INSERT (+ the column-scoped UPDATE on `award_proposals`, sequence USAGE) and `afldb_auth` SELECT; no `afldb_app` grant (not app-readable). Before the code, because code that reaches a table before its grant fails closed with "permission denied" (AFLDB-ISSUE-027) |
| 4 | the V2 application build and restart | the operations centre reads and writes the new tables through `afldb_import` (plan §7 R-037) |

Properties: additive only (plan D4, ADR 0004); no existing table, column, row, id, FK or grant is
altered; no data migration or backfill; stable identifiers untouched; each migration runs in its
own transaction and is recorded in `afldb_meta.schema_migrations` only on success
(`tools/db/migrate.ts:287-296`); reversal is `docs/v2/rollback-runbook.md` §5 (drops the three
tables after exporting them: data loss of the V2 ledgers only). **Executed only on in-memory PGlite
over stub prerequisites; never on PostgreSQL** (V2-GAP-017).

## 3. Preconditions (every one must hold; otherwise stop)

| Gate | Condition | Evidence |
|---|---|---|
| P1 | `docs/v2/go-no-go.md` production verdict is GO, signed by the owner | the go-no-go record |
| P2 | a shadow rehearsal PASS is recorded: parity verdict PASS, migration + privileges + build + integration suites + rollback rehearsed, the admin pages eyeballed (V2-GAP-022) | `docs/v2/shadow-rehearsal.md` §10 record |
| P3 | the owner has reviewed and merged the V2 branch into the mainline (V2 has no remote) and the release commit is the reviewed merge; the 19 ISSUE-316 follow-up-8 files that V2 carries (imported by commit `c9cca86d`) have been reconciled with the source worktree's own state | the merge commit |
| P4 | backup gate B of `docs/v2/rollback-runbook.md` §2 passed, and the before-manifest exists | sha256 values, manifest path |
| P5 | the owner approved this window (approval A-REL in `docs/v2/go-no-go.md` §4); writers are paused per the current production release procedure | the approval |

## 4. Steps

Every command runs on the production host from the release checkout, with DSNs supplied by the
operator's environment file (never typed on a command line). "Gate" lines are the acceptance check
before the next step. A failed gate goes to `docs/v2/rollback-runbook.md` §3.

### Step 1 — read-only preflight and identity

```bash
git rev-parse HEAD                    # = the reviewed release commit
npm run preflight -- --mode deploy --environment <prod environment name used by the release procedure> \
    --dsn-env <prod owner DSN variable> --expect-database afldb_prod
```

Record `PREV` (the commit currently serving). Gate 1: the preflight's only migration findings are
`pending-migration` for exactly 111 and 112.

### Step 2 — record the scheduler state (read-only)

```bash
systemctl list-timers --all 'afldb-*' --no-pager
for u in afldb-email-intake.timer afldb-settle-afltables.timer \
         afldb-settle-afl-api.timer afldb-settle-afl-api-brownlow.timer; do
  printf '%s enabled=%s active=%s\n' "$u" "$(systemctl is-enabled "$u" 2>&1)" "$(systemctl is-active "$u" 2>&1)"
done
```

Gate 2: no settle service is running (`systemctl is-active` of each `afldb-settle-*.service` is
`inactive`). Keep this output: step 8 requires the AFL Tables and AFL API rows to be unchanged.

### Step 3 — backup

`docs/v2/rollback-runbook.md` §2, gate B.

### Step 4 — disable the email-intake timer (same window as the code deploy; V2-GAP-013)

Only if the unit is installed on this host (step 2 lists it):

```bash
sudo systemctl disable --now afldb-email-intake.timer
systemctl is-enabled afldb-email-intake.timer    # disabled
systemctl is-active afldb-email-intake.timer     # inactive
```

Why before the code: once the V2 code is live, the email-intake route answers 410 to every call
(plan §7 R-031) and the poller files each message to its Errors folder, kept
(`tools/email_intake/fetch_and_stage.py:606-607`, `:742-744`). Disabling the timer first means no
message is consumed by a refusing route. Approval: part of A-REL. Gate 4: both checks as shown.

### Step 5 — migrations 111 and 112

```bash
AFLDB_MIGRATE_TARGET=prod npm run db:status      # 111 and 112 PENDING, nothing else pending
AFLDB_MIGRATE_TARGET=prod npm run db:migrate     # applies 111 then 112
AFLDB_MIGRATE_TARGET=prod npm run db:status      # 0 pending
```

(`tools/db/migrate.ts` resolves `prod` through `AFLDB_PROD_DATABASE_URL`, `:79-84`, and refuses an
unknown target.) Gate 5 (read-only SQL as the owner role):

```sql
SELECT to_regclass('public.award_proposals'), to_regclass('public.award_proposal_decisions'),
       to_regclass('public.derived_award_results');                -- three non-NULL values
SELECT name FROM afldb_meta.schema_migrations
 WHERE name IN ('111_curated_award_proposals.sql', '112_derived_award_results.sql') ORDER BY name;  -- 2 rows
```

### Step 6 — privileges

Apply `tools/maintenance/privileges.sql` to `afldb_prod` as the owner role, exactly as the current
production release procedure does (password never in argv, AFLDB-ISSUE-313). `tools/db/privileges.ts`
has no `prod` target (`:42-46`), so this runbook does not invent one. Gate 6 (read-only SQL):

```sql
SELECT r.role, t.tbl, p.priv, has_table_privilege(r.role, t.tbl, p.priv) AS granted
  FROM (VALUES ('afldb_import'), ('afldb_auth'), ('afldb_app')) r(role)
 CROSS JOIN (VALUES ('public.award_proposals'), ('public.award_proposal_decisions'),
                    ('public.derived_award_results')) t(tbl)
 CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(priv)
 ORDER BY 1, 2, 3;
SELECT has_column_privilege('afldb_import', 'public.award_proposals', 'status', 'UPDATE'),     -- true
       has_column_privilege('afldb_import', 'public.award_proposals', 'player_name_raw', 'UPDATE'); -- false
```

Expected from `tools/maintenance/privileges.sql:394-418` and `:554-559`: `afldb_import` SELECT and
INSERT true on all three and nothing else at table level; `afldb_auth` SELECT true on all three and
nothing else; `afldb_app` nothing. `player_name_raw` (migration 111, line 120) is a proposed value,
outside the granted UPDATE column list (`privileges.sql:396-398`). These expectations are derived
from the file, never observed.

### Step 7 — code

`npm ci`, `npm run build`, then the restart and readiness checks of the current production release
procedure (`docs/deployment.md` §3; health must be HTTP 200 with `database: "ok"`, and the build
identity must match). The build runs before the restart, so a failed build leaves the previous
build serving. **`npm run build` has never been run for V2** (V2-GAP-002): the rehearsal build in
`docs/v2/shadow-rehearsal.md` is the first.

Gate 7: health and build identity pass; signed in as Admin, `/admin/operations` renders (owner
eyeball; `docs/v2/admin-operations.md` §6); a POST to `/api/admin/email-intake` answers 410
(`curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<production host>/api/admin/email-intake`;
the route reads no body and no secret, plan §7 R-031).

### Step 8 — after-checks

```bash
# sealed history unchanged by the release (read-only; owner authority for a non-test read)
npx tsx tools/v2/historical-manifest.ts produce --dsn-env AFLDB_PROD_READONLY_DATABASE_URL \
    --out ~/backups/afldb/v2-manifest-after-<STAMP>.json \
    --read-only-source --i-understand-this-reads-a-non-test-database
npx tsx tools/v2/historical-manifest.ts compare ~/backups/afldb/v2-manifest-before-<STAMP>.json \
    ~/backups/afldb/v2-manifest-after-<STAMP>.json --out ~/backups/afldb/v2-manifest-compare-<STAMP>.json
```

Gate 8: the comparison is `sealed-scope-identical` (exit 0); the step 2 loop prints the same
`enabled`/`active` values for the AFL Tables and both AFL API timers as before the window, and
`disabled`/`inactive` for the email-intake timer.

### Step 9 — cache and ISR

V2 changes no public page's data path: the public import closure reaches no legacy module (guard d,
`docs/v2/legacy-disposition.md` §2) and no public page reads the three new tables (they are not
app-readable). Public ISR pages therefore stay valid across the release; the restart behaves as in
every routine deploy (`docs/deployment.md` §3). One known lag remains: approving a curated award
writes `award_winners` but does not revalidate the public award pages, which use
`revalidate = 86400` per worker (V2-GAP-024). Until that gap is closed, either do not approve curated
awards in production, or accept up to a day of staleness per worker for the affected award pages.

### Step 10 — what this window does NOT do

No AFL Tables timer change; no AFL API unit install, start or enable; no change to
`acquisition.afl_api_current_season_enabled`; no settle, acquire, rollover, C4b or Brownlow window;
no Coleman publication (and no projection into `award_winners`, V2-GAP-021); no curated approval;
no historical correction. Each of those has its own approval (ISSUE-316 §8, `docs/v2/go-no-go.md` §4).

### Step 11 — record

Write the window's record (commit, `PREV`, dump sha256 values, every gate's output, the manifest
comparison) where the owner keeps production release evidence, then update `docs/v2/known-gaps.md`
(V2-GAP-013: timer disabled; V2-GAP-002/017: executed on PROD) in a reviewed commit.

## 5. Rollback

`docs/v2/rollback-runbook.md`: code rollback to `PREV` (§4) with the migrations left in place, and,
only with the owner's approval, the data-losing reversal of 111/112 (§5).
