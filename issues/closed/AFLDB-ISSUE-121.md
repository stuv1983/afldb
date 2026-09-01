# AFLDB-ISSUE-121 — `auth_audit_log.detail` stores JSON objects as JSONB strings

**Status: Resolved 2026-09-01. Code fix committed (`54c7a31`); migration `082` applied to `afldb_test` and `afldb_dev`; historical row 632 repaired to a JSONB object; `auth_audit_log_detail_is_object_ck` live. See §14.**
**Severity:** Medium — **Area:** Admin / Security / Audit trail / Database.
**Created:** 2026-09-01 (during `AFLDB-ISSUE-119` live dev acceptance).
**Resolved:** 2026-09-01.
**Unblocks:** `AFLDB-ISSUE-119` final **live dev** acceptance — its audit row 632 now reads
structurally (`jsonb_typeof = 'object'`, `detail->>'deletedLogRows' = 4953`). ISSUE-119's own
resolution (guarded `_test` deployment, 9/9) always stood and was never reopened.
**Migration:** `082_auth_audit_log_jsonb_repair.sql` — applied to `afldb_test` and `afldb_dev`
on 2026-09-01. Not applied to production; it ships with the `54c7a31` code fix, never before it (R1).

---

## 0. Allocation

`AFLDB-ISSUE-121` was the next free id: `IssuesIndex.md` recorded it as free on
2026-09-01 (`AFLDB-ISSUE-118` belongs to `opus/gridley-corpus`; 119 and 120 are
resolved), and no `AFLDB-ISSUE-121` appears in `issues.md`, `IssuesIndex.md` or
`CHANGELOG.md`.

Migration number `082` was re-derived on 2026-09-01 rather than assumed:

| Check | Result |
|---|---|
| Highest migration on `dev` | `081_nl_search_telemetry_clear.sql` |
| `080` | `080_external_grids.sql`, committed on `opus/gridley-corpus` (`28fdb2f`), still unmerged |
| `082_*` anywhere in the worktree | none |
| `082_*` in any local or remote ref's history (`git log --all --name-only`) | none |

So `082` is free and is taken here. The `080` gap on `dev` is harmless for the
reason migration `081` already recorded: `tools/db/migrate.ts` keys
`afldb_meta.schema_migrations` by **filename** and applies pending files in name
order, so it neither requires contiguous numbers nor cares that `080` arrives
later.

---

## 1. Discovery

Found during `AFLDB-ISSUE-119`'s **live dev** acceptance of Clear Search
Telemetry, after migration `081` and `privileges.sql` were applied to
`afldb_dev`. The clear itself worked exactly as specified:

    deletedLogRows          = 4953
    retainedLogRows         = 0
    retainedReviewRows      = 0
    retainedFeedbackRows    = 0
    detachedAppHealthLinks  = 14

and it emitted its audit row:

    auth_audit_log id 632, action = nl_search.telemetry_cleared

The defect is in that audit row's payload, not in the clear.

---

## 2. Evidence

    SELECT jsonb_typeof(detail) FROM auth_audit_log WHERE id = 632;
    -->  string

    detail renders as:
    "{\"deletedLogRows\":4953,...}"

Expected `jsonb_typeof(detail) = 'object'`. Because the value is a jsonb
**string scalar** rather than an object, every structural read of it returns
NULL:

    SELECT detail->>'deletedLogRows' FROM auth_audit_log WHERE id = 632;
    -->  NULL

`detail` is `jsonb` and has been since migration `023` (`023_auth_submissions.sql:94`).

---

## 3. Root cause

`insertAuditRow()` in `src/lib/auth/session.ts` bound the payload as
`${JSON.stringify(detail)}` — one encoding too many for a `jsonb` parameter
through postgres.js.

The driver does not leave a bound string alone when the target column is
`jsonb`:

1. `node_modules/postgres/src/types.js` `inferType()` returns `0` (unspecified)
   for a JS string, so the `Parse` message declares no parameter type.
2. The server replies with a `ParameterDescription`, and
   `node_modules/postgres/src/connection.js` (`ParameterDescription`, ~line 623)
   back-fills the statement's unspecified types with the OIDs PostgreSQL
   inferred — here `3802`, `jsonb`.
3. `Bind` (~line 959) then encodes each parameter with
   `options.serializers[type]`, and the serializer registered for `3802` is
   `JSON.stringify` (`types.js`, `types.json`).

So the object is stringified by the application and stringified again by the
driver. What PostgreSQL parses is `"{\"deletedLogRows\":4953,...}"` — a valid
jsonb **string**.

An explicit `::jsonb` cast does not help: the parameter is encoded before the
cast is applied. Only `sql.json()` binds a jsonb parameter correctly.

**This was already diagnosed once.** `048_nl_search_log_jsonb_repair.sql`
repaired the identical defect in `nl_search_log.plan`,
`.confidence_components` and `.entity_resolution`, and its header explicitly
deferred this column:

> NOT IN SCOPE, deliberately: `auth_audit_log.detail` carries the identical
> shape from `lib/auth/session.ts`'s `audit()` … Nothing reads that column
> structurally … so changing its write path is a separate decision with its own
> blast radius.

ISSUE-119 is that decision arriving: its clear writes a counts payload whose
whole purpose is to be read back.

---

## 4. Blast radius

**All `auth_audit_log` detail payloads, for the life of the table.**

`insertAuditRow()` is the only writer of `auth_audit_log` anywhere in `src/` —
one `INSERT INTO auth_audit_log`, at `src/lib/auth/session.ts:372`. Both
exported forms funnel through it:

| Writer | Affected |
|---|---|
| `audit()` (pooled) | yes |
| `auditInTransaction()` (ISSUE-119, transactional) | yes |
| any other `auth_audit_log` writer | none exists |

`auditInTransaction()` is not special here; it is simply the first caller whose
payload anyone reads structurally. Every historical row with a non-NULL
`detail` — including the ~100 rows migration 048 counted — carries the same
double encoding.

**No data was lost.** The payloads are intact and carry one surplus layer of
JSON encoding; unwrapping it is exact and reversible. Rows with `detail IS
NULL` (for example `admin.login`, `admin.logout`) were never affected.

**Not affected:** `nl_search_log`'s three jsonb columns (repaired by 048 and
guarded by its CHECK constraints), and `data_edits` /
`player_link_resolutions`, which `src/db/queries/audit-log.ts:50-51` already
binds with `tx.json()`.

---

## 5. Code fix (written; uncommitted at time of writing)

`src/lib/auth/session.ts` — `insertAuditRow()` now binds:

    ${detail ? sql.json(detail as postgres.JSONValue) : null}

`sql` is the `postgres.ISql` handle the function was already given, so the
pooled and transactional paths stay byte-identical and `auditInTransaction()`'s
contract (no try/catch, failure propagates and rolls the caller's mutation
back) is untouched. No `::jsonb` cast, no `@ts-ignore`, no `eslint-disable`.
The `as postgres.JSONValue` widening is the same one
`src/db/queries/audit-log.ts:50` already uses.

`tests/auth.test.ts` — the `auth_audit_log writer` describe gained a regression
case asserting, on **both** forms, that the bound value is not a string, that it
carries jsonb OID `3802`, and that the driver's single encoding of it parses
back to an object rather than to a quoted string. Two pre-existing assertions
that pinned the buggy `JSON.stringify` binding were updated to the corrected
one; nothing was deleted or weakened. The new case was confirmed to **fail**
against the old binding before the fix was kept.

---

## 6. Migration `082` design

`src/db/migrations/082_auth_audit_log_jsonb_repair.sql`, three steps.

### 6.1 Repair — tighter than 048

    UPDATE auth_audit_log
       SET detail = (detail #>> '{}')::jsonb
     WHERE jsonb_typeof(detail) = 'string'
       AND (detail #>> '{}') IS JSON OBJECT;

048 unwrapped every jsonb string scalar it found. That was safe there only
because those three columns can hold nothing but an object or an array. This
column is the audit trail, so both conditions must hold:

- `jsonb_typeof(detail) = 'string'` selects only the double-encoded shape.
  NULLs and already-correct objects are not matched, so **no row is rewritten
  that does not need it** (proven by an unchanged `xmin` in the integration
  suite).
- `IS JSON OBJECT` (PostgreSQL 16; the cluster is 16.14) proves the decoded
  text parses as a JSON **object** *before* anything is cast, so a malformed or
  genuinely scalar value is left alone rather than mangled or aborting the
  statement mid-migration.

`#>> '{}'` extracts the scalar as its raw text; casting that text back to jsonb
parses it as the object it was always meant to be. The statement is
self-limiting: once a value is an object it stops matching, so a re-run changes
nothing.

### 6.2 Refuse to guess

A `DO` block raises if any row is still neither NULL nor an object, naming the
count and the first ids and citing this issue. Failing here rather than at the
constraint is deliberate: a CHECK violation reports one row and no id, which is
not enough to decide what a surprising audit payload ought to become.
Migrations run inside a transaction (`tools/db/migrate.ts:212`), so the repair
rolls back with it and the database stays on `081`.

Expected to fire never: `insertAuditRow()`'s `detail` parameter is typed
`Record<string, unknown> | null`, so an object or NULL is the only shape ever
offered to the column.

### 6.3 Guard at the database

    CHECK (detail IS NULL OR jsonb_typeof(detail) = 'object')

named `auth_audit_log_detail_is_object_ck`, added inside a `pg_constraint`
existence check so re-running the file is not an error. NULL stays valid,
because the trail records events that carry no payload.

### 6.4 Privileges

Unchanged. No new table and no new function: `afldb_auth` keeps the
INSERT/SELECT granted by `023`, and `031`'s REVOKE still keeps `afldb_app` out.
No `afldb_meta.grant_app_read()` registration and no `privileges.sql` edit is
required. The UPDATE runs as the migration owner, so the table's append-only
grant shape is not weakened to perform the repair.

---

## 7. Test coverage

`tests/auth.test.ts` (DB-free) — the binding, on both forms. Described in §5.

`tests/integration/auth-audit-jsonb.test.ts` (new, requires PostgreSQL):

| Requirement | Test |
|---|---|
| a historically double-encoded object is repaired to a jsonb object | `repairs a double-encoded object, leaves a correct object and a NULL alone` |
| an already-correct object remains correct **and is not rewritten** | same test — value compared *and* `xmin` unchanged |
| NULL remains valid | same test, plus `accepts an object and a NULL` |
| the repair is idempotent | `is self-limiting: a second run repairs nothing and re-adds nothing` |
| a non-object string is never silently transformed | `refuses to guess at a string that is not a JSON object, and changes nothing` |
| future string/scalar detail is rejected by the CHECK | `rejects a future double-encoded string payload`, `rejects any other scalar payload` |
| `audit()` and `auditInTransaction()` store object-shaped jsonb | the `audit writer stores object-shaped jsonb` describe |

Two design points worth keeping:

- The suite **reads migration 082 from disk and executes it verbatim**
  (`tx.unsafe(MIGRATION_082)`), so what is tested is the artefact that will be
  applied to `afldb_dev` and production, not a paraphrase of it.
- The historical defect is reproduced with `to_jsonb(text)`, which is exactly
  the shape postgres.js produced, so the fixture does not depend on keeping a
  defective code path alive.

Safety: every statement runs inside an always-rolled-back transaction (the
`nl-search-telemetry-clear.test.ts` `Rollback` idiom), **including the DDL** —
PostgreSQL rolls `ALTER TABLE` back with everything else, so the constraint the
suite drops to plant a legacy fixture is restored by the rollback and is never
observed missing outside the transaction. No audit row is committed: the pooled
`audit()` form is exercised on a transaction handle through a mocked
`@/db/authClient`, which is sound because both forms share `insertAuditRow()`
and `tests/auth.test.ts` asserts their emitted SQL and bound values are
identical.

---

## 8. Validation state

Passing, 2026-09-01, Claude-executed under explicit operator instruction for
this task:

| Check | Result |
|---|---|
| `npx vitest run tests/auth.test.ts tests/admin-nl-search-actions.test.ts` | 2 files, **43/43** |
| wider audit-touching set (adds `admin-settings-actions`, `admin-match-mutations`, `nl-search-log`, `audit-link-fk-indexes`) | 6 files, **76/76** |
| new regression case against the **old** binding | **fails** (`expected 'string' not to be 'string'`) — a real guard |
| `npx tsc --noEmit` | clean |
| `npx eslint` on changed TypeScript | 0 errors |
| `git diff --check` | clean |

**Not run, and why:** `tests/integration/auth-audit-jsonb.test.ts` requires a
database. This worktree (`D:\dev\afldb-dev-test`) has **no `.env`** and no
`AFLDB_TEST_DATABASE_URL`, `AFLDB_OWNER_DATABASE_URL` or `DATABASE_URL` in the
environment, so `tests/integration/guard.ts` refuses the suite by design. No
credential was substituted, derived or copied from another worktree. The exact
blocker and the exact command are in §10.

---

## 9. Relationship to `AFLDB-ISSUE-119`

ISSUE-119 stays **Resolved**. Its acceptance contract was met against the
guarded loopback `_test` deployment (9/9 Playwright), and nothing in that
evidence is retracted: the retention contract, the five counts, the security
boundary and the atomic audit row all held.

What the live dev run adds is narrower and is recorded on ISSUE-119 as an
addendum only:

1. the live clear on `afldb_dev` **succeeded** after migration `081` and
   `privileges.sql` were applied — 4,953 disposable rows deleted, 14
   `app_health_events` links detached, nothing retained-but-lost;
2. its audit payload exposed this issue;
3. **final live dev acceptance is pending the ISSUE-121 repair**, because the
   ISSUE-119 audit row is the artefact an operator would read to confirm what
   the clear did, and today it is opaque to SQL.

ISSUE-119's history is not rewritten.

---

## 10. Exact next actions

Nothing here is authorised to run automatically. In order:

1. **Review and commit** the four changed files (§11). Nothing is committed
   yet.
2. **Run the integration suite** on a machine with `_test` credentials:

       npx vitest run tests/integration/auth-audit-jsonb.test.ts

   Prerequisite: `AFLDB_TEST_DATABASE_URL` pointing at `afldb_test`
   (owner DSN — the suite issues `ALTER TABLE`, always inside a rolled-back
   transaction). Migration `082` does **not** need to be applied to
   `afldb_test` first; the suite applies it inside its own transaction. Applying
   it there first is still recommended before step 3, and is the normal path:

       npm run db:migrate:test

3. **Apply `082` to `afldb_dev`** (operator decision, not done here):

       npm run db:migrate

   Then confirm the repair on the row that started this:

       SELECT jsonb_typeof(detail), detail->>'deletedLogRows'
         FROM auth_audit_log WHERE id = 632;
       -- expect: object, 4953

4. **Re-run ISSUE-119's live dev confirmation** of the audit payload only. Do
   **not** re-run the destructive clear: the deletion already happened and is
   not in question.
5. Production: `082` is safe to apply with the code fix, and **must not be
   applied before it** — see R1.

---

## 11. Files

| File | State |
|---|---|
| `src/lib/auth/session.ts` | modified — `sql.json()` binding + rationale comment |
| `tests/auth.test.ts` | modified — regression case, harness `json()` stand-in, two assertions corrected |
| `src/db/migrations/082_auth_audit_log_jsonb_repair.sql` | **new**, unapplied |
| `tests/integration/auth-audit-jsonb.test.ts` | **new**, unexecuted (no DB in this worktree) |
| `issues.md`, `IssuesIndex.md`, `CHANGELOG.md`, this file | tracking |

---

## 12. Risks

**R1 (medium) — deployment order.** The CHECK constraint in `082` rejects the
double-encoded shape. If `082` reaches a database whose application code still
binds `JSON.stringify(detail)`, **every audited admin action fails closed** with
a check violation. Code and migration must ship together, code first or
simultaneously; never the migration alone. This is the same ordering hazard
`AFLDB-ISSUE-027` recorded for migration `066`.

**R2 (low) — an unexpected non-object row.** `082` aborts rather than guessing
(§6.2). The operator then decides each row explicitly. No automatic path
converts a scalar into an object.

**R3 (low) — `IS JSON OBJECT` needs PostgreSQL 16.** The documented target is
16.14 (`docs/architecture.md`, `docs/migration-report.md`). On an older server
the migration would fail to parse — loudly, inside its own transaction, changing
nothing.

**R4 (low) — the repair is not reversible by rule.** Unwrapping is exact, but a
row that was *legitimately* a JSON-object-shaped string (none is known to exist,
and no writer can produce one) would become an object. Accepted.

---

## 13. Non-goals

- No change to what `audit()` records, when, or for whom.
- No change to `auth_audit_log`'s grants, append-only shape or retention.
- No repair of `nl_search_log` — 048 did that and its constraints hold.
- No re-run of the ISSUE-119 destructive clear.
- No production deployment, and no `afldb_dev` migration, as part of this issue's
  write-up.

---

## 14. Resolution — 2026-09-01

Documentation-only close-out. No implementation, test, migration or privilege
file was changed in this step; the code fix and migration `082` are the ones
committed at `54c7a31` ("Fix auth audit JSONB encoding").

### 14.1 `afldb_test` integration evidence

`tests/integration/auth-audit-jsonb.test.ts` ran against `afldb_test` and passed
**8/8**. Migration `082` was applied to `afldb_test` first
(`082_auth_audit_log_jsonb_repair.sql ... ok`); the migration runner then reported
**82 already applied / schema up to date** with no pending files. The suite — which
reads `082` from disk and executes it verbatim inside an always-rolled-back
transaction, DDL included — covered:

- a historically double-encoded object repaired to a JSONB object;
- an already-correct object left byte- and `xmin`-identical (not rewritten);
- `NULL` preserved as valid;
- an idempotent re-run that repairs nothing and re-adds nothing;
- refusal to transform a string that is not a JSON object;
- CHECK rejection of a future double-encoded string and of any other scalar;
- object-shaped JSONB stored through the real `audit()` and
  `auditInTransaction()` writers.

This clears §8's "Not validated against a database" gap and §10 step 2. The DB-free
suites recorded in §8 (43/43 and 76/76, `tsc --noEmit` clean, the regression case
proven to fail against the old binding) are unchanged.

### 14.2 Deployment ordering — observed, and correct

The load-bearing order in §12 R1 (code fix with or before the migration, never the
migration alone, or the CHECK constraint fails every audited admin action closed)
was followed on `afldb_dev`:

1. `afldb_dev` was rebuilt and restarted on code commit `54c7a31` **before**
   migration `082` was applied. Post-restart health:
   `{"status":"ok","database":"ok","latencyMs":28}`.
2. Migration `082` was then applied to `afldb_dev`:
   `applying 082_auth_audit_log_jsonb_repair.sql ... ok`.

So the constraint met an application that already binds `sql.json(detail)`, and no
admin action failed closed. This mirrors the `AFLDB-ISSUE-027` / migration `066`
ordering hazard the runbook cites.

### 14.3 Historical row 632 repair — live `afldb_dev` evidence

The row that exposed this issue (the `AFLDB-ISSUE-119` live dev clear's audit row),
after migration `082`:

    SELECT jsonb_typeof(detail) FROM auth_audit_log WHERE id = 632;
    -->  object

    SELECT detail->>'deletedLogRows' FROM auth_audit_log WHERE id = 632;
    -->  4953

    detail =
      {
        "deletedLogRows": 4953,
        "retainedLogRows": 0,
        "retainedReviewRows": 0,
        "retainedFeedbackRows": 0,
        "detachedAppHealthLinks": 14
      }

The five keys and values match the counts `AFLDB-ISSUE-119`'s clear returned
exactly. No count changed; the surplus encoding layer was removed and the payload
now reads structurally.

### 14.4 CHECK constraint — live

    auth_audit_log_detail_is_object_ck
    CHECK (detail IS NULL OR jsonb_typeof(detail) = 'object')

present on `auth_audit_log` on `afldb_dev` after `082`. `NULL` stays valid; any
future double-encoded or scalar `detail` is rejected at the database.

### 14.5 Final validation conclusion

- Code fix (`insertAuditRow()` → `sql.json(detail)`) committed at `54c7a31`,
  fixing `audit()` and `auditInTransaction()` together.
- Migration `082` applied to `afldb_test` (integration suite 8/8) and to `afldb_dev`
  (row 632 repaired, constraint live).
- No audit data was lost; the repair was exact and idempotent; no privilege, grant,
  retention or append-only behaviour changed; no other table was touched.
- `AFLDB-ISSUE-119`'s final live dev acceptance is unblocked — its audit row is now
  legible to SQL, reached by re-reading row 632, **not** by re-running the
  destructive clear.

### 14.6 Outstanding — production only

Migration `082` is not applied to production. It must be applied **with or after**
the `54c7a31` code fix, never before it (§12 R1). This is the only remaining step
and it is ordinary deployment, not ISSUE-121 work.
