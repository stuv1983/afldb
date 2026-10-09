# AFLDB-ISSUE-270 — A delegated admin manager can take over a peer admin account through a spare invite

## 0. Status

- **Status:** Open (2026-10-08). **Implemented 2026-10-09 in `sonnet/issue-270` (worktree `afldb-issue-270`, base
  `4fe93a96`); revised the same day for operator decision D-270-2 (§18), then for the independent review's findings
  (§19: 5 s statement timeout, tracked background transactions, doc corrections, integration-harness deadline
  correction); uncommitted, not deployed. Operator validation is COMPLETE for the working tree (§19.9):** unit file
  199/199 (19:59:08 AEDT), typecheck, four-file ESLint and diff check (re-passed after the final harness correction),
  and the whole `tests/integration/admin-lifecycle.test.ts` 37/37 on `afldb_test` as `afldb_owner` (from 20:57:05 AEDT).
  **Review, commit, `merge:ready`, merge, DEV/PROD deployment and acceptance are outstanding.** Earlier "unvalidated" /
  "not run" statements in §17–§19.8 are kept as the historical record of the time they were written; §19.9 supersedes
  them on the validation question. §1–§16 below are the review's record, kept as historical; where §13 and §17 differ,
  §17 governs (§17.3); where §17 and §18 differ, §18 governs; where §18 and §19 differ, §19 governs.
- **Severity:** Medium. **Area:** authentication / administrator lifecycle.
- **Key files:** `src/app/admin/invite/[token]/actions.ts` (`confirmEnrolment`), `src/app/admin/admins/invite-actions.ts` (`createInvite`).
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-005; partition note R1a-F01). The orchestrator re-read the cited lines and confirmed them.
- **Classification:** code-proven.

## 1. Summary

A delegated manager (an `admin` with `can_manage_admins`) may invite only a non-existent account or a contributor, never a peer. That rule is checked only when the invite is created. At redemption, `confirmEnrolment` refuses only when the existing account outranks the invite, so an existing `admin` against an `admin` invite passes. The upsert then overwrites the existing account's password and TOTP secret and revokes all of its sessions.

## 2. Evidence

- `src/app/admin/admins/invite-actions.ts:57-77`: the issuance-time check only. The comment states the takeover property and that "only a delegated manager is constrained here".
- `src/app/admin/invite/[token]/actions.ts`:
  - `:148-162`: redemption refuses only `ROLE_RANK[existing.role] > ROLE_RANK[invite.role]`.
  - `:164-182`: `ON CONFLICT (email) DO UPDATE SET password_hash, totp_secret, can_manage_admins = false, …, disabled_at = NULL`.
  - `:184-187`: every session of the account is revoked.
- `src/db/migrations/030_admin_invites.sql:15-41`: only `token_hash` is UNIQUE. There is no uniqueness for live invites per email.
- `invite-actions.ts:90-95`: the raw invite link is shown to its creator.
- The rule elsewhere: `password-actions.ts:65-73` and `admins/actions.ts:53-57` re-derive the delegated rule from the target's current role.

## 3. Trigger

1. Delegated manager M creates invite I1 for `alice@x` while no account exists. M creates a second invite I2 for the same email; this is also allowed.
2. Alice accepts I1 and becomes an `admin`.
3. M redeems I2 with M's own password and authenticator.

The same outcome follows when a super admin independently creates Alice's account while one of M's invites is still live.

## 4. Expected invariant

A delegated manager may invite, reset or revoke a contributor, never a peer. The rule must hold when the credentials are actually overwritten, which is at redemption.

## 5. Actual behaviour

M signs in as Alice, and Alice's credentials stop working. The audit shows `admin.invite_accepted` labelled with Alice's email, indistinguishable from Alice's own enrolment.

## 6. First wrong layer

`src/app/admin/invite/[token]/actions.ts:156-162`.

## 7. Impact

- Horizontal account takeover of a peer administrator by a semi-trusted insider.
- Actions taken afterwards are attributed to the victim.
- No vertical escalation: an invite from a delegated issuer is forced to `admin`, and a `super_admin` target outranks it.

## 8. Reproduction / witness

Not executed. A DB-free witness using the `tests/auth.test.ts` seams (`inviteRow`, `poolQueries`, a stubbed `postgres` default export) is described in `D:\tmp\review-20261008-full\areas\R1a.md` (W-R1a-01).

## 9. Disproof attempts

- There is no partial unique index on live invites (migrations 030/033/041/071).
- `loadLiveInvite` does not consult the inviter's current role.
- Demoting M does not invalidate M's outstanding invites (`admin-users.ts:287-321`).

## 10. Existing-issue search

- `issues.md` was searched for `invite`, `confirmEnrolment`, `can_manage_admins`, `ROLE_RANK`, `takeover` and `delegated`. The hits concern ISSUE-155/158/186 role and lifecycle work only.
- The 2026-09-17 review judged the auth core clean at `1f64bc12` but did not trace redemption-time peer overwrite.
- Classification: **new**.

## 11. Scope

The redemption-time authorisation in `confirmEnrolment`.

## 12. Out of scope

Super-admin-issued invites used as a credential reset. That is documented intended behaviour (`invite-actions.ts:57-63`).

## 13. Proposed fix boundary

- Inside the `FOR UPDATE` block, refuse when an `auth_users` row exists at the email and the invite's `invited_by` is not currently a `super_admin`. Audit `admin.invite_rejected`.
- Optionally add a partial unique index on live invites per email, or revoke a delegated manager's outstanding invites when the delegation is removed.

> **Correction (2026-10-09, §17.3).** The first bullet is too broad: refusing whenever *any* `auth_users` row exists at
> the email would also refuse a delegated manager's invite to an existing contributor, which `createInvite` deliberately
> allows. The implemented boundary refuses an existing `admin` or `super_admin` only. The optional second bullet was not
> implemented (D-270-1, D-270-2).

## 14. Proposed validation

- DB-free: extend the invite tests in `tests/auth.test.ts`:
  - an invite from a delegated issuer against an existing `admin` row → refusal and no `INSERT INTO auth_users`;
  - the same invite issued by a super admin → proceeds.

## 15. Decisions / unresolved questions

- D-270-1 (operator): whether to also add the live-invite uniqueness index (a migration).
- D-270-2 (operator; added 2026-10-09, §17.8): whether an issuer's lost authority should also stop their outstanding
  invites from enrolling a free address or an existing contributor. ~~Undecided; behaviour unchanged.~~ **DECIDED by the
  operator 2026-10-09: enforce the issuer's current authority for every redemption, including enrolment at a free address
  or over a contributor.** Implemented in §18. No bulk revocation and no migration.

## 16. Next action

Code fix plus DB-free tests. Then D-270-1.

*Superseded 2026-10-09:* the code fix and tests are written (§17). Next: operator runs §17.7, reviews and commits.
D-270-1 and D-270-2 are separate decisions, not merge gates.

*Superseded again 2026-10-09 (§18):* D-270-2 is decided and implemented. Next: operator runs §18.8 in order (unit file,
typecheck, lint, diff check, integration file), reviews and commits. D-270-1 remains undecided and is not a merge gate.

*Superseded again 2026-10-09 (§19):* §18.8's DB-free steps passed at 19:32:44 AEDT against the §18 code. The §19
revision (timeout, tracked background transactions, docs) followed. Next: operator runs §19.7 in order (unit file,
expected 199; typecheck; lint; diff check; integration file), reviews and commits. Follow-ups in §19.6 are not merge
gates. The ISSUE-265 PROD hold is unaffected.

*Superseded again 2026-10-09 (§19.9):* §19.7 steps 1–3 have been run and passed (unit 199/199; typecheck, lint and diff
check, repeated after the §19.8 correction; integration file 37/37). Next: operator reviews and commits the validated
tree, then `npm run merge:ready -- --issue 270` against freshly updated refs, fast-forward `main` and push `main`, DEV
deployment with smoke and recorded DEV acceptance. The issue then stays open: PROD installation and any applicable
acceptance remain outstanding behind the unchanged ISSUE-265 hold, and it closes only after that is complete.
D-270-1 remains undecided and is not a merge gate.

## 17. Implementation record (2026-10-09)

Worktree `D:\dev\afldb-issue-270`, branch `sonnet/issue-270`, base `4fe93a96`. Files read and edited only. No test,
typecheck, lint, Git, database, host or network operation was run by the implementer; nothing below is validated.
Not staged, not committed, not deployed.

> **Revised 2026-10-09 (§18).** §18 supersedes: the rule table in §17.2 (issuer authority now applies to every
> redemption), the lock-ordering paragraph of §17.4 (its claim that a later-visible row has a higher id than the issuer
> is withdrawn), the reason names in §17.5 (`issuer_not_authorised` is now `target_requires_super_admin`, and four
> authority reasons are added), the counts in §17.6, the commands in §17.7 and D-270-2 in §17.8.

### 17.1 Changed files

| File | Change |
|---|---|
| `src/db/queries/admin-invites.ts` | **New.** The redemption transaction body `redeemInviteInTransaction` and the pure rule (`issuerMayResetAdministrators`, `overwriteRefusal`, `overwritableRoles`); test-only `afterLock` hook. |
| `src/app/admin/invite/[token]/actions.ts` | `loadLiveInvite` also reads `invited_by`; `confirmEnrolment` runs the transaction through the new module and audits a refusal with its reason. |
| `tests/auth.test.ts` | Mock of the raw `postgres` package for the dedicated transaction connection; twelve DB-free cases (§17.6). The ISSUE-186 contributor-invite case now also asserts the connection is never opened. |
| `tests/integration/admin-lifecycle.test.ts` | Eleven real-PostgreSQL cases (§17.6); invite fixtures cleaned up by id; `waitForBlock` moved to file scope unchanged. |
| `docs/admin-and-beta.md` | "Inviting a new admin": the acceptance-time rule. |
| `issues.md`, `IssuesIndex.md`, `CHANGELOG.md`, `blockers.md`, this runbook | Tracking. |

### 17.2 The rule

At redemption, against the account at the invite's email and the issuer (`admin_invites.invited_by`, read from the
stored invite row, never from the form) as they stand now:

| Existing account at the email | Issuer now an enabled `super_admin` | Issuer anything else (delegated admin, demoted, deactivated) |
|---|---|---|
| none | enrol (unchanged) | enrol (unchanged; see D-270-2) |
| `contributor` | overwrite (unchanged) | overwrite (unchanged; see D-270-2) |
| `admin` | overwrite: intended credential reset (unchanged) | **refuse, `issuer_not_authorised`** (was: overwrite) |
| `super_admin`, `super_admin` invite | overwrite (unchanged) | **refuse, `issuer_not_authorised`** (was: overwrite) |
| `super_admin`, `admin` invite | refuse, `outranked` (unchanged) | refuse, `outranked` (unchanged) |

"Current authority" is the reading `canActOnLifecycle` uses: `role = 'super_admin'` and `disabled_at IS NULL`. Outranking
is checked first, so the established refusal keeps its message and audit shape. The rule is one pure function
(`overwriteRefusal`); `overwritableRoles` is derived from it, so the pre-check and the SQL guard cannot disagree.

### 17.3 Correction to §13

§13's "refuse when an `auth_users` row exists at the email and the issuer is not currently a super admin" would refuse a
delegated manager's invite to an existing contributor, which `createInvite` (`invite-actions.ts:64-77`) deliberately
allows and `password-actions.ts` mirrors. The implemented refusal covers existing `admin`/`super_admin` rows only.

### 17.4 SQL and concurrency

Inside the one transaction `confirmEnrolment` opens on its dedicated connection (READ COMMITTED, the server default):

1. **Lock.** `SELECT id, email, role, disabled_at FROM auth_users WHERE id = $invitedBy OR email = $email ORDER BY id
   FOR UPDATE`. Rows are locked in id order (ORDER BY is applied before the row locks), the same order
   `runLifecycleSteps` uses. The issuer row is held until commit, so a demotion or deactivation of the issuer by any
   writer (lifecycle, `create-admin.ts`, direct SQL) waits; an authorised reset completes under the authority it read.
   An existing target is judged here and refused before anything is written.
2. **Guarded write.** `INSERT … ON CONFLICT (email) DO UPDATE SET … WHERE auth_users.role = ANY($overwritable::text[])
   RETURNING id`. When the address was free at step 1, there is no row lock to hold, and another writer may create it
   afterwards. On conflict PostgreSQL waits for an uncommitted inserter to finish, takes the conflicting row's lock and
   evaluates the `WHERE` against that row's latest committed version, so the check and the write are one atomic step,
   whatever lock discipline the other writer used. A rejected row is not updated (it stays locked by this transaction),
   `RETURNING` yields nothing, and a fresh read names the refusal. A row that cannot then be read raises
   (`AFLDB_INVITE_REDEMPTION_TARGET_VANISHED`), rolling back; `afldb_auth` has no DELETE on `auth_users`, so this is
   defensive only.
3. **Success only:** revoke the target's sessions, mark the invite used and clear its pending credentials (as before).

**Lock ordering and deadlock.** Only step 2's conflict lock can fall outside step 1's id order, and only for a row created
after step 1. Such a row's id comes from the identity sequence after the issuer's, so a lifecycle transaction touching
both locks the issuer first and queues behind this one rather than holding the new row against it. The password reset,
own-password change and login writers each lock a single `auth_users` row before any `auth_sessions` row; this
transaction also takes every `auth_users` lock before touching sessions or invites. No cycle was found. Were one to
occur (for example an explicitly numbered row), PostgreSQL aborts one transaction and nothing is written by it: a failed
redemption, never an overwrite. **Self-target** (an invite to the issuer's own address): one row matches both predicates
and is locked once; the later upsert updates a row this transaction already holds. **Case variants:** the upsert's
arbiter is `email`; a row differing only in letter case (blocked by `uq_auth_users_email_lower`, migration 044) makes the
INSERT fail with a unique violation rather than overwrite (unchanged behaviour; the app lowercases addresses).

No advisory lock was added, so other account writers need no change.

### 17.5 Refusal

Nothing is written: the account's credentials, role, delegation, `disabled_at`, its sessions and the invite (still
unused, `pending_*` intact) are unchanged. `confirmEnrolment` writes `admin.invite_rejected` (actor label = the invite's
email, as before) with `email`, `role`, `existingRole`, `reason` (`outranked` | `issuer_not_authorised`), `inviteId`,
`invitedBy`, `issuerRole`, `issuerActive`; never a hash, secret or token. It never writes `admin.invite_accepted` and never
redirects on a refusal; it returns the confirm step with an error. Wording: `outranked` keeps the existing message;
`issuer_not_authorised` says only a current super admin's invite can reset an administrator.

### 17.6 Tests written (not run)

DB-free, `tests/auth.test.ts`, describe "invite redemption is authorised at the account write (AFLDB-ISSUE-270)". The
raw `postgres` package is mocked; statements on the transaction are captured; a real TOTP code is generated with
`tests/admin-nav/totp.ts`.

1. The lock statement binds the stored `invited_by` and the email, `ORDER BY id FOR UPDATE`; forged form fields are ignored.
2. Delegated issuer + existing admin: refused, no `INSERT INTO auth_users`, no session/invite update, rejection audit only.
3. Spare invite after its sibling created the admin: first enrols, second refused.
4. Target promoted after issuance: refused.
5. Target created after the lock read: the upsert carries the guarded `WHERE` with `['contributor']` bound; no row back → refused, no success effects.
6. Current super-admin issuer: reset proceeds (`['contributor','admin']` bound), sessions revoked, invite used, `invite_accepted`, redirect.
7. Issuer demoted since issuance: refused (`issuerRole: 'admin'`).
8. Issuer deactivated since issuance: refused (`issuerActive: false`).
9. Delegated issuer + contributor: enrols (`['contributor']`).
10. Delegated issuer + free address: enrols.
11. Higher-role target (super-admin issuer, `admin` invite, `super_admin` target): `outranked`, existing message.
12. The pure rule over every role/issuer pair matches `overwritableRoles`.

Each refusal case asserts: no redirect, no `UPDATE auth_sessions`/`admin_invites`, exactly one audit row
(`admin.invite_rejected`) with the reason, invite id and issuer id, and no pending hash, TOTP secret, raw token or token
hash in its detail.

Real PostgreSQL, `tests/integration/admin-lifecycle.test.ts`, describe "invite redemption cannot overwrite a peer
(AFLDB-ISSUE-270)", driving `redeemInviteInTransaction` on the suite's own connections:

1. Spare invite after its sibling: refused; password, TOTP secret, live session and the spare's `used_at` unchanged.
2. Target promoted after issuance: refused, unchanged.
3. Admin created **and committed** after the lock read (in `afterLock`): refused, the competitor's credentials and session intact.
4. Admin created but **uncommitted** when the upsert arrives: the redemption is proven blocked on the creator (`pg_blocking_pids`) before the creator commits; refused, unchanged.
5. Issuer demoted since issuance: refused, unchanged, session live.
6. Current super admin: reset proceeds, sessions revoked, invite used.
7. Issuer authority held: a demotion of the issuer is proven blocked on the redemption until it commits; the reset uses the authority it read.
8. Self-target super-admin invite completes (no self-deadlock).
9. Delegated + contributor enrols. 10. Delegated + free address enrols. 11. `outranked` refusal preserved.

Fixture safety: `beforeAll` refuses unless `current_database()` ends in `_test` (in addition to `tests/setup.ts` and
`tests/integration/guard.ts`); new addresses are `i270-<uuid>@example.test` and refused if any `auth_users` or
`admin_invites` row already uses one; every created user and invite id is recorded, and the file's `afterEach` deletes
invites, then audit rows, then users by id only. No real administrator is read or written. The helper writes no audit
row, so these cases leave none.

### 17.7 Operator validation (exact commands, PowerShell, from `D:\dev\afldb-issue-270`)

The worktree has no `node_modules` (and must not get a copied `.env`); install first if not already done:

```powershell
npm ci
```

1. DB-free (no database needed):

```powershell
npx vitest run tests/auth.test.ts
```

2. Typecheck and lint of the changed files:

```powershell
npm run typecheck
npx eslint "src/db/queries/admin-invites.ts" "src/app/admin/invite/[token]/actions.ts" "tests/auth.test.ts" "tests/integration/admin-lifecycle.test.ts"
```

3. Real PostgreSQL (the whole file, because the shared `waitForBlock` helper moved), against `afldb_test` through the
   usual tunnel, as the test owner:

```powershell
$env:AFLDB_TEST_DATABASE_URL = '<afldb_test owner DSN>'
npx vitest run tests/integration/admin-lifecycle.test.ts
Remove-Item Env:AFLDB_TEST_DATABASE_URL
```

Return the summaries (pass/fail counts and any failure text). A residue check after step 3, if wanted:
`SELECT count(*) FROM auth_users WHERE email LIKE 'i270-%@example.test'` and the same on `admin_invites` (both expected 0).

### 17.8 Policy questions recorded, not changed

- **D-270-2.** The current-authority rule governs only the overwrite of an existing administrator, as scoped. An issuer's
  outstanding invites otherwise keep working after the issuer loses authority: a delegated manager whose
  `can_manage_admins` was removed, or a deactivated issuer, can still have an invite enrol a free address or overwrite a
  contributor; and a super admin demoted since issuing a **`super_admin`** invite can still have it create a **new**
  super admin at a free address. Whether redemption should require the issuer's current authority for those too (or
  demotion should revoke invites, ISSUE-270 §13 option 2) is the operator's decision. No change was made.
  **Decided 2026-10-09: enforce current issuer authority on every redemption (§18.1).**
- **Observations, unchanged, no decision requested:** an overwrite clears `disabled_at`, so a permitted reset also
  reactivates a deactivated account (a super admin's invite for an admin; any invite for a contributor); `loadLiveInvite`
  checks liveness before the transaction, so an invite revoked during its own redemption can still be used (pre-existing);
  a delegated manager can no longer re-enrol their own admin account through an invite (createInvite already refused to
  issue one).

### 17.9 Validation limits

- Nothing has been run. The DB-free cases prove decisions and statement shape against a fake transaction; they do not
  prove PostgreSQL's `ON CONFLICT … WHERE` behaviour, which only the integration cases (3, 4, 7) exercise.
- The integration cases run as the `afldb_test` owner, not `afldb_auth`, so restricted-role permissions are not
  exercised (no new privilege is needed: the statements use SELECT … FOR UPDATE, INSERT and UPDATE on `auth_users`,
  `auth_sessions` and `admin_invites`, which `afldb_auth` already holds). Whether the owner DSN may DELETE
  `admin_invites` for cleanup is assumed from the suite's existing `auth_users` deletes, not verified.
- No browser or DEV check; no UI change (only the error text of a refusal).
- No historical misuse was searched for. Whether any past `admin.invite_accepted` was a takeover is not assessed;
  nothing was repaired.

## 18. Revision for D-270-2, concurrency wording and harness (2026-10-09)

Same worktree and branch. Files read and edited only; no command, test, Git, database, host or network operation was
run by the implementer. Not staged, not committed, not deployed. **Nothing in this section is validated.**

### 18.1 Operator decision D-270-2 (recorded)

The operator selected: **enforce the issuer's current authority for every redemption, including enrolment at a free
address or over a contributor.** No bulk revocation of outstanding invites and no migration. D-270-1 (live-invite
uniqueness index) remains **undecided**.

### 18.2 The rules, as implemented

Both are decided inside the redemption transaction, under the issuer lock, from fields of the **locked** `auth_users`
rows (`role`, `can_manage_admins`, `disabled_at`); the issuer is still the stored `admin_invites.invited_by`.

**Rule 1, issuer authority (every redemption), `issuerAuthorityRefusal`:**

| Issuer, as locked now | May authorise | Otherwise |
|---|---|---|
| no row | nothing | `issuer_missing` |
| `disabled_at` set (any role) | nothing | `issuer_deactivated` |
| enabled contributor (with or without the flag), or enabled `admin` without `can_manage_admins` | nothing | `issuer_not_admin_manager` |
| enabled `admin` with `can_manage_admins` | an ordinary `admin` invite without the delegation | `grant_exceeds_issuer` for a `super_admin` invite or one carrying `can_manage_admins` |
| enabled `super_admin` | `admin` or `super_admin`, with or without the delegation | — |

"May manage admins" is `hasCapability(issuer, 'people.admins.manage')` (`src/lib/auth/capabilities.ts`), the policy
`createInvite` is guarded by. The capability table has no entry for "may grant `super_admin` or the delegation";
`createInvite` draws that line by role (`invite-actions.ts:47-55`), and rule 1 draws the same line. Both the invited
role and the invited delegation are checked.

**Rule 2, target protection (unchanged in substance), asked only after rule 1 passes:** an account that outranks the
invite is refused (`outranked`); an existing `admin` or `super_admin` is overwritten only when the issuer is an enabled
`super_admin` (`target_requires_super_admin`, formerly `issuer_not_authorised`); an existing contributor or a free address
may be enrolled by any issuer rule 1 accepts. So a delegated manager with current authority still enrols a free address
or a contributor as an ordinary admin, and a current super admin still resets an administrator.

Order: rule 1 first ("no authority, no write of any kind"), then rule 2 against the account the lock read could see,
then the guarded upsert (§18.3) against a row it could not. A refusal at any point returns before any write.

### 18.3 Concurrency (replaces §17.4's lock-ordering paragraph)

- **Rows visible to the initial read.** One `SELECT … WHERE id = $issuer OR email = $email ORDER BY id FOR UPDATE`
  locks the issuer and any visible target in id order, the order `runLifecycleSteps` uses for the rows it locks. The
  issuer row is held to commit, so a demotion, deactivation or delegation change of the issuer by any writer waits, and
  rule 1's answer cannot go stale part-way through.
- **The additional conflict lock.** A row invisible to that read (committed after its snapshot, or still uncommitted)
  can hold the address by the time of the upsert. `ON CONFLICT (email) DO UPDATE … WHERE auth_users.role =
  ANY(<overwritable>)` waits for an uncommitted inserter, takes that row's lock and evaluates rule 2 on its latest
  committed version; a rejected row is left unchanged and `RETURNING` yields nothing (the refusal). This lock is taken
  **after** the id-ordered locks and **outside** that order. §17.4's claim that such a row "has an id higher than the
  issuer's" is **withdrawn**: identity values are allocated when an insert runs, not when it becomes visible, so no id
  ordering between the issuer and a later-visible row is established. Rule 1 needs no second check here; the issuer row
  is already held.
- **Possible outcomes.** If another transaction holds the conflicting row and then waits for a row this transaction
  holds (for example its still-open creator then locking the issuer), the two wait on each other and PostgreSQL's
  deadlock detector aborts one (SQLSTATE `40P01`). An aborted transaction writes nothing; if it is the redemption, the
  invite stays unused. Other aborts (lost connection, a case-variant unique violation per §17.4, the vanished-target
  guard) behave the same. **No universal deadlock prevention is claimed**; what is claimed is that no outcome overwrites
  an account the rules refuse.
- No advisory lock; other account writers need no change.

### 18.4 Failure handling in `confirmEnrolment`

- Any error from the transaction (including the vanished-target marker) is caught. No redirect, no
  `admin.invite_accepted`; the invitee sees a generic "could not be completed because of a server error" message that
  does not claim nothing changed (a failure during COMMIT leaves the outcome unknown to the process; a retry against a
  committed redemption finds the invite used).
- The server log line carries only the invite id and the SQLSTATE (or the error's name). postgres.js attaches the
  statement and its bound parameters to its errors, and here those include the pending password hash and TOTP secret,
  so neither the error object nor its message is logged or returned.
- `tx.end()` failing after the transaction has finished is ignored: closing the connection cannot change a committed or
  rolled-back outcome, and it can no longer turn a success into a reported failure or vice versa.

### 18.5 Refusal audit and wording

`admin.invite_rejected` now records `email`, `role`, `canManageAdmins` (the invite's), `existingRole` (null when the
address was free), `reason` (one of `issuer_missing`, `issuer_deactivated`, `issuer_not_admin_manager`,
`grant_exceeds_issuer`, `outranked`, `target_requires_super_admin`), `inviteId`, `invitedBy`, `issuerRole`,
`issuerActive`, `issuerCanManageAdmins`; never a hash, secret or token. Wording: the four authority reasons share one
message, valid with or without an existing account ("the administrator who issued it no longer has the authority to
grant this access. Ask a current admin manager or super admin for a new invite."); `outranked` and
`target_requires_super_admin` keep their existing messages.

### 18.6 Changes by file

| File | Change |
|---|---|
| `src/db/queries/admin-invites.ts` | Rule 1 (`issuerAuthorityRefusal`, via `hasCapability`); lock read adds `can_manage_admins`; refusal type widened (`existingRole` nullable, issuer snapshot adds `canManageAdmins`); reason rename; module comment's concurrency section rewritten per §18.3. |
| `src/app/admin/invite/[token]/actions.ts` | Failure handling (§18.4); per-reason messages (`refusalMessage`); audit fields (§18.5). |
| `tests/auth.test.ts` | Mock: lock rows carry `canManageAdmins`; `failOn`/`failWith` failure injection. Cases updated for the rename and for demoted/deactivated issuers (now authority refusals). New: 16 lost-authority cases (8 issuer states × free address and existing contributor: lost delegation, deactivated manager, demoted super admin, deactivated super admin, contributor issuer, missing issuer, stale `super_admin` grant, stale `can_manage_admins` grant), 2 current-super-admin `super_admin`+delegation grants (free, contributor), a database failure (no success, no parameter in the log or state), the vanished-target failure, and the rule-1 matrix against `hasCapability`. The lock-statement case also asserts the issuer fields are read from the locked row. |
| `tests/integration/admin-lifecycle.test.ts` | `current_database()` `_test` preflight moved to a **file-wide** `beforeAll` (before every test in the file, older cases included). `deferred`, `within` (bounded readiness waits) and `withBackground` (releases every barrier and awaits every started transaction and watcher on every path, including a throwing redemption; rejection handlers attached at once; the body's error wins, else the first background failure). The uncommitted-creator case: a creator failure before it announces now fails the readiness wait instead of hanging; its row is owned only after its transaction commits. The issuer-lock case uses the same harness. `redeem` adopts a returned id only when the address was reserved by this run and held no row when the redemption began. Fixture invites stage pending credentials so refusals prove them untouched. Demoted-issuer case now expects `issuer_not_admin_manager`. New: stale `super_admin` grant at a free address, stale `can_manage_admins` grant over a contributor, lost delegation at a free address, deactivated manager over a contributor. |
| `docs/admin-and-beta.md`, `issues.md`, `IssuesIndex.md`, `CHANGELOG.md`, `blockers.md`, this runbook | Tracking. |

Cleanup is still by owned ids only (`createdUserIds`, `createdInviteIds`), never by email prefix.

### 18.7 Evidence so far (precedes this revision)

The operator's run at **18:50:00** on 2026-10-09, against the §17 version: `tests/auth.test.ts` **177/177 passed**;
TypeScript typecheck passed; ESLint over the four files passed; the diff check passed. **These results precede this
revision and do not validate it.** The integration file has not been run for either version.

### 18.8 Operator validation (exact commands, PowerShell, from `D:\dev\afldb-issue-270`)

1. DB-free (expected count 198 = 177 + 21 new cases, if nothing else in the file changed):

```powershell
npx vitest run tests/auth.test.ts
```

2. Typecheck, lint of the changed source and test files, and whitespace check of the working tree:

```powershell
npm run typecheck
npx eslint "src/db/queries/admin-invites.ts" "src/app/admin/invite/[token]/actions.ts" "tests/auth.test.ts" "tests/integration/admin-lifecycle.test.ts"
git diff --check
```

3. Real PostgreSQL, the whole file (the `_test` preflight is now file-wide), against `afldb_test` through the usual
   tunnel, as the test owner:

```powershell
$env:AFLDB_TEST_DATABASE_URL = '<afldb_test owner DSN>'
npx vitest run tests/integration/admin-lifecycle.test.ts
Remove-Item Env:AFLDB_TEST_DATABASE_URL
```

Return the summaries (pass/fail counts and any failure text). Optional residue check after step 3:
`SELECT count(*) FROM auth_users WHERE email LIKE 'i270-%@example.test'` and the same on `admin_invites` (both
expected 0).

### 18.9 Limitations (in addition to §17.9)

- Nothing in this revision has been run. The DB-free cases prove decisions and statement shape against a fake
  transaction; only the integration file exercises PostgreSQL's lock and `ON CONFLICT … WHERE` behaviour.
- Rule 1 has a behaviour consequence by design: every outstanding invite whose issuer has lost the authority to grant it
  (delegation removed, demoted, deactivated) stops working at redemption. None is revoked or rewritten; each is refused
  and audited when used. How many such invites exist on DEV or PROD was not measured.
- Deadlock is possible in the §18.3 interleaving; the integration file does not provoke one, so the abort path is proven
  only DB-free (failure injection), not against PostgreSQL.
- The fixture-ownership rule assumes no writer outside this test file creates a row at a freshly reserved
  `i270-<uuid>` address during a test.
- The integration cases still run as the `afldb_test` owner, not `afldb_auth`.

## 19. Follow-up revision from the independent (Fable) review (2026-10-09)

Same worktree and branch. Files read and edited only; no command, test, Git, database, host or network operation was
run by the implementer, and no subagent was used. Not staged, not committed, not deployed. **Nothing in this section is
validated** (§19.5). *(Historical: as written. The operator has since validated the working tree; see §19.9.)*

### 19.1 Statement timeout on the redemption connection

- `src/db/queries/admin-invites.ts` exports `INVITE_REDEMPTION_STATEMENT_TIMEOUT_MS = 5000`, the same bound
  `src/db/authClient.ts` sets on the pooled auth connections. It lives in the query module, not the `'use server'`
  action module, so the PostgreSQL suite can import it.
- `confirmEnrolment` opens its dedicated connection with `connection: { statement_timeout: … }`. Every statement of the
  redemption is bounded, including the issuer/target `SELECT … FOR UPDATE` lock read and the guarded upsert.
- **Timeout behaviour.** A statement still waiting at 5 s (typically on a row lock another transaction holds on the
  issuer or target) is cancelled by the server with SQLSTATE `57014`. `begin()` rolls the transaction back as a whole,
  so no account, session or invite write survives. The existing catch path handles it like any other database failure:
  no redirect, no `admin.invite_accepted` (and no `admin.invite_rejected`), the generic "server error" message, and a log
  line carrying only the invite id and `57014`, never the error object or its bound parameters.
- The module comment's lock-order paragraph now says a non-deadlock lock wait is bounded by this timeout and ends the
  same way as a deadlock abort.

### 19.2 Tests added for the timeout

- `tests/auth.test.ts`: the `postgres` mock records the options each connection is opened with. New case: the
  dedicated connection is opened once with `max: 1` and `statement_timeout` equal to the constant (5000); a `57014`
  rejection on the lock read gives no redirect, the generic error, no upsert, session or invite statement, no audit row
  at all, and a log line containing `57014` but no hash, secret, token or token hash. The mock does not model rollback;
  that is the integration case's job.
- `tests/integration/admin-lifecycle.test.ts`: a new connection `bounded`, opened with the same `statement_timeout`
  constant and ended in `afterAll`. New case *"times out, writing nothing, while another transaction holds the issuer
  row"*: a current super admin's invite over an existing admin with a live session (a reset that would otherwise
  succeed). A holder transaction on `sql2` locks the issuer row `FOR UPDATE` and waits on a gate; the redemption runs on
  `bounded`, is proven blocked by the holder via `pg_blocking_pids`, and must reject with code `57014` and a "statement
  timeout" message. Afterwards the target's id, role, password hash, TOTP secret and `disabled_at` equal the
  pre-attempt read, its session is still live, the invite is unconsumed with its staged credentials, and the issuer is
  unchanged. The holder is tracked by `withBackground`; its gate is opened after the redemption settles and, on every
  failure path, by `withBackground`'s release, which then awaits it. The case takes about 5 s (the suite's
  `testTimeout` is 30 s).

### 19.3 The older "two super admins" cases: background transactions tracked

Both cases (mutual demotion; the invariant counted under the lock) previously started the second transaction inside the
first's `afterLock` hook without tracking it: if the PID wait, the block wait or the first transaction failed, the
second transaction was never awaited and could still be running when `afterEach` deleted the fixtures, and a second
transaction that failed before announcing its PID left the hook waiting until Vitest's timeout.

- A new helper `startTracked` starts the second transaction on `sql2`, registers it with `withBackground` at once, and
  waits for its PID with `within(…, READY_TIMEOUT_MS, …)`; if the transaction ends or fails before announcing, the
  wait fails immediately.
- Each case now runs entirely inside `withBackground`, which awaits every tracked transaction on every path before the
  case's assertions run and before cleanup. The assertions are unchanged and run after everything has settled, so an
  assertion failure cannot leave a transaction running. If the second transaction was never started, the case fails
  with that message rather than awaiting `undefined`.
- No gate is needed in these two cases: the second transaction is held only by the first's own locks, which end with
  the first transaction on commit or rollback. Fixture creation, ownership (`createAccount` → `createdUserIds`) and
  cleanup are unchanged.

### 19.4 Documentation corrections (`docs/admin-and-beta.md`)

- Removed the claim that a delegated admin manager can invite a contributor. Nobody issues a `contributor`-role invite:
  `createInvite` refuses it for every issuer (`contributor_retired`, AFLDB-ISSUE-186) and acceptance refuses older rows.
  The page now distinguishes issuing an invite (always `admin` or `super_admin`) from redeeming one over an existing
  contributor account (a credential reset that converts it).
- The acceptance steps now state the current TOTP-step behaviour: the update of an existing account writes
  `totp_last_step`, so the enrolment code is burned; the insert of a fresh account does not set it, so that code is not
  burned. Recorded as a known gap (§19.6); behaviour unchanged.
- The failure paragraph now describes the 5 s timeout and its rollback.

### 19.5 Evidence so far (precedes this revision)

The operator's run at **19:32:44 AEDT on 2026-10-09**, against the §18 version (before §19):

| Check | Result |
|---|---|
| `npx vitest run tests/auth.test.ts` | 198/198 passed |
| `npm run typecheck` | passed |
| ESLint: `admin-invites.ts`, invite `actions.ts`, `auth.test.ts`, `admin-lifecycle.test.ts` | passed |
| `git diff --check` | passed |
| `tests/integration/admin-lifecycle.test.ts` | **not run** |

**This evidence precedes the §19 revision and does not validate it.** It is the first recorded run of the §18 code.
The integration file has not been run for any version.

### 19.6 Follow-ups and limitations kept from the review (not implemented here)

Each is out of scope for this pass, by instruction; none is a merge gate unless the operator makes it one.

- **Invite liveness inside the transaction.** `loadLiveInvite` checks `used_at`, `revoked_at` and `expires_at` before
  the transaction, and the redemption does not re-check or lock the invite row, so an invite revoked or expiring during
  its own redemption can still complete (pre-existing; §17.8).
- **Case-insensitive conflict handling.** The upsert's arbiter is the exact `email`; a row differing only in letter case
  collides with `uq_auth_users_email_lower` (migration 044), so the redemption fails with a unique violation (the generic
  server error) instead of a rule-2 decision, and the lock read's `email =` does not see that row (§17.4, §18.3).
- **TOTP step on a fresh account.** The fresh-account insert does not record the enrolment code's step, so that code is
  not burned for the first sign-in (§19.4). Behaviour unchanged.
- **D-270-1, live-invite uniqueness index.** Still undecided; it would be a migration.
- **Bulk revocation** of outstanding invites whose issuer lost authority: not done (D-270-2 chose refusal at redemption
  instead).
- **Validation gaps.** Nothing in §19 has run. The PostgreSQL timeout, rollback and lock-blocking claims are untested
  until the integration file runs. The integration cases run as the `afldb_test` owner, not `afldb_auth`, so the
  restricted role and its connection settings are not exercised. Nothing proves the timeout from the Server Action end
  to end against a database (the unit case proves the option and the failure path; the integration case proves the
  server's behaviour under the same setting). No DEV or browser check. *(Historical: "Nothing in §19 has run" and the
  "untested until the integration file runs" claims are superseded by §19.9; the `afldb_owner`-not-`afldb_auth`,
  no-end-to-end and no-DEV/browser limits still stand.)*

### 19.7 Operator validation (exact commands, PowerShell, from `D:\dev\afldb-issue-270`)

1. DB-free (expected 199 = 198 + 1 new case, if nothing else in the file changed):

```powershell
npx vitest run tests/auth.test.ts
```

2. Typecheck, lint of the changed source and test files, and whitespace check:

```powershell
npm run typecheck
npx eslint "src/db/queries/admin-invites.ts" "src/app/admin/invite/[token]/actions.ts" "tests/auth.test.ts" "tests/integration/admin-lifecycle.test.ts"
git diff --check
```

3. Real PostgreSQL, the whole file, against `afldb_test` through the usual tunnel, as the test owner (the new timeout
   case adds about 5 s):

```powershell
$env:AFLDB_TEST_DATABASE_URL = '<afldb_test owner DSN>'
npx vitest run tests/integration/admin-lifecycle.test.ts
Remove-Item Env:AFLDB_TEST_DATABASE_URL
```

Return the summaries and any failure text. Optional residue check after step 3, as §18.8 (both counts expected 0).
§18.8 is superseded by this section.

### 19.8 Harness correction from the Fable follow-up review (2026-10-09)

Test harness only; no production code or policy changed.

- **Finding.** In the `times out, writing nothing, while another transaction holds the issuer row` case of
  `tests/integration/admin-lifecycle.test.ts`, the wait for the redemption's outcome was an unbounded `await settled`.
  If PostgreSQL never cancelled the blocked read, the case would hang until Vitest's own timeout.
- **Correction.** That wait is now `within(settled, INVITE_REDEMPTION_STATEMENT_TIMEOUT_MS + READY_TIMEOUT_MS, ...)`
  with a diagnostic naming the expected server-side cancellation. On expiry `within` rejects, the body throws,
  `withBackground` runs the release (the holder's gate resolves, so it commits) and awaits every tracked transaction and
  watcher, then rethrows the body's error. Nothing outlives the case into `afterEach`.
- **The server timeout is still the test.** The client-side deadline is a harness safeguard only. The case still
  requires the redemption to settle as a rejection with SQLSTATE `57014` and a `statement timeout` message, so expiry of
  the deadline fails the case and cannot count as passing.
- **Evidence status.** The operator's 19:59:08 checks remain evidence for the preceding tree only. The revised
  integration case has **not been run**; §19.7 step 3 still stands, and the DB-free steps should be repeated for the
  changed test file (typecheck, ESLint, `git diff --check`). *(Historical: as written. §19.9 records those repeats and
  the integration run.)*
- **Left as follow-ups (not gates):** the connect-timeout and the other LOW findings from the review.

### 19.9 Operator validation results (2026-10-09) — validation component COMPLETE

Operator-supplied evidence, recorded as reported; nothing here was re-run by the implementer (documentation-only pass:
no command, Git, test, database, network or host contact).

| # | Check | Result |
|---|---|---|
| 1 | `npx vitest run tests/auth.test.ts` at **19:59:08 AEDT** | **199/199 passed** (the §19.7 expectation) |
| 1 | `npm run typecheck`, four-file ESLint (`admin-invites.ts`, invite `actions.ts`, `auth.test.ts`, `admin-lifecycle.test.ts`), `git diff --check` (same run) | passed |
| 2 | The same typecheck, the same four-file ESLint and `git diff --check`, **after** the §19.8 integration-harness deadline correction (time not supplied) | passed |
| 3 | First integration attempt | stopped **before connecting**: the test DSN was missing from the environment. No database work occurred. |
| 4 | Test DSN | The saved DSN used port 5432. The operator loaded it into the PowerShell environment using tunnel port **55432**, without changing `.env`. A read-only check verified the connection was `afldb_test` as `afldb_owner`. |
| 5 | `npx vitest run tests/integration/admin-lifecycle.test.ts`, whole file, from **20:57:05 AEDT** | **37/37 passed, none skipped**, duration **41.75 s**. Covers all 16 ISSUE-270 cases, the issuer-lock statement-timeout case, concurrent account creation and both existing concurrent lifecycle cases. No hook or cleanup errors reported. |
| 6 | Read-only fixture check on `afldb_test` as `afldb_owner`, afterwards | `i270_users=0`, `i270_invites=0`, `i155_users=0`, `i155_invites=0` |

**Scope of what this shows.**

- The 19:59:08 unit run **preceded** the §19.8 deadline correction. That correction changed only the integration
  harness (`tests/integration/admin-lifecycle.test.ts`); no production code and no auth-unit test changed in it, so the
  199/199 result stands for `tests/auth.test.ts` and the production code. The static checks were repeated after it.
- The 37/37 integration run is the first and only real-PostgreSQL run of this issue's code, and it ran the corrected
  harness. It is evidence for the PostgreSQL behaviour the DB-free cases could not prove: the issuer/target row locks,
  the `ON CONFLICT … WHERE` re-application, the 5 s statement-timeout cancellation and rollback, and the concurrent
  account-creation and lifecycle cases.
- The fixture finding is limited to **the i270 and i155 address patterns and the two tables checked** (users and
  invites). It does not say anything about other tables, other address patterns or other databases.

**What this does not show (unchanged limits).**

- No restricted-role (`afldb_auth`) validation: the integration cases ran as the `afldb_test` owner (`afldb_owner`), so
  the restricted role's grants and connection settings are not exercised.
- No real-database Server Action end-to-end coverage: the unit cases prove the connection option and failure path, the
  integration cases prove the server's behaviour under the same setting, and nothing drives the Server Action itself
  against a database.
- No DEV or PROD deployment, no browser check, and no acceptance.
- No historical-misuse assessment: nobody has searched DEV or PROD for invites already used to take over a peer
  administrator, and nothing was repaired. How many outstanding invites would now be refused is unmeasured.
- The validated tree is uncommitted; any change after these runs needs the affected checks repeated.

**Remaining steps (all outstanding).**

1. Operator reviews and commits the validated tree.
2. `npm run merge:ready -- --issue 270` against freshly updated refs; then the operator fast-forwards `main` and pushes
   `main`.
3. DEV deployment (`deploy/sync-dev.ps1`) and smoke; record DEV acceptance of the redemption behaviour.
4. PROD installation and any applicable PROD acceptance remain outstanding behind the unchanged ISSUE-265 hold, like
   every release after `cd3cf782`.
5. Resolution of ISSUE-270 only after the applicable remaining acceptance (including PROD, once the hold allows) is
   complete, per CLAUDE.md §5; DEV acceptance alone does not close it.

D-270-1 (live-invite uniqueness index, a migration) remains **undecided** and is not a merge gate; D-270-2 stays decided
and implemented; the §19.6 follow-ups remain recorded, not gates. The issue stays **open**.
