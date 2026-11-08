# ISSUE-344: pre-closure `IssuesIndex.md` section (verbatim, removed 2026-11-08)

Removed when the issue was resolved on 2026-11-08, after the isolated-Linux browser verification of both redirects. The fix is local and uncommitted. Record: the `issues.md` entry and `issues/closed/AFLDB-ISSUE-344.md`. Evidence: `issues/closed/AFLDB-ISSUE-344-evidence/`.

### AFLDB-ISSUE-344 — Out-of-range draft pages report zero matches for nonempty results

- **Severity / area:** Low; Public and admin draft pagination.
- **State:** Open; **implemented locally 2026-11-08, not yet executed** — bounded past-the-end count fallback; public/admin pages redirect to the last page via `redirectPastEnd`, filters kept.
- **Key evidence:** src/db/queries/draft.ts:149-184 takes total from count(*) OVER() on returned rows and falls back to 0 for an empty OFFSET page.
- **Next action:** query layer verified on streamanator 2026-11-08:
  - `catalogue-lookups` passed 24/24;
  - `admin-draft` passed 47, failed 0 and skipped 5, on the isolated `afldb_v2_verify_test` (ledger 118) with a minimal synthetic seed kept in the workspace;
  - all 5 ISSUE-344 public and admin cases passed;
  - the 5 skips are the psycopg replay gates, not an ISSUE-344 path.
  
  **Still needed before closing:** the public and admin redirect checks, `/draft/2024?page=999&view=rookie` and an over-range `/admin/draft` page. [Playbook](issues/open/AFLDB-ISSUE-344.md).
