'use strict';
// Fresh private PostgreSQL cluster only: Unix socket plus a loopback-only private port for the real
// password transport. No DSN from any environment, shared server, application env, rebuild driver,
// migration, production identity override or production wrapper. The fixture password is random,
// per run, and is asserted absent from every argv, log and retained evidence file.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {spawnSync,spawn}=require('node:child_process');
const postgres=require('postgres');
const {seed,sql,noRepair,refuses}=require('./validate.cjs');
const {validateOrder}=require('./validate-order.cjs');
const dir=__dirname;
const get=n=>fs.readFileSync(path.join(dir,n),'utf8');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Every repair stream below includes the exact shared principal.sql; only identity.sql is excluded.
const S=(name,optional=[false,false])=>sql(name,false,optional,true);
const PORT=55865,DB='i316_v5_test';
// RFC 5802/7677 verifier as PostgreSQL stores it (ASCII passwords: SASLprep is the identity).
function scram(password) {
  const salt=crypto.randomBytes(16),salted=crypto.pbkdf2Sync(Buffer.from(password,'utf8'),salt,4096,32,'sha256');
  const hmac=(key,text)=>crypto.createHmac('sha256',key).update(text).digest();
  const stored=crypto.createHash('sha256').update(hmac(salted,'Client Key')).digest();
  return 'SCRAM-SHA-256$4096:'+salt.toString('base64')+'$'+stored.toString('base64')+':'+hmac(salted,'Server Key').toString('base64');
}
const ENV_ALLOW=['HOME','LC_ALL','PATH','PGAPPNAME','PGCONNECT_TIMEOUT','PGDATABASE','PGHOST','PGOPTIONS','PGPASSWORD','PGPORT','PGUSER'];
async function main() {
  assert.equal(process.platform,'linux','Run this isolated test on Linux');
  const bin=process.argv[2];
  assert(bin && path.isAbsolute(bin),'Pass absolute PostgreSQL 16 bin directory');
  const version=spawnSync(path.join(bin,'postgres'),['--version'],{encoding:'utf8',timeout:10000});
  assert.equal(version.status,0); assert(/PostgreSQL\) 16\./.test(version.stdout));
  const work=fs.mkdtempSync(path.join(os.tmpdir(),'i316-v5-pg-'));
  fs.chmodSync(work,0o700);
  const data=path.join(work,'data'),socket=path.join(work,'socket'),credentials=path.join(work,'credentials');
  fs.mkdirSync(socket,{mode:0o700});fs.mkdirSync(credentials,{mode:0o700});
  // Random per-run fixture passwords; '/', ':' and '@' exercise percent-decoding in transport.sh.
  const ownerPassword='i316v5/'+crypto.randomBytes(18).toString('hex')+':x@y';
  const importPassword='i316v5-import-'+crypto.randomBytes(12).toString('hex');
  const secrets=[ownerPassword,encodeURIComponent(ownerPassword),importPassword];
  const clusterCommands=[];
  const command=(name,args)=>{
    const r=spawnSync(path.join(bin,name),args,{encoding:'utf8',timeout:30000});
    clusterCommands.push({name,args,status:r.status,error:r.error?.code||null,stdout:r.stdout,stderr:r.stderr});
    assert.equal(r.status,0,name+' failed: '+r.stderr);return r;
  };
  const results=[],clients=new Set();
  let started=false,serverPid=null;
  function client(label,user='afldb_owner') {
    const c=postgres({host:socket,port:PORT,user,database:DB,
      max:1,prepare:false,fetch_types:false,connect_timeout:5,idle_timeout:0,
      connection:{application_name:label},onnotice:()=>{}});
    clients.add(c);
    return {exec:text=>c.unsafe(text,[],{simple:true}),query:async text=>({rows:await c.unsafe(text,[],{simple:true})}),
      close:async()=>{await c.end({timeout:2});clients.delete(c);}};
  }
  const pre=db=>db.exec(S('preflight.sql'));
  const repair=db=>db.exec(S('repair.sql'));
  const post=db=>db.exec(S('postcheck.sql'));
  let a,b,observer;
  // Production ACL state observed by read-only discovery (grant order reproduces the exact aclitem text).
  async function productionAcl(db) {
    await db.exec(`GRANT SELECT, INSERT ON public.data_edits TO afldb_auth;
      GRANT SELECT, INSERT ON public.data_edits TO afldb_import;
      GRANT USAGE ON SEQUENCE public.data_edits_id_seq TO afldb_import;
      GRANT USAGE, SELECT ON SEQUENCE public.data_edits_id_seq TO afldb_auth;`);
  }
  async function fresh() {
    for(const db of [a,b]) if(db) await db.exec('ROLLBACK');
    await observer.exec(`DROP SCHEMA IF EXISTS afldb_meta CASCADE; DROP SCHEMA IF EXISTS staging CASCADE; DROP SCHEMA public CASCADE;
      CREATE SCHEMA public AUTHORIZATION afldb_owner; GRANT USAGE ON SCHEMA public TO PUBLIC;`);
    a=await seed(async()=>client('i316-repair'));
    await productionAcl(a);
    b=client('i316-writer');
  }
  async function test(name,fn) {
    console.log('START '+name);
    await fresh(); const t=Date.now();
    try{await fn();}catch(error){console.error('FAIL '+name,error);throw error;}
    results.push({name,status:'PASS',duration_ms:Date.now()-t});
    console.log('PASS '+name);
    await a.close(); await b.close(); a=b=null;
  }
  async function waitForRepairLock() {
    const until=Date.now()+1500;
    while(Date.now()<until) {
      const r=await observer.query("SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.application_name='i316-repair' AND l.locktype='relation' AND NOT l.granted");
      if(r.rows.length)return; await sleep(20);
    }
    throw Error('Repair did not enter observable lock wait');
  }
  async function blocked(statement) {
    await b.exec("BEGIN; SET LOCAL lock_timeout='150ms';");
    await assert.rejects(()=>b.exec(statement),e=>e.code==='55P03');
    await b.exec('ROLLBACK');
  }
  // Real transport.sh + real psql, as composed by run.cjs, with fixture arguments in place of the
  // production ones. The inherited environment carries decoys that must never reach psql.
  const envFile=(name,body,mode=0o600)=>{const p=path.join(credentials,name);fs.writeFileSync(p,body,{mode});fs.chmodSync(p,mode);return p;};
  const ownerDsn=`postgresql://afldb_owner:${encodeURIComponent(ownerPassword)}@127.0.0.1:${PORT}/${DB}`;
  const goodEnv=()=>envFile('good.env',`DATABASE_URL=postgresql://afldb_app:decoy-app@127.0.0.1:${PORT}/${DB}\nAFLDB_PROD_DATABASE_URL=${ownerDsn}\nAFLDB_OWNER_DATABASE_URL=${ownerDsn}\n`);
  function transportScript(mode,file,prefix='set -u -o pipefail\nexport LC_ALL=C\n') {
    return prefix+get('transport.sh')+`\ni316_transport ${mode} ${file} AFLDB_PROD_DATABASE_URL afldb_owner 127.0.0.1 ${PORT} ${DB}\n`;
  }
  function runShell(script,input,{watch=false}={}) {
    return new Promise((resolve,reject)=>{
      const child=spawn('/bin/bash',['-c',script],{env:{PATH:'/usr/bin:/bin',HOME:os.homedir(),I316_DECOY_SECRET:'decoy-secret',
        PGPASSWORD:'decoy-inherited-password',PGSERVICE:'decoy-service',DATABASE_URL:'postgresql://decoy:decoy@203.0.113.1/decoy'},stdio:['pipe','pipe','pipe']});
      let stdout='',stderr='',watched=null;
      child.stdout.on('data',d=>{stdout+=d;});child.stderr.on('data',d=>{stderr+=d;});
      child.on('error',reject);
      child.on('close',(status,signal)=>resolve({status,signal,stdout,stderr,watched}));
      child.stdin.end(input);
      if(watch){(async()=>{
        // While psql is connected (pg_sleep), inspect the exec'd process and every argv on the host.
        const until=Date.now()+4000;
        while(Date.now()<until&&!watched){
          // Wait for the exec'd real psql image (bash -c, then any pg_wrapper stage, keep the same PID).
          let cmd='',exe='';try{exe=fs.readlinkSync('/proc/'+child.pid+'/exe');cmd=fs.readFileSync('/proc/'+child.pid+'/cmdline','utf8');}catch{}
          if(/\/psql$/.test(exe)){
            const environ=fs.readFileSync('/proc/'+child.pid+'/environ','utf8').split('\0').filter(Boolean);
            const keys=environ.map(e=>e.slice(0,e.indexOf('='))).sort();
            const passwordEntry=environ.find(e=>e.startsWith('PGPASSWORD='));
            const leaks=[];
            for(const pid of fs.readdirSync('/proc').filter(n=>/^\d+$/.test(n))){
              let c;try{c=fs.readFileSync('/proc/'+pid+'/cmdline','utf8');}catch{continue;}
              if(secrets.some(s=>c.includes(s)))leaks.push(Number(pid));
            }
            const environMode=(fs.statSync('/proc/'+child.pid+'/environ').mode&0o777).toString(8);
            const value=k=>{const e=environ.find(x=>x.startsWith(k+'='));return e===undefined?null:e.slice(k.length+1);};
            watched={exe,cmdline:cmd.split('\0').filter(Boolean),environ_keys:keys,platform_added:{SHLVL:value('SHLVL'),PGSYSCONFDIR:value('PGSYSCONFDIR')},password_only_in_PGPASSWORD:passwordEntry==='PGPASSWORD='+ownerPassword,
              environ_mode:environMode,argv_leak_pids:leaks,decoys_absent:!environ.some(e=>/decoy/.test(e))};
          }
          await sleep(25);
        }
      })().catch(reject);}
    });
  }
  const noSecret=(label,...texts)=>{for(const t of texts)for(const s of secrets)assert(!String(t).includes(s),label+': credential value leaked');};
  try {
    command('initdb',['-D',data,'-U','i316_fixture_owner','--auth-local=trust','--auth-host=scram-sha-256','--no-locale','--encoding=UTF8']);
    fs.appendFileSync(path.join(data,'postgresql.conf'),"\nlisten_addresses='127.0.0.1'\nunix_socket_directories='"+socket+"'\nport="+PORT+"\ncluster_name='i316-v5-private'\npassword_encryption='scram-sha-256'\n");
    command('pg_ctl',['-D',data,'-l',path.join(work,'server.log'),'-w','start']);started=true;
    serverPid=Number(fs.readFileSync(path.join(data,'postmaster.pid'),'utf8').split('\n')[0]);
    // Production role model (tools/maintenance/00_install_postgres_prod.sh) and discovered attributes.
    // Passwords are sent only as precomputed SCRAM-SHA-256 verifiers: no plaintext reaches the server or its log.
    const boot=postgres({host:socket,port:PORT,user:'i316_fixture_owner',database:'postgres',max:1,prepare:false,fetch_types:false,onnotice:()=>{}});
    clients.add(boot);
    await boot.unsafe(`CREATE ROLE afldb_owner LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB PASSWORD '${scram(ownerPassword)}';
      CREATE ROLE afldb_app LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB;
      CREATE ROLE afldb_import LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB PASSWORD '${scram(importPassword)}';
      CREATE ROLE afldb_auth LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB;
      CREATE ROLE afldb_backup LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB;
      GRANT pg_read_all_data TO afldb_backup;`,[],{simple:true});
    await boot.unsafe(`CREATE DATABASE ${DB} OWNER afldb_owner`,[],{simple:true});
    await boot.end({timeout:2});clients.delete(boot);
    observer=client('i316-observer','i316_fixture_owner');
    const facts=(await observer.query("SELECT current_database() db,current_setting('data_directory') data,current_setting('cluster_name') cluster,current_setting('listen_addresses') listen,current_setting('server_version') version,current_setting('update_process_title') upt")).rows[0];
    assert.equal(facts.db,DB); assert.equal(facts.data,data);
    assert.equal(facts.cluster,'i316-v5-private'); assert.equal(facts.listen,'127.0.0.1'); assert.equal(facts.upt,'on');
    const hba=fs.readFileSync(path.join(data,'pg_hba.conf'),'utf8').split('\n').filter(l=>/^\s*(local|host)/.test(l));
    assert(hba.every(l=>/^local\s/.test(l)?/trust\s*$/.test(l):/scram-sha-256\s*$/.test(l)),'Unexpected private pg_hba');
    results.push({name:'exact pre-lock ordering and unchanged protected inventory',...validateOrder()});

    // ---- Inherited v4 real-PostgreSQL cases, now run as the pinned non-superuser afldb_owner ----
    await test('active Brownlow writer commits while repair waits: fresh guard refuses; zero metadata writes',async()=>{
      await pre(a);
      await b.exec("BEGIN; UPDATE public.brownlow_round_votes SET retained_value='{}';");
      const pending=repair(a).then(()=>({ok:true}),error=>({error}));
      await waitForRepairLock();await b.exec('COMMIT');
      const outcome=await pending;assert(outcome.error);assert.match(outcome.error.message,/state drift after read-only preflight/);
      await a.exec('ROLLBACK'); await noRepair(a);
      assert.deepEqual((await a.query('SELECT retained_value FROM brownlow_round_votes')).rows[0].retained_value,{});
    });
    await test('active protected writer exceeds approved two-second lock timeout: zero metadata writes',async()=>{
      await pre(a);await b.exec("BEGIN; UPDATE public.player_career_stats SET retained_value='{}';");
      const t=Date.now();await refuses(a,()=>repair(a),/lock timeout/);
      const ms=Date.now()-t;assert(ms>=1800&&ms<6000,'Unbounded/incorrect lock timeout '+ms);
      await noRepair(a);await b.exec('ROLLBACK');
    });
    await test('writers and guarded DDL after all locks are excluded until repair commit',async()=>{
      const optional=JSON.parse(get('protected.json')).optional;
      for(const r of optional)await a.exec(`CREATE TABLE ${r}(fixture_key integer PRIMARY KEY,retained_value jsonb); INSERT INTO ${r} VALUES(1,'{"untouched":true}');`);
      await pre(a);
      const raw=S('repair.sql',[true,true]);
      const boundary=raw.indexOf('-- Production-only identity.');
      assert.equal(boundary,-1);
      const split=raw.indexOf('-- First runs after every plain LOCK');assert(split>0);
      assert(raw.indexOf('-- v5 exact database principal')>0 && raw.indexOf('-- v5 exact database principal')<split,'principal must run after locks, before lock assertion');
      await a.exec(raw.slice(0,split));
      const required=JSON.parse(get('protected.json')).required;
      for(const r of required.concat(optional)) {
        const key=r==='public.data_overrides'?'id':r==='public.matches'?'id':r==='public.player_match_stats'?'id':r==='staging.afltables_player_match'?'season':r==='afldb_meta.schema_migrations'?'name':'fixture_key';
        await blocked(`UPDATE ${r} SET ${key}=${key}`);
        await blocked(`DELETE FROM ${r} WHERE false`);
        const insertKey=r==='public.data_overrides'?'entity_type':key;
        await blocked(`INSERT INTO ${r}(${insertKey}) SELECT ${insertKey} FROM ${r} WHERE false`);
      }
      await blocked('UPDATE public.auth_users SET role=role WHERE id=1');
      await blocked('UPDATE public.data_edits SET note=note WHERE id=94');
      await blocked('DELETE FROM public.data_edits WHERE false');
      await blocked('INSERT INTO public.data_edits(table_name) SELECT table_name FROM public.data_edits WHERE false');
      await blocked('ALTER TABLE public.data_edits ADD COLUMN forbidden integer');
      await a.exec(raw.slice(split));await post(a);
      await b.exec("UPDATE public.brownlow_round_votes SET retained_value='{}'");
      assert.equal((await b.query('SELECT count(*)::integer n FROM data_edits')).rows[0].n,2);
    });
    await test('linked-audit INSERT failure rolls back preceding note UPDATE',async()=>{
      await pre(a);await a.exec("SELECT setval('data_edits_id_seq',94,false)");
      await refuses(a,()=>repair(a),/duplicate key/);await noRepair(a);
    });
    await test('successful two-write repair as afldb_owner; independent postcheck; second repair refuses',async()=>{
      await pre(a);await repair(a);await post(a);
      const audit=(await a.query("SELECT admin_user_id,new_values->>'database_session_user' s,new_values->>'database_current_user' c,new_values->>'execution_operator' op,new_values->>'approval_sha256' ap FROM data_edits WHERE field_group='audit_note_repair'")).rows;
      assert.equal(audit.length,1);assert.equal(audit[0].admin_user_id,1);assert.equal(audit[0].s,'afldb_owner');assert.equal(audit[0].c,'afldb_owner');
      assert.equal(audit[0].ap,JSON.parse(get('binding.json')).approval_sha256);
      assert.match(audit[0].op,/afldb_owner via the existing protected \.env credential, no sudo$/);
      await refuses(a,()=>repair(a),/target identity\/null guard refused/);
      assert.equal((await a.query('SELECT count(*)::integer n FROM data_edits')).rows[0].n,2);
    });
    await test('Brownlow mutation after commit is detected by independent postcheck',async()=>{
      await pre(a);await repair(a);await b.exec("UPDATE brownlow_round_votes SET retained_value='{}'");
      await refuses(a,()=>post(a),/protected canonical\/derived\/history\/Brownlow state changed/);
    });
    await test('extra audit-row mutation after commit is detected',async()=>{
      await pre(a);await repair(a);
      await b.exec("INSERT INTO data_edits(table_name,row_id,field_group,old_values,new_values,admin_user_id) VALUES('matches',17214,'unexpected','{}','{}',1)");
      await refuses(a,()=>post(a),/additional\/missing\/changed audit row refused/);
    });
    await test('pre-existing optional DDL commit is caught by in-transaction assertion; metadata rolls back',async()=>{
      await pre(a);
      await b.exec('BEGIN; CREATE TABLE public.brownlow_eligibility_decisions(id integer);');
      const raw=S('repair.sql');const split=raw.indexOf('-- Exactly two logical writes.');assert(split>0);
      await a.exec(raw.slice(0,split));
      await b.exec('COMMIT');
      await refuses(a,()=>a.exec(raw.slice(split)),/protected canonical\/derived\/history\/Brownlow state changed/);
      await noRepair(a);
      assert.equal((await a.query("SELECT to_regclass('public.brownlow_eligibility_decisions') IS NOT NULL present")).rows[0].present,true);
    });
    await test('optional CREATE after final assertions before COMMIT: exact repair commits, drift detected, U3 blocked, no retry or reversal',async()=>{
      await pre(a);
      const raw=S('repair.sql'),split=raw.lastIndexOf('COMMIT;');assert(split>0);
      await a.exec(raw.slice(0,split));
      const beforeDDL=(await a.query("SELECT current_setting('afldb.i316.receipt')::jsonb receipt")).rows[0].receipt;
      await b.exec('BEGIN; CREATE TABLE public.brownlow_eligibility_decisions(id integer); COMMIT;');
      await a.exec(raw.slice(split));
      await post(a);
      const status=(await a.query("SELECT current_setting('afldb.i316.environment_status') s")).rows[0].s;
      assert.equal(status,'CONCURRENT_SCHEMA_DRIFT');
      const receipt=(await a.query("SELECT current_setting('afldb.i316.receipt')::jsonb receipt")).rows[0].receipt;
      assert.deepEqual(receipt,beforeDDL);
      assert.equal((await a.query('SELECT count(*)::integer n FROM data_edits')).rows[0].n,2);
      assert.equal((await a.query('SELECT note FROM data_edits WHERE id=94')).rows[0].note,JSON.parse(get('binding.json')).note);
      const proof=(await a.query("SELECT current_setting('afldb.i316.before')::jsonb b,current_setting('afldb.i316.snapshot')::jsonb a")).rows[0];
      const optional=JSON.parse(get('protected.json')).optional;
      for(const r of Object.keys(proof.b.protected))if(!optional.includes(r))assert.deepEqual(proof.a.protected[r],proof.b.protected[r]);
      const authority=(await a.query('SELECT to_jsonb(o) value FROM public.data_overrides o WHERE id=93')).rows[0].value;
      assert.deepEqual(authority,JSON.parse(get('binding.json')).authority93);
      await post(a);assert.equal((await a.query('SELECT count(*)::integer n FROM data_edits')).rows[0].n,2);
      assert.equal((await a.query('SELECT note FROM data_edits WHERE id=94')).rows[0].note,JSON.parse(get('binding.json')).note);
    });
    await test('operational preflight refuses known active optional DDL and wrong schema version',async()=>{
      await b.exec('BEGIN; CREATE TABLE public.brownlow_eligibility_decisions(id integer);');
      await refuses(a,()=>pre(a),/active\/known DDL/);await noRepair(a);await b.exec('ROLLBACK');
      await b.exec("DELETE FROM afldb_meta.schema_migrations WHERE name=(SELECT max(name) FROM afldb_meta.schema_migrations)");
      await refuses(a,()=>pre(a),/migration\/schema version refused/);await noRepair(a);
    });

    // ---- v5 principal binding on real roles ----
    await test('v5 wrong session user refused: importer role and superuser',async()=>{
      for(const user of ['afldb_import','i316_fixture_owner']) {
        const other=client('i316-wrong-session-'+user,user);
        try{await refuses(other,()=>other.exec(S('preflight.sql')),/principal session\/current user refused/);}finally{await other.close();}
      }
      const su=client('i316-superuser-set-role','i316_fixture_owner');
      try{await refuses(su,()=>su.exec("BEGIN; SET LOCAL ROLE afldb_owner;\n"+get('principal.sql')),/principal session\/current user refused/);}finally{await su.close();}
      await noRepair(a);
    });
    await test('v5 wrong current user refused; any membership refused',async()=>{
      await observer.exec('GRANT afldb_app TO afldb_owner');
      try {
        await a.exec('SET ROLE afldb_app');
        await refuses(a,()=>a.exec(get('principal.sql')),/principal session\/current user refused/);
        await a.exec('RESET ROLE');
        await refuses(a,()=>a.exec(S('preflight.sql')),/principal role attributes\/membership refused/);
      } finally { await a.exec('RESET ROLE'); await observer.exec('REVOKE afldb_app FROM afldb_owner'); }
      await pre(a); await noRepair(a);
    });
    await test('v5 unexpected role attribute or role setting refused',async()=>{
      for(const [change,undo] of [['ALTER ROLE afldb_owner CREATEROLE','ALTER ROLE afldb_owner NOCREATEROLE'],
        ['ALTER ROLE afldb_owner CREATEDB','ALTER ROLE afldb_owner NOCREATEDB'],
        ['ALTER ROLE afldb_owner BYPASSRLS','ALTER ROLE afldb_owner NOBYPASSRLS'],
        ["ALTER ROLE afldb_owner SET work_mem='8MB'",'ALTER ROLE afldb_owner RESET ALL']]) {
        await observer.exec(change);
        try{await refuses(a,()=>a.exec(S('preflight.sql')),/principal role attributes\/membership refused/);}finally{await observer.exec(undo);}
      }
      await pre(a); await noRepair(a);
    });
    await test('v5 unexpected privilege state refused',async()=>{
      for(const [change,undo,by] of [['GRANT pg_write_all_data TO afldb_app','REVOKE pg_write_all_data FROM afldb_app','observer'],
        ['GRANT INSERT ON public.data_edits TO afldb_app','REVOKE INSERT ON public.data_edits FROM afldb_app','owner'],
        ['GRANT UPDATE (note) ON public.data_edits TO afldb_import',null,'owner'],
        ['GRANT UPDATE ON SEQUENCE public.data_edits_id_seq TO afldb_auth',null,'owner']]) {
        await (by==='observer'?observer:a).exec(change);
        try{await refuses(a,()=>a.exec(S('preflight.sql')),/principal privilege state refused/);}finally{if(undo)await (by==='observer'?observer:a).exec(undo);}
        if(!undo){await fresh();}
      }
      await noRepair(a);
    });
    await test('v5 unexpected ownership state refused',async()=>{
      for(const relation of ['public.data_overrides','public.data_edits','public.brownlow_round_votes','afldb_meta.schema_migrations']) {
        await observer.exec(`ALTER TABLE ${relation} OWNER TO afldb_import`);
        try{await refuses(a,()=>a.exec(S('preflight.sql')),/principal ownership refused/);}finally{await observer.exec(`ALTER TABLE ${relation} OWNER TO afldb_owner`);}
        await fresh();
      }
      await observer.exec(`ALTER DATABASE ${DB} OWNER TO i316_fixture_owner`);
      try{await refuses(a,()=>a.exec(S('preflight.sql')),/principal ownership refused/);}finally{await observer.exec(`ALTER DATABASE ${DB} OWNER TO afldb_owner`);}
      await noRepair(a);
    });
    await test('v5 reduced activity visibility: other-role DDL still refused via locks; redaction tolerated only with process titles on',async()=>{
      const other=client('i316-other-role','i316_fixture_owner');
      try {
        await other.exec('BEGIN; CREATE TABLE public.zz_other_role(id integer);');
        const redacted=(await a.query("SELECT count(*)::integer n FROM pg_stat_activity WHERE usename='i316_fixture_owner' AND state IS NULL AND query='<insufficient privilege>'")).rows[0].n;
        assert(redacted>=1,'Other-role activity must be redacted for afldb_owner');
        await refuses(a,()=>pre(a),/active\/known DDL/);await noRepair(a);
        await other.exec('ROLLBACK');
        await other.exec('BEGIN; SELECT count(*) FROM public.matches;');
        await pre(a); await a.exec('ROLLBACK');
        await other.exec('ROLLBACK');
      } finally { await other.close(); }
      await observer.exec(`ALTER DATABASE ${DB} SET update_process_title=off`);
      const late=client('i316-visibility-off');
      try{await refuses(late,()=>late.exec(S('preflight.sql')),/operational visibility inadequate/);}finally{await late.close();await observer.exec(`ALTER DATABASE ${DB} RESET update_process_title`);}
      await noRepair(a);
    });

    // ---- v5 real transport: transport.sh + /usr/bin/psql over loopback password authentication ----
    await test('v5 transport: pinned principal accepted, prerequisite session read-only, credential only in PGPASSWORD',async()=>{
      const file=goodEnv();
      const probe=get('principal.sql')+"SELECT 'I316_T=' || session_user || '|' || current_user || '|' || current_setting('transaction_read_only') || '|' || current_setting('application_name') || '|' || current_setting('lock_timeout') || '|' || COALESCE(inet_client_addr()::text,'socket');\nSELECT pg_sleep(1.5);\nUPDATE public.data_edits SET note=note WHERE false;\n";
      const r=await runShell(transportScript('prerequisite',file),probe,{watch:true});
      noSecret('prerequisite transport',r.stdout,r.stderr,JSON.stringify(r.watched));
      assert.equal(r.status,3,'ON_ERROR_STOP must stop the read-only write probe: '+r.stderr);
      assert(r.stdout.split('\n').includes(`I316_TRANSPORT_PREREQUISITES_PASS mode=prerequisite user=afldb_owner host=127.0.0.1 port=${PORT} database=${DB}`));
      assert.match(r.stdout,/^I316_PRINCIPAL=.*"session_user": "afldb_owner"/m);
      assert(r.stdout.split('\n').includes('I316_T=afldb_owner|afldb_owner|on|afldb-i316-metadata-repair-v5-prerequisite|2s|127.0.0.1/32'));
      assert.match(r.stderr,/read-only transaction/);
      assert(r.watched,'psql process was not observed');
      assert(r.watched.cmdline.some(x=>/psql$/.test(x))&&r.watched.cmdline.includes('-X')&&r.watched.cmdline.includes('-f')&&r.watched.cmdline.includes('-'));
      assert.deepEqual(r.watched.argv_leak_pids,[],'credential in some process argv');
      assert.equal(r.watched.password_only_in_PGPASSWORD,true);
      assert.equal(r.watched.decoys_absent,true,'inherited decoy environment reached psql');
      // Beyond the transport allowlist, only platform-added, non-secret values: bash's exec sets SHLVL and the
      // Debian /usr/bin/psql wrapper (pg_wrapper, trusted platform) sets PGSYSCONFDIR before exec'ing real psql.
      assert.deepEqual(r.watched.environ_keys.filter(k=>!['_','SHLVL','PGSYSCONFDIR'].includes(k)),ENV_ALLOW,'psql environment is not exactly the allowlist: '+JSON.stringify(r.watched.environ_keys));
      assert(r.watched.platform_added.SHLVL===null||/^\d+$/.test(r.watched.platform_added.SHLVL));
      assert(r.watched.platform_added.PGSYSCONFDIR===null||r.watched.platform_added.PGSYSCONFDIR==='/etc/postgresql-common');
      assert.equal(r.watched.environ_mode,'400');
      results.push({name:'transport observation',observed:{exe:r.watched.exe,cmdline:r.watched.cmdline,environ_keys:r.watched.environ_keys,
        platform_added:r.watched.platform_added,environ_mode:r.watched.environ_mode}});
      await noRepair(a);
    });
    await test('v5 transport: execute mode is write-capable with the same pinned principal',async()=>{
      const r=await runShell(transportScript('execute',goodEnv()),"SELECT 'I316_T=' || session_user || '|' || current_setting('transaction_read_only') || '|' || current_setting('application_name');\nUPDATE public.data_edits SET note=note WHERE false;\n");
      noSecret('execute transport',r.stdout,r.stderr);
      assert.equal(r.status,0,r.stderr);
      assert(r.stdout.split('\n').includes('I316_T=afldb_owner|off|afldb-i316-metadata-repair-v5-execute'));
      await noRepair(a);
    });
    await test('v5 transport: missing or non-matching credential prerequisites stop before any connection',async()=>{
      const importerDsn=`postgresql://afldb_import:${importPassword}@127.0.0.1:${PORT}/${DB}`;
      const cases=[
        ['credential_file_missing',path.join(credentials,'absent.env')],
        ['credential_file_permissions',envFile('wide.env',`AFLDB_PROD_DATABASE_URL=${ownerDsn}\n`,0o644)],
        ['credential_key_count',envFile('nokey.env',`AFLDB_OWNER_DATABASE_URL=${ownerDsn}\n`)],
        ['credential_key_count',envFile('dupkey.env',`AFLDB_PROD_DATABASE_URL=${ownerDsn}\nAFLDB_PROD_DATABASE_URL=${ownerDsn}\n`)],
        ['credential_principal_mismatch',envFile('importer.env',`AFLDB_PROD_DATABASE_URL=${importerDsn}\n`)],
        ['credential_principal_mismatch',envFile('port.env',`AFLDB_PROD_DATABASE_URL=${ownerDsn.replace(':'+PORT+'/',':5432/')}\n`)],
        ['credential_principal_mismatch',envFile('db.env',`AFLDB_PROD_DATABASE_URL=${ownerDsn.replace('/'+DB,'/postgres')}\n`)],
        ['credential_shape_refused',envFile('query.env',`AFLDB_PROD_DATABASE_URL=${ownerDsn}?sslmode=disable\n`)],
        ['credential_shape_refused',envFile('crlf.env',`AFLDB_PROD_DATABASE_URL=${ownerDsn}\r\n`)],
        ['credential_shape_refused',envFile('nopass.env',`AFLDB_PROD_DATABASE_URL=postgresql://afldb_owner@127.0.0.1:${PORT}/${DB}\n`)],
      ];
      for(const [reason,file] of cases) {
        const r=await runShell(transportScript('prerequisite',file),"SELECT 'I316_SHOULD_NOT_CONNECT';\n");
        noSecret('stop '+reason,r.stdout,r.stderr);
        assert.equal(r.status,1,reason+': '+r.stdout+r.stderr);
        assert(r.stdout.split('\n').includes('I316_TRANSPORT_STOP '+reason),reason+': '+r.stdout);
        assert(!r.stdout.includes('I316_TRANSPORT_PREREQUISITES_PASS')&&!r.stdout.includes('I316_SHOULD_NOT_CONNECT'),reason);
      }
      const sessions=(await observer.query("SELECT count(*)::integer n FROM pg_stat_activity WHERE application_name LIKE 'afldb-i316-metadata-repair-v5-%'")).rows[0].n;
      assert.equal(sessions,0);
    });
    await test('v5 transport: authentication failure is a connection prerequisite failure and echoes no credential',async()=>{
      const r=await runShell(transportScript('prerequisite',envFile('wrongpw.env',`AFLDB_PROD_DATABASE_URL=${ownerDsn.replace(encodeURIComponent(ownerPassword),'wrong-'+crypto.randomBytes(6).toString('hex'))}\n`)),"SELECT 'I316_SHOULD_NOT_CONNECT';\n");
      noSecret('wrong password',r.stdout,r.stderr);
      assert.equal(r.status,2,r.stderr);assert.match(r.stderr,/password authentication failed for user "afldb_owner"/);
      assert(!r.stdout.includes('I316_SHOULD_NOT_CONNECT'));
    });
    await test('v5 host gate refuses off-production before any transport; SQL stdin unread',async()=>{
      const r=await runShell(get('operational-host.sh')+'\n'+transportScript('execute',goodEnv(),''),"SELECT 'I316_SHOULD_NOT_CONNECT';\n");
      noSecret('host gate',r.stdout,r.stderr);
      assert.equal(r.status,1);assert.equal(r.stdout,'I316_OPERATIONAL_HOST_STOP host_mismatch\n');assert.equal(r.stderr,'');
    });
    const report={status:'PASS',contract:'v5: inherited v4 real-PostgreSQL cases as non-superuser afldb_owner with the exact shared principal.sql; principal substitution/attribute/membership/privilege/ownership refusals on real roles; real transport.sh+psql over loopback scram-sha-256; credential never in argv/log/evidence.',
      engine:version.stdout.trim(),identity:facts,work_directory:work,
      scope:'Fresh private cluster (Unix socket trust for fixture setup, 127.0.0.1-only scram-sha-256 for transport) and synthetic shapes. Exact shared SQL excluding production-only identity.sql; psql client directives expanded for known fixture optional presence. No production transport/live-schema acceptance. No shared database touched.',
      completed_utc:new Date().toISOString(),passed:results.length,results};
    fs.writeFileSync(path.join(dir,'PG-VALIDATION.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
  } catch(error) {console.error('VALIDATION_FAILURE',error);throw error;} finally {
    await Promise.allSettled([...clients].map(c=>c.end({timeout:2})));
    try{fs.rmSync(credentials,{recursive:true,force:true});}catch{}
    const status=spawnSync(path.join(bin,'pg_ctl'),['-D',data,'status'],{encoding:'utf8',timeout:10000});
    let cleanupError=null,remainingPrivateProcesses=[];
    try {
      if(started||status.status===0)command('pg_ctl',['-D',data,'-w','-m','fast','stop']);
      const after=spawnSync(path.join(bin,'pg_ctl'),['-D',data,'status'],{encoding:'utf8',timeout:10000});
      assert.equal(after.status,3,'Private cluster still running or status ambiguous');
      assert(!fs.existsSync(path.join(data,'postmaster.pid')),'Private postmaster PID file remains');
      assert.deepEqual(fs.readdirSync(socket),[],'Private socket/lock remains');
      assert(!fs.existsSync(credentials),'Fixture credential files remain');
      if(serverPid)assert.throws(()=>process.kill(serverPid,0),e=>e.code==='ESRCH','Private postmaster PID remains live');
      for(const pid of fs.readdirSync('/proc').filter(n=>/^\d+$/.test(n))) {
        let cmd;try{cmd=fs.readFileSync('/proc/'+pid+'/cmdline','utf8');}catch(error){if(['ENOENT','ESRCH','EACCES'].includes(error.code))continue;throw error;}
        if(cmd.includes(work)||cmd.startsWith('postgres: i316-v5-private:'))remainingPrivateProcesses.push(Number(pid));
      }
      assert.deepEqual(remainingPrivateProcesses,[],'Private PostgreSQL process remains');
    } catch(error) {cleanupError=error;}
    fs.writeFileSync(path.join(dir,'PG-CLUSTER-COMMANDS.json'),JSON.stringify(clusterCommands,null,2)+'\n');
    if(fs.existsSync(path.join(work,'server.log')))fs.copyFileSync(path.join(work,'server.log'),path.join(dir,'PG-SERVER.log'));
    // Retained evidence must never contain a credential value.
    let leak=null;
    for(const name of ['PG-VALIDATION.json','PG-CLUSTER-COMMANDS.json','PG-SERVER.log'])
      if(fs.existsSync(path.join(dir,name))&&secrets.some(s=>fs.readFileSync(path.join(dir,name),'utf8').includes(s)))leak=name;
    if(leak&&!cleanupError)cleanupError=new Error('Credential value found in retained evidence '+leak);
    const cleanup={status:cleanupError?'FAIL':'PASS',work_directory:work,socket,server_pid:serverPid,
      stopped_utc:new Date().toISOString(),remaining_private_processes:remainingPrivateProcesses,credential_files_removed:!fs.existsSync(credentials),
      evidence_credential_scan:leak?'FAIL':'PASS',error:cleanupError?.message||null,
      retained:'Stopped private data directory and server log; fixture credential files removed; no existing cluster touched'};
    fs.writeFileSync(path.join(dir,'PG-CLEANUP.json'),JSON.stringify(cleanup,null,2)+'\n');
    if(cleanupError)throw cleanupError;
    console.log('PRIVATE_CLUSTER_STOPPED_AND_SOCKET_ABSENT '+work);
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
