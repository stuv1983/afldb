# Owner visual review sheet — corrected candidate (D-V2-VISUAL-1, V2-GAP-022)

**Prepared 2026-10-29 for the owner. Nothing here is accepted.** This is the single review sheet. It supersedes the
screenshot links of [owner-visual-review-2026-10-29.md](owner-visual-review-2026-10-29.md) (kept as history). The
automated checks are evidence, not acceptance. No agent verdict stands in for the owner's. V2-GAP-022 stays **OPEN**
until the owner returns §6.

**What to review.** §1–§3 hold only acceptance evidence for the corrected candidate. Everything that shows the broken
candidate, a workaround or a harness artefact is in **Appendix D, diagnostic history**, and is not for acceptance.

## 0. What the captures represent

| Item | Value |
|---|---|
| Candidate | The application tree of `7670441b` (`v2/rebuild`), which fixes V2-GAP-036/037/038 and the raw-total evidence label. Later commits change only tools, evidence and tracking |
| Build | One production build: `local-release.mjs build v2` (`next build --webpack` + `prepare-standalone`), telemetry off. BUILD_ID `XtSgl4BOQZXC2G8qIWJdV`, 1516/1516 pages. It was reused for §1b, not rebuilt: no application file is newer than the build, the tree is clean, and the bundled `seasons.json`, `coleman-derivation.json` and `afl-api-identities.json` are byte-identical to the repository. Served standalone on 127.0.0.1:3912 |
| Older images | The §2/§3 rows marked **A**, **P1** or **P2** come from candidate `592c6c16` (build `ivryI9oSx3g1fpqeB65oJ`); rows marked **launchF** come from `36679a1e`. Each is linked for acceptance only because the component it shows is proven unchanged (§0a). The seven Brownlow season images formerly marked † are replaced by corrected-candidate captures (§1c); the old images are in Appendix D2 |
| Databases | Disposable clones on `afldb_v2_isolated` (127.0.0.1:55433, loopback, SCRAM). `afldb_v2_visual2_test` (A/P1/P2/C) and its clone `afldb_v2_visual_leaderboard_test` (LB, LBr, D, Dr). Identity, marker and listener were proven before every write. Both are retained, stopped |
| Staff | Synthetic `candidate-visual-super_admin@example.invalid` and `candidate-visual-admin@example.invalid`, signed in by a locally minted session |
| Checks per capture | HTTP status, final URL, page-level horizontal overflow (with the overflowing element named), console/page errors, required and forbidden controls, and external requests (blocked and counted: **0** in every context and, for LB, in the writer process) |
| Viewports | 1280x800 and 390x844, full-page. On mobile, the site's fixed bottom bar (Home · Players · Clubs · Seasons · More) appears once partway down each image. That is how a full-page capture draws a fixed bar, not a layout defect. Wide tables scroll inside their own box on mobile; that is not page overflow |

Folders under `docs/v2/evidence/`: **A** = `candidate-visual-20261029/`, **P1** = `candidate-visual-20261029-states/`,
**P2** = `candidate-visual-20261029-states2/`, **C** = `candidate-visual-20261029-corrected/`,
**LB** = `candidate-visual-20261029-leaderboard/`, **LBr** = `candidate-visual-20261029-leaderboard-recheck/`,
**D** = `candidate-visual-20261029-dagger/`, **Dr** = `candidate-visual-20261029-dagger-recheck/`.
Each holds its own `capture-log.txt`.

### 0a. Why each older image still represents the candidate

Application files changed between the older candidates and `7670441b` (`git diff --name-only <from> 7670441b`
over `src/app/admin`, `src/components`, `src/lib/admin`, `tools/build`, `data/reference`):

| From | Changed | What it renders, and where that is captured on the corrected build |
|---|---|---|
| `592c6c16` (A, P1, P2) | `_components/BrownlowViews.tsx` | Only `BrownlowReportView` (status wrap, raw-totals label and note). It renders only on a Brownlow season page with a report: all such images are now C, LB, LBr, D or Dr. Page 08 (no season) and S05 (invalid season) render no report |
| | `src/lib/admin/operations-centre.ts` | Only the text of three loader refusals (registry, Coleman contract, provider identities): G-1 to G-4 and LB-6. The page-level registry notices of U1–U3 come from `page-data.ts` and `coleman/page.tsx`, unchanged in this range |
| | `tools/build/prepare-standalone.mjs`, `standalone-runtime-files.mjs` | Bundle packaging (V2-GAP-036). Every C/LB/D image is served from that bundle |
| `36679a1e` (launchF: 03 Super Admin, 06, 07 Super Admin, 10–13) | Brownlow components, the refusals page, overview data (`page-data.ts`, `views.ts`), `operations-centre.ts` | None of these is rendered on the awards, proposal, Coleman (before compare), current-season, upload, admin-home or fixtures pages. The one added link (`AFL API settle refusals`) renders only on the overview (01/02, captured in A). `src/components` (sidebar, shell) is unchanged |

Nothing in the build changed after it was made: no application file differs between `7670441b` and the commit that
holds this sheet, no file under `src`, `data/reference`, `tools/build` or the package manifests is newer than
`.next/BUILD_ID`, and the bundled `seasons.json`, `coleman-derivation.json` and `afl-api-identities.json` are
byte-identical to the repository (re-verified before the D run and again by the run itself).

## 1. The corrected candidate

### 1a. Recaptured screens (folder **C**)

`tools/v2/candidate-visual-corrected.mts`: 34 images, 0 external requests, every step `match=true`
([log](evidence/candidate-visual-20261029-corrected/capture-log.txt),
[server log excerpt](evidence/candidate-visual-20261029-corrected/server-log-excerpt.txt)). `prepare-standalone`
copied and verified 7 runtime reference files; nothing was copied into the build output by hand.

| # | State | Captures (desktop / mobile) | Accept if | Verdict |
|---|---|---|---|---|
| C-1 | Coleman compare 2024, Super Admin (derivable, `award_winners` preview) | [d](evidence/candidate-visual-20261029-corrected/C1-coleman-compare-2024__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-corrected/C1-coleman-compare-2024__mobile-390x844.png) | Comparison and preview shown; no refusal; a missing goal never counted as zero | |
| C-2 | Coleman compare 2024, Admin | [d](evidence/candidate-visual-20261029-corrected/C2-coleman-compare-2024-admin__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-corrected/C2-coleman-compare-2024-admin__mobile-390x844.png) | Comparison shown; "Publishing is a Super Admin action" | |
| C-3 | Coleman compare 2027 (in progress) | [d](evidence/candidate-visual-20261029-corrected/C3-coleman-compare-2027__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-corrected/C3-coleman-compare-2027__mobile-390x844.png) | "Not derivable": the derivation's own refusal `season_not_complete` (2027 in progress), not a contract refusal; publishing not possible | |
| C-4 | Coleman compare without the settled attestation | [d](evidence/candidate-visual-20261029-corrected/C4-coleman-compare-unsettled__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-corrected/C4-coleman-compare-unsettled__mobile-390x844.png) | Not derivable without the attestation; no preview | |
| C-5 | Coleman compare 1975 (`season_before_contract`) | [d](evidence/candidate-visual-20261029-corrected/C5-coleman-compare-1975-refused__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-corrected/C5-coleman-compare-1975-refused__mobile-390x844.png) | The derivation's own refusal, stated plainly | |
| C-6 | Publish 2023 without the attestation | [d](evidence/candidate-visual-20261029-corrected/C6-coleman-publish-unattested-refused__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-corrected/C6-coleman-publish-unattested-refused__mobile-390x844.png) | Refused; nothing written | |
| C-7 | Publish 2023 outcome | [d](evidence/candidate-visual-20261029-corrected/C7-coleman-publish-outcome__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-corrected/C7-coleman-publish-outcome__mobile-390x844.png) | Outcome stated: 2023 matched the stored winner, so only provenance was recorded (+1 ledger row, +1 projection, `award_winners` unchanged) | |
| C-8 | Coleman page after publishing, Super Admin / Admin | [d](evidence/candidate-visual-20261029-corrected/C8-coleman-after-publish__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-corrected/C8-coleman-after-publish__mobile-390x844.png); Admin [d](evidence/candidate-visual-20261029-corrected/C9-coleman-after-publish-admin__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-corrected/C9-coleman-after-publish-admin__mobile-390x844.png) | 2023 listed among publications; Admin has no publish control | |
| G-1 | Approval refused, season registry missing | [d](evidence/candidate-visual-20261029-corrected/G1-approve-refused-registry-missing__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-corrected/G1-approve-refused-registry-missing__mobile-390x844.png) | Generic text naming `data/reference/seasons.json`, "Nothing was changed", code `season_registry_unavailable`; no server path; no overflow | |
| G-2 | Coleman compare refused, season registry missing | [d](evidence/candidate-visual-20261029-corrected/G2-coleman-compare-registry-missing__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-corrected/G2-coleman-compare-registry-missing__mobile-390x844.png) | As G-1 | |
| G-3 | Coleman compare refused, contract missing | [d](evidence/candidate-visual-20261029-corrected/G3-coleman-compare-contract-missing__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-corrected/G3-coleman-compare-contract-missing__mobile-390x844.png) | Generic text naming `data/reference/coleman-derivation.json`, code `coleman_contract_unavailable`; no server path | |
| G-4 | Coleman publish refused, contract missing | [d](evidence/candidate-visual-20261029-corrected/G4-coleman-publish-contract-missing__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-corrected/G4-coleman-publish-contract-missing__mobile-390x844.png) | As G-3; nothing written | |
| B-12 | Brownlow 1996: `determined`, tie with an excluded ineligible player | [d](evidence/candidate-visual-20261029-corrected/B12-brownlow-1996-tie__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-corrected/B12-brownlow-1996-tie__mobile-390x844.png) | Joint winners 6722 and 9596; player 3063 excluded as ineligible and still listed; `refused_eligibility_rule_unrecorded` wraps inside the page at 390px; nothing cut off | |
| B-13 | Brownlow 2023 after the decision, Super Admin / Admin | [d](evidence/candidate-visual-20261029-corrected/B13-brownlow-2023-after-decision__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-corrected/B13-brownlow-2023-after-decision__mobile-390x844.png); Admin [d](evidence/candidate-visual-20261029-corrected/B14-brownlow-2023-after-decision-admin__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-corrected/B14-brownlow-2023-after-decision-admin__mobile-390x844.png) | The recorded decision is current and in the history; the status wraps at 390px | |
| L-1 | Brownlow 2022 with the leader's eligibility unrecorded (synthetic fixture, restored) | Rerun with the corrected checks, LB [d](evidence/candidate-visual-20261029-leaderboard/L1-brownlow-unknown-eligibility-evidence-label__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-leaderboard/L1-brownlow-unknown-eligibility-evidence-label__mobile-390x844.png) (the identical C images: [d](evidence/candidate-visual-20261029-corrected/L1-brownlow-unknown-eligibility-evidence-label__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-corrected/L1-brownlow-unknown-eligibility-evidence-label__mobile-390x844.png)) | The determination says "unknown (not recorded)". The raw totals say "Ineligibility evidence: not marked ineligible", with the note that this is not an eligibility status. Nothing contradicts. ("The stored totals against themselves: 1 mismatch" is the fixture itself.) All checks now pass (Appendix D3) | |

**Raw-total label.** The earlier observation (P2 B6) was a display defect, not two conflicting rules. The raw totals'
`eligible` is the reconciliation's folded evidence flag: true means only that no source marks the player
ineligible. Only the label and wording changed. Medal rules, eligibility policy and vote data are unchanged.

### 1b. Staged API leaderboard and the derived 18-team provider mapping (folders **LB**, **LBr**)

> **Synthetic UI evidence, not provider reconciliation.** Every provider record in these images is SYNTHETIC: the
> repository's AFL API test fixtures, re-keyed onto one synthetic provider match `CD_M2026V2VLBP` (Hawthorn v Brisbane
> Lions, 2026-09-24), with the fixtures' synthetic voters "Alpha/Bravo/Charlie Player" (`CD_I900001`–`3`). LB-1 also
> has a synthetic `CD_I900099` on a synthetic team `CD_T9990`. Only the 18 team identities are authentic: the
> committed `data/reference/afl-api-identities.json`. Fixture corroboration comes from the synthetic match, so only
> `CD_T80` and `CD_T20` are corroborated. The images prove that the corrected candidate renders these states and
> refusals. They do **not** establish authentic provider reconciliation (go/no-go gate 7 and V2-GAP-023's production
> staging are unchanged). The 2026 medal determination on these pages is computed from the synthetic votes and says
> nothing about the 2026 Brownlow Medal.

| Item | Value |
|---|---|
| Database | New disposable `afldb_v2_visual_leaderboard_test`, created by `isolated-pg.ts create-db --template afldb_v2_visual2_test` and verified (`ISOLATED TARGET OK`). The cluster listener on 127.0.0.1:55433 was owned by the isolated cluster's own `postgres.exe`. Marker `afldb-v2-isolated-test`; `current_database()` proven for both the owner and the import role. Before the run, 2026 had no matches, no Brownlow totals and no staged rows |
| Tool | `tools/v2/candidate-visual-leaderboard.mts`. [Full run log](evidence/candidate-visual-20261029-leaderboard/capture-log.txt) (18 images) · [refused-state recheck log](evidence/candidate-visual-20261029-leaderboard-recheck/capture-log.txt) (6 images, `--recheck-refused`, 0 failures) · [server log excerpt](evidence/candidate-visual-20261029-leaderboard/server-log-excerpt.txt) · [preservation proof](evidence/candidate-visual-20261029-leaderboard/preservation.txt) |
| Fixture provenance | `tests/fixtures/afl_api/match/01-fixture-result.json` (`3d588ab1…`), `02-player-stats.raw.json` (`747a7a8e…`), `03-match-roster.raw.json` (`c0b6ff70…`), `tests/fixtures/afl_api/brownlow/01-brownlow-season-round.json` (`18cf0e9b…`), `02-brownlow-leaderboard-sample.json` (`8a5c1dc6…`); full SHA-256 values in the log. Re-key: provider match `CD_M20260142801` (API round 28, a 2026 final the Brownlow settle excludes) → `CD_M2026V2VLBP` (API round 5 = canonical home-and-away round 6) |
| Guarded CLI route (attempted, refused) | `settle-afl-api.ts`, `settle-afl-api-fixtures.ts` and `settle-afl-api-brownlow.ts` refuse every writing mode for 2026 before opening a connection: `SealedSeasonRefusal: season 2026 is sealed historical data (sealed seasons 1897-2026)` (V2-GAP-006). Every season with an AFL API vocabulary (2022–2026) is sealed, and there is no 2027 vocabulary. `--allow-completed-season-backtest` admits only `afldb_test`. Neither guard was used or changed |
| Producer used | The existing settle writers, driven exactly as `tests/integration/settle-afl-api-brownlow.test.ts` drives them, as `afldb_import` and with network calls blocked. (1) Three synthetic voters with `afl_api` bridge rows (the suite's voter fixture). (2) `runSettleAflApi`, apply + autoApply, `inProgressSeasons: [2026]` as the suite passes. That caller input is what admits the canonical match write on this disposable clone. (3) `runSettleAflApiBrownlow`, apply, **autoApply off**, with the registry's own in-progress seasons `[2027]`. It stages the vote set, its typed projection and the leaderboard, and writes no canonical Brownlow row (`brownlow_round_votes` for 2026: 0) |
| Not changed | No guard, medal rule, eligibility policy or page query was changed or mocked. The page read the real tables through the real loader |

| # | State | Captures (desktop / mobile) | Accept if | Verdict |
|---|---|---|---|---|
| LB-0 | 2026 before staging, Super Admin | LB [d](evidence/candidate-visual-20261029-leaderboard/LB0-brownlow-2026-not-staged__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-leaderboard/LB0-brownlow-2026-not-staged__mobile-390x844.png) | "The API leaderboard is not staged"; leaderboard "not staged"; mapping "not attempted: no API votes are staged" | |
| LB-1 | Staged leaderboard with an unresolved player on an unmapped team: refused | LBr [d](evidence/candidate-visual-20261029-leaderboard-recheck/LB1-brownlow-2026-unresolved-unmapped-refused__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-leaderboard-recheck/LB1-brownlow-2026-unresolved-unmapped-refused__mobile-390x844.png); findings expanded [d](evidence/candidate-visual-20261029-leaderboard-recheck/LB1b-brownlow-2026-refused-findings-expanded__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-leaderboard-recheck/LB1b-brownlow-2026-refused-findings-expanded__mobile-390x844.png) | Leaderboard staged, 4 entries (status IN_PROGRESS); 1 unresolved player. Mapping "refused: 1 problem(s), no mapping applied": `provider_team_unmapped`, `CD_T9990`, "no committed identity". "Season 2026: Refused", `refused_whole_set`, finding `unresolved_player_identity` (source leaderboard). Medal "Refused: unresolved evidence", no winner, no totals | |
| LB-2 | Staged leaderboard and derived mapping, Super Admin | LB [d](evidence/candidate-visual-20261029-leaderboard/LB2-brownlow-2026-staged-mapping-derived__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-leaderboard/LB2-brownlow-2026-staged-mapping-derived__mobile-390x844.png) | "The API leaderboard is staged (V2-GAP-023)", with club consistency checked through the derived mapping. 3 entries (status IN_PROGRESS), 0 unresolved, 1 no longer listed (LB-1's extra entry). Mapping "derived: 18 teams, corroborated by 1 fixtures". "Round votes against the API leaderboard": compared 3, 0 mismatches. Season in progress: `season_incomplete`, no winner stated | |
| LB-3 | The same, Admin | LB [d](evidence/candidate-visual-20261029-leaderboard/LB3-brownlow-2026-staged-mapping-derived-admin__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-leaderboard/LB3-brownlow-2026-staged-mapping-derived-admin__mobile-390x844.png) | Same evidence, read-only; no decision submit control | |
| LB-4 | The 18 mapped teams expanded, Super Admin / Admin | LB [d](evidence/candidate-visual-20261029-leaderboard/LB4-brownlow-2026-mapping-expanded__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-leaderboard/LB4-brownlow-2026-mapping-expanded__mobile-390x844.png); Admin [d](evidence/candidate-visual-20261029-leaderboard/LB5-brownlow-2026-mapping-expanded-admin__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-leaderboard/LB5-brownlow-2026-mapping-expanded-admin__mobile-390x844.png) | 18 rows, provider team → club history name → club id. `CD_T80` Hawthorn (13) and `CD_T20` Brisbane Lions (3) have 1 agreeing fixture slot each; the other 16 show 0, because no fixture names them. No "No fixture corroborates" line: every team that cast or received a vote is corroborated | |
| LB-5 | Without a session | LB [d](evidence/candidate-visual-20261029-leaderboard/LB6-brownlow-2026-anonymous__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-leaderboard/LB6-brownlow-2026-anonymous__mobile-390x844.png) | Redirected to `/admin/login`; no Brownlow evidence rendered | |
| LB-6 | Committed identities unavailable (bundle file hidden, restored byte-identical) | LB [d](evidence/candidate-visual-20261029-leaderboard/LB7-brownlow-2026-identities-unavailable__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-leaderboard/LB7-brownlow-2026-identities-unavailable__mobile-390x844.png) | Leaderboard still staged. Mapping "not attempted: the committed identities could not be read (data/reference/afl-api-identities.json is unreadable or invalid; see the server log)", with no server path (the path is only in the server log). Club consistency reported as unverifiable (info: 1). Nothing written | |

Every LB capture: HTTP 200 (LB-5: the login page), 0px horizontal overflow at 1280 and 390, 0 console errors, 0
external requests. Two observations, not graded and not changed: the mapping line reads "corroborated by **1
fixtures**" (plural for one), and on mobile the raw-vote-leaderboard and comparison tables scroll inside their own box.

### 1c. Brownlow season pages formerly marked † (folders **D**, **Dr**)

`tools/v2/candidate-visual-brownlow-recapture.mts` on `afldb_v2_visual_leaderboard_test`, build
`XtSgl4BOQZXC2G8qIWJdV` reused (re-verified, §0a; the tool also refuses unless the server on 3912 serves that build's
manifest). [Full run log](evidence/candidate-visual-20261029-dagger/capture-log.txt) ·
[recheck log](evidence/candidate-visual-20261029-dagger-recheck/capture-log.txt) (`--recheck`, 0 failures) ·
[preservation proof](evidence/candidate-visual-20261029-dagger/preservation.txt).

**Equivalent records.** 2023 (the season of the old B6–B9) already carries pass 2's synthetic decision, so the
`requires_review` flow uses the same fixture on another season: clear the `eligible_rank` of a single, eligible,
undecided leader. B8/B9 ran on **2021** (leader player 10130); the decision recorded there persists, as pass 2's did.
B6/B7 were then recaptured on **2020** (leader player 8354) with the fixture cleared and restored byte for byte (D3).

| # | State | Captures (desktop / mobile) | Accept if | Verdict |
|---|---|---|---|---|
| D-09 | `/admin/operations/brownlow?season=2025`, Super Admin | D [d](evidence/candidate-visual-20261029-dagger/D09-brownlow-2025__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-dagger/D09-brownlow-2025__mobile-390x844.png) | As §2 row 09; the raw totals read "Ineligibility evidence" with the note that it is not an eligibility status | |
| D-S06 | The same, Admin | D [d](evidence/candidate-visual-20261029-dagger/D06-brownlow-2025-admin__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-dagger/D06-brownlow-2025-admin__mobile-390x844.png) | As D-09, read-only | |
| D-S04 | 2027 in progress | Dr [d](evidence/candidate-visual-20261029-dagger-recheck/D04-brownlow-2027-refused__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-dagger-recheck/D04-brownlow-2027-refused__mobile-390x844.png) | No winner: the winner line reads "none stated" | |
| D-B6 | `requires_review`, Super Admin (2020) | Dr [d](evidence/candidate-visual-20261029-dagger-recheck/D-B6-brownlow-requires-review__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-dagger-recheck/D-B6-brownlow-requires-review__mobile-390x844.png) | No winner ("none stated"); player 8354 identified for review; the decision form with its card; corrected raw totals | |
| D-B7 | `requires_review`, Admin (2020) | Dr [d](evidence/candidate-visual-20261029-dagger-recheck/D-B7-brownlow-requires-review-admin__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-dagger-recheck/D-B7-brownlow-requires-review-admin__mobile-390x844.png) | As D-B6, with the form unavailable to Admin and no form rendered | |
| D-B8 | Decision error (2021) | D [d](evidence/candidate-visual-20261029-dagger/D-B8-decision-error__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-dagger/D-B8-decision-error__mobile-390x844.png) | A blank citation and a short note are refused (`invalid_input`); nothing written | |
| D-B9 | Decision success (2021, synthetic INELIGIBLE ruling) | D [d](evidence/candidate-visual-20261029-dagger/D-B9-decision-success__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-dagger/D-B9-decision-success__mobile-390x844.png) | One decision recorded; the result recomputed (winner determined, player 9025, 33 votes) and shown in the history; raw totals say "marked ineligible" for 10130 | |

Every linked D/Dr capture: HTTP 200 (B8/B9: the same page after the action), 0px horizontal overflow at 1280 and 390,
0 console errors, checks pass. External requests were blocked in both runs; the recheck counted **0**. The full run
stopped at its final verification query (D3) before writing its counters, so its count is not recorded; its B9
record was verified by the recheck.

## 2. Screen by screen

Criteria G1–G4 (earlier checklist, top) apply to every row. Mark each row ACCEPT, REJECT (with the defect) or NOT
REVIEWED.

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
| 09 | `/admin/operations/brownlow?season=2025` | Super Admin: D [d](evidence/candidate-visual-20261029-dagger/D09-brownlow-2025__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-dagger/D09-brownlow-2025__mobile-390x844.png); Admin: D [d](evidence/candidate-visual-20261029-dagger/D06-brownlow-2025-admin__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-dagger/D06-brownlow-2025-admin__mobile-390x844.png) (§1c) | Outcome, findings by severity, raw leaderboard with eligibility and source; names a winner only when `determined`; states agreement or disagreement of stored flags. The clone has no staged 2025 votes, so this shows "not staged / mapping not attempted"; the staged states are in §1b | |
| 10 | `/admin/current-season` | [launchF d](evidence/launchF-visual/10-current-season__desktop-1280x800.png) / [m](evidence/launchF-visual/10-current-season__mobile-390x844.png) (layout unchanged) | Only AFL API switches and settle units; missing host status reads "not available" | |
| 11 | `/admin/upload` | [launchF d](evidence/launchF-visual/11-upload-retired__desktop-1280x800.png) / [m](evidence/launchF-visual/11-upload-retired__mobile-390x844.png) | Retirement notice, no working upload | |
| 12 | `/admin` | [launchF d](evidence/launchF-visual/12-admin-home__desktop-1280x800.png) / [m](evidence/launchF-visual/12-admin-home__mobile-390x844.png) | No review notice; read-only submissions log | |
| 13 | `/admin/fixtures` | [launchF d](evidence/launchF-visual/13-fixtures__desktop-1280x800.png) / [m](evidence/launchF-visual/13-fixtures__mobile-390x844.png) | Readable route and action wording | |
| S | Sidebar | Super Admin in every Super Admin capture; Admin in 02, S01, S02, S07, LB-3, D-S06, D-B7 | "Operations centre" in Overview for both roles; no "Legacy file intake" | |

## 3. The other §6 states

| Item | State | Captures (desktop / mobile) | Accept if | Verdict |
|---|---|---|---|---|
| 1 | Overview and Coleman with the season registry unreadable | Super Admin P1 [d](evidence/candidate-visual-20261029-states/U1-operations-registry-unreadable__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states/U1-operations-registry-unreadable__mobile-390x844.png); Admin P1 [d](evidence/candidate-visual-20261029-states/U2-operations-registry-unreadable-admin__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states/U2-operations-registry-unreadable-admin__mobile-390x844.png); Coleman notice P1 [d](evidence/candidate-visual-20261029-states/U3-coleman-registry-unreadable__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states/U3-coleman-registry-unreadable__mobile-390x844.png); the refused approval and compare are §1a G-1/G-2 | The page says the registry cannot be read and that approvals are refused | |
| 2 | Empty award queue | Super Admin P1 [d](evidence/candidate-visual-20261029-states/Q1-awards-queue-empty__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states/Q1-awards-queue-empty__mobile-390x844.png); Admin P1 [d](evidence/candidate-visual-20261029-states/Q2-awards-queue-empty-admin__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states/Q2-awards-queue-empty-admin__mobile-390x844.png) | An empty queue is stated plainly; the create form is shown only to Super Admin | |
| 2 | Create form: whole-file refusal and success | Refused P2 [d](evidence/candidate-visual-20261029-states2/A15-create-invalid-file-refused__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/A15-create-invalid-file-refused__mobile-390x844.png); created P2 [d](evidence/candidate-visual-20261029-states2/A16-create-valid-file-outcome__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/A16-create-valid-file-outcome__mobile-390x844.png) | One invalid row refuses the whole file and creates nothing; success says "Nothing was validated or approved" | |
| 3 | Sealed-season approval refusal | P2 [d](evidence/candidate-visual-20261029-states2/A11-approve-sealed-refused__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/A11-approve-sealed-refused__mobile-390x844.png) | Approval into sealed 2026 without a 20+ character note is refused `season_sealed_correction_invalid`, nothing written | |
| 3 | Sealed-season approval as an audited correction | P2 [d](evidence/candidate-visual-20261029-states2/A12-approve-sealed-correction-outcome__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/A12-approve-sealed-correction-outcome__mobile-390x844.png) | Says "audited correction of a sealed season" and that the award winner now exists | |
| 3 | "Revise approved winner" panel | Super Admin P2 [d](evidence/candidate-visual-20261029-states2/A13-proposal-approved-revise-panel__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/A13-proposal-approved-revise-panel__mobile-390x844.png); Admin (unavailable) P2 [d](evidence/candidate-visual-20261029-states2/A14-proposal-approved-admin__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/A14-proposal-approved-admin__mobile-390x844.png) | Super Admin sees the revise panel with its card; Admin sees the reason it is unavailable and no controls | |
| 3 | Self-approval attestation | Field P2 [d](evidence/candidate-visual-20261029-states2/A18-self-approval-attestation__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/A18-self-approval-attestation__mobile-390x844.png); refused without it P2 [d](evidence/candidate-visual-20261029-states2/A19-self-approve-refused__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/A19-self-approve-refused__mobile-390x844.png); own validate P2 [d](evidence/candidate-visual-20261029-states2/A17-validate-own-outcome__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/A17-validate-own-outcome__mobile-390x844.png) | The creator is asked for an attestation; approving without one is refused | |
| 3 | Reject with a short reason | P2 [d](evidence/candidate-visual-20261029-states2/A20-reject-short-reason-refused__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/A20-reject-short-reason-refused__mobile-390x844.png) | Refused, nothing written | |
| 4 | Coleman compare, preview, publish and refusals | §1a C-1 to C-8, G-2 to G-4 | As listed there | |
| 5 | Brownlow refused / invalid season | 2027 in progress Dr [d](evidence/candidate-visual-20261029-dagger-recheck/D04-brownlow-2027-refused__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-dagger-recheck/D04-brownlow-2027-refused__mobile-390x844.png) (§1c); 1800 invalid P1 [d](evidence/candidate-visual-20261029-states/S05-brownlow-invalid-season__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states/S05-brownlow-invalid-season__mobile-390x844.png) | No winner for a season in progress; an invalid season is a field error | |
| 5 | Determination `determined`, tie with an excluded ineligible player | §1a B-12 | As listed there | |
| 5 | Determination `requires_review` | §1c D-B6 (Super Admin) and D-B7 (Admin); also §1a L-1 | No winner named; the review player is identified; Super Admin gets the decision form with its card; Admin sees the form unavailable | |
| 5 | Eligibility decision error and success | §1c D-B8 (error) and D-B9 (success); after: §1a B-13 | A blank citation and a short note are field errors and write nothing; success records one decision, recomputes the result and shows it in the history (synthetic INELIGIBLE ruling) | |
| 5 | Staged leaderboard and provider-team mapping (§6 item 5) | §1b LB-0 to LB-6 | As listed there | |
| 7 | `/admin/submissions/[id]`, read-only history | Super Admin P2 [d](evidence/candidate-visual-20261029-states2/S12-submission-history__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/S12-submission-history__mobile-390x844.png); Admin P2 [d](evidence/candidate-visual-20261029-states2/S13-submission-history-admin__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/S13-submission-history-admin__mobile-390x844.png) | "This submission is read-only history"; recorded verdicts listed; no action control | |
| 9 | Refusals page, production build | Empty A [R1 d](evidence/candidate-visual-20261029/R1-refusals__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029/R1-refusals__mobile-390x844.png), [R2 d](evidence/candidate-visual-20261029/R2-findings__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029/R2-findings__mobile-390x844.png); populated P2 [d](evidence/candidate-visual-20261029-states2/R3-refusals-populated__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/R3-refusals-populated__mobile-390x844.png); page 2 P2 [d](evidence/candidate-visual-20261029-states2/R4-refusals-page2__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/R4-refusals-page2__mobile-390x844.png); findings P2 [d](evidence/candidate-visual-20261029-states2/R5-findings-populated__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/R5-findings-populated__mobile-390x844.png); Admin P2 [d](evidence/candidate-visual-20261029-states2/R6-refusals-populated-admin__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/R6-refusals-populated-admin__mobile-390x844.png); failed read P2 [d](evidence/candidate-visual-20261029-states2/R7-refusals-read-failed__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/R7-refusals-read-failed__mobile-390x844.png) | Read-only, newest first, 50 per page, codes not values; the failed read is a generic notice | |

## 4. Remaining gaps (genuine)

- **Authentic provider reconciliation is not shown.** §1b is synthetic UI evidence only (see its box). Staging an
  authentic leaderboard needs an operator-run Brownlow settle on a real snapshot (V2-GAP-023's production step), and
  gate 7 is not met. Nothing here changes either.
- **A submitted "Revise approved winner" action.** §6 asks for the panel, which is captured. No revision was
  submitted.

Every screenshot linked for acceptance in §1–§3 is either a corrected-candidate capture (C, LB, LBr, D, Dr) or shows a
component proven unchanged since its capture (§0a).

## 5. Fixtures and test actions (deliberate changes, not unchanged data)

Read-only captures and deliberate changes are kept apart. Each read-only group between actions observed **no change**
in the fingerprinted tables. Each action's expected effect matched the observed one (`match=true` in the logs), apart
from the pass-1 history in Appendix D4.

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
| 2 | copy `coleman-derivation.json` into the build output; publish Coleman 2024 (Appendix D2) | +1 `derived_award_results`, +1 `derived_award_projections`, `award_winners` unchanged; copy removed and verified absent | publication persists |
| 2 | clear `eligible_rank` of the 2023 leader (player 8354), then record a synthetic INELIGIBLE ruling | +1 decision, +1 `data_edits`, `brownlow_season_votes` reprojected | persists |
| C | read-only Coleman compares 2024/2027/unsettled/1975 and the season choice | no change | — |
| C | publish Coleman 2023 unattested (refused), then attested, from the genuine bundle | +1 `derived_award_results`, +1 `derived_award_projections`, `award_winners` unchanged | publication persists |
| C | hide the bundle's `seasons.json`: approve proposal #5 and a compare, both refused | no change; restored, SHA-256 `1368e9b1…` match | none |
| C | hide the bundle's `coleman-derivation.json`: a compare and an attested publish, both refused | no change; restored, SHA-256 `93702c71…` match | none |
| C | clear `eligible_rank` of the 2022 leader (player 10243) for L-1, then restore it | `brownlow_season_votes` changed, then digest restored exactly | none |

**§1b, on `afldb_v2_visual_leaderboard_test` only** (26 tables fingerprinted per step):

| Step | Expected | Observed | Net |
|---|---|---|---|
| F1 voters | +3 `players`, +3 `external_identities` (synthetic voters, `afl_api` bridges) | +3, +3 | persists |
| W1 `runSettleAflApi` | one canonical synthetic match with its typed projection, spine observations and batch; unbridged roster players refused one by one | +1 `matches` (16993, `2026\|6\|2026-09-24\|Hawthorn\|Brisbane Lions`), +8 `match_period_scores`, +4 spine records and versions, +1 `staging.afl_api_match`, +1 `import_batches`, +2 `canonical_applications`, +2 `promotion_candidates`, +2 `import_rejections` (two roster players with no bridge); `player_match_stats` unchanged | persists |
| W2 `runSettleAflApiBrownlow` (autoApply off) | vote set, its projection and a 4-entry leaderboard staged; no canonical Brownlow row | +5 spine records and versions (1 vote set, 4 leaderboard), +3 `staging.afl_api_brownlow_vote`, +1 `import_batches`; `brownlow_round_votes` unchanged | persists |
| W3 the same with the fixture's 3-entry leaderboard | the 4th entry stamped absent; no canonical row | `CD_I900099` absent; projection rows refreshed (still 3); +1 `import_batches` | persists |
| U8 hide the bundle's `afl-api-identities.json` | nothing written; restored byte-identical | no change; SHA-256 `13eba653…` match | none |
| L-1 rerun: clear, then restore, the 2022 leader's `eligible_rank` | changed, then restored exactly | digest restored | none |
| LBr W2r, then W3 (recheck) | the absent entry reappears, then is stamped absent again; no canonical row | spine records changed, +1 `import_batches` each; `brownlow_round_votes` unchanged | persists |

**§1c, on `afldb_v2_visual_leaderboard_test` only** (15 tables fingerprinted per step):

| Run | Step | Expected | Observed | Net |
|---|---|---|---|---|
| D | read-only 09, S06, S04 | no change | no change | — |
| D | F clear the 2021 leader's `eligible_rank` (player 10130, was 1) | `brownlow_season_votes` changed | changed, row count equal | resolved by B9 |
| D | read-only B6, B7 (2021) | no change | no change | — (superseded, D3) |
| D | B8 blank citation and short note | refused, nothing written | no change | — |
| D | B9 record 10130 INELIGIBLE for 2021 (synthetic, sealed season) | +1 decision, +1 `data_edits`, `brownlow_season_votes` reprojected | +1, +1, reprojected | persists |
| Dr | verify the B9 record | one decision; 10130 projected ineligible | 1; `is_ineligible=true` | — |
| Dr | read-only S04 | no change | no change | — |
| Dr | F clear, then restore, the 2020 leader's `eligible_rank` (player 8354) | changed, then restored exactly | digest restored | none |

Net change of the D and Dr runs (fingerprints before and after, [proof](evidence/candidate-visual-20261029-dagger/preservation.txt)):
`afldb_v2_visual_leaderboard_test` only `brownlow_eligibility_decisions` (+1), `data_edits` (+1) and
`brownlow_season_votes` (2021 reprojected; row count equal). `afldb_v2_visual2_test` (`8da618da…`) and
`afldb_v2_rollbackapp_test` (`4e1dddbf…`) are identical before and after. No build-output file was touched; the
cluster and the server were stopped afterwards, as they were found.

End state of the LB clone against its source after §1b (before §1c): only `matches` (+1), `match_period_scores` (+8), `players` (+3),
`external_identities` (+3), `import_batches` (+5), `canonical_applications` (+2), `promotion_candidates` (+2),
`import_rejections` (+2) and the staging tables differ. Award, Brownlow vote, eligibility, `data_edits` and
`data_issues` tables are identical. 2026 `brownlow_round_votes`: 0. Signing in added `auth_sessions` rows, as in every
pass. **Preserved:** `afldb_v2_visual2_test` and its template `afldb_v2_rollbackapp_test` have identical fingerprints
before the clone and after both runs (combined `8da618da…` and `4e1dddbf…`). No other database was created or touched
([proof](evidence/candidate-visual-20261029-leaderboard/preservation.txt)).

## 6. Owner verdict (return this block)

```text
D-V2-VISUAL-1 — owner visual review of docs/v2/owner-visual-review-candidate-2026-10-29.md (corrected candidate,
application tree of 7670441b; build XtSgl4BOQZXC2G8qIWJdV).
Reviewed by: <screenshots | live on isolated environment> at <desktop and mobile>.
ACCEPT: <§1a, §1b and §1c items, §2 rows and §3 items>
REJECT: <row/item — defect>
NOT REVIEWED / OUT OF SCOPE: <rows/items, with reason; include the §4 gaps>
```

V2-GAP-022 closes only when every row and item is accepted or explicitly put out of scope by the owner. §1b accepts
the rendering of synthetic staged evidence; it cannot accept authentic provider reconciliation. Appendix D is not for
acceptance.

---

## Appendix D. Diagnostic history (not acceptance evidence)

These items show candidate `592c6c16` before the fix, a labelled workaround, or a harness artefact. They are kept for
the record and prove nothing about the corrected candidate.

### D1. Defects found in candidate `592c6c16` (all closed locally; see §1a)

| Gap | Severity | Defect | Seen in |
|---|---|---|---|
| [V2-GAP-036](known-gaps.md) | **High** | The standalone production bundle omitted `data/reference/coleman-derivation.json`, so every Coleman compare and publish was refused (`coleman_contract_unavailable`) | P2 K1–K4 |
| [V2-GAP-037](known-gaps.md) | Medium | Loader refusals rendered the raw `ENOENT` message with the absolute server path; it also overflowed the 390px page by 13px | P2 K1, U5 (mobile) |
| [V2-GAP-038](known-gaps.md) | Low | At 390px the Brownlow status token `refused_eligibility_rule_unrecorded` widened the page by 28px | P2 S03, B9, B10, B11 (mobile) |

Observation at the time (P2 B6): the determination said player 8354 was "unknown (not recorded)" while the raw totals
listed the same player as "eligible". Resolved as a label defect (§1a, L-1).

### D2. Superseded images

| Item | Images | Superseded by |
|---|---|---|
| Approval refused with the registry unreadable (server path shown) | P2 [d](evidence/candidate-visual-20261029-states2/U5-approve-refused-registry-unreadable__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/U5-approve-refused-registry-unreadable__mobile-390x844.png) | G-1 |
| Coleman compare as built, all refused (V2-GAP-036) | P2 K1 [d](evidence/candidate-visual-20261029-states2/K1-coleman-compare-2024__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/K1-coleman-compare-2024__mobile-390x844.png), K2 [d](evidence/candidate-visual-20261029-states2/K2-coleman-compare-2024-admin__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/K2-coleman-compare-2024-admin__mobile-390x844.png), K3 [d](evidence/candidate-visual-20261029-states2/K3-coleman-compare-2027__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/K3-coleman-compare-2027__mobile-390x844.png), K4 [d](evidence/candidate-visual-20261029-states2/K4-coleman-compare-unsettled__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/K4-coleman-compare-unsettled__mobile-390x844.png) | C-1 to C-5, G-3 |
| WORKAROUND: Coleman with the contract copied into the build output by hand | P2 W1 [d](evidence/candidate-visual-20261029-states2/W1-coleman-compare-2024-derivable__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/W1-coleman-compare-2024-derivable__mobile-390x844.png), W2 [d](evidence/candidate-visual-20261029-states2/W2-coleman-compare-2024-admin__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/W2-coleman-compare-2024-admin__mobile-390x844.png), W3 [d](evidence/candidate-visual-20261029-states2/W3-coleman-compare-1975-refused__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/W3-coleman-compare-1975-refused__mobile-390x844.png), W4 [d](evidence/candidate-visual-20261029-states2/W4-coleman-publish-unsettled-refused__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/W4-coleman-publish-unsettled-refused__mobile-390x844.png), W5 [d](evidence/candidate-visual-20261029-states2/W5-coleman-publish-outcome__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/W5-coleman-publish-outcome__mobile-390x844.png), W6 [d](evidence/candidate-visual-20261029-states2/W6-coleman-after-publish__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/W6-coleman-after-publish__mobile-390x844.png), W7 [d](evidence/candidate-visual-20261029-states2/W7-coleman-after-publish-admin__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/W7-coleman-after-publish-admin__mobile-390x844.png) | C-1 to C-8 |
| Brownlow 1996 tie (28px overflow on mobile) | P2 S03 [d](evidence/candidate-visual-20261029-states2/S03-brownlow-1996-tie__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/S03-brownlow-1996-tie__mobile-390x844.png) | B-12 |
| Brownlow 2023 after the decision (overflow on mobile) | P2 B10 [d](evidence/candidate-visual-20261029-states2/B10-brownlow-2023-after-decision__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/B10-brownlow-2023-after-decision__mobile-390x844.png), B11 [d](evidence/candidate-visual-20261029-states2/B11-brownlow-2023-after-decision-admin__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/B11-brownlow-2023-after-decision-admin__mobile-390x844.png) | B-13 |
| Brownlow season images from `592c6c16` with the old "Eligible" raw-totals header (formerly †) | A 09 [d](evidence/candidate-visual-20261029/09-brownlow-2025__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029/09-brownlow-2025__mobile-390x844.png); P1 S06 [d](evidence/candidate-visual-20261029-states/S06-brownlow-2025-admin__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states/S06-brownlow-2025-admin__mobile-390x844.png), S04 [d](evidence/candidate-visual-20261029-states/S04-brownlow-2027-refused__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states/S04-brownlow-2027-refused__mobile-390x844.png); P2 B6 [d](evidence/candidate-visual-20261029-states2/B6-brownlow-2023-requires-review__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/B6-brownlow-2023-requires-review__mobile-390x844.png), B7 [d](evidence/candidate-visual-20261029-states2/B7-brownlow-2023-requires-review-admin__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/B7-brownlow-2023-requires-review-admin__mobile-390x844.png), B8 [d](evidence/candidate-visual-20261029-states2/B8-decision-error__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/B8-decision-error__mobile-390x844.png), B9 [d](evidence/candidate-visual-20261029-states2/B9-decision-success__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-states2/B9-decision-success__mobile-390x844.png) | §1c D-09, D-S06, D-S04, D-B6 to D-B9 |
| The D run's S04, B6 and B7 (one mis-specified check, D3) | D S04 [d](evidence/candidate-visual-20261029-dagger/D04-brownlow-2027-refused__desktop-1280x800.png), B6 [d](evidence/candidate-visual-20261029-dagger/D-B6-brownlow-requires-review__desktop-1280x800.png), B7 [d](evidence/candidate-visual-20261029-dagger/D-B7-brownlow-requires-review-admin__desktop-1280x800.png) (mobile beside each) | D-S04, D-B6, D-B7 (Dr) |
| The full run's LB1 (one mis-specified check, D3) | LB [d](evidence/candidate-visual-20261029-leaderboard/LB1-brownlow-2026-unresolved-unmapped-refused__desktop-1280x800.png) / [m](evidence/candidate-visual-20261029-leaderboard/LB1-brownlow-2026-unresolved-unmapped-refused__mobile-390x844.png) | LB-1 (LBr) |

### D3. Harness check artefacts, corrected and rerun

- **The two case-sensitive L1 assertions (folder C).** The corrected-candidate run compared the authored words
  "unknown (not recorded)" and "Ineligibility evidence" against `innerText`. `innerText` returns the CSS-uppercased
  badge and table-header text, so both checks failed on a correct page (`failures=2` in the C log). The `text`
  checks of `candidate-visual-corrected.mts` and of the new tool now read the visible text with `text-transform`
  neutralised through the CSSOM. The words must still be visible and must still match the authored case exactly; the
  `forbid` checks of `candidate-visual-corrected.mts` are unchanged. Only the affected state, L-1, was rerun (LB folder).
  It passes, and a negative control proves that the comparison uses the authored case: the uppercased
  "UNKNOWN (NOT RECORDED)" and "INELIGIBILITY EVIDENCE" are not matched.
- **LB1 in the full run (folder LB).** The check for `unresolved_player_identity` failed because the finding codes sit in
  a collapsed `<details>`, which `innerText` omits. The page was correct: the image shows "Refused", `refusal: 1` and
  `refused_whole_set`. The tool now opens the findings and checks the code there. Only that state was rerun (folder
  LBr: the same writer re-staged the 4-entry leaderboard, then restored the resolved one). It passes with 0 failures.

- **The D run's no-winner check and final query (folder D).** The D run checked "no winner" as the absence of
  `[data-medal-winners]`. That element always renders and reads "none stated" when there is no winner, so S04, B6 and
  B7 failed on correct pages. After B9 (which passed, `match=true`), its verification query named a column that does
  not exist (`player_id`; the table holds `player_id_at_decision`), so the run stopped before writing its request
  counters and end fingerprint. The check now reads the winner line ("none stated") and the query uses the right
  column. `--recheck` (folder Dr) verified the B9 record, recaptured S04, and recaptured B6/B7 on 2020 with a
  reversible fixture, because 2021 now carries its decision. 0 failures, 0 external requests. B8 and B9 were not
  repeated.

### D4. Earlier pass notes

Pass 1's action-outcome images were taken while the page was scrolled, so the sticky header and sidebar are drawn
partway down them; pass 2 re-produced each of those states on an equivalent record, and only the clean images are
linked above. In pass 1 two expectations omitted the sealed-season `data_edits` audit row, which the operating guide
documents; pass 2 corrected them. Two pass-1 fixtures failed (identity columns) and were redone in pass 2.
