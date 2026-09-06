import 'server-only';

import { sql } from '@/db/client';

/**
 * Queries backing /clubs/compare (AFLDB-ISSUE-144).
 *
 * Stage 1 covers the head-to-head core: pair scoping, summary, meetings,
 * venues, records and streaks. Stage 2 adds the connected-player
 * (crossover) layer. Stage 3 adds H2H player leaders, the runtime
 * metric-coverage abstraction, authoritative club Brownlow history and
 * its selected-season primitive, and H2H match-vote totals with their
 * coverage. Stage 4 adds the season-generic selected-season layer:
 * canonical season discovery, identity-at-season resolution, the
 * home-and-away record, team metrics with runtime coverage, and season
 * player leaders. Stage 6 adds the extended rivalry analytics layer:
 * head-to-head by decade, period-score rivalry records with pair-level
 * coverage, and coverage-aware H2H player average leaderboards. The
 * route and its presentation are later stages.
 *
 * Identity model, per the approved runbook:
 *
 *   - `matches.home_club_id` / `away_club_id` are historical
 *     identity-at-match grain (`clubs.id`).
 *   - The comparison grain is `club_organizations.id`.
 *   - Every meeting is therefore scoped by joining BOTH match identities
 *     through `clubs.organization_id`. Renames and relocations inside one
 *     organisation (Footscray/Western Bulldogs, South Melbourne/Sydney,
 *     Kangaroos/North Melbourne) combine for free.
 *   - `club_organization_relations` is NEVER traversed to enlarge the
 *     match population: Brisbane Bears, Fitzroy and Brisbane Lions stay
 *     statistically separate even though two of them merged into the
 *     third. Relations are navigation context only.
 *
 * Rendered rows keep the historical identity that actually played, so a
 * 1990 meeting reads "Footscray", not "Western Bulldogs".
 */

// --- Shared pair scoping ---

export type MatchType = 'all' | 'home-and-away' | 'finals';

/** Result of a meeting from organisation A's point of view. */
export type H2HOutcome = 'a-win' | 'b-win' | 'draw';

export const MEETINGS_PAGE_SIZE = 25;

/**
 * A meeting as rendered: identity-at-match names and scores in home/away
 * order, plus the A/B perspective the summary and records aggregate on.
 */
export type H2HMeeting = {
  matchId: number;
  season: number;
  matchDate: Date | null;
  roundCode: string | null;
  roundNumber: number | null;
  roundType: string;
  isFinalsSeries: boolean;
  isGrandFinal: boolean;
  venueId: number | null;
  venueName: string | null;
  homeClubId: number;
  homeClubName: string;
  homeClubSlug: string;
  homeScore: number | null;
  awayClubId: number;
  awayClubName: string;
  awayClubSlug: string;
  awayScore: number | null;
  aScore: number | null;
  bScore: number | null;
  margin: number | null;
  attendance: number | null;
  outcome: H2HOutcome;
};

/**
 * The only place a comparison is rejected. Related-but-distinct
 * organisations (Brisbane Bears vs Brisbane Lions) are a legitimate
 * comparison; an organisation against itself is not, and would report
 * every one of its matches as both a win and a loss.
 */
function assertDistinct(orgA: number, orgB: number): void {
  if (orgA === orgB) {
    throw new Error(`club-comparison: organisation ${orgA} cannot be compared with itself`);
  }
}

/**
 * `finals` is `matches.is_finals_series` and nothing else -- never a
 * round-code string or a display label. Wildcard Finals carry
 * `round_type = 'wildcard_final'` with `is_finals_series = false`, so
 * they stay visible under `all`, count as home-and-away, and are never
 * counted as finals-series meetings. `IS TRUE` / `IS NOT TRUE` keeps the
 * two filters exact complements even if the column is ever null.
 */
function matchTypeFilter(matchType: MatchType) {
  if (matchType === 'finals') return sql`AND m.is_finals_series IS TRUE`;
  if (matchType === 'home-and-away') return sql`AND m.is_finals_series IS NOT TRUE`;
  return sql``;
}

/**
 * THE shared organisation-pair scoping fragment. Every Stage 1 query
 * builds its `meetings` CTE from this and nothing else, so all of them
 * see an identical match population and identical outcome semantics.
 *
 * `era` is a decade's first season (1990 for the 1990s), applied as
 * `[era, era + 10)`. It narrows the SAME population `getHeadToHeadByDecade`
 * already groups by decade -- it is never a second population definition,
 * and callers pass it only where the Club Rivalry Explorer follow-up
 * (FR-2) allows a chosen era to narrow the result: single-match records
 * and the meetings list. The summary, streaks, venues, decade breakdown,
 * player leaders/averages and Brownlow sections stay all-time regardless
 * of any era in the URL.
 */
function h2hScope(orgA: number, orgB: number, matchType: MatchType = 'all', era?: number) {
  return sql`
    SELECT m.id,
           m.season,
           m.match_date,
           m.round_code,
           m.round_number,
           m.round_type::text AS round_type,
           COALESCE(m.is_finals_series, false) AS is_finals_series,
           (m.round_type = 'grand_final') AS is_grand_final,
           m.venue_id,
           m.venue_raw,
           COALESCE(v.canonical_name, m.venue_raw) AS venue_name,
           m.home_club_id, hc.name AS home_club_name, hc.slug AS home_club_slug,
           m.away_club_id, ac.name AS away_club_name, ac.slug AS away_club_slug,
           m.home_score, m.away_score, m.margin, m.attendance,
           CASE WHEN hc.organization_id = ${orgA} THEN m.home_score ELSE m.away_score END AS a_score,
           CASE WHEN hc.organization_id = ${orgA} THEN m.away_score ELSE m.home_score END AS b_score,
           CASE WHEN wc.organization_id = ${orgA} THEN 'a-win'
                WHEN wc.organization_id = ${orgB} THEN 'b-win'
                ELSE 'draw' END AS outcome
      FROM matches m
      JOIN clubs hc ON hc.id = m.home_club_id
      JOIN clubs ac ON ac.id = m.away_club_id
      LEFT JOIN clubs wc ON wc.id = m.winner_club_id
      LEFT JOIN venues v ON v.id = m.venue_id
     WHERE ((hc.organization_id = ${orgA} AND ac.organization_id = ${orgB})
         OR (hc.organization_id = ${orgB} AND ac.organization_id = ${orgA}))
       ${matchTypeFilter(matchType)}
       ${era !== undefined ? sql`AND m.season >= ${era} AND m.season < ${era + 10}` : sql``}
  `;
}

/** The meeting columns, aliased for the wire. Shared by every row-returning query. */
const MEETING_COLUMNS = sql`
  m.id AS "matchId", m.season, m.match_date AS "matchDate",
  m.round_code AS "roundCode", m.round_number AS "roundNumber", m.round_type AS "roundType",
  m.is_finals_series AS "isFinalsSeries", m.is_grand_final AS "isGrandFinal",
  m.venue_id AS "venueId", m.venue_name AS "venueName",
  m.home_club_id AS "homeClubId", m.home_club_name AS "homeClubName", m.home_club_slug AS "homeClubSlug",
  m.home_score AS "homeScore",
  m.away_club_id AS "awayClubId", m.away_club_name AS "awayClubName", m.away_club_slug AS "awayClubSlug",
  m.away_score AS "awayScore",
  m.a_score AS "aScore", m.b_score AS "bScore",
  m.margin, m.attendance, m.outcome
`;

// --- Organisation resolution ---

export type ComparisonOrganization = {
  id: number;
  name: string;
  slug: string;
  firstSeason: number | null;
  lastSeason: number | null;
  isActive: boolean;
};

/**
 * Organisation grain only: `footscray` is a historical identity, not an
 * organisation slug, and deliberately does not resolve here.
 */
export async function getOrganizationBySlug(slug: string): Promise<ComparisonOrganization | null> {
  const [row] = await sql<ComparisonOrganization[]>`
    SELECT id, name, slug,
           first_season AS "firstSeason", last_season AS "lastSeason",
           is_active AS "isActive"
      FROM club_organizations
     WHERE slug = ${slug}
  `;
  return row ?? null;
}

/**
 * Every canonical organisation, ordered for a selector: current
 * organisations first, then historical/defunct ones, alphabetically
 * within each group.
 *
 * Organisation grain only, which is the whole point: `footscray` and
 * `south-melbourne` are historical identities inside a continuing
 * organisation and are deliberately absent, so a selector built from
 * this list cannot offer a club against itself under an older name.
 * Nothing here is filtered by a year or by a hand-kept club list.
 */
export async function getComparisonOrganizations(): Promise<ComparisonOrganization[]> {
  return sql<ComparisonOrganization[]>`
    SELECT id, name, slug,
           first_season AS "firstSeason", last_season AS "lastSeason",
           is_active AS "isActive"
      FROM club_organizations
     ORDER BY is_active DESC, name
  `;
}

// --- Summary ---

export type H2HMeetingRef = {
  matchId: number;
  season: number;
  matchDate: Date | null;
};

export type H2HSummary = {
  meetings: number;
  aWins: number;
  bWins: number;
  draws: number;
  /** 100 x (wins + 0.5 x draws) / meetings. Null when there are no meetings. */
  aWinPercentage: number | null;
  bWinPercentage: number | null;
  firstMeeting: H2HMeetingRef | null;
  latestMeeting: H2HMeetingRef | null;
  finalsSeriesMeetings: number;
  grandFinalMeetings: number;
};

function winPercentage(wins: number, draws: number, meetings: number): number | null {
  if (meetings <= 0) return null;
  return (100 * (wins + 0.5 * draws)) / meetings;
}

/**
 * Aggregates over the whole pair history -- the summary is never filtered
 * by match type, because "41 meetings, two of them finals" is one
 * statement about the rivalry, not a view of it.
 */
export async function getHeadToHeadSummary(orgA: number, orgB: number): Promise<H2HSummary> {
  assertDistinct(orgA, orgB);
  const [row] = await sql<{
    meetings: number; aWins: number; bWins: number; draws: number;
    finalsSeriesMeetings: number; grandFinalMeetings: number;
    firstMatchId: number | null; firstSeason: number | null; firstMatchDate: Date | null;
    latestMatchId: number | null; latestSeason: number | null; latestMatchDate: Date | null;
  }[]>`
    WITH meetings AS (${h2hScope(orgA, orgB)})
    SELECT count(*)::int AS meetings,
           count(*) FILTER (WHERE outcome = 'a-win')::int AS "aWins",
           count(*) FILTER (WHERE outcome = 'b-win')::int AS "bWins",
           count(*) FILTER (WHERE outcome = 'draw')::int AS draws,
           count(*) FILTER (WHERE is_finals_series)::int AS "finalsSeriesMeetings",
           count(*) FILTER (WHERE is_grand_final)::int AS "grandFinalMeetings",
           (SELECT id FROM meetings ORDER BY match_date, season, id LIMIT 1) AS "firstMatchId",
           (SELECT season FROM meetings ORDER BY match_date, season, id LIMIT 1) AS "firstSeason",
           (SELECT match_date FROM meetings ORDER BY match_date, season, id LIMIT 1) AS "firstMatchDate",
           (SELECT id FROM meetings ORDER BY match_date DESC, season DESC, id DESC LIMIT 1) AS "latestMatchId",
           (SELECT season FROM meetings ORDER BY match_date DESC, season DESC, id DESC LIMIT 1) AS "latestSeason",
           (SELECT match_date FROM meetings ORDER BY match_date DESC, season DESC, id DESC LIMIT 1) AS "latestMatchDate"
      FROM meetings
  `;
  return {
    meetings: row.meetings,
    aWins: row.aWins,
    bWins: row.bWins,
    draws: row.draws,
    aWinPercentage: winPercentage(row.aWins, row.draws, row.meetings),
    bWinPercentage: winPercentage(row.bWins, row.draws, row.meetings),
    firstMeeting: row.firstMatchId === null
      ? null
      : { matchId: row.firstMatchId, season: row.firstSeason as number, matchDate: row.firstMatchDate },
    latestMeeting: row.latestMatchId === null
      ? null
      : { matchId: row.latestMatchId, season: row.latestSeason as number, matchDate: row.latestMatchDate },
    finalsSeriesMeetings: row.finalsSeriesMeetings,
    grandFinalMeetings: row.grandFinalMeetings,
  };
}

// --- Complete meetings, filtered and paginated ---

export type MeetingsPage = {
  meetings: H2HMeeting[];
  matchType: MatchType;
  era: number | null;
  page: number;
  pageSize: number;
  totalMeetings: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
};

/**
 * `page` is one-based. Out-of-range pages return no rows but honest
 * pagination metadata -- deciding whether that is a redirect is route
 * behaviour, not query behaviour.
 *
 * `era`, when supplied, is a decade's first season (Club Rivalry Explorer
 * follow-up, FR-2) and narrows the population `h2hScope` already scopes;
 * it is the caller's responsibility to have validated it against the
 * pair's own decade population first.
 */
export async function getHeadToHeadMeetings(
  orgA: number,
  orgB: number,
  options: { matchType?: MatchType; page?: number; era?: number } = {},
): Promise<MeetingsPage> {
  assertDistinct(orgA, orgB);
  const matchType = options.matchType ?? 'all';
  const era = options.era ?? null;
  const page = Math.max(1, Math.trunc(options.page ?? 1));
  const offset = (page - 1) * MEETINGS_PAGE_SIZE;

  const [countRow] = await sql<{ total: number }[]>`
    WITH meetings AS (${h2hScope(orgA, orgB, matchType, era ?? undefined)})
    SELECT count(*)::int AS total FROM meetings
  `;
  const totalMeetings = countRow.total;

  const meetings = await sql<H2HMeeting[]>`
    WITH meetings AS (${h2hScope(orgA, orgB, matchType, era ?? undefined)})
    SELECT ${MEETING_COLUMNS} FROM meetings m
     ORDER BY m.match_date DESC NULLS LAST, m.season DESC, m.id DESC
     LIMIT ${MEETINGS_PAGE_SIZE} OFFSET ${offset}
  `;

  const totalPages = Math.max(1, Math.ceil(totalMeetings / MEETINGS_PAGE_SIZE));
  return {
    meetings: [...meetings],
    matchType,
    era,
    page,
    pageSize: MEETINGS_PAGE_SIZE,
    totalMeetings,
    totalPages,
    hasPreviousPage: page > 1,
    hasNextPage: page < totalPages,
  };
}

// --- Venue records ---

export type H2HVenueRecord = {
  venueId: number | null;
  venueName: string | null;
  meetings: number;
  aWins: number;
  bWins: number;
  draws: number;
  firstMeeting: Date | null;
  latestMeeting: Date | null;
};

/**
 * Grouped by canonical `venue_id`; a meeting with no canonical venue
 * groups only by its exact `venue_raw`. Stage 1 deliberately does not
 * alias unmatched raw names onto canonical venues -- inventing that
 * mapping here would silently merge grounds the venue table has not
 * reconciled.
 */
export async function getHeadToHeadVenueRecords(orgA: number, orgB: number): Promise<H2HVenueRecord[]> {
  assertDistinct(orgA, orgB);
  const rows = await sql<H2HVenueRecord[]>`
    WITH meetings AS (${h2hScope(orgA, orgB)})
    SELECT venue_id AS "venueId",
           min(venue_name) AS "venueName",
           count(*)::int AS meetings,
           count(*) FILTER (WHERE outcome = 'a-win')::int AS "aWins",
           count(*) FILTER (WHERE outcome = 'b-win')::int AS "bWins",
           count(*) FILTER (WHERE outcome = 'draw')::int AS draws,
           min(match_date) AS "firstMeeting",
           max(match_date) AS "latestMeeting"
      FROM meetings
     GROUP BY venue_id, CASE WHEN venue_id IS NULL THEN venue_raw END
     ORDER BY count(*) DESC, min(venue_name), venue_id
  `;
  return [...rows];
}

// --- Records ---

export type H2HRecordKind =
  | 'biggest-win-a'
  | 'biggest-win-b'
  | 'closest-game'
  | 'highest-score-a'
  | 'highest-score-b'
  | 'lowest-score-a'
  | 'lowest-score-b'
  | 'highest-combined-score';

/** A record-holding meeting: the full meeting plus the value it holds. */
export type H2HRecordEntry = H2HMeeting & { value: number };

export type H2HRecords = Record<H2HRecordKind, H2HRecordEntry[]>;

const RECORD_KINDS: H2HRecordKind[] = [
  'biggest-win-a', 'biggest-win-b', 'closest-game',
  'highest-score-a', 'highest-score-b', 'lowest-score-a', 'lowest-score-b',
  'highest-combined-score',
];

/**
 * One pass over the scoped meetings, eight extreme-value branches, every
 * tie kept. Collapsing a tie to one arbitrary row is how "lowest score"
 * quietly loses half its witnesses -- Adelaide's 44 against Brisbane
 * Lions happens twice.
 *
 * `scored` excludes null scores: a match with no recorded score is "not
 * recorded", never a nil-all record.
 *
 * Draws never enter closest-game: a nil margin is not the closest win.
 *
 * `era`, when supplied, is a decade's first season (Club Rivalry Explorer
 * follow-up, FR-2): the eight records are then each held within that one
 * decade of the rivalry rather than across its whole history. The caller
 * is responsible for validating it against the pair's own decade
 * population first -- this function only narrows `h2hScope`.
 */
export async function getHeadToHeadRecords(
  orgA: number,
  orgB: number,
  options: { era?: number } = {},
): Promise<H2HRecords> {
  assertDistinct(orgA, orgB);
  const rows = await sql<(H2HRecordEntry & { kind: H2HRecordKind })[]>`
    WITH meetings AS (${h2hScope(orgA, orgB, 'all', options.era)}),
    scored AS (SELECT * FROM meetings WHERE a_score IS NOT NULL AND b_score IS NOT NULL),
    picks AS (
      SELECT 'biggest-win-a'::text AS kind, id, (a_score - b_score)::int AS value
        FROM scored WHERE a_score > b_score
         AND a_score - b_score = (SELECT max(a_score - b_score) FROM scored WHERE a_score > b_score)
      UNION ALL
      SELECT 'biggest-win-b', id, (b_score - a_score)::int
        FROM scored WHERE b_score > a_score
         AND b_score - a_score = (SELECT max(b_score - a_score) FROM scored WHERE b_score > a_score)
      UNION ALL
      SELECT 'closest-game', id, abs(a_score - b_score)::int
        FROM scored WHERE a_score <> b_score
         AND abs(a_score - b_score) = (SELECT min(abs(a_score - b_score)) FROM scored WHERE a_score <> b_score)
      UNION ALL
      SELECT 'highest-score-a', id, a_score::int
        FROM scored WHERE a_score = (SELECT max(a_score) FROM scored)
      UNION ALL
      SELECT 'highest-score-b', id, b_score::int
        FROM scored WHERE b_score = (SELECT max(b_score) FROM scored)
      UNION ALL
      SELECT 'lowest-score-a', id, a_score::int
        FROM scored WHERE a_score = (SELECT min(a_score) FROM scored)
      UNION ALL
      SELECT 'lowest-score-b', id, b_score::int
        FROM scored WHERE b_score = (SELECT min(b_score) FROM scored)
      UNION ALL
      SELECT 'highest-combined-score', id, (a_score + b_score)::int
        FROM scored WHERE a_score + b_score = (SELECT max(a_score + b_score) FROM scored)
    )
    SELECT p.kind, p.value, ${MEETING_COLUMNS}
      FROM picks p JOIN meetings m ON m.id = p.id
     ORDER BY p.kind, m.match_date, m.season, m.id
  `;

  const records = Object.fromEntries(RECORD_KINDS.map((kind) => [kind, [] as H2HRecordEntry[]])) as H2HRecords;
  for (const row of rows) {
    const { kind, ...entry } = row;
    records[kind].push(entry);
  }
  return records;
}

// --- Streaks ---

export type H2HStreak = {
  outcome: H2HOutcome;
  length: number;
  fromMatchId: number;
  fromSeason: number;
  fromMatchDate: Date | null;
  toMatchId: number;
  toSeason: number;
  toMatchDate: Date | null;
};

export type H2HStreaks = {
  /** Longest run of consecutive A wins. A draw breaks it. */
  longestA: H2HStreak | null;
  longestB: H2HStreak | null;
  /** Consecutive identical results counted back from the latest meeting; may be a draw. */
  current: H2HStreak | null;
};

type StreakRow = { matchId: number; season: number; matchDate: Date | null; outcome: H2HOutcome };

/**
 * Runs are derived from the meetings in true chronological order
 * (`match_date`, `season`, `id`) -- never from the presentation order the
 * paginated meetings list uses, which is the reverse and page-bounded.
 *
 * Where two runs of an organisation tie for longest, the earlier one is
 * returned, so the answer is stable between requests.
 */
export async function getHeadToHeadStreaks(orgA: number, orgB: number): Promise<H2HStreaks> {
  assertDistinct(orgA, orgB);
  const rows = await sql<StreakRow[]>`
    WITH meetings AS (${h2hScope(orgA, orgB)})
    SELECT id AS "matchId", season, match_date AS "matchDate", outcome
      FROM meetings
     ORDER BY match_date, season, id
  `;

  const runs: H2HStreak[] = [];
  for (const row of rows) {
    const open = runs[runs.length - 1];
    if (open && open.outcome === row.outcome) {
      open.length += 1;
      open.toMatchId = row.matchId;
      open.toSeason = row.season;
      open.toMatchDate = row.matchDate;
      continue;
    }
    runs.push({
      outcome: row.outcome,
      length: 1,
      fromMatchId: row.matchId,
      fromSeason: row.season,
      fromMatchDate: row.matchDate,
      toMatchId: row.matchId,
      toSeason: row.season,
      toMatchDate: row.matchDate,
    });
  }

  const longest = (outcome: H2HOutcome): H2HStreak | null => {
    let best: H2HStreak | null = null;
    for (const run of runs) {
      if (run.outcome === outcome && (best === null || run.length > best.length)) best = run;
    }
    return best;
  };

  return {
    longestA: longest('a-win'),
    longestB: longest('b-win'),
    current: runs.length > 0 ? runs[runs.length - 1] : null,
  };
}

// --- Connected (crossover) players ---

/**
 * Which target organisation the player represented FIRST. This is a
 * statement about chronology and nothing else: `a-to-b` means A's first
 * recorded appearance precedes B's, not that the player was traded,
 * delisted, drafted or transferred between them. A player may have
 * played elsewhere in between, may have returned, and may have reached
 * the second organisation by any route at all.
 *
 * `unknown` covers both "the two first appearances cannot be ordered"
 * and the (schema-possible) case of an unresolvable match reference on
 * either side.
 */
export type CrossoverDirection = 'a-to-b' | 'b-to-a' | 'unknown';

/** A third organisation represented between the two target debuts. */
export type CrossoverOrganizationRef = {
  organizationId: number;
  name: string;
  slug: string;
};

/**
 * One organisation's share of a crossover player's career, summed across
 * every historical identity inside that organisation. Brad Johnson's
 * 52 Footscray games and 312 Western Bulldogs games are ONE
 * representation of 364, not two.
 */
export type CrossoverRepresentation = {
  games: number;
  goals: number;
  firstMatchId: number | null;
  firstMatchDate: Date | null;
  lastMatchId: number | null;
  lastMatchDate: Date | null;
};

export type CrossoverPlayer = {
  playerId: number;
  displayName: string;
  sortName: string;
  slug: string;
  a: CrossoverRepresentation;
  b: CrossoverRepresentation;
  combinedGames: number;
  combinedGoals: number;
  /** From player_career_stats; null when the player has no derived row. */
  careerGames: number | null;
  careerGoals: number | null;
  direction: CrossoverDirection;
  /**
   * The date on which the player had represented BOTH organisations --
   * the later of the two first-representation dates. Never the career
   * debut, and never the start of the first stint.
   */
  completionDate: Date | null;
  completionMatchId: number | null;
  interveningOrganizations: CrossoverOrganizationRef[];
};

type CrossoverRow = {
  playerId: number;
  displayName: string;
  sortName: string;
  slug: string;
  aGames: number; aGoals: number;
  aFirstMatchId: number | null; aFirstMatchDate: Date | null;
  aLastMatchId: number | null; aLastMatchDate: Date | null;
  bGames: number; bGoals: number;
  bFirstMatchId: number | null; bFirstMatchDate: Date | null;
  bLastMatchId: number | null; bLastMatchDate: Date | null;
  combinedGames: number;
  combinedGoals: number;
  careerGames: number | null;
  careerGoals: number | null;
  direction: CrossoverDirection;
  completionDate: Date | null;
  completionMatchId: number | null;
  interveningOrganizations: CrossoverOrganizationRef[] | null;
};

/**
 * THE shared crossover scoping fragment. Both exported crossover
 * functions select from this and differ only in ORDER BY, so the list
 * and the summary can never disagree about who crossed over or when.
 *
 * Shape, in order:
 *
 *   - `stints`   -- player_clubs at its native (player, club identity)
 *                   grain, with each stint's first and last match
 *                   dereferenced. Chronology comes from the referenced
 *                   match row, NEVER from the numeric match id alone;
 *                   the id is only the deterministic tie-breaker for two
 *                   matches on the same date.
 *   - `org_rep`  -- the same stints re-aggregated through
 *                   clubs.organization_id: games and goals summed, first
 *                   representation the earliest stint debut, last
 *                   representation the latest stint finale. This is the
 *                   step that stops a rename becoming a second club.
 *   - `pairs`    -- an inner self-join on player_id requiring a row for
 *                   BOTH target organisations. `club_organization_relations`
 *                   is never consulted, so Fitzroy to Brisbane Lions is a
 *                   genuine crossover and Footscray to Western Bulldogs
 *                   is not a crossover at all.
 *
 * (The evidence pack's probe failed because it named a CTE `both`, which
 * is a reserved word. Nothing here is called `both`.)
 */
function crossoverScope(orgA: number, orgB: number) {
  return sql`
    WITH crossover_players AS (
      -- Stage 5 performance: the players who can possibly appear at all.
      -- pairs below already requires an org_rep row for BOTH target
      -- organisations, which requires a player_clubs row in a club of
      -- each, so scoping the stints to these players removes no row the
      -- query could have returned -- including from the intervening
      -- organisations subquery, which is correlated to one of them.
      -- Without it the whole 16,710-row player_clubs table was
      -- re-aggregated and then rescanned once per crossover player.
      SELECT pc.player_id
        FROM player_clubs pc
        JOIN clubs c ON c.id = pc.club_id
       WHERE c.organization_id IN (${orgA}, ${orgB})
       GROUP BY pc.player_id
      HAVING count(DISTINCT c.organization_id) = 2
    ),
    stints AS (
      SELECT pc.player_id,
             c.organization_id AS org_id,
             pc.games,
             pc.goals,
             fm.id AS first_match_id, fm.match_date AS first_match_date,
             lm.id AS last_match_id, lm.match_date AS last_match_date
        FROM player_clubs pc
        JOIN crossover_players xp ON xp.player_id = pc.player_id
        JOIN clubs c ON c.id = pc.club_id
        LEFT JOIN matches fm ON fm.id = pc.first_match_id
        LEFT JOIN matches lm ON lm.id = pc.last_match_id
    ),
    org_totals AS (
      SELECT player_id, org_id,
             sum(games)::int AS games,
             sum(goals)::int AS goals
        FROM stints
       GROUP BY player_id, org_id
    ),
    org_first AS (
      SELECT DISTINCT ON (player_id, org_id)
             player_id, org_id, first_match_id, first_match_date
        FROM stints
       WHERE first_match_id IS NOT NULL
       ORDER BY player_id, org_id, first_match_date NULLS LAST, first_match_id
    ),
    org_last AS (
      SELECT DISTINCT ON (player_id, org_id)
             player_id, org_id, last_match_id, last_match_date
        FROM stints
       WHERE last_match_id IS NOT NULL
       ORDER BY player_id, org_id, last_match_date DESC NULLS LAST, last_match_id DESC
    ),
    org_rep AS (
      SELECT t.player_id, t.org_id, t.games, t.goals,
             f.first_match_id, f.first_match_date,
             l.last_match_id, l.last_match_date
        FROM org_totals t
        LEFT JOIN org_first f ON f.player_id = t.player_id AND f.org_id = t.org_id
        LEFT JOIN org_last  l ON l.player_id = t.player_id AND l.org_id = t.org_id
    ),
    pairs AS (
      SELECT a.player_id,
             a.games AS a_games, a.goals AS a_goals,
             a.first_match_id AS a_first_match_id, a.first_match_date AS a_first_match_date,
             a.last_match_id  AS a_last_match_id,  a.last_match_date  AS a_last_match_date,
             b.games AS b_games, b.goals AS b_goals,
             b.first_match_id AS b_first_match_id, b.first_match_date AS b_first_match_date,
             b.last_match_id  AS b_last_match_id,  b.last_match_date  AS b_last_match_date,
             CASE
               WHEN a.first_match_date IS NULL OR b.first_match_date IS NULL THEN 'unknown'
               WHEN (a.first_match_date, a.first_match_id) < (b.first_match_date, b.first_match_id) THEN 'a-to-b'
               WHEN (b.first_match_date, b.first_match_id) < (a.first_match_date, a.first_match_id) THEN 'b-to-a'
               ELSE 'unknown'
             END AS direction,
             -- The EARLIER debut opens the intervening interval; the
             -- LATER one closes it and IS the crossover completion.
             LEAST(a.first_match_date, b.first_match_date) AS earlier_date,
             CASE WHEN (a.first_match_date, a.first_match_id) < (b.first_match_date, b.first_match_id)
                  THEN a.first_match_id ELSE b.first_match_id END AS earlier_match_id,
             GREATEST(a.first_match_date, b.first_match_date) AS later_date,
             CASE WHEN (a.first_match_date, a.first_match_id) < (b.first_match_date, b.first_match_id)
                  THEN b.first_match_id ELSE a.first_match_id END AS later_match_id
        FROM org_rep a
        JOIN org_rep b ON b.player_id = a.player_id AND b.org_id = ${orgB}
       WHERE a.org_id = ${orgA}
    )
    SELECT p.player_id AS "playerId",
           pl.display_name AS "displayName",
           pl.sort_name AS "sortName",
           pl.slug,
           p.a_games AS "aGames", p.a_goals AS "aGoals",
           p.a_first_match_id AS "aFirstMatchId", p.a_first_match_date AS "aFirstMatchDate",
           p.a_last_match_id  AS "aLastMatchId",  p.a_last_match_date  AS "aLastMatchDate",
           p.b_games AS "bGames", p.b_goals AS "bGoals",
           p.b_first_match_id AS "bFirstMatchId", p.b_first_match_date AS "bFirstMatchDate",
           p.b_last_match_id  AS "bLastMatchId",  p.b_last_match_date  AS "bLastMatchDate",
           (p.a_games + p.b_games) AS "combinedGames",
           (p.a_goals + p.b_goals) AS "combinedGoals",
           pcs.games AS "careerGames",
           pcs.goals AS "careerGoals",
           p.direction,
           p.later_date AS "completionDate",
           p.later_match_id AS "completionMatchId",
           (
             SELECT jsonb_agg(
                      jsonb_build_object('organizationId', x."organizationId",
                                         'name', x.name,
                                         'slug', x.slug)
                      ORDER BY x.first_match_date, x.first_match_id)
               FROM (
                 SELECT o.id AS "organizationId", o.name, o.slug,
                        r.first_match_date, r.first_match_id
                   FROM org_rep r
                   JOIN club_organizations o ON o.id = r.org_id
                  WHERE r.player_id = p.player_id
                    AND r.org_id NOT IN (${orgA}, ${orgB})
                    AND r.first_match_date IS NOT NULL
                    AND p.earlier_date IS NOT NULL
                    AND p.later_date IS NOT NULL
                    AND (r.first_match_date, r.first_match_id) > (p.earlier_date, p.earlier_match_id)
                    AND (r.first_match_date, r.first_match_id) < (p.later_date, p.later_match_id)
               ) x
           ) AS "interveningOrganizations"
      FROM pairs p
      JOIN players pl ON pl.id = p.player_id
      LEFT JOIN player_career_stats pcs ON pcs.player_id = p.player_id
  `;
}

function toCrossoverPlayer(row: CrossoverRow): CrossoverPlayer {
  return {
    playerId: row.playerId,
    displayName: row.displayName,
    sortName: row.sortName,
    slug: row.slug,
    a: {
      games: row.aGames, goals: row.aGoals,
      firstMatchId: row.aFirstMatchId, firstMatchDate: row.aFirstMatchDate,
      lastMatchId: row.aLastMatchId, lastMatchDate: row.aLastMatchDate,
    },
    b: {
      games: row.bGames, goals: row.bGoals,
      firstMatchId: row.bFirstMatchId, firstMatchDate: row.bFirstMatchDate,
      lastMatchId: row.bLastMatchId, lastMatchDate: row.bLastMatchDate,
    },
    combinedGames: row.combinedGames,
    combinedGoals: row.combinedGoals,
    careerGames: row.careerGames,
    careerGoals: row.careerGoals,
    direction: row.direction,
    completionDate: row.completionDate,
    completionMatchId: row.completionMatchId,
    interveningOrganizations: row.interveningOrganizations ?? [],
  };
}

/**
 * Every player who represented both selected organisations, sorted by
 * combined games for those two organisations, then sort name, then
 * player id -- so the list is stable and a derived-data rebuild cannot
 * reshuffle it.
 */
export async function getCrossoverPlayers(orgA: number, orgB: number): Promise<CrossoverPlayer[]> {
  assertDistinct(orgA, orgB);
  const rows = await sql<CrossoverRow[]>`
    SELECT * FROM (${crossoverScope(orgA, orgB)}) c
     ORDER BY c."combinedGames" DESC, c."sortName", c."playerId"
  `;
  return rows.map(toCrossoverPlayer);
}

export type CrossoverSummary = {
  players: number;
  /**
   * Earliest and latest COMPLETION -- the day each player had appeared
   * for both organisations. Arrays, because a completion date can be
   * shared and dropping a tied player would be a silent edit of the
   * record.
   */
  firstToRepresentBoth: CrossoverPlayer[];
  mostRecentToRepresentBoth: CrossoverPlayer[];
};

/**
 * Head and tail of the crossover history by completion date. A player
 * whose completion date is unknown is counted in `players` but cannot
 * hold either record, because an unknown date is not an early one.
 */
export async function getCrossoverSummary(orgA: number, orgB: number): Promise<CrossoverSummary> {
  assertDistinct(orgA, orgB);
  const rows = await sql<CrossoverRow[]>`
    SELECT * FROM (${crossoverScope(orgA, orgB)}) c
     ORDER BY c."completionDate" NULLS LAST, c."completionMatchId", c."playerId"
  `;
  const players = rows.map(toCrossoverPlayer);
  const dated = players.filter((p) => p.completionDate !== null);
  const tiedWith = (at: CrossoverPlayer) =>
    dated.filter((p) => (p.completionDate as Date).getTime() === (at.completionDate as Date).getTime());

  return {
    players: players.length,
    firstToRepresentBoth: dated.length === 0 ? [] : tiedWith(dated[0]),
    mostRecentToRepresentBoth: dated.length === 0 ? [] : tiedWith(dated[dated.length - 1]),
  };
}

// --- H2H player leaders ---

/**
 * Dense-rank cut for every H2H leaderboard. Ties at the cut are all
 * retained, so a board may return more than ten rows.
 */
export const H2H_LEADER_RANK_LIMIT = 10;

/**
 * One organisation's share of a player's H2H record. `goals` is NULL when
 * the player has no meeting in which goals were recorded at all -- a
 * historical gap is never reported as nought. `goalsRecordedGames` is the
 * honest denominator behind `goals`.
 */
export type H2HLeaderRepresentation = {
  games: number;
  goals: number | null;
  goalsRecordedGames: number;
};

/**
 * A player on an H2H leaderboard. A player who represented BOTH selected
 * organisations in this rivalry -- Charlie Cameron has appeared for
 * Adelaide and for Brisbane Lions in Adelaide vs Brisbane Lions matches --
 * is ONE row with two organisation breakdowns, never two ambiguous rows.
 */
export type H2HPlayerLeader = {
  /** Dense rank, 1-based, ties sharing a rank. */
  rank: number;
  playerId: number;
  displayName: string;
  sortName: string;
  slug: string;
  games: number;
  goals: number | null;
  goalsRecordedGames: number;
  a: H2HLeaderRepresentation;
  b: H2HLeaderRepresentation;
};

/** One holder of a single-match H2H record, with the meeting it was set in. */
export type H2HStatRecordHolder = {
  playerId: number;
  displayName: string;
  sortName: string;
  slug: string;
  value: number;
  matchId: number;
  season: number;
  matchDate: Date | null;
  /** The identity the player actually represented on the day. */
  clubId: number;
  clubName: string;
  clubSlug: string;
  organizationId: number;
};

/**
 * A single-match statistical record over the rivalry. `value` is null and
 * `holders` empty when the statistic was never recorded in ANY meeting of
 * the pair -- which is a coverage statement, not a record of nought.
 */
export type H2HStatRecord = {
  stat: 'goals' | 'disposals';
  /** Player-match rows in the pair in which the statistic is recorded. */
  recordedRows: number;
  value: number | null;
  holders: H2HStatRecordHolder[];
};

export type H2HPlayerLeaders = {
  games: H2HPlayerLeader[];
  goals: H2HPlayerLeader[];
  singleMatchGoals: H2HStatRecord;
  singleMatchDisposals: H2HStatRecord;
};

type H2HLeaderRow = {
  rank: number;
  playerId: number;
  displayName: string;
  sortName: string;
  slug: string;
  games: number;
  goals: number | null;
  goalsRecordedGames: number;
  aGames: number;
  aGoals: number | null;
  aGoalsRecordedGames: number;
  bGames: number;
  bGoals: number | null;
  bGoalsRecordedGames: number;
};

function toLeader(row: H2HLeaderRow): H2HPlayerLeader {
  return {
    rank: row.rank,
    playerId: row.playerId,
    displayName: row.displayName,
    sortName: row.sortName,
    slug: row.slug,
    games: row.games,
    goals: row.goalsRecordedGames > 0 ? row.goals : null,
    goalsRecordedGames: row.goalsRecordedGames,
    a: {
      games: row.aGames,
      goals: row.aGoalsRecordedGames > 0 ? row.aGoals : null,
      goalsRecordedGames: row.aGoalsRecordedGames,
    },
    b: {
      games: row.bGames,
      goals: row.bGoalsRecordedGames > 0 ? row.bGoals : null,
      goalsRecordedGames: row.bGoalsRecordedGames,
    },
  };
}

/**
 * Per-player H2H aggregate over the COMPLETE scoped meeting population --
 * finals included, no historical cutoff. Appearances are counted from
 * `player_match_stats` rows (a row is an appearance whether or not any
 * statistic was recorded) and attributed through the historical
 * `player_match_stats.club_id` to `clubs.organization_id`, so a Footscray
 * appearance lands on Western Bulldogs without becoming a second row.
 */
function h2hPlayerTotals(orgA: number, orgB: number) {
  return sql`
    WITH meetings AS (${h2hScope(orgA, orgB)}),
    appearances AS (
      SELECT pms.player_id,
             pms.goals,
             (c.organization_id = ${orgA}) AS is_a
        FROM player_match_stats pms
        JOIN meetings mt ON mt.id = pms.match_id
        JOIN clubs c ON c.id = pms.club_id
       WHERE c.organization_id IN (${orgA}, ${orgB})
    )
    SELECT ap.player_id,
           count(*)::int AS games,
           sum(ap.goals)::int AS goals,
           count(ap.goals)::int AS goals_recorded_games,
           count(*) FILTER (WHERE ap.is_a)::int AS a_games,
           sum(ap.goals) FILTER (WHERE ap.is_a)::int AS a_goals,
           count(ap.goals) FILTER (WHERE ap.is_a)::int AS a_goals_recorded_games,
           count(*) FILTER (WHERE NOT ap.is_a)::int AS b_games,
           sum(ap.goals) FILTER (WHERE NOT ap.is_a)::int AS b_goals,
           count(ap.goals) FILTER (WHERE NOT ap.is_a)::int AS b_goals_recorded_games
      FROM appearances ap
     GROUP BY ap.player_id
  `;
}

const H2H_LEADER_COLUMNS = sql`
  t.player_id AS "playerId",
  p.display_name AS "displayName", p.sort_name AS "sortName", p.slug,
  t.games, t.goals, t.goals_recorded_games AS "goalsRecordedGames",
  t.a_games AS "aGames", t.a_goals AS "aGoals",
  t.a_goals_recorded_games AS "aGoalsRecordedGames",
  t.b_games AS "bGames", t.b_goals AS "bGoals",
  t.b_goals_recorded_games AS "bGoalsRecordedGames"
`;

/**
 * A single-match record over the rivalry. Only rows where the statistic
 * is actually recorded are considered: NULL is "not recorded", never
 * nought, so a meeting with no disposal data can neither hold nor dilute
 * a disposals record. Every tied holder is returned, ordered by meeting
 * date then match id then player, so the list is stable.
 */
async function h2hStatRecord(
  orgA: number,
  orgB: number,
  stat: 'goals' | 'disposals',
): Promise<H2HStatRecord> {
  const column = stat === 'goals' ? sql`pms.goals` : sql`pms.disposals`;
  const rows = await sql<(H2HStatRecordHolder & { recordedRows: number })[]>`
    WITH meetings AS (${h2hScope(orgA, orgB)}),
    recorded AS (
      SELECT pms.player_id, ${column} AS value,
             mt.id AS match_id, mt.season, mt.match_date,
             c.id AS club_id, c.name AS club_name, c.slug AS club_slug,
             c.organization_id
        FROM player_match_stats pms
        JOIN meetings mt ON mt.id = pms.match_id
        JOIN clubs c ON c.id = pms.club_id
       WHERE c.organization_id IN (${orgA}, ${orgB})
         AND ${column} IS NOT NULL
    )
    SELECT r.player_id AS "playerId",
           p.display_name AS "displayName", p.sort_name AS "sortName", p.slug,
           r.value, r.match_id AS "matchId", r.season, r.match_date AS "matchDate",
           r.club_id AS "clubId", r.club_name AS "clubName", r.club_slug AS "clubSlug",
           r.organization_id AS "organizationId",
           (SELECT count(*)::int FROM recorded) AS "recordedRows"
      FROM recorded r
      JOIN players p ON p.id = r.player_id
     WHERE r.value = (SELECT max(value) FROM recorded)
     ORDER BY r.match_date, r.match_id, p.sort_name, r.player_id
  `;
  if (rows.length === 0) {
    return { stat, recordedRows: 0, value: null, holders: [] };
  }
  const { recordedRows } = rows[0];
  return {
    stat,
    recordedRows,
    value: rows[0].value,
    holders: rows.map(({ recordedRows: _ignored, ...holder }) => holder),
  };
}

/**
 * The V1 H2H player-record families: most meetings played, most goals
 * kicked, and the single-match goals and disposals records. Per-game
 * averages are deliberately NOT in V1.
 */
export async function getHeadToHeadPlayerLeaders(
  orgA: number,
  orgB: number,
): Promise<H2HPlayerLeaders> {
  assertDistinct(orgA, orgB);
  const [gamesRows, goalsRows, singleMatchGoals, singleMatchDisposals] = await Promise.all([
    sql<H2HLeaderRow[]>`
      WITH totals AS (${h2hPlayerTotals(orgA, orgB)}),
      ranked AS (
        SELECT t.*, dense_rank() OVER (ORDER BY t.games DESC) AS rank FROM totals t
      )
      SELECT t.rank::int AS rank, ${H2H_LEADER_COLUMNS}
        FROM ranked t
        JOIN players p ON p.id = t.player_id
       WHERE t.rank <= ${H2H_LEADER_RANK_LIMIT}
       ORDER BY t.rank, p.sort_name, t.player_id
    `,
    sql<H2HLeaderRow[]>`
      WITH totals AS (${h2hPlayerTotals(orgA, orgB)}),
      scored AS (
        SELECT * FROM totals WHERE goals_recorded_games > 0 AND goals IS NOT NULL
      ),
      ranked AS (
        SELECT s.*, dense_rank() OVER (ORDER BY s.goals DESC) AS rank FROM scored s
      )
      SELECT t.rank::int AS rank, ${H2H_LEADER_COLUMNS}
        FROM ranked t
        JOIN players p ON p.id = t.player_id
       WHERE t.rank <= ${H2H_LEADER_RANK_LIMIT}
       ORDER BY t.rank, p.sort_name, t.player_id
    `,
    h2hStatRecord(orgA, orgB, 'goals'),
    h2hStatRecord(orgA, orgB, 'disposals'),
  ]);

  return {
    games: gamesRows.map(toLeader),
    goals: goalsRows.map(toLeader),
    singleMatchGoals,
    singleMatchDisposals,
  };
}

// --- Runtime metric coverage ---

/**
 * `stat_availability.coverage` as the application must read it, plus the
 * one state the table cannot express: `missing`, meaning there is no
 * coverage row at all for that statistic and season. Missing coverage is
 * never optimistically treated as `complete`.
 */
export type MetricCoverage =
  | 'complete'
  | 'partial'
  | 'pending'
  | 'not_collected'
  | 'not_applicable'
  | 'missing';

/**
 * THE runtime metric-coverage abstraction. Every coverage decision in
 * this module joins through here, and nothing anywhere encodes a year
 * window: when a reload turns 2026 from `pending` into `complete`, the
 * next request presents numeric data with no code change at all.
 *
 * One key or many. The many-key form is the same shape plus a
 * `stat_key` column, so the selected-season team metrics read all
 * twenty-one families through this one abstraction instead of a second
 * coverage model. The seasons/keys cross product is LEFT JOINed, so a
 * season with no `stat_availability` row still yields a row reading
 * `missing`; absent coverage is never optimistically `complete`.
 */
function statCoverage(statKeys: string | string[]) {
  const keys = Array.isArray(statKeys) ? statKeys : [statKeys];
  return sql`
    SELECT s.year AS season,
           k.stat_key,
           COALESCE(sa.coverage::text, 'missing') AS coverage,
           COALESCE(sa.is_recorded, false) AS is_recorded,
           sa.populated_rows,
           sa.total_rows
      FROM seasons s
      CROSS JOIN unnest(${keys}::text[]) AS k(stat_key)
      LEFT JOIN stat_availability sa
        ON sa.stat_key = k.stat_key AND sa.season = s.year
  `;
}

/** Coverage keys this module reads. Never a bare 'brownlow'; that key is gone. */
const BROWNLOW_SEASON_TOTAL = 'brownlow_season_total';
const BROWNLOW_MATCH_VOTES = 'brownlow_match_votes';

/**
 * Only `complete` permits presenting an authoritative season total.
 * `partial` explicitly does NOT: a partly-loaded season would read as a
 * smaller season, which is worse than saying nothing.
 */
export function isAuthoritativeCoverage(coverage: MetricCoverage): boolean {
  return coverage === 'complete';
}

// --- Brownlow: club attribution ---

/**
 * Dense-rank cut for club Brownlow leaderboards. Ties at the cut are all
 * retained, so a board may return more than ten rows.
 */
export const CLUB_BROWNLOW_LEADER_RANK_LIMIT = 10;


/**
 * How a season vote row reached a club.
 *
 *   - `explicit`  -- `brownlow_season_votes.club_id` was populated.
 *   - `primary`   -- `club_id` was NULL and the player played for exactly
 *                    one club that season (`player_season_stats.club_count
 *                    = 1`), so `primary_club_id` is not a guess.
 *   - `unattributed` -- `club_id` was NULL in a multi-club season, or the
 *                    player has no season row at all. The votes are real
 *                    and are NEVER forced onto a club; they are counted
 *                    and disclosed instead.
 */
export type BrownlowAttributionSource = 'explicit' | 'primary' | 'unattributed';

/**
 * THE Brownlow attribution fragment. Every club/organisation Brownlow
 * figure in this module -- all-time history, all-time vote leaders and
 * the selected-season summary -- selects from this and nothing else, so
 * Stage 4's selected-season Brownlow cannot drift from the all-time
 * history it is supposed to be a slice of.
 *
 * `brownlow_season_votes` is authoritative: season totals, winners and
 * eligibility come from here and are NEVER re-derived by summing
 * `player_match_stats.brownlow_votes`.
 *
 * `brownlow_season_votes.club_id` is NULLABLE (in the canonical test
 * database it is null on every one of the 16,120 rows), so it is
 * COALESCEd, never inner-joined. The supplied evidence probe returned
 * zero rows precisely because it inner-joined it.
 */
function brownlowAttribution() {
  return sql`
    SELECT b.season,
           b.player_id,
           b.votes::int AS votes,
           b.vote_rank,
           b.is_winner,
           b.is_ineligible,
           b.three_vote_games,
           b.two_vote_games,
           b.one_vote_games,
           b.polling_games,
           COALESCE(
             b.club_id,
             CASE WHEN pss.club_count = 1 THEN pss.primary_club_id END
           ) AS attributed_club_id,
           CASE
             WHEN b.club_id IS NOT NULL THEN 'explicit'
             WHEN pss.club_count = 1 AND pss.primary_club_id IS NOT NULL THEN 'primary'
             ELSE 'unattributed'
           END AS attribution_source,
           pss.club_count,
           pss.primary_club_id AS season_primary_club_id
      FROM brownlow_season_votes b
      LEFT JOIN player_season_stats pss
        ON pss.player_id = b.player_id AND pss.season = b.season
  `;
}

/**
 * Attribution resolved to the organisation grain, with the season-total
 * coverage state attached. Nothing is filtered here: callers decide what
 * `complete` means for them.
 */
function brownlowOrganizationRows() {
  return sql`
    SELECT a.*,
           c.organization_id,
           cov.coverage AS season_total_coverage,
           -- The organisation an UNATTRIBUTED row is merely associated
           -- with, for disclosure. Its votes are never added to a club.
           po.organization_id AS primary_organization_id
      FROM (${brownlowAttribution()}) a
      LEFT JOIN clubs c ON c.id = a.attributed_club_id
      LEFT JOIN clubs po ON po.id = a.season_primary_club_id
      LEFT JOIN (${statCoverage(BROWNLOW_SEASON_TOTAL)}) cov ON cov.season = a.season
  `;
}

export type ClubBrownlowWinner = {
  season: number;
  playerId: number;
  displayName: string;
  slug: string;
  votes: number;
  isIneligible: boolean;
};

export type ClubBrownlowSeason = {
  season: number;
  votes: number;
  playersWithVotes: number;
  winners: number;
  ineligiblePlayers: number;
  /** Real vote rows in this season that could not be attributed to a club. */
  unattributedRows: number;
  unattributedVotes: number;
};

export type ClubBrownlowLeader = {
  /** Dense rank, 1-based, ties sharing a rank. */
  rank: number;
  playerId: number;
  displayName: string;
  sortName: string;
  slug: string;
  votes: number;
  seasons: number;
  winners: number;
  /** True when at least one of the player's seasons here was ineligible. */
  hasIneligibleSeason: boolean;
};

export type ClubBrownlowHistory = {
  organizationId: number;
  /** Ascending. Only seasons whose brownlow_season_total coverage is complete. */
  seasons: ClubBrownlowSeason[];
  totalVotes: number;
  seasonsCovered: number;
  winners: ClubBrownlowWinner[];
  voteLeaders: ClubBrownlowLeader[];
  /**
   * Multi-club seasons whose votes belong to a player associated with
   * this organisation but which cannot honestly be attributed to it.
   * Disclosed, never added to `totalVotes`.
   */
  unattributed: { rows: number; votes: number };
  /**
   * Seasons in which this organisation has vote rows but whose season-total
   * coverage is not complete, and which are therefore excluded from every
   * figure above.
   */
  excludedSeasons: { season: number; coverage: MetricCoverage }[];
};

/**
 * All-time club Brownlow history at the organisation grain.
 *
 * Only seasons whose runtime `brownlow_season_total` coverage is
 * `complete` contribute. Winners come from `is_winner` alone -- never
 * from vote rank, never from "most votes" -- and ineligibility is
 * preserved rather than filtered away.
 */
export async function getClubBrownlowHistory(
  organizationId: number,
): Promise<ClubBrownlowHistory> {
  /**
   * THE attribution fragment, scoped to the only rows this organisation
   * can appear in: those attributed to it, and the unattributed rows
   * merely associated with it through the season primary club. Every
   * statement below already requires one of those two predicates, so
   * this is a filter push-down and not a change of meaning.
   *
   * Stage 5 performance: without it each statement re-attributed and
   * re-aggregated all 16,120 vote rows, which put the warm median for a
   * long-history organisation on the 250 ms ceiling.
   */
  const scoped = sql`
    SELECT r.* FROM (${brownlowOrganizationRows()}) r
     WHERE r.organization_id = ${organizationId}
        OR r.primary_organization_id = ${organizationId}
  `;

  const [
    seasons, winners, voteLeaders, [totals], excludedSeasons, unattributedBySeason,
  ] = await Promise.all([
    sql<ClubBrownlowSeason[]>`
      WITH attributed AS (${scoped})
      SELECT r.season,
             sum(r.votes)::int AS votes,
             count(*) FILTER (WHERE r.votes > 0)::int AS "playersWithVotes",
             count(*) FILTER (WHERE r.is_winner)::int AS winners,
             count(*) FILTER (WHERE r.is_ineligible)::int AS "ineligiblePlayers",
             0::int AS "unattributedRows",
             0::int AS "unattributedVotes"
        FROM attributed r
       WHERE r.organization_id = ${organizationId}
         AND r.season_total_coverage = 'complete'
       GROUP BY r.season
       ORDER BY r.season
    `,
    sql<ClubBrownlowWinner[]>`
      WITH attributed AS (${scoped})
      SELECT r.season, r.player_id AS "playerId",
             p.display_name AS "displayName", p.slug,
             r.votes, r.is_ineligible AS "isIneligible"
        FROM attributed r
        JOIN players p ON p.id = r.player_id
       WHERE r.organization_id = ${organizationId}
         AND r.season_total_coverage = 'complete'
         AND r.is_winner
       ORDER BY r.season, p.sort_name
    `,
    sql<ClubBrownlowLeader[]>`
      WITH attributed AS (${scoped}),
      per_player AS (
        SELECT r.player_id,
               sum(r.votes)::int AS votes,
               count(*)::int AS seasons,
               count(*) FILTER (WHERE r.is_winner)::int AS winners,
               bool_or(r.is_ineligible) AS has_ineligible_season
          FROM attributed r
         WHERE r.organization_id = ${organizationId}
           AND r.season_total_coverage = 'complete'
         GROUP BY r.player_id
        HAVING sum(r.votes) > 0
      ),
      ranked AS (
        SELECT pp.*, dense_rank() OVER (ORDER BY pp.votes DESC) AS rank FROM per_player pp
      )
      SELECT t.rank::int AS rank, t.player_id AS "playerId",
             p.display_name AS "displayName", p.sort_name AS "sortName", p.slug,
             t.votes, t.seasons, t.winners,
             t.has_ineligible_season AS "hasIneligibleSeason"
        FROM ranked t
        JOIN players p ON p.id = t.player_id
       WHERE t.rank <= ${CLUB_BROWNLOW_LEADER_RANK_LIMIT}
       ORDER BY t.rank, p.sort_name, t.player_id
    `,
    sql<{ totalVotes: number; seasonsCovered: number;
          unattributedRows: number; unattributedVotes: number }[]>`
      WITH attributed AS (${scoped})
      SELECT COALESCE(sum(r.votes) FILTER (
               WHERE r.organization_id = ${organizationId}
                 AND r.season_total_coverage = 'complete'), 0)::int AS "totalVotes",
             count(DISTINCT r.season) FILTER (
               WHERE r.organization_id = ${organizationId}
                 AND r.season_total_coverage = 'complete')::int AS "seasonsCovered",
             count(*) FILTER (
               WHERE r.attribution_source = 'unattributed'
                 AND r.primary_organization_id = ${organizationId}
                 AND r.season_total_coverage = 'complete')::int AS "unattributedRows",
             COALESCE(sum(r.votes) FILTER (
               WHERE r.attribution_source = 'unattributed'
                 AND r.primary_organization_id = ${organizationId}
                 AND r.season_total_coverage = 'complete'), 0)::int AS "unattributedVotes"
        FROM attributed r
    `,
    sql<{ season: number; coverage: MetricCoverage }[]>`
      WITH attributed AS (${scoped})
      SELECT DISTINCT r.season, r.season_total_coverage AS coverage
        FROM attributed r
       WHERE r.organization_id = ${organizationId}
         AND r.season_total_coverage <> 'complete'
       ORDER BY r.season
    `,
    // Independent of the five above -- it was a serial seventh round
    // trip, and is now issued with them.
    sql<{ season: number; rowCount: number; votes: number }[]>`
      WITH attributed AS (${scoped})
      SELECT r.season, count(*)::int AS "rowCount", sum(r.votes)::int AS votes
        FROM attributed r
       WHERE r.attribution_source = 'unattributed'
         AND r.primary_organization_id = ${organizationId}
         AND r.season_total_coverage = 'complete'
       GROUP BY r.season
    `,
  ]);

  const unattributedIndex = new Map(unattributedBySeason.map((r) => [r.season, r]));

  return {
    organizationId,
    seasons: seasons.map((s) => {
      const u = unattributedIndex.get(s.season);
      return { ...s, unattributedRows: u?.rowCount ?? 0, unattributedVotes: u?.votes ?? 0 };
    }),
    totalVotes: totals.totalVotes,
    seasonsCovered: totals.seasonsCovered,
    winners,
    voteLeaders,
    unattributed: { rows: totals.unattributedRows, votes: totals.unattributedVotes },
    excludedSeasons,
  };
}

export type ClubSeasonBrownlowPlayer = {
  rank: number;
  playerId: number;
  displayName: string;
  sortName: string;
  slug: string;
  votes: number;
  isWinner: boolean;
  isIneligible: boolean;
  attributionSource: BrownlowAttributionSource;
};

export type ClubSeasonBrownlowSummary = {
  organizationId: number;
  season: number;
  coverage: MetricCoverage;
  /** True only for `complete`. When false every numeric field is null/empty. */
  isAuthoritative: boolean;
  totalVotes: number | null;
  playersWithVotes: number | null;
  leaders: ClubSeasonBrownlowPlayer[];
  winners: ClubSeasonBrownlowPlayer[];
  unattributedRows: number;
  unattributedVotes: number;
};

/**
 * The selected-season club Brownlow primitive Stage 4 builds on. It
 * shares `brownlowAttribution()` with the all-time history, so the two
 * can never disagree about whose votes belong to which club.
 *
 * The coverage state is returned whatever it is, and the numeric fields
 * are null unless the state is `complete`, so the caller can distinguish
 * complete / partial / pending / not_collected / not_applicable /
 * missing without recomputing any of the semantics.
 */
export async function getClubSeasonBrownlowSummary(
  organizationId: number,
  season: number,
): Promise<ClubSeasonBrownlowSummary> {
  const [[coverageRow], [totals], players] = await Promise.all([
    sql<{ coverage: MetricCoverage }[]>`
      SELECT cov.coverage
        FROM (${statCoverage(BROWNLOW_SEASON_TOTAL)}) cov
       WHERE cov.season = ${season}
    `,
    sql<{ totalVotes: number; playersWithVotes: number;
          unattributedRows: number; unattributedVotes: number }[]>`
      WITH attributed AS (${brownlowOrganizationRows()})
      SELECT COALESCE(sum(r.votes) FILTER (
               WHERE r.organization_id = ${organizationId}), 0)::int AS "totalVotes",
             count(*) FILTER (
               WHERE r.organization_id = ${organizationId} AND r.votes > 0)::int
               AS "playersWithVotes",
             count(*) FILTER (
               WHERE r.attribution_source = 'unattributed'
                 AND r.primary_organization_id = ${organizationId})::int AS "unattributedRows",
             COALESCE(sum(r.votes) FILTER (
               WHERE r.attribution_source = 'unattributed'
                 AND r.primary_organization_id = ${organizationId}), 0)::int
               AS "unattributedVotes"
        FROM attributed r
       WHERE r.season = ${season}
    `,
    sql<ClubSeasonBrownlowPlayer[]>`
      WITH attributed AS (${brownlowOrganizationRows()}),
      scored AS (
        SELECT r.* FROM attributed r
         WHERE r.season = ${season}
           AND r.organization_id = ${organizationId}
           AND r.votes > 0
      ),
      ranked AS (
        SELECT s.*, dense_rank() OVER (ORDER BY s.votes DESC) AS rank FROM scored s
      )
      SELECT t.rank::int AS rank, t.player_id AS "playerId",
             p.display_name AS "displayName", p.sort_name AS "sortName", p.slug,
             t.votes, t.is_winner AS "isWinner", t.is_ineligible AS "isIneligible",
             t.attribution_source AS "attributionSource"
        FROM ranked t
        JOIN players p ON p.id = t.player_id
       ORDER BY t.rank, p.sort_name, t.player_id
    `,
  ]);

  const coverage: MetricCoverage = coverageRow?.coverage ?? 'missing';
  const authoritative = isAuthoritativeCoverage(coverage);

  return {
    organizationId,
    season,
    coverage,
    isAuthoritative: authoritative,
    totalVotes: authoritative ? totals.totalVotes : null,
    playersWithVotes: authoritative ? totals.playersWithVotes : null,
    // The rank cut trims the leaderboard, never the winners: a medallist
    // is read from `is_winner` over the whole club-season, so an
    // ineligible or otherwise unusual winner cannot fall off the board.
    leaders: authoritative
      ? players.filter((p) => p.rank <= CLUB_BROWNLOW_LEADER_RANK_LIMIT)
      : [],
    winners: authoritative ? players.filter((p) => p.isWinner) : [],
    unattributedRows: totals.unattributedRows,
    unattributedVotes: totals.unattributedVotes,
  };
}

// --- H2H Brownlow ---

/**
 * A fully polled home-and-away match distributes exactly 3 + 2 + 1 = 6
 * Brownlow votes. This is the canonical completeness rule -- it is what
 * migration 016 and the repeatable `import_legacy_afl.py` coverage
 * derivation both use to decide `brownlow_match_votes` per season -- and
 * it is deliberately NOT weakened to "some votes present".
 */
const FULLY_POLLED_MATCH_VOTES = 6;

export type H2HBrownlowPlayer = {
  playerId: number;
  displayName: string;
  sortName: string;
  slug: string;
  votes: number;
  threeVoteGames: number;
  twoVoteGames: number;
  oneVoteGames: number;
  pollingGames: number;
  /** Votes polled while representing organisation A / B, at the match. */
  aVotes: number;
  bVotes: number;
};

export type H2HBrownlow = {
  /** Home-and-away meetings only. Finals are never polled. */
  eligibleMeetings: number;
  /** Eligible meetings whose season coverage allows the question to be asked. */
  evaluableMeetings: number;
  /** Eligible meetings with the complete published 3-2-1 allocation recorded. */
  coveredMeetings: number;
  /** Eligible meetings with some votes recorded but not the full allocation. */
  partiallyPolledMeetings: number;
  /** `complete` only when coveredMeetings === eligibleMeetings. */
  coverage: 'complete' | 'partial';
  totalVotes: number;
  players: H2HBrownlowPlayer[];
};

/**
 * Match-level H2H Brownlow votes and their coverage.
 *
 * This is the ONLY feature in the module that reads
 * `player_match_stats.brownlow_votes`, and it is match-scoped reporting
 * only: season totals, season winners and career totals come from
 * `brownlow_season_votes` and are never derived here.
 *
 * The eligible population is home-and-away meetings only -- finals are
 * never polled, so they contribute neither votes nor a denominator.
 * Votes are reported from FULLY covered meetings alone, so the reported
 * total is exactly the total of the X in "Recorded H2H Brownlow votes
 * from X of Y eligible meetings"; a meeting with no data contributes no
 * votes and no zeros.
 */
export async function getHeadToHeadBrownlow(
  orgA: number,
  orgB: number,
): Promise<H2HBrownlow> {
  assertDistinct(orgA, orgB);

  /** Eligible meetings, each with its season coverage and recorded vote total. */
  const polled = sql`
    SELECT mt.id, mt.season,
           cov.coverage AS match_votes_coverage,
           COALESCE((
             SELECT sum(pms.brownlow_votes)
               FROM player_match_stats pms
              WHERE pms.match_id = mt.id
           ), 0)::int AS recorded_votes
      FROM (${h2hScope(orgA, orgB, 'home-and-away')}) mt
      LEFT JOIN (${statCoverage(BROWNLOW_MATCH_VOTES)}) cov ON cov.season = mt.season
  `;

  const [[counts], players] = await Promise.all([
    sql<{ eligibleMeetings: number; evaluableMeetings: number;
          coveredMeetings: number; partiallyPolledMeetings: number }[]>`
      WITH eligible AS (${polled})
      SELECT count(*)::int AS "eligibleMeetings",
             count(*) FILTER (
               WHERE e.match_votes_coverage IN ('complete', 'partial'))::int
               AS "evaluableMeetings",
             count(*) FILTER (
               WHERE e.match_votes_coverage IN ('complete', 'partial')
                 AND e.recorded_votes = ${FULLY_POLLED_MATCH_VOTES})::int
               AS "coveredMeetings",
             count(*) FILTER (
               WHERE e.recorded_votes > 0
                 AND e.recorded_votes <> ${FULLY_POLLED_MATCH_VOTES})::int
               AS "partiallyPolledMeetings"
        FROM eligible e
    `,
    sql<H2HBrownlowPlayer[]>`
      WITH eligible AS (${polled}),
      covered AS (
        SELECT e.id FROM eligible e
         WHERE e.match_votes_coverage IN ('complete', 'partial')
           AND e.recorded_votes = ${FULLY_POLLED_MATCH_VOTES}
      )
      SELECT pms.player_id AS "playerId",
             p.display_name AS "displayName", p.sort_name AS "sortName", p.slug,
             sum(pms.brownlow_votes)::int AS votes,
             count(*) FILTER (WHERE pms.brownlow_votes = 3)::int AS "threeVoteGames",
             count(*) FILTER (WHERE pms.brownlow_votes = 2)::int AS "twoVoteGames",
             count(*) FILTER (WHERE pms.brownlow_votes = 1)::int AS "oneVoteGames",
             count(*) FILTER (WHERE pms.brownlow_votes > 0)::int AS "pollingGames",
             COALESCE(sum(pms.brownlow_votes) FILTER (
               WHERE c.organization_id = ${orgA}), 0)::int AS "aVotes",
             COALESCE(sum(pms.brownlow_votes) FILTER (
               WHERE c.organization_id = ${orgB}), 0)::int AS "bVotes"
        FROM player_match_stats pms
        JOIN covered ON covered.id = pms.match_id
        JOIN players p ON p.id = pms.player_id
        JOIN clubs c ON c.id = pms.club_id
       WHERE pms.brownlow_votes IS NOT NULL
         AND c.organization_id IN (${orgA}, ${orgB})
       GROUP BY pms.player_id, p.display_name, p.sort_name, p.slug
      HAVING sum(pms.brownlow_votes) > 0
       ORDER BY votes DESC, p.sort_name, pms.player_id
    `,
  ]);

  return {
    eligibleMeetings: counts.eligibleMeetings,
    evaluableMeetings: counts.evaluableMeetings,
    coveredMeetings: counts.coveredMeetings,
    partiallyPolledMeetings: counts.partiallyPolledMeetings,
    coverage: counts.coveredMeetings === counts.eligibleMeetings ? 'complete' : 'partial',
    totalVotes: players.reduce((sum, p) => sum + p.votes, 0),
    players,
  };
}

// --- Selected season: canonical season discovery ---

/**
 * `seasons.status`. There are exactly two canonical states and the
 * application never infers a third from a year.
 */
export type SeasonStatus = 'in_progress' | 'complete';

/**
 * A canonical season as the compare surface needs it. Everything here is
 * read from the `seasons` row: nothing is computed from the calendar,
 * and there is no supported-year list anywhere in this module.
 */
export type ComparisonSeason = {
  season: number;
  competition: string;
  league: string;
  status: SeasonStatus;
  /** `seasons.is_complete`, which may lag `status`; both are surfaced. */
  isComplete: boolean;
  /** `status <> 'complete'` -- the flag a provisional badge renders from. */
  isProvisional: boolean;
  /** How far canonical data runs. Null until ingestion sets it. */
  dataThroughDate: Date | null;
  completedAt: Date | null;
  firstMatchDate: Date | null;
  lastMatchDate: Date | null;
  matchCount: number | null;
  clubCount: number | null;
};

/**
 * The season columns, aliased for the wire. `status` is cast to text so
 * the enum arrives as a plain string.
 */
const SEASON_COLUMNS = sql`
  s.year::int AS season, s.competition, s.league,
  s.status::text AS status,
  COALESCE(s.is_complete, false) AS "isComplete",
  (s.status <> 'complete') AS "isProvisional",
  s.data_through_date AS "dataThroughDate",
  s.completed_at AS "completedAt",
  s.first_match_date AS "firstMatchDate",
  s.last_match_date AS "lastMatchDate",
  s.match_count AS "matchCount",
  s.club_count AS "clubCount"
`;

/**
 * Every canonical season, newest first. This is the ONLY source of valid
 * seasons for the compare surface: a season exists because `seasons` has
 * a row, never because application code names it. A future season
 * becomes selectable the moment ingestion inserts its row.
 *
 * No competition or league predicate is applied, matching the existing
 * `statCoverage()` fragment and the rest of `src/db/queries`: `seasons`
 * is the AFL/VFL season ledger, and AFLW lives outside it.
 */
export async function getComparisonSeasons(): Promise<ComparisonSeason[]> {
  return sql<ComparisonSeason[]>`
    SELECT ${SEASON_COLUMNS} FROM seasons s ORDER BY s.year DESC
  `;
}

/**
 * The conceptual default: the maximum canonical season. Discovered, not
 * named. Null only if `seasons` is empty.
 */
export async function getMaximumComparisonSeason(): Promise<ComparisonSeason | null> {
  const [row] = await sql<ComparisonSeason[]>`
    SELECT ${SEASON_COLUMNS} FROM seasons s ORDER BY s.year DESC LIMIT 1
  `;
  return row ?? null;
}

/** Metadata for one selected season, or null when the season is not canonical. */
export async function getComparisonSeason(season: number): Promise<ComparisonSeason | null> {
  const [row] = await sql<ComparisonSeason[]>`
    SELECT ${SEASON_COLUMNS} FROM seasons s WHERE s.year = ${season}
  `;
  return row ?? null;
}

/**
 * Organisations with canonical participation in a season, at the
 * organisation grain the comparison aggregates on. Participation is
 * evidence -- a `club_seasons` row or a played match -- never a club
 * lifespan, so a season whose data has not been ingested yet honestly
 * returns nobody instead of the whole competition.
 */
export async function getSeasonParticipants(season: number): Promise<ComparisonOrganization[]> {
  return sql<ComparisonOrganization[]>`
    SELECT DISTINCT o.id, o.name, o.slug,
           o.first_season AS "firstSeason", o.last_season AS "lastSeason",
           o.is_active AS "isActive"
      FROM club_organizations o
      JOIN clubs c ON c.organization_id = o.id
     WHERE EXISTS (SELECT 1 FROM club_seasons cs
                    WHERE cs.club_id = c.id AND cs.season = ${season})
        OR EXISTS (SELECT 1 FROM matches m
                    WHERE m.season = ${season}
                      AND c.id IN (m.home_club_id, m.away_club_id))
     ORDER BY o.name
  `;
}

// --- Selected season: identity resolution ---

/**
 * The organisation's identity-at-season, plus whether it participated at
 * all. An organisation that did not play gets `participated: false` and
 * a null record everywhere downstream: no other season and no other
 * identity is ever substituted.
 */
export type ClubSeasonIdentity = {
  organizationId: number;
  organizationName: string;
  organizationSlug: string;
  season: number;
  /** `afldb_identity_for_season`. Null when the organisation did not exist. */
  clubId: number | null;
  clubName: string | null;
  clubSlug: string | null;
  participated: boolean;
  /** Canonical matches played by the organisation in the season, finals included. */
  matchesPlayed: number;
  /** `club_seasons` rows for the organisation in the season (normally 0 or 1). */
  ladderRows: number;
};

/**
 * Identity-at-season through the canonical
 * `afldb_identity_for_season(organization_id, season)` function. The
 * lineage rules stay in the database: nothing here knows that Kangaroos
 * sits inside North Melbourne's span or that Footscray became the
 * Western Bulldogs.
 *
 * The function resolves from club lifespans, so it can name an identity
 * for a season that has no data yet. Participation is therefore decided
 * separately, from canonical evidence.
 */
export async function getSeasonIdentity(
  organizationId: number,
  season: number,
): Promise<ClubSeasonIdentity | null> {
  const [row] = await sql<{
    organizationId: number; organizationName: string; organizationSlug: string;
    clubId: number | null; clubName: string | null; clubSlug: string | null;
    matchesPlayed: number; ladderRows: number;
  }[]>`
    SELECT o.id AS "organizationId", o.name AS "organizationName", o.slug AS "organizationSlug",
           c.id AS "clubId", c.name AS "clubName", c.slug AS "clubSlug",
           (SELECT count(*) FROM matches m
              JOIN clubs mc ON mc.id IN (m.home_club_id, m.away_club_id)
             WHERE m.season = ${season} AND mc.organization_id = o.id)::int AS "matchesPlayed",
           (SELECT count(*) FROM club_seasons cs
              JOIN clubs sc ON sc.id = cs.club_id
             WHERE cs.season = ${season} AND sc.organization_id = o.id)::int AS "ladderRows"
      FROM club_organizations o
      LEFT JOIN clubs c ON c.id = afldb_identity_for_season(o.id, ${season}::smallint)
     WHERE o.id = ${organizationId}
  `;
  if (!row) return null;
  return {
    ...row,
    season,
    participated: row.matchesPlayed > 0 || row.ladderRows > 0,
  };
}

// --- Selected season: home-and-away record ---

/**
 * The selected identity's `club_seasons` row. This is HOME-AND-AWAY
 * data: `played` excludes the finals series, which is carried separately
 * as `finalsPlayed`, and it is deliberately NOT the denominator the team
 * metric averages use.
 */
export type ClubSeasonRecord = {
  organizationId: number;
  season: number;
  clubId: number;
  clubName: string;
  clubSlug: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  premiershipPoints: number | null;
  pointsFor: number;
  pointsAgainst: number;
  /** Canonical 100 x pointsFor / pointsAgainst. Null when the denominator is zero. */
  percentage: number | null;
  ladderRank: number | null;
  finalsPlayed: number | null;
  isPremier: boolean;
  woodenSpoon: boolean;
  /** 100 x (wins + 0.5 x draws) / played. Null when nothing was played. */
  winPercentage: number | null;
  averagePointsFor: number | null;
  averagePointsAgainst: number | null;
};

/**
 * The selected-season home-and-away record.
 *
 * Scoped by `clubs.organization_id`, exactly as the H2H layer is, so a
 * rename inside one organisation resolves without a TypeScript mapping.
 * Canonical data holds at most one `club_seasons` row per organisation
 * and season; the ordering makes the choice deterministic if that ever
 * stops being true.
 *
 * Null when the organisation has no row for that season -- never a
 * neighbouring season, never another identity, never a zeroed row.
 */
export async function getClubSeasonRecord(
  organizationId: number,
  season: number,
): Promise<ClubSeasonRecord | null> {
  const [row] = await sql<{
    clubId: number; clubName: string; clubSlug: string;
    played: number; wins: number; draws: number; losses: number;
    premiershipPoints: number | null; pointsFor: number; pointsAgainst: number;
    percentage: number | null; ladderRank: number | null; finalsPlayed: number | null;
    isPremier: boolean; woodenSpoon: boolean;
  }[]>`
    SELECT cs.club_id AS "clubId", c.name AS "clubName", c.slug AS "clubSlug",
           cs.played::int AS played, cs.wins::int AS wins,
           cs.draws::int AS draws, cs.losses::int AS losses,
           cs.premiership_points::int AS "premiershipPoints",
           cs.points_for::int AS "pointsFor", cs.points_against::int AS "pointsAgainst",
           cs.percentage::float8 AS percentage,
           cs.ladder_rank::int AS "ladderRank",
           cs.finals_played::int AS "finalsPlayed",
           cs.is_premier AS "isPremier", cs.wooden_spoon AS "woodenSpoon"
      FROM club_seasons cs
      JOIN clubs c ON c.id = cs.club_id
     WHERE cs.season = ${season} AND c.organization_id = ${organizationId}
     ORDER BY cs.played DESC, cs.club_id
     LIMIT 1
  `;
  if (!row) return null;
  const played = row.played;
  return {
    organizationId,
    season,
    ...row,
    winPercentage: winPercentage(row.wins, row.draws, played),
    averagePointsFor: played > 0 ? row.pointsFor / played : null,
    averagePointsAgainst: played > 0 ? row.pointsAgainst / played : null,
  };
}

// --- Selected season: team metrics ---

/**
 * The approved team stat families. This registry is STATIC on purpose
 * and carries three things only: the stat key coverage is recorded
 * under, the `player_match_stats` column, and a display label.
 *
 * It carries no season, no year range and no availability: availability
 * is read at request time from `stat_availability` through
 * `statCoverage()`. `marks_i50` coverage maps to
 * `player_match_stats.marks_inside_50`, and `inside50s` to `inside_50s`;
 * the two names differ in the canonical schema and neither is renamed
 * here.
 */
export type TeamMetricDefinition = {
  key: string;
  statKey: string;
  column: string;
  label: string;
};

export const TEAM_METRICS: TeamMetricDefinition[] = [
  { key: 'goals', statKey: 'goals', column: 'goals', label: 'Goals' },
  { key: 'behinds', statKey: 'behinds', column: 'behinds', label: 'Behinds' },
  { key: 'kicks', statKey: 'kicks', column: 'kicks', label: 'Kicks' },
  { key: 'handballs', statKey: 'handballs', column: 'handballs', label: 'Handballs' },
  { key: 'disposals', statKey: 'disposals', column: 'disposals', label: 'Disposals' },
  { key: 'marks', statKey: 'marks', column: 'marks', label: 'Marks' },
  { key: 'tackles', statKey: 'tackles', column: 'tackles', label: 'Tackles' },
  { key: 'hitouts', statKey: 'hitouts', column: 'hitouts', label: 'Hit-outs' },
  { key: 'rebounds', statKey: 'rebounds', column: 'rebounds', label: 'Rebound 50s' },
  { key: 'inside50s', statKey: 'inside50s', column: 'inside_50s', label: 'Inside 50s' },
  { key: 'clearances', statKey: 'clearances', column: 'clearances', label: 'Clearances' },
  { key: 'clangers', statKey: 'clangers', column: 'clangers', label: 'Clangers' },
  { key: 'frees_for', statKey: 'frees_for', column: 'frees_for', label: 'Frees for' },
  { key: 'frees_against', statKey: 'frees_against', column: 'frees_against', label: 'Frees against' },
  { key: 'contested', statKey: 'contested', column: 'contested', label: 'Contested possessions' },
  { key: 'uncontested', statKey: 'uncontested', column: 'uncontested', label: 'Uncontested possessions' },
  { key: 'contested_marks', statKey: 'contested_marks', column: 'contested_marks', label: 'Contested marks' },
  { key: 'marks_i50', statKey: 'marks_i50', column: 'marks_inside_50', label: 'Marks inside 50' },
  { key: 'one_percenters', statKey: 'one_percenters', column: 'one_percenters', label: 'One percenters' },
  { key: 'bounces', statKey: 'bounces', column: 'bounces', label: 'Bounces' },
  { key: 'goal_assists', statKey: 'goal_assists', column: 'goal_assists', label: 'Goal assists' },
];

/** One team stat family for one club-season, with its coverage state and denominators. */
export type ClubSeasonTeamMetric = {
  key: string;
  statKey: string;
  label: string;
  /** Runtime `stat_availability` state for this statistic and season. */
  coverage: MetricCoverage;
  /**
   * True only when coverage permits a number AND at least one team-match
   * is eligible. When false, `average` and `total` are null: an
   * uncollected or unplayed statistic is never rendered as zero.
   */
  isAvailable: boolean;
  /** Coverage is `partial`: the average is over recorded matches only. */
  isPartial: boolean;
  isPending: boolean;
  isNotApplicable: boolean;
  /** Average of eligible team-match totals. Never an average of player rows. */
  average: number | null;
  /** Sum over eligible team-matches. Null whenever `average` is null. */
  total: number | null;
  /** Team-matches whose player rows are all non-NULL for this statistic. */
  eligibleMatches: number;
  /** Every canonical team-match in the season, finals included. */
  totalTeamMatches: number;
  /**
   * The metric is presentable but its eligible denominator is short of
   * the team-match total. Preserved for UI disclosure even when coverage
   * is `complete`, because a complete season can still be missing a
   * match's player rows. False for an unavailable metric, where the
   * empty denominator is the unavailability, not a discrepancy.
   */
  hasDenominatorDiscrepancy: boolean;
};

export type ClubSeasonTeamMetrics = {
  organizationId: number;
  season: number;
  participated: boolean;
  /** Canonical matches for the organisation in the season, finals included. */
  totalTeamMatches: number;
  metrics: ClubSeasonTeamMetric[];
};

const metricNullsAlias = (key: string) => `${key}__nulls`;
const metricSumAlias = (key: string) => `${key}__sum`;
const metricEligibleAlias = (key: string) => `${key}__eligible`;
const metricAverageAlias = (key: string) => `${key}__average`;
const metricTotalAlias = (key: string) => `${key}__total`;

/**
 * Per team-match, for every metric: how many player rows are NULL, and
 * the team total. The NULL count is what makes eligibility decidable --
 * `sum()` alone cannot tell "nobody recorded it" from "everyone recorded
 * zero".
 */
function teamMetricPerMatchColumns() {
  return TEAM_METRICS.reduce(
    (acc, m) => sql`${acc},
           count(*) FILTER (WHERE p.${sql(m.column)} IS NULL)::int AS ${sql(metricNullsAlias(m.key))},
           sum(p.${sql(m.column)})::float8 AS ${sql(metricSumAlias(m.key))}`,
    sql``,
  );
}

/** Average and sum of ELIGIBLE team-match totals, plus the eligible denominator. */
function teamMetricAggregateColumns() {
  return TEAM_METRICS.reduce(
    (acc, m) => sql`${acc},
           count(*) FILTER (WHERE pm.${sql(metricNullsAlias(m.key))} = 0)::int
             AS ${sql(metricEligibleAlias(m.key))},
           (avg(pm.${sql(metricSumAlias(m.key))})
             FILTER (WHERE pm.${sql(metricNullsAlias(m.key))} = 0))::float8
             AS ${sql(metricAverageAlias(m.key))},
           (sum(pm.${sql(metricSumAlias(m.key))})
             FILTER (WHERE pm.${sql(metricNullsAlias(m.key))} = 0))::float8
             AS ${sql(metricTotalAlias(m.key))}`,
    sql``,
  );
}

/**
 * Selected-season team statistics at the contracted grain:
 *
 *   organisation -> selected-season identity -> match/club -> sum player
 *   stat values -> average eligible team-match totals
 *
 * Player rows are NEVER averaged directly. The match population is every
 * canonical match the organisation played in the season, finals
 * included, which is why the denominator is reported separately from the
 * home-and-away record.
 *
 * A team-match is eligible for a metric only when player rows exist for
 * it AND every present row has a non-NULL value. A missing row and a
 * recorded zero are therefore never conflated, and an ineligible
 * team-match contributes neither a value nor a zero.
 *
 * Availability comes from `statCoverage()` at request time. Nothing here
 * branches on the season.
 */
export async function getClubSeasonTeamMetrics(
  organizationId: number,
  season: number,
): Promise<ClubSeasonTeamMetrics> {
  const [[totals], coverageRows] = await Promise.all([
    sql<Record<string, number | null>[]>`
      WITH team_matches AS (
        SELECT m.id AS match_id, c.id AS club_id
          FROM matches m
          JOIN clubs c ON c.id IN (m.home_club_id, m.away_club_id)
         WHERE m.season = ${season} AND c.organization_id = ${organizationId}
      ),
      per_match AS (
        SELECT tm.match_id
               ${teamMetricPerMatchColumns()}
          FROM team_matches tm
          JOIN player_match_stats p
            ON p.match_id = tm.match_id AND p.club_id = tm.club_id
         GROUP BY tm.match_id
      )
      SELECT (SELECT count(*) FROM team_matches)::int AS "totalTeamMatches"
             ${teamMetricAggregateColumns()}
        FROM per_match pm
    `,
    sql<{ statKey: string; coverage: MetricCoverage }[]>`
      SELECT cov.stat_key AS "statKey", cov.coverage
        FROM (${statCoverage(TEAM_METRICS.map((m) => m.statKey))}) cov
       WHERE cov.season = ${season}
    `,
  ]);

  const coverageByKey = new Map(coverageRows.map((r) => [r.statKey, r.coverage]));
  const totalTeamMatches = Number(totals?.totalTeamMatches ?? 0);

  const metrics = TEAM_METRICS.map((m): ClubSeasonTeamMetric => {
    // No coverage row at all for this statistic and season -- including a
    // season with no `seasons` row -- fails safely as unavailable.
    const coverage: MetricCoverage = coverageByKey.get(m.statKey) ?? 'missing';
    const eligibleMatches = Number(totals?.[metricEligibleAlias(m.key)] ?? 0);
    const presentable = coverage === 'complete' || coverage === 'partial';
    const isAvailable = presentable && eligibleMatches > 0;
    const average = totals?.[metricAverageAlias(m.key)];
    const total = totals?.[metricTotalAlias(m.key)];
    return {
      key: m.key,
      statKey: m.statKey,
      label: m.label,
      coverage,
      isAvailable,
      isPartial: coverage === 'partial',
      isPending: coverage === 'pending',
      isNotApplicable: coverage === 'not_applicable',
      average: isAvailable && average !== null && average !== undefined ? Number(average) : null,
      total: isAvailable && total !== null && total !== undefined ? Number(total) : null,
      eligibleMatches,
      totalTeamMatches,
      hasDenominatorDiscrepancy: isAvailable && eligibleMatches !== totalTeamMatches,
    };
  });

  return {
    organizationId,
    season,
    participated: totalTeamMatches > 0,
    totalTeamMatches,
    metrics,
  };
}

// --- Selected season: player leaders ---

/**
 * Dense-rank cut for selected-season leaderboards. Every tie at the cut
 * is retained, so a board may return more than five rows -- in a modern
 * season the games board routinely does.
 */
export const CLUB_SEASON_LEADER_RANK_LIMIT = 5;

export type ClubSeasonLeader = {
  rank: number;
  playerId: number;
  displayName: string;
  sortName: string;
  slug: string;
  value: number;
  /**
   * Matches in which the statistic was actually recorded, where the
   * canonical table carries one. Null for boards that have no such
   * denominator (games, goals).
   */
  recordedGames: number | null;
};

export type ClubSeasonPlayerLeaders = {
  organizationId: number;
  season: number;
  participated: boolean;
  games: ClubSeasonLeader[];
  goals: ClubSeasonLeader[];
  disposals: ClubSeasonLeader[];
  /** Runtime coverage for the goals board. */
  goalsCoverage: MetricCoverage;
  goalsAvailable: boolean;
  /** Runtime coverage for the disposals board. */
  disposalsCoverage: MetricCoverage;
  disposalsAvailable: boolean;
};

/**
 * One dense-ranked leaderboard over `player_club_season_stats`, summed
 * across every identity of the organisation active in the season, so a
 * mid-season rename could not split a player's total.
 *
 * Only players with a recorded, positive value appear: a NULL total is
 * not a zero, and a zero is not a leader.
 */
async function clubSeasonLeaderBoard(
  organizationId: number,
  season: number,
  valueColumn: string,
  recordedColumn: string | null,
): Promise<ClubSeasonLeader[]> {
  return sql<ClubSeasonLeader[]>`
    WITH totals AS (
      SELECT pcs.player_id,
             sum(pcs.games)::int AS games,
             sum(pcs.goals)::int AS goals,
             sum(pcs.disposals)::int AS disposals,
             sum(pcs.disposals_recorded_games)::int AS disposals_recorded_games
        FROM player_club_season_stats pcs
        JOIN clubs c ON c.id = pcs.club_id
       WHERE pcs.season = ${season} AND c.organization_id = ${organizationId}
       GROUP BY pcs.player_id
    ),
    scored AS (
      SELECT t.* FROM totals t
       WHERE t.${sql(valueColumn)} IS NOT NULL AND t.${sql(valueColumn)} > 0
    ),
    ranked AS (
      SELECT s.*, dense_rank() OVER (ORDER BY s.${sql(valueColumn)} DESC) AS rank
        FROM scored s
    )
    SELECT r.rank::int AS rank, r.player_id AS "playerId",
           p.display_name AS "displayName", p.sort_name AS "sortName", p.slug,
           r.${sql(valueColumn)}::int AS value,
           ${recordedColumn === null ? sql`NULL::int` : sql`r.${sql(recordedColumn)}::int`}
             AS "recordedGames"
      FROM ranked r
      JOIN players p ON p.id = r.player_id
     WHERE r.rank <= ${CLUB_SEASON_LEADER_RANK_LIMIT}
     ORDER BY r.rank, p.sort_name, r.player_id
  `;
}

/**
 * Selected-season player leaders for games, goals and disposals.
 *
 * Games and goals cover all season matches. Disposals are shown only
 * when runtime coverage permits, and always with their recorded-game
 * denominator, because a partly recorded season's totals are not
 * comparable with a fully recorded one's.
 *
 * If the organisation did not participate, every board is empty. No
 * other season and no other identity is ever borrowed.
 */
export async function getClubSeasonPlayerLeaders(
  organizationId: number,
  season: number,
): Promise<ClubSeasonPlayerLeaders> {
  const coverageRows = await sql<{ statKey: string; coverage: MetricCoverage }[]>`
    SELECT cov.stat_key AS "statKey", cov.coverage
      FROM (${statCoverage(['goals', 'disposals'])}) cov
     WHERE cov.season = ${season}
  `;
  const coverageByKey = new Map(coverageRows.map((r) => [r.statKey, r.coverage]));
  const goalsCoverage: MetricCoverage = coverageByKey.get('goals') ?? 'missing';
  const disposalsCoverage: MetricCoverage = coverageByKey.get('disposals') ?? 'missing';
  const goalsAvailable = goalsCoverage === 'complete' || goalsCoverage === 'partial';
  const disposalsAvailable = disposalsCoverage === 'complete' || disposalsCoverage === 'partial';

  const [games, goals, disposals] = await Promise.all([
    clubSeasonLeaderBoard(organizationId, season, 'games', null),
    goalsAvailable
      ? clubSeasonLeaderBoard(organizationId, season, 'goals', null)
      : Promise.resolve([] as ClubSeasonLeader[]),
    disposalsAvailable
      ? clubSeasonLeaderBoard(organizationId, season, 'disposals', 'disposals_recorded_games')
      : Promise.resolve([] as ClubSeasonLeader[]),
  ]);

  return {
    organizationId,
    season,
    participated: games.length > 0,
    games,
    goals,
    disposals,
    goalsCoverage,
    goalsAvailable,
    disposalsCoverage,
    disposalsAvailable,
  };
}

// --- Selected season: whole comparison side ---

/**
 * Everything the compare surface needs about ONE organisation in ONE
 * season. Composed from the focused queries above plus the Stage 3
 * Brownlow primitive, so no semantics are duplicated here.
 */
export type ClubSeasonComparison = {
  season: number;
  /** Canonical season metadata, or null when the season is not canonical. */
  seasonMeta: ComparisonSeason | null;
  identity: ClubSeasonIdentity | null;
  /** True only when canonical evidence shows the organisation played. */
  participated: boolean;
  record: ClubSeasonRecord | null;
  teamMetrics: ClubSeasonTeamMetrics;
  leaders: ClubSeasonPlayerLeaders;
  brownlow: ClubSeasonBrownlowSummary;
};

/**
 * The complete selected-season path for one organisation. Season state,
 * identity, record, metric coverage and Brownlow state all come from
 * canonical rows read at request time: a season turning from
 * `in_progress` to `complete`, or Brownlow coverage from `pending` to
 * `complete`, changes the answer with no release.
 */
export async function getClubSeasonComparison(
  organizationId: number,
  season: number,
): Promise<ClubSeasonComparison> {
  const [seasonMeta, identity, record, teamMetrics, leaders, brownlow] = await Promise.all([
    getComparisonSeason(season),
    getSeasonIdentity(organizationId, season),
    getClubSeasonRecord(organizationId, season),
    getClubSeasonTeamMetrics(organizationId, season),
    getClubSeasonPlayerLeaders(organizationId, season),
    getClubSeasonBrownlowSummary(organizationId, season),
  ]);

  return {
    season,
    seasonMeta,
    identity,
    participated: identity?.participated ?? false,
    record,
    teamMetrics,
    leaders,
    brownlow,
  };
}

// =====================================================================
// Stage 6 -- Extended rivalry analytics
// =====================================================================

// --- H2H by decade ---

/**
 * One decade of a rivalry. Decades are DISCOVERED from the canonical
 * meeting population -- `season - mod(season, 10)` -- never enumerated
 * from a list and never bounded by a "current era". A decade in which
 * the pair never met simply has no row; it is never rendered as a zero
 * row, which would invent a meeting-less decade for every pair whose
 * organisations did not co-exist.
 */
export type H2HDecade = {
  /** The decade's first season: 1990 for the 1990s. */
  decade: number;
  meetings: number;
  aWins: number;
  bWins: number;
  draws: number;
  /** Half-draw formula, `100 * (wins + 0.5 * draws) / meetings`. */
  aWinPercentage: number | null;
  bWinPercentage: number | null;
  /**
   * Points are summed over meetings with a recorded score only, and are
   * null when the decade has none: an unscored meeting is not nil-all.
   * `scoredMeetings` is the honest denominator behind all four totals.
   */
  scoredMeetings: number;
  aPointsFor: number | null;
  aPointsAgainst: number | null;
  bPointsFor: number | null;
  bPointsAgainst: number | null;
};

/**
 * The rivalry by decade, over the Stage 1 pair scope and nothing else.
 * `aPointsAgainst` is `bPointsFor` by construction and is returned
 * anyway, because a UI reading one organisation's row should not have to
 * reach into the other's to render "for and against".
 *
 * Ordering is ascending by decade, so the result reads as a timeline.
 */
export async function getHeadToHeadByDecade(orgA: number, orgB: number): Promise<H2HDecade[]> {
  assertDistinct(orgA, orgB);
  const rows = await sql<{
    decade: number; meetings: number; aWins: number; bWins: number; draws: number;
    scoredMeetings: number; aPointsFor: number | null; bPointsFor: number | null;
  }[]>`
    WITH meetings AS (${h2hScope(orgA, orgB)})
    SELECT (season - mod(season, 10))::int AS decade,
           count(*)::int AS meetings,
           count(*) FILTER (WHERE outcome = 'a-win')::int AS "aWins",
           count(*) FILTER (WHERE outcome = 'b-win')::int AS "bWins",
           count(*) FILTER (WHERE outcome = 'draw')::int AS draws,
           count(*) FILTER (WHERE a_score IS NOT NULL AND b_score IS NOT NULL)::int
             AS "scoredMeetings",
           sum(a_score)::int AS "aPointsFor",
           sum(b_score)::int AS "bPointsFor"
      FROM meetings
     GROUP BY 1
     ORDER BY 1
  `;

  return rows.map((row) => ({
    decade: row.decade,
    meetings: row.meetings,
    aWins: row.aWins,
    bWins: row.bWins,
    draws: row.draws,
    aWinPercentage: winPercentage(row.aWins, row.draws, row.meetings),
    bWinPercentage: winPercentage(row.bWins, row.draws, row.meetings),
    scoredMeetings: row.scoredMeetings,
    aPointsFor: row.aPointsFor,
    aPointsAgainst: row.bPointsFor,
    bPointsFor: row.bPointsFor,
    bPointsAgainst: row.aPointsFor,
  }));
}

// --- Period-score rivalry records ---

/**
 * `match_period_scores` semantics, VERIFIED against the canonical schema
 * and data rather than assumed (migration 003:98, migration 076:100-103):
 *
 *   - `points` is the CUMULATIVE score at the end of the period, "as
 *     published". No row in `afldb_test` decreases from one period to
 *     the next, which is what cumulative means.
 *   - Periods 1-4 are quarters. The CHECK allows 1-8, and the historical
 *     importer deliberately imports no extra-time period, so a match
 *     that went to extra time carries period 4 = END OF REGULATION.
 *   - Three matches in `afldb_test` prove exactly that: 10795 (1994 QF),
 *     13203 (2007 SF) and 15194 (2017 EF) have a period-4 total below
 *     their canonical final score.
 *
 * Period 4 is therefore NEVER read as the final score here. Quarter
 * time, half time and three-quarter time come from periods 1, 2 and 3;
 * full time comes from the canonical `matches` score and
 * `matches.winner_club_id`, through the Stage 1 scope's `a_score`,
 * `b_score` and `outcome`.
 *
 * There is no `stat_availability` key for period scores -- the runtime
 * coverage table carries the player statistic families and the Brownlow
 * only -- so completeness cannot be read through `statCoverage()`, and a
 * coverage column is NOT invented in the schema for it. The V1 contract
 * is decided from canonical rows alone: see `getHeadToHeadPeriodRecords`.
 */
export type H2HTurnaroundSegment =
  | 'quarter-time-to-half-time'
  | 'half-time-to-three-quarter-time'
  | 'three-quarter-time-to-full-time';

export type H2HPeriodRecordKind =
  | 'biggest-quarter-time-lead-a'
  | 'biggest-quarter-time-lead-b'
  | 'biggest-half-time-lead-a'
  | 'biggest-half-time-lead-b'
  | 'biggest-three-quarter-time-lead-a'
  | 'biggest-three-quarter-time-lead-b'
  | 'biggest-comeback-from-quarter-time-a'
  | 'biggest-comeback-from-quarter-time-b'
  | 'biggest-comeback-from-half-time-a'
  | 'biggest-comeback-from-half-time-b'
  | 'biggest-comeback-from-three-quarter-time-a'
  | 'biggest-comeback-from-three-quarter-time-b'
  | 'largest-turnaround-a'
  | 'largest-turnaround-b';

const PERIOD_RECORD_KINDS: H2HPeriodRecordKind[] = [
  'biggest-quarter-time-lead-a', 'biggest-quarter-time-lead-b',
  'biggest-half-time-lead-a', 'biggest-half-time-lead-b',
  'biggest-three-quarter-time-lead-a', 'biggest-three-quarter-time-lead-b',
  'biggest-comeback-from-quarter-time-a', 'biggest-comeback-from-quarter-time-b',
  'biggest-comeback-from-half-time-a', 'biggest-comeback-from-half-time-b',
  'biggest-comeback-from-three-quarter-time-a', 'biggest-comeback-from-three-quarter-time-b',
  'largest-turnaround-a', 'largest-turnaround-b',
];

/**
 * A period record-holding meeting: the full meeting (so a route can link
 * it without a second query), the value it holds, the three cumulative
 * break scores for both organisations, and -- for a turnaround only --
 * the segment the swing happened in.
 */
export type H2HPeriodRecordEntry = H2HMeeting & {
  value: number;
  segment: H2HTurnaroundSegment | null;
  aQuarterTime: number;
  aHalfTime: number;
  aThreeQuarterTime: number;
  bQuarterTime: number;
  bHalfTime: number;
  bThreeQuarterTime: number;
};

/** `complete` only when EVERY meeting is usable; `none` when none is. */
export type H2HPeriodCoverageState = 'complete' | 'partial' | 'none';

/**
 * Pair-level period-score coverage, so a caller can always state
 * "Period-score data available for X of Y rivalry meetings" -- even
 * while every measured pair in `afldb_test` happens to be complete.
 * Present completeness is evidence, never a contract.
 *
 * `meetingsWithPeriodRows` is the weak "has any period row" test;
 * `usableMeetings` is the one the records actually run on.
 */
export type H2HPeriodCoverage = {
  /** Every meeting in the Stage 1 pair scope. */
  meetings: number;
  /** Meetings carrying at least one `match_period_scores` row. */
  meetingsWithPeriodRows: number;
  /** Meetings satisfying the full usability contract. */
  usableMeetings: number;
  /** `meetings - usableMeetings`: missing or incomplete. */
  incompleteMeetings: number;
  state: H2HPeriodCoverageState;
};

export type H2HPeriodRecords = {
  coverage: H2HPeriodCoverage;
  records: Record<H2HPeriodRecordKind, H2HPeriodRecordEntry[]>;
};

type PeriodRecordRow = H2HPeriodRecordEntry & { kind: H2HPeriodRecordKind };

/**
 * The three cumulative break totals per meeting, per organisation, from
 * canonical `match_period_scores`. NULL for any break either
 * organisation has no recorded `points` at -- which is precisely what
 * makes incompleteness decidable rather than silently zero.
 *
 * The pair's two organisations are distinct (`assertDistinct`), and a
 * period row's club is always one of the match's two participants, so
 * each `FILTER` selects at most one row and `max()` is a picker, not an
 * aggregate over rivals.
 */
function h2hPeriodBreaks(orgA: number, orgB: number) {
  return sql`
    SELECT mt.id,
           max(ps.points) FILTER (WHERE c.organization_id = ${orgA} AND ps.period = 1)::int AS a1,
           max(ps.points) FILTER (WHERE c.organization_id = ${orgA} AND ps.period = 2)::int AS a2,
           max(ps.points) FILTER (WHERE c.organization_id = ${orgA} AND ps.period = 3)::int AS a3,
           max(ps.points) FILTER (WHERE c.organization_id = ${orgB} AND ps.period = 1)::int AS b1,
           max(ps.points) FILTER (WHERE c.organization_id = ${orgB} AND ps.period = 2)::int AS b2,
           max(ps.points) FILTER (WHERE c.organization_id = ${orgB} AND ps.period = 3)::int AS b3
      FROM meetings mt
      JOIN match_period_scores ps ON ps.match_id = mt.id
      JOIN clubs c ON c.id = ps.club_id
     WHERE ps.period BETWEEN 1 AND 3
       AND ps.points IS NOT NULL
       AND c.organization_id IN (${orgA}, ${orgB})
     GROUP BY mt.id
  `;
}

/**
 * THE usability predicate, applied identically by the coverage count and
 * by the records, so the denominator a caller renders is exactly the
 * population the records were drawn from.
 */
const PERIOD_USABLE_PREDICATE = sql`
  b.a1 IS NOT NULL AND b.a2 IS NOT NULL AND b.a3 IS NOT NULL
  AND b.b1 IS NOT NULL AND b.b2 IS NOT NULL AND b.b3 IS NOT NULL
  AND mt.a_score IS NOT NULL AND mt.b_score IS NOT NULL
`;

/**
 * Period-score rivalry records over the Stage 1 pair scope.
 *
 * THE USABILITY CONTRACT. A meeting is usable only when, from canonical
 * rows alone:
 *
 *   1. both organisations have a non-NULL cumulative `points` at period
 *      1, period 2 AND period 3 -- the three breaks every record below
 *      is defined at; and
 *   2. the meeting has canonical final scores for both organisations,
 *      which is where full time comes from.
 *
 * A meeting satisfying only part of that is INCOMPLETE and contributes
 * nothing: a missing period row is never read as nought, so a half-
 * populated match can neither hold nor dilute a record. Period 4 is
 * deliberately not required, because nothing here reads it.
 *
 * RECORD DEFINITIONS, each from the named organisation's perspective and
 * each strictly positive, so a level break is neither a "lead" nor a
 * "comeback":
 *
 *   - biggest lead at a break: max(own cumulative - other cumulative) at
 *     period 1 / 2 / 3 over usable meetings where that is > 0.
 *   - biggest comeback from a break: the organisation TRAILED at that
 *     break (other - own > 0) AND won the match on the canonical result.
 *     A drawn match is never a comeback win. Ranked by largest deficit
 *     overcome.
 *   - largest turnaround between consecutive breaks: with margin
 *     `M(t) = own - other` at t in {QT, HT, 3QT, FT}, the largest value
 *     of `M(t+1) - M(t)` over the three consecutive pairs QT->HT,
 *     HT->3QT and 3QT->FT, over all usable meetings, where it is > 0. FT
 *     is the canonical final score, never period 4. The winning entry
 *     names its `segment`. No subjective label is applied.
 *
 * Every tied witness is returned, ordered by meeting date, season then
 * match id, exactly as the Stage 1 records are.
 */
export async function getHeadToHeadPeriodRecords(
  orgA: number,
  orgB: number,
): Promise<H2HPeriodRecords> {
  assertDistinct(orgA, orgB);

  const [[counts], rows] = await Promise.all([
    sql<{ meetings: number; meetingsWithPeriodRows: number; usableMeetings: number }[]>`
      WITH meetings AS (${h2hScope(orgA, orgB)}),
      breaks AS (${h2hPeriodBreaks(orgA, orgB)})
      SELECT (SELECT count(*) FROM meetings)::int AS "meetings",
             (SELECT count(*) FROM meetings mt
               WHERE EXISTS (SELECT 1 FROM match_period_scores ps
                              WHERE ps.match_id = mt.id))::int AS "meetingsWithPeriodRows",
             (SELECT count(*) FROM meetings mt
                JOIN breaks b ON b.id = mt.id
               WHERE ${PERIOD_USABLE_PREDICATE})::int AS "usableMeetings"
    `,
    sql<PeriodRecordRow[]>`
      WITH meetings AS (${h2hScope(orgA, orgB)}),
      breaks AS (${h2hPeriodBreaks(orgA, orgB)}),
      usable AS (
        SELECT mt.*, b.a1, b.a2, b.a3, b.b1, b.b2, b.b3
          FROM meetings mt
          JOIN breaks b ON b.id = mt.id
         WHERE ${PERIOD_USABLE_PREDICATE}
      ),
      swings AS (
        SELECT id, 'quarter-time-to-half-time'::text AS segment,
               ((a2 - b2) - (a1 - b1))::int AS a_swing,
               ((b2 - a2) - (b1 - a1))::int AS b_swing
          FROM usable
        UNION ALL
        SELECT id, 'half-time-to-three-quarter-time',
               ((a3 - b3) - (a2 - b2))::int, ((b3 - a3) - (b2 - a2))::int
          FROM usable
        UNION ALL
        SELECT id, 'three-quarter-time-to-full-time',
               ((a_score - b_score) - (a3 - b3))::int,
               ((b_score - a_score) - (b3 - a3))::int
          FROM usable
      ),
      picks AS (
        SELECT 'biggest-quarter-time-lead-a'::text AS kind, id,
               (a1 - b1)::int AS value, NULL::text AS segment
          FROM usable WHERE a1 > b1
           AND a1 - b1 = (SELECT max(a1 - b1) FROM usable WHERE a1 > b1)
        UNION ALL
        SELECT 'biggest-quarter-time-lead-b', id, (b1 - a1)::int, NULL
          FROM usable WHERE b1 > a1
           AND b1 - a1 = (SELECT max(b1 - a1) FROM usable WHERE b1 > a1)
        UNION ALL
        SELECT 'biggest-half-time-lead-a', id, (a2 - b2)::int, NULL
          FROM usable WHERE a2 > b2
           AND a2 - b2 = (SELECT max(a2 - b2) FROM usable WHERE a2 > b2)
        UNION ALL
        SELECT 'biggest-half-time-lead-b', id, (b2 - a2)::int, NULL
          FROM usable WHERE b2 > a2
           AND b2 - a2 = (SELECT max(b2 - a2) FROM usable WHERE b2 > a2)
        UNION ALL
        SELECT 'biggest-three-quarter-time-lead-a', id, (a3 - b3)::int, NULL
          FROM usable WHERE a3 > b3
           AND a3 - b3 = (SELECT max(a3 - b3) FROM usable WHERE a3 > b3)
        UNION ALL
        SELECT 'biggest-three-quarter-time-lead-b', id, (b3 - a3)::int, NULL
          FROM usable WHERE b3 > a3
           AND b3 - a3 = (SELECT max(b3 - a3) FROM usable WHERE b3 > a3)
        UNION ALL
        SELECT 'biggest-comeback-from-quarter-time-a', id, (b1 - a1)::int, NULL
          FROM usable WHERE outcome = 'a-win' AND b1 > a1
           AND b1 - a1 = (SELECT max(b1 - a1) FROM usable WHERE outcome = 'a-win' AND b1 > a1)
        UNION ALL
        SELECT 'biggest-comeback-from-quarter-time-b', id, (a1 - b1)::int, NULL
          FROM usable WHERE outcome = 'b-win' AND a1 > b1
           AND a1 - b1 = (SELECT max(a1 - b1) FROM usable WHERE outcome = 'b-win' AND a1 > b1)
        UNION ALL
        SELECT 'biggest-comeback-from-half-time-a', id, (b2 - a2)::int, NULL
          FROM usable WHERE outcome = 'a-win' AND b2 > a2
           AND b2 - a2 = (SELECT max(b2 - a2) FROM usable WHERE outcome = 'a-win' AND b2 > a2)
        UNION ALL
        SELECT 'biggest-comeback-from-half-time-b', id, (a2 - b2)::int, NULL
          FROM usable WHERE outcome = 'b-win' AND a2 > b2
           AND a2 - b2 = (SELECT max(a2 - b2) FROM usable WHERE outcome = 'b-win' AND a2 > b2)
        UNION ALL
        SELECT 'biggest-comeback-from-three-quarter-time-a', id, (b3 - a3)::int, NULL
          FROM usable WHERE outcome = 'a-win' AND b3 > a3
           AND b3 - a3 = (SELECT max(b3 - a3) FROM usable WHERE outcome = 'a-win' AND b3 > a3)
        UNION ALL
        SELECT 'biggest-comeback-from-three-quarter-time-b', id, (a3 - b3)::int, NULL
          FROM usable WHERE outcome = 'b-win' AND a3 > b3
           AND a3 - b3 = (SELECT max(a3 - b3) FROM usable WHERE outcome = 'b-win' AND a3 > b3)
        UNION ALL
        SELECT 'largest-turnaround-a', id, a_swing, segment
          FROM swings WHERE a_swing > 0
           AND a_swing = (SELECT max(a_swing) FROM swings WHERE a_swing > 0)
        UNION ALL
        SELECT 'largest-turnaround-b', id, b_swing, segment
          FROM swings WHERE b_swing > 0
           AND b_swing = (SELECT max(b_swing) FROM swings WHERE b_swing > 0)
      )
      SELECT p.kind, p.value, p.segment, ${MEETING_COLUMNS},
             m.a1 AS "aQuarterTime", m.a2 AS "aHalfTime", m.a3 AS "aThreeQuarterTime",
             m.b1 AS "bQuarterTime", m.b2 AS "bHalfTime", m.b3 AS "bThreeQuarterTime"
        FROM picks p
        JOIN usable m ON m.id = p.id
       ORDER BY p.kind, m.match_date, m.season, m.id, p.segment
    `,
  ]);

  const meetings = Number(counts?.meetings ?? 0);
  const usableMeetings = Number(counts?.usableMeetings ?? 0);
  const state: H2HPeriodCoverageState =
    usableMeetings === 0
      ? 'none'
      : usableMeetings === meetings
        ? 'complete'
        : 'partial';

  const records = Object.fromEntries(
    PERIOD_RECORD_KINDS.map((kind) => [kind, [] as H2HPeriodRecordEntry[]]),
  ) as Record<H2HPeriodRecordKind, H2HPeriodRecordEntry[]>;
  for (const row of rows) {
    const { kind, ...entry } = row;
    records[kind].push(entry);
  }

  return {
    coverage: {
      meetings,
      meetingsWithPeriodRows: Number(counts?.meetingsWithPeriodRows ?? 0),
      usableMeetings,
      incompleteMeetings: meetings - usableMeetings,
      state,
    },
    records,
  };
}

// --- H2H player averages ---

/**
 * A player qualifies for a metric's average board only with at least
 * this many H2H games in which THAT metric was actually recorded. The
 * threshold is metric-specific by construction: twelve rivalry games
 * with four recorded disposal rows is not a disposals average.
 */
export const H2H_AVERAGE_MINIMUM_RECORDED_GAMES = 5;

/** Dense-rank cut for every average board. Ties at the cut are retained. */
export const H2H_AVERAGE_RANK_LIMIT = 10;

/**
 * The average boards are a SUBSET of the existing `TEAM_METRICS`
 * registry -- the same static rows, filtered, never a second registry
 * and never a year-based one. `behinds`, `frees_for` and `frees_against`
 * are the three families the approved V1.7 average list omits.
 */
const H2H_AVERAGE_METRIC_KEYS = new Set([
  'goals', 'disposals', 'kicks', 'handballs', 'marks', 'tackles', 'hitouts',
  'rebounds', 'inside50s', 'clearances', 'clangers', 'contested', 'uncontested',
  'contested_marks', 'marks_i50', 'one_percenters', 'bounces', 'goal_assists',
]);

export const H2H_AVERAGE_METRICS: TeamMetricDefinition[] =
  TEAM_METRICS.filter((m) => H2H_AVERAGE_METRIC_KEYS.has(m.key));

/**
 * One organisation's share of a player's board row. Null total and
 * average when the player recorded the metric for that organisation in
 * no meeting at all -- a player who only ever faced the rivalry from one
 * side has nothing on the other, which is not a nought average.
 */
export type H2HAverageContribution = {
  recordedGames: number;
  total: number | null;
  average: number | null;
};

export type H2HAverageLeader = {
  /** Dense rank, 1-based, ties sharing a rank. */
  rank: number;
  playerId: number;
  displayName: string;
  sortName: string;
  slug: string;
  /** THE denominator: H2H games in which this metric was recorded. */
  recordedGames: number;
  total: number;
  average: number;
  a: H2HAverageContribution;
  b: H2HAverageContribution;
};

export type H2HAverageBoard = {
  key: string;
  statKey: string;
  label: string;
  /**
   * Rivalry seasons whose runtime `stat_availability` coverage is
   * `complete` or `partial`, and the count that is not. Both are
   * discovered at request time from the rivalry's own seasons; no year
   * appears anywhere in this module.
   */
  rivalrySeasons: number;
  coveredSeasons: number;
  uncoveredSeasons: number;
  /** Per-coverage-state season counts, for UI disclosure. */
  seasonsByCoverage: Record<MetricCoverage, number>;
  /** At least one rivalry season permits the metric to be presented. */
  isAvailable: boolean;
  /**
   * The metric is presentable but does not cover the whole rivalry, so a
   * UI must not imply era-wide comparability.
   */
  hasCoverageGap: boolean;
  minimumRecordedGames: number;
  leaders: H2HAverageLeader[];
};

export type H2HPlayerAverages = {
  meetings: number;
  /** Distinct seasons the pair met in. */
  rivalrySeasons: number;
  minimumRecordedGames: number;
  rankLimit: number;
  boards: H2HAverageBoard[];
};

type H2HAverageRow = {
  metricKey: string;
  rank: number;
  playerId: number;
  displayName: string;
  sortName: string;
  slug: string;
  recordedGames: number;
  total: number;
  average: number;
  aRecordedGames: number;
  aTotal: number | null;
  bRecordedGames: number;
  bTotal: number | null;
};

const averageRecordedAlias = (key: string) => `${key}__recorded`;
const averageTotalAlias = (key: string) => `${key}__total`;
const averageARecordedAlias = (key: string) => `${key}__a_recorded`;
const averageATotalAlias = (key: string) => `${key}__a_total`;

/**
 * Four aggregates per metric over the rivalry's player rows, in ONE
 * grouped pass: recorded games, total, and organisation A's share of
 * each. `count(column)` counts non-NULL values only, which is exactly
 * the metric-specific recorded-game denominator; `sum()` likewise
 * ignores NULLs, so a missing row never enters as a nought.
 *
 * Organisation B's share is not aggregated: it is the remainder, and
 * computing it here would double the aggregate count for nothing.
 */
function h2hAverageAggregateColumns() {
  return H2H_AVERAGE_METRICS.reduce(
    (acc, m) => sql`${acc},
           count(ap.${sql(m.column)})::int AS ${sql(averageRecordedAlias(m.key))},
           sum(ap.${sql(m.column)})::float8 AS ${sql(averageTotalAlias(m.key))},
           count(ap.${sql(m.column)}) FILTER (WHERE ap.is_a)::int
             AS ${sql(averageARecordedAlias(m.key))},
           sum(ap.${sql(m.column)}) FILTER (WHERE ap.is_a)::float8
             AS ${sql(averageATotalAlias(m.key))}`,
    sql``,
  );
}

/**
 * The eighteen already-aggregated metric columns turned back into rows,
 * one per player and metric.
 *
 * Deliberately in THIS order: unpivoting the player rows first and
 * grouping afterwards multiplies the rivalry's player-match population
 * by eighteen before it is reduced, which measured 230 ms median on
 * Carlton/Collingwood against a 250 ms ceiling. Aggregating first and
 * unpivoting ~1/8 as many rows afterwards is the same result with the
 * headroom back.
 */
function h2hAverageMetricValues() {
  return H2H_AVERAGE_METRICS.reduce(
    (acc, m, i) => sql`${acc}${i === 0 ? sql`` : sql`,`}
      (${m.key}::text,
       pt.${sql(averageRecordedAlias(m.key))},
       pt.${sql(averageTotalAlias(m.key))},
       pt.${sql(averageARecordedAlias(m.key))},
       pt.${sql(averageATotalAlias(m.key))})`,
    sql``,
  );
}

/**
 * Coverage-aware H2H player average leaderboards.
 *
 * Availability is decided ENTIRELY by runtime `stat_availability`
 * through the shared `statCoverage()` abstraction, evaluated over the
 * rivalry's own seasons. Nothing here encodes a collection start year:
 * when a reload turns a season's `goal_assists` from `not_collected`
 * into `complete`, the next request presents the board with no code
 * change.
 *
 * Aggregation reads ONLY non-NULL recorded values, and reports
 * `recordedGames` -- the number of H2H games in which the metric was
 * recorded for that player -- as the average's denominator. A missing
 * player-match value is never a zero, and the denominator is never total
 * rivalry appearances.
 *
 * Eligibility is `recordedGames >= H2H_AVERAGE_MINIMUM_RECORDED_GAMES`,
 * applied per metric. Ranking is dense on the average descending, cut at
 * rank ten with every tie at the cut retained, then ordered by sort name
 * and player id so the list is stable.
 */
export async function getHeadToHeadPlayerAverages(
  orgA: number,
  orgB: number,
): Promise<H2HPlayerAverages> {
  assertDistinct(orgA, orgB);
  const statKeys = H2H_AVERAGE_METRICS.map((m) => m.statKey);

  const [[population], coverageRows, leaderRows] = await Promise.all([
    sql<{ meetings: number; rivalrySeasons: number }[]>`
      WITH meetings AS (${h2hScope(orgA, orgB)})
      SELECT count(*)::int AS "meetings",
             count(DISTINCT season)::int AS "rivalrySeasons"
        FROM meetings
    `,
    sql<{ statKey: string; coverage: MetricCoverage; seasons: number }[]>`
      WITH meetings AS (${h2hScope(orgA, orgB)}),
      rivalry_seasons AS (SELECT DISTINCT season FROM meetings)
      SELECT cov.stat_key AS "statKey", cov.coverage, count(*)::int AS seasons
        FROM (${statCoverage(statKeys)}) cov
        JOIN rivalry_seasons rs ON rs.season = cov.season
       GROUP BY cov.stat_key, cov.coverage
    `,
    sql<H2HAverageRow[]>`
      WITH meetings AS (${h2hScope(orgA, orgB)}),
      appearances AS (
        SELECT pms.*, (c.organization_id = ${orgA}) AS is_a
          FROM player_match_stats pms
          JOIN meetings mt ON mt.id = pms.match_id
          JOIN clubs c ON c.id = pms.club_id
         WHERE c.organization_id IN (${orgA}, ${orgB})
      ),
      player_totals AS (
        SELECT ap.player_id
               ${h2hAverageAggregateColumns()}
          FROM appearances ap
         GROUP BY ap.player_id
      ),
      totals AS (
        SELECT pt.player_id, v.metric_key,
               v.recorded_games,
               v.total,
               (v.total / v.recorded_games) AS average,
               v.a_recorded_games,
               v.a_total,
               (v.recorded_games - v.a_recorded_games) AS b_recorded_games,
               (v.total - COALESCE(v.a_total, 0)) AS b_total
          FROM player_totals pt
          CROSS JOIN LATERAL (VALUES ${h2hAverageMetricValues()})
            AS v(metric_key, recorded_games, total, a_recorded_games, a_total)
         WHERE v.recorded_games >= ${H2H_AVERAGE_MINIMUM_RECORDED_GAMES}
      ),
      ranked AS (
        SELECT t.*,
               dense_rank() OVER (PARTITION BY t.metric_key ORDER BY t.average DESC) AS rank
          FROM totals t
      )
      SELECT r.metric_key AS "metricKey", r.rank::int AS rank, r.player_id AS "playerId",
             p.display_name AS "displayName", p.sort_name AS "sortName", p.slug,
             r.recorded_games AS "recordedGames", r.total, r.average,
             r.a_recorded_games AS "aRecordedGames", r.a_total AS "aTotal",
             r.b_recorded_games AS "bRecordedGames", r.b_total AS "bTotal"
        FROM ranked r
        JOIN players p ON p.id = r.player_id
       WHERE r.rank <= ${H2H_AVERAGE_RANK_LIMIT}
       ORDER BY r.metric_key, r.rank, p.sort_name, r.player_id
    `,
  ]);

  const leadersByKey = new Map<string, H2HAverageLeader[]>();
  for (const row of leaderRows) {
    const leaders = leadersByKey.get(row.metricKey) ?? [];
    leaders.push({
      rank: row.rank,
      playerId: row.playerId,
      displayName: row.displayName,
      sortName: row.sortName,
      slug: row.slug,
      recordedGames: row.recordedGames,
      total: Number(row.total),
      average: Number(row.average),
      a: {
        recordedGames: row.aRecordedGames,
        total: row.aRecordedGames > 0 ? Number(row.aTotal) : null,
        average: row.aRecordedGames > 0 ? Number(row.aTotal) / row.aRecordedGames : null,
      },
      b: {
        recordedGames: row.bRecordedGames,
        total: row.bRecordedGames > 0 ? Number(row.bTotal) : null,
        average: row.bRecordedGames > 0 ? Number(row.bTotal) / row.bRecordedGames : null,
      },
    });
    leadersByKey.set(row.metricKey, leaders);
  }

  const coverageByKey = new Map<string, Map<MetricCoverage, number>>();
  for (const row of coverageRows) {
    const states = coverageByKey.get(row.statKey) ?? new Map<MetricCoverage, number>();
    states.set(row.coverage, row.seasons);
    coverageByKey.set(row.statKey, states);
  }

  const meetings = Number(population?.meetings ?? 0);
  const rivalrySeasons = Number(population?.rivalrySeasons ?? 0);

  const boards = H2H_AVERAGE_METRICS.map((m): H2HAverageBoard => {
    const states = coverageByKey.get(m.statKey) ?? new Map<MetricCoverage, number>();
    const seasonsByCoverage: Record<MetricCoverage, number> = {
      complete: states.get('complete') ?? 0,
      partial: states.get('partial') ?? 0,
      pending: states.get('pending') ?? 0,
      not_collected: states.get('not_collected') ?? 0,
      not_applicable: states.get('not_applicable') ?? 0,
      missing: states.get('missing') ?? 0,
    };
    const coveredSeasons = seasonsByCoverage.complete + seasonsByCoverage.partial;
    const isAvailable = coveredSeasons > 0;
    return {
      key: m.key,
      statKey: m.statKey,
      label: m.label,
      rivalrySeasons,
      coveredSeasons,
      uncoveredSeasons: rivalrySeasons - coveredSeasons,
      seasonsByCoverage,
      isAvailable,
      hasCoverageGap: isAvailable && coveredSeasons < rivalrySeasons,
      minimumRecordedGames: H2H_AVERAGE_MINIMUM_RECORDED_GAMES,
      // An unavailable metric presents no board at all: runtime coverage
      // decides availability, and rows behind it are not shown anyway.
      leaders: isAvailable ? (leadersByKey.get(m.key) ?? []) : [],
    };
  });

  return {
    meetings,
    rivalrySeasons,
    minimumRecordedGames: H2H_AVERAGE_MINIMUM_RECORDED_GAMES,
    rankLimit: H2H_AVERAGE_RANK_LIMIT,
    boards,
  };
}
