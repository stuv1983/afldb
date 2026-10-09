# AFLDB-ISSUE-304 — Email intake parses the whole body before sender and size checks

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
- **Severity:** Low. **Area:** legacy CSV intake / email ingress resource bounds.
- **Key files:** `src/app/api/admin/email-intake/route.ts`, `tools/email_intake/fetch_and_stage.py`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-039; partition note R5a-F07).
- **Classification:** code-proven.

## 1. Summary

The poller forwards an attachment of any size from any mail-authenticated sender, and with AFLDB-ISSUE-266 that includes a forged one. It base64-encodes the attachment into a JSON POST. The route runs `request.json()` on the whole body before it looks up the sender or checks the base64 length.

## 2. Evidence

- `tools/email_intake/fetch_and_stage.py:230-239` (no size cap) and `:385-402` (the sender is checked only for mail authentication before the POST).
- `src/app/api/admin/email-intake/route.ts:103-108` (`request.json()`), `:128` (sender lookup) and `:142-145` (`MAX_BASE64_LENGTH`).

## 3. Trigger

An authenticated sender (any DMARC-aligned public mailbox) emails a 40 MB `.csv`.

## 4. Expected invariant

The size is bounded before the whole body is parsed.

## 5. Actual behaviour

About 53 MB is parsed into an app worker's memory, then answered with 403 or 400.

## 6. First wrong layer

`route.ts:103-108`; `fetch_and_stage.py:230-239`.

## 7. Impact

Memory pressure on the app worker and on the poller. Bounded by the mail provider's attachment limit, the `INTAKE_WORK` limiter (200 per 15 minutes) and the sequential poller.

## 8. Reproduction / witness

Not executed.

## 9. Disproof attempts

There is no `Content-Length` pre-check.

## 10. Existing-issue search

None. Classification: **new**. Cross-references AFLDB-ISSUE-266.

## 11. Scope

Ingress size ordering.

## 12. Out of scope

Sender authentication (AFLDB-ISSUE-266).

## 13. Proposed fix boundary

- The poller refuses attachments over the upload maximum before the POST.
- The route compares `Content-Length` against `MAX_BASE64_LENGTH` plus slack before parsing.

## 14. Proposed validation

1. A Python unit test for the poller cap.
2. A route test with an oversized `Content-Length`, expecting 400 without parsing.

## 15. Decisions / unresolved questions

None.

## 16. Next action

Implementation (after AFLDB-ISSUE-266).
