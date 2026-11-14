set -euo pipefail
cd /home/arm/ops/gap029-stages/a25306f9/cand
export RV_DSN="$(sed -n 's/^AFLDB_BACKUP_DATABASE_URL=//p' /home/arm/projects/afldb/.env | tail -1 | sed 's/^"\(.*\)"$/\1/')"
cat > /tmp/rem348.sql <<'SQLEOF'
WITH ds AS (SELECT id FROM sources WHERE key = 'draftguru'),
audited AS (  
  SELECT dp.id, dp.draft_person_id
    FROM draft_picks dp, ds
   WHERE dp.source_id = ds.id
     AND EXISTS (SELECT 1 FROM data_edits e
                  WHERE e.table_name = 'draft_picks' AND e.row_id = dp.id
                    AND e.field_group = 'source_insert')
)
SELECT
  (SELECT count(*) FROM draft_picks dp, ds WHERE dp.source_id = ds.id)                          AS draftguru_picks,
  (SELECT count(*) FROM audited)                                                                AS picks_audited_insert,
  (SELECT count(*) FROM draft_picks dp, ds
    WHERE dp.source_id = ds.id
      AND EXISTS (SELECT 1 FROM data_edits e WHERE e.table_name = 'draft_picks' AND e.row_id = dp.id)) AS picks_with_any_data_edits,
  (SELECT count(*) FROM draft_picks dp, ds
    WHERE dp.source_id = ds.id
      AND EXISTS (SELECT 1 FROM data_overrides o
                   WHERE o.entity_type = 'draft_picks' AND o.is_active
                     AND o.entity_key = dp.source_id::text || '|' || dp.player_url || '|'
                                        || dp.draft_year::text || '|' || dp.draft_kind))        AS picks_with_active_override,
  (SELECT count(DISTINCT a.draft_person_id) FROM audited a)                                     AS persons_of_audited_picks,
  (SELECT count(*) FROM draft_persons p, ds   
    WHERE p.source_id = ds.id
      AND EXISTS (SELECT 1 FROM audited a WHERE a.draft_person_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM draft_picks k
                       WHERE k.draft_person_id = p.id
                         AND k.id NOT IN (SELECT id FROM audited)))                             AS persons_audited_only,
  (SELECT count(*) FROM draft_persons p, ds
    WHERE p.source_id = ds.id
      AND p.confidence_notes LIKE 'AFLDB-ISSUE-336 bounded insert%')                            AS persons_with_marker,
  (SELECT count(*) FROM draft_persons p, ds
    WHERE p.source_id = ds.id
      AND NOT EXISTS (SELECT 1 FROM external_identities x
                       WHERE x.source_id = p.source_id AND x.external_id = p.player_url))       AS draftguru_persons_without_identity;
SQLEOF
/home/arm/.nvm/versions/node/v22.23.2/bin/node --input-type=module <<'JS'
import { createRequire } from 'node:module'; import fs from 'node:fs';
const require=createRequire('/home/arm/ops/gap029-stages/a25306f9/cand/package.json');
const postgres=require('postgres');
const sql = postgres(process.env.RV_DSN, { max: 1, onnotice: () => {}, connection: { default_transaction_read_only: true, TimeZone: 'Etc/UTC', statement_timeout: 60000 } });
const q = fs.readFileSync('/tmp/rem348.sql','utf8');
try {
  await sql.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY', async (tx) => {
    const [identity] = await tx`SELECT current_database() AS db, d.oid::text AS oid, c.system_identifier::text AS sysid, current_setting('transaction_read_only') AS ro, now()::text AS at FROM pg_database d CROSS JOIN pg_control_system() c WHERE d.datname=current_database()`;
    if(identity.db!=='afldb_prod'||identity.oid!=='66668'||identity.sysid!=='7674454702926115004'||identity.ro!=='on') throw Error('production identity/read-only mismatch');
    const r = await tx.unsafe(q);
    console.log(JSON.stringify({identity, result: r[0]}));
  });
} catch (e) { console.log('ERROR', String(e.message).replace(/postgres(ql)?:\/\/\S+/g,'<dsn>').slice(0,300)); }
finally { await sql.end(); rmSafe(); }
function rmSafe(){ try{fs.unlinkSync('/tmp/rem348.sql')}catch{} }
JS
