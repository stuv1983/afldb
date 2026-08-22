import type {
  ConfidenceBand,
  MatchAssessment,
  ScoredCandidate,
} from '@/lib/player-matching/types';

/**
 * Matching policy: every weight, threshold and eligibility rule.
 *
 * One module owns all of them so that a change is a single visible
 * diff, and so the backtest can print the exact policy it measured
 * beside the version string it measured it under. A reported precision
 * belongs to a policy, not to a codebase in general.
 *
 * Bump ALGORITHM_VERSION whenever anything below changes. Cached
 * suggestions carry the version they were computed under and are
 * refused at approval when it no longer matches.
 */
export const ALGORITHM_VERSION = 'v1';

export const MATCH_POLICY = {
  scoring: {
    /**
     * Name. One signal only: exactness already implies similarity, and
     * paying for both would rank a fuzzy namesake alongside an exact one.
     */
    name: {
      exact: 44,
      aliasExact: 41,
      trigramHigh: 26,
      surnameInitial: 20,
      trigramMedium: 15,
      trigramHighFloor: 0.9,
      trigramMediumFloor: 0.75,
    },
    /**
     * Club. Corroborating the club IN the source season is much stronger
     * evidence than having played there at some point in a 15-year career.
     */
    club: {
      clubSeason: 36,
      clubAnywhere: 15,
    },
    /** Playing era, from active seasons only -- never induction or draft years. */
    era: {
      seasonInCareer: 17,
      seasonNearCareer: 9,
      nearToleranceSeasons: 1,
    },
    /** Hall of Fame playing_career span against the AFLDB career range. */
    careerSpan: {
      exact: 17,
      overlap: 9,
    },
    /** A draft year should sit just before the first AFLDB season. */
    draftTiming: {
      points: 13,
      debutWithinYears: 3,
    },
    /**
     * Draft-source career totals. Independent of each other and of the
     * name, but both derive from the same external record, so neither is
     * worth as much as club-in-season corroboration.
     */
    draftGames: { exact: 15, near: 7, nearTolerance: 2 },
    draftGoals: { exact: 10, near: 5, nearTolerance: 2 },
  },

  /**
   * Contradictions. Tracked separately from the score: several weak
   * positives must never bury one reliable contradiction.
   */
  conflicts: {
    /** Seasons outside a COMPLETE career range by more than this. */
    eraToleranceSeasons: 1,
  },

  /**
   * Candidate generation. Blocking decides who is even compared, so a
   * floor set too high loses the right player before scoring begins --
   * the failure the backtest measures as candidate-generation recall.
   * It is deliberately looser than the scoring thresholds: extra weak
   * candidates only cost compute and, by narrowing the gap, make the
   * result more cautious rather than less.
   */
  blocking: {
    trigramFloor: 0.45,
    trigramCandidatesPerSource: 20,
    maxCandidatesPerSource: 25,
  },

  /**
   * Band thresholds, set from the measured score distribution rather
   * than assumed. AFLDB source rows carry no date of birth, so the
   * reachable ceiling is a fully corroborated name + club-in-season +
   * era (97) or name + draft timing + games + goals (97); an exact name
   * on its own is 44. The backtest's precision by score is what places
   * the lines.
   */
  bands: {
    veryHighScore: 85,
    veryHighGap: 15,
    highScore: 70,
    highGap: 10,
    mediumScore: 55,
    lowScore: 40,
    /** Another candidate this close makes the top one ambiguous. */
    nearTieWithin: 5,
  },

  /**
   * Bulk approval is a separate, stricter question from the display
   * band. A human reading the evidence can approve a very_high row;
   * an unattended batch may only take rows that also carry exact-quality
   * name evidence and independent corroboration.
   */
  bulk: {
    minScore: 90,
    minGap: 25,
    minCorroboratingFamilies: 2,
    requireStrongName: true,
  },
} as const;

/** Queue ordering: most confident first, unscored last. */
export const BAND_ORDER: readonly ConfidenceBand[] = [
  'very_high',
  'high',
  'medium',
  'low',
  'none',
] as const;

export function isConfidenceBand(value: string): value is ConfidenceBand {
  return (BAND_ORDER as readonly string[]).includes(value);
}

/**
 * Deterministic ranking. Score descending, then player id ascending so
 * that two candidates on the same score always order the same way --
 * the backtest and the page must never disagree about which one is
 * "best" because of Array.sort instability or row arrival order.
 */
function rank(candidates: readonly ScoredCandidate[]): ScoredCandidate[] {
  return [...candidates].sort((a, b) =>
    b.score - a.score || a.playerId - b.playerId);
}

function bandFor(score: number, gap: number | null, hardConflict: boolean): ConfidenceBand {
  const { bands } = MATCH_POLICY;
  // A single candidate has nothing to be ambiguous against, so a null
  // gap satisfies every gap requirement.
  const clears = (required: number) => gap === null || gap >= required;

  let band: ConfidenceBand;
  if (score >= bands.veryHighScore && clears(bands.veryHighGap)) band = 'very_high';
  else if (score >= bands.highScore && clears(bands.highGap)) band = 'high';
  else if (score >= bands.mediumScore) band = 'medium';
  else if (score >= bands.lowScore) band = 'low';
  else band = 'none';

  // A reliable contradiction caps the band however well the rest scored.
  if (hardConflict && (band === 'very_high' || band === 'high' || band === 'medium')) {
    return 'low';
  }
  return band;
}

/**
 * Turn a scored candidate set into the decision the UI and the approval
 * path both read.
 *
 * The gap is measured against the next candidate by score whether or
 * not that candidate has a conflict. Excluding conflicted rivals would
 * widen the gap exactly when the evidence is muddiest, and this feature
 * is built to prefer an unmatched player over a wrong one.
 */
export function assessMatch(candidates: readonly ScoredCandidate[]): MatchAssessment {
  const ranked = rank(candidates);
  const best = ranked[0] ?? null;
  const alternatives = ranked.slice(1);

  if (!best) {
    return {
      best: null,
      alternatives: [],
      band: 'none',
      gap: null,
      nearTies: 0,
      ambiguous: false,
      hardConflict: false,
      bulkEligible: false,
      algorithmVersion: ALGORITHM_VERSION,
    };
  }

  const gap = alternatives.length > 0 ? best.score - alternatives[0].score : null;
  const nearTies = alternatives.filter(
    (c) => best.score - c.score <= MATCH_POLICY.bands.nearTieWithin,
  ).length;

  const band = bandFor(best.score, gap, best.hardConflict);
  const ambiguous =
    nearTies > 0
    || (best.score >= MATCH_POLICY.bands.highScore
        && gap !== null
        && gap < MATCH_POLICY.bands.highGap);

  const { bulk } = MATCH_POLICY;
  const bulkEligible =
    !best.hardConflict
    && !ambiguous
    && band === 'very_high'
    && best.score >= bulk.minScore
    && (gap === null || gap >= bulk.minGap)
    && best.corroboratingFamilies >= bulk.minCorroboratingFamilies
    && (!bulk.requireStrongName || best.strongName);

  return {
    best,
    alternatives,
    band,
    gap,
    nearTies,
    ambiguous,
    hardConflict: best.hardConflict,
    bulkEligible,
    algorithmVersion: ALGORITHM_VERSION,
  };
}
