# AFLDB V2 — final report (close of Launch F, 2026-10-19; first written at Stage 6)

**Current bounded acceptance (2026-10-20, D-GAP029-21):** 149 strict findings;
99 approved (78 deferrals + 21 exact sibling disagreements), **0 data matches**;
50 unapproved (42 event + eight board-date membership). Both gates remain failed.
All six dedicated local credentials rotated on ownership-verified 55433; new logins
pass and old logins reject. Backend functionality, shared-data coverage limits,
unchanged release blockers and the next separate owner decision are distinguished in
[the current readiness record](gap-029-readiness.md). [Source requests](gap-029-source-requests.md).
Earlier run counts and unapproved-sibling proposals below are historical where superseded.

**Port-incident correction:** earlier authentication reached the documented shared development
PostgreSQL endpoint through SSH-owned 55432; successful login/SQL and remote identity were not
established. New launcher listener-ownership checks precede credentials. This follow-up used
verified isolated 55433 only. No production/shared-contact exclusion is inferred from loopback.

## Local release follow-up — current owner-review package

The current evidence, exact test identifiers, reproducible commands and narrowed release gates
are in [local-release-review.md](local-release-review.md). This supersedes historical Launch F
statements below about missing Brownlow publication, untested local application rollback,
uninspected screenshots, literal `afldb_test` requirements and unquarantined acquisition tools.
The previous compatible build and V2 run locally against additive migrations through 115.
Raw votes/audit history survive the rollback sequence. The final V2 build passes (1,516 pages).
Brownlow historical reconciliation is 98/98; Coleman retains 46/46 local agreement.
The dedicated local cluster's six exposed credentials were rotated and old logins rejected.
The complete workflow is reported by assertion identity, NOT failure-output line counts.
Final complete run: **13,740 passed / 9 failed / 31 skipped**; separate Coleman **27/27**.
The original four gap-028 files pass **200/200**. Nine strict reference/source disagreements
were gap 029. Latest follow-up: rookie 23 findings / 7 cells repaired through eight audited
manual selections; strict Gridley has 149 findings (78 approved deferrals, 71 unapproved).
Latest seven-file relevant result: **1,397 passed / 3 failed / 7 skipped**; two original strict
checks and the independent policy check fail. Approved deferrals are 0 data matches.
The full workflow was not rerun and remains **not green**. Typecheck and changed-file lint pass.
Detailed evidence and remaining source/owner decisions: [Gridley closeout](gap-029-gridley-resolution.md).
Production remains **NO-GO**: no production-dump/Linux-host rehearsal, deployment or owner
acceptance is implied. No subagent/worktree was created, no remote added, and nothing pushed.
All unmodified sections below are retained Launch F history, not current verification claims.

Everything the owner's final response needs, from committed evidence. Detail lives in the
documents linked from each section. **Nothing was pushed, tagged or deployed, and no production,
DEV or shared database, host or service was contacted or changed by any V2 launch.**
- Launch F used only a loopback-only PostgreSQL 16 cluster it created on this workstation
  (`tools/v2/isolated-pg.ts`).
- Its only network call was one read-only GET of the public AFL API compSeasons list.

The production migration is **not** complete. The code is implemented and verified locally on
isolated PostgreSQL. It is not shadow-tested on production data and not cut over.

## 0. Launch F (2026-10-19): what changed since Stage 6

**Commits** (`0f46c3ae..v2/rebuild`, oldest first):

| Commit | What |
|---|---|
| `7762df6e` | merge(v2-awards): migrations 113/114, Brownlow eligibility, Coleman projection, curated revisions |
| `d760280e` | AFL API pre-match fixture writer (ISSUE-229 writer, V2-GAP-008) |
| `aeea63d1` | retire every legacy writer entry point in V2; refuse the release while one can run |
| `d31cd2d7` | isolated-cluster historical rebuild target (`--target isolated`) |
| `9fc07c07` | rehearse the 111-114 reversal and the shadow mechanics on isolated PG16; retire the AFL Tables copy |
| the final-verification commit (`docs(v2-final)`) | final verification: fixture writer moved out of the pure package index, docs, evidence |

**Verification**:

| Check | Result |
|---|---|
| full `vitest run --no-cache` (once, no DSN) | Test Files 93 failed / 198 passed / 2 skipped (293); Tests 9 failed / 10353 passed / 39 skipped (10401); 349.9 s |
| ⤷ against the 102-line baseline | 98 ` FAIL ` lines. 92 are on the baseline list, and 10 baseline lines no longer fail (local data and environment). 6 are new: 4 V2 integration files that need a DSN (environmental); 1 DraftGuru frozen sample (environmental, see below); and 1 real regression, `v2-acquisition-pipeline` (f), fixed below. No test was weakened, removed or skipped |
| `tsc --noEmit --incremental false` | exit 0 (also after the final fix) |
| `eslint .` (once) | 235 errors / 131 warnings (ceiling 253/132). Every finding is pre-existing: per-file counts for the touched files are unchanged from `0f46c3ae`. The one Launch F finding (`pgtool.cjs` `require`) was fixed by converting the file to `pgtool.mjs`; the moved and edited files lint with 0 findings |
| `npm run build` (webpack) against isolated `afldb_v2_visual_test`, telemetry off | exit 0; 1,516/1,516 static pages; `prepare-standalone` exit 0 (no `.env*` in the standalone bundle). Run once, after the last code change (V2-GAP-002 closed) |
| historical rebuild `rebuild-test.ts --target isolated` | 30/30 stages; migrations 001-114; FINAL VALIDATION PASSED (89 checks). Sources: tracked fitzRoy `full-history-20260902` and DraftGuru `annual-html-20260826` |
| integration on isolated PG16 | `afldb_v2_main_test` (schema-only, 001-114): V2 suites plus `privileges`, 134/134. Rebuilt history: 26 files, 670 passed, 14 failed, 52 skipped. The 14 are pinned to `afldb_test` by design (3 files), `v2-coleman-publication` refusing real Coleman rows (it passes schema-only), and the pre-existing drift in V2-GAP-028 |
| PostgreSQL forward and rollback (`rollback-runbook.md` §7) | empty database → 001-114 → reversal R5 (0 tables, 0 ledger rows) → schema identical to 001-110 → re-forward, with schema and grants identical. **Application rollback (§4) not rehearsed** |
| shadow mechanics (`docs/v2/evidence/launchF/`) | synthetic copy of the local rebuild reversed to pre-V2, guard, captures, 111-114 with privileges, captures: parity **VERDICT PASS (5/5)**; manifest identical; Coleman agrees 46/46 (1980-2025). **Not production parity**: no approved production backup was used |
| fixture writer | 17/17 integration, 67/67 contract; dry run of the tracked 2026 feed on the rebuild: 217 CONCLUDED, 1 SCHEDULED (`CD_M20260142901` would be created), 0 refused, 0 rows left |
| admin visual check | the production build served from 127.0.0.1:3901 with synthetic staff and proposals. 13 screens were captured as Super Admin and Admin at 1280x800 and 390x844 (26 images plus `capture-log.txt`), all HTTP 200, 0 horizontal overflow, 0 console errors and 0 non-loopback requests. The agent inspected them; one stale AFL Tables copy was found and fixed before this capture. The owner's verdict is pending (V2-GAP-022) |

**One regression found by the final suite and fixed.**
- **What failed:** `tests/v2-acquisition-pipeline.test.ts` (f) found SQL in the
  `@afldb/acquisition` index closure.
- **Cause:** the fixture writer had been placed in the package.
- **Fix:** it now lives at `src/lib/acquisition/afl-api-fixture-writer.ts`, as the index comment
  always said.
- **Re-verified:** focused suites 144/144, the integration suite 17/17, and tsc 0.

**Two environmental failure classes:**
- Four new V2 integration files refuse without a `_test` DSN, the same class as the 85 baseline
  integration files.
- `draftguru-acquisition` "frozen Stage B1 sample" fails because the git-ignored sample records
  the absolute path of the checkout that built it (`D:/dev/afldb/...`). It became active only
  because Launch F copied that ignored local data into this checkout for the rebuild; the tool and
  its inputs are byte-identical to the source.

**Gaps:**
- **Closed:** V2-GAP-002, 012, 017, 018, 019 and 024.
- **Narrowed:** 001, 003, 007, 008, 009, 011, 013, 015, 016, 021, 022 and 026.
- **New:** 028.
- **Remaining production-only cutover blockers:** 008 (ISSUE-229 B2: no 2027 season exists
  yet), 011 and 013 (disabling the timers in the release window, which the cutover preflight
  enforces).

**Verdicts:**
- Local development: **GO**.
- Isolated shadow rehearsal on production data: **GO, conditional** on S-A1..S-A5. Its mechanics
  are already proven locally.
- Production cutover: **NO-GO** (`go-no-go.md` §1).



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

## 3. Verification at the close of Stage 6 (historical; Launch F results are in §0)

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
29. `7d012257` docs(v2-docs): Stage 6 shadow rehearsal plan, cutover and rollback runbooks, go/no-go record, risk register and final report
30. the Stage 6 closure-record commit (`docs(v2-docs)`: afldb-closure PASS_WITH_FINDINGS, LOW/INFO only)

## 5. Gaps at the close of Stage 6 (historical: 27 open; Launch F state in §0 and `known-gaps.md`)

Full table with the owner action per gap: `docs/v2/known-gaps.md`. Production blockers:

| Class | Gaps |
|---|---|
| cutover (structural) | **V2-GAP-008** (High, AFL API fixtures; ISSUE-229 B2), **011** (High, AFL Tables nightly settle), **013** (High, email-intake timer; converted integration suites unexecuted) |
| rehearsal (closed only by running it) | 001, 002, 003, 007, 009, 017, 022 (Medium), **026** (High: rehearsal, tools on real data, both rollbacks never run) |
| reconciliation | 015 (Coleman on real seasons), 016 (Brownlow eligibility rule, owner decision) |
| not blockers | 004, 005, 014, 018, 020, 023, 025, 027 (Low); 006, 010, 012, 019, 021, 024 (Medium) |

## 6. Top risks at the close of Stage 6 (historical; current ranking in `docs/v2/risk-register.md`)

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
3. Give eyeball verdicts on `docs/v2/evidence/launchF-visual/` (V2-GAP-022). Confirm the Brownlow
   projection path (V2-GAP-016). Choose the AFL Tables release ordering (A-AFLT vs ISSUE-316 C5,
   RISK-27). Fix or disable the user-level hook (V2-GAP-004).
4. Capture ISSUE-229 B2 once the 2027 season is published, then dry-run and approve the first
   fixture apply.
5. Keep the ISSUE-316 sequence on its own track; V2 neither executes nor shortens it.
