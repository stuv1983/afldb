# Owner visual review checklist — D-V2-VISUAL-1 (V2-GAP-022, gate 3)

**Prepared 2026-10-29 for the owner's review. Nothing here is accepted.** Only the owner's own per-screen
verdict counts. Prose approval is not evidence, and no agent verdict stands in for the owner. V2-GAP-022
stays **OPEN** until the owner records verdicts.

Acceptance criteria come from [admin-operations](admin-operations.md) §1–§6. Four criteria apply to **every**
screen:
- **(G1)** it is readable at both 1280x800 and 390x844, wide tables scroll inside their own box, and nothing
  overlaps or hides a required action;
- **(G2)** the role difference is visible: Admin sees no Super-Admin-only control;
- **(G3)** every mutation form shows its "Before you submit" card (will change, affects, validation,
  reversible, acting user, audit entries) above its submit button;
- **(G4)** status wording is unambiguous: a proposal is never presented as a publication, and a missing
  statistic or missing host status is stated, never shown as zero.

## 1. Do the screenshots match the candidate (`461f4372`)?

The captures are full-page images from the production build, rendered against an isolated database with
synthetic staff and data:
- `evidence/launchF-visual/` was captured at `36679a1e` on 2026-10-19;
- `evidence/local-visual/` holds four recaptures of screens 08 and 09, made from the final build of
  2026-10-20 (`c698de52`).

The capture log records HTTP 200, 0 overflow and 0 console errors for every capture. Since those captures,
no layout, CSS, sidebar or shared admin component has changed. Only these rendering changes affect the
screens:

| Change since capture | Screens it makes STALE |
|---|---|
| `c78e9e9b` (2026-10-28): new "AFL API settle refusals" inspection link and page (V2-GAP-025) | 01, 02; the new page has only dev-server captures (§3 item 9) |
| `367bfb54` (2026-10-20): staged leaderboard and provider-team mapping (V2-GAP-023). The captured "API leaderboard is not staged (F-WB1-005)… no staged table" notice is now worded per season | 08, 09, including both `local-visual` recaptures |
| `99a1165c` (2026-10-20): Brownlow eligibility is eligible / ineligible / unknown | 08, 09 |
| `e91fae88` (ISSUE-328): the latest settle batch is ordered numerically. This changes which data is shown, not the layout | 10 is still representative |

**Recapturing needs a production build**, which this session was not authorised to run. For the stale and
missing screens, the owner can choose either route:
- review them live, signed in on an isolated environment, as §6 already provides; or
- authorise a recapture of the candidate.

## 2. Screen by screen

Mark each row ACCEPT, REJECT (with the defect) or NOT REVIEWED. A rejected screen becomes a tracked defect.
Any code fix re-opens the artifact lock (choice 3).

| # | Screen and role | Captures (desktop / mobile) | Matches candidate? | Accept if, in addition to G1–G4 | Verdict |
|---|---|---|---|---|---|
| 01 | `/admin/operations`, Super Admin | [desktop](evidence/launchF-visual/01-operations__desktop-1280x800.png) / [mobile](evidence/launchF-visual/01-operations__mobile-390x844.png) | **STALE**: no refusals link | Read-only page: no form and no start button anywhere. Shows coverage counts by status and family, sealed seasons, run status only (AFL Tables settle labelled as still running behind ISSUE-316), awards links with the undecided count, and inspection links | |
| 02 | `/admin/operations`, Admin | [desktop](evidence/launchF-visual/02-operations-admin__desktop-1280x800.png) / [mobile](evidence/launchF-visual/02-operations-admin__mobile-390x844.png) | **STALE**: as 01 | As 01, but only links for capabilities Admin holds | |
| 03 | `/admin/operations/awards`, populated queue, Super Admin | [desktop](evidence/launchF-visual/03-awards-queue__desktop-1280x800.png) / [mobile](evidence/launchF-visual/03-awards-queue__mobile-390x844.png) | yes | Each status is distinct. The create form says it creates proposals only ("nothing is approved") and refuses an invalid file as a whole | |
| 04 | `/admin/operations/awards/1`, validated proposal, Super Admin decision panel | [desktop](evidence/launchF-visual/04-proposal-validated-decide__desktop-1280x800.png) / [mobile](evidence/launchF-visual/04-proposal-validated-decide__mobile-390x844.png) | yes | Validate, approve and reject are separate, each with its own card. Approve is marked NOT REVERSIBLE. The four-eyes notice and self-approval attestation are shown. Reject requires a reason of at least 10 characters | |
| 05 | `/admin/operations/awards/1`, Admin (read-only) | [desktop](evidence/launchF-visual/05-proposal-validated-readonly__desktop-1280x800.png) / [mobile](evidence/launchF-visual/05-proposal-validated-readonly__mobile-390x844.png) | yes | No decision controls | |
| 06 | `/admin/operations/awards/3`, rejected, with history | [desktop](evidence/launchF-visual/06-proposal-rejected-history__desktop-1280x800.png) / [mobile](evidence/launchF-visual/06-proposal-rejected-history__mobile-390x844.png) | yes | Rejection is explicit and terminal; the ledger history is append-only and is not shown as a publication | |
| 07 | `/admin/operations/coleman`, before compare, with the publish form | [desktop](evidence/launchF-visual/07-coleman__desktop-1280x800.png) / [mobile](evidence/launchF-visual/07-coleman__mobile-390x844.png) | yes | Compare is labelled read-only. Publish requires the "settled" attestation and a 20–2000 character note, and is marked NOT REVERSIBLE. A missing goal is never counted as zero | |
| 08 | `/admin/operations/brownlow`, no season chosen | [desktop](evidence/local-visual/08-brownlow__1280.png) / [mobile](evidence/local-visual/08-brownlow__390.png) (superseded: [desktop](evidence/launchF-visual/08-brownlow__desktop-1280x800.png) / [mobile](evidence/launchF-visual/08-brownlow__mobile-390x844.png)) | **STALE**: notice wording | The reconciliation only reads. The diagnostic rule is clearly separate from the ADR 0014 medal determination. The leaderboard state is stated per season | |
| 09 | `/admin/operations/brownlow`, 2025 reconciled | [desktop](evidence/local-visual/09-brownlow-2025__1280.png) / [mobile](evidence/local-visual/09-brownlow-2025__390.png) (superseded: [desktop](evidence/launchF-visual/09-brownlow-2025__desktop-1280x800.png) / [mobile](evidence/launchF-visual/09-brownlow-2025__mobile-390x844.png)) | **STALE**: leaderboard, mapping and eligibility | Shows the outcome, findings by severity, the raw leaderboard with each player's eligibility and its source, and the leaderboard and 18-team mapping (or its refusal codes). It names no winner unless the result is `determined`, and says when the stored `is_winner` flags disagree | |
| 10 | `/admin/current-season` | [desktop](evidence/launchF-visual/10-current-season__desktop-1280x800.png) / [mobile](evidence/launchF-visual/10-current-season__mobile-390x844.png) | yes (layout) | Only the AFL API switches and settle units remain. Missing host status reads "not available". There is no legacy start control | |
| 11 | `/admin/upload` | [desktop](evidence/launchF-visual/11-upload-retired__desktop-1280x800.png) / [mobile](evidence/launchF-visual/11-upload-retired__mobile-390x844.png) | yes | A retirement notice, and no working upload | |
| 12 | `/admin` | [desktop](evidence/launchF-visual/12-admin-home__desktop-1280x800.png) / [mobile](evidence/launchF-visual/12-admin-home__mobile-390x844.png) | yes | No review notice; the submissions log is read-only | |
| 13 | `/admin/fixtures` (beyond §6) | [desktop](evidence/launchF-visual/13-fixtures__desktop-1280x800.png) / [mobile](evidence/launchF-visual/13-fixtures__mobile-390x844.png) | yes | Route and action wording are readable | |
| S | Sidebar, Admin and Super Admin | Super Admin in 01, 03, 04 and 06–13; Admin in 02 and 05 | yes | "Operations centre" is in the Overview group for both roles; the "Legacy file intake" link is gone | |

## 3. Coverage gaps: §6 states with no capture

These must be reviewed live, recaptured, or explicitly left out by the owner. An agent cannot accept them.

| §6 item | Missing state |
|---|---|
| 9 | `/admin/operations/afl-api-refusals`. **Correction (2026-10-29):** it is not uncaptured. [`evidence/gap025-visual/`](evidence/gap025-visual/capture-log.txt) holds 14 captures from 2026-10-27 (`c78e9e9b`): both sections empty and populated, the second page, a failed read and the right-hand columns, at both viewports. They come from `next dev`, **not a production build**. No admin page or component has changed since `c78e9e9b`. Needed: both sections populated and empty, a second page, and a failed read. It must be read-only, newest first, 50 per page, and show codes, never values |
| 7 | `/admin/submissions/[id]`, the read-only history |
| 1 | The overview with `data/reference/seasons.json` unreadable. Every approval must be refused (fail closed). §6 asks for this "if practical" |
| 2 | The empty award queue |
| 3 | A sealed-season approval and its refusal (04 shows an open season); the "Revise approved winner" panel on an approved proposal |
| 4 | Coleman: a derivable comparison, a refusal, the `award_winners` preview and the publish outcome (07 shows only "before compare") |
| 5 | Brownlow: a refused season; determinations `determined`, tie and `requires_review`; the eligibility decision form (Super Admin) with its success and error states |

## 4. Recording the result

The owner returns per-screen verdicts in this form. Strike the screens not reviewed:

```text
D-V2-VISUAL-1 — owner visual review of docs/v2/owner-visual-review-2026-10-29.md.
Reviewed by: <live on isolated environment | screenshots> at <desktop and mobile>.
ACCEPT: <screen numbers>
REJECT: <screen number — defect>
NOT REVIEWED / OUT OF SCOPE: <screen numbers or §3 items, with reason>
```

V2-GAP-022 closes only if every §2 row and §3 item is accepted or explicitly put out of scope by the owner.
Otherwise it is narrowed to what remains.

## 5. Recapture proposal (prepared 2026-10-29; NOT RUN, needs its own approval)

The smallest run that replaces every stale capture with a production-build capture of the candidate. No build or
environment start was performed in preparing it. Visual acceptance remains the owner's.

| Item | Value |
|---|---|
| Environment | The isolated local cluster `afldb_v2_isolated`, root `D:\tmp\afldb-v2-pg16`, loopback **127.0.0.1:55433** (55432 is an ssh tunnel; never use it). Windows workstation, no network beyond loopback |
| Database | New disposable **`afldb_v2_visual2_test`**, cloned with `isolated-pg.ts create-db --template afldb_v2_rollbackapp_test`. The template is the database behind the 2026-10-20 `local-visual` 08/09 recaptures (`local-rollback-10-v2-final-capture.json`). It holds synthetic staff, 3 proposals / 6 decisions and the 2025 staged Brownlow state that 09 needs. **If `list` does not show the template, stop:** no substitute database is improvised. The clone is migrated to 117 with the candidate runner. The template is not touched |
| Build | `tools/v2/local-release.mjs build v2` inside `isolated-pg run`: `next build --webpack` then `prepare-standalone`, `NEXT_TELEMETRY_DISABLED=1`, installed `node_modules` only (no download), at the then-current `v2/rebuild` HEAD with no uncommitted application change. Expect about 1,516 prerendered pages |
| Runtime | `local-release.mjs start v2` serves the standalone build on **127.0.0.1:3912** against the same clone |
| Capture tool | [`tools/v2/candidate-visual-capture.mts`](../../tools/v2/candidate-visual-capture.mts) (added 2026-10-29, not yet run). It refuses an existing output directory, so `launchF-visual`, `local-visual` and `gap025-visual` cannot be overwritten. It blocks and counts external requests, fingerprints statistical and audit tables before and after, and writes a `capture-log.txt` in the launchF format |
| Pages (12 images) | Super Admin: **01** `/admin/operations`; **08** `/admin/operations/brownlow`; **09** `/admin/operations/brownlow?season=2025`; **R1** `/admin/operations/afl-api-refusals`; **R2** `…?section=findings` (empty states, production build). Admin: **02** `/admin/operations`. Each at 1280x800 and 390x844 |
| Output | `docs/v2/evidence/candidate-visual-<YYYYMMDD>/` |
| Not covered | §3 items 1–5 and 7, and the refusals page's populated, second-page and failed-read states in a production build. Each needs state fixtures. Cover them by live owner review on the same running build, or by the `gap025-visual` dev-server captures for item 9 if the owner accepts those, or put them out of scope |

Commands (PowerShell, repository root; `T` abbreviates the runner prefix):

```powershell
$env:AFLDB_V2_PG_ROOT = 'D:\tmp\afldb-v2-pg16'; $env:AFLDB_V2_PG_PORT = '55433'
& D:\tmp\afldb-v2-pg16\dist\pgsql\bin\pg_ctl.exe -D D:\tmp\afldb-v2-pg16\data -l D:\tmp\afldb-v2-pg16\logs\server.log -o "-p 55433" -w start
$T = 'node_modules/tsx/dist/cli.mjs'
node $T tools/v2/isolated-pg.ts list                       # template present? otherwise stop
node $T tools/v2/isolated-pg.ts create-db afldb_v2_visual2_test --template afldb_v2_rollbackapp_test
node $T tools/v2/isolated-pg.ts run afldb_v2_visual2_test -- node $T tools/db/migrate.ts --target test
node $T tools/v2/isolated-pg.ts run afldb_v2_visual2_test -- node tools/v2/local-release.mjs build v2
# separate window or background:
node $T tools/v2/isolated-pg.ts run afldb_v2_visual2_test -- node tools/v2/local-release.mjs start v2
node $T tools/v2/isolated-pg.ts run afldb_v2_visual2_test -- node $T tools/v2/candidate-visual-capture.mts docs/v2/evidence/candidate-visual-<YYYYMMDD>
# afterwards: stop the server (Ctrl+C), then
& D:\tmp\afldb-v2-pg16\dist\pgsql\bin\pg_ctl.exe -D D:\tmp\afldb-v2-pg16\data -w stop
```

Approval, ready to copy:

```text
D-V2-VISUAL-RECAPTURE-1 — APPROVED as prepared in docs/v2/owner-visual-review-2026-10-29.md §5:
start the isolated cluster afldb_v2_isolated on 127.0.0.1:55433; clone afldb_v2_rollbackapp_test to the
disposable afldb_v2_visual2_test and migrate the clone only; one production-configured build of v2/rebuild
HEAD <commit> with telemetry off; serve it on 127.0.0.1:3912; run tools/v2/candidate-visual-capture.mts once
into a new docs/v2/evidence/candidate-visual-<YYYYMMDD>/; stop server and cluster; commit the captures locally.
Not approved: any other database, any network beyond loopback, overwriting retained evidence, an agent visual
verdict, a push or any production action. Visual acceptance stays with the owner (D-V2-VISUAL-1).
```
