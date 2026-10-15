# AFLDB-ISSUE-303 — `/admin/upload` promises 5 MB but Server Actions accept 1 MB

## 0. Status

- **Status:** Open (2026-10-08). D-303-1 decided by the owner (option c, a dedicated Route Handler). Implemented 2026-10-15 as `50f9345b`, validated on `afldb_test` (§17), merged and pushed (§18); not deployed. **Stays open:** the runbook's DEV acceptance (§14: a 1.5 MB CSV staged through the real proxy and browser) cannot be run without a deployment, and the page is `VISUAL: UNVERIFIED`.
- **Severity:** Low. **Area:** legacy CSV intake UI / framework configuration.
- **Key files:** `next.config.ts`, `src/app/admin/upload/actions.ts`, `src/app/admin/upload/UploadForm.tsx`, `src/lib/ingest/pipeline.ts`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-038; partition note R5a-F06). The main session confirmed the framework behaviour.
- **Classification:** code-proven, framework-confirmed.

## 1. Summary

The upload form posts the CSV through a Server Action, and the action and pipeline enforce 5 MB. `next.config.ts` sets no `experimental.serverActions.bodySizeLimit`, so Next's 1 MB default applies, multipart included. A 1–5 MB file fails at the framework boundary with a generic error before `uploadSubmission` runs. The email ingress accepts up to 5 MB, so the two paths disagree.

## 2. Evidence

- `next.config.ts:82-100` (no `bodySizeLimit`).
- `src/app/admin/upload/actions.ts:19` and `src/lib/ingest/pipeline.ts:27` (5 MB).
- `src/app/admin/upload/UploadForm.tsx:18`.
- The framework, as installed:
  - `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md:29` ("By default … 1MB").
  - `node_modules/next/dist/server/app-render/action-handler.js:517-519` (`defaultBodySizeLimit = '1 MB'`) and `:669-671` (multipart enforcement, 413).
- The same constraint is already documented for the media upload in `src/app/admin/content/media/route.ts:13-17`.

## 3. Trigger

Upload a 1.5 MB CSV at `/admin/upload`.

## 4. Expected invariant

The documented 5 MB limit applies.

## 5. Actual behaviour

A 413 at the framework layer, and a generic failure in the UI.

## 6. First wrong layer

`next.config.ts` (the limit is not configured).

## 7. Impact

Files of 1–5 MB cannot be uploaded through the form. No data effect.

## 8. Reproduction / witness

Not executed (needs a running app). Framework behaviour confirmed from source.

## 9. Disproof attempts

Caddy imposes no lower body limit on `/admin` (`deploy/Caddyfile*`).

## 10. Existing-issue search

`bodySizeLimit|1 MB` in `issues.md`: none. Classification: **new**.

## 11. Scope

The upload size contract.

## 12. Out of scope

The email ingress limits (AFLDB-ISSUE-304).

## 13. Proposed fix boundary

Either set `experimental.serverActions.bodySizeLimit: '6mb'`, or lower the 5 MB constant and the UI text to 1 MB.

## 14. Proposed validation

On DEV, upload a 1.5 MB CSV and get a successful stage, or a clear message.

## 15. Decisions / unresolved questions

- D-303-1: raise the global action limit, or lower the upload limit (operator). A global raise widens every action.

## 16. Next action

~~D-303-1.~~ Superseded by §17.

## 17. Implementation and validation (2026-10-15)

**Decision D-303-1 (owner, 2026-10-15): option (c).** A dedicated upload Route Handler with a bounded 5 MiB file limit, preserving authentication, authorisation and CSRF protection. Neither runbook alternative was taken: the global `serverActions.bodySizeLimit` is untouched, and the 5 MB promise is kept.

### 17.1 Change

- **New `POST /admin/upload/stage`** (`src/app/admin/upload/stage/route.ts`). In this order: (1) the request must be same-origin (`sameOriginRefusal`: `Sec-Fetch-Site`, where present, must be `same-origin`; `Origin` must be present and its host must equal `X-Forwarded-Host` (first value) or `Host`, which is Next's own Server Action origin check, absent for a Route Handler) or it is a 403 before the session is consulted; (2) `await requireCapability('acquisition.legacyIntake')`, which re-checks the session against the database exactly as the page and the old action did, under `/admin` so middleware demands an admin cookie first; (3) a declared `Content-Length` over the 5 MiB file limit plus a 16 KiB multipart envelope is a 413 before any of the body is read, and a non-numeric one is a 400; (4) the body is read through `readBoundedBody`, which stops and cancels the stream at that bound whatever the client declared (chunked or lying), so no oversized upload is buffered; (5) the multipart is parsed from the bounded bytes, the file is checked against `MAX_UPLOAD_BYTES` again, and the unchanged `stageSubmission` and the same `upload.staged` / `upload.duplicate` / `upload.rejected` audit events run. It answers JSON (`redirectTo` on success; 400, 403, 413 or 422 with `error`).
- `src/lib/ingest/upload-request.ts` (new, pure): `sameOriginRefusal`, `declaredLengthCheck`, `readBoundedBody`, `maxUploadBodyBytes`, the envelope constant.
- `src/app/admin/upload/UploadForm.tsx` posts the form with `fetch` to the route and follows `redirectTo` with the router. The markup is unchanged. Anything that is not the route's JSON (a session that ended is answered with a redirect to the sign-in page, which `fetch` follows to HTML) shows "Your session may have ended. Reload the page and sign in again."
- `src/app/admin/upload/actions.ts` (the 1 MB Server Action) is removed, so there is one upload path and no forgeable second one. Nothing else referenced it.
- The cookies are `SameSite=Lax` (unchanged), which is the first CSRF layer; the origin check is the second, independent one. Next buffers a proxied request body for the route up to `proxyClientMaxBodySize` (default 10 MB, `node_modules/next/dist/docs/.../proxyClientMaxBodySize.md`); 5 MiB plus the envelope is under it, so the default is left alone.

### 17.2 Tests

- `tests/admin-upload-route.test.ts` (DB-free, new, 25 cases) drives the real route and the real helpers with a mocked session and pipeline: a 1.5 MB CSV is staged byte for byte; exactly 5 MiB is staged and one byte more is a 413 with the old message; duplicate and rejection audit events; no file, not multipart, a malformed length; the session is asked for `acquisition.legacyIntake` first and before any body byte is pulled; eight cross-site shapes are refused before the session is consulted; the proxied `X-Forwarded-Host` form is accepted; a declared oversize length is refused with the stream never read; a chunked body is cancelled within one chunk of the bound; and static pins (the order of the checks, the limit is the pipeline's own, the global limit is untouched, the form posts to the route, the old action is gone).
- `tests/integration/admin-upload-route.test.ts` (PostgreSQL, new, 3 cases): the real route and the real staging pipeline on `afldb_test` with only the session stubbed: a 1.5 MB `match_attendance` CSV is staged (status `staged`, the file's sha-256, the row count equal to the CSV's, the `upload.staged` audit event), the same bytes again land on the same submission, a file over 5 MiB is refused with nothing staged, and a missing column is a 422 with `upload.rejected`.

### 17.3 Results

- **Authority.** `D:\tmp\issue283\run-int.mjs` derived and proved the three DSNs against `afldb_test` before vitest started; no credential was printed. The cases created one fixture user and their own submissions and removed them by id in `afterAll`; `D:\tmp\issue303\residue.mjs` read 0 afterwards. No `afldb_dev`, PROD, migration or repair.
- **Fixed code.** DB-free route file **25 passed**; integration **3 passed**; `tests/auth.test.ts` (the capability contract that reads every `route.ts`) and `email-intake-route` 224 passed.
- **Mutants** (`D:\tmp\issue303\mutate.py`): the origin check removed, the session check removed, the declared-length check removed, an unbounded `request.arrayBuffer()`, the file limit doubled, `Sec-Fetch-Site` ignored, the host not compared, the read bound loosened fourfold, and the limit lowered to 1 MiB. **9 of 9 killed.** A tenth, accepting a missing `Origin`, is equivalent: the missing header still reaches `new URL(...)`, which throws and refuses.
- **Static.** `tsc --noEmit` exit 0; ESLint of the changed files clean; `git diff --check` clean.
- **Production build** (`npm run build` on merged `main`, 15 Oct): `Compiled successfully` and `Finished TypeScript`, so the new route and the client form compile and type-check under Next 16.3.1; the build then stopped at "Collecting page data" with `ECONNREFUSED 127.0.0.1:5432` (this workstation has no database on that port), so it is **not a completed build** and says nothing about runtime behaviour. Raw `D:	mpatch1015uild-main.txt`.
- **Whole DB-free suite:** the same files fail as on unchanged `main` in this environment, plus two that depend on a worktree having no `.env` (`admin-coach-actions` fails to load without `DATABASE_URL`; a DraftGuru bridge-gate case stops on the Stage A snapshot, a git-ignored file a worktree does not carry); none touches the upload. Raw `D:\tmp\issue303\dbfree.txt`.

### 17.4 What is NOT shown (why this issue stays open)

- **DEV acceptance (runbook §14).** "On DEV, upload a 1.5 MB CSV and get a successful stage" needs the change deployed to DEV and an authenticated browser. Tests cannot show the framework's body buffering for a proxied request, Caddy's behaviour, a real browser's `Origin` and `Sec-Fetch-Site` values, or the session-ended path. No deployment was authorised.
- **`VISUAL: UNVERIFIED`.** The form's markup is unchanged and its behaviour changed (it now posts with `fetch`); no screenshot exists and nobody has seen the page.
- No progressive enhancement: the form needs JavaScript (it did not before, as a Server Action form degrades to a normal POST).
- Not deployed; no browser, DEV or PROD action.

### 17.5 Next action

Deploy to DEV (operator-authorised), then, signed in as an uploader, stage a 1.5 MB CSV and a file just over 5 MB through `/admin/upload`, with a screenshot of the form, its error message and the review page; confirm one `upload.staged` audit row. Then close.

## 18. Readiness and merge (2026-10-15; the issue stays open, §17.4)

- **Readiness: accepted under a scoped cleanliness exception, not a clean pass.** `npm run preflight -- --mode implementation --issue 303` on the committed worktree: READY (0 blockers, 3 warnings: `.env`, `psql`, `pg_restore`; raw `D:\tmp\issue303\preflight-1.txt`). `npm run merge:ready -- --issue 303` (raw, unchanged: `D:\tmp\issue303\merge-ready-raw-1.txt`): BLOCKED by exactly one blocker, the primary worktree not clean; every other check PASSed, with two metadata warnings (no runbook readiness JSON block; no automated unexpected-file classification). The committed code paths were compared with the declared scope by hand.
- **Exception.** The owner retained the exact **18**-path primary-state exception for this batch (the nine `.agents/skills` files, the seven zero-byte stray-named files, the literal `$null)` and the zero-byte `2000)`), covering only that clean-tree FAIL. A 19th path, a zero-byte `0` created at 11:47 that day, appeared and made the exact-path check fail; the owner answered a direct question by authorising its deletion, and it was deleted (empty, untracked) before any merge. Immediately before the merge a script verified the 18 paths, their full sha-256 hashes (`$null)` `d9edb146...2500`, unchanged), no tracked and no staged primary change, and that fresh `main`, `origin/main` and the live remote agreed (`premerge-1.txt`); it read OK again after the push (`postmerge-1.txt`).
- **Merge.** `50f9345b` fast-forwarded onto `main` and was pushed (`69dd22e5..50f9345b`); local `main` and `git ls-remote origin refs/heads/main` were compared afterwards. Merge-scoped only; not deployed. The issue is not resolved.

## 19. Complete build on merged `main` (2026-10-15, after the merge; supersedes the "not a completed build" caveat in §17.3 only as to the build)

**Earlier result and its cause.** The first `npm run build` on merged `main` compiled and type-checked and then stopped at "Collecting page data" with `ECONNREFUSED 127.0.0.1:5432`. That was an **environment limitation, not a code failure**: `generateStaticParams` and prerendered pages query PostgreSQL through `src/db/client.ts` (`DATABASE_URL`), and this workstation has no database on that port.

**How the build was completed.** `D:\tmp\build1015\run-build.mjs` ran the same two steps as `npm run build` (`next build --webpack`, then `node tools/build/prepare-standalone.mjs`) as child processes whose environment was set for the child only; no `.env` was copied or edited and no credential was printed. `DATABASE_URL` was derived in memory from the primary `.env` and forced to `127.0.0.1:55432` (the existing tunnel), database `afldb_test`, role `afldb_app` (the read-only application role), with `default_transaction_read_only=on` as a startup parameter. `AFLDB_IMPORT_`, `AFLDB_OWNER_`, `AFLDB_TEST_`, `AFLDB_BACKUP_` and `AFLDB_AUTH_DATABASE_URL` were replaced by an unroutable sentinel so any unexpected use would have failed loudly; none did. Assertions ran **before** the build and would have aborted it: `current_database()` = `afldb_test`; session read-only `on`; role not superuser and without create-db/create-role/replication/bypass-RLS; **0** relations on which the role holds INSERT, UPDATE, DELETE or TRUNCATE; a `CREATE TABLE` probe in the session refused by the server (SQLSTATE 25006). The application's build-time database access goes through that one `DATABASE_URL` client (a search of `src/` finds the other connection settings read inside functions, not at module load), and the build log contains no sentinel or connection error.

**Result (HEAD `c658360f15258289935b25e6ea20c191028cac2c`).** `next build` exit 0 (compiled in 7.1 s, TypeScript 4.0 s, page data collected, **1515/1515** static pages in 17.9 s) and `prepare-standalone` exit 0 ("confirmed no .env* anywhere under .next/standalone", static assets and public copied, standalone bundle ready); total 38 s; `BUILD_ID` `sdFnlzU2-15I3VdqOWYnB`. `/admin/upload` and `/admin/upload/stage` are listed as dynamic routes. The log carries one framework deprecation warning (the `middleware` file convention is deprecated in favour of `proxy`), reported as it appeared. Evidence (outside the repository): `D:\tmp\build1015\run-20261015-a\` (`build.log` sha-256 `0e4da32917978b4164d4f34dcc4a97af652c9dfe268e17830e236e07fd8cea76`, `launcher.txt` `22bf9d71468f553e9125ba89196294d6d1f6adc271d46068f458cb015bdb6500`).

**What this does and does not show.** The merged tree builds under Next 16.3.1, and the new route compiles, type-checks and is registered. It was prerendered against `afldb_test`'s data, so it says nothing about DEV or PROD data, nothing about runtime behaviour, and the output is a workstation artefact, not a deployable one (a deployment builds on the host). It does **not** meet this issue's acceptance, which is unchanged (§17.4 and §17.5).
