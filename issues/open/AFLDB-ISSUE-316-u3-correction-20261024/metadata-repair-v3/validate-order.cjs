'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const get=n=>fs.readFileSync(path.join(__dirname,n),'utf8');
function validateOrder() {
  const repair=get('repair.sql'), locks=get('locks.sql'), spec=JSON.parse(get('protected.json'));
  const prefix=repair.split('\\ir identity.sql')[0];
  assert(prefix.includes('\\ir locks.sql'));
  const clean=s=>s.replace(/--[^\n]*/g,'').replace(/^\\echo .*$/gm,'').trim();
  const statements=clean(prefix.replace('\\ir locks.sql',locks)).split(/;|\n/).map(s=>s.trim()).filter(Boolean);
  for(const statement of statements) assert(
    /^(\\set ON_ERROR_STOP on|BEGIN ISOLATION LEVEL SERIALIZABLE|SET LOCAL (lock_timeout='2s'|statement_timeout='10min'|idle_in_transaction_session_timeout='2min'|timezone='UTC'|search_path=pg_catalog,public)|LOCK TABLE [a-z_., ]+ IN SHARE( ROW EXCLUSIVE)? MODE|\\if :i316_optional_[01]|\\endif)$/.test(statement),
    'Unexpected pre-lock statement: '+statement);
  const actual=[...clean(locks).matchAll(/LOCK TABLE ([a-z_., ]+) IN (SHARE(?: ROW EXCLUSIVE)?) MODE/g)]
    .flatMap(m=>m[1].split(',').map(r=>({relation:r.trim(),mode:m[2]})));
  const expected=['pg_catalog.pg_class','pg_catalog.pg_namespace','public.data_edits','public.auth_users',...spec.required,...spec.optional];
  assert.deepEqual(actual.map(x=>x.relation),expected);
  assert(actual.every(x=>x.mode===(x.relation==='public.data_edits'?'SHARE ROW EXCLUSIVE':'SHARE')));
  assert(!/\b(DO|SELECT|CALL|to_regclass|regclass)\b/.test(clean(locks)));
  for(const read of ['lock-assert.sql','checks.sql','canonical-gates.sql','snapshot.sql'])
    assert(repair.indexOf('\\ir '+read)>repair.indexOf('I316_PROTECTED_LOCKS_ACQUIRED'));
  const markers=['I316_TRANSACTION_BEGUN','I316_PROTECTED_LOCKS_ACQUIRED','I316_POST_LOCK_GUARDS_PASSED',
    'I316_BEFORE_STATE_CAPTURED','I316_METADATA_WRITES_COMPLETED','I316_IN_TRANSACTION_ASSERTIONS_PASSED','I316_COMMIT_ACKNOWLEDGED'];
  let last=-1;
  for(const marker of markers) { const at=repair.indexOf('\\echo '+marker); assert(at>last); last=at; }
  assert(repair.indexOf('COMMIT;')<repair.indexOf('\\echo I316_COMMIT_ACKNOWLEDGED'));
  assert(get('postcheck.sql').indexOf('COMMIT;')<get('postcheck.sql').indexOf('I316_POSTCOMMIT_VERIFICATION_PASSED'));
  return {status:'PASS',protected_relations:spec.required.length+spec.optional.length,
    scope:'Static ordering/inventory only. Does not simulate locks or snapshots.'};
}
if(require.main===module) console.log(JSON.stringify(validateOrder(),null,2));
module.exports={validateOrder};
