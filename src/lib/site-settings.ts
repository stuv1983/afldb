/**
 * The choices a super admin makes at runtime, and their compiled-in defaults.
 *
 * Every value here is stored as one jsonb row in `site_settings` (migration
 * 034) and read back through `src/db/queries/site-settings.ts`. This module
 * owns the *shape* of each value: what the legal options are, what a missing
 * or malformed row falls back to, and how a stored value is normalised
 * against the current code.
 *
 * That normalisation is the point. A stored layout naming a section this
 * deploy no longer has, or missing one it has just gained, must not blank the
 * home page: unknown ids are dropped and new ones appended, exactly as
 * `ReorderableSections` does for a reader's own saved order. So a settings row
 * written by a newer deploy and read by an older one — or the reverse, mid
 * rollout — degrades to something sensible rather than throwing on the one
 * page every visitor lands on.
 *
 * Shared by Server Components, server actions and the admin's Client
 * Component form, so it stays free of server-only imports.
 */

export const SETTING_KEYS = {
  homeLayout: 'home.sections',
  homeRecord: 'home.record_of_the_week',
  aflwLeaders: 'home.aflw_leaders',
  gridAudience: 'grid_solver.audience',
} as const;

// ---------------------------------------------------------------------------
// Home page layout
// ---------------------------------------------------------------------------

export type HomeSectionId = 'stats' | 'vault' | 'record' | 'browse';

/**
 * The orderable, hideable blocks of both home pages.
 *
 * `panel` marks the two narrow blocks that share the ruled two-column
 * `.split` row. A run of consecutive visible panels is laid out as one split;
 * see `homeSectionRows`. The masthead, hero heading and search box are not
 * here on purpose: a front page without its one line of enquiry is not a
 * layout choice, it is a broken page.
 */
export const HOME_SECTIONS: {
  id: HomeSectionId;
  label: string;
  help: string;
  panel?: boolean;
}[] = [
  {
    id: 'stats',
    label: 'Statistics strip',
    help: 'Players, matches, seasons and player-games across the whole record.',
  },
  {
    id: 'vault',
    label: 'From the vault',
    help: 'The clubs that met in the most recent round, each shown a random '
      + 'earlier meeting between the same two.',
    panel: true,
  },
  {
    id: 'record',
    label: 'Record of the week',
    help: 'The top five of one career record, chosen below.',
    panel: true,
  },
  {
    id: 'browse',
    label: 'Browse the record',
    help: 'The card grid linking to players, clubs, seasons and the rest.',
  },
];

const HOME_SECTION_IDS = HOME_SECTIONS.map((section) => section.id);

export function homeSection(id: HomeSectionId) {
  return HOME_SECTIONS.find((section) => section.id === id);
}

export type HomeLayout = {
  /** Every known section, in display order. */
  order: HomeSectionId[];
  /** The subset of `order` that is not rendered. */
  hidden: HomeSectionId[];
};

export const DEFAULT_HOME_LAYOUT: HomeLayout = {
  order: [...HOME_SECTION_IDS],
  hidden: [],
};

function isHomeSectionId(value: unknown): value is HomeSectionId {
  return typeof value === 'string' && (HOME_SECTION_IDS as string[]).includes(value);
}

/** Normalise a stored (or submitted) layout against the sections this build has. */
export function parseHomeLayout(value: unknown): HomeLayout {
  if (!value || typeof value !== 'object') return DEFAULT_HOME_LAYOUT;
  const raw = value as { order?: unknown; hidden?: unknown };

  const stored = Array.isArray(raw.order) ? raw.order.filter(isHomeSectionId) : [];
  // Deduplicate before appending, or a value hand-edited to repeat an id
  // would render that section twice.
  const order = [...new Set(stored)];
  for (const id of HOME_SECTION_IDS) {
    if (!order.includes(id)) order.push(id);
  }

  const hidden = Array.isArray(raw.hidden)
    ? [...new Set(raw.hidden.filter(isHomeSectionId))]
    : [];

  return { order, hidden };
}

export function visibleHomeSections(layout: HomeLayout): HomeSectionId[] {
  return layout.order.filter((id) => !layout.hidden.includes(id));
}

/**
 * Group the visible sections into rows for rendering.
 *
 * A run of consecutive `panel` sections becomes one `.split` row of two
 * ruled columns; anything else is a row of its own. With the default order
 * that reproduces the front page exactly as it was hand-written — vault and
 * record side by side — while an order that separates them, or hides one of
 * them, degrades to full-width blocks rather than a lopsided half-empty rule.
 */
export function homeSectionRows(visible: HomeSectionId[]): HomeSectionId[][] {
  const rows: HomeSectionId[][] = [];
  for (const id of visible) {
    const previous = rows[rows.length - 1];
    const isPanel = homeSection(id)?.panel === true;
    if (isPanel && previous && homeSection(previous[0])?.panel === true && previous.length < 2) {
      previous.push(id);
    } else {
      rows.push([id]);
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Record of the week
// ---------------------------------------------------------------------------

/**
 * Career records the home panel can lead with.
 *
 * Deliberately only the five the career leaderboard query can answer
 * (`CAREER_COLUMNS` in db/queries/records.ts): the single-game and season
 * categories are ranked per performance rather than per player, so they do
 * not fit the five-name meter the panel draws.
 */
export const HOME_RECORD_CATEGORIES = [
  'most-goals',
  'most-games',
  'most-finals',
  'most-premierships',
  'most-brownlow-votes',
] as const;

export type HomeRecordCategory = typeof HOME_RECORD_CATEGORIES[number];

export const DEFAULT_HOME_RECORD: HomeRecordCategory = 'most-goals';

export function parseHomeRecord(value: unknown): HomeRecordCategory {
  return typeof value === 'string'
    && (HOME_RECORD_CATEGORIES as readonly string[]).includes(value)
    ? value as HomeRecordCategory
    : DEFAULT_HOME_RECORD;
}

// ---------------------------------------------------------------------------
// AFLW leaders panel
// ---------------------------------------------------------------------------

/**
 * The AFLW half of "Record of the week".
 *
 * AFLW has no /records section to draw a category from, so the panel ranks
 * career totals straight off `aflw.player_careers`. Every one of these is
 * recorded for every AFLW season, so unlike the AFL side no category here
 * needs a coverage caveat.
 */
export const AFLW_LEADER_CATEGORIES = [
  { value: 'goals', label: 'Most career goals', column: 'goals', unit: 'Goals' },
  { value: 'games', label: 'Most games', column: 'games', unit: 'Games' },
  { value: 'disposals', label: 'Most disposals', column: 'disposals', unit: 'Disposals' },
  { value: 'tackles', label: 'Most tackles', column: 'tackles', unit: 'Tackles' },
  { value: 'marks', label: 'Most marks', column: 'marks', unit: 'Marks' },
] as const;

export type AflwLeaderCategory = typeof AFLW_LEADER_CATEGORIES[number]['value'];

export const DEFAULT_AFLW_LEADERS: AflwLeaderCategory = 'goals';

export function parseAflwLeaders(value: unknown): AflwLeaderCategory {
  return AFLW_LEADER_CATEGORIES.some((option) => option.value === value)
    ? value as AflwLeaderCategory
    : DEFAULT_AFLW_LEADERS;
}

export function aflwLeaderCategory(value: AflwLeaderCategory) {
  return AFLW_LEADER_CATEGORIES.find((option) => option.value === value)
    ?? AFLW_LEADER_CATEGORIES[0];
}

// ---------------------------------------------------------------------------
// Grid solver audience
// ---------------------------------------------------------------------------

/**
 * Who may reach the grid solver, in widening order.
 *
 * A level names the LEAST privileged session admitted, so 'admin' admits
 * admins and super admins, and 'public' admits everyone including signed-out
 * visitors. Defaults to super admins only: widening it is a deliberate act,
 * and a setting row that fails to parse must not be the thing that opens a
 * page up.
 */
export const GRID_AUDIENCES = [
  {
    value: 'super_admin',
    label: 'Super admins only',
    help: 'The default. Nobody else can reach the page.',
  },
  {
    value: 'admin',
    label: 'Admins and super admins',
    help: 'Contributors are still excluded.',
  },
  {
    value: 'contributor',
    label: 'Any signed-in staff account',
    help: 'Contributors, admins and super admins.',
  },
  {
    value: 'public',
    label: 'Everyone',
    help: 'Published to every visitor, and linked from the main navigation.',
  },
] as const;

export type GridAudience = typeof GRID_AUDIENCES[number]['value'];

export const DEFAULT_GRID_AUDIENCE: GridAudience = 'super_admin';

export function parseGridAudience(value: unknown): GridAudience {
  return GRID_AUDIENCES.some((option) => option.value === value)
    ? value as GridAudience
    : DEFAULT_GRID_AUDIENCE;
}

// ---------------------------------------------------------------------------

export type SiteSettings = {
  homeLayout: HomeLayout;
  homeRecord: HomeRecordCategory;
  aflwLeaders: AflwLeaderCategory;
  gridAudience: GridAudience;
};

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  homeLayout: DEFAULT_HOME_LAYOUT,
  homeRecord: DEFAULT_HOME_RECORD,
  aflwLeaders: DEFAULT_AFLW_LEADERS,
  gridAudience: DEFAULT_GRID_AUDIENCE,
};

/**
 * Normalise one stored value, whichever way the driver hands jsonb back.
 *
 * The postgres.js client this project uses returns a jsonb column as its raw
 * TEXT — the five characters `"public"`, not the string `public`, and an
 * object as its serialisation rather than an object. A client configured (or
 * upgraded) to parse jsonb itself returns the decoded value instead. Both
 * have to land in the same place, or the settings read as their defaults on
 * one of them and nothing looks broken except that saving changes nothing.
 *
 * So: a string that parses as JSON is taken as encoded, and anything else is
 * taken as already decoded. The one case that could confuse the two is a
 * setting whose legitimate value is a string of digits or the word `null`;
 * none of the keys here has one, and every value is allowlisted downstream
 * regardless.
 */
function fromStore(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** Parse whole `site_settings` rows into the typed settings object. */
export function parseSiteSettings(
  rows: readonly { key: string; value: unknown }[],
): SiteSettings {
  const byKey = new Map(rows.map((row) => [row.key, fromStore(row.value)]));
  return {
    homeLayout: byKey.has(SETTING_KEYS.homeLayout)
      ? parseHomeLayout(byKey.get(SETTING_KEYS.homeLayout))
      : DEFAULT_HOME_LAYOUT,
    homeRecord: parseHomeRecord(byKey.get(SETTING_KEYS.homeRecord)),
    aflwLeaders: parseAflwLeaders(byKey.get(SETTING_KEYS.aflwLeaders)),
    gridAudience: parseGridAudience(byKey.get(SETTING_KEYS.gridAudience)),
  };
}
