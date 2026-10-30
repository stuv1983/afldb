INSERT INTO import_batches (source_id, tool, target_table, records_read, notes)
SELECT source_id, 'manual-control.ts', 'staging.source_record_versions', 0,
       'AFLDB-ISSUE-099 settle; snapshot=settle-2026-2026-10-30-0444; season=2026; mode=apply'
  FROM import_batches WHERE tool = 'settle-afltables.ts' ORDER BY id DESC LIMIT 1;
