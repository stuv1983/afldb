import { writeFileSync } from 'node:fs';

const out = 'tmp-nl-ui-expanded-v23.csv';
const rows = [['id', 'category', 'question', 'expected_status', 'tags']];

function csv(value) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function add(category, question, expected = 'plan', tags = []) {
  rows.push([
    `exp_${String(rows.length).padStart(4, '0')}`,
    category,
    question,
    expected,
    tags.join(','),
  ]);
}

const clubs = ['Richmond', 'Collingwood', 'Carlton', 'Essendon', 'Geelong', 'Hawthorn', 'Melbourne', 'Sydney', 'Brisbane Lions', 'West Coast'];
const opponents = ['Collingwood', 'Carlton', 'Essendon', 'Richmond', 'Geelong', 'Hawthorn', 'Sydney', 'West Coast'];
const players = ['Dustin Martin', 'Scott Pendlebury', 'Patrick Dangerfield', 'Lance Franklin', 'Gary Ablett Snr'];
const metrics = ['goals', 'goal', 'marks', 'kicks', 'handballs', 'disposals'];
const statMetrics = ['inside 50s', 'I50s', 'rebound 50s', 'R50s', 'clearances', 'clangers', 'contested possessions', 'uncontested possessions'];
const venues = ['MCG', 'Marvel', 'Kardinia', 'Gabba', 'SCG', 'Optus Stadium', 'Waverley', 'Football Park', 'UTAS', 'Adelaide Oval'];
const historical = ['Brisbane Bears', 'Fitzroy', 'South Melbourne', 'Footscray', 'University'];
const slang = ['Dusty most possies against Carlton', 'Buddy most snags in a final', 'Danger most touches in a game', 'Pies biggest win at the G', 'Dons highest score at Marvel'];

for (const metric of metrics) {
  add('grand_final_record', `Grand Final record for ${metric}`, 'plan', ['grand_final', 'record']);
  add('grand_final_record', `Grand Final ${metric} leader`, 'plan', ['grand_final', 'leader']);
  add('grand_final_record', `most ${metric}s in a Grand Final`, 'plan', ['grand_final', 'plural']);
  add('finals_record', `finals record for ${metric}s`, 'plan', ['finals', 'record']);
  add('finals_record', `most ${metric}s in a final`, 'plan', ['finals', 'single_final']);
}

for (const opponent of opponents) {
  add('career_leader', `career goal leader against ${opponent}`, 'plan', ['leader', 'opponent']);
  add('career_leader', `record holder for goals against ${opponent}`, 'plan', ['record_holder', 'opponent']);
  add('career_leader', `leading goal kicker against ${opponent}`, 'plan', ['leading', 'opponent']);
}

for (const club of clubs) {
  add('highest_lowest_pair', `highest score by ${club}`, 'plan', ['highest']);
  add('highest_lowest_pair', `lowest score by ${club}`, 'plan', ['lowest']);
  add('period_split', `highest H1 score by ${club}`, 'plan', ['H1']);
  add('period_split', `lowest H2 score by ${club}`, 'plan', ['H2']);
  add('period_split', `highest Q1 score by ${club}`, 'plan', ['Q1']);
  add('period_split', `lowest Q4 score by ${club}`, 'plan', ['Q4']);
}

for (const venue of venues) {
  add('venue_alias', `highest score at ${venue}`, 'plan', ['venue']);
  add('venue_alias', `fewest points scored at ${venue}`, 'plan', ['venue', 'lowest']);
  add('venue_alias', `most goals in a final at ${venue}`, 'plan', ['venue', 'final']);
}

for (const club of historical) {
  add('historical_identity', `${club} highest score`, 'plan', ['historical_club']);
  add('historical_identity', `fewest points scored by ${club}`, 'plan', ['historical_club', 'lowest']);
  add('historical_identity', `${club} biggest win at the MCG`, 'plan', ['historical_club', 'venue']);
}

for (const player of players) {
  for (const opponent of ['Richmond', 'Carlton', 'Collingwood', 'Essendon']) {
    add('player_opponent', `${player} most handballs against ${opponent}`, 'plan', ['player', 'opponent']);
    add('player_opponent', `${player} total goals against ${opponent}`, 'plan', ['player', 'sum']);
  }
}

for (const metric of statMetrics) {
  add('advanced_metric', `most ${metric} in a game`, 'plan', ['advanced']);
  add('advanced_metric', `most ${metric} in a season`, 'plan', ['advanced', 'season']);
  add('coverage', `most ${metric} in the 1960s`, 'decline', ['coverage']);
  add('coverage', `most ${metric} between 1897 and 1900`, 'decline', ['coverage']);
}

for (const threshold of [1, 2, 3, 4, 5, 10, 20, 50, 100, 200]) {
  add('having_threshold', `teams with at least ${threshold} wins against Carlton`, 'plan', ['having', 'gte']);
  add('having_threshold', `teams with more than ${threshold} losses against Geelong`, 'plan', ['having', 'gt']);
  add('career_conditions', `players with ${threshold}+ games and exactly ${threshold} goals`, 'plan', ['numeric', 'gte_eq']);
  add('career_conditions', `players with at most ${threshold} games`, 'plan', ['at_most']);
  add('collision', `players with most ${threshold} games`, 'decline', ['most_number_collision']);
}

for (const question of [
  'Dustin Martin most handballs against Richmond',
  'Dustin Martin total handballs against Richmond',
  'Dustin Martin highest handballs game against Richmond',
  'Scott Pendlebury most goals against Collingwood',
  'Patrick Dangerfield most disposals against Geelong',
  'Lance Franklin total goals against Hawthorn',
  'Richmond most goals against Richmond',
  'Carlton highest score against Carlton',
]) {
  add('self_opponent', question, 'plan', ['self_opponent', 'impossible_scope']);
}

for (const surname of ['Ablett', 'Brown', 'Smith', 'Jones', 'Johnson', 'Williams']) {
  add('ambiguous_surname', `${surname} most goals`, 'plan', ['ambiguous_surname']);
  add('ambiguous_surname', `${surname} most games`, 'plan', ['ambiguous_surname']);
}

for (const question of slang) add('slang_acronym', question, 'plan', ['slang']);

for (const metric of ['goals', 'marks', 'disposals']) {
  add('debut_boundary', `most ${metric} on debut`, 'plan', ['debut']);
  add('debut_boundary', `most ${metric} in debut season`, 'plan', ['debut_season']);
  add('finals_boundary', `most finals played`, 'plan', ['finals_played']);
  add('finals_boundary', `most ${metric} in a final`, 'plan', ['in_a_final']);
}

for (const prefix of ['please', 'quick one', 'show me', 'can you tell me']) {
  add('filler_metamorphic', `${prefix} Grand Final record for goals`, 'plan', ['filler', 'record']);
  add('filler_metamorphic', `${prefix} career goal leader against Collingwood`, 'plan', ['filler', 'leader']);
}

let cursor = 0;
while (rows.length <= 501) {
  const club = clubs[cursor % clubs.length];
  const opponent = opponents[(cursor * 3) % opponents.length];
  const metric = metrics[(cursor * 5) % metrics.length];
  const venue = venues[(cursor * 7) % venues.length];
  const season = 1965 + (cursor % 60);
  const forms = [
    [`stratified_player_game`, `most ${metric}s by a ${club} player against ${opponent}`, 'plan', ['player_game']],
    [`stratified_team_match`, `${club} lowest score at ${venue}`, 'plan', ['team_match']],
    [`stratified_season`, `most ${metric}s in ${season}`, 'plan', ['season']],
    [`stratified_final`, `most ${metric}s in a final at ${venue}`, 'plan', ['final', 'venue']],
  ];
  const [category, question, expected, tags] = forms[cursor % forms.length];
  add(category, question, expected, tags);
  cursor++;
}

writeFileSync(out, rows.map((row) => row.map(csv).join(',')).join('\n') + '\n');
console.log(`${rows.length - 1} rows -> ${out}`);
