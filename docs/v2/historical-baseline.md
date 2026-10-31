# AFLDB V2 — the sealed historical baseline

Status: Stage 2 (2026-10-19). Defines what is sealed, what may change it, how it is verified,
restored and reconciled. Nothing here has been executed against any database; V2 has no
database access (plan §1). Owner rules applied: keep historical baseline data sealed unless an
explicit correction workflow is used; never silently rewrite historical records; never delete
historical records because the AFL API cannot reproduce them; do not copy production data into
the repository (`docs/v2/owner-instruction-2026-10-19.md`).

## 1. Definition

The **sealed historical baseline** is the canonical AFL/VFL football record for every **sealed
season**, as held in the existing PostgreSQL database. It is not a copy, an export or a file in
this repository; the repository holds only its definition, its verification tooling and, when an
authorised run produces one, a content-free manifest of it.

- **Sealed seasons**: every season from `first_season` to the last season not listed in
  `in_progress_seasons` in `data/reference/seasons.json`. Today: **1897-2025**. 2026 is open.
  The rollover (`tools/db/rollover-season.ts`) seals a season by writing `in_progress_seasons:
  [Y + 1]`.
- **Covered tables**: the fact and reference tables listed in
  `docs/v2/historical-manifest-spec.md` §2 (`HISTORICAL_TABLES`).
- **The AFL API does not redefine it.** API coverage is approximately 2012-2026 by season
  registry and detailed verified contracts only for about 2022-2026 (owner instruction, "Treat API coverage
  honestly"). A sealed season's rows stay authoritative whether or not the API can reproduce
  them; the coverage registry (plan D11, delivered in Stage 3: `docs/v2/coverage-matrix.md`,
  generated from `packages/domain/src/coverage-registry.ts`) labels each season and family
  (`api_verified`, `api_partial`, `historical_baseline`, `manual_curated`, `unsupported`), and
  no season is labelled rebuildable without evidence.

## 2. What may change a sealed row

Only an **explicit, audited correction workflow**. Every one that exists today leaves an
append-only audit row in the same transaction (`docs/v2/provenance.md` §4-5):

| Workflow | Audit trail |
|---|---|
| super-admin data editor (players, matches and the allowlisted entities) | `data_edits` (057, widened to 102), atomic with the edit (066); durable intent in `data_overrides` (073, to 110) |
| reviewed promotion of a source candidate | `promotion_candidates` + `promotion_decisions` (074) |
| automatic canonical application by a settle | `canonical_applications` (083; `delete` only for proven foreign-collision rows, 107) |
| AFL API player identity adjudication | `afl_api_identity_adjudications` (104, 106) |
| Brownlow authority and vote entry | `brownlow_season_authority`, `brownlow_vote_entry_state` (094), audited in `data_edits` |
| user-submitted CSV correction, promoted by an admin | `data_submissions`, `data_submission_rows` (023) |
| publication of a derived award result (Coleman Medal), by the V2 Coleman publisher (super admin, `data.awards.edit`) | `derived_award_results` (112): append-only, the season seal's audit record in `correction` (workflow `derived_award_publication`), a recompute after a corrected fact is a NEW row whose `supersedes_id` names the old; projecting a published result into `award_winners` leaves a `derived_award_projections` row (114): append-only provenance (keys and actions only) with the same workflow's audit record |
| approval of a curated award proposal into `award_winners`, by `@afldb/admin` `approveProposal` through `insertAwardWinner` (super admin, `data.awards.edit`) | `award_proposal_decisions` (111): append-only ledger row (actor, note, proposal id) written in the same transaction; the season seal's correction names workflow `curated_award_approval`; a sealed season needs a decision note of 20..2000 characters, an open season does not (the Wikipedia 20-character note rule still applies on top); the canonical row also leaves its `data_overrides` and `data_edits` rows |
| an administrator's Brownlow eligibility decision for a player and season (super admin) | `brownlow_eligibility_decisions` (113): the append-only ledger row (verdict, citation, note, actor, `basis`); a sealed season records the season seal's correction (workflow `brownlow_eligibility_decision`) in `correction`, an open season records none; a reversal is a NEW row whose `supersedes_id` names the old; the raw votes in `brownlow_season_votes` are never altered |

Anything else that changes a sealed row (a bulk reload, an ad hoc SQL fix, a restore from the
wrong dump) is a **violation**, even if the new value is right: it must be reconciled (section
5) and re-applied through a workflow above.

Stage 3 enforces the seal at the AFL API settle entry points: the three settle CLIs refuse a
sealed season in every writing mode before opening a database client (except the Brownlow completed-season backtest, which first opens a client to prove the database is `afldb_test`)
(`packages/domain/src/season-seal.ts`, `tools/current-season/settle-season-seal.ts`). No
constraint or trigger stops other writers (V2-GAP-006, narrowed); for them the manifest
comparison remains the control. Settle is never a correction workflow: the refusal points at the
audited workflows in the table above.

## 3. Out of scope, and why

| Excluded | Reason |
|---|---|
| derived tables (`player_club_season_stats`, `player_career_stats`, `player_clubs`, career/derived columns) | rebuilt from the covered facts; each rebuild is recorded in `derived_rebuilds` (007). A derived mismatch is a derivation defect, found by derived-rebuild parity, not a baseline change |
| `staging.*`, the observation spine, typed projections | source observations, not canonical history (074, 076, 077, 103) |
| audit and decision ledgers (`data_edits`, `canonical_applications`, `promotion_*`, `import_batches`, ...) | append-only by design; they are what reconciliation reads |
| auth, beta, site settings, media, NL search logs | operational, production-owned (`docs/production-promotion.md`) |
| AFLW (`staging_aflw.*`, `aflw.*` views) | separate competition and loader (`tools/aflw/`, `docs/aflw.md`); not covered by this manifest: an accepted scope boundary (V2-GAP-005, closed 2026-10-31, D-V2-GAP005 Option A) |
| `fixtures` | the schedule, not results; a sealed season's results are in `matches` |

## 4. Verification

1. Produce a manifest (`docs/v2/historical-manifest-spec.md` §7). Against `afldb_test` with
   `--dsn-env`; against any other database only with `--read-only-source` and
   `--i-understand-this-reads-a-non-test-database` and the owner's authority for that run.
2. Keep manifests outside the repository unless the owner decides otherwise: they hold only
   counts and digests, but they describe a live database.
3. Compare two manifests offline. Exit 0 (`sealed-scope-identical`) proves the sealed scope is
   unchanged as far as the digests observe; exit 1 lists every table-season to reconcile.

Limits, stated plainly: a manifest is evidence about what its SELECTs observed in one snapshot.
It does not cover columns outside `factColumns`, other schemas, sequences or privileges; for
those, `tools/db/catalog-fingerprint.ts` and `tools/db/fingerprint-tier2.ts` exist.

## 5. Reconciliation (documented; not executed)

For each finding of a comparison between manifest A (earlier) and B (later):

1. **Scope the change.** The finding names the table and season. Note A's and B's `producedAt`.
2. **Find the audit rows** in that interval, read-only, by table and season. Examples (run only
   with authority, against the database B describes, with a `LIMIT` while exploring):

   ```sql
   -- data editor
   SELECT id, table_name, row_id, field_group, created_at FROM data_edits
    WHERE table_name = 'matches' AND created_at BETWEEN '<A>' AND '<B>' ORDER BY id LIMIT 200;
   -- automatic settle applications
   SELECT id, target_table, target_key, verb, import_batch_id, applied_at FROM canonical_applications
    WHERE target_table = 'player_match_stats' AND applied_at BETWEEN '<A>' AND '<B>' ORDER BY id LIMIT 200;
   -- reviewed promotions
   SELECT d.id, c.target_table, c.season, c.verb, d.decision, d.decided_at
     FROM promotion_decisions d JOIN promotion_candidates c ON c.id = d.candidate_id
    WHERE c.season = 2025 AND d.decided_at BETWEEN '<A>' AND '<B>' ORDER BY d.id LIMIT 200;
   -- identity adjudications
   SELECT id, action, player_id, created_at FROM afl_api_identity_adjudications
    WHERE created_at BETWEEN '<A>' AND '<B>' ORDER BY id LIMIT 200;
   ```

3. **Classify** each finding as *explained* (every changed row is covered by an audit row from
   section 2) or *unexplained*.
4. **Explained**: record it (V2: `docs/v2/known-gaps.md` or the run's evidence file; after
   adoption: the issue ledger) and accept B as the new reference manifest.
5. **Unexplained**: treat it as a data-integrity incident. Do not "fix forward" by hand. Recover
   the prior values from the newest backup whose manifest matches A for that bucket (section
   6), and re-apply them through an audited workflow so the correction is itself recorded.
6. **Metadata-only** (`METADATA_CHANGED`): facts are identical; confirm the re-stamp came from a
   recorded import batch (`import_batches`) and accept.
7. **Unverified** (`FACT_COLUMNS_CHANGED` after an additive migration): re-produce B with
   `--pin-columns A` and compare again.

## 6. Restoration (documented; not executed)

V2 adds no new restore mechanism. The existing, proven paths stay authoritative:

- **Backup and verified restore**: `docs/backup-restore.md` (`pg_dump`, restore into
  `afldb_restore_test`, never over the source, nine parity checks).
- **Replacing a database with a rebuilt one** is a promotion, not a restore:
  `docs/production-promotion.md` (candidate database, production-owned state reinstated from the
  pre-cutover backup, read-only checker, rename swap, rename-back rollback).

V2's addition is a **manifest gate** on both: produce a manifest of the restored or candidate
database and compare it with the manifest of the state it is meant to reproduce. Every sealed
bucket must be identical; any other finding is reconciled (section 5) before the restored copy
is trusted. For a single-bucket recovery, restore the backup into a scratch database, verify its
manifest bucket against A, and copy the needed rows back through an audited workflow — never by
replacing tables in a live database.

Backup and rollback plans for the eventual V2 cutover are Stage 6 deliverables (plan R-006).
