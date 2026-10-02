# AFLDB-ISSUE-257 — Match Sheet edits to source-owned player statistics are reverted by the next automatic settle

## 0. Status

- **Status:** Open.
- **Opened:** 2026-10-02.
- **Severity:** Medium.
- **Area:** Admin / data integrity / current-season acquisition — the Data Editor Match Sheet,
  the manual-authority provider and the automatic canonical applier.
- **Review origin:** `playbooks/issue.md`, finding F-001.
- **Operator decisions (2026-10-02, made after the review):** Option A, durable authority
  (D-257-0, §15.2). The direction of the §17 design is approved (D-257-1 to D-257-4 and five
  further constraints, §15.3). Its representation details are not approved: §17.13 lists them as
  implementation and rehearsal work.
- Nothing has been implemented. §1–§14 are the review's evidence record as written before the
  decision; §15–§17 carry the decision and the design.

## 1. Summary

A Super Admin can correct a player's match statistics, club, jumper number or presence in a lineup
through the Data Editor Match Sheet. The edit is written straight to `player_match_stats` and leaves
only an audit row. It creates no durable human-authority record.

The automatic settle treats `player_match_stats` as a table no human can have decided, so its
manual-authority check always answers `clear`. For a current-season row owned by the settling
source, the next settle sees that the canonical row differs from the source, and writes the source
values back. The administrator's correction lasts until the next run and nothing reports the
reversal as a conflict.

## 2. Evidence

All references are to `main` at `1c1a4805`.

**The writer.** `src/db/queries/match-sheet.ts`
- `:98-104` — players marked for removal are deleted from `player_match_stats`.
- `:106-137` — the upsert writes `club_id`, `jumper_number`, `goals`, `behinds`, `kicks`,
  `handballs`, `disposals`, `marks`, `tackles`, `hitouts`, `frees_for`, `frees_against`. Neither the
  INSERT column list nor the `ON CONFLICT` SET list contains `source_id`, `source_record_id` or
  `import_batch_id`, so an edited row keeps the owner it had.
- `:149-157` — the only record of the decision: one `data_edits` row with `tableName: 'matches'`,
  `fieldGroup: 'match_sheet'`, empty `oldValues`, and a player count. No `data_overrides` row.

**The authority contract.** `src/lib/acquisition/manual-authority.ts`
- `:9-16` — `data_overrides` is the only authority record read; `data_edits` is deliberately not
  consulted (the settle role cannot read it).
- `:108-110` — `UNREPRESENTABLE_OVERRIDE_ENTITIES` contains `player_match_stats`.
- `:194-197` — for those entities the verdict is `clear` whenever `overrideScopeProven` is true.
- `:259-276` — the proof: the `data_overrides.entity_type` CHECK is readable, admits none of the
  three settle targets, the generic editor exposes none of them, and every editor entity is
  admitted. It examines `EDITABLE_ENTITIES` (`src/lib/edit/spec.ts`: `players`, `matches`,
  `draft_picks`) and nothing else. The Match Sheet is not an editor entity and is not examined.

**The settle.** `src/lib/acquisition/settle-afltables.ts`
- `:308-314` — `PLAYER_MATCH_STATS_PROPOSED_FIELDS` includes `club_id`, `jumper_number` and all 21
  statistic columns, a superset of what the Match Sheet writes.
- `:2166-2197` — `invitationFor`: when the observation is `unchanged` (or `history_only`) and
  `diffFields(proposal, targetValues)` is non-empty, the target is offered as a `retry`. The comment
  states the rule: "Keyed on TARGET state, never on payload change."
- `:2344-2356` — the baseline hash handed to the applier is computed from the target values read in
  the same run.

**The applier.** `src/lib/acquisition/canonical-apply.ts`
- `:126-148` — `autoApplyOwnership`: a row owned by the promoting source is `updateable`; a row with
  no owner is refused.
- `:578-605` — the fresh read of the row and its ownership.
- `:1052-1063` — the baseline check compares the row with the baseline from the same run, so an
  administrator's earlier edit does not make it stale.
- `:1083-1103` — the authority question; `clear` proceeds.
- `:830-853` — `writePlayerMatchStats`: INSERT for a missing row, UPDATE for an existing one.

**The path is live.** `data/reference/seasons.json` has `"in_progress_seasons": [2026]`, and
`deploy/afldb-settle-afltables.sh:178-179` runs the settle with `--apply --auto-apply`.

**The reload.** `tools/migration/common.py:1160` (`replay_admin_overrides`) replays `data_overrides`
rows. There is none for `player_match_stats`, so a Match Sheet edit cannot be replayed by any reload.

**Tests.** No test covers a Match Sheet edit followed by a settle.
`tests/current-season-import.test.ts` pins the four-condition proof and the `clear` verdict for the
three unrepresentable entities.

## 3. Supported execution/data path

1. A Super Admin opens a current-season match in `/admin/data-editor`, changes a player's `goals`
   from 2 to 3 in the Match Sheet, and saves (`saveMatchSheetAction` → `saveMatchSheet`).
2. The row is updated. Its `source_id` still names AFL Tables. Derived totals are recomputed. One
   `data_edits` row is written.
3. The nightly `afldb-settle-afltables` unit runs (or a Super Admin starts it from
   `/admin/current-season`). AFL Tables still publishes 2.
4. The observation is `unchanged`. The proposal (2) differs from the canonical row (3), so the
   target is offered as a `retry`.
5. In the applier: ownership `updateable`; baseline matches; authority `clear`; UPDATE sets `goals`
   back to 2 and writes a `canonical_applications` row with `previous_values` 3 and `new_values` 2.
6. The settle's derived recompute restores the old totals.

A removal follows the same path through `new_target` → INSERT.

## 4. Expected invariant

A canonical fact an administrator has corrected is not silently replaced by an unattended source
run. The repository states this three times:

- ISSUE-086 (resolved): "Admin edits are intended corrections, and silently reverting them on the
  next source reload violates that durability expectation", with the follow-up "Future editable
  source-owned entities must participate in the same durable natural-key override/replay contract".
- `canonical-apply.ts:15-17`: "An override an administrator commits after the proposal was generated
  must still be able to stop the write."
- The AFL API identity-correction tooling (ISSUE-238) recognises a `match_sheet` audit as a
  legitimate later writer whose value is "never overwritten by a re-apply".

## 5. Actual behaviour

The settle overwrites the administrator's values with the source's on its next run, and re-inserts a
removed player. The ledger records an ordinary update. No finding, refusal or notice is produced,
and the Match Sheet shows no warning that the edit is temporary.

## 6. First wrong layer / root cause

The manual-authority proof for `player_match_stats`.

ISSUE-099 listed a prerequisite, A4: "a representable manual authority for the three
player/period-grain targets". ISSUE-122 §8 declared A4 satisfied without building one, by proving
that a human override for those tables is unrepresentable: the `data_overrides` CHECK does not
admit them and the generic editor exposes no entity for them.

That proof enumerates one human writer, the generic field editor. The Match Sheet is a second human
writer of `player_match_stats`. It records its decision only in `data_edits`, which the settle role
cannot read. The proposition "no human can have decided a `player_match_stats` field" is therefore
false while the proof of it still passes.

The symptom appears in the applier; the cause is the premise.

## 7. Impact

- **Data:** a manual correction to a current-season, settle-owned `player_match_stats` row is
  replaced by the source value at the next settle. The source value is restored, not lost; what is
  lost is the correction. Derived career and season totals follow the row both ways.
- **User-visible:** public player, match and season pages show the correction, then revert.
- **Operational:** the administrator is not told. The only trace is a `canonical_applications`
  update row and a `canonicalRowsUpdated` count.
- **Scope:** rows of in-progress seasons whose owner is the settling source, for the columns the
  settle proposes. With the current register that is 2026 and AFL Tables. The AFL API settle shares
  the applier, so `afl_api`-owned rows would behave the same; none exists today.
- **Not affected:** a row the Match Sheet inserts for a player the source does not list. It has no
  owner, so the settle refuses it (`ownership_indeterminate`).
- **Wider consequence of the same cause:** because no durable record exists, a Match Sheet edit on
  any season cannot be replayed by a source reload or a database rebuild. This was not exercised in
  the review.

## 8. Reproduction / witness

**DB-free witness (run during the review; nothing in the repository was created).** Using the
repository's own functions:

| Question | Result |
|---|---|
| Editor entities | `draft_picks`, `matches`, `players` |
| `overrideScopeProvenFrom` over the admitted entity list | `true` |
| `diffFields({goals: 2, …}, {goals: 3, …})` | `["goals"]` |
| `autoApplyOwnership` for a row owned by `afltables`, promoting `afltables` | `updateable` |
| `manualAuthorityVerdict` for `player_match_stats`, fields `["goals"]` | `clear` |
| Contrast: `matches`, an active `score` override, field `home_goals` | `conflict` |

**Database rehearsal (not run; needs explicit authorisation, `afldb_test` only).**
1. On a settled current-season match, save a Match Sheet change to one statistic.
2. Run the settle over an unchanged snapshot with `--apply --auto-apply`.
3. Read the row and the newest `canonical_applications` row for it.

## 9. Disproof attempts

- **Does the baseline check stop it?** No. The baseline is derived from the row as read in the same
  run (`settle-afltables.ts:2354-2356`).
- **Does an unchanged source payload stop it?** No. `retry` exists precisely for an unchanged payload
  with a differing target.
- **Does the edit change ownership?** No. The upsert does not write `source_id`.
- **Is the Match Sheet edit intended to be provisional?** No document, comment or UI text says so.
  ISSUE-086 and ISSUE-238 treat such edits as corrections to preserve.
- **Is the path unsupported or disabled?** No. It is a current Data Editor feature behind
  `data.dataEditor`.
- **Did a later change supersede the proof?** ISSUE-159 rewrote it as four order-independent
  conditions; the Match Sheet is still outside all four.

## 10. Existing-issue / historical search

Searched `IssuesIndex.md`; `issues.md` for `match_sheet`, `saveMatchSheet`, "match sheet" with
"settle", "overwrit", "manual authority" and `data_overrides`; the closed runbooks for ISSUE-086,
096, 099, 122, 155, 159, 238 and 255; and `docs/`.

- **AFLDB-ISSUE-086** (resolved): the same defect class for the generic editor. Its evidence lists
  the editable surface as `players`, `matches` and `draft_picks`. Its runbook does not mention the
  Match Sheet. Related history, not a regression: this surface was never covered.
- **AFLDB-ISSUE-099** A4 and **AFLDB-ISSUE-122** §8: the origin of the proof.
- **AFLDB-ISSUE-159**: reworked the proof; unrelated to this surface.
- **AFLDB-ISSUE-155**: removed the Match Sheet's Brownlow write. Unrelated to statistics.
- **AFLDB-ISSUE-238**: treats a Match Sheet edit as a legitimate later writer.

No open or closed issue owns this defect.

## 11. Scope

- The interaction between a Match Sheet edit (update or removal) and the automatic canonical
  applier, for `player_match_stats`.
- The manual-authority contract for `player_match_stats`.
- Whatever durable record or refusal the chosen option requires, and its tests.

## 12. Explicitly out of scope

- `match_period_scores` and `brownlow_round_votes`. No second human writer was found for either.
- The generic editor's `matches` and `players` overrides. They work.
- The legacy CSV intake's writes to `player_match_stats` (AFLDB-ISSUE-258).
- Re-inserting a match an administrator deleted. Not examined here.
- AFLDB-ISSUE-229 and AFLDB-ISSUE-233.
- Any change to the ownership predicate, the retry rule or the baseline check.
- Production data repair. No reverted correction has been identified.

## 13. Proposed fix boundary

One of the following, by operator decision (§15):

- **A. Durable authority.** A Match Sheet edit records a durable, settle-readable human decision for
  the affected `(player, match)` fields; the authority provider answers from it; the reload replays
  it. This touches `match-sheet.ts`, `manual-authority.ts`, a migration for the authority record,
  privileges, and the reload replay.
- **B. Refuse.** The Match Sheet refuses to change or remove a row owned by a settling source in an
  in-progress season, and says why. This touches `match-sheet.ts` and the editor UI only.
- **C. Disclose.** The behaviour stays and the editor states that the next settle will restore the
  source values. This resolves the silence, not the reversal.

No implementation code belongs in this runbook.

*Added after the review:* the operator chose **A** on 2026-10-02 (§15.2). The files §17 expects to
touch are wider than the list under A above: they also include the rekey carry, the automatic
proposal filter in the settle, and `deleteMatch`.

## 14. Proposed validation

- **DB-free:** authority-verdict and invitation cases in `tests/current-season-import.test.ts`;
  writer and validation cases in `tests/match-sheet.test.ts`.
- **Integration (`afldb_test`):** in `tests/integration/settle-afltables.test.ts`, a Match Sheet edit
  followed by an unchanged-source settle, asserting the chosen outcome; the removal case; an
  unowned-row control.
- **Rehearsal:** under option A, a reload over an edited row on `code_test_db` or `afldb_test`.
- **DEV acceptance:** one real Match Sheet edit followed by one on-demand settle.
- **Production acceptance:** not required beyond the normal deploy.

## 15. Decisions / unresolved questions

### 15.1 As the review left them

1. Which option (A, B or C)?
2. Under A: is a removal a durable decision too, and how is it represented?
3. Under A: which key identifies the row across a rebuild, given `player_id` and `match_id` are
   database-local?
4. Under A or B: does the same rule apply to rows owned by `afl_api`?
5. Have any current-season Match Sheet corrections already been reverted?

### 15.2 Operator decision (2026-10-02, after the review)

**D-257-0 — Option A, durable authority.** A Match Sheet correction is an administrative
correction, not a temporary presentation-layer edit. Options B and C are not taken. (First recorded
as D-257-1; renumbered when the four design decisions in §15.3 took the numbers 1–4.)

**Required invariant.** A Match Sheet correction to `player_match_stats` must survive unattended
source settles and must be replayable and recoverable across the supported rebuild/reload lifecycle
until it is deliberately superseded or removed.

**Binding requirements stated with the decision.**

- The durable key is a rebuild-stable natural identity for the player and the match. Database-local
  ids are not persisted as the durable key.
- The Match Sheet mutation and the creation or update of its authority record are atomic.
- If durable authority cannot be recorded, the Match Sheet write fails. It must not leave another
  temporary correction.
- The settle and replay paths get the access they need and no more.

Items 2–4 of §15.1 are answered by the design in §17. It was a proposal when this decision was
recorded; its direction was approved afterwards (§15.3).

**Item 5 — historical census.** Retained as a separate follow-up that needs its own explicit
authorisation. It is a read-only comparison of `data_edits` rows with `field_group = 'match_sheet'`
against later `canonical_applications` updates to the same rows. **Not run**, in the review or since.

### 15.3 Operator decisions on the §17 design (2026-10-02)

The four points raised in §17.11 are decided. Each decision approves a behaviour. None approves a
schema, a key rendering or a record form; those stay open (§17.13).

**D-257-1 — the source continues settling uncorrected fields.** Approved.

- Durable Match Sheet authority is field-scoped where the correction itself is field-scoped.
- A correction to one field does not freeze the unrelated source-owned fields of the same
  `player_match_stats` row. The settle may keep updating fields that have no active manual
  authority.
- If the implementation cannot safely tell overridden fields from source-controlled fields, it
  fails closed.

**D-257-2 — additions are durable.** Approved.

- A Match Sheet addition is an administrative correction, as an update or a removal is.
- If the operator creates a player/match statistics row that the source does not currently provide,
  unattended settling must not silently delete or negate it.
- The authority model therefore represents field updates, durable additions and durable removals.
  The three must not be given separate semantics that make rebuild and replay inconsistent.

**D-257-3 — explicit return to source.** Approved. The binding contract:

> Once durable manual authority exists, it remains authoritative until an explicit administrative
> action removes that authority.

- Authority does not lapse because a later source value happens to match the corrected value.
- The operator relinquishes it deliberately, through an explicit action ("Return to source" /
  "Resume source authority"). The exact wording is settled at implementation.
- Removing authority does not itself fabricate a source value. Once it is relinquished, normal
  settle and replay behaviour resumes.

**D-257-4 — replay refuses missing identities.** Approved.

- Replay or rebuild fails closed when a durable authority record cannot resolve its player or its
  match through the supported rebuild-stable identity.
- It does not skip the record, orphan it, bind it to an approximate match, or fall back to
  database-local ids.
- The failure identifies the unresolved record well enough for an operator to investigate it.

**Constraints approved with the design boundary.**

- **Natural identity.** The durable representation does not depend on `players.id`, `matches.id` or
  any other database-local surrogate staying identical across rebuilds. The implementation session
  derives the exact rebuild-stable player and match identity from the existing AFLDB identity
  contracts before it writes the migration. That identity is not chosen now from assumption; §17.4
  remains a proposal.
- **Atomicity.** A Match Sheet mutation and the durable authority that protects it are one logical
  administrative operation, in a transaction or an equivalently strong existing application
  boundary. This sequence must be impossible: the canonical mutation succeeds; the authority write
  fails; the user sees success; the next settle silently reverses it.
- **Provider neutrality.** The contract applies by canonical ownership and settle semantics, not
  because the provider is `afltables`. An `afl_api`-owned `player_match_stats` row subject to the
  same automatic settle gets the same durable manual-authority rule. Provider-specific override
  mechanisms are not duplicated unless the existing architecture makes that unavoidable.
- **Deployment ordering.** The constraint in §17.10 is mandatory. A migration that makes
  `player_match_stats` admissible to the existing `data_overrides` CHECK is not deployed before the
  application and settle code understands and safely handles that entity. The implementation plan
  must set a deployment sequence that cannot make an existing unattended settle refuse unrelated
  player-statistic, period-score or Brownlow work.
- **Privileges.** The evidence that `afldb_import` already holds the relevant `data_overrides`
  privileges (§17.1) is retained. Privileges are not broadened unless implementation proves an
  additional grant is actually required.

### 15.4 Still open

- The representation details listed in §17.13. The decisions above do not approve them.
- Deactivation of authority when its match is deleted (§17.7). Proposed in §17.11 point 3; not
  decided.
- The verification items in §17.12. None was checked; each is a source read or a rehearsal for the
  implementation session.
- The historical census (§15.2, item 5). Separately authorised; not run.

## 16. Next action

A fresh implementation session for Option A. It starts with §17.12 and §17.13, first deriving the
rebuild-stable player and match identity from the existing identity contracts, and it produces an
implementation plan with a deployment sequence that satisfies §17.10 before any migration or code is
written. Not started.

## 17. Design for Option A (proposed 2026-10-02; direction approved 2026-10-02; not implemented)

This section was written after the review, from facts the review established plus four further
source lookups (the `data_overrides` definition and grants, the rekey carry, the replay branches).
Where a statement was not verified it says so.

**Approval state (2026-10-02).** The operator approved the direction of this design: D-257-1 to
D-257-4 and the constraints in §15.3. §17.1–§17.10 are kept as they were proposed. Where they name a
specific record form, key rendering, tombstone or ordering, that detail is still a proposal; §17.13
lists what remains implementation and rehearsal work. Where a subsection and §15.3 differ, §15.3
governs.

### 17.1 Where the authority lives

`data_overrides`, with a new entity type `player_match_stats`. Reasons:

- It is already the one authority record the settle reads, and the one a reload replays.
- `afldb_import` already holds `SELECT`, column `INSERT` and column `UPDATE` on it
  (`tools/maintenance/privileges.sql:323-332`), and the Match Sheet, the settle and the importers
  all run as that role. **No new grant is needed** for write, read or replay. No `DELETE` is needed.
- The existing entity types already follow the pattern, with replay branches in
  `tools/migration/common.py`.

The only schema change is widening the `entity_type` CHECK. That change has a deploy-order
constraint: see §17.10.

### 17.2 What an update records (field-level)

One row per corrected `(player, match)`: `entity_type = 'player_match_stats'`,
`field_group = 'match_sheet'`, `entity_key` as in §17.4.

`override_values` holds **only the fields the administrator changed** in that save, compared with the
row as it stood inside the same transaction. This is the rule `saveEdit` already applies
(`src/db/queries/data-edits.ts:232-237`): an absent key carries no authority; a key with JSON `null`
means the administrator cleared the figure to "not recorded". The fields are the twelve the Match
Sheet writes (`club_id`, `jumper_number` and ten statistics). `club_id` is stored as a club natural
identity, not the database id.

A save that changes nothing for a player records nothing for that player. A later save merges its
changed fields into the existing record.

To do this the writer must read the existing rows' values before the upsert. Today it reads only
their player ids (`match-sheet.ts:90-94`).

### 17.3 How a removal and an addition are represented

Two lineup facts are corrections too and need a durable form:

- **Removal.** An active record with `field_group = 'lineup'` and `override_values = {"present":
  false}`. It means "this player did not play in this match". The settle must refuse to insert that
  row, and a reload must delete it if the source recreated it.
- **Addition** (a player the source does not list). An active `lineup` record with `{"present":
  true}`, alongside a `match_sheet` record holding every entered field, so a rebuild can recreate
  the row. Today such a row survives a settle only because it has no owner; it does not survive a
  rebuild.

`is_active = false` is **not** used as the tombstone. On this table it already means "this authority
was withdrawn" for `matches`, and overloading it would make a withdrawn correction indistinguishable
from a recorded removal.

### 17.4 The durable key

`entity_key` is built from two rebuild-stable identities and contains no database-local id.

- **Match:** `matches.match_key`, the key match overrides already use.
- **Player:** the identity the generic editor already uses for a player override, in this order:
  the AFL Tables external identity (`afltables:<external_id>`), else the manual-registration token
  (`manual_admin_edit:<token>`), else an `afl_api` external identity.

Requirements on the rendering, to be fixed at implementation: deterministic; injective (`match_key`
itself contains `|`, so the separator must be one neither part can contain); and decomposable, so
that every authority row of one match can be found from its `match_key`.

**If no stable identity resolves for the player, the save is refused.** That is the fail-closed rule
of §15.2 applied to the key.

Two consequences:

- `carryMatchOverrides` (`src/lib/acquisition/match-rekey.ts:278-326`) moves only
  `entity_type = 'matches'` rows when a match is rekeyed. It must carry the match's
  `player_match_stats` authority rows in the same savepoint, or a rekey orphans them.
- The existing player-key lookup takes `LIMIT 1` with no ordering
  (`data-edits.ts:132-140`). A player with two AFL Tables identities (a renumbered profile) would get
  a non-deterministic key. The new key needs a deterministic choice.

### 17.5 What the settle does with it

- `player_match_stats` leaves the "unrepresentable" set in `manual-authority.ts`. Its verdict is
  answered from rows, as `matches` is. `match_period_scores` and `brownlow_round_votes` keep the
  existing proof.
- The provider snapshot loads the season's active `player_match_stats` authority and resolves each
  key to the `(player_id, match_id)` the applier asks about, inside the settle transaction.
- **Fields under active authority are removed from the automatic proposal** for that row, by the
  mechanism that already removes derived-owned fields (`automaticProposal`,
  `settle-afltables.ts:2223-2236`). The source continues to settle every other field of the row, and
  an identical rerun writes nothing.
- A `lineup` record with `present: false` makes an insert for that key a refusal
  (`manual_authority_conflict`). The applier already asks the authority question for a target that
  does not exist yet (`canonical-apply.ts:1074-1077`).
- An authority record that cannot be resolved or read answers `indeterminate`, which refuses. There
  is no bypass.

Alternative considered and not proposed: refuse the whole row whenever it carries any authority.
Because the corrected field always differs from the source, that would freeze every other field of
the row and produce a refusal every night.

The ownership predicate, the retry rule and the baseline check do not change.

### 17.6 Replay

A `player_match_stats` branch in `replay_admin_overrides`, run after the reload has written
`player_match_stats` and before derived data is rebuilt:

1. **Fail closed first**, over the whole active set, before writing anything: every key must resolve
   to one player and one match. This is the discipline the `players` branch already states
   (`common.py:1187-1190`).
2. Apply each `match_sheet` record's fields to its row.
3. Delete the row for each `lineup` `present: false` record, if the reload created it.
4. Insert the row for each `lineup` `present: true` record, if absent.

A record whose match is legitimately absent from the reload (for example a season not yet loaded)
needs a defined outcome. Proposed: refuse, as in step 1. See §17.11.

### 17.7 How authority is removed or superseded

- **Superseded:** a later Match Sheet save changes the recorded value. The record is updated in the
  same transaction.
- **Removed deliberately:** an explicit "return to source" action per player row on the Match Sheet.
  It sets `is_active = false`, writes its own audit row, and the next settle restores the source
  values. This is the only way a correction stops applying.
- **Never removed by a machine.** The settle and the reload never deactivate a record, including when
  the source later agrees with it.
- **Match deletion.** `deleteMatch` must not leave active authority naming a match that no longer
  exists. Proposed: deactivate the match's records in the deletion transaction, with audit.

### 17.8 Rows owned by `afl_api`

The same contract applies. The applier and the authority provider are shared by both settles, and
the key is a natural identity that does not depend on the owner. A Match Sheet edit does not change
ownership. No `afl_api`-owned `player_match_stats` row exists today, so this is by construction, not
by observation.

### 17.9 Atomicity and failure

The authority upsert runs inside the existing `importSql.begin` transaction in `saveMatchSheet`,
with the row upsert or delete, the derived recompute and the `data_edits` audit row. The match row
is already locked `FOR UPDATE` there.

Any failure to record authority — an unresolvable key, a CHECK violation, a missing grant — throws,
the whole save rolls back, and the administrator sees an error. Nothing inside the transaction
catches it. There is no path where the statistics change and the authority does not.

### 17.10 Deploy-order constraint (a contradiction with the simplest implementation)

The current proof's second condition is that the CHECK admits **none** of the three settle targets
(`manual-authority.ts:264-266`). The moment a migration admits `player_match_stats`, code that is
still deployed answers `indeterminate` for **all three** targets, and the nightly settle refuses
every player statistic, period score and Brownlow round write until the new code is live.

ISSUE-159 (decision D-1) reworked this proof precisely so that widening the CHECK is safe in either
order. Option A must keep that property. Proposed order: ship code that answers correctly both before
and after the CHECK admits `player_match_stats`; apply the migration afterwards. The Match Sheet
write refuses (§17.9) while the CHECK does not yet admit the entity, which is the fail-closed
behaviour the decision requires.

### 17.11 Points that needed a decision (decided 2026-10-02, §15.3)

As raised:

1. Approve the field-filtering behaviour in §17.5 (source keeps settling the uncorrected fields).
2. Approve the two `lineup` forms in §17.3, including making additions durable.
3. Approve "return to source" as the removal mechanism, and deactivation on match deletion (§17.7).
4. Replay outcome when a record's match or player is absent from the reload (§17.6).

As decided:

- Point 1: D-257-1.
- Point 2: D-257-2. It approves durable additions and removals, not the `lineup` record forms.
- Point 3: D-257-3 for "return to source". Deactivation on match deletion was not decided.
- Point 4: D-257-4. Replay refuses, for an unresolved player as for an unresolved match.

### 17.12 Not verified — to establish in the implementation session

- How promotion carries `data_overrides` per entity type, and whether a new entity type needs
  handling in the promotion inventory and checks. Those tools were not read.
- Where in `db:test:rebuild` the new replay branch must run relative to the current-season settle
  stage and the derived rebuild.
- What the AFL API identity-correction tool (ISSUE-238) does to a row that carries authority when it
  moves the row to another player. An authority keyed by player identity would be left behind.
- The tests that pin the CHECK literal set and the `clear` verdict
  (`tests/current-season-import.test.ts`) and what they must become.
- Whether `data_edits` should also start recording old and new values for a Match Sheet save. Today
  `oldValues` is empty.
- The exact `afl_api` player identity available for the key.

### 17.13 Approved direction, unresolved detail

§15.3 approves behaviour. These details are not approved and are implementation or rehearsal work:

- the exact rebuild-stable natural key for the player and the match (§17.4 is a proposal);
- the exact `data_overrides` schema representation (§17.1, §17.2);
- how promotion and rebuild transport the new authority entity (§17.12);
- the exact tombstone representation for a removal (§17.3);
- the exact representation of a durable addition (§17.3);
- the exact reload and replay ordering (§17.6, §17.12);
- the UI presentation, including the wording of the return-to-source action (§17.7);
- the historical correction census, which is separately authorised and has **not** been run.
