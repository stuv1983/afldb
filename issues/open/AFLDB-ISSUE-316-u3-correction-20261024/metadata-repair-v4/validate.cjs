'use strict';
// Disposable in-memory PostgreSQL representation. No socket, environment DSN,
// production credentials, shell, or production wrapper invocation.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const dir=__dirname, get=n=>fs.readFileSync(path.join(dir,n),'utf8');
const b=JSON.parse(get('binding.json')), protectedSpec=JSON.parse(get('protected.json'));
function sql(name,identity=false,optional=[false,false]) {
  // Identity is deliberately not spoofed: test the exact production-only identity
  // separately (it must refuse this database). No production artifact is rewritten.
  return get(name).replace(/^\\ir ([a-z-]+\.sql)\s*$/gm,(_,child)=>child==='identity.sql'&&!identity?'':sql(child,identity,optional))
    .replace(/\\if :i316_optional_(\d)\n([\s\S]*?)\\endif/g,(_,i,body)=>optional[Number(i)]?body:'')
    .replace(/\\if :i316_clean[\s\S]*?\\endif/g,'')
    .replace(/^\\set .*$/gm,'').replace(/^\\echo .*$/gm,'').replace(/\\gset/g,';');
}
const q=s=>"'"+s.replace(/'/g,"''")+"'";
async function seed(factory) {
  const db=factory?await factory():new (require('@electric-sql/pglite').PGlite)(); if(!factory) await db.waitReady;
  await db.exec(`CREATE SCHEMA staging;
    CREATE SCHEMA afldb_meta;
    CREATE TABLE afldb_meta.schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now(),duration_ms integer NOT NULL);
    CREATE TABLE auth_users(id integer PRIMARY KEY, email text UNIQUE NOT NULL, role text NOT NULL, disabled_at timestamptz);
    INSERT INTO auth_users VALUES(1,'stuart.villanti@gmail.com','super_admin',NULL);
    ${get('audit-schema-source.txt').match(/CREATE TABLE data_edits \([\s\S]*?\n\);/)[0]}
    ALTER TABLE data_edits DROP CONSTRAINT data_edits_table_name_check;
    ALTER TABLE data_edits ADD CONSTRAINT data_edits_table_name_check ${b.audit_constraints.find(x=>x.startsWith('CHECK ((table_name'))};
    CREATE TABLE data_overrides(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      entity_type text NOT NULL,entity_key text NOT NULL,field_group text NOT NULL,override_values jsonb NOT NULL,
      is_active boolean NOT NULL DEFAULT true,admin_user_id integer NOT NULL REFERENCES auth_users(id),
      created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE matches(id integer PRIMARY KEY,season smallint,match_key text);
    CREATE TABLE player_match_stats(id bigint PRIMARY KEY,player_id integer,match_id integer,club_id integer);
    CREATE TABLE staging.afltables_player_match(season smallint,match_key text,player_id integer,club_id integer);
    INSERT INTO matches VALUES(17214,2026,'retained-fixture');
    INSERT INTO player_match_stats SELECT 800000+i,3000+i,17214,CASE WHEN i<=23 THEN 6 ELSE 12 END FROM generate_series(1,10028)i;
    INSERT INTO staging.afltables_player_match SELECT 2026,'retained-fixture',player_id,club_id FROM player_match_stats;
    INSERT INTO data_edits OVERRIDING SYSTEM VALUE SELECT r.* FROM jsonb_populate_record(NULL::data_edits,${q(JSON.stringify(b.edit94))}::jsonb)r;
    INSERT INTO data_overrides OVERRIDING SYSTEM VALUE SELECT r.* FROM jsonb_populate_record(NULL::data_overrides,${q(JSON.stringify(b.authority93))}::jsonb)r;
    SELECT setval('data_edits_id_seq',94,true);`);
  for(const relation of protectedSpec.required) if(!['public.data_overrides','public.matches','public.player_match_stats','staging.afltables_player_match','afldb_meta.schema_migrations'].includes(relation))
    await db.exec(`CREATE TABLE ${relation}(fixture_key integer PRIMARY KEY, retained_value jsonb); INSERT INTO ${relation} VALUES(1,'{"untouched":true}');`);
  const expected=JSON.parse(get('expected-migrations.json')).rows;
  for(const m of expected)await db.exec(`INSERT INTO afldb_meta.schema_migrations(name,checksum,duration_ms) VALUES(${q(m.name)},${q(m.checksums[0])},0)`);
  await db.exec(`SELECT set_config('afldb.i316.expected_migrations',${q(JSON.stringify(expected))},false)`);
  await db.exec(`CREATE INDEX fixture_pms_key ON player_match_stats(player_id,club_id,match_id);
    CREATE INDEX fixture_baseline_key ON staging.afltables_player_match(season,match_key,player_id,club_id);
    ANALYZE;
    SET timezone='UTC';
    SELECT set_config('afldb.i316.binding',${q(JSON.stringify(b))},false);
    SELECT set_config('afldb.i316.approval_sha256',${q(b.approval_sha256)},false);
    SELECT set_config('afldb.i316.manifest_sha256','${'a'.repeat(64)}',false);
    SELECT set_config('afldb.i316.review_sha256','${'b'.repeat(64)}',false);`);
  return db;
}
async function noRepair(db) {
  const r=await db.query('SELECT note,(SELECT count(*)::integer FROM data_edits) AS edits FROM data_edits WHERE id=94');
  if(r.rows.length) { assert.equal(r.rows[0].note,null); assert.equal(r.rows[0].edits,1); }
}
async function refuses(db,run,pattern) {
  await assert.rejects(run,pattern); await db.exec('ROLLBACK;');
}
async function main() {
  const results=[];
  async function test(name,fn) {const db=await seed(); try {await fn(db);results.push({name,status:'PASS'});} finally{await db.close();}}
  const pre=db=>db.exec(sql('preflight.sql'));
  const repair=db=>db.exec(sql('repair.sql'));
  const post=db=>db.exec(sql('postcheck.sql'));
  await test('production identity refuses disposable database',async db=>{
    await refuses(db,()=>db.exec(get('identity.sql')),/production identity refused|pg_control_system/); await noRepair(db);
  });
  await test('happy path: exact NULL-to-note plus one audit; protected data equal; read-only postcheck',async db=>{
    await pre(db); await repair(db); await post(db);
    const r=await db.query('SELECT id,note,field_group FROM data_edits ORDER BY id');
    assert.equal(r.rows.length,2); assert.equal(r.rows[0].note,b.note); assert.equal(r.rows[1].field_group,'audit_note_repair');
    assert.equal((await db.query("SELECT current_setting('transaction_read_only') r")).rows[0].r,'off');
  });
  await test('non-NULL note refuses',async db=>{
    await db.exec("UPDATE data_edits SET note='already supplied' WHERE id=94");
    await refuses(db,()=>pre(db),/target identity\/null guard refused/);
    assert.equal((await db.query('SELECT count(*)::integer n FROM data_edits')).rows[0].n,1);
  });
  await test('wrong full record identity refuses',async db=>{
    await db.exec("UPDATE data_edits SET created_at=created_at+interval '1 microsecond' WHERE id=94");
    await refuses(db,()=>pre(db),/target identity\/null guard refused/); await noRepair(db);
  });
  await test('missing row refuses',async db=>{
    await db.exec('DELETE FROM data_edits WHERE id=94'); await refuses(db,()=>pre(db),/target identity\/null guard refused/);
    assert.equal((await db.query('SELECT count(*)::integer n FROM data_edits')).rows[0].n,0);
  });
  await test('linked-audit insert PK failure rolls note update back',async db=>{
    await pre(db); await db.exec("SELECT setval('data_edits_id_seq',94,false)");
    await refuses(db,()=>repair(db),/duplicate key/); await noRepair(db);
  });
  await test('wrong actor binding refuses',async db=>{
    await db.exec("UPDATE auth_users SET email='different@example.invalid' WHERE id=1");
    await refuses(db,()=>pre(db),/actor refused/); await noRepair(db);
  });
  await test('wrong approval hash refuses',async db=>{
    await db.exec("SELECT set_config('afldb.i316.approval_sha256','wrong',false)");
    await refuses(db,()=>pre(db),/approval refused/); await noRepair(db);
  });
  await test('second execution refuses rather than another audit',async db=>{
    await pre(db); await repair(db); await post(db);
    await refuses(db,()=>pre(db),/target identity\/null guard refused/);
    assert.equal((await db.query('SELECT count(*)::integer n FROM data_edits')).rows[0].n,2);
  });
  await test('authority drift refuses',async db=>{
    await db.exec('UPDATE data_overrides SET is_active=false WHERE id=93');
    await refuses(db,()=>pre(db),/authority refused/); await noRepair(db);
  });
  await test('newline input refuses without normalization',async db=>{
    const bad={...b,note:b.note+'\n'};
    await db.exec(`SELECT set_config('afldb.i316.binding',${q(JSON.stringify(bad))},false)`);
    await refuses(db,()=>pre(db),/note input refused/); await noRepair(db);
  });
  await test('preflight-to-repair canonical drift refuses',async db=>{
    await pre(db); await db.exec("UPDATE public.player_career_stats SET retained_value='{}'");
    await refuses(db,()=>repair(db),/state drift after read-only preflight/); await noRepair(db);
  });
  await test('postcheck detects Brownlow changes',async db=>{
    await pre(db); await repair(db); await db.exec("UPDATE public.brownlow_round_votes SET retained_value='{}'");
    await refuses(db,()=>post(db),/protected canonical\/derived\/history\/Brownlow state changed/);
  });
  await test('postcheck detects additional audit row',async db=>{
    await pre(db); await repair(db);
    await db.exec("INSERT INTO data_edits(table_name,row_id,field_group,old_values,new_values,admin_user_id) VALUES('matches',17214,'unexpected','{}','{}',1)");
    await refuses(db,()=>post(db),/additional\/missing\/changed audit row refused/);
  });
  await test('wrong canonical count refuses before write',async db=>{
    await db.exec('DELETE FROM player_match_stats WHERE id=800001');
    await refuses(db,()=>pre(db),/canonical\/count\/baseline gate refused/); await noRepair(db);
  });
  await test('unexpected audit trigger refuses',async db=>{
    await db.exec("CREATE FUNCTION refuse_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$; CREATE TRIGGER extra BEFORE INSERT ON data_edits FOR EACH ROW EXECUTE FUNCTION refuse_audit()");
    await refuses(db,()=>pre(db),/unexpected audit\/authority trigger/); await noRepair(db);
  });
  await test('postcommit optional appearance reports drift without false clean state or reversal',async db=>{
    await pre(db);await repair(db);
    await db.exec('CREATE TABLE public.brownlow_eligibility_decisions(id integer)');
    await post(db);
    assert.equal((await db.query("SELECT current_setting('afldb.i316.environment_status') s")).rows[0].s,'CONCURRENT_SCHEMA_DRIFT');
    assert.equal((await db.query('SELECT count(*)::integer n FROM data_edits')).rows[0].n,2);
    assert.equal((await db.query('SELECT note FROM data_edits WHERE id=94')).rows[0].note,b.note);
  });
  await test('existing optional schema alteration after commit is environment drift',async db=>{
    for(const r of protectedSpec.optional)await db.exec(`CREATE TABLE ${r}(fixture_key integer PRIMARY KEY)`);
    await pre(db);await db.exec(sql('repair.sql',false,[true,true]));
    await db.exec('ALTER TABLE public.brownlow_eligibility_decisions ALTER COLUMN fixture_key SET DEFAULT 1');
    await post(db);
    assert.equal((await db.query("SELECT current_setting('afldb.i316.environment_status') s")).rows[0].s,'CONCURRENT_SCHEMA_DRIFT');
  });
  await test('optional drift does not excuse protected data or audit corruption',async db=>{
    await pre(db);await repair(db);
    await db.exec("CREATE TABLE public.brownlow_eligibility_decisions(id integer); UPDATE public.brownlow_round_votes SET retained_value='{}'");
    await refuses(db,()=>post(db),/protected canonical\/derived\/history\/Brownlow state changed/);
  });
  const report={engine:'@electric-sql/pglite 0.2.17; in-memory disposable PostgreSQL',
    scope:'Exact SQL includes except identity.sql, independently proven to refuse this fixture. Protected non-target relation shapes are synthetic. No production guard was changed. Transport/live production schema not tested.',
    completed_utc:new Date().toISOString(),passed:results.length,results};
  fs.writeFileSync(path.join(dir,'VALIDATION.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}
if(require.main===module) main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={seed,sql,noRepair,refuses};
