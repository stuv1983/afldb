# AFLDB V2 — risk register

Status: local release follow-up (2026-10-20; first written at Stage 6). Risks of putting V2 into production and of the way V2 was
built, ranked by severity (High, Medium, Low; within a level, by impact on production data first).
Likelihood and impact use the same three levels. "Owner" is who must act: **owner** (the product
owner's decision or approval), **operator** (a person with host/database access, acting under the
owner's approval), or **V2 follow-up** (repository work that can be done locally). Every row links
the `V2-GAP` entry in `docs/v2/known-gaps.md` that carries its evidence, where one exists.

Launch F mitigated several risks on the **isolated** PostgreSQL 16 cluster: a loopback-only local
cluster of `afldb_v2_*_test` databases (`docs/v2/isolated-rebuild.md`). No production, DEV or
shared database, no host and no service was contacted. The only network use was one read-only
GET of the public AFL API compSeasons list. "Isolated" below means that cluster.

## High

### Current local-release reassessment (2026-10-20)

This amendment supersedes stale claims in the historical rows below:

- RISK-03: literal-name portability is repaired with stricter live isolated proofs; Linux and
  production-dump verification remain outstanding. Migration 115 corrects a missing FK index.
- RISK-04: final workstation production build passes with 1,516 pages; not a production-data build.
- RISK-07: previous `ff100dc2` → V2 → previous → V2 standalone compatibility is locally rehearsed
  without destructive reversal. Non-empty proposal/audit history and raw-vote hashes survive.
  Host backup/Caddy/systemd/TLS and production-dump rollback remain untested.
- RISK-10: all 26 original desktop/mobile images inspected; four affected Brownlow screens
  recaptured and inspected after fixes. Technical assessment is not owner acceptance.
- RISK-11: Brownlow publishes atomically and reconciles 98/98 local seasons; Coleman 46/46 local
  comparison retained. Offline Coleman cannot overwrite publisher-owned seasons. Production
  data and missing API leaderboard/team mapping remain separate evidence gaps.
- RISK-12: final repo-wide debt is 234 errors/131 warnings, not the older ceiling below.
  Changed-file comparison reports zero new findings while retaining existing lint errors.
- RISK-22: acquisition implementations physically quarantined; historical replay preserved.
- RISK-26: original 14 historical failures are repaired and individually tracked in the release
  evidence. Any residual complete-workflow failures are NOT converted into a green release gate.
- Exposed isolated credentials: all six rotated locally; each old password rejected with 28P01.
  No production/shared credential changed and no secret was committed.

Exact results and remaining source-input limitations: `local-release-review.md`.
Final complete run: **13,740 passed / 9 failed / 31 skipped**, plus separate Coleman **27/27**.
Strict baseline/count/membership residuals remain **V2-GAP-029**: latest focused result
1,378 passed / 3 failed / 7 skipped; 149 strict findings, including 78 approved deferrals
(0 data matches) and 71 unapproved. Eight audited rookie selections resolve 23 findings / 7 cells.
Event labels, board-dated 2026 participation and the sibling scope/evidence remain open.
See `gap-029-gridley-resolution.md`; no full-workflow or production waiver. The historical risk
rows below retain Launch F wording; the reassessment above is the current state.

| # | Risk | Likelihood | Impact | Mitigation | Owner | Gap |
|---|---|---|---|---|---|---|
| RISK-01 | **AFL API fixtures depend on unseen 2027 data.** The writer is built and tested on isolated PG16 (Launch F), but the 2027 pre-match feed (AFLDB-ISSUE-229 B2) does not exist yet. Its TBC representation and whole-season shape are therefore unverified | certain until 2027 is published | High | the writer fails closed on any unobserved status or unresolved identity, and an unobserved transition needs a per-run acknowledgement; validate-only, then dry-run, then an owner-approved first apply | owner (B2, first apply) | V2-GAP-008 |
| RISK-02 | **The AFL Tables nightly settle remains a production writer until its timer is disabled.** A V2 checkout now refuses it (Launch F), so V2 code with the timer still enabled would fail the unit every night | certain until the timer is disabled | High | `tools/v2/cutover-preflight.ts legacy-writers` refuses the release while the timer, a running unit or the polkit rule remains; cutover-runbook step 4a lists the reversible commands (never executed) | owner (A-AFLT or ISSUE-316 C5) | V2-GAP-011 |
| RISK-03 | **Real-data and Linux PostgreSQL paths are unexecuted.** Launch F ran on isolated PG16: migrations 001-114, privileges, the operations-centre pages, the AFL API settle and fixture suites, the manifest, capture and parity tools, and the 111-114 reversal. It did **not** run on a production dump, on Linux, or on `afldb_test`; two `afldb_test`-pinned suites remain | Low-Medium | High | the shadow rehearsal on a production dump (S-A1..S-A5) before any production step | operator (rehearsal), owner (approvals) | V2-GAP-001, 003, 007, 009 |
| RISK-04 | **The production build has run only against an isolated local database** (Launch F: exit 0, 1,516 static pages). A production-data build may still differ | Low | High (a failed build keeps the previous build serving) | the rehearsal builds against the shadow copy; the deploy builds before restarting | operator | V2-GAP-002 (closed) |
| RISK-05 | **Workstation hook hazard.** A user-level hook in `~/.claude/settings.json` runs `cmd.exe` in the SOURCE worktree before every Grep/Glob and after every Read call; cmd parses redirect-like tokens in the payload. It already created the 0-byte stray `D:\dev\afldb-afl-api-cutover\supplies`. A payload containing `> <existing file>` could truncate a real file, and the source holds 19 uncommitted ISSUE-316 files that exist only there, in the snapshot and in V2 | Medium (it has fired once) | High (silent loss of uncommitted work) | V2 agents never use Grep/Glob and read via Bash; the source is snapshotted at `D:\tmp\afldbV2-source-snapshot-20261019\` with sha256 values; every launch checks the source status | owner: fix or disable the hook, decide on the stray file (V2 must not delete it) | V2-GAP-004 |
| RISK-06 | **A legacy timer left enabled** (email intake, or AFL Tables): every intake message gets HTTP 410 and is filed to the Errors folder; every AFL Tables run fails loudly | certain if step 4/4a is skipped | Medium | the cutover preflight refuses the release until both timers are disabled and nothing legacy runs | operator under the release approval | V2-GAP-011, 013 |

## Medium

| # | Risk | Likelihood | Impact | Mitigation | Owner | Gap |
|---|---|---|---|---|---|---|
| RISK-07 | **The application rollback is untested.** The 111-114 database reversal is rehearsed on isolated PG16 (Launch F): the schema is identical to 001-110 after it, and re-forward is identical. Redeploying `PREV` (§4), the backup (§2) and a reversal over non-empty ledgers have not run | Medium | Medium | the rehearsal runs §2 and §4 on a host; production stays NO-GO until it has | operator | V2-GAP-026 |
| RISK-08 | **Verification ran on Windows only.** Linux is the supported runtime; 15 unit cases fail on this workstation for CRLF or POSIX reasons (baseline list), shell scripts and systemd units were never executed | Medium | Medium | the rehearsal runs the suite on Linux; the V2 gate is "no failure outside the baseline list" | operator | V2-GAP-003 |
| RISK-09 | **PGlite is not PostgreSQL.** Launch F re-ran the awards, privileges and fixture suites on real PostgreSQL 16 (isolated), and they pass. Only Linux-specific and production-data behaviour remain unproven | Low | Medium | the rehearsal on Linux | operator | V2-GAP-017 (closed) |
| RISK-10 | **Admin pages are machine-checked, not owner-approved.** Real pages were rendered from the production build and captured at desktop and mobile widths (Launch F). The agent inspected them and fixed one stale-copy defect; the owner has not given a verdict | Low | Medium | owner eyeball list `docs/v2/admin-operations.md` §6 with the committed images | owner | V2-GAP-022 |
| RISK-11 | **Award results are unproven on production data.** Coleman agrees on 46/46 locally rebuilt seasons (Launch F). The Brownlow eligibility rule is implemented (ADR 0014), but its projection path is open; the Brownlow reconciliation has no committed API-era inputs or team mapping; the Coleman offline loader is not retired | certain (open) | Medium | the rehearsal captures both reports from the shadow copy; every `disagree`/`not_derivable` row is reviewed before any publication | owner, operator | V2-GAP-015, 016, 021, 023 |
| RISK-12 | **ESLint has zero headroom.** The repository-wide count is exactly at the inherited ceiling (253 errors, 132 warnings, all pre-existing); any new finding anywhere fails the gate, and "lint passes" is true only in the "no new findings" sense | High (any edit can trip it) | Low-Medium | every created/edited file must lint clean; the pre-existing findings are not fixed opportunistically (R-011) | V2 follow-up (owner decides whether to fund a lint clean-up) | — |
| RISK-13 | **Parity thresholds are untried on real data.** The shadow parity tool (`v2.parity.1`) is zero-tolerance on sealed history and on reference tables; a legitimate re-stamp of provenance or a reference edit during the rehearsal makes it FAIL and needs an owner reconciliation | Medium | Low (a false FAIL is safe; it costs time) | thresholds are documented and versioned; a change needs a new policy version, never a silent relaxation | owner | — |
| RISK-14 | **Restoring a production dump outside production carries user data.** The shadow copy contains the auth tables (accounts, roles, audit) as well as football data | certain if production is the source | Medium (data handling) | restore only on a host and into a database the owner approves; drop the copy after the rehearsal; never copy it to the workstation | owner | — |
| RISK-15 | **Merging V2 carries the ISSUE-316 follow-up-8 working tree.** V2 committed the 19 then-uncommitted source files (`c9cca86d`); the source worktree still holds them uncommitted. Merging both independently could conflict or double-apply | Medium | Medium | the cutover runbook makes reconciliation a precondition (P3); the frozen files are byte-identical to the snapshot (18 of 19; `CHANGELOG.md` differs by the V2 section) | owner | — |
| RISK-16 | **Curated approvals leave public award pages stale**: mitigated in Launch F. The approval returns the revalidation paths and posts them, but per-worker ISR caches still apply (ISSUE-134) | Low | Low | as for `/admin/awards` | — | V2-GAP-024 (closed) |
| RISK-17 | **The seal is enforced in code, not in the database.** Existing admin editors and the legacy writers do not consult it | Medium | Medium | V2 writers and the AFL API settle CLIs consult it; database-level enforcement is an owner decision | owner | V2-GAP-006 |
| RISK-18 | **The AFL API settle imported helpers from `settle-afltables.ts`**: resolved in Launch F (`settle-shared.ts`) | resolved | — | the boundary ratchet prevents its return | — | V2-GAP-012 (closed) |
| RISK-19 | **Self-approval of curated awards**: the four-eyes rule is enforced in Launch F; a creator may approve only with a recorded written attestation | Low | Low | the attestation and the decision are in the append-only ledger | owner (review attestations) | V2-GAP-019 (closed) |

## Low

| # | Risk | Likelihood | Impact | Mitigation | Owner | Gap |
|---|---|---|---|---|---|---|
| RISK-20 | **An agent ran an unauthorised network command.** In Launch C the closure agent ran `npm view @electric-sql/pglite@0.2.17 time`, which its brief did not authorise (procedural; output discarded; no repository change) | Low | Low | every later brief states "no network command of any kind" explicitly | owner (awareness) | — |
| RISK-21 | **The contributor role may have no remaining purpose.** Launch F removed the retired "Upload a file" link; contributors now see only Change password | certain | Low | none needed | owner (retire the role or give it a purpose) | — |
| RISK-22 | Python and R legacy tools are not physically quarantined | certain | Low | guard e proves no runtime import | V2 follow-up | V2-GAP-014 |
| RISK-23 | AFLW is outside the historical manifest | certain | Low | AFLW has its own loader and rules | owner | V2-GAP-005 |
| RISK-24 | The proposal-file size cap equals the framework's default server-action body limit, so a file near the cap gets a generic framework error (closure C5-001) | Low | Low | none needed for correctness | V2 follow-up | — |
| RISK-25 | Winners without a resolved identity cannot be approved; no view of AFL API settle refusals (approved-proposal revisions were delivered in Launch F) | certain | Low | documented workarounds (existing editors, identity tools) | V2 follow-up | V2-GAP-020, 025 |
| RISK-26 | Four integration files fail on the isolated rebuild (admin-draft, awards-reload-links, admin-season-lists, a match-admin-delete teardown). None was changed by V2; their cause is unconfirmed on Linux | certain on isolated PG16 | Low | none weakened; reproduce on Linux `afldb_test` first | V2 follow-up | V2-GAP-028 |
| RISK-27 | **Release ordering against ISSUE-316.** The V2 release now needs the AFL Tables timer disabled (approval A-AFLT), whereas ISSUE-316 placed that at C5. Approving the release before ISSUE-316 C2 would end AFL Tables acquisition for the rest of 2026 | Medium | Medium | the owner chooses: release after ISSUE-316 C5, or approve A-AFLT with the 2026 final acquisition done first (D-316-1) | owner | V2-GAP-011 |
