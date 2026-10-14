# AFLDB-ISSUE-304 — Email intake parses the whole body before sender and size checks

## 0. Status

- **Status:** **Resolved (2026-10-15, merge-scoped; opened 2026-10-08).** Implemented and merged as `074c01ae` (fix, tests and records), validated DB-free (§17), merged and pushed (§18). **Not deployed.**
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

~~Implementation (after AFLDB-ISSUE-266).~~ Superseded by §17.

## 17. Implementation and validation (2026-10-15)

### 17.1 Change

- `tools/email_intake/fetch_and_stage.py`: a new `MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024`, the app's upload ceiling (`src/lib/ingest/pipeline.ts` `MAX_UPLOAD_BYTES`). After the CSV attachment is found and before the dry-run branch and the POST, an attachment over it is refused: it is reported (`REJECTED: attachment '<name>' is N bytes, over the 5242880-byte upload limit`), filed to the Errors folder (not in `--dry-run`), counted as rejected, and never base64-encoded or posted. The ceiling is inclusive: an attachment of exactly 5 MiB is still forwarded.
- `src/app/api/admin/email-intake/route.ts`: after the secret check and the work limiter and before `request.json()`, a declared `Content-Length` larger than the base64 limit plus a 16 KiB envelope allowance (`BODY_ENVELOPE_SLACK_BYTES`: three short fields, a filename of at most 200 characters, and punctuation) is answered `400` with the existing "exceeds the 5 MB limit" message without parsing the body. A body that declares no length, or one that cannot be read as a number, is treated as undeclared and parsed as before: a chunked body cannot be bounded this way, and the only caller, the poller, always sends a length.
- No migration; nothing deployed. Both changes sit on top of the ISSUE-266 poller already on `main`.

### 17.2 Tests

- `tools/email_intake/test_fetch_and_stage.py` (the dependency-free self-test; no pytest): `test_main_refuses_an_oversize_attachment_before_posting` drives `main()` over three authenticated messages (an attachment of exactly the limit, one byte over, and a small one), live and `--dry-run`: the oversize one is reported with its size, filed to Errors and never posted, the other two are forwarded, the exit code is the rejection code, and `--dry-run` posts and files nothing. `test_upload_limit_matches_the_app` reads `pipeline.ts` and checks the poller's constant equals the app's.
- `tests/email-intake-route.test.ts` (DB-free): five cases with a stand-in request whose `json()` is a spy: a declared length of the limit plus one is answered 400 and `json()` is never called (and nothing is audited); a length exactly at the limit, no length, and an unreadable length are all parsed; a wrong secret is still answered 401 before the size is looked at.

### 17.3 Results

- **Fixed code.** `python tools/email_intake/test_fetch_and_stage.py`: all checks passed. `tests/email-intake-route.test.ts`: **23 passed**. No database was used. `tests/integration/email-intake.test.ts` was not run: its requests are constructed without a `Content-Length`, which takes the unchanged path.
- **Unfixed source** (`git checkout HEAD -- src tools/email_intake/fetch_and_stage.py`, the fixed files copied back and sha-256 verified): the Python self-test fails (the poller has no limit constant) and the 400 route case fails.
- **Mutants** (`D:\tmp\issue304\mutate.mjs`, one at a time, original bytes restored and hash-verified after each): poller: no cap (P1), cap at `>=` so the boundary file is refused (P2), a different limit (P3), the oversize message not filed (P4), not counted as rejected (P5); route: no check (R1), `>=` (R2), no envelope slack (R3), the check after the parse (R4), the check before the secret (R5), an unreadable length treated as oversize (R6). R6 survived the first test set and was killed by the added unreadable-length case. **All 11 killed.**
- **Static.** `python -m py_compile` of both poller files; `tsc --noEmit` exit 0; `git diff --check` exit 0; ESLint of the route and its test exits 0 on this branch and on unchanged `main`, with the same (empty) problem set.

### 17.4 Limits

- Not deployed; no browser, DEV, PROD, mail or network action. Neither host has an intake timer, so the poller change is dormant until intake is activated (ISSUE-266 runbook §18.10). A chunked request (no `Content-Length`) is not bounded before parsing; no current caller sends one. The poller still holds the whole message in memory while it parses it, and the size is checked after that; only the base64 re-encoding and the POST are avoided. The route's 40 MB case was exercised with a stand-in request, not a real 40 MB body.

## 18. Readiness, merge and closure (2026-10-15)

- **Readiness: accepted under a scoped cleanliness exception, not a clean pass.** `npm run preflight -- --mode implementation --issue 304` on the committed worktree: READY (0 blockers, 3 warnings: `.env`, `psql`, `pg_restore`; raw `D:\tmp\issue304\preflight-1.txt`). `npm run merge:ready -- --issue 304` (raw, unchanged: `D:\tmp\issue304\merge-ready-raw-1.txt`): BLOCKED by exactly one blocker, the primary worktree not clean; every other check PASSed, with two metadata warnings (no runbook readiness JSON block; no automated unexpected-file classification). The seven committed paths were compared with the declared scope by hand: the route and its test, the poller and its self-test, this runbook, `issues.md` and `IssuesIndex.md`.
- **Exception (fresh, this issue only).** The owner authorised an exception covering only that clean-tree FAIL under the exact **18**-path primary state (the nine `.agents/skills` files, the seven zero-byte stray-named files, the literal `$null)` and the zero-byte `2000)`). Immediately before the merge a script verified the 18 paths, their full sha-256 hashes (`$null)` `d9edb146…2500`, unchanged since the session start), no tracked and no staged primary change, and that fresh `main`, `origin/main` and the live remote agreed (`premerge-1.txt`); it read OK again after the push (`postmerge-1.txt`).
- **Merge.** `074c01ae` fast-forwarded onto `main` and was pushed (`47e596ac..074c01ae`); local `main` and `git ls-remote origin refs/heads/main` both equalled `074c01ae` afterwards.
- **Resolution.** Resolved on the push of the documentation-only closure commit. §14 asks for a Python unit test for the poller cap and a route test with an oversized `Content-Length` expecting 400 without parsing; both exist and pass (§17.2, §17.3). The "after ISSUE-266" ordering is met in the repository (the ISSUE-266 poller is on `main`); ISSUE-266 itself remains open for PROD and this issue does not depend on its closure. The closure scope is **merge-scoped**: code on `main`, validated DB-free, **not deployed**.
- **Preserved limits.** Not deployed; no mail, network, DEV or PROD action; the poller is dormant on both hosts. A body with no `Content-Length` is not bounded before parsing. The intake integration file was not run.
