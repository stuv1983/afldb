# AFLDB V2 — database compatibility and ownership matrix

Status: drafted in Stage 2, **completed in Stage 4** (2026-10-19, plan §7 R-006); writers updated
for Stage 5 (the retired admin paths and the operations-centre callers); Stage 6 adds no writer
(its shadow capture tools only read, inside a rolled-back read-only transaction, and only a database
named `afldb_v2_shadow[_<tag>]_test`). Records, for
every table and view the migrations create (001-112), which V2 component is to own its writes and
how the schema stays compatible. The "V2 owner" column is a design assignment under plan D1, not
an observed fact. The observed writers per table are the Stage 4 census below (static reading of
the code; nothing was executed against a database).

## Rules

- **Compatibility.** No table is dropped, renamed or reshaped by V2 (plan D4: additive
  migrations from `111_`, each with a documented reversal). The public site (`apps/web`) keeps
  reading the same tables and views through `afldb_app`; where V2 changes a shape, it adds a
  compatibility view rather than altering the table.
- **One write owner per table.** Other components may read; a second writer must go through the
  owner's package API. Admin corrections are the one sanctioned cross-cutting writer, and they
  always write their audit row in the same transaction (066).
- **Write roles (established by migrations).** `afldb_auth` writes the operational tables
  excluded from the import registry (045: `auth_users`, `auth_sessions`, `auth_audit_log`,
  `beta_access_codes`, `beta_allowed_emails`, `beta_login_tokens`, `beta_join_requests`,
  `data_submissions`, `data_submission_rows`, `admin_invites`, `site_media`, `site_settings`).
  `afldb_import` may write a public table only once it is registered import-writable (045, then
  `afldb_meta.grant_import_write()` per later migration). `afldb_app` reads only what is
  registered app-readable (039).

## Matrix

| Group | Tables | V2 owner (proposed) | Notes |
|---|---|---|---|
| Source registry and batches | `sources`, `import_batches`, `import_rejections`, `data_issues` | `@afldb/acquisition` (batches it opens); `@afldb/db` (registry) | historical loaders also open batches (legacy, offline) |
| Observation spine | `staging.source_payloads`, `staging.source_record_versions`, `staging.source_records` | `@afldb/acquisition` | 074; no canonical writes |
| AFL API projections | `staging.afl_api_match`, `staging.afl_api_player_match`, `staging.afl_api_brownlow_vote`, `staging.afl_api_lineup` | `@afldb/acquisition` | 103, 077 |
| Legacy source projections | `staging.afltables_match`, `staging.afltables_player_match`, `staging.external_current_matches`, `staging.team_seasons` | legacy (Stage 4 disposition) | AFL Tables settle, Squiggle/Kali, historical staging |
| Promotion | `promotion_candidates`, `canonical_applications` | `@afldb/acquisition` | 074, 083, 107 |
| Promotion decisions and identity | `promotion_decisions`, `afl_api_identity_adjudications` | `@afldb/admin` | human decisions; 074, 104, 106. `promotion_decisions` has no writer outside migrations today (census; grant only, `tools/maintenance/privileges.sql:502`) |
| Canonical match facts | `matches`, `match_period_scores`, `player_match_stats`, `player_match_period_stats` | `@afldb/acquisition` (promotion) for open seasons; `@afldb/admin` (audited correction) for sealed ones | sealed baseline; `docs/v2/historical-baseline.md`. Also written today by the AFL Tables settle (V2-GAP-011); the legacy CSV promotion's admin path refuses since Stage 5. `player_match_period_stats` has no writer outside migrations (census) |
| Brownlow | `brownlow_round_votes`, `brownlow_season_votes`, `brownlow_season_authority`, `brownlow_vote_entry_state` | `@afldb/acquisition` (round votes from the AFL API); `@afldb/derived` (season reconciliation, plan D7); `@afldb/admin` (authority, vote entry) | totals stay with their authoritative source |
| Awards and honours | `awards`, `award_winners`, `award_nominations`, `hall_of_fame`, `honour_team_members` | `@afldb/admin` (curated, plan D8); `@afldb/derived` for derived awards (Coleman, plan D6) | 101 lifecycle. Coleman `award_winners` rows are written by the offline `import_awards.py` coleman group AND (Launch F, ADR 0015) by the publisher's projection port `src/db/queries/coleman-award-winners.ts` with the loader's own key and tuple (source `afltables`, `coleman:<season>:<profile path>`), so both writers converge (loader parity run: 0 inserted, 0 deleted, values unchanged); curated approvals write through `insertAwardWinner` and approved revisions through `replaceAwardWinnerInTx`/`correctAwardWinnerInTx` (ADR 0008) |
| Curated award workflow | `award_proposals`, `award_proposal_decisions` | `@afldb/admin` (`createProposal` ... `approveProposal`; ADR 0008) | 111 (Stage 4). Writer `afldb_import`: INSERT, UPDATE on workflow columns only; the decisions ledger is append-only for every role; `afldb_auth` SELECT; no `afldb_app`. Natural-identity keyed (no FK into football tables). `approveProposal` consults the season seal (workflow `curated_award_approval`) before promoting into `award_winners`. Runtime caller (Stage 5): `src/lib/admin/operations-centre.ts` via `/admin/operations/awards`. Promotion: `reinstate`, production-only. Unexecuted on PostgreSQL |
| Derived award results | `derived_award_results` | `@afldb/derived` (`publishColemanResult`; ADR 0006) | 112 (Stage 4). Append-only for every role; supersession by `supersedes_id`; writer `afldb_import` (one transaction, `data.awards.edit` plus a `derived_award_publication` audited correction through the season seal); `afldb_auth` SELECT; no `afldb_app`. Promotion: `reinstate`, production-only; ids in the `result` jsonb are a snapshot, the durable identity is `winners[].key`. Launch F: the same transaction projects the result into `award_winners` through the injected port (ADR 0015). Runtime caller (Stage 5): `publishColemanSeason` via `/admin/operations/coleman`. Executed on isolated PostgreSQL 16 in Launch F (synthetic seeds); not on a historical database |
| Derived award projections | `derived_award_projections` | `@afldb/derived` (`publishColemanResult` with the projection port; ADR 0015) | 114 section 1 (Launch F). Append-only provenance of each projection of a `derived_award_results` row into `award_winners` (keys and actions only, never a winner store); composite FK to `derived_award_results`; writer `afldb_import` SELECT, INSERT; `afldb_auth` SELECT; no `afldb_app`. Promotion: `reinstate`, production-only |
| Brownlow eligibility decisions | `brownlow_eligibility_decisions` | `src/db/queries/brownlow-eligibility.ts` (`recordBrownlowEligibilityDecision`; ADR 0014), determination in `@afldb/derived` (`determineBrownlowMedal`) | 113 (Launch F). Append-only administrator eligibility evidence keyed by durable player identity, superseding chain, required citation and 20-2000 note; sealed seasons carry a `brownlow_eligibility_decision` audited correction; writer `afldb_import` SELECT, INSERT (capability `data.brownlow.finalise`); `afldb_auth` SELECT; no `afldb_app`. Never writes `brownlow_season_votes`. Promotion: `reinstate`, production-only |
| Brownlow correction receipts | `brownlow_correction_receipts` | `src/db/queries/brownlow-production-correction.ts` (guarded owner-operated correction runner) | 116. Append-only owner audit ledger keyed by `plan_digest` (plan digest, operation, code revision, approval reference, before/after digests, result); a statement trigger (`brownlow_receipt_immutable`) refuses UPDATE, DELETE and TRUNCATE for every role, even on an empty table; owner-operated, no `afldb_app`/`afldb_import`/`afldb_auth` grant; no foreign key. Promotion (AFLDB-ISSUE-322): `reinstate` / `operations` / production-only / compare `equal` / order 20, and the one reinstated table excluded from the promotion TRUNCATE (`EMPTY_ASSERTED_TABLES`): the promotion transaction locks it and refuses unless the candidate copy is already empty, then the production rows are restored data-only under the live trigger. The trigger is never bypassed, disabled or altered; receipts are never overwritten, recreated or fabricated. Stays in the freeze set (F0, 43 tables) |
| Club and season context | `seasons`, `clubs`, `club_aliases`, `club_organizations`, `club_organization_relations`, `club_seasons`, `venues`, `venue_aliases` | `@afldb/db` (reference data) | loaded from `data/reference/*.json` |
| People and identity | `players`, `player_name_aliases`, `external_identities`, `player_birth_evidence`, `player_height_evidence`, `draft_persons`, `player_relationships` | `@afldb/admin` (identity decisions); `@afldb/acquisition` (AFL API identities only) | never a placeholder player (owner rule) |
| Player links | `player_link_suggestions`, `player_link_resolutions`, `player_link_match_candidates` | `@afldb/admin` | 056, 067 |
| Lists, drafts, leadership, coaching | `draft_picks`, `father_son_selections`, `season_list_members`, `captaincies`, `club_leadership`, `coaches`, `match_coaches` | `@afldb/admin` (curated) | historical rows from offline loaders (legacy) |
| Special records | `player_achievements`, `after_siren_kicks` | `@afldb/admin` | 053, 089, 102 |
| Fixtures | `fixtures` | `@afldb/acquisition` (AFL API fixture, **not built**: V2-GAP-008); `@afldb/admin` (corrections) | 097; the only writers today are the admin fixture editor and offline loaders; the V2 fixture contract (`packages/acquisition/src/fixture-contract.ts`) refuses but writes nothing |
| Admin audit and overrides | `data_edits`, `data_overrides`, `data_submissions`, `data_submission_rows` | `@afldb/admin` | 057, 073, 023 |
| Derived | `player_club_season_stats`, `player_career_stats`, `player_clubs`, `derived_rebuilds`, `stat_availability`, `stat_definitions` | `@afldb/derived` (`stat_*` reference: `@afldb/db`) | 007, 015 |
| External grids | `external_grids`, `external_grid_axes`, `external_grid_sources` | apps/web (Grid Solver) | 080. Rows are loaded by the offline `tools/migration/import_external_grids.py`; `external_grid_sources` has no writer outside migrations (census) |
| Auth and site | `auth_users`, `auth_sessions`, `auth_audit_log`, `beta_access_codes`, `beta_allowed_emails`, `beta_login_tokens`, `beta_join_requests`, `admin_invites`, `site_settings`, `site_media`, `app_health_events` | apps/web (`afldb_auth`) | production-owned |
| NL search telemetry | `nl_search_log`, `nl_search_feedback`, `nl_search_review` | apps/web | operational |
| Privilege registries | `afldb_meta.app_readable_tables`, `afldb_meta.import_writable_tables` | `@afldb/db` (migrations and the privileges reconcile) | 039, 045. Written by migrations and by the reconcile script `tools/maintenance/privileges.sql` (:104, :117 delete stale registry rows), never by application code |
| AFLW | `staging_aflw.*` (8 tables), `aflw.*` (12 views) | unchanged, outside V2 scope | `tools/aflw/`, `docs/aflw.md`; V2-GAP-005 |

## Acquisition-owned tables as implemented (Stage 3)

Re-derived from the code in Stage 3 (`.phaneslight/returns/launchB-20261019/04-mechanic-settle-promotion.md`,
re-verified for the cited lines). Every AFL API write happens inside a settle transaction opened by
one of three entry points; each opens with an `import_batches` row.

| Entry point (CLI → library) | Tables written | Season gate |
|---|---|---|
| `tools/current-season/settle-afl-api.ts` → `runSettleAflApi` (`src/lib/acquisition/settle-afl-api.ts`) | `import_batches`, `staging.source_payloads/_record_versions/_records`, `staging.afl_api_match`, `staging.afl_api_player_match`, `promotion_candidates`, `import_rejections`, `data_issues`; with `--auto-apply`: `matches`, `match_period_scores`, `player_match_stats`, `canonical_applications` (via `applyCanonicalUnit`) and the attendance enrichment; derived recompute (`runDerivedRecomputeWithDeadlockRetry`) | sealed season refused by the CLI before any client (Stage 3); canonical targets also need `season_not_in_progress` to pass (`canonical-apply.ts`) |
| `tools/current-season/settle-afl-api-fixtures.ts` → `persistAflApiFixtureObservations` | `import_batches`, observation spine only | sealed season refused by the CLI (Stage 3) |
| `tools/current-season/settle-afl-api-brownlow.ts` → `runSettleAflApiBrownlow` (`afl-api-brownlow.ts`) | `import_batches`, observation spine, `staging.afl_api_brownlow_vote`, `brownlow_round_votes` + `canonical_applications` (via `applyCanonicalUnit`), Brownlow coverage recompute | sealed season refused by the CLI unless the live `afldb_test` backtest proof passes (Stage 3); canonical gate as above |

The acquire tools (`tools/current-season/acquire-afl-api*.ts`) write snapshot files only and
import no writer module (`tests/v2-acquisition-pipeline.test.ts`). Identity rows in
`external_identities` for `afl_api` are written only by the bridge importer, the admin
adjudication path and the audited correction/replay CLIs (`tools/migration/`), never by a settle.

## Stage 4 writer census

Static reading of `src/`, `packages/` and `tools/` (tests, docs and migrations excluded), by
`afldb-mechanic` M2 and spot-checked by the orchestrator (`.phaneslight/returns/launchC-20261019/03-mechanic-M2-table-writers.md`,
git-ignored working memory). Writer classes: runtime web, runtime admin, AFL API worker, legacy
runtime, shared settle library, offline tool, test rehearsal.

- 86 tables have at least one writer file; 66 of them have more than one. The multiplicity is
  expected: offline historical loaders and test rehearsals write most tables alongside one runtime
  owner. The tables with more than one **runtime** writer class are `matches`,
  `player_match_stats`, `players`, `award_winners`, `award_nominations` (admin, AFL API or shared
  settle library, and the legacy CSV promotion), `import_batches`, `import_rejections` (worker and
  legacy), and `data_overrides`, `seasons`, `club_seasons`, `player_career_stats`,
  `player_club_season_stats`, `player_clubs` (admin and the shared derived recompute reached by
  both settles, `settle-afltables.ts:1924-1928`, `match-rekey.ts:388-431`).
- No writer outside migrations: `promotion_decisions`, `player_match_period_stats`,
  `external_grid_sources`.
- Writers with no scheduler or package-script reference: `tools/current-season/repair-match-rekeys.ts`
  (writes `matches`, `canonical_applications`, `import_batches`; manual repair tool, offline
  class). `tools/current-season/afl-api-c4b-rehearsal.ts` writes `site_settings` and
  `auth_audit_log`; it is the frozen ISSUE-316 C4b tool, which V2 never runs.
- `src/db/queries/awards-admin.ts` writers are reached by tests (`tests/awards-admin.test.ts:23`,
  `tests/integration/awards-reload-links.test.ts:12`), not by runtime code.

### Decision: `external_identities` ownership (Stage 4)

`UNIQUE (source_id, external_id)` (002:189) already makes each key single-row. Ownership is
assigned **per source partition**, one owner each:

| Partition (`sources.key`) | Owner | Writers allowed |
|---|---|---|
| `afl_api` | `@afldb/admin` (identity adjudication, migration 104) | admin link/revoke (`src/db/queries/afl-api-player-links.ts:784`, `:918`); offline bridge, correction and replay tools (`tools/migration/import_afl_api_player_bridge.ts`, `correct_afl_api_identity.ts`, `replay_afl_api_adjudications.ts`). Never a settle |
| `afltables` (`afltables_profile_url`) | offline historical loaders (`import_fitzroy_core.py:2813-2818`, `enrich_birth_dates.py:558-566`) | plus the audited admin attach (`src/db/queries/admin-draft.ts:1544`), restored after a reload by the replay (`tools/migration/common.py:1705`) |
| `draftguru` | offline `tools/rebuild/draftguru/import_draftguru.py` | that loader only |
| `manual_admin_edit` | `@afldb/admin` | admin create/adopt (`players.ts:415`, `admin-draft.ts:1358`), replayed by `common.py:1689` |

The AFL API never writes the `afltables` partition and the historical loaders never write the
`afl_api` partition. The one overlap is the `afltables` partition, shared by the loaders'
DELETE-then-INSERT and the admin attach; restoration of admin rows rests on the replay ordering,
which is a static reading only (census F-010, LOW).

### Legacy runtime writers after the Stage 4 disposition

The open question "no table is written by a legacy runtime path after the disposition" is answered
**not yet**. The AFL Tables settle and trigger (V2-GAP-011), the CSV upload, submission promotion
and email intake, and the Squiggle/Kali admin refresh (V2-GAP-013) still write; the list of
tables is `docs/v2/legacy-disposition.md` §5. These writes end when Stage 5 removes the admin
paths and the ISSUE-316 cutover retires the AFL Tables settle.

### Writers after Stage 5

- **Removed from runtime:** the CSV upload and submission promotion (`data_submissions`,
  `data_submission_rows`, `import_batches`, and on promotion `matches`, `player_match_stats`,
  `players`, `award_winners`, `award_nominations`), the email-intake route (staging into the same
  submission tables), and the Squiggle/Kali admin refresh (`staging.external_current_matches`,
  `import_batches`, the observation spine). Their actions and routes refuse
  (`docs/v2/legacy-disposition.md` L1-L3, L6). The offline first-kick-goal import still uses
  `datasets.ts`.
- **Added:** the operations-centre callers (`src/lib/admin/operations-centre.ts`) write
  `award_proposals` and `award_proposal_decisions`, and on approval `award_winners`,
  `data_overrides` and `data_edits` through `insertAwardWinner`, all on the `afldb_import`
  connection; `derived_award_results` through `publishColemanResult`; and `auth_audit_log` (the
  activity trail, auth pool). No new table and no new grant.
- **Still a legacy runtime writer:** the AFL Tables settle (L4) until the ISSUE-316 cutover.

### Writers added in Launch F (stream F-D)

- `publishColemanSeason` now also writes `award_winners` (Coleman rows only, loader key and tuple), `data_edits`,
  `awards.first_season`/`last_season` (span recompute) and `derived_award_projections`, in the publisher's transaction.
- `recordBrownlowEligibilityForAdmin` writes `brownlow_eligibility_decisions` only (never `brownlow_season_votes`).
- `reviseApprovedCurated` writes `award_proposals`, `award_proposal_decisions` and, through the extracted
  replace/correct functions, `award_winners`, `data_overrides` and `data_edits`.
- New tables 113/114 and their grants: apply the migrations, then `npm run db:privileges`, then deploy code.

