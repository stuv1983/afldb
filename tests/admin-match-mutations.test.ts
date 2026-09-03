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
  const dataEdits = source('src', 'db', 'queries', 'data-edits.ts');
  const matchSheetUi = source('src', 'app', 'admin', 'data-editor', 'MatchSheetEditor.tsx');
  const matchesQuery = source('src', 'db', 'queries', 'matches.ts');

  it('never mutates authoritative Brownlow season totals from match detail', () => {
    for (const mutation of [matchSheet, matchAdmin]) {
      expect(mutation).not.toMatch(/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+brownlow_season_votes/i);
      expect(mutation).not.toMatch(/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+brownlow_round_votes/i);
    }
    expect(playerDerived).toContain('FROM brownlow_season_votes');
    expect(playerDerived).not.toMatch(/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+brownlow_season_votes/i);
  });

  // AFLDB-ISSUE-129 §8.4 item 9: a super admin may select wildcard_final wherever
  // an explicit round_type is already selectable, and it is never inferred. All
  // three admin surfaces have to agree, or an operator can never repair a
  // Wildcard Final through the data editor.
  it('lets admin tooling select wildcard_final explicitly on every surface', () => {
    const createForm = source('src', 'app', 'admin', 'data-editor', 'CreateMatchForm.tsx');
    const actions = source('src', 'app', 'admin', 'data-editor', 'actions.ts');

    expect(createForm).toContain('<option value="wildcard_final">Wildcard Final</option>');
    // The server action's allow-list is the real gate; the form alone proves nothing.
    expect(actions).toMatch(/roundTypes = \[[^\]]*'wildcard_final'/s);
    expect(matchAdmin).toMatch(/roundType: [^;]*'wildcard_final'/);
    // A non-home-and-away round derives its code from the type, so an omitted
    // round_code must become 'WF' rather than the generic 'Final' default.
    expect(matchAdmin).toContain("case 'wildcard_final': roundCode = 'WF'; break;");
    // round_number stays NULL: isFinal is derived from round_type, and
    // matches_round_number_ck forbids a number on anything but home-and-away.
    expect(matchAdmin).toContain("const isFinal = input.roundType !== 'home_and_away';");
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

  it('writes every required data_edits audit inside the import transaction (AFLDB-ISSUE-027)', () => {
    const awardsAdmin = source('src', 'db', 'queries', 'awards-admin.ts');
    const players = source('src', 'db', 'queries', 'players.ts');
    for (const mutation of [matchSheet, matchAdmin, dataEdits, awardsAdmin, players]) {
      // The audit rides the mutation's own transaction handle...
      expect(mutation).toContain('recordDataEdit(tx');
      // ...and nothing may fall back to the old post-commit auth-pool write.
      expect(mutation).not.toContain('authSql');
      expect(mutation).not.toContain('auditWarning');
    }
    // The shared helper owns the one data_edits INSERT and never
    // swallows a failure — the transaction must abort with it.
    const auditLog = source('src', 'db', 'queries', 'audit-log.ts');
    expect(auditLog).toContain('INSERT INTO data_edits');
    expect(auditLog).not.toMatch(/catch\s*\(/);
    const playerLinks = source('src', 'db', 'queries', 'player-links.ts');
    expect(playerLinks).toContain('recordLinkedResolution(tx');
    expect(playerLinks).not.toMatch(/authSql`\s*INSERT INTO player_link_resolutions[\s\S]*?'linked'/);
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
    expect(playerDerived).toContain('search_rank = career.games');
    expect(playerDerived).toContain('debut_season = span.debut_season');
    expect(matchAdmin).toContain('clearPlayerClubMatchReferences');
    expect(matchAdmin).toContain('recomputeSeasonBrownlowStatus');
    expect(matchAdmin.indexOf('recomputeSeasonMetadata(tx, match.season)'))
      .toBeLessThan(matchAdmin.indexOf('recomputePlayerDerivedStats(tx, affectedIds, match.season)'));
  });

  it('rebuilds the stored season ladder after every match fact mutation', () => {
    // Both createMatch and deleteMatch refresh club_seasons, and only after the
    // season status is current (wooden spoons are gated on completion).
    expect(matchAdmin).toContain('recomputeClubSeasons(tx, input.season)');
    expect(matchAdmin).toContain('recomputeClubSeasons(tx, match.season)');
    expect(matchAdmin.indexOf('recomputeSeasonMetadata(tx, input.season)'))
      .toBeLessThan(matchAdmin.indexOf('recomputeClubSeasons(tx, input.season)'));
    expect(matchAdmin.indexOf('recomputeSeasonMetadata(tx, match.season)'))
      .toBeLessThan(matchAdmin.indexOf('recomputeClubSeasons(tx, match.season)'));
    expect(dataEdits).toContain('recomputeClubSeasons(tx, match.season)');
    expect(dataEdits.indexOf('recomputeSeasonMetadata(tx, match.season)'))
      .toBeLessThan(dataEdits.indexOf('recomputeClubSeasons(tx, match.season)'));
    // Fail closed, re-pointed by AFLDB-ISSUE-095 at the new source: the guard still
    // throws BEFORE anything is deleted, so a season with nothing to derive from keeps
    // its stored rows instead of being silently emptied. Only what counts as "nothing"
    // changed — no home-and-away matches, rather than no staging ladder rows.
    expect(playerDerived).toContain('no canonical home-and-away matches for season');
    expect(playerDerived.indexOf('no canonical home-and-away matches for season'))
      .toBeLessThan(playerDerived.indexOf('DELETE FROM club_seasons'));
    // The ladder is derived from AFLDB's own canonical match set. staging.team_seasons
    // was written only by the retired AFLDB_LEGACY_SQLITE importer, and the external
    // ladder that replaced it is a validation witness whose own values are a proven
    // local recomputation — so it is never read here.
    // Asserted against the read, not the whole file: the doc comment explains why the
    // old source was retired and must stay readable.
    expect(playerDerived).not.toContain('FROM staging.team_seasons');
    expect(playerDerived).toContain('FROM matches WHERE NOT is_final');
    // The DECLARED premiership-points rule, and the ranking it feeds.
    expect(playerDerived).toContain('t.wins * 4 + t.draws * 2');
    expect(playerDerived).toContain('r.premiership_points DESC');
    // No rank is invented for an exact points-and-percentage tie.
    expect(playerDerived).toContain('CASE WHEN k.tied = 1 THEN k.pos END');
    // Preserved semantics: a wooden spoon is still gated on a finished season, a drawn
    // Grand Final still awards no premiership, and provenance is no longer the retired
    // legacy registry key.
    expect(playerDerived).toContain("se.status = 'complete'");
    expect(playerDerived).toContain('winner_club_id IS NOT NULL');
    expect(playerDerived).toContain("(SELECT id FROM sources WHERE key = 'afltables')");
    expect(playerDerived).not.toContain('sports_data_lab');
  });

  it('does not silently duplicate a natural match key and cites manual attendance', () => {
    expect(matchAdmin).not.toContain('Date.now()');
    expect(matchAdmin).toContain('already exists for that season, round, date and clubs');
    expect(matchAdmin).toContain('attendance_source_id');
    expect(matchAdmin).toContain("key = 'manual_admin_edit'");
    expect(matchAdmin).toContain('afldb_identity_for_season');
  });

  it('refuses to derive team scores from player totals that omit rushed behinds', () => {
    expect(matchSheetUi).toContain('name="syncMatchScores" value="false"');
    expect(matchSheetUi).toContain('rushed behinds are not attributed to a player');
    expect(matchSheet).toContain('Team scores cannot be synchronized from player statistics');
    expect(matchSheet).not.toMatch(/(?:UPDATE\s+matches|INSERT\s+INTO\s+match_period_scores)/i);
  });

  it('selects a prefill lineup strictly before the edited match', () => {
    expect(matchesQuery).toContain('beforeMatchId');
    expect(matchesQuery).toContain('(m.match_date, m.id) < (target.match_date, target.id)');
  });

  it('turns a removed lineup row into a team-scoped replacement workflow', () => {
    expect(matchSheetUi).toContain('removePlayerFromLineup');
    expect(matchSheetUi).toContain('vacancy.clubId === clubId');
    expect(matchSheetUi).toContain('vacancy.removedPlayerId');
    expect(matchSheetUi).toContain('`+ Add replacement for ${clubName}`');
    expect(matchSheetUi).toContain('`+ Add another player to ${clubName}`');
    expect(matchSheetUi).not.toContain('addTeamChoice');
  });

  it('keeps Match Details score corrections and dependent summaries together', () => {
    expect(dataEdits).toContain('INSERT INTO match_period_scores');
    expect(dataEdits).toContain('GREATEST(COALESCE(max(period), 4), 4)');
    expect(dataEdits).toContain('recomputeSeasonMetadata(tx, match.season)');
    expect(dataEdits).toContain('recomputePlayerDerivedStats(tx, affectedIds, match.season)');
    expect(dataEdits).toContain('recomputeSeasonBrownlowStatus(tx, match.season)');
    expect(dataEdits.indexOf('recomputeSeasonMetadata(tx, match.season)'))
      .toBeLessThan(dataEdits.indexOf('recomputePlayerDerivedStats(tx, affectedIds, match.season)'));
  });
});
