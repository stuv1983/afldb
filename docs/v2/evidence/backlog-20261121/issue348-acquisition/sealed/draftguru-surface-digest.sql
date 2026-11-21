-- AFLDB-ISSUE-348: read-only DraftGuru surface digests (sealed-plan pre-condition and post-check).
-- Run as a read-only role inside a READ ONLY transaction. Prints name|count|md5 lines only (no row data).
-- link_*  : the link state (player_id, link status, match_method) that the reload guard does not review;
-- facts_* : every column except volatile bookkeeping (import_batch_id, created_at, updated_at) and, for
--           external_identities, the generated id (new identity rows get fresh ids).
\set ON_ERROR_STOP 1
BEGIN READ ONLY;
SET LOCAL TIME ZONE 'Etc/UTC';
SET LOCAL extra_float_digits = 3;
WITH s AS (SELECT id FROM sources WHERE key = 'draftguru')
SELECT 'link_persons' AS name, count(*) AS n,
       md5(string_agg(concat_ws('|', player_url, player_id, link_status, match_method), E'\n' ORDER BY player_url)) AS md5
  FROM draft_persons WHERE source_id = (SELECT id FROM s)
UNION ALL
SELECT 'link_picks', count(*),
       md5(string_agg(concat_ws('|', player_url, draft_year, draft_kind, player_id, link_status_value, match_method), E'\n'
                      ORDER BY player_url, draft_year, draft_kind))
  FROM draft_picks WHERE source_id = (SELECT id FROM s)
UNION ALL
SELECT 'link_idents', count(*),
       md5(string_agg(concat_ws('|', external_id, player_id, status, match_method), E'\n' ORDER BY external_id))
  FROM external_identities WHERE source_id = (SELECT id FROM s)
UNION ALL
SELECT 'facts_picks', count(*),
       md5(string_agg((to_jsonb(t) - ARRAY['import_batch_id', 'created_at', 'updated_at'])::text, E'\n' ORDER BY t.id))
  FROM draft_picks t WHERE source_id = (SELECT id FROM s)
UNION ALL
SELECT 'facts_persons', count(*),
       md5(string_agg((to_jsonb(t) - ARRAY['import_batch_id', 'created_at', 'updated_at'])::text, E'\n' ORDER BY t.id))
  FROM draft_persons t WHERE source_id = (SELECT id FROM s)
UNION ALL
SELECT 'facts_idents', count(*),
       md5(string_agg((to_jsonb(t) - ARRAY['id', 'import_batch_id', 'created_at', 'updated_at'])::text, E'\n' ORDER BY t.external_id))
  FROM external_identities t WHERE source_id = (SELECT id FROM s)
UNION ALL
SELECT 'non_dg_picks', count(*), md5(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id))
  FROM draft_picks t WHERE source_id IS DISTINCT FROM (SELECT id FROM s)
UNION ALL
SELECT 'data_edits', count(*), md5(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id)) FROM data_edits t
UNION ALL
SELECT 'data_overrides', count(*), md5(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id)) FROM data_overrides t
UNION ALL
SELECT 'players', count(*), md5(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id)) FROM players t;
ROLLBACK;
