# AFLDB-ISSUE-117 — Retired access keys cannot be removed from the admin UI

**Status: Open.** Implemented 2026-08-31, incl. the revoked-or-spent widening (§5).
**Reconciled onto current `main` 2026-09-06 (§8): migration renumbered `079` → `091`, and the
`src/lib/auth/session.ts` change dropped as superseded.** DB-free validation green on the new
branch (13/13 unit, `tsc` exit 0, `eslint` exit 0). The three DB-backed suites, the merge, the
deploy and the manual dev confirmation remain.
**Severity:** Medium — **Area:** Admin / Access management / Security.
**Created:** 2026-08-31 (operator brief). **Reconciled:** 2026-09-06.
**Branch:** `claude/issue-117`, worktree `D:\dev\afldb-issue-117`, cut from `main` @ `8dd96c5`.
**Related:** `AFLDB-ISSUE-027` — the same "a mutation cannot commit without its audit" guarantee,
reached here on the auth pool. `AFLDB-ISSUE-119` — built `auditInTransaction`, which this issue
now uses instead of its own `audit()` change. `AFLDB-ISSUE-142` Finding C / `AFLDB-ISSUE-139` —
the DEV migration-parity consequence (§8.3).

> **The operator brief for this work was written as "AFLDB-ISSUE-116", and the original branch is
> `claude/issue-116`. That id was already taken.** `AFLDB-ISSUE-116` is the open
> `player_match_stats` Data QA anchor issue, and `AFLDB-ISSUE-115`'s Resolution record names 116 as
> its follow-up — renumbering it would falsify a closed issue's history. This work therefore took
> the next free id, **117**. The original branch name is left alone; it stays as history at
> `2344ab5` and is superseded by `claude/issue-117`.

---

## 1. The gap

`/admin/access` can revoke an access key but never remove one. `revokeAccessCode`
(`src/app/admin/access/actions.ts`) sets `beta_access_codes.revoked_at`; the row survives, and
`src/app/admin/access/page.tsx` selects every code with no state filter. Revoked keys therefore
accumulate in the admin list permanently, with no disposal path.

Wanted: **Active → Revoke → Delete**, deletion refused by the server rather than merely hidden in
the browser. §5 records the manual-validation finding that widened "deletable" from *revoked* to
*revoked or spent*; §3 describes the first implementation, §5 the change on top of it, §8 the
2026-09-06 reconciliation onto current `main`.

---

## 2. Safety checks done before adding any DELETE

The brief required stopping if durable references made physical deletion unsafe. They do not, and
here is the evidence rather than the conclusion.

| Check | Method | Result |
|---|---|---|
| Foreign keys into `beta_access_codes` | searched every file in `src/db/migrations/` for `REFERENCES beta_access_codes` | **none** — no child rows, no cascade needed |
| Beta session cookie | `src/app/beta/actions.ts` mints `grantBetaAccess('code:<id>')` | the subject embeds the id, but `hasBetaAccess()` and `src/middleware.ts` verify only signature / kind / expiry / epoch and **never look the id up** |
| Session impact of deleting | follows from the row above | **none.** Deleting ends no live session — and neither does revoking. Epoch and TTL remain the only ways to cut a beta session short, so deletion is not a weaker path than the revocation that may precede it |
| Redemption history | `auth_audit_log` `beta.code_redeemed` detail carries `codeId` + `label` | history stays readable after the row goes |
| Id reuse | `id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY` (migration 023) | a freed id is never reissued; no later code can inherit a deleted one's cookie subject |
| `afldb_auth` DELETE grant | migration 023 grants `SELECT, INSERT, UPDATE`; `tools/maintenance/privileges.sql` mirrored that | **absent — this was the blocker.** Without a new grant the feature fails closed in production while passing every test that does not connect as that role |

**`privileges.sql`'s `afldb_auth` section is subtractive.** A grant made only by a migration and not
added to that spec is revoked by the next reconcile or restore. That is why both files change, and
why the grant is also asserted in `tests/integration/privileges.test.ts`.

---

## 3. What is implemented

| File | Change |
|---|---|
| `src/db/migrations/091_access_code_delete.sql` | **new.** `GRANT DELETE ON beta_access_codes TO afldb_auth`, under the usual `IF EXISTS (afldb_auth)` guard. Precedent: `data_submission_rows` (023), `site_media` (037). **Was `079` before §8.1** |
| `tools/maintenance/privileges.sql` | spec entry becomes `SELECT, INSERT, UPDATE, DELETE` (`-- 023, 091`), so the reconciler preserves the grant |
| `src/db/queries/access-codes.ts` | **new.** The one destructive statement; its eligibility predicate lives in the `WHERE` clause. Takes a transaction handle, not a pool, the same contract `recordDataEdit` carries |
| `src/app/admin/access/actions.ts` | **new** `deleteAccessCode`: `requireAdmin()`, then delete + `access.code_deleted` audit inside one `authSql.begin`, the audit written with `auditInTransaction` |
| `src/app/admin/access/AccessManager.tsx` | `DeleteCodeButton` — a revoked or spent row offers **Delete…**, which opens an in-row confirmation naming the code before anything submits |
| `src/styles/globals.css` | `.btn-danger`, `.delete-confirm*` |
| `tests/admin-access-actions.test.ts` | **new**, no database |
| `tests/integration/access-codes.test.ts` | **new**, real PostgreSQL |
| `tests/integration/privileges.test.ts` | asserts the new DELETE grant |

**No change to `src/lib/auth/session.ts`** — see §8.2. The original implementation modified it; that
is now unnecessary and was dropped.

### Where each safety requirement actually lives

- **Still-redeemable keys are not deletable** — the eligibility predicate is in the DELETE. A
  hand-rolled POST naming such a code's id matches no row and deletes nothing. The hidden button is
  presentation.
- **Authorisation** — `requireAdmin()`, first statement in the action, as in every other action in
  that file. The page's existing guard was deliberately **not** changed: `/admin/access` uses
  `requireAdmin`, not `requireSuperAdmin`, and this issue does not redesign that.
- **Audit cannot be skipped** — the `access.code_deleted` INSERT runs on the transaction handle via
  `auditInTransaction`, so a failed audit aborts the delete. This works because `auth_audit_log` and
  `beta_access_codes` share the `afldb_auth` role; it needs no second pool and no migration-066
  equivalent.
- **No secret in the trail** — detail is `{ codeId, label, reason, revokedAt, useCount, maxUses }`.
  Only the sha256 of the code was ever stored, and it leaves with the row.
- **No id oracle** — "not retired", "never existed" and "already deleted" all return the same
  message.

---

## 4. Verification

### 4.1 Done on `claude/issue-117`, 2026-09-06 — DB-free, all green

Run from `D:\dev\afldb-issue-117` (a fresh worktree has no `node_modules`; this one has a junction
to `D:\dev\afldb\node_modules`).

| Command | Result |
|---|---|
| `npx vitest run tests/admin-access-actions.test.ts` | **PASS — 1 file, 13/13**, 0 failures, 0 skips |
| `npx tsc --noEmit` | **PASS — exit 0**, repo-wide |
| `npx eslint` on the six touched TypeScript files | **PASS — exit 0** |

### 4.2 Outstanding — the DB-backed half, operator-run

These need `AFLDB_TEST_DATABASE_URL` pointing at `afldb_test`, **and need migration `091` applied to
that database first**, or the privileges assertion fails for the right reason in the wrong place.

```
npm run db:migrate:test
npx vitest run tests/integration/access-codes.test.ts tests/integration/privileges.test.ts
```

**Result 2026-09-06: `access-codes.test.ts` PASSED 8/8.**

`privileges.test.ts` does **not** reach 30/30 on current `main`, and the shortfall is **not** this
issue's. One case — `writes exactly the tables the registry allows, and no others` — fails on
`external_grids` and `external_grid_axes` reporting `WRITABLE BUT NOT REGISTERED`. That is
**`AFLDB-ISSUE-138`**, open since 2026-09-05, and it is a stale *test*, not a privilege defect:
`src/db/migrations/080_external_grids.sql:219-251` deliberately withholds registration (because
`grant_import_write()` would hand out UPDATE/DELETE/TRUNCATE and `privileges.sql` would regenerate
them every reconcile, so the captured corpus would stop being immutable) and hand-grants
`SELECT, INSERT` plus a column-scoped `UPDATE (is_current)`; `tools/maintenance/privileges.sql:360-371`
re-grants exactly that set. The test's table-level INSERT probe treats INSERT as proof of
registration and its exception list (`data_edits`, `player_link_resolutions`,
`canonical_applications`) was never extended to this fifth, deliberate exception class.

**The ISSUE-117 assertion in that file is a different case** — `afldb_auth is confined to the
operational tables`, which now includes `('beta_access_codes', 'DELETE')`. That case must pass; the
ISSUE-138 failure above must be present before AND after this branch. Confirm both, then treat the
suite as clear for this issue's purposes. Do not "fix" the ISSUE-138 failure here.

Otherwise, neither integration file's assertions changed in the reconciliation — only the
migration's number and the comment naming it.

**A fresh worktree has neither `node_modules` nor `.env`.** Both are per-checkout; `.env` is
gitignored, so it is never carried over by `git worktree add`, and `tests/integration/guard.ts`
stops every integration suite before it opens a connection without it. The established practice is
to copy one from a worktree using the **live 55432 tunnel** (`D:\dev\afldb-issue-110` is the known
good source) — the main checkout and older worktrees still name `127.0.0.1:5432`, which is not
listening and looks like a database outage.

### 4.3 The brief's requirements, and what covers each

| # | Brief's requirement | Covered by |
|---|---|---|
| 1 | an active key cannot be deleted | unit: `will not delete an active unused code…` (asserts **both** predicate limbs are in the SQL) + integration: `refuses an active unused code and leaves it in place` |
| 2 | a revoked key can be deleted | integration: `deletes a revoked code and reports what it removed` |
| 1a | a **spent** key can be deleted directly (§5) | unit: `deletes a SPENT code that was never revoked, with no revoke first` (also asserts no UPDATE was issued) + integration: `deletes a SPENT code that was never revoked` |
| 1b | a **partly used** key is still refused (§5) | integration: `refuses a PARTLY USED code, which can still be redeemed` |
| 1c | an **unlimited** key is never spent (§5) | integration: `refuses an UNLIMITED code however many times it has been used` — the NULL-comparison case only real PostgreSQL settles |
| 1d | both limbs true at once behaves (§5) | integration: `deletes a code that is both revoked and spent, reporting it as revoked` |
| 3 | the deleted row no longer appears in the list | integration, same test — the row count for that id is 0, and `page.tsx` selects with no state filter, so absence from the table is absence from the UI. Plus unit: `revalidates /admin/access…` |
| 4 | deletion records the expected audit event | unit: `writes access.code_deleted naming what was destroyed, and no secret`, plus `records a spent deletion as spent, with a null revocation time` |
| 5 | a forged/direct request cannot delete an active key | integration: the three `refuses …` cases all call the query function directly, with no UI in the way |
| 6 | an unknown/already-deleted id fails cleanly | unit: `gives an unknown id the same answer as a still-redeemable one`; integration: `fails cleanly on an id that does not exist` |
| 7 | revoke behaviour unchanged | unit: `revoking is unchanged by the delete path` (still a one-shot UPDATE on the pool, same predicate, same audit call, and `auditInTransaction` not used) |
| 8 | auth/authz intact | unit: `requires an admin session before any statement runs` |
| — | the audit is transactional, not best-effort | unit: `audits inside the deleting transaction, not after it` — asserts the handle **and** that the pooled `audit()` is not used (§8.2) |
| — | the role can actually delete | `tests/integration/privileges.test.ts` |
| — | the statement deletes exactly one row | integration: `touches only the code it was given` — catches a lost `id =` predicate, which every per-row assertion above would miss |

---

## 5. Manual dev validation, and the rule it widened

**Manual validation on dev passed for Active → Revoke → Delete** on 2026-08-31 (round-1 code, from
`claude/issue-116`; `afldb_dev` already carried the migration and the reconciled `afldb_auth`
DELETE grant).

It also confirmed the gap the runbook had recorded as deliberate: a **spent** code —
`use_count >= max_uses` — was undeletable. Worse, it was *undisposable*: the admin table offers
Revoke only in the `live` state, so a spent code could be neither revoked nor deleted and simply
accumulated. The operator's requirement is that a spent code be deletable **directly**, without a
revoke that changes nothing.

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
`redeemBetaCode` would refuse the code. That query redeems only when `revoked_at IS NULL AND
(expires_at IS NULL OR expires_at > now()) AND (max_uses IS NULL OR use_count < max_uses)`. So
"revoked or spent" is a **strict subset of "not redeemable"**, and a code that could still let
somebody in can never be deleted. Widening the delete rule did not widen the set of live codes at
risk by one row.

Two boundaries follow from that and are both tested:

- **Partly used stays refused.** Two of five uses spent still leaves three admissions. Deleting it
  would be a silent revoke with no revocation record.
- **Unlimited is never spent.** `max_uses IS NULL` makes `use_count >= max_uses` evaluate to NULL,
  not true, so an unlimited code stays deletable only by revoking it first — exactly what migration
  036 means by "unlimited means uncapped, not unrevocable". This is the one case where only
  PostgreSQL's real three-valued logic settles the answer, which is why it is an integration test.

### Still deliberately excluded: expiry

An **expired** code is unredeemable too, but is **not** deletable. Expiry is a moving line —
`expires_at` passes on its own, with nobody deciding anything — and deletion is irreversible.
Admitting it would mean rows becoming destroyable through the passage of time rather than an act.
That is a deliberate product decision, not an oversight; it is a one-limb change to
`deleteRetiredAccessCode` if it is ever wanted. Note the consequence, unchanged: an expired, unspent
code is offered neither Revoke (the UI shows it only when `live`) nor Delete, so it still cannot be
disposed of. **Operator decision; not taken here.**

---

## 6. Deploy order — load-bearing

The code fails closed without the grant, so the grant goes first.

1. Apply **migration 091** to the target database (`npm run db:migrate` for dev).
2. Run **`tools/maintenance/privileges.sql`** against the same database (`npm run db:privileges`).
   Skipping this does not break the deploy today, but the next restore or reconcile revokes the
   grant and deletion starts failing with a permission error that looks like a code bug.
3. **Then** deploy the application code.

Reversed, every Delete returns a permission error and the audit trail records nothing, because the
transaction aborts before the audit INSERT.

Dev before prod, per the usual practice — deploy to dev, let the operator exercise
Revoke → Delete on a real code in `/admin/access`, and only then consider prod.

**On `afldb_dev` specifically:** the grant is already present (applied on 2026-08-31 as `079`), so
step 1 is a no-op in effect — `GRANT` is idempotent — but it should still be run so the ledger
records `091`. Step 2 matters more than usual: `main`'s `privileges.sql` did **not** carry the
DELETE until this merge, so any `db:privileges` run against `afldb_dev` from `main` since
2026-08-31 will have **revoked** the grant, and deletion on dev will be failing closed right now.

---

## 7. Status and evidence log

### 2026-09-06 — reconciliation onto `main` (`claude/issue-117`)

| Item | State |
|---|---|
| Migration renumbered `079` → `091` | done (§8.1); `091` confirmed free across every ref and every worktree |
| `src/lib/auth/session.ts` change dropped as superseded | done (§8.2) |
| `npx vitest run tests/admin-access-actions.test.ts` | **PASS — 13/13** |
| `npx tsc --noEmit` | **PASS — exit 0** |
| `npx eslint` (six touched files) | **PASS — exit 0** |
| `npm run db:migrate:test` + the two integration suites | **NOT RUN — outstanding** (§4.2) |
| Merge to `main` | **NOT DONE** |
| Deployed anywhere | **NO** |
| Prod | **untouched** |
| Any database contacted this session | **none** |

### 2026-08-31 — original implementation (`claude/issue-116` @ `2344ab5`, superseded)

Round 1 covered the revoked-only implementation; round 2 the revoked-or-spent widening.

| Command | Result |
|---|---|
| `npx vitest run tests/admin-access-actions.test.ts` | PASS — 13/13 (round 1: 11/11) |
| `npx vitest run tests/integration/access-codes.test.ts` | PASS — 8/8 (round 1: 4/4) |
| `npx vitest run tests/integration/privileges.test.ts` | PASS — 30/30 |
| `npx tsc --noEmit` | PASS after the `postgres.ISql` fix recorded below |
| Manual dev validation, Active → Revoke → Delete | **PASS** — and produced the §5 finding |
| Post-run state check on `afldb_test` | clean — `leaked_fixture_rows = 0` |

**Round 2 total: 51/51 across 3 files.** The §5 widening was committed as `2344ab5` but was
**never deployed to dev** — dev ran the round-1 code, which still refuses to delete a spent key. So
the spent-key behaviour has **never been confirmed by hand on a real host**; that remains the one
genuinely missing piece of evidence, and it is step 4 of §9.

### The one real defect found in the original validation, and its fix

`npx tsc --noEmit` initially failed, in this change:

```
src/lib/auth/session.ts:357:9 - error TS2322
Type 'Sql<{}> | TransactionSql<{}>' is not assignable to type 'Sql<{}>'.
```

**Cause — a wrong assumption, not a typo.** The write handle had been annotated `typeof authSql` on
the belief that `TransactionSql` extends `Sql`. It does not. In postgres.js 3.4.9 `Sql` and
`TransactionSql` are **siblings**: both extend `ISql`, and `TransactionSql` deliberately omits the
pool-level members — `END`, `CLOSE`, `options`, `reserve`, and `begin` itself — precisely so a
transaction handle cannot close the pool or open a nested connection. **Fix:** annotate the handle
as the shared base, `postgres.ISql`. Ordinary widening — no cast, no `any`, no suppression.

That finding is now of historical interest only: `main` reached the same conclusion independently
in `AFLDB-ISSUE-119`, and this issue no longer touches `session.ts` at all (§8.2).

---

## 8. The 2026-09-06 lineage reconciliation

The 2026-08-31 implementation could not merge as written. Two things were wrong with it *relative to
`main`*, and neither is a defect in the original work.

### 8.1 Migration number: `079` → `091`

`main` owns `src/db/migrations/079_nl_search_log_head_to_head_grain.sql`, applied everywhere
including production. The ISSUE-117 migration cannot merge at that number.

**`091` claimed, after the scan `IssuesIndex.md`'s allocation rule requires.** Two unions were
taken:

- every local and remote ref — `git for-each-ref refs/heads refs/remotes` → `git ls-tree -r`
  over `src/db/migrations` → sorted unique. Stops at `090`.
- every sibling worktree's `src/db/migrations/*.sql` on disk, which is the case that catches an
  **uncommitted** claim — the way ISSUE-122's `083` was once invisible to other branches. Also
  stops at `090`.

The only collision anywhere in the repository is the duplicated `079`. **`091` is now taken; the
next free migration number is `092`,** and any other branch must still re-scan before claiming it.

The SQL is byte-unchanged apart from the header line and an added numbering note. Every reference
was updated: `tools/maintenance/privileges.sql` (`-- 023, 091`),
`tests/integration/privileges.test.ts`, and the doc comment in `src/db/queries/access-codes.ts`.

### 8.2 `src/lib/auth/session.ts`: dropped, superseded by AFLDB-ISSUE-119

The original gave `audit()` an optional 4th transaction argument, typed `postgres.ISql`.
`AFLDB-ISSUE-119` §8/§9 has since refactored that file into a shared
`insertAuditRow(sql: postgres.ISql, …)` behind two exported forms — `audit(action, detail, actor)`
on the pool and **`auditInTransaction(tx, action, detail, actor)`** on a caller's handle — arriving
independently at the identical `postgres.ISql` conclusion.

So the change is not merely conflicting, it is **unnecessary**: `deleteAccessCode` calls
`auditInTransaction`, `session.ts` is untouched, and the atomicity guarantee is unchanged. The unit
suite was adapted (the handle is now argument 0, not 3) and **strengthened**: it additionally
asserts the pooled `audit()` is *not* called on the delete path, because substituting it would
still satisfy the "an audit row was written" assertion while silently dropping the guarantee.

Everything else applied unchanged — `main` still holds `AccessManager.tsx`, `actions.ts`,
`globals.css`, `privileges.sql` and `privileges.test.ts` at the shape the original branch diffed
against.

### 8.3 What this does NOT fix: `afldb_dev`'s orphan ledger row

`afldb_dev` has `079_access_code_delete.sql` **applied**, from the original branch. Renumbering
cannot remove that row. The arithmetic after this merge:

- **Forward migration is safe.** `tools/db/migrate.ts:192` computes pending as *files not in the
  ledger*, so an applied row with no file is ignored — the runner does not refuse. Applying `091`
  to `afldb_dev` is additionally safe because `GRANT` is idempotent.
- **Parity still fails.** `tools/db/promotion-check.ts:366` computes `unknown` as *applied names not
  in files*, and any non-empty `unknown` FAILS the gate. After applying `091`, `afldb_dev` holds 92
  applied rows against 91 files and still reports `UNKNOWN 079_access_code_delete.sql`.

**Merging this issue therefore does not clear `AFLDB-ISSUE-139`'s `pre-cutover` parity refusal, and
nothing here tries to.** That refusal is truthful and stays exactly as `AFLDB-ISSUE-142` Finding C
decided: the checker is not weakened, no ledger row is edited or deleted, and **the promotion itself
is the reconciliation** — the candidate is built from the checkout's migrations, so `restored`,
`candidate` and `production` all read parity clean and the orphan row is gone at the swap.

What this merge *does* change for ISSUE-139 is that the candidate is now built **with** the grant.
Before it, `main`'s `privileges.sql` lacked the DELETE, and the subtractive reconciler would have
revoked a grant `afldb_dev`'s admin UI depends on.

Three things could clear the orphan row. **None is taken here:**

1. the promotion (decided, above);
2. an operator-approved direct `DELETE` of that ledger row — which the brief for this work
   explicitly forbids, and which would be a manual ledger edit;
3. a tracked forward reconciliation migration carrying a guarded delete of that one row, a no-op on
   `afldb_test` and production where it never existed. **No such mechanism is defined in the
   repository today**; adopting one is an operator decision, not an improvisation, and it would need
   its own issue.

---

## 9. Exact next action

1. **Operator, on `afldb_test`:** `npm run db:migrate:test` (applies `091`), then
   `npx vitest run tests/integration/access-codes.test.ts tests/integration/privileges.test.ts`.
   Expect 8/8 and 30/30. See §4.2 for the `.env`/tunnel prerequisite.
2. **Merge** `claude/issue-117` into `main`. Expect text conflicts in `CHANGELOG.md`, `issues.md`
   and `IssuesIndex.md` against the uncommitted `AFLDB-ISSUE-142` work in the `main` working tree —
   take ISSUE-142's corrected open-issue count and add `-117`. The code files do not overlap.
3. **Deploy to dev in §6's order** — migration `091`, then `db:privileges`, then the code. Note §6's
   warning: any `db:privileges` run against `afldb_dev` from `main` since 2026-08-31 will have
   revoked the grant, so step 2 is not optional there.
4. **Confirm all four states by hand** on `/admin/access`: a spent key offers **Delete** with no
   revoke first; a revoked key still offers Delete; an active unused key offers **Revoke only**; a
   partly-used key likewise offers Revoke only. **This is the one piece of evidence the original
   branch never captured** — dev only ever ran the pre-widening code.
5. **Then resolve:** `issues.md` + `IssuesIndex.md`, and move this file to `issues/closed/`.

**Not resolved.** No database of any kind was contacted on 2026-09-06, nothing was merged or
deployed, and production is untouched.
