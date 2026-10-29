# Owner decision D-V2-SCOPE-20261027: separate V2 engineering completion from release acceptance

**Status: APPROVED WITH AMENDMENTS by the owner on 2026-10-27, and applied the same day (documentation only).**
The owner explicitly supersedes the earlier closure conditions **for V2 only**. Thirteen issues are closed (§3). Three
stay open, and the V2 open count is 3. **No deployment, DEV acceptance or PROD acceptance is claimed by this decision.**
Every unmet operational requirement stays in §4.

Scope kept: no host, database, deployment, rebuild, test, Git operation, push or commit. ISSUE-316's frozen P/H,
readiness worktrees, evidence and approved 27 October 13:00–15:00 AEDT window are untouched. The source checkout is
unchanged, and its ISSUE-327 stays parked there.

## 1. Audit result that led to the decision

No issue met its recorded criterion. Each was held by a live-environment, seasonal or owner step. For example, 276
runbook §17.4 items 1–4 were met, but D-OBS-274276-20261014 kept it open for PROD, and 270 required PROD acceptance
before closure. This decision replaces those conditions for V2 only.

## 2. V2 facts the decision rests on (verified read-only, 2026-10-27)

- **Every fix is in V2.** These fix commits are ancestors of the V2 fork point `ff100dc2`:

  | Commit | Issue |
  |---|---|
  | `077af7ee` | 266 |
  | `86e2d19f` | 267, 269 |
  | `5659f789` | 268 |
  | `b239e0ac` | 270 |
  | `d37c1422` | 271, 272 |
  | `a34f0721` | 273 |
  | `6f99b58d` | 274 |
  | `24ca412b` | 275 |
  | `3ec76f28` | 276 |
  | `cf1d49c3` | 279 |

  `e91fae88` (328) is V2's own commit.
- **Files V2 has not changed.** No V2 commit touches `tools/migration/common.py`, `src/lib/ingest/datasets.ts`,
  `src/lib/ingest/pipeline.ts`, the invite action or query, `canonical-apply.ts` or `afl-api-settle-plan.ts`.
- **Files V2 has changed.** `afl-api-bundle.ts` once (`99a1165c`, Brownlow eligibility), and `fetch_and_stage.py`
  twice (its retirement, below).
- **V2's own local proof.** The run is `docs/v2/evidence/local-supported-tests-delivered.json` (20 Oct). Overall it
  was not green: 13,740 passed, 9 failed, 31 skipped. Every file carrying these issues' cases passed:

  | File | Result | Cases for these issues |
  |---|---|---|
  | `match-results-promotion` | 46/46 | 271: 6, 268: 7 |
  | `ingest-datasets` | 305/305 | 271: 43, 268: 82, 272: 22 |
  | `admin-lifecycle` (integration) | 37/37 | 270: 16 |
  | `auth` | 203/203 | 270: 34 |
  | `data-editor` | 51 passed, 1 skipped | 267: 6, 269: 1 |
  | `submission-promotion` | 21/21 | 273: 13 |
  | `submission-review-actions` | 42/42 | 273: 17 |
  | `settle-afltables` | 85/85 | 274: 6, 275: 2 |
  | `current-season-import` | 356 passed, 4 skipped | 274: 32, 275: 15 |
  | `settle-afl-api-issue276` | 4/4 | 276: 4 |
  | `afl-api-settle-plan` | 55/55 | 276: 8 |

  279's `tests/seo.test.ts` result and 328's 58/58 are recorded in their own entries.
- **V2 retires the legacy intake runtime** (`docs/v2/legacy-disposition.md` L1–L3):
  - The CSV upload route and the email-intake route answer 410 without reading the body.
  - The submission actions refuse (`src/app/admin/submissions/[id]/actions.ts:27-39`).
  - `tools/email_intake/fetch_and_stage.py` is a refusing shim.
  - `pipeline.ts` has no non-test importer. The only non-test importer of `datasets.ts` is the offline
    `tools/records/import-first-kick-goal.ts:78` (`resolveClub`, `resolvePlayer` only).
- **Still live in V2:**
  - 267/269: `tools/migration/import_fitzroy_core.py:3636`, in the sealed historical rebuild.
  - 270: admin invites.
  - 274/275: `canonical-apply.ts`.
  - 276: the AFL API settle.
  - 279: the sitemap.
  - 328: `/admin/current-season`.
- **Installation records and V2 release status are kept apart.** Each issue's historical installation records (for
  example its DEV installation by the source repository's lifecycle) stay exactly as written in its entry. This
  decision makes **no claim about what PROD currently runs**. Separately, V2 is not released: its production go/no-go is
  NO-GO, and closing these issues claims no deployment and no PROD acceptance.

## 3. The decision as approved

| Class | Issues | Closure scope |
|---|---|---|
| **V2 engineering complete** | 267, 269, 270, 274, 275, 276, 279, 328 | Resolved 2026-10-27, V2-scoped: the code is in `v2/rebuild` and validated as recorded. Live acceptance is carried into §4, not waived and not claimed. |
| **Superseded by retired V2 runtime paths** | 266, 268, 271, 272, 273 | Resolved 2026-10-27: V2 refuses the defective paths, and the fixed code is retained. Their DEV and PROD acceptance lapses for V2 and is not claimed as met. The non-gating follow-ups lapse with the path: D-268-1, D-268-3, 271 F4/F5, and 272's optional PROD census. ISSUE-271's owner-accepted local engineering and local acceptance ruling stands as its engineering record. |
| **Kept open** | 229, 316, 321 | 229: B2 is seasonal and external, and the writer may change on 2027 evidence. 316: active and frozen. 321: deferred backlog. |

**Amendments (owner):**
1. Outstanding operational acceptance stays in §4. No deployment or PROD acceptance is claimed.
2. The earlier assertion that "PROD has none of these fixes installed" is withdrawn as unsupported. Historical
   installation records are kept apart from V2 release status (§2).
3. ISSUE-279's `window-279.sh` (combined procedure `AFLDB-ISSUE-280-308-279-DEV-ACCEPTANCE.md` §6, runbook §20) is
   **WITHDRAWN / UNSAFE**. No settings-window authority is granted.
4. The proposed blanket restriction on legacy CSV use on PROD before V2 (old checklist item 10) is **not adopted**.
5. The missing venue-season draft registration task is **dropped**. That subject is tracked by the source repository's
   ISSUE-327, which is already tracked and parked in the source checkout. No duplicate investigation is made in V2.

Historical-impact assessments for 267, 268, 269, 271 and 272 stay **unassessed**. They are not closure gates, and closure
does not assert that no historical damage exists.

## 4. Consolidated operational acceptance checklist (outstanding; nothing here is claimed as done)

| # | Requirement | Issues | Source |
|---|---|---|---|
| 1 | A reviewed PROD installation procedure (R6), then the V2 production release per `docs/v2/cutover-runbook.md` and `docs/v2/go-no-go.md` (currently NO-GO) | all 13 closed | blockers R6; go-no-go |
| 2 | Before any production promotion or reload, the override census (`issues/closed/AFLDB-ISSUE-267-269-override-census.sql`) shows no section-3/4 row. After installation, verify the installed `tools/migration/common.py` | 267, 269 | 267 runbook §17.15 |
| 3 | On PROD, verify the installed invite-redemption code. Optional and not done: restricted `afldb_auth` evidence and an end-to-end Server Action run against a real database | 270 | 270 runbook §19–§20 |
| 4 | After installation, the first PROD AFL API nightly shows no regression: refusal counts, no failure, deadlock or lock-timeout marker, and its revision attributed. Lock execution, the 276 guard branch and contention stay NOT OBSERVED on live data | 274, 275, 276 | 274 §33.10, 275 §51, 276 §17.10 |
| 5 | 275's PROD split-ownership census is already DONE (15 Oct, §34). Nothing is owed | 275 | 275 §34 |
| 6 | A live check that `/sitemap/0.xml` contains at least one `<url>` once indexing is on, with restoration verified, by a method yet to be proposed and approved. `window-279.sh` is WITHDRAWN / UNSAFE, and no settings-window authority exists | 279 | 279 runbook §14 item 2, §20 |
| 7 | `/admin/current-season` names the true latest AFL API and AFL Tables batches (needs deploy authority) | 328 | 328 entry |
| 8 | B2: capture the first authentic 2027 pre-match feed, run validate-only and a dry run, then the owner approves the first apply | 229 (open) | 229 runbook; V2-GAP-008 |
| 9 | `afldb-email-intake.timer` disabled on every host at or before the V2 release (cutover step 4, V2-GAP-013). No intake activation on any pre-V2 host without 266 runbook §18.6 | 266, 273 | 266 §18.6, §18.10.8; legacy-disposition L3 |
| 10 | ISSUE-316: the approved readiness proof window, then its separate apply and activation decisions | 316 (open) | 316 runbook |
| 11 | Housekeeping the owner already holds: the DEV `.env` backup, retained `AFLDB_TRACE_REQUESTS=on`, the kept readiness worktree and branch, and staging copies | 272 | 272 runbook §17.18 |
