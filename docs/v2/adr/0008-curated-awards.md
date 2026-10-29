# ADR 0008 — Curated awards through an audited proposal workflow

- Status: Accepted (2026-10-19); implemented in Stage 4 as services, migration 111 and tests — no UI,
  no server action, nothing applied to any real database
- Plan decision: `docs/v2/plan.md` §3 D8; review resolutions R-008 and R-017 (§7)
- Launch F (stream F-D) amendments, in the sections marked **Launch F** below: four-eyes approval
  (V2-GAP-019), audited revision of an approved proposal (V2-GAP-018), public-page revalidation after
  approval or revision (V2-GAP-024) and the identity-first workflow (V2-GAP-020). Migration 114 section 2
  is the only schema change.

## Context

Club awards, league awards and historical honours that cannot be derived are today loaded by
offline importers (`tools/migration/import_awards.py` and its Wikipedia-derived parsers) and
edited through admin editors. The owner forbids direct Wikipedia-to-production automation.

## Decision

Proposal, validation, review, transactional approval or rejection, and revisions, all audited,
implemented as `@afldb/admin` services with capability checks. Manual entry in the admin data
editor uses the same pathway. Wikipedia input is a locally supplied file prepared offline into
proposals; it is never auto-approved and never fetched by runtime code.

## Implementation (Stage 4)

| Piece | Where |
|---|---|
| Migration (additive, forward-only, `-- ROLLBACK:` comment block) | `src/db/migrations/111_curated_award_proposals.sql` |
| Pure model: state machine, normalisation, validation, notes, capability gate | `packages/admin/src/curated-awards-model.ts` |
| Services over the SQL port | `packages/admin/src/curated-awards.ts` |
| Pure offline-file parser (JSON, CSV) | `packages/admin/src/curated-awards-file.ts` |
| SQL port + postgres.js adapter | `packages/db/src/sql-executor.ts` |
| Production promotion port (server-only) | `src/db/queries/award-proposals.ts` |
| In-memory PGlite helper + executor | `packages/testing/src/pglite.ts` |
| Grants mirrored for the reconciler | `tools/maintenance/privileges.sql` |
| Promotion classification | `tools/db/promotion-inventory.ts` |
| Tests | `tests/v2-curated-awards.test.ts`, `tests/v2-curated-awards-pglite.test.ts` |

The only change to existing application code is `export` on `insertAwardWinner` in
`src/db/queries/admin-awards.ts` (behaviour unchanged).

### Tables

- `award_proposals` — one row per **revision** of one proposed award winner. Value columns mirror
  `award_winners` (votes `numeric(8,2)` with NULL meaning "not recorded", never 0). Evidence:
  `source_kind` (`manual_entry`, `offline_file`, `wikipedia_offline_file`), `source_url`,
  `citation`, `acquired_on`; a CHECK requires a URL or a citation, and a Wikipedia kind must name a
  `wikipedia.org` https page. `proposal_key` is shared by all revisions; a unique index allows at
  most one live revision per key and each revision has at most one successor.
- `award_proposal_decisions` — the append-only ledger. One row per status transition, written in the
  same transaction as the transition. Its `transition_ck` CHECK mirrors the state machine below.

**Natural identity, not ids (an adaptation of the suggested shape).** A proposal names its award by
`awards.slug`, its player by the durable identity string `resolvePlayerIdentity()` already computes
(`afltables:<profile path>` or `manual_admin_edit:<token>`) and its club by `clubs.slug`. There is no
foreign key into `awards`, `players`, `clubs` or `award_winners`. Reasons: those tables are rebuilt by
`TRUNCATE … CASCADE` and renumbered by a promotion, so an FK would let a rebuild silently empty the
ledger and would make the tables lineage-bound state needing the staged remap of AFLDB-ISSUE-151/155;
`admin-awards.ts` already states the rule (invariant 3: the durable record is named by natural
identity, never by `id`). The cost is that integrity against those tables is checked by validation,
inside the approval transaction, instead of by the database. The approved winner is recorded as
`approved_entity_key` (the `data_overrides` key `insertAwardWinner` returns), never an id. The only
foreign keys are intra-family (ledger → proposal, revision → predecessor) and `auth_users`.

### State machine

`CURATED_AWARD_TRANSITIONS` (`curated-awards-model.ts`) is the single definition; `assertTransition`
refuses anything else with the typed code `illegal_transition`. The ledger CHECK repeats it, and
`tests/v2-curated-awards-pglite.test.ts` tries all 252 `(action, from, to)` triples against the real
table and requires the accepted set to equal the TypeScript set.

| Action | From | To | Ledger rows |
|---|---|---|---|
| `create` | (none) | `proposed` | 1 on the new row |
| `validate` | `proposed`, `validated`, `validation_failed` | `validated` or `validation_failed` | 1 |
| `approve` | `validated` | `approved` | 1 (plus the canonical audit, below) |
| `reject` | `proposed`, `validated`, `validation_failed` | `rejected` | 1, reason mandatory (≥ 10 chars) |
| `supersede` | `proposed`, `validated`, `validation_failed` | `superseded` | 1 on the old revision |
| `revise` | (none) | `proposed` | 1 on the new revision |
| `supersede_approved` (Launch F) | `approved` | `superseded` | 1 on the old revision |
| `revise_approved` (Launch F) | (none) | `approved` | 1 on the new revision |

`rejected` and `superseded` are terminal. `approved` has exactly one outgoing edge, `supersede_approved`,
which only `reviseApprovedProposal` writes (see **Launch F: revising an approved proposal**). A revision of a pending proposal is two
transitions on two rows (`supersede` the old, then `revise` the new, in that order because of the
live-revision index), so two ledger rows; each transition still writes exactly one.

### Validation

`validateAwardProposal(values, facts, context)` is pure; the service reads the facts inside its
transaction. Shape rules (also enforced by CHECKs, so an unstorable proposal is refused with
`invalid_input` before any SQL): award slug present and not Brownlow, season 1897–2100, player name,
identity format, votes 0–999999.99 with at most two decimals, required evidence, http(s) URL,
Wikipedia URL, real non-future `acquired_on`, lengths. Database rules: award exists, season is in the
`seasons` register, club slug exists, the player identity resolves to **exactly one** player (a NULL
identity is `player_unresolved`: stored, reviewable, never approvable), and duplicates against active
`award_winners` and against other undecided proposals. A duplicate is an error unless the proposal
carries `duplicateConfirmed` (then a warning kept on the record), because some awards legitimately
record one player twice in a season (`admin-awards.ts` R-5).

### Approval

`approveProposal` runs in **one transaction**: lock the row, take an advisory lock on
award + season, re-validate (a changed world is `stale_validation`, nothing written), call the injected
promotion port, set `status = approved` and `approved_entity_key`, write the ledger row. Any throw rolls
all of it back. The production port (`awardWinnerPromotionPort`) calls the existing
`insertAwardWinner` on the **same** postgres.js transaction, so the canonical row, its
`data_overrides` row, its `data_edits` row and the award-span recompute commit or roll back together
with the proposal's status and ledger row. The proposal id, key, revision and evidence are added to
the `data_edits` row (`auditExtra`). `@afldb/admin` never imports that module (it is server-only and
reaches `src/db/client.ts`).

**The season seal.** `award_winners` is a historical table (`HISTORICAL_TABLES`) and almost every
curated award targets a sealed season, so the approval consults the V2 season seal
(`evaluateSeasonWrite`, `packages/domain/src/season-seal.ts`) inside its transaction, after the row
lock and re-validation and **before** the promotion port is called. The caller supplies the sealed
range as the required `ApproveDependencies.sealed` (`SealedSeasons`); the package does no file I/O.
The correction passed to the seal is workflow `curated_award_approval` (a new member of
`AUDITED_CORRECTION_WORKFLOWS`, with its own row in `docs/v2/historical-baseline.md` §2), actor = the
approving user, note = the decision note, evidence = `award_proposals:<id>`. An open season proceeds
as before. A sealed season proceeds only with a decision note of 20..2000 characters after trimming;
otherwise the approval is refused with the typed code `season_sealed_correction_invalid` (carrying the
seal's message), the transaction rolls back, and there is no status change, no ledger row and no
winner. The audit record is the append-only `award_proposal_decisions` row the same transaction writes
(it already records the actor, the note and the proposal id); migration 111 and every table are
unchanged. The seal rule composes with the Wikipedia rule below: both notes are the same field, so a
Wikipedia proposal into a sealed season is bound by both.

Approving `wikipedia_offline_file` input additionally needs a decision note of at least 20 characters
recording the independent verification: Wikipedia is never self-certifying and nothing approves it
automatically.

**Launch F: four eyes (V2-GAP-019, now enforced).** The Stage 4 text here said no four-eyes rule was
enforced; that is no longer true. `approveProposal` calls `decideFourEyes` before any lookup or write:

- "Creator" is `created_by` of the **revision being approved**. A reviser is the creator of their
  revision (`insertProposalWithLedger` records them), so revising a pending proposal hands the approval
  to someone else.
- Another administrator approves with no further input.
- The creator is refused with `self_approval_forbidden` unless the viewer's `role` is **explicitly**
  `super_admin` (tested on the role, never inferred from the `data.awards.edit` capability, which is
  super-admin-only today but may widen) **and** they supply a self-approval attestation of at least 20
  trimmed characters. A blank attestation is `self_approval_forbidden`; a present but short one is
  `self_approval_attestation_required`; over 2000 characters is `invalid_input`.
- The approve ledger row records `new_values.selfApproval` (`false` for a normal approval) and, when
  `true`, `new_values.selfApprovalAttestation`. The attestation is kept in the ledger, not in a new column.
- The rule composes with the season seal and the Wikipedia note: all three are independent refusals, each
  raised before the promotion port is called, each leaving nothing written.

On the approval form the attestation field is shown only to the creator of a validated revision, with the
rule explained above the field.

### Revisions

`reviseProposal` creates revision n+1 (`revision_of_id`), supersedes the earlier one and never edits
it again. Revising an **approved** proposal through it is still refused with
`approved_revision_unsupported`: the winner already exists, so it needs the action below.

**Launch F: revising an approved proposal (V2-GAP-018).** `reviseApprovedProposal(viewer, executor, input,
deps)` is a wrapper over the existing replace / correct lifecycle, recording the new revision and its two
ledger rows in the **same transaction** as the canonical change. Capability `data.awards.edit`; the
decision note (trimmed 20..2000 characters) is always required. In one transaction:

1. lock the approved proposal row (`supersede_approved` must be a legal edge from its status);
2. validate the new values against the database exactly as approval does; errors refuse with
   `invalid_input`. The approved canonical row itself is excluded from the duplicate check (it is not a
   duplicate of its own revision), a different active winner is still one;
3. consult the season seal (`curated_award_approval`, the note) for the old **and** the new season,
   before any canonical write: `season_sealed_correction_invalid`; then require the note itself
   (`note_required`);
4. through the injected `ApprovedWinnerRevisionPort`, **locate and lock the canonical row by the proposal's
   `approved_entity_key`** (source key + `source_record_id`) and take the compare-and-swap value from that
   locked row's own `updated_at`, so no `expectedUpdatedAt` crosses the service boundary. A missing or
   void row is `approved_winner_not_active`. The port then calls a tx-level variant extracted from the
   existing function: `replaceAwardWinnerInTx` when an identity-bearing value changed (award, season,
   player identity, player name; the old row is voided and a replacement created) or
   `correctAwardWinnerInTx` when only non-identity values changed (votes, position, captain flags, note,
   club). `replaceAwardWinner`, `correctAwardWinner` and `runHonourEdit` call the same code inside their
   own `begin`, so their behaviour is unchanged; `admin-awards.test.ts` passes unchanged against them.
   Refusals the lifecycle returns are **thrown** inside the wrapper, so the whole transaction rolls back;
5. the old revision `approved -> superseded` (ledger `supersede_approved`; migration 114 lets a superseded
   former approval keep its key and time), then the new revision is inserted directly as `approved` with
   the resulting entity key (the new key after a replacement, the same key after a correction) and
   `approved_at` (ledger `revise_approved`, from no state), in that order because of the live-revision
   unique index. `revision_of_id` chains them. `revise_approved` records `selfApproval: true`: the reviser
   applies the revision themselves, and the mandatory note is the audit of that.

Any failure rolls all of it back: no ledger row, the proposal still approved, `award_winners` unchanged.
Limits, stated plainly: a revision that would not change the canonical row (an evidence-only edit) is refused
`no_change` — the canonical correction is relative to the proposal's own recorded values, so a winner
edited out of band in `/admin/awards` after approval is overwritten only in the fields the revision names;
and only the newest revision of a proposal can be revised.

**Launch F: public-page revalidation (V2-GAP-024).** The promotion port now returns
`revalidatePaths`, computed server-side with `awardWinnerPaths` from the row it just created
(`readAwardWinnerInTx`); the revision port returns the union of the paths of the row before and after the
change (a replacement, a season move or a club change moves two sets of pages). `approveCurated` and
`reviseApprovedCurated` return them, the server actions pass them through, and the **client** posts them to
`/admin/awards/revalidate` after success, exactly as `src/app/admin/awards/submit-helper.ts` does. No server
action calls `revalidatePath` (it hangs the client). The route's allowlist
(`src/app/admin/awards/revalidate-paths.ts`) admits every shape `awardWinnerPaths` produces
(`tests/v2-curated-awards.test.ts` and `tests/integration/v2-curated-awards.test.ts` assert this on the paths
the real port returns).

### Audit tiers

1. **Workflow** — `award_proposal_decisions`, exactly as `promotion_decisions` (074) and
   `afl_api_identity_adjudications` (104) audit their decisions.
2. **Canonical row** — the existing `insertAwardWinner` path writes `award_winners`, `data_overrides`
   and `data_edits`. `data_edits_table_name_check` is deliberately **not** widened.

### Link the player first, then propose (V2-GAP-020)

The identity-less refusal is a **safety property and is kept**. `insertAwardWinner` itself would accept a
legacy identity-less player (the award row is meaningful unlinked), so the line is held by
`validateAwardProposal` (`player_unresolved`), which `approveProposal` runs again inside its own
transaction. The PostgreSQL suite proves it on the **approval path**, not just in validation: a proposal
with no identity validates to `validation_failed` and cannot be approved (`illegal_transition`); and a row
forced to `validated` anyway is refused by the approval's own re-validation as `stale_validation` carrying
`player_unresolved`, with no winner, no `data_overrides`, no `data_edits` and no approve ledger row written.

The workflow for a player who is not yet linked is therefore: **link the identity first through the existing
identity tools (`/admin/player-links`), then propose** (or revise the pending proposal with the resolved
identity). Nothing in the curated path links players.

### Offline files

`parseAwardProposalFile(text, 'json' | 'csv', defaults, today)` is pure and refuses the **whole file**
on any invalid row (it returns every problem and no proposal). `createProposalsFromFile` then creates
the proposals in one transaction — proposals only: it validates nothing against the database and
approves nothing. A file may claim `offline_file` or `wikipedia_offline_file`, never `manual_entry`.
The modules import no HTTP client, socket or file reader (an import-allowlist test pins this); the
caller hands in text. No CLI exists in Stage 4.

### Grants (hand-written; no `afldb_meta` function)

| Role | `award_proposals` | `award_proposal_decisions` |
|---|---|---|
| `afldb_import` | SELECT, INSERT, UPDATE on `status`, `validation_result`, `validated_at`, `approved_entity_key`, `approved_at`, `updated_at` only; sequence USAGE | SELECT, INSERT; sequence USAGE |
| `afldb_auth` | SELECT | SELECT |
| `afldb_app` | none | none |

Neither table is registered with `grant_import_write()` (its reconcile loop restores UPDATE, DELETE
and TRUNCATE, the migration 066/104 reason) or `grant_app_read()` (proposals hold unvetted data and
must never reach the public site). `tools/maintenance/privileges.sql` carries the matching
`afldb_import` block (its revoke loop strips them every run) and two `afldb_auth` spec rows;
`tools/db/privileges.ts` is only the runner and needs no change. **Deploy order (AFLDB-ISSUE-027,
097-style): apply the migration, then `npm run db:privileges`, then deploy the code.**

### Promotion and rebuild

Both tables are classified `reinstate` in `tools/db/promotion-inventory.ts` (production-only human
state; `auth_users` restored first, ledger after proposals). Because they carry no foreign key into
rebuilt football tables there is no `footballRefs`, no `lineageRefs` and no recorded gap. The
freeze-digest set (F0) grows by these two tables, and `tests/reference-data.test.ts` lists them among
the post-045 tables deliberately not import-writable.

### Rollback

Comment-only block at the head of migration 111: drop `award_proposal_decisions`, then
`award_proposals`; remove the privileges.sql blocks and the integration-test entries. Rolling back
discards every proposal and decision row (export first). Approved winners are unaffected: they live in
`award_winners` with their own `data_overrides` and `data_edits`.

## Verification, and what is not verified

Executed on in-memory PGlite (PostgreSQL 16 compiled to WebAssembly, no `dataDir`, no network,
`@electric-sql/pglite` 0.2.17): migration 111 applied **verbatim from disk** over labelled **stub**
prerequisites (not a copy of migrations 001–110, plan D2/R-017); every constraint; the ledger CHECK
against the TypeScript state machine over all 252 triples; the grants against stub roles
(`has_*_privilege` and `SET ROLE afldb_import` refusals); and the real service SQL under the
`afldb_import` stub role, including the approve rollback with a stub promotion port. A first run
of the triple test caught a real defect — a `CHECK` passes on NULL, so a NULL `from_status` slipped
through the validate/approve/reject/supersede branches (and a NULL `source_url` through the Wikipedia
CHECK) — fixed with explicit `IS NOT NULL` / `coalesce` before the migration was committed.

**Statically reviewed, unexecuted on PostgreSQL:** the real `insertAwardWinner` (covered by the
unchanged `tests/integration/admin-awards.test.ts`, which needs a database); the postgres.js adapter
against a real server (its wiring is pinned with a fake handle); the `privileges.sql` blocks and the new
`tests/integration/privileges.test.ts` case (need a migrated database and `db:privileges`); migration
111 on a database carrying migrations 001–110 and the real roles. Driver differences handled in code,
unproven against a live server: postgres.js returns `int8` as a string (every id is cast `::int`), and
a jsonb parameter must be passed as a value, never a pre-stringified string (postgres.js serialises by
the server-described type and would double-encode it).

## What Stage 5 must wire

> **Wired in Stage 5 (Launch D)**, under `/admin/operations/awards` rather than `/admin/awards`:
> list, history, create from a local file, validate, approve (with `ApproveDependencies.sealed`
> from `src/lib/seasons/sealed-seasons.ts` and the sealed-season note as a field error), reject;
> the acting user's `auth_users.id` as `CuratedAwardsViewer.userId`; no `revalidatePath`. Not
> wired: manual single-entry with `resolvePlayerIdentity` (proposals come from a file only),
> revising (V2-GAP-018) and public-page revalidation after approval (V2-GAP-024). The list below
> is the Stage 4 instruction, kept as written. **Launch F** wired the rest: four eyes, revising an
> approved winner (`/admin/operations/awards/[id]`, the "Revise approved winner" panel) and revalidation
> after approval and revision.

- Pages under `/admin/awards` (or the data editor) that call the services through
  `withAwardProposalExecutor` and `awardWinnerPromotionPort`; guard each with
  `requireCapability('data.awards.edit' | 'data.awards.read')`, and pass the acting user's
  `auth_users.id` as `CuratedAwardsViewer.userId`.
- Supply `ApproveDependencies.sealed` on every `approveProposal` call: build it with
  `sealedSeasonsFrom` (`@afldb/domain`) from `data/reference/seasons.json` (the settle CLIs already do
  this with `loadSealedSeasonsFor` in `tools/current-season/settle-season-seal.ts`). The approval
  form must ask for the decision note whenever the proposal's season is sealed (20..2000 characters)
  and surface `season_sealed_correction_invalid` as a field error. No production caller of
  `approveProposal` exists yet, so nothing is wired in this stage.
- Server actions must export functions only (a `'use server'` module exporting a const array 500s) and
  must **not** call `revalidatePath` (it hangs the client): revalidate from the route.
- Manual entry resolves the picked player to the durable identity string server-side with
  `resolvePlayerIdentity` and submits it as `playerIdentity`; a legacy identity-less player yields
  `null` and the proposal cannot be approved until the player is linked.
- Reads may use `afldb_auth` (SELECT granted) or the import connection; never `afldb_app`.
- Show `validationResult.issues` (errors block approval; warnings are confirmed repeats), the
  decision history from `readProposalHistory`, and require a note on rejection and on approving
  Wikipedia-derived input.
- UI changes carry the Visual Evidence Mandate (CLAUDE.md §15).

## Consequences

Requires an additive migration (ADR 0004) and the matching privileges change. Stage 4 follow-ups, now
closed by Launch F: approved-proposal revisions (V2-GAP-018), the four-eyes rule (V2-GAP-019), the
PostgreSQL-side verification of the production port (`tests/integration/v2-curated-awards.test.ts`, run on
the isolated cluster) and public revalidation (V2-GAP-024). Migration 114 section 2 widens three migration 111
constraints by DROP/ADD superset replacement (the migration 094 precedent): no row is rewritten and nothing
accepted before is refused after; its `-- ROLLBACK:` block restores the 111 texts verbatim. Deploy order:
apply 114, then `npm run db:privileges`, then the code. Still open: evidence-only edits of an approved
proposal are not applied (they are refused `no_change`); V2-GAP-023 is not part of this ADR.
