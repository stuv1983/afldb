#!/usr/bin/env node
/** ISSUE-206 parse-only triage. No parser imports and no expectation mutation.
 * Reads the frozen generator CSV plus stress-test artifacts and groups the
 * differences by family/field/signature. The existing scorer remains the
 * source of headline verdicts; this script adds diagnostic plan fields its
 * V1 schema does not compare and excludes explicit audit-required rows.
 */
import { readFileSync, writeFileSync } from 'node:fs';

function option(name) { const i=process.argv.indexOf(`--${name}`); return i<0?undefined:process.argv[i+1]; }
const corpusPath=option('corpus'), resultsPath=option('results'), failuresPath=option('failures');
const summaryPath=option('summary'), reportPath=option('out'), jsonPath=option('json');
if(!corpusPath||!resultsPath||!failuresPath||!summaryPath||!reportPath||!jsonPath)
  throw new Error('Usage: --corpus CSV --results results.jsonl --failures failures.csv --summary summary.json --out triage.md --json triage.json');
function csvRows(text) {
  const rows=[];let row=[],field='',quoted=false;text=text.replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++;}else if(c==='"')quoted=false;else field+=c;}
    else if(c==='"')quoted=true;else if(c===','){row.push(field);field='';}
    else if(c==='\n'){row.push(field);rows.push(row);row=[];field='';}else if(c!=='\r')field+=c;
  }
  if(field||row.length)rows.push([...row,field]);return rows;
}
function records(text) { const [header,...rows]=csvRows(text);return rows.filter(r=>r.some(Boolean)).map(r=>Object.fromEntries(header.map((h,i)=>[h,r[i]??'']))); }
const corpus=records(readFileSync(corpusPath,'utf8'));
const byId=new Map(corpus.map(r=>[String(r.id),r]));
const failures=records(readFileSync(failuresPath,'utf8'));
const failedById=new Map(failures.map(r=>[String(r.id),r]));
const summary=JSON.parse(readFileSync(summaryPath,'utf8'));
const results=readFileSync(resultsPath,'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));
if(results.length!==corpus.length||byId.size!==corpus.length)
  throw new Error(`Count/ID mismatch: corpus ${corpus.length}, result ${results.length}, ids ${byId.size}`);
const norm=s=>String(s??'').toLowerCase().replace(/[^a-z0-9]+/g,'');
const parseJson=s=>{try{return s?JSON.parse(s):undefined;}catch{return undefined;}};
const numeric=s=>s===''||s===undefined?undefined:Number(s);
const canonical=o=>JSON.stringify(o);
const findings=[], audit=[];let auditPass=0,auditSoft=0,auditFail=0;
function add(r,a,cls,field,want,got) {
  findings.push({ id:Number(r.id),family:r.exploratory_family,template:r.template_id,review:r.review_class,
    support:r.exploratory_support,question:r.question,class:cls,field,
    expected:String(want??'(absent)'),actual:String(got??'(absent)'),
    actualStatus:a.status,actualGrain:a.plan?.grain??'',actualMetric:a.plan?.metric??'',
    failureReason:a.failureReason??'',expectedIntent:parseJson(r.expected_plan_json),
    actualPlan:a.plan??null });
}
for(const rec of results){
  const r=byId.get(String(rec.expected.id));
  if(!r)throw new Error(`Unknown result id ${rec.expected.id}`);
  const a=rec.actual,p=a.plan,f=failedById.get(String(r.id));
  if(r.expected_status==='audit'){
    audit.push({id:Number(r.id),family:r.exploratory_family,question:r.question,
      status:a.status,grain:p?.grain??'',metric:p?.metric??'',failureReason:a.failureReason??''});
    if(a.status!=='error'){
      if(f?.verdict==='fail')auditFail++;else if(f?.verdict==='soft_fail')auditSoft++;else auditPass++;
    }
    if(a.status==='error')add(r,a,'INTERNAL_ERROR','exception','no crash',a.errorMessage);
    continue;
  }
  if(a.status==='error'){add(r,a,'INTERNAL_ERROR','exception','no crash',a.errorMessage);continue;}
  if(r.expected_status==='decline'){
    if(a.status==='success')add(r,a,'UNEXPECTED_PLAN','status','decline','confident plan');
    else if(r.expected_failure_reason&&r.expected_failure_reason!==a.failureReason)
      add(r,a,'WRONG_FAILURE_REASON','failureReason',r.expected_failure_reason,a.failureReason);
    continue;
  }
  if(a.status==='decline'){
    add(r,a,'UNEXPECTED_DECLINE','status','success',`${a.failureReason??'unknown'}: ${a.unsupportedTerms?.join(' ')??''}`);
    continue;
  }
  if(!p){add(r,a,'UNEXPECTED_DECLINE','plan','plan','absent');continue;}
  const cmp=(field,want,got,cls,normalise=false)=>{
    if(want===undefined||want==='')return;
    if(normalise?norm(want)!==norm(got):String(want)!==String(got??''))add(r,a,cls,field,want,got);
  };
  cmp('grain',r.expected_grain,p.grain,'WRONG_GRAIN');
  cmp('metric',r.expected_metric,p.metric,'WRONG_METRIC');
  cmp('mode',r.expected_mode,p.mode,'WRONG_MODE');
  cmp('aggregation',r.expected_aggregation,p.agg?.kind,'WRONG_AGGREGATION');
  cmp('player',r.expected_player,p.player?.name,'WRONG_PLAYER',true);
  cmp('clubFor',r.expected_club,p.scope?.clubFor?.name,'OWNERSHIP_LOSS',true);
  cmp('clubAgainst',r.expected_opponent,p.scope?.clubAgainst?.name,'OWNERSHIP_LOSS',true);
  cmp('venue',r.expected_venue,p.scope?.venue?.name,'OWNERSHIP_LOSS',true);
  cmp('seasonMin',numeric(r.expected_season_from),p.scope?.seasonMin,'WRONG_SCOPE');
  cmp('seasonMax',numeric(r.expected_season_to),p.scope?.seasonMax,'WRONG_SCOPE');
  const matchType=r.expected_match_type==='final'?'finals':r.expected_match_type;
  if(!r.expected_boundary)cmp('matchType',matchType,p.scope?.matchType,'WRONG_SCOPE');
  if(r.expected_boundary){
    cmp('boundary.event',r.expected_boundary==='first'?'debut':'last_game',p.boundary?.event,'WRONG_BOUNDARY');
    cmp('boundary.where',matchType==='grand_final'?'grand_final':'final',p.boundary?.where,'WRONG_BOUNDARY');
  }
  const preds=parseJson(r.expected_predicates_json);
  if(Array.isArray(preds)){
    const opMap={'>=':'gte','<=':'lte','>':'gt','<':'lt','=':'eq'};
    const want=preds.map(x=>`${x.field}|${opMap[x.op]??x.op}|${x.value}`).sort().join(';');
    const got=(p.careerConditions??[]).map(x=>`${x.column??x.awardKey}|${x.op}|${x.value}`).sort().join(';');
    if(want!==got)add(r,a,'WRONG_CONDITION','careerConditions',want,got);
  }
  const intent=parseJson(r.expected_plan_json)??{};
  for(const field of ['scoreCheckpoint','streakDefinition','havingClause','matchFilter','afterSiren',
    'achievementSummary','metricCondition','headToHead','clubSeasonConditions']){
    if(intent[field]===undefined)continue;
    if(canonical(intent[field])!==canonical(p[field]))
      add(r,a,'OWNERSHIP_LOSS',field,canonical(intent[field]),canonical(p[field]));
  }
  if(intent.matchup){
    const want=intent.matchup.map(norm).sort().join('|');
    const got=[p.scope?.matchup?.clubA?.name,p.scope?.matchup?.clubB?.name].map(norm).sort().join('|');
    if(want!==got)add(r,a,'WRONG_SCOPE','matchup',want,got);
  }
}
const bucket=(f)=>{
  // Manual dispositions from source-contract and sample review. These do not
  // change the frozen corpus or derive its expectations from parser output.
  if(f.family==='team_match_result'&&['clubFor','clubAgainst'].includes(f.field))return 'corpus_expectation_error';
  if(f.family==='achievement_summary'&&f.field==='aggregation')return 'corpus_expectation_error';
  if(f.class==='WRONG_PLAYER'&&/Gary Ablett (?:Jnr|Snr)/.test(f.expected))return 'scorer_identity_artifact';
  if(f.class==='UNEXPECTED_DECLINE')return 'honest_decline';
  if(f.class==='WRONG_FAILURE_REASON')return 'taxonomy_mismatch';
  if(f.class==='INTERNAL_ERROR')return 'runtime_error';
  return 'silent_wrong_plan';
};
const sourceArea=(f)=>{
  if(/entity|ambiguity/.test(f.family)||/club|venue|player/.test(f.field))return 'entity resolver / club-role ownership';
  if(/numeric|condition|having/.test(f.family)||/Condition|Clause|Filter/.test(f.field))return 'numeric binding / condition extraction';
  if(/checkpoint|comeback/.test(f.family)||f.field==='scoreCheckpoint')return 'checkpoint / team metric extraction order';
  if(/coach/.test(f.family))return 'coaching cue and match-type ownership';
  if(/siren/.test(f.family))return 'after-siren cue and dimension extraction';
  if(/achievement|family|relationship/.test(f.family))return 'specialized builder ownership';
  if(/season|boundary|head_to_head/.test(f.family))return 'time / boundary / relationship extraction';
  return 'parser vocabulary, grain election or plan validation';
};
const signature=f=>[f.family,f.template,f.class,f.field,
  f.class==='UNEXPECTED_DECLINE'?f.failureReason:''].join('|');
const groups=new Map();
for(const f of findings){const key=signature(f);if(!groups.has(key))groups.set(key,{signature:key,
  family:f.family,class:f.class,field:f.field,bucket:bucket(f),sourceArea:sourceArea(f),count:0,
  examples:[]});const g=groups.get(key);g.count++;if(g.examples.length<3)g.examples.push(f);}
const ranked=[...groups.values()].sort((a,b)=>{
  const severity={silent_wrong_plan:0,runtime_error:1,honest_decline:2,taxonomy_mismatch:3,
    scorer_identity_artifact:4,corpus_expectation_error:5};
  return severity[a.bucket]-severity[b.bucket]||b.count-a.count||a.signature.localeCompare(b.signature);
});
const nativeAuditHandling=Number(summary.auditRequired)===audit.length
  && Number(summary.inputRows)===results.length;
const corrected={inputRows:results.length,auditRequired:audit.length,
  scored:nativeAuditHandling?summary.total:summary.total-auditPass-auditSoft-auditFail,
  clean:nativeAuditHandling?summary.pass:summary.pass-auditPass,
  soft:nativeAuditHandling?summary.softFail:summary.softFail-auditSoft,
  failed:nativeAuditHandling?summary.fail:summary.fail-auditFail,
  nativeAuditHandling,
  rawScorer:{clean:summary.pass,soft:summary.softFail,failed:summary.fail},
  auditOldVerdicts:{clean:auditPass,soft:auditSoft,failed:auditFail},
  supplementalFindingCount:findings.length,groupCount:ranked.length};
const report=[];
report.push('# AFLDB-ISSUE-206 exploratory parse-only triage','',
  `Input ${corrected.inputRows}; scored ${corrected.scored}: ${corrected.clean} clean, ${corrected.soft} soft, ${corrected.failed} failed; ${corrected.auditRequired} audit-required unscored.`,
  nativeAuditHandling
    ? 'The scorer natively excluded audit-required rows.'
    : `The host's unmodified V1 scorer reported ${summary.pass}/${summary.softFail}/${summary.fail}; its audit-row contributions (${auditPass}/${auditSoft}/${auditFail}) are excluded above.`,
  'The supplemental groups below inspect template-authored plan fields beyond the V1 scorer. They are diagnostic, not promoted expectations.',
  'Counts are field findings, so paired fields on one row can appear twice. Corpus and scorer artifacts remain visible in separate sections.','');
for(const section of ['silent_wrong_plan','runtime_error','honest_decline','taxonomy_mismatch','scorer_identity_artifact','corpus_expectation_error']){
  report.push(`## ${section.replaceAll('_',' ')}`,'');
  for(const g of ranked.filter(x=>x.bucket===section).slice(0,30)){
    report.push(`### ${g.count} — ${g.family} / ${g.class} / ${g.field}`,'',
      `Likely source area: ${g.sourceArea}. Review classification: ${g.examples[0]?.support==='unsupported'?'unsupported feature or fail-closed contract':'parser defect or corpus specification; inspect samples'}.`,'');
    for(const x of g.examples)report.push(`- #${x.id} “${x.question}” — expected ${x.field}=${x.expected}; actual ${x.actual}; status ${x.actualStatus}; grain ${x.actualGrain}, metric ${x.actualMetric}.`);
    report.push('');
  }
}
report.push('## Audit-required rows','',
  `Observed ${audit.length} ambiguous or malformed/composed rows without scoring their interpretation.`,
  ...audit.slice(0,20).map(x=>`- #${x.id} “${x.question}” — ${x.status}, ${x.grain}/${x.metric}, ${x.failureReason}`),'');
writeFileSync(reportPath,report.join('\n'),'utf8');
writeFileSync(jsonPath,JSON.stringify({corrected,groups:ranked,audit},null,2)+'\n','utf8');
process.stdout.write(`${corrected.scored} scored: ${corrected.clean} clean, ${corrected.soft} soft, ${corrected.failed} failed; ${corrected.auditRequired} audit-required. ${ranked.length} diagnostic groups.\n`);
