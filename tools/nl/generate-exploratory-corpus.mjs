#!/usr/bin/env node
/** AFLDB-ISSUE-206: independent, deterministic exploratory V1-schema corpus.
 *
 * Questions come only from the specifications below. The frozen V5 file is
 * read solely into overlap sets; its question strings never enter a template.
 * Expected fields are authored with each template, never copied from a parse.
 *
 * node tools/nl/generate-exploratory-corpus.mjs --baseline /path/to/v5.csv \
 *   --out /path/to/exploratory.csv --manifest /path/to/manifest.json
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const VERSION = 'issue-206-exploratory-v1';
const PARSER_VERSION = 54;
const DEFAULT_SEED = 2060542026;
const HEADER = [
  'id','category','difficulty','verification_level','equivalence_group','question',
  'expected_status','expected_grain','expected_mode','expected_metric','expected_aggregation',
  'expected_limit','expected_player','expected_club','expected_opponent','expected_venue',
  'expected_season_from','expected_season_to','expected_match_type','expected_result',
  'expected_boundary','expected_predicates_json','expected_failure_reason',
  'expected_coverage_behavior','expected_min_confidence','expected_answer_primary',
  'expected_answer_value','expected_answer_unit','expected_result_count',
  'expected_tie_count','verification_source','notes','expected_plan_json',
  'exploratory_family','exploratory_support','composition_depth','major_scope_type',
  'review_class','template_id',
];

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? fallback : process.argv[at + 1];
}
const seed = Number(arg('seed', DEFAULT_SEED));
const baselinePath = arg('baseline');
const outPath = arg('out');
const manifestPath = arg('manifest');
if (!baselinePath || !outPath || !manifestPath || !Number.isInteger(seed)) {
  throw new Error('Usage: --baseline V5.csv --out exploratory.csv --manifest manifest.json [--seed integer]');
}

// Mulberry32: fixed sequence across Node versions; no Math.random or time.
let state = seed >>> 0;
function rand() {
  state = (state + 0x6D2B79F5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const chance = (p) => rand() < p;
function csvRows(text) {
  const rows = []; let row = []; let field = ''; let quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  if (field || row.length) rows.push([...row, field]);
  return rows;
}
function csvCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}
const normalize = (q) => q.normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'")
  .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const baselineRows = csvRows(readFileSync(baselinePath, 'utf8'));
const questionIndex = baselineRows[0]?.indexOf('question');
if (questionIndex < 0 || baselineRows.length !== 12001) {
  throw new Error(`Expected frozen 12000-row V5 with a question column; got ${baselineRows.length - 1} rows`);
}
const baselineExact = new Set(baselineRows.slice(1).map((r) => r[questionIndex]));
const baselineNorm = new Set([...baselineExact].map(normalize));

const CLUBS = [
  ['Adelaide','Adelaide'],['Carlton','Carlton'],['Collingwood','Collingwood'],
  ['Essendon','Essendon'],['Fremantle','Fremantle'],['Geelong','Geelong'],
  ['Gold Coast','Gold Coast'],['Greater Western Sydney','Greater Western Sydney'],
  ['Hawthorn','Hawthorn'],['Melbourne','Melbourne'],['North Melbourne','North Melbourne'],
  ['Port Adelaide','Port Adelaide'],['Richmond','Richmond'],['St Kilda','St Kilda'],
  ['Sydney','Sydney'],['West Coast','West Coast'],['Western Bulldogs','Western Bulldogs'],
  ['Brisbane Lions','Brisbane Lions'],['Pies','Collingwood'],['Tigers','Richmond'],
  ['Bombers','Essendon'],['Freo','Fremantle'],['Giants','Greater Western Sydney'],
  ['Dogs','Western Bulldogs'],['Swans','Sydney'],['Suns','Gold Coast'],
];
const PLAYERS = [
  'Dustin Martin','Lance Franklin','Patrick Dangerfield','Scott Pendlebury',
  'Tony Lockett','Chris Judd','Brent Harvey','Leigh Matthews',
  'Marcus Bontempelli','Nat Fyfe','Joel Selwood','Michael Voss',
  'Gary Ablett Snr','Gary Ablett Jnr','Jason Akermanis','Shane Crawford',
];
const VENUES = [
  ['Melbourne Cricket Ground','Melbourne Cricket Ground'],['MCG','Melbourne Cricket Ground'],
  ['Sydney Cricket Ground','Sydney Cricket Ground'],['SCG','Sydney Cricket Ground'],
  ['Adelaide Oval','Adelaide Oval'],['Docklands','Docklands'],
  ['Marvel Stadium','Docklands'],['Gabba','Gabba'],['Kardinia Park','Kardinia Park'],
  ['Perth Stadium','Perth Stadium'],['Optus Stadium','Perth Stadium'],
  ['York Park','York Park'],['Waverley Park','Waverley Park'],
];
const STATS = [
  ['goals','goals'],['disposals','disposals'],['marks','marks'],['tackles','tackles'],
  ['kicks','kicks'],['handballs','handballs'],['hitouts','hitouts'],
  ['clearances','clearances'],['inside 50s','inside_50s'],
  ['contested possessions','contested'],['uncontested possessions','uncontested'],
  ['goal assists','goal_assists'],['Brownlow votes','brownlow_votes'],
];
const CAREER_STATS = [
  ['games','games'],['goals','goals'],['premierships','premierships'],
  ['finals','finals'],['Brownlow votes','brownlow_votes'],
  ['marks','marks'],['tackles','tackles'],['disposals','disposals'],
  ['clubs','clubs_played'],['wins','wins'],['losses','losses'],
];
const TIME = [
  { q:'', type:'all_time' },
  { q:'in 2017', from:2017, to:2017, type:'exact_season' },
  { q:'in 2009', from:2009, to:2009, type:'exact_season' },
  { q:'in 2023', from:2023, to:2023, type:'exact_season' },
  { q:'since 2000', from:2000, type:'since' },
  { q:'after 1999', from:2000, type:'after' },
  { q:'before 2019', to:2018, type:'before' },
  { q:'between 2005 and 2015', from:2005, to:2015, type:'between' },
  { q:'during the 2010s', from:2010, to:2019, type:'decade' },
];
const MATCH_TYPES = [
  {q:'', value:''}, {q:'in finals', value:'finals'},
  {q:'in a Grand Final', value:'grand_final'},
  {q:'in a preliminary final', value:'preliminary_final'},
  {q:'in a wildcard final', value:'wildcard_final'},
  {q:'in home-and-away games', value:'home_and_away'},
];
const C = () => pick(CLUBS);
function distinctClub(other) {
  let c; do { c = C(); } while (c[1] === other[1]); return c;
}
const V = () => pick(VENUES);
const P = () => pick(PLAYERS);
const T = () => pick(TIME);
const S = () => pick(STATS);
const MT = () => pick(MATCH_TYPES);
const words = (...parts) => parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
const possessive = (name) => `${name}${/s$/i.test(name) ? "'" : "'s"}`;
function row(family, template, question, expected = {}, extra = {}) {
  const status = extra.review === 'audit_required' ? 'audit' : (extra.status ?? 'success');
  return {
    category: family, difficulty: extra.depth ?? 1,
    verification_level: status === 'decline' ? 'EXPECTED_DECLINE' : 'SEMANTIC',
    question, expected_status: status, expected_grain: expected.grain ?? '',
    expected_mode: expected.mode ?? '', expected_metric: expected.metric ?? '',
    expected_aggregation: expected.aggregation ?? '', expected_limit: expected.limit ?? '',
    expected_player: expected.player ?? '', expected_club: expected.club ?? '',
    expected_opponent: expected.opponent ?? '', expected_venue: expected.venue ?? '',
    expected_season_from: expected.from ?? '', expected_season_to: expected.to ?? '',
    expected_match_type: expected.matchType ?? '', expected_boundary: expected.boundary ?? '',
    expected_predicates_json: expected.conditions ? JSON.stringify(expected.conditions) : '',
    expected_failure_reason: expected.failureReason ?? '',
    expected_plan_json: expected.intent ? JSON.stringify(expected.intent) : '',
    verification_source: 'ISSUE-206 independent template specification',
    notes: extra.note ?? '', exploratory_family: family,
    exploratory_support: extra.support ?? (status === 'success' ? 'supported' : 'unsupported'),
    composition_depth: extra.depth ?? 1, major_scope_type: extra.scope ?? 'none',
    review_class: extra.review ?? 'template_contract', template_id: `${family}/${template}`,
  };
}
function temporal(expected, t) {
  if (t.from) expected.from = t.from;
  if (t.to) expected.to = t.to;
  return expected;
}
function condition(column, op, value) {
  return { field:column, op, value };
}
const CONDITIONS = [
  { q:'at least 200 games', c:condition('games','>=',200) },
  { q:'more than 50 goals', c:condition('goals','>',50) },
  { q:'exactly 3 premierships', c:condition('premierships','=',3) },
  { q:'at most 10 Brownlow votes', c:condition('brownlow_votes','<=',10) },
  { q:'no premierships', c:condition('premierships','=',0) },
  { q:'zero goals', c:condition('goals','=',0) },
  { q:'at least three clubs', c:condition('clubs_played','>=',3) },
  { q:'no more than 250 games', c:condition('games','<=',250) },
  { q:'at least 20 finals', c:condition('finals','>=',20) },
  { q:'fewer than 5 losses', c:condition('losses','<',5) },
];

// Each builder chooses axes independently; no source question is ever read.
// Sizes deliberately allocate more rows to sparse intersections than V5.
const families = [
  { name:'player_game_single', n:2100, make() {
    const p=P(), s=S(), t=T(), template=pick([0,1,2,3,4]);
    const q=[
      words('What was',p+"'s",'biggest',s[0],'haul in one match',t.q),
      words('Show the highest',s[0],'game for',p,t.q),
      words(p,'record',s[0],'in a game',t.q),
      words('Which match saw',p,'collect the most',s[0],t.q),
      words('Find',p+"'s",'peak single-game',s[0],t.q),
    ][template];
    return row('player_game_single',template,q,temporal({grain:'player_game',mode:'single',metric:s[1],aggregation:'max',player:p},t),{depth:2,scope:t.type});
  }},
  { name:'player_game_scope_collision', n:2300, make() {
    const p=P(), s=S(), c=C(), v=V(), t=T(), template=pick([0,1,2,3]);
    const q=[
      words('Highest',s[0],'game by',p,'against',c[0],'at',v[0],t.q),
      words(p+"'s",'best',s[0],'in one game at',v[0],'versus',c[0],t.q),
      words('At',v[0]+',',p,'against',c[0]+':','most',s[0],'in a match',t.q),
      words('Find the single-match',s[0],'record for',p,'against',c[0],'at',v[0],t.q),
    ][template];
    return row('player_game_scope_collision',template,q,temporal({grain:'player_game',mode:'single',metric:s[1],aggregation:'max',player:p,opponent:c[1],venue:v[1]},t),{depth:5,scope:'player+opponent+venue+time'});
  }},
  { name:'player_game_scoped_total', n:1600, make() {
    const p=P(), s=S(), c=C(), v=V(), t=T(), template=pick([0,1,2,3]);
    const q=[
      words('Total',s[0],'by',p,'against',c[0],t.q),
      words(p,'combined',s[0],'against',c[0],'at',v[0],t.q),
      words('Across his matches against',c[0]+',','how many',s[0],'did',p,'record',t.q),
      words('Sum the',s[0],'for',p,'at',v[0],'against',c[0],t.q),
    ][template];
    const e=temporal({grain:'player_game',mode:'sum',metric:s[1],aggregation:'max',player:p,opponent:c[1]},t);
    if (template===1 || template===3) e.venue=v[1];
    return row('player_game_scoped_total',template,q,e,{depth:e.venue?5:4,scope:'player+opponent+venue/time'});
  }},
  { name:'player_season_leaderboard', n:2200, make() {
    const s=S(), c=C(), t=pick(TIME.filter(x=>x.q)), template=pick([0,1,2,3]);
    const q=[
      words('Which player posted the highest season tally of',s[0],'for',c[0],t.q),
      words('For',c[0]+',','who led the',s[0],'in a season',t.q),
      words('Most',s[0],'by a',c[0],'player in one season',t.q),
      words('Find the',c[0],'player with the best seasonal',s[0],'total',t.q),
    ][template];
    return row('player_season_leaderboard',template,q,temporal({grain:'player_season',metric:s[1],aggregation:'max',club:c[1]},t),{depth:3,scope:'club+time'});
  }},
  { name:'player_career_rank', n:300, make() {
    const s=pick(CAREER_STATS), c=C(), template=pick([0,1,2,3]);
    const q=[
      words('Across an entire AFL career, who accumulated the most',s[0]),
      words('Career leaderboard for',s[0]+':','who is first'),
      words('Which player owns the record for career',s[0]),
      words('Among players who represented',c[0]+',','who has the most career',s[0]),
    ][template];
    const e={grain:'player_career',metric:s[1],aggregation:'max'};
    if(template===3)e.club=c[1];
    return row('player_career_rank',template,q,e,{depth:template===3?3:1,scope:template===3?'club':'none'});
  }},
  { name:'career_numeric_binding', n:2000, make() {
    const a=pick(CONDITIONS); let b=pick(CONDITIONS);
    while(b.c.field===a.c.field)b=pick(CONDITIONS);
    const s=pick(CAREER_STATS), c=C(), template=pick([0,1,2,3,4]);
    const clauses=chance(.5)?[a,b]:[b,a];
    const q=[
      words('List players with',clauses[0].q,'and',clauses[1].q),
      words('Players who have',clauses[0].q+',',clauses[1].q),
      words('Who has the most career',s[0],'among players with',clauses[0].q,'and',clauses[1].q),
      words('For',c[0]+',','find players with',clauses[0].q,'plus',clauses[1].q),
      words('Of players with',clauses[0].q,'and',clauses[1].q+',','who has the fewest career',s[0]),
    ][template];
    const e={grain:'player_career',metric:template===2||template===4?s[1]:'',aggregation:template===2?'max':template===4?'min':'list',conditions:clauses.map(x=>x.c)};
    if(template===3)e.club=c[1];
    return row('career_numeric_binding',template,q,e,{depth:template===3?4:3,scope:template===3?'career_conditions+club':'career_conditions'});
  }},
  { name:'team_match_result', n:2200, make() {
    const c=C(), o=distinctClub(c), v=V(), t=T(), lose=chance(.4), template=pick([0,1,2,3]);
    const noun=lose?'defeat':'victory', metric=lose?'loss_margin':'win_margin';
    const q=[
      words('What was',possessive(c[0]),'biggest',noun,'against',o[0],'at',v[0],t.q),
      words('At',v[0]+',','find the widest',c[0],lose?'loss':'win','to',o[0],t.q),
      words('By how much did',o[0],lose?'beat':'lose to',c[0],'in their most lopsided meeting at',v[0],t.q),
      words('Largest',lose?'losing':'winning','margin for',c[0],'versus',o[0],'at',v[0],t.q),
    ][template];
    return row('team_match_result',template,q,temporal({grain:'team_match',metric,aggregation:'max',club:c[1],opponent:o[1],venue:v[1]},t),{depth:5,scope:'club+opponent+venue+time'});
  }},
  { name:'team_match_score_crowd', n:1500, make() {
    const c=C(), o=distinctClub(c), t=T(), mt=MT(), kind=pick([['score','team_score'],['combined score','total_score'],['crowd','attendance']]), template=pick([0,1,2,3]);
    const q=[
      words('Highest',kind[0],'when',c[0],'met',o[0],mt.q,t.q),
      words('For',c[0],'against',o[0]+',','what was the biggest',kind[0],mt.q,t.q),
      words('Find the',c[0],'match against',o[0],'with the largest',kind[0],mt.q,t.q),
      words('Record',kind[0],'in a',c[0],'game against',o[0],mt.q,t.q),
    ][template];
    const e=temporal({grain:'team_match',metric:kind[1],aggregation:'max',club:c[1],opponent:o[1]},t);
    if(mt.value)e.matchType=mt.value;
    return row('team_match_score_crowd',template,q,e,{depth:4,scope:'club+opponent+match_type+time'});
  }},
  { name:'team_checkpoint_collision', n:1100, make() {
    const c=C(), o=distinctClub(c), t=T(), cp=pick([['quarter time','QT'],['half time','HT'],['three quarter time','3QT']]),template=pick([0,1,2,3]);
    const q=[
      words('Highest',c[0],'score at',cp[0],'against',o[0],t.q),
      words('Against',o[0]+',','what was',possessive(c[0]),'largest lead at',cp[0],t.q),
      words(c[0],'record score at',cp[0],'versus',o[0],t.q),
      words('Which',c[0],'match against',o[0],'had its highest score by',cp[0],t.q),
    ][template];
    return row('team_checkpoint_collision',template,q,temporal({grain:'team_match',metric:template===1?'win_margin':'team_score',aggregation:'max',club:c[1],opponent:o[1],intent:{scoreCheckpoint:cp[1]}},t),{depth:4,scope:'club+opponent+checkpoint+time'});
  }},
  { name:'q3_comeback_near_miss', n:550, make() {
    const c=C(), o=distinctClub(c), t=T(), template=pick([0,1,2,3]);
    const q=[
      words(possessive(c[0]),'largest three quarter time comeback against',o[0],t.q),
      words('What was the biggest 3qt comeback by',c[0],'over',o[0],t.q),
      words('Find',possessive(c[0]),'record three-quarter time comeback versus',o[0],t.q),
      words('Against',o[0]+',','show the greatest three quarter time comeback for',c[0],t.q),
    ][template];
    return row('q3_comeback_near_miss',template,q,temporal({grain:'team_match',metric:'q3_deficit_overcome',aggregation:'max',club:c[1],opponent:o[1]},t),{depth:4,scope:'club+opponent+time'});
  }},
  { name:'team_grouped_having', n:1250, make() {
    const n=pick([2,3,4,5,7,10]), margin=pick([20,30,40,50,60,80]), t=T(), template=pick([0,1,2,3]);
    const outcome=pick([['wins','win_margin'],['losses','loss_margin']]);
    const q=[
      words('Which clubs had at least',n,outcome[0],'by more than',margin,'points',t.q),
      words('Teams with',n,'or more',outcome[0],'by over',margin,'points',t.q),
      words('List sides that recorded at least',n,outcome[0],'with margins greater than',margin,t.q),
      words('Find clubs with more than',n,outcome[0],'by at least',margin,'points',t.q),
    ][template];
    const op=template===3?'gt':'gte', mOp=template===3?'gte':'gt';
    return row('team_grouped_having',template,q,temporal({grain:'team_match',aggregation:'list',intent:{havingClause:{metric:outcome[0],op,value:n},matchFilter:{metric:outcome[1],op:mOp,value:margin}}},t),{depth:4,scope:'having+margin+time'});
  }},
  { name:'club_season_rank', n:1400, make() {
    const c=C(), metric=pick([['wins','wins'],['losses','losses'],['draws','draws'],['percentage','percentage']]);
    const t=T(), template=pick([0,1,2,3]), min=chance(.3);
    const q=[
      words('Which club had the',min?'fewest':'most',metric[0],'in a season',t.q),
      words(possessive(c[0]),min?'lowest':'highest','seasonal',metric[0],t.q),
      words('Rank teams by their',min?'smallest':'largest',metric[0],'season',t.q),
      words('For',c[0]+',','what season had the',min?'lowest':'highest',metric[0],t.q),
    ][template];
    const e=temporal({grain:'club_season',metric:metric[1],aggregation:min?'min':'max'},t);
    if(template===1||template===3)e.club=c[1];
    return row('club_season_rank',template,q,e,{depth:e.club?3:2,scope:e.club?'club+time':'time'});
  }},
  { name:'club_season_condition', n:700, make() {
    const c=C(), t=T(), cond=pick([['won the wooden spoon','wooden_spoon'],['made the finals','made_finals'],['missed the finals','missed_finals'],['were premiers','premier']]), template=pick([0,1,2,3]);
    const q=[
      words('Which clubs',cond[0],t.q),
      words('Among sides that',cond[0]+',','who had the fewest wins',t.q),
      words('Show',c[0],'seasons when they',cond[0],t.q),
      words('How many teams',cond[0],t.q),
    ][template];
    const e=temporal({grain:'club_season',aggregation:template===1?'min':template===3?'count':'list',metric:template===1?'wins':'',intent:{clubSeasonConditions:[{kind:cond[1]}]}},t);
    if(template===2)e.club=c[1];
    return row('club_season_condition',template,q,e,{depth:e.club?3:2,scope:'club_condition+time'});
  }},
  { name:'team_streak', n:850, make() {
    const c=C(), o=distinctClub(c), t=T(), kind=pick([['winning','win'],['losing','loss'],['unbeaten','unbeaten']]), template=pick([0,1,2,3]);
    const q=[
      words('What is',possessive(c[0]),'longest',kind[0],'streak against',o[0],t.q),
      words('Find the longest run of',kind[1]==='loss'?'consecutive losses':kind[1]==='win'?'consecutive wins':'consecutive games unbeaten','for',c[0],t.q),
      words(c[0],'record',kind[0],'streak',t.q),
      words('Which team had the longest',kind[0],'streak',t.q),
    ][template];
    const e=temporal({grain:'team_streak',aggregation:'max',intent:{streakDefinition:{kind:kind[1]}}},t);
    if(template<3)e.club=c[1];
    if(template===0)e.opponent=o[1];
    return row('team_streak',template,q,e,{depth:template===0?4:2,scope:'streak+club/opponent+time'});
  }},
  { name:'head_to_head', n:900, make() {
    const a=C(), b=distinctClub(a), t=T(), template=pick([0,1,2,3]);
    const q=[
      words('What is the head to head record between',a[0],'and',b[0],t.q),
      words('How many draws have',a[0],'and',b[0],'played',t.q),
      words('Which of',a[0],'and',b[0],'has more wins head to head',t.q),
      words('When was the last draw between',a[0],'and',b[0],t.q),
    ][template];
    return row('head_to_head',template,q,temporal({grain:'head_to_head',aggregation:'count',intent:{headToHead:{kind:['record','draw_count','compare_wins','last_draw'][template]},matchup:[a[1],b[1]]}},t),{depth:3,scope:'two_clubs+time'});
  }},
  { name:'coach_record', n:1250, make() {
    const c=C(), t=T(), metric=pick([['games','games'],['wins','wins'],['finals','finals'],['Grand Finals','grand_finals'],['premierships','premierships'],['seasons','seasons']]),template=pick([0,1,2,3]);
    const q=[
      words('Which coach managed the most',metric[0],'for',c[0],t.q),
      words(c[0],'coaches ranked by',metric[0],t.q),
      words('Find the coach with the most',metric[0],'in charge of',c[0],t.q),
      words('Who coached the most',metric[0],'for',c[0],t.q),
    ][template];
    return row('coach_record',template,q,temporal({grain:'coach_record',metric:metric[1],aggregation:'max',club:c[1]},t),{depth:3,scope:'coach+club+time'});
  }},
  { name:'after_siren', n:900, make() {
    const c=C(), o=distinctClub(c), t=T(), kick=pick([['goals','goal'],['behinds','behind'],['kicks',null]]),effect=pick([['',null],['to win','won'],['to draw','drew']]), template=pick([0,1,2,3]);
    const playerSubject=template===0||template===2;
    const q=[
      words('Which player kicked the most',kick[0],'after the siren',effect[0],'for',c[0],t.q),
      words('List',kick[0],'after the siren',effect[0],'against',o[0],t.q),
      words('For',c[0]+',','who has the most',kick[0],'after the siren',effect[0],t.q),
      words('How many',kick[0],'after the siren',effect[0],'versus',o[0],t.q),
    ][template];
    const desc={subject:playerSubject?'player':'event'};
    if(kick[1])desc.kickScored=kick[1];
    if(effect[1])desc.kickEffect=effect[1];
    const e=temporal({grain:'after_siren',metric:'siren_kicks',aggregation:template===3?'count':playerSubject?'max':'list',intent:{afterSiren:desc}},t);
    if(playerSubject)e.club=c[1]; else e.opponent=o[1];
    return row('after_siren',template,q,e,{depth:4,scope:'siren_dimensions+club/opponent+time'});
  }},
  { name:'achievement_summary', n:650, make() {
    const c=C(), t=T(), kind=pick([['by club','by_club'],['by decade','by_decade'],['by season','by_season']]),template=pick([0,1,2,3]);
    const q=[
      words('First-kick goal players',kind[0],t.q),
      words('How are players who scored a goal with their first kick distributed',kind[0],t.q),
      words('For',c[0]+',','first kick goal players',kind[0],t.q),
      words('Show first-kick goal counts',kind[0],'for',c[0],t.q),
    ][template];
    const e=temporal({grain:'achievement_summary',aggregation:'count',intent:{achievementSummary:{achievementKey:'first_kick_goal',kind:kind[1]}}},t);
    if(template>=2)e.club=c[1];
    return row('achievement_summary',template,q,e,{depth:e.club?3:2,scope:'achievement+club/time'});
  }},
  { name:'family', n:80, make() {
    const template=pick([0,1,2,3,4,5]);
    if(template<4){
      const metric=template%2?'linked_members':'combined_games';
      const q=[
        'Which football family has the highest combined career games?',
        'What family has the most linked AFL players?',
        'Find the biggest football family by games played',
        'Which family has the most players?',
      ][template];
      return row('family',template,q,{grain:'family',metric,aggregation:'max'}, {depth:1,scope:'family'});
    }
    const n=pick([2,3,4,5,6,7,8,9,10]);
    const op=pick([['at least','gte'],['more than','gt'],['at most','lte'],['exactly','eq'],['fewer than','lt']]);
    const q=template===4?`Families with ${op[0]} ${n} players`:`List football families with ${op[0]} ${n} AFL players`;
    return row('family',template,q,{grain:'family',metric:'linked_members',aggregation:'list',intent:{metricCondition:{op:op[1],value:n}}}, {depth:2,scope:'family_size_condition'});
  }},
  { name:'career_boundary', n:850, make() {
    const c=C(), t=T(), event=pick([['first game','first'],['last game','last']]),mt=pick([['a final','final'],['a Grand Final','grand_final']]),template=pick([0,1,2,3]);
    const q=[
      words('Which players had their',event[0],'in',mt[0],'for',c[0],t.q),
      words('Find players whose',event[0],'came in',mt[0],t.q),
      words('How many',c[0],'players played their',event[0],'in',mt[0],t.q),
      words('List players with a',event[0],'in',mt[0],t.q),
    ][template];
    const e=temporal({grain:'player_career',aggregation:template===2?'count':'list',boundary:event[1],matchType:mt[1]},t);
    if(template===0||template===2)e.club=c[1];
    return row('career_boundary',template,q,e,{depth:e.club?4:3,scope:'boundary+final+club/time'});
  }},
  { name:'relationship_conditions', n:350, make() {
    const p=P(), c=C(), a=pick(CONDITIONS),template=pick([0,1,2,3]);
    const q=[
      words('Which brothers of',p,'played',a.q),
      words('List sons of',p,'with',a.q),
      words('Players with an AFL-playing father and',a.q),
      words('Who played for',c[0],'and also coached',c[0],'with',a.q),
    ][template];
    const e={grain:'player_career',aggregation:'list',conditions:[a.c],intent:{relationship:template}};
    if(template===3)e.club=c[1];
    return row('relationship_conditions',template,q,e,{depth:3,scope:'relationship+career_condition',review:'audit_required',support:'uncertain',note:'Builder ownership and numeric composition require manual interpretation audit.'});
  }},
  { name:'unsupported_topic', n:2100, make() {
    const c=C(), p=P(), t=T(), topic=pick([['SuperCoach points','fantasy'],['fantasy score','fantasy'],['rebound 50s','rebound_50s'],['games at full forward','position'],['average disposals','averages']]),template=pick([0,1,2,3]);
    const q=[
      words('Who recorded the most',topic[0],'for',c[0],t.q),
      words('Find',p+"'s",topic[0],'against',c[0],t.q),
      words('Which',c[0],'player led in',topic[0],t.q),
      words('List players with at least 200 games and the highest',topic[0],t.q),
    ][template];
    return row('unsupported_topic',template,q,{failureReason:'unsupported_topic'},{status:'decline',support:'unsupported',depth:3,scope:'unsupported+entity/time',note:`Explicit UNANSWERABLE_TOPICS gate: ${topic[1]}`});
  }},
  { name:'unsupported_composition', n:750, make() {
    const c=C(), o=distinctClub(c), t=T(),template=pick([0,1,2,3]);
    const q=[
      words('What was',possessive(c[0]),'biggest comeback from quarter time against',o[0],t.q),
      words('Who averaged the most goals from centre half forward for',c[0],t.q),
      words('Which coach led',c[0],'after playing for',o[0],t.q),
      words('First-kick goal players against',o[0],'by season',t.q),
    ][template];
    return row('unsupported_composition',template,q,{}, {status:'decline',support:'unsupported',depth:4,scope:'unsupported_composition',note:'Known ownership/feature gap; failure reason deliberately unasserted.'});
  }},
  { name:'identity_ambiguity', n:600, make() {
    const surname=pick(['Jones','Brown','Smith','Williams','Wilson','Johnson','Anderson']),c=C(),t=T(),template=pick([0,1,2,3]);
    const q=[
      words('How many career games did',surname,'play',t.q),
      words('What was',surname+"'s",'highest disposal game against',c[0],t.q),
      words('Find the goals kicked by',surname,'for',c[0],t.q),
      words('Did',surname,'play a Grand Final for',c[0],t.q),
    ][template];
    return row('identity_ambiguity',template,q,{}, {review:'audit_required',support:'uncertain',depth:3,scope:'ambiguous_person+club/time',note:'Ambiguous surname; do not assert an identity without manual directory review.'});
  }},
  { name:'malformed_input', n:550, make() {
    const c=C(), p=P(), s=S(),t=T(),template=pick([0,1,2,3,4]);
    const q=[
      words('Most',s[0],'at',c[0],'and then?'),
      words(p,'against versus',c[0],t.q),
      words('Top',s[0],'for how'),
      words(c[0],s[0],'200 40',t.q),
      words('Which',c[0],'player did the thing with',s[0],t.q),
    ][template];
    return row('malformed_input',template,q,{}, {review:'audit_required',support:'uncertain',depth:1,scope:'malformed',note:'Malformed or incomplete; any confident interpretation needs manual review.'});
  }},
];

const seenExact = new Set(), seenNorm = new Set(), ids = new Set();
const groupCounts = new Map(), templateCounts = new Map();
const rejected = { exactDuplicate:0, normalizedDuplicate:0, exactV5:0, normalizedV5:0, groupCap:0, templateCap:0 };
const CAP_GROUP = 6, CAP_TEMPLATE = 700;
const generated = [];
function keyFor(r) {
  return [r.exploratory_family,r.expected_status,r.expected_grain,r.expected_mode,
    r.expected_metric,r.expected_aggregation,r.expected_player,r.expected_club,
    r.expected_opponent,r.expected_venue,r.expected_season_from,r.expected_season_to,
    r.expected_match_type,r.expected_boundary,r.expected_predicates_json,r.expected_plan_json,
    // A decline/audit row has no scored plan shape. Its full question is
    // therefore the only honest equivalence key until an operator audits it.
    r.expected_status==='success'?'':normalize(r.question)].join('|');
}
function accept(r) {
  const q=r.question.trim(), nq=normalize(q);
  if(seenExact.has(q)){rejected.exactDuplicate++;return false;}
  if(seenNorm.has(nq)){rejected.normalizedDuplicate++;return false;}
  if(baselineExact.has(q)){rejected.exactV5++;return false;}
  if(baselineNorm.has(nq)){rejected.normalizedV5++;return false;}
  const group=keyFor(r), tc=templateCounts.get(r.template_id)??0, gc=groupCounts.get(group)??0;
  if(tc>=CAP_TEMPLATE){rejected.templateCap++;return false;}
  if(gc>=CAP_GROUP){rejected.groupCap++;return false;}
  r.equivalence_group=`${r.exploratory_family}|${createHash('sha1').update(group).digest('hex').slice(0,12)}`;
  r.id=20600001+generated.length;
  if(ids.has(r.id))throw new Error(`duplicate id ${r.id}`);
  ids.add(r.id);seenExact.add(q);seenNorm.add(nq);
  groupCounts.set(group,gc+1);templateCounts.set(r.template_id,tc+1);
  generated.push(r);return true;
}
for(const f of families){
  let made=0, attempts=0;
  while(made<f.n && attempts<f.n*100){attempts++;if(accept(f.make()))made++;}
  if(made!==f.n)throw new Error(`${f.name}: generated ${made}/${f.n} after ${attempts} attempts; change template axes or lower quota`);
}
// Shuffle output so a --limit pilot covers diverse families. Fisher-Yates.
for(let i=generated.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[generated[i],generated[j]]=[generated[j],generated[i]];}
// IDs belong to output row order, so resume and failure rows are intuitive.
generated.forEach((r,i)=>{r.id=20600001+i;});
const csv=HEADER.join(',')+'\n'+generated.map(r=>HEADER.map(h=>csvCell(r[h])).join(',')).join('\n')+'\n';
writeFileSync(outPath,csv,'utf8');
const counts=(fn)=>Object.fromEntries([...generated.reduce((m,r)=>m.set(fn(r),(m.get(fn(r))??0)+1),new Map())].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])));
const overlapExact=generated.filter(r=>baselineExact.has(r.question)).length;
const overlapNorm=generated.filter(r=>baselineNorm.has(normalize(r.question))).length;
const manifest={
  generatorVersion:VERSION, seed, parserVersion:PARSER_VERSION, baselinePath,
  baselineRows:baselineRows.length-1, rowCount:generated.length,
  sha256:createHash('sha256').update(csv).digest('hex'),
  familyCounts:counts(r=>r.exploratory_family), grainCounts:counts(r=>r.expected_grain||'(unasserted)'),
  metricCounts:counts(r=>r.expected_metric||'(unasserted)'),
  aggregationCounts:counts(r=>r.expected_aggregation||'(unasserted)'),
  expectedStatusCounts:counts(r=>r.expected_status),
  majorScopeCounts:counts(r=>r.major_scope_type),
  templateCounts:counts(r=>r.template_id),
  supportCounts:counts(r=>r.exploratory_support),
  compositionDepthCounts:counts(r=>String(r.composition_depth)),
  exactDuplicateCount:generated.length-seenExact.size,
  normalizedDuplicateCount:generated.length-seenNorm.size,
  duplicateIdCount:generated.length-ids.size,
  maxEquivalenceGroupSize:Math.max(...groupCounts.values()),
  maxTemplateSize:Math.max(...templateCounts.values()),
  exactV5Overlap:overlapExact, normalizedV5Overlap:overlapNorm,
  rejectedCandidateCounts:rejected,
  intentionallyUnsupported:generated.filter(r=>r.exploratory_support==='unsupported').length,
  uncertainAuditRequired:generated.filter(r=>r.expected_status==='audit').length,
};
if(overlapExact||overlapNorm||manifest.exactDuplicateCount||manifest.normalizedDuplicateCount||manifest.duplicateIdCount)throw new Error('Uniqueness/independence invariant failed');
writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n','utf8');
process.stdout.write(`${VERSION}: ${generated.length} rows; seed ${seed}; parser v${PARSER_VERSION}\n`+
  `V5 overlap exact=${overlapExact} normalized=${overlapNorm}; audit-required=${manifest.uncertainAuditRequired}\n`+
  `Corpus ${outPath}\nManifest ${manifestPath}\n`);
