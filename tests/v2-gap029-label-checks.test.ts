import { describe, expect, it } from 'vitest';

import { entryProblem, type Entry, type Row } from '../tools/v2/gap029-label-checks';

const entry = (venueRaw: string | null | undefined = 'M.C.G.'): Entry => ({
  family: 'Anzac Day', label: 'Anzac Day', year: 1995, matchId: 10834,
  expect: { season: 1995, matchDate: '1995-04-25', roundCode: '4', venueRaw: venueRaw as string | null, homeClub: 'Collingwood', awayClub: 'Essendon', homeScore: 111, awayScore: 111 },
});
const row = (over: Partial<Row> = {}): Row => ({ id: 10834, season: 1995, match_date: '1995-04-25', round_code: '4', venue_raw: 'M.C.G.', hn: 'Collingwood', an: 'Essendon', hs: 111, aws: 111, match_event: null, ...over });

describe('GAP-029 label identity check', () => {
  it('accepts an unlabelled row and an already-labelled row that match every identity field', () => {
    expect(entryProblem(entry(), row())).toBeNull();
    expect(entryProblem(entry(), row({ match_event: 'Anzac Day' }))).toBeNull();
  });
  it('refuses a missing row, a different event and each changed identity field', () => {
    expect(entryProblem(entry(), undefined)).toMatch(/not found/);
    expect(entryProblem(entry(), row({ match_event: "King's Birthday" }))).toMatch(/different event/);
    for (const over of [{ season: 1996 }, { match_date: '1995-04-26' }, { round_code: '5' }, { hn: 'Essendon' }, { an: 'Carlton' }, { hs: 112 }, { aws: 110 }] as Partial<Row>[]) {
      expect(entryProblem(entry(), row(over)), JSON.stringify(over)).toMatch(/expected identity/);
    }
  });
  it('refuses a changed venue identity, including a venue that has become NULL', () => {
    expect(entryProblem(entry(), row({ venue_raw: 'Waverley Park' }))).toMatch(/expected identity/);
    expect(entryProblem(entry(), row({ venue_raw: 'm.c.g.' }))).toMatch(/expected identity/);
    expect(entryProblem(entry(), row({ venue_raw: null }))).toMatch(/expected identity/);
  });
  it('keeps NULL meaning: an evidenced NULL venue matches only a live NULL, and a missing evidence key refuses', () => {
    expect(entryProblem(entry(null), row({ venue_raw: null }))).toBeNull();
    expect(entryProblem(entry(null), row({ venue_raw: 'M.C.G.' }))).toMatch(/expected identity/);
    expect(entryProblem(entry(undefined), row({ venue_raw: null }))).toMatch(/expected identity/);
  });
});
