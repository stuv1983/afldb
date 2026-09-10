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
  /**
   * Read-only mirror of the canonical match-level Brownlow fact
   * (AFLDB-ISSUE-155 §27.15). The match sheet no longer writes it; a non-null
   * value is refused at the write boundary below so a stale editor cannot
   * overwrite the mirror maintained by Brownlow administration.
   */
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
} as const satisfies Record<
  Exclude<
    keyof PlayerMatchStatInput,
    'playerId' | 'clubId' | 'jumperNumber' | 'brownlowVotes'
  >,
  number
>;

/** AFLDB-ISSUE-155 §27.15: the single refusal message for a legacy vote write. */
export const BROWNLOW_MATCH_SHEET_REFUSAL =
  'Brownlow votes are managed in Brownlow administration (/admin/brownlow) and cannot be saved from the match sheet.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function normaliseStatString(value: string): string {
  return value.trim();
}

function parseStatString(value: string): number | null {
  const trimmed = normaliseStatString(value);
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) ? parsed : null;
}

/**
 * Keep the editor's derived disposal cell aligned with the NULL semantics of
 * player_match_stats. If either component is blank, disposals must not be
 * auto-filled from a partial total; the admin can still type an explicit
 * disposal value if the source records one.
 */
export function autoDisposalsFromComponents(
  kicks: string,
  handballs: string,
): string {
  const parsedKicks = parseStatString(kicks);
  const parsedHandballs = parseStatString(handballs);
  if (parsedKicks === null || parsedHandballs === null) return '';
  return String(parsedKicks + parsedHandballs);
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
    if (removedSeen.has(rawPlayer.playerId)) {
      return {
        ok: false,
        error: `Player ID ${rawPlayer.playerId} cannot be both active and removed in the match sheet.`,
      };
    }
    playerIds.add(rawPlayer.playerId);

    // AFLDB-ISSUE-155 §27.15: the canonical Brownlow fact is written only by
    // Brownlow administration. Refuse rather than silently drop the value, so a
    // stale editor cannot appear to have saved a vote it did not save.
    if (rawPlayer.brownlowVotes !== undefined && rawPlayer.brownlowVotes !== null) {
      return { ok: false, error: BROWNLOW_MATCH_SHEET_REFUSAL };
    }

    const player: PlayerMatchStatInput = {
      playerId: rawPlayer.playerId,
      clubId: rawPlayer.clubId,
      brownlowVotes: null,
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
