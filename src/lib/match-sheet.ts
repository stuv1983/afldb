export type PlayerMatchStatInput = {
  playerId: number;
  clubId: number;
  jumperNumber?: string | null;
  goals?: number | null;
  behinds?: number | null;
  kicks?: number | null;
  handballs?: number | null;
  disposals?: number | null;
  marks?: number | null;
  tackles?: number | null;
  hitouts?: number | null;
  freesFor?: number | null;
  freesAgainst?: number | null;
  brownlowVotes?: number | null;
};

export type MatchSheetPayload = {
  players: PlayerMatchStatInput[];
  removedPlayerIds: number[];
};

type ValidationResult =
  | { ok: true; value: MatchSheetPayload }
  | { ok: false; error: string };

const MAX_LINEUP_ROWS = 100;

const STAT_LIMITS = {
  goals: 40,
  behinds: 40,
  kicks: 100,
  handballs: 100,
  disposals: 150,
  marks: 60,
  tackles: 60,
  hitouts: 120,
  freesFor: 30,
  freesAgainst: 30,
  brownlowVotes: 3,
} as const satisfies Record<
  Exclude<keyof PlayerMatchStatInput, 'playerId' | 'clubId' | 'jumperNumber'>,
  number
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * Validate the client-controlled JSON carried by the match-sheet action.
 * HTML min/max attributes are presentation only; this is the write boundary.
 */
export function validateMatchSheetPayload(value: unknown): ValidationResult {
  if (!isRecord(value) || !Array.isArray(value.players)) {
    return { ok: false, error: 'Match sheet players must be an array.' };
  }
  if (value.players.length > MAX_LINEUP_ROWS) {
    return { ok: false, error: `A match sheet is limited to ${MAX_LINEUP_ROWS} player rows.` };
  }

  const rawRemoved = value.removedPlayerIds ?? [];
  if (!Array.isArray(rawRemoved) || rawRemoved.length > MAX_LINEUP_ROWS) {
    return { ok: false, error: 'Removed player IDs must be a bounded array.' };
  }

  const removedPlayerIds: number[] = [];
  const removedSeen = new Set<number>();
  for (const rawId of rawRemoved) {
    if (!positiveInteger(rawId)) {
      return { ok: false, error: 'Every removed player ID must be a positive integer.' };
    }
    if (!removedSeen.has(rawId)) {
      removedSeen.add(rawId);
      removedPlayerIds.push(rawId);
    }
  }

  const players: PlayerMatchStatInput[] = [];
  const playerIds = new Set<number>();
  for (let index = 0; index < value.players.length; index += 1) {
    const rawPlayer = value.players[index];
    if (!isRecord(rawPlayer)) {
      return { ok: false, error: `Player row ${index + 1} must be an object.` };
    }
    if (!positiveInteger(rawPlayer.playerId) || !positiveInteger(rawPlayer.clubId)) {
      return { ok: false, error: `Player row ${index + 1} requires positive integer player and club IDs.` };
    }
    if (playerIds.has(rawPlayer.playerId)) {
      return { ok: false, error: `Player ID ${rawPlayer.playerId} appears more than once in the match sheet.` };
    }
    playerIds.add(rawPlayer.playerId);

    const player: PlayerMatchStatInput = {
      playerId: rawPlayer.playerId,
      clubId: rawPlayer.clubId,
    };

    const rawJumper = rawPlayer.jumperNumber;
    if (rawJumper !== undefined && rawJumper !== null) {
      if (typeof rawJumper !== 'string' || rawJumper.trim().length > 4) {
        return { ok: false, error: `Player row ${index + 1} has an invalid jumper number.` };
      }
      player.jumperNumber = rawJumper.trim() || null;
    } else {
      player.jumperNumber = null;
    }

    for (const [field, max] of Object.entries(STAT_LIMITS) as [keyof typeof STAT_LIMITS, number][]) {
      const rawStat = rawPlayer[field];
      if (rawStat === undefined || rawStat === null) {
        player[field] = null;
        continue;
      }
      if (typeof rawStat !== 'number' || !Number.isInteger(rawStat) || rawStat < 0 || rawStat > max) {
        return {
          ok: false,
          error: `Player row ${index + 1} has an invalid ${field} value (expected 0–${max}).`,
        };
      }
      player[field] = rawStat;
    }

    if (
      player.kicks != null
      && player.handballs != null
      && player.disposals != null
      && player.disposals !== player.kicks + player.handballs
    ) {
      return {
        ok: false,
        error: `Player row ${index + 1} has disposals that do not equal kicks plus handballs.`,
      };
    }

    players.push(player);
  }

  return { ok: true, value: { players, removedPlayerIds } };
}

/** Preserve unknown component semantics: one recorded component is not a total. */
export function deriveDisposals(
  kicks: number | null | undefined,
  handballs: number | null | undefined,
  disposals: number | null | undefined,
): number | null {
  if (disposals !== null && disposals !== undefined) return disposals;
  if (kicks === null || kicks === undefined || handballs === null || handballs === undefined) {
    return null;
  }
  return kicks + handballs;
}

export type ScoreSyncCoverage = {
  homePlayers: number;
  awayPlayers: number;
  homeGoalsRecorded: number;
  homeBehindsRecorded: number;
  awayGoalsRecorded: number;
  awayBehindsRecorded: number;
};

/** Return a user-facing refusal when a score would require NULL-to-zero inference. */
export function scoreSyncCoverageError(coverage: ScoreSyncCoverage): string | null {
  if (coverage.homePlayers === 0 || coverage.awayPlayers === 0) {
    return 'Match scores can be synchronized only after both team lineups have been entered.';
  }
  if (
    coverage.homeGoalsRecorded !== coverage.homePlayers
    || coverage.homeBehindsRecorded !== coverage.homePlayers
    || coverage.awayGoalsRecorded !== coverage.awayPlayers
    || coverage.awayBehindsRecorded !== coverage.awayPlayers
  ) {
    return 'Match scores can be synchronized only when goals and behinds are recorded for every player on both teams.';
  }
  return null;
}
