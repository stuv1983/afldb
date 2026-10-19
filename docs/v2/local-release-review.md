# Local release package — owner review

Scope: single-agent continuation of `36679a1e` on `v2/rebuild`, 2026-10-19–20.
No additional worktree, remote, production/shared database, host, deployment, service operation
or push. All five existing worktrees were preserved. Focused local commits are recorded in
the final handoff. Production verdict: **NO-GO**.
An unrelated untracked `.codex/` directory appeared during execution. It was not read, changed,
staged or committed; evidence tooling lists it separately from task changes.

## Implementation and evidence

- Brownlow: authoritative stored season totals remain raw votes; `vote_rank` and provenance
  are preserved. Only eligibility/medal metadata and career medal projections change. Cited,
  capability/seal-checked decisions and publication commit together; required audit failure
  rolls back both. Unresolved relevant eligibility clears the public winner, not raw votes.
  Joint eligible leaders are supported. Public queries and existing manual publication use
  the same canonical determination. Idempotent replay adds no duplicate publication audit.
  Staged-only evidence never fabricates an authoritative public total: the existing explicit
  season-total finalisation step must run first and also invokes the canonical determination.
  Revalidation has a capability guard and fixed paths. ADR 0014 records the amendment.
  Generic award URLs permanently redirect to the canonical Brownlow pages. Retained named-medal
  rows are source evidence only: generic public award reads cannot publish them. Generic award
  criteria and all first-place Brownlow criteria use the same canonical winner flag, including
  refusing a known co-leader while another co-leader remains unresolved.
- Historical Brownlow: `evidence/local-brownlow-history-final.json`, **98 seasons**, all determined
  and agreeing, none unresolved/disagreeing. This is authoritative **local stored-total** evidence,
  not API parity or production agreement. No historical metadata was bulk rewritten.
- Coleman: established **46/46 seasons (1980–2025)** agreement retained, not unnecessarily rerun.
  `local-coleman-complete.json`: **27/27** canonical-publication integration assertions pass on
  the separate schema-only isolated database. Offline bootstrap cannot overwrite a published
  season, shares canonical season locks and requires strict live isolated identity proofs.
  Locks are session-scoped so import-batch commits cannot release protection early. A real
  competing-lock probe proves protection across commit and release on connection close.
- Legacy: six retained acquisition implementations/poller physically moved under
  `legacy/offline/tools/`; former entry points refuse. Historical deterministic replay tools
  remain available. No normal app/worker/package/deploy caller can reach legacy acquisition.
  Live timer/polkit retirement commands remain future owner-approved actions.
- Fresh isolated replay: `afldb_v2_rb_release_test`, all **30 stages / 89 validation checks**,
  migrations 001–114; additive **115** then supplies the missing adjudication supersession FK
  index. No schema/grant assertion was weakened: the FK catalogue gate now recognises a unique
  parent determinant and tests negative controls for non-unique prefixes/unrelated predicates.
- DraftGuru: authentic parent `data/reference/draftguru-person-bridge-20260918-v2.json` resolves
  against this database to **3,468 bridges**, **1,589 withheld** from **5,057 persons**. Child hash
  `bdb150f94a605e64574137ff26f44f4d82946ebac15b754b7d703f33461c34ff` for the final target; created under ignored
  `.local-release/`, no fabricated registrations. Importer tests restore the release bridge after
  deliberate no-bridge cases. Missing required frozen sample/Python fails, rather than skips.
  Frozen sample comparison normalises only its known checkout-prefix path; hashes/provenance
  and cohorts stay pinned. The operator verdict's missing terminal LF was restored to its
  existing pinned SHA, not repinned (Git's blank-line-at-EOF warning is intentional).
- Four real fitzRoy row/identity checks now use retained accepted `full-history-20260902`
  rather than skipping an obsolete absent `20260827` path. All original assertions remain;
  absent required CSVs now fail with the exact missing path. Frozen source suites: **282 passed,
  0 failed**, one database-dependent case unselected in that DB-free run (covered by the full run).
- Exposed local credentials: all **six** dedicated-cluster role passwords rotated. Each new
  login passed; each old password was rejected with SQLSTATE **28P01**. Recovery/secret files
  remain outside the checkout; dependent runner configuration loads the replacements. All
  databases/evidence preserved. No password, session cookie or private DSN is committed.

## Verification

Final assertion-level results are recorded in `evidence/local-delivery-summary.json` and its two
input reports. Skips are listed by identifier, never counted as passes. The separately selected
restricted import-role row-lock probe passes **1/1**, `evidence/local-import-role-lock-final.json`;
the first schema-only attempt failed clearly for missing clubs before it could run the probe.
The broad workflow
is not called green while strict historical/source evidence or platform tests remain unresolved.

The final target is **afldb_v2_rb_final_test**, freshly cloned from the preserved historical
template, migrated through 115 and supplied the measured/imported authentic bridge BEFORE
read-only linkage checks. The intermediate `local-supported-tests-release.json` began without
that restored input and exposed oracle/fixture problems. The final repairs passed **313/313**
(`local-final-isolation-repairs.json`): linkage, populated Grid Solver, adjudication replay and
strict role source contract. Final canonical/public criteria checks pass **324/324** on the
fresh final target (`local-brownlow-complete-final.json`). Final broad workflow:
`local-supported-tests-delivered.json` (the default `npm test` / Vitest workflow).
No failed intermediate attempt was deleted or called green.
Final measured result: **13,740 passed / 9 failed / 31 skipped / 13,780 total** across 292 files;
no failed setup/teardown-only suite. The separately executed Coleman suite is **27/27**.
Together: **13,767 passed / 9 failed / 31 skipped / 13,807 total**, not green. All four original
gap-028 files pass **200/200**, including cleanup. The nine residual assertions below are the
only final failures of that run. GAP-029 follow-up (2026-10-20): seven are repaired and two
Gridley strict assertions remain; see the table below. The figures above are not restated.
Two incomplete broad runs were deliberately stopped for the Coleman lock-boundary and canonical
Brownlow read-model repairs; their isolated databases remain preserved. They are not completed
test evidence. An earlier parallel typecheck/build collided with regenerated `.next/types`;
the final serial typecheck after the completed build passed. Do not run those two jobs concurrently.

Typecheck: `node node_modules/typescript/bin/tsc --noEmit --incremental false` — exit 0.
Final V2 production standalone build: exit 0, **1,516 pages**; previous compatible build: exit 0,
**1,516 pages**. Final changed-file lint is compared with the explicit starting commit, retaining
inherited findings. A repository-wide rerun was warranted after excluding the generated rollback
archive: **234 errors / 131 warnings / 0 fatal**, `local-repository-lint-complete.json` (not green).
Final changed-file comparison is `evidence/local-lint-delivered.json`: **64 files, 101 inherited
errors, 14 inherited warnings, 0 new findings**. This is not a clean lint result.

The prior full run (`local-supported-tests-complete.json`) recorded 13,739 passed, 10 failed and
31 skipped. One failure assumed a particular deadlock victim. [PostgreSQL 16 §13.3.4](https://www.postgresql.org/docs/16/explicit-locking.html#LOCKING-DEADLOCKS)
explicitly leaves that choice unspecified. The fixture now checks both legal outcomes: exactly
one abort, the correct SQLSTATE/typed refusal, bounded wait, atomic rollback, committed figures
and retry after a refused promotion. All **46/46** focused cases pass (`local-deadlock-contract-final.json`).
No sleep, retry-until-green, skip, privilege change or runtime guard relaxation was introduced.
The final complete workflow was rerun after this fixture repair.
It passes all 46 promotion cases; none of the nine final failures is a deadlock fixture.

Strict residual assertions (full describe paths, messages and source locations are retained in
the delivery summary):

| File | Test identifiers | Evidence still required |
|---|---|---|
| `club-comparison-route.test.ts` | Stage 7 valid pair; Stage FR-2 invalid-era fallback | **Resolved 2026-10-20.** 42 was 41 through 2025 plus a 2026 meeting; asserted as 41 strict + independent 2026+. |
| `home-records.test.ts` | preserves venue counts and NULL attendance semantics | **Resolved.** 3200 / 485 were 3151 / 484 through 2025 plus 49 / 1 MCG matches played in 2026. |
| `nl-answers-cross-domain.test.ts` | X1 T1; X1 T12 | **Resolved.** 367 was 365 through 2025 plus two 2026-only coaches (Carr, Fraser); Adamson stays matchless in the source. |
| `release-gates.test.ts` | exact 261 players; exact 110 players | **Resolved.** Membership unchanged: both original digests reproduce exactly under the punctuation-ignoring key order; the gate is now collation-independent. |
| `gridley-corpus.test.ts` | no probed dataset gap; no failing cells | Board 541 cell 2-1 **resolved** (Gridley's key predates the 2025-10-15 trade). **Still open:** 172 cells need `match_event` labels, the 2026 register, owner treatment of the §23.36 accepted deferrals, and source-coverage rows. |

Seven of the nine assertions are repaired (commits `0faf8607`, `2ee29ade`, `642011c3`); two remain.
Focused run of the six GAP-029 files together, strict, on `afldb_v2_rb_final_test`:
**1,374 passed / 2 failed / 7 skipped (1,383)**, typecheck clean, changed-file lint 0 new findings
(`evidence/gap-029-focused-tests.json`). That is a focused result, not a new complete workflow:
the last complete result remains 13,740 passed / 9 failed / 31 skipped, and a full rerun would
be expected to show 2 failures. Cause, evidence and correction for each: **V2-GAP-029**.
Assertions remain strict; no tolerance, skip or diagnostic mode was used. Missing approved
reference evidence is not permission to relabel a disagreement as a proven data-only defect, to
repin digests, or to waive the release gate.

The 31 default-workflow skips are not passes: seven POSIX-only checks; one unavailable rescued
legacy archive; one synthetic continuity fixture with no collision-free source identity; two
opt-in diagnostic oracles; one restricted-role probe (separately run, 1/1); seven existing TODO
cases; eleven dedicated Phase-B harness cases; and one inverse unconfigured-role diagnostic.
The browser evidence is the focused standalone rehearsal, not a claim that all `test:e2e` or
NL stress journeys were run. Linux and host release gates remain explicit.

Initial four-file historical gap reproduction and exact test names:
`evidence/local-verification-initial.json`. Causes: 11 draft cases used illegal >200 pick fixtures;
two season-list cases assumed the highest registered season had appearances; one awards case
had obsolete captaincy/reference pins. The match-delete teardown additionally retained an audit
FK to its own throwaway administrator. Fixes preserve production constraints and source scope.

## Application rollback: demonstrated, not inferred

Previous app: archive of `ff100dc2b8da8523f550ef45a9eaa3ef96d9d840` in ignored
`.local-release/previous`, not a worktree. Same installed compatible dependencies; standalone
builds bind only loopback, previous **3911**, V2 **3912**, isolated databases. No environment
file or production DSN is read. Local sessions are synthetic and never exported.

Sequence/evidence: `local-rollback-1-previous.json` (15 checks), `2-v2` (19), `3-previous` (15),
`4-v2` (19); final after migration 115: `5-previous-115` (**15/15**), `6-v2-115` (**19/19**).
Expanded final public-route coverage: `7-previous-public` (**18/18**), `8-v2-public` (**22/22**).
After the canonical route repair, `9-v2-canonical` passes **24/24**, including explicit HTTP
**308** assertions for both old Brownlow award URLs and successful canonical page rendering.
`10-v2-final-capture` repeats **24/24** against the final 1,516-page build and records the final
four visual replacements. Earlier four captures are preserved under `local-visual-before-public-guards/`.
Checks include startup, static assets via browser, award/search/season/player/match/club routes and
Admin/Super Admin route permission differences. No browser exception or external request.
Cross-phase raw-vote/ledger fingerprints match, including **3 proposals / 6 decisions**.
The initial expanded harness attempt hit an unstarted previous port and a noncanonical player
URL; the harness was corrected to use the route's required `slug-id` and both versions rerun.
Neither was treated as application-regression evidence or hidden as a passing attempt.
Other new ledgers were empty; this is not a populated-ledger reversal test.
This is startup/schema/route/permission compatibility, not V2 feature parity: the previous app
does not acquire V2's new eligibility UI, legacy retirement controls or canonical generic URL
guards. A production rollback must keep writers paused and review legacy-route exposure rather
than assuming the previous release implements the new safeguards.

Both old and new applications were exercised against the additive schema, including the return
to the old app without reversing migrations and then forward again. The previous baseline
database was already additive: **schema-110-before-migration behaviour was not demonstrated**.
No destructive migration reversal was performed in this follow-up. Launch F's earlier identical
schema/grant reversal/reapplication result remains separate established evidence.
Still host-dependent: Linux process/service lifecycle, Caddy/TLS/traffic switching, environment
ownership, backups/restores from a production dump, host permissions and real-data compatibility.

## Visual assessment

All **26 original images**, 13 screens at desktop/mobile, were opened and inspected:

| Screens | Technical assessment |
|---|---|
| 01 operations / 02 Admin operations | Readable hierarchy; role-specific actions differ visibly; unavailable host status is explicit. |
| 03 awards queue | Status and review actions distinguish proposals from publications. Wide evidence tables scroll locally on mobile. |
| 04 decide / 05 read-only proposal | Guarded decision wording and read-only role difference are visible; long explanations remain legible. |
| 06 rejected history | Rejection/history state is explicit, not presented as publication. |
| 07 Coleman | Derivation/publication and comparison evidence are distinct. No misleading raw-vote mutation wording. |
| 08 Brownlow / 09 2025 Brownlow | Material stale eligibility/publication copy fixed; diagnostic missing API evidence now explicit. Long findings collapsed, raw leaderboard retained. |
| 10 current season / 11 retired upload | Retirement and missing host status are clearly stated; no functioning legacy start/upload control. |
| 12 admin home / 13 fixtures | Readable responsive layout and route/action wording; no material overlap or obscured required action found. |

Only affected 08/09 screens were recaptured from the final standalone build and opened again:
`evidence/local-visual/` (four images). Mobile tables intentionally scroll; long select text uses
the native control. Technical inspection is complete. **Owner acceptance remains pending**,
including preference/usability acceptance of the long evidence-first pages.

## Original V2-GAP-028 assertion identifiers

These are the original failing `it` titles (full describe paths and stacks are preserved in
`local-verification-initial.json`). The captaincy title was subsequently corrected to its actual
1,781-row reference input. The match-delete teardown FK was an additional suite error, not a
fifteenth failed assertion.

| File | Exact original test title |
|---|---|
| admin-draft | 6.3b rolls the PLAYER back when the draft write is what fails |
| admin-draft | 6.3 rolls back the selection and its record |
| admin-draft | 6.6 rolls the DELETE back with its audit |
| admin-draft | 6.5 rolls back the identity and the record update |
| admin-draft | 6.5 rolls the identity back when the refusal is found AFTER the insert |
| admin-draft | re-creates the manual player and selection with the same tokens, and no twin |
| admin-draft | replays a corrected year and club onto the manual row |
| admin-draft | binds the token onto the path-player instead of creating a twin, after a debut |
| admin-draft | finds a manual player awaiting identity with the REAL candidate query, and refuses |
| admin-draft | draft_pick_key names a source row and a manual row, and skips a NULL-source one |
| admin-draft | the players rule gives a manual player exactly one identity, path-first |
| admin-season-lists | offers who PLAYED last season, and writes absolutely nothing by itself |
| admin-season-lists | records candidate_source as evidence when a human explicitly picks one |
| awards-reload-links | reloads the full 1,375-row manifest as afldb_import with AFLDB_LEGACY_SQLITE unset |

## Focused local commits

| Commit | Scope |
|---|---|
| 8000587c | Dedicated-cluster credential rotation |
| 0e436fa4 | Atomic audited Brownlow metadata publication |
| 7ca4b4f2 | Physical legacy quarantine and offline bootstrap fencing |
| 3e6525ea | Verification portability, reference fixtures, migration 115 |
| a47c7954 | Reproducible standalone/verification tools |
| a0e04416 | Populated draft oracle and numeric adjudication fixture ordering |
| d8ac42a8 | Coleman locks survive historical batch commits |
| ed729332 | Generated rollback archives excluded from normal lint traversal |
| e9fffaa9 | Canonical Brownlow public routes and all winner criteria |
| c4bff9b6 | Preserve unrelated workspace state during evidence collection |
| 65da2385 | Verify the documented deadlock/atomicity contract without predicting the victim |
| delivery HEAD | This release package and retained verification evidence |

The final response identifies the delivery HEAD. The file manifest in
`evidence/local-delivery-summary.json` lists every task-changed repository file from `36679a1e`;
unrelated `.codex/` files are listed separately, not attributed to this work. `architecture.md`
received only its existing generated stage-map refresh; no architecture review was repeated.
`evidence/local-secret-scan-delivered.json` records the final retained-input credential scan;
a subsequent scan including the generated delivery manifest is retained under ignored
`.local-release/final-secret-scan.json`. Neither scan displays credentials.

## 2027 / ISSUE-229 B2

B2 is **first-season operational acceptance**, not a technical contract requiring a hard-coded
2027 year. Authentic retained 2026 `SCHEDULED` and `UNCONFIRMED_TEAMS` evidence proves the
implemented contract (established 17/17 integration, 67/67 contract tests and clean 2026 dry run).
It does not prove the first 2027 **whole-season** pre-match feed: genuine TBC representation if
present, all status/key variants and round/venue mappings must be observed, validate-only and
dry-run reviewed, followed by **owner-approved first apply**. Same-day Launch F evidence found
no 2027 compSeason; no additional public API request was needed or made. No response fabricated,
seasonal evidence waived or owner decision assumed. ISSUE-229 remains open in all three ledgers.

## Reproduce from retained local inputs

PowerShell, repository root; never paste a DSN. Set `AFLDB_V2_PG_ROOT` to the dedicated local
cluster root, `AFLDB_PYTHON`/`PYTHON` to the absolute Python executable with psycopg. See
`isolated-rebuild.md` for fresh guarded replay and prerequisites (absent inputs fail clearly).

```powershell
$env:AFLDB_V2_PG_ROOT='D:\tmp\afldb-v2-pg16'
$env:AFLDB_PYTHON='C:\Users\stuar\AppData\Local\Programs\Python\Python312\python.exe'
$env:AFLDB_TEST_PYTHON=$env:AFLDB_PYTHON
$env:PYTHON=$env:AFLDB_PYTHON
node node_modules/tsx/dist/cli.mjs tools/v2/isolated-pg.ts run afldb_v2_rb_final_test -- C:\Users\stuar\AppData\Local\Programs\Python\Python312\python.exe tools/rebuild/draftguru/export_person_bridge.py --resolve-against isolated --parent data/reference/draftguru-person-bridge-20260918-v2.json --out .local-release/new-child.json
$env:AFLDB_DRAFTGURU_BRIDGE='D:\dev\afldbV2\.local-release\new-child.json'
node node_modules/tsx/dist/cli.mjs tools/v2/isolated-pg.ts run afldb_v2_rb_final_test -- C:\Users\stuar\AppData\Local\Programs\Python\Python312\python.exe tools/rebuild/draftguru/import_draftguru.py --label annual-html-20260826 --bridge .local-release/new-child.json --no-seed --quiet
node node_modules/tsx/dist/cli.mjs tools/v2/isolated-pg.ts run afldb_v2_rb_final_test -- node node_modules/vitest/vitest.mjs run --exclude tests/integration/v2-coleman-publication.test.ts --reporter=json --outputFile=<new-full-report.json>
node node_modules/tsx/dist/cli.mjs tools/v2/isolated-pg.ts run afldb_v2_release_schema_test -- node node_modules/vitest/vitest.mjs run tests/integration/v2-coleman-publication.test.ts --reporter=json --outputFile=<new-coleman-report.json>
node tools/v2/release-test-summary.mjs <new-full-report.json> <new-coleman-report.json> <new-summary.json>
node node_modules/typescript/bin/tsc --noEmit --incremental false
node tools/v2/lint-changes.mjs 36679a1e <new-lint-report.json>
```

The Coleman suite intentionally requires its separate schema-only isolated target: it owns
whole-table counts. It is run, not skipped. Do not run both database workflows in parallel
against the same target. The release child must first be imported (or supplied to rebuild);
`AFLDB_DRAFTGURU_BRIDGE` is an evidence input, not permission to invent mappings.

For the separately selected role probe, use the historical-data target, not schema-only:
`isolated-pg.ts run afldb_v2_verify_test -- node tools/v2/local-import-lock.mjs <new-report.json>`.
Its own fixture is rolled back/cleaned, the role must be `afldb_import` and non-superuser, and
both DSN and live cluster/marker/current-database proofs remain mandatory.

Strict residuals are tracked as **V2-GAP-029**, not hidden under the closed original 14 failures.
The two stable-identity digest mismatches were an **ordering-only** disagreement: the original
pins reproduce exactly from the local 261/110 membership under the punctuation-ignoring key
order of the Linux collation they were taken under (2026-10-20); membership is unchanged. The
other count assertions were snapshot-scope pins (through-2025 values plus 2026 rows). Only the
two Gridley strict-mode assertions remain, needing `match_event` labels, the 2026 register,
an owner decision on the accepted deferrals and source-coverage rows. No matches, event labels,
player links or 2027 responses were invented.

## Remaining authority and approvals

Owner review of local commits, visuals and award interpretation; Linux/production-dump shadow
parity and privileged-role suite; approved host backup/restore and application rollback; release
window and migration **115** with the existing additive stream; email-intake/AFL Tables timer
and polkit retirement; ISSUE-316 C4/D-316-13/C5 ordering; B2 and first fixture apply; explicit
production GO and rollback standing authority. Existing unrelated V2 gaps remain in the gap/risk
registers. No production access, deployment, push or live service change occurred.
