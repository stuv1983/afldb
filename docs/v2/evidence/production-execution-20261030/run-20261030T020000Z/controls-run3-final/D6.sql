INSERT INTO import_batches (source_id, tool, target_table, records_read, notes)
SELECT source_id, 'settle-afltables.ts', 'staging.source_record_versions', 0,
       'AFLDB-ISSUE-099 settle; snapshot=settle-2026-2026-10-30-0444; season=2026; mode=apply'
  FROM import_batches WHERE tool = 'settle-afltables.ts' ORDER BY id DESC LIMIT 1;
UPDATE import_batches SET started_at = '2026-10-01T00:00:00Z' WHERE id = (SELECT max(id) FROM import_batches);
