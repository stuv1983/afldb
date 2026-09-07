/**
 * AFLDB-ISSUE-144 Stage 8 — the public view rendered from REAL route state.
 *
 * The presentation contracts themselves are proved without a database in
 * tests/club-comparison-view.test.ts, where a fixture can hold a state
 * (unequal metric coverage, a tied record, a club that did not compete)
 * that `afldb_test` does not currently happen to contain.
 *
 * What a fixture cannot prove is that the view survives the real shape of
 * the loaded data — a null venue, a null score, an unpopulated Brownlow
 * board, a `Date` where a fixture used one by hand. That is what this
 * file is for: resolve the route state exactly as a request does, render
 * it, and assert the page is a comparison rather than an exception.
 *
 * No year and no club record is written down; the comparison is all-time
 * only (Club Rivalry Explorer follow-up, FR-1).
 */
import './guard';

import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it } from 'vitest';

import { resolveClubComparisonState } from '@/app/clubs/compare/state';
import { ClubComparisonView } from '@/components/ClubComparisonView';
import { sql } from '@/db/client';

afterAll(async () => {
  await sql.end();
});

async function renderState(raw: Record<string, string>): Promise<string> {
  const state = await resolveClubComparisonState(raw);
  return renderToStaticMarkup(ClubComparisonView({ state }));
}

describe('Stage 8 view over real route state', () => {
  it('renders the landing page with database-driven selectors and no comparison', async () => {
    const html = await renderState({});
    expect(html).toContain('name="club1"');
    expect(html).toContain('<h2>Choose two clubs</h2>');
    expect(html).not.toContain('id="head-to-head"');
  });

  it('renders every section of a real comparison', async () => {
    const html = await renderState({ club1: 'adelaide', club2: 'brisbane-lions' });
    for (const heading of [
      'Head-to-head', 'Rivalry records', 'Match history',
      'Player rivalry leaders', 'Connected players', 'Brownlow', 'By decade',
      'Period records', 'Player averages in this rivalry',
    ]) {
      expect(html, `missing section: ${heading}`).toContain(heading);
    }
    expect(html).toContain('Adelaide v Brisbane Lions');
    expect(html).toContain('Recorded H2H Brownlow votes from');
    expect(html).toContain('Period-score data available for');
    // The honest-absence rule, end to end: a coverage state is words.
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('NaN');
  });

  it('renders the same-organisation and unknown-club states without a comparison', async () => {
    const same = await renderState({ club1: 'adelaide', club2: 'adelaide' });
    expect(same).toContain('Choose two different clubs');
    expect(same).not.toContain('id="match-history"');

    // A historical identity is not an organisation slug, which is why it
    // reaches the invalid-club state rather than a comparison.
    const invalid = await renderState({ club1: 'footscray', club2: 'carlton' });
    expect(invalid).toContain('That club could not be found');
    expect(invalid).toContain('footscray');
    expect(invalid).not.toContain('id="head-to-head"');
  });

  it('carries the match filter and page through the rendered pagination links', async () => {
    const html = await renderState({
      club1: 'carlton',
      club2: 'collingwood',
      matchType: 'finals',
      page: '2',
    });
    expect(html).toContain('matchType=finals');
    expect(html).toContain('club1=carlton&amp;club2=collingwood');
  });

  it('renders the era explorer and scopes rivalry records to the chosen era (Club Rivalry Explorer follow-up, FR-2)', async () => {
    const html = await renderState({
      club1: 'adelaide', club2: 'brisbane-lions', era: '1990',
    });
    expect(html).toContain('aria-label="Filter rivalry records and match history by era"');
    expect(html).toContain('1990s');
    expect(html).toContain('Rivalry records — Adelaide and Brisbane Lions (1990s)');
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('NaN');
  });

  it('surfaces an era outside the rivalry’s recorded history as a notice, not a crash', async () => {
    const html = await renderState({
      club1: 'adelaide', club2: 'brisbane-lions', era: '1900',
    });
    expect(html).toContain('is not part of this rivalry');
    expect(html).toContain('Rivalry records — Adelaide and Brisbane Lions</caption>');
  });
});
