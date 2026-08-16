/**
 * The editable CONTENT of the two pages a super admin writes rather than codes:
 * the coming-soon page at the apex, and the footer every page carries.
 *
 * Sibling to `src/lib/site-settings.ts` and deliberately separate from it.
 * That module owns *choices* — which record leads the home page, who may
 * reach the grid solver — which are small values read on every public render.
 * This one owns *documents*, which are kilobytes and are read by exactly two
 * callers: the admin editor and the publisher. Keeping them apart is why
 * `getSiteSettings()` can go on fetching the whole settings table on every
 * page without dragging a marketing page's prose through with it.
 *
 * The same normalisation contract applies as in site-settings.ts: a stored
 * document is untrusted input, every field is clamped and allowlisted on the
 * way out, and anything unusable falls back to the compiled-in default rather
 * than throwing. The default below is a faithful copy of the page as it was
 * hand-written in `deploy/coming-soon/index.html`, so an installation that has
 * never opened /admin/content publishes exactly the page that shipped.
 *
 * Pure: shared by Server Components, server actions, the publisher and the
 * admin's Client Component editor, so no server-only imports.
 */

// --- Limits ---

/**
 * Caps, so a hand-posted or fumbled document cannot produce a page that is
 * hostile to render, to publish or to read. These bound what is STORED; the
 * editor shows the same numbers as `maxLength` purely as a courtesy.
 */
export const CONTENT_LIMITS = {
  headingChars: 200,
  bodyChars: 1500,
  ledeChars: 1200,
  labelChars: 80,
  altChars: 500,
  emailChars: 200,
  metaTitleChars: 140,
  metaDescriptionChars: 500,
  maxFeatures: 8,
  maxNotes: 8,
  maxStats: 6,
  maxFooterLines: 6,
  footerLineChars: 600,
  /** Uploaded images, enforced by the upload route and migration 037. */
  maxMedia: 40,
  mediaBytes: 2 * 1024 * 1024,
} as const;

function text(value: unknown, chars: number): string {
  if (typeof value !== 'string') return '';
  // Control characters survive HTML-escaping untouched and would reach the
  // published file as invisible junk. Newline and tab are spared: a body
  // paragraph legitimately contains them and the renderer turns runs of them
  // into paragraph breaks. Written as a codepoint test rather than a regular
  // expression so the class cannot be misread at a glance.
  let out = '';
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    const printable = code >= 0x20 ? code !== 0x7f : character === '\n' || character === '\t';
    if (printable) out += character;
  }
  return out.trim().slice(0, chars);
}

/** A text field that must not be empty on a published page. */
function textOr(value: unknown, chars: number, fallback: string): string {
  return text(value, chars) || fallback;
}

// --- Images ---

/**
 * A reference to an image in the published tree, never to arbitrary bytes.
 *
 * Two directories exist under the published root, and the distinction is what
 * makes republishing safe to prune:
 *
 *   /img/…      shipped with the repository (`deploy/coming-soon/img`)
 *   /img/u/…    uploaded by a super admin, one row of `site_media` each
 *
 * The publisher only ever deletes from `/img/u`, so a stale upload is cleaned
 * up while a file that came from git is never touched by a publish.
 *
 * `width` and `height` are the intrinsic pixel size, carried into the `<img>`
 * so the browser reserves the space before the bytes arrive. They are read
 * from the file header on upload (src/lib/image-probe.ts), not typed in.
 */
export type ApexImage = {
  src: string;
  alt: string;
  width: number;
  height: number;
};

/**
 * A published image path. Anchored, no dot-segments, no separators beyond the
 * single optional `u/`, and an image extension — this string is interpolated
 * into both a filesystem path and an HTML attribute.
 */
const IMAGE_SRC = /^\/img\/(u\/)?[a-z0-9][a-z0-9._-]{0,59}\.(webp|png|jpg|jpeg)$/;

export function isImageSrc(value: unknown): value is string {
  return typeof value === 'string' && IMAGE_SRC.test(value) && !value.includes('..');
}

/** True for the uploaded half of the tree — the only half a publish may prune. */
export function isUploadedSrc(src: string): boolean {
  return src.startsWith('/img/u/');
}

/** The `site_media.name` an uploaded src refers to, or null for a shipped file. */
export function mediaNameFromSrc(src: string): string | null {
  return isUploadedSrc(src) ? src.slice('/img/u/'.length) : null;
}

export function uploadedSrc(name: string): string {
  return `/img/u/${name}`;
}

function parseImage(value: unknown, fallback: ApexImage): ApexImage {
  if (!value || typeof value !== 'object') return fallback;
  const raw = value as Record<string, unknown>;

  // A src that does not match is not repairable — pointing the page at a
  // guess would publish a broken image — so the slot reverts to its default.
  const src = isImageSrc(raw.src) ? raw.src : fallback.src;

  const width = Number(raw.width);
  const height = Number(raw.height);
  const usable = Number.isSafeInteger(width) && width > 0
    && Number.isSafeInteger(height) && height > 0;

  return {
    src,
    // Empty alt is legal and means decorative; it is not defaulted, because
    // silently reinstating a description of a DIFFERENT image would be worse
    // than none at all.
    alt: text(raw.alt, CONTENT_LIMITS.altChars),
    width: usable ? width : (src === fallback.src ? fallback.width : 0),
    height: usable ? height : (src === fallback.src ? fallback.height : 0),
  };
}

/** An optional image slot: absent stays absent rather than reverting. */
function parseOptionalImage(value: unknown): ApexImage | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (!isImageSrc(raw.src)) return null;
  return parseImage(value, { src: raw.src, alt: '', width: 0, height: 0 });
}

// --- Identifiers for the repeating blocks ---

/**
 * Feature cards and notes carry stable ids for the same reason early-access
 * questions do: so the editor can reorder and re-render them without React
 * remounting the wrong input, and so a diff of two published documents is
 * readable. Nothing is keyed by them across a save, so unlike a question id
 * these may be regenerated freely.
 */
export function isBlockId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,39}$/.test(value);
}

let blockCounter = 0;

export function newBlockId(prefix = 'b'): string {
  blockCounter += 1;
  return `${prefix}${Date.now().toString(36).slice(-6)}${blockCounter.toString(36)}`;
}

// --- Hero statistics ---

/**
 * The figures the hero strip can quote, and where they come from.
 *
 * Every one of these is a live count, recomputed at publish time, which is
 * what retires the "these are a snapshot, refresh them by hand" note that
 * docs/apex-coming-soon.md §8 used to carry. `custom` is the escape hatch for
 * a figure the database does not hold.
 */
export const APEX_METRICS = [
  { value: 'players', label: 'Players' },
  { value: 'matches', label: 'Matches' },
  { value: 'playerGames', label: 'Player games' },
  { value: 'seasons', label: 'Seasons' },
  { value: 'clubs', label: 'Clubs' },
  { value: 'venues', label: 'Venues' },
] as const;

export type ApexMetric = typeof APEX_METRICS[number]['value'];

export type ApexTotals = Record<ApexMetric, number>;

export type ApexStat = {
  id: string;
  /** The word under the figure. */
  label: string;
  /** Which live count to show, or `custom` for a figure typed in below. */
  metric: ApexMetric | 'custom';
  /**
   * The literal figure. Required when `metric` is `custom`; otherwise an
   * OVERRIDE — non-empty wins over the live count, empty means "use the
   * database". Emptying the box is how an override is removed.
   */
  value: string;
};

function isMetric(value: unknown): value is ApexMetric | 'custom' {
  return value === 'custom'
    || APEX_METRICS.some((metric) => metric.value === value);
}

// --- The apex document ---

export type ApexFeature = {
  id: string;
  heading: string;
  body: string;
  image: ApexImage | null;
};

export type ApexNote = {
  id: string;
  heading: string;
  body: string;
};

// --- Sections ---

/**
 * The bands of the page, in the order they were hand-written.
 *
 * Every one of these is a CONTENT decision — whether the page shows a wide
 * screenshot, whether the notes come before the feature cards — and content
 * decisions belong to whoever writes the page, not to whoever last deployed
 * it. Before this list existed the renderer emitted all five, always, in this
 * order, and changing either meant editing `apex-html.ts`.
 *
 * The ids are stable and are the only thing a stored document keys order and
 * visibility by, so a section may be renamed here freely but never re-slugged.
 */
export const APEX_SECTIONS = [
  { id: 'hero', label: 'Hero — eyebrow, headline, request button, figures' },
  { id: 'wideShot', label: 'Wide screenshot' },
  { id: 'features', label: '“What it does” cards' },
  { id: 'notes', label: '“Built like a record book” notes' },
  { id: 'pair', label: 'Light and mobile pair' },
] as const;

export type ApexSectionId = typeof APEX_SECTIONS[number]['id'];

export type ApexSection = {
  id: ApexSectionId;
  visible: boolean;
};

export const DEFAULT_APEX_SECTIONS: ApexSection[] = APEX_SECTIONS.map(
  (section) => ({ id: section.id, visible: true }),
);

function isSectionId(value: unknown): value is ApexSectionId {
  return APEX_SECTIONS.some((section) => section.id === value);
}

/**
 * Normalise the section list: known ids only, no duplicates, and anything
 * missing appended in its shipped position.
 *
 * The append is what makes this survive a deploy in either direction. A
 * document written before a new section existed does not know about it and
 * must not lose it; a document naming a section this build has dropped must
 * not carry a dangling id into the renderer. Both are the ordinary state of
 * affairs for a settings row read either side of a release.
 *
 * A section absent from a stored list arrives VISIBLE, because the
 * alternative — defaulting to hidden — would silently blank part of the page
 * on the first publish after a release.
 */
export function parseApexSections(value: unknown): ApexSection[] {
  const sections: ApexSection[] = [];
  const seen = new Set<ApexSectionId>();

  if (Array.isArray(value)) {
    for (const raw of value) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      if (!isSectionId(item.id) || seen.has(item.id)) continue;
      seen.add(item.id);
      sections.push({ id: item.id, visible: item.visible !== false });
    }
  }

  for (const section of APEX_SECTIONS) {
    if (!seen.has(section.id)) sections.push({ id: section.id, visible: true });
  }
  return sections;
}

export type ApexContent = {
  /** Which bands the page shows, and in what order. */
  sections: ApexSection[];
  meta: {
    title: string;
    description: string;
    ogTitle: string;
    ogDescription: string;
    /** Null drops the og:image and twitter:card tags rather than guessing one. */
    ogImage: ApexImage | null;
    /** The `description` of the WebSite JSON-LD block. */
    schemaDescription: string;
  };
  header: {
    brand: string;
    tagline: string;
  };
  hero: {
    eyebrow: string;
    heading: string;
    lede: string;
    /**
     * The words on the button that opens the early-access form.
     *
     * Rendered into the page as a data attribute that `app.js` reads, so the
     * static file stays the authority on its own wording — the endpoint
     * serves the QUESTIONS, not the copy around them.
     */
    ctaLabel: string;
    /**
     * The address the no-JavaScript fallback button mails. Distinct from the
     * footer's contact address on purpose: one is where requests go, the other
     * is where a reader writes about the data.
     */
    requestEmail: string;
    stats: ApexStat[];
    /** The `aria-label` on the figures list; read aloud, never seen. */
    statsLabel: string;
  };
  /** Null renders no wide screenshot band at all. */
  wideShot: ApexImage | null;
  features: {
    heading: string;
    items: ApexFeature[];
  };
  notes: {
    heading: string;
    items: ApexNote[];
  };
  pair: {
    light: ApexImage | null;
    lightCaption: string;
    mobile: ApexImage | null;
    mobileCaption: string;
  };
};

/**
 * The page exactly as `deploy/coming-soon/index.html` was hand-written.
 *
 * This is not a placeholder to be replaced on first save: it is the published
 * page until a super admin changes something, so it is kept in step with the
 * template beside it. The four hero figures are live counts here rather than
 * the numbers that were typed into the original file.
 */
export const DEFAULT_APEX_CONTENT: ApexContent = {
  sections: DEFAULT_APEX_SECTIONS,
  meta: {
    title: 'AFLDB — Australian Football Statistics, 1897 to Present',
    description:
      'A complete statistical record of Australian Football: every VFL/AFL player, '
      + 'match and season from 1897 to the present, with career records, Brownlow '
      + 'Medal votes, ladders and AFLW. Currently in closed beta.',
    ogTitle: 'AFLDB — Australian Football Statistics, 1897 to Present',
    ogDescription:
      'Every VFL/AFL player, match and season since 1897. Career records, Brownlow '
      + 'votes, ladders and AFLW — currently in closed beta.',
    ogImage: {
      src: '/img/home-dark.webp',
      alt: '',
      width: 1600,
      height: 1000,
    },
    schemaDescription:
      'A complete statistical record of Australian Football (VFL/AFL) from 1897 to '
      + 'the present: players, clubs, seasons, matches, venues, records, awards and '
      + 'Brownlow Medal history.',
  },
  header: {
    brand: 'AFLDB',
    tagline: '1897 — Present',
  },
  hero: {
    eyebrow: 'Coming soon',
    heading: 'Every player. Every game. Since 1897.',
    lede:
      'AFLDB is a complete statistical record of Australian Football — every VFL/AFL '
      + 'player, every match, every season from the first bounce in 1897 to the '
      + 'present round. It is being built as an independent, non-commercial '
      + 'reference, and is currently in closed beta while the record is verified.',
    ctaLabel: 'Request early access',
    requestEmail: 'requests@afldb.com',
    stats: [
      { id: 'players', label: 'Players', metric: 'players', value: '' },
      { id: 'matches', label: 'Matches', metric: 'matches', value: '' },
      { id: 'seasons', label: 'Seasons', metric: 'seasons', value: '' },
      { id: 'playergames', label: 'Player games', metric: 'playerGames', value: '' },
    ],
    statsLabel: 'The record, at a glance',
  },
  wideShot: {
    src: '/img/home-dark.webp',
    alt: 'The AFLDB home page: a single search box above counts of players, matches '
      + 'and seasons, with panels showing recent club meetings and career Brownlow '
      + 'vote leaders.',
    width: 1600,
    height: 1000,
  },
  features: {
    heading: 'What it does',
    items: [
      {
        id: 'players',
        heading: 'Every player, in full',
        body: 'Career totals, season-by-season splits, honours and every match a '
          + 'player appeared in — from the 1890s to last weekend. Two players can be '
          + 'put side by side.',
        image: {
          src: '/img/player-dark.webp',
          alt: 'A player page showing career games, goals, Brownlow votes, finals and '
            + 'premierships, above a career detail table and a list of honours.',
          width: 1400,
          height: 875,
        },
      },
      {
        id: 'seasons',
        heading: 'Seasons and ladders',
        body: 'Every season from 1897, with the final ladder, every round and every '
          + 'result. Premiers, wooden spoons and finals series are marked where the '
          + 'record supports it.',
        image: {
          src: '/img/season-dark.webp',
          alt: 'A season page showing the 2025 AFL ladder with played, won, lost, '
            + 'points for and against, percentage and premiership points.',
          width: 1400,
          height: 875,
        },
      },
      {
        id: 'search',
        heading: 'Search that answers questions',
        body: 'One line of enquiry finds a name, a club, a ground, a season or a '
          + 'round. Career criteria can be combined and filtered, and every search is '
          + 'a URL you can share or keep.',
        image: {
          src: '/img/players-dark.webp',
          alt: 'The players leaderboard, sortable by games, goals, Brownlow votes, '
            + 'finals, premierships, debut or name, with an advanced search panel '
            + 'above it.',
          width: 1400,
          height: 875,
        },
      },
      {
        id: 'brownlow',
        heading: 'Brownlow Medal history',
        body: 'Every vote on record since 1924, by season and by career, with '
          + 'round-by-round detail where it was published — and an explicit note '
          + 'where it was not.',
        image: {
          src: '/img/brownlow-dark.webp',
          alt: 'The Brownlow Medal page listing career vote leaders with vote totals, '
            + 'medals won and games played.',
          width: 1400,
          height: 875,
        },
      },
    ],
  },
  notes: {
    heading: 'Built like a record book',
    items: [
      {
        id: 'gaps',
        heading: 'Gaps are shown as gaps',
        body: 'Statistics that were never collected in a given era are shown as “—”, '
          + 'never as zero. A missing figure and a figure of nil are different facts, '
          + 'and conflating them quietly corrupts every total built on top of them.',
      },
      {
        id: 'sources',
        heading: 'Sources are stated',
        body: 'Data is derived from publicly available sources including AFL Tables '
          + 'and Wikipedia. Where a value is disputed or unrecorded, the page says so '
          + 'rather than picking one and looking confident.',
      },
      {
        id: 'aflw',
        heading: 'AFLW included',
        body: 'The AFLW record has its own section, with its own leaders and season '
          + 'pages, rather than being folded into the men’s competition.',
      },
      {
        id: 'anywhere',
        heading: 'Reads well anywhere',
        body: 'Light and dark, desktop and phone. Numbers are set in a monospace face '
          + 'so columns line up down the page.',
      },
    ],
  },
  pair: {
    light: {
      src: '/img/home-light.webp',
      alt: 'The same AFLDB home page in its light theme, on cream paper with dark ink.',
      width: 1600,
      height: 1000,
    },
    lightCaption: 'Light',
    mobile: {
      src: '/img/home-mobile-dark.webp',
      alt: 'The AFLDB home page on a phone, with the search box and statistics '
        + 'stacked in a single column.',
      width: 420,
      height: 910,
    },
    mobileCaption: 'Mobile',
  },
};

/**
 * Normalise a list of blocks: drop the unusable, dedupe ids, cap the length.
 *
 * "Unusable" means a card with neither a heading nor body — there is nothing
 * to render and nothing to edit back into shape. Everything else is kept, so
 * a half-finished card survives a save rather than vanishing under the
 * author's hands.
 */
function parseBlocks<T>(
  value: unknown,
  fallback: T[],
  max: number,
  one: (raw: Record<string, unknown>, id: string) => T | null,
): T[] {
  if (!Array.isArray(value)) return fallback;

  const seen = new Set<string>();
  const blocks: T[] = [];

  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;

    // An id that is missing or already used is REPLACED rather than dropped:
    // ids here are presentation-only, so a collision is a bug in the editor,
    // not a reason to lose the author's words.
    const id = isBlockId(item.id) && !seen.has(item.id) ? item.id : newBlockId();

    const block = one(item, id);
    if (!block) continue;

    seen.add(id);
    blocks.push(block);
    if (blocks.length >= max) break;
  }

  return blocks;
}

function parseStats(value: unknown): ApexStat[] {
  return parseBlocks<ApexStat>(
    value,
    DEFAULT_APEX_CONTENT.hero.stats,
    CONTENT_LIMITS.maxStats,
    (raw, id) => {
      const metric = isMetric(raw.metric) ? raw.metric : 'custom';
      const statValue = text(raw.value, CONTENT_LIMITS.labelChars);
      // A custom figure with no figure in it renders as an empty box, so it
      // is dropped. A metric-backed one needs no value: that is the point.
      if (metric === 'custom' && !statValue) return null;
      return {
        id,
        label: text(raw.label, CONTENT_LIMITS.labelChars),
        metric,
        value: statValue,
      };
    },
  );
}

export function parseApexContent(value: unknown): ApexContent {
  const fallback = DEFAULT_APEX_CONTENT;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const raw = value as Record<string, unknown>;

  const section = (key: string): Record<string, unknown> => {
    const inner = raw[key];
    return inner && typeof inner === 'object' && !Array.isArray(inner)
      ? inner as Record<string, unknown>
      : {};
  };

  const meta = section('meta');
  const header = section('header');
  const hero = section('hero');
  const features = section('features');
  const notes = section('notes');
  const pair = section('pair');

  return {
    sections: parseApexSections(raw.sections),
    meta: {
      title: textOr(meta.title, CONTENT_LIMITS.metaTitleChars, fallback.meta.title),
      description: textOr(
        meta.description, CONTENT_LIMITS.metaDescriptionChars, fallback.meta.description,
      ),
      // The social variants fall back to the page's own title and description
      // rather than to the shipped defaults, so editing one field does not
      // leave a stale sentence behind on a share card.
      ogTitle: textOr(
        meta.ogTitle,
        CONTENT_LIMITS.metaTitleChars,
        textOr(meta.title, CONTENT_LIMITS.metaTitleChars, fallback.meta.ogTitle),
      ),
      ogDescription: textOr(
        meta.ogDescription,
        CONTENT_LIMITS.metaDescriptionChars,
        textOr(
          meta.description, CONTENT_LIMITS.metaDescriptionChars, fallback.meta.ogDescription,
        ),
      ),
      // Optional, like every other image slot now: a page that would rather
      // share as a plain link than as a card is a legitimate choice, and
      // reinstating a picture the author removed is not a repair.
      ogImage: parseOptionalImage(meta.ogImage),
      schemaDescription: textOr(
        meta.schemaDescription,
        CONTENT_LIMITS.metaDescriptionChars,
        fallback.meta.schemaDescription,
      ),
    },
    header: {
      brand: textOr(header.brand, CONTENT_LIMITS.labelChars, fallback.header.brand),
      tagline: text(header.tagline, CONTENT_LIMITS.labelChars),
    },
    hero: {
      eyebrow: text(hero.eyebrow, CONTENT_LIMITS.labelChars),
      // A page with no h1 is broken rather than minimal, so this one field
      // cannot be emptied.
      heading: textOr(hero.heading, CONTENT_LIMITS.headingChars, fallback.hero.heading),
      lede: text(hero.lede, CONTENT_LIMITS.ledeChars),
      // A button with no words on it is not a button, so this one field of
      // the call to action cannot be emptied. Removing the button entirely is
      // done at /admin/settings, by closing the form.
      ctaLabel: textOr(hero.ctaLabel, CONTENT_LIMITS.labelChars, fallback.hero.ctaLabel),
      requestEmail: isEmailAddress(hero.requestEmail)
        ? hero.requestEmail
        : fallback.hero.requestEmail,
      stats: parseStats(hero.stats),
      statsLabel: textOr(hero.statsLabel, CONTENT_LIMITS.labelChars, fallback.hero.statsLabel),
    },
    wideShot: parseOptionalImage(raw.wideShot),
    features: {
      heading: text(features.heading, CONTENT_LIMITS.headingChars),
      items: parseBlocks<ApexFeature>(
        features.items,
        fallback.features.items,
        CONTENT_LIMITS.maxFeatures,
        (item, id) => {
          const heading = text(item.heading, CONTENT_LIMITS.headingChars);
          const body = text(item.body, CONTENT_LIMITS.bodyChars);
          if (!heading && !body) return null;
          return { id, heading, body, image: parseOptionalImage(item.image) };
        },
      ),
    },
    notes: {
      heading: text(notes.heading, CONTENT_LIMITS.headingChars),
      items: parseBlocks<ApexNote>(
        notes.items,
        fallback.notes.items,
        CONTENT_LIMITS.maxNotes,
        (item, id) => {
          const heading = text(item.heading, CONTENT_LIMITS.headingChars);
          const body = text(item.body, CONTENT_LIMITS.bodyChars);
          if (!heading && !body) return null;
          return { id, heading, body };
        },
      ),
    },
    pair: {
      light: parseOptionalImage(pair.light),
      lightCaption: text(pair.lightCaption, CONTENT_LIMITS.labelChars),
      mobile: parseOptionalImage(pair.mobile),
      mobileCaption: text(pair.mobileCaption, CONTENT_LIMITS.labelChars),
    },
  };
}

/** Every image the document currently points at, for publish and for pruning. */
export function apexImages(content: ApexContent): ApexImage[] {
  return [
    content.meta.ogImage,
    content.wideShot,
    content.pair.light,
    content.pair.mobile,
    ...content.features.items.map((feature) => feature.image),
  ].filter((image): image is ApexImage => image !== null);
}

/** Whether a section is switched on, for the renderer and the editor alike. */
export function isSectionVisible(content: ApexContent, id: ApexSectionId): boolean {
  return content.sections.some((section) => section.id === id && section.visible);
}

// --- The shared footer ---

/**
 * One footer, two renderers.
 *
 * `src/app/layout.tsx` draws it under every page of the application, and the
 * publisher writes the same lines into the static apex page. That is the
 * whole point of it living here: the colophon on afldb.com and the colophon
 * on beta.afldb.com cannot drift apart, because there is one of them.
 *
 * Lines are PLAIN TEXT, escaped by both renderers. The one piece of markup a
 * footer needs — the contact address — is a separate field the renderers turn
 * into a `mailto:`, so nobody has to be trusted with an `<a href>` on a public
 * page.
 */
export type SiteFooter = {
  lines: string[];
  contactEmail: string;
  /**
   * Link text appended to the first line, on APPLICATION pages only. The
   * static apex page has no /about to point at, so it omits this rather than
   * publishing a link that 404s.
   */
  aboutLinkText: string;
};

export const DEFAULT_SITE_FOOTER: SiteFooter = {
  lines: [
    'AFLDB — Australian Football statistics, 1897 to present. Data derived from '
    + 'publicly available sources including AFL Tables and Wikipedia.',
    'AFLDB is an independent hobby project, and is not affiliated with the AFL.',
    'Statistics not collected in a given era are shown as “—”, never as zero.',
  ],
  contactEmail: 'admin@afldb.com',
  aboutLinkText: 'About this data →',
};

/**
 * The same permissive shape check the early-access form applies. An address is
 * verified by being written to, not by a regular expression; all this rejects
 * is something that could not be an address at all.
 */
export function isEmailAddress(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= CONTENT_LIMITS.emailChars
    && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

export function parseSiteFooter(value: unknown): SiteFooter {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_SITE_FOOTER;
  }
  const raw = value as Record<string, unknown>;

  const lines = Array.isArray(raw.lines)
    ? raw.lines
      .map((line) => text(line, CONTENT_LIMITS.footerLineChars))
      .filter(Boolean)
      .slice(0, CONTENT_LIMITS.maxFooterLines)
    : DEFAULT_SITE_FOOTER.lines;

  return {
    // An empty footer is a legitimate choice — it renders as the contact line
    // alone — so a present-but-empty list is kept rather than defaulted.
    lines,
    // Emptying the address removes the contact line; an address that is
    // present but malformed is a typo, and reverting is kinder than
    // publishing a dead mailto.
    contactEmail: raw.contactEmail === ''
      ? ''
      : (isEmailAddress(raw.contactEmail)
        ? raw.contactEmail
        : DEFAULT_SITE_FOOTER.contactEmail),
    aboutLinkText: text(raw.aboutLinkText, CONTENT_LIMITS.labelChars),
  };
}
