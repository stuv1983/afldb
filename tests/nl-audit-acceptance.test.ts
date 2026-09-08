import { describe, expect, it } from 'vitest';

import { parseNlQuestion, type NlParseContext } from '@/search/nl/parser';
import { validatePlan, type NlQueryPlan } from '@/search/nl/plan';
import type { NlClubDirectoryEntry, NlCoachDirectoryEntry, NlVenueDirectoryEntry } from '@/search/nl/entities';

const clubs: NlClubDirectoryEntry[] = [
  { organizationId: 1, slug: 'richmond', name: 'Richmond', names: ['richmond', 'tigers'] },
  { organizationId: 2, slug: 'essendon', name: 'Essendon', names: ['essendon', 'dons'] },
  { organizationId: 3, slug: 'collingwood', name: 'Collingwood', names: ['collingwood', 'pies', 'magpies'] },
  { organizationId: 4, slug: 'carlton', name: 'Carlton', names: ['carlton', 'blues'] },
  { organizationId: 5, slug: 'geelong', name: 'Geelong', names: ['geelong', 'cats'] },
  { organizationId: 6, slug: 'hawthorn', name: 'Hawthorn', names: ['hawthorn', 'hawks'] },
  { organizationId: 7, slug: 'sydney', name: 'Sydney', names: ['sydney', 'swans', 'bloods'] },
  { organizationId: 8, slug: 'st-kilda', name: 'St Kilda', names: ['st kilda', 'saints'] },
  { organizationId: 9, slug: 'brisbane-lions', name: 'Brisbane Lions', names: ['brisbane lions', 'lions'] },
  { organizationId: 10, slug: 'brisbane-bears', name: 'Brisbane Bears', names: ['brisbane bears', 'bears'] },
  { organizationId: 11, slug: 'gold-coast', name: 'Gold Coast', names: ['gold coast', 'suns'] },
  { organizationId: 12, slug: 'fitzroy', name: 'Fitzroy', names: ['fitzroy', 'lions'] },
];

const venues: NlVenueDirectoryEntry[] = [
  { id: 1, slug: 'mcg', name: 'Melbourne Cricket Ground', names: ['mcg', 'melbourne cricket ground'] },
  { id: 2, slug: 'scg', name: 'Sydney Cricket Ground', names: ['scg', 'sydney cricket ground'] },
  { id: 3, slug: 'waverley', name: 'Waverley Park', names: ['waverley', 'waverley park'] },
  { id: 4, slug: 'docklands', name: 'Docklands Stadium', names: ['docklands', 'marvel', 'marvel stadium'] },
  { id: 5, slug: 'optus-stadium', name: 'Optus Stadium', names: ['optus stadium'] },
  { id: 6, slug: 'utas-stadium', name: 'UTAS Stadium', names: ['utas', 'utas stadium'] },
  { id: 7, slug: 'kardinia-park', name: 'Kardinia Park', names: ['kardinia', 'kardinia park'] },
  { id: 8, slug: 'gabba', name: 'The Gabba', names: ['gabba', 'the gabba'] },
];

const ctx: NlParseContext = { clubs, venues, resolvePlayer: async () => [] };

const questions = [
  'most hit out Richmond v Essendon Round 5 1984',
  'most hitout Fitzroy v Richmond round 3 1984',
  'most disposals Collingwood v Carlton Round 1 2010',
  'highest score by Geelong in Round 15 2008',
  'most goals in a Grand Final',
  'fewest points scored in a final at the MCG',
  'Hawthorn highest score in Round 3',
  'highest H2 score by the Magpies',
  'most goals in Q1 by a player',
  'biggest win margin in a first half',
  'biggest margin at half time',
  'biggest margin at half time but won',
  'biggest margin at quatre time but won',
  'biggest margin at three quarter time but won',
  'biggest lead at half time',
  'highest team score in Q3',
  'most disposals in the fourth quarter in 2023',
  'lowest second half score by Essendon',
  "richmond's longest winning strea",
  'longest winning streak against the Blues',
  'Swans longest losing streak at the SCG',
  'longest unbeaten streak in finals',
  'Hawthorn longest winning streak at Waverley',
  'longest losing streak against Collingwood',
  'teams with more than 3 wins against the Lions',
  'teams to lose 5 times by more than 100 points',
  'teams with at least 10 wins at the SCG',
  'teams with more than 5 losses against Geelong since 2000',
  'Bloods biggest win at Marvel',
  'Dons biggest blowout win at Optus Stadium',
  'fewest points scored by the Bears at UTAS',
  'Pies highest score at Kardinia',
  'Suns biggest margin at the Gabba',
  'most contested possessions in a game',
  'most uncontested possessions in a season',
  'most inside 50s in a match',
  'most clearances in a game by a Carlton player',
  'most brownlow votes in a season',
  'most rebound 50s in a final',
  'most goal assists in a match',
  'players with more than 300 games and 500 goals',
  'most goals on debut',
  'most premierships with 3+ clubs',
  'most games without a final',
] as const;

describe('NL full-audit acceptance corpus', () => {
  it('classifies every required sample without silently dropping a plan field', async () => {
    const plans = new Map<string, NlQueryPlan>();
    for (const question of questions) {
      const parsed = await parseNlQuestion(question, ctx);
      if (question === 'most rebound 50s in a final') {
        expect(parsed.status, question).toBe('unanswerable');
        if (parsed.status === 'unanswerable') expect(parsed.topic).toBe('rebound 50s');
        continue;
      }
      expect(parsed.status, question).toBe('plan');
      if (parsed.status !== 'plan') continue;
      plans.set(question, parsed.plan);

      const validated = validatePlan(parsed.plan);
      if (question === 'most goals in Q1 by a player' || question === 'most disposals in the fourth quarter in 2023') {
        expect(validated, question).toEqual({ error: 'Quarter-by-quarter player statistics are not currently available to rank.' });
      } else {
        expect(validated, question).not.toHaveProperty('error');
      }
    }
    expect(questions).toHaveLength(44);

    expect(plans.get('most hit out Richmond v Essendon Round 5 1984')).toMatchObject({
      grain: 'player_game', metric: 'hitouts', mode: 'single', agg: { kind: 'max' },
      scope: {
        matchup: { clubA: { slug: 'richmond' }, clubB: { slug: 'essendon' } },
        seasonMin: 1984, seasonMax: 1984, roundNumber: 5, matchType: 'home_and_away',
      },
    });
    expect(plans.get('most hitout Fitzroy v Richmond round 3 1984')).toMatchObject({
      grain: 'player_game', metric: 'hitouts', mode: 'single', agg: { kind: 'max' },
      scope: {
        matchup: { clubA: { slug: 'fitzroy' }, clubB: { slug: 'richmond' } },
        seasonMin: 1984, seasonMax: 1984, roundNumber: 3, matchType: 'home_and_away',
      },
    });
    expect(plans.get('highest H2 score by the Magpies')).toMatchObject({
      grain: 'team_match', metric: 'team_score', periodSplit: 'H2',
      scope: { clubFor: { slug: 'collingwood' } },
    });
    expect(plans.get('biggest margin at half time')).toMatchObject({
      grain: 'team_match', metric: 'win_margin', scoreCheckpoint: 'HT',
    });
    expect(plans.get('biggest margin at half time but won')).toMatchObject({
      grain: 'team_match', metric: 'win_margin', scoreCheckpoint: 'HT', resultFilter: 'won',
    });
    expect(plans.get('biggest margin at quatre time but won')).toMatchObject({
      grain: 'team_match', metric: 'win_margin', scoreCheckpoint: 'QT', resultFilter: 'won',
    });
    expect(plans.get('biggest margin at three quarter time but won')).toMatchObject({
      grain: 'team_match', metric: 'win_margin', scoreCheckpoint: '3QT', resultFilter: 'won',
    });
    expect(plans.get('biggest lead at half time')).toMatchObject({
      grain: 'team_match', metric: 'win_margin', scoreCheckpoint: 'HT',
    });
    expect(plans.get('teams with more than 3 wins against the Lions')).toMatchObject({
      grain: 'team_match', metric: null, agg: { kind: 'list' },
      havingClause: { metric: 'wins', op: 'gt', value: 3 },
      scope: { clubAgainst: { slug: 'brisbane-lions' } },
    });
    expect(plans.get('teams to lose 5 times by more than 100 points')).toMatchObject({
      grain: 'team_match', metric: null, agg: { kind: 'list' },
      havingClause: { metric: 'losses', op: 'gte', value: 5 },
      matchFilter: { metric: 'loss_margin', op: 'gt', value: 100 },
    });
    expect(plans.get("richmond's longest winning strea")).toMatchObject({
      grain: 'team_streak', streakDefinition: { kind: 'win' },
      scope: { clubFor: { slug: 'richmond' } },
    });
    expect(plans.get('fewest points scored by the Bears at UTAS')).toMatchObject({
      grain: 'team_match', metric: 'team_score',
      scope: { clubFor: { slug: 'brisbane-bears' }, venue: { slug: 'utas-stadium' } },
    });
    expect(plans.get('most goals on debut')).toMatchObject({
      grain: 'player_game', metric: 'goals', mode: 'single', debutGame: true,
    });
  });

  it('keeps neighbouring variants equivalent and narrow typo matching collision-safe', async () => {
    for (const question of [
      'most hit out Richmond vs Essendon Round 5 1984',
      'most hit out Richmond versus Essendon Round 5 1984',
    ]) {
      const parsed = await parseNlQuestion(question, ctx);
      expect(parsed.status).toBe('plan');
      if (parsed.status === 'plan') {
        expect(parsed.plan).toMatchObject({
          grain: 'player_game', mode: 'single', metric: 'hitouts',
          scope: {
            matchup: { clubA: { slug: 'richmond' }, clubB: { slug: 'essendon' } },
            roundNumber: 5, matchType: 'home_and_away',
          },
        });
      }
    }

    const resultScope = await parseNlQuestion('Richmond biggest win vs Carlton', ctx);
    expect(resultScope.status).toBe('plan');
    if (resultScope.status === 'plan') {
      expect(resultScope.plan.scope).toMatchObject({
        clubFor: { slug: 'richmond' },
        clubAgainst: { slug: 'carlton' },
      });
      expect(resultScope.plan.scope.matchup).toBeUndefined();
    }

    const unrelated = await parseNlQuestion('richmond longest winning street', ctx);
    expect(unrelated.status).not.toBe('plan');

    const debutSeason = await parseNlQuestion('most goals in a debut season', ctx);
    if (debutSeason.status === 'plan') expect(debutSeason.plan.debutGame).toBeUndefined();
  });
});

// ------------------------------------- coaching (AFLDB-ISSUE-152 Phase B)

/** The measured coaches used as witnesses in the issue's evidence pack. */
const coaches: NlCoachDirectoryEntry[] = [
  { id: 17, slug: 'damien-hardwick', name: 'Damien Hardwick', playerId: 900, playerSlug: 'damien-hardwick', names: ['damien hardwick', 'hardwick'] },
  { id: 1, slug: 'mick-malthouse', name: 'Mick Malthouse', playerId: 9635, playerSlug: 'mick-malthouse', names: ['mick malthouse', 'malthouse'] },
  { id: 2, slug: 'jock-mchale', name: 'Jock McHale', playerId: 910, playerSlug: 'jock-mchale', names: ['jock mchale', 'mchale'] },
  { id: 152, slug: 'cliff-rankin', name: 'Cliff Rankin', playerId: null, playerSlug: null, names: ['cliff rankin', 'rankin'] },
  { id: 285, slug: 'jack-titus', name: 'Jack Titus', playerId: 800, playerSlug: 'jack-titus', names: ['jack titus', 'titus'] },
  // Both Pannams coached Richmond, so the bare surname is deliberately no alias.
  { id: 160, slug: 'albert-pannam', name: 'Albert Pannam', playerId: 700, playerSlug: 'albert-pannam', names: ['albert pannam'] },
  { id: 266, slug: 'charlie-pannam', name: 'Charlie Pannam', playerId: 701, playerSlug: 'charlie-pannam', names: ['charlie pannam'] },
];

const coachCtx: NlParseContext = { clubs, venues, coaches, resolvePlayer: async () => [] };

const coachingQuestions: [string, Record<string, unknown>][] = [
  ['who coached Richmond', { grain: 'coach_record', metric: null, agg: { kind: 'list' }, scope: { clubFor: { slug: 'richmond' } } }],
  ['how many coaches has Richmond had', { grain: 'coach_record', agg: { kind: 'count' } }],
  ['Damien Hardwick coaching record', { grain: 'coach_record', coach: { id: 17 } }],
  ['Damien Hardwick coaching record at Richmond', { grain: 'coach_record', coach: { id: 17 }, scope: { clubFor: { slug: 'richmond' } } }],
  ['which coach has coached the most games', { grain: 'coach_record', metric: 'games', agg: { kind: 'max' } }],
  ['which coach has the most wins', { grain: 'coach_record', metric: 'wins', agg: { kind: 'max' } }],
  ['coaches with the most premierships', { grain: 'coach_record', metric: 'premierships', agg: { kind: 'max' } }],
  ['which coach has coached the most grand finals', { grain: 'coach_record', metric: 'grand_finals', agg: { kind: 'max' } }],
  ['top 5 coaches by premierships', { grain: 'coach_record', metric: 'premierships', agg: { kind: 'top_n', n: 5 } }],
  ['best coaching win percentage', { grain: 'coach_record', metric: 'win_pct', coachQualifier: { minGames: 50 } }],
  ['coaches with at least 100 games best win percentage', { grain: 'coach_record', metric: 'win_pct', coachQualifier: { minGames: 100 } }],
  ['Richmond coaches with 100+ wins', { grain: 'coach_record', metric: 'wins', agg: { kind: 'list' }, metricCondition: { op: 'gte', value: 100 } }],
  ['coaches who have coached more than one club', { grain: 'coach_record', metric: 'organizations', metricCondition: { op: 'gt', value: 1 } }],
  ['who coached Richmond in 2017', { grain: 'coach_record', scope: { clubFor: { slug: 'richmond' }, seasonMin: 2017, seasonMax: 2017 } }],
  ['players coached by Damien Hardwick', { grain: 'player_career', careerPredicates: [{ builder: 'coached_by', params: { coach: '17' } }] }],
  ['premiership coaches', { grain: 'player_career', careerPredicates: [{ builder: 'premiership_coach', params: {} }] }],
];

/** Every form of §13.15 that must land on a decline or an honest refusal, never on an answer. */
const coachingDeclines = [
  'who coached Carlton in 1899',
  'Pannam coaching record',
  'Smith coaching record',
  'who coached Richmond in 1899',
  'Richmond players coached by Damien Hardwick',
  'players who later coached Richmond',
  'who was Richmond\'s assistant coach in 2017',
  'who was the caretaker coach of Carlton',
  'which coach won the most coaching awards',
  'why was Damien Hardwick sacked',
  'what was Damien Hardwick\'s coaching salary',
  'who coached Victoria in a state game',
  'Damien Hardwick record against Alastair Clarkson',
  'was every club\'s coach recorded in 1940',
  'best coaching win percentage of any coach ever no minimum',
  'most wins in a season by a coach',
];

describe('NL coaching acceptance (AFLDB-ISSUE-152 Phase B)', () => {
  it('parses every supported coaching family to the intended plan', async () => {
    for (const [question, expected] of coachingQuestions) {
      const parsed = await parseNlQuestion(question, coachCtx);
      expect(parsed.status, question).toBe('plan');
      if (parsed.status !== 'plan') continue;
      expect(parsed.plan, question).toMatchObject(expected);
      expect(validatePlan(parsed.plan), question).not.toHaveProperty('error');
    }
  });

  it('declines every unsupported coaching form rather than answering a narrower question', async () => {
    for (const question of coachingDeclines) {
      const parsed = await parseNlQuestion(question, coachCtx);
      if (parsed.status !== 'plan') continue;
      // A plan that validates would be an ANSWER to a question AFLDB
      // cannot answer; a plan that fails validation is an honest refusal.
      expect(validatePlan(parsed.plan), question).toHaveProperty('error');
    }
  });
});

// ------------------------------ after the siren (AFLDB-ISSUE-152 Phase C)

const sirenPlayers: Record<string, { id: number; slug: string; name: string }[]> = {
  'barry hall': [{ id: 1001, slug: 'barry-hall', name: 'Barry Hall' }],
  'gary rohan': [{ id: 4742, slug: 'gary-rohan', name: 'Gary Rohan' }],
};

const sirenCtx: NlParseContext = {
  clubs,
  venues,
  coaches,
  resolvePlayer: async (name: string) => (sirenPlayers[name.toLowerCase()] ?? []).map((ref) => ({ ref, score: 1000 })),
};

const sirenQuestions: [string, Record<string, unknown>][] = [
  ['who has kicked the most goals after the siren', {
    grain: 'after_siren', metric: 'siren_kicks', agg: { kind: 'max' },
    afterSiren: { subject: 'player', kickScored: 'goal' },
  }],
  ['most kicks after the siren', {
    grain: 'after_siren', afterSiren: { subject: 'player' },
  }],
  ['goals after the siren to win', {
    grain: 'after_siren', afterSiren: { subject: 'event', kickScored: 'goal', kickEffect: 'won' },
  }],
  ['behinds after the siren to draw', {
    grain: 'after_siren', afterSiren: { subject: 'event', kickScored: 'behind', kickEffect: 'drew' },
  }],
  ['missed after the siren and lost', {
    grain: 'after_siren', afterSiren: { subject: 'event', kickScored: 'none', kickerResult: 'loss' },
  }],
  ['how many kicks after the siren', { grain: 'after_siren', agg: { kind: 'count' } }],
  ['the first kick after the siren', {
    grain: 'after_siren', afterSiren: { subject: 'event', occurrence: 'first' },
  }],
  ['the most recent goal after the siren', {
    grain: 'after_siren', afterSiren: { subject: 'event', kickScored: 'goal', occurrence: 'most_recent' },
  }],
  ['goals after the siren against Richmond', {
    grain: 'after_siren', scope: { clubAgainst: { slug: 'richmond' } },
  }],
  ['goals after the siren for Geelong', {
    grain: 'after_siren', scope: { clubFor: { slug: 'geelong' } },
  }],
  ['after the siren in the finals', { grain: 'after_siren', scope: { matchType: 'finals' } }],
  ['Barry Hall goals after the siren', {
    grain: 'after_siren', player: { id: 1001 }, afterSiren: { subject: 'event', kickScored: 'goal' },
  }],
  ['who has kicked the most goals after the siren for Richmond in the finals since 2000', {
    grain: 'after_siren', afterSiren: { subject: 'player', kickScored: 'goal' },
    scope: { clubFor: { slug: 'richmond' }, matchType: 'finals', seasonMin: 2000 },
  }],
];

/** Every §15.14 form: a decline, or a plan its own validator refuses. */
const sirenDeclines = [
  'goals after the siren in round 1',
  'goals after the siren at the MCG',
  'Richmond v Carlton after the siren',
  'which coach won most games on a goal after the siren',
  'fewest kicks after the siren',
  'goals after the siren in 1900',
  'most goals after the siren in a season',
  'goals after the siren in extra time',
  'who kicked it out on the full after the siren',
  'how much did they win by after the siren',
  'goals after the siren in the NAB Cup',
  '300 game players who kicked a goal after the siren',
  'was it a supergoal after the siren',
  'did the siren sound before the kick',
];

describe('NL after-the-siren acceptance (AFLDB-ISSUE-152 Phase C)', () => {
  it('parses every supported after-the-siren family to the intended plan', async () => {
    for (const [question, expected] of sirenQuestions) {
      const parsed = await parseNlQuestion(question, sirenCtx);
      expect(parsed.status, question).toBe('plan');
      if (parsed.status !== 'plan') continue;
      expect(parsed.plan, question).toMatchObject(expected);
      expect(validatePlan(parsed.plan), question).not.toHaveProperty('error');
    }
  });

  it('declines every unsupported after-the-siren form', async () => {
    for (const question of sirenDeclines) {
      const parsed = await parseNlQuestion(question, sirenCtx);
      if (parsed.status !== 'plan') continue;
      expect(validatePlan(parsed.plan), question).toHaveProperty('error');
    }
  });

  /**
   * The 1,435-row realistic and 60-row decline gates are untouched by this
   * phase, exactly as Phase B asserted for coaching: no existing corpus
   * question mentions the siren, so none of them can change meaning.
   */
  it('no existing audit-corpus question mentions the siren', () => {
    expect(questions.filter((q) => /siren/i.test(q))).toEqual([]);
  });
});
