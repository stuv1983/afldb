import 'server-only';

import { sql } from '@/db/client';
import { afterSirenRequiresMatchLink, type NlQueryPlan } from '@/search/nl/plan';
import type {
  NlAfterSirenEventRow, NlAfterSirenExclusions, NlAfterSirenPlayerRow, NlAnswerPayload,
} from '@/search/nl/answer-types';

type SqlFragment = ReturnType<typeof sql>;

/**
 * The after_siren grain: AFLDB's curated, cited list of kicks after the
 * siren (`after_siren_kicks`, migration 089).
 *
 * This is NOT a second derivation of db/queries/after-siren.ts, and nor is
 * it a parameterised copy of it. `getAfterSirenRecords` is the Records
 * board, whose five-CTE first/last-attempt/first/last-goal shape answers a
 * different question. What this compiler SHARES with it verbatim, and must
 * not re-decide:
 *
 *  - the trusted-link rule (`player_id IS NOT NULL`, and -- because
 *    `after_siren_kicks_link_ck` already binds them -- `link_status_value
 *    IN ('unique','resolved')` stated explicitly anyway);
 *  - `COALESCE(cl.name, a.club_name_raw)` / `COALESCE(op.name,
 *    a.opponent_name_raw)` club naming, and the slug-null-when-unresolved
 *    convention;
 *  - `LEFT JOIN matches m ON m.id = a.match_id` as the ONLY route to a
 *    canonical match property.
 *
 * Ownership is encoded structurally rather than by convention:
 *
 *  - The base relation is `after_siren_kicks a`, alone. Every dimension,
 *    the season, both raw club names, the competition, the
 *    `premiership_season` flag and the citation come from it and from
 *    nothing else.
 *  - `matches` is joined LEFT and used ONLY to project `match_date` and
 *    `round_type`. When afterSirenRequiresMatchLink(plan) is true -- and
 *    only then -- `a.match_id IS NOT NULL` is emitted too, promoting the
 *    join to an effective inner join and excluding unlinked rows.
 *  - `a.premiership_season` is emitted as a filter ONLY alongside a match
 *    type. It is never emitted merely to make a match link likely: D10 is
 *    explicit that `match_id` must not be required because an event is
 *    premiership-season, and the converse discipline applies here.
 *  - **`round_raw` is never read as a filter, by any code path here.** It
 *    is projected for display and nothing else. The witness is Kerry Good,
 *    1980, `round_raw = 'GF'`, North Melbourne v Collingwood -- an ESCORT
 *    CHAMPIONSHIPS match with `premiership_season = false`. Any round- or
 *    finals-shaped filter reading `round_raw` returns that row as a Grand
 *    Final. Finals scope goes through `matches.round_type` /
 *    `matches.is_finals_series` instead.
 *  - All SQL is parameterised. Every enum value reaching SQL is bound and
 *    is one of the closed union members on NlAfterSiren, never text from
 *    the question.
 *
 * `shot_detail`, `supergoal_scoring`, the verbatim source scores, the link
 * provenance and the source notes are neither selected nor rendered.
 */

function foldAnd(clauses: SqlFragment[]): SqlFragment {
  if (clauses.length === 0) return sql`TRUE`;
  return clauses.reduce((acc, clause) => sql`${acc} AND ${clause}`);
}

/**
 * The question's own filters: the three independent typed dimensions, the
 * subject player, the club lineages and the season range. Deliberately
 * EXCLUDES the ownership requirements (match link, trusted player link),
 * which are added separately so the excluded rows can be counted against
 * the same set the reader asked about.
 */
function baseClauses(plan: NlQueryPlan): SqlFragment[] {
  const clauses: SqlFragment[] = [];
  const siren = plan.afterSiren;

  // Three INDEPENDENT dimensions, ANDed and never merged: what the kick
  // registered, what it did to the result, and the match result from the
  // kicker's side. "A goal after the siren" is kickScored alone; "a goal
  // after the siren TO WIN" is kickScored AND kickEffect, and the two are
  // different populations.
  if (siren?.kickScored) clauses.push(sql`a.kick_scored = ${siren.kickScored}`);
  if (siren?.kickEffect) clauses.push(sql`a.kick_effect = ${siren.kickEffect}`);
  if (siren?.kickerResult) clauses.push(sql`a.kicker_result = ${siren.kickerResult}`);

  if (plan.player) clauses.push(sql`a.player_id = ${plan.player.id}`);

  // Club scope folds the whole organization_id lineage, exactly as the
  // club page and coach-record.ts do. The measured witness is Bill Wood,
  // Footscray, 1946: one of the four goals after the siren against the
  // RICHMOND organization, and a raw club_id comparison would drop it.
  // Nothing of Fitzroy's ever reaches Brisbane Lions -- a merger is a
  // different organisation.
  if (plan.scope.clubFor) {
    clauses.push(sql`a.club_id IN (SELECT id FROM clubs WHERE organization_id = ${plan.scope.clubFor.organizationId})`);
  }
  if (plan.scope.clubAgainst) {
    clauses.push(sql`a.opponent_club_id IN (SELECT id FROM clubs WHERE organization_id = ${plan.scope.clubAgainst.organizationId})`);
  }

  if (plan.scope.seasonMin !== undefined) clauses.push(sql`a.season >= ${plan.scope.seasonMin}`);
  if (plan.scope.seasonMax !== undefined) clauses.push(sql`a.season <= ${plan.scope.seasonMax}`);
  return clauses;
}

/**
 * The D10 ownership requirements, on top of the question's own filters.
 * `matches` is the only source of a match type, so any match type -- home
 * and away included -- also requires the link.
 */
function ownershipClauses(plan: NlQueryPlan): SqlFragment[] {
  const clauses: SqlFragment[] = [];
  if (afterSirenRequiresMatchLink(plan)) clauses.push(sql`a.match_id IS NOT NULL`);
  const matchType = plan.scope.matchType;
  if (matchType !== undefined) {
    // Belt and braces: after_siren_kicks_match_ck already implies this for
    // any row carrying a match id, and stating it makes the query
    // self-evidently right rather than right by inference.
    clauses.push(sql`a.premiership_season`);
    clauses.push(matchType === 'finals'
      ? sql`m.is_finals_series`
      : sql`m.round_type = ${matchType}`);
  }
  return clauses;
}

/** The trusted-link rule. A player-subject answer counts nothing else. */
const TRUSTED_LINK = sql`a.player_id IS NOT NULL AND a.link_status_value IN ('unique', 'resolved')`;

const FROM_EVENTS = sql`
  FROM after_siren_kicks a
  LEFT JOIN clubs cl ON cl.id = a.club_id
  LEFT JOIN clubs op ON op.id = a.opponent_club_id
  LEFT JOIN matches m ON m.id = a.match_id
`;

const EVENT_SELECT = sql`
  a.id AS "eventId", a.season, a.round_raw AS "roundRaw", a.competition,
  a.premiership_season AS "premiershipSeason",
  a.player_id AS "playerId", p.slug AS "playerSlug", a.player_name_raw AS "playerName",
  COALESCE(cl.name, a.club_name_raw) AS "clubName", cl.slug AS "clubSlug",
  COALESCE(op.name, a.opponent_name_raw) AS "opponentName", op.slug AS "opponentSlug",
  a.kick_scored AS "kickScored", a.kick_effect AS "kickEffect",
  a.kicker_result AS "kickerResult", a.siren,
  a.match_id AS "matchId", m.match_date AS "matchDate", m.round_type AS "roundType",
  a.cited, NULL::float8 AS value
`;

/**
 * What the ownership rules left out of THIS answer, counted over the
 * question's own filters rather than over the whole table -- computed at
 * answer time so the caveat can never be a stale hard-coded number.
 */
async function exclusions(plan: NlQueryPlan): Promise<NlAfterSirenExclusions> {
  const base = foldAnd(baseClauses(plan));
  const [row] = await sql<{ no_player_link: string; no_match_link: string }[]>`
    SELECT count(*) FILTER (WHERE a.player_id IS NULL) AS no_player_link,
           count(*) FILTER (WHERE a.match_id IS NULL)  AS no_match_link
      FROM after_siren_kicks a
     WHERE ${base}
  `;
  return {
    noPlayerLink: Number(row?.no_player_link ?? 0),
    noMatchLink: Number(row?.no_match_link ?? 0),
  };
}

export async function answerAfterSiren(plan: NlQueryPlan, limit: number): Promise<NlAnswerPayload> {
  const where = foldAnd([...baseClauses(plan), ...ownershipClauses(plan)]);
  const excluded = await exclusions(plan);

  if (plan.afterSiren?.subject === 'player') return answerPlayers(plan, where, limit, excluded);
  if (plan.afterSiren?.occurrence) return answerOccurrence(plan, where, excluded);
  if (plan.agg.kind === 'count') return answerEventCount(where);
  return answerEventList(where, limit, excluded);
}

/** "How many kicks after the siren" -- the size of the qualifying set. */
async function answerEventCount(where: SqlFragment): Promise<NlAnswerPayload> {
  const [row] = await sql<{ value: string }[]>`
    SELECT count(*) AS value
      ${FROM_EVENTS}
     WHERE ${where}
  `;
  return { kind: 'count', value: Number(row?.value ?? 0) };
}

/**
 * The qualifying events themselves, ordered the way
 * getPlayerAfterSirenEvents already orders a player's own list, so the
 * same question asked two ways cannot come back in two different orders.
 */
async function answerEventList(
  where: SqlFragment,
  limit: number,
  excluded: NlAfterSirenExclusions,
): Promise<NlAnswerPayload> {
  const rows = await sql<(NlAfterSirenEventRow & { total: string })[]>`
    SELECT ${EVENT_SELECT}, count(*) OVER () AS total
      ${FROM_EVENTS}
      LEFT JOIN players p ON p.id = a.player_id
     WHERE ${where}
     ORDER BY a.season DESC, a.id DESC
     LIMIT ${limit}
  `;
  const total = rows[0] ? Number(rows[0].total) : 0;
  const clean = rows.map(({ total: _total, ...rest }) => rest);
  return { kind: 'after_siren_event', lead: clean[0] ?? null, rows: clean, total, excluded };
}

/**
 * "The first" / "the most recent" -- ordered by the CANONICAL match date
 * and nothing else. `round_raw` is free text ('GF', 'round 1', 'round 3'
 * all occur) and gives no within-season order, so a row with no match link
 * cannot be placed in a chronology at all and is excluded (D10 limit 1).
 * The caveat says how many were left out.
 */
async function answerOccurrence(
  plan: NlQueryPlan,
  where: SqlFragment,
  excluded: NlAfterSirenExclusions,
): Promise<NlAnswerPayload> {
  const ascending = plan.afterSiren?.occurrence === 'first';
  const direction = ascending ? sql.unsafe('ASC') : sql.unsafe('DESC');
  const rows = await sql<NlAfterSirenEventRow[]>`
    SELECT ${EVENT_SELECT}
      ${FROM_EVENTS}
      LEFT JOIN players p ON p.id = a.player_id
     WHERE ${where}
     ORDER BY m.match_date ${direction}, a.id ${direction}
     LIMIT 1
  `;
  return {
    kind: 'after_siren_event',
    lead: rows[0] ?? null,
    rows,
    total: rows.length,
    excluded,
  };
}

/**
 * The kicker leaderboard. Every superlative in this family is a TIE --
 * the measured maxima are 2 kicks, 2 goals and 2 winning kicks -- so this
 * uses the same `rank()` with no PARTITION BY every other grain uses and
 * returns every row at the lead rank. An answer that names one player
 * would be wrong by construction.
 */
async function answerPlayers(
  plan: NlQueryPlan,
  where: SqlFragment,
  limit: number,
  excluded: NlAfterSirenExclusions,
): Promise<NlAnswerPayload> {
  const totals = sql`
    SELECT a.player_id AS "playerId", p.slug, p.display_name AS "displayName",
           count(*)::int AS value,
           min(a.season)::int AS "firstSeason",
           max(a.season)::int AS "lastSeason",
           string_agg(DISTINCT COALESCE(cl.name, a.club_name_raw), ', ') AS "clubNames"
      ${FROM_EVENTS}
      JOIN players p ON p.id = a.player_id
     WHERE ${where} AND ${TRUSTED_LINK}
     GROUP BY a.player_id, p.slug, p.display_name
  `;

  if (plan.agg.kind === 'count') {
    const [row] = await sql<{ value: string }[]>`
      WITH t AS (${totals})
      SELECT count(*) AS value FROM t
    `;
    return { kind: 'count', value: Number(row?.value ?? 0) };
  }

  // A threshold lists every qualifier; it never ranks one. The measured
  // ceiling is 2, so "3 or more goals after the siren" comes back EMPTY --
  // an honest answer to a well-formed question, not a decline.
  if (plan.agg.kind === 'list') {
    const having = plan.metricCondition
      ? compareExpr(sql`t.value`, plan.metricCondition.op, plan.metricCondition.value)
      : sql`TRUE`;
    const rows = await sql<(NlAfterSirenPlayerRow & { total: string })[]>`
      WITH t AS (${totals})
      SELECT t.*, count(*) OVER () AS total
        FROM t
       WHERE ${having}
       ORDER BY t.value DESC, t."displayName"
       LIMIT ${limit}
    `;
    const total = rows[0] ? Number(rows[0].total) : 0;
    const clean = rows.map(({ total: _total, ...rest }) => rest);
    return { kind: 'after_siren_player', lead: clean[0] ?? null, rows: clean, total, excluded };
  }

  const n = plan.agg.kind === 'top_n' ? plan.agg.n : 1;
  const rows = await sql<(NlAfterSirenPlayerRow & { total: string; rnk: number })[]>`
    WITH t AS (${totals}),
    ranked AS (
      SELECT t.*, rank() OVER (ORDER BY t.value DESC)::int AS rnk FROM t
    )
    SELECT r.*, count(*) OVER () AS total
      FROM ranked r
     WHERE r.rnk <= ${n}
     ORDER BY r.value DESC, r."displayName"
     LIMIT ${limit}
  `;
  const total = rows[0] ? Number(rows[0].total) : 0;
  const clean = rows.map(({ total: _total, rnk: _rnk, ...rest }) => rest);
  return { kind: 'after_siren_player', lead: clean[0] ?? null, rows: clean, total, excluded };
}

/** A closed switch, the same discipline coach-record.ts applies: no operator reaches SQL as text. */
function compareExpr(value: SqlFragment, op: string, bound: number): SqlFragment {
  switch (op) {
    case 'gte': return sql`${value} >= ${bound}`;
    case 'gt': return sql`${value} > ${bound}`;
    case 'lte': return sql`${value} <= ${bound}`;
    case 'lt': return sql`${value} < ${bound}`;
    case 'eq': return sql`${value} = ${bound}`;
    default: throw new Error(`after_siren comparison "${op}" is not recognised.`);
  }
}
