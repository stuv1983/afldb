# AFLDB V2 — go/no-go checklist and current verdicts

**Production execution, 2026-10-31 (D-V2-PROD-EXEC-1): V2 RELEASED.**
- Production runs `9ed9c9dd` (`BUILD_ID` `QNEHXAtU53TzUjj0Mb7mv`, ledger 117) behind `beta.afldb.com`, with the AFL
  Tables timer retired.
- Still **NO-GO**: the AFL API cutover writer activation (stage C beyond source retirement), stage D, every new writer
  or provider, and the apex launch.
- Deployment defect: AFLDB-ISSUE-329, resolved 2026-10-31. Production now serves `61a95f7397da-JYIBkYn8ynPgYMn1e5nK-`
  (revision `61a95f73`, `BUILD_ID` `JYIBkYn8ynPgYMn1e5nK-`), built through the release route.
- [Execution record](production-execution-record-2026-10-31.md). The verdicts below predate the release and are kept
  as history, except where a row is marked with a 2026-10-31 update.
- **Rollback (V2-GAP-026), 2026-10-31: closed on rehearsal evidence, not exercised on production.** See
  `shadow-rehearsal.md` §10 and `rollback-runbook.md` §7. Production has moved forward only; the retained `previous`
  release is an available target. An optional production drill is described there and is the owner's call.

**Current decision package, 2026-10-28:** [release decision package](release-decision-package-2026-10-28.md).
It separates stages A (inert V2 installation), B (schema/data acceptance), C (source retirement and
AFL API cutover) and D (first 2027 fixture ingestion). Production remains **NO-GO**.

**Current-production shadow, 2026-10-29:** [report](current-production-shadow-2026-10-29.md). Under
D-V2-CURRENT-SHADOW-CAPTURE-1, archive `a4641ca0…` gave `shadow.result` SUCCEEDED and classification
`ONLY_EXPECTED_116_117_DELTAS`. Strict preservation, parity and `migrationCompatibility` remain **FAIL**,
Brownlow **INCOMPLETE**, and NO-GO. No acceptance is extended to this archive: a new archive-bound owner
decision is proposed there, and the MED-2 evidence limits remain. (Superseded for acceptance by the owner decision
of 2026-10-29 below; the strict results and NO-GO stand.)
**Follow-up, 2026-10-29:** [record](current-production-shadow-followup-2026-10-29.md). Under
D-V2-CURRENT-SHADOW-FOLLOWUP-1 these were produced: the receipt probes; the normalised schema sections
(0 unclassified, all 193 archived ACLs equal); the 98-season stored pair (byte-identical); and the focused
checks (units 508/508, eligibility 47/47, privileges **42/43**, the one failure being the absent staging
default ACLs). Drift against `7fefcd9b…` is aggregate only (+18 rows).
**Owner decision, 2026-10-29:** [record](owner-decision-current-rehearsal-2026-10-29.md). D-V2-CURRENT-REHEARSAL-1,
D-V2-CURRENT-SCHEMA-1 and D-V2-BROWNLOW-ALT-3 are **APPROVED** as migration evidence for archive `a4641ca0…`
only, with the recorded limits. They are bound in `tools/v2/fresh-rehearsal-acceptance.ts` as a second,
explicitly selected binding. **Measured 2026-10-29** (D-V2-CURRENT-ACCEPTANCE-RUN-1,
[report](evidence/current-rehearsal-acceptance-2026-10-29.json)): evidence integrity, migration compatibility
(no reasons), backend functional and backend acceptance **PASS**, exit 0. Strict results stay FAIL and the staged
Brownlow comparator INCOMPLETE. Privileges integration stays **42/43**, unresolved and not waived. They grant no
schema, grant, Brownlow or release action. **NO-GO.** Remaining choices:
[release choices](owner-decision-release-choices-2026-10-29.md).

**Current scoped acceptance, 2026-10-21:** [owner decisions and measured result](owner-decision-fresh-rehearsal-2026-10-21.md)
supersede historical pending-rehearsal statements below for archive `7fefcd9b…6dea6599`, baseline
110 through exactly 111–117 and reviewed source `a6400e7d…`. Migration compatibility and backend
acceptance are **PASS**, bound to all 50 verified retained files and seven migration checksums.
Original strict preservation/compatibility and parity remain **FAIL** (exact receipt addition and
eligibility definition change; parity 3 pass / 1 fail / 1 incomplete). Staged Brownlow remains
**INCOMPLETE**; authentic staged API reconciliation is not established for this archive.
D-V2-FRESH-REHEARSAL-1, D-V2-FRESH-SCHEMA-1 and D-V2-BROWNLOW-ALT-2 grant only scoped migration
acceptance. D-V2-STAGING-IMPORT-DEFAULT-1 and D-V2-STAGING-APP-DEFAULT-1 approve future staging-table
policies; both production declarations remain absent/pending and execution is unauthorised.
Production operational acceptance remains **INCOMPLETE / NO-GO**.

First remaining concrete release prerequisite: owner review/merge reconciliation of imported
ISSUE-316 work with its source branch, C0 DEV sync and separately owner-authorised C1 retirement
rehearsal (ISSUE-316 §7 C0/C1). D-316-1/C2 follows, requiring its own coordinated pause/recovery
authority. No demonstrated archive rehearsal is requested again absent changed conditions.
Final execution/build artifact identity after merge/C2, live freshness/frozen rollback evidence,
A-ROLLBACK, A-REL (111–117 plus both privilege writes), A-AFLT retirement, A-GO and writer activation
are separate pending gates. C3 inert install does not authorise C4b or C5; ISSUE-229 B2 still applies.
No execution envelope or correction plan digest exists from this task. The
[ordered release plan](production-release-plan-2026-10-21.md) is the current sequencing record;
earlier statements below about unperformed production-data rehearsals or missing policy decisions
are historical only. ISSUE-316/229 remain open; their authorities are unchanged.

**Final local Brownlow regression (2026-10-20): complete, no remaining local blocker for that task.**
Parent/current comparison proves P2 requires the explicit match-ID correction on a prepared clone and OD-5
requires the existing rebuild namespace; no guards or assertions were weakened. Complete admin **46/46**,
settlement **73/73**, eligibility integration **47/47**, eligibility unit **65/65**, authentic twelve-ruling
rehearsal **3/3**. Final Linux production build/TypeScript/standalone and actual operations/public browser
checks pass after fixes to publication ordering and public recorded-flag wording. Raw votes, permission
gates, audits and cache refresh verified. [Measured implementation and boundaries](brownlow-eligibility-implementation-2026-10-20.md#final-local-regression-2026-10-20).
This does not resolve unrelated release gates or authorise production. **110 → 115 retains only its original
archive acceptance; 116 and 117 each have completed isolated verification and each await separate production
schema approval.** Next: approve those installations with fresh verified backup/restore evidence, the reviewed
deployment revision/window, then separate exact target/revision/plan-bound execution approvals for
`observe → backfill → adopt → eligibility` (twelve named rulings, 2026 excluded), followed by production
reconciliation and the existing host/release acceptance. Production remains **NO-GO** until those authorities
and gates are satisfied.

**Brownlow migration-evidence decision (2026-10-20, D-V2-BROWNLOW-ALT-1):** the owner accepted
alternative Brownlow evidence (raw-vote/audit preservation, identical 98-season stored-data
reports, passing integration and unit/report checks) **solely for archive `a583fc7d…ed11b04` and
110 → 115**. Result: production migration preservation/query compatibility **PASS, scoped**; backend
acceptance **PASS, scoped**. The original staged Brownlow comparator remains **INCOMPLETE**.
Authentic API vote/identity/leaderboard reconciliation is **not established** and stays required for
Brownlow operational readiness (criterion 7 below is unchanged). Strict Gridley **FAIL (149)** and
adjudication conformance **FAIL (50 unapproved)** are unchanged; GAP-029 stays open. Production
operational acceptance stays **INCOMPLETE / NO-GO**: no ingestion, publication, deployment or GO is
approved, and the archive says nothing about the current live database. Rollback reversal and archive recovery were rehearsed
with populated synthetic V2 ledgers on an isolated copy (2026-10-20), not on a production dump. [Decision](owner-decision-brownlow-alternative-2026-10-20.md);
[outstanding requirements](release-requirements-checklist-2026-10-20.md).

**Current migration-policy amendment (2026-10-20):**
[D-V2-MIGRATION-SEPARATION](migration-acceptance-2026-10-20.md) is approved. Report five separate
results: backend functional **PASS on retained local evidence**; production migration
preservation/query compatibility **INCOMPLETE**; strict Gridley **FAIL (149)**; adjudication
conformance **FAIL (99 approved, 50 unapproved)**; production operational acceptance
**INCOMPLETE / NO-GO**. Missing evidence cannot pass. GAP-029 remains OPEN data quality debt;
it stops being an automatic backend-migration blocker only under the approved preservation
conditions. New discrepancies still block. No strict assertion, bounded adjudication,
production approval or data-preservation requirement is waived. The full suite remains
13,740 passed / 9 failed / 31 skipped, not green. No approved local production backup exists.
[Reviewable Linux rehearsal package](production-shadow-commands.md).

**ISSUE-229 B2 scope:** authentic first-season evidence and approved first apply are required
before wiring/applying the new-season fixture schedule writer. An inactive-writer schema/data
rehearsal can be reviewed separately. This does not authorise that writer or shorten ISSUE-316
sequencing. Historical blanket B2 migration-blocker statements below are superseded only in
that limited scope. Production compatibility, Linux, host backup/restore/rollback, legacy-writer
retirement, ISSUE-316 sequencing and explicit release approval remain required.

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

**Current local-release addendum (2026-10-20): production NO-GO.** See
`local-release-review.md` for actual assertion-level results; earlier failure-*line* comparisons
are historical, not a green test gate. Local Brownlow publication, 98-season reconciliation,
physical legacy quarantine, six-role credential rotation, technical visual inspection and
previous/V2 application rollback have now been demonstrated. Linux/production-dump parity,
host rollback/backup/service operations, owner visual acceptance and first authentic 2027 B2
operational acceptance remain. No production authority is granted by these local results.
Final complete workflow: **13,740 passed / 9 failed / 31 skipped**; Coleman separately **27/27**.
GAP-029 remains **open**. Latest seven-file relevant run: **1,397 passed / 3 failed / 7 skipped**;
strict parity **FAIL, 149 findings**, including **78 approved deferrals (0 data matches)** and
**71 unapproved**. Rookie coverage repaired: **23 findings / 7 cells**, through eight audited
manual selections on an isolated clone. Missing evidence: 42 exact event labels, 8 board-dated
2026 cells, and the unapproved eligibility-population decision for 21 sibling cells.
The independent policy gate rejects the unapproved differences even in diagnostic mode.
Typecheck and changed-file lint pass. The full workflow was not rerun. Broader production gates
are unchanged. See [Gridley closeout](gap-029-gridley-resolution.md).

Status: updated at the close of Launch F (2026-10-19); first recorded at Stage 6 (Launch E). The
criteria are the owner's (`docs/v2/owner-instruction-2026-10-19.md`, "Go/no-go criteria"), and
each is judged against committed evidence only.

Launch F added real PostgreSQL 16 evidence from an **isolated**, loopback-only local cluster of
`afldb_v2_*_test` databases (`docs/v2/isolated-rebuild.md`):
- a historical rebuild from the tracked local sources;
- the integration suites;
- the production build;
- rendered admin pages;
- the shadow mechanics;
- the 111-114 database reversal.

That evidence is **local rehearsal mechanics, not production parity**: no production dump or
approved backup was used. "Unverified" still means the evidence needs production data, Linux or a
host. **No production system has been contacted or changed, and nothing has been pushed or
deployed.**

## 1. Verdicts

| Decision | Verdict | Why |
|---|---|---|
| Continue local development | **GO** | Launch F is committed, and the local gates hold at its close. tsc is 0. The full suite (run once, no DSN) has 98 failing lines, none of them a code regression: 92 are baseline lines; 4 are new integration files that need a DSN, like the other integration files; 1 is a frozen DraftGuru sample that is environmental (`final-report.md` §3); 1 was a real regression, fixed and re-verified. Repo-wide ESLint is 235 errors / 131 warnings, under the 253/132 ceiling, with no new finding. The isolated PG16 cluster gives every developer-run integration suite a real database without touching a shared one |
| Run the isolated shadow rehearsal (`docs/v2/shadow-rehearsal.md`) | **GO, conditional** on the owner's approvals S-A1..S-A5 (§4.1). It touches no production system: it restores a dump into `afldb_v2_shadow_test` on a rehearsal host | Launch F ran the mechanics end to end on isolated PG16 with locally rebuilt data, and both passed: the guard, the captures, 111-114 with privileges, and parity (PASS 5/5) for one; the database reversal and re-forward (schemas identical) for the other. What remains is exactly what needs real data or a host: the production-dump parity, the backup and the application rollback (V2-GAP-026). *(Update 2026-10-31: all three have since run, as rehearsals on production archives; V2-GAP-026 is closed and `shadow-rehearsal.md` §10 is filled in.)* |
| Production cutover (V2 release and the AFL API cutover) | **NO-GO** | Production-only blockers remain: V2-GAP-008: ISSUE-229 B2 is uncaptured, because no 2027 season exists yet; V2-GAP-011 and V2-GAP-013: the legacy timers are still enabled on the host. The preflight refuses the release until they are disabled under A-AFLT/A-REL; The real-data rehearsal and the application rollback have not run; Award results are not shown reconcilable on production data (V2-GAP-015/016); The ISSUE-316 production gates are unsatisfied, and D-316-13 has not been approved after a deployed C4 (§3) |

V2 is **implemented and verified locally on isolated PostgreSQL 16, and not shadow-ready in the
owner's full sense**. The label `shadow-ready` is not claimed: criteria 3, 7 and 8 still need
production data, and criterion 10 needs host action. Shadow-ready would still not mean cut over.

## 2. The `shadow-ready` criteria, one by one

| # | Criterion | State | Evidence |
|---|---|---|---|
| 1 | The existing frontend builds and its critical contracts are preserved | **met locally** | `npm run build` exit 0 against the isolated database, 1,516 static pages (V2-GAP-002 closed); the operations pages were rendered from that build and captured at 1280x800 and 390x844 (`docs/v2/evidence/launchF-visual/`). The corrected candidate was recaptured from a production build on 2026-10-29, and the owner accepted all screens and states presented for acceptance (D-V2-VISUAL-1; V2-GAP-022 closed; synthetic UI evidence, not production acceptance) |
| 2 | Existing PostgreSQL data retained without destructive migration | **met**, executed on isolated PG16 | migrations 111-114 only create tables or widen constraints (ADR 0004). On a copy of the local rebuild, the manifest before and after 111-114 compared identical. The reversal leaves a schema identical to 001-110 (`rollback-runbook.md` §7) |
| 3 | Stable identifiers and relationships preserved or explicitly mapped | **met** (no id is changed); proof on real data pending | no migration alters an existing table; the manifest digests stable id columns as facts and the parity check fails on any change (plan §7 R-045); never run on real data (V2-GAP-007) |
| 4 | AFL API ingestion snapshot-based, validated, replayable and idempotent | **met**, isolated PG16 | settle suites 5 of 7 pass on the isolated rebuild; 2 are pinned to `afldb_test` by design (V2-GAP-009); the fixture writer replays idempotently (17/17) |
| 5 | Promotion transactional and fails closed | **met**, isolated PG16 | settle and fixture refusals write nothing (integration suites); publishers are tested in the awards suites (V2-GAP-017 closed) |
| 6 | Fixtures and players cannot be silently fabricated | **met in code and on isolated PG16**; first real 2027 feed pending | player refusal (Stage 3). The fixture writer (Launch F) resolves clubs and venues explicitly, refuses an unresolved or ambiguous identity, never creates a club or venue, and refuses unobserved statuses unless acknowledged. B2 is uncaptured (V2-GAP-008) |
| 7 | Brownlow reconciliation passes | **partly shown on authentic 2025 data (2026-10-20); not met**; rule decided | authentic 2025 snapshot reconciled read-only: 207/207 matches, 188 players, 621 votes, totals, ranks, winner and replay agree; **12 provider-ineligible players are stored eligible (unresolved, owner review)**; canonical API apply refused for the sealed legacy-owned season; staged leaderboard and team mapping still open (V2-GAP-010, 016, 023); operations-centre workflow exercised through the real application 41/41 ([record](brownlow-authentic-reconciliation-2026-10-20.md)) |
| 8 | Coleman derivation passes for winners, ties and incomplete seasons | **met on synthetic inputs and on locally rebuilt history** | 46/46 seasons (1980-2025) agree on the local rebuild; production data not compared (V2-GAP-015) |
| 9 | Curated awards require review and retain citations and audit history | **met**, isolated PG16 | four-eyes with a recorded attestation, audited revision and revalidation (V2-GAP-018, 019, 024 closed); `v2-curated-awards` passes on PG16 |
| 10 | Runtime code has no dependency on CSV, AFL Tables, Squiggle or Kali | **met in code; not met on the host** | a V2 checkout refuses the AFL Tables settle and the email poller; no runtime import remains (V2-GAP-012 closed). The AFL Tables and email-intake timers are still enabled on the production host until the release window (V2-GAP-011, 013), and the cutover preflight refuses the release until they are disabled |
| 11 | Valuable historical tools are safely quarantined | **partly met** | TypeScript entry points refuse through the retired-entry registry; Python/R tools stay in place (V2-GAP-014) |
| 12 | Admin operations are narrow, permissioned and audited | **met**, isolated PG16 | capability guards and audit rows (Stage 5); `privileges.test.ts` and the awards suites pass on PG16; pages rendered for Admin and Super Admin |
| 13 | Tests, type checking and linting pass | **NOT GREEN: see final assertion-level evidence** | `local-release-review.md` records the complete workflow and residual test identities. Typecheck and production build pass. Changed-file lint has 0 new findings but inherited errors remain. **Re-measured at `461f4372` (2026-10-29, D-V2-RESIDUALS-1): 508 errors / 136 warnings / 0 fatal**; 0 new findings in `src/`/`packages/`, all 279 since 2026-10-20 in tests, tools and retained issue evidence ([record](release-residuals-2026-10-29.md)). Recorded as a known, open residual, not a pass. No failure-line-count comparison is accepted as a pass. |
| 14 | Production access is not needed to run the test suite | **met** | ADR 0005: the test setup strips DSNs and refuses any non-`_test` database |
| 15 | Migration, comparison, rollback and cutover instructions are complete | **met**; (2026-10-31) application rollback rehearsed on the 117 schema with production-derived data and through the release route; backup and restore proven on the production dump; database reversal rehearsed through 115 only. **No rollback has been exercised on production** (V2-GAP-026 closed on rehearsal evidence) | `cutover-runbook.md` (now with step 4a and 111-114), `rollback-runbook.md` §5 (111-114) and §7 record; V2-GAP-026 |
| 16 | No secrets are committed | **met** | no `.env*` beyond `.env.example`; DSNs in tests are synthetic placeholders; closure scans at every stage |
| 17 | No production action has occurred | **met** | (Update 2026-10-30: V2 now has `origin`, and `main`/`v2/rebuild` were pushed under D-V2-PUSH-ROUTE-1. A Git push is not a production action.) Originally: V2 has no remote; no production or shared database, ssh, deploy or service command was run in any launch. Launch F's only network use was one read-only GET of the public AFL API compSeasons list |

## 3. Production no-go conditions

| Condition (owner's list) | Holds today? | Evidence |
|---|---|---|
| Fixture identity can duplicate or misassign matches | **yes, blocks until B2**: the writer is built and refuses ambiguity, but it has never seen a 2027 pre-match feed | V2-GAP-008 |
| Player resolution creates placeholders or silently guesses | no | Stage 3 refusal tests |
| API coverage is assumed rather than verified | no: 2012-2025 API coverage is not claimed | V2-GAP-010, `docs/v2/coverage-matrix.md` |
| Historical data would be deleted or rewritten destructively | no | additive migrations; seal checks (V2-GAP-006 for other writers) |
| Brownlow or Coleman results cannot be reconciled | **Brownlow: reconciles on authentic 2025 data except 12 unresolved eligibility disagreements: blocks until the owner rules**; Coleman 46/46 on local data, production data not compared | V2-GAP-015, 016; [record](brownlow-authentic-reconciliation-2026-10-20.md) |
| The frontend requires unplanned breaking schema changes | no | no existing table changed |
| Admin actions can bypass validation, permissions or auditing | no (code, tests, isolated PG16) | Stage 5 closure; V2-GAP-017 closed |
| Runtime still depends on legacy ingestion | **yes on the host, blocks**: the code refuses, but the timers remain enabled until the release window | V2-GAP-011, 013; cutover runbook step 4a |
| Shadow comparison thresholds are undefined | no: policy `v2.parity.1` | `shadow-rehearsal.md` §8 |
| Rollback is untested or unclear | **no longer blocks V2 (2026-10-31)**: rehearsed on production-derived data and through the release route, backup and restore proven on the production dump; V2-GAP-026 closed. Stated limits: never exercised on production, no retained pre-V2 release, reversal not rehearsed at ledger 116/117, Caddy/TLS path not rehearsed. The ISSUE-316 writer-activation rollback is separate and still blocks that cutover | `rollback-runbook.md` §7, V2-GAP-026 |
| ISSUE-316 production gates remain unsatisfied | **yes, blocks** | `issues/open/AFLDB-ISSUE-316.md` §7-§8 |
| D-316-13 not separately approved after the required C4 result | **yes, blocks** | ISSUE-316 §7 C4b |

## 4. Every approval still required (none exists today; the Launch F owner decisions are recorded in ADR 0014, 0015 and 0008)

### 4.1 To run the isolated shadow rehearsal

| Id | Approval |
|---|---|
| S-A1 | use a production dump (newest verified backup) on the rehearsal host; it carries auth tables (RISK-14) |
| S-A2 | create `afldb_v2_shadow_test` (and any `afldb_v2_shadow_<tag>_test`) on the rehearsal host |
| S-A3 | state-changing steps on the shadow copy: migrations, privileges, the site setting, the settle replay, curated proposals, both rollback paths |
| S-A4 | build and run V2 against the shadow copy on a local port; install the Playwright browser if absent (network download) |
| S-A5 | rebuild and use `afldb_test` at the V2 commit for the integration suites |

### 4.2 Owner decisions V2 needs before production

| Item | Decision |
|---|---|
| V2 merge | **merged locally 2026-10-29 (D-V2-LOCK-1) and pushed 2026-10-30 (D-V2-PUSH-ROUTE-1)**: `git merge --no-ff` into local `main`, locked execution commit `9ed9c9dd`. `origin` (the source repository's existing URL) was added. `origin/main` was exactly `ff100dc2` and was fast-forwarded to `9ed9c9dd` without force; `v2/rebuild` was pushed at `d3286d92`. The lock holds. Production execution: [package](production-execution-package-2026-10-30.md), preparation P-1–P-7 complete (§4.1); approved and **executed 2026-10-31** ([record](production-execution-record-2026-10-31.md)). Earlier text: reconcile the 19 ISSUE-316 follow-up-8 files it carries (commit `c9cca86d`) with the source worktree (RISK-15) |
| V2-GAP-004 | fix or disable the user-level Read/Grep/Glob hook that runs in the source worktree; decide on the stray `supplies` |
| V2-GAP-005 | whether AFLW joins the historical manifest |
| V2-GAP-006 | database-level seal enforcement |
| V2-GAP-016 | decided (ADR 0014); remaining: confirm the projection path and run the blast-radius count |
| V2-GAP-019 | decided and built (ADR 0008, four-eyes with attestation); nothing remaining |
| V2-GAP-021 | decided and built (ADR 0015); remaining: retire the offline loader's coleman group for covered seasons |
| V2-GAP-024 | built (Launch F); nothing remaining |
| contributor role | whether the contributor role keeps a purpose; Launch F removed its retired Upload link (RISK-21) |
| V2-GAP-022 | **decided 2026-10-29 (D-V2-VISUAL-1)**: all screens and states presented in `docs/v2/owner-visual-review-candidate-2026-10-29.md` accepted; authentic reconciliation and production acceptance not claimed; gap closed (`owner-decision-lock-2026-10-29.md` §2) |
| V2-GAP-036 | closed locally on 2026-10-29: the standalone bundle now carries and verifies the Coleman contract and the other runtime reference files, and the production build compared and published Coleman on the disposable clone (with 037/038). The fix changed the candidate, so the artifact lock must be re-taken on the corrected commit. Not deployed |
| V2-GAP-015 | review every Coleman `disagree` found by the rehearsal |

### 4.3 Production release approvals (V2 release track, `cutover-runbook.md`)

| Id | Approval |
|---|---|
| A-REHEARSAL | accept the rehearsal record (`shadow-rehearsal.md` §10): parity PASS or every FAIL reconciled, rollbacks rehearsed |
| A-BACKUP | the production backup and the read-only before-manifest (`rollback-runbook.md` §2 gate B; reading production with the manifest producer's non-test flags) |
| A-GO | the owner's signed GO on this document's production row (cutover precondition P1) |
| A-REL | the release window: writers paused per the production release procedure, the email-intake timer disabled (step 4), the AFL Tables timer disabled and its polkit rule moved (step 4a, under A-AFLT), `tools/v2/cutover-preflight.ts legacy-writers` PASS, migrations 111-114, privileges, code (precondition P5) |
| A-ROLLBACK | standing authority to run `rollback-runbook.md` §4/§5 inside the window if a gate fails |
| A-AFLT | disable the AFL Tables nightly timer in the V2 release window (step 4a). Either ISSUE-316 C5 has already done it, or the owner accepts ending AFL Tables acquisition at that point (after D-316-1's final acquisition; RISK-27) |

### 4.4 AFL API cutover approvals (ISSUE-316 track; V2 executes, grants or shortens none)

`issues/open/AFLDB-ISSUE-316.md` §7-§8: **D-316-1** (C2: the final AFL Tables acquisition and the
2026 rollover that retires AFL Tables), **D-316-2** (C3: install the AFL API units inert),
**D-316-3** (C4 evidence bar for the 2027 rounds and venues), **D-316-13** (C4b production D1
rehearsal; only after C4 is deployed), **D-316-4** (C5 cutover go, which disables the AFL Tables
timer; needs a recorded C4b PASS), **D-316-5** (debutant routine), **D-316-6** (ownership replay
before the 2027 rollover), **D-316-7** (Brownlow totals without AFL Tables), **D-316-8**
(attendance), **D-316-9** (coaches), **D-316-10** (AFL API revalidation or ISR lag), **D-316-11**
(optional start-now), **D-316-12** (documentation and the admin current-season panel; V2 already
retired that panel's Start button); and **AFLDB-ISSUE-229 B2** (fixtures, V2-GAP-008).

## 5. How a verdict changes

Only the owner changes a verdict, in writing, against evidence: the rehearsal row moves to
"performed" when §10 of `shadow-rehearsal.md` is filled in; the production row can move to GO only
when every "blocks" line in §3 is cleared with evidence, every approval in §4.2-§4.4 that the
release needs exists, and `cutover-runbook.md` preconditions P1-P5 hold.
