'use strict';
// Fresh private Unix-socket cluster only. No DSN, shared server, application env,
// rebuild driver, migration, production identity override or production wrapper.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const postgres=require('postgres');
const {seed,sql,noRepair,refuses}=require('./validate.cjs');
const {validateOrder}=require('./validate-order.cjs');
const dir=__dirname;
const get=n=>fs.readFileSync(path.join(dir,n),'utf8');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main() {
  assert.equal(process.platform,'linux','Run this isolated test on Linux');
  const bin=process.argv[2];
  assert(bin && path.isAbsolute(bin),'Pass absolute PostgreSQL 16 bin directory');
  const version=spawnSync(path.join(bin,'postgres'),['--version'],{encoding:'utf8',timeout:10000});
  assert.equal(version.status,0); assert(/PostgreSQL\) 16\./.test(version.stdout));
  const work=fs.mkdtempSync(path.join(os.tmpdir(),'i316-f004-pg-'));
  fs.chmodSync(work,0o700);
  const data=path.join(work,'data'),socket=path.join(work,'socket');
  fs.mkdirSync(socket,{mode:0o700});
  const clusterCommands=[];
  const command=(name,args)=>{
    const r=spawnSync(path.join(bin,name),args,{encoding:'utf8',timeout:30000});
    clusterCommands.push({name,args,status:r.status,error:r.error?.code||null,stdout:r.stdout,stderr:r.stderr});
    assert.equal(r.status,0,name+' failed: '+r.stderr);return r;
  };
  const results=[],clients=new Set();
  let started=false,serverPid=null;
  function client(label) {
    const c=postgres({host:socket,port:55864,user:'i316_fixture_owner',database:'i316_f004_test',
      max:1,prepare:false,fetch_types:false,connect_timeout:5,idle_timeout:0,
      connection:{application_name:label},onnotice:()=>{}});
    clients.add(c);
    return {exec:text=>c.unsafe(text,[],{simple:true}),query:async text=>({rows:await c.unsafe(text,[],{simple:true})}),
      close:async()=>{await c.end({timeout:2});clients.delete(c);}};
  }
  const pre=db=>db.exec(sql('preflight.sql'));
  const repair=db=>db.exec(sql('repair.sql'));
  const post=db=>db.exec(sql('postcheck.sql'));
  let a,b,observer;
  async function fresh() {
    for(const db of [a,b]) if(db) await db.exec('ROLLBACK');
    await observer.exec('DROP SCHEMA IF EXISTS afldb_meta CASCADE; DROP SCHEMA IF EXISTS staging CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    a=await seed(async()=>client('i316-repair'));
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
  try {
    command('initdb',['-D',data,'-U','i316_fixture_owner','--auth=trust','--no-locale','--encoding=UTF8']);
    fs.appendFileSync(path.join(data,'postgresql.conf'),"\nlisten_addresses=''\nunix_socket_directories='"+socket+"'\nport=55864\ncluster_name='i316-f004-private'\n");
    command('pg_ctl',['-D',data,'-l',path.join(work,'server.log'),'-w','start']);started=true;
    serverPid=Number(fs.readFileSync(path.join(data,'postmaster.pid'),'utf8').split('\n')[0]);
    command('createdb',['-h',socket,'-p','55864','-U','i316_fixture_owner','i316_f004_test']);
    observer=client('i316-observer');
    const facts=(await observer.query("SELECT current_database() db,current_setting('data_directory') data,current_setting('cluster_name') cluster,inet_server_addr() addr,current_setting('server_version') version")).rows[0];
    assert.equal(facts.db,'i316_f004_test'); assert.equal(facts.data,data);
    assert.equal(facts.cluster,'i316-f004-private'); assert.equal(facts.addr,null);
    results.push({name:'exact pre-lock ordering and unchanged protected inventory',...validateOrder()});
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
      const raw=sql('repair.sql',false,[true,true]);
      // Exact executable prefix through its last lock. No repair-side observer SELECT.
      const boundary=raw.indexOf('-- Production-only identity.');
      // Identity is intentionally excluded by sql(); split at the first held-lock assertion.
      assert.equal(boundary,-1);
      const split=raw.indexOf('-- First runs after every plain LOCK');assert(split>0);
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
      // Namespace catalog locks are deliberately absent; existing table DDL remains excluded.
      await a.exec(raw.slice(split));await post(a);
      await b.exec("UPDATE public.brownlow_round_votes SET retained_value='{}'");
      assert.equal((await b.query('SELECT count(*)::integer n FROM data_edits')).rows[0].n,2);
    });
    await test('linked-audit INSERT failure rolls back preceding note UPDATE',async()=>{
      await pre(a);await a.exec("SELECT setval('data_edits_id_seq',94,false)");
      await refuses(a,()=>repair(a),/duplicate key/);await noRepair(a);
    });
    await test('successful two-write repair; independent postcheck; second repair refuses',async()=>{
      await pre(a);await repair(a);await post(a);
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
      const raw=sql('repair.sql');const split=raw.indexOf('-- Exactly two logical writes.');assert(split>0);
      // Run every repair guard with the DDL transaction still uncommitted.
      await a.exec(raw.slice(0,split));
      // Early environment drift is detected before COMMIT and rolls both writes back.
      await b.exec('COMMIT');
      await refuses(a,()=>a.exec(raw.slice(split)),/protected canonical\/derived\/history\/Brownlow state changed/);
      await noRepair(a);
      assert.equal((await a.query("SELECT to_regclass('public.brownlow_eligibility_decisions') IS NOT NULL present")).rows[0].present,true);
    });
    await test('optional CREATE after final assertions before COMMIT: exact repair commits, drift detected, U3 blocked, no retry or reversal',async()=>{
      await pre(a);
      const raw=sql('repair.sql'),split=raw.lastIndexOf('COMMIT;');assert(split>0);
      // Test-only synchronization: execution pauses after ALL final assertions.
      // Nothing is injected into or enabled in the production repair.
      await a.exec(raw.slice(0,split));
      const beforeDDL=(await a.query("SELECT current_setting('afldb.i316.receipt')::jsonb receipt")).rows[0].receipt;
      await b.exec('BEGIN; CREATE TABLE public.brownlow_eligibility_decisions(id integer); COMMIT;');
      await a.exec(raw.slice(split));
      // Fresh real postcheck executes exact metadata/authority/existing-data assertions.
      await post(a);
      const status=(await a.query("SELECT current_setting('afldb.i316.environment_status') s")).rows[0].s;
      assert.equal(status,'CONCURRENT_SCHEMA_DRIFT');
      const receipt=(await a.query("SELECT current_setting('afldb.i316.receipt')::jsonb receipt")).rows[0].receipt;
      assert.deepEqual(receipt,beforeDDL);
      assert.equal((await a.query('SELECT count(*)::integer n FROM data_edits')).rows[0].n,2);
      assert.equal((await a.query('SELECT note FROM data_edits WHERE id=94')).rows[0].note,JSON.parse(get('binding.json')).note);
      // Independent strict comparison for all pre-existing protected relations,
      // including all four required Brownlow tables and the authority ledger.
      const proof=(await a.query("SELECT current_setting('afldb.i316.before')::jsonb b,current_setting('afldb.i316.snapshot')::jsonb a")).rows[0];
      const optional=JSON.parse(get('protected.json')).optional;
      for(const r of Object.keys(proof.b.protected))if(!optional.includes(r))assert.deepEqual(proof.a.protected[r],proof.b.protected[r]);
      const authority=(await a.query('SELECT to_jsonb(o) value FROM public.data_overrides o WHERE id=93')).rows[0].value;
      assert.deepEqual(authority,JSON.parse(get('binding.json')).authority93);
      // Postcheck is read-only: repeated observation cannot retry/reverse the repair.
      await post(a);assert.equal((await a.query('SELECT count(*)::integer n FROM data_edits')).rows[0].n,2);
      assert.equal((await a.query('SELECT note FROM data_edits WHERE id=94')).rows[0].note,JSON.parse(get('binding.json')).note);
    });
    await test('operational preflight refuses known active optional DDL and wrong schema version',async()=>{
      await b.exec('BEGIN; CREATE TABLE public.brownlow_eligibility_decisions(id integer);');
      await refuses(a,()=>pre(a),/active\/known DDL/);await noRepair(a);await b.exec('ROLLBACK');
      await b.exec("DELETE FROM afldb_meta.schema_migrations WHERE name=(SELECT max(name) FROM afldb_meta.schema_migrations)");
      await refuses(a,()=>pre(a),/migration\/schema version refused/);await noRepair(a);
    });
    const report={status:'PASS',revised_f005_contract:'No catalog locks. An optional CREATE beyond the final assertion may commit independently. Real synchronized late-DDL test proves exact metadata commit, unchanged authority and existing protected rows, CONCURRENT_SCHEMA_DRIFT and no retry/reversal. Earlier visible DDL causes rollback.',engine:version.stdout.trim(),identity:facts,work_directory:work,
      scope:'Fresh private Unix-socket PostgreSQL cluster and synthetic shapes. Exact shared SQL excluding production-only identity; psql client directives expanded for known fixture optional presence. No production transport/live-schema acceptance. No rebuild or shared database touched.',
      completed_utc:new Date().toISOString(),passed:results.length,results};
    fs.writeFileSync(path.join(dir,'PG-VALIDATION.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
  } catch(error) {console.error('VALIDATION_FAILURE',error);throw error;} finally {
    await Promise.allSettled([...clients].map(c=>c.end({timeout:2})));
    // Check our exact private data directory even if startup returned an error.
    const status=spawnSync(path.join(bin,'pg_ctl'),['-D',data,'status'],{encoding:'utf8',timeout:10000});
    let cleanupError=null,remainingPrivateProcesses=[];
    try {
      if(started||status.status===0)command('pg_ctl',['-D',data,'-w','-m','fast','stop']);
      const after=spawnSync(path.join(bin,'pg_ctl'),['-D',data,'status'],{encoding:'utf8',timeout:10000});
      assert.equal(after.status,3,'Private cluster still running or status ambiguous');
      assert(!fs.existsSync(path.join(data,'postmaster.pid')),'Private postmaster PID file remains');
      assert.deepEqual(fs.readdirSync(socket),[],'Private socket/lock remains');
      if(serverPid)assert.throws(()=>process.kill(serverPid,0),e=>e.code==='ESRCH','Private postmaster PID remains live');
      for(const pid of fs.readdirSync('/proc').filter(n=>/^\d+$/.test(n))) {
        let cmd;try{cmd=fs.readFileSync('/proc/'+pid+'/cmdline','utf8');}catch(error){if(['ENOENT','ESRCH','EACCES'].includes(error.code))continue;throw error;}
        if(cmd.includes(work)||cmd.startsWith('postgres: i316-f004-private:'))remainingPrivateProcesses.push(Number(pid));
      }
      assert.deepEqual(remainingPrivateProcesses,[],'Private PostgreSQL process remains');
    } catch(error) {cleanupError=error;}
    const cleanup={status:cleanupError?'FAIL':'PASS',work_directory:work,socket,server_pid:serverPid,
      stopped_utc:new Date().toISOString(),remaining_private_processes:remainingPrivateProcesses,error:cleanupError?.message||null,
      retained:'Stopped private data directory and server log; no existing cluster touched'};
    fs.writeFileSync(path.join(dir,'PG-CLEANUP.json'),JSON.stringify(cleanup,null,2)+'\n');
    fs.writeFileSync(path.join(dir,'PG-CLUSTER-COMMANDS.json'),JSON.stringify(clusterCommands,null,2)+'\n');
    if(fs.existsSync(path.join(work,'server.log')))fs.copyFileSync(path.join(work,'server.log'),path.join(dir,'PG-SERVER.log'));
    if(cleanupError)throw cleanupError;
    console.log('PRIVATE_CLUSTER_STOPPED_AND_SOCKET_ABSENT '+work);
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
