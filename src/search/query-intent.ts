/**
 * Query-intent recognition for the global search box.
 *
 * Free text like "brownlow winner richmond" or "most goals essendon" names
 * a specific filtered view, not a single entity — no player, club or venue
 * row is "the answer." This module recognises a small, growing set of such
 * phrasings and turns them into a direct link with the right table, filter
 * and section already applied.
 *
 * It does not re-rank entities itself: `resolveIntent` takes the caller's
 * own best-ranked record/award hit (from `searchRecords`/`searchAwards`,
 * run against the query with any club/year already stripped — see
 * `globalSearch` in `db/queries/search.ts`) rather than duplicating that
 * ranking logic here.
 *
 * Kept free of server-only imports, like `match-spec.ts` and
 * `advanced-spec.ts`, so it stays unit-testable without a database
 * connection.
 */

export type IntentClub = { slug: string; name: string };

export type IntentCandidate = { slug: string; title: string; score: number };

export type IntentMatch = {
  href: string;
  label: string;
  detail: string;
};

export type QuerySignals = {
  /** The query with any matched club name and year removed. */
  topicWords: string;
  club: IntentClub | null;
  year: number | null;
};

/** A record/award hit is trusted for intent purposes at prefix strength or better. */
const CONFIDENCE_THRESHOLD = 500;

const SEASON_MIN = 1897;
const SEASON_MAX = 2100;
const YEAR_RE = /\b(1[89]\d{2}|20\d{2})\b/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findYear(text: string): { year: number; matched: string } | null {
  const match = YEAR_RE.exec(text);
  if (!match) return null;
  const year = Number(match[0]);
  if (year < SEASON_MIN || year > SEASON_MAX) return null;
  return { year, matched: match[0] };
}

/**
 * The longest club name that appears as a whole word/phrase in the query.
 *
 * Longest match wins so a club whose name is a substring of another's
 * (unlikely today, but not guaranteed by the data) can't shadow the more
 * specific one.
 */
function findClub(
  text: string,
  clubs: readonly IntentClub[],
): { club: IntentClub; matched: string } | null {
  let best: { club: IntentClub; matched: string } | null = null;
  for (const club of clubs) {
    const name = club.name.toLowerCase();
    if (best && name.length <= best.matched.length) continue;
    const re = new RegExp(`\\b${escapeRegExp(name)}\\b`);
    if (re.test(text)) best = { club, matched: name };
  }
  return best;
}

function stripMatches(text: string, matched: readonly (string | undefined)[]): string {
  let result = text;
  for (const m of matched) {
    if (!m) continue;
    result = result.replace(new RegExp(`\\b${escapeRegExp(m)}\\b`), ' ');
  }
  return result.replace(/\s+/g, ' ').trim();
}

/** Detect the club and year a query names, and what's left once they're removed. */
export function extractQuerySignals(
  query: string,
  clubs: readonly IntentClub[],
): QuerySignals {
  const lower = query.trim().toLowerCase();
  const yearMatch = findYear(lower);
  const clubMatch = findClub(lower, clubs);
  const topicWords = stripMatches(lower, [yearMatch?.matched, clubMatch?.matched]);
  return {
    topicWords,
    club: clubMatch?.club ?? null,
    year: yearMatch?.year ?? null,
  };
}

function titleCase(text: string): string {
  return text.replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildHref(
  path: string,
  params: Record<string, string | undefined>,
  hash?: string,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const qs = search.toString();
  return `${path}${qs ? `?${qs}` : ''}${hash ? `#${hash}` : ''}`;
}

/**
 * Resolve a query and its extracted signals to a single best deep link.
 *
 * Checked in order, first match wins. Returns `null` when nothing in the
 * registry recognises the query — callers should keep showing the normal
 * entity results in that case, not an empty state.
 */
export function resolveIntent(
  query: string,
  signals: QuerySignals,
  ctx: { bestRecord?: IntentCandidate | null; bestAward?: IntentCandidate | null },
): IntentMatch | null {
  const lower = query.trim().toLowerCase();
  if (lower.length === 0) return null;

  const { club, year, topicWords } = signals;
  const yearStr = year !== null ? String(year) : undefined;

  // 1. Brownlow: a dedicated page (full vote history, career leaders),
  // distinct from the generic awards-table row of the same name.
  if (/\bbrownlow\b/.test(lower) || ctx.bestAward?.slug === '/brownlow') {
    if (club) {
      return {
        href: buildHref(
          '/brownlow',
          { club: club.slug, season_min: yearStr, season_max: yearStr },
          'brownlow-winners',
        ),
        label: `Brownlow winners — ${club.name}`,
        detail: 'Winners by season, filtered to this club.',
      };
    }
    if (/\bleaders?\b|\bcareer\b/.test(topicWords)) {
      return {
        href: buildHref('/brownlow', {}, 'brownlow-leaders'),
        label: 'Brownlow career vote leaders',
        detail: 'Most career Brownlow votes.',
      };
    }
    if (year !== null) {
      return {
        href: buildHref('/brownlow', { season_min: yearStr, season_max: yearStr }, 'brownlow-winners'),
        label: `Brownlow Medal, ${year}`,
        detail: 'Winners by season, filtered to this year.',
      };
    }
    return {
      href: '/brownlow',
      label: 'Brownlow Medal',
      detail: 'Every winner and the full vote history, from 1924.',
    };
  }

  // 2. Draft: the recruiting club ("drafted to") vs. the feeder club
  // ("drafted from") are different filters on the same page. The feeder
  // club is almost never an AFL club — it's a WAFL/SANFL/TAC Cup side
  // (Claremont, Oakleigh, ...) that the `clubs` table (and so `club`,
  // detected against AFL club names) knows nothing about. So "from"/"out
  // of" wording is read directly off the raw query rather than off the
  // shared club signal, taking whatever text follows it verbatim — which
  // is also why /draft's "Drafted from" filter is free text, not a select.
  if (/\bdraft(ed)?\b/.test(lower)) {
    const params: Record<string, string | undefined> = { year: yearStr };
    let detail = 'Draft picks';
    const fromMatch = /\b(?:from|out of)\s+(.+)$/.exec(lower);
    const origin = fromMatch ? fromMatch[1].replace(YEAR_RE, '').trim() : '';
    if (origin) {
      params.origin = titleCase(origin);
      detail = `Recruited from ${titleCase(origin)}`;
    } else if (club) {
      params.club = club.slug;
      detail = `Drafted to ${club.name}`;
    }
    if (year !== null) detail += ` in ${year}`;
    return {
      href: buildHref('/draft', params),
      label: 'Draft picks',
      detail,
    };
  }

  // 3. A record category, narrowed to a club. Left to the generic record
  // result when there's no club — this only adds value once one narrows it.
  if (club && ctx.bestRecord && ctx.bestRecord.score >= CONFIDENCE_THRESHOLD) {
    return {
      href: buildHref(`/records/${ctx.bestRecord.slug}`, { club: club.slug }),
      label: `${ctx.bestRecord.title} — ${club.name}`,
      detail: `${ctx.bestRecord.title}, filtered to ${club.name}.`,
    };
  }

  // 4. A non-Brownlow award, narrowed to a club (Brownlow is handled above).
  if (club && ctx.bestAward && ctx.bestAward.score >= CONFIDENCE_THRESHOLD) {
    return {
      href: buildHref(`/awards/${ctx.bestAward.slug}`, {
        club: club.slug, season_min: yearStr, season_max: yearStr,
      }),
      label: `${ctx.bestAward.title} — ${club.name}`,
      detail: `Every winner, filtered to ${club.name}.`,
    };
  }

  return null;
}
