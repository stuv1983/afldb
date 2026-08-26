import { describe, expect, it } from 'vitest';

import { parseNlQuestion, type NlParseContext, type NlPlayerCandidate } from '@/search/nl/parser';
import type { NlClubDirectoryEntry } from '@/search/nl/entities';
import { validatePlan } from '@/search/nl/plan';

const clubs: NlClubDirectoryEntry[] = [
  { organizationId: 1, slug: 'richmond', name: 'Richmond', names: ['richmond'] },
  { organizationId: 2, slug: 'carlton', name: 'Carlton', names: ['carlton'] },
];

const players: Record<string, NlPlayerCandidate[]> = {
  'dustin martin': [{ ref: { id: 100, slug: 'dustin-martin', name: 'Dustin Martin' }, score: 1000 }],
  'gary ablett jnr': [{ ref: { id: 101, slug: 'gary-ablett-jnr', name: 'Gary Ablett Jnr' }, score: 1000 }],
  'gary ablett snr': [{ ref: { id: 102, slug: 'gary-ablett-snr', name: 'Gary Ablett Snr' }, score: 1000 }],
  ablett: [
    { ref: { id: 101, slug: 'gary-ablett-jnr', name: 'Gary Ablett Jnr' }, score: 400 },
    { ref: { id: 102, slug: 'gary-ablett-snr', name: 'Gary Ablett Snr' }, score: 390 },
  ],
};

const ctx: NlParseContext = {
  clubs,
  venues: [],
  resolvePlayer: async (name) => players[name] ?? [],
};

async function plan(question: string) {
  const parsed = await parseNlQuestion(question, ctx);
  expect(parsed.status, `${question}: ${JSON.stringify(parsed.report)}`).toBe('plan');
  return (parsed as Extract<typeof parsed, { status: 'plan' }>).plan;
}

describe('AFLDB-ISSUE-094 semantic mappings', () => {
  it.each([
    ['at most', 'lte'],
    ['no more than', 'lte'],
    ['at least', 'gte'],
    ['no fewer than', 'gte'],
    ['more than', 'gt'],
    ['less than', 'lt'],
    ['fewer than', 'lt'],
    ['exactly', 'eq'],
  ] as const)('atomically maps grouped %s', async (words, op) => {
    const p = await plan(`teams with ${words} 2 wins against Richmond`);
    expect(p.grain).toBe('team_match');
    expect(p.metric).toBeNull();
    expect(p.agg).toEqual({ kind: 'list' });
    expect(p.havingClause).toEqual({ metric: 'wins', op, value: 2 });
    expect(p.scope.clubAgainst?.slug).toBe('richmond');
  });

  it.each(['wins', 'losses', 'draws'] as const)('applies upper bounds to grouped %s', async (metric) => {
    const p = await plan(`teams with at most 2 ${metric} against Richmond`);
    expect(p.havingClause).toEqual({ metric, op: 'lte', value: 2 });
  });

  it.each([
    ['Richmond v Carlton head to head', 'record'],
    ['Richmond record against Carlton', 'record'],
    ['Richmond and Carlton head to head record', 'record'],
    ['what is the head to head between Richmond and Carlton', 'record'],
    ['who has won more Richmond or Carlton', 'compare_wins'],
    ["who's won more Richmond or Carlton", 'compare_wins'],
  ] as const)('maps %s to typed head-to-head %s', async (question, kind) => {
    const p = await plan(question);
    expect(p.grain).toBe('head_to_head');
    expect(p.metric).toBeNull();
    expect(p.agg).toEqual({ kind: 'count' });
    expect(p.headToHead).toEqual({ kind });
    expect(p.scope.matchup?.clubA.slug).toBe('richmond');
    expect(p.scope.matchup?.clubB.slug).toBe('carlton');
    expect(validatePlan(p)).not.toHaveProperty('error');
  });

  it.each([
    ['how many draws between Richmond and Carlton', 'draw_count'],
    ['Richmond draws against Carlton', 'draw_count'],
    ['how many times have Richmond and Carlton drawn', 'draw_count'],
    ['how many drawn games between Richmond and Carlton', 'draw_count'],
    ['last draw between Richmond and Carlton', 'last_draw'],
    ['most recent draw between Richmond and Carlton', 'last_draw'],
    ['when was the last draw between Richmond and Carlton', 'last_draw'],
  ] as const)('maps %s to typed draw semantics', async (question, kind) => {
    const p = await plan(question);
    expect(p.grain).toBe('head_to_head');
    expect(p.headToHead).toEqual({ kind });
    expect(p.scope.matchup).toBeDefined();
  });

  it.each([
    'Richmond career leader for games',
    'most career games for Richmond',
    'who has played the most games for Richmond',
  ])('routes club-specific career games explicitly: %s', async (question) => {
    const p = await plan(question);
    expect(p.grain).toBe('player_career');
    expect(p.metric).toBe('games');
    expect(p.scope.clubFor?.slug).toBe('richmond');
  });

  it.each([
    ['Gary Ablett Jr career goals', 101],
    ['Gary Ablett Jnr career goals', 101],
    ['Gary Ablett Junior career goals', 101],
    ['Gary Ablett Snr career goals', 102],
    ['Gary Ablett Senior career goals', 102],
  ] as const)('preserves player identity while normalizing suffixes: %s', async (question, playerId) => {
    const p = await plan(question);
    expect(p.player?.id).toBe(playerId);
    expect(p.grain).toBe('player_career');
  });

  it('keeps surname-candidate ranking behavior', async () => {
    const p = await plan('Ablett most goals');
    expect(p.scope.playerIdIn).toEqual([101, 102]);
    expect(p.player).toBeUndefined();
  });

  it.each([
    'most rebound 50s in 2024',
    'most R50s in 2024',
    'Richmond rebound 50 record',
  ])('declines unsupported rebound-50 data explicitly: %s', async (question) => {
    const parsed = await parseNlQuestion(question, ctx);
    expect(parsed.status).toBe('unanswerable');
    if (parsed.status === 'unanswerable') {
      expect(parsed.topic).toBe('rebound 50s');
      expect(parsed.reason).toContain('not tracked');
    }
  });

  it('does not let club-between language steal a season range', async () => {
    const p = await plan('most goals between 2000 and 2009');
    expect(p.grain).toBe('player_season');
    expect(p.scope.seasonMin).toBe(2000);
    expect(p.scope.seasonMax).toBe(2009);
    expect(p.headToHead).toBeUndefined();
  });

  it('rejects an incomplete or polluted head-to-head plan', async () => {
    const clean = await plan('Richmond v Carlton head to head');
    expect(validatePlan({ ...clean, scope: {} })).toEqual({ error: 'A head-to-head question needs exactly two clubs.' });
    expect(validatePlan({ ...clean, player: { id: 100, slug: 'dustin-martin', name: 'Dustin Martin' } }))
      .toEqual({ error: 'A head-to-head question contains fields its compiler cannot honour.' });
  });

  it.each([
    ['most goals', 'player_career'],
    ['Richmond longest winning streak', 'team_streak'],
    ['Dustin Martin career goals', 'player_career'],
    ['Dustin Martin most goals against Carlton', 'player_game'],
  ] as const)('preserves clean control %s', async (question, grain) => {
    expect((await plan(question)).grain).toBe(grain);
  });

  it('still declines meaningful nonsense', async () => {
    const parsed = await parseNlQuestion('Richmond banana head statistics', ctx);
    expect(parsed.status).not.toBe('plan');
  });
});
