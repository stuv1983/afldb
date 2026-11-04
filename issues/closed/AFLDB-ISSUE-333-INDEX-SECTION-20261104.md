# AFLDB-ISSUE-333 index section (preserved verbatim at closure, 2026-11-04)

Removed from `IssuesIndex.md` when ISSUE-333 was resolved under the owner's amended visibility criterion. The text below is the section as it stood; it describes the issue as OPEN and is history.

### AFLDB-ISSUE-333 — 2026 season coach assignments absent from production

- **Severity / area:** Medium; data completeness, `match_coaches` (public coach and club coaching records).
- **State:** Open, opened 2026-11-04; **narrowed the same day: data corrected and verified, public visibility partly measured (two points unmet).**
  - **Applied 2026-11-04 (owner-approved, once each):** O1 plan `4de5368c...515e`, batch 83, 436 rows, commit 03:14:48Z, COMMITTED_VERIFIED, state PLANNED RESULT PRESENT. O2 plan `c29d148d...ea03`, 36 findings (`data_issues` 41 to 76) resolved, commit 03:15:45Z, COMMITTED_VERIFIED, state PLANNED RESULT PRESENT.
  - **Measured read-only:** `match_coaches` 32,034 to 32,470; 2026 sides without a coach 436 to 0; the 32,034 pre-existing rows unchanged; application queries give Josh Carr 23 and Josh Fraser 16 games; the other four findings unchanged and open.
  - **Visibility probed (2026-11-04, owner-authorised beta cookie, expired 05:18:57Z):** new figures first seen on the public host on `/coaches` (04:23:58.810Z), `/clubs/carlton` (04:24:50.328Z), `/coaches/josh-carr-243` and `/coaches/josh-fraser-293` (first requests 04:24:09Z and 04:24:22Z).
  - **Unmet (two points):** (1) worker identity unobservable (`x-afldb-*` headers need `AFLDB_TRACE_REQUESTS=on`, not set), so both-worker coverage is not demonstrated; (2) `/clubs/port-adelaide` coach row not read from a public response (probe selector defect).
- **Key files:** `docs/v2/issue333-o2-apply-record-2026-11-04.md`, `docs/v2/issue333-o2-consolidated-approval-2026-11-04.md`, `docs/v2/evidence/issue333-o2-20261104/` (`prod-apply/`, `scripts/`).
- **Next action:** owner decides how to close the two unmet points, then close: (a) authorise one more probe cookie with a corrected row selector (Port Adelaide club page, coach table row `Josh Carr 2026`); (b) for worker coverage either authorise a temporary `AFLDB_TRACE_REQUESTS=on` (a setting change and restart) and re-sample until both worker pids show the figures on each page, or accept the two-cache evidence in the apply record section 8.
