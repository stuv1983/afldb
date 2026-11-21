-- ISSUE-363 (2026-11-21): whole-database content fingerprint, one line per base table in public/staging/afldb_meta:
--   <schema.table>=<rows>:<order-independent content hash>
-- plus import_batches max id. Aggregates only; no row data is printed.
\pset pager off
\pset tuples_only on
\pset format unaligned
SELECT table_schema || '.' || table_name || '=' || (xpath('/row/c/text()', query_to_xml(format(
         'SELECT count(*)::text || '':'' || coalesce(sum(hashtextextended(t::text, 0)::numeric), 0)::text AS c FROM %I.%I t',
         table_schema, table_name), false, true, '')))[1]::text
  FROM information_schema.tables
 WHERE table_type = 'BASE TABLE' AND table_schema IN ('public', 'staging', 'afldb_meta')
 ORDER BY table_schema, table_name;
SELECT 'import_batches.max_id=' || coalesce(max(id), 0) FROM import_batches;
