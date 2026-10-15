# AFLDB-ISSUE-280 — Beta magic link is consumed by any GET, including a mail scanner's prefetch

## 0. Status

- **Status:** **Resolved (2026-10-15, DEV-scoped; §22).** History: Open (2026-10-08). **Implemented 2026-10-15 (§18; code `c68e1214`, DB-free validated, merged to `main`); not deployed. The live acceptance (§19) is parked: it needs a deployment, a token write and, for the strict reading of §14 item 2, an email to a mailbox behind a link-scanning gateway.** The issue was **not** resolved at that point; the DEV acceptance of §22 resolved it, DEV-scoped (PROD pending).
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

(Historical; done in §22.) DEV acceptance (§19; the exact actions are in `AFLDB-ISSUE-280-308-279-DEV-ACCEPTANCE.md` §5): deploy, request a link, simulate the prefetch, click. Close only then.

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
audit rows to expect, closure wording) are in `issues/open/AFLDB-ISSUE-280-308-279-DEV-ACCEPTANCE.md` §5, against the pack, revision r2, `D:\tmp\dev-deploy-280-308-20261015-r2\` (the first pack `D:\tmp\dev-deploy-280-308-20261015\` was superseded by r2 before anything ran). Why parked: it needs a deployment of the fix, a DEV data write
(`beta_login_tokens`, `auth_audit_log`), and, for the strict reading of §14 item 2 ("a prefetching mailbox"), an email to a mailbox behind a link-scanning gateway. **§14 is not weakened:** item 1 is met by the DB-free
suite; item 2 closes only on a prefetching mailbox. §17.3 item 3 (use a mailbox whose gateway pre-fetches, "or note the mailbox has none") records what the mailbox is and is **not** an allowance to close on a simulation, and item 4 says the scripted GET "does **not** replace the prefetching-mailbox check in §14 item 2". Closing on the scripted prefetch would be an owner **amendment** of §14 item 2 (decision D-280-2 in the acceptance document), and **no such amendment exists: the decision is pending.**

## 20. Readiness, merge and exception (2026-10-15, evening)

- **Merged and pushed.** Code `c68e1214` (ISSUE-280) and `46cb380e` (the ISSUE-308 review fix) and the records commit `f68ddf51` were fast-forwarded to `main` and pushed (`270ec4d2..f68ddf51`); local `main`, the fetched `origin/main` and the live remote (`git ls-remote`) all equalled `f68ddf51` afterwards. Worktree `D:/dev/afldb-issue-280`, branch `sonnet/issue-280`.
- **The worktree was not made by the standard command.** `npm run worktree:bootstrap -- --issue 280 --branch sonnet/issue-280` was **BLOCKED** ("main is not clean": the sealed 18 paths) and no tooling was changed to get round it. The worktree was created with `git worktree add -b sonnet/issue-280 ../afldb-issue-280 main` (the same base), the `node_modules` junction was added, and `npm run preflight -- --mode implementation --issue 280` then passed (READY, 0 blockers, 3 warnings), before the records commit and again after it. Disclosed: before that worktree existed, the first three new files and a staged deletion of `route.ts` were written in the **primary** checkout; they were copied out, removed and the deletion restored within the same step, nothing was committed there, and the first sealed-18 check afterwards (`precheck-1`) was RESULT OK.
- **Readiness: accepted under a task-specific cleanliness exception, not a clean pass.** `merge:ready -- --issue 280` is **BLOCKED by exactly one FAIL**, `main worktree is clean: D:/dev/afldb`, which lists the primary checkout's 18 untracked paths; every other check PASSed (current branch, issue worktree clean, local main equals recorded origin/main, base/main relationship, migration collision/checksum parity). Two warnings: no runbook readiness metadata, no unexpected-file classification. The raw output is preserved unchanged: `D:\tmp\issue280\evidence\merge-ready-raw-1.txt` (SHA-256 `15a5628bfcbd28fef0c39e3d37664aaf22eb962a5a953f1dc8aff519d79cbe42`).
- **The exception.** The owner's task instruction for this pass was to preserve the exact 18-path checks and the raw readiness results, with any new or changed path stopping the merge, and not to delete recurring strays or widen exceptions. The one FAIL was therefore accepted on the condition that the sealed 18 paths and their full hashes stay unchanged: the nine `.agents/skills` files (full SHA-256 and length equal to the 13 Oct manifests), seven zero-byte files (`0)`, `20` followed by a backtick, a backtick followed by `path`, `i`, `q(sequenceValueSql(qname))))[0]`, `t.kind`, `void`), the 143-byte `$null)` (SHA-256 `d9edb1467a9ddecc7ca89424e5b5597f3c6fae7e5e41b49bb279aa1f71f62500`) and the zero-byte `2000)`. The script is a byte-identical copy of `exception-check.py` used on 15 Oct (SHA-256 `01385ac0a0222a6e790a2cf25c632bc8aa1aec63c5202faa50a54381e32db820`). It compared them in full at `precheck-1` and `precheck-2`, `precheck-merge-1` (before `merge:ready`), `premerge-1` (immediately before the merge), `postmerge-1` and `postpush-1`: **every one RESULT OK**, no `TARGET` or other nineteenth path present at any check, no tracked or staged change in the primary. No stray was deleted, moved or ignored in this pass. Not a standing exception.
- **This section was added by a later records-only commit** (the tip after `f68ddf51`; a commit cannot name its own SHA), merged and pushed under the same exception: its `merge:ready` result was again exactly the one primary clean-tree FAIL, raw output preserved as `D:\tmp\issue280\evidence\merge-ready-raw-2.txt`, with the sealed-18 check run again before and after the merge and after the push. The pack's pinned TARGET is that later tip.
- **Not deployed.** Neither the DEV nor the PROD revision contains this change. The unexecuted combined deployment and acceptance procedure is `AFLDB-ISSUE-280-308-279-DEV-ACCEPTANCE.md`.

## 21. DEV deployment and parked acceptance (2026-10-15, 22:00-22:12 AEDT; stays OPEN)

- **Deployment.** DEV was installed with `0cb3d20c` by one gated run on 2026-10-15 (22:03:13-22:07:15 AEDT; sync-dev exit 0; `f07c2a74..0cb3d20c` fast-forward; `npm ci`; `db:migrate` reported 110 applied and nothing to apply; build; BUILD_ID `jfwHG_Ru35eHV1Q9_O6oy`; MainPID 1800181 -> 2084219; health ready; one restart; no retry, no rollback). Installation checks (`i-checks.sh`) exit 0 / PASS; S0 manifest 56/56; Pin-Check PASS; gate PASS; H4 exit 10 = the authorised EXCEPTED-FAIL (the one clean-tree FAIL, sealed 18 paths equal at P1 and P5, 110/110 migration parity); post-browser journal check PASS (408 lines, 0 matches).
- **Result.** ISSUE-280 (installed, acceptance PARKED): the new confirmation page is in the DEV build (an obviously bogus token on `GET` and `HEAD /beta/verify` returned 200 with the "Confirm sign-in" page, no `Location`, no `Set-Cookie`; a shape check, not acceptance). Under D-280-1 the acceptance parks: DEV has **no SMTP configuration** (every `AFLDB_SMTP_*` key unset), so it cannot deliver a link, and a link would only be logged, with its credential, in the service journal; no SMTP change, allowlist change or token was authorised, so **no token was issued and no prefetch simulation, confirmation or replay ran**. The D-280-2 amendment is recorded and unused. ISSUE-280 stays OPEN. Next action (owner): decide how DEV can deliver or expose a link for one issuance to `stuart.villanti@gmail.com` (SMTP configuration, or an explicit decision to read the journal-logged link), confirm that address is allowlisted and not revoked, then run `issues/open/AFLDB-ISSUE-280-308-279-DEV-ACCEPTANCE.md` §5.4 A1 steps 1-6 and 8 under the amended criterion with a separate beta-test browser context.
- **Amendment (D-280-2).** **D-280-2 (owner, 2026-10-15), recorded as an explicit amendment of R280 §14 item 2.** Original criterion, preserved as history: "a manual DEV check with a prefetching mailbox". Amended criterion: the reviewed simulated prefetch (`prefetch-sim.py`: scanner-like GETs and a HEAD) against the real deployed application leaves the token usable, then a human confirmation succeeds once and a replay is refused with no further `beta.magic_link_verified` event. Actual link-scanning gateway behaviour **remains untested**.
- **Closure.** Not met: no token was issued, so none of the amended criterion's steps ran. §14 item 1 (DB-free suite) stands. PROD installation and acceptance pending.
- Evidence (workstation, not in the repository): `D:\tmp\dev-deploy-280-308-20261015-r2\run-20261015-2201\` (`SHA256SUMS.txt`; owner decisions verbatim in `OWNER-DECISIONS.md`; per-step results in `accept\ACCEPTANCE-RESULTS.md`).
- **Readiness, merge and exception (records commit `0471ecad`, merged and pushed `0cb3d20c..0471ecad` on 2026-10-15).** Worktree `D:/dev/afldb-issue-280` (branch `sonnet/issue-280`, reused: it was at `0cb3d20c`, equal to `main`). `merge:ready -- --issue 280` is **BLOCKED by exactly one FAIL**, `main worktree is clean: D:/dev/afldb` (the primary checkout's 18 untracked paths); every other check PASSed (current branch, issue worktree clean, local main equals recorded origin/main, base/main relationship, migration collision/checksum parity); two warnings (no runbook readiness metadata, no unexpected-file classification). Raw output preserved unchanged: `D:\tmp\dev-deploy-280-308-20261015-r2\run-20261015-2201\evidence\merge-ready-raw-1.txt` (SHA-256 `e00378f2b886024a8c7927b854fd10df7efe6cc782a1863a4b3ea7551ae904fb`). The FAIL was accepted only under the owner's scoped clean-tree exception (D-DEV-280-308-CLEAN, applied by the same instruction to the commits and merges): the sealed 18 paths (nine `.agents/skills` files by full SHA-256, seven zero-byte files, the 143-byte `$null)` with SHA-256 `d9edb1467a9ddecc7ca89424e5b5597f3c6fae7e5e41b49bb279aa1f71f62500`, and zero-byte `2000)`) were compared in full by `exception-check.py` (byte-identical to the 15 Oct copy, SHA-256 `01385ac0a0222a6e790a2cf25c632bc8aa1aec63c5202faa50a54381e32db820`) at `precheck-1`, `precheck-2`, `precheck-merge-1`, `premerge-1`, `postmerge-1` and `postpush-1`: **every one RESULT OK**, no nineteenth path, no tracked or staged change in the primary. Local `main`, the fetched `origin/main` and the live remote (`git ls-remote`) all equalled `0471ecadad605c13ad4d9af6d2063df6e7818300` after the push. No stray was deleted, moved or ignored and no exception was widened. Not a standing exception. This paragraph was added by a later records-only commit (a commit cannot name its own SHA), merged and pushed under the same exception.

## 22. DEV acceptance and resolution (2026-10-15, 22:26-22:55 AEDT; Resolved, DEV-scoped)

DEV stayed at `0cb3d20c` (BUILD_ID `jfwHG_Ru35eHV1Q9_O6oy`); no redeployment. **D-280-1 amended (owner, 2026-10-15):** one magic-link issuance for `stuart.villanti@gmail.com` through DEV's existing journal fallback; no SMTP configuration and no external email. The address was first verified allowlisted and not revoked (`/admin/access`, read-only). Under the D-280-2 criterion (reviewed simulated prefetch, one human confirmation, refused replay): one link issued at 11:50:30 UTC (audit `beta.magic_link_issued`, `delivered=false`; exactly one journal line, redacted in every record); the owner obtained it privately (their own terminal read the journal line, the clipboard excluded from history) and pasted it into the hidden box of an isolated test-browser window; it was never in chat and never saved. Before confirmation, `prefetch-sim.py --expect confirm`: 3 GET 200 "Confirm sign-in", no `afldb_beta` cookie, no `Location`, HEAD 200, EXPECTATION MET (token sha256[:8] `8c6493a5`, 43 characters); audit before confirmation: issued present, **no** verified event (1,072 events; baseline 1,071). The owner pressed "Sign in to the beta" once at 11:51:19 UTC (I issued no click): httpOnly `afldb_beta` cookie, landed on `/`, exactly one `beta.magic_link_verified`. Replay in a brand-new cookie-less browser context (the link was read inside the browser process from the test page's history, never printed): GET 200 confirmation page, no `Set-Cookie`, no `Location`, robots `noindex, nofollow`, referrer `no-referrer`; the button pressed once; redirected to `/beta` with no cookie; the audit then still showed exactly one verified event (1,073 events = baseline + issued + verified; no `beta.magic_link_revoked_email`). Journal check since 22:27:31: PASS (523 lines; the three `ERROR` matches are HTTP-200 requests for the static chunk `error-*.js`; no syntax error, unhandled, ECONNREFUSED or digest line). Visual: V-280-1 (desktop 1280x800) and V-280-2 (mobile 390x844, no horizontal overflow) were captured at replay time, i.e. of the same link's confirmation page after its token was spent (a GET reads no table, so the page is identical), because the owner clicked before the unused page could be captured; V-280-3 is the signed-in landing. Screenshots are viewport-only; URL metadata is path `/beta/verify` with `token=<redacted>`. Credential hygiene: a leak scan of the evidence found no token or link. Effects: `beta_login_tokens` +1 row (hash only, now used), `auth_audit_log` +2; no allowlist, settings, `.env`, hook, schema or SMTP change; no email; PROD untouched. 
- **Limits:** actual link-scanning gateway behaviour remains untested (D-280-2); the pre-fix defect was not reproduced on the previous build (the optional control was not authorised); the replay and the captures were driven by the browser tool, the confirmation click was the owner's. PROD installation and acceptance pending. Evidence (workstation, not in the repository): `D:\tmp\dev-deploy-280-308-20261015-r2\run-20261015-2227-280\` (`SHA256SUMS.txt`, 18 files; decisions verbatim in `OWNER-DECISIONS.md`; results in `accept\ACCEPTANCE-RESULTS.md`).

- **Evidence-path check (2026-10-15).** The earlier run folder `D:\tmp\dev-deploy-280-308-20261015-r2\run-20261015-2201\` was re-verified: 33 files, every SHA-256 in its `SHA256SUMS.txt` matches, no file is unsealed, `evidence\merge-ready-raw-1.txt` is `e00378f2b886024a8c7927b854fd10df7efe6cc782a1863a4b3ea7551ae904fb`, and every record that cites that folder names a path that exists; none of those references needed correcting. The one mistaken path found was the superseded first pack `D:\tmp\dev-deploy-280-308-20261015\` named as the live pack in the ISSUE-280 runbook §19 and the `issues.md` ISSUE-280 entry; both now name the r2 pack. The same first-pack name remains, as dated history, in `blockers.md` R24, `AFLDB-ISSUE-279.md` §20 and the combined procedure's header table (which says the first pack is superseded).
- **Criteria.** §14 item 1 (the DB-free suite, 12 cases) stands. §14 item 2 was amended by the owner (D-280-2): the simulated prefetch plus one human confirmation and a refused replay replaces a prefetching-mailbox demonstration; the original wording is preserved in §14 and in the combined procedure §3. PROD installation and acceptance remain pending; the incidence of real scanner prefetch stays unmeasured (§17.2).
- **Visual-evidence amendment (owner, 2026-10-15, recorded after the acceptance run).** The Visual Evidence Mandate (captured images of the changed page) is unchanged, and the deviation stays on record: V-280-1 (desktop) and V-280-2 (mobile) show the confirmation page of the same link after its token was spent, not an unused token's page, because the owner clicked before the unused page could be captured. The owner accepts these images as evidence of the confirmation page's **appearance only**; the functional acceptance rests on the actual prefetch-simulation results and the audit sequence recorded above (issued, no verified event before confirmation, exactly one verified event after, none from the replay). They are not screenshots of an unused-token page and are not claimed to be. The original requirement and the replay-time disclosure are preserved.
