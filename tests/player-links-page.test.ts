import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * Regression test for AFLDB-ISSUE-168: the suggested-player link on
 * /admin/player-links was built as `/players/${match.playerSlug}`, omitting
 * the `-${id}` the canonical route requires (see playerPath in
 * src/lib/format.ts, and every other call site). This exercises the page
 * end to end with faked queries so the assertion is against the actual
 * rendered href, not a hand-copied string.
 */

const mocks = vi.hoisted(() => ({
  requireCapability: vi.fn(async () => undefined),
  listUnresolvedLinks: vi.fn(),
  listConfirmedUnlinked: vi.fn(),
  listSuggestions: vi.fn(),
  readBestSuggestions: vi.fn(),
  readSuggestionsForEntities: vi.fn(),
  readSourceDetails: vi.fn(),
  readPlayerSummaries: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({ requireCapability: mocks.requireCapability }));
vi.mock('@/db/client', () => ({ sql: vi.fn() }));

vi.mock('@/db/queries/player-links', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/queries/player-links')>();
  return {
    ...actual,
    listUnresolvedLinks: mocks.listUnresolvedLinks,
    listConfirmedUnlinked: mocks.listConfirmedUnlinked,
    listSuggestions: mocks.listSuggestions,
  };
});

vi.mock('@/db/queries/player-match-candidates', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/queries/player-match-candidates')>();
  return {
    ...actual,
    readBestSuggestions: mocks.readBestSuggestions,
    readSuggestionsForEntities: mocks.readSuggestionsForEntities,
    readSourceDetails: mocks.readSourceDetails,
    readPlayerSummaries: mocks.readPlayerSummaries,
  };
});

// Client-only leaf components pull in useRouter/useActionState, which have
// no app-router context in a plain unit test and are irrelevant to the
// suggested-player link this test targets.
vi.mock('@/app/admin/player-links/RefreshSuggestionsControls', () => ({
  RefreshSuggestionsControls: () => null,
}));
vi.mock('@/app/admin/player-links/SuggestionControls', () => ({ SuggestionControls: () => null }));
vi.mock('@/app/admin/player-links/ResolvePanel', () => ({ ResolvePanel: () => null }));

import PlayerLinksPage from '@/app/admin/player-links/page';
import { ALGORITHM_VERSION } from '@/lib/player-matching/confidence';

const QUEUE_ROW = {
  targetTable: 'award_winners' as const,
  targetId: 1,
  playerName: 'John Smith',
  linkStatus: 'unresolved',
  context: 'Best and Fairest · 1990 · Richmond',
  resolutionEntityType: 'award_winners',
  resolutionEntityId: 1,
};

const MATCH = {
  resolutionEntityType: 'award_winners',
  resolutionEntityId: 1,
  targetTable: 'award_winners' as const,
  targetId: 1,
  rank: 1,
  playerId: 42,
  playerName: 'Jonathan Smith',
  playerSlug: 'jonathan-smith',
  score: 85,
  band: 'high',
  gap: 10,
  nearTies: 0,
  ambiguous: false,
  hardConflict: false,
  bulkEligible: false,
  evidence: [],
  conflicts: [],
  algorithmVersion: ALGORITHM_VERSION,
  computedAt: new Date('2026-09-01T00:00:00Z'),
};

async function renderPage() {
  mocks.listUnresolvedLinks.mockResolvedValue([QUEUE_ROW]);
  mocks.listConfirmedUnlinked.mockResolvedValue(new Set());
  mocks.listSuggestions.mockResolvedValue([]);
  mocks.readBestSuggestions.mockResolvedValue(new Map([['award_winners:1', MATCH]]));
  mocks.readSuggestionsForEntities.mockResolvedValue(new Map());
  mocks.readSourceDetails.mockResolvedValue(new Map());
  mocks.readPlayerSummaries.mockResolvedValue(new Map([[42, {
    playerId: 42,
    displayName: 'Jonathan Smith',
    slug: 'jonathan-smith',
    debutSeason: 1985,
    finalSeason: 1995,
    games: 200,
    goals: 150,
    clubs: ['Richmond'],
  }]]));

  const element = await PlayerLinksPage({ searchParams: Promise.resolve({}) });
  return renderToStaticMarkup(element);
}

describe('PlayerLinksPage suggestion link', () => {
  it('links to the canonical slug-id player route, not the bare slug', async () => {
    const html = await renderPage();
    expect(html).toContain('href="/players/jonathan-smith-42"');
    expect(html).not.toContain('href="/players/jonathan-smith"');
  });
});
