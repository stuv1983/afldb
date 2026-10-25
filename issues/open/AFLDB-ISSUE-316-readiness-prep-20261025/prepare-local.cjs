'use strict';
// Static local preparation output, deliberately separate from the accepted package and day-D evidence.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { inspect } = require('./check-source.cjs');
const root = path.resolve(__dirname,'../../..');
const execution = path.join(root,'.local-release/issue316-readiness-20261027/execution-P');
const report = inspect(execution,false);
for (const p of ['PREPARATION.json','P-SOURCE-HASHES.json']) if (fs.existsSync(path.join(__dirname,p))) throw Error('Refuse to overwrite static preparation evidence');
fs.writeFileSync(path.join(__dirname,'PREPARATION.json'),JSON.stringify(report.result,null,2)+'\n');
fs.writeFileSync(path.join(__dirname,'P-SOURCE-HASHES.json'),JSON.stringify(report.hashes,null,2)+'\n');
const evidence = path.join(root,'.local-release/issue316-readiness-20261027/day-D-evidence');
for(const p of ['opening','native','censuses','canonical-nightly','dry-run','decision'])fs.mkdirSync(path.join(evidence,p),{recursive:true});
fs.writeFileSync(path.join(__dirname,'EVIDENCE-PLAN.json'),JSON.stringify({classification:'PREPARATION ONLY; no observations',evidence_root:path.relative(root,evidence).replaceAll('\\','/'),
  states:{opening:'NOT RUN',native:'NOT RUN',censuses:'NOT RUN',canonical_nightly:'NOT RUN',enforced_dry_run:'NOT RUN'},
  observation_window_UTC:['2026-10-27T02:00:00Z','2026-10-27T04:00:00Z'],
  after_window:'Only documentation assembly may finish later, if all actual observations were completed inside the window and census freshness held at dry-run start',
  final_success_state:'READY FOR OWNER APPLY DECISION',production:'NO-GO',apply_authorised:false},null,2)+'\n');
const files=fs.readdirSync(__dirname).filter(p=>fs.statSync(path.join(__dirname,p)).isFile()&&p!=='SHA256SUMS').sort();
fs.writeFileSync(path.join(__dirname,'SHA256SUMS'),files.map(p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,p))).digest('hex')+'  '+p).join('\n')+'\n');
console.log(JSON.stringify({classification:report.result.classification,execution_commit:report.result.execution_tree_commit,raw_tracked_files:report.result.tracked_files,external_inputs_supplied:report.result.supplied_external_inputs,production_contact:false,evidence_directories:'empty / no observations'}));
