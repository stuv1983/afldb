# AFLDB-ISSUE-303 — `/admin/upload` promises 5 MB but Server Actions accept 1 MB

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
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

D-303-1.
