# AFLDB Current Issues Index

> Lightweight session index of open issues only.
>
> `issues.md` is the authoritative detailed ledger.
>
> Runbooks live under `issues/`, not at the repository root: `issues/open/<ISSUE-ID>.md` while
> the issue is open, `issues/closed/<ISSUE-ID>.md` once it is resolved, together with any
> `-HANDOFF.md` companions and evidence artefacts. Historical entries below name a runbook by
> filename only; resolved ones are in `issues/closed/`.

**Current state — 2026-11-13 (run 9, Step G):** **2 open issues: 332, 348.** **ISSUE-336 resolved.** D-336-2 Step G (read-only) complete: reconciliation against the owner CSVs **5,966 = 5,966** (0 unmatched either side, no per-category count difference; the only field differences are the 187 D-336-3 origins, kept by decision (A)); `draft_picks` 6,853 including ids 6819–6853; 8 manual rows and 8 active draft overrides; serving release `c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x` status and health PASS; the beta-gated page check of `/draft/2008`, `/draft/2025` and `/draft/2009?view=pre-draft` (plus the 2008 and 2025 Pre-Draft views) at desktop 1280×800 and mobile 390×844: Pre-Draft 4, 4 and 36, every inserted name present, Pre-Draft selections unnumbered, no page or console errors, anonymous requests still 307 to `/beta`. **Automated runner verdict: FAIL 77/83** (raw `browser/result.json` preserved unmodified). All six failures are the "authenticated HTTP 200" URL check. **Documented assessment, not an automated pass:** the check's predicate `page.url().includes('/beta')` also matches the host `https://beta.afldb.com`, so it cannot pass on that host; each of the six pages returned HTTP 200, passed every content check on the same page, and its screenshot shows the draft page, while anonymous requests for the same paths returned 307 to `/beta`. All 10 screenshots inspected. No database write, restart, deployment, timer, configuration or cache change. Evidence `docs/v2/evidence/issue336-d3362-stepg-20261113/README.md`. Published by fast-forward of `origin/main` `800cded0..ea077434` on 2026-11-13 (owner-approved; remote re-read).

**Earlier state — 2026-11-12 (run 9, evening):** **3 open issues: 332, 336, 348.** D-336-2 E+F applied on production 2026-11-12 at 05:00:43Z (16:00 AEDT), inside the approved window: plan `afa26158…f608`, run `I336-20261112T025001Z`, backup `0d517f5a…34c6`, ops `a25306f9`. **COMMITTED_VERIFIED** (exit 0) and **ACCEPTED**: `draft_picks` 6,818 → 6,853 (+35, ids 6819–6853), `draft_persons` 5,057 → 5,088 (+31), 35 `data_edits` rows by actor 1 (seal `audited_correction`); pre-existing rows unchanged; no restart or other change. Evidence `docs/v2/evidence/issue336-d3362-apply-20261112/README.md`.

**Earlier state — 2026-11-12 (run 9, afternoon, plan):** **3 open issues: 332, 336, 348.** ISSUE-349 is resolved (published by fast-forward of `origin/main` `595dc394..ae47f94f`). A fresh D-336-2 Steps A–D at ops pin `a25306f9` reached **PLAN_COMPLETE** on production: plan digest `afa26158781c0538166302be05d440a79af9ab805f8143f218c5cf804e90f608`, backup sha256 `0d517f5a3db7ccb887615df2c3fa3f136918f5dd4941df939e7e1a8d843a34c6`. No database write. Next: the owner's OD-4 (E+F); approvals must expire before 2026-11-13T02:30:02Z. Evidence `docs/v2/evidence/issue336-d3362-plan-20261112/README.md`.

**Earlier state — 2026-11-12 (run 9, morning):** **4 open issues: 332, 336, 348, and the new 349.** D-336-2 Steps A–D ran and stopped at the plan: the I336 tool refused with a false "baseline drift" caused by a session time-zone dependency (349). No database write. Evidence `docs/v2/evidence/issue336-d3362-production-20261112/README.md`. The ISSUE-336 r2 application release is on production and accepted. ISSUE-346 and ISSUE-347 are resolved after publication (published by fast-forward of `origin/main` `12aa6e29..9e8a85b7` on 2026-11-12). Owner approved local implementation and qualification of 349: a25306f9 passed Linux unit 85/85, typecheck and the non-UTC red/green simulation; unpublished. The records commits 633e4390 and 595dc394 are published; remote main is 595dc394.

**Earlier state — 2026-11-11 (closure run 8, local records branch `claude/records-catchup-20261111`, unpublished while `main` is frozen at PKG `12aa6e29`):** **5 open issues: 332, 336, 346, 347, and the new 348.** Owner decisions of 2026-11-11 are recorded on the stacked local branch `claude/records-decisions-20261111`.
- **336:** **the r2 application release is on production and ACCEPTED (2026-11-12)**: `c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x`, carrying 337, 340 and 345; rollback target `0f251c2daa8d-3t0xWKI76Jgna2tB8a9oN`. The owner's D4-O missed the original deadline and is recorded as late evidence; every check re-passed in the owner's re-approved window. Record `docs/v2/evidence/issue336-337-340-345-release-execution-20261111/`. D-336-2 A+B and C+D are next, stopping at the read-only plan; E+F (OD-4) is pending. D-336-3 is decided (A): stored origins kept, carried as 348.
- **347:** fix `2207986f`, qualified, local.
- **346:** the route is implemented and qualified locally. R1–R5 accepted 2026-11-11; the operator restrictions are binding (runbook §2) and "never `db:migrate` by hand on DEV" is permanent. Publication approved under OD-6 after D1 PASS; resolve after publication.
- **348 (new, Low):** carry the D-336-3 classification to the Nov–Dec DraftGuru re-acquisition as its origin-review gate. Present 3 club replacements (ids 5961, 6784, 6626) for owner adjudication.
- **332:** dated gates only, the first from 2027-03-17.

Resume point: `issues/open/OPEN-ISSUES-CLOSURE-RUN-20261108.md` (Run 8). The counts below are historical.

**Publication state of the 2026-11-08/09 closure records (records-only commit from `origin/main` `8d122f62`, 2026-11-09).** These records were published without code. On `origin/main`:
- **Fixed in the tree:** 337 (`7fabc6e5`), 340 and 345 (`c1c4b22e`), 339 (`8d122f62`). The ISSUE-336 draft-page code is also there (`7fabc6e5`). The unpublished ISSUE-336/337 DEV-deploy docs commit `48ff91c7` is carried as a cherry-pick.
- **Published 2026-11-09 (closure run 6):** the B2–B5 fixes for 338 and 341–344 are now on `origin/main`: 341/342 `532dcd77`, 343 `3ec73bcf`, 338 `d3d38025`, 344 `ae28bd70` (`origin/main` `c5959bbf..ae28bd70`; merged revision = tested commit). Not deployed. `origin/main` is now past the ISSUE-336/337/340/345 release package commit PKG `c5959bbf`. As written, the approval document's D0 and D1 require `origin/main` = PKG and its §1 says to re-derive the package on a mismatch, so the release needs an owner decision on that check first. R′ `c1c4b22e`, H = R and the static delta check are unaffected; the package was not edited.
- *Superseded by the line above:* 338, 341, 342, 343 and 344 are recorded below as **resolved, scoped to the local working tree**. Their fixes (commit plan B2–B5 in `issues/open/OPEN-ISSUES-CLOSURE-RUN-20261108.md`) are **not on `origin/main`**, so the defects remain in this tree until a separate owner decision publishes those fixes.
- **Open issues:** 3 (332, 336, 346).

**ISSUE-339 resolved 2026-11-09 (published, not deployed).** The reviewed gate commits were replayed onto `origin/main` `c1c4b22e`. The unpublished ISSUE-336/337 docs commit `48ff91c7` was left out. They were published by fast-forward `c1c4b22e..8d122f62`, so the merged revision `8d122f62` is the tested commit.
- **Validation at the candidate:** Windows static harness PASS; Linux harness 63/63; W-339 61/0 carried forward (migration inputs and gate code unchanged); `merge:ready` and `preflight --mode merge` READY.
- **Owner decisions D1–D4:** custom `-DsnName` stays `-SkipMigrate`-only; standalone DEV migration approval is split to **ISSUE-346** (Low); `preflight --mode deploy` is unchanged; publication was authorised.
- R339-D live-host argv exposure is recorded as **unmeasured**.
- **ISSUE-336:** the §7.2 nightly was observed as predicted on 2026-11-08 and 2026-11-09.

Record: their `issues.md` entries; runbook `issues/closed/AFLDB-ISSUE-339.md`; pre-closure section `issues/closed/AFLDB-ISSUE-339-INDEX-SECTION-20261109.md`. **Open issues:** 3 (332, 336, 346).

**ISSUE-340 and ISSUE-345 resolved 2026-11-08 (published).** The owner accepted both. They were committed as `8ef4ae1b` (340, credential decisions under the account row lock) and `65984ab2` (345, restricted Grid Solver via `requireUploader()`), and published by fast-forward of `origin/main` `7fabc6e5..c1c4b22e`; the merged revision is the tested commit. Validation at `c1c4b22e`: `admin-lifecycle` 50/50 (isolated `_test` database at ledger 118), `auth` 211/211, typecheck clean; `merge:ready` and `preflight --mode merge` READY. Neither is deployed. Records: their `issues.md` entries; runbooks in `issues/closed/`; the pre-closure sections are in `issues/closed/AFLDB-ISSUE-340-345-INDEX-SECTION-20261108.md`. **Open issues:** 3 (332, 336, 339).

**ISSUE-343 resolved 2026-11-08; fix published 2026-11-09 in `3ec73bcf`** (until then scoped to the local working tree). The real A/B qualification across both fixture CLIs and the Brownlow wrapper found no failing case. Mismatched control and writer refuse with both databases byte-identical; the matching target writes to A only. Record: its `issues.md` entry and `issues/closed/AFLDB-ISSUE-343.md`. The pre-closure index section is in `issues/closed/AFLDB-ISSUE-343-INDEX-SECTION-20261108.md`. **Open issues:** 5 (332, 336, 339, 340, 345).

**ISSUE-338, ISSUE-341 and ISSUE-342 resolved 2026-11-08; fixes published 2026-11-09 in `d3d38025` (338) and `532dcd77` (341/342)** (until then uncommitted; open-issues closure run, verified on streamanator in a fresh workspace and an isolated loopback cluster).
- **338:** Python contract 229/0 and the focused Vitest case passed.
- **341:** the real two-database restore qualification passed 37/0 with distinct sentinels.
- **342:** the real fault injection (SIGKILL at the post-data barrier) passed 20/0 and left no proof marker.

Records: their `issues.md` entries; runbooks in `issues/closed/`; evidence in `docs/v2/evidence/open-issues-closure-20261108/`. The pre-closure index sections are in `issues/closed/AFLDB-ISSUE-338-341-342-INDEX-SECTION-20261108.md`. Resume checkpoint and owner decision packet: `issues/open/OPEN-ISSUES-CLOSURE-RUN-20261108.md`. **Open issues:** 6 (332, 336, 339, 340, 343, 345).

**ISSUE-344 resolved 2026-11-08; fix published 2026-11-09 in `ae28bd70`.** It is not on DEV or production.
- **Query layer:** `catalogue-lookups` passed 24/24, and `admin-draft` passed 47/0/5 on a seeded isolated database.
- **Redirects:** both were browser-verified on a loopback-only isolated instance. Each landed on page 2 of 2 with its filters kept, a total of 57 and 7 rows.

Record: its `issues.md` entry and runbook `issues/closed/AFLDB-ISSUE-344.md`; the pre-closure index section is preserved verbatim in `issues/closed/AFLDB-ISSUE-344-INDEX-SECTION-20261108.md`. **Open issues:** 9 (332, 336, 338–343, 345).

**Current state — 2026-11-08 (implementation session):** 10 open issues (332, 336, 338–345); 344 has since been resolved, see above. Fixes for 336 (§6), 338–345 are **implemented locally and uncommitted, awaiting user-executed verification**; none is closed. **Review state (earlier 2026-11-08):** six new source-established findings (340–345); existing 336, 338 and 339 updated. [Baseline, coverage, evidence gaps and implementation order](issues/closed/AFLDB-ISSUE-339.md#repository-review-handoff-2026-11-08). Earlier dated counts/status notes are historical.

**ISSUE-337 resolved 2026-11-07, DEV-scoped.** It was deployed to DEV with ISSUE-336's pinned procedure, and the authenticated browser check passed 76/76, finding Jake Long for ordinary-space, NBSP and lower-case queries. Production installation is pending with ISSUE-336's production release. Full record: its `issues.md` entry. **Open issues:** 3 as of 2026-11-07 (ISSUE-332, ISSUE-336, ISSUE-338).

**ISSUE-334 and ISSUE-335 resolved 2026-11-05** (both Low; fixed in `R` `0f251c2d` and released to production as `0f251c2daa8d-3t0xWKI76Jgna2tB8a9oN`, owner restart 15:11:58 AEDT; D3c PASS and D4 PASS; the two refusals are proven on isolated Linux and **not exercised on production**, their production presence rests on manifest-verified provenance plus, for ISSUE-335, a bundle literal; production orphaned `match_coaches` overrides from past deletions were not checked; record `docs/v2/evidence/issue334-335-release-execution-20261105/execution-record.md`; the pre-closure index section is preserved verbatim in `issues/closed/AFLDB-ISSUE-334-335-INDEX-SECTION-20261105.md`). **Open issues:** 2 as of 2026-11-05 (ISSUE-332; ISSUE-336, opened later that day). **ISSUE-316 resolved 2026-11-03** as "cutover delivered" under the owner's Option A (full record: the first entry under its heading in `issues.md`; runbook `issues/closed/AFLDB-ISSUE-316.md`; its pre-closure index section is preserved verbatim in `issues/closed/AFLDB-ISSUE-316-INDEX-SECTION-20261103.md`). Mobile G3 to G5 of the D-316-12 visual check are page-text evidence only and are not recorded as visually verified at mobile width (owner-accepted). **ISSUE-331 resolved 2026-11-04** (Path A: the owner retired the quarantined WSL distributions; accepted residuals K-U1 to K-U8 are listed in its `issues.md` entry; runbook `issues/closed/AFLDB-ISSUE-331.md`; its pre-closure index section is preserved verbatim in `issues/closed/AFLDB-ISSUE-331-INDEX-SECTION-20261104.md`). **ISSUE-321 resolved 2026-11-04** as accepted source limitations (owner decision O3; its five limitations and four reopening triggers are in its `issues.md` entry; no value was chosen, averaged or inferred, NULL stays NULL; no runbook exists; its pre-closure index section is preserved verbatim in `issues/closed/AFLDB-ISSUE-321-INDEX-SECTION-20261104.md`). **ISSUE-333 resolved 2026-11-04** (2026 coach assignments absent from production: O1 and O2 applied once each and verified; the corrected figures observed through the public routes on five pages under the owner's amended visibility criterion; worker-by-worker attribution is unmeasured and an accepted, disclosed limitation; record `docs/v2/issue333-o2-apply-record-2026-11-04.md` section 10 and its `issues.md` entry; its pre-closure index section is preserved verbatim in `issues/closed/AFLDB-ISSUE-333-INDEX-SECTION-20261104.md`). **Open issues:** 1 as of 2026-11-04 (ISSUE-332, the named successor carrying the dated 2027 operating obligations; the owner decided D-316-5, -8, -9, -10, the C7 criteria and the June 2027 opening of the Brownlow successor on 2026-11-04, while C9, the C7 acceptance and the Brownlow count window remain future). Older notes below that give a different count are historical.

**ISSUE-229 resolved 2026-11-02** (all written criteria met: B2 captured, dry-run reviewed, writer tested, first apply approved and applied on production by Block M-b, `/admin/fixtures` inspected; recurring ingestion and Brownlow are not its conditions and stay with ISSUE-316; see `docs/v2/issue229-gap008-closure-2026-11-02.md` and its `issues.md` entry; V2-GAP-008 closed with it). **Open issues at that note (superseded by the ISSUE-316 note above):** 3 (ISSUE-316, ISSUE-321 and ISSUE-331, **reopened 2026-11-01**: the quarantined rehearsal distro was booted as a Linux test host in breach of D-331-2; see `docs/v2/issue331-incident-assessment-2026-11-01.md` section 6; the earlier disappearance stays cause UNKNOWN). **ISSUE-331 resolved 2026-11-01** (local isolated-test environment incident; recovered, cause unestablished, uncertainty explicitly accepted; changed stores logically quarantined, unregistering/deleting deferred; see its note below). **ISSUE-330 resolved 2026-10-31** (see below). **ISSUE-329 resolved 2026-10-31**: the release route is installed on production and live-accepted; production serves `61a95f7397da-JYIBkYn8ynPgYMn1e5nK-` built through it. **On 2026-10-27, 13 issues were resolved under owner decision D-V2-SCOPE-20261027** (V2 only; see the resolved note below and `issues/closed/AFLDB-V2-CLOSURE-SCOPE-DECISION-20261027.md`). Earlier history follows: (ISSUE-328, registered 2026-10-27 as a port of the source repository's `6ffb893b` fix (admin settle panels named the text-sorted "latest" batch), full record in `issues.md`; ISSUE-325, registered 2026-10-24 for the ISSUE-316 J2 rebuild harness's esbuild sampler exemption (F-J06), was resolved on 2026-10-24 by staged harness revision I325-3, full record in `issues.md`; ISSUE-323 and ISSUE-324, registered 2026-10-23 during the ISSUE-316 pre-apply work and by its revision I disposable rebuild, were resolved on 2026-10-24 by the revision J2 disposable rebuild (owner ruling on F-J06; full record in `issues.md`); ISSUE-322, registered 2026-10-23 during the ISSUE-316 pre-apply work, was resolved on 2026-10-24, see below; ISSUE-321, registered 2026-10-23 for the successor source data-quality questions the owner deferred; ISSUE-319 and ISSUE-320, registered 2026-10-23 as ISSUE-316 successor gates, were resolved on 2026-10-23 (runbooks `issues/closed/AFLDB-ISSUE-319.md` §6 and `issues/closed/AFLDB-ISSUE-320.md` §8, the latter streamanator-scoped); ISSUE-316, registered 2026-10-18 on the uncommitted branch `opus/afl-api-cutover`; ISSUE-229, ISSUE-266–270, and the 7 review findings ISSUE-271–314 other than ISSUE-280, ISSUE-277, ISSUE-303, ISSUE-278, ISSUE-281, ISSUE-282, ISSUE-283, ISSUE-284, ISSUE-285, ISSUE-286, ISSUE-287, ISSUE-288, ISSUE-289, ISSUE-290, ISSUE-291, ISSUE-292, ISSUE-293, ISSUE-294, ISSUE-295, ISSUE-296, ISSUE-297, ISSUE-298, ISSUE-299, ISSUE-300, ISSUE-301, ISSUE-302, ISSUE-304, ISSUE-305, ISSUE-306, ISSUE-307, ISSUE-309, ISSUE-310, ISSUE-311, ISSUE-312, ISSUE-313 and ISSUE-314, registered on 2026-10-10; ISSUE-278, ISSUE-302, ISSUE-312, ISSUE-313, ISSUE-314 and ISSUE-315 were resolved on 2026-10-13, ISSUE-281 and ISSUE-288 on 2026-10-14 (both DEV-scoped; PROD installation and acceptance pending, runbooks `issues/closed/AFLDB-ISSUE-281.md` §18 and `issues/closed/AFLDB-ISSUE-288.md` §18), and ISSUE-265 on 2026-10-14, its closure documentation merged and pushed as `b8040018` and its ISSUE-265-specific PROD hold released, and ISSUE-297 on 2026-10-14 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-297.md` §18), and ISSUE-290 on 2026-10-14 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-290.md` §18), and ISSUE-291 on 2026-10-14 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-291.md` §18), and ISSUE-287 on 2026-10-14 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-287.md` §18), and ISSUE-286 on 2026-10-14 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-286.md` §18), and ISSUE-300 on 2026-10-14 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-300.md` §18), and ISSUE-306 on 2026-10-14 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-306.md` §18), and ISSUE-298 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-298.md` §18), and ISSUE-309 and ISSUE-311 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbooks `issues/closed/AFLDB-ISSUE-309.md` and `issues/closed/AFLDB-ISSUE-311.md` §18), and ISSUE-310 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-310.md` §18), and ISSUE-305 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-305.md` §18), and ISSUE-296 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-296.md` §18), and ISSUE-285 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-285.md` §19–§20), and ISSUE-282 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-282.md` §17–§18), and ISSUE-283 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-283.md` §17–§18), and ISSUE-284 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-284.md` §17–§18), and ISSUE-293 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-293.md` §17–§18), and ISSUE-294 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-294.md` §17–§18), and ISSUE-295 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-295.md` §17–§18), and ISSUE-301 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-301.md` §17–§18), and ISSUE-304 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-304.md` §17–§18), and ISSUE-307 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-307.md` §17–§18), and ISSUE-289 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-289.md` §17–§18), and ISSUE-277 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-277.md` §17–§18), and ISSUE-292 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-292.md` §17–§18), and ISSUE-299 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-299.md` §17–§18), and ISSUE-303 on 2026-10-15 (DEV-scoped: deployed to DEV on 2026-10-15 and browser-accepted; PROD installation and acceptance pending; runbook `issues/closed/AFLDB-ISSUE-303.md` §21–§22), and ISSUE-308 on 2026-10-15 (DEV-scoped: deployed to DEV and accepted under the owner's D-308-3 amendment; PROD installation and acceptance pending; runbook `issues/closed/AFLDB-ISSUE-308.md` §22), and ISSUE-280 on 2026-10-15 (DEV-scoped: deployed to DEV and accepted under the owner's D-280-1 and D-280-2 amendments; PROD installation and acceptance pending; runbook `issues/closed/AFLDB-ISSUE-280.md` §22); other issues' PROD prerequisites are unchanged)

> **Waiting and blockers:** [`blockers.md`](blockers.md) is a navigation register of everything outstanding (blocked
> work, actionable work awaiting execution, decisions, acceptance and deployment holds). It is not authoritative; the
> runbooks and `issues.md` are. Update it whenever a listed blocker or acceptance state changes.

### AFLDB-ISSUE-332 — AFL API 2027 season operations (successor of ISSUE-316)

- **Severity / area:** Medium; AFL API match and player ingestion operations for the 2027 season.
- **State:** Open, opened 2026-11-02; **owner decisions recorded 2026-11-04** (supersede the earlier "keep pending" position for these items only). **Decided:** D-316-5 (manual debutant registration and adjudication, whole-night refusal kept; resumption is on a scheduled run after identity resolution, not guaranteed to take one night; review after round 2), D-316-8 (NULL, `attendance_status='not_collected'`), D-316-9 (incomplete 2027 coach coverage accepted; optional audited back-fill; review after round 2; 2026 correction preserved), D-316-10 (existing ISR behaviour; no `AFLDB_REVALIDATE_SECRET` in nightly units; no maximum delay promised); C7 criteria 1 to 7 approved, criterion 8 replaced (settled round shown correctly on public season and match responses; delay and limits reported; no latency guarantee or worker attribution; unobserved or incorrect content fails); the June 2027 opening of the Brownlow successor (D-316-7, action only) approved. **Not decided / future:** C9 (D-316-6; undecided until its June gate; Option C recommendation only), the Brownlow substantive decision and count window, the C7 acceptance (owner's act after the first concluded round); D-316-11 not pursued. **No acceptance, probe, cookie or Brownlow activation is authorised.**
- **Key files:** `docs/v2/afl-api-2027-season-operations-successor-2026-11-02.md` (the single operating record: decision register, C7 criteria, per-round routine, ISR measurement plan, ownership guards, Brownlow gates), `tools/v2/c7-observe.ts`, `src/lib/acquisition/afl-api-c7-observation.ts`.
- **Next action (dated; nothing is due before Opening Round 2027-03-17T00:00Z):** after round 2, the D-316-5 and D-316-9 reviews; after the first concluded round (March 2027), the owner's C7 acceptance with observed delay and measurement limits reported; June 2027, open the Brownlow successor and choose the C9 option (by 2027-06-30); before 2027-09-01, the Brownlow substantive decision (the count window is the owner's act); about October 2027, C9 delivered and reviewed before the rollover. The original recommendations are in `docs/v2/post-release-closeout-2026-11-04.md` section 4; the current state is in the operating record (section 9). **2026-11-08:** gate register G1–G7 recorded in the operating record's section 10, with owners and the evidence that closes each gate. Nothing more can be prepared before Opening Round. The issue stays open until all seven gates have occurred and their evidence is recorded.

**AFLDB-ISSUE-336 resolved 2026-11-13** (production data verified; records only, nothing further deployed). The draft pages separate the categories and number picks within their own draft (released to production in r2, `c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x`, accepted 2026-11-12); D-336-2 inserted the 35 missing DraftGuru Pre-Draft rows (COMMITTED_VERIFIED and ACCEPTED 2026-11-12); Step G (2026-11-13, read-only): reconciliation against the owner CSVs **5,966 = 5,966** (0 unmatched either side, no per-category count difference; the only field differences are the 187 D-336-3 origins, kept by decision (A)); `draft_picks` 6,853 including ids 6819–6853; 8 manual rows and 8 active draft overrides; serving release `c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x` status and health PASS; the beta-gated page check of `/draft/2008`, `/draft/2025` and `/draft/2009?view=pre-draft` (plus the 2008 and 2025 Pre-Draft views) at desktop 1280×800 and mobile 390×844: Pre-Draft 4, 4 and 36, every inserted name present, Pre-Draft selections unnumbered, no page or console errors, anonymous requests still 307 to `/beta`. **Automated runner verdict: FAIL 77/83** (raw `browser/result.json` preserved unmodified). All six failures are the "authenticated HTTP 200" URL check. **Documented assessment, not an automated pass:** the check's predicate `page.url().includes('/beta')` also matches the host `https://beta.afldb.com`, so it cannot pass on that host; each of the six pages returned HTTP 200, passed every content check on the same page, and its screenshot shows the draft page, while anonymous requests for the same paths returned 307 to `/beta`. All 10 screenshots inspected. D-336-3 was decided (A) and is carried by ISSUE-348. Removed from this index and the Open Issues table. Record: its `issues.md` entry; runbooks `issues/closed/AFLDB-ISSUE-336.md` and `issues/closed/AFLDB-ISSUE-336-DEV-DEPLOYMENT.md`; pre-closure index sections `issues/closed/AFLDB-ISSUE-336-INDEX-SECTION-20261111.md` and `issues/closed/AFLDB-ISSUE-336-INDEX-SECTION-20261113.md`; evidence `docs/v2/evidence/issue336-d3362-stepg-20261113/README.md`.

**AFLDB-ISSUE-349 resolved 2026-11-12** (published by fast-forward of `origin/main` `595dc394..ae47f94f`; ops tooling only, nothing deployed). Both I336 clients pin `TimeZone` to `Etc/UTC` (`a25306f9`); Linux `gap029-ops` 85/85, typecheck and a Melbourne-versus-UTC red/green simulation passed, then the production plan at that pin completed (digest `afa26158…f608`). Removed from this index and the Open Issues table. Record: its `issues.md` entry; evidence `docs/v2/evidence/issue349-utc-20261112/` and `docs/v2/evidence/issue336-d3362-plan-20261112/`.

**AFLDB-ISSUE-346 and AFLDB-ISSUE-347 resolved 2026-11-12** (published by fast-forward of `origin/main` `12aa6e29..9e8a85b7` on 2026-11-12, OD-6; tooling and records only, nothing deployed). 347: `restoreTag()` derives the GAP-029 runner's restore TAG from the stage length (`718d39c6`); `gap029-ops` 84/84 at the published tip. 346: the gated migration-only DEV route `sync-dev.ps1 -SkipBuild -SkipRestart` (`4b6f9410`, `5c1c8704`, `17f63993`); Linux harness 86/0 at the published tip; R1–R5 accepted 2026-11-11; the runbook §2 operator restrictions bind and "never `db:migrate` by hand on DEV" is permanent. `merge:ready` 347 and 346 and `preflight --mode merge` READY in a fresh streamanator clone. Removed from this index and the Open Issues table. Records: their `issues.md` entries; runbook `issues/closed/AFLDB-ISSUE-346.md`.

**AFLDB-ISSUE-280 resolved 2026-10-15, DEV-scoped** (code `c68e1214`; installed on DEV by the gated deployment of `0cb3d20c` at 22:07 AEDT; accepted 22:26-22:55 AEDT). DEV stayed at `0cb3d20c` (BUILD_ID `jfwHG_Ru35eHV1Q9_O6oy`); no redeployment. **D-280-1 amended (owner, 2026-10-15):** one magic-link issuance for `stuart.villanti@gmail.com` through DEV's existing journal fallback; no SMTP configuration and no external email. The address was first verified allowlisted and not revoked (`/admin/access`, read-only). Under the D-280-2 criterion (reviewed simulated prefetch, one human confirmation, refused replay): one link issued at 11:50:30 UTC (audit `beta.magic_link_issued`, `delivered=false`; exactly one journal line, redacted in every record); the owner obtained it privately (their own terminal read the journal line, the clipboard excluded from history) and pasted it into the hidden box of an isolated test-browser window; it was never in chat and never saved. Before confirmation, `prefetch-sim.py --expect confirm`: 3 GET 200 "Confirm sign-in", no `afldb_beta` cookie, no `Location`, HEAD 200, EXPECTATION MET (token sha256[:8] `8c6493a5`, 43 characters); audit before confirmation: issued present, **no** verified event (1,072 events; baseline 1,071). The owner pressed "Sign in to the beta" once at 11:51:19 UTC (I issued no click): httpOnly `afldb_beta` cookie, landed on `/`, exactly one `beta.magic_link_verified`. Replay in a brand-new cookie-less browser context (the link was read inside the browser process from the test page's history, never printed): GET 200 confirmation page, no `Set-Cookie`, no `Location`, robots `noindex, nofollow`, referrer `no-referrer`; the button pressed once; redirected to `/beta` with no cookie; the audit then still showed exactly one verified event (1,073 events = baseline + issued + verified; no `beta.magic_link_revoked_email`). Journal check since 22:27:31: PASS (523 lines; the three `ERROR` matches are HTTP-200 requests for the static chunk `error-*.js`; no syntax error, unhandled, ECONNREFUSED or digest line). Visual: V-280-1 (desktop 1280x800) and V-280-2 (mobile 390x844, no horizontal overflow) were captured at replay time, i.e. of the same link's confirmation page after its token was spent (a GET reads no table, so the page is identical), because the owner clicked before the unused page could be captured; V-280-3 is the signed-in landing. Screenshots are viewport-only; URL metadata is path `/beta/verify` with `token=<redacted>`. Credential hygiene: a leak scan of the evidence found no token or link. Effects: `beta_login_tokens` +1 row (hash only, now used), `auth_audit_log` +2; no allowlist, settings, `.env`, hook, schema or SMTP change; no email; PROD untouched. **Limits:** actual link-scanning gateway behaviour remains untested (D-280-2); the pre-fix defect was not reproduced on the previous build (the optional control was not authorised); the replay and the captures were driven by the browser tool, the confirmation click was the owner's. PROD installation and acceptance pending. Evidence (workstation, not in the repository): `D:\tmp\dev-deploy-280-308-20261015-r2\run-20261015-2227-280\` (`SHA256SUMS.txt`, 18 files; decisions verbatim in `OWNER-DECISIONS.md`; results in `accept\ACCEPTANCE-RESULTS.md`). Full record: `issues.md` (ISSUE-280 entry) and `issues/closed/AFLDB-ISSUE-280.md` §22.

**AFLDB-ISSUE-308 resolved 2026-10-15, DEV-scoped** (code `16f31a67` and `46cb380e`; installed on DEV by the gated deployment of `0cb3d20c` at 22:07 AEDT). ISSUE-308 DEV acceptance (2026-10-15, after the deployment of `0cb3d20c`): `award_winners` 118 (All-Australian 1987, "Matthew Campbell", Brisbane) was re-read first and still matched the reviewed evidence (unlinked, `unmatched`; player 9257 Matthew Campbell, Brisbane Bears 1987-1993, 79 games, born 30 Jan 1964); one Super Admin approval through the drawer (score 97 Very high, bulk-ready) returned "Suggested match approved." without hanging; the follow-up `POST /admin/player-links/revalidate` returned 200 `{"ok":true}` from worker 1 (pid 2084226, build `jfwHG_Ru35eHV1Q9_O6oy`); the public page `/awards/all-australian/1987` then served the link `/players/matthew-campbell-9257` on worker 1 in 24 of 24 fresh-connection requests (and, see limits, on every worker); the after-read shows id 118 `player_id` 9257 `resolved`, linked 3471 -> 3472, unlinked 241 -> 240, total and max_id unchanged, `fingerprint_excl_target` unchanged (`3e15c68aee8d6f0a264fcefc1010d2d7`), so no other row moved; `/admin/audit` shows exactly one new `player_link.suggestion_approved` (targetTable `award_winners`, targetId 118, playerId 9257). **D-308-3 (owner, 2026-10-15), recorded as an explicit amendment of R308 §14 item 2.** Original criterion, preserved as history: "on DEV: approve one suggestion and request the award page", which must show the linked player. Amended criterion: a successful revalidation and linked-player rendering **on the worker that answers the follow-up POST**; the other workers may retain their cached page until it expires. No cluster-wide invalidation is claimed: `revalidatePath` reaches one worker's ISR cache (per-worker caches, ISSUE-134), which is a limitation of the mechanism, not fixed here. Limits: the four workers all showing the link is **not** evidence of cluster-wide invalidation, because the deployment restart emptied every worker's cache after the pre-approval probe, so the per-worker limit was neither shown nor refuted; the `player_link_resolutions` row was not independently read (not claimed); the bulk-approve path was not exercised; screenshots are viewport captures (V-308-1..3) with exact URLs recorded; whether the ISSUE-087 hang reproduces on Next 16.3.1 stays unknown (this action never calls `revalidatePath`, and none was seen). D-308-2: restoration declined, so the approved link stays (with its resolution and audit history). PROD installation and acceptance pending. Full record: `issues.md` (ISSUE-308 entry) and `issues/closed/AFLDB-ISSUE-308.md` §22.

**AFLDB-ISSUE-277 resolved 2026-10-15** (merge-scoped; implementation, tests and records as `8450134b`, fast-forwarded to `main` and pushed; documentation-only closure commit follows). D-277-1 (owner): option (a), with the save-time replay-compatibility guard. A Data Editor save of `dob`, birth year, height, weight or notes for a player whose only durable identity is the `manual_admin_edit` token wrote no override, so the next replay re-created the old value while the audit row still named the change. `saveEdit` now plans, before the canonical write, a merge of the edited group into the player's active creation record, refuses the save whole when the merged record would fail the replay's own pre-check (no `display_name`, or a `dob` without a usable confidence), and otherwise writes the merge and its own `manual_identity_record` audit row in the same transaction. Players holding an AFL Tables identity are unchanged. Validation, on `afldb_test` only: 8 new PostgreSQL cases, including the real `replay_admin_overrides('players')` re-creating a deleted player with every edited value (rolled back) and a guard that agrees with that replay on four record shapes; the whole `data-editor` file 52 passed; the DB-free source contract 74 passed; 6 of 8 new cases fail on the unfixed source; 7 of 7 mutants killed; residue 0; `tsc` and `git diff --check` clean. A read-only census found 92 manual players on DEV and on PROD, none token-only. **Limits:** not deployed; no DEV or PROD write; a player with a token but no active record, or no identity at all, is still not durable (unchanged); the replay's `afltables_profile_path` arm is not mirrored. Detail: `issues.md` (ISSUE-277 entry) and `issues/closed/AFLDB-ISSUE-277.md` §17-§18. **DEV installation (15 Oct 2026):** this change is in `f07c2a74`, installed on DEV at 16:30 AEDT (BUILD_ID `Xr8x1v5iRTaLiR7h0ScFg`, re-read read-only the same day); installation is not acceptance, and no DEV check of it is claimed. Not on PROD. "Not deployed" above is the merge-time state.

**AFLDB-ISSUE-282 resolved 2026-10-15** (merge-scoped; implementation `9baba193`, records `5906e426`, fast-forwarded to `main` and pushed; documentation-only closure commit follows). Each of the five replace transactions (award winner, Hall of Fame inductee, honour-team member, first-kick goal, after-the-siren kick) returned the revalidation paths of the voided row only, so the created row's award, season, player, club, match or team pages stayed stale until their ISR window expired (up to a day). Each now reads the created row inside the transaction and returns the de-duplicated union of both rows' paths. Integration, on `afldb_test` only (database proved for the owner, importer and auth roles before any write): `admin-awards` 4 focused cases passed and `admin-special-records` 2, including new replace cases for honour-team members and after-the-siren kicks, which had none; the same cases fail 4 and 2 on the unfixed source; 16 of 16 mutants killed; fixture residue 0 on 14 selectors throughout. `tsc`, `eslint` and `git diff --check` exit 0. Readiness was accepted under a scoped cleanliness exception (18 paths), not a clean pass. **Limits:** not deployed; no browser, DEV or PROD action; the action layer's use of the returned paths was not exercised; the whole integration files and the awards file's python replay tests were not run; ISSUE-283 is separate. Detail: `issues.md` (ISSUE-282 entry) and `issues/closed/AFLDB-ISSUE-282.md` §17–§18. **DEV installation (15 Oct 2026):** this change is in `f07c2a74`, installed on DEV at 16:30 AEDT (BUILD_ID `Xr8x1v5iRTaLiR7h0ScFg`, re-read read-only the same day); installation is not acceptance, and no DEV check of it is claimed. Not on PROD. "Not deployed" above is the merge-time state.

**AFLDB-ISSUE-283 resolved 2026-10-15** (merge-scoped; implementation, tests and records as `f0a0c917`, fast-forwarded to `main` and pushed; documentation-only closure commit follows). The award create forms offered an "Administrative note (kept with the audit entry)" that the three award create actions never read, so every creation audit entry carried the row's public text as `data_edits.note`; in every replace the note reached only the voided or suppressed half. The create actions now pass `adminNote`, the award, Hall of Fame and honour-team inserts record it as the creation audit note (the row's text stays in `new_values`), and all five replace functions hand it to the created half; a plain special-record create, which has no admin-note field, is unchanged. A create (or special-record replace) with no note now writes an empty audit note instead of the record text. Integration, on `afldb_test` only (database proved for the owner, importer and auth roles before any write): `admin-awards` 7 new cases and `admin-special-records` 4, with 5 new DB-free action cases; the same cases fail 7, 3 and 3 on the unfixed source; 18 of 18 mutants killed. One fixture-residue incident (3 + 1 rows and 1 audit row from the first special-records run) was removed by id with a guarded script and the suite's purge extended; the final census read 0. `tsc`, `eslint` and `git diff --check` exit 0. Readiness was accepted under a scoped cleanliness exception (18 paths), not a clean pass. **Limits:** not deployed; no browser, DEV or PROD action; no real Server Action was driven with a session and a database together; the whole integration files and the awards file's python replay tests were not run; earlier audit rows are not repaired. Detail: `issues.md` (ISSUE-283 entry) and `issues/closed/AFLDB-ISSUE-283.md` §17–§18. **DEV installation (15 Oct 2026):** this change is in `f07c2a74`, installed on DEV at 16:30 AEDT (BUILD_ID `Xr8x1v5iRTaLiR7h0ScFg`, re-read read-only the same day); installation is not acceptance, and no DEV check of it is claimed. Not on PROD. "Not deployed" above is the merge-time state.

**AFLDB-ISSUE-284 resolved 2026-10-15** (merge-scoped; implementation, tests and records as `f43d4d59`, fast-forwarded to `main` and pushed; documentation-only closure commit follows). The Brownlow season aggregate counted a match as "imported" only while it had no workflow row, so a source-complete 3/2/1 that an Admin then saved as a draft fell out of `final`, `voided` and `imported`: the season read "not complete" and the Publish panel listed a blocker and disabled "Publish season…", while the publish transaction, the per-round tables and `isMatchAccounted` counted the match as accounted. The aggregate now returns an `accounted` count with the gate's own rule (voided, or a complete 3/2/1 whatever the workflow row is); the season summary's `complete` and status, the season page and `incompleteMatchCount` use it, and `imported` stays a display count. Integration, on `afldb_test` only (database proved for the owner, importer and auth roles before any write): one new case on its own seeded season (a drafted source-complete match stays accounted, the season reads complete, publish accepted) passed alone and with its neighbouring blocks (32 passed); 3 DB-free cases; the same cases fail on the unfixed source and 7 of 7 mutants are killed; fixture residue read 0 throughout. `tsc`, `eslint` and `git diff --check` exit 0. Readiness was accepted under a scoped cleanliness exception (18 paths), not a clean pass. **Limits:** not deployed; no browser, DEV or PROD action; the season page and list were not rendered; the whole integration file was not run. Detail: `issues.md` (ISSUE-284 entry) and `issues/closed/AFLDB-ISSUE-284.md` §17–§18. **DEV installation (15 Oct 2026):** this change is in `f07c2a74`, installed on DEV at 16:30 AEDT (BUILD_ID `Xr8x1v5iRTaLiR7h0ScFg`, re-read read-only the same day); installation is not acceptance, and no DEV check of it is claimed. Not on PROD. "Not deployed" above is the merge-time state.

**AFLDB-ISSUE-285 resolved 2026-10-15** (merge-scoped; implementation `70af9ae3`, records `848f13f1`, integration case `39f996c8` with records `fbe9715c`, all fast-forwarded to `main` and pushed; documentation-only closure commit follows). After a `duplicate` refusal of an award-winner replacement the `/admin/awards` Replace panel had no control to give the confirmation the action requires; it now offers the create form's `confirmDuplicate` checkbox for the refused preview only, and the confirm button posts it only when ticked. DB-free: `tests/awards-replace-panel.test.ts` 20 cases, six mutants killed by behavioural assertions. Integration: a new `admin-awards` case run against `afldb_test` (database proved before any write; the new case passed and the whole file passed 33 of 33) shows the duplicate refusal rolls the void back whole and that, with `confirmDuplicate`, the void, replacement, natural-key cross-linked overrides and audit rows persist; two mutants of the duplicate check were killed and fixture residue read back as zero. The first closure (`5f440acf`) had been withdrawn because §14's second item was unmet; both items are now met. Readiness was accepted under a scoped cleanliness exception (18 paths), not a clean pass. **Limits:** not deployed; no browser, DEV or PROD action; the panel wiring and query layer are proved by separate suites. Detail: `issues.md` (ISSUE-285 entry) and `issues/closed/AFLDB-ISSUE-285.md` §17–§20. **DEV installation (15 Oct 2026):** this change is in `f07c2a74`, installed on DEV at 16:30 AEDT (BUILD_ID `Xr8x1v5iRTaLiR7h0ScFg`, re-read read-only the same day); installation is not acceptance, and no DEV check of it is claimed. Not on PROD. "Not deployed" above is the merge-time state.

**AFLDB-ISSUE-289 resolved 2026-10-15** (merge-scoped; implementation, tests and records as `39622149`, fast-forwarded to `main` and pushed; documentation-only closure commit follows). D-289-1 (owner): option (a), narrowly. A fixture that was cancelled and whose game was then played could never be reinstated: the played lock refused every group, and `checkMoveTarget` would have refused `already_played` for the fixture's own match even past the lock. `isFixtureEditAllowed` now allows exactly `fixture_reinstated` on a `cancelled` fixture whose resolution is `played` or `played_home_away_differs`; `reinstateFixture` skips `already_played` only for that single own result. Every other group, an ambiguous resolution, a duplicate scheduled fixture and a club clash still refuse, and no `matches` row is written. The fixture page renders the lifecycle panel for such a fixture with Reinstate alone. Validation, on `afldb_test` only: DB-free 80 passed (9 new, 7 failing on the unfixed source), the whole `admin-fixtures` integration file 39 passed (3 new: create, cancel, play, reinstate, with the played match byte-identical afterwards, plus the duplicate and ambiguous refusals), 6 of 6 mutants killed, residue 0, `tsc`, ESLint and `git diff --check` clean. **Limits:** not deployed; no browser, DEV or PROD action; **`VISUAL: UNVERIFIED`** (structural render test only). Detail: `issues.md` (ISSUE-289 entry) and `issues/closed/AFLDB-ISSUE-289.md` §17-§18. **DEV installation (15 Oct 2026):** this change is in `f07c2a74`, installed on DEV at 16:30 AEDT (BUILD_ID `Xr8x1v5iRTaLiR7h0ScFg`, re-read read-only the same day); installation is not acceptance, and no DEV check of it is claimed. Not on PROD. "Not deployed" above is the merge-time state.

**AFLDB-ISSUE-292 resolved 2026-10-15** (merge-scoped; the fix `1d2ec9fb` was already on `main`; this closure is documentation only). The players branch of `getEntityNaturalKey` orders its identity query (`afltables_profile_url` rows first, then the smallest path), so a renumbered-profile player's edits are keyed under one path whatever the physical row order. The runbook's open question was run read-only on 15 October 2026 with a guarded script (owner role on `afldb_dev`; the read-only backup role on `afldb_prod`): **no player on either database has active overrides under more than one `afltables` key, and the replay's own equal-authority conflict query returns no rows on either** (DEV 95 active player overrides over 93 players, PROD 92 over 92; the four players holding two accepted profile paths carry none), so no repair is needed. **Limits:** the fix is not deployed (DEV at `17514052`, PROD at `cd3cf782` both predate it); the census is current state only. Detail: `issues.md` (ISSUE-292 entry) and `issues/closed/AFLDB-ISSUE-292.md` §17-§20. **DEV installation (15 Oct 2026):** this change is in `f07c2a74`, installed on DEV at 16:30 AEDT (BUILD_ID `Xr8x1v5iRTaLiR7h0ScFg`, re-read read-only the same day); installation is not acceptance, and no DEV check of it is claimed. Not on PROD. "Not deployed" above is the merge-time state.

**AFLDB-ISSUE-293 resolved 2026-10-15** (merge-scoped; implementation, tests and records as `8e49a9da` with ISSUE-294, fast-forwarded to `main` and pushed; documentation-only closure commit follows). The settle runs under-reported `dataIssuesResolved` in `import_batches.validation_result` and the CLI counters: the AFL Tables run assigned its end-of-run restored count over the healed apply-failure findings it had already summed, and the AFL API run discarded the counts of three `resolveRestoredDisagreements` calls (match-score restore, venue-identity restore, period-scores contradiction; the runbook named two at older line numbers). Both now add what they close; which findings are resolved is unchanged. Integration, on `afldb_test` only (database proved for the owner, importer and auth roles before any write): a new AFL Tables heal case, a new AFL API score-disagreement restore case, the venue self-heal case and the three ISSUE-276 restore runs assert the count; the same cases fail on the unfixed source; 4 of 4 mutants killed. Fixture census unchanged (12 pre-existing S6 batches untouched). `tsc` and `git diff --check` exit 0; ESLint reports the same 20 problems as unchanged `main`, none new. Readiness was accepted under a scoped cleanliness exception (18 paths), not a clean pass. **Limits:** not deployed; no browser, DEV or PROD action; earlier runs' counters are not repaired; the test files were run by filter, not whole. Detail: `issues.md` (ISSUE-293 entry) and `issues/closed/AFLDB-ISSUE-293.md` §17–§18. **DEV installation (15 Oct 2026):** this change is in `f07c2a74`, installed on DEV at 16:30 AEDT (BUILD_ID `Xr8x1v5iRTaLiR7h0ScFg`, re-read read-only the same day); installation is not acceptance, and no DEV check of it is claimed. Not on PROD. "Not deployed" above is the merge-time state.

**AFLDB-ISSUE-294 resolved 2026-10-15** (merge-scoped; implementation, tests and records as `8e49a9da` with ISSUE-293, fast-forwarded to `main` and pushed; documentation-only closure commit follows). The AFL Tables settle, the lineup store and the deprecated fallback importer closed their import batch with `completed_at = now()`, the transaction start, so a batch's completion equalled its start and run durations could not be read from the ledger; the AFL Tables settle also left `records_inserted` and `records_updated` at 0. All three now use `clock_timestamp()`, and the AFL Tables settle records `records_inserted = versionsAppended` and `records_updated = 0` (the table is append-only); the lineup store and the fallback importer already wrote their counts. Integration, on `afldb_test` only (database proved for the owner, importer and auth roles before any write): the AFL Tables first-apply case asserts the counts and `completed_at > started_at`, the lineup-store batch case asserts the completion instant, and a DB-free source-contract case covers all three writers (the fallback importer by SQL text only); they fail on the unfixed source and 7 of 7 mutants are killed. Fixture census unchanged. `tsc` and `git diff --check` exit 0; ESLint reports the same 20 problems as unchanged `main`, none new. Readiness was accepted under a scoped cleanliness exception (18 paths), not a clean pass. **Limits:** not deployed; no browser, DEV or PROD action; earlier batches keep `completed_at = started_at`; the legacy CSV promotion batch (ISSUE-307) is unchanged; the test files were run by filter, not whole. Detail: `issues.md` (ISSUE-294 entry) and `issues/closed/AFLDB-ISSUE-294.md` §17–§18. **DEV installation (15 Oct 2026):** this change is in `f07c2a74`, installed on DEV at 16:30 AEDT (BUILD_ID `Xr8x1v5iRTaLiR7h0ScFg`, re-read read-only the same day); installation is not acceptance, and no DEV check of it is claimed. Not on PROD. "Not deployed" above is the merge-time state.

**AFLDB-ISSUE-295 resolved 2026-10-15** (merge-scoped; implementation, tests and records as `dba8b2d0`, fast-forwarded to `main` and pushed; documentation-only closure commit follows). The settle exception report listed open `canonical_apply_failed` findings by type and owner only, which both settles share, so the AFL API report showed AFL Tables' failures as its own and vice versa, and the AFL API's per-run findings could fill the 20-row cut and hide AFL Tables' own. The apply-failure section is now narrowed by `details.source_key`, which every writer stamps; the disagreement section is unchanged. Integration, on `afldb_test` only (database proved for the owner, importer and auth roles before any write): two cases insert open findings under a private key prefix and show that each report lists only its own source's failures and that 21 AFL API findings no longer hide the one AFL Tables finding; both fail on the unfixed source and 4 of 4 mutants are killed; the fixture census is unchanged. `tsc`, `eslint` and `git diff --check` exit 0. Readiness was accepted under a scoped cleanliness exception (18 paths), not a clean pass. **Limits:** not deployed; no browser, DEV or PROD action; the report CLI and its rendered text were not run; the test file was run by filter, not whole. Detail: `issues.md` (ISSUE-295 entry) and `issues/closed/AFLDB-ISSUE-295.md` §17–§18. **DEV installation (15 Oct 2026):** this change is in `f07c2a74`, installed on DEV at 16:30 AEDT (BUILD_ID `Xr8x1v5iRTaLiR7h0ScFg`, re-read read-only the same day); installation is not acceptance, and no DEV check of it is claimed. Not on PROD. "Not deployed" above is the merge-time state.

**AFLDB-ISSUE-296 resolved 2026-10-15** (merge-scoped; implementation commits `03fb5bcd` and `074667eb`, records `10548157`, fast-forwarded to `main` and pushed; documentation-only closure commit follows). The deprecated fallback current-season importer (`writeMatches` in `src/lib/external-afl/current-season-import.ts`) wrote `import_batches.records_rejected` as the canonical plan's planning count while writing no `import_rejections` rows, contradicting the column contract (migration 001; ISSUE-244 F008). It now writes `0`; the planning count stays in `validation_result` and the function's return value. DB-free: one new source-contract case in `tests/current-season-import.test.ts`, 6 of 6 mutants killed, `tsc` and `eslint` exit 0; the file's one failure (ISSUE-122 S6 derived-helper wiring) is identical on unchanged `main`. Readiness was accepted under a scoped cleanliness exception (18 paths), not a clean pass. **Limits:** not deployed; the assertion is on the SQL text, not a live batch row; no PostgreSQL or integration run; earlier batch rows not repaired. **Open (operator decision, not a gate):** whether to retire the fallback path. Detail: `issues.md` (ISSUE-296 entry) and `issues/closed/AFLDB-ISSUE-296.md` §17–§18. **DEV installation (15 Oct 2026):** this change is in `f07c2a74`, installed on DEV at 16:30 AEDT (BUILD_ID `Xr8x1v5iRTaLiR7h0ScFg`, re-read read-only the same day); installation is not acceptance, and no DEV check of it is claimed. Not on PROD. "Not deployed" above is the merge-time state.

**AFLDB-ISSUE-299 resolved 2026-10-15** (merge-scoped; the fix `091e4635` was already on `main`; this closure is documentation only). The R lineup and roster acquirers now refuse an existing non-empty output directory before the contract is read and before any network call (an empty directory is still accepted), so a second run with the same scope can no longer rewrite the first run's artefact and manifest. The runbook's operator-run networked double run was performed on 15 October 2026 for both scripts into fresh scratch directories (lineups for season 2026 round 20, rosters for 2026): the first run of each fetched (468 lineup rows; 812 roster rows) and **the second run of each exited 1 with the guard's message, made no request, and left the first run's files byte-identical.** **Limits:** one lineup round and one roster season from one workstation; nothing is deployed. Detail: `issues.md` (ISSUE-299 entry) and `issues/closed/AFLDB-ISSUE-299.md` §17-§20. **DEV installation (15 Oct 2026):** this change is in `f07c2a74`, installed on DEV at 16:30 AEDT (BUILD_ID `Xr8x1v5iRTaLiR7h0ScFg`, re-read read-only the same day); installation is not acceptance, and no DEV check of it is claimed. Not on PROD. "Not deployed" above is the merge-time state.

**AFLDB-ISSUE-301 resolved 2026-10-15** (merge-scoped; implementation, tests and records as `0d3d03b5`, fast-forwarded to `main` and pushed; documentation-only closure commit follows). `requestAflApi` called `fetch` with no `AbortSignal` and read the response body outside its retried region, so an upstream that accepted the connection and then stalled hung the run until systemd killed it, and a body-stream failure escaped as a bare `TypeError` past the backoff and the 401/403 logic. Each attempt, body read included, now runs under a deadline (a signal handed to `fetch` plus a race, so a transport that ignores the signal cannot hang the run), and a timeout or a failed body read is retried like a network failure. **The timeout is an implementation default of 60 s per attempt**, taken under the runbook's "operator or implementation choice"; it is not a measured figure and not an owner decision, and `RetryOptions.timeoutMs` overrides it. DB-free: five fake-timer cases with stub transports fail on the unfixed source and pass fixed; 449 neighbouring cases pass; 7 of 7 mutants killed; `tsc` and `git diff --check` exit 0; ESLint reports the same problem set as unchanged `main`. Readiness was accepted under a scoped cleanliness exception (18 paths), not a clean pass. **Limits:** not deployed; no network, DEV or PROD action; the behaviour against the real upstream is not exercised. Detail: `issues.md` (ISSUE-301 entry) and `issues/closed/AFLDB-ISSUE-301.md` §17–§18. **DEV installation (15 Oct 2026):** this change is in `f07c2a74`, installed on DEV at 16:30 AEDT (BUILD_ID `Xr8x1v5iRTaLiR7h0ScFg`, re-read read-only the same day); installation is not acceptance, and no DEV check of it is claimed. Not on PROD. "Not deployed" above is the merge-time state.

**AFLDB-ISSUE-304 resolved 2026-10-15** (merge-scoped; implementation, tests and records as `074c01ae`, fast-forwarded to `main` and pushed; documentation-only closure commit follows). The email poller forwarded an attachment of any size, base64-encoded into one JSON POST, and the intake route ran `request.json()` on the whole body before it looked at the sender or the base64 length, so a 40 MB attachment from any mail-authenticated sender was held in an app worker's memory only to be answered 403 or 400. The poller now refuses an attachment over the 5 MiB upload ceiling (reported, filed to Errors, counted as rejected, never encoded or posted; an attachment of exactly 5 MiB is still forwarded), and the route answers a declared `Content-Length` over the base64 limit plus a 16 KiB envelope allowance with 400 before parsing, after the secret check. A body with no or an unreadable length is parsed as before. DB-free: a Python self-test over `main()` (at the limit, one byte over, small; live and `--dry-run`) with a parity check against the app's constant, and five route cases with a spied `json()`, fail on the unfixed source and pass fixed; 11 of 11 mutants killed (one first survived and drove an added case); `tsc`, `py_compile`, `eslint` and `git diff --check` clean. Readiness was accepted under a scoped cleanliness exception (18 paths), not a clean pass. **Limits:** not deployed; no mail, network, DEV or PROD action; the poller is dormant on both hosts; a chunked body is not bounded before parsing; the intake integration file was not run. Detail: `issues.md` (ISSUE-304 entry) and `issues/closed/AFLDB-ISSUE-304.md` §17–§18. **DEV installation (15 Oct 2026):** this change is in `f07c2a74`, installed on DEV at 16:30 AEDT (BUILD_ID `Xr8x1v5iRTaLiR7h0ScFg`, re-read read-only the same day); installation is not acceptance, and no DEV check of it is claimed. Not on PROD. "Not deployed" above is the merge-time state.

**AFLDB-ISSUE-305 resolved 2026-10-15** (merge-scoped; implementation commits `d82e891e` and `5282322b`, records `1ba75b06`, fast-forwarded to `main` and pushed; documentation-only closure commit follows). Legacy intake validation now refuses a `match_results` `match_date` or `player_bio` `dob` that is not a real calendar day (`2024-02-30`), and a `player_bio` `height_cm` or `weight_kg` that is not plain digits in range (`1.8e2`, `0x50`, `80.0`), instead of letting the `::date` / `::smallint` cast fail at promotion and roll the submission back to `failed`. DB-free: 39 new cases (25 fail on the old source), `tests/ingest-datasets.test.ts` 299 passed, `tsc` and `eslint` exit 0, 9 of 10 mutants killed (the tenth is equivalent). Readiness was accepted under a scoped cleanliness exception (18 paths), not a clean pass. **Limits:** not deployed; no PostgreSQL or integration run. **Open follow-up (operator decision, not a gate):** `rising_star` `votes` and stat-line cells are not validated (H-305-1 determined: no CHECK on `award_nominations.votes`). Detail: `issues.md` (ISSUE-305 entry) and `issues/closed/AFLDB-ISSUE-305.md` §17–§18. **DEV installation (15 Oct 2026):** this change is in `f07c2a74`, installed on DEV at 16:30 AEDT (BUILD_ID `Xr8x1v5iRTaLiR7h0ScFg`, re-read read-only the same day); installation is not acceptance, and no DEV check of it is claimed. Not on PROD. "Not deployed" above is the merge-time state.

**AFLDB-ISSUE-307 resolved 2026-10-15** (merge-scoped; implementation, tests and records as `0d7810d8`, fast-forwarded to `main` and pushed; documentation-only closure commit follows). The legacy CSV promotion stamped `records_read = records_inserted = rows.length` and left `records_updated` at 0, so every `ON CONFLICT DO UPDATE`, every `player_bio` update and every `match_attendance` update that touched no row was counted as an insert. The six dataset writers' `promoteRow` now return `inserted`, `updated` or `noop` (the four upserts through `RETURNING (xmax = 0) AS inserted`, the two updates through `RETURNING id`), and the batch records `records_inserted` and `records_updated` from those outcomes; a row that matched nothing is in `records_read` only. Integration, on `afldb_test` only (database proved for the owner, importer and auth roles before any write; the promotion runs under the real import role): a new match is `read 1 / inserted 1 / updated 0`, a re-promoted match beside a new one `2 / 1 / 1`, player stats `1 / 1 / 0` then `1 / 0 / 1`, and a biography file whose second player was deleted after validation `2 / 0 / 1`; six DB-free cases cover all six writers; all fail on the unfixed source (which reports `inserted 2` for the mixed file) and 10 of 10 mutants are killed. The 147 promotion batches the runs left were removed by a guarded script and the batch census is back at its starting 690. `tsc` and `git diff --check` exit 0; ESLint reports the same problem set as unchanged `main`. Readiness was accepted under a scoped cleanliness exception (18 paths), not a clean pass. **Limits:** not deployed; no browser, DEV or PROD action; earlier batches are not repaired; the batch's `completed_at` still equals its start; the `xmax` semantics were exercised for `matches` and `player_match_stats`, not for the award tables or `match_attendance`; the match-results file's ISSUE-264 block does not run on `afldb_test` (pre-migration-110), identically on `main`. Detail: `issues.md` (ISSUE-307 entry) and `issues/closed/AFLDB-ISSUE-307.md` §17–§18. **DEV installation (15 Oct 2026):** this change is in `f07c2a74`, installed on DEV at 16:30 AEDT (BUILD_ID `Xr8x1v5iRTaLiR7h0ScFg`, re-read read-only the same day); installation is not acceptance, and no DEV check of it is claimed. Not on PROD. "Not deployed" above is the merge-time state.

**AFLDB-ISSUE-310 resolved 2026-10-15** (merge-scoped; implementation commits `3961d6fd` and `616e383b`, records `cc711d81`, fast-forwarded to `main` and pushed; documentation-only closure commit follows). The AFL API link path now takes the player's stable identity from the forward classifier (`classifyAflApiForwardIdentityRows`) and refuses a player with two non-pair AFL Tables paths, or two manual tokens, as T7; a continuity pair stores the rule's continuing path. The revoke ledger row keeps a deterministic fallback (`player_identity` is `NOT NULL`). DB-free: 6 new cases (3 fail on the old source), 4 of 4 mutants killed, file 162 passed with the pre-existing I14 failure. Readiness was accepted under a scoped cleanliness exception (18 paths), not a clean pass. **Limits:** not deployed; no PostgreSQL or integration run; the DEV/PROD collation is unknown and existing ledger rows are not audited. Detail: `issues.md` (ISSUE-310 entry) and `issues/closed/AFLDB-ISSUE-310.md` §17–§18. **DEV installation (15 Oct 2026):** this change is in `f07c2a74`, installed on DEV at 16:30 AEDT (BUILD_ID `Xr8x1v5iRTaLiR7h0ScFg`, re-read read-only the same day); installation is not acceptance, and no DEV check of it is claimed. Not on PROD. "Not deployed" above is the merge-time state.

**AFLDB-ISSUE-313 resolved 2026-10-13** (merge-scoped; implementation commit `d43207c1d349d32d71fc6e135229b5cd5812199c`, parent `5ffbc563`, fast-forwarded to `main` and pushed; documentation-only closure commit follows it). Every `psql` the TypeScript database tooling launches now gets a password-free `-d` value and the password in the child's `PGPASSWORD`; unmovable or ambiguous password forms are refused before psql starts (D-313-6, approved). DB-free: `tests/db-test-rebuild.test.ts` 589 passed (61 new); real-psql pack V1–V6 PASS on `streamanator` (psql 16.15). Readiness was accepted under a scoped cleanliness exception, not a clean pass. **Limits:** not end-to-end `privileges.ts` acceptance (D-313-1); V5 had 4 periodic samples; the credential launcher was outside the pack manifest; Windows, `root` visibility and PROD not verified; not deployed. Detail: `issues.md` (ISSUE-313 entry) and `issues/closed/AFLDB-ISSUE-313.md` §22.

**AFLDB-ISSUE-314 resolved 2026-10-13** (merge-scoped; implementation commit `c47709ad475c99c617d0b393af323607d107f2a8`, parent `24ca412b`, fast-forwarded to `main` and pushed; documentation-only closure commit follows it). `prepare-promotion-source --apply` now refuses an unusable `--record-out` before it verifies, connects or writes. DB-free: Windows 464 passed | 1 skipped; Linux (`streamanator`, Node v22.23.2) `-t ISSUE-314` 9 selected, 9 passed, 0 failed, 0 skipped. Readiness was accepted under a scoped cleanliness exception, not a clean pass. No real `--apply` or promotion was run; the `cannot be inspected` branch is untested; an unwritable directory, a full disk and a path created after the check are still found only by the final write. Detail: `issues.md` (ISSUE-314 entry) and `issues/closed/AFLDB-ISSUE-314.md` §17.9.

**AFLDB-ISSUE-312 and AFLDB-ISSUE-315 resolved 2026-10-13** (merge-scoped; commits `5d277ddd` and `9c279f5c`, merge `01976be7` onto local `main`, not pushed or deployed). ISSUE-312: a detached HEAD no longer breaks the migration safety scan (DB-free 37/37). ISSUE-315: the O1 statement extractor uses the TypeScript parser (DB-free 14/14; `afldb_test` `-t "obligation O1"` 3/3). Limits and the integration gate results are in `issues.md` (resolved note and the ISSUE-315 entry) and `issues/closed/AFLDB-ISSUE-312.md` §18.

**AFLDB-ISSUE-233 resolved 2026-10-08** (implementation merged 2026-10-01 as `f0abbb4c` and `cc1a5f2d`; operator
decision D-233-4) — AFL API season discovery (D-233-1), season-scoped AFL API Brownlow artefacts (D-233-2), and an
`afl_api` ownership census that refuses at rebuild, rollover and promotion (D-233-3). The promotion gate's first live read
PASSED on DEV (`afldb_dev`, HEAD `7adfb3e8`) and PROD (`afldb_prod`, HEAD `cd3cf782`): ownership gate PASS and dependencies
phase PASS, no `afl_api`-owned match in any season; graded offline (0 CRIT/HIGH/MED, 5 INFO). **Accepted limits:** no real
promotion ran; `pre-cutover`, `restored`, `candidate` and `production` are DB-free tested only (capture their results at
the next real promotion); the first genuine D-233-2 load is a 2026 rollover follow-up; the unfrozen manifests must not be
reused for a promotion. The PROD read ran at about 19:17 AEDT on 2026-10-08, inside ISSUE-265's N2 observation window. Full
record: `issues.md`, `issues/closed/AFLDB-ISSUE-233.md` §4.12–§4.13.

**AFLDB-ISSUE-259 and AFLDB-ISSUE-260 resolved 2026-10-08** (Sonnet 5; merged and pushed at `7adfb3e8`;
operator-run local validation and DEV deployment; DEV browser acceptance via Playwright MCP) — a club-scoped career
ranking with any non-`games` condition now declines with "This career statistic cannot currently be totalled for one
club." (259, D-259-1), and the "How was this calculated?" lines name career conditions in words, not `c.` markers
(260). DEV `http://10.0.40.100:8090`, operator-reported `BUILD_ID` `1iy-ZuCMeAIY9W77kTRMT` (seen in the served HTML):
the three ISSUE-259 questions each showed the message and no answer; "players with 300 games and no premierships"
returned 33 players with "Condition: premierships exactly 0." and "Condition: games at least 300." and no `c.` marker;
console 0 errors, 0 warnings. **Limitation recorded:** the operator's `-Issue107Gate` failed with exit 21
(`x-afldb-build` missing; `AFLDB_TRACE_REQUESTS` absent), so live header parity was NOT verified. Full record:
`issues.md`, `issues/closed/AFLDB-ISSUE-259.md` §18, `issues/closed/AFLDB-ISSUE-260.md` §18, evidence
`issues/closed/AFLDB-ISSUE-259-260-evidence/`.

**AFLDB-ISSUE-255 resolved 2026-10-01** (Sonnet 5, implementation committed `f6d189d0`, operator-run
DEV acceptance) — the AFL API settle no longer records an unused emergency as a game played. The
authentic feed lists a named emergency who never took the field as a stats row (Brayden Fiorini,
`CD_I993799`, roster `EMERG`, 0% time on ground, every statistic 0); a roster-`EMERG` + TOG 0 + all-zero
row is now an observation-only `non_participant`, counted in `nonParticipantPlayerRows`. A fresh
authentic ISSUE-232 D1b on DEV (snapshot `afl-api-2026-2026-10-01-104329`) showed 218 matches / 10,029
player rows, source COMPLETE, `corroboratedForeignOwned` 218, `nonParticipantPlayerRows` 1,
`canonicalRowsInserted` 0, `canonicalRowsUpdated` 0, derived recompute 0/0, and was then confirmed by
the first systemd run (batch 95). The 36 `afltables`-owned foreign-owner `player_match_stats`
refusals are classified and expected, not failures. No PROD work. Full record: `issues.md`,
`issues/closed/AFLDB-ISSUE-255.md` §7.

**AFLDB-ISSUE-232 resolved 2026-10-01** (Sonnet 5, operator-run DEV acceptance at `f6d189d0`) — AFL API
operational wiring on DEV. After ISSUE-255 was deployed, §7 D1b (rerun), D2, D3, D4 and E all passed:
the first observed systemd match run exited 0 and committed import batch 95 (218 matches / 10,029
player rows, inserts 0, updates 0, refusals 36, failures 0); all 218 2026 matches stay
`afltables`-owned with no `afl_api` ownership and no Fiorini phantom row; the match timer is enabled
(next run Fri 2026-10-02 05:10:02 AEST, no catch-up firing); and the Brownlow timer is permanently
enabled with the environment gate closed, firing as a clean no-op at 2026-10-01 21:05:00 AEST with
every snapshot inventory and settle-batch count still 0. The operator's manual `/admin/current-season`
final check also PASSED (Match and player statistics: Batch 95 completed; Brownlow votes: No batch
recorded yet; no error or alert state). Not done: PROD (nothing
installed or authorised); the Brownlow count window stays closed (first full-chain firing at the 2027
count or a separately authorised rehearsal). ISSUE-233 is unaffected and stays open. Full record:
`issues.md`, `issues/closed/AFLDB-ISSUE-232.md` §7.

**AFLDB-ISSUE-237 resolved 2026-09-28** (implementation and DEV/afldb_test validation by Sonnet 5,
operator-run PROD promotions) — AFL API importer-created `unique` identities are now carried through
`db:test:rebuild` and database promotion. `afldb_test` (L3), DEV (L4, stamp `20260926-085511`) and
PROD (L5) all accepted. L5 needed three real attempts: `20260926-213225` refused on 92 candidate-only
manual player registrations PROD never held (opened AFLDB-ISSUE-251); `20260927-142540`, after
ISSUE-251's registration lifecycle passed in full, refused on a 2026 Brownlow lineage-dependency gap
(opened AFLDB-ISSUE-252); `20260928-101642`, after the ISSUE-252 fix was completed and deployed
(`8fc60404`), ran the full freeze-bound procedure end to end and PASSED — swap, post-promotion
replay (92 registrations resolved, AFL API invariant OK), current-season AFL Tables settle, SC3
idempotence and the scheduled settle-timer path all clean. `docs/deployment.md` §6a documentation
(S5) was verified current. Cleanup of the retained rollback database and the two failed candidates is
deliberately deferred per `docs/production-promotion.md` §10 and is not a resolution blocker.
AFLDB-ISSUE-251 and AFLDB-ISSUE-252 were subsequently resolved on 2026-09-28; those later
closures do not alter this ISSUE-237 historical record. Full record: `issues.md`, `issues/closed/AFLDB-ISSUE-237.md` §16.

**AFLDB-ISSUE-251 resolved 2026-09-28** (implementation, DB-free/rehearsal validation and
operator-run PROD execution) — a separately guarded, fail-closed PROD adoption mode was
added to the pinned ISSUE-224 registration tool, minting PROD-local `manual_admin_edit` tokens for
the exact approved 92-player set under a real enabled+enrolled PROD `super_admin`, with no
`afldb_test` token/actor crossing into PROD and no AFL API identity written. After DB-free (144/144)
and live `code_test_db` rehearsal (first-adoption apply, second-apply refusal, atomic-rollback
proof, retry/conflict cases, positive-shape census) validation and a closed MEDIUM review finding,
an operator-authorised one-time apply against real `afldb-prod` committed exactly 92 registrations
with zero conflict and zero AFL API identities, independently confirmed by census. A subsequent
fresh ISSUE-237 L5 attempt (stamp `20260927-142540`) then proved the intended AFLDB-ISSUE-242
convergence in full (92/92 planned `rebind B → A`) and correctly stopped instead on the unrelated,
separately opened AFLDB-ISSUE-252 — proving ISSUE-251 never masked a different failure. A third
fresh L5 (stamp `20260928-101642`), run after the ISSUE-252 fix deployed, passed end to end. All 13
runbook acceptance criteria are met. The retained failed candidates, the frozen rollback database
and the adoption backup remain retained evidence, cleanup deferred per
`docs/production-promotion.md` §10. AFLDB-ISSUE-252 was subsequently resolved on 2026-09-28;
that later closure does not alter this ISSUE-251 historical record. Full record: `issues.md`,
`issues/closed/AFLDB-ISSUE-251.md` §25.

**AFLDB-ISSUE-252 resolved 2026-09-28** (implementation committed/merged/deployed; confirming fresh
PROD L5) — the promotion source lifecycle now guarantees required rebuilt dependencies before
candidate restoration: `db:promotion:prepare-source` settles the retained current-season AFL
Tables/AFL API sources into `afldb_test` (ownership-preserving, hash-bound, no network), and
`db:promotion:check` mandates a target dependency manifest and ownership-parity gate at `--phase
source`, with a frozen re-check at prod `--phase pre-cutover` — no opt-out. Automated fail-closed
tests (`tests/db-promotion-check.test.ts`, 375/375) reproduce the missing-current-season condition
directly. A real fresh `afldb_test` rebuild/preparation rehearsal (89/89 rebuild checks, D-252-12
36-row classified refusal census, D-252-13 669/669 player-bridge) and the `code_test_db` isolated
rehearsal (A–V, 104 checks) both PASSED. Implementation committed (`4bda2107`, `8fc60404`), merged
and deployed to the PROD checkout. A completely fresh ISSUE-237 L5 PROD attempt (stamp
`20260928-101642`, new freeze/dump/candidate, not the failed `20260927-142540` candidate) then
passed the restored lineage gate through to a clean guarded swap with no candidate-specific manual
repair. Cleanup of the retained failed candidates and the frozen rollback database remains deferred
per `docs/production-promotion.md` §10. Full record: `issues.md`,
`issues/closed/AFLDB-ISSUE-252.md` §28.

**AFLDB-ISSUE-221 resolved 2026-09-18** (implemented 2026-09-17 by Fable 5.1; committed, merged
and DEV-verified 2026-09-18 by Sonnet 5) — Grid Solver draft-criteria review: honest "No data"
squares for an axis matching nobody, `draft_type_is` reads `draft_kind`, trade/free-agency rows
excluded from the three "drafted" builders, Gridley `fatherson` remapped to
`father_son_selection`, bounded numeric parameters with a per-square "Invalid value", the form
keyed by the board token so Reset resets, two stale `is_final` test oracles corrected. Committed
`f1a8daca`, merged to `main` at `159518ec`, deployed to DEV (`sync-dev.ps1 -RemoteRef main`,
revision `159518e`; found and corrected the DEV host's Git checkout sitting on a stale `dev`
branch, fast-forwarded 62 commits including AFLDB-ISSUE-220 and the NL-search chain
AFLDB-ISSUE-204–219 that had not reached DEV via this path before). All four required DEV browser
checks plus a valid non-draft answer check passed in a real authenticated `super_admin` session
via Playwright MCP (the operator signed in directly; the audience gate was not bypassed). The
reported symptom's root cause (draft-pick linkage, 5 of 6,810) is unfixed by design and now
tracked as **AFLDB-ISSUE-222** (draft runbook, awaiting operator approval). See `issues.md` for
the full record.

**AFLDB-ISSUE-222 resolved 2026-09-19** (executed across 2026-09-18/19 by Sonnet 5/Opus 5/Fable
5.1, operator-run on `afldb_test`/`afldb_dev`; deployed at commit `19eb40c0`) — the DraftGuru
person-page bridge is complete on both `afldb_test` (3,470 linked persons, 5,115/6,810 picks,
75.11%, Gridley-proven: `incorrect known answer` 99 → 37, zero draft-criterion cells) and
`afldb_dev` (real fail-closed `--link-only` import, committed and twice independently verified,
`summary_sha256 6a89a1ba…`, identical figures). Build `uKIChkbyo_-A3PMi40aFi` (1,516 static pages,
102/102 migrations); DEV health `status=ok, database=ok, latencyMs=16`. Browser-verified: the
AFLDB-ISSUE-221 Grid Solver draft-axis regression is resolved on DEV, `/admin/draft` renders all
6,810 selections, and both linked and unlinked draft selections render correctly. An operational
environment-truncation incident during DEV diagnosis (an unsafe inline PowerShell/SSH command
truncated `.env` to 17 bytes) was recorded transparently, fully recovered from live process state
plus freshly rotated credentials, and followed by a fresh independently verified DEV backup
(parity 9/9). The 1,587 remaining unmatched persons (AFLDB-ISSUE-224) and manual link-approval/
pick-creation mutation checks (out of scope) are **not** claimed resolved by this closure.
AFLDB-ISSUE-223/224/225 remain open, untouched. Full record: `AFLDB-ISSUE-222.md` §11.19.22,
`issues.md`'s *Resolution (2026-09-19)*.

**Fable code review outside NL search — 2026-09-17 (Fable 5.1, review and planning only).**
Reviewed with native inspection: authentication/session/middleware/capabilities and every auth
Server Action (no defect); the admin `*-actions.ts` files the 2026-09-15 mutation audit's glob did
not match, content publish/upload, settle trigger, and the public writers (no defect); all seven
route handlers and every `sql.unsafe` sink traced to a module allowlist (no defect); the tracked
deploy units, cluster entry point, both Caddyfiles, settle chain, build wrapper, DB clients
(**AFLDB-ISSUE-220** opened). Not reviewed: `deploy/sync-dev.ps1` body, `tools/maintenance/*`,
migrations, the admin action modules already covered by the 2026-09-15 audit,
`tools/email_intake/`, page components beyond their query allowlists, `src/db/queries/admin-users.ts`.
Residual, no new ID: `/api/admin/email-intake` still admits `contributor` senders — deferred under
resolved AFLDB-ISSUE-186 Phase B. No project-wide PASS is claimed.

**Fable NL code review — FINAL: PASS (2026-09-17, Fable 5.1, operator-validated on streamanator).**
Lineage: Stage 1 found eight defects (F1–F8) → Stage 2 confirmed them as AFLDB-ISSUE-187..192,
hardening added 193..196, the corpus audit's 40 genuine fail-open rows became 197 (all resolved
2026-09-15/16) → the 168 stale `AMBIGUITY_NOT_DETECTED` expectations (112 team-streak + 56
coach-record, plus 5 Ablett = 173) were corrected under AFLDB-ISSUE-199, then V3/V4/V5 under
201/204/205 → 198..219 hardened further to parser v66. This acceptance pass re-verified every
187..197 fix in the current tree (not from issue status), confirmed the AFLDB-ISSUE-197 family
contract (complete candidates via `resolvePlayerFamily`, 2–12 ranks, >12 declines and is
reachable, direct resolution distinct), and reran the frozen V5 corpus parse+execute on v66:
11997/0/3. The three failures (`verified_finals_without_premiership`, rows 41–43) were adjudicated
`STALE/INVALID EXPECTATION` from current canonical data (Dane Rampe and Nick Dal Santo genuinely
tied at 24 finals, 0 premierships, nobody else at 24) and corrected V5 → V6 by the new fail-closed
script `tools/nl/fix-stale-finals-without-premiership-tie.ts` (3/3 targets, 0 non-targets).
**Final V6: 12000/12000 clean / 0 soft / 0 failed / 0 errors.** V6 is now the stable baseline. No
new issue opened; no production code changed. Volatility note: Rampe is active mid-2026-finals, so
another final would re-stale rows 41–43 honestly (see the script header / `issues.md` ISSUE-219).

**AFLDB-ISSUE-219 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) —
cross-family NL defect: a plural club/venue alias already ending in "s" takes a bare trailing
apostrophe for its possessive ("Bombers'", "Dogs'", "Lions'", the AFLDB-ISSUE-214 §10c residual's
"Suns'"/"Pies'"/"Bulldogs'"), which `canonicalise()`'s existing `'s\b` strip
(`src/search/nl/vocab.ts`) never matched (it requires a literal "s" after the apostrophe).
Club/venue matching itself already resolved these aliases correctly via word-boundary regexes;
only the final leftover-token comparison in `parseNlQuestion` (`src/search/nl/parser.ts`) ever
disagreed, because `meaningfulTokens`' whitespace split kept the apostrophe attached to the word
while the matched/consumed span did not. Confirmed a shared `canonicalise()` defect, not a
per-builder one, by tracing `tools/nl/generate-exploratory-corpus-v2.mjs`'s `possessive()` helper
(line 178) across five families: `team_match_result`, `team_checkpoint_collision`,
`q3_comeback_near_miss`, `club_season_rank` (the ISSUE-214 residual) and `team_streak`. Fixed with
one new generic trailing-apostrophe strip in `canonicalise()`, mirroring the existing `'s` rule
rather than special-casing any club — no apostrophe made globally ignorable (only a trailing one
immediately before whitespace/end-of-string; a mid-word apostrophe like `o'brien` is untouched).
`PARSER_VERSION` 65 → 66 (baseline corrected during reconciliation with `AFLDB-ISSUE-218`, which
already holds 64 → 65 on `dev`). `AFLDB-ISSUE-218` (below) **independently found and deliberately
deferred the identical defect** for its own `team_match_result/0` cluster (56 rows,
"Bombers'"/"Dogs'"/"Brisbane Lions'"), naming this exact cross-family issue as its recorded
follow-up candidate — confirming this issue's root-cause finding a second, independent way,
alongside AFLDB-ISSUE-214 §10c. Local: `tests/nl-parser.test.ts` **605/605**, broader gates
**402/402**, `typecheck` clean. **Host validation (streamanator):** no established mechanism
existed to transport uncommitted code to a host, so a temporary, isolated `git worktree`
(`/home/arm/nl-issue219-validation`, off `origin/dev` at `a98c3e42`) was created and a `git diff`
patch applied — a clean `git apply --check` itself served as the identity proof;
`/home/arm/projects/afldb` and the retained git stash were never touched, and the temp worktree
was removed after validation. Host suites reconfirmed 605/605 + 402/402 + clean typecheck.
Exploratory V2 (29,030 rows, the AFLDB-ISSUE-218-corrected corpus) moved **20512 → 20876 clean**
(+364 / -364 soft / 0 failed), reconciling exactly across five families (`club_season_rank` 210,
`team_streak` 75, `team_match_result` 56, `team_checkpoint_collision` 16,
`q3_comeback_near_miss` 7) — every one of the 364 improved rows confirmed to carry a
trailing-apostrophe alias, zero that don't. The frozen V1/"V5" corpus's three failing rows (a
stale `verified_finals_without_premiership` fact check, Nick Dal Santo → Dane Rampe tie count)
were proven via a decisive v65-vs-v66 control against the same current database to be pre-existing
data drift, **not** a regression — flagged as a stale-corpus-expectation candidate, not opened as
its own issue in this closeout. See `issues.md` and `AFLDB-ISSUE-219.md` §14 for the full record.

**AFLDB-ISSUE-218 resolved 2026-09-17** (Sonnet 5, operator-validated on
streamanator across two host-validation rounds) — `team_match_result/1` (522
rows, "at V, find the widest X win/loss to Y...") and `/2` (569 rows, "by how
much did X lose to Y in their most lopsided meeting...") shared one
wrapper-vocabulary-only mechanism (both already extracted clubs/direction
correctly); fixed with additive vocabulary only (`widest` in `AGG_WORDS`, a
leading scope-clause request-verb strip widened to `at` as well as `for`,
verb forms `lose`/`lost`/`beat` in `TEAM_METRIC_WORDS`, two narrowly-gated
wrapper consumers for "how much"/"lopsided meeting"), no grain-election or
club-role logic touched, `PARSER_VERSION` 64 → 65. Round-1 host validation
(commit `5bcc957`) found V5 green and `/1` fully cleared (522→0), but exposed
`/2` moving from an honest soft decline into a 569-row HARD FAILURE — worse
than the pre-fix state — so the issue was reopened rather than closed.
Re-investigation traced production SQL (`src/db/queries/nl/team-match.ts`'s
clubFor-relative `win_margin`/`loss_margin`) and the parser's pre-existing,
uniformly-applied `clubFor`=subject convention against every pre-issue
directional test, then found and confirmed (empirically, 0 mismatches across
every affected row) a genuine, isolated **exploratory V2 generator/oracle
defect**: `team_match_result`'s templates 0/1/3 all keep club `c` as the
sentence's grammatical subject, but template 2 alone renders `o` as subject
and `c` as object without a corresponding fix to its expected `club`/
`opponent`/`metric` triple. Parser v65 was confirmed correct and untouched;
only the generator's template-2 expectation construction was corrected
(commit `6ed227d`), `PARSER_VERSION` staying at 65 (corpus-only correction).
Round-2 host validation confirmed **0 failed**: frozen V5 stayed
12000/12000/0/0; exploratory V2 moved v64 baseline (19421 clean/8109
soft/0 failed) → v65-corrected (20512 clean/7018 soft/0 failed), net
**+1091 clean/-1091 soft/0 failed**, reconciling exactly to `522 + 569 =
1091`; a determinism/isolation diff confirmed 0 question-text/row-id changes
anywhere in the 29,030-row corpus, with all 569 changed rows confined to
`team_match_result/2`'s own expectation columns. `team_match_result/0` (56
rows, "Bombers'"/"Dogs'"/"Brisbane Lions'" possessive aliases) remains
unchanged at 56 honest declines throughout both rounds — a distinct,
already-known trailing-apostrophe plural possessive-alias defect (the same
mechanism AFLDB-ISSUE-214 already found and left unfixed for
`club_season_rank`), deliberately deferred as a future cross-family issue
candidate, not opened as its own tracked issue in this closeout.
Implementation commits `5bcc957` (parser) and `6ed227d` (exploratory oracle
correction) on `sonnet/issue-218-team-match-result-phrasing`, unmerged.
Local: `tests/nl-parser.test.ts` 595/595, broader gates (`nl-regression-corpus`
163/163, `nl-semantic-mapping` 174/174, `nl-stress-corpus` 65/65 = 402/402),
`typecheck` clean. See `issues.md` and `AFLDB-ISSUE-218.md` for the full
record.

**AFLDB-ISSUE-217 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) —
`player_game_single`'s three large exploratory clusters (`/0` 423 rows "biggest `<metric>` haul in one
match", `/4` 422 rows "peak single-game `<metric>`", `/3` 409 rows "which match saw `<player>` collect
the most `<metric>`", combined 1254 rows) share ONE root mechanism, not three, and it is NOT grain/mode
misrouting — a named player's per-game stat already defaults correctly to `grain='player_game',
mode='single'`. The defect was in `candidatePlayerSpan` (`src/search/nl/parser.ts`): it greedily takes
the first four remaining non-stopword alpha tokens with no notion of "stop at a non-name word", so
unconsumed wrapper vocabulary ("haul", "peak"/"single-game", "match"/"saw"/"collect" — none had any
vocabulary entry) got swept into the player-name candidate alongside the real name (e.g. "dustin martin
haul"), which then failed player resolution outright — the polluted span is exactly the reported
`unsupported_term`. The adjacent `player_game_scope_collision/3` (555 rows, "single-match `<metric>`
record for...") was inspected and confirmed to share the identical mechanism (bare "single-match" always
sat immediately before the player name) and was included. Fixed with one generic `IN_ONE_GAME` extension
(bare "single-game"/"single-match" adjective, not only "in ... game/match") plus three new gated
wrapper-word consumers (`WHICH_MATCH_SAW_RE`, `PLAYER_GAME_SINGLE_HAUL_RE`, `PLAYER_GAME_SINGLE_PEAK_RE`)
— no player, club, venue, or metric special-cased. `PARSER_VERSION` 63 → 64. Implementation commit
`879b0e1` ("Fix player game single match phrasing"),
`sonnet/issue-217-player-game-single-phrasing`, unmerged. Local: `tests/nl-parser.test.ts` 575/575 (554 +
21 new), broader gates (`nl-regression-corpus` 163/163, `nl-semantic-mapping` 174/174, `nl-stress-corpus`
65/65 = 402/402), `typecheck` clean. Host validation (streamanator, commit `879b0e1`): frozen V5 stayed
**12000/12000/0/0**; exploratory V2 moved **17612 → 19421 clean (+1809)**, **9918 → 8109 soft (-1809)**,
0 failed throughout. All four target clusters fully cleared: `player_game_single/0` 423 → 0, `/4` 422 →
0, `/3` 409 → 0, `player_game_scope_collision/3` 555 → 0. A direct 29,030-row plan-level comparison (v63
vs. v64) found exactly **1809 changed plans, 0 missing rows**, reconciling exactly to the four target
clusters, zero unrelated movement. A separate, pre-existing `WRONG_PLAYER` scorer-identity artifact (the
already-tracked Gary Ablett Jnr/Snr display-name mismatch from AFLDB-ISSUE-206/210) remains present
across several rows in the affected template families, confirmed independent of this fix and left
untouched. See `issues.md` and `AFLDB-ISSUE-217.md` for the full record.

**AFLDB-ISSUE-216 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) —
`player_season_leaderboard`'s two exploratory clusters (`/0` 576 rows "posted the highest season tally
of `<stat>` for `<club>` `<time>`", `/3` 559 rows "the best seasonal `<stat>` total `<time>`") do NOT
share one root mechanism: both left "posted"/"season"/"tally"/"seasonal" unconsumed as leftover wrapper
vocabulary (shared gap), but `/3` additionally carried an independent grain-election defect — its own
"total" collided with the generic `AGGREGATE_TOTAL_WORDS` scoped-running-total cue and silently
misrouted the unnamed-player question to `player_game`/`sum` instead of `player_season`. Fixed with
three new gated vocabulary entries (`PLAYER_SEASON_LEADERBOARD_TALLY_RE`,
`PLAYER_SEASON_LEADERBOARD_SEASONAL_RE`, `PLAYER_SEASON_LEADERBOARD_POSTED_RE`, all gated on an actual
player-stat `METRIC_WORDS` match) plus a narrow `playerSeasonLeaderboardCue` override on the
`aggregateTotal` grain-election guard — no club, player, or metric special-cased. `PARSER_VERSION` 62 →
63. Implementation commit `8de4a96` ("Fix player season leaderboard phrasing"),
`sonnet/issue-216-player-season-leaderboard-phrasing`, unmerged. Local: `tests/nl-parser.test.ts`
554/554 (541 + 13 new), broader gates (`nl-regression-corpus` 163/163, `nl-semantic-mapping` 174/174,
`nl-stress-corpus` 65/65 = 402/402), `typecheck` clean. Host validation (streamanator, commit `8de4a96`):
frozen V5 stayed **12000/12000/0/0**; exploratory V2 moved **16477 → 17612 clean (+1135)**, **11053 →
9918 soft (-1135)**, 0 failed throughout. Both target clusters fully cleared: `/0` 576 → 0, `/3` 559 → 0.
A direct 29,030-row plan-level comparison (v62 vs. v63) found exactly **1135 changed plans, 0 missing
rows**, all in the target family, zero unrelated movement. See `issues.md` and `AFLDB-ISSUE-216.md` for
the full record.

**AFLDB-ISSUE-215 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator, two
host-validation rounds) — `career_numeric_binding`'s two exploratory clusters (`/3` 700 rows "for CLUB,
find players with A plus B", `/2` 552 rows "who has the most career S among players with A and B") do
NOT share one root mechanism — `/3` is a pure wrapper-vocabulary gap ("find" behind a leading "for"
clause, "plus" as an unrecognised conjunction); `/2` shares that gap ("among") plus an independent,
genuine predicate-loss defect (a stat word's earliest occurrence was the only one ever tried, silently
dropping a same-column condition stated after the ranking mention). Both fixed; `PARSER_VERSION` 61 →
62. Round-1 host validation (commit `5eca839`): frozen V5 stayed 12000/12000/0/0; `/2` fully fixed
(552 → 0); `/3` split into 491 `coverage_unavailable` and 209 `unsupported_term: plus`. The 491 were
investigated and classified a **legitimate, currently-real coverage limitation, not a parser/guard
defect** — `conditionSql` (`src/db/queries/nl/player-career.ts`) has no per-club SQL path for any
career condition column except `games`, and `validatePlan`'s club-scoped-career-condition guard
(`src/search/nl/plan.ts`) correctly fails closed rather than silently answer with a whole-career total
— guard NOT weakened, no corpus/scorer file touched, recorded as a future SQL-compiler capability
candidate (see `AFLDB-ISSUE-215.md` §11, §15). The 209 were a second, residual "plus" ownership gap in
`extractCareerConditions` — a 20-character clause-boundary lookback too short for a long comparator
phrase like "no more than " (widened to 40, proven safe by a new three-clause regression control), and
the "no X" negative-condition loop never checking for a neighbouring "plus" — fixed the same session
under the same `PARSER_VERSION` 62 (a correction, not a new semantic feature). Round-2 host validation
(commit `6a341fd`) confirmed the fix: frozen V5 stayed 12000/12000/0/0 again; `career_numeric_binding/3`
final triage is 700 `coverage_unavailable` / 0 `unsupported_term` — **all 700 `/3` rows now produce
structurally valid plans**; a direct round-1-vs-round-2 plan comparison found exactly 209 changed
plans, 0 missing, zero unrelated movement. Implementation commits `5eca839` and `6a341fd` on
`sonnet/issue-215-career-numeric-binding-phrasing`, unmerged. Local: `tests/nl-parser.test.ts`
540/540, broader gates (`nl-regression-corpus` 163/163, `nl-semantic-mapping` 174/174,
`nl-stress-corpus` 65/65 = 402/402), `typecheck` clean. See `issues.md` and `AFLDB-ISSUE-215.md` for
the full record.

**AFLDB-ISSUE-214 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — `club_season_rank`'s "what season had the highest/lowest `<metric>`" and "`<club>`'s highest/lowest seasonal `<metric>`" phrasings declined with `unsupported_term: season`/`seasonal`: neither word was ever consumed by any extractor, so it survived as a leftover token even when the surrounding club-season construction was otherwise fully understood. Confirmed both failing clusters (`club_season_rank/1`, `club_season_rank/3`) are two English phrasings of one already-supported semantic construction, not two mechanisms. Fixed with two new gated vocabulary entries (`CLUB_SEASON_RANK_SEASON_CUE_RE`, `CLUB_SEASON_SEASONAL_ADJECTIVE_RE`) folded into the existing `clubSeasonCuePresent`/single-season-guard logic — no club name, corpus ID, or exact sample string special-cased. `PARSER_VERSION` 60 → 61. Implementation commit `731edd8` on `sonnet/issue-214-club-season-rank-phrasing`, unmerged. Local: `tests/nl-parser.test.ts` 519/519, broader gates (`nl-regression-corpus` 163/163, `nl-semantic-mapping` 174/174, `nl-stress-corpus` 65/65 = 402/402), `typecheck` clean. Operator-validated on streamanator: frozen V5 stayed **12000/12000/0/0**; exploratory V2 moved **14879 → 15925 clean (+1046)**, **12651 → 11605 soft (-1046)**, 0 failed throughout. The full `club_season_rank/3` cluster (642 rows) cleared; 404 of 614 `club_season_rank/1` rows cleared, 210 remaining on a separate, pre-existing possessive-club-alias defect (`Suns'`/`Pies'`/`Bulldogs'`) deliberately **not folded into this issue and not opened as its own tracked issue** — recorded as a follow-up candidate only. A direct 29,030-row plan-level comparison (v60 vs. v61) found exactly **1046 changed plans, 0 missing rows**, all in the target family, zero unrelated movement. See `issues.md` and `AFLDB-ISSUE-214.md` for the full record.

**AFLDB-ISSUE-213 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — a pre-existing
`extractClubs` defect (`src/search/nl/parser.ts`) exposed by, not caused by, ISSUE-212's corrected
exploratory V2 oracle. `phrasePosition`/`phraseEnd` re-found a matched club's position with a bare
first-match `\b<name>\b` search of the whole original question, so a shorter club's name embedded,
word-bounded, inside a longer club's own name ("Melbourne" inside "North Melbourne") silently rebound
onto the longer club's own span instead of the real, later standalone mention — the computed gap
between the two clubs came out empty, the `versus`/`vs`/`v` separator was never recognised, and
`scope.matchup` never formed for wording like "North Melbourne versus Melbourne" (confirmed row
`#20609919`), falling back to directional `clubFor`/`clubAgainst` instead. Fixed with a new
`firstUnclaimedOccurrence` helper that excludes spans an earlier club match in the same call has
already claimed, generic across any overlapping-name pair — no club special-cased. `PARSER_VERSION`
59 → 60. `Port Adelaide`/`Adelaide` and `Greater Western Sydney`/`Sydney` confirmed to reproduce the
identical mechanism, first by source trace and then empirically by the host plan diff (see below). One
pre-existing negative-control test needed a fixture-only swap (`sydney derby` → `western derby`) after
this issue's new `Sydney`/`Melbourne`/`North Melbourne` fixtures invalidated its "absent club"
assumption — not a parser regression, no production code touched for that correction. Implementation
commit `4f0be951` on `sonnet/issue-213-overlapping-club-matchup`, unmerged. Local: `tests/nl-parser.test.ts`
509/509, broader gates (`nl-regression-corpus` 163/163, `nl-semantic-mapping` 174/174, `nl-stress-corpus`
65/65 = 402/402), `typecheck` clean. Operator-validated on streamanator: frozen V5 stayed
**12000/12000/0/0**; exploratory V2 moved **1 → 0** hard failures (row `#20609919` confirmed clean); a
direct 29,030-row plan-level reconciliation (v59 vs. v60) found **exactly 1 changed plan**, the known
row, with **zero unrelated changes** elsewhere in the corpus. See `issues.md` and
`AFLDB-ISSUE-213.md` for the full record.

**AFLDB-ISSUE-212 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — follow-on item
(4) of `AFLDB-ISSUE-206.md`'s six proposals: corrected the exploratory NL corpus/scorer's three
confirmed V1 oracle defects (496-row symmetric "versus" matchup, 283-row achievement-summary
aggregation, 351-row Gary Ablett Jnr/Snr identity, all at parser v54) in a new versioned
`tools/nl/generate-exploratory-corpus-v2.mjs` + `tools/nl/corpus.ts` scorer contract. Not a
parser-feature issue: `PARSER_VERSION` unchanged at 59, no `src/search/nl/{parser,vocab,
semantic-intents}.ts` file touched. Operator-validated on streamanator: V2 (29,030 rows, seed
`2060542026`, SHA256 `bb75e4b5067942117c60f8eab6cfd01de4d8fc1e0c4fee07e10650fae97edb4a`, deterministic
replay confirmed, V5 exact/normalized overlap 0/0, 1,500 audit-required) scored against parser v59:
**27530 scored / 14878 clean / 12651 soft / 1 failed**; the frozen V1 12,000-row corpus stayed
**12000/12000/0/0** under the updated scorer, no regression. A same-corpus, same-parser (v59)
reconciliation of the pre- vs. post-ISSUE-212 oracle found **1308 old false hard failures removed**
(545 `team_match_result` matchup + 320 `achievement_summary` aggregation + 443 player-identity, split
225 Gary Ablett Snr / 218 Jnr) **and 1 newly exposed genuine hard failure** — net failed count change
-1307, not "1307 fixed". The v54→v59 counts (496→545, 283→320, 351→443) grew because
AFLDB-ISSUE-207..211 landed in between and let more previously-declined rows reach a scored plan for
the first time, exposing more instances of the same three pre-existing defects — none of those five
fixes touched matchup detection, achievement aggregation, or player-identity resolution themselves.
The one newly exposed hard failure (row #20609919, "... margin for North Melbourne versus Melbourne at
Adelaide Oval ...") is a genuine, distinct, pre-existing `extractClubs` defect (`phrasePosition`/
`phraseEnd` re-finding a club's position via a bare word-boundary search of the whole original text can
find a shorter club's name embedded inside a longer club's own name, here "Melbourne" inside "North
Melbourne", instead of the real second mention, silently preventing the unordered matchup from
forming) — confirmed identical parser plan in V1 and V2, not a corpus/scorer defect and not introduced
by this issue, deliberately left unfixed and **not opened as its own tracked issue in this closeout**.
Two structurally similar pairs (`Port Adelaide`/`Adelaide`, `Greater Western Sydney`/`Sydney`) are
**unreproduced hypotheses only** — the actual host run found exactly one failure total, so neither is
confirmed to have been drawn by this seed or to reproduce the mechanism. See `issues.md` and
`AFLDB-ISSUE-212.md` (§6a, §8) for the full record.

**AFLDB-ISSUE-211 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — follow-on item
(5) of `AFLDB-ISSUE-206.md`'s six proposals, the largest single unimplemented soft-decline vocabulary
family it found: `extractSeasons` (`src/search/nl/parser.ts`, `src/search/nl/vocab.ts` new `AFTER_RE`)
had no form for `after YEAR` as an exclusive lower season bound (`scope.seasonMin = YEAR + 1`,
deliberately distinct from inclusive `since YEAR`). Fix extends the existing single season extractor
with one new anchored regex and one new `else` branch alongside the existing `since` check — no second
parser, no vocabulary/stage reordering, `after the siren`/`AFTER_THE_ACHIEVEMENT` unaffected because
neither ever puts a literal year immediately after the word. `PARSER_VERSION` 58 → 59. Implementation
commit `c113e6a`, unmerged on `sonnet/issue-211-after-year-season-bound`. Operator-validated on
streamanator: frozen V5 stable-corpus rerun stayed **12000/12000/0/0**, and a direct structured-plan diff
of the retained ISSUE-206 29,030-row exploratory corpus (pre-fix v58 vs post-fix v59) found exactly
**1406 changed plans**, all genuine `after <4-digit year>` wording, 0 unrelated — reconciled in full:
**1262 `soft_fail→clean`** (the genuine usability gain), **136 `soft_fail→soft_fail`** (95
`career_boundary` / 23 `head_to_head` / 18 `unsupported_composition`, correctly declined under the
existing compiler/coverage contract once the temporal clause parses), **8 `audit→audit`**
(`malformed_input` rows, intentionally still manual-audit by corpus design), and **0 `soft_fail→fail`**.
118 changed rows compose `after the siren` with a separate genuine `after YEAR` clause; both meanings
coexist correctly in every one. See `issues.md` and `AFLDB-ISSUE-211.md` for the full record.

**AFLDB-ISSUE-210 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — follow-on item
(6) of `AFLDB-ISSUE-206.md`'s six proposals: a leading imperative/request-wrapper verb ("find", bare
"show", "list", "give me" — "show me"/"tell me" already worked) survived `canonicalise()`
(`src/search/nl/vocab.ts`) as an unmatched leftover token and tripped the generic decline gate even when
the rest of the question was otherwise fully supported — the dominant soft-decline mechanism ISSUE-206
found (~10,000+ of 15,275 soft-decline exploratory rows). Fix: one new anchored
`LEADING_REQUEST_PREFIX_RE`, consumed at most once at the very start of the string; `find` carries a
negative lookahead protecting the pre-existing "find the (big) sticks" goals idiom, the one real
vocabulary collision found. `PARSER_VERSION` 57→58. Implementation commit `8324d2a`, unmerged on
`sonnet/issue-210-imperative-nl-phrasing`. Operator-validated on streamanator: frozen V5 stable-corpus
rerun stayed **12000/12000/0/0**, and a direct structured-plan diff of the retained ISSUE-206 29,030-row
exploratory corpus (pre-fix v57 vs post-fix v58) found exactly **1408 changed plans**
(`663 find / 378 list / 367 show / 0 other`, zero unrelated wording family), reconciled in full: **1288
`soft_fail→clean`** (the genuine usability gain), **48 `soft_fail→fail`** (all `show`-prefixed
`player_game_single` rows, all the pre-existing Gary Ablett Jnr/Snr canonical-display-name scorer
artifact from `AFLDB-ISSUE-206.md`, exposed by new reachability rather than caused by this fix), and
**72 audit-required `decline→success`** ("List sons of X with Y" `relationship_conditions` rows, now
valid typed `player_career` plans but still intentionally manual-audit by corpus design). See
`issues.md` and `AFLDB-ISSUE-210.md` for the full record.

**AFLDB-ISSUE-209 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — follow-on item
(3) of `AFLDB-ISSUE-206.md`'s six proposals: `extractHeadToHeadCue`'s `compare_wins` family
(`src/search/nl/semantic-intents.ts`) recognized only past-tense "won more", so present-tense "has/have
more wins ... head to head" fell through to the generic `head to head` → `record` cue and answered with
a full record instead of naming the leader. Fix added a dedicated "has/have (more|the most) wins head to
head" pattern plus a trailing-"head to head" extension to the existing "won more" pattern, both checked
before the generic record families; `PARSER_VERSION` 56→57. Operator-validated on streamanator (commit
`f2e067f`): frozen V5 stable-corpus rerun stayed **12000/12000/0/0**, and a direct structured-plan diff
of the retained ISSUE-206 29,030-row exploratory corpus (pre-fix v56 vs post-fix v57) found exactly
**199 changed plans**, all `headToHead.kind: record→compare_wins` in the same wording family — 173
matching ISSUE-206's direct estimate, plus 26 that also carried a mechanically-linked `between YEAR and
YEAR` season/havingClause correction (the same atomic "wins" consumption fix incidentally resolved a
misread grouped-threshold on those 26 rows) — zero collateral movement elsewhere, so **the validated
affected surface is 199 rows, not 173**. Implementation commit `f2e067f`, unmerged on
`sonnet/issue-209-head-to-head-more-wins`. Two adjacent wordings ("has more wins between A/B", "has more
wins against the other") investigated and deliberately not fixed — claimed earlier by
`extractClubSeasonMetric`'s "most wins" club_season ranking cue, a different mechanism. See `issues.md`
and `AFLDB-ISSUE-209.md` for the full record.

**AFLDB-ISSUE-208 resolved 2026-09-17** (Sonnet 5, operator-validated on streamanator) — follow-on item
(2) of `AFLDB-ISSUE-206.md`'s six proposals: `extractClubs`'s club-role lookback (`src/search/nl/parser.ts`)
tested "does an against-like token exist anywhere in a fixed 20-character window", not "what is the
nearest preposition governing this club" — losing the subject club on 134 after-siren rows ("to win FOR
Club" mis-read the earlier, unrelated "to" as governing) and 117 leading-opponent/checkpoint rows
("Against Opponent, ... Subject's ..." let the opponent's own stripped-out "against" leak into the
subject's shrunken window). One shared mechanism, fixed by a `nearestGoverningPreposition` helper
anchored to the immediately-preceding token, checked against the pre-mutation text — no vocabulary
added, no stage reordered, `scope.matchup` unchanged; `PARSER_VERSION` 55→56. Operator-validated on
streamanator (commit `70b72df`): frozen V5 stable-corpus rerun stayed **12000/12000/0/0**, and a direct
structured-plan diff of the retained ISSUE-206 29,030-row exploratory corpus (pre-fix v55 vs post-fix
v56) found exactly **251 changed plans** (134 `after_siren` + 117 `team_checkpoint_collision`), zero
collateral movement elsewhere, clearing all 251 confirmed parser-defect hard failures (aggregate hard
failures 1381→1130, clean +251, soft unchanged). Implementation commit `70b72df`, unmerged on
`sonnet/issue-208-club-role-ownership`. One structurally similar, undisturbed finding in
`assignCrossDomainClubs` (its own fixed-window `AGAINST_PREPOSITION.test` for the played/coached
opponent refusal) documented but not fixed and not yet opened as its own issue. See `issues.md` and
`AFLDB-ISSUE-208.md` for the full record.

**AFLDB-ISSUE-207 resolved 2026-09-16** (Sonnet 5, operator-validated on streamanator) — follow-on item
(1) of `AFLDB-ISSUE-206.md`'s six proposals, the highest-severity finding (281 silently-wrong-answer
corpus rows). Root cause: `extractHavingClause`'s operator search used an unbounded `±20`-character
window that could reach past a grouped wins/losses/draws/games threshold's own count into an adjacent
margin clause's operator word, and separately let `COMPARE_OP_WORDS`' fixed vocabulary order outrank the
clause's own, correctly-positioned operator word. Both effects silently swapped the two clauses'
comparators while still passing `validatePlan`. Fix bounded the operator search to
`window.slice(0, countEnd)` — no vocabulary added, no stage reordered, no default changed;
`PARSER_VERSION` 54→55. Operator-validated on streamanator: frozen V5 stable-corpus rerun stayed
**12000/12000/0/0**, and a direct structured-plan diff of the retained ISSUE-206 29,030-row exploratory
corpus (pre-fix v54 vs post-fix v55) found exactly **281 changed plans**, all
`havingClause.op: gt->gte` paired with `matchFilter.op: gte->gt` (the intended pairing), zero collateral
movement elsewhere in the corpus. Implementation commit `4ecdd77a`, unmerged on
`sonnet/issue-207-numeric-operator-ownership`. One pre-existing, out-of-scope gap documented but not
fixed: `extractMatchFilter` has no form for trailing "by 50 or more/fewer points". See `issues.md` and
`AFLDB-ISSUE-207.md` for the full record.

**AFLDB-ISSUE-206 resolved 2026-09-16** (Sonnet 5) — final triage of the 29,030-row independent V1
exploratory corpus, re-verified against current branch source rather than taken on the first-pass
(Codex) scorer labels. All 1,381 hard failures reconcile exactly to five root causes: 496
(`team_match_result` symmetric "versus", confirmed corpus-oracle defect — parser already emits a correct
`matchup` scope, template wrongly asserts directional clubs), 283 (`achievement_summary` aggregation,
confirmed corpus/scorer defect — the grain's executor never reads `plan.agg`), 351 (Gary Ablett Jnr/Snr,
confirmed scorer defect — player ID resolves correctly, only display-name string comparison is wrong),
and **251 genuine parser defects** (`after_siren`/`team_checkpoint_collision` clubFor loss, one shared
root mechanism: `AGAINST_PREPOSITION`'s 20-character lookback window in `extractClubs` is not anchored to
the nearest preposition). Two further clusters are silent wrong answers scored `clean`, outside the
1,381: 281 rows (numeric operator ownership crossing between `extractHavingClause`/`extractMatchFilter`,
confirmed parser defect, highest severity) and 173 rows (head-to-head "has more wins" phrasing gap).
Soft declines (15,275) trace mainly to one mechanism (imperative/structural phrasing vocabulary gap,
~10,000+ rows) plus `after YEAR` (unimplemented, ~1,200+ rows) and a deliberate `career_boundary`
compiler restriction (907 rows, fails closed by design). Six follow-on proposals recorded in priority
order in `AFLDB-ISSUE-206.md`, no ISSUE-207+ IDs assigned yet. No parser behaviour, `PARSER_VERSION`, V5
row or production data changed. See `issues.md` and `AFLDB-ISSUE-206.md` for the full record.

**AFLDB-ISSUE-205 resolved 2026-09-16** (Sonnet 5, operator-validated) — AFLDB-ISSUE-200's
`TAXONOMY_DRIFT` disposition for the remaining 70 `WRONG_FAILURE_REASON` rows was incomplete: two
unrelated families, not one benign label mismatch. **Family A (42 rows,** "biggest three quarter time
comeback" **):** genuine parser-ordering defect — `extractScoreCheckpoint` consumed "three quarter time"
before `extractTeamMetric` could match the already-implemented `q3_deficit_overcome` team_match metric.
Fix required two rounds (a `'3QT'`-entry guard, then a `'QT'`-entry follow-up after the operator's first
run found the first guard incomplete — a second, independent fall-through matching the same nested
substring); `PARSER_VERSION` 53→54. **Family B (28 rows,** "comeback from quarter time" **):** genuine
Q1/quarter-time feature gap (no `q1_deficit_overcome` metric exists, and none was added — deliberate
scope decision); stays declined, `expected_failure_reason` corrected `unsupported_topic`→
`unsupported_term`. Two correction-tool validation defects found and fixed along the way (both
test/tooling-only, no parser/runtime defect): an over-broad candidacy design gated on old-state
(`decline`+`unsupported_topic`) before question-text identity, wrongly flagging an unrelated live
fantasy-score row; and a DB-free test fixture that leaked a filler-row default
(`expected_grain='player_game'`) into synthetic decline rows. Operator-validated end-to-end: 446/446
parser tests, 35/35 integration tests (incl. new `q3_deficit_overcome` SQL coverage), clean
`tsc --noEmit`, 15/15 correction-tool tests, real V4→V5 correction (70/70 targets, 0 non-targets
touched, independently re-verified), parser-v54 rerun against V5 = **12000 scored / 12000 clean / 0 soft
/ 0 failed**. V5 is now the stable regression-corpus baseline, superseding V4. Stage 2 remains closed,
not reopened. See `issues.md` and `AFLDB-ISSUE-205.md` §11 for the full record.

**AFLDB-ISSUE-204 resolved 2026-09-16** (Sonnet 5, operator-validated) — guarded V3→V4 corpus
correction for the 180-row `coverage_unavailable|fgf` stale pre-1965/1987 finals-stat coverage
expectations (disposals/marks/tackles, finals/Grand Finals, seasons 1897-1926). Three fail-closed
correction-tool defects were found and fixed across three operator runs before the fourth completed
end-to-end: (1) an over-broad category+template-only selector matched 996 rows, not 180, retargeted to
the row's full structural signature; (2) a singular-only `/\bfinal\b/i` question-text check rejected
real plural "finals" wording, widened to `/\bfinals?\b/i`; (3) a season-shape gate wrongly required
`expected_season_from === expected_season_to` for every row, fixed by branching on
`expected_match_type` (Grand Final rows carry a blank `expected_season_to`). All three were
correction-tool-only; no parser/runtime defect was found. Final run: 180/180 targets corrected, 0
non-targets touched, parser-v53 rerun against V4 = 12000 scored / 11930 clean / 70 soft / 0 failed
(down from 250 soft), the 180 `UNEXPECTED_DECLINE` rows removed with zero new soft rows and zero
semantic changes among the rest; `PARSER_VERSION` unchanged at 53. See `issues.md` and
`AFLDB-ISSUE-204.md` §11 for the full record. AFLDB-ISSUE-187..204 all now resolved. **Stage 2 (the
AFLDB-ISSUE-200 corpus audit and its four follow-ons) is now closed**; the remaining 70
`WRONG_FAILURE_REASON` taxonomy-drift rows are a separate, not-yet-opened cleanup/audit task (see
Stage 2 next task below).

AFLDB-ISSUE-202 (GWS club identity leaks into unsupported-term detection) resolved 2026-09-16
(Sonnet 5, operator-validated) -- see `issues.md` for the full record, including the additional 72
grain-equivalent GWS player-season rows normalized as a byproduct of the same fix.

AFLDB-ISSUE-203 (numeric word "zero" not bound as equality in `player_career` conditions) resolved
2026-09-16 (Sonnet 5, operator-validated) -- root cause was two cooperating gaps in
`extractCareerConditions` (missing `zero` vocabulary entry, and a comparator default wrong for a
bound zero); `PARSER_VERSION` 52→53; 15 zero-word soft findings cleared, 0 new soft rows, 0
semantic changes among the 250 remaining soft rows -- see `issues.md` for the full record.

AFLDB-ISSUE-187..192 were opened 2026-09-15 from the Fable NL Search Stage 1 review (Fable 5.1,
medium effort), re-verified by Stage 2 on main `8a0c4cb`. Subsystem: natural-language search
(`src/search/nl/`, `src/db/queries/nl/`). AFLDB-ISSUE-190 resolved 2026-09-15 (Sonnet 5);
AFLDB-ISSUE-188 resolved 2026-09-15 (Sonnet 5); AFLDB-ISSUE-187 resolved 2026-09-15 (Sonnet 5);
AFLDB-ISSUE-189 resolved 2026-09-15 (Sonnet 5, from the approved runbook, operator-validated);
AFLDB-ISSUE-191 resolved 2026-09-15 (Sonnet 5, operator-validated); see `issues.md`.
AFLDB-ISSUE-193 (opened 2026-09-15 during ISSUE-189 planning) resolved 2026-09-15 (Sonnet 5,
operator-validated); see `issues.md`.
AFLDB-ISSUE-192 resolved 2026-09-15 (Sonnet 5, operator-validated: 31/31 integration tests,
5/5 ISSUE-192 regression tests, clean `tsc --noEmit`); see `issues.md`.
AFLDB-ISSUE-187..193 all remain resolved; the Stage 2 closeout audit (2026-09-16, Sonnet 5 High)
found three neighbouring, unrelated defects while verifying the resolved fixes and opened
AFLDB-ISSUE-194..196. AFLDB-ISSUE-196 resolved 2026-09-16 (Sonnet 5 High, from the approved
runbook — one runbook correction to the `across` regression contract mid-implementation, see
`issues.md` — operator-validated: 389/389 `nl-parser.test.ts`, 167/167 `nl-semantic-mapping.test.ts`,
clean `tsc --noEmit`). AFLDB-ISSUE-195 resolved 2026-09-16 (Sonnet 5 High, from the approved runbook
`AFLDB-ISSUE-195.md`, Option B — subject-gated "won the/a premiership" vocabulary plus a narrow
club-season ownership guard, no runbook correction needed — operator-validated: 398/398
`nl-parser.test.ts`, 167/167 `nl-semantic-mapping.test.ts`, clean `tsc --noEmit`); see `issues.md`.
AFLDB-ISSUE-194 resolved 2026-09-16 (Sonnet 5 Medium, `sonnet/issue-194-team-match-symmetric-matchup`,
unmerged — operator-validated: 34/34 `tests/integration/nl-answers-team-club.test.ts`, clean
`tsc --noEmit`); see `issues.md`. AFLDB-ISSUE-187..196 all now resolved. The Stage 2 corpus triage
of the 208 `AMBIGUITY_NOT_DETECTED` rows (2026-09-16) classified 40 as `GENUINE_FAIL_OPEN`, 168 as
`STALE_CORPUS_EXPECTATION`, and opened AFLDB-ISSUE-197 for the 40 (one root cause).
**AFLDB-ISSUE-197 resolved 2026-09-16** (Sonnet 5, from the approved runbook `AFLDB-ISSUE-197.md` —
Option C, a dedicated `resolvePlayerFamily` resolver mirroring the parser's whole-word-prefix
predicate in SQL; `PARSER_VERSION` 48 → 49; operator-validated: 25/25
`tests/integration/nl-semantic-mapping.test.ts`, 951/951 across the full focused NL suite set,
clean `tsc --noEmit` — see `issues.md` for the full Implementation/Validation/Resolution record,
including one mid-session fixture correction and one integration-path control-flow investigation
that concluded fixture defect, not production defect). AFLDB-ISSUE-187..197 all now resolved.

Stage 2 status: **blocked again, narrowly.** ISSUE-197 resolving its one genuine fail-open root
cause cleared six of the seven generic-surname families (Johnson, Brown, Smith, Williams, Wilson,
Anderson). The v49 regression rerun (2026-09-16) found the seventh, Jones (rows 11626-11630,
5 rows), still hard-failing for a distinct-but-related reason: the parser's own defence-in-depth
`candidateNameWords` re-check does not tokenise hyphenated surnames (`Darcy Byrne-Jones`,
`David Rhys-Jones`) the same way SQL's `afldb_normalise_name` does, undercounting the real 13-member
Jones family to 11 and ranking a wrong answer instead of declining. **AFLDB-ISSUE-198 opened
2026-09-16, resolved 2026-09-16** (Sonnet 5, from the approved runbook `AFLDB-ISSUE-198.md` — one
implementation-time deviation from its §5 Option C code sketch, found empirically: `candidatePlayerSpan`
widens its acceptance test via the new shared `splitNameWords` helper but keeps the original
punctuation-bearing token, rather than exploding it, to stay aligned with the confidence/leftover-token
accounting elsewhere in the parser — see `issues.md`'s Implementation section). `PARSER_VERSION` 49 →
50. Operator-validated 2026-09-16: `tests/integration/nl-semantic-mapping.test.ts` 29/29 (DB-backed,
`afldb_test`), combined focused suite 964/964 across 6 files (`nl-parser.test.ts` 413/413,
`nl-semantic-mapping.test.ts` 167/167, `nl-regression-corpus.test.ts` 163/163,
`nl-audit-acceptance.test.ts` 10/10, `nl-plan.test.ts` 182/182, plus the integration file above),
clean `tsc --noEmit`. AFLDB-ISSUE-187..198 all now resolved.

The unchanged V1 12k-row corpus re-run on parser v50 (post-merge Stage 2 step) has now been run: hard
failures 178 -> 173, confirmed to be exactly the five Jones rows (11626-11630) clearing with zero
collateral movement. **AFLDB-ISSUE-199 resolved 2026-09-16** (Sonnet 5, from the approved runbook
`AFLDB-ISSUE-199.md`, revised mid-implementation after two real-DEV validation failures — see
`issues.md`'s Implementation/Final-patch-revision sections — a self-verifying correction script,
`tools/nl/fix-issue-199-stale-expectations.ts`, corrected exactly the 173 stale-decline rows; operator-
validated: correction-tool summary 173/173 targets modified, 0 non-target rows touched, plus a parser-v50
`nl:stress` re-run showing `AMBIGUITY_NOT_DETECTED`/hard-fail 173 -> 0 with the three soft classes
unchanged at 72/921/70; DB-free unit suite 28/28; `PARSER_VERSION` unchanged at 50). AFLDB-ISSUE-187..199
all now resolved. Stage 2 is **not** closed by this: the three soft classes remain open and unaudited
(item 4 below), and the rest of the Stage 2 closeout sequence remains outstanding.

**AFLDB-ISSUE-200 opened 2026-09-16, resolved 2026-09-16** (all Sonnet 5) for item 4's soft-class
audit. Runbook `AFLDB-ISSUE-200.md` written (planning); `tools/nl/audit-issue-200-extract.ts` and
`tools/nl/audit-issue-200-cluster.ts` (plus a shared constants module) written with DB-free unit
tests (implementation); the operator ran both scripts against the real
`/home/arm/nl-stress-v50-cleaned/` artifacts and found exactly six auto-clusters covering all 1,063
rows, and evidence-backed dispositions for all six were recorded in a checked-in mapping
(`tools/nl/issue-200-dispositions.csv`); **operator-validated resolution:** the final
`audit-issue-200-cluster.ts --apply-dispositions` run against the real
`/home/arm/issue-200-soft-audit.csv` reconciled exactly -- 1063 rows in, 1063 classified, 0
unmapped, 0 stale, `PLANNER_VALIDATOR_BUG` 598 / `STALE_CORPUS_EXPECTATION` 180 / `PARSER_BUG` 143 /
`GRAIN_EQUIVALENT_LEGITIMATE` 72 / `TAXONOMY_DRIFT` 70; local `tsc --noEmit` clean,
37/37 DB-free tests passed. No parser/planner/scorer code changed; neither external corpus file
modified. The three candidate defect follow-ons and the one guarded corpus-correction task (named in
`issues.md`) are recorded but not opened as tracked issues in this closeout.

**AFLDB-ISSUE-201 opened 2026-09-16, resolved 2026-09-16** (all Sonnet 5) for the first of those
follow-ons: the `PLANNER_VALIDATOR_BUG` `coverage_unavailable|boundary` cluster (598 rows).
`validatePlan` now exempts a `raw.boundary` plan from the career season-range rejection;
`player-career.ts` compiles the range against `c.debut_season`/`c.final_season`; `PARSER_VERSION`
50 → 51. Operator-validated: 774/774 focused unit tests, 33/33
`tests/integration/nl-answers.test.ts`, clean `tsc --noEmit`; stable-corpus rerun cleared 596 of the
598 rows, and the remaining 2 (id 9907, id 10294 — both "... Grand Final before 1897", `seasonMax`
genuinely one season before `NL_LIMITS.minSeason`) were confirmed stale corpus expectations, not
implementation defects, and corrected by a new guarded, self-verifying script,
`tools/nl/fix-issue-201-stale-boundary-expectations.ts` (17/17 unit tests passed). Final stable-corpus
result: 12,000 scored / 11,535 clean / 465 soft / 0 failed, with an independent diff confirming zero
collateral movement anywhere else in the corpus. See `issues.md` and `AFLDB-ISSUE-201.md` for the full
record. AFLDB-ISSUE-187..201 all now resolved.

Full entries, evidence, root causes and acceptance criteria are in `issues.md`.

## Stage 2 next task

1. **Done** (2026-09-16) — V1 regression corpus re-run against parser v49 (parse-only): hard
   failures 208 -> 178.
2. **Done** (2026-09-16) — fresh run's semantic rows compared against the retained v48 baseline:
   1271 -> 1241 non-clean rows, 30 rows became clean, 0 new non-clean rows, 0
   changed-but-still-non-clean rows. This comparison is what surfaced the Jones rows (§ above,
   AFLDB-ISSUE-198) as still-hard rather than clean.
3. **Done, resolved 2026-09-16** — the V1 12k corpus was re-run on parser v50: hard failures 178 ->
   173 (only the five Jones rows, 11626-11630, moved; confirmed clean via full semantic diff, zero
   collateral movement). The remaining 173 hard failures (5 Ablett + 112 team-streak + 56 coach-record)
   were all stale expected-decline rows predating shipped features. **AFLDB-ISSUE-199 resolved
   2026-09-16** — corrected via a checked-in, self-verifying script
   (`tools/nl/fix-issue-199-stale-expectations.ts`), operator-run against the real canonical CSV
   (`~/nl-stress-corpus.csv` on the dev host, which has no in-repo generator); `AMBIGUITY_NOT_DETECTED`
   173 -> 0, the three soft classes unchanged. See `issues.md` for full evidence.
4. **Done, resolved 2026-09-16 — AFLDB-ISSUE-200.** All 1,063 soft rows (`GRAIN_EQUIVALENT` 72,
   `UNEXPECTED_DECLINE` 921, `WRONG_FAILURE_REASON` 70) are classified into exactly six real
   clusters, operator-confirmed via the tool's own final `--apply-dispositions` run:
   `PLANNER_VALIDATOR_BUG` 598, `STALE_CORPUS_EXPECTATION` 180, `PARSER_BUG` 143,
   `GRAIN_EQUIVALENT_LEGITIMATE` 72, `TAXONOMY_DRIFT` 70 — no
   `intentional_conservative_decline`/`scorer_harness_artifact`/`duplicate_manifestation` clusters
   turned up in the real data. See `issues.md` for full evidence. Runbook: `AFLDB-ISSUE-200.md`.
5. **(a) done, resolved 2026-09-16 — AFLDB-ISSUE-201.** **(b) done, resolved 2026-09-16 —
   AFLDB-ISSUE-202**: a `PARSER_BUG` fix for "GWS"/"GWS Giants" leaking into unsupported-term
   detection on `team_match` margin questions (128 manifestations). Root cause was a missing
   combined alias (see `issues.md`/`AFLDB-ISSUE-202.md`); fix applied was the one-line
   `CLUB_NICKNAMES` addition, operator-validated against the retained V3 corpus (465 → 265 soft).
   The same fix also normalized all 72 `GRAIN_EQUIVALENT_LEGITIMATE` rows (GWS Giants player-season
   leading-goalkicker questions) to exact expected semantics as a byproduct, so that class is now 0.
   Stage 2 was **not yet** closed after (c): **(c) opened 2026-09-16 as AFLDB-ISSUE-203, resolved
   2026-09-16** (`PARSER_BUG` fix for the word "zero" not binding as numeric-zero in career conditions,
   15 manifestations, operator-validated, `PARSER_VERSION` 52→53); **(d) opened 2026-09-16 as
   AFLDB-ISSUE-204, resolved 2026-09-16** (guarded corpus correction for the 180
   `coverage_unavailable|fgf` disposals/marks/tackles finals/Grand Final rows that asserted a stale
   `expected_status=success` — two coverage floors, not one: disposals/marks before 1965, tackles
   before 1987 — retargeted after the first operator run failed closed on an over-broad 996-row
   selector, then two further fail-closed correction-tool bugs found and fixed; operator-validated:
   180/180 targets corrected, 0 non-targets touched, parser-v53 rerun 250→70 soft with the 180
   `UNEXPECTED_DECLINE` rows removed and zero new soft rows, `PARSER_VERSION` unchanged at 53).
   **Stage 2 is now closed** — (a)-(d) all resolved. The fresh exploratory Codex corpus sweep is now in
   scope, per the original Stage 2 boundary, as a separate not-yet-opened task.
6. **Opened 2026-09-16 as AFLDB-ISSUE-205, resolved 2026-09-16.** The 70 `TAXONOMY_DRIFT` rows were
   **not** accepted diagnostic drift after all — the audit found a real parser-ordering defect silencing
   an already-implemented team_match metric (42 rows, fixed, `PARSER_VERSION` 53→54) plus a genuine
   Q1-comeback feature gap (28 rows, stays declined with a corrected failure-reason label). Corrects, but
   does not reopen, Stage 2 itself. V5 corpus: 12000/12000 clean, 0 soft, 0 failed. See
   `AFLDB-ISSUE-205.md`.

Completed issue runbooks and supporting evidence are archived under `issues/closed/`.
