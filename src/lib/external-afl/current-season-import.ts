import postgres from 'postgres';

import sourceFamiliesRaw from '../../../data/reference/source-families.json';
import {
  decideObservation,
  type JsonValue,
  type ObservationHead,
} from '../acquisition/observations';
import {
  getSourceFamily,
  parseSourceFamilyRegistry,
} from '../acquisition/source-families';
import {
  fetchKaliCurrentMatches,
  fetchSquiggleCurrentMatches,
  type ExternalCurrentMatch,
  type ExternalSource,
} from './current-matches';

export type CurrentSeasonSourceArg = ExternalSource | 'all';

export type CurrentSeasonRunOptions = {
  year: number;
  sources: ExternalSource[];
  apply: boolean;
  insertMissingMatches: boolean;
  updateMatches: boolean;
};

export type CurrentSeasonRunResult = {
  observationsFetched: number;
  sourceCounts: Record<ExternalSource, number>;
  independenceGroupCounts: Record<string, number>;
  completeObservations: number;
  observationsWithScores: number;
  observationsStaged: number;
  observationVersionsInserted: number;
  observationsMarkedAbsent: number;
  canonicalMatchesResolved: number;
  canonicalRowsInserted: number;
  canonicalRowsUpdated: number;
  unresolvedObservations: number;
  incompleteSourceRecords: number;
  rejectedOrConflicted: number;
  sourceDisagreements: number;
  sameGroupConflicts: number;
  applied: boolean;
};

export type CurrentSeasonScoreValues = {
  homeScore: number;
  awayScore: number;
  homeGoals: number | null;
  homeBehinds: number | null;
  awayGoals: number | null;
  awayBehinds: number | null;
};

export type CurrentSeasonEvidenceObservation = {
  sourceKey: string;
  family: string;
  externalGameId: string;
  values: CurrentSeasonScoreValues;
};

export type CurrentSeasonCorroboration = {
  observations: readonly CurrentSeasonEvidenceObservation[];
  independenceGroups: readonly string[];
  independenceGroupCounts: Readonly<Record<string, number>>;
  sourceCounts: Readonly<Record<string, number>>;
  independentWitnessCount: number;
  independentlyCorroborated: boolean;
  disagreeingGroups: readonly string[];
  sameGroupConflictGroups: readonly string[];
  values: CurrentSeasonScoreValues | null;
};

export type CurrentSeasonReportRow = {
  source: string;
  staged: number;
  resolved: number;
  complete: number;
  withScores: number;
  unresolvedTeams: number;
};

export type CurrentSeasonUnresolvedSample = {
  source: string;
  externalGameId: string;
  matchDate: string | null;
  round: number | null;
  home: string | null;
  away: string | null;
  homeClubId: number | null;
  awayClubId: number | null;
};

export type CurrentSeasonReport = {
  year: number;
  rows: CurrentSeasonReportRow[];
  incompleteSamples: CurrentSeasonUnresolvedSample[];
  unresolvedMatchSamples: CurrentSeasonUnresolvedSample[];
  unresolvedTeamSamples: CurrentSeasonUnresolvedSample[];
};

type Db = postgres.Sql | postgres.TransactionSql;

const EXTERNAL_CLUB_NAME_ALIASES = new Map<string, string>([
  ['brisbane', 'Brisbane Lions'],
]);

const SOURCE_FAMILY_REGISTRY = parseSourceFamilyRegistry(sourceFamiliesRaw);

function scoreValuesCompatible(a: CurrentSeasonScoreValues, b: CurrentSeasonScoreValues): boolean {
  if (a.homeScore !== b.homeScore || a.awayScore !== b.awayScore) return false;
  const components = [
    [a.homeGoals, b.homeGoals],
    [a.homeBehinds, b.homeBehinds],
    [a.awayGoals, b.awayGoals],
    [a.awayBehinds, b.awayBehinds],
  ];
  return components.every(([left, right]) => left === null || right === null || left === right);
}

function mergeScoreValues(
  a: CurrentSeasonScoreValues,
  b: CurrentSeasonScoreValues,
): CurrentSeasonScoreValues {
  if (!scoreValuesCompatible(a, b)) {
    throw new Error('Cannot merge conflicting current-season score observations.');
  }
  return {
    homeScore: a.homeScore,
    awayScore: a.awayScore,
    homeGoals: a.homeGoals ?? b.homeGoals,
    homeBehinds: a.homeBehinds ?? b.homeBehinds,
    awayGoals: a.awayGoals ?? b.awayGoals,
    awayBehinds: a.awayBehinds ?? b.awayBehinds,
  };
}

/**
 * Compare concrete observations at ISSUE-096's independence-group grain.
 * Concrete source attribution is retained in `observations` and `sourceCounts`;
 * only witness counting and disagreement classification are collapsed.
 */
export function analyseCurrentSeasonCorroboration(
  observations: readonly CurrentSeasonEvidenceObservation[],
): CurrentSeasonCorroboration {
  const withGroups = observations.map((observation) => ({
    observation,
    group: getSourceFamily(
      SOURCE_FAMILY_REGISTRY,
      observation.sourceKey,
      observation.family,
    ).independence.group,
  }));
  const independenceGroupCounts: Record<string, number> = {};
  const sourceCounts: Record<string, number> = {};
  const observationsByGroup = new Map<string, CurrentSeasonEvidenceObservation[]>();
  for (const { observation, group } of withGroups) {
    independenceGroupCounts[group] = (independenceGroupCounts[group] ?? 0) + 1;
    sourceCounts[observation.sourceKey] = (sourceCounts[observation.sourceKey] ?? 0) + 1;
    const groupObservations = observationsByGroup.get(group);
    if (groupObservations) groupObservations.push(observation);
    else observationsByGroup.set(group, [observation]);
  }

  // Collapse concrete aliases/proxies first. A group that contradicts
  // itself has no coherent witness value to offer another group.
  const sameGroupConflictGroups = new Set<string>();
  const coherentGroups: { group: string; values: CurrentSeasonScoreValues }[] = [];
  for (const [group, groupObservations] of observationsByGroup) {
    let groupValues: CurrentSeasonScoreValues | null = groupObservations[0].values;
    for (const observation of groupObservations.slice(1)) {
      if (!scoreValuesCompatible(groupValues, observation.values)) {
        sameGroupConflictGroups.add(group);
        groupValues = null;
        break;
      }
      groupValues = mergeScoreValues(groupValues, observation.values);
    }
    if (groupValues !== null) coherentGroups.push({ group, values: groupValues });
  }

  // Only coherent independence-group values may establish corroboration or
  // genuine cross-group disagreement.
  const disagreeingGroups = new Set<string>();
  for (let left = 0; left < coherentGroups.length; left += 1) {
    for (let right = left + 1; right < coherentGroups.length; right += 1) {
      const a = coherentGroups[left];
      const b = coherentGroups[right];
      if (scoreValuesCompatible(a.values, b.values)) continue;
      disagreeingGroups.add(a.group);
      disagreeingGroups.add(b.group);
    }
  }

  const independenceGroups = Object.keys(independenceGroupCounts).sort();
  const hasAnyConflict = disagreeingGroups.size > 0 || sameGroupConflictGroups.size > 0;
  let values: CurrentSeasonScoreValues | null = null;
  if (!hasAnyConflict && coherentGroups.length > 0) {
    values = coherentGroups[0].values;
    for (const coherentGroup of coherentGroups.slice(1)) {
      values = mergeScoreValues(values, coherentGroup.values);
    }
  }

  return {
    observations: [...observations],
    independenceGroups,
    independenceGroupCounts,
    sourceCounts,
    independentWitnessCount: independenceGroups.length,
    independentlyCorroborated: coherentGroups.length >= 2 && !hasAnyConflict,
    disagreeingGroups: [...disagreeingGroups].sort(),
    sameGroupConflictGroups: [...sameGroupConflictGroups].sort(),
    values,
  };
}

export function parseCurrentSeasonSources(value: string): ExternalSource[] {
  const sourceArg = value.trim() || 'kali';
  const sources = sourceArg === 'all'
    ? ['squiggle', 'kali'] as ExternalSource[]
    : sourceArg.split(',').map((s) => s.trim()).filter(Boolean) as ExternalSource[];
  for (const source of sources) {
    if (source !== 'squiggle' && source !== 'kali') {
      throw new Error(`Unknown source "${source}". Use squiggle, kali, or all.`);
    }
  }
  return [...new Set(sources)];
}

export function validateCurrentSeasonYear(value: number): number {
  if (!Number.isInteger(value) || value < 2000 || value > 2100) {
    throw new Error('Year must be a whole season year from 2000 to 2100.');
  }
  return value;
}

export async function fetchCurrentSeasonMatches(
  source: ExternalSource,
  year: number,
): Promise<ExternalCurrentMatch[]> {
  if (source === 'squiggle') return fetchSquiggleCurrentMatches(year);
  return fetchKaliCurrentMatches(year);
}

export async function runCurrentSeasonRefresh(options: CurrentSeasonRunOptions): Promise<CurrentSeasonRunResult> {
  validateCurrentSeasonYear(options.year);
  const bySource: ExternalCurrentMatch[][] = [];
  for (const source of options.sources) bySource.push(await fetchCurrentSeasonMatches(source, options.year));
  const matches = bySource.flat();
  const sourceCounts = {
    squiggle: matches.filter((m) => m.source === 'squiggle').length,
    kali: matches.filter((m) => m.source === 'kali').length,
  };
  const independenceGroupCounts = countMatchIndependenceGroups(matches);
  const observationsFetched = matches.length;
  const completeObservations = matches.filter((m) => m.completePercent === 100).length;
  const observationsWithScores = matches.filter((m) => m.homeScore !== null && m.awayScore !== null).length;

  if (!options.apply || matches.length === 0) {
    if (matches.length === 0) {
      return {
        observationsFetched,
        sourceCounts,
        independenceGroupCounts,
        completeObservations,
        observationsWithScores,
        observationsStaged: 0,
        observationVersionsInserted: 0,
        observationsMarkedAbsent: 0,
        canonicalMatchesResolved: 0,
        canonicalRowsInserted: 0,
        canonicalRowsUpdated: 0,
        unresolvedObservations: 0,
        incompleteSourceRecords: 0,
        rejectedOrConflicted: 0,
        sourceDisagreements: 0,
        sameGroupConflicts: 0,
        applied: false,
      };
    }

    const sql = createImportClient();
    try {
      const resolvedObservations = await resolveCurrentSeasonObservations(sql, matches);
      const plan = planCurrentSeasonCanonicalWork(resolvedObservations, options.insertMissingMatches);
      return {
        observationsFetched,
        sourceCounts,
        independenceGroupCounts,
        completeObservations,
        observationsWithScores,
        observationsStaged: 0,
        observationVersionsInserted: 0,
        observationsMarkedAbsent: 0,
        canonicalMatchesResolved: plan.canonicalMatchesResolved,
        canonicalRowsInserted: plan.canonicalRowsInserted,
        canonicalRowsUpdated: 0,
        unresolvedObservations: plan.unresolvedObservations,
        incompleteSourceRecords: plan.incompleteSourceRecords,
        rejectedOrConflicted: plan.rejectedOrConflicted,
        sourceDisagreements: plan.sourceDisagreements,
        sameGroupConflicts: plan.sameGroupConflicts,
        applied: false,
      };
    } finally {
      await sql.end({ timeout: 5 });
    }
  }

  const sql = createImportClient();
  try {
    const result = await writeMatches(
      sql,
      matches,
      options.updateMatches,
      options.insertMissingMatches,
    );
    return {
      observationsFetched,
      sourceCounts,
      independenceGroupCounts,
      completeObservations,
      observationsWithScores,
      observationsStaged: result.observationsStaged,
      observationVersionsInserted: result.observationVersionsInserted,
      observationsMarkedAbsent: result.observationsMarkedAbsent,
      canonicalMatchesResolved: result.canonicalMatchesResolved,
      canonicalRowsInserted: result.canonicalRowsInserted,
      canonicalRowsUpdated: result.canonicalRowsUpdated,
      unresolvedObservations: result.unresolvedObservations,
      incompleteSourceRecords: result.incompleteSourceRecords,
      rejectedOrConflicted: result.rejectedOrConflicted,
      sourceDisagreements: result.sourceDisagreements,
      sameGroupConflicts: result.sameGroupConflicts,
      applied: true,
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function getCurrentSeasonReport(year: number): Promise<CurrentSeasonReport> {
  validateCurrentSeasonYear(year);
  const sql = createImportClient();
  try {
    return await reportStaging(sql, year);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function createImportClient(): postgres.Sql {
  const dsn = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (!dsn) throw new Error('AFLDB_IMPORT_DATABASE_URL is not set.');
  return postgres(dsn, { max: 1, onnotice: () => {}, transform: { undefined: null } });
}

function sourceKey(source: ExternalSource): string {
  return source === 'squiggle' ? 'squiggle_api' : 'kali_afl_stats';
}

function countMatchIndependenceGroups(matches: readonly ExternalCurrentMatch[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const match of matches) {
    const group = getSourceFamily(
      SOURCE_FAMILY_REGISTRY,
      sourceKey(match.source),
      'match',
    ).independence.group;
    counts[group] = (counts[group] ?? 0) + 1;
  }
  return counts;
}

function roundCodes(match: ExternalCurrentMatch): string[] {
  if (match.roundNumber !== null) return [String(match.roundNumber)];
  const label = match.roundLabel?.trim().toUpperCase();
  if (!label) return [];
  if (['EF', 'QF', 'SF', 'PF', 'GF'].includes(label)) return [label];
  return [];
}

function localRoundCodes(match: ExternalCurrentMatch): string[] {
  const codes = roundCodes(match);
  if (match.roundNumber !== null && match.season >= 2024) {
    codes.push(String(match.roundNumber + 1));
  }
  return [...new Set(codes)];
}

function primaryLocalRoundCode(match: ExternalCurrentMatch): string | null {
  return localRoundCodes(match)[0] ?? null;
}

export type ResolvedCurrentSeasonObservation = {
  match: ExternalCurrentMatch;
  homeClubId: number | null;
  awayClubId: number | null;
  localMatchId: number | null;
};

export type CanonicalInsertAssessment = {
  status: 'incomplete_source_family' | 'source_disagreement' | 'same_group_conflict';
  observationCount: number;
  independenceGroups: string[];
  disagreeingGroups: string[];
  sameGroupConflictGroups: string[];
  independentlyCorroborated: boolean;
  venueRaw: string | null;
};

export type CurrentSeasonCanonicalPlan = {
  canonicalMatchesResolved: number;
  canonicalRowsInserted: 0;
  unresolvedObservations: number;
  incompleteSourceRecords: number;
  rejectedOrConflicted: number;
  sourceDisagreements: number;
  sameGroupConflicts: number;
  insertAssessments: CanonicalInsertAssessment[];
};

function isCompleteMissingMatchCandidate(
  observation: ResolvedCurrentSeasonObservation,
): observation is ResolvedCurrentSeasonObservation & { homeClubId: number; awayClubId: number } {
  const { match, homeClubId, awayClubId } = observation;
  return observation.localMatchId === null
    && match.completePercent === 100
    && match.matchDate !== null
    && primaryLocalRoundCode(match) !== null
    && homeClubId !== null
    && awayClubId !== null
    && match.homeScore !== null
    && match.awayScore !== null;
}

function missingMatchIdentity(
  observation: ResolvedCurrentSeasonObservation & { homeClubId: number; awayClubId: number },
): string {
  const { match, homeClubId, awayClubId } = observation;
  return [
    match.season,
    primaryLocalRoundCode(match),
    match.matchDate,
    homeClubId,
    awayClubId,
  ].join('|');
}

/**
 * Classify canonical work independently from staging operations while using
 * ISSUE-097's independence-group collapse as the sole evidence comparator.
 *
 * The current API sources own observations and score corroboration only.
 * Their registered match-family promotion policy is `never`, and neither
 * source supplies the complete canonical family (attendance, period scores,
 * and played participation/statistics). A completed observation can therefore
 * identify missing canonical work, but cannot create a partial `matches` row.
 */
export function planCurrentSeasonCanonicalWork(
  observations: readonly ResolvedCurrentSeasonObservation[],
  insertMissingMatches: boolean,
): CurrentSeasonCanonicalPlan {
  const resolvedIds = new Set<number>();
  const candidateSets = new Map<string, MatchCandidate[]>();
  const missingCandidateKeys = new Set<string>();
  let unresolvedObservations = 0;
  let incompleteSourceRecords = 0;

  for (const observation of observations) {
    if (observation.localMatchId !== null) {
      resolvedIds.add(observation.localMatchId);
      if (isCompleteScoredMatch(observation.match)
          && observation.homeClubId !== null && observation.awayClubId !== null) {
        appendCandidate(candidateSets, `resolved:${observation.localMatchId}`, {
          match: observation.match,
          homeClubId: observation.homeClubId,
          awayClubId: observation.awayClubId,
        });
      }
      continue;
    }
    if (!isCompleteMissingMatchCandidate(observation)) {
      incompleteSourceRecords += 1;
      continue;
    }
    unresolvedObservations += 1;
    const key = `missing:${missingMatchIdentity(observation)}`;
    missingCandidateKeys.add(key);
    appendCandidate(candidateSets, key, {
      match: observation.match,
      homeClubId: observation.homeClubId,
      awayClubId: observation.awayClubId,
    });
  }

  const insertAssessments: CanonicalInsertAssessment[] = [];
  let sourceDisagreements = 0;
  let sameGroupConflicts = 0;
  let rejectedOrConflicted = 0;
  for (const [key, candidates] of candidateSets) {
    const { corroboration, representative } = analyseCandidates(candidates, candidates[0].homeClubId);
    const hasIndependentDisagreement = corroboration.disagreeingGroups.length > 0;
    const hasSameGroupConflict = corroboration.sameGroupConflictGroups.length > 0;
    if (hasIndependentDisagreement) sourceDisagreements += 1;
    if (hasSameGroupConflict) sameGroupConflicts += 1;
    if (hasIndependentDisagreement || hasSameGroupConflict) rejectedOrConflicted += 1;

    if (insertMissingMatches && missingCandidateKeys.has(key)) {
      if (!hasIndependentDisagreement && !hasSameGroupConflict) rejectedOrConflicted += 1;
      insertAssessments.push({
        status: hasSameGroupConflict
          ? 'same_group_conflict'
          : hasIndependentDisagreement ? 'source_disagreement' : 'incomplete_source_family',
        observationCount: candidates.length,
        independenceGroups: [...corroboration.independenceGroups],
        disagreeingGroups: [...corroboration.disagreeingGroups],
        sameGroupConflictGroups: [...corroboration.sameGroupConflictGroups],
        independentlyCorroborated: corroboration.independentlyCorroborated,
        venueRaw: representative.match.venueRaw,
      });
    }
  }

  return {
    canonicalMatchesResolved: resolvedIds.size,
    canonicalRowsInserted: 0,
    unresolvedObservations,
    incompleteSourceRecords,
    rejectedOrConflicted,
    sourceDisagreements,
    sameGroupConflicts,
    insertAssessments,
  };
}
function clubAliasKey(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function localClubNameCandidate(raw: string): string {
  const key = clubAliasKey(raw);
  if (key === 'not recorded' || key === 'tbd') return '';
  return EXTERNAL_CLUB_NAME_ALIASES.get(key) ?? raw;
}

async function resolveClub(sql: Db, raw: string | null, season: number): Promise<number | null> {
  if (!raw) return null;
  const candidateRaw = localClubNameCandidate(raw);
  const [row] = await sql<{ id: number }[]>`
    WITH candidate AS (
      SELECT c.id, c.organization_id
        FROM clubs c
       WHERE afldb_normalise_name(c.name) = afldb_normalise_name(${candidateRaw})
          OR afldb_normalise_name(c.slug) = afldb_normalise_name(${candidateRaw})
      UNION
      SELECT c.id, c.organization_id
        FROM club_aliases a JOIN clubs c ON c.id = a.club_id
       WHERE afldb_normalise_name(a.alias) = afldb_normalise_name(${candidateRaw})
    )
    SELECT c.id
      FROM candidate cand
      JOIN clubs c ON c.organization_id = cand.organization_id
     WHERE c.first_season <= ${season}
       AND (c.last_season IS NULL OR c.last_season >= ${season})
     ORDER BY c.first_season DESC NULLS LAST
     LIMIT 1
  `;
  return row?.id ?? null;
}

async function resolveLocalMatch(
  sql: Db,
  match: ExternalCurrentMatch,
  homeClubId: number | null,
  awayClubId: number | null,
): Promise<number | null> {
  if (homeClubId === null || awayClubId === null) return null;
  const codes = localRoundCodes(match);
  const rows = await sql<{ id: number }[]>`
    SELECT id FROM matches
     WHERE season = ${match.season}
       AND (${match.matchDate}::date IS NULL OR match_date = ${match.matchDate}::date)
       AND (${codes.length === 0}::boolean OR round_code = ANY(${codes}))
       AND ((home_club_id = ${homeClubId} AND away_club_id = ${awayClubId})
         OR (home_club_id = ${awayClubId} AND away_club_id = ${homeClubId}))
  `;
  return rows.length === 1 ? rows[0].id : null;
}

async function resolveCurrentSeasonObservations(
  sql: Db,
  matches: readonly ExternalCurrentMatch[],
): Promise<ResolvedCurrentSeasonObservation[]> {
  const observations: ResolvedCurrentSeasonObservation[] = [];
  for (const match of matches) {
    const homeClubId = await resolveClub(sql, match.homeTeamRaw, match.season);
    const awayClubId = await resolveClub(sql, match.awayTeamRaw, match.season);
    const localMatchId = await resolveLocalMatch(sql, match, homeClubId, awayClubId);
    observations.push({ match, homeClubId, awayClubId, localMatchId });
  }
  return observations;
}

async function refreshSeasonMetadata(sql: Db, season: number): Promise<void> {
  await sql`
    UPDATE seasons s
       SET status = CASE
             WHEN NOT EXISTS (
               SELECT 1 FROM matches m
                WHERE m.season = s.year
                  AND m.round_type = 'grand_final'
                  AND m.result <> 'draw')
             THEN 'in_progress'::season_status
             ELSE 'complete'::season_status
           END,
           data_through_date = (SELECT max(match_date) FROM matches WHERE season = s.year),
           last_loaded_round = (
             SELECT m.round_code FROM matches m
              WHERE m.season = s.year
              ORDER BY m.match_date DESC, m.id DESC LIMIT 1),
           completed_at = CASE
             WHEN EXISTS (
               SELECT 1 FROM matches m
                WHERE m.season = s.year
                  AND m.round_type = 'grand_final'
                  AND m.result <> 'draw')
             THEN (SELECT max(match_date) FROM matches WHERE season = s.year)
             ELSE NULL
           END
     WHERE s.year = ${season}
  `;
}

type MatchCandidate = {
  match: ExternalCurrentMatch;
  homeClubId: number;
  awayClubId: number;
};

function isCompleteScoredMatch(match: ExternalCurrentMatch): boolean {
  return match.completePercent === 100
    && match.matchDate !== null
    && match.homeScore !== null
    && match.awayScore !== null;
}

function appendCandidate<K>(map: Map<K, MatchCandidate[]>, key: K, candidate: MatchCandidate): void {
  const candidates = map.get(key);
  if (candidates) candidates.push(candidate);
  else map.set(key, [candidate]);
}

function evidenceForCandidate(
  candidate: MatchCandidate,
  canonicalHomeClubId: number,
): CurrentSeasonEvidenceObservation {
  const { match } = candidate;
  if (match.homeScore === null || match.awayScore === null) {
    throw new Error('A corroboration candidate must carry both score values.');
  }
  const sameOrientation = candidate.homeClubId === canonicalHomeClubId;
  return {
    sourceKey: sourceKey(match.source),
    family: 'match',
    externalGameId: match.externalGameId,
    values: {
      homeScore: sameOrientation ? match.homeScore : match.awayScore,
      awayScore: sameOrientation ? match.awayScore : match.homeScore,
      homeGoals: sameOrientation ? match.homeGoals : match.awayGoals,
      homeBehinds: sameOrientation ? match.homeBehinds : match.awayBehinds,
      awayGoals: sameOrientation ? match.awayGoals : match.homeGoals,
      awayBehinds: sameOrientation ? match.awayBehinds : match.homeBehinds,
    },
  };
}

function candidateCompleteness(candidate: MatchCandidate): number {
  const { match } = candidate;
  return [match.homeGoals, match.homeBehinds, match.awayGoals, match.awayBehinds]
    .filter((value) => value !== null).length;
}

function analyseCandidates(candidates: readonly MatchCandidate[], canonicalHomeClubId: number): {
  corroboration: CurrentSeasonCorroboration;
  representative: MatchCandidate;
} {
  if (candidates.length === 0) throw new Error('Cannot analyse an empty candidate set.');
  const corroboration = analyseCurrentSeasonCorroboration(
    candidates.map((candidate) => evidenceForCandidate(candidate, canonicalHomeClubId)),
  );
  const representative = candidates.reduce((best, candidate) => (
    candidateCompleteness(candidate) > candidateCompleteness(best) ? candidate : best
  ));
  return { corroboration, representative };
}

function asJsonValue(payload: unknown): JsonValue {
  return payload as JsonValue;
}

async function persistSourceObservation(
  tx: postgres.TransactionSql,
  sourceId: number,
  match: ExternalCurrentMatch,
  batchId: number,
  observedAt: string,
): Promise<'version_inserted' | 'head_refreshed'> {
  const family = 'match';
  const contract = getSourceFamily(SOURCE_FAMILY_REGISTRY, sourceKey(match.source), family);
  const [storedHead] = await tx<{
    versionSeq: number;
    payloadHash: string;
    hashRecipe: string;
    rawPayload: JsonValue;
    absentSince: Date | string | null;
  }[]>`
    SELECT v.version_seq AS "versionSeq",
           v.payload_hash AS "payloadHash",
           p.hash_recipe AS "hashRecipe",
           p.raw_payload AS "rawPayload",
           r.absent_since AS "absentSince"
      FROM staging.source_records r
      JOIN staging.source_record_versions v
        ON v.source_id = r.source_id
       AND v.family = r.family
       AND v.external_record_id = r.external_record_id
       AND v.version_seq = r.current_version_seq
      JOIN staging.source_payloads p
        ON p.source_id = v.source_id
       AND p.family = v.family
       AND p.payload_hash = v.payload_hash
     WHERE r.source_id = ${sourceId}
       AND r.family = ${family}
       AND r.external_record_id = ${match.externalGameId}
     FOR UPDATE OF r
  `;
  const head: ObservationHead | null = storedHead ? {
    versionSeq: storedHead.versionSeq,
    payloadHash: storedHead.payloadHash,
    hashRecipe: storedHead.hashRecipe,
    rawPayload: storedHead.rawPayload,
    absentSince: storedHead.absentSince === null ? null : String(storedHead.absentSince),
  } : null;
  const payload = asJsonValue(match.rawPayload);
  const decision = decideObservation({ contract, head, payload, observedAt });
  const scopeKey = `season=${match.season}`;

  if (decision.action === 'unchanged') {
    await tx`
      UPDATE staging.source_records
         SET scope_key = ${scopeKey},
             last_seen_at = ${observedAt},
             last_batch_id = ${batchId},
             absent_since = NULL
       WHERE source_id = ${sourceId}
         AND family = ${family}
         AND external_record_id = ${match.externalGameId}
    `;
    return 'head_refreshed';
  }

  await tx`
    INSERT INTO staging.source_payloads (
      source_id, family, payload_hash, hash_recipe, raw_payload, first_stored_at
    ) VALUES (
      ${sourceId}, ${family}, ${decision.payloadHash}, ${decision.recipe},
      ${tx.json(payload as never)}, ${observedAt}
    )
    ON CONFLICT (source_id, family, payload_hash) DO NOTHING
  `;

  if (decision.closesPreviousVersion) {
    await tx`
      UPDATE staging.source_record_versions
         SET observed_to = ${observedAt}, closed_by_batch_id = ${batchId}
       WHERE source_id = ${sourceId}
         AND family = ${family}
         AND external_record_id = ${match.externalGameId}
         AND version_seq = ${decision.versionSeq - 1}
         AND observed_to IS NULL
    `;
  }

  await tx`
    INSERT INTO staging.source_record_versions (
      source_id, family, external_record_id, version_seq, payload_hash,
      source_updated_at, observed_from, opened_by_batch_id
    ) VALUES (
      ${sourceId}, ${family}, ${match.externalGameId}, ${decision.versionSeq},
      ${decision.payloadHash}, ${decision.sourceUpdatedAt}, ${observedAt}, ${batchId}
    )
  `;

  if (head === null) {
    await tx`
      INSERT INTO staging.source_records (
        source_id, family, external_record_id, scope_key,
        current_version_seq, current_payload_hash,
        first_seen_at, last_seen_at, last_batch_id, absent_since
      ) VALUES (
        ${sourceId}, ${family}, ${match.externalGameId}, ${scopeKey},
        ${decision.versionSeq}, ${decision.payloadHash},
        ${observedAt}, ${observedAt}, ${batchId}, NULL
      )
    `;
  } else {
    await tx`
      UPDATE staging.source_records
         SET scope_key = ${scopeKey},
             current_version_seq = ${decision.versionSeq},
             current_payload_hash = ${decision.payloadHash},
             last_seen_at = ${observedAt},
             last_batch_id = ${batchId},
             absent_since = NULL
       WHERE source_id = ${sourceId}
         AND family = ${family}
         AND external_record_id = ${match.externalGameId}
    `;
  }
  return 'version_inserted';
}

async function markMissingObservationsAbsent(
  tx: postgres.TransactionSql,
  sourceIds: ReadonlyMap<ExternalSource, number>,
  matches: readonly ExternalCurrentMatch[],
  batchId: number,
  observedAt: string,
): Promise<number> {
  const scopes = new Map<string, { sourceId: number; season: number }>();
  for (const match of matches) {
    const sourceId = sourceIds.get(match.source);
    if (!sourceId) continue;
    scopes.set(`${sourceId}|${match.season}`, { sourceId, season: match.season });
  }

  let markedAbsent = 0;
  for (const { sourceId, season } of scopes.values()) {
    const rows = await tx`
      UPDATE staging.source_records
         SET absent_since = ${observedAt}
       WHERE source_id = ${sourceId}
         AND family = 'match'
         AND scope_key = ${`season=${season}`}
         AND last_batch_id <> ${batchId}
         AND absent_since IS NULL
       RETURNING external_record_id
    `;
    markedAbsent += rows.length;
  }
  return markedAbsent;
}

async function writeMatches(sql: postgres.Sql, matches: ExternalCurrentMatch[], updateMatches: boolean, insertMissingMatches: boolean): Promise<{
  observationsStaged: number;
  observationVersionsInserted: number;
  observationsMarkedAbsent: number;
  canonicalMatchesResolved: number;
  canonicalRowsInserted: 0;
  canonicalRowsUpdated: number;
  unresolvedObservations: number;
  incompleteSourceRecords: number;
  rejectedOrConflicted: number;
  sourceDisagreements: number;
  sameGroupConflicts: number;
}> {
  let observationsStaged = 0;
  let observationVersionsInserted = 0;
  let observationHeadsRefreshed = 0;
  let observationsMarkedAbsent = 0;
  let canonicalRowsUpdated = 0;
  const touchedSeasons = new Set<number>();
  let canonicalPlan: CurrentSeasonCanonicalPlan = planCurrentSeasonCanonicalWork([], insertMissingMatches);
  const observedAt = new Date().toISOString();

  await sql.begin(async (tx) => {
    const sourceIds = new Map<ExternalSource, number>();
    for (const source of new Set(matches.map((m) => m.source))) {
      const [row] = await tx<{ id: number }[]>`
        SELECT id FROM sources WHERE key = ${sourceKey(source)}
      `;
      if (!row) throw new Error(`Source ${sourceKey(source)} is missing; run migrations.`);
      sourceIds.set(source, row.id);
    }

    const firstSourceId = sourceIds.get(matches[0].source);
    if (!firstSourceId) throw new Error(`No source id for ${matches[0].source}`);

    const [batch] = await tx<{ id: number }[]>`
      INSERT INTO import_batches (source_id, tool, target_table, records_read, notes)
      VALUES (${firstSourceId}, 'current-season external refresh',
              'staging.source_record_versions', ${matches.length},
              ${`sources=${[...new Set(matches.map((m) => m.source))].join(',')}`})
      RETURNING id
    `;

    const updatesByLocalMatchId = new Map<number, MatchCandidate[]>();
    const resolvedObservations: ResolvedCurrentSeasonObservation[] = [];

    for (const match of matches) {
      const sourceId = sourceIds.get(match.source);
      if (!sourceId) throw new Error(`No source id for ${match.source}`);

      const homeClubId = await resolveClub(tx, match.homeTeamRaw, match.season);
      const awayClubId = await resolveClub(tx, match.awayTeamRaw, match.season);
      const localMatchId = await resolveLocalMatch(tx, match, homeClubId, awayClubId);
      resolvedObservations.push({ match, homeClubId, awayClubId, localMatchId });

      const observationAction = await persistSourceObservation(
        tx, sourceId, match, batch.id, observedAt,
      );
      if (observationAction === 'version_inserted') {
        observationVersionsInserted += 1;
      } else {
        observationHeadsRefreshed += 1;
      }

      // This table is the mutable current-season resolution projection. The
      // immutable source evidence was persisted above before this upsert.
      await tx`
        INSERT INTO staging.external_current_matches (
          source_id, external_game_id, season, round_label, round_number,
          complete_percent, match_date, venue_raw, home_team_raw, away_team_raw,
          home_club_id, away_club_id, local_match_id,
          home_goals, home_behinds, home_score, away_goals, away_behinds, away_score,
          raw_payload
        ) VALUES (
          ${sourceId}, ${match.externalGameId}, ${match.season}, ${match.roundLabel},
          ${match.roundNumber}, ${match.completePercent}, ${match.matchDate},
          ${match.venueRaw}, ${match.homeTeamRaw}, ${match.awayTeamRaw},
          ${homeClubId}, ${awayClubId}, ${localMatchId},
          ${match.homeGoals}, ${match.homeBehinds}, ${match.homeScore},
          ${match.awayGoals}, ${match.awayBehinds}, ${match.awayScore},
          ${tx.json(match.rawPayload as never)}
        )
        ON CONFLICT (source_id, external_game_id) DO UPDATE SET
          season = EXCLUDED.season,
          round_label = EXCLUDED.round_label,
          round_number = EXCLUDED.round_number,
          complete_percent = EXCLUDED.complete_percent,
          match_date = EXCLUDED.match_date,
          venue_raw = EXCLUDED.venue_raw,
          home_team_raw = EXCLUDED.home_team_raw,
          away_team_raw = EXCLUDED.away_team_raw,
          home_club_id = EXCLUDED.home_club_id,
          away_club_id = EXCLUDED.away_club_id,
          local_match_id = EXCLUDED.local_match_id,
          home_goals = EXCLUDED.home_goals,
          home_behinds = EXCLUDED.home_behinds,
          home_score = EXCLUDED.home_score,
          away_goals = EXCLUDED.away_goals,
          away_behinds = EXCLUDED.away_behinds,
          away_score = EXCLUDED.away_score,
          raw_payload = EXCLUDED.raw_payload,
          last_seen_at = now()
      `;
      observationsStaged += 1;

      if (localMatchId !== null && isCompleteScoredMatch(match)) {
        appendCandidate(updatesByLocalMatchId, localMatchId, {
          match, homeClubId: homeClubId!, awayClubId: awayClubId!,
        });
      }
    }

    canonicalPlan = planCurrentSeasonCanonicalWork(resolvedObservations, insertMissingMatches);
    observationsMarkedAbsent = await markMissingObservationsAbsent(
      tx, sourceIds, matches, batch.id, observedAt,
    );

    if (updateMatches) {
      for (const [localMatchId, candidates] of updatesByLocalMatchId.entries()) {
        const [current] = await tx<{
          homeClubId: number;
          awayClubId: number;
          homeScore: number;
          awayScore: number;
          homeGoals: number | null;
          homeBehinds: number | null;
          awayGoals: number | null;
          awayBehinds: number | null;
        }[]>`
          SELECT home_club_id AS "homeClubId", away_club_id AS "awayClubId",
                 home_score AS "homeScore", away_score AS "awayScore",
                 home_goals AS "homeGoals", home_behinds AS "homeBehinds",
                 away_goals AS "awayGoals", away_behinds AS "awayBehinds"
            FROM matches WHERE id = ${localMatchId}
        `;
        if (!current) continue;

        const { corroboration, representative } = analyseCandidates(candidates, current.homeClubId);
        if (corroboration.disagreeingGroups.length > 0) {
          continue;
        }
        if (corroboration.sameGroupConflictGroups.length > 0) {
          continue;
        }

        if (corroboration.values === null) continue;
        const agreedHomeScore = corroboration.values.homeScore;
        const agreedAwayScore = corroboration.values.awayScore;
        let agreedHomeGoals = corroboration.values.homeGoals;
        let agreedHomeBehinds = corroboration.values.homeBehinds;
        let agreedAwayGoals = corroboration.values.awayGoals;
        let agreedAwayBehinds = corroboration.values.awayBehinds;

        agreedHomeGoals = agreedHomeGoals ?? current.homeGoals;
        agreedHomeBehinds = agreedHomeBehinds ?? current.homeBehinds;
        agreedAwayGoals = agreedAwayGoals ?? current.awayGoals;
        agreedAwayBehinds = agreedAwayBehinds ?? current.awayBehinds;

        const scoreChanged = current.homeScore !== agreedHomeScore || current.awayScore !== agreedAwayScore;
        const componentsChanged = current.homeGoals !== agreedHomeGoals || current.homeBehinds !== agreedHomeBehinds ||
                                  current.awayGoals !== agreedAwayGoals || current.awayBehinds !== agreedAwayBehinds;

        if (!scoreChanged && !componentsChanged) {
          continue;
        }

        const { match } = representative;
        const sourceId = sourceIds.get(match.source)!;

        await tx`
          UPDATE matches
             SET home_score = ${agreedHomeScore},
                 away_score = ${agreedAwayScore},
                 home_goals = ${agreedHomeGoals},
                 home_behinds = ${agreedHomeBehinds},
                 away_goals = ${agreedAwayGoals},
                 away_behinds = ${agreedAwayBehinds},
                 result = CASE
                   WHEN ${agreedHomeScore} = ${agreedAwayScore} THEN 'draw'::match_result
                   WHEN ${agreedHomeScore} > ${agreedAwayScore} THEN 'home_win'::match_result
                   ELSE 'away_win'::match_result
                 END,
                 winner_club_id = CASE
                   WHEN ${agreedHomeScore} = ${agreedAwayScore} THEN NULL
                   WHEN ${agreedHomeScore} > ${agreedAwayScore} THEN home_club_id
                   ELSE away_club_id
                 END,
                 margin = abs(${agreedHomeScore} - ${agreedAwayScore}),
                 source_id = ${sourceId},
                 source_record_id = ${match.externalGameId},
                 import_batch_id = ${batch.id}
           WHERE id = ${localMatchId}
        `;
        canonicalRowsUpdated += 1;
        touchedSeasons.add(match.season);
      }
    }

    for (const season of touchedSeasons) {
      await refreshSeasonMetadata(tx, season);
    }

    await tx`
      UPDATE import_batches
         SET completed_at = now(), status = 'completed',
             records_inserted = ${observationVersionsInserted},
             records_updated = ${observationHeadsRefreshed},
             records_rejected = ${canonicalPlan.rejectedOrConflicted},
             validation_result = ${tx.json({
               observationsFetched: matches.length,
               observationsStaged,
               observationVersionsInserted,
               observationHeadsRefreshed,
               observationsMarkedAbsent,
               canonicalMatchesResolved: canonicalPlan.canonicalMatchesResolved,
               canonicalRowsInserted: canonicalPlan.canonicalRowsInserted,
               canonicalRowsUpdated,
               unresolvedObservations: canonicalPlan.unresolvedObservations,
               incompleteSourceRecords: canonicalPlan.incompleteSourceRecords,
               rejectedOrConflicted: canonicalPlan.rejectedOrConflicted,
               sourceDisagreements: canonicalPlan.sourceDisagreements,
               sameGroupConflicts: canonicalPlan.sameGroupConflicts,
             } as never)}
       WHERE id = ${batch.id}
    `;
  });

  return {
    observationsStaged,
    observationVersionsInserted,
    observationsMarkedAbsent,
    canonicalMatchesResolved: canonicalPlan.canonicalMatchesResolved,
    canonicalRowsInserted: canonicalPlan.canonicalRowsInserted,
    canonicalRowsUpdated,
    unresolvedObservations: canonicalPlan.unresolvedObservations,
    incompleteSourceRecords: canonicalPlan.incompleteSourceRecords,
    rejectedOrConflicted: canonicalPlan.rejectedOrConflicted,
    sourceDisagreements: canonicalPlan.sourceDisagreements,
    sameGroupConflicts: canonicalPlan.sameGroupConflicts,
  };
}

async function reportStaging(sql: postgres.Sql, year: number): Promise<CurrentSeasonReport> {
  const rows = await sql<CurrentSeasonReportRow[]>`
    SELECT s.key AS source,
           count(*)::int AS staged,
           count(*) FILTER (WHERE e.local_match_id IS NOT NULL)::int AS resolved,
           count(*) FILTER (WHERE e.complete_percent = 100)::int AS complete,
           count(*) FILTER (WHERE e.home_score IS NOT NULL AND e.away_score IS NOT NULL)::int AS "withScores",
           count(*) FILTER (WHERE (e.home_club_id IS NULL AND lower(e.home_team_raw) NOT IN ('not recorded', 'tbd', '')) OR (e.away_club_id IS NULL AND lower(e.away_team_raw) NOT IN ('not recorded', 'tbd', '')))::int AS "unresolvedTeams"
      FROM staging.external_current_matches e
      JOIN sources s ON s.id = e.source_id
      LEFT JOIN staging.source_records r
        ON r.source_id = e.source_id
       AND r.family = 'match'
       AND r.external_record_id = e.external_game_id
     WHERE e.season = ${year}
       AND (r.external_record_id IS NULL OR r.absent_since IS NULL)
     GROUP BY s.key
     ORDER BY s.key
  `;

  const incompleteSamples = await sql<CurrentSeasonUnresolvedSample[]>`
    SELECT s.key AS source,
           e.external_game_id AS "externalGameId",
           e.match_date::text AS "matchDate",
           e.round_number AS round,
           e.home_team_raw AS home,
           e.away_team_raw AS away,
           e.home_club_id AS "homeClubId",
           e.away_club_id AS "awayClubId"
      FROM staging.external_current_matches e
      JOIN sources s ON s.id = e.source_id
      LEFT JOIN staging.source_records r
        ON r.source_id = e.source_id
       AND r.family = 'match'
       AND r.external_record_id = e.external_game_id
     WHERE e.season = ${year} AND e.local_match_id IS NULL
       AND (r.external_record_id IS NULL OR r.absent_since IS NULL)
       AND (e.complete_percent IS NULL OR e.complete_percent < 100 OR e.match_date IS NULL)
       AND NOT ((e.home_club_id IS NULL AND lower(e.home_team_raw) NOT IN ('not recorded', 'tbd', '')) OR (e.away_club_id IS NULL AND lower(e.away_team_raw) NOT IN ('not recorded', 'tbd', '')))
     ORDER BY s.key, e.match_date NULLS LAST, e.external_game_id
     LIMIT 10
  `;

  const unresolvedMatchSamples = await sql<CurrentSeasonUnresolvedSample[]>`
    SELECT s.key AS source,
           e.external_game_id AS "externalGameId",
           e.match_date::text AS "matchDate",
           e.round_number AS round,
           e.home_team_raw AS home,
           e.away_team_raw AS away,
           e.home_club_id AS "homeClubId",
           e.away_club_id AS "awayClubId"
      FROM staging.external_current_matches e
      JOIN sources s ON s.id = e.source_id
      LEFT JOIN staging.source_records r
        ON r.source_id = e.source_id
       AND r.family = 'match'
       AND r.external_record_id = e.external_game_id
     WHERE e.season = ${year} AND e.local_match_id IS NULL
       AND (r.external_record_id IS NULL OR r.absent_since IS NULL)
       AND e.complete_percent = 100 AND e.match_date IS NOT NULL
       AND NOT ((e.home_club_id IS NULL AND lower(e.home_team_raw) NOT IN ('not recorded', 'tbd', '')) OR (e.away_club_id IS NULL AND lower(e.away_team_raw) NOT IN ('not recorded', 'tbd', '')))
     ORDER BY s.key, e.match_date NULLS LAST, e.external_game_id
     LIMIT 10
  `;

  const unresolvedTeamSamples = await sql<CurrentSeasonUnresolvedSample[]>`
    SELECT s.key AS source,
           e.external_game_id AS "externalGameId",
           e.match_date::text AS "matchDate",
           e.round_number AS round,
           e.home_team_raw AS home,
           e.away_team_raw AS away,
           e.home_club_id AS "homeClubId",
           e.away_club_id AS "awayClubId"
      FROM staging.external_current_matches e
      JOIN sources s ON s.id = e.source_id
      LEFT JOIN staging.source_records r
        ON r.source_id = e.source_id
       AND r.family = 'match'
       AND r.external_record_id = e.external_game_id
     WHERE e.season = ${year} AND e.local_match_id IS NULL
       AND (r.external_record_id IS NULL OR r.absent_since IS NULL)
       AND ((e.home_club_id IS NULL AND lower(e.home_team_raw) NOT IN ('not recorded', 'tbd', '')) OR (e.away_club_id IS NULL AND lower(e.away_team_raw) NOT IN ('not recorded', 'tbd', '')))
     ORDER BY s.key, e.match_date NULLS LAST, e.external_game_id
     LIMIT 10
  `;

  return { year, rows, incompleteSamples, unresolvedMatchSamples, unresolvedTeamSamples };
}
