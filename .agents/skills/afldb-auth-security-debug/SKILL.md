---
name: afldb-auth-security-debug
description: Diagnose and fix AFLDB authentication, session, beta-gate, TOTP MFA, admin role/authorisation, secure-cookie, CSP/HSTS, indexing gate, magic-link, intake-secret, or security-boundary defects. Use when access is incorrectly allowed/denied, sessions fail, roles leak, beta access misbehaves, or a proposed fix could weaken a security control.
---

# AFLDB Auth and Security Debugging

Fix the defect without weakening fail-closed boundaries.

## Guardrails

- Work only in the local working copy.
- Inspect before editing.
- Do not run Git commands unless explicitly requested.
- Never print or commit secrets.
- Never substitute production credentials into local development.
- Do not disable MFA, role checks, secure cookies, CSP, HSTS, indexing controls, or beta validation merely to make a test pass.

## Map the boundary

Identify:

- environment (`development`, `staging`, `production`);
- hostname and canonical base URL;
- beta-gate state and epoch;
- session validation path;
- role required;
- MFA state required;
- database connection/role involved;
- redirect or denial behaviour;
- cookie flags and trust boundary.

Remember that `AFLDB_ENV` controls transport/security behaviour while `AFLDB_INDEXING` is deliberately separate.

## Fail-closed checks

Confirm malformed, missing, expired, revoked, or unauthorised state denies access where intended. Test both the allow path and deny path.

For role fixes, verify a lower privilege cannot reach the action by calling the server action/route directly; hiding a button is not authorisation.

For beta/session fixes, verify revocation epoch handling and cookie/session signature validation.

## Mail-related auth

Separate authentication logic from SMTP delivery. A magic-link token can be generated correctly while outbound delivery is broken. Diagnose token creation, persistence/expiry, message construction, relay transport, and callback validation independently.

## Patch strategy

- Keep enforcement server-side.
- Reuse central auth/session/role helpers.
- Avoid duplicate security logic in individual pages.
- Preserve secure defaults for missing/invalid environment values.
- Add regression tests for both legitimate and prohibited access.

Report any security boundary you could not exercise end-to-end.
