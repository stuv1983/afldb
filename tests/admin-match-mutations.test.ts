import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function source(...parts: string[]): string {
  return readFileSync(join(process.cwd(), ...parts), 'utf8');
}

describe('admin match mutation source contracts', () => {
  const matchSheet = source('src', 'db', 'queries', 'match-sheet.ts');
  const matchAdmin = source('src', 'db', 'queries', 'match-admin.ts');
  const playerDerived = source('src', 'db', 'queries', 'player-derived.ts');
  const matchSheetUi = source('src', 'app', 'admin', 'data-editor', 'MatchSheetEditor.tsx');
  const matchesQuery = source('src', 'db', 'queries', 'matches.ts');

  it('never mutates authoritative Brownlow season totals from match detail', () => {
    for (const mutation of [matchSheet, matchAdmin]) {
      expect(mutation).not.toMatch(/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+brownlow_season_votes/i);
    }
    expect(playerDerived).toContain('FROM brownlow_season_votes');
    expect(playerDerived).not.toMatch(/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+brownlow_season_votes/i);
  });

  it('keeps prepared tagged queries to one SQL command', () => {
    for (const queryModule of [matchSheet, matchAdmin, playerDerived]) {
      expect(queryModule).not.toMatch(/;\s*(?:INSERT|UPDATE|DELETE|SELECT|WITH|TRUNCATE)\b/i);
    }
    expect(matchAdmin).not.toContain('brownlow_seasons');
  });

  it('requires the dedicated import connection for match writes', () => {
    for (const mutation of [matchSheet, matchAdmin]) {
      expect(mutation).toContain('process.env.AFLDB_IMPORT_DATABASE_URL');
      expect(mutation).not.toMatch(/AFLDB_IMPORT_DATABASE_URL\s*\|\|/);
    }
  });

  it('refreshes every player-derived surface affected by a match fact', () => {
    for (const table of [
      'player_clubs',
      'player_club_season_stats',
      'player_season_stats',
      'player_career_stats',
    ]) {
      expect(playerDerived).toContain(table);
    }
    expect(playerDerived).toContain('career_game_no');
    expect(playerDerived).toContain('debut_season = span.debut_season');
    expect(matchAdmin).toContain('clearPlayerClubMatchReferences');
  });

  it('does not silently duplicate a natural match key and cites manual attendance', () => {
    expect(matchAdmin).not.toContain('Date.now()');
    expect(matchAdmin).toContain('already exists for that season, round, date and clubs');
    expect(matchAdmin).toContain('attendance_source_id');
    expect(matchAdmin).toContain("key = 'manual_admin_edit'");
    expect(matchAdmin).toContain('afldb_identity_for_season');
  });

  it('makes score synchronization opt-in and keeps the final period consistent', () => {
    expect(matchSheetUi).toContain('useState(false)');
    expect(matchSheet).not.toMatch(/COALESCE\(sum\((?:goals|behinds)\)/);
    expect(matchSheet).toContain('scoreSyncCoverageError');
    expect(matchSheet).toContain('INSERT INTO match_period_scores');
  });

  it('selects a prefill lineup strictly before the edited match', () => {
    expect(matchesQuery).toContain('beforeMatchId');
    expect(matchesQuery).toContain('(m.match_date, m.id) < (target.match_date, target.id)');
  });
});
