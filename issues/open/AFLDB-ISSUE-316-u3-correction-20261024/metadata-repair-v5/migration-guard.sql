-- Expected pre-repair ledger. No migration is run or authorised.
DO $migration$
DECLARE expected jsonb := current_setting('afldb.i316.expected_migrations')::jsonb;
BEGIN
 IF (SELECT count(*) FROM afldb_meta.schema_migrations) <> jsonb_array_length(expected)
 OR EXISTS (SELECT 1 FROM jsonb_array_elements(expected) e
   LEFT JOIN afldb_meta.schema_migrations m ON m.name=e->>'name'
   WHERE m.name IS NULL OR NOT (e->'checksums' ? m.checksum))
 THEN RAISE EXCEPTION 'I316 expected pre-repair migration/schema version refused'; END IF;
END $migration$;
