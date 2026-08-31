# AFLDB-ISSUE-117 — Revoked access keys cannot be removed from the admin UI

**Status: Open. Implemented. Automated validation PASSED 45/45 on 2026-08-31. NOT deployed.**
**Severity:** Medium — **Area:** Admin / Access management / Security.
**Created:** 2026-08-31 (operator brief).
**Related:** `AFLDB-ISSUE-027` — the same "a mutation cannot commit without its audit"
guarantee, reached here on the auth pool rather than through migration 066.

> **The operator brief for this work was written as "AFLDB-ISSUE-116", and the branch is
> `claude/issue-116`. That id was already taken.** `AFLDB-ISSUE-116` is the open
> `player_match_stats` Data QA anchor issue, and `AFLDB-ISSUE-115`'s Resolution record names
> 116 as its follow-up — renumbering it would falsify a closed issue's history. This work
> therefore took the next free id, **117**. `AFLDB-ISSUE-110` remains allocated to unmerged NL
> work and was not used. The branch name is left alone; only the issue id differs.

---

## 1. The gap

`/admin/access` can revoke an access key but never remove one. `revokeAccessCode`
(`src/app/admin/access/actions.ts`) sets `beta_access_codes.revoked_at`; the row survives, and
`src/app/admin/access/page.tsx` selects every code with no state filter. Revoked keys therefore
accumulate in the admin list permanently, with no disposal path.

Wanted: **Active → Revoke → Delete**, deletion available only on the revoked state and refused
by the server rather than merely hidden in the browser.

---

## 2. Safety checks done before adding any DELETE

The brief required stopping if durable references made physical deletion unsafe. They do not,
and here is the evidence rather than the conclusion.

| Check | Method | Result |
|---|---|---|
| Foreign keys into `beta_access_codes` | searched every file in `src/db/migrations/` for `REFERENCES beta_access_codes` | **none** — no child rows, no cascade needed |
| Beta session cookie | `src/app/beta/actions.ts:98` mints `grantBetaAccess('code:<id>')` | the subject embeds the id, but `hasBetaAccess()` (`src/lib/auth/session.ts:116`) and `src/middleware.ts:136` verify only signature / kind / expiry / epoch and **never look the id up** |
| Session impact of deleting | follows from the row above | **none.** Deleting ends no live session — and neither does revoking. Epoch and TTL remain the only ways to cut a beta session short, so deletion is not a weaker path than the revocation that must precede it |
| Redemption history | `auth_audit_log` `beta.code_redeemed` detail carries `codeId` + `label` | history stays readable after the row goes |
| Id reuse | `id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY` (migration 023) | a freed id is never reissued; no later code can inherit a deleted one's cookie subject |
| `afldb_auth` DELETE grant | migration 023 grants `SELECT, INSERT, UPDATE`; `tools/maintenance/privileges.sql:376` mirrored that | **absent — this was the blocker.** Without a new grant the feature fails closed in production while passing every test that does not connect as that role |

**`privileges.sql`'s `afldb_auth` section is subtractive.** A grant made only by a migration and
not added to that spec is revoked by the next reconcile or restore. That is why both files
change, and why the grant is also asserted in `tests/integration/privileges.test.ts`.

---

## 3. What was implemented

| File | Change |
|---|---|
| `src/db/migrations/079_access_code_delete.sql` | **new.** `GRANT DELETE ON beta_access_codes TO afldb_auth`, under the usual `IF EXISTS (afldb_auth)` guard. Precedent: `data_submission_rows` (023), `site_media` (037) |
| `tools/maintenance/privileges.sql` | spec entry becomes `SELECT, INSERT, UPDATE, DELETE`, so the reconciler preserves the grant |
| `src/db/queries/access-codes.ts` | **new.** `deleteRevokedAccessCode(tx, id)` — the one destructive statement. `revoked_at IS NOT NULL` lives in its `WHERE` clause. Takes a transaction handle, not a pool, the same contract `recordDataEdit` carries |
| `src/app/admin/access/actions.ts` | **new** `deleteAccessCode`: `requireAdmin()`, then delete + `access.code_deleted` audit inside one `authSql.begin` |
| `src/lib/auth/session.ts` | `audit()` takes an optional 4th arg, a transaction handle. Omitted, it behaves exactly as before (best-effort, on the pool); passed, the audit joins the mutation's transaction |
| `src/app/admin/access/AccessManager.tsx` | `DeleteCodeButton` — a revoked row offers **Delete…**, which opens an in-row confirmation naming the code before anything submits |
| `src/styles/globals.css` | `.btn-danger`, `.delete-confirm*` |
| `tests/admin-access-actions.test.ts` | **new**, no database |
| `tests/integration/access-codes.test.ts` | **new**, real PostgreSQL |
| `tests/integration/privileges.test.ts` | asserts the new DELETE grant |

### Where each safety requirement actually lives

- **Active keys are not deletable** — `revoked_at IS NOT NULL` in the DELETE. A hand-rolled POST
  naming a live code's id matches no row and deletes nothing. The hidden button is presentation.
- **Authorisation** — `requireAdmin()`, first statement in the action, as in every other action
  in that file. The page's existing guard was deliberately **not** changed: `/admin/access` uses
  `requireAdmin`, not `requireSuperAdmin`, and this issue does not redesign that.
- **Audit cannot be skipped** — the `access.code_deleted` INSERT runs on the transaction handle,
  so a failed audit aborts the delete. This works because `auth_audit_log` and
  `beta_access_codes` share the `afldb_auth` role; it needs no second pool and no migration-066
  equivalent.
- **No secret in the trail** — detail is `{ codeId, label, revokedAt }`. Only the sha256 of the
  code was ever stored, and it leaves with the row.
- **No id oracle** — "not revoked", "never existed" and "already deleted" all return the same
  message.

---

## 4. Verification — RUN 2026-08-31, all green (results in §7)

Operator-run from `D:\dev\afldb-issue-116`. Results and totals are in §7.

**A fresh worktree has neither `node_modules` nor `.env`.** Both are per-checkout and both are
absent on a new worktree; `.env` is gitignored (`.gitignore:24`), so it is never carried over by
`git worktree add`. See §4.1 for how the test DSN is supplied — it is not optional, and it is
the reason the integration suites cannot run on a fresh worktree.

```
npm ci
npx vitest run tests/admin-access-actions.test.ts
npx vitest run tests/integration/access-codes.test.ts tests/integration/privileges.test.ts
npx tsc --noEmit
```

The second command needs `AFLDB_TEST_DATABASE_URL` pointing at `afldb_test`, **and needs
migration 079 applied to that database first** (`npm run db:migrate:test`) or the privileges
assertion fails for the right reason in the wrong place. `npm run db:privileges:test` also
grants it, since `privileges.sql` now carries the DELETE in its spec; either is sufficient, and
running the reconciler after the migration is the closer match to how dev and prod are kept.

### 4.1 Where `AFLDB_TEST_DATABASE_URL` comes from

There is no separate mechanism: **both loaders read a `.env` at the checkout's own root** —
`tools/db/migrate.ts:40-56` (`loadEnv`, "Load .env, as the Python tooling does") and
`tests/setup.ts`, which additionally redirects `DATABASE_URL` at the test database and refuses
any database whose name does not end in `_test`. `.env` is gitignored, so a new worktree simply
has none and `tests/integration/guard.ts` stops every integration suite before it opens a
connection. That is the whole of the blocker; nothing about it is specific to this issue.

The established practice is a per-worktree `.env` copied from an existing checkout — several
sibling worktrees (`afldb-issue-099`, `-102`, `-109`, `-110`, `-086-port`, `-096-pg`) carry one.

**Take the copy from a worktree using the live tunnel port.** The main checkout `D:\dev\afldb`
and the older worktrees still name `127.0.0.1:5432`, which is **not listening**; the working
path is the SSH tunnel on **55432**, which is what `afldb-issue-110` (the most recent) uses and
what `AFLDB-ISSUE-115` recorded as "the established 55432 tunnel". Copying the stale 5432
variant fails to connect and looks like a database outage.

```
cp D:\dev\afldb-issue-110\.env D:\dev\afldb-issue-116\.env
```

Done for this worktree on 2026-08-31. No DSN was invented, no credential changed, and the
copied `AFLDB_TEST_DATABASE_URL` targets `afldb_test` on 55432. It is gitignored here too, so it
cannot be committed.

| # | Brief's requirement | Covered by |
|---|---|---|
| 1 | an active key cannot be deleted | unit: `will not delete an active code…` (asserts the predicate is in the SQL) + integration: `refuses an active code and leaves it in place` |
| 2 | a revoked key can be deleted | integration: `deletes a revoked code and reports what it removed` |
| 3 | the deleted row no longer appears in the list | integration, same test — the row count for that id is 0, and `page.tsx` selects with no state filter, so absence from the table is absence from the UI. Plus unit: `revalidates /admin/access…` |
| 4 | deletion records the expected audit event | unit: `writes access.code_deleted naming what was destroyed, and no secret` |
| 5 | a forged/direct request cannot delete an active key | integration: `refuses an active code…` calls the query function directly, with no UI in the way |
| 6 | an unknown/already-deleted id fails cleanly | unit: `gives an unknown id the same answer as a live one`; integration: `fails cleanly on an id that does not exist` |
| 7 | revoke behaviour unchanged | unit: `revoking is unchanged by the delete path` (still a one-shot UPDATE on the pool, same predicate, same audit call) |
| 8 | auth/authz intact | unit: `requires an admin session before any statement runs` |
| — | the role can actually delete | `tests/integration/privileges.test.ts` |
| — | the statement deletes exactly one row | integration: `touches only the code it was given` — catches a lost `id =` predicate, which every per-row assertion above would miss |

---

## 5. Known gap — deliberate, not fixed here

A **spent** or **expired** code has `revoked_at IS NULL`, so it cannot be deleted; and the
existing UI offers Revoke only in the `live` state, so it cannot be revoked either. Such a code
remains undeletable after this change.

This follows the brief exactly — "only revoked keys may expose the Delete action", "do not
change the existing revoke semantics merely to hide revoked rows" — and is recorded rather than
silently widened. Closing it means showing Revoke on `spent` and `expired` rows, a visibility
change to the revoke path. **Operator decision; not taken here.**

---

## 6. Deploy order — load-bearing

The code fails closed without the grant, so the grant goes first.

1. Apply **migration 079** to the target database (`npm run db:migrate` for dev).
2. Run **`tools/maintenance/privileges.sql`** against the same database (`npm run db:privileges`).
   Skipping this does not break the deploy today, but the next restore or reconcile revokes the
   grant and deletion starts failing with a permission error that looks like a code bug.
3. **Then** deploy the application code.

Reversed, every Delete returns a permission error and the audit trail records nothing, because
the transaction aborts before the audit INSERT.

Dev before prod, per the usual practice — deploy to dev, let the operator exercise
Revoke → Delete on a real code in `/admin/access`, and only then consider prod.

---

## 7. Status and evidence log

Validation run by the operator from `D:\dev\afldb-issue-116` on **2026-08-31**.

| Milestone | State |
|---|---|
| Investigation (FKs, session refs, grants) | **done** — §2 |
| Implementation | **done** — §3, working tree, uncommitted |
| `npm ci` | **PASS** — 419 packages, 0 vulnerabilities |
| `npx vitest run tests/admin-access-actions.test.ts` | **PASS — 1 file, 11/11 tests** |
| `npx tsc --noEmit` | **PASS, clean (exit 0)** — after the fix recorded below |
| `.env` supplied to this worktree | **done** — §4.1, copied from `afldb-issue-110` (55432 tunnel) |
| `npm run db:migrate:test` | **PASS** — `applying 079_access_code_delete.sql ... ok (136 ms)`, 1 migration applied to `afldb_owner@127.0.0.1:55432/afldb_test` |
| `npx vitest run tests/integration/access-codes.test.ts` | **PASS — 1 file, 4/4 tests** |
| `npx vitest run tests/integration/privileges.test.ts` | **PASS — 1 file, 30/30 tests** (both together: 2 files, 34/34, 4.11 s) |
| Post-run state check on `afldb_test` | **clean** — `leaked_fixture_rows = 0`; `has_table_privilege('afldb_auth','beta_access_codes','DELETE') = true` |
| Migration 079 + `privileges.sql` applied to **dev** | **NOT DONE** |
| Manual Revoke → Delete on dev `/admin/access` | **NOT DONE** |
| Prod deploy | **NOT DONE** |
| `CHANGELOG.md` entry | **done** — `Unreleased` |

**Totals: 45/45 tests passed across 3 files (11 unit + 4 + 30 integration). No failures, no
skips.** Every one of the brief's eight validation requirements is exercised by a test that
actually ran; the §4 coverage table maps each to its test name.

### The one real defect found in validation, and its fix

`npx tsc --noEmit` initially failed, and the failure was in this change:

```
src/lib/auth/session.ts:357:9 - error TS2322
Type 'Sql<{}> | TransactionSql<{}>' is not assignable to type 'Sql<{}>'.
  Type 'TransactionSql<{}>' is missing the following properties from type 'Sql<{}>':
  CLOSE, END, PostgresError, options, and 7 more.
```

**Cause — a wrong assumption, not a typo.** `audit()`'s write handle had been annotated
`typeof authSql` on the belief that `TransactionSql` extends `Sql`. It does not. In postgres.js
3.4.9 (`node_modules/postgres/types/index.d.ts:669,701,723`) `Sql` and `TransactionSql` are
**siblings**: both extend `ISql`, and `TransactionSql` deliberately omits the pool-level members
— `END`, `CLOSE`, `options`, `reserve`, and `begin` itself — precisely so a transaction handle
cannot close the pool or open a nested connection. The pool's type therefore cannot describe
both, and it was right that this did not compile.

**Fix:** annotate the handle as the shared base, `postgres.ISql`, which carries exactly the
tagged-template call signature the `auth_audit_log` INSERT uses and nothing more. Both `Sql` and
`TransactionSql` extend it, so this is ordinary widening — no cast, no `any`, no suppression,
and the handle is *narrower* than before rather than looser: `write` can now only run queries,
not manage a pool. The type-level statement matches what the helper actually needs.

**Exact next action:** apply §6 steps 1–2 to dev (`npm run db:migrate`, `npm run db:privileges`),
deploy the code, and exercise Revoke → Delete by hand on dev `/admin/access` — including one
attempt at deleting an active key, which must be refused. Then, and only then, resolve the issue
in `issues.md` and `IssuesIndex.md` (open count 6 → 5) and move this file to `issues/closed/`.

**Not resolved.** Automated validation is complete and green; the dev deploy and the manual
lifecycle check are not, and prod is untouched.
