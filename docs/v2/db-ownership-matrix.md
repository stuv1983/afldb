# AFLDB V2 — database compatibility and ownership matrix (DRAFT)

Status: **draft**, Stage 2 (2026-10-19); completed in Stage 4 (plan §7 R-006). Records, for every
table and view the migrations create (001-110), which V2 component is to own its writes and how
the schema stays compatible. The "V2 owner" column is a design assignment under plan D1, not an
observed fact. The "write role" column states only what migrations establish; per-call-site
writers are re-derived in Stage 4 from `docs/v2/inventory.md` and the code.

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
| Promotion decisions and identity | `promotion_decisions`, `afl_api_identity_adjudications` | `@afldb/admin` | human decisions; 074, 104, 106 |
| Canonical match facts | `matches`, `match_period_scores`, `player_match_stats`, `player_match_period_stats` | `@afldb/acquisition` (promotion) for open seasons; `@afldb/admin` (audited correction) for sealed ones | sealed baseline; `docs/v2/historical-baseline.md` |
| Brownlow | `brownlow_round_votes`, `brownlow_season_votes`, `brownlow_season_authority`, `brownlow_vote_entry_state` | `@afldb/acquisition` (round votes from the AFL API); `@afldb/derived` (season reconciliation, plan D7); `@afldb/admin` (authority, vote entry) | totals stay with their authoritative source |
| Awards and honours | `awards`, `award_winners`, `award_nominations`, `hall_of_fame`, `honour_team_members` | `@afldb/admin` (curated, plan D8); `@afldb/derived` for derived awards (Coleman, plan D6) | 101 lifecycle |
| Club and season context | `seasons`, `clubs`, `club_aliases`, `club_organizations`, `club_organization_relations`, `club_seasons`, `venues`, `venue_aliases` | `@afldb/db` (reference data) | loaded from `data/reference/*.json` |
| People and identity | `players`, `player_name_aliases`, `external_identities`, `player_birth_evidence`, `player_height_evidence`, `draft_persons`, `player_relationships` | `@afldb/admin` (identity decisions); `@afldb/acquisition` (AFL API identities only) | never a placeholder player (owner rule) |
| Player links | `player_link_suggestions`, `player_link_resolutions`, `player_link_match_candidates` | `@afldb/admin` | 056, 067 |
| Lists, drafts, leadership, coaching | `draft_picks`, `father_son_selections`, `season_list_members`, `captaincies`, `club_leadership`, `coaches`, `match_coaches` | `@afldb/admin` (curated) | historical rows from offline loaders (legacy) |
| Special records | `player_achievements`, `after_siren_kicks` | `@afldb/admin` | 053, 089, 102 |
| Fixtures | `fixtures` | `@afldb/acquisition` (AFL API fixture); `@afldb/admin` (corrections) | 097 |
| Admin audit and overrides | `data_edits`, `data_overrides`, `data_submissions`, `data_submission_rows` | `@afldb/admin` | 057, 073, 023 |
| Derived | `player_club_season_stats`, `player_career_stats`, `player_clubs`, `derived_rebuilds`, `stat_availability`, `stat_definitions` | `@afldb/derived` (`stat_*` reference: `@afldb/db`) | 007, 015 |
| External grids | `external_grids`, `external_grid_axes`, `external_grid_sources` | apps/web (Grid Solver) | 080 |
| Auth and site | `auth_users`, `auth_sessions`, `auth_audit_log`, `beta_access_codes`, `beta_allowed_emails`, `beta_login_tokens`, `beta_join_requests`, `admin_invites`, `site_settings`, `site_media`, `app_health_events` | apps/web (`afldb_auth`) | production-owned |
| NL search telemetry | `nl_search_log`, `nl_search_feedback`, `nl_search_review` | apps/web | operational |
| Privilege registries | `afldb_meta.app_readable_tables`, `afldb_meta.import_writable_tables` | `@afldb/db` (migrations only) | 039, 045; never written by hand |
| AFLW | `staging_aflw.*` (8 tables), `aflw.*` (12 views) | unchanged, outside V2 scope | `tools/aflw/`, `docs/aflw.md`; V2-GAP-005 |

## Open for Stage 4

- Re-derive every current writer per table from the code (call sites, roles, tools) and mark any
  table with more than one writer.
- Decide the owner of `external_identities` rows that historical loaders and the AFL API both
  write.
- Confirm no table above is written by a legacy runtime path after the Stage 4 disposition.
