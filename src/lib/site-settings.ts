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

import { DEFAULT_SITE_FOOTER, parseSiteFooter, type SiteFooter } from '@/lib/site-content';

export const SETTING_KEYS = {
  homeLayout: 'home.sections',
  homeRecord: 'home.record_of_the_week',
  aflwLeaders: 'home.aflw_leaders',
  gridAudience: 'grid_solver.audience',
  earlyAccessOpen: 'early_access.open',
  earlyAccessIntro: 'early_access.intro',
  earlyAccessQuestions: 'early_access.questions',
  earlyAccessNotify: 'early_access.notify',
  earlyAccessNotifyTo: 'early_access.notify_to',
  /** The colophon under every page, and under the apex. See site-content.ts. */
  siteFooter: 'site.footer',
  /**
   * The apex coming-soon page's whole content document. Deliberately NOT part
   * of the `SiteSettings` object below: it is kilobytes of prose read by the
   * editor and the publisher only, so `getSiteSettings()` excludes this row
   * from the query rather than dragging it through every public render.
   */
  apexContent: 'apex.content',
  /** Dynamic search box placeholders and animation settings (see changeLog.md). */
  searchPlaceholdersAfl: 'search.placeholders_afl',
  searchPlaceholdersAflw: 'search.placeholders_aflw',
  searchPlaceholderInterval: 'search.placeholder_interval',
  searchPlaceholderAnimation: 'search.placeholder_animation',
  pageIntros: 'site.page_intros',
} as const;

// --- Home page layout ---

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

// --- Record of the week ---

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

// --- AFLW leaders panel ---

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

// --- Grid solver audience ---

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

// --- Early access requests ---

/**
 * The public "request early access" form, as a super admin configures it.
 *
 * The email address is NOT a question here and never can be: approving a
 * request allowlists that address in `beta_allowed_emails`, so the flow has
 * no meaning without it. Name is likewise a fixed column. Everything else is
 * the super admin's to define, and lands in `beta_join_requests.answers`
 * (migration 035) keyed by question id.
 *
 * Ids are stable and are what stored answers are keyed by, so renaming a
 * question's LABEL keeps its history readable while changing its ID orphans
 * the old answers. `parseEarlyAccessQuestions` therefore keeps ids as given
 * rather than deriving them from the label.
 */
/**
 * `multi` is the "select all that apply" type: several options, several
 * answers, stored as an ARRAY rather than a string. Everything downstream —
 * the public form, the submit validator, the review screen — has to know the
 * difference, which is why the answer type is widened rather than joined into
 * a comma-separated string somewhere convenient. A reader who ticks
 * "Windows PC" and "iPhone" has given two facts, and the review screen should
 * be able to say so.
 */
export type EarlyAccessQuestionType = 'short' | 'long' | 'select' | 'multi';

/** The types whose answers must come from a fixed option list. */
export function isChoiceType(type: EarlyAccessQuestionType): boolean {
  return type === 'select' || type === 'multi';
}

export type EarlyAccessQuestion = {
  id: string;
  label: string;
  help?: string;
  type: EarlyAccessQuestionType;
  required: boolean;
  /** `select` only; ignored for the free-text types. */
  options?: string[];
};

/**
 * Caps, so a hand-posted or fumbled settings row cannot produce a form that
 * is hostile to render or to store. These bound the ADMIN side; the public
 * submit path applies its own answer-length limit independently.
 */
export const EARLY_ACCESS_LIMITS = {
  // Raised from 12 when the preset library landed: the suggested set alone is
  // seventeen questions across four sections, and a super admin who opts into
  // most of it must not hit a cap that silently drops the tail of their form.
  maxQuestions: 24,
  // 18 AFL clubs plus "Other" and "No team" is exactly 20, which is precisely
  // the sort of list that should not sit on the limit.
  maxOptions: 30,
  labelChars: 200,
  helpChars: 300,
  optionChars: 100,
  /** Longest answer the public form will store, per question. */
  answerChars: 2000,
  introChars: 600,
} as const;

const QUESTION_TYPES: EarlyAccessQuestionType[] = ['short', 'long', 'select', 'multi'];

export const DEFAULT_EARLY_ACCESS_QUESTIONS: EarlyAccessQuestion[] = [
  {
    id: 'interest',
    label: 'What would you use AFLDB for?',
    help: 'A sentence is plenty — it helps us prioritise what to build next.',
    type: 'long',
    required: false,
  },
];

export const DEFAULT_EARLY_ACCESS_INTRO =
  'AFLDB is in closed beta while the record is verified. Leave your email and '
  + 'we will be in touch as places open up.';

/** The address new requests are emailed to when notification is on. */
export const DEFAULT_EARLY_ACCESS_NOTIFY_TO = 'requests@afldb.com';

/**
 * Ids the form already uses for its fixed fields, and so cannot be reused.
 *
 * The public form submits questions as sibling fields of `email`, `name` and
 * the `website` honeypot, and reads each answer back by name. A question id of
 * `name` would therefore collide: `form.elements.name` returns a list rather
 * than an input once two fields share it, and the answer would be read as the
 * wrong value or lost. Rejecting the id is the fix; there is no ambiguity to
 * resolve afterwards.
 */
export const RESERVED_QUESTION_IDS = ['email', 'name', 'website'] as const;

/** A question id is a slug: stable, safe as a jsonb key and as a form field name. */
export function isQuestionId(value: unknown): value is string {
  return typeof value === 'string'
    && /^[a-z0-9][a-z0-9_-]{0,39}$/.test(value)
    && !(RESERVED_QUESTION_IDS as readonly string[]).includes(value);
}

/** Derive a legal id from a label, for the admin form's convenience. */
export function slugifyQuestionId(label: string): string {
  let slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  // "Name" is a plausible thing to type as a question, and would otherwise
  // produce a reserved id. Suffixing keeps it legal and still readable.
  if ((RESERVED_QUESTION_IDS as readonly string[]).includes(slug)) slug = `${slug}-q`;
  return isQuestionId(slug) ? slug : `q${Date.now().toString(36).slice(-6)}`;
}

function clamp(value: unknown, chars: number): string {
  return typeof value === 'string' ? value.trim().slice(0, chars) : '';
}

/**
 * Normalise a stored (or submitted) question list against this build's rules.
 *
 * Anything unusable is DROPPED rather than defaulted: a question with no
 * label, a duplicate id or a `select` with no options is not a question, and
 * silently substituting one would put words in the super admin's mouth on a
 * public page. An empty result is legal and means "email and name only",
 * which is a coherent form — so, unlike the other settings here, this does
 * not fall back to the defaults once a super admin has saved anything.
 */
export function parseEarlyAccessQuestions(value: unknown): EarlyAccessQuestion[] {
  if (!Array.isArray(value)) return DEFAULT_EARLY_ACCESS_QUESTIONS;

  const seen = new Set<string>();
  const questions: EarlyAccessQuestion[] = [];

  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;

    if (!isQuestionId(item.id) || seen.has(item.id)) continue;
    const label = clamp(item.label, EARLY_ACCESS_LIMITS.labelChars);
    if (!label) continue;

    const type = QUESTION_TYPES.includes(item.type as EarlyAccessQuestionType)
      ? item.type as EarlyAccessQuestionType
      : 'short';

    let options: string[] | undefined;
    if (isChoiceType(type)) {
      options = Array.isArray(item.options)
        ? [...new Set(
          item.options
            .map((option) => clamp(option, EARLY_ACCESS_LIMITS.optionChars))
            .filter(Boolean),
        )].slice(0, EARLY_ACCESS_LIMITS.maxOptions)
        : [];
      // A choice with nothing to choose from cannot be answered, and marking
      // it required would make the form unsubmittable.
      if (options.length === 0) continue;
    }

    const help = clamp(item.help, EARLY_ACCESS_LIMITS.helpChars);

    seen.add(item.id);
    questions.push({
      id: item.id,
      label,
      ...(help ? { help } : {}),
      type,
      required: item.required === true,
      ...(options ? { options } : {}),
    });

    if (questions.length >= EARLY_ACCESS_LIMITS.maxQuestions) break;
  }

  return questions;
}

export function parseEarlyAccessIntro(value: unknown): string {
  const intro = clamp(value, EARLY_ACCESS_LIMITS.introChars);
  return intro || DEFAULT_EARLY_ACCESS_INTRO;
}

/**
 * A plain email check, matching the one the public form and the existing beta
 * actions already apply. Deliberately permissive about the local part and
 * strict only about the shape, since the address is verified by being written
 * to rather than by a regex.
 */
export function isEmailish(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 200
    && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

export function parseEarlyAccessNotifyTo(value: unknown): string {
  return isEmailish(value) ? value : DEFAULT_EARLY_ACCESS_NOTIFY_TO;
}

/**
 * Whether the form is open, and whether a new request raises an email.
 *
 * Both default to the CLOSED/quiet direction on a malformed row. A settings
 * row that fails to parse must not be the thing that opens a public form or
 * starts sending mail — the same reasoning as `parseGridAudience` above.
 */
export function parseBooleanSetting(value: unknown): boolean {
  return value === true;
}


export type SearchAnimationType = 'typewriter' | 'fade' | 'slide' | 'none';

export const SEARCH_ANIMATIONS: { value: SearchAnimationType; label: string; help: string }[] = [
  { value: 'typewriter', label: 'Typewriter', help: 'Types out and backspaces sample queries letter by letter.' },
  { value: 'fade', label: 'Fade transition', help: 'Gently fades between sample queries.' },
  { value: 'slide', label: 'Slide transition', help: 'Slides the placeholder text in and out.' },
  { value: 'none', label: 'Instant', help: 'Switches directly to the next query with no animation.' },
];

export const DEFAULT_AFL_PLACEHOLDERS: string[] = [
  'Search players, clubs, venues, seasons…',
  'Try “Scott Pendlebury”, “Dustin Martin”, “Lance Franklin”…',
  'Try “Carlton vs Collingwood 1970”, “Round 5 1989”…',
  'Try “Most career goals”, “Brownlow Medal leaders”…',
  'Try “Hall of Fame legends”, “1995 Grand Final”…',
  'Ask “Who won the Brownlow in 2004?”…',
];

export const DEFAULT_AFLW_PLACEHOLDERS: string[] = [
  'Search AFLW players and clubs…',
  'Try “Daisy Pearce”, “Erin Phillips”, “Monique Conti”…',
  'Try “Adelaide Crows AFLW”, “Brisbane Lions AFLW”…',
  'Try “Leading goalkickers”, “2024 AFLW Season”…',
  'Try “Most disposals in AFLW”…',
];

export const DEFAULT_PLACEHOLDER_INTERVAL = 5;
export const DEFAULT_SEARCH_ANIMATION: SearchAnimationType = 'typewriter';

export function parsePlaceholders(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    if (typeof value === 'string') {
      const lines = value.split('\n').map((l) => l.trim()).filter(Boolean);
      return lines.length > 0 ? lines.slice(0, 25) : fallback;
    }
    return fallback;
  }
  const filtered = value
    .filter((v): v is string => typeof v === 'string')
    .map((s) => s.trim())
    .filter(Boolean);
  return filtered.length > 0 ? filtered.slice(0, 25) : fallback;
}

export function parsePlaceholderInterval(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return DEFAULT_PLACEHOLDER_INTERVAL;
  return Math.min(60, Math.max(2, Math.round(num)));
}

export function parseSearchAnimation(value: unknown): SearchAnimationType {
  if (value === 'fade' || value === 'slide' || value === 'none' || value === 'typewriter') {
    return value;
  }
  return DEFAULT_SEARCH_ANIMATION;
}

export type PageIntros = {
  records: string;
  brownlow: string;
  clubs: string;
  draft: string;
};

export const DEFAULT_PAGE_INTROS: PageIntros = {
  records: 'Each record states its exact definition and the era for which the underlying statistic was collected.',
  brownlow: 'Awarded to the fairest and best player of the season, first presented in 1924.\n\nVote totals come from the official season counts. Round-by-round votes are available from 1984; per-game votes were also published for 1931–1934. For the seasons in between, only the season total is on record — an absent per-game vote means it was not published, not that no vote was polled.',
  clubs: 'Historical identities are preserved rather than folded away, so a player’s record shows the club as it was at the time. A rename or relocation carries the club’s record forward; a merger does not, so the two sit in different columns.',
  draft: 'National draft selections since 1986.', // Draft doesn't have an intro currently, let's just make one up or leave empty. I'll make a basic one or leave it empty.
};

export function parsePageIntros(value: unknown): PageIntros {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_PAGE_INTROS;
  const raw = value as Record<string, unknown>;
  const text = (v: unknown, fallback: string) => typeof v === 'string' ? v.trim().slice(0, 2000) : fallback;
  return {
    records: text(raw.records, DEFAULT_PAGE_INTROS.records),
    brownlow: text(raw.brownlow, DEFAULT_PAGE_INTROS.brownlow),
    clubs: text(raw.clubs, DEFAULT_PAGE_INTROS.clubs),
    draft: text(raw.draft, DEFAULT_PAGE_INTROS.draft),
  };
}

export type SiteSettings = {
  homeLayout: HomeLayout;
  homeRecord: HomeRecordCategory;
  aflwLeaders: AflwLeaderCategory;
  gridAudience: GridAudience;
  earlyAccessOpen: boolean;
  earlyAccessIntro: string;
  earlyAccessQuestions: EarlyAccessQuestion[];
  earlyAccessNotify: boolean;
  earlyAccessNotifyTo: string;
  /**
   * The footer every page renders. Unlike everything above it this is read on
   * the critical path of EVERY page rather than just the home page, which is
   * why the root layout falls back to the compiled-in default rather than
   * failing a page over a colophon.
   */
  footer: SiteFooter;
  searchPlaceholdersAfl: string[];
  searchPlaceholdersAflw: string[];
  searchPlaceholderInterval: number;
  searchPlaceholderAnimation: SearchAnimationType;
  pageIntros: PageIntros;
};

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  homeLayout: DEFAULT_HOME_LAYOUT,
  homeRecord: DEFAULT_HOME_RECORD,
  aflwLeaders: DEFAULT_AFLW_LEADERS,
  gridAudience: DEFAULT_GRID_AUDIENCE,
  earlyAccessOpen: false,
  earlyAccessIntro: DEFAULT_EARLY_ACCESS_INTRO,
  earlyAccessQuestions: DEFAULT_EARLY_ACCESS_QUESTIONS,
  earlyAccessNotify: false,
  earlyAccessNotifyTo: DEFAULT_EARLY_ACCESS_NOTIFY_TO,
  footer: DEFAULT_SITE_FOOTER,
  searchPlaceholdersAfl: DEFAULT_AFL_PLACEHOLDERS,
  searchPlaceholdersAflw: DEFAULT_AFLW_PLACEHOLDERS,
  searchPlaceholderInterval: DEFAULT_PLACEHOLDER_INTERVAL,
  searchPlaceholderAnimation: DEFAULT_SEARCH_ANIMATION,
  pageIntros: DEFAULT_PAGE_INTROS,
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
    earlyAccessOpen: parseBooleanSetting(byKey.get(SETTING_KEYS.earlyAccessOpen)),
    earlyAccessIntro: parseEarlyAccessIntro(byKey.get(SETTING_KEYS.earlyAccessIntro)),
    // Absent means "never configured", which takes the defaults; a stored
    // empty list is a deliberate choice and is kept.
    earlyAccessQuestions: byKey.has(SETTING_KEYS.earlyAccessQuestions)
      ? parseEarlyAccessQuestions(byKey.get(SETTING_KEYS.earlyAccessQuestions))
      : DEFAULT_EARLY_ACCESS_QUESTIONS,
    earlyAccessNotify: parseBooleanSetting(byKey.get(SETTING_KEYS.earlyAccessNotify)),
    earlyAccessNotifyTo: parseEarlyAccessNotifyTo(byKey.get(SETTING_KEYS.earlyAccessNotifyTo)),
    footer: byKey.has(SETTING_KEYS.siteFooter)
      ? parseSiteFooter(byKey.get(SETTING_KEYS.siteFooter))
      : DEFAULT_SITE_FOOTER,
    searchPlaceholdersAfl: byKey.has(SETTING_KEYS.searchPlaceholdersAfl)
      ? parsePlaceholders(byKey.get(SETTING_KEYS.searchPlaceholdersAfl), DEFAULT_AFL_PLACEHOLDERS)
      : DEFAULT_AFL_PLACEHOLDERS,
    searchPlaceholdersAflw: byKey.has(SETTING_KEYS.searchPlaceholdersAflw)
      ? parsePlaceholders(byKey.get(SETTING_KEYS.searchPlaceholdersAflw), DEFAULT_AFLW_PLACEHOLDERS)
      : DEFAULT_AFLW_PLACEHOLDERS,
    searchPlaceholderInterval: byKey.has(SETTING_KEYS.searchPlaceholderInterval)
      ? parsePlaceholderInterval(byKey.get(SETTING_KEYS.searchPlaceholderInterval))
      : DEFAULT_PLACEHOLDER_INTERVAL,
    searchPlaceholderAnimation: byKey.has(SETTING_KEYS.searchPlaceholderAnimation)
      ? parseSearchAnimation(byKey.get(SETTING_KEYS.searchPlaceholderAnimation))
      : DEFAULT_SEARCH_ANIMATION,
    pageIntros: byKey.has(SETTING_KEYS.pageIntros)
      ? parsePageIntros(byKey.get(SETTING_KEYS.pageIntros))
      : DEFAULT_PAGE_INTROS,
  };
}
