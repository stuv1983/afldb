# AFLDB V2 — final report (close of Stage 6, 2026-10-19)

Everything the owner's final response needs, from committed evidence. Detail lives in the
documents linked from each section. **Nothing was pushed, tagged or deployed; no production, DEV
or test database, host, service or network endpoint was contacted or changed by any V2 launch.**
The production migration is **not** complete: the code is implemented locally, not shadow-tested
and not cut over.

## 1. Outcome

**Implemented locally; blocked for production.** All six stages are committed and closed by an
independent verifier (`docs/v2/progress.md`). Production cutover is **NO-GO** (`go-no-go.md`):
three structural cutover blockers are open (V2-GAP-008 AFL API fixtures, 011 the AFL Tables
nightly settle, 013 the email-intake timer), the isolated shadow rehearsal has never run
(V2-GAP-026), award results are not yet shown reconcilable (V2-GAP-015/016), and ISSUE-316's
production gates, including D-316-13, are unsatisfied.

| Item | Value |
|---|---|
| V2 repository | `D:\dev\afldbV2`, branch `v2/rebuild`, **no remote** |
| Source revision | `ff100dc2b8da8523f550ef45a9eaa3ef96d9d840` (`opus/afl-api-cutover`) plus 19 uncommitted ISSUE-316 follow-up-8 files |
| Preservation | read-only source; snapshot `D:\tmp\afldbV2-source-snapshot-20261019\` (status, patch, untracked copies, sha256 of all 19 files); V2 cloned without a remote and the 19 files imported as commit `c9cca86d` (`docs/v2/baseline.md`) |
| Source check at close | status differs from the snapshot only by `?? supplies` (known 0-byte stray, V2-GAP-004); the 19 frozen files: sha256 19/19 match |

## 2. Architecture actually created

An in-place strangler (ADR 0001): the Next.js app stays at the root; new code is in
`packages/{domain,db,acquisition,derived,admin,testing}`, imported only as `@afldb/<module>`, with
boundaries enforced by ESLint and `tests/v2-module-boundaries.test.ts` (`docs/v2/architecture.md`).

| Stage | Delivered |
|---|---|
| 1 Foundation | fail-closed test DSN policy (ADR 0005), module boundaries; ADRs 0001-0012 over the stages |
| 2 Historical baseline | sealed seasons 1897-2025; content-free manifest spec, read-only producer (never run) and offline comparator |
| 3 AFL API pipeline | coverage registry (D11), sealed-season refusal at the settle CLIs, fixture identity and player-resolution fail-closed contracts, snapshot replay and plan digest, the stage map |
| 4 Derived and curated | versioned Coleman derivation and audited publisher (migration 112), Brownlow reconciliation, curated award proposals with review, citations and append-only decisions (migration 111), legacy disposition and quarantine |
| 5 Admin | `/admin/operations` (overview, awards queue and detail, Coleman, Brownlow); the CSV upload, submission review/promotion, email intake, Squiggle/Kali refresh and AFL Tables trigger refuse after their unchanged guards |
| 6 Shadow-ready tooling | parity policy `v2.parity.1` and `tools/v2/shadow-parity.ts`; shadow-only capture tools and guard; rehearsal, cutover and rollback runbooks; go/no-go; risk register |

**Database compatibility.** Additive only: migrations 111 (`award_proposals`,
`award_proposal_decisions`) and 112 (`derived_award_results`) create three tables with foreign keys
only to `auth_users` and to themselves; no existing table, column, row, identifier or grant is
changed; grants are in `tools/maintenance/privileges.sql` (import write, auth read, no app read).
Applied only to in-memory PGlite, never PostgreSQL (V2-GAP-017). Ownership:
`docs/v2/db-ownership-matrix.md`.

**Legacy paths.** Removed from the admin runtime (refusing, HTTP 410 for routes, audited): CSV
upload, submission review and promotion, email intake, Squiggle/Kali refresh, the AFL Tables admin
trigger. Quarantined: the Squiggle/Kali CLI (retired-entry registry). Still running on the host,
outside V2's authority: the AFL Tables nightly settle (ISSUE-316: D-316-1, then D-316-4) and the
email-intake timer (cutover-runbook step 4). Python/R tools stay in place (V2-GAP-014).
Matrix: `docs/v2/legacy-disposition.md`.

## 3. Verification at the close of Stage 6

| Check | Result |
|---|---|
| full `npx vitest run --no-cache` (once, at stage close) | Test Files 96 failed / 188 passed / 2 skipped (286); Tests 15 failed / 9971 passed / 48 skipped (10034); 367.6 s; the 102 ` FAIL ` lines are identical to `docs/v2/evidence/baseline-failures.txt` (no new failure, none weakened) |
| Stage 6 suites | `v2-shadow-parity` 99, `v2-shadow-target` + `v2-shadow-capture` 149, `v2-shadow-award-reports` 59: 307 passed |
| `npx tsc --noEmit --incremental false` | exit 0 |
| `npx next typegen` | exit 0 |
| `npx eslint --no-cache .` | 253 errors, 132 warnings: unchanged, at the ceiling |
| ESLint on the 22 code files Launch E created or edited | 0 errors, 0 warnings |
| `tools/v2/coverage-matrix.ts --check`, `tools/v2/acquisition-stage-map.ts --check` | both exit 0 |
| frozen ISSUE-316 files | source 19/19 sha256 match the snapshot; V2 18/19 equal, `CHANGELOG.md` differs by design |
| source worktree status | differs from the snapshot only by `?? supplies` |

**Parity exit-code contract** (`tools/v2/shadow-parity.ts compare`): 0 PASS, 1 FAIL,
2 INCOMPLETE (an input missing, unreadable or invalid), 3 ERROR (usage, an existing output file,
a write failure); verdict precedence FAIL > INCOMPLETE > PASS; five required checks. Capture tools:
0 written, 2 refused or failed. Thresholds: `docs/v2/shadow-rehearsal.md` §8.

## 4. Commits (`ff100dc2..HEAD`, oldest first)

1. `c9cca86d` chore(v2): import the verified ISSUE-316 cutover working tree as the V2 starting point
2. `8a44e165` docs(v2): record the V2 baseline, the owner's rebuild instruction and the execution plan
3. `58ec8626` docs(v2): record the Launch A plan review, its resolutions and the Stage 0 inventory
4. `37f4fc0e` feat(v2-foundation): fail-closed test DSN policy, packages/* module boundaries and ADRs
5. `80e110d6` feat(v2-baseline): define the sealed historical baseline and add read-only manifest tooling
6. `a4b2c8d8` fix(v2-baseline): seal NULL-season fact buckets and stop a failed ROLLBACK masking errors
7. `51ed1282` docs(v2): record the Stage 2 closure-fix commit in progress.md
8. `b87a980e` feat(v2-acquisition): evidence-backed coverage registry (D11) and sealed-season refusal at the AFL API sett...
9. `fdd08ca3` feat(v2-acquisition): AFL API fixture identity contract and player-resolution fail-closed tests
10. `7c2db0d5` feat(v2-acquisition): AFL API client resilience, acquisition metadata in snapshot manifests, writer-free ac...
11. `a7738391` feat(v2-acquisition): @afldb/acquisition pipeline contract, generated stage map, snapshot replay and machin...
12. `3dd3b166` docs(v2-acquisition): record Stage 3 results, commits, gaps and the resumption point in progress.md
13. `64c2eb4a` docs(v2-acquisition): name Stage 4's full scope in the progress.md resumption point
14. `0053167a` docs(v2-acquisition): record the Stage 3 afldb-closure result and correct two LOW wording findings
15. `fad164cd` feat(v2-derived): pure versioned Coleman derivation and comparison report; pure Brownlow reconciliation and...
16. `4c34be93` docs(v2-derived): record the Stage 4 derived commit in progress.md
17. `ddb42525` feat(v2-curated): curated award proposal workflow with migration 111, SQL port, admin services and in-memor...
18. `498fd46d` feat(v2-legacy): legacy disposition matrix, quarantine of the Squiggle/Kali CLI with the F-001 fix, retired...
19. `034f6947` feat(v2-derived): audited, transactional Coleman publisher with migration 112 derived_award_results
20. `4c54e0d9` fix(v2-curated): curated award approval passes through the season seal (workflow curated_award_approval)
21. `1374fc13` docs(v2-derived): Stage 4 close documents: ownership matrix completed, gaps 011-021, decisions R-020 to R-0...
22. `1b0a502a` docs(v2-legacy): record the Stage 4 afldb-closure result and correct its two LOW documentation findings
23. `68a026e2` feat(v2-legacy): retire the legacy admin controls; retired actions and routes refuse after their unchanged ...
24. `458abe68` feat(v2-admin): small operations centre with audited curated-award and Coleman callers
25. `74d4b007` docs(v2-admin): Stage 5 documents, offline component captures and the stage-close record
26. `2cfc3a0b` docs(v2-admin): record the Stage 5 afldb-closure result (PASS_WITH_FINDINGS, LOW/INFO only)
27. `d70389a8` feat(v2-parity): offline shadow parity tool with explicit thresholds, shadow-only capture tools and target ...
28. `0a3254cf` fix(v2-ops): name the ISSUE-316 decisions that actually retire AFL Tables in the admin text
29. the Stage 6 documents commit (`docs(v2-docs)`), and the closure-record commit that follows it (see `docs/v2/progress.md`)

## 5. Gaps (27 open; none closed by V2)

Full table with the owner action per gap: `docs/v2/known-gaps.md`. Production blockers:

| Class | Gaps |
|---|---|
| cutover (structural) | **V2-GAP-008** (High, AFL API fixtures; ISSUE-229 B2), **011** (High, AFL Tables nightly settle), **013** (High, email-intake timer; converted integration suites unexecuted) |
| rehearsal (closed only by running it) | 001, 002, 003, 007, 009, 017, 022 (Medium), **026** (High: rehearsal, tools on real data, both rollbacks never run) |
| reconciliation | 015 (Coleman on real seasons), 016 (Brownlow eligibility rule, owner decision) |
| not blockers | 004, 005, 014, 018, 020, 023, 025, 027 (Low); 006, 010, 012, 019, 021, 024 (Medium) |

## 6. Top risks (`docs/v2/risk-register.md`)

1. RISK-01 AFL API fixtures cannot be ingested (V2-GAP-008).
2. RISK-02 the AFL Tables nightly settle remains a production writer (V2-GAP-011).
3. RISK-03 every PostgreSQL path (migrations, grants, the operations-centre SQL, settle promotion)
   is unexecuted; PGlite is not PostgreSQL (RISK-09).
4. RISK-04 the production build has never run (V2-GAP-002).
5. RISK-05 the workstation hook hazard in the source worktree (V2-GAP-004).
6. RISK-06 the email-intake timer keeps polling until the release window (V2-GAP-013).
7. RISK-07 rollback is untested (V2-GAP-026).

## 7. Verdicts and approvals

| Decision | Verdict |
|---|---|
| Continue local development | **GO** |
| Run the isolated shadow rehearsal | **GO, conditional** on approvals S-A1..S-A5 |
| Production cutover | **NO-GO** |

Approvals still required (none exists): rehearsal S-A1..S-A5; owner decisions on the V2 merge
(including the 19 carried ISSUE-316 files), V2-GAP-004, 005, 006, 015 review, 016, 019, 021, 022
eyeball, 024 and the contributor role; release approvals A-REHEARSAL, A-BACKUP, A-GO, A-REL,
A-ROLLBACK; and, on the separate ISSUE-316 track, D-316-1 to D-316-13 (D-316-13 only after a
deployed C4 and before D-316-4) and AFLDB-ISSUE-229 B2. Exact list: `docs/v2/go-no-go.md` §4.

## 8. Next action for the owner

1. Review this branch (`git log ff100dc2..v2/rebuild`) and the documents above.
2. Decide the rehearsal approvals S-A1..S-A5; when granted, an operator runs
   `docs/v2/shadow-rehearsal.md` and fills in its §10 record.
3. Decide V2-GAP-016 and V2-GAP-024 (they gate award approvals in production) and fix or disable
   the user-level hook (V2-GAP-004).
4. Keep the ISSUE-316 sequence on its own track; V2 neither executes nor shortens it.
