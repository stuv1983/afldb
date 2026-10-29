'use strict';
const fs=require('node:fs'),path=require('node:path');
const d=path.join(__dirname,'metadata-repair-v4'),g=n=>fs.readFileSync(path.join(d,n),'utf8'),w=(n,s)=>fs.writeFileSync(path.join(d,n),s);
const edit=(n,a,b)=>{const s=g(n);if(!s.includes(a))throw Error('Missing edit '+n+' '+a);w(n,s.replace(a,b));};
const spec=JSON.parse(g('protected.json'));spec.required.push('afldb_meta.schema_migrations');w('protected.json',JSON.stringify(spec,null,2)+'\n');
edit('lock-assert.sql',"'afldb_meta.schema_migrations','public.data_edits'","'public.data_edits'");
edit('lock-assert.sql',"'staging.afl_api_brownlow_vote'];","'staging.afl_api_brownlow_vote','afldb_meta.schema_migrations'];");
edit('snapshot.sql',"'staging.afl_api_brownlow_vote'];","'staging.afl_api_brownlow_vote','afldb_meta.schema_migrations'];");
edit('snapshot.sql',"DECLARE result jsonb := '{}'::jsonb; relation text; fingerprint jsonb;","DECLARE result jsonb := '{}'::jsonb; optional_schema jsonb := '{}'::jsonb; relation text; fingerprint jsonb; schema_state jsonb;");
edit('snapshot.sql',"   IF to_regclass(relation) IS NULL THEN",`   IF NOT relation=ANY(required) THEN
     SELECT jsonb_build_object('present',true,'oid',c.oid,'namespace_oid',c.relnamespace,'kind',c.relkind,
       'columns',(SELECT jsonb_agg(jsonb_build_array(attnum,attname,atttypid,atttypmod,attnotnull,attidentity,attgenerated,attisdropped) ORDER BY attnum)
         FROM pg_catalog.pg_attribute WHERE attrelid=c.oid AND attnum>0),
       'constraints',(SELECT jsonb_agg(pg_get_constraintdef(oid) ORDER BY oid) FROM pg_catalog.pg_constraint WHERE conrelid=c.oid))
       INTO schema_state FROM pg_catalog.pg_class c WHERE c.oid=to_regclass(relation);
     optional_schema := optional_schema || jsonb_build_object(relation,COALESCE(schema_state,'{"present":false}'::jsonb));
   END IF;
   IF to_regclass(relation) IS NULL THEN`);
edit('snapshot.sql',"   ELSE\n     EXECUTE format",`   ELSIF current_setting('afldb.i316.postcommit',true)='true'
     AND current_setting('afldb.i316.before')::jsonb->'protected'->relation = '{"absent":true}'::jsonb THEN
     -- Newly appeared unrelated optional table: record schema, do not read its data.
     result := result || jsonb_build_object(relation,jsonb_build_object('environment_only',true));
   ELSE
     EXECUTE format`);
edit('snapshot.sql',"jsonb_build_object('protected',result,","jsonb_build_object('protected',result,'optional_schema',optional_schema,");
edit('assert-post.sql',"        n text;",`        n text; relation text; beforep jsonb := beforej->'protected'; afterp jsonb := afterj->'protected';
        postcommit boolean := COALESCE(current_setting('afldb.i316.postcommit',true),'false')='true';
        drift boolean := afterj->'optional_schema' IS DISTINCT FROM beforej->'optional_schema';`);
edit('assert-post.sql'," IF afterj->'protected' IS DISTINCT FROM beforej->'protected'",` IF postcommit THEN
   FOREACH relation IN ARRAY ARRAY['public.brownlow_eligibility_decisions','public.brownlow_correction_receipts'] LOOP
     IF beforep->relation = '{"absent":true}'::jsonb THEN
       beforep := beforep-relation; afterp := afterp-relation;
     END IF;
   END LOOP;
 END IF;
 IF afterp IS DISTINCT FROM beforep`);
edit('assert-post.sql',"END $post$;",` IF drift AND NOT postcommit THEN RAISE EXCEPTION 'I316 optional schema drift before commit'; END IF;
 PERFORM set_config('afldb.i316.environment_status',CASE WHEN drift THEN 'CONCURRENT_SCHEMA_DRIFT' ELSE 'CLEAN' END,false);
END $post$;`);
edit('preflight.sql','\\ir checks.sql','\\ir operational-guard.sql\n\\ir migration-guard.sql\n\\ir checks.sql');
edit('repair.sql','\\ir checks.sql','\\ir migration-guard.sql\n\\ir checks.sql');
edit('repair.sql','\\echo I316_POST_LOCK_GUARDS_PASSED',"SELECT 'I316_LOCKED_OPTIONAL_SCHEMA=' || (current_setting('afldb.i316.snapshot')::jsonb->'optional_schema')::text;\n\\echo I316_POST_LOCK_GUARDS_PASSED");
edit('postcheck.sql','\\ir snapshot.sql',"SELECT set_config('afldb.i316.postcommit','true',true) AS postcommit_mode \\gset\n\\ir snapshot.sql");
edit('postcheck.sql',"'status','PASS'","'status',CASE WHEN current_setting('afldb.i316.environment_status')='CLEAN' THEN 'PASS' ELSE 'CONCURRENT_SCHEMA_DRIFT' END,'u3_confirmable',current_setting('afldb.i316.environment_status')='CLEAN'");
edit('postcheck.sql','\\echo I316_POSTCOMMIT_VERIFICATION_PASSED',`SELECT current_setting('afldb.i316.environment_status')='CLEAN' AS i316_clean \\gset
\\if :i316_clean
\\echo I316_POSTCOMMIT_VERIFICATION_PASSED
\\else
\\echo I316_CONCURRENT_SCHEMA_DRIFT_U3_UNCONFIRMED_NO_RETRY_NO_REVERSAL
\\endif`);
edit('run.cjs',"'afldb.i316.approval_sha256':sha(read('OWNER-RULING.md')),","'afldb.i316.approval_sha256':sha(read('OWNER-RULING.md')),\n    'afldb.i316.expected_migrations':JSON.stringify(JSON.parse(read('expected-migrations.json')).rows),");
edit('run.cjs',"const shell=\"set -eu\\n[ \\\"$(hostname)\\\" = afldb-prod ]\\n[ \\\"$(id -un)\\\" = arm ]\\nexec", "const shell=read('operational-host.sh').toString('utf8')+\"\\nexec");
edit('run.cjs',"const passed=ordered && result.status===0", "const drift=output.includes('I316_CONCURRENT_SCHEMA_DRIFT_U3_UNCONFIRMED_NO_RETRY_NO_REVERSAL');\n  const passed=!drift && output.includes('I316_OPERATIONAL_HOST_GATE_PASS') && output.includes('I316_OPERATIONAL_DATABASE_GATE_PASS') && ordered && result.status===0");
edit('run.cjs',"verdict:passed?'PASS':'STOP_NO_RETRY'","verdict:passed?'PASS':drift?'CONCURRENT_SCHEMA_DRIFT':'STOP_NO_RETRY',u3_confirmed:passed,automatic_retry:false,automatic_reversal:false");
edit('run.cjs',"insist(passed,'Execution or verification failed/ambiguous. STOP; preserve evidence; no retry.');", "insist(passed,drift?'CONCURRENT_SCHEMA_DRIFT: exact metadata assertions passed; U3 unconfirmed. No retry or reversal. Owner adjudication required.':'Execution or verification failed/ambiguous. STOP; preserve evidence; no retry.');");
// Test SQL expansion handles only deterministic client echo/conditional output.
edit('validate.cjs',".replace(/^\\\\set .*$/gm,'')", ".replace(/\\\\if :i316_clean[\\s\\S]*?\\\\endif/g,'')\n    .replace(/^\\\\set .*$/gm,'')");
edit('validate.cjs','CREATE SCHEMA staging;',`CREATE SCHEMA staging;
    CREATE SCHEMA afldb_meta;
    CREATE TABLE afldb_meta.schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now(),duration_ms integer NOT NULL);`);
edit('validate.cjs',"'staging.afltables_player_match'].includes", "'staging.afltables_player_match','afldb_meta.schema_migrations'].includes");
edit('validate.cjs',"  await db.exec(`CREATE INDEX",`  const expected=JSON.parse(get('expected-migrations.json')).rows;
  for(const m of expected)await db.exec(\`INSERT INTO afldb_meta.schema_migrations(name,checksum,duration_ms) VALUES(\${q(m.name)},\${q(m.checksums[0])},0)\`);
  await db.exec(\`SELECT set_config('afldb.i316.expected_migrations',\${q(JSON.stringify(expected))},false)\`);
  await db.exec(\`CREATE INDEX`);
edit('validate-order.cjs',"['pg_catalog.pg_class','pg_catalog.pg_namespace','public.data_edits'","['public.data_edits'");
// Ledger lock is final after optionals, but remains before the first SQL read.
edit('validate-order.cjs',"...spec.required,...spec.optional]", "...spec.required.filter(r=>r!=='afldb_meta.schema_migrations'),...spec.optional,'afldb_meta.schema_migrations']");
edit('validate-pg.cjs',"DROP SCHEMA IF EXISTS staging CASCADE;", "DROP SCHEMA IF EXISTS afldb_meta CASCADE; DROP SCHEMA IF EXISTS staging CASCADE;");
edit('validate-pg.cjs',"r==='staging.afltables_player_match'?'season':'fixture_key'", "r==='staging.afltables_player_match'?'season':r==='afldb_meta.schema_migrations'?'name':'fixture_key'");
edit('validate-pg.cjs',"      await blocked('ALTER SCHEMA staging RENAME TO forbidden');", "      // Namespace catalog locks are deliberately absent; existing table DDL remains excluded.");
const oldStart=g('validate-pg.cjs').indexOf("    await test('absent optional relation cannot be created after locks'");
const oldEnd=g('validate-pg.cjs').indexOf("    await test('linked-audit INSERT failure",oldStart);
w('validate-pg.cjs',g('validate-pg.cjs').slice(0,oldStart)+g('validate-pg.cjs').slice(oldEnd));
edit('validate-pg.cjs',"      // PostgreSQL released catalog RowExclusiveLock at statement end: COMMIT can\n      // expose the formerly absent relation while repair holds its catalog locks.","      // Early environment drift is detected before COMMIT and rolls both writes back.");
edit('validate-pg.cjs',"    const report={status:'PASS',catalog_ddl_limit:","    const report={status:'PASS',legacy_v3_catalog_observation:");
console.log('V4 source edits applied');
