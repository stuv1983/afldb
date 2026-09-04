# AFLDB-ISSUE-125 — Production promotion procedure that preserves production-only state

- **Status:** Resolved 2026-09-04 (repository procedure + read-only tooling; no production
  mutation performed or required for acceptance)
- **Severity:** Medium
- **Area:** Operations / Deployment / Database / Data integrity
- **Branch:** `claude/issue-125` (worktree `D:\dev\afldb-issue-125`)
- **Session:** Fable 5.1 / High, 2026-09-04
- **Deliverables:** `docs/production-promotion.md` (the procedure),
  `tools/db/promotion-inventory.ts` (the table contract), `tools/db/promotion-check.ts`
  (read-only checker, `npm run db:promotion:check`), `tests/db-promotion-check.test.ts`
  (37 DB-free tests), pointers in `docs/deployment.md` §6b and `docs/backup-restore.md` §5a
- **Related:** `AFLDB-ISSUE-122` §S8 (the cutover that exposed the gap),
  `AFLDB-ISSUE-126` (rows still held only in `afldb_prod_auth_recovery` — untouched here),
  `AFLDB-ISSUE-137` (the production identity split; its path (a) is this procedure),
  `AFLDB-ISSUE-027` (migration-before-code order), `AFLDB-ISSUE-136` (why player ids can
  change across a rebuild)

---

## 1. Problem

On 2026-09-02 the rebuilt `afldb_test` dump was restored over `afldb_prod`. The football
data was replaced correctly; so was every application-, auth- and operations-owned table,
and production came up with a **test fixture super admin** (`email-intake-test-fixture@afldb.test`,
`auth_users` id 12) and zero rows of production auth history, settings and beta state.
Recovery depended on a pre-cutover dump that was operator discipline, not a documented step.
Nothing in the repository enumerated production-only tables, and nothing refused a test
identity at the authentication boundary.

## 2. Stage 1 — inventory, built from the schema

Method: every `CREATE TABLE` / `RENAME TO` across `src/db/migrations/001–085`, the two
registries migrations 039/045 seed and later migrations extend
(`afldb_meta.app_readable_tables`, `afldb_meta.import_writable_tables`), the FK edges into
`auth_users` and into football tables, `tools/maintenance/privileges.sql`'s `afldb_auth`
spec/`written` arrays, and `tools/db/rebuild-test.ts`'s stage list (which does **not** load
AFLW). 64 public tables, 8 `staging` tables, 8 `staging_aflw` tables, 3 `afldb_meta` tables.

**The structural finding that drives the design:** since migration 045 the database itself
carries the split. Every `public` table in `import_writable_tables` is canonical or derived
football data that the rebuild produces (41 tables, including `data_issues`, `import_batches`,
`derived_rebuilds`, `promotion_candidates`, `player_achievements`). Every `public` table
outside it (23 tables) is application, auth, operations or ledger state. The contract in
`tools/db/promotion-inventory.ts` lists exactly those 23 plus the two acquisition schemas,
and the checker refuses a database with any public table in neither set or in both.

| Table | Owning subsystem | Prod-only | Rebuild replaces? | Reinstated? | Reset? | Ordering / FKs |
|---|---|---|---|---|---|---|
| `auth_users` | auth (023/029/033/040) | yes | must not | **yes, first** | no | root of every auth FK |
| `admin_invites` | auth (030) | yes | must not | yes | no | → auth_users |
| `auth_sessions` | auth (023/028) | yes | must not | **no** | **yes** | → auth_users CASCADE |
| `auth_audit_log` | auth (023/082) | yes | must not | yes **+ marker row** | no | → auth_users |
| `beta_access_codes` | beta (023/036) | yes | must not | yes (explicit) | no | → auth_users |
| `beta_allowed_emails` | beta (023) | yes | must not | yes | no | → auth_users |
| `beta_join_requests` | beta (024/035) | yes | must not | yes | no | → auth_users |
| `beta_login_tokens` | beta (023) | yes | must not | no | **yes** | none |
| `site_settings` | admin (034) | yes | must not | yes | no | → auth_users |
| `site_media` | admin (037/038) | yes | must not | yes | no | → auth_users |
| `data_edits` | data editor (057/058/066) | yes | must not | yes | no | → auth_users; entities by key |
| `data_overrides` | data editor (073/075/078) | yes | must not | yes **+ replay** | no | → auth_users |
| `data_submissions` | uploads (023) | yes | must not | yes | no | → auth_users, → import_batches (nullable, probed) |
| `data_submission_rows` | uploads (023) | yes | must not | yes, after parent | no | → data_submissions |
| `player_link_suggestions` | player links (056) | yes | must not | yes | no | → auth_users; target_id not a FK |
| `player_link_resolutions` | player links (056/068) | yes | must not | yes | no | → auth_users, → players (nullable, probed) |
| `player_link_match_candidates` | player links (067) | no | n/a | no | **regenerate** | → players NOT NULL |
| `nl_search_log` | NL telemetry (046–051/055/079/081) | yes | must not | yes | no | self-FK parent_search_id |
| `nl_search_review` | NL telemetry (047) | yes | must not | yes, after log | no | → nl_search_log, → auth_users |
| `nl_search_feedback` | NL telemetry (049/050) | yes | must not | yes, after log | no | → nl_search_log |
| `app_health_events` | health (052) | yes | must not | yes, after log | no | → nl_search_log SET NULL |
| `promotion_decisions` | observation spine (074) | yes | n/a | **no — recorded gap** | **yes** | → promotion_candidates NOT NULL (rebuilt), → auth_users |
| `canonical_applications` | settle ledger (083) | no | **yes** (rebuilt ledger) | no | no | → import_batches, staging spine |
| `staging.*` (8) | import / spine (001/014/074/076/077) | no | yes | no | no | → import_batches |
| `staging_aflw.*` (8) | AFLW (025; `tools/aflw`) | **yes** | no — rebuild leaves it empty | **yes, schema-wide** | no | none into public |
| `afldb_meta.schema_migrations` | migrations | — | yes, parity-gated | no | no | — |
| `afldb_meta.app_readable_tables`, `import_writable_tables` | grants (039/045) | — | yes | no | no | `privileges.sql` reads them |
| 41 tables in `import_writable_tables` | football canonical + derived | no | yes | no | no | derived: `player_clubs`, `player_club_season_stats`, `player_season_stats`, `player_career_stats`, `club_seasons` |

Not in the issue's original list but production-only and now covered: `site_media`,
`beta_join_requests`, `data_submissions`/`_rows`, `player_link_*`, `nl_search_review`,
`nl_search_feedback`, `promotion_decisions`, and the whole `staging_aflw` schema.
`data_issues` (named in the issue) is import-owned since migration 001 and import-writable:
it is the rebuild's, not production's.

## 3. Stage 2 — promotion model

**Chosen: restore the rebuilt dump into a new candidate database, reinstate production-owned
state from the pre-cutover backup, accept, then swap by `ALTER DATABASE … RENAME`.**

**Rejected: football-data-only import into the live `afldb_prod`.** The comparison is
recorded in `docs/production-promotion.md` §11. Deciding factors, in order: (1) production
changes at the first truncate in the in-place model and only at the rename in the candidate
model; (2) FK dependencies — ~60 import-writable tables truncated in place inside constraints
that production-owned tables point into, versus a consistent restore plus a probe of the four
FKs the contract names; (3) migration state — the in-place model leaves the ledger untouched
and a schema difference silent, the candidate model replaces it and gates parity against the
checkout; (4) rollback — restore from backup versus two renames; (5) the candidate model is
the backup/restore machinery `restore-test.sh` already proves, plus a list, a probe and a
rename. Convenience was not a criterion; the in-place model is also more work.

Sequence ownership, grants and ownership: `--no-owner --no-privileges` restore as
`afldb_owner`, then `privileges.sql` rebuilds grants from the registries the dump carries;
identity sequences of the 18 reinstated tables are re-synced by generated SQL because a
data-only per-table restore does not carry `SEQUENCE SET`. Audit continuity: the full
`auth_audit_log` is reinstated and a `database.promoted` marker row (actor NULL, label names
the procedure, detail lists reinstated/reset/regenerated/gap tables and both dump names) is
written before acceptance. Transaction size: per-table `--single-transaction`. Test-state
leakage: every non-rebuilt table is truncated in the candidate before reinstatement, and the
fixture gate refuses leftovers at `candidate` and `production`.

## 4. Production-only state preservation contract (exact)

- `auth_sessions` — reset. Nothing in the architecture wants a session to survive a database
  identity change; the fresh login is the admin-login acceptance gate.
- Auth identities and authorisation (`auth_users`, `admin_invites`) — reinstated from the
  pre-cutover dump only; the candidate's rows (test fixtures) are truncated first; the
  fixture gate refuses any reserved-domain identity in any email-bearing table.
- `site_settings` — reinstated in full (the deliberate operator choices); acceptance
  includes checking `/admin/settings` shows them rather than compiled defaults.
- Audit history — reinstated in full plus the explicit marker; gaps named in the marker.
  Not restoring it is not offered as a default; it would be a deliberate destructive decision
  the operator records in the promotion record.
- Beta access (`beta_access_codes`, `beta_allowed_emails`, `beta_join_requests`) —
  explicitly preserved; `beta_login_tokens` explicitly reset.
- `data_edits` / `data_overrides` — reinstated; overrides are then **replayed** onto the
  promoted canonical rows with the importer's own `replay_admin_overrides` for `players` and
  `matches`, because the rebuild on `afldb_test` never saw them (§8 of the procedure).
- Operational logs (`nl_search_log`, review, feedback, `app_health_events`) — conscious
  retention: reinstated; clearable later through `nl_search_telemetry_clear()`.
- `promotion_decisions` — conscious reset with a recorded gap (its candidates are rebuilt).
- `canonical_applications`, `staging.*` — rebuilt; production's settle history is a recorded
  gap and the current season is re-acquired by the supervised settle.
- `staging_aflw.*` — reinstated schema-wide (the rebuild does not produce it).

## 5. Safety gates (all in the procedure, most enforced by the checker)

Host identity (`hostname` before every destructive command; every block labelled `DEV:` or
`PROD:`); mandatory `backup.sh` with sha256, `pg_restore --list` and `restore-test.sh` proof
plus off-host copy; destination bound by phase (`production`/`pre-cutover` accept only
`afldb_prod`; `restored`/`candidate` accept only `afldb_prod_candidate_<stamp>`; `source`
accepts only `afldb_test`; `--old-database` accepts only `afldb_prod` or
`afldb_prod_pre_rebuild_<stamp>`); source validation (migration parity with the checkout,
optional `--expect-fingerprint` via the existing catalog fingerprint, dump sha256 end to end);
`--snapshot` of production-owned counts; `--compare` at acceptance (equal / zero / at-least
per table); `privileges.sql` on the candidate, checked by `has_table_privilege` probes and the
`nl_search_telemetry_clear()` ACL; health checks; real super-admin login with password + TOTP
(`--expect-super-admin` proves the row is present, enabled, enrolled).

## 6. Test-fixture identity stop condition

Predicate (TypeScript `isTestFixtureEmail` and the SQL `TEST_FIXTURE_EMAIL_SQL`, generated
from the same sets): the address is malformed, or its domain's top-level label is one of
`test`, `example`, `invalid`, `localhost` (RFC 2606/6761), or its apex is `example.com`,
`example.net` or `example.org`. This covers every fixture the repository uses
(`@afldb.test`, `@example.test`, `@example.com`) and any future one on a reserved domain,
without a list of historic addresses. Applied to `auth_users`, `admin_invites`,
`beta_allowed_emails`, `beta_login_tokens`, `beta_join_requests`. Informational in `source`
and `restored` (fixtures are expected there and removed by the truncate), a refusal in
`pre-cutover`, `candidate` (before the swap) and `production` (after it). The unit test holds
the TS predicate and a JS emulation of the SQL regexes to the same 26 examples, including
real-world addresses that merely contain "test".

## 7. Validation evidence (2026-09-04, workstation, DB-free)

| Check | Result |
|---|---|
| `npx vitest run tests/db-promotion-check.test.ts` | **37 passed / 0 failed** |
| `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| `npx eslint tools/db/promotion-inventory.ts tools/db/promotion-check.ts tests/db-promotion-check.test.ts` | exit 0 |
| `tsx tools/db/promotion-check.ts --checklist` | prints the 18-item list, exit 0, no database contact |
| `tsx tools/db/promotion-check.ts --phase production --database afldb_dev` | `REFUSED: Phase 'production' inspects 'afldb_prod' only, not 'afldb_dev'.` exit 1 |
| `tsx tools/db/promotion-check.ts --plan … --plan-dir <scratch>` | four files written (truncate lists the 22 non-rebuilt public tables + `staging_aflw` loop, no cascade; 18 per-table `pg_restore --data-only --single-transaction` lines in FK order + `--schema=staging_aflw`; identity re-sync; `database.promoted` marker), exit 0 |
| `--phase source … --dsn-env AFLDB_NOPE_URL` with the variable unset | `REFUSED: AFLDB_NOPE_URL is not set.` exit 1 |

Pinned by the tests: the contract names only tables the migrations create; the migrations'
public tables minus the contract equal a pinned list of 41 football tables (a new table
breaks the test until it is classified); every FK from a contract table into rebuilt data
is declared; reinstatement order puts `auth_users` first and children after parents; the
checker source contains no `child_process`, `psql`, `runPsql`, `RESET_SQL` or `spawnSync`
path, applies `SET default_transaction_read_only = on` before any query, and prints the DSN
variable name rather than the DSN.

**Not performed:** a live read-only rehearsal against `afldb_test`. The development host
refuses non-interactive SSH from this session (`Permission denied (publickey,password)`), and
this workstation runs no PostgreSQL. The `source` phase is SELECT-only and server-enforced
read-only; the operator can run it as the first step of the next promotion, or now:

```bash
# DEV: streamanator
cd ~/projects/afldb && git pull && npm ci
npm run db:promotion:check -- --phase source --database afldb_test --dsn-env AFLDB_TEST_DATABASE_URL
```

Expected: identity PASS, classification PASS (64 public tables: 41 import-writable, 23 under
the contract), migration parity PASS, fixtures
INFO listing `email-intake-test-fixture@afldb.test` and the `@example.test` rows the
integration suites leave behind, super admin INFO, inventory printed, exit 0.

## 8. What this issue does not do

- No production mutation. `afldb_prod` was not connected to. `AFLDB-ISSUE-126`'s recovery
  rows and `afldb_prod_auth_recovery` are untouched; `AFLDB-ISSUE-137` is untouched.
- No orchestrator. The checker refuses, reports and writes a plan; the operator runs the
  destructive steps by hand from the procedure, on the named host, with the checker between
  each phase.

## 9. Exact next action

None for this issue. For the first real use: run the `source` phase on DEV (§7 command),
then follow `docs/production-promotion.md` from §3 with `AFLDB-ISSUE-137` path (a) as the
reason, taking the ISSUE-126 decision on the recovery rows either before (so the pre-cutover
dump carries the outcome) or as its own step afterwards — never by letting this procedure
back-fill them.
