-- AFLDB-ISSUE-222 §7.4 -- read-only row-image snapshot for the S0/S1/S2/S3 rollback exercise.
--
-- Six `\copy` statements, one per row set §7.4 (AFLDB-ISSUE-222.md line 879-885) names for
-- comparison: draft_persons/draft_picks link columns for the DraftGuru source, every manual
-- (source_id IS NULL) pick in full, external_identities(draftguru) link columns, and
-- player_link_resolutions/data_overrides for draft_picks in full. Every SELECT is ordered by a
-- natural key so two snapshots of the identical database state produce byte-identical CSVs.
--
-- Usage: run from inside a fresh, per-stage directory (S0/S1/S2/S3) so each stage's six files
-- never overwrite another stage's:
--
--   $env:PGOPTIONS = '-c default_transaction_read_only=on'
--   & "C:\Program Files\PostgreSQL\16\bin\psql.exe" -X -v ON_ERROR_STOP=1 \
--     -f ..\s74-snapshot.sql -d $env:AFLDB_TEST_DATABASE_URL
--
-- Writes only the six CSV files named below, in the current working directory. Issues no write
-- to the database; every statement is a SELECT via \copy ... TO. Never run with --bridge, never
-- run against a target other than afldb_test (bridge_import_gate.py's own --target dev remains
-- the read-only gate for afldb_dev; this script is the afldb_test §7.4 exercise only).

\pset format unaligned
\pset fieldsep ','
\pset null ''

\copy (SELECT player_url, player_id, link_status, match_method, confidence_notes, is_matching_backlog FROM draft_persons WHERE source_id = (SELECT id FROM sources WHERE key = 'draftguru') ORDER BY player_url) TO 'persons.csv' CSV HEADER

\copy (SELECT player_url, draft_year, draft_kind, player_id, link_status_value, match_method FROM draft_picks WHERE source_id = (SELECT id FROM sources WHERE key = 'draftguru') ORDER BY player_url, draft_year, draft_kind) TO 'picks_dg.csv' CSV HEADER

\copy (SELECT id, draft_year, draft_type, draft_kind, pick_number, pick_note, player_id, player_name_raw, link_status_value, candidate_count, match_method, confidence_notes, club_id, club_name_raw, original_club_raw, draft_age, height_cm, weight_kg, grade, competition, signing, signing_kind, signing_detail, detail, source_id, source_record_id, import_batch_id, draft_person_id, dg_person_id, player_url, reported_games, reported_goals FROM draft_picks WHERE source_id IS NULL ORDER BY id) TO 'picks_manual_null.csv' CSV HEADER

\copy (SELECT external_id, player_id, status, match_method FROM external_identities WHERE source_id = (SELECT id FROM sources WHERE key = 'draftguru') ORDER BY external_id) TO 'identities.csv' CSV HEADER

\copy (SELECT id, target_id, action, player_id, previous_status, admin_user_id, note, created_at FROM player_link_resolutions WHERE target_table = 'draft_picks' ORDER BY id) TO 'resolutions.csv' CSV HEADER

\copy (SELECT id, entity_key, field_group, override_values, is_active FROM data_overrides WHERE entity_type = 'draft_picks' ORDER BY id) TO 'overrides.csv' CSV HEADER
