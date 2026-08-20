import { describe, expect, it } from 'vitest';

import { parseNlQuestion, type NlParseContext } from '@/search/nl/parser';
import { validatePlan, type NlQueryPlan } from '@/search/nl/plan';
import type { NlClubDirectoryEntry, NlVenueDirectoryEntry } from '@/search/nl/entities';

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
