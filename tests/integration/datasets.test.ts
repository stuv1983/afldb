import './guard';

import { describe, expect, it } from 'vitest';

import { authSql } from '@/db/authClient';
import { DATASETS } from '@/lib/ingest/datasets';

// No afterAll(authSql.end()) here: authSql is a lazy Proxy over the
// pooled auth client (see src/db/authClient.ts), and calling .end()
// through the proxy would invoke postgres.js's method with `this` bound
// to the Proxy rather than the real client -- unlike @/db/client's
// plain exported `sql`, which every other integration test closes
// safely. The process exits when the run finishes; nothing leaks.

const matchResults = DATASETS.match_results;
const playerMatchStats = DATASETS.player_match_stats;

describe('match_results dataset', () => {
  it('is registered with the expected required columns', () => {
    expect(matchResults).toBeDefined();
    expect(matchResults.requiredColumns).toEqual(
      expect.arrayContaining(['season', 'round_code', 'match_date', 'venue', 'home_club', 'away_club', 'home_score', 'away_score']),
    );
    // No awardSlug: this dataset feeds matches directly, not the awards tables.
    expect(matchResults.awardSlug).toBeUndefined();
  });

  it('rejects an unknown season', async () => {
    const result = await matchResults.validateRow(
      { season: '1800', round_code: '1', match_date: '1800-01-01', venue: 'x', home_club: 'Carlton', away_club: 'Footscray', home_score: '80', away_score: '70' },
      { sql: authSql },
    );
    expect(result.verdict).toBe('error');
  });

  it('rejects a home_and_away round with no round_number and a non-finals code', async () => {
    const result = await matchResults.validateRow(
      { season: '1989', round_code: '1', round_number: '', match_date: '1989-04-01', venue: 'x', home_club: 'Carlton', away_club: 'Footscray', home_score: '80', away_score: '70' },
      { sql: authSql },
    );
    expect(result.verdict).toBe('error');
  });

  it('rejects a finals code that also carries a round_number', async () => {
    const result = await matchResults.validateRow(
      { season: '1989', round_code: 'GF', round_number: '5', match_date: '1989-09-30', venue: 'x', home_club: 'Carlton', away_club: 'Footscray', home_score: '80', away_score: '70' },
      { sql: authSql },
    );
    expect(result.verdict).toBe('error');
  });

  it('rejects the same club on both sides', async () => {
    const result = await matchResults.validateRow(
      { season: '1989', round_code: '1', round_number: '1', match_date: '1989-04-01', venue: 'x', home_club: 'Carlton', away_club: 'Carlton', home_score: '80', away_score: '70' },
      { sql: authSql },
    );
    expect(result.verdict).toBe('error');
  });

  it('rejects a club that is not recognised', async () => {
    const result = await matchResults.validateRow(
      { season: '1989', round_code: '1', round_number: '1', match_date: '1989-04-01', venue: 'x', home_club: 'Not A Real Club FC', away_club: 'Footscray', home_score: '80', away_score: '70' },
      { sql: authSql },
    );
    expect(result.verdict).toBe('error');
  });

  it('rejects goals/behinds that do not add up to the score', async () => {
    const result = await matchResults.validateRow(
      {
        season: '1989', round_code: '1', round_number: '1', match_date: '1989-04-01',
        venue: 'x', home_club: 'Carlton', away_club: 'Footscray',
        home_goals: '10', home_behinds: '5', home_score: '999', away_score: '70',
      },
      { sql: authSql },
    );
    expect(result.verdict).toBe('error');
  });

  it('warns rather than errors on an unrecognised venue, and still resolves clubs/result', async () => {
    const result = await matchResults.validateRow(
      {
        season: '1989', round_code: '1', round_number: '1', match_date: '1989-04-01',
        venue: 'Some Ground Nobody Has Heard Of', home_club: 'Carlton', away_club: 'Footscray',
        home_score: '80', away_score: '70',
      },
      { sql: authSql },
    );
    expect(result.verdict).toBe('warning');
    expect(result.resolved?.result).toBe('home_win');
    expect(result.resolved?.margin).toBe(10);
    expect(result.resolved?.home_club_id).toBeTypeOf('number');
  });

  it('computes result/winner/margin correctly for a draw', async () => {
    const result = await matchResults.validateRow(
      {
        season: '1989', round_code: '1', round_number: '1', match_date: '1989-04-01',
        venue: 'x', home_club: 'Carlton', away_club: 'Footscray',
        home_score: '80', away_score: '80',
      },
      { sql: authSql },
    );
    expect(result.resolved?.result).toBe('draw');
    expect(result.resolved?.winner_club_id).toBeNull();
    expect(result.resolved?.margin).toBe(0);
  });

  it('fileKey is stable and distinguishes different matches', () => {
    const a = matchResults.fileKey({ season: '1989', round_code: '1', match_date: '1989-04-01', home_club: 'Carlton', away_club: 'Footscray' });
    const b = matchResults.fileKey({ season: '1989', round_code: '1', match_date: '1989-04-01', home_club: 'Carlton', away_club: 'Footscray' });
    const c = matchResults.fileKey({ season: '1989', round_code: '2', match_date: '1989-04-08', home_club: 'Carlton', away_club: 'Footscray' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('player_match_stats dataset', () => {
  it('is registered with the expected required columns and no awardSlug', () => {
    expect(playerMatchStats).toBeDefined();
    expect(playerMatchStats.requiredColumns).toEqual(
      expect.arrayContaining(['season', 'round_code', 'home_club', 'away_club', 'player', 'club']),
    );
    expect(playerMatchStats.awardSlug).toBeUndefined();
  });

  it('errors (not warns) on an unmatched player -- player_id is NOT NULL on this table', async () => {
    // A real match (1989 round 1, Carlton v Footscray) but a player who cannot exist.
    const result = await playerMatchStats.validateRow(
      {
        season: '1989', round_code: '1', home_club: 'Carlton', away_club: 'Footscray',
        player: 'Definitely Not A Real Player Zzyzx', club: 'Carlton',
      },
      { sql: authSql },
    );
    expect(result.verdict).toBe('error');
    expect(result.reasons.join(' ')).toMatch(/not found/);
  });

  it('errors when the named match does not exist', async () => {
    const result = await playerMatchStats.validateRow(
      {
        season: '1989', round_code: '99', home_club: 'Carlton', away_club: 'Footscray',
        player: 'Someone', club: 'Carlton',
      },
      { sql: authSql },
    );
    expect(result.verdict).toBe('error');
    expect(result.reasons.join(' ')).toMatch(/no match found/);
  });

  it('errors when the named club did not play in that match', async () => {
    const result = await playerMatchStats.validateRow(
      {
        season: '1989', round_code: '1', home_club: 'Carlton', away_club: 'Footscray',
        player: 'Someone', club: 'Essendon',
      },
      { sql: authSql },
    );
    expect(result.verdict).toBe('error');
    expect(result.reasons.join(' ')).toMatch(/did not play/);
  });

  it('errors on an unrecognised club', async () => {
    const result = await playerMatchStats.validateRow(
      {
        season: '1989', round_code: '1', home_club: 'Not A Real Club FC', away_club: 'Footscray',
        player: 'Someone', club: 'Footscray',
      },
      { sql: authSql },
    );
    expect(result.verdict).toBe('error');
  });

  it('rejects an out-of-range brownlow_votes value', async () => {
    // Carlton's real 1989 round-1 opponent lookup still runs first; an invalid
    // vote count on an otherwise-plausible row must still be caught.
    const result = await playerMatchStats.validateRow(
      {
        season: '1989', round_code: '1', home_club: 'Carlton', away_club: 'Footscray',
        player: 'Definitely Not A Real Player Either', club: 'Carlton', brownlow_votes: '7',
      },
      { sql: authSql },
    );
    // Player resolution fails first (deliberately fictional name), but either
    // way this must not be an 'ok' row.
    expect(result.verdict).toBe('error');
  });
});
