# AFLDB-ISSUE-248 — Reserved-domain DEV auth fixtures block promotion

## 0. Status

- **Open (2026-09-25).** **Severity:** High. It blocks ISSUE-237 L4 at A5. **Area:** DEV auth
  operations: `auth_users`, `admin_invites`, `auth_audit_log`, `auth_sessions`, and
  `tools/maintenance/issue248-cleanup-dev-auth-fixtures.ts`.
- **Implemented and DB-free validated (2026-09-25).** *(2026-09-26: committed `a4f734af`, merged
  `397f422d` and deployed to DEV. No §9 run is recorded anywhere, so it stays open; see §11.)*
- **Next action:**
  1. The operator reviews and commits, merges, and puts the code on the DEV checkout.
  2. Under an explicit DEV authorisation, the operator runs §9: backup, validate-only, `--apply`,
     rerun, P1–P4.
  3. Resolve this issue on that evidence.
  4. Rerun ISSUE-237 L4 A5 under ISSUE-237's own authorisation.

## 1. Live evidence (ISSUE-237 L4 A5, 2026-09-25, operator-reported)

A5 (`db:promotion:check --environment dev --phase pre-cutover --database afldb_dev`, which L4 never
runs with `--allow-fixture-identities`) refused the **test-fixture identity gate**
(`gateFixtureIdentities`, predicate `TEST_FIXTURE_EMAIL_SQL`, RFC 2606/6761 reserved domains).

| Row | Facts |
|---|---|
| `auth_users` 14 | `e2e-plain-admin@afldb.test`. It is disabled, and a password and TOTP are present. |
| `auth_users` 17 | `e2e-super-admin@afldb.test`. It is disabled, and a password and TOTP are present. |
| `auth_users` 18 | `testcon@test.test`. It is disabled, and a password and TOTP are present. |
| `admin_invites` 5 | `testcon@test.test`, role `contributor`, `invited_by` 4, `used_at` 2026-09-11 13:12:00.671379+10. It is expired and not revoked. |

**Full FK census into those `auth_users` ids:**
- `auth_audit_log.actor_user_id`: 8.
- `auth_sessions.user_id`: 4.
- Every other FK: 0.

**The 8 audit rows** are all actor 18 and all have NULL `detail`:

| id | action |
|---|---|
| 807 | `admin.login` |
| 808 | `admin.logout` |
| 811 | `admin.login` |
| 812 | `admin.logout` |
| 889 | `admin.login` |
| 890 | `admin.logout` |
| 912 | `admin.login` |
| 913 | `admin.logout` |

**The 4 sessions** are 13, 15, 29 and 35. All belong to user 18, and all are already revoked.

**Conclusion:** these identities own no durable football, admin or business provenance.

## 2. Root cause

- These are DEV end-to-end and acceptance fixture identities under reserved domains:
  - `e2e-plain-admin` was the ISSUE-155 lifecycle round-trip target;
  - `testcon` was the ISSUE-167 contributor.
- Earlier DEV promotions consciously **accepted** them with `--allow-fixture-identities` (ISSUE-141).
  ISSUE-237 L4 never passes that flag, so A5 refuses them, correctly.
- No supported, audited lifecycle removed a DEV fixture identity. The only precedent,
  `tools/admin/issue155-acceptance-cleanup.ps1`, is `afldb_test`-only and writes no operator audit.
- **The A5 gate is not weakened.** Renaming the emails would only hide the fixtures from the
  predicate, so it is excluded.

## 3. Operator decisions (2026-09-25, this issue's brief)

- **Delete exactly this closure:**
  - `admin_invites` 5;
  - `auth_audit_log` 807, 808, 811, 812, 889, 890, 912 and 913;
  - `auth_sessions` 13, 15, 29 and 35;
  - `auth_users` 14, 17 and 18.
- **Do not:**
  - rename a fixture email;
  - weaken the promotion fixture gate;
  - build a generic account purge.
- **One durable operator audit**, `auth_audit_log`, `action = 'test_fixture.cleanup'`:
  - It is attributed to a verified real, enabled super_admin, never a fixture account.
  - It is written **before** the fixture history is deleted, in the same transaction.
- **One transaction** holds every guard, the audit, every delete and the final assertions. Any
  count that differs rolls everything back, **including the operator audit**.
- **Reruns:**
  - A coherent completed cleanup returns ALREADY_CLEAN, with 0 writes.
  - A partially missing closure without a coherent audit is refused.
- ISSUE-155's cleanup is evidence only. Its script is not reused.

## 4. The tool

```bash
npm run db:issue248:cleanup-dev-auth-fixtures -- --environment dev --actor-email <DEV super admin>          # validate only
npm run db:issue248:cleanup-dev-auth-fixtures -- --environment dev --actor-email <DEV super admin> --apply  # the one mutation
```

- **Arguments.** Only `--environment dev`, `--actor-email` and `--apply` are accepted.
  - There is no force flag, and no email, id, domain, table, DSN or database argument.
  - `--environment prod|production|test|candidate` is refused before any connection.
  - A reserved-domain `--actor-email` is refused.
- **Target.** Only `AFLDB_OWNER_DATABASE_URL` is accepted.
  - Its path must name exactly `afldb_dev` before connecting.
  - `current_database()` must be `afldb_dev` inside the transaction.
  - The DSN is never printed.
- **Default mode** is a READ ONLY transaction, verdict `WOULD_CLEAN`.

## 5. Guards (all before mutation; any failure = STOP, nothing written, every problem listed)

Every lookup is a union, so an extra row cannot hide. For example, users are found by closure id
**or** closure email, and audits by closure id **or** closure actor.

1. **Database.** `current_database() = 'afldb_dev'`.
2. **Accounts.** The lookup returns exactly ids {14, 17, 18}, with these exact emails and roles:
   - 14 = `admin`;
   - 17 = `super_admin`;
   - 18 = `contributor`.

   All three are disabled, with a password and TOTP present. *(The roles follow each fixture's
   purpose. The live A5 evidence did not list them, so the validate-only run is where they are
   proven first. A mismatch is a STOP, not a guess.)*
3. **Invite.** The lookup returns exactly id 5, with:
   - email `testcon@test.test`, role `contributor`, `invited_by` 4;
   - `used_at` exactly `2026-09-11T03:12:00.671379Z`, compared at microsecond precision;
   - expired, and not revoked.
4. **Fixture audit history.** The lookup returns exactly the eight ids above, each with actor 18,
   its exact login or logout action, and NULL `detail`.
5. **Sessions.** The lookup returns exactly 13, 15, 29 and 35, each belonging to user 18 and
   revoked.
6. **Dynamic FK census.** The tool reads every FK into `public.auth_users` from `pg_constraint`,
   not from a hand-kept list, and counts each against {14, 17, 18}:
   - `auth_audit_log.actor_user_id` must be 8, and `auth_sessions.user_id` must be 4;
   - **every other FK must be 0**, including one added after this tool was written;
   - a multi-column FK, or a missing closure FK, is a STOP.
7. **Reserved-domain scope.** The tool runs the A5 predicate verbatim over every email-bearing table
   (`EMAIL_BEARING_TABLES`). It must match exactly the three accounts and invite 5.
   - Any other reserved-domain row is a STOP. It is **never swept in**.
8. **No prior cleanup audit.** No `test_fixture.cleanup` audit naming ISSUE-248 may exist while
   the closure is present.
9. **Actor.** Exactly one `auth_users` row matches `--actor-email`. It must be:
   - `super_admin`, enabled, with a password and TOTP;
   - not a closure id, and not a reserved-domain email.
10. **Privileges.** Checked under `--apply` only: INSERT on `auth_audit_log`, and DELETE on the
    four closure tables.

## 6. Audit design

`auth_audit_log`, with:
- `actor_user_id` = the verified actor;
- `actor_label` = `operator: DEV reserved-domain auth fixture cleanup (AFLDB-ISSUE-248)`;
- `action` = `test_fixture.cleanup`.

The `detail` is bound with `sql.json`, never pre-stringified (migration 082). It holds:
- `issue: AFLDB-ISSUE-248`, `operation`, `blocked_issue: AFLDB-ISSUE-237`, `blocked_step` (L4 A5),
  and `reason`: reserved-domain fixture identities block promotion A5;
- `database: afldb_dev`;
- `deleted_users` (id, email, role), and `deleted_invite` (id 5, email, role, `invited_by`,
  `used_at`);
- `deleted_audit_ids` and `deleted_session_ids`;
- `foreign_key_census` (every catalogue FK and its count), and `business_provenance_references: 0`;
- `tool`.

The audit references the deleted accounts by value only. Its actor is real, so the FK stays valid
after the accounts are deleted.

## 7. Transaction, ordering, rollback, idempotence

**`--apply` runs one read-write transaction:**
1. Lock the closure rows (`FOR UPDATE`). Locking the accounts also blocks any new referencing row.
2. Read and classify the closure.
3. Check privileges.
4. INSERT the operator audit.
5. DELETE the four sessions.
6. DELETE the eight fixture audit rows.
7. DELETE invite 5.
8. DELETE accounts 14, 17 and 18. The children go first, so no FK is violated.
9. Re-read and re-classify.
10. Commit.

**Each DELETE:**
- is bound by exact fixed id;
- re-asserts the expected state in its WHERE clause, for example `revoked_at IS NOT NULL`,
  `detail IS NULL`, `used_at IS NOT NULL`, `disabled_at IS NOT NULL`;
- must return exactly 4, 8, 1 or 3 rows.

**Postcondition.** The readback must be the ALREADY_CLEAN state bound to the new audit id:
- none of the closure rows are present;
- exactly one ISSUE-248 cleanup audit exists;
- no reserved-domain row is left.

The table totals must also move by exactly the closure:
- `auth_users` −3;
- `admin_invites` −1;
- `auth_audit_log` −8 +1;
- `auth_sessions` −4.

A delete that reached any other row fails this check.

**Failure.** Any throw rolls the operator audit back with the deletes. This includes an INSERT
failure, a DELETE failure, a count mismatch, a readback that is not the clean state, or totals
drift.

**Rerun.**
- If the closure is absent and exactly one coherent ISSUE-248 audit exists, the verdict is
  `ALREADY_CLEAN`, with 0 writes. A coherent audit has the exact ids and emails, a zero business
  census, a real actor, and an id greater than 913.
- These cases are a STOP:
  - the closure is absent with no audit;
  - the closure is partly present, with or without the audit;
  - there are duplicate audits;
  - the audit is incoherent;
  - a new reserved-domain row has appeared.

**Report.** It lists the closure, the actor id, the FK census, the verdict, the audit id, writes
(17 on `--apply`: 1 INSERT and 16 DELETEs) and the transaction mode.

## 8. Validation (DB-free, Claude-run, 2026-09-25)

- `tests/issue248-cleanup-dev-auth-fixtures.test.ts`: **138/138**. It covers:
  - argument and target refusals before connection (including `--force` and generic target
    flags, `prod`/`test`/`candidate`, non-`afldb_dev` DSNs, a reserved-domain actor, and no DSN
    leak);
  - every account, invite, audit and session guard;
  - dynamic FK refusals (data_edits, data_overrides, Brownlow, adjudications, an unknown future
    FK, an invite sent BY a fixture account, a multi-column FK, a missing closure FK);
  - reserved-domain rows outside the closure;
  - actor refusals;
  - ALREADY_CLEAN, partial and incoherent-audit states;
  - READ ONLY validation;
  - the exact `--apply` statement order;
  - rollback on an INSERT failure, on each step's delete-count mismatch, on a DELETE failure, on a
    readback mismatch, and on totals drift from an over-reaching delete;
  - missing privileges;
  - idempotent reruns with no duplicate audit;
  - a source scan: DELETE only from the four tables, each by exact fixed id; one INSERT; no
    UPDATE or TRUNCATE; the only flags are `--environment`, `--actor-email` and `--apply`; no
    prod/test target; ISSUE-155 not reused; FKs read from the catalogue.
- **Affected suites:**
  - `tests/db-promotion-check.test.ts` (the A5 predicate) and
    `tests/issue246-retire-issue109-fixture.test.ts`: 415/415 in one run, including this suite;
  - `tests/auth.test.ts` and `tests/admin-lifecycle-actions.test.ts`: 200/200.
- `npx tsc --noEmit` is clean, and ESLint on the changed TypeScript is clean. `git diff --check`
  is clean.
- There was no database, SSH, DEV mutation, A5 rerun or Git write.

## 9. Live DEV procedure (operator-run; NOT RUN; needs explicit DEV authorisation)

**Prerequisites:**
- this code is committed, merged and on the DEV checkout;
- `AFLDB_OWNER_DATABASE_URL` is exported and names `afldb_dev`;
- an explicit DEV authorisation for this one mutation.

```bash
# DEV: streamanator
cd ~/projects/afldb && hostname && git log -1 --oneline

dev_ro() { PGOPTIONS='-c default_transaction_read_only=on' psql -X -A -t -v ON_ERROR_STOP=1 -d "$AFLDB_OWNER_DATABASE_URL" -c "$1"; }

# 0. Pre-state record (read-only). Keep the output.
dev_ro "SELECT format('db=%s users=%s invites=%s audit=%s/%s sessions=%s', current_database(), (SELECT count(*) FROM auth_users), (SELECT count(*) FROM admin_invites), (SELECT count(*) FROM auth_audit_log), (SELECT max(id) FROM auth_audit_log), (SELECT count(*) FROM auth_sessions))"

# 1. Mandatory safety net before a DEV write (docs/backup-restore.md).
bash tools/maintenance/backup.sh --keep 14            # must print "Backing up afldb_dev to …"

# 2. Validate only (READ ONLY transaction).
npm run db:issue248:cleanup-dev-auth-fixtures -- --environment dev --actor-email <DEV super admin email>
# expect: verdict WOULD_CLEAN; FK census with auth_audit_log.actor_user_id = 8, auth_sessions.user_id = 4,
#         every other FK = 0; transaction READ ONLY (validate only; nothing written); PASS.
# any "REFUSED: STOP before mutation" -> record every listed problem and STOP. Do not work around it.

# 3. The one mutation.
npm run db:issue248:cleanup-dev-auth-fixtures -- --environment dev --actor-email <DEV super admin email> --apply
# expect: verdict CLEANED; cleanup audit auth_audit_log <N>; writes 17; COMMITTED; PASS.

# 4. Idempotence proof.
npm run db:issue248:cleanup-dev-auth-fixtures -- --environment dev --actor-email <DEV super admin email> --apply
# expect: verdict ALREADY_CLEAN; the SAME auth_audit_log <N>; writes 0; COMMITTED (no writes); PASS.
```

**Read-only post-cleanup checks** (after step 4):

```bash
# P1. The closure is gone.
dev_ro "SELECT format('db=%s users=%s invites=%s audits=%s sessions=%s', current_database(), (SELECT count(*) FROM auth_users WHERE id IN (14,17,18) OR lower(email) IN ('e2e-plain-admin@afldb.test','e2e-super-admin@afldb.test','testcon@test.test')), (SELECT count(*) FROM admin_invites WHERE id = 5 OR lower(email) IN ('e2e-plain-admin@afldb.test','e2e-super-admin@afldb.test','testcon@test.test')), (SELECT count(*) FROM auth_audit_log WHERE id IN (807,808,811,812,889,890,912,913) OR actor_user_id IN (14,17,18)), (SELECT count(*) FROM auth_sessions WHERE id IN (13,15,29,35) OR user_id IN (14,17,18)))"
# expect: db=afldb_dev users=0 invites=0 audits=0 sessions=0

# P2. Exactly one cleanup audit, by a real super admin.
dev_ro "SELECT format('db=%s audit=%s actor=%s role=%s enabled=%s issue=%s blocked=%s invite=%s audits=%s sessions=%s business=%s', current_database(), a.id, a.actor_user_id, u.role, u.disabled_at IS NULL, a.detail->>'issue', a.detail->>'blocked_issue', a.detail#>>'{deleted_invite,id}', a.detail->'deleted_audit_ids', a.detail->'deleted_session_ids', a.detail->>'business_provenance_references') FROM auth_audit_log a JOIN auth_users u ON u.id = a.actor_user_id WHERE a.action = 'test_fixture.cleanup' ORDER BY a.id"
# expect exactly one line: db=afldb_dev audit=<N> actor=<id> role=super_admin enabled=true issue=AFLDB-ISSUE-248 blocked=AFLDB-ISSUE-237 invite=5 audits=[807, 808, 811, 812, 889, 890, 912, 913] sessions=[13, 15, 29, 35] business=0

# P3. The A5 reserved-domain predicate finds nothing in any email-bearing table.
dev_ro "SELECT t, count(*) FROM (SELECT 'auth_users' t, email FROM auth_users UNION ALL SELECT 'admin_invites', email FROM admin_invites UNION ALL SELECT 'beta_allowed_emails', email FROM beta_allowed_emails UNION ALL SELECT 'beta_login_tokens', email FROM beta_login_tokens UNION ALL SELECT 'beta_join_requests', email FROM beta_join_requests) s WHERE position('@' in email) <= 1 OR position('@' in email) = length(email) OR rtrim(lower(split_part(email, '@', 2)), '.') = '' OR rtrim(lower(split_part(email, '@', 2)), '.') ~ '(^|\.)(test|example|invalid|localhost)$' OR rtrim(lower(split_part(email, '@', 2)), '.') ~ '(^|\.)(example\.com|example\.net|example\.org)$' GROUP BY 1"
# expect: no rows.

# P4. Nothing else moved: compare with step 0.
dev_ro "SELECT format('db=%s users=%s invites=%s audit=%s/%s sessions=%s', current_database(), (SELECT count(*) FROM auth_users), (SELECT count(*) FROM admin_invites), (SELECT count(*) FROM auth_audit_log), (SELECT max(id) FROM auth_audit_log), (SELECT count(*) FROM auth_sessions))"
# expect: users -3; invites -1; audit count -7 with max = N; sessions -4
#         (audit/sessions may be higher only if an unrelated admin sign-in happened meanwhile; P2 must still show exactly one row).
```

Record steps 0–4 and P1–P4 here. Then resolve ISSUE-248, and rerun ISSUE-237 L4 A5 under its own
authorisation.

## 10. Not authorised by this issue

- Any database, SSH or DEV mutation by Claude.
- An A5 rerun, or any other ISSUE-237 L4 step.
- A production, `afldb_test`, `code_test_db` or candidate target.
- Any Git write.
- Renaming fixture emails, `--allow-fixture-identities` in L4, or a generic account purge.

## 11. Closure audit against ISSUE-237 L4 (2026-09-26, DB-free, Claude-run): REMAINS OPEN

- **Implementation state.** Committed `a4f734af`. It is contained in `397f422d` and `6ae70722`,
  the revisions that the two later L4 runs used.
- **Recorded.** Only indirect progression evidence. L4 passed A5 at 033212 (the run reached the
  post-swap phase) and at 085511 ("A/B/C gates passed"). L4 never passes
  `--allow-fixture-identities` (§11d A5), so the reserved-domain rows were probably gone from
  `afldb_dev` by then.
- **Missing (NOT RECORDED; whether §9 itself ran is unknown).** No repository record holds any §9
  or P1–P4 output:
  - the backup file;
  - WOULD_CLEAN, CLEANED (cleanup audit id, 17 writes) and ALREADY_CLEAN;
  - the actor;
  - P1 closure counts, P2's single `test_fixture.cleanup` row, P3 no rows, and the P4 deltas.

  A5 passing does not show *how* the rows left. The audited tool is the only authorised mechanism,
  and this issue requires its evidence.
- **Closure path (operator, read-only unless noted).**
  - Promotion reinstates `auth_users`, `admin_invites` and `auth_audit_log` in full
    (`promotion-inventory.ts:339-348, 779-784`). So on today's `afldb_dev`:
    - P1 and P3 remain meaningful;
    - P2 still returns the cleanup audit row, its id and its actor, if the tool ran.
  - Run P1–P3 now.
  - Pre-state, backup, validate-only, apply and rerun exist only in the operator's console. P4 is
    no longer reproducible, because the promotion reset `auth_sessions` and appended its markers.
  - If P2 returns no row, the cleanup did not run through this tool. Record how the closure left
    DEV, and do not resolve this issue.
  - The tool's default validate-only mode is itself a read-only idempotence probe. It returns
    ALREADY_CLEAN with the audit id only for a coherent completed cleanup (tool lines 556-557). It
    refuses an absent closure that has no audit.
  - A rerun with `--apply` is not needed for that probe.
  - The original backup, WOULD_CLEAN and CLEANED (17 writes) lines exist only in console output.
    Whether P1–P3 plus a validate-only ALREADY_CLEAN is enough without them is an operator
    decision. This audit does not make it.
