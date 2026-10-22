# ISSUE-316 C2 successor acceptance decision package — 2026-10-21

**Decision state: NOT ACCEPTED; production NO-GO** (updated 2026-10-22: rehearsal PASS at `5643f5c2`; see "Current
state and remaining decisions" below). Original 2026-10-21 implementation basis:
`4a2eea89cccc465f2f017fb06ad55a7d4cb7733d`. One agent; local documentation review only.
This package proposes the next bounded action; it grants no execution or acceptance authority.
2026 Brownlow remains pending. AFL API authority, historical eligibility and existing ownership
restrictions remain unchanged.

## Current state and remaining decisions — 2026-10-22

**Milestone achieved: complete isolated C2 rehearsal PASS at `5643f5c22025223916aa66cad6403a369a90c7cb`**
(verification, corrections and limits: [closure record](issue316-c2-rehearsal-closure-2026-10-22.md)).
Decision state is unchanged: successor **NOT ACCEPTED**, production **NO-GO**, ISSUE-316 **OPEN**. Every
rehearsal value (1,640 club-seasons, DOB pins, Coleman 47, the thirteen enrichment expectations, the
2026-inclusive census scope) is rehearsal-only and is not an active reference. The sections from "Evidence
reviewed and limits" down are the 2026-10-21 checkpoint at basis `4a2eea89`; their S1–S7 matrix and their
"Recommended next action" prompt are superseded by this section (that prompt was executed: its worksheet is the
[field review](issue316-c2-field-review-2026-10-21.md)). If no decision below is recorded, every row stays as it is
today: pending, rehearsal-only, or refused.

### Five separate approvals — none implies another

| Approval | What it would cover | What it does not cover |
|---|---|---|
| Brownlow 2026 publication | Authenticity, completeness and eligibility/authority evidence, then `complete` availability and a publication record for `brownlow_match_votes`, `brownlow_round_votes`, `brownlow_season_total` | Everything else can proceed with the three keys pending; the rehearsal proved pending suppression, not publication |
| Active successor adoption | Production contract, accepted-register entry, witness, availability and row-expectation bytes (predecessor retained, one accepted successor) | Rollover, census, deployment; the test register's single-entry replacement is not a model |
| Rollover | A real date, `retired`, `D-316-1`, completed through 2026, in-progress `[2027]`, network switch first | Adoption bytes, census, 2027 writer activation |
| Production census | Read-only zero-`afl_api`-owned-match proof over 1897–2026 for each exact target actually affected | Any other approval; a rehearsal census on an empty database is not this |
| Deployment / release | Freeze, backup/restore, migrations and privileges, timer/polkit retirement, release artefacts, recovery | Everything above |

### Remaining decision table

"Earlier" names the 2026-10-21 S-row or the sequential-review decision the row carries forward. Evidence documents
are in `docs/v2/` (closure record §7 lists their retained, uncommitted status).

| ID (earlier) | Decision required | Exact supported scope and evidence | What remains unproven | Accept / defer / reject | Later action it would authorise |
|---|---|---|---|---|---|
| N1 (S1) | Accept or reject each 2026 field family for a successor: results and linkage; final scores; ordinary player statistics (22 columns incl. `Time.on.Ground`); identity and biography; match attributes; player details | 218 results rows; 10,028 stats rows (218 groups of 46); 16,731-row details register. [Field review](issue316-c2-field-review-2026-10-21.md) §4: population, NA/empty/zero per column. [Linkage review](issue316-c2-linkage-review-2026-10-21.md) §5, §11: the 47 raw keys / 2,162 rows differ only by club label (GWS, Footscray), each with one canonical match; `Team` = `Playing.for` on all rows. Rehearsal: import, D7 and 91 checks pass | Independent publisher authority for any 2026 value; `Time.on.Ground` meaning; `Substitute` empty on all 10,028 rows (not false or zero); biography consistency by identity; `Last` not recomputed; details Goals unquoted-empty (4,437) meaning; attendance, start-time and officials authority; whether the successor contract records the label difference | **Accept** (per family, naming limitations): the family may be listed as accepted evidence for a successor proposal; no data or reference changes. **Defer**: the family stays pending and a proposal cannot bind its coverage. **Reject**: the family is excluded or needs remediation, and the rehearsal does not cover it | Offline drafting of successor bytes for accepted families. No adoption |
| N2 (S2) | Accept `complete` for completed 2026 for each of the 21 availability keys (`behinds`, `bounces`, `clangers`, `clearances`, `contested`, `contested_marks`, `disposals`, `frees_against`, `frees_for`, `goal_assists`, `goals`, `handballs`, `hitouts`, `inside50s`, `kicks`, `marks`, `marks_i50`, `one_percenters`, `rebounds`, `tackles`, `uncontested`) | Field review §5: each key 10,028 / 10,028 populated across 218 / 218 groups, NA 0, empty 0, explicit-zero counts per key; existing availability already says `complete` through 2026; rehearsal ran with those bytes | Authority and roster completeness (population is not authenticity); per-quarter player statistics (no key, still missing) | **Accept** per key: included in proposed availability bytes. **Reject**: that key is not `complete` for 2026 and a new rehearsal scope would be needed. **Defer**: no availability proposal | Offline availability-bytes proposal; applying it is a later approval |
| N3 (S1) | Accept Q1–Q4 team period scores as internally consistent evidence | [Quarter review](issue316-c2-quarter-review-2026-10-21.md): 235,440 repetition comparisons with 0 differences; 240,672 integer cells with P = 6G + B; cumulative progression; Q4 = final for 1,308 result and 20,056 player-row comparisons; both WF and 9 ordinary finals, no exemption | Publisher authentication; per-quarter player statistics | **Accept**: Q1–Q4 listed as consistent evidence. **Defer / reject**: period data is left out of the successor proposal | Included in proposal drafting |
| N4 (S1) | Extra-time (ET) applicability — still unresolved | The six ET columns are empty in all 10,028 rows (60,168 cells), no explicit zero; the importer's historical period path writes Q1–Q4 only | Whether any 2026 match had extra time; how ET should be stored | **Keep unresolved with an explicit "empty = unknown, never zero" limitation** (does not resolve ET); or **commission** external verification; fabricating ET zeros is rejected | External verification needs separate authority (network). Nothing else |
| N5 (S3/S4) | Adopt the explicit `baseline_only` model (heights and coaches share the baseline stats set, `supplements: []`) as the successor height and coach input model, in place of the 2026-09-02 register with supplement `issue129-t7-20260903` | [Height applicability](issue316-c2-height-applicability-2026-10-21.md) §4: all 9,614 supplement keys already occur in the candidate with identical join fields, so the supplement is redundant and double-counts; the unchanged runner refuses an empty list unless `baseline_only`. [Supplement-free proposal](issue316-c2-supplement-free-proposal-2026-10-21.md). Rehearsal: 16,713 mapped / 9 unmatched / 9 name_mismatch / 0 ambiguous, 12,579 fills with evidence, 0 open conflicts, final keys 12,579 / 0 / 0 / 1,916 / 84 enforced and matched | `HT`/`WT` meaning beyond parsing; production register capture metadata; the committed contract still carries the stale predecessor height block | **Accept**: the successor proposal binds `baseline_only` and the measured integers (rehearsal-only until adopted). **Reject**: a different model must be designed. **Defer**: no successor height block | Offline drafting of the production height block |
| N6 | Keep or change the refusals for rejected heights and identities | 18 register rejections including 9 `name_mismatch` spelling categories; Collingwood Caps 162 / 182 / 615 / 649 (register 22 / blank / 34 / 181 against profile 18 / 4 / 35 / 180); 9 informational jumper disagreements. [Exception evidence](issue316-c2-height-exception-evidence-2026-10-21.md), [goal verification](issue316-c2-height-goal-verification-2026-10-21.md), [source reconciliation](issue316-c2-height-source-reconciliation-2026-10-21.md) | Cause and correct total for the four goal cases; Victor Jackson's blank versus zero; every identity-changing proposal | **Preserve** (current): no authority needed. **Commission** independent external verification: evidence only, no correction applies automatically | External-evidence review restricted to the four Caps, if commissioned |
| N7 (D2, D5) | Historical corroboration inputs: use the exact AFL API roster and Wikipedia artefacts for the frozen rehearsal only, or require successor-derived captures before adoption | `rosters-20260905` (15 artefacts, 2012–2026, 2,395 provider ids): 1,916 mapped, 479 unmapped (418 no same-name or same-surname player at that club-season, 33 older namesake, 23 same-surname candidate rejected, 5 disjoint club-season); 1,177 equal the AFL Tables height, 737 differ, 2 canonical NULL. Wikipedia: 84 rows, 84 resolved, 60 agree, 24 differ; the file (`3d809e60…`) has no tracked content pin. [Sequential review](issue316-c2-sequential-measurement-review-2026-10-22.md) §§2–4, 7 | Completeness before 2012 and for 2012+; a successor-derived Wikipedia adjudication set; adjudication of the 761 disagreements (heights stay AFL Tables) | **Rehearsal-only**: stays "successor applicability unproven". **Require successor capture**: new acquisition and measurement before adoption | Capture or adjudication work needs separate authority (network or external evidence) |
| N8 (D3) | Coaches: allow parsed-only evidence for the rehearsal scope; require manifest-matching raw HTML before any provenance acceptance; and decide whether the ten page-total differences stay observations | `coaches-20260905`: 386 index rows and pages parsed, raw absent (the loader permits complete absence; a partial `raw/` fails); 386 coaches (368 linked, 18 coach-only), 32,470 assignments (16,035 both, 400 one, 621 none), 1,642 blank groups; 376 of 386 page totals agree. [Prerequisites](issue316-c2-sequential-measurement-prerequisites-2026-10-22.md) §4; sequential review §5 | Raw authenticity; why ten totals differ (eight equal 2026 ordinary-finals counts; Adamson +11 and Carter +11 unresolved) | **Parsed-only for rehearsal**: no change. **Require raw before production**: raw acquisition authority. **Commission attribution evidence**: row-level work | Raw acquisition and attribution work are separate approvals |
| N9 | 2026 Brownlow: keep all three keys pending, or open a separate publication workstream | Pending suppression proved: football 2026 complete, 669 player-seasons pending with NULL votes, round / season / match votes 0, published authority 0, projection `accepted=f status=pending`, historical 98 seasons / 79,113 votes / 112 winners ([closure §2 row 11](issue316-c2-rehearsal-closure-2026-10-22.md)) | Authenticity, completeness, eligibility and AFL API authority for 2026 | **Keep pending** (default): every other decision can proceed. **Open workstream**: evidence gathering only | Brownlow publication approval is separate and not implied by any row |
| N10 (S3) | Authorise drafting the exact production successor bytes: contract, register, witness, availability, row expectation | Test-only hashes in the historical checklist below and the rehearsal overlay hashes (closure §2 row 3) are provenance, not production bytes. Known fixes: the stale 2026 exclusion reason, the `UNSET-OWNER-DECISION` date, the stale height block, one accepted successor with the predecessor and older retired entries retained | No production bytes exist; the real date is unset | **Authorise drafting**: produces a reviewable proposal only. **Defer**: nothing is drafted | Dry-run review needs accepted inputs, a date and a fresh scoped census; apply is later |
| N11 (S4) | For each rehearsal-only value: stay rehearsal-only, or be proposed as a successor expectation for a stated scope | 1,640 (`c2-2026-rehearsal-only`); DOB 13347 / 0 / 13347 / 0 / 2 (predecessor 13255 / 0 / 13255 / 0 / 2); Coleman 47 (no ties; the existing gate already gives 47); enrichment 12,579 / 0 / 0 / 1,916 / 84 and coaches 386 / 368 / 18 / 0 / 32,470 / 16,035 / 400 / 621; census scope 1897–2026 with `in_progress_seasons: []` | Production inputs and scope; closure limits L3–L4 | **Stay rehearsal-only** (default). **Propose**: becomes an input to N10 only | Never an active reference by acceptance alone |
| N12 (S5) | Which targets a census must cover | No production, DEV or other live-target census exists. The rehearsal census (scope 1897–2026, pass, total 0) ran on an empty database (`schema_absent`) | Ownership of every populated target; freshness | **Define the exact target list**, or **defer** | Per-target read-only census approval, close to the protected window; a nonzero or unknown result is a STOP |
| N13 (S6) | Rollover date, `retired`, `D-316-1`, seasons boundary | Committed `seasons.json` has 2026 in progress (`[2026]`); the rehearsal overlay has `[]`. Desired boundary: completed through 2026, in-progress `[2027]`, no 2027 writer activation | The date; whether the dry run's six-file diff is accepted | **Supply the real date and choose `retired`**, or **defer** | Bounded dry run after N10 and N12; apply is a later approval |
| N14 (S7) | Release and recovery requirements | Nothing in the rehearsal establishes freeze, backup / restore, migration and privilege changes, timer / polkit retirement or deployment state; see the [release plan](production-release-plan-2026-10-21.md) | Current host and recovery state | **Schedule** or **defer** each item | Each item is a separate approval |
| N15 | Whether the rehearsal harness may support any production-adjacent run as it stands | Closure limits L5–L7: dependency lock differs from the repository lock; native libraries are observed, not enforced; capture / reinstate was proven on empty ledger data only | Native closure; a populated-ledger round trip | Not needed now; recorded so it is not dropped | A populated-copy rehearsal would need its own authority |
| N16 | Retention, cleanup and commit of evidence documents | DEV roots (attempt 1, lifecycle, attempt 2, runtime-proof roots, clones) and C: packages are retained; twelve evidence documents and `.codex/` are uncommitted (closure §7) | Disk and tidy-up policy | **Retain** (default), **authorise named cleanup**, or **commit the documents** | Cleanup and the documentation commit are separate approvals |

### Next approval prompt

Limited to the decisions needed to move from rehearsal PASS to a reviewable production proposal (N1–N11). The
owner may edit any line; nothing below is recorded until approved.

> I record these ISSUE-316 decisions at rehearsal PASS `5643f5c22025223916aa66cad6403a369a90c7cb`, using the
> "Current state and remaining decisions" section of `docs/v2/issue316-c2-successor-decision-2026-10-21.md` and
> `docs/v2/issue316-c2-rehearsal-closure-2026-10-22.md`:
> 1. N1–N3: ACCEPT, as evidence for a successor proposal only, the observed population, arithmetic, linkage-
>    representation (GWS and Footscray labels; empty `Round.Number` on the two WF rows), final-score and Q1–Q4
>    consistency facts for the listed families and the 21 availability keys for completed 2026. `Substitute`,
>    biography exceptions, `Last`, details Goals-empty, `Time.on.Ground` meaning and every independent-authority
>    question stay PENDING limitations.
> 2. N4: ET stays unresolved; empty ET is recorded as unknown, never zero; no external verification now.
> 3. N5: `baseline_only` shared height and coach stats with an empty supplement list is the proposed successor model;
>    the 2026-09-02 supplement is rejected as redundant and incompatible.
> 4. N6: the 18 height rejections, the four Collingwood cases and the informational jumpers stay as they are.
> 5. N7–N8: the roster, Wikipedia and parsed-coach inputs are proposed only as "rehearsal frozen, successor
>    applicability unproven"; parsed-only coach evidence is acceptable for the rehearsal scope and not for
>    production provenance; the ten coach-page differences and the height disagreements stay observations.
> 6. N9: all three 2026 Brownlow keys stay pending; no publication work.
> 7. N11: every rehearsal-only value stays rehearsal-only until a later explicit proposal.
>
> Authorise one local offline step: draft, without installing anything, the production-successor proposal (N10) for
> the accepted families only: the exact contract, register, witness, availability and row-expectation bytes, every
> byte difference from the rehearsal overlay, the stale-text fixes, and the values still needed from me. Read the
> closure record first; use native tools only; write one new proposal document and narrow tracking updates. No
> shell, Git, network, host, database, WSL, install, census, rollover, adoption, acquisition, rehearsal, cleanup,
> commit, push or deployment. N12–N16 are not decided here. Keep every refusal, ET unresolved, all three 2026
> Brownlow keys pending, and the authority, eligibility and ownership restrictions unchanged.

## Evidence reviewed and limits — historical checkpoint (2026-10-21, basis `4a2eea89`)

Reused `C:\tmp\afldb-c2-brownlow-fix-20261021\REPORT.md`, `repository-files.json`,
`offline-gates.json`, `candidate-prepared.json`, `candidate-measurements.json`,
`actual-rebuild-summary.json`, `dev-results.json`, and `dev-logs/` D7, public-projection,
source-verification and final-retention records. Reused the offline-analysis REPORT and the
fingerprint-bound owner decisions in [preparation package v5](issue316-c2-preparation-2026-10-21.md#approved-successor-input-decisions-record-only-contracts-unchanged).
No completed acquisition, historical comparison, correction analysis, census or rehearsal was rerun.

The four post-rehearsal tracking files named by `repository-files.json` were reviewed against
these retained records: `IssuesIndex.md`, `issues.md`, the ISSUE-316 runbook and preparation
package. Their recorded rehearsal results agree with the supporting records. Older blocked/
not-run/next-rehearsal text describes earlier checkpoints and is now explicitly historical.
This was a content review, not a Git diff or current-HEAD verification. The retained executable
source archive does not include these tracking documents. No Git command was run.

The original validation-tree REPORT could not be opened (local EPERM). Its recorded SHA-256
below is inherited from v5, not newly verified here. The accessible rehearsal-copy manifests,
contract, register and availability were read directly; manifest/contract/register hashes below
were checked locally. No claim of newly rechecking all raw acquisition files is made.

| Completed evidence | What it supports | What it does not support |
|---|---|---|
| Focused implementation checks: 310 pass/1 existing skip; 2 affected mutation contracts; typecheck/lint success | Retained focused validation of pending-readiness/import/public-projection repair; unrelated writer-list failure remains disclosed | Full-suite, full rebuild-runner or production release acceptance |
| Genuine offline candidate gates 3/3, isolated migrations/privileges/reference/core/historical Brownlow/full derived | Exact candidate can pass those phases under labelled test bindings | Canonical successor register acceptance or a production import |
| Real D7: exact two WF fixtures, all 18 reconstructed 2026 rows, all 1,640 H&A-policy rows | Strict WF reconciliation and ordinary historical comparison on that rebuilt disposable database | Independent published ladder authority, every 2026 field, or an accepted production row expectation |
| 17,056 matches, 695,499 player-match rows; 17,056 matches with player rows | Candidate projection/count consistency; independent H&A derivation is 1,622 + 18 | Match-by-match roster completeness or authenticity of every statistic |
| Football complete; 669 2026 player-seasons pending/NULL; zero canonical 2026 votes/publication/public rows; historical 98 seasons/79,113 votes/112 winners | Actual pending preservation and accepted historical projection in the disposable target | Authenticity/completeness/publication of 2026 Brownlow |
| 792 unchanged source/input hashes; own cluster stopped, PID absent/port free at 06:59:15Z | Recorded end-of-run integrity and retention | Present host state, census freshness, freeze or recovery readiness |

Do not repeat those completed phases merely to obtain production acceptance. Reuse is conditional
on exact implementation/input/policy equivalence; actual drift determines affected revalidation.

## Historical remaining decision matrix (2026-10-21; superseded by the 2026-10-22 table above)

| ID | Exact remaining decision/evidence | Current support and boundary | Next authority |
|---|---|---|---|
| S1 | Accept or reject the 218 new 2026 results rows and 10,028 2026 player-stat rows, by field family below | Candidate imports and match coverage pass; historical comparison is already accepted. Every new field is not thereby accepted | Owner field/coverage adjudication, bound to exact bytes |
| S2 | Reviewed 2026 availability for each of the 21 non-Brownlow keys below; attendance/DOB/time-on-ground and other non-grid fields separately | Existing grid says complete for those keys; it is not a fresh successor field review. Missing-value counts and authority decisions are not established by the retained aggregate PASS | Fill only missing retained-input coverage evidence, then owner accepts exact availability bytes |
| S3 | Exact successor contract, witness, coverage, corrections and register binding | Test contract/register hashes are known; both are rehearsal-only. Corrections/continuity decisions already exist and must not be reopened without drift | Review proposed production bytes; separately authorise successor acceptance/register creation |
| S4 | Production applicability of 1,640 and all affected rebuild-stage dependencies | Independent H&A derivation and actual disposable D7 support 1,640 for this candidate; approval is rehearsal-only | Owner records applicability to the intended production rebuild scope/inputs, not merely the witness row count |
| S5 | D-233-3 target list and fresh census for every database actually affected by rebuild/promotion | No production census established by this rehearsal; no live target was contacted in this review | Separate exact-target read-only inspection/census approval after scope is fixed |
| S6 | Actual rollover date, `retired` status and D-316-1 rollover authority | Acquisition slice already completed. Date remains unset; old broad proposed wording is not an approval | Owner supplies the real date and approves a bounded dry run only after inputs/censuses are ready; apply is later |
| S7 | Exact six-file proposal, affected checks and operational release readiness | No active reference changed; rehearsal does not establish current freeze/backup/recovery or deployment state | Separate dry-run review, apply/commit, production mutation and release/deployment approvals |

## Exact field and coverage decision scope

Existing approvals remain settled: two Jim Stewart row drops, all three bounded club rules
(including ladder-only Kangaroos), display-only fallback for the four profiles, continuity
52/31/42/25 rows, Billy Wilson remaining separate, historical LF-only changes and the documented
player-details movement. Do not repeat that analysis or broaden a rule.

The remaining worksheet must distinguish observed population/consistency from accepted source
authority. For every family, cite existing evidence first; only measure missing facts from the
retained bytes. Record rows/matches covered, NA/empty/zero semantics, exceptions, proposed
coverage and an explicit accept/reject/pending decision. No default acceptance from a clean import.

| Family | Exact fields requiring successor review | Required distinction |
|---|---|---|
| Results and match linkage | `Game`, `Season`, `Date`, `Round`, `Round.Number`, `Round.Type`, `Home.Team`, `Away.Team`, `Venue`; player-row `Season`, `Date`, `Round`, `Home.team`, `Away.team`, `Playing.for`, `Home.Away` | Accept exact 2026 match/round/finals/venue/team linkage and completion basis; the source/canonical WF comparison is already proved |
| Scores | `Home.Goals`, `Home.Behinds`, `Home.Points`, `Away.Goals`, `Away.Behinds`, `Away.Points`, `Margin`; `Home.score`, `Away.score`, `HQ1G..HQ4P`, `AQ1G..AQ4P`, extra-time G/B/P columns | Separate final-result consistency from period/extra-time coverage; absent extra time is not fabricated zero |
| Ordinary player statistics | `Kicks`, `Marks`, `Handballs`, `Disposals`, `Goals`, `Behinds`, `Hit.Outs`, `Tackles`, `Rebounds`, `Inside.50s`, `Clearances`, `Clangers`, `Frees.For`, `Frees.Against`, `Contested.Possessions`, `Uncontested.Possessions`, `Contested.Marks`, `Marks.Inside.50`, `One.Percenters`, `Bounces`, `Goal.Assists`, `Time.on.Ground` | Presence of 78 columns/10,028 rows is not field completeness; preserve recorded-zero versus unknown |
| Identity/biography and match attributes | `ID`, `url`, `Player`, `First.name`, `Surname`, `DOB`, `Age`, `Career.Games`, `Team`, `Jumper.No.`, `Substitute`, `Coach`, `Umpire.1..4`, `Local.start.time`, `Attendance` | Reuse approved identity exceptions. Review remaining coverage/consistency; identify fields merely preserved in raw evidence. Do not infer stable identity from names |
| Player details / dependent stages | `Player`, `Team`, `Cap`, `#`, `HT`, `WT`, `Games`, `Wins`, `Draws`, `Losses`, `Goals`, `Seasons`, `Debut`, `Last`, `date_accessed` | Historical change finding already accepted; `Last` was not independently recomputed. Decide treatment without asserting such a check passed. This dataset has no stable ID or DOB |
| Brownlow | `Brownlow.Votes`; `brownlow_match_votes`, `brownlow_round_votes`, `brownlow_season_total` | Keep all three 2026 keys pending, canonical values suppressed and publication absent. Structural 3-2-1 evidence gives no authenticity/completeness approval |
| Ladder witness | `Season`, `Team`, `Round.Number`, `Season.Points`, `Score.For`, `Score.Against`, `Percentage`, `Ladder.Position` | Accept exact raw witness/coverage binding separately; locally computed witness is cross-check only, never sourced club-season facts |

The 21 non-Brownlow availability keys currently covering 2026 as `complete` are:
`behinds`, `bounces`, `clangers`, `clearances`, `contested`, `contested_marks`, `disposals`,
`frees_against`, `frees_for`, `goal_assists`, `goals`, `handballs`, `hitouts`, `inside50s`,
`kicks`, `marks`, `marks_i50`, `one_percenters`, `rebounds`, `tackles`, `uncontested`.
Review their completed-2026 applicability; do not silently alter historical ranges or invent
availability keys for fields outside this grid. Per-quarter player statistics remain missing;
team period scores do not establish their availability.

## Binding checklist for a later successor proposal

| Input | Exact retained binding |
|---|---|
| Original acquisition / validation / analysis | `C:\tmp\afldb-c2-final-20261021T041849978`; `C:\tmp\afldb-c2-validation-20261021T045933581`; `C:\tmp\afldb-c2-offline-analysis-20261021` |
| Analysis REPORT / validation REPORT | `7da06978d867a4aa4decf3816e25efbdb2543c535891d0e2418fa2f941c10285` / `2dd56fe7f6231b8ae1324ed290da9faeb6246328d4a4e25ad45850010c3e0eb5` (validation hash recorded, original unreadable here) |
| Acquisition 391-entry SHA256SUMS | `d48352dafc644d0c65ddb53c83c94721f3f7474a7590351bd92811c4c6b771d3` (retained v5 verification) |
| Core label / manifest | `c2-2026-final-core-v1`; `docs/rebuild-manifests/afltables_fitzroy_core/c2-2026-final-core-v1.json`; SHA-256 `02bbcf932ef71d411c5d5077ae85000ebdbc0896323cf3f57c0e9fa417cf9988` |
| Core artefact set | 132 files / 729,288 raw rows; digest `817d594e5c0529b6524c8b211a209b9ef25a500c5c463daad8e3bb7b1eee7b7e` in the test register; production register must bind the measured set |
| 2026 stats / results / details | SHA-256 `79db69732ea1018b577e548622e6c702c1a79270478cc019dc80571fc217898f` / `73769e3ef608103c6c4e7ac6f58ce82484f85bd8058955ec502a9d64cb834f52` / `03f790eeeca85426b7866e2b034c600091a4061177eb4c0e572667cea91f133f` |
| Witness label / manifest | `c2-2026-final-ladder-v1`; `docs/rebuild-manifests/afltables_fitzroy_core/c2-2026-final-ladder-v1.json`; SHA-256 `65c299072afb35f1b0ddce50c9c72728e03bcd1580d676ca63eaaafb86047c34` |
| Raw witness / coverage | `ladder_2026.csv` SHA-256 `9f0358243a76d11a3db514933981fcbb49000d7ac950cf277bb278a32beb42ff`; 130 files/seasons, 1897–2026, 1,640 rows, 20 raw labels, 18 rows in 2026; historical identity resolution remains mandatory |
| Rehearsal source | `C:\tmp\afldb-c2-brownlow-fix-20261021\REHEARSAL-ONLY-source`; source bundle SHA-256 `73cb5dcdb25b357fb7287b63172bdccd461df1b1dc1d95d240c06b5fb86716bd` |
| Test-only contract / register / availability | `tools/rebuild/fitzroy/fitzroy-contract.json` SHA-256 `a0c01bc285b98c902d2a64b37ded687d2ac552cb71edc5bf9cc6459a7053cfb8`; `data/reference/fitzroy-accepted-baselines.json` SHA-256 `f05a069dc486dd869e15874e3922e1fb63118d9a66f79e749b170b2a6b5d7b80`; `data/reference/stat-availability.json` SHA-256 `e2900084ebd7e9505239b82aef8f8665fcf7939e7b84b94b13e110fa6cfcc2b8` |

Those test-only hashes are provenance, not proposed production acceptance hashes. A later
production proposal must preserve/retire the predecessor `full-history-20260902` and retain
older retired entries, select exactly one accepted successor, bind manifest/artefact digest,
versions, measured counters, identity scan, exact corrections and reviewed availability/coverage.
Do not copy the test register's single-entry replacement into the active register.

The contract must explicitly cover 1897–2026, exclude 2027, retain the required three core
datasets and separate witness role, and use the actual owner-approved date. Fix the test
contract's stale exclusion reason (still describes 2026 as current despite `[2027]`) in the
future proposal. Its `UNSET-OWNER-DECISION` date must never become accepted metadata.
The height-enrichment block still describes the 2026-09-02 register and old in-season supplement/
measurements: successor applicability must be reviewed, not inherited as a fresh measurement.
The retained rehearsal phases did not execute the height enrichment or every rebuild-runner stage.

## Ownership census and rollover requirements

Before a census request, agree the full list of actual rebuild/promotion targets. At minimum,
the intended production database must be verified if production is in scope; include DEV/test
only when actually affected. Do not infer scope from the stopped disposable `_test` cluster.
For each target, separately pin host/port/database/role identity, read-only least-privilege
credential handling, source/CLI version, through-season 2026 (1897–2026 scope), evidence path,
timestamp and hash. Require **zero in-scope `afl_api`-owned canonical matches**. Unknown scope,
unverified identity, nonzero ownership or intervening relevant writes is a STOP; refresh after
drift/before the protected mutation window. No re-ownership, census editing or guard relaxation.
A test fixture or historical statement about afltables ownership is not this census.

The owner must supply the actual rollover date (`YYYY-MM-DD`), choose `retired` (the allowed
retirement status), and separately grant the remaining D-316-1 rollover slice. Today's date,
acquisition timestamp and source GF completion do not choose that date. Final acquisition
authority was already used; do not ask for another acquisition or reuse the old broad §8 prompt
as authority for census/apply/commit/deployment.

After accepted inputs and fresh scoped censuses, a separately authorised dry run must run all
three real gates against the proposed production bindings, read back temporary files identically
and yield the exact six-file diff: network switch first, accepted register, seasons, contract,
availability and rebuild row expectation. Desired boundary: switch `retired` / `D-316-1`,
completed through 2026, in-progress `[2027]`; no 2027 writer activation. Dry run precedes a
separate apply decision. Per-file renames are not a six-file transaction; freeze/recovery,
backup/restore, release-artifact checks, migration/privilege changes, timer/polkit retirement and
deployment remain separately gated under the [release plan](production-release-plan-2026-10-21.md).

## Historical recommended next action and approval prompt (executed 2026-10-21; superseded)

Complete only the missing offline field/coverage worksheet before requesting a fresh census.
This avoids ageing live evidence while semantic acceptance is undecided. Reuse the completed
comparison, corrections, H&A derivation and D7; no acquisition or rehearsal rerun is needed now.
The worksheet is evidence for an owner decision, not automatic successor acceptance.

> I authorise one local offline completion of the missing 2026 field/coverage worksheet for
> ISSUE-316, using implementation basis `4a2eea89cccc465f2f017fb06ad55a7d4cb7733d` and only the
> exact retained inputs/hashes in `docs/v2/issue316-c2-successor-decision-2026-10-21.md`.
> Read the existing reports/outputs first. For cells still unsupported, permit in-process local
> filesystem/CSV inspection of the hash-bound copies under
> `C:\tmp\afldb-c2-brownlow-fix-20261021\REHEARSAL-ONLY-source` and the retained offline-analysis
> outputs. Do not execute retained acquisition/import/rebuild scripts. No shell, Git, network,
> host, database, WSL, new dependency or census access is authorised.
> Write only `docs/v2/issue316-c2-field-review-2026-10-21.md` (refuse if it already exists) and
> narrowly update links/current next actions in the four existing ISSUE-316 tracking files.
> Cover exactly S1/S2's field families and the height/dependent-stage applicability gap in this
> package; show existing evidence, missing measurements, NA/empty/zero distinctions and explicit
> accept/reject/pending choices for owner review. Keep the already approved correction/continuity
> scopes fixed, all three 2026 Brownlow keys pending, AFL API authority and ownership/eligibility
> restrictions unchanged. Do not create accepted contract/register entries, change active
> references, set a rollover date, adopt 1,640 for production or infer acceptance from the rehearsal.
> Check each input actually consumed against its manifest/recorded hash. Stop and preserve
> evidence on hash drift, unreadable required input, unexplained identity/field discrepancy,
> required external verification, or any need to widen scope. Mark unsupported decisions pending;
> do not repair data or manufacture authority. No repeated completed analysis, acquisition rerun,
> rehearsal, cleanup, rollover, commit, push or deployment. Return the worksheet and remaining
> owner choices, then stop.

This prompt was prepared for a subsequent explicit approval and was not executed in the 2026-10-21 review. It was
later approved and executed; its output is the [field review](issue316-c2-field-review-2026-10-21.md), and the
current next approval is the prompt in "Current state and remaining decisions" above.
