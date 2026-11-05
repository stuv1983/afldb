# ISSUE-334 and ISSUE-335: pre-closure `IssuesIndex.md` section (verbatim, removed 2026-11-05)

Removed when both issues were resolved on 2026-11-05 after the production release (D3c PASS and D4 PASS). Record: `issues.md` entries and `docs/v2/evidence/issue334-335-release-execution-20261105/execution-record.md`.

### AFLDB-ISSUE-334 — Content image upload route accepts a cross-origin POST (no same-origin check)

- **Severity / area:** Low; admin CSRF on the `/admin/content/media` Route Handler.
- **State:** Open (2026-11-05). Source defect confirmed by review; fixed and Linux-qualified in `R` = `0f251c2daa8d7c6c38eacd559376dde41e010fd9` (local `main`, not pushed). Red 8 failed / 4 passed, green 276/276 unit, `tsc` exit 0. **Production presence unverified by observation**; production is NOT fixed until the release is deployed and verified.
- **Key files:** `src/app/admin/content/media/route.ts`, `tests/admin-upload-route.test.ts`, `docs/v2/issue334-335-release-approval-2026-11-05.md`.
- **Next action:** owner approval of the release package (section 9), then D0 to D4; close on D3c and D4 PASS.

### AFLDB-ISSUE-335 — deleteMatch silently cascades an admin coach assignment and leaves its override active

- **Severity / area:** Low; admin data integrity (`deleteMatch`, `match_coaches` overrides).
- **State:** Open (2026-11-05). Source defect confirmed by review; fixed and Linux-qualified in the same `R`. Red: only the blocked case failed (1 failed / 3 passed). Green: 65 passed / 13 skipped (Python replay, unrelated) / 0 failed. **Production presence unverified**; existing orphaned overrides on production were not checked.
- **Key files:** `src/db/queries/match-admin.ts`, `src/db/queries/admin-coaches.ts` (`matchDeletionCoachOverrideRefusal`), `tests/integration/data-editor.test.ts`.
- **Next action:** same release as ISSUE-334; close on D3c and D4 PASS.
