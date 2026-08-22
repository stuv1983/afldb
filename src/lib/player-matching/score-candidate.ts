import { MATCH_POLICY } from '@/lib/player-matching/confidence';
import {
  activeSeasons,
  afldbActiveSeasons,
  assertedRange,
  draftYear,
  type CandidateEvidence,
  type EvidenceItem,
  type HardConflict,
  type ScoredCandidate,
  type SourceEvidence,
} from '@/lib/player-matching/types';

/**
 * Score one candidate against one source row. Pure and deterministic.
 *
 * Two rules shape everything here.
 *
 * First, at most one signal per evidence family. An exact name is also
 * a perfect trigram match and also a surname match; paying for all
 * three would let a single fact earn three times and lift a namesake
 * into a band that real corroboration should have been needed to reach.
 *
 * Second, contradictions never net off against positives. They are
 * collected separately, and a candidate carrying one is capped and
 * barred from bulk approval no matter how much else agreed. AFLDB would
 * rather leave a player unmatched than link the wrong identity.
 */

type Range = { first: number; last: number };

/** The candidate career range, when AFLDB actually knows both ends. */
function careerRange(candidate: CandidateEvidence): Range | null {
  const { debutSeason, finalSeason } = candidate;
  if (debutSeason === null || finalSeason === null) return null;
  return { first: debutSeason, last: finalSeason };
}

/**
 * Whether the career range is complete enough to contradict a source.
 * A player with no recorded games has a range derived from nothing, and
 * absence of data must never masquerade as disagreement.
 */
function careerIsComplete(candidate: CandidateEvidence): boolean {
  return careerRange(candidate) !== null
    && candidate.careerGames !== null
    && candidate.careerGames > 0;
}

/** How far a season falls outside a range; 0 when inside. */
function distanceOutside(season: number, range: Range): number {
  if (season < range.first) return range.first - season;
  if (season > range.last) return season - range.last;
  return 0;
}

/** Both strings arrive already normalised by afldb_normalise_name. */
function tokens(normalised: string): string[] {
  return normalised.split(' ').filter(Boolean);
}

function initialCompatible(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length === 1) return b.startsWith(a);
  if (b.length === 1) return a.startsWith(b);
  return false;
}

// ---------------------------------------------------------------------
// One signal per family
// ---------------------------------------------------------------------

/**
 * Name. Ordered strongest first, and the first match wins.
 *
 * Note that both sides were normalised by the same SQL function, so
 * comparing them here forks nothing: the trigram number is the only
 * value TypeScript could not have produced, and it comes from
 * PostgreSQL for exactly that reason.
 */
function nameSignal(source: SourceEvidence, candidate: CandidateEvidence): EvidenceItem | null {
  const w = MATCH_POLICY.scoring.name;
  const sourceName = source.normalisedName;
  if (!sourceName) return null;

  if (candidate.searchName === sourceName) {
    return { family: 'name', signal: 'name_exact', detail: candidate.displayName, points: w.exact };
  }
  if (candidate.aliasSearchNames.includes(sourceName)) {
    return {
      family: 'name',
      signal: 'name_alias_exact',
      detail: `alias of ${candidate.displayName}`,
      points: w.aliasExact,
    };
  }
  if (candidate.nameSimilarity >= w.trigramHighFloor) {
    return {
      family: 'name',
      signal: 'name_trigram_high',
      detail: `${candidate.displayName} (similarity ${candidate.nameSimilarity.toFixed(2)})`,
      points: w.trigramHigh,
    };
  }

  const sourceTokens = tokens(sourceName);
  const candidateTokens = tokens(candidate.searchName);
  if (sourceTokens.length > 1 && candidateTokens.length > 1) {
    const sameSurname = sourceTokens[sourceTokens.length - 1] === candidateTokens[candidateTokens.length - 1];
    if (sameSurname && initialCompatible(sourceTokens[0], candidateTokens[0])) {
      return {
        family: 'name',
        signal: 'name_surname_initial',
        detail: `${candidate.displayName} (surname and first initial)`,
        points: w.surnameInitial,
      };
    }
  }

  if (candidate.nameSimilarity >= w.trigramMediumFloor) {
    return {
      family: 'name',
      signal: 'name_trigram_medium',
      detail: `${candidate.displayName} (similarity ${candidate.nameSimilarity.toFixed(2)})`,
      points: w.trigramMedium,
    };
  }
  return null;
}

/**
 * Club. Playing for the club IN the source season is a different order
 * of evidence from having played there at some point across a long
 * career, so the two never both score.
 */
function clubSignal(source: SourceEvidence, candidate: CandidateEvidence): EvidenceItem | null {
  if (source.clubId === null) return null;
  const w = MATCH_POLICY.scoring.club;
  const clubRows = candidate.clubs.filter((c) => c.clubId === source.clubId);
  if (clubRows.length === 0) return null;

  const seasons = activeSeasons(source.temporal);
  const corroborated = seasons.find((season) =>
    clubRows.some(
      (c) =>
        c.firstSeason !== null
        && c.lastSeason !== null
        && season >= c.firstSeason
        && season <= c.lastSeason,
    ),
  );
  if (corroborated !== undefined) {
    return {
      family: 'club',
      signal: 'club_in_season',
      detail: `${source.clubNameRaw ?? `club ${source.clubId}`} in ${corroborated}`,
      points: w.clubSeason,
    };
  }
  return {
    family: 'club',
    signal: 'club_anywhere',
    detail: `played for ${source.clubNameRaw ?? `club ${source.clubId}`} at some point`,
    points: w.clubAnywhere,
  };
}

/**
 * Playing era, from active seasons only.
 *
 * A Hall of Fame induction year and a draft year are both years, and
 * neither says the player took the field that season. Only
 * 'active_season' evidence reaches this function, which is why the
 * distinction is made when the evidence is extracted rather than here.
 */
function eraSignal(source: SourceEvidence, candidate: CandidateEvidence): EvidenceItem | null {
  const seasons = activeSeasons(source.temporal);
  const range = careerRange(candidate);
  if (seasons.length === 0 || !range) return null;

  const w = MATCH_POLICY.scoring.era;
  const worst = Math.max(...seasons.map((s) => distanceOutside(s, range)));
  const span = `${range.first}-${range.last}`;
  if (worst === 0) {
    return {
      family: 'era',
      signal: 'era_season_in_career',
      detail: `${seasons.join(', ')} within ${span}`,
      points: w.seasonInCareer,
    };
  }
  if (worst <= w.nearToleranceSeasons) {
    return {
      family: 'era',
      signal: 'era_season_near_career',
      detail: `${seasons.join(', ')} within ${worst} season of ${span}`,
      points: w.seasonNearCareer,
    };
  }
  return null;
}

/** A source-asserted career span against the AFLDB one (Hall of Fame). */
function careerSpanSignal(
  source: SourceEvidence,
  candidate: CandidateEvidence,
): EvidenceItem | null {
  const asserted = assertedRange(source.temporal);
  const range = careerRange(candidate);
  if (!asserted || !range) return null;

  const w = MATCH_POLICY.scoring.careerSpan;
  if (asserted.first === range.first && asserted.last === range.last) {
    return {
      family: 'career_span',
      signal: 'career_span_exact',
      detail: `source span ${asserted.first}-${asserted.last} matches exactly`,
      points: w.exact,
    };
  }
  if (asserted.first <= range.last && range.first <= asserted.last) {
    return {
      family: 'career_span',
      signal: 'career_span_overlap',
      detail: `source span ${asserted.first}-${asserted.last} overlaps ${range.first}-${range.last}`,
      points: w.overlap,
    };
  }
  return null;
}

/** A draft year should sit just before the player's first AFLDB season. */
function draftTimingSignal(
  source: SourceEvidence,
  candidate: CandidateEvidence,
): EvidenceItem | null {
  const year = draftYear(source.temporal);
  if (year === null || candidate.debutSeason === null) return null;

  const w = MATCH_POLICY.scoring.draftTiming;
  const delta = candidate.debutSeason - year;
  if (delta < 0 || delta > w.debutWithinYears) return null;
  return {
    family: 'draft_timing',
    signal: 'draft_year_before_debut',
    detail: `drafted ${year}, debut ${candidate.debutSeason}`,
    points: w.points,
  };
}

function countSignal(
  family: 'draft_games' | 'draft_goals',
  label: string,
  reported: number | null,
  actual: number | null,
  weights: { exact: number; near: number; nearTolerance: number },
): EvidenceItem | null {
  if (reported === null || actual === null) return null;
  const diff = Math.abs(reported - actual);
  if (diff === 0) {
    return {
      family,
      signal: `${family}_exact`,
      detail: `${label} ${reported} matches`,
      points: weights.exact,
    };
  }
  if (diff <= weights.nearTolerance) {
    return {
      family,
      signal: `${family}_near`,
      detail: `${label} ${reported} against ${actual}`,
      points: weights.near,
    };
  }
  return null;
}

// ---------------------------------------------------------------------
// Contradictions
// ---------------------------------------------------------------------

/**
 * Only reliable disagreement counts.
 *
 * Every check below first establishes that AFLDB actually knows the
 * fact it is about to contradict. An unknown career range or a partial
 * club history produces no conflict, because "AFLDB has not recorded
 * it" and "it did not happen" are different statements and only the
 * second is evidence.
 */
function findConflicts(source: SourceEvidence, candidate: CandidateEvidence): HardConflict[] {
  const conflicts: HardConflict[] = [];
  const { conflicts: policy } = MATCH_POLICY;

  // Only AFLDB's own seasons may contradict an AFLDB career range.
  const seasons = afldbActiveSeasons(source.temporal);
  const range = careerRange(candidate);
  if (range && seasons.length > 0 && careerIsComplete(candidate)) {
    const worst = Math.max(...seasons.map((s) => distanceOutside(s, range)));
    if (worst > policy.eraToleranceSeasons) {
      conflicts.push({
        reason: 'season_outside_career',
        detail:
          `source season ${seasons.join(', ')} is ${worst} seasons outside `
          + `${candidate.displayName}'s career ${range.first}-${range.last}`,
      });
    }
  }

  // A club only contradicts when the source says the player was AT that
  // club IN an AFLDB season. Without that, absence proves nothing: a
  // draft pick names the club that drafted the player, who may never
  // have played a senior game for it -- the cause of 249 of the 252
  // club contradictions this rule originally raised against links that
  // were already known to be correct.
  if (
    source.clubId !== null
    && seasons.length > 0
    && candidate.clubHistoryComplete
    && candidate.clubs.length > 0
    && !candidate.clubs.some((c) => c.clubId === source.clubId)
  ) {
    conflicts.push({
      reason: 'club_not_in_history',
      detail:
        `${candidate.displayName} has a complete club history and never played for `
        + `${source.clubNameRaw ?? `club ${source.clubId}`}`,
    });
  }

  if (candidate.uniquenessConflict !== null) {
    conflicts.push({
      reason: 'uniqueness_collision',
      detail: candidate.uniquenessConflict,
    });
  }

  // Reported games and goals are NOT contradiction evidence. The draft
  // source counts its own way -- other competitions, other cut-offs --
  // and migration 019 says outright that the column is never a career
  // statistic. Treating divergence as a conflict raised 202 objections
  // of which 200 were against the correct player, so agreement is
  // rewarded above and disagreement is simply not evidence.

  return conflicts;
}

/**
 * Families that corroborate each other independently.
 *
 * Reported games and reported goals come from the same external record
 * and travel together, so they count once. Requiring two INDEPENDENT
 * families is what stops a name plus its own source's arithmetic from
 * looking like two separate pieces of agreement.
 */
function independentFamilyCount(evidence: readonly EvidenceItem[]): number {
  const groups = new Set<string>();
  for (const item of evidence) {
    groups.add(
      item.family === 'draft_games' || item.family === 'draft_goals'
        ? 'draft_stats'
        : item.family,
    );
  }
  return groups.size;
}

export function scoreCandidate(
  source: SourceEvidence,
  candidate: CandidateEvidence,
): ScoredCandidate {
  const w = MATCH_POLICY.scoring;
  const name = nameSignal(source, candidate);

  const evidence = [
    name,
    clubSignal(source, candidate),
    eraSignal(source, candidate),
    careerSpanSignal(source, candidate),
    draftTimingSignal(source, candidate),
    countSignal('draft_games', 'games', source.reportedGames, candidate.careerGames, w.draftGames),
    countSignal('draft_goals', 'goals', source.reportedGoals, candidate.careerGoals, w.draftGoals),
  ].filter((item): item is EvidenceItem => item !== null);

  const conflicts = findConflicts(source, candidate);
  const score = evidence.reduce((total, item) => total + item.points, 0);

  return {
    playerId: candidate.playerId,
    displayName: candidate.displayName,
    // The band thresholds are expressed on a 0-100 scale, so a rich
    // source that agrees on everything is capped rather than allowed to
    // run past the top of the scale.
    score: Math.min(100, score),
    evidence,
    conflicts,
    hardConflict: conflicts.length > 0,
    corroboratingFamilies: independentFamilyCount(evidence),
    strongName: name !== null
      && (name.signal === 'name_exact' || name.signal === 'name_alias_exact'),
  };
}
