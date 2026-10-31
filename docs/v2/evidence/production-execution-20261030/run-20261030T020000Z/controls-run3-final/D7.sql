INSERT INTO import_batches (source_id, tool, target_table, records_read, notes)
SELECT source_id, 'settle-afltables.ts', 'staging.source_record_versions', 0,
       'AFLDB-ISSUE-099 settle; snapshot=settle-2026-2026-10-30-0444; season=2026; mode=apply'
  FROM import_batches WHERE tool = 'settle-afltables.ts' ORDER BY id DESC LIMIT 1;
SELECT format('UPDATE public.matches SET %I = (SELECT max(id) FROM public.import_batches) WHERE id = (SELECT max(id) FROM public.matches)', a.attname) FROM pg_constraint k JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1] WHERE k.contype = 'f' AND k.conrelid = 'public.matches'::regclass AND k.confrelid = 'public.import_batches'::regclass LIMIT 1 \gexec
