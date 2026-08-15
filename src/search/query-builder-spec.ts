/**
 * Data QA query builder specification.
 *
 * A hidden, super-admin-only tool for ad-hoc statistical QA, modelled on
 * sports_data_lab's query_builder.py "Table filters" mode: pick a table,
 * pick a column, set an operator and value, add it as a condition. A
 * card holds any number of conditions combined by its own ALL (AND) /
 * ANY (OR) rule; each card after the first says how it joins the
 * accumulated result of the cards before it. That two-level shape --
 * cards of conditions, not unbounded nested groups -- is what "chain
 * more with AND/OR, or group them into cards" actually asked for; deeper
 * nesting and the reference's drag-and-drop visual tree were not.
 *
 * Security model, same three walls as advanced-spec.ts and the
 * reference this is modelled on, deliberately NOT built on live
 * information_schema discovery:
 *
 *   1. Table and column identifiers only ever come from QUERYABLE_TABLES
 *      below -- a curated allowlist, not a catalogue query. A discovery-
 *      based tool would need an explicit denylist to keep
 *      auth_users.password_hash out of reach; an allowlist cannot leak
 *      what was never listed.
 *   2. Every operator comes from the fixed per-kind vocabulary
 *      (OPERATORS_BY_KIND); nothing typed is ever compiled as an
 *      operator.
 *   3. Every value is bound as a query parameter by the compiler in
 *      src/db/queries/query-builder.ts, never spliced into SQL text.
 *
 * This module is shared by the server compiler and the Client Component
 * form, so it carries no server-only imports.
 */

import { decodeUrlState, encodeUrlState } from '@/lib/urlState';

export type ColumnKind = 'integer' | 'float' | 'text' | 'date' | 'boolean';

export type ColumnDef = {
  key: string;
  label: string;
  /** Fixed, qualified SQL expression. Never derived from user input. */
  column: string;
  kind: ColumnKind;
};

export type TableDef = {
  key: string;
  label: string;
  /** Fixed FROM ... [JOIN ...] fragment, already aliased. */
  from: string;
  /** Fixed ORDER BY fragment used when no sort column is chosen. */
  defaultSort: string;
  columns: Record<string, ColumnDef>;
  /** Columns shown in the results table, in order. */
  displayColumns: string[];
};

// ---------------------------------------------------------------- catalogue

/**
 * What may be queried. Adding a table is one entry here, exactly the
 * spirit of "adding a dataset is one DatasetSpec" for uploads -- the
 * page and compiler are generic over whatever this lists. Joins bring in
 * a human-readable label (player name, club names) the same way
 * db/queries/advanced-search.ts joins players to player_career_stats,
 * so results are legible without a second lookup.
 */
export const QUERYABLE_TABLES: Record<string, TableDef> = {
  players: {
    key: 'players',
    label: 'Players',
    from: 'players p',
    defaultSort: 'p.sort_name',
    displayColumns: ['display_name', 'debut_season', 'final_season', 'dob', 'height_cm'],
    columns: {
      display_name: { key: 'display_name', label: 'Name', column: 'p.display_name', kind: 'text' },
      given_name: { key: 'given_name', label: 'Given name', column: 'p.given_name', kind: 'text' },
      surname: { key: 'surname', label: 'Surname', column: 'p.surname', kind: 'text' },
      slug: { key: 'slug', label: 'Slug', column: 'p.slug', kind: 'text' },
      dob: { key: 'dob', label: 'Date of birth', column: 'p.dob', kind: 'date' },
      dob_confidence: { key: 'dob_confidence', label: 'DOB confidence', column: 'p.dob_confidence::text', kind: 'text' },
      birth_year: { key: 'birth_year', label: 'Birth year', column: 'p.birth_year', kind: 'integer' },
      height_cm: { key: 'height_cm', label: 'Height (cm)', column: 'p.height_cm', kind: 'integer' },
      weight_kg: { key: 'weight_kg', label: 'Weight (kg)', column: 'p.weight_kg', kind: 'integer' },
      debut_season: { key: 'debut_season', label: 'Debut season', column: 'p.debut_season', kind: 'integer' },
      final_season: { key: 'final_season', label: 'Final season', column: 'p.final_season', kind: 'integer' },
      legacy_player_id: { key: 'legacy_player_id', label: 'Legacy player id', column: 'p.legacy_player_id', kind: 'integer' },
    },
  },

  player_career_stats: {
    key: 'player_career_stats',
    label: 'Player career stats',
    from: 'players p JOIN player_career_stats c ON c.player_id = p.id',
    defaultSort: 'c.games DESC, p.sort_name',
    displayColumns: ['display_name', 'games', 'goals', 'finals', 'premierships', 'brownlow_votes'],
    columns: {
      display_name: { key: 'display_name', label: 'Name', column: 'p.display_name', kind: 'text' },
      games: { key: 'games', label: 'Games', column: 'c.games', kind: 'integer' },
      finals: { key: 'finals', label: 'Finals', column: 'c.finals', kind: 'integer' },
      premierships: { key: 'premierships', label: 'Premierships', column: 'c.premierships', kind: 'integer' },
      wins: { key: 'wins', label: 'Wins', column: 'c.wins', kind: 'integer' },
      losses: { key: 'losses', label: 'Losses', column: 'c.losses', kind: 'integer' },
      goals: { key: 'goals', label: 'Goals', column: 'c.goals', kind: 'integer' },
      disposals: { key: 'disposals', label: 'Disposals', column: 'c.disposals', kind: 'integer' },
      disposals_recorded_games: {
        key: 'disposals_recorded_games', label: 'Games with disposals recorded',
        column: 'c.disposals_recorded_games', kind: 'integer',
      },
      tackles: { key: 'tackles', label: 'Tackles', column: 'c.tackles', kind: 'integer' },
      tackles_recorded_games: {
        key: 'tackles_recorded_games', label: 'Games with tackles recorded',
        column: 'c.tackles_recorded_games', kind: 'integer',
      },
      brownlow_votes: { key: 'brownlow_votes', label: 'Brownlow votes', column: 'c.brownlow_votes', kind: 'integer' },
      brownlow_medals: { key: 'brownlow_medals', label: 'Brownlow medals', column: 'c.brownlow_medals', kind: 'integer' },
      clubs_played: { key: 'clubs_played', label: 'Clubs played', column: 'c.clubs_played', kind: 'integer' },
      seasons_played: { key: 'seasons_played', label: 'Seasons played', column: 'c.seasons_played', kind: 'integer' },
      debut_season: { key: 'debut_season', label: 'Debut season', column: 'c.debut_season', kind: 'integer' },
      final_season: { key: 'final_season', label: 'Final season', column: 'c.final_season', kind: 'integer' },
      debut_date: { key: 'debut_date', label: 'Debut date', column: 'c.debut_date', kind: 'date' },
      last_match_date: { key: 'last_match_date', label: 'Last match date', column: 'c.last_match_date', kind: 'date' },
      rebuilt_at: { key: 'rebuilt_at', label: 'Rebuilt at', column: 'c.rebuilt_at::date', kind: 'date' },
    },
  },

  clubs: {
    key: 'clubs',
    label: 'Clubs',
    from: 'clubs cl',
    defaultSort: 'cl.name',
    displayColumns: ['name', 'short_name', 'succession', 'is_current_afl_club', 'first_season', 'last_season'],
    columns: {
      name: { key: 'name', label: 'Name', column: 'cl.name', kind: 'text' },
      short_name: { key: 'short_name', label: 'Short name', column: 'cl.short_name', kind: 'text' },
      abbreviation: { key: 'abbreviation', label: 'Abbreviation', column: 'cl.abbreviation', kind: 'text' },
      slug: { key: 'slug', label: 'Slug', column: 'cl.slug', kind: 'text' },
      succession: { key: 'succession', label: 'Succession', column: 'cl.succession::text', kind: 'text' },
      is_current_afl_club: { key: 'is_current_afl_club', label: 'Current AFL club', column: 'cl.is_current_afl_club', kind: 'boolean' },
      first_season: { key: 'first_season', label: 'First season', column: 'cl.first_season', kind: 'integer' },
      last_season: { key: 'last_season', label: 'Last season', column: 'cl.last_season', kind: 'integer' },
      home_state: { key: 'home_state', label: 'Home state', column: 'cl.home_state', kind: 'text' },
    },
  },

  matches: {
    key: 'matches',
    label: 'Matches',
    from: 'matches m '
      + 'JOIN clubs hc ON hc.id = m.home_club_id '
      + 'JOIN clubs ac ON ac.id = m.away_club_id',
    defaultSort: 'm.match_date DESC',
    displayColumns: ['season', 'round_code', 'match_date', 'home_score', 'away_score', 'venue_raw'],
    columns: {
      season: { key: 'season', label: 'Season', column: 'm.season', kind: 'integer' },
      round_code: { key: 'round_code', label: 'Round', column: 'm.round_code', kind: 'text' },
      round_type: { key: 'round_type', label: 'Round type', column: 'm.round_type::text', kind: 'text' },
      is_final: { key: 'is_final', label: 'Is final', column: 'm.is_final', kind: 'boolean' },
      match_date: { key: 'match_date', label: 'Match date', column: 'm.match_date', kind: 'date' },
      venue_raw: { key: 'venue_raw', label: 'Venue (as recorded)', column: 'm.venue_raw', kind: 'text' },
      home_club: { key: 'home_club', label: 'Home club', column: 'hc.name', kind: 'text' },
      away_club: { key: 'away_club', label: 'Away club', column: 'ac.name', kind: 'text' },
      home_score: { key: 'home_score', label: 'Home score', column: 'm.home_score', kind: 'integer' },
      away_score: { key: 'away_score', label: 'Away score', column: 'm.away_score', kind: 'integer' },
      result: { key: 'result', label: 'Result', column: 'm.result::text', kind: 'text' },
      margin: { key: 'margin', label: 'Margin', column: 'm.margin', kind: 'integer' },
      attendance: { key: 'attendance', label: 'Attendance', column: 'm.attendance', kind: 'integer' },
    },
  },

  player_match_stats: {
    key: 'player_match_stats',
    label: 'Player match stats',
    from: 'player_match_stats pms '
      + 'JOIN players p ON p.id = pms.player_id '
      + 'JOIN matches m ON m.id = pms.match_id '
      + 'JOIN clubs cl ON cl.id = pms.club_id',
    defaultSort: 'm.match_date DESC',
    displayColumns: ['display_name', 'match_date', 'club', 'kicks', 'disposals', 'goals'],
    columns: {
      display_name: { key: 'display_name', label: 'Player', column: 'p.display_name', kind: 'text' },
      season: { key: 'season', label: 'Season', column: 'm.season', kind: 'integer' },
      match_date: { key: 'match_date', label: 'Match date', column: 'm.match_date', kind: 'date' },
      club: { key: 'club', label: 'Club (on the day)', column: 'cl.name', kind: 'text' },
      jumper_number: { key: 'jumper_number', label: 'Jumper number', column: 'pms.jumper_number', kind: 'text' },
      kicks: { key: 'kicks', label: 'Kicks', column: 'pms.kicks', kind: 'integer' },
      handballs: { key: 'handballs', label: 'Handballs', column: 'pms.handballs', kind: 'integer' },
      disposals: { key: 'disposals', label: 'Disposals', column: 'pms.disposals', kind: 'integer' },
      marks: { key: 'marks', label: 'Marks', column: 'pms.marks', kind: 'integer' },
      goals: { key: 'goals', label: 'Goals', column: 'pms.goals', kind: 'integer' },
      behinds: { key: 'behinds', label: 'Behinds', column: 'pms.behinds', kind: 'integer' },
      tackles: { key: 'tackles', label: 'Tackles', column: 'pms.tackles', kind: 'integer' },
      hitouts: { key: 'hitouts', label: 'Hitouts', column: 'pms.hitouts', kind: 'integer' },
      brownlow_votes: { key: 'brownlow_votes', label: 'Brownlow votes (this game)', column: 'pms.brownlow_votes', kind: 'integer' },
    },
  },
};

export const TABLE_KEYS = Object.keys(QUERYABLE_TABLES);

// ------------------------------------------------------------------ operators

export const NUMERIC_OPS = ['=', '!=', '>', '>=', '<', '<=', 'between', 'is null', 'is not null'] as const;
export const TEXT_OPS = ['equals', 'contains', 'starts with', 'ends with', 'is null', 'is not null'] as const;
export const DATE_OPS = ['on', 'before', 'after', 'on or before', 'on or after', 'between', 'is null', 'is not null'] as const;
export const BOOLEAN_OPS = ['is true', 'is false'] as const;

export const OPERATORS_BY_KIND: Record<ColumnKind, readonly string[]> = {
  integer: NUMERIC_OPS,
  float: NUMERIC_OPS,
  text: TEXT_OPS,
  date: DATE_OPS,
  boolean: BOOLEAN_OPS,
};

// ------------------------------------------------------------------- limits

/** Abuse limits, the same spirit as advanced-spec.ts's LIMITS. */
export const QB_LIMITS = {
  maxCards: 6,
  maxConditionsPerCard: 8,
  defaultPageSize: 50,
  maxPage: 50,
  /** Hard ceiling on a share token's decoded size. */
  maxStateChars: 8_192,
} as const;

// --------------------------------------------------------------------- AST

export type ConditionSpec = {
  column: string;
  op: string;
  value?: string | number;
  lo?: string | number;
  hi?: string | number;
};

export type CardSpec = {
  /** How conditions inside this card combine. */
  match: 'AND' | 'OR';
  conditions: ConditionSpec[];
};

export type CardGroup = {
  /** How this card joins the accumulated result of the cards before it. Ignored on the first card. */
  join: 'AND' | 'OR';
  card: CardSpec;
};

export type QueryBuilderState = {
  table: string;
  cards: CardGroup[];
  sort?: string;
  page: number;
};

export function emptyState(table: string): QueryBuilderState {
  return { table, cards: [{ join: 'AND', card: { match: 'AND', conditions: [] } }], page: 1 };
}

// ------------------------------------------------------------ URL state

/**
 * The builder's state as a compact, shareable URL token: JSON, then
 * base64url (lib/urlState.ts). Not compressed (the reference's zlib
 * step): this state is a handful of conditions, not a whole DNF-expanded
 * query, so the extra dependency and decompression-bomb surface would
 * buy nothing here.
 */
export function serializeQueryState(state: QueryBuilderState): string {
  return encodeUrlState(state, QB_LIMITS.maxStateChars);
}

export function parseQueryState(token: string): QueryBuilderState | null {
  const raw = decodeUrlState(token, QB_LIMITS.maxStateChars);
  return raw === null ? null : validateState(raw);
}

/** Structural validation of a decoded payload; returns null rather than throwing on anything malformed. */
function validateState(raw: unknown): QueryBuilderState | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const table = obj.table;
  if (typeof table !== 'string' || !Object.hasOwn(QUERYABLE_TABLES, table)) return null;

  const cardsRaw = obj.cards;
  if (!Array.isArray(cardsRaw) || cardsRaw.length === 0 || cardsRaw.length > QB_LIMITS.maxCards) return null;

  const cards: CardGroup[] = [];
  for (const entry of cardsRaw) {
    if (!entry || typeof entry !== 'object') return null;
    const e = entry as Record<string, unknown>;
    const join = e.join === 'OR' ? 'OR' : 'AND';
    const cardRaw = e.card;
    if (!cardRaw || typeof cardRaw !== 'object') return null;
    const c = cardRaw as Record<string, unknown>;
    const match = c.match === 'OR' ? 'OR' : 'AND';
    const conditionsRaw = c.conditions;
    if (!Array.isArray(conditionsRaw) || conditionsRaw.length > QB_LIMITS.maxConditionsPerCard) return null;

    const conditions: ConditionSpec[] = [];
    for (const cond of conditionsRaw) {
      if (!cond || typeof cond !== 'object') return null;
      const spec = cond as Record<string, unknown>;
      if (typeof spec.column !== 'string' || typeof spec.op !== 'string') return null;
      if (spec.value !== undefined && typeof spec.value !== 'string' && typeof spec.value !== 'number') return null;
      if (spec.lo !== undefined && typeof spec.lo !== 'string' && typeof spec.lo !== 'number') return null;
      if (spec.hi !== undefined && typeof spec.hi !== 'string' && typeof spec.hi !== 'number') return null;
      conditions.push({
        column: spec.column, op: spec.op,
        value: spec.value as string | number | undefined,
        lo: spec.lo as string | number | undefined,
        hi: spec.hi as string | number | undefined,
      });
    }
    cards.push({ join, card: { match, conditions } });
  }

  const sort = typeof obj.sort === 'string' ? obj.sort : undefined;
  const pageRaw = Number(obj.page);
  const page = Number.isSafeInteger(pageRaw) && pageRaw >= 1 ? Math.min(pageRaw, QB_LIMITS.maxPage) : 1;

  return { table, cards, sort, page };
}
