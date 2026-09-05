/**
 * Gridley compatibility mapping (AFLDB-ISSUE-118).
 *
 * Gridley (gridleygame.com) publishes a daily 3x3 AFL grid; AFLDB captures
 * every board as an external compatibility corpus (external_grids, migration
 * 080, tests/fixtures/gridley/corpus.json). This module is the deterministic
 * bridge from a Gridley criterion -- its stable `id`, `title`, `subtitle`
 * and Gridley's own `description` -- to the AFLDB Grid Solver axis that
 * means the same thing.
 *
 * Rules are keyed by Gridley's criterion id, never by fuzzy text: a criterion
 * the table does not know is reported as unrecognised, and each rule pins
 * the title it was written against so a redefinition upstream fails loudly
 * instead of silently mapping to the old meaning. Where AFLDB holds no data
 * for a question (coaches, birthplace, siblings, a medal AFLDB does not
 * record) the rule says so explicitly with the reason, so the corpus
 * denominator never loses a row. That status is a diagnostic, not a pass:
 * the issue's acceptance is zero unsupported valid criteria, and the corpus
 * regression fails on any of them unless run in diagnostic mode.
 *
 * Every id of AFLDB's own (club organizations, venues, awards, players) is
 * resolved through injected lookups, so this file stays pure and the
 * integration suite decides where the ids come from.
 *
 * Semantics were settled against Gridley's descriptions and its per-cell
 * answer keys; the decisions are recorded in issues/open/AFLDB-ISSUE-118.md.
 */

import { GRID_BUILDERS, isAxisComplete, type GridAxisState } from '@/search/grid-solver-spec';

// ------------------------------------------------------------------ types

export type GridleyItem = {
  id: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  type: string | null;
  /** AFL "champion" image id when the item carried a player image URL. */
  champId?: number;
};

export type GridleyPlayerRef = {
  criterionId: string;
  /** The player's name as Gridley titles it (upper case, no diacritics). */
  name: string;
  /** Gridley's own player id when the criterion id embeds one. */
  gridleyPlayerId: number | null;
  champId: number | null;
};

export type GridleyLookups = {
  /** club_organizations.slug -> id */
  clubs: Record<string, number>;
  /** venues.canonical_name -> id */
  venues: Record<string, number>;
  /** awards.slug -> id */
  awards: Record<string, number>;
  /** AFLDB players.id for a player-valued criterion, or null when unresolvable. */
  resolvePlayer: (ref: GridleyPlayerRef) => number | null;
};

export type GridleyUnsupportedCategory =
  /** The fact exists in the world but AFLDB holds no table or column for it. */
  | 'data_absent';

export type GridleyMapping =
  | { status: 'mapped'; axis: GridAxisState; note?: string }
  | { status: 'freebie'; reason: string }
  | { status: 'unsupported'; category: GridleyUnsupportedCategory; reason: string }
  | { status: 'unresolved'; reason: string }
  | { status: 'unrecognised'; reason: string };

// ---------------------------------------------------------- club codes

/** Gridley's club codes -> AFLDB organization slugs, with the title Gridley gives the criterion. */
export const GRIDLEY_CLUB_CODES: Record<string, { slug: string; title: string }> = {
  AD: { slug: 'adelaide', title: 'Adelaide Crows' },
  BL: { slug: 'brisbane-lions', title: 'Brisbane Lions' },
  CA: { slug: 'carlton', title: 'Carlton' },
  CW: { slug: 'collingwood', title: 'Collingwood' },
  ES: { slug: 'essendon', title: 'Essendon' },
  FR: { slug: 'fremantle', title: 'Fremantle' },
  GE: { slug: 'geelong', title: 'Geelong Cats' },
  GC: { slug: 'gold-coast', title: 'Gold Coast Suns' },
  GW: { slug: 'greater-western-sydney', title: 'GWS Giants' },
  HW: { slug: 'hawthorn', title: 'Hawthorn' },
  ME: { slug: 'melbourne', title: 'Melbourne' },
  KA: { slug: 'north-melbourne', title: 'North Melbourne' },
  PA: { slug: 'port-adelaide', title: 'Port Adelaide' },
  RI: { slug: 'richmond', title: 'Richmond' },
  SK: { slug: 'st-kilda', title: 'St Kilda' },
  SY: { slug: 'sydney', title: 'Sydney Swans' },
  WC: { slug: 'west-coast', title: 'West Coast Eagles' },
  WB: { slug: 'western-bulldogs', title: 'Western Bulldogs' },
};

const DEBUT_TEAMS: Record<string, { slug: string; title: string }> = {
  'debut-team-brisbane': { slug: 'brisbane-lions', title: 'BRISBANE LIONS' },
  'debut-team-carlton': { slug: 'carlton', title: 'CARLTON' },
  'debut-team-collingwood': { slug: 'collingwood', title: 'COLLINGWOOD' },
  'debut-team-essendon': { slug: 'essendon', title: 'ESSENDON' },
  'debut-team-fremantle': { slug: 'fremantle', title: 'FREMANTLE' },
  'debut-team-geelong': { slug: 'geelong', title: 'GEELONG' },
  'debut-team-goldcoast': { slug: 'gold-coast', title: 'GOLD COAST SUNS' },
  'debut-team-gws': { slug: 'greater-western-sydney', title: 'GWS GIANTS' },
  'debut-team-hawthorn': { slug: 'hawthorn', title: 'HAWTHORN' },
  'debut-team-melbourne': { slug: 'melbourne', title: 'MELBOURNE' },
  'debut-team-richmond': { slug: 'richmond', title: 'RICHMOND' },
  'debut-team-stkilda': { slug: 'st-kilda', title: 'ST KILDA' },
  'debut-team-sydney': { slug: 'sydney', title: 'SYDNEY SWANS' },
  'debut-team-westcoast': { slug: 'west-coast', title: 'WEST COAST EAGLES' },
  'debut-team-western-bulldogs': { slug: 'western-bulldogs', title: 'WESTERN BULLDOGS' },
};

// ---------------------------------------------------------------- rules

type RuleContext = { item: GridleyItem; lookups: GridleyLookups };
/** `titles` lists every title Gridley has given the criterion; any other title is a redefinition and is refused. */
type Rule = { titles: string[]; map: (ctx: RuleContext) => GridleyMapping };

const mapped = (builder: string, params: Record<string, string> = {}, note?: string): GridleyMapping => (
  note === undefined ? { status: 'mapped', axis: { builder, params } } : { status: 'mapped', axis: { builder, params }, note }
);
const absent = (reason: string): GridleyMapping => ({ status: 'unsupported', category: 'data_absent', reason });
const unresolved = (reason: string): GridleyMapping => ({ status: 'unresolved', reason });

function clubId(ctx: RuleContext, slug: string): string | GridleyMapping {
  const id = ctx.lookups.clubs[slug];
  return id === undefined ? unresolved(`club organization "${slug}" not found`) : String(id);
}
function venueId(ctx: RuleContext, name: string): string | GridleyMapping {
  const id = ctx.lookups.venues[name];
  return id === undefined ? unresolved(`venue "${name}" not found`) : String(id);
}
function awardId(ctx: RuleContext, slug: string): string | GridleyMapping {
  const id = ctx.lookups.awards[slug];
  return id === undefined ? unresolved(`award "${slug}" not found`) : String(id);
}
const isMapping = (v: string | GridleyMapping): v is GridleyMapping => typeof v !== 'string';

/** Rule builders that resolve one AFLDB id and then build the axis. */
const withClub = (slug: string, build: (id: string) => GridleyMapping) => (ctx: RuleContext) => {
  const id = clubId(ctx, slug);
  return isMapping(id) ? id : build(id);
};
const withVenue = (name: string, build: (id: string) => GridleyMapping) => (ctx: RuleContext) => {
  const id = venueId(ctx, name);
  return isMapping(id) ? id : build(id);
};
const withAward = (slug: string, build: (id: string) => GridleyMapping) => (ctx: RuleContext) => {
  const id = awardId(ctx, slug);
  return isMapping(id) ? id : build(id);
};
const withClubs = (slugA: string, slugB: string, build: (a: string, b: string) => GridleyMapping) => (ctx: RuleContext) => {
  const a = clubId(ctx, slugA);
  if (isMapping(a)) return a;
  const b = clubId(ctx, slugB);
  return isMapping(b) ? b : build(a, b);
};

const titles = (t: string | string[]) => (Array.isArray(t) ? t : [t]);
const fixed = (title: string | string[], mapping: GridleyMapping): Rule => ({ titles: titles(title), map: () => mapping });
const rule = (title: string | string[], map: (ctx: RuleContext) => GridleyMapping): Rule => ({ titles: titles(title), map });

const SHOWDOWN: [string, string] = ['port-adelaide', 'adelaide'];
const WESTERN_DERBY: [string, string] = ['west-coast', 'fremantle'];
const QCLASH: [string, string] = ['brisbane-lions', 'gold-coast'];
const SYDNEY_DERBY: [string, string] = ['sydney', 'greater-western-sydney'];

const NO_COACHES = 'AFLDB has no coaching data (no coaches table anywhere in the schema)';
const NO_LISTS = 'AFLDB models games played, not season lists: a listed player with no game is not represented';
const NO_SIBLINGS = 'player_relationships (migration 006) has never been populated on any environment';
const NO_FATHER_LINK = 'father_son_selections has never been populated; draft_picks.signing_kind names the son, not the father';
const NO_BIRTHPLACE = 'AFLDB has no birthplace, nationality or state-of-origin column';
const NO_OTHER_CODE = 'other-code (NFL) careers and International Rules representation are not modelled';
const NO_TIMELINE = 'no scoring-event timeline: an after-the-siren match winner cannot be derived';
const NO_SPOILS = 'spoils are not a recorded AFLDB statistic (one_percenters is a different measure)';
const NO_RECRUITER = 'recruiters and list managers are not modelled';

/**
 * Every non-player Gridley criterion id seen in the corpus, keyed by id.
 * Player-valued criteria (teammates, Grand Final opponents) are parsed by
 * mapPlayerCriterion below.
 */
export const GRIDLEY_RULES: Record<string, Rule> = {
  // -- decades and debut eras ------------------------------------------
  '1970s': fixed('PLAYED IN 1970s', mapped('played_in_decade', { decade: '1970' })),
  '1980s': fixed('PLAYED IN 1980s', mapped('played_in_decade', { decade: '1980' })),
  '1990s': fixed('PLAYED IN 1990s', mapped('played_in_decade', { decade: '1990' })),
  '2000s': fixed('PLAYED IN 2000s', mapped('played_in_decade', { decade: '2000' })),
  '2010s': fixed('PLAYED IN 2010s', mapped('played_in_decade', { decade: '2010' })),
  '2020s': fixed('PLAYED IN 2020s', mapped('played_in_decade', { decade: '2020' })),
  'debut-2000s': fixed('DEBUT GAME', mapped('debuted_in_decade', { decade: '2000' })),
  'debut-2010s': fixed('DEBUT GAME', mapped('debuted_in_decade', { decade: '2010' })),
  'debut-2020s': fixed('DEBUT GAME', mapped('debuted_in_decade', { decade: '2020' })),

  // -- clubs ("played at least 1 game for X, or currently on their list") --
  // AFLDB has no season lists, so the listed-but-never-played tail of every
  // club criterion is unrepresentable; the games-played reading is exact for
  // everyone else. Recorded as a note, not hidden.
  ...Object.fromEntries(Object.entries(GRIDLEY_CLUB_CODES).map(([code, { slug, title }]) => [
    code,
    rule(title, withClub(slug, (id) => (
      slug === 'brisbane-lions'
        ? mapped('played_for_club_incl_merged', { club: id }, 'Gridley: includes Brisbane Bears and Fitzroy; listed-never-played players are not modelled')
        : mapped('played_for_club', { club: id }, 'listed-never-played players are not modelled')
    ))),
  ])),
  bears: rule('BRISBANE', withClub('brisbane-bears', (id) => mapped('played_for_club', { club: id }))),
  ...Object.fromEntries(Object.entries(DEBUT_TEAMS).map(([id, { slug, title }]) => [
    id,
    rule(title, withClub(slug, (club) => (
      slug === 'brisbane-lions'
        ? mapped('debut_club_incl_merged', { club }, 'Gridley: includes Fitzroy and Brisbane Bears debutants')
        : mapped('debut_club', { club })
    ))),
  ])),

  // -- club journeys ------------------------------------------------------
  // Gridley counts clubs with the Bears/Fitzroy -> Lions merger folded
  // (Michael Voss is a one-club player on its boards), so every club-count
  // criterion maps to the *_incl_merged variant.
  clubs1: fixed('ONE CLUB', mapped('one_club_player_incl_merged')),
  'clubs2+': fixed('MULTI-CLUB', mapped('multi_club_player_incl_merged', {}, 'Gridley also counts a list move in the latest trade period; not modelled')),
  'clubs3+': fixed('3+ CLUB', mapped('clubs_played_min_incl_merged', { clubs: '3' }, 'Gridley also counts a list move in the latest off-season; not modelled')),
  games50clubs2: fixed('50+ GAMES', mapped('games_at_multiple_clubs_min_incl_merged', { games: '50', clubs: '2' })),
  games100clubs2: fixed('100+ GAMES', mapped('games_at_multiple_clubs_min_incl_merged', { games: '100', clubs: '2' })),
  goals30clubs2: fixed('30+ GOALS', mapped('goals_at_multiple_clubs_min_incl_merged', { goals: '30', clubs: '2' })),
  games100sameclub: fixed('100+ GAMES', mapped('games_at_one_club_min_incl_merged', { games: '100' })),
  games150sameclub: fixed('150+ GAMES', mapped('games_at_one_club_min_incl_merged', { games: '150' })),
  games200sameclub: fixed('200+ GAMES', mapped('games_at_one_club_min_incl_merged', { games: '200' })),
  games250sameclub: fixed('250+ GAMES', mapped('games_at_one_club_min_incl_merged', { games: '250' })),
  games300sameclub: fixed('300+ GAMES', mapped('games_at_one_club_min_incl_merged', { games: '300' })),
  disposals30clubs2: fixed('30+ DISPOSALS', mapped('single_game_stat_multi_club_min', { stat: 'disposals', x: '30', clubs: '2' })),

  // -- career games and goals ------------------------------------------
  games100: fixed('100+ GAMES', mapped('career_games_min', { games: '100' })),
  games150: fixed('150+ GAMES', mapped('career_games_min', { games: '150' })),
  games200: fixed('200+ GAMES', mapped('career_games_min', { games: '200' })),
  games250: fixed('250+ GAMES', mapped('career_games_min', { games: '250' })),
  games300: fixed('300+ GAMES', mapped('career_games_min', { games: '300' })),
  games50orless: fixed('50 GAMES', mapped('career_games_max', { games: '50' })),
  games100orless: fixed('100 GAMES', mapped('career_games_max', { games: '100' })),
  goals100career: fixed('100+ GOALS', mapped('career_goals_min', { goals: '100' })),
  goals150career: fixed('150+ GOALS', mapped('career_goals_min', { goals: '150' })),
  goals200career: fixed('200+ GOALS', mapped('career_goals_min', { goals: '200' })),
  goals300career: fixed('300+ GOALS', mapped('career_goals_min', { goals: '300' })),
  // "less than N" is "N-1 or fewer": strict bound by arithmetic, no loosening.
  goalscareerlessthan10: fixed('LESS THAN 10 GOALS', mapped('career_goals_max', { goals: '9' })),
  goalscareerlessthan20: fixed('LESS THAN 20 GOALS', mapped('career_goals_max', { goals: '19' })),
  goals1avgcareer: fixed('1+ GOAL', mapped('career_stat_avg_min', { stat: 'goals', avg: '1', minGames: '1' })),
  'goals1.5avgcareer': fixed('1.5+ GOALS', mapped('career_stat_avg_min', { stat: 'goals', avg: '1.5', minGames: '1' })),
  moreFFthanFAcareer: fixed('MORE FREES FOR THAN AGAINST', mapped('career_stat_exceeds', { statA: 'frees_for', statB: 'frees_against' })),
  'teammates-100': fixed('100+ TEAMMATES', mapped('career_teammates_min', { x: '100' })),
  'teammates-150': fixed('150+ TEAMMATES', mapped('career_teammates_min', { x: '150' })),

  // -- single-game feats -------------------------------------------------
  goals3match: fixed('3+ GOALS', mapped('single_game_stat_min', { stat: 'goals', x: '3' })),
  goals4match: fixed('4+ GOALS', mapped('single_game_stat_min', { stat: 'goals', x: '4' })),
  goals5match: fixed('5+ GOALS', mapped('single_game_stat_min', { stat: 'goals', x: '5' })),
  goals6match: fixed('6+ GOALS', mapped('single_game_stat_min', { stat: 'goals', x: '6' })),
  goals7match: fixed('7+ GOALS', mapped('single_game_stat_min', { stat: 'goals', x: '7' })),
  goals9match: fixed('9+ GOALS', mapped('single_game_stat_min', { stat: 'goals', x: '9' })),
  goals10match: fixed('10+ GOALS', mapped('single_game_stat_min', { stat: 'goals', x: '10' })),
  disposals25: fixed('25+ DISPOSALS', mapped('single_game_stat_min', { stat: 'disposals', x: '25' })),
  disposals30: fixed('30+ DISPOSALS', mapped('single_game_stat_min', { stat: 'disposals', x: '30' })),
  disposals35: fixed('35+ DISPOSALS', mapped('single_game_stat_min', { stat: 'disposals', x: '35' })),
  disposals40: fixed('40+ DISPOSALS', mapped('single_game_stat_min', { stat: 'disposals', x: '40' })),
  kicks20: fixed('20+ KICKS', mapped('single_game_stat_min', { stat: 'kicks', x: '20' })),
  kicks25: fixed('25+ KICKS', mapped('single_game_stat_min', { stat: 'kicks', x: '25' })),
  handballs20: fixed('20+ HANDBALLS', mapped('single_game_stat_min', { stat: 'handballs', x: '20' })),
  marks10match: fixed('10+ MARKS', mapped('single_game_stat_min', { stat: 'marks', x: '10' })),
  marks12match: fixed('12+ MARKS', mapped('single_game_stat_min', { stat: 'marks', x: '12' })),
  marks15match: fixed('15+ MARKS', mapped('single_game_stat_min', { stat: 'marks', x: '15' })),
  tackles10match: fixed('10+ TACKLES', mapped('single_game_stat_min', { stat: 'tackles', x: '10' })),
  hitouts20: fixed('20+ HITOUTS', mapped('single_game_stat_min', { stat: 'hitouts', x: '20' })),
  hitouts25: fixed('25+ HITOUTS', mapped('single_game_stat_min', { stat: 'hitouts', x: '25' })),
  hitouts30: fixed('30+ HITOUTS', mapped('single_game_stat_min', { stat: 'hitouts', x: '30' })),
  'disposals30-goals2': fixed('30+ DISPOSALS & 2+ GOALS', mapped('single_game_two_stats_min', { statA: 'disposals', xA: '30', statB: 'goals', xB: '2' })),
  'disposals30-goals3': fixed('30+ DISPOSALS & 3+ GOALS', mapped('single_game_two_stats_min', { statA: 'disposals', xA: '30', statB: 'goals', xB: '3' })),

  // -- season totals and averages ----------------------------------------
  goals25: fixed('25+ GOALS', mapped('season_stat_total_min', { stat: 'goals', x: '25' })),
  goals30: fixed('30+ GOALS', mapped('season_stat_total_min', { stat: 'goals', x: '30' })),
  goals35: fixed('35+ GOALS', mapped('season_stat_total_min', { stat: 'goals', x: '35' })),
  goals40: fixed('40+ GOALS', mapped('season_stat_total_min', { stat: 'goals', x: '40' })),
  goals50: fixed('50+ GOALS', mapped('season_stat_total_min', { stat: 'goals', x: '50' })),
  goals60: fixed('60+ GOALS', mapped('season_stat_total_min', { stat: 'goals', x: '60' })),
  goals80: fixed('80+ GOALS', mapped('season_stat_total_min', { stat: 'goals', x: '80' })),
  goals100: fixed('100+ GOALS', mapped('season_stat_total_min', { stat: 'goals', x: '100' })),
  freesagainst30season: fixed('30+ FREES AGAINST', mapped('season_stat_total_min', { stat: 'frees_against', x: '30' })),
  goalAssists20: fixed('20+ GOAL ASSISTS', mapped('season_stat_total_min', { stat: 'goal_assists', x: '20' })),
  goals1avgseason: fixed('1+ GOAL', mapped('season_stat_avg_min', { stat: 'goals', avg: '1' })),
  goals2avgseason: fixed('2+ GOAL', mapped('season_stat_avg_min', { stat: 'goals', avg: '2' })),
  disposals20avgseason: fixed('20+ DISPOSALS', mapped('season_stat_avg_min', { stat: 'disposals', avg: '20' })),
  disposals25avgseason: fixed('25+ DISPOSALS', mapped('season_stat_avg_min', { stat: 'disposals', avg: '25' })),
  marks5season: fixed('AVG 5+ MARKS', mapped('season_stat_avg_min', { stat: 'marks', avg: '5' })),
  tackles5season: fixed('AVG 5+ TACKLES', mapped('season_stat_avg_min', { stat: 'tackles', avg: '5' })),
  hitouts20season: fixed('AVG 20+ HITOUTS', mapped('season_stat_avg_min', { stat: 'hitouts', avg: '20' })),
  spoils5season: fixed('AVG 5+ SPOILS', absent(NO_SPOILS)),
  season2023games20: fixed('20+ GAMES', mapped('games_in_named_season_min', { season: '2023', games: '20' })),
  season2023goals15: fixed('15+ GOALS', mapped('named_season_stat_total_min', { season: '2023', stat: 'goals', x: '15' })),
  losses15season: fixed('15 LOSSES', mapped('season_losses_min', { times: '15' })),
  draw: fixed('PLAYED IN A DRAW', mapped('drawn_matches_min', { times: '1' })),
  wonby100: fixed('100 POINT WIN', mapped('won_by_margin_min', { margin: '100' })),
  wins10inarow: fixed('10 WINS', mapped('consecutive_wins_min', { times: '10' })),
  woodenspoon: fixed('WOODEN SPOON', mapped('wooden_spoon_season')),
  minorpremiers: fixed('MINOR PREMIERSHIP', mapped('minor_premiership_season')),

  // -- club and league leaders -------------------------------------------
  clubLeadingGoalKicker: fixed('LEADING GOALKICKER', mapped('club_season_stat_leader', { stat: 'goals' })),
  clubLeadingGoalKicker2x: fixed('2x LEADING GOALKICKER', mapped('club_season_stat_leader_min_times', { stat: 'goals', times: '2' })),
  clubLeadingGoalKicker3x: fixed('3x LEADING GOALKICKER', mapped('club_season_stat_leader_min_times', { stat: 'goals', times: '3' })),
  disposalsClubLeader: fixed('MOST DISPOSALS', mapped('club_season_stat_leader', { stat: 'disposals' })),
  marksClubLeader: fixed('MOST MARKS', mapped('club_season_stat_leader', { stat: 'marks' })),
  brownlowClubWinner: fixed('MOST BROWNLOW VOTES', mapped('club_season_brownlow_leader')),
  goalstop10season: fixed('TOP 10 GOAL KICKER', mapped('league_season_stat_rank_top', { stat: 'goals', place: '10' })),
  disposalstop10season: fixed('TOP 10 DISPOSAL', mapped('league_season_stat_rank_top', { stat: 'disposals', place: '10' })),
  markstop10season: fixed('TOP 10 MARK', mapped('league_season_stat_rank_top', { stat: 'marks', place: '10' })),

  // -- finals ---------------------------------------------------------------
  finals0: fixed('NEVER PLAYED FINALS', mapped('never_played_finals')),
  finals1: fixed('PLAYED IN A FINAL', mapped('played_in_a_final')),
  finals5: fixed('5+ FINALS', mapped('finals_games_min', { games: '5' })),
  finals10: fixed('10+ FINALS', mapped('finals_games_min', { games: '10' })),
  finals15: fixed('15+ FINALS', mapped('finals_games_min', { games: '15' })),
  finals20: fixed('20+ FINALS', mapped('finals_games_min', { games: '20' })),
  finals25: fixed('25+ FINALS', mapped('finals_games_min', { games: '25' })),
  finalswins0: fixed('NO FINALS WINS', mapped('never_won_a_final')),
  finalswins1: fixed('WON A FINALS GAME', mapped('won_a_final')),
  finalswins5: fixed('5+ FINALS', mapped('finals_wins_min', { x: '5' })),
  finalswins10: fixed('10+ FINALS', mapped('finals_wins_min', { x: '10' })),
  finalsMoreWinsThanLosses: fixed('WINNING RECORD', mapped('finals_winning_record')),
  finalsclubs2: fixed('FINALS PLAYER', mapped('finals_clubs_min_incl_merged', { clubs: '2' })),
  prelimfinals1: fixed('PRELIM FINAL', mapped('prelim_finals_played_min', { times: '1' })),
  prelimfinals2: fixed('2+ PRELIM', mapped('prelim_finals_played_min', { times: '2' })),
  prelimfinals3: fixed('3+ PRELIM', mapped('prelim_finals_played_min', { times: '3' })),
  prelimfinals4: fixed('4+ PRELIM', mapped('prelim_finals_played_min', { times: '4' })),
  goals1final: fixed('1+ GOALS', mapped('final_game_stat_min', { stat: 'goals', x: '1' })),
  goals2final: fixed('2+ GOALS', mapped('final_game_stat_min', { stat: 'goals', x: '2' })),
  goals3final: fixed('3+ GOALS', mapped('final_game_stat_min', { stat: 'goals', x: '3' })),
  goals4final: fixed('4+ GOALS', mapped('final_game_stat_min', { stat: 'goals', x: '4' })),
  goals5final: fixed('5+ GOALS', mapped('final_game_stat_min', { stat: 'goals', x: '5' })),
  disposals20final: fixed('20+ DISPOSALS', mapped('final_game_stat_min', { stat: 'disposals', x: '20' })),
  disposals25final: fixed('25+ DISPOSALS', mapped('final_game_stat_min', { stat: 'disposals', x: '25' })),
  disposals30final: fixed('30+ DISPOSALS', mapped('final_game_stat_min', { stat: 'disposals', x: '30' })),
  goals10finalscareer: fixed('10+ FINALS GOALS', mapped('finals_stat_total_min', { stat: 'goals', x: '10' })),
  goals15finalscareer: fixed('15+ FINALS GOALS', mapped('finals_stat_total_min', { stat: 'goals', x: '15' })),
  goals1avgfinalscareer: fixed('1+ GOAL AVG', mapped('finals_stat_avg_min', { stat: 'goals', avg: '1' })),

  // -- grand finals and premierships -------------------------------------
  grandfinals0: fixed('NO GRAND FINALS', mapped('never_played_grand_final')),
  grandfinals1: fixed('GRAND FINAL', mapped('played_a_grand_final')),
  grandfinals2: fixed('2+ GRAND', mapped('grand_finals_played_min', { times: '2' })),
  grandfinals3: fixed('3+ GRAND', mapped('grand_finals_played_min', { times: '3' })),
  grandfinals4: fixed('4+ GRAND', mapped('grand_finals_played_min', { times: '4' })),
  grandfinals1losses: fixed('LOST A GRAND FINAL', mapped('grand_finals_lost_min', { times: '1' })),
  grandfinals2losses: fixed('LOST 2+ GRAND FINALS', mapped('grand_finals_lost_min', { times: '2' })),
  grandfinalclubs2: fixed('GRAND FINAL', mapped('grand_final_clubs_min_incl_merged', { clubs: '2' })),
  'grandfinals1-2000s': fixed('GRAND FINAL PLAYER', mapped('grand_final_between_seasons', { from: '2000', to: '2009' })),
  'grandfinals2000s-playedin-1': fixed('GRAND FINAL PLAYER', mapped('grand_final_between_seasons', { from: '2000', to: '2009' })),
  'grandfinals2010s-playedin-1': fixed('GRAND FINAL PLAYER', mapped('grand_final_between_seasons', { from: '2010', to: '2019' })),
  'grandfinals2020s-playedin-1': fixed('GRAND FINAL PLAYER', mapped('grand_final_between_seasons', { from: '2020', to: '2029' })),
  gf0203: fixed("'02 or '03", mapped('grand_final_between_seasons', { from: '2002', to: '2003' })),
  gf04: fixed("'04 GRAND FINAL", mapped('grand_final_between_seasons', { from: '2004', to: '2004' })),
  gf0506: fixed("'05 or '06", mapped('grand_final_between_seasons', { from: '2005', to: '2006' })),
  gf15: fixed("'15 GRAND FINAL", mapped('grand_final_between_seasons', { from: '2015', to: '2015' })),
  gf16: fixed("'16 GRAND FINAL", mapped('grand_final_between_seasons', { from: '2016', to: '2016' })),
  gf17: fixed("'17 GRAND FINAL", mapped('grand_final_between_seasons', { from: '2017', to: '2017' })),
  gf23: fixed("'23 GRAND FINAL", mapped('grand_final_between_seasons', { from: '2023', to: '2023' })),
  'gf-beat-CW': rule("BEAT COLL'WOOD", withClub('collingwood', (club) => mapped('grand_final_won_against_club', { club }))),
  goals1grandfinal: fixed('1+ GOALS', mapped('grand_final_game_stat_min', { stat: 'goals', x: '1' })),
  goals2grandfinal: fixed('2+ GOALS', mapped('grand_final_game_stat_min', { stat: 'goals', x: '2' })),
  disposals20grandfinal: fixed('20+ DISPOSALS', mapped('grand_final_game_stat_min', { stat: 'disposals', x: '20' })),
  goals1grandfinals2: fixed('1+ GOAL', mapped('grand_finals_with_stat_min_count', { stat: 'goals', y: '1', times: '2' })),
  premier1x: fixed('PREMIERSHIP', mapped('premiership_player')),
  premier2x: fixed('MULTI-PREMIERSHIP', mapped('premierships_min', { times: '2' })),
  premier3x: fixed('3x PREMIERSHIP', mapped('premierships_min', { times: '3' })),
  premier4x: fixed('4x PREMIERSHIP', mapped('premierships_min', { times: '4' })),
  'premier1-2010s': fixed('PREMIERSHIP PLAYER', mapped('premiership_between_seasons', { from: '2010', to: '2019' })),
  'premier1-2020s': fixed('PREMIERSHIP PLAYER', mapped('premiership_between_seasons', { from: '2020', to: '2029' })),
  premcaptain: fixed('PREMIERSHIP', mapped('premiership_captain')),
  premcoach: fixed('PREMIERSHIP', absent(NO_COACHES)),
  bestfairestpremyear: fixed('B&F + PREMIERSHIP', mapped('best_and_fairest_in_premiership_season')),

  // -- venues ---------------------------------------------------------------
  'mcg-played-50': rule('PLAYED AT MCG', withVenue('Melbourne Cricket Ground', (venue) => mapped('games_at_venue_min', { venue, games: '50' }))),
  'mcg-played-100': rule('PLAYED AT MCG', withVenue('Melbourne Cricket Ground', (venue) => mapped('games_at_venue_min', { venue, games: '100' }))),
  'mcg-goals-1': rule('MCG', withVenue('Melbourne Cricket Ground', (venue) => mapped('venue_game_stat_min', { venue, stat: 'goals', x: '1' }))),
  'mcg-finalswins1': rule('MCG', withVenue('Melbourne Cricket Ground', (venue) => mapped('won_final_at_venue', { venue }))),
  'docklands-played-1': rule('MARVEL STADIUM', withVenue('Docklands', (venue) => mapped('played_at_venue', { venue }))),
  'docklands-played-50': rule('MARVEL STADIUM', withVenue('Docklands', (venue) => mapped('games_at_venue_min', { venue, games: '50' }))),
  'docklands-goals-1': rule('MARVEL STADIUM', withVenue('Docklands', (venue) => mapped('venue_game_stat_min', { venue, stat: 'goals', x: '1' }))),
  'kardinia-played-50': rule('GMHBA STADIUM', withVenue('Kardinia Park', (venue) => mapped('games_at_venue_min', { venue, games: '50' }))),
  'gabba-played-50': rule('GABBA', withVenue('Gabba', (venue) => mapped('games_at_venue_min', { venue, games: '50' }))),
  'gabba-goals-1': rule('GABBA', withVenue('Gabba', (venue) => mapped('venue_game_stat_min', { venue, stat: 'goals', x: '1' }))),
  'scg-goals-1': rule('SCG', withVenue('Sydney Cricket Ground', (venue) => mapped('venue_game_stat_min', { venue, stat: 'goals', x: '1' }))),
  'scg-finalswins1': rule('SCG', withVenue('Sydney Cricket Ground', (venue) => mapped('won_final_at_venue', { venue }))),
  'ao-finalswins1': rule('ADELAIDE OVAL', withVenue('Adelaide Oval', (venue) => mapped('won_final_at_venue', { venue }))),
  'bellerive-goals-1': rule('NINJA STADIUM', withVenue('Bellerive Oval', (venue) => mapped('venue_game_stat_min', { venue, stat: 'goals', x: '1' }))),
  china: rule('PLAYED IN CHINA', withVenue('Jiangwan Stadium', (venue) => mapped('played_at_venue', { venue }))),

  // -- rivalries and marquee matches ---------------------------------------
  'showdown-playedin-1': rule('SHOWDOWN', withClubs(...SHOWDOWN, (clubA, clubB) => mapped('matchup_played_min', { clubA, clubB, times: '1' }))),
  'showdown-playedin-2': rule('SHOWDOWN', withClubs(...SHOWDOWN, (clubA, clubB) => mapped('matchup_played_min', { clubA, clubB, times: '2' }))),
  'showdown-playedin-5': rule('SHOWDOWN', withClubs(...SHOWDOWN, (clubA, clubB) => mapped('matchup_played_min', { clubA, clubB, times: '5' }))),
  'showdown-playedin-10': rule('SHOWDOWN', withClubs(...SHOWDOWN, (clubA, clubB) => mapped('matchup_played_min', { clubA, clubB, times: '10' }))),
  'showdown-won-1': rule('SHOWDOWN', withClubs(...SHOWDOWN, (clubA, clubB) => mapped('matchup_won_min', { clubA, clubB, times: '1' }))),
  'showdown-goals-1': rule('SHOWDOWN', withClubs(...SHOWDOWN, (clubA, clubB) => mapped('matchup_game_stat_min', { clubA, clubB, stat: 'goals', x: '1' }))),
  'showdown-tackles-5': rule('SHOWDOWN', withClubs(...SHOWDOWN, (clubA, clubB) => mapped('matchup_game_stat_min', { clubA, clubB, stat: 'tackles', x: '5' }))),
  'showdown-medal': rule('SHOWDOWN', withAward('showdown-medal', (award) => mapped('award_winner', { award }))),
  'derby-playedin-10': rule('WESTERN DERBY', withClubs(...WESTERN_DERBY, (clubA, clubB) => mapped('matchup_played_min', { clubA, clubB, times: '10' }))),
  'derby-goals-1': rule('WESTERN DERBY', withClubs(...WESTERN_DERBY, (clubA, clubB) => mapped('matchup_game_stat_min', { clubA, clubB, stat: 'goals', x: '1' }))),
  'derby-tackles-5': rule('WESTERN DERBY', withClubs(...WESTERN_DERBY, (clubA, clubB) => mapped('matchup_game_stat_min', { clubA, clubB, stat: 'tackles', x: '5' }))),
  'derby-winning-record': rule('WINNING RECORD', withClubs(...WESTERN_DERBY, (clubA, clubB) => mapped('matchup_winning_record', { clubA, clubB }))),
  glendenning: rule('GLENDINNING', withAward('glendinning-allan-medal', (award) => mapped('award_winner', { award }))),
  'qclash-playedin-3': rule('QCLASH', withClubs(...QCLASH, (clubA, clubB) => mapped('matchup_played_min', { clubA, clubB, times: '3' }))),
  'qclash-playedin-5': rule('QCLASH', withClubs(...QCLASH, (clubA, clubB) => mapped('matchup_played_min', { clubA, clubB, times: '5' }))),
  'qclash-playedin-10': rule('QCLASH', withClubs(...QCLASH, (clubA, clubB) => mapped('matchup_played_min', { clubA, clubB, times: '10' }))),
  'qclash-goals-1': rule('QCLASH', withClubs(...QCLASH, (clubA, clubB) => mapped('matchup_game_stat_min', { clubA, clubB, stat: 'goals', x: '1' }))),
  'qclash-medal': rule('MARCUS ASHCROFT', withAward('marcus-ashcroft-medal', (award) => mapped('award_winner', { award }))),
  'battleofthebridge-playedin-1': rule('SYDNEY DERBY', withClubs(...SYDNEY_DERBY, (clubA, clubB) => mapped('matchup_played_min', { clubA, clubB, times: '1' }))),
  'battleofthebridge-playedin-3': rule('SYDNEY DERBY', withClubs(...SYDNEY_DERBY, (clubA, clubB) => mapped('matchup_played_min', { clubA, clubB, times: '3' }))),
  'battleofthebridge-goals-1': rule('SYDNEY DERBY', withClubs(...SYDNEY_DERBY, (clubA, clubB) => mapped('matchup_game_stat_min', { clubA, clubB, stat: 'goals', x: '1' }))),
  'battleofthebridge-tackles-5': rule('SYDNEY DERBY', withClubs(...SYDNEY_DERBY, (clubA, clubB) => mapped('matchup_game_stat_min', { clubA, clubB, stat: 'tackles', x: '5' }))),
  'battleofthebridge-medal': rule('BRETT KIRK', withAward('brett-kirk-medal', (award) => mapped('award_winner', { award }))),
  'anzac-playedin-1': fixed('ANZAC DAY MATCH', mapped('match_event_played', { event: 'Anzac Day' })),
  'anzac-won-1': fixed('ANZAC DAY MATCH', mapped('match_event_won', { event: 'Anzac Day' })),
  anzacmedal: rule('ANZAC', withAward('anzac-medal', (award) => mapped('award_winner', { award }))),
  'dreamtime-playedin-1': fixed(["DREAMTIME AT THE 'G", 'DREAMTIME MATCH'], mapped('match_event_played', { event: "Dreamtime at the 'G" })),
  'bigfreeze-playedin-1': fixed('BIG FREEZE MATCH', mapped('match_event_played_between', { event: "King's Birthday", from: '2015', to: '2099' })),
  'gatherround-playedin-1': fixed('GATHER ROUND', mapped('gather_round_played')),
  'gatherround-goals-1': fixed('GATHER ROUND', mapped('gather_round_game_stat_min', { stat: 'goals', x: '1' })),

  // -- captaincy -------------------------------------------------------------
  // captaincies covers every club lineage since AFLDB-ISSUE-118 §23.21 (the six
  // the bootstrap lacked were transcribed from the Wikipedia captain lists).
  captain: fixed('CLUB CAPTAIN', mapped('club_captain_any')),

  // -- Brownlow --------------------------------------------------------------
  brownlow: fixed('BROWNLOW', mapped('brownlow_medallist')),
  brownlow10votes: fixed('10+ BROWNLOW VOTES', mapped('brownlow_season_votes_min', { votes: '10' })),
  brownlow15votes: fixed('15+ BROWNLOW VOTES', mapped('brownlow_season_votes_min', { votes: '15' })),
  brownlow50votes: fixed('50+ CAREER', mapped('brownlow_votes_career_min', { votes: '50' })),
  brownlow100votes: fixed('100+ CAREER', mapped('brownlow_votes_career_min', { votes: '100' })),
  brownlowTop5: fixed('TOP 5', mapped('brownlow_top_finish', { place: '5' })),
  brownlowTop10: fixed('TOP 10', mapped('brownlow_top_finish', { place: '10' })),
  brownlowOver25: fixed('WON BROWNLOW', mapped('brownlow_winner_votes_min', { votes: '25' })),

  // -- awards and honours ----------------------------------------------------
  // The FINAL team (AFLDB award all-australian: 1953-1988 carnival teams,
  // 1982-1990 VFL Team of the Year, 1991+ selected teams), never the
  // 40-man squad. Dedicated builders; repeats count distinct seasons.
  allAus1953: fixed('ALL AUSTRALIAN', mapped('all_australian_team')),
  allAus2x: fixed('2x ALL AUSTRALIAN', mapped('all_australian_team_min_times', { times: '2' })),
  allAus3x: fixed('3x ALL AUSTRALIAN', mapped('all_australian_team_min_times', { times: '3' })),
  allAus1990s: fixed('ALL AUSTRALIAN', mapped('all_australian_team_between_seasons', { from: '1990', to: '1999' })),
  allAus2000s: fixed('ALL AUSTRALIAN', mapped('all_australian_team_between_seasons', { from: '2000', to: '2009' })),
  allAus2010s: fixed('ALL AUSTRALIAN', mapped('all_australian_team_between_seasons', { from: '2010', to: '2019' })),
  allAus2020s: fixed('ALL AUSTRALIAN', mapped('all_australian_team_between_seasons', { from: '2020', to: '2029' })),
  allAusDef: fixed('ALL AUSTRALIAN', mapped('all_australian_defender')),
  allAusFwd: fixed('ALL AUSTRALIAN', mapped('all_australian_forward')),
  allAusMid: fixed('ALL AUSTRALIAN', mapped('all_australian_midfielder')),
  allAusRuc: fixed('ALL AUSTRALIAN', mapped('all_australian_position', { position: 'Ru' })),
  allAusSquad2024: fixed('ALL-AUSTRALIAN SQUAD', mapped('all_australian_squad_in_season', { season: '2024' })),
  clubbestfairest: fixed('BEST & FAIREST', mapped('club_best_and_fairest_min_times', { times: '1' })),
  clubbestfairest2: fixed('2+ BEST & FAIREST', mapped('club_best_and_fairest_min_times', { times: '2' })),
  risingStarNomination: fixed('RISING STAR', mapped('rising_star_nominee')),
  risingStar: rule('RISING STAR', withAward('rising-star', (award) => mapped('award_winner', { award }))),
  norm: rule('NORM SMITH', withAward('norm-smith-medal', (award) => mapped('award_winner', { award }))),
  coleman: rule('COLEMAN', withAward('coleman', (award) => mapped('award_winner', { award }))),
  aflpamvp: rule('AFLPA MVP', withAward('aflpa-mvp', (award) => mapped('award_winner', { award }))),
  '22under22': fixed('22 UNDER 22', mapped('under_22_selection')),
  hof: fixed('HALL OF FAME', mapped('hall_of_fame_player')),
  moty: rule('MARK OF THE YEAR', withAward('mark-of-the-year', (award) => mapped('award_winner', { award }))),
  goty: rule('GOAL OF THE YEAR', withAward('goal-of-the-year', (award) => mapped('award_winner', { award }))),

  // -- draft and recruitment -------------------------------------------------
  pick1: fixed('PICK 1', mapped('national_draft_pick_between', { from: '1', to: '1' })),
  picktop5: fixed('TOP 5', mapped('national_draft_pick_between', { from: '1', to: '5' })),
  picktop10: fixed('TOP 10', mapped('national_draft_pick_between', { from: '1', to: '10' })),
  pickrookie: fixed('ROOKIE', mapped('draft_type_is', { draftType: 'Rookie' })),
  traded1: fixed('TRADED', mapped('traded_min_times', { times: '1' })),
  freeagent1: fixed('FREE AGENT', mapped('draft_type_is', { draftType: 'Free Agency' })),
  fatherson: fixed('FATHER SON PICK', mapped('recruited_via', { signingKind: 'Father-Son' })),
  fathersonfather: fixed('FATHER OF', absent(NO_FATHER_LINK)),
  recruitedByDodoro: fixed('ADRIAN DODORO', absent(NO_RECRUITER)),

  // -- names and numbers -------------------------------------------------------
  namedsteven: fixed('STEVE / STEVEN', mapped('given_name_in', { names: 'Steve,Steven,Stephen,Stefan' })),
  'name-hyphenated': fixed('HYPHENATED SURNAME', mapped('surname_hyphenated')),
  worn3: fixed('WORN #3', mapped('jumper_number_worn', { number: '3' })),
  worn9: fixed('WORN #9', mapped('jumper_number_worn', { number: '9' })),
  worn13: fixed('WORN #13', mapped('jumper_number_worn', { number: '13' })),
  worn25: fixed('WORN #25', mapped('jumper_number_worn', { number: '25' })),
  worn35: fixed('WORN #35', mapped('jumper_number_worn', { number: '35' })),

  // -- biography ---------------------------------------------------------------
  // Exact bounds on players.height_cm; an unknown height never qualifies.
  // The column is filled from the AFL Tables player register through
  // player_height_evidence (ISSUE-118 Stage H2, tools/migration/
  // enrich_heights.py); a player the register does not cover stays NULL
  // and is reported by the corpus regression, never guessed.
  height195: fixed('195cm', mapped('height_min', { cm: '195' })),
  height180: fixed('180cm', mapped('height_max', { cm: '180' })),
  // "22+ YEARS OLD / ON DEBUT": completed years on debut day, from players.dob
  // (fitzRoy per-match dates plus the AFL Tables all-time club lists, ISSUE-118
  // Stage D1, tools/migration/enrich_birth_dates_afltables.py) and the derived
  // player_career_stats.debut_date. A player with no recorded date never
  // qualifies and is reported by the corpus regression, never guessed.
  debut22: fixed('22+ YEARS OLD', mapped('age_on_debut_min', { years: '22' })),

  // -- attributes AFLDB does not hold ------------------------------------------
  brother: fixed('BROTHER', absent(NO_SIBLINGS)),
  irish: fixed('IRISH PLAYER', absent(NO_BIRTHPLACE)),
  tasmanian: fixed('TASMANIAN', absent(NO_BIRTHPLACE)),
  nfl: fixed('NFL 🏈', absent(NO_OTHER_CODE)),
  intrulesplayer: fixed("INT'L RULES", absent(NO_OTHER_CODE)),
  season2024player: fixed('2024 LISTED PLAYER', absent(NO_LISTS)),
  winaftersiren: fixed('GAME WINNING', absent(NO_TIMELINE)),

  // -- the freebie ----------------------------------------------------------------
  'free-hit': fixed('FREE HIT', { status: 'freebie', reason: 'Gridley: "Select any player you like" -- every player qualifies' }),
};

// -------------------------------------------------------- player criteria

const TEAMMATE_ID_RE = /^(?<slug>[a-z0-9-]+)-teammate-(?<id>\d+)$/;
const GF_OPP_ID_RE = /^(?<slug>[a-z0-9-]+)-gf-opp-(?<id>\d+)$/;
const COACHED_BY_RE = /^coachedBy[A-Z]/;

function playerRef(item: GridleyItem, gridleyPlayerId: number | null): GridleyPlayerRef {
  return {
    criterionId: item.id,
    name: item.title.trim(),
    gridleyPlayerId,
    champId: item.champId ?? null,
  };
}

/**
 * Player-valued criteria: teammates and Grand Final opponents. Recognised by
 * shape -- the id pattern or the subtitle -- and resolved to an AFLDB
 * player through the injected resolver.
 */
function mapPlayerCriterion(ctx: RuleContext): GridleyMapping | null {
  const { item, lookups } = ctx;
  if (COACHED_BY_RE.test(item.id)) return absent(NO_COACHES);

  const gfOpp = GF_OPP_ID_RE.exec(item.id);
  if (gfOpp) {
    const id = lookups.resolvePlayer(playerRef(item, Number(gfOpp.groups!.id)));
    return id === null
      ? unresolved(`player "${item.title}" (${item.id}) not resolved`)
      : mapped('lost_grand_final_against', { player: String(id) });
  }

  const teammate = TEAMMATE_ID_RE.exec(item.id);
  const subtitle = (item.subtitle ?? '').toUpperCase();
  if (teammate || (item.type === 'player' && subtitle.includes('TEAMMATE'))) {
    const id = lookups.resolvePlayer(playerRef(item, teammate ? Number(teammate.groups!.id) : null));
    return id === null
      ? unresolved(`player "${item.title}" (${item.id}) not resolved`)
      : mapped('teammate_of', { player: String(id) });
  }
  return null;
}

// -------------------------------------------------------------- entry point

/** Map one Gridley criterion to its AFLDB Grid Solver meaning. */
export function mapGridleyCriterion(item: GridleyItem, lookups: GridleyLookups): GridleyMapping {
  const ctx = { item, lookups };
  const rule = Object.hasOwn(GRIDLEY_RULES, item.id) ? GRIDLEY_RULES[item.id] : undefined;
  if (rule) {
    if (!rule.titles.includes(item.title.trim())) {
      return { status: 'unrecognised', reason: `criterion "${item.id}" is titled "${item.title}" but the rule expects "${rule.titles.join('" or "')}"` };
    }
    return finish(rule.map(ctx));
  }
  const player = mapPlayerCriterion(ctx);
  if (player) return finish(player);
  return { status: 'unrecognised', reason: `no rule for criterion "${item.id}" ("${item.title}")` };
}

/** A mapped axis must name a real builder with every parameter filled -- the same gate the page applies. */
function finish(mapping: GridleyMapping): GridleyMapping {
  if (mapping.status !== 'mapped') return mapping;
  if (!Object.hasOwn(GRID_BUILDERS, mapping.axis.builder)) {
    throw new Error(`Gridley rule maps to unknown builder "${mapping.axis.builder}"`);
  }
  if (!isAxisComplete(mapping.axis)) {
    throw new Error(`Gridley rule for "${mapping.axis.builder}" leaves a parameter empty`);
  }
  return mapping;
}

/** Normalise a person's name for matching: case, punctuation, diacritics and generational suffixes removed. */
export function normalisePlayerName(name: string): string {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\b(jr|jnr|sr|snr)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
