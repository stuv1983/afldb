/**
 * Data QA query builder specification.
 *
 * A hidden, super-admin-only tool for ad-hoc statistical QA, modelled on
 * sports_data_lab's query_builder.py "Table filters" mode. A card holds any
 * number of conditions combined by its own ALL/ANY rule; each card after the
 * first says how it joins the accumulated result of those before it. Two
 * levels deliberately — deeper nesting and the reference's drag-and-drop tree
 * were not wanted.
 *
 * Since AFLDB-ISSUE-115 a query has an ANCHOR and each card has a DOMAIN:
 *
 *   - The anchor (`QueryBuilderState.table`, name kept so older URL tokens
 *     still parse) is the relation whose rows are returned. It alone owns
 *     the FROM clause, the result columns and the default sort.
 *   - A card either filters the anchor's own columns (no `domain`, the
 *     pre-115 shape) or filters a RELATED domain reached through one of the
 *     anchor's subjects (`domain` = a RELATIONSHIPS key). A related card is
 *     a self-contained boolean on the anchor row — "there is at least one /
 *     there is no such related row" — compiled as a correlated
 *     EXISTS / NOT EXISTS. Cards never share row-level variables and no
 *     related relation ever joins the anchor's FROM, so one output row is
 *     always one anchor row and cross-card AND/OR combines booleans only.
 *
 * Security rests on three walls, and deliberately not on live
 * information_schema discovery:
 *
 *   1. Identifiers come only from QUERYABLE_TABLES and RELATIONSHIPS below.
 *      A discovery-based tool would need a denylist to keep
 *      auth_users.password_hash out of reach; an allowlist cannot leak what
 *      was never listed. A schema foreign key is not a licence to traverse:
 *      only the curated relationships here may be composed.
 *   2. Operators come only from OPERATORS_BY_KIND; nothing typed is compiled
 *      as an operator.
 *   3. Values are bound as query parameters by the compiler in
 *      src/db/queries/query-builder.ts, never spliced into SQL text — inside
 *      subqueries as much as outside.
 *
 * Shared by the server compiler and the Client Component form, so it carries
 * no server-only imports.
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

/**
 * A subject is something an anchor row identifies unambiguously and that a
 * relationship can be declared FROM. Each subject fixes one canonical
 * anchor-side alias (SUBJECT_ALIASES), which every anchor `from` fragment
 * declaring that subject already uses — so a relationship's correlation
 * predicate is a plain constant, with no placeholder substitution.
 */
export type SubjectKey = 'player' | 'club' | 'match';

export const SUBJECT_ALIASES: Record<SubjectKey, string> = {
  player: 'p',
  club: 'cl',
  match: 'm',
};

/**
 * Every alias any anchor `from` fragment declares. Relationship subqueries
 * use only `r_`-prefixed aliases, which are disjoint from this set, so a
 * correlated subquery can never shadow the anchor row.
 */
export const ANCHOR_ALIASES = ['p', 'c', 'cl', 'm', 'hc', 'ac', 'pms'] as const;

export type AnchorDef = {
  key: string;
  label: string;
  /** Fixed FROM ... [JOIN ...] fragment, already aliased. */
  from: string;
  /** Fixed ORDER BY fragment used when no sort column is chosen. */
  defaultSort: string;
  columns: Record<string, ColumnDef>;
  /** Columns shown in the results table, in order. */
  displayColumns: string[];
  /** Subjects this anchor identifies unambiguously; each must be aliased canonically in `from`. */
  subjects: SubjectKey[];
  /** The relation whose row this anchor returns. */
  grainTable: string;
  /** The subject that uniquely identifies the returned row, or null when no single subject does. */
  grainSubject: SubjectKey | null;
};

/** Kept as an alias so pre-115 imports keep compiling; an anchor is what a "table" always was. */
export type TableDef = AnchorDef;

export type RelationshipDef = {
  /** Stable key; appears in the URL token as a card's `domain`. */
  key: string;
  subject: SubjectKey;
  /** UI domain-select label. */
  label: string;
  /** One plain-English line under the select. */
  hint: string;
  /** Fixed FROM fragment for use INSIDE the correlated subquery. `r_` aliases only. */
  subqueryFrom: string;
  /** Fixed correlation predicate. Uses `r_` aliases and the subject's canonical anchor alias. */
  correlation: string;
  /** The relation whose rows this relationship yields — used by the self-equivalence rule. */
  targetTable: string;
  cardinality: 'one' | 'many';
  /** Qualified with the `r_` aliases `subqueryFrom` declares (a curated predicate may also use the subject alias). */
  columns: Record<string, ColumnDef>;
};

// ---------------------------------------------------------------- catalogue

/**
 * What may be returned. Adding an anchor is one entry here, exactly the
 * spirit of "adding a dataset is one DatasetSpec" for uploads -- the
 * page and compiler are generic over whatever this lists. Joins bring in
 * a human-readable label (player name, club names) the same way
 * db/queries/advanced-search.ts joins players to player_career_stats,
 * so results are legible without a second lookup.
 *
 * The `from`, `defaultSort`, `columns` and `displayColumns` of these five
 * entries are unchanged by AFLDB-ISSUE-115; only `subjects`, `grainTable`
 * and `grainSubject` were added.
 */
export const QUERYABLE_TABLES: Record<string, AnchorDef> = {
  players: {
    key: 'players',
    label: 'Players',
    from: 'players p',
    defaultSort: 'p.sort_name',
    displayColumns: ['display_name', 'debut_season', 'final_season', 'dob', 'height_cm'],
    subjects: ['player'],
    grainTable: 'players',
    grainSubject: 'player',
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
    subjects: ['player'],
    grainTable: 'player_career_stats',
    grainSubject: 'player',
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
    subjects: ['club'],
    grainTable: 'clubs',
    grainSubject: 'club',
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
    // Not `club`: a match has two clubs, so a club subject would be ambiguous. Refused deliberately.
    subjects: ['match'],
    grainTable: 'matches',
    grainSubject: 'match',
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
    // AFLDB-ISSUE-115 Stage 5 (operator-approved, 2026-08-30): this anchor
    // hosts NO related-domain cards in V1, although `from` still aliases
    // p / cl / m canonically. Every relationship measured RED under this
    // anchor -- four shapes exceeded the 5 s statement timeout and none met
    // the < 1 s target -- because the anchor's own pre-115 materialisation
    // (685k rows through `count(*) OVER ()` + ordered LIMIT) is already
    // > 1 s with no card at all; the §9.3 InitPlan form was measured and
    // cannot reach the target either. Anchor-domain filtering and the
    // result grain are unchanged; every relationship remains available
    // under its other anchors. Related filtering at this grain is deferred
    // until the anchor baseline itself is fixed (separate follow-up work).
    // Evidence: runbook §20.5.
    subjects: [],
    grainTable: 'player_match_stats',
    // A player-match row is keyed by (player, match); no single subject identifies it.
    grainSubject: null,
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

// ------------------------------------------------------------ relationships

/**
 * The curated relationship graph. A relationship is declared from a
 * SUBJECT, not from an anchor, so every anchor providing that subject
 * inherits it (player_career_stats gets every player-side relationship
 * for free). Only these may be composed: no user-chosen join key, no
 * user-chosen path, no discovery, and exactly one hop per card.
 *
 * Every club-touching relationship correlates on club_id — the
 * season-correct historical identity — never on clubs.organization_id.
 * A lineage-combining relationship, if ever wanted, must be a separate
 * explicitly keyed entry, never an implicit widening.
 *
 * `subqueryFrom` and `correlation` are catalogue constants at the same
 * trust level as an anchor's `from`; the compiler splices them with
 * sql.unsafe and binds every user value as a parameter.
 */
export const RELATIONSHIPS: Record<string, RelationshipDef> = {
  // ---- subject: player (anchor alias p) ---------------------------------
  'player.career': {
    key: 'player.career',
    subject: 'player',
    label: 'Player career stats',
    hint: 'The career summary row for this player (one row per player).',
    subqueryFrom: 'player_career_stats r_c',
    correlation: 'r_c.player_id = p.id',
    targetTable: 'player_career_stats',
    cardinality: 'one',
    columns: {
      games: { key: 'games', label: 'Games', column: 'r_c.games', kind: 'integer' },
      finals: { key: 'finals', label: 'Finals', column: 'r_c.finals', kind: 'integer' },
      premierships: { key: 'premierships', label: 'Premierships', column: 'r_c.premierships', kind: 'integer' },
      wins: { key: 'wins', label: 'Wins', column: 'r_c.wins', kind: 'integer' },
      losses: { key: 'losses', label: 'Losses', column: 'r_c.losses', kind: 'integer' },
      goals: { key: 'goals', label: 'Goals', column: 'r_c.goals', kind: 'integer' },
      disposals: { key: 'disposals', label: 'Disposals', column: 'r_c.disposals', kind: 'integer' },
      tackles: { key: 'tackles', label: 'Tackles', column: 'r_c.tackles', kind: 'integer' },
      brownlow_votes: { key: 'brownlow_votes', label: 'Brownlow votes', column: 'r_c.brownlow_votes', kind: 'integer' },
      brownlow_medals: { key: 'brownlow_medals', label: 'Brownlow medals', column: 'r_c.brownlow_medals', kind: 'integer' },
      clubs_played: { key: 'clubs_played', label: 'Clubs played', column: 'r_c.clubs_played', kind: 'integer' },
      seasons_played: { key: 'seasons_played', label: 'Seasons played', column: 'r_c.seasons_played', kind: 'integer' },
      debut_season: { key: 'debut_season', label: 'Debut season', column: 'r_c.debut_season', kind: 'integer' },
      final_season: { key: 'final_season', label: 'Final season', column: 'r_c.final_season', kind: 'integer' },
      debut_date: { key: 'debut_date', label: 'Debut date', column: 'r_c.debut_date', kind: 'date' },
      last_match_date: { key: 'last_match_date', label: 'Last match date', column: 'r_c.last_match_date', kind: 'date' },
    },
  },

  'player.match_stats': {
    key: 'player.match_stats',
    subject: 'player',
    label: 'Player match stats',
    hint: 'Matches this player appeared in, one row per game.',
    subqueryFrom: 'player_match_stats r_pms '
      + 'JOIN matches r_m ON r_m.id = r_pms.match_id '
      + 'JOIN clubs r_cl ON r_cl.id = r_pms.club_id',
    correlation: 'r_pms.player_id = p.id',
    targetTable: 'player_match_stats',
    cardinality: 'many',
    columns: {
      season: { key: 'season', label: 'Season', column: 'r_m.season', kind: 'integer' },
      match_date: { key: 'match_date', label: 'Match date', column: 'r_m.match_date', kind: 'date' },
      round_code: { key: 'round_code', label: 'Round', column: 'r_m.round_code', kind: 'text' },
      is_final: { key: 'is_final', label: 'Is final', column: 'r_m.is_final', kind: 'boolean' },
      club: { key: 'club', label: 'Club (on the day)', column: 'r_cl.name', kind: 'text' },
      jumper_number: { key: 'jumper_number', label: 'Jumper number', column: 'r_pms.jumper_number', kind: 'text' },
      kicks: { key: 'kicks', label: 'Kicks', column: 'r_pms.kicks', kind: 'integer' },
      handballs: { key: 'handballs', label: 'Handballs', column: 'r_pms.handballs', kind: 'integer' },
      disposals: { key: 'disposals', label: 'Disposals', column: 'r_pms.disposals', kind: 'integer' },
      marks: { key: 'marks', label: 'Marks', column: 'r_pms.marks', kind: 'integer' },
      goals: { key: 'goals', label: 'Goals', column: 'r_pms.goals', kind: 'integer' },
      behinds: { key: 'behinds', label: 'Behinds', column: 'r_pms.behinds', kind: 'integer' },
      tackles: { key: 'tackles', label: 'Tackles', column: 'r_pms.tackles', kind: 'integer' },
      hitouts: { key: 'hitouts', label: 'Hitouts', column: 'r_pms.hitouts', kind: 'integer' },
      brownlow_votes: { key: 'brownlow_votes', label: 'Brownlow votes (this game)', column: 'r_pms.brownlow_votes', kind: 'integer' },
    },
  },

  'player.clubs': {
    key: 'player.clubs',
    subject: 'player',
    label: 'Player clubs',
    hint: 'Historical club identities this player represented, derived from match history.',
    subqueryFrom: 'player_clubs r_pc JOIN clubs r_pcl ON r_pcl.id = r_pc.club_id',
    correlation: 'r_pc.player_id = p.id',
    targetTable: 'player_clubs',
    cardinality: 'many',
    columns: {
      club: { key: 'club', label: 'Club', column: 'r_pcl.name', kind: 'text' },
      club_abbreviation: { key: 'club_abbreviation', label: 'Club abbreviation', column: 'r_pcl.abbreviation', kind: 'text' },
      games: { key: 'games', label: 'Games at club', column: 'r_pc.games', kind: 'integer' },
      goals: { key: 'goals', label: 'Goals at club', column: 'r_pc.goals', kind: 'integer' },
      first_season: { key: 'first_season', label: 'First season at club', column: 'r_pc.first_season', kind: 'integer' },
      last_season: { key: 'last_season', label: 'Last season at club', column: 'r_pc.last_season', kind: 'integer' },
    },
  },

  'player.draft_picks': {
    key: 'player.draft_picks',
    subject: 'player',
    label: 'Draft picks',
    hint: 'Draft and recruitment records linked to this player.',
    subqueryFrom: 'draft_picks r_dp LEFT JOIN clubs r_dcl ON r_dcl.id = r_dp.club_id',
    correlation: 'r_dp.player_id = p.id',
    targetTable: 'draft_picks',
    cardinality: 'many',
    columns: {
      draft_year: { key: 'draft_year', label: 'Draft year', column: 'r_dp.draft_year', kind: 'integer' },
      draft_type: { key: 'draft_type', label: 'Draft type', column: 'r_dp.draft_type', kind: 'text' },
      draft_kind: { key: 'draft_kind', label: 'Draft kind', column: 'r_dp.draft_kind', kind: 'text' },
      pick_number: { key: 'pick_number', label: 'Pick number', column: 'r_dp.pick_number', kind: 'integer' },
      club: { key: 'club', label: 'Club', column: 'r_dcl.name', kind: 'text' },
      club_name_raw: { key: 'club_name_raw', label: 'Club (as recorded)', column: 'r_dp.club_name_raw', kind: 'text' },
      link_status: { key: 'link_status', label: 'Link status', column: 'r_dp.link_status_value::text', kind: 'text' },
      draft_age: { key: 'draft_age', label: 'Draft age', column: 'r_dp.draft_age', kind: 'integer' },
      competition: { key: 'competition', label: 'Competition', column: 'r_dp.competition', kind: 'text' },
    },
  },

  'player.hall_of_fame': {
    key: 'player.hall_of_fame',
    subject: 'player',
    label: 'Hall of Fame',
    hint: 'Hall of Fame entries linked to this player.',
    subqueryFrom: 'hall_of_fame r_hof',
    correlation: 'r_hof.player_id = p.id',
    targetTable: 'hall_of_fame',
    cardinality: 'many',
    columns: {
      name: { key: 'name', label: 'Name (as recorded)', column: 'r_hof.name', kind: 'text' },
      category: { key: 'category', label: 'Category', column: 'r_hof.category', kind: 'text' },
      inducted_year: { key: 'inducted_year', label: 'Inducted year', column: 'r_hof.inducted_year', kind: 'integer' },
      is_legend: { key: 'is_legend', label: 'Is Legend', column: 'r_hof.is_legend', kind: 'boolean' },
      legend_year: { key: 'legend_year', label: 'Legend year', column: 'r_hof.legend_year', kind: 'integer' },
      club_name_raw: { key: 'club_name_raw', label: 'Club (as recorded)', column: 'r_hof.club_name_raw', kind: 'text' },
      state: { key: 'state', label: 'State', column: 'r_hof.state', kind: 'text' },
      link_status: { key: 'link_status', label: 'Link status', column: 'r_hof.link_status_value::text', kind: 'text' },
    },
  },

  'player.captaincies': {
    key: 'player.captaincies',
    subject: 'player',
    label: 'Captaincies',
    hint: 'Captaincy records linked to this player.',
    subqueryFrom: 'captaincies r_cap JOIN clubs r_ccl ON r_ccl.id = r_cap.club_id',
    correlation: 'r_cap.player_id = p.id',
    targetTable: 'captaincies',
    cardinality: 'many',
    columns: {
      season: { key: 'season', label: 'Season', column: 'r_cap.season', kind: 'integer' },
      club: { key: 'club', label: 'Club', column: 'r_ccl.name', kind: 'text' },
      role: { key: 'role', label: 'Role', column: 'r_cap.role', kind: 'text' },
      period: { key: 'period', label: 'Period', column: 'r_cap.period', kind: 'text' },
      link_status: { key: 'link_status', label: 'Link status', column: 'r_cap.link_status_value::text', kind: 'text' },
    },
  },

  'player.awards': {
    key: 'player.awards',
    subject: 'player',
    label: 'Awards',
    hint: 'Award-winner records linked to this player.',
    subqueryFrom: 'award_winners r_aw JOIN awards r_a ON r_a.id = r_aw.award_id',
    correlation: 'r_aw.player_id = p.id',
    targetTable: 'award_winners',
    cardinality: 'many',
    columns: {
      award: { key: 'award', label: 'Award', column: 'r_a.name', kind: 'text' },
      award_slug: { key: 'award_slug', label: 'Award slug', column: 'r_a.slug', kind: 'text' },
      award_category: { key: 'award_category', label: 'Award category', column: 'r_a.category', kind: 'text' },
      season: { key: 'season', label: 'Season', column: 'r_aw.season', kind: 'integer' },
      club_name_raw: { key: 'club_name_raw', label: 'Club (as recorded)', column: 'r_aw.club_name_raw', kind: 'text' },
      votes: { key: 'votes', label: 'Votes', column: 'r_aw.votes', kind: 'float' },
      position: { key: 'position', label: 'Position', column: 'r_aw.position', kind: 'text' },
      link_status: { key: 'link_status', label: 'Link status', column: 'r_aw.link_status_value::text', kind: 'text' },
    },
  },

  'player.link_candidates': {
    key: 'player.link_candidates',
    subject: 'player',
    label: 'Player-link candidates',
    hint: 'Unlinked honours rows for which this player is a suggested match.',
    subqueryFrom: 'player_link_match_candidates r_plmc',
    correlation: 'r_plmc.player_id = p.id',
    targetTable: 'player_link_match_candidates',
    cardinality: 'many',
    columns: {
      entity_type: { key: 'entity_type', label: 'Source record type', column: 'r_plmc.resolution_entity_type', kind: 'text' },
      target_table: { key: 'target_table', label: 'Target table', column: 'r_plmc.target_table', kind: 'text' },
      rank: { key: 'rank', label: 'Rank', column: 'r_plmc.rank', kind: 'integer' },
      score: { key: 'score', label: 'Score', column: 'r_plmc.score', kind: 'integer' },
      band: { key: 'band', label: 'Band', column: 'r_plmc.band', kind: 'text' },
      gap: { key: 'gap', label: 'Gap to next candidate', column: 'r_plmc.gap', kind: 'integer' },
      ambiguous: { key: 'ambiguous', label: 'Ambiguous', column: 'r_plmc.ambiguous', kind: 'boolean' },
      hard_conflict: { key: 'hard_conflict', label: 'Hard conflict', column: 'r_plmc.hard_conflict', kind: 'boolean' },
      bulk_eligible: { key: 'bulk_eligible', label: 'Bulk eligible', column: 'r_plmc.bulk_eligible', kind: 'boolean' },
    },
  },

  // ---- subject: club (anchor alias cl) -----------------------------------
  'club.club_seasons': {
    key: 'club.club_seasons',
    subject: 'club',
    label: 'Club seasons',
    hint: 'Seasons this club has a ladder record for.',
    subqueryFrom: 'club_seasons r_cs',
    correlation: 'r_cs.club_id = cl.id',
    targetTable: 'club_seasons',
    cardinality: 'many',
    columns: {
      season: { key: 'season', label: 'Season', column: 'r_cs.season', kind: 'integer' },
      played: { key: 'played', label: 'Played', column: 'r_cs.played', kind: 'integer' },
      wins: { key: 'wins', label: 'Wins', column: 'r_cs.wins', kind: 'integer' },
      draws: { key: 'draws', label: 'Draws', column: 'r_cs.draws', kind: 'integer' },
      losses: { key: 'losses', label: 'Losses', column: 'r_cs.losses', kind: 'integer' },
      points_for: { key: 'points_for', label: 'Points for', column: 'r_cs.points_for', kind: 'integer' },
      points_against: { key: 'points_against', label: 'Points against', column: 'r_cs.points_against', kind: 'integer' },
      premiership_points: { key: 'premiership_points', label: 'Premiership points', column: 'r_cs.premiership_points', kind: 'integer' },
      percentage: { key: 'percentage', label: 'Percentage', column: 'r_cs.percentage', kind: 'float' },
      ladder_rank: { key: 'ladder_rank', label: 'Ladder rank', column: 'r_cs.ladder_rank', kind: 'integer' },
      wooden_spoon: { key: 'wooden_spoon', label: 'Wooden spoon', column: 'r_cs.wooden_spoon', kind: 'boolean' },
      is_premier: { key: 'is_premier', label: 'Premier', column: 'r_cs.is_premier', kind: 'boolean' },
      finals_played: { key: 'finals_played', label: 'Finals played', column: 'r_cs.finals_played', kind: 'integer' },
    },
  },

  'club.matches': {
    key: 'club.matches',
    subject: 'club',
    label: 'Matches',
    hint: 'Matches this club played, home or away.',
    subqueryFrom: 'matches r_m',
    correlation: '(r_m.home_club_id = cl.id OR r_m.away_club_id = cl.id)',
    targetTable: 'matches',
    cardinality: 'many',
    columns: {
      season: { key: 'season', label: 'Season', column: 'r_m.season', kind: 'integer' },
      round_code: { key: 'round_code', label: 'Round', column: 'r_m.round_code', kind: 'text' },
      round_type: { key: 'round_type', label: 'Round type', column: 'r_m.round_type::text', kind: 'text' },
      is_final: { key: 'is_final', label: 'Is final', column: 'r_m.is_final', kind: 'boolean' },
      match_date: { key: 'match_date', label: 'Match date', column: 'r_m.match_date', kind: 'date' },
      venue_raw: { key: 'venue_raw', label: 'Venue (as recorded)', column: 'r_m.venue_raw', kind: 'text' },
      home_score: { key: 'home_score', label: 'Home score', column: 'r_m.home_score', kind: 'integer' },
      away_score: { key: 'away_score', label: 'Away score', column: 'r_m.away_score', kind: 'integer' },
      result: { key: 'result', label: 'Result', column: 'r_m.result::text', kind: 'text' },
      margin: { key: 'margin', label: 'Margin', column: 'r_m.margin', kind: 'integer' },
      attendance: { key: 'attendance', label: 'Attendance', column: 'r_m.attendance', kind: 'integer' },
    },
  },

  // ---- subject: match (anchor alias m) -----------------------------------
  'match.player_stats': {
    key: 'match.player_stats',
    subject: 'match',
    label: 'Player match stats',
    hint: 'Player rows recorded for this match.',
    subqueryFrom: 'player_match_stats r_pms '
      + 'JOIN players r_p ON r_p.id = r_pms.player_id '
      + 'JOIN clubs r_cl ON r_cl.id = r_pms.club_id',
    correlation: 'r_pms.match_id = m.id',
    targetTable: 'player_match_stats',
    cardinality: 'many',
    columns: {
      player: { key: 'player', label: 'Player', column: 'r_p.display_name', kind: 'text' },
      club: { key: 'club', label: 'Club (on the day)', column: 'r_cl.name', kind: 'text' },
      // Curated relational predicate: compares the related row with the
      // anchor row, which column/operator/value cannot express as a value.
      // The anchor alias `m` is in scope inside the correlated subquery.
      club_is_participant: {
        key: 'club_is_participant', label: 'Club is one of the two competing clubs',
        column: '(r_pms.club_id IN (m.home_club_id, m.away_club_id))', kind: 'boolean',
      },
      jumper_number: { key: 'jumper_number', label: 'Jumper number', column: 'r_pms.jumper_number', kind: 'text' },
      kicks: { key: 'kicks', label: 'Kicks', column: 'r_pms.kicks', kind: 'integer' },
      handballs: { key: 'handballs', label: 'Handballs', column: 'r_pms.handballs', kind: 'integer' },
      disposals: { key: 'disposals', label: 'Disposals', column: 'r_pms.disposals', kind: 'integer' },
      marks: { key: 'marks', label: 'Marks', column: 'r_pms.marks', kind: 'integer' },
      goals: { key: 'goals', label: 'Goals', column: 'r_pms.goals', kind: 'integer' },
      behinds: { key: 'behinds', label: 'Behinds', column: 'r_pms.behinds', kind: 'integer' },
      tackles: { key: 'tackles', label: 'Tackles', column: 'r_pms.tackles', kind: 'integer' },
      hitouts: { key: 'hitouts', label: 'Hitouts', column: 'r_pms.hitouts', kind: 'integer' },
      brownlow_votes: { key: 'brownlow_votes', label: 'Brownlow votes (this game)', column: 'r_pms.brownlow_votes', kind: 'integer' },
    },
  },

  'match.clubs': {
    key: 'match.clubs',
    subject: 'match',
    label: 'Competing clubs',
    hint: 'The two clubs that played this match.',
    subqueryFrom: 'clubs r_cl',
    correlation: 'r_cl.id IN (m.home_club_id, m.away_club_id)',
    targetTable: 'clubs',
    cardinality: 'many',
    columns: {
      name: { key: 'name', label: 'Name', column: 'r_cl.name', kind: 'text' },
      short_name: { key: 'short_name', label: 'Short name', column: 'r_cl.short_name', kind: 'text' },
      abbreviation: { key: 'abbreviation', label: 'Abbreviation', column: 'r_cl.abbreviation', kind: 'text' },
      succession: { key: 'succession', label: 'Succession', column: 'r_cl.succession::text', kind: 'text' },
      is_current_afl_club: { key: 'is_current_afl_club', label: 'Current AFL club', column: 'r_cl.is_current_afl_club', kind: 'boolean' },
      first_season: { key: 'first_season', label: 'First season', column: 'r_cl.first_season', kind: 'integer' },
      last_season: { key: 'last_season', label: 'Last season', column: 'r_cl.last_season', kind: 'integer' },
      home_state: { key: 'home_state', label: 'Home state', column: 'r_cl.home_state', kind: 'text' },
    },
  },
};

export const RELATIONSHIP_KEYS = Object.keys(RELATIONSHIPS);

/**
 * A relationship is self-equivalent to an anchor when it yields the very
 * row the anchor already returns: same grain table, one-to-one, keyed by
 * the anchor's own grain subject. Offering it would present the same
 * record twice ("this Player career stats row" and "related Player
 * career"). In V1 this fires on exactly one pair — player_career_stats x
 * player.career. It deliberately does NOT fire on player_match_stats x
 * player.match_stats (cardinality many): "this player had some game with
 * 8+ goals" is a genuinely different question from the anchor row.
 */
function isSelfEquivalent(anchor: AnchorDef, rel: RelationshipDef): boolean {
  return rel.targetTable === anchor.grainTable
    && rel.cardinality === 'one'
    && rel.subject === anchor.grainSubject;
}

/**
 * The related domains a card may filter under this anchor: every
 * relationship declared from one of the anchor's subjects, minus any
 * self-equivalent one. This is the single source for BOTH the UI option
 * list and parseQueryState's reachability check, so a hand-crafted URL
 * naming a domain the UI would not offer is rejected by the same rule
 * that hides it — rejected, not merely hidden.
 */
export function relationshipsForAnchor(anchorKey: string): RelationshipDef[] {
  const anchor = QUERYABLE_TABLES[anchorKey];
  if (!anchor) return [];
  return RELATIONSHIP_KEYS
    .map((key) => RELATIONSHIPS[key])
    .filter((rel) => anchor.subjects.includes(rel.subject) && !isSelfEquivalent(anchor, rel));
}

/** The relationship a card's domain names, when it is reachable from the anchor; otherwise null. */
export function relationshipForCard(anchorKey: string, domain: string | undefined): RelationshipDef | null {
  if (domain === undefined || domain === anchorKey) return null;
  return relationshipsForAnchor(anchorKey).find((rel) => rel.key === domain) ?? null;
}

/**
 * The column catalogue a card's conditions resolve against: the anchor's
 * own columns for an anchor-domain card, the relationship's columns for a
 * reachable related domain, and null for anything else (unknown domain,
 * unreachable domain, self-equivalent domain, unknown anchor).
 */
export function domainColumns(anchorKey: string, domain: string | undefined): Record<string, ColumnDef> | null {
  const anchor = QUERYABLE_TABLES[anchorKey];
  if (!anchor) return null;
  if (domain === undefined || domain === anchorKey) return anchor.columns;
  return relationshipForCard(anchorKey, domain)?.columns ?? null;
}

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

/**
 * Abuse limits, the same spirit as advanced-spec.ts's LIMITS. The first
 * five predate AFLDB-ISSUE-115 and are unchanged; none may be weakened.
 */
export const QB_LIMITS = {
  maxCards: 6,
  maxConditionsPerCard: 8,
  defaultPageSize: 50,
  maxPage: 50,
  /** Hard ceiling on a share token's decoded size. */
  maxStateChars: 8_192,
  /** At most this many of the cards may filter a related domain (each is a correlated subquery). */
  maxRelatedCards: 4,
  /** Structural: a card reaches exactly one hop from the anchor; chaining is not representable. */
  maxRelationshipDepth: 1,
} as const;

// --------------------------------------------------------------------- AST

export type ConditionSpec = {
  column: string;
  op: string;
  value?: string | number;
  lo?: string | number;
  hi?: string | number;
};

export type CardQuantifier = 'any' | 'none';

export type CardSpec = {
  /** How conditions inside this card combine (within ONE related row, for a related card). */
  match: 'AND' | 'OR';
  conditions: ConditionSpec[];
  /** Domain this card filters: a RELATIONSHIPS key. Absent => the anchor's own domain (the pre-115 shape). */
  domain?: string;
  /** Related-domain cards only: 'any' = there is at least one such row; 'none' = there is no such row. Absent => 'any'. */
  quantifier?: CardQuantifier;
};

export type CardGroup = {
  /** How this card joins the accumulated result of the cards before it. Ignored on the first card. */
  join: 'AND' | 'OR';
  card: CardSpec;
};

export type QueryBuilderState = {
  /** The anchor key. Named `table` so pre-115 URL tokens keep working. */
  table: string;
  cards: CardGroup[];
  sort?: string;
  page: number;
};

export function emptyCard(): CardGroup {
  return { join: 'AND', card: { match: 'AND', conditions: [] } };
}

export function emptyState(table: string): QueryBuilderState {
  return { table, cards: [emptyCard()], page: 1 };
}

// ------------------------------------------------------- state transitions

/**
 * Pure state transitions the Client Component calls, kept here so they are
 * testable without a React harness.
 */

/** Changing the result grain starts a new question: today's exact behaviour, retained deliberately. */
export function changeAnchor(_state: QueryBuilderState, anchorKey: string): QueryBuilderState {
  return emptyState(anchorKey);
}

/**
 * Changing a card's domain clears that card's conditions (they named
 * columns of the old domain) and resets its quantifier. `domain` equal to
 * the anchor means "this row" and is stored as absent, so the in-memory
 * shape is the serialised shape.
 */
export function setCardDomain(state: QueryBuilderState, cardIndex: number, domain: string): QueryBuilderState {
  return {
    ...state,
    cards: state.cards.map((group, i): CardGroup => {
      if (i !== cardIndex) return group;
      const card: CardSpec = { match: group.card.match, conditions: [] };
      if (domain !== state.table) card.domain = domain;
      return { ...group, card };
    }),
  };
}

/** Sets a related card's quantifier; 'any' is stored as absent. No effect on an anchor-domain card. */
export function setCardQuantifier(state: QueryBuilderState, cardIndex: number, quantifier: CardQuantifier): QueryBuilderState {
  return {
    ...state,
    cards: state.cards.map((group, i): CardGroup => {
      if (i !== cardIndex || group.card.domain === undefined) return group;
      const { quantifier: _old, ...rest } = group.card;
      return { ...group, card: quantifier === 'none' ? { ...rest, quantifier } : rest };
    }),
  };
}

// ---------------------------------------------------------------- describe

/**
 * The card legend sentence, shared by the page and the form so both phrase
 * a card identically. No SQL jargon.
 */
export function describeCard(anchorKey: string, card: CardSpec, index: number): string {
  const rel = relationshipForCard(anchorKey, card.domain);
  if (!rel) return `Card ${index + 1}`;
  return card.quantifier === 'none'
    ? `Card ${index + 1} — has no matching ${rel.label} row`
    : `Card ${index + 1} — has a matching ${rel.label} row`;
}

// ------------------------------------------------------------ URL state

/**
 * The builder's state as a compact, shareable URL token: JSON, then
 * base64url (lib/urlState.ts). Not compressed (the reference's zlib
 * step): this state is a handful of conditions, not a whole DNF-expanded
 * query, so the extra dependency and decompression-bomb surface would
 * buy nothing here.
 *
 * `domain` is omitted when it equals the anchor and `quantifier` when it
 * is 'any', so tokens stay short and a pre-115 token is exactly the
 * anchor-only shape of the new model — no version field, no migration.
 */
export function serializeQueryState(state: QueryBuilderState): string {
  const cards = state.cards.map((group): CardGroup => {
    const { domain, quantifier, ...rest } = group.card;
    const card: CardSpec = { match: rest.match, conditions: rest.conditions };
    if (domain !== undefined && domain !== state.table) {
      card.domain = domain;
      if (quantifier === 'none') card.quantifier = 'none';
    }
    return { join: group.join, card };
  });
  return encodeUrlState({ ...state, cards }, QB_LIMITS.maxStateChars);
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
  let relatedCards = 0;
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

    // Domain: absent or equal to the anchor => anchor-domain card. Anything
    // else must be a relationship reachable from this anchor — the same
    // helper the UI option list uses, so the two cannot drift.
    let domain: string | undefined;
    if (c.domain !== undefined) {
      if (typeof c.domain !== 'string') return null;
      if (c.domain !== table) {
        if (!relationshipForCard(table, c.domain)) return null;
        domain = c.domain;
      }
    }

    // Quantifier: 'any' | 'none' on a related card ('any' stored as absent).
    // On an anchor-domain card only the no-op 'any' is tolerated; 'none'
    // would silently mean something the card cannot express.
    let quantifier: CardQuantifier | undefined;
    if (c.quantifier !== undefined) {
      if (c.quantifier !== 'any' && c.quantifier !== 'none') return null;
      if (c.quantifier === 'none') {
        if (domain === undefined) return null;
        quantifier = 'none';
      }
    }

    if (domain !== undefined && ++relatedCards > QB_LIMITS.maxRelatedCards) return null;

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
    const card: CardSpec = { match, conditions };
    if (domain !== undefined) card.domain = domain;
    if (quantifier !== undefined) card.quantifier = quantifier;
    cards.push({ join, card });
  }

  const sort = typeof obj.sort === 'string' ? obj.sort : undefined;
  const pageRaw = Number(obj.page);
  const page = Number.isSafeInteger(pageRaw) && pageRaw >= 1 ? Math.min(pageRaw, QB_LIMITS.maxPage) : 1;

  return { table, cards, sort, page };
}
