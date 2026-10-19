<!-- DOC | Plan review of Launch F stream F-D awards plan -->
<!-- DOC DISCIPLINE | Soft ceiling: 500 lines. One topic per file; structure under ## headings.
     The DOC line above feeds `phaneslight doc-index`, keep it accurate; it is this file's line in _index.md.
     If this file exceeds the ceiling: split it into a same-named folder of focused topic files;
     carry both header lines into every part; update every inbound reference in the same change set;
     finish by running `phaneslight doc-index`.
     Consumers: NEVER bulk-read documentation folders, read _index.md first, load only what you need.
     Audit: `phaneslight doc-check`. -->

# Plan review — Launch F stream F-D (`launchF-FD-awards-plan.md`)

Reviewer: `afldb-reviewer`, 2026-10-19. Duty A (plan review at launch, CLAUDE.md §15).
Worktree read: `D:\dev\afldbV2-wt\awards` (branch `v2/launchF-awards`). Every claim below was checked
against the file on disk, not against the plan's description of it. No code was edited; this file is
the only artifact written.

## Ground-truth verification (what the repository confirms)

Plan §0 is accurate on every point checked:

- `publishColemanResult` (`packages/derived/src/coleman-publication.ts:248-299`) gates before SQL,
  takes a per-season `pg_advisory_xact_lock`, returns early on `unchanged` without a write, and takes
  no projection today. Its header (lines 26-29) explicitly reserves the `award_winners` projection
  for a later step that passes the seal and supplies `player_name_raw`.
- The loader's Coleman key, column format and ownership scope are exactly as the plan states
  (`tools/migration/import_awards.py:1701-1757`): key `(source_id, source_record_id)`, scope
  `award_id = coleman AND source_id = afltables`, `replay_admin_overrides` immediately after.
- `reload_keyed` (`tools/migration/common.py:686-717`): UPDATE matched keys in scope (status column
  is NOT in the column list, so a voided row keeps `void`), INSERT only where no in-scope key
  matches (status-blind, so a void row with the key suppresses the insert: no `award_winners_source_uq`
  violation), DELETE every in-scope row whose key the loader no longer derives (hard delete,
  status-blind). The Coleman call passes no `lifecycle_column`.
- `approveProposal` (`packages/admin/src/curated-awards.ts:544-641`) runs on the service's own
  `executor.transaction`, re-validates, evaluates the seal with `curated_award_approval`, promotes
  through `deps.promotion.promote(tx, ...)`, and `ProposalRecord.createdBy` is available (line 80,
  167) for the four-eyes check. `reviseProposal` refuses `approved` at line 713-719.
- `awardWinnerPromotionPort` (`src/db/queries/award-proposals.ts:57-99`) bridges to the native
  postgres.js tx via `nativeTransactionOf(tx)` and refuses otherwise; it returns `{ entityKey }` only.
- `insertAwardWinner` (`src/db/queries/admin-awards.ts:1416-1594`) refuses `brownlow-medal`, takes
  `player_name_raw` from `players.display_name` when a player id is given, does NOT refuse an
  identity-less player (1454-1458), always writes a `data_overrides` row (1569) and a `data_edits`
  row, and calls the module-private `recomputeAwardSpan` (864). `awardWinnerPaths` (893) is also
  module-private. `runHonourEdit` (970) opens its own `withImportConnection` + `importSql.begin`, so
  the plan's "tx-level variants extracted from replace/correct" is a real refactor, not a call.
- `AUDITED_CORRECTION_WORKFLOWS` (`packages/domain/src/season-seal.ts:23-34`) is "one stable id per
  row of historical-baseline §2"; `tests/v2-season-seal.test.ts:121-124` pins the list verbatim.
- Capabilities (`src/lib/auth/capabilities.ts:88,137`): `data.brownlow.finalise` and
  `data.awards.edit` are both `SUPER_ADMIN_ONLY`.
- Migrations 092-098 are the DROP/ADD CHECK precedent (094:301-302 among them); migration 112's own
  comment (134-135) anticipates "a new migration that replaces this CHECK, never an edit of this
  file"; ADR 0004 forbids row rewrites, id/FK changes and destructive resets, none of which a superset
  CHECK replacement does.
- PGlite harnesses: `tests/v2-curated-awards-pglite.test.ts:43` applies 111 only;
  `tests/v2-coleman-publication-pglite.test.ts:38` applies 112 only; `tests/v2-admin-operations.test.ts:227-228`
  applies 111 and 112.
- The reconciliation's `eligibilityRule` is a viewer-chosen query parameter
  (`src/app/admin/operations/page-data.ts:285` -> `operations-centre.ts:772` ->
  `brownlow-reconciliation.ts:383-385`, default `unrecorded`), documented at
  `brownlow-reconciliation-report.ts:30` as "the convention measured on the stored AFL Tables
  artefact". `brownlow_season_votes.is_ineligible` is `NOT NULL DEFAULT false` (plan §0, mig 005).

## Findings

### F-001 — HIGH — Stored `is_ineligible = false` is read as affirmative "eligible"; it is a default

Evidence: plan §1.1 rule (2): "`is_ineligible = true` => ineligible, `false` => eligible".
`brownlow_season_votes.is_ineligible` is `NOT NULL DEFAULT false` (plan §0). The repository's own
reconciliation does not treat the stored flags as recorded evidence: it only honours them when the
viewer opts in with `eligibilityRule = 'stored_eligible_rank_one'`
(`packages/derived/src/brownlow-reconciliation.ts:383-385, 762-768`), and otherwise refuses an
award with `refused_eligibility_rule_unrecorded` whenever an ineligible vote-getter exists
(762-764). The rule is a query parameter (`page-data.ts:285`), not a stored fact.

Failure scenario: a source-published season whose loader never carried eligibility writes `false`
for every row by default. The vote leader was in fact ineligible (the suspended-leader cases).
Under §1.1 the leader's evidence is `eligible`, the walk at §1.2 returns `determined` with that
leader, and the page shows a winner the owner's rule says must be `requires_review` ("if the vote
leader's eligibility is missing or ambiguous, do not invent a winner"). This is the NULL-versus-zero
coercion in a boolean: a default is "not recorded", not "eligible". The `is_winner` disagreement
display in §1.4 is a mitigation, not the rule.

Amendment to §1.1 (binding within the owner's words): evidence (2) is authoritative only where the
stored row carries a RECORDED statement:
- `is_ineligible = true` => `ineligible` (the only case the owner allows exclusion on);
- `is_ineligible = false` => `eligible` only when the season is admin-published
  (`brownlow_season_authority.published_revision IS NOT NULL`: `publishBrownlowSeason`
  asserts the explicit `ineligiblePlayerIds` set, `admin-brownlow.ts:1355-1378`) OR the row carries a
  recorded eligible-ordering rank (`eligible_rank IS NOT NULL`; the reconciliation at line 679 reads
  a NULL `eligible_rank` as a statement of ineligibility, so a non-NULL one is a recorded rank);
- otherwise `missing`.
Also state in §1.2 that the determination reads RAW evidence (decisions, stored rows, staged flags)
and never `report.totals[].eligible`, which already folds provider flags and stored flags into one
boolean (`brownlow-reconciliation.ts:609-667, 730-740`) and would hide the provenance the walk needs.

Acceptance check (user-executed, before stream A designs the service): one SQL count proving which
source-published seasons would become `missing` under the amended rule, so the owner sees the blast
radius rather than discovering it on the page:
`SELECT season, count(*) FILTER (WHERE eligible_rank IS NULL AND NOT is_ineligible) AS unranked, count(*) AS rows FROM brownlow_season_votes GROUP BY season HAVING count(*) FILTER (WHERE eligible_rank IS NULL AND NOT is_ineligible) > 0 ORDER BY season LIMIT 50;`
Plus a unit test in the new `brownlow-eligibility` suite: a leader with a default-false stored row
on a source-published season => `requires_review`, naming the player; with `is_ineligible = true`
=> excluded; with an admin decision `eligible` => `determined`.

Per §15, a HIGH at plan review goes to the user: stream A must not start until the owner confirms
the amended rule (it is a one-paragraph change to §1.1, not a redesign).

### F-002 — MED — "retained" equality ignores the loader's value columns (stale goals note)

Evidence: plan §2.2 compares an active row on `(player_id, player_name_raw, club_id)` only. The
loader's row carries `note = "Derived from AFLDB home-and-away match statistics: N goals
(coleman-derivation.json method_version M)"`, `club_name_raw NULL`, `votes NULL`, `link_status
'resolved'`, `candidate_count 0` (`import_awards.py:1718-1737`).

Failure scenario: a sealed season's goal fact is corrected through the data editor (same winner,
101 goals instead of 100). The derivation supersedes the ledger row (new checksum); the projection
finds the three identity fields equal, reports `retained`, and the public note keeps "100 goals".
The next loader run then silently rewrites the note (reload_keyed UPDATE), so the projection's
audit trail and the canonical row disagree until an unrelated import happens to run.

Amendment: define `retained` as equality on the FULL loader column tuple (`player_id`,
`player_name_raw`, `link_status_value`, `candidate_count`, `club_id`, `club_name_raw`, `votes`,
`position`, `is_captain`, `is_vice_captain`, `note`); anything else is `updated`. Acceptance: a
PG test where only the goals total differs => outcome `updated`, one `data_edits` row, note rewritten.

### F-003 — MED — Loader/projection parity is asserted, never proven (the only thing stopping a fight)

Evidence: the plan's safety argument for skipping `data_overrides` on derived rows is that the
Python loader derives the same rows (§2.2 "in the loader's exact column format"). Verified
`reload_keyed` semantics (`common.py:686-717`): any disagreement between `deriveColeman` and
`derive_coleman_winners` is applied by the loader's UPDATE/DELETE with no refusal, and the next
projection flips it back, each cycle adding `data_edits` and `derived_award_projections` rows. No
test executes both derivations over the same facts. The note literal, the multi-club NULL rule
(`ColemanWinner.clubId` null when `clubCount > 1`, `coleman.ts:240-242`; Python `club_count > 1`,
`import_awards.py:1774-1780`) and `display_name` are the three places they can drift.

Skipping `data_overrides` is otherwise SAFE as planned: the override refusals (`admin_override_present`,
`derived_row_voided`, `foreign_winner_rows`) are exactly the cases where `replay_admin_overrides`
would otherwise fight the projection, and a derived row with no override is re-derived identically
by both writers. The dependency is parity.

Amendment (acceptance checks, both required):
1. Unit test pinning the projection's note string against the literal in `import_awards.py:1718-1722`
   (read the Python file in the test and extract the f-string template, or pin both to one constant
   recorded in `data/reference/coleman-derivation.json`).
2. User-executed, on the stream B1 isolated database after one projection has inserted rows:
   the loader's coleman group (`python tools/migration/import_awards.py` with its coleman selector
   against `afldb_v2_aw_b1_test`), expecting `report_reload` to print `0 updated, 0 inserted,
   0 deleted` for coleman. Then `compareColemanSeason` for the same season shows no difference.
   Record both outputs in the stream's session summary.

### F-004 — MED — Three parallel workers, one migration file and several single-literal shared edits

Evidence: plan §4 splits migration 114 into "section 1" (B1) and "section 2" (B2) and lists shared
files edited "in disjoint regions only". Several of those edits are one literal:
`tests/integration/privileges.test.ts:807-808` (one `NOT IN (...)` list), the `privileges.sql`
afldb_auth spec rows, `tests/v2-season-seal.test.ts:121-124` (one array), `tests/reference-data.test.ts:444-476`
(one list), the count pins at `tests/db-promotion-check.test.ts:7110-7112`. The migration runner
hashes the whole 114 file; two workers writing it concurrently in one worktree produce a merge the
orchestrator cannot attribute.

Failure scenario: B1 commits 114 with section 1; B2's in-flight edit of the same file is based on
the pre-commit text and overwrites section 1, or appends a second `CREATE TABLE` header block; the
runner applies a 114 that is missing a table, the projection port fails closed on the isolated DB,
and the failure is reported as "grants not applied".

Amendment: one owner per file. B2 owns migration 114 whole and receives B1's `derived_award_projections`
DDL as a text block in B1's return (or: 113 = Brownlow decisions, 114 = projections + widening with
B1 owning 114 and B2 handing over its section; either way ONE writer). Shared single-literal files
(`privileges.sql`, `privileges.test.ts`, `v2-season-seal.test.ts`, `reference-data.test.ts`,
`db-promotion-check.test.ts`, `promotion-inventory.ts`, `packages/derived/src/index.ts`,
`admin-awards.ts` export lines) are edited by the orchestrator serially after the streams return,
from each stream's stated list of required additions. `operations-centre.ts` may stay region-split
only if each stream appends a new section at the end of the file under a stream-named banner.

### F-005 — MED — Work the plan implies but never states

Each item below is required for the stated tests to be meaningful or for the deploy order to hold:

1. `tools/db/promotion-inventory.ts` entry for migration 114's `derived_award_projections`
   (plan §1.3 names 113 only); `tests/db-promotion-check.test.ts:7110-7112` count pins (+2 tables);
   `tests/reference-data.test.ts:444-476` list (+2 tables).
2. The PGlite harnesses must apply the NEW migrations: `tests/v2-curated-awards-pglite.test.ts:43`
   applies 111 only, so the "triple test updated in step" (§3.2) would run against the UNWIDENED
   CHECK and pass against stale constraints while the TS machine has grown: a false green. It must
   apply 111 then 114. `v2-coleman-publication-pglite.test.ts` must apply 112 then 114 (the
   projections FK targets 112); `v2-admin-operations.test.ts` 111, 112, 113, 114.
3. Migration 114's `-- ROLLBACK:` block must restore the three migration-111 constraint texts
   verbatim (ADR 0004 reversal requirement), and 113's must list the privileges/test/inventory
   removals as 111/112 do.
4. Exports from `admin-awards.ts` the projection port and V2-GAP-024 need: `awardWinnerPaths`
   (893), `recomputeAwardSpan` (864), and a tx-level row read (`readAwardWinnerInTx`, 1630) so the
   promotion port can compute paths (it returns only `entityKey` today, `award-proposals.ts:92`).
   `recordDataEdit` is already shared.
5. `src/app/admin/awards/revalidate-paths.ts` allowlist: confirm it admits every path
   `awardWinnerPaths` can return for a Coleman row (award, award-season, season, player, club,
   sitemap); add a unit assertion if the allowlist is pattern-based.
6. `docs/v2/historical-baseline.md` §2: a new row for `brownlow_eligibility_decisions` (and the
   `derived_award_projections` audit trail in row 44), whichever workflow id F-006 settles on.
7. `CHANGELOG.md` `Unreleased` entries for: Brownlow eligibility decisions, Coleman projection into
   `award_winners`, four-eyes, approved-proposal revision, approval revalidation (V2-GAP-024).
8. ADR 0008's "Not enforced: a four-eyes rule" paragraph (mirrored in migration 111's header lines
   66-68 and `curated-awards-model.ts:136`) is now false; update the ADR and the model comment
   (the migration file is applied-history and is never edited).

### F-006 — MED — Reusing `brownlow_authority` for the eligibility ledger breaks the one-id-per-ledger rule

Evidence: `season-seal.ts:19-21` defines the list as "one stable id per row of the table in
historical-baseline §2"; row 42 ties `brownlow_authority` to `brownlow_season_authority` /
`brownlow_vote_entry_state`, "audited in `data_edits`". Stage 4 added a NEW id for each new ledger
(112 -> `derived_award_publication`, 111 -> `curated_award_approval`), and migration 112's CHECK
pins its workflow string in the table (112:165-173). The plan's 113 would pin `brownlow_authority`
into `brownlow_eligibility_decisions.correction` permanently; a later renaming is a new migration.

Not a data-integrity failure, but an audit-fidelity defect that is cheap now and a migration later.

Amendment: add `brownlow_eligibility_decision` to `AUDITED_CORRECTION_WORKFLOWS` (append, the
pattern of line 33), add the §2 row, update the pin at `tests/v2-season-seal.test.ts:121-124`, and
have migration 113's `correction` CHECK pin that id. `evidenceRef` as planned
(`brownlow_eligibility:<season>:<identity>`).

### F-007 — LOW — The super_admin self-approval clause is vacuous today; check the role explicitly

Evidence: `data.awards.edit` is `SUPER_ADMIN_ONLY` (`capabilities.ts:137`), so every approver is
already a super_admin and "creator may NOT approve except a super_admin with attestation" reduces
to "creator may approve with attestation". That is the owner's rule and is acceptable, but the
implementation must test `viewer.role === 'super_admin'` explicitly rather than inferring it from
the capability, so a future widening of `data.awards.edit` cannot silently widen self-approval.
Define "creator" as `created_by` of the revision being approved (a reviser is the creator of their
revision; `insertProposalWithLedger` records the reviser) and say so in ADR 0008.

### F-008 — LOW — §3.2 details that will not work as written

1. `revise_approved` creates a row directly in `approved`; `insertProposalWithLedger` writes
   `proposed`. A variant that writes `approved` + `approved_entity_key` + `approved_at` in one
   INSERT is needed, or `award_proposals_approval_ck` fails on the row.
2. The widened `award_proposals_approval_ck` must still require the key for `approved` and allow
   it only for `approved | superseded` (never for `proposed`, `validated`, `validation_failed`,
   `rejected`).
3. The replace path (`replaceAwardWinner`, identity change) is a CAS on the award_winners row's
   `updatedAt` (`runHonourEdit:990-993`); the revise input must carry `expectedUpdatedAt` of the
   canonical row, or the extracted tx-level variant must lock and compare by the proposal's
   `approved_entity_key` instead. State which.
4. The TS state machine gains two actions, so `PROPOSAL_ACTIONS` grows and the triple test's
   expected count (`PROPOSAL_ACTIONS.length * 7 * PROPOSAL_STATUSES.length`, test:324) self-adjusts
   only if the test applies 114 (F-005.2).

### F-009 — INFO — DROP/ADD CHECK (superset) under ADR 0004 is compliant

No row rewrite, no id or FK change, no destructive reset; migration 112:134-135 itself names "a new
migration that replaces this CHECK" as the way to widen. The reversal (F-005.3) is what makes it
ADR-compliant; without the ROLLBACK text it is not.

### F-010 — INFO — Authorisation and V2-GAP-020 confirmed

Capability checks are server-side inside `runMutation` (`operations-centre.ts:669, 761`) and
`assertCanEditAwards` (`curated-awards.ts:551`); page gating is not relied on. `data.brownlow.finalise`
for decisions and `data.awards.edit` for the projection are the right existing capabilities.
V2-GAP-020: the identity-less refusal lives ONLY in `validateAwardProposal`
(`curated-awards-model.ts:412-414`); `insertAwardWinner` accepts an identity-less player (1454-1458).
`approveProposal` re-validates inside the transaction (563-571), so the planned PG test must drive
APPROVAL (not validation) of a proposal whose `player_identity` is NULL and assert
`stale_validation`, proving the re-validation is what holds the line.

### F-011 — LOW — The owner's required tests should be named, not summarised

Plan §4 says "proving every owner property". Name them so a step cannot be reported complete on a
feeling. Minimum list, each one test case:
- Coleman: projection run twice on the same facts => `award_winners` row count and
  `derived_award_projections` row count unchanged, second run `retained` for every key; joint winners
  => two rows, both `inserted`; a `manual_admin_edit` Coleman row for the season => `foreign_winner_rows`
  refusal and ZERO writes (transaction rolled back, ledger row absent); sealed season with equal rows
  => provenance row only, `award_winners` unchanged; `admin_override_present` and `derived_row_voided`
  refusals; the operations centre always passes the port (unit); revalidation paths posted after
  success (unit on the form helper).
- Brownlow: leader `missing` => `requires_review` (F-001); leader `ambiguous` (API flag disagrees)
  => `requires_review`; known-ineligible leader dropped, next group `determined`; tie among eligible
  leaders => both, `tie: true`; unknown player, identity-less player, no-vote player, missing
  citation, short note, stale `expectedCurrentDecisionId` each refused with no row; sealed season
  without correction refused; raw totals in the output byte-equal to the input.
- Curated: creator approves => `self_approval_forbidden`; super_admin creator with 20+ char
  attestation => approved and ledger `new_values.selfApproval = true`; 19-char attestation refused;
  `reviseApprovedProposal` writes both ledger rows and the canonical change in ONE transaction (fail
  the canonical step, assert no ledger row); V2-GAP-020 approval-path refusal (F-010).

## Sequencing

- Migration -> `npm run db:privileges` -> code is recorded (plan §4) and matches 111/112's deploy
  comments. The isolated template is at 112; each stream applies 113/114 to its own `_test`
  database before its integration suite. Nothing here depends on an applied migration being edited.
- Stream A depends on the owner's answer to F-001 before its service and UI are designed; its
  migration 113 can be drafted meanwhile (the table shape is unaffected by the rule).
- F-004's serialisation means B1 and B2 cannot both "own" 114; decide that before dispatch.

## Verdict

**PROCEED_WITH_AMENDMENTS**, with one HIGH (F-001) that under CLAUDE.md §15 goes to the user before
stream A executes: the amendment is a one-paragraph change to §1.1 plus the one SQL count, not a
redesign. Streams B1 and B2 may start once F-002, F-003 (test 1 now, test 2 at stream close),
F-004 and F-005 are written into the plan; F-006 is decided with the user alongside F-001 since
both touch the same migration (113).

Files written by this review: this file only
(`D:\dev\afldbV2-wt\awards\documentation\plans\implementation\launchF-FD-awards-plan-review.md`).
The plan file was not amended; the amendments above are to be applied by the orchestrator.

REVIEW-COMPLETE
