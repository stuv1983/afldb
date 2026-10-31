# Remaining owner decisions and gates (2026-10-31)

Prepared after V2-GAP-004 closed, and **updated the same day after the owner's decisions on gaps 005, 010 and 006**
(register recounted from the rows of [known-gaps.md](known-gaps.md)). Recommendations are the preparer's and are not
evidence. Nothing in section 3 is executed.

## 1. Decided (2026-10-31)

| Decision | Outcome |
|---|---|
| **D-V2-GAP005, Option A** | AFLW stays outside the V2 AFL/VFL historical manifest. Accepted scope boundary; **gap 005 CLOSED**. `MANIFEST_SPEC_VERSION` stays 1; AFLW data, functionality and backup coverage are untouched |
| **D-V2-GAP010, Option A** | No verified AFL API match, statistics or Brownlow coverage is claimed for 2012-2025. Accepted constraint; **gap 010 CLOSED**. Baseline data, roster evidence (2012-2026) and the legitimate 2026 claims are preserved; no provider fetch is authorised |
| **D-V2-GAP006, Option B** (approved for local implementation) | Extend the application-level seal to the appropriate admin mutation paths; database triggers stay deferred. **Traced in section 2: a policy conflict prevents implementing it without a further decision. Gap 006 stays OPEN; nothing implemented** |

## 2. D-V2-GAP006-EDITORS — the exact decision the trace produced

> **DECIDED 2026-10-31: E1 approved for local implementation, and implemented locally the same day (not deployed).**
> See `known-gaps.md` V2-GAP-006 for what is covered and what remains. The workflow mapping the owner chose is `data_editor`
> for the audited manual editors, with `brownlow_authority` and `identity_adjudication` retained where they already apply,
> and no new workflow id. One detail of the package below changed with the owner's decision: the evidence reference is the
> same-transaction `data_edits` row, so the audit row is inserted first and the guard runs on it inside the same
> transaction (a refusal still rolls back the canonical write, the audit row and every sibling write).

### 2.1 What the trace found

The seal contract is `evaluateSeasonWrite` (`packages/domain/src/season-seal.ts`). A write to a sealed season is refused
unless it carries an **audited correction**: a workflow id from a **closed list of eight**, the acting user, a **note of
20-2000 characters** (owner decision OD-4) and a **non-empty evidence reference**. An unknown or undated season is
treated as sealed. The sealed range is read from `data/reference/seasons.json` (1897-2026 today, 2027 open) through
`src/lib/seasons/sealed-seasons.ts`, which fails closed.

Already covered: the three AFL API settle CLIs, the Coleman publisher (`derived_award_publication`), curated award
approval (`curated_award_approval`) and Brownlow eligibility decisions (`brownlow_eligibility_decision`).

**Not covered** are the audited admin editors. They are retained by disposition L13 (`legacy-disposition.md`) as "the
audited correction workflows", and they write sealed-season rows now, each with an append-only `data_edits` audit row in
the same transaction:

| Editor (query module) | Mutating exports (approx.) | Sealed rows written | Closed-list workflow id today |
|---|---|---|---|
| Data editor (`data-edits.ts` `saveEdit`; entities `players`, `matches`) | 1 | `matches` (season); `players` is a season-less reference table | `data_editor` |
| Match admin (`match-admin.ts` create / delete; match-sheet actions) | 2 + sheet saves | `matches`, `player_match_stats`, `match_period_scores` | `data_editor` (nearest) |
| Awards editor (`admin-awards.ts`, `awards-admin.ts`) | about 16 | `award_winners` and the reference tables `awards`, `hall_of_fame`, `honour_team_members` | none (curated approval is the proposal route only) |
| Coaches (`admin-coaches.ts`) | 6 | `match_coaches` and reference `coaches` | none |
| Draft (`admin-draft.ts`) | about 6 | `draft_picks` (and `external_identities`, a reference table) | none |
| Club leadership (`admin-club-leadership.ts`) | 3 | `club_leadership` | none |
| Season lists (`admin-season-lists.ts`) | 3 | `season_list_members` | none |
| Special records (`admin-special-records.ts`) | about 6 | `player_achievements`, `after_siren_kicks` | none |
| Fixtures (`admin-fixtures.ts`) | 4 | the schedule, which is not a sealed table | none needed |
| Brownlow vote entry (`admin-brownlow.ts`) | 3 | `brownlow_round_votes`, `brownlow_season_votes`, authority and entry state, `player_match_stats` | `brownlow_authority` (its derived republish already carries a 20+ character note) |
| Player links and AFL API links (`player-links.ts`, `afl-api-player-links.ts`) | about 10 | identity links, season-less | `identity_adjudication` |

(Counts are from exported function names and tables from the `INSERT`/`UPDATE`/`DELETE` statements in each module; both are approximate, and the implementation would enumerate them exactly.)

**None of these collects what a correction requires.** The data editor's note is optional (up to 2000, no minimum); the
awards editor has no note rule in its validation; the other editors have no evidence reference at all. So applying the
contract as written would **refuse every edit to sealed history until each editor gained a 20-character note and an
evidence reference**. Seven editors also have no workflow id in the closed list. Which of those is the intended
correction policy is an owner decision, not something to infer or bypass.

### 2.2 Options

| Option | Effect | Cost and risk |
|---|---|---|
| **E1. Require the correction record for sealed seasons only** (preparer's recommendation) | Sealed-season edits need a 20-2000 character note; open seasons are unchanged. The evidence reference is the same-transaction `data_edits` row (a pointer to the ledger row, as the contract allows). Editors map to `data_editor` (L13 already treats them as one family) or each gets a new id | Changes the daily workflow for sealed edits (a mandatory note). Needs a note field in editors that lack one (a UI change under the Visual Evidence Mandate), updated integration tests on a guarded `_test` database, and a decision on mapping versus new ids (a new id changes the closed list and its test) |
| E2. Accept the editors as the audited correction workflows they are | No code change; the audit row plus the manifest comparison stay the control. Gap 006 is then closed for editors as accepted, with the database layer still open | Sealed history stays editable without a note |
| E3. Apply the seal to a subset only (data editor and match admin) | Covers the highest-volume editors first | Leaves the rest unprotected; same note and UI cost for those two |

### 2.3 Smallest execution package if E1 is chosen

1. One guard in `src/lib/seasons/` that loads the sealed range (fail closed with the typed `season_registry_unavailable`
   code the operations centre already uses), builds the correction and calls `evaluateSeasonWrite`.
2. Call it inside each editor's existing transaction, before the canonical write and before the `data_edits` insert, so
   a refusal rolls everything back. Permissions (`data.dataEditor` and the other capabilities) are not touched.
3. Tests: extend `tests/v2-season-seal.test.ts` and the closest integration test per editor
   (`tests/integration/data-editor.test.ts`, `match-admin-create.test.ts`), run on a guarded disposable `_test` database
   only.
4. Docs: `historical-baseline.md` §2 states the rule; gap 006 stays open for the database layer and the legacy writers.

Reply with E1 (and the mapping choice), E2 or E3.

## 3. Gates that are not decisions in this batch

| Item | What it waits for | Notes |
|---|---|---|
| V2-GAP-008 / ISSUE-229 | An authentic 2027-season B2 capture | No 2027 season exists yet; blocks nothing unrelated |
| V2-GAP-011 / ISSUE-316 | The remaining ISSUE-316 cutover sequence: the owner's C2, the C4b PASS and C5 | **One step is already done:** the production AFL Tables timer is disabled and inactive (A-AFLT executed 2026-10-31, D-V2-PROD-EXEC-1; the polkit rule was recorded absent; `legacy-writers` passed at Stages 3 and 13). That retirement is **not** the full cutover. Frozen P/H/EXEC, authorities and recovery bindings are untouched |
| V2-GAP-016, 030, 031 | Separate exact approval of each production **Brownlow operation**: the `match_id` backfill, legacy-ownership adoption, exact recording and reconciliation acceptance | **Migrations 116 and 117 are already installed on production** (A-REL applied 111-117 on 2026-10-31, ledger 117, read-back 12/12; [record](production-execution-record-2026-10-31.md)). Installation is not the gate. Installed schema does not authorise recording, backfill, adoption or acceptance. [Approval package](brownlow-production-approval-package-2026-10-20.md) |
| V2-GAP-029 | Source evidence for the Gridley findings | Findings unchanged and not waived; [source requests](gap-029-source-requests.md) |
| ISSUE-321 | Deferred; no specifically authorised task identified | |
| ISSUE-327 | Parked (legacy) | |
| Retention cleanup | The recorded review date | Releases, backups, evidence and `.codex/` preserved |
