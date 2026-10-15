# AFLDB-ISSUE-280 — Beta magic link is consumed by any GET, including a mail scanner's prefetch

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented. **Assessed 2026-10-15 (§17): cannot close within read-only DEV scope; parked.**
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

Implementation (low priority), then the §17.3 DEV check.

## 17. Assessment (2026-10-15; no code changed)

### 17.1 What the closure criteria need

- §14 item 1, a route test (GET issues no `UPDATE beta_login_tokens`, POST does): DB-free and implementable, but the fix does not exist yet.
- §14 item 2, a manual DEV check with a prefetching mailbox: requires (a) a deployment of the fix to DEV, (b) a magic-link issue, which writes a
  `beta_login_tokens` row and the request's audit row, and (c) an email to an allowlisted address, which is an external message.
- The fix is user-visible (a one-button confirmation page), so the Visual Evidence Mandate applies: captured images, or `VISUAL: UNVERIFIED`.

None of (a)-(c) was within the 15 October authority (read-only DEV diagnostics and browser checks; no data writes, settings changes, external
messages or another deployment). The criteria are not weakened and the issue stays Open. Nothing was implemented in this session: the request was an
assessment, and the DEV check could not follow the code anyway.

### 17.2 Read-only observations

- `src/app/beta/verify/route.ts` is unchanged since the review: the burning `UPDATE` is the first statement after the length check and the
  rate limit (`:35-42`); a successful row proceeds to the allowlist re-check, the `beta.magic_link_verified` audit and `grantBetaAccess` (`:50-62`), so the
  scanner's own response receives the access cookie, which is useless to the reader. There is still no POST handler or confirmation page under `src/app/beta/verify/`.
- **Incidence evidence was not collected.** On DEV, as `afldb_app` in a `READ ONLY` transaction (`afldb_dev`), `SELECT` on `beta_login_tokens` is refused
  (`permission denied for table beta_login_tokens`; the audit log was not reached because the transaction aborted). Reading them with the auth role would
  cross the credential boundary for a Low issue, so no escalation was attempted. DEV also has allowlisted testers only, so a DEV count would not measure
  the mail providers of real invitees. The incidence stays unmeasured, as the runbook §8 says.

### 17.3 Exact remaining action (operator)

1. Implement §13: `GET` renders a one-button confirmation page and does not touch `beta_login_tokens`; a POST (server action or handler) performs the burn with the
   existing rate limit and allowlist re-check. Extend the closest suites (the route test in §14 item 1; the beta tests that pin the verify route).
2. Capture the confirmation page (mobile and desktop) or record `VISUAL: UNVERIFIED`.
3. Deploy to DEV (separate decision), request a sign-in link for an allowlisted mailbox whose gateway pre-fetches URLs (or note the mailbox has none), and
   confirm the click still signs in after the scanner's GET; record the audit rows (`beta.magic_link_issued`, `beta.magic_link_verified`).
4. A scripted `GET` of the link before the click is a useful supplement; it does **not** replace the prefetching-mailbox check in §14 item 2.
