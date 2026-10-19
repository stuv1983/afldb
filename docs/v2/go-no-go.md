# AFLDB V2 — go/no-go checklist and current verdicts

Status: recorded at the close of Stage 6 (Launch E, 2026-10-19), the last V2 stage. The criteria
are the owner's (`docs/v2/owner-instruction-2026-10-19.md`, "Go/no-go criteria"); each is judged
against committed evidence only. "Unverified" means the evidence would need a database, a build,
a browser or a host that V2 may not use, not that the property is believed false. **No production
system has been contacted or changed, and nothing has been pushed or deployed.**

## 1. Verdicts

| Decision | Verdict | Why |
|---|---|---|
| Continue local development | **GO** | Every stage is committed with closure records; the local gates hold (tsc 0, full-suite failures equal the 102-line baseline, repo-wide ESLint at the 253/132 ceiling, generator checks 0); no `.env`, no DSN, no network is needed |
| Run the isolated shadow rehearsal (`docs/v2/shadow-rehearsal.md`) | **GO, conditional** on the owner's approvals S-A1..S-A5 (§4.1). It touches no production system: it restores a dump into `afldb_v2_shadow_test` on a rehearsal host | The tooling, isolation guard, thresholds and procedure exist and are unit-tested; none has met real data, which is exactly what the rehearsal is for (V2-GAP-026) |
| Production cutover (V2 release and the AFL API cutover) | **NO-GO** | Open cutover blockers V2-GAP-008, 011 and 013; the rehearsal (and so both rollback paths) has never run; award results are not shown reconcilable (V2-GAP-015/016); ISSUE-316's production gates are unsatisfied and D-316-13 has not been approved after a deployed C4 (§3) |

V2 is **implemented locally and not shadow-ready in the owner's full sense**: the label
`shadow-ready` is not claimed, because several criteria in §2 are unverified until the rehearsal
runs. Shadow-ready would still not mean cut over.

## 2. The `shadow-ready` criteria, one by one

| # | Criterion | State | Evidence |
|---|---|---|---|
| 1 | The existing frontend builds and its critical contracts are preserved | **unverified** (contracts met) | `npm run build` prerenders from a database and has never run in V2 (V2-GAP-002); `npx next typegen` and `tsc` pass; public routes and their tests unchanged; the Stage 5 admin pages never rendered with data (V2-GAP-022) |
| 2 | Existing PostgreSQL data retained without destructive migration | **met by design**, unexecuted on PostgreSQL | migrations 111/112 only create tables (ADR 0004; `docs/v2/cutover-runbook.md` §2); applied only on PGlite (V2-GAP-017) |
| 3 | Stable identifiers and relationships preserved or explicitly mapped | **met** (no id is changed); proof on real data pending | no migration alters an existing table; the manifest digests stable id columns as facts and the parity check fails on any change (plan §7 R-045); never run on real data (V2-GAP-007) |
| 4 | AFL API ingestion snapshot-based, validated, replayable and idempotent | **met in code and unit tests**; PostgreSQL idempotence unverified | Stage 3 (`replayAflApiSnapshot`, `aflApiPlanDigest`, the settle CLI seal); settle integration suites unexecuted (V2-GAP-009); the rehearsal replays one snapshot twice (§7) |
| 5 | Promotion transactional and fails closed | **met in code**; unverified on PostgreSQL | Stage 3 promotion and the Stage 4 publishers use one transaction and refuse on any check; V2-GAP-009, V2-GAP-017 |
| 6 | Fixtures and players cannot be silently fabricated | **met** for players (refusal, never a placeholder: Stage 3 resolution tests); fixtures are **not written at all** by the AFL API path (V2-GAP-008, a cutover blocker) | `tests/v2-*` resolution suites; known-gaps 008 |
| 7 | Brownlow reconciliation passes | **unverified** (synthetic only); one owner decision open | `tests/v2-brownlow-reconciliation.test.ts`; no eligibility rule for API-era seasons (V2-GAP-016); no staged leaderboard (V2-GAP-023) |
| 8 | Coleman derivation passes for winners, ties and incomplete seasons | **met on synthetic inputs** | `tests/v2-coleman.test.ts`; no real season compared (V2-GAP-015) |
| 9 | Curated awards require review and retain citations and audit history | **met in code and PGlite tests**; PostgreSQL unverified | Stage 4 workflow, Stage 5 actions with the D9 action card; four-eyes is an open owner decision (V2-GAP-019); V2-GAP-017 |
| 10 | Runtime code has no dependency on CSV, AFL Tables, Squiggle or Kali | **not met** | every admin path to CSV/Squiggle/Kali refuses (Stage 5); the AFL Tables nightly settle still runs on the host behind ISSUE-316 (V2-GAP-011), the email-intake timer still runs until cutover-runbook step 4 (V2-GAP-013), and the AFL API settle imports helpers from `settle-afltables.ts` (V2-GAP-012) |
| 11 | Valuable historical tools are safely quarantined | **partly met** | TypeScript entry points refuse through the retired-entry registry; Python/R tools stay in place (V2-GAP-014) |
| 12 | Admin operations are narrow, permissioned and audited | **met in code and tests** | capability guards, one audit row per mutation and per refusal (Stage 5 closure); not exercised against PostgreSQL (V2-GAP-017) |
| 13 | Tests, type checking and linting pass | **not met in full** (no regression) | tsc 0; the full suite's 102 failing lines are the pre-existing, environmental baseline (`docs/v2/evidence/baseline-failures.txt`, V2-GAP-003); repo-wide ESLint 253 errors / 132 warnings, all pre-existing; every file V2 created or edited lints with 0 errors |
| 14 | Production access is not needed to run the test suite | **met** | ADR 0005: the test setup strips DSNs and refuses any non-`_test` database |
| 15 | Migration, comparison, rollback and cutover instructions are complete | **met as written**; rollback untested | `cutover-runbook.md`, `rollback-runbook.md`, `shadow-rehearsal.md`, parity policy `v2.parity.1`; V2-GAP-026 |
| 16 | No secrets are committed | **met** | no `.env*` beyond `.env.example`; DSNs in tests are synthetic placeholders; closure scans at every stage |
| 17 | No production action has occurred | **met** | V2 has no remote; no database, ssh, deploy or network command was run in any launch (progress records) |

## 3. Production no-go conditions

| Condition (owner's list) | Holds today? | Evidence |
|---|---|---|
| Fixture identity can duplicate or misassign matches | **yes, blocks**: the AFL API fixtures writer is unbuilt and ISSUE-229 B2 is uncaptured | V2-GAP-008 |
| Player resolution creates placeholders or silently guesses | no | Stage 3 refusal tests |
| API coverage is assumed rather than verified | no: 2012-2025 API coverage is not claimed | V2-GAP-010, `docs/v2/coverage-matrix.md` |
| Historical data would be deleted or rewritten destructively | no | additive migrations; seal checks (V2-GAP-006 for other writers) |
| Brownlow or Coleman results cannot be reconciled | **not yet shown reconcilable: blocks** | V2-GAP-015, 016 |
| The frontend requires unplanned breaking schema changes | no | no existing table changed |
| Admin actions can bypass validation, permissions or auditing | no (code and tests); unexecuted on PostgreSQL | Stage 5 closure; V2-GAP-017 |
| Runtime still depends on legacy ingestion | **yes, blocks** | V2-GAP-011, 013 |
| Shadow comparison thresholds are undefined | no: policy `v2.parity.1` | `shadow-rehearsal.md` §8 |
| Rollback is untested or unclear | **untested: blocks** | `rollback-runbook.md` §7, V2-GAP-026 |
| ISSUE-316 production gates remain unsatisfied | **yes, blocks** | `issues/open/AFLDB-ISSUE-316.md` §7-§8 |
| D-316-13 not separately approved after the required C4 result | **yes, blocks** | ISSUE-316 §7 C4b |

## 4. Every approval still required (none exists today)

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
| V2 merge | review and merge `v2/rebuild` into the mainline (V2 has no remote); reconcile the 19 ISSUE-316 follow-up-8 files it carries (commit `c9cca86d`) with the source worktree (RISK-15) |
| V2-GAP-004 | fix or disable the user-level Read/Grep/Glob hook that runs in the source worktree; decide on the stray `supplies` |
| V2-GAP-005 | whether AFLW joins the historical manifest |
| V2-GAP-006 | database-level seal enforcement |
| V2-GAP-016 | the Brownlow eligibility rule for API-era seasons |
| V2-GAP-019 | four-eyes approval for curated awards |
| V2-GAP-021 | the correction workflow for projecting Coleman results into `award_winners` |
| V2-GAP-024 | fix the curated-approval page revalidation first, or accept up to a day of lag (no production approvals until decided) |
| contributor role | whether the contributor "Upload data" navigation (now a retired page) stays (RISK-21) |
| V2-GAP-022 | eyeball verdicts for every Stage 5 page (`admin-operations.md` §6), images or VISUAL: UNVERIFIED |
| V2-GAP-015 | review every Coleman `disagree` found by the rehearsal |

### 4.3 Production release approvals (V2 release track, `cutover-runbook.md`)

| Id | Approval |
|---|---|
| A-REHEARSAL | accept the rehearsal record (`shadow-rehearsal.md` §10): parity PASS or every FAIL reconciled, rollbacks rehearsed |
| A-BACKUP | the production backup and the read-only before-manifest (`rollback-runbook.md` §2 gate B; reading production with the manifest producer's non-test flags) |
| A-GO | the owner's signed GO on this document's production row (cutover precondition P1) |
| A-REL | the release window: writers paused per the production release procedure, the email-intake timer disabled (step 4), migrations 111-112, privileges, code (precondition P5) |
| A-ROLLBACK | standing authority to run `rollback-runbook.md` §4/§5 inside the window if a gate fails |

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
