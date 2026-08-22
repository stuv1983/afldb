import 'server-only';

import type postgres from 'postgres';

import { ALGORITHM_VERSION, assessMatch, MATCH_POLICY } from '@/lib/player-matching/confidence';
import { scoreCandidate } from '@/lib/player-matching/score-candidate';
import type {
  EvidenceItem,
  HardConflict,
  MatchAssessment,
} from '@/lib/player-matching/types';
import {
  getLinkUniquenessScope,
  resolutionKey,
  type CandidateClub,
  type CandidateEvidence,
  type MatchTarget,
  type SourceEvidence,
  type TemporalEvidence,
} from '@/lib/player-matching/types';
import { parseCareerSpan } from '@/lib/player-matching/parse-career-span';
import type { LinkTargetTable } from '@/db/queries/player-links';

/**
 * Candidate generation for player-link suggestions.
 *
 * Generation and scoring are separate stages on purpose. This module
 * decides only who is worth comparing; nothing here ranks anybody, and
 * a fuzzy name match earns a place in the candidate set and nothing
 * more (the rule migration 019 states outright: a name-similarity score
 * is a candidate, never a link).
 *
 * Every client is injected rather than imported. The admin page passes
 * the app pool, the approval path passes its open import transaction so
 * a suggestion is rescored against the same snapshot it is about to be
 * written from, and the backtest passes a read-only connection. One
 * code path, three callers, no second implementation to drift.
 */

export type Sql = postgres.Sql<Record<string, never>> | postgres.TransactionSql;

/** Which half of the data to read: the review queue, or confirmed links. */
export type SourceStatusFilter = 'unresolved' | 'trusted';

const UNRESOLVED_STATUSES = ['ambiguous', 'unmatched', 'implausible'];
const TRUSTED_STATUSES = ['unique', 'resolved'];

/**
 * A source row plus, separately, the answer when there is one.
 *
 * knownPlayerId exists for the backtest and is deliberately outside
 * SourceEvidence, so the value can never reach candidate generation or
 * scoring: those functions accept SourceEvidence and have no field to
 * read it from even by accident.
 */
export type SourceEvidenceRow = {
  source: SourceEvidence;
  knownPlayerId: number | null;
};

type RawSourceRow = {
  targetTable: LinkTargetTable;
  targetId: number;
  resolutionEntityType: string;
  resolutionEntityId: number;
  rawName: string;
  normalisedName: string;
  clubId: number | null;
  clubNameRaw: string | null;
  activeSeason: number | null;
  /** Which competition the active season belongs to. */
  seasonScope: 'afldb' | 'external' | null;
  draftYear: number | null;
  inductionYear: number | null;
  careerSpanRaw: string | null;
  reportedGames: number | null;
  reportedGoals: number | null;
  context: string;
  linkStatus: string;
  scopeValue: string | null;
  knownPlayerId: number | null;
};

/**
 * Turn the flat source columns into typed temporal evidence.
 *
 * This is where a year stops being a number and becomes a claim. An
 * award season says the player was on the field; an induction year says
 * only that a committee met. Keeping the two apart here is what stops
 * the scorer from ruling out a 1950s footballer because he was inducted
 * in 1996.
 */
function toTemporal(row: RawSourceRow): TemporalEvidence[] {
  const temporal: TemporalEvidence[] = [];
  if (row.activeSeason !== null) {
    temporal.push({
      kind: 'active_season',
      season: row.activeSeason,
      // award_winners covers Magarey, Sandover, Liston, U18 and VFL
      // Under 19s medals as well as AFL ones, so its season is only
      // ever treated as corroboration, never as grounds to rule a
      // player out. The other three tables are AFLDB seasons outright.
      competitionScope: row.seasonScope ?? 'external',
    });
  }
  if (row.draftYear !== null) {
    temporal.push({ kind: 'draft_year', year: row.draftYear });
  }
  if (row.inductionYear !== null) {
    temporal.push({ kind: 'induction_year', year: row.inductionYear });
  }
  const span = parseCareerSpan(row.careerSpanRaw);
  if (span) {
    temporal.push({ kind: 'active_range', first: span.first, last: span.last });
  }
  return temporal;
}

export function toSourceEvidenceRow(row: RawSourceRow): SourceEvidenceRow {
  const target: MatchTarget = {
    targetTable: row.targetTable,
    targetId: Number(row.targetId),
    resolutionEntityType: row.resolutionEntityType as MatchTarget['resolutionEntityType'],
    resolutionEntityId: Number(row.resolutionEntityId),
  };
  return {
    source: {
      target,
      rawName: row.rawName,
      normalisedName: row.normalisedName ?? '',
      temporal: toTemporal(row),
      clubId: row.clubId === null ? null : Number(row.clubId),
      clubNameRaw: row.clubNameRaw,
      reportedGames: row.reportedGames === null ? null : Number(row.reportedGames),
      reportedGoals: row.reportedGoals === null ? null : Number(row.reportedGoals),
      context: row.context ?? '',
      linkStatus: row.linkStatus,
      uniquenessScope: getLinkUniquenessScope(row.targetTable, row.scopeValue),
    },
    knownPlayerId: row.knownPlayerId === null ? null : Number(row.knownPlayerId),
  };
}

/**
 * Every source row at RESOLUTION grain, one UNION branch per table.
 *
 * Draft picks are read through draft_persons rather than one row per
 * pick: identity there is person-grained, so a person with four picks
 * is one decision, not four near-identical suggestions that could in
 * principle disagree with each other.
 *
 * The Hall of Fame branch repeats the queue exclusions (AFLW inductees,
 * non-playing categories) so the suggestion set and the review queue
 * describe the same population.
 */
export async function fetchSourceEvidence(
  sql: Sql,
  opts: {
    status: SourceStatusFilter;
    table?: LinkTargetTable;
    limit?: number;
    /** One logical entity, for the approval path's in-transaction re-read. */
    entity?: { type: string; id: number };
  },
): Promise<SourceEvidenceRow[]> {
  const statuses = opts.status === 'trusted' ? TRUSTED_STATUSES : UNRESOLVED_STATUSES;
  const rows = await sql<RawSourceRow[]>`
    SELECT * FROM (
      SELECT 'award_winners' AS "targetTable", w.id AS "targetId",
             'award_winners' AS "resolutionEntityType", w.id AS "resolutionEntityId",
             w.player_name_raw AS "rawName",
             afldb_normalise_name(w.player_name_raw) AS "normalisedName",
             w.club_id AS "clubId", w.club_name_raw AS "clubNameRaw",
             w.season::int AS "activeSeason", 'external'::text AS "seasonScope",
             NULL::int AS "draftYear",
             NULL::int AS "inductionYear", NULL::text AS "careerSpanRaw",
             NULL::int AS "reportedGames", NULL::int AS "reportedGoals",
             concat_ws(' · ', a.name, w.season::text,
                       COALESCE(c.name, w.club_name_raw)) AS context,
             w.link_status_value::text AS "linkStatus",
             NULL::text AS "scopeValue", w.player_id AS "knownPlayerId"
        FROM award_winners w
        JOIN awards a ON a.id = w.award_id
        LEFT JOIN clubs c ON c.id = w.club_id
       WHERE w.link_status_value::text = ANY(${statuses})
      UNION ALL
      SELECT 'award_nominations', n.id, 'award_nominations', n.id, n.player_name_raw,
             afldb_normalise_name(n.player_name_raw),
             n.club_id, NULL,
             n.season::int, 'afldb', NULL, NULL, NULL, NULL, NULL,
             concat_ws(' · ', a.name, n.season::text,
                       CASE WHEN n.round_number IS NOT NULL
                            THEN 'Round ' || n.round_number END),
             n.link_status_value::text, NULL, n.player_id
        FROM award_nominations n
        JOIN awards a ON a.id = n.award_id
       WHERE n.link_status_value::text = ANY(${statuses})
      UNION ALL
      SELECT 'hall_of_fame', h.id, 'hall_of_fame', h.id, h.name,
             afldb_normalise_name(h.name),
             NULL, h.club_name_raw,
             NULL, NULL, NULL, h.inducted_year::int, h.playing_career, NULL, NULL,
             concat_ws(' · ', 'Hall of Fame', h.category,
                       CASE WHEN h.inducted_year IS NOT NULL
                            THEN 'inducted ' || h.inducted_year END,
                       h.club_name_raw),
             h.link_status_value::text, NULL, h.player_id
        FROM hall_of_fame h
        LEFT JOIN aflw.players ap ON lower(trim(ap.display_name)) = lower(trim(h.name))
       WHERE h.link_status_value::text = ANY(${statuses})
         AND ap.slug IS NULL
         AND lower(COALESCE(h.category, '')) NOT IN ('media', 'umpire', 'administrator', 'pioneer')
      UNION ALL
      SELECT 'honour_team_members', m.id, 'honour_team_members', m.id, m.player_name_raw,
             afldb_normalise_name(m.player_name_raw),
             NULL, m.club_name_raw,
             NULL, NULL, NULL, NULL, NULL, NULL, NULL,
             concat_ws(' · ', m.team_name, m.position, m.club_name_raw),
             m.link_status_value::text, m.team_name, m.player_id
        FROM honour_team_members m
       WHERE m.link_status_value::text = ANY(${statuses})
      UNION ALL
      SELECT 'captaincies', cp.id, 'captaincies', cp.id, cp.player_name_raw,
             afldb_normalise_name(cp.player_name_raw),
             cp.club_id, NULL,
             cp.season::int, 'afldb', NULL, NULL, NULL, NULL, NULL,
             concat_ws(' · ', c.name, cp.season::text, cp.role),
             cp.link_status_value::text, NULL, cp.player_id
        FROM captaincies cp
        JOIN clubs c ON c.id = cp.club_id
       WHERE cp.link_status_value::text = ANY(${statuses})
      UNION ALL
      SELECT 'player_achievements', pa.id, 'player_achievements', pa.id, pa.player_name_raw,
             afldb_normalise_name(pa.player_name_raw),
             pa.club_id, pa.club_name_raw,
             pa.season::int, 'afldb', NULL, NULL, NULL, NULL, NULL,
             concat_ws(' · ', replace(pa.achievement_type::text, '_', ' '), pa.season::text),
             pa.link_status_value::text, NULL, pa.player_id
        FROM player_achievements pa
       WHERE pa.link_status_value::text = ANY(${statuses})
      UNION ALL
      SELECT 'draft_picks', first_pick.id, 'draft_person', per.id, per.display_name_raw,
             afldb_normalise_name(per.display_name_raw),
             first_pick.club_id, NULL,
             NULL, NULL, first_pick.draft_year::int, NULL, NULL,
             per.reported_games, per.reported_goals,
             concat_ws(' · ', 'Draft', first_pick.draft_year::text, first_pick.draft_type),
             per.link_status::text, NULL, per.player_id
        FROM draft_persons per
        JOIN LATERAL (
          SELECT dp.id, dp.club_id, dp.draft_year, dp.draft_type
            FROM draft_picks dp
           WHERE dp.draft_person_id = per.id
           ORDER BY dp.draft_year, dp.id
           LIMIT 1
        ) first_pick ON TRUE
       WHERE per.link_status::text = ANY(${statuses})
    ) q
    WHERE ${opts.table ? sql`q."targetTable" = ${opts.table}` : sql`TRUE`}
      AND ${opts.entity
        ? sql`q."resolutionEntityType" = ${opts.entity.type}
              AND q."resolutionEntityId" = ${opts.entity.id}`
        : sql`TRUE`}
    ORDER BY q."targetTable", q."resolutionEntityId"
    ${opts.limit ? sql`LIMIT ${opts.limit}` : sql``}
  `;
  return rows.map(toSourceEvidenceRow);
}

type RawCandidateRow = {
  key: string;
  playerId: number;
  displayName: string;
  searchName: string;
  givenName: string | null;
  surname: string | null;
  debutSeason: number | null;
  finalSeason: number | null;
  careerGames: number | null;
  careerGoals: number | null;
  nameSimilarity: number;
  aliasSearchNames: string[];
};

/**
 * The candidate set for a batch of source rows, keyed by resolution.
 *
 * Blocking is three index-backed lookups per source -- exact normalised
 * name, exact alias, and a bounded trigram neighbourhood -- rather than
 * a comparison against all 13,000 players. The two exact arms are never
 * capped, so the strongest possible candidate cannot be squeezed out by
 * a crowd of fuzzy ones.
 */
export async function fetchCandidateEvidence(
  sql: Sql,
  sources: readonly SourceEvidence[],
): Promise<Map<string, CandidateEvidence[]>> {
  const byKey = new Map<string, CandidateEvidence[]>();
  if (sources.length === 0) return byKey;

  const { blocking } = MATCH_POLICY;
  const keys = sources.map((s) => resolutionKey(s.target));
  const names = sources.map((s) => s.normalisedName);
  for (const key of keys) byKey.set(key, []);

  const rows = await sql<RawCandidateRow[]>`
    WITH src AS (
      SELECT * FROM unnest(${keys}::text[], ${names}::text[]) AS t(key, nname)
    ),
    blocked AS (
      SELECT s.key, s.nname, c.player_id
        FROM src s
        CROSS JOIN LATERAL (
          SELECT p.id AS player_id FROM players p WHERE p.search_name = s.nname
          UNION
          SELECT a.player_id FROM player_name_aliases a WHERE a.search_alias = s.nname
          UNION
          (SELECT p2.id FROM players p2
            WHERE p2.search_name % s.nname
            ORDER BY similarity(p2.search_name, s.nname) DESC, p2.id
            LIMIT ${blocking.trigramCandidatesPerSource})
        ) c
       WHERE s.nname <> ''
    )
    SELECT b.key, p.id AS "playerId", p.display_name AS "displayName",
           p.search_name AS "searchName", p.given_name AS "givenName",
           p.surname AS "surname",
           p.debut_season::int AS "debutSeason", p.final_season::int AS "finalSeason",
           pcs.games::int AS "careerGames", pcs.goals::int AS "careerGoals",
           GREATEST(
             similarity(p.search_name, b.nname),
             COALESCE((SELECT max(similarity(al.search_alias, b.nname))
                         FROM player_name_aliases al WHERE al.player_id = p.id), 0)
           )::float8 AS "nameSimilarity",
           COALESCE((SELECT array_agg(al2.search_alias)
                       FROM player_name_aliases al2 WHERE al2.player_id = p.id),
                    ARRAY[]::text[]) AS "aliasSearchNames"
      FROM blocked b
      JOIN players p ON p.id = b.player_id
      LEFT JOIN player_career_stats pcs ON pcs.player_id = p.id
     WHERE p.search_name = b.nname
        OR EXISTS (SELECT 1 FROM player_name_aliases ax
                    WHERE ax.player_id = p.id AND ax.search_alias = b.nname)
        OR similarity(p.search_name, b.nname) >= ${blocking.trigramFloor}
  `;
  if (rows.length === 0) return byKey;

  const playerIds = [...new Set(rows.map((r) => Number(r.playerId)))];

  const clubRows = await sql<
    { playerId: number; clubId: number; games: number | null;
      firstSeason: number | null; lastSeason: number | null }[]
  >`
    SELECT player_id AS "playerId", club_id AS "clubId", games::int AS games,
           first_season::int AS "firstSeason", last_season::int AS "lastSeason"
      FROM player_clubs
     WHERE player_id = ANY(${playerIds})
  `;
  const clubsByPlayer = new Map<number, CandidateClub[]>();
  for (const row of clubRows) {
    const list = clubsByPlayer.get(Number(row.playerId)) ?? [];
    list.push({
      clubId: Number(row.clubId),
      games: row.games === null ? null : Number(row.games),
      firstSeason: row.firstSeason === null ? null : Number(row.firstSeason),
      lastSeason: row.lastSeason === null ? null : Number(row.lastSeason),
    });
    clubsByPlayer.set(Number(row.playerId), list);
  }

  // Honour teams are the one place the schema really forbids a repeat
  // player (honour_team_linked_player_uq, migration 059). Everywhere
  // else a player holding many source rows is normal, so nothing is
  // looked up and nothing is flagged.
  const teamNames = [
    ...new Set(
      sources
        .filter((s) => s.uniquenessScope.kind === 'honour_team')
        .map((s) => (s.uniquenessScope as { kind: 'honour_team'; teamName: string }).teamName),
    ),
  ];
  const occupiedTeamSlots = new Set<string>();
  if (teamNames.length > 0) {
    // The rows being assessed are excluded from their own collision
    // check. Without this a row that is already linked collides with
    // itself -- which is how the first backtest managed to raise 87
    // uniqueness objections, every single one of them against the
    // player the row was correctly linked to already.
    const assessedIds = sources
      .filter((s) => s.target.targetTable === 'honour_team_members')
      .map((s) => s.target.targetId);
    const taken = await sql<{ teamName: string; playerId: number }[]>`
      SELECT team_name AS "teamName", player_id AS "playerId"
        FROM honour_team_members
       WHERE player_id = ANY(${playerIds})
         AND team_name = ANY(${teamNames})
         AND NOT (id = ANY(${assessedIds}))
    `;
    for (const row of taken) occupiedTeamSlots.add(`${row.teamName}|${row.playerId}`);
  }

  const sourceByKey = new Map(sources.map((s) => [resolutionKey(s.target), s]));
  for (const row of rows) {
    const source = sourceByKey.get(row.key);
    if (!source) continue;
    const playerId = Number(row.playerId);
    const clubs = clubsByPlayer.get(playerId) ?? [];
    const careerGames = row.careerGames === null ? null : Number(row.careerGames);

    // Club rows are derived from the same match data as the career
    // total, so they account for the whole career whenever there is one
    // to account for. Anything else is treated as partial, and a
    // partial history is never allowed to contradict a source.
    const clubGames = clubs.reduce((total, c) => total + (c.games ?? 0), 0);
    const clubHistoryComplete =
      careerGames !== null && careerGames > 0 && clubs.length > 0 && clubGames === careerGames;

    let uniquenessConflict: string | null = null;
    if (source.uniquenessScope.kind === 'honour_team') {
      const { teamName } = source.uniquenessScope;
      if (occupiedTeamSlots.has(`${teamName}|${playerId}`)) {
        uniquenessConflict = `${row.displayName} already holds a place in ${teamName}`;
      }
    }

    byKey.get(row.key)!.push({
      playerId,
      displayName: row.displayName,
      searchName: row.searchName,
      aliasSearchNames: row.aliasSearchNames ?? [],
      nameSimilarity: Number(row.nameSimilarity),
      givenName: row.givenName,
      surname: row.surname,
      debutSeason: row.debutSeason === null ? null : Number(row.debutSeason),
      finalSeason: row.finalSeason === null ? null : Number(row.finalSeason),
      careerGames,
      careerGoals: row.careerGoals === null ? null : Number(row.careerGoals),
      clubs,
      clubHistoryComplete,
      uniquenessConflict,
    });
  }

  // Bound the set per source. Exact and alias matches sort first so the
  // cap can only ever discard fuzzy tail candidates.
  for (const [key, candidates] of byKey) {
    const source = sourceByKey.get(key);
    const exactness = (c: CandidateEvidence) =>
      c.searchName === source?.normalisedName ? 2
        : c.aliasSearchNames.includes(source?.normalisedName ?? '') ? 1 : 0;
    candidates.sort(
      (a, b) =>
        exactness(b) - exactness(a)
        || b.nameSimilarity - a.nameSimilarity
        || a.playerId - b.playerId,
    );
    byKey.set(key, candidates.slice(0, MATCH_POLICY.blocking.maxCandidatesPerSource));
  }

  return byKey;
}

/**
 * Generate, score and assess a batch of source rows.
 *
 * The one entry point every caller uses. The refresh action runs it
 * over the whole queue, the approval path runs it over the single row
 * being approved inside that row's own transaction, and the backtest
 * runs it over confirmed links. Because they share this function they
 * cannot disagree about what a row scores.
 */
export async function assessSources(
  sql: Sql,
  sources: readonly SourceEvidence[],
): Promise<Map<string, MatchAssessment>> {
  const candidates = await fetchCandidateEvidence(sql, sources);
  const assessments = new Map<string, MatchAssessment>();
  for (const source of sources) {
    const key = resolutionKey(source.target);
    const scored = (candidates.get(key) ?? []).map((c) => scoreCandidate(source, c));
    assessments.set(key, assessMatch(scored));
  }
  return assessments;
}

/** The same, for the single row an approval is about to write. */
export async function assessOneSource(
  sql: Sql,
  source: SourceEvidence,
): Promise<MatchAssessment> {
  const assessments = await assessSources(sql, [source]);
  return assessments.get(resolutionKey(source.target))!;
}

// ---------------------------------------------------------------------
// The cache (migration 067)
// ---------------------------------------------------------------------

export type CachedSuggestion = {
  resolutionEntityType: string;
  resolutionEntityId: number;
  targetTable: LinkTargetTable;
  targetId: number;
  rank: number;
  playerId: number;
  /** Joined live, so a renamed player is never shown under a stale name. */
  playerName: string;
  playerSlug: string;
  score: number;
  band: string;
  gap: number | null;
  nearTies: number;
  ambiguous: boolean;
  hardConflict: boolean;
  bulkEligible: boolean;
  evidence: EvidenceItem[];
  conflicts: HardConflict[];
  algorithmVersion: string;
  computedAt: Date;
};

const CACHE_COLUMNS = `
  c.resolution_entity_type AS "resolutionEntityType",
  c.resolution_entity_id   AS "resolutionEntityId",
  c.target_table           AS "targetTable",
  c.target_id              AS "targetId",
  c.rank, c.player_id AS "playerId",
  p.display_name AS "playerName", p.slug AS "playerSlug",
  c.score, c.band, c.gap, c.near_ties AS "nearTies",
  c.ambiguous, c.hard_conflict AS "hardConflict", c.bulk_eligible AS "bulkEligible",
  c.evidence, c.conflicts,
  c.algorithm_version AS "algorithmVersion", c.computed_at AS "computedAt"
`;

/**
 * The top suggestion for every entity that has one.
 *
 * Small enough to read whole -- one row per queue entry -- which is what
 * lets the page filter and order by confidence across the entire queue
 * rather than only within the page being displayed.
 */
export async function readBestSuggestions(
  sql: Sql,
): Promise<Map<string, CachedSuggestion>> {
  const rows = await sql<CachedSuggestion[]>`
    SELECT ${sql.unsafe(CACHE_COLUMNS)}
      FROM player_link_match_candidates c
      JOIN players p ON p.id = c.player_id
     WHERE c.rank = 1
  `;
  const byEntity = new Map<string, CachedSuggestion>();
  for (const row of rows) {
    byEntity.set(`${row.resolutionEntityType}:${row.resolutionEntityId}`, row);
  }
  return byEntity;
}

/** Every ranked candidate for the entities on the page being rendered. */
export async function readSuggestionsForEntities(
  sql: Sql,
  entityIds: readonly number[],
  entityTypes: readonly string[],
): Promise<Map<string, CachedSuggestion[]>> {
  const byEntity = new Map<string, CachedSuggestion[]>();
  if (entityIds.length === 0) return byEntity;
  const rows = await sql<CachedSuggestion[]>`
    SELECT ${sql.unsafe(CACHE_COLUMNS)}
      FROM player_link_match_candidates c
      JOIN players p ON p.id = c.player_id
     WHERE c.resolution_entity_id = ANY(${[...entityIds]})
       AND c.resolution_entity_type = ANY(${[...entityTypes]})
     ORDER BY c.rank
  `;
  for (const row of rows) {
    const key = `${row.resolutionEntityType}:${row.resolutionEntityId}`;
    const list = byEntity.get(key) ?? [];
    list.push(row);
    byEntity.set(key, list);
  }
  return byEntity;
}

export type RefreshResult = {
  entities: number;
  suggestions: number;
  bulkEligible: number;
  algorithmVersion: string;
};

/** How many ranked candidates are kept: the best plus three alternatives. */
const CACHED_RANKS = 4;

/**
 * Regenerate the whole cache.
 *
 * Wholesale rather than incremental. The queue is under two thousand
 * entities, a partial refresh would leave rows scored under two
 * different policies at once, and the version stamp is only meaningful
 * if everything carries the same one. Reads run on the caller's read
 * client and the replacement happens in a single transaction on the
 * write client, so the page never observes a half-empty cache.
 */
export async function refreshMatchCandidates(
  readSql: Sql,
  writeSql: postgres.Sql<Record<string, never>>,
): Promise<RefreshResult> {
  const rows = await fetchSourceEvidence(readSql, { status: 'unresolved' });
  const sources = rows.map((r) => r.source);

  type CacheRow = {
    resolution_entity_type: string;
    resolution_entity_id: number;
    target_table: string;
    target_id: number;
    rank: number;
    player_id: number;
    score: number;
    band: string;
    gap: number | null;
    near_ties: number;
    ambiguous: boolean;
    hard_conflict: boolean;
    bulk_eligible: boolean;
    evidence: string;
    conflicts: string;
    algorithm_version: string;
  };

  const cacheRows: CacheRow[] = [];
  let bulkEligible = 0;
  const BATCH = 250;

  for (let i = 0; i < sources.length; i += BATCH) {
    const batch = sources.slice(i, i + BATCH);
    const assessments = await assessSources(readSql, batch);
    for (const source of batch) {
      const assessment = assessments.get(resolutionKey(source.target));
      if (!assessment?.best) continue;
      if (assessment.bulkEligible) bulkEligible += 1;

      const ranked = [assessment.best, ...assessment.alternatives].slice(0, CACHED_RANKS);
      ranked.forEach((candidate, index) => {
        cacheRows.push({
          resolution_entity_type: source.target.resolutionEntityType,
          resolution_entity_id: source.target.resolutionEntityId,
          target_table: source.target.targetTable,
          target_id: source.target.targetId,
          rank: index + 1,
          player_id: candidate.playerId,
          score: candidate.score,
          // Only the top candidate carries the decision. An alternative
          // is shown for comparison, never approved on its own band.
          band: index === 0 ? assessment.band : 'none',
          gap: index === 0 ? assessment.gap : null,
          near_ties: index === 0 ? assessment.nearTies : 0,
          ambiguous: index === 0 ? assessment.ambiguous : false,
          hard_conflict: candidate.hardConflict,
          bulk_eligible: index === 0 ? assessment.bulkEligible : false,
          evidence: JSON.stringify(candidate.evidence),
          conflicts: JSON.stringify(candidate.conflicts),
          algorithm_version: assessment.algorithmVersion,
        });
      });
    }
  }

  await writeSql.begin(async (tx) => {
    await tx`DELETE FROM player_link_match_candidates`;
    for (let i = 0; i < cacheRows.length; i += 500) {
      const chunk = cacheRows.slice(i, i + 500);
      if (chunk.length > 0) {
        await tx`INSERT INTO player_link_match_candidates ${tx(chunk)}`;
      }
    }
  });

  return {
    entities: sources.length,
    suggestions: cacheRows.length,
    bulkEligible,
    algorithmVersion: ALGORITHM_VERSION,
  };
}
