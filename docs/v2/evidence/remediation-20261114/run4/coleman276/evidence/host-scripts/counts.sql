\pset pager off
\pset tuples_only on
\pset format unaligned
SELECT table_schema || '.' || table_name || '=' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text
  FROM information_schema.tables
 WHERE table_type = 'BASE TABLE' AND table_schema IN ('public', 'staging')
 ORDER BY table_schema, table_name;
