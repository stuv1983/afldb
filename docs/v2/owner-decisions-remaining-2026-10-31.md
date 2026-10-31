# Remaining owner decisions and gates (2026-10-31)

Prepared after V2-GAP-004 closed (register **38 total / 29 closed / 9 open**, recounted from the rows of
[known-gaps.md](known-gaps.md)). Nothing here is executed, authorised or recorded as decided. Each decision is
independent; none blocks the others. Recommendations are the preparer's, marked as such, and are not evidence.

## 1. Decisions that need only an owner choice (no execution package)

### D-V2-GAP005 — does AFLW join the historical baseline manifest? (V2-GAP-005, Low)

Facts: `HISTORICAL_TABLES` (`packages/domain/src/historical-manifest.ts`) covers the AFL/VFL canonical tables. AFLW
lives in `staging_aflw.*` (eight base tables, migration 025) and `aflw.*` views (migration 026), loaded by
`tools/aflw/`, outside the V2 AFL API scope. A change to the table list bumps `MANIFEST_SPEC_VERSION` (now 1), and the
comparison then reports `SPEC_VERSION_DIFFERS` (review) against every manifest recorded at version 1, including the
recorded production before/after pair.

| Option | Effect | Cost |
|---|---|---|
| **A. Exclude AFLW; close as an accepted scope boundary** (preparer's recommendation) | Gap 005 closes like 020 did; `historical-baseline.md` §3 keeps its row, reworded as accepted | None. AFLW has no V2 writer and no seal to protect |
| B. Cover the eight `staging_aflw` base tables (not the views, which are derived) | Spec version 2; AFLW fingerprinted | A code change plus tests, a new baseline needing a separately authorised read-only production run, and the version-differs review against the v1 pair |

Smallest execution if B: one commit adding the table specs and tests, then a new baseline run under its own approval.

### D-V2-GAP006 — database-level enforcement of the historical seal (V2-GAP-006, Medium)

Facts: the seal is enforced in the three AFL API settle CLIs, the Coleman publisher and curated award approval
(application level). Not covered: the existing admin editors, the library settle functions called directly, and the
legacy writers (gap 011 and the ISSUE-316 sequence). No database trigger exists.

| Option | Effect | Cost |
|---|---|---|
| A. Accept application-level enforcement as the control | Gap 006 closes as accepted; unlisted writers stay unprotected | Residual risk is carried by the owner |
| **B. Extend application-level checks to the admin editors only (plan Stage 5); defer any trigger** (preparer's recommendation) | Closes the largest live gap without a schema change | Code plus tests; the gap stays open for the legacy writers until ISSUE-316 completes |
| C. Additive migration: a trigger on sealed historical tables that rejects writes unless an audited workflow sets a session marker | The strongest control | It would also block legitimate legacy and admin writes until each sets the marker; needs isolated PostgreSQL proof, a reversal, and a separate production install approval |

The preparer recommends B because C interacts with legacy writers that the ISSUE-316 sequence has not retired.

### D-V2-GAP010 — which seasons does AFL API coverage claim? (V2-GAP-010, Medium, not a production blocker)

Facts: the coverage matrix claims nothing before 2026. Locally held raw acquisitions are only 2026 matches and rosters
2012-2026 (`data/sources/afl_api/`, git-ignored). **No 2012-2025 match, stats or Brownlow acquisition exists
locally**, so evidence for any of those seasons needs an owner-authorised provider fetch, which this batch may not do.

| Option | Effect | Cost |
|---|---|---|
| **A. Claim no 2012-2025 coverage; close as an accepted constraint** (preparer's recommendation) | The matrix stays honest as it is | None |
| B. Evidence 2022-2025 only (identity-registered, with a documented Brownlow backtest) | Four seasons move toward `api_partial` | An authorised fetch, sanitised snapshots, tests, a regenerated matrix |
| C. Evidence 2012-2025 | Full claim | As B for fourteen seasons; 2012-2021 are not identity-registered |

## 2. Gates that are not decisions in this batch

| Item | What it waits for | Notes |
|---|---|---|
| V2-GAP-008 / ISSUE-229 | An authentic 2027-season B2 capture | No 2027 season exists yet; blocks nothing unrelated |
| V2-GAP-011 / ISSUE-316 | The owner's C2, the C4b PASS and C5 | Frozen P/H/EXEC, authorities and recovery bindings untouched |
| V2-GAP-016, 030, 031 | Separate exact approval of each production Brownlow operation: schema 116 and 117 installation, the `match_id` backfill, ownership adoption and reconciliation acceptance | [Approval package](brownlow-production-approval-package-2026-10-20.md). Previously installed schema does not authorise any of them |
| V2-GAP-029 | Source evidence for the Gridley findings | Findings unchanged and not waived; [source requests](gap-029-source-requests.md) |
| ISSUE-321 | Deferred; no specifically authorised task identified | |
| ISSUE-327 | Parked (legacy) | |
| Retention cleanup | The recorded review date | Releases, backups, evidence and `.codex/` preserved |

## 3. If you decide

Reply with the option letter per decision (for example "005 A, 006 B, 010 A"). A, and B for gap 006, are code- or
documentation-only and run locally; anything involving production, a provider fetch or a schema install returns for its
own exact approval.
