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

export type NlClubSeasonRow = {
  clubId: number; clubSlug: string; clubName: string;
  season: number;
  played: number; wins: number; draws: number; losses: number;
  ladderRank: number | null;
  value: number | null;
};

export type NlAnswerPayload =
  | { kind: 'player_game'; lead: NlPlayerGameRow | null; rows: NlPlayerGameRow[]; total: number }
  | { kind: 'player_career'; lead: NlPlayerCareerRow | null; rows: NlPlayerCareerRow[]; total: number }
  | { kind: 'player_season'; lead: NlPlayerSeasonRow | null; rows: NlPlayerSeasonRow[]; total: number }
  | { kind: 'team_match'; lead: NlTeamMatchRow | null; rows: NlTeamMatchRow[]; total: number }
  | { kind: 'club_season'; lead: NlClubSeasonRow | null; rows: NlClubSeasonRow[]; total: number }
  | { kind: 'count'; value: number }
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
