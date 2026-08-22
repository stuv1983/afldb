import type { LinkTargetTable } from '@/db/queries/player-links';

/**
 * Deterministic player-link matching: the shared vocabulary.
 *
 * Everything in src/lib/player-matching is pure. It reads no database,
 * no clock and no randomness, so the admin page, the approval path and
 * the offline backtest all score identically -- the property the whole
 * feature rests on, because a suggestion approved in the UI is rescored
 * server-side before it is allowed to become a link.
 *
 * The type-only import above is erased at compile time, so this module
 * stays free of `server-only` and of the postgres driver.
 */

// ---------------------------------------------------------------------
// Identity: physical row versus logical resolution entity
// ---------------------------------------------------------------------

/**
 * What a resolution actually settles.
 *
 * Six of the seven review tables resolve themselves: linking
 * award_winners #412 links that row and nothing else. Draft picks do
 * not -- identity there is person-grained (migration 019), so resolving
 * one pick resolves every pick of that draft_person. Suggestions follow
 * the same grain, or one person with four picks would appear as four
 * independent decisions that silently duplicate each other.
 */
export type ResolutionEntityType = LinkTargetTable | 'draft_person';

export type MatchTarget = {
  targetTable: LinkTargetTable;
  targetId: number;
  resolutionEntityType: ResolutionEntityType;
  /** targetId for ordinary rows; draft_person_id for draft picks. */
  resolutionEntityId: number;
};

/** Stable key for a logical resolution entity. */
export function resolutionKey(target: MatchTarget): string {
  return `${target.resolutionEntityType}:${target.resolutionEntityId}`;
}

/** Stable key for one physical row. */
export function targetKey(target: Pick<MatchTarget, 'targetTable' | 'targetId'>): string {
  return `${target.targetTable}:${target.targetId}`;
}

// ---------------------------------------------------------------------
// Temporal evidence
// ---------------------------------------------------------------------

/**
 * A year in a source row is not automatically a playing season.
 *
 * Hall of Fame induction happens long after retirement and a draft year
 * precedes a career; treating either as "active in that season" would
 * manufacture era conflicts against the correct player. Each kind is
 * therefore labelled at extraction and consumed only where it means
 * something.
 */
export type TemporalEvidence =
  /**
   * The player was playing that season.
   *
   * competitionScope records WHICH competition. 'afldb' means the
   * season is a VFL/AFL season AFLDB itself records, so a career range
   * that excludes it genuinely disagrees. 'external' means the source
   * is describing another competition -- a Magarey or Sandover Medal, a
   * VFL Under 19s best-and-fairest, a pre-1993 All-Australian carnival
   * side -- where the player may legitimately have had no AFLDB season
   * at all that year. Backtesting made the distinction unavoidable:
   * every one of the 101 era contradictions raised against a KNOWN
   * CORRECT link came from award_winners rows of exactly this kind,
   * while nominations, achievements and captaincies produced none.
   */
  | { kind: 'active_season'; season: number; competitionScope: 'afldb' | 'external' }
  /** A career span asserted by the source (parsed Hall of Fame playing_career). */
  | { kind: 'active_range'; first: number; last: number }
  /** Drafted that year. Normally precedes the first AFL season. */
  | { kind: 'draft_year'; year: number }
  /** Inducted that year. Says nothing about when the player played. */
  | { kind: 'induction_year'; year: number }
  /** Career games/goals span as a non-AFLDB source reports it. */
  | { kind: 'reported_career_range'; first: number; last: number };

/** Every season the source places the player on a field, any competition. */
export function activeSeasons(temporal: readonly TemporalEvidence[]): number[] {
  return temporal
    .filter((t): t is Extract<TemporalEvidence, { kind: 'active_season' }> => t.kind === 'active_season')
    .map((t) => t.season)
    .sort((a, b) => a - b);
}

/**
 * Only the seasons AFLDB's own competition should be able to confirm.
 *
 * Agreement is safe to reward from any competition, but disagreement
 * may only be inferred from these: a WAFL medal in 1975 says nothing
 * about whether a player had a VFL season that year.
 */
export function afldbActiveSeasons(temporal: readonly TemporalEvidence[]): number[] {
  return temporal
    .filter(
      (t): t is Extract<TemporalEvidence, { kind: 'active_season' }> =>
        t.kind === 'active_season' && t.competitionScope === 'afldb',
    )
    .map((t) => t.season)
    .sort((a, b) => a - b);
}

/** The source-asserted career span, when one was parsed. */
export function assertedRange(
  temporal: readonly TemporalEvidence[],
): { first: number; last: number } | null {
  const range = temporal.find(
    (t): t is Extract<TemporalEvidence, { kind: 'active_range' }> => t.kind === 'active_range',
  );
  return range ? { first: range.first, last: range.last } : null;
}

export function draftYear(temporal: readonly TemporalEvidence[]): number | null {
  const found = temporal.find(
    (t): t is Extract<TemporalEvidence, { kind: 'draft_year' }> => t.kind === 'draft_year',
  );
  return found ? found.year : null;
}

// ---------------------------------------------------------------------
// Source-aware uniqueness
// ---------------------------------------------------------------------

/**
 * Where linking a player twice would actually be wrong.
 *
 * One AFLDB player legitimately holds many awards, captaincies,
 * nominations and achievements, so "this player is already linked
 * somewhere" is not a collision and must never be treated as one. The
 * only player-scoped uniqueness the schema really enforces is
 * honour_team_linked_player_uq (migration 059): a player may appear at
 * most once in a given honour team. Draft persons are deliberately not
 * scoped -- two draft_persons rows pointing at one player is legal and
 * carries only a non-unique index.
 */
export type LinkUniquenessScope =
  | { kind: 'honour_team'; teamName: string }
  | { kind: 'none' };

export function getLinkUniquenessScope(
  targetTable: LinkTargetTable,
  scopeValue: string | null,
): LinkUniquenessScope {
  if (targetTable === 'honour_team_members' && scopeValue) {
    return { kind: 'honour_team', teamName: scopeValue };
  }
  return { kind: 'none' };
}

// ---------------------------------------------------------------------
// The two sides of a comparison
// ---------------------------------------------------------------------

export type SourceEvidence = {
  target: MatchTarget;
  /** The name exactly as the source printed it. */
  rawName: string;
  /** afldb_normalise_name(rawName), computed in SQL so TS never forks it. */
  normalisedName: string;
  temporal: TemporalEvidence[];
  clubId: number | null;
  clubNameRaw: string | null;
  /** Draft sources only. Never treated as an AFLDB career total. */
  reportedGames: number | null;
  reportedGoals: number | null;
  /** Human context for the queue row, e.g. "Brownlow Medal - 1994 - Essendon". */
  context: string;
  /** The scope, if any, in which this player may be linked only once. */
  uniquenessScope: LinkUniquenessScope;
  linkStatus: string;
};

export type CandidateClub = {
  clubId: number;
  games: number | null;
  firstSeason: number | null;
  lastSeason: number | null;
};

export type CandidateEvidence = {
  playerId: number;
  displayName: string;
  /** players.search_name -- already normalised by the same SQL function. */
  searchName: string;
  aliasSearchNames: string[];
  /**
   * pg_trgm similarity between the normalised source name and the best
   * of this player's name/aliases. Supplied by SQL: TypeScript cannot
   * reproduce PostgreSQL trigram arithmetic exactly, and a second
   * implementation that disagreed would be worse than none.
   */
  nameSimilarity: number;
  givenName: string | null;
  surname: string | null;
  debutSeason: number | null;
  finalSeason: number | null;
  careerGames: number | null;
  careerGoals: number | null;
  clubs: CandidateClub[];
  /**
   * Whether the club rows account for the whole career. Only a complete
   * history can prove a club was NEVER played for; a partial one just
   * means AFLDB has not recorded it.
   */
  clubHistoryComplete: boolean;
  /**
   * Set when linking this candidate would breach a uniqueness rule that
   * actually exists for this source scope (see getLinkUniquenessScope).
   * Null is the normal case: one player legitimately holds many awards,
   * captaincies and achievements.
   */
  uniquenessConflict: string | null;
};

// ---------------------------------------------------------------------
// Scoring output
// ---------------------------------------------------------------------

/**
 * Signals are grouped into families and at most one signal per family
 * scores. An exact name is not also a trigram match and a surname
 * match; counting all three would let one piece of evidence pay three
 * times and push a fuzzy candidate into a band it did not earn.
 */
export type EvidenceFamily =
  | 'name'
  | 'club'
  | 'era'
  | 'career_span'
  | 'draft_timing'
  | 'draft_games'
  | 'draft_goals';

export type EvidenceItem = {
  family: EvidenceFamily;
  /** Stable machine name of the winning signal, e.g. 'name_exact'. */
  signal: string;
  /** What a human reviewer needs to see, e.g. 'Richmond, 1994'. */
  detail: string;
  points: number;
};

export type HardConflict = {
  reason: string;
  detail: string;
};

export type ScoredCandidate = {
  playerId: number;
  displayName: string;
  score: number;
  evidence: EvidenceItem[];
  conflicts: HardConflict[];
  hardConflict: boolean;
  /** Independent families that scored, name included. */
  corroboratingFamilies: number;
  /** Name evidence is exact or an exact alias, not fuzzy-only. */
  strongName: boolean;
};

export type ConfidenceBand = 'very_high' | 'high' | 'medium' | 'low' | 'none';

export type MatchAssessment = {
  best: ScoredCandidate | null;
  /** Ranked runners-up, best first. */
  alternatives: ScoredCandidate[];
  band: ConfidenceBand;
  /** best.score minus the next candidate score; null when alone. */
  gap: number | null;
  /** Candidates other than the best within the near-tie window. */
  nearTies: number;
  /** Two plausible candidates, or a strong score the gap does not support. */
  ambiguous: boolean;
  hardConflict: boolean;
  /**
   * Deliberately stricter than the display band: a row a human may
   * approve at a glance is not automatically one a machine may approve
   * unattended.
   */
  bulkEligible: boolean;
  algorithmVersion: string;
};
