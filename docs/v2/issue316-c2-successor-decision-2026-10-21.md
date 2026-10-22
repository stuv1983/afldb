# ISSUE-316 C2 successor acceptance decision package — 2026-10-21

**Decision state (2026-10-23, Revision 6): successor APPROVED CONDITIONALLY on AFLDB-ISSUE-319 and AFLDB-ISSUE-320, NOT ACTIVATED; production NO-GO.** Earlier state: NOT ACCEPTED (updated 2026-10-22: rehearsal PASS at `5643f5c2`; see "Current
state and remaining decisions" and "Consolidated successor proposal" below). Original 2026-10-21 implementation basis:
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
| N16 | Retention, cleanup and commit of evidence documents | **Recorded 2026-10-22:** all evidence retained, no cleanup; the twelve evidence documents were reviewed (closure §7–§8) and are committed in the evidence-retention documentation commit. `.codex/` stays uncommitted. DEV roots and C: packages are retained | Disk and tidy-up policy | Retained; documentation commit done | Any cleanup remains a separate approval |

### Next approval prompt (superseded 2026-10-22: its N1–N9, N11 decisions were recorded as bounded decisions and N10 drafting produced the consolidated proposal below; kept as history)

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

## Consolidated successor proposal — 2026-10-22

**Status: PROPOSAL ONLY — nothing installed, nothing accepted.** ISSUE-316 OPEN; production NO-GO; successor NOT ACCEPTED. No active contract, register, reference, availability, row-expectation, source or test file was changed. 1,640 stays rehearsal-only; 2026 Brownlow stays pending (all three keys); ET stays unresolved; AFL API authority, eligibility and ownership restrictions are unchanged. The five approvals above remain separate: this section is the reviewable content for "Active successor adoption" only, and it is not runnable (see "Unresolved fields").

### Bounded decisions recorded by the owner on 2026-10-22

| Rows | Recorded |
|---|---|
| N1–N3 | The observed population, arithmetic, canonical linkage and Q1–Q4 consistency facts are accepted as **evidence for proposal drafting only**; all 21 ordinary availability keys are in the proposed scope. This does not establish independent authenticity or accept unsupported field meanings. `Substitute` empties, biography exceptions, `Last`, details Goals-empty semantics, `Time.on.Ground` meaning and independent-authority questions stay **pending**. |
| N4 | ET stays unknown; an empty cell never becomes zero. |
| N5 | Propose `baseline_only` shared height/coach statistics with no supplement; exact baseline binding and all gates preserved. |
| N6 | All height and identity rejections and the informational jumpers are preserved. |
| N7–N8 | Historical corroboration and parsed coaches are frozen rehearsal inputs, successor applicability unproven; missing coach raw is not accepted for production provenance; disagreements and coach attribution stay unresolved. |
| N9 | All three 2026 Brownlow keys stay pending; no publication work. |
| N11 | Measured values may appear as **proposed successor expectations**, rehearsal-only until separately adopted. |
| N16 | All evidence retained; the twelve supporting documents committed after bounded review (closure §7–§8); no cleanup. |
| N10 | Drafting authorised (this section and the package below). N12–N15 remain unapproved operational decisions. |

### Proposal package (labelled, on C:, not in the repository)

`C:/tmp/afldb-c2-SUCCESSOR-PROPOSAL-NOT-INSTALLED-20261022T091212Z/` — 54 files; `PROPOSAL_MANIFEST.json` sha256 `1d71f4caaa8255a97593bc57c30da11e2ba028feae3bbe22021f5d8fca0927fa`. It is derived from the **active repository bytes** (HEAD `66acf53b` lineage), never from the rehearsal overlay, which is compared only. Generator and pure offline checks are in its `scripts/`; the check result is `analysis/OFFLINE_CHECKS.json` (**52 checks, 0 failures**; no runner, planner, importer, gate, census, database or network was run).

| Part | Path under the package | sha256 (first 16) |
|---|---|---|
| Reviewed planner input: ladder coverage | `proposed/artifacts/rollover/ladder-coverage.json` | `00a4957e08da19b6` |
| Reviewed planner input: accepted corrections | `proposed/artifacts/rollover/accepted-corrections.json` | `3a938b52b8a26342` |
| Reviewed planner input: availability (byte-identical to active) | `proposed/artifacts/rollover/stat-availability.json` | `e2900084ebd7e950` |
| Pre-rollover working tree: fitzroy contract | `proposed/pre-rollover-working-tree/tools/rebuild/fitzroy/fitzroy-contract.json` | `5768f078dc3846a4` |
| Pre-rollover working tree: afl-api contract | `…/afl_api/afl-api-contract.json` | `1453fffaa50dee67` |
| Pre-rollover working tree: afltables contract | `…/afltables/afltables-contract.json` | `173a923340764f9e` |
| Expected after rollover: fitzroy contract | `proposed/expected-after-rollover/tools/rebuild/fitzroy/fitzroy-contract.json` | `a40fcd1508afd0de` |
| Expected after rollover: accepted register | `…/data/reference/fitzroy-accepted-baselines.json` | `691e03a28ea2f139` |
| Expected after rollover: seasons | `…/data/reference/seasons.json` | `1368e9b100788fd6` |
| Expected after rollover: AFL Tables network switch | `…/data/reference/afltables-network.json` | `e27d0fce64ad724c` |
| New tracked manifest: core (`c2-2026-final-core-v1`) | `proposed/new-tracked-files/docs/rebuild-manifests/afltables_fitzroy_core/` | `02bbcf932ef71d41` |
| New tracked manifest: ladder (`c2-2026-final-ladder-v1`) | same directory | `65c299072afb35f1` |
| Row-expectation patch (anchor only) | `…/tools/db/rebuild-test.ts.club-seasons-constant-only.txt` | `910c1f00a79d4028` |
| Analysis | `analysis/{SEMANTIC_DIFFERENCES,FINGERPRINTS,UNRESOLVED_FIELDS,BLOCKED_BINDINGS,OFFLINE_CHECKS}.json`, `ORDERING_AND_PREREQUISITES.md` | see `PROPOSAL_MANIFEST.json` |

Source fingerprints: core manifest `02bbcf932ef71d411c5d5077ae85000ebdbc0896323cf3f57c0e9fa417cf9988` (132 files, 729,288 rows, LF); artefact-set digest `817d594e5c0529b6524c8b211a209b9ef25a500c5c463daad8e3bb7b1eee7b7e` (recomputed); ladder witness manifest `65c299072afb35f1b0ddce50c9c72728e03bcd1580d676ca63eaaafb86047c34` (130 files, 1,640 rows, LF); all 262 raw artefacts hash to their manifest entries. Active inputs: availability `e2900084ebd7e9505239b82aef8f8665fcf7939e7b84b94b13e110fa6cfcc2b8`; the other active hashes are in `analysis/FINGERPRINTS.json`.

### Exact semantic changes (active → proposed)

**Rollover-planner-generated (predictable by the planner's own dry run; the dry run is the authority):**
- `seasons.json`: `last_season` 2026 → 2027; `in_progress_seasons` `[2026]` → `[2027]`; the "Season in progress" note moves from 2026 to 2027.
- `afltables-network.json`: `status` active → `retired`; `decision` null → `D-316-1`; `changed_at` null → **unresolved date**.
- Contract: `season_range.last_season` 2025 → 2026 (rule text rewritten for 2027); `current_season_excluded.seasons` `[2026]` → `[2027]`; `accepted_witness` re-pointed to `c2-2026-final-ladder-v1` (129 → 130 files, 1,622 → 1,640 rows, acquired 2026-10-21, new manifest sha); `ladder.coverage` 1897–2026 (130 seasons, 1,640 rows, max 18 rows 2012–2026).
- Register: predecessor `full-history-20260902` `accepted` → `retired` (nothing else changes; the older `full-history-20260827` entry is deep-equal); one new `accepted` entry `c2-2026-final-core-v1` appended (three entries; exactly one accepted). **Not** the rehearsal's single-entry replacement; **no** `rehearsal_not_selected` status.

**Outside the planner (must exist in the working tree before the dry run — see B2):**
- Continuity expectations: `renumbered_last_season` 2025 → 2026 and `renumbered_rows` 25 / 18 / 23 / 13 → **52 / 31 / 42 / 25** (150 rows, 4 players; `Billy_Wilson2` not folded).
- Height block (N5): `stats_input_mode: baseline_only`, `baseline_snapshot_label: c2-2026-final-core-v1`, `supplements: []` (the 9,614-row `issue129-t7-20260903` supplement is dropped as redundant), `register_captured_on` 2026-09-02 → 2026-10-21 (every details `date_accessed` is 2026-10-21), `players_with_height` 12,487 → 12,579, `height_without_evidence` 0, `height_conflicts_open` 0 (proposed successor expectations, N11).
- `ladder.rebuild_expectation` (exactly the runner's eight keys): core `c2-2026-final-core-v1` / `02bbcf93…` / `817d594e…`, witness `c2-2026-final-ladder-v1` / `65c29907…`, `expected_rows` 1,622 → 1,640; `profile` is an **unresolved sentinel** (B1).
- `current_season_excluded.reason`: year 2026 → 2027 only (wording after AFL Tables retirement not reviewed, U8).
- `afl-api-contract.json`: `players_with_afl_api_evidence` 1,824 → 1,916. `afltables-contract.json`: `players_with_dob` and `players_with_club_list_birth_evidence` 13,255 → 13,347; `match_coaches` 32,034 → 32,470; `matches_with_both_coaches` 15,817 → 16,035. Predecessor acceptance metadata (`accepted_on`/`accepted_in`) is left as recorded; the comments say these are rehearsal-measured expectations with successor applicability unproven.
- `rebuild-test.ts` `CLUB_SEASONS_EXPECTED.rows` 1,622 → 1,640 (one anchored match verified; planner-written) — **B1/B6 prevent installing it alone**.

**Reviewed inputs, not file edits:** accepted corrections (same four categories as the outgoing entry; three `source_normalisation` rules including the explicit **ladder-only North Melbourne 1999–2007 → Kangaroos** rule; Jim Stewart's two 1909 drops; display-name fallback and continuity at 150 rows / 4 players); availability **byte-unchanged** (21 keys `complete` through 2026; the three Brownlow keys `pending` for 2026; no fabricated or retracted coverage).

**Differences from the rehearsal overlay (compared, not copied):** the overlay register was a selector fixture (predecessor `rehearsal_not_selected`, entry without `accepted_on`/`issue`/`validation`/`amendments`, `accepted_corrections` categories the planner would refuse); the overlay contract has `_rehearsal_only` markers, no `first_season_source`/`resolved_on`, `excluded: []`, a stale "BLOCKED" text, and 19 mojibake strings (3 in the register). Full lists: `diffs/overlay-to-proposed/`.

### Unresolved fields (sentinels in the package — deliberately not runnable)

U1 rollover date (feeds `accepted_on`, `validated_on`, `resolved_on`, `changed_at`) · U2 register `validation.verdict` (earned only by the executed gates) · U3 production ladder profile name · U4 confirm `retired` · U5 the D-316-1 grant · U6 whether the predecessor gets `retired_on`/`superseded_by` (planner writes neither; not added) · U7 `issue` attribution (planner hard-codes `AFLDB-ISSUE-101`) · U8 post-retirement exclusion-reason wording · U9 coach provenance restatement (no new acceptance date manufactured).

### BLOCKED bindings (none weakened)

B1 no production `LADDER_PAIRS` tuple: the 1,640 tuple is hard-wired to rehearsal provenance and an isolated target · B2 the planner cannot carry the continuity/height/expectation/measurement edits, and the continuity edit makes the predecessor invalid, so it must land atomically or the planner must be extended · B3 planner-copied predecessor comments need reviewed text (drafted) · B4 coach raw HTML absent, Wikipedia file unpinned, 479 provider ids unmapped · B5 no live-target ownership census · B6 tests that pin 1,622 · B7 the two manifests and 262 raw artefacts are not placed on any target · B8 DEV lock/Python reproducibility unproven (closure §8.2). Detail with evidence: `analysis/BLOCKED_BINDINGS.json`.

### Ordering

Adoption content and rollover are separate layers but the planner couples them in one write. Order: owner decisions → implementation (B1, B2, B6) → placement of manifests and raw data → per-target read-only census (scope 1897–2026) → working-tree pre-edits (uncommitted) → rollover **dry run**, compared semantically with the model → apply, post-planner text edit, whole-diff review → one operator commit → rebuild PRECHECK. Release, freeze, recovery, migrations, timer/polkit retirement and deployment are separate approvals. Table: `analysis/ORDERING_AND_PREREQUISITES.md`.

### Ready for owner review versus blocked

- **Ready (content):** continuity expectations, baseline_only height block and measured values, ladder witness/coverage binding, `rebuild_expectation` tuple (all but the profile name), measured afl-api/afltables expectations, register entry (all but three sentinel fields), accepted corrections, byte-unchanged availability, the two verified manifests, the 1,640 constant patch.
- **Blocked:** everything under B1–B8 and U1–U9. The proposal cannot become runnable until the owner supplies U1, U3–U8 and the gates produce U2.

### Smallest consolidated set of owner decisions needed next

1. **Review the proposed content (N10).** Accept, amend or reject the "Ready" list as the intended successor content. Nothing is installed by this.
2. **Implementation route (B1/B2/B6).** Authorise one source slice: a production ladder tuple (and its name, U3) with tests, plus either a reviewed planner contract-override input or an explicit atomic working-tree procedure. Without it the 1,640 expectation cannot run outside the isolated rehearsal.
3. **Provenance stance for production (B4, N7/N8).** Require manifest-matching raw coach HTML, a tracked Wikipedia pin and successor-derived captures, or record that parsed-only/frozen inputs are acceptable for production. Missing raw is not accepted today.
4. **Rollover inputs (N12/N13, U1/U4–U8).** Target list for the census, the real date, `retired`, D-316-1, the exclusion-reason wording, the `issue` attribution and whether to add `retired_on`/`superseded_by`.
5. **Runtime reproducibility (N15, B8).** Authorise retaining the DEV lock evidence, verifying the Linux esbuild package, and pinning the Python environment before any populated or production-adjacent run.

Release and recovery (N14), Brownlow publication (N9) and cleanup stay separate approvals.

## Revision 1 — 2026-10-22 (planner change set, runtime evidence, revised drafts)

**Status: PROPOSAL ONLY — nothing installed, nothing accepted.** ISSUE-316 OPEN; successor NOT ACCEPTED; production NO-GO; 1,640 rehearsal-only; Brownlow 2026 pending (all three keys); ET unresolved; authority, eligibility and ownership restrictions unchanged. This section consolidates into the package above rather than starting another proposal chain; the original 54-file package is unchanged (`PROPOSAL_MANIFEST.json` `1d71f4ca…927fa`, 54/54 entries re-hashed, 0 mismatches).

**What changed.**
- **B2 is technically ready (commit `5a09f3e5`).** `tools/db/rollover-season.ts` takes an optional `--transition-change-set`. The change set binds, by explicit old SHA-256 and proposed SHA-256: the base fitzroy contract (the edits the planner cannot compute), whole-file replacements for the two measured-count contracts, five role-bound inputs (core manifest, ladder manifest, coverage, availability, corrections), `$comment`-only register patches with an explicit expected old value, the complete `write_set`, and `final_sha256` pins that `--apply` requires. Planner-owned contract fields in the base must equal the current contract. No working-tree pre-edit exists, so the predecessor stays coherent until the single staged apply; the original "pre-rollover working tree" and "post-planner text edit" steps disappear. Any `UNRESOLVED:` sentinel in the change set, a proposed file or a planned output refuses. The successor register must keep the predecessor and older entries byte-for-byte except the outgoing status. Apply stages and reads back every file, writes `.rollover-transaction.json`, renames (AFL Tables switch first), verifies, then removes the journal; an interrupted apply makes every later invocation refuse and print per-file recovery steps. A concrete per-field dry-run diff and the `final_sha256` list are printed.
- **Tests** (database-free, in the existing suites): `tests/season-rollover.test.ts` 230 passed / 2 failed (232) and `tests/afl-api-cutover.test.ts` all passed; nonincremental `tsc` clean. *Correction (2026-10-22, later):* the two failures (`finalValidationChecks` needing a ladder argument; a Python-source assertion on `CONTRACT.read_text`) were not "unrelated": the first is a fixture gap from `39e80642` (green at `b8ea2855`, red at `39e80642`), the second a source defect from `4b5e2490` (green at `a5435274`, red at `4b5e2490`). Both are repaired in `c7443fc2`.
- **B3 is carried** as three register `$comment` patches. **B8 is partly closed** (§8.3 of the [closure record](issue316-c2-rehearsal-closure-2026-10-22.md#83-read-only-dev-runtime-inspection--what-it-closed-and-what-it-did-not-2026-10-22-later-the-same-day)): lock retained and classified, Linux esbuild tied to lock integrity, 2,445/2,445 run-record files equal; Python archive integrity, run-time lock bytes, native enforcement and a clean `npm ci` remain unproven.
- **U4 resolved mechanically** (`retired` is the only vocabulary value). **U8 found stale:** the reason text names a quarantined CLI and a refusing npm script, independent of AFL Tables. U5–U7 and U9 stay owner choices with stated consequences.

**Revised package (not in the repository):** `C:/tmp/afldb-c2-SUCCESSOR-PROPOSAL-REVISED-20261022T100918Z/` (`HASHES.sha256` lists every file). Draft change set `7678593f5e322145…`; `analysis/DRY_RUN_OF_DRAFT.txt`: the real tool **refuses the draft on the single remaining sentinel** (`UNRESOLVED:PRODUCTION-LADDER-PROFILE-NAME`, base contract line 501), and with that one value set aside in memory every other check passes against the real repository bytes and the real proposal files (diagnostic only; the stand-in is not a candidate value and is not written anywhere).

**Limits.** The gates run on a temporary successor state holding the planner's files; the two replaced contracts are validated (hash, JSON, sentinel, allow-list) but not exercised by a gate. No real-proposal planner run is possible: the ownership census (B5) does not exist and sentinels remain. The apply is a journaled, recoverable multi-file operation, not a filesystem transaction; the journal makes interruption detectable and recoverable. *Correction (2026-10-22, later):* the gates-on-planner-files-only limit is superseded — the complete proposed state is now judged by the rebuild's own validators (package C, `analysis/PROPOSED_STATE_VALIDATION.txt`); only database-dependent checks remain pending.

### Final decision table

| Item | State | What it needs |
|---|---|---|
| Continuity 52/31/42/25, `baseline_only` height block, c2 ladder witness/coverage, measured counts, register entry, corrections, availability (byte-unchanged), two manifests, 1,640 constant patch | Technically ready as proposed content (rehearsal-measured, applicability unproven) | Owner review (N10) |
| Journaled, recoverable transition mechanism (B2; not a filesystem transaction) and register comments (B3) | Technically ready, committed `5a09f3e5`, hardened and validated in `c7443fc2`, not adopted | Nothing further; adopted only with the owner decisions below |
| Runtime reproducibility (B8) | Partly closed | Missing: Python requirements with hashes / PyPI digests; run-time lock bytes; native-closure decision; a clean `npm ci` (all need separate authority) |
| New isolated verification | Populated-ledger round trip, wrong-marker refusals, candidate-2026 ownership refusal and pending-Brownlow projections DONE on isolated DEV targets (2026-10-22, package C `EXECUTION_RECORD.md` §3). STILL required before any production-adjacent run: | A real-proposal dry run needs B5 census targets and the owner values; the isolated loader measurement for the 479 unmapped provider ids and 10 coach-page mismatches (prerequisites §9) |
| Owner-only decisions | U1 date · U3/B1 production ladder profile mechanism (+B6 tests) · U5 D-316-1 grant · U7 `issue` attribution (keep 101, or allow a reviewed `/issue` patch) · U8 reason wording (A year-only is stale; B neutral AFL API ownership) · B4 provenance stance for coaches, Wikipedia pin and rosters · N12 census targets · native-closure policy | Alternatives and consequences: `analysis/OWNER_ALTERNATIVES.md` in the revised package |
| Derived, no owner choice | U4 `retired`; U2 verdict (earned by the executed gates); U6 omit `retired_on`/`superseded_by` unless the owner asks | — |

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

## Revision 2 — 2026-10-22 (previous execution record)

The single current record is package `C:/tmp/afldb-c2-SUCCESSOR-PROPOSAL-C-20261022T114149Z/` (`EXECUTION_RECORD.md`, `HASHES.sha256`); the original and revision-1 packages are unchanged and verified (54/54 and 24/24 hashes). The proposed content is unchanged; what changed is that it is now judged by the rebuild's own validators (as drafted REFUSED on the production profile; every other binding passes under a labelled diagnostic stand-in; 5/5 negative controls refuse), the populated-state proofs ran on isolated DEV targets, and a real career-total leak they found was repaired (`81117391`). **Remaining owner-only decisions, complete:** rollover date and D-316-1 grant; production ladder profile mechanism (A second tuple / B derive / C stay rehearsal-only) and successor/profile adoption; census target list (N12/N13); coach, Wikipedia and roster stance (479 unmapped provider ids, 10 coach-page differences, no raw coach HTML); exclusion wording (U8) and attribution (U7); native-library trust policy and reproducibility requirements (N15). ISSUE-316 OPEN; successor NOT ACCEPTED; production NO-GO.

## Revision 3 — 2026-10-23 (previous: final technical validation, no new proposal)

Evidence package `C:/tmp/afldb-c2-FINAL-TECHNICAL-VALIDATION-20261023-20261022T122727Z/` (`EXECUTION_RECORD.md`, `HASHES.sha256` 1b8774f04ab022f794d44acc1f35c5c81363a403dedb998f6a8c356d528fa4d7); package C and earlier packages are unchanged. At `96e0922a` the Brownlow regression is classified and closed except `v2-brownlow-production-correction` (needs the production pre-correction state; not demonstrated passing), the populated planted-vote proof passes on a clone of a fresh complete frozen-input rehearsal (30 stages, strict D7, 91 checks, post-rebuild pending-Brownlow and historical-projection checks, clean shutdown). The proposed content and the six owner decisions are unchanged; none was chosen on the owner's behalf. See the runbook's "Final technical validation" section. ISSUE-316 OPEN; successor NOT ACCEPTED; production NO-GO.

## Revision 4 — 2026-10-23 (previous: successor-ladder capability, source evidence, reproducibility, package D)

The single current record is package `C:/tmp/afldb-c2-SUCCESSOR-PROPOSAL-D-20261023T000000Z/` (`EXECUTION_RECORD.md`, `HASHES.sha256`, 26 entries); the original (54/54), revised (24/24) and C (42/42) packages are unchanged and re-verified. Owner decisions recorded 2026-10-23: rollover date and D-316-1 stay deferred; **mechanism A** (an explicit fingerprint-bound successor tuple, descriptive profile name `c2-2026-successor`, which grants no authority); the census scope 1897–2026 with no exclusions is a scope, not a target list; U8 uses the neutral AFL API ownership wording; U7 keeps `AFLDB-ISSUE-101`; content pins, authentic coach raw evidence and pinned Python dependencies are required before production source acceptance.

* **Capability (`52b97173`, INACTIVE).** `src/lib/rollover/ladder-successor.ts` plus resolver, planner and validator support. The repository table `SUCCESSOR_LADDER_TUPLES_JSON` is `'{}'`, so every successor profile refuses until an owner-reviewed one-line adoption. Predecessor and rehearsal-only profiles are unchanged. 63 new tests (wrong fingerprints, wrong count, stale predecessor, incomplete transition, crossed and unknown tuples, unchanged rehearsal restrictions, empty table).
* **Package D validation.** The genuine profile `c2-2026-successor`, read from the proposed `rebuild-test.ts` text with the proposed witness manifest bytes, is ACCEPTED by `validateProposedRebuildState` (1,640 rows, 91 checks built, database items PENDING); 10/10 negative controls refuse. There was no planner run: the rollover date, D-316-1 and the executed-gate result are still pending sentinels that the planner refuses.
* **Coach raw recovered.** 387/387 sha256 equal the tracked manifest, in two DEV locations; a verified copy is on C:. The earlier statement that raw coach HTML was absent everywhere is withdrawn. Raw Totals equal the parsed counts on 386/386 pages and 1,712 of 1,722 coach-seasons equal the persisted assignments. The 10 differences (eight 2026, two NM 1940: Adamson/Carter) stay unresolved.
* **Content pins (`73116273`).** Preflight refuses unless the Wikipedia height set, father–son selections, sibling relationships and after-siren events hash to their reviewed pins. A pin proves bytes, not authenticity or completeness. New `tools/rebuild/python-runtime.requirements.txt` pins four wheels by sha256 (PyPI-published digest = downloaded file = previously cached wheel).
* **Clean-install proof** (disposable DEV root; evidence `C:/tmp/afldb-c2-CLEAN-INSTALL-EVIDENCE-20261023/REPORT.md`). The DEV lock reproduces its hidden lock byte-for-byte. The repository lock needs the one repository-only devDependency from the registry. The recorded runtime (tsx/postgres/server-only 100/100) is reproduced only when esbuild's reviewed postinstall runs, and the guard refuses the ignore-scripts install. A hash-verified Python venv reproduces 605 of 608 non-`.pyc` files and all 17 native objects; the `RECORD` texts and 491 `.pyc` files are environment-bound. System native libraries stay observation, not enforced closure.
* **Census targets** (package D `analysis/CENSUS_TARGET_INVENTORY.md`): identities recorded in tracked records for `afldb_prod` (host `afldb-prod`) and for `afldb_dev` and `afldb_test` (host `streamanator`). Nothing was contacted and no census was run.
* **Effect on the rebuild.** `rebuild-test.ts` now imports `./ladder-successor` and carries `REVIEWED_INPUT_PINS`. A new isolated rehearsal package must include `tools/db/ladder-successor.ts` and `src/lib/rollover/ladder-successor.ts` (the package verifier's `required` closure already lists them). The earlier PASS (at `dedba57f`) is not re-claimed for the new source; a fresh isolated rehearsal is required before any production-adjacent claim. Database-free checks (typecheck; the `season-rollover`, `db-test-rebuild` and `v2-isolated-test-target` suites) pass.
* **Remaining owner-only decisions:** rollover date and D-316-1; adoption of the tuple and profile; census target confirmation and per-target approval; source coverage limitations and provenance stance; native-library trust policy.
* **Update 2026-10-23 (Revision 5):** the fresh isolated rehearsal this revision required has been run and passed at `a5ec6b0c`.

## Revision 5 — 2026-10-23 (previous: exact-implementation rehearsal at `a5ec6b0c`)

* **Update 2026-10-23 (Revision 6):** the owner has answered the approval form below; see Revision 6.

The single current record is package D's `C:/tmp/afldb-c2-SUCCESSOR-PROPOSAL-D-20261023T000000Z/EXECUTION_RECORD.md` §7; the full evidence is `C:/tmp/afldb-c2-FINAL-IMPL-VALIDATION-20261023/` (`EXECUTION_RECORD.md`, `HASHES.sha256`). Earlier packages are unchanged. No proposal layer was added; no decision was taken on the owner's behalf.

**Technical rehearsal validation is complete at `a5ec6b0cbd0977eea77cd655d28b54b108fdb0bc`** (rehearsal-only). The packaged code equals `73116273e818c031deaf84f46a514daaf634c14e`'s (the delta is documentation); the capability commit is `52b971730dc5e4408f9556c599aab7f41c333bd4`.

* **Package.** New labelled package, 1,142 files (inventory `83dc9f1c580a1388440fb2019d1021a50d2d3235c8918b36d3c092f67ec0af7c`, bindings `d026229251082b886d7f00bc57f548e449b6a7410531f8b93b5efbbec1361aec`). Against the `dedba57f` package the only differences are: `rebuild-test.ts`; the launcher (`6f11febd5e20e62485987c3df62a77b42c9988103e5c7a506e438d2948ce84f2`, now requiring the two `ladder-successor` modules); the two new `ladder-successor` modules; four planner/validator files; the Python requirements; the bindings; and the raw bundle with its binding. The five reviewed overlays and every acquired/recovered input are byte-identical to the previous package. The four newly pinned Wikipedia-derived inputs were verified three ways (packaged bytes against the pins parsed from the packaged `rebuild-test.ts`; the run's own preflight; the git blobs).
* **Runtime.** A clean-install environment (the completed install proof's repository-lock `npm ci` with the reviewed esbuild postinstall, plus the hash-pinned Python venv), measured into its OWN record `6c4ea3ea3fc2e6a12068c739750e64f6180c7016bd27869a652567bafec1add3`; the previous `91c5cdb6…` was not reused. tsx / postgres / server-only / pg-bin / stdlib are content-equal to the old record; site-packages differ only in `.pyc`, `RECORD` and two `REQUESTED` markers. Re-measured after the run: the same digest. System native libraries remain observation, not enforced closure.
* **Coach raw.** The 387 recovered pages equal the tracked manifest. They could not be package members (the package alphabet refuses the space in `Allan_La Fontaine.html`; no verifier was loosened), so they are bound as a hashed tar bundle plus a per-file binding, and the repository's real coach loader verified all 387 on a scratch copy of the package source (altered byte, missing page and absent-directory controls behaved as designed). **The rebuild stage itself still ran parsed-only** ("raw/ not present"). A hash match proves bytes, not publisher authenticity or completeness.
* **Run.** Fresh mode-700 root, dedicated unprivileged cluster (system id `7699599293956459996`), fresh `afldb_v2_rb_c2cand4_test` on 127.0.0.1:55751; verified production launcher, 2026-10-22T20:59:12Z–21:30:09Z, **exit 0**: preflight (including the content pins), enforcing census 1897–2026 (`schema_absent`, pass, total 0), capture-bound recheck, reset, reinstate and marker clearance, all 30 stages, strict real D7 (both WF fixtures; all 1,640 comparable rows), **`AFLDB-FINAL-VALIDATION PASSED: 91 checks`**, post-rebuild pending-2026 Brownlow and historical projection checks PASSED (exposed 2026 rows 0; historical 98 / 79,113 / 112). 0 error lines; no tripwire; peak root 2.30 GiB; shutdown verified (pidfile absent, `shut down`, port free, nothing references the root, system postgres untouched).
* **What this does not establish.** The census ran on a fresh isolated database: it proves mechanism and scope, not ownership of any populated deployment target (the separate populated-state proof stands). The successor tuple table is still `'{}'`; `c2-2026-successor` was exercised only as inert code, not activated or adopted; 1,640 stays rehearsal-only. Open and unchanged: 479 unmapped roster provider ids; rejected identity/height matches and 761 height disagreements; ten coach-season differences (eight 2026 finals-count differences; NM 1940 Adamson/Carter, match ids 3815, 3818, 3828, 3830, 3840, 3843, 3851, 3854, 3862, 3870, 3876); Wikipedia/roster provenance; Brownlow 2026 pending on all three keys; ET unresolved; `v2-brownlow-production-correction` not demonstrated passing.

### Owner approval form (the only decisions left; each blank stays deferred, and no row implies another)

| # | Decision | Owner entry |
|---|---|---|
| 1 | Rollover date and `D-316-1` (the AFL Tables retirement decision) | date: ____ ; D-316-1: grant / defer |
| 2 | Successor tuple `c2-2026-successor`: adopt as written in package D, amend, or decline | adopt / amend / decline |
| 3 | Exact populated census targets (T1 `afldb_prod`, T2 `afldb_dev`, T3 `afldb_test`; T4–T6 in or out) and a read-only census authority for each, near the protected window | targets: ____ ; authority: yes / no |
| 4 | Source coverage and provenance acceptance: accept the documented exclusions (479 unmapped ids, rejected matches and 761 height disagreements, ten coach-season differences, Wikipedia/roster provenance, parsed-only coach input) as stated, amend, or reject | accept / amend / reject |
| 5 | Native-library trust policy: observation only, or enforced closure; and whether a rebuilt runtime record per environment is acceptable | observation / enforce ; per-environment record: yes / no |

ISSUE-316 OPEN; successor NOT ACCEPTED; production NO-GO; 1,640 rehearsal-only; Brownlow 2026 pending on all three keys; ET unresolved.

## Revision 6 — 2026-10-23 (current: owner decisions recorded, censuses, package E)

* **Records.** The single current execution record is `C:/tmp/afldb-c2-SUCCESSOR-READINESS-E-20261023/EXECUTION_RECORD.md`. The dated proposal is package E, `C:/tmp/afldb-c2-SUCCESSOR-PROPOSAL-E-20261023T1045Z/` (`PROPOSAL_E.md`, `REHEARSAL_V3_PROPOSAL.md`, `HASHES.sha256` `2c598adfbae6f0570280666514b070767dd57cd3b73bf750302e320bdb13fe1c`).
* **Earlier packages.** Packages A–D are unchanged: C 42/42 and D 26/26 re-verified.
* **Basis.** `041bd5852f166be76c873fbc45d0c10208a3c3b2`.

### Owner decisions (recorded 2026-10-23; the Revision 5 form, answered)

| # | Decision | Owner entry |
|---|---|---|
| 1 | Rollover date and D-316-1 | **2026-10-24**; **D-316-1 granted for preparation of that transition** |
| 2 | Successor tuple `c2-2026-successor` | **Approved conditionally**: the required source-evidence work (AFLDB-ISSUE-319) and the enforced native-library work (AFLDB-ISSUE-320) must pass first. Do not activate prematurely |
| 3 | Census targets and authority | Completed seasons 1897–2026, no exclusions. Read-only on: 1 `afldb-prod`/`afldb_prod`; 2 `streamanator`/`afldb_dev`; 3 `streamanator`/`afldb_test` |
| 4 | Source coverage and provenance | **More evidence required before acceptance**; tracked as one issue, AFLDB-ISSUE-319 |
| 5 | Native-library trust | **Enforced closure required before proceeding**; implementation and proof tracked as one issue, AFLDB-ISSUE-320 |
| — | Brownlow 2026 | Publication unapproved; all three keys stay pending |
| — | ET | Applicability unresolved |
| — | Not authorised | Actual rollover apply, populated-database rebuild or reset, production migrations, deployment, push |

### Results
* **Censuses: PASS on all three targets.** Each ran read-only (identity verified, one read-only transaction) with the enforcing CLI: scope 1897..2026, total 0, ledger 110.
  * `afldb_prod`: 2026-10-22T21:57:39Z, evidence `f9cb8fa7…78a4`.
  * `afldb_dev`: 21:56:37Z, evidence `39b10324…c2e2`.
  * `afldb_test`: 21:56:38Z, evidence `33832676…0584`.
  * These are valid for those targets and times only, and freshness must be reassessed near the window.
* **Enforced native closure: implemented, not yet closed.** Commit `041bd585` (AFLDB-ISSUE-320); DEV proof 33/33, 10/10 and a PostgreSQL fixture. A complete v3 rehearsal is proposed and not run.
* **Source evidence (AFLDB-ISSUE-319).**
  * Resolved: coach raw→parsed (byte-identical replay); the eight 2026 coach differences (a new publisher capture now lists exactly the core-only finals); Wikipedia 84/84; roster bytes 15/15.
  * Blocked: NM 1940 R8–R18; 479 unmapped ids; rejections and height disagreements; roster completeness and raw; the parsed-only policy.
* **Transition (package E).** The tuple and fingerprints are unchanged from D. U8-B neutral ownership wording; U7 `AFLDB-ISSUE-101` attribution retained.
  * Change set E (`92879ad0d9b7fa0a87e5b5f583e06a57929136c1e7c33d300a08c356220b3ebc`) differs from D only by two empty prose lines, which the real planner refused in D.
  * E-pinned: `410b0787c9045df64531dda76a33f7da8f193a88291bbadcccf9cf9019a81991`.
  * **The genuine planner dry run passed (exit 0)**: three gates executed; three censuses accepted; proposed state accepted `c2-2026-successor` with 1,640 rows and 90 checks; nothing written. The pinned run exited 0, and a tampered pin is refused.

### Why the dry run is not labelled ready, and what remains
1. AFLDB-ISSUE-319 needs owner adjudication of its runbook §3 items 1–5, or named additional evidence.
2. AFLDB-ISSUE-320 needs authorisation of `REHEARSAL_V3_PROPOSAL.md` and per-environment records.
3. Near the window: fresh censuses, then the E-pinned dry run repeated on the applying Linux runtime, then a separate apply authorisation. The tuple is activated only by that apply.

ISSUE-316 OPEN; successor approved conditionally and NOT ACTIVATED; production NO-GO; Brownlow 2026 pending on all three keys; ET unresolved.
