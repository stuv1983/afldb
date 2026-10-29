# Owner visual review sheet — candidate `592c6c16` (D-V2-VISUAL-1, V2-GAP-022)

**Prepared 2026-10-29 for the owner. Nothing here is accepted.** This sheet supersedes the screenshot links of
[owner-visual-review-2026-10-29.md](owner-visual-review-2026-10-29.md) (kept as history). The automated checks
below are evidence, not acceptance. No agent verdict stands in for the owner's, and V2-GAP-022 stays **OPEN**
until the owner returns §6.

## 0. What the captures represent

| Item | Value |
|---|---|
| Candidate | `592c6c168c59fd7daa130a795d6dd6e02c3afdd3` (`v2/rebuild`). No application file changed in this run |
| Build | One production build: `next build --webpack` + `prepare-standalone`, `NEXT_TELEMETRY_DISABLED=1`, installed tools only. BUILD_ID `ivryI9oSx3g1fpqeB65oJ`, 1516/1516 pages. Served standalone on 127.0.0.1:3912 |
| Database | Disposable `afldb_v2_visual2_test`, cloned from `afldb_v2_rollbackapp_test` on `afldb_v2_isolated` (127.0.0.1:55433) and migrated 115 → 117. Identity and isolation were proven before any write. The template was not touched. The clone is retained (stopped) in the state §5 describes |
| Staff | Synthetic `candidate-visual-super_admin@example.invalid` and `candidate-visual-admin@example.invalid`, signed in by a locally minted session |
| Checks per capture | HTTP status, final URL, page-level horizontal overflow (with the overflowing element named), console/page errors, required and forbidden controls, and external requests (blocked and counted: **0** in every context) |
| Viewports | 1280x800 and 390x844, full-page. On mobile, the site's fixed bottom bar (Home · Players · Clubs · Seasons · More) appears once partway down each image. This is how a full-page capture draws a fixed bar, not a layout defect |
| Logs | [phase A](evidence/candidate-visual-20261029/capture-log.txt) (read-only, history fingerprint unchanged) · [pass 1](evidence/candidate-visual-20261029-states/capture-log.txt) · [pass 2](evidence/candidate-visual-20261029-states2/capture-log.txt) (fixtures and test actions, §5) |

Folders: **A** = `evidence/candidate-visual-20261029/` (`tools/v2/candidate-visual-capture.mts`, unchanged);
**P1** = `evidence/candidate-visual-20261029-states/` (`tools/v2/candidate-visual-states.mts` at `20994849`);
**P2** = `evidence/candidate-visual-20261029-states2/` (the same tool, pass 2). Pass 1's action-outcome images
were taken while the page was scrolled, so the sticky header and sidebar are drawn partway down them. Pass 2
fixed this and re-produced each of those states on an equivalent record. Only the clean images are linked
below.

## 1. Defects found (tracked separately; the candidate was NOT changed)

| Gap | Severity | Defect | Seen in |
|---|---|---|---|
| [V2-GAP-036](known-gaps.md) | **High** | The standalone production bundle omits `data/reference/coleman-derivation.json`. `server.js` changes directory to `.next/standalone`, and the Coleman page's file trace includes `seasons.json` but not the contract. **Every Coleman compare and publish is refused** (`coleman_contract_unavailable`). Production runs this same bundle (`deploy/server-cluster.mjs`) | P2 K1–K4 |
| [V2-GAP-037](known-gaps.md) | Medium | Loader refusals render the raw `ENOENT` message, which includes the **absolute server path** (`'D:\dev\afldbV2\.next\standalone\data\reference\…'`), into the page. This contradicts the "generic text, the thrown message is logged" rule (admin-operations §2). The unbroken path also overflows the 390px page by 13px | P2 K1, U5 (mobile) |
| [V2-GAP-038](known-gaps.md) | Low | At 390px the Brownlow "Award-result presentation" status token `refused_eligibility_rule_unrecorded` (monospace, unbreakable) widens the page by **28px**. It appears whenever the default `unrecorded` rule refuses (G1) | P2 S03, B9, B10, B11 (mobile) |

Observation, not graded (for the owner's G4 judgement): when a stored row has no eligible rank (P2 B6), the
determination says player 8354 is "unknown (not recorded)", while the reconciliation's "Raw vote totals" on the
same page lists the same player as "eligible". The reconciliation reads only `is_ineligible`.

## 2. Screen by screen (§2 of the earlier checklist)

Criteria G1–G4 (earlier checklist, top) apply to every row. Mark each row ACCEPT, REJECT (with the defect) or NOT REVIEWED.

| # | Screen and role | Current captures (desktop / mobile) | Accept if, in addition to G1–G4 | Verdict |
|---|---|---|---|---|
| 01 | `/admin/operations`, Super Admin | A [d](evidence/candidate-visual-20261029/01-operations__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029/01-operations__mobile-390x844.png) | Read-only, no form or start button. Coverage counts, sealed seasons (1897–2026, 2027 in progress), run status (AFL Tables settle labelled behind ISSUE-316), awards links with the undecided count, and inspection links including "AFL API settle refusals" | |
| 02 | `/admin/operations`, Admin | A [d](evidence/candidate-visual-20261029/02-operations-admin__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029/02-operations-admin__mobile-390x844.png) | As 01, with only the links Admin holds (audit trail, Brownlow administration, refusals) | |
| 03 | `/admin/operations/awards`, populated queue | Super Admin: [launchF d](evidence/launchF-visual/03-awards-queue__desktop-1280x800.png) / [m](evidence/launchF-visual/03-awards-queue__mobile-390x844.png) (unchanged since); Admin: P1 [d](evidence/candidate-visual-20261029-states/S01-awards-queue-admin__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states/S01-awards-queue-admin__mobile-390x844.png) | Each status is distinct. Create form for Super Admin only. Admin sees no create form | |
| 04 | `/admin/operations/awards/[id]`, validated, Super Admin decision panel | P2 A10 validate outcome [d](evidence/candidate-visual-20261029-states2/A10-validate-outcome__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/A10-validate-outcome__mobile-390x844.png) | Validate, approve and reject are separate, each with its own card. Approve is NOT REVERSIBLE. Four-eyes notice shown. Reject needs at least 10 characters | |
| 05 | `/admin/operations/awards/1`, Admin read-only | P1 [d](evidence/candidate-visual-20261029-states/S07-proposal-1-admin__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states/S07-proposal-1-admin__mobile-390x844.png) | No decision controls | |
| 06 | Rejected proposal with history | [launchF d](evidence/launchF-visual/06-proposal-rejected-history__desktop-1280x800.png) / [m](evidence/launchF-visual/06-proposal-rejected-history__mobile-390x844.png) (unchanged since) | Rejection explicit and terminal; append-only history, not a publication | |
| 07 | `/admin/operations/coleman`, before compare | Super Admin: [launchF d](evidence/launchF-visual/07-coleman__desktop-1280x800.png) / [m](evidence/launchF-visual/07-coleman__mobile-390x844.png); Admin: P1 [d](evidence/candidate-visual-20261029-states/S02-coleman-admin__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states/S02-coleman-admin__mobile-390x844.png) | Compare labelled read-only. Publish needs the attestation and a 20–2000 character note and is NOT REVERSIBLE. Admin sees "Publishing is a Super Admin action" | |
| 08 | `/admin/operations/brownlow`, no season | A [d](evidence/candidate-visual-20261029/08-brownlow__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029/08-brownlow__mobile-390x844.png) | Reconciliation only reads; the diagnostic rule is separate from the ADR 0014 determination; leaderboard state per season | |
| 09 | `/admin/operations/brownlow?season=2025` | Super Admin: A [d](evidence/candidate-visual-20261029/09-brownlow-2025__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029/09-brownlow-2025__mobile-390x844.png); Admin: P1 [d](evidence/candidate-visual-20261029-states/S06-brownlow-2025-admin__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states/S06-brownlow-2025-admin__mobile-390x844.png) | Outcome, findings by severity, raw leaderboard with eligibility and source; names a winner only when `determined`; states agreement or disagreement of stored flags. **This clone has no staged 2025 API votes**, so the page shows "not staged / not supplied / mapping not attempted" (§4) | |
| 10 | `/admin/current-season` | [launchF d](evidence/launchF-visual/10-current-season__desktop-1280x800.png) / [m](evidence/launchF-visual/10-current-season__mobile-390x844.png) (layout unchanged) | Only AFL API switches and settle units; missing host status reads "not available" | |
| 11 | `/admin/upload` | [launchF d](evidence/launchF-visual/11-upload-retired__desktop-1280x800.png) / [m](evidence/launchF-visual/11-upload-retired__mobile-390x844.png) | Retirement notice, no working upload | |
| 12 | `/admin` | [launchF d](evidence/launchF-visual/12-admin-home__desktop-1280x800.png) / [m](evidence/launchF-visual/12-admin-home__mobile-390x844.png) | No review notice; read-only submissions log | |
| 13 | `/admin/fixtures` | [launchF d](evidence/launchF-visual/13-fixtures__desktop-1280x800.png) / [m](evidence/launchF-visual/13-fixtures__mobile-390x844.png) | Readable route and action wording | |
| S | Sidebar | Super Admin in every Super Admin capture; Admin in 02, S01, S02, S06, S07 | "Operations centre" in Overview for both roles; no "Legacy file intake" | |

## 3. The previously uncaptured §6 states, now captured

| Item | State | Captures (desktop / mobile) | Accept if | Verdict |
|---|---|---|---|---|
| 1 | Overview with the season registry unreadable | Super Admin P1 [d](evidence/candidate-visual-20261029-states/U1-operations-registry-unreadable__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states/U1-operations-registry-unreadable__mobile-390x844.png); Admin P1 [d](evidence/candidate-visual-20261029-states/U2-operations-registry-unreadable-admin__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states/U2-operations-registry-unreadable-admin__mobile-390x844.png); Coleman notice P1 [d](evidence/candidate-visual-20261029-states/U3-coleman-registry-unreadable__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states/U3-coleman-registry-unreadable__mobile-390x844.png); approval refused P2 [d](evidence/candidate-visual-20261029-states2/U5-approve-refused-registry-unreadable__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/U5-approve-refused-registry-unreadable__mobile-390x844.png) | The page says the registry cannot be read and that approvals are refused; an approval attempt is refused `season_registry_unavailable` and writes nothing (the notice shows a server path: V2-GAP-037) | |
| 2 | Empty award queue | Super Admin P1 [d](evidence/candidate-visual-20261029-states/Q1-awards-queue-empty__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states/Q1-awards-queue-empty__mobile-390x844.png); Admin P1 [d](evidence/candidate-visual-20261029-states/Q2-awards-queue-empty-admin__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states/Q2-awards-queue-empty-admin__mobile-390x844.png) | An empty queue is stated plainly; the create form is shown only to Super Admin | |
| 2 | Create form: whole-file refusal and success | Refused P2 [d](evidence/candidate-visual-20261029-states2/A15-create-invalid-file-refused__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/A15-create-invalid-file-refused__mobile-390x844.png); created P2 [d](evidence/candidate-visual-20261029-states2/A16-create-valid-file-outcome__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/A16-create-valid-file-outcome__mobile-390x844.png) | One invalid row refuses the whole file and creates nothing; success says "Nothing was validated or approved" | |
| 3 | Sealed-season approval refusal | P2 [d](evidence/candidate-visual-20261029-states2/A11-approve-sealed-refused__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/A11-approve-sealed-refused__mobile-390x844.png) | Approval into sealed 2026 without a 20+ character note is refused `season_sealed_correction_invalid`, nothing written | |
| 3 | Sealed-season approval as an audited correction | P2 [d](evidence/candidate-visual-20261029-states2/A12-approve-sealed-correction-outcome__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/A12-approve-sealed-correction-outcome__mobile-390x844.png) | Says "audited correction of a sealed season" and that the award winner now exists | |
| 3 | "Revise approved winner" panel | Super Admin P2 [d](evidence/candidate-visual-20261029-states2/A13-proposal-approved-revise-panel__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/A13-proposal-approved-revise-panel__mobile-390x844.png); Admin (unavailable) P2 [d](evidence/candidate-visual-20261029-states2/A14-proposal-approved-admin__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/A14-proposal-approved-admin__mobile-390x844.png) | Super Admin sees the revise panel with its card; Admin sees the reason it is unavailable and no controls | |
| 3 | Self-approval attestation | Field P2 [d](evidence/candidate-visual-20261029-states2/A18-self-approval-attestation__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/A18-self-approval-attestation__mobile-390x844.png); refused without it P2 [d](evidence/candidate-visual-20261029-states2/A19-self-approve-refused__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/A19-self-approve-refused__mobile-390x844.png); own validate P2 [d](evidence/candidate-visual-20261029-states2/A17-validate-own-outcome__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/A17-validate-own-outcome__mobile-390x844.png) | The creator is asked for an attestation; approving without one is refused | |
| 3 | Reject with a short reason | P2 [d](evidence/candidate-visual-20261029-states2/A20-reject-short-reason-refused__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/A20-reject-short-reason-refused__mobile-390x844.png) | Refused, nothing written | |
| 4 | Coleman compare **as built** (all refused: V2-GAP-036) | Super Admin P2 [d](evidence/candidate-visual-20261029-states2/K1-coleman-compare-2024__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/K1-coleman-compare-2024__mobile-390x844.png); Admin P2 [d](evidence/candidate-visual-20261029-states2/K2-coleman-compare-2024-admin__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/K2-coleman-compare-2024-admin__mobile-390x844.png); 2027 P2 [d](evidence/candidate-visual-20261029-states2/K3-coleman-compare-2027__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/K3-coleman-compare-2027__mobile-390x844.png); unattested P2 [d](evidence/candidate-visual-20261029-states2/K4-coleman-compare-unsettled__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/K4-coleman-compare-unsettled__mobile-390x844.png) | This is the defect, shown for the record. It cannot be accepted as working | |
| 4 | Coleman with the contract supplied — **WORKAROUND, not the candidate as built** | Derivable compare with the `award_winners` preview P2 [d](evidence/candidate-visual-20261029-states2/W1-coleman-compare-2024-derivable__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/W1-coleman-compare-2024-derivable__mobile-390x844.png); Admin compare P2 [d](evidence/candidate-visual-20261029-states2/W2-coleman-compare-2024-admin__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/W2-coleman-compare-2024-admin__mobile-390x844.png); refusal (1975, `season_before_contract`) P2 [d](evidence/candidate-visual-20261029-states2/W3-coleman-compare-1975-refused__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/W3-coleman-compare-1975-refused__mobile-390x844.png); publish refused (no attestation) P2 [d](evidence/candidate-visual-20261029-states2/W4-coleman-publish-unsettled-refused__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/W4-coleman-publish-unsettled-refused__mobile-390x844.png); publish outcome P2 [d](evidence/candidate-visual-20261029-states2/W5-coleman-publish-outcome__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/W5-coleman-publish-outcome__mobile-390x844.png); after publish P2 [d](evidence/candidate-visual-20261029-states2/W6-coleman-after-publish__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/W6-coleman-after-publish__mobile-390x844.png), Admin [d](evidence/candidate-visual-20261029-states2/W7-coleman-after-publish-admin__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/W7-coleman-after-publish-admin__mobile-390x844.png) | Shows what a fixed bundle would render: the preview counts before publishing, a missing goal never counted as zero, and the outcome (2024 matched the stored winner, so only provenance was recorded). Accepting these images does not accept the candidate's Coleman behaviour | |
| 5 | Brownlow refused / invalid season | 2027 in progress P1 [d](evidence/candidate-visual-20261029-states/S04-brownlow-2027-refused__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states/S04-brownlow-2027-refused__mobile-390x844.png); 1800 invalid P1 [d](evidence/candidate-visual-20261029-states/S05-brownlow-invalid-season__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states/S05-brownlow-invalid-season__mobile-390x844.png) | No winner for a season in progress; an invalid season is a field error | |
| 5 | Determination `determined`, tie with an excluded ineligible player | 1996 P2 [d](evidence/candidate-visual-20261029-states2/S03-brownlow-1996-tie__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/S03-brownlow-1996-tie__mobile-390x844.png) (mobile overflow: V2-GAP-038) | Joint winners 6722 and 9596; player 3063 excluded as ineligible and still listed | |
| 5 | Determination `requires_review` | 2023 Super Admin P2 [d](evidence/candidate-visual-20261029-states2/B6-brownlow-2023-requires-review__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/B6-brownlow-2023-requires-review__mobile-390x844.png); Admin P2 [d](evidence/candidate-visual-20261029-states2/B7-brownlow-2023-requires-review-admin__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/B7-brownlow-2023-requires-review-admin__mobile-390x844.png) (also 2024 in P1 B1/B2) | No winner named; the review player is identified; Super Admin gets the decision form with its card; Admin sees the form unavailable | |
| 5 | Eligibility decision error and success | Error P2 [d](evidence/candidate-visual-20261029-states2/B8-decision-error__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/B8-decision-error__mobile-390x844.png); success P2 [d](evidence/candidate-visual-20261029-states2/B9-decision-success__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/B9-decision-success__mobile-390x844.png); after P2 [d](evidence/candidate-visual-20261029-states2/B10-brownlow-2023-after-decision__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/B10-brownlow-2023-after-decision__mobile-390x844.png), Admin [d](evidence/candidate-visual-20261029-states2/B11-brownlow-2023-after-decision-admin__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/B11-brownlow-2023-after-decision-admin__mobile-390x844.png) | A blank citation and a short note are field errors and write nothing; success records one decision, recomputes the result and shows it in the history (synthetic INELIGIBLE ruling) | |
| 7 | `/admin/submissions/[id]`, read-only history | Super Admin P2 [d](evidence/candidate-visual-20261029-states2/S12-submission-history__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/S12-submission-history__mobile-390x844.png); Admin P2 [d](evidence/candidate-visual-20261029-states2/S13-submission-history-admin__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/S13-submission-history-admin__mobile-390x844.png) | "This submission is read-only history"; recorded verdicts listed; no action control | |
| 9 | Refusals page, production build | Empty A [R1 d](evidence/candidate-visual-20261029/R1-refusals__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029/R1-refusals__mobile-390x844.png), [R2 d](evidence/candidate-visual-20261029/R2-findings__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029/R2-findings__mobile-390x844.png); populated P2 [d](evidence/candidate-visual-20261029-states2/R3-refusals-populated__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/R3-refusals-populated__mobile-390x844.png); page 2 P2 [d](evidence/candidate-visual-20261029-states2/R4-refusals-page2__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/R4-refusals-page2__mobile-390x844.png); findings P2 [d](evidence/candidate-visual-20261029-states2/R5-findings-populated__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/R5-findings-populated__mobile-390x844.png); Admin P2 [d](evidence/candidate-visual-20261029-states2/R6-refusals-populated-admin__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/R6-refusals-populated-admin__mobile-390x844.png); failed read P2 [d](evidence/candidate-visual-20261029-states2/R7-refusals-read-failed__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/R7-refusals-read-failed__mobile-390x844.png) | Read-only, newest first, 50 per page, codes not values; the failed read is a generic notice | |

## 4. States genuinely unavailable in this run

- **Staged API leaderboard and the 18-team provider mapping (09, §6 item 5).** The template has no
  `staging.afl_api_brownlow_vote` rows for any season. Producing them would need a synthetic Brownlow settle
  (sources, batches, version sequences, leaderboard observations and fixture corroboration). That was not
  attempted, so only the "not staged / not supplied / mapping not attempted" state exists for this candidate.
  The earlier checklist §5 assumed the template held a staged 2025 state; it holds none.
- **Coleman derivable compare, preview and publish outcome on the candidate as built.** These are impossible
  until V2-GAP-036 is fixed. The W-block images show them only with the contract copied into the build output.
- **A submitted "Revise approved winner" action.** §6 asks for the panel, which is captured. No revision
  was submitted.
- **Screens 03, 06, 07 (Super Admin), 10–13** were not recaptured: no change since `launchF-visual`
  affects them (earlier checklist §1).

## 5. Fixtures and test actions (deliberate changes, not unchanged data)

Read-only checks and deliberate changes are kept apart. Each capture group between actions observed **no
change** in the twelve fingerprinted tables (`award_*`, `derived_award_*`, `brownlow_*`, `data_edits`,
`data_issues`, `data_submission*`). Each action's expected effect matched the observed one (`match=true` in
the logs), with two exceptions. In pass 1 two expectations omitted the sealed-season `data_edits` audit row,
which the operating guide documents; pass 2 corrected them. Two pass-1 fixtures failed (identity columns) and
were redone in pass 2.

| Pass | Step | Effect (observed) | Net |
|---|---|---|---|
| A | read-only capture | none (history fingerprint unchanged) | — |
| 1 | approve proposal #1 (mark-of-the-year 2026, sealed) with a correction note | proposal approved, +1 decision, +1 `award_winners`, +1 `data_edits` | persists |
| 1 | create proposal #4 (2027) and validate it | +1 proposal, +2 decisions; validation failed (`season_not_in_register`: no 2027 season row) | persists |
| 1 | clear `eligible_rank` of the 2024 leader (player 10243), then record "eligible" | +1 decision, +1 `data_edits`; the projection restored the stored rank (net `brownlow_season_votes` unchanged) | decision persists |
| 1 | move every proposal aside for the empty-queue capture | restored byte for byte (digests identical) | none |
| 1, 2 | hide the standalone `seasons.json` (build output) | restored, SHA-256 `1368e9b1…` identical to the repository file | none |
| 1, 2 | `REVOKE SELECT ON data_issues FROM afldb_import` for the failed-read capture | `GRANT` restored, privilege verified | none |
| 2 | insert synthetic submission #1 with 5 rows | +1 `data_submissions`, +5 `data_submission_rows` | persists |
| 2 | insert 60 synthetic refusals and 3 settle findings (`source_key afl_api`) | +63 `data_issues` | persists |
| 2 | validate and approve proposal #2 (goal-of-the-year 2026) | +2 decisions, +1 `award_winners`, +1 `data_edits` | persists |
| 2 | create and validate proposal #5 (aflpa-mvp 2026), left undecided | +1 proposal, +2 decisions | persists |
| 2 | copy `coleman-derivation.json` into the build output; publish Coleman 2024 | +1 `derived_award_results`, +1 `derived_award_projections`, `award_winners` unchanged; copy removed and verified absent | publication persists |
| 2 | clear `eligible_rank` of the 2023 leader (player 8354), then record a synthetic INELIGIBLE ruling | +1 decision, +1 `data_edits`, `brownlow_season_votes` reprojected | persists |

Refusal actions (approval with the registry hidden, a sealed approval without a note, approving your own
proposal without an attestation, a short rejection, an invalid file, an unattested publish and an invalid
decision) each observed **no change**.

## 6. Owner verdict (return this block)

```text
D-V2-VISUAL-1 — owner visual review of docs/v2/owner-visual-review-candidate-2026-10-29.md (candidate 592c6c16).
Reviewed by: <screenshots | live on isolated environment> at <desktop and mobile>.
ACCEPT: <§2 rows and §3 items>
REJECT: <row/item — defect>   (V2-GAP-036/037/038 are already recorded defects)
NOT REVIEWED / OUT OF SCOPE: <rows/items, with reason; include the §4 unavailable states>
Coleman W-block images: <accepted as the target rendering | not accepted>
```

V2-GAP-022 closes only when every row and item is accepted or explicitly put out of scope by the owner. A
fix for V2-GAP-036/037/038 changes the candidate and needs its own approval and recapture.
