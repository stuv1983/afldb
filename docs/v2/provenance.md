# AFLDB V2 — provenance model

Status: Stage 2 (2026-10-19). Describes the provenance model as the migrations define it. Every
claim cites the migration (`src/db/migrations/NNN_*.sql`) or source file that establishes it. V2
adds nothing to the schema in Stage 2; the gaps it identifies are listed in section 7.

## 1. Vocabulary

| Term | Meaning | Defined in |
|---|---|---|
| source | a registered dataset AFLDB ingests (`sources.key`, `kind` in `upstream_dataset`, `scrape`, `manual`, `derived`) | `001_foundations.sql` (`sources`), rows from `data/reference/sources.json` |
| import batch | one run of one tool against one source; counts read/inserted/updated/rejected, `validation_result` jsonb, `status` (`running`, `completed`, `failed`, `rolled_back`) | `001_foundations.sql` (`import_batches`, `import_status`) |
| rejection | a row an import refused; never silently dropped. `records_rejected` must equal the batch's `import_rejections` count | `001_foundations.sql` (`import_rejections`, table comment) |
| data issue | an open data-quality finding, including unresolved source disagreement ("flagged here, never silently resolved") | `001_foundations.sql` (`data_issues`); `issue_key` added in `076_afltables_settle_projections.sql:423` |
| provenance quartet | `source_id`, `source_record_id`, `import_batch_id`, `imported_at` on a fact row | `001_foundations.sql` (`add_provenance_columns`) |

## 2. Fact-row provenance

Most canonical fact tables carry the quartet, either declared inline or added by
`add_provenance_columns(regclass)`:

- inline `source_id`/`import_batch_id` (and usually `source_record_id`): `player_match_stats`
  (004), `brownlow_season_votes`, `award_winners`, `award_nominations`, `captaincies`,
  `hall_of_fame`, `honour_team_members` (005), `club_seasons`, `draft_picks`,
  `father_son_selections`, `player_relationships` (006), `player_match_period_stats` (062),
  `coaches`, `match_coaches` (087), `season_list_members` (096), `fixtures` (097),
  `club_leadership` (098);
- added by the function: `player_achievements` (053:107), `matches` (064:10),
  `match_period_scores` and `brownlow_round_votes` (083:45-46, which closed the ownership gap
  that made the settle fail closed on those two targets), `after_siren_kicks` (089:136).

`player_match_stats` received `source_record_id` in 083 (its header, item 1).

## 3. The observation spine (what a source said, and when)

Migration 074 separates three grains so that idempotent polling and true correction history can
both hold:

| Table | Grain | Key facts |
|---|---|---|
| `staging.source_payloads` | immutable content, deduplicated by `payload_hash` | `hash_recipe` stored, so a hash-exclusion change is recomputable without a migration |
| `staging.source_record_versions` | ordered state per external record (`version_seq`) | `observed_from`/`observed_to`, `opened_by_batch_id`/`closed_by_batch_id`; A -> B -> A stays three versions |
| `staging.source_records` | current state per external record | `current_version_seq`, `current_payload_hash`, `last_batch_id`, `absent_since` |

Nothing in 074 writes canonical data: no trigger, rule or default touches a canonical table.

Typed projections feed promotion; "the jsonb spine never feeds a promotion" (Decision B, quoted in
103's header): `staging.afltables_match`, `staging.afltables_player_match` (076),
`staging.afl_api_lineup` (077), `staging.afl_api_match`, `staging.afl_api_player_match`,
`staging.afl_api_brownlow_vote` (103). `staging.external_current_matches` (063) holds the
Squiggle/Kali current-season observations.

On disk, AFL API acquisitions are immutable snapshot directories under
`data/sources/afl_api/<kind>/<label>/` claimed with a non-recursive `mkdir` so a collision can
never overwrite one (`src/lib/acquisition/snapshot-dir.ts`), verified by a sha256 manifest before
any use (`src/lib/acquisition/afl-api-snapshot.ts`, fail closed).

Acquisition metadata in the manifest (Stage 3 additions marked *): per raw file `sha256`,
`http_status`, `etag`, `cache_control`, `retrieved_at` and *`request` (`method`, `url`; the
token travels in a header and is never recorded); per manifest `contract_version`, `source_key`,
`acquisition_kind`, `label`, `season`, the season provider ids, `acquired_at` (completion
time), *`acquisition_tool`, *`acquisition_started_at` and *`request_parameters`
(`tools/current-season/acquire-afl-api.ts`, `acquire-afl-api-brownlow.ts`). A stored snapshot
replays to an identical settle plan (`replayAflApiSnapshot` in `@afldb/acquisition`,
`tests/v2-acquisition-replay.test.ts`); a settle can be summarised as a machine-readable
reconciliation report (`afldb.v2.afl-api-reconciliation-report`, `@afldb/acquisition`).

## 4. Promotion and canonical-mutation audit

| Table | Records | Defined in |
|---|---|---|
| `promotion_candidates` | a proposed canonical change from a source version (`verb`, `season`, `target_table`, `proposed_fields`, agreeing/disagreeing independence groups, `created_by_batch_id`) | 074 |
| `promotion_decisions` | the reviewed super-admin decision on a candidate, with `previous_values`/`new_values`, `admin_user_id`, note | 074 |
| `canonical_applications` | every automatic canonical mutation: `import_batch_id`, source, `family`, `external_record_id`, `source_version_seq`, `target_table`, `target_key`, `verb`, `previous_values`/`new_values`, `applied_at`; append-only, source-version bound | 083; `delete` verb added by 107 for proven foreign-collision rows only |
| `afl_api_identity_adjudications` | an admin's AFL API player identity decision (`action`, `player_id`, `previous_state`, `evidence`, `supersedes_id`) | 104; `corrected` action 106 |
| `brownlow_season_authority`, `brownlow_vote_entry_state` | which source is authoritative for a season's Brownlow totals, and the vote-entry workflow state | 094 |

## 5. Human edits

| Table | Records | Defined in |
|---|---|---|
| `data_edits` | append-only audit of every saved manual edit, old and new values, admin, note. Allowlisted entities (latest list, 102:297-310): `players`, `matches`, `draft_picks`, `award_winners`, `hall_of_fame`, `honour_team_members`, `brownlow_vote_entry_state`, `brownlow_season_authority`, `coaches`, `fixtures`, `club_leadership`, `player_achievements`, `after_siren_kicks`. Written in the same transaction as the mutation (066, AFLDB-ISSUE-027) | 057, 058, widened by 094-102 |
| `data_overrides` | the active state of a durable human override, bound to the entity's natural key (`entity_key`), replayed by destructive reloads; `is_active = false` withdraws it. Entities (110:46-60): `players`, `matches`, `draft_picks`, `coaches`, `match_coaches`, `season_list_members`, `fixtures`, `club_leadership`, `award_winners`, `hall_of_fame`, `honour_team_members`, `player_achievements`, `after_siren_kicks`, `player_match_stats` | 073, widened to 110 |
| `data_submissions`, `data_submission_rows` | user-submitted CSV corrections and their promotion state | 023 |
| `player_link_resolutions` and related link tables | admin player-link decisions | 056 and later |

`match_period_scores` and `brownlow_round_votes` are deliberately unrepresentable in
`data_overrides`; `src/lib/acquisition/manual-authority.ts` reads the constraint and refuses to
apply either target if one ever appears (110's constraint comment).

## 6. Derived data

`derived_rebuilds` (007) records every rebuild of a derived table (`target`, `scope`, `status`,
`row_count`), so a stale summary can be traced to its rebuild. Derived tables
(`player_club_season_stats`, renamed from `player_season_stats` in 015; `player_career_stats`;
`player_clubs`) are recomputed from canonical facts and are not part of the sealed baseline
(`docs/v2/historical-baseline.md` §3).

## 7. Gaps V2 records (not fixed in Stage 2)

- Not every table carries the quartet: `seasons`, `clubs`, `venues`, `players` and the alias
  tables record their reference-data source through `data/reference/*.json` loads and
  `external_identities` rather than per-row provenance. V2 does not add columns to them in Stage
  2; Stage 3/4 decide whether the AFL API path needs per-row provenance there (plan D4: additive
  only, from `111_`).
- The seal is enforced only at the AFL API settle CLIs (Stage 3); no constraint or trigger stops
  another writer from changing a
  sealed season's rows. See V2-GAP-006 in `docs/v2/known-gaps.md`.
