INSERT INTO import_batches (source_id, tool, target_table, records_read, notes)
SELECT source_id, 'settle-afltables.ts', 'staging.source_record_versions', 0,
       'AFLDB-ISSUE-099 settle; snapshot=settle-2026-2026-10-30-0444; season=2026; mode=apply'
  FROM import_batches WHERE tool = 'settle-afltables.ts' ORDER BY id DESC LIMIT 1;
DO $$ BEGIN IF (SELECT count(*) FROM staging.source_records WHERE absent_since IS NULL) < 62 THEN
  RAISE EXCEPTION 'control needs 62 present source records'; END IF; END $$;
CREATE TEMP TABLE ctl_b AS SELECT max(id) AS id FROM import_batches;
UPDATE staging.source_records SET last_seen_at = now(), last_batch_id = ((SELECT min(id) FROM import_batches))
 WHERE (source_id, family, external_record_id) IN (SELECT source_id, family, external_record_id FROM staging.source_records
        WHERE absent_since IS NULL ORDER BY source_id, family, external_record_id LIMIT 50);
UPDATE staging.source_records SET absent_since = now()
 WHERE (source_id, family, external_record_id) = (SELECT source_id, family, external_record_id FROM staging.source_records
        WHERE absent_since IS NULL ORDER BY source_id DESC, family DESC, external_record_id DESC LIMIT 1);
CREATE TEMP TABLE ctl_r AS SELECT source_id, family, external_record_id, current_version_seq AS v,
  md5(external_record_id) || md5('control-' || external_record_id) AS h
  FROM staging.source_records WHERE absent_since IS NULL ORDER BY source_id, family, external_record_id OFFSET 60 LIMIT 1;
INSERT INTO staging.source_payloads (source_id, family, payload_hash, hash_recipe, raw_payload)
  SELECT source_id, family, h, 'control', '{"control": true}'::jsonb FROM ctl_r;
UPDATE staging.source_record_versions v SET observed_to = now(), closed_by_batch_id = (SELECT id FROM ctl_b) FROM ctl_r r
 WHERE v.source_id = r.source_id AND v.family = r.family AND v.external_record_id = r.external_record_id AND v.version_seq = r.v AND v.observed_to IS NULL;
INSERT INTO staging.source_record_versions (source_id, family, external_record_id, version_seq, payload_hash, observed_from, opened_by_batch_id)
  SELECT source_id, family, external_record_id, v + 1, h, now(), (SELECT id FROM ctl_b) FROM ctl_r;
UPDATE staging.source_records s SET current_version_seq = r.v + 1, current_payload_hash = r.h, last_seen_at = now(), last_batch_id = (SELECT id FROM ctl_b)
  FROM ctl_r r WHERE s.source_id = r.source_id AND s.family = r.family AND s.external_record_id = r.external_record_id;
INSERT INTO import_rejections (import_batch_id, source_record_id, reason, payload) SELECT id, 'control', 'control: unresolved identity', '{}'::jsonb FROM ctl_b;
DO $$ BEGIN IF (SELECT count(*) FROM staging.afltables_match) < 50 OR (SELECT count(*) FROM staging.afltables_player_match) < 50 THEN
  RAISE EXCEPTION 'control needs 50 rows in each projection'; END IF; END $$;
UPDATE staging.afltables_match SET projected_by_batch_id = ((SELECT min(id) FROM import_batches)), projected_at = now()
 WHERE (source_id, family, external_record_id) IN (SELECT source_id, family, external_record_id FROM staging.afltables_match ORDER BY 1, 2, 3 LIMIT 50);
UPDATE staging.afltables_player_match SET projected_by_batch_id = ((SELECT min(id) FROM import_batches)), projected_at = now()
 WHERE (source_id, family, external_record_id) IN (SELECT source_id, family, external_record_id FROM staging.afltables_player_match ORDER BY 1, 2, 3 LIMIT 50);
