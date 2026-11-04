// ISSUE-333 second visibility probe: the club-page coach-row selector (docs/v2/evidence/issue333-o2-20261104/scripts/coach-row-selector.mts).
// The first probe's selector read the Port Adelaide PLAYER row and expected W/D/L in separate cells; these tests pin the corrected behaviour,
// including against the REAL markup that src/components/ClubCoachRecords.tsx renders.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ClubCoachRecords } from '@/components/ClubCoachRecords';
import {
  EXPECTED_CARR,
  fixtureClubPage,
  selectCoachRow,
  selfTest,
} from '../docs/v2/evidence/issue333-o2-20261104/scripts/coach-row-selector.mjs';

const record = (coachId: number, displayName: string, first: number, last: number, g: number, w: number, d: number, l: number, pct: string) => ({
  coachId, displayName, firstSeason: first, lastSeason: last, games: g, wins: w, draws: d, losses: l, winPct: pct,
});

describe('ISSUE-333 coach-row selector', () => {
  it('passes its own pre-flight self-test', () => {
    expect(() => selfTest()).not.toThrow();
  });

  it('matches the coaching table row, not the Josh Carr player row that precedes it', () => {
    const r = selectCoachRow(fixtureClubPage(), EXPECTED_CARR);
    expect(r.status).toBe('row');
    if (r.status !== 'row') return;
    expect(r.headers).toEqual(['Coach', 'Span', 'Games', 'W', 'D', 'L', 'Win %']);
    expect(r.byHeader).toMatchObject({ Coach: 'Josh Carr', Span: '2026', Games: '23', W: '7', D: '0', L: '16', 'Win %': '30.4' });
    expect(r.matches).toBe(true);
  });

  it('reads by header name, so reordered columns still map correctly', () => {
    const reordered = `<table><caption>Every coach of Port Adelaide, with their record for the club</caption>
      <thead><tr><th>L</th><th>Coach</th><th>Win %</th><th>W</th><th>Span</th><th>D</th><th>Games</th></tr></thead>
      <tbody><tr><td>16</td><td><a href="/coaches/josh-carr-243">Josh Carr</a></td><td>30.4</td><td>7</td><td>2026</td><td>0</td><td>23</td></tr></tbody></table>`;
    const r = selectCoachRow(reordered, EXPECTED_CARR);
    expect(r).toMatchObject({ status: 'row', matches: true });
  });

  it('reports a value mismatch with the compared columns instead of passing', () => {
    const r = selectCoachRow(
      fixtureClubPage({ carrRow: '<tr><td><a href="/coaches/josh-carr-243">Josh Carr</a></td><td>2026</td><td>22</td><td>7</td><td>1</td><td>16</td><td>1</td></tr>' }),
      EXPECTED_CARR,
    );
    expect(r.status).toBe('row');
    if (r.status !== 'row') return;
    expect(r.matches).toBe(false);
    expect(r.compared.Games).toEqual({ expected: '23', seen: '22', ok: false });
    expect(r.compared.D).toEqual({ expected: '0', seen: '1', ok: false });
    expect(r.compared.W.ok).toBe(true);
  });

  it('does not accept the right numbers in the wrong columns (W/D/L swapped)', () => {
    const r = selectCoachRow(
      fixtureClubPage({ carrRow: '<tr><td><a href="/coaches/josh-carr-243">Josh Carr</a></td><td>2026</td><td>23</td><td>16</td><td>0</td><td>7</td><td>1</td></tr>' }),
      EXPECTED_CARR,
    );
    expect(r).toMatchObject({ status: 'row', matches: false });
  });

  it('refuses an ambiguous row (the same coach link twice in the coaching table)', () => {
    expect(selectCoachRow(fixtureClubPage({ extraCarrRow: true }), EXPECTED_CARR)).toMatchObject({ status: 'refused', reason: 'ambiguous-row' });
  });

  it('refuses two coaching tables', () => {
    const page = fixtureClubPage();
    const table = /<table><caption>Every coach[\s\S]*?<\/table>/.exec(page)![0];
    expect(selectCoachRow(page.replace('</body>', `${table}</body>`), EXPECTED_CARR)).toMatchObject({ status: 'refused', reason: 'ambiguous-table' });
  });

  it('refuses a page whose only Carr row is outside the coaching table', () => {
    const page = fixtureClubPage({ carrRow: '' });
    expect(selectCoachRow(page, EXPECTED_CARR)).toMatchObject({ status: 'refused', reason: 'no-row' });
  });

  it('refuses a page with no coaching table, and a table with the headers but another caption', () => {
    expect(selectCoachRow('<html><body><table><caption>Players</caption></table></body></html>', EXPECTED_CARR)).toMatchObject({ status: 'refused', reason: 'no-coaching-table' });
    const renamed = fixtureClubPage().replace(/Every coach of Port Adelaide, with their record for the club/, 'Something else');
    expect(selectCoachRow(renamed, EXPECTED_CARR)).toMatchObject({ status: 'refused', reason: 'no-coaching-table' });
  });

  it('refuses a row with the wrong number of cells', () => {
    const r = selectCoachRow(fixtureClubPage({ carrRow: '<tr><td><a href="/coaches/josh-carr-243">Josh Carr</a></td><td>2026</td><td>23</td></tr>' }), EXPECTED_CARR);
    expect(r).toMatchObject({ status: 'refused', reason: 'bad-shape' });
  });

  it('does not match a similar href (prefix or different id)', () => {
    const r = selectCoachRow(
      fixtureClubPage({ carrRow: '<tr><td><a href="/coaches/josh-carr-2430">Josh Carr</a></td><td>2026</td><td>23</td><td>7</td><td>0</td><td>16</td><td>1</td></tr>' }),
      EXPECTED_CARR,
    );
    expect(r).toMatchObject({ status: 'refused', reason: 'no-row' });
  });

  it('matches the markup the real ClubCoachRecords component renders (server-rendered, sort indicators and comment markers included)', () => {
    const html = renderToStaticMarkup(
      createElement(ClubCoachRecords, {
        clubRecordName: 'Port Adelaide',
        hasLineage: false,
        records: [
          record(101, 'Ken Hinkley', 2013, 2025, 306, 160, 3, 143, '52.9'),
          record(243, 'Josh Carr', 2026, 2026, 23, 7, 0, 16, '30.4'),
        ] as never,
      }),
    );
    const r = selectCoachRow(`<html><body>${html}</body></html>`, EXPECTED_CARR);
    expect(r.status).toBe('row');
    if (r.status !== 'row') return;
    expect(r.headers).toEqual(['Coach', 'Span', 'Games', 'W', 'D', 'L', 'Win %']);
    expect(r.byHeader).toMatchObject({ Coach: 'Josh Carr', Span: '2026', Games: '23', W: '7', D: '0', L: '16' });
    expect(r.matches).toBe(true);
  });
});
