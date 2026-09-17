import { clubTextWeights } from '@/lib/player-matching/calibration';
import { MATCH_POLICY } from '@/lib/player-matching/confidence';
import type { SourceDetail } from '@/lib/player-matching/describe';
import { hasStrongNameEvidence, independentFamilyCount } from '@/lib/player-matching/describe';
import { parseCareerSpan } from '@/lib/player-matching/parse-career-span';
import {
  activeSeasons,
  assertedRange,
  draftYear,
  type EvidenceFamily,
  type EvidenceItem,
  type HardConflict,
  type MatchAssessment,
  type SourceEvidence,
} from '@/lib/player-matching/types';

/**
 * Why a row is where it is (AFLDB-ISSUE-164 §11 items 1-3).
 *
 * The queue could always show WHAT a row scored. It could not show why
 * a row that looks obviously right is nevertheless capped at High, or
 * why a 97-point captaincy will never be approved unattended. A reviewer
 * reading "Low · 44" against a name they recognise has no way to tell
 * an unlucky row from a structurally impossible one, and that is the
 * whole of acceptance criterion §13 item 1.
 *
 * Three rules hold this module honest, and they are the reason it is
 * pure and separate from the scorer:
 *
 *   1. It NEVER rescores. Every number it reports is either read from
 *      the assessment the server already computed, or read from
 *      MATCH_POLICY. It cannot move a band, a score or a bulk flag,
 *      because it returns explanation and nothing else.
 *   2. It quotes the policy rather than restating it. Every threshold
 *      below is read from MATCH_POLICY at call time; a weight change is
 *      reflected here without anyone remembering to update a second
 *      copy, which is exactly how an explanation starts lying.
 *   3. Source-class exclusion is kept distinct from evidence failure.
 *      "captaincies may not be approved unattended" and "this row does
 *      not score highly enough" are different statements and a reviewer
 *      who conflates them will draw the wrong conclusion about both.
 *
 * The runbook names the entry point `explainLimits(assessment, source,
 * sourceType)`. `source` and `sourceType` are taken here as one
 * SourceProfile value, built by the two constructors below, because the
 * admin page holds a cached suggestion plus a source-record detail
 * rather than a live SourceEvidence and both must reach the same answer.
 */

// ---------------------------------------------------------------------
// What a source row can actually offer
// ---------------------------------------------------------------------

/**
 * Club text, in the only three states that matter.
 *
 * 'present_unresolved' is deliberately not folded into 'absent'. Most of
 * a Hall of Fame club list is SANFL, WAFL and Tasmanian clubs AFLDB does
 * not hold; that text contributes no positive evidence AND no negative
 * evidence, and a reviewer is entitled to be told which of the two
 * situations they are looking at rather than left to guess.
 */
export type ClubTextAvailability = 'resolved' | 'present_unresolved' | 'absent';

/**
 * The evidence FIELDS a source row carries, independent of any
 * candidate. This is what bounds the reachable score: a draft row with
 * no active season can never earn club_in_season however good the
 * candidate is.
 */
export type SourceProfile = {
  /** The logical class bulk policy is decided on, e.g. 'draft_person'. */
  sourceType: string;
  /** A real club_id foreign key, not club text. */
  hasClubId: boolean;
  clubText: ClubTextAvailability;
  /** At least one season the source places the player on a field. */
  hasActiveSeason: boolean;
  /** A career span the source states and that parses. */
  hasAssertedRange: boolean;
  hasDraftYear: boolean;
  hasReportedGames: boolean;
  hasReportedGoals: boolean;
};

/** The live path: everything is on the evidence row already. */
export function profileFromSourceEvidence(
  source: SourceEvidence,
  sourceType: string,
): SourceProfile {
  return {
    sourceType,
    hasClubId: source.clubId !== null,
    // Club text is only a CHANNEL for club evidence when there is no
    // club_id. A draft row carries both the key and the printed name;
    // reporting the name as "unresolved text" there would invite a
    // reviewer to read a redundant label as a missing signal.
    clubText:
      source.clubId !== null
        ? 'absent'
        : source.resolvedClubs.length > 0
          ? 'resolved'
          : source.clubNameRaw
            ? 'present_unresolved'
            : 'absent',
    hasActiveSeason: activeSeasons(source.temporal).length > 0,
    hasAssertedRange: assertedRange(source.temporal) !== null,
    hasDraftYear: draftYear(source.temporal) !== null,
    hasReportedGames: source.reportedGames !== null,
    hasReportedGoals: source.reportedGoals !== null,
  };
}

/**
 * The page path: the same profile from the per-row source detail the
 * queue already fetches.
 *
 * `clubTextResolved` is supplied by the caller because resolution needs
 * the club text index, which is a server-side read the page does not
 * repeat per row. The page passes whether any ranked candidate actually
 * scored a club-text signal, which proves resolution when true. When it
 * is false and the source carries club text, the honest answer is
 * 'present_unresolved' -- the text contributes nothing either way, which
 * is precisely what the drawer then says.
 */
export function profileFromSourceDetail(
  detail: SourceDetail | null,
  sourceType: string,
  opts: { clubTextResolved?: boolean } = {},
): SourceProfile {
  const empty: SourceProfile = {
    sourceType,
    hasClubId: false,
    clubText: 'absent',
    hasActiveSeason: false,
    hasAssertedRange: false,
    hasDraftYear: false,
    hasReportedGames: false,
    hasReportedGoals: false,
  };
  if (!detail) return empty;

  const clubText = (raw: string | null): ClubTextAvailability =>
    opts.clubTextResolved ? 'resolved' : raw ? 'present_unresolved' : 'absent';

  switch (detail.kind) {
    case 'award_winner':
      // `club` is COALESCE(clubs.name, club_name_raw), so the club_id
      // itself is reported separately; a row with only raw text has no
      // club evidence at all, which is the §3.2 "ceiling 61 or 44" case.
      return {
        ...empty,
        hasClubId: detail.hasClubId ?? false,
        hasActiveSeason: detail.season !== null,
      };

    case 'award_nomination':
      return {
        ...empty,
        hasClubId: detail.club !== null,
        hasActiveSeason: detail.season !== null,
      };

    case 'captaincy':
      return {
        ...empty,
        hasClubId: detail.club !== null,
        hasActiveSeason: detail.season !== null,
      };

    case 'achievement':
      return {
        ...empty,
        hasClubId: detail.hasClubId ?? false,
        hasActiveSeason: detail.season !== null,
      };

    case 'hall_of_fame':
      return {
        ...empty,
        clubText: clubText(detail.club),
        hasAssertedRange: parseCareerSpan(detail.playingCareer) !== null,
      };

    case 'honour_team':
      return { ...empty, clubText: clubText(detail.club) };

    case 'draft':
      return {
        ...empty,
        hasClubId: detail.club !== null,
        hasDraftYear: detail.draftYear !== null,
        hasReportedGames: detail.reportedGames !== null,
        hasReportedGoals: detail.reportedGoals !== null,
      };

    default:
      return empty;
  }
}

// ---------------------------------------------------------------------
// Reachable ceiling
// ---------------------------------------------------------------------

export type CeilingPart = { family: EvidenceFamily; signal: string; points: number };

export type ProfileCeiling = {
  /** Highest total this source profile could reach against a perfect candidate. */
  score: number;
  parts: CeilingPart[];
  reachesVeryHigh: boolean;
};

/**
 * The best score this source profile could ever reach.
 *
 * One signal per family, exactly as the scorer counts (S1-S4 are one
 * club family, so resolved club text and a club_id never both pay), and
 * the same 0-100 cap. Nothing is invented: a field the source does not
 * carry contributes zero rather than an optimistic guess.
 *
 * It reproduces the §3 arithmetic: a complete draft profile reaches 97,
 * an honour-team row with no resolvable club text 44, an award row with
 * a season but no club_id 61.
 *
 * Explanatory only. Nothing here is consulted by assessMatch or by
 * scoreCandidate, and it must stay that way -- a ceiling that fed back
 * into eligibility would be a second scorer.
 */
export function reachableCeiling(profile: SourceProfile): ProfileCeiling {
  const w = MATCH_POLICY.scoring;
  const clubText = clubTextWeights();
  const parts: CeilingPart[] = [];

  // Every source has a name, and exact is the best a name can do.
  parts.push({ family: 'name', signal: 'name_exact', points: w.name.exact });

  if (profile.hasClubId) {
    parts.push(
      profile.hasActiveSeason
        ? {
            family: 'club',
            signal: 'club_in_season',
            points: Math.max(w.club.clubSeason, w.club.clubAnywhere),
          }
        : { family: 'club', signal: 'club_anywhere', points: w.club.clubAnywhere },
    );
  } else if (profile.clubText === 'resolved') {
    parts.push(
      profile.hasAssertedRange
        ? {
            family: 'club',
            signal: 'club_in_span',
            points: Math.max(clubText.clubTextInSpan, clubText.clubTextAnywhere),
          }
        : { family: 'club', signal: 'club_text_anywhere', points: clubText.clubTextAnywhere },
    );
  }

  if (profile.hasActiveSeason) {
    parts.push({ family: 'era', signal: 'era_season_in_career', points: w.era.seasonInCareer });
  }
  if (profile.hasAssertedRange) {
    parts.push({
      family: 'career_span',
      signal: 'career_span_exact',
      points: w.careerSpan.exact,
    });
  }
  if (profile.hasDraftYear) {
    parts.push({
      family: 'draft_timing',
      signal: 'draft_year_before_debut',
      points: w.draftTiming.points,
    });
  }
  if (profile.hasReportedGames) {
    parts.push({ family: 'draft_games', signal: 'draft_games_exact', points: w.draftGames.exact });
  }
  if (profile.hasReportedGoals) {
    parts.push({ family: 'draft_goals', signal: 'draft_goals_exact', points: w.draftGoals.exact });
  }

  // The same cap the scorer applies, for the same reason.
  const score = Math.min(100, parts.reduce((total, part) => total + part.points, 0));
  return { score, parts, reachesVeryHigh: score >= MATCH_POLICY.bands.veryHighScore };
}

// ---------------------------------------------------------------------
// Typed limit reasons
// ---------------------------------------------------------------------

/**
 * Why this row is not bulk-ready, as data rather than as a sentence.
 *
 * Each variant carries the numbers the UI needs so that no human-readable
 * string ever has to be parsed to recover them. Wording lives in
 * describe.ts beside the evidence and conflict tables.
 */
export type LimitReason =
  /** Page-level: several records for one name propose different players. */
  | { code: 'group_disagrees' }
  | { code: 'hard_conflict'; conflicts: number }
  | { code: 'near_tie'; gap: number | null; nearTies: number; nearTieWithin: number }
  | { code: 'source_class_not_bulk'; sourceType: string }
  | { code: 'name_not_exact' }
  | { code: 'no_independent_corroboration'; families: number; required: number }
  | { code: 'below_bulk_score_floor'; score: number; required: number }
  | { code: 'below_bulk_gap_floor'; gap: number; required: number }
  | {
      code: 'profile_ceiling_below_very_high';
      sourceType: string;
      ceiling: number;
      required: number;
    };

export type LimitReasonCode = LimitReason['code'];

/** One bulk criterion, evaluated. The drawer renders these as ✓/✗. */
export type BulkCheck =
  | { key: 'strong_name'; met: boolean }
  | { key: 'corroboration'; met: boolean; families: number; required: number }
  | { key: 'score_floor'; met: boolean; score: number; required: number }
  | { key: 'gap_floor'; met: boolean; gap: number | null; required: number }
  | { key: 'no_conflict'; met: boolean; conflicts: number }
  | { key: 'source_class'; met: boolean; sourceType: string };

/**
 * The already-computed assessment, in the shape both callers hold.
 *
 * The cached suggestion row satisfies this structurally, so the page
 * passes it straight through; `limitInputFromAssessment` adapts a live
 * MatchAssessment. Neither path recomputes anything.
 */
export type LimitAssessmentInput = {
  band: string;
  score: number;
  gap: number | null;
  nearTies: number;
  ambiguous: boolean;
  hardConflict: boolean;
  bulkEligible: boolean;
  evidence: readonly EvidenceItem[];
  conflicts: readonly HardConflict[];
};

export function limitInputFromAssessment(
  assessment: MatchAssessment,
): LimitAssessmentInput {
  const best = assessment.best;
  return {
    band: assessment.band,
    score: best?.score ?? 0,
    gap: assessment.gap,
    nearTies: assessment.nearTies,
    ambiguous: assessment.ambiguous,
    hardConflict: assessment.hardConflict,
    bulkEligible: assessment.bulkEligible,
    evidence: best?.evidence ?? [],
    conflicts: best?.conflicts ?? [],
  };
}

export type LimitExplanation = {
  /** Every blocking reason, most important first. Empty when bulk-ready. */
  reasons: LimitReason[];
  /** The one reason the row line shows. */
  primary: LimitReason | null;
  /** The six bulk criteria, in a fixed order, evaluated. */
  checks: BulkCheck[];
  ceiling: ProfileCeiling;
  /** The assessment's own answer, plus the page-level group rule. */
  bulkReady: boolean;
};

/**
 * Derive the typed reasons a row is not bulk-ready.
 *
 * Order is chosen so the row line says the most decisive thing first: a
 * contradiction beats an ambiguity, an ambiguity beats a policy
 * exclusion, and the arithmetic floors come last because they are the
 * least actionable. Every reason is still returned for the drawer; only
 * `primary` is picked.
 */
export function explainLimits(
  assessment: LimitAssessmentInput,
  profile: SourceProfile,
  options: { groupDisagrees?: boolean } = {},
): LimitExplanation {
  const { bulk, bands } = MATCH_POLICY;
  const evidence = assessment.evidence;

  const strongName = hasStrongNameEvidence(evidence);
  // Counted exactly as assessMatch counts it -- name included -- so the
  // explanation cannot disagree with the eligibility rule it explains.
  const families = independentFamilyCount(evidence);
  const sourceClassAllowed = bulk.sourceTypes[profile.sourceType] === true;
  const gapClears = assessment.gap === null || assessment.gap >= bulk.minGap;

  const checks: BulkCheck[] = [
    { key: 'strong_name', met: !bulk.requireStrongName || strongName },
    {
      key: 'corroboration',
      met: families >= bulk.minCorroboratingFamilies,
      families,
      required: bulk.minCorroboratingFamilies,
    },
    {
      key: 'score_floor',
      met: assessment.score >= bulk.minScore,
      score: assessment.score,
      required: bulk.minScore,
    },
    {
      key: 'gap_floor',
      met: gapClears,
      gap: assessment.gap,
      required: bulk.minGap,
    },
    {
      key: 'no_conflict',
      met: assessment.conflicts.length === 0 && !assessment.hardConflict,
      conflicts: assessment.conflicts.length,
    },
    { key: 'source_class', met: sourceClassAllowed, sourceType: profile.sourceType },
  ];

  const ceiling = reachableCeiling(profile);
  const groupDisagrees = options.groupDisagrees === true;
  const bulkReady = assessment.bulkEligible && !groupDisagrees;

  const reasons: LimitReason[] = [];
  if (bulkReady) {
    return { reasons, primary: null, checks, ceiling, bulkReady };
  }

  // A group whose records name different players outranks every per-row
  // number: at least one of those suggestions is wrong, and no amount of
  // score settles which.
  if (groupDisagrees) reasons.push({ code: 'group_disagrees' });

  if (assessment.hardConflict || assessment.conflicts.length > 0) {
    reasons.push({ code: 'hard_conflict', conflicts: assessment.conflicts.length });
  }
  if (assessment.ambiguous) {
    reasons.push({
      code: 'near_tie',
      gap: assessment.gap,
      nearTies: assessment.nearTies,
      nearTieWithin: bands.nearTieWithin,
    });
  }
  // Policy exclusion is reported independently of the arithmetic: it is
  // true whatever the row scored, and a reviewer must not read it as a
  // statement about the evidence.
  if (!sourceClassAllowed) {
    reasons.push({ code: 'source_class_not_bulk', sourceType: profile.sourceType });
  }
  if (bulk.requireStrongName && !strongName) {
    reasons.push({ code: 'name_not_exact' });
  }
  if (families < bulk.minCorroboratingFamilies) {
    reasons.push({
      code: 'no_independent_corroboration',
      families,
      required: bulk.minCorroboratingFamilies,
    });
  }
  if (assessment.score < bulk.minScore) {
    reasons.push({
      code: 'below_bulk_score_floor',
      score: assessment.score,
      required: bulk.minScore,
    });
  }
  if (!gapClears && assessment.gap !== null) {
    reasons.push({ code: 'below_bulk_gap_floor', gap: assessment.gap, required: bulk.minGap });
  }
  // Last, because it is a property of the record type rather than of
  // this row, and saying it first would bury the row's own problem.
  if (!ceiling.reachesVeryHigh) {
    reasons.push({
      code: 'profile_ceiling_below_very_high',
      sourceType: profile.sourceType,
      ceiling: ceiling.score,
      required: bands.veryHighScore,
    });
  }

  return { reasons, primary: reasons[0] ?? null, checks, ceiling, bulkReady };
}
