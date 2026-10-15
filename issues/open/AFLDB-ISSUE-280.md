# AFLDB-ISSUE-280 — Beta magic link is consumed by any GET, including a mail scanner's prefetch

## 0. Status

- **Status:** Open (2026-10-08). **Implemented 2026-10-15 (§18; code `c68e1214`, DB-free validated, merged to `main`); not deployed. The live acceptance (§19) is parked: it needs a deployment, a token write and, for the strict reading of §14 item 2, an email to a mailbox behind a link-scanning gateway.** The issue is **not** resolved.
- **Severity:** Low. **Area:** beta gate / authentication UX.
- **Key file:** `src/app/beta/verify/` (the old `route.ts` is deleted by the fix; see §18).
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

DEV acceptance (§19; the exact actions are in `AFLDB-ISSUE-280-308-279-DEV-ACCEPTANCE.md` §5): deploy, request a link, simulate the prefetch, click. Close only then.

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

## 18. Implementation (2026-10-15; branch `sonnet/issue-280`, base `270ec4d2`; code commit `c68e1214`; merged to `main`; not deployed)

- **Mechanism (the §13 boundary).** `GET /beta/verify?token=` now renders a one-button confirmation page and reads **no table**; the burn moved to a Server Action posted by that page's form.
  - `src/app/beta/verify/route.ts`: **deleted** (it was the only handler; a route handler and a page cannot share a segment).
  - `src/app/beta/verify/page.tsx` (new, server component, `dynamic = 'force-dynamic'`, `robots: noindex`, `referrer: no-referrer`): a token outside 20-100 characters redirects to `/beta`; otherwise it renders `VerifyForm` with the token. No database import.
  - `src/app/beta/verify/VerifyForm.tsx` (new, client): `useActionState(confirmMagicLink, {})`, a hidden `token` field and one button, **Sign in to the beta**.
  - `src/app/beta/verify/actions.ts` (new, `'use server'`): `confirmMagicLink` is the old handler body unchanged in substance: token-length check, the 20-per-15-minutes per-caller limit (now answered as `{ error }` instead of a 429 body), the single-use `UPDATE beta_login_tokens … RETURNING email`, the allowlist re-check (`beta.magic_link_revoked_email` audit and no cookie when revoked), `beta.magic_link_verified` audit, `grantBetaAccess`, redirect to `/`. A token that matches nothing still redirects silently to `/beta`.
  - The emailed URL is unchanged (`${AFLDB_BASE_URL}/beta/verify?token=…`), so links already issued keep working, and `/beta` stays a public prefix in `src/middleware.ts`. `docs/admin-and-beta.md` §3 describes the confirmation page.
- **Validation (DB-free; 2026-10-15, Windows).** `tests/beta-verify.test.ts` (new; no existing suite covered the beta gate): **12 cases**: the page runs no statement and hands the token to the form; bad tokens redirect with no statement; the action burns the **hashed** token with the single-use predicate (`SET used_at = now()`, `token_hash`, `used_at IS NULL`, `expires_at > now()`), audits and grants; **three scanner GETs then one click signs in exactly once and the replay is refused** (a stateful fake of the token predicate, so the sequence is exercised); revoked allowlist entry audited and not admitted; unknown token admitted nowhere; length checks before any statement; the 21st attempt from one caller runs no statement; source contracts (no `route.ts`, the page reads no database, only the action touches `beta_login_tokens`, the emailed link and the middleware prefix are intact). **11 of 11 mutants killed** (GET burns; action does not burn; no allowlist re-check; no rate limit; no `verified` audit; no cookie grant; form drops the token; form not wired; form action detached; both length checks), restored byte-for-byte (`D:\tmp\issue280\evidence`, mutation script in the job directory). `tsc --noEmit` exit 0; ESLint of `src/app/beta` and the new test: 0 errors, 1 warning that was already there (`beta/actions.ts:53`, an unused disable directive); `git diff --check` exit 0.
- **Visual Evidence Mandate.** The change adds a user-visible page. Captures of the page's **real markup with the site's real stylesheets**, rendered in isolation (a vitest-rendered `renderToStaticMarkup` of `BetaVerifyPage` inside an approximated header and `main`, then Playwright from this repository's install): `D:\tmp\issue280\confirm-{light,dark}-{desktop,mobile}.png` (1280x720 and 390x844; no horizontal overflow in any of the four; one review iteration centred the button). **These are not the live page**: no layout, no fonts loaded by the real shell, no server action wiring, no hydration. The live captures V-280-1..3 are part of the acceptance (§19). Until they exist the live page is `VISUAL: UNVERIFIED`.
- **Not run:** the page and the action inside a running application (a local `next dev` was started and stopped: the shell needs a database, `DATABASE_URL is not set`, and Turbopack refuses a junctioned `node_modules`; with `--webpack` the layout still threw for the missing database, so no live render was possible), any PostgreSQL or integration test, any browser against DEV, the deployment, any email.
- **Tracking.** CHANGELOG `Unreleased` records the change; `IssuesIndex.md`, `issues.md` and `blockers.md` are updated. No new issue is created. The unmeasured incidence (§17.2) stays unmeasured.

## 19. Live acceptance, parked (prepared 2026-10-15; nothing executed)

The exact actions (mailbox and recipient decision D-280-1, the token lifecycle, the scripted prefetch `acceptance\280\prefetch-sim.py`, the optional "before" control on the previous revision, the images V-280-1..3, the
audit rows to expect, closure wording) are in `issues/open/AFLDB-ISSUE-280-308-279-DEV-ACCEPTANCE.md` §5, against the pack `D:\tmp\dev-deploy-280-308-20261015\`. Why parked: it needs a deployment of the fix, a DEV data write
(`beta_login_tokens`, `auth_audit_log`), and, for the strict reading of §14 item 2 ("a prefetching mailbox"), an email to a mailbox behind a link-scanning gateway. **§14 is not weakened:** item 1 is met by the DB-free
suite; item 2 closes only on a prefetching mailbox, or on the owner's recorded decision that the scripted prefetch stands in because none exists (the allowance in §17.3 item 3).
