-- AFLDB-ISSUE-126 T6 — write the explicit cutover/recovery marker into auth_audit_log. Run LAST.
--
--   rehearsal:  psql "$PROD_OWNER_DSN" -f issues/open/AFLDB-ISSUE-126-t6-marker.sql
--   real run:   psql "$PROD_OWNER_DSN" -v commit=1 -f issues/open/AFLDB-ISSUE-126-t6-marker.sql
-- The detail is computed from the live state so it records what was actually restored (and
-- reads as a gap record for anything that was refused). Refuses if a marker already exists.
\set ON_ERROR_STOP on
\if :{?commit}
\else
  \set commit 0
\endif
SELECT current_database() = 'afldb_prod'                                          AS ok_db,
       current_setting('default_transaction_read_only') = 'off'                   AS ok_rw,
       EXISTS (SELECT 1 FROM pg_database WHERE datname = 'afldb_prod_auth_recovery') AS ok_recovery
\gset
\if :ok_db
\else
  \echo 'REFUSED: this script runs against afldb_prod only'
  \quit
\endif
\if :ok_rw
\else
  \echo 'REFUSED: session is read-only (unset PGOPTIONS)'
  \quit
\endif
\if :ok_recovery
\else
  \echo 'REFUSED: afldb_prod_auth_recovery must still exist'
  \quit
\endif

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth_audit_log WHERE action = 'database.recovered') THEN
    RAISE EXCEPTION 'REFUSED: a database.recovered marker already exists';
  END IF;
END $$;

INSERT INTO auth_audit_log (actor_user_id, actor_label, action, detail)
SELECT NULL,
       'operator: cutover recovery (AFLDB-ISSUE-126)',
       'database.recovered',
       jsonb_build_object(
         'issue', 'AFLDB-ISSUE-126',
         'cutover', '2026-09-02 ~20:04 AEST: afldb_prod recreated from the rebuilt afldb_test dump (AFLDB-ISSUE-122 S8); production-only tables were replaced',
         'source', 'afldb_prod_auth_recovery (restored from /home/arm/afldb_prod_pre_rebuild_20260902-200355.dump)',
         'auth_audit_log', jsonb_build_object(
           'restored_rows', (SELECT count(*) FROM auth_audit_log WHERE id BETWEEN 90 AND 181),
           'restored_id_range', '90-181',
           'restored_at_range', '2026-08-16 13:28 to 2026-09-02 10:16 AEST',
           'post_cutover_rows_written_before_recovery', (SELECT count(*) FROM auth_audit_log WHERE id BETWEEN 16 AND 26),
           'ordering', 'chronological order is by "at"; ids 16-26 were written after ids 90-181',
           'gaps', 'ids below 90 were already absent in the pre-cutover source; ids 1-15 are absent in this database'),
         'site_settings_restored', (SELECT coalesce(jsonb_agg(key ORDER BY key), '[]'::jsonb) FROM site_settings
                                     WHERE key IN ('apex.content','early_access.intro','early_access.notify','early_access.questions',
                                                   'home.aflw_leaders','home.record_of_the_week','site.footer')),
         'site_settings_retired_as_default_equal', to_jsonb(ARRAY['early_access.notify_to','early_access.open','grid_solver.audience','home.sections']),
         'site_media_restored', (SELECT count(*) FROM site_media),
         'beta_join_requests_restored', (SELECT count(*) FROM beta_join_requests WHERE requested_at < '2026-09-02'),
         'staging_aflw_restored_rows',
           (SELECT (SELECT count(*) FROM staging_aflw.seasons) + (SELECT count(*) FROM staging_aflw.fixtures)
                 + (SELECT count(*) FROM staging_aflw.matches) + (SELECT count(*) FROM staging_aflw.ladders)
                 + (SELECT count(*) FROM staging_aflw.player_seasons) + (SELECT count(*) FROM staging_aflw.player_match_stats)
                 + (SELECT count(*) FROM staging_aflw.scoring_events) + (SELECT count(*) FROM staging_aflw.issues)),
         'retired', jsonb_build_object(
           'beta_access_codes', 'id 4 "screenGrabs" (single-use, consumed 2026-08-16, expiring 2026-11-14) intentionally not restored; production issued its own code on 2026-09-04',
           'auth_sessions', '17 pre-cutover sessions, all expired by 2026-09-02 22:16 AEST, not restored',
           'data_edits', '2 rows for pre-rebuild player id 4375 (Kelly Robinson) not restored: that id denotes a different player after the rebuild; the corrections are re-applied through the data editor',
           'player_link_resolutions', '6 rows not restored: honour row ids and player ids did not survive the rebuild',
           'player_link_suggestions', '2 rows not restored (same reason)',
           'player_link_match_candidates', '2944 rows regenerated, never restored',
           'nl_search_log', '88 rows, 1 feedback row and 2 app_health_events not restored: ids collide with post-cutover telemetry',
           'beta_join_requests', '1 pending pre-cutover request (2026-08-16 20:32 AEST) retired by operator decision on 2026-09-04, not restored'),
         'recovery_database', 'afldb_prod_auth_recovery retained until AFLDB-ISSUE-126 is closed'
       )
RETURNING id, at, action;

DO $$
DECLARE n bigint; hi bigint; mid bigint;
BEGIN
  SELECT count(*) INTO n FROM auth_audit_log WHERE action = 'database.recovered';
  SELECT max(id) INTO hi FROM auth_audit_log;
  SELECT id INTO mid FROM auth_audit_log WHERE action = 'database.recovered';
  IF n <> 1 OR mid <> hi THEN RAISE EXCEPTION 'POST-CHECK FAILED: % markers, marker id %, max id %', n, mid, hi; END IF;
  RAISE NOTICE 'post-check OK: marker id % is the latest row', mid;
END $$;

SELECT id, at, actor_label, action, jsonb_pretty(detail) FROM auth_audit_log WHERE action = 'database.recovered';

\if :commit
  COMMIT;
  \echo 'T6 COMMITTED'
\else
  ROLLBACK;
  \echo 'T6 REHEARSAL ONLY — rolled back (re-run with -v commit=1 to apply)'
\endif
