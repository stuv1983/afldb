import postgres from 'postgres';

import sourceFamiliesRaw from '../../../data/reference/source-families.json';
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
  fetched: number;
  sourceCounts: Record<ExternalSource, number>;
  independenceGroupCounts: Record<string, number>;
  complete: number;
  withScores: number;
  staged: number;
  inserted: number;
  resolved: number;
  updated: number;
  unresolved: number;
  incompleteFixtures: number;
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
  const fetched = matches.length;
  const complete = matches.filter((m) => m.completePercent === 100).length;
  const withScores = matches.filter((m) => m.homeScore !== null && m.awayScore !== null).length;

  if (!options.apply || matches.length === 0) {
    if (matches.length === 0) {
      return {
        fetched,
        sourceCounts,
        independenceGroupCounts,
        complete,
        withScores,
        staged: 0,
        inserted: 0,
        resolved: 0,
        updated: 0,
        unresolved: 0,
        incompleteFixtures: 0,
        sourceDisagreements: 0,
        sameGroupConflicts: 0,
        applied: false,
      };
    }

    const sql = createImportClient();
    try {
      let resolved = 0;
      let unresolved = 0;
      let incompleteFixtures = 0;
      const updatesByLocalMatchId = new Map<number, MatchCandidate[]>();
      const insertsByMatchKey = new Map<string, MatchCandidate[]>();
      for (const match of matches) {
        const homeClubId = await resolveClub(sql, match.homeTeamRaw, match.season);
        const awayClubId = await resolveClub(sql, match.awayTeamRaw, match.season);
        const localMatchId = await resolveLocalMatch(sql, match, homeClubId, awayClubId);
        const resolution = classifyCurrentSeasonResolution(localMatchId, match);
        if (resolution === 'resolved') {
          resolved += 1;
        } else if (resolution === 'unresolved') {
          unresolved += 1;
        } else {
          incompleteFixtures += 1;
        }
        if (isCompleteScoredMatch(match) && homeClubId !== null && awayClubId !== null) {
          if (localMatchId !== null) {
            appendCandidate(updatesByLocalMatchId, localMatchId, { match, homeClubId, awayClubId });
          } else if (resolution === 'unresolved') {
            const matchKey = await missingMatchKey(sql, match, homeClubId, awayClubId);
            if (matchKey !== null) {
              appendCandidate(insertsByMatchKey, matchKey, { match, homeClubId, awayClubId });
            }
          }
        }
      }
      const conflictCounts = countCandidateConflicts([
        ...updatesByLocalMatchId.values(),
        ...insertsByMatchKey.values(),
      ]);
      return {
        fetched,
        sourceCounts,
        independenceGroupCounts,
        complete,
        withScores,
        staged: matches.length,
        inserted: 0,
        resolved,
        updated: 0,
        unresolved,
        incompleteFixtures,
        sourceDisagreements: conflictCounts.sourceDisagreements,
        sameGroupConflicts: conflictCounts.sameGroupConflicts,
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
      fetched,
      sourceCounts,
      independenceGroupCounts,
      complete,
      withScores,
      staged: result.staged,
      inserted: result.inserted,
      resolved: result.resolved,
      updated: result.updated,
      unresolved: result.unresolved,
      incompleteFixtures: result.incompleteFixtures,
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

function localRoundNumber(match: ExternalCurrentMatch): number | null {
  const code = primaryLocalRoundCode(match);
  return code !== null && /^\d+$/.test(code) ? Number(code) : null;
}

function localRoundType(match: ExternalCurrentMatch): 'home_and_away' | 'elimination_final' | 'qualifying_final' | 'semi_final' | 'preliminary_final' | 'grand_final' | null {
  const code = primaryLocalRoundCode(match);
  if (code === null) return null;
  if (/^\d+$/.test(code)) return 'home_and_away';
  if (code === 'EF') return 'elimination_final';
  if (code === 'QF') return 'qualifying_final';
  if (code === 'SF') return 'semi_final';
  if (code === 'PF') return 'preliminary_final';
  if (code === 'GF') return 'grand_final';
  return null;
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

async function clubName(sql: Db, clubId: number): Promise<string> {
  const [row] = await sql<{ name: string }[]>`SELECT name FROM clubs WHERE id = ${clubId}`;
  if (!row) throw new Error(`Club ${clubId} no longer exists.`);
  return row.name;
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

function classifyCurrentSeasonResolution(
  localMatchId: number | null,
  match: ExternalCurrentMatch,
): 'resolved' | 'unresolved' | 'incomplete' {
  if (localMatchId !== null) return 'resolved';
  if (match.completePercent === 100 && match.matchDate !== null) return 'unresolved';
  return 'incomplete';
}

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

async function missingMatchKey(
  sql: Db,
  match: ExternalCurrentMatch,
  homeClubId: number,
  awayClubId: number,
): Promise<string | null> {
  const roundCode = primaryLocalRoundCode(match);
  if (roundCode === null || match.matchDate === null) return null;
  const homeName = await clubName(sql, homeClubId);
  const awayName = await clubName(sql, awayClubId);
  return `${match.season}|${roundCode}|${match.matchDate}|${homeName}|${awayName}`;
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

function countCandidateConflicts(candidateSets: readonly MatchCandidate[][]): {
  sourceDisagreements: number;
  sameGroupConflicts: number;
} {
  let sourceDisagreements = 0;
  let sameGroupConflicts = 0;
  for (const candidates of candidateSets) {
    const { corroboration } = analyseCandidates(candidates, candidates[0].homeClubId);
    if (corroboration.disagreeingGroups.length > 0) sourceDisagreements += 1;
    if (corroboration.sameGroupConflictGroups.length > 0) sameGroupConflicts += 1;
  }
  return { sourceDisagreements, sameGroupConflicts };
}

async function writeMatches(sql: postgres.Sql, matches: ExternalCurrentMatch[], updateMatches: boolean, insertMissingMatches: boolean): Promise<{
  staged: number;
  inserted: number;
  resolved: number;
  updated: number;
  unresolved: number;
  incompleteFixtures: number;
  sourceDisagreements: number;
  sameGroupConflicts: number;
}> {
  let staged = 0;
  let inserted = 0;
  let resolved = 0;
  let updated = 0;
  let unresolved = 0;
  let incompleteFixtures = 0;
  let sourceDisagreements = 0;
  let sameGroupConflicts = 0;
  const touchedSeasons = new Set<number>();

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
              'staging.external_current_matches', ${matches.length},
              ${`sources=${[...new Set(matches.map((m) => m.source))].join(',')}`})
      RETURNING id
    `;

    const updatesByLocalMatchId = new Map<number, MatchCandidate[]>();
    const insertsByMatchKey = new Map<string, MatchCandidate[]>();

    for (const match of matches) {
      const sourceId = sourceIds.get(match.source);
      if (!sourceId) throw new Error(`No source id for ${match.source}`);

      const homeClubId = await resolveClub(tx, match.homeTeamRaw, match.season);
      const awayClubId = await resolveClub(tx, match.awayTeamRaw, match.season);
      const localMatchId = await resolveLocalMatch(tx, match, homeClubId, awayClubId);
      
      const resolution = classifyCurrentSeasonResolution(localMatchId, match);
      if (resolution === 'resolved') {
        resolved += 1;
      } else if (resolution === 'unresolved') {
        unresolved += 1;
      } else {
        incompleteFixtures += 1;
      }

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
      staged += 1;

      if (localMatchId !== null && isCompleteScoredMatch(match)) {
        appendCandidate(updatesByLocalMatchId, localMatchId, {
          match, homeClubId: homeClubId!, awayClubId: awayClubId!,
        });
      }

      if (localMatchId === null && isCompleteScoredMatch(match)
          && homeClubId !== null && awayClubId !== null) {
        const matchKey = await missingMatchKey(tx, match, homeClubId, awayClubId);
        if (matchKey !== null) {
          appendCandidate(insertsByMatchKey, matchKey, { match, homeClubId, awayClubId });
        }
      }
    }

    const conflictCounts = countCandidateConflicts([
      ...updatesByLocalMatchId.values(),
      ...insertsByMatchKey.values(),
    ]);
    sourceDisagreements = conflictCounts.sourceDisagreements;
    sameGroupConflicts = conflictCounts.sameGroupConflicts;

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
        updated += 1;
        touchedSeasons.add(match.season);
      }
    }

    if (insertMissingMatches) {
      for (const [matchKey, candidates] of insertsByMatchKey.entries()) {
        const { match, homeClubId, awayClubId } = candidates[0];
        const { corroboration } = analyseCandidates(candidates, homeClubId);
        if (corroboration.disagreeingGroups.length > 0) {
          continue;
        }
        if (corroboration.sameGroupConflictGroups.length > 0) {
          continue;
        }
        if (corroboration.values === null) continue;
        const values = corroboration.values;
        const result = values.homeScore === values.awayScore
          ? 'draw'
          : values.homeScore > values.awayScore ? 'home_win' : 'away_win';
        const roundCode = primaryLocalRoundCode(match);
        const roundType = localRoundType(match);
        if (roundCode === null || roundType === null) continue;

        const winnerClubId = result === 'draw' ? null : result === 'home_win' ? homeClubId : awayClubId;
        const sourceId = sourceIds.get(match.source)!;

        const [insertedRow] = await tx<{ id: number }[]>`
          INSERT INTO matches (
            match_key, season, round_code, round_number, round_type, is_final,
            match_date, venue_raw, home_club_id, away_club_id,
            home_goals, home_behinds, home_score,
            away_goals, away_behinds, away_score,
            result, winner_club_id, margin,
            attendance, attendance_status, attendance_source_id,
            source_id, source_record_id, import_batch_id
          ) VALUES (
            ${matchKey}, ${match.season}, ${roundCode}, ${localRoundNumber(match)},
            ${roundType}::round_type, ${roundType !== 'home_and_away'},
            ${match.matchDate}, ${match.venueRaw ?? 'Unknown'},
            ${homeClubId}, ${awayClubId},
            ${values.homeGoals}, ${values.homeBehinds}, ${values.homeScore},
            ${values.awayGoals}, ${values.awayBehinds}, ${values.awayScore},
            ${result}::match_result, ${winnerClubId}, ${Math.abs(values.homeScore - values.awayScore)},
            NULL, 'not_collected'::coverage_status, NULL,
            ${sourceId}, ${match.externalGameId}, ${batch.id}
          )
          ON CONFLICT (match_key) DO NOTHING
          RETURNING id
        `;

        if (insertedRow) {
          inserted += 1;
          unresolved -= candidates.length;
          touchedSeasons.add(match.season);
          
          for (const candidate of candidates) {
            const cSourceId = sourceIds.get(candidate.match.source)!;
            await tx`
              UPDATE staging.external_current_matches
                 SET local_match_id = ${insertedRow.id}
               WHERE source_id = ${cSourceId}
                 AND external_game_id = ${candidate.match.externalGameId}
            `;
          }
        }
      }
    }

    for (const season of touchedSeasons) {
      await refreshSeasonMetadata(tx, season);
    }

    await tx`
      UPDATE import_batches
         SET completed_at = now(), status = 'completed',
             records_inserted = ${staged + inserted}, records_updated = ${updated},
             records_rejected = ${unresolved},
             validation_result = ${tx.json({
               staged, inserted, resolved, updated, unresolved, incompleteFixtures,
               sourceDisagreements, sameGroupConflicts,
             } as never)}
       WHERE id = ${batch.id}
    `;
  });

  return {
    staged, inserted, resolved, updated, unresolved, incompleteFixtures,
    sourceDisagreements, sameGroupConflicts,
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
     WHERE e.season = ${year}
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
     WHERE e.season = ${year} AND e.local_match_id IS NULL
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
     WHERE e.season = ${year} AND e.local_match_id IS NULL
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
     WHERE e.season = ${year} AND e.local_match_id IS NULL
       AND ((e.home_club_id IS NULL AND lower(e.home_team_raw) NOT IN ('not recorded', 'tbd', '')) OR (e.away_club_id IS NULL AND lower(e.away_team_raw) NOT IN ('not recorded', 'tbd', '')))
     ORDER BY s.key, e.match_date NULLS LAST, e.external_game_id
     LIMIT 10
  `;

  return { year, rows, incompleteSamples, unresolvedMatchSamples, unresolvedTeamSamples };
}
