# AFLDB-ISSUE-340 — Credential rotation races with old-credential requests and session creation

**Status: implemented locally 2026-11-08 (uncommitted), awaiting user-executed verification — see [Implementation record](#implementation-record-2026-11-08).** Opened 2026-11-08. **Severity: High.** Area: Authentication and administrator lifecycle.

This review authorizes documentation only. The sequence below is a proposal, not authorization to implement or operate any environment. [Detailed ledger](../../issues.md#afldb-issue-340).

Review baseline: branch claude/issue-339-deploy-preflight, HEAD 5cba6846ddfcfd5d7a3fd29e14bc8877099d9656, 2026-11-08. These source paths are unchanged from the locally recorded published origin/main 7fabc6e51c5c53c4b6f6fe345f21191d9184660b; this is not a fresh remote or production verification. Evidence is source-established, with no new executable reproduction. Graph tools were unavailable; exact source and caller searches were used. See [review handoff](AFLDB-ISSUE-339.md#repository-review-handoff-2026-11-08) for coverage and limits.

## Affected behavior and exact evidence

- src/app/admin/login/actions.ts:43-57 reads credentials and verifies them outside a transaction; :70-76 claims only the TOTP step, without comparing the verified credentials; :82-83 creates the session later.
- src/app/admin/password/actions.ts:46 and :62-70 validate the session and old password before the transaction; :72-89 unconditionally replaces the password by user id, clears must_change_password and revokes existing sessions; :91 inserts the replacement session afterwards.
- src/app/admin/admins/password-actions.ts:45-73 checks the actor/target before hashing; :75-94 changes the target password and revokes existing sessions.
- src/lib/auth/session.ts:155-165 inserts sessions independently; :219-233 accepts live sessions without a credential generation check. Only login and own-password change call createAdminSession (source caller search).
- src/db/migrations/023_auth_submissions.sql:38-49 gives sessions no credential generation.

## Trigger, prerequisites and impact

An already authenticated password-change request verifies the old password, then pauses while another request resets the account and revokes its sessions. The paused change resumes, overwrites the reset, clears the forced-change flag and obtains a fresh session. Separately, login can verify old password + a valid unused TOTP step before a password change, then insert a session after that change has revoked all existing sessions. This requires concurrent requests and the old credentials (plus TOTP for login); it is not anonymous login or a TOTP bypass. A reset that leaves must_change_password true still restricts a late login, but the stale own-password change explicitly clears that flag.

Credential rotation is not a reliable boundary against requests already in flight. A stale authenticated request can undo account recovery; a session minted after revocation is not among the revoked rows. Current disabled/role checks still reject a disabled account on subsequent requests.

## Root cause, callers and smallest viable fix

Credential verification, credential mutation, TOTP consumption and session issuance do not share a serialized per-user decision. Transactions around UPDATE + revocation cannot cover later independent INSERTs or earlier reads.

Use a common per-user transactional credential/session boundary. Hash outside the lock, then lock and compare the exact verified credential snapshot (or a monotonically changing credential generation), recheck session/status/actor authority, consume the TOTP step and insert the session within that boundary. Every credential mutator must participate. Emit the signed cookie only after commit. Preserve one-time TOTP consumption and role restrictions. Do not solve this with a timing delay or only another pre-transaction read.

## Implementation sequence and dependencies

1. Inventory login, own change, manager reset and invite/lifecycle credential writers; reuse the locked lifecycle conventions from ISSUE-270 without reopening that issue. Decide whether snapshot comparison suffices or an explicit generation is needed; document all participating writers.
2. Add deterministic interleaving tests using explicit barriers and two connections; demonstrate the stale verified request before changing product code.
3. Implement the common transaction/session helper and move both callers to it; keep expensive hashing outside the lock and revalidate its input inside. Recheck reset actor/target authority under the same ordering; acquire multiple user locks in stable id order. Retry only an aborted database transaction with fresh credential/session checks, never a committed rotation or cookie/audit side effect.
4. Verify failure paths and audit only committed outcomes; deliver cookie errors separately from credential commit, so retry cannot silently overwrite newer credentials.

Owner to choose credential-generation migration versus a complete snapshot/locking design and approve any session invalidation rollout. ISSUE-345 can share guard tests but is independently fixable.

## Focused reproduction and regression checks

Extend tests/auth.test.ts and tests/integration/admin-lifecycle.test.ts (or their closest existing transactional helper suite). Exercise login paused after verification versus password change, own change paused after verification versus manager reset, two own changes, session insert versus revocation, TOTP replay, disabled/demoted users, and transaction rollback. Use a disposable database ending in _test with explicit barriers, never probabilistic sleeps. Existing auth tests cover hash/TOTP/session predicates and guards, but do not drive these two createAdminSession callers through the interleaving.

These checks are proposed for a later authorized implementation phase; none was executed during this review. Existing evidence does not establish an incident on DEV or production.

## Measurable acceptance criteria

After a credential rotation commits, no request verified against the replaced credentials can change the password or create an accepted session. A concurrent stale change cannot clear the reset flag. Exactly one TOTP consumption is possible, all credential/session mutations roll back together on failure, and ordinary login/password change still work.

## Failure handling and recovery

Fail closed on stale snapshots; ask the user to sign in again without echoing credentials. If the database commits but cookie delivery fails, retain the rotation and require fresh login; never auto-revert credentials. A schema-generation design needs a reviewed migration/backfill and compatibility ordering before deployment. No incident or affected account is established here; any investigation/revocation of live sessions is a separate owner action.

## Duplicate and decision review

ISSUE-155 established reset/revocation and forced-change semantics; ISSUE-270 fixes invite authority under locking. Neither covers old-credential login/own-change requests completing after rotation. Those decisions remain closed.

<a id="implementation-record-2026-11-08"></a>

## Implementation record — 2026-11-08

- **Design choice (owner decision taken as the playbook's no-migration option):** snapshot/locking, no credential-generation column. Every rotation writes a freshly salted scrypt hash (`src/lib/auth/crypto.ts:50-51`), so "stored hash unchanged under the row lock" is a sufficient generation check. No schema change, backfill or session-invalidation rollout is needed.
- **Participating writers:** login (TOTP claim + session insert), own change, manager-issued temporary password (`src/db/queries/admin-credentials.ts`), and invite redemption (`src/db/queries/admin-invites.ts:242-316`, already `FOR UPDATE` and rotates both factors; unchanged). Lifecycle demotion/deactivation already lock the row; login and reset re-check role/`disabled_at` under the lock.
- **Code:** `src/db/queries/admin-credentials.ts` (new); `src/lib/auth/session.ts` (`prepareAdminSession`, `setAdminSessionCookie`, `currentAdminSessionTokenHash`; `createAdminSession` removed); `src/app/admin/login/actions.ts`; `src/app/admin/password/actions.ts`; `src/app/admin/admins/password-actions.ts`.
- **Tests (not yet run):** `tests/integration/admin-lifecycle.test.ts`, describe "credential rotation cannot be undone by a request already in flight (AFLDB-ISSUE-340)", 12 cases. The witness case replays the old statements and shows the reset overwritten. The guarded cases use explicit `waitForBlock` interleavings, never sleeps.
- **Verification evidence:** source only. Required: `npx vitest run tests/integration/admin-lifecycle.test.ts` with `AFLDB_TEST_DATABASE_URL` on a `*_test` database (Linux), and `npx tsc --noEmit`.
