# AFLDB-ISSUE-168 — Admin player-link suggestion URLs omit player ID and 404

**Status:** **RESOLVED on DEV — 2026-09-14.** Merged to `main` (`9e97c90`) and deployed to DEV at
SHA `9e97c9091f2e5dd662f7166408de8d70b8a495f8`. Manual DEV acceptance passed: `/admin/player-links`
rendered normally, a suggested AFLDB player link was clicked, it resolved successfully to the real
player page via the canonical slug-plus-id route, and the prior 404 did not reproduce. Read-only
acceptance — no player-link mutation was submitted. **PROD still carries the pre-fix code** and
will keep 404ing this link until a future normal production deployment; PROD is not fixed by this
resolution.

**Branch:** `sonnet/issue-168-player-link-url`
**Worktree:** `D:\dev\afldb-issue-168`
**Base:** `origin/main` @ `9874222`

## Symptom

On `/admin/player-links`, the suggested-AFLDB-player link next to a queue row 404s when clicked,
and Next's prefetch logs a 404 per suggestion. Public player pages are unaffected — this is
confined to the one admin link. Found during the `AFLDB-ISSUE-156` P4 authenticated rendered PROD
acceptance on 2026-09-14 (see the `AFLDB-ISSUE-156` entry in `issues.md`, *Authenticated rendered
PROD acceptance — PASS (2026-09-14)*), as one of two non-blocking defects noted there but not
allocated an ID at the time.

## Root cause

`src/app/admin/player-links/page.tsx:639` built the link as:

```tsx
<Link href={`/players/${match.playerSlug}`}>{match.playerName}</Link>
```

omitting the `-${id}` suffix the public player route requires. The canonical helper is
`playerPath(slug, id)` (`src/lib/format.ts:187`), returning `/players/<slug>-<id>`, already used
at every other player-link call site: `src/app/sitemap.ts`, `src/search/constants.ts`,
`src/app/admin/data-editor/MatchSheetEditor.tsx`, `src/app/admin/coaches/[id]/page.tsx`,
`src/app/admin/coaches/LinkagePanel.tsx`. This was the sole exception. A repo-wide search for the
same `/players/${...}` shape, and for `playerSlug` anywhere else under
`src/app/admin/player-links/`, confirmed no second instance of the same bug. Introduced by
`88c2681` (`AFLDB-ISSUE-075`), long before the current release.

## Fix

`src/app/admin/player-links/page.tsx`:

- import `playerPath` from `@/lib/format`;
- replace the literal template string with `playerPath(match.playerSlug, match.playerId)`.

Nothing else in the file changed. No refactor of the page, no change to matching/confidence
logic, no routing change.

## Regression test

New file `tests/player-links-page.test.ts` — no existing suite renders this page.
`tests/player-link-mutations.test.ts` (the closest existing Player Links suite) covers server
actions/mutations only, never the page's own render, so a new file is the correct home per
CLAUDE.md's test-reuse rule.

The test mocks the page's query and auth dependencies (the pattern already used by
`tests/admin-audit-viewer.test.ts`), stubs the three `'use client'` leaf components
(`RefreshSuggestionsControls`, `SuggestionControls`, `ResolvePanel` — irrelevant to this link, and
each needs an app-router context a plain unit test doesn't have), renders `PlayerLinksPage` with
one queue row and one cached suggestion, and asserts via `renderToStaticMarkup` that the output
contains `href="/players/jonathan-smith-42"` and not `href="/players/jonathan-smith"`.

Confirmed red/green by hand: reverting the fix locally reproduces the failure (rendered output
contains `href="/players/jonathan-smith"`, no `-42`) before the fix was restored and the test
re-run green.

## Validation

- `npx vitest run tests/player-links-page.test.ts` — 1/1 pass.
- `npx vitest run tests/player-links-page.test.ts tests/player-link-mutations.test.ts tests/player-matching.test.ts tests/format.test.ts` — 192/192 pass.
- `git diff --check` — clean (one benign CRLF-normalisation warning on the touched file; expected
  in this autocrlf-true worktree, not a real whitespace defect).
- `tsc --noEmit` / `npm run build` not run — a single-expression href change inside an
  already-typechecked call; the focused test/type boundary doesn't need it.

## DEV acceptance (2026-09-14)

Manual, read-only acceptance on DEV at `main` `9e97c90`:

- `/admin/player-links` rendered normally;
- a suggested AFLDB player link was clicked;
- it resolved successfully to the real player page;
- the canonical slug-plus-id player route worked;
- the prior 404 defect did not reproduce.

No player-link mutation was submitted as part of this acceptance.

## PROD status

**Still unfixed.** `afldb_prod` continues to serve the pre-fix code that produced the original
404 and will keep doing so until a future normal production deployment carries this fix through
the standard workflow. No production system was touched to investigate, fix, or validate this
issue.

## Resolution

Resolved on DEV, 2026-09-14. Root cause, fix and regression test as above; DEV deployment plus the
manual rendered acceptance above are the closing evidence. No follow-up work is tracked under this
issue — the only remaining step is the ordinary future production deployment that carries `main`
(and therefore this fix) to PROD, which is not itself an ISSUE-168 obligation.
