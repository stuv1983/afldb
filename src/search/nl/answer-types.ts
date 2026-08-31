/**
 * Types for a natural-language answer, DB-free like the rest of
 * src/search/nl -- the grain compilers in db/queries/nl/*.ts produce
 * these, and NlAnswerSection.tsx renders them. No behaviour here, only
 * shape, so both sides can be developed and tested independently.
 */

/**
 * A player_game answer row covers two different questions with one shape:
 * mode 'single' ("dusty's highest disposal game") names one real match, so
 * every match-context field is populated and `games` is null; mode 'sum'
 * ("most goals against Carlton") ranks a scoped career total with no
 * single match to point at, so the match-context fields are null and
 * `games` says how many games the total was accumulated over instead.
 */
export type NlPlayerGameRow = {
  playerId: number; playerSlug: string; playerName: string;
  value: number;
  matchId: number | null; season: number | null;
  roundType: string | null; roundNumber: number | null;
  matchDate: Date | null;
  clubName: string | null; opponentName: string | null;
  venueName: string | null;
  homeScore: number | null; awayScore: number | null;
  /** Sum mode only: how many games the total spans. Null for a single-game row. */
  games: number | null;
};

export type NlPlayerCareerRow = {
  playerId: number; slug: string; displayName: string;
  value: number | null;
  games: number; debutSeason: number | null; finalSeason: number | null;
  clubNames: string | null;
};

export type NlPlayerSeasonRow = {
  playerId: number; slug: string; displayName: string;
  value: number;
  season: number; games: number;
  clubName: string | null; clubSlug: string | null;
};

export type NlTeamMatchRow = {
  matchId: number; season: number;
  roundType: string; roundNumber: number | null;
  matchDate: Date | null;
  clubName: string; clubSlug: string; opponentName: string; opponentSlug: string;
  value: number;
  clubScore: number; opponentScore: number;
  venueName: string | null;
};

/** One organization-level group returned by a team-result HAVING query. */
export type NlTeamAggregateRow = {
  organizationId: number;
  clubName: string;
  clubSlug: string;
  /** Number of qualifying matches (wins/losses/draws) in the requested scope. */
  value: number;
};

export type NlHeadToHeadRow = {
  clubAId: number; clubAName: string; clubASlug: string;
  clubBId: number; clubBName: string; clubBSlug: string;
  clubAWins: number; clubBWins: number; draws: number; total: number;
  lastMatchId: number | null; lastMatchDate: Date | null;
  lastMatchSeason: number | null; lastMatchRoundType: string | null;
  lastMatchRoundNumber: number | null;
  lastDrawMatchId: number | null; lastDrawDate: Date | null;
  lastDrawSeason: number | null; lastDrawRoundType: string | null;
  lastDrawRoundNumber: number | null;
};

export type NlTeamStreakRow = {
  clubId: number; clubName: string; clubSlug: string;
  opponentId?: number; opponentName?: string; opponentSlug?: string;
  streakLength: number;
  startDate: Date | null; endDate: Date | null;
};

export type NlClubSeasonRow = {
  clubId: number; clubSlug: string; clubName: string;
  season: number;
  played: number; wins: number; draws: number; losses: number;
  ladderRank: number | null;
  value: number | null;
};

/**
 * One group of an achievement summary: a club, a decade, a season, or a
 * single named occurrence. `label` is display text and `value` the count
 * (or the season, for earliest/latest); `href` links the group's own page
 * where one exists, so a club row can be clicked through.
 */
export type NlAchievementGroupRow = {
  label: string;
  value: number;
  href: string | null;
};

export type NlAnswerPayload =
  | { kind: 'player_game'; lead: NlPlayerGameRow | null; rows: NlPlayerGameRow[]; total: number }
  | { kind: 'player_career'; lead: NlPlayerCareerRow | null; rows: NlPlayerCareerRow[]; total: number }
  | { kind: 'player_season'; lead: NlPlayerSeasonRow | null; rows: NlPlayerSeasonRow[]; total: number }
  | { kind: 'team_match'; lead: NlTeamMatchRow | null; rows: NlTeamMatchRow[]; total: number }
  | { kind: 'team_aggregate'; rows: NlTeamAggregateRow[]; total: number }
  | { kind: 'head_to_head'; row: NlHeadToHeadRow | null }
  | { kind: 'team_streak'; lead: NlTeamStreakRow | null; rows: NlTeamStreakRow[]; total: number }
  | { kind: 'club_season'; lead: NlClubSeasonRow | null; rows: NlClubSeasonRow[]; total: number }
  | { kind: 'count'; value: number }
  | {
      kind: 'achievement_summary';
      /** What the groups are: 'club' | 'decade' | 'season' | 'occurrence'. */
      groupBy: string;
      /** The achievement's display label, e.g. "Scored a goal with their first kick". */
      achievementLabel: string;
      rows: NlAchievementGroupRow[];
      /** Linked rows the summary covers, so a caveat can say what it excludes. */
      total: number;
    }
  | { kind: 'unanswerable'; topic: string; reason: string };

export type NlAnswer = {
  headline: string;
  interpretation: string;
  caveats: string[];
  coverageNote: string | null;
  explain: string[];
  /** Present only when the answer resolved to a real plan (absent for the unanswerable payload). */
  planToken: string | null;
  /**
   * Opaque per-search token, matching nl_search_log.client_ref, so a
   * reader's "was this correct?" reply can be attached to this exact
   * search (migration 049). Random and meaningless -- it is NOT the
   * nl_sid session cookie, which spans many searches, and it identifies
   * nobody.
   */
  clientRef: string;
  payload: NlAnswerPayload;
};
