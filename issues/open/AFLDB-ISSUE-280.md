# AFLDB-ISSUE-280 — Beta magic link is consumed by any GET, including a mail scanner's prefetch

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
- **Severity:** Low. **Area:** beta gate / authentication UX.
- **Key file:** `src/app/beta/verify/route.ts`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-015; partition note R1a-F02). The orchestrator confirmed the mechanism.
- **Classification:** code-proven mechanism. Incidence depends on the recipients' mail providers.

## 1. Summary

`GET /beta/verify?token=` burns the single-use token as its first statement. A mail provider that pre-fetches links for safety scanning (Outlook SafeLinks, corporate URL rewriters) spends the token before the reader clicks. The reader is then silently bounced to `/beta`.

## 2. Evidence

- `src/app/beta/verify/route.ts`:
  - `:21-42`: `UPDATE beta_login_tokens SET used_at = now() … RETURNING email` on GET.
  - `:44-48`: a silent redirect when no row matches.
- `src/app/beta/BetaGateForm.tsx:69-74`: the only user-facing message.
- `src/app/beta/actions.ts:127-128`: link construction.

## 3. Trigger

An allowlisted recipient whose mail gateway pre-fetches URLs requests a sign-in link.

## 4. Expected invariant

A single-use emailed credential is consumed only by a deliberate user action (a POST from a confirmation page).

## 5. Actual behaviour

The scanner consumes the token and gets a useless cookie. The reader's click fails with no explanation, and every retry fails the same way for that mailbox.

## 6. First wrong layer

`src/app/beta/verify/route.ts:21-42`.

## 7. Impact

Operational: a class of invited readers cannot pass the gate by email. There is no security impact.

## 8. Reproduction / witness

Not executed. Incidence evidence: `auth_audit_log` rows `beta.magic_link_verified` whose IP belongs to a mail-security range, shortly after `beta.magic_link_issued`.

## 9. Disproof attempts

- There is no POST handler or confirmation page under `src/app/beta/verify/`.
- `docs/admin-and-beta.md:357` does not accept this trade-off.

## 10. Existing-issue search

`issues.md` was searched for magic link with prefetch/scanner/SafeLinks/burn, and for `beta_login_tokens`. No hit. Classification: **new**.

## 11. Scope

The verify route.

## 12. Out of scope

The beta allowlist and the rate limits.

## 13. Proposed fix boundary

GET renders a one-button confirmation page. A POST (server action or handler) performs the burn, keeping the rate limit and the allowlist re-check.

## 14. Proposed validation

1. A route test: GET issues no `UPDATE beta_login_tokens`, and POST does.
2. A manual DEV check with a prefetching mailbox.

## 15. Decisions / unresolved questions

None.

## 16. Next action

Implementation (low priority).
