# AFLDB-ISSUE-117 — Revoked access keys cannot be removed from the admin UI

**Status: Open. Implemented, incl. the revoked-or-spent widening (§5). Automated validation
PASSED 51/51 on 2026-08-31. The §5 change is NOT yet deployed to dev; dev runs round-1 code.**
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

Wanted: **Active → Revoke → Delete**, deletion refused by the server rather than merely hidden
in the browser. §5 records the manual-validation finding that widened "deletable" from *revoked*
to *revoked or spent*; §3 below describes the first implementation, §5 the change on top of it.

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
| `src/db/queries/access-codes.ts` | **new.** The one destructive statement; its eligibility predicate lives in the `WHERE` clause. Takes a transaction handle, not a pool, the same contract `recordDataEdit` carries. **Renamed to `deleteRetiredAccessCode` and widened in §5** |
| `src/app/admin/access/actions.ts` | **new** `deleteAccessCode`: `requireAdmin()`, then delete + `access.code_deleted` audit inside one `authSql.begin` |
| `src/lib/auth/session.ts` | `audit()` takes an optional 4th arg, a transaction handle. Omitted, it behaves exactly as before (best-effort, on the pool); passed, the audit joins the mutation's transaction |
| `src/app/admin/access/AccessManager.tsx` | `DeleteCodeButton` — a revoked row offers **Delete…**, which opens an in-row confirmation naming the code before anything submits |
| `src/styles/globals.css` | `.btn-danger`, `.delete-confirm*` |
| `tests/admin-access-actions.test.ts` | **new**, no database |
| `tests/integration/access-codes.test.ts` | **new**, real PostgreSQL |
| `tests/integration/privileges.test.ts` | asserts the new DELETE grant |

### Where each safety requirement actually lives

- **Still-redeemable keys are not deletable** — the eligibility predicate is in the DELETE. A
  hand-rolled POST naming such a code's id matches no row and deletes nothing. The hidden button
  is presentation. (§5 widened which codes qualify, never how it is enforced.)
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

## 4. Verification — RERUN 2026-08-31 after the §5 widening, all green (results in §7)

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
| 1 | an active key cannot be deleted | unit: `will not delete an active unused code…` (asserts **both** predicate limbs are in the SQL) + integration: `refuses an active unused code and leaves it in place` |
| 2 | a revoked key can be deleted | integration: `deletes a revoked code and reports what it removed` |
| 1a | a **spent** key can be deleted directly (§5) | unit: `deletes a SPENT code that was never revoked, with no revoke first` (also asserts no UPDATE was issued) + integration: `deletes a SPENT code that was never revoked` |
| 1b | a **partly used** key is still refused (§5) | integration: `refuses a PARTLY USED code, which can still be redeemed` |
| 1c | an **unlimited** key is never spent (§5) | integration: `refuses an UNLIMITED code however many times it has been used` — the NULL-comparison case only real PostgreSQL settles |
| 1d | both limbs true at once behaves (§5) | integration: `deletes a code that is both revoked and spent, reporting it as revoked` |
| 3 | the deleted row no longer appears in the list | integration, same test — the row count for that id is 0, and `page.tsx` selects with no state filter, so absence from the table is absence from the UI. Plus unit: `revalidates /admin/access…` |
| 4 | deletion records the expected audit event | unit: `writes access.code_deleted naming what was destroyed, and no secret`, plus `records a spent deletion as spent, with a null revocation time` — the trail says WHICH rule allowed the row to go |
| 5 | a forged/direct request cannot delete an active key | integration: `refuses an active unused code…`, `refuses a PARTLY USED code…` and `refuses an UNLIMITED code…` all call the query function directly, with no UI in the way |
| 6 | an unknown/already-deleted id fails cleanly | unit: `gives an unknown id the same answer as a live one`; integration: `fails cleanly on an id that does not exist` |
| 7 | revoke behaviour unchanged | unit: `revoking is unchanged by the delete path` (still a one-shot UPDATE on the pool, same predicate, same audit call) |
| 8 | auth/authz intact | unit: `requires an admin session before any statement runs` |
| — | the role can actually delete | `tests/integration/privileges.test.ts` |
| — | the statement deletes exactly one row | integration: `touches only the code it was given` — catches a lost `id =` predicate, which every per-row assertion above would miss |

---

## 5. Manual dev validation, and the rule it widened

**Manual validation on dev passed for Active → Revoke → Delete** (branch `claude/issue-116`
deployed via `sync-dev.ps1 -RemoteRef claude/issue-116 -AllowDirtyServer`; `afldb_dev` already
carried migration 079 and the reconciled `afldb_auth` DELETE grant).

It also confirmed the gap this runbook had recorded as deliberate in its previous revision: a
**spent** code — `use_count >= max_uses` — was undeletable. Worse, it was *undisposable*: the
admin table offers Revoke only in the `live` state, so a spent code could be neither revoked
nor deleted and simply accumulated. The operator's requirement is that a spent code be
deletable **directly**, without a revoke that changes nothing.

### The rule now

A code is **retired**, and so deletable, when it can no longer be redeemed *by its own terms*:

```sql
revoked_at IS NOT NULL
OR (max_uses IS NOT NULL AND use_count >= max_uses)
```

| State | `revoked_at` | uses | Revoke | Delete |
|---|---|---|---|---|
| Active, unused | NULL | `0 < max_uses` | yes | **refused** |
| Active, partly used | NULL | `0 < use_count < max_uses` | yes | **refused** — still redeemable |
| Unlimited, any use count | NULL | `max_uses IS NULL` | yes | **refused** — never spent |
| Spent | NULL | `use_count >= max_uses` | (not offered) | **yes, directly** |
| Revoked | set | any | (not offered) | **yes** |
| Expired, unused | NULL | under limit | (not offered) | **refused** — see below |

**Why this is safe, stated so it can be checked.** Every limb of the predicate is a reason
`redeemBetaCode` (`src/app/beta/actions.ts:80-88`) would refuse the code. That query redeems
only when `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()) AND (max_uses IS
NULL OR use_count < max_uses)`. So "revoked or spent" is a **strict subset of "not
redeemable"**, and a code that could still let somebody in can never be deleted. Widening the
delete rule did not widen the set of live codes at risk by one row.

Two boundaries follow from that and are both tested:

- **Partly used stays refused.** Two of five uses spent still leaves three admissions. Deleting
  it would be a silent revoke with no revocation record.
- **Unlimited is never spent.** `max_uses IS NULL` makes `use_count >= max_uses` evaluate to
  NULL, not true, so an unlimited code stays deletable only by revoking it first — which is
  exactly what migration 036 means by "unlimited means uncapped, not unrevocable". This is the
  one case where only PostgreSQL's real three-valued logic settles the answer, which is why it
  is an integration test and not a unit test.

### Still deliberately excluded: expiry

An **expired** code is unredeemable too, but is **not** deletable. Expiry is a moving line —
`expires_at` passes on its own, with nobody deciding anything — and deletion is irreversible.
Admitting it would mean rows becoming destroyable through the passage of time rather than an
act. That is a deliberate product decision, not an oversight; it is a one-limb change to
`deleteRetiredAccessCode` if it is ever wanted. Note the consequence, unchanged from before: an
expired, unspent code is offered neither Revoke (the UI shows it only when `live`) nor Delete,
so it still cannot be disposed of. **Operator decision; not taken here.**

### What changed for it

| File | Change |
|---|---|
| `src/db/queries/access-codes.ts` | `deleteRevokedAccessCode` → **`deleteRetiredAccessCode`**, predicate widened to revoked-or-spent. Renamed deliberately: a function still called `…Revoked` that also deletes spent codes is a trap for the next reader. `RETURNING` gained `use_count` and `max_uses`; `revokedAt` is now nullable. New `retirementReason()` returns `'revoked' or 'spent'`, revoked winning when both, matching the admin table's state precedence |
| `src/app/admin/access/actions.ts` | calls the renamed query; audit detail gains `reason`, `useCount`, `maxUses`, and `revokedAt` is now nullable; refusal message now says "revoked or spent" |
| `src/app/admin/access/AccessManager.tsx` | Delete shows on `revoked` **or** `spent`; the confirmation names which of the two |

Unchanged, and verified unchanged: `requireAdmin()` still gates the action before any statement;
the audit still runs inside the same `authSql.begin` as the DELETE, so an audit failure still
rolls the deletion back; revoke keeps its own predicate, its own one-shot statement on the pool,
and its own audit event; no migration, grant or privilege change was needed, because the widened
rule is a `WHERE` clause and not a new capability.

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

Two validation rounds. Round 1 covered the original revoked-only implementation; round 2 covers
the revoked-or-spent widening from §5. **Round 2 is the current state.**

### Round 2 — after the §5 widening (2026-08-31, `D:\dev\afldb-issue-116`)

| Command | Result |
|---|---|
| `npx vitest run tests/admin-access-actions.test.ts` | **PASS — 1 file, 13/13** (was 11; +2 spent-code cases) |
| `npx vitest run tests/integration/access-codes.test.ts` | **PASS — 1 file, 8/8** (was 4; +4 boundary cases) |
| `npx vitest run tests/integration/privileges.test.ts` | **PASS — 1 file, 30/30** (unchanged) |
| `npx tsc --noEmit` | **PASS, clean (exit 0)** |
| Post-run state check on `afldb_test` | **clean — `leaked_fixture_rows = 0`** |

**Round 2 total: 51/51 across 3 files. 0 failures, 0 skips.**

No migration, grant or privilege change was required by the widening: the rule is a `WHERE`
clause, not a new capability. `afldb_dev` and `afldb_test` both already carry migration 079 and
the reconciled `afldb_auth` DELETE grant, and neither was touched in round 2.

### Round 1 — original revoked-only implementation (2026-08-31)

| Command | Result |
|---|---|
| `npm ci` | PASS — 419 packages, 0 vulnerabilities |
| `npx vitest run tests/admin-access-actions.test.ts` | PASS — 11/11 |
| `npx tsc --noEmit` | PASS after the `postgres.ISql` fix recorded below |
| `.env` supplied to this worktree | done — §4.1, copied from `afldb-issue-110` (55432 tunnel) |
| `npm run db:migrate:test` | PASS — `applying 079_access_code_delete.sql ... ok (136 ms)` |
| `npx vitest run tests/integration/access-codes.test.ts` | PASS — 4/4 |
| `npx vitest run tests/integration/privileges.test.ts` | PASS — 30/30 |
| Manual dev validation, Active → Revoke → Delete | **PASS** — and produced the §5 finding |

### Deployment state

| Item | State |
|---|---|
| Migration 079 on `afldb_test` | applied |
| Migration 079 + `privileges.sql` on `afldb_dev` | applied (`grants applied on 34 of 34 tables, 29 other relations revoked`) |
| Round-1 code deployed to dev | **yes** — `claude/issue-116` via `sync-dev.ps1 -RemoteRef claude/issue-116 -AllowDirtyServer`; dev is NOT on `dev`/`0c2100a` |
| **Round-2 (§5) code deployed to dev** | **NO — working tree only, not committed, not pushed** |
| Dev restored to `dev` @ `0c2100a` | **NO — still on the ISSUE-117 branch** |
| Prod | **untouched** |
| `CHANGELOG.md` entry | done — `Unreleased` |

### The one real defect found in validation, and its fix (round 1)

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
cannot close the pool or open a nested connection.

**Fix:** annotate the handle as the shared base, `postgres.ISql`, which carries exactly the
tagged-template call signature the `auth_audit_log` INSERT uses and nothing more. Ordinary
widening — no cast, no `any`, no suppression — and the handle is *narrower* than before.

### Exact next action

**Deploy the §5 widening to dev and re-validate by hand.** Dev currently runs the round-1 code,
which still refuses to delete a spent code, so the new behaviour cannot be confirmed there yet.

1. Commit and push the round-2 changes on `claude/issue-116`.
2. `powershell -ExecutionPolicy Bypass -File .\deploy\sync-dev.ps1 -RemoteRef claude/issue-116 -AllowDirtyServer`
   — `-AllowDirtyServer` is required and precedented; see §6.
3. Confirm `x-afldb-build` changed, then on `/admin/access` check all four states by hand:
   a spent code offers **Delete** with no revoke first; a revoked code still offers Delete; an
   active unused code offers **Revoke only**; and a partly-used code likewise offers Revoke only.
4. Then restore dev: `sync-dev.ps1 -RemoteRef dev -AllowDirtyServer`. Migration 079 stays applied
   (forward-only), and **do not** run `db:privileges` from the `dev` branch afterwards — its
   spec lacks the DELETE and the reconciler is subtractive, so it would revoke the grant.
5. Only then resolve: `issues.md` + `IssuesIndex.md` (open count 6 → 5) and move this file to
   `issues/closed/`.

**Not resolved.** Automated validation is complete and green for round 2; the dev deploy of the
§5 change and its manual confirmation are not done, and prod is untouched.
