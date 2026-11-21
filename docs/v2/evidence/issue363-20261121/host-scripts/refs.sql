-- ISSUE-363 (2026-11-21): for every foreign key into import_batches, how many rows reference a batch newer than :maxid
-- (the template's max import_batches.id). Usage: psql -v maxid=<n> -f refs.sql. Aggregates only.
\pset pager off
\pset tuples_only on
\pset format unaligned
SELECT 'import_batches.new=' || count(*) || ' target_tables=' || coalesce(string_agg(DISTINCT coalesce(target_table, '-'), ',' ), '')
  FROM import_batches WHERE id > :maxid;
SELECT 'ref ' || c.conrelid::regclass || '.' || a.attname || ' (' || c.confdeltype::text || ')=' ||
       (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %s WHERE %I > %s', c.conrelid::regclass, a.attname, :maxid),
                                         false, true, '')))[1]::text
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
 WHERE c.contype = 'f' AND c.confrelid = 'import_batches'::regclass
 ORDER BY 1;
