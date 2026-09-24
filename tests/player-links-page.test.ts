import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

/**
 * AFLDB-ISSUE-235 §10.1 B1-B4, B3b — the afl_api admin pages, DB-free.
 * `AflApiAdjudicationForm` (the write surface) is mocked to `null` here, the same way
 * `ResolvePanel` is mocked above: these tests are about the SERVER-RENDERED page content
 * (no bulk/suggestion/confirm-unlinked control anywhere, the honours queue untouched), not
 * about `useRouter`/`useActionState`, which need real App Router context this unit test
 * harness does not provide.
 */
const aflApiMocks = vi.hoisted(() => ({
  listAflApiUnresolvedProviders: vi.fn(),
  readAflApiProviderEvidence: vi.fn(),
  readAflApiAdjudicationHistory: vi.fn(),
}));

vi.mock('@/db/queries/afl-api-player-links', () => ({
  listAflApiUnresolvedProviders: aflApiMocks.listAflApiUnresolvedProviders,
  readAflApiProviderEvidence: aflApiMocks.readAflApiProviderEvidence,
  readAflApiAdjudicationHistory: aflApiMocks.readAflApiAdjudicationHistory,
}));
vi.mock('@/app/admin/player-links/afl-api/AflApiAdjudicationForm', () => ({
  AflApiAdjudicationForm: () => null,
}));

describe('AFLDB-ISSUE-235: AFL API admin pages', () => {
  it('B2 — the list page empty state renders', async () => {
    const { default: AflApiPlayerLinksPage } = await import('@/app/admin/player-links/afl-api/page');
    aflApiMocks.listAflApiUnresolvedProviders.mockResolvedValueOnce([]);
    const html = renderToStaticMarkup(await AflApiPlayerLinksPage());
    expect(html).toContain('No unresolved');
  });

  it('B1, B4 — the list page renders no bulk/suggestion/confirm-unlinked control, and never names an honours table', async () => {
    const { default: AflApiPlayerLinksPage } = await import('@/app/admin/player-links/afl-api/page');
    aflApiMocks.listAflApiUnresolvedProviders.mockResolvedValueOnce([{
      providerId: 'CD_I700', pendingCount: 3, seasons: [2026], existing: null, state: 'U1',
    }]);
    const html = renderToStaticMarkup(await AflApiPlayerLinksPage());
    // The page's own explanatory prose NAMES "bulk"/"suggestion"/"confirmed-unlinked" to
    // say they don't exist here (D9) -- that is the point, not a violation. What must be
    // absent is any INTERACTIVE control for them: a button, a form, a checkbox.
    expect(html).not.toMatch(/<(button|form|input)\b[^>]*(bulk|suggest|confirm)/i);
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<button');
    for (const table of ['award_winners', 'award_nominations', 'hall_of_fame', 'honour_team_members', 'captaincies', 'draft_picks']) {
      expect(html).not.toContain(table);
    }
  });

  it('B1 — the detail page renders no bulk/suggestion/confirm-unlinked control', async () => {
    const { default: AflApiProviderDetailPage } = await import('@/app/admin/player-links/afl-api/[providerId]/page');
    aflApiMocks.readAflApiProviderEvidence.mockResolvedValueOnce({
      providerId: 'CD_I700', state: 'U1', existing: null,
      observedGivenName: 'Matt', observedSurname: 'Taberner',
      teamIds: [], seasons: [2026], jumperNumbers: [23],
      matches: [], classification: null, candidatePlayerIds: [],
      playerSummaries: new Map(), playerStableIdentity: new Map(),
      openContradictions: [], pendingCandidates: [{ id: 1, sourceVersionSeq: 5 }],
      latestAdjudicationId: null,
    });
    aflApiMocks.readAflApiAdjudicationHistory.mockResolvedValueOnce([]);
    const html = renderToStaticMarkup(
      await AflApiProviderDetailPage({ params: Promise.resolve({ providerId: 'CD_I700' }) }),
    );
    expect(html).not.toMatch(/bulk/i);
    expect(html).not.toMatch(/suggestion/i);
    expect(html).not.toMatch(/confirm.?unlink/i);
    // Display-only labelling on the observed name (D11).
    expect(html).toContain('display-only');
  });

  it('B4 — LINK_TARGET_TABLES is unchanged, and afl_api is not a link target table', async () => {
    const { LINK_TARGET_TABLES } = await import('@/db/queries/player-links');
    expect(LINK_TARGET_TABLES).toEqual([
      'award_winners', 'award_nominations', 'hall_of_fame', 'honour_team_members',
      'captaincies', 'player_achievements', 'draft_picks',
    ]);
    expect((LINK_TARGET_TABLES as readonly string[])).not.toContain('afl_api');
    expect((LINK_TARGET_TABLES as readonly string[])).not.toContain('external_identities');
  });

  it('B3b (R7) — AflApiAdjudicationForm does not import ResolveControls, its PlayerPicker is never seeded, and it sends no name field', () => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'app', 'admin', 'player-links', 'afl-api', 'AflApiAdjudicationForm.tsx'), 'utf8',
    );
    // The doc comment names ResolveControls to explain the DEVIATION from it; only an
    // actual import or usage would defeat R7, so strip line comments before checking.
    const withoutLineComments = source.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
    expect(withoutLineComments).not.toMatch(/ResolveControls/);
    // PlayerPicker is rendered with no initialSelected -- an empty query even when the
    // provider's observed name is present in the page data (observedSurnameForDisplay is a
    // prop, read only for the acknowledgement checkbox's text, never passed to PlayerPicker).
    expect(source).toMatch(/<PlayerPicker\s+label="[^"]*"\s+onSelect=\{setPicked\}\s*\/>/);
    // Exactly one PlayerPicker JSX tag, self-closing, carrying only label/onSelect --
    // checked directly rather than by scanning outward from it (which would also match
    // prose in the doc comment above, an easy false pass/fail either way).
    const playerPickerTags = [...source.matchAll(/<PlayerPicker\b[^>]*\/>/g)];
    expect(playerPickerTags).toHaveLength(1);
    expect(playerPickerTags[0][0]).not.toMatch(/initialSelected|observedSurname|observedGivenName/);
    // No name field is ever posted -- only providerId/playerId/note/surnameAcknowledged/fingerprint.
    expect(source.match(/name="[a-zA-Z]+"/g)?.sort()).toEqual([
      'name="fingerprint"', 'name="fingerprint"', 'name="note"', 'name="note"',
      'name="playerId"', 'name="providerId"', 'name="providerId"', 'name="surnameAcknowledged"',
    ]);
  });

  it('A6, A8 — both actions call requireCapability first and never call revalidatePath', () => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'app', 'admin', 'player-links', 'afl-api', 'actions.ts'), 'utf8',
    );
    const withoutLineComments = source.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
    expect(withoutLineComments).not.toMatch(/revalidatePath/);
    const linkFn = source.slice(source.indexOf('export async function linkAflApiPlayer'));
    expect(linkFn.indexOf('requireCapability')).toBeLessThan(linkFn.indexOf('linkAflApiProvider('));
    const revokeFn = source.slice(source.indexOf('export async function revokeAflApiPlayerLink'));
    expect(revokeFn.indexOf('requireCapability')).toBeLessThan(revokeFn.indexOf('revokeAflApiLink('));
  });

  it('A7 — the actions read only providerId/playerId/note/surnameAcknowledged/fingerprint from the posted form', () => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'app', 'admin', 'player-links', 'afl-api', 'actions.ts'), 'utf8',
    );
    // Two access shapes: a direct formData.get('x') (playerId) and the stringField(formData,
    // 'x') helper (everything else) -- both must be counted, or this test would silently
    // pass while missing exactly the indirection a careless refactor might introduce.
    const direct = [...source.matchAll(/formData\.get\('([a-zA-Z]+)'\)/g)].map((m) => m[1]);
    const viaHelper = [...source.matchAll(/stringField\(formData, '([a-zA-Z]+)'\)/g)].map((m) => m[1]);
    expect([...new Set([...direct, ...viaHelper])].sort()).toEqual([
      'fingerprint', 'note', 'playerId', 'providerId', 'surnameAcknowledged',
    ]);
    expect(source).not.toMatch(/(formData\.get|stringField\(formData,) ?\(?'(name|score|status|observedName|observedSurname)'\)/);
  });
});
