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

/**
 * One coach's record over the matches in scope, mirroring
 * ClubCoachRecordRow (db/queries/coaches.ts) plus `coachOnly` and the
 * plan's ranked value.
 *
 * `slug` is derived with coachSlug: `coaches` stores none. `coachOnly`
 * decides the link -- a coach who also played resolves to their PLAYER
 * page, because /coaches/[slug]-id permanently redirects a linked coach
 * there, and a coach-only person must never be given a /players href.
 *
 * `firstSeason`-`lastSeason` is a SPAN, not a tenure: Jack Titus coached
 * Richmond in 1937 and again in 1965, which is 3 seasons in charge across
 * a 28-year span. `seasons` is the number that must be rendered beside it.
 */
export type NlCoachRecordRow = {
  coachId: number;
  slug: string;
  displayName: string;
  /** True when no player links to this coach (coaches_link_ck, migration 087). */
  coachOnly: boolean;
  playerId: number | null;
  playerSlug: string | null;
  firstSeason: number;
  lastSeason: number;
  /** Distinct seasons in charge, tenure gaps not counted. */
  seasons: number;
  /** Distinct club ORGANIZATIONS coached, never raw club identities. */
  organizations: number;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  finals: number;
  grandFinals: number;
  premierships: number;
  /** From `round(...)::numeric`, so postgres.js returns this as a string, never a number. */
  winPct: string;
  /** The plan's ranked/thresholded metric, or null for an unranked list. */
  value: number | null;
};

/**
 * One curated after-siren event (migration 089). Match-owned fields
 * (matchId, matchDate, roundType) are NULL for a match-unlinked row and
 * are NEVER filled from after_siren_kicks -- season and roundRaw are that
 * row's own facts and are not a substitute for a canonical match
 * (AFLDB-ISSUE-152 D10, §7.1).
 *
 * shot_detail, supergoal_scoring, the verbatim source scores, the link
 * provenance and the source notes are deliberately absent: D5 excludes
 * shot_detail, and the rest are provenance or verbatim source figures
 * (one 1944 row's goals.behinds does not add to its stated points -- 089's
 * own comment) that a natural-language answer must not present as a
 * computed fact.
 */
export type NlAfterSirenEventRow = {
  eventId: number;
  season: number;
  /** The source's own round string, verbatim. Displayed as recorded, never parsed. */
  roundRaw: string;
  competition: string;
  premiershipSeason: boolean;
  /** NULL when the source's kicker never linked to a player (6 of 126 measured). */
  playerId: number | null;
  playerSlug: string | null;
  /** Always present: the source's own spelling, shown when playerId is null. */
  playerName: string;
  clubName: string;
  clubSlug: string | null;
  opponentName: string;
  opponentSlug: string | null;
  kickScored: 'goal' | 'behind' | 'none';
  kickEffect: 'won' | 'drew' | 'none';
  kickerResult: 'win' | 'draw' | 'loss';
  /**
   * RENDERING ONLY (operator decision D13): fed to the existing
   * afterSirenEventLabel so an NL answer words an event the same way every
   * other AFLDB surface does. Not a parser dimension, not a plan field,
   * not filterable.
   */
  siren: 'final' | 'end_of_regulation' | 'end_of_extra_time';
  matchId: number | null;
  matchDate: Date | null;
  roundType: string | null;
  /** false when the source row carried no reference (1 of 126 measured). */
  cited: boolean;
  value: number | null;
};

/** One kicker, aggregated over the filtered events. Trusted link only. */
export type NlAfterSirenPlayerRow = {
  playerId: number; slug: string; displayName: string;
  /** The count of qualifying events. Measured ceiling is 2. */
  value: number;
  firstSeason: number; lastSeason: number;
  /** The clubs the player kicked for WITHIN the filtered set, not their career clubs. */
  clubNames: string | null;
};

/**
 * What the ownership rules left out of THIS answer, counted over the same
 * filtered set at answer time rather than hard-coded. Both are zero for
 * most answers; describe.ts words a caveat only when one is not.
 */
export type NlAfterSirenExclusions = {
  /** Events whose kicker never linked to a player, excluded from a player-subject answer. */
  noPlayerLink: number;
  /** Events with no canonical match, excluded when the question needs one (D10). */
  noMatchLink: number;
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
  | { kind: 'coach_record'; lead: NlCoachRecordRow | null; rows: NlCoachRecordRow[]; total: number }
  | {
      kind: 'after_siren_event';
      lead: NlAfterSirenEventRow | null; rows: NlAfterSirenEventRow[]; total: number;
      excluded: NlAfterSirenExclusions;
    }
  | {
      kind: 'after_siren_player';
      lead: NlAfterSirenPlayerRow | null; rows: NlAfterSirenPlayerRow[]; total: number;
      excluded: NlAfterSirenExclusions;
    }
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
