'use server';

import { revalidatePath } from 'next/cache';

import { createAwardWinner, createHallOfFameInductee, createHonourTeamMember } from '@/db/queries/awards-admin';
import { saveEdit } from '@/db/queries/data-edits';
import { createMatch, deleteMatch } from '@/db/queries/match-admin';
import { saveMatchSheet } from '@/db/queries/match-sheet';
import { createPlayer, type DraftPickInput } from '@/db/queries/players';
import { validateAdminMatchNumbers } from '@/lib/admin-match';
import { EDITABLE_ENTITIES } from '@/lib/edit/spec';
import { audit, requireSuperAdmin } from '@/lib/auth/session';
import { validateMatchSheetPayload } from '@/lib/match-sheet';

export type SimpleAdminActionState = {
  error?: string;
  message?: string;
  warning?: string;
  createdId?: number;
};

const ACTIVITY_AUDIT_WARNING =
  'The record was created, but its administrative activity audit could not be written. '
  + 'Do not submit it again; ask an administrator to reconcile the audit log.';

function combineWarnings(...warnings: Array<string | undefined>): string | undefined {
  return warnings.filter(Boolean).join(' ') || undefined;
}

export type DataEditState = {
  error?: string;
  message?: string;
  warning?: string;
  /** rebuild_derived targets left stale by the saved edit, if any. */
  staleDerived?: string[];
};

export type MatchSheetActionState = {
  error?: string;
  message?: string;
  warning?: string;
  playerCount?: number;
};

export type CreatePlayerActionState = {
  error?: string;
  message?: string;
  warning?: string;
  createdId?: number;
};

/**
 * Create a new player by hand (see changeLog.md).
 * Allows super admins to add bio info for draftees or historical players.
 */
export async function createPlayerAction(
  _prev: CreatePlayerActionState,
  formData: FormData,
): Promise<CreatePlayerActionState> {
  const admin = await requireSuperAdmin();

  const displayName = String(formData.get('displayName') ?? '').trim();
  if (!displayName || displayName.length > 100) {
    return { error: 'Display name is required (up to 100 characters).' };
  }

  const givenName = String(formData.get('givenName') ?? '').trim() || null;
  const surname = String(formData.get('surname') ?? '').trim() || null;
  const dob = String(formData.get('dob') ?? '').trim() || null;
  const dobConfidence = (String(formData.get('dobConfidence') ?? 'sourced') || 'sourced') as 'sourced' | 'estimated' | 'derived' | 'unknown';

  const rawHeight = formData.get('heightCm');
  const heightCm = rawHeight && Number.isInteger(Number(rawHeight)) ? Number(rawHeight) : null;

  const rawWeight = formData.get('weightKg');
  const weightKg = rawWeight && Number.isInteger(Number(rawWeight)) ? Number(rawWeight) : null;

  const notes = String(formData.get('notes') ?? '').trim() || null;

  // Draft information (optional)
  const recruitedFrom = String(formData.get('recruitedFrom') ?? '').trim() || null;
  const rawDraftYear = formData.get('draftYear');
  const draftYear = rawDraftYear !== null && rawDraftYear !== ''
    && Number.isInteger(Number(rawDraftYear)) ? Number(rawDraftYear) : null;
  const draftType = String(formData.get('draftType') ?? '').trim() || null;
  const rawPickNumber = formData.get('pickNumber');
  const pickNumber = rawPickNumber && Number.isInteger(Number(rawPickNumber)) ? Number(rawPickNumber) : null;
  const rawDraftClubId = formData.get('draftClubId');
  const draftClubId = rawDraftClubId && Number.isInteger(Number(rawDraftClubId)) ? Number(rawDraftClubId) : null;
  const rawDraftAge = formData.get('draftAge');
  const draftAge = rawDraftAge && Number.isInteger(Number(rawDraftAge)) ? Number(rawDraftAge) : null;
  const pickNote = String(formData.get('pickNote') ?? '').trim() || null;

  const hasDraftInfo = Boolean(
    recruitedFrom || rawDraftYear || draftType || rawPickNumber
    || rawDraftClubId || rawDraftAge || pickNote,
  );
  let draftInfo: DraftPickInput | null = null;
  if (hasDraftInfo) {
    if (draftYear === null || draftYear < 1981 || draftYear > 2100) {
      return { error: 'A valid draft year (1981–2100) is required with draft details.' };
    }
    draftInfo = {
      recruitedFrom,
      draftYear,
      draftType,
      pickNumber,
      clubId: draftClubId,
      draftAge,
      pickNote,
    };
  }

  try {
    // The required data_edits audit is written inside createPlayer's
    // import-role transaction (AFLDB-ISSUE-027): the player and its
    // audit row commit or roll back together.
    const player = await createPlayer({
      displayName,
      givenName,
      surname,
      dob,
      dobConfidence,
      heightCm,
      weightKg,
      notes,
      draftInfo,
    }, { adminUserId: admin.id, note: notes });

    let warning: string | undefined;
    try {
      await audit('player.created', {
        playerId: player.id,
        displayName: player.displayName,
        hasDraftInfo: Boolean(draftInfo),
      }, { userId: admin.id, label: admin.email });
    } catch (error) {
      console.error('Failed to log administrative audit for player creation', error);
      warning = combineWarnings(warning, ACTIVITY_AUDIT_WARNING);
    }

    revalidatePath('/', 'layout');

    return {
      message: `Created player "${player.displayName}" (ID #${player.id})${draftInfo ? ' with draft selection record' : ''}.`,
      createdId: player.id,
      warning,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Could not create player: ${msg}` };
  }
}

/**
 * Super Admin Action: Add an Award Winner (see changeLog.md).
 */
export async function createAwardWinnerAction(
  _prev: SimpleAdminActionState,
  formData: FormData,
): Promise<SimpleAdminActionState> {
  const admin = await requireSuperAdmin();

  const awardId = Number(formData.get('awardId'));
  if (!Number.isInteger(awardId) || awardId <= 0) {
    return { error: 'Please select an award.' };
  }

  const season = Number(formData.get('season'));
  if (!Number.isInteger(season) || season < 1897 || season > 2100) {
    return { error: 'Valid season year is required (1897–2100).' };
  }

  const rawPlayerId = formData.get('playerId');
  const playerId = rawPlayerId && Number.isInteger(Number(rawPlayerId)) && Number(rawPlayerId) > 0
    ? Number(rawPlayerId)
    : null;
  const playerNameRaw = String(formData.get('playerNameRaw') ?? '').trim() || null;

  if (!playerId && !playerNameRaw) {
    return { error: 'Either select a player or enter a recipient name.' };
  }

  const rawClubId = formData.get('clubId');
  const clubId = rawClubId && Number.isInteger(Number(rawClubId)) && Number(rawClubId) > 0
    ? Number(rawClubId)
    : null;

  const rawVotes = formData.get('votes');
  const votes = rawVotes !== null && rawVotes !== '' ? Number(rawVotes) : null;
  if (votes !== null && (!Number.isFinite(votes) || votes < 0 || votes > 999_999.99)) {
    return { error: 'Votes or statistic must be from 0 to 999999.99.' };
  }
  const position = String(formData.get('position') ?? '').trim() || null;
  const isCaptain = formData.get('isCaptain') === 'true' || formData.get('isCaptain') === 'on';
  const isViceCaptain = formData.get('isViceCaptain') === 'true' || formData.get('isViceCaptain') === 'on';
  const note = String(formData.get('note') ?? '').trim() || null;

  try {
    const result = await createAwardWinner({
      awardId,
      season,
      playerId,
      playerNameRaw,
      clubId,
      votes,
      position,
      isCaptain,
      isViceCaptain,
      note,
      adminUserId: admin.id,
    });

    let warning: string | undefined;
    try {
      await audit('award_winner.created', {
        awardId,
        season,
        playerId,
        winnerId: result.id,
      }, { userId: admin.id, label: admin.email });
    } catch (error) {
      console.error('Failed to log administrative audit for award winner creation', error);
      warning = combineWarnings(warning, ACTIVITY_AUDIT_WARNING);
    }

    revalidatePath('/', 'layout');

    return {
      message: `Added award recipient for season ${season} (Record #${result.id}).`,
      createdId: result.id,
      warning,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Failed to add award winner: ${msg}` };
  }
}

/**
 * Super Admin Action: Add a Hall of Fame Inductee (see changeLog.md).
 */
export async function createHallOfFameAction(
  _prev: SimpleAdminActionState,
  formData: FormData,
): Promise<SimpleAdminActionState> {
  const admin = await requireSuperAdmin();

  const name = String(formData.get('name') ?? '').trim();
  const rawPlayerId = formData.get('playerId');
  const playerId = rawPlayerId && Number.isInteger(Number(rawPlayerId)) && Number(rawPlayerId) > 0
    ? Number(rawPlayerId)
    : null;

  if (!name && !playerId) {
    return { error: 'Inductee name is required.' };
  }

  const category = String(formData.get('category') ?? 'Player').trim() || 'Player';
  const categories = ['Player', 'Coach', 'Umpire', 'Media', 'Administrator', 'Pioneer'];
  if (!categories.includes(category)) return { error: 'Invalid Hall of Fame category.' };
  const rawInductedYear = formData.get('inductedYear');
  const inductedYear = rawInductedYear !== null && rawInductedYear !== ''
    ? Number(rawInductedYear)
    : null;
  if (inductedYear === null || !Number.isInteger(inductedYear) || inductedYear < 1996 || inductedYear > 2100) {
    return { error: 'Valid inducted year is required (1996–2100).' };
  }

  const isLegend = formData.get('isLegend') === 'true' || formData.get('isLegend') === 'on';
  const rawLegendYear = formData.get('legendYear');
  const legendYear = isLegend && rawLegendYear !== null && rawLegendYear !== ''
    ? Number(rawLegendYear)
    : null;
  if (isLegend && (
    legendYear === null
    || !Number.isInteger(legendYear)
    || legendYear < inductedYear
    || legendYear > 2100
  )) {
    return { error: 'Legend year must be from the induction year to 2100.' };
  }

  const clubNameRaw = String(formData.get('clubNameRaw') ?? '').trim() || null;
  const state = String(formData.get('state') ?? '').trim() || null;
  const playingCareer = String(formData.get('playingCareer') ?? '').trim() || null;
  const notes = String(formData.get('notes') ?? '').trim() || null;

  try {
    const result = await createHallOfFameInductee({
      name,
      playerId,
      category,
      inductedYear,
      isLegend,
      legendYear,
      clubNameRaw,
      state,
      playingCareer,
      notes,
      adminUserId: admin.id,
    });

    let warning: string | undefined;
    try {
      await audit('hall_of_fame.created', {
        name,
        year: inductedYear,
        isLegend,
        id: result.id,
      }, { userId: admin.id, label: admin.email });
    } catch (error) {
      console.error('Failed to log administrative audit for Hall of Fame creation', error);
      warning = combineWarnings(warning, ACTIVITY_AUDIT_WARNING);
    }

    revalidatePath('/', 'layout');

    return {
      message: `Added Hall of Fame inductee "${name}" in ${inductedYear} (Record #${result.id}).`,
      createdId: result.id,
      warning,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Failed to add Hall of Fame inductee: ${msg}` };
  }
}

/**
 * Super Admin Action: Add a Representative / Honour Team Member (see changeLog.md).
 */
export async function createHonourTeamMemberAction(
  _prev: SimpleAdminActionState,
  formData: FormData,
): Promise<SimpleAdminActionState> {
  const admin = await requireSuperAdmin();

  const teamName = String(formData.get('teamName') ?? '').trim();
  if (!teamName) {
    return { error: 'Team name is required.' };
  }

  const rawPlayerId = formData.get('playerId');
  const playerId = rawPlayerId && Number.isInteger(Number(rawPlayerId)) && Number(rawPlayerId) > 0
    ? Number(rawPlayerId)
    : null;
  const playerNameRaw = String(formData.get('playerNameRaw') ?? '').trim() || null;

  if (!playerId && !playerNameRaw) {
    return { error: 'Either select a player or enter a player name.' };
  }

  const position = String(formData.get('position') ?? '').trim() || null;
  const role = String(formData.get('role') ?? '').trim() || null;
  const clubNameRaw = String(formData.get('clubNameRaw') ?? '').trim() || null;
  const rawSortOrder = formData.get('sortOrder');
  const sortOrder = rawSortOrder !== null && rawSortOrder !== '' ? Number(rawSortOrder) : 0;
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 50) {
    return { error: 'Lineup order must be a whole number from 0 to 50.' };
  }
  const note = String(formData.get('note') ?? '').trim() || null;

  try {
    const result = await createHonourTeamMember({
      teamName,
      playerId,
      playerNameRaw,
      position,
      role,
      clubNameRaw,
      sortOrder,
      note,
      adminUserId: admin.id,
    });

    let warning: string | undefined;
    try {
      await audit('honour_team_member.created', {
        teamName,
        playerName: playerNameRaw,
        playerId,
        id: result.id,
      }, { userId: admin.id, label: admin.email });
    } catch (error) {
      console.error('Failed to log administrative audit for honour-team creation', error);
      warning = combineWarnings(warning, ACTIVITY_AUDIT_WARNING);
    }

    revalidatePath('/', 'layout');

    return {
      message: `Added member to "${teamName}" (Record #${result.id}).`,
      createdId: result.id,
      warning,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Failed to add honour team member: ${msg}` };
  }
}

/**
 * Save one field group of one row. Guarded by requireSuperAdmin like
 * every other manual write; the statistical UPDATE itself runs as
 * afldb_import inside saveEdit, and every save lands one append-only
 * data_edits row.
 */
export async function saveDataEdit(
  _prev: DataEditState,
  formData: FormData,
): Promise<DataEditState> {
  const admin = await requireSuperAdmin();

  const entityKey = String(formData.get('entity') ?? '');
  const entity = EDITABLE_ENTITIES[entityKey];
  if (!entity) return { error: 'Unknown entity.' };

  const rowId = Number(formData.get('rowId'));
  if (!Number.isInteger(rowId) || rowId <= 0) return { error: 'Bad row id.' };

  const groupKey = String(formData.get('group') ?? '');
  const group = entity.groups[groupKey];
  if (!group) return { error: 'Unknown field group.' };

  const note = String(formData.get('note') ?? '').trim();
  if (note.length > 2000) return { error: 'Notes are limited to 2000 characters.' };

  const raw: Record<string, string> = {};
  for (const fieldKey of group.fields) {
    raw[fieldKey] = String(formData.get(fieldKey) ?? '');
  }

  const result = await saveEdit({
    entityKey, rowId, groupKey, raw, adminUserId: admin.id, note,
  });
  if (!result.ok) return { error: result.error };

  if (Object.keys(result.changed).length === 0) {
    return { message: 'No change — the values already match.' };
  }

  let warning: string | undefined;
  try {
    await audit('data_edit.saved', { entity: entityKey, rowId, group: groupKey },
      { userId: admin.id, label: admin.email });
  } catch (error) {
    console.error('Failed to log administrative audit for data edit', error);
    warning = combineWarnings(warning, ACTIVITY_AUDIT_WARNING);
  }

  revalidatePath('/', 'layout');

  const summary = Object.entries(result.changed)
    .map(([k, c]) => `${entity.fields[k].label}: ${c.from ?? '—'} → ${c.to ?? '—'}`)
    .join('; ');
  return {
    message: `Saved. ${summary}.`,
    warning,
    staleDerived: group.affectsDerived,
  };
}

/**
 * Save complete match sheet (lineups and stats) from GUI (see changeLog.md).
 */
export async function saveMatchSheetAction(
  _prev: MatchSheetActionState,
  formData: FormData,
): Promise<MatchSheetActionState> {
  const admin = await requireSuperAdmin();

  const matchId = Number(formData.get('matchId'));
  if (!Number.isInteger(matchId) || matchId <= 0) {
    return { error: 'Invalid match ID.' };
  }

  const syncMatchScores = formData.get('syncMatchScores') === 'true' || formData.get('syncMatchScores') === 'on';
  const payloadRaw = String(formData.get('payload') ?? '');
  const note = String(formData.get('note') ?? '').trim();

  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(payloadRaw);
  } catch {
    return { error: 'Invalid match sheet payload data.' };
  }

  const payload = validateMatchSheetPayload(rawPayload);
  if (!payload.ok) return { error: payload.error };
  if (note.length > 2000) return { error: 'Notes are limited to 2000 characters.' };

  const result = await saveMatchSheet({
    matchId,
    syncMatchScores,
    players: payload.value.players,
    removedPlayerIds: payload.value.removedPlayerIds,
    adminUserId: admin.id,
    note,
  });

  if (!result.ok) {
    return { error: result.error };
  }

  let warning: string | undefined;
  try {
    await audit('match.sheet_saved', {
      matchId,
      playerCount: result.playerCount,
      scoreUpdated: result.scoreUpdated,
    }, { userId: admin.id, label: admin.email });
  } catch (error) {
    console.error('Failed to log administrative audit for match-sheet save', error);
    warning = combineWarnings(warning, ACTIVITY_AUDIT_WARNING);
  }

  revalidatePath('/', 'layout');

  return {
    message: `Match sheet saved successfully (${result.playerCount} players). ${result.scoreUpdated ? 'Match scores synchronized.' : ''} Career and season stats updated.`,
    playerCount: result.playerCount,
    warning,
  };
}

/**
 * Super Admin: Create a new match record (see changeLog.md).
 * Enables creating in-progress or completed matches, then proceeding to lineup/player stats entry.
 */
export async function createMatchAction(
  _prev: SimpleAdminActionState,
  formData: FormData,
): Promise<SimpleAdminActionState> {
  const admin = await requireSuperAdmin();

  const season = Number(formData.get('season'));
  if (!Number.isInteger(season) || season < 1897 || season > 2100) {
    return { error: 'Valid season year is required (1897–2100).' };
  }

  const roundTypeValue = String(formData.get('roundType') ?? 'home_and_away') || 'home_and_away';
  const roundTypes = [
    'home_and_away',
    // Explicitly selectable, never inferred from free text (ISSUE-129 §8.4 item 9).
    'wildcard_final',
    'elimination_final',
    'qualifying_final',
    'semi_final',
    'preliminary_final',
    'grand_final',
  ] as const;
  if (!(roundTypes as readonly string[]).includes(roundTypeValue)) {
    return { error: 'Invalid round type.' };
  }
  const roundType = roundTypeValue as (typeof roundTypes)[number];
  const rawRoundNumber = formData.get('roundNumber');
  const roundNumber = rawRoundNumber && Number.isInteger(Number(rawRoundNumber)) ? Number(rawRoundNumber) : null;
  if (roundType === 'home_and_away' && (roundNumber === null || roundNumber < 1 || roundNumber > 30)) {
    return { error: 'Home-and-away round number must be between 1 and 30.' };
  }
  const roundCode = String(formData.get('roundCode') ?? '').trim() || null;

  const matchDate = String(formData.get('matchDate') ?? '').trim();
  if (!matchDate || !/^\d{4}-\d{2}-\d{2}$/.test(matchDate)) {
    return { error: 'Valid match date (YYYY-MM-DD) is required.' };
  }
  const matchTime = String(formData.get('matchTime') ?? '').trim() || null;

  const rawVenueId = formData.get('venueId');
  const venueId = rawVenueId && Number.isInteger(Number(rawVenueId)) && Number(rawVenueId) > 0 ? Number(rawVenueId) : null;
  const venueRaw = String(formData.get('venueRaw') ?? '').trim() || null;

  const homeClubId = Number(formData.get('homeClubId'));
  const awayClubId = Number(formData.get('awayClubId'));
  if (!Number.isInteger(homeClubId) || homeClubId <= 0 || !Number.isInteger(awayClubId) || awayClubId <= 0) {
    return { error: 'Both Home club and Away club are required.' };
  }
  if (homeClubId === awayClubId) {
    return { error: 'Home club and Away club must be different.' };
  }

  const parseScoreNum = (key: string) => {
    const v = formData.get(key);
    return v !== null && v !== '' ? Number(v) : null;
  };

  const homeGoals = parseScoreNum('homeGoals');
  const homeBehinds = parseScoreNum('homeBehinds');
  const homeScore = parseScoreNum('homeScore');

  const awayGoals = parseScoreNum('awayGoals');
  const awayBehinds = parseScoreNum('awayBehinds');
  const awayScore = parseScoreNum('awayScore');

  const attendance = parseScoreNum('attendance');
  const matchEvent = String(formData.get('matchEvent') ?? '').trim() || null;
  const notes = String(formData.get('notes') ?? '').trim() || null;

  // Optional quarter scores
  const homeQuarters: Record<number, { goals?: number | null; behinds?: number | null; points?: number | null }> = {};
  const awayQuarters: Record<number, { goals?: number | null; behinds?: number | null; points?: number | null }> = {};
  for (let p = 1; p <= 4; p++) {
    homeQuarters[p] = {
      goals: parseScoreNum(`homeQ${p}Goals`),
      behinds: parseScoreNum(`homeQ${p}Behinds`),
      points: parseScoreNum(`homeQ${p}Points`),
    };
    awayQuarters[p] = {
      goals: parseScoreNum(`awayQ${p}Goals`),
      behinds: parseScoreNum(`awayQ${p}Behinds`),
      points: parseScoreNum(`awayQ${p}Points`),
    };
  }

  const numericError = validateAdminMatchNumbers({
    homeGoals,
    homeBehinds,
    homeScore,
    awayGoals,
    awayBehinds,
    awayScore,
    attendance,
    homeQuarters,
    awayQuarters,
  });
  if (numericError) return { error: numericError };

  try {
    const result = await createMatch({
      season,
      roundType,
      roundNumber,
      roundCode,
      matchDate,
      matchTime,
      venueId,
      venueRaw,
      homeClubId,
      awayClubId,
      homeGoals,
      homeBehinds,
      homeScore,
      awayGoals,
      awayBehinds,
      awayScore,
      attendance,
      matchEvent,
      notes,
      homeQuarters,
      awayQuarters,
      adminUserId: admin.id,
    });

    let warning: string | undefined;
    try {
      await audit('match.created', {
        matchId: result.id,
        season: result.season,
        homeClubId,
        awayClubId,
        matchDate,
      }, { userId: admin.id, label: admin.email });
    } catch (error) {
      console.error('Failed to log administrative audit for match creation', error);
      warning = combineWarnings(warning, ACTIVITY_AUDIT_WARNING);
    }

    revalidatePath('/', 'layout');

    return {
      message: `Created match #${result.id} (${matchDate}).`,
      createdId: result.id,
      warning,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Could not create match: ${msg}` };
  }
}

/**
 * Super Admin: Delete a match from the database (see changeLog.md).
 * Removes match, lineups, stats, and automatically recalculates career/season stats.
 */
export async function deleteMatchAction(
  _prev: SimpleAdminActionState,
  formData: FormData,
): Promise<SimpleAdminActionState> {
  const admin = await requireSuperAdmin();

  const matchId = Number(formData.get('matchId'));
  if (!Number.isInteger(matchId) || matchId <= 0) {
    return { error: 'Invalid match ID.' };
  }

  const reason = String(formData.get('reason') ?? '').trim() || 'Deleted match via Data Editor';

  const result = await deleteMatch({
    matchId,
    adminUserId: admin.id,
    reason,
  });

  if (!result.ok) {
    return { error: result.error };
  }

  let warning: string | undefined;
  try {
    await audit('match.deleted', {
      matchId,
      affectedPlayers: result.affectedPlayers,
    }, { userId: admin.id, label: admin.email });
  } catch (error) {
    console.error('Failed to log administrative audit for match deletion', error);
    warning = combineWarnings(warning, ACTIVITY_AUDIT_WARNING);
  }

  revalidatePath('/', 'layout');

  return {
    message: `Match #${matchId} deleted successfully. Player stats recalculated for ${result.affectedPlayers} affected players.`,
    warning,
  };
}
