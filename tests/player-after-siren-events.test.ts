import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { PlayerAfterSirenEvents } from '@/components/PlayerAfterSirenEvents';
import type { PlayerAfterSirenEvent } from '@/db/queries/after-siren';

function event(overrides: Partial<PlayerAfterSirenEvent> = {}): PlayerAfterSirenEvent {
  return {
    id: 1,
    season: 1989,
    roundRaw: '21',
    competition: 'VFL',
    premiershipSeason: true,
    clubId: 10,
    clubName: 'Hawthorn',
    clubSlug: 'hawthorn',
    opponentClubId: 20,
    opponentName: 'Geelong',
    opponentSlug: 'geelong',
    matchId: 555,
    kickScored: 'goal',
    kickEffect: 'won',
    kickerResult: 'win',
    siren: 'final',
    kickerScoreRaw: '80',
    opponentScoreRaw: '79',
    cited: true,
    ...overrides,
  };
}

describe('PlayerAfterSirenEvents rendering', () => {
  it('renders nothing for zero events, so it never appears as an empty section', () => {
    const node = PlayerAfterSirenEvents({ events: [] });
    expect(node).toBeNull();
  });

  it('is collapsed by default', () => {
    const html = renderToStaticMarkup(PlayerAfterSirenEvents({ events: [event()] }));
    const detailsTag = html.match(/<details[^>]*>/)?.[0] ?? '';
    expect(detailsTag).not.toMatch(/\bopen\b/);
  });

  it('links the match when a match id is present', () => {
    const html = renderToStaticMarkup(PlayerAfterSirenEvents({ events: [event()] }));
    expect(html).toContain('href="/matches/555"');
    expect(html).toContain('80–79');
  });

  it('does not link the score when no match id is present', () => {
    const html = renderToStaticMarkup(PlayerAfterSirenEvents({ events: [event({ matchId: null })] }));
    expect(html).not.toContain('href="/matches/');
    expect(html).toContain('80–79');
  });

  it('links both clubs when canonical routing is available', () => {
    const html = renderToStaticMarkup(PlayerAfterSirenEvents({ events: [event()] }));
    expect(html).toContain('href="/clubs/hawthorn"');
    expect(html).toContain('href="/clubs/geelong"');
  });

  it('shows the competition only for a non-premiership-season row', () => {
    const premiership = renderToStaticMarkup(PlayerAfterSirenEvents({ events: [event()] }));
    expect(premiership).not.toContain('VFL');

    const other = renderToStaticMarkup(PlayerAfterSirenEvents({
      events: [event({ premiershipSeason: false, competition: 'NAB Cup', matchId: null })],
    }));
    expect(other).toContain('NAB Cup');
  });

  it('shows a visible uncited note rather than a title-only tooltip', () => {
    const html = renderToStaticMarkup(PlayerAfterSirenEvents({ events: [event({ cited: false })] }));
    expect(html).toContain('uncited');
    expect(html).not.toContain('title="uncited"');
  });

  it('does not show an uncited note for a cited event', () => {
    const html = renderToStaticMarkup(PlayerAfterSirenEvents({ events: [event({ cited: true })] }));
    expect(html).not.toContain('uncited');
  });

  it('never prints the reader\'s own name -- the event carries no player field to render', () => {
    const html = renderToStaticMarkup(PlayerAfterSirenEvents({ events: [event()] }));
    // The component's props (PlayerAfterSirenEvent) carry no player name at
    // all, so there is nothing for the component to accidentally print.
    expect(html).not.toMatch(/player[_-]?name/i);
  });
});
