# AFLDB Current Issues Index

> Lightweight session index of open issues only.
>
> `issues.md` is the authoritative detailed ledger.
>
> Runbooks live under `issues/`, not at the repository root: `issues/open/<ISSUE-ID>.md` while
> the issue is open, `issues/closed/<ISSUE-ID>.md` once it is resolved, together with any
> `-HANDOFF.md` companions and evidence artefacts. Historical entries below name a runbook by
> filename only; resolved ones are in `issues/closed/`.

**Open issues:** 3 (ISSUE-229, ISSUE-316 and ISSUE-321). **On 2026-10-27, 13 issues were resolved under owner decision D-V2-SCOPE-20261027** (V2 only; see the resolved note below and `issues/closed/AFLDB-V2-CLOSURE-SCOPE-DECISION-20261027.md`). Earlier history follows: (ISSUE-328, registered 2026-10-27 as a port of the source repository's `6ffb893b` fix (admin settle panels named the text-sorted "latest" batch), full record in `issues.md`; ISSUE-325, registered 2026-10-24 for the ISSUE-316 J2 rebuild harness's esbuild sampler exemption (F-J06), was resolved on 2026-10-24 by staged harness revision I325-3, full record in `issues.md`; ISSUE-323 and ISSUE-324, registered 2026-10-23 during the ISSUE-316 pre-apply work and by its revision I disposable rebuild, were resolved on 2026-10-24 by the revision J2 disposable rebuild (owner ruling on F-J06; full record in `issues.md`); ISSUE-322, registered 2026-10-23 during the ISSUE-316 pre-apply work, was resolved on 2026-10-24, see below; ISSUE-321, registered 2026-10-23 for the successor source data-quality questions the owner deferred; ISSUE-319 and ISSUE-320, registered 2026-10-23 as ISSUE-316 successor gates, were resolved on 2026-10-23 (runbooks `issues/closed/AFLDB-ISSUE-319.md` §6 and `issues/closed/AFLDB-ISSUE-320.md` §8, the latter streamanator-scoped); ISSUE-316, registered 2026-10-18 on the uncommitted branch `opus/afl-api-cutover`; ISSUE-229, ISSUE-266–270, and the 7 review findings ISSUE-271–314 other than ISSUE-280, ISSUE-277, ISSUE-303, ISSUE-278, ISSUE-281, ISSUE-282, ISSUE-283, ISSUE-284, ISSUE-285, ISSUE-286, ISSUE-287, ISSUE-288, ISSUE-289, ISSUE-290, ISSUE-291, ISSUE-292, ISSUE-293, ISSUE-294, ISSUE-295, ISSUE-296, ISSUE-297, ISSUE-298, ISSUE-299, ISSUE-300, ISSUE-301, ISSUE-302, ISSUE-304, ISSUE-305, ISSUE-306, ISSUE-307, ISSUE-309, ISSUE-310, ISSUE-311, ISSUE-312, ISSUE-313 and ISSUE-314, registered on 2026-10-10; ISSUE-278, ISSUE-302, ISSUE-312, ISSUE-313, ISSUE-314 and ISSUE-315 were resolved on 2026-10-13, ISSUE-281 and ISSUE-288 on 2026-10-14 (both DEV-scoped; PROD installation and acceptance pending, runbooks `issues/closed/AFLDB-ISSUE-281.md` §18 and `issues/closed/AFLDB-ISSUE-288.md` §18), and ISSUE-265 on 2026-10-14, its closure documentation merged and pushed as `b8040018` and its ISSUE-265-specific PROD hold released, and ISSUE-297 on 2026-10-14 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-297.md` §18), and ISSUE-290 on 2026-10-14 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-290.md` §18), and ISSUE-291 on 2026-10-14 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-291.md` §18), and ISSUE-287 on 2026-10-14 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-287.md` §18), and ISSUE-286 on 2026-10-14 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-286.md` §18), and ISSUE-300 on 2026-10-14 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-300.md` §18), and ISSUE-306 on 2026-10-14 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-306.md` §18), and ISSUE-298 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-298.md` §18), and ISSUE-309 and ISSUE-311 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbooks `issues/closed/AFLDB-ISSUE-309.md` and `issues/closed/AFLDB-ISSUE-311.md` §18), and ISSUE-310 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-310.md` §18), and ISSUE-305 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-305.md` §18), and ISSUE-296 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-296.md` §18), and ISSUE-285 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-285.md` §19–§20), and ISSUE-282 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-282.md` §17–§18), and ISSUE-283 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-283.md` §17–§18), and ISSUE-284 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-284.md` §17–§18), and ISSUE-293 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-293.md` §17–§18), and ISSUE-294 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-294.md` §17–§18), and ISSUE-295 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-295.md` §17–§18), and ISSUE-301 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-301.md` §17–§18), and ISSUE-304 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-304.md` §17–§18), and ISSUE-307 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-307.md` §17–§18), and ISSUE-289 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-289.md` §17–§18), and ISSUE-277 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-277.md` §17–§18), and ISSUE-292 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-292.md` §17–§18), and ISSUE-299 on 2026-10-15 (merge-scoped; DEV-installed in `f07c2a74` on 2026-10-15, not DEV-accepted, not on PROD; runbook `issues/closed/AFLDB-ISSUE-299.md` §17–§18), and ISSUE-303 on 2026-10-15 (DEV-scoped: deployed to DEV on 2026-10-15 and browser-accepted; PROD installation and acceptance pending; runbook `issues/closed/AFLDB-ISSUE-303.md` §21–§22), and ISSUE-308 on 2026-10-15 (DEV-scoped: deployed to DEV and accepted under the owner's D-308-3 amendment; PROD installation and acceptance pending; runbook `issues/closed/AFLDB-ISSUE-308.md` §22), and ISSUE-280 on 2026-10-15 (DEV-scoped: deployed to DEV and accepted under the owner's D-280-1 and D-280-2 amendments; PROD installation and acceptance pending; runbook `issues/closed/AFLDB-ISSUE-280.md` §22); other issues' PROD prerequisites are unchanged)

> **Waiting and blockers:** [`blockers.md`](blockers.md) is a navigation register of everything outstanding (blocked
> work, actionable work awaiting execution, decisions, acceptance and deployment holds). It is not authoritative; the
> runbooks and `issues.md` are. Update it whenever a listed blocker or acceptance state changes.

### AFLDB-ISSUE-229 — AFL API fixture ingestion
- **2026-10-20 clarification:** B2 gates wiring/first applying the new-season fixture writer,
  with authentic whole-season/TBC/status/key/mapping evidence and first-apply approval. An
  inactive-writer backend preservation rehearsal is separate; ISSUE-229 remains OPEN.
- **Severity:** Medium. **Area:** acquisition / fixtures — `afl_api` season feed → `fixtures`,
  `canonical_applications`, `admin-fixtures.ts`.
- **State:** Open (2026-09-23). Fixture ingestion only. **Not resolved.**
  - **2026-10-02 (main `5a85226c`):** Option B decided; D-229-1 through D-229-8a decided.
    **B1 COMPLETE.**
  - Authentic retained pre-match evidence now covers `SCHEDULED`
    (`tests/fixtures/afl_api/match/04-season-feed-scheduled.raw-slice.json`) and
    `UNCONFIRMED_TEAMS`
    (`tests/fixtures/afl_api/match/05-season-feed-unconfirmed-teams.raw-slice.json`, 1154 bytes,
    sha256 `e39ac375cabf5f1fc2f182e4e7e28e53d072a4a8d49001320d163bb904867da7`).
  - Under the recorded D-229 decisions, both statuses map to fixture projection with AFLDB
    fixture status `scheduled`.
  - **2026-10-19 (AFLDB V2 Launch F, `v2/rebuild` `d760280e`):** fixture writer built:
    `packages/acquisition/src/fixture-lifecycle.ts`, `src/lib/acquisition/afl-api-fixture-writer.ts` and
    `npm run settle:afl-api-fixture-schedule`. It resolves identity explicitly and fails closed;
    promotion is one idempotent transaction; unobserved statuses are acknowledged per run. Tested
    on isolated PostgreSQL 16 (17/17); the 2026 feed dry-runs clean. Never applied outside
    isolation.
- **Runbook:** `issues/open/AFLDB-ISSUE-229.md`.
- **Next action:** B2: capture the first authentic 2027 pre-match feed (no 2027 compSeason exists
  as of 2026-10-19). Validate-only and dry-run it, then the owner approves the first apply.
  B2 is seasonal first-season operational acceptance, not missing fixture-writer implementation;
  authentic 2026 evidence already proves the technical status/projection contract. Whole-season
  2027/TBC/status/key/mapping evidence and owner approval are not waived.

**AFLDB-ISSUE-266, 267, 268, 269, 270, 271, 272, 273, 274, 275, 276, 279 and 328 resolved 2026-10-27 (V2 only; owner decision D-V2-SCOPE-20261027, approved with amendments).** The owner explicitly superseded the earlier closure conditions for V2 only.
- **V2 engineering complete:** ISSUE-267, 269, 270, 274, 275, 276, 279 and 328. Each fix is in `v2/rebuild` and validated as recorded, including V2's 20 Oct local run (`docs/v2/evidence/local-supported-tests-delivered.json`; ISSUE-328 58/58 at `e91fae88`).
- **Superseded by retired V2 runtime paths:** ISSUE-266, 268, 271, 272 and 273. V2 refuses CSV upload, submission review and promotion, and email intake (`docs/v2/legacy-disposition.md` L1–L3). Their fixed code is retained. ISSUE-271's owner-accepted local engineering and local acceptance ruling stands.
- **Nothing deployed or accepted:** no deployment, DEV acceptance or PROD acceptance is claimed. Historical installation records stay as written in each entry, and V2 is not released (production go/no-go NO-GO). Every outstanding live requirement is kept in the decision's checklist.
- **ISSUE-279:** `window-279.sh` is WITHDRAWN / UNSAFE, and no settings-window authority is granted.
- **Venue-season draft:** its registration is dropped. That subject is the source repository's ISSUE-327, parked there.
- **Historical impact:** assessments for 267, 268, 269, 271 and 272 stay unassessed.

Runbooks and companions: `issues/closed/AFLDB-ISSUE-266.md`–`-276.md`, `-279.md`, the `-267-269-*.sql`, `-268-*.sql`, `-272-*.sql`, `-275-SD-PROCEDURE.md` and `-276-RESIDUE.sql` companions, `AFLDB-ISSUE-280-308-279-DEV-ACCEPTANCE.md`, and the decision `issues/closed/AFLDB-V2-CLOSURE-SCOPE-DECISION-20261027.md`. ISSUE-328 has no runbook. Full records: `issues.md`.

**AFLDB-ISSUE-278 resolved 2026-10-13** (merge-scoped; implementation commit `dd18adb93a0207eb2ed812ac56636a90e2c89239`, parent `e7f84f14`, fast-forwarded to `main` and pushed; documentation-only closure commit follows it). `db:test:rebuild` and `db:test:prove-reset` now assert the connected database and role before anything else runs, refuse a DSN that libpq would read differently from postgres.js (query-string redirects, host-less or default-port forms), and run their psql and stage children with the libpq routing variables removed. DB-free: `tests/db-test-rebuild.test.ts` 670/670, `tsc --noEmit` clean. Two verdicts, kept separate: Procedure A (read-only, `afldb_test`) PASSED 12/12 and was accepted; Procedure B attempt 2 (one attempt, `afldb_test` only) gave a **proof PASS** (the always-aborted real `RESET_SQL`, `psql exit 3`) and, separately, an **unchanged-observed-state MATCH** (Tier 1 `a39ad96b…`, Tier 2 `4f11fda9…`; 99 tables, 63 sequences, 1,454,440 rows digested). Attempt 1 stopped at the baseline (`text || "char"`) with no proof and no verdict. **Limits kept:** a MATCH is not proof that no sequence operation occurred; index/TOAST contents, extended statistics, publications, subscriptions, roles, database settings, large objects and planner statistics are not covered; no real rebuild has been run, so the rebuild-stream guard is proven by Procedure A and the DB-free tests only; Procedure A is a historical result about the pre-reboot postmaster; the unpinned control V4c was omitted. Readiness was **accepted under a scoped cleanliness exception, not a clean pass**: `merge:ready` BLOCKED by exactly one blocker (15 untracked primary-checkout paths: nine `.agents/skills` files and six zero-byte stray-named files), all left untouched with sizes and hashes re-verified at every checkpoint; the merge-mode preflight's only blocker was the same 15 paths. Not deployed; no deployment is required or implied. Runbook and both verification procedures: `issues/closed/AFLDB-ISSUE-278*.md` (§18).

### AFLDB-ISSUE-316 — AFL API cutover: retire AFL Tables network acquisition

**Successor ACTIVATED (D-316-ACT-C-20261028; EXEC in validated State C `75df67db…`) and LOCALLY INTEGRATED in V2 (2026-10-28; local commits on `v2/rebuild`, not pushed; production NO-GO).** R `c7e17da2` (rollover, 8 paths, byte-equal to `06e88227…`), A `1a6de4b6` (`tools/db/rebuild-test.ts` alone, blob `11308f06…`) and F `955d0e85` (the 16 State C restatements; every blob equals its `C_sha256_lf` pin), with the records in `d504932c`. G, the V2-GAP-027 predecessor adaptation, was committed with the owner's GAP-027 work in `2d0971c7`. Focused checks over the integrated tree passed: five suites 499/499, `npm run typecheck` exit 0, and the V2-GAP-027 integration case 1 passed (73 filtered) on a disposable isolated `_test` clone. **Completed proof:** the accepted J2 Linux successor rebuild carries forward (2026-10-24, pinned `876dadbf`: `AFLDB-FINAL-VALIDATION PASSED: 91 checks`, all 1,640 comparable club-seasons agree; evidence 167/167, inputs 264/264). Day-D readiness, the State B apply, the activation, the deactivation (recovery) dry run and the local integration are complete; none of them executed another rebuild or the 91 SQL checks, and none was required. Below, "Not proven: the 91 SQL checks and any successor rebuild" means not re-executed by that operation. **Linux verification of the integrated tree DONE (2026-10-28; fresh, not a rebuild):** full workflow at `c3dea709` 14,860 passed / 3 failed (V2-GAP-029) / 63 skipped plus Coleman 28/28. Three Linux regressions were fixed locally (`26a089a7`, `a0c87fb5`, `c3dea709`; not pushed). PostgreSQL NL GAP-032/033 hold, frozen V5 is 12,000/12,000, and the browser sweep had 0 HTTP/page errors ([record](docs/v2/linux-verification-2026-10-28.md)). Third Linux pass (2026-10-28, [record §10](docs/v2/linux-verification-2026-10-28.md)): V2-GAP-035 closed (`58bd9e4c`; rendered gate 1,844/1,844), Brownlow B2 3/3 and B1 **8/8** after the per-case budget correction `c249be86` (attempts 1–2 failed on budgets), `brownlow-pending-populated` 4/4, ISSUE-265 Phase B 11/11 PASS (copied runner, disposable target), shadow report on the retained `a583fc7d…` archive strict FAIL/INCOMPLETE as expected (only the 116/117 deltas). **Current-production shadow acceptance MEASURED (2026-10-29, D-V2-CURRENT-ACCEPTANCE-RUN-1):** the D-V2-CURRENT-REHEARSAL-1 binding (with CURRENT-SCHEMA-1 and BROWNLOW-ALT-3; archive `a4641ca0…` only) over a verified local copy of the retained evidence gave evidence integrity, migration compatibility (no reasons), backend functional and backend acceptance PASS, exit 0; strict FAIL and staged Brownlow comparator INCOMPLETE as expected; privileges integration 42/43, staging default privileges absent, unresolved and not waived ([report](docs/v2/evidence/current-rehearsal-acceptance-2026-10-29.json); record §10 of `docs/v2/owner-decision-current-rehearsal-2026-10-29.md`). **Remaining:** D-V2-RESIDUALS-1 recorded the residuals as known and open on 2026-10-29 (`external-grids-import` NOT RUN because the rescued archive is unavailable; lint 508 / 136; GAP-029 149/99/50; [record](docs/v2/release-residuals-2026-10-29.md)); the read-only host inspection is DONE (2026-10-29, D-V2-HOST-INSPECT-1 with amendments: identity and ledger 110 match, no release drift, host change list HC-1–HC-5 prepared; [findings](docs/v2/host-prerequisites-findings-2026-10-29.md)); next, owner visual review (a production-build recapture is prepared) and the policy points in [the owner action sheet](docs/v2/owner-action-sheet-2026-10-29.md), then the separate push and production-release decisions, consolidated in [the release choices](docs/v2/owner-decision-release-choices-2026-10-29.md). [Integration record](issues/open/AFLDB-ISSUE-316-integration-20261028/INTEGRATION.md).

**State B applied and validated (D-316-APPLY-B-20261027, 2026-10-27 04:52:41–05:00:14Z, in window): EXEC in validated inactive State B at isolated binding commit `06e88227…`; production NO-GO.** A, B (WROTE 7 files, INSTALLED and INACTIVE), C, E1 (tree `a8ce0f34…`, commit `06e88227…`), E2 (unchanged activation-tool dry run: State B, projected C 1640/91, inactive refusal; nothing written) and F all PASS. Not proven: the 91 SQL checks and any successor rebuild. Evidence `…/apply-B` (`APPLY-B-CLOSING.sha256` `cb7b4f7e…`); details in `issues/open/AFLDB-ISSUE-316.md`. The W1-only approval D-316-ACT-C-20261027 arrived after W1 closed (V0 FAIL, nothing run). **Successor ACTIVATED under D-316-ACT-C-20261028 (2026-10-27 20:09–20:13Z): V0–V7 PASS.** EXEC rests in validated State C at isolated binding commit `75df67db…` (`rebuild-test.ts` `ab734947…`). The deactivation dry run proves the recovery binding; RC1 unused; production NO-GO. Evidence `…/activate-C` (`ACTIVATE-C-CLOSING.sha256` `3599bbcd…`); details in `issues/open/AFLDB-ISSUE-316.md`. Not proven: the 91 SQL checks and any successor rebuild. **Local integration candidate PREPARED 2026-10-28 (uncommitted):** R rollover (8), A activation (`rebuild-test.ts` alone) and F State C restatements (16), plus a 2-hunk V2-GAP-027 predecessor adaptation (G). Next (then): user-run focused checks (`INTEGRATION.md` §4), then the owner's selective commit decision (§5); release separate. Both done 2026-10-28; see above.

**Day-D readiness proof PASS (2026-10-27, 02:00:02–02:15:06Z, inside the approved window): READY FOR OWNER APPLY DECISION; production NO-GO.** P `def676517da3955aa18db3606785463aac464188` (EXEC HEAD before and after; 2,687 tracked blobs equal); H `79eb1212bbb03aa64f078807f09c3d643e5ea867` (11/11 helper files byte-equal); A `e91fae88765c5d6d74d4b2c61ee2c4d599fe5d26`; anchor `ffb06267…`. Opening PASS. Host/native policy PASS: day-D policy `dc7b585d…` matches J2 `a8e586e0…` 251/251, differing only in the auditor path (same digest `32d5f6fe…`). Independent review GO in round 2 (round 1 NO-GO on a MED provenance gap, closed by evidence). Three read-only censuses PASS, total 0, scope 1897..2026: prod `b1a6f398…` (02:10:38Z), dev `66037e8b…`, test `1ae06bca…`. Canonical/nightly PASS: batches 62–66 made 0 canonical writes; the only delta is the accepted PMS 705437 removal; `afldb.service` active; deployed `ff100dc2…` unchanged. Enforced dry run PASS 43/43: exit 0; 3/3 gates; 1622→1640; renumbered 4; 91 checks; seven pins match; `rebuild-test.ts` stayed at `320960e4…`; tuple absent; projection equals activate authority `1d133580…`; 0 REFUSED; root unchanged; no residue; prod census age 110 s. Not proven: the 91 SQL checks and State B. Pre-apply finding: the frozen activation authority binds simulated HEAD `06e88227…`, so a real `successor-activation.ts` dry run on the uncommitted State B checkout at P refuses at the HEAD binding. That substitute is withdrawn. The corrected sequence adds an isolated, local-only binding commit recreating `06e88227…` from the actual applied tree (owner decision E1). It then runs the unchanged tool's dry run without `LD_AUDIT`, because `/usr/bin/git` is outside the day-D policy (owner decision E2). See [apply decision package](issues/open/AFLDB-ISSUE-316-apply-decision-20261027/APPLY-DECISION.md). Evidence: `streamanator:/home/arm/afldb-i316-readiness-D-20261027T0200Z` (`CLOSING.sha256`, 95 files, `4ae463bc…`); local copy `.local-release/issue316-readiness-20261027/day-D-evidence/` (`decision/RESULT.md`, `SHA256SUMS`). The frozen package and `readiness/STATUS.json` (bound by the package manifest) are unchanged. No apply, activation, deactivation, deployment, rebuild, push or Brownlow work. Next: a separate owner decision on apply plus State B validation.

**Current owner ruling (2026-10-25):** structural gate **CLOSED / ACCEPTED**; D/P **APPROVED for readiness proof**. **D = 2026-10-27**, window **02:00–04:00 UTC / 13:00–15:00 AEDT (Melbourne)**; exact **P = `def676517da3955aa18db3606785463aac464188`**, implementation `c438f8449e65c28cf9f00879aaa045131b5f0d3a`. A later documentation/evidence commit never becomes P. Authorised in that window: current read-only host/native-policy proof, fresh three-target censuses, required nightly/canonical check and enforced dry run without `--apply`. No apply, activation, deactivation, deployment, disposable rebuild, push or Brownlow work. U3 **CONFIRMED**; U4 **Route B**; ISSUE-316 **OPEN**; production **NO-GO pending separate apply approval**.

**D/P evidence accepted (2026-10-25):** retained J2 167/167 and inputs 264/264; real offline validator exit 0 / 3-of-3 PASS / all pins match; seven-file apply shape; B inactive/rebuild-ineligible; projected C 1,640 rows / 91 checks; exact-P DB-free validation and typecheck PASS. Proposal-only repair supersedes the earlier B 2,956/7/32 failure: broader B **2,966/7/0**, C **2,992/7/0**; focused B **395/0/0**, C **396/0/0**, all exit 0. Fresh-context restatement review GO, no findings. No accepted product/test assertions changed; no new rebuild required. Fresh proof is **NOT RUN**, awaiting the approved day-D window.
[Approved bindings and day-D procedure](issues/open/AFLDB-ISSUE-316-dp-proposal-20261025/readiness/READINESS-RUNBOOK.md).

**Pre-window local preparation / H freeze (2026-10-25):** detached exact-P tree retained clean; all 2,687 tracked files match P. Original 17 preparation checks plus four H-binding checks: **21 PASS**. H is the separate local helper-freeze commit, never P; opening requires its full SHA and exact helper-file bytes. A records administrative lineage separately, including accepted `ffb06267...`; the two mutable inventory inputs remain bound to that exact commit's blobs. Commit scope is the preparation directory plus the four owner-named tracking files only. No dependencies, credentials, CSVs or historical censuses copied. All fresh production proof remains NOT RUN; production NO-GO. [Preparation, P/A/H model and limits](issues/open/AFLDB-ISSUE-316-readiness-prep-20261025/README.md).
[Local gate](issues/open/AFLDB-ISSUE-316-activation-separation-20261025/LOCAL-GATE.md).

- **Successor activation separated from the apply (2026-10-25; accepted implementation c438f844).**
  - A successor apply now writes 7 files and leaves `tools/db/rebuild-test.ts` (the activation state) unwritten.
  - `tools/db/successor-activation.ts` is the only writer of that state, under a bound authority, with the exact
    inverse for deactivation.
  - Fresh-context review GO, no CRIT/HIGH. LOW F4–F6 fixed. Owner accepted F1–F3 (2026-10-25): State B is
    rebuild-ineligible by design; the production candidate is structural, never "date-only" (U2 exception
    superseded); tests are classified and named by state.
  - Focused validation green: `season-rollover` 393/393; rebuild + cutover 1539 passed / 5 skipped; typecheck exit 0.
    A clean re-run of `db-test-rebuild.test.ts` after the renames needs free space on C: (`ENOSPC`).
  - Next: finalise the local candidate, then the production-window phase (D, structural P, census, enforced dry run).
    Apply and activation stay separate approvals. Production NO-GO.
  [Record](docs/v2/issue316-successor-activation-separation-2026-10-25.md).

- **Metadata repair v5 executed: PASS; U3 CONFIRMED (2026-10-25 Sydney; 2026-10-24T21:26–21:30Z; superseded as current).**
  The owner ruled: no sudo/NOPASSWD, no frozen v4, a separately hash-bound v5 changing only transport/principal binding.
  Read-only discovery through the existing `afldb_backup` credential selected the existing non-superuser owner
  `afldb_owner`. It is the only non-superuser able to update `data_edits.note`, and it was reached through the existing
  arm-only `.env`. No role, grant, sudo rule, authentication change or credential was created.
  - Package and review: v5 manifest 3e1e329f…fc06d96 (43 members; lock/snapshot/assertion SQL and note
    byte-identical to v4); PGlite 20/20, VM wrapper 31/31; private PostgreSQL 16 on streamanator 21 database and
    transport cases plus static ordering PASS. Fresh-context review GO, 0 stopping findings (decision c365eeb2…8083c;
    F-006 closed; F-007–F-010 LOW, F-011–F-014 INFO).
  - Execution: one run with the stages in order. Fresh observation PASS, then read-only prerequisite PASS
    (attempt not consumed), then ATTEMPT.json, then one write session with all eight markers in order, then
    independent postcheck PASS. Receipt `data_edits` 95 is linked to 94; the note is set; authority 93 and the
    protected snapshot and other audit rows are unchanged; optional Brownlow schema absent. Attempt consumed;
    no retry or reversal.
  - Standing: U3 confirmed: "2026 is complete, and no further 2026 AFL API settle is needed or will be done only
    through an audited correction." U4 Route B; Brownlow untouched. No census, seal/rollover, successor activation,
    production apply, deployment, rebuild or push. Production NO-GO.
  [V5 record](issues/open/AFLDB-ISSUE-316-u3-correction-20261024/METADATA-REPAIR-V5-RECORD.md).

- **Unprivileged replacement observation PASS; STOP before frozen wrapper (2026-10-25 Sydney; superseded).**
  The no-sudo `arm` observation (2026-10-24T20:28Z) passed every remote gate, and the frozen pins reverify cleanly. Stopped
  because the frozen `run.cjs:69` repair itself needs passwordless `sudo -n -u postgres` and writes `ATTEMPT.json` before
  SSH. That hop is unproven on production. No ATTEMPT.json or write; attempt unconsumed; U3 unconfirmed; NO-GO. Next:
  owner confirms the postgres sudo hop or chooses a v5 transport.
  [Record](issues/open/AFLDB-ISSUE-316-u3-correction-20261024/metadata-repair-v4-unprivileged-observation-20261025/RECORD.md).

- **V4 production execution authorised; STOP before preflight (2026-10-25 Sydney; superseded).**
  Final frozen-byte/review/runtime verification PASS (40 manifest members; eight external evidence pins;
  manifest 829fc30a…848ecf84; decision 39e71a77…04a913a2; report c36dc24a…2374712).
  Separate fail-closed operational observation at 2026-10-24T20:07:59Z confirmed afldb-prod / arm, then
  `sudo -n ps` failed: `sudo: a password is required` (SSH exit 1). No process-clear inference;
  systemd/session checks not reached. No retry/workaround, production DB connection, frozen preflight,
  wrapper/transaction invocation, ATTEMPT.json or production write. Attempt unconsumed. U3 unconfirmed;
  U4 Route B; Brownlow untouched; production NO-GO. Next: owner resolves/adjudicates the failed
  noninteractive read-only observation privilege gate; later resumption repeats all pre-execution gates.
  [Execution stop evidence](issues/open/AFLDB-ISSUE-316-u3-correction-20261024/metadata-repair-v4-production-20261024T200631Z/REPORT.md).

- **Owner adjudication accepted canonical correction; read-only completion PASS (2026-10-24; current).**
  - PMS 705437 removal is accepted as successfully executed. Do not restore Fiorini, repeat removal or Save again.
    The failure is audit metadata: data_edits 94.note is NULL; authority 93 remains active and unchanged.
  - Authorised read-only production reconciliation at 11:46:45Z / 11:48:04Z passed: 47 career, 47 season,
    47 club-season and 59 player-club rows agree; career numbering/spans agree; all 47 rebuild times equal commit.
    Eight match-17214 period rows, official 69–81 result, both team player totals and relevant club aggregates agree.
    REPEATABLE READ READ ONLY, identity gated, ROLLBACK, SSH exit 0; no production write.
  - Live authenticated Playwright confirms the optional form input name=note. Current/deployed note pipeline agrees
    and passes nonblank notes through; blank becomes NULL. Authority 93 has no note/reason column.
    No supported audited note amendment workflow found; no metadata repair attempted. Original submitted field
    value is unavailable, so application defect versus procedural omission remains unestablished; no speculative issue/test.
  - **F-005 owner scope clarification / v4 validated and frozen (2026-10-25; current).**
    F-005 accepted against the prior v3 contract: **Resolved by owner scope clarification, subject to v4
    proving detection and isolation under the revised contract.** V2/v3 remain frozen and unexecuted.
    V4 removes catalog locks/absence exclusion; existing protected-data locks and unchanged two-write body
    remain strict. Optional presence/schema is observed internally and postcommit; drift blocks U3 without
    retry/reversal. Added bounded operational DDL/deployment and expected migration-110 guards.
    Static ordering PASS; inherited PGlite16 plus three drift cases **19/19 PASS**; wrapper **14/14 PASS**.
    Owner-authorised synthetic transfer to arm@10.0.40.100 completed: 19 allowlisted members, hashes
    matched at both ends. PostgreSQL 16.15 **10/10 database cases plus static ordering PASS**, including
    early-DDL rollback and optional CREATE after all final assertions before COMMIT, then exact metadata/
    authority/existing-data verification and CONCURRENT_SCHEMA_DRIFT. Private cluster cleanly stopped;
    no process/socket remains. Harness-only transport/evidence/cleanup changes; all candidate SQL unchanged.
    Frozen 40-member manifest **829fc30a…848ecf84**. Fresh-context exact-byte independent review
    **GO, zero stopping findings; F-006 LOW retained** (host ps pipeline may mask producer failure).
    F-001–F-004 closed as originally stated; revised F-005 proof accepted. No frozen edits after review.
    Validation-only task complete; no production connection/preflight/attempt/write. U3 unconfirmed; U4 Route B;
    Brownlow untouched; production NO-GO. No census/rollover/activation/apply/deploy/rebuild/push.
    [V4 record](issues/open/AFLDB-ISSUE-316-u3-correction-20261024/METADATA-REPAIR-V4-RECORD.md).
  - **Historical frozen-v3 review (2026-10-25; scope ruling supersedes F-005 disposition).**
    Owner accepts F-004 as an isolation/proof-ordering finding; the accepted Fiorini correction stands.
    V2 remains frozen and unexecuted. V3's plain lock prefix closes original F-004 protected-DML ordering.
    Independent review returns NO-GO: a pre-existing optional-table CREATE may commit after the final
    in-transaction assertions but before repair COMMIT; catalog SHARE locks do not exclude its commit.
    Its absence can then be detected only by postcommit verification after metadata commit. This final
    interleaving is derived from reviewed bytes and measured catalog-lock behaviour, not replayed live.
    PGlite 16/16 and isolated PostgreSQL16.15 10/10 expectations PASS, but do not prove DDL exclusion.
    Prior F-001/F-002/F-003 and original F-004 are closed; new F-005 is a stopping DDL-isolation MED.
    Frozen manifest 5bf64288…54034d remains unchanged. No production connection, attempt or write.
    Historical next action was owner adjudication; the v4 scope ruling above now governs.
    [V3 record](issues/open/AFLDB-ISSUE-316-u3-correction-20261024/METADATA-REPAIR-V3-RECORD.md); [independent review](issues/open/AFLDB-ISSUE-316-u3-correction-20261024/metadata-repair-v3/REVIEW.md).
    U3 remains unconfirmed; U4 Route B; Brownlow untouched; overall production NO-GO.
    Day-D nightly and affected-material re-pin controls remain.
    [Completed verification and limits](issues/open/AFLDB-ISSUE-316-u3-correction-20261024/ADJUDICATION-READONLY-REPORT.md);
    [metadata repair proposal](issues/open/AFLDB-ISSUE-316-u3-correction-20261024/METADATA-REPAIR-PROPOSAL.md).

- **U4 Route B ruled; U3 row identified, final confirmation withheld (2026-10-24; previous):**
  - Brownlow 2026 does not block the ordinary seal. No normal production Brownlow settle after the seal and no
    move ahead of C2. Each pending key needs evidence and a decision note mapped to its proper audited workflow:
    `brownlow_authority`, `brownlow_eligibility_decision` after migration 113, or `data_editor`. The 9,522
    AFL Tables round-vote rows are not adjudicated or changed.
  - One authorised production query at 10:11:16Z identified PMS row **705437**: Brayden Fiorini (2121), Essendon (6),
    match **17214**, round 4, 2026-03-28. API application **20834**, batch **32**, inserted the known ISSUE-255
    unused-emergency placeholder (EMERG, 0% TOG, all-zero stats) before that fix. It is the sole canonical-only key.
  - Frozen J2-bound AFL Tables file verified: 10,028 rows, no Fiorini round-4 appearance; no equivalent identity.
    Proposed audited Data Editor Match Sheet removal with durable authority and recomputation; **not executed**.
    See [exact-row evidence and proposed correction](docs/v2/issue316-u3-player-row-evidence-2026-10-24.md).
  - Day D: re-check the latest AFL Tables nightly before the enforced dry run; require no unexplained canonical
    change since candidate preparation, and regenerate/re-pin affected production material on any canonical change.
  - Next: owner adjudication/approval of the proposed correction, verified disposition, then final U3 ruling.
    Ordinary completeness PASS accepted; U3 unconfirmed; production NO-GO. No further operational action approved.

- **U2 review accepted by the owner; U3 production check PASS, U3 not confirmed (2026-10-24; previous):**
  - Owner: the U2 review stands and is not re-run. Condition 2 is satisfied; conditions 1 and 3–6 and the D/P semantic
    diff remain.
  - Owner-authorised read-only `afldb-prod` check (2026-10-24T09:51Z; evidence
    `C:/tmp/afldb-i316-U3-prod-completeness-20261024T0950Z/`). Every one of the 218 2026 matches is settled and
    `afltables`-owned: the GF was 2026-09-26, and all scores, period scores and player rows are present. The season
    row is `complete`. Nothing is pending in fixtures, staging, candidates or batches, and no AFL API settle is
    eligible.
  - The AFL Tables nightly stays live (0 canonical writes since 2026-10-07). PROD has no seal yet: it runs `ff100dc2`
    with `[2026]`.
  - MED: one `afl_api` canonical player row in 2026 (10,029 against the AFL Tables 10,028). Brownlow was excluded.
  - Next: the owner's U4 Brownlow route decision, then U3 confirmation and the MED ruling. Production NO-GO.
- **Independent U2 review GO; condition 2 satisfied (2026-10-24; previous):**
  - The fresh-context static review found D shape-checked only and stamped into the four fields, plus stdout and
    whole-file hashes. Nothing reads those fields for any condition-2 decision.
  - Categories A/B/C are exhaustive. Findings: LOW (shape-only check of D); LOW, not specific to D (pre-built AFL API
    Brownlow artefacts pin the whole `fitzroy-contract.json` hash, relevant to U4); INFO only otherwise.
  - The reviewer's Grep incidentally surfaced about six ledger lines, which it disregarded. Full record is in
    `issues.md`.
  - Next: U3 (2026 complete, no further 2026 settle). Production NO-GO.
- **Three U2 points confirmed; independent U2 review commissioned (2026-10-24; previous):**
  - Owner accepted the three points, each narrowly:
    - the pins that necessarily follow from D (the three date-bearing finals, the change-set final, both simulated
      commits, both bundles, and covering aggregate hashes); every non-date input stays unchanged, and the semantic
      diff must prove it;
    - the two restated test literals, with identical assertion semantics;
    - the harness `--rollover-date` literal and its stage hash, in a new record, with J2 evidence left frozen.
  - Condition 2 needs a fresh-context review that is not told an expected answer. CRIT/HIGH, or a MED that undermines
    the date-only classification, stops U2.
  - Next: the review result, then U3. Production NO-GO.
- **U1/U2 ruled; static U2 verification done (2026-10-24; previous):**
  - U1: D and P are not set. J2's `--rollover-date 2026-10-24` and its pins are proof-only. D and P are created only
    near the real apply window, with an old/new pin table, a semantic diff and an independent review. A slipped D is
    re-pinned again.
  - U2: option (a), subject to six conditions (date-only delta; independent no-consumer review; no other change; a fresh
    enforced dry run; a new native-state check; censuses only in their own window). If any condition fails, stop and
    return for a new ruling.
  - Static result: the date is stamp-only. It goes into `resolved_on`, `accepted_on`, `validated_on` and `changed_at`,
    and no gate, final check, 1,640 comparison, eligibility, migration, write-set, activation or recovery code reads
    those fields. The J2 change set is date-free apart from three `final_sha256`.
  - Owner to confirm three points: the necessary pin changes, the two restated test literals in commit 2′, and the
    harness scripts that hard-code the date. Details are in `issues.md`.
  - Next: an independent review of the static verification, then the remaining U decisions. Production NO-GO.
- **Post-restore verification accepted; production-readiness decision package prepared (2026-10-24; previous):**
  - Owner ruling: the J2 proof window is complete and closed, and no further J2 host action is needed. The
    `apt-auto-upgrade.timer` "no next trigger" result is recorded as a limitation and the timer is left alone.
  - Native policy `a8e586e0…` is not production or apply evidence. `--rollover-date 2026-10-24` belongs to the J2
    proof; any other date regenerates, re-pins and reviews the transition, with old/new pins shown before execution.
  - I325-3 stays resolved at staged level and must be Linux-validated before any harness reuse.
  - Package (read-only, local; nothing executed):
    `docs/v2/issue316-production-readiness-decision-2026-10-24.md`. It separates date/pin, activation, census, apply,
    deployment and recovery, and lists the unresolved decisions U1–U15.
  - Not authorised: census, activation, apply, deployment, rollover execution or another rebuild.
  - Next: owner review of the package (U1 date and pin first). Production NO-GO.
- **J2 hold restored and verified (2026-10-24; previous):** the owner's `j2-hold-restore.sh` (`dee557de…`) ended
  `HOLD RESTORED` at 07:52:08Z: 63 holds cancelled, holds equal the pre-J2 set, four apt timers enabled and active.
  - Read-only post-restore check at 07:54:56Z: **POST-RESTORE VERIFIED**. 0 live holds, all four timers restored, 0 dpkg
    actions since, attempt still consumed, no J2 cluster. Evidence:
    `D:/tmp/afldb-i316-J2-20261023T2317Z/runs/post-restore-20261024T075456Z/RECORD.md`.
  - Later apt maintenance is normal post-proof activity. The J2 native-policy match is not preserved; a future
    production/apply proof must re-establish the host's native state and derive and review a new policy on drift.
  - J2 proof accepted and unchanged; its single attempt is consumed and not repeated. I325-3 is not yet executed on
    Linux and must be hash-verified and Linux-validated before reuse.
  - Next: owner decisions on rollover, activation, apply, census and deployment, each separately approved. Production
    NO-GO.
- **Owner ruling on F-J06 (2026-10-24; previous):** the completed J2 disposable rebuild is the Revision J2 proof.
  - F-J06 is an evidence-monitor defect, registered as ISSUE-325; it is not an enforcement or rebuild failure. The
    single attempt is consumed and is not repeated. ISSUE-325 was resolved on 2026-10-24 by staged harness revision
    I325-3 (`rbstage3-I325/`, record `6e589e77…`), which has not been executed. The J2 hold restore was authorised the
    same day and is pending the owner's `sudo` run.
  - The focused read-only evidence review (in `issues.md`) confirmed the following:
    - all 5 flagged processes executed `…/tsx/node_modules/@esbuild/linux-x64/bin/esbuild --service=0.28.2 --ping`,
      the policy line-21 object `e1698a3d…`, re-verified by the layout re-check before and after;
    - each carried `LD_AUDIT` and the pin `a8e586e0…`, with no unbound mapping and 0 native refusals;
    - `rb2-bootstrap.sh:14` exempts the line-22 sibling, and `enforcement-sampler.py:199` matches the path exactly.
  - ISSUE-323 and ISSUE-324 resolved; ISSUE-322 stays resolved.
  - Not authorised: push, deploy, apply, activation and censuses. The hold stays in place.
  - Next: the owner decides the next operational step and restores the hold separately. Rollover, activation, apply,
    census and deployment remain separate approvals. Production NO-GO.
- **Revision J2 attempt 3 / F-J05 (2026-10-24; previous, F-J06 ruled above):** addendum `PROPOSAL_J2-FJ05.md` in the J2 record; returns J-17 to J-21.
  - Criteria evidence repaired. `j2-listing.sh` `5e018720…` records each protected root itself plus a sorted top-level
    inventory, with no `..` and no parent metadata. Criteria, driver and rbstage2 are unchanged. `STAGE.sha256`
    `e61cca16…`.
  - Listing self-test 36/36, with the old `ls -la` failing the parent cases. Replay of the attempt-2 evidence passes.
    Reviews: J-19 GO-WITH-CHANGES (LOW), J-20 GO.
  - Attempt 2 was not a complete proof: its planner dry run passed, but 2/24 criteria were defective.
  - **Dry run attempt 3 (`20261024T034905Z`): driver exit 0, VERDICT PASS 24/24.** Evidence `bf2a88ac…`.
  - **The single disposable rebuild ran (attempt consumed 03:55:34Z).**
    - Runner exit 0; 30 stages; 91 checks PASSED; 1640 club-seasons agree; `AFLDB-POST PASSED`; clean shutdown.
    - The sampler reports 5 anomalies, all the policy-bound static esbuild under a single-path exemption (F-J06, MED).
  - Deviations recorded: the stray `git -C . show` and the main session's `git status`/`git diff --stat` (both
    unauthorised and non-mutating); reviewer provenance Fable 5.1 vs "Fable 5" (nothing substituted).
  - Next: an owner ruling on F-J06 (does the rebuild count as the J2 proof; it cannot be rerun). Then the owner
    restores the hold. Production NO-GO.
- **Revision J2 attempt 2 / F-J04 (2026-10-24; superseded by attempt 3):** addendum `PROPOSAL_J2-FJ04.md` in the J2 record; returns J-13 to J-16.
  - Harness repaired. Each negative input is now built by a structured edit of the field its checker reads, then
    re-read and verified before the control runs. Files: `j2-drive.sh` `c177842d…`, new `j2-neg-input.py`
    `bf66be96…`, `STAGE.sha256` `691c27a5…`.
  - Self-test 44/44 on the real record. Plan review GO-WITH-CHANGES (LOW/INFO); focused review GO. Repository pin
    unchanged.
  - Re-staged and hash-verified on streamanator. Hold active (63/63); policy 251/0.
  - **Dry run attempt 2 (`20261024T025629Z`): criteria VERDICT FAIL 22/24.**
    - Every control and negative passed. Gate exit 0: 3/3 gates, 91 checks, 1622 → 1640, pins match, 0 REFUSED,
      nothing written.
    - FAIL on the V4 and J2 native root listings (F-J05, a criteria defect): `ls -la` includes `..` = `/home/arm`, the
      driver's own apply parent. Nothing else differs.
    - Rebuild NOT run; the attempt is not consumed. Evidence `runs/j2-dryrun-attempt2-20261024T025629Z.tgz`
      `6b70a0ca…`.
  - Next: owner ruling on F-J05 (the listing criteria), focused review, re-stage and a fresh J2 dry run. Only if every
    criterion passes: the one disposable rebuild, then restore the hold. Production NO-GO.
- **Revision J2 (2026-10-24; superseded by J2 attempt 2):** record `C:/tmp/afldb-c2-SUCCESSOR-PROPOSAL-J2-20261023T2346Z/` (`PROPOSAL_J2.md`).
  - F-J01 fixed in `876dadbf` (every `.bin` link hop must stay inside the checkout's real `node_modules`; ISSUE-324).
    J2 pinned checkout `876dadbf`, J2-pinned `85b5f05a…` (only `tools/db/rebuild-test.ts` pins changed); commit 1
    `a1e16e67` (simulated), commit 2′ `87da1563`; DB-free 11,278/0/27 and 11,327/0/27; tsc 0.
  - streamanator native policy re-derived in a new root: policy `a8e586e0…`, record `82e25a10…`. It differs from V4
    only by the auditor path and libz (zlib1g 2.2 → 2.3, CVE-2026-85091). Reviewed ACCEPT-WITH-CONDITIONS; V4 unchanged.
  - F-J03 harness: every setup and control step is gated, with in-driver negative controls; a mechanical criteria gate;
    self-test 15/15.
  - Owner applied the hold on 2026-10-24: 63/63 held, 4 timers disabled, hold kept in place. The real-symlink test
    passed on Linux (F-401).
  - **J2 dry run attempt 1 (`20261024T001117Z`) STOPPED, exit 9, before the gate.** Hold, pins and the policy match
    (251/0) passed. The `runtime-check` negative control was not detected because of a harness defect (F-J04):
    `j2-drive.sh` alters only the first of two node digests in the single-line record, and the check reads the
    second. No planner run; rebuild NOT run; attempt not consumed.
  - Next: owner ruling on the F-J04 driver fix (`sed …/g`, plus a guard that each altered input differs), re-staging
    and a fresh dry run. Production NO-GO.
- **Revision J (2026-10-24; superseded by J2):** record `C:/tmp/afldb-c2-SUCCESSOR-PROPOSAL-J-20261023T2234Z/` (`PROPOSAL_J.md`).
  - Commits `82603dc7` (ISSUE-324), `db541ae3` (ISSUE-322, resolved), `14abea5e` (esbuild native-binary exception,
    forbidden-environment refusals), `4fcc95ef`/`60eb5e0c`/`dfbfc1ab` (ISSUE-322 integration test, 7 passed).
  - J pinned checkout `dfbfc1ab`, J-pinned `5c0763fa…`; commit 1 `31f0ab32` (simulated), commit 2′ `72e37fa7`;
    DB-free 11,266/0/26 and 11,315/0/26; tsc 0.
  - Enforced streamanator dry run (checkout-local node_modules, layout and esbuild re-check PASSED): REFUSED at gate
    1, exit 2: `libz.so.1.3` drifted from its policy binding after an OS dist-upgrade (zlib1g 2.2 → 2.3,
    2026-10-23T16:16Z). Nothing written. Disposable rebuild NOT run (attempt not consumed).
  - Next: owner decision on the libz drift (policy/record re-derivation is not authorised without a ruling; hold OS
    upgrades); then repeat the J dry run and, only if it passes, the one rebuild. Production NO-GO.
- **Revision I (2026-10-23; superseded by J):** package `C:/tmp/afldb-c2-SUCCESSOR-PROPOSAL-I-20261023T0905Z/` (`PROPOSAL_I.md`).
  - ISSUE-323 guard repaired in `481511d2` (pinned commit). I-pinned `e887fa19…`; only `tools/db/rebuild-test.ts`
    differs from H (base `8a685c63…`, final `bd8f6b0c…`). H preserved.
  - Branch `i316/I-post-transition-on-481511d2`: SIMULATED commit 1 `14c52a9e`, commit 2′ `6d9b60a2` (27 successor
    rebuild tests replace H's marker). DB-free suite 11,196 pass / 2 fail (ISSUE-322) / 26 skipped; tsc 0.
  - streamanator LD_AUDIT-enforced dry run: exit 0, 3/3 gates, 91 checks, pins match, 0 REFUSED, nothing written.
  - Disposable rebuild `afldb_v2_rb_i316_revision_i_test`: passed the ISSUE-323 guard, baseline, witness and coach
    replay, then REFUSED at the first `npx` stage (ISSUE-324); database untouched; no D7; cluster stopped; no rerun.
  - Next: owner decisions on ISSUE-324 (fix, revision J, dry run, one new disposable rebuild) and ISSUE-322; then
    `PROPOSAL_I.md` §9 (or J's). Production NO-GO.
- **Revision H (2026-10-23; superseded by I):** package `C:/tmp/afldb-c2-SUCCESSOR-PROPOSAL-H-20261023T0554Z/`.
  - G change set preserved (H-pinned = G-pinned `7beb7347…`); pinned checkout `63c35bde` (explicit predecessor fixture).
  - Complete post-transition set on branch `i316/H-post-transition-on-63c35bde`: commit 1 `21444ba2` (ten files at G
    finals, simulated) and commit 2 `219961ff` (2027 `unsupported` ×5 per ADR 0011, matrix 655, 99 assumptions
    restated). Suite 11,169 pass / 2 fail (ISSUE-322); tsc 0.
  - streamanator LD_AUDIT-enforced dry run in a fresh bundle checkout: exit 0, 3/3 gates, 91 checks, pins match,
    0 REFUSED, nothing written. Censuses 03:28Z reused (in window), no freshness waiver.
  - Sealed 2026: settle refuses; Brownlow artefact-loader and admin routes intact; pending never accepts.
  - **Next:** owner decision on ISSUE-323 (rebuild blocked), then `PROPOSAL_H.md` §8; rebuild only on the separate form.
- **Pre-apply safety and revision G (2026-10-23; previous):**
  - **Disposable credential exposure contained:** V3/V4 `afldb_owner` DSNs were logged by the sampler via harness argv.
    No reuse; both clusters stopped; markers written; `isolated-pg.ts` refuses marked roots (`0011b985`); CREDFIX-1
    harness. Record `C:/tmp/afldb-i316-CREDENTIAL-INCIDENT-20261023T0447Z/INCIDENT.md`.
  - **Proposal F superseded by G** (`21749f57`): the unvalidated CLUB_SEASONS_EXPECTED 1622→1640 edit was removed, and
    the ISSUE-136 `players_with_renumbered_profile` gate was restored (90→91 checks). **G-pinned `7beb7347…`**;
    `C:/tmp/afldb-c2-SUCCESSOR-PROPOSAL-G-20261023T0600Z/` (`PROPOSAL_G.md`, `APPLICATION_SPEC.md`, `REBUILD_SPEC.md`).
  - **Commit scope (post-apply simulation):**
    - The apply commit is ten files: the eight written plus the two untracked c2-2026 manifests.
    - A second commit adds the 2027 entries to `COVERAGE_REGISTRY` (statuses owner-reviewed) and restates 99 tests
      that pin "2026 in progress".
    - 2026 becomes sealed: AFL API settle for 2026 refuses afterwards except through an audited correction.
  - **Next:** owner authorisation of the application spec: confirm 2026 settle completeness, fresh censuses, a
    streamanator enforced G-pinned dry run, then `--apply` on 2026-10-24. Separately, the owner names the rebuild
    target database.
  - ISSUE-316 OPEN; successor NOT ACTIVATED; production NO-GO; Brownlow 2026 pending; ET unresolved.
- **Raw replay, enforced v4 rehearsal, censuses and Proposal F at `691bdbae` (2026-10-23; previous):**
  - **G1 (ISSUE-319) RESOLVED:** mandatory coach raw-to-parsed replay in the rebuild preflight (`691bdbae`).
  - **G2 (ISSUE-320) RESOLVED for streamanator:** planner and rebuild runtimes bound to v3 record `685a281c…`.
  - **Enforced v4 rehearsal PASS:** exit 0, 30 stages, replay VERIFIED before census/capture/reset, strict D7 1,640,
    91 checks, `AFLDB-POST PASSED`, 0 REFUSED; clean shutdown. Evidence
    `C:/tmp/afldb-c2-REHEARSAL-V4-691bdbae-20261023T0248Z/`.
  - **Censuses PASS** (total 0, 1897–2026): `afldb_prod` 03:28:51Z, `afldb_dev` 03:28:40Z, `afldb_test` 03:28:41Z.
  - **Proposal F:** F-pinned `cddde59e…`; genuine pinned planner dry runs on streamanator exit 0 (normal and
    LD_AUDIT-enforced), pins match, nothing written. `C:/tmp/afldb-c2-SUCCESSOR-PROPOSAL-F-20261023T0312Z/PROPOSAL_F.md`.
  - **Next (superseded by G):** apply F-pinned on streamanator on 2026-10-24, then the post-rollover rebuild there.
  - ISSUE-316 OPEN; successor NOT ACTIVATED; production NO-GO; Brownlow 2026 pending; ET unresolved.
- **v3-enforced rehearsal and Linux dry run at `15e43562` (2026-10-23; previous):**
  - **Rehearsal under the enforced native closure PASS** (ISSUE-320): exit 0, 30 stages, census pass (fresh
    database: mechanism only), strict real D7 1,640, 91 checks, `AFLDB-POST PASSED`, 0 REFUSED; clean guarded shutdown.
  - **Linux pinned planner DRY RUN on DEV, exit 0** (no `--apply`): three gates PASSED, `1622 -> 1640`, nothing
    written, root unchanged. Census records used: 2026-10-22T21:57:39Z / 21:56:37Z / 21:56:38Z. No freshness or
    apply-readiness claim; DEV is not the applying-runtime proof.
  - Evidence: `C:/tmp/afldb-c2-REHEARSAL-V3-15e43562-20261023T0017Z/` (`EXECUTION_RECORD.md`, `HASHES.sha256`).
  - **Next:** ISSUE-319 owner choices; ISSUE-320 per-environment records and §3 acknowledgement; fresh censuses,
    the applying-runtime dry run and a separate apply approval near the window.
  - ISSUE-316 OPEN; production NO-GO; successor NOT ACTIVATED; 1,640 rehearsal-only; Brownlow 2026 pending; ET
    unresolved.
- **Successor readiness E (2026-10-23; previous):**
  - **Owner decisions recorded:** rollover date 2026-10-24; D-316-1 granted for preparation; successor approved
    conditionally on ISSUE-319 and ISSUE-320 (not activated); census scope 1897–2026 with no exclusions; Brownlow 2026
    pending; ET unresolved; apply, rebuild, migrations, deployment and push not authorised.
  - **Read-only censuses PASS** (total 0, scope 1897..2026, identity verified): `afldb-prod`/`afldb_prod`
    `f9cb8fa7…78a4`; `streamanator`/`afldb_dev` `39b10324…c2e2`; `streamanator`/`afldb_test` `33832676…0584`. Time-bound.
  - **Native closure:** `041bd585` (ISSUE-320).
  - **Source evidence:** partly resolved (ISSUE-319).
  - **Package E** `C:/tmp/afldb-c2-SUCCESSOR-PROPOSAL-E-20261023T1045Z/` (`HASHES.sha256` `2c598adf…fe1c`): the genuine
    planner dry run PASSED (exit 0, nothing written; change set E `92879ad0…`, pinned `410b0787…`). It is NOT READY
    while ISSUE-319 and ISSUE-320 are open.
  - **Next:** ISSUE-319 adjudication; authorise the v3 rehearsal; fresh censuses and a Linux dry run near the window;
    a separate apply approval.
  - ISSUE-316 OPEN; production NO-GO.
- **Exact-implementation rehearsal at `a5ec6b0c` (2026-10-23; previous; superseded by readiness E above; technical rehearsal validation complete at that commit, rehearsal-only):** One agent, no subagents; isolated DEV target only. `a5ec6b0cbd0977eea77cd655d28b54b108fdb0bc` (packaged code = `73116273`'s; the delta is documentation) rehearsed in a NEW labelled package (1,142 files; the four content pins, the launcher `6f11febd…` and the `ladder-successor` modules included), a clean-install runtime with its own record `6c4ea3ea…`, recovered coach raw bound as a hashed bundle and verified by the real loader (387 files, 3 refusing controls; the stage itself ran parsed-only because the package alphabet refuses the space in `Allan_La Fontaine.html`), and a fresh cluster/database. Production launcher exit 0: preflight, enforcing census 1897–2026 (fresh database: mechanism only), capture-bound lifecycle, 30 stages, strict real D7 (all 1,640), 91 checks, post-rebuild pending-Brownlow checks, clean shutdown. The tuple table is still empty; `c2-2026-successor` NOT activated. **Next:** owner decisions only (rollover date and D-316-1; tuple/profile adoption; exact census targets and read-only census authority; source coverage/provenance acceptance; native-library trust policy). Detail: [Revision 5](docs/v2/issue316-c2-successor-decision-2026-10-21.md#revision-5--2026-10-23-previous-exact-implementation-rehearsal-at-a5ec6b0c). ISSUE-316 OPEN; production NO-GO; successor NOT ACCEPTED; 1,640 rehearsal-only; Brownlow 2026 pending on all three keys; ET unresolved.
- **Successor capability, source evidence, reproducibility, package D (2026-10-23; previous; superseded by the entry above):** One agent, no subagents. `52b97173` adds the fingerprint-bound successor ladder tuple capability, INACTIVE (empty repository table; mechanism A; profile `c2-2026-successor`); `73116273` byte-pins the Wikipedia-derived tracked inputs in preflight and adds hash-pinned Python requirements. Coach raw pages recovered (387/387 hashes equal the manifest; the earlier "absent everywhere" statement is withdrawn); 10 coach-season differences, 479 unmapped roster ids and the rejected identity/height matches stay open. Clean disposable-root installs reproduce the recorded runtime only when esbuild's reviewed postinstall runs; system native libraries remain observation. Package D (`C:/tmp/afldb-c2-SUCCESSOR-PROPOSAL-D-20261023T000000Z/`): the genuine successor profile is ACCEPTED by the proposed-state validators and 10/10 negative controls refuse; census targets inventoried, no census. **Next:** owner decisions only (rollover date and D-316-1; adopt or decline the tuple/profile; census targets; source coverage limitations; native-library trust policy); the fresh isolated rehearsal it required has since passed (entry above). Detail: [Revision 4](docs/v2/issue316-c2-successor-decision-2026-10-21.md#revision-4--2026-10-23-previous-successor-ladder-capability-source-evidence-reproducibility-package-d). ISSUE-316 OPEN; production NO-GO; successor NOT ACCEPTED; 1,640 rehearsal-only; Brownlow 2026 pending on all three keys; ET unresolved.
- **Runtime evidence, transition change set and revised drafts (2026-10-22; superseded in part by the populated-state entry that follows):** One agent, no subagents. Read-only DEV inspection (identity verified first; no install, database or write): the DEV lock `85809f26…` is retained and classified against the repository lock `984b4422…` (exactly one repository-only devDependency, `@electric-sql/pglite`; 0 of 552 shared entries differ), the Linux esbuild package and four others are tied to lock integrity through cached tarballs, and 2,445 of 2,445 run-record files equal current DEV; Python 3.12.3 / psycopg 3.3.4 recorded. Still unproven: Python archive integrity (no requirements with hashes, no PyPI digest), the run-time lock bytes, native-closure enforcement, a clean `npm ci` ([closure §8.3](docs/v2/issue316-c2-rehearsal-closure-2026-10-22.md#83-read-only-dev-runtime-inspection--what-it-closed-and-what-it-did-not-2026-10-22-later-the-same-day)). **Planner (local commit `5a09f3e5`):** optional `--transition-change-set` carries the complete transition as one hash-bound change set (base contract, replaced contracts, role-bound inputs, `$comment` register patches, full write set, `final_sha256` pins), refuses sentinels, stale or partial input and register-history change, leaves the predecessor coherent until a staged, journaled apply; focused tests added to the existing suites (the two earlier failures in `tests/season-rollover.test.ts` were not "unrelated": causes proven against exact baselines, `stage 9 re-points itself` a fixture gap from `39e80642` and `routes every contract read site` a source defect from `4b5e2490`; both repaired in `c7443fc2` without weakening either protection). The real tool refuses the revised draft on the single remaining sentinel (production ladder profile name); no real-proposal run is possible without the ownership census. Revised drafts and alternatives are in the [decision package](docs/v2/issue316-c2-successor-decision-2026-10-21.md#revision-1--2026-10-22-planner-change-set-runtime-evidence-revised-drafts); owner-only decisions remain (date, production profile mechanism, D-316-1, `issue` attribution, exclusion wording, coach/Wikipedia/roster stance, census targets, native-closure policy). ISSUE-316 OPEN; production NO-GO; successor NOT ACCEPTED; 1,640 rehearsal-only; Brownlow 2026 pending; ET unresolved; restrictions unchanged.
- **Final technical validation at `96e0922a` (2026-10-23; previous; superseded by the Revision 4 entry above; supersedes the populated-state entry below for that stage):** One agent, no subagents; isolated DEV targets only. Commits `dedba57f3650c156ad012ebdec48d6d62f5a7070` (eligibility fixtures seed explicit Brownlow acceptance) and `96e0922a60952e7d441ad2fe5865f4c5d76566d7` (populated planted-vote test). The 40 empty-database Brownlow failures are classified: 21 a true stale-fixture defect (repaired, expectations unchanged), 19 empty-database data preconditions. On a clone of a NEW complete rehearsal: four suites 122/122 and the planted-vote proof 4/4 (pending votes stay out of totals, winners, ranks, eligibility and projections; acceptance exposes exactly the planted rows; restoration exact). Not closed: `v2-brownlow-production-correction` 2 passed / 6 failed (needs the production pre-correction archive state and an unobtainable retained snapshot). **Fresh complete rehearsal PASS at `dedba57f`** through the production launcher (30 stages, strict D7 1,640/1,640, 91 checks, post-rebuild checks, exit 0, clean shutdown; census on a new database, 0 ledger rows). Evidence `C:/tmp/afldb-c2-FINAL-TECHNICAL-VALIDATION-20261023-20261022T122727Z/` (`HASHES.sha256` 1b8774f04ab022f794d44acc1f35c5c81363a403dedb998f6a8c356d528fa4d7). **Next action:** the six owner decisions only. ISSUE-316 OPEN; successor NOT ACCEPTED; production NO-GO; Brownlow 2026 pending; ET unresolved; 1,640 rehearsal-only.
- **Populated-state proof, proposed-state validation and a Brownlow career-total repair (2026-10-22; previous; supersedes the 'unrelated failures', 'atomic' and 'L1/L7 unchanged' wording above):** One agent, no subagents. **Transition mechanism** (`c7443fc2`): the complete proposed state is judged by the rebuild's own validators (`resolveLadderRebuildExpectation`, `finalValidationChecks`, the importer-shared continuity parser) over the proposed bytes together with no working-tree edit; invalid continuity, height, ladder, expectation or selector combinations refuse even when hashes are consistent; a successful validation is bound to the exact bytes and `applyStagedWrites` refuses drift before and after staging; apply is a journaled, recoverable multi-file operation, NOT a filesystem transaction, and a partial application stays visibly blocked with its journal preserved; database-dependent checks are returned as pending, never proven. **Populated-state proof** (isolated DEV targets only, synthetic data, `93b21a18` then `9b854f9c`): the real capture, reset, migrations, privileges, reference data, registration replay, reinstate and bijection stages round-trip 4 ledger rows, 1 importer row and 3 manual registrations by stable identity (17/17); tampered, forged, other-database, no-pending, changed-marker and plain-capture-over-pending cases refuse and lose nothing; the enforcing census refuses a planted `afl_api` 2026 match under the candidate scope (19/19 with the pending-Brownlow suite); pending Brownlow with unaccepted source votes exposes no authoritative total, winner, rank or publication through the real projections. **Real defect found and repaired** (`81117391`): `recomputeBrownlowCareerTotals` summed raw `brownlow_season_votes`, so a pending season leaked into career totals and the career-minimum grid axis; it now uses the accepted-only filter and `publishBrownlowSeason` re-runs the recomputes once the season is accepted; the same four Brownlow integration files give identical per-test outcomes on the repaired and pre-repair trees. Two stale pins and three empty-database census cases repaired (`9b854f9c`); four `tests/current-season-import.test.ts` settle-script cases fail identically at `a6d486a2` because the legacy settle script is retired in V2 (recorded, not changed). Both clusters stopped with the verified shutdown (`shut down`, no `postmaster.pid`, ports free, watchdogs finished) and all roots retained. Current execution record and semantic diffs: package `C:/tmp/afldb-c2-SUCCESSOR-PROPOSAL-C-20261022T114149Z/` (`EXECUTION_RECORD.md`; the two earlier packages unchanged). Owner-only decisions that remain: rollover date and D-316-1 grant; production ladder profile mechanism and successor/profile adoption; census target list; coach/Wikipedia/roster stance; exclusion wording and attribution; native-library trust policy and reproducibility requirements. ISSUE-316 OPEN; production NO-GO; successor NOT ACCEPTED; 1,640 rehearsal-only; Brownlow 2026 pending; ET unresolved; restrictions unchanged.
- **Evidence retention and consolidated successor proposal (2026-10-22; previous):** One agent, no subagents; native inspection, hashing and offline validation only — no host, database, network, install, lockfile edit, rehearsal rerun, source or active-reference change. The twelve supporting evidence documents were reviewed against the closure's §7: every SHA-256 prefix equals the recorded one, 190 of 194 cited 64-hex strings equal retained files (the other four are composite digests, recomputed or located in tracked files), and the key figures were re-measured from the rehearsal package CSVs (132 core and 130 witness files hash-match; 10,028 2026 stats rows; 240,672 quarter cells with 0 failures; 150 blank-`Player` rows on the four renumbered profiles = 52 / 31 / 42 / 25). Five superseded status headlines carry dated retention notes (history preserved); the documents are committed and the closure's §7 now records original and committed hashes ([closure §8](docs/v2/issue316-c2-rehearsal-closure-2026-10-22.md#8-retention-review-and-dependency-lock-findings-2026-10-22)). **Dependency-lock discrepancy:** the DEV lock (`85809f26…`) is not retained, so its difference from the repository lock (`984b4422…`) cannot be classified and is unproven; the JavaScript modules that ran are hash-enforced (postgres 37/37, server-only 3/3, tsx 56/56 non-platform files byte-equal to the local install), but the Linux esbuild native binary is not tied to lock integrity and the Python environment is unpinned (no requirements or lock in the repository). The rehearsal PASS stays qualified and is not upgraded; empty-ledger lifecycle and row-vacuous zero-row Brownlow evidence stay distinct from populated-state proof; four reproducibility steps are listed in closure §8.2. **Successor proposal (not installed):** one consolidated section in the [decision package](docs/v2/issue316-c2-successor-decision-2026-10-21.md#consolidated-successor-proposal--2026-10-22) and a labelled C: package derived from the active repository bytes (54 files, manifest `1d71f4ca…`, 52 offline checks / 0 failures; no runner or planner executed): continuity 52 / 31 / 42 / 25, `baseline_only` height block with no supplement, c2 ladder witness and coverage, `rebuild_expectation` tuple (profile name unresolved), a new register entry beside the retained predecessor and older entries (not the rehearsal's single-entry replacement), the explicit ladder-only Kangaroos rule, byte-unchanged availability, Brownlow pending, measured values as proposed rehearsal-only expectations. The rehearsal overlay contract/register carry cp1252 mojibake (19 / 3 strings) and must not be copied. Unresolved fields U1–U9 are non-runnable sentinels (date, executed-gate verdict, production profile name and others); BLOCKED B1–B8 (no production ladder tuple, planner cannot carry non-planner contract edits, coach raw absent, no live census, tests pin 1,622, manifests and raw data not placed, DEV lock/Python reproducibility). **Next action:** the five consolidated owner decisions at the end of that section (review content; implementation route for B1/B2/B6; production provenance stance; rollover inputs and census targets; runtime reproducibility). ISSUE-316 OPEN; production NO-GO; successor NOT ACCEPTED; 1,640 and every other rehearsal value rehearsal-only; all three 2026 Brownlow keys pending; ET unresolved; authority, eligibility and ownership restrictions unchanged.
- **Rehearsal milestone closed (2026-10-22; previous):** Complete isolated C2 rehearsal **PASS at `5643f5c22025223916aa66cad6403a369a90c7cb`**, verified from the retained evidence independently of the producer summary ([closure record](docs/v2/issue316-c2-rehearsal-closure-2026-10-22.md)): package inventory 1,135 / 1,135 (765 files equal to the commit's blobs plus 5 reviewed overlays); launch spec `47c28cc5…`, runtime record `91c5cdb6…` and launcher `dd487c2c…` recomputed; 30 stages in planned order, exit 0; 1897–2026 census pass (on an empty database); capture-bound recheck, reset, reinstate and marker clearance; strict real D7 with both WF fixtures re-derived from the packaged results; `PASSED: 91 checks`, 0 mismatches; pending 2026 Brownlow with zero exposed rows and historical 98 / 79,113 / 112 intact; shutdown and limits; attempt 1 preserved; lifecycle 16 / 16. Corrections recorded: package composition, "Stage 18" is stage 22, the 91-check line is in `rebuild.err`, the CHANGELOG runtime-record v2 entry. Qualifiers: census on an empty database, zero exposed rows vacuous at row level, lifecycle proven with empty ledger data, DEV lock differs from the repository lock, native-library observations are not enforcement, local test counts are producer-recorded. Attempt 1's refusal, the approval-review denials and the two Windows-only skips stay recorded. **Next action (superseded by the evidence-retention bullet above):** one decision table (N1–N16) and one next approval prompt (N1–N11 plus one offline drafting authorisation) in the [successor decision package](docs/v2/issue316-c2-successor-decision-2026-10-21.md#current-state-and-remaining-decisions--2026-10-22). Brownlow 2026 publication, active successor adoption, rollover, production census and deployment are five separate approvals. ISSUE-316 OPEN; production NO-GO; 1,640 and every other rehearsal value rehearsal-only; all three 2026 Brownlow keys pending; ET unresolved; authority, eligibility and ownership restrictions unchanged.
- **Capture-marker lifecycle repair and rehearsal attempt 2 (2026-10-22; historical; superseded by the 2026-10-22 closure):** Local commit `5643f5c22025223916aa66cad6403a369a90c7cb` (`tools/db/rebuild-test.ts`, `tools/migration/rebuild_afl_api_adjudications.ts`, `tests/db-test-rebuild.test.ts`): the pre-`recreate` live recheck now accepts the pending rebuild marker only as the genuine marker of the capture this execution's own capture stage just completed (unforgeable binding; file not pre-existing, validated by the existing parser, digests equal the stage's printed ones and the live marker's; cluster/database identity checks stand; capture/final/ordinary rechecks still require the resting comment; safe nonsecret refusal reasons). 978 passed / 0 failed / 2 skipped (+22), `tsc` 0, lint = HEAD basis; real PostgreSQL lifecycle driver on a new disposable cluster 16/16 (real capture tool, marker, facts query, `RESET_SQL`). New package `C:/tmp/afldb-c2-REHEARSAL-ONLY-C-rehearsal-5643f5c2-20261022T074446Z` (1,135 files; inventory `60758e96…c858c3b`; differs from the c6cdb37b package only in bindings and the two repaired files), runtime record re-measured `91c5cdb6…2577`, launch spec `47c28cc5…a60de`. **Attempt 2 COMPLETED all 30 stages, exit 0** (new root/cluster/port 55463/db `afldb_v2_rb_c2cand2_test`, 07:51:43Z–08:22:03Z): 2026-inclusive census pass, capture bound and capture-bound recheck passed, reset, reinstate with marker cleared, **strict real D7 pass (all 1,640 comparable club-seasons)**, **FINAL VALIDATION PASSED: 91 checks (0 mismatches)**; post-rebuild pending-Brownlow/public-projection checks pass (2026 keys pending, 669 player-seasons pending/NULL, 0 exposed 2026 rows, historical 98 seasons/79,113 votes/112 winners). Cluster stopped (pidfile absent, port free, watchdog done, no tripwire); all roots and evidence retained; attempt 1 untouched. Production NO-GO; 1,640 rehearsal-only; unchanged owner decisions: Brownlow 2026 (all three keys pending), ET, missing coach raw, successor/active-reference adoption and rollover, production census/release. See runbook "Single-agent execution record (continued) — capture-marker lifecycle repair and rehearsal attempt 2".
- **Single-agent continuation (2026-10-22; previous):** Local commits `136e24d0` (runtime-record v2, pre-`os` zip hardening, startup landmarks, listener provenance, four baseline test repairs) and `c6cdb37b` (Linux-found fixes: `python3` selection, declared hard-link counts, bound `PATH` for guarded children); Linux DEV 958 passed / 0 failed / 0 skipped; real import-boundary, native-closure and child-spawn audit recorded. Candidate DOB pins independently derived and persisted-measured equal (13347/0/13347/0/2, rehearsal-only); Coleman 47/47 (no ties, no change needed). New labelled package `C:/tmp/afldb-c2-REHEARSAL-ONLY-C-rehearsal-c6cdb37b-20261022T062732Z` (inventory `e2840ac1…b7a664`). **Rehearsal attempt 1 REFUSED after the 2026-inclusive ownership census and capture passed, before recreate** (launch-provenance live recheck demands the resting isolated comment but the capture has already replaced it with the rebuild marker; implementation defect). Cluster stopped/retained; nothing destroyed; no D7/final-gate result. The owner then authorised the stricter capture-bound repair (resolved by `5643f5c2`; see the next bullet). Production NO-GO; 1,640 rehearsal-only; Brownlow pending; see runbook "Single-agent execution record".
- **Runtime-record schema v2 implementation (2026-10-22; previous):** Owner-approved bounded G7 implementation at `39e80642`, uncommitted, database-free. Inert-link ledger, `lstat`-ENOENT absent landmarks, hashed node/python/listener executables, runtime-only hard-link groups (Node guard `hardlink_counts`), absolute verified listener in `isolated-pg.ts` with `PATH` reduced to `pg_bin`; version 1 and package/source link rules unchanged; alias not implemented. Synthetic proof only (marker 210 passed / 1 skipped / 0 failed, isolated-target 25/25 and nonincremental `tsc` clean as retained); real dangling-symlink case skipped on Windows. **Re-review 2026-10-22: no material defect** (Python startup-zip check is defence in depth only, not "before any import"; claim corrected). 4 full-file failures are baseline failures introduced by `39e80642` (reproduced in an exact-commit copy; obsolete literal/resolver assertions masking I18/ordering coverage), not caused by this change and not repaired. Unresolved: native-library closure, Node import closure, zoneinfo data, child-spawn audit, real-filesystem link behaviour. Next: owner decision on an operator-run scoped commit (optionally with the small pre-`os` zip hardening), separate repair proposal for the four assertions, then one fresh DB-free Linux phase. ISSUE-316 OPEN; Brownlow 2026 pending, ET unresolved, 1,640 rehearsal-only, restrictions unchanged; production NO-GO.
- **Linux runtime-binding Q1-Q3 (2026-10-22; previous):** Owner-authorised read-only DEV queries done (evidence C: `issue316-q123-20261022-150450/`). **Alias not required** (Debian `sysconfig` requests the regular `_sysconfigdata__x86_64-linux-gnu.py`; `import psycopg` reaches it via `_tz`→`zoneinfo`). New blockers: `esbuild_binary` has `nlink 2` (hard-link-group allowance + small Node-guard change) and unscoped `node_modules` (use scoped roots). `/usr/bin/ss` direct binding needs absolute invocation in `isolated-pg.ts` and `PATH` without `/usr/bin` (1,439 entries). Native-library and Node import closure unproven; no policy adopted. Next: owner decision on the single bounded implementation proposal ([G7](docs/v2/issue316-c2-ladder-season-scope-proposal-2026-10-22.md#g7-observed-q1q3-facts-2026-10-22-read-only-and-resulting-scope)). ISSUE-316 OPEN; Brownlow 2026 pending, ET unresolved, 1,640 rehearsal-only, restrictions unchanged; production NO-GO.
- **Linux runtime-binding offline design (2026-10-22; previous):** Native-inspection design only, no command/host/test/implementation. `/usr/lib/python3.12` has exactly 3 links; startup needs none, two are unrelated entries, the `_sysconfigdata__linux_…` alias is import-time and conditionally required (psycopg reachability unproven); absent `python312.zip` is a second blocker. Minimal proposal (schema v2 runtime record only): exact inert-link ledger, `lstat`-ENOENT absent landmarks, file-bound interpreters, conditional same-directory alias; package/source link rules and Node guard unchanged; native loading unproven. Next: owner decision on read-only DEV query Q1-Q3, then bounded implementation and one fresh DB-free Linux phase. Details: [proposal addendum](docs/v2/issue316-c2-ladder-season-scope-proposal-2026-10-22.md#linux-runtime-binding-design-addendum--2026-10-22). ISSUE-316 OPEN; Brownlow 2026 pending, ET unresolved, 1,640 rehearsal-only, restrictions unchanged; production NO-GO.
- **Scoped commit / Linux preflight (2026-10-22; previous):** Local commit `39e80642fa0f9c744de9cb42f23940222a5c55c8`; reviewed 12-file staged scope, unrelated working bytes preserved, fresh nonincremental typecheck passed; retained 128/0 focused proof remains Windows-only. DEV identity/capacity/Node hooks/dependency locations observed read-only. Linux execution BLOCKED: required `/usr/lib/python3.12` contains symlinks rejected by complete runtime-root enumeration. No verification root, transfer, native import, sentinel/child-process phase or DB execution; initial CRLF preflight failure retained. Next: bounded offline Linux stdlib/search-landmark/canonical-link binding design review; no policy relaxation or retry here. Evidence: C: temp `issue316-commit-linux-20261022-142652/REPORT.md`. Candidate census/Brownlow integration, DOB/Coleman and real rehearsal pins outstanding; ISSUE-316 OPEN, Brownlow 2026 pending, ET unresolved, 1,640 rehearsal-only, all authority/eligibility/ownership restrictions unchanged; production NO-GO. Prior bullets are history.
- **Bounded re-review / predecessor transition (2026-10-22; historical; superseded by the 2026-10-22 closure):** One-agent review found no material defect within stated reviewed-code/interpreter/OS/native-loader/no-concurrent-writer boundaries; import guards are not a sandbox. Added only the exact predecessor `rebuild_expectation` block (full-history-20260902 / ladder-20260828, pinned fingerprints, independent **1,622**). All other contract fields equal basis; no candidate/season/accepted-successor change. Actual-contract positive and absent/invalid/candidate-on-ordinary-target regressions: **128 passed / 0 failed**, including 18 real-process Windows cases; nonincremental typecheck and diff check passed. C: evidence/initial sandbox failure disclosed in runbook. No commit/package/DB/stage/rehearsal. Next proposal: separately authorised Linux database-free import-boundary/native-extension proof with reviewed existing runtime. Candidate census/Brownlow parity integration, DOB/Coleman and real package/runtime/target pins remain blocked. ISSUE-316 OPEN; Brownlow 2026 pending; ET unresolved; 1,640 rehearsal-only; authority/eligibility/ownership unchanged; production NO-GO.
- **Dependency-resolution repair (2026-10-22; historical; re-reviewed above):** Mandatory inventoried Node guard surrounds tsx registration with main-thread/loader-worker hooks; Python isolated/no-site bootstrap checks exact reviewed stdlib paths and subsequent import origins/hashes, including bytecode refusal. Launcher/runner share pinned per-file policies and fixed child wiring; explicit content-bound search paths/esbuild helper required. Focused ISSUE-316 tests **149 passed / 0 failed**, including **18 real-process C: fixture cases** on Node 22.21.0/tsx 4.23.12/Python 3.12.10. Windows import-boundary proof only; Linux, real package/DB/census/rehearsal unexecuted. Next: bounded re-review of helper/verifier/schema/runner/tests and C: evidence before predecessor transition/commit. Contract unchanged; active runner still refuses missing expectation. Real package/runtime/target pins and DOB/Coleman unsupported. ISSUE-316 OPEN; Brownlow 2026 pending; ET unresolved; 1,640 rehearsal-only; authority/eligibility/ownership unchanged; production NO-GO. Details: runbook current repair entry.
- **Bounded implementation (2026-10-22; historical; superseded by the 2026-10-22 closure):** Closed ladder-pair resolver, shared census consistency refusal, independent final football checks and external verifier/fixed launcher/runner checkpoints implemented locally; active contract/register/reference/input bytes unchanged. Focused synthetic 104 passed; expanded affected set 283 passed / 0 failed; nonincremental tsc exit 0; diff whitespace check clean. **Active runner refuses the missing expectation block; not runnable.** Next: bounded local diff/trust-boundary review, then separately reviewed predecessor block transition and later rollback-only integration proof. No package/runtime/spec/target pins fabricated; DOB/Coleman unsupported; full rehearsal BLOCKED; 1,640 rehearsal-only; 2026 Brownlow pending, ET unresolved; production NO-GO. Earlier design/STOP entries below are history; restrictions remain.
- **Inventory-enforcement design addendum (2026-10-22; historical; superseded by the 2026-10-22 closure):** Added to the [existing ladder/season-scope proposal](docs/v2/issue316-c2-ladder-season-scope-proposal-2026-10-22.md#inventory-enforcement-design-addendum--2026-10-22), resolving the interface-design question from the implementation STOP below. Specifies deterministic complete SHA256SUMS membership, hash-covered rehearsal/pair/target binding, an owner-reviewed external launch spec supplying the expected inventory digest, separately bound runtime/dependencies, external verification before package code and runner rechecks before preflight/every stage/capture/reset/final checks. Defines fail-closed paths/overlap/drift refusals and synthetic initial-substitution/later-drift tests; genuine manifest validators/census remain mandatory. Caller-supplied pins are reviewed execution preconditions, not production approval. Next: owner review then bounded code/interface and synthetic-fixture implementation only; no active contract/reference/register/input edit or package construction. Exact future package/runtime/target pins, DOB/Coleman evidence and real rehearsal remain blocked. No implementation, shell/Git, tests, hashing of retained inputs, host/database/network/WSL or execution; unrelated changes and .codex/ preserved. ISSUE-316 OPEN; 1,640 rehearsal-only; 2026 Brownlow pending, ET unresolved and authority/eligibility/ownership restrictions unchanged; production NO-GO.
- **Bounded implementation STOP (2026-10-22):** Owner approved the ladder/season-scope proposal on basis `b8ea28550a291b766bf7ad9f3b63621e9f9efa81`; local HEAD matches. Inspection found no runner binding to a reviewed complete implementation/configuration/input inventory or isolated source-copy identity. Existing live target isolation proves the database, not the source package. Configuration review prerequisites 5–6 assign inventory enforcement to a future external harness; the successor package/inventory is not yet prepared and recovered inputs remain unmerged. Per the owner's stop condition, no implementation/config/reference change or tests executed. Next: bounded offline design of the authoritative inventory, source-copy/target binding and before-destructive/final enforcement interface; no package preparation or execution. ISSUE-316 OPEN; 1,640 rehearsal-only, production NO-GO; DOB/Coleman unsupported, 2026 Brownlow pending and ET unresolved.
- **Ladder/season-scope offline design (2026-10-22; historical; superseded by the 2026-10-22 closure):** [Bounded proposal](docs/v2/issue316-c2-ladder-season-scope-proposal-2026-10-22.md) completed against the recorded b8ea28550a291b766bf7ad9f3b63621e9f9efa81 source copy. Proposes one explicit expectation block bound to two supported core/witness fingerprint pairs: predecessor 1622, exact isolated candidate 1640 only; existing season fields suffice in a new isolated package, with completed-range/census consistency refusals and mandatory genuine 2026 census. No active reference/package/input/code changes or execution. Recovery and measurements reused, not repeated. Owner implementation/test-package approval and focused negative/positive proof remain required; successor DOB outcomes and Coleman winners/ties remain separate missing evidence. Full rehearsal BLOCKED; all three 2026 Brownlow keys pending, ET unresolved, authority/eligibility/ownership restrictions unchanged; ISSUE-316 OPEN; production NO-GO. This supersedes the prior request to authorize this design review only, not its execution blockers.
- **Rehearsal-only configuration preparation (2026-10-22; historical; superseded by the 2026-10-22 closure):** [Concrete proposal and all 30 stage/gate states](docs/v2/issue316-c2-rehearsal-configuration-review-2026-10-22.md) at exact implementation `b8ea28550a291b766bf7ad9f3b63621e9f9efa81`. New isolated `C:/tmp/afldb-c2-REHEARSAL-ONLY-config-b8ea2855-20261022/source/`: 2,290 exact Git blobs verified; four test configuration overrides, 2,286 other blobs unchanged; frozen inputs/manifests unchanged. Explicit shared `baseline_only`, matching candidate label, `supplements: []`, thirteen reviewed expectation mechanisms and all three correction scopes (including separate ladder-only Kangaroos) prepared. Test-only accepted selector conveys no canonical acceptance. Full runner BLOCKED: fixed 1,622 ladder gate versus rehearsal 1,640; 2026 season/census scope mismatch; missing 42 birth-date files, 42 DraftGuru pages and first-kick extract; successor DOB/Coleman and other dependent outcomes unverified. No guessed values, bypasses, runner/loader/network/host/database/census/WSL or Git mutation. Next: review exact four-file diff/hashes and resolve blockers offline; no executable full-runner scope at this pin and no rehearsal started. Historical roster/Wikipedia/parsed coaches remain “successor applicability unproven”; raw/coverage/disagreements/coach attribution and production decisions remain open. All refusals, informational jumpers, unresolved ET, pending/suppressed 2026 Brownlow, authority/eligibility/ownership restrictions preserved; 1,640 rehearsal-only; production NO-GO.
- **Supplemental input recovery (2026-10-22; historical; superseded by the 2026-10-22 closure):** Bounded one-agent native in-process assessment recovered **85/85 PASS, 0 FAIL, 0 MISSING** from exact manifest-relative files already retained in `D:/dev/afldbV2`: 21 DOB CSVs + 21 raw HTML (raw SHA-256; preserve CSV CRLF), 42 `annual-html-20260826` pages (raw SHA-256 and sizes), exact accepted first-kick extract (byte-level CRLF→LF hash; 334 rows/334 active IDs, exact clean-name join). No archive/DEV retrieval needed. New separate `C:/Users/stuar/AppData/Local/Temp/afldb-c2-REHEARSAL-ONLY-supplemental-recovery-20261022/` contains `RECOVERY_INVENTORY.json` (SHA-256 `b55f57892d479abafe2655735f95ef343138a29153f31b6c6cd1ad505023744f`), `REPORT.md`, unchanged binding copies and `SHA256SUMS.txt` (SHA-256 `d265e9e9b0976e5121077992be35dd0d3002f7ce044c99ff67c2d785797d3f5b`; 92 file entries); 17,185,694 input bytes copied/readback-verified. C:/tmp mkdir was denied EPERM; writable C: temporary area used. Existing configuration package unchanged and inputs **not merged**; its missing-input statements remain historical package-local facts. Retained records do **not** establish successor DOB expectations (13255/0/13255/0/2 remain predecessor pins) or candidate Coleman outcomes/ties (47 remains unmeasured assumption); no new target-dependent values calculated. Fixed 1622 versus rehearsal-only 1640 ladder gate and 2026 season/census conflict remain separate blockers. **Next proposal:** separately authorise offline design review of a fail-closed ladder expectation bound to an explicit accepted witness/core pair, preserving all other ladder gates and requiring focused 1622/1640 regression proof before any implementation/new commit; no execution or season/census waiver. No shell/Git/network/host/DB/WSL/install/acquisition/census/runner/stage/rehearsal/cleanup; source/contracts/active references and .codex/ untouched. All pending/suppressed 2026 Brownlow, source authority, eligibility, ownership, rejection and ET restrictions preserved; ISSUE-316 OPEN; production NO-GO.
- **Severity:** Medium. **Area:** data acquisition / source retirement — `data/reference/afltables-network.json`, `deploy/afldb-settle-afltables.sh`,
  `tools/rebuild/fitzroy/acquire_core.R`, `tools/rebuild/afltables/`, `src/lib/acquisition/settle-trigger.ts`, season rollover.
- **State:** Open (2026-10-18, owner change of direction). AFL Tables acceptance work stopped; T6 watcher and N1/N2 withdrawn (Windows task disabled,
  evidence preserved). Inventory, gap map and cutover procedure prepared. One fail-closed switch for every AFL Tables network path, bounded by
  `last_season` and retired by the 2026 rollover in the same write (machine-enforced), and a DB-free readiness report with season-feed venue, team and
  round coverage, implemented locally on `opus/afl-api-cutover` (uncommitted; the new suite 421 as last run (419 passed, 2 POSIX-only skipped; seven-suite set 829 passed, 2 skipped, 831), executed 2026-10-19 after the final pre-commit audit (follow-up 8) under proven isolation with `--no-cache --configLoader runner` and redirected `TEMP`/`TMP`; superseded history: 306 and 716 after follow-up 7, 293 and 703 after follow-up 5). The rollover accepts exactly `D-316-1`. C3 is inert
  install only; the D1 rehearsal is C4b, run by one command that restores the setting however it ends (`afl-api-c4b-rehearsal.ts`; the tool itself has never run on Linux, PostgreSQL or PROD, its tests have, DB-free, on Windows). D-316-13 is unavailable until C4 is deployed.
  Nothing deployed; the PROD AFL Tables timer is untouched; B1 stays.
- **V2 reconciliation (2026-10-21):** source/snapshot 19/19 verified; imported in `c9cca86d`; V2 quarantine/refusal intentional. Local focused 669 pass / 2 POSIX-only skip, packaged refusals 4/4, typecheck/lint PASS. No DEV/PROD execution; full C0/C1 and C2 pending.
- **DEV C1 shell subset (2026-10-21):** D-V2-316-C0C1-1 and D-DEV-316-C1-REFUSALS-1 approved; DEV refusal fixtures passed 4/4 (retired exit 0, out-of-bounds exit 1, runner exit 0) on `streamanator`. No active acquisition control, deployed app or audit behaviour verified.
- **DEV app-check preparation (historical, 2026-10-21):** read-only DEV baseline verified (ledger 110, pending exactly 111–117, ports 3201/3202 free); build `WkKKyr7KAoFmMb5QyM4MQ` of `fffef96f` packaged (sha256 `c829da08…e40b0e`) and locally rehearsed PASS on an isolated clone; no DEV writes during preparation. Plan and decision D-DEV-316-C1-APP-1: `docs/v2/issue316-dev-app-check-plan-2026-10-21.md`. Later attempt below supersedes the prepared status.
- **DEV app attempt (2026-10-21):** D-DEV-316-C1-APP-1 approved; identity/size/hash gates passed; steps 0–2 completed. STOP at step 3: exact archive contains an esbuild symlink despite the reviewed no-symlinks description. No extraction, package execution, DB connection, dump, migration or app check; port 3201 free; root/archive retained. DEV C1 NOT PASSED.
- **Amended continuation (2026-10-21):** owner permitted the exact sole esbuild link and retained-root reuse; amended safety checks, extraction without overwrite, all 13,209 hashes, preflight, secure config and read-only dump PASS. Source ledger/checksums 110/110, no synthetic users/audit rows; dump counts identical, hash rechecked. Candidate DB absent; no pid; port 3201 free. C1 PENDING.
- **DEV candidate C1 complete (2026-10-21):** owner confirmed creation; DB identity/owner/UTF8/locales/emptiness verified. Restore, migrations 111–117, privileges, checksum readback PASS. Real Super Admin action exact `legacy_retired` refusal + exactly one attributed audit row id 1100, loopback; N1/N2 zero audit rows. Original DEV guard unchanged, ledger/checksums 110/110, no synthetic writes. Candidate stopped, port 3201 free; DB/root/backup/C: evidence retained. Approved candidate acceptance PASS; no V1 replacement or production installation.
- **C2 offline review (2026-10-21):** completed inspection reused: identity/ledger 110/inspected ACLs match; 218 scored matches, GF Fremantle 89–96 Brisbane; latest snapshot still in_season_partial. R 4.3.3 meets R >=4.1 and all selected 56-package metadata constraints; later Node 22.23.2 meets locked loader requirements. Archive checksum/membership PASS; 1731 CRLF-only conversions recorded. Package source/native hashes and exact endpoints remain incomplete. No acquisition-ready artifact or C2 execution. Package: `docs/v2/issue316-c2-preparation-2026-10-21.md`.
- **CRAN source review (2026-10-21):** exact approved fitzRoy 1.8.0 download HTTP 200, 1222934 bytes, SHA-256 `33ed0817…8d0b54c`; safe extraction on restricted C:, no code execution. Reached endpoints: GitHub parquet (130 reads), live-tail season/match pages + GitHub mapping CSV, 21 AFL Tables club pages, bg3.txt (131 reads). No explicit retry/throttle/timeout; transport policy delegated. Source provenance in `docs/v2/issue316-c2-cran-source-2026-10-21.json`.
- **C2 consolidated decision (2026-10-21, package v4):** ready to request one approval, not executable-ready. DEV `streamanator` probe-first runner (R/fitzRoy there never inspected; negative probe stops, no install); unchanged acquisition recommended (sizes measured by pre-run HEAD, owner ceiling); stdlib run guard with canary replaces the three further source reviews. Gap: no existing gate requires completed-season stats to cover every results match; offline checks E1/E2/E4 run between acquisition steps, E3 (17056 matches) at Stage 2/3.
- **C2 bounded successor inputs (2026-10-21, package v5):** owner approved only the exact-evidence corrections/normalisations/four continuity extensions, historical comparison finding and local strict WF comparison. Acquired bytes rechecked 391/391; Brownlow 2026 pending. Current V2 validator reconstructs H&A+WF, removes only evidenced contributions and recomputes the full H&A table; focused DB-free verification recorded in the package. No successor acceptance/register or reference-switch change; 1,640 not approved.
- **Bounded DEV rehearsal (2026-10-21):** read-only preflight PASS, independently derived H&A club-season expectation 1,640 (not witness-derived). BLOCKED before cluster creation: full derived rebuild makes decided-GF 2026 complete and its Brownlow complete/not_applicable, so cannot preserve pending. Candidate bindings/gates/import/rebuild/real D7 NOT RUN; no database connection or DEV writes. Evidence `C:\tmp\afldb-c2-dev-rehearsal-20261021\REPORT.md`.
- **Pending-Brownlow fix (2026-10-21):** owner authorised code/tests/one commit and resumed isolated DEV rehearsal. Existing availability/publication decisions now gate full/targeted derived and authoritative public/medal/ranking projections; pending canonical match/round votes are not imported. No schema/reference/authority-metadata change. Focused checks 310 passed / 1 existing skip + 2 mutation contracts; typecheck/lint passed. Prior blocked attempt retained as history.
- **Exact-commit DEV rehearsal PASS (2026-10-21):** `4a2eea89`; genuine gates 3/3, 117 migrations/import/full derived/real D7 PASS. All 1,640 policy ladder rows agree, including both WF fixtures/all 18 2026 clubs and 1,622 ordinary rows. 669 2026 Brownlow player-seasons pending/NULL; zero canonical 2026 votes/publication/exposed rows. Historical 98 seasons/79,113 votes/112 winners unchanged. Own cluster stopped; raw/source hashes unchanged; C: evidence `afldb-c2-brownlow-fix-20261021`.
- **Runbook:** `issues/open/AFLDB-ISSUE-316.md`. **Next action:** record owner decisions N1–N11 and decide whether to authorise one offline drafting of the production-successor proposal, using the table and prompt in the [successor decision package](docs/v2/issue316-c2-successor-decision-2026-10-21.md#current-state-and-remaining-decisions--2026-10-22); N12–N16 (census targets, rollover, release, harness trust boundary, retention) are listed and not yet asked. The `baseline_only` configuration proposal this line used to name was prepared, executed and closed by the rehearsal PASS. No production acceptance or reference change. ET unresolved; all three 2026 Brownlow keys pending; authority/eligibility/ownership restrictions unchanged; 1,640 rehearsal-only; production NO-GO. Earlier bullets are chronological checkpoints.

- **Height goal verification (2026-10-21; retained evidence):** [Targeted public-page review](docs/v2/issue316-c2-height-goal-verification-2026-10-21.md) confirms returned register values 22/blank/34/181 and same-publisher profile/season values 18/4/35/180 at Collingwood scope, with explicit cache limits and Victor profile access failure. All four causes/historical totals remain unresolved; no correction or approved exception. The earlier predecessor hash check remains incomplete. Historical goal adjudication remains separate; preserve refusals and blank versus zero. (Historical: the implementation proposal named here was later approved, implemented and superseded.) All successor/applicability decisions pending; production NO-GO.
- **Supplement-free proposal (2026-10-21; historical proposal checkpoint):** Owner permits further candidate assessment with all unmatched/name_mismatch rows still rejected, including the four unresolved Collingwood goal cases; jumper disagreements remain informational. Review the [supplement-free implementation proposal](docs/v2/issue316-c2-supplement-free-proposal-2026-10-21.md) for the bounded runner/test scope. No implementation or stage authority; successor/canonical evidence and all applicability decisions remain pending; production NO-GO.
- **Supplement-free implementation (2026-10-21; historical; superseded by the 2026-10-22 closure):** Owner approved proposal §§3–5 and database-free affected checks, one agent, basis `4a2eea89cccc465f2f017fb06ad55a7d4cb7733d`. Local runner/tests now support explicit `stats_input_mode` (`supplemented_baseline` / `baseline_only`); baseline-only requires explicit `supplements: []` plus a matching selected `baseline_snapshot_label`. Heights/coaches intentionally share these stats inputs. Legacy supplemented argv/order, manifest proofs, measured expectations and all strict final gates remain. Synthetic configuration only; no successor contract installed. Focused runner 38/38; height/coach suites 27/27; nonincremental `tsc --noEmit --incremental false` exit 0. Full runner 700 passed / 4 existing CLI tests failed at tsx startup (`uv_os_get_passwd ENOMEM`), before CLI execution. Changed-file lint: 8 errors / 13 warnings, exactly reproduced on basis blobs (no new findings); `git diff --check` clean. Bounded review 2026-10-22 found no material correctness/gate issue; scoped local commit authorised. Next: separately approve construction of a provenance-bound canonical export from an isolated clone of retained stopped rehearsal state (runbook §12); no execution/binding approval. All unmatched/name_mismatch rows, including four unresolved Collingwood goal discrepancies, stay rejected; jumpers informational; ET unresolved; all three 2026 Brownlow keys pending; production NO-GO.
- **Sequential measurement prerequisites (2026-10-22; historical checkpoint, superseded below):** Offline [prerequisite review](docs/v2/issue316-c2-sequential-measurement-prerequisites-2026-10-22.md) (basis `b8ea2855`; static reading, no hashing/execution). Roster and coach manifest pins equal the retained bindings; coach `contract_coaches_version`/family satisfied; coach raw files are required by no applicable gate (loader verifies raw only if `raw/` exists). Runner path stays **BLOCKED**: contract lacks `baseline_only` and its integers, c2 is not the accepted baseline, and roster/coach measured pins (1,824; 32,034/15,817) differ from planning counts (1,916; 32,470/16,035). Wikipedia CSV has no tracked hash pin (tracked in git only); successor coverage of all three inputs unproven. Next: owner decisions D1–D5, then (separately authorised) one direct-loader exploratory clone-only sequential run; no runner, contract edit or acceptance. Rejected height matches, jumpers informational, ET unresolved, 2026 Brownlow pending, 1,640 rehearsal-only; production NO-GO.

- **Sequential measurement offline review (2026-10-22; historical; superseded by the 2026-10-22 closure):** [Reviewed persisted evidence](docs/v2/issue316-c2-sequential-measurement-review-2026-10-22.md) at implementation `b8ea28550a291b766bf7ad9f3b63621e9f9efa81`; canonical state built under `4a2eea89`. Native in-process SHA-256 checks PASS: sequential 236/236, planning 307/307, canonical export 38/38, bound input tree 162/162. Actual final CSV recount reproduces all five height / eight coach values; NULL-only fills and batch/source links verified. Seven coach planning counters and planned height/API sets reproduce; all thirteen were not measured in planning. Zero open height_conflict records does not mean agreement (737 API / 24 Wikipedia differences). Ten coach discrepancies remain observations: finals arithmetic is not proven page omission; Carter exclusivity withdrawn, Adamson attribution unresolved. Delete counter +89 remains unattributed. Fingerprints cover 106 ordinary tables plus one player-height entry; snapshot equality is not a write audit. Retained shutdown supported; 85 authorised connections corrects 84. Next: owner input/raw/rejection/attribution choices and an offline rehearsal-only baseline_only configuration proposal (§§7–8), then separately authorised fresh exact-commit runner rehearsal. No bindings installed or production choices approved; ET unresolved, all three 2026 Brownlow keys pending, authority/eligibility/ownership restrictions unchanged; 1,640 rehearsal-only; production NO-GO.

### AFLDB-ISSUE-321 — Deferred successor source data-quality questions
- **Severity:** Low. **Area:** source provenance / data quality: `match_coaches`, AFL API roster identity, height and
  goal evidence.
- **State:** Open (2026-10-23). Split out of ISSUE-319 when the owner decided its questions; gates nothing.
  - NM 1940 R8–R18 unattributed (joint Carter + Adamson needs a multi-coach design, deferred).
  - 479 unmapped roster ids excluded; no name inference.
  - Caps goals, 737 AFL API / 24 Wikipedia height differences and 18 rejections evidence-only; authority unchanged.
  - Roster completeness unvalidated, raw not retained; N2/N3 and the +89 delete counter retained.
- **Key files:** `issues.md` entry; evidence `C:/tmp/afldb-c2-SUCCESSOR-READINESS-E-20261023/source-evidence/` and
  `C:/tmp/afldb-c2-REHEARSAL-V3-15e43562-20261023T0017Z/source-evidence-319/`.
- **Next:** none scheduled; only on new evidence or an owner request.

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
