# AFLDB-ISSUE-339 — Proposed corrections to the unpublished deployment preflight

**RESOLVED 2026-11-09.** Published by fast-forward of `origin/main` `c1c4b22e..8d122f62`; the merged revision `8d122f629df6a610ae4e95805e39583cc2ab8aaf` is the tested commit (gate `37bc6a6c`, R339 A–D `8d122f62`, replayed from `5cba6846` and `549c5892` without `48ff91c7`). Windows static harness PASS and Linux harness 63/63 at the candidate; W-339 61/0 carried forward (migration inputs and gate code unchanged); `merge:ready` and `preflight --mode merge` READY. Owner decisions D1–D4 recorded (D2 split to ISSUE-346). R339-D live-host argv exposure is **unmeasured**. Not deployed. Root cause, fix, validation and limits: `issues.md` → AFLDB-ISSUE-339 Resolution.

**Status: R339 A–D implemented locally 2026-11-08 (uncommitted, on top of 5cba6846). The user-executed Windows harness passed with automatic registry-based Git Bash discovery and exported both payloads.**

**Linux qualification on streamanator, 2026-11-08 (fresh `/mnt/ssd` workspaces, export copied to the root):**
- **Run 1:** 62 passed, 1 failed. All 22 e2e cases ran and passed. The only failure was `R339-C: missing decoder…`, a test defect: a leaked global `command()` stub left that case's PATH without `sh`.
- **Fix:** test-only, local, uncommitted.
- **Run 2:** `afldb-339-qual-20261108T000603Z`, **63 passed, 0 failed**, all 22 e2e cases ran.

Still open: owner review and the merge decision, plus the owner decisions below. See the [ledger entry](../../issues.md#afldb-issue-339) for the per-finding record.
To repeat: run `SYNC_DEV_GENERATED_DIR=<dir> bash tests/sync-dev-remote.test.sh` from a fresh disposable Linux workspace with the Windows export copied over. To regenerate the payloads, run `powershell -NoProfile -File tests/sync-dev-static.test.ps1 -ExportDir <dir>` on Windows. If discovery cannot find a usable installation, add `-GitBashPath <root>\usr\bin\bash.exe`.
Owner decisions still open: a custom `-DsnName` is refused unless `-SkipMigrate`. The other two are unchanged: standalone `db:migrate` approval, and `preflight --mode deploy`. **Severity: Medium overall.** The findings below came from the 2026-11-08 read-only review of the initial gate at 5cba6846ddfcfd5d7a3fd29e14bc8877099d9656. [Detailed ledger](../../issues.md#afldb-issue-339).

The earlier 43/43 Linux qualification and read-only DEV assessment remain historical evidence of their named cases. They do not cover the cases below. Do not treat this review as merge, deployment or standalone migration approval.

## Findings and exact source evidence

### R339-A — Assessed database is not bound to the migration child (Medium)

Evidence: deploy/sync-dev-remote.sh:378-392 reads the named DSN directly from .env; :744-756 assesses its live identity/ledger. deploy/sync-dev.ps1:102-103 configures the DSN name and expected database, but :325-326 dispatches plain npm run db:migrate. tools/db/migrate.ts:48-60 retains already-exported variables over .env; :79-82 maps dev/test/code-test/prod to different DSN variables; :118-140 chooses an environment target independently.

Trigger/prerequisites: the gate assesses database A, while AFLDB_MIGRATE_TARGET or an exported DSN makes the migration child select B. Both are reachable, and the existing migration collision/branch-local guards permit the reviewed migration; an approved pending transition on A does not pin the connection for B. The child can apply it to B. A post-migration parity check of A at sync-dev-remote.sh:828 is too late to protect B and may fail only after that write. With no pending work on A it may also offer no evidence about B.

Root cause: admission and mutation resolve connection configuration through separate parsers/precedence, with no shared approved target binding. Smallest fix: resolve one effective, secret-safe migration connection/target at assessment, reject conflicting configuration before checkout, and bind the migration invocation and all revalidations to it. Pin the runner target explicitly and validate all relevant environment sources; a target flag alone does not resolve an exported-DSN mismatch. Keep the actual migration runner's collision guards.

Reproduction/regression proposal: extend tests/sync-dev-remote.test.sh and tests/sync-dev-static.test.ps1 with conflicting AFLDB_MIGRATE_TARGET, exported owner DSN versus .env, and custom -DatabaseDsnName cases. The harness must observe the actual child's effective target, not merely an npm stub that changes the gate's fake ledger. Use fake secrets and disposable databases only. Acceptance: mismatch refuses before checkout/install/migration; matching approved migration touches only A and records its identity/transition. No DSN appears in output.

### R339-B — Preserved-main check rejects a legitimate main fast-forward (Medium)

Evidence: sync-dev-remote.sh:454-463 always includes refs/heads/main in the state digest. :798-808 compares that main/stash prefix unchanged after checkout. sync-dev.ps1:312-317 gates, fast-forwards the target then revalidates. :853-860 also compares the final entire digest unchanged.

Trigger: target branch is main, currently behind the assessed published revision, and other gate prerequisites pass. Fast-forward updates main as intended; checkout revalidation returns 42 because main changed. The checkout has changed, but install/migrate/build/restart have not yet run. The diverged-main preservation case in tests/sync-dev-remote.test.sh:448-450 exercises a different target branch and misses this normal-main path.

Smallest fix: distinguish the target branch's explicitly allowed old→assessed revision change from preservation of a non-target main. Use that same expected-state model at both revalidations. Do not drop stash/untracked/.env preservation or accept any arbitrary main movement. Acceptance: pinned and unpinned main fast-forwards complete through the harness; non-target main remains byte-for-byte the same ref; unexpected main/stash movement still fails. Include failure-state evidence showing whether checkout has already moved.

### R339-C — Transport decoder errors can become successful SSH status (Medium)

Evidence: sync-dev.ps1:438 runs echo PAYLOAD | base64 -d | gunzip | bash -s in the remote outer shell; :439 uses its final status. The payload's own set -Eeuo pipefail at :240 takes effect only after decoding and does not control the outer pipeline. The gzip layer is new in this unpublished change; the predecessor base64 pipeline already shared the last-command-status weakness.

Trigger: a decoder is missing or fails before emitting script bytes. With ordinary shell pipeline status, the final bash runs empty input and returns 0, so SSH and the PowerShell wrapper report success even though no gate ran. Corrupt/truncated input can also emit a partial script before decoder failure; adding pipefail alone would report failure but still allow early execution of partial input.

Smallest fix: decode and validate the complete payload before execution, in an outer shell that propagates all decoder failures. Do not rely on the inner payload's shell flags. Preserve secret-free payload handling and clean temporary transport state on failure. Extend the existing PowerShell transport/remote tests with missing decoder, invalid base64, corrupt gzip and truncated payload; assert nonzero status through powershell -File and Tee-Object, zero gate/mutation execution when decoding fails, and success only after a complete payload. A previous exit-40 pipeline test does not cover pre-payload failures.

### R339-D — New read-only gate puts the owner DSN in process arguments (Low)

Evidence: sync-dev-remote.sh:387-392 passes the raw .env DSN to psql as an argument. Suppressing stderr prevents one output channel, not process-argument inspection. Trigger: a password-bearing DSN and a local observer allowed to inspect argv; practical exposure depends on host process visibility, which was not inspected.

Smallest fix: apply the established secret-free connection contract from tools/db/psql.ts and closed ISSUE-313 to this new shell caller, keeping passwords out of argv and logs. Preserve percent-decoding and reject ambiguous dual password sources rather than inventing precedence. Test with fake credentials in userinfo/query, encoded characters and refusal cases; argv and evidence must never contain the fake secret. Same-owner/root environment visibility is not claimed solved. This is a new caller, not reopening ISSUE-313's fixed helper scope.

## Proposed implementation sequence and dependencies

1. Extend the two existing sync-dev harnesses with R339-A/B/C/D regressions, including real child target resolution and the outer transport boundary.
2. Bind assessed and migrated identity/configuration (A), using a secret-free invocation (D). Review configuration precedence before changing code.
3. Correct expected preserved state for target main (B), preserving all non-target state checks.
4. Make transport decoding atomic before execution and propagate decoder failure (C).
5. Run focused Linux remote and Windows PowerShell harnesses; inspect generated payload and failure exit statuses. Only a later owner-authorized run may assess DEV or create/verify operational recovery artifacts.

Owner decisions still needed: the accepted custom-DSN/target configuration contract; whether standalone db:migrate must enforce transition approval; whether preflight --mode deploy should accept approved transitions. Those last two are already recorded ISSUE-339 gaps, not newly approved requirements. An authenticated acceptance sign-in remains an owner action. No approval is inferred from this playbook.

ISSUE-336's run-name correction can share wrapper qualification but is independently gated. ISSUE-341/342's restore fixes are independent prerequisites before relying on that restore-test entry point for new backup proofs; do not conflate its marker with the separate dev-backup-verify layout used by this gate.

## Failure handling and recovery

Fail before mutation on target or transport disagreements. Record a nonzero terminal result for every completed payload failure. A decoder failure may produce no remote evidence file; that absence is failure, not success. If checkout already advanced under B, report old/new revisions and stop before migration; preserve local branches, stashes and files, without automatic reset. If a migration was directed elsewhere, stop further deployment and establish actual target/ledger under separate authorization; do not automatically reverse migrations or restore a backup. Never retry restart/apply to manufacture a green result.

Acceptance is all four focused failure matrices passing with explicit no-write/no-execution assertions, plus existing 43-case behavior retained where its assumptions remain valid. No implementation, test, DEV or production operation occurred during this review.

<a id="repository-review-handoff-2026-11-08"></a>

## Repository review handoff — 2026-11-08

### Baseline and publication distinction

- Root: D:/dev/afldb. AGENTS.md and IssuesIndex.md read before investigation. Branch: claude/issue-339-deploy-preflight. Exact HEAD: 5cba6846ddfcfd5d7a3fd29e14bc8877099d9656; parent: 48ff91c78edfaa51fc8e67650beea5dc3816d9ac (documentation of prior DEV delivery).
- Locally recorded published origin/main: 7fabc6e51c5c53c4b6f6fe345f21191d9184660b, corroborated by the existing ISSUE-336 publication record. No fetch or remote/host inspection: this is not proof of current remote or deployed revision.
- Initial tracked worktree clean; git diff empty. Untracked .codex/ existed and was not opened or changed. Source differences from local origin/main are only deploy/sync-dev-remote.sh, deploy/sync-dev.ps1, tests/sync-dev-remote.test.sh and tests/sync-dev-static.test.ps1. Other differences are pre-existing issue/deployment/changelog documentation and tracked ISSUE-336 evidence records; those backup/host artifacts were not opened for this review.
- ISSUE-339 R339-A/B/D and new gzip transport behavior are unpublished at HEAD. R339-C's underlying pipeline-status weakness also exists in the prior base64 transport. ISSUE-336's wrapper defect and ISSUE-340–345 source are unchanged from the local published baseline. ISSUE-338 is an existing published test defect. No live occurrence is inferred from source reachability.
- Review writes are restricted to issues.md, IssuesIndex.md and these proposed issue playbooks. No application, test, configuration, database, deployment, backup, worktree or CHANGELOG change. Everything remains local and uncommitted.

### Evidence classification and findings

| Issue | Severity | Evidence | Next action |
|---|---|---|---|
| [340](AFLDB-ISSUE-340.md) | High | Source-established credential/session interleavings; executable concurrency witness pending | Review transaction/session design, then focused tests |
| [341](AFLDB-ISSUE-341.md) | Medium | Source-established wrong-target path; libpq precedence already established in closed ISSUE-278; no destructive witness run | Pin restore target and prove refusal |
| [342](AFLDB-ISSUE-342.md) | Medium | Source-established arbitrary-exit acceptance; interrupted-post-data witness pending | Strict completion and disposable fault injection after 341 |
| [339](#findings-and-exact-source-evidence) | Medium (D Low) | Unpublished source findings A–D; earlier 43/43 pertains to different cases | Fix and qualify before merge/deployment decision |
| [343](AFLDB-ISSUE-343.md) | Medium | Source-established alternate fixture entry points omit existing identity proof | Extend shared admission boundary |
| [336](../open/AFLDB-ISSUE-336.md#6-pre-implementation-review-hold--2026-11-08) | Medium | Source-established mutually impossible run-name predicates | Repair/rehearse wrapper before production procedure |
| [344](AFLDB-ISSUE-344.md) (resolved 2026-11-08) | Low | Source-established empty-offset count/render failure | Correct total and page recovery |
| [345](AFLDB-ISSUE-345.md) | Low | Source-established restricted audience omits forced-change check | Reuse shared guard |
| [338](AFLDB-ISSUE-338.md) | Low | Existing recorded failure once, five passing reruns; source explains clock dependency | Deterministic test clock |

ISSUE-332 remains open and unchanged; its future owner decisions/seasonal obligations are not defects reopened by this review.

### Recommended implementation order

1. ISSUE-340, with independently scoped ISSUE-345 in the same authentication regression pass. Credential-generation/schema choices precede any migration design.
2. ISSUE-341 then ISSUE-342 together in one restore safety workstream; wrong-target refusal precedes real restore fault injection.
3. ISSUE-339 A–D together, with ISSUE-336's grammar fix sharing operational wrapper qualification. Both must be qualified before their respective deployment/production decisions; neither authorizes a live run.
4. ISSUE-343 can proceed independently after its control/writer identity test contract is agreed.
5. ISSUE-344 and ISSUE-338 are independent low-risk follow-ups; preserve draft category and provenance contracts.

### Coverage and limits

This is a repository source review across the requested subsystems, prioritized by reachable trust/data/operation boundaries. It is not an every-line proof, runtime penetration test or validation of any live data. Material findings were traced through callers, guards and failure behavior. Graph tools were not exposed in this session (no project/generation or check_index_coverage available); native tracked-file/source searches supplied the fallback. No negative graph-completeness claim is made.

| Subsystem | Source/evidence inspected | Findings and remaining evidence |
|---|---|---|
| Authentication/public routes | middleware; beta redemption/magic confirmation; sessions/login/password/reset; rate limiting; admin capability boundary inventory; API health, health-event, early-access, autocomplete, coach opponent and internal revalidation; Caddy forwarded-header handling | 340/345. Worker-local rate limits and cache behavior assessed against existing decisions; no distributed load or live proxy proof |
| Admin/data integrity | Guard call sites; audit logging; Data Editor save/override flow; match deletion/refusal and lineup paths; coach linking; fixture/season and player-link mutation locking; draft lifecycle and Brownlow accounting contracts | 340/344. Sampled high-risk transaction paths, not every mutation interleaving. No live orphan/data census |
| Database | Application SQL client; query pagination/filter/order/NULL use; auth/session schema and targeted privileges; migration runner/target selection; reset/restore and transaction/retry boundaries | 341/342/343 and 339-A. No live privilege/schema verification, migration execution or query plans |
| Ingestion/rebuild | AFL API controls/identity helper; match and fixture settlement; snapshot/provenance verification; player resolution; historical seal; canonical transaction/recompute and rebuild/preflight/replay boundaries; current operator-review contract | 343/338. No source reacquisition, corpus replay or protected-store inspection; historical accepted source limitations retained |
| Public features | Draft year/list/admin queries and renderers; active search entry and NL execution boundary; Grid Solver audience/query paths; fixture writer/callers; coaching/opponent joins; Brownlow season authority/missing-value semantics | 344/345. No full deterministic NL corpus, exhaustive solver board enumeration, browser or data parity run |
| Operations | DEV sync outer wrapper/payload/preflight; production release build/promote/rollback source; I336 wrapper; backup/restore script; scheduled match/Brownlow wrappers and status traps; existing issue decisions | 336/339/341/342. No DEV/production access, private backup read, restore, release artifact inspection or timer observation |
| Regression coverage | Existing auth/lifecycle, catalogue/draft, ingestion safety/fixture, Grid/Brownlow/NL semantic test homes; gap029, sync-dev and DraftGuru contracts mapped to concrete failures | Proposed focused cases in each playbook. No test/build/typecheck executed; existing pass/failure records are labeled as prior evidence |

### Leads excluded from the defect ledger and evidence still needed

- runAdvancedSearch has a similar window-count shape, but /advanced-search redirects to /players (src/app/advanced-search/page.tsx:50-54). A retained test caller is not an active public-route defect. No issue allocated.
- The existing ingestion identity helper compares database names. Same-name databases on distinct clusters could need a stronger identity contract; supported deployment topology and a concrete reachable configuration were not established. Kept as a verification lead, not an additional finding or an implied guarantee of 343's fix.
- Cross-worker in-memory rate-limit multiplication is an explicit best-effort contract (src/lib/auth/rate-limit.ts:14-21); revalidatePath/cache propagation was compared with the accepted limitations in ISSUE-134/308. No new evidence justifies reopening them. Global abuse resistance or cluster invalidation requires separate measured evidence and an owner contract.
- Standalone migration transition approval and deploy-mode preflight suitability remain ISSUE-339 owner decisions. Legacy or advisory entry points were not automatically classified as bypass defects without checking their current scope/retirement rules.
- Dynamic reachability witnesses remain needed for 340, 341, 342 and 343; static source establishes the missing boundary, not a real incident. Practical argv exposure for 339-D depends on host visibility. The November 8 nightly observation in ISSUE-336 remains pending; this review did not observe it.

The implementation decision is the next phase. This document does not grant it.

### Documentation verification at review close

- Independent bounded source verification re-derived the cited failures and baseline/publication distinction; no material correction identified. This was a source/document check, not runtime validation.
- Ledger Open Issues table and IssuesIndex.md each contain exactly the ten current IDs: 332, 336, 338–345. Each reviewed issue has one detailed heading and a proposed playbook. Local file links and proposed status were checked.
- Read-only git diff --check passed. Final source/test/configuration/CHANGELOG diff is empty relative to the initial checkout. Eleven authorized Markdown files changed: issues.md, IssuesIndex.md, existing issues/open/AFLDB-ISSUE-336.md, and new playbooks for 338–345. Pre-existing untracked .codex/ remains untouched.
- No tests, typecheck, build, scripts, DB commands, host operations or remote Git operations were executed. Review records are local and uncommitted. Stop at this review handoff; implementation requires the next user instruction.
