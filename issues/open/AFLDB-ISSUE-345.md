# AFLDB-ISSUE-345 — Restricted Grid Solver omits the forced password-change gate

**Status: implemented locally 2026-11-08 (uncommitted), awaiting user-executed verification.** `src/lib/auth/audience.ts` now calls `requireUploader()` for non-public audiences. Tests: `tests/auth.test.ts` "requireAudience against the real guard (AFLDB-ISSUE-345)", 8 cases; run `npx vitest run tests/auth.test.ts`. Opened 2026-11-08. **Severity: Low.** Area: Configurable audience access control.

This review authorizes documentation only. The sequence below is a proposal, not authorization to implement or operate any environment. [Detailed ledger](../../issues.md#afldb-issue-345).

Review baseline: branch claude/issue-339-deploy-preflight, HEAD 5cba6846ddfcfd5d7a3fd29e14bc8877099d9656, 2026-11-08. These source paths are unchanged from the locally recorded published origin/main 7fabc6e51c5c53c4b6f6fe345f21191d9184660b; this is not a fresh remote or production verification. Evidence is source-established, with no new executable reproduction. Graph tools were unavailable; exact source and caller searches were used. See [review handoff](AFLDB-ISSUE-339.md#repository-review-handoff-2026-11-08) for coverage and limits.

## Affected behavior and exact evidence

- src/lib/auth/audience.ts:24-30 returns immediately for public and otherwise checks getAdminUser plus role only.
- src/lib/auth/session.ts:259-269 explicitly makes requireUploader enforce mustChangePassword; :295-298 funnels the admin guard through it.
- src/app/grid-solver/page.tsx:56-57 calls requireAudience, followed by solver data queries at :74-101.
- src/lib/site-settings.ts:286-291 defaults Grid Solver to super_admin. The /admin/grid-solver redirect does not add a guard to direct /grid-solver requests.

## Trigger, prerequisites and impact

An account with a valid session, sufficient role and must_change_password=true requests /grid-solver directly while its configured audience is restricted. It passes requireAudience before replacing the temporary password.

The temporary-password restriction is bypassed for a restricted feature. This finding does not establish admin mutation access or private credential disclosure; severity is Low. The intentionally public audience remains public.

## Root cause, callers and smallest viable fix

The configurable audience helper duplicates role/session checks but omits the common credential-state guard, despite its comment describing equivalence to requireAdmin with a movable threshold.

For non-public audiences, use the existing forced-change guard before evaluating the audience role (or factor a shared equivalent). Keep the public early return so public access does not require a session or become cookie-dependent.

## Implementation sequence and dependencies

1. Add an audience test matrix in the existing auth suite, including a forced-change super admin requesting the default restricted audience.
2. Route the non-public branch through the shared forced-password guard, retaining role denial and login redirects.
3. Verify Grid Solver redirects before its queries for a forced-change account, and the public audience remains accessible without auth reads.

Can share the auth regression pass with ISSUE-340; independently fixable and no schema decision required.

## Focused reproduction and regression checks

Extend tests/auth.test.ts with public/no-cookie, missing session, insufficient role, disabled/revoked session, permitted role and forced-change cases. Existing guard coverage centers on /admin boundaries and does not exercise requireAudience's forced-change behavior. Include a focused Grid Solver page assertion that no solver query occurs before redirect.

These checks are proposed for a later authorized implementation phase; none was executed during this review. Existing evidence does not establish an incident on DEV or production.

## Measurable acceptance criteria

Every non-public audience refuses data access until must_change_password is cleared; sufficiently privileged normal sessions work; public access still performs no auth lookup.

## Failure handling and recovery

No data migration or live session change. Redirect to the existing password page; do not revoke sessions or change audience settings as a workaround.

## Duplicate and decision review

ISSUE-155's forced-change rule supplies the established contract. No accepted exception for restricted Grid Solver was found; public audience behavior is an intentional exception and is preserved.
