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
| `c78e9e9b` (2026-10-28): new "AFL API settle refusals" inspection link and page (V2-GAP-025) | 01, 02; the new page has **no capture** |
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
| 9 | `/admin/operations/afl-api-refusals`: **no capture at all**. Needed: both sections populated and empty, a second page, and a failed read. It must be read-only, newest first, 50 per page, and show codes, never values |
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
