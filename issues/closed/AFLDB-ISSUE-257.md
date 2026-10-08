# AFLDB-ISSUE-257 — Match Sheet edits to source-owned player statistics are reverted by the next automatic settle

## 0. Status

- **Status:** Resolved / DEV accepted (2026-10-03). **PROD promotion outstanding** (separate, separately
  authorised sequence; not run). Runbook path after the operator's move:
  `issues/closed/AFLDB-ISSUE-257.md`.
- **Closure summary (2026-10-03).** Implemented across §18–§19: durable `data_overrides` authority for Match
  Sheet corrections to `player_match_stats`, field-scoped settle scoping, replay, Return to source, rekey,
  promotion and ISSUE-238 handling, migration 110 and the rollback guard. Code `92f2bdf6`, `a27f7104`,
  `39a9fed1`; DEV runs `39a9fed1` (BUILD_ID `IvHo-v-Lq-aKwzFe4i2nN`). Closure verdict, evidence classes,
  retained gaps and the Low limitation: §19.5. The sections below are the historical record and are
  preserved as written.
- **Opened:** 2026-10-02.
- **Severity:** Medium.
- **Area:** Admin / data integrity / current-season acquisition — the Data Editor Match Sheet,
  the manual-authority provider and the automatic canonical applier.
- **Review origin:** `playbooks/issue.md`, finding F-001.
- **Operator decisions (2026-10-02, made after the review):** Option A, durable authority
  (D-257-0, §15.2). The direction of the §17 design is approved (D-257-1 to D-257-4 and five
  further constraints, §15.3). Its representation details are not approved: §17.13 lists them as
  implementation and rehearsal work.
- *(Historical, as of 2026-10-02; superseded by the Status above.)* Nothing had been implemented.
  §1–§14 are the review's evidence record as written before the decision; §15–§17 carry the decision and
  the design.
- **Implementation design (2026-10-02, read-only investigation pass, §18).** The open detail of
  §17.12–§17.13 is resolved from source: identity, key, representation, writer, settle, replay,
  promotion, rekey, ISSUE-238 and deployment. §18.12 records where §17 was corrected. One operator
  decision remained: match deletion (§18.11). *(Historical: nothing implemented and no database opened at
  that pass.)*

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

*Updated 2026-10-02 (investigation pass):* §17.12–§17.13 are answered in §18 and the deployment
sequence is §18.13. Next: the operator chooses M1, M2 or M3 for match deletion (§18.11) and confirms
the two flagged behaviours in §18.15; then an implementation session follows §18. The historical
census stays separately authorised.

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

## 18. Implementation design (investigation pass, 2026-10-02; nothing implemented)

Read-only source and design investigation at `3ed70ab1`, in the ISSUE-257 worktree. No database was
opened, no test was run, and no production code, migration or test changed. §1–§17 stand as written;
where this section corrects a §17 proposal, §18.12 says so and §17 is kept as the historical
proposal. Every line reference is to `3ed70ab1`.

Labels used below: **[verified]** read from source this pass; **[design]** proposed
implementation detail derived from verified facts and the approved decisions; **[open]** needs an
operator decision. Where a [design] item changes behaviour an operator may want to see, it says so.

### 18.1 Match durable identity [verified]

- `matches.match_key text NOT NULL UNIQUE` (`src/db/migrations/003_matches.sql:23`). It is the
  five-part rendering `season|round_code|match_date|home club name|away club name`
  (`tools/migration/import_fitzroy_core.py:1880-1884`, mirrored by `renderMatchKey`,
  `src/lib/acquisition/settle-core.ts:174-182`).
- It is **reconstructed, not preserved**: a rebuild re-renders it from source facts and the
  canonical club name. It equals the old key only while those facts are unchanged.
- It changes after creation through exactly one supported operation: a **rekey** of a source-owned
  match whose round or date moved (ISSUE-131). Two callers, both carrying `matches` overrides in
  the same savepoint before the canonical write: `canonical-apply.ts:1121-1137`
  (`carryMatchOverrides`, the settle) and `tools/current-season/repair-match-rekeys.ts:601` (the
  repair tool). `carryMatchOverrides` (`match-rekey.ts:278-326`) moves only
  `entity_type = 'matches'`; refuses when the new key already holds an active row of the same
  `field_group`; reactivates an inactive one; deactivates (never deletes) the old row.
- Other ways a key stops resolving: `deleteMatch` (`src/db/queries/match-admin.ts:397`, which
  today leaves `matches` overrides active); a rebuild whose source revised the round, date or a
  club's canonical name. All three already make an active `matches` override unresolvable, and
  promotion gate A4.3 STOPs on it before the swap (`tools/db/promotion-check.ts:3061-3076`).
- Promotion does not move `match_key` between databases: the candidate's keys are the rebuild's,
  and the target's `data_overrides` are reinstated wholesale and replayed by key (§18.8).

**Conclusion.** `match_key` is the supported durable match identity and the one every existing
match-scoped override already uses. It is unique. It can change only by rekey (which must carry
ISSUE-257 authority, §18.9) or by source revision across a rebuild (which D-257-4 already answers:
the replay refuses). A key can exist before its match resolves in four states: after a deletion
(§18.11), across a rebuild that re-rendered the key, in a settle unit that inserts the match before
its player rows, and on a candidate whose prepared current season lacks the match (ISSUE-252 F2).

### 18.2 Player durable identity [verified]

- **One identity system already exists:** `resolvePlayerIdentity`
  (`src/db/queries/player-identity.ts:83-108`, AFLDB-ISSUE-161 §29: "There is exactly one identity
  system"). It returns `afltables:<profile path>` when the player holds exactly one
  `afltables`/`afltables_profile_url` identity with status `unique`/`resolved`; otherwise
  `manual_admin_edit:<token>` when exactly one manual token is held; otherwise `null`. More than one
  AFL Tables path is refused as `ambiguous_identity`, never chosen. Draft, season lists, club
  leadership, awards and honours all key `data_overrides` through it.
- **It has no `afl_api` arm.** No source creates a player (reconcile gate 4,
  `reconciliation.ts:517-523`); an AFL API identity is only ever linked to an existing player
  (ISSUE-235 ledger). So an AFL-API-only player cannot be created by any supported path, and every
  player a settle can attribute a row to already holds an AFL Tables path or a manual token, unless
  it is a legacy identity-less row.
- The generic editor's player key (`data-edits.ts:130-142`) is **not** this rule: it reads AFL
  Tables only, without the `match_method` filter, with `LIMIT 1` and no ordering, and gives a manual
  player no override at all. It is not reused here.
- A manual player who later debuts gains an AFL Tables path through
  `attachAflTablesIdentityInTransaction` (`src/db/queries/admin-draft.ts:1461-1546`); the token stays
  bound, and replay binds it onto the path-player (`common.py:1253-1262`). From then on
  `resolvePlayerIdentity` returns the path, but a record keyed by the token still resolves to the
  same player.
- The replay already resolves a prefixed identity generically: `split_part(identity, ':', 1)` is
  the `sources.key`, the remainder the `external_id`, status `unique`/`resolved`, and exactly one
  distinct player (`common.py:1589-1597`, draft branch).

**Algorithm [design].** At write time, `resolvePlayerIdentity(tx, playerId)` inside the Match Sheet
transaction, verbatim. Refuse the save (before the first write) when it returns `null`
(identity-less legacy player), refuses as ambiguous, or returns a string containing `|`. At
resolution time (settle snapshot, replay, promotion prediction), the inverse: source key and
external id split at the first `:`; for `afltables` also `match_method = 'afltables_profile_url'`
(the writer's own filter); status `unique`/`resolved`; exactly one distinct non-null `player_id`,
else unresolved. The writer, the settle snapshot, the Python replay and the promotion predictor
must share one corpus-driven parity test (precedent: `tests/special-records-replay-parity.test.ts`).

Deterministic and injective: the writer accepts only a single-valued answer, and the two prefixes
are disjoint source keys. Rebuild-stable: AFL Tables paths are source-carried and manual tokens are
reinstated by `replay_admin_overrides('players')`; promotion A4.2 already STOPs on a token the
candidate cannot reinstate. Provider-neutral: the identity names the person, not the row owner.

**Identity form change.** Because a player can hold both forms, the writer looks up existing
ISSUE-257 records under **both** of the player's current forms. One record set found: it is updated
in place under the key it already has. Records under both forms: refuse as ambiguous authority.
None: create under the form `resolvePlayerIdentity` returns. The settle snapshot and the replay
preflight treat two active records that resolve to the same `(player, match)` as unresolved
(fail closed).

### 18.3 The `entity_key` [design]

```
entity_key = <match_key> || '|' || <player identity>
```

- Decoded at the **last** `|`: the match half is everything before it, the player identity
  everything after. This is the existing match-scoped convention, `match_coaches`
  (`<match_key>|<club_slug>`, `src/db/queries/admin-coaches.ts:46-48`), decoded the same way by
  `decodeMatchCoachKey` (`tools/db/promotion-inventory.ts:4385-4391`) and its replay branch.
- **Why `match_key` containing `|` is safe.** The player identity can never contain `|`: an AFL
  Tables path the admin surface accepts matches `^players\/[A-Z]\/[A-Za-z0-9_'.-]+\.html$`
  (`admin-draft.ts:180`), a token is a `randomUUID()`, and the writer refuses any identity string
  containing `|` as a forward guard (as migration 102 refuses a colon-bearing record id). With no
  `|` in the suffix, the last separator is the only possible split point, so
  `(match_key, identity) -> key` is injective and decoding is exact.
- **All records of one match** (rekey, deletion, settle snapshot): `entity_type =
  'player_match_stats' AND starts_with(entity_key, $mk || '|') AND strpos(substr(entity_key,
  length($mk) + 2), '|') = 0`. The second predicate excludes a longer key that merely shares the
  prefix (match key `A|B` against a record of `A|B|C`). Not a `LIKE`, so `%` and `_` in a club name
  are inert.
- No database-local id. Season is recoverable with `seasonOfMatchKey`
  (`promotion-inventory.ts:4393-4397`).

### 18.4 `data_overrides` representation [design; no new column]

Verified contract: columns `id, entity_type, entity_key, field_group, override_values jsonb,
is_active, admin_user_id, created_at, updated_at`; `UNIQUE (entity_type, entity_key, field_group)`;
partial index on `(entity_type, entity_key) WHERE is_active` (migration 073); `afldb_import` holds
`SELECT`, `INSERT` on seven columns, `UPDATE (override_values, admin_user_id, is_active,
updated_at)` and the sequence (migration 078; `privileges.sql:323-332`). `is_active` is
entity-specific: for `matches` false means withdrawn (and `carryMatchOverrides` deactivates the
row it moves away from); for `season_list_members` false **is** the tombstone (migration 096).

The only schema change is widening the `entity_type` CHECK to add `player_match_stats`, with its
constraint comment rewritten (it currently forbids admitting any settle target).

Two field groups per `entity_key`, at most one row each:

| `field_group` | `override_values` | Meaning |
|---|---|---|
| `match_sheet` | flat delta: column name -> value; `club_slug` stands for `club_id` | these fields are humanly decided |
| `lineup` | `{"present": true}` or `{"present": false}` | durable addition / durable removal |

`is_active = false` on either row means **no authority: the source governs** (withdrawn by Return
to source, or moved away by a rekey carry). It is never a tombstone for this entity, because this
entity has a settling source and "removed" must stay distinguishable from "returned to source".

**A. Field authority.** The admissible keys are the Match Sheet's twelve columns. Key presence is
authority; JSON `null` is an explicit "not recorded"; an absent key carries none (the 086 /
migration-102 `correction` discipline). Changed fields are computed per player against the
locked pre-image (§18.5); a missing row's pre-image is all-null, so one rule serves updates and
additions. Two rules beyond §17.2:

- **Coupled triple.** `disposals = kicks + handballs` is enforced by the Match Sheet validator
  (`src/lib/match-sheet.ts:181-191`) and by nothing in the schema (`004_player_match_stats.sql`).
  Protecting one of the three and letting the source settle another could leave a row whose
  disposals no longer sum. If any of the three changes, all three are recorded with their saved
  values, and the settle protects all three. This is the D-257-1 fail-closed rule applied to fields
  that cannot be told apart safely.
- **Club.** Stored as `club_slug` (tracked reference data, the existing payload convention);
  resolution requires exactly one club and that it be the match's home or away club, else
  unresolved.

A later save merges: existing keys are kept, changed keys overwrite. A field changed back to the
source's value is recorded with that value and stays authoritative (D-257-3). An unknown key in a
payload makes that record unreadable, which fails closed.

**B. Durable addition.** A save that creates a row for a player with no row records `lineup
{"present": true}` and a `match_sheet` record holding the non-null entered fields and `club_slug`.
Null-entered fields carry no authority, so a source that later supplies the row is not frozen by
blanks. The row is written with `source_id` NULL, as today: the settle refuses an unowned row on
ownership (`canonical-apply.ts:126-148`) and never deletes a `player_match_stats` row, so an
addition already survives settles; the record is what makes it survive a rebuild. Ownership is not
changed.

**C. Durable removal.** A save that deletes a row records `lineup {"present": false}` and
deactivates that key's `match_sheet` record in the same transaction (stale field authority must not
revive on a later re-add). Re-adding the player reactivates `lineup` with `present: true`.

**D. Return to source.** Per player row: set `is_active = false` on every active record of the key
(both groups), in one transaction with its own `data_edits` row. No canonical value is written,
with one exception: when the row was a durable addition and is still unowned (`source_id IS
NULL`), the row is deleted, because it exists only by the decision being withdrawn and no source
can adopt it (after a rebuild it would not exist either). An operator may want to confirm this
exception; without it, a returned addition persists live and silently disappears at the next
rebuild.

### 18.5 Match Sheet transaction [design]

Verified today (`src/db/queries/match-sheet.ts`): one `afldb_import` connection; one
`importSql.begin`; match row `FOR UPDATE` (`:58-69`); existing rows read as player ids only, no lock
(`:90-94`); removals deleted (`:98-104`); **every** submitted player upserted, all twelve columns
(`:107-137`); derived recompute (`:145`); one `data_edits` row with empty `oldValues` (`:149-157`);
errors throw and roll back (`:167-169`). The editor builds its state from the page load and posts
the whole sheet (`MatchSheetEditor.tsx:60`, `:245`); the validator turns an absent field and a
null into the same null (`src/lib/match-sheet.ts:166-171`).

**Missing before-state.** The writer has no pre-image of the values, and it cannot tell what the
administrator changed from what the page merely re-posted. If a settle wrote between page load and
save, comparing the post with the current row would record the stale page values as durable
authority over the source's newer values. Required: (1) a locked read of the match's rows,
`SELECT player_id, club_id, jumper_number, <ten statistics>, source_id FROM player_match_stats WHERE
match_id = $1 FOR UPDATE`; (2) a per-row baseline echoed by the editor (the values it rendered, or
a hash of them, in the settle's `baselineCanonicalHash` style), compared with the locked rows; any
mismatch, or a removed or edited row that no longer exists, refuses the whole save as stale.

**Order, one transaction:**

1. Validate the payload (unchanged validator plus the baseline shape).
2. `BEGIN`. Lock the match row `FOR UPDATE` (as today); read `match_key` with it.
3. Club check (as today). Lock and read the match's `player_match_stats` rows.
4. Stale check against the baselines.
5. Compute, per player: changed fields (with the coupled triple), addition, removal, or nothing.
6. For every player with a change, removal or addition: `resolvePlayerIdentity`; refuse on
   null, ambiguity or `|`. Read that match's existing ISSUE-257 records (§18.3 query) and refuse on
   a record set under two identity forms.
7. Canonical writes: delete removed rows; upsert only rows with a change or an addition.
8. Authority writes: `INSERT … ON CONFLICT (entity_type, entity_key, field_group) DO UPDATE` with
   the merged payload and `is_active = true`; `UPDATE … SET is_active = false` for a removed key's
   `match_sheet` record.
9. `recomputePlayerDerivedStats` (as today).
10. `recordDataEdit`, `tableName 'matches'`, `fieldGroup 'match_sheet'` (ISSUE-238's L8-d recognises
    exactly this shape, `correct_afl_api_identity.ts:3161-3162`), now with per-player old and new
    values and the authority keys written.
11. `COMMIT`. The activity audit and `revalidatePath` stay after the transaction, as today.

Any refusal after the first write is thrown, never returned: `postgres.js` commits when the
callback resolves (`admin-season-lists.ts` header, the ISSUE-160 defect). Nothing inside catches.
So the sequence "statistics change, authority write fails, commit" cannot occur: a CHECK
violation (§18.13 State A), a missing grant, an unresolvable identity or a merge conflict each
throws and rolls back steps 7–10 with it. A save that changes nothing writes no authority and
still succeeds.

Per case: **field update** steps 5–10 with a `match_sheet` upsert; **addition** adds the `lineup`
upsert; **removal** deletes the row, upserts `lineup {present:false}`, deactivates `match_sheet`;
**authority update** is the same upsert, merging into the existing payload; **Return to source**
is its own action, same skeleton: lock the match, resolve identity forms, read active records,
refuse when there are none, deactivate them, delete an unowned addition row (§18.4 D) and
recompute, write `data_edits` (`fieldGroup 'match_sheet_return_to_source'`, the withdrawn payloads
in `oldValues`; `field_group` has no CHECK, `057_data_edits.sql:20`), commit.

Every writer of ISSUE-257 authority for a match (Match Sheet, Return to source, rekey carry,
`deleteMatch`) already holds or takes that match row `FOR UPDATE`, so no lock on `data_overrides`
is needed.

### 18.6 Settle behaviour [design]

Verified: authority is consulted in three places, all fed by `loadManualAuthority`:
`reconcile()` gate 8 (`reconciliation.ts:576-598`, asked with every field that differs from the
canonical row); the applier's E4 (`canonical-apply.ts:1076-1103`, loaded per unit inside the
savepoint at `:977`); attendance enrichment (`:1345`, `matches` only). The AFL Tables settle feeds
`reconcile()` the **full** proposal (`settle-afltables.ts:2072-2092`) and strips derived-owned
fields only afterwards, for the invitation and the applier (`:2166-2197`, `:2344`). The AFL API
settle has no `reconcile()` on its automatic path; it applies `automaticProposal` itself
(`settle-afl-api.ts:1747-1764`), imported from `settle-afltables.ts`. Both settles pass
`targetKey {player_id, match_id}` for this table (`settle-afltables.ts:3079`, `:3096`;
`canonical-apply.ts:585`). The verdict is whole-target.

**§17.5 is not sufficient as written.** A protected field always differs from the source. Gate 8
would therefore refuse the whole row whenever the payload moves, no candidate would exist, and
`invitationFor` offers nothing for a refusal, so an unrelated field would never settle — the
outcome D-257-1 forbids. Filtering through `automaticProposal` alone is downstream of that gate.

Narrowest shared design:

1. **Snapshot.** `loadManualAuthority` also reads the season's active `player_match_stats`
   records (season = first match-key component), decodes and resolves them in SQL inside the
   caller's transaction, and builds `(player_id, match_id) -> { protected fields, presence }`.
   An unknown payload key, an unresolved identity, match or club, or two records for one pair
   marks that record's **match** `indeterminate`. A key that cannot be decoded names no match, so
   it makes every `player_match_stats` answer `indeterminate`; an unreadable query keeps today's
   whole refusing provider.
2. **Verdict.** `player_match_stats` leaves `UNREPRESENTABLE_OVERRIDE_ENTITIES` and is answered from
   rows, like `matches`: `indeterminate` when its match is marked; `conflict` when presence is
   `removed`, or a queried field is protected; otherwise `clear`. No records: `clear`, today's
   answer. `match_period_scores` and `brownlow_round_votes` keep the CHECK proof unchanged.
3. **One shared scoping helper**, next to `automaticProposal` and used by both settles: the
   proposal minus protected fields. The AFL Tables settle applies it **before `reconcile()`** for a
   resolved target, so gate 8, the human candidate, the invitation and the baseline see one field
   set (the `DERIVED_OWNED_FIELDS` principle, `settle-afl-api.ts:1736-1742`). A removed key keeps
   its full proposal for `reconcile()` (a new target has no gate 8 and an empty new-target proposal
   is a hard failure, `reconciliation.ts:533-535`), but its automatic proposal is empty, so no
   invitation is offered and no nightly refusal is opened. The AFL API settle applies it inside its
   `automaticProposal` call, so an empty result closes the unit exactly as today
   (`:1761-1765`).
4. **Applier enforcement (E4).** The per-unit snapshot is fresh, so a correction committed after
   planning is caught here: subtract its protected fields from `changedFields` before the verdict;
   an empty remainder is `nothing_to_write`; a removal refuses an insert as
   `manual_authority_conflict`; an indeterminate match refuses. Ownership (E3), the baseline (E5)
   and the retry rule are untouched.
5. **Race.** The applier reads the row without a lock (`canonical-apply.ts:580-584`) and writes
   with a plain `UPDATE … WHERE id` (`:848-851`), and the authority is loaded before the read. A
   Match Sheet save committing between them would be overwritten — exactly this defect, in a
   window. Close it by taking `SELECT … FROM matches WHERE match_key = $1 FOR SHARE` for a unit with
   a `player_match_stats` target **before** loading the authority. The Match Sheet takes the same
   row `FOR UPDATE` first, so both sides lock match then rows (no new deadlock order); a save may
   wait for a running settle to commit (set a `lock_timeout` and refuse with a clear message).

The source's value for a protected field is no longer proposed to a human reviewer; its
observation and projection are still recorded. Ownership, retry and baseline semantics do not
change. `tests/current-season-import.test.ts:3843-3912` pins the old set and must change (§18.14).

### 18.7 Replay [design]

Verified callers and order: the fitzRoy core reload replays `players`, `season_list_members`,
`club_leadership` after its players group, `matches` and `fixtures` after its matches group, and
**nothing** after its `stats` group (`import_fitzroy_core.py:3519-3567`), whose delete-and-COPY
commits inside `import_player_match_stats` (`:3125-3159`). `db:test:rebuild` replays no general
overrides: it reinstates captured manual-registration records only (`rebuild-test.ts:998-1021`);
`afldb_test` holds no other authority. Promotion replays every branch post-swap in one fixed
tuple and one transaction (`docs/production-promotion.md:1339-1366`), after the ISSUE-238 replay
(§7.4e) and before `rebuild_derived.py` (`:1547`). Precedent for replaying inside the load
transaction, pinned by a test: `after_siren.py:1051-1058`,
`tests/data-overrides-source-contract.test.ts:1463-1468`.

New branch `replay_admin_overrides(pg, "player_match_stats")`, over the whole active set:

1. **Preflight, before any write**, in one query: every active record decodes; its match resolves
   to exactly one match; its identity to exactly one player (§18.2); `club_slug` to the home or
   away club; payload keys are admissible; no two records resolve to one pair. Any failure raises,
   naming every offending `entity_key` (D-257-4).
2. Delete the row of every active `lineup {present:false}` key.
3. Insert the row of every active `lineup {present:true}` key that has none (`source_id` NULL).
4. Apply every active `match_sheet` payload by key presence. A field record whose row is still
   absent (no addition behind it) raises: the source no longer carries a row a human corrected, and
   that is not silently dropped (the migration-102 `correction` rule).
5. Inactive records are ignored.

Placement: **fitzRoy reload** — preflight before the `stats` group's `DELETE`, steps 2–4 after the
COPY and before `pg.commit()`, inside `import_batch`, so a refusal rolls the reload back. Requires
the players and matches groups' state. **Promotion** — in the §8.1 tuple after `players` and
`matches`, followed by `rebuild_derived.py` (already required there). **db:test:rebuild** — none.
**Current-season settle** — not a reload; §18.6 governs. **Promotion source preparation** — runs on
`afldb_test`, which holds no target authority, so none.

The preflight sees the whole set before the first write, and both callers run inside one
transaction, so no partial mutation survives a refusal. No savepoint is needed.

### 18.8 Promotion [verified + design]

`data_overrides` is a `reinstate`/`compare: equal` production-owned table
(`promotion-inventory.ts:557-563`): dumped from the target, restored into the candidate, replayed
after the swap. A new entity type rides that transport unchanged. What does not:

- **A4.3** reads only `players`, `matches`, `match_coaches` (`promotion-check.ts:2921-2927`).
  Add an **A4.4** prediction at `--phase restored` and `--phase candidate`: for every active
  ISSUE-257 record, the match resolves on the candidate, the identity resolves as the players
  replay will leave it (A4.2's plan, ISSUE-242 convergence included), the club resolves, and a
  field record's row exists unless an addition covers it. At `--phase candidate` it reads the
  candidate after §7.4e, so ISSUE-238 replays are already reflected. A failure is a pre-swap STOP.
- **F2** (ISSUE-252) covers `matches` and `match_coaches` only
  (`promotion-source-dependencies.ts:75-79`, `:147-151`, `:262-270`). Extend `overrideMatchKeyOf`
  and the F2 SQL to the match half of an ISSUE-257 key, so a current-season match a record names
  must exist in the prepared source with the same owner.
- **§8.1** replay tuple and the inventory's replay note (`promotion-inventory.ts:4477`) gain the
  branch; `promotion-convergence-rehearsal.ts:225` counts "replayable" types and should include it.
- No manifest schema, fingerprint or privilege change: `data_overrides` is compared as a whole
  table, not by entity type.

### 18.9 Rekey carry [design]

Extend `carryMatchOverrides` (or add a sibling called from the same two places, inside the same
savepoint, before the canonical write) to move every active ISSUE-257 record of the old match
(§18.3 query) to `<new match_key>|<identity>`, per `field_group`, with its existing rules: an active
row at the new key refuses the rekey (`rekey_override_conflict`), an inactive one is reactivated,
the old row is deactivated. Moving the match and its authority is then atomic. The settle's
per-unit snapshot needs no change: a rekey keeps `matches.id`.

### 18.10 ISSUE-238 interaction [verified + design]

What ISSUE-238 changes: for an `afl_api`-owned closure row, either MOVE (re-point `player_id` from P
to P′) or DELETE as a foreign collision (`afl-api-identity-correction.ts:607-636`). It changes the
canonical `player_id`, the identity and the projections; the row stays the same provider fact
re-attributed. A Match Sheet edit before the correction normally STOPs it: mutation eligibility P7
refuses any value that differs from the ledger reconstruction (`:277-297`), over a contract field
set that covers all twelve Match Sheet columns (`:217-224`). After the correction, a `match_sheet`
audit explains a divergence (L8-d).

**Reachable residue.** A record whose values equal the reconstruction (a field changed and later
changed back, which D-257-3 keeps authoritative), or a `lineup` record, passes P7. A MOVE would leave
the record on P: a field record then names a row that no longer exists, and the next replay
refuses. Carrying it is not safe either: a field correction belongs to the moved row (P′), while a
removal of P is still true of P.

**Resolution [design].** ORIGINAL mode STOPs (new stop, e.g. `manual_authority_present`) when any
active ISSUE-257 record resolves to `(P, M)` or `(P′, M)` for a match M of a MOVE or DELETE closure
row, read inside the correction transaction after its closure-row locks. No automatic carry. The
operator returns those rows to source and re-applies a correction after the identity is fixed.
REPLAY modes do not STOP: by construction no such record existed at the original correction, a
later record keyed to P′ is expected and applies at §8.1 after the MOVE, and A4.4 at `--phase
candidate` catches any remaining mismatch before the swap. Not a conflict between the two issues:
ISSUE-238 still corrects, ISSUE-257 authority is never silently orphaned.

### 18.11 Match deletion — options for the operator [open]

Verified: `deleteMatch` locks the match `FOR UPDATE`, refuses while the match carries a Brownlow
entry, curated special records, staging links, period statistics or lineup links (`:422-597`),
otherwise deletes `player_match_stats`, period scores and the match, recomputes and audits
(`match_deletion`, `:634-655`). It does not touch `data_overrides`: an active `matches` override
survives, and A4.3 then blocks every promotion until it is resolved.

- **M1 — withdraw with the deletion.** The delete transaction deactivates the match's ISSUE-257
  records and lists them in the `match_deletion` audit. Rebuild and promotion are never blocked.
  If the source re-creates the match (a settle-owned current-season match will be re-inserted),
  its rows return with source values and the corrections are gone; recovering them means
  re-entering them from the audit. Consistent with D-257-3 if deletion counts as an explicit
  removal of authority. Differs from today's `matches` overrides, which survive deletion.
- **M2 — retain.** Records stay active. Under D-257-4 every fitzRoy stats reload and every
  promotion (A4.4 pre-swap) refuses while the match is absent; the settle marks the key
  indeterminate. If the source re-creates the match under the same key, the corrections apply again
  automatically, which protects against an accidental deletion. Withdrawing them needs a Return to
  source surface that works without the match. Consistent with today's `matches` overrides.
- **M3 — refuse the deletion.** `deleteMatch` refuses while the match has active ISSUE-257
  records and names the rows; the operator returns them to source first (each audited under
  D-257-3), then deletes. Nothing is withdrawn implicitly and nothing is orphaned. This is the
  shape `deleteMatch` already uses for every other durable decision attached to a match. Cost: more
  steps for a deliberate deletion.

### 18.12 Corrections to §17.1–§17.10

| § | Proposal | Finding |
|---|---|---|
| 17.1 | no new grant; no DELETE | Confirmed (migration 078, `privileges.sql:323-332`). The `manual-authority.ts:11` remark that `afldb_import` cannot read `data_edits` is stale since migration 108; immaterial, because `data_edits` stays evidence, not authority. |
| 17.2 | twelve fields, diff against the row in the transaction | Incomplete: the triple `kicks`/`handballs`/`disposals` is one unit; `club_id` stored as `club_slug`; the diff needs the page-load baseline and a stale refusal (§18.4 A, §18.5). |
| 17.3 | `is_active = false` already means "withdrawn" on this table | Not table-wide: it is the tombstone for `season_list_members`. The conclusion stands for a different reason (§18.4). Addition authority holds only non-null entered fields; a removal deactivates the field record. |
| 17.4 | player identity: AFL Tables, else manual token, else `afl_api`, "the identity the generic editor already uses" | Disproved. The canonical rule is `resolvePlayerIdentity`, with no `afl_api` arm; the generic editor uses neither it nor that order. Rendering decided in §18.3. |
| 17.5 | filter through `automaticProposal` | Insufficient: gate 8 sees the full AFL Tables proposal; scoping must precede `reconcile()`, and the applier must re-enforce it from the fresh snapshot; plus the settle race (§18.6). |
| 17.6 | replay after the reload writes rows, before derived | The fitzRoy stats group commits inside its importer: the replay must run inside that transaction. `db:test:rebuild` has no such replay; the lifecycle that matters is promotion §8.1 and the fitzRoy reload (§18.7). |
| 17.7 | deactivate on match deletion | Still open; three options in §18.11. |
| 17.8 | `afl_api` rows by construction | Consistent with §18.6. Whether any `afl_api`-owned row exists was not measured (no database read). |
| 17.9 | atomicity inside `importSql.begin` | Confirmed, with the ordering in §18.5. |
| 17.10 | old code answers `indeterminate` for all three once the CHECK admits the entity | Confirmed at `3ed70ab1` (§18.13). |

### 18.13 Deployment [verified + design]

**The claim, proven.** With the deployed code, `loadManualAuthority` reads the live CHECK
(`manual-authority.ts:290-295`); if it admits `player_match_stats`, condition 2 fails (`:264-266`),
`overrideScopeProven` is false, and every `match_period_scores`, `player_match_stats` and
`brownlow_round_votes` query answers `indeterminate` (`:194-197`): the nightly settle refuses all
three families.

**New code under either schema.** It removes `player_match_stats` from the unrepresentable set and
answers it from rows; the CHECK proof keeps guarding the other two, and admitting
`player_match_stats` does not touch it.

| Application | Schema (CHECK) | Safe? | Reason |
|---|---|---|---|
| old | old | yes (defect present) | today |
| new | old (State A) | yes | no records can exist, so the settle answers as today; the one difference is that `player_match_stats` no longer depends on the CHECK being readable (it is answered from rows, as `matches` is); Match Sheet saves that change anything fail closed on the CHECK; Return to source, carry, replay, A4.4, ISSUE-238 STOP find no records |
| new | new (State B) | yes | full behaviour |
| old | new, zero records | **no** | old proof makes all three targets `indeterminate`: the settle refuses unrelated work (forbidden by §15.3) |
| old | new, records exist | **no** | as above, and the old Match Sheet edits rows without updating their authority (the next replay reverts the newer edit), and the old replay silently skips the records (D-257-0, D-257-4) |

**Sequence.** (1) Ship all new code together: TypeScript (writer, settle, applier, carry,
promotion tools, ISSUE-238 STOP) and `common.py` (replay branch, fitzRoy call). (2) Confirm
State A on DEV: nightly settle unchanged; a Match Sheet change refuses with a clear message.
(3) Apply the migration (State B), then DEV acceptance (§18.14). (4) Repeat on PROD. The Match
Sheet cannot record a change between (1) and (3), so keep that window short.

**Rollback.** Code rollback is safe only from State A. From State B, roll the schema back first:
re-adding the narrow CHECK validates existing rows, so it fails unless no `player_match_stats` row
(active or not) exists, which makes the guard mechanical. Once the first record exists, there is no
safe rollback below this release: roll forward only. That cannot be fixed by compatibility code,
because the released code that would have to tolerate the new schema is already fixed. The
deployment runbook must say so and require a read-only count before any rollback.

### 18.14 Tests and rehearsals (design only; extend existing suites)

**DB-free.**

- `tests/match-sheet.test.ts`: changed-field calculation; unchanged rows and fields record
  nothing; explicit null versus untouched; the coupled triple; `club_slug`; stale baseline refusal;
  addition and removal payloads.
- `tests/current-season-import.test.ts`: key encode/decode, including a `match_key` with extra
  `|` and the prefix-sharing case; identity selection (path, token, both, ambiguous, none, `|`);
  verdicts (no authority, one field, unrelated field, removal, withdrawn, unresolved,
  duplicate-pair); the scoping helper and `automaticProposal`; `invitationFor` with a protected
  field and with a removal; CHECK before and after the widening (period scores and Brownlow stay
  `clear` in both). Lines 3843-3912 change: the CHECK fixtures gain a post-ISSUE-257 literal set,
  and the loops over `UNREPRESENTABLE_OVERRIDE_ENTITIES` cover two entities.
- `tests/data-overrides-source-contract.test.ts`: the new replay branch's preflight precedes any
  write; the fitzRoy stats replay runs after the COPY and before `pg.commit()` (the after-siren
  assertion shape); the promotion doc's §8.1 tuple contains the branch after `players` and
  `matches`.
- A TS/Python parity corpus for decode and identity resolution, extending
  `tests/special-records-replay-parity.test.ts` with a new fixture file.
- `tests/db-promotion-check.test.ts`: A4.4 planner and F2 extension.
- `tests/afl-api-identity-correction.test.ts`: the ORIGINAL-mode STOP; REPLAY does not STOP.

**Integration (`afldb_test`).** `tests/integration/settle-afltables.test.ts`: a field correction
survives an unchanged-source settle; an unrelated field still updates; a removal blocks the
retry/insert; an addition survives; Return to source lets the source value back; the
indeterminate match. `tests/integration/settle-afl-api.test.ts`: the same for an `afl_api`-owned
row, if a valid fixture can be built. `tests/integration/data-editor.test.ts`: the atomicity
cases (authority failure and unresolvable identity each roll back the row change); stale save;
identity-form change. Rekey carry beside the existing `rekey_override_conflict` /
`overridesCarried` cases in `tests/integration/settle-afltables.test.ts`.
`tests/integration/match-admin-delete.test.ts`: the chosen M option. Replay: after a reload, field, addition and removal records re-apply and an
unresolved record refuses before any write.

**`code_test_db`.** Only what needs the real lifecycle: migration sequencing through State A to
State B with a live settle in each; a promotion rehearsal carrying records through reinstatement,
A4.4, §8.1 and a post-swap settle.

**DEV acceptance.** One Match Sheet correction to a settle-owned current-season row; one on-demand
settle; the corrected field unchanged and an unrelated source field still settleable; then Return
to source and one settle restoring the source value. **PROD:** no mutation required.

**Historical census.** Still not authorised and not run. When authorised: `data_edits` rows with
`table_name = 'matches' AND field_group = 'match_sheet'`, joined by match to later
`canonical_applications` updates of `player_match_stats` rows of that match. Because today's audit
holds no per-player values, it can only find candidates, not prove a reversal.

### 18.15 Readiness

Designed: match identity, player identity, key, representation, writer, settle, replay, promotion,
rekey carry, ISSUE-238 interaction, deployment and rollback. Open: the match-deletion choice
(§18.11), which gates only the `deleteMatch` change. Two [design] behaviours an operator may want
to confirm: deleting an unowned addition row on Return to source (§18.4 D), and roll-forward-only
after the first record (§18.13). Not measured (needs an authorised read): whether any
identity-less legacy player has `player_match_stats` rows, which the Match Sheet would now refuse
to record a change for.

## 19. Implementation session (2026-10-02 onward)

### 19.1 Identity census on `afldb_dev` (operator-authorised, read-only)

Observed 2026-10-02 21:18:17 +10 as `afldb_import`, `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE
READ READ ONLY`, `current_database()` guard, `ROLLBACK`. The SQL mirrors `resolvePlayerIdentity`
(`src/db/queries/player-identity.ts:83-108`). DEV was not mutated.

| Population | Players | `player_match_stats` rows |
|---|---|---|
| All seasons | 13,363 | 695,499 |
| AFL Tables identity (one path) | 13,359 | 694,890 |
| Manual token only | 0 | 0 |
| Unresolved (no identity, or >1 token) | 0 | 0 |
| Identity containing `\|` | 0 | — |
| Ambiguous (>1 AFL Tables path) | 4 | 609 |
| 2026 (218 matches, last 2026-09-26) | 669 | 10,028 |
| 2026, AFL Tables / manual / unresolved / ambiguous | 665 / 0 / 0 / 4 | 9,957 / 0 / 0 / 71 |

- 92 players hold both an AFL Tables path and a manual token, so the D-257-8 reuse case is real.
- No `afltables` or `manual_admin_edit` identity maps to more than one player.
- `data_overrides` by entity type (rows/active): `after_siren_kicks` 2/2, `award_winners` 4/4,
  `club_leadership` 4/4, `coaches` 2/0, `draft_picks` 1/1, `fixtures` 3/3, `matches` 1/0,
  `player_achievements` 3/3, `players` 95/95, `season_list_members` 4/4. No `player_match_stats`.
- The four ambiguous players are the ISSUE-136 `profile_url_continuity` pairs tracked in
  `fitzroy-contract.json`: 2604 `Charlie_Cameron` + `Charlie_Cameron3`; 6292 `Jack_Graham` +
  `Jack_Graham2`; 6519 `Jack_Ross` + `Jack_Ross3`; 6619 `Jack_Williams` + `Jack_Williams3`. All are
  `unique` / `afltables_profile_url`. This is deliberate continuity, not a defect; ISSUE-233 already
  folds them (`issues/closed/AFLDB-ISSUE-233.md` §4.11).
- **Conclusion.** No material current-season unresolved population. The four-player ambiguous
  population is covered by D-257-9. Implementation continues.

### 19.2 Operator decisions D-257-5 to D-257-9 (2026-10-02)

- **D-257-5 — match deletion is M3, refuse.** `deleteMatch` refuses while any active
  `player_match_stats` authority exists for the match, before any destructive write, and says that
  the durable Match Sheet authority must first be relinquished through Return to source for the
  affected player rows. No auto-deactivation, no authority retained against a deleted match, no
  silent discard. Closes §18.11.
- **D-257-6 — Return to source for a manual addition.** When active authority records a manual
  addition and the canonical row is still the corresponding unowned manual addition, one
  transaction (1) withdraws the active `match_sheet`/`lineup` authority, (2) deletes that canonical
  row, (3) recomputes derived statistics, (4) audits. If the source does not supply a row, none
  remains; a later settle may insert it normally. If the row has acquired source ownership, changed
  provenance or otherwise no longer matches the expected manual-addition state, the operation
  **refuses** rather than deletes. Confirms §18.4 D.
- **D-257-7 — roll forward only after the first record.** Before the first `player_match_stats`
  authority record, rollback may restore the old CHECK and then the old application. Once at least
  one such row exists (active or not), the old application is not a supported rollback target. The
  deployment and rollback procedures must test `count(*) FROM data_overrides WHERE entity_type =
  'player_match_stats'` explicitly. Confirms §18.13.
- **D-257-8 — stable-key reuse across identity upgrades.** The key of an existing decision does not
  change because the preferred identity later changes. Per (match, player): discover the existing
  ISSUE-257 records whose stored identity resolves to that player; exactly one identity form holds
  them → reuse it; none → mint with the current canonical identity (per D-257-9); more than one form
  → refuse as ambiguous, for operator repair. A stored key is resolved by the identity it encodes,
  never by string equality with today's preferred identity.
- **D-257-9 — multi-path players fold through the tracked continuity rule.** Amends §18.2: one AFL
  Tables path → use it; exactly two paths matching exactly one tracked `profile_url_continuity` rule
  → that rule's `continuing_url`; any other multi-path state → refuse as ambiguous; malformed
  continuity data → fail closed. The existing validated loader and classifier are reused, with no
  second mapping. The same folded contract applies to the writer, the settle's authority
  resolution, replay and promotion preflight, with TS↔Python parity coverage. Both sides of a pair
  must resolve to the same player on reverse resolution; split, missing or ambiguous states refuse.
  Manual-token fallback and D-257-8 are unchanged.
- **D-257-6 refined — F-PR-03 resolution (operator, 2026-10-02).** Supersedes the refusal branch of
  D-257-6 for a source-owned addition row. Return to source on a manual addition:
  - canonical row still unowned (`source_id IS NULL`) → withdraw both authority records
    (`match_sheet`, `lineup`), delete the row, recompute derived statistics, audit;
  - canonical row has since become legitimately source-owned → withdraw both authority records and
    **keep** the row; normal source authority resumes from then;
  - any other unexpected provenance or identity mismatch → refuse (fail closed).
  Principle: the operator must never be trapped with authority they cannot deliberately relinquish.
  Return to source removes the manual decision; whether the row remains depends on whether a source
  now legitimately owns the fact. Required tests, DB-free and in the `afldb_test` integration set:
  (1) addition still unowned → withdraw + delete; (2) addition became source-owned → withdraw +
  retain.

### 19.3 Plan review at launch (afldb-reviewer, 2026-10-02): PROCEED, no CRIT/HIGH

Six MED items, resolved as follows before the slices they touch:

- **F-PR-01 (fold location).** `resolvePlayerIdentity` stays untouched; it still serves draft,
  season lists, club leadership, awards and honours. ISSUE-257 gets its own resolver that reads the
  same `external_identities` rows and manual token and passes them to the existing
  `classifyAflApiForwardIdentityRows` (`src/lib/acquisition/afl-api-adjudication.ts:1601`) with
  rules from `loadFitzroyProfileContinuityRules`
  (`src/lib/acquisition/fitzroy-profile-continuity.ts:163`). Python reuses
  `load_profile_continuity_rules` (`tools/migration/import_fitzroy_core.py:1362`) and
  `stable_afltables_identity` (`build_brownlow_season_artefact_from_afl_api.py:880`); replay needs
  only reverse resolution (path → player).
- **F-PR-02 (runtime contract path).** The Next-runtime writer passes an explicit
  `process.cwd()`-based contract path (the `admin-draft.ts` `loadJson` precedent) rather than relying
  on `import.meta.url` inside a bundle. DEV acceptance adds a State B save on one of the four
  multi-path players.
- **F-PR-03 (D-257-6 versus D-257-3).** As first written, D-257-6 made a source-owned addition row
  refuse Return to source, so after a fitzRoy reload in which the source now carries that player
  the `lineup {present:true}` record could not be withdrawn. **Resolved by the operator
  (2026-10-02):** the reviewer's alternative is adopted — withdraw both records and keep the
  source-owned row. Recorded as "D-257-6 refined" in §19.2.
- **F-PR-04 (afldb_test migration reversal).** The reversal is: drop the widened constraint; delete
  `player_match_stats` rows as the owner role; re-add the original constraint with its original
  comment; delete the `afldb_meta.schema_migrations` row. The applied window is exclusive: no other
  worktree's suite runs against `afldb_test` meanwhile.
- **F-PR-05 (rollback runbooks).** `docs/deployment.md` §11 and `docs/production-promotion.md` §10
  gain the read-only count and the roll-forward-only rule.
- **F-PR-06 (LOW, ISSUE-238 locks).** Slice 6 takes the affected match rows' lock before its
  authority read, or records the residual row-level deadlock risk (the detector resolves it; both
  sides are operator-driven).
- **F-S3-01 (MED, raised in Slice 3; resolved by the operator 2026-10-02).** The ISSUE-238
  rehearsal harness `tools/db/afl-api-identity-correction-rehearsal.ts` is edited only as ISSUE-257
  compatibility requires:
  - the stale token (`loadMatchSheetStaleToken`) is captured at the emulated page-load point,
    before any race gate;
  - cases 091 and 100 expect the stale-save refusal, with the closure row untouched;
  - cases 016, 070, 088 and 101 assert the schema-state outcome instead of assuming one state:
    without migration 110, refused as authority-unavailable; with it, authority written; 016
    expects the ISSUE-257 STOP once Slice 6 lands;
  - every other ISSUE-238 case semantic and acceptance boundary is preserved.
  The ISSUE-238 runbook gets a short dated note attributing the adaptation to ISSUE-257. ISSUE-238
  is not reopened and its historical conclusions stand. **ISSUE-257 owns the re-run** of cases 016,
  070, 088, 091, 100 and 101 in its `afldb_test` phase, with evidence recorded here (§19.4); it is
  not new ISSUE-238 acceptance. After the fix, `typecheck` must report 0 errors.
- **F-S4-01 (MED, raised in Slice 4; resolved by the operator 2026-10-02): remedy (b)+(c).**
  - A savepoint-scoped, bounded retry on PostgreSQL `40P01` around the settle's end-of-run derived
    recompute, and the same in any equivalent AFL API end-of-run recompute.
  - `saveMatchSheet` maps `40P01` to the same retryable "settle running / try again" refusal as
    55P03 (closes F-S4-02).
  - Constraints: only `40P01` is retried; each attempt rolls back to its savepoint before retrying;
    a small bounded count; exhaustion propagates and rolls back the whole settle, so canonical
    writes are never committed without their derived recompute; `saveMatchSheet` stays atomic and
    the refusal is classification only.
  - Global lock-order surgery stays out of ISSUE-257 unless testing proves the retry cannot
    resolve the contention. Any remaining pre-existing lock-order hazard is a separate tracked issue
    (opened as AFLDB-ISSUE-261).

- **F-S7-01 (MED, raised in Slice 7; operator decision 2026-10-03): accepted.** The
  `fitzroy_afldata` owning-source entry in `SETTLING_SOURCE_KEYS`
  (`src/lib/acquisition/match-sheet-authority.ts:891`) stays.
  - **Process deviation.** The fifth orchestrator applied this change itself before formal operator
    approval, contrary to the stop rule for a MED finding. The code change is now explicitly
    accepted; the deviation is recorded here and must not be repeated.
  - Required coverage, DB-free now and in the §4 integration set:
    - an unowned manual addition: Return to source withdraws the authority and deletes the row;
    - a former manual addition now owned by `fitzroy_afldata`: withdraws and keeps the row;
    - unexpected or unsupported provenance still refuses.
  - The accepted owning-source set is not broadened beyond the sources the supported lifecycle
    proves.
- **F-S8-01 (LOW, raised in Slice 8; operator decision 2026-10-03): keep, with strict guards.** A
  manual-registration token may count as resolvable in A4.4 only when the existing A4.2
  manual-registration replay contract guarantees that the exact token re-creates the player before
  the ISSUE-257 replay runs. Guards:
  - the token is covered by the A4.2 contract;
  - an ISSUE-257 field authority whose canonical row also needs re-creation has its covering
    durable addition;
  - resolution is exact and deterministic;
  - missing, ambiguous, split or non-replayable identities fail closed;
  - arbitrary future player creation is never assumed.
  Required promotion tests (`tests/db-promotion-check.test.ts`):
  1. a manual token absent before replay but guaranteed by A4.2 is accepted;
  2. the same identity without a guaranteed player replay is refused;
  3. a field authority that needs its row re-created but lacks its covering durable addition is
     refused;
  4. a player replay plus a covering addition is accepted and replayable.
- **F-S9-05 (MED, raised in the seventh run; operator decision 2026-10-03): accepted.** The
  F-PR-03 "keep" branch is not reachable through a settle, and that is the intended contract:
  - source ownership is never fabricated for an existing unowned manual addition;
  - if the source later carries that player, ordinary settle may reconcile the supported source
    fields, but the row remains unowned;
  - the "keep source-owned row" branch is covered by the data-editor / Return-to-source cases in
    which the row has legitimately become source-owned (`data-editor.test.ts:1204`, `:1229`);
  - source ownership is established only by a supported lifecycle operation such as the fitzRoy
    core reload (`fitzroy_afldata`, F-S7-01), never inferred opportunistically by a settle;
  - Return to source remains available and follows F-PR-03 / D-257-6 refined semantics.

  No code change follows from the decision; `settle-afltables.test.ts:5566` stays as written.
- **F-S11-03 (MED, raised in the Run B relaunch; operator decision 2026-10-03): authorised.**
  "Change the harness fixture keys to `2092|issue238-rehearsal:…` and update the comment. Verify
  DATABASE_URL targets code_test_db, capture C0, then re-run C1–C7 and the old-CHECK sweep of other
  harness cases sharing that prefix. Restore and verify the database matches C0 exactly. Keep the
  same safe-stop rules; stop on unexpected changes or failed restoration. Report results and final
  database state. No DEV or production work is authorised."
  - Scope: `tools/db/afl-api-identity-correction-rehearsal.ts` only — `matchKeyPrefix` takes the
    season-prefixed form, every predicate derived from it keeps working, the header comment is
    updated, and nothing else in the harness changes. Season 2092 must be unused by any other
    fixture, and the harness owns any `seasons` row it needs.
  - Runbook correction: in the `code_test_db` window `DATABASE_URL` MUST name `code_test_db`; the
    seventh run's "unset or naming `code_test_db`" is withdrawn.
- **F-S11-01 (LOW, raised in the Run B relaunch; operator decision 2026-10-03): authorised.** "Use a
  test-owned fixture with a season-prefixed key and identity. State A must assert the specific
  authority-unavailable refusal and no write; State B must assert a successful save and the
  persisted values. Detect schema state explicitly. Re-run admin-brownlow in both states with
  --hookTimeout=300000, verify fixture cleanup and baseline restoration, and retain the same
  safe-stop rules. Do not mutate historical rows or proceed to DEV or production."
  - Scope: `tests/integration/admin-brownlow.test.ts` "preserves the Brownlow mirror through a
    match-sheet save" only, mirroring the F-S10-01 pattern in `data-editor.test.ts`; cleanup runs
    even when an assertion fails; no other `admin-brownlow` case changes.
- **F-S11-02 (INFO, raised in the Run B relaunch; operator decision 2026-10-03): a separate Low
  issue, opened as AFLDB-ISSUE-263.** After a fresh `db:test:rebuild` every
  `brownlow_round_votes.match_id` is NULL, so `admin-brownlow.test.ts:367-379` fails on a rebuilt
  database. Not ISSUE-257; non-blocking; the importer is not changed under ISSUE-257. The `:367`
  failure is attributed to ISSUE-263 (pre-existing).
- **R-01 (LOW, raised in the Run C diff review; operator instruction 2026-10-03: address it before
  DEV acceptance).** "Inspect the rekey/save/settle locking and implement protection using both old
  and new keys where appropriate. Ensure consistent lock ordering and add a targeted concurrency
  regression test proving a committed Match Sheet correction survives the rekey/settle window. Use
  test-owned fixtures only." **Fix applied in Run D** (§19.4 "Run D (R-01)"). The targeted
  regression passed 3 of 3 on `afldb_test` in State B. **Not yet closed:** the Run D window
  SAFE-STOPPED when the tunnel dropped, before the remaining suites, the reversal and the final
  fingerprint. **RESOLVED 2026-10-03 (Run D resume).** On `afldb_test`, R-01 passed 5 of 5 in
  State B and the early return in State A. `settle-afltables` passed 76/76, `settle-afl-api`
  72/72 and `data-editor` 30 plus the allowed skip. Migration 110 was reversed by the guarded
  script and the database was restored to B1 (F5 `import_batches` +9, attributed). Closure: no
  drift, DB-free suites at the expected counts.

### 19.4 Slice log

Each slice records its files, tests and result here as it completes. Agent returns are kept
verbatim in `.phaneslight/returns/257-impl-20261002/`.

- **Slice 1 — pure authority/key model: DONE, DB-free validated.** New
  `src/lib/acquisition/match-sheet-authority.ts`, with no `server-only` import. It covers key
  encode/decode at the last `|` and the §18.3 match predicate. Identity is classified through the
  existing `classifyAflApiForwardIdentity` and `loadFitzroyProfileContinuityRules`, with an optional
  explicit contract path; `resolvePlayerIdentity` is unchanged. Also: the D-257-8
  `decideAuthorityKey`, the changed-field delta with the coupled triple and `club_slug`, strict
  payload parsing, merge, and active/withdrawn interpretation.
  - Choices: inactive records count for key reuse. The continuity contract is consulted only for a
    two-path player.
  - Tests: `tests/match-sheet.test.ts` +11, `tests/current-season-import.test.ts` +12.
- **Slice 2 — schema-compatible reader: DONE, DB-free validated; the SQL is not yet DB-exercised.**
  In `manual-authority.ts`, `player_match_stats` left `UNREPRESENTABLE_OVERRIDE_ENTITIES` and is
  answered from active records (`buildPlayerMatchStatsAuthority`). The snapshot gains
  `playerMatchStats`. The `playerMatchStatsAuthorityStorable` probe is not yet wired.
  - Period scores and Brownlow keep the CHECK proof and are `clear` under both the old and the
    widened CHECK.
  - Tests: +10 in `tests/current-season-import.test.ts`, including the `CHECK_AFTER_257` fixture.
  - Run: `match-sheet` + `current-season-import` 314 passed / 4 skipped (pre-existing skips);
    `typecheck` clean; eslint clean on the four files.
  - Carried forward:
    - (a) `tests/integration/settle-afltables.test.ts:1965-1973` asserts that the CHECK rejects a
      `player_match_stats` override. It needs a State A/B split in Slice 9.
    - (b) A record whose `match_key` no longer resolves has no `match_id` to mark. Slice 4's
      per-unit snapshot, the replay preflight, the rekey carry and A4.4 must catch it.
    - (c) `tests/honours-lifecycle-public-contract.test.ts` has 2 failures in untouched files
      (`awards.ts`, `grid-solver.ts`). A baseline differential is owed.
- **Successor run (2026-10-02).** The plan review was skipped on the operator's instruction. F-PR-03
  was resolved by the operator and recorded as "D-257-6 refined" in §19.2. The Open Issues table
  row was synchronised.
- **Slice 3 — Match Sheet atomic writer: implemented, DB-free validated; run STOPPED on a MED
  escalation.**
  - `saveMatchSheet` (`src/db/queries/match-sheet.ts`) now runs the §18.5 order in one
    transaction:
    1. `SET LOCAL lock_timeout '5s'`; a 55P03 lock timeout returns a clear "settle running"
       refusal.
    2. Match `FOR UPDATE`, then the match's rows `FOR UPDATE`.
    3. Stale-sheet token check. The token is a deterministic hash over all rows of the match: player
       id plus the twelve columns. The page computes it with `loadMatchSheetStaleToken`, the editor
       carries it as a hidden input, and the action echoes it back. A missing or mismatched token
       refuses before any write.
    4. Per-player plan (`planMatchSheetChanges`). Only changed, added or removed rows are written.
    5. The `playerMatchStatsAuthorityStorable` probe. Under the old CHECK, any authority-requiring
       change refuses: State A fails closed.
    6. Identity and D-257-8/9 key decision (`buildMatchSheetAuthorityWrites`), with continuity rules
       loaded from `process.cwd()/tools/rebuild/fitzroy/fitzroy-contract.json` (F-PR-02).
    7. Canonical writes, then authority upserts or deactivations, then derived recompute.
    8. A `data_edits` row of `matches`/`match_sheet` with per-player old and new values and the
       authority keys.
  - Every refusal is thrown inside `begin`.
  - Files:
    - `src/lib/acquisition/match-sheet-authority.ts` (planner, token, authority-write builder);
    - `src/lib/acquisition/manual-authority.ts` (`loadPlayerIdentityRows`);
    - `src/db/queries/match-sheet.ts`;
    - `src/app/admin/data-editor/{actions.ts,MatchSheetEditor.tsx,page.tsx}` (hidden token only, no
      visible UI change);
    - `tests/match-sheet.test.ts`;
    - `tests/integration/data-editor.test.ts` (four new cases, not yet run; existing calls carry the
      token);
    - `tests/integration/admin-brownlow.test.ts`.
  - Run, orchestrator re-run: `match-sheet` + `current-season-import` 331 passed / 4 skipped (335;
    +17). `typecheck` has exactly 6 errors, all in `tools/db/afl-api-identity-correction-rehearsal.ts`.
  - **Escalation F-S3-01 (MED, open for the operator).** The ISSUE-238 rehearsal harness calls the
    real `saveMatchSheet` as a writer in cases 091, 100, 016, 070, 088 and 101 (lines 2323, 2420,
    2711, 3923, 3962, 4000). These cases no longer typecheck because `staleToken` is required. Under
    ISSUE-257 their proven outcomes also change:
    - In the concurrent cases (091, 100), a token taken before the correction is stale after the
      MOVE, so the save refuses instead of landing.
    - The sequential cases (016, 070, 088, 101) need migration 110 and a fixture player with a
      durable identity. They would then write authority, and case 016's correction would meet the
      Slice 6 `manual_authority_present` STOP.
  - Not changed pending a decision. See the run's return for the proposed fix.
- **F-S3-01 harness adaptation (third run, 2026-10-02): DONE, typecheck-validated; DB cases unrun.**
  Per the operator resolution in §19.3. `tools/db/afl-api-identity-correction-rehearsal.ts`:
  - the token is taken at the emulated page load, before any gate;
  - 091 and 100 expect the stale refusal (closure row untouched, no audit, no override);
  - 016, 070, 088 and 101 detect the schema state through `playerMatchStatsAuthorityStorable`.
    State A: authority-unavailable refusal, rows unchanged, early return. State B: saved and an
    active override of the right `field_group` exists. Case 016 carries a `SLICE 6 HOOK
    (AFLDB-ISSUE-257)` comment at the P7 STOP expectation;
  - `FIXTURE_TABLES` gains a `data_overrides` predicate for `player_match_stats` keys under the
    fixture match prefix, so State B leaves no residue.
  - `issues/closed/AFLDB-ISSUE-238.md` §14.8 carries the dated attribution note.
  - `npm run typecheck`: 0 errors. eslint on the harness: clean. Return `05-*`.
  - Open LOW: whether the fixture players hold a durable identity under State B is unverified until
    the `afldb_test` re-run.
- **Slice 4 — settle scoping, E4, `FOR SHARE`, rekey carry: implemented, DB-free validated; run
  STOPPED on a MED escalation (F-S4-01).** Return `06-*`.
  - `manual-authority.ts`: the snapshot gains `unresolvedMatchKeys`. A `player_match_stats` query
    whose `targetKey.match_key` is such a key is `indeterminate`, which closes the Slice 2
    carried LOW (b) for the settle. `scopePlayerMatchStatsFields` classifies a proposal as
    indeterminate, removed or scoped.
  - `settle-afltables.ts`: exports the shared helpers `scopeProposalToAuthority` and
    `automaticProposalUnderAuthority`. A resolved target is scoped before `reconcile()`. A removal
    keeps its full proposal for `reconcile()` and gets an empty automatic proposal.
  - `settle-afl-api.ts`: one authority snapshot per match (auto-apply only); the automatic proposal
    goes through the shared helper.
  - `canonical-apply.ts`: the match row is taken `FOR SHARE` before the per-unit authority load for
    a unit with a `player_match_stats` target. E4 subtracts the protected fields; an empty
    remainder gives `nothing_to_write`; a removal, or an insert over a protected field, gives
    `manual_authority_conflict`; indeterminate gives `manual_authority_indeterminate`. E3, E5 and
    retry are unchanged.
  - `match-rekey.ts`: `carryMatchOverrides` also moves active ISSUE-257 records to
    `<new key>|<identity>` per `field_group` (§18.9). An active row at the new key refuses
    (`rekey_override_conflict`), an inactive one is reactivated and the old row deactivated. Every
    conflict is decided before any write. Both callers are covered with no caller change.
  - Tests: `tests/current-season-import.test.ts` +22. The pinned three-entity list at `:3842`
    stays; it is still a true statement about migrations 097/098/101/102.
  - Run, orchestrator re-run: `match-sheet` + `current-season-import` 353 passed / 4 skipped (357;
    +22). `typecheck` 0 errors. eslint clean on the touched files. The worker also ran four
    neighbouring AFL API / source-contract suites: 485 passed.
  - **Lock-order analysis**, from code reading; not yet DB-exercised:
    - The settle runs one outer transaction per run with a savepoint per unit
      (`settle-afltables.ts:1867-1876`, `canonical-apply.ts:961-963`) and has no `lock_timeout`.
      Per `player_match_stats` unit: match `FOR SHARE`, then the authority read, then the row
      `UPDATE`/`INSERT`. At the end of the run, **outside any savepoint**, it calls
      `recomputePlayerDerivedStats` (`settle-afltables.ts:1903-1911`).
    - The writer takes `lock_timeout 5s`, the match `FOR UPDATE`, then the rows `FOR UPDATE`, then
      `recomputePlayerDerivedStats` (`match-sheet.ts:128,142,168,305`).
    - `recomputePlayerDerivedStats` updates `career_game_no` on every `player_match_stats` row of
      each affected player in every season, with no changed-value guard
      (`player-derived.ts:33-46`).
    - Match then rows is a consistent order between the two sides. A writer blocked by the
      settle's `FOR SHARE` holds nothing yet, so it waits and times out after 5 s with the
      "settle running" refusal.
    - **Cycle 1, mid-run.** The settle holds the row `(P, A)` and waits for match B, which the
      writer holds; the writer's recompute wants `(P, A)`. `deadlock_timeout` (1 s) is below
      5 s, so PostgreSQL aborts one side. A settle victim is contained in its savepoint: the
      unit fails with `write_failed`, a finding opens and the next run retries. A writer victim
      rolls back whole, but only 55P03 is mapped, so the admin sees a generic error.
    - **Cycle 2, end of run.** The two recomputes wait on each other's rows. The settle's
      recompute is outside a savepoint, so a settle victim **rolls back the whole run**.
    - Both cycles predate ISSUE-257: any data-editor save already ran this recompute. The Slice 3
      writer is a new, frequent participant.
  - **F-S4-01 (MED, escalated to the operator; not applied).** Cycle 2 is an unresolved deadlock
    path that can fail a whole settle. Proposed fix, for decision:
    - (a) both sides lock `players … WHERE id = ANY(affected) ORDER BY id FOR UPDATE` before
      their recompute: the writer after its match and row locks, the settle before its end-of-run
      recompute. This gives one global order.
    - or (b) wrap the settle's end-of-run recompute in a bounded retry on 40P01. A retry is only
      possible from a savepoint taken before it, so (b) needs that savepoint.
    - plus (c) `saveMatchSheet` maps 40P01 to the same retryable "settle running" refusal
      (F-S4-02, LOW).
    - The orchestrator's view: (a) as written does **not** close cycle 2. The settle already holds
      `(P, A)` row locks from its units when it reaches `players`. The writer would then hold
      `players(P)` and wait for `(P, A)` while the settle waits for `players(P)`. A global order
      needs `players` taken before any `player_match_stats` row lock on **both** sides, per unit in
      the settle, which reorders the settle's unit locking. (b) with a savepoint is the smaller
      change. (c) is independently correct. A shorter writer `lock_timeout` does not help:
      `deadlock_timeout` is superuser-only and the detector fires on whichever wait began first.
      An operator decision is needed between (b)+(c), a redesigned (a), or accepting the
      residual (a rare settle rollback that the next run retries) and recording it.
  - Not yet started: Slices 5–9, validation and rehearsal.
- **F-S4-01 addendum (fourth run, 2026-10-02): DONE, DB-free validated; not DB-exercised.** Per
  §19.3.
  - `settle-core.ts`: `runDerivedRecomputeWithDeadlockRetry`, `isDeadlockDetected`,
    `DERIVED_RECOMPUTE_DEADLOCK_BACKOFF_MS = [1000, 2000, 3000]` (4 attempts). Each attempt runs in
    `SAVEPOINT afldb_derived_recompute`; on `40P01` with attempts left it rolls back to and releases
    the savepoint, pauses, retries; any other error, or `40P01` on the last attempt, propagates and
    the run's transaction rolls back whole.
  - Why the backoff sums to 6 s: after the settle loses the end-of-run deadlock, the Match Sheet
    writer is still waiting on row locks the settle's units took before the savepoint. PostgreSQL
    runs one deadlock check per wait, so an immediate retry can be chosen as victim again. Pausing
    beyond the writer's 5 s `lock_timeout` lets that writer time out (its retryable refusal) and
    release its rows. A test pins the relationship to the `'5s'` literal in `match-sheet.ts`.
  - Both settles wrap the same four-call recompute block: `settle-afltables.ts` (end of run) and
    `settle-afl-api.ts`, which has the equivalent end-of-run recompute.
  - `match-sheet-authority.ts`: `matchSheetRetryableRefusal` (55P03 or 40P01 →
    `MATCH_SHEET_SETTLE_RUNNING_REFUSAL`, otherwise `null`). `match-sheet.ts` uses it in its catch.
  - Tests: `tests/match-sheet.test.ts` +10 (first-attempt 40P01 then success, exhaustion
    propagates, four non-40P01 codes and a plain error not retried, backoff versus `lock_timeout`,
    the 40P01/55P03 mapping, both settles wrapped).
  - Run: `match-sheet` + `current-season-import` 363 passed / 4 skipped (367); seven neighbouring
    source-pinning suites 1,026 passed / 5 skipped; `typecheck` 0 errors; eslint clean.
  - Residual pre-existing hazard (other admin writers have no `lock_timeout`, so the retry can
    exhaust against them): opened as **AFLDB-ISSUE-261**, not folded into this issue.
- **Slice 5 — replay: implemented, DB-free validated; not DB-exercised. Run STOPPED on an
  unexpected filesystem artefact.** Return `08-*`.
  - `tools/migration/common.py`: `replay_admin_overrides(conn, "player_match_stats")` (keyword-only
    `continuity_rules=None`). The preflight covers the whole active set and names every offending key
    in one error. It checks: key decode; payload interpretation mirroring `interpretKeyAuthority`;
    exactly one match; identity per D-257-9; `club_slug` home or away; no duplicate (match, player)
    pair. After the load it also checks a field record with no row and no addition, and an addition
    without `club_slug`. Writes run in order: remove, add (`source_id` NULL), field apply by key
    presence. With no records the branch is a no-op, which covers State A.
  - `import_fitzroy_core.py` `import_player_match_stats`: the preflight runs before the stats
    `DELETE`; the replay runs after the COPY and before the commit, so a refusal rolls the reload
    back. `tests/data-overrides-source-contract.test.ts` pins the placement, after the after-siren
    precedent.
  - The D-257-9 reverse rule is shared: `resolveStoredIdentityToPlayer` and `continuityPartnersOf`
    in `match-sheet-authority.ts`. A path on either side of a tracked rule needs every side to resolve
    to the same single player. The settle snapshot (`manual-authority.ts`) now uses it and fetches the
    partner paths; an unreadable contract makes every record indeterminate. Python lazily reuses
    `load_profile_continuity_rules`; there is no second mapping.
  - Parity: `tests/current-season-import.test.ts` has 27 cases against the real Python
    `pms_preflight`. They agree on the 25 shared cases; 2 are Python-only row-existence cases
    (F-S5-02, LOW).
  - Promotion: the §8.1 post-swap tuple is documentation only. In `docs/production-promotion.md`,
    `player_match_stats` now follows `players` and `matches`. `db:test:rebuild` is unchanged:
    `rebuild-test.ts:1005-1015` still replays only manual registrations.
  - Orchestrator re-run (`AFLDB_PYTHON` set): `match-sheet` + `current-season-import` +
    `data-overrides-source-contract` 436 passed / 4 skipped. `typecheck` 0 errors.
  - **STOP:** the Read hook created a zero-byte untracked `row.def))` at the repo root during the
    worker run. Per the operator's rule it was reported and not deleted. The worker also ran one
    off-list read-only shell command (`wc -l`/`tail`).
- **Fifth run (2026-10-02/03).** Resumed from return `09-*`. The main session deleted `row.def))`
  with operator approval. New operator rule: a zero-byte, untracked root file named after text that
  follows `>` in a file just read is a Read-hook artefact; it is logged here, deleted after a
  length-0 and `git ls-files` check, and the run continues. Anything else still stops the run.
  Slip disclosed: the orchestrator ran one off-list no-op shell command (`echo waiting`) while
  waiting on the Slice 6 worker.
- **Slice 6 — ISSUE-238 guard: implemented, DB-free validated; not DB-exercised.** Return `10-*`.
  - Stop: code `manual_authority_present`, step `A257`, added to the StopCode union in
    `afl-api-identity-correction.ts`. `PLANNER_VERSION` is unchanged: the guard is ORIGINAL-only, so
    PREDICT/REPLAY plans and stored predictions are byte-identical.
  - Pure `manualAuthorityBlockersForMatch` and `describeManualAuthorityBlockers` live in
    `match-sheet-authority.ts`.
  - `correct_afl_api_identity.ts`: `readManualAuthorityBlockersAtMatch` reads by the §18.3 prefix
    predicate. The guard sits in `buildClosure` behind `authority.mode === 'ORIGINAL'` (only
    `runCorrection`). It runs after the C11 foreign/indeterminate checks and before P7, so a foreign
    NOOP row never STOPs.
  - Locks: M is already locked by `FOR UPDATE OF pms, m` (`lockRows`) before the read (F-PR-06).
    Validate-only reads without locks by design.
  - Detail, via `detailLastStop` so it stays out of the fingerprint, names each blocking key and
    group. It is fail-closed: an undecodable key, an unreadable payload or an unresolvable identity
    under M's prefix blocks as indeterminate.
  - State A: one query, no rows, no-op.
  - Harness: case 016's State B expectation is now the `A257` STOP and names the key. Cases 070,
    088 and 101 are unaffected: they reach `runAlreadyCorrectedRerun`, never `buildClosure`. Cases
    091 and 100 are also unaffected.
  - Tests: +9 pure cases in `tests/afl-api-identity-correction.test.ts`, +1 source pin in
    `tests/correct-afl-api-identity-cli.test.ts`.
  - Run: 414 passed, 1 failed; `typecheck` 0 errors; eslint 0 errors (4 pre-existing
    unused-import warnings).
    - The failure is `correct-afl-api-identity-cli.test.ts:3190-3196`. It slices the tool source at
      `'\n}\n'`, but the working copy is CRLF (5,480 `\r` lines). The slice therefore runs to EOF and
      meets the pre-existing `problems.join` at `:4592` and `:5261`.
    - Pre-existing and Windows-only, the same class as `finals-semantics-contract`; Slice 6 adds no
      `problems.join`. To confirm on Linux in §3/§4.
- **Slice 7 — Visual Evidence declaration (CLAUDE.md §15), made before apply.**
  - Viewports: 1440×900 desktop (primary admin use) and 390×844 (narrow sanity check; admin
    tables scroll horizontally in `.table-wrap`).
  - Screen: `/admin/data-editor` with a match selected for the Match Sheet editor. The new panel,
    "Durable Match Sheet decisions", sits below the sheet form, outside it, because forms cannot
    nest.
  - States:
    - S1: no active authority for the match (empty-state line);
    - S2: active authority with one edited-fields row, one manual addition and one manual removal,
      each with a "Return to source" control;
    - S3: success message after Return to source;
    - S4: a refusal message (no authority, a provenance mismatch, or retryable "settle running");
    - S5: authority status unavailable (the import connection is not configured or the read
      failed). This state is fail-closed: the panel says so rather than hiding.
  - Reference design: none external. The panel uses the existing data-editor conventions:
    `.table-wrap`, `btn btn-secondary`, `.muted`, and the inline-style idiom of
    `MatchSheetEditor.tsx`.
- **Slice 7 — `deleteMatch` refusal, Return to source, admin panel: implemented, DB-free
  validated; not DB-exercised.** Return `11-*`.
  - `match-sheet-authority.ts`:
    - pure `planReturnToSource`, with outcomes `withdraw_only`, `withdraw_delete_row`,
      `withdraw_keep_row` and refuse;
    - `summariseActiveMatchAuthority`;
    - `SETTLING_SOURCE_KEYS`.
  - `match-sheet.ts`:
    - shared `loadMatchAuthority` (§18.3 prefix plus reverse resolution);
    - `matchDeletionAuthorityRefusal`;
    - `loadMatchSheetAuthoritySummary` (import role, no locks, fails closed to `unavailable`);
    - `returnMatchSheetToSource`: one transaction; `lock_timeout 5s`; match lock, then the
      player's row `FOR UPDATE`; refusals thrown inside `begin`; deactivation through the granted
      columns only; recompute; `data_edits` row with `fieldGroup 'match_sheet_return_to_source'`.
  - `match-admin.ts` `deleteMatch` (D-257-5): `match_key` was added to the locked SELECT. The
    refusal comes after the Brownlow refusal and before the first DELETE. Every active key under
    the prefix blocks, including an unresolvable one, which is named by key. Inactive records do
    not block.
  - Server action `returnMatchSheetToSourceAction` in `actions.ts`.
  - Panel "Durable Match Sheet decisions" in `MatchSheetEditor.tsx`, below and outside the save
    form, loaded by `page.tsx`.
  - Other `DELETE FROM matches` paths are rehearsal or acceptance cleanups and test fixtures only:
    `afl-api-identity-correction-rehearsal.ts:5915`, `promotion-source-dependency-rehearsal.ts:623`
    and the ISSUE-155 acceptance `.ps1` scripts. No other production path exists.
  - **Orchestrator correction (F-S7-01, MED, fixed in-slice to conform to D-257-6 refined).** The
    worker's `SETTLING_SOURCE_KEYS` held only the two settles' keys (`afltables`, `afl_api`). The
    fitzRoy core reload owns reloaded `player_match_stats` as `fitzroy_afldata`
    (`import_fitzroy_core.py:123-126`).
    - So the exact F-PR-03 scenario (a reload whose source now carries the added player) would
      have refused Return to source and trapped the operator.
    - `fitzroy_afldata` was added, and the pin test now covers all three declarations.
  - Tests:
    - `tests/match-sheet.test.ts` +12, covering both F-PR-03 transitions, removal, fields-only, the
      refusals, the summary, and source pins on the `deleteMatch` order and the transaction shape;
    - `tests/integration/data-editor.test.ts` +5, not yet run; they are State-A guarded.
  - Run, orchestrator re-run after the correction: `match-sheet` + `current-season-import` +
    `data-overrides-source-contract` 448 passed / 4 skipped. The worker's runs: `typecheck` 0;
    eslint 0 errors (4 pre-existing warnings).
  - Open:
    - F-001 (MED → §4): the SQL casts and `FOR UPDATE OF pms` with a LEFT JOIN need DB proof. The
      §4 integration cases are the check.
    - F-002 (LOW): row-deleting integration cases restore the row but not its derived rows.
    - F-003 (LOW): Club shows '—' for a removal entry.
  - **VISUAL: UNVERIFIED.** A capture needs an authenticated admin session on a live server
    against a database with migration 110 and seeded authority. That is outside this run's
    authorised commands, and a static render harness would need a new file. Recorded in
    `.phaneslight/config.json` `capabilities.failures[]`. **User eyeball requested at DEV
    acceptance** for S1–S5 at 1440×900 and 390×844.
  - Read-hook artefacts, each confirmed zero-byte and untracked, then deleted 2026-10-03 ~00:12:
    - `0)` (00:05:56);
    - `String(r.matchKey)))` (00:05:56);
    - `item.playerId))` (00:05:53);
    - `r.fieldGroup).sort()).toEqual(['lineup'` (00:10:06).
- **Slice 8 — promotion: implemented, DB-free validated; not DB-exercised.** Return `12-*`.
  - **A4.4** is a pure `planPromotionPlayerMatchStatsReplay` in `promotion-inventory.ts`. It is
    gated in `gateOverrideReplayTargets` (`promotion-check.ts`) after A4.3, and so runs at both
    `--phase restored` and `--phase candidate`; a source pin covers both call sites.
    - `PROMOTION_REPLAY_OVERRIDES_SQL` admits `player_match_stats`. There are new narrow SQL
      constants for matches, identities, clubs and rows.
    - It mirrors `pms_preflight`: decode, payload, contract readable, exactly one match, D-257-9
      identity, club home/away, no duplicate pair, and a row or an addition for every non-removal
      record. Every offending key is named.
    - With no records it is a PASS and runs no extra SQL (State A).
    - A4.2 still reads only its original identity set, so A4.2 and A4.3 outcomes are unchanged.
    - The worker made one judgement here: a token the players replay binds resolves to the bound
      player. A token it creates resolves to a synthetic id, so a field record for that player
      passes only with a durable addition. Recorded as **F-S8-01 (LOW, operator awareness)**; it
      is a one-line change to fail closed instead.
  - **F2**: `overrideMatchKeyOf` takes the match half at the last `|`. An undecodable key returns
    null, so the gate fails closed. `F2_OVERRIDES_SQL` and `F2_COUNT_SQL` admit the type.
  - Inventory: the A4.2/A4.3 comment is corrected (F-S5-04 closed), and the replay checklist note
    gains the branch. `promotion-convergence-rehearsal.ts:225` counts the type.
  - `docs/production-promotion.md` §8.1 gains the A4.4 and before-`rebuild_derived.py` sentences
    (F-S5-03 closed).
  - No manifest, fingerprint or privilege change. `data_overrides` stays `reinstate` /
    `compare: equal`.
  - Tests: `tests/db-promotion-check.test.ts` +14, and two existing gate-list assertions extended
    for the third result.
  - Orchestrator re-run: `db-promotion-check` + `match-sheet` + `current-season-import` +
    `data-overrides-source-contract` **900 passed / 4 skipped (904)**; the worker had reported
    "904 passed".
  - Worker runs: `typecheck` 0; eslint 0 errors.
  - Read-hook artefacts, each confirmed zero-byte and untracked, then deleted 2026-10-03 ~00:20:
    - `0)` (00:14:36);
    - `String(r.matchKey)))` (00:14:36);
    - `a.playerId))]` (00:14:56);
    - `r.playerId` (00:14:56).
- **Checkpoint (fifth run, 2026-10-03), at the operator's context ceiling.** Return `13-*`.
  Resumption point: Slice 9 (migration `110_*`).
- **Sixth run (2026-10-03).**
  - **Start state.** Branch and HEAD `3ed70ab1` were verified, with the 34-file modified set and only
    `match-sheet-authority.ts` untracked. The operator decisions on F-S7-01 and F-S8-01 were
    recorded first (§19.3). No sub-agent was spawned. No database command was run.
  - **Read-hook artefacts:** none appeared during this run.
  - **F-S7-01 verification.** The owning-source set is exactly `afltables`, `afl_api` and
    `fitzroy_afldata`. Each key is a proven writer of `player_match_stats.source_id`:
    - `afltables` and `afl_api`: through canonical-apply provenance, under each settle's
      `SETTLE_SOURCE_KEY` (`settle-afltables.ts:125`, `settle-afl-api.ts:178`);
    - `fitzroy_afldata`: through the fitzRoy core reload COPY, which writes `fitzroy_id` as
      `source_id` (`import_fitzroy_core.py:3121-3163`).

    The only other `source_id`-writing path is the legacy CSV intake
    (`src/lib/ingest/datasets.ts:745`, ISSUE-258). It is not admitted, so a returned addition
    owned by that intake refuses (fail closed). The set was not broadened.
    - DB-free: `tests/match-sheet.test.ts` adds one case covering all three provenance outcomes
      (unowned → delete; `fitzroy_afldata` → keep; four unsupported keys → refuse). The earlier
      loop over `SETTLING_SOURCE_KEYS` and the three-declaration pin stay.
    - Integration, written and not run: `tests/integration/data-editor.test.ts` adds two cases, the
      `fitzroy_afldata`-owned addition (withdraw and keep) and the `manual_admin_edit`-owned
      addition (refuse, nothing written). The unowned case already existed (`a manual addition
      still unowned…`).
  - **F-S8-01 verification**, against the guards in §19.3:
    - binds and creates come only from `planPromotionPlayersReplay`. A problem record is never
      pushed to either (`promotion-inventory.ts:3870-3939`);
    - a created player has a synthetic id that no candidate row matches, so field authority needs
      its durable addition (`:4631-4640`);
    - resolution is exact: ambiguous or split identities refuse through
      `resolveStoredIdentityToPlayer`;
    - a token outside the plan stays unresolved.
  - **New finding F-S9-01 (LOW, fixed in scope as a direct implementation of guard 1).** A4.4 used
    A4.2's binds and creates even when A4.2 itself had STOPs, for example a create that a
    `promotionPlayerCheckProblems` CHECK STOP adds after planning (`promotion-check.ts:3076-3078`).
    The run still failed through A4.2, but A4.4 could report PASS for a token whose re-creation is
    not guaranteed.
    - Fix: `planPromotionPlayerMatchStatsReplay` takes the plan's `problems`. While any exist,
      binds and creates make nothing resolvable, and the unresolved message names the reason.
    - Tests: four in `tests/db-promotion-check.test.ts`, the operator's (1)–(4), with (2) covering
      both a token absent from the plan and a token in a plan that has STOPs.
  - **Slice 9 — migration 110 and rollback guard: written, DB-free validated, not applied anywhere.**
    - `src/db/migrations/110_match_sheet_player_match_stats_authority.sql` (new). One
      `ALTER TABLE data_overrides DROP CONSTRAINT data_overrides_entity_type_check, ADD CONSTRAINT …
      CHECK (entity_type IN (` followed by migration 102's 13 literals verbatim plus
      `'player_match_stats'`. A rewritten `COMMENT ON CONSTRAINT` says that only
      `match_period_scores` and `brownlow_round_votes` must never be admitted and that rollback
      below 110 is roll forward only once a record exists. 102 was the last widening: no migration
      from 103 to 109 touches the constraint.
    - Privileges: unchanged. `privileges.sql:323-333` grants `afldb_import` SELECT, INSERT on the
      seven writer columns, UPDATE (`override_values`, `admin_user_id`, `is_active`, `updated_at`)
      and sequence USAGE. Every ISSUE-257 writer uses only those: `match-sheet.ts:281/295/645` and
      `match-rekey.ts:385-429`. The replay only reads.
    - `OVERRIDE_ENTITY_TYPES` (`manual-authority.ts:108`, inventory only, not the proof) gains
      `player_match_stats`.
    - Schema-contract tests in `tests/current-season-import.test.ts`:
      - the 110 regex pin;
      - the two remaining settle targets absent from 110;
      - exactly 14 literals;
      - the drop/add convention;
      - the comment;
      - no GRANT/REVOKE;
      - the inventory equals `CHECK_AFTER_257`, which is 102 plus `player_match_stats`.

      F-S4-03 closed: the three-target loop over 097/098/101/102 stays true and unchanged.
    - Integration tests (written, not run):
      - `settle-afltables.test.ts`, the "proves from the live CHECK" case is split into State A and
        State B. Both remaining targets are refused in either state. State A also proves the
        `player_match_stats` INSERT is refused. State B asserts admission from the constraint only
        and writes no row, so it is rollback-safe.
      - `admin-awards.test.ts:495` and `special-records-lifecycle.test.ts:273` pinned
        `player_match_stats` as absent. They would have failed under State B and now pin only the
        two remaining targets.
    - **Rollback guard (D-257-7, F-PR-05)**, `tools/db/issue257-rollback-guard.ts` (new):
      - usage: `--target dev|test|code-test|prod`, using the migration runner's variable names; it
        loads `.env` as `migrate.ts` does and takes no DSN on the command line;
      - it runs one `READ ONLY` transaction: `current_database()`; `count(*)` total and active of
        `data_overrides WHERE entity_type = 'player_match_stats'`; the constraint definition;
      - exit codes: 0 PERMITTED only at zero; 2 REFUSED at one or more rows, or when the count is
        unreadable; 1 on an error;
      - it never writes or deletes.

      `docs/deployment.md` §11 and `docs/production-promotion.md` §10 now require it. Six DB-free
      tests cover the verdict, fail-closed handling, read-only SQL, target parsing against
      `migrate.ts` and the wiring of both docs.
  - **§3 DB-free validation.** No database variable was set; `AFLDB_PYTHON` was set.
    - `typecheck`: 0 errors, run twice, the second after the last edit.
    - eslint on all 32 changed or new TS/TSX files: 0 errors and 10 warnings. All warnings are in
      lines this run did not write. The workers attributed them to earlier code:
      - `page.tsx:18` (2);
      - `db-promotion-check.test.ts:4319/4467` (2);
      - `data-editor.test.ts:90/94` (2);
      - `correct_afl_api_identity.ts:131/132/174/183` (4).
    - Vitest across 21 files: **2,322 passed / 5 failed / 28 skipped (2,355)**:

      | Suite | Passed | Failed | Skipped |
      |---|---|---|---|
      | `match-sheet` | 68 | 0 | 0 |
      | `current-season-import` (TS/Python parity ran) | 318 | 0 | 4 |
      | `db-promotion-check` | 456 | 0 | 0 |
      | `data-overrides-source-contract` | 69 | 0 | 0 |
      | `afl-api-identity-correction` | 141 | 0 | 0 |
      | `correct-afl-api-identity-cli` | 273 | 1 | 0 |
      | `special-records-replay-parity` (DB-backed) | 0 | 0 | 19 |
      | `fitzroy-core-import` | 109 | 0 | 5 |
      | `admin-match-mutations` | 16 | 0 | 0 |
      | `match-lineup-editor` | 5 | 0 | 0 |
      | `admin-match-input` | 9 | 0 | 0 |
      | `special-records-identity` | 15 | 0 | 0 |
      | `special-records-admin` | 43 | 0 | 0 |
      | `awards-admin` | 40 | 1 | 0 |
      | `db-test-rebuild` | 528 | 0 | 0 |
      | `workflow-preflight` | 34 | 0 | 0 |
      | `reference-data` | 50 | 1 | 0 |
      | `player-link-mutations` | 122 | 0 | 0 |
      | `audit-link-fk-indexes` | 5 | 0 | 0 |
      | `migration-checksum` | 12 | 0 | 0 |
      | `honours-lifecycle-public-contract` | 9 | 2 | 0 |

      The `current-season-import` skips are the four `haveSh` cases. The
      `special-records-replay-parity` skips are expected because it needs a DB.
    - **All five failures are pre-existing. No checkout was used to prove it:**
      - `honours-lifecycle-public-contract` (2). The test and every file it reads are absent from
        `git status`: `src/db/queries/awards.ts`, `grid-solver.ts`, `nl/player-career.ts` and
        `src/app/sitemap.ts`.
      - `correct-afl-api-identity-cli:3195`, Windows CRLF. The test slices up to `'\n}\n'`
        (`:3193`) of a working copy with 5,480 CR-terminated lines. The `indexOf` gives -1, so the
        slice runs to the end of the file and reaches `problems.join` beyond the function.
      - `awards-admin:578`, Windows CRLF. `108_import_reads_data_edits.sql` is CRLF (32 CR lines)
        and the test strips comments with `/--.*$/` per line, which leaves comments ending in a CR.
        Both files are unmodified. Migration 110 is LF (0 CR).
      - `reference-data:425`. Its exact list lacks `afl_api_identity_adjudications`, created by the
        unmodified migration 104 (ISSUE-238) without `grant_import_write`. This is
        platform-independent. Migration 110 creates no table, and the test file is unmodified.
        Recorded as F-S9-04 (LOW, not ISSUE-257's).
    - `git diff --check`: exit 0. The only output is the known LF→CRLF warning for `match-sheet.ts`.
    - **Fixed `data_overrides` entity allowlists** found by Grep (`entity_type IN (`, `= ANY`, the
      replay dispatch, the `after_siren_kicks'` full-list probe):
      - the CHECK: 110 admits the type;
      - `OVERRIDE_ENTITY_TYPES`: updated;
      - `UNREPRESENTABLE_OVERRIDE_ENTITIES`: correctly two entities;
      - the generic editor `EDITABLE_ENTITIES`: correctly excludes the type, pinned;
      - `common.py` replay dispatch: `:1857` branch present;
      - `docs/production-promotion.md:1369` replay tuple: present;
      - `promotion-check.ts:2935`: present;
      - `promotion-source-dependencies.ts:271/276`: present;
      - `promotion-convergence-rehearsal.ts:225`: present;
      - `match-rekey.ts`: 7 references;
      - the integration pins `admin-awards`, `special-records-lifecycle` and `settle-afltables`:
        fixed above.

      None is stale. `rebuild-test.ts` replays only manual registrations, by design (Slice 5).
  - **New findings — reported, not fixed:**
    - **F-S9-02 (MED, plan contradiction).** The ISSUE-238 rehearsal harness is bound to
      `code_test_db` (`afl-api-identity-correction-rehearsal.ts:122`, `--acknowledge code_test_db`,
      `:7500`). F-S3-01 places the re-run of cases 016/070/088/091/100/101 in the ISSUE-257
      "`afldb_test` phase"; the harness cannot run there.
      - Proposed: run the six cases on `code_test_db` in their own window, under the old CHECK and
        again after `npm run db:migrate:code-test` applies 110. That target is disposable, and its
        owner and import DSNs are the test DSNs with the database name swapped.
      - Needs operator authorisation. Not applied.
    - **F-S9-03 (MED, readiness gap).** Most of the 17 operator integration cases are not yet
      written; Grep finds ISSUE-257 integration coverage only in `data-editor.test.ts`.
      - Written: stale page-load refusal (`:999`, `:1025`); missing durable identity (`:1034`);
        row and authority committed together (`:1051`); `deleteMatch` refusal (`:1148`); Return to
        source ordinary (`:1165`), unowned addition (`:1185`), source-owned addition (`:1201`),
        removal (`:1219`); the F-S7-01 pair.
      - Not written: every settle case (one field kept, unchanged re-settle, unrelated field
        updates, removal blocks reinsert, addition survives, Return-to-source-then-settle restores);
        authority-write failure after 110; replay field, addition and removal, and the unresolved
        key refusing before the first write; rekey carry; the AFL API ownership case.
      - Proposed: one DB-free authoring pass on `settle-afltables.test.ts` and a replay integration
        home before the window opens. Not done; outside this run's scope.
    - **F-S9-04 (LOW).** The pre-existing `reference-data` failure above.
  - **Prepared, NOT run: `afldb_test` preflight and the §4/§5 plan. SUPERSEDED by the "Seventh
    run" window plan below; kept for history.** It needs operator
    confirmation of an exclusive window, with no other worktree's suite on `afldb_test`. Set four
    variables, each with the database swapped to `afldb_test` and never written into a file or onto
    a command line:
    - `AFLDB_TEST_DATABASE_URL`, the owner;
    - `AFLDB_TEST_IMPORT_DATABASE_URL`;
    - `AFLDB_IMPORT_DATABASE_URL`, equal to the test import DSN;
    - `AFLDB_AUTH_DATABASE_URL`.

    Also set `AFLDB_PYTHON`. Do not create a `.env`.
    - **P0 tunnel:** the 55432 tunnel is up, per the operator's standard procedure.
    - **P1 identity:** with the owner DSN, `SELECT current_database(), current_user,
      inet_server_port();`. Expect `afldb_test`, the owner role and the tunnel port.
    - **P2 ledger:** `npx tsx tools/db/migrate.ts --status --target test`. Expect `109_*` applied,
      `110_match_sheet_player_match_stats_authority.sql` PENDING and no drift. Then
      `SELECT name, applied_at FROM afldb_meta.schema_migrations ORDER BY name DESC LIMIT 5;`.
    - **P3 CHECK:** `SELECT pg_get_constraintdef(oid), obj_description(oid, 'pg_constraint') FROM
      pg_constraint WHERE conname = 'data_overrides_entity_type_check';`. Expect migration 102's 13
      literals and comment. Save both texts verbatim; they are the F-PR-04 reversal input.
    - **P4 counts:** `SELECT entity_type, is_active, count(*) FROM data_overrides GROUP BY 1, 2 ORDER
      BY 1, 2;`. Expect no `player_match_stats` row.
    - **P5 exclusivity:** `SELECT pid, usename, application_name, client_addr, state,
      backend_start, left(query, 80) FROM pg_stat_activity WHERE datname = 'afldb_test' AND pid <>
      pg_backend_pid();`. Expect none, or only known idle sessions.
    - **P6 guard baseline:** `npx tsx tools/db/issue257-rollback-guard.ts --target test`. Expect
      PERMITTED, 0, and "does not admit".
    - **F-PR-04 reversal**, in one transaction as the owner, run only while no record must be kept:
      1. `BEGIN;`
      2. `SELECT count(*) FROM data_overrides WHERE entity_type = 'player_match_stats';`, recorded;
      3. `ALTER TABLE data_overrides DROP CONSTRAINT data_overrides_entity_type_check;`
      4. `DELETE FROM data_overrides WHERE entity_type = 'player_match_stats';` (test fixtures
         only);
      5. `ALTER TABLE data_overrides ADD CONSTRAINT data_overrides_entity_type_check CHECK
         (entity_type IN (<the 13 literals of migration 102>));`
      6. `COMMENT ON CONSTRAINT data_overrides_entity_type_check ON data_overrides IS '<P3
         comment>';`
      7. `DELETE FROM afldb_meta.schema_migrations WHERE name =
         '110_match_sheet_player_match_stats_authority.sql';`
      8. `COMMIT;`, then repeat P2 and P3. Expect PENDING and the 102 text.

      The `migrate.ts` SHA hazard: any edit to 110 after it is applied refuses every later migrate,
      so the reversal must come before any edit, and 110 is then re-applied.
    - **§4 run order** (each command is `npx vitest run <file> [-t "<name>"]`; stop any running
      suite before a migration step):
      1. **Old CHECK (State A)**:
         - `tests/integration/settle-afltables.test.ts -t "proves from the live CHECK"` (State A
           branch);
         - `tests/integration/data-editor.test.ts`. The authority cases return early, which proves
           the State A fail-closed path.
         - `tests/integration/admin-awards.test.ts -t "no settle target"`;
         - `tests/integration/special-records-lifecycle.test.ts -t "no settle target"`;
         - `tests/integration/match-admin-delete.test.ts`.
      2. `npm run db:migrate:test`, applying 110 only, then P2 and P3 (expect 14 literals and the
         new comment).
      3. **State B:**
         - `tests/integration/data-editor.test.ts` in full: stale page-load, missing identity,
           atomic commit, `deleteMatch` refusal, Return to source ordinary / unowned addition /
           settle-owned addition / removal, and the F-S7-01 `fitzroy_afldata` and unsupported-owner
           cases;
         - the same `settle-afltables` case (State B branch);
         - `tests/integration/settle-afltables.test.ts` in full, for the rekey, E4 and `FOR SHARE`
           regressions;
         - `tests/integration/settle-afl-api.test.ts`;
         - `tests/integration/admin-brownlow.test.ts`;
         - `admin-awards` and `special-records-lifecycle` again.
      4. **The cases F-S9-03 lists as unwritten**, once authored: the 17 operator cases' settle,
         replay and rekey items; the F-PR-03 transitions through a real settle; the D-257-9
         continuity pair, only if a read-only preflight `SELECT` of the four ISSUE-136 pairs'
         accepted `afltables` `external_identities` on `afldb_test` finds both paths on one player; the AFL API ownership case only if a realistic
         `afl_api`-owned fixture exists. The 40P01 witness is skipped: no deterministic harness
         exists.
      5. After every State B suite, run P4 and the guard. Every case restores its rows, so expect
         `player_match_stats` count 0 and PERMITTED. A non-zero count STOPS before §5.
    - **§5 deployment rehearsal on `afldb_test`:**
      - **S5.1 State A:** the reversal above, then P2 and P3 show PENDING and 102. The new code
        reads State A: the `settle-afltables` "live CHECK" case passes on the State A branch, and a
        data-editor save refuses with the authority-unavailable message.
      - **S5.2 State B:** `npm run db:migrate:test`, then the same two checks pass on the State B
        branch.
      - **S5.3 rollback before the first record:** guard PERMITTED (exit 0), then the reversal
        succeeds and P3 shows 102.
      - **S5.4 rollback after the first record:** re-apply 110. Insert one fixture record as the
        owner, `entity_key` prefixed `issue257-guard|`. The guard must exit 2 REFUSED. Attempt only
        step 5 of the reversal (`ADD CONSTRAINT` narrow) inside `BEGIN … ROLLBACK`; expect a CHECK
        violation. Then delete the fixture row and confirm the guard is PERMITTED again.
      - **Final state:** 110 applied (State B), with zero `player_match_stats` rows and the ledger
        holding 110. Alternatively, if the operator prefers that `afldb_test` mirror `main`, the
        F-PR-04 reversal (State A). Operator choice, recorded here.
    - **Estimated duration:**
      - preflight: 5 min;
      - §4 steps 1–3: about 35–50 min (data-editor and settle-afltables dominate; tunnel about
        60 ms per statement);
      - §4 step 4: depends on authoring;
      - §5: about 15 min.
  - **Visual evidence:** still VISUAL: UNVERIFIED for the Return-to-source panel. A user eyeball is
    requested at DEV acceptance.
- **Seventh run (2026-10-03). DB-free authoring, static validation and ISSUE-262; no database
  connection of any kind.**
  - **Start state.** Branch `issue/257-durable-match-sheet-authority`, HEAD `3ed70ab1`. The 38
    modified files and 3 untracked files matched the sixth run's end state. Three `afldb-worker`s
    authored one file each.
  - **Read-hook artefacts.** Four untracked, zero-byte repo-root files appeared, each confirmed by
    length 0 and an empty `git ls-files`, and each named after text following `>` in a file read
    this run. Under the operator rule they were deleted with `Remove-Item -LiteralPath`:
    - `Number.isInteger(id)`, from `match-sheet.ts:310`, created 00:48:44;
    - `entry.matchKey`, created 00:49:01;
    - `1)`, from `> 1)` in `match-sheet-authority.ts:312`, `match-sheet.ts:627` and others, created
      00:49:20;
    - `typeof`, created 00:49:46.

    The final `git status` shows only the three expected untracked files.
  - **Returns.** `15-*`, `16-*`, `17-*` and this run's `18-*` are in
    `.phaneslight/returns/257-impl-20261002/`.
  - **F-S9-03 cases, authored and NOT run.** Every case returns early under State A (no
    `player_match_stats` authority can exist). Each cleans up in `finally` or `afterAll`.
    - `tests/integration/settle-afltables.test.ts`, describe `Durable Match Sheet authority through
      the settle (AFLDB-ISSUE-257 F-S9-03)` (`:5137`, inside ISSUE-122 S5). The cases, by line:
      - `:5397` a corrected field survives the settle, on a retry and when the source moves;
      - `:5432` an unchanged re-settle does not churn;
      - `:5462` an unprotected field still updates (`marks` 5→7 while `goals` stays 9);
      - `:5482` a durable removal blocks reinsert;
      - `:5513` a manual addition survives the settle;
      - `:5534` after Return to source, the next settle restores the source value;
      - `:5566` F-PR-03, a settle that carries a manual addition neither adopts nor drops it (see
        F-S9-05);
      - `:5598` F-PR-03, an unowned addition is withdrawn and its row deleted;
      - `:5614` a settle rekey carries the authority;
      - `:5645` `repair-match-rekeys --apply` carries the authority.

      `cleanup122` gains additive deletes for the season-prefixed keys `2093|issue122-%`, including
      `data_overrides` `player_match_stats`.
    - `tests/integration/data-editor.test.ts`, describe `Durable Match Sheet authority: rollback,
      replay and continuity (AFLDB-ISSUE-257 F-S9-03)` (`:1284`):
      - `:1533` (1) authority-write failure rolls the row back. A non-existent admin id passes the row
        write (`match-sheet.ts` step 5, `:237-275`) and fails at the step-6 `data_overrides` upsert on
        `data_overrides_admin_user_id_fkey` (`073_data_overrides.sql:18`), before the step-7 audit.
        A control save then commits. No production hook or trigger was added.
      - `:1575` (2a), `:1600` (2b), `:1623` (2c): the real Python `replay_admin_overrides(conn,
        'player_match_stats')` re-applies a field correction, recreates an addition and deletes a
        reinserted removed row.
      - `:1658` (3a) and `:1674` (3b): an unresolved key (match absent; no accepted identity) makes
        both `preflight_player_match_stats_authority` and the replay raise "refusing to commit"
        before any write.
      - `:1688` (5) the D-257-9 continuity pair. A runtime read-only SELECT looks for one player who
        holds both paths of exactly one tracked rule. If none exists it warns and calls `ctx.skip()`,
        so the skip is visible.

      Cases 2a to 5 are `it.runIf(canReplay)`. They are NOT registered unless Python with psycopg is
      found, which is why P7 below is mandatory. The suite also refuses to start its replay cases
      unless the global `player_match_stats` override count is 0.
    - `tests/integration/settle-afl-api.test.ts:2873`, `AFLDB-ISSUE-257 §17.8 — Match Sheet
      authority over an afl_api-owned row survives a re-settle`. **A realistic `afl_api`-owned
      fixture exists:** the real settle stamps `source_id = afl_api` in the F009 setup (`~:2640`) and
      in S6 (`~:4456`), with no hand-UPDATE. The case corrects `goals` and re-settles with a moved
      source. It asserts that `goals` is kept, `contested_marks` follows the source and the owner is
      unchanged.
    - **Post-promotion replay: not authored.** It needs a rebuilt candidate database, which no
      integration suite hosts. Its prediction (A4.4) is covered DB-free in
      `tests/db-promotion-check.test.ts`. The replay function itself is covered by (2a)–(3b).
  - **F-S9-05 (MED, resolved in-run by the orchestrator; no design contradiction).** The F-PR-03
    "keep" branch cannot be reached through a settle:
    - E3 refuses every unowned target (`canonical-apply.ts:1054-1055`, `autoApplyOwnership`);
    - no path sets `source_id` on an UPDATE (§19.1(e), `:713`);
    - the only legitimate route by which an addition becomes source-owned is the fitzRoy core reload
      (`fitzroy_afldata`, F-S7-01), which no integration suite runs.

    Decision: no `UPDATE source_id` that simulates a reload in the settle suite. The keep branch
    stays covered by `data-editor.test.ts:1204` and `:1229`, whose fixture provenance is the
    reload's own COPY value. `settle-afltables.test.ts:5566` proves the reachable settle behaviour:
    no adoption, no drop, and Return to source deletes the row, after which the next settle inserts
    the source's own row.
    - Unverified until run: that the §9.3 retry inserts a missing target on an unchanged
      observation. ISSUE-122's debutant case (`:2937`) suggests it does.
    - Consequence, for operator awareness: a source-carried manual addition stays unowned under the
      settle until Return to source.
  - **F-S9-06 (LOW).** §17.8's "no `afl_api`-owned row exists today" holds for real data only;
    the integration fixtures produce one. This is a runbook wording point and §17.8 was not edited.
  - **F-S9-04 became AFLDB-ISSUE-262 (Low)**, separate and not blocking. The DB-free re-run of
    `npx vitest run tests/reference-data.test.ts -t "never registered import write"` gave 1 failed
    and 50 skipped, with `+ "afl_api_identity_adjudications"` at `tests/reference-data.test.ts:425:28`.
    Correction: migration 104 belongs to **ISSUE-235**, not ISSUE-238 as the sixth run wrote.
  - **Static validation (no database variable set).**
    - `npm run typecheck`: exit 0. `tsconfig` includes `**/*.ts`, so the tests are covered.
    - eslint on the three changed test files gave 19 errors and 3 warnings, all outside the new
      blocks:
      - `settle-afl-api.test.ts` has 19 pre-existing `no-explicit-any` errors (`:211-215`, `:449`,
        `:2833`, `:2856-2857`, `:2983`, `:3042`, `:3132-3133`, `:3624`, `:3627`) and an unused
        `REAL_MATCH_ID` (`:160`). The new block is `:2865-2967` and the imports `:76-78`; none of the
        problems falls in them, and the file was unmodified before this run.
      - `data-editor.test.ts` has 2 pre-existing warnings (`:93`, `:97`).
      - `settle-afltables.test.ts` is clean.
    - **Test collection without a database is impossible for integration suites.**
      `tests/integration/guard.ts:20-24` throws when `AFLDB_TEST_DATABASE_URL` is unset, and
      `:38-45` connects when it is set. So `vitest list` exits 1 before collecting. The cases were
      enumerated statically instead, by Grep of `it(` / `it.runIf(` / `scenario(`: 10, 7 and 1. No
      DB-free suite was touched, so none was re-run.
  - **WINDOW PLAN (supersedes the sixth run's prepared plan). Operator-run, step by step, and stop
    at any unmet condition.** Environment variables are named here; values are never written into a
    file or onto a command line, and no `.env` is created.
    - **Fingerprint F.** Taken as the owner. It consists of:
      - **F1:** `SELECT count(*), max(name) FROM afldb_meta.schema_migrations;` plus the last 5 names;
      - **F2:** `pg_get_constraintdef` and `obj_description` of
        `data_overrides_entity_type_check`, verbatim;
      - **F3:** `SELECT entity_type, is_active, count(*) FROM data_overrides GROUP BY 1, 2 ORDER BY
        1, 2;`;
      - **F4 (canonical, must be equal):** exact counts of `matches`, `player_match_stats`,
        `players`, `external_identities`, `data_overrides`, `seasons` and `auth_users`;
      - **F5 (ledgers, delta recorded and attributed):** `data_edits`, `canonical_applications`,
        `import_batches`, `data_issues`, `import_rejections`, `promotion_candidates`,
        `staging.source_records` and `staging.source_record_versions`. Any delta not explained by a
        suite's documented append-only write is residue;
      - **F6 (residue probes, must be 0):** `data_overrides WHERE entity_type =
        'player_match_stats'` and `matches WHERE match_key LIKE '%issue122-%'`, plus each touched
        suite's own fixture-leftover gate passing.

      "Residue zero" means: F4 and F6 equal to the baseline, F5 deltas attributed, and the guard
      PERMITTED.
    - **`afldb_test` window.** The variables are `AFLDB_TEST_DATABASE_URL` (owner),
      `AFLDB_TEST_IMPORT_DATABASE_URL`, `AFLDB_IMPORT_DATABASE_URL` (equal to the test import DSN)
      and `AFLDB_AUTH_DATABASE_URL`, each naming `afldb_test`, plus `AFLDB_PYTHON`. Do not set the
      `AFLDB_CODE_TEST_*` variables.
      - **P0–P6 as written in the sixth run**, with these binding changes:
        - P1 must show exactly `afldb_test` and the owner role. The same query on the import DSN
          must show `afldb_test` / `afldb_import`.
        - P2 must show 109 applied, 110 PENDING and no drift. Anything else STOPS before 110.
        - P5 lists `pid, usename, application_name, backend_type, state, xact_start, left(query,
          80)` from `pg_stat_activity WHERE datname = 'afldb_test' AND pid <> pg_backend_pid()`.
          Any `active`, `idle in transaction` or `idle in transaction (aborted)` row STOPS. So does
          an `idle` client the operator cannot attribute.
        - P5b: `SELECT pid, locktype, relation::regclass, mode, granted FROM pg_locks WHERE pid <>
          pg_backend_pid() AND (database = (SELECT oid FROM pg_database WHERE datname =
          'afldb_test') OR locktype = 'advisory');` must return no rows.
        - The operator confirms that no migration, rebuild or test runner from another worktree or
          session is running.
        - On any failure, STOP before 110 and before any write, and report the blocking sessions.
      - **P7 (DB-free).** `& $env:AFLDB_PYTHON -c "import psycopg"` exits 0. Without it, data-editor
        cases 2a–5 silently do not register.
      - **P8.** Record fingerprint F as baseline B0 (F2 is also the reversal input, as in P3).
      - **§4.1 State A (old CHECK).** The sixth-run list, plus:
        - `npx vitest run tests/integration/settle-afltables.test.ts -t "F-S9-03"`: 10 collected,
          all early-return no-ops;
        - `npx vitest run tests/integration/data-editor.test.ts -t "F-S9-03"`: 7 collected,
          no-ops;
        - `npx vitest run tests/integration/settle-afl-api.test.ts -t "afl_api-owned row survives"`:
          1 collected, a no-op.

        The State A no-ops are recorded as collection and State A safety evidence only, not
        behaviour evidence.
      - **§4.2.** `npm run db:migrate:test` applies 110 only. Then P2 and P3 (14 literals, new
        comment), and the guard is PERMITTED.
      - **§4.3 State B.** The sixth-run list, then the three F-S9-03 commands above, in that order.
        Expected counts:
        - `settle-afltables`: 10 passed;
        - `data-editor`: 7 collected; case (5) is the only allowed skip, with its "no continuity
          pair" message;
        - `settle-afl-api`: 1 passed.

        After each suite, F3, F6 and the guard: count 0 and PERMITTED. A non-zero count STOPS
        before §5. Fewer than 7 collected in `data-editor` means P7 failed, so STOP. The 40P01
        witness stays skipped.
      - **§5.** S5.1–S5.4 as written in the sixth run. S5.3 is the validation of the F-PR-04
        reversal SQL and is the precondition for the `code_test_db` reversal.
      - **FINAL STATE (binding; replaces the sixth run's operator choice):**
        - 110 reversed through the guarded F-PR-04 reversal: guard PERMITTED (exit 0), then the
          transaction;
        - the CHECK is byte-identical to B0's F2 (the 102 form and comment);
        - P2 shows 110 PENDING and F1 equals B0 (the ledger matches `main`);
        - F4 and F6 equal B0, and F5 deltas are attributed;
        - zero ISSUE-257 authority residue, no test or rehearsal residue, and P5/P5b clean;
        - the exact final fingerprint F is recorded here as B-final.
    - **`code_test_db` window (only after the `afldb_test` window ends at its FINAL STATE, with S5.3
      PASS).** The variables are `AFLDB_CODE_TEST_DATABASE_URL` (owner) and
      `AFLDB_CODE_TEST_IMPORT_DATABASE_URL` (import), each naming `code_test_db`. `DATABASE_URL`
      MUST name `code_test_db` (corrected 2026-10-03, F-S11-03 decision: unset aborts the harness;
      harness `:1924-1929`), plus `AFLDB_PYTHON`. Leave
      `AFLDB_IMPORT_DATABASE_URL` unset; the harness sets it per call (`:1960`).
      - **C1 identity.** `SELECT current_database(), current_user;` on both DSNs must give exactly
        `code_test_db` with the owner role, then `code_test_db` with `afldb_import`.
      - **C2 exclusivity.** P5 and P5b with `datname = 'code_test_db'`: no competing work.
      - **C3 baseline.** Run `npx tsx tools/db/migrate.ts --status --target code-test`. **110 must be
        the ONLY pending migration**; otherwise `db:migrate:code-test` would apply more, so STOP.
        Then record fingerprint F as C0, with the exact CHECK and comment text, and run `npx tsx
        tools/db/issue257-rollback-guard.ts --target code-test`, which must be PERMITTED.
      - **C4 old CHECK.** Run each of the following as `npx tsx --conditions=react-server
        tools/db/afl-api-identity-correction-rehearsal.ts run <args> --acknowledge code_test_db`:
        - `--case 16`;
        - `--case 70`;
        - `--case 88`;
        - `--case 91`;
        - `--case 100 --variant match-sheet`;
        - `--case 100 --variant brownlow-draft`;
        - `--case 101`.

        Expected (F-S3-01): 091 and 100 are stale-save refusals; 016, 070, 088 and 101 are
        authority-unavailable refusals with rows unchanged. After each case the guard must be
        PERMITTED.
      - **C5.** `npm run db:migrate:code-test`. Then the status shows 110 applied and the CHECK
        holds 14 literals and the new comment.
      - **C6 widened CHECK.** The same seven commands. Expected: 091 and 100 are stale refusals;
        070, 088 and 101 save with an active override of the right `field_group`; 016 reaches the
        ISSUE-257 `manual_authority_present` STOP. After each case F6 and the guard must show 0 and
        PERMITTED; the harness's `FIXTURE_TABLES` clears its keys.
      - **C7 reversal.** The guard is PERMITTED, then the F-PR-04 reversal transaction runs as the
        owner, using C3's CHECK and comment text. The status must show 110 PENDING, the CHECK must
        be byte-identical to C0, and F must equal C0 (F5 attributed). **The reversal used is the
        F-PR-04 SQL validated at `afldb_test` S5.3. If S5.3 did not pass, or any step differs, STOP;
        do not improvise.**
      - **Report.** Each case is reported by ID, variant and schema state (A/B) with its outcome.
        Evidence is recorded here under ISSUE-257. ISSUE-238 keeps only its §14.8 compatibility note
        and stays closed.
    - **Estimated duration.**
      - `afldb_test`: preflight 10 min; §4 about 60–80 min (the new settle cases are 300 s-capped
        each); §5 15 min; final state 5 min.
      - `code_test_db`: about 30–45 min.
- **Eighth run (2026-10-03). The `afldb_test` window was run under the operator's authorisation and
  STOPPED in §4.3 on residue. The database was safe-stopped and the `code_test_db` window was not
  opened.** Return `19-*`.
  - **Start state.** Branch and HEAD `3ed70ab1`. The 39 modified files and the 3 expected untracked
    files were verified. No sub-agent was spawned. The decision on F-S9-05 was recorded first
    (§19.3). F-S9-06 (LOW, §17.8 wording) stays as noted in the seventh run; §17.8 was not edited.
  - **Environment.** DSNs were set per process only, from the main checkout's `.env` with CR trimmed
    and the host port rewritten to the 55432 tunnel. No `.env` was created and no DSN was printed.
    `DATABASE_URL` was unset; `tests/setup.ts:57` sets it from the test DSN.
  - **Preflight: PASS.**
    - P0: the tunnel is up.
    - P1: owner `afldb_test`/`afldb_owner`; import `afldb_test`/`afldb_import`.
    - P2: `migrate.ts --status --target test` exit 0, so no drift. 109 applied, 110 the only
      pending.
    - P5: no other session. P5b: no lock.
    - P6: guard PERMITTED, State A.
    - P7: psycopg 3.3.5.
  - **B0** (owner):
    - F1: 109 rows, max `109_import_reads_player_match_period_stats.sql`.
    - F2: the 102 form, 13 literals. md5 of the definition `f163aaed…b247`; md5 of the comment
      `72ef0d6f…7a36`.
    - F3: `players|t|92`.
    - F4: `matches` 16,838; `player_match_stats` 685,471; `players` 13,365;
      `external_identities` 19,318; `data_overrides` 92; `seasons` 130; `auth_users` 1.
    - F5: `data_edits` 17 (max id 89); `import_batches` 27; `data_issues` 4;
      `import_rejections` 681; `canonical_applications`, `promotion_candidates` and both staging
      tables 0.
    - F6: 0 and 0.

    The reversal SQL was generated from B0's live constraint text: `pg_get_constraintdef` and
    `format('%L')` of the comment.
  - **§4.1 State A.** After every suite, F3 and F6 were 0 and the guard was PERMITTED.

    | Command | Result |
    |---|---|
    | `settle-afltables -t "proves from the live CHECK"` | 1 passed |
    | `admin-awards -t "no settle target"` | 1 passed |
    | `special-records-lifecycle -t "no settle target"` | 1 passed |
    | `match-admin-delete` | 7/7 |
    | `settle-afltables -t "F-S9-03"` | 10 passed (State A no-ops) |
    | `settle-afl-api -t "afl_api-owned row survives"` | 1 passed (no-op) |
    | `data-editor`, first run | 9 failed / 22 passed |
    | `data-editor`, after the fixes below | 3 failed / 28 passed |
    | `data-editor -t "F-S9-03"`, before the fixes | 7 collected (so P7 held): 6 failed, 1 passed |

    The first runner attempt aborted part-way through `data-editor`. A PowerShell `Stop`
    preference terminated the runner on native stderr. The fingerprint was re-taken, equal to B0,
    and no session was left.
    - **Six F-S9-03 cases failed, a test-authoring defect, fixed mechanically.** In cases (1),
      (2a), (2b), (2c), (3a) and (3b), `pickSingle` hit `statement timeout`. The fixture-pick query
      takes 28–41 s on `afldb_test`; this was measured read-only. The application client's
      `statement_timeout` is 5 s (`src/db/client.ts:22`).
      - Fix: `pickSingle` and `pickFolded` run in a `READ ONLY` transaction with
        `set_config('statement_timeout', '300s', true)`. Same query, same row.
    - **F-S10-01 (LOW).** Three pre-257 cases save a real row:
      - "propagates kicks correctly";
      - ISSUE-027 "persists the match-sheet mutation…";
      - ISSUE-083 "commits the production match-sheet…".

      Under State A they return `ok: false`. This is the designed refusal:
      `buildMatchSheetAuthorityWrites` returns `AUTHORITY_UNAVAILABLE_REFUSAL`
      (`match-sheet-authority.ts:816`, D-257-0) for any effective save while the CHECK cannot store
      authority. The suite is not schema-state-aware. Under State B all three pass, and the only
      schema-dependent refusal in the writer is the authority-unavailable refusal. The cases were not
      changed, because changing them would change their expected outcome.
      - Pre-emptive mechanical fix (a fixture-cleanup omission): these cases register their match in
        `legacySheetMatches`. A file-level `afterEach` deletes the `player_match_stats` authority
        keyed to that match. Without it, State B would leave residue and break the F-S9-03 replay
        suite's clean-authority precondition.
    - After the fixes: `npm run typecheck` exit 0. eslint on `data-editor.test.ts`: 0 errors and
      2 pre-existing warnings (`seasonBaseline`, `careerBaseline`).
    - F5 after State A: `data_edits` +2, ids 98 and 99 (`match_deletion`, ISSUE-177 /
      ISSUE-177-253). They come from `match-admin-delete.test.ts`. Attributed.
  - **§4.2.** `npm run db:migrate:test` applied 110 only, in 214 ms. Status showed 0 pending. The
    CHECK held 14 literals and the new comment: definition md5 `8485a110…7e57`, comment md5
    `37f2fe81…2b`. The guard was PERMITTED (State B, 0).
  - **§4.3 State B: STOPPED after the first suite.** `data-editor.test.ts` in full gave 14 failed
    and 17 passed (31).
    - The 3 pre-257 cases passed.
    - Every one of the 14 ISSUE-257 cases failed with `cannot insert a non-DEFAULT value into
      column "id"`. The failures were the 7 Slice 3/7 delete-guard and Return-to-source cases and
      the 7 F-S9-03 cases.
    - **F-S10-02 (MED; test-only defect; caused data loss on `afldb_test`).** Both restore helpers
      (`data-editor.test.ts` Slice 3/7 describe, about `:1156`; F-S9-03 describe, about `:1540`)
      `DELETE` the row, then `INSERT INTO player_match_stats SELECT * FROM jsonb_populate_record(…)`.
      `player_match_stats.id` is `GENERATED ALWAYS` (`attidentity = 'a'`, and the only identity or
      generated column), so the insert fails after the delete has already run.
      - The thrown error comes from `finally`. It masks each case's own assertions, so **the
        State B behaviour of the 14 cases is unverified**.
      - Fix applied: `INSERT INTO player_match_stats OVERRIDING SYSTEM VALUE SELECT * …`, which also
        keeps the original `id`. **Not re-run**, because the window had stopped.
    - **Residue.** After the suite, F3 and F6 were 0 and the guard was PERMITTED. F4
      `player_match_stats` fell from 685,471 to 685,457 (−14). The lost rows were found read-only, by
      comparing stored `player_season_stats.games` with the rows that remain:
      - match 1 (`1897|1|1897-05-08|Collingwood|St Kilda`, now 27 rows): players 366, 431, 735, 795,
        1293, 1531, 1573, 1582, 1605, 1674, 1715 and 1775, plus almost certainly 716. Player 716's
        Return to source recomputed its derived stats, so the comparison cannot see it.
      - match 14443 (`2014|9|2014-05-15|Adelaide|Collingwood`): player 2604.

      The original values are not recoverable from the database. The derived statistics of the
      12 detectable players are stale. F5 `data_edits` +7 more: ids 114–118 (`issue-257 slice 7
      test`, Return to source, match 1) and 119–120 (`issue-257 f-s9-03 test`). Their restore did
      not complete. They were left in place and are attributed.
  - **Safe stop.**
    - The guard was PERMITTED (0), then the F-PR-04 reversal committed: overrides deleted 0, CHECK
      and comment re-added from the B0 text, ledger row 110 deleted.
    - `migrate.ts --status`: 110 PENDING, no drift.
    - Against B0: F1, F2 (both md5 identical), F3 and F6 are equal. **F4 does not match:
      `player_match_stats` is 685,457, 14 short.** F5 `data_edits` is 26 (+9, all attributed above).
    - P5 and P5b are clean. No vitest process remains.
    - Per the operator's rule, nothing further was improvised: no canonical row was re-created, and
      no test audit row was deleted.
    - **S5.1–S5.4 not run. The reversal was exercised once here, but S5.3 as specified (rollback
      before the first record, inside the §5 sequence) did not run. The `code_test_db` window was
      not opened.**
  - **Read-hook artefact.** "`` `${p.matchKey} ``": zero bytes, untracked, created 07:26:07. It
    was named from `keyOf`'s `` => `${p.matchKey}| ``. Deleted with `Remove-Item -LiteralPath`.
  - **Resumption.**
    1. The operator restores `afldb_test`, for example by rebuilding from a checkout without
       migration 110 so the ledger again ends at 109.
    2. A new P0–P8 and B0.
    3. §4.1 again: the data-editor fixes are now in the file. The three pre-257 State A failures
       (F-S10-01) are expected.
    4. §4.2, then §4.3 from `data-editor` onward, then §5, the final state and the `code_test_db`
       window.

    Before §4.3, the next run should confirm that no other ISSUE-257 integration case restores
    `player_match_stats` with `SELECT *`. Grep found this pattern only in `data-editor.test.ts`.
- **Test-fixture rewrite (2026-10-03, no database touched).** This implements the operator's
  decisions on F-S10-02 and F-S10-01. Returns `21a-*` (worker) and `21-*` (orchestrator).
  - **Decision F-S10-02 (operator, 2026-10-03).** Every test owns synthetic fixtures, and cleanup
    runs even when an assertion fails. Derived stats are isolated or recomputed. The unapproved
    `OVERRIDING SYSTEM VALUE` fix is replaced. The run must show that historical rows are unchanged
    and that no fixture data remains. Testing resumes only after `afldb_test` is restored and a fresh
    B0 is captured.
  - **Decision F-S10-01 (operator, 2026-10-03).** The three pre-257 cases become
    schema-state-aware, mirroring F-S3-01.
    - State A: assert the authority-unavailable refusal and verify that nothing was written.
    - State B: assert the save succeeds and verify the persisted values.
    - The state is determined explicitly, never inferred from a failed save, and no case is skipped.
  - **What changed.** Only `tests/integration/data-editor.test.ts` changed.
    - Namespace: season 2079 (Grep showed no other suite uses it) and match keys
      `2079|issue257-<token>`, since a durable key must start with its season. The absent-key
      control is `9999|issue257-…`, player slugs are `issue257-<token>`, and AFL Tables paths are
      `issue257_players/…`. `clubs` and `sources` are only read.
    - `seedFixture257` commits a match, a player, an accepted identity (none or both continuity
      paths where a case needs that), one source-owned row, and the derived rows from
      `recomputePlayerDerivedStats`.
    - `cleanup257` is idempotent and FK-ordered. It covers `data_overrides`, `data_edits`,
      `player_match_stats`, the four derived player tables, `club_seasons` for 2079,
      `external_identities`, `players` and `matches`. The 2079 `seasons` row is deleted only when no
      match references it. Cleanup runs in `beforeAll`, `afterEach` and `afterAll`.
    - Removed: `restore()`, `OVERRIDING SYSTEM VALUE`, `jsonb_populate_record`, `pickPlayer`,
      `pickSingle`, `pickFolded`, `strayKeys` and `legacySheetMatches`.
  - **Guards (file-level `afterAll`).**
    - Residue: every namespace row in 12 tables, matched by prefix and by the ids this run seeded,
      must count 0.
    - Historical rows: exact counts of `player_match_stats`, `player_season_stats`,
      `player_career_stats`, `player_club_season_stats`, `player_clubs` and `club_seasons`, plus a
      `hashtextextended(to_jsonb(row))` checksum over a deterministic 1/61 sample of
      `player_match_stats` (`(player_id + match_id) % 61 = 0`). These must equal the baseline taken
      after the `beforeAll` pre-clean.
      - The snapshot runs read-only with a local 300 s `statement_timeout`. Its cost has not been
        measured; the estimate is seconds, because only the sampled rows are hashed.
      - The guard is valid because `vitest.config.mts:21` sets `fileParallelism: false`.
      - Counts catch lost or duplicated rows, the F-S10-02 failure. The sample catches in-place
        edits only probabilistically.
  - **Cases on fixtures.**
    - Pre-257: "propagates kicks correctly", ISSUE-027 "persists…", ISSUE-027 "rolls … back" and
      ISSUE-083 "commits…".
    - Slice 3: all 4 cases.
    - Slice 7: all 7 cases, including both F-S7-01 cases.
    - F-S9-03: cases (1), (2a), (2b), (2c), (3a), (3b) and (5).
    - Case (5) seeds a synthetic player holding both paths of a tracked `profile_url_continuity`
      rule, and only when no `external_identities` row and no other rule names those paths.
      Otherwise it calls `ctx.skip()` with a warning. It never mutates a real row.
  - **F-S10-01 cases.** The schema state is read with `playerMatchStatsAuthorityStorable(sql)`
    before the save.
    - State A: `{ ok: false, error: AUTHORITY_UNAVAILABLE_REFUSAL }`, a whole-row `to_jsonb`
      snapshot unchanged, no `data_overrides` for the match key, and no `data_edits` for the match.
    - State B: `ok`, the new kicks persisted (case 1 also checks season and career kicks +1), one
      active `match_sheet` authority, and the audit row for the ISSUE-027 and ISSUE-083 cases.
    - The ISSUE-083 case now changes kicks by 1. An unchanged save plans nothing, so it could prove
      neither state.
  - **Sweep of the other suites.** `OVERRIDING SYSTEM VALUE` and `jsonb_populate_record` no longer
    appear in any integration test on `player_match_stats`.
    - `settle-afltables.test.ts:4897` targets `import_batches` with explicit ids. It is not
      ISSUE-257.
    - Every other `DELETE FROM player_match_stats` is keyed by fixture ids or slugs.
    - The ISSUE-257 cases in `settle-afltables.test.ts` (`:5137`, `2093|issue122-257-…`) and
      `settle-afl-api.test.ts` (`:2873`, settle-created fixture) are already synthetic.
    - The ISSUE-257 hits in `admin-awards` and `special-records-lifecycle` are read-only CHECK
      assertions.
  - **Validation (no database).** `npm run typecheck` exit 0. eslint on the file: 0 errors and
    0 warnings. `git diff --check` clean, with only the existing CRLF notice for `match-sheet.ts`.
    **Not run at runtime**: the next `afldb_test` window, after the restore and a fresh B0, is the
    first execution.
  - **Notes (INFO).**
    - The out-of-scope ISSUE-083 case "inserts and updates a durable override atomically" still
      updates a real match's `notes` and restores them by UPDATE. Nothing is deleted or
      re-inserted, and the guard does not cover `matches`.
    - The worker reports, unverified here, that the old kicks-only pre-257 saves replaced the whole
      real row. If so, earlier State B runs may also have nulled other columns on the real rows they
      picked. The `afldb_test` restore covers that either way.
    - The ISSUE-027 "rolls … back" case stays as authored. Under State A it fails at the authority
      refusal before the audit, so it proves the audit rollback only in State B.
- **Rebuild run (2026-10-03). `afldb_test` restored by a full `db:test:rebuild` from a clean
  checkout without migration 110; fresh B0 captured. No ISSUE-257 test was run.** Return
  `20-rebuild-afldb-test.md`. Operator authorisation of 2026-10-03 (clean checkout, `npm ci`,
  staging, rebuild of `afldb_test` only, verification, fresh B0).
  - **Checkout.** A temporary detached worktree `D:\dev\afldb-257-rebuild` at `3ed70ab1`, no branch.
    Its `src/db/migrations/` ends at `109_import_reads_player_match_period_stats.sql`; there is no
    110. `npm ci` was run there because it had no `node_modules`. No `.env` was created anywhere.
  - **Inputs staged** (gitignored bytes copied into the clean checkout; the preflight re-verified
    every hash before anything was destroyed):
    - fitzRoy `full-history-20260902`, 131 files, from the off-tree
      `D:\backups\afldb\issue-112-staging-20260902\…\full-history-20260827`. The preflight printed
      `accepted canonical baseline VERIFIED`, manifest `2bd66e3d…a0c1`, artefact set `15ba5dc6…dd6c`.
    - From the main checkout, read-only: `ladder-20260828` (129 files, every manifest sha256
      PASS), `issue129-t7-20260903` (3), `club-lists-20260905` (43; 21 club artefacts verified),
      `rosters-20260905` (16; 15 season artefacts verified), DraftGuru `annual-html-20260826` (90;
      42 year pages sha256 verified) and `person-html-20260826` (247), and
      `data/records/first-kick-goal.csv` (sha256 `8f234f3b…` OK, 334 rows, exact manifest join).
    - A preflight-only invocation (no `--acknowledge-destroy`) passed every check and refused only
      at the acknowledgement.
  - **Target proof before the rebuild.** The tunnel on 55432 was up. The owner DSN gave
    `afldb_test`, server port 5432, `afldb_owner`; the import DSN gave `afldb_test`/`afldb_import`.
    `pg_stat_activity` and `pg_locks` showed no other session or lock. Pre-rebuild state equalled
    the eighth run's safe stop: 109 rows, both md5s as B0, `player_match_stats` 685,457,
    `data_edits` 26 (max id 120), `import_batches` 27.
  - **Rebuild.** `npm run db:test:rebuild -- --target afldb_test --acknowledge-destroy afldb_test`
    (default DraftGuru label `annual-html-20260826`; capture root `D:\afldb-rebuild-captures`).
    Data stages ran as the restricted `afldb_import` role; `--allow-owner-import-dsn` was not
    used. Started 08:01:58, `Rebuild complete.` at 08:28:34 (26 min 36 s), exit 0.
    - Census `verdict=pass total=0`. Capture: 0 adjudications, 802 importer identities and 92
      manual registrations; all reinstated, bijection OK and the rebuild marker cleared. The capture
      was archived as `afl-api-identities.20261002T220228129Z.14ab40c178b0.reinstated.json`.
    - `AFLDB-FINAL-VALIDATION PASSED: 89 checks`, including `player_match_rows = 685471`.
  - **Verification (read-only, owner unless noted).**
    - Ledger: 109 rows, max `109_import_reads_player_match_period_stats.sql`. `migrate.ts --status
      --target test` exit 0, 0 pending, from the clean checkout. From this worktree, exit 0 with
      only `110_match_sheet_player_match_stats_authority.sql` PENDING.
    - CHECK: definition md5 `f163aaedd91e7aec2d6cc592dcfab247`, comment md5
      `72ef0d6ff54695071405595f6d077a36`. Both equal the eighth run's B0 (the 102 form, 13
      literals).
    - **The 14 lost rows are back.** Match 1 (`1897|1|1897-05-08|Collingwood|St Kilda`) has 40 rows
      (27 + 13), which confirms player 716 was among the lost. Match 14443
      (`2014|9|2014-05-15|Adelaide|Collingwood`) has 44. Every one of players 366, 431, 716, 735,
      795, 1293, 1531, 1573, 1582, 1605, 1674, 1715, 1775 (match 1) and 2604 (match 14443) has a
      row with `source_id` 9 (`fitzroy_afldata`) and `import_batch_id` 5. Neither match has a row
      without a source.
    - **Derived stats consistent for all 14 players.** For each, the `player_match_stats` row count
      equals the sum of `player_season_stats.games`, the sum of `player_clubs.games` and
      `player_career_stats.games`, and `career_game_no` runs 1..n with n distinct values.
    - `data_overrides` with `entity_type = 'player_match_stats'`: 0.
      `issue257-rollback-guard.ts --target test` from this worktree: State A, 0 rows, PERMITTED,
      exit 0.
  - **Against the pre-incident B0.** F1, F2, F3, F4 and F6 are equal: `player_match_stats` is
    685,471 again. F5 differs, and only in ledgers that a rebuild resets:
    - `data_edits` 17 → 0. The rebuild recreates the schema and does not carry the audit ledger,
      by design (ISSUE-245). The 17 were earlier admin/test history and the 9 incident-run rows
      (ids 98–120) went with them.
    - `import_batches` 27 → 26. The 26 are the rebuild's own batches, ids 1–26, one per data stage.
      The previous database's 27th batch came from activity after its own rebuild. It can no longer
      be identified from the rebuilt database.
    - `data_issues` 4 and `import_rejections` 681 are equal; the rest are 0 on both sides.
    - The rebuild also discards any column drift that earlier State B runs may have left on real
      rows (see the INFO note above).
  - **Fresh B0 (owner, after the rebuild; supersedes the eighth run's B0).**
    - F1: 109 rows, max `109_import_reads_player_match_period_stats.sql`; last five 109, 108, 107,
      106, 105.
    - F2: the 102 form, 13 literals. Definition md5 `f163aaedd91e7aec2d6cc592dcfab247`, comment
      md5 `72ef0d6ff54695071405595f6d077a36`.
    - F3: `players|t|92`.
    - F4: `matches` 16,838; `player_match_stats` 685,471; `players` 13,365;
      `external_identities` 19,318; `data_overrides` 92; `seasons` 130; `auth_users` 1. The one
      `auth_users` row is the attribution-only actor that the registration reinstate recreated
      (disabled, no credentials).
    - F5: `data_edits` 0 (no max id); `canonical_applications` 0; `import_batches` 26;
      `data_issues` 4; `import_rejections` 681; `promotion_candidates` 0;
      `staging.source_records` 0; `staging.source_record_versions` 0.
    - F6: 0 and 0. P5 and P5b are clean.
  - **Cleanup.** `git worktree remove D:\dev\afldb-257-rebuild` succeeded without `--force` (exit
    0; the path is gone), and the staged bytes and `node_modules` went with it. Nothing was staged
    into this worktree or the main checkout.
  - **Read-hook artefacts in this worktree.** All were zero bytes and untracked, and each was
    deleted with `Remove-Item -LiteralPath`: `!report.executed.includes(id))` (07:57:51),
    `Number.isInteger(id)` (07:59:29), and `` `${p.matchKey} `` (07:57:35, and again at 08:10:08).
- **Run B relaunch (2026-10-03). The `afldb_test` window completed and ended at its final state
  (B-final = fresh B0, F5 attributed). The `code_test_db` window ran C1–C6 and SAFE-STOPPED in C6 on
  a new MED harness finding (F-S11-03), after which C7 restored `code_test_db` exactly to C0. Not
  ready for DEV.** Return `22-orchestrator-run-b-relaunch.md`. No sub-agent was spawned. No
  implementation or test file was changed in this run.
  - **Start state.** Branch and HEAD `3ed70ab1`; 39 modified files and exactly the 3 expected
    untracked files. DSNs were set per process only (CR trimmed, port rewritten to 55432; no `.env`
    created, no DSN printed).
  - **`afldb_test` preflight: PASS.** P0 tunnel up. P1 owner `afldb_test`/`afldb_owner`, import
    `afldb_test`/`afldb_import`, auth `afldb_test`/`afldb_auth`. P2 exit 0: 109 applied, 110 the only
    pending. P5/P5b: no session, no lock. P6 guard State A, PERMITTED. P7 psycopg 3.3.5. P8 fingerprint
    equal to the fresh B0 in every component (F1–F6).
  - **§4.1 State A.** After each suite F2–F6 equalled B0 and the guard was PERMITTED.

    | Command | Result |
    |---|---|
    | `data-editor.test.ts` (alone, first) | 31/31; file-level residue and historical-row guards passed |
    | `data-editor -t "F-S9-03"` | 7 passed (State A no-ops) |
    | `settle-afltables -t "proves from the live CHECK"` | 1 passed |
    | `admin-awards -t "no settle target"` | 1 passed |
    | `special-records-lifecycle -t "no settle target"` | 1 passed |
    | `match-admin-delete` | 7/7 |
    | `settle-afltables -t "F-S9-03"` | 10 passed (State A no-ops) |
    | `settle-afl-api -t "afl_api-owned row survives"` | 1 passed (no-op) |

    The three F-S10-01 cases passed state-aware (authority-unavailable refusal, nothing written).
  - **§4.2.** `npm run db:migrate:test` applied 110 only (234 ms). CHECK: 14 literals, definition md5
    `8485a11052b93c3eb28fbe73fdbcfe57`, comment md5 `37f2fe81eaaf0bc26511bb799dd55f2b`. Guard
    PERMITTED.
  - **§4.3 State B.** After each suite F3/F4/F6 equalled B0 and the guard was PERMITTED (0).

    | Command | Result |
    |---|---|
    | `data-editor.test.ts` (alone, first) | 30 passed, 1 skipped (case (5), with its "no tracked profile_url_continuity rule is collision-free" warning; the allowed skip); residue and historical-row guards passed; 112 s |
    | `settle-afltables -t "proves from the live CHECK"` | 1 passed |
    | `settle-afltables` (full) | 75/75 |
    | `settle-afl-api` (full) | 72/72 |
    | `admin-brownlow` (full) | first attempt: `beforeAll` (`:73`) exceeded the global 30 s hook timeout, 44 skipped; re-run with the CLI flag `--hookTimeout=300000` (no file edit): 42 passed, 2 failed (F-S11-01, F-S11-02) |
    | `admin-awards -t "no settle target"` | 1 passed |
    | `special-records-lifecycle -t "no settle target"` | 1 passed |
    | `settle-afltables -t "F-S9-03"` | 10 passed |
    | `data-editor -t "F-S9-03"` | 7 collected: 6 passed, case (5) skipped |
    | `settle-afl-api -t "afl_api-owned row survives"` | 1 passed |

    F-S10-03 (data-editor hook timeout) did not occur; no timeout was raised.
  - **§5.**
    - S5.1: guarded reversal (guard PERMITTED, pre-count 0, COMMIT); 110 PENDING; CHECK md5s equal
      B0. State A code: the live-CHECK case and `data-editor -t "propagates kicks correctly"`
      (authority-unavailable refusal) passed.
    - S5.2: `db:migrate:test` applied 110 only; the same two commands passed on the State B branch.
    - S5.3 (rollback before the first record): guard PERMITTED, reversal COMMIT, CHECK equal to B0.
      **PASS.**
    - S5.4 (after the first record): 110 re-applied; one owner fixture row
      `issue257-guard|s54-fixture` (id 187) inserted; guard REFUSED, exit 2; the narrow `ADD
      CONSTRAINT` inside `BEGIN … ROLLBACK` raised `check constraint … is violated by some row`;
      the CHECK stayed wide; the fixture was deleted; guard PERMITTED. **PASS.**
  - **`afldb_test` final state (B-final).** Guarded reversal committed; 110 PENDING (status exit 0).
    F1 109 rows, tail 109…105, ledger = `main`. F2 byte-identical to B0 (md5s
    `f163aaedd91e7aec2d6cc592dcfab247` / `72ef0d6ff54695071405595f6d077a36`, 13 literals). F3
    `players|t|92`. F4 16,838 / 685,471 / 13,365 / 19,318 / 92 / 130 / 1 (= B0). F6 0. P5/P5b clean;
    guard State A, PERMITTED. F5 deltas, all attributed: `data_edits` 0 → 2 (ids 5 and 6,
    `match_deletion` audits written by `match-admin-delete`, "AFLDB-ISSUE-177 happy path" and
    "AFLDB-ISSUE-177-253 detach proof"); `import_batches` 26 → 29 (ids 66–68, `afltables` "AFLDB-ISSUE-099
    settle; snapshot=issue122-s6-cli", from the full `settle-afltables` run). Every other F5 ledger
    unchanged. The `data_overrides` id sequence advanced (S5.4); it is not part of F.
  - **`code_test_db` window.**
    - C1: owner `code_test_db`/`afldb_owner`; import `code_test_db`/`afldb_import`. C2: no session,
      no lock.
    - C3: 109 applied, 110 the ONLY pending; guard PERMITTED. **C0**: F1 109 (tail 109…105); F2
      the same md5s as B0, and the definition and `format('%L')` comment text byte-equal to B0, so the
      S5.3-validated reversal SQL was used verbatim; F3 no rows; F4 16,838 / 685,471 / 13,273 /
      18,333 / 0 / 130 / 1; F5 `data_edits` 0, `canonical_applications` 0, `import_batches` 26,
      `data_issues` 4, `import_rejections` 681, the rest 0; F6 0.
    - C4 first attempt: all seven ABORTED before any write. `@/db/client` throws on import when
      `DATABASE_URL` is unset, and the harness reports it as "the real writers are server-only
      modules … (DATABASE_URL is not set)". Harness teardown PASS, F6 0, guard PERMITTED. The C-window
      wording "`DATABASE_URL` unset or naming `code_test_db`" is therefore half wrong: it must name
      `code_test_db` (harness `:1927-1929`). It was set to the `code_test_db` owner DSN (LOW, wording).
    - **C4 (old CHECK, State A): all PASS**, guard PERMITTED and F6 0 after each:

      | Case | Checks | Outcome |
      |---|---|---|
      | 016 | 12/12 | authority-unavailable refusal, nothing saved |
      | 070 | 21/21 | authority-unavailable refusal after the correction |
      | 088 | 21/21 | removal refused, authority-unavailable |
      | 091 | 30/30 | stale-save refusal; row byte-identical; no audit; no override |
      | 100 match-sheet | 28/28 | stale-save refusal; nothing inserted; no audit; no override |
      | 100 brownlow-draft | 26/26 | `saveDraftBrownlowMatch` refused `not_participant` |
      | 101 | 21/21 | authority-unavailable refusal |

    - C5: `npm run db:migrate:code-test` applied 110 only (142 ms); 0 pending; CHECK 14 literals, the
      State B md5s.
    - **C6 (widened CHECK, State B): 3 PASS, 4 FAIL.** 091 30/30, 100 match-sheet 28/28 (stale
      refusals) and 100 brownlow-draft 26/26 PASS. **016 (9/16, ABORTED: "validate-only did not
      STOP"), 070 (22/28), 088 (20/28) and 101 (23/29) FAIL.** Each failure is the same first refusal,
      `Player #… cannot be saved: invalid_key (invalid_match_key). Nothing was saved.`, and every later
      failing check cascades from it (no save, no authority, no audit, so 016 cannot reach
      `manual_authority_present`, and Q2 sees no post-correction edit). After every case the harness
      teardown passed (zero ISSUE-238 fixture residue, foreign fingerprint equal), F6 was 0 and the
      guard PERMITTED.
    - **SAFE-STOP, then C7.** Guard PERMITTED, then the reversal committed (pre-count 0). Status: 110
      PENDING. **Final `code_test_db` equals C0 exactly** in F1, F2 (both md5s), F3, F4, F5 (no delta)
      and F6. P5/P5b clean.
  - **F-S11-03 (MED; harness-only; verification blocking; NOT fixed).** The ISSUE-238 rehearsal
    harness mints fixture match keys `issue238-rehearsal:<case>:<n>`
    (`tools/db/afl-api-identity-correction-rehearsal.ts:131`, `:524`). A durable
    `player_match_stats` key needs a season-prefixed match key: `seasonOfMatchKeyForAuthority`
    (`match-sheet-authority.ts:95-97`, `^\d{4}\|.`) returns null, so `encodePlayerMatchStatsKey`
    (`:109-113`) refuses `invalid_match_key` and every State B save in the harness refuses. The
    recorded C6 expectations (F-S3-01: 070, 088 and 101 save authority; 016 reaches the ISSUE-257
    `manual_authority_present` STOP) are therefore unreachable, and the end-to-end proof of the
    correction tool's `manual_authority_present` STOP is missing.
    - Production is not affected: every production key writer renders `<season>|…`
      (`settle-core.ts:174-182`, `match-admin.ts:258`, `import_fitzroy_core.py` `match_key_of`), and
      `code_test_db` has 0 of 16,838 matches whose key lacks the prefix.
    - Proposed fix, for operator decision: set `matchKeyPrefix` to `` `${season}|issue238-rehearsal:` ``
      (2092). Every fixture predicate already derives from `R.matchKeyPrefix` (`:294`, `:308` for
      `data_overrides`, `:6876`), and `|` is not a `LIKE` wildcard. Update the header comment (`:63`).
      Then re-run the C-window, and at least one State A run of the wider ISSUE-238 case set, because
      the prefix is shared by every harness case.
  - **F-S11-01 (LOW; the F-S10-01 class; NOT fixed).** `admin-brownlow.test.ts:1376-1403`
    ("preserves the Brownlow mirror through a match-sheet save") is a pre-257 case that saves through
    the Match Sheet and expects `ok: true`. Its ISSUE-155 fixture uses match keys `issue155-<season>-…`
    (`brownlow-fixture.ts:264`) and players with no accepted identity, so State B refuses (designed
    fail-closed), and State A would refuse authority-unavailable. Nothing is written. Proposed fix,
    for operator decision: extend the F-S10-01 decision to this case. Make it schema-state-aware, and
    give the State B save a season-prefixed key and an accepted identity, or assert the refusal and an
    unchanged mirror in both states.
  - **F-S11-02 (INFO; not ISSUE-257).** `admin-brownlow.test.ts:367-379` (preflight P2) found 320,861
    of 320,861 `brownlow_round_votes` rows with `match_id` NULL. The fitzRoy importer COPYs the table
    without `match_id` (`import_fitzroy_core.py:3246-3248`). Only migration 094's one-time backfill
    (`094_brownlow_admin_workflow.sql:106`) and admin entry (`admin-brownlow.ts:799`) set it, so a
    rebuild that applies migrations before loading data leaves every row NULL. The test's comment
    records an older afldb_test on which 094 was applied after the data. Whether that is a rebuild
    defect or only a test assumption is for the operator; no issue was opened.
  - **`admin-brownlow` hook timeout (LOW, environment).** The file-level `beforeAll` seeds three
    Brownlow seasons and exceeds the global 30 s `hookTimeout` over the tunnel. It was run with
    `--hookTimeout=300000` on the command line; no file was edited.
  - **F-S10-06 (LOW; read-only; no code change).**
    - `saveMatchSheet` treats a field that is absent from a player row as NULL, not as unchanged.
      `validateMatchSheetPayload` (`src/lib/match-sheet.ts:166-171`) maps `undefined` and `null` alike.
      `planMatchSheetChanges` (`match-sheet-authority.ts:722-745`) then diffs the full row against
      the locked pre-image. A row the sheet does not mention is untouched (`:701-702`).
    - The production UI always submits every field of every lineup row. `payloadString`
      (`MatchSheetEditor.tsx:363-388`) maps all eleven fields plus the jumper from state initialised
      from `getMatchPlayers` (`src/db/queries/matches.ts:128-144`, every row of the match;
      `MatchSheetEditor.tsx:198-217`). A value round-trips unchanged, so an untouched row plans
      nothing. Only a hand-built partial payload (an authenticated admin's crafted POST; the
      `admin-brownlow` case above is one) can blank columns. That needs no more privilege than
      clearing the inputs.
    - The pre-257 behaviour was the same: §18.5 (`:759-763`) records "every submitted player upserted,
      all twelve columns" and "the validator turns an absent field and a null into the same null".
    - Residual edge: `deriveDisposals` (`src/lib/match-sheet.ts:200-210`, used at
      `match-sheet-authority.ts:730`) fills a NULL `disposals` from kicks and handballs. On a row with
      both recorded but `disposals` NULL, any save of the sheet would plan an update and record the
      coupled triple as authority for a row the admin did not touch. Read-only evidence on
      `afldb_test` shows 0 such rows, and also 0 untrimmed or empty jumpers, 0 inconsistent triples
      and 0 values over `STAT_LIMITS`. So the UI cannot create authority on untouched fields with the
      current data.
  - **Read-hook artefact.** `item.playerId))`: zero bytes, untracked, created 08:36:50, named from
    `match-sheet.ts:200`. Deleted with `Remove-Item -LiteralPath`.
  - **Resumption.**
    1. The operator decides F-S11-03 (harness key prefix) and F-S11-01 (the `admin-brownlow` case)
       and authorises the test-only edits.
    2. Re-run the `code_test_db` window C1–C7 from C0 (the current state). The `afldb_test` window
       need not be repeated unless the `admin-brownlow` fix is to be proven there; if so, run
       `admin-brownlow` in State A and State B with `--hookTimeout=300000`.
    3. Only then: operator commit and DEV acceptance, including the Return-to-source panel eyeball
       (still VISUAL: UNVERIFIED).
- **Run C (2026-10-03). Both windows completed and both databases were restored exactly. The fresh
  diff review found no MEDIUM or higher, and closure has no unresolved flag. READY FOR DEV ACCEPTANCE.**
  Returns `23-*` (worker), `24-*` (orchestrator log), `25-*` (reviewer) and `26-*` (closure). The
  F-S11-01/02/03 decisions were recorded first (§19.3). No DEV or PROD work was done.
  - **Start state.** Branch and HEAD `3ed70ab1`; 39 modified files and exactly the 3 expected untracked
    files. DSNs were set per process only: CR trimmed, port rewritten to 55432, no `.env` created, no
    DSN printed.
  - **Edits (one `afldb-worker`, test and harness only).**
    - `tools/db/afl-api-identity-correction-rehearsal.ts`: the header comment (`:63-64`) and
      `matchKeyPrefix: '2092|issue238-rehearsal:'` (`:132`). Every derived predicate still uses
      `R.matchKeyPrefix` (`:295`, `:309`, `:525`, `:6877`). Case 82 (real season) is unaffected:
      the only season-prefix comparison, `manual-authority.ts:319`/`:552`, needs a
      `player_match_stats` record, and case 82 has none. Season 2092 has no other claimant on
      `code_test_db`. `awards-reload-links` uses 2092 on `afldb_test` only. The harness owns its
      `seasons` row (`:470`, teardown `:347`).
    - `tests/integration/admin-brownlow.test.ts` (F-S11-01): the imports (`:44-47`), a test-owned
      fixture (`:1380-1532`) and the case (`:1544-1611`).
      - Fixture: season 2077, key `2077|issue257b-brownlow-mirror`, slug and path `issue257b`, and
        an accepted AFL Tables identity. The source-owned row carries `brownlow_votes = 2`.
      - The schema state is read before the save.
      - State A: the exact `AUTHORITY_UNAVAILABLE_REFUSAL`, with the row, mirror, authority and
        audit unchanged.
      - State B: the save succeeds, 25/5/30 persist, the mirror stays 2 and one active
        `match_sheet` record exists.
      - Namespace-only cleanup runs in `finally`, followed by a residue assertion.
    - Static checks: `npm run typecheck` exit 0; eslint on both files 0 errors; `git diff --check`
      clean.
  - **`afldb_test` window.** P0–P8 PASS; P8 = B1 exactly.

    | Step | Result |
    |---|---|
    | State A `admin-brownlow --hookTimeout=300000` | 43 passed, 1 failed (44), 115 s; the F-S11-01 case passed |
    | `db:migrate:test` | 110 only, 139 ms; CHECK 14 literals (`8485a110…fe57` / `37f2fe81…2b`); guard PERMITTED |
    | State B, same command | 43 passed, 1 failed (44), 117 s; the F-S11-01 case passed |
    | Guarded reversal | guard PERMITTED; `pre_count 0`, `DELETE 0`, ledger `DELETE 1`, COMMIT; 110 PENDING |

    - In both states the single failure is `:367` P2, `expected 320861 to be +0`, attributed to
      AFLDB-ISSUE-263.
    - After each step: F3, F4 and F6 equal B1, and the guard is PERMITTED.
    - **Final = B1 exactly.**
      - F1: 109 rows, tail 109…105.
      - F2: `f163aaed…b247` / `72ef0d6f…7a36`, 13 literals.
      - F3: `players|t|92`.
      - F4: 16,838 / 685,471 / 13,365 / 19,318 / 92 / 130 / 1.
      - F5: `data_edits` 2 (max 6), `canonical_applications` 0, `import_batches` 29 (max 68),
        `data_issues` 4, `import_rejections` 681, `promotion_candidates` 0, staging 0/0. **No
        delta**: the case's own fixture audit row was removed by its cleanup.
      - F6: 0. P5/P5b clean.
      - The `data_overrides` and `data_edits` id sequences advanced; they are not part of F.
  - **`code_test_db` window.**
    - C1: owner `code_test_db`/`afldb_owner`, import `code_test_db`/`afldb_import`, `DATABASE_URL`
      `code_test_db`/`afldb_owner`.
    - C2: no session, no lock.
    - C3: 110 is the ONLY pending migration; guard PERMITTED; C0 = the Run B C0 exactly.
      - F4: 16,838 / 685,471 / 13,273 / 18,333 / 0 / 130 / 1.
      - F5: 0 / 0 / 26 / 4 / 681 / 0 / 0 / 0.
      - The CHECK and comment text were captured (sha256 `54C57C5B…F88C`).
      - The reversal SQL generated from C0 is byte-identical to `afldb_test`'s (sha256
        `3D3C8049…438C`).
    - **C4, old CHECK (State A): 7/7 PASS.** 016 12/12, 070 21/21, 088 21/21, 091 30/30,
      100 match-sheet 28/28, 100 brownlow-draft 26/26, 101 21/21. These are the same counts and
      outcomes as Run B: 016, 070, 088 and 101 refused as authority-unavailable; 091 and 100 were
      stale refusals; brownlow-draft was refused `not_participant`.
    - **Old-CHECK sweep of every other harness case sharing the prefix: 77/77 runs PASS.** The list,
      count and estimate (55–75 min) were recorded before starting. Each run was one at a time with
      `--conditions=react-server`, followed by teardown with zero residue, F6 0, no session and the
      guard PERMITTED.

      | Case | Checks (by variant) |
      |---|---|
      | 1 | 24 |
      | 29 | 33 |
      | 87 | 23 |
      | 2 votes-0 / votes-3 | 14 / 14 |
      | 23 | 17 |
      | 48 | 15 |
      | 51 | 25 |
      | 9 pms-foreign-identical / brownlow-foreign-zero | 26 / 26 |
      | 10 kicks / null-vs-zero / jumper-whitespace | 16 / 16 / 16 |
      | 11 | 15 |
      | 12 pms / brownlow | 33 / 33 |
      | 52 pms-identical / pms-differing / brownlow-zero | 26 / 16 / 26 |
      | 5 | 33 |
      | 6 | 29 |
      | 7 | 28 |
      | 8 malformed-entry / other-record | 21 / 21 |
      | 53 source-positive / counterpart-positive | 18 / 18 |
      | 54 | 21 |
      | 76 | 32 |
      | 78 | 29 |
      | 79 | 28 |
      | 83 no-participation / null-match-zero / null-match-two / paired-pms-move | 18 / 18 / 18 / 28 |
      | 3 demote / claim | 19 / 19 |
      | 4 draft / final | 20 / 18 |
      | 17 votes-written / round-reowned | 22 / 24 |
      | 18 after-siren / unresolved | 17 / 24 |
      | 19 achievement / debut-change | 16 / 24 |
      | 56 round-vote / games | 22 / 22 |
      | 84 draft / final | 20 / 20 |
      | 85 loses-participation / keeps-participation | 18 / 25 |
      | 20 | 31 |
      | 21 | 35 |
      | 27 same-target / other-target | 30 / 25 |
      | 69 | 42 |
      | 72 | 51 |
      | 73 | 41 |
      | 94 audited / no-audit | 46 / 41 |
      | 98 | 42 |
      | 99 | 47 |
      | 14 | 43 |
      | 15 match-exists / match-gone | 38 / 38 |
      | 32 | 40 |
      | 24 importer-unique / admin-linked | 21 / 24 |
      | 28 | 23 |
      | 30 | 21 |
      | 31 | 33 |
      | 58 ×4 | 17 / 22 / 17 / 17 |
      | 82 independent / extra-row | 28 / 28 |
      | 47 | 29 (100 s) |

      - **Case 32, first attempt:** 18/18 checks, then ABORTED with `AFLDB_AUTH_DATABASE_URL is not
        set`. The real admin page loader needs the auth role, and the C-window variable list omitted
        it. Nothing was written: teardown PASS, residue 0 and F = C0.
      - **Off-list environment addition (disclosed):** `AFLDB_AUTH_DATABASE_URL`, naming
        `code_test_db` (the auth DSN with the database swapped, as in the `afldb_test` window),
        proven `code_test_db`/`afldb_auth`. Cases 32 onward were then re-run; 32 gave 40/40, as in
        ISSUE-238 Slice 10.
      - **Runbook correction:** the C-window needs `AFLDB_AUTH_DATABASE_URL` naming `code_test_db`
        for cases 24, 31 and 32.
    - **C5.** `npm run db:migrate:code-test` applied 110 only (217 ms); 0 pending; 14 literals; F4,
      F5 and F6 equal C0.
    - **C6, widened CHECK (State B): 7/7 PASS.**

      | Case | Checks | Outcome |
      |---|---|---|
      | 016 | 21/21 | Authority `match_sheet` written, then `--validate-only` and `--apply` both STOP with exactly one stop, `player_match_stats#… [A257] manual_authority_present` |
      | 070 | 28/28 | Authority `match_sheet` written |
      | 088 | 28/28 | Authority `lineup` written (the removal) |
      | 091 | 30/30 | Stale refusal; row byte-identical |
      | 100 match-sheet | 28/28 | Stale refusal |
      | 100 brownlow-draft | 26/26 | — |
      | 101 | 29/29 | Authority `lineup` + `match_sheet` written |

      Every entity key is `2092|issue238-rehearsal:<ccc>:1|afltables:…`. F-S11-03 is verified.
    - **C7.** Guard PERMITTED, then the reversal (`pre_count 0`, ledger `DELETE 1`, COMMIT); 110
      PENDING. **Final = C0 exactly.** F1–F6 match, F5 has no delta, the CHECK and comment are
      byte-identical (sha256 `54C57C5B…F88C`), P5/P5b are clean and the guard reports State A,
      PERMITTED.
  - **Fresh diff review (return 25, read-only `git diff`).** CRITICAL 0, HIGH 0, MEDIUM 0, LOW 5,
    INFO 3, all NEW. None contradicts a recorded decision.
    - **R-01 LOW.** `canonical-apply.ts:985` takes the §18.6 race lock `FOR SHARE` by
      `unit.matchKey` only. In a rekey unit the row still holds the old key, so a Match Sheet save
      committing in a few-statement window can be overwritten once. The record survives. *(As
      recorded in Run C. Superseded: the fix was applied in Run D, which locks both keys; see "Run
      D (R-01)" below.)*
    - **R-02 LOW.** An unreadable `pg_constraint` maps to the "until migration 110" refusal.
      Proposed: a tri-state result.
    - **R-03 LOW.** An unreadable fitzRoy contract makes Return to source and `deleteMatch` refuse
      while naming records rather than the contract.
    - **R-04 LOW.** The Python and TS season-prefix regexes differ on whitespace.
    - **R-05 LOW.** `match-rekey.ts:1715,1729` compute a length in UTF-16 units versus SQL
      characters.
    - **INFO:** a per-unit authority-load cost; the deploy-order window could be stated in
      `docs/deployment.md`; an inline `try/catch` stays fail-closed.
    - No unrelated defect.
  - **Closure (return 26, DB-free).** No drift or undisclosed edit.
    - `typecheck` 0.
    - `match-sheet` 68/68; `data-overrides-source-contract` 69/69; `db-promotion-check` 456/456;
      `afl-api-identity-correction` 141/141; `current-season-import` 318 passed + 4 skipped.
    - `correct-afl-api-identity-cli` 273/274: the known Windows CRLF baseline (`:3195`).
    - `reference-data` 1 failed: known, ISSUE-262.
    - **F-C-01 (LOW):** two read-hook artefacts, deleted below. **F-C-02 (INFO):** the
      `admin-brownlow` residue query counts `data_edits` by note only (`:1511-1512`).
    - VISUAL: UNVERIFIED.
  - **Read-hook artefacts.** All were zero bytes, untracked and had an empty `git ls-files`. Each was
    deleted with `Remove-Item -LiteralPath`: `STOP` (09:40:18, from the harness's `-> STOP` text),
    `3` (09:59:29) and `` `${f.matchKey} `` (10:02:15). The last two were created during subagent
    reads.
  - **`CHANGELOG.md`.** An `Unreleased` ISSUE-257 entry was added. It is marked open, with DEV
    acceptance outstanding.
  - **PREPARED, NOT RUN: DEV acceptance procedure (operator-run, step by step).** Stop at any unmet
    expectation. No DSN goes on a command line. Host SQL is read-only (`BEGIN READ ONLY; …
    ROLLBACK;`) and runs in the operator's usual DEV psql session as the owner role.
    1. **Commit and merge.** Review the diff. Commit the 39 modified and 3 new files (`git status`
       must show nothing else). Run `npm run merge:ready -- --issue 257`, then push and merge to
       `main` per the lifecycle in `CLAUDE.md`.
    2. **Preflight** (workstation): `npm run preflight -- --mode deploy --environment dev --dsn-env
       AFLDB_OWNER_DATABASE_URL --expect-database afldb_dev --ssh-host streamanator`. Resolve every
       `FAIL`.
    3. **Deploy the new code on the old schema.** Run `powershell -ExecutionPolicy Bypass -File
       .\deploy\sync-dev.ps1 -SkipMigrate`. Health must report `status: ok, database: ok`. Then on
       the host (`cd ~/projects/afldb`):
       - `npx tsx tools/db/migrate.ts --status --target dev` must show exactly one PENDING
         migration, `110_match_sheet_player_match_stats_authority.sql`;
       - `npx tsx tools/db/issue257-rollback-guard.ts --target dev` must show State A, 0 rows,
         PERMITTED.
    4. **Normal settle operates (State A).** Trigger one AFL Tables settle: `/admin/current-season`
       → "Fetch current AFL data now", or `sudo systemctl start afldb-settle-afltables.service`.
       - Inspect `journalctl -u afldb-settle-afltables --since "20 min ago"` and the newest batch
         (`SELECT * FROM import_batches ORDER BY id DESC LIMIT 1;`, `validation_result`).
       - Expect completion, with no new refusal of `player_match_stats`, `match_period_scores` or
         `brownlow_round_votes` beyond the classes recorded before the deploy.
       - Note the AFL API timer state: `systemctl list-timers 'afldb-settle-*'`.
    5. **The Match Sheet fails closed before the migration.** In `/admin/data-editor`, choose a 2026
       match M and an AFL Tables-owned player row P.
       - Record Q1:
         ```sql
         SELECT s.*, src.key AS owner FROM player_match_stats s
           LEFT JOIN sources src ON src.id = s.source_id
          WHERE s.match_id = :M AND s.player_id = :P;
         ```
       - Change one statistic (e.g. `marks` +1) and save. Expect the authority-unavailable refusal
         ("…until migration 110…"). Q1 must be unchanged, and there must be no new `data_edits` row
         for M.
       - Eyeball panel states **S1** (no authority) and **S5** if reachable, at 1440×900 and
         390×844.
    6. **Apply migration 110** on the host: `npm run db:migrate`. `--status --target dev` must show 0
       pending, and this query must list `player_match_stats`:
       ```sql
       SELECT pg_get_constraintdef(oid) FROM pg_constraint
        WHERE conname = 'data_overrides_entity_type_check';
       ```
    7. **Zero records before first use.** `issue257-rollback-guard.ts --target dev` must show State B,
       0 rows, PERMITTED, exit 0. This is the last point at which a code rollback is possible
       without rolling forward.
    8. **One controlled correction.** Repeat step 5's edit (exactly one field, note "ISSUE-257 DEV
       acceptance") and save. Expect success. Then check Q2:
       ```sql
       SELECT entity_key, field_group, is_active, override_values FROM data_overrides
        WHERE entity_type = 'player_match_stats';
       ```
       It must show exactly one active `match_sheet` row, keyed `<M's match_key>|afltables:<P's
       path>`, whose values name only the edited field (or the kicks/handballs/disposals unit). Q1
       must show the new value, and one new `data_edits` row must name M. Eyeball **S2** at both
       viewports.
    9. **Rollback-guard usage.** `issue257-rollback-guard.ts --target dev` must now exit 2 REFUSED
       (1 row). From this point DEV is roll-forward only (D-257-7). This is the expected, designed
       answer.
    10. **One source settle.** Use the same trigger as step 4.
        - **The protected field survives:** Q1 still shows the corrected value, and Q2 is unchanged.
        - **Unrelated source behaviour is not frozen:** the batch completes with the same counter
          classes as step 4; P's other fields and every other row of M still equal the source
          (step 5's Q1 values); other matches settle as before. Unless upstream data moved, this is
          proven by equality with the source, not by an observed change. Record which.
    11. **Return to source.** In the panel "Durable Match Sheet decisions", click Return to source for
        P. Eyeball **S3**. Clicking again, or on a player with no record, should show **S4**. Q2
        must show the record `is_active = false`, with the row still at the corrected value.
    12. **Normal source behaviour resumes.** Trigger one more settle. Q1 must show the field back at
        the source value (step 5's pre-value), and Q2 must still show the inactive record. The guard
        stays REFUSED.
    13. **Service and schedule.** `curl -s http://127.0.0.1:3100/api/health` must return `ok`/`ok`.
        Check `systemctl status afldb` and `systemctl list-timers 'afldb-settle-*'` (timers as
        before the deploy).
    14. **Visual evidence.** Record the operator's screenshots or verdict for S1–S5 at 1440×900 and
        390×844. Any state not reachable on DEV (S5 needs an unavailable import connection; S2's
        addition and removal rows need those edits) is recorded as not exercised. Until then:
        `VISUAL: UNVERIFIED`.
  - **Resumption.** Operator commit, then the DEV acceptance above. Then resolve ISSUE-257 (and the
    PROD sequence, separately authorised). R-01 to R-05 are LOW and create no work unless the
    operator chooses, for example R-01 before PROD. *(Superseded by Run D: the operator chose R-01
    before DEV acceptance.)*
- **Run D (R-01), 2026-10-03. The fix is applied and its targeted regression passed 3 of 3 on
  `afldb_test`. The window SAFE-STOPPED when the 55432 tunnel dropped part-way through the full
  `settle-afltables` run. `afldb_test` is left in State B (110 applied), probably with fixture residue,
  and is unreachable. NOT READY FOR DEV ACCEPTANCE.** *(Superseded the same day by "Run D resume"
  at the end of this block: complete, R-01 RESOLVED, `afldb_test` at B1, ready for DEV acceptance
  after the operator commit.)* Returns: `27-*` (worker, tests), `28-*`
  (reviewer, diff review: PROCEED, no new MEDIUM or higher), `29-*` (orchestrator window log). No DEV
  or PROD work was done. Nothing was staged or committed.
  - **History.** A first Run D session wrote the fix and the tests, got return 28, and ran a pre-fix
    diagnostic of the integration scenario on `afldb_test`. Per the note under return 28, that
    scenario failed as designed: the settle backend was seen `Lock:relation` on
    `manual-authority.ts:687`. That session then died. It did not reverse 110 and recorded nothing
    here. Its full `settle-afltables` run (about 14:11) left `import_batches` 325–327 (see the start
    state below). This finishing run re-verified everything from disk.
  - **The window (from the code and return 28).** In a settle rekey unit the canonical row still
    carries the RETIRED key. The pre-fix lock, `SELECT … FROM matches WHERE match_key =
    ${unit.matchKey} FOR SHARE` (the incoming key), therefore locked nothing, and
    `loadManualAuthority` read the snapshot with the row unlocked. The row's first lock was
    `findRetiredMatchIdentities(…, true)` inside `readFreshTarget`. A Match Sheet save (match row
    `FOR UPDATE` by id) could commit between the two. The unit was then judged against a snapshot
    that did not contain that save: it could be overwritten once, and the carried record survives.
  - **Fix** (`src/lib/acquisition/canonical-apply.ts`).
    - `retiredSearchOf` (`:457-469`) is the shared retired-identity search arguments. It behaves the
      same as the inline form it replaces in `readFreshTarget` (`:525-527`).
    - `lockUnitMatchRows` (`:490-506`) runs at `:1025`, immediately before `loadManualAuthority`
      (`:1026`).
    - **Rekey unit with a retired candidate.** An unlocked candidate search runs first, then ONE
      statement:
      ```sql
      SELECT id::int AS id FROM matches
       WHERE id = ANY($retiredIds) OR match_key = $incomingKey
       ORDER BY id
         FOR UPDATE
      ```
      This locks both renderings in id order before the snapshot. It uses `FOR UPDATE`, the strength
      that `readFreshTarget`'s locked search and the rekey `UPDATE` take on the same rows anyway, so
      no lock is upgraded.
    - **Otherwise (unchanged).** A unit with a `player_match_stats` target takes `SELECT id … WHERE
      match_key = $incomingKey FOR SHARE`.
  - **Lock order (deadlock re-check).**

    | Actor | Order |
    |---|---|
    | Match Sheet save (`match-sheet.ts:133-176`) | `lock_timeout` 5 s → the match row `FOR UPDATE` by id → its `player_match_stats` rows `FOR UPDATE ORDER BY player_id` → `data_overrides` upserts → recompute |
    | Return to source (`match-sheet.ts:579-610`) | `lock_timeout` 5 s → the match row `FOR UPDATE` → its row `FOR UPDATE OF pms` |
    | Settle rekey unit (`canonical-apply.ts:1025` onward) | retired and incoming match rows `FOR UPDATE ORDER BY id` (one statement) → authority read → E4 → canonical write and rekey `UPDATE` → carry → later `player_match_stats` units of the same transaction (`FOR SHARE` on the already-held row) → end-of-run recompute with the bounded 40P01 retry (`settle-core.ts:219-240`) |
    | `repair-match-rekeys` (`:571-590`, per return 28) | retired rows `FOR UPDATE` in one `ORDER BY m.id` statement |

    Each side takes its match row(s) in a single statement before any `player_match_stats` row, so
    match rows add no cycle. A writer that meets the settle's lock gets the retryable refusal after
    5 s. Settle-versus-settle stays AFLDB-ISSUE-261 (known). Reviewer LOW F-D-01: in the would-merge
    case, and for an E2/E6-refused rekey unit, the rows locked here stay held for the rest of the run.
    This is bounded and benign; no work.
  - **Tests.**
    - DB-free, `tests/current-season-import.test.ts:4735-4786`, three tests:
      - lock statement order search → lock → authority, `ORDER BY id`, `FOR UPDATE`, both keys in one
        statement;
      - no candidate keeps the `FOR SHARE`;
      - no pre-authority search for a non-rekey unit.
    - Integration, `tests/integration/settle-afltables.test.ts:5685-5815`, "R-01: a Match Sheet save
      cannot commit inside the settle rekey unit authority window": fixture tag `race`, n = 11,
      `2093|issue122-` keys.
      - A side client holds `data_overrides` `ACCESS EXCLUSIVE`, which parks the rekey settle exactly
        at its authority read.
      - A `FOR UPDATE NOWAIT` probe on the match must fail with `55P03` (the pre-fix discriminator).
      - The real `saveMatchSheet` must get `MATCH_SHEET_SETTLE_RUNNING_REFUSAL` and write nothing.
      - After release, the rekey is in place and nothing was overwritten.
      - A correction made after the rekey lands at the new key and survives the next source change.
  - **DB-free validation (this run, no DB variable set).**
    - `npm run typecheck`: exit 0.
    - eslint on the three files: 0 errors.
    - vitest:
      - `current-season-import` 321 passed + 4 skipped. Run C had 318 + 4; the 3 R-01 tests pass.
      - `match-sheet` 68/68.
      - `data-overrides-source-contract` 69/69.
      - `db-promotion-check` 456/456.
  - **`afldb_test` preflight, State B: PASS.**
    - P0 tunnel up.
    - P1: owner `afldb_test`/`afldb_owner`, import `afldb_test`/`afldb_import`, auth
      `afldb_test`/`afldb_auth`.
    - P7: psycopg 3.3.5.
    - `migrate.ts --status --target test`: exit 0, 0 pending, 110 applied.
    - P5/P5b empty. Guard: State B, 0 rows, PERMITTED.
    - Start fingerprint:
      - F1: 110 rows, max 110.
      - F2: `8485a110…fe57` / `37f2fe81…2b`, 14 literals.
      - F3: `players|t|92`.
      - F4: = B1.
      - F5: `data_edits` 2 (max 6), `canonical_applications` 0, `import_batches` **32 (max 327)**,
        `data_issues` 4, `import_rejections` 681, `promotion_candidates` 0, staging 0/0.
      - F6: 0. Fixture residue 0.
    - **F5 attribution:** `import_batches` 325, 326 and 327 are `afltables` `settle-afltables.ts`
      batches (completed 14:11:25, 14:11:33 and 14:11:37) noted `AFLDB-ISSUE-099 settle;
      snapshot=issue122-s6-cli; season=2093; mode=apply`. This is the full suite's S6 CLI append-only
      write, the same one attributed for ids 66–68 in the Run B relaunch, from the interrupted
      session.
  - **State B runs.** F3, F4, F5 and F6 were checked after each run.

    | Run | Result | After |
    |---|---|---|
    | `settle-afltables -t "R-01"`, run 1 | 1 passed (75 skipped), 35.1 s | = start; guard PERMITTED |
    | run 2 | 1 passed, 35.7 s | = start; guard PERMITTED |
    | run 3 | 1 passed, 35.5 s | = start; guard PERMITTED |
    | `settle-afltables` (full), 14:43:16 | 73 passed, 3 failed (76), 447.6 s | unreachable |

    - All 3 failures are `connect ECONNREFUSED 127.0.0.1:55432`. The tunnel dropped at about 14:50
      inside "a settle rekey carries the Match Sheet authority to the new match key", in the settle's
      `recomputePlayerDerivedStats` (`player-derived.ts:351`).
    - "repair-match-rekeys carries…", "R-01…" and all three `afterAll` hooks failed on connect. The
      hooks are the file's `cleanupIssue099`, S5's `cleanup122` and F-S9-03's `cleanupAuthority`.
    - The 73 tests before the drop passed, including the other F-S9-03 scenarios.
    - The port stayed closed through a 5-minute bounded poll and later checks. No local tunnel
      process exists, and restoring it is operator-owned.
    - **Not run:** `settle-afl-api`, `data-editor`, the guarded reversal, State A, the final
      fingerprint and closure.
  - **SAFE-STOP state.**
    - `afldb_test`: migration 110 APPLIED (State B), not reversed.
    - **Probable residue** from the interrupted scenario, whose seed and Match Sheet correction
      committed before the failed settle: season 2093, `2093|issue122-…` match(es) with their
      `player_match_stats` rows, `issue122-257-*` players and identities, and at least one ACTIVE
      `player_match_stats` `data_overrides` row. Because of that row the guard will REFUSE until
      cleanup. Also probable: a `data_edits` row, and staging and `import_batches` rows.
    - The aborted settle transaction rolls back server-side. Until P5/P5b it is unknown whether an
      orphaned backend still holds locks.
    - DEV and PROD untouched.
  - **Resumption (needs the tunnel and the operator's go-ahead).**
    1. P0, then P5/P5b. An orphaned backend from this run must end first; do not terminate one
       without authorisation. Then the census (`D:\tmp\issue257-runD\fp2.sql`).
    2. Pre-clean through the suite's own hooks: `npx vitest run
       tests/integration/settle-afltables.test.ts -t "R-01"`.
       - The hooks: S5 `beforeAll` runs `cleanup122`, F-S9-03 `beforeAll` runs `cleanupAuthority`
         and the file `afterAll` runs `cleanupIssue099`.
       - This doubles as R-01 run 4.
       - Expect F3, F4 and F6 equal to the start state and the guard PERMITTED. If residue survives,
         STOP.
    3. Resume at the full `settle-afltables`, then:
       1. `settle-afl-api` (full);
       2. `data-editor` (alone);
       3. the guarded reversal (`D:\tmp\issue257-runD\reverse110.sql`, one owner transaction). It
          refuses unless the `player_match_stats` override count is 0, then re-adds migration 102's
          exact CHECK and comment and deletes the 110 ledger row. Before `COMMIT` it asserts md5
          `f163aaed…b247` / `72ef0d6f…7a36` and 109 ledger rows;
       4. State A `-t "R-01"` and `-t "F-S9-03"`;
       5. the final fingerprint against B1, with the F5 deltas attributed;
       6. closure.
  - **Read-hook artefact.** `undefined)` (repo root, 0 bytes, created 14:38:24, empty `git
    ls-files`), deleted with `Remove-Item -LiteralPath`.
  - **Resume attempt (2026-10-03, ~15:10, main session).** The operator authorised resumption.
    - The 55432 tunnel was still closed, so no database step ran and `afldb_test` was not re-inspected.
    - Workstation process check: no vitest, tsx, psql or Python importer process exists. The only
      node and python processes are the Playwright MCP and semble tool servers. No local test
      process can still write.
    - A server-side orphaned backend can only be ruled out at P5/P5b once the tunnel is back.
    - The resumption steps above are unchanged; they wait on the operator restoring the tunnel.
  - **Run D resume (2026-10-03, 15:23–15:50 +10). COMPLETE: every suite passed, 110 reversed,
    `afldb_test` restored to B1 with the F5 delta attributed row by row. R-01 RESOLVED.** Return
    `30-orchestrator-run-d-resume.md` (orchestrator log) and `31-closure-run-d-resume-phase-close.md`.
    Logs under `D:\tmp\issue257-runD\resume-*.log`. No DEV, PROD or `code_test_db` work; nothing
    staged or committed; no session terminated; no hand-written DELETE.
    - **Step 1 (main session, read-only).** Tunnel up; `afldb_test` as `afldb_owner`. No other
      session and no lock, and no local writer process, so nothing could still write. 110 APPLIED.
      Ownership census (`fp3-ownership.sql`): every non-baseline row was attributable to the
      interrupted full `settle-afltables` run, plus the 14:11 run's `import_batches` 325–327; every
      `rest` partition equalled B1. The residue was 88 `import_batches` rows above 68, 101
      `canonical_applications`, 12 `import_rejections`, 78/96 staging rows, 37 `promotion_candidates`,
      2 seasons (2093, 2094), 37 matches with 19 `player_match_stats` rows, 12 `issue`-slug players
      and 12 identities, 7 `matches` and 2 `player_match_stats` fixture overrides (one active), 1
      `data_edits` row and 12 `data_issues` rows. The 92 `players` overrides were never touched.
    - **Step 2: hook pre-clean = R-01 run 4.** `settle-afltables -t "R-01"`: 1 passed, 75 skipped,
      54.9 s. The suite's own hooks removed all the residue. Afterwards F3 `players|t|92`, F4 = B1, F6
      0, fixture 0; guard State B, 0 rows, PERMITTED. The only F5 delta was `import_batches` 6 rows
      (325–327 and 543–545, see step 6).
    - **Step 3, State B (each followed by the census and the guard: State B, 0 rows, PERMITTED).**

      | Suite | Result | After |
      |---|---|---|
      | `settle-afltables` (full) | 76/76, 456.2 s (R-01 run 5, and every F-S9-03 scenario) | F4 = B1; `import_batches` +3 (639–641) |
      | `settle-afl-api` (full) | 72/72, 644.8 s | unchanged |
      | `data-editor` (alone) | 30 passed + 1 skipped, 112.2 s; the skip is case (5), the allowed one (`data-editor.test.ts:1763-1771`); the residue and historical-row guards passed | unchanged |

    - **Step 4: guarded reversal.** `reverse110.sql` was read in full first. Its CHECK and COMMENT
      are byte-identical to `102_special_records_lifecycle.sql:245-263`. It ran once, as one owner
      transaction:
      - `player_match_stats` override pre-count 0;
      - `ALTER TABLE`, `COMMENT`, `DELETE 1` (the 110 ledger row);
      - in-transaction assert: md5 `f163aaedd91e7aec2d6cc592dcfab247` /
        `72ef0d6ff54695071405595f6d077a36`, 109 ledger rows; `COMMIT`.

      `migrate.ts --status --target test`: exit 0, 109 applied, 110 the only PENDING. Guard: State
      A, PERMITTED.
    - **Step 5: State A.** `-t "R-01"`: 1 passed, 75 skipped (the `scenario` wrapper returns early
      without storable authority, `settle-afltables.test.ts:5385-5389`). `-t "F-S9-03"`: 11 passed,
      65 skipped. After each: census unchanged; guard State A, PERMITTED.
    - **Step 6: final fingerprint against B1 (15:50).**
      - F1: 109 rows, max `109_import_reads_player_match_period_stats.sql`. EXACT.
      - F2: md5 `f163aaed…b247` / `72ef0d6f…7a36`, 13 literals, does not admit
        `player_match_stats`. EXACT.
      - F3 `players|t|92`, F4 16,838 / 685,471 / 13,365 / 19,318 / 92 / 130 / 1, and F6 0 (fixture
        rows 0): all EXACT.
      - F5: `data_edits` 2 (max 6), `canonical_applications` 0, `data_issues` 4, `import_rejections`
        681, `promotion_candidates` 0, staging 0/0, all EXACT. `import_batches` is 38 (max 641)
        against 29 (max 68). The +9 are all `afltables` `settle-afltables.ts`, `completed`, noted
        `AFLDB-ISSUE-099 settle; snapshot=issue122-s6-cli; season=2093; mode=apply`. That is the
        full suite's S6 CLI append-only write, the same class as Run B's ids 66–68:
        - 325–327 (14:11), the first Run D session's full run;
        - 543–545 (14:45), the interrupted 14:43 run;
        - 639–641 (15:29), this resume's full run.
      - No other session and no lock.
    - **Step 7: closure (`afldb-closure`, DB-free).** No CRIT, HIGH or MED flags.
      - HEAD `3ed70ab1`; 40 modified, exactly the 3 expected untracked files, nothing staged.
        `git diff --check` exit 0 (CRLF notice only).
      - The R-01 hunks match the disclosure (`canonical-apply.ts:457-470`, `:490-506`, `:1025-1026`,
        `:525-527`).
      - By LastWriteTime, nothing outside the three R-01 files and the tracking docs was written in
        the Run D window, and no code file was written during the resume.
      - typecheck exit 0; eslint 0 errors.
      - vitest: `current-season-import` 321 passed + 4 skipped, `match-sheet` 68/68,
        `data-overrides-source-contract` 69/69, `db-promotion-check` 456/456.
      - INFO only: the CRLF notice, and `.phaneslight/config.json`, which was modified before Run D.
    - **Read-hook artefacts.** None this resume. The closure found no zero-byte repo-root file.
    - **Next.** Operator commit, then the DEV acceptance procedure (§19.4 "Run C"). Then resolve
      ISSUE-257. PROD is a separate authorisation.
- **DEV acceptance, State A stage (2026-10-03, main session).** The operator committed and merged:
  `main` = `origin/main` = `92f2bdf6`, primary checkout clean. Scope is the "Run C" procedure steps 2–5
  only, stopping before migration 110. No PROD.
  - **Environment.** The primary checkout `D:\dev\afldb` had an empty `node_modules`. The operator
    authorised `npm ci` there: 419 packages, exit 0, no tracked change, HEAD still `92f2bdf6`. For
    the process only, `psql` was put on PATH and `AFLDB_OWNER_DATABASE_URL` was rewritten to the
    55432 tunnel; nothing was printed and no `.env` was changed.
  - **Step 2: preflight.** `npm run preflight -- --mode deploy --environment dev --dsn-env
    AFLDB_OWNER_DATABASE_URL --expect-database afldb_dev --ssh-host streamanator`, from the primary
    checkout.
    - PASS: repository root; branch `main`; clean tree; contains local main; ahead 0 / behind 0
      `origin/main`; migration names collision-free; `.env` present; MSYS guard; git, psql and
      pg_restore available; SSH `streamanator` reachable; DSN present; database reachable as
      `afldb_dev` / `afldb_owner`, read-only.
    - The ONLY FAIL: `migration pending-migration — 110_match_sheet_player_match_stats_authority.sql
      is pending in the target database.` Result: BLOCKED (1 blocker, 0 warnings).
  - **Tooling gap.** Deploy-mode preflight treats ANY pending migration as an error
    (`tools/db/migration-safety.ts:159`) and has no exact-name override. The ISSUE-257 deploy is code
    first (D-257-7 / §18.13), so in State A migration 110 MUST be pending. The tool cannot pass in
    State A by design, and the Run C procedure did not anticipate this.
  - **Operator exception (2026-10-03).** Accept ONLY the pending-migration FAIL that names
    `110_match_sheet_player_match_stats_authority.sql`, provided it is the sole pending migration and
    every other check passes. Both conditions held. Continue with `sync-dev.ps1 -SkipMigrate` and the
    State A checks; stop on any other failure or unexpected state, and stop before applying 110.
    Follow-up: an exact-name `--expect-pending` option for deploy preflight, if wanted, is separate
    work (not opened here).
  - **Pre-deploy DEV baseline (read-only, 17:13).**
    - Ledger 109; CHECK md5 `f163aaed…b247` (does not admit `player_match_stats`).
    - `data_overrides`: no `player_match_stats` rows. `data_edits` 2; `player_match_stats` 695,499.
    - Newest AFL Tables settle, batch 91 (2026-10-01): `manualAuthorityRefusals` 0,
      `canonicalApplyRefusals` 0, `canonicalRekeyRefusals` 0, `foreignOwnedCollision` 0,
      `unresolvedIdentityMatch` 1.
    - Saved at `D:\tmp\issue257-runD\dev-baseline-pre-deploy.txt`.
  - **Step 3: deploy FAILED at the build (17:14–17:15).**
    - `deploy\sync-dev.ps1 -SkipMigrate` pulled the host from `3e98fb7b` to `92f2bdf6` and ran `npm ci`.
      `npm run build` then failed: `UnhandledSchemeError: Reading from "node:crypto" | "node:fs" |
      "node:path" | "node:url" is not handled by plugins`. The script stopped (`set -e`); no restart
      ran and no migration ran.
    - Import trace: `RoundMatches.tsx` → `MatchVoteEditor.tsx` (client component) →
      `src/lib/brownlow/entry.ts:37` → `manual-authority.ts` → `match-sheet-authority.ts` /
      `fitzroy-profile-continuity.ts` (Node built-ins).
    - **F-DEV-01 (HIGH, ISSUE-257 defect).** `entry.ts` value-imports one constant,
      `MANUAL_ATTENDANCE_SOURCE_KEY`, from `manual-authority.ts`. ISSUE-257 made that module reach Node
      built-ins, so the Brownlow round editor's client bundle broke. No ISSUE-257 run executed
      `npm run build`; typecheck and vitest cannot detect a client value-import of server-only code.
    - Impact on DEV: the failed build wiped `.next/standalone` (`server.js` and `BUILD_ID` missing).
      The pre-deploy process (MainPID 1169477, started 2026-10-02 17:02) kept serving from memory with
      health ok/ok, but any restart would have left the service unable to start. No database change.
  - **DEV recovery to `3e98fb7b` (operator-authorised, 19:50–19:53).**
    - Read-only pre-checks: 110 PENDING (only), guard State A / 0 rows / PERMITTED; host tracked tree
      clean; its 5 untracked settle manifests do not collide with paths tracked in `3e98fb7b`.
    - `git checkout --detach 3e98fb7b`, `npm ci`, `npm run build` (compiled successfully).
      `server.js`, `BUILD_ID` `JwX7eDNatI1eTE96fhO9y` and the static assets present. Restart via
      `Restart=always`: MainPID 1169477 → 2506948.
    - Verified: running checkout `3e98fb7b` (detached), service active, health
      `{"status":"ok","database":"ok"}`. Gated pages answer 307 and `/beta` 200. `migrate --status`
      shows 0 pending (110 does not exist at `3e98fb7b`). Timers unchanged:
      `afldb-settle-afl-api-brownlow.timer` (5-minute) and `afldb-settle-afl-api.timer` (daily
      05:12).
    - Script and logs: `D:\tmp\issue257-runD\dev-restore-3e98fb7b.sh`, `dev-restore.log`,
      `dev-deploy.log`.
    - **Next deploy note.** The host checkout is DETACHED at `3e98fb7b`, so the default
      `git pull --ff-only` cannot run. Redeploy with `deploy\sync-dev.ps1 -SkipMigrate -RemoteRef main`
      (it checks out `main` before pulling).
  - **Hotfix (prepared in this worktree, not committed).**
    - New dependency-free module `src/lib/acquisition/manual-source-key.ts` holds
      `MANUAL_ATTENDANCE_SOURCE_KEY`.
    - `manual-authority.ts` imports it and re-exports it, so existing importers are unchanged.
    - `src/lib/brownlow/entry.ts` imports it from the new module.
    - `tests/brownlow-entry.test.ts` adds a source pin: `entry.ts` must import from
      `manual-source-key` and never from `manual-authority` or `match-sheet-authority`.
    - **Validation (workstation, 2026-10-03).**
      - `npm run typecheck`: exit 0.
      - eslint on the 4 files: exit 0.
      - vitest `tests/brownlow-entry.test.ts tests/current-season-import.test.ts
        tests/match-sheet.test.ts`: 481 passed, 4 skipped.
      - `npm run build`: compiled successfully. The first attempt stopped at page-data collection
        only because the worktree has no `.env` (`DATABASE_URL is not set`). The re-run with
        `DATABASE_URL` / `AFLDB_AUTH_DATABASE_URL` set process-only to `afldb_test` exited 0:
        1,515/1,515 static pages generated, the `/admin/brownlow/...` routes built,
        `.next/standalone/server.js` present.
      - The only compile warnings are Next.js's own Edge-runtime notices
        (`next/dist/esm/server/app-render/dynamic-rendering.js`), unrelated to this change.
      - `git diff --check`: exit 0.
    - **Lesson.** A change that touches a module reachable from a client component needs a local
      `npm run build` before deploy; typecheck and vitest cannot catch a client value-import of
      server-only code.
    - **DEV acceptance resumes** only after the operator commits and merges the hotfix. Then:
      deploy preflight (same 110-pending exception), `sync-dev.ps1 -SkipMigrate -RemoteRef main`,
      then steps 3–5 of the "Run C" procedure, stopping before migration 110.
  - **State A stage, resumed and PASSED (2026-10-03, 20:05–20:35).** The operator merged the hotfix:
    `main` = `origin/main` = `a27f7104` (primary checkout clean).
    - **Recovery build, made before rebuilding.** The working DEV build (checkout `3e98fb7b`, BUILD_ID
      `JwX7eDNatI1eTE96fhO9y`) was copied with `cp -a` to
      `/home/arm/afldb-recovery/3e98fb7b-JwX7eDNatI1eTE96fhO9y`.
      - The copy is 825 MB, 12,943 files plus a `RECOVERY_COMMIT` marker. `diff -rq` against the live
        `.next/standalone` showed it identical.
      - The unit's `ExecStart` is `node deploy/server-cluster.mjs`, with
        `WorkingDirectory=/home/arm/projects/afldb`.
      - Restore path: `git checkout --detach 3e98fb7b`, copy the directory back to
        `.next/standalone`, restart.
      - **Retained until DEV acceptance passes.**
    - **Step 2: preflight** (primary checkout, `a27f7104`). Every check PASS except the sole FAIL
      `110_match_sheet_player_match_stats_authority.sql is pending`. That is the operator-authorised
      exception. Log: `D:\tmp\issue257-runD\preflight-a27f7104.log`.
    - **Step 3: deploy.** `deploy\sync-dev.ps1 -SkipMigrate -RemoteRef main` exited 0.
      - Before `3e98fb7b` (detached), after `a27f7104 main`; compiled successfully; BUILD_ID
        `Etn3f80GrxGD2DU9Uj0q5`.
      - Restart via `Restart=always`: 2506948 → 2531653. Health ready after one probe.
      - Post-deploy checks:
        - health `{"status":"ok","database":"ok"}`;
        - `migrate --status --target dev`: 109 applied, `PENDING 110_match_sheet_player_match_stats_authority.sql`, 1 pending;
        - `issue257-rollback-guard --target dev`: State A, 0 rows (active 0), PERMITTED, exit 0;
        - timers unchanged (`afldb-settle-afl-api-brownlow` 5-minute, `afldb-settle-afl-api`
          daily 05:12);
        - host untracked files: only the 5 settle manifests.
    - **Step 4: normal settle (State A).** `systemctl start --no-block afldb-settle-afltables.service`
      at 20:19:16. Unit `Result=success`, exit 0; journal "settle chain complete — label
      settle-2026-2026-10-03-2019". This is batch 99, completed.
      - Batch 99 against the pre-deploy batch 91: every refusal or failure counter is 0 in both, so
        there is **no new refusal class**. That covers `manualAuthorityRefusals`,
        `canonicalApplyRefusals`, `canonicalApplyFailures`, `canonicalRekeyRefusals`,
        `foreignOwnedCollision`, `snapshotRejections`, `sourceDisagreement` and every
        `unresolvedIdentity*` counter.
      - Batch 99 also has 0 rejections and 0 canonical applications. There are 0 new `data_issues`
        since 20:19, and 0 `player_match_stats` overrides.
      - The only differences are batch 91's upstream changes (47 corrected observations, 55 rows
        inserted, 46 derived recomputes, 1 unresolved match). Batch 99 saw none: 19,986 unchanged
        = 19,938 + 47 + 1.
      - The journal's `foreign_source_owner` warnings are the chain's report of EXISTING open AFL API
        data issues, first detected on 2026-10-01 and at 05:09 today. Both predate the deploy.
      - Saved: `D:\tmp\issue257-runD\dev-settle-compare.txt`.
    - **Step 5: the Match Sheet fails closed.** M = match 17275 (`2026|GF|2026-09-26|Fremantle|Brisbane
      Lions`, 46 rows, all `afltables`-owned). P = player 345 (`alex-pearce`, one AFL Tables path).
      - Q1 before: row 705529, owner `afltables`, marks 0, kicks 1, handballs 1, disposals 2. M's
        46-row md5 `08a1673ae025066f95fc4b67836fe850`. `data_edits` 2 (max 2), 0 for M;
        `player_match_stats` overrides 0.
      - The operator changed P's marks 0 → 1 in `/admin/data-editor?mode=match-sheet&id=17275` and
        saved. The UI showed "Durable Match Sheet authority is not available until migration 110 is
        applied; nothing was saved."
      - Q1 after: identical to the before-image in every field. Same 46-row md5, `data_edits` 2 / 0
        for M, overrides 0. **No write.**
      - Saved: `dev-q1-before.txt`, `dev-q1-after.txt`.
      - Panel S1: the operator viewed the page; no S1 defect was reported. A screenshot was not
        captured, so the S1 visual remains operator-attested only.
    - **Stopped before migration 110,** as instructed. No PROD work.
  - **Step 6–7: migration 110 applied to `afldb_dev` (operator-authorised, 2026-10-03 20:36 AEST).**
    - **Reconfirmed before applying.**
      - Host checkout `a27f7104 main`, tracked tree clean, BUILD_ID `Etn3f80GrxGD2DU9Uj0q5`,
        service active (PID 2531653), recovery copy present.
      - Runner target `afldb_owner@127.0.0.1:5432/afldb_dev`: 109 applied, `PENDING
        110_match_sheet_player_match_stats_authority.sql` the SOLE pending migration.
      - Guard: State A, 0 rows, PERMITTED.
      - The host file is the committed file: git blob `8aa78918…` is identical on host, commit and
        workstation. The raw sha256 differs only because the Windows checkout is CRLF (64 lines);
        LF-normalised it equals the host's `6a59d49e…`.
    - **Applied:** `npm run db:migrate` on the host, guarded by a script that refuses unless HEAD is
      `a27f7104` and 110 is the only pending migration. Output: `applying
      110_match_sheet_player_match_stats_authority.sql ... ok (14 ms)`, "Applied 1 migration(s)", exit 0.
    - **Verified after.**
      - `migrate --status --target dev`: 110 applied, 0 pending. Ledger 110 rows, max `110_…`.
      - `data_overrides_entity_type_check`: 14 literals, admits `player_match_stats`, def md5
        `8485a11052b93c3eb28fbe73fdbcfe57`, comment md5 `37f2fe81eaaf0bc26511bb799dd55f2b`. These are
        identical to the 110 form proven on `afldb_test`.
      - Guard: **State B, 0 rows (active 0), PERMITTED**, exit 0. This is the last point at which a
        code rollback is possible without rolling forward (D-257-7).
      - `data_overrides` by type is unchanged from the pre-deploy baseline (no `player_match_stats`
        row). `data_edits` 2; `player_match_stats` 695,499 (unchanged).
      - Service active, same PID 2531653 and BUILD_ID (no restart needed). Health
        `{"status":"ok","database":"ok"}`; `/beta` 200, `/admin/data-editor` 307 (gate).
      - Timers unchanged: `afldb-settle-afl-api-brownlow` last ran 20:35, `Result=success`;
        `afldb-settle-afl-api` daily 05:12. Settle units inactive.
      - Recovery copy `~/afldb-recovery/3e98fb7b-JwX7eDNatI1eTE96fhO9y` still present (825 MB),
        retained.
    - **Stopped before any Match Sheet correction or authority write** (Run C step 8). No PROD work.
  - **Steps 8–13: controlled correction, settles, Return to source (operator-authorised, 2026-10-03
    20:39–20:50 AEST, main session).** Authorisation: one correction, M = 17275 and P = 345, marks
    0 → 1, only if a fresh snapshot still shows 0 and an `afltables` owner; stop otherwise. The UI was
    driven in the Playwright browser after the operator signed in as Super Admin. SQL was read-only
    (`BEGIN TRANSACTION READ ONLY`) through the 55432 tunnel as `afldb_owner`. Host commands went
    through scp'd scripts. Evidence is in `D:\tmp\issue257-runD\`: `dev-s8*.txt`, `dev-s9-host-guard.txt`,
    `dev-s10*.txt`, `dev-s11*.txt`, `dev-s12*.txt`, `dev-s13-host.txt` and `shots\`.
    - **Preconditions (20:39:37, re-checked 20:42:41 just before the save): MET.**
      - Row 705529: marks 0, owner `afltables`, `import_batch_id` 91, one AFL Tables path
        (`players/A/Alex_Pearce.html`, `unique`).
      - M's 46-row md5 `08a1673a…f850` equals the State A before-image. The other 45 rows' md5 is
        `8efe7540…a90c`, and P's row minus `marks` is `b2c5b88e…7650`.
      - `data_edits` 2, `player_match_stats` overrides 0, `player_match_stats` 695,499.
      - Host: `a27f7104`, BUILD_ID `Etn3f80GrxGD2DU9Uj0q5`, PID 2531653, health ok/ok, 0 pending,
        guard State B / 0 rows / PERMITTED, recovery copy present.
    - **Step 8: correction PASS.** Saved at 1440×900 from a fresh page load, with only P's `M` input
      changed (the row's inputs were checked before submitting) and the note "ISSUE-257 DEV acceptance".
      - The UI showed "✓ Match sheet saved successfully (46 players)".
      - Q1: marks 1. P's other fields are byte-identical (minus-marks md5 unchanged). The other 45
        rows are byte-identical (md5 unchanged). Owner `afltables`, row count unchanged.
      - Q2: exactly one row, id 237. `entity_key` is
        `2026|GF|2026-09-26|Fremantle|Brisbane Lions|afltables:players/A/Alex_Pearce.html`,
        `field_group` `match_sheet`, active, `override_values` `{"marks": 1}`.
      - `data_edits` id 3 (`matches`/17275) has the note, `players.345 = {kind: update, values:
        {marks: 1}}` and `authorityKeys = [{action: mint, playerId: 345, entityKey: <as above>}]`.
    - **Step 9: rollback guard PASS.** `issue257-rollback-guard.ts --target dev` printed "REFUSED
      (D-257-7)", 1 row (active 1), exit 2. **DEV has been roll-forward only since 20:42:56.**
    - **Step 10: first settle PASS (batch 100, 20:44, `Result=success`).**
      - 10,246 read; 0 inserted, 0 updated, 0 refused, 0 rejections.
      - Every `validation_result` counter equals batch 99, including `canonicalRetryApplied` 0 and
        `manualAuthorityRefusals` 0. No new `data_issues`.
      - Q1 still shows marks 1. Q2 is unchanged (same `updated_at`), the other 45 rows' md5 is
        unchanged, and P's minus-marks md5 is unchanged.
      - The protection is direct, not incidental. With an unchanged payload the settle still offers a
        `retry` whenever the automatic proposal differs from the canonical row
        (`settle-afltables.ts:2215-2221`, `invitationFor`). That is the path that reverted
        corrections before the fix (§8). Without the authority scoping, batch 100 would have written
        marks 0 (the batch 101 retry below shows exactly that write). Unprotected fields match the
        source **by equality** (0 updates across 10,028 player rows), not by an observed change;
        upstream did not move between batches 99 and 101.
      - The journal lists the same 20 open AFL API `foreign_source_owner` apply failures as before
        the deploy. They are pre-existing, not 257.
    - **Step 11: Return to source PASS (20:46:25).** It ran from the panel at 1440×900, and the
      confirm dialog was accepted.
      - S3 message: "✓ Returned to source: the Match Sheet decision was withdrawn and the next source
        update restores the source values. Reload this page before editing the match sheet further."
        The panel returned to the S1 empty state.
      - Q2: id 237 `is_active = f`, retained, `updated_at` 20:46:25. Q1 is still marks 1, as designed.
      - `data_edits` id 4 (`matches`/17275): `withdrawnKeys = [<key>]`, `rowDeleted` false,
        `old_values.withdrawn` holds the record's payload.
      - **S4:** a second tab loaded before the withdrawal then clicked Return to source. It showed
        "⚠ There is no durable Match Sheet authority for this player in this match. Nothing was
        changed." No write: `data_edits` stayed 4 and 237's `updated_at` is unchanged.
    - **Step 12: second settle PASS (batch 101, 20:48, `Result=success`).**
      - "0 inserted, 1 updated, 1 ledger row, 1 retried after resolution; derived recompute ran (1
        player)". Against batch 100 the only differences are `canonicalApplicationsLogged`,
        `canonicalRetryApplied`, `canonicalRowsUpdated`, `derivedRecomputePlayers` and
        `derivedRecomputeRuns`, each 0 → 1. Every refusal/failure counter is 0, with no new
        `data_issues`.
      - `canonical_applications` 40023: `update`, target `{match_id 17275, player_id 345}`,
        `previous_values {marks: 1}` → `new_values {marks: 0}`.
      - Q1: marks 0, the source value (the step-5 pre-value). The row equals the pre-save image except
        `import_batch_id` 91 → 101, which the settle stamps on update. The other 45 rows' md5 is
        unchanged.
      - Q2: 237 is still inactive. The authority stays released, and the record is retained as the
        D-257-7 history. A reload of the sheet shows M = 0 and the S1 panel.
    - **Step 13: service and schedule PASS (20:49).**
      - Health `{"status":"ok","database":"ok"}`. `afldb` active since 20:18:56, same PID 2531653,
        same BUILD_ID.
      - 0 pending.
      - Guard REFUSED, 1 row (active 0), exit 2: stays REFUSED, as designed.
      - Timers unchanged: `afldb-settle-afl-api-brownlow` every 5 minutes, `afldb-settle-afl-api`
        daily 05:12. Settle units inactive, `Result=success`.
      - Host tracked tree clean. The only new untracked files are the settle manifests for 2019,
        2044 and 2047 (8 in total).
      - Recovery copy retained (825 MB).
    - **Step 14: visual evidence (Playwright, this repository's browser; files in
      `D:\tmp\issue257-runD\shots\`).**

      | State | 1440×900 | 390×844 |
      |---|---|---|
      | S1 no authority | PASS (`S1-1440x900-panel.png`) | captured, overflow below (`S1-390x844-viewport.png`) |
      | S2 one edited row | PASS (`S2-1440x900-panel.png`) | captured, Return to source button clipped (`S2-390x844-viewport.png`) |
      | S3 returned | PASS (`S3-1440x900-panel.png`) | captured, overflow below (`S3-390x844-viewport.png`) |
      | S4 refusal (no authority) | PASS (`S4-1440x900-panel.png`) | captured, overflow below (`S4-390x844-viewport.png`) |
      | S5 authority unavailable | **NOT EXERCISED** | **NOT EXERCISED** |

      - **V-257-01 (LOW, visual, 390×844).** The whole match-sheet section overflows by about 32 px
        (`scrollWidth` 439 vs `clientWidth` 375). Its grid track is 407 px because of the existing
        match header (min-content 405 px) and the team-tab row (407 px). The 257 panel itself needs
        only 102 px. The panel's text and S2's Return to source button therefore run past the right
        edge, reachable only by horizontal scroll. The cause predates 257; the panel inherits it.
        Not fixed (no code change was in scope).
      - **V-257-02 (INFO).** After an S4 refusal, a stale page keeps listing the withdrawn row until
        it is reloaded. The S3 message already says to reload.
      - Not exercised on DEV: **S5** (needs an unavailable import connection or a failed authority
        read; inducing it would mean changing DEV configuration or privileges, which was not
        authorised), and **S2's addition and removal rows** (they need a lineup addition or removal,
        outside the one authorised correction). The S4 provenance-mismatch and "settle running"
        variants were not exercised either. These remain `VISUAL: UNVERIFIED`.
      - Incidental: the Playwright browser's cookie banner was accepted by mistake. It set one
        anonymous search-session cookie in that test browser only.
    - **Not done:** no PROD work. The recovery build was not touched. No code or schema change.
      `afldb_dev` now holds exactly one `player_match_stats` authority record (inactive), plus
      `data_edits` 3 and 4, and `canonical_applications` 40023 and batches 100–101 from the settles.
    - **Acceptance status: NOT COMPLETE.** Steps 8–13 passed. Step 14 is partial: S5 and S2's
      addition/removal rows are not exercised, and V-257-01 is open for an operator decision. ISSUE-257
      stays open. Keep the recovery copy.
  - **V-257-01 fix and local panel verification (operator-authorised, 2026-10-03 20:52–21:10, main
    session).**
    - **Decision.** Fix V-257-01 within ISSUE-257 and keep desktop usable. Exercise S5 and S2's
      addition/removal states locally on the real component, with controlled fixtures and simulated
      authority unavailability. No DEV configuration, privilege or lineup change; no commit, deploy, PROD
      or DEV rollback.
    - **Root cause, confirmed in the harness.**
      - The editor's `<section>` is `display: grid` with one auto track. That track grew to the widest
        unwrappable child: the header link row (`MatchSheetEditor.tsx` header, no `flexWrap`), the view
        tabs and the `.btn` (nowrap) helper buttons. Every block below grew with it.
      - Separately, the panel's 4-column table would still have hidden Return to source in a sideways
        scroll at phone width.
      - Two further causes were found while verifying:
        - an unbroken stored key (the indeterminate-key badge) or error reason sets the panel's
          min-content width (S2i at 390: 150 px of overflow);
        - wrapping `.table-wrap` in `.responsive-table` made the wrapper the panel's grid item, so the
          table's nowrap width widened the panel at 641–767 px (700: 26 px of page overflow).
    - **Fix (`src/app/admin/data-editor/MatchSheetEditor.tsx`).**
      - The section gets `grid-shrink`, the ISSUE-144 opt-in (`> * { min-width: 0 }`).
      - Every single-line flex row gets `flexWrap: 'wrap'`: the header links, the view tabs, the team
        header and the save row. The two helper buttons get `whiteSpace: 'normal'`.
      - The panel:
        - uses the shared `.responsive-table` toggle, so below 640 px each decision is an `.admin-card`
          with a `<dl>` (Club, Decision) and a full-width `.admin-card-action` button;
        - shares one `returnForm(entry)` between the table row and the card, so behaviour is identical;
        - gets `gridTemplateColumns: 'minmax(0, 1fr)'` and `overflowWrap: 'anywhere'`. The latter is
          inherited, but table cells keep `white-space: nowrap` (`globals.css:486-489`), so the desktop
          table is unaffected.
      - No server, query or schema change. The new type import is `import type` only (the F-DEV-01
        lesson).
    - **Regression test.** `tests/admin-match-mutations.test.ts` adds "keeps the sheet and its
      durable-decisions panel inside a phone viewport (AFLDB-ISSUE-257 V-257-01)". It pins:
      - `grid-shrink` on the section;
      - at least 6 single-line flex rows, every one wrapping;
      - the `.responsive-table` and `.admin-cards` markup, with `returnForm` in both layouts;
      - the panel's `minmax(0, 1fr)` track and `overflowWrap`.

      Applied to the committed `a27f7104` file, every one of those checks fails. On the worktree all pass.
    - **Validation (workstation).**
      - `npm run typecheck`: exit 0.
      - eslint on the 2 files: exit 0.
      - vitest `tests/admin-match-mutations.test.ts tests/match-sheet.test.ts tests/brownlow-entry.test.ts`:
        177/177.
      - `npm run build`, with `DATABASE_URL` / `AFLDB_AUTH_DATABASE_URL` set process-only to `afldb_test`
        through 55432: exit 0. Compiled successfully, 1,515/1,515 static pages, standalone bundle ready,
        BUILD_ID `fbXkXqxJUcykWEJ0Mwhtx`. The only stderr is Next's existing `middleware`→`proxy`
        deprecation notice.
      - Logs: `D:\tmp\issue257-runD\v25701-*.log`.
    - **Local verification (LOCAL, NOT DEV evidence).** The harness is in `D:\tmp\issue257-runD\local-v257\`,
      and the images and `README.md` are in `D:\tmp\issue257-runD\shots\local\` (58 PNGs).
      - It bundles the real `MatchSheetEditor` with esbuild. Only the 'use server' actions module,
        `next/link` and `next/navigation` are stubbed.
      - It uses the site CSS unmodified, DEV's `data-site-theme="editorial"` and
        `data-site-layout="classic"`, and the admin shell classes. Its geometry matches DEV: the section
        is 1025 px at 1440 and 311 px at 390.
      - **S5 was simulated through the real loader:** `loadMatchSheetAuthoritySummary` with no import
        DSN (S5a, "AFLDB_IMPORT_DATABASE_URL is not configured.") and with an unreachable DSN (S5b,
        "connect ECONNREFUSED 127.0.0.1:1"). The settle-running text comes from
        `matchSheetRetryableRefusal`.
      - **Controlled S2:** an edited row (K, H, D, M), a manual addition and a manual removal (club `—`),
        plus S2i with an unattributable key.
      - **Fidelity:** the committed `a27f7104` build reproduces V-257-01 in the harness. At 390 it
        overflows by 156–170 px, with the buttons at x 533–679.
      - **Display, fixed build, 390×844 and 1440×900, S1/S2/S2i/S5a/S5b: PASS.**
        - Page overflow 0, the panel and all its text inside the viewport.
        - At 390, cards with 3/3 buttons in the viewport (x 67–308).
        - At 1440, the table is identical to before: buttons at x 1099–1244, same section width and page
          height.
      - **Width matrix, 17 widths × 5 scenarios:** 0 overflow from 360 to 1440. 320 is in the gaps below.
      - **Behaviour, 12/12 PASS (6 cases × 2 viewports).**
        - Cancel posts nothing.
        - Each accept posts exactly one call with the right `matchId`/`playerId`. While pending every
          button shows "Returning…" and is disabled.
        - Results: S3 row-removed (addition), S3 withdrawn (edit and removal), the S4 no-authority alert,
          and the S4 settle-running alert.
        - One visible button per player.
        - The **native** confirm dialog was exercised by hand on the 390 card layout: cancel gave 0 calls;
          accept gave one call and S3.
    - **Coverage now.**

      | State | DEV (a27f7104, real data) | Local (fixed component, fixtures) |
      |---|---|---|
      | S1 | PASS 1440; 390 shows V-257-01 | PASS both |
      | S2 edited row | PASS 1440; 390 shows V-257-01 | PASS both, with button behaviour |
      | S2 addition / removal rows | not exercised | PASS both, with button behaviour |
      | S3 | PASS 1440; 390 shows V-257-01 | PASS both (addition and withdrawn variants) |
      | S4 no authority | PASS 1440; 390 shows V-257-01 | PASS both |
      | S4 settle running | not exercised | PASS both |
      | S4 provenance mismatch | not exercised | not exercised (display path identical to the other S4 alerts) |
      | S5 not configured / read failed | not exercised | PASS both |

    - **Remaining gaps.**
      1. **The fix is not deployed.** DEV still runs `a27f7104`. After commit, merge and deploy, re-check
         S1 (or S2) on DEV at 390×844 with real data. Until then V-257-01 is fixed locally and
         `VISUAL: UNVERIFIED` on DEV.
      2. The local evidence stubs the server actions. The server semantics of Return to source on
         additions and removals are covered by the `data-editor` integration suite on `afldb_test`
         ("Run D resume"), not by the harness. The harness keeps the returned row after S3 because its
         props are static; on DEV the panel re-renders without it, as seen in step 11.
      3. S2 addition/removal and S5 remain unexercised on DEV with real data (by instruction: no lineup
         or configuration change).
      4. **LOW, unchanged by this fix:** from 641 to about 767 px (table mode), Return to source starts
         inside `.table-wrap`'s own horizontal scroll, the same as before and as the shared
         `.responsive-table` pattern on Coaches, Draft and Fixtures. Not in the 390×844 requirement.
      5. **INFO:** at 320 px the page overflows by 15 px, caused by the site-wide
         `body { min-width: 320px }` plus a classic desktop scrollbar, not by the sheet. It was 226 px
         before.
      6. The fonts are the same families loaded from Google Fonts; DEV self-hosts them with `next/font`.
         The geometry matched DEV.
    - **Not done:** no commit, deploy, PROD access or DEV rollback. No DEV configuration, privilege,
      lineup or database change in this pass. The recovery copy is retained. ISSUE-257 stays open.

  - **DEV deploy of `39a9fed1` and V-257-01 re-check (operator-authorised, 2026-10-03 21:2x AEST).**
    - **Authorisation.** Deploy merged `39a9fed1` to DEV with `-SkipMigrate -RemoteRef main`; recovery copy first;
      no correction, lineup, privilege or PROD change; no rollback below ISSUE-257.
    - **Recovery copy.** `~arm/afldb-recovery/a27f7104-Etn3f80GrxGD2DU9Uj0q5` (copy of the `a27f7104` standalone
      build, BUILD_ID `Etn3f80GrxGD2DU9Uj0q5`, `RECOVERY_COMMIT` marker). `diff -rq` against the live build:
      identical (13,224 files; 13,225 with the marker). The `3e98fb7b` copy is also retained.
    - **Preflight** (`D:\tmp\issue257-runD\preflight-39a9fed1.log`, psql on PATH and the owner DSN via 55432,
      process-only): READY, 0 blockers, 0 warnings, migration parity 110/110, no pending-migration exception.
    - **Deploy** (`dev-deploy-39a9fed1.log`): `sync-dev.ps1 -SkipMigrate -RemoteRef main` exit 0; health ok on
      the 2nd probe.
    - **Verification** (`dev-post-deploy-39a9fed1.txt`): host HEAD `39a9fed1` on `main`; BUILD_ID
      `IvHo-v-Lq-aKwzFe4i2nN`; service active, MainPID 2596012; health `ok`/`ok`; migrations 110 applied, 0
      pending; rollback guard State B, 1 `player_match_stats` record (active 0), **REFUSED (D-257-7), exit 2, as
      expected**; timers `afldb-settle-afl-api` and `afldb-settle-afl-api-brownlow` present (DEV has no
      `afltables` timer, as before); all three settle units inactive, `Result=success`. The host working tree
      shows the same 8 untracked `docs/rebuild-manifests/.../settle-*.json` files as before the deploy.
      INFO: systemd logged "Failed to kill control group ... Unit process (next-server) remains running after
      unit stopped" on the restart. The post-deploy probe also listed one `next-server (v16.3.3)` process
      (PID 3908) beside the unit's four v16.3.1 workers. *(At the time this was logged as "Not investigated;
      not a 257 defect", an assumption. The read-only investigation in §19.5 shows PID 3908 is an unrelated
      service, `streamanator-dashboard.service`, not an AFLDB process.)*
    - **Visual evidence (DEV, real Match Sheet 17275, Playwright; `D:\tmp\issue257-runD\shots\dev-39a9fed1\`).**
      State shown: S1 (record 237 is inactive, so "No durable decisions").

      | Viewport | Page overflow | Section | Panel | Wide tables |
      |---|---|---|---|---|
      | 390×844 | none (375/375) | 311 px (was 407+ on `a27f7104`) | x 32–343, inside | scroll inside `.table-wrap` (1007 in 311) |
      | 700×900 | none | 615 px | x 35–650 | scroll inside `.table-wrap` (1070 in 615) |
      | 1000×800 | none | n/a | n/a | scroll inside `.table-wrap` (1070 in 613) |
      | 1440×900 | none | 1025 px (unchanged) | x 336–1361 | none wider than the viewport |

      Verdict: V-257-01 is fixed on DEV with real data; desktop layout is unchanged and usable; intermediate-width
      scrolling stays inside the tables. Files: `match-sheet-{390x844,700x900,1000x800,1440x900}-{viewport,panel}.png`.
    - **Coverage, kept separate.**
      - DEV (real data): S1 at 390 and 1440 (this pass); S1–S4 at 1440 and the DEV behaviour in steps 8–13
        (`a27f7104`).
      - Local only (fixtures, stubbed actions; not DEV evidence): S2 addition/removal, S4 settle-running, S5a/S5b,
        button behaviour 12/12.
      - Not exercised anywhere: S4 provenance mismatch.
      - The "Return to source" card/button layout at 390 was not seen on DEV (record 237 is inactive, and no
        further correction was authorised). It is local-only evidence.
    - **Acceptance status: COMPLETE for DEV.** Step 14 permits states not reachable on DEV to be recorded as not
      exercised; they are. Closure tracking prepared for operator review: `issues.md` entry set to Resolved,
      removed from `IssuesIndex.md` and the Open Issues table, `CHANGELOG.md` heading updated. The runbook
      moves to `issues/closed/` with the operator's commit. PROD promotion is outside this pass.
    - **Not done:** no PROD access; no correction, lineup, privilege or schema change; no rollback. Recovery
      copies retained.

### 19.5 Closure (2026-10-03)

- **Verdict: Resolved / DEV accepted. PROD promotion outstanding.** PROD promotion is a separate, separately
  authorised sequence (`docs/production-promotion.md`); it has not run and nothing in this runbook authorises it.
- **Evidence classes, kept separate.**
  - *DEV, real data.* At `a27f7104`: State A, migration 110, correction 17275/345 surviving settle 100, guard
    REFUSED, Return to source, settle 101 restoring the source value (steps 8–13); S1–S4 at 1440. At `39a9fed1`
    (BUILD_ID `IvHo-v-Lq-aKwzFe4i2nN`): real Match Sheet 17275, S1 only, at 390×844, 700×900, 1000×800 and
    1440×900 (§19.4 "DEV deploy of `39a9fed1`").
  - *Local fixtures, stubbed server actions (not DEV evidence).* S2 addition and removal rows, S4 settle-running,
    S5 not-configured and read-failed, button behaviour 12/12, and the 390 Return to source card/button layout.
  - *`afldb_test` / `code_test_db` integration suites.* Server semantics of Return to source on additions and
    removals ("Run D resume").
- **Retained coverage gaps.**
  1. S2 addition and removal and S5 are local-only; they were not exercised on DEV with real data (by
     instruction: no lineup or configuration change).
  2. The mobile **Return to source** button was verified locally only. It was not seen on DEV (record 237 is
     inactive; no further correction was authorised).
  3. S4 **provenance mismatch** was exercised nowhere (its display path is identical to the other S4 alerts).
  4. S4 settle-running is local-only.
- **Documented limitation (LOW, accepted).** Between about 641 and 767 px (table mode), Return to source starts
  inside `.table-wrap`'s own horizontal scroll, the same as the shared `.responsive-table` pattern on Coaches,
  Draft and Fixtures. Not in the 390×844 requirement; unchanged by the V-257-01 fix. INFO: at 320 px the page
  overflows by 15 px from the site-wide `body { min-width: 320px }` plus a classic scrollbar, not from the sheet.
- **Rollback posture.** DEV is **roll-forward only**: the guard REFUSED (D-257-7) once record 237 existed.
  Both recovery copies are retained on the DEV host: `~arm/afldb-recovery/3e98fb7b-JwX7eDNatI1eTE96fhO9y` and
  `~arm/afldb-recovery/a27f7104-Etn3f80GrxGD2DU9Uj0q5`. Neither is to be removed.
- **Related issues, opened separately:** ISSUE-261, ISSUE-262, ISSUE-263 (open, none blocks 257). R-01 (rekey
  lock) and V-257-01 (phone layout) were fixed within 257.
- **`next-server` PID 3908 (read-only investigation, 2026-10-03 21:40 AEST): not an AFLDB process; DEV serves
  the intended build.** Operator-authorised read-only script `pid3908-readonly.sh` (LF copy `pid3908-lf.sh`, no
  kill, restart, write or configuration change; environment filtered to `PORT`, `HOSTNAME`, `NODE_ENV`,
  `INVOCATION_ID`; the uploaded copy was removed afterwards). Output kept at
  `D:\tmp\issue257-runD\pid3908-output.txt`.
  - **PID 3908 is the Streamanator dashboard.** cgroup `/system.slice/streamanator-dashboard.service` (unit
    "Streamanator TypeScript dashboard", Main PID 3908, active since 2026-10-01 17:50:12), cwd
    `/home/arm/projects/streamanator_dashboard/web`, `PORT=8600`, listening on `0.0.0.0:8600` only, PPID 1.
    It started two days before this deploy, runs `next-server (v16.3.3)` from a different checkout
    (BUILD_ID `phJCkyx1ZEqMmWWRvgKXA`, no `RECOVERY_COMMIT` marker) and is outside the `afldb.service` cgroup.
    The earlier probe, `pgrep -af next-server`, matches the process title on the whole host, so it listed this
    unrelated service. It was a false positive, not a leftover of the restart.
  - **The 3100 listener is the current AFLDB unit.** `127.0.0.1:3100` is held by PID 2596012
    (`deploy/server-cluster.mjs`, `afldb.service`, started 21:28:01, cwd `/home/arm/projects/afldb`) with four
    v16.3.1 workers in the same cgroup. `.next/BUILD_ID` at the listener's cwd, the checkout and
    `.next/standalone` are all `IvHo-v-Lq-aKwzFe4i2nN`; checkout HEAD is
    `39a9fed1ab1113e9a251506d327ec213ff726373`. `/api/health` on 3100: `{"status":"ok","database":"ok"}`.
  - **The restart's cgroup-kill messages are INFO, with no residue.** The journal shows, on both the 20:18:51 and
    21:27:57 restarts, "Failed to kill control group ... Invalid argument" and "Unit process ... remains running
    after unit stopped" for old-build workers (2531481; 2595793 and 2595859), each already sent SIGKILL. None of
    them is present at 21:40, and the only `next-server` processes besides PID 3908 are the four current
    workers. The messages are systemd teardown noise on this host. No stale AFLDB process survived, so nothing
    serves an old build. This is not tracked as an issue: it left no residue, affected no served request and has
    no known root cause. It would become one if a post-restart probe, filtered by cgroup rather than process
    title, ever finds an old-build worker still alive in or outside `afldb.service`.
  - **Closure verdict unchanged.** No blocker found. ISSUE-257 stays Resolved on DEV acceptance, with PROD
    promotion outstanding.
  - **Probe hygiene.** Check the serving build by listener and cgroup (`ss -ltnp 'sport = :3100'`, then
    `/proc/<pid>/cgroup`), not by `pgrep next-server`, which also matches other Next apps on this host.