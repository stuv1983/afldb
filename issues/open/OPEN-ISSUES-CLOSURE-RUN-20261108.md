# Open-issues closure run — 2026-11-08 (resume checkpoint and owner decision packet)

**Purpose:** the durable resume point for the owner-requested run, "work every open issue to its documented closure criteria" (2026-11-08). A fresh session reads this file first, then the runbooks it names. It is a navigation record: `issues.md` and each runbook stay authoritative.

**Authorisation (owner, 2026-11-08):**
- **Authorised:** commands, transfers, synthetic fixtures and database writes needed for verification, in fresh disposable workspaces and isolated test databases on `streamanator`. The effective target is verified before every state-changing database operation.
- **Outside:** shared databases, live DEV or production operations, private backups, WSL stores, and direct Git operations.
- The working tree stays uncommitted.
- **Run 2 (owner, 2026-11-08):** additionally authorised Git fetch and inspection, local worktrees and branches, scoped staging and local commits, the W-339 bundle, transfer to streamanator, and Git, tests and migrations inside disposable clones on isolated test databases. Push, merge, live DEV, production, shared databases, private backups and WSL stores stay behind owner gates.

## Run 8 — 2026-11-11: catch-up engineering and release preparation (COMPLETE; nothing published, nothing deployed)

**Resume here.** Open issues: 332, 336, 346 and 347. Every remaining item is owner-gated (decision packet OD-1 to OD-8 below), apart from ISSUE-332's dated gates.

**Local publication branch:** `claude/records-catchup-20261111` (worktree `D:\dev\afldb-catchup-20261111`). On `12aa6e29`, in order:
1. `2207986f` ISSUE-347 fix;
2. `ba9710e3` records;
3. `feca4f11` ISSUE-346 code (cherry-pick of `87653d5e`);
4. `b0243ef4` ISSUE-346 runbook and evidence (of `817ca8e9`);
5. `bf494c8c` ISSUE-346 runbook note (of `0c47ca04`);
6. the final run 8 records commit (`3218abf9`);
7. the second-session records commit (D-336-3 classification, ISSUE-346 §4a, D-336-2 tarball pin): the branch tip.

Tooling and records only: no `src/`, migration, dependency or build-input change.

**Publication plan (OD-6, after D1 PASS):**
- First the post-release records commit: the release execution record, the PKG SHA, and the run 7 post-publication evidence from `D:\dev\afldb-i336-packet-r2`.
- Then rebase this branch onto it. The run 8 files do not overlap the release records, so expect only tracking-file conflicts (`issues.md`, `IssuesIndex.md`, `CHANGELOG.md`, this file); resolve them by keeping both.
- Re-verify that the code, test, doc and runbook blobs are byte-identical to the qualified commits (`2207986f`, `87653d5e`, `817ca8e9`, `0c47ca04`). Otherwise re-run `gap029-ops` and `sync-dev-remote` at the rebased tip.
- Run `merge:ready --issue 347` and `--issue 346`, and `preflight --mode merge`, in a streamanator clone.
- Fast-forward `main`. Then resolve 347; resolve 346 once the owner accepts its residuals.

**ISSUE-346 (done locally, 2026-11-11).** The orchestrator agent implemented route (a), which `afldb-closure` reviewed with no drift. Results and residuals are in the `issues.md` entry and runbook §4. The workspaces `/mnt/ssd/afldb-i346-w346-20261111` and `/mnt/ssd/afldb-i346-dev` are retained; their cluster is stopped. The harness flagged one of the agent's actions as an "unrequested commit in a connected app". It was checked and found to be the three local commits its brief authorised: `origin/main` was still `12aa6e29`, no remote branch was created, and no other worktree changed.

**Second session (2026-11-11, same branch and worktree; read-only apart from local records):**
- **D-336-3 classified.** The owner CSV location was `C:\Users\stuar\OneDrive\Desktop\New folder`; 35/35 hashes equal the 5 Nov inventory. A read-only copy is retained at streamanator `/mnt/ssd/afldb/records/d3363-owner-draftguru-csv-20261111/` (the originals were re-hashed afterwards: unchanged). The inventory and the 187-row reconciliation reproduce byte-for-byte. Results and the refined recommendation are in the D-336-3 block below. Evidence: `docs/v2/evidence/issue336-draft-categories-20261105/d3363-classification-20261111/`.
- **ISSUE-346 residuals reconciled.** The `issues.md` summary (7 items) now matches runbook §4's six. §4a gives each one's consequence, protection, operator action and disposition, and one acceptance statement (R1–R5). It does not depend on OD-1.
- **D-336-2 A+B made exact.** The simulation-qualified tarball `3160b9d3…5b8a` (`-simpack-`) was re-verified at R and is recorded in the packet §4 and §5 as the recommended TARSHA. Keep `/mnt/ssd/afldb-i336-simpack-20261111` until D-336-2 is accepted.
- **OD-1 pins re-verified.** `git fetch`: `origin/main` = PKG `12aa6e29d51099eb6d3fbc901bbe488c5dbd7ab3`, unchanged. No qualification was repeated: no code, input or evidence of a passed check changed.

**Owner decisions (2026-11-11, after the second session):**
- **OD-5 D-336-3 = (A).** The stored origins are kept. The classification is preserved and the 3 club replacements are presented separately, both carried to the next DraftGuru acquisition as new **ISSUE-348**.
- **ISSUE-346 R1–R5 accepted** with the exact §4a statement at `50da084c`. The operator restrictions are binding (runbook §2). Resolve after publication.
- **OD-6 approved exactly as recorded**, including the D1 PASS prerequisite. **Consequence to note:** the ISSUE-346 runbook blob already differs from the qualified `0c47ca04` (§4a, and now §2). OD-6's own "otherwise re-run" branch therefore applies: re-run `gap029-ops` and `sync-dev-remote` at the rebased tip. Every code, test, `docs/deployment.md` and evidence blob is byte-identical (verified 2026-11-11).
- **OD-2 and OD-3 (D-336-2 A+B, C+D) approved**, to run after the application release passes acceptance. They stop at the read-only plan, then present the digest, backup hash and a proposed window for OD-4.
- **OD-1 is NOT yet approved.** The r2 §9 statement still needs the owner's window. OD-2, OD-3 and OD-6 all wait on it.
- **Branch layout:** `claude/records-catchup-20261111` stays at the approved tip `50da084c`. These decision records sit on the local branch `claude/records-decisions-20261111`, one commit stacked on it. OD-6 names `12aa6e29..50da084c`, so including the stacked records commit in the same fast-forward needs the owner's word. Otherwise it travels with the post-publication resolution records.

**Remaining gaps (not owner decisions):**
- ~~The 141 unclassified D-336-3 origin diffs need the owner CSV location.~~ Done (second session).
- The ISSUE-344 follow-up release packet waits for OD-1.
- Production state in r2 (`OLD_ID`, `PROD_HEAD`) was last recorded 2026-11-05. It is re-observed only at P-A, under the owner's approval.

**Owner instructions (2026-11-11):**
- Catch up all outstanding work under standing authority: repository tools, Git inspection and fetch, shell, transfers, SSH, read-only SQL, Playwright, isolated clusters, local worktrees and commits.
- Production writes, deployments, live service changes and publication of new commit ranges keep their established approvals.

**Local branch:** `claude/records-catchup-20261111` in worktree `D:\dev\afldb-catchup-20261111`, from `origin/main` = PKG `12aa6e29`. **Main stays frozen until D1 PASS**, so nothing here is pushed.

**Reconciliation (verified 2026-11-11):**
- `git fetch`: `origin/main` = `12aa6e29d51099eb6d3fbc901bbe488c5dbd7ab3` (PKG r2), unchanged since run 7.
- Every closure-run fix is published: 337, 340, 345, 336 pin `c1c4b22e`, 339 `8d122f62`, 338 and 341–344 `532dcd77..ae28bd70`.
- `D:\dev\afldb` (branch `claude/issue-339-deploy-preflight`, HEAD `549c5892`) holds no unique work:
  - all 22 modified or untracked code and test files are byte-identical to `origin/main`;
  - its records are older states of the published records (only "scoped to the local working tree" wording differs);
  - `48ff91c7` is patch-identical to the published `02593f23`;
  - `5cba6846` and `549c5892` are superseded by `37bc6a6c` and `8d122f62`, and must never be published;
  - `.codex/` is another tool's untracked configuration, left as is.
- Every `claude/*` worktree branch is an ancestor of `origin/main`.
- The only unpublished material is the run 7 post-publication evidence, untracked in `D:\dev\afldb-i336-packet-r2` (`…-r2-20261109/post-publication-evidence-UNCOMMITTED/`). It belongs to the post-release records commit.
- **r2 static check re-run 2026-11-11** at PKG `12aa6e29`: `STATIC DELTA CHECK PASS r2` (exit 0).

**Work streams:**
- ISSUE-346: gated migration-only route (separate branch `claude/issue-346-gated-migrate`);
- the I336 end-to-end SIMULATION at R′ (below);
- D-336-3 recommendation;
- backlog and tracking reconciliation.

**I336 end-to-end SIMULATION at R′ (DONE 2026-11-11).**
- **Setup:**
  - workspace `/mnt/ssd/afldb-i336-sim-20261111`;
  - simulated production cluster on 55494 (system identifier `7706726153494630905`), holding `afldb_simprod` from the approved snapshot `e77c307d…826d`;
  - driver `/mnt/ssd/afldb-i336-simtools-20261111/i336-sim.sh`, plus local ssh/scp stand-ins that accept only the alias `dev`.
- **Results:**
  - capture `CAPTURE_COMPLETE`;
  - **first sealed `assemble --stage I336`** `ASSEMBLY_COMPLETE`;
  - plan `10c71c64…` (35/31/0);
  - refusals N1 to N6 (exits 3, 6, 20, 2, 2, 2), with N7 still BASELINE;
  - approve, then apply `COMMITTED_VERIFIED`;
  - verify 35/35, accepted;
  - P1 to P3 after acceptance: exit 21, no new backup;
  - facts: picks 6,818 → 6,853, persons +31, audit 35 rows by actor 1.
- Packet: `docs/v2/issue336-d3362-approval-packet-2026-11-11.md`.
- **Found: ISSUE-347.** The runner's `prepare` failed at step 4 (`STOP TAG must match`), after the capture. The fix is commit `2207986f` on this branch.
  - At `2207986f` in a fresh clone (`/mnt/ssd/afldb-i347-qual-20261111`): `gap029-ops` 84/84 and `tsc` exit 0.
  - Runner-path episodes with the fixed runner and the ops checkout pinned at R:
    - **e2** passed step 4, which failed in e1. It was then refused at plan by the exclusivity gate, because the ISSUE-346 rehearsal was running concurrently on the host.
    - **e3** was refused because port 55493 was still held (e2's `pg_ctl stop` timed out under IO load).
    - **e4** ran the full runner lifecycle: `PREPARATION COMPLETE`, approve, `COMMITTED_VERIFIED`, `ACCEPTED`, with facts identical to e1.
  - Both clusters are stopped. Evidence: `docs/v2/evidence/issue336-i336-simulation-20261111/`.

**D-336-3 (187 revised origin paths): evidence-based recommendation (the owner decides the data authority).**
- **Evidence** (`docs/v2/evidence/issue336-draft-categories-20261105/reconcile-before.txt`, owner CSVs against the 2026-11-04 production dump):
  - Of the 5,931 matched DraftGuru rows, 187 (3.2%) differ **only** in `original_club_raw`. Category, pick, pick note, club and signing agree exactly.
  - 46 of the 187: the CSV value *extends* the stored one (stored is a suffix, so DraftGuru prepended earlier junior clubs, e.g. `Glenorchy/North Hobart` against `North Hobart`).
  - 0: stored NULL with the CSV set.
  - 141: other revisions, not classified at the time. **Classified in the second session:** 135 add one school (130 between the junior club and the representative club, 5 appended), 3 expand `Brighton` to `Brighton Districts & Old Scholars`, and 3 replace a junior club (5961/6784 Finlay Macrae, 6626 Blake Leidler). Of the original 46, 39 prepend a school and 7 prepend junior clubs. In total, 184 of 187 keep every stored segment or canonicalise a name. The cause is a DraftGuru back-fill: National picks with a school, stored → CSV, 2022 2 → 41 of 59 and 2025 0 → 45 of 58.
- **Impact:** public only. The `/draft/[year]` and player draft-history "original club" text, and the `origin` filter (`ILIKE`), which does not find the prepended clubs. There is no identity, link, count, pick or category effect, and no NULL-versus-value semantic change.
- **Options:**
  - **(A) Keep the stored values** (the acquisition snapshot stays authoritative): no write; the staleness stays.
  - **(B) Full DraftGuru re-acquisition and keyed reload** (the runbook's recommendation): every field comes from current DraftGuru.
    - Needs a new acquisition and Stage A head proof review, and updated contracts: `draftguru-contract.json` `total_rows`, `DRAFTGURU_EXPECTED.picks/persons` in `tools/db/rebuild-test.ts`, `EXPECT_STAGE_A_EVENTS` in `build_person_bridge_v2.py`, and the linkage-check SQL (all 6,810 today). Then a GAP-029-style production stage.
    - It can import other unreviewed DraftGuru drift, so its blast radius is all 6,810+ rows.
  - **(C) A bounded 187-row audited correction** (a new GAP-029 stage modelled on I336, `recordDataEdit` under the season seal, actor 1) with the owner CSV export as the authority. This is the smallest write, but it needs a new tool, review and rehearsal.
- **Recommendation: (A) now, then (B) folded into the next planned full DraftGuru acquisition**, not a separate data operation.
  - The impact is presentational and low, and 46 of the 187 are additive history.
  - (C) builds a new production writer for text-only drift.
  - The next acquisition must update the 6,810 contracts anyway, because after D-336-2 production holds 6,845 DraftGuru picks against the frozen snapshot's 6,810. **D-336-2 consequence the owner should accept explicitly:** the `afldb_test` rebuild contract (6,810 picks, 5,057 persons) will differ from production by the 35 audited rows until that acquisition.
  - **If the owner prefers the CSV export as the authority now**, choose (C). It needs the CSV location and a new tool cycle.
- **Refined after classification (second session):** still **(A) now, then (B)**, with the classifier as (B)'s origin-review gate (insertions and renames accepted, the 3 replacements checked explicitly by the owner). If an earlier correction is wanted, choose **(C′)**: 184 additive rows with the CSV as authority, excluding the 3 replacements, run after D-336-2. (C′) never removes a stored segment, but it still needs a new tool cycle. (C) for all 187 is no longer recommended, because it would settle the 3 conflicts on the CSV's word alone. A single row can be ruled on through the existing admin draft editor; this writes an audited override that pins the value against later reloads. Details: the evidence README §4.

**Consolidated owner decision packet (run 8).** Each item is a separate approval. Exact texts are in the referenced documents.

| # | Decision | Exact revision / object | Effect | Recovery | Approval text |
|---|---|---|---|---|---|
| OD-1 | **Not yet approved (window needed).** **Production application release** (336/337 with 340/345, RD-1) | R = H = `c1c4b22ee15007111eab66f6d354e0b9ecbb2ade`; PKG `12aa6e29d51099eb6d3fbc901bbe488c5dbd7ab3` | New draft pages and Intl Schol; serialised credentials (340); restricted Grid Solver forced-change gate (345). No migration or DB write. ISSUE-344 is not shipped | Roll back to `0f251c2daa8d-3t0xWKI76Jgna2tB8a9oN` only (r2 §8). The checkout stays at R | r2 §9 with `<PKG, 40 hex>` = `12aa6e29d51099eb6d3fbc901bbe488c5dbd7ab3`, plus a window |
| OD-2 | **APPROVED 2026-11-11 (after release acceptance).** **D-336-2 A+B**: pin the ops checkout and capture | R `c1c4b22e`; tarball sha256 `3160b9d339d0d23747bb53ab9a597ccf54737c31218fe867762885a407a55b8a` (the simulation-qualified pack, packet §4), or a fresh `pack`'s | One read-only `pg_dump` and `$OPS` files on production | None needed (no data change) | D-336-2 packet §5 |
| OD-3 | **APPROVED 2026-11-11 (after release acceptance).** **D-336-2 C+D**: restore, assemble and plan | That capture | Streamanator only, plus a read-only plan | — | packet §5 |
| OD-4 | **D-336-2 E+F**: apply once | Plan digest printed at step D | +35 picks, +31 persons, 35 audit rows (actor 1). Accept the afldb_test contract divergence | Never retried or reversed; restoring the stage backup is a separate decision | packet §5 |
| OD-5 | **DECIDED (A) 2026-11-11; carried as ISSUE-348.** **D-336-3** | Classification `d3363-classification-20261111/` | (A) none / (B) a later acquisition, gated by the classifier / (C′) a new 184-row additive stage / (C) a new 187-row stage | — | "I choose D-336-3 option (A then B / C′ / C)…"; the CSVs are retained, so no location is needed |
| OD-6 | **APPROVED 2026-11-11 as recorded (after D1 PASS).** **Publish the run 8 range after D1 PASS** | `12aa6e29..` the tip of the publication branch (below), rebased onto the post-release records commit | 347 fix, 346 route, records. Tooling only, no app or build input | Revert commits; no deployed effect | "I approve publishing … by fast-forward after D1 PASS" |
| OD-7 | ISSUE-344 follow-up release | A later revision ≥ `ae28bd70` | Fixes the zero-match out-of-range draft page on production | Standard release route | A new release packet (not prepared: it needs OD-1 first) |
| OD-8 | Ratify 341 (DSN contract) and 342 (exit-1 exception) | — | None (records only) | — | "ratify" or a new decision |

## Run 7 — 2026-11-09: ISSUE-336/337/340/345 release package re-derived as r2 (owner-approved)

**Owner instructions (2026-11-09):**
- Re-derive the production approval packet from current `origin/main`. Authorised: Git inspection, disposable verification, and publication of the replacement packet as a records-only change.
- Keep the qualified production revision and the I336 data pin at `c1c4b22e`. Keep the strict D0 and D1 head checks.
- Preserve the previous packet as superseded. Re-derive the static delta and rerun its checks against the exact production candidate.
- After publishing, record the final package SHA and rehearse D0 and D1 offline with it: they must pass at the expected head and stop if the head moves.
- The production release and each D-336-2 step remain separate owner approvals. Coordinate any further `main` updates before the release.

**What was re-derived** (from `origin/main` `98a4b1987313bea84e31bed4d64ed6458bb2f509`, worktree `D:\dev\afldb-i336-packet-r2`, branch `claude/records-i336-packet-r2-20261109`):
- **New:** `docs/v2/issue336-337-340-345-release-approval-r2-2026-11-09.md`. It was generated from r1 by enumerated replacements only: the status block, the H, PKG and `ORIGIN_HEAD` rows, the new §2a, the §3 evidence pointers, `PKGD` in §5, D2's evidence string and the §9 path, plus an explicit ISSUE-344 exclusion.
- **New:** the package directory `docs/v2/evidence/issue336-337-340-345-release-r2-20261109/`:
  - `static-delta-check.sh` (r2);
  - `prod-checkout-to-r-nondoc-files.txt` (37 lines, byte-identical to r1);
  - `r-to-pkg-nondoc-files.txt` (17 lines).
- **Superseded:** r1 (`…-approval-2026-11-09.md`) gets a banner only; its body and its package directory are unchanged.
- **Why the static check changed:** r1 required R and PKG to have identical application trees. After `ae28bd70` that is false; r1's own check against `98a4b198` prints `STATIC DELTA CHECK FAIL: application tree src differs between R and PKG`. r2 keeps every r1 check of what R ships and replaces that one invariant with an exact enumeration of `main` after R:
  - build inputs identical;
  - `src/` differs only in the four ISSUE-344 files;
  - `deploy/` differs only in the three DEV-only sync-dev files;
  - all non-documentation files match `r-to-pkg-nondoc-files.txt`.
- **Not rerun:** R's Linux qualification. R is unchanged (tree `10413828…`).

**Publication and verification results:** the package cannot record its own SHA or its own rehearsal results, and any later commit would break its strict head checks. So the PKG SHA and the W0/D0/D1 rehearsal results are in the owner report and the session memory. They are written into the repository only in the post-release records update.

**Main is frozen** from PKG until D1 PASS (or until the owner decides otherwise). Any push re-derives the package again.

## Run 6 — 2026-11-09: B2–B5 fixes published (338, 341–344) (owner-approved)

**Owner instructions (2026-11-09):**
- Publish the already verified fixes for ISSUE-338 and ISSUE-341 to ISSUE-344. Authorised: a fresh worktree, scoped local commits, disposable verification on streamanator, and push and merge through the documented readiness checks.
- Start from current `origin/main`. Use B2–B5 to identify the intended changes and verify them against the actual diffs. Bring over only the unpublished fixes and tests; the closure records are already on main. Preserve the original working tree and keep the superseded gate branch local.
- Carry the recorded test evidence forward where the relevant code and test inputs match, and rerun focused checks only for meaningful differences. Review the complete candidate diff before publishing.
- Keep the production release pinned at R′ `c1c4b22e` and its approval packet at PKG `c5959bbf`. The release and each D-336-2 step remain separate owner approvals.

**Candidate:**
- `git fetch`: `origin/main` was `c5959bbf`. Worktree `D:\dev\afldb-b2b5-publish`, new branch `claude/issue-338-341-344-publish` from it.
- **Identification.** The working tree of `D:\dev\afldb` differs from `origin/main` in exactly the 12 B2–B5 code and test files. None of them changed between `549c5892` and `c5959bbf`. Every other code change in that tree (340, 345, 336, 339) is byte-identical to main, and the B2–B5 records (closed runbooks, index sections, `ev341/`, `ev342/`, `ev343/`, `i338-*.log`, the ISSUE-344 evidence) were already on main, byte-identical.
- **Commits:**
  - B2 `532dcd77b66d55cac273b1afad4589d093bb217f`: ISSUE-341/342, `tools/maintenance/restore-test.sh` and the new `tests/restore-test.test.sh`.
  - B3 `3ec73bcfcd03674de03d88084f2b559b619bda0f`: ISSUE-343, both fixture CLIs and `tests/afl-api-ingestion-safety.test.ts`.
  - B4 `d3d380253065d4f985a7057c2fe3484c605d3b80`: ISSUE-338, `tests/python/draftguru_bridge_operator_review_contract.py`.
  - B5 `ae28bd70423e5c9f7e2c53c46353faa396678cc7`: ISSUE-344, `src/db/queries/draft.ts`, `src/db/queries/admin-draft.ts`, both draft pages, `tests/integration/admin-draft.test.ts`, `tests/catalogue-lookups.test.ts`.
  - Every committed blob equals the original working-tree file (`git hash-object`; the CRLF working copy of `admin-draft.test.ts` normalises to the same blob).
- **Diff review** (12 files, +946/−100) found no defects. The new APIs the code relies on (`proveAflApiIngestionPreflight`, `redirectPastEnd`, `listParams`, the test fixtures) all exist on main. One cosmetic note only: the header comment of `tests/restore-test.test.sh` still names `issues/open/AFLDB-ISSUE-341.md` and `-342.md`, now in `issues/closed/`. It was left unchanged so the tested bytes are published.

**Evidence carried forward (no reruns needed):**
- Fresh streamanator workspace `/mnt/ssd/afldb-b2b5-cand-20261109T0717Z`: a clone of GitHub `origin/main` (verified `c5959bbf`) plus an incremental bundle (sha256 `8eafc93d…0a94519`), HEAD verified `ae28bd70`.
- Per-file comparison of every tracked candidate file against the two workspaces that produced the recorded evidence: W1 `/mnt/ssd/afldb-close-20261108T061620Z` (338, 341, 342, 343) and WV `/mnt/ssd/afldb-verify-20261108T002136Z` (344).
  - In `src/`, `tests/`, `tools/`, `data/`, `deploy/`, `package*.json` and the root configs: **no content difference and no missing file**.
  - 17 files differ only by CRLF line endings in the Windows-sourced tarballs (among them `tests/integration/admin-draft.test.ts`). The extra files are Python `__pycache__` bytecode only.
  - Every content difference is a record file. The lockfile (`984b4422…`) and Node v22.23.2 are the same.
- So the recorded results stand for the published code: 338 Python contract 229/0 and focused Vitest; 341 stub 24/24 and real qualification 37/0; 342 fault injection 20/0; 343 unit suite and real A/B; 344 `catalogue-lookups` 24/24, `admin-draft` 47/0/5 and build PASS.

**Readiness (17/0)** in an operator-layout clone (primary `main` = `origin/main` = `c5959bbf`, linked worktree on the issue branch):
- `npm ci` clean.
- `merge:ready --issue N` **READY** for 338, 341, 342, 343 and 344: all 12 committed files in the declared scope, 0 blockers, 1 warning each (the runbooks are already closed).
- `preflight --mode merge` **READY** (1 warning: no `.env`).
- The ff-only rehearsal gave the tested SHA and tree.

**Published:**
- The new remote branch `claude/issue-338-341-344-publish`.
- Then, after a re-fetch confirmed the base, `ae28bd70:refs/heads/main` without force: **`origin/main` `c5959bbf..ae28bd70`**. The published merged revision `ae28bd70423e5c9f7e2c53c46353faa396678cc7` is the tested commit.
- Nothing was deployed to DEV or production.

**Release package impact (owner decision before the release):**
- `origin/main` no longer equals PKG `c5959bbf`. As written, the approval document stops at D0: §1 records `ORIGIN_HEAD` = PKG, D0 and D1 assert `origin/main` = PKG, and §9's wording names it. §1 says a mismatch means the package is re-derived, never edited in place.
- Unaffected: R′ `c1c4b22e`, H = R (the checkout goes to R, not to `origin/main`), the static delta check (read from PKG's own bytes) and the Linux qualification. None of B2–B5 is in R, so the release as qualified ships without them. B5 does modify two of the 16 release files (`src/db/queries/draft.ts`, `src/app/draft/[year]/page.tsx`): production keeps the ISSUE-344 defect after the release, and carrying 344 would need a new R and a new qualification (not proposed; R stays pinned).
- The package was **not** edited, as instructed. This records commit moves `origin/main` again.
- Owner options: (a) re-derive the package at the then-current `origin/main` (new PKG, same R); or (b) an owner-authorised deviation that replaces `origin/main` = PKG with "PKG is an ancestor of `origin/main`" in D0/D1 and §9. The publication check should not have been missed before the push; it was found during this records update.

**Remaining approvals:**
1. The production release (approval document §9), now including the D0/D1 decision above.
2. D-336-2 steps P1–P3, approve and apply, each separately.
3. D-336-3.
4. ISSUE-332 gates G1–G7; ISSUE-346's interim rule: no hand-run `db:migrate` on DEV.
5. Non-blocking ratifications: the 341 DSN contract and the 342 exit-1 exception.

**Local state:**
- `D:\dev\afldb` (Branch B, HEAD `549c5892`) was left untouched. Its uncommitted B2–B5 files are now duplicated on main. Never publish `5cba6846` or `549c5892`.
- Worktree `D:\dev\afldb-b2b5-publish` is kept.
- The streamanator workspace is retained; it holds no database and runs no service.
- Evidence: `docs/v2/evidence/open-issues-closure-20261108/b2b5-publish/` (leak scan clean). This records commit's own SHA is reported in the session report, since a commit cannot record its own hash.

## Run 5 — 2026-11-09: R′ release qualification; closure records published (owner-approved)

**Owner instructions (2026-11-09):**
- Select `c1c4b22ee15007111eab66f6d354e0b9ecbb2ade` as the ISSUE-336/337/340/345 release candidate, and authorise its Linux qualification on streamanator using an already approved, verified production snapshot at 118 in an isolated cluster. Prepare the static delta check and the full approval document, then stop the isolated services.
- Separately, authorise a **records-only** branch from current `origin/main`, reconciling `48ff91c7` with the closure records, runbook moves and evidence. Review the diff, then commit and publish through the documented checks. Preserve the original working tree and keep the superseded gate branch local.
- The production release, the D-336-2 steps and D-336-3 remain separate decisions.

**Qualification (PASS):**
- **Setup:**
  - workspace `/mnt/ssd/afldb-i336rel-qual-20261108T201140Z`;
  - candidate tar sha256 `beaf92d3…afce4`;
  - snapshot `afldb_prod-20261104T021037Z.dump` (`e77c307d…826d`; the ISSUE-333 O2 capture, restore-verified 2026-11-04 and used for the I336 rehearsal; re-hashed on the host);
  - cluster on 127.0.0.1:55498, at ledger 118.
- **Results:** typecheck clean; unit 257/257; `admin-lifecycle` 50/50; `admin-draft` 42/0/5; build exit 0; boot smoke 7/7; D4 literals present.
- **Extra suites:** 335/2/2. The 2 are environmental: the gitignored frozen DraftGuru sample.
- **Afterwards:** the cluster was **stopped** (no listener, no postmaster); the data directory and workspace are retained, since deletion was not authorised. DEV MainPIDs were unchanged.
- **Records:** approval document §3; evidence `docs/v2/evidence/issue336-337-340-345-release-20261109/`.

**Records branch** `claude/records-closure-20261109` (worktree `D:\dev\afldb-records-20261109`, from `origin/main` `8d122f62`):
- **Contents:**
  - `48ff91c7` was cherry-picked as `02593f23`, with the `CHANGELOG.md` conflict resolved to Branch B's committed text.
  - Every record file then equalled `549c5892`'s, so the working tree's uncommitted records were overlaid unchanged: tracking files, runbook moves to `issues/closed/` (339, 340, 345 and the others), evidence and the packet.
  - Plus a publication-state note, the qualification records and the approval package.
- **Excluded:** every code path. The unpublished 338 and 341–344 fixes (commit plan B2–B5) stay only in `D:\dev\afldb`. Their records say "resolved, scoped to the local working tree", and the index, ledger and changelog say their fixes are not on `origin/main`.
- **Review:** 0 non-record paths. The secret scan was clean: DSNs are placeholders only; `auth.json` holds cookie names only; the only email is `example.test`; the DEV host IP was already published.
- **Branch B** `claude/issue-339-deploy-preflight` and `D:\dev\afldb` were left untouched and local.
- **Publication:** before the push, run `merge:ready --issue 336` and `preflight --mode merge` in a streamanator operator-layout clone, plus a fast-forward rehearsal and a static-check W0 rehearsal against the candidate commit. The published SHA is reported in the session report and carried into the next records update, because a commit cannot record its own hash.

**Remaining approvals:**
1. The production release (approval document §9; it names the package commit).
2. D-336-2 steps P1–P3, approve and apply.
3. D-336-3.
4. Publication of the B2–B5 code (338, 341–344) as its own reviewed change.
5. Carried forward: ISSUE-332 gates G1–G7, and ISSUE-346's interim rule **no hand-run `db:migrate` on DEV**.

## Run 4 — 2026-11-09: ISSUE-339 published and resolved; ISSUE-336 nightly observed (owner-approved)

**Owner instructions (2026-11-09):**
- accept the recommended D1–D4: D1 custom `-DsnName` stays `-SkipMigrate`-only; D2 standalone DEV migration approval is tracked separately; D3 `preflight --mode deploy` is unchanged; D4 publish after the checks;
- record R339-D live argv exposure as unmeasured unless there is direct evidence;
- authorise the read-only §7.2 nightly read;
- keep the production release, the 35-row insert and D-336-3 behind separate approvals.

**ISSUE-339 publication:**
- **Candidate:**
  - `git fetch`: `origin/main` was still `c1c4b22e`.
  - A clean worktree `D:\dev\afldb-i339-publish` was made on new branch `claude/issue-339-gate-publish` from `origin/main`. `5cba6846` was cherry-picked as `37bc6a6c` and `549c5892` as **`8d122f62`**.
  - The unpublished `48ff91c7` (ISSUE-336/337 DEV-deploy docs) was excluded. The one conflict (`CHANGELOG.md`) was resolved by keeping only the ISSUE-339 entry.
  - All 7 code, test, doc and runbook blobs are byte-identical to B1. The tracking hunks were reviewed and are ISSUE-339 only.
  - The full 10-file diff against `origin/main` was reviewed, with no new findings.
  - `D:\dev\afldb` (Branch B) was left untouched; only its records were edited, see below.
- **Checks at `8d122f62`:**
  - Windows `tests/sync-dev-static.test.ps1`: **PASS**, both payloads exported.
  - Linux `tests/sync-dev-remote.test.sh`: **63 passed, 0 failed**, no skips. It ran in a fresh clone of the candidate bundle (sha256 `cdd94c35…4a23`, HEAD verified) in `/mnt/ssd/afldb-339-cand-20261109T1940Z`.
  - In the same workspace's operator-layout clone, `merge:ready --issue 339` was **READY** (0 blockers, 2 warnings), `preflight --mode merge` was **READY** (1 warning: no `.env`), and the ff-only rehearsal gave the tested tree (9/0).
- **W-339 61/0 carried forward:** there is no B1 → candidate difference in `src/db/migrations/` (118, last `118_…`), `tools/db/`, `package*.json` or `deploy/`.
- **Pushed:**
  - the new remote branch `claude/issue-339-gate-publish`;
  - then `8d122f62:refs/heads/main` without force, after a re-fetch confirmed the base: **`origin/main` `c1c4b22e..8d122f62`**.
  - The **published merged revision `8d122f629df6a610ae4e95805e39583cc2ab8aaf`** is the tested commit.
- **Closed:**
  - ISSUE-339 was RESOLVED, with ledger Resolution, index section moved, runbook moved to `issues/closed/` (links fixed in seven closed runbooks, the ledger and the index), and CHANGELOG and blockers updated.
  - D2 was registered as **ISSUE-346** (Low).
  - R339-D live-host argv exposure is **unmeasured**.
- **Evidence:** `docs/v2/evidence/open-issues-closure-20261108/i339-publish/` (leak scan clean).

**ISSUE-336:**
- **§7.2 nightly OBSERVED AS PREDICTED:**
  - 2026-11-08: batch 147.
  - 2026-11-09: batch 148.
  - Both read `CD_S2027014` (218, COMPLETE), applied 0/0/0 refused at the write, and ended `AFLDB_SETTLE_SUCCESS label=afl-api-2027-…`.
  - The 20 listed apply failures predate the deploy, and there is no 2026 label since. The observation is closed.
  - Evidence: `i336-nightly/`.
- **Release packet drafted:** `docs/v2/issue336-337-340-345-release-packet-2026-11-09.md`. Recommended R = R′ `c1c4b22e`. It necessarily carries 340 and 345 and has no migration. The Linux release qualification and the full approval document are still to do.

**Not done (owner gates):**
- the production release;
- the D-336-2 steps;
- D-336-3;
- any commit of the records below.

**Uncommitted records in `D:\dev\afldb`:**
- the P-340/P-345 closure records (run 3);
- this run's ISSUE-339, 346 and 336 records;
- the release packet;
- the evidence folders.

They are not on `origin/main`. On `origin/main`, the runbooks for 339, 340 and 345 are still at `issues/open/`.

**Branch B (`claude/issue-339-deploy-preflight`) is now superseded.** Its 339 content is published as `37bc6a6c`/`8d122f62`, so `5cba6846` and `549c5892` must not be published again. `48ff91c7` stays unpublished and belongs with the records commit.

## Run 3 — 2026-11-08: Branch A published (owner-approved)

- **Pre-push state:** `git fetch` showed `origin/main` still at `7fabc6e5` and the Branch A tip at `c1c4b22e`, whose parent chain is A1 → base.
  - The full 12-file diff against `origin/main` was reviewed.
  - In a disposable streamanator clone (primary `main` = recorded `origin/main`, linked worktree on the branch), `merge:ready --issue 340` and `merge:ready --issue 345` were both **READY** (0 blockers; warnings: no runbook metadata block, unexpected-file classification unavailable), and `preflight --mode merge` was **READY** (warning: no `.env`).
  - An ff-only rehearsal produced the tested tree.
  - The repository has no CI or PR tooling (no `.github/`, no `gh`). The documented route is "operator pushes and merges".
- **Pushed:** `claude/issue-340-345-336` (new remote branch), then `c1c4b22e:refs/heads/main` without force: **`origin/main` `7fabc6e5..c1c4b22e`**.
  - **Merged revision = `c1c4b22ee15007111eab66f6d354e0b9ecbb2ade`**, identical to the tested commit, so no requalification was needed.
  - Published SHAs: 340 `8ef4ae1b`, 345 `65984ab2`, 336 `c1c4b22e`.
- **ISSUE-336 pin:** a fresh clone from GitHub, checked out at `c1c4b22e`, passed `gap029-ops` **76/76** (15 ISSUE-336 cases run, none skipped). The runbook §3 now pins R′ = `c1c4b22e`, and the §6 hold is cleared. ISSUE-336 stays open.
- **Closures applied:** P-340 and P-345 steps 1–5 are done in the working tree (uncommitted records):
  - ledger status with root cause, fix and validation;
  - Open Issues rows removed;
  - index sections moved to `issues/closed/AFLDB-ISSUE-340-345-INDEX-SECTION-20261108.md`;
  - runbooks moved to `issues/closed/` with links fixed;
  - CHANGELOG updated.

  On `origin/main` the two runbooks are still at `issues/open/`; the move reaches `main` with the records commit.
- **Evidence:** `docs/v2/evidence/open-issues-closure-20261108/branchA-merge/`, `i336-pin/`, `harness/run3-*.txt`. Workspaces `/mnt/ssd/afldb-mr-20261108` and `/mnt/ssd/afldb-pin336-20261108` are retained (no database was used).
- **Branch B note:** `origin/main` is now `c1c4b22e`, while Branch B sits on `7fabc6e5`. Before Branch B is published, it needs rebasing onto `c1c4b22e` (a separate decision). After that rebase, the A1–A3 changes in the working tree equal `main` and drop out as no-ops.

## Run 2 — 2026-11-08 (what actually ran)

- **Fetch and checks (main worktree `D:\dev\afldb`, branch `claude/issue-339-deploy-preflight`):**
  - Nothing was staged at the start, and all existing work was preserved.
  - `git fetch origin` → **`origin/main` = `7fabc6e51c5c53c4b6f6fe345f21191d9184660b`**.
  - Check 2: `merge-base --is-ancestor 5cba6846 origin/main` exited 1 (expected).
  - Check 3: `origin/main..HEAD` = `5cba6846` and `48ff91c7` (unpublished docs commit for ISSUE-336/337).
  - Check 4 **exited 1, for one path only:** `issues/open/AFLDB-ISSUE-336.md`, which `48ff91c7` also edits. Every code and test path exited 0. **Resolution:** A3 carries only `prod-stage.sh` and `tests/gap029-ops.test.ts`; the runbook update stays with the records commit on Branch B.
  - Check 5: the `tests/auth.test.ts` hunks are ISSUE-345 only.
  - Local `main` is `ea9bddf8`, not the base, so the bundles carry `refs/remotes/origin/main` rather than `main`.
- **Branch A** `claude/issue-340-345-336`, worktree `D:\dev\afldb-i340-345-336`, created with `git worktree add` from `7fabc6e5` (the workstation has no Node for `worktree:bootstrap`). It excludes `5cba6846` and `48ff91c7`.
  - **A1 `8ef4ae1bf54c40c7cb04f4982dcfe1dd83913aea`** — ISSUE-340 (7 files).
  - **A2 `65984ab22edf743580fb4caa7e8df97f73e55e3b`** — ISSUE-345 (3 files).
  - **A3 `c1c4b22ee15007111eab66f6d354e0b9ecbb2ade`** — ISSUE-336 (2 files).
  - All 12 committed blobs are byte-identical to the reviewed working-tree files.
- **Branch A verification at `c1c4b22e`** (fresh clone `/mnt/ssd/afldb-brA-20261108T102607Z`, from bundle sha256 `39621d54…f9d`, no `.env`, `npm ci` lock `984b4422…8e86`): **16/0**.
  - Typecheck clean; `auth.test.ts` **211/211**; `gap029-ops.test.ts` **76/76**.
  - `admin-lifecycle` **50/50** on the new isolated `afldb_v2_bra_test`, at 118 rows with `privileges --target test`.
  - Evidence: `docs/v2/evidence/open-issues-closure-20261108/branchA/`.
- **B1 `549c5892d7e31a962380c9bd0128ae99969f3b75`** on Branch B, holding the six ISSUE-339 files only.
- **W-339:** run 1 scored 52/4, all from a harness argument-order defect (kept as evidence, not re-run on the same databases). **Run 2 passed 61/0** on fresh `…r2…` databases.
  - Bundle sha256: `7ac7b9a6…02cd`.
  - In the clone, HEAD = B1 and origin/main = `7fabc6e5` (containing 118), verified before the migrator ran.
  - Migration 118 checksum: `49e59fcd…8401`. Template ledger sha: `0dbd4bab4fe160e5`; after 118: `5bb12f9b849349e9`.
  - Details are in the ISSUE-339 ledger entry. Evidence: `docs/v2/evidence/open-issues-closure-20261108/w339/`; scripts in `harness/run2-*.txt`.
- **Cleanup:** cluster 55481 stopped and confirmed (status 3, no listener, no postmaster). The clone's `.env` was removed. The data directory, the disposable databases and the workspaces `/mnt/ssd/afldb-brA-…`, `/mnt/ssd/afldb-w339-…` and `/mnt/ssd/afldb-w339r2-…` are retained, since deletion was not authorised. The leak scan was clean.
- **Not done (owner gates):** push and merge of Branch A and Branch B, P-340/P-345 closure edits, the R′ pin, the nightly read, R339-D, and B2–B8.
- **Duplicate-commit hazard:** the working tree of `D:\dev\afldb` still holds the A1–A3 changes, uncommitted on Branch B. Leave them out of B2–B8 (see the note under the commit plan).

## Environment used

- **Workspace 1:** `/mnt/ssd/afldb-close-20261108T061620Z`.
  - Built from a tarball of the local working tree (`/mnt/ssd/afldb-close-20261108T061620Z.tar.gz`), with no `.env`.
  - Node v22.23.2 from `~/.nvm`; `npm ci` clean; lock sha256 `984b4422…8e86`.
- **Workspace 2:** `…-i339`, built from the same tarball. Its throwaway `.env` was removed after the ISSUE-339 run.
- **Isolated cluster:**
  - root `/mnt/ssd/afldb-close-20261108T061620Z-pg`, `127.0.0.1:55481`, `cluster_name afldb_v2_isolated`, PG16 at `/usr/lib/postgresql/16/bin`;
  - its cluster name and `listen_addresses` were asserted before every state-changing step;
  - **STOPPED 2026-11-08 (owner-authorised cleanup)** with `AFLDB_V2_PG_ROOT=<root> AFLDB_V2_PG_PORT=55481 AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin node_modules/.bin/tsx tools/v2/isolated-pg.ts stop`, run from workspace 1. Confirmed: `pg_ctl` reported "no server running" (status 3), there is no listener on 55481, and no postmaster runs for that root.
  - The data directory and its databases are **retained**. Deletion was not authorised. Restart it with `… isolated-pg.ts start`.
- **Host scripts and logs:** `/mnt/ssd/afldb-close-20261108T061620Z-ops/`.
- **Repository copies:** `docs/v2/evidence/open-issues-closure-20261108/` (`harness/*.txt`, `ev339/`, `ev341/`, `ev342/`, `i338-*.log`). A leak scan found no credential strings.
- **SSH:** `ssh -o BatchMode=yes -i $HOME\.ssh\afldb_dev arm@10.0.40.100`. The `streamanator` alias is broken. Send scripts with `scp` and run them by path, because PowerShell strips quotes.
- **Workstation note:** the Grep/Glob tools are blocked by the `cbm-hook-runner` hook (no Git Bash). PowerShell `Select-String` was used for read-only searches.

## Progress (do not repeat a PASS row; its evidence is in the folder above)

| Issue | Result this run | Records |
|---|---|---|
| 338 | **PASS → RESOLVED, published** (run 6, `d3d38025`). Python contract 229/0, including 11a–11k; focused Vitest 1 passed / 166 skipped | ledger, index, runbook moved to `issues/closed/` |
| 341 | **PASS → RESOLVED, published** (run 6, `532dcd77`). Real restore qualification 37/0: H0 hazard reproduced; 9 refusals; identity guard; hostile-env positive restore; three distinct sentinels | ledger, index, runbook moved |
| 342 | **PASS → RESOLVED, published** (run 6, `532dcd77`). Fault injection 20/0: SIGKILL at the post-data barrier gives exit 1 (137 reported), no marker, witness index absent; the control restore succeeds | ledger, index, runbook moved |
| 339 | **R339-A status-mode target selection** 25/0: real `migrate.ts` child in `--status`, gate's exact line, disposable A/B. Windows pass and Linux 63/63 carried forward. **W-339 write-mode rehearsal PASS 61/0 (run 2) at B1 `549c5892`** | ledger, index. Owner decisions D1–D4 below; R339-D live measurement |
| 343 | **PASS → RESOLVED, published** (run 6, `3ec73bcf`). Real A/B qualification, both CLIs and the Brownlow wrapper; no failing case. The harness counted 156/157; the 1 is its own regex, and the log was re-read. B ended with 0 batches, fixtures and versions | ledger, index, runbook moved; evidence `ev343/` |
| 340, 345 | **PASS → RESOLVED, published** (run 3): `8ef4ae1b` and `65984ab2`, on `origin/main` via fast-forward to `c1c4b22e`. `admin-lifecycle` 50/50, `auth` 211/211, typecheck clean at the merged revision. P-340/P-345 applied | ledger, index section moved, runbooks in `issues/closed/` |
| 339 | **PASS → RESOLVED, published** (run 4): `origin/main` `c1c4b22e..8d122f62` (= tested commit). Windows PASS, Linux 63/0, W-339 61/0 carried forward, `merge:ready`/`preflight --mode merge` READY. D2 → ISSUE-346 | ledger, index section moved, runbook in `issues/closed/` |
| 336 | Pin R′ = `c1c4b22e` (published merged revision); `gap029-ops` 76/76 there (run 3); runbook §3 pinned, §6 hold cleared. **Nightly observed as predicted (run 4, 8 and 9 Nov).** Release packet drafted. **Open:** production release, D-336-2 approval, D-336-3 | packet P-336 items 3–5 |
| 346 | New (run 4), Low: standalone DEV `db:migrate` not gated. Interim rule: no hand-run DEV migrations | ledger, index |
| 332 | G1–G7 gate register recorded (operating record §10). Stays open | ledger, index |

## Consolidated owner decision packet

Each item is a separate owner act. Preparation is done; **nothing here has been executed**.

### D1–D4 — ISSUE-339 (deploy gate) — **DECIDED 2026-11-09 as recommended; D4 executed (published `8d122f62`); D2 tracked as ISSUE-346**
- **D1, custom DSN contract.** Today a custom `-DsnName` is accepted only with `-SkipMigrate`.
  - **Recommendation: keep it.** The real-runner case K7 shows `db:migrate --target dev` writes the database behind `AFLDB_OWNER_DATABASE_URL` whatever the gate assessed.
  - Supporting another DSN for migration would need `migrate.ts` to take the same variable. That is a code change, not a configuration choice.
- **D2, standalone `db:migrate` on DEV.** Should it go through the gate's transition approval?
  - **Recommendation: yes, but as a separate issue.** Route it through the gate as `-Phase execute -SkipBuild -SkipRestart`, or a small wrapper.
  - Until then, record it as an operator rule: never run `db:migrate` by hand on DEV.
- **D3, `preflight --mode deploy`.** Should it accept an approved transition?
  - **Recommendation: no change now.** DEV deploys use the host gate. `preflight --mode deploy` stays the `main`/production check, which is a separate decision when production deploys are next planned.
- **D4, merge.** Approve the B1 commit of the ISSUE-339 files, then push and merge. **Recommended only after W-339 passes.**
  - Branch `claude/issue-339-deploy-preflight` (Branch B), on top of `5cba6846`.
  - Files: `deploy/sync-dev.ps1`, `deploy/sync-dev-remote.sh`, `deploy/sync-dev-transport.sh`, `tests/sync-dev-remote.test.sh`, `tests/sync-dev-static.test.ps1`.
  - The next DEV deploy still needs a fresh verified backup and artifact.
- **Residual, not a gate:** R339-D argv exposure on the live DEV host was not measured. That needs a live DEV read.

### Commit plan (revised 2026-11-08): 340, 345 and 336 on a reviewed base that excludes the unpublished ISSUE-339 gate commit

**Why this is revised:** the current branch `claude/issue-339-deploy-preflight` contains the unpublished gate commit `5cba6846`. Commits made on it inherit that commit, whatever their files, so separate file groups do **not** make 340, 345 or 336 independently publishable. Those three go on a **new branch from the published base**. The 339 work and the rest stay on the current branch. Every Git step below is the owner's. Nothing has been staged or committed.

**Branch A — `claude/issue-340-345-336`, base = `origin/main` (last recorded `7fabc6e5`; re-confirm after fetching)**

Read-only checks before branching. They are the owner's Git operations; each has an expected result, and on a mismatch stop and report:
1. `git fetch origin`, then `git rev-parse origin/main`. Record the base SHA in this file.
2. `git merge-base --is-ancestor 5cba6846 origin/main`, which should **exit 1**: the gate commit is not in the base.
3. `git log --oneline origin/main..HEAD` lists what the current branch carries beyond the base. Expect `5cba6846` and possibly other local-only commits. All of them are excluded from Branch A by construction.
4. `git diff --quiet origin/main HEAD -- <every path in A1–A3>` should **exit 0**. That proves none of the base-excluded commits touched these files, so the working-tree versions carry onto the base unchanged. If it exits non-zero, run `git diff --stat origin/main HEAD -- <paths>` and stop: that file needs a rebase decision.
5. `git diff -- tests/auth.test.ts` should show **ISSUE-345 hunks only**. If ISSUE-340 hunks appear too, A1 and A2 must share that file (use `git add -p`, or combine A1 and A2).

Build the branch:
6. `npm run worktree:bootstrap -- --issue 340 --branch claude/issue-340-345-336` (the CLAUDE.md lifecycle). Or: `git worktree add -b claude/issue-340-345-336 ../afldb-i340-345-336 origin/main`.
7. Copy exactly the A1–A3 paths from `D:\dev\afldb` into the new worktree. That is a file copy, not a Git operation. `git status` there should list only those paths.

| # | Commit (proposed message) | Files | Evidence carried forward | Re-check on Branch A before publishing |
|---|---|---|---|---|
| A1 | `ISSUE-340: serialize credential verification, rotation and session issuance` | `src/db/queries/admin-credentials.ts` (new), `src/lib/auth/session.ts`, `src/app/admin/login/actions.ts`, `src/app/admin/password/actions.ts`, `src/app/admin/admins/password-actions.ts`, `tests/integration/admin-lifecycle.test.ts`, `issues/open/AFLDB-ISSUE-340.md` | `admin-lifecycle` 50/50 at ledger 118 plus typecheck (streamanator, 2026-11-08, on the mixed working tree) | `admin-lifecycle` on a disposable isolated `_test` database at 118 |
| A2 | `ISSUE-345: route restricted Grid Solver audiences through requireUploader` | `src/lib/auth/audience.ts`, `tests/auth.test.ts`, `issues/open/AFLDB-ISSUE-345.md` | `auth.test.ts` 211/211 plus typecheck | `npx vitest run tests/auth.test.ts` |
| A3 | `ISSUE-336: accept I336 run names in prod-stage.sh` | `tools/v2/gap029-ops/prod-stage.sh`, `tests/gap029-ops.test.ts`, `issues/open/AFLDB-ISSUE-336.md` | `gap029-ops` 76/76 | `npx vitest run tests/gap029-ops.test.ts`. **Once published, A3 is the revised I336 pin R′** |

Plus `npm run typecheck` once for the branch.

**Re-verification:** the carried-forward passes ran on a working tree that also held the 339 and 341–344 changes. The base-excluding proof is therefore one re-run of these four checks in a fresh disposable workspace built from Branch A's committed tree. That run needs your authorisation, the same scope as before.

**Tracking files:** `issues.md`, `IssuesIndex.md`, `CHANGELOG.md` and `blockers.md` are not split across branches. Branch A carries code, tests and the three runbooks only. The ledger and index records for 340, 345 and 336 stay in the records commit on the current branch (B8). Alternatively, if you want them on Branch A, I'll prepare a narrow records patch against the base once check 1 is recorded. The P-340/P-345 closure edits apply after A1/A2 are published.

**Branch B — the current `claude/issue-339-deploy-preflight` (keeps `5cba6846`; publication pending the D4 and W-339 outcome)**

| # | Commit | Files | Evidence carried forward |
|---|---|---|---|
| B1 | `ISSUE-339: bind migration target, allow main fast-forward, atomic transport, argv-safe psql` | `deploy/sync-dev-remote.sh`, `deploy/sync-dev.ps1`, `deploy/sync-dev-transport.sh` (likely new), `tests/sync-dev-remote.test.sh`, `tests/sync-dev-static.test.ps1`, `issues/open/AFLDB-ISSUE-339.md` | Windows harness pass; Linux 63/63; R339-A **status-mode target selection** 25/0; **W-339 pending** |
| B2 | `ISSUE-341/342: pin restore target identity; certify only completed pg_restore` | `tools/maintenance/restore-test.sh`, `tests/restore-test.test.sh`, the moves to `issues/closed/AFLDB-ISSUE-341.md` and `-342.md`, `docs/v2/evidence/open-issues-closure-20261108/ev341/` and `ev342/` | stub 24/24; real 37/0 and 20/0 |
| B3 | `ISSUE-343: prove control/writer identity in both fixture CLIs` | `tools/current-season/settle-afl-api-fixture-schedule.ts`, `tools/current-season/settle-afl-api-fixtures.ts`, `tests/afl-api-ingestion-safety.test.ts`, the move to `issues/closed/AFLDB-ISSUE-343.md`, `issues/closed/AFLDB-ISSUE-343-INDEX-SECTION-20261108.md`, `docs/…/ev343/` | unit 184/81/80; real A/B, no failing case |
| B4 | `ISSUE-338: freeze the review tool clock in the byte-identity check` | `tests/python/draftguru_bridge_operator_review_contract.py`, the move to `issues/closed/AFLDB-ISSUE-338.md`, `docs/…/i338-*.log` | 229/0 plus Vitest |
| B5 | `ISSUE-344: keep the true total on out-of-range draft pages` | `src/db/queries/draft.ts`, `src/db/queries/admin-draft.ts`, `src/app/admin/draft/page.tsx`, `src/app/draft/[year]/page.tsx`, `tests/integration/admin-draft.test.ts`, `tests/catalogue-lookups.test.ts`, `issues/closed/AFLDB-ISSUE-344*` | as recorded on ISSUE-344 |
| B8 | `Records: 2026-11-08 open-issues closure run` | `issues.md`, `IssuesIndex.md`, `CHANGELOG.md`, `blockers.md`, this file, `issues/closed/AFLDB-ISSUE-338-341-342-INDEX-SECTION-20261108.md`, `docs/v2/afl-api-2027-season-operations-successor-2026-11-02.md` (ISSUE-332 §10), `docs/…/harness/`, `ev339/` | — |

B2–B5 are not tied to the 339 decision either. If you want any of them published before 339, it is the same treatment as Branch A: run checks 4 and 5 for its paths, then re-run its suites on the new base.

**The working-tree change set** was derived from file modification times since 2026-11-07 18:00. Confirm it with `git status`. A moved runbook shows as a deletion plus an addition. After A1–A3 are committed on Branch A, the same paths on Branch B must be left out of B1–B8: discard them or keep them, your call. Otherwise they would be committed twice.

### W-339 — write-mode rehearsal (**RUN 2026-11-08, run 2: 61/0 PASS**; plan kept below as executed, with these deviations: bundle carries `refs/remotes/origin/main`, not local `main`; template and case names carry suffix `r2`; the existing cluster on 55481 was restarted and then stopped)

**Purpose:** the playbook's R339-A acceptance requires that a "matching approved migration touches only A and records its identity/transition". So far only status-mode target selection is proven (25/0). This rehearsal keeps two things separate:
1. **gate refusal**: `afldb_pf_migration_binding` refuses hostile exported variables, and no migration child runs;
2. **child environment scrubbing**: the gate's exact migration line, `env -u AFLDB_MIGRATE_TARGET -u AFLDB_OWNER_DATABASE_URL npm run db:migrate -- --target dev`, run in **write mode** with those hostile variables still present, advances A from 117 to 118 and leaves B unchanged.

**Every case starts from fresh disposable databases at ledger 117.**

**Needs your authorisation for:**
- (a) a **bundle you create**, which I transfer to streamanator: `git bundle create afldb-w339.bundle claude/issue-339-deploy-preflight main`, made after B1 is committed so the rehearsed code is the reviewed commit;
- (b) Git commands **inside the disposable clone only**: `git clone` from the bundle, plus the read-only Git calls that `migrate.ts` (`collectMigrationSources`) and the gate's `afldb_pf_compare_ledger` make;
- (c) restarting the stopped isolated cluster on 55481, or initialising a fresh one, and creating databases on it.

No DEV, production, shared database, build or restart is involved.

**Setup (S):**
- **S1, checkout:** clone `afldb-w339.bundle` into `/mnt/ssd/afldb-w339-<stamp>/clone` and check out `claude/issue-339-deploy-preflight` at B1.
  - Record `git rev-parse HEAD`. Confirm `src/db/migrations/` has 118 files, with `118_fixtures_unconfirmed_participants.sql` last, and that `refs/remotes/origin/main` contains 118, so it is not branch-local.
  - Run `npm ci`.
  - Write a throwaway `.env` (mode 0600) holding only `AFLDB_OWNER_DATABASE_URL=<A of the current case>`.
- **S2, template at 117:** a non-Git copy of the same tree with `118_*.sql` removed. Apply `AFLDB_TEST_DATABASE_URL=<tpl> npm run db:migrate:test` to a marked template `afldb_v2_w339t117_test`.
  - Assert 117 ledger rows, the last being `117_…`. Record the template's ledger hash.
- **S3, per-case databases:** `isolated-pg create-db <db> --template afldb_v2_w339t117_test`, so every case starts at 117.
  - Each B also gets an `i339w_sentinel` row with a random token.
  - Each B's fingerprint is taken: ledger hash, sentinel, table list and the `afldb_meta.schema_migrations` row count.
- Assert the cluster identity (name and `listen_addresses`) before every state-changing step.

**Hostile export set H**, the K2/K3 shapes: `AFLDB_OWNER_DATABASE_URL=<B>`, `AFLDB_MIGRATE_TARGET=test`, `AFLDB_TEST_DATABASE_URL=<B>`.

| Case | Fresh DBs | What runs | Pass condition |
|---|---|---|---|
| **G1** gate refusal, exported DSN | Ag, Bg at 117 | in the clone: `AFLDB_OWNER_DATABASE_URL=<Bg>` exported; source `deploy/sync-dev-remote.sh` and call `afldb_pf_migration_binding` | FAIL "…is exported in the deploy shell…". **No child is invoked.** Ag and Bg are still at 117 with identical fingerprints |
| **G2** gate refusal, exported target | same Ag, Bg | `AFLDB_MIGRATE_TARGET=test` and `AFLDB_TEST_DATABASE_URL=<Bg>` exported; call the binding | FAIL "AFLDB_MIGRATE_TARGET is exported…". No child. Both still at 117 |
| **W1** baseline write, clean environment | A1, B1 at 117 | the gate-library driver below, with no hostile exports | assessment: identity is A1; "applied migrations match the target revision" 117; **"approved migration transition" PASS `117 -> 118`** with `AFLDB_PF_LEDGER_BEFORE=117 AFLDB_PF_LEDGER_AFTER=118`; binding PASS. Then the **exact line in write mode**. Then `afldb_pf_migration_parity` PASS `118/118`. A1's ledger has exactly one new row (`118_…`) whose checksum matches the blob at HEAD. **B1's fingerprint is unchanged** |
| **W2** child scrubbing, write mode under H | A2, B2 at 117 | H exported in the calling shell, then the **exact line in write mode** (deliberately not gated, to isolate the child) | A2 goes 117 → 118 with one new row and a matching checksum. **B2's fingerprint is unchanged**, at 117. Then, in a clean subshell, `afldb_pf_migration_parity` against A2 gives PASS `118/118` |
| **N1** negative control: H is really hostile | A3, B3 at 117 | H exported, then the **old unbound line** `npm run db:migrate` (target `test` comes from H, a disposable target, so there is no Git inventory) | B3 goes 117 → 118 and A3 stays at 117. This proves H would misdirect a child that does not scrub. B3 is disposable, so that write is intended |

**Gate-library driver for W1** (sourced in the clone with `AFLDB_PF_DSN_NAME=AFLDB_OWNER_DATABASE_URL`, `AFLDB_PF_EXPECTED_DATABASE=<A1>`, `AFLDB_PF_TARGET_REV=$(git rev-parse HEAD)`, `AFLDB_PF_LEDGER_BEFORE=117`, `AFLDB_PF_LEDGER_AFTER=118` and `AFLDB_PF_EVIDENCE_DIR=<case dir>`):
1. `afldb_pf_open_evidence`.
2. The identity and ledger block of `afldb_deploy_gate`, called function by function (`deploy/sync-dev-remote.sh:868-901`): identity → `afldb_pf_read_ledger` → `afldb_pf_compare_ledger` → the transition check.
3. `afldb_pf_migration_binding`.
4. The exact migration line.
5. `afldb_pf_migration_parity`.
6. `afldb_pf_finish $?`.

The gate's own evidence file is the **transition record**. It is kept with the case logs. The full `afldb_deploy_gate -Phase execute` is not used, because it would also check out, install, build and restart.

**Evidence to record:**
- per case: before and after ledgers for A and B (names plus checksums), fingerprints, the gate evidence file and the child's stdout;
- `git rev-parse HEAD` of the clone, and the bundle's sha256;
- a leak scan for DSN passwords before anything is copied to `docs/v2/evidence/open-issues-closure-20261108/w339/`.

**On failure:** stop. Keep the databases and logs. Never re-run against the same database: a new case always gets fresh databases from the template.

**Not included:** checking out a live tree, `npm run build`, a restart, any DEV, production or shared database, push, merge.

**Outcome use:** if all five cases pass, R339-A's write-mode acceptance is met, and D4 (push and merge of Branch B) becomes your decision with no open evidence gap other than R339-D's live-host argv measurement.

### P-340 / P-345 — closure records for review (apply after owner acceptance **and** commit)
- **Changes to review:**
  - **340:** `src/db/queries/admin-credentials.ts` (new); `src/lib/auth/session.ts`; `src/app/admin/login/actions.ts`; `src/app/admin/password/actions.ts`; `src/app/admin/admins/password-actions.ts`; `tests/integration/admin-lifecycle.test.ts` (12 ISSUE-340 cases).
  - **345:** `src/lib/auth/audience.ts`; `tests/auth.test.ts` (8 ISSUE-345 cases).
  - File lists are from the ledger. Confirm them with `git status` (Git is the owner's).
- **Exact closure edits, to apply once accepted and committed (substitute `<commit>`):**
  1. `issues.md` ISSUE-340 entry: set **Status** to "Resolved <date>, committed in `<commit>`". Add: "Root cause: credential verification, mutation, TOTP consumption and session issuance did not share a per-user serialized decision. Fix: row-locked snapshot comparison in `admin-credentials.ts`; cookie after commit. Validation: `admin-lifecycle` 50/50 on a disposable isolated `_test` database at ledger 118, typecheck clean (streamanator 2026-11-08). Limits: not deployed; existing sessions unaffected; no schema change."
  2. `issues.md` ISSUE-345 entry: set **Status** to "Resolved <date>, committed in `<commit>`". Add: "Root cause: `requireAudience` checked role without `requireUploader()`'s forced-change redirect. Fix: non-public audiences go through `requireUploader()`. Validation: `tests/auth.test.ts` 211/211, typecheck clean (2026-11-08). Limits: not deployed; no browser check."
  3. `IssuesIndex.md`: move both sections verbatim to `issues/closed/AFLDB-ISSUE-340-345-INDEX-SECTION-<date>.md`, remove them, and add a resolution note.
  4. Move `issues/open/AFLDB-ISSUE-340.md` and `-345.md` to `issues/closed/`, with a RESOLVED status line, and fix their `AFLDB-ISSUE-339.md#…` links to `../open/…`.
  5. `CHANGELOG.md`: the entries already exist under 2026-11-08; mark them as committed.

### P-336 — revised pin, nightly, release and production data (separate approvals)
1. **Revised pin.** **Owner action:** commit A3 on **Branch A** (based on `origin/main`, excluding `5cba6846`; see the commit plan). It contains `tools/v2/gap029-ops/prod-stage.sh` (`STAGE_RE='(S[1-4]|I336)'`) and `tests/gap029-ops.test.ts`.
   - Once A3 is published, the new pin R′ is that commit, and it does not depend on the 339 decision. Before naming R′ in the runbook, a fresh disposable workspace at R′ re-runs `npx vitest run tests/gap029-ops.test.ts`; 76/76 is expected, as on the working tree.
   - Then replace `R` with R′ in runbook §3 steps 2–6 and clear the §6 review hold.
   - Preparation only; no production approval is implied.
2. **Nightly observation.** This is a live DEV read, outside this run's authorisation. **Owner action:** run it, or authorise a session to run it. The command and its interpretation table are in `issues/open/AFLDB-ISSUE-336-DEV-DEPLOYMENT.md` §7.2. For the 2026-11-08 firing:

   ```
   journalctl -u afldb-settle-afl-api.service --since "2026-11-08 04:55" --no-pager -o cat | grep -E 'Season feed CD_|Applied as import batch|Source completeness|AFLDB_SETTLE_(SUCCESS|FAILURE)'
   ls -d ~/projects/afldb/data/sources/afl_api/matches/afl-api-2027-* | tail -1
   ```
   - **DONE 2026-11-09 (run 4):** both firings observed as predicted; see the Run 4 section and runbook §7.2.
3. **Production application release.** Release ISSUE-336 together with ISSUE-337, which was resolved DEV-scoped. **Run 4:** a draft packet is at `docs/v2/issue336-337-340-345-release-packet-2026-11-09.md`. Any revision at or after R′ also carries 340 and 345 (decision RD-1). Next: the Linux release qualification at the chosen R (authorisation needed), then the full approval document.
   - Use the ISSUE-329 release route, with a fresh verified backup. Runbook §3 step 1 recommends releasing first.
   - **Decision:** the revision to release. Recommendation: the same commit as R′, so the release and the pin agree.
4. **D-336-2 production insert (35 rows).** Runbook §3 steps 2–7 at R′: P1 capture (read-only), P2 restore and assembly on streamanator, P3 plan, then the owner's `approve` and a single `apply`.
   - Each step is a separate approval.
   - Expected: 35 to insert, 31 new persons, actor 1, and reconciliation 5,966 = 5,966.
5. **D-336-3** (187 revised origin paths). Still open. The runbook's recommendation is a full DraftGuru re-acquisition and keyed reload, with `EXPECTED_ROWS` updated.

### Non-blocking ratifications (closed issues)
- **341:** the accepted restore DSN contract is the `.env.example` form only. Ratify it, or widen it (for example to a service name) as a new decision.
- **342:** the implementation uses the narrowly proven exit-1 compatibility exception, not strict exit-0 command selection. Ratify or replace it.

## ISSUE-332 — dated gates (owners and closing evidence in the operating record §10)

- **G1:** the C6 routine from 2027-03-17 (operator).
- **G2:** C7 acceptance after the first concluded round, March 2027 (owner).
- **G3:** round-2 reviews of D-316-5 and D-316-9 (owner).
- **G4:** open the Brownlow successor, June 2027 (owner).
- **G5:** C9 choice **by 2027-06-30** (owner).
- **G6:** Brownlow substantive decision and count window **before 2027-09-01** (owner).
- **G7:** C9 delivered before the about-October-2027 rollover (owner approves).

## Resume rule

Continue with the first row in Progress that is neither PASS nor packet-ready. After the owner acts on a packet item, record it in the ledger entry, then update this file.
