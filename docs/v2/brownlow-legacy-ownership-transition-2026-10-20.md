# Brownlow canonical ingestion and the legacy-ownership transition (2026-10-20)

**Owner policy update, 2026-10-20:** OD-BROWNLOW-OWNERSHIP-1 is approved for season 2025 only: 621 positive-vote rows / 207 sets, preserving 8,901 legacy zero rows and original provenance. Execution remains pending. Historical proposal/rehearsal wording below is retained as reviewed evidence. [Decision, content hashes and owner instruction](brownlow-policy-decisions-2026-10-20.md).

Status: **canonical ingestion verified on a clean isolated target. The legacy-ownership transition is
implemented and demonstrated on a disposable clone only. Production adoption is an OWNER DECISION and
is unapplied.** Brownlow is therefore **not** operationally ready: until the owner decides and the
transition is run, all 207 vote sets of 2025 refuse `ownership_indeterminate` on the archived
production-shaped data. Current live state has not been accessed.

**Current owner-review package:** [guarded production correction package](brownlow-production-approval-package-2026-10-20.md).
The new separate entry point keeps the isolated CLI unchanged, requires separately approved migration
116 for immutable receipts, and binds each apply or inverse to a fresh backup/restore baseline,
exact target identity, season 2025, `afl_api` source, reviewed plan digest and code revision. New local
rehearsal evidence supplements the completed evidence below; no production adoption is approved.

## 1. The blocker

- `canonical-apply.ts` `autoApplyOwnership` refuses any `brownlow_round_votes` row whose `source_id IS
  NULL` (`ownership_indeterminate`): a source-less row cannot be proven unowned, so NULL means
  "provenance unknown", never "free to adopt". Every archived round-vote row is source-less (2025:
  9,522 rows, `source_id` NULL; 2026: 9,522 rows owned by `afltables`).
- The same file (§19.1(e)) forbids any settle path from setting `source_id` on an UPDATE; an ownership
  transfer must be "an explicit operator-run script". The new module is that script, kept separate from
  `canonical-apply.ts` and imported by nothing in the settle.

## 2. Grain comparison (legacy vs API, 2025, authentic data)

| Question | Finding |
|---|---|
| Shape | Legacy is dense: 9,522 rows (621 positive + 8,901 zero-vote participation rows). The API feed is sparse: 621 positive rows over 207 matches, three per match (3, 2, 1). |
| Comparable grain | The 621 positive rows. The 8,901 zero rows have no API counterpart and no evidence either way; they are never adopted. |
| Value agreement | 621/621 staged positive rows equal the legacy value at the same `(season, player, round)`. |
| Match identity | Staged `match_id` equals the migration-094 rule's single match for 621/621. Two independent identities agree. |
| Duplicates | None: `(season, player, round)` is unique; no extra positive legacy row in any of the 207 matches; no vote slot held by another row. |
| Provenance | Legacy rows carry `source_record_id` and `import_batch_id` from the older importer; both are preserved (below). |
| Result | **207/207 sets adoptable, 0 refused** (all eight refusal classes counted, none occurred). |

## 3. The narrowest safe procedure (`brownlow-legacy-ownership-adoption.ts`)

Per vote set, only the three positive legacy rows move: `source_id` to the API source, `source_record_id`
to the provider match id, `import_batch_id` to one dedicated adoption batch. Votes, `played`,
`imported_at` and `match_id` are untouched. Zero-vote rows stay legacy and unowned.

- **Preconditions (per set; any failure refuses the set and it never reaches the export):** complete
  staged set (3, 2, 1; one resolved match; three resolved distinct players; head version of a
  not-absent record); legacy row exists, is unowned, `played`, with the same vote value; its `match_id`
  is NULL or equals the staged match and the 094 rule independently names the same single match; no
  other positive legacy row belongs to that match and no other row holds its vote slots. Codes:
  `incomplete_staged_set`, `legacy_row_missing`, `legacy_row_owned`, `legacy_value_disagrees`,
  `legacy_match_conflict`, `legacy_match_unproven`, `legacy_extra_positive`, `legacy_slot_taken`.
- **Two keys, no force flag.** Apply needs the reviewed export, the digest the reviewer read, the
  pinned database name and a written owner-decision reference (≥ 20 characters, stored in the batch
  note). A tampered export fails its own digest; a drifted set refuses the **whole** transaction.
- **Transaction.** Settle gate exclusive, Brownlow admin lock, table lock; one transaction; postconditions
  prove no stable column (identity, votes, `played`, `imported_at`, `match_id`) moved, no row outside the
  export changed ownership, and every exported row is API-owned; otherwise rollback. The batch is closed
  inside the same transaction.
- **Audit and provenance.** Each adopted row writes one `canonical_applications` row (verb `update`,
  `previous_values` = the legacy `source_id`/`source_record_id`/`import_batch_id`, `new_values`, bound to
  the exact staged vote-set version) under the adoption's own `import_batches` row. Legacy provenance
  is also in the export.
- **Replay** finds every set already adopted by ledger and writes nothing (no batch). **Reversal**
  restores the legacy provenance exactly from the export and ledgers itself; it refuses
  (`reversal_drift`) once an adopted row has changed, in particular once the API settle has written.
- CLI `tools/v2/brownlow-ownership-adoption.ts` (`plan | apply | reverse`, isolated runner only).
  Tests: `tests/v2-brownlow-legacy-ownership-adoption.test.ts` (21: each refusal class, tampered export,
  wrong digest/database, missing decision, drift refusing the whole export, injected mid-write failure,
  postcondition failure, replay, reversal, drift on reversal).

## 4. Disposable-clone demonstration (clone `afldb_v2_rb_gap023_test`)

| Step | Result |
|---|---|
| Settle dry run, before | 207 vote sets apply-failed (`ownership_indeterminate`), 0 would auto-apply |
| `plan` | 207 sets adoptable, 0 refused; digest `6971ec91…a385` |
| Refusals | wrong digest, too-short decision, tampered export: all refused, state identical |
| Apply | 207 sets, 621 rows, 621 ledger rows, one batch; stable and outside-ownership fingerprints equal before/after |
| Replay | 0 changed, 207 already in state, no batch, state identical |
| Reverse | 207 sets, 621 rows restored; ownership table, public round-vote hash and season-vote hash identical to before |
| Reverse replay / re-adopt | 0 changed / re-plan digest equal to the first, apply 621 rows, state equal to the first apply |
| Settle dry run, after adoption | 0 apply-failed; 621 updates would be written (match_id heal and provenance), votes unchanged |
| Ordinary settle `--apply --auto-apply` after adoption | 0 inserted, **621 updated** (match_id and provenance), 0 failed; vote values and public hash unchanged; season-vote hash unchanged; every 2025 `match_id` equals the 094 rule |
| Settle replay | 207 vote sets no-op, 0 rows; state identical |
| Reverse after the API has written | **refused** `reversal_drift`, nothing written (as designed; reversal evidence is the earlier step) |

Not auto-resolved: the 207 `data_issues` rows (`afl_api_brownlow_settle`) opened by the pre-adoption
refusal stay open after the settle succeeds; the settle never closes its own issues. They need an
operator resolution through the existing data-issues workflow when the transition is done.

## 5. Ordinary canonical ingestion on a clean isolated target (separate from adoption)

Clone `afldb_v2_rb_clean_test` (from the authentic-2025 copy). **Sandbox preparation, labelled and not
migration-preservation evidence:** the 9,522 legacy 2025 round-vote rows were removed so the target
holds no 2025 votes. Settle `--apply --auto-apply` of the retained snapshot:

- 207 vote sets, **621 rows inserted**, 621 `canonical_applications` rows, 0 failed, 0 refused.
- The inserted positive rows are hash-identical (player, round, votes; md5 `8cc916c9…5438`) to the 621
  legacy positive rows of the adoption clone. All 621 carry the API source and a `match_id`.
- Replay: 207 vote sets no-op, 0 inserted/updated, state identical.
- The API writes sparse positive rows only; the legacy zero-vote participation rows are not
  reproduced by ingestion (they remain a legacy artefact for archived seasons).

## 6. Owner decision required (exact proposal; **left unapplied**)

**Decision OD-BROWNLOW-OWNERSHIP-1 (proposed).** Adopt, for **season 2025 only**, the 621 positive-vote
`brownlow_round_votes` rows of the 207 vote sets in the retained snapshot
`afl-api-brownlow-2025-2026-10-20-014218` as owned by the `afl_api` source, via the module in §3, with
the 8,901 zero-vote 2025 rows left legacy and unowned.

Prerequisites on production, in order: (1) the leaderboard/vote staging exists (one operator-run
`--observe-only` settle with this code; V2-GAP-023); (2) the `match_id` backfill, if the owner wants it
first (not required by the adoption, which accepts NULL or equal); (3) `plan` on a restored copy matches
§2 (207 adoptable, 0 refused) and the owner signs the digest; (4) a separately reviewed production
runner (the CLI is isolated-only, same boundary as the backfill); (5) run during a window with no
settle; (6) verify; keep the export for reversal until the first API settle has written, after which
reversal is no longer possible by design.

The guarded package supplies `observe`, `backfill`, `adopt`, `eligibility` and narrowly evidenced
`resolve` requests. Each needs its own fresh execution plan/approval. `reverse-adopt` also requires
the original receipt/export and an unchanged complete post-baseline: it is **more conservative** than
the existing inverse. Subsequent API writes continue to refuse reversal; there is no force flag.
Issue resolution is limited to named ownership-indeterminate findings with all 621 canonical/staged
vote values and match IDs equal and all 207 current sets API-owned. It does not claim eligibility or
whole-season reconciliation, and it does not start a canonical settle.

**Out of scope and still unowned by any decision:** 2024 and earlier (no API snapshot, nothing to
adopt); 2026 (rows are `afltables`-owned, so ordinary API ingestion would refuse them
`foreign_source_owner`; this needs its own ownership policy decision when the 2026 count is wired).

## 7. Readiness statement

Do **not** label Brownlow operationally ready. Canonical ingestion is verified on clean data; the legacy
transition is proven on a clone but unapplied; owner decisions on the 12 eligibility rulings and the
API-era eligibility rule (see [eligibility ruling](brownlow-eligibility-ruling-2026-10-20.md)) are open.
