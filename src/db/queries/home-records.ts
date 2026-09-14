import 'server-only';

import { getAfterSirenRecords } from '@/db/queries/after-siren';
import {
  getCoachRecordsByGames,
  getCoachRecordsByMetric,
  getCoachRecordsByWinPct,
  type CoachRecordRow,
} from '@/db/queries/coaches';
import { getFirstKickGoalRecordLeaders } from '@/db/queries/player-achievements';
import { getCareerRecord, getMatchRecord, getSeasonRecord } from '@/db/queries/records';
import { getVenueRecordLeaders } from '@/db/queries/venues';
import {
  getHomeRecordDefinition,
  type HomeRecordDefinition,
  type HomeRecordProvider,
} from '@/lib/home-records';

type ValueRow = { value: number };
type CoachProvider = Extract<HomeRecordProvider, { kind: 'coach' }>;

export type HomePlayerTotalRow = ValueRow & {
  kind: 'player-total';
  playerId: number;
  playerSlug: string;
  displayName: string;
};

export type HomePlayerMatchRow = ValueRow & {
  kind: 'player-match';
  playerId: number;
  playerSlug: string;
  displayName: string;
  matchId: number;
  season: number;
  roundType: string;
  roundNumber: number | null;
  opponentName: string;
};

export type HomePlayerSeasonRow = ValueRow & {
  kind: 'player-season';
  playerId: number;
  playerSlug: string;
  displayName: string;
  season: number;
  clubName: string | null;
};

export type HomeCoachTotalRow = ValueRow & {
  kind: 'coach-total';
  coachId: number;
  displayName: string;
};

export type HomeVenueTotalRow = ValueRow & {
  kind: 'venue-total';
  venueSlug: string;
  venueName: string;
};

export type HomeSpecialPlayerTotalRow = ValueRow & {
  kind: 'special-player-total';
  playerId: number;
  playerSlug: string;
  displayName: string;
  season?: number;
};

export type HomeRecordRow =
  | HomePlayerTotalRow
  | HomePlayerMatchRow
  | HomePlayerSeasonRow
  | HomeCoachTotalRow
  | HomeVenueTotalRow
  | HomeSpecialPlayerTotalRow;

export type HomeRecordResult = {
  definition: HomeRecordDefinition;
  rows: HomeRecordRow[];
};

function coachValue(row: CoachRecordRow, metric: CoachProvider): number {
  switch (metric.metric) {
    case 'games': return row.games;
    case 'wins': return row.wins;
    case 'finals': return row.finals;
    case 'grandFinals': return row.grandFinals;
    case 'premierships': return row.premierships;
    case 'winPct': return Number(row.winPct ?? 0);
  }
}

async function coachRows(
  provider: CoachProvider,
  limit: number,
): Promise<HomeCoachTotalRow[]> {
  const rows = provider.metric === 'games'
    ? await getCoachRecordsByGames(limit)
    : provider.metric === 'winPct'
      ? await getCoachRecordsByWinPct(provider.minGames ?? 50, limit)
      : await getCoachRecordsByMetric(provider.metric, limit);
  return rows.map((row) => ({
    kind: 'coach-total',
    coachId: row.coachId,
    displayName: row.displayName,
    value: coachValue(row, provider),
  }));
}

/** Resolve one safe catalogue entry and execute only its selected provider. */
export async function getHomeRecord(value: unknown, limit = 5): Promise<HomeRecordResult> {
  const definition = getHomeRecordDefinition(value);
  const { provider } = definition;

  switch (provider.kind) {
    case 'career': {
      const rows = await getCareerRecord(provider.category, limit);
      return {
        definition,
        rows: rows.map((row) => ({
          kind: 'player-total', playerId: row.playerId, playerSlug: row.slug,
          displayName: row.displayName, value: row.value,
        })),
      };
    }
    case 'match': {
      const rows = await getMatchRecord(provider.category, limit);
      return {
        definition,
        rows: rows.map((row) => ({
          kind: 'player-match', playerId: row.playerId, playerSlug: row.slug,
          displayName: row.displayName, value: row.value, matchId: row.matchId,
          season: row.season, roundType: row.roundType, roundNumber: row.roundNumber,
          opponentName: row.opponentName,
        })),
      };
    }
    case 'season': {
      const rows = await getSeasonRecord(limit);
      return {
        definition,
        rows: rows.map((row) => ({
          kind: 'player-season', playerId: row.playerId, playerSlug: row.slug,
          displayName: row.displayName, value: row.value, season: row.season,
          clubName: row.clubName,
        })),
      };
    }
    case 'coach':
      return { definition, rows: await coachRows(provider, limit) };
    case 'venue': {
      const rows = await getVenueRecordLeaders(provider.metric, limit);
      return {
        definition,
        rows: rows.map((row) => ({
          kind: 'venue-total', venueSlug: row.venueSlug,
          venueName: row.venueName, value: row.value,
        })),
      };
    }
    case 'after-siren': {
      const rows = await getAfterSirenRecords({ metric: provider.metric, limit });
      return {
        definition,
        rows: rows.map((row) => ({
          kind: 'special-player-total', playerId: row.playerId, playerSlug: row.slug,
          displayName: row.displayName, value: row[provider.metric],
        })),
      };
    }
    case 'first-kick': {
      const rows = await getFirstKickGoalRecordLeaders(limit);
      return {
        definition,
        rows: rows.map((row) => ({
          kind: 'special-player-total', playerId: row.playerId, playerSlug: row.playerSlug,
          displayName: row.playerName, value: row.consecutiveGoalKicks, season: row.season,
        })),
      };
    }
  }
}
