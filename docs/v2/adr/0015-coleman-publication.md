# ADR 0015 — Coleman Medal: publication of the derived result into `award_winners`

- Status: Accepted (owner decision); implemented (Launch F, stream F-D, step B1)
- Builds on: ADR 0006 (the Coleman Medal is derived, never ingested; the audited ledger publisher).
  Closes V2-GAP-021 for the code path; production execution on a historical database is still
  open (see "What remains").
- Plan and review: `documentation/plans/implementation/launchF-FD-awards-plan.md` §2 and §5
  (F-002, F-003, F-011)

## Context

ADR 0006 stopped at a ledger: `publishColemanResult` writes the append-only
`derived_award_results` row and never touches `award_winners`, so the public Coleman rows stayed
owned by the offline loader (`tools/migration/import_awards.py`, `import_coleman`). The owner
decision for Launch F: Coleman remains DERIVED from settled home-and-away player goal statistics,
and is published into the EXISTING `award_winners` contract, with transactional publication,
idempotency, provenance to the derivation record and version, joint winners for ties, refusal for
incomplete or unsettled seasons, no finals statistics, audited correction and republishing,
compatibility with the existing public queries, and tests proving a rerun cannot duplicate winners.
There is NO competing canonical winner store: `derived_award_results` stays a derivation ledger and
`award_winners` stays canonical.

## Decision

Publication is the ledger step PLUS a projection of the derived winners into `award_winners`, in
ONE transaction.

- `publishColemanResult(executor, request, { projection })` (`packages/derived`) runs the
  projection port inside its transaction, after the ledger step, for EVERY ledger outcome including
  `unchanged`, passing the current ledger row id. Without a port the Stage 4 ledger-only behaviour
  is unchanged (the existing PGlite tests). A refusal thrown by the port (`ColemanProjectionRefusal`)
  rolls the whole transaction back, ledger row included, and is returned as a typed refusal.
- The operations centre always passes the production port
  (`src/db/queries/coleman-award-winners.ts`); a unit test pins that.
- Planning and applying are split. `planColemanProjection` (`packages/derived/src/coleman-projection.ts`)
  is pure; the port loads the rows, plans, and applies. The read-only preview that
  `compareColemanSeason` returns is the SAME plan, so the preview and the write cannot disagree.
- The season seal applies exactly as for the ledger: every Coleman write targets sealed history, so
  it is an audited correction (workflow `derived_award_publication`, note of 20 to 2000
  characters, plus the operator's settled attestation). A publication whose derived winners
  already equal the stored rows is NOT a data change: it records provenance only and rewrites no
  `award_winners` row (not even `updated_at`).

### Idempotency key and the loader's column tuple

The key is the loader's own: `(source_id of the contract source 'afltables', source_record_id =
coleman:<season>:<normalised AFL Tables profile path>)`, backed by `award_winners_source_uq`
(migration 042). A derived row is built in the loader's EXACT column format: `player_id`,
`player_name_raw` = `players.display_name` (the canonical record, never a source spelling),
`link_status_value 'resolved'`, `candidate_count 0`, `club_id` (the single distinct club, NULL when
the winner represented more than one), `club_name_raw NULL`, `votes NULL`, `position NULL`, both
captain flags false, and `note = "Derived from AFLDB home-and-away match statistics: N goals
(coleman-derivation.json method_version M)"`, byte-identical to `import_awards.py`
(`tests/v2-coleman-projection.test.ts` reads the Python file and pins the template). `import_batch_id`
is NULL on a projected insert.

### Decision per key

| Stored row for the derived key | Result |
|---|---|
| none | `inserted` |
| active, the FULL tuple equal | `retained` (untouched) |
| active, any column differs (including the note: a goals-only change) | `updated`, unless an administrator override exists (`admin_override_present`) |
| void | refused, `derived_row_voided` |

Every ACTIVE Coleman row of the season whose key is no longer derived: source `afltables` and key
`coleman:<season>:...` -> `voided` (status `void`, a `status_reason` naming the derivation and the
ledger row; an override refuses it), any other owner (`manual_admin_edit`, legacy `draftguru`, no
source, another award or season) -> refused, `foreign_winner_rows`, listing the rows. Void rows that
are not derived are history and are ignored. Joint winners are several keys, each its own row.

Other refusals: `award_definition_missing`, `source_missing`, `player_missing` (a derived winner
with no canonical player name), `projection_unavailable` (the port was not given the publisher's
native postgres.js transaction). Every refusal writes nothing, ledger row included. When several
kinds apply the first of player_missing, foreign_winner_rows, derived_row_voided,
admin_override_present is returned.

An "administrator override" is a `data_overrides` row for the row's entity key
(`<source key>:<source_record_id>`, `awardWinnerEntityKey`) or a human `player_link_resolutions`
decision on the row (the loader preserves those, so a projection must not fight them).

### No `data_overrides` row for a derived row

Curated approvals write one because a hand-entered row has nothing else to restore it after a
rebuild. A derived row is re-derived identically by the loader from the same facts under the same
keys and values, so an override would add nothing and would LOCK the row against the next
re-derivation. The existence of one is therefore a refusal, not something this path writes.

### Provenance and audit

- `derived_award_projections` (migration 114, append-only): one row per ledger result for its first
  projection, and one for every projection that changes a row; an idempotent rerun that changes
  nothing and finds a projection already recorded for that result writes NOTHING. It holds keys and
  actions (`[{entityKey, action, awardWinnerId}]`) and the seal's audit record; it is not a winner
  store.
- One `data_edits` row per inserted, updated or voided `award_winners` row (field group
  `coleman_derived_publication`), with old and new values and the provenance in `new_values`:
  `derived_award_result_id`, `ledger_outcome`, `method_version`, `derivation_version`,
  `input_checksum`, `evidence_ref`, `entity_key`, `lineage_identity`, the changed fields. The note
  is the operator's correction note.
- `awards.first_season` / `last_season` are recomputed (`recomputeAwardSpan`) when a row changed.
- The administrative activity row (`auth_audit_log`) is written by the operations centre after the
  transaction, with the counts.

### Correction and republishing

A corrected goal fact changes the input checksum: the ledger supersedes (ADR 0006) and the
projection updates the winner's note (same winner, new total), or voids the old winner and inserts
the new ones. Each is audited; nothing is deleted. A void is an audited decision that publication
does not override: when the facts later return to a state that derives a voided key, publishing is
refused with `derived_row_voided` until an administrator reinstates the row in `/admin/awards`.

### Revalidation

The port returns the public paths (`awardWinnerPaths`, unchanged) for every changed row, before and
after values together, empty when nothing changed. A Server Action never calls `revalidatePath`:
the action returns the server-computed paths and the Coleman workbench (a Client Component) posts
them to `/admin/awards/revalidate` after success, exactly as `src/app/admin/awards/submit-helper.ts`
does. `isAllowedRevalidatePath` admits every path a Coleman row can produce
(`tests/v2-coleman-projection.test.ts`, `tests/integration/v2-coleman-publication.test.ts`).

### Coexistence with the offline loader

The explicit `legacy/offline/coleman.py` entry point is a dedicated-cluster historical bootstrap,
not an alternative publisher. It requires loopback port 55432, V2 `_test` name, live cluster and
database marker. It refuses if canonical Coleman publications exist. It acquires the canonical
season lock keys using **session-scoped** locks: historical `ImportBatch` commits would release
transaction-scoped locks before the award write. The connection finalizer releases all locks.
The real PostgreSQL regression commits after acquisition, proves a competing publisher cannot
take the lock, closes the loader connection, then proves acquisition succeeds. Publication suite
**27/27**: `evidence/local-coleman-complete.json`. A bootstrap-written row is still retained by
the first canonical publication; after publication, a bootstrap refuses without changing tuples.

## Consequences and what remains

- The production SQL, the transaction rollback properties and the public queries are proven on
  PostgreSQL 16 (isolated cluster) with synthetic fixtures. Nothing has run on a historical
  database: no real season has been published, and the main session's rebuilt-database run
  (comparison of every season, then publication) is still to do.
- First real execution of the ledger insert on postgres.js found a defect the in-memory tests could
  not: a jsonb parameter passed as a pre-stringified string is double-encoded (the server-described
  parameter type makes postgres.js `JSON.stringify` it again), which failed
  `derived_award_results_correction_ck`. The publisher and the projection now pass `$n::text::jsonb`,
  which is single-encoded on both drivers. `packages/db/src/sql-executor.ts` still documents
  `$n::jsonb` with a string; that note should be corrected by its owner.
- The deploy order is unchanged: apply migrations 113 and 114, then `npm run db:privileges`, then
  the code (AFLDB-ISSUE-027).
- Seasons before the contract's `first_season` are not derivable and are not projected.
- Not built: bulk publication of every season in one action (one season per call by design), and
  automatic reinstatement of a row the projection itself voided.
