'use strict';
// One-time derivation only. Refuses to overwrite an existing v5 directory. Frozen v4 is read, never written.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=__dirname,src=path.join(root,'metadata-repair-v4'),dst=path.join(root,'metadata-repair-v5');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=n=>fs.readFileSync(path.join(src,n),'utf8');
const pin='829fc30ae553106baa2281710bb7ba5c9288ccd331c0e846e18ed408848ecf84';
if(sha(fs.readFileSync(path.join(src,'MANIFEST.json')))!==pin)throw Error('Frozen v4 manifest mismatch');
const prior=JSON.parse(read('MANIFEST.json'));
for(const f of prior.files)if(sha(fs.readFileSync(path.join(src,f.path)))!==f.sha256)throw Error('Frozen v4 member mismatch '+f.path);
if(sha(fs.readFileSync(path.join(src,'REVIEW.md')))!=='c36dc24a0d4fac7f5aa5374e7a5b0a6ed7f9442334cad390a4cf078322374712')throw Error('v4 review report mismatch');
const observation=path.join(root,'metadata-repair-v4-unprivileged-observation-20261025','operational-observation-v2.sh');
if(sha(fs.readFileSync(observation))!=='8ac6c6fea81743595418139bb257903ee8b2bd23881cc66615b4f49fd9e095dc')throw Error('Passed observation script mismatch');
fs.mkdirSync(dst);
// Dropped: v4 candidate transport attempt, v4 validation reports (regenerated), v4 derivation/review pins.
const dropped=/^(PG-|VALIDATION|WRAPPER-VALIDATION|DERIVATION\.json$)/;
for(const f of prior.files)if(!dropped.test(f.path))fs.copyFileSync(path.join(src,f.path),path.join(dst,f.path));
fs.copyFileSync(path.join(src,'REVIEW.md'),path.join(dst,'V4-REVIEW.md'));
fs.copyFileSync(observation,path.join(dst,'operational-observation.sh'));
const put=(n,s)=>fs.writeFileSync(path.join(dst,n),s);
function once(name,from,to,text=read(name)) {
  const at=text.indexOf(from);
  if(at<0||text.indexOf(from,at+1)>=0)throw Error('Edit anchor not unique in '+name+': '+from.slice(0,60));
  return text.slice(0,at)+to+text.slice(at+from.length);
}
put('identity.sql',once('identity.sql',"OR current_user <> 'postgres' OR session_user <> 'postgres'","OR current_user <> 'afldb_owner' OR session_user <> 'afldb_owner'"));
for(const n of ['preflight.sql','repair.sql','postcheck.sql'])put(n,once(n,'\\ir identity.sql\n','\\ir identity.sql\n\\ir principal.sql\n'));
put('repair-body.sql',once('repair-body.sql',"'Codex, delegated by the retained owner instruction; SSH arm -> sudo postgres'",
  "'Claude Code (claude-opus-5-5), delegated by the retained owner instruction; SSH arm -> afldb_owner via the existing protected .env credential, no sudo'"));
put('operational-guard.sql',once('operational-guard.sql',"SELECT 'I316_OPERATIONAL_DATABASE_GATE_PASS';\n",
`-- v5 principal visibility, required by the afldb_owner transport. A non-superuser without
-- pg_read_all_stats sees state/query only for its own role's sessions, so the text checks above
-- cover afldb_owner sessions only. pg_locks and pg_prepared_xacts above remain fully visible.
-- Redacted sessions are tolerated only while update_process_title=on: the condition under which the
-- no-sudo host gate's PostgreSQL process-title scan, run in the same remote session immediately
-- before psql, is meaningful. Otherwise do not execute.
DO $visibility$
BEGIN
 IF NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user)
 AND NOT pg_catalog.pg_has_role(current_user,'pg_read_all_stats','USAGE')
 AND current_setting('update_process_title') <> 'on'
 THEN RAISE EXCEPTION 'I316 operational visibility inadequate: do not execute'; END IF;
END $visibility$;
SELECT 'I316_OPERATIONAL_VISIBILITY=' || jsonb_build_object(
 'superuser',(SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user),
 'read_all_stats',pg_catalog.pg_has_role(current_user,'pg_read_all_stats','USAGE'),
 'update_process_title',current_setting('update_process_title'),
 'other_role_client_sessions',(SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE datname=current_database()
   AND pid<>pg_catalog.pg_backend_pid() AND COALESCE(backend_type,'client backend')='client backend' AND usename IS DISTINCT FROM current_user),
 'state_redacted_sessions',(SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE datname=current_database()
   AND pid<>pg_catalog.pg_backend_pid() AND COALESCE(backend_type,'client backend')='client backend' AND state IS NULL))::text;
SELECT 'I316_OPERATIONAL_DATABASE_GATE_PASS';
`));
const owner=read('OWNER-RULING.md')+fs.readFileSync(path.join(root,'V5-RULING-SECTION.md'),'utf8');
put('OWNER-RULING.md',owner);
const b=JSON.parse(read('binding.json'));const oldReference=b.approval_reference;
b.approval_sha256=sha(owner);b.approval_reference='OWNER-RULING.md (retained 2026-10-25 owner instruction: Accept the unprivileged operational observation as PASS.)';
put('binding.json',JSON.stringify(b,null,2)+'\n');
put('checks.sql',once('checks.sql',oldReference,b.approval_reference));
put('DERIVATION.json',JSON.stringify({derived_from_v4_manifest_sha256:pin,
  v4_review_report_sha256:'c36dc24a0d4fac7f5aa5374e7a5b0a6ed7f9442334cad390a4cf078322374712',
  operational_observation_source:'../metadata-repair-v4-unprivileged-observation-20261025/operational-observation-v2.sh (byte-identical; passed on production 2026-10-24T20:28Z)',
  frozen_v2_v3_v4:'Never execute; no member modified'},null,2)+'\n');
console.log(JSON.stringify({created:dst,verified_v4_members:prior.files.length,approval_sha256:b.approval_sha256}));
