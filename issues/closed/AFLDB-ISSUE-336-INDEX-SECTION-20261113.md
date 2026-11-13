# AFLDB-ISSUE-336 — pre-closure IssuesIndex section (preserved verbatim)

Removed from `IssuesIndex.md` on 2026-11-13 when the issue was resolved after D-336-2 Step G passed (evidence `docs/v2/evidence/issue336-d3362-stepg-20261113/README.md`). Record: `issues.md` → AFLDB-ISSUE-336. Paths below are as written at the time; the runbooks named as `issues/open/AFLDB-ISSUE-336*.md` are now in `issues/closed/`.

### AFLDB-ISSUE-336 — Draft pages merge National, Rookie and other categories; 35 DraftGuru Pre-Draft rows missing

- **Severity / area:** Medium; public draft pages, player draft history, DraftGuru draft data.
- **State (2026-11-11, closure run 8):** Open, opened 2026-11-05.
  - **Code:** on `origin/main` since `ea9bddf8`.
  - **DEV:** deployed 2026-11-07 at `8b024098` (branch `dev-v2-main`). Immediate acceptance PASS. The 8–9 Nov nightlies were observed as predicted; that observation is closed.
  - **Production release: ACCEPTED 2026-11-12.** r2 (`docs/v2/issue336-337-340-345-release-approval-r2-2026-11-09.md`), PKG `12aa6e29`, R `c1c4b22e`; also carries 337, 340 and 345 (RD-1); ISSUE-344 is not shipped.
    - Serving `c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x` since the owner's restart at 2026-11-11 17:08:51 AEDT. D1 PASS 2026-11-11 16:10 AEDT.
    - Acceptance amendment D4-A (beta gate on). D4-O was late; acceptance was recorded in the owner's re-approved window, 12 Nov 11:00–14:00 AEDT.
    - Record: `docs/v2/evidence/issue336-337-340-345-release-execution-20261111/execution-record.md`.
  - **D-336-2 (35 rows):**
    - The end-to-end SIMULATION at R′ passed on 2026-11-11: capture, the first sealed I336 assembly, plan 35/31/actor 1, refusals, `COMMITTED_VERIFIED`, accepted, 5,966 = 5,966.
    - The exact approval packet is `docs/v2/issue336-d3362-approval-packet-2026-11-11.md`.
    - The runner route is blocked by **ISSUE-347**; the direct route is unaffected.
  - **D-336-3 (187 revised origin paths):** open. Recommendation in the run 8 decision packet.
- **Key files:** `src/lib/draft-categories.ts`, `src/db/queries/draft.ts`, `src/app/draft/[year]/page.tsx`, `tools/v2/issue336-predraft-insert-production.ts`, `tools/v2/gap029-ops/`; runbooks `issues/open/AFLDB-ISSUE-336.md` and `issues/open/AFLDB-ISSUE-336-DEV-DEPLOYMENT.md`; evidence `docs/v2/evidence/issue336-draft-categories-20261105/` and `docs/v2/evidence/issue336-i336-simulation-20261111/`.
- **D-336-2 (2026-11-12):** Steps A–D ran on production under the A+B and C+D approvals: capture `I336-20261112T010605Z` (dump sha256 `d61c7865…fbcc`) and sealed assembly passed; **the plan refused** ("baseline drift", a false positive: ISSUE-349). No database write.
- **D-336-2 re-run (2026-11-12 afternoon):** at ops pin `a25306f9`: capture `I336-20261112T025001Z` (dump sha256 `0d517f5a…34c6`), sealed assembly and **PLAN_COMPLETE** (digest `afa26158…f608`; 35/31/0, STATE BASELINE). No database write. Approvals must expire before 2026-11-13T02:30:02Z.
- **D-336-2 E+F (2026-11-12 16:00 AEDT):** COMMITTED_VERIFIED and ACCEPTED: +35 picks (6,853), +31 persons (5,088), 35 audit rows by actor 1. Evidence `docs/v2/evidence/issue336-d3362-apply-20261112/README.md`.
- **Next action:** packet §4 Step G (read-only): reconciliation against the owner CSVs (expect 5,966 = 5,966) and the `/draft/2008`, `/draft/2025`, `/draft/2009?view=pre-draft` page check (beta-gated: needs the owner sign-in via the headed runner); then close D-336-2. D-336-3 is decided (A) and carried as 348. Full history: the `issues.md` entry and `issues/open/AFLDB-ISSUE-336-INDEX-SECTION-20261111.md`.
