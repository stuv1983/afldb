/**
 * Types for a natural-language answer, DB-free like the rest of
 * src/search/nl -- the grain compilers in db/queries/nl/*.ts produce
 * these, and NlAnswerSection.tsx renders them. No behaviour here, only
 * shape, so both sides can be developed and tested independently.
 */

export type NlPlayerGameRow = {
  playerId: number; playerSlug: string; playerName: string;
  value: number;
  matchId: number; season: number;
  roundType: string; roundNumber: number | null;
  matchDate: string;
  clubName: string; opponentName: string;
  venueName: string | null;
  homeScore: number; awayScore: number;
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
  matchDate: string;
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
  | { kind: 'player_game'; lead: NlPlayerGameRow; rows: NlPlayerGameRow[]; total: number }
  | { kind: 'player_career'; lead: NlPlayerCareerRow | null; rows: NlPlayerCareerRow[]; total: number }
  | { kind: 'player_season'; lead: NlPlayerSeasonRow | null; rows: NlPlayerSeasonRow[]; total: number }
  | { kind: 'team_match'; lead: NlTeamMatchRow; rows: NlTeamMatchRow[]; total: number }
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
  payload: NlAnswerPayload;
};
