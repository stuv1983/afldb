\pset pager off
\echo == identity
SELECT current_database() AS db, (SELECT count(*) FROM afldb_meta.schema_migrations) AS ledger;
\echo == seasons beyond the real history (expect 2027 only on the rebuild, none on the snapshot)
SELECT year, status::text FROM seasons WHERE year > 2026 ORDER BY year;
\echo == rows citing season 2069 or 2070 in ANY table that references seasons(year) (expect none)
SELECT c.conrelid::regclass::text AS table_name, a.attname AS column_name, y.year,
       (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %s WHERE %I = %s', c.conrelid::regclass, a.attname, y.year), false, true, '')))[1]::text AS n
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
  CROSS JOIN (VALUES (2069), (2070)) AS y(year)
 WHERE c.contype = 'f' AND c.confrelid = 'seasons'::regclass
   AND (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %s WHERE %I = %s', c.conrelid::regclass, a.attname, y.year), false, true, '')))[1]::text <> '0'
 ORDER BY 1, 2, 3;
SELECT count(*) AS referencing_columns_checked FROM pg_constraint WHERE contype = 'f' AND confrelid = 'seasons'::regclass;
\echo == matches / external_identities / import_batches under the CD_I4040 prefix or the suite namespace (expect 0)
SELECT (SELECT count(*) FROM matches WHERE season IN (2069, 2070) OR match_key LIKE 'CD_M2026ISSUE276%' OR source_record_id LIKE 'CD_M2026ISSUE276%') AS matches_rows,
       (SELECT count(*) FROM external_identities WHERE external_id LIKE 'CD_I4040%') AS external_identities_rows;
\echo == the real 2026 Preliminary Final(s) the suite avoids (key, round, finals flag)
SELECT m.id, m.match_key, m.round_code, m.round_type::text, m.is_final
  FROM matches m WHERE m.season = 2026 AND m.round_code = 'PF' ORDER BY m.match_date, m.id;
\echo == real 2026 matches with the oriented pair Hawthorn(home) v Brisbane Lions(away): round_code, date
SELECT m.round_code, m.match_date FROM matches m
  JOIN clubs h ON h.id = m.home_club_id JOIN clubs a ON a.id = m.away_club_id
 WHERE m.season = 2026 AND h.legacy_club_hist = 'Hawthorn' AND a.legacy_club_hist = 'Brisbane Lions' ORDER BY m.match_date;
